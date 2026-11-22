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
const viewerTemplate = 'archify/assets/template.html';
const atlasBrowserTest = name => name.startsWith('test/code-analysis-') && maintainedBrowserTests.has(name);
const sharedSvgBaker = 'archify/renderers/shared/svg-bake.mjs';
const gates = ['generated', 'browser', 'webm', 'package', 'windows', 'manifest', 'website'];
const storyPresentationFiles = new Set([
  'component-stage.mjs', 'story-svg.mjs', 'svg-bake.mjs', 'story-stage-html.mjs', 'story-plan.mjs',
  'story.js', 'story.css', 'story-attachment.js', 'story-attachment.css', 'story-audio.js',
  'story-container.js', 'story-export.js', 'story-stage-runtime.js', 'native-motion.js',
]);
// Story's offline renderer uses authored SVG, styles and the motion governor.
// Native reader interactions are still tested by the ordinary Story browser
// suite when only the Viewer recording and artifact checks need FFmpeg.
const viewerInteraction = /^viewer\/(?:focus|intent-trace|node-finder|node-outline|route-probe|semantic-lens)\.js$/;
const viewerWithoutMedia = new Set(['viewer/README.md', 'viewer/tree-branches.js']);
const viewerMediaFixtures = new Set([
  'docs/gallery/artifacts/production-deployment.architecture.html', 'examples/checkout-platform-delta.html',
  'archify/examples/web-app.architecture.json', 'archify/examples/cache-miss-request.sequence.json',
  'archify/examples/product-analytics.dataflow.json', 'archify/examples/agent-run.lifecycle.json',
]);
// Both committed Story HTML fixtures are compared against the current renderer
// and their input in test:generated, even when this job only runs Viewer media.
const storyGoldenFixtures = new Set([
  'archify/examples/waterfall-checkout-request-rendered.html', 'archify/examples/workflow-agent-tool-call-rendered.html',
]);

function viewerRebuildCompanion(name) {
  return viewerInteraction.test(name) || viewerWithoutMedia.has(name) ||
    name === viewerTemplate || name === 'archify.zip' || name === 'CHANGELOG.md' ||
    rootTest.test(name) || /^(docs\/|examples\/|archify\/examples\/[^/]+\.html$)/.test(name);
}

function independentMediaPath(name) {
  return name === 'archify.zip' || name === 'CHANGELOG.md' ||
    /^archify\/(?:modules\/code-analysis|explainer)\//.test(name) ||
    /^test\/(?:code-analysis(?:-[^/]+)?|explainer-[^/]+|skill-metadata)\.test\.mjs$/.test(name) ||
    name === 'archify/references/explainer-authoring.md' || name.startsWith('docs/cases/explainer/') ||
    name === 'integrations/deepseek-harness/README.md' ||
    name === 'integrations/deepseek-harness/test/docs-contract.test.mjs';
}

export function classifyPaths(paths) {
  const plan = { scope: 'core', browserProfile: 'full', browserTests: [], webmProfile: 'full', owners: [], changedTests: [], ...Object.fromEntries(gates.map(name => [name, false])) };
  const full = (webm = true) => ({ ...plan, scope: 'full', ...Object.fromEntries(gates.map(name => [name, true])), webm });
  if (!paths.length) return full();
  const own = owner => { if (!plan.owners.includes(owner)) plan.owners.push(owner); };
  const media = new Set();
  const viewerRebuild = paths.some(name => viewerInteraction.test(name) || name === 'viewer/tree-branches.js') &&
    paths.every(viewerRebuildCompanion);
  let sharedRenderChanged = false;
  let archiveChanged = false;
  let requireFull = false;
  for (const name of paths) {
    if (/^(docs|examples|archify\/examples)\/.*\.(html|svg)$/.test(name) && !name.startsWith('docs/assets/community/')) own('artifact');
    if (/^examples\/checkout-platform-delta\.(html|receipt\.json)$/.test(name)) own('delta');
    if (name === 'archify.zip') { archiveChanged = true; plan.package = true; continue; }
    if (viewerMediaFixtures.has(name)) media.add('viewer');
    if (name === 'archify/examples/agent-tool-call.workflow.json') media.add('full');
    if (name === 'archify/examples/checkout-request.waterfall.json' ||
        (storyGoldenFixtures.has(name) && !viewerRebuild)) media.add('story');
    if (rootTest.test(name)) {
      plan.changedTests.push(name);
      if (name === 'test/repository-evidence-replacement.test.mjs' || name === 'test/cli-delivery-lock.test.mjs') plan.windows = true;
      if (name === storyTest) media.add('story');
      if (name === 'test/site-language-continuity.test.mjs') plan.website = true;
      if (maintainedBrowserTests.has(name) || name.endsWith('-browser.test.mjs')) {
        plan.browser = true;
        if (!plan.changedTests.includes(browserGateTest)) plan.changedTests.push(browserGateTest);
      }
      continue;
    }
    if (/^README(?:_EN|_ZH|_JA|_KO)?\.md$/.test(name)) { own('readme'); continue; }
    if (name === 'CHANGELOG.md') { own('changelog'); continue; }
    if (/^(CONTRIBUTING|REVIEWING|AGENTS|CODE_OF_CONDUCT|SECURITY|SECURITY_MODEL)\.md$/.test(name)) { own('policy'); continue; }
    if (/^journal\/geo-[^/]+\/[^/]+\.md$/.test(name)) continue;
    if (name === 'llms.txt' || name === 'docs/llms.txt') {
      own('llms');
      if (name.startsWith('docs/')) plan.website = true;
      continue;
    }
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
      sharedRenderChanged = true;
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
      media.add('story');
      own('schema'); plan.generated = plan.browser = plan.package = true; continue;
    }
    if (name.startsWith('archify/story/') && storyPresentationFiles.has(name.slice('archify/story/'.length))) {
      media.add('story');
      own('viewer'); plan.generated = plan.browser = plan.package = true; continue;
    }
    if (name.startsWith('archify/renderers/shared/') && renderShared.test(name.slice('archify/renderers/shared/'.length))) {
      sharedRenderChanged = true;
      own('renderer'); plan.generated = plan.browser = plan.package = true; continue;
    }
    if (reviewExport.test(name)) {
      own('pr'); plan.browser = plan.package = true;
      if (name === sharedSvgBaker) {
        media.add('story');
        own('viewer'); plan.generated = true;
      }
      continue;
    }
    if (/^(viewer\/|archify\/assets\/)/.test(name)) {
      if (viewerInteraction.test(name)) {
        media.add('viewer');
      } else if (!viewerWithoutMedia.has(name) && (name !== viewerTemplate || !viewerRebuild)) {
        media.add('full');
      }
      own('viewer'); plan.generated = plan.browser = plan.package = true; continue;
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
  if (requireFull) return full(!paths.every(independentMediaPath));
  if (archiveChanged && !plan.owners.some(owner => ['renderer', 'viewer', 'authoring', 'schema', 'pr', 'atlas', ...modes.split('|')].includes(owner))) return full();
  plan.webm = media.size > 0;
  if (media.size === 1 && !sharedRenderChanged) [plan.webmProfile] = media;
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
  if (plan.owners.every(owner => ['readme', 'llms', 'changelog', 'policy', 'readme-assets'].includes(owner)) && !plan.changedTests.length && !gates.some(name => plan[name])) plan.scope = 'docs';
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
      if (status === 'T' || (rootTest.test(name) && status === 'D')) return classifyPaths([]);
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
