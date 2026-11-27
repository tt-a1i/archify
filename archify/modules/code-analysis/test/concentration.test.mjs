// coupling/concentration: reach, size share and file length on hand-built graphs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate } from '../evaluate/index.mjs';
import { thresholds } from '../evaluate/rules/coupling/concentration.mjs';
import { buildTask } from '../lib/task.mjs';
import { DiagnosticError } from '../core/index.mjs';
import { schemaErrors } from '../schemas/index.mjs';

const CODE = 'coupling/concentration';

function graphOf(edges, loc = {}, extra = {}) {
  const ids = [...new Set([...edges.flat(), ...Object.keys(loc)])].sort();
  const modules = ids.map((id) => ({ id, label: id, path: id, files: 1, loc: loc[id] ?? 100, fanIn: edges.filter((e) => e[1] === id).length, fanOut: edges.filter((e) => e[0] === id).length, instability: null, entry: [] }));
  return {
    schema_version: 1, repository: { root: '.', revision: null, url: null, language: 'ts', adapter: 't' },
    grouping: { depth: 2, packageBoundaries: true, groups: [] }, excluded: { roles: ['test', 'generated'], files: 0 },
    modules, unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 },
    edges: edges.map(([from, to]) => ({ from, to, weight: 1, kinds: { static: 1 }, evidence: [{ file: `${from}/index.mjs`, line: 1, to: `${to}/index.mjs` }] })),
    ...extra,
  };
}
const only = (out) => out.diagnostics.filter((d) => d.code === CODE);

// a → b → core, c → core, d → e (unrelated), f isolated: 3 of the 6 other modules reach core.
const CHAIN = [['a', 'b'], ['b', 'core'], ['c', 'core'], ['d', 'e']];

test('concentration: reach counts transitive dependents and reports at the configured share', () => {
  const out = evaluate(graphOf(CHAIN, { f: 100 }));
  const found = only(out);
  assert.equal(found.length, 1);
  const f = found[0];
  assert.deepEqual(f.subject, { module: 'core' });
  assert.deepEqual(f.evidence.reasons, ['reach']);
  assert.deepEqual(f.evidence.reach, { dependents: 3, direct: 2, dependencies: 0, modules: 6, share: 0.5, sample: ['a', 'b', 'c'] });
  assert.deepEqual(f.evidence.threshold, { reachShare: 0.5, sizeShare: 0.4, minModules: 6 });
  assert.match(f.message, /^core: 3 of the other 6 modules depend on it directly or through other modules \(50%\)/);
  assert.equal(f.severity, 'info', 'a leaf that many modules use is a shared kernel, which the cycle rules recommend');
  assert.match(f.message, /depends on no other module, the usual shape of a shared kernel/);
  // The same reach in a module with dependencies of its own passes their changes on: a warning.
  const relay = only(evaluate(graphOf([...CHAIN, ['core', 'e']], { f: 100 }))).find((d) => d.subject.module === 'core');
  assert.equal(relay.severity, 'warning');
  assert.equal(relay.evidence.reach.dependencies, 1);
  assert.match(relay.message, /not proof that the module should be split/);
  assert.match(f.id, /^COUP-[0-9a-f]{12}$/);
  assert.deepEqual(schemaErrors('findings', out), []);
  assert.deepEqual(only(evaluate(graphOf(CHAIN, { f: 100 }), { rules: { coupling: { concentration: { reachShare: 0.6 } } } })), []);
});

test('concentration: a module in a cycle counts the other members once and never itself', () => {
  const out = evaluate(graphOf([['a', 'b'], ['b', 'a'], ['c', 'a'], ['d', 'e'], ['e', 'f']]), { rules: { coupling: { concentration: { reachShare: 0.4 } } } });
  const byModule = Object.fromEntries(only(out).map((f) => [f.subject.module, f.evidence.reach.sample]));
  assert.deepEqual(byModule.a, ['b', 'c']);
  assert.deepEqual(byModule.b, ['a', 'c']);
  assert.deepEqual(byModule.f, ['d', 'e']);
});

test('concentration: size share is reported with the raw line counts, and both reasons share one finding', () => {
  const sized = only(evaluate(graphOf([['a', 'b']], { a: 100, b: 100, c: 100, d: 100, e: 100, big: 500 })));
  assert.equal(sized.length, 1);
  assert.deepEqual(sized[0].subject, { module: 'big' });
  assert.deepEqual(sized[0].evidence.reasons, ['size']);
  assert.deepEqual(sized[0].evidence.size, { loc: 500, totalLoc: 1000, files: 1, share: 0.5 });
  assert.match(sized[0].message, /it holds 50% of the analyzed source lines \(500 of 1000, in 1 file\)/);

  const both = only(evaluate(graphOf(CHAIN, { core: 900, f: 100 })));
  assert.equal(both.length, 1);
  assert.deepEqual(both[0].evidence.reasons, ['reach', 'size']);
  assert.equal(both[0].severity, 'warning', 'a large module is not a small kernel, even as a leaf');
  assert.ok(both[0].evidence.reach && both[0].evidence.size);
});

test('concentration: reach and size stay silent below minModules, where a share of the project means little', () => {
  const small = graphOf([['a', 'core'], ['b', 'core'], ['c', 'core']], { core: 5000 });
  assert.deepEqual(only(evaluate(small)), []);
  assert.equal(only(evaluate(small, { rules: { coupling: { concentration: { minModules: 4 } } } })).length, 1);
});

test('concentration: a file at the line threshold is reported once; test and generated files are not', () => {
  const graph = graphOf([['a', 'b']], {}, { fileModules: { 'a/huge.mjs': 'a', 'b/ok.mjs': 'b' } });
  const facts = { schema_version: 1, repository: graph.repository, symbols: [], calls: [], imports: [], unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 },
    files: [{ path: 'a/huge.mjs', loc: 1500, role: 'source' }, { path: 'b/ok.mjs', loc: 1499, role: 'source' }, { path: 'a/huge.test.mjs', loc: 9000, role: 'test' }, { path: 'a/generated-x.mjs', loc: 9000, role: 'generated' }] };
  const found = only(evaluate(graph, {}, facts));
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].subject, { file: 'a/huge.mjs' });
  assert.deepEqual(found[0].evidence, { reasons: ['file'], loc: 1500, module: 'a', threshold: { fileLines: 1500 } });
  assert.deepEqual(only(evaluate(graph, { rules: { coupling: { concentration: { fileLines: 1501 } } } }, facts)), []);
  assert.deepEqual(only(evaluate(graph, {})), [], 'without raw facts there are no file lengths to report');
});

test('concentration: an invalid threshold stops the run instead of silently matching nothing', () => {
  for (const [key, value] of [['reachShare', 0], ['reachShare', 1.5], ['sizeShare', '40%'], ['fileLines', 0], ['fileLines', 12.5], ['minModules', 1]]) {
    assert.throws(() => thresholds({ rules: { coupling: { concentration: { [key]: value } } } }),
      (e) => e instanceof DiagnosticError && e.diagnostics[0].code === 'config/threshold-invalid' && e.diagnostics[0].subject.option === `rules.coupling.concentration.${key}`, `${key}=${value}`);
  }
  assert.deepEqual(thresholds({}), { reachShare: 0.5, sizeShare: 0.4, fileLines: 1500, minModules: 6 });
});

test('concentration: the rule is versioned in the analysis context and can be switched off', () => {
  const out = evaluate(graphOf(CHAIN, { f: 100 }));
  assert.equal(out.analysis.ruleVersions[CODE], 1);
  const off = evaluate(graphOf(CHAIN, { f: 100 }), { ignore: [CODE] });
  assert.deepEqual(only(off), []);
  assert.ok(!off.rules.includes(CODE) || off.summary.suppressed >= 1);
});

test('concentration: an AI task states which number has to move, or that the finding may be accepted', () => {
  const graph = graphOf([['a', 'b']], {}, { fileModules: { 'a/huge.mjs': 'a' } });
  const source = Array.from({ length: 1600 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';
  const facts = { schema_version: 1, repository: graph.repository, symbols: [], calls: [], imports: [], unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 },
    files: [{ path: 'a/huge.mjs', loc: 1600, role: 'source', sourceText: source }] };
  const findings = evaluate(graph, {}, facts);
  const finding = only(findings)[0];
  assert.ok(finding.evidenceDigest, 'the file text is pinned so an accepted finding is re-opened when it changes');
  const task = buildTask({ findings, facts, ids: [finding.id] });
  assert.equal(task.title, 'Review the size of a/huge.mjs');
  assert.match(task.acceptance[0], /^The file is shorter than 1500 lines .*or the concentration is confirmed as intended and accepted with that reason\.$/);
  assert.deepEqual(task.facts[0].evidence, { reasons: ['file'], loc: 1600, module: 'a', threshold: { fileLines: 1500 } });
  assert.deepEqual(schemaErrors('ai-task', task), []);
});
