import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
import { checkAtlas, unpackAtlas, deliverAtlas } from '../renderers/shared/atlas-delivery.mjs';
import { byteReceipt } from '../renderers/shared/atlas-manifest.mjs';
import { renderAtlasShell } from '../renderers/shared/atlas-shell.mjs';
import { decodeAtlasPayload, serializeAtlasPayload } from '../renderers/shared/atlas-envelope.mjs';
import { serializeChunkedScriptJson, serializeScriptJson } from '../renderers/shared/utils.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-atlas-delivery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.cpSync(path.join(root, 'examples/atlas'), directory, { recursive: true });
  return { directory, input: path.join(directory, 'project.atlas.json'), output: path.join(directory, 'output.html') };
}
function deliver(f, extra = []) {
  const result = spawnSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', 'atlas', f.input, f.output, '--json', ...extra], { encoding: 'utf8' });
  return { ...result, receipt: JSON.parse(result.stdout) };
}

function structureFixture(t) {
  const f = fixture(t);
  const repository = path.join(f.directory, 'repository'); fs.mkdirSync(repository);
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Archify Tests'); git('config', 'user.email', 'archify@example.test');
  git('remote', 'add', 'origin', 'https://github.com/example/atlas-structure');
  fs.writeFileSync(path.join(repository, 'controller.js'), 'export function handle() { return 1; }\n');
  git('add', '.'); git('commit', '-m', 'internal structure evidence');
  const filename = path.join(f.directory, 'system.architecture.json');
  const diagram = JSON.parse(fs.readFileSync(filename, 'utf8'));
  diagram.meta.repository = { url: 'https://github.com/example/atlas-structure', revision: git('rev-parse', 'HEAD'), link_mode: 'local-only' };
  const node = diagram.components.find(node => node.id === 'controller');
  node.internal_structure = {
    sources: [{ id: 'entry', path: 'controller.js', line: 1, symbol: 'handle', role: 'definition' }],
    items: [
      { id: 'src', domain: 'code', kind: 'directory', label: 'src', summary: 'structure-only-sentinel' },
      { id: 'handle', domain: 'code', kind: 'function', label: 'handle', parent: 'src', signature: 'handle()', summary: 'Returns one.', source_refs: ['entry'] },
    ],
    relations: [],
  };
  fs.writeFileSync(filename, JSON.stringify(diagram));
  const result = deliver(f, ['--repo-root', repository]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return { ...f, result, html: fs.readFileSync(f.output, 'utf8') };
}

const structurePattern = /(<script id="archify-internal-structure-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
function changeStructure(member, transform) {
  member.html = member.html.replace(structurePattern, (_, open, encoded, close) => open + transform(encoded) + close);
  member.receipts.artifact = byteReceipt(member.html);
}

test('Atlas rechecks the internal structure inventory and exact receipt from its sole inert member payload', t => {
  const f = structureFixture(t);
  const bundle = unpackAtlas(f.html);
  const member = bundle.members.system;
  const encoded = member.html.match(structurePattern)[2];
  const data = JSON.parse(JSON.parse(encoded).join(''));
  assert.deepEqual(member.structureNodes, { controller: { code: ['src', 'handle'] } });
  assert.deepEqual(member.receipts.internalStructure, {
    schemaVersion: 1, nodeCount: 1, itemCount: 2, relationCount: 0, sourceCount: 1, ...byteReceipt(encoded),
  });
  assert.deepEqual(f.result.receipt.members.system.internalStructure, member.receipts.internalStructure);
  assert.equal(data.nodes.controller.items[0].summary, 'structure-only-sentinel');
  assert.ok(!JSON.stringify(f.result.receipt).includes('structure-only-sentinel'));
  assert.equal(bundle.members.worker.receipts.internalStructure, undefined);
  assert.equal(bundle.members.worker.structureNodes, undefined);
  assert.deepEqual(checkAtlas(f.html).artifact, byteReceipt(f.html));
  const extendedReceipt = structuredClone(bundle);
  extendedReceipt.members.system.receipts.generator = { schemaVersion: 2, status: 'pass' };
  assert.doesNotThrow(() => checkAtlas(renderAtlasShell(extendedReceipt)));
  for (const [code, mutate] of [
    ['bundle-structure-inventory', b => { b.members.system.structureNodes.controller.code = ['src']; }],
    ['bundle-structure-inventory', b => { delete b.members.system.structureNodes; delete b.members.system.receipts.internalStructure; }],
    ['bundle-structure-receipt', b => { b.members.system.receipts.internalStructure.bytes++; }],
    ['bundle-structure-receipt', b => { b.members.system.receipts.internalStructure.sha256 = '0'.repeat(64); }],
    ['bundle-structure-receipt', b => { b.members.system.receipts.internalStructure.itemCount++; }],
    ['bundle-structure-receipt', b => { changeStructure(b.members.system, value => value.replace('structure-only-sentinel', 'body-was-modified')); }],
    ['bundle-structure-data', b => { const m = b.members.system; m.html += m.html.match(structurePattern)[0]; m.receipts.artifact = byteReceipt(m.html); }],
    ['bundle-structure-data', b => { changeStructure(b.members.system, () => '[7]'); }],
    ['bundle-structure-data', b => { const m = b.members.system; m.html = m.html.replace(structurePattern, (_, open, encodedValue, close) => open.replace('application/json', 'text/plain') + encodedValue + close); m.receipts.artifact = byteReceipt(m.html); }],
    ['bundle-structure-data', b => { changeStructure(b.members.system, () => serializeChunkedScriptJson({ ...data, schemaVersion: 2 })); }],
    ['bundle-structure-data', b => { changeStructure(b.members.system, () => serializeChunkedScriptJson({ schemaVersion: 1, nodes: { controller: { ...data.nodes.controller, items: [] } } })); }],
    ['bundle-structure-inventory', b => { const m = b.members.system; m.html = m.html.replace(structurePattern, ''); m.receipts.artifact = byteReceipt(m.html); }],
    ['bundle-data', b => { b.members.system.receipts.structureCopy = { items: data.nodes.controller.items }; }],
    ['bundle-data', b => { b.members.system.evidence.structureBody = { items: data.nodes.controller.items }; }],
    ['bundle-evidence', b => { b.members.system.evidence.referenceCount++; }],
    ['reference-structure', b => {
      const m = b.members.payment;
      const copied = serializeChunkedScriptJson({ schemaVersion: 1, nodes: { redis: data.nodes.controller } });
      m.html += `<script id="archify-internal-structure-data" type="application/json">${copied}</script>`;
      m.structureNodes = { redis: { code: ['src', 'handle'] } };
      m.receipts.internalStructure = { schemaVersion: 1, nodeCount: 1, itemCount: 2, relationCount: 0, sourceCount: 1, ...byteReceipt(copied) };
      m.receipts.artifact = byteReceipt(m.html);
    }],
  ]) {
    const changed = structuredClone(bundle); mutate(changed);
    assert.throws(() => unpackAtlas(renderAtlasShell(changed)), error => {
      assert.ok([`atlas/${code}`, 'atlas/bundle-data'].includes(error.archifyDiagnostics?.[0]?.code),
        `${code} produced ${error.archifyDiagnostics?.[0]?.code}`);
      return true;
    });
  }
});

test('v2 delivery preserves canonical v1 checks and rejects actual packed corruption', t => {
  const f = fixture(t);
  assert.equal(deliver(f).status, 0);
  const html = fs.readFileSync(f.output, 'utf8');
  const pattern = /(<script id="archify-atlas-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
  const payload = decodeAtlasPayload(html.match(pattern)[2]).payload;
  assert.equal(payload.bundle_version, 2);
  const replace = (value, options) => html.replace(pattern, (_, a, b, c) => a + serializeAtlasPayload(value, options) + c);
  const canonical = unpackAtlas(html);
  assert.deepEqual(checkAtlas(replace(canonical, { compressed: false })).diagramIds, canonical.diagramIds);
  for (const [code, mutate] of [
    ['bundle-digest', p => { p.resources[0][0] += 'tampered'; }],
    ['bundle-data', p => { p.documents.system = [p.resources.length]; }],
    ['bundle-data', p => { p.bundle_version = 3; }],
  ]) {
    const bad = structuredClone(payload); mutate(bad);
    assert.throws(() => checkAtlas(replace(bad)), error => error.archifyDiagnostics?.[0]?.code === `atlas/${code}`);
  }
});

test('atlas accepts atlas as a diagram ID without colliding with staging files', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.input, JSON.stringify({ atlas_version: 1, entry: 'atlas',
    meta: { title: 'Atlas', locale: 'zh-CN' },
    diagrams: { atlas: { source: 'system.architecture.json' } } }));
  const result = deliver(f);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(checkAtlas(fs.readFileSync(f.output, 'utf8')).diagramIds, ['atlas']);
});

test('atlas checks chapter and parent summaries against the embedded member semantics', (t) => {
  const f = fixture(t);
  const source = path.join(f.directory, 'system.architecture.json');
  const diagram = JSON.parse(fs.readFileSync(source, 'utf8'));
  diagram.components.find((node) => node.id === 'controller').label = 'A<&"\'';
  diagram.connections.find((edge) => edge.to === 'controller' && !edge.id).label = '&amp; <';
  fs.writeFileSync(source, JSON.stringify(diagram));
  const result = deliver(f);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const bundle = unpackAtlas(fs.readFileSync(f.output, 'utf8'));
  const mutations = [
    ['bundle-view-inventory', (b) => { b.members.payment.views.push('invented'); }],
    ['bundle-view-inventory', (b) => { b.members.payment.views.pop(); }],
    ['bundle-view-inventory', (b) => { b.members.payment.views.push(b.members.payment.views[0]); }],
    ['bundle-parent-context', (b) => { b.members.payment.parentContext[0].id = 'api-sql'; }],
    ['bundle-parent-context', (b) => { b.members.payment.parentContext[0].label = 'invented'; }],
    ['bundle-parent-context', (b) => { b.members.payment.parentContext[0].fromLabel = 'invented'; }],
    ['bundle-parent-context', (b) => { const edge = b.members.payment.parentContext[0]; [edge.fromLabel, edge.toLabel] = [edge.toLabel, edge.fromLabel]; }],
    ['bundle-parent-context', (b) => { b.members.payment.parentContext.pop(); }],
    ['bundle-parent-context', (b) => { b.members.system.parentContext.push(b.members.payment.parentContext[0]); }],
  ];
  for (const [code, mutate] of mutations) {
    const changed = structuredClone(bundle);
    mutate(changed);
    assert.throws(() => checkAtlas(renderAtlasShell(changed)), (error) => {
      const diagnostic = error.archifyDiagnostics?.[0];
      assert.equal(diagnostic?.code, `atlas/${code}`);
      assert.ok(Object.keys(diagnostic.evidence).length);
      assert.ok(diagnostic.supportedFixes.length);
      return true;
    });
  }
});

test('deliver atlas compiles every member and rechecks the actual inert Unicode payload', (t) => {
  const f = fixture(t);
  const result = deliver(f, ['--quality', 'showcase']);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const html = fs.readFileSync(f.output, 'utf8');
  const bundle = unpackAtlas(html);
  assert.equal(bundle.diagramIds.length, 4);
  assert.ok(bundle.members.worker.title.includes('</script>'));
  assert.ok(!html.includes(f.directory));
  assert.equal((html.match(/<script id="archify-atlas-data"/g) || []).length, 1);
  for (const id of bundle.diagramIds) {
    assert.deepEqual(byteReceipt(bundle.members[id].html), result.receipt.members[id].artifact);
    assert.ok(bundle.members[id].html.includes('archify-atlas-context'));
  }
  assert.match(bundle.members.payment.html, /data-atlas-reference-diagram="system" data-atlas-reference-node="redis"/);
  assert.match(bundle.members.payment.html, /data-atlas-context-mark/);
  assert.match(bundle.members.system.html, /data-atlas-detail-diagram="payment"/);
  assert.match(bundle.members.system.html, /data-atlas-detail-mark/);
  assert.ok(!html.includes('<header>'), 'Atlas navigation belongs to the themed member, not a second outer toolbar');
  assert.deepEqual(checkAtlas(html).artifact, result.receipt.artifact);
  assert.throws(() => unpackAtlas('<html></html>'), (error) => {
    assert.deepEqual(error.archifyDiagnostics[0].evidence, { expected: 1, actual: 0 });
    assert.ok(error.archifyDiagnostics[0].supportedFixes[0].includes('deliver atlas'));
    return true;
  });
  assert.throws(() => unpackAtlas('<script id="archify-atlas-data" type="application/json">{</script>'), (error) => {
    assert.ok(error.archifyDiagnostics[0].evidence.parseError);
    return true;
  });
  const badBytes = structuredClone(bundle);
  badBytes.members.worker.html += 'tampered';
  assert.throws(() => checkAtlas(renderAtlasShell(badBytes)), (error) => {
    assert.equal(error.archifyDiagnostics[0].code, 'atlas/bundle-digest');
    assert.deepEqual(error.archifyDiagnostics[0].evidence.actual, byteReceipt(badBytes.members.worker.html));
    assert.deepEqual(error.archifyDiagnostics[0].evidence.expected, bundle.members.worker.receipts.artifact);
    return true;
  });
  const missing = structuredClone(bundle);
  delete missing.members.worker;
  assert.throws(() => checkAtlas(renderAtlasShell(missing)), /inventory/);
  const invalid = structuredClone(bundle);
  invalid.members.worker.html = '<html><body>no SVG</body></html>';
  invalid.members.worker.receipts.artifact = byteReceipt(invalid.members.worker.html);
  assert.throws(() => checkAtlas(renderAtlasShell(invalid)), /node inventory differs/);
  const badReceipt = structuredClone(bundle);
  badReceipt.members.worker.check.composition.status = 'invented';
  assert.throws(() => checkAtlas(renderAtlasShell(badReceipt)), /checker receipt differs/);
  const badTree = structuredClone(bundle);
  badTree.details[1].to = 'missing';
  assert.throws(() => checkAtlas(renderAtlasShell(badTree)), /context does not match atlas relations/);
});

test('failed atlas delivery preserves inputs and existing output and cleans staging', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.output, 'trusted output');
  const input = JSON.parse(fs.readFileSync(f.input, 'utf8'));
  input.references[0].target.node = 'missing';
  fs.writeFileSync(f.input, JSON.stringify(input));
  const before = new Map(fs.readdirSync(f.directory).map((name) => [name, fs.readFileSync(path.join(f.directory, name))]));
  const result = deliver(f);
  assert.notEqual(result.status, 0);
  assert.equal(result.receipt.diagnostics[0].code, 'atlas/unknown-node');
  for (const [name, bytes] of before) assert.deepEqual(fs.readFileSync(path.join(f.directory, name)), bytes);
  assert.deepEqual(fs.readdirSync(f.directory).sort(), [...before.keys()].sort());
});

for (const alias of ['same', 'symlink', 'hardlink']) test(`atlas protects source ${alias} aliases`, (t) => {
  const f = fixture(t);
  const source = path.join(f.directory, 'worker.architecture.json');
  const bytes = fs.readFileSync(source);
  if (alias === 'same') f.output = source;
  if (alias === 'symlink') fs.symlinkSync(source, f.output);
  if (alias === 'hardlink') fs.linkSync(source, f.output);
  const result = deliver(f);
  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readFileSync(source), bytes);
});

for (const extra of [['--bogus'], ['unexpected-positional'], ['--quality', 'invalid']]) test(`atlas CLI rejects ${extra.join(' ')}`, (t) => {
  const f = fixture(t);
  const result = deliver(f, extra);
  assert.equal(result.status, 2);
  assert.equal(result.receipt.stage, 'arguments');
  assert.ok(!fs.existsSync(f.output));
});

test('atlas default output belongs beside its manifest, independent of member output hints', (t) => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', 'atlas', f.input, '--json'], { encoding: 'utf8', cwd: os.tmpdir() });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).output, path.join(f.directory, 'project.atlas.html'));
});

test('atlas delivery uses frozen member bytes after their source files change', async (t) => {
  const f = fixture(t);
  const worker = path.join(f.directory, 'worker.architecture.json');
  const original = fs.readFileSync(worker);
  const read = fs.readFileSync;
  let changed = false;
  fs.readFileSync = function (filename, ...args) {
    const bytes = read.call(fs, filename, ...args);
    if (filename === path.join(f.directory, 'orders.architecture.json') && !changed) {
      changed = true;
      fs.writeFileSync(worker, '{"changed":"after freeze"}');
    }
    return bytes;
  };
  try {
    const receipt = await deliverAtlas({ input: f.input, requestedOutput: f.output });
    assert.ok(changed);
    assert.deepEqual(receipt.members.worker.source, byteReceipt(original));
    assert.match(unpackAtlas(read(f.output, 'utf8')).members.worker.html, /执行器/);
    assert.equal(read(worker, 'utf8'), '{"changed":"after freeze"}');
  } finally { fs.readFileSync = read; }
});

test('atlas rechecks output aliases immediately before committing its verified bundle', async (t) => {
  const f = fixture(t);
  const worker = path.join(f.directory, 'worker.architecture.json');
  const original = fs.readFileSync(worker);
  const write = fs.writeFileSync;
  let swapped = false;
  fs.writeFileSync = function (filename, ...args) {
    const result = write.call(fs, filename, ...args);
    if (!swapped && String(filename).includes('archify-atlas-check-') && path.basename(filename) === 'orders.html') {
      swapped = true;
      fs.symlinkSync(worker, f.output);
    }
    return result;
  };
  try {
    await assert.rejects(deliverAtlas({ input: f.input, requestedOutput: f.output }), (error) => error.atlasStage === 'commit' && error.archifyDiagnostics?.some((item) => item.code.startsWith('output/')));
    assert.ok(swapped);
    assert.deepEqual(fs.readFileSync(worker), original);
    assert.ok(!fs.readdirSync(f.directory).some((name) => name.startsWith('.archify-atlas-')));
  } finally { fs.writeFileSync = write; }
});

test('atlas preserves independently verified member revisions with one repository root', (t) => {
  const f = fixture(t);
  const repository = path.join(f.directory, 'repository');
  fs.mkdirSync(repository);
  const git = (...args) => execFileSync('git', ['-C', repository, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('config', 'user.name', 'Archify Tests');
  git('config', 'user.email', 'archify@example.test');
  git('remote', 'add', 'origin', 'https://github.com/example/atlas-evidence');
  fs.writeFileSync(path.join(repository, 'controller.js'), 'export const version = 1;\n');
  git('add', '.'); git('commit', '-m', 'first');
  const first = git('rev-parse', 'HEAD');
  fs.writeFileSync(path.join(repository, 'controller.js'), 'export const version = 2;\n');
  git('add', '.'); git('commit', '-m', 'second');
  const second = git('rev-parse', 'HEAD');
  for (const [id, revision] of [['system', first], ['payment', second]]) {
    const filename = path.join(f.directory, `${id}.architecture.json`);
    const diagram = JSON.parse(fs.readFileSync(filename, 'utf8'));
    diagram.meta.repository = { url: 'https://github.com/example/atlas-evidence', revision, link_mode: 'local-only' };
    diagram.components.find((node) => node.id === 'controller').sources = [{ path: 'controller.js', line: 1 }];
    fs.writeFileSync(filename, JSON.stringify(diagram));
  }
  const result = deliver(f, ['--repo-root', repository]);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.receipt.members.system.evidence.repository.revision, first);
  assert.equal(result.receipt.members.payment.evidence.repository.revision, second);
  assert.equal(result.receipt.members.worker.evidence, undefined);
  const bundle = unpackAtlas(fs.readFileSync(f.output, 'utf8'));
  assert.equal(bundle.members.system.evidence.repository.revision, first);
  assert.equal(bundle.members.payment.evidence.repository.revision, second);
  assert.ok(!bundle.members.system.html.includes(repository));
  const failed = deliver(f);
  assert.notEqual(failed.status, 0);
  assert.equal(failed.receipt.diagnostics[0].subject.diagram, 'system');
});
