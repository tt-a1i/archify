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
import { startAnalysisView } from '../bin/serve.mjs';
import { withAnalysisOutput } from '../lib/output.mjs';

const check = fileURLToPath(new URL('../bin/check.mjs', import.meta.url));
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

function fingerprints(directory, names = fs.readdirSync(directory)) {
  return Object.fromEntries(names.sort().map(name => {
    const bytes = fs.readFileSync(path.join(directory, name));
    return [name, createHash('sha256').update(bytes).digest('hex')];
  }));
}

const ioError = () => Object.assign(new Error('injected analysis output error'), { code: 'EIO' });

async function startWorkbench(t, args) {
  const view = await startAnalysisView(args);
  t.after(() => new Promise(resolve => {
    view.server.close(resolve);
    view.server.closeAllConnections();
  }));
  return view;
}

async function expectTaskDiagnostic(view, status, code) {
  const response = await fetch(view.url + '/task', {
    method: 'POST',
    headers: { Origin: view.url, 'x-analysis-token': view.token },
    body: JSON.stringify({ ids: ['CMP-0001'] }),
  });
  const body = await response.json();
  assert.equal(response.status, status, JSON.stringify(body));
  assert.equal(body.diagnostics[0].code, code);
}

async function waitFor(file) {
  const deadline = Date.now() + 12000;
  while (!fs.existsSync(file)) {
    assert.ok(Date.now() < deadline, 'the analysis process did not reach the test boundary');
    await pause(15);
  }
}

test('a regular file at the lock path yields an output path conflict', async t => {
  const f = fixture(t);
  fs.mkdirSync(f.out);
  const lock = path.join(f.out, '.archify-analysis.lock');
  fs.writeFileSync(lock, 'keep this file');
  await assert.rejects(runCheck(f.args), error =>
    error.diagnostics?.[0]?.code === 'analysis/output-path-conflict' && error.diagnostics[0].subject.file === lock);
  assert.equal(fs.readFileSync(lock, 'utf8'), 'keep this file');
});

test('check rejects a directory at the automatic comparison path before reading it', async t => {
  const f = fixture(t);
  const findings = path.join(f.out, 'findings.json');
  fs.mkdirSync(findings, { recursive: true });
  const { readFileSync } = fs;
  let readFindings = false;
  fs.readFileSync = (file, ...args) => {
    if (file === findings) readFindings = true;
    return readFileSync(file, ...args);
  };
  try {
    await assert.rejects(runCheck(f.args), error =>
      error.diagnostics?.[0]?.code === 'analysis/output-path-conflict' && error.diagnostics[0].subject.file === findings);
  } finally {
    fs.readFileSync = readFileSync;
  }
  assert.equal(readFindings, false, 'check attempted to read the directory as a file');
  assert.deepEqual(fs.readdirSync(f.out), ['findings.json']);
});

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
    if (to === current && from !== previous) throw ioError();
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

test('a failed rollback still requires recovery while the workbench stays open', async t => {
  const f = fixture(t);
  const current = path.join(f.out, 'analysis'), previous = path.join(f.out, 'analysis.previous');
  const view = await startWorkbench(t, f.args);
  const refresh = async () => {
    const response = await fetch(view.url + '/analyze', {
      method: 'POST',
      headers: { Origin: view.url, 'x-analysis-token': view.token, 'x-analysis-refresh': '1' },
    });
    const body = await response.text();
    return { status: response.status, diagnostics: response.ok ? [] : JSON.parse(body).diagnostics };
  };
  assert.equal((await refresh()).status, 200);
  const older = fingerprints(current);
  fs.writeFileSync(path.join(f.root, 'a.ts'), 'export const a = 3;');
  assert.equal((await refresh()).status, 200);
  const lastGood = fingerprints(current);
  f.write(true);

  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    // Both publishing the staged report and restoring the current one fail.
    if (to === current) throw ioError();
    return rename(from, to);
  };
  let failed;
  try {
    failed = await refresh();
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(failed.status, 500);
  assert.equal(failed.diagnostics[0].code, 'analysis/output-recovery-required');

  const retry = await refresh();
  assert.equal(retry.status, 500);
  assert.equal(retry.diagnostics[0].code, 'analysis/output-recovery-required');
  const plan = retry.diagnostics[0].subject.plan;
  assert.equal(failed.diagnostics[0].subject.plan, plan);
  const separate = spawnSync(process.execPath, [prepare, ...f.args], { encoding: 'utf8', timeout: 12000 });
  assert.equal(separate.status, 2, separate.stdout + separate.stderr);
  const [diagnostic] = JSON.parse(separate.stdout).diagnostics;
  assert.equal(diagnostic.code, 'analysis/output-recovery-required');
  assert.equal(diagnostic.subject.plan, plan);
  assert.deepEqual(fingerprints(previous), lastGood);
  const backup = read(plan).find(([from]) => from === previous)?.[1];
  assert.ok(backup, 'the move plan identifies the backup of the older report');
  assert.deepEqual(fingerprints(backup), older);
  assert.equal(fs.existsSync(current), false);
});

test('a workbench retry requires recovery even when the rollback marker could not be written', async t => {
  const f = fixture(t);
  await prepareAnalysisView(f.args);
  const view = await startWorkbench(t, f.args);
  const current = path.join(f.out, 'analysis');
  const refresh = () => fetch(view.url + '/analyze', {
    method: 'POST',
    headers: { Origin: view.url, 'x-analysis-token': view.token, 'x-analysis-refresh': '1' },
  });
  const { renameSync, writeFileSync } = fs;
  fs.renameSync = (from, to) => {
    if (to === current) throw ioError();
    return renameSync(from, to);
  };
  fs.writeFileSync = (file, ...args) => {
    if (path.basename(file) === 'rollback-failed') throw Object.assign(new Error('no space for rollback marker'), { code: 'ENOSPC' });
    return writeFileSync(file, ...args);
  };
  try {
    const failed = await refresh();
    assert.equal(failed.status, 500);
    const [diagnostic] = (await failed.json()).diagnostics;
    assert.equal(diagnostic.code, 'analysis/output-recovery-required');
    assert.equal(diagnostic.evidence.recoveryMarkerError, 'no space for rollback marker');
    assert.ok(fs.existsSync(diagnostic.subject.plan));
  } finally {
    Object.assign(fs, { renameSync, writeFileSync });
  }
  const retry = await refresh();
  assert.equal(retry.status, 500);
  assert.equal((await retry.json()).diagnostics[0].code, 'analysis/output-recovery-required');
});

test('check owns the previous findings through publication and installs the new findings last', { timeout: 45000 }, async t => {
  const f = fixture(t);
  const args = [...f.args, '--new-only', '--json'];
  assert.equal((await runCheck(args)).exitCode, 0);
  const before = fingerprints(f.out);
  f.write(true);
  const hook = path.join(f.directory, 'hold-check.cjs');
  fs.writeFileSync(hook, `
    const fs = require('node:fs');
    const path = require('node:path');
    const directory = ${JSON.stringify(f.directory)};
    const out = ${JSON.stringify(f.out)};
    const { readFileSync, renameSync } = fs;
    function hold(event) {
      fs.writeFileSync(path.join(directory, event), '');
      const release = path.join(directory, event + '-release');
      const wait = new Int32Array(new SharedArrayBuffer(4));
      const deadline = Date.now() + 25000;
      while (!fs.existsSync(release) && Date.now() < deadline) Atomics.wait(wait, 0, 0, 15);
      if (!fs.existsSync(release)) throw new Error('Timed out after ' + event);
    }
    fs.readFileSync = (file, ...args) => {
      const bytes = readFileSync(file, ...args);
      if (file === path.join(out, 'findings.json')) hold('compared');
      return bytes;
    };
    fs.renameSync = (from, to) => {
      if (to === path.join(out, 'overview.json') && path.basename(path.dirname(from)) === 'next') {
        hold('before-overview');
      }
      return renameSync(from, to);
    };
  `);
  const release = event => fs.writeFileSync(path.join(f.directory, event + '-release'), '');
  const first = new Promise(resolve => {
    execFile(process.execPath, ['--require', hook, check, ...args], { encoding: 'utf8', timeout: 40000 },
      (error, stdout, stderr) => resolve({ error, stdout, stderr }));
  });
  const checkAgain = () => spawnSync(process.execPath, [check, ...args], { encoding: 'utf8', timeout: 12000 });
  try {
    await waitFor(path.join(f.directory, 'compared'));
    const second = checkAgain();
    assert.equal(second.status, 2, second.stdout + second.stderr);
    assert.equal(JSON.parse(second.stdout).diagnostics[0].code, 'analysis/output-busy');
    assert.deepEqual(fingerprints(f.out, Object.keys(before)), before);
    release('compared');
    await waitFor(path.join(f.directory, 'before-overview'));
    assert.deepEqual(fingerprints(f.out, ['findings.json']), { 'findings.json': before['findings.json'] });
  } finally {
    release('compared');
    release('before-overview');
    await first;
  }
  const completed = await first;
  assert.equal(completed.error?.code, 1, completed.stdout + completed.stderr);
  assert.ok(JSON.parse(completed.stdout).gate.failing.some(finding => finding.code === 'coupling/import-cycle'));
  const retry = checkAgain();
  assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  assert.deepEqual(JSON.parse(retry.stdout).gate.failing, []);
});

test('Linux reclaims a reused PID only when process and clock identities can be compared', {
  skip: process.platform !== 'linux',
}, async t => {
  const f = fixture(t);
  const { readFileSync, statSync } = fs;
  const kill = process.kill;
  let boot = '00000000-0000-0000-0000-000000000001';
  let pidNamespace = 123n;
  let timeNamespace = 456n;
  let procPids = String(process.pid);
  let started = '100';
  let visible = true;
  // Emulate distinct Linux process views without requiring namespace privileges in CI.
  fs.statSync = (file, ...args) => {
    if (file === '/proc/self/ns/pid') return { dev: 1n, ino: pidNamespace };
    if (file === '/proc/self/ns/time') return { dev: 1n, ino: timeNamespace };
    return statSync(file, ...args);
  };
  fs.readFileSync = (file, ...args) => {
    if (file === '/proc/sys/kernel/random/boot_id') return boot + '\n';
    if (file === '/proc/self/status') return `NStgid:\t${procPids}\n`;
    if (file === '/proc/self/stat' || file === '/proc/' + process.pid + '/stat') {
      return process.pid + ' (node) worker) S ' + '0 '.repeat(18) + started + ' 0\n';
    }
    return readFileSync(file, ...args);
  };
  process.kill = (pid, signal) => {
    if (pid !== process.pid || signal !== 0) return kill(pid, signal);
    if (!visible) throw Object.assign(new Error('not visible in this namespace'), { code: 'ESRCH' });
    return true;
  };
  try {
    let original;
    await withAnalysisOutput(f.out, workspace => { original = workspace; });
    fs.mkdirSync(original, { recursive: true });
    const staged = path.join(original, 'staged.json');
    fs.writeFileSync(staged, 'previous staging');
    const expectBusy = async () => {
      await assert.rejects(withAnalysisOutput(f.out, () => assert.fail('a foreign writer took the lock')),
        error => error.diagnostics?.[0]?.code === 'analysis/output-busy');
      assert.equal(fs.readFileSync(staged, 'utf8'), 'previous staging');
    };

    pidNamespace = 124n;
    visible = false;
    await expectBusy();

    pidNamespace = 123n;
    boot = '00000000-0000-0000-0000-000000000002';
    await expectBusy();

    boot = '00000000-0000-0000-0000-000000000001';
    timeNamespace = 457n;
    visible = true;
    started = '200';
    await expectBusy();

    timeNamespace = 456n;
    procPids = `42\t${process.pid}`;
    await expectBusy();

    procPids = String(process.pid);
    await withAnalysisOutput(f.out, workspace => {
      assert.notEqual(workspace, original);
      assert.equal(fs.existsSync(original), false);
      assert.deepEqual(fs.readdirSync(workspace), []);
    });
  } finally {
    Object.assign(fs, { readFileSync, statSync });
    process.kill = kill;
  }
});

test('a second prepare process cannot publish into an output directory in use', { timeout: 45000 }, async t => {
  const f = fixture(t);
  await prepareAnalysisView(f.args);
  const view = await startWorkbench(t, f.args);
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
    await expectTaskDiagnostic(view, 409, 'analysis/output-busy');
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

test('a retry discards the staged report of a process stopped before publication', { timeout: 30000 }, async t => {
  const f = fixture(t);
  await prepareAnalysisView(f.args);
  const current = path.join(f.out, 'analysis');
  const original = fingerprints(current);
  f.write(true);
  const ready = path.join(f.directory, 'ready');
  const hook = path.join(f.directory, 'hold-staged-report.cjs');
  fs.writeFileSync(hook, `
    const fs = require('node:fs');
    const path = require('node:path');
    const read = fs.readFileSync;
    fs.readFileSync = (file, ...args) => {
      const value = read(file, ...args);
      if (typeof file === 'string' && path.basename(file) === 'repo.analysis.html'
          && path.dirname(file) !== ${JSON.stringify(current)}) {
        fs.writeFileSync(${JSON.stringify(ready)}, path.dirname(file));
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15000);
        throw new Error('Timed out waiting for the test to stop publication');
      }
      return value;
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
  const abandoned = fs.readFileSync(ready, 'utf8');
  assert.ok(fs.existsSync(path.join(abandoned, 'findings.json')), 'the stopped run produced a staged report');
  assert.deepEqual(fingerprints(current), original);
  const unrelated = 'analysis.next-000000000000';
  fs.mkdirSync(path.join(f.out, unrelated));
  fs.writeFileSync(path.join(f.out, unrelated, 'note.txt'), 'keep');

  const { rmSync } = fs;
  const lock = path.dirname(path.dirname(abandoned));
  fs.rmSync = (target, ...args) => {
    // Emulate staging with contents that remain undeletable until permissions are repaired.
    if (path.dirname(target) === lock || path.dirname(path.dirname(target)) === lock) {
      throw Object.assign(new Error('cannot remove abandoned staging'), { code: 'EACCES' });
    }
    return rmSync(target, ...args);
  };
  try {
    await assert.rejects(prepareAnalysisView(f.args), { code: 'EACCES' });
  } finally {
    fs.rmSync = rmSync;
  }

  await prepareAnalysisView(f.args);
  assert.equal(fs.existsSync(abandoned), false);
  assert.deepEqual(fingerprints(path.join(f.out, 'analysis.previous')), original);
  assert.ok(read(path.join(current, 'review.json')).comparison.new.length > 0);

  // A worker that starts after its owner is reclaimed must not recreate the lock.
  const worker = fileURLToPath(new URL('../bin/analyze-run.mjs', import.meta.url));
  const orphan = spawnSync(process.execPath, [worker], {
    input: JSON.stringify({ root: f.root, language: 'ts', out: abandoned }), encoding: 'utf8', timeout: 12000,
  });
  assert.equal(orphan.status, 1, orphan.stdout + orphan.stderr);
  assert.deepEqual(fs.readdirSync(f.out).sort(), ['analysis', unrelated, 'analysis.previous']);
  assert.equal(fs.readFileSync(path.join(f.out, unrelated, 'note.txt'), 'utf8'), 'keep');
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
  const view = await startWorkbench(t, f.args);

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

  await expectTaskDiagnostic(view, 500, 'analysis/output-recovery-required');
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

test('an empty output lock cannot be reclaimed during another claim', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.out, '.archify-analysis.lock'), { recursive: true });
  await assert.rejects(withAnalysisOutput(f.out, () => assert.fail('entered an unowned lock')),
    error => error.diagnostics?.[0]?.code === 'analysis/output-busy');
  assert.deepEqual(fs.readdirSync(path.join(f.out, '.archify-analysis.lock')), []);
});
