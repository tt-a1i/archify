import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { recordedBrowserEvidence, retirePreviousBrowserEvidence } from '../bin/finalize.mjs';

test('finalize retires only the browser-check receipt its previous run recorded', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-finalize-rerun-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'diagram.html');
  const receipt = path.join(dir, 'diagram.browser-check.json');
  const recorded = { command: 'browser-check', artifact: { sha256: 'a'.repeat(64) } };

  fs.writeFileSync(receipt, JSON.stringify({ ...recorded, extra: true }));
  assert.equal(retirePreviousBrowserEvidence(recorded, output), false, 'a different receipt stays');
  assert.ok(fs.existsSync(receipt));
  assert.equal(retirePreviousBrowserEvidence(null, output), false, 'no previous finalize record');

  fs.writeFileSync(receipt, JSON.stringify(recorded, null, 2));
  assert.equal(retirePreviousBrowserEvidence(recorded, output), true);
  assert.ok(!fs.existsSync(receipt));
});

test('browser evidence ownership survives finalize runs that fail before browser-check', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-finalize-retained-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'diagram.html');
  const finalizeReceipt = path.join(dir, 'diagram.finalize.json');
  const recorded = { command: 'browser-check', artifact: { sha256: 'b'.repeat(64) } };
  fs.writeFileSync(path.join(dir, 'diagram.browser-check.json'), JSON.stringify(recorded));
  // A failed validate run keeps no browser-check stage but retains the record.
  fs.writeFileSync(finalizeReceipt, JSON.stringify({ stages: { validate: { status: 'fail' } }, retainedBrowserEvidence: recorded }));
  assert.deepEqual(recordedBrowserEvidence(finalizeReceipt, output), recorded);
  fs.writeFileSync(finalizeReceipt, JSON.stringify({ stages: {} }));
  assert.equal(recordedBrowserEvidence(finalizeReceipt, output), null);
  // A malformed sidecar is not owned evidence; it must not abort finalize.
  fs.writeFileSync(finalizeReceipt, JSON.stringify({ retainedBrowserEvidence: recorded }));
  fs.writeFileSync(path.join(dir, 'diagram.browser-check.json'), '{not json');
  assert.equal(recordedBrowserEvidence(finalizeReceipt, output), null);
});

test('a failed candidate replacement leaves the previous candidate complete', async (t) => {
  const { replaceCandidate } = await import('../bin/finalize.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-replace-candidate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const candidate = path.join(dir, 'candidate.json');
  const original = '{"components":[{"id":"a","pos":[40,40]}]}\n';
  fs.writeFileSync(candidate, original);
  const next = '{"components":[{"id":"a","pos":[20,40]}]}\n';

  // The write stops half way through.
  const partialWrite = (file, bytes) => {
    fs.writeFileSync(file, bytes.subarray(0, 10));
    throw new Error('disk full');
  };
  assert.throws(() => replaceCandidate(candidate, next, { writeFile: partialWrite }), /disk full/);
  assert.equal(fs.readFileSync(candidate, 'utf8'), original);

  // The staged bytes do not match what was prepared.
  const truncatedWrite = (file, bytes) => fs.writeFileSync(file, bytes.subarray(0, 10));
  assert.throws(() => replaceCandidate(candidate, next, { writeFile: truncatedWrite }), /does not match/);
  assert.equal(fs.readFileSync(candidate, 'utf8'), original);

  // The final rename fails.
  assert.throws(() => replaceCandidate(candidate, next, { rename: () => { throw new Error('locked'); } }), /locked/);
  assert.equal(fs.readFileSync(candidate, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(dir), ['candidate.json'], 'no staged file is left behind');

  replaceCandidate(candidate, next);
  assert.equal(fs.readFileSync(candidate, 'utf8'), next);
  assert.deepEqual(fs.readdirSync(dir), ['candidate.json']);
});

test('a candidate replacement keeps the candidate private', { skip: process.platform === 'win32' && 'POSIX file modes' }, async (t) => {
  const { replaceCandidate } = await import('../bin/finalize.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-replace-mode-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const candidate = path.join(dir, 'candidate.json');
  fs.writeFileSync(candidate, '{}\n', { mode: 0o600 });
  fs.chmodSync(candidate, 0o600);
  replaceCandidate(candidate, '{"a":1}\n');
  assert.equal(fs.statSync(candidate).mode & 0o777, 0o600);
});
