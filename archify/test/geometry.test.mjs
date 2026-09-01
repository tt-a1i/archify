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
  cleanEndpointSideProblems,
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
  automaticPortRhythmBridge,
  defaultFromSide,
  defaultToSide,
  chosenSide,
  routeHonorsEndpointSides,
  polylinePath,
  roundedPath,
  labelPoint,
  suggestLabelObstacleFix,
  suggestComponentSeparation,
  cleanLabelCanvasContainmentProblems,
} from '../renderers/shared/geometry.mjs';
import { textUnits, applyTemplate, renderSemanticSigil } from '../renderers/shared/utils.mjs';

const rect = (x, y, w, h) => ({ x, y, width: w, height: h, cx: x + w / 2, cy: y + h / 2 });

test('automaticPortRhythmBridge: near parallel ports use readable outside runs', () => {
  const points = automaticPortRhythmBridge(
    [742, 300],
    [735, 180],
    'top',
    'bottom',
  );

  assert.deepEqual(points, [
    [742, 300],
    [742, 276],
    [758, 276],
    [758, 204],
    [735, 204],
    [735, 180],
  ]);
  assert.deepEqual(collectRouteRhythmIssues({
    routedRelations: [{ relation: { id: 'read' }, points }],
  }), []);
});

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

test('rectsOverlap: non-finite geometry is not an overlap', () => {
  // A component authored without pos lands here as NaN. Every comparison in the
  // negated form is false for NaN, so the unguarded version reported a collision
  // for every pair and buried the real "must include pos" diagnostic.
  const nan = rect(Number.NaN, Number.NaN, 120, 60);
  assert.equal(rectsOverlap(nan, nan, 8), false);
  assert.equal(rectsOverlap(nan, rect(0, 0, 10, 10), 8), false);
  assert.equal(rectsOverlap(rect(0, 0, 10, 10), nan, 8), false);
  assert.equal(rectsOverlap(rect(0, 0, 10, 10), rect(20, 0, Number.NaN, 10)), false);
  assert.equal(rectsOverlap(rect(0, 0, 10, 10), rect(5, 5, 10, Number.POSITIVE_INFINITY)), false);
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

test('endpoint-side direction distinguishes perpendicular entry from a tangent border run', () => {
  const clean = [[350, 160], [350, 200], [150, 200], [150, 240]];
  const tangent = [[350, 160], [350, 200], [100, 200], [100, 240], [150, 240]];
  assert.equal(routeHonorsEndpointSides(clean, 'bottom', 'top'), true);
  assert.equal(routeHonorsEndpointSides(tangent, 'bottom', 'top'), false);

  const relation = { id: 'tasks-file', from: 'cli-agents', to: 'tasks-watch', fromSide: 'bottom', toSide: 'top' };
  const problems = cleanEndpointSideProblems({
    relations: [relation],
    endpointIds: new Set(['cli-agents', 'tasks-watch']),
    pathFor: () => ({ points: tangent }),
    diagramType: 'architecture',
    relationCollection: 'connections',
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /\[clean-flow\/endpoint-side-direction\] architecture connections\[0\] id "tasks-file"/);
  assert.match(problems[0], /final segment 3 \[100, 240\] -> \[150, 240\]/);
  assert.match(problems[0], /toSide "top".*vertical downward from above/);
});

test('endpoint-side direction can fail closed on renderer-inferred automatic sides', () => {
  const relation = { id: 'terminal-return', from: 'stream-hub', to: 'workspace' };
  const problems = cleanEndpointSideProblems({
    relations: [relation],
    endpointIds: new Set(['stream-hub', 'workspace']),
    pathFor: () => ({ points: [[700, 130], [700, 230], [160, 230], [160, 330]] }),
    diagramType: 'architecture',
    relationCollection: 'connections',
    fromSideFor: () => 'left',
    toSideFor: () => 'right',
  });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /inferred fromSide "left"/);
  assert.match(problems[1], /inferred toSide "right"/);
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
    obstacleKind: 'node'
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
    obstacleKind: 'node'
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
  assert.equal(textUnits('ꥠ'), 2); // Hangul Jamo Extended-A is wide
});

test('textUnits counts emoji-presentation symbols in the BMP as wide', () => {
  // These render at the same square advance as the supplementary-plane emoji,
  // so counting them as one unit under-measures a label and lets it overflow
  // its node while the layout receipt still reads clean.
  assert.equal(textUnits('✅'), 2);
  assert.equal(textUnits('⭐'), 2);
  assert.equal(textUnits('⚡'), 2);
  assert.equal(textUnits('⌛'), 2);
  assert.equal(textUnits('⏰'), 2);
  assert.equal(textUnits('⛔'), 2);
  assert.equal(textUnits('❗'), 2);
  assert.equal(textUnits('⬛'), 2);
  assert.equal(textUnits('☕'), 2);
  assert.equal(textUnits('♿'), 2);
  assert.equal(textUnits('✅ Done'), 7);
  // Narrow and ambiguous neighbours in the same blocks stay one unit.
  assert.equal(textUnits('→'), 1); // rightwards arrow
  assert.equal(textUnits('☎'), 1); // black telephone
  assert.equal(textUnits('①'), 1); // circled digit one
  // Unicode 16.0 moved these from Neutral to Wide.
  assert.equal(textUnits('☰'), 2); // trigram for heaven
  assert.equal(textUnits('☷'), 2); // trigram for earth
  assert.equal(textUnits('⚊'), 2); // monogram for yang
  assert.equal(textUnits('⚏'), 2); // digram for greater yin
  // Hangul Jamo Extended-A stops at its last assigned jamo; the unassigned
  // tail of the block defaults to Neutral.
  assert.equal(textUnits('ꥼ'), 2);
  assert.equal(textUnits('꥽'), 1);
});

test('textUnits measures a variation-selector sequence from the selector', () => {
  // VS16 asks for emoji presentation: the pair renders as one square, so it
  // must stay two units even though the base is now counted wide on its own.
  assert.equal(textUnits('⭐️'), 2); // star
  assert.equal(textUnits('✅️'), 2); // check mark button
  assert.equal(textUnits('☕️'), 2); // hot beverage
  assert.equal(textUnits('⚡️'), 2); // high voltage
  // Same rule the other way: a narrow base forced to emoji presentation
  // renders as a square and is two units, not one.
  assert.equal(textUnits('✈️'), 2); // airplane
  assert.equal(textUnits('❤️'), 2); // red heart
  // VS15 asks for text presentation, which renders narrow.
  assert.equal(textUnits('⭐︎'), 1);
  assert.equal(textUnits('✈︎'), 1);
  // The selector never adds width of its own, alone or in a run.
  assert.equal(textUnits('️'), 0);
  assert.equal(textUnits('✅️ Done'), 7);
  assert.equal(textUnits('⭐️⭐️'), 4);
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
  assert.match(hint, /Suggested fix: set labelAt/);
  assert.match(hint, /set labelDy \d+/);
});

// Agents parse this hint, so pin the whole string for the no-viewBox contract.
test('suggestLabelObstacleFix states its no-viewBox hint as replacement values', () => {
  const labelRect = { x: 100, y: 180, width: 48, height: 14, label: '写入' };
  const obstacle = { id: 'memtool', x: 30, y: 130, width: 230, height: 58 };
  assert.equal(suggestLabelObstacleFix(labelRect, 124, 188, obstacle), [
    '  label rect: [100, 180, 48, 14]',
    '  component "memtool" rect: [30, 130, 230, 58]',
    '  Suggested fix: set labelAt [124, 200] or set labelDy 12 (below); or set labelAt [124, 120] or set labelDy -68 (above)',
  ].join('\n'));
});

test('suggestLabelObstacleFix carries an x nudge into the relative form', () => {
  const labelRect = { x: 512, y: 94, width: 236, height: 14, label: 'batched telemetry upload' };
  const obstacle = { id: 'edge', x: 560, y: 60, width: 140, height: 54 };
  const hint = suggestLabelObstacleFix(labelRect, 630, 104, obstacle, 'component', [720, 400]);
  assert.match(hint, /set labelAt \[602, 128\] or set labelDx -28 with labelDy 24 \(below\)/);
  assert.doesNotMatch(hint, /or set labelDy /);
});

// labelDx/labelDy are offsets from the automatic label point, so a suggestion
// has to be expressed relative to the values the document already carries.
test('suggestLabelObstacleFix measures its relative fix from the authored labelDx', () => {
  const obstacle = { id: 'edge', x: 560, y: 60, width: 140, height: 54 };
  const authoredAnchor = 750; // automatic point 630 plus the authored labelDx
  const labelRect = {
    relation: { label: 'batched telemetry upload', labelDx: 120 },
    x: authoredAnchor - 118,
    y: 94,
    width: 236,
    height: 14,
    label: 'batched telemetry upload',
  };
  const hint = suggestLabelObstacleFix(labelRect, authoredAnchor, 104, obstacle, 'component', [720, 400]);
  // 120 + 602 - 750 lands the automatic point at the clamped anchor; the
  // anchor-relative -148 would land it 120px away.
  assert.match(hint, /set labelAt \[602, 128\] or set labelDx -28 with labelDy 24 \(below\)/);
});

test('suggestLabelObstacleFix offers no relative fix while labelAt is authored', () => {
  const obstacle = { id: 'right', x: 540, y: 336, width: 160, height: 54 };
  const labelRect = {
    relation: { label: 'synchronous call', labelAt: [660, 360] },
    x: 542,
    y: 350,
    width: 236,
    height: 14,
    label: 'synchronous call',
  };
  const hint = suggestLabelObstacleFix(labelRect, 660, 360, obstacle, 'component', [720, 400]);
  assert.match(hint, /Suggested fix: set labelAt \[602, 328\] \(above\)$/);
  assert.doesNotMatch(hint, /labelD[xy]/);
});

// The deltas are emitted as integers, so a fractional anchor sitting exactly on
// a canvas bound cannot be expressed relatively without landing back outside.
test('suggestLabelObstacleFix drops a relative fix that integer deltas cannot land inside', () => {
  const obstacle = { id: 'api', x: 520, y: 180, width: 140, height: 54 };
  const rectFor = (anchorX) => ({
    relation: { label: 'edge' },
    x: anchorX - 100,
    y: 190,
    width: 200,
    height: 14,
    label: 'edge',
  });
  assert.doesNotMatch(
    suggestLabelObstacleFix(rectFor(620.5), 620.5, 200, obstacle, 'component', [720, 400]),
    /labelD[xy]/,
  );
  assert.match(
    suggestLabelObstacleFix(rectFor(620), 620, 200, obstacle, 'component', [720, 400]),
    /set labelAt \[620, 248\] or set labelDy 48 \(below\)/,
  );
});

// A rounded anchor as the measurement base adds its own residual to the
// residual of rounding the suggestion, which can drift the applied label past
// the containment tolerance. Measure from the real anchor instead.
test('suggestLabelObstacleFix measures its relative fix from a fractional anchor', () => {
  const anchorY = 200.6;
  const labelRect = {
    relation: { label: 'edge', labelDy: 0.3 },
    x: 240,
    y: anchorY - 10,
    width: 120,
    height: 14,
    label: 'edge',
  };
  const obstacle = { id: 'api', x: 260, y: 180, width: 140, height: 54 };
  const hint = suggestLabelObstacleFix(labelRect, 300, anchorY, obstacle, 'component', [720, 400]);
  const suggested = Number(hint.match(/set labelDy (-?\d+) \(below\)/)[1]);
  const placement = obstacle.y + obstacle.height + 14;
  const landsAt = anchorY - labelRect.relation.labelDy + suggested;
  assert.ok(
    Math.abs(landsAt - placement) <= 0.5,
    `labelDy ${suggested} lands the label at ${landsAt}, ${Math.abs(landsAt - placement)}px from the ${placement} placement`,
  );
});

test('suggestLabelObstacleFix treats a fractional authored labelDx as no horizontal move', () => {
  const labelRect = {
    relation: { label: 'edge', labelDx: 40.4 },
    x: 240,
    y: 190,
    width: 120,
    height: 14,
    label: 'edge',
  };
  const obstacle = { id: 'api', x: 260, y: 180, width: 140, height: 54 };
  const hint = suggestLabelObstacleFix(labelRect, 300, 200, obstacle, 'component', [720, 400]);
  assert.match(hint, /set labelAt \[300, 248\] or set labelDy 48 \(below\)/);
  assert.doesNotMatch(hint, /labelDx/);
});

test('suggestLabelObstacleFix keeps its labelAt inside a supplied viewBox', () => {
  const labelRect = { x: 596, y: 190, width: 160, height: 14, label: 'long edge label' };
  const obstacle = { id: 'api', x: 560, y: 180, width: 140, height: 60 };
  const hint = suggestLabelObstacleFix(labelRect, 676, 200, obstacle, 'component', [720, 400]);
  const [, x, y] = hint.match(/labelAt \[(-?\d+), (-?\d+)\]/).map(Number);
  assert.ok(x - labelRect.width / 2 >= 0 && x + labelRect.width / 2 <= 720, `labelAt x ${x} leaves the canvas`);
  assert.ok(y - 10 >= 0 && y - 10 + labelRect.height <= 400, `labelAt y ${y} leaves the canvas`);
});

test('suggestLabelObstacleFix drops a placement that would only trade the obstacle for a clipped edge', () => {
  const labelRect = { x: 200, y: 356, width: 120, height: 14, label: 'commit' };
  const obstacle = { id: 'store', x: 180, y: 336, width: 160, height: 54 };
  const hint = suggestLabelObstacleFix(labelRect, 260, 366, obstacle, 'component', [720, 400]);
  assert.doesNotMatch(hint, /\(below\)/);
  assert.match(hint, /labelAt \[260, 328\].*\(above\)/);
});

// The obstacle-only above anchor assumed the 14px single-line rect: applied to
// a 27px two-line rect (dataflow classification, lifecycle note) it left the
// label 12px inside the obstacle and the validator repeated the same hint.
test('suggestLabelObstacleFix keeps both two-line forms clear of the obstacle it names', () => {
  const cases = [
    { labelRect: { x: 67, y: 139, width: 66, height: 27, label: 'clickstream' },
      lx: 100, ly: 150,
      obstacle: { id: 'web', x: 44, y: 128, width: 112, height: 58 },
      viewBox: [1080, 760] },
    { labelRect: { x: 360, y: 169, width: 81, height: 27, label: 'needs approval' },
      lx: 400, ly: 180,
      obstacle: { id: 'executing', x: 343, y: 126, width: 118, height: 62 },
      viewBox: [980, 660] },
  ];
  for (const { labelRect, lx, ly, obstacle, viewBox } of cases) {
    const hint = suggestLabelObstacleFix(labelRect, lx, ly, obstacle, 'node', viewBox);
    const placements = [...hint.matchAll(/set labelAt \[(-?\d+), (-?\d+)\][^;]*\((above|below)\)/g)];
    assert.equal(placements.length, 2, hint);
    for (const [, x, y] of placements) {
      const applied = {
        x: Number(x) + (labelRect.x - lx),
        y: Number(y) + (labelRect.y - ly),
        width: labelRect.width,
        height: labelRect.height,
      };
      assert.ok(
        !rectsOverlap(applied, obstacle, -2),
        `${hint}\napplied rect [${applied.x}, ${applied.y}, ${applied.width}, ${applied.height}] lands on "${obstacle.id}"`,
      );
    }
  }
});

// Only the two vertical slots are tried, so the fallback must not claim that
// no position exists anywhere — an open area elsewhere may still take the
// label via labelAt.
test('suggestLabelObstacleFix reports when neither vertical slot clears the obstacle', () => {
  const labelRect = { x: 40, y: 30, width: 120, height: 14, label: 'commit' };
  const obstacle = { id: 'store', x: 0, y: 0, width: 720, height: 400 };
  const hint = suggestLabelObstacleFix(labelRect, 100, 40, obstacle, 'component', [720, 400]);
  assert.doesNotMatch(hint, /set label/);
  assert.match(hint, /no placement directly above or below "store" stays clear inside the 720x400 viewBox/);
  assert.match(hint, /move the label to an open area with labelAt/);
});

test('suggestLabelObstacleFix offers no coordinate for a label wider than the canvas', () => {
  const labelRect = { x: -40, y: 190, width: 800, height: 14, label: 'a label nobody can fit' };
  const obstacle = { id: 'api', x: 200, y: 180, width: 140, height: 54 };
  const hint = suggestLabelObstacleFix(labelRect, 360, 200, obstacle, 'component', [720, 400]);
  assert.doesNotMatch(hint, /labelAt|labelDx|labelDy/);
  assert.match(hint, /800px label rect cannot fit the 720x400 viewBox at any anchor — shorten the label/);
});

// A placement that merely trades the named obstacle for its neighbor fails the
// same rule on re-render, so the filter takes every box the caller checks.
test('suggestLabelObstacleFix keeps placements clear of the other supplied obstacles', () => {
  const labelRect = { x: 310, y: 100, width: 120, height: 14, label: 'check' };
  const named = { id: 'a', x: 300, y: 80, width: 140, height: 50 };
  const neighborBelow = { id: 'b', x: 300, y: 140, width: 140, height: 50 };
  const hint = suggestLabelObstacleFix(
    labelRect, 370, 110, named, 'component', [720, 400], [named, neighborBelow],
  );
  assert.doesNotMatch(hint, /\(below\)/, hint);
  assert.match(hint, /set labelAt \[370, 72\][^;]*\(above\)/);
});

test('cleanLabelCanvasContainmentProblems names both edges a corner overhang crosses and stays off standard', () => {
  const labels = [{
    relation: { id: 'a-to-b', from: 'a', to: 'b', label: 'over the corner' },
    relationIndex: 0,
    label: 'over the corner',
    x: 680,
    y: 392,
    width: 60,
    height: 14,
  }];
  const showcase = cleanLabelCanvasContainmentProblems({
    labels,
    viewBox: [720, 400],
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: 'showcase',
  });
  assert.equal(showcase.length, 1);
  assert.match(showcase[0], /extends past the right edge by 20px and bottom edge by 6px/);
  assert.deepEqual(cleanLabelCanvasContainmentProblems({
    labels,
    viewBox: [720, 400],
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: 'standard',
  }), []);
});

// Label widths are estimated, so the rule has to sit above rounding noise and
// below anything a reader would see as cut off.
test('cleanLabelCanvasContainmentProblems ignores overhang under the 0.5px tolerance', () => {
  const overhangingBy = (amount) => cleanLabelCanvasContainmentProblems({
    labels: [{
      relation: { id: 'a-to-b', from: 'a', to: 'b' },
      relationIndex: 0,
      label: 'edge',
      x: 620 + amount,
      y: 100,
      width: 100,
      height: 14,
    }],
    viewBox: [720, 400],
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: 'showcase',
  });
  assert.deepEqual(overhangingBy(0.4), []);
  assert.equal(overhangingBy(0.6).length, 1);
  assert.match(overhangingBy(0.6)[0], /extends past the right edge by 0\.6px/);
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
      <!-- ARCHIFY:SVG_SLOT_START --><svg></svg>      <!-- ARCHIFY:SVG_SLOT_END -->
    <!-- ARCHIFY:CARDS_SLOT_START --><div></div>    <!-- ARCHIFY:CARDS_SLOT_END -->`;
  const html = applyTemplate(template, {
    title: 'Plan $$50 tier',
    subtitle: 'test',
    svg: '<svg/>',
    cards: '',
  });
  assert.match(html, /Plan \$\$50 tier/);
  assert.match(html, /<p class="subtitle">test<\/p>/);
});

test('applyTemplate omits the subtitle row when no subtitle is authored', () => {
  const template = `<html lang="en" data-theme="dark" data-preset="[VISUAL PRESET]">
<title>[PROJECT NAME] Architecture Diagram</title>
<h1>[PROJECT NAME] Architecture</h1>
<p class="subtitle">[Subtitle description]</p>
<!-- ARCHIFY:GUIDED_VIEWS_DATA -->
      <!-- ARCHIFY:SVG_SLOT_START --><svg></svg>      <!-- ARCHIFY:SVG_SLOT_END -->
    <!-- ARCHIFY:CARDS_SLOT_START --><div></div>    <!-- ARCHIFY:CARDS_SLOT_END -->`;
  const html = applyTemplate(template, {
    title: 'Focused title',
    subtitle: '   ',
    svg: '<svg/>',
    cards: '',
  });
  assert.doesNotMatch(html, /class="subtitle"/);
  assert.doesNotMatch(html, /Subtitle description/);
});

test('applyTemplate requires the new evidence slot only when evidence is present', () => {
  const legacyTemplate = `<html lang="en" data-theme="dark" data-preset="[VISUAL PRESET]">
<title>[PROJECT NAME] Architecture Diagram</title>
<h1>[PROJECT NAME] Architecture</h1>
<p class="subtitle">[Subtitle description]</p>
<!-- ARCHIFY:GUIDED_VIEWS_DATA -->
      <!-- ARCHIFY:SVG_SLOT_START --><svg></svg>      <!-- ARCHIFY:SVG_SLOT_END -->
    <!-- ARCHIFY:CARDS_SLOT_START --><div></div>    <!-- ARCHIFY:CARDS_SLOT_END -->`;
  assert.doesNotThrow(() => applyTemplate(legacyTemplate, {
    title: 'Legacy', subtitle: '', svg: '<svg/>', cards: '',
  }));
  assert.throws(() => applyTemplate(legacyTemplate, {
    title: 'Evidence', subtitle: '', svg: '<svg/>', cards: '',
    sourceEvidence: { verified: true },
  }), /repository evidence requires placeholder/);
});
