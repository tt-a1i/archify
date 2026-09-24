import assert from 'node:assert/strict';
import test from 'node:test';
import { compactArchitectureWidth } from '../renderers/architecture/compact-width.mjs';

const candidate = () => ({
  meta: {},
  components: [
    { id: 'a', pos: [40, 40] },
    { id: 'b', pos: [400, 40] },
    { id: 'c', pos: [800, 200], size: [160, 60] },
  ],
  connections: [
    { id: 'ab', from: 'a', to: 'b', label: 'calls' },
    { id: 'bc', from: 'b', to: 'c', via: [[600, 70], [600, 230]], labelAt: [700, 230] },
  ],
});

test('removes slack from empty strips and keeps order, sizes and route points aligned', () => {
  const out = compactArchitectureWidth(candidate(), 200);
  const x = Object.fromEntries(out.components.map((c) => [c.id, c.pos[0]]));
  assert.equal(x.a, 40);
  assert.ok(x.b < 400 && x.c < 800);
  assert.equal(800 - x.c, 200);
  assert.ok(x.b + 120 < x.c);
  assert.ok(x.b - (x.a + 120) >= 6.5 * 'calls'.length + 21);
  const [via] = out.connections[1].via;
  assert.ok(via[0] > x.b + 120 && via[0] < x.c);
  assert.deepEqual(out.components[2].size, [160, 60]);
});

test('declines when the gaps cannot give up enough room or geometry is fixed', () => {
  assert.equal(compactArchitectureWidth(candidate(), 5000), null);
  assert.equal(compactArchitectureWidth({ ...candidate(), meta: { viewBox: [0, 0, 1200, 600] } }, 50), null);
  assert.equal(compactArchitectureWidth({ ...candidate(), layout: { mode: 'grid' } }, 50), null);
});
