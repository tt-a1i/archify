import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animateAttr } from '../archify/renderers/shared/cli.mjs';

test('trace animation delay stays finite, ordered and within the existing waiting budget', () => {
  for (const kind of ['edge', 'node']) {
    const steps = [0, 1, 8, 99].map((index) => {
      const attributes = animateAttr({ animation: 'trace' }, kind, index);
      assert.match(attributes, new RegExp(`data-animate="${kind}"`));
      const step = Number(attributes.match(/--step:\s*([^";\s]+)/)?.[1]);
      assert.ok(Number.isFinite(step) && step >= 0, `${kind}: finite non-negative delay`);
      assert.ok(step <= Math.min(index, 12), `${kind}: delay must not exceed the waiting budget`);
      return step;
    });
    assert.ok(steps.every((step, index) => index === 0 || step >= steps[index - 1]), `${kind}: authored order`);
    assert.equal(animateAttr({}, kind, 99), animateAttr({ animation: 'trace' }, kind, 99));
  }
});
