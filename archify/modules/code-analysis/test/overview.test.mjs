// overview: project-level grouping, related findings, priorities, and coverage,
// built from the overlay's top-level findings list.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildOverview, MAX_PRIORITIES } from '../overlay/overview.mjs';
import { otherLanguageFiles } from '../extract/index.mjs';
import { loadConfig } from '../lib/analysis.mjs';

const mod = (id, fanIn = 0, files = 1) => ({ id, label: id, path: id, files, loc: 10, fanIn, fanOut: 0, instability: null, entry: [] });
const graph = {
  repository: { language: 'py', adapter: 'python@test' },
  excluded: { roles: ['test'], files: 2 },
  unresolved: { external: 1, outside: 0, unknown: 0, opaque: 0 },
  modules: [mod('a', 1), mod('b', 2), mod('c'), mod('d', 6, 4), mod('e', 3, 2)],
};
const finding = (id, code, severity, subject, moduleIds, componentIds = ['app']) => ({ id, code, severity, subject, moduleIds, componentIds });
const fileCycle = finding('COUP-000000000001', 'coupling/import-cycle', 'warning', { files: ['a/x.py', 'b/y.py'] }, ['a', 'b']);
const widerCycle = finding('COUP-000000000002', 'coupling/import-cycle', 'info', { files: ['a/x.py', 'b/y.py', 'c/z.py'] }, ['a', 'b', 'c']);
const moduleCycle = finding('COUP-000000000003', 'coupling/cycle', 'info', { modules: ['a', 'b', 'c'] }, ['a', 'b', 'c']);
const offDiagramHub = finding('COUP-000000000004', 'coupling/hub', 'warning', { module: 'd' }, ['d'], []);
const innerCycle = finding('COUP-000000000005', 'coupling/import-cycle', 'warning', { files: ['e/p.py', 'e/q.py'] }, ['e']);

test('overview: the same structure seen at several levels is related and takes one priority slot', () => {
  const o = buildOverview({ findings: [moduleCycle, widerCycle, offDiagramHub, fileCycle], graph });
  const byId = Object.fromEntries(o.findings.map((f) => [f.id, f]));
  assert.deepEqual(byId[fileCycle.id].relatedIds, [widerCycle.id, moduleCycle.id], 'nested in the wider file cycle and inside the module cycle');
  assert.deepEqual(byId[offDiagramHub.id].relatedIds, []);
  assert.deepEqual(o.priorities, [fileCycle.id, offDiagramHub.id], 'the wider and module-level cycles are the same problem as the first pick');
  assert.equal(o.findings.length, 4, 'related findings stay listed');
});

test('overview: a cycle inside one module is not tied to a module-level cycle', () => {
  const o = buildOverview({ findings: [innerCycle, finding('COUP-000000000006', 'coupling/cycle', 'info', { modules: ['e', 'a'] }, ['a', 'e'])], graph });
  assert.deepEqual(o.findings.find((f) => f.id === innerCycle.id).relatedIds, []);
});

test('overview: priorities rank by severity, then reach, and stop at the limit', () => {
  const o = buildOverview({ findings: [innerCycle, moduleCycle, offDiagramHub, fileCycle, widerCycle], graph });
  assert.equal(MAX_PRIORITIES, 3);
  // warnings first; the two-module cycle reaches more modules than either one-module warning; the hub's dependents outnumber e's.
  assert.deepEqual(o.priorities, [fileCycle.id, offDiagramHub.id, innerCycle.id]);
  assert.deepEqual(o.findings.find((f) => f.id === offDiagramHub.id).impact, { modules: 1, size: 0, fanIn: 6, files: 4 });
  assert.deepEqual(o.groups.map((g) => [g.code, g.severity, g.count]), [['coupling/import-cycle', 'warning', 3], ['coupling/hub', 'warning', 1], ['coupling/cycle', 'info', 1]]);
  assert.deepEqual(o.counts, { findings: 5, error: 0, warning: 3, info: 2, accepted: 0, acceptedErrors: 0, offDiagram: 1 });
});

test('overview: one rule with many instances does not take every priority slot', () => {
  const cx = (n, complexity) => ({ id: `COMP-00000000000${n}`, code: 'complexity/function', severity: 'warning', subject: { file: `e/f${n}.py`, function: `f${n}` }, evidence: { complexity }, moduleIds: ['e'], componentIds: ['app'] });
  const o = buildOverview({ findings: [cx(1, 26), cx(2, 47), cx(3, 31), cx(4, 28), offDiagramHub], graph });
  assert.deepEqual(o.priorities, ['COMP-000000000002', offDiagramHub.id, 'COMP-000000000003'], 'best of each warning rule first (largest complexity first), then by rank');
});

test('overview: investigation repeats priorities with message and source location', () => {
  const tangled = {
    ...finding('COMP-000000000010', 'complexity/function', 'warning', { file: 'e/f.py', function: 'f', line: 12 }, ['e']),
    message: 'f in e/f.py has cyclomatic complexity 26. This is a maintenance signal, not a defect.',
    evidence: { complexity: 26 },
  };
  const o = buildOverview({ findings: [tangled], graph });
  assert.deepEqual(o.priorities, [tangled.id]);
  assert.deepEqual(o.investigation.leads, [{
    id: tangled.id,
    code: 'complexity/function',
    severity: 'warning',
    message: tangled.message,
    where: 'e/f.py:12',
    symbol: 'f',
    impact: { modules: 1, size: 26, fanIn: 3, files: 2 },
  }]);
  assert.deepEqual(buildOverview({ findings: [], graph }).investigation.leads, []);
  assert.equal(o.investigation.architecture.modules, graph.modules.length);
  assert.ok(o.investigation.architecture.hotspots.every(m => m.readingWeight >= 0));
});

test('overview: the verdict never claims more than the checks did', () => {
  assert.equal(buildOverview({ findings: [], graph }).verdict, 'none-found');
  assert.equal(buildOverview({ findings: [moduleCycle], graph }).verdict, 'signals-only');
  assert.equal(buildOverview({ findings: [moduleCycle, fileCycle], graph }).verdict, 'attention');
  assert.deepEqual(buildOverview({ findings: [], graph }).priorities, []);
});

test('overview: coverage names what was analyzed, left out, and switched off', () => {
  const facts = { files: [{ path: 'a/x.py', role: 'source' }, { path: 'a/t.py', role: 'test' }, { path: 'b/y.py', role: 'source' }], parse_errors: [{ path: 'b/y.py', message: 'bad' }] };
  const run = { rules: ['coupling/import-cycle', 'coupling/cycle', 'coupling/hub'], suppressed: ['coupling/hub', 'not/a-rule'], exclude: ['**/venv/**'], otherLanguages: [{ adapter: 'ts', files: 7 }] };
  const c = buildOverview({ findings: [], graph, facts, unmapped: [{ id: 'd' }], run }).coverage;
  assert.equal(c.language, 'py');
  assert.deepEqual(c.files, { analyzed: 2, excludedByRole: 2, excludedRoles: ['test'], excludePatterns: ['**/venv/**'], parseErrors: ['b/y.py'] });
  assert.deepEqual(c.otherLanguages, [{ adapter: 'ts', files: 7 }]);
  assert.deepEqual(c.rules, { run: ['coupling/import-cycle', 'coupling/cycle'], suppressed: ['coupling/hub'] });
  assert.deepEqual(c.unmappedModules, ['d']);
  assert.equal(buildOverview({ findings: [], graph }).coverage.files.analyzed, null, 'without facts the count is unknown, not zero');
});

test('overview: duplicate detection carries its own file coverage so an empty scan is not an all-clear', () => {
  const rules = ['coupling/import-cycle', 'redundancy/duplicate-block'];
  const coverage = (analyzed, omitted) => ({ coverage: { selected: ['src/a.ts', 'vendor/b.ts'], analyzed, omitted, complete: !omitted.length } });
  const empty = buildOverview({ findings: [], graph, run: { rules, duplicates: coverage([], [{ file: 'src/a.ts', reason: 'not-reported-by-engine' }, { file: 'vendor/b.ts', reason: 'vendored' }]) } });
  assert.equal(empty.verdict, 'none-found');
  assert.ok(empty.coverage.rules.run.includes('redundancy/duplicate-block'));
  assert.deepEqual(empty.coverage.duplicates, { analyzed: 0, selected: 2, omitted: 2, complete: false }, 'zero findings from zero analyzed files stays visibly incomplete');
  const full = buildOverview({ findings: [], graph, run: { rules, duplicates: coverage(['src/a.ts', 'vendor/b.ts'], []) } });
  assert.deepEqual(full.coverage.duplicates, { analyzed: 2, selected: 2, omitted: 0, complete: true });
  assert.equal(buildOverview({ findings: [], graph, run: { rules: ['coupling/import-cycle'] } }).coverage.duplicates, null, 'not run: no duplicate coverage is invented');
});

test('extract: files of the language not analyzed are counted', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-mixed-'));
  fs.writeFileSync(path.join(dir, 'a.py'), 'import b\n');
  fs.writeFileSync(path.join(dir, 'b.py'), '');
  fs.writeFileSync(path.join(dir, 'web.ts'), 'export const x = 1;\n');
  const config = loadConfig(null);
  assert.deepEqual(otherLanguageFiles(dir, config, 'py'), [{ adapter: 'ts', files: 1 }]);
  assert.deepEqual(otherLanguageFiles(dir, config, 'ts'), [{ adapter: 'py', files: 2 }]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('overview: an accepted error leaves the open counts but is still counted as present', () => {
  const cycle = { ...finding('COUP-0000000000e1', 'coupling/cycle', 'error', { modules: ['a', 'b'] }, ['a', 'b']), review: { status: 'accepted', reason: 'planned for Q2' } };
  const hub = { ...finding('COUP-0000000000e2', 'coupling/hub', 'warning', { module: 'c' }, ['c']), review: { status: 'accepted', reason: 'by design' } };
  const o = buildOverview({ findings: [cycle, hub], graph });
  assert.equal(o.verdict, 'none-found', 'accepted findings do not fail a run');
  assert.deepEqual(o.priorities, []);
  assert.equal(o.counts.error, 0);
  assert.equal(o.counts.accepted, 2);
  assert.equal(o.counts.acceptedErrors, 1, 'the page keeps an accepted cycle red');
});
