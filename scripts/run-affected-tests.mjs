#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sameEntry } from '../archify/renderers/shared/path-semantics.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const mode = /^(architecture|workflow|sequence|dataflow|lifecycle|erd|class|tree|timeline|waterfall)-/;
// A few broad ownership families, not a source-to-test dependency graph.
const shared = /^(geometry|spatial-grid|svg-path-analysis|layout-rules|engineering-profile|legend-contract|render-|renderer-(?:diagnostic|import)|route-|authored-|spread-|text-|base-input-|v1-|brand-|semantic-legend|automatic-port-spread|edge-label-color|label-clearance|vertical-edge|node-icons)/;
const viewer = /^(viewer-|reader-|desktop-|semantic-|finder|focus|intent-|crossover-|animation|export-|motion-|offline-|i18n|relationship-|share-|reach-|presentation)/;
export function selectAffectedTests(owners, changed, available) {
  if (!Array.isArray(owners) || !Array.isArray(changed)) throw new Error('CI test selection must contain arrays');
  const allowed = new Set(['renderer', 'viewer', 'authoring', 'schema', 'site', 'artifact', 'delta', 'readme', 'architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'class', 'tree', 'timeline', 'waterfall']);
  if (owners.some(owner => !allowed.has(owner))) throw new Error('Unknown CI test owner');
  if (changed.some(name => !/^test\/[^/]+\.test\.mjs$/.test(name))) throw new Error('Invalid changed test path');
  return available.filter(file => {
    const name = path.basename(file);
    return changed.includes(file) || owners.some(owner =>
      owner === 'renderer' ? mode.test(name) || shared.test(name)
        : owner === 'viewer' ? viewer.test(name)
          : owner === 'authoring' ? /^(authoring-|skill-|diagram-guide|delivery-contract|workflow-semantic-contract|ordinary-model-floor|guide|gallery|start-page)/.test(name)
            : owner === 'site' ? /^(gallery|guide-page|start-page|generated-artifact-xml)\.test\.mjs$/.test(name)
            : owner === 'artifact' ? name === 'generated-artifact-xml.test.mjs'
            : owner === 'delta' ? name === 'architecture-delta.test.mjs'
            : owner === 'schema' ? /^(generate-validators|base-input-|v1-|workflow-migration)/.test(name)
            : owner === 'readme' ? name === 'readme-showcase.test.mjs'
              : name.startsWith(`${owner}-`) || shared.test(name)
                || (owner === 'architecture' && name === 'grid.test.mjs'));
  }).sort();
}
if (process.argv[1] && sameEntry(process.argv[1], fileURLToPath(import.meta.url)).status === 'match') {
  const available = fs.readdirSync(path.join(root, 'test')).filter(name => name.endsWith('.test.mjs')).map(name => `test/${name}`);
  const files = selectAffectedTests(JSON.parse(process.env.CI_TEST_OWNERS || '[]'), JSON.parse(process.env.CI_CHANGED_TESTS || '[]'), available);
  if (files.length) {
    const result = spawnSync(process.execPath, ['scripts/run-tests.mjs', ...files], { cwd: root, stdio: 'inherit' });
    if (result.error) throw result.error;
    process.exitCode = result.signal ? 1 : (result.status ?? 1);
  } else console.log('No additional owned regression suites; core gate remains required.');
}
