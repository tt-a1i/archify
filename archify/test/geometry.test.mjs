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
  segmentRectClearance,
  segmentRectIntersectionLength,
  collectLabelRouteClearance,
  cleanFlowProblems,
  cleanCrossingProblems,
  collectAmbiguousCorridors,
  cleanAmbiguousCorridorProblems,
  collectBorderRuns,
  cleanBorderRunProblems,
  collectRouteRhythmIssues,
  cleanRouteRhythmProblems,
  routeBudgetMetrics,
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
import { textUnits, applyTemplate, renderSemanticSigil } from '../renderers/shared/utils.mjs';

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

test('segmentRectClearance measures horizontal, vertical, and reversed diagonal segments', () => {
  const box = rect(10, 10, 10, 10);
  assert.equal(segmentRectClearance({ start: [0, 6], end: [30, 6] }, box), 4);
  assert.equal(segmentRectClearance({ start: [6, 0], end: [6, 30] }, box), 4);
  assert.equal(segmentRectClearance({ start: [0, 0], end: [8, 8] }, box), Math.sqrt(8));
  assert.equal(segmentRectClearance({ start: [8, 8], end: [0, 0] }, box), Math.sqrt(8));
  assert.equal(segmentRectClearance({ start: [0, 15], end: [30, 15] }, box), 0);
});

test('label-route clearance locks tangent, sub-threshold, boundary, and reversed coordinates', () => {
  const box = rect(10, 10, 10, 10);
  const cases = [
    { segment: { start: [0, 10], end: [30, 10] }, clearance: 0, intersection: 10 },
    { segment: { start: [10, 0], end: [10, 30] }, clearance: 0, intersection: 10 },
    { segment: { start: [0, 0], end: [30, 30] }, clearance: 0, intersection: Math.sqrt(200) },
    { segment: { start: [0, 0], end: [10, 10] }, clearance: 0, intersection: 0 },
    { segment: { start: [0, 8.1], end: [30, 8.1] }, clearance: 1.9, intersection: 0 },
    { segment: { start: [0, 8], end: [30, 8] }, clearance: 2, intersection: 0 },
    { segment: { start: [0, 6.1], end: [30, 6.1] }, clearance: 3.9, intersection: 0 },
    { segment: { start: [0, 6], end: [30, 6] }, clearance: 4, intersection: 0 },
    { segment: { start: [0, 0], end: [5, 0] }, clearance: Math.sqrt(125), intersection: 0 },
  ];
  for (const { segment, clearance, intersection } of cases) {
    assert.ok(Math.abs(segmentRectClearance(segment, box) - clearance) < 0.000001);
    assert.ok(Math.abs(segmentRectIntersectionLength(segment, box) - intersection) < 0.000001);
    const reversed = { start: segment.end, end: segment.start };
    assert.ok(Math.abs(segmentRectClearance(reversed, box) - clearance) < 0.000001);
    assert.ok(Math.abs(segmentRectIntersectionLength(reversed, box) - intersection) < 0.000001);
  }
});

test('collectLabelRouteClearance exempts only the owning relationship at an exact threshold', () => {
  const owner = { id: 'owner', from: 'a', to: 'b' };
  const sharedSource = { id: 'other', from: 'a', to: 'c' };
  const labels = [{ relation: owner, relationIndex: 0, label: 'handoff', ...rect(80, 48, 60, 14) }];
  const routedRelations = [
    { relation: owner, relationIndex: 0, points: [[20, 60], [200, 60]] },
    { relation: sharedSource, relationIndex: 1, points: [[70, 64], [150, 64]] },
  ];
  assert.deepEqual(collectLabelRouteClearance({ labels, routedRelations, threshold: 2 }), []);
  const hits = collectLabelRouteClearance({ labels, routedRelations, threshold: 4 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].clearance, 2);
  assert.equal(hits[0].otherRelation, sharedSource);
});

test('cleanFlowProblems reports collection index, ids, segment, clearance, and fix', () => {
  const relations = [{ id: 'checkout', from: 'client', to: 'database' }];
  const obstacles = [
    { id: 'client', ...rect(0, 0, 20, 20) },
    { id: 'proxy', ...rect(40, 0, 20, 20) },
    { id: 'database', ...rect(80, 0, 20, 20) },
  ];
  const problems = cleanFlowProblems({
    relations,
    obstacles,
    pathFor: () => ({ points: [[20, 10], [80, 10]] }),
    diagramType: 'architecture',
    relationCollection: 'connections',
    obstacleKind: 'component',
    routeHint: 'set route/via'
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /\[clean-flow\/edge-through-node\] architecture connections\[0\] id "checkout" "client" -> "database"/);
  assert.match(problems[0], /crosses component "proxy"/);
  assert.match(problems[0], /segment 0 \[20, 10\] -> \[80, 10\] \(2px clearance\)/);
  assert.match(problems[0], /set route\/via/);
});

test('cleanFlowProblems exempts endpoints and ignores missing endpoint geometry', () => {
  const endpointOnly = cleanFlowProblems({
    relations: [{ from: 'a', to: 'b' }],
    obstacles: [{ id: 'a', ...rect(0, 0, 20, 20) }, { id: 'b', ...rect(80, 0, 20, 20) }],
    pathFor: () => ({ points: [[20, 10], [80, 10]] }),
    diagramType: 'workflow',
    relationCollection: 'edges',
    obstacleKind: 'node',
    profile: 'standard'
  });
  assert.deepEqual(endpointOnly, []);

  let pathCalled = false;
  const missingEndpoint = cleanFlowProblems({
    relations: [{ from: 'a', to: 'ghost' }],
    obstacles: [{ id: 'a', ...rect(0, 0, 20, 20) }],
    pathFor: () => { pathCalled = true; return { points: [] }; },
    diagramType: 'workflow',
    relationCollection: 'edges',
    obstacleKind: 'node'
  });
  assert.deepEqual(missingEndpoint, []);
  assert.equal(pathCalled, false);
});

test('cleanFlowProblems uses clearance, reports the first segment, and deduplicates an obstacle', () => {
  const problems = cleanFlowProblems({
    relations: [{ from: 'a', to: 'b' }],
    obstacles: [
      { id: 'a', ...rect(-20, -10, 20, 20) },
      { id: 'near', ...rect(8, 1, 4, 2) },
      { id: 'b', ...rect(20, -10, 20, 20) },
    ],
    // Both segment 0 (within the 2px halo) and segment 2 intersect `near`.
    pathFor: () => ({ points: [[0, -1], [20, -1], [0, 5], [20, 5]] }),
    diagramType: 'workflow',
    relationCollection: 'edges',
    obstacleKind: 'node',
    profile: 'standard'
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /segment 0 \[0, -1\] -> \[20, -1\]/);
});

test('cleanCrossingProblems reports one deterministic proper X in showcase', () => {
  const first = { id: 'first', from: 'a', to: 'b' };
  const second = { id: 'second', from: 'c', to: 'd' };
  const routes = new Map([
    [first, { points: [[0, 0], [100, 0], [100, 100]] }],
    [second, { points: [[50, -50], [50, 50], [150, 50], [150, -50], [50, -50]] }],
  ]);
  const problems = cleanCrossingProblems({
    relations: [first, second],
    endpointIds: new Set(['a', 'b', 'c', 'd']),
    pathFor: (relation) => routes.get(relation),
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: 'showcase',
    routeHint: 'move a via point',
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /\[composition\/proper-crossing\] showcase architecture/);
  assert.match(problems[0], /connections\[0\] id "first" "a" -> "b" crosses connections\[1\] id "second" "c" -> "d"/);
  assert.match(problems[0], /at \[50, 0\] \(segments 0 and 0\)/);
  assert.match(problems[0], /move a via point/);
});

test('cleanCrossingProblems keeps proper X as non-blocking in standard', () => {
  const relations = [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }];
  const routes = [[[0, 50], [100, 50]], [[50, 0], [50, 100]]];
  const problems = cleanCrossingProblems({
    relations,
    endpointIds: new Set(['a', 'b', 'c', 'd']),
    pathFor: (relation) => ({ points: routes[relations.indexOf(relation)] }),
    diagramType: 'workflow',
    relationCollection: 'edges',
    profile: 'standard',
  });
  assert.deepEqual(problems, []);
});

test('cleanCrossingProblems exempts shared endpoints', () => {
  const relations = [{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }];
  const routes = [[[0, 50], [100, 50]], [[50, 0], [50, 100]]];
  const problems = cleanCrossingProblems({
    relations,
    endpointIds: new Set(['a', 'b', 'c']),
    pathFor: (relation) => ({ points: routes[relations.indexOf(relation)] }),
    diagramType: 'dataflow',
    relationCollection: 'flows',
    profile: 'showcase',
  });
  assert.deepEqual(problems, []);
});

test('cleanCrossingProblems exempts endpoint touches and collinear corridors', () => {
  const relations = [
    { from: 'a', to: 'b' },
    { from: 'c', to: 'd' },
    { from: 'e', to: 'f' },
  ];
  const routes = [
    [[0, 0], [100, 0]],
    [[50, 0], [50, 50]],
    [[25, 0], [75, 0]],
  ];
  const problems = cleanCrossingProblems({
    relations,
    endpointIds: new Set(['a', 'b', 'c', 'd', 'e', 'f']),
    pathFor: (relation) => ({ points: routes[relations.indexOf(relation)] }),
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
    profile: 'showcase',
  });
  assert.deepEqual(problems, []);
});

test('ambiguous corridor gate reports unrelated collinear overlap with exact identities', () => {
  const first = { id: 'first', from: 'a', to: 'b' };
  const second = { id: 'second', from: 'c', to: 'd' };
  const routes = new Map([
    [first, { points: [[0, 20], [100, 20], [100, 80]] }],
    [second, { points: [[40, 20], [140, 20], [140, 80]] }],
  ]);
  const hits = collectAmbiguousCorridors({
    routedRelations: [first, second].map((relation, relationIndex) => ({
      relation,
      relationIndex,
      points: routes.get(relation).points,
    })),
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].overlapLength, 60);
  assert.deepEqual(hits[0].overlapStart, [40, 20]);
  assert.deepEqual(hits[0].overlapEnd, [100, 20]);

  const problems = cleanAmbiguousCorridorProblems({
    relations: [first, second],
    endpointIds: new Set(['a', 'b', 'c', 'd']),
    pathFor: (relation) => routes.get(relation),
    diagramType: 'workflow',
    relationCollection: 'edges',
    profile: 'showcase',
    routeHint: 'move a channel',
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /\[composition\/ambiguous-corridor\] showcase workflow/);
  assert.match(problems[0], /edges\[0\] id "first" "a" -> "b" shares a 60px corridor with edges\[1\] id "second" "c" -> "d"/);
  assert.match(problems[0], /\[40, 20\] -> \[100, 20\].*move a channel/);
});

test('ambiguous corridor gate exempts shared endpoints, point touches, and overlaps below 8px', () => {
  const routedRelations = [
    { relation: { from: 'a', to: 'b' }, relationIndex: 0, points: [[0, 20], [100, 20]] },
    { relation: { from: 'a', to: 'c' }, relationIndex: 1, points: [[40, 20], [140, 20]] },
    { relation: { from: 'd', to: 'e' }, relationIndex: 2, points: [[100, 20], [100, 80]] },
    { relation: { from: 'f', to: 'g' }, relationIndex: 3, points: [[94, 60], [101, 60]] },
    { relation: { from: 'h', to: 'i' }, relationIndex: 4, points: [[98, 60], [110, 60]] },
  ];
  assert.deepEqual(collectAmbiguousCorridors({ routedRelations }), []);
});

test('ambiguous corridor gate keeps standard renderable', () => {
  const relations = [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }];
  const routes = [[[0, 20], [100, 20]], [[40, 20], [140, 20]]];
  assert.deepEqual(cleanAmbiguousCorridorProblems({
    relations,
    endpointIds: new Set(['a', 'b', 'c', 'd']),
    pathFor: (relation) => ({ points: routes[relations.indexOf(relation)] }),
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: 'standard',
  }), []);
});

test('cleanBorderRunProblems reports a deterministic long run on a rounded frame side', () => {
  const relation = { id: 'jwt', from: 'auth', to: 'api' };
  const problems = cleanBorderRunProblems({
    relations: [relation],
    frames: [{ id: 'private', label: 'Private tier', kind: 'security-group', x: 100, y: 80, width: 180, height: 120, radius: 8 }],
    pathFor: () => ({ points: [[40, 80], [220, 80], [220, 140]] }),
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: 'standard',
    routeHint: 'move the via point',
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /\[composition\/container-border-run\] architecture connections\[0\] id "jwt" "auth" -> "api"/);
  assert.match(problems[0], /follows security-group "Private tier" top border for 112px on segment 0 \[108, 80\] -> \[220, 80\]/);
  assert.match(problems[0], /move the via point/);
});

test('border-run contract allows perpendicular crossings, point touches, and rounded corners', () => {
  const frame = { id: 'stage', kind: 'stage', x: 40, y: 40, width: 120, height: 100, radius: 10 };
  const routedRelations = [
    { relation: { from: 'a', to: 'b' }, relationIndex: 0, points: [[100, 10], [100, 80]] },
    { relation: { from: 'c', to: 'd' }, relationIndex: 1, points: [[20, 40], [40, 40], [40, 20]] },
    { relation: { from: 'e', to: 'f' }, relationIndex: 2, points: [[40, 40], [49, 40]] },
  ];
  assert.deepEqual(collectBorderRuns({ routedRelations, frames: [frame] }), []);
});

test('border-run contract detects vertical frames and merges hits per relation side', () => {
  const hits = collectBorderRuns({
    routedRelations: [{
      relation: { from: 'a', to: 'b' },
      relationIndex: 3,
      points: [[160, 60], [160, 110], [150, 110], [160, 110], [160, 135]],
    }],
    frames: [{ kind: 'lane', id: 'lane-1', x: 40, y: 40, width: 120, height: 100, radius: 10 }],
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].side, 'right');
  assert.equal(hits[0].segmentIndex, 0);
  assert.equal(hits[0].overlapLength, 70);
});

test('border-run contract merges adjacent primitives and counts any positive straight overlap', () => {
  const hits = collectBorderRuns({
    routedRelations: [{
      relation: { from: 'a', to: 'b' },
      relationIndex: 0,
      points: [[52, 40], [70, 40], [90, 40], [90, 50]],
    }],
    frames: [{ kind: 'stage', id: 'source', x: 40, y: 40, width: 120, height: 100, radius: 10 }],
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].overlapLength, 38);
  assert.deepEqual(hits[0].overlapStart, [52, 40]);
  assert.deepEqual(hits[0].overlapEnd, [90, 40]);
});

test('routeBudgetMetrics normalizes collinear points and records neutral route evidence', () => {
  const metrics = routeBudgetMetrics({
    routedRelations: [
      { points: [[0, 0], [10, 0], [30, 0], [30, 8], [50, 8], [50, 30]] },
      { points: [[5, 5], [5, 5]] },
    ],
  });
  assert.deepEqual(metrics, {
    maxBends: 3,
    routesOverSuggestedBends: 1,
    maxStretch: 80 / 80,
    routesOverSuggestedStretch: 0,
    minSegmentPx: 8,
    minInteriorSegmentPx: 8,
    shortSegmentCount: 1,
    shortEndpointSegmentCount: 0,
    shortInteriorSegmentCount: 1,
    microSegmentCount: 0,
  });
});

test('route rhythm separates ordinary endpoint stubs from cramped turns and micro segments', () => {
  const issues = collectRouteRhythmIssues({
    routedRelations: [
      { relation: { id: 'lane-hop', from: 'a', to: 'b' }, points: [[0, 0], [13, 0], [13, 40], [80, 40], [80, 53]] },
      { relation: { id: 'bad-turn', from: 'c', to: 'd' }, points: [[0, 80], [24, 80], [24, 89], [60, 89]] },
      { relation: { id: 'micro-stub', from: 'e', to: 'f' }, points: [[0, 120], [5, 120], [5, 180]] },
    ],
  });
  assert.deepEqual(issues.map((issue) => [issue.relation.id, issue.code, issue.position, issue.length]), [
    ['bad-turn', 'composition/short-interior-segment', 'interior', 9],
    ['micro-stub', 'composition/micro-segment', 'source-stub', 5],
  ]);
});

test('route rhythm is a showcase-only generation gate with actionable relationship identity', () => {
  const relations = [{ id: 'events', from: 'api', to: 'bus' }];
  const args = {
    relations,
    endpointIds: new Set(['api', 'bus']),
    pathFor: () => ({ points: [[10, 20], [15, 20], [15, 80]] }),
    diagramType: 'architecture',
    relationCollection: 'connections',
  };
  assert.deepEqual(cleanRouteRhythmProblems({ ...args, profile: 'standard' }), []);
  const problems = cleanRouteRhythmProblems({ ...args, profile: 'showcase' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /\[composition\/micro-segment\] showcase architecture connections\[0\] id "events"/);
  assert.match(problems[0], /5px source-stub segment 0/);
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

test('textUnits: ASCII=1, CJK=2, mixed sums, fullwidth supplementary=2', () => {
  assert.equal(textUnits('abc'), 3);
  assert.equal(textUnits('中文'), 4);
  assert.equal(textUnits('a中'), 3);
  assert.equal(textUnits(''), 0);
  assert.equal(textUnits(null), 0);
  assert.equal(textUnits('𠀀'), 2); // CJK Ext-B (supplementary plane)
  assert.equal(textUnits('🚀'), 2); // emoji
  assert.equal(textUnits('注入提示词'), 10); // issue #14 original label
  assert.equal(textUnits('！＠＃０１２'), 12); // fullwidth punctuation + digits
});

test('textUnits follows wide and halfwidth East Asian presentation boundaries', () => {
  assert.equal(textUnits('あカ'), 4); // Hiragana + Katakana are wide
  assert.equal(textUnits('ㄅㆠ'), 4); // Bopomofo + extended Bopomofo are wide
  assert.equal(textUnits('ㄱ'), 2); // Hangul compatibility letter is wide
  assert.equal(textUnits('︐︙'), 4); // vertical punctuation forms are wide
  assert.equal(textUnits('ｶﾀｶﾅ'), 4); // halfwidth Katakana stays one unit per glyph
});

test('semantic sigils cover every component and lifecycle kind without literal color', () => {
  const kinds = [
    'frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external',
    'start', 'active', 'waiting', 'success', 'failure', 'neutral',
  ];
  for (const kind of kinds) {
    const sigil = renderSemanticSigil(kind, { x: 12, y: 18 });
    assert.match(sigil, new RegExp(`data-semantic-sigil="${kind}"`), kind);
    assert.match(sigil, /aria-hidden="true"/, kind);
    assert.match(sigil, /class="semantic-sigil s-[a-z]+"/, kind);
    assert.match(sigil, /transform="translate\(12 18\) scale\(0\.6875\)"/, kind);
    assert.doesNotMatch(sigil, /#[0-9a-f]{3,8}|rgba?\(/i, kind);
  }
});

test('unknown semantic sigils fail closed to a neutral role stamp', () => {
  const sigil = renderSemanticSigil('vendor-logo', { x: 0, y: 0, size: 16 });
  assert.match(sigil, /data-semantic-sigil="neutral"/);
  assert.match(sigil, /class="semantic-sigil s-external"/);
  assert.match(sigil, /scale\(1\)/);
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
  const template = `<html lang="en" data-theme="dark" data-preset="[VISUAL PRESET]">
<title>[PROJECT NAME] Architecture Diagram</title>
<h1>[PROJECT NAME] Architecture</h1>
<p class="subtitle">[Subtitle description]</p>
<!-- ARCHIFY:GUIDED_VIEWS_DATA -->
    <!-- ARCHIFY:SOURCE_CAPSULE_DATA -->
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
