import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { automaticComponentPositions } from '../archify/renderers/architecture/automatic-placement.mjs';
import { connectionLabelBoxAt, createArchitectureRouter } from '../archify/renderers/architecture/routing.mjs';
import { properSegmentIntersection, segmentRectClearance } from '../archify/renderers/shared/geometry.mjs';

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
