import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const runner = path.join(repoRoot, 'scripts/run-tests.mjs');
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const supportsConcurrency = nodeMajor > 18 || (nodeMajor === 18 && nodeMinor >= 19);
const supportsNamePattern = nodeMajor > 18 || (nodeMajor === 18 && nodeMinor >= 11);
const defaultConcurrency = process.env.ARCHIFY_CHROME ? 2 : Math.max(1, Math.min(4, os.availableParallelism?.() ?? os.cpus().length));

function interceptedRun(t, args = [], outcome = { status: 0 }, nodeVersion = process.versions.node, runtime = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-runner-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const preload = path.join(directory, 'capture.cjs');
  fs.writeFileSync(preload, `
const childProcess = require('node:child_process');
const fs = require('node:fs');
${runtime.parallelism === undefined ? '' : `require('node:os').availableParallelism = () => ${runtime.parallelism};`}
Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(nodeVersion)} });
childProcess.spawnSync = (command, args, options) => {
  const cache = options.env.ARCHIFY_UPDATE_CACHE_DIRECTORY;
  console.log(JSON.stringify({ command, args, cwd: options.cwd, cache, cacheExists: fs.existsSync(cache) }));
  return ${JSON.stringify(outcome)};
};
require('node:module').syncBuiltinESMExports();
`);
  return spawnSync(process.execPath, ['--require', preload, runner, ...args], {
    cwd: directory, encoding: 'utf8',
    env: { ...process.env, ...(runtime.chrome === undefined ? {} : { ARCHIFY_CHROME: runtime.chrome }), ARCHIFY_UPDATE_CACHE_DIRECTORY: path.join(directory, 'user-cache') },
  });
}

test('focused runner selects exact files from an unrelated cwd and cleans isolated cache', (t) => {
  const files = ['test/repository-test-runner.test.mjs', 'test/browser-gate.test.mjs'];
  const result = interceptedRun(t, ['--require-files', files[0], path.join(repoRoot, files[1]), files[0],
    ...(supportsConcurrency ? ['--concurrency=3'] : [])]);
  assert.equal(result.status, 0, result.stderr);
  const call = JSON.parse(result.stdout);
  assert.deepEqual(call.args, ['--test', ...(supportsConcurrency ? ['--test-concurrency=3'] : []), ...files]);
  assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(repoRoot));
  assert.equal(call.cacheExists, true);
  assert.match(path.basename(call.cache), /^archify-test-update-/);
  assert.equal(fs.existsSync(call.cache), false);
  assert.match(result.stderr, supportsConcurrency ? /2 files, concurrency 3/ : /2 files, concurrency Node default/);
});

test('supported older Node retains default operation and rejects explicit concurrency', (t) => {
  const args = ['test/repository-test-runner.test.mjs'];
  const result = interceptedRun(t, args, { status: 0 }, '18.18.0');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).args, ['--test', ...args]);
  const override = interceptedRun(t, ['--concurrency=2', ...args], { status: 0 }, '18.18.0');
  assert.equal(override.status, 1);
  assert.equal(override.stdout, '');
  assert.match(override.stderr, /requires Node 18\.19 or newer/);
});

test('default Node concurrency uses available CPUs with a four-file ceiling and a separate Chrome limit', (t) => {
  for (const [parallelism, chrome, expected] of [[1, '', 1], [2, '', 2], [8, '', 4], [8, 'chrome', 2]]) {
    const result = interceptedRun(t, ['test/repository-test-runner.test.mjs'], { status: 0 }, '22.0.0', { parallelism, chrome });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout).args, ['--test', `--test-concurrency=${expected}`, 'test/repository-test-runner.test.mjs']);
  }
});

test('focused runner forwards a validated test name pattern as one child argument', (t) => {
  const pattern = '^repository runner .*failure';
  const result = interceptedRun(t, ['test/repository-test-runner.test.mjs', `--test-name-pattern=${pattern}`]);
  if (!supportsNamePattern) {
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /requires Node 18\.11 or newer/);
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).args, [
    '--test', ...(supportsConcurrency ? [`--test-concurrency=${defaultConcurrency}`] : []),
    `--test-name-pattern=${pattern}`, 'test/repository-test-runner.test.mjs',
  ]);
});

test('test name selection fails clearly before Node 18.11 and works from that version', (t) => {
  const args = ['test/repository-test-runner.test.mjs', '--test-name-pattern=selected'];
  const unsupported = interceptedRun(t, args, { status: 0 }, '18.10.0');
  assert.equal(unsupported.status, 1);
  assert.equal(unsupported.stdout, '');
  assert.match(unsupported.stderr, /requires Node 18\.11 or newer/);
  const supported = interceptedRun(t, args, { status: 0 }, '18.11.0');
  assert.equal(supported.status, 0, supported.stderr);
  assert.deepEqual(JSON.parse(supported.stdout).args, [
    '--test', '--test-name-pattern=selected', 'test/repository-test-runner.test.mjs',
  ]);
});

test('runner lists inventory without launching or allocating a cache', (t) => {
  const result = interceptedRun(t, ['--list']);
  assert.equal(result.status, 0, result.stderr);
  const files = fs.readdirSync(path.join(repoRoot, 'test'))
    .filter(file => file.endsWith('.test.mjs')).sort().map(file => path.join('test', file));
  assert.deepEqual(result.stdout.trim().split('\n'), files);
  assert.equal(result.stderr, '');
  const selected = interceptedRun(t, ['--list', 'test/browser-gate.test.mjs']);
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(selected.stdout.trim(), 'test/browser-gate.test.mjs');
});

test('focus alias requires files and invalid options never launch a child', (t) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts['test:focus'], 'node scripts/run-tests.mjs --require-files');
  for (const args of [
    ['--require-files'], ['--require-files', '--list'], ['test/missing.test.mjs'],
    ['test'], ['package.json'], ['--unknown'], ['--concurrency=0'],
    ['--concurrency=-1'], ['--concurrency=1.5'], ['--concurrency=abc'],
    ['--concurrency=9007199254740992'],
    ['--test-name-pattern='], ['--test-name-pattern=['], ['--test-name-pattern'],
  ]) {
    const result = interceptedRun(t, args);
    assert.equal(result.status, 1, `${args}: ${result.stderr}`);
    assert.equal(result.stdout, '', `${args} must not launch tests`);
    assert.ok(result.stderr.trim());
  }
});

for (const outcome of [{ status: 7 }, { status: null, signal: 'SIGTERM' }, { error: { message: 'spawn failed' } }]) {
  test(`repository runner cleans cache and propagates child failure (${outcome.signal || outcome.status || 'error'})`, (t) => {
    const result = interceptedRun(t, ['test/repository-test-runner.test.mjs'], outcome);
    assert.equal(result.status, outcome.status ?? 1);
    const call = JSON.parse(result.stdout);
    assert.equal(call.cacheExists, true);
    assert.equal(fs.existsSync(call.cache), false);
    if (outcome.signal) assert.match(result.stderr, /terminated by SIGTERM/);
    if (outcome.error) assert.match(result.stderr, /spawn failed/);
  });
}

test('repository runner discovers every test suite from an unrelated working directory', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-discovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const preload = path.join(directory, 'capture.cjs');
  fs.writeFileSync(preload, `
const childProcess = require('node:child_process');
childProcess.spawnSync = (command, args, options) => {
  console.log(JSON.stringify({ command, args, cwd: options.cwd }));
  return { status: 0 };
};
require('node:module').syncBuiltinESMExports();
`);
  const result = spawnSync(process.execPath, ['--require', preload, path.join(repoRoot, 'scripts/run-tests.mjs')], {
    cwd: directory, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const invocation = JSON.parse(result.stdout);
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 18 || (major === 18 && minor >= 19)) {
    assert.ok(invocation.args.includes(`--test-concurrency=${defaultConcurrency}`));
  }
  assert.equal(fs.realpathSync(invocation.cwd), fs.realpathSync(repoRoot));
  const expected = fs.readdirSync(path.join(repoRoot, 'test'))
    .filter(file => file.endsWith('.test.mjs')).sort().map(file => path.join('test', file));
  assert.deepEqual(invocation.args.filter(arg => !arg.startsWith('--')), expected);
  for (const file of expected) assert.ok(fs.existsSync(path.join(invocation.cwd, file)), file);
  assert.equal(fs.existsSync(path.join(repoRoot, 'archify/test')), false);
});
