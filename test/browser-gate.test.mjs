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
  const userCache = path.join(directory, 'user-cache');
  fs.mkdirSync(userCache);
  fs.writeFileSync(path.join(userCache, 'preserved'), 'existing cache');
  const preload = path.join(directory, 'capture-runner.cjs');
  fs.writeFileSync(preload, `
const childProcess = require('node:child_process');
childProcess.spawnSync = (command, args, options) => {
  const updateCache = options.env.ARCHIFY_UPDATE_CACHE_DIRECTORY;
  require('node:fs').writeFileSync(require('node:path').join(updateCache, 'fixture-update'), 'test receipt');
  console.log(JSON.stringify({ command, args, cwd: options.cwd, chrome: options.env.ARCHIFY_CHROME, updateCache }));
  return ${JSON.stringify(outcome)};
};
require('node:module').syncBuiltinESMExports();
`);
  const result = spawnSync(process.execPath, ['--require', preload, runner, ...args], {
    cwd: directory,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_CHROME: process.execPath, ARCHIFY_UPDATE_CACHE_DIRECTORY: userCache },
  });
  assert.equal(fs.readFileSync(path.join(userCache, 'preserved'), 'utf8'), 'existing cache');
  assert.deepEqual(fs.readdirSync(userCache), ['preserved']);
  if (result.stdout.startsWith('{')) {
    const call = JSON.parse(result.stdout);
    assert.notEqual(call.updateCache, userCache, 'the browser gate must isolate update state');
    assert.equal(fs.existsSync(call.updateCache), false, 'temporary cache must be cleaned on success, failure and child termination');
  }
  return result;
}

test('browser gate includes every browser suite without repeating ordinary Node suites', (t) => {
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
    'sequence-header-clearance.test.mjs', 'semantic-radar.test.mjs', 'viewer-chrome-layout.test.mjs',
  ];
  for (const file of required) assert.ok(files.includes(path.join('test', file)), `${file} must run in the browser gate`);
  for (const file of ['i18n.test.mjs', 'repository-evidence.test.mjs']) {
    assert.ok(!files.includes(path.join('test', file)), `${file} belongs to the ordinary Node gate`);
  }
});

test('browser gate focuses maintained browser suites and supports explicit concurrency', (t) => {
  const files = ['test/i18n-browser.test.mjs', 'test/desktop-reader-browser.test.mjs'];
  const result = interceptedRun(t, { status: 0 }, [files[0], path.join(repoRoot, files[1]),
    ...(supportsConcurrency ? ['--concurrency=1'] : [])]);
  assert.equal(result.status, 0, result.stderr);
  const call = JSON.parse(result.stdout);
  assert.deepEqual(call.args, ['--test', ...(supportsConcurrency ? ['--test-concurrency=1'] : []), ...files]);
  assert.match(result.stderr, supportsConcurrency ? /2 files, concurrency 1/ : /2 files, concurrency Node default/);
});

test('browser gate forwards a validated test name pattern', (t) => {
  const result = interceptedRun(t, { status: 0 }, ['test/i18n-browser.test.mjs', '--test-name-pattern=locale.*日本語']);
  if (!supportsNamePattern) {
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /requires Node 18\.11 or newer/);
    return;
  }
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).args, [
    '--test', ...(supportsConcurrency ? ['--test-concurrency=2'] : []),
    '--test-name-pattern=locale.*日本語', 'test/i18n-browser.test.mjs',
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
  const result = spawnSync(process.execPath, [runner, 'test/i18n-browser.test.mjs'], {
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
    ['ci.yml', 'browser-regression', 'webm-decode', 'npm run test:browser -- --shard=${{ matrix.shard }}/${{ strategy.job-total }}'],
    ['release.yml', 'release', 'release', 'npm run test:browser'],
  ]) {
    const jobs = parse(fs.readFileSync(path.join(repoRoot, '.github/workflows', workflow), 'utf8')).jobs;
    const gate = jobs[browserJob].steps.find(step => step.name === 'Run shared browser regression gate');
    assert.equal(gate?.run, browserCommand, `${workflow} must invoke the shared gate`);
    assert.equal(gate['working-directory'], undefined);
    assert.equal(gate.env.ARCHIFY_CHROME, '${{ steps.setup-chrome.outputs.chrome-path }}');
    if (workflow === 'ci.yml') {
      const media = jobs[webmJob].steps.find(step => step.env?.CI_WEBM_PROFILE);
      assert.equal(media?.env.CI_WEBM_PROFILE, '${{ needs.scope.outputs.webmProfile }}');
      assert.equal(media.run, 'node test/webm-artifact.smoke.mjs "$CI_WEBM_PROFILE"');
      const language = jobs.website.steps.find(step => step.run === 'node --test test/site-language-integration.mjs');
      assert.equal(language?.if, "matrix.target == 'pages'");
      assert.ok(language.env.ARCHIFY_CHROME);
    } else {
      assert.ok(jobs[webmJob].steps.some(step => step.run === 'npm run test:webm'));
      assert.equal(manifest.scripts['test:webm'], 'node test/webm-artifact.smoke.mjs && node --test test/site-language-integration.mjs');
    }
  }
});

test('browser shards are deterministic, nonempty, disjoint and cover the full maintained inventory', (t) => {
  const full = JSON.parse(interceptedRun(t, { status: 0 }).stdout).args.filter(arg => !arg.startsWith('--'));
  const shards = [1, 2, 3, 4].map(index => {
    const result = interceptedRun(t, { status: 0 }, [`--shard=${index}/4`]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stderr, new RegExp(`shard ${index}/4`));
    const files = JSON.parse(result.stdout).args.filter(arg => !arg.startsWith('--'));
    assert.deepEqual(files, full.filter((_, fileIndex) => fileIndex % 4 === index - 1));
    assert.ok(files.length > 0);
    return files;
  });
  assert.equal(new Set(shards.flat()).size, full.length);
  assert.equal(shards.flat().length, full.length);
  assert.deepEqual(shards.flat().sort(), [...full].sort());
  const owner = file => shards.findIndex(files => files.some(entry => path.basename(entry) === file));
  assert.notEqual(owner('desktop-reader-browser.test.mjs'), owner('i18n-browser.test.mjs'));
  assert.notEqual(owner('viewer-chrome-layout.test.mjs'), owner('reader-layout-browser.test.mjs'));
});

test('CI browser profiles preserve the exact Atlas and media test inventories across shards', () => {
  const list = (env = {}, args = []) => spawnSync(process.execPath, [runner, '--list', ...args], {
    encoding: 'utf8', env: { ...process.env, ARCHIFY_CHROME: '', ...env },
  });
  const full = list().stdout.trim().split('\n');
  const cases = [
    [{ CI_BROWSER_PROFILE: 'atlas' }, full.filter(file => file.startsWith('test/code-analysis-'))],
    [{ CI_STORY_BROWSER_OWNER: 'webm' }, full.filter(file => file !== 'test/story-browser.test.mjs')],
  ];
  for (const [env, expected] of cases) {
    const selected = [];
    for (const index of [1, 2, 3, 4]) {
      const result = list(env, [`--shard=${index}/4`]);
      assert.equal(result.status, 0, result.stderr);
      const files = result.stdout.trim().split('\n');
      assert.ok(files.every(Boolean));
      selected.push(...files);
    }
    assert.deepEqual(selected.sort(), expected.sort());
  }
  assert.ok(full.includes('test/story-browser.test.mjs'));
  for (const env of [{ CI_BROWSER_PROFILE: 'atals' }, { CI_STORY_BROWSER_OWNER: 'unknown' }]) {
    assert.notEqual(list(env).status, 0);
  }
  const ci = parse(fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8')).jobs;
  const release = parse(fs.readFileSync(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8')).jobs.release;
  const browser = job => job.steps.find(step => step.name === 'Run shared browser regression gate');
  assert.equal(browser(ci['browser-regression']).env.CI_BROWSER_PROFILE, '${{ needs.scope.outputs.browserProfile }}');
  assert.equal(browser(ci['browser-regression']).env.CI_BROWSER_TESTS, '${{ needs.scope.outputs.browserTests }}');
  assert.equal(ci.scope.outputs.browserTests, '${{ steps.classify.outputs.browserTests }}');
  assert.equal(browser(ci['browser-regression']).env.CI_STORY_BROWSER_OWNER,
    "${{ needs.scope.outputs.webm == 'true' && needs.scope.outputs.webmProfile != 'viewer' && 'webm' || 'browser' }}");
  assert.equal(browser(release).env.CI_STORY_BROWSER_OWNER, 'webm');
  assert.ok(release.steps.findIndex(step => step.run === 'npm run test:webm') < release.steps.indexOf(browser(release)));
});

test('changed browser profile runs only maintained suites and rejects invalid selections before launch', () => {
  const files = ['test/desktop-reader-browser.test.mjs', 'test/viewer-chrome-layout.test.mjs',
    'test/i18n-browser.test.mjs', 'test/export-browser.test.mjs'];
  const run = (selection, args = []) => spawnSync(process.execPath, [runner, ...args], {
    encoding: 'utf8', env: {
      ...process.env, ARCHIFY_CHROME: '', CI_BROWSER_PROFILE: 'changed',
      CI_BROWSER_TESTS: selection, CI_STORY_BROWSER_OWNER: 'webm',
    },
  });
  const listed = run(JSON.stringify(files), ['--list', '--shard=1/1']);
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(listed.stdout.trim().split('\n'), files.map(file => path.normalize(file)));
  assert.match(run(JSON.stringify(files), ['--shard=1/1']).stderr, /require an executable Chrome\/Chromium/);
  const larger = [...files, 'test/story-choreography-browser.test.mjs'];
  const acrossShards = [1, 2, 3, 4].flatMap(index => {
    const result = run(JSON.stringify(larger), ['--list', `--shard=${index}/4`]);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim().split('\n');
  });
  assert.deepEqual(acrossShards.sort(), larger.map(file => path.normalize(file)).sort());
  for (const selection of ['', '[]', 'false', 'garbage', '["test/story-browser.test.mjs"]',
    '["test/missing-browser.test.mjs"]', '["test/geometry.test.mjs"]', JSON.stringify([files[0], files[0]])]) {
    const result = run(selection, ['--list', '--shard=1/1']);
    assert.equal(result.status, 1, selection);
    assert.equal(result.stdout, '', selection);
  }
});

test('browser shard listing requires neither Chrome nor test execution', () => {
  const full = spawnSync(process.execPath, [runner, '--list'], {
    encoding: 'utf8', env: { ...process.env, ARCHIFY_CHROME: '' },
  }).stdout.trim().split('\n');
  for (const index of [1, 2, 3, 4]) {
    const result = spawnSync(process.execPath, [runner, `--shard=${index}/4`, '--list'], {
      encoding: 'utf8', env: { ...process.env, ARCHIFY_CHROME: '' },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    assert.deepEqual(result.stdout.trim().split('\n'), full.filter((_, fileIndex) => fileIndex % 4 === index - 1));
  }
});

test('browser shards reject invalid, duplicate, empty or partially selected coverage before launch', (t) => {
  for (const args of [
    ['--shard'], ['--shard=0/2'], ['--shard=1/0'], ['--shard=3/2'],
    ['--shard=01/2'], ['--shard=1/2.0'], ['--shard=1/999'],
    ['--shard=1/9007199254740992'], ['--shard=1/2', '--shard=2/2'],
    ['--shard=1/2', 'test/i18n-browser.test.mjs'],
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
  assert.equal(jobs['browser-regression'].strategy.matrix.shard,
    "${{ fromJSON((needs.scope.outputs.browserProfile != 'changed' || fromJSON(needs.scope.outputs.browserTests || '[]')[4]) && '[1,2,3,4]' || '[1]') }}");
  for (const [name, flag] of [['browser-regression', 'browser'], ['webm-decode', 'webm']]) {
    const job = jobs[name];
    assert.equal(job.needs, 'scope');
    assert.equal(job.if, `needs.scope.result == 'success' && needs.scope.outputs.${flag} == 'true'`);
    assert.ok(job.steps.every(step => step.if === undefined), `${name} runs every step when requested`);
  }
  const aggregate = jobs['webm-artifact'];
  assert.deepEqual(aggregate.needs, ['scope', 'browser-regression', 'webm-decode']);
  assert.equal(aggregate.if, 'always() && !cancelled()');
  const step = aggregate.steps[0];
  assert.equal(step.env.SCOPE_RESULT, '${{ needs.scope.result }}');
  assert.equal(step.env.CI_SCOPE, '${{ needs.scope.outputs.scope }}');
  assert.equal(step.env.CI_BROWSER, '${{ needs.scope.outputs.browser }}');
  assert.equal(step.env.CI_BROWSER_PROFILE, '${{ needs.scope.outputs.browserProfile }}');
  assert.equal(step.env.CI_WEBM, '${{ needs.scope.outputs.webm }}');
  assert.equal(step.env.CI_WEBM_PROFILE, '${{ needs.scope.outputs.webmProfile }}');
  assert.equal(step.env.BROWSER_RESULT, '${{ needs.browser-regression.result }}');
  assert.equal(step.env.WEBM_RESULT, '${{ needs.webm-decode.result }}');
  const runAggregate = overrides => spawnSync('bash', ['-e', '-u', '-o', 'pipefail', '-c', step.run], {
    encoding: 'utf8', env: {
      ...process.env, SCOPE_RESULT: 'success', CI_SCOPE: 'full', CI_BROWSER: 'true',
      CI_BROWSER_PROFILE: 'full', CI_WEBM: 'true', CI_WEBM_PROFILE: 'full',
      BROWSER_RESULT: 'success', WEBM_RESULT: 'success', ...overrides,
    },
  });
  for (const [scope, profile, browser, webm, media = 'full'] of [
    ['docs', 'full', false, false], ['full', 'full', true, true], ['full', 'full', true, false],
    ['core', 'full', true, true, 'viewer'], ['core', 'full', true, true, 'story'],
    ['core', 'full', false, true, 'story'],
    ['core', 'full', false, false], ['core', 'full', false, true],
    ['core', 'full', true, false], ['core', 'full', true, true],
    ['core', 'atlas', true, false], ['core', 'changed', true, false], ['core', 'changed', true, true],
  ]) {
    const plan = {
      CI_SCOPE: scope, CI_BROWSER_PROFILE: profile, CI_BROWSER: String(browser), CI_WEBM: String(webm), CI_WEBM_PROFILE: media,
      BROWSER_RESULT: browser ? 'success' : 'skipped', WEBM_RESULT: webm ? 'success' : 'skipped',
    };
    assert.equal(runAggregate(plan).status, 0, JSON.stringify(plan));
    for (const key of ['SCOPE_RESULT', 'BROWSER_RESULT', 'WEBM_RESULT']) {
      for (const result of ['success', 'failure', 'skipped', 'cancelled', '']) {
        const expected = result === (plan[key] ?? 'success') ? 0 : 1;
        assert.equal(runAggregate({ ...plan, [key]: result }).status, expected,
          `${JSON.stringify(plan)} with ${key}=${result}`);
      }
    }
  }
  for (const plan of [
    { CI_SCOPE: '' }, { CI_SCOPE: 'unknown' }, { CI_SCOPE: 'docs' },
    { CI_BROWSER: '' }, { CI_WEBM: '' }, { CI_BROWSER_PROFILE: '' },
    { CI_BROWSER: 'false', BROWSER_RESULT: 'skipped' }, { CI_WEBM_PROFILE: '' },
    { CI_WEBM_PROFILE: 'viewer' }, { CI_SCOPE: 'core', CI_WEBM_PROFILE: 'unknown' },
    { CI_SCOPE: 'core', CI_WEBM: 'false', WEBM_RESULT: 'skipped', CI_WEBM_PROFILE: 'story' },
    { CI_BROWSER_PROFILE: 'changed' }, { CI_BROWSER_PROFILE: 'atlas' },
    { CI_SCOPE: 'core', CI_BROWSER_PROFILE: 'unknown' },
    { CI_SCOPE: 'core', CI_BROWSER: 'false', BROWSER_RESULT: 'skipped', CI_BROWSER_PROFILE: 'changed' },
    { CI_SCOPE: 'core', CI_BROWSER_PROFILE: 'atlas' },
    { CI_SCOPE: 'core', CI_WEBM: '0', WEBM_RESULT: 'skipped' },
  ]) {
    assert.equal(runAggregate(plan).status, 1, JSON.stringify(plan));
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
