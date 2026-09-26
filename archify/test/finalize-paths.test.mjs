import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultFinalizeReceiptPath, defaultFinalizeSummaryPath, runFinalize } from '../bin/finalize.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const example = path.join(skillRoot, 'examples/web-app.architecture.json');
function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-finalize-paths-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function finalize(output, options = []) {
  const result = spawnSync(process.execPath, [cli, 'finalize', 'architecture', example, output, '--quality', 'showcase', '--json', ...options], {
    cwd: skillRoot, encoding: 'utf8', env: { ...process.env, ARCHIFY_CHROME: path.join(os.tmpdir(), 'archify-definitely-missing-chrome') },
  });
  return { ...result, receipt: JSON.parse(result.stdout) };
}

test('finalize uses bounded canonical delivery and evidence names for long output components', t => {
  const dir = workspace(t);
  const output = path.join(dir, `${'审'.repeat(78)}.html`);
  const result = finalize(output);
  assert.equal(result.status, 2, result.stdout || result.stderr);
  assert.deepEqual(result.receipt.gates, { validate: 'pass', deliver: 'pass', check: 'pass', 'browser-check': 'skipped' });
  assert.equal(result.receipt.visualReview, 'not-requested');
  for (const entry of fs.readdirSync(dir)) assert.ok(Buffer.byteLength(entry) <= 255, entry);
  assert.ok(fs.existsSync(result.receipt.evidence.receipt));
  assert.ok(fs.existsSync(result.receipt.evidence.summaryReceipt));
  assert.ok(fs.existsSync(result.receipt.evidence.browserCheckReceipt));
  assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.png')), false);
  const retry = finalize(output);
  assert.equal(retry.status, 2, retry.stdout || retry.stderr);
  assert.equal(retry.receipt.evidence.receipt, result.receipt.evidence.receipt);
});

test('finalize receipt paths cannot replace a delivery journal or directory lock', t => {
  const dir = workspace(t);
  const output = path.join(dir, 'diagram.html');
  for (const name of ['diagram.delivery.json', 'diagram.delivery-pending.json', 'diagram.delivery-lock.json', '.archify-delivery-lock.json']) {
    const receiptPath = path.join(dir, name);
    const result = finalize(output, ['--receipt', receiptPath]);
    assert.equal(result.status, 1, name);
    assert.match(result.receipt.diagnostics[0].message, /distinct/);
    assert.equal(fs.existsSync(receiptPath), false);
    assert.equal(fs.existsSync(output), false);
  }
});

test('finalize checks both receipt targets before writing and preserves hardlinked files', async t => {
  const dir = workspace(t);
  const output = path.join(dir, 'diagram.html');
  const receiptPath = defaultFinalizeReceiptPath(output);
  const summaryPath = defaultFinalizeSummaryPath(receiptPath);
  const source = path.join(dir, 'source.json');
  fs.writeFileSync(source, 'sentinel');
  fs.linkSync(source, summaryPath);
  await assert.rejects(runFinalize({ cliPath: cli, type: 'architecture', input: example, output }), /hardlinked/);
  assert.equal(fs.existsSync(receiptPath), false);
  assert.equal(fs.existsSync(output), false);
  assert.equal(fs.readFileSync(source, 'utf8'), 'sentinel');
  assert.equal(fs.readFileSync(summaryPath, 'utf8'), 'sentinel');
});

test('finalize preserves a receipt claimant that replaces a captured target during a gate', async t => {
  const dir = workspace(t);
  const output = path.join(dir, 'diagram.html');
  const receiptPath = defaultFinalizeReceiptPath(output);
  const summaryPath = defaultFinalizeSummaryPath(receiptPath);
  const claimant = path.join(dir, 'claimant.json');
  fs.writeFileSync(claimant, 'external claimant');
  await assert.rejects(runFinalize({
    cliPath: cli, type: 'architecture', input: example, output,
    runCommand: () => {
      fs.renameSync(claimant, summaryPath);
      return { status: 1, stdout: JSON.stringify({ ok: false, command: 'deliver', stage: 'render', diagnostics: [] }) };
    },
  }), /requested-entry-changed/);
  assert.equal(fs.readFileSync(summaryPath, 'utf8'), 'external claimant');
  assert.equal(fs.existsSync(output), false);
  assert.equal(JSON.parse(fs.readFileSync(receiptPath)).status, 'running');
});

test('finalize preserves its existing receipt permissions on repeat publication', async t => {
  const dir = workspace(t);
  const output = path.join(dir, 'diagram.html');
  const receiptPath = defaultFinalizeReceiptPath(output);
  fs.writeFileSync(receiptPath, '{}', { mode: 0o600 });
  const beforeMode = fs.statSync(receiptPath).mode & 0o777;
  const result = await runFinalize({
    cliPath: cli, type: 'architecture', input: example, output,
    runCommand: () => ({ status: 1, stdout: JSON.stringify({ ok: false, command: 'deliver', stage: 'render', diagnostics: [] }) }),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(fs.statSync(receiptPath).mode & 0o777, beforeMode);
});
