// External reports join the existing review and evidence lifecycle. These tests
// protect acceptance and CI meaning, rather than the importer implementation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { acceptFinding, baselineFrom, comparability, isOpen, reviewFindings, reviewTargetDigest, revokeFinding, validateBaseline } from '../lib/review.mjs';
import { createRangeDigest, verifyTask } from '../lib/evidence.mjs';
import { splitLines, withExcerpt } from '../lib/task.mjs';
import { DiagnosticError } from '../core/index.mjs';

const sha = (value) => value.repeat(64);
const clone = (value) => JSON.parse(JSON.stringify(value));
const source = (overrides = {}) => ({
  id: 'web-eslint', format: 'eslint', tool: 'ESLint', toolVersion: '9.0.0',
  adapterRevision: 1, identityRevision: 1, reportSha256: sha('a'), configDigest: sha('b'), severityPolicy: 'source', importSettingsDigest: sha('c'),
  status: 'imported', coverage: { files: ['src/a.ts'], complete: true }, binding: 'verified',
  suppressed: 0, notices: [], ...overrides,
});
const context = (sources = [source()]) => ({
  analyzer: { name: '@archify/code-analysis', version: 'test' }, language: 'ts', adapter: 'typescript@test', adapterRevision: 1,
  configDigest: sha('c'), ruleVersions: { 'conventions/eslint': 1 },
  coverage: { files: 1, excludedRoles: [], parseErrors: [] }, external: sources,
});
const finding = (overrides = {}) => ({
  id: 'CONV-012345abcdef', code: 'conventions/eslint', dimension: 'conventions', severity: 'warning', confidence: null,
  message: 'unused is defined but never used', subject: { file: 'src/a.ts', line: 1 }, evidence: {}, supportedFixes: [],
  evidenceDigest: { files: ['src/a.ts'], sha256: sha('d') },
  external: { sourceId: 'web-eslint', tool: 'ESLint', ruleId: 'no-unused-vars', originalSeverity: 1,
    reportPointer: '/0/messages/0', identityRevision: 1, binding: 'verified', reviewDigest: sha('e'), locations: [{ file: 'src/a.ts', line: 1 }] },
  ...overrides,
});

test('review target binds native and external claims, without depending on object key order or UI state', () => {
  const current = finding();
  const target = reviewTargetDigest(current);
  assert.match(target, /^[0-9a-f]{64}$/);
  const reordered = { ...current, subject: { line: 1, file: 'src/a.ts' }, review: { status: 'accepted' }, moduleIds: ['src'], componentIds: ['app'] };
  assert.equal(reviewTargetDigest(reordered), target);
  for (const updated of [
    { ...current, severity: 'error' },
    { ...current, message: 'A revised source claim' },
    { ...current, evidence: { threshold: { warning: 0 } } },
    { ...current, evidenceDigest: { ...current.evidenceDigest, sha256: sha('f') } },
    { ...current, external: { ...current.external, reviewDigest: sha('f') } },
  ]) assert.notEqual(reviewTargetDigest(updated), target, 'a stable id does not authorize accepting a different claim');
  const native = { ...current, external: undefined, confidence: 1 };
  assert.notEqual(reviewTargetDigest({ ...native, severity: 'error' }), reviewTargetDigest(native));
  assert.notEqual(reviewTargetDigest({ ...native, evidence: { threshold: 10 } }), reviewTargetDigest(native));
});

test('external baseline acceptance binds the captured source and the source claim independently', () => {
  const current = finding();
  const baseline = validateBaseline(baselineFrom([current], { reason: 'The exported name is intentional.' }));
  assert.equal(baseline.accepted[0].sha256, current.evidenceDigest.sha256);
  assert.equal(baseline.accepted[0].externalReviewDigest, current.external.reviewDigest);
  const reviewed = reviewFindings([current], { baseline });
  assert.equal(isOpen(reviewed, current.id), false);
  for (const changed of [
    { ...current, evidenceDigest: { ...current.evidenceDigest, sha256: sha('f') } },
    { ...current, external: { ...current.external, reviewDigest: sha('f') } },
    { ...current, external: { ...current.external, binding: 'changed' } },
    { ...current, evidenceDigest: undefined },
    { ...current, external: { ...current.external, reviewDigest: undefined } },
  ]) {
    const result = reviewFindings([changed], { baseline });
    assert.equal(result.findings[current.id].status, 'accepted-changed');
    assert.equal(isOpen(result, current.id), true, 'changed or missing evidence must count against the gate again');
  }
  const legacy = { schema_version: 1, accepted: [{ id: current.id, code: current.code, reason: 'Older baseline entry', sha256: current.evidenceDigest.sha256 }] };
  assert.equal(reviewFindings([current], { baseline: legacy }).findings[current.id].status, 'accepted-changed', 'a source hash alone does not review an external claim');
});

test('reviewed captured source from an unverified report may be accepted without upgrading report binding', () => {
  const current = finding();
  current.external.binding = 'unverified';
  const before = clone(current);
  const baseline = acceptFinding(current, { reason: 'Reviewed the current implementation and retained this export.' });
  assert.equal(reviewFindings([current], { baseline }).findings[current.id].status, 'accepted');
  assert.deepEqual(current, before, 'acceptance never rewrites report provenance');
  const compared = comparability(context([source({ binding: 'unverified' })]), context([source({ binding: 'unverified' })]));
  assert.equal(compared.comparable, false, 'user acceptance is not proof that both report runs checked the same source');
});

test('single-item accept and revoke preserve unrelated and stale baseline entries', () => {
  const current = finding();
  const existing = { schema_version: 1, accepted: [{ id: 'COUP-aaaaaaaaaaaa', code: 'coupling/cycle', reason: 'Known structure' }] };
  const before = clone(existing);
  const accepted = acceptFinding(current, { existing, reason: '  Intentional public export.  ' });
  assert.equal(accepted.accepted.find((entry) => entry.id === current.id).reason, 'Intentional public export.');
  assert.deepEqual(revokeFinding(current.id, { existing: accepted }), existing);
  assert.deepEqual(revokeFinding(current.id, { existing }), existing, 'revoking an absent id is idempotent');
  assert.deepEqual(existing, before, 'pure helpers do not mutate the caller baseline');
  for (const reason of [undefined, '', ' \n ']) assert.throws(() => acceptFinding(current, { reason }), (error) => error instanceof DiagnosticError && error.diagnostics[0].code === 'baseline/reason-required');
  for (const invalid of [
    { ...current, evidenceDigest: undefined },
    { ...current, external: { ...current.external, binding: 'changed' } },
  ]) {
    assert.throws(() => acceptFinding(invalid, { reason: 'Reviewed' }), (error) => error.diagnostics[0].code === 'baseline/evidence-unverifiable');
    assert.throws(() => baselineFrom([invalid], { reason: 'Reviewed' }), (error) => error.diagnostics[0].code === 'baseline/evidence-unverifiable');
  }
});

test('legacy internal acceptance still permits entries without hashes', () => {
  const internal = { ...finding(), id: 'COUP-bbbbbbbbbbbb', code: 'coupling/hub', dimension: 'coupling', external: undefined, evidenceDigest: undefined };
  const baseline = acceptFinding(internal, { reason: 'Known hub.' });
  assert.equal(reviewFindings([internal], { baseline }).findings[internal.id].status, 'accepted');
  assert.equal(baseline.accepted[0].externalReviewDigest, undefined);
});

test('same-id metadata changes reappear in the evidence-changed comparison, not unchanged', () => {
  const original = finding();
  const changed = { ...original, external: { ...original.external, reviewDigest: sha('f') } };
  const result = reviewFindings([changed], { previous: { diagnostics: [original], analysis: context() }, analysis: context() });
  assert.deepEqual(result.comparison.evidenceChanged, [original.id]);
  assert.equal(result.comparison.unchanged, 0);
});

test('different report bytes and nonsemantic source ordering remain comparable', () => {
  const first = source({ coverage: { files: ['src/a.ts', 'src/b.py'], complete: true } });
  const other = source({ id: 'api-eslint' });
  const after = { ...first, reportSha256: sha('f'), reportFile: 'reports/new-name.json', coverage: { files: ['src/b.py', 'src/a.ts'], complete: true } };
  assert.deepEqual(comparability(context([first, other]), context([other, after])), { comparable: true, reasons: [] });
});

test('source-qualified comparison reasons explain changed and unknown external measurements', () => {
  for (const [override, expected] of [
    [{ toolVersion: '10.0.0' }, 'external-tool-changed'],
    [{ toolVersion: null }, 'external-tool-unknown'],
    [{ configDigest: sha('f') }, 'external-config-changed'],
    [{ configDigest: null }, 'external-config-unknown'],
    [{ severityPolicy: 'warning' }, 'external-import-settings-changed'],
    [{ importSettingsDigest: sha('f') }, 'external-import-settings-changed'],
    [{ binding: 'unverified' }, 'external-binding-unverified'],
    [{ binding: 'changed' }, 'external-binding-changed'],
    [{ status: 'partial' }, 'external-coverage-incomplete'],
    [{ coverage: { files: ['src/a.ts'], complete: null } }, 'external-coverage-unknown'],
    [{ coverage: { files: ['src/b.py'], complete: true } }, 'external-scope-changed'],
    [{ identityRevision: 2 }, 'external-adapter-changed'],
  ]) {
    const result = comparability(context(), context([source(override)]));
    assert.equal(result.comparable, false, expected);
    assert.ok(result.reasons.some((reason) => reason.code === expected && reason.sourceId === 'web-eslint'), expected);
  }
});

test('missing Go build scope stays unknown unless an external measurement difference is known', () => {
  const before = { ...context(), language: 'go', adapter: 'go@test' };
  const unknown = comparability(before, clone(before));
  assert.equal(unknown.comparable, null, 'matching external context cannot establish a missing native build scope');
  assert.deepEqual(unknown.reasons.map(reason => reason.code), ['go-build-scope-missing']);

  const after = { ...clone(before), external: [source({ severityPolicy: 'warning', importSettingsDigest: sha('f') })] };
  const changed = comparability(before, after);
  assert.equal(changed.comparable, false, 'known external differences must not be hidden by unknown Go scope');
  assert.ok(changed.reasons.some(reason => reason.code === 'go-build-scope-missing'));
  assert.ok(changed.reasons.some(reason => reason.code === 'external-import-settings-changed' && reason.sourceId === 'web-eslint'));
});

test('an absent external source is not a fix, while a fresh complete empty report is comparable', () => {
  const original = finding();
  const previous = { diagnostics: [original], analysis: context() };
  const missing = reviewFindings([], { previous, analysis: context([]), files: [] }).comparison;
  assert.equal(missing.comparable, false);
  assert.equal(missing.notDetected[0].sourceId, 'web-eslint');
  assert.equal(missing.notDetected[0].likelyCause, 'external-source-missing');
  const empty = reviewFindings([], { previous, analysis: context(), files: [] }).comparison;
  assert.equal(empty.comparable, true);
  assert.equal(empty.notDetected[0].likelyCause, undefined, 'no current finding snapshot is needed when this source declares the file was checked');
  const partial = reviewFindings([], { previous, analysis: context([source({ status: 'partial' })]) }).comparison;
  assert.equal(partial.notDetected[0].likelyCause, 'external-coverage-incomplete');
});

test('external disappearance never proposes a renamed match from another tool source', () => {
  const original = finding();
  const incoming = finding({ id: 'CONV-aaaaaaaaaaaa' });
  incoming.external.sourceId = 'api-eslint';
  const result = reviewFindings([incoming], {
    previous: { diagnostics: [original], analysis: context() },
    analysis: context([source(), source({ id: 'api-eslint' })]),
  }).comparison;
  assert.equal(result.notDetected[0].likelyCause, undefined);
  assert.equal(result.notDetected[0].candidates, undefined);
});

function capturedTask(t, binding = 'verified') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-external-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const text = 'const unused = 1;\n';
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/a.ts'), text);
  const diagnostic = finding();
  diagnostic.evidenceDigest = createRangeDigest([{ file: 'src/a.ts', line: 1, endLine: 1 }], new Map([['src/a.ts', text]]));
  diagnostic.external.binding = binding;
  return { root, task: {
    findings: [diagnostic], source: { external: [source({ binding })] },
    locations: [withExcerpt({ findingId: diagnostic.id, file: 'src/a.ts', startLine: 1, endLine: 1, kind: 'range' }, splitLines(text))],
  } };
}

test('task evidence keeps source-byte verification separate from report freshness', (t) => {
  for (const [binding, expected] of [['verified', 'valid'], ['unverified', 'unverifiable'], ['changed', 'changed']]) {
    const { root, task } = capturedTask(t, binding);
    const result = verifyTask(task, root);
    assert.equal(result.locations[0].status, 'valid');
    assert.equal(result.evidence.status, expected);
    const checked = result.evidence.findings[task.findings[0].id];
    assert.equal(checked.sourceStatus, 'valid');
    assert.equal(checked.reportBinding, binding);
    assert.equal(checked.digestMatches, true);
    if (binding !== 'verified') assert.match(result.evidence.reason, /external report binding/);
  }
});

test('missing task source context cannot upgrade a report, and missing source stays the strongest failure', (t) => {
  const { root, task } = capturedTask(t);
  delete task.source.external;
  assert.equal(verifyTask(task, root).evidence.status, 'unverifiable');
  fs.rmSync(path.join(root, 'src/a.ts'));
  const missing = verifyTask(task, root);
  assert.equal(missing.evidence.status, 'missing');
  assert.equal(missing.evidence.findings[task.findings[0].id].sourceStatus, 'missing');
});

test('generation-time source hashes catch a change elsewhere in the external scan', (t) => {
  const { root, task } = capturedTask(t);
  const use = 'import { unused } from "./a";\nconsole.log(unused);\n';
  const other = path.join(root, 'src/use.ts');
  fs.writeFileSync(other, use);
  task.source.external[0].sourceHashes = { 'src/use.ts': createHash('sha256').update(use).digest('hex') };
  assert.equal(verifyTask(task, root).evidence.status, 'valid');
  fs.writeFileSync(other, 'export {};\n');
  const result = verifyTask(task, root);
  assert.equal(result.locations[0].status, 'valid', 'the cited declaration is unchanged');
  assert.equal(result.evidence.findings[task.findings[0].id].sourceStatus, 'valid');
  assert.equal(result.evidence.status, 'changed', 'the external scan used another version of a relevant file');
  assert.match(result.evidence.findings[task.findings[0].id].reason, /src\/use.ts changed/);
});
