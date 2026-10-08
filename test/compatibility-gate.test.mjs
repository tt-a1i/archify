import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import {
  compatibilityTestFiles,
  validateCompatibilityInventory,
} from '../scripts/compat-test-inventory.mjs';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const runner = path.join(repoRoot, 'scripts/run-compat-tests.mjs');
const [major, minor] = process.versions.node.split('.').map(Number);
const supportsConcurrency = major > 18 || (major === 18 && minor >= 19);
const supportsNamePattern = major > 18 || (major === 18 && minor >= 11);

function interceptedRun(t, args = [], outcomes = [{ status: 0 }, { status: 0 }]) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-compat-gate-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const preload = path.join(directory, 'capture.cjs');
  fs.writeFileSync(preload, `
const childProcess = require('node:child_process');
const outcomes = ${JSON.stringify(outcomes)};
let invocation = 0;
childProcess.spawnSync = (command, args, options) => {
  console.log(JSON.stringify({ command, args, cwd: options.cwd }));
  const result = outcomes[invocation++] || { status: 0 };
  if (result.error) result.error = new Error(result.error);
  return result;
};
require('node:module').syncBuiltinESMExports();
`);
  return spawnSync(process.execPath, ['--require', preload, runner, ...args], {
    cwd: directory, encoding: 'utf8',
  });
}

function calls(result) {
  return result.stdout.trim() ? result.stdout.trim().split('\n').map(line => JSON.parse(line)) : [];
}

test('compatibility inventory is nonempty, unique, and names existing regression suites', () => {
  assert.equal(validateCompatibilityInventory(repoRoot), compatibilityTestFiles);
  assert.throws(() => validateCompatibilityInventory(repoRoot, []), /must not be empty/);
  const file = compatibilityTestFiles[0];
  assert.throws(() => validateCompatibilityInventory(repoRoot, [file, file]), /Duplicate/);
  assert.throws(() => validateCompatibilityInventory(repoRoot, ['test/missing-compat.test.mjs']), /Missing/);
  for (const unsafe of ['../test/cli.test.mjs', 'test/golden.mjs', path.join(repoRoot, file)]) {
    assert.throws(() => validateCompatibilityInventory(repoRoot, [unsafe]), /Invalid/);
  }
});

test('compatibility retains whole runtime-sensitive suites and the noncanonical ZIP contract', () => {
  for (const name of [
    'cli', 'preview', 'preview-force-stop', 'update-notifier', 'update-contract',
    'finalize', 'finalize-browser-lifecycle', 'renderer-import-isolation',
    'renderer-diagnostic-boundary', 'render-failure-diagnostics',
    'atomic-output-recovery', 'renderer-atomic-write', 'artifact-receipt-flush',
    'path-semantics', 'path-boundary-contract', 'native-output-path', 'output-path',
    'portable-path', 'delivery-sidecar-path', 'sidecar-path-length',
    'generate-validators', 'v1-compatibility', 'base-input-compatibility',
    'workflow-migration', 'release-package-gates',
    'brand-marks', 'brand-content-encoding',
  ]) assert.ok(compatibilityTestFiles.includes(`test/${name}.test.mjs`), `${name} must retain compatibility coverage`);
});

test('compatibility runs all goldens before delegating its exact inventory from an unrelated cwd', (t) => {
  const result = interceptedRun(t);
  assert.equal(result.status, 0, result.stderr);
  const observed = calls(result);
  assert.deepEqual(observed.map(call => call.args), [
    ['test/golden.mjs'], ['scripts/run-tests.mjs', ...compatibilityTestFiles],
  ]);
  for (const call of observed) {
    assert.equal(call.command, process.execPath);
    assert.equal(fs.realpathSync(call.cwd), fs.realpathSync(repoRoot));
  }
  assert.match(result.stderr, /Compatibility tests: golden outputs plus \d+ runtime suites/);
});

test('compatibility listing starts neither goldens nor child tests', (t) => {
  const result = interceptedRun(t, ['--list']);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trim().split('\n'), compatibilityTestFiles);
  assert.equal(result.stderr, '');
});

test('compatibility rejects unknown suites and invalid options before any execution', (t) => {
  for (const args of [
    ['test/gallery.test.mjs'], ['test/missing.test.mjs'], ['--unknown'],
    ['--concurrency=0'], ['--test-name-pattern='], ['--test-name-pattern=['],
  ]) {
    const result = interceptedRun(t, args);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stdout, '');
  }
});

test('compatibility forwards shared runner options and exact selections without filtering goldens', (t) => {
  const file = 'test/cli.test.mjs';
  const flags = [
    ...(supportsConcurrency ? ['--concurrency=1'] : []),
    ...(supportsNamePattern ? ['--test-name-pattern=cli: validate'] : []),
  ];
  const result = interceptedRun(t, [path.join(repoRoot, file), file, ...flags]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(calls(result).map(call => call.args), [
    ['test/golden.mjs'], ['scripts/run-tests.mjs', ...flags, file],
  ]);
});

for (const stage of [0, 1]) {
  for (const outcome of [{ status: 7 }, { status: null }, { signal: 'SIGTERM' }, { error: 'spawn failed' }]) {
    test(`compatibility propagates ${stage === 0 ? 'golden' : 'suite'} failure (${outcome.error || outcome.signal || outcome.status})`, (t) => {
      const outcomes = [{ status: 0 }, { status: 0 }];
      outcomes[stage] = outcome;
      const result = interceptedRun(t, [], outcomes);
      assert.equal(result.status, outcome.signal || outcome.error ? 1 : (outcome.status ?? 1), result.stderr);
      assert.equal(calls(result).length, stage + 1, 'a failed golden must not start compatibility suites');
      if (outcome.signal) assert.match(result.stderr, /terminated by SIGTERM/);
      if (outcome.error) assert.match(result.stderr, /spawn failed/);
    });
  }
}

test('compatibility goldens cover every advertised diagram type', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'test/golden.mjs'), 'utf8');
  const fixtures = source.match(/const GOLDEN = \[([\s\S]*?)\n\];/)?.[1];
  assert.ok(fixtures, 'golden harness must declare its representative rendered fixtures');
  const modes = new Set([...fixtures.matchAll(/\['([a-z]+)',/g)].map(match => match[1]));
  assert.deepEqual([...modes].sort(), [
    'architecture', 'class', 'dataflow', 'erd', 'lifecycle',
    'sequence', 'timeline', 'tree', 'waterfall', 'workflow',
  ]);
});

test('CI keeps all Node check names while separating canonical regressions and compatibility', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  assert.equal(manifest.scripts['test:compat'], 'node scripts/run-compat-tests.mjs');
  assert.match(manifest.scripts.test, /check:viewer/);
  assert.match(manifest.scripts.test, /check:brand-marks/);
  assert.match(manifest.scripts.test, /check:validators/);
  assert.match(manifest.scripts.test, /check:release-identity/);
  assert.match(manifest.scripts.test, /node test\/golden\.mjs/);
  assert.match(manifest.scripts.test, /node scripts\/run-tests\.mjs$/);
  const ci = parse(fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8'));
  const job = ci.jobs.test;
  assert.deepEqual(job.strategy.matrix['node-version'], [18, 20, 22, 24]);
  assert.equal(job.name, undefined, 'preserve generated matrix check names');
  const full = job.steps.find(step => step.run === 'npm test');
  const compatibility = job.steps.find(step => step.run === 'npm run test:compat');
  assert.equal(full?.if, "needs.scope.outputs.scope == 'full' && matrix.node-version == 22");
  assert.equal(compatibility?.if, "needs.scope.outputs.scope == 'full' && matrix.node-version != 22");
  const release = parse(fs.readFileSync(path.join(repoRoot, '.github/workflows/release.yml'), 'utf8'));
  assert.equal(release.jobs.release.steps.find(step => step.with?.['node-version'])?.with['node-version'], 22);
  assert.equal(release.jobs.release.steps.filter(step => step.run === 'npm test').length, 1);
});
