import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const repoRoot = path.dirname(skillRoot);
const runner = path.join(repoRoot, 'scripts/run-browser-tests.mjs');
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const supportsConcurrency = nodeMajor > 18 || (nodeMajor === 18 && nodeMinor >= 19);
const supportsNamePattern = nodeMajor > 18 || (nodeMajor === 18 && nodeMinor >= 11);

test('browser gate rejects an unavailable explicit browser instead of skipping', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-browser-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const chrome of ['', path.join(directory, 'missing-chrome')]) {
    const result = spawnSync(process.execPath, [runner], {
      encoding: 'utf8', env: { ...process.env, ARCHIFY_CHROME: chrome },
    });
    assert.equal(result.status, 1, result.stdout || result.stderr);
    assert.match(result.stderr, /require an executable Chrome\/Chromium/);
    assert.doesNotMatch(result.stdout, /# SKIP/);
  }
});

// Observe the public runner's child invocation without starting real browsers
// in the ordinary Node matrix. The explicit browser gate supplies real coverage.
function interceptedRun(t, outcome, args = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-browser-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const preload = path.join(directory, 'capture-runner.cjs');
  fs.writeFileSync(preload, `
const childProcess = require('node:child_process');
childProcess.spawnSync = (command, args, options) => {
  console.log(JSON.stringify({ command, args, cwd: options.cwd, chrome: options.env.ARCHIFY_CHROME }));
  return ${JSON.stringify(outcome)};
};
require('node:module').syncBuiltinESMExports();
`);
  return spawnSync(process.execPath, ['--require', preload, runner, ...args], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_CHROME: process.execPath },
  });
}

test('browser gate includes dedicated and mixed browser suites and enables them', (t) => {
  const result = interceptedRun(t, { status: 0, signal: null });
  assert.equal(result.status, 0, result.stderr);
  const call = JSON.parse(result.stdout);
  assert.equal(call.command, process.execPath);
  assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(repoRoot));
  assert.equal(call.chrome, process.execPath);
  assert.ok(call.args.includes('--test'));
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major > 18 || (major === 18 && minor >= 19)) {
    assert.ok(call.args.includes('--test-concurrency=2'));
  }
  const files = call.args.filter((arg) => !arg.startsWith('--'));
  assert.equal(new Set(files).size, files.length);
  for (const file of files) assert.ok(fs.existsSync(path.join(repoRoot, file)), file);
  const required = [
    ...fs.readdirSync(path.join(skillRoot, '..', 'test')).filter((file) => file.endsWith('-browser.test.mjs')),
    'sequence-header-clearance.test.mjs', 'repository-evidence.test.mjs', 'i18n.test.mjs', 'semantic-radar.test.mjs', 'viewer-chrome-layout.test.mjs',
  ];
  for (const file of required) assert.ok(files.includes(path.join('test', file)), `${file} must run in the browser gate`);
});

test('browser gate focuses maintained mixed suites and supports explicit concurrency', (t) => {
  const files = ['test/i18n.test.mjs', 'test/desktop-reader-browser.test.mjs'];
  const result = interceptedRun(t, { status: 0 }, [files[0], path.join(repoRoot, files[1]),
    ...(supportsConcurrency ? ['--concurrency=1'] : [])]);
  assert.equal(result.status, 0, result.stderr);
  const call = JSON.parse(result.stdout);
  assert.deepEqual(call.args, ['--test', ...(supportsConcurrency ? ['--test-concurrency=1'] : []), ...files]);
  assert.match(result.stderr, supportsConcurrency ? /2 files, concurrency 1/ : /2 files, concurrency Node default/);
});

test('browser gate forwards a validated test name pattern', (t) => {
  const result = interceptedRun(t, { status: 0 }, ['test/i18n.test.mjs', '--test-name-pattern=locale.*日本語']);
  if (!supportsNamePattern) {
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /requires Node 18\.11 or newer/);
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).args, [
    '--test', ...(supportsConcurrency ? ['--test-concurrency=2'] : []),
    '--test-name-pattern=locale.*日本語', 'test/i18n.test.mjs',
  ]);
});

test('browser gate rejects files outside its inventory and invalid options before launch', (t) => {
  for (const args of [['test/geometry.test.mjs'], ['--concurrency=0'], ['--unknown'],
    ['--test-name-pattern='], ['--test-name-pattern=[']]) {
    const result = interceptedRun(t, { status: 0 }, args);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
  }
});

test('browser inventory can be listed without Chrome or child execution', (t) => {
  const result = spawnSync(process.execPath, [runner, '--list'], {
    encoding: 'utf8', env: { ...process.env, ARCHIFY_CHROME: '' },
  });
  assert.equal(result.status, 0, result.stderr);
  const invocation = JSON.parse(interceptedRun(t, { status: 0 }).stdout);
  assert.deepEqual(result.stdout.trim().split('\n'), invocation.args.filter(arg => !arg.startsWith('--')));
  assert.equal(result.stderr, '');
});

test('selected browser execution still requires Chrome', () => {
  const result = spawnSync(process.execPath, [runner, 'test/i18n.test.mjs'], {
    encoding: 'utf8', env: { ...process.env, ARCHIFY_CHROME: '' },
  });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /require an executable Chrome\/Chromium/);
});

for (const outcome of [{ status: 7, signal: null }, { status: null, signal: 'SIGTERM' }, { status: 0, signal: 'SIGTERM' }]) {
  test(`browser gate propagates child failure (${outcome.signal || outcome.status})`, (t) => {
    const result = interceptedRun(t, outcome);
    assert.equal(result.status, outcome.signal ? 1 : (outcome.status ?? 1));
    if (outcome.signal) assert.match(result.stderr, /terminated by SIGTERM/);
  });
}

test('CI and release use the same browser command and retain WebM decoding', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts['test:browser'], 'node scripts/run-browser-tests.mjs');
  for (const [workflow, browserJob, webmJob, browserCommand] of [
    ['ci.yml', 'browser-regression', 'webm-decode', 'npm run test:browser -- --shard=${{ matrix.shard }}/2'],
    ['release.yml', 'release', 'release', 'npm run test:browser'],
  ]) {
    const jobs = parse(fs.readFileSync(path.join(repoRoot, '.github/workflows', workflow), 'utf8')).jobs;
    const gate = jobs[browserJob].steps.find(step => step.name === 'Run shared browser regression gate');
    assert.equal(gate?.run, browserCommand, `${workflow} must invoke the shared gate`);
    assert.equal(gate['working-directory'], undefined);
    assert.equal(gate.env.ARCHIFY_CHROME, '${{ steps.setup-chrome.outputs.chrome-path }}');
    assert.ok(jobs[webmJob].steps.some(step => step.run === 'npm run test:webm'));
  }
});

test('browser shards are deterministic, nonempty, disjoint and cover the full maintained inventory', (t) => {
  const full = JSON.parse(interceptedRun(t, { status: 0 }).stdout).args.filter(arg => !arg.startsWith('--'));
  const shards = [1, 2].map(index => {
    const result = interceptedRun(t, { status: 0 }, [`--shard=${index}/2`]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, new RegExp(`shard ${index}/2`));
    const files = JSON.parse(result.stdout).args.filter(arg => !arg.startsWith('--'));
    assert.deepEqual(files, full.filter((_, fileIndex) => fileIndex % 2 === index - 1));
    assert.ok(files.length > 0);
    return files;
  });
  assert.equal(new Set(shards.flat()).size, full.length);
  assert.equal(shards.flat().length, full.length);
  assert.deepEqual(shards.flat().sort(), [...full].sort());
  const owner = file => shards.findIndex(files => files.includes(`test/${file}`));
  assert.notEqual(owner('desktop-reader-browser.test.mjs'), owner('i18n.test.mjs'));
  assert.notEqual(owner('viewer-chrome-layout.test.mjs'), owner('reader-layout-browser.test.mjs'));
});

test('browser shard listing requires neither Chrome nor test execution', () => {
  const full = spawnSync(process.execPath, [runner, '--list'], {
    encoding: 'utf8', env: { ...process.env, ARCHIFY_CHROME: '' },
  }).stdout.trim().split('\n');
  for (const index of [1, 2]) {
    const result = spawnSync(process.execPath, [runner, `--shard=${index}/2`, '--list'], {
      encoding: 'utf8', env: { ...process.env, ARCHIFY_CHROME: '' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(result.stdout.trim().split('\n'), full.filter((_, fileIndex) => fileIndex % 2 === index - 1));
  }
});

test('browser shards reject invalid, duplicate, empty or partially selected coverage before launch', (t) => {
  for (const args of [
    ['--shard'], ['--shard=0/2'], ['--shard=1/0'], ['--shard=3/2'],
    ['--shard=01/2'], ['--shard=1/2.0'], ['--shard=1/999'],
    ['--shard=1/9007199254740992'], ['--shard=1/2', '--shard=2/2'],
    ['--shard=1/2', 'test/i18n.test.mjs'],
    ['--shard=1/2', '--test-name-pattern=locale'],
  ]) {
    const result = interceptedRun(t, { status: 0 }, args);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '', 'invalid sharding must never start child tests');
  }
});

test('sharded browser gates retain Chrome requirements and propagate child failures', (t) => {
  const unavailable = spawnSync(process.execPath, [runner, '--shard=1/2'], {
    encoding: 'utf8', env: { ...process.env, ARCHIFY_CHROME: '' },
  });
  assert.equal(unavailable.status, 1);
  assert.match(unavailable.stderr, /require an executable Chrome\/Chromium/);
  for (const outcome of [{ status: 7 }, { status: null }, { status: 0, signal: 'SIGTERM' }]) {
    const result = interceptedRun(t, outcome, ['--shard=2/2']);
    assert.equal(result.status, outcome.signal ? 1 : (outcome.status ?? 1));
  }
});

test('CI media gates fail closed and run only for their affected responsibility', () => {
  const jobs = parse(fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8')).jobs;
  assert.equal(jobs['browser-regression'].strategy['fail-fast'], false);
  assert.deepEqual(jobs['browser-regression'].strategy.matrix.shard, [1, 2]);
  const aggregate = jobs['webm-artifact'];
  assert.deepEqual(aggregate.needs, ['scope', 'browser-regression', 'webm-decode']);
  assert.equal(aggregate.if, 'always() && !cancelled()');
  const step = aggregate.steps[0];
  assert.equal(step.env.BROWSER_RESULT, '${{ needs.browser-regression.result }}');
  assert.equal(step.env.WEBM_RESULT, '${{ needs.webm-decode.result }}');
  const runAggregate = overrides => spawnSync('bash', ['-e', '-u', '-o', 'pipefail', '-c', step.run], {
    encoding: 'utf8', env: {
      ...process.env, SCOPE_RESULT: 'success', CI_SCOPE: 'full',
      BROWSER_RESULT: 'success', WEBM_RESULT: 'success', ...overrides,
    },
  });
  for (const scope of ['full', 'core', 'docs']) assert.equal(runAggregate({ CI_SCOPE: scope }).status, 0);
  for (const key of ['SCOPE_RESULT', 'BROWSER_RESULT', 'WEBM_RESULT']) {
    for (const result of ['failure', 'skipped', 'cancelled', '']) {
      assert.notEqual(runAggregate({ [key]: result }).status, 0, `${key}=${result} must fail closed`);
    }
  }
  assert.notEqual(runAggregate({ CI_SCOPE: 'unknown' }).status, 0);
  for (const name of ['browser-regression', 'webm-decode']) {
    const job = jobs[name];
    assert.equal(job.needs, 'scope');
    assert.equal(job.if, 'always() && !cancelled()');
    assert.equal(job.steps[0].env.SCOPE_RESULT, '${{ needs.scope.result }}');
    const scopeCheck = (scope, result = 'success') => spawnSync('bash', ['-e', '-c', job.steps[0].run], {
      env: { ...process.env, SCOPE_RESULT: result, CI_SCOPE: scope },
    }).status;
    for (const scope of ['docs', 'core', 'full']) assert.equal(scopeCheck(scope), 0);
    assert.notEqual(scopeCheck('unknown'), 0);
    assert.notEqual(scopeCheck('core', 'failure'), 0);
    const responsibility = name === 'browser-regression' ? 'browser' : 'webm';
    for (const runtimeStep of job.steps.slice(1)) {
      assert.equal(runtimeStep.if, `needs.scope.outputs.${responsibility} == 'true'`);
    }
  }
});


test('website CI uses the maintained browser script including community security coverage', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'website/package.json'), 'utf8'));
  const source = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');
  const gate = source.match(/ {6}- name: Verify built website navigation and language continuity\n([\s\S]*?)(?=\n {6}- |\n {2}[\w-]+:|$)/)?.[1];
  assert.ok(gate, 'website must run its browser regression gate');
  assert.match(gate, /run: npm run test:browser\n/);
  assert.match(gate, /working-directory: website/);
  assert.match(gate, /ARCHIFY_SITE_INTEGRATION: '1'/);
  assert.match(manifest.scripts['test:browser'], /site-language-continuity\.test\.mjs/);
  assert.match(manifest.scripts['test:browser'], /community-browser\.test\.mjs/);
});
