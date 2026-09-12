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

test('an unroutable relationship fails with a clean-flow diagnostic instead of drawing a crossing', () => {
  // Two entities share one cell, so nothing can clear the box that sits on the
  // only corridor; the renderer must refuse rather than emit a through-box line.
  const diagram = cloneWithoutViews(example);
  diagram.entities = [
    { id: 'left', label: 'left', row: 0, col: 0, width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    { id: 'right', label: 'right', row: 0, col: 1, width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    { id: 'wall', label: 'wall', pos: [252, 80], width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
  ];
  diagram.relationships = [
    { id: 'left_right', from: 'right', to: 'left', fromCardinality: 'many', toCardinality: 'one' },
  ];
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-wall-'));
  const { status, stdout, stderr } = render(diagram, directory);
  assert.notEqual(status, 0, 'an impossible route must fail');
  assert.match(`${stdout}${stderr}`, /clean-flow\/edge-through-node|unrelated to this relationship|overlaps entity/);
  assert.equal(fs.existsSync(path.join(directory, 'candidate.html')), false, 'no artifact may be written');
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
