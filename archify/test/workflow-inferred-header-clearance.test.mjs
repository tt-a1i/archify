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

function verticalWorkflow({ direction = 'down', edge = {} } = {}) {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Inferred lane-heading clearance', output: 'vertical.html' },
    lanes: [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }],
    nodes: [
      { id: 'a', lane: 'top', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'bottom', col: 0, type: 'backend', label: 'B' },
    ],
    edges: [{
      id: 'ab', from: direction === 'down' ? 'a' : 'b',
      to: direction === 'down' ? 'b' : 'a', route: 'straight', ...edge,
    }],
  };
}

function explicitSides(direction) {
  return direction === 'down'
    ? { fromSide: 'bottom', toSide: 'top' }
    : { fromSide: 'top', toSide: 'bottom' };
}

function compile(workflow, qualityProfile = 'showcase') {
  const result = compileWorkflow({ workflow, qualityProfile });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  return result;
}

for (const direction of ['down', 'up']) {
  for (const quality of ['standard', 'showcase']) {
    for (const [name, edge] of Object.entries({
      omitted: {},
      partial: direction === 'down' ? { fromSide: 'bottom' } : { toSide: 'bottom' },
    })) {
      test(`workflow ${direction}ward straight ${name} sides reserve lane-heading clearance (${quality})`, () => {
        const workflow = verticalWorkflow({ direction, edge });
        const before = structuredClone(workflow);
        const result = compile(workflow, quality);
        const explicit = compile(verticalWorkflow({ direction, edge: explicitSides(direction) }), quality);
        assert.deepEqual(result.receipt.nodes, explicit.receipt.nodes);
        assert.deepEqual(result.receipt.edges, explicit.receipt.edges);
        const [start, end, ...extra] = result.receipt.edges[0].points;
        assert.deepEqual(extra, [], 'straight intent must not become a detour');
        assert.equal(start[0], end[0]);
        assert.equal(start[0], 124.2, 'reuse the existing explicit-top heading clearance');
        assert.ok(direction === 'down' ? start[1] < end[1] : start[1] > end[1]);
        assert.deepEqual(workflow, before, 'side inference must not rewrite authored IR');
      });
    }
  }
}

test('workflow CLI validates and renders an inferred straight endpoint without manual side hints', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-inferred-header-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'vertical.workflow.json');
  const output = path.join(tmp, 'vertical.html');
  fs.writeFileSync(input, JSON.stringify(verticalWorkflow()));
  const validated = spawnSync(process.execPath, [cli, 'validate', 'workflow', input, '--quality', 'showcase', '--json'], { encoding: 'utf8' });
  assert.equal(validated.status, 0, validated.stdout + validated.stderr);
  assert.equal(JSON.parse(validated.stdout).ok, true);
  const rendered = spawnSync(process.execPath, [cli, 'render', 'workflow', input, output, '--quality', 'showcase'], { encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
  assert.match(fs.readFileSync(output, 'utf8'), /data-edge-id="ab"/);
});

test('workflow inferred vertical label and header clearance compose without dropping the label', () => {
  const result = compile(verticalWorkflow({ edge: { label: 'handoff' } }));
  const explicit = compile(verticalWorkflow({ edge: { ...explicitSides('down'), label: 'handoff' } }));
  assert.deepEqual(result.receipt.edges, explicit.receipt.edges);
  assert.deepEqual(result.receipt.labels, explicit.receipt.labels);
  assert.match(result.svg, />handoff<\/text>/);
});

test('workflow header clearance does not override a conflicting authored endpoint direction', () => {
  const result = compileWorkflow({ workflow: verticalWorkflow({ edge: { toSide: 'bottom' } }) });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(({ code }) => code === 'workflow/route-preset-conflict'));
});

test('workflow absolute via pins are not moved to clear a lane heading', () => {
  const workflow = verticalWorkflow({ edge: { via: [[94, 181]] } });
  const before = structuredClone(workflow);
  const result = compileWorkflow({ workflow });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some(({ code }) => code === 'workflow/explicit-pin-conflict'));
  assert.deepEqual(workflow, before);
});

for (const field of ['channelX', 'channelY']) {
  test(`workflow header clearance does not override an authored ${field} pin`, () => {
    const workflow = verticalWorkflow({ edge: { [field]: field === 'channelX' ? 94 : 181 } });
    const before = structuredClone(workflow);
    const result = compileWorkflow({ workflow });
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some(({ code }) => code === 'workflow/explicit-pin-conflict'));
    assert.deepEqual(workflow, before);
  });
}

test('workflow header clearance leaves an absolute label pin in its existing coordinate system', () => {
  const workflow = verticalWorkflow({ edge: { label: 'fixed', labelAt: [250, 181] } });
  const before = structuredClone(workflow);
  const result = compileWorkflow({ workflow });
  assert.equal(result.ok, false);
  const diagnostic = result.diagnostics.find(({ code }) => code === 'workflow/route-preset-conflict');
  assert.ok(diagnostic);
  assert.deepEqual(diagnostic.evidence.points, [[94, 145], [94, 217]]);
  assert.deepEqual(workflow, before);
});

test('workflow short headings retain already-clear inferred geometry', () => {
  const workflow = verticalWorkflow();
  workflow.lanes[0].label = 'T';
  workflow.lanes[1].label = 'B';
  const result = compile(workflow);
  assert.deepEqual(result.receipt.edges[0].points, [[94, 145], [94, 217]]);
});

test('workflow explicit top-side geometry remains unchanged', () => {
  const result = compile(verticalWorkflow({ edge: explicitSides('down') }));
  assert.deepEqual(result.receipt.edges[0].points, [[124.2, 145], [124.2, 217]]);
});
