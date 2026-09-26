import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../renderers/architecture/routing.mjs';
import { properSegmentIntersection, routeBudgetMetrics } from '../renderers/shared/geometry.mjs';

function fixture() {
  const boxes = new Map(Array.from({ length: 6 }, (_, index) => {
    const x = (index % 3) * 260 + 40;
    const y = Math.floor(index / 3) * 250 + 40;
    return [String(index), { id: String(index), x, y, width: 150, height: 70, cx: x + 75, cy: y + 35 }];
  }));
  const connections = [['5', '4'], ['1', '5'], ['1', '3'], ['0', '2'], ['5', '3'], ['3', '1'], ['5', '0'], ['2', '4']]
    .map(([from, to], index) => ({ id: `edge-${index}`, from, to }));
  return { boxes, connections };
}

function crossings(routes) {
  let count = 0;
  for (let left = 0; left < routes.length; left += 1) {
    for (let right = left + 1; right < routes.length; right += 1) {
      if (routes[left].slice(1).some((end, index) => routes[right].slice(1).some((otherEnd, otherIndex) =>
        properSegmentIntersection(routes[left][index], end, routes[right][otherIndex], otherEnd)))) count += 1;
    }
  }
  return count;
}

test('architecture improves complete-scene crossings and bends without extra grid searches or changed input', () => {
  const { boxes, connections } = fixture();
  const before = JSON.stringify({ boxes: [...boxes], connections });
  const routers = [false, true].map((preferReadableRoutes) => createRouter(boxes, connections, {
    distinctAutomaticPorts: true, preferReadableRoutes,
  }));
  const routes = routers.map((router) => connections.map((conn) => router.pathFor(conn).points));
  assert.equal(crossings(routes[0]), 11, 'fixture exposes the first-legal-route regression');
  assert.equal(crossings(routes[1]), 9);
  const metrics = routes.map((points) => routeBudgetMetrics({ routedRelations: points.map((route) => ({ points: route })) }));
  assert.ok(metrics[1].routesOverSuggestedBends < metrics[0].routesOverSuggestedBends);
  assert.ok(metrics[1].maxStretch <= metrics[0].maxStretch);
  const scene = [...routes[0].flat(), ...[...boxes.values()].flatMap((rect) => [[rect.x, rect.y], [rect.x + rect.width, rect.y + rect.height]])];
  for (const [x, y] of routes[1].flat()) {
    assert.ok(x >= Math.min(...scene.map((point) => point[0])) && x <= Math.max(...scene.map((point) => point[0])));
    assert.ok(y >= Math.min(...scene.map((point) => point[1])) && y <= Math.max(...scene.map((point) => point[1])));
  }
  assert.equal(routers[1].routingMetrics().gridSearchCount, routers[0].routingMetrics().gridSearchCount);
  assert.ok(routers[1].routingMetrics().readabilityCandidateCount <= connections.length * 16);
  assert.equal(JSON.stringify({ boxes: [...boxes], connections }), before);
});

test('readability sweep preserves explicit geometry and endpoint-side contracts', () => {
  const { boxes, connections } = fixture();
  connections[0] = { ...connections[0], fromSide: 'right', toSide: 'left', via: [[240, 75]] };
  connections[3] = { ...connections[3], fromSide: 'bottom', toSide: 'top' };
  const routers = [false, true].map((preferReadableRoutes) => createRouter(boxes, connections, {
    distinctAutomaticPorts: true, preferReadableRoutes,
  }));
  assert.deepEqual(routers[1].pathFor(connections[0]), routers[0].pathFor(connections[0]));
  assert.deepEqual(routers[1].connectionSides(connections[3]), { fromSide: 'bottom', toSide: 'top' });
});
