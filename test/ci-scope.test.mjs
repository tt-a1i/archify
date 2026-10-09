import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { classifyPaths, comparisonPlan } from '../scripts/ci-scope.mjs';
import { selectAffectedTests } from '../scripts/run-affected-tests.mjs';

const workflow = parse(fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));

test('owned changes add their real gates without requiring every unrelated lane', () => {
  assert.equal(classifyPaths(['README.md', 'docs/assets/community/qq.svg']).scope, 'docs');
  const render = classifyPaths(['archify/renderers/workflow/render-workflow.mjs']);
  assert.equal(render.scope, 'core');
  assert.deepEqual(render.owners, ['workflow']);
  assert.ok(render.generated && render.browser && render.package);
  assert.equal(render.windows, false);
  assert.equal(classifyPaths(['archify/renderers/workflow/render-workflow.mjs', 'archify.zip']).scope, 'core');
  assert.equal(classifyPaths(['archify.zip']).scope, 'full');
  const newBrowser = classifyPaths(['test/new-browser.test.mjs']);
  assert.equal(newBrowser.browser, true);
  assert.ok(newBrowser.changedTests.includes('test/browser-gate.test.mjs'));
  const mixed = classifyPaths(['package-lock.json', 'test/new-browser.test.mjs']);
  assert.equal(mixed.scope, 'full');
  assert.ok(mixed.changedTests.includes('test/browser-gate.test.mjs'));
  const viewer = classifyPaths(['viewer/toolbar.mjs', 'archify.zip']);
  assert.ok(viewer.browser && viewer.webm);
  const website = classifyPaths(['website/src/pages/index.astro']);
  assert.ok(website.website);
  assert.equal(website.browser, false);
  assert.equal(website.package, false);
  assert.ok(classifyPaths(['docs/skill-updates/archify/stable.json']).manifest);
});

test('recipe, schema and shared renderer owners include their real source consumers', () => {
  const available = ['test/guide.test.mjs', 'test/guide-page.test.mjs', 'test/gallery.test.mjs', 'test/start-page.test.mjs', 'test/engineering-profile.test.mjs', 'test/legend-contract.test.mjs', 'test/generate-validators.test.mjs'];
  const recipe = classifyPaths(['archify/recipes/scenarios.mjs']);
  assert.equal(recipe.scope, 'core');
  assert.equal(recipe.website, true);
  assert.deepEqual(selectAffectedTests(recipe.owners, [], available), available.slice(0, 4).sort());
  const shared = classifyPaths(['archify/renderers/shared/engineering-profiles.mjs', 'archify/renderers/shared/legend.mjs']);
  const selected = selectAffectedTests(shared.owners, [], available);
  assert.ok(selected.includes('test/engineering-profile.test.mjs'));
  assert.ok(selected.includes('test/legend-contract.test.mjs'));
  const schema = classifyPaths(['archify/schemas/workflow.schema.json']);
  assert.equal(schema.scope, 'core');
  assert.ok(selectAffectedTests(schema.owners, [], available).includes('test/generate-validators.test.mjs'));
});

test('Architecture grid changes retain explicit placement regression coverage', () => {
  const available = ['test/grid.test.mjs', 'test/architecture-first-draft.test.mjs', 'test/cli.test.mjs'];
  const plan = classifyPaths(['archify/renderers/architecture/grid.mjs']);
  assert.equal(plan.scope, 'core');
  assert.ok(plan.generated && plan.browser && plan.package);
  const selected = selectAffectedTests(plan.owners, [], available);
  assert.ok(selected.includes('test/grid.test.mjs'));
  assert.ok(!selected.includes('test/cli.test.mjs'));
});

test('the grid shared by ERD and Class retains both modes and their compatibility checks', () => {
  const available = ['test/erd-rendering.test.mjs', 'test/class-rendering.test.mjs', 'test/tree-rendering.test.mjs'];
  const plan = classifyPaths(['archify/renderers/erd/grid.mjs']);
  assert.equal(plan.scope, 'core');
  assert.ok(plan.owners.includes('erd') && plan.owners.includes('class'));
  assert.deepEqual(selectAffectedTests(plan.owners, [], available), available.slice(0, 2).sort());
});

test('the router shared by Architecture, ERD and Class retains all three callers', () => {
  const available = ['test/architecture-first-draft.test.mjs', 'test/erd-rendering.test.mjs',
    'test/class-rendering.test.mjs', 'test/tree-rendering.test.mjs'];
  const plan = classifyPaths(['archify/renderers/architecture/routing.mjs']);
  assert.equal(plan.scope, 'core');
  assert.ok(plan.generated && plan.browser && plan.package);
  assert.ok(['architecture', 'erd', 'class'].every(owner => plan.owners.includes(owner)));
  assert.deepEqual(selectAffectedTests(plan.owners, [], available), available.slice(0, 3).sort());
});

test('renderer changes retain cross-mode public regressions even without changing those tests', () => {
  const regressions = ['test/automatic-port-spread.test.mjs', 'test/edge-label-color.test.mjs',
    'test/label-clearance.test.mjs', 'test/vertical-edge.test.mjs', 'test/node-icons.test.mjs'];
  const available = [...regressions, 'test/cli.test.mjs'];
  for (const source of ['archify/renderers/dataflow/render-dataflow.mjs',
    'archify/renderers/sequence/render-sequence.mjs', 'archify/renderers/shared/geometry.mjs']) {
    const plan = classifyPaths([source]);
    assert.equal(plan.scope, 'core');
    assert.deepEqual(selectAffectedTests(plan.owners, [], available), regressions.slice().sort(), source);
  }
});

test('checked artifacts retain XML integrity and compare artifact regression coverage', () => {
  const available = ['test/generated-artifact-xml.test.mjs', 'test/architecture-delta.test.mjs'];
  for (const name of ['examples/checkout-platform-delta.html', 'docs/guide.html', 'archify/examples/rendered.html', 'docs/assets/example.svg']) {
    const plan = classifyPaths([name]);
    assert.equal(plan.scope, 'core');
    assert.ok(selectAffectedTests(plan.owners, [], available).includes('test/generated-artifact-xml.test.mjs'), name);
  }
  const delta = classifyPaths(['examples/checkout-platform-delta.html']);
  assert.ok(selectAffectedTests(delta.owners, [], available).includes('test/architecture-delta.test.mjs'));
});

test('generated site outputs retain proof and handoff consumer checks', () => {
  const available = ['test/gallery.test.mjs', 'test/guide-page.test.mjs', 'test/start-page.test.mjs', 'test/generated-artifact-xml.test.mjs'];
  for (const name of ['docs/gallery/manifest.json', 'docs/gallery.html', 'docs/guide.html', 'docs/start.html']) {
    const plan = classifyPaths([name]);
    assert.equal(plan.scope, 'core');
    assert.equal(plan.website, true);
    assert.deepEqual(selectAffectedTests(plan.owners, [], available), available.slice().sort(), name);
  }
  assert.ok(!classifyPaths(['docs/assets/ordinary.png']).owners.includes('site'));
});

test('unknown and delivery/build/fixture changes conservatively require every gate', () => {
  for (const paths of [[], ['unknown.txt'], ['scripts/ci-scope.mjs'], ['package-lock.json'], ['.github/workflows/ci.yml'], ['archify/bin/archify.mjs'], ['archify/renderers/shared/atomic-output.mjs'], ['test/fixtures/input.json'], ['test/helpers.mjs']]) {
    const plan = classifyPaths(paths);
    assert.equal(plan.scope, 'full', `${paths}`);
    for (const gate of ['generated', 'browser', 'webm', 'package', 'windows', 'manifest', 'website']) assert.equal(plan[gate], true, `${paths}: ${gate}`);
  }
});

test('new changed tests run, deleted tests do not, and invalid selectors fail', () => {
  const changed = ['test/new-behavior.test.mjs', 'test/deleted.test.mjs'];
  const plan = classifyPaths(changed);
  assert.equal(plan.scope, 'core');
  const available = ['test/new-behavior.test.mjs', 'test/workflow-compiler.test.mjs', 'test/update-notifier.test.mjs'];
  assert.deepEqual(selectAffectedTests([], plan.changedTests, available), ['test/new-behavior.test.mjs']);
  assert.deepEqual(selectAffectedTests(['workflow'], changed, available), ['test/new-behavior.test.mjs', 'test/workflow-compiler.test.mjs']);
  assert.throws(() => selectAffectedTests(['unknown'], [], available));
  assert.throws(() => selectAffectedTests([], ['../outside.test.mjs'], available));
});

test('main/manual are exhaustive; invalid dev base falls back to full but PR base fails', () => {
  const fail = () => { throw new Error('base not found'); };
  assert.equal(comparisonPlan({ event: 'workflow_dispatch' }).scope, 'full');
  assert.equal(comparisonPlan({ event: 'push', ref: 'refs/heads/main' }).scope, 'full');
  assert.equal(comparisonPlan({ event: 'push', ref: 'refs/heads/dev', base: '0'.repeat(40) }).scope, 'full');
  assert.equal(comparisonPlan({ event: 'push', ref: 'refs/heads/dev', base: 'a'.repeat(40) }, fail).scope, 'full');
  assert.throws(() => comparisonPlan({ event: 'pull_request', base: 'bad' }));
  assert.throws(() => comparisonPlan({ event: 'pull_request', base: 'a'.repeat(40) }, fail));
});

test('real Git comparison retains rename source ownership and detects added tests', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-scope-'));
  try {
    const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git(['init', '-q']); git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.invalid']);
    fs.writeFileSync(path.join(root, 'runtime.js'), 'runtime');
    git(['add', '.']); git(['commit', '-qm', 'base']);
    const base = git(['rev-parse', 'HEAD']).trim();
    git(['mv', 'runtime.js', 'README.md']); git(['commit', '-qm', 'rename']);
    assert.equal(comparisonPlan({ event: 'pull_request', base }, git).scope, 'full');
    const renamed = git(['rev-parse', 'HEAD']).trim();
    fs.mkdirSync(path.join(root, 'test')); fs.writeFileSync(path.join(root, 'test/new.test.mjs'), '// new');
    git(['add', '.']); git(['commit', '-qm', 'new test']);
    assert.deepEqual(comparisonPlan({ event: 'push', ref: 'refs/heads/dev', base: renamed }, git).changedTests, ['test/new.test.mjs']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('required jobs fail when classification fails or returns an unknown scope', () => {
  for (const name of ['test', 'canonical-test', 'browser-regression', 'webm-decode', 'zip-freshness', 'published-update-manifest', 'package-smoke', 'windows-test-portability']) {
    const step = workflow.jobs[name].steps.find(step => step.name === 'Require successful scope checks');
    assert.ok(step, name);
    for (const [result, scope, status] of [['success', 'core', 0], ['success', 'full', 0], ['failure', 'core', 1], ['success', '', 1], ['success', 'unknown', 1]]) {
      const run = spawnSync('bash', ['-e', '-c', step.run], { env: { ...process.env, SCOPE_RESULT: result, CI_SCOPE: scope } });
      assert.equal(run.status, status, `${name}: ${result}/${scope}`);
    }
  }
  const fetch = workflow.jobs.scope.steps.find(step => step.name === 'Fetch PR comparison base');
  assert.ok(fetch.run.includes('--depth=1') && fetch.run.includes('--no-tags'));
  assert.equal(fetch.if, "github.event_name == 'pull_request'");
});

test('canonical Node cannot pass full CI with failed, cancelled or skipped regression shards', () => {
  const step = workflow.jobs['canonical-test'].steps.find(step => step.name === 'Require complete regression shards');
  assert.equal(step.if, undefined, 'every canonical check must validate its complete regression dependency');
  assert.equal(step.env.REGRESSION_RESULT, '${{ needs.full-regression.result }}');
  assert.equal(step.env.CI_SCOPE, '${{ needs.scope.outputs.scope }}');
  for (const scope of ['full', 'core', 'docs', '', 'unknown']) {
    for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
      const expected = scope === 'full' ? result === 'success' : ['core', 'docs'].includes(scope) && result === 'skipped';
      const run = spawnSync('bash', ['-e', '-c', step.run], {
        env: { ...process.env, CI_SCOPE: scope, REGRESSION_RESULT: result },
      });
      assert.equal(run.status, expected ? 0 : 1, `${scope}/${result}`);
    }
  }
});
