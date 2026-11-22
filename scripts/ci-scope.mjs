#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { browserTestFiles, storyMediaBrowserTest } from './browser-test-inventory.mjs';

const modes = 'architecture|workflow|sequence|dataflow|lifecycle|erd|class|tree|timeline|waterfall';
const rendererPath = new RegExp(`^archify/(?:renderers/(${modes})/|schemas/(${modes})\\.schema\\.json$)`);
const renderShared = /^(geometry|utils|i18n|route-quality|diagnostics|brand-marks|generated-validators|legend|layout-report|engineering-profiles|validator|generated-brand-marks|desktop-readability|text-fit|svg-path-analysis|automatic-labels|spatial-grid|change-marks)\.mjs$/;
// Review export and PR pack code renders through the Viewer styles and ships in the package.
const reviewExport = /^(archify\/renderers\/shared\/svg-(?:bake|export)\.mjs|archify\/pr\/[^/]+\.mjs)$/;
const atlasClient = /^archify\/modules\/code-analysis\/overlay\/client\/atlas\.(?:js|css)$/;
const atlasGuide = 'archify/modules/code-analysis/docs/USAGE.md';
const rootTest = /^test\/[^/]+\.test\.mjs$/;
const maintainedBrowserTests = new Set(browserTestFiles.map(name => `test/${name}`));
const browserGateTest = 'test/browser-gate.test.mjs';
const storyTest = `test/${storyMediaBrowserTest}`;
const atlasBrowserTest = name => name.startsWith('test/code-analysis-') && maintainedBrowserTests.has(name);
const sharedSvgBaker = 'archify/renderers/shared/svg-bake.mjs';
const gates = ['generated', 'browser', 'webm', 'package', 'windows', 'manifest', 'website'];
const storyPresentationFiles = new Set([
  'component-stage.mjs', 'story-svg.mjs', 'svg-bake.mjs', 'story-stage-html.mjs', 'story-plan.mjs',
  'story.js', 'story.css', 'story-attachment.js', 'story-attachment.css', 'story-audio.js',
  'story-container.js', 'story-export.js', 'story-stage-runtime.js', 'native-motion.js',
]);
export function classifyPaths(paths) {
  const plan = { scope: 'core', browserProfile: 'full', browserTests: [], owners: [], changedTests: [], ...Object.fromEntries(gates.map(name => [name, false])) };
  const full = () => ({ ...plan, scope: 'full', ...Object.fromEntries(gates.map(name => [name, true])) });
  if (!paths.length) return full();
  const own = owner => { if (!plan.owners.includes(owner)) plan.owners.push(owner); };
  let archiveChanged = false;
  let requireFull = false;
  for (const name of paths) {
    if (/^(docs|examples|archify\/examples)\/.*\.(html|svg)$/.test(name) && !name.startsWith('docs/assets/community/')) own('artifact');
    if (/^examples\/checkout-platform-delta\.(html|receipt\.json)$/.test(name)) own('delta');
    if (name === 'archify.zip') { archiveChanged = true; plan.package = true; continue; }
    if (rootTest.test(name)) {
      plan.changedTests.push(name);
      if (name === 'test/repository-evidence-replacement.test.mjs' || name === 'test/cli-delivery-lock.test.mjs') plan.windows = true;
      if (name === storyTest) plan.webm = true;
      if (maintainedBrowserTests.has(name) || name.endsWith('-browser.test.mjs')) {
        plan.browser = true;
        if (!plan.changedTests.includes(browserGateTest)) plan.changedTests.push(browserGateTest);
      }
      continue;
    }
    if (/^README(?:_EN|_ZH|_JA|_KO)?\.md$/.test(name)) { own('readme'); continue; }
    if (name === 'CHANGELOG.md') { own('changelog'); continue; }
    if (/^(CONTRIBUTING|REVIEWING|AGENTS|CODE_OF_CONDUCT|SECURITY)\.md$/.test(name)) { own('policy'); continue; }
    if (/^docs\/assets\/community\/[^/]+\.(png|svg)$/.test(name)) { own('readme-assets'); continue; }
    if (/^(website\/|docs\/)/.test(name)) {
      plan.website = true;
      if (/^docs\/(gallery(?:\/|\.html$)|guide\.html$|start\.html$)/.test(name)) own('site');
      if (/^docs\/skill-updates\//.test(name)) plan.manifest = true;
      continue;
    }
    if (atlasClient.test(name) || name === atlasGuide) {
      own('atlas'); plan.package = true;
      if (atlasClient.test(name)) plan.browser = true;
      continue;
    }
    const renderer = name.match(rendererPath);
    if (renderer) {
      own(renderer[1] || renderer[2]);
      // These mode-local helpers also serve other renderers directly.
      if (name === 'archify/renderers/erd/grid.mjs') own('class');
      if (name === 'archify/renderers/architecture/routing.mjs') {
        own('erd'); own('class');
      }
      if (renderer[2]) own('schema');
      plan.generated = plan.browser = plan.package = true;
      continue;
    }
    if (name === 'archify/schemas/story-choreography.schema.json') {
      own('schema'); plan.generated = plan.browser = plan.package = true; continue;
    }
    if (name.startsWith('archify/story/') && storyPresentationFiles.has(name.slice('archify/story/'.length))) {
      own('viewer'); plan.generated = plan.browser = plan.webm = plan.package = true; continue;
    }
    if (name.startsWith('archify/renderers/shared/') && renderShared.test(name.slice('archify/renderers/shared/'.length))) {
      own('renderer'); plan.generated = plan.browser = plan.package = true; continue;
    }
    if (reviewExport.test(name)) {
      own('pr'); plan.browser = plan.package = true;
      if (name === sharedSvgBaker) {
        own('viewer'); plan.generated = plan.webm = true;
      }
      continue;
    }
    if (/^(viewer\/|archify\/assets\/)/.test(name)) {
      own('viewer'); plan.generated = plan.browser = plan.webm = plan.package = true; continue;
    }
    // The companion PR Skill ships outside archify.zip, so it needs the PR
    // authoring suites and release-identity check without packaging gates.
    if (name.startsWith('archify-pr/')) {
      own('pr'); own('authoring'); plan.generated = true; continue;
    }
    if (/^archify\/(SKILL\.md$|references\/|recipes\/|examples\/)/.test(name)) {
      own('authoring'); plan.generated = plan.package = true;
      if (name.startsWith('archify/recipes/')) plan.website = true;
      continue;
    }
    if (/^examples\//.test(name)) { plan.generated = true; continue; }
    // Build inputs, dependencies, workflow/runner changes, filesystem/CLI helpers,
    // test fixtures and every unknown path require the complete gates.
    requireFull = true;
  }
  if (requireFull) return full();
  if (archiveChanged && !plan.owners.some(owner => ['renderer', 'viewer', 'authoring', 'schema', 'pr', 'atlas', ...modes.split('|')].includes(owner))) return full();
  if (paths.every(name => maintainedBrowserTests.has(name))) {
    // These suites also run their Node-only cases with Chrome available.
    plan.changedTests = [browserGateTest];
    plan.browserTests = paths.filter(name => name !== storyTest); // test:webm runs Story with FFmpeg.
    plan.browser = plan.browserTests.length > 0;
    if (plan.browser) plan.browserProfile = 'changed';
  } else if (paths.some(name => atlasClient.test(name)) &&
      paths.every(name => atlasClient.test(name) || name === atlasGuide || name === 'archify.zip' || atlasBrowserTest(name))) {
    plan.browserProfile = 'atlas';
  }
  if (plan.owners.every(owner => ['readme', 'changelog', 'policy', 'readme-assets'].includes(owner)) && !plan.changedTests.length && !gates.some(name => plan[name])) plan.scope = 'docs';
  return plan;
}

export function comparisonPlan({ event, ref, base }, git = args => execFileSync('git', args, { encoding: 'utf8' })) {
  if (event === 'workflow_dispatch' || (event === 'push' && ref === 'refs/heads/main')) return classifyPaths([]);
  if (!['pull_request', 'push'].includes(event)) return classifyPaths([]);
  if (!/^[0-9a-f]{40}$/.test(base || '') || /^0+$/.test(base)) {
    if (event === 'push') return classifyPaths([]);
    throw new Error('Missing or invalid PR base SHA');
  }
  try {
    // Renames retain both source and destination owners; compare trees, not merge-base.
    const changes = git(['diff', '--no-renames', '--name-status', '-z', base, 'HEAD']).split('\0');
    const paths = [];
    for (let index = 0; index < changes.length - 1; index += 2) {
      const [status, name] = changes.slice(index, index + 2);
      if (rootTest.test(name) && (status === 'D' || status === 'T')) return classifyPaths([]);
      paths.push(name);
    }
    return classifyPaths(paths);
  } catch (error) {
    if (event === 'push') return classifyPaths([]);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const plan = comparisonPlan({ event: process.env.CI_EVENT_NAME, ref: process.env.CI_REF, base: process.env.CI_BASE_SHA });
  console.log(`CI plan: ${JSON.stringify(plan)}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,
    Object.entries(plan).map(([name, value]) => `${name}=${Array.isArray(value) ? JSON.stringify(value) : value}\n`).join(''));
}
