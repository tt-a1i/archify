// Near-axis routing straightening (issue #74, U1).
//
// An auto-routed connection whose facing sides are explicit and whose endpoint
// perpendicular offset is below the automatic-port-alignment delta (16px) must
// render as a single straight segment whenever that segment is geometrically
// clear. Everything else — wider offsets, port-spread competition, explicit via
// geometry, and a blocked direct axis — keeps today's orthogonal dogleg.
//
//   node --test test/near-axis-routing.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-near-axis-'));

function render(mode, doc) {
  const input = path.join(tmp, `input-${Math.random().toString(16).slice(2)}.json`);
  const output = path.join(tmp, `output-${Math.random().toString(16).slice(2)}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    execFileSync('node', [
      path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
      input,
      output,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return { code: 0, stderr: '', outPath: output };
  } catch (err) {
    return { code: err.status ?? 1, stderr: String(err.stderr || ''), outPath: output };
  }
}

function validateCli(mode, doc, quality = 'showcase') {
  const input = path.join(tmp, `validate-${Math.random().toString(16).slice(2)}.json`);
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    const stdout = execFileSync('node', [
      path.join(skillRoot, 'bin', 'archify.mjs'),
      'validate',
      mode,
      input,
      '--quality',
      quality,
      '--json',
    ], { encoding: 'utf8' });
    return { code: 0, result: JSON.parse(stdout) };
  } catch (err) {
    return {
      code: err.status ?? 1,
      result: JSON.parse(String(err.stdout || '{}')),
    };
  }
}

// Orthogonal-route segments are axis-aligned; a segment "clears" a rectangle
// when it stays outside the renderer's own obstacle-clearance box (routeClearsComponents
// expands every unrelated component by a 2px gap via segmentIntersectsRect before
// testing intersection, and that check is inclusive of the expanded boundary).
function segmentClearsRect(p1, p2, rect) {
  const clearance = 2;
  const rectLeft = rect.pos[0] - clearance;
  const rectRight = rect.pos[0] + rect.size[0] + clearance;
  const rectTop = rect.pos[1] - clearance;
  const rectBottom = rect.pos[1] + rect.size[1] + clearance;
  if (p1[0] === p2[0]) {
    const x = p1[0];
    if (x < rectLeft || x > rectRight) return true;
    const [y0, y1] = [p1[1], p2[1]].sort((a, b) => a - b);
    return y1 < rectTop || y0 > rectBottom;
  }
  if (p1[1] === p2[1]) {
    const y = p1[1];
    if (y < rectTop || y > rectBottom) return true;
    const [x0, x1] = [p1[0], p2[0]].sort((a, b) => a - b);
    return x1 < rectLeft || x0 > rectRight;
  }
  throw new Error(`expected an axis-aligned segment, got ${JSON.stringify([p1, p2])}`);
}

function assertRouteClearsRect(points, rect, label) {
  for (let index = 1; index < points.length; index += 1) {
    assert.ok(
      segmentClearsRect(points[index - 1], points[index], rect),
      `route segment ${JSON.stringify(points[index - 1])} -> ${JSON.stringify(points[index])} must clear "${label}", got ${JSON.stringify(points)}`,
    );
  }
}

function connectionPoints(html, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`data-edge-id="${escapedId}"[^>]+data-composition-points="([^"]+)"`));
  assert.ok(match, `missing rendered connection ${id}`);
  return match[1].split(';').map((point) => point.split(',').map(Number));
}

// The issue #74 near-axis repro: facing explicit sides (top -> bottom) with a
// 10px perpendicular offset and a clear straight corridor.
function nearAxisRepro(overrides = {}) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Near-axis repro', ...(overrides.meta || {}) },
    components: [
      { id: 'api', type: 'backend', label: 'API', pos: [500, 340], size: [120, 60] },
      { id: 'db', type: 'database', label: 'DB', pos: [510, 100], size: [120, 60] },
    ],
    connections: [
      { id: 'api-db', from: 'api', to: 'db', fromSide: 'top', toSide: 'bottom' },
    ],
  };
}

test('architecture: issue repro — a clear near-axis explicit-side connection renders a single straight segment', () => {
  const doc = nearAxisRepro();
  const { code, stderr, outPath } = render('architecture', doc);
  assert.equal(code, 0, stderr);
  const points = connectionPoints(fs.readFileSync(outPath, 'utf8'), 'api-db');
  assert.equal(points.length, 2, `expected a two-point straight route, got ${JSON.stringify(points)}`);
  assert.equal(points[0][0], points[1][0], 'the straight route must share one vertical axis');
  const [api, db] = doc.components;
  assert.equal(points[0][1], api.pos[1], "route must start on api's top edge (fromSide: 'top')");
  assert.equal(points[1][1], db.pos[1] + db.size[1], "route must end on db's bottom edge (toSide: 'bottom')");
});

test('architecture: the straightened near-axis repro still passes public showcase validation', () => {
  const doc = nearAxisRepro();
  const { code, result } = validateCli('architecture', doc);
  assert.equal(code, 0, JSON.stringify(result, null, 2));
  assert.equal(result.ok, true);
});

test('architecture: an already-aligned facing pair keeps its single segment', () => {
  const doc = nearAxisRepro();
  doc.components[1].pos = [500, 100];
  const { code, stderr, outPath } = render('architecture', doc);
  assert.equal(code, 0, stderr);
  const points = connectionPoints(fs.readFileSync(outPath, 'utf8'), 'api-db');
  assert.equal(points.length, 2, `expected a two-point straight route, got ${JSON.stringify(points)}`);
});

test('architecture: a 40px perpendicular offset keeps today\'s orthogonal dogleg', () => {
  const doc = nearAxisRepro();
  doc.components[1].pos = [460, 100];
  const { code, stderr, outPath } = render('architecture', doc);
  assert.equal(code, 0, stderr);
  const points = connectionPoints(fs.readFileSync(outPath, 'utf8'), 'api-db');
  assert.ok(points.length > 2, `offset >= 16px must keep an orthogonal route, got ${JSON.stringify(points)}`);
  for (let index = 1; index < points.length; index += 1) {
    const orthogonal = points[index - 1][0] === points[index][0]
      || points[index - 1][1] === points[index][1];
    assert.ok(orthogonal, `every segment must stay orthogonal: ${JSON.stringify(points)}`);
  }
});

test('architecture: port-spread competition on both endpoints keeps the outside bridge', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Two-sided port competition' },
    components: [
      { id: 'source', type: 'backend', label: 'Source', pos: [300, 320], size: [160, 60] },
      { id: 'source-peer', type: 'backend', label: 'Source peer', pos: [80, 320], size: [160, 60] },
      { id: 'target', type: 'database', label: 'Target', pos: [300, 100], size: [160, 60] },
      { id: 'target-peer', type: 'database', label: 'Target peer', pos: [560, 100], size: [160, 60] },
    ],
    connections: [
      { id: 'source-target', from: 'source', to: 'target', fromSide: 'top', toSide: 'bottom' },
      { id: 'source-peer-target', from: 'source-peer', to: 'target', fromSide: 'top', toSide: 'bottom' },
      { id: 'source-target-peer', from: 'source', to: 'target-peer', fromSide: 'top', toSide: 'bottom' },
    ],
  };
  const { code, stderr, outPath } = render('architecture', doc);
  assert.equal(code, 0, stderr);
  const points = connectionPoints(fs.readFileSync(outPath, 'utf8'), 'source-target');
  assert.ok(points.length > 2, `both-endpoints-spread competition must keep the bridge, got ${JSON.stringify(points)}`);
  assert.notEqual(points[0][0], points.at(-1)[0]);
});

test('architecture: explicit via geometry stays authoritative on a near-axis pair', () => {
  const doc = nearAxisRepro();
  doc.connections[0].via = [[560, 250], [570, 250]];
  const { code, stderr, outPath } = render('architecture', doc);
  assert.equal(code, 0, stderr);
  const points = connectionPoints(fs.readFileSync(outPath, 'utf8'), 'api-db');
  assert.deepEqual(points, [[560, 340], [560, 250], [570, 250], [570, 160]]);
});

test('architecture: explicit route geometry stays authoritative on a near-axis pair', () => {
  const doc = nearAxisRepro();
  doc.connections[0].route = 'orthogonal-v';
  const { code, stderr, outPath } = render('architecture', doc);
  assert.equal(code, 0, stderr);
  const points = connectionPoints(fs.readFileSync(outPath, 'utf8'), 'api-db');
  assert.ok(points.length > 2, `an explicit orthogonal route must keep its turns, got ${JSON.stringify(points)}`);
  assert.deepEqual(points[0], [560, 340]);
  assert.deepEqual(points.at(-1), [570, 160]);
});

test('architecture: a labeled near-axis connection in a tight gap passes showcase', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Tight labeled gap', quality_profile: 'showcase' },
    components: [
      { id: 'api', type: 'backend', label: 'API', pos: [500, 300], size: [120, 60] },
      { id: 'db', type: 'database', label: 'DB', pos: [500, 100], size: [120, 60] },
    ],
    connections: [
      { id: 'api-db', from: 'api', to: 'db', fromSide: 'top', toSide: 'bottom', label: 'reads' },
    ],
  };
  const { code, stderr, outPath } = render('architecture', doc);
  assert.equal(code, 0, stderr);
  const points = connectionPoints(fs.readFileSync(outPath, 'utf8'), 'api-db');
  assert.equal(points.length, 2, `expected a straight labeled route, got ${JSON.stringify(points)}`);
  const { code: validated, result } = validateCli('architecture', doc);
  assert.equal(validated, 0, JSON.stringify(result, null, 2));
  assert.equal(result.ok, true);
});

test('architecture: a blocked straight path keeps the deterministic dogleg', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Blocked straight path' },
    components: [
      { id: 'api', type: 'backend', label: 'API', pos: [500, 340], size: [120, 60] },
      { id: 'db', type: 'database', label: 'DB', pos: [510, 100], size: [120, 60] },
      { id: 'block', type: 'external', label: 'Block', pos: [540, 210], size: [36, 60] },
    ],
    connections: [
      { id: 'api-db', from: 'api', to: 'db', fromSide: 'top', toSide: 'bottom' },
    ],
  };
  const first = render('architecture', doc);
  assert.equal(first.code, 0, first.stderr);
  const second = render('architecture', doc);
  assert.equal(second.code, 0, second.stderr);
  const firstPoints = connectionPoints(fs.readFileSync(first.outPath, 'utf8'), 'api-db');
  const secondPoints = connectionPoints(fs.readFileSync(second.outPath, 'utf8'), 'api-db');
  assert.deepEqual(firstPoints, secondPoints, 'blocked dogleg must stay deterministic');
  assert.ok(firstPoints.length > 2, `a blocked direct axis must keep a dogleg, got ${JSON.stringify(firstPoints)}`);
  const block = doc.components.find((c) => c.id === 'block');
  assertRouteClearsRect(firstPoints, block, 'block');
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
