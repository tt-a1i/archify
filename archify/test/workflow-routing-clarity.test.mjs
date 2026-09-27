import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileWorkflow } from '../renderers/workflow/workflow-compiler.mjs';

function workflowFixture() {
  return JSON.parse(fs.readFileSync(
    new URL('./fixtures/workflow-routing-clarity.workflow.json', import.meta.url),
    'utf8',
  ));
}

function edgeTag(svg, from, to) {
  const tag = (svg.match(/<path\b[^>]*>/g) || []).find((candidate) => (
    candidate.includes(`data-edge-from="${from}"`) && candidate.includes(`data-edge-to="${to}"`)
  ));
  assert.ok(tag, `expected rendered ${from}->${to}`);
  return tag;
}

test('readable-v2 keeps clear adjacent routes straight without moving nodes or enlarging the canvas', () => {
  const result = compileWorkflow({ workflow: workflowFixture(), qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  // The reproduction already has sufficient room; routing must preserve its layout.
  assert.deepEqual(result.receipt.viewBox, [949, 528]);
  assert.deepEqual(result.receipt.nodes.map(({ id, x, y, width, height }) => (
    [id, x, y, width, height]
  )), [
    ['request', 48, 93, 92, 52],
    ['admit', 225.2, 93, 92, 52],
    ['graph', 498.4, 93, 92, 52],
    ['start', 345.2, 217, 92, 52],
    ['turn', 498.4, 217, 92, 52],
    ['tool', 670.8, 217, 92, 52],
    ['resume', 828.8, 217, 92, 52],
    ['commit', 670.8, 341, 92, 52],
    ['project', 828.8, 341, 92, 52],
  ]);

  const adjacentRoutes = [['turn', 'tool'], ['commit', 'project']].map(([from, to]) => {
    const edge = result.receipt.edges.find((candidate) => candidate.from === from && candidate.to === to);
    assert.ok(edge, `expected the authored ${from}->${to} relationship`);
    return { from, to, pointCount: edge.points.length };
  });
  assert.deepEqual(adjacentRoutes, [
    { from: 'turn', to: 'tool', pointCount: 2 },
    { from: 'commit', to: 'project', pointCount: 2 },
  ], 'clear adjacent forward relationships should not take channel detours');
});

test('readable-v2 separates opposing routes that meet at a shared node', () => {
  const result = compileWorkflow({ workflow: workflowFixture(), qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));

  const edges = result.receipt.edges;
  const opposingCorridors = [];
  for (let firstIndex = 0; firstIndex < edges.length; firstIndex += 1) {
    const first = edges[firstIndex];
    for (const second of edges.slice(firstIndex + 1)) {
      if (![first.from, first.to].some((id) => id === second.from || id === second.to)) continue;
      for (let firstSegment = 0; firstSegment < first.points.length - 1; firstSegment += 1) {
        const [a, b] = first.points.slice(firstSegment, firstSegment + 2);
        for (let secondSegment = 0; secondSegment < second.points.length - 1; secondSegment += 1) {
          const [c, d] = second.points.slice(secondSegment, secondSegment + 2);
          for (const axis of [0, 1]) {
            const fixedAxis = 1 - axis;
            if (a[fixedAxis] !== b[fixedAxis] || c[fixedAxis] !== d[fixedAxis]
                || a[fixedAxis] !== c[fixedAxis]) continue;
            if ((b[axis] - a[axis]) * (d[axis] - c[axis]) >= 0) continue;
            const overlapPx = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]))
              - Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]));
            if (overlapPx >= 8) {
              opposingCorridors.push({
                first: `${first.from}->${first.to}`,
                second: `${second.from}->${second.to}`,
                overlapPx,
              });
            }
          }
        }
      }
    }
  }

  assert.deepEqual(opposingCorridors, [], 'incoming and outgoing arrows must remain distinguishable at shared nodes');
});

test('readable-v2 routing remains deterministic and preserves every authored relationship', () => {
  const workflow = workflowFixture();
  const before = JSON.stringify(workflow);
  const first = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics, null, 2));
  assert.equal(JSON.stringify(workflow), before, 'compilation must not mutate its input');
  assert.equal(first.receipt.nodes.length, 9);
  assert.deepEqual(
    first.receipt.edges.map(({ from, to }) => `${from}->${to}`).sort(),
    workflow.edges.map(({ from, to }) => `${from}->${to}`).sort(),
  );

  const reordered = workflowFixture();
  reordered.nodes.reverse();
  reordered.edges.reverse();
  for (const document of [workflow, reordered]) {
    const repeated = compileWorkflow({ workflow: document, qualityProfile: 'showcase' });
    assert.equal(repeated.ok, true, JSON.stringify(repeated.diagnostics, null, 2));
    assert.deepEqual(repeated.receipt, first.receipt);
    assert.equal(repeated.svg, first.svg);
  }
});

test('readable-v2 preserves authored sides, routes, channels, vias, and label positions', () => {
  const cases = [
    { fromSide: 'right', toSide: 'left' },
    { route: 'straight' },
    { route: 'bottom-channel' },
    { channelY: 425 },
    { via: [[716.8, 425], [836.8, 425]], fromSide: 'bottom', toSide: 'bottom' },
    { labelAt: [776.8, 415] },
  ];
  for (const authored of cases) {
    const workflow = workflowFixture();
    Object.assign(workflow.edges.find(({ from, to }) => from === 'commit' && to === 'project'), authored);
    const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
    assert.equal(result.ok, true, JSON.stringify({ authored, diagnostics: result.diagnostics }, null, 2));
    const edge = result.receipt.edges.find(({ from, to }) => from === 'commit' && to === 'project');
    const source = result.receipt.nodes.find(({ id }) => id === 'commit');
    const target = result.receipt.nodes.find(({ id }) => id === 'project');
    assert.doesNotMatch(edgeTag(result.svg, 'commit', 'project'), /data-composition-routing=/);
    assert.match(edgeTag(result.svg, 'request', 'admit'), /data-composition-routing="workflow-v2-auto"/);
    if (authored.fromSide === 'right') assert.equal(edge.points[0][0], source.x + source.width);
    if (authored.toSide === 'left') assert.equal(edge.points.at(-1)[0], target.x);
    if (authored.fromSide === 'bottom') assert.equal(edge.points[0][1], source.y + source.height);
    if (authored.toSide === 'bottom') assert.equal(edge.points.at(-1)[1], target.y + target.height);
    if (authored.route === 'straight') assert.equal(edge.points.length, 2);
    if (authored.route === 'bottom-channel') {
      assert.ok(edge.points.slice(1, -1).every(([, y]) => y > Math.max(source.y + source.height, target.y + target.height)));
    }
    if (authored.channelY !== undefined) {
      assert.ok(edge.points.some((point, index) => index > 0 && point[1] === authored.channelY
        && edge.points[index - 1][1] === authored.channelY));
    }
    if (authored.via) assert.deepEqual(edge.points.slice(1, -1), authored.via);
    if (authored.labelAt) {
      const label = result.receipt.labels.find(({ label: text }) => text === 'projection');
      assert.deepEqual([label.x, label.y], authored.labelAt);
    }
  }
});

test('fixed-v1 stays outside the automatic workflow routing contract', () => {
  const workflow = JSON.parse(fs.readFileSync(
    new URL('./fixtures/v1-baseline/agent-tool-call.workflow.json', import.meta.url),
    'utf8',
  ));
  const result = compileWorkflow({ workflow, qualityProfile: 'standard' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(result.receipt.contract, 'fixed-v1');
  assert.deepEqual(result.receipt.viewBox, [720, 900]);
  assert.equal(result.receipt.edges.length, workflow.edges.length);
  assert.doesNotMatch(result.svg, /data-composition-routing="workflow-v2-auto"/);
});

test('readable-v2 keeps emphasis and wide-arrow fan-in marker bounds disjoint', () => {
  for (const width of [undefined, 6]) {
    const workflow = {
      schema_version: 2,
      diagram_type: 'workflow',
      meta: { title: 'Shared destination', output: 'shared-destination.html', legend: { mode: 'hidden' } },
      lanes: ['a', 'b', 'c'].map((id) => ({ id, label: id.toUpperCase() })),
      nodes: ['a', 'b', 'c'].map((id) => ({
        id, lane: id, col: id === 'c' ? 2 : 0, type: 'backend', label: id.toUpperCase(),
      })),
      edges: ['a', 'b'].map((from) => ({
        from, to: 'c', variant: 'emphasis', ...(width === undefined ? {} : { width }),
      })),
    };
    const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
    const destination = result.receipt.nodes.find(({ id }) => id === 'c');
    const topRoute = result.receipt.edges.find(({ from }) => from === 'a').points;
    const leftRoute = result.receipt.edges.find(({ from }) => from === 'b').points;
    const topTip = topRoute.at(-1);
    const leftTip = leftRoute.at(-1);
    assert.deepEqual(topTip, [destination.x + destination.width / 2, destination.y]);
    assert.equal(topRoute.at(-2)[0], topTip[0]);
    assert.ok(topRoute.at(-2)[1] < topTip[1], 'the top arrow arrives downward');
    // The bundled 10x7 marker has refX=9: these perpendicular marker bounds
    // remain disjoint even with a 6px stroke, without relying on router helpers.
    const strokeWidth = width ?? 1.8;
    if (leftTip[1] === destination.y) {
      assert.equal(leftRoute.at(-2)[0], leftTip[0]);
      assert.ok(leftRoute.at(-2)[1] < leftTip[1]);
      assert.ok(Math.abs(topTip[0] - leftTip[0]) >= 7 * strokeWidth,
        'parallel arrivals must have non-overlapping marker bounds');
    } else {
      assert.deepEqual(leftTip, [destination.x, destination.y + destination.height / 2]);
      assert.equal(leftRoute.at(-2)[1], leftTip[1]);
      assert.ok(leftRoute.at(-2)[0] < leftTip[0]);
      assert.ok(topTip[0] - 3.5 * strokeWidth > leftTip[0] + strokeWidth,
        'the top marker must remain to the right of the left marker');
    }
  }
});

test('public validate and rendered HTML agree on automatic workflow routing', (t) => {
  const cli = fileURLToPath(new URL('../bin/archify.mjs', import.meta.url));
  const input = fileURLToPath(new URL('./fixtures/workflow-routing-clarity.workflow.json', import.meta.url));
  const validation = spawnSync(process.execPath, [cli, 'validate', 'workflow', input, '--quality', 'showcase', '--json'], { encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
  const receipt = JSON.parse(validation.stdout);
  assert.equal(receipt.ok, true);
  assert.ok(receipt.checks.length > 0);
  assert.ok(receipt.checks.every(({ ok }) => ok));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-routing-clarity-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'workflow.html');
  const rendered = spawnSync(process.execPath, [cli, 'render', 'workflow', input, output, '--quality', 'showcase'], { encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stderr || rendered.stdout);
  const html = fs.readFileSync(output, 'utf8');
  assert.equal((html.match(/data-composition-routing="workflow-v2-auto"/g) || []).length, 11);
  const checked = spawnSync(process.execPath, [cli, 'check', output, '--json'], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.equal(JSON.parse(checked.stdout).ok, true);
});
