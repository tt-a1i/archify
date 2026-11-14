import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { extractFacts, buildGraph, evaluateGraph, loadConfig } from '../lib/analysis.mjs';
import { comparability } from '../lib/review.mjs';
import { schemaErrors } from '../schemas/index.mjs';

test('nested source roots preserve feature boundaries, stable root anchors, and explicit grouping controls', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-nested-roots-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    'package.json': '{}',
    'web/package.json': '{}',
    'gateway/package.json': '{}',
    'src/server/main.ts': 'export const server = 1;\n' + '// server context\n'.repeat(500),
    'src/shared/value.ts': 'export const value = 1;\n',
    'src/cli/main.ts': 'export const cli = 1;\n',
    'web/src/main.ts': "import {page} from './pages/page';\nexport const main = page;\n",
    'web/src/pages/page.ts': "import {value} from '../../../src/shared/value';\nexport const page = value;\n",
    'web/src/components/button.ts': 'export const button = 1;\n',
    'gateway/src/main.ts': "import {value} from '../../src/shared/value';\nexport const gateway = value;\n",
    'gateway/src/routes/route.ts': 'export const route = 1;\n',
    'scripts/build.ts': 'export const build = 1;\n',
    'vitest.config.ts': 'export default {};\n',
    'web/jest.config.cjs': 'module.exports = {};\n',
    'gateway/playwright.config.mts': 'export default {};\n',
    'web/vitest.workspace.ts': 'export default [];\n',
    'karma.conf.js': 'module.exports = {};\n',
    'cypress.config.js': 'module.exports = {};\n',
  };
  for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); }
  const { facts, config } = extractFacts(root, { language: 'ts' });
  assert.ok(facts.files.filter(f => /(?:config|conf|workspace)\./.test(f.path)).every(f => f.role === 'test'));
  assert.equal(facts.files.filter(f => f.role === 'test').length, 6);
  const graph = buildGraph(facts, config);
  assert.deepEqual(schemaErrors('module-graph', graph), []);
  assert.deepEqual(graph.modules.map(m => m.path), ['gateway/src', 'gateway/src/routes', 'scripts', 'src/cli', 'src/server', 'src/shared', 'web/src', 'web/src/components', 'web/src/pages']);
  assert.equal(graph.grouping.typescript, 'nested-source-roots-v2');
  assert.equal(graph.fileModules['src/server/main.ts'], 'src-server');
  assert.equal(graph.fileModules['web/src/pages/page.ts'], 'web-src-pages');
  assert.ok(!('vitest.config.ts' in graph.fileModules));
  const legacy = buildGraph(facts, { ...config, modules: { depth: 2 } });
  assert.equal(legacy.fileModules['web/src/pages/page.ts'], 'web');
  assert.equal(legacy.fileModules['gateway/src/routes/route.ts'], 'gateway');
  const directoryOnly = buildGraph(facts, { ...config, modules: { packageBoundaries: false } });
  assert.equal(directoryOnly.fileModules['web/src/pages/page.ts'], 'web-src');
  const grouped = buildGraph(facts, { ...config, modules: { groups: { frontend: ['web/**'] } } });
  assert.equal(grouped.fileModules['web/src/pages/page.ts'], 'frontend');
  const before = evaluateGraph(legacy, config, facts), after = evaluateGraph(graph, config, facts);
  const concentration = f => f.diagnostics.find(d => d.code === 'coupling/concentration' && d.subject.module === 'src-server');
  assert.ok(concentration(before)); assert.equal(concentration(before).id, concentration(after).id);
  assert.equal(comparability(before.analysis, after.analysis).comparable, false, 'regrouping must not be described as a source fix');
  const historicalGraph = structuredClone(graph); delete historicalGraph.grouping.typescript;
  assert.deepEqual(schemaErrors('module-graph', historicalGraph), [], 'historical graph shape stays accepted');
  historicalGraph.grouping.typescript = 'nested-source-roots-v1';
  assert.deepEqual(schemaErrors('module-graph', historicalGraph), [], 'first-src captures remain readable');
  assert.equal(comparability(evaluateGraph(historicalGraph, config, facts).analysis, after.analysis).comparable, false, 'the grouping correction is not misreported as a code fix');
  const override = extractFacts(root, { language: 'ts', config: { ...loadConfig(), roles: { test: [], generated: [] } } }).facts;
  assert.equal(override.files.find(f => f.path === 'vitest.config.ts').role, 'source');
  const rootFacts = { ...facts, files: facts.files.filter(f => f.path.startsWith('src/')), imports: [] };
  const single = buildGraph(rootFacts, config);
  assert.deepEqual(single.modules.map(m => m.path), ['src/cli', 'src/server', 'src/shared']);
  assert.equal(single.grouping.typescript, undefined);
});

test('applications below another src root retain distinct features and real cross-module edges', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-repeated-src-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    'src/core/value.ts': 'export const value = 1;\n',
    'src/apps/web/src/pages/page.ts': "import {button} from '../components/button';\nexport const page = button;\n",
    'src/apps/web/src/components/button.ts': 'export const button = 1;\n',
    'packages/src/web/src/pages/page.ts': "import {button} from '../components/button';\nexport const page = button;\n",
    'packages/src/web/src/components/button.ts': 'export const button = 1;\n',
  };
  for (const [file, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text); }
  const { facts, config } = extractFacts(root, { language: 'ts' });
  const graph = buildGraph(facts, config);
  assert.equal(graph.fileModules['src/core/value.ts'], 'src-core');
  for (const prefix of ['src/apps/web/src', 'packages/src/web/src']) {
    const page = graph.fileModules[`${prefix}/pages/page.ts`], button = graph.fileModules[`${prefix}/components/button.ts`];
    assert.notEqual(page, button);
    assert.equal(graph.modules.find(m => m.id === page).path, `${prefix}/pages`);
    assert.equal(graph.modules.find(m => m.id === button).path, `${prefix}/components`);
    assert.ok(graph.edges.some(e => e.from === page && e.to === button && e.weight === 1));
  }
  const legacy = buildGraph(facts, { ...config, modules: { depth: 2 } });
  assert.equal(legacy.fileModules['src/apps/web/src/pages/page.ts'], 'src-apps');
  assert.equal(legacy.fileModules['packages/src/web/src/pages/page.ts'], 'packages-src');
  const grouped = buildGraph(facts, { ...config, modules: { groups: { frontend: ['src/apps/web/**'] } } });
  assert.equal(grouped.fileModules['src/apps/web/src/pages/page.ts'], 'frontend');
  assert.equal(grouped.fileModules['src/apps/web/src/components/button.ts'], 'frontend');
});
