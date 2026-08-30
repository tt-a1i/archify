import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compileWorkflow } from '../renderers/workflow/workflow-compiler.mjs';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function workflow({ lanes, nodes, edges }) {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: {
      title: 'Workflow compiler hard-contract fixture',
      legend: { mode: 'hidden' },
    },
    lanes,
    nodes,
    edges,
  };
}

function oneLaneWorkflow(edges) {
  return workflow({
    lanes: [{ id: 'main', label: 'M' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
    ],
    edges,
  });
}

function nestedOutsideRightCorridorWorkflow() {
  return workflow({
    lanes: [0, 1, 2, 3].map((index) => ({ id: `l${index}`, label: `Lane ${index}` })),
    nodes: [
      { id: 'outer-from', lane: 'l0', col: 0, type: 'backend', label: 'Outer from' },
      { id: 'inner-from', lane: 'l1', col: 0, type: 'backend', label: 'Inner from' },
      { id: 'inner-to', lane: 'l2', col: 2, type: 'database', label: 'Inner to' },
      { id: 'outer-to', lane: 'l3', col: 2, type: 'database', label: 'Outer to' },
    ],
    edges: [
      {
        id: 'outer',
        from: 'outer-from',
        to: 'outer-to',
        route: 'outside-right',
        channelX: 800,
        fromSide: 'right',
        toSide: 'right',
      },
      {
        id: 'inner',
        from: 'inner-from',
        to: 'inner-to',
        route: 'outside-right',
        channelX: 800,
        fromSide: 'right',
        toSide: 'right',
      },
    ],
  });
}

function crossingAtForwardCollinearViaWorkflow({ pinHorizontal = false } = {}) {
  return workflow({
    lanes: [
      { id: 'top', label: 'Top' },
      { id: 'middle', label: 'Middle' },
      { id: 'bottom', label: 'Bottom' },
    ],
    nodes: [
      { id: 'left', lane: 'middle', col: 0, type: 'backend', label: 'Left' },
      { id: 'right', lane: 'middle', col: 4, type: 'backend', label: 'Right' },
      { id: 'above', lane: 'top', col: 2, type: 'backend', label: 'Above' },
      { id: 'below', lane: 'bottom', col: 2, type: 'backend', label: 'Below' },
    ],
    edges: [
      {
        id: pinHorizontal ? 'a-pinned' : 'a-auto',
        from: 'left',
        to: 'right',
        ...(pinHorizontal ? { via: [[334, 243]] } : {}),
      },
      {
        id: 'z-pinned',
        from: 'above',
        to: 'below',
        via: [[334, 243]],
      },
    ],
  });
}

function oneLaneAnchors() {
  const result = compileWorkflow({ workflow: oneLaneWorkflow([]), qualityProfile: 'standard' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  const source = result.receipt.nodes.find(({ id }) => id === 'a');
  const target = result.receipt.nodes.find(({ id }) => id === 'b');
  assert.ok(source && target);
  return {
    start: [source.x + source.width, source.y + source.height / 2],
    end: [target.x, target.y + target.height / 2],
  };
}

function assertExplicitPinConflict(result, context) {
  assert.equal(result.ok, false, `${context} must not produce an SVG`);
  assert.equal(result.svg, undefined);
  assert.ok(Array.isArray(result.diagnostics) && result.diagnostics.length > 0);
  assert.ok(
    result.diagnostics.some(({ code }) => code === 'workflow/explicit-pin-conflict'),
    `${context} must report workflow/explicit-pin-conflict:\n${JSON.stringify(result.diagnostics, null, 2)}`,
  );
  assert.deepEqual(result.receipt.diagnostics, result.diagnostics);
}

function assertSupportedFixesNameChangedEdge(diagnostic, edgeIds) {
  assert.ok(diagnostic.supportedFixes.length > 0, JSON.stringify(diagnostic, null, 2));
  for (const fix of diagnostic.supportedFixes) {
    assert.ok(
      edgeIds.some((edgeId) => fix.includes(`edge "${edgeId}"`)),
      `supported fix must name its changed edge (${edgeIds.join(', ')}): ${fix}`,
    );
  }
}

function assertOrthogonal(points) {
  for (let index = 0; index < points.length - 1; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[index + 1];
    assert.ok(x1 === x2 || y1 === y2, `segment ${index} must be orthogonal`);
    assert.notDeepEqual(points[index], points[index + 1], `segment ${index} must be non-zero`);
  }
}

function routeContainsChannel(points, field, value) {
  return points.slice(0, -1).some((start, index) => {
    const end = points[index + 1];
    if (field === 'channelX') {
      return start[0] === value && end[0] === value && start[1] !== end[1];
    }
    return start[1] === value && end[1] === value && start[0] !== end[0];
  });
}

function segmentMeetsRect(start, end, rect, clearance = 2) {
  const left = rect.x - clearance;
  const right = rect.x + rect.width + clearance;
  const top = rect.y - clearance;
  const bottom = rect.y + rect.height + clearance;
  if (start[1] === end[1]) {
    return start[1] >= top && start[1] <= bottom
      && Math.max(start[0], end[0]) >= left
      && Math.min(start[0], end[0]) <= right;
  }
  if (start[0] === end[0]) {
    return start[0] >= left && start[0] <= right
      && Math.max(start[1], end[1]) >= top
      && Math.min(start[1], end[1]) <= bottom;
  }
  return true;
}

test('readable-v2 auto routing selects a feasible corridor around a same-lane obstacle', () => {
  const document = workflow({
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'backend', label: 'A' },
      { id: 'obstacle', lane: 'main', col: 2, type: 'database', label: 'Obstacle' },
      { id: 'b', lane: 'main', col: 5, type: 'backend', label: 'B' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b' }],
  });

  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assert.equal(
    result.ok,
    true,
    `a feasible automatic corridor must compile:\n${JSON.stringify(result.diagnostics, null, 2)}`,
  );

  const points = result.receipt.edges.find(({ id }) => id === 'ab')?.points;
  const obstacle = result.receipt.nodes.find(({ id }) => id === 'obstacle');
  assert.ok(points && obstacle);
  assert.ok(points.length >= 3, 'the route must bend around the intervening node');
  assertOrthogonal(points);
  for (let index = 0; index < points.length - 1; index += 1) {
    assert.equal(
      segmentMeetsRect(points[index], points[index + 1], obstacle),
      false,
      `segment ${index} must clear the unrelated obstacle`,
    );
  }
});

test('readable-v2 evaluates automatic endpoint sides against the complete labeled route', () => {
  const document = workflow({
    lanes: [{ id: 'source', label: 'Source' }, { id: 'target', label: 'Target' }],
    nodes: [
      { id: 'a', lane: 'source', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'target', col: 1, type: 'backend', label: 'B' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', label: 'L'.repeat(50) }],
  });

  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  assert.deepEqual(result.receipt.viewBox, [768, 404]);
  assert.deepEqual(result.receipt.edges[0].points, [
    [94, 145], [94, 166], [214, 166], [214, 217],
  ]);
});

test('readable-v2 retries automatic endpoint sides against already planned routes', () => {
  const document = workflow({
    lanes: [0, 1, 2].map((index) => ({ id: `l${index}`, label: `Lane ${index}` })),
    nodes: [
      { id: 'a', lane: 'l0', col: 2, type: 'backend', label: 'A' },
      { id: 'b', lane: 'l0', col: 3, type: 'backend', label: 'B', yOffset: -1 },
      { id: 'c', lane: 'l2', col: 4, type: 'backend', label: 'C' },
    ],
    edges: [
      { id: 'e0', from: 'a', to: 'b', label: 'L'.repeat(17) },
      { id: 'e1', from: 'a', to: 'c' },
    ],
  });

  const first = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  const second = compileWorkflow({ workflow: clone(document), qualityProfile: 'standard' });
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics, null, 2));
  assert.equal(second.ok, true, JSON.stringify(second.diagnostics, null, 2));
  assert.equal(second.svg, first.svg);
  assert.equal(JSON.stringify(second.receipt), JSON.stringify(first.receipt));
  assertOrthogonal(first.receipt.edges.find(({ id }) => id === 'e1').points);
});

test('readable-v2 expands an outside corridor for deterministic labeled fan-out', () => {
  const document = workflow({
    lanes: Array.from({ length: 5 }, (_, index) => ({
      id: `l${index}`,
      label: `Lane ${index}`,
    })),
    nodes: [
      { id: 'hub', lane: 'l0', col: 0, type: 'backend', label: 'Hub', width: 64 },
      { id: 't0', lane: 'l1', col: 2, type: 'external', label: 'T0', width: 160 },
      { id: 't1', lane: 'l2', col: 4, type: 'database', label: 'T1', width: 160 },
      { id: 't2', lane: 'l3', col: 3, type: 'external', label: 'T2', width: 64 },
      { id: 't3', lane: 'l4', col: 4, type: 'database', label: 'T3', width: 120 },
    ],
    edges: [
      { id: 'e0', from: 'hub', to: 't0', label: 'A'.repeat(80) },
      { id: 'e1', from: 'hub', to: 't1', label: 'B'.repeat(80) },
      { id: 'e2', from: 'hub', to: 't2', label: 'C'.repeat(12) },
      { id: 'e3', from: 'hub', to: 't3', label: 'D'.repeat(24) },
    ],
  });

  const first = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  const second = compileWorkflow({ workflow: clone(document), qualityProfile: 'standard' });
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics, null, 2));
  assert.deepEqual(second, first);
  const route = first.receipt.edges.find(({ id }) => id === 'e3')?.points;
  assert.ok(route);
  assertOrthogonal(route);
  assert.ok(
    Math.max(...route.map(([x]) => x)) > 764,
    `the final fan-out edge must escape the occupied route/label region: ${JSON.stringify(route)}`,
  );
});

test('readable-v2 expands an outside corridor without moving the lane geometry', () => {
  const document = workflow({
    lanes: Array.from({ length: 5 }, (_, index) => ({
      id: `l${index}`,
      label: `Lane ${index}`,
    })),
    nodes: [
      { id: 'hub', lane: 'l0', col: 1, type: 'backend', label: 'Hub', width: 92 },
      { id: 't0', lane: 'l1', col: 2, type: 'external', label: 'T0', width: 120 },
      { id: 't1', lane: 'l2', col: 1, type: 'database', label: 'T1', width: 160 },
      { id: 't2', lane: 'l3', col: 1, type: 'external', label: 'T2', width: 120 },
      { id: 't3', lane: 'l4', col: 2, type: 'database', label: 'T3', width: 120 },
    ],
    edges: [
      { id: 'e0', from: 'hub', to: 't0', label: 'A'.repeat(120) },
      { id: 'e1', from: 'hub', to: 't1', label: 'B'.repeat(48) },
      { id: 'e2', from: 'hub', to: 't2', label: 'C'.repeat(24) },
      { id: 'e3', from: 'hub', to: 't3', label: 'D'.repeat(84) },
    ],
  });

  const first = compileWorkflow({ workflow: document, qualityProfile: 'showcase' });
  const second = compileWorkflow({ workflow: clone(document), qualityProfile: 'showcase' });
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics, null, 2));
  assert.deepEqual(second, first);
  const route = first.receipt.edges.find(({ id }) => id === 'e3')?.points;
  assert.ok(route);
  assertOrthogonal(route);
  assert.ok(Math.max(...route.map(([x]) => x)) > 1200, JSON.stringify(route));
  assert.ok(first.receipt.viewBox[0] < 1400, JSON.stringify(first.receipt.viewBox));
});

test('readable-v2 may expand an unlabeled edge around already placed labels', () => {
  const document = workflow({
    lanes: Array.from({ length: 4 }, (_, index) => ({
      id: `l${index}`,
      label: `Lane ${index}`,
    })),
    nodes: [
      { id: 'hub', lane: 'l0', col: 0, type: 'backend', label: 'Hub', width: 120 },
      { id: 't0', lane: 'l1', col: 1, type: 'backend', label: 'T0', width: 92, yOffset: -4 },
      { id: 't1', lane: 'l2', col: 3, type: 'backend', label: 'T1', width: 92, yOffset: 4 },
      { id: 't2', lane: 'l3', col: 1, type: 'external', label: 'T2', width: 120, yOffset: -4 },
      { id: 't3', lane: 'l1', col: 5, type: 'backend', label: 'T3', width: 92, yOffset: -12 },
      { id: 't4', lane: 'l2', col: 1, type: 'backend', label: 'T4', width: 120, yOffset: -12 },
    ],
    edges: [
      { id: 'e00', from: 'hub', to: 't0', label: 'Z'.repeat(80) },
      { id: 'e01', from: 'hub', to: 't1', label: 'Q'.repeat(120) },
      { id: 'e02', from: 'hub', to: 't2', label: 'Q'.repeat(120) },
      { id: 'e03', from: 'hub', to: 't3', label: 'Z'.repeat(80) },
      { id: 'e04', from: 'hub', to: 't4' },
    ],
  });

  const first = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  const second = compileWorkflow({ workflow: clone(document), qualityProfile: 'standard' });
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics, null, 2));
  assert.deepEqual(second, first);
  const route = first.receipt.edges.find(({ id }) => id === 'e04')?.points;
  assert.ok(route);
  assertOrthogonal(route);
  assert.ok(Math.max(...route.map(([x]) => x)) > 764, JSON.stringify(route));

  const boundedDocument = clone(document);
  boundedDocument.meta.viewBox = [1378, 692];
  const bounded = compileWorkflow({ workflow: boundedDocument, qualityProfile: 'standard' });
  assert.equal(bounded.ok, true, JSON.stringify(bounded.diagnostics, null, 2));
  assert.deepEqual(bounded.receipt.viewBox, [1378, 692]);
});

test('readable-v2 feeds a measured outside-channel constraint back into layout', () => {
  const document = workflow({
    lanes: [{ id: 'source', label: 'Source' }, { id: 'target', label: 'Target' }],
    nodes: [
      { id: 'a', lane: 'source', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'target', col: 0, type: 'backend', label: 'B' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', label: 'L'.repeat(120) }],
  });
  document.meta.quality_profile = 'showcase';

  const first = compileWorkflow({ workflow: document });
  const second = compileWorkflow({ workflow: clone(document) });
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics, null, 2));
  assert.deepEqual(first.receipt.viewBox, [780, 404]);
  assert.deepEqual(first.receipt.requiredViewBox, [780, 404]);
  assert.deepEqual(first.receipt.edges[0].points, [
    [140, 119], [764, 119], [764, 243], [140, 243],
  ]);
  assert.deepEqual(
    { x: first.receipt.labels[0].x, y: first.receipt.labels[0].y },
    { x: 452, y: 109 },
  );
  assert.equal(second.svg, first.svg);
  assert.equal(JSON.stringify(second.receipt), JSON.stringify(first.receipt));
});

test('readable-v2 feeds a measured adjacent-rank gutter back into layout', () => {
  const document = workflow({
    lanes: [{ id: 'l0', label: 'Lane 0' }, { id: 'l1', label: 'Lane 1' }],
    nodes: [
      { id: 'a', lane: 'l0', col: 0, type: 'backend', label: 'A' },
      { id: 'obstacle', lane: 'l0', col: 1, type: 'database', label: 'Obstacle' },
      { id: 'b', lane: 'l1', col: 1, type: 'backend', label: 'B' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', fromSide: 'right', toSide: 'left' }],
  });

  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  assert.deepEqual(result.receipt.columns.slice(0, 2), [94, 218]);
  assert.deepEqual(result.receipt.edges[0].points, [
    [140, 119], [156, 119], [156, 243], [172, 243],
  ]);
});

test('readable-v2 feeds a measured lane gap back into layout', () => {
  const document = workflow({
    lanes: [0, 1, 2].map((index) => ({ id: `l${index}`, label: `Lane ${index}` })),
    nodes: [0, 1, 2].map((index) => ({
      id: `n${index}`, lane: `l${index}`, col: 5, type: 'backend', label: `N${index}`,
    })),
    edges: [
      {
        id: 'e0', from: 'n1', to: 'n2', fromSide: 'bottom', toSide: 'right', label: 'LLLLLLLLLL',
      },
      {
        id: 'e2', from: 'n2', to: 'n1', fromSide: 'left', toSide: 'right', label: 'x',
      },
    ],
  });

  const result = compileWorkflow({ workflow: document, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  assert.deepEqual(result.receipt.columns, [94, 214, 334, 454, 574, 694]);
  assert.deepEqual(result.receipt.nodes.map(({ id, y }) => ({ id, y })), [
    { id: 'n0', y: 93 }, { id: 'n1', y: 229 }, { id: 'n2', y: 365 },
  ]);
  assert.deepEqual(result.receipt.edges.map(({ id, points }) => ({ id, points })), [
    {
      id: 'e0',
      points: [[694, 281], [694, 308], [756, 308], [756, 391], [740, 391]],
    },
    {
      id: 'e2',
      points: [[648, 391], [632, 391], [632, 172], [756, 172], [756, 255], [740, 255]],
    },
  ]);
  assert.deepEqual(result.receipt.requiredViewBox, [772, 552]);
});

for (const { name, makeDocument } of [
  {
    name: 'duplicate authored via points',
    makeDocument: () => {
      const { start } = oneLaneAnchors();
      const pin = [start[0] + 60, start[1]];
      return oneLaneWorkflow([{
        id: 'ab', from: 'a', to: 'b', via: [pin, [...pin]],
      }]);
    },
  },
  {
    name: 'diagonal authored via geometry',
    makeDocument: () => {
      const { start } = oneLaneAnchors();
      return oneLaneWorkflow([{
        id: 'ab', from: 'a', to: 'b', via: [[start[0] + 60, start[1] + 31]],
      }]);
    },
  },
]) {
  test(`readable-v2 rejects ${name} with a typed explicit-pin diagnostic`, () => {
    const result = compileWorkflow({ workflow: makeDocument(), qualityProfile: 'standard' });
    assertExplicitPinConflict(result, name);
  });
}

test('readable-v2 duplicate evidence excludes a compatible channel assertion', () => {
  const document = oneLaneWorkflow([{
    id: 'ab',
    from: 'a',
    to: 'b',
    via: [[200, 119], [200, 180], [200, 180], [260, 180], [260, 119]],
    channelY: 180,
  }]);
  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assertExplicitPinConflict(result, 'duplicate via with compatible channelY');
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.evidence.invariant, 'non-zero route segments');
  assert.deepEqual(diagnostic.evidence.conflictingPins, [{
    edge: 'ab', field: 'via', path: '/edges/0/via',
    value: [[200, 119], [200, 180], [200, 180], [260, 180], [260, 119]],
  }]);
  assert.ok(diagnostic.supportedFixes.length > 0, JSON.stringify(diagnostic, null, 2));
});

test('readable-v2 obstacle evidence excludes a compatible channel assertion', () => {
  const document = workflow({
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'backend', label: 'A' },
      { id: 'obstacle', lane: 'main', col: 1, type: 'database', label: 'Obstacle' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
    ],
    edges: [{
      id: 'ab',
      from: 'a',
      to: 'b',
      via: [[156, 119], [156, 180], [200, 180], [200, 119], [276, 119]],
      channelY: 180,
    }],
  });
  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assertExplicitPinConflict(result, 'node collision with compatible channelY');
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.evidence.invariant, 'node clearance');
  assert.deepEqual(diagnostic.evidence.conflictingPins, [{
    edge: 'ab', field: 'via', path: '/edges/0/via',
    value: [[156, 119], [156, 180], [200, 180], [200, 119], [276, 119]],
  }]);
  assert.ok(diagnostic.supportedFixes.length > 0, JSON.stringify(diagnostic, null, 2));
});

test('readable-v2 infers omitted endpoint sides around an authored via', () => {
  const expected = [[94, 93], [94, 77], [334, 77], [334, 93]];
  for (const qualityProfile of ['standard', 'showcase']) {
    for (const sides of [
      {},
      { fromSide: 'top' },
      { toSide: 'top' },
      { fromSide: 'top', toSide: 'top' },
    ]) {
      const document = oneLaneWorkflow([{
        id: 'ab', from: 'a', to: 'b', via: [[94, 77], [334, 77]], ...sides,
      }]);
      const result = compileWorkflow({ workflow: document, qualityProfile });
      assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
      assert.deepEqual(result.receipt.edges[0].points, expected);
    }
  }

  const restricted = oneLaneWorkflow([{
    id: 'ab',
    from: 'a',
    to: 'b',
    fromSide: 'right',
    via: [[94, 77], [334, 77]],
  }]);
  assertExplicitPinConflict(
    compileWorkflow({ workflow: restricted, qualityProfile: 'standard' }),
    'authored fromSide must remain a hard restriction',
  );

  const duplicate = oneLaneWorkflow([{
    id: 'ab',
    from: 'a',
    to: 'b',
    via: [[94, 77], [94, 77], [334, 77]],
  }]);
  const duplicateResult = compileWorkflow({ workflow: duplicate, qualityProfile: 'standard' });
  assertExplicitPinConflict(duplicateResult, 'inferred top ports around duplicate via geometry');
  assert.equal(duplicateResult.diagnostics[0].evidence.invariant, 'non-zero route segments');
  assert.deepEqual(duplicateResult.diagnostics[0].evidence.from, [94, 77]);
  assert.deepEqual(duplicateResult.diagnostics[0].evidence.to, [94, 77]);
});

test('readable-v2 reports an infeasible authored target side with its verified single-pin repair', () => {
  const document = workflow({
    lanes: [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }],
    nodes: [
      { id: 'a', lane: 'top', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'bottom', col: 0, type: 'backend', label: 'B' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', toSide: 'top' }],
  });
  document.groups = [{
    id: 'g', label: 'Very long group label', lane: 'bottom', fromCol: 0, toCol: 0,
  }];

  const result = compileWorkflow({ workflow: document, qualityProfile: 'showcase' });

  assert.equal(result.ok, false);
  assert.equal(result.svg, undefined);
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics, null, 2));
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, 'workflow/explicit-pin-conflict');
  assert.deepEqual(diagnostic.subject, {
    diagramType: 'workflow',
    edge: 'ab',
    from: 'a',
    to: 'b',
    path: '/edges/0/toSide',
  });
  assert.equal(
    diagnostic.evidence.invariant,
    'readable route feasibility with authored endpoint sides',
  );
  assert.deepEqual(diagnostic.evidence.conflictingPins, [{
    edge: 'ab',
    field: 'toSide',
    path: '/edges/0/toSide',
    value: 'top',
  }]);
  assert.deepEqual(diagnostic.supportedFixes, [
    'remove toSide from edge "ab" so readable-v2 can replan the remaining endpoint-side pins',
  ]);
  assert.deepEqual(result.receipt.diagnostics, result.diagnostics);

  const repaired = clone(document);
  delete repaired.edges[0].toSide;
  const verified = compileWorkflow({ workflow: repaired, qualityProfile: 'showcase' });
  assert.equal(verified.ok, true, JSON.stringify(verified.diagnostics, null, 2));
});

test('readable-v2 reports via and fromSide as a minimal conflict with two verified repairs', () => {
  const document = oneLaneWorkflow([{
    id: 'ab',
    from: 'a',
    to: 'b',
    fromSide: 'right',
    toSide: 'top',
    via: [[20, 119], [20, 50], [334, 50]],
  }]);

  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });

  assert.equal(result.ok, false);
  assert.equal(result.svg, undefined);
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics, null, 2));
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, 'workflow/explicit-pin-conflict');
  assert.equal(diagnostic.evidence.invariant, 'perpendicular endpoint-side direction');
  assert.deepEqual(diagnostic.evidence.conflictingPins, [
    {
      edge: 'ab',
      field: 'fromSide',
      path: '/edges/0/fromSide',
      value: 'right',
    },
    {
      edge: 'ab',
      field: 'via',
      path: '/edges/0/via',
      value: [[20, 119], [20, 50], [334, 50]],
    },
  ]);
  assert.deepEqual(diagnostic.supportedFixes, [
    'remove fromSide from edge "ab" and replan the remaining explicit pins',
    'remove via from edge "ab" and replan the remaining explicit pins',
  ]);

  for (const field of ['fromSide', 'via']) {
    const repaired = clone(document);
    delete repaired.edges[0][field];
    const verified = compileWorkflow({ workflow: repaired, qualityProfile: 'standard' });
    assert.equal(
      verified.ok,
      true,
      `removing ${field} must recompile:\n${JSON.stringify(verified.diagnostics, null, 2)}`,
    );
  }
});

test('readable-v2 infers endpoint sides for auto channel pins', () => {
  const cases = [
    {
      edge: { channelY: 77 },
      document: oneLaneWorkflow([]),
      expected: [[94, 93], [94, 77], [334, 77], [334, 93]],
    },
    {
      edge: { channelX: 20 },
      document: workflow({
        lanes: [{ id: 'l0', label: 'L0' }, { id: 'l1', label: 'L1' }],
        nodes: [
          { id: 'a', lane: 'l0', col: 0, type: 'backend', label: 'A' },
          { id: 'b', lane: 'l1', col: 2, type: 'backend', label: 'B' },
        ],
        edges: [],
      }),
      expected: [[48, 119], [20, 119], [20, 243], [288, 243]],
    },
    {
      edge: { channelX: 20, channelY: 181 },
      document: workflow({
        lanes: [{ id: 'l0', label: 'L0' }, { id: 'l1', label: 'L1' }],
        nodes: [
          { id: 'a', lane: 'l0', col: 0, type: 'backend', label: 'A' },
          { id: 'b', lane: 'l1', col: 2, type: 'backend', label: 'B' },
        ],
        edges: [],
      }),
      expected: [[48, 119], [20, 119], [20, 181], [334, 181], [334, 217]],
    },
  ];

  for (const qualityProfile of ['standard', 'showcase']) {
    for (const fixture of cases) {
      fixture.document.edges = [{ id: 'ab', from: 'a', to: 'b', ...fixture.edge }];
      const result = compileWorkflow({ workflow: clone(fixture.document), qualityProfile });
      assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
      assert.deepEqual(result.receipt.edges[0].points, fixture.expected);
      for (const [field, value] of Object.entries(fixture.edge)) {
        assert.ok(routeContainsChannel(result.receipt.edges[0].points, field, value));
      }
    }
  }
});

test('readable-v2 treats an omitted preset side as a solver choice', () => {
  const crossLane = (route, extra = {}) => workflow({
    lanes: [{ id: 'l0', label: 'X' }, { id: 'l1', label: 'Y' }],
    nodes: [
      { id: 'a', lane: 'l0', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'l1', col: 2, type: 'backend', label: 'B' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', route, ...extra }],
  });
  const cases = [
    {
      route: 'straight',
      document: oneLaneWorkflow([{ id: 'ab', from: 'a', to: 'b', route: 'straight' }]),
      expected: [[140, 119], [288, 119]],
    },
    { route: 'drop', document: crossLane('drop'), expected: [[94, 145], [94, 166], [334, 166], [334, 217]] },
    { route: 'outside-right', document: crossLane('outside-right'), expected: [[140, 119], [764, 119], [764, 243], [380, 243]] },
    { route: 'return-left', document: crossLane('return-left'), expected: [[48, 119], [20, 119], [20, 243], [288, 243]] },
    { route: 'bottom-channel', document: crossLane('bottom-channel'), expected: [[94, 145], [94, 301], [334, 301], [334, 269]] },
    { route: 'up-channel', document: crossLane('up-channel'), expected: [[94, 93], [94, 65], [334, 65], [334, 217]] },
    { route: 'outside-right partial', document: crossLane('outside-right', { fromSide: 'right' }), expected: [[140, 119], [764, 119], [764, 243], [380, 243]] },
  ];

  for (const fixture of cases) {
    const result = compileWorkflow({ workflow: fixture.document, qualityProfile: 'standard' });
    assert.equal(result.ok, true, `${fixture.route}: ${JSON.stringify(result.diagnostics, null, 2)}`);
    assert.deepEqual(result.receipt.edges[0].points, fixture.expected);
  }
});

test('readable-v2 treats an infeasible route preset as a candidate-family conflict, not a coordinate pin', () => {
  const document = workflow({
    lanes: [{ id: 'source', label: 'Source' }, { id: 'target', label: 'Target' }],
    nodes: [
      { id: 'a', lane: 'source', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'target', col: 2, type: 'backend', label: 'B' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b', route: 'straight' }],
  });

  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assert.equal(result.ok, false);
  assert.equal(result.svg, undefined);
  const diagnostic = result.diagnostics.find(({ code }) => code === 'workflow/route-preset-conflict');
  assert.ok(diagnostic);
  assert.ok(result.diagnostics.every(({ code }) => code !== 'workflow/explicit-pin-conflict'));
  assert.ok(diagnostic.supportedFixes.length > 0);
  assert.ok(diagnostic.supportedFixes.every((fix) => /^set edge |^remove route /.test(fix)));
  for (const fix of diagnostic.supportedFixes) {
    const repaired = clone(document);
    const preset = fix.match(/verified preset "([^"]+)"/)?.[1];
    if (preset) repaired.edges[0].route = preset;
    else delete repaired.edges[0].route;
    const verified = compileWorkflow({ workflow: repaired, qualityProfile: 'standard' });
    assert.equal(verified.ok, true, `advertised fix must recompile: ${fix}`);
  }
});

test('readable-v2 never accepts a same-lane drop through the preset-only fallback', () => {
  const document = oneLaneWorkflow([{
    id: 'ab',
    from: 'a',
    to: 'b',
    route: 'drop',
    fromSide: 'top',
    toSide: 'top',
  }]);
  document.nodes.forEach((node) => { node.yOffset = 20; });

  for (const qualityProfile of ['standard', 'showcase']) {
    const result = compileWorkflow({ workflow: clone(document), qualityProfile });
    assert.equal(result.ok, false);
    assert.equal(result.svg, undefined);
    assert.ok(result.diagnostics.some(({ code }) => code === 'workflow/route-preset-conflict'));
    assert.ok(result.diagnostics.every(({ code }) => code !== 'workflow/explicit-pin-conflict'));
  }
});

test('readable-v2 never silently ignores coordinate pins that conflict with a route preset', () => {
  const cases = [
    {
      name: 'straight with channelY',
      document: oneLaneWorkflow([{
        id: 'ab', from: 'a', to: 'b', route: 'straight', channelY: 300,
      }]),
    },
    {
      name: 'straight with channelX',
      document: oneLaneWorkflow([{
        id: 'ab', from: 'a', to: 'b', route: 'straight', channelX: 300,
      }]),
    },
    {
      name: 'drop with channelX',
      document: workflow({
        lanes: [{ id: 'source', label: 'Source' }, { id: 'target', label: 'Target' }],
        nodes: [
          { id: 'a', lane: 'source', col: 0, type: 'backend', label: 'A' },
          { id: 'b', lane: 'target', col: 0, type: 'backend', label: 'B' },
        ],
        edges: [{ id: 'ab', from: 'a', to: 'b', route: 'drop', channelX: 777 }],
      }),
    },
    ...[
      ['outside-right', 'channelY'],
      ['return-left', 'channelY'],
      ['bottom-channel', 'channelX'],
      ['up-channel', 'channelX'],
    ].map(([route, field]) => ({
      name: `${route} with ${field}`,
      document: oneLaneWorkflow([{
        id: 'ab', from: 'a', to: 'b', route, [field]: 300,
      }]),
    })),
  ];

  for (const { name, document } of cases) {
    let result;
    assert.doesNotThrow(() => {
      result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
    }, `${name} must stay inside the public compiler result boundary`);
    assertExplicitPinConflict(result, name);
    const diagnostic = result.diagnostics.find(({ code }) => code === 'workflow/explicit-pin-conflict');
    assert.equal(diagnostic.evidence.route, document.edges[0].route);
    assert.ok(diagnostic.evidence.conflictingPins.length > 0);
  }
});

test('readable-v2 preset compatibility reports both authored causal paths and verified repairs', () => {
  const document = oneLaneWorkflow([{
    id: 'ab', from: 'a', to: 'b', route: 'straight', channelY: 300,
  }]);
  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assertExplicitPinConflict(result, 'straight preset with channelY');
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.evidence.invariant, 'route preset compatibility');
  assert.deepEqual(diagnostic.evidence.conflictingPins, [
    {
      edge: 'ab', field: 'route', path: '/edges/0/route', value: 'straight',
    },
    {
      edge: 'ab', field: 'channelY', path: '/edges/0/channelY', value: 300,
    },
  ]);
  assert.deepEqual(diagnostic.supportedFixes, [
    'remove route from edge "ab" and keep the remaining verified route assertions',
    'remove channelY from edge "ab" and keep the remaining verified route assertions',
  ]);

  for (const field of ['route', 'channelY']) {
    const repaired = clone(document);
    delete repaired.edges[0][field];
    const verified = compileWorkflow({ workflow: repaired, qualityProfile: 'standard' });
    assert.equal(
      verified.ok,
      true,
      `removing ${field} must recompile:\n${JSON.stringify(verified.diagnostics, null, 2)}`,
    );
  }
});

test('readable-v2 rejects a raw via that does not belong to its route preset family', () => {
  const { start, end } = oneLaneAnchors();
  const document = oneLaneWorkflow([{
    id: 'ab',
    from: 'a',
    to: 'b',
    route: 'straight',
    via: [
      [start[0] + 20, start[1]],
      [start[0] + 20, start[1] + 40],
      [end[0] - 20, start[1] + 40],
      [end[0] - 20, end[1]],
    ],
  }]);

  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assertExplicitPinConflict(result, 'straight preset with a detouring via');
  const diagnostic = result.diagnostics.find(({ code }) => code === 'workflow/explicit-pin-conflict');
  assert.equal(diagnostic.evidence.route, 'straight');
  assert.equal(diagnostic.evidence.invariant, 'route preset compatibility');
});

for (const fixture of [
  {
    preset: 'straight',
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
    ],
    edge: { via: [[180, 119], [240, 119]] },
    expected: [[140, 119], [180, 119], [240, 119], [288, 119]],
  },
  {
    preset: 'drop',
    lanes: [{ id: 'source', label: 'Source' }, { id: 'target', label: 'Target' }],
    nodes: [
      { id: 'a', lane: 'source', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'target', col: 2, type: 'backend', label: 'B' },
    ],
    edge: { fromSide: 'bottom', toSide: 'top', via: [[94, 181], [334, 181]] },
    expected: [[94, 145], [94, 181], [334, 181], [334, 217]],
  },
  {
    preset: 'outside-right',
    lanes: [{ id: 'source', label: 'Source' }, { id: 'target', label: 'Target' }],
    nodes: [
      { id: 'a', lane: 'source', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'target', col: 2, type: 'backend', label: 'B' },
    ],
    edge: { fromSide: 'right', toSide: 'right', via: [[720, 119], [720, 243]] },
    expected: [[140, 119], [720, 119], [720, 243], [380, 243]],
  },
  {
    preset: 'return-left',
    lanes: [{ id: 'source', label: 'Source' }, { id: 'target', label: 'Target' }],
    nodes: [
      { id: 'a', lane: 'source', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'target', col: 2, type: 'backend', label: 'B' },
    ],
    edge: { fromSide: 'left', toSide: 'left', via: [[20, 119], [20, 243]] },
    expected: [[48, 119], [20, 119], [20, 243], [288, 243]],
  },
  {
    preset: 'bottom-channel',
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
    ],
    edge: { fromSide: 'bottom', toSide: 'bottom', via: [[94, 200], [334, 200]] },
    expected: [[94, 145], [94, 200], [334, 200], [334, 145]],
  },
  {
    preset: 'up-channel',
    lanes: [{ id: 'main', label: 'M' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
    ],
    edge: { fromSide: 'top', toSide: 'top', via: [[94, 20], [334, 20]] },
    expected: [[94, 93], [94, 20], [334, 20], [334, 93]],
  },
]) {
  test(`readable-v2 preserves a compatible ${fixture.preset} via without normalization`, () => {
    const document = workflow({
      lanes: fixture.lanes,
      nodes: fixture.nodes,
      edges: [{
        id: 'ab', from: 'a', to: 'b', route: fixture.preset, ...fixture.edge,
      }],
    });
    const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
    assert.deepEqual(result.receipt.edges[0].points, fixture.expected);
  });
}

test('readable-v2 keeps a compatible channel pin authoritative inside its route preset', () => {
  const document = workflow({
    lanes: [{ id: 'source', label: 'Source' }, { id: 'target', label: 'Target' }],
    nodes: [
      { id: 'a', lane: 'source', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'target', col: 2, type: 'backend', label: 'B' },
    ],
    edges: [{
      id: 'ab',
      from: 'a',
      to: 'b',
      route: 'drop',
      channelY: 181,
      fromSide: 'bottom',
      toSide: 'top',
    }],
  });

  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
  const points = result.receipt.edges.find(({ id }) => id === 'ab').points;
  assert.ok(
    points.slice(0, -1).some((point, index) => (
      point[1] === 181 && points[index + 1][1] === 181
    )),
    `the final path must contain the authored channelY: ${JSON.stringify(points)}`,
  );
});

for (const fixture of [
  {
    preset: 'outside-right', field: 'channelX', value: 720,
    lanes: [{ id: 'source', label: 'Source' }, { id: 'target', label: 'Target' }],
    nodes: [
      { id: 'a', lane: 'source', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'target', col: 2, type: 'backend', label: 'B' },
    ],
    sides: { fromSide: 'right', toSide: 'right' },
  },
  {
    preset: 'return-left', field: 'channelX', value: 20,
    lanes: [{ id: 'source', label: 'Source' }, { id: 'target', label: 'Target' }],
    nodes: [
      { id: 'a', lane: 'source', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'target', col: 2, type: 'backend', label: 'B' },
    ],
    sides: { fromSide: 'left', toSide: 'left' },
  },
  {
    preset: 'bottom-channel', field: 'channelY', value: 200,
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
    ],
    sides: { fromSide: 'bottom', toSide: 'bottom' },
  },
  {
    preset: 'up-channel', field: 'channelY', value: 20,
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
    ],
    sides: { fromSide: 'top', toSide: 'top' },
  },
]) {
  test(`readable-v2 keeps ${fixture.field} authoritative for ${fixture.preset}`, () => {
    const document = workflow({
      lanes: fixture.lanes,
      nodes: fixture.nodes,
      edges: [{
        id: 'ab',
        from: 'a',
        to: 'b',
        route: fixture.preset,
        [fixture.field]: fixture.value,
        ...fixture.sides,
      }],
    });
    const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics, null, 2));
    const points = result.receipt.edges[0].points;
    assert.ok(routeContainsChannel(points, fixture.field, fixture.value));
  });
}

for (const fixture of [
  {
    preset: 'outside-right', field: 'channelX', value: 20,
    sides: { fromSide: 'left', toSide: 'left' },
    crossLane: true,
  },
  {
    preset: 'return-left', field: 'channelX', value: 720,
    sides: { fromSide: 'right', toSide: 'right' },
    crossLane: true,
  },
  {
    preset: 'bottom-channel', field: 'channelY', value: 20,
    sides: { fromSide: 'top', toSide: 'top' },
  },
  {
    preset: 'up-channel', field: 'channelY', value: 340,
    sides: { fromSide: 'bottom', toSide: 'bottom' },
  },
  {
    preset: 'drop', field: 'channelY', value: 20,
    sides: { fromSide: 'top', toSide: 'top' },
  },
]) {
  test(`readable-v2 rejects ${fixture.preset} when its channel belongs to another route family`, () => {
    for (const qualityProfile of ['standard', 'showcase']) {
      const edges = [{
        id: 'ab',
        from: 'a',
        to: 'b',
        route: fixture.preset,
        [fixture.field]: fixture.value,
        ...fixture.sides,
      }];
      const document = fixture.crossLane
        ? workflow({
          lanes: [{ id: 'source', label: 'Source' }, { id: 'target', label: 'Target' }],
          nodes: [
            { id: 'a', lane: 'source', col: 0, type: 'backend', label: 'A' },
            { id: 'b', lane: 'target', col: 2, type: 'backend', label: 'B' },
          ],
          edges,
        })
        : oneLaneWorkflow(edges);
      const result = compileWorkflow({ workflow: document, qualityProfile });
      assertExplicitPinConflict(result, `${fixture.preset} ${fixture.field} under ${qualityProfile}`);
      const diagnostic = result.diagnostics.find(({ code }) => (
        code === 'workflow/explicit-pin-conflict'
      ));
      assert.equal(diagnostic.evidence.invariant, 'route preset compatibility');
    }
  });
}

test('readable-v2 treats channels beside via as assertions over the authored path', () => {
  const { start, end } = oneLaneAnchors();
  const document = oneLaneWorkflow([{
    id: 'ab',
    from: 'a',
    to: 'b',
    channelX: start[0] + 40,
    channelY: start[1] + 61,
    via: [
      [start[0] + 40, start[1]],
      [start[0] + 40, start[1] + 61],
      [end[0] - 48, start[1] + 61],
      [end[0] - 48, end[1]],
    ],
  }]);

  const matching = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assert.equal(matching.ok, true, JSON.stringify(matching.diagnostics, null, 2));
  assert.deepEqual(matching.receipt.edges[0].points, [start, ...document.edges[0].via, end]);

  const mismatched = clone(document);
  mismatched.edges[0].channelX += 1;
  const result = compileWorkflow({ workflow: mismatched, qualityProfile: 'standard' });
  assertExplicitPinConflict(result, 'via missing its asserted channelX');
  const diagnostic = result.diagnostics.find(({ code }) => code === 'workflow/explicit-pin-conflict');
  assert.equal(diagnostic.evidence.invariant, 'channel pin preservation');
  assert.deepEqual(
    diagnostic.evidence.conflictingPins.map(({ edge, field, path }) => ({ edge, field, path })),
    [
      { edge: 'ab', field: 'via', path: '/edges/0/via' },
      { edge: 'ab', field: 'channelX', path: '/edges/0/channelX' },
    ],
  );

  const nearButNotExact = clone(document);
  nearButNotExact.edges[0].channelX += 0.00005;
  const nearResult = compileWorkflow({
    workflow: nearButNotExact,
    qualityProfile: 'standard',
  });
  assertExplicitPinConflict(nearResult, 'channel assertions must preserve exact authored numbers');
  assert.equal(nearResult.diagnostics[0].evidence.invariant, 'channel pin preservation');
});

test('readable-v2 reports via and channelY as a minimal assertion conflict with two verified repairs', () => {
  const document = oneLaneWorkflow([{
    id: 'ab',
    from: 'a',
    to: 'b',
    via: [[94, 77], [334, 77]],
    channelY: 200,
  }]);

  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });

  assert.equal(result.ok, false);
  assert.equal(result.svg, undefined);
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics, null, 2));
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, 'workflow/explicit-pin-conflict');
  assert.equal(diagnostic.evidence.invariant, 'channel pin preservation');
  assert.deepEqual(diagnostic.evidence.conflictingPins, [
    {
      edge: 'ab',
      field: 'via',
      path: '/edges/0/via',
      value: [[94, 77], [334, 77]],
    },
    {
      edge: 'ab',
      field: 'channelY',
      path: '/edges/0/channelY',
      value: 200,
    },
  ]);
  assert.deepEqual(diagnostic.supportedFixes, [
    'remove via from edge "ab" and replan the remaining explicit route assertions',
    'remove channelY from edge "ab" and replan the remaining explicit route assertions',
  ]);

  for (const field of ['via', 'channelY']) {
    const repaired = clone(document);
    delete repaired.edges[0][field];
    const verified = compileWorkflow({ workflow: repaired, qualityProfile: 'standard' });
    assert.equal(
      verified.ok,
      true,
      `removing ${field} must recompile:\n${JSON.stringify(verified.diagnostics, null, 2)}`,
    );
  }
});

test('readable-v2 reports conflicts between absolute label and route pins as typed geometry', () => {
  const document = workflow({
    lanes: [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }],
    nodes: [
      { id: 'a', lane: 'top', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'top', col: 4, type: 'backend', label: 'B' },
      { id: 'c', lane: 'bottom', col: 0, type: 'backend', label: 'C' },
      { id: 'd', lane: 'bottom', col: 4, type: 'backend', label: 'D' },
    ],
    edges: [
      { id: 'labelpin', from: 'a', to: 'b', label: 'PIN', labelAt: [334, 243] },
      { id: 'routepin', from: 'c', to: 'd', via: [[334, 243]] },
    ],
  });

  const result = compileWorkflow({ workflow: document, qualityProfile: 'showcase' });
  assertExplicitPinConflict(result, 'labelAt crossing an authored via');
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.evidence.invariant, 'explicit label-route clearance');
  assert.deepEqual(diagnostic.evidence.conflictingPins.map(({ edge, field }) => ({ edge, field })), [
    { edge: 'labelpin', field: 'labelAt' },
    { edge: 'routepin', field: 'via' },
  ]);
  assert.equal(diagnostic.evidence.clearancePx, 0);
  assertSupportedFixesNameChangedEdge(diagnostic, ['labelpin', 'routepin']);
  assert.ok(
    diagnostic.supportedFixes.some((fix) => fix.includes('edge "routepin"')),
    `a routepin repair must identify routepin: ${diagnostic.supportedFixes}`,
  );
  assert.doesNotMatch(diagnostic.supportedFixes.join('\n'), /remove (?:one |the )?label(?!At)/i);
});

test('readable-v2 derives label-route pins from joint verified removals when route plans first', () => {
  const document = workflow({
    lanes: [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }],
    nodes: [
      { id: 'a', lane: 'top', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'top', col: 4, type: 'backend', label: 'B' },
      { id: 'c', lane: 'bottom', col: 0, type: 'backend', label: 'C' },
      { id: 'd', lane: 'bottom', col: 4, type: 'backend', label: 'D' },
    ],
    edges: [
      { id: 'a-route', from: 'c', to: 'd', via: [[334, 243]] },
      { id: 'z-label', from: 'a', to: 'b', label: 'PIN', labelAt: [334, 243] },
    ],
  });
  document.meta.quality_profile = 'showcase';

  const result = compileWorkflow({ workflow: document });
  assertExplicitPinConflict(result, 'route-first joint label-route conflict');
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.evidence.invariant, 'explicit label-route clearance');
  assert.deepEqual(diagnostic.evidence.conflictingPins, [{
    edge: 'z-label', field: 'labelAt', path: '/edges/1/labelAt', value: [334, 243],
  }]);
  assert.ok(diagnostic.supportedFixes.length > 0, JSON.stringify(diagnostic, null, 2));
  for (const fix of diagnostic.supportedFixes) {
    const replacement = fix.match(/^set labelAt on edge "z-label" to \[(-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)\]$/);
    assert.ok(replacement, `route removal is not causal and must not be advertised: ${fix}`);
    const repaired = clone(document);
    repaired.edges[1].labelAt = replacement.slice(1).map(Number);
    const verified = compileWorkflow({ workflow: repaired });
    assert.equal(verified.ok, true, `advertised label repair must recompile: ${fix}\n${JSON.stringify(verified.diagnostics, null, 2)}`);
  }
});

test('readable-v2 derives both causal pins when label plans before the authored route', () => {
  const document = workflow({
    lanes: [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }],
    nodes: [
      { id: 'a', lane: 'top', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'top', col: 4, type: 'backend', label: 'B' },
      { id: 'c', lane: 'bottom', col: 0, type: 'backend', label: 'C' },
      { id: 'd', lane: 'bottom', col: 4, type: 'backend', label: 'D' },
    ],
    edges: [
      { id: 'z-route', from: 'c', to: 'd', via: [[334, 243]] },
      { id: 'a-label', from: 'a', to: 'b', label: 'PIN', labelAt: [334, 243] },
    ],
  });
  document.meta.quality_profile = 'showcase';

  const result = compileWorkflow({ workflow: document });
  assertExplicitPinConflict(result, 'label-first joint label-route conflict');
  const diagnostic = result.diagnostics[0];
  assert.deepEqual(diagnostic.evidence.conflictingPins, [
    { edge: 'a-label', field: 'labelAt', path: '/edges/1/labelAt', value: [334, 243] },
    { edge: 'z-route', field: 'via', path: '/edges/0/via', value: [[334, 243]] },
  ]);
  assert.ok(
    diagnostic.supportedFixes.some((fix) => fix.startsWith('set labelAt on edge "a-label"')),
    JSON.stringify(diagnostic.supportedFixes, null, 2),
  );
  assert.ok(
    diagnostic.supportedFixes.includes('remove via from edge "z-route" so readable-v2 can replan the remaining authored label-route pins'),
    JSON.stringify(diagnostic.supportedFixes, null, 2),
  );
});

test('readable-v2 classifies an authored labelAt colliding with an earlier automatic route', () => {
  const document = workflow({
    lanes: [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }],
    nodes: [
      { id: 'a', lane: 'top', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'top', col: 4, type: 'backend', label: 'B' },
      { id: 'c', lane: 'bottom', col: 0, type: 'backend', label: 'C' },
      { id: 'd', lane: 'bottom', col: 4, type: 'backend', label: 'D' },
    ],
    edges: [
      { id: 'a-route', from: 'c', to: 'd' },
      { id: 'z-label', from: 'a', to: 'b', label: 'PIN', labelAt: [334, 243] },
    ],
  });
  document.meta.quality_profile = 'showcase';

  const result = compileWorkflow({ workflow: document });
  assertExplicitPinConflict(result, 'labelAt colliding with an earlier automatic route');
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.evidence.invariant, 'explicit label-route clearance');
  assert.equal(diagnostic.subject.path, '/edges/1/labelAt');
  assert.deepEqual(diagnostic.evidence.conflictingPins, [{
    edge: 'z-label',
    field: 'labelAt',
    path: '/edges/1/labelAt',
    value: [334, 243],
  }]);
  assert.deepEqual(diagnostic.evidence.labelAt, [334, 243]);
  assert.deepEqual(diagnostic.evidence.collidedRoute, {
    edge: 'a-route',
    from: 'c',
    to: 'd',
    points: [[140, 243], [528, 243]],
  });
  assert.deepEqual(diagnostic.evidence.routeSegment, {
    from: [140, 243],
    to: [528, 243],
  });

  for (const fix of diagnostic.supportedFixes) {
    const replacement = fix.match(/^set labelAt on edge "z-label" to \[(-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)\]$/);
    assert.ok(replacement, `only a concrete labelAt alternative may be advertised: ${fix}`);
    const repaired = clone(document);
    repaired.edges[1].labelAt = replacement.slice(1).map(Number);
    const verified = compileWorkflow({ workflow: repaired });
    assert.equal(verified.ok, true, `advertised labelAt alternative must recompile: ${fix}\n${JSON.stringify(verified.diagnostics, null, 2)}`);
  }
});

test('readable-v2 classifies an automatic label colliding with a later authored route', () => {
  const document = workflow({
    lanes: [
      { id: 'top', label: 'Top' },
      { id: 'mid', label: 'Mid' },
      { id: 'bottom', label: 'Bottom' },
    ],
    nodes: [
      { id: 'a', lane: 'mid', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'mid', col: 4, type: 'backend', label: 'B' },
      { id: 'c', lane: 'top', col: 2, type: 'backend', label: 'C' },
      { id: 'd', lane: 'bottom', col: 2, type: 'backend', label: 'D' },
    ],
    edges: [
      { id: 'a-label', from: 'a', to: 'b', label: 'AUTO' },
      { id: 'z-route', from: 'c', to: 'd', via: [[334, 243]] },
    ],
  });
  document.meta.quality_profile = 'showcase';

  const result = compileWorkflow({ workflow: document });
  assertExplicitPinConflict(result, 'automatic label colliding with a later authored route');
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.evidence.invariant, 'explicit label-route clearance');
  assert.equal(diagnostic.subject.path, '/edges/1/via');
  assert.deepEqual(diagnostic.evidence.conflictingPins, [{
    edge: 'z-route',
    field: 'via',
    path: '/edges/1/via',
    value: [[334, 243]],
  }]);
  assert.deepEqual(diagnostic.evidence.collidedRoute, {
    edge: 'z-route',
    from: 'c',
    to: 'd',
    points: [[334, 145], [334, 243], [334, 341]],
  });
  assert.deepEqual(diagnostic.evidence.routeSegment, {
    from: [334, 145],
    to: [334, 341],
  });

  assert.ok(diagnostic.supportedFixes.length > 0, JSON.stringify(diagnostic, null, 2));
  for (const fix of diagnostic.supportedFixes) {
    assert.equal(
      fix,
      'remove via from edge "z-route" so readable-v2 can replan the remaining authored route assertions',
    );
    const repaired = clone(document);
    delete repaired.edges[1].via;
    const verified = compileWorkflow({ workflow: repaired });
    assert.equal(verified.ok, true, `advertised route alternative must recompile: ${fix}\n${JSON.stringify(verified.diagnostics, null, 2)}`);
  }
});

test('readable-v2 classifies an authored labelAt colliding with an earlier automatic label', () => {
  const document = oneLaneWorkflow([
    { id: 'a-auto', from: 'a', to: 'b', label: 'AUTO' },
    { id: 'z-pin', from: 'a', to: 'b', label: 'PIN', labelAt: [214, 119] },
  ]);
  document.meta.quality_profile = 'showcase';

  const result = compileWorkflow({ workflow: document });
  assertExplicitPinConflict(result, 'labelAt colliding with an earlier automatic label');
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.evidence.invariant, 'explicit label-label clearance');
  assert.equal(diagnostic.subject.path, '/edges/1/labelAt');
  assert.deepEqual(diagnostic.evidence.conflictingPins, [{
    edge: 'z-pin',
    field: 'labelAt',
    path: '/edges/1/labelAt',
    value: [214, 119],
  }]);
  assert.deepEqual(diagnostic.evidence.labelRects.map(({ edge, ...rect }) => ({ edge, ...rect })), [
    { edge: 'z-pin', x: 199, y: 109, width: 30, height: 14 },
    { edge: 'a-auto', x: 199, y: 99, width: 30, height: 14 },
  ]);

  for (const fix of diagnostic.supportedFixes) {
    const replacement = fix.match(/^set labelAt on edge "z-pin" to \[(-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)\]$/);
    assert.ok(replacement, `only a concrete labelAt alternative may be advertised: ${fix}`);
    const repaired = clone(document);
    repaired.edges[1].labelAt = replacement.slice(1).map(Number);
    const verified = compileWorkflow({ workflow: repaired });
    assert.equal(verified.ok, true, `advertised labelAt alternative must recompile: ${fix}\n${JSON.stringify(verified.diagnostics, null, 2)}`);
  }
});

test('readable-v2 derives the causal labelAt from joint verified label removals', () => {
  const document = workflow({
    lanes: [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }],
    nodes: [
      { id: 'a', lane: 'top', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'top', col: 4, type: 'backend', label: 'B' },
      { id: 'c', lane: 'bottom', col: 0, type: 'backend', label: 'C' },
      { id: 'd', lane: 'bottom', col: 4, type: 'backend', label: 'D' },
    ],
    edges: [
      { id: 'a-label', from: 'a', to: 'b', label: 'FIRST', labelAt: [334, 119] },
      { id: 'z-label', from: 'c', to: 'd', label: 'SECOND', labelAt: [334, 119] },
    ],
  });
  document.meta.quality_profile = 'showcase';

  const result = compileWorkflow({ workflow: document });
  assertExplicitPinConflict(result, 'joint causal label-label conflict');
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.evidence.invariant, 'explicit label-label clearance');
  assert.deepEqual(diagnostic.evidence.conflictingPins, [{
    edge: 'z-label', field: 'labelAt', path: '/edges/1/labelAt', value: [334, 119],
  }]);
  assert.ok(diagnostic.supportedFixes.length > 0, JSON.stringify(diagnostic, null, 2));
  for (const fix of diagnostic.supportedFixes) {
    const replacement = fix.match(/^set labelAt on edge "z-label" to \[(-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)\]$/);
    assert.ok(replacement, `only the causal label pin may be changed: ${fix}`);
    const repaired = clone(document);
    repaired.edges[1].labelAt = replacement.slice(1).map(Number);
    const verified = compileWorkflow({ workflow: repaired });
    assert.equal(verified.ok, true, `advertised label repair must recompile: ${fix}\n${JSON.stringify(verified.diagnostics, null, 2)}`);
  }
});

test('readable-v2 reports conflicts between two absolute label pins without deleting semantics', () => {
  const document = oneLaneWorkflow([
    {
      id: 'one', from: 'a', to: 'b', label: 'ONE', via: [[214, 119]], labelAt: [214, 80],
    },
    {
      id: 'two', from: 'a', to: 'b', label: 'TWO', via: [[214, 119]], labelAt: [214, 80],
    },
  ]);

  for (const qualityProfile of ['standard', 'showcase']) {
    const result = compileWorkflow({ workflow: clone(document), qualityProfile });
    assertExplicitPinConflict(result, `overlapping labelAt pins under ${qualityProfile}`);
    const diagnostic = result.diagnostics[0];
    assert.equal(diagnostic.evidence.invariant, 'explicit label-label clearance');
    assert.deepEqual(diagnostic.evidence.conflictingPins.map(({ edge, field }) => ({ edge, field })), [
      { edge: 'one', field: 'labelAt' },
      { edge: 'two', field: 'labelAt' },
    ]);
    assertSupportedFixesNameChangedEdge(diagnostic, ['one', 'two']);
    assert.doesNotMatch(diagnostic.supportedFixes.join('\n'), /remove (?:one |the )?label(?!At)/i);
  }
});

test('readable-v2 reports showcase crossings between two absolute route pins', () => {
  const document = workflow({
    lanes: [
      { id: 'top', label: 'Top' },
      { id: 'middle', label: 'Middle' },
      { id: 'bottom', label: 'Bottom' },
    ],
    nodes: [
      { id: 'left', lane: 'middle', col: 0, type: 'backend', label: 'Left' },
      { id: 'right', lane: 'middle', col: 4, type: 'backend', label: 'Right' },
      { id: 'above', lane: 'top', col: 2, type: 'backend', label: 'Above' },
      { id: 'below', lane: 'bottom', col: 2, type: 'backend', label: 'Below' },
    ],
    edges: [
      { id: 'horizontal', from: 'left', to: 'right', via: [[250, 243]] },
      { id: 'vertical', from: 'above', to: 'below', via: [[334, 200]] },
    ],
  });

  const result = compileWorkflow({ workflow: document, qualityProfile: 'showcase' });
  assertExplicitPinConflict(result, 'two crossing absolute routes');
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.evidence.invariant, 'explicit route-route crossing');
  assert.deepEqual(diagnostic.evidence.point, [334, 243]);
  assertSupportedFixesNameChangedEdge(diagnostic, ['horizontal', 'vertical']);
  assert.ok(
    diagnostic.supportedFixes.some((fix) => fix.includes('edge "vertical"')),
    `a vertical repair must identify vertical: ${diagnostic.supportedFixes}`,
  );
});

test('readable-v2 catches an automatic route crossing exactly at an authored straight-through via', () => {
  const document = crossingAtForwardCollinearViaWorkflow();
  const standard = compileWorkflow({ workflow: clone(document), qualityProfile: 'standard' });
  assert.equal(standard.ok, true, JSON.stringify(standard.diagnostics, null, 2));
  assert.deepEqual(
    standard.receipt.edges.find(({ id }) => id === 'z-pinned').points,
    [[334, 145], [334, 243], [334, 341]],
    'analysis must not remove the authored via from the receipt',
  );

  const result = compileWorkflow({ workflow: document, qualityProfile: 'showcase' });
  assertExplicitPinConflict(result, 'an automatic route crossing at an authored straight-through via');
  const diagnostic = result.diagnostics.find(({ code }) => code === 'workflow/explicit-pin-conflict');
  assert.equal(diagnostic.evidence.invariant, 'explicit route-route crossing');
  assert.deepEqual(diagnostic.evidence.point, [334, 243]);
  assert.deepEqual(diagnostic.evidence.conflictingPins, [{
    edge: 'z-pinned',
    field: 'via',
    path: '/edges/1/via',
    value: [[334, 243]],
  }]);
  assert.equal(diagnostic.subject.edge, 'z-pinned');
  assert.equal(diagnostic.subject.path, '/edges/1/via');
  assertSupportedFixesNameChangedEdge(diagnostic, ['z-pinned']);
});

test('readable-v2 catches two pinned routes crossing exactly at their straight-through vias', () => {
  const document = crossingAtForwardCollinearViaWorkflow({ pinHorizontal: true });
  const standard = compileWorkflow({ workflow: clone(document), qualityProfile: 'standard' });
  assert.equal(standard.ok, true, JSON.stringify(standard.diagnostics, null, 2));
  assert.deepEqual(
    standard.receipt.edges.map(({ id, points }) => ({ id, points })),
    [
      { id: 'a-pinned', points: [[140, 243], [334, 243], [528, 243]] },
      { id: 'z-pinned', points: [[334, 145], [334, 243], [334, 341]] },
    ],
    'analysis must retain both authored straight-through vias in the receipt',
  );

  const result = compileWorkflow({ workflow: document, qualityProfile: 'showcase' });
  assertExplicitPinConflict(result, 'two pinned routes crossing at straight-through vias');
  const diagnostic = result.diagnostics.find(({ code }) => code === 'workflow/explicit-pin-conflict');
  assert.equal(diagnostic.evidence.invariant, 'explicit route-route crossing');
  assert.deepEqual(diagnostic.evidence.point, [334, 243]);
  assert.deepEqual(diagnostic.evidence.conflictingPins, [
    { edge: 'a-pinned', field: 'via', path: '/edges/0/via', value: [[334, 243]] },
    { edge: 'z-pinned', field: 'via', path: '/edges/1/via', value: [[334, 243]] },
  ]);
  assertSupportedFixesNameChangedEdge(diagnostic, ['a-pinned', 'z-pinned']);
});

test('readable-v2 classifies a side-only authored route crossing an automatic route', () => {
  const document = workflow({
    lanes: ['l0', 'l1', 'l2'].map((id) => ({ id, label: id })),
    nodes: [
      { id: 'n00', lane: 'l0', col: 0, type: 'backend', label: 'N00' },
      { id: 'n01', lane: 'l0', col: 1, type: 'backend', label: 'N01' },
      { id: 'n02', lane: 'l0', col: 2, type: 'backend', label: 'N02' },
      { id: 'n11', lane: 'l1', col: 1, type: 'backend', label: 'N11' },
    ],
    edges: [
      { id: 'a-auto', from: 'n00', to: 'n01' },
      { id: 'z-side', from: 'n02', to: 'n11', fromSide: 'top', toSide: 'left' },
    ],
  });
  document.meta.quality_profile = 'showcase';

  const result = compileWorkflow({ workflow: document });
  assertExplicitPinConflict(result, 'side-only route crossing an automatic route');
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.evidence.invariant, 'explicit route-route crossing');
  assert.ok(diagnostic.evidence.conflictingPins.length > 0);
  assert.ok(diagnostic.evidence.conflictingPins.every(({ edge, field, path, value }) => (
    edge === 'z-side'
    && ['fromSide', 'toSide'].includes(field)
    && path === `/edges/1/${field}`
    && value === document.edges[1][field]
  )), JSON.stringify(diagnostic.evidence.conflictingPins, null, 2));
  assert.ok(diagnostic.supportedFixes.length > 0, JSON.stringify(diagnostic, null, 2));

  for (const fix of diagnostic.supportedFixes) {
    const removal = fix.match(/^remove (fromSide|toSide)(?: and (fromSide|toSide))? from edge "z-side" /);
    assert.ok(removal, `supported fix must be a concrete side-pin removal: ${fix}`);
    const repaired = clone(document);
    for (const field of removal.slice(1).filter(Boolean)) delete repaired.edges[1][field];
    const verified = compileWorkflow({ workflow: repaired });
    assert.equal(verified.ok, true, `advertised side-pin repair must recompile: ${fix}\n${JSON.stringify(verified.diagnostics, null, 2)}`);
  }
});

test('readable-v2 classifies a side-only authored route sharing an automatic corridor', () => {
  const document = workflow({
    lanes: ['l0', 'l1', 'l2'].map((id) => ({ id, label: id })),
    nodes: [
      { id: 'n00', lane: 'l0', col: 0, type: 'backend', label: 'N00' },
      { id: 'n02', lane: 'l0', col: 2, type: 'backend', label: 'N02' },
      { id: 'n01', lane: 'l0', col: 1, type: 'backend', label: 'N01' },
      { id: 'n03', lane: 'l0', col: 3, type: 'backend', label: 'N03' },
    ],
    edges: [
      { id: 'a-auto', from: 'n00', to: 'n02' },
      { id: 'z-side', from: 'n01', to: 'n03', fromSide: 'bottom', toSide: 'top' },
    ],
  });
  document.meta.quality_profile = 'showcase';

  const result = compileWorkflow({ workflow: document });
  assertExplicitPinConflict(result, 'side-only route sharing an automatic corridor');
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.evidence.invariant, 'explicit route-route corridor clearance');
  assert.deepEqual(diagnostic.evidence.overlapStart, [214, 161]);
  assert.deepEqual(diagnostic.evidence.overlapEnd, [334, 161]);
  assert.equal(diagnostic.evidence.overlapLengthPx, 120);
  assert.ok(diagnostic.evidence.conflictingPins.length > 0);
  assert.ok(diagnostic.evidence.conflictingPins.every(({ edge, field, path, value }) => (
    edge === 'z-side'
    && ['fromSide', 'toSide'].includes(field)
    && path === `/edges/1/${field}`
    && value === document.edges[1][field]
  )), JSON.stringify(diagnostic.evidence.conflictingPins, null, 2));
  assert.ok(diagnostic.supportedFixes.length > 0, JSON.stringify(diagnostic, null, 2));

  for (const fix of diagnostic.supportedFixes) {
    const removal = fix.match(/^remove (fromSide|toSide)(?: and (fromSide|toSide))? from edge "z-side" /);
    assert.ok(removal, `supported fix must be a concrete side-pin removal: ${fix}`);
    const repaired = clone(document);
    for (const field of removal.slice(1).filter(Boolean)) delete repaired.edges[1][field];
    const verified = compileWorkflow({ workflow: repaired });
    assert.equal(verified.ok, true, `advertised side-pin repair must recompile: ${fix}\n${JSON.stringify(verified.diagnostics, null, 2)}`);
  }
});

test('readable-v2 classifies a preset-only route sharing an automatic corridor', () => {
  const document = workflow({
    lanes: [{ id: 'l0', label: 'l0' }, { id: 'l1', label: 'l1' }],
    nodes: [
      { id: 'n00', lane: 'l0', col: 0, type: 'backend', label: 'N00' },
      { id: 'n11', lane: 'l1', col: 1, type: 'backend', label: 'N11' },
      { id: 'n01', lane: 'l0', col: 1, type: 'backend', label: 'N01' },
      { id: 'n02', lane: 'l0', col: 2, type: 'backend', label: 'N02' },
    ],
    edges: [
      { id: 'a-auto', from: 'n00', to: 'n11' },
      { id: 'z-route', from: 'n01', to: 'n02', route: 'bottom-channel' },
    ],
  });
  document.meta.quality_profile = 'showcase';

  const result = compileWorkflow({ workflow: document });
  assertExplicitPinConflict(result, 'preset-only route sharing an automatic corridor');
  const diagnostic = result.diagnostics[0];
  assert.equal(diagnostic.evidence.invariant, 'explicit route-route corridor clearance');
  assert.deepEqual(diagnostic.subject, {
    diagramType: 'workflow',
    edge: 'z-route',
    from: 'n01',
    to: 'n02',
    path: '/edges/1/route',
  });
  assert.deepEqual(diagnostic.evidence.conflictingPins, [{
    edge: 'z-route',
    field: 'route',
    path: '/edges/1/route',
    value: 'bottom-channel',
  }]);
  assert.deepEqual(diagnostic.evidence.overlapStart, [214, 166]);
  assert.deepEqual(diagnostic.evidence.overlapEnd, [214, 177]);
  assert.equal(diagnostic.evidence.overlapLengthPx, 11);
  assert.deepEqual(diagnostic.supportedFixes, [
    'remove route from edge "z-route" so readable-v2 can replan the remaining authored route assertions',
  ]);

  const repaired = clone(document);
  delete repaired.edges[1].route;
  const verified = compileWorkflow({ workflow: repaired });
  assert.equal(verified.ok, true, JSON.stringify(verified.diagnostics, null, 2));
});

test('readable-v2 reports unknown edge endpoints with a precise semantic diagnostic', () => {
  const document = oneLaneWorkflow([{ id: 'ab', from: 'a', to: 'ghost' }]);
  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, 'workflow/unknown-edge-endpoint');
  assert.equal(result.diagnostics[0].subject.edge, 'ab');
  assert.equal(result.diagnostics[0].subject.path, '/edges/0/to');
  assert.deepEqual(result.diagnostics[0].evidence, {
    endpoint: 'target',
    unknownNodeId: 'ghost',
    availableNodeIds: ['a', 'b'],
  });
});

test('unknown endpoint diagnostics retain the authored edge pointer after canonical sorting', () => {
  const document = oneLaneWorkflow([
    { id: 'z-valid', from: 'a', to: 'b' },
    { id: 'a-invalid', from: 'a', to: 'ghost' },
  ]);

  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });

  assert.equal(result.ok, false);
  assert.equal(result.svg, undefined);
  assert.equal(result.diagnostics.length, 1);
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, 'workflow/unknown-edge-endpoint');
  assert.equal(diagnostic.subject.edge, 'a-invalid');
  assert.equal(diagnostic.subject.path, '/edges/1/to');
  assert.equal(diagnostic.evidence.endpoint, 'target');
  assert.equal(diagnostic.evidence.unknownNodeId, 'ghost');
  assert.ok(diagnostic.supportedFixes.length > 0);
});

test('unknown node lane diagnostics retain the authored node pointer after canonical sorting', () => {
  const document = oneLaneWorkflow([]);
  document.nodes[0].lane = 'ghost';

  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });

  assert.equal(result.ok, false);
  assert.equal(result.svg, undefined);
  assert.equal(result.diagnostics.length, 1);
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, 'workflow/unknown-node-lane');
  assert.equal(diagnostic.subject.node, 'a');
  assert.equal(diagnostic.subject.path, '/nodes/0/lane');
  assert.deepEqual(diagnostic.evidence, {
    unknownLaneId: 'ghost',
    availableLaneIds: ['main'],
  });
  assert.ok(diagnostic.supportedFixes.length > 0);
});

for (const fixture of [
  {
    name: 'lane id',
    code: 'workflow/duplicate-lane-id',
    expectedSubject: { lane: 'main', path: '/lanes/1/id' },
    expectedEvidence: {
      duplicateLaneId: 'main',
      firstPath: '/lanes/0/id',
      duplicatePath: '/lanes/1/id',
    },
    mutate(document) {
      document.lanes.push({ id: 'main', label: 'Duplicate Main' });
    },
  },
  {
    name: 'node id',
    code: 'workflow/duplicate-node-id',
    expectedSubject: { node: 'a', path: '/nodes/2/id' },
    expectedEvidence: {
      duplicateNodeId: 'a',
      firstPath: '/nodes/0/id',
      duplicatePath: '/nodes/2/id',
    },
    mutate(document) {
      document.nodes.push({
        id: 'a', lane: 'main', col: 4, type: 'database', label: 'Duplicate A',
      });
    },
  },
]) {
  test(`duplicate ${fixture.name} diagnostics name both authored source pointers`, () => {
    const document = oneLaneWorkflow([]);
    fixture.mutate(document);

    const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });

    assert.equal(result.ok, false);
    assert.equal(result.svg, undefined);
    assert.equal(result.diagnostics.length, 1);
    const [diagnostic] = result.diagnostics;
    assert.equal(diagnostic.code, fixture.code);
    assert.deepEqual(
      diagnostic.subject,
      { diagramType: 'workflow', ...fixture.expectedSubject },
    );
    assert.deepEqual(diagnostic.evidence, fixture.expectedEvidence);
    assert.ok(diagnostic.supportedFixes.length > 0);
  });
}

test('showcase rejects nested authored outside-right corridors while standard permits them', () => {
  const document = nestedOutsideRightCorridorWorkflow();

  const standard = compileWorkflow({ workflow: clone(document), qualityProfile: 'standard' });
  assert.equal(standard.ok, true, JSON.stringify(standard.diagnostics, null, 2));

  const showcase = compileWorkflow({ workflow: clone(document), qualityProfile: 'showcase' });
  assertExplicitPinConflict(showcase, 'nested authored outside-right corridors');
  const diagnostic = showcase.diagnostics.find(({ code }) => (
    code === 'workflow/explicit-pin-conflict'
  ));
  assertSupportedFixesNameChangedEdge(diagnostic, ['inner', 'outer']);
  assert.deepEqual(
    diagnostic.evidence.conflictingPins.map(({ edge, field, value }) => ({ edge, field, value })),
    [{ edge: 'inner', field: 'channelX', value: 800 }],
  );
  assert.deepEqual(diagnostic.supportedFixes, [
    'remove channelX from edge "inner" so readable-v2 can replan the remaining authored route assertions',
  ]);
  const repaired = clone(document);
  delete repaired.edges.find(({ id }) => id === 'inner').channelX;
  const verified = compileWorkflow({ workflow: repaired, qualityProfile: 'showcase' });
  assert.equal(verified.ok, true, JSON.stringify(verified.diagnostics, null, 2));
});

test('an explicit standard profile overrides an ambient showcase profile', () => {
  const document = nestedOutsideRightCorridorWorkflow();
  document.meta.quality_profile = 'showcase';
  const previousProfile = process.env.ARCHIFY_QUALITY_PROFILE;

  try {
    process.env.ARCHIFY_QUALITY_PROFILE = 'showcase';
    const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
    assert.equal(
      result.ok,
      true,
      `the explicit standard profile must win:\n${JSON.stringify(result.diagnostics, null, 2)}`,
    );
  } finally {
    if (previousProfile === undefined) delete process.env.ARCHIFY_QUALITY_PROFILE;
    else process.env.ARCHIFY_QUALITY_PROFILE = previousProfile;
  }
});

test('readable-v2 never advertises an unverified blocking-node repair', () => {
  const document = workflow({
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [{ id: 'a', lane: 'main', col: 0, type: 'backend', label: 'A' }],
    edges: [{ id: 'self', from: 'a', to: 'a' }],
  });

  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assert.equal(result.ok, false);
  const diagnostic = result.diagnostics.find(({ code }) => code === 'workflow/solver-budget-exhausted');
  assert.ok(diagnostic, JSON.stringify(result.diagnostics, null, 2));
  assert.deepEqual(diagnostic.supportedFixes, []);
});

for (const { name, makeVia } of [
  {
    name: 'a 4px endpoint stub',
    makeVia: ({ start, end }) => [
      [start[0] + 4, start[1]],
      [start[0] + 4, start[1] + 41],
      [end[0], start[1] + 41],
    ],
  },
  {
    name: 'a 12px interior turn segment',
    makeVia: ({ start }) => [
      [start[0] + 20, start[1]],
      [start[0] + 20, start[1] + 31],
      [start[0] + 32, start[1] + 31],
      [start[0] + 32, start[1]],
    ],
  },
]) {
  test(`standard profile rejects ${name} as a hard route constraint`, () => {
    const via = makeVia(oneLaneAnchors());
    const result = compileWorkflow({
      workflow: oneLaneWorkflow([{ id: 'ab', from: 'a', to: 'b', via }]),
      qualityProfile: 'standard',
    });
    assert.equal(result.ok, false, `${name} must be invalid in standard as well as showcase`);
    assert.ok(Array.isArray(result.diagnostics) && result.diagnostics.length > 0);
  });
}

test('readable-v2 reports collapsed channel pins without escaping the compiler boundary', () => {
  const { start } = oneLaneAnchors();
  for (const pin of [
    { channelX: start[0] },
    { channelY: start[1] },
  ]) {
    let result;
    assert.doesNotThrow(() => {
      result = compileWorkflow({
        workflow: oneLaneWorkflow([{ id: 'ab', from: 'a', to: 'b', ...pin }]),
        qualityProfile: 'standard',
      });
    });
    assertExplicitPinConflict(result, JSON.stringify(pin));
    assert.ok(result.diagnostics.some(({ evidence }) => (
      evidence?.invariant === 'non-zero route segments'
    )));
  }
});

test('parallel anonymous edges remain byte-deterministic when their input order changes', () => {
  const document = oneLaneWorkflow([
    { from: 'a', to: 'b', variant: 'default', role: 'main' },
    { from: 'a', to: 'b', variant: 'dashed', role: 'async' },
  ]);
  const reordered = clone(document);
  reordered.edges.reverse();

  const first = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  const second = compileWorkflow({ workflow: reordered, qualityProfile: 'standard' });
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics, null, 2));
  assert.equal(second.ok, true, JSON.stringify(second.diagnostics, null, 2));
  assert.equal(second.svg, first.svg);
  assert.equal(JSON.stringify(second.receipt), JSON.stringify(first.receipt));
});

test('compileWorkflow returns a diagnostic result instead of throwing when meta is absent', () => {
  const document = oneLaneWorkflow([]);
  delete document.meta;

  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assert.equal(result.ok, false);
  assert.equal(result.svg, undefined);
  assert.ok(Array.isArray(result.diagnostics) && result.diagnostics.length > 0);
});

test('compileWorkflow returns typed failures for non-document public inputs without throwing', () => {
  for (const input of [undefined, null, [], {}]) {
    const result = compileWorkflow({ workflow: input });
    assert.equal(result.ok, false);
    assert.equal(result.svg, undefined);
    assert.ok(Array.isArray(result.diagnostics) && result.diagnostics.length > 0);
    assert.ok(result.diagnostics.every(({ code }) => code !== 'internal/unclassified'));
    assert.ok(result.diagnostics.every(({ supportedFixes }) => (
      Array.isArray(supportedFixes) && supportedFixes.length === 0
    )));
    assert.deepEqual(result.receipt.diagnostics, result.diagnostics);
  }
});

test('compileWorkflow enforces the canonical workflow schema at its public boundary', () => {
  for (const { expectedCode, mutate, qualityProfile } of [
    { expectedCode: 'schema/additionalProperties', mutate: (document) => { document.unsupported = true; } },
    { expectedCode: 'schema/enum', mutate: (document) => { document.nodes[0].type = 'bogus'; } },
    { expectedCode: 'schema/minimum', mutate: (document) => { document.nodes[0].width = 31; } },
    { expectedCode: 'schema/required', mutate: (document) => { delete document.nodes[0].label; } },
    { expectedCode: 'schema/enum', mutate: () => {}, qualityProfile: 'impossible' },
  ]) {
    const document = oneLaneWorkflow([]);
    mutate(document);
    const result = compileWorkflow({ workflow: document, qualityProfile });
    assert.equal(result.ok, false);
    assert.equal(result.svg, undefined);
    assert.ok(
      result.diagnostics.some(({ code }) => code === expectedCode),
      JSON.stringify(result.diagnostics, null, 2),
    );
    assert.ok(result.diagnostics.every(({ code }) => code !== 'internal/unclassified'));
    assert.ok(result.diagnostics.every(({ supportedFixes }) => (
      Array.isArray(supportedFixes) && supportedFixes.length === 0
    )));
    assert.deepEqual(result.receipt.diagnostics, result.diagnostics);
  }
});

test('readable-v2 rejects a negative absolute label pin without an explicit viewBox', () => {
  const document = oneLaneWorkflow([{
    id: 'ab', from: 'a', to: 'b', label: 'pinned', labelAt: [-20, 80],
  }]);
  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assert.equal(result.ok, false);
  assert.equal(result.svg, undefined);
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics, null, 2));
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, 'workflow/explicit-pin-conflict');
  assert.deepEqual(diagnostic.subject, {
    diagramType: 'workflow',
    edge: 'ab',
    from: 'a',
    to: 'b',
    path: '/edges/0/labelAt',
  });
  assert.equal(diagnostic.evidence.invariant, 'viewBox-origin containment');
  assert.deepEqual(diagnostic.evidence.conflictingPins, [{
    edge: 'ab',
    field: 'labelAt',
    path: '/edges/0/labelAt',
    value: [-20, 80],
  }]);
  assert.deepEqual(diagnostic.evidence.offendingRect, {
    x: -39.4,
    y: 70,
    width: 38.8,
    height: 14,
  });
  assert.deepEqual(result.receipt.diagnostics, result.diagnostics);

  assert.ok(diagnostic.supportedFixes.length > 0);
  for (const fix of diagnostic.supportedFixes) {
    const repaired = clone(document);
    const target = repaired.edges.find(({ id }) => fix.includes(`edge "${id}"`));
    assert.ok(target, `supported fix must name an existing edge: ${fix}`);
    const replacement = fix.match(/^set labelAt on edge "[^"]+" to \[(-?\d+(?:\.\d+)?), (-?\d+(?:\.\d+)?)\]$/);
    if (replacement) {
      target.labelAt = replacement.slice(1).map(Number);
    } else {
      assert.match(fix, /^remove labelAt from edge "[^"]+" /);
      delete target.labelAt;
    }
    const verified = compileWorkflow({ workflow: repaired, qualityProfile: 'standard' });
    assert.equal(verified.ok, true, `advertised fix must recompile: ${fix}\n${JSON.stringify(verified.diagnostics, null, 2)}`);
  }
});

test('readable-v2 rejects an explicit channel that crosses the measured legend', () => {
  const document = oneLaneWorkflow([{
    id: 'ab',
    from: 'a',
    to: 'b',
    route: 'bottom-channel',
    channelY: 200,
    fromSide: 'bottom',
    toSide: 'bottom',
  }]);
  document.meta.legend = { mode: 'all' };
  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assertExplicitPinConflict(result, 'legend-crossing channelY');
  assert.ok(result.diagnostics.some(({ evidence }) => evidence?.invariant === 'legend clearance'));
});

test('readable-v2 explicit-pin diagnostics name the first intersected node and segment', () => {
  const document = workflow({
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 0, type: 'backend', label: 'A' },
      { id: 'obstacle', lane: 'main', col: 1, type: 'database', label: 'Obstacle' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
    ],
    edges: [{
      id: 'ab',
      from: 'a',
      to: 'b',
      fromSide: 'right',
      toSide: 'left',
      via: [[200, 119], [260, 119]],
    }],
  });

  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assertExplicitPinConflict(result, 'unrelated node collision');
  const diagnostic = result.diagnostics.find(({ code }) => code === 'workflow/explicit-pin-conflict');
  assert.equal(diagnostic.evidence.invariant, 'node clearance');
  assert.deepEqual({
    obstacleNode: diagnostic.evidence.obstacleNode,
    obstacleRole: diagnostic.evidence.obstacleRole,
    segmentIndex: diagnostic.evidence.segmentIndex,
    from: diagnostic.evidence.from,
    to: diagnostic.evidence.to,
    clearancePx: diagnostic.evidence.clearancePx,
  }, {
    obstacleNode: 'obstacle',
    obstacleRole: 'unrelated',
    segmentIndex: 0,
    from: [140, 119],
    to: [200, 119],
    clearancePx: 2,
  });
});

test('fixed-v1 publishes only repairs that survive complete replanning', () => {
  const document = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Verified fixes', legend: { mode: 'hidden' } },
    lanes: [{ id: 'main', label: 'Main' }],
    groups: [{ id: 'target-only', label: 'Target', lane: 'main', fromCol: 2, toCol: 2 }],
    nodes: [
      { id: 'a', lane: 'main', col: 1, type: 'backend', label: 'A' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b' }],
  };

  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });
  assert.equal(result.ok, false);
  const diagnostic = result.diagnostics.find(({ code }) => code === 'workflow/column-capacity');
  assert.ok(diagnostic);
  assert.ok(
    diagnostic.supportedFixes.every((fix) => !/^move node /.test(fix)),
    `moving the group's only node must not be advertised as verified: ${diagnostic.supportedFixes}`,
  );
});

test('fixed-v1 verifies the exact serialized values in every rounded-width repair', () => {
  const document = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Rounded verified widths', legend: { mode: 'hidden' } },
    lanes: [{ id: 'main', label: 'M' }],
    nodes: [
      { id: 'a', lane: 'main', col: 1, type: 'backend', label: 'A', width: 52.006 },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B', width: 51.995 },
    ],
    edges: [{ id: 'ab', from: 'a', to: 'b' }],
  };

  const result = compileWorkflow({ workflow: document, qualityProfile: 'standard' });

  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.length, 1, JSON.stringify(result.diagnostics, null, 2));
  const [diagnostic] = result.diagnostics;
  assert.equal(diagnostic.code, 'workflow/column-capacity');
  assert.deepEqual(diagnostic.evidence.nodeWidthsPx, [52.006, 51.995]);
  assert.ok(diagnostic.supportedFixes.length > 0);
  assert.ok(
    diagnostic.supportedFixes.includes('set node widths "a"=52px and "b"=51.99px'),
    JSON.stringify(diagnostic.supportedFixes, null, 2),
  );

  for (const fix of diagnostic.supportedFixes) {
    const repaired = clone(document);
    if (fix === 'migrate this workflow to schema_version 2') {
      repaired.schema_version = 2;
    } else {
      const move = fix.match(/^move node "([^"]+)" to verified free column (\d+)$/);
      const widths = [...fix.matchAll(/"([^"]+)"=([\d.]+)px/g)];
      if (move) {
        repaired.nodes.find(({ id }) => id === move[1]).col = Number(move[2]);
      } else {
        assert.ok(widths.length > 0, `unsupported advertised repair: ${fix}`);
        for (const [, nodeId, width] of widths) {
          repaired.nodes.find(({ id }) => id === nodeId).width = Number(width);
        }
      }
    }
    const verified = compileWorkflow({ workflow: repaired, qualityProfile: 'standard' });
    assert.equal(
      verified.ok,
      true,
      `advertised fix must recompile: ${fix}\n${JSON.stringify(verified.diagnostics, null, 2)}`,
    );
  }
});
