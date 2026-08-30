import assert from 'node:assert/strict';
import test from 'node:test';

import {
  layoutIssue,
  throwDiagnosticProblems,
} from '../renderers/shared/diagnostics.mjs';
import {
  maximumReadableViewBoxWidth,
} from '../renderers/shared/desktop-readability.mjs';
import {
  relationshipLabelContainmentIssues,
} from '../renderers/shared/viewbox-containment.mjs';

test('layout diagnostics preserve structured evidence while accepting legacy strings', () => {
  const structured = layoutIssue({
    code: 'layout/exact-control',
    message: 'Move the selected label into its resolved corridor.',
    subject: { path: '/connections/2/labelAt', id: 'selected' },
    evidence: { allowedX: [40, 320], currentX: 338 },
    supportedFixes: ['set /connections/2/labelAt[0] to 320'],
  });

  assert.throws(
    () => throwDiagnosticProblems(
      'Architecture layout validation failed',
      ['Legacy layout problem.', structured],
      { subject: { diagramType: 'architecture' } },
    ),
    (error) => {
      assert.match(error.message, /Legacy layout problem/);
      assert.match(error.message, /Move the selected label/);
      assert.deepEqual(error.archifyDiagnostics, [
        {
          code: 'layout/constraint',
          severity: 'error',
          message: 'Legacy layout problem.',
          subject: { diagramType: 'architecture' },
          evidence: {},
          supportedFixes: [],
        },
        {
          code: 'layout/exact-control',
          severity: 'error',
          message: 'Move the selected label into its resolved corridor.',
          subject: {
            diagramType: 'architecture',
            path: '/connections/2/labelAt',
            id: 'selected',
          },
          evidence: { allowedX: [40, 320], currentX: 338 },
          supportedFixes: ['set /connections/2/labelAt[0] to 320'],
        },
      ]);
      return true;
    },
  );
});

test('maximum readable viewBox width is the exact inverse of the projection gate', () => {
  assert.equal(maximumReadableViewBoxWidth(8.1), 1255.5);
  assert.equal(maximumReadableViewBoxWidth(6), 930);
  assert.equal(maximumReadableViewBoxWidth(5.9), null);
  assert.equal(maximumReadableViewBoxWidth(Number.NaN), null);
});

test('relationship label containment reports exact movement bounds and JSON subject', () => {
  const issues = relationshipLabelContainmentIssues({
    diagramType: 'architecture',
    relationCollection: 'connections',
    viewBox: [400, 240],
    labels: [{
      relation: { id: 'outbound', from: 'api', to: 'queue' },
      relationIndex: 3,
      label: 'publish event',
      x: 370,
      y: 80,
      width: 54,
      height: 14,
      lx: 397,
      ly: 90,
    }],
  });

  assert.equal(issues.length, 1);
  assert.equal(issues[0].code, 'composition/relationship-label-containment');
  assert.deepEqual(issues[0].subject, {
    diagramType: 'architecture',
    path: '/connections/3/labelAt',
    id: 'outbound',
  });
  assert.deepEqual(issues[0].evidence.overflow, {
    left: 0,
    top: 0,
    right: 24,
    bottom: 0,
  });
  assert.deepEqual(issues[0].evidence.allowedLabelAt, {
    minX: 27,
    maxX: 373,
    minY: 10,
    maxY: 236,
  });
  assert.deepEqual(issues[0].evidence.allowedTranslation, {
    minDx: -370,
    maxDx: -24,
    minDy: -80,
    maxDy: 146,
  });
  assert.deepEqual(issues[0].supportedFixes, [
    'set /connections/3/labelAt inside x 27..373 and y 10..236',
  ]);
});

test('an oversized relationship label never reports an impossible movement interval', () => {
  const issues = relationshipLabelContainmentIssues({
    diagramType: 'workflow',
    relationCollection: 'edges',
    viewBox: [720, 420],
    labels: [{
      relation: { id: 'oversized', from: 'source', to: 'target', label: 'wide label' },
      relationIndex: 0,
      label: 'wide label',
      x: -29,
      y: 80,
      width: 778,
      height: 14,
      lx: 360,
      ly: 90,
    }],
  });

  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].subject, {
    diagramType: 'workflow',
    path: '/edges/0/label',
    id: 'oversized',
  });
  assert.equal(issues[0].evidence.allowedLabelAt, undefined);
  assert.deepEqual(issues[0].evidence.translationFeasible, { x: false, y: true });
  assert.deepEqual(issues[0].evidence.allowedTranslation, { minDy: -80, maxDy: 326 });
  assert.deepEqual(issues[0].evidence.minimumViewBox, { width: 778, height: 14 });
  assert.match(issues[0].supportedFixes.join('\n'), /shorten \/edges\/0\/label/);
  assert.match(issues[0].supportedFixes.join('\n'), /increase \/meta\/viewBox\/0 to at least 778px/);
  assert.doesNotMatch(issues[0].supportedFixes.join('\n'), /\d+\.\.\d+/);
});
