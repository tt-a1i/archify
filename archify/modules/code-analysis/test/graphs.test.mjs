// graphs: hand-verified module graph for the synthetic fixture, through the
// library stages (extract → graphs) the button runs.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { BAUIFY_ROOT } from './helpers.mjs';
import { extractFacts, buildGraph } from '../lib/analysis.mjs';
import { buildModuleGraph } from '../graphs/module.mjs';

const FIXTURE = path.join(BAUIFY_ROOT, 'test', 'fixtures', 'ts-basic');

test('graphs: the synthetic fixture folds into a hand-verified two-module graph', () => {
  const { facts, config } = extractFacts(FIXTURE, { language: 'ts' });
  const graph = buildGraph(facts, config);
  assert.deepEqual(graph.excluded, { roles: ['generated', 'test'], files: 2 });
  assert.deepEqual(graph.modules.map((m) => [m.id, m.files, m.fanIn, m.fanOut, m.instability]), [
    ['src', 1, 0, 1, 1],
    ['src-lib', 2, 1, 0, 0],
  ]);
  // src/index.mjs → helper (static + export) and lazy (dynamic): three file edges, one module edge.
  assert.deepEqual(graph.edges.map((e) => [e.from, e.to, e.weight, e.kinds]), [
    ['src', 'src-lib', 3, { dynamic: 1, eager: 2, export: 1, lazy: 1, static: 1 }],
  ]);
  assert.equal(graph.edges[0].evidence.length, 3);
});

test('graphs: explicit groups win over depth, and a deeper package folds into its depth-level ancestor', () => {
  const { facts } = extractFacts(FIXTURE, { language: 'ts' });
  const grouped = buildModuleGraph(facts, { modules: { groups: { everything: ['src/**'] } } });
  assert.deepEqual(grouped.modules.map((m) => m.id), ['everything']);
  assert.deepEqual(grouped.edges, []);
  const depth1 = buildModuleGraph(facts, { modules: { depth: 1 } });
  assert.deepEqual(depth1.modules.map((m) => m.id), ['src']);
});
