import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { segmentIntersectsRect } from '../renderers/shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const renderer = path.join(skillRoot, 'renderers', 'erd', 'render-erd.mjs');
const checker = path.join(skillRoot, 'scripts', 'check-render-output.mjs');
const examplePath = path.join(skillRoot, 'examples', 'orders.erd.json');
const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

// The example carries guided reader views. A case that replaces the entity set
// must drop them, or validation fails on unknown focus ids instead of the rule
// under test.
function cloneWithoutViews(value) {
  const copy = clone(value);
  if (copy.meta) delete copy.meta.views;
  return copy;
}

function render(diagram, directory) {
  const input = path.join(directory, 'candidate.er.json');
  const output = path.join(directory, 'candidate.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  const result = spawnSync(process.execPath, [renderer, input, output], {
    cwd: directory,
    encoding: 'utf8',
  });
  return { ...result, output, input };
}

function artifactReceipt(htmlPath) {
  const result = spawnSync(process.execPath, [checker, htmlPath], { encoding: 'utf8' });
  return { status: result.status, receipt: JSON.parse(result.stdout) };
}

function attrs(tag) {
  return Object.fromEntries([...tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
}

function entityBoxes(html) {
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/gi)[0];
  const boxes = new Map();
  for (const match of svg.matchAll(/data-node-id="([a-z_]+)"[\s\S]{0,500}?<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="5" class="c-database"/g)) {
    boxes.set(match[1], { x: +match[2], y: +match[3], width: +match[4], height: +match[5] });
  }
  return boxes;
}

// Every relationship route, as the checker and the Clean Flow gate see it.
function relationshipRoutes(html) {
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/gi)[0];
  const routes = [];
  for (const match of svg.matchAll(/<path\b[^>]*marker-end[^>]*>/g)) {
    const attributes = attrs(match[0]);
    if (!attributes['data-edge-from'] || !attributes['data-composition-points']) continue;
    routes.push({
      from: attributes['data-edge-from'],
      to: attributes['data-edge-to'],
      points: attributes['data-composition-points'].split(';').map((pair) => pair.split(',').map(Number)),
      raw: match[0],
    });
  }
  return routes;
}

function crossingsOfUnrelatedEntities(html) {
  const boxes = entityBoxes(html);
  const crossings = [];
  for (const route of relationshipRoutes(html)) {
    for (const [id, box] of boxes) {
      if (id === route.from || id === route.to) continue;
      for (let index = 0; index < route.points.length - 1; index += 1) {
        if (segmentIntersectsRect({ start: route.points[index], end: route.points[index + 1] }, box, 0)) {
          crossings.push(`${route.from}->${route.to} crosses ${id}`);
        }
      }
    }
  }
  return crossings;
}

test('the example renders with every artifact check passing', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-'));
  const { status, output } = render(example, directory);
  assert.equal(status, 0, 'renderer should exit cleanly');
  assert.equal(crossingsOfUnrelatedEntities(fs.readFileSync(output, 'utf8')).length, 0);
  const { status: checkStatus, receipt } = artifactReceipt(output);
  assert.equal(checkStatus, 0, JSON.stringify(receipt.checks.filter((check) => !check.ok), null, 2));
  assert.equal(receipt.checks.length, 9);
  assert.equal(receipt.composition.status, 'pass');
  assert.equal(receipt.composition.summary.errors, 0);
  assert.equal(receipt.composition.summary.warnings, 0);
});

test('ERD fields are visible at the default read level', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-fields-'));
  const { status, output } = render(example, directory);
  assert.equal(status, 0, 'renderer should exit cleanly');
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /<div class="diagram-container" data-detail-level="read"/);
  assert.match(html, /<g data-detail="context" data-er-row="0">/);
  assert.doesNotMatch(html, /<g data-detail="fine" data-er-row=/);
});

test('an entity between two aligned anchors is routed around, never through', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Blocked corridor', locale: 'en', quality_profile: 'showcase' },
    layout: { mode: 'grid', origin: [40, 80], gapX: 56, gapY: 72, entityW: 200 },
    entities: [
      { id: 'alpha', label: 'alpha', row: 0, col: 0, width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'blocker', label: 'blocker', row: 0, col: 1, width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'omega', label: 'omega', row: 0, col: 2, width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    ],
    relationships: [
      { id: 'alpha_omega', from: 'omega', to: 'alpha', fromCardinality: 'many', toCardinality: 'one' },
      { id: 'blocker_alpha', from: 'blocker', to: 'alpha', fromCardinality: 'many', toCardinality: 'one' },
    ],
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-blocked-'));
  const { status, output } = render(diagram, directory);
  assert.equal(status, 0, 'a blocked corridor should still route');
  const html = fs.readFileSync(output, 'utf8');
  assert.deepEqual(crossingsOfUnrelatedEntities(html), []);

  const spanning = relationshipRoutes(html).find((route) => route.from === 'omega');
  assert.ok(spanning.points.length > 2, 'the blocked relationship needs a detour, not a straight line');
  const { status: checkStatus } = artifactReceipt(output);
  assert.equal(checkStatus, 0, 'the detour must still satisfy every artifact check');
});

test('an author-forced through-box route fails with the clean-flow diagnostic', () => {
  // Automatic routing detours around a blocking entity (the previous test), so
  // the deterministic way to reach the fail-closed gate is an authored `via`
  // straight through an unrelated entity. The boxes themselves must not
  // overlap, or the test would exercise the overlap validator instead.
  const diagram = cloneWithoutViews(example);
  diagram.entities = [
    { id: 'left', label: 'left', pos: [40, 80], width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    { id: 'wall', label: 'wall', pos: [280, 60], width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    { id: 'right', label: 'right', pos: [520, 80], width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
  ];
  diagram.relationships = [
    {
      id: 'left_right',
      from: 'right',
      to: 'left',
      fromCardinality: 'many',
      toCardinality: 'one',
      via: [[380, 104]],
    },
  ];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-wall-'));
  const { status, stdout, stderr } = render(diagram, directory);
  assert.notEqual(status, 0, 'a through-box route must fail');
  const output = `${stdout}${stderr}`;
  assert.match(output, /clean-flow\/edge-through-node/);
  assert.doesNotMatch(output, /overlaps entity/, 'the fixture must reach the routing gate, not the overlap validator');
  assert.equal(fs.existsSync(path.join(directory, 'candidate.html')), false, 'no artifact may be written');
});

test('relationships sharing one target side bundle into a trunk with short branches', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Bundled fan-in', locale: 'en' },
    layout: { mode: 'grid', origin: [40, 80], gapX: 56, gapY: 72, entityW: 200 },
    entities: [
      {
        id: 'hub', label: 'hub', row: 0, col: 0, width: 200,
        attributes: [
          { name: 'id', type: 'bigint', key: 'pk' },
          { name: 'a', type: 'bigint' },
          { name: 'b', type: 'bigint' },
          { name: 'c', type: 'bigint' },
        ],
      },
      { id: 'east_a', label: 'east_a', row: 0, col: 1, width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'east_b', label: 'east_b', row: 1, col: 1, width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    ],
    relationships: [
      { id: 'a_hub', from: 'east_a', to: 'hub', fromCardinality: 'many', toCardinality: 'one' },
      { id: 'b_hub', from: 'east_b', to: 'hub', fromCardinality: 'many', toCardinality: 'one' },
    ],
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-trunk-'));
  const { status, output } = render(diagram, directory);
  assert.equal(status, 0, 'a bundled fan-in should render');
  const html = fs.readFileSync(output, 'utf8');

  // The trunk sits one offset right of the hub's right edge and carries both
  // branches; the port-band gap between their branch points is bridged so the
  // bus reads as one line.
  const trunks = [...html.matchAll(/<path data-er-trunk=""[^>]*>/g)].map((match) => attrs(match[0]));
  assert.equal(trunks.length, 1);
  assert.equal(trunks[0]['data-composition-points'], '256,104;256,272');

  // Every branch keeps its cardinality markers and its full logical route, but
  // the rendered d skips the stretch the trunk path now carries.
  const routes = relationshipRoutes(html);
  assert.equal(routes.length, 2, 'both branches should render as relationship paths');
  for (const route of routes) {
    assert.match(route.raw, /marker-start="url\(#er-many-start\)"/);
    assert.match(route.raw, /marker-end="url\(#er-one-end\)"/);
    assert.match(route.raw, /d="M [^"]+ M /, 'the branch path leaves the trunk stretch to the trunk path');
    assert.ok(route.points.some(([x]) => x === 256), 'logical points still traverse the trunk');
  }
  const { status: checkStatus, receipt } = artifactReceipt(output);
  assert.equal(checkStatus, 0, JSON.stringify(receipt.checks.filter((check) => !check.ok), null, 2));

  // Bundling needs one dash language: mixing a dashed relationship into the
  // group dissolves it instead of drawing a trunk with a borrowed style.
  const mixed = clone(diagram);
  mixed.relationships[1].identifying = false;
  const mixedDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-trunk-mixed-'));
  const mixedResult = render(mixed, mixedDirectory);
  assert.equal(mixedResult.status, 0);
  assert.doesNotMatch(fs.readFileSync(mixedResult.output, 'utf8'), /data-er-trunk/);
});

test('differently styled fan-in groups never share one trunk coordinate', () => {
  // Two same-style pairs would naturally snap onto one bus line; a dashed
  // trunk must not render in the solid group's dash language, so the dashed
  // group takes the next offset a lane apart instead.
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Styled trunk lanes', locale: 'en' },
    layout: { mode: 'grid', origin: [40, 80], gapX: 56, gapY: 72, entityW: 200 },
    entities: [
      {
        id: 'hub_a', label: 'hub_a', row: 0, col: 0, width: 200,
        attributes: [
          { name: 'id', type: 'bigint', key: 'pk' },
          { name: 'a', type: 'bigint' },
          { name: 'b', type: 'bigint' },
          { name: 'c', type: 'bigint' },
        ],
      },
      {
        id: 'hub_b', label: 'hub_b', row: 1, col: 0, width: 200,
        attributes: [
          { name: 'id', type: 'bigint', key: 'pk' },
          { name: 'a', type: 'bigint' },
          { name: 'b', type: 'bigint' },
          { name: 'c', type: 'bigint' },
        ],
      },
      { id: 'east_a1', label: 'east_a1', row: 0, col: 1, width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'east_a2', label: 'east_a2', row: 1, col: 1, width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'east_b1', label: 'east_b1', row: 2, col: 1, width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'east_b2', label: 'east_b2', row: 3, col: 1, width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    ],
    relationships: [
      { id: 'a1_hub', from: 'east_a1', to: 'hub_a', fromCardinality: 'many', toCardinality: 'one' },
      { id: 'a2_hub', from: 'east_a2', to: 'hub_a', fromCardinality: 'many', toCardinality: 'one' },
      { id: 'b1_hub', from: 'east_b1', to: 'hub_b', fromCardinality: 'many', toCardinality: 'one', identifying: false },
      { id: 'b2_hub', from: 'east_b2', to: 'hub_b', fromCardinality: 'many', toCardinality: 'one', identifying: false },
    ],
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-trunk-styles-'));
  const { status, output } = render(diagram, directory);
  assert.equal(status, 0, 'two styled trunk lanes should render');
  const html = fs.readFileSync(output, 'utf8');

  const trunks = [...html.matchAll(/<path data-er-trunk=""[^>]*>/g)].map((match) => attrs(match[0]));
  assert.equal(trunks.length, 2, 'each style renders its own trunk');
  const solid = trunks.find((trunk) => trunk['data-composition-points'] === '256,104;256,272');
  const dashed = trunks.find((trunk) => trunk['data-composition-points'] === '268,289;268,560');
  assert.ok(solid, 'the solid group keeps the first offset');
  assert.ok(dashed, 'the dashed group moves a lane apart instead of sharing the line');
  assert.equal(solid.class, 'a-default');
  assert.equal(dashed.class, 'a-dashed');
  const { status: checkStatus, receipt } = artifactReceipt(output);
  assert.equal(checkStatus, 0, JSON.stringify(receipt.checks.filter((check) => !check.ok), null, 2));
});

test('schema and reference mistakes fail with an addressed diagnostic', () => {
  const unknownEntity = cloneWithoutViews(example);
  unknownEntity.relationships[0].to = 'ghost';
  unknownEntity.relationships[0].id = 'ghost_link';
  let result = render(unknownEntity, fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-bad-')));
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /unknown target entity "ghost"/);

  const unknownColumn = cloneWithoutViews(example);
  unknownColumn.entities[1].attributes[1].references = 'customer.nope';
  result = render(unknownColumn, fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-bad-')));
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /references unknown attribute "customer\.nope"/);

  const duplicateColumn = cloneWithoutViews(example);
  duplicateColumn.entities[0].attributes.push({ name: 'id', type: 'bigint' });
  result = render(duplicateColumn, fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-bad-')));
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /declares attribute "id" twice/);

  const tooNarrow = cloneWithoutViews(example);
  tooNarrow.entities[0].width = 90;
  result = render(tooNarrow, fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-bad-')));
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /of text but only|too short|is too short/);

  // A default width is a width: when `width` is omitted the resolved entity
  // width must still feed the overflow check, instead of turning the available
  // space into NaN and silently skipping the diagnostic.
  const defaultWidthOverflow = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Default width overflow', locale: 'en' },
    entities: [
      { id: 'a', label: 'a', pos: [40, 80], attributes: [{ name: 'extremely_long_attribute_name_here', type: 'varchar(255)' }] },
      { id: 'b', label: 'b', pos: [400, 80], attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    ],
    relationships: [],
  };
  result = render(defaultWidthOverflow, fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-bad-')));
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /attribute 0 "extremely_long_attribute_name_here" needs \d+px of text but only \d+px/);
});

test('cardinality defaults to many-to-one and is drawn at both ends', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Defaults', locale: 'en' },
    layout: { mode: 'grid', origin: [40, 80], gapX: 56, gapY: 72, entityW: 200 },
    entities: [
      { id: 'parent', label: 'parent', row: 0, col: 0, width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'child', label: 'child', row: 0, col: 1, width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    ],
    relationships: [{ id: 'child_parent', from: 'child', to: 'parent' }],
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-defaults-'));
  const { status, output } = render(diagram, directory);
  assert.equal(status, 0);
  const html = fs.readFileSync(output, 'utf8');
  const [route] = relationshipRoutes(html);
  assert.match(route.raw, /marker-start="url\(#er-many-start\)"/, 'the from end defaults to many');
  assert.match(route.raw, /marker-end="url\(#er-one-end\)"/, 'the to end defaults to one');
  assert.match(html, /id="er-many-start"/);
  assert.match(html, /id="er-one-end"/);
});

test('optionality adds the zero marker and identifying false draws the dashed variant', () => {
  const diagram = cloneWithoutViews(example);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-optional-'));
  const { status, output } = render(diagram, directory);
  assert.equal(status, 0);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /id="er-many-optional-start"/, 'payment is zero-or-many, so its marker carries the circle');
  const [payment] = relationshipRoutes(html).filter((route) => route.from === 'payment');
  assert.match(payment.raw, /class="a-dashed"/, 'a non-identifying relationship is drawn dashed');
});

test('the layout report exposes entity boxes and relationship points', () => {
  const result = spawnSync(process.execPath, [renderer, examplePath, '--layout-json'], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.diagram_type, 'erd');
  assert.equal(report.entities.length, example.entities.length);
  assert.equal(report.relationships.length, example.relationships.length);
  for (const entity of report.entities) {
    assert.ok(Number.isFinite(entity.x) && Number.isFinite(entity.y), `${entity.id} needs finite coordinates`);
    assert.ok(Number.isFinite(entity.width) && Number.isFinite(entity.height));
  }
  for (const relationship of report.relationships) {
    assert.ok(relationship.points.length >= 2);
  }
});
