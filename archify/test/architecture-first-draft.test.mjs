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

// These candidates are unmodified first drafts from the repair study: authors
// declared no route controls, yet the router accepted routes that the
// showcase composition gate then rejected (a frame border used as a corridor,
// a 3px jog, a 10px interior turn). Every one cost a hand-routing repair loop.
for (const name of ['audit-luna', 'audit-terra', 'queue-sol']) {
  test(`architecture: first draft ${name} validates for showcase without route controls`, () => {
    const { status, receipt } = validate('architecture', path.join(fixtures, `${name}.architecture.json`));
    assert.equal(status, 0, JSON.stringify(receipt.diagnostics, null, 2));
    assert.equal(receipt.ok, true);
    assert.equal(receipt.composition.summary.errors, 0);
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
    assert.equal(result.status, 0, JSON.stringify(result.receipt.diagnostics, null, 2));
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
