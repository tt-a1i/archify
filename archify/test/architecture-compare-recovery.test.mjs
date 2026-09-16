import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const base = path.join(skillRoot, 'examples/checkout-platform.base.architecture.json');
const head = path.join(skillRoot, 'examples/checkout-platform.head.architecture.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const cases = [
  { name: 'successful replacement cleans staging', failures: [] },
  { name: 'receipt commit failure restores the entire old pair', failures: ['commit-receipt'] },
  { name: 'HTML restore failure retains its old backup', failures: ['commit-receipt', 'restore-html'], retained: ['html'] },
  { name: 'receipt restore failure retains its old backup', failures: ['commit-receipt', 'restore-receipt'], retained: ['receipt'] },
  { name: 'both restore failures retain both old backups', failures: ['commit-receipt', 'restore-receipt', 'restore-html'], retained: ['html', 'receipt'] },
  { name: 'second backup failure restores the first target', failures: ['backup-receipt'] },
  { name: 'second backup and HTML restore failures retain only HTML', failures: ['backup-receipt', 'restore-html'], retained: ['html'] },
  { name: 'transient removal failure leaves no backup after successful restoration', failures: ['commit-receipt', 'remove-html'] },
];

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-compare-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const targets = { html: path.join(root, 'review.html'), receipt: path.join(root, 'review.receipt.json') };
  const run = (preload, newHead = head, json = true) => spawnSync(process.execPath, [
    ...(preload ? ['--require', preload] : []), cli, 'compare', 'architecture', base, newHead,
    targets.html, '--receipt', targets.receipt, ...(json ? ['--json'] : []),
  ], { cwd: skillRoot, encoding: 'utf8', timeout: 30000 });
  // Establish a genuinely valid old pair, distinct from the candidate revision.
  const initial = run(undefined, base);
  assert.ifError(initial.error);
  assert.equal(initial.status, 0, initial.stderr || initial.stdout);
  const old = Object.fromEntries(Object.entries(targets).map(([key, file]) => [key, fs.readFileSync(file)]));
  assert.equal(JSON.parse(old.receipt).artifact.sha256, hash(old.html));
  return { root, targets, old, run };
}

test('compare recovery: human diagnostics identify the retained backup and target', { timeout: 70000 }, (t) => {
  const data = fixture(t);
  const { preload } = inject(data, ['commit-receipt', 'restore-html']);
  const result = data.run(preload, head, false);
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout.trim(), '');
  const directories = fs.readdirSync(data.root).filter((name) => name.startsWith('.archify-compare-'));
  assert.equal(directories.length, 1);
  const recoveryDirectory = path.join(data.root, directories[0]);
  const backup = path.join(recoveryDirectory, '.previous-output');
  assert.ok(result.stderr.includes(recoveryDirectory));
  assert.ok(result.stderr.includes(JSON.stringify(backup)));
  assert.ok(result.stderr.includes(JSON.stringify(data.targets.html)));
  assert.deepEqual(fs.readFileSync(backup), data.old.html);
});

function inject(data, failures) {
  const preload = path.join(data.root, 'fail-compare-commit.cjs');
  const log = path.join(data.root, 'injected.jsonl');
  fs.writeFileSync(preload, `
    const fs = require('node:fs');
    const path = require('node:path');
    const root = ${JSON.stringify(data.root)};
    const targets = ${JSON.stringify(data.targets)};
    const wanted = new Set(${JSON.stringify(failures)});
    const fired = new Set();
    const rename = fs.renameSync;
    const remove = fs.rmSync;
    const inside = value => typeof value === 'string' && value.startsWith(root + path.sep);
    const staging = value => inside(value) && path.basename(path.dirname(value)).startsWith('.archify-compare-');
    function failOnce(action) {
      if (!wanted.has(action) || fired.has(action)) return;
      fired.add(action);
      fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(action) + '\\n');
      const error = new Error('injected ' + action);
      error.code = 'EACCES';
      throw error;
    }
    fs.renameSync = function(source, target) {
      if (inside(source) && inside(target)) {
        if (source === targets.receipt && staging(target)) failOnce('backup-receipt');
        if (staging(source) && target === targets.receipt && path.basename(source) === path.basename(target)) failOnce('commit-receipt');
        if (staging(source) && path.basename(source) === '.previous-output' && target === targets.html) failOnce('restore-html');
        if (staging(source) && path.basename(source) === '.previous-receipt' && target === targets.receipt) failOnce('restore-receipt');
      }
      return rename.apply(this, arguments);
    };
    fs.rmSync = function(target) {
      if (target === targets.html && fired.has('commit-receipt')) failOnce('remove-html');
      return remove.apply(this, arguments);
    };
  `);
  return { preload, log };
}

for (const scenario of cases) {
  test(`compare recovery: ${scenario.name}`, { timeout: 70000 }, (t) => {
    const data = fixture(t);
    const { preload, log } = inject(data, scenario.failures);
    const result = data.run(preload);
    assert.ifError(result.error);
    const observed = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
    assert.deepEqual(observed.sort(), [...scenario.failures].sort(), 'every requested fault must fire exactly once');
    const staging = fs.readdirSync(data.root).filter((name) => name.startsWith('.archify-compare-'));
    const response = JSON.parse(result.stdout);
    if (!scenario.failures.length) {
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(response.ok, true);
      const nextHtml = fs.readFileSync(data.targets.html);
      assert.notEqual(hash(nextHtml), hash(data.old.html));
      assert.equal(JSON.parse(fs.readFileSync(data.targets.receipt, 'utf8')).artifact.sha256, hash(nextHtml));
      assert.deepEqual(staging, []);
      return;
    }

    assert.notEqual(result.status, 0);
    assert.equal(response.ok, false);
    assert.equal(response.stage, 'commit');
    const retained = scenario.retained || [];
    const incompleteRollback = retained.length > 0 || scenario.failures.includes('remove-html');
    const diagnostic = response.diagnostics[0];
    assert.equal(diagnostic.code, incompleteRollback ? 'delta/commit-rollback-failed' : 'delta/commit-failed');
    const evidence = diagnostic.evidence;
    for (const key of ['html', 'receipt'].filter((key) => !retained.includes(key))) {
      const restored = fs.readFileSync(data.targets[key]);
      assert.deepEqual(restored, data.old[key], `${key} must be restored byte-for-byte`);
      assert.equal(hash(restored), hash(data.old[key]));
    }
    if (!retained.length) {
      assert.deepEqual(staging, [], 'clean up when no recovery material remains');
      assert.equal(evidence.recoveryDirectory, undefined);
      assert.deepEqual(evidence.recoveryFiles || [], []);
      return;
    }

    assert.equal(typeof evidence.recoveryDirectory, 'string', 'report the surviving recovery directory');
    assert.ok(path.isAbsolute(evidence.recoveryDirectory));
    assert.equal(path.dirname(evidence.recoveryDirectory), data.root);
    assert.deepEqual(staging, [path.basename(evidence.recoveryDirectory)]);
    assert.ok(response.error.includes(evidence.recoveryDirectory), 'human-readable error must identify recovery location');
    assert.ok(Array.isArray(evidence.recoveryFiles));
    assert.equal(evidence.recoveryFiles.length, retained.length);
    assert.deepEqual(evidence.recoveryFiles.map(({ target }) => target).sort(), retained.map((key) => data.targets[key]).sort());
    for (const { backup, target } of evidence.recoveryFiles) {
      assert.ok(path.isAbsolute(backup));
      assert.equal(path.dirname(backup), evidence.recoveryDirectory);
      const key = Object.keys(data.targets).find((key) => data.targets[key] === target);
      const saved = fs.readFileSync(backup);
      assert.deepEqual(saved, data.old[key], `${key} backup must remain recoverable byte-for-byte`);
      assert.equal(hash(saved), hash(data.old[key]));
      assert.equal(fs.existsSync(target), false, 'failed restoration must not be reported as a committed target');
    }
  });
}
