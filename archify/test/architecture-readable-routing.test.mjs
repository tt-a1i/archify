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
  assert.equal(crossings(routes[0]), 10, 'fixture exposes the first-legal-route regression');
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

test('a fan-out sibling takes a free parallel channel instead of a detour', () => {
  const box = (id, x, y, width) => [id, { id, x, y, width, height: 64, cx: x + width / 2, cy: y + 32 }];
  const boxes = new Map([box('entry', 350, 80, 160), box('hub', 610, 80, 190), box('store', 950, 80, 180),
    box('left', 300, 270, 170), box('middle', 530, 270, 170), box('right', 760, 270, 180), box('far', 1000, 270, 170)]);
  const connections = ['store', 'left', 'middle', 'right', 'far'].map((to) => ({ id: `hub-${to}`, from: 'hub', to }));
  connections.unshift({ id: 'entry-hub', from: 'entry', to: 'hub' });
  const router = createRouter(boxes, connections, { distinctAutomaticPorts: true, preferReadableRoutes: true });
  const routes = connections.map((conn) => router.pathFor(conn).points);
  assert.ok(routes[2].length <= 4, `hub → left keeps at most two bends: ${JSON.stringify(routes[2])}`);
  assert.equal(crossings(routes), 0);
});

test('a row neighbour with a clear sideways corridor keeps its side exit', () => {
  const box = (id, x, y, width) => [id, { id, x, y, width, height: 64, cx: x + width / 2, cy: y + 32 }];
  const boxes = new Map([box('hub', 780, 80, 180), box('below', 780, 300, 180), box('store', 440, 300, 180)]);
  const connections = [{ id: 'main', from: 'hub', to: 'below' }, { id: 'write', from: 'hub', to: 'store' }];
  const router = createRouter(boxes, connections, { distinctAutomaticPorts: true, preferReadableRoutes: true });
  assert.deepEqual(router.connectionSides(connections[1]), { fromSide: 'left', toSide: 'right' });
  assert.equal(router.pathFor(connections[0]).points.length, 2, 'the main edge stays straight');
});
