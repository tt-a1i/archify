import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileWorkflow } from '../renderers/workflow/workflow-compiler.mjs';

const skillRoot = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

function verticalWorkflow({ direction = 'down', edge = {}, schemaVersion = 2 } = {}) {
  const down = direction === 'down';
  return {
    schema_version: schemaVersion,
    diagram_type: 'workflow',
    meta: { title: 'Vertical handoff', output: 'vertical.html', legend: { mode: 'hidden' } },
    lanes: [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }],
    nodes: [
      { id: 'a', lane: 'top', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'bottom', col: 0, type: 'backend', label: 'B' },
    ],
    edges: [{
      id: 'ab', from: down ? 'a' : 'b', to: down ? 'b' : 'a',
      route: 'straight', fromSide: down ? 'bottom' : 'top',
      toSide: down ? 'top' : 'bottom', label: 'handoff', ...edge,
    }],
  };
}

function compile(workflow, qualityProfile = 'standard') {
  const result = compileWorkflow({ workflow, qualityProfile });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  assert.equal(typeof result.svg, 'string');
  return result;
}

function attribute(tag, name) {
  const value = tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  assert.notEqual(value, undefined, `expected ${name} in ${tag}`);
  return Number(value);
}

function edgeLabel(svg) {
  const group = svg.match(/<g\b(?=[^>]*data-edge-id="ab")(?=[^>]*data-edge-label=)[^>]*>([\s\S]*?)<\/g>/)?.[1];
  assert.ok(group, 'expected the rendered semantic label, not merely an accepted route');
  const rect = group.match(/<rect\b[^>]*>/)?.[0];
  const text = group.match(/<text\b[^>]*>/)?.[0];
  assert.ok(rect);
  assert.ok(text);
  assert.match(group, />handoff<\/text>/);
  return {
    point: [attribute(text, 'x'), attribute(text, 'y')],
    rect: Object.fromEntries(['x', 'y', 'width', 'height'].map((name) => [name, attribute(rect, name)])),
  };
}

function assertVerticalCorridor(result) {
  const [start, end, ...extra] = result.receipt.edges[0].points;
  assert.deepEqual(extra, [], 'the authored straight route must retain two endpoints');
  assert.equal(start[0], end[0], 'the route must remain vertical');
  const [top, bottom] = [...result.receipt.nodes].sort((a, b) => a.y - b.y);
  const { rect } = edgeLabel(result.svg);
  assert.ok(rect.y > top.y + top.height, 'the complete label mask must clear the upper node');
  assert.ok(rect.y + rect.height < bottom.y, 'the complete label mask must clear the lower node');
}

for (const direction of ['down', 'up']) {
  for (const quality of ['standard', 'showcase']) {
    test(`workflow v2 ${direction}ward straight label fits the corridor (${quality})`, () => {
      assertVerticalCorridor(compile(verticalWorkflow({ direction }), quality));
    });
  }
}

test('workflow CLI validates and renders the labeled vertical straight route', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-vertical-label-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'vertical.workflow.json');
  const output = path.join(tmp, 'vertical.html');
  fs.writeFileSync(input, JSON.stringify(verticalWorkflow()));

  const validated = spawnSync(process.execPath, [cli, 'validate', 'workflow', input, '--json'], { encoding: 'utf8' });
  assert.equal(validated.status, 0, validated.stdout + validated.stderr);
  const receipt = JSON.parse(validated.stdout);
  assert.equal(receipt.ok, true);
  assert.ok(receipt.checks.length > 0);
  assert.ok(receipt.checks.every((check) => check.ok));

  const rendered = spawnSync(process.execPath, [cli, 'render', 'workflow', input, output], { encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
  edgeLabel(fs.readFileSync(output, 'utf8'));
});

test('workflow v2 explicit labelAt remains authoritative over offsets and labelSegment', () => {
  const unlabelled = compile(verticalWorkflow({ edge: { label: undefined } }));
  const [start, end] = unlabelled.receipt.edges[0].points;
  const labelAt = [start[0], (start[1] + end[1]) / 2];
  const result = compile(verticalWorkflow({
    edge: { labelAt, labelDx: 80, labelDy: 40, labelSegment: 0 },
  }));
  assert.deepEqual(edgeLabel(result.svg).point, labelAt);
});

for (const edge of [{ labelDy: 40 }, { labelDx: 80 }]) {
  test(`workflow v2 preserves authored vertical offsets ${JSON.stringify(edge)}`, () => {
    const result = compile(verticalWorkflow({ edge }));
    const [start, end] = result.receipt.edges[0].points;
    assert.deepEqual(edgeLabel(result.svg).point, [
      (start[0] + end[0]) / 2 + (edge.labelDx ?? 0),
      start[1] - 10 + (edge.labelDy ?? 0),
    ]);
  });
}

for (const edge of [{ labelDx: 0 }, { labelDy: 0 }, { labelDx: 0, labelDy: 0 }, { labelSegment: 0 }]) {
  test(`workflow v2 preserves explicit zero or segment placement ${JSON.stringify(edge)}`, () => {
    // These authored controls previously kept the source-relative anchor and
    // collided with the source node. A default-placement fix must not silently
    // reposition explicitly authored geometry to turn that rejection green.
    const result = compileWorkflow({ workflow: verticalWorkflow({ edge }) });
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(({ code }) => code === 'workflow/route-preset-conflict'));
  });
}

test('workflow v2 horizontal two-point default placement is unchanged', () => {
  const workflow = verticalWorkflow();
  workflow.lanes = [{ id: 'top', label: 'Top' }];
  workflow.nodes[1] = { ...workflow.nodes[1], lane: 'top', col: 2 };
  workflow.edges[0] = { ...workflow.edges[0], fromSide: 'right', toSide: 'left' };
  const result = compile(workflow);
  const [start, end, ...extra] = result.receipt.edges[0].points;
  assert.deepEqual(extra, []);
  assert.equal(start[1], end[1]);
  assert.deepEqual(edgeLabel(result.svg).point, [(start[0] + end[0]) / 2, start[1] - 10]);
});

test('workflow v1 upward two-point default placement is unchanged', () => {
  const result = compile(verticalWorkflow({ direction: 'up', schemaVersion: 1 }));
  const [start, end, ...extra] = result.receipt.edges[0].points;
  assert.deepEqual(extra, []);
  assert.deepEqual(edgeLabel(result.svg).point, [(start[0] + end[0]) / 2, start[1] - 10]);
});
