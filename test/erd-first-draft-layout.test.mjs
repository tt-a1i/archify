import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { properSegmentIntersection, rectsOverlap } from '../archify/renderers/shared/geometry.mjs';
import { routeHugs } from './helpers/route-hugs.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
const renderer = path.join(skillRoot, 'renderers', 'erd', 'render-erd.mjs');
const checker = path.join(skillRoot, 'scripts', 'check-render-output.mjs');
const fixtures = path.join(__dirname, 'fixtures', 'erd-first-draft');
// The crow's foot reaches this far from the table edge and is 16 units tall.
const GLYPH_REACH = 24;
const GLYPH_HALF = 8;

function render(diagram) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-erd-first-draft-'));
  const input = path.join(directory, 'candidate.json');
  const output = path.join(directory, 'candidate.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  const result = spawnSync(process.execPath, [renderer, input, output], { cwd: directory, encoding: 'utf8' });
  return { ...result, output, html: result.status === 0 ? fs.readFileSync(output, 'utf8') : '' };
}

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
const svgOf = (html) => html.match(/<svg\b[\s\S]*?<\/svg>/i)[0];

function entityBoxes(html) {
  const boxes = new Map();
  for (const match of svgOf(html).matchAll(/data-node-id="([a-z_]+)"[\s\S]{0,500}?<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="5" class="c-database(?: er-table)?"/g)) {
    boxes.set(match[1], { x: +match[2], y: +match[3], width: +match[4], height: +match[5] });
  }
  return boxes;
}

function routes(html) {
  return [...svgOf(html).matchAll(/<path\b[^>]*marker-end[^>]*>/g)].map((match) => attrs(match[0]))
    .filter((route) => route['data-edge-from'] && route['data-composition-points'])
    .map((route) => ({
      id: route['data-edge-id'],
      from: route['data-edge-from'],
      to: route['data-edge-to'],
      points: route['data-composition-points'].split(';').map((pair) => pair.split(',').map(Number)),
    }));
}

function labelBoxes(html) {
  return [...svgOf(html).matchAll(/<g data-detail="context"[^>]*data-edge-id="([^"]+)"[^>]*>\s*<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)]
    .map((match) => ({ id: match[1], x: +match[2], y: +match[3], width: +match[4], height: +match[5] }));
}

// The box a cardinality glyph occupies at a route end lying on a table edge.
function glyphBox([x, y], box) {
  const near = (a, b) => Math.abs(a - b) < 0.5;
  if (near(x, box.x)) return { x: x - GLYPH_REACH, y: y - GLYPH_HALF, width: GLYPH_REACH, height: GLYPH_HALF * 2 };
  if (near(x, box.x + box.width)) return { x, y: y - GLYPH_HALF, width: GLYPH_REACH, height: GLYPH_HALF * 2 };
  if (near(y, box.y)) return { x: x - GLYPH_HALF, y: y - GLYPH_REACH, width: GLYPH_HALF * 2, height: GLYPH_REACH };
  return { x: x - GLYPH_HALF, y, width: GLYPH_HALF * 2, height: GLYPH_REACH };
}

function properCrossings(html) {
  const all = routes(html);
  const crossings = [];
  for (const [index, left] of all.entries()) {
    for (const right of all.slice(index + 1)) {
      if ([left.from, left.to].some((id) => id === right.from || id === right.to)) continue;
      const crosses = left.points.slice(1).some((end, i) => right.points.slice(1).some((otherEnd, j) => (
        properSegmentIntersection(left.points[i], end, right.points[j], otherEnd))));
      if (crosses) crossings.push([left.id, right.id]);
    }
  }
  return crossings;
}

function assertLabelsClear(html) {
  const boxes = entityBoxes(html);
  const glyphs = routes(html).flatMap((route) => [
    glyphBox(route.points[0], boxes.get(route.from)),
    glyphBox(route.points.at(-1), boxes.get(route.to)),
  ]);
  const labels = labelBoxes(html);
  assert.ok(labels.length > 0, 'the fixture draws relationship labels');
  for (const label of labels) {
    for (const [id, box] of boxes) assert.ok(!rectsOverlap(label, box), `label ${label.id} overlaps table ${id}`);
    for (const glyph of glyphs) assert.ok(!rectsOverlap(label, glyph), `label ${label.id} covers a cardinality glyph`);
  }
}

for (const name of ['blog', 'shop', 'warehouse']) {
  test(`unpinned ERD first draft "${name}" renders at showcase with clear labels and no crossings`, () => {
    const diagram = JSON.parse(fs.readFileSync(path.join(fixtures, `${name}.erd.json`), 'utf8'));
    assert.equal(diagram.meta.quality_profile, 'showcase');
    const result = render(diagram);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assertLabelsClear(result.html);
    assert.deepEqual(properCrossings(result.html), []);
    // A detour keeps a readable gap from the tables it passes (warehouse used
    // to run 3 units along the products table for its full width).
    assert.deepEqual(routeHugs(routes(result.html), entityBoxes(result.html)), []);
    const check = spawnSync(process.execPath, [checker, result.output], { encoding: 'utf8' });
    assert.equal(check.status, 0, check.stdout);
  });
}

const twoTables = (relationship, extra = {}) => ({
  schema_version: 1,
  diagram_type: 'erd',
  meta: { title: 'Label gap', locale: 'en', quality_profile: 'showcase' },
  layout: { mode: 'grid', gapX: 56 },
  entities: [
    { id: 'left', label: 'left', row: 0, col: 0, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    { id: 'right', label: 'right', row: 0, col: 1, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }, { name: 'left_id', type: 'bigint', key: 'fk', references: 'left.id' }] },
  ],
  relationships: [{ id: 'right_left', from: 'right', to: 'left', fromCardinality: 'many', toCardinality: 'one', ...relationship }],
  ...extra,
});

test('a grid-owned gap widens to hold its label clear of both cardinality glyphs', () => {
  const result = render(twoTables({ label: 'settled by invoice' }));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const boxes = entityBoxes(result.html);
  const [label] = labelBoxes(result.html);
  const gap = boxes.get('right').x - (boxes.get('left').x + boxes.get('left').width);
  assert.ok(gap >= label.width + GLYPH_REACH * 2, `gap ${gap} must hold the ${label.width}-unit label and both glyphs`);
  assertLabelsClear(result.html);
});

test('an unlabelled grid keeps the authored gap', () => {
  const result = render(twoTables({}));
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const boxes = entityBoxes(result.html);
  assert.equal(boxes.get('right').x - (boxes.get('left').x + boxes.get('left').width), 56);
});

test('absolute geometry keeps the authored gap so pinned coordinates stay meaningful', () => {
  const pinned = twoTables({ label: 'settled by invoice', labelDx: 0 });
  pinned.relationships.push({ id: 'left_self', from: 'left', to: 'right', fromCardinality: 'one', toCardinality: 'many', via: [[300, 20]] });
  pinned.relationships.pop();
  pinned.entities[1].pos = [328, 40];
  const result = render(pinned);
  // The 56-unit corridor cannot hold the pinned label, so the author still
  // gets the overlap diagnostic instead of a silently moved table.
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /Label "settled by invoice" overlaps entity/);
});
