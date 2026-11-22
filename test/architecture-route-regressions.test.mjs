import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { automaticComponentPositions } from '../archify/renderers/architecture/automatic-placement.mjs';
import { measuredCrossingPairs } from '../archify/renderers/architecture/automatic-placement-candidates.mjs';
import { connectionLabelBoxAt, createArchitectureRouter } from '../archify/renderers/architecture/routing.mjs';
import { properSegmentIntersection, rectsOverlap, roundedPath, segmentRectClearance } from '../archify/renderers/shared/geometry.mjs';

const fixtureUrl = name => new URL(`fixtures/architecture-route-regressions/${name}.json`, import.meta.url);
const load = name => JSON.parse(readFileSync(fixtureUrl(name), 'utf8'));
const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
const renderer = fileURLToPath(new URL('../archify/renderers/architecture/render-architecture.mjs', import.meta.url));

function measuredLayout(name) {
  const result = spawnSync(process.execPath, [renderer, '--layout-json', fileURLToPath(fixtureUrl(name))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const layout = JSON.parse(result.stdout);
  return new Map(load(name).connections.map(({ id }, index) => [id, layout.connections[index]]));
}

function inferredLayout(t, components, connections, boundaries, quality = 'showcase') {
  const dir = mkdtempSync(join(tmpdir(), 'archify-inferred-layout-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'input.json');
  writeFileSync(input, JSON.stringify({
    schema_version: 1, diagram_type: 'architecture', layout: { mode: 'auto' },
    meta: { title: 'Inferred layout', output: 'output.html', quality_profile: quality },
    components, connections, boundaries,
  }));
  const { status, receipt } = validate(input, quality, '--layout-json');
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
  return receipt;
}

test('an inferred input with a deep consumer approaches from an adjacent slot', t => {
  const components = [
    ['cli', 'external'], ['collect', 'backend'], ['remote', 'cloud'], ['snapshot', 'database'],
    ['analyze', 'backend'], ['guidance', 'external'], ['report', 'external'],
  ].map(([id, type]) => ({ id, type, label: id, size: [160, 66] }));
  const connections = [
    ['cli', 'collect', '运行采集', 'emphasis'], ['collect', 'remote', 'gh 请求'],
    ['collect', 'snapshot', '输出 JSON', 'emphasis'], ['snapshot', 'analyze', '提供数据', 'emphasis'],
    ['guidance', 'analyze', '解释口径'], ['analyze', 'report', '整理结论', 'emphasis'],
  ].map(([from, to, label, variant]) => ({ from, to, label, variant }));
  const layout = inferredLayout(t, components, connections);
  const branch = layout.connections.find(route => route.from === 'guidance');
  assert.equal(branch.points.length, 2);
  assert.equal(branch.points[0][1], branch.points[1][1]);
  assert.ok(Math.abs(branch.points[0][0] - branch.points[1][0]) <= 80, JSON.stringify(branch));
});

test('an inferred relationship label keeps the marker on its short final approach visible', t => {
  const components = [
    ['ui', 'frontend', 150], ['worker', 'backend', 160], ['store', 'database', 160],
    ['auth', 'security', 160], ['client', 'external', 150],
  ].map(([id, type, width]) => ({ id, type, label: id, size: [width, 65] }));
  const connections = [
    ['ui', 'worker', '词库请求', 'emphasis'], ['worker', 'store', '读取与写入', 'emphasis'],
    ['worker', 'auth', '身份检查'], ['client', 'auth', '密钥认证'], ['auth', 'store', '查询凭据'],
  ].map(([from, to, label, variant]) => ({ from, to, label, variant }));
  for (const quality of ['standard', 'showcase']) {
    const { connections: routes } = inferredLayout(t, components, connections, undefined, quality);
    const route = routes.find(entry => entry.from === 'client');
    const [x, y] = route.points.at(-1);
    assert.ok(route.points.at(-2)[1] > y && route.points.at(-2)[0] === x);
    const marker = { x: x - 5.25, y: y - 1.5, width: 10.5, height: 15 };
    assert.equal(rectsOverlap(connectionLabelBoxAt(route, route.labelAt), marker), false, quality);
  }
});

test('a tall inferred chain folds once while keeping the sequence of links', t => {
  const components = Array.from({ length: 7 }, (_, index) => ({
    id: `card${index}`, type: 'frontend', label: `Stage ${index + 1}`, size: [180, 70],
  }));
  const connections = components.slice(1).map(({ id }, index) => ({
    from: components[index].id, to: id, label: '下一步',
  }));
  const layout = inferredLayout(t, components, connections);
  assert.ok(layout.viewBox[1] <= 650, JSON.stringify(layout.viewBox));
  assert.equal(new Set(layout.components.map(({ x }) => x)).size, 2);
  assert.deepEqual(layout.connections.map(({ from, to }) => [from, to]), connections.map(({ from, to }) => [from, to]));
});

test('two close arrivals get room between their arrowheads on the same face', t => {
  const fixture = JSON.parse(readFileSync(new URL(
    'fixtures/architecture-viewport/readable-scroll-worldscope.architecture.json', import.meta.url), 'utf8'));
  const components = fixture.components.map(({ pos, ...card }) => card);
  const connections = fixture.connections.map(({ fromSide, toSide, labelAt, via, route, ...link }) => link);
  const layout = inferredLayout(t, components, connections, fixture.boundaries);
  const [api, agent] = ['api', 'agent'].map(id => layout.connections.find(({ from, to }) => from === id && to === 'context'));
  const [first, second] = [api, agent].map(route => route.points.at(-1));
  assert.equal(first[1], second[1]);
  assert.ok(Math.abs(first[0] - second[0]) >= 22 - 0.001, JSON.stringify({ first, second }));
});

test('a shorter route cannot cause the final label solver to put another label on an arrow', () => {
  measuredLayout('clearance');
});

test('the delivered Queues messages label reads closer to its own route', () => {
  const routes = measuredLayout('ownership');
  const owner = routes.get('r17');
  const rect = connectionLabelBoxAt(owner, owner.labelAt);
  const gap = ({ points }) => Math.min(...points.slice(1).map((end, index) =>
    segmentRectClearance({ start: points[index], end }, rect)));
  assert.ok(gap(owner) < gap(routes.get('r10')));
});

test('simplifying one route cannot turn a crossing with another route into two', () => {
  const routes = measuredLayout('double-crossing');
  const { points: a } = routes.get('r3');
  const { points: b } = routes.get('r6');
  const crossings = a.slice(1).flatMap((end, index) => b.slice(1).filter((otherEnd, otherIndex) =>
    properSegmentIntersection(a[index], end, b[otherIndex], otherEnd)));
  assert.ok(crossings.length <= 1, JSON.stringify({ a, b }));
});

test('unconnected cards outside the routing corridor do not seed a scene-wide channel search', () => {
  const { components, connections } = load('budget');
  const boxes = new Map(components.map(({ id, pos: [x, y], size: [width, height] }) =>
    [id, { id, x, y, width, height, cx: x + width / 2, cy: y + height / 2 }]));
  const compact = createArchitectureRouter(boxes, connections, { automaticPlacement: true }).routingMetrics();
  for (let index = 0; index < 2000; index += 1) {
    const id = `extra${index}`;
    const x = 60 + (index * 93 % 1900) + index / 1024;
    const y = 1100 + Math.floor(index / 12) * 70 + (index % 12) * 17.3;
    boxes.set(id, { id, x, y, width: 70, height: 24, cx: x + 35, cy: y + 12 });
  }
  const large = createArchitectureRouter(boxes, connections, { automaticPlacement: true }).routingMetrics();
  assert.ok(large.residualCandidateCount > 0);
  assert.ok(large.residualCandidateCount <= compact.residualCandidateCount * 2,
    `2,000 remote boxes should not dominate candidate count (${compact.residualCandidateCount} vs ${large.residualCandidateCount})`);
});

function validate(input, quality, ...args) {
  const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--quality', quality, ...args],
    { encoding: 'utf8' });
  return { status: result.status, receipt: JSON.parse(result.stdout) };
}

test('automatic placement leaves room for the frame inside an authored canvas', () => {
  const { status, receipt } = validate(fileURLToPath(fixtureUrl('bounded-frame')), 'standard', '--layout-json');
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
  assert.deepEqual(receipt.viewBox, [330, 250]);
  const [frame] = receipt.boundaries;
  assert.ok(frame.y + frame.height <= 250);
});

test('unplaced labelled endpoints produce the typed component diagnostic', () => {
  const { status, receipt } = validate(fileURLToPath(fixtureUrl('missing-placement')), 'standard', '--json');
  assert.equal(status, 1);
  assert.ok(receipt.diagnostics.some(d => d.code === 'architecture/non-finite-component-geometry'));
  assert.ok(receipt.diagnostics.every(d => d.code !== 'internal/unclassified'));
});

test('automatic Queue Gateway places the service frame above the worker and preserves its pinned sides', t => {
  const spec = JSON.parse(readFileSync(new URL('fixtures/architecture-first-draft/queue-luna.architecture.json', import.meta.url)));
  spec.layout = { mode: 'auto' };
  for (const component of spec.components) delete component.pos;
  const directory = mkdtempSync(join(tmpdir(), 'archify-queue-route-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const input = join(directory, 'queue.json');
  const positions = automaticComponentPositions(spec);
  const pinned = { ...spec, components: spec.components.map(box => ({ ...box, pos: positions.get(box.id) })) };
  writeFileSync(input, JSON.stringify(pinned));
  const recovered = validate(input, 'standard', '--layout-json');
  assert.equal(recovered.status, 0, JSON.stringify(recovered.receipt.diagnostics));
  assert.deepEqual(recovered.receipt.components.map(box => box.pos),
    pinned.components.map(box => box.pos.map(Math.round)));
  writeFileSync(input, JSON.stringify(spec));
  const { status, receipt } = validate(input, 'showcase', '--layout-json');
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
  const routes = new Map(spec.connections.map(({ id }, index) => [id, receipt.connections[index].points]));
  const token = routes.get('token');
  const [start, departure] = token;
  const [approach, end] = token.slice(-2);
  assert.ok(start[0] === departure[0] && departure[1] > start[1], 'leaves the pinned bottom side');
  assert.ok(end[0] === approach[0] && approach[1] < end[1], 'enters the pinned top side');
  const [first, last] = [routes.get('retry')[0], routes.get('retry').at(-1)];
  const worker = receipt.components.find(c => c.id === 'worker');
  const auth = receipt.components.find(c => c.id === 'auth');
  assert.ok(auth.y + auth.height < worker.y, 'the token route can take a direct approach from above');
  assert.equal(first[1], worker.y + worker.height);
  assert.equal(last[1], first[1]);
  assert.ok(Math.abs(last[0] - first[0]) >= 24, 'same-side loop ports have room for the two arrows');
});

test('automatic placement can exchange equal terminal slots to clear crossed branches', () => {
  const routes = measuredLayout('crossed-sinks');
  const save = routes.get('save').points;
  const write = routes.get('write').points;
  assert.ok(save.slice(1).every((end, index) => write.slice(1).every((otherEnd, otherIndex) =>
    !properSegmentIntersection(save[index], end, write[otherIndex], otherEnd))));
});

function assertRoutesDoNotCross(routes, first, second) {
  const { points: a } = routes.get(first);
  const { points: b } = routes.get(second);
  assert.ok(a.slice(1).every((end, index) => b.slice(1).every((otherEnd, otherIndex) =>
    !properSegmentIntersection(a[index], end, b[otherIndex], otherEnd))), JSON.stringify({ a, b }));
}

test('simplification keeps shared-endpoint routes clear of an arrow with a pinned label', () => {
  assertRoutesDoNotCross(measuredLayout('small-excluded-369'), 'r7', 'r8');
});

test('an automatic arrow can follow its pinned label and open a crossing-free corridor', () => {
  const routes = measuredLayout('small-regressed-603');
  assertRoutesDoNotCross(routes, 'r0', 'r1');
  assertRoutesDoNotCross(routes, 'r0', 'r10');
  assertRoutesDoNotCross(routes, 'r1', 'r10');
  const { points, labelAt, ...labelled } = routes.get('r10');
  assert.deepEqual(labelAt, [148, 50]);
  const rect = connectionLabelBoxAt(labelled, labelAt);
  assert.ok(points.slice(1).some((end, index) => segmentRectClearance({ start: points[index], end }, rect) <= 20));
});

test('the bounded channel search considers gaps at the ends of the feasible interval', () => {
  const routes = measuredLayout('corridor-end-cuts');
  assertRoutesDoNotCross(routes, 'r0', 'r1');
  assertRoutesDoNotCross(routes, 'r0', 'r3');
});

test('a fully inferred frame fits a viable authored canvas', () => {
  const { status, receipt } = validate(fileURLToPath(fixtureUrl('frame-full-auto')), 'standard', '--layout-json');
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
  assert.deepEqual(receipt.viewBox, [330, 250]);
  const [frame] = receipt.boundaries;
  assert.ok(frame.y + frame.height <= 250);
});

test('same-side self-loop recovery can move both inferred ports', () => {
  const { points } = measuredLayout('loop-60').get('retry');
  const [start, end] = [points[0], points.at(-1)];
  assert.equal(start[0], 320);
  assert.equal(end[0], 320);
  assert.ok(Math.abs(start[1] - end[1]) >= 24);
});

test('a frame with an unplaced member reports only the typed placement error', () => {
  const { status, receipt } = validate(fileURLToPath(fixtureUrl('missing-frame')), 'showcase', '--json');
  assert.equal(status, 1);
  assert.deepEqual(receipt.diagnostics.map(d => d.code), ['architecture/non-finite-component-geometry']);
  assert.match(receipt.diagnostics[0].message, /Component "a" must include pos/);
});

test('automatic placement keeps non-members out of overlapping frames', () => {
  const name = 'overlapping-frames';
  const { status, receipt } = validate(fileURLToPath(fixtureUrl(name)), 'showcase', '--layout-json');
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
  assert.deepEqual(receipt.boundaries.map(frame => frame.wraps), load(name).boundaries.map(frame => frame.wraps));
  const support = receipt.boundaries.find(frame => frame.label === 'Support');
  const other = receipt.components.find(box => box.id === 'b');
  assert.ok(other.x >= support.x + support.width || other.x + other.width <= support.x
    || other.y >= support.y + support.height || other.y + other.height <= support.y);
});

for (const [name, description] of [
  ['layers-with-dashed-branch', 'a dashed branch competing with a frame entrance'],
  ['shared-frame-attachment', 'shared dependencies leaving the same framed layer'],
  ['skip-layer-branch', 'a branch crossing a route that skips a layer'],
]) {
  test(`automatic placement clears ${description}`, () => {
    const routes = measuredLayout(name);
    const ids = [...routes.keys()];
    for (const [index, first] of ids.entries()) {
      for (const second of ids.slice(index + 1)) assertRoutesDoNotCross(routes, first, second);
    }
  });
}

test('a rounded corner crossing counts at its exact sample point', () => {
  const corner = { relation: { id: 'corner' }, d: roundedPath([[0, 100], [100, 100], [100, 200]], 8) };
  const crosses = d => measuredCrossingPairs([corner, { relation: { id: 'other' }, d }]).length;
  for (const x of [97.99, 98, 98.01]) assert.equal(crosses(`M ${x} 0 L ${x} 300`), 1);
  assert.equal(crosses('M 98 0 L 98 102 L 98 300'), 1, 'both paths can have an interior vertex there');
  assert.equal(crosses('M 98 0 L 98 102'), 0, 'touching a true endpoint is not a crossing');
  assert.equal(crosses('M 95 105 L 98 102 L 97 106'), 0, 'a route that turns back at the contact only touches');
});

test('router and delivered artifact count crossings with a shared endpoint and a pinned label', t => {
  const name = 'shared-pinned-crossing';
  const { components, connections } = load(name);
  const boxes = new Map(components.map(({ id, pos: [x, y], size: [width, height] }) =>
    [id, { id, x, y, width, height, cx: x + width / 2, cy: y + height / 2 }]));
  const pairs = createArchitectureRouter(boxes, connections).crossingPairs();
  assert.ok(pairs.some(pair => pair.some(conn => conn.id === 'r1') && pair.some(conn => conn.id === 'r10')));

  const dir = mkdtempSync(join(tmpdir(), 'archify-pinned-crossing-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output = join(dir, 'chart.html');
  const result = spawnSync(process.execPath, [cli, 'finalize', 'architecture', fileURLToPath(fixtureUrl(name)), output, '--json'],
    { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const { signals, affectedRoutes } = JSON.parse(result.stdout).visualReviewRecommendation;
  assert.equal(signals.resolvedCrossovers, 3);
  assert.ok(affectedRoutes.crossings.some(({ left, right }) => left.id === 'r1' && right.id === 'r10'));
  assert.deepEqual(measuredLayout(name).get('r10').labelAt, [148, 50]);
});

test('a tight fixed canvas allows an inferred card to use the frame padding as its lower bound', () => {
  const { status, receipt } = validate(fileURLToPath(fixtureUrl('tight-fixed-frame')), 'standard', '--layout-json');
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
  assert.deepEqual(receipt.viewBox, [320, 240]);
  const [frame] = receipt.boundaries;
  assert.ok(frame.x >= 0 && frame.x + frame.width <= receipt.viewBox[0]);
  assert.ok(frame.y >= 0 && frame.y + frame.height <= receipt.viewBox[1]);
});

test('an inferred frame can compact its members to clear two falsely enclosed cards', () => {
  const name = 'two-frame-outsiders';
  const { status, receipt } = validate(fileURLToPath(fixtureUrl(name)), 'showcase', '--layout-json');
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
  assert.deepEqual(receipt.boundaries.map(frame => frame.wraps), load(name).boundaries.map(frame => frame.wraps));
  const frame = receipt.boundaries.find(frame => frame.label === 'Support');
  for (const { x, y, width, height } of receipt.components.filter(box => ['b', 'e'].includes(box.id))) {
    assert.ok(x >= frame.x + frame.width || x + width <= frame.x || y >= frame.y + frame.height || y + height <= frame.y);
  }
});

test('automatic enclosure recovery can keep a partial improvement and fix another scope next', t => {
  const source = load('two-frame-outsiders');
  const diagram = { ...source, components: [], connections: [], boundaries: [] };
  for (const zone of ['First', 'Second']) {
    const id = name => `${zone.toLowerCase()}-${name}`;
    diagram.components.push(...source.components.map(box => ({ ...box, id: id(box.id) })));
    diagram.connections.push(...source.connections.map(conn => ({ ...conn, from: id(conn.from), to: id(conn.to) })));
    diagram.boundaries.push(...source.boundaries.map(frame =>
      ({ ...frame, label: `${zone} ${frame.label}`, wraps: frame.wraps.map(id) })));
    diagram.boundaries.push({ kind: 'region', label: `${zone} zone`, wraps: source.components.map(box => id(box.id)) });
  }
  const dir = mkdtempSync(join(tmpdir(), 'archify-two-scopes-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'architecture.json');
  writeFileSync(input, JSON.stringify(diagram));
  const { status, receipt } = validate(input, 'showcase', '--layout-json');
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
  assert.deepEqual(receipt.boundaries.map(frame => frame.wraps), diagram.boundaries.map(frame => frame.wraps));
});
