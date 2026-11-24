import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as pause } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { runCheck } from '../bin/check.mjs';
import { prepareAnalysisView } from '../bin/prepare.mjs';

const prepare = fileURLToPath(new URL('../bin/prepare.mjs', import.meta.url));
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-recovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'repo'), out = path.join(directory, 'out');
  fs.mkdirSync(root);
  const write = (cycle = false) => {
    fs.writeFileSync(path.join(root, 'a.ts'), cycle ? "import { b } from './b'; export const a = b;" : 'export const a = 1;');
    fs.writeFileSync(path.join(root, 'b.ts'), cycle ? "import { a } from './a'; export const b = a;" : 'export const b = 2;');
  };
  write();
  return { directory, root, out, write, args: [root, '--out', out, '--language', 'ts'] };
}

function fingerprints(directory) {
  return Object.fromEntries(fs.readdirSync(directory).sort().map(name => {
    const bytes = fs.readFileSync(path.join(directory, name));
    return [name, createHash('sha256').update(bytes).digest('hex')];
  }));
}

const ioError = () => Object.assign(new Error('injected analysis output error'), { code: 'EIO' });

async function waitFor(file) {
  const deadline = Date.now() + 12000;
  while (!fs.existsSync(file)) {
    assert.ok(Date.now() < deadline, 'the analysis process did not reach the test boundary');
    await pause(15);
  }
}

test('a failed check publication keeps the previous reports and fails the gate on retry', async t => {
  const f = fixture(t);
  const run = (...args) => runCheck([...f.args, '--new-only', ...args]);
  assert.equal((await run()).exitCode, 0);
  const comparison = path.join(f.directory, 'explicit-previous.json');
  fs.copyFileSync(path.join(f.out, 'findings.json'), comparison);
  fs.writeFileSync(path.join(f.out, 'user-note.txt'), 'keep this file');
  const before = fingerprints(f.out);
  f.write(true);

  const overview = path.join(f.out, 'overview.json');
  const { renameSync, writeFileSync } = fs;
  fs.renameSync = (from, to) => {
    if (to === overview && path.basename(path.dirname(from)) === 'next') throw ioError();
    return renameSync(from, to);
  };
  fs.writeFileSync = (target, ...args) => {
    // Also exercises the old in-place writer at the equivalent boundary.
    if (target === overview) throw ioError();
    return writeFileSync(target, ...args);
  };
  try {
    await assert.rejects(run(), { code: 'EIO' });
  } finally {
    Object.assign(fs, { renameSync, writeFileSync });
  }
  assert.deepEqual(fingerprints(f.out), before);

  const retry = await run();
  assert.equal(retry.exitCode, 1);
  assert.ok(retry.receipt.gate.failing.some(finding => finding.code === 'coupling/import-cycle'));
  assert.equal((await run()).exitCode, 0, 'the complete gate-failing run becomes the next comparison');
  assert.equal((await run('--compare', comparison)).exitCode, 1);
  assert.equal(fs.readFileSync(path.join(f.out, 'user-note.txt'), 'utf8'), 'keep this file');
});

test('a failed prepare publication restores both reports and compares with the last complete run on retry', async t => {
  const f = fixture(t);
  const current = path.join(f.out, 'analysis'), previous = path.join(f.out, 'analysis.previous');
  await prepareAnalysisView(f.args);
  const first = fingerprints(current);
  fs.writeFileSync(path.join(f.root, 'a.ts'), 'export const a = 3;');
  await prepareAnalysisView(f.args);
  const lastGood = fingerprints(current);
  assert.deepEqual(fingerprints(previous), first);
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (to === current && path.basename(from).startsWith('analysis.next-')) throw ioError();
    return rename(from, to);
  };
  f.write(true);
  try {
    await assert.rejects(prepareAnalysisView(f.args), { code: 'EIO' });
  } finally {
    fs.renameSync = rename;
  }
  assert.deepEqual(fingerprints(current), lastGood);
  assert.deepEqual(fingerprints(previous), first);
  assert.deepEqual(fs.readdirSync(f.out).sort(), ['analysis', 'analysis.previous']);

  await prepareAnalysisView(f.args);
  assert.deepEqual(fingerprints(previous), lastGood);
  assert.ok(read(path.join(current, 'review.json')).comparison.new.length > 0);
});

test('a second prepare process cannot publish into an output directory in use', { timeout: 45000 }, async t => {
  const f = fixture(t);
  await prepareAnalysisView(f.args);
  f.write(true);
  const current = path.join(f.out, 'analysis');
  const original = fingerprints(current);
  const ready = path.join(f.directory, 'ready'), release = path.join(f.directory, 'release');
  const hook = path.join(f.directory, 'hold-publication.cjs');
  fs.writeFileSync(hook, `
    const fs = require('node:fs');
    const { current, ready, release } = JSON.parse(process.env.ARCHIFY_TEST_PUBLICATION);
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      if (from === current) {
        fs.writeFileSync(ready, '');
        const wait = new Int32Array(new SharedArrayBuffer(4));
        const deadline = Date.now() + 25000;
        while (!fs.existsSync(release) && Date.now() < deadline) Atomics.wait(wait, 0, 0, 15);
        if (!fs.existsSync(release)) throw new Error('Timed out waiting to publish');
      }
      return rename(from, to);
    };
  `);
  const first = new Promise(resolve => {
    execFile(process.execPath, ['--require', hook, prepare, ...f.args], {
      encoding: 'utf8', timeout: 40000, env: { ...process.env, ARCHIFY_TEST_PUBLICATION: JSON.stringify({ current, ready, release }) },
    }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
  });
  try {
    await waitFor(ready);
    const second = spawnSync(process.execPath, [prepare, ...f.args], { encoding: 'utf8', timeout: 12000 });
    assert.equal(second.status, 2, second.stdout + second.stderr);
    assert.equal(JSON.parse(second.stdout).diagnostics[0].code, 'analysis/output-busy');
    assert.deepEqual(fingerprints(current), original);
  } finally {
    fs.writeFileSync(release, '');
    await first;
  }
  const done = await first;
  assert.ifError(done.error);
  assert.deepEqual(fingerprints(path.join(f.out, 'analysis.previous')), original);
  assert.ok(read(path.join(current, 'review.json')).comparison.new.length > 0);

  await prepareAnalysisView(f.args);
  assert.deepEqual(read(path.join(current, 'review.json')).comparison.new, []);
});

test('an analysis stopped before publication does not prevent a retry', { timeout: 30000 }, async t => {
  const f = fixture(t);
  await prepareAnalysisView(f.args);
  const current = path.join(f.out, 'analysis');
  const original = fingerprints(current);
  const ready = path.join(f.directory, 'ready');
  const output = new URL('../lib/output.mjs', import.meta.url).href;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', `
    import fs from 'node:fs';
    import { withAnalysisOutput } from ${JSON.stringify(output)};
    await withAnalysisOutput(${JSON.stringify(f.out)}, () => {
      fs.writeFileSync(${JSON.stringify(ready)}, '');
      return new Promise(() => setInterval(() => {}, 1000));
    });
  `], { stdio: 'ignore' });
  const closed = once(child, 'close');
  try {
    await waitFor(ready);
  } finally {
    child.kill();
    await closed;
  }
  assert.deepEqual(fingerprints(current), original);

  f.write(true);
  await prepareAnalysisView(f.args);
  assert.deepEqual(fingerprints(path.join(f.out, 'analysis.previous')), original);
  assert.ok(read(path.join(current, 'review.json')).comparison.new.length > 0);
  assert.deepEqual(fs.readdirSync(f.out).sort(), ['analysis', 'analysis.previous']);
});

test('a prepare process killed during publication leaves both previous reports for recovery', { timeout: 30000 }, async t => {
  const f = fixture(t);
  const current = path.join(f.out, 'analysis'), previous = path.join(f.out, 'analysis.previous');
  await prepareAnalysisView(f.args);
  const first = fingerprints(current);
  fs.writeFileSync(path.join(f.root, 'a.ts'), 'export const a = 3;');
  await prepareAnalysisView(f.args);
  const lastGood = fingerprints(current);
  f.write(true);

  const ready = path.join(f.directory, 'ready');
  const hook = path.join(f.directory, 'stop-publication.cjs');
  fs.writeFileSync(hook, `
    const fs = require('node:fs');
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => {
      rename(from, to);
      if (from === ${JSON.stringify(current)}) {
        fs.writeFileSync(${JSON.stringify(ready)}, '');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25000);
        throw new Error('Timed out waiting for the test to stop publication');
      }
    };
  `);
  const child = spawn(process.execPath, ['--require', hook, prepare, ...f.args], { stdio: 'ignore' });
  const closed = once(child, 'close');
  try {
    await waitFor(ready);
  } finally {
    child.kill('SIGKILL');
    await closed;
  }

  const retry = spawnSync(process.execPath, [prepare, ...f.args], { encoding: 'utf8', timeout: 12000 });
  assert.equal(retry.status, 2, retry.stdout + retry.stderr);
  const [diagnostic] = JSON.parse(retry.stdout).diagnostics;
  assert.equal(diagnostic.code, 'analysis/output-recovery-required');
  const backupMove = read(diagnostic.subject.plan).find(([from]) => from === previous);
  assert.ok(backupMove, 'the move plan identifies the backup of the older report');
  assert.deepEqual(fingerprints(backupMove[1]), first);
  assert.deepEqual(fingerprints(previous), lastGood);
  assert.equal(fs.existsSync(current), false, 'the retry did not publish over the interrupted state');
});
