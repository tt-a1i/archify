import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Supplement the native keyboard regression with deterministic scroll geometry.
// The chapter strip and offsetParent need not share an origin in the grid shell.
const source = fs.readFileSync(new URL('../../viewer/guided-views.js', import.meta.url), 'utf8');
const fn = source.match(/      function centerChapterButton\(button\) \{[\s\S]*?\n      \}/)?.[0];
assert.ok(fn);

test('chapter centering uses the visible strip coordinates despite an unrelated offsetParent', () => {
  for (const { left, scroll, expected } of [
    { left: 720.671875, scroll: 6, expected: 3.171875 },
    { left: 100, scroll: 0, expected: 0 },
    { left: 1450, scroll: 0, expected: 6 },
  ]) {
    const strip = { clientWidth: 1399, clientLeft: 0, scrollLeft: scroll,
      getBoundingClientRect: () => ({ left: 100 }),
      scrollTo({ left }) { this.scrollLeft = Math.max(0, Math.min(6, left)); } };
    const button = { offsetLeft: 727, offsetWidth: 152,
      getBoundingClientRect: () => ({ left, width: 152 }) };
    const context = { chapterList: strip, button };
    vm.runInNewContext(fn + '\ncenterChapterButton(button)', context);
    assert.ok(Math.abs(strip.scrollLeft - expected) < 0.01,
      JSON.stringify({ left, before: scroll, expected, actual: strip.scrollLeft }));
  }
});
