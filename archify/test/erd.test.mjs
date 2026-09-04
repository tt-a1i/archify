import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-erd-'));

function base() {
  return JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'examples', 'billing.erd.json'),
    'utf8',
  ));
}

function render(diagram) {
  const input = path.join(tmp, `case-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(input, JSON.stringify(diagram));
  const output = path.join(tmp, 'out.html');
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'bin', 'archify.mjs'),
    'render',
    'erd',
    input,
    output,
  ], { cwd: skillRoot, encoding: 'utf8' });
  return { result, output };
}

function expectFailure(name, mutate, expectInMessage) {
  const diagram = base();
  mutate(diagram);
  const { result } = render(diagram);
  assert.notEqual(result.status, 0, `${name}: renderer should fail on invalid input`);
  const message = `${result.stdout}\n${result.stderr}`;
  assert.ok(
    message.includes(expectInMessage),
    `${name}: expected "${expectInMessage}" in:\n${message.slice(0, 400)}`,
  );
}

test('erd: valid billing example renders with entities, crow markers, and cardinality', () => {
  const { result, output } = render(base());
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(output, 'utf8');
  for (const id of ['users', 'orders', 'products', 'order_items', 'payments', 'audit_events', 'payment_gateway']) {
    assert.ok(html.includes(`data-node-id="${id}"`), `missing entity ${id}`);
  }
  assert.ok((html.match(/marker-(start|end)="url\(#erd-(one|many)\)"/g) || []).length >= 6, 'expected crow-foot markers on relationships');
  assert.ok(html.includes('0..N'), 'expected cardinality label');
  assert.ok(html.includes('>PK<') || html.includes('PK'), 'expected a primary-key badge');
});

test('erd: every relationship must declare cardinality on both ends', () => {
  expectFailure('missing cardinality.to', (d) => { delete d.relationships[0].cardinality.to; }, 'cardinality');
  expectFailure('missing cardinality entirely', (d) => { delete d.relationships[0].cardinality; }, 'cardinality');
});

test('erd: foreign-key references must point to an existing entity', () => {
  expectFailure('fk references unknown entity', (d) => {
    d.entities.find((e) => e.id === 'orders').attributes.find((a) => a.name === 'user_id').references = 'ghosts.id';
  }, 'references unknown entity');
});

test('erd: foreign-key references must point to an existing attribute', () => {
  expectFailure('fk references unknown attribute', (d) => {
    d.entities.find((e) => e.id === 'orders').attributes.find((a) => a.name === 'user_id').references = 'users.uuid';
  }, 'references unknown attribute');
});

test('erd: enforced_by must resolve to a real entity.attribute', () => {
  expectFailure('enforced_by unknown attribute', (d) => {
    d.relationships.find((r) => r.id === 'orders_payments').enforced_by = 'payments.nonexistent';
  }, 'enforced_by');
});

test('erd: an entity with relationships must not be an orphan', () => {
  expectFailure('orphan entity', (d) => {
    d.entities.push({ id: 'orphan', label: 'orphan', kind: 'reference', attributes: [{ name: 'id', role: 'primary' }] });
  }, 'orphan');
});

test('erd: a standalone entity is allowed to be disconnected', () => {
  const d = base();
  d.entities.push({
    id: 'loner',
    label: 'loner',
    kind: 'reference',
    standalone: true,
    attributes: [{ name: 'id', role: 'primary' }],
  });
  const { result } = render(d);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('erd: at most one primary key per entity', () => {
  expectFailure('two primary keys', (d) => {
    const e = d.entities.find((x) => x.id === 'users');
    e.attributes.push({ name: 'email_hash', role: 'primary' });
  }, 'primary key');
});

test('erd: no duplicate attribute names within an entity', () => {
  expectFailure('duplicate attribute name', (d) => {
    const e = d.entities.find((x) => x.id === 'users');
    e.attributes.push({ name: 'email' });
  }, 'duplicate attribute name');
});

test('erd: relationship endpoints must reference existing entities', () => {
  expectFailure('unknown relationship target', (d) => {
    d.relationships[0].to = 'nonexistent';
  }, 'references unknown entity');
});

test('erd: entity kind must be a supported value', () => {
  expectFailure('unsupported entity kind', (d) => {
    d.entities[0].kind = 'widget';
  }, 'kind');
});

test('erd: schema rejects unknown top-level properties', () => {
  expectFailure('extra property', (d) => { d.bogus = true; }, 'additional properties');
});

test('erd: a foreign role without references fails closed', () => {
  expectFailure('foreign role without references', (d) => {
    delete d.entities.find((e) => e.id === 'orders').attributes.find((a) => a.name === 'user_id').references;
  }, 'without a references target');
});

test('erd: orphan rule applies when relationships are empty', () => {
  expectFailure('orphan with zero relationships', (d) => { d.relationships = []; }, 'orphan');
});

test('erd: rendered paths carry finite coordinates', () => {
  const { result, output } = render(base());
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(output, 'utf8');
  assert.ok(!/M undefined/.test(html), 'route must not contain undefined coordinates');
  assert.ok(!/L undefined/.test(html), 'route must not contain undefined coordinates');
  assert.ok(!/NaN/.test(html.match(/data-composition-points="[^"]*"/g)?.join(' ') ?? ''), 'composition points must be finite');
});

test('erd: authored positions survive when a peer omits pos', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Position probe', quality_profile: 'standard' },
    entities: [
      { id: 'a', label: 'A', kind: 'reference', pos: [400, 300], attributes: [{ name: 'id', role: 'primary' }] },
      { id: 'b', label: 'B', kind: 'reference', attributes: [{ name: 'id', role: 'primary' }] },
    ],
    relationships: [{ id: 'r', from: 'a', to: 'b', cardinality: { from: '1', to: '0..N' } }],
  };
  const input = path.join(tmp, `pos-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(input, JSON.stringify(diagram));
  const output = path.join(tmp, 'pos-out.html');
  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'bin', 'archify.mjs'), 'render', 'erd', input, output,
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const html = fs.readFileSync(output, 'utf8');
  assert.ok(html.includes('x="400" y="300"'), 'authored entity position must be preserved');
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
