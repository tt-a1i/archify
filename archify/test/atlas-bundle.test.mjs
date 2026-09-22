import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { packAtlasBundle, readAtlasBundle } from '../renderers/shared/atlas-bundle.mjs';
import { serializeChunkedScriptJson, serializeScriptJson } from '../renderers/shared/utils.mjs';

const template = fs.readFileSync(new URL('../assets/template.html', import.meta.url), 'utf8');
function fixture(count = 5, body = template) {
  const ids = Array.from({ length: count }, (_, i) => `diagram${i}`);
  return { bundle_version: 1, entry: ids[0], meta: { title: 'Atlas', locale: 'zh-CN' },
    diagramIds: ids, details: [], references: [],
    members: Object.fromEntries(ids.map(id => [id, { title: id, nodes: [], relations: [], views: [], parentContext: [],
      html: body + `<p>${id}</p>` }])) };
}
function roundtrip(original) {
  const encoded = serializeScriptJson(packAtlasBundle(original), 2);
  const reader = readAtlasBundle(JSON.parse(encoded));
  for (const id of original.diagramIds) assert.equal(reader.memberHtml(id), original.members[id].html);
  assert.equal(JSON.stringify(original).includes('htmlParts'), false);
  return { encoded, reader };
}
test('v2 shares exact resources, bounds UTF-8 lines and restores real viewer bytes', () => {
  const original = fixture();
  const { encoded, reader } = roundtrip(original);
  assert.equal(JSON.parse(encoded).bundle_version, 2);
  assert.ok(Buffer.byteLength(encoded) < 1500000);
  assert.ok(Math.max(...encoded.split('\n').map(line => Buffer.byteLength(line))) <= 8192);
  for (const member of Object.values(reader.bundle.members)) assert.equal(Object.hasOwn(member, 'html'), false);
  assert.equal(encoded, serializeScriptJson(packAtlasBundle(original), 2));
});
test('1/5/10 members share one copy of each resource, without conflating same-length bodies', () => {
  const outputs = [1, 5, 10].map(n => packAtlasBundle(fixture(n)));
  assert.ok(outputs[0].resources.length > 0);
  assert.deepEqual(outputs[0].resources, outputs[1].resources);
  assert.deepEqual(outputs[1].resources, outputs[2].resources);
  const mixed = fixture(2, '<style>a{color:red}</style><script>one()</script>');
  mixed.members.diagram1.html = mixed.members.diagram0.html.replace('one()', 'two()');
  const packed = packAtlasBundle(mixed);
  assert.equal(packed.resources.length, 3);
  roundtrip(mixed);
});
test('long metadata and HTML preserve Unicode, escape boundaries and literal closing tags', () => {
  const special = '中😀</script><>&\\\"\n\r\t\ud800\udfff'.repeat(6000);
  const original = fixture(2, `<p>${special}</p>`);
  original.meta.title = special;
  const { encoded } = roundtrip(original);
  assert.ok(Math.max(...encoded.split('\n').map(line => Buffer.byteLength(line))) <= 8192);
  assert.doesNotMatch(encoded, /[<>&]/);
  assert.equal(readAtlasBundle(JSON.parse(encoded)).bundle.meta.title, special);
});
test('v1 remains readable and malformed v2 structure is rejected before member startup', () => {
  const original = fixture(2);
  assert.equal(readAtlasBundle(original).memberHtml('diagram0'), original.members.diagram0.html);
  const packed = packAtlasBundle(original);
  for (const mutate of [
    p => { p.bundle_version = 99; }, p => { p.metadata = ['{']; },
    p => { const metadata = JSON.parse(p.metadata.join('')); metadata.members.diagram0.nodes = null; p.metadata = [JSON.stringify(metadata)]; },
    p => { p.resources[0] = [7]; }, p => { p.resources[0] = []; },
    p => { delete p.documents.diagram0; }, p => { p.documents.diagram0 = {}; },
    ...[-1, 0.5, 999999, null, {}, false].map(value => p => { p.documents.diagram0 = [value]; }),
  ]) {
    const changed = structuredClone(packed); mutate(changed);
    assert.throws(() => readAtlasBundle(changed));
  }
  assert.throws(() => readAtlasBundle(packed).memberHtml('missing'));
});

test('internal structure data stays once in each owner document while executable resources remain shared', () => {
  const marker = 'structure-body-unique-to-node';
  const data = serializeChunkedScriptJson({ schemaVersion: 1, nodes: { node: { sources: [{ id: 'source' }], items: [{ id: 'root', domain: 'code', kind: 'directory', summary: marker }], relations: [] } } });
  const body = `<style>.structure{color:red}</style><script>structureRuntime()</script><script id="archify-internal-structure-data" type="application/json">${data}</script>`;
  const original = fixture(2, body);
  const { encoded, reader } = roundtrip(original);
  const packed = JSON.parse(encoded);
  assert.equal(packed.resources.length, 2);
  assert.ok(packed.resources.every(parts => !parts.join('').includes(marker)));
  assert.ok(!packed.metadata.join('').includes(marker));
  for (const id of original.diagramIds) {
    assert.equal(reader.memberHtml(id), original.members[id].html);
    assert.equal((reader.memberHtml(id).match(/id="archify-internal-structure-data"/g) || []).length, 1);
  }
});

test('reader rejects invalid structure inventories, receipts, duplicated body metadata and Atlas totals before startup', () => {
  const original = fixture(3);
  for (const member of Object.values(original.members)) {
    member.nodes = ['node'];
    member.structureNodes = { node: { code: ['root'] } };
    member.receipts = { internalStructure: { schemaVersion: 1, nodeCount: 1, itemCount: 1, relationCount: 0, sourceCount: 1, bytes: 400, sha256: 'a'.repeat(64) } };
  }
  assert.equal(readAtlasBundle(packAtlasBundle(original)).bundle.members.diagram0.structureNodes.node.code[0], 'root');
  for (const mutate of [
    b => { b.members.diagram0.structureNodes = []; },
    b => { b.members.diagram0.structureNodes = { missing: { code: ['root'] } }; },
    b => { b.members.diagram0.structureNodes.node = { arbitrary: ['root'] }; },
    b => { b.members.diagram0.structureNodes.node.code = ['root', 'root']; },
    b => { b.members.diagram0.structureNodes.node.code = []; },
    b => { delete b.members.diagram0.receipts.internalStructure; },
    b => { b.members.diagram0.receipts.internalStructure.nodeCount = 2; },
    b => { b.members.diagram0.receipts.internalStructure.itemCount = 0; },
    b => { b.members.diagram0.receipts.internalStructure.relationCount = -1; },
    b => { b.members.diagram0.receipts.internalStructure.sourceCount = 0; },
    b => { b.members.diagram0.receipts.internalStructure.bytes = -1; },
    b => { b.members.diagram0.receipts.internalStructure.bytes = 256 * 1024 + 1; },
    b => { b.members.diagram0.receipts.internalStructure.sha256 = 'invalid'; },
    b => { b.members.diagram0.receipts.internalStructure.summary = 'duplicated-body'; },
    b => { b.members.diagram0.evidence = { structureBody: { summary: 'duplicated-body' } }; },
    b => { b.members.diagram0.receipts.structureCopy = { summary: 'duplicated-body' }; },
    b => { b.members.diagram0.receipts.extension = { structurePayload: { schemaVersion: 1, nodes: { node: { sources: [], items: [], relations: [] } } } }; },
    b => { b.members.diagram0.receipts.internal_structure = { sources: [], items: [], relations: [] }; },
    b => { b.members.diagram0.internalStructure = { nodes: { node: 'duplicated-body' } }; },
    b => { b.internalStructures = { diagram0: 'duplicated-body' }; },
    b => { for (const member of Object.values(b.members)) member.receipts.internalStructure.bytes = 200000; },
  ]) {
    const changed = structuredClone(original); mutate(changed);
    assert.throws(() => readAtlasBundle(packAtlasBundle(changed)), /structure|metadata/i);
  }
  const legacy = fixture(1);
  assert.equal(readAtlasBundle(legacy).memberHtml('diagram0'), legacy.members.diagram0.html);
  legacy.members.diagram0.structureNodes = {};
  assert.equal(readAtlasBundle(packAtlasBundle(legacy)).memberHtml('diagram0'), legacy.members.diagram0.html);
  const extended = structuredClone(original);
  extended.members.diagram0.receipts.generator = { schemaVersion: 2, status: 'pass' };
  assert.doesNotThrow(() => readAtlasBundle(packAtlasBundle(extended)));
  const boundary = structuredClone(original);
  boundary.members.diagram0.receipts.internalStructure.bytes = 256 * 1024;
  boundary.members.diagram1.receipts.internalStructure.bytes = 256 * 1024 - 400;
  assert.doesNotThrow(() => readAtlasBundle(packAtlasBundle(boundary)));
  boundary.members.diagram2.receipts.internalStructure.bytes++;
  assert.throws(() => readAtlasBundle(packAtlasBundle(boundary)), /524288/);
});
