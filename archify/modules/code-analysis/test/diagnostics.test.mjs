import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { importEslint, importRuff, importSarif } from '../lib/diagnostics.mjs';
import { buildTask, renderTaskMarkdown } from '../lib/task.mjs';
import { externalIdentity, readJsonInput } from '../lib/analysis.mjs';

const sarif = (result) => ({ version: '2.1.0', runs: [{ tool: { driver: { name: 'eslint', version: '9', rules: [{ id: 'no-alert', shortDescription: { text: 'Avoid alert' } }] } }, results: [result] }] });

function rootWithFiles(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-diagnostics-'));
  for (const file of files) { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, 'source\n'); }
  return root;
}

test('SARIF import preserves source, rule, original level, location and normalized warning', (t) => {
  const root = rootWithFiles(['src/app.js']); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const [finding] = importSarif(sarif({ ruleId: 'no-alert', level: 'error', message: { text: 'Avoid alert.' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/app.js' }, region: { startLine: 1, startColumn: 2 } } }] }), { root, source: 'eslint', importedAt: '2026-11-06T00:00:00Z' });
  assert.equal(finding.code, 'external/eslint');
  assert.equal(finding.severity, 'warning');
  assert.equal(finding.evidence.originalLevel, 'error');
  assert.deepEqual(finding.subject, { file: 'src/app.js', line: 1, column: 2, rule: 'no-alert', tool: 'eslint' });
  assert.equal(finding.evidence.locations[0].status, 'ok');
  assert.equal(finding.evidence.ruleDescription, 'Avoid alert');
});

test('external evidence digest covers every valid SARIF location', (t) => {
  const root = rootWithFiles(['test/fixtures/py-basic/app.py', 'test/fixtures/py-basic/engine.py']); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const [finding] = importSarif(sarif({ ruleId: 'x', message: { text: 'two files' }, locations: [
    { physicalLocation: { artifactLocation: { uri: 'test/fixtures/py-basic/app.py' }, region: { startLine: 1 } } },
    { physicalLocation: { artifactLocation: { uri: 'test/fixtures/py-basic/engine.py' }, region: { startLine: 1 } } },
  ] }), { root });
  assert.deepEqual(finding.evidenceDigest.files, ['test/fixtures/py-basic/app.py', 'test/fixtures/py-basic/engine.py']);
});

test('SARIF file URLs resolve to repository-relative paths on the current platform', (t) => {
  const root = rootWithFiles(['src/app.js']); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const uri = pathToFileURL(path.join(root, 'src/app.js')).href;
  const [finding] = importSarif(sarif({ ruleId: 'x', message: { text: 'url' }, locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: 1 } } }] }), { root });
  assert.equal(finding.subject.file, 'src/app.js');
  assert.equal(finding.evidence.locations[0].status, 'ok');
});

test('SARIF related locations are preserved and included in the evidence digest', (t) => {
  const root = rootWithFiles(['src/a.js', 'src/b.js', 'src/c.js']); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const [finding] = importSarif(sarif({ ruleId: 'x', message: { text: 'related' }, locations: [
    { physicalLocation: { artifactLocation: { uri: 'src/a.js' }, region: { startLine: 1 } } },
    { physicalLocation: { artifactLocation: { uri: 'src/c.js' }, region: { startLine: 1 } } },
  ], relatedLocations: [
    { physicalLocation: { artifactLocation: { uri: 'src/b.js' }, region: { startLine: 1 } } },
  ] }), { root });
  assert.deepEqual(finding.evidence.locations.map(({ file }) => file), ['src/a.js', 'src/c.js', 'src/b.js']);
  assert.equal(finding.evidence.locations[2].role, 'related');
  assert.deepEqual(finding.evidenceDigest.files, ['src/a.js', 'src/b.js', 'src/c.js']);
  const task = buildTask({ findings: { diagnostics: [finding], repository: { language: 'ts' } }, facts: { files: ['src/a.js', 'src/b.js', 'src/c.js'].map((path) => ({ path, sourceText: 'source\n' })), repository: { language: 'ts' } }, ids: [finding.id] });
  assert.deepEqual(task.locations.map((location) => location.file), ['src/a.js', 'src/c.js']);
  assert.deepEqual(task.scope.modify, ['src/a.js', 'src/c.js']);
  assert.deepEqual(task.scope.read, ['src/b.js']);
  assert.equal(task.facts[0].evidence.tool, 'eslint');
  assert.equal(task.facts[0].evidence.locations.length, 3);
});

test('SARIF related-only evidence stays readable without becoming an edit subject', (t) => {
  const root = rootWithFiles(['src/context.js']); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const [finding] = importSarif(sarif({ ruleId: 'x', message: { text: 'context only' }, relatedLocations: [
    { physicalLocation: { artifactLocation: { uri: 'src/context.js' }, region: { startLine: 1 } } },
  ] }), { root });
  assert.equal(finding.subject.file, null);
  assert.equal(finding.subject.line, null);
  assert.equal(finding.evidence.locations[0].role, 'related');
  assert.match(finding.supportedFixes[0], /re-run|export/);
  const task = buildTask({ findings: { diagnostics: [finding], repository: { language: 'ts' } }, facts: { files: [{ path: 'src/context.js', sourceText: 'source\n' }], repository: { language: 'ts' } }, ids: [finding.id] });
  assert.deepEqual(task.scope.modify, []);
  assert.deepEqual(task.scope.read, ['src/context.js']);
  assert.deepEqual(task.locations, []);
  assert.equal(task.facts[0].evidence.locations[0].file, 'src/context.js');
});

test('SARIF structural limits fail closed', () => {
  assert.throws(() => importSarif({ runs: Array.from({ length: 2 }, () => ({})) }, { limits: { maxRuns: 1 } }), (error) => error.diagnostics[0].code === 'diagnostics/sarif-too-large');
  assert.throws(() => importSarif({ runs: [{ results: [{ locations: Array.from({ length: 2 }, () => ({})) }] }] }, { limits: { maxLocations: 1 } }), (error) => error.diagnostics[0].code === 'diagnostics/sarif-too-large');
});

test('SARIF import keeps outside, missing and duplicate locations explicit', () => {
  const [finding] = importSarif(sarif({ ruleId: 'x', message: { text: 'x' }, locations: [
    { physicalLocation: { artifactLocation: { uri: '../secret.js' }, region: { startLine: 1 } } },
    { physicalLocation: { artifactLocation: { uri: 'src/a.js' }, region: {} } },
  ] }), { root: 'D:/repo' });
  assert.equal(finding.subject.file, '../secret.js');
  assert.equal(finding.evidence.locations[0].status, 'unverifiable');
  assert.equal(finding.evidence.locations[1].status, 'unverifiable');
  assert.match(finding.supportedFixes[0], /re-run|export/);
});

test('SARIF invalid input fails closed', () => {
  assert.throws(() => importSarif({}), (error) => error.diagnostics[0].code === 'diagnostics/sarif-invalid');
});

test('external diagnostic import limits and malformed members fail closed', (t) => {
  assert.throws(() => importSarif({ runs: [{ results: [null] }] }), (error) => error.diagnostics[0].code === 'diagnostics/sarif-invalid');
  assert.throws(() => importEslint([{ filePath: 'a.js', messages: [{ message: 'a' }, { message: 'b' }] }], { limits: { maxResults: 1 } }), (error) => error.diagnostics[0].code === 'diagnostics/eslint-too-large');
  assert.throws(() => importEslint([{ filePath: 'a.js', messages: [null] }]), (error) => error.diagnostics[0].code === 'diagnostics/eslint-invalid');
  assert.throws(() => importRuff([{}, {}], { limits: { maxResults: 1 } }), (error) => error.diagnostics[0].code === 'diagnostics/ruff-too-large');
  assert.throws(() => importRuff([null]), (error) => error.diagnostics[0].code === 'diagnostics/ruff-invalid');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-diagnostic-size-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'input.json'); fs.writeFileSync(file, '{"value":123}');
  assert.throws(() => readJsonInput(file, 'test input', { maxBytes: 5 }), (error) => error.diagnostics[0].code === 'diagnostics/input-too-large');
});

test('native ESLint and Ruff JSON preserve source facts and normalize findings to warning', () => {
  const [eslint] = importEslint([{ filePath: 'D:/repo/src/a.js', messages: [{ ruleId: 'no-alert', severity: 2, message: 'Avoid alert', line: 3, column: 4 }] }], { root: 'D:/repo', importedAt: '2026-11-07T00:00:00Z' });
  assert.equal(eslint.evidence.tool, 'eslint');
  assert.equal(eslint.evidence.originalLevel, 'error');
  assert.equal(eslint.subject.file, 'src/a.js');
  assert.equal(eslint.severity, 'warning');
  assert.equal(eslint.evidence.importedAt, '2026-11-07T00:00:00Z');
  const [ruff] = importRuff([{ filename: 'src/a.py', code: 'F401', message: 'unused import', location: { row: 5, column: 1 } }], { root: 'D:/repo' });
  assert.equal(ruff.evidence.tool, 'ruff');
  assert.equal(ruff.evidence.rule, 'F401');
  assert.equal(ruff.subject.line, 5);
});

test('external absolute paths use their own flavor and reject cross-flavor roots', () => {
  const location = (filePath, root) => importEslint([{ filePath, messages: [{ ruleId: 'x', message: 'x', line: 1, column: 1 }] }], { root })[0].evidence.locations[0];
  assert.equal(location('/repo/src/a.js', '/repo').file, 'src/a.js');
  assert.equal(location('/repo/src/a.js', '/repo').status, 'unverifiable');
  assert.equal(location('d:/repo/src/a.js', 'D:/REPO').file, 'src/a.js');
  assert.equal(location('/repo/src/a.js', 'D:/repo').status, 'unverifiable');
  assert.equal(location('/repo/src/a.js', 'D:/repo').file, '/repo/src/a.js');
  assert.equal(location('D:/repo/src/a.js', '/repo').status, 'unverifiable');
  assert.equal(location('D:/repo/src/a.js', '/repo').file, 'D:/repo/src/a.js');
});

test('repeated external diagnostics are idempotent while different tools remain distinct', () => {
  const result = { ruleId: 'same', level: 'warning', message: { text: 'same text' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/app.js' }, region: { startLine: 1 } } }] };
  const sarif = importSarif({ runs: [
    { tool: { driver: { name: 'eslint' } }, results: [result, result] },
    { tool: { driver: { name: 'eslint' } }, results: [result] },
    { tool: { driver: { name: 'ruff' } }, results: [result] },
  ] });
  assert.equal(sarif.length, 2);
  assert.deepEqual(sarif.map((finding) => finding.evidence.tool).sort(), ['eslint', 'ruff']);
});

test('same-line external diagnostics retain distinct columns, ranges and related locations', () => {
  const result = (region, relatedLocations = []) => ({ ruleId: 'same', level: 'warning', message: { text: 'same text' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'src/app.js' }, region } }], relatedLocations });
  const related = { physicalLocation: { artifactLocation: { uri: 'src/context.js' }, region: { startLine: 2 } } };
  const findings = importSarif({ runs: [{ tool: { driver: { name: 'eslint' } }, results: [
    result({ startLine: 1, startColumn: 1 }),
    result({ startLine: 1, startColumn: 2 }),
    result({ startLine: 1, startColumn: 1, endLine: 2, endColumn: 3 }),
    result({ startLine: 1, startColumn: 1 }, [related]),
  ] }] });
  assert.equal(findings.length, 4);
  assert.equal(new Set(findings.map((finding) => finding.id)).size, 4);
  assert.deepEqual(findings[2].evidence.locations[0], { file: 'src/app.js', line: 1, column: 1, endLine: 2, endColumn: 3, status: 'unverifiable', reason: 'location does not resolve to a current source file' });
});

test('external adapters preserve ranges through tasks and re-analysis inputs', (t) => {
  const root = rootWithFiles(['src/a.js', 'src/a.py']); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const [eslint] = importEslint([{ filePath: 'src/a.js', messages: [{ ruleId: 'no-alert', message: 'Avoid alert', line: 1, column: 1, endLine: 1, endColumn: 5 }] }], { root });
  const [ruff] = importRuff([{ filename: 'src/a.py', code: 'F401', message: 'unused import', location: { row: 1, column: 1 }, end_location: { row: 1, column: 5 } }], { root });
  for (const finding of [eslint, ruff]) {
    assert.equal(finding.evidence.locations[0].endLine, 1);
    assert.equal(finding.evidence.locations[0].endColumn, 5);
    const task = buildTask({ findings: { diagnostics: [finding], repository: { language: 'ts' }, analysis: { externalDiagnostics: [{ format: finding.evidence.source, file: `reports/${finding.evidence.source}.json`, sha256: 'a'.repeat(64), findings: 1, rules: [] }] } }, facts: { files: [{ path: finding.subject.file, sourceText: 'source\n' }], repository: { language: 'ts' } }, ids: [finding.id] });
    assert.equal(task.locations[0].startLine, 1);
    assert.equal(task.locations[0].endLine, 1);
    assert.match(task.verification.reanalyze.command, new RegExp(`--${finding.evidence.source} .*reports/${finding.evidence.source}\\.json`));
  }
  const report = path.join(root, 'report.sarif'); fs.writeFileSync(report, '{}');
  assert.equal(externalIdentity(report, 'sarif', []).file, report);
});

test('external tasks fall back to one line for an inverted reported range', (t) => {
  const root = rootWithFiles(['src/a.py']); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const [finding] = importRuff([{ filename: 'src/a.py', code: 'F401', message: 'unused import', location: { row: 3, column: 1 }, end_location: { row: 2, column: 5 } }], { root });
  assert.equal(finding.evidence.locations[0].endLine, 2);
  const task = buildTask({ findings: { diagnostics: [finding] }, facts: { files: [{ path: 'src/a.py', sourceText: 'source\n' }] }, ids: [finding.id] });
  assert.deepEqual(task.locations.map(({ file, startLine, endLine, kind }) => ({ file, startLine, endLine, kind })), [{ file: 'src/a.py', startLine: 3, endLine: 3, kind: 'range' }]);
});

test('external task Markdown retains related location lines and statuses', (t) => {
  const root = rootWithFiles(['src/context.js']); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const [finding] = importSarif(sarif({ ruleId: 'x', message: { text: 'context only' }, relatedLocations: [{ physicalLocation: { artifactLocation: { uri: 'src/context.js' }, region: { startLine: 1, startColumn: 2 } } }] }), { root });
  const task = buildTask({ findings: { diagnostics: [finding], repository: { language: 'ts' } }, facts: { files: [{ path: 'src/context.js', sourceText: 'source\n' }], repository: { language: 'ts' } }, ids: [finding.id] });
  const markdown = renderTaskMarkdown(task);
  assert.match(markdown, /src\/context\.js:1/);
  assert.match(markdown, /related/i);
});

test('unverifiable external locations never enter a task modification scope', () => {
  const [finding] = importSarif(sarif({ ruleId: 'x', message: { text: 'outside' }, locations: [{ physicalLocation: { artifactLocation: { uri: '../secret.js' }, region: { startLine: 1 } } }] }), { root: 'D:/repo' });
  const task = buildTask({ findings: { diagnostics: [finding], repository: { language: 'ts' } }, facts: { files: [], repository: { language: 'ts' } }, ids: [finding.id] });
  assert.deepEqual(task.scope.modify, []);
  assert.deepEqual(task.locations, []);
});
