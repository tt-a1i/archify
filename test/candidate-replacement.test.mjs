import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
test('a failed candidate replacement leaves the previous candidate complete', async (t) => {
  const { replaceCandidate } = await import('../archify/bin/finalize.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-replace-candidate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const candidate = path.join(dir, 'candidate.json');
  const original = '{"components":[{"id":"a","pos":[40,40]}]}\n';
  fs.writeFileSync(candidate, original);
  const next = '{"components":[{"id":"a","pos":[20,40]}]}\n';
  const partialWrite = (file, bytes) => {
    fs.writeFileSync(file, bytes.subarray(0, 10));
    throw new Error('disk full');
  };
  assert.throws(() => replaceCandidate(candidate, next, { writeFile: partialWrite }), /disk full/);
  assert.equal(fs.readFileSync(candidate, 'utf8'), original);
  const truncatedWrite = (file, bytes) => fs.writeFileSync(file, bytes.subarray(0, 10));
  assert.throws(() => replaceCandidate(candidate, next, { writeFile: truncatedWrite }), /does not match/);
  assert.equal(fs.readFileSync(candidate, 'utf8'), original);
  assert.throws(() => replaceCandidate(candidate, next, { rename: () => { throw new Error('locked'); } }), /locked/);
  assert.equal(fs.readFileSync(candidate, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(dir), ['candidate.json'], 'no staged file is left behind');
  replaceCandidate(candidate, next);
  assert.equal(fs.readFileSync(candidate, 'utf8'), next);
});

test('a candidate replacement keeps the candidate private', { skip: process.platform === 'win32' && 'POSIX file modes' }, async (t) => {
  const { replaceCandidate } = await import('../archify/bin/finalize.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-replace-mode-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const candidate = path.join(dir, 'candidate.json');
  fs.writeFileSync(candidate, '{}\n', { mode: 0o600 });
  fs.chmodSync(candidate, 0o600);
  replaceCandidate(candidate, '{"a":1}\n');
  assert.equal(fs.statSync(candidate).mode & 0o777, 0o600);
});
