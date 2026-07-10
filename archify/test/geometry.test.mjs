// Unit tests for the pure geometry/text helpers that every renderer leans on.
// These are exercised only transitively by the golden byte-compares, which
// can't distinguish a geometry regression from an intentional layout change —
// so they get a direct oracle here. Zero deps: node:test + node:assert.
//
//   node --test test/*.test.mjs   (or: npm test)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  rectsOverlap,
  segmentIntersectsRect,
  asArray,
  isFinitePoint,
  anchor,
  defaultFromSide,
  defaultToSide,
  chosenSide,
  polylinePath,
  roundedPath,
  labelPoint,
  suggestLabelObstacleFix,
  suggestComponentSeparation,
} from '../renderers/shared/geometry.mjs';
import { textUnits, applyTemplate } from '../renderers/shared/utils.mjs';

const rect = (x, y, w, h) => ({ x, y, width: w, height: h, cx: x + w / 2, cy: y + h / 2 });

test('rectsOverlap: separated rects do not overlap', () => {
  assert.equal(rectsOverlap(rect(0, 0, 10, 10), rect(20, 0, 10, 10)), false);
});

test('rectsOverlap: clearly overlapping rects overlap', () => {
  assert.equal(rectsOverlap(rect(0, 0, 10, 10), rect(5, 5, 10, 10)), true);
});

test('rectsOverlap: edge-touching is NOT overlap at gap 0 (<= boundary)', () => {
  // a ends at x=10, b starts at x=10 — exactly touching.
  assert.equal(rectsOverlap(rect(0, 0, 10, 10), rect(10, 0, 10, 10), 0), false);
});

test('rectsOverlap: positive gap flags rects within that gap as too close', () => {
  // 8px apart, required gap 8 → touching the threshold counts as too close.
  assert.equal(rectsOverlap(rect(0, 0, 10, 10), rect(18, 0, 10, 10), 8), false);
  assert.equal(rectsOverlap(rect(0, 0, 10, 10), rect(17, 0, 10, 10), 8), true);
});

test('rectsOverlap: negative gap shrinks the hit box (label-collision convention)', () => {
  // gap -2 means rects must overlap by MORE than 2px to count — a 1px sliver
  // does not. This is the sign convention the label checks rely on.
  assert.equal(rectsOverlap(rect(0, 0, 10, 10), rect(9, 0, 10, 10), -2), false);
  assert.equal(rectsOverlap(rect(0, 0, 10, 10), rect(7, 0, 10, 10), -2), true);
});

test('segmentIntersectsRect: detects an edge crossing a node box', () => {
  assert.equal(segmentIntersectsRect({ start: [0, 5], end: [20, 5] }, rect(8, 0, 4, 10)), true);
  assert.equal(segmentIntersectsRect({ start: [0, 20], end: [20, 20] }, rect(8, 0, 4, 10)), false);
});

test('asArray coerces non-arrays to [] (degraded-mode guard)', () => {
  assert.deepEqual(asArray([1, 2]), [1, 2]);
  assert.deepEqual(asArray('oops'), []);
  assert.deepEqual(asArray(undefined), []);
  assert.deepEqual(asArray(null), []);
  assert.deepEqual(asArray({ length: 3 }), []);
});

test('isFinitePoint rejects NaN/undefined/Infinity', () => {
  assert.equal(isFinitePoint(1, 2, 3, 4), true);
  assert.equal(isFinitePoint(1, NaN), false);
  assert.equal(isFinitePoint(1, undefined), false);
  assert.equal(isFinitePoint(1, Infinity), false);
});

test('anchor returns the correct edge midpoint for each side', () => {
  const r = rect(100, 100, 40, 20); // cx=120 cy=110
  assert.deepEqual(anchor(r, 'left'), [100, 110]);
  assert.deepEqual(anchor(r, 'right'), [140, 110]);
  assert.deepEqual(anchor(r, 'top'), [120, 100]);
  assert.deepEqual(anchor(r, 'bottom'), [120, 120]);
});

test('anchor falls back to the right edge for unknown/auto sides', () => {
  const r = rect(100, 100, 40, 20);
  assert.deepEqual(anchor(r, 'auto'), [140, 110]);
  assert.deepEqual(anchor(r, undefined), [140, 110]);
});

test('defaultFromSide / defaultToSide are mirror pairs', () => {
  const a = { cx: 0, cy: 0 };
  const right = { cx: 100, cy: 0 };
  assert.equal(defaultFromSide(a, right), 'right');
  assert.equal(defaultToSide(a, right), 'left');
  const below = { cx: 0, cy: 100 };
  assert.equal(defaultFromSide(a, below), 'bottom');
  assert.equal(defaultToSide(a, below), 'top');
});

test('chosenSide treats explicit "auto" as "use the geometric fallback"', () => {
  assert.equal(chosenSide('left', 'right'), 'left');
  assert.equal(chosenSide('auto', 'right'), 'right');
  assert.equal(chosenSide(undefined, 'right'), 'right');
});

test('polylinePath emits M then L commands', () => {
  assert.equal(polylinePath([[0, 0], [10, 0], [10, 10]]), 'M 0 0 L 10 0 L 10 10');
});

test('roundedPath degrades to a polyline for <3 points or radius<=0', () => {
  assert.equal(roundedPath([[0, 0], [10, 0]], 10), 'M 0 0 L 10 0');
  assert.equal(roundedPath([[0, 0], [10, 0], [10, 10]], 0), 'M 0 0 L 10 0 L 10 10');
});

test('roundedPath inserts a quadratic corner and never emits NaN', () => {
  const d = roundedPath([[0, 0], [100, 0], [100, 100]], 10);
  assert.match(d, /Q 100 0/); // corner pivots on the bend point
  assert.doesNotMatch(d, /NaN/);
});

test('roundedPath clamps radius to half the shorter adjacent segment', () => {
  // 6px segments with radius 10 → r clamps to 3; no overshoot / NaN.
  const d = roundedPath([[0, 0], [6, 0], [6, 6]], 10);
  assert.doesNotMatch(d, /NaN/);
  assert.match(d, /^M 0 0/);
});

test('labelPoint: 2-point path is the midpoint lifted 10px, plus offsets', () => {
  assert.deepEqual(labelPoint({}, [[0, 100], [100, 100]]), [50, 90]);
  assert.deepEqual(labelPoint({ labelDx: 5, labelDy: -4 }, [[0, 100], [100, 100]]), [55, 86]);
});

test('labelPoint: labelSegment selects a segment and clamps to range', () => {
  const pts = [[0, 0], [100, 0], [100, 100], [200, 100]];
  // segment 0 → midpoint of pts[0],pts[1] = (50,0) lifted 10
  assert.deepEqual(labelPoint({ labelSegment: 0 }, pts), [50, -10]);
  // segment 99 clamps to the last segment
  assert.deepEqual(labelPoint({ labelSegment: 99 }, pts), [150, 90]);
});

test('labelPoint: explicit labelAt wins outright', () => {
  assert.deepEqual(labelPoint({ labelAt: [7, 8] }, [[0, 0], [100, 0]]), [7, 8]);
});

test('textUnits: ASCII, pure CJK, and mixed labels use expected widths', () => {
  assert.equal(textUnits('abc'), 3);
  assert.equal(textUnits('中文'), 4);
  assert.equal(textUnits('审批通过'), 8);
  assert.equal(textUnits('写入 API'), 8);
  assert.equal(textUnits(''), 0);
  assert.equal(textUnits(null), 0);
});

test('textUnits: fullwidth punctuation and supplementary CJK use two units', () => {
  assert.equal(textUnits('「写入」'), 8); // CJK punctuation
  assert.equal(textUnits('︐'), 2); // vertical comma (U+FE10)
  assert.equal(textUnits('Ａ'), 2); // fullwidth Latin
  assert.equal(textUnits('ｶﾅ'), 2); // halfwidth Katakana remains single-width
  assert.equal(textUnits('𠀀'), 2); // CJK Ext-B (supplementary plane)
  assert.equal(textUnits('𛀀'), 2); // Kana Supplement
  assert.equal(textUnits('𗀀'), 2); // Tangut
  assert.equal(textUnits('𛅰'), 2); // Nushu
  assert.equal(textUnits('𘬀'), 2); // Khitan Small Script
  assert.equal(textUnits('🚀'), 2); // emoji
});

test('suggestLabelObstacleFix includes rects and labelAt/labelDy hints', () => {
  const labelRect = { x: 100, y: 180, width: 48, height: 14, label: '写入' };
  const obstacle = { id: 'memtool', x: 30, y: 130, width: 230, height: 58 };
  const hint = suggestLabelObstacleFix(labelRect, 124, 188, obstacle);
  assert.match(hint, /label rect: \[100, 180, 48, 14\]/);
  assert.match(hint, /component "memtool"/);
  assert.match(hint, /Suggested fix: labelAt/);
  assert.match(hint, /labelDy \+\d+/);
});

test('suggestComponentSeparation proposes nudged pos', () => {
  const a = { id: 'api', x: 100, y: 200, width: 120, height: 60 };
  const b = { id: 'db', x: 150, y: 200, width: 120, height: 60 };
  const hint = suggestComponentSeparation(a, b, 8);
  assert.match(hint, /move "db" pos to \[228, 200\]/);
});

test('applyTemplate preserves dollar sequences in titles', () => {
  const template = `<title>[PROJECT NAME] Architecture Diagram</title>
<h1>[PROJECT NAME] Architecture</h1>
<p class="subtitle">[Subtitle description]</p>
      <!-- ARCHIFY:SVG_SLOT_START --><svg></svg>      <!-- ARCHIFY:SVG_SLOT_END -->
    <!-- ARCHIFY:CARDS_SLOT_START --><div></div>    <!-- ARCHIFY:CARDS_SLOT_END -->
[Project Name] &bull; [Additional metadata]`;
  const html = applyTemplate(template, {
    title: 'Plan $$50 tier',
    subtitle: 'test',
    footer: 'f',
    svg: '<svg/>',
    cards: '',
  });
  assert.match(html, /Plan \$\$50 tier/);
});
