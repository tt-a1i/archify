import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { automaticComponentPositions } from '../archify/renderers/architecture/automatic-placement.mjs';
import { placeAutomaticLabels } from '../archify/renderers/shared/automatic-labels.mjs';
import { arrowheadTriangle, maskCoversArrowhead } from '../archify/renderers/shared/arrowhead.mjs';
import { drawnPathRectClearance, prepareCrossingPath } from '../archify/renderers/shared/route-crossings.mjs';
import { measuredCrossingPairs, routeSpanMeasures, sharedNeighborCandidates } from '../archify/renderers/architecture/automatic-placement-candidates.mjs';
import { connectionLabelBoxAt, createArchitectureRouter, parallelRunMeasures } from '../archify/renderers/architecture/routing.mjs';
import { properSegmentIntersection, rectsOverlap, roundedPath, roundedPathSegments, segmentRectClearance } from '../archify/renderers/shared/geometry.mjs';

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

test('staggered request and return routes choose separate shafts when their facing gap is narrow', t => {
  const components = [
    ['author', 'external', 149], ['agent', 'frontend', 164], ['existing', 'external', 178], ['cli', 'backend', 197],
    ['renderer', 'backend', 172], ['viewer', 'frontend', 172], ['output', 'external', 135],
  ].map(([id, type, width]) => ({ id, type, label: id, size: [width, 60] }));
  const connections = [
    ['author', 'agent', 'Prompt', 'emphasis'], ['agent', 'cli', 'Typed JSON', 'emphasis'],
    ['existing', 'cli', 'Direct CLI call'], ['cli', 'renderer', 'Spec by type'],
    ['renderer', 'cli', 'Staged HTML'], ['cli', 'viewer', 'Publish if checked', 'emphasis'],
    ['viewer', 'output', 'Export in browser'],
  ].map(([from, to, label, variant]) => ({ from, to, label, variant }));
  const layout = inferredLayout(t, components, connections);
  const pair = layout.connections.filter(({ from, to }) => [from, to].every(id => ['cli', 'renderer'].includes(id)));
  assert.equal(pair.length, 2);
  const measured = parallelRunMeasures(pair.map(relation => ({ relation, points: relation.points })));
  assert.ok(measured.length < 40, JSON.stringify(pair));
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

test('a rendered corner crosses at the same point in the router and validation', () => {
  for (const name of ['rounded-sample-crossing', 'rounded-sample-crossing-offset']) {
    const spec = load(name);
    const boxes = new Map(spec.components.map(({ id, pos: [x, y], size: [width, height] }) =>
      [id, { id, x, y, width, height, cx: x + width / 2, cy: y + height / 2 }]));
    assert.equal(createArchitectureRouter(boxes, spec.connections).crossingPairs().length, 1);
    const { status, receipt } = validate(fileURLToPath(fixtureUrl(name)), 'showcase', '--json');
    assert.equal(status, 1);
    assert.ok(receipt.diagnostics.some(diagnostic => diagnostic.code === 'composition/proper-crossing'), JSON.stringify(receipt));
  }
});

for (const name of ['fixed-canvas-overflow', 'fixed-canvas-false-membership', 'fixed-canvas-pinned-outsider']) {
  test(`fixed-canvas recovery leaves valid frame membership and bounds in ${name}`, () => {
    const spec = load(name);
    const { status, receipt } = validate(fileURLToPath(fixtureUrl(name)), 'showcase', '--layout-json');
    assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
    assert.deepEqual(receipt.viewBox, spec.meta.viewBox);
    for (const pin of spec.components.filter(card => card.pos)) {
      const placed = receipt.components.find(card => card.id === pin.id);
      assert.deepEqual([placed.x, placed.y], pin.pos);
    }
  });
}

for (const name of ['label-masks-neighbor-arrowhead', 'label-relocation-masks-return-arrowhead', 'pin-skips-arrowhead-clearance']) {
  test(`automatic labels keep every arrowhead visible in ${name}`, () => {
    const { status, receipt } = validate(fileURLToPath(fixtureUrl(name)), 'standard', '--layout-json');
    assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
    const routes = receipt.connections;
    const relations = load(name).connections;
    for (const [index, route] of routes.entries()) {
      if (!route.label) continue;
      const rect = connectionLabelBoxAt(relations[index], route.labelAt);
      for (const [markerIndex, { points }] of routes.entries()) {
        const marker = relations[markerIndex];
        const stroke = marker.width || (marker.variant === 'emphasis' ? 1.8 : 1.5);
        assert.equal(maskCoversArrowhead(rect, arrowheadTriangle(points.at(-1), points.at(-2), stroke)), false,
          `${route.label} masks ${marker.label || marker.to}`);
      }
    }
  });
}

test('a dense automatic render bounds placement routing across all passes', () => {
  const result = spawnSync(process.execPath, [renderer, '--layout-json', fileURLToPath(fixtureUrl('runtime-24-terminal-branches'))],
    { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const count = JSON.parse(result.stdout).routedPlacementCandidates;
  assert.ok(count > 0 && count <= 4, `Routed ${count} candidates`);
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


test('opposing direct lanes use both cards’ available corner clearance', () => {
  const routes = measuredLayout('reciprocal-lane-gap');
  const [a, b] = [...routes.values()].map(({ points }) => points);
  assert.equal(a.length, 2);
  assert.equal(b.length, 2);
  assert.deepEqual(a.map(([, y]) => y), [64, 64]);
  assert.deepEqual(b.map(([, y]) => y), [92, 92]);
});

test('an automatic label beside a return keeps a visible ownership margin', () => {
  const routes = [
    { relationIndex: 0, points: [[20, 146], [220, 146]] },
    { relationIndex: 1, points: [[220, 120], [20, 120]] },
  ];
  const between = { relation: {}, relationIndex: 0, label: 'First response',
    x: 80, y: 126, width: 80, height: 14, lx: 120, ly: 136 };
  const [label] = placeAutomaticLabels({
    routes, labels: [between], components: [], titles: [], viewBox: [240, 220],
    repairOwnership: true, ownershipMargin: 4,
  });
  const distance = ({ points: [start, end] }) => segmentRectClearance({ start, end }, label);
  assert.ok(distance(routes[1]) >= distance(routes[0]) + 4);
  assert.notDeepEqual(label, between);
});

test('a pinned card leaves a full band available for automatic marker clearance', () => {
  const [dispatch] = [...measuredLayout('C-pinned-card-arrowhead-mask').values()];
  const relation = load('C-pinned-card-arrowhead-mask').connections[0];
  assert.deepEqual(dispatch.points, [[777, 386.375], [869, 386.375]]);
  const rect = connectionLabelBoxAt(relation, dispatch.labelAt);
  const marker = arrowheadTriangle(dispatch.points[1], dispatch.points[0], relation.width);
  assert.equal(maskCoversArrowhead(rect, marker), false);
  assert.ok(rect.y + rect.height < dispatch.points[0][1]);
});

test('the final automatic label belongs to the drawn authorization route', () => {
  const { status, receipt } = validate(fileURLToPath(fixtureUrl('C-showcase-label-wrong-owner')), 'showcase', '--layout-json');
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
  const owner = receipt.connections.find(relation => relation.label === 'Check authorization');
  const spec = load('C-showcase-label-wrong-owner').connections.find(relation => relation.label === owner.label);
  const rect = connectionLabelBoxAt(spec, owner.labelAt);
  const distance = ({ points }) => Math.min(...points.slice(1).map((end, index) =>
    segmentRectClearance({ start: points[index], end }, rect)));
  for (const other of receipt.connections.filter(relation => relation !== owner)) {
    assert.ok(distance(other) >= distance(owner) + 4, JSON.stringify({ owner, other, rect }));
  }
});


test('shared long input routes can be shortened by moving their inferred cards as one ordered group', () => {
  const uid = (id, x, y) => ({ id, x, y, width: 100, height: 60, cx: x + 50, cy: y + 30 });
  const cards = [uid('first', 48, 48), uid('second', 48, 212), uid('target', 502, 452), uid('other', 900, 650)];
  const boxes = new Map(cards.map(box => [box.id, box]));
  const routes = [
    { relation: { from: 'first', to: 'target' }, points: [[148, 78], [480, 78], [480, 470], [502, 470]] },
    { relation: { from: 'second', to: 'target' }, points: [[148, 242], [458, 242], [458, 490], [502, 490]] },
  ];
  const viewBox = [1040, 750];
  const { spans } = routeSpanMeasures(routes, boxes, viewBox);
  const [{ moved, gain }] = sharedNeighborCandidates({ boxes, routes, viewBox, titles: { boundaries: [] } }, spans);
  const first = moved.get('first');
  const second = moved.get('second');
  assert.notDeepEqual(first, cards[0]);
  assert.notDeepEqual(second, cards[1]);
  assert.deepEqual(moved.get('target'), cards[2]);
  assert.deepEqual(moved.get('other'), cards[3]);
  assert.ok(first.x < second.x || first.x === second.x && first.y < second.y);
  assert.ok(gain > 300);

  const invalidFrame = { x: 24, y: 24, width: 148, height: 272, wraps: ['first', 'second', 'missing'] };
  assert.deepEqual(sharedNeighborCandidates({ boxes, routes, viewBox, titles: { boundaries: [invalidFrame] } }, spans), []);
});

test('grouping distant links keeps a straight main-chain connection direct', () => {
  const { status, receipt } = validate(fileURLToPath(fixtureUrl('review8-group-detour')), 'standard', '--layout-json');
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
  const link = receipt.connections.find(route => route.from === 'n1' && route.to === 'n2');
  assert.equal(link.points.length, 2);
  assert.ok(Math.hypot(link.points[0][0] - link.points[1][0], link.points[0][1] - link.points[1][1]) <= 131);
});

test('group proposals that cannot preserve a nearby route spend no additional routed candidates', () => {
  const { status, receipt } = validate(fileURLToPath(fixtureUrl('review8-group-runtime')), 'standard', '--layout-json');
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
  assert.ok(receipt.routedPlacementCandidates <= 4, JSON.stringify(receipt.routedPlacementCandidates));
});

test('an inferred return label keeps its elbows and competing shafts visible', () => {
  const { status, receipt } = validate(fileURLToPath(fixtureUrl('rounded-return-label')), 'showcase', '--layout-json');
  assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
  const label = receipt.labels.find(({ text }) => text === 'first passing candidate');
  const owner = receipt.connections.find(({ from, to }) => from === 'judge' && to === 'runner');
  const ownPath = prepareCrossingPath(roundedPathSegments(owner.points, 8));
  const corners = { ...ownPath, segments: ownPath.segments.filter(segment => segment.control) };
  assert.ok(drawnPathRectClearance(corners, label) >= 0.75);
  const ownDistance = drawnPathRectClearance(ownPath, label);
  for (const route of receipt.connections) {
    if (route === owner) continue;
    const path = prepareCrossingPath(roundedPathSegments(route.points, 8));
    assert.ok(drawnPathRectClearance(path, label) >= ownDistance + 4);
  }
});

for (const [name, text, points] of [
  ['review9-fixed-074', 'Fetch data 5', [
    [[136, 88], [209, 88]],
    [[309, 86], [356.5, 86], [356.5, 59], [404, 59]],
    [[420, 103], [420, 162], [96, 162], [96, 199]],
    [[110, 199], [110, 163], [266, 163], [266, 187]],
    [[280, 187], [280, 163], [516, 163], [516, 201], [492, 201]],
    [[432, 237], [432, 261], [180, 261], [180, 234], [156, 234]],
    [[259, 112], [259, 155.5], [82, 155.5], [82, 199]],
    [[388, 165], [388, 115], [136, 115]],
    [[156, 220], [217, 220], [217, 126], [348.5, 126], [348.5, 87], [404, 87]],
  ]],
  ['review9-fixed-125', 'Retrieve configuration 6', [
    [[157, 85], [202, 85]],
    [[286, 56], [286, 48], [387, 48]],
    [[387, 69], [363, 69], [363, 156], [161, 156], [161, 188], [137, 188]],
    [[137, 215], [178.5, 215], [178.5, 198], [220, 198]],
    [[320, 188], [397, 188]],
    [[270, 162], [270, 146], [286, 146], [286, 128]],
  ]],
]) {
  test(`automatic labels clear strokes and markers without moving pinned geometry in ${name}`, () => {
    const input = load(name);
    const { status, receipt } = validate(fileURLToPath(fixtureUrl(name)),
      input.meta.quality_profile ?? 'standard', '--layout-json');
    assert.equal(status, 0, JSON.stringify(receipt.diagnostics));
    assert.deepEqual(receipt.components.map(({ x, y }) => [x, y]), input.components.map(({ pos }) => pos));
    assert.deepEqual(receipt.connections.map(route => route.points), points);
    const ownerIndex = receipt.connections.findIndex(({ label }) => label === text);
    const label = connectionLabelBoxAt(input.connections[ownerIndex], receipt.connections[ownerIndex].labelAt);
    const paths = points.map(route => prepareCrossingPath(roundedPathSegments(route, 8)));
    const own = drawnPathRectClearance(paths[ownerIndex], label);
    for (const [index, route] of points.entries()) {
      const { width, variant } = input.connections[index];
      const stroke = width || (variant === 'emphasis' ? 1.8 : 1.5);
      assert.equal(maskCoversArrowhead(label, arrowheadTriangle(route.at(-1), route.at(-2), stroke)), false);
      if (index !== ownerIndex) assert.ok(drawnPathRectClearance(paths[index], label) >= own + 4);
    }
  });
}
