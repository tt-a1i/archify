// evaluate: coupling/cycle (Tarjan) and coupling/hub on hand-built graphs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate } from '../evaluate/index.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

function graphOf(edges, extra = {}) {
  const ids = [...new Set(edges.flat())].sort();
  const modules = ids.map((id) => ({ id, label: id, path: id, files: 1, loc: 10, fanIn: edges.filter((e) => e[1] === id).length, fanOut: edges.filter((e) => e[0] === id).length, instability: null, entry: [`${id}/index.mjs`] }));
  return {
    schema_version: 1, repository: { root: '.', revision: null, url: null, language: 'ts', adapter: 't' },
    grouping: { depth: 2, packageBoundaries: true, groups: [] }, excluded: { roles: [], files: 0 },
    modules, unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 },
    edges: edges.map(([from, to]) => ({ from, to, weight: 1, kinds: { static: 1 }, evidence: [{ file: `${from}/index.mjs`, line: 1, to: `${to}/index.mjs` }] })),
    ...extra,
  };
}

test('cycle: a DAG yields no finding; a 3-cycle yields one finding naming exactly its members', () => {
  assert.deepEqual(evaluate(graphOf([['a', 'b'], ['b', 'c'], ['a', 'c']])).diagnostics, []);
  const out = evaluate(graphOf([['a', 'b'], ['b', 'c'], ['c', 'a'], ['c', 'd']]));
  assert.equal(out.diagnostics.length, 1);
  const f = out.diagnostics[0];
  assert.equal(f.code, 'coupling/cycle');
  assert.equal(f.severity, 'info', 'package-level cycles are a signal, not a verdict');
  assert.equal(f.evidence.kind, 'eager');
  assert.equal(f.confidence, 1);
  assert.deepEqual(f.subject.modules, ['a', 'b', 'c']);
  assert.deepEqual(f.evidence.path, ['a', 'b', 'c']);
  assert.equal(f.evidence.edges.length, 3, 'd is outside the cycle and its edge is not evidence');
  assert.equal(f.id, 'COUP-0001');
  assert.deepEqual(schemaErrors('findings', out), []);
});

test('cycle: two separate cycles are two findings; a self-contained 2-cycle quotes both imports', () => {
  const out = evaluate(graphOf([['a', 'b'], ['b', 'a'], ['x', 'y'], ['y', 'z'], ['z', 'x']]));
  // evaluate() orders findings by code, then subject, so ids are stable across runs.
  assert.deepEqual(out.diagnostics.map((d) => d.subject.modules), [['a', 'b'], ['x', 'y', 'z']]);
  assert.equal(out.diagnostics[0].evidence.imports.length, 2);
  assert.equal(out.summary.info, 2);
});

test('hub: fires only when both fan-in and fan-out meet the configured thresholds, echoed in evidence', () => {
  const edges = [];
  for (const d of ['d1', 'd2', 'd3', 'd4', 'd5']) edges.push([d, 'core']);
  for (const u of ['u1', 'u2', 'u3', 'u4', 'u5']) edges.push(['core', u]);
  const out = evaluate(graphOf(edges));
  const hub = out.diagnostics.find((d) => d.code === 'coupling/hub');
  assert.ok(hub, 'core is a hub at the default 5/5 threshold');
  assert.deepEqual(hub.evidence.threshold, { fanIn: 5, fanOut: 5 });
  assert.equal(hub.evidence.dependents.length, 5);
  const stricter = evaluate(graphOf(edges), { rules: { coupling: { hub: { fanIn: 6, fanOut: 6 } } } });
  assert.ok(!stricter.diagnostics.some((d) => d.code === 'coupling/hub'));
});

test('evaluate: ignore list suppresses a rule and counts it', () => {
  const out = evaluate(graphOf([['a', 'b'], ['b', 'a']]), { ignore: ['coupling/cycle'] });
  assert.deepEqual(out.diagnostics, []);
  assert.equal(out.summary.suppressed, 1);
});

function factsOf(imports, roles = {}) {
  const files = [...new Set(imports.flatMap((i) => [i.from, i.to]))].sort().map((path) => ({ path, loc: 1, role: roles[path] || 'source' }));
  return { schema_version: 1, repository: { root: '.', revision: null, url: null, language: 'py', adapter: 'python@test' }, files, symbols: [], calls: [],
    imports: imports.map((i) => ({ from: i.from, to: i.to, specifier: i.to, kind: 'static', line: i.line || 1, resolved: true, ...(i.names ? { names: i.names } : {}), ...(i.lazy ? { lazy: true } : {}) })),
    unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 } };
}

test('import-cycle: eager cycles warn and deferred cycles remain unverified, never asserted safe', () => {
  const graph = graphOf([['a', 'b'], ['b', 'a']]);
  const eager = evaluate(graph, {}, factsOf([{ from: 'a/x.py', to: 'b/y.py' }, { from: 'b/y.py', to: 'a/x.py' }]));
  const f = eager.diagnostics.find((d) => d.code === 'coupling/import-cycle');
  assert.equal(f.severity, 'warning', 'a dependency graph is not an execution proof');
  assert.equal(f.evidence.kind, 'eager');
  assert.equal(f.evidence.risk.loading, 'potential-at-import');
  assert.deepEqual(f.subject.files, ['a/x.py', 'b/y.py']);
  assert.deepEqual(f.evidence.path, ['a/x.py', 'b/y.py']);
  const lazy = evaluate(graph, {}, factsOf([{ from: 'a/x.py', to: 'b/y.py' }, { from: 'b/y.py', to: 'a/x.py', lazy: true, line: 40 }]));
  const g = lazy.diagnostics.find((d) => d.code === 'coupling/import-cycle');
  assert.equal(g.severity, 'info');
  assert.equal(g.evidence.kind, 'deferred');
  assert.equal(g.evidence.risk.loading, 'not-proven');
  assert.equal(g.evidence.lazyImports, 1);
  assert.ok(g.evidence.imports.some((i) => i.lazy && i.line === 40));
});

test('import-cycle: binding line order produces a partial-init candidate with its assumptions exposed', () => {
  const graph = graphOf([['a', 'b'], ['b', 'a']]);
  // a.py: line 1 `from b import foo`, line 3 `def bar`. b.py: line 1 `from a import bar`, line 3 `def foo`.
  const facts = factsOf([{ from: 'a/x.py', to: 'b/y.py', line: 1, names: ['foo'] }, { from: 'b/y.py', to: 'a/x.py', line: 1, names: ['bar'] }]);
  facts.symbols = [
    { file: 'a/x.py', name: 'foo', kind: 'import', line: 1 }, { file: 'a/x.py', name: 'bar', kind: 'function', line: 3 },
    { file: 'b/y.py', name: 'bar', kind: 'import', line: 1 }, { file: 'b/y.py', name: 'foo', kind: 'function', line: 3 },
  ];
  const f = evaluate(graph, {}, facts).diagnostics.find((d) => d.code === 'coupling/import-cycle');
  assert.equal(f.severity, 'warning');
  assert.equal(f.evidence.risk.loading, 'potential-partial-init');
  // Both load orders fail here; the rule reports the first in deterministic (edge) order: b imported first, a asks it for foo too early.
  assert.deepEqual(f.evidence.partialInitCandidate, { entry: 'b/y.py', module: 'b/y.py', name: 'foo', boundAt: 3, viaLine: 1, importer: 'a/x.py', line: 1, chain: ['b/y.py', 'a/x.py'] });
  assert.match(f.message, /does not prove failure/);
  // Same shape but the name is bound before the import that closes the loop: nothing to prove, stays a warning.
  const safe = factsOf([{ from: 'a/x.py', to: 'b/y.py', line: 5, names: ['foo'] }, { from: 'b/y.py', to: 'a/x.py', line: 5, names: ['bar'] }]);
  safe.symbols = [
    { file: 'a/x.py', name: 'bar', kind: 'function', line: 2 }, { file: 'a/x.py', name: 'foo', kind: 'import', line: 5 },
    { file: 'b/y.py', name: 'foo', kind: 'function', line: 2 }, { file: 'b/y.py', name: 'bar', kind: 'import', line: 5 },
  ];
  assert.equal(evaluate(graph, {}, safe).diagnostics.find((d) => d.code === 'coupling/import-cycle').severity, 'warning');
});

test('import-cycle: a package-level cycle made of two different files is not a file cycle', () => {
  // tools/a.py -> news/w.py -> tools/t.py : directories tools <-> news cycle, files do not.
  const graph = graphOf([['tools', 'news'], ['news', 'tools']]);
  const out = evaluate(graph, {}, factsOf([{ from: 'tools/a.py', to: 'news/w.py' }, { from: 'news/w.py', to: 'tools/t.py' }]));
  assert.ok(!out.diagnostics.some((d) => d.code === 'coupling/import-cycle'), 'no file imports itself back');
  assert.ok(out.diagnostics.some((d) => d.code === 'coupling/cycle' && d.severity === 'info'), 'package-level signal remains, as info');
});

test('import-cycle: test files are excluded like the module graph excludes them', () => {
  const graph = graphOf([['a', 'b']]);
  const facts = factsOf([{ from: 'a/x.py', to: 'tests/t.py' }, { from: 'tests/t.py', to: 'a/x.py' }], { 'tests/t.py': 'test' });
  const out = evaluate({ ...graph, excluded: { roles: ['test'], files: 1 } }, {}, facts);
  assert.ok(!out.diagnostics.some((d) => d.code === 'coupling/import-cycle'));
});
