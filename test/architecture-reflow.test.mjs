import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeRoutePoints, properSegmentIntersection } from '../archify/renderers/shared/geometry.mjs';

const renderer = fileURLToPath(new URL('../archify/renderers/architecture/render-architecture.mjs', import.meta.url));

function render(t, components, connections) {
  const directory = mkdtempSync(join(tmpdir(), 'archify-reflow-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = join(directory, 'input.json');
  writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    layout: { mode: 'auto' },
    meta: { title: 'Service dependencies', output: 'chart.html' },
    components: components.map(([id, size]) => ({
      id, label: id[0].toUpperCase() + id.slice(1), type: 'backend', size,
    })),
    connections: connections.map(([from, to, label]) => ({ from, to, label })),
  }));
  const result = spawnSync(process.execPath, [renderer, input, '--layout-json'], { encoding: 'utf8', cwd: directory });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

const ids = (prefix, count) => Array.from({ length: count }, (_, i) => `${prefix}-${i}`);
const distance = ([x, y], [u, v]) => Math.abs(x - u) + Math.abs(y - v);
const routeLength = points => points.slice(1).reduce((sum, p, i) => sum + distance(p, points[i]), 0);

function crossingCount(routes) {
  const paths = routes.map(({ points }) => points.slice(1).map((to, i) => [points[i], to]));
  return paths.reduce((total, path, i) => total + paths.slice(i + 1).filter(other =>
    path.some(([a, b]) => other.some(([c, d]) => properSegmentIntersection(a, b, c, d)))).length, 0);
}

for (const hubCount of [2, 3]) for (const sharedCount of [3, 4, 5]) for (const hasPrivate of [false, true]) {
  test(`${hubCount} hubs share a compact column of ${sharedCount} sinks${hasPrivate ? ' and one private sink' : ''}`, t => {
    const hubs = ids('hub', hubCount);
    const sinks = ids('store', sharedCount);
    const allSinks = hasPrivate ? [...sinks, `store-${sharedCount}`] : sinks;
    const layout = render(t, [
      ['entry', [150, 64]], ...hubs.map(id => [id, [140, 108]]), ...allSinks.map(id => [id, [145, 64]]),
    ], [
      ['entry', hubs[0], 'Start request'],
      ...hubs.flatMap(hub => sinks.map(sink => [hub, sink])),
      ...(hasPrivate ? [[hubs[0], allSinks.at(-1)]] : []),
    ]);
    const cards = new Map(layout.components.map(card => [card.id, card]));
    const centerY = id => cards.get(id).y + cards.get(id).height / 2;
    const ordered = allSinks.toSorted((a, b) => centerY(a) - centerY(b));
    const barycenter = id => {
      const incoming = layout.connections.filter(route => route.to === id);
      return incoming.reduce((sum, route) => sum + centerY(route.from), 0) / incoming.length;
    };
    assert.ok(ordered.every(id => cards.get(id).x === cards.get(ordered[0]).x), 'sinks share a column');
    assert.ok(ordered.slice(1).every((id, i) => barycenter(ordered[i]) <= barycenter(id)), 'sinks follow hub barycenters');
    const fan = layout.connections.filter(route => hubs.includes(route.from));
    for (const { from, to, points } of fan) {
      const [x, y] = points[0];
      const [u, v] = points.at(-1);
      const [nextX, nextY] = points[1];
      assert.ok((nextX - x) * (u - x) + (nextY - y) * (v - y) > 0, `${from} faces ${to}`);
      assert.ok(routeLength(points) <= distance(points[0], points.at(-1)) + 64, `${from} to ${to} stays local`);
    }
    const total = fan.reduce((sum, route) => sum + routeLength(route.points), 0);
    assert.ok(total / fan.length < 250, `mean fan route length is ${total / fan.length}`);
    if (hubCount === 2) assert.equal(crossingCount(fan), 0);
  });
}

function renderChain(t, length, branches, wide = false) {
  const chain = ids('stage', length);
  const leaves = ids('helper', branches);
  const layout = render(t, [...chain, ...leaves].map(id => [id, [wide ? 92 : 132, 60]]), [
    ...chain.slice(1).map((id, i) => [chain[i], id, wide ? 'Send' : 'Forward request']),
    ...leaves.map((id, i) => [chain[length - 2 - i], id, wide ? 'Send' : 'Export results']),
  ]);
  assert.equal(layout.connections.length, length + branches - 1);
  assert.equal(crossingCount(layout.connections), 0);
  assert.ok(layout.connections.every(route => normalizeRoutePoints(route.points).length === 2), 'all relationships have straight shafts');
  return layout;
}

for (const length of [6, 7, 8, 9]) for (const branches of [1, 2, 3]) {
  test(`a ${length}-stage tall chain with ${branches} side cards folds without extra bends`, t => {
    const { viewBox: [width, height] } = renderChain(t, length, branches);
    assert.ok(height < 720 && width / height > 1, `folded canvas is ${width} × ${height}`);
  });
}

test('an overwide chain folds into rows with straight relationships', t => {
  const { viewBox: [width, height] } = renderChain(t, 6, 1, true);
  assert.ok(width < 800 && height >= width / 1.75, `folded canvas is ${width} × ${height}`);
});
