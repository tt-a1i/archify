import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeFixedWidthOverflow,
  predictedFixedWidthOverflow,
} from '../renderers/shared/desktop-readability.mjs';

test('fixed-width overflow projection retains authored dimensions for actionable guidance', () => {
  const issue = predictedFixedWidthOverflow({
    viewBoxWidth: 980,
    viewBoxHeight: 660,
    readerFit: null,
    diagramType: 'lifecycle',
  });

  assert.ok(issue, '980x660 is a certain first-screen overflow at the desktop reference viewport');
  assert.equal(issue.viewBoxWidth, 980);
  assert.equal(issue.viewBoxHeight, 660);
  assert.equal(issue.svgWidthPx, 1346);
  assert.equal(issue.svgHeightPx, 906);
  assert.equal(issue.pageHeightPx, 1032);
  assert.equal(issue.overflowPx, 132);

  const guidance = describeFixedWidthOverflow(issue);
  assert.match(guidance, /980x660 canvas/);
  assert.match(guidance, /meta\.viewBox height is at most 632/);
  assert.match(guidance, /width is at least 1023/);
  assert.doesNotMatch(guidance, /undefined/);
});

test('fixed-width overflow projection stays silent when Reader can accept intrinsic height', () => {
  assert.equal(predictedFixedWidthOverflow({
    viewBoxWidth: 980,
    viewBoxHeight: 660,
    readerFit: 'intrinsic-height',
    diagramType: 'lifecycle',
  }), null);
});
