import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { matchingPreviousPullRequest, retainVerificationBaselines, sameVerificationRepository, verificationContexts } from '../lib/verification-history.mjs';
import { analysisDigest, taskAnalysisDigest } from '../lib/verification-context.mjs';
import { evaluateVerification } from '../lib/verification.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/tasks/findings.json', import.meta.url), 'utf8'));
const snapshotId = (number) => number.toString(16).padStart(64, '0');
const capture = (number, repository = {}) => ({
  ...fixture,
  repository: { ...fixture.repository, root: '.', sourceKind: 'working-tree', snapshotId: snapshotId(number), ...repository },
});

let testRoot;
function workspace(t) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-verification-history-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  testRoot = scratch;
  return (name) => { const dir = path.join(scratch, String(name)); fs.mkdirSync(dir, { recursive: true }); return dir; };
}

const historyFile = (dir) => path.join(dir, 'verification-history.json');
const savedIds = (dir) => JSON.parse(fs.readFileSync(historyFile(dir), 'utf8')).map(({ repository }) => repository.snapshotId);
const beforeIds = (contexts) => contexts.map(({ before }) => before.snapshotId);

test('verification history keeps the six newest distinct captures across staged runs', t => {
  const directory = workspace(t);
  let published = directory('first');
  retainVerificationBaselines(published, published, null, capture(1), testRoot);
  const scans = [1, 2, 3, 4, 5, 6, 7, 8, 8, 8];
  for (const [index, number] of scans.entries()) {
    const next = directory(index);
    retainVerificationBaselines(next, published, capture(number), capture(scans[index + 1] ?? number), testRoot);
    published = next;
  }

  const expected = [8, 7, 6, 5, 4, 3].map(snapshotId);
  assert.deepEqual(savedIds(published), expected);
  assert.deepEqual(beforeIds(verificationContexts(published, capture(8), capture(9), { files: [] })), expected);
});

test('verification history fits a byte budget and keeps smaller eligible captures', t => {
  const directory = workspace(t);
  const initial = directory('initial');
  const published = directory('published');
  const next = directory('next');
  const current = capture(4);
  retainVerificationBaselines(initial, initial, null, current, testRoot);
  const evidence = (number, length) => {
    const sourceText = '界'.repeat(length);
    return {
      ...capture(number),
      externalEvidence: [{ path: 'supplemental.py', sourceText, sha256: createHash('sha256').update(sourceText).digest('hex') }],
    };
  };

  retainVerificationBaselines(initial, initial, capture(1), current, testRoot);
  retainVerificationBaselines(published, initial, evidence(2, 800_000), current, testRoot);
  retainVerificationBaselines(next, published, evidence(3, 800_000), current, testRoot);

  assert.ok(fs.statSync(historyFile(next)).size <= 4 * 1024 * 1024);
  assert.deepEqual(savedIds(next), [3, 1].map(snapshotId));

  const oversized = directory('oversized');
  retainVerificationBaselines(oversized, next, evidence(5, 1_400_000), current, testRoot);
  assert.deepEqual(savedIds(oversized), [3, 1].map(snapshotId));
});

test('verification history excludes other roots and source kinds and falls back to the prior capture', t => {
  const directory = workspace(t);
  const previous = directory('previous');
  const next = directory('next');
  const adjacent = capture(1);
  const wrongRoot = capture(2, { root: 'another-project' });
  const wrongKind = capture(3, { sourceKind: 'git-tree' });
  const current = capture(4);
  retainVerificationBaselines(previous, previous, null, current, testRoot);

  assert.deepEqual(beforeIds(verificationContexts(previous, adjacent, current, { files: [] })), [snapshotId(1)]);
  fs.writeFileSync(historyFile(previous), JSON.stringify([wrongRoot, wrongKind, adjacent]));

  retainVerificationBaselines(next, previous, wrongRoot, current, testRoot);
  assert.deepEqual(savedIds(next), [snapshotId(1)]);
  assert.deepEqual(beforeIds(verificationContexts(previous, wrongKind, current, { files: [] })), [snapshotId(1)]);
});


test('history does not cross repositories sharing one output directory', t => {
  const directory = workspace(t);
  const repoA = directory('repo-a'), repoB = directory('repo-b');
  const a = directory('a'), b = directory('b'), first = directory('first');
  retainVerificationBaselines(first, first, null, capture(1), repoA);
  retainVerificationBaselines(a, first, capture(1), capture(2), repoA);
  assert.deepEqual(savedIds(a), [snapshotId(1)]);
  assert.deepEqual(retainVerificationBaselines(b, a, capture(2), capture(3), repoB), []);
  assert.equal(fs.existsSync(historyFile(b)), false);
  fs.rmdirSync(repoA); fs.mkdirSync(repoA);
  const replaced = directory('replaced');
  assert.deepEqual(retainVerificationBaselines(replaced, a, capture(2), capture(3), repoA), [], 'a replacement directory at the same path is a different repository');
});

test('captures differing only in supplemental evidence use one task identity', t => {
  const directory = workspace(t), first = directory('first'), next = directory('next'), last = directory('last');
  const baseline = capture(1), current = capture(2);
  retainVerificationBaselines(first, first, null, baseline, testRoot);
  retainVerificationBaselines(next, first, baseline, current, testRoot);
  const bytes = 'additional source';
  const supplemented = { ...baseline, externalEvidence: [{ path: 'source.py', sourceText: bytes, sha256: createHash('sha256').update(bytes).digest('hex') }] };
  retainVerificationBaselines(last, next, supplemented, current, testRoot);
  assert.equal(savedIds(last).length, 1);
  const contexts = verificationContexts(last, supplemented, current, { files: [] });
  assert.equal(beforeIds(contexts).length, 1);
  assert.equal(contexts[0].before.analysisSha256, analysisDigest(baseline), 'checks stay bound to the original retained capture');
});

test('an oversized duplicate does not evict its smaller retained baseline', t => {
  const directory = workspace(t), first = directory('first'), next = directory('next'), last = directory('last');
  const baseline = capture(1), current = capture(2);
  retainVerificationBaselines(first, first, null, baseline, testRoot);
  retainVerificationBaselines(next, first, baseline, current, testRoot);
  const sourceText = 'x'.repeat(4 * 1024 * 1024);
  const oversized = { ...baseline, externalEvidence: [{ path: 'source.py', sourceText, sha256: createHash('sha256').update(sourceText).digest('hex') }] };
  retainVerificationBaselines(last, next, oversized, current, testRoot);
  assert.deepEqual(savedIds(last), [snapshotId(1)]);
});

test('an oversized owned adjacent capture remains usable outside retained history', t => {
  const directory = workspace(t), previous = directory('previous'), currentDir = directory('current');
  const current = capture(2), sourceText = 'x'.repeat(5 * 1024 * 1024);
  const oversized = { ...capture(1), externalEvidence: [{ path: 'source.py', sourceText, sha256: createHash('sha256').update(sourceText).digest('hex') }] };
  retainVerificationBaselines(previous, previous, null, current, testRoot);
  assert.deepEqual(retainVerificationBaselines(currentDir, previous, oversized, current, testRoot), [], 'the 4 MiB history cap still applies');
  assert.equal(sameVerificationRepository(currentDir, previous), true);
  assert.deepEqual(beforeIds(verificationContexts(currentDir, oversized, current, { files: [] })), [snapshotId(1)], 'the independently owned adjacent capture can still be compared');
});

test('checks from a supplemental-only change remain usable after an unchanged rerun', async t => {
  const directory = workspace(t), first = directory('first'), next = directory('next'), last = directory('last');
  const baseline = capture(1), current = capture(2);
  const task = JSON.parse(fs.readFileSync(new URL('./fixtures/tasks/complexity.task.json', import.meta.url), 'utf8'));
  task.source.snapshotId = baseline.repository.snapshotId;
  task.source.analysisSha256 = taskAnalysisDigest(baseline);
  retainVerificationBaselines(first, first, null, baseline, testRoot);
  retainVerificationBaselines(next, first, baseline, current, testRoot);
  const contexts = verificationContexts(next, baseline, current, { files: [] });
  const initial = await evaluateVerification(contexts, task);
  assert.ok(initial.checksTemplate, initial.error);
  const sourceText = 'additional source';
  const supplemental = { ...baseline, externalEvidence: [{ path: 'source.py', sourceText, sha256: createHash('sha256').update(sourceText).digest('hex') }] };
  retainVerificationBaselines(last, next, supplemental, current, testRoot);
  const rerun = await evaluateVerification(verificationContexts(last, supplemental, current, { files: [] }), task, initial.checksTemplate);
  assert.ok(rerun.receipt, rerun.error);
  assert.equal(rerun.receipt.projectChecks.status, 'reported-not-independently-verified');
});

test('a prior PR head is accepted only for the same verified PR and pins', t => {
  const directory = workspace(t), previousDir = directory('pr-previous');
  const oldHead = '1'.repeat(40), newHead = '2'.repeat(40), base = '3'.repeat(40);
  const oldPR = { repository: 'owner/repo', number: 42, scope: '.', baseSHA: base, headSHA: oldHead };
  const currentPR = { ...oldPR, headSHA: newHead };
  const previous = capture(1, { sourceKind: 'git-tree', revision: oldHead });
  const current = capture(2, { sourceKind: 'git-tree', revision: newHead });
  fs.writeFileSync(path.join(previousDir, 'findings.json'), JSON.stringify(previous));
  fs.writeFileSync(path.join(previousDir, 'view-context.json'), JSON.stringify({ run: { pullRequest: oldPR } }));
  assert.deepEqual(matchingPreviousPullRequest(previousDir, current, currentPR), previous);
  assert.deepEqual(matchingPreviousPullRequest(previousDir, current, { ...currentPR, repository: 'Owner/Repo' }), previous, 'GitHub repository identity is case-insensitive');
  for (const change of [{ number: 43 }, { repository: 'other/repo' }, { scope: 'src' }, { baseSHA: '4'.repeat(40) }, { headSHA: '5'.repeat(40) }, { local: true }]) {
    assert.equal(matchingPreviousPullRequest(previousDir, current, { ...currentPR, ...change }), null);
  }
});

test('legacy captures without ownership cannot be migrated by command alone', t => {
  const directory = workspace(t), old = directory('old'), adjacent = directory('adjacent'), migrated = directory('migrated'), rejected = directory('rejected');
  const resume = { command: 'archify serve /example/repo --out /example/out', shell: 'POSIX sh' };
  const context = { run: { resume } };
  fs.writeFileSync(path.join(old, 'view-context.json'), JSON.stringify(context));
  fs.writeFileSync(path.join(adjacent, 'view-context.json'), JSON.stringify(context));
  assert.equal(sameVerificationRepository(old, adjacent), false);
  assert.deepEqual(retainVerificationBaselines(migrated, old, capture(1), capture(2), testRoot, resume), []);
  assert.deepEqual(retainVerificationBaselines(rejected, old, capture(1), capture(2), testRoot, { ...resume, command: 'other repo' }), []);
  fs.writeFileSync(path.join(old, 'verification-owner.json'), '{"identity":"invalid"}');
  assert.equal(sameVerificationRepository(old, adjacent), false, 'invalid explicit ownership cannot fall back to legacy metadata');
  const invalid = directory('invalid');
  assert.deepEqual(retainVerificationBaselines(invalid, old, capture(1), capture(2), testRoot, resume), []);
});

test('a legacy resume command cannot establish repository continuity after replacement', t => {
  const directory = workspace(t), repo = directory('repo'), old = directory('legacy'), next = directory('next');
  const resume = { command: `archify serve ${repo} --out ${old}`, shell: 'POSIX sh' };
  fs.writeFileSync(path.join(old, 'view-context.json'), JSON.stringify({ run: { resume } }));
  fs.rmdirSync(repo); fs.mkdirSync(repo);
  assert.deepEqual(retainVerificationBaselines(next, old, capture(1), capture(2), repo, resume), [], 'an unchanged command cannot prove a legacy capture belongs to the replacement checkout');
  const oversized = { ...capture(1), externalEvidence: [{ path: 'large.py', sourceText: 'x'.repeat(5 * 1024 * 1024) }] };
  const large = directory('large');
  assert.deepEqual(retainVerificationBaselines(large, old, oversized, capture(2), repo, resume), [], 'oversized legacy findings cannot bypass the same ownership rule');
});
