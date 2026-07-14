import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridLayout, resolveComponentPos, validateGridPlacement } from '../renderers/architecture/grid.mjs';

test('gridLayout returns null for free placement', () => {
  assert.equal(gridLayout({}), null);
  assert.equal(gridLayout({ layout: undefined }), null);
});

test('resolveComponentPos prefers explicit pos over row/col', () => {
  const grid = gridLayout({ layout: { mode: 'grid' } });
  assert.deepEqual(resolveComponentPos({ pos: [9, 8], row: 0, col: 0 }, grid), [9, 8]);
});

test('resolveComponentPos maps row/col to pixel origin', () => {
  const grid = gridLayout({
    layout: { mode: 'grid', origin: [40, 80], gapX: 30, gapY: 40, cellW: 130, cellH: 64 },
  });
  assert.deepEqual(resolveComponentPos({ row: 0, col: 0 }, grid), [40, 80]);
  assert.deepEqual(resolveComponentPos({ row: 1, col: 2 }, grid), [40 + 2 * 160, 80 + 104]);
});

test('validateGridPlacement rejects duplicate cells and missing row/col', () => {
  const grid = gridLayout({ layout: { mode: 'grid', cols: 4 } });
  const problems = [];
  validateGridPlacement({
    components: [
      { id: 'a', row: 0, col: 0 },
      { id: 'b', row: 0, col: 0 },
      { id: 'c' },
    ],
  }, grid, problems);
  assert.ok(problems.some((p) => p.includes('share grid cell')));
  assert.ok(problems.some((p) => p.includes('"c" needs pos')));
});

test('validateGridPlacement ignores explicit pos overrides without row/col', () => {
  const grid = gridLayout({ layout: { mode: 'grid', cols: 4 } });
  const problems = [];
  validateGridPlacement({
    components: [
      { id: 'a', pos: [40, 80] },
      { id: 'b', pos: [200, 80] },
    ],
  }, grid, problems);
  assert.deepEqual(problems, []);
});
