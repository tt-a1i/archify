import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { buildMapViews, dependencyLayers } from '../overlay/map-views.mjs';

const module = (id, extra = {}) => ({ id, label: id, path: id, files: 1, loc: 12, fanIn: 1, fanOut: 1, entry: [`${id}/index.ts`], ...extra });
function graph(modules, edges) { return { modules, edges: edges.map(([from, to]) => ({ from, to, weight: 2, evidence: [{ file: `${from}/index.ts`, line: 2, to: `${to}/index.ts` }] })), fileModules: Object.fromEntries(modules.map(m => [`${m.id}/index.ts`, m.id])) }; }

test('map: deterministic layers preserve cycles, branches and isolated modules', () => {
  const g = graph(['entry', 'core', 'leaf', 'peer', 'alone'].map(id => module(id)), [['entry', 'core'], ['core', 'leaf'], ['core', 'peer'], ['peer', 'core']]);
  const result = buildMapViews({ graph: g });
  const layers = Object.fromEntries(result.modules.map(m => [m.id, m.layer]));
  assert.deepEqual(layers, { alone: 0, core: 1, entry: 0, leaf: 2, peer: 1 });
  assert.deepEqual(result.edges.filter(e => e.cycle).map(e => [e.from, e.to]), [['core', 'peer'], ['peer', 'core']]);
  assert.deepEqual(result.edges.filter(e => e.backward).map(e => [e.from, e.to]), [['core', 'peer'], ['peer', 'core']]);
  const reversed = buildMapViews({ graph: { ...g, modules: [...g.modules].reverse(), edges: [...g.edges].reverse() } });
  assert.deepEqual(reversed.modules, result.modules);
  assert.equal(result.hasFacts, false); assert.deepEqual(result.files, []);
});

test('map: captured imports and bounded lexical calls retain source evidence and module ownership', () => {
  const g = graph([module('app'), module('lib')], [['app', 'lib']]);
  g.fileModules['app/helper.ts'] = 'app';
  const facts = { files: [{ path: 'app/index.ts', loc: 21 }, { path: 'app/helper.ts', loc: 7 }, { path: 'lib/index.ts', loc: 12 }, { path: 'excluded.ts', loc: 2 }], imports: [{ from: 'app/index.ts', to: 'lib/index.ts', resolved: true, line: 1 }], calls: [{ file: 'app/index.ts', line: 4, resolution: 'imported-function', target: { file: 'app/helper.ts', name: 'helper', line: 2 } }, { file: 'app/index.ts', line: 6, resolution: 'unresolved' }], callModel: 'js-ts-lexical-v5' };
  const findings = [{ id: 'complex', code: 'complexity/function', severity: 'warning', message: 'Complex helper', subject: { file: 'app/helper.ts' } }, { id: 'cycle', code: 'coupling/cycle', severity: 'error', subject: { modules: ['app', 'lib'] } }];
  const result = buildMapViews({ graph: g, facts, findings, review: { findings: { complex: { status: 'accepted' }, cycle: { status: 'accepted' } } } });
  assert.equal(result.files.length, 3);
  assert.deepEqual(result.internal, [{ from: 'app/index.ts', to: 'lib/index.ts', line: 1, kind: 'import' }, { from: 'app/index.ts', to: 'app/helper.ts', line: 4, targetLine: 2, name: 'helper', kind: 'call' }]);
  assert.equal(result.callModel, 'js-ts-lexical-v5');
  assert.deepEqual(result.modules.find(m => m.id === 'app').findings, ['complex', 'cycle']);
  assert.equal(result.modules.find(m => m.id === 'app').health, 'error');
  const acceptedOnly = buildMapViews({ graph: g, facts, findings: [findings[0]], review: { findings: { complex: { status: 'accepted' } } } });
  assert.equal(acceptedOnly.modules.find(m => m.id === 'app').health, 'clear');
});

test('map: deep graphs are stack safe and large captured facts stay proportional', () => {
  const ids = Array.from({ length: 12000 }, (_, i) => `m${i}`);
  const edges = ids.slice(1).map((id, i) => ({ from: ids[i], to: id }));
  const topology = dependencyLayers(ids, edges);
  assert.equal(topology.layers.get(ids.at(-1)), 11999);
  const modules = ids.slice(0, 400).map(id => module(id, { files: 10 }));
  const g = graph(modules, modules.slice(1).map((m, i) => [modules[i].id, m.id]));
  const facts = { files: [], imports: [], calls: [] };
  for (const m of modules) for (let i = 0; i < 10; i++) { const path = `${m.id}/${i}.ts`; facts.files.push({ path, loc: 20 }); g.fileModules[path] = m.id; if (i) facts.imports.push({ from: path, to: `${m.id}/${i - 1}.ts`, resolved: true, line: 1 }); }
  const start = performance.now(), result = buildMapViews({ graph: g, facts });
  assert.equal(result.modules.length, 400); assert.equal(result.files.length, 4000); assert.equal(result.internal.length, 3600);
  // A generous bound protects against accidental repeated extraction or quadratic facts scans.
  assert.ok(performance.now() - start < 4000);
});
