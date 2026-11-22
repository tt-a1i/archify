#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sameEntry } from '../archify/renderers/shared/path-semantics.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = /^(architecture|workflow|sequence|dataflow|lifecycle|erd|class|tree|timeline|waterfall)-/;
// A few broad ownership families, not a source-to-test dependency graph.
const shared = /^(geometry|spatial-grid|svg-path-(?:analysis|checker)|layout-rules|engineering-profile|legend-contract|render-|renderer-(?:diagnostic|import)|route-|authored-|spread-|text-|base-input-|v1-|brand-|semantic-legend|automatic-port-spread|edge-label-color|label-clearance|vertical-edge|node-icons|change-marks)/;
const viewer = /^(viewer-|reader-|desktop-|semantic-|finder|focus|intent-|crossover-|animation|export-|motion-|offline-|i18n|relationship-|share-|reach-|presentation|story-)/;
export function selectAffectedTests(owners, changed, available) {
  if (!Array.isArray(owners) || !Array.isArray(changed)) throw new Error('CI test selection must contain arrays');
  const allowed = new Set(['renderer', 'viewer', 'authoring', 'schema', 'pr', 'atlas', 'site', 'artifact', 'delta', 'readme', 'llms', 'changelog', 'policy', 'readme-assets', 'architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'class', 'tree', 'timeline', 'waterfall']);
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
            : owner === 'changelog' ? false
            : owner === 'policy' ? name === 'community-proof-intake.test.mjs'
            : owner === 'readme-assets' ? name === 'readme-showcase.test.mjs'
              : name.startsWith(`${owner}-`) || shared.test(name)
                || (owner === 'architecture' && name === 'grid.test.mjs'));
  }).sort();
}
if (process.argv[1] && sameEntry(process.argv[1], fileURLToPath(import.meta.url)).status === 'match') {
  const available = fs.readdirSync(path.join(root, 'test')).filter(name => name.endsWith('.test.mjs')).map(name => `test/${name}`);
  const owners = JSON.parse(process.env.CI_TEST_OWNERS || '[]');
  const files = selectAffectedTests(owners, JSON.parse(process.env.CI_CHANGED_TESTS || '[]'), available);
  const run = args => {
    const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.signal || result.status !== 0) process.exit(result.status || 1);
  };
  if (owners.some(owner => ['readme', 'changelog'].includes(owner))) run(['scripts/check-release-identity.mjs']);
  if (owners.includes('readme')) {
    // This consumer reads the README directly; the other cases need an Astro build.
    run(['--test', '--test-name-pattern=README entry points', 'website/test/agent-diagrams.test.mjs']);
    run(['--test', '--test-name-pattern=READMEs', 'test/automatic-port-spread.test.mjs',
      'test/reach-share-card.test.mjs', 'test/route-share-card.test.mjs']);
    run(['--test', 'integrations/deepseek-harness/test/docs-contract.test.mjs']);
    run(['--test', '--test-name-pattern=README install tables', 'integrations/hermes-agent/test/plugin-contract.test.mjs']);
  }
  if (owners.includes('atlas')) {
    run(['--test', ...['atlas', 'client-assets', 'source-panel'].map(name =>
      `archify/modules/code-analysis/test/${name}.test.mjs`)]);
  }
  if (files.length) run(['scripts/run-tests.mjs', ...files]);
  else console.log('No owned regression suites selected.');
}
