import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { importExternal } from '../lib/external.mjs';
import { lineFingerprints } from '../import/fingerprints.mjs';
import { schemaErrors } from '../schemas/index.mjs';
import { DiagnosticError } from '../core/index.mjs';

const sha = text => createHash('sha256').update(text).digest('hex');
function workspace(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-external-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), typeof value === 'string' ? value : JSON.stringify(value));
  };
  for (const [file, text] of Object.entries(files)) write(file, text);
  return { root, write, load(format, report, options = {}) {
    write('report.json', report);
    const source = { id: 'project-lint', format, file: 'report.json', ...(options.source || {}) };
    const result = importExternal({ root, config: { external: { sources: [source], ...(options.severity ? { severity: options.severity } : {}) }, ...(options.config || {}) }, facts: options.facts || { files: [] } });
    const doc = { schema_version: 1, repository: {}, rules: [...new Set(result.diagnostics.map(d => d.code))], summary: { errors: 0, warnings: 0, info: 0, suppressed: 0 }, diagnostics: result.diagnostics };
    assert.deepEqual(schemaErrors('findings', doc), []);
    return result;
  } };
}
const eslintMessage = (ruleId = 'no-unused-vars', overrides = {}) => ({ ruleId, severity: 2, message: "'unused' is defined but never used.", line: 1, column: 7, endLine: 1, endColumn: 13, ...overrides });

test('external imports are absent by default and never require a readable root', () => {
  assert.deepEqual(importExternal({ root: '/nonexistent', config: {} }), { diagnostics: [], sources: [], evidenceFiles: [] });
});

test('ESLint metadata keeps original rule, message, source severity, links and source suppressions', t => {
  const source = 'const unused = 1;\n';
  const w = workspace(t, { 'src/a.js': source });
  const report = { results: [{ filePath: 'src/a.js', source, messages: [eslintMessage('@typescript-eslint/no-unused-vars')], suppressedMessages: [{ ruleId: 'semi' }] }], metadata: { rulesMeta: { '@typescript-eslint/no-unused-vars': { docs: { url: 'https://typescript-eslint.io/rules/no-unused-vars' } } } } };
  const { diagnostics: [d], sources: [s], evidenceFiles } = w.load('eslint', report);
  assert.equal(d.external.ruleId, '@typescript-eslint/no-unused-vars');
  assert.equal(d.message, report.results[0].messages[0].message);
  assert.equal(d.severity, 'error');
  assert.equal(d.confidence, null);
  assert.equal(d.external.originalSeverity, 2);
  assert.equal(d.external.helpUri, report.metadata.rulesMeta[d.external.ruleId].docs.url);
  assert.equal(d.external.reportPointer, '/results/0/messages/0');
  assert.equal(d.external.binding, 'verified');
  assert.equal(d.evidenceDigest.sha256, sha(JSON.stringify([['src/a.js', sha(source)]])));
  assert.equal(s.suppressed, 1);
  assert.equal(s.coverage.complete, null);
  assert.equal(evidenceFiles[0].sourceText, source);
});

test('Ruff legacy severity defaults explicitly and Unicode point columns become UTF-16', t => {
  const w = workspace(t, { 'app.py': 'a😀x = 1\n' });
  const { diagnostics: [d], sources: [s] } = w.load('ruff', [{ code: 'F821', filename: 'app.py', message: 'Undefined name x', location: { row: 1, column: 3 }, end_location: { row: 1, column: 4 } }]);
  assert.deepEqual(d.external.locations, [{ file: 'app.py', line: 1, endLine: 1, column: 4, endColumn: 5 }]);
  assert.equal(d.external.originalSeverity, null);
  assert.equal(d.external.severityDefaulted, true);
  assert.equal(d.severity, 'warning');
  assert.equal(s.binding, 'unverified');
  assert.equal(s.code, 'conventions/ruff');
});

test('Ruff syntax errors and notebook coordinates remain visible without false coverage or JSON line evidence', t => {
  const w = workspace(t, { 'app.py': 'match value:\n', 'note.ipynb': '{"cells": []}\n' });
  const result = w.load('ruff', [
    { code: null, name: 'invalid-syntax', severity: 'error', filename: 'app.py', message: 'Unsupported match statement', location: { row: 1, column: 1 } },
    { code: 'F401', severity: 'error', filename: 'note.ipynb', cell: 4, message: 'Unused import', location: { row: 20, column: 5 } },
  ]);
  const notebook = result.diagnostics.find(d => d.subject.file === 'note.ipynb');
  assert.equal(notebook.subject.line, undefined);
  assert.equal(notebook.evidenceDigest, undefined);
  assert.equal(notebook.external.origin.cell, 4);
  assert.equal(result.diagnostics.find(d => d.subject.file === 'app.py').external.ruleId, 'invalid-syntax');
  assert.equal(result.sources[0].status, 'partial');
  assert.equal(result.sources[0].coverage.complete, false);
});

test('configured missing, malformed and unsupported inputs fail as structured diagnostics', t => {
  const w = workspace(t);
  assert.throws(() => importExternal({ root: w.root, config: { external: { sources: [{ id: 'a', format: 'eslint', file: 'missing.json' }] } } }), e => e instanceof DiagnosticError && e.diagnostics[0].code === 'external/input-unreadable');
  w.write('report.json', '{');
  assert.throws(() => importExternal({ root: w.root, config: { external: { sources: [{ id: 'a', format: 'ruff', file: 'report.json' }] } } }), e => e instanceof DiagnosticError && e.diagnostics[0].code === 'external/input-not-json');
  assert.throws(() => w.load('eslint', {}), e => e instanceof DiagnosticError && e.diagnostics[0].code === 'external/report-invalid');
  assert.throws(() => w.load('sarif', { version: '2.1.0', runs: [{ tool: { driver: { name: 'Bad' } }, results: [{ message: { text: 'bad' }, locations: [{ physicalLocation: { artifactLocation: { uri: 'x.js' }, region: { startLine: 0 } } }] }] }] }), e => e instanceof DiagnosticError && e.diagnostics[0].code === 'external/report-invalid');
});

test('explicit Windows producer roots map exactly; an unrelated absolute root never matches by basename', t => {
  const w = workspace(t, { 'pkg/a.py': 'unused = 1\n' });
  const input = [{ filename: 'C:\\agent\\repo\\pkg\\a.py', code: 'F841', message: 'Unused variable', location: { row: 1, column: 1 } }];
  const mapped = w.load('ruff', input, { source: { pathMappings: [{ from: 'C:/agent/repo', to: '.' }] } });
  assert.equal(mapped.diagnostics[0].subject.file, 'pkg/a.py');
  assert.ok(mapped.diagnostics[0].evidenceDigest);
  const unresolved = w.load('ruff', input);
  assert.deepEqual(unresolved.diagnostics[0].subject, {});
  assert.equal(unresolved.diagnostics[0].evidenceDigest, undefined);
  assert.equal(unresolved.sources[0].status, 'partial');
  assert.equal(unresolved.diagnostics[0].external.origin.nativeLocations[0].path, input[0].filename);
});

test('source-context identity survives leading lines, while whole-file evidence and policy changes require re-review', t => {
  const w = workspace(t, { 'a.js': 'const unused = 1;\nexport const value = 1;\n' });
  const report = [{ filePath: 'a.js', messages: [eslintMessage()] }];
  const first = w.load('eslint', report).diagnostics[0];
  w.write('a.js', '// Heading\nconst unused = 1;\nexport const value = 1;\n');
  const moved = w.load('eslint', [{ filePath: 'a.js', messages: [eslintMessage('no-unused-vars', { line: 2, endLine: 2 })] }]).diagnostics[0];
  assert.equal(moved.id, first.id);
  assert.notEqual(moved.evidenceDigest.sha256, first.evidenceDigest.sha256);
  assert.equal(moved.external.reviewDigest, first.external.reviewDigest);
  const demoted = w.load('eslint', [{ filePath: 'a.js', messages: [eslintMessage('no-unused-vars', { line: 2, endLine: 2 })] }], { severity: 'warning' }).diagnostics[0];
  assert.equal(demoted.id, moved.id);
  assert.equal(demoted.severity, 'warning');
  assert.notEqual(demoted.external.reviewDigest, moved.external.reviewDigest);
});

test('same-rule occurrences stay distinct and repeated identical records do not inflate findings', t => {
  const w = workspace(t, { 'a.js': 'foo(); foo();\n' });
  const one = eslintMessage('no-undef', { column: 1, endColumn: 4, message: 'foo is undefined' });
  const two = { ...one, column: 8, endColumn: 11 };
  const report = [{ filePath: 'a.js', messages: [two, one, one] }, { filePath: './a.js', messages: [one] }];
  const first = w.load('eslint', report);
  const reordered = w.load('eslint', [{ filePath: 'a.js', messages: [one, two] }]);
  assert.equal(first.diagnostics.length, 2);
  assert.deepEqual(first.diagnostics.map(d => d.id), reordered.diagnostics.map(d => d.id));
});

test('generation-time byte hashes bind manifests; importing current text alone does not prove freshness', t => {
  const text = "print('😀')\n";
  const w = workspace(t, { 'app.py': text, 'clean.py': 'pass\n' });
  const manifest = { schema_version: 1, toolVersion: '0.11.0', configDigest: sha('config'), scope: { files: ['app.py', 'clean.py'], complete: true }, files: { 'app.py': sha(text), 'clean.py': sha('pass\n') }, command: 'ruff check --output-format json .' };
  const report = [{ code: 'F821', filename: 'app.py', message: 'Sample warning', location: { row: 1, column: 1 } }];
  const verified = w.load('ruff', report, { source: { manifest } });
  assert.equal(verified.sources[0].binding, 'verified');
  assert.equal(verified.sources[0].coverage.complete, true);
  assert.deepEqual(verified.sources[0].sourceHashes, manifest.files);
  assert.deepEqual(verified.evidenceFiles.map(f => f.path), ['app.py']);
  assert.equal(verified.diagnostics[0].external.binding, 'verified');
  w.write('app.py', "print('changed')\n");
  assert.equal(w.load('ruff', report, { source: { manifest } }).diagnostics[0].external.binding, 'changed');
  const naked = w.load('ruff', report);
  assert.equal(naked.sources[0].binding, 'unverified');
  assert.equal(naked.sources[0].coverage.complete, null);
  const empty = w.load('ruff', [], { source: { manifest } });
  assert.equal(empty.sources[0].binding, 'changed');
  assert.deepEqual(empty.sources[0].coverage.files, ['app.py', 'clean.py']);
});

test('manifest paths stay repository-relative under a workspace pathBase, with raw-byte encoded source hashes', t => {
  const w = workspace(t);
  const bytes = Buffer.from('# coding: cp1252\nvalue = "\x80"\n', 'latin1');
  fs.mkdirSync(path.join(w.root, 'packages/api'), { recursive: true });
  fs.writeFileSync(path.join(w.root, 'packages/api/app.py'), bytes);
  const text = '# coding: cp1252\nvalue = "€"\n';
  const manifest = { schema_version: 1, toolVersion: '0.11.0', configDigest: sha('cfg'), files: { 'packages/api/app.py': sha(bytes) }, scope: { files: ['packages/api/app.py'], complete: true } };
  const result = w.load('ruff', [{ code: 'F841', filename: 'app.py', message: 'Unused variable', location: { row: 2, column: 1 } }], { source: { pathBase: 'packages/api', manifest }, facts: { files: [{ path: 'packages/api/app.py', sourceText: text }] } });
  assert.equal(result.sources[0].binding, 'verified');
  assert.deepEqual(result.sources[0].coverage.files, ['packages/api/app.py']);
  assert.equal(result.diagnostics[0].subject.file, 'packages/api/app.py');
  assert.equal(result.diagnostics[0].external.binding, 'verified');
  assert.equal(result.evidenceFiles.length, 0);
  assert.equal(result.diagnostics[0].evidenceDigest.sha256, sha(JSON.stringify([['packages/api/app.py', sha(text)]])));
});

test('unexpected scanners and malformed native fields fail without raw implementation errors', t => {
  const w = workspace(t, { 'a.js': 'const unused = 1;\n' });
  assert.throws(() => w.load('eslint', [{ filePath: 'a.js', messages: [eslintMessage()] }], { source: { tool: 'Ruff' } }), e => e instanceof DiagnosticError && e.diagnostics[0].code === 'external/tool-mismatch');
  assert.throws(() => w.load('eslint', [{ filePath: 'a.js', messages: [eslintMessage('rule', { suggestions: {} })] }]), e => e instanceof DiagnosticError && e.diagnostics[0].code === 'external/report-invalid');
  assert.throws(() => w.load('ruff', [{ filename: 'a.js', code: null, name: {}, message: 'bad' }]), e => e instanceof DiagnosticError && e.diagnostics[0].code === 'external/report-invalid');
});

test('SARIF resolves runs, ruleIndex, message templates, URI bases and source suppressions', t => {
  const text = 'a😀x = 1;\nuse(x);\n';
  const w = workspace(t, { 'src/a.js': text });
  const report = { version: '2.1.0', runs: [{
    columnKind: 'unicodeCodePoints', tool: { driver: { name: 'ESLint', version: '9.0.0', rules: [{ id: '@plugin/rule', defaultConfiguration: { level: 'note' }, messageStrings: { unused: { text: 'Unused {0}' } }, helpUri: 'https://example.com/rule' }] } },
    originalUriBaseIds: { ROOT: { uri: 'file:///ci/work/' } },
    artifacts: [{ location: { uri: 'src/a.js', uriBaseId: 'ROOT' }, contents: { text } }],
    results: [
      { ruleIndex: 0, message: { id: 'unused', arguments: ['x'] }, partialFingerprints: { 'stable/v1': 'abc' }, locations: [{ physicalLocation: { artifactLocation: { index: 0 }, region: { startLine: 1, startColumn: 3, endColumn: 4 } } }], relatedLocations: [{ id: 1, physicalLocation: { artifactLocation: { index: 0 }, region: { startLine: 2 } } }] },
      { ruleId: '@plugin/rule', message: { text: 'suppressed' }, suppressions: [{ kind: 'inSource' }] },
      { ruleId: '@plugin/rule', kind: 'pass', message: { text: 'passed' } },
    ],
  }, { tool: { driver: { name: 'Other' } } }] };
  const result = w.load('sarif', report, { source: { pathMappings: [{ from: '/ci/work', to: '.' }] } });
  assert.equal(result.diagnostics.length, 1);
  const d = result.diagnostics[0];
  assert.equal(d.message, 'Unused x');
  assert.equal(d.external.ruleId, '@plugin/rule');
  assert.equal(d.severity, 'info');
  assert.equal(d.subject.column, 4);
  assert.equal(d.external.locations.length, 2);
  assert.match(d.external.fingerprint, /^sarif-partial\/v1:/);
  assert.equal(d.external.identityRevision, 2);
  assert.equal(result.sources.find(s => s.tool === 'ESLint').adapterRevision, 2);
  assert.equal(d.external.binding, 'verified');
  assert.equal(result.sources.find(s => s.tool === 'ESLint').suppressed, 1);
  assert.equal(result.sources.find(s => s.tool === 'Other').status, 'partial');
  const reordered = w.load('sarif', { ...report, runs: [...report.runs].reverse() }, { source: { pathMappings: [{ from: '/ci/work', to: '.' }] } });
  assert.equal(reordered.diagnostics[0].id, d.id);
});

test('GitHub review imports preserve old diff coordinates and replies without claiming current source evidence', t => {
  const w = workspace(t, { 'app.py': 'pass\n' });
  const head = 'a'.repeat(40);
  const comment = { id: 42, body: 'Review this intentional behavior', path: 'app.py', side: 'LEFT', line: null, original_line: 17, commit_id: 'b'.repeat(40), original_commit_id: 'b'.repeat(40), html_url: 'https://github.com/example/repo/pull/1#discussion_r42', user: { login: 'coderabbitai[bot]' } };
  const report = { headCommit: head, author: 'coderabbitai[bot]', comments: [comment, { id: 43, in_reply_to_id: 42, body: 'Retained intentionally', user: { login: 'maintainer' } }, { id: 44, body: 'Another reviewer', user: { login: 'human' } }] };
  const facts = { repository: { baseRevision: head }, files: [] };
  const result = w.load('github-review', report, { source: { tool: 'CodeRabbit' }, facts });
  assert.equal(result.diagnostics.length, 1);
  const d = result.diagnostics[0];
  assert.equal(d.severity, 'warning');
  assert.equal(d.external.binding, 'unverified');
  assert.equal(d.evidenceDigest, undefined);
  assert.equal(d.subject.line, undefined);
  assert.equal(d.external.origin.originalLine, 17);
  assert.equal(d.external.origin.replies[0].body, 'Retained intentionally');
  const updated = w.load('github-review', { ...report, comments: [{ ...comment, body: 'Updated review claim' }] }, { source: { tool: 'CodeRabbit' }, facts }).diagnostics[0];
  assert.equal(updated.id, d.id);
  assert.notEqual(updated.external.reviewDigest, d.external.reviewDigest);
});

test('CodeQL line-hash adaptation retains upstream reference vectors and newline equivalence', () => {
  // Reference vectors from github/codeql-action fingerprints.test.ts at 592d162b.
  assert.deepEqual([...lineFingerprints('').values()], ['c129715d7a2bc9a3:1']);
  const expected = ['271789c17abda88f:1', '54703d4cd895b18:1', '180aee12dab6264:1', 'a23a3dc5e078b07b:1'];
  assert.deepEqual([...lineFingerprints(' a\nb\n  \t\tc\n d').values()], expected);
  assert.deepEqual([...lineFingerprints(' a\r\nb\r\n  \t\tc\r\n d').values()], expected);
});
