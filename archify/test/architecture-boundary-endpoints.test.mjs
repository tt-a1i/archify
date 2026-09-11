import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-boundary-endpoints-'));
let sequence = 0;
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function run(doc, command = 'render') {
  const input = path.join(tmp, `input-${sequence++}.json`);
  const output = input.replace(/\.json$/, '.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  const args = command === 'render' ? [output] : ['--layout-json', '--json'];
  const result = spawnSync(process.execPath, [cli, command, 'architecture', input, ...args], { encoding: 'utf8' });
  assert.ifError(result.error);
  return {
    ...result,
    svg: result.status === 0 && command === 'render'
      ? fs.readFileSync(output, 'utf8').match(/<svg\b[\s\S]*?<\/svg>/)[0]
      : null,
  };
}

function render(doc) {
  const result = run(doc);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.svg;
}

function inspect(doc) {
  const result = run(doc, 'validate');
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

function diagram(connection = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Boundary endpoints', quality_profile: 'standard' },
    components: [
      { id: 'left', type: 'backend', label: 'Left', pos: [120, 140], size: [120, 60] },
      { id: 'right', type: 'database', label: 'Right', pos: [620, 140], size: [120, 60] },
    ],
    boundaries: [
      { id: 'left-scope', kind: 'region', label: 'Left scope', wraps: ['left'], pad: 24 },
      { id: 'right-scope', kind: 'security-group', label: 'Right scope', wraps: ['right'], pad: 24 },
    ],
    connections: [{ id: 'between', from: 'left-scope', to: 'right-scope', ...connection }],
  };
}

function frameRect(svg, label) {
  const match = svg.match(new RegExp(
    `<rect data-graph-role="structural-frame"[^>]*data-composition-frame-label="${label}"[^>]*x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`,
  ));
  assert.ok(match, `missing boundary ${label}`);
  const [x, y, width, height] = match.slice(1).map(Number);
  return { x, y, width, height };
}

function connectionPoints(svg) {
  const match = svg.match(/data-edge-id="between"[^>]*data-composition-points="([^"]+)"/);
  assert.ok(match, 'missing boundary connection');
  return match[1].split(';').map((point) => point.split(',').map(Number));
}

for (const [route, fromSide, toSide, targetPos] of [
  ['auto', 'right', 'left', [620, 300]],
  ['straight', 'right', 'left', [620, 140]],
  ['orthogonal-h', 'right', 'left', [620, 300]],
  ['orthogonal-v', 'bottom', 'top', [620, 380]],
]) {
  test(`architecture: ${route} connections join the visible boundary frames`, () => {
    const doc = diagram({ route, fromSide, toSide });
    doc.components[1].pos = targetPos;
    doc.meta.views = [{ id: 'scopes', label: 'Scope handoff', focus: ['left-scope', 'right-scope'] }];
    const svg = render(doc);
    const left = frameRect(svg, 'Left scope');
    const right = frameRect(svg, 'Right scope');
    const points = connectionPoints(svg);
    assert.deepEqual(points[0], fromSide === 'right'
      ? [left.x + left.width, left.y + left.height / 2]
      : [left.x + left.width / 2, left.y + left.height]);
    assert.deepEqual(points.at(-1), toSide === 'left'
      ? [right.x, right.y + right.height / 2]
      : [right.x + right.width / 2, right.y]);
    for (let index = 1; index < points.length; index += 1) {
      assert.ok(points[index][0] === points[index - 1][0] || points[index][1] === points[index - 1][1]);
    }
    for (const boundary of doc.boundaries) {
      assert.match(svg, new RegExp(`data-node-id="${boundary.id}"[^>]*data-node-kind="${boundary.kind}"`));
    }
    assert.deepEqual(
      [...svg.matchAll(/data-legend-semantic-kind="([^"]+)"/g)].map((match) => match[1]),
      ['backend', 'database'],
      'boundary kinds must not become component legend entries',
    );
    const layout = inspect(doc);
    assert.deepEqual(layout.components.map(({ id }) => id), ['left', 'right']);
    assert.equal(layout.connections.length, 1);
    assert.deepEqual(layout.connections[0].points, points.map((point) => point.map(Math.round)));
  });
}

for (const [from, to] of [['left', 'right-scope'], ['left-scope', 'right']]) {
  test(`architecture: mixed endpoints ${from} -> ${to} share component routing`, () => {
    const svg = render(diagram({ from, to }));
    const points = connectionPoints(svg);
    const left = frameRect(svg, 'Left scope');
    const right = frameRect(svg, 'Right scope');
    assert.equal(points[0][0], from === 'left' ? 240 : left.x + left.width);
    assert.equal(points.at(-1)[0], to === 'right' ? 620 : right.x);
  });
}

test('architecture: boundary anchors use the final title-expanded frame', () => {
  const doc = diagram({ route: 'straight', fromSide: 'right', toSide: 'left' });
  doc.boundaries[0].label = 'Disaster recovery ownership boundary';
  doc.boundaries[0].pad = 0;
  const svg = render(doc);
  const frame = frameRect(svg, doc.boundaries[0].label);
  assert.ok(frame.width > doc.components[0].size[0], 'title must expand the component-derived frame');
  assert.deepEqual(connectionPoints(svg)[0], [frame.x + frame.width, frame.y + frame.height / 2]);
});

for (const [name, labelOptions, expected] of [
  ['explicit labelAt', { labelAt: [430, 285], labelDx: 25, labelDy: 30 }, [430, 285]],
  ['labelSegment and offsets', { labelSegment: 1, labelDx: 15, labelDy: 5 }, [355, 228]],
]) {
  test(`architecture: boundary routes preserve authored via and ${name}`, () => {
    const via = [[340, 168], [340, 298], [520, 298], [520, 168]];
    const doc = diagram({
      label: 'handoff',
      fromSide: 'right',
      toSide: 'left',
      via,
      ...labelOptions,
    });
    const layout = inspect(doc);
    assert.deepEqual(layout.connections[0].points.slice(1, -1), via);
    assert.deepEqual(layout.connections[0].labelAt, expected);
    assert.deepEqual(layout.labels[0].labelAt, expected);
    const svg = render(doc);
    assert.deepEqual(connectionPoints(svg).slice(1, -1), via);
  });
}

test('architecture: assigning boundary ids leaves legacy component geometry unchanged', () => {
  const doc = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'test/fixtures/v1-baseline/web-app.architecture.json'), 'utf8',
  ));
  const legacy = inspect(doc);
  doc.boundaries.forEach((boundary, index) => { boundary.id = `scope-${index}`; });
  const identified = inspect(doc);
  assert.deepEqual(identified.components, legacy.components);
  assert.deepEqual(identified.connections, legacy.connections);
  assert.deepEqual(identified.labels, legacy.labels);
  assert.deepEqual(identified.viewBox, legacy.viewBox);
  assert.deepEqual(identified.boundaries.map(({ id, ...boundary }) => boundary), legacy.boundaries);
});

for (const [name, mutate] of [
  ['duplicate boundary ids', (doc) => { doc.boundaries[1].id = 'left-scope'; }],
  ['component and boundary id collision', (doc) => { doc.boundaries[0].id = 'left'; }],
]) {
  test(`architecture: ${name} are rejected without a renderer crash`, () => {
    const doc = diagram();
    doc.connections = [];
    mutate(doc);
    const result = run(doc, 'validate');
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout}\n${result.stderr}`, /ids must be unique/i);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /TypeError|Cannot read/);
  });
}

test('architecture: boundary endpoints retain component obstacle validation', () => {
  const doc = diagram({ route: 'straight', fromSide: 'right', toSide: 'left' });
  doc.components.push({ id: 'obstacle', type: 'backend', label: 'Obstacle', pos: [380, 140], size: [120, 60] });
  const result = run(doc, 'validate');
  assert.notEqual(result.status, 0);
  const receipt = JSON.parse(result.stdout);
  const diagnostic = receipt.diagnostics.find(({ code }) => code === 'clean-flow/edge-through-node');
  assert.ok(diagnostic, JSON.stringify(receipt));
  assert.equal(diagnostic.evidence.obstacleId, 'obstacle');
});

test('architecture: boundary wraps remain component references', () => {
  const doc = diagram();
  doc.connections = [];
  doc.boundaries[1].wraps = ['left-scope'];
  const result = run(doc, 'validate');
  assert.notEqual(result.status, 0);
  assert.match(JSON.parse(result.stdout).error, /wraps unknown component "left-scope"/);
});

for (const [name, mutate] of [
  ['member component', (doc) => { doc.connections[0].to = 'left'; }],
  ['nested boundary', (doc) => {
    doc.boundaries.push({ id: 'outer', kind: 'region', label: 'Outer scope', wraps: ['left'], pad: 64 });
    doc.connections[0].from = 'outer';
    doc.connections[0].to = 'left-scope';
  }],
]) {
  test(`architecture: a boundary connected to its ${name} has a repairable diagnostic`, () => {
    const doc = diagram();
    mutate(doc);
    const result = run(doc, 'validate');
    assert.notEqual(result.status, 0);
    const receipt = JSON.parse(result.stdout);
    const diagnostic = receipt.diagnostics.find(({ code }) => code === 'architecture/boundary-endpoint-contained');
    assert.ok(diagnostic, JSON.stringify(receipt));
    assert.ok(diagnostic.supportedFixes.length > 0);
  });
}
