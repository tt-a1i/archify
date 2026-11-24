import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const renderer = fileURLToPath(new URL('../archify/renderers/architecture/render-architecture.mjs', import.meta.url));
const longLabel = 'objectStore + retentionDays';

function automaticDiagram(links, width = 120) {
  const ids = new Set(links.flatMap(([from, to]) => [from, to]));
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Retention policy', output: 'chart.html', quality_profile: 'showcase' },
    layout: { mode: 'auto' },
    components: [...ids].map(id => ({ id, type: 'backend', label: id, size: [width, 60] })),
    connections: links.map(([from, to, label]) => ({ from, to, label })),
  };
}

function render(t, diagram) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-label-spacing-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const input = path.join(cwd, 'input.json');
  fs.writeFileSync(input, JSON.stringify(diagram));
  const result = spawnSync(process.execPath, [renderer, input, '--layout-json'], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function horizontalSlot({ connections, labels }, from, to) {
  const { points, label } = connections.find(route => route.from === from && route.to === to);
  const plate = labels.find(entry => entry.text === label);
  assert.equal(points.length, 2, `${from} → ${to} should use a single shaft`);
  const [[left, y], [right, endY]] = points;
  assert.equal(y, endY);
  assert.ok(plate.x >= left + 13 && plate.x + plate.width <= right - 13);
  assert.ok(y >= plate.y + plate.height && y - plate.y - plate.height <= 6);
  return right - left;
}

test('a long label opens only its own column gap on a row shared by parallel paths', t => {
  const links = [
    ['writer', 'index', longLabel], ['index', 'store', 'Save'],
    ['writer', 'cache'], ['cache', 'store'],
    ['writer', 'backup'], ['backup', 'store'], ['store', 'reader', 'Read'],
  ];
  const compact = render(t, automaticDiagram([['writer', 'index', 'Put'], ...links.slice(1)]));
  const result = render(t, automaticDiagram(links));
  const required = result.labels.find(label => label.text === longLabel).width + 28;
  const reserved = horizontalSlot(result, 'writer', 'index');
  assert.ok(Math.abs(reserved - required) < 1);
  for (const [from, to] of [['index', 'store'], ['store', 'reader']]) {
    assert.ok(Math.abs(horizontalSlot(result, from, to) - horizontalSlot(compact, from, to)) < 0.0001);
  }
});

test('a horizontal pair reserves space for the full relationship label', t => {
  const result = render(t, automaticDiagram([['writer', 'store', longLabel]]));
  assert.ok(Math.abs(horizontalSlot(result, 'writer', 'store') - result.labels[0].width - 28) < 1);
});

test('stacked cards use a side slot without adding a horizontal label width to their row gap', t => {
  const compact = render(t, automaticDiagram([['writer', 'store', 'Put']], 500));
  const result = render(t, automaticDiagram([['writer', 'store', longLabel]], 500));
  const [{ points }] = result.connections;
  assert.equal(points.length, 2);
  const [[x, top], [endX, bottom]] = points;
  assert.equal(x, endX);
  assert.deepEqual(points, compact.connections[0].points);
  assert.deepEqual(result.viewBox, compact.viewBox);
  const [plate] = result.labels;
  assert.ok(plate.y >= top + 14 && plate.y + plate.height <= bottom - 14);
  assert.ok(Math.min(Math.abs(plate.x - x), Math.abs(plate.x + plate.width - x)) <= 6);
});

const manifestLabel = 'Manifest and retention';

function rankedDiagram(count, width, wraps = []) {
  const ids = ['archive', 'catalog', ...Array.from({ length: count - 2 }, (_, index) => `stage-${index + 1}`)];
  const links = ids.slice(2).map((id, index) => [id, ids[index + 1]]);
  links.push([ids[2], 'archive'], ['catalog', 'archive', manifestLabel]);
  const diagram = automaticDiagram(links, width);
  diagram.components.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  diagram.connections.at(-1).variant = 'dashed';
  if (wraps.length) diagram.boundaries = [{ label: 'Storage', kind: 'region', wraps }];
  return diagram;
}

function framedMemberBounds({ components, boundaries: [frame] }) {
  const members = components.filter(card => frame.wraps.includes(card.id));
  const left = Math.min(...members.map(card => card.x));
  const right = Math.max(...members.map(card => card.x + card.width));
  const top = Math.min(...members.map(card => card.y));
  const bottom = Math.max(...members.map(card => card.y + card.height));
  assert.ok(Math.abs(left - frame.x - 30) < 1);
  assert.ok(Math.abs(frame.x + frame.width - right - 30) < 1);
  assert.ok(Math.abs(top - frame.y - 30) < 1);
  assert.ok(Math.abs(frame.y + frame.height - bottom - 20) < 1);
  return frame;
}

function manifestShaft(result, { vertical = false } = {}) {
  const route = result.connections.find(route => route.label === manifestLabel);
  const plate = result.labels.find(label => label.text === manifestLabel);
  assert.equal(route.points.length, 2, 'the labeled relationship should use a single shaft');
  const along = vertical ? 1 : 0;
  const [start, end] = route.points;
  assert.equal(start[1 - along], end[1 - along]);
  const left = Math.min(start[along], end[along]);
  const right = Math.max(start[along], end[along]);
  const labelStart = vertical ? plate.y : plate.x;
  const labelEnd = labelStart + (vertical ? plate.height : plate.width);
  const side = vertical ? plate.x : plate.y;
  const sideEnd = side + (vertical ? plate.width : plate.height);
  const distance = Math.max(side - start[1 - along], start[1 - along] - sideEnd);
  // Layout JSON rounds the plate coordinates and reports exact route points.
  assert.ok(labelStart >= Math.round(left) + 13 && labelEnd <= Math.round(right) - 13);
  assert.ok(distance > 0 && distance <= 7);
  return { span: right - left, plate };
}

test('a long label fits a straight route between two members of a tight frame', t => {
  const diagram = rankedDiagram(4, 350, ['archive', 'catalog', 'stage-1', 'stage-2']);
  const result = render(t, diagram);
  const { span, plate } = manifestShaft(result);
  assert.ok(Math.abs(span - plate.width - 28) < 1);
  framedMemberBounds(result);
});

test('a link to a frame member keeps its label clear of the crossed border', t => {
  const result = render(t, rankedDiagram(4, 350, ['archive']));
  const frame = framedMemberBounds(result);
  const { span, plate } = manifestShaft(result);
  assert.ok(plate.x >= frame.x + frame.width + 2);
  assert.ok(Math.abs(span - plate.width - 30 - 14 - 2) < 1);
});

test('a large ranked layout reserves a label slot between cards of the same rank', t => {
  const diagram = rankedDiagram(12, 120);
  const compact = structuredClone(diagram);
  compact.connections.at(-1).label = 'Copy';
  const before = render(t, compact);
  const result = render(t, diagram);
  const { span, plate } = manifestShaft(result);
  assert.ok(Math.abs(span - plate.width - 28) < 1);
  assert.deepEqual(result.components.map(card => card.y), before.components.map(card => card.y));
});

test('stacked members keep their straight side slot and frame padding', t => {
  const diagram = automaticDiagram([['catalog', 'archive', manifestLabel]], 500);
  diagram.boundaries = [{ label: 'Storage', kind: 'region', wraps: ['catalog', 'archive'] }];
  const compact = structuredClone(diagram);
  compact.connections[0].label = 'Copy';
  const before = render(t, compact);
  const result = render(t, diagram);
  manifestShaft(result, { vertical: true });
  framedMemberBounds(result);
  assert.deepEqual(result.components, before.components);
  assert.deepEqual(result.boundaries, before.boundaries);
});

const stage = index => `stage-${index}`;

function sideCardDiagram({ side, count, width, height, level, peers, label, framed, mainVariant }) {
  const chain = Array.from({ length: count }, (_, index) => stage(index));
  const ids = side === 'right' ? [...chain, 'policy'] : [...chain];
  if (side === 'left') ids.splice(framed ? 0 : 1, 0, 'policy');
  const links = chain.slice(1).map((id, index) => [chain[index], id]);
  links.push(...[level, ...peers].sort((a, b) => a - b)
    .map(index => ['policy', stage(index), index === level ? label : undefined]));
  links.push([stage(level - 1), 'policy']);
  const diagram = automaticDiagram(links, width);
  diagram.components.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  diagram.components.forEach(card => { card.size[1] = height; });
  diagram.connections.forEach((connection, index) => {
    if (index < count - 1) connection.variant = mainVariant;
    else if (connection.from === 'policy') connection.variant = 'dashed';
  });
  if (framed) {
    diagram.boundaries = [{ label: 'Policy scope', kind: 'region', wraps: ['policy', stage(level - 1), stage(level)] }];
  }
  return diagram;
}

for (const {
  side, count, width, height, level, peers, label, framed, mainVariant,
} of [
  { side: 'left', count: 9, width: 155, height: 72, level: 4, peers: [5, 6],
    label: 'Apply retention and privacy', framed: false, mainVariant: 'default' },
  { side: 'right', count: 8, width: 300, height: 60, level: 2, peers: [0, 5],
    label: 'Monthly usage reconciliation', framed: false, mainVariant: 'emphasis' },
  { side: 'left', count: 10, width: 610, height: 86, level: 3, peers: [5],
    label: 'Apply retention and privacy', framed: true, mainVariant: 'emphasis' },
  { side: 'right', count: 10, width: 560, height: 72, level: 4, peers: [6],
    label: 'Inject workspace restrictions', framed: true, mainVariant: 'emphasis' },
]) {
  test(`a ${framed ? 'framed' : 'standalone'} side card on the ${side} reserves a label slot for its level link`, t => {
    const diagram = sideCardDiagram({ side, count, width, height, level, peers, label, framed, mainVariant });
    const result = render(t, diagram);
    const policy = result.components.find(card => card.id === 'policy');
    const outgoing = result.connections.filter(route => route.from === 'policy');
    const levelRoute = outgoing.find(route => route.to === stage(level));
    const plate = result.labels.find(entry => entry.text === label);
    assert.equal(levelRoute.points.length, 2, 'the level link should use a single shaft');
    const [[startX, shaftY], [endX, endY]] = levelRoute.points;
    assert.equal(shaftY, endY);
    assert.equal(startX < endX, side === 'left');
    assert.ok(plate.x >= Math.round(Math.min(startX, endX)) + 13);
    assert.ok(plate.x + plate.width <= Math.round(Math.max(startX, endX)) - 13);
    const clearance = Math.max(shaftY - plate.y - plate.height, plate.y - shaftY);
    assert.ok(clearance > 0 && clearance <= 7, 'the label should sit beside its horizontal shaft');

    const verticalPorts = new Map();
    for (const { points, to } of outgoing.filter(route => route !== levelRoute)) {
      const peer = result.components.find(card => card.id === to);
      const face = peer.y < policy.y ? policy.y : policy.y + policy.height;
      const [[portX, portY], [nextX, nextY]] = points;
      assert.equal(portY, face, 'the other link should leave toward its row');
      assert.equal(portX, nextX);
      assert.equal(nextY < portY, peer.y < policy.y);
      for (const otherX of verticalPorts.get(face) ?? []) assert.ok(Math.abs(portX - otherX) >= 22);
      verticalPorts.set(face, [...(verticalPorts.get(face) ?? []), portX]);
    }

    for (const { points } of result.connections.slice(0, count - 1)) {
      assert.equal(points.length, 2, 'the main chain should keep its straight links');
      assert.equal(points[0][0], points[1][0]);
    }
    if (framed) framedMemberBounds(result);
  });
}

test('side-card spacing preserves a showcase diagram at the desktop text floor', t => {
  const diagram = sideCardDiagram({ side: 'left', count: 10, width: 620, height: 86, level: 3, peers: [5],
    label: 'Apply retention and privacy', framed: true, mainVariant: 'emphasis' });
  const result = render(t, diagram);
  // At the 930 px Reader budget a 10 px source label must project to at least 6 px.
  assert.ok(result.viewBox[0] <= 930 * 10 / 6);
});
