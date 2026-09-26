import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const fixtures = path.join(skillRoot, 'test/fixtures/architecture-first-draft');

function validate(type, input, ...extra) {
  const result = spawnSync(process.execPath, [cli, 'validate', type, input, '--quality', 'showcase', '--json', ...extra], { encoding: 'utf8' });
  return { status: result.status, receipt: JSON.parse(result.stdout) };
}

function layout(input) {
  const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--quality', 'showcase', '--layout-json'], { encoding: 'utf8' });
  return JSON.parse(result.stdout);
}

test('architecture: automatic side changes keep incoming arrowheads distinct', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-final-ports-'));
  try {
    const input = path.join(tmp, 'ports.json');
    fs.writeFileSync(input, JSON.stringify({
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'Shared destination', output: 'ports.html', quality_profile: 'showcase' },
      components: [
        ['a', 40, 40], ['b', 290, 40], ['c', 800, 40],
        ['block', 0, 400], ['hub', 40, 485], ['store', 290, 485],
      ].map(([id, x, y]) => ({ id, type: 'backend', label: id, pos: [x, y], size: [180, 68] })),
      connections: ['a', 'b', 'c'].map((from) => ({ id: from, from, to: 'hub' })),
    }));
    const result = layout(input);
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    const endpoints = result.connections.map((conn) => conn.points.at(-1));
    for (let left = 0; left < endpoints.length; left += 1) {
      for (let right = left + 1; right < endpoints.length; right += 1) {
        const distance = Math.hypot(endpoints[left][0] - endpoints[right][0], endpoints[left][1] - endpoints[right][1]);
        assert.ok(distance >= 14, `arrowheads share a port: ${JSON.stringify(endpoints)}`);
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('architecture: wide incoming arrows reserve a whole side before routing', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-wide-ports-'));
  try {
    for (const { widths, height } of [
      { widths: [4, 4], height: 68 },
      { widths: [4, 4], height: 72 },
      { widths: [4, 1, 4], height: 80 },
    ]) {
      const components = widths.map((_, index) => ({
        id: `source-${index}`, type: 'backend', label: `Source ${index}`,
        pos: [40, 40 + index * 140], size: [120, 68],
      }));
      components.push({ id: 'hub', type: 'backend', label: 'Hub', pos: [600, 140], size: [180, height] });
      const connections = widths.map((width, index) => ({
        id: `edge-${index}`, from: `source-${index}`, to: 'hub', toSide: 'left', width,
      }));
      for (const ordered of [connections, [...connections].reverse()]) {
        const input = path.join(tmp, 'wide.json');
        fs.writeFileSync(input, JSON.stringify({ schema_version: 1, diagram_type: 'architecture',
          meta: { title: 'Wide incoming arrows', output: 'wide.html', quality_profile: 'showcase' },
          components, connections: ordered,
        }));
        const result = layout(input);
        assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
        const tips = new Map(result.connections.map((conn) => [conn.from, conn.points.at(-1)]));
        for (let index = 1; index < connections.length; index += 1) {
          const distance = Math.abs(tips.get(`source-${index}`)[1] - tips.get(`source-${index - 1}`)[1]);
          assert.ok(distance >= 3.5 * (widths[index] + widths[index - 1]), `colliding arrows: ${distance}px`);
        }
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// Keep the original first drafts: route-floor repairs must stay fixed, but
// their cramped labels must not pass by being moved far from their own edge.
function assertOnlyLabelDefects(receipt) {
  assert.equal(receipt.ok, false);
  assert.ok(receipt.diagnostics.length > 0);
  for (const issue of receipt.diagnostics) {
    assert.ok(issue.code === 'composition/label-gap'
      || issue.code === 'composition/label-route-clearance'
      || /^Label ".*" overlaps component /.test(issue.message), JSON.stringify(issue));
  }
}
for (const name of ['audit-luna', 'audit-terra', 'queue-sol']) {
  test(`architecture: first draft ${name} preserves route floors and reports crowded labels`, () => {
    const { status, receipt } = validate('architecture', path.join(fixtures, `${name}.architecture.json`));
    assert.equal(status, 1);
    assertOnlyLabelDefects(receipt);
    assert.ok(receipt.diagnostics.some(issue => issue.code === 'composition/label-gap'));
  });
}

test('architecture: the planner keeps a long automatic route to a few strokes instead of an obstacle-hugging staircase', () => {
  const { connections } = layout(path.join(fixtures, 'audit-luna.architecture.json'));
  const route = connections.find((conn) => conn.from === 'policy' && conn.to === 'review');
  assert.ok(route, 'policy -> review is routed');
  assert.ok(route.points.length <= 5, `expected at most 4 bends, got ${JSON.stringify(route.points)}`);
});

test('architecture: an automatic route beside a boundary keeps off the frame border', () => {
  const { connections, boundaries } = layout(path.join(fixtures, 'queue-sol.architecture.json'));
  const route = connections.find((conn) => conn.from === 'worker' && conn.to === 'dead-letter');
  const frame = boundaries.find((boundary) => boundary.wraps.includes('worker'));
  const right = frame.x + frame.width;
  for (const [x] of route.points.slice(1, -1)) assert.notEqual(Math.round(x), Math.round(right));
});

test('architecture: a self-loop with cramped explicit sides names the loop and the executable fix', () => {
  const input = path.join(fixtures, 'queue-luna.architecture.json');
  const { status, receipt } = validate('architecture', input);
  assert.equal(status, 1);
  const issue = receipt.diagnostics.find((entry) => entry.code === 'layout/self-loop-ports');
  assert.ok(issue, JSON.stringify(receipt.diagnostics, null, 2));
  assert.equal(issue.subject.id, 'retry');
  assert.match(issue.message, /remove fromSide\/toSide/);
  assert.doesNotMatch(issue.message, /farther apart/);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-self-loop-'));
  try {
    const candidate = JSON.parse(fs.readFileSync(input, 'utf8'));
    for (const conn of candidate.connections) {
      if (conn.from === conn.to) {
        delete conn.fromSide;
        delete conn.toSide;
      }
    }
    const repaired = path.join(tmp, 'queue-luna.architecture.json');
    fs.writeFileSync(repaired, JSON.stringify(candidate));
    const result = validate('architecture', repaired);
    assert.equal(result.status, 1);
    assertOnlyLabelDefects(result.receipt);
    assert.ok(!result.receipt.diagnostics.some(issue => issue.code === 'layout/self-loop-ports'));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// The workflow draft from the same study stacked two separate groups of nodes
// in one lane. Failing on the first pair cost the author a full round before
// the second group was even reported.
test('workflow: every overlapping node pair of a first draft is reported in one round', () => {
  const { status, receipt } = validate('workflow', path.join(skillRoot, 'test/fixtures/workflow-first-draft/release-luna.workflow.json'));
  assert.equal(status, 1);
  const overlaps = receipt.diagnostics.filter((entry) => entry.code === 'workflow/node-overlap');
  assert.equal(overlaps.length, 7, JSON.stringify(receipt.diagnostics, null, 2));
  const pairs = overlaps.map((entry) => entry.evidence.nodes.map((node) => node.id).join('>'));
  assert.ok(pairs.includes('test_join>staging_deploy'));
  assert.ok(pairs.includes('metric_gate>rollback_stable'));
});
