import assert from 'node:assert/strict';
import test from 'node:test';
import { createSpatialGrid } from '../renderers/shared/spatial-grid.mjs';

test('a query returns the items its box reaches, once each', () => {
  const grid = createSpatialGrid(100);
  const near = { id: 'near' };
  const far = { id: 'far' };
  grid.insert({ minX: 90, minY: 0, maxX: 210, maxY: 60 }, near);
  grid.insert({ minX: 900, minY: 900, maxX: 960, maxY: 960 }, far);
  assert.deepEqual(grid.query({ minX: 0, minY: 0, maxX: 140, maxY: 80 }), [near]);
  assert.deepEqual(grid.query({ minX: 850, minY: 850, maxX: 1000, maxY: 1000 }), [far]);
});

test('an item spanning several cells is reported once', () => {
  const grid = createSpatialGrid(100);
  const long = { id: 'long' };
  grid.insert({ minX: 0, minY: 0, maxX: 500, maxY: 40 }, long);
  assert.deepEqual(grid.query({ minX: 0, minY: 0, maxX: 500, maxY: 60 }), [long]);
});

test('an item with an unbounded box stays out of the buckets and never stalls', () => {
  const grid = createSpatialGrid(100);
  const huge = { id: 'huge' };
  const normal = { id: 'normal' };
  grid.insert({ minX: 0, minY: 0, maxX: Number.MAX_VALUE, maxY: Number.MAX_VALUE }, huge);
  grid.insert({ minX: 10, minY: 10, maxX: 20, maxY: 20 }, normal);
  assert.deepEqual(grid.query({ minX: 0, minY: 0, maxX: 30, maxY: 30 }), [normal, huge]);
});

test('a query that cannot be walked returns every item instead of stalling', () => {
  const grid = createSpatialGrid(100);
  const first = { id: 'first' };
  const second = { id: 'second' };
  grid.insert({ minX: 0, minY: 0, maxX: 20, maxY: 20 }, first);
  grid.insert({ minX: 500, minY: 500, maxX: 520, maxY: 520 }, second);
  const all = grid.query({ minX: -Number.MAX_VALUE, minY: -Number.MAX_VALUE, maxX: Number.MAX_VALUE, maxY: Number.MAX_VALUE });
  assert.deepEqual(all, [first, second]);
});

test('a legal but enormous box is answered without walking cells', () => {
  const grid = createSpatialGrid(1);
  const only = { id: 'only' };
  grid.insert({ minX: 0, minY: 0, maxX: 0, maxY: 0 }, only);
  assert.deepEqual(grid.query({ minX: 0, minY: 0, maxX: 1e9, maxY: 1e9 }), [only]);
});
