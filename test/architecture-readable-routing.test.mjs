import { test } from 'node:test';
import assert from 'node:assert/strict';
import { connectionLabelBoxAt, createArchitectureRouter, createRouter } from '../archify/renderers/architecture/routing.mjs';
import { properSegmentIntersection, routeBudgetMetrics, segmentIntersectsRect } from '../archify/renderers/shared/geometry.mjs';

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
  assert.ok(crossings(routes[1]) <= 9 && crossings(routes[1]) < crossings(routes[0]),
    'automatic routing may improve beyond the accepted crossing budget');
  const metrics = routes.map((points) => routeBudgetMetrics({ routedRelations: points.map((route) => ({ points: route })) }));
  assert.ok(metrics[1].routesOverSuggestedBends < metrics[0].routesOverSuggestedBends);
  assert.ok(metrics[1].maxStretch <= metrics[0].maxStretch);
  const scene = [...routes[0].flat(), ...[...boxes.values()].flatMap((rect) => [[rect.x, rect.y], [rect.x + rect.width, rect.y + rect.height]])];
  for (const [x, y] of routes[1].flat()) {
    assert.ok(x >= Math.min(...scene.map((point) => point[0])) && x <= Math.max(...scene.map((point) => point[0])));
    assert.ok(y >= Math.min(...scene.map((point) => point[1])) && y <= Math.max(...scene.map((point) => point[1])));
  }
  assert.ok(routers[1].routingMetrics().gridSearchCount <= routers[0].routingMetrics().gridSearchCount,
    'readability must not require extra grid searches');
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

test('automatic architecture uncrosses two fan-out elbows using their existing source slots', () => {
  const boxes = new Map([
    ['cli', 320, 398], ['lock', 585, 78], ['output', 585, 238], ['receipts', 827, 398],
    ['browser', 585, 398], ['temp', 585, 558], ['installed', 573, 768],
  ].map(([id, x, y]) => [id, { id, x, y, width: 150, height: 64, cx: x + 75, cy: y + 32 }]));
  const connections = [
    ['cli', 'lock', 'acquire'], ['cli', 'output', 'read + write'], ['cli', 'temp', 'stage file', 'dashed'],
    ['cli', 'browser', 'spawn + evaluate'], ['cli', 'receipts', 'write receipt'],
    ['browser', 'receipts', 'evidence', 'security'], ['installed', 'cli', 'runs binary', 'dashed'],
  ].map(([from, to, label, variant]) => ({ from, to, label, variant }));
  const pointsFor = (automaticPlacement, edges = connections) => {
    const router = createArchitectureRouter(boxes, edges, { automaticPlacement });
    return edges.map(conn => router.pathFor(conn).points);
  };
  const before = pointsFor(false);
  const after = pointsFor(true);
  assert.equal(crossings(before), 1, 'the two branches cross before the exchange');
  assert.equal(crossings(after), 0);
  for (const [index, route] of after.entries()) {
    if (index === 1 || index === 4) {
      assert.deepEqual(route.slice(2), before[index].slice(2), 'the route after its first elbow stays in place');
      assert.deepEqual(route[0], before[index === 1 ? 4 : 1][0], 'the branches use each other’s source slots');
    } else {
      assert.deepEqual(route, before[index], 'neighbouring routes stay in place');
    }
  }
  for (const controls of [
    { fromSide: 'top' },
    { toSide: 'left' },
    { fromSide: 'top', toSide: 'left', via: [[454, 286]] },
    { labelAt: [518, 278] },
  ]) {
    const authoredConnections = connections.map((conn, index) => index === 1 ? { ...conn, ...controls } : conn);
    assert.deepEqual(pointsFor(true, authoredConnections), pointsFor(false, authoredConnections),
      `authored controls prevent a port exchange: ${JSON.stringify(controls)}`);
  }
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
  assert.equal(router.connectionSides(connections[1]).fromSide, 'left', 'the branch still exits sideways');
  const routes = connections.map(conn => router.pathFor(conn).points);
  assert.ok(routes[1].length <= 4, 'a clear corner may simplify the automatic target port');
  assert.equal(crossings(routes), 0);
  assert.equal(router.pathFor(connections[0]).points.length, 2, 'the main edge stays straight');
});

test('an alternate-side feedback port uses the near free slot without detouring around the blocker', () => {
  // The hub's two reciprocal ports leave equally close free slots above and
  // below them. Returning from below should use the lower slot; choosing the
  // upper one needlessly crosses the reciprocal pair or detours around view.
  for (const transpose of [false, true]) {
    for (const reflect of [false, true]) {
      const boxes = new Map([
        ['view', 440, 300, 215, 90], ['terminal', 40, 40, 215, 90],
        ['hub', 440, 40, 240, 90], ['worker', 440, 560, 240, 90],
      ].map(([id, x, y, width, height]) => {
        if (reflect) y = 700 - y - height;
        if (transpose) [x, y, width, height] = [y, x, height, width];
        return [id, { id, x, y, width, height, cx: x + width / 2, cy: y + height / 2 }];
      }));
      const connections = [
        { id: 'events', from: 'worker', to: 'hub' },
        { id: 'output', from: 'hub', to: 'terminal' },
        { id: 'input', from: 'terminal', to: 'hub' },
        { id: 'state', from: 'hub', to: 'view' },
      ];
      const input = JSON.stringify({ boxes: [...boxes], connections });
      const router = createRouter(boxes, connections, { distinctAutomaticPorts: true, preferReadableRoutes: true });
      const routes = connections.map((conn) => router.pathFor(conn).points);
      assert.ok(routes[0].length <= 4, `feedback needs at most two bends: ${JSON.stringify({ transpose, reflect, route: routes[0] })}`);
      assert.equal(crossings(routes), 0, 'feedback must not cross the reciprocal pair or state link');
      for (const route of routes.slice(1)) assert.equal(route.length, 2, 'neighbouring links remain straight');
      const onBorder = ([x, y], box) => x >= box.x && x <= box.x + box.width
        && y >= box.y && y <= box.y + box.height
        && (x === box.x || x === box.x + box.width || y === box.y || y === box.y + box.height);
      connections.forEach((conn, index) => {
        assert.ok(onBorder(routes[index][0], boxes.get(conn.from)), `${conn.id} starts at its source`);
        assert.ok(onBorder(routes[index].at(-1), boxes.get(conn.to)), `${conn.id} ends at its target`);
      });
      assert.equal(JSON.stringify({ boxes: [...boxes], connections }), input);
    }
  }
});

test('a facing link straightens once a crossing moves to the lower return corridor', () => {
  const boxes = new Map([
    ['worktree', 40, 364, 120, 60],
    ['sessions', 244, 364, 120, 60],
    ['integration', 448, 364, 160, 76],
    ['agents', 244, 506, 120, 60],
    ['sdk', 448, 506, 120, 60],
    ['repo', 652, 506, 120, 60],
  ].map(([id, x, y, width, height]) => [id, { id, x, y, width, height, cx: x + width / 2, cy: y + height / 2 }]));
  const connections = [
    { from: 'sessions', to: 'agents', label: 'node-pty spawn' },
    { from: 'integration', to: 'sdk', label: 'session host' },
    { from: 'worktree', to: 'repo', label: 'git worktree add' },
  ];
  const router = createArchitectureRouter(boxes, connections);
  const routes = connections.map((conn) => router.pathFor(conn).points);

  const [start, end] = routes[1];
  assert.equal(routes[1].length, 2, 'the facing link is straight');
  assert.equal(start[0], end[0], 'both ends share a vertical lane');
  assert.equal(start[1], 440, 'the link starts on the integration bottom edge');
  assert.equal(end[1], 506, 'the link ends on the sdk top edge');
  assert.ok(start[0] >= 448 && start[0] <= 568, 'the lane stays within the facing overlap');
  assert.equal(crossings(routes), 0);
  assert.equal(routes[0].length, 2, 'the neighboring link stays straight');
  assert.ok(routes[2].some(([, y]) => y > 566), 'the return uses the corridor below the boxes');
});

test('a crossing route can reuse its upper corridor to reach a free target side', () => {
  const boxes = new Map([
    ['runtime', 329, 204, 172], ['coordinator', 625, 48, 166],
    ['worker', 632, 204, 153], ['tasks', 887, 204, 120],
  ].map(([id, x, y, width]) => [id, { id, x, y, width, height: 60, cx: x + width / 2, cy: y + 30 }]));
  const connections = [
    ['input-pty', 'runtime', 'coordinator', '写入 PTY'],
    ['dispatch', 'runtime', 'worker', '启动并写入任务'],
    ['report', 'worker', 'runtime', 'team report · HTTP'],
    ['write-tasks', 'worker', 'tasks', '可编辑任务图'],
    ['read-tasks', 'runtime', 'tasks', '读取并监听'],
  ].map(([id, from, to, label]) => ({ id, from, to, label }));
  const [, , , write, read] = connections;
  const { pathFor, routingMetrics } = createArchitectureRouter(boxes, connections, { automaticPlacement: true });
  assert.equal(crossings([pathFor(read).points, pathFor(write).points]), 0);
  assert.ok(pathFor(read).points.length <= 5, 'the new approach uses at most three bends');

  const authored = { ...read, toSide: 'bottom' };
  const pinned = createArchitectureRouter(boxes, [...connections.slice(0, -1), authored], { automaticPlacement: true });
  assert.equal(pinned.connectionSides(authored).toSide, 'bottom');
  const fixedCanvas = createArchitectureRouter(boxes, connections, { fixedCanvas: true });
  assert.equal(routingMetrics().gridSearchCount, fixedCanvas.routingMetrics().gridSearchCount);
});

test('automatic routing leaves grid searches for a return path around unrelated cards', () => {
  const boxes = new Map([
    ['desktop', 64, 48, 153], ['runtime', 416.1, 334, 185],
    ['orchestrator', 48, 512, 172], ['worker', 284, 512, 160],
    ['sqlite', 508, 512, 179], ['bridge', 126.9, 334, 160],
    ['gateway', 281, 176, 166], ['phone', 281, 48, 166],
  ].map(([id, x, y, width]) => [id, { id, x, y, width, height: 60, cx: x + width / 2, cy: y + 30 }]));
  const connections = [
    ['terminal-input', 'desktop', 'runtime', 'WS · 输入任务', 'emphasis'],
    ['terminal-output', 'runtime', 'desktop', 'WS · 终端回显'],
    ['state-response', 'runtime', 'desktop', 'HTTP · 队伍与派单'],
    ['orchestrator-output', 'orchestrator', 'runtime', 'PTY · 协调终端输出'],
    ['send', 'orchestrator', 'runtime', 'HTTP · team send', 'emphasis'],
    ['dispatch', 'runtime', 'worker', 'PTY · 投递派单', 'emphasis'],
    ['report', 'worker', 'runtime', 'HTTP · 回报', 'emphasis'],
    ['ledger', 'runtime', 'sqlite', 'SQLite · 读写记录'],
    ['phone-response', 'gateway', 'phone', 'WSS · 加密回传'],
    ['relay-response', 'bridge', 'gateway', '转发回传密文'],
    ['bridge-request', 'bridge', 'runtime', '回环 · API 与 WS'],
  ].map(([id, from, to, label, variant]) => ({ id, from, to, label, variant }));
  const { pathFor, routingMetrics } = createArchitectureRouter(boxes, connections, { automaticPlacement: true });
  const response = connections.find(({ id }) => id === 'state-response');
  const { points } = pathFor(response);
  for (const [id, box] of boxes) {
    if (id === response.from || id === response.to) continue;
    assert.ok(points.slice(1).every((end, index) => !segmentIntersectsRect({ start: points[index], end }, box, 2)),
      `state response passes through ${id}`);
  }
  assert.equal(routingMetrics().gridBudgetExhaustedCount, 0);
});

test('three labelled reciprocal lanes stay straight regardless of connection order', () => {
  const boxes = new Map([
    ['control', 48, 166], ['runtime', 329, 172], ['worker', 625, 153],
  ].map(([id, x, width]) => [id, { id, x, y: 48, width, height: 60, cx: x + width / 2, cy: 78 }]));
  const connections = [
    { id: 'input', from: 'runtime', to: 'control', label: 'Open input' },
    { id: 'submit', from: 'control', to: 'runtime', label: 'Submit request' },
    { id: 'start', from: 'runtime', to: 'worker', label: 'Start work' },
    { id: 'report', from: 'worker', to: 'runtime', label: 'Report result' },
    { id: 'output', from: 'runtime', to: 'control', label: 'Forward result' },
  ];
  for (const order of [[0, 1, 2, 3, 4], [4, 3, 2, 1, 0], [2, 3, 4, 0, 1], [4, 0, 1, 2, 3]]) {
    const ordered = order.map(index => connections[index]);
    const router = createArchitectureRouter(boxes, ordered, { automaticPlacement: true });
    const routes = connections.map(conn => router.pathFor(conn));
    assert.ok(routes.every(({ points }) => points.length === 2 && points[0][1] === points[1][1]),
      `all five routes use straight horizontal lanes for input order ${order}`);
    const parallel = [0, 1, 4].map(index => ({ conn: connections[index], ...routes[index] }))
      .sort((a, b) => a.points[0][1] - b.points[0][1]);
    for (const [index, { conn, points, labelAt }] of parallel.entries()) {
      assert.ok(labelAt, `${conn.id} has a verified label placement`);
      const mask = connectionLabelBoxAt(conn, labelAt);
      assert.equal(segmentIntersectsRect({ start: points[0], end: points[1] }, mask), index === 1,
        'only the middle mask sits on its own line');
      for (const other of routes.filter(route => route.points !== points)) {
        assert.equal(segmentIntersectsRect({ start: other.points[0], end: other.points[1] }, mask, 4), false,
          `${conn.id} label clears other routes`);
      }
    }
  }

  for (const geometry of [{ labelAt: [270, 54] }, { fromSide: 'left' }, { via: [[271, 64]] }]) {
    const pinned = [{ ...connections[0], ...geometry }, ...connections.slice(1)];
    const router = createArchitectureRouter(boxes, pinned, { automaticPlacement: true });
    assert.ok(pinned.every(conn => router.pathFor(conn).labelAt === undefined),
      'an authored route, side or label prevents joint label placement');
  }
});
