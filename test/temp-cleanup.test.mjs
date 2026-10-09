import { test } from 'node:test';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createOwnedTempDirectory } from '../archify/renderers/shared/owned-temp-directory.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ChromeVisualBrowser } from '../archify/bin/visual-check.mjs';

function browserWithChild(kill) {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.stderr = new PassThrough();
  child.stdio = [null, null, child.stderr, new PassThrough(), new PassThrough()];
  child.kill = signal => kill(child, signal);
  const browser = new ChromeVisualBrowser('/fake/chrome', {
    spawnImpl: () => child,
    shutdownTimeoutMs: 20,
  });
  browser.sessionPromise.catch(() => {});
  return browser;
}

test('Chrome close refuses a directory substituted for its temporary profile', async () => {
  const browser = browserWithChild((child, signal) => {
    child.signalCode = signal;
    child.emit('exit', null, signal);
  });
  const original = browser.profileRoot;
  const moved = `${original}-moved`;
  fs.renameSync(original, moved);
  fs.mkdirSync(original);
  const sentinel = path.join(original, 'not-our-profile');
  fs.writeFileSync(sentinel, 'preserve');
  try {
    await assert.rejects(browser.close(), /identity|changed/i);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'preserve');
  } finally {
    fs.rmSync(original, { recursive: true, force: true });
    fs.rmSync(moved, { recursive: true, force: true });
  }
});

test('Chrome close waits for exit after SIGKILL before removing its profile', async () => {
  let exited = false;
  let existedAtExit = false;
  const browser = browserWithChild((child, signal) => {
    if (signal === 'SIGTERM') return true;
    setTimeout(() => {
      existedAtExit = fs.existsSync(browser.profileRoot);
      exited = true;
      child.signalCode = signal;
      child.emit('exit', null, signal);
    }, 10);
    return true;
  });
  await browser.close();
  assert.equal(exited, true, 'close must await the exit event, not just kill()');
  assert.equal(existedAtExit, true, 'profile must survive until process exit');
  assert.equal(fs.existsSync(browser.profileRoot), false);
});

function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-owned-test-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return parent;
}

for (const replacement of ['directory', 'link']) {
  test(`cleanup refuses an ancestor replaced with a ${replacement}`, async t => {
    const base = fixture(t);
    const parent = path.join(base, 'parent');
    fs.mkdirSync(parent);
    const owned = createOwnedTempDirectory('test-', { parent });
    const moved = path.join(base, 'moved');
    fs.renameSync(parent, moved);
    if (replacement === 'link') fs.symlinkSync(moved, parent, process.platform === 'win32' ? 'junction' : 'dir');
    else fs.mkdirSync(parent);
    await assert.rejects(owned.cleanup(), /identity|changed/i);
    assert.ok(fs.existsSync(path.join(moved, path.basename(owned.path))));
  });
}

test('cleanup refuses a root symlink/junction and preserves the target', async t => {
  const parent = fixture(t);
  const owned = createOwnedTempDirectory('test-', { parent });
  const moved = path.join(parent, 'moved');
  fs.renameSync(owned.path, moved);
  fs.writeFileSync(path.join(moved, 'keep'), 'keep');
  fs.symlinkSync(moved, owned.path, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(owned.cleanup(), /identity|changed/i);
  assert.equal(fs.readFileSync(path.join(moved, 'keep'), 'utf8'), 'keep');
});

test('relative temp parent stays bound across a cwd change', t => {
  const base = fixture(t);
  fs.mkdirSync(path.join(base, 'temp'));
  fs.mkdirSync(path.join(base, 'other'));
  const moduleUrl = new URL('../archify/renderers/shared/owned-temp-directory.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { createOwnedTempDirectory } from ${JSON.stringify(moduleUrl)};
    import fs from 'node:fs';
    const owned = createOwnedTempDirectory('test-', { parent: './temp' });
    process.chdir('other');
    await owned.cleanup();
    if (fs.existsSync(owned.path)) process.exitCode = 1;
  `], { cwd: base, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(fs.readdirSync(path.join(base, 'temp')), []);
});

test('cleanup retries transient locks, then succeeds and is idempotent', async t => {
  const owned = createOwnedTempDirectory('test-', { parent: fixture(t) });
  const realRemove = fs.rmSync;
  let attempts = 0;
  const mock = t.mock.method(fs, 'rmSync', (target, options) => {
    if (target === owned.path && ++attempts < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' });
    return realRemove(target, options);
  });
  await owned.cleanup();
  await owned.cleanup();
  mock.mock.restore();
  assert.equal(attempts, 3);
  assert.equal(fs.existsSync(owned.path), false);
});

test('permanent cleanup failure reports the retained path after bounded attempts', async t => {
  const owned = createOwnedTempDirectory('test-', { parent: fixture(t) });
  const realRemove = fs.rmSync;
  let attempts = 0;
  const mock = t.mock.method(fs, 'rmSync', (target, options) => {
    if (target === owned.path) {
      attempts++;
      throw Object.assign(new Error('locked'), { code: 'EBUSY' });
    }
    return realRemove(target, options);
  });
  await assert.rejects(owned.cleanup(), error => error.code === 'ARCHIFY_TEMP_CLEANUP'
    && error.directory === owned.path && error.cause.code === 'EBUSY');
  mock.mock.restore();
  assert.equal(attempts, 4);
  assert.ok(fs.existsSync(owned.path));
});

test('cleanup rechecks identity between retries', async t => {
  const parent = fixture(t);
  const owned = createOwnedTempDirectory('test-', { parent });
  const realRemove = fs.rmSync;
  let attempts = 0;
  const mock = t.mock.method(fs, 'rmSync', (target, options) => {
    if (target === owned.path) {
      attempts++;
      fs.renameSync(target, path.join(parent, 'moved'));
      fs.mkdirSync(target);
      fs.writeFileSync(path.join(target, 'keep'), 'keep');
      throw Object.assign(new Error('locked'), { code: 'EPERM' });
    }
    return realRemove(target, options);
  });
  await assert.rejects(owned.cleanup(), /identity changed/);
  mock.mock.restore();
  assert.equal(attempts, 1);
  assert.equal(fs.readFileSync(path.join(owned.path, 'keep'), 'utf8'), 'keep');
});

test('Chrome close retains its profile when termination never completes', async () => {
  const browser = browserWithChild(() => true);
  try {
    await assert.rejects(browser.close(), /Chrome did not exit/);
    assert.ok(fs.existsSync(browser.profileRoot));
  } finally {
    fs.rmSync(browser.profileRoot, { recursive: true, force: true });
  }
});

test('validate emits one failed JSON receipt when temporary cleanup is blocked', t => {
  const parent = fixture(t);
  const preload = path.join(parent, 'block-cleanup.mjs');
  fs.writeFileSync(preload, `
    import fs from 'node:fs';
    import path from 'node:path';
    const remove = fs.rmSync;
    fs.rmSync = (target, options) => {
      if (path.basename(String(target)).startsWith('archify-validate-')) {
        throw Object.assign(new Error('injected temporary lock'), { code: 'EPERM' });
      }
      return remove(target, options);
    };
  `);
  const cli = new URL('../archify/bin/archify.mjs', import.meta.url);
  const input = new URL('../archify/examples/agent-tool-call.workflow.json', import.meta.url);
  const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href,
    fileURLToPath(cli), 'validate', 'workflow', fileURLToPath(input), '--json'], {
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: parent, TEMP: parent, TMP: parent },
  });
  assert.equal(result.status, 1, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.stage, 'cleanup');
  assert.equal(receipt.diagnostics[0].code, 'validate/temp-cleanup-incomplete');
  assert.ok(fs.existsSync(receipt.diagnostics[0].subject.directory));
});

test('Windows file share lock is reported, then cleanup succeeds after release', {
  skip: process.platform !== 'win32' ? 'requires actual Windows file sharing semantics' : false,
}, async t => {
  const parent = fixture(t);
  const owned = createOwnedTempDirectory('test-', { parent });
  const lockedFile = path.join(owned.path, 'locked');
  const ready = path.join(parent, 'ready');
  fs.writeFileSync(lockedFile, 'keep');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
    $ErrorActionPreference = 'Stop'
    $stream = [System.IO.File]::Open($env:ARCHIFY_TEST_LOCK, 'Open', 'Read', 'None')
    try {
      [System.IO.File]::WriteAllText($env:ARCHIFY_TEST_READY, 'ready')
      $null = [Console]::ReadLine()
    } finally { $stream.Dispose() }
  `], { env: { ...process.env, ARCHIFY_TEST_LOCK: lockedFile, ARCHIFY_TEST_READY: ready }, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.on('error', () => {});
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  try {
    for (let attempt = 0; attempt < 250 && !fs.existsSync(ready) && child.exitCode === null; attempt++) {
      await delay(20);
    }
    assert.ok(fs.existsSync(ready), `lock process did not become ready: ${stderr}`);
    await assert.rejects(owned.cleanup(), { code: 'ARCHIFY_TEMP_CLEANUP' });
    assert.ok(fs.existsSync(lockedFile));
  } finally {
    child.stdin.end('\n');
    await exited;
  }
  await owned.cleanup();
  assert.equal(fs.existsSync(owned.path), false);
});

test('changing the public profile path cannot redirect Chrome cleanup', async t => {
  const other = fixture(t);
  fs.writeFileSync(path.join(other, 'keep'), 'keep');
  const browser = browserWithChild((child, signal) => {
    child.signalCode = signal;
    child.emit('exit', null, signal);
  });
  const original = browser.profileRoot;
  browser.profileRoot = other;
  await browser.close();
  assert.equal(fs.existsSync(original), false);
  assert.equal(fs.readFileSync(path.join(other, 'keep'), 'utf8'), 'keep');
});
