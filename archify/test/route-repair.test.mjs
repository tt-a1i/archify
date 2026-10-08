import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { reduceCrossings } from '../bin/route-repair.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(root, '..', 'bin', 'archify.mjs');

test('searched endpoint sides remove a crossing without touching authored routes', async () => {
  const candidate = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'route-repair-crossing.json'), 'utf8'));
  const result = await reduceCrossings({ cliPath, candidate, env: process.env });
  assert.ok(result);
  assert.ok(result.record.crossings[1] < result.record.crossings[0]);
  for (const { id } of result.record.pinned) {
    const before = candidate.connections.find((edge) => edge.id === id);
    assert.ok(!before.fromSide && !before.toSide && !before.via);
  }
  assert.deepEqual(result.candidate.components, candidate.components);
});

test('a variant that removes a crossing by adding a detour is not accepted', async () => {
  const candidate = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'route-repair-detour.json'), 'utf8'));
  const result = await reduceCrossings({ cliPath, candidate, env: process.env });
  assert.ok(result);
  assert.ok(result.record.detours[1] <= result.record.detours[0]);
});

test('an exhausted safety budget changes nothing and says why', async () => {
  const candidate = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'route-repair-crossing.json'), 'utf8'));
  const started = Date.now();
  const result = await reduceCrossings({ cliPath, candidate, env: process.env, budgetMs: 0 });
  assert.equal(result.candidate, null);
  assert.equal(result.record.reason, 'time-limit');
  assert.equal(result.record.trials, 0);
  assert.ok(Date.now() - started < 2000);
});

test('crossings between authored relationships are not searched', async () => {
  const candidate = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'route-repair-crossing.json'), 'utf8'));
  for (const edge of candidate.connections) Object.assign(edge, { fromSide: 'right', toSide: 'left' });
  const crossings = [{ left: { id: candidate.connections[0].id }, right: { id: candidate.connections[1].id } }];
  const started = Date.now();
  const result = await reduceCrossings({ cliPath, candidate, env: process.env, crossings });
  assert.equal(result.candidate, null);
  assert.equal(result.record.reason, 'no-adjustable-relationship');
  assert.ok(Date.now() - started < 500, 'no trial is rendered');
});

test('a search that cannot finish inside the trial limit is not started', async () => {
  const candidate = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'route-repair-crossing.json'), 'utf8'));
  const automatic = candidate.connections.filter((edge) => !edge.fromSide && !edge.toSide && !edge.via).slice(0, 3);
  assert.equal(automatic.length, 3);
  const crossings = [{ left: { id: automatic[0].id }, right: { id: automatic[1].id } }, { left: { id: automatic[1].id }, right: { id: automatic[2].id } }];
  const result = await reduceCrossings({ cliPath, candidate, env: process.env, crossings, maxTrials: 32 });
  assert.equal(result.candidate, null);
  assert.equal(result.record.reason, 'search-too-large');
  assert.equal(result.record.adjustable, 3);
});

test('the same draft gets the same repair on every run', async () => {
  const candidate = JSON.parse(fs.readFileSync(path.join(root, 'fixtures', 'route-repair-crossing.json'), 'utf8'));
  const first = await reduceCrossings({ cliPath, candidate, env: process.env });
  const second = await reduceCrossings({ cliPath, candidate, env: process.env, workers: 1 });
  assert.ok(first.candidate);
  assert.deepEqual(second.candidate, first.candidate);
  assert.deepEqual(second.record.pinned, first.record.pinned);
  assert.equal(second.record.trials, first.record.trials);
});
