import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { normalizeRoutePoints } from '../archify/renderers/shared/geometry.mjs';

const renderer = fileURLToPath(new URL('../archify/renderers/architecture/render-architecture.mjs', import.meta.url));

function render(t, cards, links, frame) {
  const dir = mkdtempSync(join(tmpdir(), 'archify-junction-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const input = join(dir, 'input.json');
  writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    layout: { mode: 'auto' },
    meta: { title: 'Automatic junctions', output: 'chart.html', quality_profile: 'showcase' },
    components: cards.map(([id, width]) => ({ id, label: id, type: 'backend', size: [width, 60] })),
    connections: links.map(([from, to, label, emphasis]) => ({
      from, to, label, ...(emphasis ? { variant: 'emphasis' } : {}),
    })),
    boundaries: frame ? [{ label: frame[0], kind: 'region', wraps: frame[1], pad: 24 }] : undefined,
  }));
  const result = spawnSync(process.execPath, [renderer, input, '--layout-json'], { encoding: 'utf8', cwd: dir });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function junctionMeasures(layout, id) {
  const cards = new Map(layout.components.map(card => [card.id, card]));
  const routeLength = points => points.slice(1).reduce((sum, [x, y], i) =>
    sum + Math.abs(x - points[i][0]) + Math.abs(y - points[i][1]), 0);
  const routes = layout.connections.map(route => ({ ...route, points: normalizeRoutePoints(route.points) }));
  const incoming = routes.filter(route => route.to === id);
  const offset = (axis, size) => {
    const center = card => card[axis] + card[size] / 2;
    const average = incoming.reduce((sum, route) => sum + center(cards.get(route.from)), 0) / incoming.length;
    return Math.abs(center(cards.get(id)) - average);
  };
  return {
    incoming,
    routes,
    straight: incoming.filter(route => route.points.length === 2).length,
    offset: offset('x', 'width') + offset('y', 'height'),
    totalLength: routes.reduce((sum, route) => sum + routeLength(route.points), 0),
    maxArrival: incoming.reduce((max, route) => Math.max(max, routeLength(route.points)), 0),
  };
}

const collectorCards = [
  ['events', 212], ['files', 145], ['collector', 192], ['index', 162], ['lookup', 152],
  ['reporter', 170], ['browser', 164], ['compressor', 183], ['worker', 125], ['exporter', 135],
];
const collectorLinks = [
  ['events', 'collector', 'Raw activity'], ['files', 'collector', 'Read changes'],
  ['collector', 'index', 'Save records and references', true], ['lookup', 'index', 'Search and append'],
  ['reporter', 'index', 'Read history and notes'], ['browser', 'reporter', 'HTTP request'],
  ['compressor', 'index', 'Build summaries'], ['compressor', 'worker', 'Summarize batch of records'],
  ['exporter', 'index', 'Capture snapshot'],
];

for (const { count, framed, length, offset, longest, straight } of [
  { count: 3, framed: false, length: 1200, offset: 150, longest: 320, straight: 3 },
  { count: 4, framed: false, length: 2300, offset: 200, longest: 700, straight: 3 },
  { count: 4, framed: true, length: 2800, offset: 270, longest: 650, straight: 2 },
  { count: 5, framed: false, length: 2600, offset: 160, longest: 850, straight: 4 },
  { count: 5, framed: true, length: 3500, offset: 420, longest: 950, straight: 3 },
]) {
  test(`a shared sink stays near ${count} sources${framed ? ' with a frame' : ''}`, t => {
    const excluded = count === 3 ? ['compressor', 'worker', 'exporter'] : count === 4 ? ['exporter'] : [];
    const cards = collectorCards.filter(([id]) => !excluded.includes(id));
    let links = collectorLinks.filter(([from, to]) => !excluded.includes(from) && !excluded.includes(to));
    if (count === 5 && framed) links = links.map(([from, to, label, emphasis]) => [from, to, label.split(' ')[0], emphasis]);
    if (count === 5 && !framed) links = [...links.filter(([, to]) => to !== 'worker'), ['browser', 'worker', 'Dispatch']];
    const frame = framed ? ['Collection inputs', ['events', 'files']] : undefined;
    const measured = junctionMeasures(render(t, cards, links, frame), 'index');
    assert.equal(measured.incoming.length, count);
    assert.ok(measured.offset <= offset, `distance from source mean is ${measured.offset}`);
    assert.ok(measured.totalLength <= length, `total route length is ${measured.totalLength}`);
    assert.ok(measured.maxArrival <= longest, `longest arrival is ${measured.maxArrival}`);
    assert.ok(measured.straight >= straight, `only ${measured.straight} arrivals are straight`);
  });
}

const dispatchCards = [
  ['client', 138], ['settings', 124], ['controller', 132], ['simulator', 131], ['adapter', 138],
  ['executor', 181], ['workspace', 160], ['checker', 124], ['history', 145], ['summary', 124], ['alerts', 138],
];
const dispatchLinks = [
  ['client', 'controller', 'Start job', true], ['controller', 'settings', 'Read plan'],
  ['controller', 'simulator', 'Use simulated provider'], ['controller', 'adapter', 'Start external provider'],
  ['adapter', 'executor', 'Invoke worker'], ['simulator', 'workspace', 'Write output'],
  ['executor', 'workspace', 'Apply requested changes'], ['controller', 'workspace', 'Prepare working files'],
  ['controller', 'checker', 'Run checks'], ['checker', 'workspace', 'Verify changes'],
  ['controller', 'history', 'Record result', true], ['history', 'summary', 'Generate summary', true],
  ['controller', 'alerts', 'Publish events'],
];

for (const { degree, framed, length, offset, longest, bends } of [
  { degree: 5, framed: true, length: 1740, offset: 350, longest: 500, bends: 5 },
  { degree: 6, framed: false, length: 1750, offset: 210, longest: 300, bends: 4 },
  { degree: 7, framed: true, length: 2850, offset: 415, longest: 525, bends: 9 },
  { degree: 8, framed: false, length: 2600, offset: 340, longest: 430, bends: 9 },
  { degree: 8, framed: true, length: 3050, offset: 380, longest: 470, bends: 9 },
]) {
  test(`a hub with ${degree} relationships keeps its branches compact${framed ? ' with a frame' : ''}`, t => {
    const excluded = degree === 5 ? ['settings', 'alerts', 'checker']
      : degree === 6 ? ['alerts', 'checker'] : degree === 7 ? ['alerts'] : [];
    const cards = dispatchCards.filter(([id]) => !excluded.includes(id));
    const links = dispatchLinks.filter(([from, to]) => !excluded.includes(from) && !excluded.includes(to));
    const frame = framed ? ['Report outputs', ['history', 'summary']] : undefined;
    const layout = render(t, cards, links, frame);
    const measured = junctionMeasures(layout, 'workspace');
    const incident = measured.routes.filter(route => route.from === 'controller' || route.to === 'controller');
    assert.equal(incident.length, degree);
    assert.ok(measured.offset <= offset, `workspace distance from source mean is ${measured.offset}`);
    assert.ok(measured.maxArrival <= longest, `longest workspace arrival is ${measured.maxArrival}`);
    assert.ok(measured.totalLength <= length, `total route length is ${measured.totalLength}`);
    const incidentBends = incident.reduce((sum, route) => sum + route.points.length - 2, 0);
    assert.ok(incidentBends <= bends, `routes at the hub have ${incidentBends} bends`);
  });
}
