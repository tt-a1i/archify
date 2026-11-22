// coupling/internal-leak: other modules importing a module's internal files
// instead of one entry point.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate } from '../evaluate/index.mjs';
import { DiagnosticError } from '../extract/shared/diagnostics.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';
import { buildTask } from '../lib/task.mjs';

const CODE = 'coupling/internal-leak';

// Modules: app (src/app), lib (src/lib), ui (src/ui), vendor (src/vendor).
function setup(imports, { language = 'ts', extraFiles = [], roles = {} } = {}) {
  const paths = [...new Set([...imports.flatMap((i) => [i.from, i.to]), ...extraFiles])].sort();
  const moduleOf = (p) => p.split('/').slice(0, 2).join('/');
  const ids = [...new Set(paths.map(moduleOf))].sort();
  const graph = {
    schema_version: 1, repository: { root: '.', revision: null, url: null, language, adapter: 't' },
    grouping: { depth: 2, packageBoundaries: true, groups: [] }, excluded: { roles: ['test', 'generated'], files: 0 },
    modules: ids.map((p) => ({ id: p.replace('/', '-'), label: p.split('/').pop(), path: p, files: paths.filter((f) => moduleOf(f) === p).length, loc: 1, fanIn: 0, fanOut: 0, instability: 0 })),
    fileModules: Object.fromEntries(paths.map((p) => [p, moduleOf(p).replace('/', '-')])),
    edges: [], unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 },
  };
  const facts = {
    schema_version: 1, repository: graph.repository, symbols: [], calls: [], unresolved: graph.unresolved,
    files: paths.map((p) => ({ path: p, loc: 1, role: roles[p] || 'source', sourceText: `// ${p}` })),
    imports: imports.map((i) => ({ from: i.from, to: i.to, specifier: i.to, kind: 'static', line: i.line || 1, resolved: true, ...(i.typeOnly ? { typeOnly: true } : {}) })),
  };
  return { graph, facts };
}
const leaks = (out) => out.diagnostics.filter((d) => d.code === CODE);

test('internal-leak: a module with no entry file, reached through enough internal files, is reported as info with every import', () => {
  const { graph, facts } = setup([
    { from: 'src/app/main.ts', to: 'src/lib/a.ts', line: 2 },
    { from: 'src/app/main.ts', to: 'src/lib/b.ts', line: 3 },
    { from: 'src/ui/view.ts', to: 'src/lib/c.ts', line: 5, typeOnly: true },
    { from: 'src/lib/a.ts', to: 'src/lib/b.ts', line: 1 },
  ], { extraFiles: ['src/lib/d.ts'] });
  const out = evaluate(graph, {}, facts);
  assert.deepEqual(schemaErrors('findings', out), []);
  assert.ok(out.rules.includes(CODE));
  const [f] = leaks(out);
  assert.equal(leaks(out).length, 1, 'imports inside lib do not count');
  assert.equal(f.severity, 'info');
  assert.deepEqual(f.subject, { module: 'src-lib' });
  assert.match(f.id, /^COUP-[0-9a-f]{12}$/);
  assert.equal(f.evidence.entrySource, 'none');
  assert.deepEqual(f.evidence.entries, []);
  assert.deepEqual(f.evidence.internalFiles, ['src/lib/a.ts', 'src/lib/b.ts', 'src/lib/c.ts']);
  assert.equal(f.evidence.moduleFiles, 4);
  assert.deepEqual(f.evidence.consumers, ['src-app', 'src-ui']);
  assert.deepEqual(f.evidence.imports, [
    { file: 'src/app/main.ts', line: 2, to: 'src/lib/a.ts' },
    { file: 'src/app/main.ts', line: 3, to: 'src/lib/b.ts' },
    { file: 'src/ui/view.ts', line: 5, to: 'src/lib/c.ts', typeOnly: true },
  ]);
  assert.match(f.message, /^lib has no entry file: 2 modules import 3 of its 4 files directly \(3 imports\)\.$/);
  assert.deepEqual(f.evidenceDigest.files, ['src/app/main.ts', 'src/lib/a.ts', 'src/lib/b.ts', 'src/lib/c.ts', 'src/ui/view.ts'], 'both ends of each cited import');
});

test('internal-leak: without an entry file, fewer internal files than minFiles is not reported', () => {
  const imports = [{ from: 'src/app/main.ts', to: 'src/lib/a.ts' }, { from: 'src/app/main.ts', to: 'src/lib/b.ts' }];
  const { graph, facts } = setup(imports);
  assert.equal(leaks(evaluate(graph, {}, facts)).length, 0, 'default minFiles is 3');
  assert.equal(leaks(evaluate(graph, { rules: { coupling: { internalLeak: { minFiles: 2 } } } }, facts)).length, 1);
});

test('internal-leak: a detected index file makes bypassing imports info, and imports through it are counted, not cited', () => {
  const { graph, facts } = setup([
    { from: 'src/app/main.ts', to: 'src/lib/index.ts', line: 1 },
    { from: 'src/ui/view.ts', to: 'src/lib/deep/b.ts', line: 4 },
  ]);
  const [f] = leaks(evaluate(graph, {}, facts));
  assert.equal(f.severity, 'info');
  assert.equal(f.evidence.entrySource, 'detected');
  assert.deepEqual(f.evidence.entries, ['src/lib/index.ts']);
  assert.equal(f.evidence.viaEntry, 1);
  assert.deepEqual(f.evidence.imports, [{ file: 'src/ui/view.ts', line: 4, to: 'src/lib/deep/b.ts' }]);
  assert.match(f.message, /has an entry point \(src\/lib\/index\.ts\), but 1 import from 1 module reach 1 of its internal files directly/);
});

test('internal-leak: an index file below the module folder is not its entry; __init__.py is for Python', () => {
  const ts = setup([{ from: 'src/app/m.ts', to: 'src/lib/x/index.ts' }, { from: 'src/app/m.ts', to: 'src/lib/y.ts' }, { from: 'src/app/m.ts', to: 'src/lib/z.ts' }]);
  assert.equal(leaks(evaluate(ts.graph, {}, ts.facts))[0].evidence.entrySource, 'none');
  const py = setup([{ from: 'src/app/m.py', to: 'src/lib/__init__.py' }, { from: 'src/app/m.py', to: 'src/lib/y.py' }], { language: 'py' });
  const [f] = leaks(evaluate(py.graph, {}, py.facts));
  assert.deepEqual(f.evidence.entries, ['src/lib/__init__.py']);
  assert.deepEqual(f.evidence.internalFiles, ['src/lib/y.py']);
});

test('internal-leak: configured entries make bypassing imports a warning and replace detection', () => {
  const { graph, facts } = setup([
    { from: 'src/app/main.ts', to: 'src/lib/api.ts', line: 1 },
    { from: 'src/app/main.ts', to: 'src/lib/index.ts', line: 2 },
  ]);
  const config = { rules: { coupling: { internalLeak: { entries: ['src/*/api.ts'] } } } };
  const [f] = leaks(evaluate(graph, config, facts));
  assert.equal(f.severity, 'warning');
  assert.equal(f.evidence.entrySource, 'config');
  assert.deepEqual(f.evidence.entries, ['src/lib/api.ts']);
  assert.deepEqual(f.evidence.internalFiles, ['src/lib/index.ts'], 'a configured convention replaces the index.* default');
  const task = buildTask({ findings: evaluate(graph, config, facts), facts, ids: [f.id] });
  assert.match(task.title, /one entry point/);
});

test('internal-leak: test files, vendored folders and Java are not checked', () => {
  const { graph, facts } = setup([
    { from: 'tests/lib.test.ts', to: 'src/lib/a.ts' }, { from: 'tests/lib.test.ts', to: 'src/lib/b.ts' }, { from: 'tests/lib.test.ts', to: 'src/lib/c.ts' },
    { from: 'src/app/m.ts', to: 'src/vendor/x.js' }, { from: 'src/app/m.ts', to: 'src/vendor/y.js' }, { from: 'src/app/m.ts', to: 'src/vendor/z.js' },
  ], { roles: { 'tests/lib.test.ts': 'test' } });
  assert.deepEqual(leaks(evaluate(graph, {}, facts)), []);
  const java = setup([{ from: 'src/app/A.java', to: 'src/lib/B.java' }, { from: 'src/app/A.java', to: 'src/lib/C.java' }, { from: 'src/app/A.java', to: 'src/lib/D.java' }], { language: 'java' });
  const out = evaluate(java.graph, {}, java.facts);
  assert.ok(!out.rules.includes(CODE), 'Java has no entry-file convention, so the rule is listed as not run');
  assert.ok(!evaluate(graph, {}, null).rules.includes(CODE), 'without raw facts the rule does not run');
});

test('internal-leak: an invalid option stops the analysis with a diagnostic', () => {
  const { graph, facts } = setup([{ from: 'src/app/m.ts', to: 'src/lib/a.ts' }]);
  for (const internalLeak of [[], { entries: [] }, { entries: [1] }, { minFiles: 0 }, { minFiles: 1.5 }]) {
    assert.throws(() => evaluate(graph, { rules: { coupling: { internalLeak } } }, facts), (e) => e instanceof DiagnosticError && e.diagnostics[0].code === 'config/internal-leak-invalid', JSON.stringify(internalLeak));
  }
});
