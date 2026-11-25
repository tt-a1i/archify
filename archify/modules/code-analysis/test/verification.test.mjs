import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { evaluateVerification } from '../lib/verification.mjs';
import { verificationContext } from '../lib/verification-context.mjs';
import { schemaErrors } from '../schemas/index.mjs';
import { Ajv2020 } from '../vendor/deps.cjs';

test('receipt distinguishes an unchanged external report from a detected source fix and cannot transfer check results to a different analysis', async () => {
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
  const task = { schema_version: 1, kind: 'archify-code-analysis-task', taskId: 'TASK-305741857dd9',
    source: { root: '.', snapshotId: sha('1'), configDigest: sha('a') }, findings: diagnostics };
  const result = await evaluateVerification(ctx, task);
  assert.ok(result.receipt, result.error);
  assert.equal(result.receipt.projectChecks.status, 'not-reported');
  assert.deepEqual(result.receipt.analysis.selected.map(({ outcome }) => outcome), ['not-detected', 'inconclusive']);
  assert.equal(result.receipt.analysis.selected[1].externalReport, 'same-bytes');
  const checks = { ...result.checksTemplate, checks: [{ name: 'Project unit tests', status: 'failed' }] };
  assert.deepEqual((await evaluateVerification(ctx, task, checks)).receipt.projectChecks, {
    status: 'reported-not-independently-verified', checks: checks.checks,
  });
  const edited = { ...task, findings: [diagnostics[1]] };
  assert.equal((await evaluateVerification(ctx, edited)).error, 'wrong-task-id', 'an edited selection cannot keep the exported task ID even without project checks');
  assert.equal((await evaluateVerification(ctx, { ...edited, taskId: 'TASK-a167fd8f85b9' }, checks)).error, 'wrong-checks-snapshot', 'checks for the original task cannot move to a different selection');
  const refreshed = verificationContext(previous, fixture('2', [diagnostics[1]], sha('b')), review);
  assert.equal((await evaluateVerification(refreshed, task, checks)).error, 'wrong-checks-snapshot', 'report bytes can change even when source snapshot does not');
  assert.equal((await evaluateVerification(ctx, { ...task, source: { ...task.source, snapshotId: sha('0') } }, checks)).error, 'wrong-task-snapshot');
  assert.equal((await evaluateVerification(ctx, { ...task, findings: [{ ...diagnostics[1], external: { ...external, reviewDigest: sha('0') } }] })).error, 'wrong-task-findings');
  assert.equal((await evaluateVerification([ctx, refreshed], task)).error, 'wrong-task-snapshot',
    'legacy task JSON cannot silently choose between different reports for the same code snapshot');
  const pinned = { ...task, source: { ...task.source, analysisSha256: ctx.before.analysisSha256 } };
  const otherBefore = { ...refreshed, taskAnalysisSha256: sha('0'), before: { ...refreshed.before, analysisSha256: sha('0') } };
  assert.deepEqual((await evaluateVerification([otherBefore, ctx], pinned)).receipt, result.receipt);
  assert.equal((await evaluateVerification([otherBefore], pinned)).error, 'wrong-task-snapshot');
  const limited = verificationContext(previous, current, { comparison: { ...review.comparison,
    comparable: false, reasons: [{ code: 'config-changed' }], new: ['unaudited-addition'] } });
  const limitedResult = await evaluateVerification(limited, task);
  assert.equal(limitedResult.receipt.analysis.newCount, null);
  assert.equal(limitedResult.receipt.analysis.selected[0].outcome, 'inconclusive');
  const missing = structuredClone(task);
  delete missing.findings[0].evidenceDigest;
  missing.taskId = 'TASK-8cd8467cfaef';
  const missingPrevious = fixture('1', missing.findings, sha('c'));
  const missingContext = verificationContext(missingPrevious, current, review);
  const missingResult = await evaluateVerification(missingContext, missing);
  assert.equal(missingResult.receipt.analysis.selected[0].outcome, 'inconclusive');
  assert.equal(missingResult.receipt.analysis.selected[0].observed, 'not-detected');
  assert.equal(missingResult.receipt.analysis.selected[0].limitation, 'missing-evidence');
  const lossy = verificationContext(previous, current, { comparison: { ...review.comparison, notDetected: [{ id: diagnostics[0].id, likelyCause: 'parse-error' }] } });
  assert.equal((await evaluateVerification(lossy, task)).receipt.analysis.selected[0].outcome, 'inconclusive');
});

test('verify-change returns exit 2 and separates missing comparisons from malformed task JSON', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-verification-errors-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL('../../../bin/archify.mjs', import.meta.url));
  const task = path.join(dir, 'task.json');
  const verify = () => {
    const result = spawnSync(process.execPath, [cli, 'code-analysis', 'verify-change', dir, '--task', task], { encoding: 'utf8' });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    const error = JSON.parse(result.stdout);
    assert.equal(error.status, 'error');
    assert.equal(error.command, 'verify-change');
    assert.equal(error.diagnostics.length, 1);
    assert.ok(error.diagnostics[0].supportedFixes.length > 0);
    return error.diagnostics[0];
  };
  fs.writeFileSync(task, '{}');
  assert.equal(verify().code, 'verification/no-comparison');
  fs.writeFileSync(task, '{not JSON}');
  const diagnostic = verify();
  assert.equal(diagnostic.code, 'cli/input-not-json');
  assert.equal(diagnostic.subject.input, 'task');
});


test('a pinned review with a missing base never falls back to an adjacent working-tree capture', t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-pinned-verify-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const dir = path.join(scratch, 'analysis'), previousDir = path.join(scratch, 'analysis.previous');
  fs.mkdirSync(dir); fs.mkdirSync(previousDir);
  const findings = fs.readFileSync(new URL('./fixtures/tasks/findings.json', import.meta.url));
  fs.writeFileSync(path.join(dir, 'findings.json'), findings);
  fs.writeFileSync(path.join(previousDir, 'findings.json'), findings);
  fs.writeFileSync(path.join(dir, 'raw-facts.json'), JSON.stringify({ files: [] }));
  fs.writeFileSync(path.join(dir, 'view-context.json'), JSON.stringify({ run: { pullRequest: { local: true } } }));
  const identity = JSON.stringify({ identity: 'a'.repeat(64) });
  fs.writeFileSync(path.join(dir, 'verification-owner.json'), identity);
  fs.writeFileSync(path.join(previousDir, 'verification-owner.json'), identity);
  const task = path.join(scratch, 'task.json'); fs.writeFileSync(task, '{}');
  const cli = fileURLToPath(new URL('../../../bin/archify.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'code-analysis', 'verify-change', dir, '--task', task], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'verification/no-comparison');
});


test('task fingerprint is optional for current readers but rejected by an older strict schema', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('../schemas/ai-task.schema.json', import.meta.url), 'utf8'));
  const task = JSON.parse(fs.readFileSync(new URL('./fixtures/tasks/complexity.task.json', import.meta.url), 'utf8'));
  assert.deepEqual(schemaErrors('ai-task', task), []);
  const legacyTask = structuredClone(task);
  delete legacyTask.source.analysisSha256;
  assert.deepEqual(schemaErrors('ai-task', legacyTask), []);
  delete schema.properties.source.properties.analysisSha256;
  const oldValidate = new Ajv2020({ allErrors: true, strict: true, strictRequired: false }).compile(schema);
  assert.equal(oldValidate(legacyTask), true);
  assert.equal(oldValidate(task), false);
  assert.ok(oldValidate.errors.some(error => error.instancePath === '/source' && error.params.additionalProperty === 'analysisSha256'));
});
