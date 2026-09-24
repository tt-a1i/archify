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
