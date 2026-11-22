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
  assert.equal(classifyPaths(['README_JA.md']).scope, 'docs');
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

test('Atlas-only changes keep CLI, overlay, browser and package checks without unrelated gates', () => {
  const paths = ['archify/modules/code-analysis/overlay/client/atlas.js',
    'archify/modules/code-analysis/docs/USAGE.md', 'archify.zip', 'test/code-analysis-browser.test.mjs'];
  const plan = classifyPaths(paths);
  assert.equal(plan.scope, 'core');
  assert.equal(plan.browserProfile, 'atlas');
  assert.deepEqual(plan.owners, ['atlas']);
  assert.ok(plan.browser && plan.package);
  assert.ok(!plan.webm && !plan.website && !plan.windows);
  assert.deepEqual(selectAffectedTests(plan.owners, plan.changedTests, [
    'test/browser-gate.test.mjs', 'test/code-analysis.test.mjs', 'test/code-analysis-browser.test.mjs',
    'test/export-browser.test.mjs',
  ]), ['test/browser-gate.test.mjs', 'test/code-analysis-browser.test.mjs', 'test/code-analysis.test.mjs']);
  assert.equal(workflow.jobs.scope.outputs.browserProfile, '${{ steps.classify.outputs.browserProfile }}');
  assert.equal(classifyPaths([...paths, 'viewer/viewer.css']).browserProfile, 'full');
  assert.equal(classifyPaths([...paths, 'test/export-browser.test.mjs']).browserProfile, 'full');
  for (const extra of ['archify/modules/code-analysis/extract/ts/index.mjs',
    'archify/modules/code-analysis/overlay/inject.mjs', 'archify/modules/code-analysis/overlay/client/atlas3d.js']) {
    const mixed = classifyPaths([...paths, extra]);
    assert.equal(mixed.scope, 'full', extra);
    assert.equal(mixed.browserProfile, 'full', extra);
  }
  assert.equal(classifyPaths(['test/story-browser.test.mjs']).webm, true);
});

test('independent browser test edits run the exact suites once with their owned runtime', () => {
  const i18n = 'test/i18n-browser.test.mjs';
  const desktop = 'test/desktop-reader-browser.test.mjs';
  const story = 'test/story-browser.test.mjs';
  const browserGate = 'test/browser-gate.test.mjs';
  const available = [i18n, desktop, story, browserGate];
  for (const [files, expectedBrowser, expectedWebm] of [
    [[i18n], [i18n], false],
    [[story], [], true],
    [[i18n, desktop, story], [i18n, desktop], true],
  ]) {
    const plan = classifyPaths(files);
    assert.equal(plan.scope, 'core');
    assert.equal(plan.browserProfile, expectedBrowser.length ? 'changed' : 'full');
    assert.equal(plan.browser, expectedBrowser.length > 0);
    assert.deepEqual(plan.browserTests, expectedBrowser);
    assert.equal(plan.webm, expectedWebm);
    assert.deepEqual(selectAffectedTests(plan.owners, plan.changedTests, available), [browserGate]);
  }

  for (const extra of ['archify/renderers/erd/grid.mjs', 'viewer/viewer.css', 'test/new-browser.test.mjs',
    'test/helpers/browser.mjs', 'test/fixtures/viewer.html', 'CONTRIBUTING.md']) {
    const plan = classifyPaths([i18n, extra]);
    assert.equal(plan.browserProfile, 'full', extra);
    assert.equal(plan.browser, true, extra);
    assert.deepEqual(plan.browserTests, [], extra);
    assert.ok(plan.changedTests.includes(i18n), extra);
  }
});

test('five README languages and changelog use documentation checks and preserve mixed product gates', () => {
  const readmes = ['README.md', 'README_EN.md', 'README_ZH.md', 'README_JA.md', 'README_KO.md'];
  const available = ['readme-showcase', 'readme-support', 'cursor-onboarding', 'llms-txt', 'skill-metadata',
    'preview-contract', 'community-proof-intake', 'real-repository-proof', 'workflow-compiler']
    .map(name => `test/${name}.test.mjs`);
  for (const file of readmes) {
    const plan = classifyPaths([file]);
    assert.equal(plan.scope, 'docs', file);
    assert.deepEqual(selectAffectedTests(plan.owners, [], available), available.slice(0, -1).sort());
    for (const gate of ['generated', 'browser', 'webm', 'package', 'windows', 'manifest', 'website']) assert.equal(plan[gate], false, `${file}: ${gate}`);
  }
  assert.deepEqual(selectAffectedTests(classifyPaths(['CONTRIBUTING.md']).owners, [], available), ['test/community-proof-intake.test.mjs']);
  assert.deepEqual(selectAffectedTests(classifyPaths(['docs/assets/community/qq.svg']).owners, [], available), ['test/readme-showcase.test.mjs']);
  const changelog = classifyPaths(['CHANGELOG.md']);
  assert.equal(changelog.scope, 'docs');
  assert.deepEqual(selectAffectedTests(changelog.owners, [], available), []);
  assert.equal(classifyPaths([...readmes, 'CHANGELOG.md']).scope, 'docs');
  const mixed = classifyPaths(['README_KO.md', 'CHANGELOG.md', 'archify/renderers/workflow/render-workflow.mjs']);
  assert.equal(mixed.scope, 'core');
  assert.ok(mixed.generated && mixed.browser && mixed.package);
  assert.deepEqual(selectAffectedTests(mixed.owners, [], available), available.slice().sort());
  assert.equal(classifyPaths(['README_JA.md', 'test/readme-support.test.mjs']).scope, 'core');
  for (const file of ['README_FR.md', 'CHANGELOG_ZH.md', 'archify/README.md']) assert.equal(classifyPaths([file]).scope, 'full', file);
});

test('documentation workflow installs parser dependencies and runs the affected contracts', () => {
  const steps = workflow.jobs.scope.steps;
  const install = steps.findIndex(step => step.name === 'Install documentation check dependencies');
  const check = steps.findIndex(step => step.name === 'Check affected documentation contracts');
  assert.ok(install >= 0 && check > install);
  assert.match(steps[install].if, /scope == 'docs'/);
  assert.match(steps[install].if, /'readme'/);
  assert.match(steps[install].if, /'changelog'/);
  assert.match(steps[install].run, /^npm ci\b/);
  assert.equal(steps[check].if, "steps.classify.outputs.scope == 'docs'");
  assert.equal(steps[check].run, 'npm run test:affected');
  assert.equal(steps[check].env.CI_TEST_OWNERS, '${{ steps.classify.outputs.owners }}');
});

test('Windows-only regressions retain native coverage and provision the package job for delivery-lock tests', () => {
  for (const file of ['test/repository-evidence-replacement.test.mjs', 'test/cli-delivery-lock.test.mjs']) {
    const plan = classifyPaths([file]);
    assert.equal(plan.scope, 'core', file);
    assert.equal(plan.windows, true, file);
    assert.deepEqual(plan.changedTests, [file]);
    assert.equal(plan.browser, false, file);
    assert.equal(plan.package, false, file);
  }
  const steps = workflow.jobs['package-smoke'].steps;
  for (const action of ['actions/checkout', 'actions/setup-node']) {
    const step = steps.find(step => step.uses?.startsWith(`${action}@`));
    assert.equal(step.if, "needs.scope.outputs.package == 'true' || (needs.scope.outputs.windows == 'true' && runner.os != 'Linux')");
  }
});

test('Story filesystem and process owners retain full regression and Windows gates', () => {
  for (const file of ['output.mjs', 'tool.mjs', 'cli.mjs', 'choreography-plan.mjs']) {
    const plan = classifyPaths([`archify/story/${file}`]);
    assert.equal(plan.scope, 'full', file);
    assert.equal(plan.windows, true, file);
  }
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
  const storySchema = classifyPaths(['archify/schemas/story-choreography.schema.json']);
  assert.equal(storySchema.scope, 'core');
  assert.ok(storySchema.owners.includes('schema') && storySchema.generated && storySchema.browser && storySchema.package);
  const storyMod = classifyPaths(['archify/story/story-svg.mjs']);
  assert.equal(storyMod.scope, 'core');
  assert.ok(storyMod.owners.includes('viewer') && storyMod.generated && storyMod.browser && storyMod.webm && storyMod.package);
});

test('shared SVG parser changes retain the public checker suite without selecting unrelated tests', () => {
  const available = ['test/svg-path-analysis.test.mjs', 'test/svg-path-checker.test.mjs',
    'test/cli.test.mjs', 'test/readme-showcase.test.mjs'];
  const plan = classifyPaths(['archify/renderers/shared/svg-path-analysis.mjs', 'archify.zip']);
  assert.equal(plan.scope, 'core');
  assert.deepEqual(plan.changedTests, []);
  assert.ok(plan.generated && plan.browser && plan.package);
  assert.deepEqual(selectAffectedTests(plan.owners, plan.changedTests, available), available.slice(0, 2));

  const prose = classifyPaths(['README.md']);
  assert.deepEqual(selectAffectedTests(prose.owners, prose.changedTests, available), ['test/readme-showcase.test.mjs']);
});

test('review export and PR pack changes retain their offline, export and sandbox suites', () => {
  const available = ['test/pr-pack.test.mjs', 'test/pr-attach.test.mjs', 'test/pr-attach-gitlab.test.mjs', 'test/svg-bake.test.mjs',
    'test/svg-export-img-browser.test.mjs', 'test/change-marks.test.mjs', 'test/cli.test.mjs', 'test/workflow-compiler.test.mjs'];
  for (const source of ['archify/renderers/shared/svg-export.mjs', 'archify/pr/attach.mjs']) {
    const plan = classifyPaths([source, 'archify.zip']);
    assert.equal(plan.scope, 'core', source);
    assert.deepEqual(plan.owners, ['pr']);
    assert.ok(plan.browser && plan.package, source);
    assert.equal(plan.generated, false);
    assert.deepEqual(selectAffectedTests(plan.owners, [], available), available.slice(0, 6).sort());
  }
  const marks = classifyPaths(['archify/renderers/shared/change-marks.mjs']);
  assert.deepEqual(marks.owners, ['renderer']);
  assert.ok(marks.generated && marks.browser && marks.package);
  assert.ok(selectAffectedTests(marks.owners, [], available).includes('test/change-marks.test.mjs'));
  const guide = classifyPaths(['archify/references/pr-review.md']);
  assert.deepEqual(guide.owners, ['authoring']);
  assert.ok(guide.generated && guide.package);
  assert.equal(guide.website, false);
});

test('the shared SVG baker runs both PR export and Story regression gates', () => {
  const plan = classifyPaths(['archify/renderers/shared/svg-bake.mjs', 'archify.zip']);
  assert.equal(plan.scope, 'core');
  assert.deepEqual(plan.owners, ['pr', 'viewer']);
  assert.ok(plan.generated && plan.browser && plan.webm && plan.package);
  const affected = ['test/pr-pack.test.mjs', 'test/svg-bake.test.mjs', 'test/story-choreography.test.mjs',
    'test/story-choreography-browser.test.mjs'];
  assert.deepEqual(selectAffectedTests(plan.owners, [], [...affected, 'test/cli.test.mjs']), affected.sort());
});

test('companion PR skill changes keep PR authoring suites without packaging or browser gates', () => {
  const available = ['test/skill-metadata.test.mjs', 'test/skill-installation.test.mjs',
    'test/pr-pack.test.mjs', 'test/pr-attach.test.mjs', 'test/cli.test.mjs'];
  for (const source of ['archify-pr/SKILL.md', 'archify-pr/bin/archify-pr.mjs',
    'archify-pr/references/pr-workflow.md', 'archify-pr/LICENSE']) {
    const plan = classifyPaths([source]);
    assert.equal(plan.scope, 'core', source);
    assert.deepEqual(plan.owners, ['pr', 'authoring'], source);
    assert.ok(plan.generated, source);
    assert.equal(plan.browser, false);
    assert.equal(plan.webm, false);
    assert.equal(plan.package, false);
    assert.equal(plan.website, false);
    assert.deepEqual(plan.changedTests, []);
    const selected = selectAffectedTests(plan.owners, [], available);
    for (const test of ['test/skill-metadata.test.mjs', 'test/skill-installation.test.mjs',
      'test/pr-pack.test.mjs', 'test/pr-attach.test.mjs']) {
      assert.ok(selected.includes(test), `${source}: ${test}`);
    }
    assert.ok(!selected.includes('test/cli.test.mjs'), source);
  }
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
    const browser = 'test/i18n-browser.test.mjs';
    fs.writeFileSync(path.join(root, browser), '// browser');
    git(['add', '.']); git(['commit', '-qm', 'new tests']);
    const added = git(['rev-parse', 'HEAD']).trim();
    fs.writeFileSync(path.join(root, browser), '// modified browser');
    git(['add', '.']); git(['commit', '-qm', 'modify browser test']);
    const modified = git(['rev-parse', 'HEAD']).trim();
    assert.deepEqual(comparisonPlan({ event: 'pull_request', base: added }, git).browserTests, [browser]);
    git(['mv', browser, 'test/desktop-reader-browser.test.mjs']);
    git(['commit', '-qm', 'rename browser test']);
    assert.equal(comparisonPlan({ event: 'pull_request', base: modified }, git).scope, 'full');
    const moved = git(['rev-parse', 'HEAD']).trim();
    git(['rm', 'test/desktop-reader-browser.test.mjs']);
    git(['commit', '-qm', 'delete browser test']);
    assert.equal(comparisonPlan({ event: 'pull_request', base: moved }, git).scope, 'full');
    assert.deepEqual(comparisonPlan({ event: 'push', ref: 'refs/heads/dev', base: renamed }, git).changedTests, ['test/new.test.mjs']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('required jobs fail when classification fails or returns an unknown scope', () => {
  for (const name of ['test', 'canonical-test', 'browser-regression', 'webm-decode', 'zip-freshness', 'published-update-manifest', 'package-smoke', 'windows-test-portability']) {
    const step = workflow.jobs[name].steps.find(step => step.name === 'Require successful scope checks');
    assert.ok(step, name);
    for (const [result, scope, status] of [['success', 'docs', 0], ['failure', 'docs', 1], ['success', 'core', 0], ['success', 'full', 0], ['failure', 'core', 1], ['success', '', 1], ['success', 'unknown', 1]]) {
      const run = spawnSync('bash', ['-e', '-c', step.run], {
        env: {
          ...process.env,
          SCOPE_RESULT: result,
          CI_SCOPE: scope,
          RUN_WINDOWS: 'true',
          CI_BROWSER: scope === 'full' ? 'true' : 'false',
          CI_BROWSER_PROFILE: 'full',
        },
      });
      assert.equal(run.status, status, `${name}: ${result}/${scope}`);
    }
  }
  const fetch = workflow.jobs.scope.steps.find(step => step.name === 'Fetch PR comparison base');
  assert.ok(fetch.run.includes('--depth=1') && fetch.run.includes('--no-tags'));
  assert.equal(fetch.if, "github.event_name == 'pull_request'");
});

test('Windows portability skips only a successful scope that explicitly excludes Windows', () => {
  const windows = workflow.jobs['windows-test-portability'];
  assert.equal(windows.if, "always() && !cancelled() && !(needs.scope.result == 'success' && needs.scope.outputs.windows == 'false' "
    + "&& (needs.scope.outputs.scope == 'docs' || needs.scope.outputs.scope == 'core'))");
  const guard = windows.steps.find(step => step.name === 'Require successful scope checks');
  assert.equal(guard.env.RUN_WINDOWS, '${{ needs.scope.outputs.windows }}');
  for (const flag of ['', 'false', 'true']) {
    const run = spawnSync('bash', ['-e', '-c', guard.run], {
      env: { ...process.env, SCOPE_RESULT: 'success', CI_SCOPE: 'full', RUN_WINDOWS: flag },
    });
    assert.equal(run.status, flag === 'true' ? 0 : 1, `full scope with Windows flag ${JSON.stringify(flag)}`);
  }
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
