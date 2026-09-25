import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
// A real first draft whose only defects came from three hand-authored routes.
const fixture = path.join(skillRoot, 'test/fixtures/autoroute/hive-first-draft.architecture.json');
const ROUTING = ['via', 'route', 'fromSide', 'toSide', 'labelAt', 'labelDx', 'labelDy', 'labelSegment'];

function scratch(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-autoroute-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function run(cwd, ...args) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], { cwd, encoding: 'utf8' });
  return { status: result.status, receipt: JSON.parse(result.stdout) };
}

test('a routing-only composition failure offers a passing autoroute variant without touching the candidate', (t) => {
  const cwd = scratch(t);
  fs.copyFileSync(fixture, path.join(cwd, 'candidate.json'));
  const before = fs.readFileSync(path.join(cwd, 'candidate.json'), 'utf8');

  const failed = run(cwd, 'finalize', 'architecture', 'candidate.json', 'hive.html', '--quality', 'showcase');
  assert.notEqual(failed.status, 0);
  assert.equal(failed.receipt.failedStage, 'validate');
  assert.ok(failed.receipt.diagnostics.some((diagnostic) => diagnostic.code.startsWith('composition/')));
  const next = failed.receipt.nextAction;
  assert.equal(next.action, 'adopt-autoroute');
  assert.equal(next.then, 'finalize-once');
  assert.deepEqual(next.removedRouting.map((entry) => entry.index), [10, 11, 12]);
  assert.equal(fs.readFileSync(path.join(cwd, 'candidate.json'), 'utf8'), before, 'the candidate is never rewritten');

  const original = JSON.parse(before);
  const variant = JSON.parse(fs.readFileSync(next.candidate, 'utf8'));
  // Only the listed routing fields differ; nodes, labels and meaning are identical.
  const expected = JSON.parse(before);
  for (const entry of next.removedRouting) for (const field of entry.fields) delete expected.connections[entry.index][field];
  assert.deepEqual(variant, expected);
  assert.deepEqual(variant.components, original.components);
  assert.ok(variant.connections.every((connection) => ROUTING.every((field) => !Object.hasOwn(connection, field))));

  const validated = run(cwd, 'validate', 'architecture', next.candidate, '--quality', 'showcase');
  assert.equal(validated.status, 0);
  assert.equal(validated.receipt.composition.summary.errors, 0);
  assert.equal(validated.receipt.composition.summary.warnings, 0);
});

test('failures that routing cannot explain keep the ordinary edit-in-place repair', (t) => {
  const cwd = scratch(t);
  const document = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  document.components[0].colour = 'red';
  fs.writeFileSync(path.join(cwd, 'candidate.json'), JSON.stringify(document));
  const failed = run(cwd, 'finalize', 'architecture', 'candidate.json', 'hive.html', '--quality', 'showcase');
  assert.notEqual(failed.status, 0);
  assert.equal(failed.receipt.nextAction.action, 'edit-in-place');
  assert.equal(fs.existsSync(path.join(cwd, 'candidate.autoroute.json')), false);
});
