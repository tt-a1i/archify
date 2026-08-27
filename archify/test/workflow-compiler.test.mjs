import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileWorkflow } from '../renderers/workflow/workflow-compiler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-compiler-'));

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function attribute(tag, name) {
  const value = tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  assert.notEqual(value, undefined, `expected ${name} in ${tag}`);
  return value;
}

function numericRect(attributes) {
  return Object.fromEntries(['x', 'y', 'width', 'height'].map((name) => [
    name,
    Number(attribute(attributes, name)),
  ]));
}

function nodeRect(svg, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attributes = svg.match(new RegExp(
    `<g\\b[^>]*id="node-${escapedId}"[^>]*>[\\s\\S]*?<rect\\b([^>]*)>`,
  ))?.[1];
  assert.ok(attributes, `expected rendered node ${id}`);
  return numericRect(attributes);
}

function edgePoints(svg, id) {
  const tag = (svg.match(/<path\b[^>]*>/g) || []).find((candidate) => (
    attributeOrUndefined(candidate, 'data-edge-id') === id
  ));
  assert.ok(tag, `expected rendered edge ${id}`);
  return attribute(tag, 'data-composition-points')
    .split(';')
    .map((point) => point.split(',').map(Number));
}

function edgeLabelRect(svg, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attributes = svg.match(new RegExp(
    `<g\\b(?=[^>]*data-edge-id="${escapedId}")(?=[^>]*data-edge-label=)[^>]*>[\\s\\S]*?<rect\\b([^>]*)>`,
  ))?.[1];
  assert.ok(attributes, `expected rendered label mask for edge ${id}`);
  return numericRect(attributes);
}

function attributeOrUndefined(tag, name) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

function svgViewBox(svg) {
  const tag = svg.match(/<svg\b[^>]*>/)?.[0];
  assert.ok(tag, 'expected an SVG root');
  return attribute(tag, 'viewBox').split(/\s+/).map(Number);
}

function legendGeometry(svg) {
  return svg.match(/<g data-legend-semantic-kind="[^"]+"[^>]*>/g) || [];
}

function assertRectInsideViewBox(rect, viewBox, message) {
  const [minX, minY, width, height] = viewBox;
  assert.ok(rect.x >= minX, `${message}: left edge ${rect.x} is outside ${minX}`);
  assert.ok(rect.y >= minY, `${message}: top edge ${rect.y} is outside ${minY}`);
  assert.ok(
    rect.x + rect.width <= minX + width,
    `${message}: right edge ${rect.x + rect.width} is outside ${minX + width}`,
  );
  assert.ok(
    rect.y + rect.height <= minY + height,
    `${message}: bottom edge ${rect.y + rect.height} is outside ${minY + height}`,
  );
}

function assertRectInsideRect(rect, container, message) {
  assert.ok(rect.x >= container.x, `${message}: left edge ${rect.x} is outside ${container.x}`);
  assert.ok(rect.y >= container.y, `${message}: top edge ${rect.y} is outside ${container.y}`);
  assert.ok(
    rect.x + rect.width <= container.x + container.width,
    `${message}: right edge ${rect.x + rect.width} is outside ${container.x + container.width}`,
  );
  assert.ok(
    rect.y + rect.height <= container.y + container.height,
    `${message}: bottom edge ${rect.y + rect.height} is outside ${container.y + container.height}`,
  );
}

function groupFrameRect(svg, index = 0) {
  const attributes = svg.match(new RegExp(
    `<rect\\b(?=[^>]*data-composition-frame-kind="group")(?=[^>]*data-composition-frame-id="group-${index}")([^>]*)/>`,
  ))?.[1];
  assert.ok(attributes, `expected rendered group frame ${index}`);
  return numericRect(attributes);
}

function asciiGroupLabelTextRect(svg, label) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attributes = svg.match(new RegExp(`<text\\b([^>]*)>${escapedLabel}</text>`))?.[1];
  assert.ok(attributes, `expected rendered group label ${label}`);
  return {
    x: Number(attribute(attributes, 'x')),
    y: Number(attribute(attributes, 'y')) - 10,
    width: Array.from(label).length * 5.6,
    height: 14,
  };
}

function rectsOverlap(left, right) {
  return !(
    left.x + left.width <= right.x
    || right.x + right.width <= left.x
    || left.y + left.height <= right.y
    || right.y + right.height <= left.y
  );
}

function orthogonalSegmentIntersectsRect(start, end, rect) {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  if (start[1] === end[1]) {
    return start[1] >= top && start[1] <= bottom
      && Math.max(start[0], end[0]) >= left
      && Math.min(start[0], end[0]) <= right;
  }
  if (start[0] === end[0]) {
    return start[0] >= left && start[0] <= right
      && Math.max(start[1], end[1]) >= top
      && Math.min(start[1], end[1]) <= bottom;
  }
  throw new Error(`expected an orthogonal route segment: ${JSON.stringify([start, end])}`);
}

function asciiLaneHeaderTextRect(label, { laneTop = 52, laneIndex = 0 } = {}) {
  const prefix = String(laneIndex + 1).padStart(2, '0');
  return {
    x: 54,
    y: laneTop + 12,
    width: Array.from(`${prefix} / ${label}`).length * 6.2,
    height: 14,
  };
}

function compileSuccessfully(workflow, qualityProfile) {
  const request = qualityProfile === undefined
    ? { workflow }
    : { workflow, qualityProfile };
  const result = compileWorkflow(request);
  assert.equal(
    result.ok,
    true,
    `expected workflow compilation to succeed:\n${JSON.stringify(result.diagnostics, null, 2)}`,
  );
  assert.equal(typeof result.svg, 'string');
  assert.match(result.svg, /^\s*<svg\b/, 'compiler should return one canonical renderer SVG');
  assert.ok(result.receipt);
  assert.deepEqual(result.receipt.diagnostics, []);
  return result;
}

function adjacentWorkflow({
  fromCol = 1,
  toCol = fromCol + 1,
  label,
  widths = [92, 92],
  nodeLabels = ['A', 'B'],
  viewBox,
  frames = false,
} = {}) {
  const workflow = {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: {
      title: `Adjacent ranks ${fromCol} to ${toCol}`,
      legend: { mode: 'hidden' },
      ...(viewBox ? { viewBox } : {}),
    },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      {
        id: 'a', lane: 'main', col: fromCol, type: 'backend', label: nodeLabels[0], width: widths[0],
      },
      {
        id: 'b', lane: 'main', col: toCol, type: 'backend', label: nodeLabels[1], width: widths[1],
      },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', ...(label ? { label } : {}) }],
  };
  if (frames) {
    workflow.phases = [{
      id: 'phase', label: 'P', fromCol, toCol,
    }];
    workflow.groups = [{
      id: 'group', label: 'G', lane: 'main', fromCol, toCol,
    }];
  }
  return workflow;
}

function assertReadableAdjacentResult(result, { label, widths = [92, 92] } = {}) {
  assert.equal(result.receipt.contract, 'readable-v2');
  assert.deepEqual(result.receipt.viewBox, svgViewBox(result.svg).slice(2));
  assert.ok(Array.isArray(result.receipt.requiredViewBox));
  assert.equal(result.receipt.columns.length, 6);
  assert.ok(result.receipt.columns.every(Number.isFinite));
  for (let index = 1; index < result.receipt.columns.length; index += 1) {
    assert.ok(
      result.receipt.columns[index] > result.receipt.columns[index - 1],
      `column ${index} must be strictly after column ${index - 1}`,
    );
  }

  const source = nodeRect(result.svg, 'a');
  const target = nodeRect(result.svg, 'b');
  assert.equal(source.width, widths[0]);
  assert.equal(target.width, widths[1]);
  assert.ok(source.x + source.width <= target.x, 'same-lane nodes must not overlap');

  const points = edgePoints(result.svg, 'ab');
  assert.deepEqual(points.length, 2, `adjacent facing nodes should use a direct route: ${JSON.stringify(points)}`);
  assert.equal(points[0][0], source.x + source.width, 'edge must leave the source right side');
  assert.equal(points[1][0], target.x, 'edge must enter the target left side');
  assert.equal(points[0][1], points[1][1], 'direct route must be horizontal');
  const directClearance = points[1][0] - points[0][0];
  assert.ok(directClearance >= 28, `direct clearance ${directClearance}px must be at least 28px`);

  if (label) {
    const mask = edgeLabelRect(result.svg, 'ab');
    assert.ok(
      directClearance + 1e-9 >= mask.width + 8,
      `labeled direct clearance ${directClearance}px must fit ${mask.width}px mask plus 8px breathing room`,
    );
    assertRectInsideViewBox(mask, svgViewBox(result.svg), 'edge label mask');
  }
}

test('fixed-v1 compiler preserves the official workflow baseline SVG byte-for-byte', () => {
  const workflow = readJson(path.join(__dirname, 'fixtures', 'v1-baseline', 'agent-tool-call.workflow.json'));
  const result = compileSuccessfully(workflow);
  assert.equal(result.receipt.contract, 'fixed-v1');
  assert.equal(
    sha256(result.svg),
    '4e493db1977889675ce7b04bf9ba60fb97cb50f01fc0fd9e8446861282c65645',
  );
});

test('fixed-v1 compiler preserves the exact 700x400 compatibility geometry', () => {
  const workflow = readJson(path.join(
    __dirname,
    'fixtures',
    'v1-workflow-700x400.workflow.json',
  ));

  const result = compileSuccessfully(workflow);
  assert.equal(result.receipt.contract, 'fixed-v1');
  assert.deepEqual(result.receipt.viewBox, [700, 400]);
  assert.deepEqual(svgViewBox(result.svg), [0, 0, 700, 400]);
  assert.equal(
    sha256(result.svg),
    '28b0167460d16c55ae6bf38bde41368248671a78b3a49133da05ed1efb4354af',
    'the v1 compiler extraction must not move or reserialize legacy geometry',
  );
});

test('fixed-v1 keeps valid phase and group spans independent of label measurement', () => {
  const workflow = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Fixed v1 frame geometry', legend: { mode: 'hidden' } },
    lanes: [{ id: 'main', label: 'Main' }],
    phases: [{ id: 'phase', label: 'P'.repeat(17), fromCol: 0, toCol: 0 }],
    groups: [{
      id: 'group', label: 'G'.repeat(30), lane: 'main', fromCol: 0, toCol: 0,
    }],
    nodes: [{ id: 'a', lane: 'main', col: 0, type: 'backend', label: 'A' }],
    edges: [],
  };

  const result = compileSuccessfully(workflow);
  assert.match(
    result.svg,
    /<line x1="42" y1="35" x2="134" y2="35"/,
    'v1 phase spans must retain the legacy fixed 46px padding',
  );
  assert.match(
    result.svg,
    /data-composition-frame-kind="group"[^>]* x="38" y="90" width="100"/,
    'v1 group spans must retain the legacy fixed 50px padding',
  );
});

test('fixed-v1 reports one causal column-capacity diagnostic for issue #126', () => {
  const workflow = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Issue 126 causal diagnostic', legend: { mode: 'hidden' } },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 1, type: 'backend', label: 'A' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', label: 'liga' }],
  };

  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics, null, 2));
  assert.deepEqual(result.receipt.diagnostics, result.diagnostics);

  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, 'workflow/column-capacity');
  assert.equal(diagnostic.subject.edge, 'ab');
  assert.equal(diagnostic.subject.from, 'a');
  assert.equal(diagnostic.subject.to, 'b');
  assert.equal(diagnostic.subject.fromCol, 1);
  assert.equal(diagnostic.subject.toCol, 2);
  assert.deepEqual(diagnostic.evidence, {
    centerDistancePx: 80,
    nodeWidthsPx: [92, 92],
    actualSignedClearancePx: -12,
    requiredDirectClearancePx: 28,
  });
  assert.deepEqual(diagnostic.suppresses, [
    'workflow/short-edge',
    'clean-flow/endpoint-side-direction',
    'workflow/label-node-overlap',
  ]);
  assert.ok(diagnostic.supportedFixes.some((fix) => /schema_version 2/.test(fix)));
  assert.ok(diagnostic.supportedFixes.some((fix) => /column 3/.test(fix)));
  assert.ok(diagnostic.supportedFixes.some((fix) => /width/i.test(fix)));
  assert.doesNotMatch(
    diagnostic.supportedFixes.join('\n'),
    /drop|remove|omit|unlabel|channel/i,
    'a causal overlap diagnostic must not propose a label or routing non-fix',
  );
});

test('fixed-v1 verifies the real coordinate migration before advertising it', () => {
  const workflow = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: {
      title: 'Pinned issue 126 migration',
      viewBox: [720, 400],
      legend: { mode: 'hidden' },
    },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 1, type: 'backend', label: 'A' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
    ],
    edges: [{
      id: 'ab',
      from: 'a',
      to: 'b',
      fromSide: 'top',
      toSide: 'top',
      via: [[220, 60], [300, 60]],
    }],
  };

  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics[0].code, 'workflow/column-capacity');
  assert.ok(
    result.diagnostics[0].supportedFixes.includes('migrate this workflow to schema_version 2'),
    JSON.stringify(result.diagnostics[0], null, 2),
  );
});

test('readable-v2 supports every adjacent rank with and without a semantic label', () => {
  for (const qualityProfile of ['standard', 'showcase']) {
    for (let fromCol = 0; fromCol < 5; fromCol += 1) {
      for (const label of [undefined, 'liga']) {
        const result = compileSuccessfully(adjacentWorkflow({ fromCol, label }), qualityProfile);
        assertReadableAdjacentResult(result, { label });
      }
    }
  }
});

test('readable-v2 satisfies the complete adjacent-rank acceptance matrix', () => {
  let cases = 0;
  for (const qualityProfile of ['standard', 'showcase']) {
    for (let fromCol = 0; fromCol < 5; fromCol += 1) {
      for (const label of [undefined, 'liga']) {
        for (const frames of [false, true]) {
          for (const width of [900, 1080, 1400, 1600]) {
            const result = compileSuccessfully(adjacentWorkflow({
              fromCol,
              label,
              frames,
              viewBox: [width, 420],
            }), qualityProfile);
            assert.deepEqual(result.receipt.viewBox, [width, 420]);
            assertReadableAdjacentResult(result, { label });
            if (frames) assert.match(result.svg, /data-composition-frame-kind="group"/);
            cases += 1;
          }
        }
      }
    }
  }
  assert.equal(cases, 160);
});

test('readable-v2 phase and group frames derive from solved ranks without moving the core geometry', () => {
  for (const qualityProfile of ['standard', 'showcase']) {
    for (let fromCol = 0; fromCol < 5; fromCol += 1) {
      const plain = compileSuccessfully(adjacentWorkflow({ fromCol, label: 'liga' }), qualityProfile);
      const framed = compileSuccessfully(
        adjacentWorkflow({ fromCol, label: 'liga', frames: true }),
        qualityProfile,
      );

      assert.deepEqual(framed.receipt.columns, plain.receipt.columns);
      assert.deepEqual(nodeRect(framed.svg, 'a'), nodeRect(plain.svg, 'a'));
      assert.deepEqual(nodeRect(framed.svg, 'b'), nodeRect(plain.svg, 'b'));
      assert.deepEqual(edgePoints(framed.svg, 'ab'), edgePoints(plain.svg, 'ab'));
      assert.match(framed.svg, /data-composition-frame-kind="group"/);
      assertReadableAdjacentResult(framed, { label: 'liga' });
    }
  }
});

test('readable-v2 treats the phase header mask as a routing obstacle', () => {
  const document = {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Phase route obstacle', legend: { mode: 'hidden' } },
    lanes: [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }],
    nodes: [
      { id: 'a', lane: 'top', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'bottom', col: 4, type: 'backend', label: 'B' },
    ],
    edges: [{
      id: 'ab', from: 'a', to: 'b', fromSide: 'top', toSide: 'top',
    }],
  };

  const withoutPhase = compileSuccessfully(clone(document), 'showcase');
  assert.ok(withoutPhase.receipt.edges.find(({ id }) => id === 'ab'));

  const withPhaseDocument = clone(document);
  withPhaseDocument.phases = [{ id: 'p', label: 'Phase', fromCol: 0, toCol: 5 }];
  const withPhase = compileSuccessfully(withPhaseDocument, 'showcase');
  const columns = withPhase.receipt.columns;
  const phaseMask = {
    x: columns[0] - 46,
    y: 27,
    width: (columns[5] + 46) - (columns[0] - 46),
    height: 16,
  };
  const points = withPhase.receipt.edges.find(({ id }) => id === 'ab').points;
  for (let index = 0; index < points.length - 1; index += 1) {
    assert.equal(
      orthogonalSegmentIntersectsRect(points[index], points[index + 1], phaseMask),
      false,
      `edge ab segment ${index} must clear the phase mask: ${JSON.stringify(points)}`,
    );
  }
});

test('readable-v2 never routes through a single-rank group label', () => {
  const groupLabel = 'Very long group label';
  const document = {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Group label route obstacle', legend: { mode: 'hidden' } },
    lanes: [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }],
    groups: [{ id: 'g', label: groupLabel, lane: 'top', fromCol: 2, toCol: 2 }],
    nodes: [
      { id: 'a', lane: 'top', col: 2, type: 'backend', label: 'A' },
      { id: 'b', lane: 'bottom', col: 4, type: 'database', label: 'B' },
    ],
    edges: [{
      id: 'ab', from: 'a', to: 'b', fromSide: 'top', toSide: 'top',
    }],
  };

  const first = compileWorkflow({ workflow: document, qualityProfile: 'showcase' });
  const second = compileWorkflow({ workflow: clone(document), qualityProfile: 'showcase' });
  assert.deepEqual(second, first, 'repeated compilation must be deterministic');

  assert.equal(first.ok, false);
  assert.equal(first.svg, undefined);
  assert.equal(first.diagnostics.length, 1, JSON.stringify(first.diagnostics, null, 2));
  const [diagnostic] = first.diagnostics;
  assert.equal(diagnostic.code, 'workflow/explicit-pin-conflict');
  assert.equal(diagnostic.subject.path, '/edges/0/fromSide');
  assert.equal(
    diagnostic.evidence.invariant,
    'readable route feasibility with authored endpoint sides',
  );
  assert.deepEqual(diagnostic.evidence.conflictingPins, [{
    edge: 'ab',
    field: 'fromSide',
    path: '/edges/0/fromSide',
    value: 'top',
  }]);
  assert.ok(diagnostic.supportedFixes.length > 0);
  assert.deepEqual(first.receipt.diagnostics, first.diagnostics);

  const repaired = clone(document);
  delete repaired.edges[0].fromSide;
  const rendered = compileWorkflow({ workflow: repaired, qualityProfile: 'showcase' });
  assert.equal(rendered.ok, true, JSON.stringify(rendered.diagnostics, null, 2));

  const escapedLabel = groupLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attributes = rendered.svg.match(new RegExp(
    `<text\\b([^>]*)>${escapedLabel}</text>`,
  ))?.[1];
  assert.ok(attributes, 'expected the rendered group label');
  const groupLabelRect = {
    x: Number(attribute(attributes, 'x')),
    y: Number(attribute(attributes, 'y')) - 10,
    width: Array.from(groupLabel).length * 5.6,
    height: 14,
  };
  const points = rendered.receipt.edges.find(({ id }) => id === 'ab').points;
  for (let index = 0; index < points.length - 1; index += 1) {
    assert.equal(
      orthogonalSegmentIntersectsRect(points[index], points[index + 1], groupLabelRect),
      false,
      `edge ab segment ${index} must clear the group label: ${JSON.stringify(points)}`,
    );
  }
});

test('readable-v2 shifts top-side routes beyond lane header text deterministically', () => {
  const makeDocument = (topLaneLabel) => ({
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Lane header route obstacle', legend: { mode: 'hidden' } },
    lanes: [
      { id: 'top', label: topLaneLabel },
      { id: 'bottom', label: 'Bottom' },
    ],
    nodes: [
      { id: 'a', lane: 'top', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'bottom', col: 4, type: 'database', label: 'B' },
    ],
    edges: [{
      id: 'ab', from: 'a', to: 'b', fromSide: 'top', toSide: 'top',
    }],
  });

  const compiled = new Map();
  for (const label of ['Responsibility owner', 'R']) {
    const first = compileSuccessfully(makeDocument(label), 'showcase');
    const second = compileSuccessfully(makeDocument(label), 'showcase');
    assert.deepEqual(second, first, `${label}: repeated compilation must be deterministic`);

    const points = first.receipt.edges.find(({ id }) => id === 'ab').points;
    const headerRect = asciiLaneHeaderTextRect(label);
    for (let index = 0; index < points.length - 1; index += 1) {
      assert.equal(
        orthogonalSegmentIntersectsRect(points[index], points[index + 1], headerRect),
        false,
        `${label}: edge ab segment ${index} must clear the top lane header: ${JSON.stringify(points)}`,
      );
    }
    compiled.set(label, first);
  }

  assert.ok(
    compiled.get('Responsibility owner').receipt.columns[0]
      > compiled.get('R').receipt.columns[0],
    'the wider lane header must move the col-0 top-side corridor farther right',
  );
});

test('explicit viewBox width is containment capacity and never stretches readable-v2 geometry', () => {
  for (const qualityProfile of ['standard', 'showcase']) {
    for (let fromCol = 0; fromCol < 5; fromCol += 1) {
      const intrinsic = compileSuccessfully(adjacentWorkflow({
        fromCol,
        label: 'liga',
      }), qualityProfile);
      const expectedGeometry = {
        columns: intrinsic.receipt.columns,
        source: nodeRect(intrinsic.svg, 'a'),
        target: nodeRect(intrinsic.svg, 'b'),
        edge: edgePoints(intrinsic.svg, 'ab'),
      };

      for (const width of [900, 1080, 1400, 1600]) {
        const result = compileSuccessfully(adjacentWorkflow({
          fromCol,
          label: 'liga',
          viewBox: [width, 420],
        }), qualityProfile);
        assert.deepEqual(result.receipt.viewBox, [width, 420]);
        assert.deepEqual(svgViewBox(result.svg), [0, 0, width, 420]);
        assert.deepEqual(result.receipt.requiredViewBox, intrinsic.receipt.requiredViewBox);
        assert.deepEqual(result.receipt.columns, expectedGeometry.columns);
        assert.deepEqual(nodeRect(result.svg, 'a'), expectedGeometry.source);
        assert.deepEqual(nodeRect(result.svg, 'b'), expectedGeometry.target);
        assert.deepEqual(edgePoints(result.svg, 'ab'), expectedGeometry.edge);
        assertReadableAdjacentResult(result, { label: 'liga' });
      }
    }
  }
});

test('capacity-only viewBox failures preserve the intrinsic routes, labels, and requirement', () => {
  const document = {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'capacity', legend: { mode: 'hidden' } },
    lanes: [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }],
    nodes: [
      { id: 'n0', lane: 'top', col: 0, type: 'backend', label: 'N0' },
      { id: 'n1', lane: 'bottom', col: 1, type: 'backend', label: 'N1' },
      { id: 'n2', lane: 'top', col: 1, type: 'database', label: 'N2' },
      { id: 'n3', lane: 'bottom', col: 3, type: 'database', label: 'N3' },
    ],
    edges: [
      { id: 'e0', from: 'n3', to: 'n0' },
      {
        id: 'e1',
        from: 'n1',
        to: 'n2',
        label: 'ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ',
      },
    ],
  };
  const intrinsic = compileSuccessfully(clone(document), 'showcase');

  const insufficientDocument = clone(document);
  insufficientDocument.meta.viewBox = [900, 1000];
  const insufficient = compileWorkflow({
    workflow: insufficientDocument,
    qualityProfile: 'showcase',
  });
  assert.equal(insufficient.ok, false);
  assert.equal(insufficient.svg, undefined);
  assert.equal(insufficient.diagnostics.length, 1, JSON.stringify(insufficient.diagnostics, null, 2));
  const [capacity] = insufficient.diagnostics;
  assert.equal(capacity.code, 'workflow/viewbox-capacity');
  assert.deepEqual(capacity.evidence.actualViewBox, [900, 1000]);
  assert.deepEqual(capacity.evidence.requiredViewBox, intrinsic.receipt.requiredViewBox);

  const sufficientDocument = clone(document);
  sufficientDocument.meta.viewBox = [intrinsic.receipt.requiredViewBox[0], 1000];
  const sufficient = compileSuccessfully(sufficientDocument, 'showcase');
  assert.deepEqual(sufficient.receipt.requiredViewBox, intrinsic.receipt.requiredViewBox);
  assert.deepEqual(sufficient.receipt.edges, intrinsic.receipt.edges);
  assert.deepEqual(sufficient.receipt.labels, intrinsic.receipt.labels);
});

test('explicit viewBox capacity names the rank and label constraints that require more width', () => {
  const result = compileWorkflow({
    workflow: adjacentWorkflow({ fromCol: 1, label: 'liga', viewBox: [700, 420] }),
    qualityProfile: 'showcase',
  });
  assert.equal(result.ok, false);
  const diagnostic = result.diagnostics.find(({ code }) => code === 'workflow/viewbox-capacity');
  assert.ok(diagnostic, JSON.stringify(result.diagnostics, null, 2));
  assert.ok(diagnostic.evidence.contributors.includes('rank 1→2 direct clearance'));
  assert.ok(diagnostic.evidence.contributors.includes('edge ab label mask'));
});

test('explicit viewBox capacity names the rank and authored node widths that require more width', () => {
  const result = compileWorkflow({
    workflow: adjacentWorkflow({
      fromCol: 1,
      widths: [240, 240],
      viewBox: [700, 420],
    }),
    qualityProfile: 'showcase',
  });
  assert.equal(result.ok, false);
  const diagnostic = result.diagnostics.find(({ code }) => code === 'workflow/viewbox-capacity');
  assert.ok(diagnostic, JSON.stringify(result.diagnostics, null, 2));
  const contributors = diagnostic.evidence.contributors;
  assert.ok(
    contributors.some((contributor) => /rank 1→2/i.test(contributor) && /clearance/i.test(contributor)),
    `contributors must name the rank 1→2 width constraint: ${JSON.stringify(contributors)}`,
  );
  for (const nodeId of ['a', 'b']) {
    assert.ok(
      contributors.some((contributor) => (
        new RegExp(`node ${nodeId}\\b`, 'i').test(contributor) && /width/i.test(contributor)
      )),
      `contributors must name node ${nodeId}'s authored width: ${JSON.stringify(contributors)}`,
    );
  }
});

test('explicit viewBox height capacity names the authored tall node without naming a hidden legend', () => {
  const result = compileWorkflow({
    workflow: {
      schema_version: 2,
      diagram_type: 'workflow',
      meta: {
        title: 'Tall node height capacity',
        legend: { mode: 'hidden' },
        viewBox: [1200, 280],
      },
      lanes: [{ id: 'main', label: 'M' }],
      nodes: [{
        id: 'tall', lane: 'main', col: 0, type: 'backend', label: 'Tall', height: 160,
      }],
      edges: [],
    },
    qualityProfile: 'showcase',
  });

  assert.equal(result.ok, false);
  assert.equal(result.svg, undefined);
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics, null, 2));
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, 'workflow/viewbox-capacity');
  assert.deepEqual(diagnostic.evidence.actualViewBox, [1200, 280]);
  assert.equal(diagnostic.evidence.requiredViewBox[1], 374);
  const contributors = diagnostic.evidence.contributors;
  assert.ok(
    contributors.some((contributor) => (
      /node tall\b/i.test(contributor)
      && /height/i.test(contributor)
      && /160px/i.test(contributor)
    )),
    `contributors must name tall's authored 160px height: ${JSON.stringify(contributors)}`,
  );
  assert.equal(
    contributors.some((contributor) => /legend/i.test(contributor)),
    false,
    `a hidden legend must not be named as a height contributor: ${JSON.stringify(contributors)}`,
  );
});

test('readable-v2 measures asymmetric custom widths and CJK edge labels', () => {
  const cases = [
    { widths: [32, 92], label: '同步', nodeLabels: ['甲', '乙'] },
    { widths: [102, 124], label: '資料 ready', nodeLabels: ['入口', '出口'] },
    { widths: [132, 160], label: '审批通过', nodeLabels: ['请求', '执行'] },
    { widths: [92, 240], label: '结果 ✅ 回传', nodeLabels: ['工具', '外部服务'] },
  ];

  for (const current of cases) {
    const result = compileSuccessfully(adjacentWorkflow({
      fromCol: 1,
      label: current.label,
      widths: current.widths,
      nodeLabels: current.nodeLabels,
      viewBox: [1600, 420],
    }), 'showcase');
    assertReadableAdjacentResult(result, current);
  }
});

test('readable-v2 compares long-label gutter growth with a legal automatic channel', () => {
  const automaticDocument = adjacentWorkflow({
    fromCol: 3,
    label: 'L'.repeat(80),
  });
  const automatic = compileSuccessfully(automaticDocument, 'showcase');
  const forcedStraightDocument = clone(automaticDocument);
  forcedStraightDocument.edges[0].route = 'straight';
  const forcedStraight = compileSuccessfully(forcedStraightDocument, 'showcase');

  assert.ok(edgePoints(automatic.svg, 'ab').length > 2, 'the compact plan must use a legal channel');
  assert.ok(
    automatic.receipt.requiredViewBox[0] < forcedStraight.receipt.requiredViewBox[0],
    'the selected channel must require less canvas than forcing the direct gutter',
  );
  assertRectInsideViewBox(
    edgeLabelRect(automatic.svg, 'ab'),
    svgViewBox(automatic.svg),
    'long automatic edge label',
  );

  const leftRankDocument = adjacentWorkflow({ fromCol: 0, label: 'X'.repeat(100) });
  const leftRank = compileSuccessfully(leftRankDocument, 'showcase');
  assertRectInsideViewBox(
    edgeLabelRect(leftRank.svg, 'ab'),
    svgViewBox(leftRank.svg),
    'left-rank long automatic edge label',
  );
});

test('readable-v2 property matrix satisfies every adjacent rank across supported representative widths', () => {
  const widths = [32, 92, 102, 124, 132, 160, 240];
  for (let fromCol = 0; fromCol < 5; fromCol += 1) {
    for (const sourceWidth of widths) {
      for (const targetWidth of widths) {
        const result = compileSuccessfully(adjacentWorkflow({
          fromCol,
          label: '同步 ✅',
          widths: [sourceWidth, targetWidth],
        }), 'showcase');
        assertReadableAdjacentResult(result, {
          label: '同步 ✅',
          widths: [sourceWidth, targetWidth],
        });
      }
    }
  }
});

test('readable-v2 expands rank spans for measured phase and group label capacity', () => {
  const workflow = adjacentWorkflow({ fromCol: 0, frames: true });
  workflow.phases[0].label = 'P'.repeat(50);
  workflow.groups[0].label = 'G'.repeat(50);

  const result = compileSuccessfully(workflow, 'showcase');
  assert.ok(result.receipt.columns[1] - result.receipt.columns[0] > 120);
  assertReadableAdjacentResult(result);
});

test('readable-v2 contains a long single-rank group label in its frame and intrinsic canvas', () => {
  const workflow = {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Single-rank group capacity', legend: { mode: 'hidden' } },
    lanes: [{ id: 'main', label: 'Main' }],
    groups: [{
      id: 'long-group',
      label: 'X'.repeat(120),
      lane: 'main',
      fromCol: 5,
      toCol: 5,
    }],
    nodes: [
      { id: 'outside', lane: 'main', col: 2, type: 'database', label: 'Outside' },
      { id: 'node', lane: 'main', col: 5, type: 'backend', label: 'Node' },
    ],
    edges: [],
  };

  const result = compileSuccessfully(workflow, 'showcase');
  assert.ok(result.receipt.requiredViewBox[0] > 768);
  const groupAttributes = result.svg.match(
    /<rect\b(?=[^>]*data-composition-frame-id="group-0")[^>]*\b(x="[^"]+"[^>]*)\/>/,
  )?.[1];
  assert.ok(groupAttributes);
  const group = numericRect(groupAttributes);
  assert.ok(group.width >= 120 * 5.6 + 20, `group width ${group.width} must contain its label`);
  const outside = nodeRect(result.svg, 'outside');
  assert.ok(group.x >= outside.x + outside.width, 'single-rank group must not cover an unrelated rank');
  const labelBaseline = Number(result.svg.match(/<text\b[^>]*\by="([^"]+)"[^>]*>X{120}<\/text>/)?.[1]);
  assert.ok(labelBaseline <= nodeRect(result.svg, 'node').y - 4, 'group label must remain above its node');
});

test('readable-v2 group frames contain custom-width member rectangles on every side', () => {
  const workflow = {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Wide group member', legend: { mode: 'hidden' } },
    lanes: [{ id: 'main', label: 'Main' }],
    groups: [{ id: 'group', label: 'G', lane: 'main', fromCol: 2, toCol: 2 }],
    nodes: [{
      id: 'wide', lane: 'main', col: 2, type: 'backend', label: 'Wide', width: 240,
    }],
    edges: [],
  };

  const result = compileSuccessfully(workflow, 'showcase');
  assertRectInsideRect(
    nodeRect(result.svg, 'wide'),
    groupFrameRect(result.svg),
    'custom-width group member',
  );
});

test('readable-v2 group frames contain tagged and tall members away from the label rail', () => {
  const cases = [
    ['tagged member', { tag: 'TAG' }],
    ['120px-tall member', { height: 120 }],
  ];

  for (const [description, authoredGeometry] of cases) {
    const workflow = {
      schema_version: 2,
      diagram_type: 'workflow',
      meta: { title: description, legend: { mode: 'hidden' } },
      lanes: [{ id: 'main', label: 'Main' }],
      groups: [{ id: 'group', label: 'G', lane: 'main', fromCol: 0, toCol: 1 }],
      nodes: [{
        id: 'member',
        lane: 'main',
        col: 1,
        type: 'backend',
        label: 'Member',
        ...authoredGeometry,
      }],
      edges: [],
    };

    const result = compileSuccessfully(workflow, 'showcase');
    const member = nodeRect(result.svg, 'member');
    const groupLabel = asciiGroupLabelTextRect(result.svg, 'G');
    assert.ok(
      member.x >= groupLabel.x + groupLabel.width,
      `${description}: fixture must keep the member horizontally clear of its group label`,
    );
    assertRectInsideRect(member, groupFrameRect(result.svg), description);
  }
});

test('readable-v2 keeps a first-rank group label mask clear of its lane header mask', () => {
  const workflow = {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'First-rank group labels', legend: { mode: 'hidden' } },
    lanes: [{ id: 'main', label: 'Main' }],
    groups: [{ id: 'group', label: 'G', lane: 'main', fromCol: 0, toCol: 0 }],
    nodes: [{ id: 'member', lane: 'main', col: 0, type: 'backend', label: 'Member' }],
    edges: [],
  };

  const result = compileSuccessfully(workflow, 'showcase');
  const laneHeader = asciiLaneHeaderTextRect('Main');
  const groupLabel = asciiGroupLabelTextRect(result.svg, 'G');
  assert.equal(
    rectsOverlap(laneHeader, groupLabel),
    false,
    `lane header ${JSON.stringify(laneHeader)} must not overlap group label ${JSON.stringify(groupLabel)}`,
  );
});

test('readable-v2 measures multi-row legends into intrinsic and explicit viewBox capacity', () => {
  const workflow = adjacentWorkflow({ fromCol: 0 });
  workflow.meta.legend = {
    mode: 'all',
    entries: Object.fromEntries([
      'frontend', 'backend', 'security', 'messagebus', 'database', 'cloud', 'external',
    ].map((kind) => [kind, { label: `${kind} contract evidence` }])),
  };
  const hiddenDocument = clone(workflow);
  hiddenDocument.meta.legend = { mode: 'hidden' };
  const hidden = compileSuccessfully(hiddenDocument, 'showcase');
  const intrinsic = compileSuccessfully(workflow, 'showcase');
  assert.ok(intrinsic.receipt.requiredViewBox[1] > hidden.receipt.requiredViewBox[1]);

  const tooShortDocument = clone(workflow);
  tooShortDocument.meta.viewBox = [
    intrinsic.receipt.requiredViewBox[0],
    hidden.receipt.requiredViewBox[1],
  ];
  const tooShort = compileWorkflow({ workflow: tooShortDocument, qualityProfile: 'showcase' });
  assert.equal(tooShort.ok, false);
  assert.ok(tooShort.diagnostics.some(({ code }) => code === 'workflow/viewbox-capacity'));

  const sufficientDocument = clone(workflow);
  sufficientDocument.meta.viewBox = [...intrinsic.receipt.requiredViewBox];
  const sufficient = compileSuccessfully(sufficientDocument, 'showcase');
  assert.deepEqual(sufficient.receipt.viewBox, intrinsic.receipt.requiredViewBox);

  const expectedGeometry = {
    requiredViewBox: intrinsic.receipt.requiredViewBox,
    columns: intrinsic.receipt.columns,
    nodes: intrinsic.receipt.nodes,
    edges: intrinsic.receipt.edges,
    labels: intrinsic.receipt.labels,
    legend: legendGeometry(intrinsic.svg),
  };
  for (const width of [900, 1400]) {
    const explicitDocument = clone(workflow);
    explicitDocument.meta.viewBox = [width, 1000];
    const explicit = compileSuccessfully(explicitDocument, 'showcase');
    assert.deepEqual(explicit.receipt.requiredViewBox, expectedGeometry.requiredViewBox);
    assert.deepEqual(explicit.receipt.columns, expectedGeometry.columns);
    assert.deepEqual(explicit.receipt.nodes, expectedGeometry.nodes);
    assert.deepEqual(explicit.receipt.edges, expectedGeometry.edges);
    assert.deepEqual(explicit.receipt.labels, expectedGeometry.labels);
    assert.deepEqual(legendGeometry(explicit.svg), expectedGeometry.legend);
  }
});

test('a wide node in an unrelated lane does not expand the adjacent-rank gap', () => {
  const baselineDocument = adjacentWorkflow({
    fromCol: 1,
    label: 'liga',
    viewBox: [1600, 520],
  });
  baselineDocument.lanes.push({ id: 'other', label: 'Other' });
  const baseline = compileSuccessfully(baselineDocument, 'showcase');

  const withUnrelatedWideNode = clone(baselineDocument);
  withUnrelatedWideNode.nodes.push({
    id: 'wide', lane: 'other', col: 1, type: 'database', label: 'Wide', width: 240,
  });
  const widened = compileSuccessfully(withUnrelatedWideNode, 'showcase');

  assert.equal(
    widened.receipt.columns[2] - widened.receipt.columns[1],
    baseline.receipt.columns[2] - baseline.receipt.columns[1],
  );
});

test('explicit labelAt participates in readable-v2 viewBox containment', () => {
  const workflow = adjacentWorkflow({
    fromCol: 0,
    label: 'outside',
    viewBox: [900, 420],
  });
  workflow.nodes[1].col = 5;
  workflow.edges[0].labelAt = [563, 539];

  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics, null, 2));
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, 'workflow/viewbox-capacity');
  assert.deepEqual(diagnostic.evidence.actualViewBox, [900, 420]);
  assert.ok(diagnostic.evidence.requiredViewBox[1] > 420);
  assert.ok(
    diagnostic.evidence.contributors.some((contributor) => /edge ab label/i.test(contributor)),
    JSON.stringify(diagnostic.evidence.contributors),
  );
  assert.doesNotMatch(diagnostic.supportedFixes.join('\n'), /drop|remove (?:the )?label|unlabel/i);
});

test('sanitized downstream fixtures cover labels, explicit routes, custom widths, and explicit viewBoxes', () => {
  const fixtureRoot = path.join(__dirname, 'fixtures', 'issue-126');

  const labels = compileSuccessfully(readJson(path.join(fixtureRoot, 'labels.workflow.json')), 'showcase');
  assertRectInsideViewBox(
    edgeLabelRect(labels.svg, 'request-result'),
    svgViewBox(labels.svg),
    'sanitized semantic label',
  );

  const explicitRoute = compileSuccessfully(
    readJson(path.join(fixtureRoot, 'explicit-route.workflow.json')),
    'showcase',
  );
  assert.ok(
    edgePoints(explicitRoute.svg, 'producer-consumer').some(([x]) => x === 720),
    'the authored channelX pin must remain exact',
  );

  const customWidths = compileSuccessfully(
    readJson(path.join(fixtureRoot, 'custom-widths.workflow.json')),
    'showcase',
  );
  assert.equal(nodeRect(customWidths.svg, 'compact').width, 32);
  assert.equal(nodeRect(customWidths.svg, 'wide').width, 240);

  const explicitViewBox = compileSuccessfully(
    readJson(path.join(fixtureRoot, 'explicit-viewbox.workflow.json')),
    'showcase',
  );
  assert.deepEqual(explicitViewBox.receipt.viewBox, [1600, 520]);
});

test('readable-v2 SVG and receipt bytes are deterministic across repeated and reordered input', () => {
  const workflow = {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Deterministic workflow', legend: { mode: 'hidden' } },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'frontend', label: 'A' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
      { id: 'c', lane: 'main', col: 4, type: 'database', label: 'C' },
    ],
    edges: [
      { id: 'ab', from: 'a', to: 'b', label: 'one' },
      { id: 'bc', from: 'b', to: 'c', label: 'two' },
    ],
  };

  const first = compileSuccessfully(clone(workflow), 'showcase');
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const repeated = compileSuccessfully(clone(workflow), 'showcase');
    assert.equal(repeated.svg, first.svg);
    assert.equal(JSON.stringify(repeated.receipt), JSON.stringify(first.receipt));
  }

  const reordered = clone(workflow);
  reordered.nodes.reverse();
  reordered.edges.reverse();
  const reorderedResult = compileSuccessfully(reordered, 'showcase');
  assert.equal(reorderedResult.svg, first.svg);
  assert.equal(JSON.stringify(reorderedResult.receipt), JSON.stringify(first.receipt));
});

test('CLI validate workflow --layout-json prints the stable compiler receipt', () => {
  const input = path.join(tmp, 'layout-json.workflow.json');
  fs.writeFileSync(input, JSON.stringify(adjacentWorkflow({
    fromCol: 3,
    label: 'liga',
    viewBox: [1080, 420],
  })));

  const result = spawnSync(process.execPath, [
    cli,
    'validate',
    'workflow',
    input,
    '--layout-json',
    '--quality',
    'standard',
  ], { encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.contract, 'readable-v2');
  assert.deepEqual(receipt.viewBox, [1080, 420]);
  assert.ok(Array.isArray(receipt.requiredViewBox));
  assert.equal(receipt.columns.length, 6);
  assert.deepEqual(receipt.diagnostics, []);
});

test('CLI validate workflow --layout-json returns only the causal compiler failure receipt', () => {
  const input = path.join(tmp, 'layout-json-failure.workflow.json');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Issue 126 failure receipt', legend: { mode: 'hidden' } },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 1, type: 'backend', label: 'A' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b' }],
  }));

  const result = spawnSync(process.execPath, [
    cli,
    'validate',
    'workflow',
    input,
    '--layout-json',
    '--json',
  ], { encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.contract, 'fixed-v1');
  assert.equal(receipt.diagnostics.length, 1, JSON.stringify(receipt.diagnostics, null, 2));
  assert.equal(receipt.diagnostics[0].code, 'workflow/column-capacity');
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
