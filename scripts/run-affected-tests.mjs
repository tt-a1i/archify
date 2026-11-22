#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { sameEntry } from '../archify/renderers/shared/path-semantics.mjs';
import { browserTestFiles, storyMediaBrowserTest } from './browser-test-inventory.mjs';
import { classifyPaths } from './ci-scope.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = /^(architecture|workflow|sequence|dataflow|lifecycle|erd|class|tree|timeline|waterfall)-/;
// A few broad ownership families, not a source-to-test dependency graph.
const shared = /^(geometry|spatial-grid|svg-path-(?:analysis|checker)|layout-rules|engineering-profile|legend-contract|render-|renderer-(?:diagnostic|import)|route-|authored-|spread-|text-|base-input-|v1-|brand-|semantic-legend|automatic-port-spread|edge-label-color|label-clearance|vertical-edge|node-icons|change-marks)/;
const viewer = /^(viewer-|reader-|desktop-|semantic-|finder|focus|intent-|crossover-|animation|export-|motion-|offline-|i18n|relationship-|share-|reach-|presentation|story-)/;
export function selectAffectedTests(owners, changed, available) {
  if (!Array.isArray(owners) || !Array.isArray(changed)) throw new Error('CI test selection must contain arrays');
  const allowed = new Set(['renderer', 'viewer', 'authoring', 'schema', 'pr', 'atlas', 'site', 'artifact', 'delta', 'readme', 'llms', 'changelog', 'policy', 'readme-assets', 'explainer', 'dsh-docs', 'architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'class', 'tree', 'timeline', 'waterfall']);
  if (owners.some(owner => !allowed.has(owner))) throw new Error('Unknown CI test owner');
  if (changed.some(name => !/^test\/[^/]+\.test\.mjs$/.test(name))) throw new Error('Invalid changed test path');
  return available.filter(file => {
    const name = path.basename(file);
    return changed.includes(file) || owners.some(owner =>
      owner === 'renderer' ? mode.test(name) || shared.test(name)
        : owner === 'viewer' ? viewer.test(name)
          : owner === 'atlas' ? name === 'code-analysis.test.mjs'
          : owner === 'authoring' ? /^(authoring-|skill-|diagram-guide|delivery-contract|workflow-semantic-contract|ordinary-model-floor|guide|gallery|start-page)/.test(name)
            : owner === 'site' ? /^(gallery|guide-page|start-page|generated-artifact-xml)\.test\.mjs$/.test(name)
            : owner === 'artifact' ? name === 'generated-artifact-xml.test.mjs'
            : owner === 'delta' ? name === 'architecture-delta.test.mjs'
            : owner === 'pr' ? /^(pr-|svg-bake|svg-export-|change-marks|export-svg)/.test(name)
            : owner === 'schema' ? /^(generate-validators|base-input-|v1-|workflow-migration)/.test(name)
            : owner === 'readme' ? /^(readme-showcase|readme-support|cursor-onboarding|llms-txt|skill-metadata|preview-contract|community-proof-intake|real-repository-proof)\.test\.mjs$/.test(name)
            : owner === 'llms' ? name === 'llms-txt.test.mjs'
            : owner === 'explainer' ? name.startsWith('explainer-') && name !== 'explainer-browser.test.mjs'
            : owner === 'changelog' || owner === 'dsh-docs' ? false
            : owner === 'policy' ? name === 'community-proof-intake.test.mjs'
            : owner === 'readme-assets' ? name === 'readme-showcase.test.mjs'
              : name.startsWith(`${owner}-`) || shared.test(name)
                || (owner === 'architecture' && name === 'grid.test.mjs'));
  }).sort();
}

function localPlan(args) {
  if (args.length > 1 || (args.length && !/^--base=.+$/.test(args[0]))) {
    throw new Error('Use pnpm run test:changed --base=<ref> to include committed changes.');
  }
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  const paths = new Set();
  const add = (status, file) => {
    if (!/^[ AM?]+$/.test(status)) {
      throw new Error(`Cannot narrow tests for ${file} with Git status ${status.trim()}. Review the change and use test:focus or test:full.`);
    }
    paths.add(file);
  };
  if (args.length) {
    const ref = args[0].slice('--base='.length);
    let base;
    try {
      const commit = git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
      base = git(['merge-base', commit, 'HEAD']).trim();
    } catch {
      throw new Error(`Cannot find a common commit for '${ref}' and HEAD. Check the ref or fetch its history.`);
    }
    const entries = git(['diff', '--no-renames', '--name-status', '-z', base, 'HEAD', '--']).split('\0');
    for (let index = 0; index < entries.length - 1; index += 2) add(entries[index], entries[index + 1]);
  }
  const dirty = git(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames']);
  for (const entry of dirty.split('\0').filter(Boolean)) add(entry.slice(0, 2), entry.slice(3));
  if (!paths.size) throw new Error('No changed files. Use pnpm test for the core smoke or supply --base=<ref> for a committed branch.');
  const plan = classifyPaths([...paths]);
  if (plan.scope === 'full') {
    throw new Error('The changed paths require broader verification. Use test:focus for a specific check or test:full for the complete Node suite.');
  }
  const browserFiles = [...new Set([
    ...plan.browserTests,
    ...browserTestFiles.map(file => `test/${file}`).filter(file => paths.has(file)),
  ])];
  // The Chrome runner validates exact files itself. CI still exercises its
  // whole inventory contract, including unregistered browser suites.
  const changedTests = plan.browserProfile === 'changed' && !paths.has('test/browser-gate.test.mjs')
    ? plan.changedTests.filter(file => file !== 'test/browser-gate.test.mjs') : plan.changedTests;
  return { ...plan, changedTests, browserFiles };
}

if (process.argv[1] && sameEntry(process.argv[1], fileURLToPath(import.meta.url)).status === 'match') {
  const args = process.argv.slice(2);
  const local = args[0] === '--local';
  let plan;
  if (local) {
    try {
      plan = localPlan(args.slice(1));
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  }
  const { CI_TEST_OWNERS, CI_CHANGED_TESTS } = process.env;
  if (!local && (args.length || (!CI_TEST_OWNERS && !CI_CHANGED_TESTS))) {
    throw new Error('Use pnpm run test:changed for local changes. The CI runner needs its scope outputs.');
  }
  const available = fs.readdirSync(path.join(root, 'test'))
    .filter(name => name.endsWith('.test.mjs')).map(name => `test/${name}`)
    .filter(file => !plan?.browserFiles.includes(file));
  const owners = plan?.owners ?? JSON.parse(CI_TEST_OWNERS || '[]');
  const files = selectAffectedTests(owners, plan?.changedTests ?? JSON.parse(CI_CHANGED_TESTS || '[]'), available);
  let checks = 0;
  const run = (args, env = process.env) => {
    checks++;
    const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.signal || result.status !== 0) process.exit(result.status || 1);
  };
  if (owners.some(owner => ['readme', 'changelog'].includes(owner))) run(['scripts/check-release-identity.mjs']);
  if (owners.includes('readme')) {
    // This consumer reads the README directly; the other cases need an Astro build.
    run(['--test', '--test-name-pattern=README entry points', 'website/test/agent-diagrams.test.mjs']);
    run(['--test', '--test-name-pattern=READMEs', 'test/automatic-port-spread.test.mjs',
      'test/reach-share-card.test.mjs', 'test/route-share-card.test.mjs']);
    run(['--test', '--test-name-pattern=README install tables', 'integrations/hermes-agent/test/plugin-contract.test.mjs']);
  }
  if (owners.some(owner => ['readme', 'dsh-docs'].includes(owner))) {
    run(['--test', 'integrations/deepseek-harness/test/docs-contract.test.mjs']);
  }
  if (owners.includes('atlas')) {
    run(['--test', ...['atlas', 'client-assets', 'source-panel'].map(name =>
      `archify/modules/code-analysis/test/${name}.test.mjs`)]);
  }
  if (files.length) run(['scripts/run-tests.mjs', ...files]);
  if (plan) {
    const story = `test/${storyMediaBrowserTest}`;
    const browser = plan.browserFiles.filter(file => file !== story);
    if (browser.length) run(['scripts/run-browser-tests.mjs', ...browser], {
      ...process.env, CI_BROWSER_PROFILE: 'full', CI_STORY_BROWSER_OWNER: 'browser',
    });
    if (plan.browserFiles.includes(story)) run(['test/webm-artifact.smoke.mjs', 'story']);
    if (!checks) {
      console.error('No runnable local checks for these paths. Use the applicable checks under Choose evidence by impact in CONTRIBUTING.md.');
      process.exit(1);
    }
    const extra = ['generated', 'browser', 'webm', 'package', 'windows', 'manifest', 'website']
      .filter(gate => plan[gate] && !(gate === 'browser' && plan.browserProfile === 'changed') &&
        !(gate === 'webm' && plan.webmProfile === 'story' && plan.browserFiles.includes(story)));
    if (plan.scope === 'core' && plan.compatibility) extra.unshift('core smoke');
    if (extra.length) console.log(`CI also selects ${extra.join(', ')}.`);
  } else if (!checks) {
    console.log('No owned regression suites selected.');
  }
}
