import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ArchitectureDeltaError,
  architectureDeltaChangeRows,
  canonicalArchitectureJson,
  compareArchitecture,
  validateArchitectureDeltaHtml,
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

test('change navigator order is exact-ID based, complete, unique, and stable', () => {
  const receipt = compareArchitecture(read(baseFixture), read(headFixture));
  const rows = architectureDeltaChangeRows(receipt);
  assert.deepEqual(rows.map((row) => row.key), [
    'component:fraud',
    'relationship:fraud-check',
    'boundary:region:Production region',
    'boundary:security-group:Checkout trust zone',
    'component:checkout',
    'relationship:authorize-payment',
    'relationship:persist-order',
    'component:queue',
    'component:cache',
    'relationship:session-read',
    'relationship:publish-order',
  ]);
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);
  assert.equal(rows.length, receipt.changes.components.length + receipt.changes.connections.length + receipt.changes.boundaries.length);
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

test('evidence-only component changes keep an enabled exact review contract', () => {
  const base = read(baseFixture);
  const head = read(baseFixture);
  base.components[0].sources = [{ path: 'src/entry.js', line: 1, label: 'baseline' }];
  head.components[0].sources = [{ path: 'src/entry.js', line: 2, label: 'head' }];
  const receipt = compareArchitecture(base, head);
  assert.equal(receipt.changes.components.length, 1);
  assert.equal(receipt.changes.components[0].status, 'evidence-changed');
  assert.deepEqual(receipt.changes.components[0].classifications, ['evidence']);
  const runtime = fs.readFileSync(path.join(skillRoot, 'delta/architecture-delta.mjs'), 'utf8');
  assert.match(runtime, /statuses: \['added', 'changed', 'evidence-changed', 'removed', 'moved'\]/);
});

test('mixed semantic and geometry component changes retain both exact forms', () => {
  const head = read(headFixture);
  head.components.find((component) => component.id === 'queue').sublabel = 'durable queue v2';
  const headPath = path.join(tmp, 'mixed-component-head.json');
  const output = path.join(tmp, 'mixed-component-delta.html');
  fs.writeFileSync(headPath, JSON.stringify(head));

  const result = run(['compare', 'architecture', baseFixture, headPath, output, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  const queue = receipt.changes.components.find((change) => change.id === 'queue');
  assert.equal(queue.status, 'changed');
  assert.deepEqual(queue.classifications, ['geometry', 'semantic']);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /data-change-key="component:queue"[^>]+data-change-target-signature="g:changed:geometry,semantic\|g:moved-from:geometry,semantic"/);
  assert.deepEqual(validateArchitectureDeltaHtml(html, receipt), { ok: true, checksPassed: 10, checkCount: 10 });
});

test('mixed semantic and geometry relationship changes retain both exact routes', () => {
  const head = read(headFixture);
  head.connections.find((connection) => connection.id === 'publish-order').label = 'accepted event';
  const headPath = path.join(tmp, 'mixed-relationship-head.json');
  const output = path.join(tmp, 'mixed-relationship-delta.html');
  fs.writeFileSync(headPath, JSON.stringify(head));

  const result = run(['compare', 'architecture', baseFixture, headPath, output, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  const publishOrder = receipt.changes.connections.find((change) => change.id === 'publish-order');
  assert.equal(publishOrder.status, 'changed');
  assert.deepEqual(publishOrder.classifications, ['geometry', 'semantic']);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /data-change-key="relationship:publish-order"[^>]+data-change-target-signature="g:changed:geometry,semantic\|g:moved-from:geometry,semantic\|path:changed:geometry,semantic\|path:moved-from:geometry,semantic\|text:changed:\|text:moved-from:"/);
  assert.deepEqual(validateArchitectureDeltaHtml(html, receipt), { ok: true, checksPassed: 10, checkCount: 10 });
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
  assert.match(firstHtml, /aria-label="Authored change review"/);
  assert.equal((firstHtml.match(/class="change-row"/g) || []).length, 11);
  assert.match(firstHtml, /data-change-key="component:fraud"/);
  assert.match(firstHtml, /data-change-key="relationship:authorize-payment"/);
  assert.match(firstHtml, /data-change-key="boundary:region:Production region"/);
  assert.match(firstHtml, /data-change-target-signature="[^"]+"/);
  assert.match(firstHtml, /data-delta-boundary-key="region:Production region"/);
  assert.equal((firstHtml.match(/class="snapshot-frame"/g) || []).length, 2);
  assert.match(firstHtml, /title="Before architecture explorer"/);
  assert.match(firstHtml, /title="After architecture explorer"/);
  assert.match(firstHtml, /id="export-svg"[^>]*>Export SVG</);
  assert.match(firstHtml, /id="share-card"[^>]*>Share Card</);
  assert.match(firstHtml, /window\.Archify\.deltaExport = \{ canonicalSvg: canonicalDeltaSvg, shareCard/);
  assert.match(firstHtml, /canvas\.width = 1200;[\s\S]*canvas\.height = 630;/);
  assert.match(firstHtml, /structural-frame.*stroke:var\(--delta\)!important/);
  assert.match(firstHtml, /structural-frame.*data-delta-state="changed".*stroke-dasharray:2 3!important/);
  assert.match(firstHtml, /data-delta-boundary-state="added".*fill:#34d399!important/);
  assert.match(firstHtml, /delta-boundary-marker\[data-delta-state\]\{color:var\(--delta\)\}/);
  assert.match(firstHtml, /No authored architecture changes ·.*movementSummary/);
  assert.match(firstHtml, /font-family:"JetBrains Mono",ui-monospace/);
  assert.doesNotMatch(firstHtml, /font-family:Inter|body\{min-width:1080px/);
  assert.match(firstHtml, /@media\(max-width:760px\)/);
  assert.match(firstHtml, /\.canvas svg\{min-width:720px;max-height:none\}/);
  assert.match(firstHtml, /\.changes\{overflow-x:auto\}/);
  assert.match(firstHtml, /const REVIEW_DWELL_MS = 1400;/);
  assert.match(firstHtml, /prefers-reduced-motion: reduce/);
  assert.match(firstHtml, /:not\(\[data-delta-review-current\]\)/);
  assert.match(firstHtml, /--review-same-opacity:1;--review-change-opacity:1/);
  assert.match(firstHtml, /--d-focus:#006b8f/);
  assert.match(firstHtml, /document\.querySelectorAll\('#archify-compare-receipt'\)\.length !== 1/);
  assert.match(firstHtml, /targetsMatch\(reviewSources\[index\], row, matches\)/);
  assert.match(firstHtml, /document\.addEventListener\('visibilitychange'/);
  assert.match(firstHtml, /window\.addEventListener\('beforeprint', overview\)/);
  assert.match(firstHtml, /aria-current', 'step'/);
  assert.match(firstHtml, /event\.key === 'Enter' \|\| event\.key === ' '/);
  const deltaShell = firstHtml.replace(/<iframe\b[^>]*><\/iframe>/g, '');
  assert.doesNotMatch(deltaShell, /localStorage|sessionStorage|history\.(?:pushState|replaceState)/);
  assert.doesNotMatch(deltaShell, /setInterval\(/);
  assert.doesNotMatch(deltaShell, /\b(?:SAFE|LOW RISK|MERGEABLE|NO IMPACT|VERIFIED PR)\b/i);

  const receipt = JSON.parse(result.stdout);
  const sidecar = read(path.join(tmp, 'first.receipt.json'));
  assert.deepEqual(sidecar, receipt);
  assert.equal(receipt.artifact.sha256, JSON.parse(repeat.stdout).artifact.sha256);
  assert.equal(receipt.validation.checksPassed, receipt.validation.checkCount);
  assert.equal(receipt.completeness, 'complete');
  assert.equal(JSON.stringify(receipt).includes(tmp), false);
  assert.deepEqual(validateArchitectureDeltaHtml(firstHtml, receipt), { ok: true, checksPassed: 10, checkCount: 10 });
});

test('artifact validation fails closed on missing, duplicate, or self-blessed review identity', () => {
  const output = path.join(tmp, 'review-identity.html');
  const result = run(['compare', 'architecture', baseFixture, headFixture, output, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  const html = fs.readFileSync(output, 'utf8');
  const deltaSection = html.match(/<section class="canvas" data-view="delta">([\s\S]*?)<\/section>/)?.[1];
  assert.ok(deltaSection);
  const fraudTag = deltaSection.match(/<g\s+[^>]*\bdata-node-id="fraud"[^>]*>/)?.[0];
  assert.ok(fraudTag);

  const missing = html.replace(fraudTag, fraudTag.replace('data-node-id="fraud"', 'data-node-id="tampered"'));
  assert.throws(
    () => validateArchitectureDeltaHtml(missing, receipt),
    (error) => error instanceof ArchitectureDeltaError
      && error.code === 'delta/artifact-invalid'
      && error.details.failures.includes('ambiguous Delta identity component:fraud'),
  );

  const duplicate = html.replace(fraudTag, `${fraudTag}${fraudTag}`);
  assert.throws(
    () => validateArchitectureDeltaHtml(duplicate, receipt),
    (error) => error instanceof ArchitectureDeltaError
      && error.code === 'delta/artifact-invalid'
      && error.details.failures.includes('ambiguous Delta identity component:fraud'),
  );

  const relationshipGroup = deltaSection.match(/<g\s+[^>]*\bdata-edge-id="fraud-check"[^>]*>[\s\S]*?<\/g>/)?.[0];
  assert.ok(relationshipGroup);
  const duplicateCompanion = html.replace(relationshipGroup, `${relationshipGroup}${relationshipGroup}`);
  assert.throws(
    () => validateArchitectureDeltaHtml(duplicateCompanion, receipt),
    (error) => error instanceof ArchitectureDeltaError
      && error.code === 'delta/artifact-invalid'
      && error.details.failures.includes('ambiguous Delta target signature relationship:fraud-check'),
  );

  const duplicateRowTag = duplicateCompanion.match(/<button class="change-row"[^>]*data-change-key="relationship:fraud-check"[^>]*>/)?.[0];
  const storedSignature = duplicateRowTag?.match(/data-change-target-signature="([^"]+)"/)?.[1];
  assert.ok(duplicateRowTag && storedSignature);
  const selfBlessedSignature = [...storedSignature.split('|'), 'g:added:topology'].sort().join('|');
  const selfBlessed = duplicateCompanion.replace(
    duplicateRowTag,
    duplicateRowTag.replace(`data-change-target-signature="${storedSignature}"`, `data-change-target-signature="${selfBlessedSignature}"`),
  );
  assert.throws(
    () => validateArchitectureDeltaHtml(selfBlessed, receipt),
    (error) => error instanceof ArchitectureDeltaError
      && error.code === 'delta/artifact-invalid'
      && error.details.failures.includes('ambiguous Delta target signature relationship:fraud-check'),
  );

  const missingCompanionState = html.replace(
    relationshipGroup,
    relationshipGroup.replace(/\sdata-delta-state="[^"]+"/, ''),
  );
  assert.throws(
    () => validateArchitectureDeltaHtml(missingCompanionState, receipt),
    (error) => error instanceof ArchitectureDeltaError
      && error.code === 'delta/artifact-invalid'
      && error.details.failures.includes('missing Delta target state relationship:fraud-check'),
  );

  const receiptNode = html.match(/<script id="archify-compare-receipt"[\s\S]*?<\/script>/)?.[0];
  assert.ok(receiptNode);
  const duplicateReceipt = html.replace(receiptNode, `${receiptNode}${receiptNode}`);
  assert.throws(
    () => validateArchitectureDeltaHtml(duplicateReceipt, receipt),
    (error) => error instanceof ArchitectureDeltaError
      && error.code === 'delta/artifact-invalid'
      && error.details.failures.includes('expected exactly one embedded compare receipt'),
  );

  const extraDeltaSvg = html.replace(
    '<section class="canvas" data-view="delta">',
    '<section class="canvas" data-view="delta"><svg viewBox="0 0 1 1"></svg>',
  );
  assert.throws(
    () => validateArchitectureDeltaHtml(extraDeltaSvg, receipt),
    (error) => error instanceof ArchitectureDeltaError
      && error.code === 'delta/artifact-invalid'
      && error.details.failures.includes('expected exactly one root SVG in the Delta canvas'),
  );
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

test('compare validates raw snapshots before canonicalization can discard invalid fields', () => {
  const invalid = read(baseFixture);
  invalid.unknown_top_level_fact = true;
  const invalidPath = path.join(tmp, 'invalid-raw-base.json');
  const output = path.join(tmp, 'invalid-raw-base.html');
  fs.writeFileSync(invalidPath, JSON.stringify(invalid));

  const result = run(['compare', 'architecture', invalidPath, headFixture, output, '--json']);
  assert.notEqual(result.status, 0);
  assert.equal(fs.existsSync(output), false);
  assert.equal(fs.existsSync(path.join(tmp, 'invalid-raw-base.receipt.json')), false);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.diagnostics[0].code, 'schema/additionalProperties');
  assert.equal(receipt.diagnostics[0].subject.side, 'base');
  assert.equal(receipt.diagnostics[0].subject.path, '/');
  assert.equal(receipt.diagnostics[0].evidence.additionalProperty, 'unknown_top_level_fact');
});

test('compare commit preflights both targets before replacing a trusted pair', () => {
  const caseRoot = fs.mkdtempSync(path.join(tmp, 'pair-target-'));
  const output = path.join(caseRoot, 'review.html');
  const receiptPath = path.join(caseRoot, 'review.receipt.json');
  fs.writeFileSync(output, 'trusted html');
  fs.mkdirSync(receiptPath);

  const result = run([
    'compare', 'architecture', baseFixture, headFixture, output,
    '--receipt', receiptPath, '--json',
  ]);

  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted html');
  assert.equal(fs.statSync(receiptPath).isDirectory(), true);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.stage, 'commit');
  assert.equal(failure.diagnostics[0].code, 'delta/commit-target');
  assert.equal(failure.diagnostics[0].evidence.targetType, 'directory');
});
