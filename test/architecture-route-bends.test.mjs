import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectionLabelBoxAt, createArchitectureRouter, createRouter } from '../archify/renderers/architecture/routing.mjs';
import { placeCrossedLeaf } from '../archify/renderers/architecture/crossed-leaf-placement.mjs';
import { labelPoint, segmentRectClearance } from '../archify/renderers/shared/geometry.mjs';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));

function box(id, x, y, width = 230, height = 80) {
  return [id, { id, x, y, width, height, cx: x + width / 2, cy: y + height / 2 }];
}

// The hive runtime case: a bottom-to-left relationship shares the runtime's
// bottom side with an upward security link. Both a three-bend stub route and
// a one-bend corner pass every check at the same length.
function scene(labelRectFor) {
  const boxes = new Map([box('runtime', 440, 230), box('tasks', 870, 450), box('tunnel', 440, 650)]);
  const connections = [
    { id: 'tasks', from: 'runtime', to: 'tasks', label: 'watch', fromSide: 'bottom', toSide: 'left' },
    { id: 'tunnel', from: 'tunnel', to: 'runtime', fromSide: 'top', toSide: 'bottom' },
  ];
  const router = createRouter(boxes, connections, { distinctAutomaticPorts: true, preferReadableRoutes: true, labelRectFor });
  return router.pathFor(connections[0]).points;
}

test('architecture takes the fewest-bend route among equally long side-aware candidates', () => {
  const points = scene();
  assert.equal(points.length, 3, JSON.stringify(points));
  assert.deepEqual(points.at(-1), [870, 490]);
  assert.equal(points[1][1], 490);
});

test('architecture keeps a feasible route with label room over a fewer-bend route without it', () => {
  const points = scene((conn, route) => (route.length > 3 ? { x: 0, y: 0, width: 1, height: 1 } : null));
  assert.equal(points.length, 5, JSON.stringify(points));
});

test('showcase shortens a route when a neighboring automatic label can move safely', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-label-detour-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Content build', output: 'diagram.html', quality_profile: 'showcase' },
    components: [
      { id: 'source', type: 'backend', label: 'Source', sublabel: 'Load and validate', pos: [400, 40], size: [235, 76] },
      { id: 'published', type: 'security', label: 'Published content', sublabel: 'Exclude drafts', pos: [760, 40], size: [235, 76] },
      { id: 'build', type: 'backend', label: 'Build', sublabel: 'Render pages', pos: [400, 210], size: [235, 76] },
      { id: 'feed', type: 'backend', label: 'Feed', sublabel: 'Requires SITE_URL', pos: [760, 210], size: [235, 76] },
    ],
    connections: [
      { id: 'publish', from: 'source', to: 'published', label: '筛选' },
      { id: 'build-input', from: 'published', to: 'build', label: '公开内容' },
      { id: 'feed-output', from: 'build', to: 'feed', label: 'SITE_URL 有值' },
    ],
  }));
  const original = fs.readFileSync(input, 'utf8');
  const result = spawnSync(process.execPath, [cli, 'render', 'architecture', input, output, '--quality', 'showcase'], {
    cwd: directory, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const points = html.match(/data-edge-id="build-input"[^>]*data-composition-points="([^"]+)"/)[1].split(';');
  assert.ok(points.length <= 4, `a movable label must not force three bends: ${points}`);
  for (const label of ['筛选', '公开内容', 'SITE_URL 有值']) assert.ok(html.includes(`>${label}</text>`), label);
  assert.equal(fs.readFileSync(input, 'utf8'), original);
});

function validate(t, profile, replySides) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-pinned-reply-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'diagram.json');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Reply', output: 'diagram.html', quality_profile: profile },
    components: [
      { id: 'runtime', type: 'backend', label: 'Runtime', pos: [40, 120], size: [200, 80] },
      { id: 'agents', type: 'backend', label: 'Agents', pos: [440, 120], size: [200, 80] },
    ],
    connections: [
      { id: 'spawn', from: 'runtime', to: 'agents', label: 'spawn' },
      { id: 'report', from: 'agents', to: 'runtime', label: 'report', ...replySides },
    ],
  }));
  const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--quality', profile, '--json'], {
    cwd: directory, encoding: 'utf8',
  });
  return { status: result.status, receipt: JSON.parse(result.stdout) };
}

test('showcase preserves a valid authored reply side even when automatic lanes are straighter', t => {
  const { status, receipt } = validate(t, 'showcase', { fromSide: 'top', toSide: 'top' });
  assert.equal(status, 0, JSON.stringify(receipt));
  assert.ok(receipt.composition.metrics.maxBends > 0);
  const automatic = validate(t, 'showcase', {});
  assert.equal(automatic.status, 0, JSON.stringify(automatic.receipt));
  assert.equal(automatic.receipt.composition.metrics.maxBends, 0);
  assert.equal(validate(t, 'standard', { fromSide: 'top', toSide: 'top' }).status, 0);
});

test('architecture straightens a dogleg between facing nodes that overlap across the route', () => {
  const boxes = new Map([box('api', 40, 100, 200, 80), box('worker', 440, 130, 200, 80), box('store', 440, 330, 200, 80)]);
  const connections = [
    { id: 'run', from: 'api', to: 'worker' },
    { id: 'save', from: 'worker', to: 'store' },
  ];
  const router = createRouter(boxes, connections, { distinctAutomaticPorts: true, preferReadableRoutes: true });
  const points = router.pathFor(connections[0]).points;
  assert.equal(points.length, 2, JSON.stringify(points));
  assert.equal(points[0][1], points[1][1]);
  assert.ok(points[0][1] >= 146 && points[0][1] <= 164, JSON.stringify(points));
});

test('showcase slides a boundary title off a route that crosses its rail', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-title-route-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Title', output: 'diagram.html', quality_profile: 'showcase' },
    components: [
      { id: 'cache', type: 'database', label: 'Cache', pos: [40, 40], size: [100, 64] },
      { id: 'api', type: 'backend', label: 'API', pos: [60, 220], size: [260, 80] },
    ],
    connections: [{ id: 'read', from: 'api', to: 'cache' }],
    boundaries: [{ kind: 'region', label: 'Backend services', wraps: ['api'] }],
  }));
  const result = spawnSync(process.execPath, [cli, 'render', 'architecture', input, output, '--quality', 'showcase'], { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const [, x, width] = html.match(/structural-frame-label-mask" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/).map(Number);
  const routeX = Number(html.match(/data-edge-id="read"[^>]*data-composition-points="([\d.]+),/)[1]);
  assert.ok(routeX < x - 2 || routeX > x + width + 2, JSON.stringify({ x, width, routeX }));
});


test('showcase moves a boundary title around an authored connection label', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-title-authored-label-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Title', output: 'diagram.html', quality_profile: 'showcase' },
    components: [
      { id: 'cache', type: 'database', label: 'Cache', pos: [40, 40], size: [100, 64] },
      { id: 'api', type: 'backend', label: 'API', pos: [60, 220], size: [260, 80] },
      { id: 'a', type: 'backend', label: 'A', pos: [400, 300], size: [200, 80] },
      { id: 'b', type: 'backend', label: 'B', pos: [800, 300], size: [200, 80] },
    ],
    connections: [
      { id: 'read', from: 'api', to: 'cache' },
      { id: 'other', from: 'a', to: 'b', label: 'read', labelAt: [165, 208] },
    ],
    boundaries: [{ kind: 'region', label: 'Backend services', wraps: ['api'] }],
  }));
  const result = spawnSync(process.execPath, [cli, 'render', 'architecture', input, output, '--quality', 'showcase'], { cwd: directory, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const [, x, width] = html.match(/structural-frame-label-mask" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"/).map(Number);
  // The authored label occupies x=150..180; the title must move past it,
  // rather than asking the author to repair an overlap introduced by layout.
  assert.ok(x > 180 || x + width < 150, JSON.stringify({ x, width }));
  assert.match(html, /x="165" y="208"/);
});

test('showcase uses a clear off-centre corner when central ports force a detour', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-corner-port-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  const diagram = {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Shared client', output: 'diagram.html', quality_profile: 'showcase' },
    components: [
      { id: 'entry', type: 'backend', label: 'Entry', pos: [350, 200], size: [240, 80] },
      { id: 'service', type: 'backend', label: 'Service', pos: [760, 200], size: [290, 90] },
      { id: 'catalog', type: 'backend', label: 'Catalog', pos: [350, 390], size: [290, 90] },
      { id: 'client', type: 'backend', label: 'Client', pos: [760, 390], size: [290, 90] },
    ],
    connections: [
      { id: 'dispatch', from: 'entry', to: 'service', label: '解析空间后调用' },
      { id: 'reply', from: 'service', to: 'entry', label: '受理 / 状态 / 失败' },
      { id: 'register', from: 'service', to: 'catalog', label: '检查通过后选空间' },
      { id: 'metadata', from: 'catalog', to: 'client', label: '目录 / 元数据 API' },
      { id: 'write', from: 'service', to: 'client', label: '消息写入 / 状态查询' },
    ],
  };
  const original = JSON.stringify(diagram);
  fs.writeFileSync(input, original);
  const result = spawnSync(process.execPath, [cli, 'render', 'architecture', input, output, '--quality', 'showcase'], {
    cwd: directory, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const route = id => html.match(new RegExp(`data-edge-id="${id}"[^>]*data-composition-points="([^"]+)"`))[1].split(';').map(point => point.split(',').map(Number));
  const points = route('register');
  assert.equal(points.length, 3, `a legal corner needs one bend: ${JSON.stringify(points)}`);
  for (const id of ['dispatch', 'reply', 'metadata', 'write']) {
    assert.equal(route(id).length, 2, `${id} retains its straight route`);
  }
  assert.ok(points[0][1] <= 274, 'source port retains the 16px corner inset');
  assert.ok(points.at(-1)[0] <= 624, 'target port retains the 16px corner inset');
  for (const { label } of diagram.connections) assert.ok(html.includes(`>${label}</text>`), label);
  assert.equal(fs.readFileSync(input, 'utf8'), original);
});

test('a two-bend automatic branch can use a clear corner without disturbing the main route', () => {
  const boxes = new Map([
    box('build', 400, 305, 235, 76), box('data', 40, 305, 235, 76),
    box('output', 40, 445, 235, 76), box('main', 400, 520, 235, 76),
  ]);
  for (const pinned of [false, true]) {
    const connections = [
      { id: 'input', from: 'data', to: 'build' },
      { id: 'branch', from: 'build', to: 'output', ...(pinned ? { fromSide: 'left', toSide: 'right' } : {}) },
      { id: 'main', from: 'build', to: 'main' },
    ];
    const original = structuredClone(connections);
    const router = createRouter(boxes, connections, { distinctAutomaticPorts: true, preferReadableRoutes: true });
    const points = router.pathFor(connections[1]).points;
    assert.equal(points.length, pinned ? 4 : 3, `authored sides remain authoritative: ${JSON.stringify({ pinned, points })}`);
    for (const edge of [connections[0], connections[2]]) {
      assert.equal(router.pathFor(edge).points.length, 2, `${edge.id} stays straight`);
    }
    assert.deepEqual(connections, original);
  }
});

test('an automatic route can cross a clear channel below a neighboring card in two bends', () => {
  const boxes = new Map([
    box('producer', 320, 398, 150, 64), box('renderer', 570, 398, 150, 64),
    box('stage', 570, 550, 150, 64), box('page', 812, 550, 150, 64),
    box('reader', 320, 550, 150, 64),
  ]);
  const opens = { from: 'reader', to: 'page', label: 'opens' };
  const connections = [
    { from: 'producer', to: 'stage', label: 'stage file', variant: 'dashed' },
    { from: 'renderer', to: 'page', label: 'load page' },
    opens,
  ];
  const frames = [{ x: 290, y: 368, width: 702, height: 266, radius: 12 }];
  const router = createArchitectureRouter(boxes, connections, { frames, automaticPlacement: true });
  const route = router.pathFor(opens);
  assert.ok(route.points.length <= 4, JSON.stringify(route.points));
  const length = route.points.slice(1).reduce((total, [x, y], index) =>
    total + Math.abs(x - route.points[index][0]) + Math.abs(y - route.points[index][1]), 0);
  assert.ok(length <= 450, 'the two-turn path stays in the gap below the stage card');
  const label = connectionLabelBoxAt(opens, route.labelAt || labelPoint(opens, route.points));
  const gap = points => Math.min(...points.slice(1).map((end, index) =>
    segmentRectClearance({ start: points[index], end }, label)));
  const ownGap = gap(route.points);
  assert.ok(ownGap <= 14, 'the label reads beside the arrow');
  for (const other of connections.filter(conn => conn !== opens)) {
    assert.ok(gap(router.pathFor(other).points) > ownGap, 'the label follows the reader arrow');
  }
  assert.ok(router.crossingPairs().every(pair => !pair.includes(opens)));
});

test('a crossed terminal branch can move inside its frame and clear the long route', () => {
  const boxes = new Map([
    box('gateway', 160, 518, 172, 66), box('manager', 767, 220, 172, 62),
    box('service', 452, 380, 172, 66), box('store', 767, 382, 172, 62),
    box('processor', 610, 732, 172, 64), box('worker', 610, 892, 172, 64),
  ]);
  const [write, control, launch] = [
    { from: 'service', to: 'store', label: 'dispatches · messages' },
    { from: 'manager', to: 'processor', label: 'control', variant: 'emphasis' },
    { from: 'manager', to: 'worker', label: 'launch' },
  ];
  const connections = [write, control, launch];
  const frames = [
    { x: 130, y: 190, width: 839, height: 414, radius: 12, wraps: ['gateway', 'manager', 'service', 'store'] },
    { x: 580, y: 702, width: 232, height: 274, radius: 12, wraps: ['processor', 'worker'] },
  ];
  const makeRouter = components => createArchitectureRouter(components, connections, { frames, automaticPlacement: true });
  const baseline = makeRouter(boxes);
  assert.deepEqual(baseline.crossingPairs(), [[write, control]]);
  const placement = placeCrossedLeaf(boxes, connections, frames, baseline, makeRouter);
  assert.equal(placement?.box.id, 'store');
  assert.deepEqual(placement.router.crossingPairs(), []);
  assert.ok(placement.router.pathFor(control).points.length <= 4);
  assert.ok(placement.router.pathFor(write).points.length <= 4);
  assert.equal(boxes.get('store').x, 767, 'the caller still owns the original placement');

  const pinned = new Map(boxes).set('store', { ...boxes.get('store'), pos: [767, 382] });
  assert.equal(placeCrossedLeaf(pinned, connections, frames, makeRouter(pinned), makeRouter), null);
});
