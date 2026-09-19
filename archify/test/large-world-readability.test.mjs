import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LARGE_WORLD_READABILITY_CONTRACT,
  deriveLargeWorldReadability,
  minimumReadableSourceTextPx,
  projectedNodeTextPx,
} from '../renderers/shared/desktop-readability.mjs';

function derive(sourceFont) {
  return deriveLargeWorldReadability({
    safeStageWidth: 1000,
    safeStageHeight: 500,
    canonicalWorldWidth: 1000,
    canonicalWorldHeight: 500,
    minimumTargetSourceFontWorldUnits: sourceFont,
    targetBoundsWidth: 100,
    targetBoundsHeight: 50,
  });
}

test('large-world profile compares the unrounded 5.99/6.00/6.01 boundary', () => {
  assert.equal(derive(5.99).worldProfile, 'large');
  assert.equal(derive(6).worldProfile, 'small');
  assert.equal(derive(6.01).worldProfile, 'small');
});

test('large-world scale contract preserves units, padding, and finite dynamic cap', () => {
  const result = deriveLargeWorldReadability({
    safeStageWidth: 1000,
    safeStageHeight: 500,
    canonicalWorldWidth: 10000,
    canonicalWorldHeight: 5000,
    minimumTargetSourceFontWorldUnits: 12,
    targetBoundsWidth: 100,
    targetBoundsHeight: 60,
  });
  assert.equal(result.worldScaleFit, 0.1);
  assert.ok(Math.abs(result.projectedTextPx - 1.2) < 1e-12);
  assert.equal(result.requiredReadableScale, 0.5);
  assert.equal(result.maximumWorldToCssScale, 3.2);
  assert.equal(result.cameraMultiplier, 5);
  assert.equal(result.targetReadableAndContained, true);
  assert.equal(LARGE_WORLD_READABILITY_CONTRACT.targetPaddingCssPx, 24);
});

test('legacy desktop readability helpers keep their signatures and results', () => {
  assert.equal(projectedNodeTextPx(12, 1860), 6);
  assert.equal(minimumReadableSourceTextPx(1860), 12);
});

test('invalid large-world measurements fail closed', () => {
  assert.equal(deriveLargeWorldReadability({}), null);
  assert.equal(deriveLargeWorldReadability({
    safeStageWidth: 100,
    safeStageHeight: 100,
    canonicalWorldWidth: 0,
    canonicalWorldHeight: 100,
    minimumTargetSourceFontWorldUnits: 12,
    targetBoundsWidth: 10,
    targetBoundsHeight: 10,
  }), null);
});
