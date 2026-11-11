import assert from 'node:assert/strict';
import test from 'node:test';
import { fittedNodeFontSize, minimumNodeTextWidth } from '../archify/renderers/shared/text-fit.mjs';

test('text fitting never trades the declared readable floor for an impossible width', () => {
  const label = 'a'.repeat(100);
  assert.equal(fittedNodeFontSize(label, 200, 11, 7), 7);
  assert.equal(minimumNodeTextWidth(label, 7), 420, 'validator must still see that the 192px available width is insufficient');
  assert.equal(fittedNodeFontSize('abc', 200, 11, 7), 11, 'short labels keep their preferred font');
  const rescued = fittedNodeFontSize('a'.repeat(20), 120, 11, 7);
  assert.ok(rescued >= 7 && rescued < 11);
  assert.ok(20 * rescued * 0.6 <= 112, 'a rescuable label fits after the documented 8px padding');
  assert.equal(fittedNodeFontSize('漢'.repeat(50), 200, 11, 7), 7, 'wide glyphs use the same readable floor');
});
