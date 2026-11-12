// Config merging and run comparability: "no longer detected" is only evidence
// of a fix when both runs measured the same way.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadConfig, mergeConfig } from '../lib/analysis.mjs';
import { comparability, reviewFindings } from '../lib/review.mjs';
import { DiagnosticError } from '../extract/shared/diagnostics.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';
import { analyzeFixture, copySource } from './task-fixtures.mjs';
import { buildGraph, evaluateGraph, extractFacts } from '../lib/analysis.mjs';
import { importSarif } from '../lib/diagnostics.mjs';

const CONFIG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'py-tasks', 'analysis.config.json');

test('config: objects merge at every depth, arrays and scalars replace', () => {
  const merged = mergeConfig(
    { include: ['a'], roles: { test: ['t/**'], generated: ['g/**'] }, rules: { complexity: { function: { info: { complexity: 15, nesting: 5 }, warning: { complexity: 25 } } } } },
    { include: ['b'], roles: { test: ['spec/**'] }, rules: { complexity: { function: { warning: { complexity: 30 } } } } },
  );
  assert.deepEqual(merged.include, ['b'], 'arrays replace');
  assert.deepEqual(merged.roles, { test: ['spec/**'], generated: ['g/**'] }, 'a role override keeps the other roles');
  assert.deepEqual(merged.rules.complexity.function, { info: { complexity: 15, nesting: 5 }, warning: { complexity: 30 } });
});

test('config: a file overriding one role keeps the default exclude list and other roles', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const defaults = loadConfig(null);
  const file = path.join(dir, 'c.json');
  fs.writeFileSync(file, JSON.stringify({ roles: { test: ['checks/**'] } }));
  const cfg = loadConfig(file);
  assert.deepEqual(cfg.roles.generated, defaults.roles.generated);
  assert.deepEqual(cfg.roles.test, ['checks/**']);
  assert.deepEqual(cfg.exclude, defaults.exclude);
  for (const [text, code] of [['{', 'cli/config-invalid'], ['[1]', 'cli/config-invalid']]) {
    fs.writeFileSync(file, text);
    assert.throws(() => loadConfig(file), (e) => e instanceof DiagnosticError && e.diagnostics[0].code === code, text);
  }
});

function run(dir, config, language = 'py') {
  const { facts } = extractFacts(dir, { language, config });
  const graph = buildGraph(facts, config);
  return { facts, findings: evaluateGraph(graph, config, facts) };
}
function compare(prev, next) {
  return reviewFindings(next.findings.diagnostics, { previous: prev.findings, analysis: next.findings.analysis, files: next.facts.files.map((f) => f.path) }).comparison;
}

test('comparison: effective Go platforms differ even with identical config and file counts', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-go-comparison-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.org/review\n\ngo 1.18\n');
  fs.writeFileSync(path.join(dir, 'work_linux.go'), 'package review\nfunc Work(v int) int { if v > 0 { return v }; if v < 0 { return -v }; return 0 }\n');
  fs.writeFileSync(path.join(dir, 'work_windows.go'), 'package review\nfunc Work(v int) int { return v }\n');
  const config = mergeConfig(loadConfig(), { go: { stdlib: false }, rules: { complexity: { function: { info: { complexity: 2, nesting: 10 }, warning: { complexity: 3, nesting: 10 } } } } });
  const previousOS = process.env.GOOS;
  t.after(() => { if (previousOS === undefined) delete process.env.GOOS; else process.env.GOOS = previousOS; });
  process.env.GOOS = 'linux';
  const linux = run(dir, config, 'go');
  assert.equal(compare(linux, run(dir, config, 'go')).comparable, true);
  process.env.GOOS = 'windows';
  const windows = run(dir, config, 'go');
  assert.equal(linux.findings.analysis.configDigest, windows.findings.analysis.configDigest);
  assert.equal(linux.findings.analysis.coverage.files, windows.findings.analysis.coverage.files);
  assert.equal(linux.facts.languageScope.build.goos, 'linux');
  assert.equal(windows.facts.languageScope.build.goos, 'windows');
  const changed = compare(linux, windows);
  assert.equal(changed.notDetected.length, 1, 'the Linux-only complexity finding is absent');
  assert.equal(changed.comparable, false);
  assert.deepEqual(changed.reasons.map((r) => r.code), ['go-build-scope-changed']);
  assert.deepEqual(schemaErrors('findings', linux.findings), []);
  assert.deepEqual(schemaErrors('findings', windows.findings), []);
  for (const [key, value] of Object.entries({ goarch: 'different-arch', cgo: true, tests: false, tags: ['extra'], releaseTags: ['go1.18'], toolTags: ['different-feature'] })) {
    const different = { ...linux.findings.analysis, goBuildScope: { ...linux.findings.analysis.goBuildScope, [key]: value } };
    assert.equal(comparability(linux.findings.analysis, different).comparable, false, `${key} affects source selection`);
  }
  const reordered = Object.fromEntries(Object.entries(linux.findings.analysis.goBuildScope).reverse());
  assert.equal(comparability(linux.findings.analysis, { ...linux.findings.analysis, goBuildScope: reordered }).comparable, true, 'JSON property order does not change build scope');

  // Historical schema-v1 findings are accepted, but their scope is unknown.
  const { goBuildScope: _scope, ...historical } = linux.findings.analysis;
  const legacy = { ...linux.findings, analysis: historical };
  assert.deepEqual(schemaErrors('findings', legacy), []);
  assert.equal(comparability(historical, historical).comparable, null);
  const unknown = comparability(historical, linux.findings.analysis);
  assert.equal(unknown.comparable, null);
  assert.deepEqual(unknown.reasons.map((r) => r.code), ['go-build-scope-missing']);
  assert.equal(comparability(historical, { ...linux.findings.analysis, configDigest: 'changed' }).comparable, false, 'a known config difference still establishes non-comparability');
});

test('comparison: the same analysis of edited code is comparable; a fixed cycle is no longer detected', (t) => {
  const dir = copySource();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = loadConfig(CONFIG);
  const before = run(dir, config);
  assert.deepEqual(schemaErrors('findings', before.findings), []);
  assert.ok(before.findings.analysis.configDigest);
  fs.writeFileSync(path.join(dir, 'app/b.py'), 'DEFAULT_LIMIT = 30\n\n\nclass Handler:\n    def __init__(self, config):\n        self.config = config\n');
  const c = compare(before, run(dir, config));
  assert.equal(c.comparable, true);
  assert.deepEqual(c.reasons, []);
  const gone = c.notDetected.find((f) => f.code === 'coupling/import-cycle');
  assert.ok(gone, 'the cycle is no longer detected');
  assert.equal(gone.likelyCause, undefined, 'nothing else explains its disappearance');
  assert.deepEqual(c.fixed, c.notDetected, '`fixed` stays as a compatible alias');
});

test('comparison: switching a rule off, changing thresholds or deleting a file is not a fix', (t) => {
  const dir = copySource();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = loadConfig(CONFIG);
  const before = run(dir, config);

  const ignored = compare(before, run(dir, { ...config, ignore: ['complexity/function'] }));
  assert.equal(ignored.comparable, false);
  assert.deepEqual(ignored.reasons.map((r) => r.code).sort(), ['config-changed', 'rules-removed']);
  assert.equal(ignored.notDetected.find((f) => f.code === 'complexity/function').likelyCause, 'rule-not-run');

  const raised = compare(before, run(dir, mergeConfig(config, { rules: { complexity: { function: { info: { complexity: 40 } } } } })));
  assert.equal(raised.comparable, false);
  assert.deepEqual(raised.reasons.map((r) => r.code), ['config-changed']);

  const excluded = compare(before, run(dir, { ...config, exclude: [...config.exclude, 'app/engine.py'] }));
  assert.equal(excluded.comparable, false);
  assert.equal(excluded.notDetected.find((f) => f.code === 'complexity/function').likelyCause, 'files-missing');

  fs.rmSync(path.join(dir, 'domain/order.py'));
  const deleted = compare(before, run(dir, config));
  assert.equal(deleted.comparable, true, 'same measurement; the code changed');
  assert.equal(deleted.notDetected.find((f) => f.code === 'architecture/boundary').likelyCause, 'files-missing');
});

test('comparison: a disappeared external result is not a native rule that stopped running', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-external-comparison-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const file of ['src/a.js', 'src/b.js']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), 'source\n');
  }
  const result = (file) => ({ ruleId: 'no-alert', message: { text: `Review ${file}` }, locations: [{ physicalLocation: { artifactLocation: { uri: file }, region: { startLine: 1 } } }] });
  const imported = importSarif({ version: '2.1.0', runs: [{ tool: { driver: { name: 'eslint' } }, results: [result('src/a.js'), result('src/b.js')] }] }, { root });
  const external = (findings) => [{ format: 'sarif', sha256: 'a'.repeat(64), findings, rules: ['eslint:no-alert'] }];
  const analysis = { ruleVersions: {}, coverage: { parseErrors: [] }, externalDiagnostics: external(1) };
  const previous = { diagnostics: imported, analysis: { ...analysis, externalDiagnostics: external(2) } };
  const comparison = reviewFindings([imported[1]], { previous, analysis, files: ['src/a.js', 'src/b.js'] }).comparison;
  assert.equal(comparison.comparable, false);
  assert.deepEqual(comparison.reasons.map((reason) => reason.code), ['external-diagnostics-changed']);
  assert.equal(comparison.unchanged, 1, 'another result from the same imported rule remains');
  assert.deepEqual(comparison.notDetected.map((finding) => finding.id), [imported[0].id]);
  assert.equal(comparison.notDetected[0].likelyCause, undefined);
});

test('comparison: disappeared external results do not inherit native file causes or rename candidates', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-external-causes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/a.js'), 'source\n');
  const result = (message) => ({ ruleId: 'no-alert', message: { text: message }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.js' }, region: { startLine: 1 } } }] });
  const [before, added] = importSarif({ runs: [{ tool: { driver: { name: 'eslint' } }, results: [result('before'), result('after')] }] }, { root });
  const analysis = { ruleVersions: {}, coverage: { parseErrors: ['src/a.js'] } };
  const comparison = reviewFindings([added], { previous: { diagnostics: [before] }, analysis, files: [] }).comparison;
  assert.deepEqual(comparison.notDetected.map((finding) => finding.id), [before.id]);
  assert.equal(comparison.notDetected[0].likelyCause, undefined);
  assert.equal(comparison.notDetected[0].candidates, undefined);
});

test('comparison: external input paths are reproducibility metadata, not content identity', () => {
  const input = (file) => [{ format: 'sarif', file, sha256: 'a'.repeat(64), findings: 1, rules: ['eslint:no-alert'] }];
  const before = { externalDiagnostics: input('C:/before/report.sarif') };
  const after = { externalDiagnostics: input('D:/after/report.sarif') };
  assert.deepEqual(comparability(before, after), { comparable: true, reasons: [] });
});

test('comparison: renaming a function changes its id; the old one is not detected because its function is gone', (t) => {
  const dir = copySource();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = loadConfig(CONFIG);
  const before = run(dir, config);
  const file = path.join(dir, 'app/engine.py');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('def route(', 'def dispatch('));
  const c = compare(before, run(dir, config));
  const old = before.findings.diagnostics.find((d) => d.code === 'complexity/function');
  const gone = c.notDetected.find((f) => f.id === old.id);
  assert.equal(c.new.length, 1, 'the renamed function is reported under a new id');
  assert.equal(gone.likelyCause, 'possibly-renamed');
  assert.deepEqual(gone.candidates, c.new);
  assert.equal(c.comparable, true);
});

test('comparison: a previous run without analysis context has unknown comparability', (t) => {
  const dir = copySource();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { findings, facts } = analyzeFixture(dir);
  const { analysis: _gone, ...legacy } = findings;
  assert.deepEqual(schemaErrors('findings', legacy), [], 'findings without `analysis` stay valid');
  const c = reviewFindings(findings.diagnostics, { previous: legacy, analysis: findings.analysis, files: facts.files.map((f) => f.path) }).comparison;
  assert.equal(c.comparable, null);
  assert.equal(c.reasons[0].code, 'context-missing');
  assert.equal(comparability(findings.analysis, findings.analysis).comparable, true);
  const parse = comparability(findings.analysis, { ...findings.analysis, coverage: { ...findings.analysis.coverage, parseErrors: ['app/x.py'] } });
  assert.deepEqual(parse.reasons.map((r) => r.code), ['parse-errors']);
  const external = comparability({ ...findings.analysis, externalDiagnostics: [] }, { ...findings.analysis, externalDiagnostics: [{ format: 'eslint', sha256: 'a'.repeat(64), findings: 1, rules: ['eslint:no-alert'] }] });
  assert.deepEqual(external.reasons.map((r) => r.code), ['external-diagnostics-changed']);
  const concentration = comparability({ ...findings.analysis, concentrationContext: { modules: 2, totalLoc: 100 } }, { ...findings.analysis, concentrationContext: { modules: 3, totalLoc: 200 } });
  assert.deepEqual(concentration.reasons.map((r) => r.code), ['concentration-denominator-changed']);
});

// ---- review findings on PR #992 -------------------------------------------

test('comparison: findings with position-numbered ids stay readable and are flagged as not comparable', (t) => {
  const dir = copySource();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { findings, facts } = analyzeFixture(dir);
  const legacy = { ...findings, diagnostics: findings.diagnostics.map((d, i) => ({ ...d, id: `${d.id.split('-')[0]}-${String(i + 1).padStart(4, '0')}` })) };
  delete legacy.analysis;
  assert.deepEqual(schemaErrors('findings', legacy), [], 'a schema-v1 document from before stable ids is still valid');
  const c = reviewFindings(findings.diagnostics, { previous: legacy, analysis: findings.analysis, files: facts.files.map((f) => f.path) }).comparison;
  assert.equal(c.comparable, false);
  assert.ok(c.reasons.some((r) => r.code === 'legacy-ids'));
});

test('comparison: reordering first-match config maps or changing the extractor is not comparable', (t) => {
  const dir = copySource();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = loadConfig(CONFIG);
  const before = run(dir, config);
  const { domain, ui, app } = config.boundaries.layers;
  const reordered = run(dir, { ...config, boundaries: { ...config.boundaries, layers: { app, ui, domain } } });
  assert.deepEqual(compare(before, reordered).reasons.map((r) => r.code), ['config-changed'], 'layer order decides which layer owns a file');
  const other = { ...before.findings.analysis, adapter: 'python@9.9.9' };
  assert.deepEqual(comparability(before.findings.analysis, other).reasons.map((r) => r.code), ['adapter-changed']);
});

test('comparison: a changed extraction logic revision is not comparable; an unrecorded one is reported once', (t) => {
  const dir = copySource();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { facts, findings } = run(dir, loadConfig(CONFIG));
  assert.equal(findings.analysis.adapterRevision, facts.repository.adapterRevision, 'findings record the revision of the raw facts');
  // Keep the historical 1-to-2 comparison independent of the installed extractor.
  const before = { ...findings.analysis, adapterRevision: 1 };
  assert.deepEqual(comparability(before, { ...before }), { comparable: true, reasons: [] });

  const revised = comparability(before, { ...before, adapterRevision: 2 });
  assert.equal(revised.comparable, false);
  assert.deepEqual(revised.reasons.map((r) => r.code), ['adapter-changed']);
  assert.match(revised.reasons[0].message, /revision 1 to 2/);

  // Findings written before revisions were recorded, against a current run.
  const { adapterRevision: _dropped, ...legacy } = before;
  const upgraded = comparability(legacy, before);
  assert.deepEqual(upgraded.reasons.map((r) => r.code), ['adapter-changed']);
  assert.match(upgraded.reasons[0].message, /unrecorded to 1/);

  const both = comparability(before, { ...before, adapter: 'python@9.9.9', adapterRevision: 2 });
  assert.equal(both.reasons.length, 1, 'one extractor reason names both changes');
  assert.match(both.reasons[0].message, /python@9\.9\.9.*revision 1 to 2/);
});

test('check: an explicit --compare that cannot be read is an input error, not "no comparison"', (t) => {
  const dir = copySource();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-compare-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true }); });
  const check = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'check.mjs');
  for (const [name, text] of [['broken.json', '{'], ['other.json', '{"schema_version":1}']]) {
    const file = path.join(out, name);
    fs.writeFileSync(file, text);
    const r = spawnSync(process.execPath, [check, dir, '--language', 'py', '--compare', file, '--new-only', '--json'], { encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 2, `${name}: ${r.stdout}${r.stderr}`);
  }
});

// Observed on Archify itself: a stable SHA-256 prefix can contain only digits.
test('comparison: numeric stable hashes retain normal comparison and context checks', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-numeric-id-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  // Keep the observed rule/subject identity, with a small synthetic body that
  // crosses the reporting threshold. Exercise the producer, not a hand-made id.
  const file = path.join(root, 'archify/modules/code-analysis/overlay/source-changes.mjs');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `export function sourceChanges(x) {${Array.from({ length: 15 }, (_, i) => `if (x === ${i}) return ${i};`).join('')}return -1;}`);
  const { facts, config } = extractFacts(root, { language: 'ts' });
  const previous = evaluateGraph(buildGraph(facts, config), config, facts);
  const { analysis } = previous;
  assert.equal(previous.diagnostics.length, 1);
  const finding = previous.diagnostics[0];
  assert.equal(finding.id, 'COMP-546883947289');
  assert.deepEqual(schemaErrors('findings', previous), []);
  assert.deepEqual(schemaErrors('baseline', { schema_version: 1, accepted: [{ id: finding.id, code: finding.code, reason: 'known signal' }] }), []);
  const compare = (currentAnalysis, diagnostics = [finding]) => reviewFindings(diagnostics, { previous, analysis: currentAnalysis }).comparison;
  assert.equal(compare(analysis).comparable, true);
  assert.equal(compare(analysis).unchanged, 1);
  assert.deepEqual(compare(analysis).reasons, []);
  assert.equal(compare(analysis, []).notDetected[0].id, finding.id);
  assert.deepEqual(compare({ ...analysis, configDigest: 'changed' }).reasons.map(r => r.code), ['config-changed']);
  delete previous.analysis;
  assert.equal(compare(analysis).comparable, null, 'stable format does not replace missing analysis context');
  for (const id of ['COMP-0001', 'COMP-10000']) {
    previous.diagnostics = [{ ...finding, id }];
    assert.equal(compare(analysis).comparable, false, 'position ids remain non-comparable');
    assert.ok(compare(analysis).reasons.some(r => r.code === 'legacy-ids'));
  }
});
