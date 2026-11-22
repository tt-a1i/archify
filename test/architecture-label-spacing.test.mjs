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
