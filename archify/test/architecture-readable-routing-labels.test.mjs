import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRouter } from '../renderers/architecture/routing.mjs';
import { reservedLabelRect } from '../renderers/architecture/labels.mjs';
import { labelPoint, rectsOverlap, segmentIntersectsRect } from '../renderers/shared/geometry.mjs';

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

function productionLabelRectFor(boxes) {
  const resolved = new Map();
  const callback = (conn, points, { routes, labels }) => {
    if (!conn.label) return null;
    const [lx, ly] = labelPoint(conn, points);
    // These fixture labels are ASCII, so this matches architecture textUnits.
    const width = Math.max(30, conn.label.length * 4.8 + 10);
    const rect = reservedLabelRect({
      label: { relation: conn, label: conn.label, lx, ly, x: lx - width / 2, y: ly - 10, width, height: 14 },
      points,
      routes: routes.map((route, relationIndex) => ({ relationIndex, points: route })),
      labels,
      components: [...boxes.values()],
    });
    const key = `${conn.id}:${JSON.stringify(points)}`;
    resolved.set(key, rect);
    return rect;
  };
  callback.rectFor = (conn, points) => resolved.get(`${conn.id}:${JSON.stringify(points)}`) || null;
  return callback;
}

function routeScene(boxes, connections, preferReadableRoutes) {
  const labelRectFor = productionLabelRectFor(boxes);
  const router = createRouter(boxes, connections, {
    distinctAutomaticPorts: true,
    preferReadableRoutes,
    labelRectFor,
  });
  const routes = connections.map((conn) => router.pathFor(conn).points);
  const labels = connections.flatMap((conn, index) => {
    if (!conn.label) return [];
    const rect = labelRectFor.rectFor(conn, routes[index]);
    assert.ok(rect, `expected a reserved placement for ${conn.id}`);
    return [{ conn, rect }];
  });
  return { router, routes, labels };
}

function boundsFor(boxes, routes, labels) {
  const points = [
    ...routes.flat(),
    ...[...boxes.values()].flatMap((box) => [[box.x, box.y], [box.x + box.width, box.y + box.height]]),
    ...labels.flatMap(({ rect }) => [[rect.x, rect.y], [rect.x + rect.width, rect.y + rect.height]]),
  ];
  return {
    left: Math.min(...points.map(([x]) => x)),
    right: Math.max(...points.map(([x]) => x)),
    top: Math.min(...points.map(([, y]) => y)),
    bottom: Math.max(...points.map(([, y]) => y)),
  };
}

function assertInsideBounds(point, bounds, subject) {
  assert.ok(point[0] >= bounds.left && point[0] <= bounds.right, `${subject} expands horizontal scene bounds: ${point}`);
  assert.ok(point[1] >= bounds.top && point[1] <= bounds.bottom, `${subject} expands vertical scene bounds: ${point}`);
}

test('architecture readability sweep keeps reserved labels clear and their extents inside the original scene', () => {
  const { boxes, connections } = fixture();
  connections[0].label = 'reserved label';
  connections[3].label = 'second relationship';

  const baseline = routeScene(boxes, connections, false);
  const swept = routeScene(boxes, connections, true);
  const originalBounds = boundsFor(boxes, baseline.routes, baseline.labels);

  assert.ok(swept.router.routingMetrics().readabilityImprovedCount > 0, 'the sweep exercised label-aware route changes');
  assert.ok(swept.labels.some(({ conn, rect }) => {
    const previous = baseline.labels.find((entry) => entry.conn.id === conn.id)?.rect;
    return previous && (rect.x !== previous.x || rect.y !== previous.y);
  }), 'a moved route gets a freshly reserved label position');

  for (const route of swept.routes) {
    for (const point of route) assertInsideBounds(point, originalBounds, 'route');
  }
  for (const { rect } of swept.labels) {
    assertInsideBounds([rect.x, rect.y], originalBounds, 'label');
    assertInsideBounds([rect.x + rect.width, rect.y + rect.height], originalBounds, 'label');
  }

  for (let left = 0; left < swept.labels.length; left += 1) {
    const label = swept.labels[left];
    for (let right = left + 1; right < swept.labels.length; right += 1) {
      assert.equal(rectsOverlap(label.rect, swept.labels[right].rect, 2), false, 'reserved labels remain distinct');
    }
    for (let routeIndex = 0; routeIndex < swept.routes.length; routeIndex += 1) {
      if (connections[routeIndex].id === label.conn.id) continue;
      for (let segment = 0; segment < swept.routes[routeIndex].length - 1; segment += 1) {
        assert.equal(segmentIntersectsRect({
          start: swept.routes[routeIndex][segment],
          end: swept.routes[routeIndex][segment + 1],
        }, label.rect, 4), false, `${connections[routeIndex].id} must not borrow ${label.conn.id}'s label space`);
      }
    }
  }
});

test('architecture readability sweep leaves authored route presets and channel-pinned routes unchanged', () => {
  const { boxes, connections } = fixture();
  connections[0] = { ...connections[0], route: 'orthogonal-h' };
  connections[3] = { ...connections[3], channelX: 123 };

  const baseline = routeScene(boxes, connections, false);
  const swept = routeScene(boxes, connections, true);
  for (const index of [0, 3]) {
    assert.deepEqual(swept.routes[index], baseline.routes[index], `${connections[index].id} keeps authored routing geometry`);
  }
});
