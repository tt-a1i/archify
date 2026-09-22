import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { freezeAtlas, byteReceipt } from '../renderers/shared/atlas-manifest.mjs';

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-atlas-manifest-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const manifest = {
    atlas_version: 1, entry: 'system', meta: { title: '系统 </script> &', locale: 'zh-CN' },
    diagrams: Object.fromEntries(['system', 'payment', 'worker', 'orders'].map((id) => [id, { source: `${id}.json` }])),
    details: [
      { from: { diagram: 'system', node: 'controller' }, to: 'payment' },
      { from: { diagram: 'payment', node: 'controller' }, to: 'worker' },
      { from: { diagram: 'system', node: 'orders' }, to: 'orders' },
    ],
    references: ['payment', 'orders'].map((diagram) => ({
      occurrence: { diagram, node: 'redis' }, target: { diagram: 'system', node: 'redis' },
    })),
  };
  const diagram = {
    schema_version: 1, diagram_type: 'architecture', meta: { title: '成员', output: 'ignored.html' },
    components: ['controller', 'orders', 'redis'].map((id) => ({ id, label: id, type: id === 'redis' ? 'database' : 'backend' })),
  };
  for (const id of Object.keys(manifest.diagrams)) fs.writeFileSync(path.join(directory, `${id}.json`), JSON.stringify(diagram));
  const input = path.join(directory, 'project.atlas.json');
  return { directory, manifest, diagram, input, run() {
    fs.writeFileSync(input, JSON.stringify(manifest));
    return freezeAtlas(input);
  } };
}

function authorStructure(f, diagramId, nodeId = 'redis') {
  const diagram = structuredClone(f.diagram);
  const node = diagram.components.find((component) => component.id === nodeId);
  node.internal_structure = {
    sources: [{ id: `${nodeId}-definition`, role: 'definition', path: `src/${nodeId}.js` }],
    items: [
      { id: `${nodeId}-root`, domain: 'code', kind: 'directory', label: 'src', summary: `${nodeId} canonical structure.` },
      { id: `${nodeId}-symbol`, domain: 'code', kind: 'function', label: nodeId, parent: `${nodeId}-root`, summary: 'Canonical implementation.', source_refs: [`${nodeId}-definition`] },
    ],
    relations: [],
  };
  fs.writeFileSync(path.join(f.directory, `${diagramId}.json`), JSON.stringify(diagram));
}

test('atlas freezes original bytes and independently hashed inherited members', (t) => {
  const f = fixture(t);
  const frozen = f.run();
  const payment = frozen.members.get('payment');
  assert.equal(payment.diagram.meta.locale, 'zh-CN');
  assert.equal(payment.diagram.meta.visual_preset, 'classic');
  assert.equal(payment.diagram.meta.output, 'ignored.html');
  assert.notDeepEqual(payment.receipts.source, payment.receipts.effectiveInput);
  fs.writeFileSync(payment.sourcePath, 'changed after freeze');
  assert.deepEqual(byteReceipt(payment.sourceBytes), payment.receipts.source);
  assert.deepEqual(byteReceipt(payment.effectiveBytes), payment.receipts.effectiveInput);
  assert.equal(frozen.parent.get('worker').diagram, 'payment');
});

test('atlas allows a lone root and mutual references to canonical definitions', (t) => {
  const f = fixture(t);
  f.manifest.references.push({ occurrence: { diagram: 'system', node: 'redis' }, target: { diagram: 'payment', node: 'redis' } });
  f.manifest.references[0] = { occurrence: { diagram: 'payment', node: 'orders' }, target: { diagram: 'system', node: 'orders' } };
  f.manifest.references[1].target = { diagram: 'payment', node: 'redis' };
  assert.equal(f.run().members.size, 4);
  f.manifest.diagrams = { system: f.manifest.diagrams.system };
  delete f.manifest.details;
  delete f.manifest.references;
  assert.equal(f.run().members.size, 1);
});

test('atlas rejects internal structure on a reference occurrence at its exact member path', (t) => {
  const f = fixture(t);
  authorStructure(f, 'payment');
  assert.throws(() => f.run(), (error) => {
    const item = error.archifyDiagnostics?.find((diagnostic) => diagnostic.code === 'atlas/reference-structure');
    assert.ok(item);
    assert.deepEqual(item.subject, {
      diagram: 'payment',
      node: 'redis',
      path: '/components/2/internal_structure',
    });
    assert.ok(item.supportedFixes.some((fix) => fix.includes('/components/2/internal_structure')));
    assert.ok(item.supportedFixes.some((fix) => fix.includes('system/redis')));
    return true;
  });
});

test('atlas keeps one canonical internal structure when two occurrences reference the same definition', (t) => {
  const f = fixture(t);
  authorStructure(f, 'system');
  const frozen = f.run();
  const canonicalTargets = new Set(frozen.manifest.references.map(({ target }) => `${target.diagram}/${target.node}`));

  assert.deepEqual([...canonicalTargets], ['system/redis']);
  assert.deepEqual(frozen.manifest.references.map(({ occurrence, target }) => ({ occurrence, target })), [
    { occurrence: { diagram: 'payment', node: 'redis' }, target: { diagram: 'system', node: 'redis' } },
    { occurrence: { diagram: 'orders', node: 'redis' }, target: { diagram: 'system', node: 'redis' } },
  ]);
  assert.equal(frozen.members.get('system').nodes.get('redis').internal_structure.items[0].summary, 'redis canonical structure.');
  assert.equal(frozen.members.get('payment').nodes.get('redis').internal_structure, undefined);
  assert.equal(frozen.members.get('orders').nodes.get('redis').internal_structure, undefined);
});

test('atlas still rejects a missing canonical target with an exact repair diagnostic', (t) => {
  const f = fixture(t);
  authorStructure(f, 'system');
  f.manifest.references[0].target.node = 'missing';
  assert.throws(() => f.run(), (error) => {
    const item = error.archifyDiagnostics?.find((diagnostic) => diagnostic.code === 'atlas/unknown-node');
    assert.ok(item);
    assert.deepEqual(item.subject, {
      diagram: 'system',
      node: 'missing',
      path: '/references/0/target',
    });
    assert.equal(item.evidence.actual, 'missing');
    assert.ok(item.supportedFixes.some((fix) => fix.includes('/references/0/target/node')));
    return true;
  });
});

const invalid = [
  ['schema/const', (m) => { m.atlas_version = 2; }],
  ['atlas/unknown-diagram', (m) => { m.entry = 'missing'; }],
  ['atlas/unknown-node', (m) => { m.details[0].from.node = 'missing'; }],
  ['atlas/root-parent', (m) => { m.details[0].to = 'system'; }],
  ['atlas/multiple-parents', (m) => { m.details[2].to = 'payment'; }],
  ['atlas/duplicate-detail', (m) => { m.details[2].from.node = 'controller'; }],
  ['atlas/orphan', (m) => { m.details.pop(); }],
  ['atlas/detail-cycle', (m) => { m.details[0].from.diagram = 'worker'; }],
  ['atlas/duplicate-reference', (m) => { m.references.push(m.references[0]); }],
  ['atlas/reference-type', (m) => { m.references[0].target.node = 'orders'; }],
  ['atlas/self-reference', (m) => { m.references[0].target.diagram = 'payment'; }],
  ['atlas/reference-chain', (m) => { m.references[1].target.diagram = 'payment'; }],
  ['atlas/reference-detail', (m) => { m.references[0].occurrence.node = 'controller'; m.references[0].target.node = 'orders'; }],
  ['atlas/local-source', (m) => { m.diagrams.worker.source = 'https://example.com/a.json'; }],
  ['atlas/local-source', (m) => { m.diagrams.worker.source = 'file:///tmp/a.json'; }],
];
for (const [code, mutate] of invalid) test(`atlas rejects ${code}`, (t) => {
  const f = fixture(t);
  mutate(f.manifest);
  assert.throws(() => f.run(), (error) => {
    const item = error.archifyDiagnostics?.find((item) => item.code === code);
    assert.ok(item);
    if (code.startsWith('atlas/')) {
      assert.ok(Object.keys(item.evidence).length, `${code} needs concrete evidence`);
      assert.ok(item.supportedFixes.length, `${code} needs an actionable repair`);
    }
    return true;
  });
});

test('atlas rejects explicit member appearance conflicts with member identity', (t) => {
  const f = fixture(t);
  f.diagram.meta.locale = 'en';
  fs.writeFileSync(path.join(f.directory, 'worker.json'), JSON.stringify(f.diagram));
  assert.throws(() => f.run(), (error) => error.archifyDiagnostics?.some((item) => item.code === 'atlas/configuration-conflict' && item.subject.diagram === 'worker'));
});

test('atlas accepts absolute local paths, parent segments and symlink sources', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.directory, 'nested'));
  fs.symlinkSync(path.join(f.directory, 'worker.json'), path.join(f.directory, 'worker-link.json'));
  f.manifest.diagrams.worker.source = 'nested/../worker-link.json';
  f.manifest.diagrams.payment.source = path.join(f.directory, 'payment.json');
  assert.equal(f.run().members.size, 4);
});


test('atlas treats Windows drive-absolute paths as filesystem inputs, while rejecting drive-relative URI syntax', (t) => {
  const f = fixture(t);
  for (const source of ['Z:\\archify-missing-review-fixture\\worker.json', 'Z:/archify-missing-review-fixture/worker.json']) {
    f.manifest.diagrams.worker.source = source;
    assert.throws(() => f.run(), (error) => {
      const item = error.archifyDiagnostics?.[0];
      assert.equal(item?.code, 'atlas/input');
      assert.equal(item.evidence.systemCode, 'ENOENT');
      assert.ok(item.supportedFixes.length);
      return true;
    });
  }
  for (const source of ['https://example.com/a.json', 'file:///tmp/a.json', 'z:worker.json', '//example.com/a.json']) {
    f.manifest.diagrams.worker.source = source;
    assert.throws(() => f.run(), (error) => error.archifyDiagnostics?.[0].code === 'atlas/local-source');
  }
});

test('atlas unknown-node diagnostic identifies the actual node and available repair targets', (t) => {
  const f = fixture(t);
  f.manifest.details[0].from.node = 'missing';
  assert.throws(() => f.run(), (error) => {
    const item = error.archifyDiagnostics[0];
    assert.equal(item.evidence.actual, 'missing');
    assert.deepEqual(item.evidence.available, ['controller', 'orders', 'redis']);
    assert.ok(item.supportedFixes.some((fix) => fix.includes('/details/0/from/node')));
    return true;
  });
});


test('atlas member and input failures carry concrete evidence and repair actions', (t) => {
  const f = fixture(t);
  function check(code, predicate) {
    assert.throws(() => f.run(), (error) => {
      const item = error.archifyDiagnostics.find((item) => item.code === code);
      assert.ok(item);
      assert.ok(item.supportedFixes.length);
      assert.ok(predicate(item.evidence));
      return true;
    });
  }
  const memberPath = path.join(f.directory, 'worker.json');
  f.diagram.meta.locale = 'en';
  fs.writeFileSync(memberPath, JSON.stringify(f.diagram));
  check('atlas/configuration-conflict', (e) => e.actual === 'en' && e.expected === 'zh-CN');
  delete f.diagram.meta.locale;
  f.diagram.components.push(f.diagram.components[0]);
  fs.writeFileSync(memberPath, JSON.stringify(f.diagram));
  check('atlas/duplicate-node', (e) => e.actual === 'controller' && e.occurrences === 2);
  fs.writeFileSync(memberPath, '{bad');
  check('atlas/input', (e) => e.filename === memberPath && Boolean(e.parseError));
  fs.unlinkSync(memberPath);
  check('atlas/input', (e) => e.filename === memberPath && e.systemCode === 'ENOENT');
});
