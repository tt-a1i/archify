import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.resolve(__dirname, '..', 'archify', 'bin', 'archify.mjs');
// An unedited first draft: the long "no approval needed" branch from the agent
// lane to the execution lane was planned before the same-lane "denied" edge
// and took the gap between Human Approval and Blocked, so "denied" could only
// detour through the same corridor (composition/ambiguous-corridor on dev).
const fixture = path.join(__dirname, 'fixtures', 'workflow-first-draft', 'agent-tool-call.workflow.json');
const load = () => JSON.parse(fs.readFileSync(fixture, 'utf8'));

test('an automatic edge squeezed into a shared corridor is planned first instead of failing the draft', () => {
  const validation = spawnSync(process.execPath, [cli, 'validate', 'workflow', fixture, '--quality', 'showcase', '--json'], { encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stdout + validation.stderr);
});

test('route-order feedback is deterministic and leaves the document untouched', () => {
  const workflow = load();
  const before = JSON.stringify(workflow);
  const first = compileWorkflow({ workflow });
  const second = compileWorkflow({ workflow: load() });
  assert.equal(first.ok, true, first.error);
  assert.equal(JSON.stringify(workflow), before);
  assert.deepEqual(first.receipt.edges, second.receipt.edges);
});

test('pinned geometry keeps its own diagnostic: only automatic edges are re-ordered', () => {
  const workflow = load();
  workflow.edges.find((edge) => edge.id === 'e_auto').via = [[480.8, 243], [480.8, 449], [539.2, 449]];
  workflow.edges.find((edge) => edge.id === 'e_denied').via = [[480.8, 367], [480.8, 325], [539.2, 325]];
  const pinned = compileWorkflow({ workflow });
  assert.equal(pinned.ok, false);
  assert.deepEqual(pinned.diagnostics.map((diagnostic) => diagnostic.code), ['workflow/explicit-pin-conflict']);
});

// The "customer impact" edge runs from the on-call lane down to the comms lane,
// and its one horizontal stretch is shorter than its 82px label. Keeping
// the label there made the planner detour the edge into a U below its target.
const incident = path.join(__dirname, 'fixtures', 'workflow-first-draft', 'incident-response.workflow.json');

test('a label that does not fit its preferred stretch moves to a run that clears every node, so the edge does not detour to make room', () => {
  const validation = spawnSync(process.execPath, [cli, 'validate', 'workflow', incident, '--quality', 'showcase', '--json'], { encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stdout + validation.stderr);
  const result = compileWorkflow({ workflow: JSON.parse(fs.readFileSync(incident, 'utf8')) });
  const edge = result.receipt.edges.find((entry) => entry.from === 'triage' && entry.to === 'status');
  assert.deepEqual(edge.points, [[388.6, 269], [388.6, 491], [455.6, 491]]);
});

// Two error edges into Denied used to share a 12px port gap (arrowheads
// overlapping). Raising the same-side clearance floor to 16px separates them.
const refund = path.join(__dirname, 'fixtures', 'workflow-first-draft', 'customer-refund.workflow.json');

test('two automatic arrivals on one side of a node keep at least 16px between their ports', () => {
  const result = compileWorkflow({ workflow: JSON.parse(fs.readFileSync(refund, 'utf8')) });
  assert.equal(result.ok, true, result.error);
  const ends = result.receipt.edges
    .filter((edge) => edge.to === 'deny')
    .map((edge) => edge.points.at(-1));
  assert.ok(ends.length >= 2);
  const axis = Math.abs(ends[0][0] - ends[1][0]) >= Math.abs(ends[0][1] - ends[1][1]) ? 0 : 1;
  const values = ends.map((point) => point[axis]).sort((a, b) => a - b);
  for (let index = 1; index < values.length; index += 1) {
    assert.ok(values[index] - values[index - 1] >= 16, `ports ${values[index - 1]} and ${values[index]} are only ${values[index] - values[index - 1]}px apart`);
  }
});
