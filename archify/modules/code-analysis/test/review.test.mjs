// Baseline, run comparison, and the headless check command.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { baselineFrom, decideFinding, isOpen, reviewFindings, validateBaseline } from '../lib/review.mjs';
import { buildOverview } from '../overlay/overview.mjs';
import { DiagnosticError } from '../extract/shared/diagnostics.mjs';

const CHECK = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'check.mjs');
const digest = (c) => c.repeat(64);
const finding = (id, severity, sha, code = 'coupling/hub') => ({ id, code, severity, dimension: 'coupling', subject: { module: id }, evidence: {}, evidenceDigest: { files: ['a.py'], sha256: sha } });
const A = finding('COUP-aaaaaaaaaaaa', 'warning', digest('1'));
const B = finding('COUP-bbbbbbbbbbbb', 'warning', digest('2'));
const C = finding('COUP-cccccccccccc', 'info', digest('3'));

test('baseline: accepted, accepted with changed evidence, open, and stale entries', () => {
  const baseline = validateBaseline({ schema_version: 1, accepted: [
    { id: A.id, code: A.code, reason: 'known hub', sha256: digest('1') },
    { id: B.id, code: B.code, reason: 'known too', sha256: digest('9') },
    { id: 'COUP-dddddddddddd', code: 'coupling/cycle', reason: 'fixed since' },
  ] });
  const r = reviewFindings([A, B, C], { baseline });
  assert.deepEqual(r.findings[A.id], { status: 'accepted', reason: 'known hub' });
  assert.deepEqual(r.findings[B.id], { status: 'accepted-changed', reason: 'known too' }, 'evidence changed since it was accepted');
  assert.deepEqual(r.findings[C.id], { status: 'open' });
  assert.deepEqual(r.baseline.stale, [{ id: 'COUP-dddddddddddd', code: 'coupling/cycle', reason: 'fixed since' }]);
  assert.equal(r.comparison, null, 'no previous run, no comparison');
  assert.equal(isOpen(r, A.id), false);
  assert.equal(isOpen(r, B.id), true, 'changed evidence reopens an accepted finding');
});

test('baseline: an entry without a digest stays accepted whatever the evidence', () => {
  const r = reviewFindings([A], { baseline: { schema_version: 1, accepted: [{ id: A.id, code: A.code, reason: 'r' }] } });
  assert.equal(r.findings[A.id].status, 'accepted');
});

test('baseline: invalid or duplicated entries are refused with a diagnostic', () => {
  for (const doc of [{ accepted: [] }, { schema_version: 1, accepted: [{ id: 'COUP-0001', code: 'coupling/hub', reason: 'old id format' }] },
    { schema_version: 1, accepted: [{ id: A.id, code: A.code }] },
    { schema_version: 1, accepted: [{ id: A.id, code: A.code, reason: 'x' }, { id: A.id, code: A.code, reason: 'y' }] }]) {
    assert.throws(() => validateBaseline(doc), (e) => e instanceof DiagnosticError && e.diagnostics[0].code === 'baseline/invalid', JSON.stringify(doc));
  }
});

test('comparison: new, fixed, evidence-changed and unchanged relative to the previous run', () => {
  const previous = { repository: { snapshotId: 'prev' }, diagnostics: [A, { ...B, evidenceDigest: { files: ['a.py'], sha256: digest('8') } }, finding('COUP-eeeeeeeeeeee', 'warning', digest('5'))] };
  const r = reviewFindings([A, B, C], { previous });
  assert.deepEqual(r.comparison.new, [C.id]);
  assert.deepEqual(r.comparison.evidenceChanged, [B.id]);
  assert.deepEqual(r.comparison.fixed.map((f) => f.id), ['COUP-eeeeeeeeeeee']);
  assert.equal(r.comparison.unchanged, 1);
  assert.equal(r.comparison.previousSnapshot, 'prev');
  assert.equal(r.findings[C.id].since, 'new');
});

test('decideFinding: accepting needs a reason and records the current evidence hash', () => {
  const current = finding('COMP-aaaaaaaaaaaa', 'warning', digest('a'));
  const doc = decideFinding({ schema_version: 1, accepted: [] }, { id: current.id, action: 'accept', reason: '  business constraint  ', finding: current });
  assert.deepEqual(doc.accepted, [{ id: current.id, code: current.code, reason: 'business constraint', sha256: digest('a') }]);
  assert.throws(() => decideFinding(doc, { id: current.id, action: 'accept', reason: '   ', finding: current }), (e) => e.diagnostics[0].code === 'baseline/reason-required');
  assert.throws(() => decideFinding(doc, { id: 'COMP-bbbbbbbbbbbb', action: 'accept', reason: 'because', finding: null }), (e) => e.diagnostics[0].code === 'baseline/unknown-finding');
});

test('decideFinding: revoke removes only that entry', () => {
  const current = finding('COMP-aaaaaaaaaaaa', 'warning', digest('a'));
  const doc = decideFinding({ schema_version: 1, accepted: [] }, { id: current.id, action: 'accept', reason: 'kept', finding: current });
  const cleared = decideFinding(doc, { id: current.id, action: 'revoke' });
  assert.deepEqual(cleared.accepted, []);
  assert.throws(() => decideFinding(cleared, { id: current.id, action: 'revoke' }), (e) => e.diagnostics[0].code === 'baseline/not-accepted');
});

test('baselineFrom: keeps existing reasons, records digests, drops entries that no longer occur', () => {
  const existing = { schema_version: 1, accepted: [{ id: A.id, code: A.code, reason: 'agreed in review' }, { id: 'COUP-dddddddddddd', code: 'coupling/cycle', reason: 'gone' }] };
  const doc = validateBaseline(baselineFrom([B, A], { existing, reason: 'new debt' }));
  assert.deepEqual(doc.accepted, [
    { id: A.id, code: A.code, reason: 'agreed in review', sha256: digest('1') },
    { id: B.id, code: B.code, reason: 'new debt', sha256: digest('2') },
  ]);
});

test('overview: accepted findings are counted but leave the verdict and the priorities', () => {
  const graph = { modules: [], excluded: { roles: [] } };
  const review = reviewFindings([A, C], { baseline: { schema_version: 1, accepted: [{ id: A.id, code: A.code, reason: 'r', sha256: digest('1') }] } });
  const listed = [A, C].map((f) => ({ ...f, review: review.findings[f.id], moduleIds: [], componentIds: [] }));
  const o = buildOverview({ findings: listed, graph, run: { review } });
  assert.equal(o.verdict, 'signals-only', 'the accepted warning no longer drives the verdict');
  assert.deepEqual(o.priorities, [C.id]);
  assert.equal(o.counts.accepted, 1);
  assert.equal(o.counts.warning, 0);
  assert.equal(o.findings.find((e) => e.id === A.id).status, 'accepted');
  assert.equal(o.review.baseline.accepted, 1);
});

function pyTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-check-'));
  fs.mkdirSync(path.join(dir, 'app'));
  fs.writeFileSync(path.join(dir, 'app/__init__.py'), '');
  fs.writeFileSync(path.join(dir, 'app/a.py'), 'from app import b\n\ndef fa():\n    return b.fb()\n');
  fs.writeFileSync(path.join(dir, 'app/b.py'), 'from app import a\n\ndef fb():\n    return 1\n');
  return dir;
}
const check = (args, cwd) => {
  const r = spawnSync(process.execPath, [CHECK, ...args], { cwd, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr, json: args.includes('--json') && r.stdout ? JSON.parse(r.stdout) : null };
};

test('check: exit codes follow the gate, the baseline and the comparison', () => {
  const dir = pyTree();
  try {
    const first = check(['.', '--language', 'py', '--out', 'out', '--json'], dir);
    assert.equal(first.code, 1, 'an eager import cycle is a warning');
    assert.equal(first.json.status, 'failed');
    assert.equal(first.json.gate.failing[0].code, 'coupling/import-cycle');
    for (const f of ['raw-facts', 'module-graph', 'findings', 'review', 'overview']) assert.ok(fs.existsSync(path.join(dir, 'out', `${f}.json`)), f);
    assert.equal(check(['.', '--language', 'py', '--fail-on', 'error'], dir).code, 0, 'no error-level finding');
    assert.equal(check(['.', '--language', 'py', '--fail-on', 'never'], dir).code, 0);

    const written = check(['.', '--language', 'py', '--baseline', 'baseline.json', '--update-baseline', '--reason', 'known cycle'], dir);
    assert.equal(written.code, 0);
    assert.match(written.out, /Baseline written: .*baseline\.json/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'baseline.json'), 'utf8')).accepted[0].reason, 'known cycle');
    const accepted = check(['.', '--language', 'py', '--baseline', 'baseline.json', '--out', 'out', '--json'], dir);
    assert.equal(accepted.code, 0, 'accepted findings do not fail the run');
    assert.equal(accepted.json.review.comparison.new, 0, 'the previous run in --out is compared automatically');

    // A new eager cycle appears; the old one stays accepted.
    fs.writeFileSync(path.join(dir, 'app/c.py'), 'from app import d\n');
    fs.writeFileSync(path.join(dir, 'app/d.py'), 'from app import c\n');
    const regressed = check(['.', '--language', 'py', '--baseline', 'baseline.json', '--out', 'out', '--new-only', '--json'], dir);
    assert.equal(regressed.code, 1);
    assert.equal(regressed.json.gate.failing.length, 1, 'only the new cycle fails; the accepted one does not');
    assert.equal(regressed.json.gate.failing[0].code, 'coupling/import-cycle');
    assert.match(regressed.json.gate.failing[0].where, /^app\/(c|d)\.py:1$/);
    assert.ok(regressed.json.review.comparison.new >= 1);

    // The old cycle is fixed: its baseline entry becomes stale and is reported.
    fs.writeFileSync(path.join(dir, 'app/b.py'), 'def fb():\n    return 1\n');
    const fixed = check(['.', '--language', 'py', '--baseline', 'baseline.json', '--out', 'out'], dir);
    assert.match(fixed.out, /stale: COUP-[0-9a-f]{12} \(coupling\/import-cycle\) no longer found/);
    assert.match(fixed.out, /Since the previous run: 0 new, 1 no longer detected/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('check: --new-only without a previous run treats every open finding as new', () => {
  const dir = pyTree();
  try {
    const cold = check(['.', '--language', 'py', '--new-only', '--json'], dir);
    assert.equal(cold.code, 1, 'a missing comparison artifact must not pass the gate');
    assert.equal(cold.json.gate.failing[0].code, 'coupling/import-cycle');
    assert.match(cold.json.gate.note, /every open finding counts as new/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('check: usage and analysis errors exit 2 with a diagnostic, never a stack', () => {
  const dir = pyTree();
  try {
    const bad = check(['.', '--fail-on', 'sometimes', '--json'], dir);
    assert.equal(bad.code, 2);
    assert.equal(bad.json.diagnostics[0].code, 'cli/usage');
    const noBaselineFile = check(['.', '--update-baseline'], dir);
    assert.equal(noBaselineFile.code, 2);
    assert.match(noBaselineFile.err, /--update-baseline needs --baseline/);
    fs.writeFileSync(path.join(dir, 'broken.json'), '{"schema_version": 1, "accepted": [{"id": "x"}]}');
    const invalid = check(['.', '--language', 'py', '--baseline', 'broken.json', '--json'], dir);
    assert.equal(invalid.code, 2);
    assert.equal(invalid.json.diagnostics[0].code, 'baseline/invalid');
    assert.doesNotMatch(invalid.out + invalid.err, /\n\s+at /, 'no stack trace');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
