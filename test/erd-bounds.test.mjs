import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const renderer = path.join(root, 'archify/renderers/erd/render-erd.mjs');

function render(diagram) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-erd-bounds-'));
  const input = path.join(directory, 'candidate.er.json');
  const output = path.join(directory, 'candidate.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  const result = spawnSync(process.execPath, [renderer, input, output], { cwd: directory, encoding: 'utf8' });
  return { ...result, output };
}

// An authored viewBox that cannot hold an entity used to pass silently: the
// table was clipped or absent and the receipt still read green. The validator
// names the entity and offers the pixel-exact wider canvas.
test('an entity that falls outside the canvas fails with an out-of-bounds diagnostic', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Orders', output: 'orders.html', viewBox: [400, 300] },
    layout: { mode: 'grid' },
    entities: [
      { id: 'customer', label: 'customer', row: 0, col: 0, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'order', label: 'order', row: 0, col: 1, attributes: [
        { name: 'id', type: 'bigint', key: 'pk' },
        { name: 'customer_id', type: 'bigint', key: 'fk', references: 'customer.id' },
      ] },
    ],
    relationships: [{ id: 'customer_order', from: 'order', to: 'customer', fromCardinality: 'many', toCardinality: 'one' }],
  };
  const { status, stdout, stderr } = render(diagram);
  assert.notEqual(status, 0, 'an entity outside the authored viewBox is not a pass');
  const message = stdout + stderr;
  assert.match(message, /layout\/component-out-of-bounds/);
  assert.match(message, /"order" falls outside the viewBox 400x300/);
  assert.match(message, /set meta\.viewBox to at least \[568, 300\]/);
});

// A hand-placed entity behind the origin is rescued by an exact move: the
// repair names the overflow per side, not a rounded guess.
test('a negative pos reports the exact move back onto the canvas', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Offset', output: 'offset.html', viewBox: [640, 300] },
    entities: [
      { id: 'stray', label: 'stray', pos: [-40, -20], attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'home', label: 'home', pos: [120, 40], attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    ],
    relationships: [{ id: 'link', from: 'stray', to: 'home', fromCardinality: 'many', toCardinality: 'one' }],
  };
  const { status, stderr } = render(diagram);
  assert.notEqual(status, 0, 'an entity past the top-left corner is not a pass');
  assert.match(stderr, /move entity "stray" right by 40px/);
  assert.match(stderr, /move entity "stray" down by 20px/);
});
