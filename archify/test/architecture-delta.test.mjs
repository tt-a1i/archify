import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import {
  ArchitectureDeltaError,
  architectureDeltaChangeRows,
  canonicalArchitectureJson,
  compareArchitecture,
  renderArchitectureDeltaHtml,
  validateArchitectureDeltaHtml,
} from '../delta/architecture-delta.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const baseFixture = path.join(skillRoot, 'examples/checkout-platform.base.architecture.json');
const headFixture = path.join(skillRoot, 'examples/checkout-platform.head.architecture.json');
const checkedArtifact = path.resolve(skillRoot, '../examples/checkout-platform-delta.html');
const checkedReceipt = path.resolve(skillRoot, '../examples/checkout-platform-delta.receipt.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-delta-'));

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: skillRoot, encoding: 'utf8' });

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
    },
  }).trim();
}

function provenanceFixture() {
  const root = fs.mkdtempSync(path.join(tmp, 'provenance-repo-'));
  const sourceDirectory = path.join(root, 'src');
  fs.mkdirSync(sourceDirectory);
  git(root, 'init');
  git(root, 'config', 'user.name', 'Archify Tests');
  git(root, 'config', 'user.email', 'archify@example.test');
  git(root, 'remote', 'add', 'origin', 'git@github.com:example/provenance-repo.git');
  fs.writeFileSync(path.join(sourceDirectory, 'service.js'), 'export const version = 1;\n');
  git(root, 'add', 'src/service.js');
  git(root, 'commit', '-m', 'base');
  const baseRevision = git(root, 'rev-parse', 'HEAD');
  fs.writeFileSync(path.join(sourceDirectory, 'service.js'), 'export const version = 2;\n');
  git(root, 'add', 'src/service.js');
  git(root, 'commit', '-m', 'head');
  const headRevision = git(root, 'rev-parse', 'HEAD');
  const diagram = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Provenance-only delta', output: 'provenance-only-delta.html' },
    components: [{
      id: 'service',
      type: 'backend',
      label: 'Service',
      pos: [100, 100],
      size: [160, 80],
      sources: [{ path: 'src/service.js', line: 1 }],
    }],
    boundaries: [],
    connections: [],
    cards: [],
  };
  const base = structuredClone(diagram);
  base.meta.repository = { url: 'https://github.com/example/provenance-repo', revision: baseRevision };
  const head = structuredClone(diagram);
  head.meta.repository = { url: 'https://github.com/example/provenance-repo', revision: headRevision };
  const basePath = path.join(root, 'base.architecture.json');
  const headPath = path.join(root, 'head.architecture.json');
  fs.writeFileSync(basePath, JSON.stringify(base));
  fs.writeFileSync(headPath, JSON.stringify(head));
  return { root, basePath, headPath, baseRevision, headRevision };
}

const renderDelta = (receipt) => renderArchitectureDeltaHtml({
  receipt,
  baseSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  deltaSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  headSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  baseHtml: '<!doctype html><title>Before</title>',
  headHtml: '<!doctype html><title>After</title>',
  artifactCss: '',
});

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

test('legend-only changes are presentation changes and never topology changes', () => {
  const base = read(baseFixture);
  const head = read(baseFixture);
  head.meta.legend = {
    entries: {
      security: { label: 'Trust boundary', visible: true },
      database: { visible: false },
    },
  };

  const receipt = compareArchitecture(base, head);
  assert.equal(receipt.summary.presentationChanged, true);
  assert.deepEqual(receipt.summary.components, {
    added: 0,
    changed: 0,
    evidenceChanged: 0,
    removed: 0,
    moved: 0,
  });
  assert.deepEqual(receipt.summary.connections, {
    added: 0,
    changed: 0,
    removed: 0,
    rerouted: 0,
  });
  assert.deepEqual(receipt.changes, { components: [], connections: [], boundaries: [] });
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

test('compare reports brand-only changes in the receipt and exact review target', () => {
  const base = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Cache', output: 'cache.html' },
    components: [{ id: 'cache', type: 'database', label: 'Cache', pos: [100, 100], size: [160, 80] }],
  };
  const basePath = path.join(tmp, 'brand-base.json');
  const headPath = path.join(tmp, 'brand-head.json');
  const output = path.join(tmp, 'brand-delta.html');
  for (const [before, after] of [[undefined, 'redis'], ['redis', 'postgresql'], ['redis', undefined]]) {
    const head = structuredClone(base);
    base.components[0].brand = before;
    head.components[0].brand = after;
    fs.writeFileSync(basePath, JSON.stringify(base));
    fs.writeFileSync(headPath, JSON.stringify(head));

    const result = run(['compare', 'architecture', basePath, headPath, output, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.summary.components.changed, 1);
    assert.deepEqual(receipt.changes.components[0].classifications, ['semantic']);
    assert.deepEqual(receipt.changes.components[0].changedFields, ['/brand']);
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /data-change-key="component:cache"/);
    assert.deepEqual(validateArchitectureDeltaHtml(html, receipt), { ok: true, checksPassed: 10, checkCount: 10 });
  }
});

test('compare reports icon-only changes in the receipt and exact review target', () => {
  const base = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Cache', output: 'cache.html' },
    components: [{ id: 'cache', type: 'database', label: 'Cache', pos: [100, 100], size: [160, 80] }],
  };
  const basePath = path.join(tmp, 'icon-base.json');
  const headPath = path.join(tmp, 'icon-head.json');
  const output = path.join(tmp, 'icon-delta.html');
  for (const [before, after] of [[undefined, 'clock'], ['clock', 'moon'], ['moon', 'none'], ['none', undefined]]) {
    const head = structuredClone(base);
    base.components[0].icon = before;
    head.components[0].icon = after;
    fs.writeFileSync(basePath, JSON.stringify(base));
    fs.writeFileSync(headPath, JSON.stringify(head));

    const result = run(['compare', 'architecture', basePath, headPath, output, '--json']);
    assert.equal(result.status, 0, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.summary.components.changed, 1);
    assert.deepEqual(receipt.changes.components[0].classifications, ['semantic']);
    assert.deepEqual(receipt.changes.components[0].changedFields, ['/icon']);
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /data-change-key="component:cache"/);
    assert.deepEqual(validateArchitectureDeltaHtml(html, receipt), { ok: true, checksPassed: 10, checkCount: 10 });
  }
});

test('compare reports locale-only changes as presentation changes', () => {
  const head = read(baseFixture);
  head.meta.locale = 'zh-CN';
  const headPath = path.join(tmp, 'locale-head.json');
  const output = path.join(tmp, 'locale-delta.html');
  fs.writeFileSync(headPath, JSON.stringify(head));

  const result = run(['compare', 'architecture', baseFixture, headPath, output, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.summary.presentationChanged, true);
  assert.deepEqual(receipt.changes, { components: [], connections: [], boundaries: [] });
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

test('baseline boundary title masks stay below current components and carry delta identity', () => {
  const documentAt = (pos, pad) => ({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Boundary mask z-order',
      output: 'boundary-mask-z-order.html',
      quality_profile: 'standard',
      viewBox: [600, 400],
    },
    components: [{ id: 'node', type: 'backend', label: 'Current node', pos, size: [120, 60] }],
    connections: [],
    boundaries: [{ kind: 'region', label: 'Boundary label', wraps: ['node'], pad }],
  });
  const basePath = path.join(tmp, 'boundary-mask.base.json');
  const headPath = path.join(tmp, 'boundary-mask.head.json');
  const output = path.join(tmp, 'boundary-mask.delta.html');
  fs.writeFileSync(basePath, JSON.stringify(documentAt([250, 200], 30)));
  fs.writeFileSync(headPath, JSON.stringify(documentAt([224, 180], 40)));

  const result = run(['compare', 'architecture', basePath, headPath, output, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const delta = html.match(/<section class="canvas" data-view="delta">([\s\S]*?)<\/section>/)?.[1] || '';
  const currentComponents = delta.indexOf('<!-- Components -->');
  const currentNode = delta.indexOf('data-node-id="node"', currentComponents);
  const phantomMask = delta.match(
    /<rect data-graph-role="structural-frame-label-mask"[^>]*data-delta-state="moved-from"[^>]*data-delta-boundary-state="moved-from"[^>]*data-delta-boundary-mask-key="region:Boundary label"[^>]*\/>/,
  )?.[0];
  const currentNodeRect = delta.slice(currentNode).match(/<rect\b[^>]*\/>/)?.[0];
  assert.ok(phantomMask && currentNodeRect, 'expected the phantom mask and current component rect');
  const rect = (tag) => Object.fromEntries(
    [...tag.matchAll(/\b(x|y|width|height)="([^"]+)"/g)].map((match) => [match[1], Number(match[2])]),
  );
  const maskBox = rect(phantomMask);
  const nodeBox = rect(currentNodeRect);
  const overlaps = maskBox.x < nodeBox.x + nodeBox.width
    && maskBox.x + maskBox.width > nodeBox.x
    && maskBox.y < nodeBox.y + nodeBox.height
    && maskBox.y + maskBox.height > nodeBox.y;
  assert.equal(overlaps, true, `expected overlap: ${JSON.stringify({ maskBox, nodeBox })}`);
  assert.ok(delta.indexOf(phantomMask) < currentNode, 'phantom mask must paint below the current component');
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

test('provenance-only changes stay separate from graph changes and remain visible', () => {
  const base = read(baseFixture);
  const head = read(baseFixture);
  base.meta.repository = {
    url: 'https://github.com/example/one',
    revision: 'a'.repeat(40),
    link_mode: 'web',
  };
  head.meta.repository = {
    url: 'https://github.com/example/one',
    revision: 'b'.repeat(40),
    provider: 'github',
    link_mode: 'local-only',
  };

  const receipt = compareArchitecture(base, head, { baseVerified: true, headVerified: true });
  assert.equal(receipt.summary.provenanceChanged, true);
  assert.deepEqual(receipt.provenance, {
    changedFields: ['/link_mode', '/provider', '/revision'],
    base: { revision: 'a'.repeat(40), linkMode: 'web' },
    head: { revision: 'b'.repeat(40), provider: 'github', linkMode: 'local-only' },
  });
  assert.deepEqual(receipt.changes, { components: [], connections: [], boundaries: [] });
  assert.deepEqual(architectureDeltaChangeRows(receipt), []);

  const html = renderDelta(receipt);
  assert.match(html, /data-provenance-changed="true"/);
  assert.match(html, /Repository provenance changed/);
  assert.match(html, /\/revision: aaaaaaaa → bbbbbbbb/);
  assert.match(html, /\/provider: automatic → github/);
  assert.match(html, /\/link_mode: web → local-only/);
  assert.match(html, /\/link_mode, \/provider, \/revision/);
  assert.match(html, /No component, relationship, or boundary changes; repository provenance changed\./);
  assert.doesNotMatch(html, /No authored architecture changes\./);
  assert.match(html, /Overview · 0 authored graph changes · provenance changed/);
  assert.match(html, /No graph changes · ' \+ provenanceSummary/);
  assert.match(html, /const proofWidth = ctx\.measureText\(proofLine\)\.width/);
  assert.match(html, /fitCanvasLine\(secondary, secondaryWidth\)/);
  assert.doesNotMatch(html, /data-change-key="provenance/);
  assert.deepEqual(validateArchitectureDeltaHtml(html, receipt), { ok: true, checksPassed: 10, checkCount: 10 });

  const missingNotice = html.replace(/<aside class="provenance-change"[\s\S]*?<\/aside>/, '');
  assert.throws(
    () => validateArchitectureDeltaHtml(missingNotice, receipt),
    (error) => error instanceof ArchitectureDeltaError
      && error.code === 'delta/artifact-invalid'
      && error.details.failures.includes('provenance change notice does not match the receipt'),
  );
  const tamperedNotice = html.replace('/link_mode: web → local-only', '/link_mode: web → web');
  assert.throws(
    () => validateArchitectureDeltaHtml(tamperedNotice, receipt),
    (error) => error instanceof ArchitectureDeltaError
      && error.code === 'delta/artifact-invalid'
      && error.details.failures.includes('provenance change notice does not match the receipt'),
  );
});

test('legacy schema-v1 provenance receipts render a generic notice without inventing details', () => {
  const base = read(baseFixture);
  const head = read(baseFixture);
  base.meta.repository = { url: 'https://github.com/example/one', revision: 'a'.repeat(40) };
  head.meta.repository = { url: 'https://github.com/example/one', revision: 'b'.repeat(40) };
  const receipt = compareArchitecture(base, head);
  delete receipt.provenance;
  const html = renderDelta(receipt);
  assert.match(html, /Repository provenance changed/);
  assert.match(html, /data-provenance-fields="repository metadata"/);
  assert.match(html, /Repository metadata changed; field details are unavailable in this receipt\./);
  assert.doesNotMatch(html, /data-change-key="provenance/);
  assert.deepEqual(validateArchitectureDeltaHtml(html, receipt), { ok: true, checksPassed: 10, checkCount: 10 });
  assert.throws(() => validateArchitectureDeltaHtml(html.replace(/<aside class="provenance-change"[\s\S]*?<\/aside>/, ''), receipt), ArchitectureDeltaError);
});

test('repository location representation changes stay redacted in provenance output', () => {
  const base = read(baseFixture);
  const head = read(baseFixture);
  base.meta.repository = {
    url: 'https://github.com/example/one',
    revision: 'a'.repeat(40),
  };
  head.meta.repository = {
    url: 'git@github.com:example/one.git',
    revision: 'a'.repeat(40),
  };
  const receipt = compareArchitecture(base, head, { baseVerified: true, headVerified: true });
  assert.equal(receipt.summary.provenanceChanged, true);
  assert.deepEqual(receipt.provenance.changedFields, ['/url']);
  assert.equal(JSON.stringify(receipt.provenance).includes('github.com'), false);

  const html = renderDelta(receipt);
  assert.match(html, /\/url: repository location changed/);
  assert.deepEqual(validateArchitectureDeltaHtml(html, receipt), { ok: true, checksPassed: 10, checkCount: 10 });
});

test('public compare keeps a revision-only provenance change out of graph identities', () => {
  const data = provenanceFixture();
  const output = path.join(data.root, 'delta.html');
  const result = run([
    'compare', 'architecture', data.basePath, data.headPath, output,
    '--repo-root', data.root, '--json',
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.summary.provenanceChanged, true);
  assert.deepEqual(receipt.provenance.changedFields, ['/revision']);
  assert.deepEqual(receipt.changes, { components: [], connections: [], boundaries: [] });
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, new RegExp(`${data.baseRevision.slice(0, 8)} → ${data.headRevision.slice(0, 8)}`));
  assert.match(html, /id="review-play"[^>]* disabled/);
  const deltaSvg = html.match(/<section class="canvas" data-view="delta">([\s\S]*?)<\/section>/)?.[1] || '';
  assert.doesNotMatch(deltaSvg, /data-delta-state="(?:added|removed|changed|moved|moved-from|rerouted|geometry-changed|evidence-changed)"/);
  assert.deepEqual(validateArchitectureDeltaHtml(html, receipt), { ok: true, checksPassed: 10, checkCount: 10 });
});

test('unchanged provenance preserves the ordinary empty graph state', () => {
  const base = read(baseFixture);
  base.meta.repository = {
    url: 'https://github.com/example/one',
    revision: 'a'.repeat(40),
    provider: 'github',
    link_mode: 'web',
  };
  const receipt = compareArchitecture(base, structuredClone(base), { baseVerified: true, headVerified: true });
  assert.equal(receipt.summary.provenanceChanged, false);
  assert.equal(receipt.provenance, undefined);

  const html = renderDelta(receipt);
  assert.doesNotMatch(html, /data-provenance-changed="true"/);
  assert.doesNotMatch(html, /provenance unchanged/);
  assert.match(html, /No authored architecture changes\./);
  assert.match(html, /Overview · 0 authored changes/);
  assert.deepEqual(validateArchitectureDeltaHtml(html, receipt), { ok: true, checksPassed: 10, checkCount: 10 });
});

test('portable compare retains link settings and uses the same repository identity rules', () => {
  const base = read(baseFixture);
  const head = read(headFixture);
  base.meta.repository = { url: 'https://git.internal/Team/Services/repo.git', revision: 'a'.repeat(40), link_mode: 'local-only' };
  head.meta.repository = { url: 'https://git.internal:443/Team/Services/repo.git', revision: 'b'.repeat(40), link_mode: 'local-only' };
  const canonical = JSON.parse(canonicalArchitectureJson(base));
  assert.equal(canonical.meta.repository.link_mode, 'local-only');
  assert.equal(canonical.meta.repository.url, 'https://git.internal/Team/Services/repo.git');
  assert.equal(compareArchitecture(base, head, { baseVerified: true, headVerified: true }).proofLevel, 'revision-pinned');
  head.meta.repository.url = 'https://git.internal/team/Services/repo.git';
  assert.throws(() => compareArchitecture(base, head), (error) => error.code === 'delta/repository-mismatch');
  base.meta.repository = { url: 'https://gitee.com/Team/repo', revision: 'a'.repeat(40), provider: 'gitee' };
  assert.equal(JSON.parse(canonicalArchitectureJson(base)).meta.repository.provider, 'gitee');
});

test('portable compare preserves literal SCP paths and rejects different Git locations', () => {
  const base = read(baseFixture);
  const head = read(headFixture);
  for (const [url, other] of [
    ['git@git.internal:Team/repo', 'ssh://git@git.internal/Team/repo'],
    ['git@git.internal:Team/repo%41', 'git@git.internal:Team/repoA'],
    ['git@git.internal:Team/repo.git.git', 'git@git.internal:Team/repo.git'],
  ]) {
    base.meta.repository = { url, revision: 'a'.repeat(40), link_mode: 'local-only' };
    head.meta.repository = { url: other, revision: 'b'.repeat(40), link_mode: 'local-only' };
    const canonical = canonicalArchitectureJson(base);
    assert.equal(JSON.parse(canonical).meta.repository.url, url);
    assert.equal(canonicalArchitectureJson(JSON.parse(canonical)), canonical);
    assert.throws(() => compareArchitecture(base, head), (error) => error.code === 'delta/repository-mismatch');
    head.meta.repository.url = url;
    assert.equal(compareArchitecture(base, head, { baseVerified: true, headVerified: true }).proofLevel, 'revision-pinned');
  }
});

test('compare CLI writes a deterministic three-state artifact and complete sidecar receipt', () => {
  const first = path.join(tmp, 'first.html');
  const second = path.join(tmp, 'second.html');
  const result = run(['compare', 'architecture', baseFixture, headFixture, first, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const repeat = run(['compare', 'architecture', baseFixture, headFixture, second, '--json']);
  assert.equal(repeat.status, 0, repeat.stderr);
  const replacement = run(['compare', 'architecture', baseFixture, headFixture, first, '--json']);
  assert.equal(replacement.status, 0, replacement.stderr);
  assert.equal(
    fs.readdirSync(tmp).some((entry) => entry.startsWith('.archify-compare-')),
    false,
    'successful replacement must remove only its identity-bound staging entries',
  );

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
  assert.doesNotMatch(firstHtml, /provenance unchanged/);
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

test('compare cleanup preserves an unexpected claimant in private staging', () => {
  const caseRoot = fs.mkdtempSync(path.join(tmp, 'compare-staging-claimant-'));
  const output = path.join(caseRoot, 'delta.html');
  const wrapper = path.join(caseRoot, 'claim-compare-staging.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const rmdirSync = fs.rmdirSync.bind(fs);
let claimed = false;
fs.rmdirSync = (directory, ...args) => {
  if (!claimed && path.basename(String(directory)).startsWith('.archify-compare-')) {
    claimed = true;
    fs.writeFileSync(path.join(directory, 'unknown-claimant.txt'), 'preserve compare claimant');
  }
  return rmdirSync(directory, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'compare', 'architecture', ${JSON.stringify(baseFixture)}, ${JSON.stringify(headFixture)}, ${JSON.stringify(output)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const compared = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(compared.status, 0, compared.stderr || compared.stdout);
  assert.match(compared.stderr, /Warning: could not remove compare staging directory/);
  const claimant = fs.readdirSync(caseRoot, { recursive: true })
    .map((entry) => path.join(caseRoot, entry))
    .find((entry) => path.basename(entry) === 'unknown-claimant.txt');
  assert.ok(claimant);
  assert.equal(fs.readFileSync(claimant, 'utf8'), 'preserve compare claimant');
});

test('compare default receipts preserve distinct HTML extension spellings only when the filesystem does', () => {
  const caseRoot = fs.mkdtempSync(path.join(tmp, 'compare-receipt-extension-case-'));
  const lower = path.join(caseRoot, 'delta.html');
  const upper = path.join(caseRoot, 'delta.HTML');
  const lowerResult = run(['compare', 'architecture', baseFixture, headFixture, lower, '--json']);
  assert.equal(lowerResult.status, 0, lowerResult.stderr);
  const aliases = fs.existsSync(upper);
  const upperResult = run(['compare', 'architecture', baseFixture, headFixture, upper, '--json']);
  assert.equal(upperResult.status, 0, upperResult.stderr);

  const receipts = fs.readdirSync(caseRoot).filter((name) => name.endsWith('.receipt.json'));
  if (aliases) {
    assert.deepEqual(receipts, ['delta.receipt.json']);
  } else {
    assert.equal(receipts.length, 2);
    assert.ok(receipts.includes('delta.receipt.json'));
    assert.match(
      receipts.find((name) => name !== 'delta.receipt.json'),
      /^delta\.HTML\.~archify-[0-9a-f]{64}\.receipt\.json$/u,
    );
  }
});

test('compare prepares a missing nested parent before deriving its default receipt', () => {
  const caseRoot = fs.mkdtempSync(path.join(tmp, 'compare-receipt-nested-parent-'));
  const output = path.join(caseRoot, 'nested', 'delta.html');
  const result = run(['compare', 'architecture', baseFixture, headFixture, output, '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(fs.existsSync(output), true);
  assert.equal(fs.existsSync(path.join(path.dirname(output), 'delta.receipt.json')), true);
});

test('compare validates an explicit receipt directory before preparing a missing output parent', () => {
  const caseRoot = fs.mkdtempSync(path.join(tmp, 'compare-explicit-receipt-parent-'));
  const outputDirectory = path.join(caseRoot, 'artifact');
  const receiptDirectory = path.join(caseRoot, 'receipt');
  const output = path.join(outputDirectory, 'delta.html');
  const receiptPath = path.join(receiptDirectory, 'delta.json');
  const result = run([
    'compare', 'architecture', baseFixture, headFixture, output,
    '--receipt', receiptPath, '--json',
  ]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'delta/receipt-directory');
  assert.equal(fs.existsSync(outputDirectory), false);
  assert.equal(fs.existsSync(receiptDirectory), false);
});

test('compare rejects an indeterminate default receipt namespace before creating outputs', () => {
  const caseRoot = fs.mkdtempSync(path.join(tmp, 'compare-receipt-unknown-'));
  const outputDirectory = path.join(caseRoot, 'nested');
  const output = path.join(outputDirectory, `${'A'.repeat(225)}.html`);
  const wrapper = path.join(caseRoot, 'deny-sidecar-probe.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const openSync = fs.openSync;
fs.openSync = (file, ...args) => {
  if (path.basename(String(file)).startsWith('.archify-path-semantics-')) {
    const error = new Error('synthetic sidecar probe denial');
    error.code = 'EACCES';
    throw error;
  }
  return openSync(file, ...args);
};
syncBuiltinESMExports();
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'compare', 'architecture', ${JSON.stringify(baseFixture)}, ${JSON.stringify(headFixture)}, ${JSON.stringify(output)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const rejected = spawnSync(process.execPath, [wrapper], { cwd: caseRoot, encoding: 'utf8' });
  assert.notEqual(rejected.status, 0, rejected.stderr || rejected.stdout);
  const receipt = JSON.parse(rejected.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delta/receipt-namespace-indeterminate');
  assert.equal(
    receipt.diagnostics[0].evidence.pathIdentity.code,
    'sidecar-case-semantics-indeterminate',
  );
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(fs.readdirSync(outputDirectory), []);
});

test('checked-in Checkout compare artifact is reproducible from its authoritative inputs', () => {
  const artifact = path.join(tmp, 'checked-artifact.html');
  const receipt = path.join(tmp, 'checked-artifact.receipt.json');
  const result = run([
    'compare',
    'architecture',
    baseFixture,
    headFixture,
    artifact,
    '--receipt',
    receipt,
    '--quality',
    'showcase',
    '--json',
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(artifact, 'utf8'), fs.readFileSync(checkedArtifact, 'utf8'));
  assert.deepEqual(read(receipt), read(checkedReceipt));
});

test('compare artifact exports standalone SVG with a UTF-8 XML declaration', () => {
  const output = path.join(tmp, 'utf8-export.html');
  const result = run(['compare', 'architecture', baseFixture, headFixture, output, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  assert.ok(
    html.includes(`'<?xml version="1.0" encoding="UTF-8"?>\\n' + new XMLSerializer().serializeToString(clone)`),
    'the exported standalone SVG must declare its UTF-8 encoding',
  );
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

test('compare rejects either unsupported target before staging a trusted pair', () => {
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
  assert.equal(failure.stage, 'prepare');
  assert.equal(failure.diagnostics[0].code, 'output/target-not-regular-file');
  assert.equal(failure.diagnostics[0].evidence.atomicOutput.code, 'target-not-regular-file');
  assert.equal(failure.diagnostics[0].evidence.atomicOutput.entryType, 'directory');
});

for (const side of ['base', 'head']) {
  for (const initiallyValid of [true, false]) {
    test(`compare validates captured ${side} bytes when the original becomes ${initiallyValid ? 'invalid' : 'valid'}`, () => {
      const caseRoot = fs.mkdtempSync(path.join(tmp, 'snapshot-'));
      const input = path.join(caseRoot, `${side}.json`);
      const output = path.join(caseRoot, 'delta.html');
      const receiptPath = path.join(caseRoot, 'delta.receipt.json');
      const valid = read(side === 'base' ? baseFixture : headFixture);
      const invalid = { ...valid, unknown_top_level_fact: true };
      const captured = Buffer.from(JSON.stringify(initiallyValid ? valid : invalid));
      const replacement = JSON.stringify(initiallyValid ? invalid : valid);
      fs.writeFileSync(input, captured);
      fs.writeFileSync(output, 'trusted html');
      fs.writeFileSync(receiptPath, 'trusted receipt');
      const preload = path.join(caseRoot, 'replace-after-read.cjs');
      // 在首次读取返回时替换原文件，避免依赖定时竞争或平台专用 FIFO。
      fs.writeFileSync(preload, `
        const fs = require('node:fs');
        const originalRead = fs.readFileSync;
        fs.readFileSync = function(file, ...args) {
          const bytes = originalRead.call(this, file, ...args);
          if (file === ${JSON.stringify(input)}) {
            fs.readFileSync = originalRead;
            fs.writeFileSync(file, ${JSON.stringify(replacement)});
          }
          return bytes;
        };
      `);
      const result = spawnSync(process.execPath, [
        '--require', preload, cli, 'compare', 'architecture',
        side === 'base' ? input : baseFixture,
        side === 'head' ? input : headFixture, output, '--json',
      ], { cwd: skillRoot, encoding: 'utf8', timeout: 30000 });
      assert.ifError(result.error);
      assert.equal(fs.readFileSync(input, 'utf8'), replacement);
      const receipt = JSON.parse(result.stdout);
      if (initiallyValid) {
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(receipt.ok, true);
        assert.equal(receipt[side].rawSha256, createHash('sha256').update(captured).digest('hex'));
        assert.equal(receipt[side].bytes, captured.byteLength);
        assert.deepEqual(read(receiptPath), receipt);
      } else {
        assert.notEqual(result.status, 0);
        assert.equal(receipt.ok, false);
        assert.equal(receipt.diagnostics[0].code, 'schema/additionalProperties');
        assert.equal(receipt.diagnostics[0].subject.side, side);
        assert.equal(fs.readFileSync(output, 'utf8'), 'trusted html');
        assert.equal(fs.readFileSync(receiptPath, 'utf8'), 'trusted receipt');
      }
      assert.equal(fs.readdirSync(caseRoot).some(name => name.startsWith('.archify-compare-')), false);
    });
  }
}

for (const side of ['base', 'head']) {
  test(`compare reports a ${side} snapshot write failure as a preparation error`, () => {
    const caseRoot = fs.mkdtempSync(path.join(tmp, 'snapshot-write-'));
    const output = path.join(caseRoot, 'delta.html');
    const receiptPath = path.join(caseRoot, 'delta.receipt.json');
    fs.writeFileSync(output, 'trusted html');
    fs.writeFileSync(receiptPath, 'trusted receipt');
    const preload = path.join(caseRoot, 'fail-snapshot-write.cjs');
    fs.writeFileSync(preload, `
      const fs = require('node:fs');
      const originalWrite = fs.writeFileSync;
      fs.writeFileSync = function(file, ...args) {
        if (String(file).endsWith(${JSON.stringify(`${side}.snapshot.json`)})) {
          const error = new Error('simulated snapshot write failure');
          error.code = 'ENOSPC';
          throw error;
        }
        return originalWrite.call(this, file, ...args);
      };
    `);

    const result = spawnSync(process.execPath, [
      '--require', preload, cli, 'compare', 'architecture',
      baseFixture, headFixture, output, '--json',
    ], { cwd: skillRoot, encoding: 'utf8', timeout: 30000 });

    assert.ifError(result.error);
    assert.notEqual(result.status, 0);
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.stage, 'prepare');
    assert.equal(failure.diagnostics[0].code, 'delta/freeze-snapshot');
    assert.equal(failure.diagnostics[0].subject.side, side);
    assert.equal(failure.diagnostics[0].evidence.systemCode, 'ENOSPC');
    assert.match(failure.diagnostics[0].evidence.reason, /simulated snapshot write failure/);
    assert.deepEqual(failure.diagnostics[0].supportedFixes, [
      'choose a writable compare output directory on the target filesystem',
    ]);
    assert.equal(fs.readFileSync(output, 'utf8'), 'trusted html');
    assert.equal(fs.readFileSync(receiptPath, 'utf8'), 'trusted receipt');
    assert.equal(fs.readdirSync(caseRoot).some(name => name.startsWith('.archify-compare-')), false);
  });
}
