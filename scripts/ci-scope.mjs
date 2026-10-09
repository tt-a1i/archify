#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { browserTestFiles } from './browser-test-inventory.mjs';

const modes = 'architecture|workflow|sequence|dataflow|lifecycle|erd|class|tree|timeline|waterfall';
const rendererPath = new RegExp(`^archify/(?:renderers/(${modes})/|schemas/(${modes})\\.schema\\.json$)`);
const renderShared = /^(geometry|utils|i18n|route-quality|diagnostics|brand-marks|generated-validators|legend|layout-report|engineering-profiles|validator|generated-brand-marks|desktop-readability|text-fit|svg-path-analysis|automatic-labels|spatial-grid)\.mjs$/;
const gates = ['generated', 'browser', 'webm', 'package', 'windows', 'manifest', 'website'];
export function classifyPaths(paths) {
  const plan = { scope: 'core', owners: [], changedTests: [], ...Object.fromEntries(gates.map(name => [name, false])) };
  const full = () => ({ ...plan, scope: 'full', ...Object.fromEntries(gates.map(name => [name, true])) });
  if (!paths.length) return full();
  const own = owner => { if (!plan.owners.includes(owner)) plan.owners.push(owner); };
  let archiveChanged = false;
  let requireFull = false;
  for (const name of paths) {
    if (/^(docs|examples|archify\/examples)\/.*\.(html|svg)$/.test(name) && !name.startsWith('docs/assets/community/')) own('artifact');
    if (/^examples\/checkout-platform-delta\.(html|receipt\.json)$/.test(name)) own('delta');
    if (name === 'archify.zip') { archiveChanged = true; plan.package = true; continue; }
    if (/^test\/[^/]+\.test\.mjs$/.test(name)) {
      plan.changedTests.push(name);
      if (browserTestFiles.includes(name.slice(5)) || name.endsWith('-browser.test.mjs')) {
        plan.browser = true;
        if (!plan.changedTests.includes('test/browser-gate.test.mjs')) plan.changedTests.push('test/browser-gate.test.mjs');
      }
      continue;
    }
    if (/^README(?:_EN|_ZH)?\.md$/.test(name)) { own('readme'); continue; }
    if (/^(CONTRIBUTING|REVIEWING|AGENTS|CODE_OF_CONDUCT|SECURITY)\.md$/.test(name)) continue;
    if (/^docs\/assets\/community\/[^/]+\.(png|svg)$/.test(name)) continue;
    if (/^(website\/|docs\/)/.test(name)) {
      plan.website = true;
      if (/^docs\/(gallery(?:\/|\.html$)|guide\.html$|start\.html$)/.test(name)) own('site');
      if (/^docs\/skill-updates\//.test(name)) plan.manifest = true;
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
    if (name.startsWith('archify/renderers/shared/') && renderShared.test(name.slice('archify/renderers/shared/'.length))) {
      own('renderer'); plan.generated = plan.browser = plan.package = true; continue;
    }
    if (/^(viewer\/|archify\/assets\/)/.test(name)) {
      own('viewer'); plan.generated = plan.browser = plan.webm = plan.package = true; continue;
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
  if (archiveChanged && !plan.owners.some(owner => ['renderer', 'viewer', 'authoring', 'schema', ...modes.split('|')].includes(owner))) return full();
  if (plan.owners.every(owner => owner === 'readme') && !plan.changedTests.length && !gates.some(name => plan[name])) plan.scope = 'docs';
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
    return classifyPaths(git(['diff', '--no-renames', '--name-only', '-z', base, 'HEAD']).split('\0').filter(Boolean));
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
