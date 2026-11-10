// A real CLI handoff: accept a baseline, export both ranges, preserve harmless
// moves, change the implementation with equivalent results, then re-analyze.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

const BINARY = process.env.ARCHIFY_TEST_JSCPD;
const CLI = fileURLToPath(new URL('../../../bin/archify.mjs', import.meta.url));
const CODE = 'redundancy/duplicate-block';
const ORIGINAL = `export function summarize(values, floor) {
  let total = 0;
  let accepted = 0;
  for (const value of values) {
    if (value > floor) {
      total += value;
      accepted += 1;
    } else {
      total -= floor;
    }
  }
  if (accepted === 0) return -1;
  const average = Math.floor(total / accepted);
  if (average > 100) return 100;
  return average;
}
`;
const REFACTORED = `export function summarize(values, floor) {
  const selected = values.filter(value => value > floor);
  const rejectedCount = values.length - selected.length;
  if (selected.length === 0) return -1;
  const positiveTotal = selected.reduce((sum, value) => sum + value, 0);
  const adjustedTotal = positiveTotal - rejectedCount * floor;
  const quotient = Math.floor(adjustedTotal / selected.length);
  const ceiling = 100;
  return Math.min(quotient, ceiling);
}
`;

test('duplicates: real CLI baseline, task evidence and comparable re-analysis form one handoff', {
  skip: !BINARY && 'set ARCHIFY_TEST_JSCPD to a real jscpd 5.4.3 executable',
}, async t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-c6-workflow-'));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, 'source');
  fs.mkdirSync(root);
  for (const file of ['original.mjs', 'copy.mjs']) fs.writeFileSync(path.join(root, file), ORIGINAL);
  const config = path.join(temporary, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ duplicates: { enabled: true, executable: path.resolve(BINARY) } }));
  const before = path.join(temporary, 'before');
  const after = path.join(temporary, 'after');
  const baseline = path.join(temporary, 'baseline.json');
  const taskFile = path.join(temporary, 'task.json');
  const run = (args, status) => {
    const result = spawnSync(process.execPath, [CLI, 'code-analysis', ...args], { encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, status, result.stderr + result.stdout);
    return JSON.parse(result.stdout);
  };
  const check = ['check', root, '--language', 'ts', '--config', config, '--json'];
  const initial = run([...check, '--out', before], 1);
  assert.equal(initial.duplicates.coverage.complete, true);
  const findings = JSON.parse(fs.readFileSync(path.join(before, 'findings.json')));
  const duplicate = findings.diagnostics.find(d => d.code === CODE);
  assert(duplicate);
  run([...check, '--baseline', baseline, '--update-baseline', '--reason', 'Existing repetition under review'], 0);
  const accepted = run([...check, '--baseline', baseline], 0);
  assert.equal(accepted.review.baseline.accepted, 1);
  const exported = run(['task', before, '--finding', duplicate.id, '--root', root, '--format', 'json', '--out', taskFile, '--require-valid', '--json'], 0);
  assert.equal(exported.evidence, 'valid');
  const task = JSON.parse(fs.readFileSync(taskFile));
  assert.deepEqual(task.scope.modify, ['copy.mjs', 'original.mjs']);
  assert.equal(task.locations.length, 2);
  for (const loc of task.locations) {
    assert(Number.isInteger(loc.startColumn) && Number.isInteger(loc.endOffset));
  }
  for (const file of ['original.mjs', 'copy.mjs']) fs.writeFileSync(path.join(root, file), '// unrelated preface\n\n' + ORIGINAL);
  assert.equal(run(['task', '--verify', taskFile, '--root', root, '--format', 'json', '--require-valid', '--json'], 0).evidence, 'valid');
  const reference = await import(pathToFileURL(path.join(root, 'original.mjs')).href);
  fs.writeFileSync(path.join(root, 'copy.mjs'), REFACTORED);
  const replacement = await import(pathToFileURL(path.join(root, 'copy.mjs')).href);
  for (const values of [[], [-5], [0], [3, 9, -2], [1000, 2000], [-8, 0, 8, 9], [1, 1, 1, 1]]) {
    for (const floor of [-10, -1, 0, 3, 10, 100]) assert.equal(replacement.summarize(values, floor), reference.summarize(values, floor));
  }
  assert.equal(run(['task', '--verify', taskFile, '--root', root, '--format', 'json', '--require-valid', '--json'], 1).evidence, 'changed');
  const rerun = run([...check, '--out', after, '--compare', path.join(before, 'findings.json')], 0);
  assert.equal(rerun.duplicates.coverage.complete, true);
  assert.equal(rerun.review.comparison.comparable, true);
  const review = JSON.parse(fs.readFileSync(path.join(after, 'review.json')));
  assert(review.comparison.notDetected.some(d => d.id === duplicate.id));
  assert(!JSON.parse(fs.readFileSync(path.join(after, 'findings.json'))).diagnostics.some(d => d.code === CODE));
  fs.writeFileSync(config, JSON.stringify({ duplicates: { enabled: true, executable: path.resolve(BINARY), identifiers: 'consistent' } }));
  const differentPolicy = run([...check, '--compare', path.join(after, 'findings.json'), '--fail-on', 'never'], 0);
  assert.equal(differentPolicy.review.comparison.comparable, false);
  assert(differentPolicy.comparisonReasons.some(r => r.code === 'duplicates-settings-changed'));
});
