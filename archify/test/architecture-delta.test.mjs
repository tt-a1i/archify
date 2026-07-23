import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ArchitectureDeltaError,
  canonicalArchitectureJson,
  compareArchitecture,
} from '../delta/architecture-delta.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const baseFixture = path.join(skillRoot, 'examples/checkout-platform.base.architecture.json');
const headFixture = path.join(skillRoot, 'examples/checkout-platform.head.architecture.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-delta-'));

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: skillRoot, encoding: 'utf8' });

test('architecture compare classifies authored facts separately from geometry and presentation', () => {
  const receipt = compareArchitecture(read(baseFixture), read(headFixture));
  assert.equal(receipt.command, 'compare');
  assert.equal(receipt.completeness, 'complete');
  assert.equal(receipt.proofLevel, 'authored');
  assert.deepEqual(receipt.summary.components, {
    added: 1,
    changed: 1,
    evidenceChanged: 0,
    removed: 1,
    moved: 1,
  });
  assert.deepEqual(receipt.summary.connections, {
    added: 1,
    changed: 2,
    removed: 1,
    rerouted: 1,
  });
  assert.equal(receipt.summary.presentationChanged, true);

  const checkout = receipt.changes.components.find((change) => change.id === 'checkout');
  assert.equal(checkout.status, 'changed');
  assert.deepEqual(checkout.classifications, ['semantic']);
  assert.deepEqual(checkout.changedFields, ['/sublabel']);

  const queue = receipt.changes.components.find((change) => change.id === 'queue');
  assert.equal(queue.status, 'moved');
  assert.deepEqual(queue.classifications, ['geometry']);
  assert.deepEqual(queue.changedFields, ['/pos']);

  const authorization = receipt.changes.connections.find((change) => change.id === 'authorize-payment');
  assert.equal(authorization.status, 'changed');
  assert.deepEqual(authorization.classifications, ['geometry', 'topology']);
  assert.deepEqual(authorization.changedFields, ['/from', '/fromSide', '/toSide', '/via']);

  assert.deepEqual(receipt.changes.connections.find((change) => change.status === 'added').classifications, ['topology']);

  const headWithBoundary = read(headFixture);
  headWithBoundary.boundaries.push({ kind: 'region', label: 'Fraud edge', wraps: ['fraud'] });
  const boundaryReceipt = compareArchitecture(read(baseFixture), headWithBoundary);
  assert.deepEqual(boundaryReceipt.changes.boundaries.find((change) => change.label === 'Fraud edge').classifications, ['scope']);
});

test('canonical architecture ignores formatting, entity order, and set-like order', () => {
  const original = read(baseFixture);
  const reordered = JSON.parse(JSON.stringify(original));
  reordered.components.reverse();
  reordered.connections.reverse();
  reordered.boundaries.reverse();
  reordered.boundaries.forEach((boundary) => boundary.wraps.reverse());
  assert.equal(canonicalArchitectureJson(reordered), canonicalArchitectureJson(original));
});

test('exact identity fails closed instead of guessing relationships or unrelated systems', () => {
  const base = read(baseFixture);
  const missingRelationship = read(headFixture);
  delete missingRelationship.connections[0].id;
  assert.throws(
    () => compareArchitecture(base, missingRelationship),
    (error) => error instanceof ArchitectureDeltaError
      && error.code === 'delta/relationship-id-required'
      && error.details.paths.includes('/connections/0/id'),
  );

  const unrelated = read(headFixture);
  unrelated.components = unrelated.components.map((component, index) => ({ ...component, id: `other${index}` }));
  unrelated.connections = [];
  unrelated.boundaries = [];
  assert.throws(
    () => compareArchitecture(base, unrelated),
    (error) => error instanceof ArchitectureDeltaError && error.code === 'delta/no-shared-component-id',
  );
});

test('same-label node id changes remain one removal plus one addition', () => {
  const base = read(baseFixture);
  const head = read(baseFixture);
  const cache = head.components.find((component) => component.id === 'cache');
  cache.id = 'session-store';
  head.boundaries.forEach((boundary) => {
    boundary.wraps = boundary.wraps.map((id) => (id === 'cache' ? 'session-store' : id));
  });
  head.connections.find((connection) => connection.id === 'session-read').to = 'session-store';

  const receipt = compareArchitecture(base, head);
  assert.equal(receipt.changes.components.find((change) => change.id === 'cache').status, 'removed');
  assert.equal(receipt.changes.components.find((change) => change.id === 'session-store').status, 'added');
  assert.equal(receipt.changes.components.filter((change) => change.headLabel === 'Session Cache' || change.baseLabel === 'Session Cache').length, 2);
});

test('repository mismatch fails and verified matching revisions remain evidence-bounded', () => {
  const base = read(baseFixture);
  const head = read(headFixture);
  base.meta.repository = { url: 'https://github.com/example/one', revision: 'a'.repeat(40) };
  head.meta.repository = { url: 'https://github.com/example/two', revision: 'b'.repeat(40) };
  assert.throws(
    () => compareArchitecture(base, head),
    (error) => error instanceof ArchitectureDeltaError && error.code === 'delta/repository-mismatch',
  );

  head.meta.repository.url = 'https://github.com/EXAMPLE/ONE.git/';
  const receipt = compareArchitecture(base, head, { baseVerified: true, headVerified: true });
  assert.equal(receipt.proofLevel, 'revision-pinned');
  assert.equal(receipt.summary.provenanceChanged, true);
});

test('compare CLI writes a deterministic three-state artifact and complete sidecar receipt', () => {
  const first = path.join(tmp, 'first.html');
  const second = path.join(tmp, 'second.html');
  const result = run(['compare', 'architecture', baseFixture, headFixture, first, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const repeat = run(['compare', 'architecture', baseFixture, headFixture, second, '--json']);
  assert.equal(repeat.status, 0, repeat.stderr);

  const firstHtml = fs.readFileSync(first, 'utf8');
  const secondHtml = fs.readFileSync(second, 'utf8');
  assert.equal(firstHtml, secondHtml);
  assert.equal((firstHtml.match(/<section class="canvas" data-view=/g) || []).length, 3);
  assert.match(firstHtml, /data-view="delta">/);
  assert.match(firstHtml, /data-node-id="cache"[^>]+data-delta-state="removed"/);
  assert.match(firstHtml, /data-node-id="fraud"[^>]+data-delta-state="added"/);
  assert.match(firstHtml, /data-node-id="queue"[^>]+data-delta-state="moved-from"/);
  assert.doesNotMatch(firstHtml, /\b(?:SAFE|LOW RISK|MERGEABLE|NO IMPACT|VERIFIED PR)\b/i);

  const receipt = JSON.parse(result.stdout);
  const sidecar = read(path.join(tmp, 'first.receipt.json'));
  assert.deepEqual(sidecar, receipt);
  assert.equal(receipt.artifact.sha256, JSON.parse(repeat.stdout).artifact.sha256);
  assert.equal(receipt.validation.checksPassed, receipt.validation.checkCount);
  assert.equal(receipt.completeness, 'complete');
  assert.equal(JSON.stringify(receipt).includes(tmp), false);
});

test('formatting-only input changes raw proof but not semantic hash or artifact bytes', () => {
  const reorderedPath = path.join(tmp, 'reordered-base.json');
  const reordered = read(baseFixture);
  reordered.components.reverse();
  reordered.connections.reverse();
  reordered.boundaries.forEach((boundary) => boundary.wraps.reverse());
  fs.writeFileSync(reorderedPath, JSON.stringify(reordered, null, 4));

  const originalOut = path.join(tmp, 'canonical-original.html');
  const reorderedOut = path.join(tmp, 'canonical-reordered.html');
  const original = run(['compare', 'architecture', baseFixture, headFixture, originalOut, '--json']);
  const changed = run(['compare', 'architecture', reorderedPath, headFixture, reorderedOut, '--json']);
  assert.equal(original.status, 0, original.stderr);
  assert.equal(changed.status, 0, changed.stderr);
  const originalReceipt = JSON.parse(original.stdout);
  const changedReceipt = JSON.parse(changed.stdout);
  assert.notEqual(originalReceipt.base.rawSha256, changedReceipt.base.rawSha256);
  assert.equal(originalReceipt.base.semanticSha256, changedReceipt.base.semanticSha256);
  assert.equal(fs.readFileSync(originalOut, 'utf8'), fs.readFileSync(reorderedOut, 'utf8'));
  assert.equal(originalReceipt.artifact.sha256, changedReceipt.artifact.sha256);
});

test('compare failure preserves an existing trusted artifact', () => {
  const invalid = read(headFixture);
  delete invalid.connections[0].id;
  const invalidPath = path.join(tmp, 'invalid-head.json');
  const output = path.join(tmp, 'preserved.html');
  fs.writeFileSync(invalidPath, JSON.stringify(invalid));
  fs.writeFileSync(output, 'trusted artifact');

  const result = run(['compare', 'architecture', baseFixture, invalidPath, output, '--json']);
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted artifact');
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.diagnostics[0].code, 'delta/relationship-id-required');
  assert.equal(fs.existsSync(path.join(tmp, 'preserved.receipt.json')), false);
});
