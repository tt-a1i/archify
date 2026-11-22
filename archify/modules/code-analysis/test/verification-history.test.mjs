import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { retainVerificationBaselines, verificationContexts } from '../lib/verification-history.mjs';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/tasks/findings.json', import.meta.url), 'utf8'));
const snapshotId = (number) => number.toString(16).padStart(64, '0');
const capture = (number, repository = {}) => ({
  ...fixture,
  repository: { ...fixture.repository, root: '.', sourceKind: 'working-tree', snapshotId: snapshotId(number), ...repository },
});

function workspace(t) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-verification-history-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  return (name) => fs.mkdirSync(path.join(scratch, String(name)), { recursive: true });
}

const historyFile = (dir) => path.join(dir, 'verification-history.json');
const savedIds = (dir) => JSON.parse(fs.readFileSync(historyFile(dir), 'utf8')).map(({ repository }) => repository.snapshotId);
const beforeIds = (contexts) => contexts.map(({ before }) => before.snapshotId);

test('verification history keeps the six newest distinct captures across staged runs', t => {
  const directory = workspace(t);
  let published = directory('first');
  const scans = [1, 2, 3, 4, 5, 6, 7, 8, 8, 8];
  for (const [index, number] of scans.entries()) {
    const next = directory(index);
    retainVerificationBaselines(next, published, capture(number), capture(scans[index + 1] ?? number));
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
  const evidence = (number, length) => {
    const sourceText = '界'.repeat(length);
    return {
      ...capture(number),
      externalEvidence: [{ path: 'supplemental.py', sourceText, sha256: createHash('sha256').update(sourceText).digest('hex') }],
    };
  };

  retainVerificationBaselines(initial, initial, capture(1), current);
  retainVerificationBaselines(published, initial, evidence(2, 800_000), current);
  retainVerificationBaselines(next, published, evidence(3, 800_000), current);

  assert.ok(fs.statSync(historyFile(next)).size <= 4 * 1024 * 1024);
  assert.deepEqual(savedIds(next), [3, 1].map(snapshotId));

  const oversized = directory('oversized');
  retainVerificationBaselines(oversized, next, evidence(5, 1_400_000), current);
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

  assert.deepEqual(beforeIds(verificationContexts(previous, adjacent, current, { files: [] })), [snapshotId(1)]);
  fs.writeFileSync(historyFile(previous), JSON.stringify([wrongRoot, wrongKind, adjacent]));

  retainVerificationBaselines(next, previous, wrongRoot, current);
  assert.deepEqual(savedIds(next), [snapshotId(1)]);
  assert.deepEqual(beforeIds(verificationContexts(previous, wrongKind, current, { files: [] })), [snapshotId(1)]);
});
