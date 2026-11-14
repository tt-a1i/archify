import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateVerification } from '../lib/verification.mjs';
import { verificationContext } from '../lib/verification-context.mjs';

test('receipt distinguishes an unchanged external report from a detected source fix and cannot transfer check results to a different analysis', () => {
  const sha = (char) => char.repeat(64);
  const external = { sourceId: 'lint', reviewDigest: sha('f') };
  const diagnostics = [
    { id: 'COUP-000000000001', code: 'coupling/import-cycle', evidenceDigest: { sha256: sha('d') } },
    { id: 'CONV-000000000002', code: 'conventions/eslint', evidenceDigest: { sha256: sha('e') }, external },
  ];
  const fixture = (snapshot, findings, reportSha256) => ({
    repository: { root: '.', snapshotId: sha(snapshot) },
    analysis: { configDigest: sha('a'), external: [{ id: 'lint', reportSha256 }] }, diagnostics: findings,
  });
  const previous = fixture('1', diagnostics, sha('c'));
  const current = fixture('2', [diagnostics[1]], sha('c'));
  const review = { comparison: { previousSnapshot: sha('1'), comparable: true, reasons: [],
    new: [], notDetected: [{ id: diagnostics[0].id }], evidenceChanged: [] } };
  const ctx = verificationContext(previous, current, review);
  const task = { schema_version: 1, kind: 'archify-code-analysis-task', taskId: 'TASK-aabbcc112233',
    source: { root: '.', snapshotId: sha('1'), configDigest: sha('a') }, findings: diagnostics };
  const result = evaluateVerification(ctx, task);
  assert.equal(result.receipt.projectChecks.status, 'not-reported');
  assert.deepEqual(result.receipt.analysis.selected.map(({ outcome }) => outcome), ['not-detected', 'inconclusive']);
  assert.equal(result.receipt.analysis.selected[1].externalReport, 'same-bytes');
  const checks = { ...result.checksTemplate, checks: [{ name: 'Project unit tests', status: 'failed' }] };
  assert.deepEqual(evaluateVerification(ctx, task, checks).receipt.projectChecks, {
    status: 'reported-not-independently-verified', checks: checks.checks,
  });
  const refreshed = verificationContext(previous, fixture('2', [diagnostics[1]], sha('b')), review);
  assert.equal(evaluateVerification(refreshed, task, checks).error, 'wrong-checks-snapshot', 'report bytes can change even when source snapshot does not');
  assert.equal(evaluateVerification(ctx, { ...task, source: { ...task.source, snapshotId: sha('0') } }, checks).error, 'wrong-task-snapshot');
  assert.equal(evaluateVerification(ctx, { ...task, findings: [{ ...diagnostics[1], external: { ...external, reviewDigest: sha('0') } }] }).error, 'wrong-task-findings');
  const limited = verificationContext(previous, current, { comparison: { ...review.comparison,
    comparable: false, reasons: [{ code: 'config-changed' }], new: ['unaudited-addition'] } });
  assert.equal(evaluateVerification(limited, task).receipt.analysis.newCount, null);
  assert.equal(evaluateVerification(limited, task).receipt.analysis.selected[0].outcome, 'inconclusive');
  const lossy = verificationContext(previous, current, { comparison: { ...review.comparison, notDetected: [{ id: diagnostics[0].id, likelyCause: 'parse-error' }] } });
  assert.equal(evaluateVerification(lossy, task).receipt.analysis.selected[0].outcome, 'inconclusive');
});
