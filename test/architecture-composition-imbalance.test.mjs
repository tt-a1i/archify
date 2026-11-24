import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compositionImbalance } from '../archify/renderers/architecture/automatic-placement-candidates.mjs';

function scene([rootX, rootY], [branchX, branchY]) {
  const cards = [[rootX, rootY], [branchX, branchY], [400, 0], [540, 180], [400, 300], [0, 420]];
  const boxes = new Map(cards.map(([x, y], id) => [id, { x, y, width: 60, height: 60, cy: y + 30 }]));
  const routes = [1, 2, 3, 4, 5].map(to => ({ relation: { from: 0, to } }));
  return { boxes, routes, titles: { boundaries: [] }, viewBox: [800, 600] };
}

const balanced = { leadingVoid: 0, sunkenRoots: 0, score: 0 };

test('a card overlapping the leading region keeps a high entry composition balanced', () => {
  assert.deepEqual(compositionImbalance(scene([400, 100], [225, 195])), balanced);
});

test('an empty leading quadrant is measured relative to the canvas', () => {
  const layout = scene([400, 100], [280, 215]);
  const { leadingVoid, sunkenRoots, score } = compositionImbalance(layout);
  assert.ok(Math.abs(leadingVoid - 0.10584) < 1e-8);
  assert.equal(sunkenRoots, 0);
  assert.equal(score, leadingVoid);
});

test('only an entirely sunken set of primary entries is penalized, ignoring dashed feedback', () => {
  const layout = scene([180, 420], [280, 215]);
  layout.routes.push({ relation: { from: 2, to: 0, variant: 'dashed' } });
  const { leadingVoid, sunkenRoots, score } = compositionImbalance(layout);
  assert.ok(leadingVoid > 0);
  assert.equal(sunkenRoots, 1);
  assert.equal(score, leadingVoid + sunkenRoots);

  layout.routes = layout.routes.filter(({ relation }) => relation.to !== 2);
  layout.routes.push({ relation: { from: 2, to: 5 } });
  assert.equal(compositionImbalance(layout).sunkenRoots, 0);
});

test('small, framed and pinned compositions are exempt', () => {
  const layout = scene([180, 420], [280, 215]);
  assert.deepEqual(compositionImbalance({ ...layout, titles: { boundaries: [{}] } }), balanced);
  layout.boxes.get(0).pos = [180, 420];
  assert.deepEqual(compositionImbalance(layout), balanced);
  layout.boxes.delete(0);
  assert.deepEqual(compositionImbalance(layout), balanced);
});
