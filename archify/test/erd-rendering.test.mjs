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
// One legend band plus the title gap a band has to clear below the content.
const MARKER_FREE_BAND = 30;
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
  // The bus sits one offset outside the hub's right edge and spans both branch
  // points; the exact coordinate follows the port spread, so the contract is
  // the offset and the span, not a literal line.
  const hubRight = entityBoxes(html).get('hub').x + entityBoxes(html).get('hub').width;
  const [trunkStart, trunkEnd] = trunks[0]['data-composition-points'].split(';').map((pair) => pair.split(',').map(Number));
  // The contract is a bus just outside the shared side, not a literal offset:
  // TRUNK_OFFSETS may be retuned without changing what bundling means.
  assert.ok(trunkStart[0] > hubRight && trunkStart[0] <= hubRight + 32, 'the trunk sits just outside the shared side');
  assert.equal(trunkEnd[0], trunkStart[0], 'the trunk is one straight bus');
  const branchPorts = relationshipRoutes(html).map((route) => route.points.at(-1)[1]).sort((a, b) => a - b);
  assert.ok(trunkStart[1] <= branchPorts[0] && trunkEnd[1] >= branchPorts[branchPorts.length - 1], 'the bus spans both branch points');

  // Every branch keeps its cardinality markers and its full logical route, but
  // the rendered d skips the stretch the trunk path now carries.
  const routes = relationshipRoutes(html);
  assert.equal(routes.length, 2, 'both branches should render as relationship paths');
  for (const route of routes) {
    assert.match(route.raw, /marker-start="url\(#er-many-start\)"/);
    assert.match(route.raw, /marker-end="url\(#er-one-end\)"/);
    assert.match(route.raw, /d="M [^"]+ M /, 'the branch path leaves the trunk stretch to the trunk path');
    assert.ok(route.points.some(([x]) => x === trunkStart[0]), 'logical points still traverse the trunk');
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
  const solid = trunks.find((trunk) => trunk.class === 'a-default');
  const dashed = trunks.find((trunk) => trunk.class === 'a-dashed');
  assert.ok(solid, 'the solid group renders a solid trunk');
  assert.ok(dashed, 'the dashed group moves a lane apart instead of sharing the line');
  // The styles must not share a bus line: the dashed trunk takes the next
  // offset, one lane away from the solid one. The absolute coordinate follows
  // the port spread, so only the separation and the ordering are contracts.
  const coordinateOf = (trunk) => Number(trunk['data-composition-points'].split(';')[0].split(',')[0]);
  const solidX = coordinateOf(solid);
  const dashedX = coordinateOf(dashed);
  assert.ok(dashedX > solidX, 'the dashed group takes the next offset outward');
  assert.ok(dashedX - solidX >= 12, 'the two styles stay a lane apart instead of sharing a coordinate');
  const hubRight = entityBoxes(html).get('hub_a').x + entityBoxes(html).get('hub_a').width;
  assert.ok(solidX > hubRight && solidX <= hubRight + 32, 'the first group keeps the nearest offset');
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

test('declared cardinality is drawn at both ends', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Cardinality', locale: 'en' },
    layout: { mode: 'grid', origin: [40, 80], gapX: 56, gapY: 72, entityW: 200 },
    entities: [
      { id: 'parent', label: 'parent', row: 0, col: 0, width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'child', label: 'child', row: 0, col: 1, width: 200, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    ],
    relationships: [{ id: 'child_parent', from: 'child', to: 'parent', fromCardinality: 'many', toCardinality: 'one' }],
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-cardinality-'));
  const { status, output } = render(diagram, directory);
  assert.equal(status, 0);
  const html = fs.readFileSync(output, 'utf8');
  const [route] = relationshipRoutes(html);
  assert.match(route.raw, /marker-start="url\(#er-many-start\)"/, 'the from end carries its declared many');
  assert.match(route.raw, /marker-end="url\(#er-one-end\)"/, 'the to end carries its declared one');
  assert.match(html, /id="er-many-start"/);
  assert.match(html, /id="er-one-end"/);
});

// A maximum the author never stated is a fact the diagram would be inventing,
// so dropping it fails closed instead of reading as the ordinary foreign-key
// many-to-one shape.
test('a relationship that drops its declared cardinality is rejected', () => {
  const diagram = cloneWithoutViews(example);
  for (const relationship of diagram.relationships) {
    delete relationship.fromCardinality;
    delete relationship.toCardinality;
  }
  const result = render(diagram, fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-unstated-cardinality-')));
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /must have required property 'fromCardinality'/);
});

// An `fk` marker claims a real foreign key. Without a named target the claim
// cannot be checked at all, so it fails closed instead of passing as a column.
test('an fk attribute that drops its references target is rejected', () => {
  const diagram = cloneWithoutViews(example);
  for (const entity of diagram.entities) {
    for (const attribute of entity.attributes) {
      if (attribute.key === 'fk') delete attribute.references;
    }
  }
  const result = render(diagram, fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-unresolved-fk-')));
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /must have required property 'references'/);
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

// An omitted `width` is a documented default (`layout.entityW`), not an error:
// resolving it in measurement but reading the raw field in placement turned the
// default into a NaN column and reported a placement failure for a valid box.
test('an entity that omits its width is placed at the grid default', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Default width', locale: 'en' },
    layout: { mode: 'grid', entityW: 240 },
    entities: [
      { id: 'parent', label: 'parent', row: 0, col: 0, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'child', label: 'child', row: 0, col: 1, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    ],
    relationships: [{ id: 'child_parent', from: 'child', to: 'parent', fromCardinality: 'many', toCardinality: 'one' }],
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-default-width-'));
  const { status, stdout, stderr, output } = render(diagram, directory);
  assert.equal(status, 0, stdout + stderr);
  const boxes = entityBoxes(fs.readFileSync(output, 'utf8'));
  assert.equal(boxes.size, 2, 'both boxes are placed');
  for (const [id, box] of boxes) {
    assert.equal(box.width, 240, `${id} uses the grid default width`);
  }
});

// A vertical run of same-tag tables is a domain, and the band is what makes the
// grouping visible; a tag whose members are scattered is a grouping the author
// did not make, so no band claims it.
test('a contiguous domain draws a band and a scattered tag does not', () => {
  const band = (entities, relationships) => {
    const diagram = {
      schema_version: 1,
      diagram_type: 'erd',
      meta: { title: 'Domains', locale: 'en' },
      layout: { mode: 'grid' },
      entities,
      relationships,
    };
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-band-'));
    const { status, stdout, stderr, output } = render(diagram, directory);
    assert.equal(status, 0, stdout + stderr);
    return fs.readFileSync(output, 'utf8');
  };
  const nodes = (tagFor) => [
    { id: 'alpha', label: 'alpha', tag: tagFor('alpha'), row: 0, col: 0, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    { id: 'beta', label: 'beta', tag: tagFor('beta'), row: 0, col: 1, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    { id: 'gamma', label: 'gamma', tag: 'catalog', row: 1, col: 0, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    { id: 'delta', label: 'delta', tag: 'catalog', row: 1, col: 1, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
  ];
  const links = [{ id: 'beta_alpha', from: 'beta', to: 'alpha', fromCardinality: 'many', toCardinality: 'one' }];

  const contiguous = band(nodes(() => 'checkout'), links);
  assert.match(contiguous, /data-domain-band="checkout"/, 'a row of same-tag tables earns a band');
  assert.match(contiguous, /data-domain-band="catalog"/, 'a second contiguous domain earns its own band');

  const scattered = band(nodes((id) => (id === 'alpha' ? 'checkout' : id === 'delta' ? 'checkout' : 'other')), links);
  assert.doesNotMatch(scattered, /data-domain-band="checkout"/, 'a tag split across the canvas draws no band');
});

// Port spacing and glyph ink are what make both ends readable: the shared 14px
// spread put two 14-unit crow's feet close enough to read as one shape, and the
// shared arrow colour sits near 2:1 against a table fill in the light theme.
test('same-side ports clear the marker glyph and the markers carry the stronger ink', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Crowded side', locale: 'en' },
    layout: { mode: 'grid' },
    entities: [
      { id: 'hub', label: 'hub', row: 0, col: 0, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'left_a', label: 'left_a', row: 0, col: 1, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'left_b', label: 'left_b', row: 1, col: 1, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    ],
    relationships: [
      { id: 'a_hub', from: 'left_a', to: 'hub', fromCardinality: 'many', toCardinality: 'one' },
      { id: 'b_hub', from: 'left_b', to: 'hub', fromCardinality: 'many', toCardinality: 'one' },
    ],
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-ports-'));
  const { status, stdout, stderr, output } = render(diagram, directory);
  assert.equal(status, 0, stdout + stderr);
  const html = fs.readFileSync(output, 'utf8');
  const hub = entityBoxes(html).get('hub');
  const arrivals = relationshipRoutes(html)
    .map((route) => route.points.at(-1))
    .filter((point) => point[0] === hub.x + hub.width);
  assert.equal(arrivals.length, 2, 'both relationships arrive on the hub side');
  const [first, second] = arrivals.map((point) => point[1]).sort((a, b) => a - b);
  assert.ok(second - first >= 20, `ports clear the 14-unit glyph, got ${second - first}px apart`);
  assert.match(html, /<marker id="er-many-start"[^>]*style="stroke: var\(--text-muted\)"/, 'the crow\u2019s foot is drawn in the stronger ink');
});

// The mask the renderer draws, the rect the layout checks measure, and the
// obstacle the legend measures are one rectangle. When the checks measured a
// narrower box than the ink, a label could sit on a table edge with nothing
// reported: this corridor is 60 units wide and the label's drawn mask is 65.8,
// an overlap the old 8-unit measurement (58.0) did not see.
test('relationship labels are drawn and checked with one measured box', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Label corridor', locale: 'en' },
    layout: { mode: 'grid', gapX: 60, gapY: 44 },
    entities: [
      { id: 'left', label: 'left', row: 0, col: 0, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'right', label: 'right', row: 0, col: 1, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }, { name: 'left_id', type: 'bigint', key: 'fk', references: 'left.id' }] },
    ],
    relationships: [
      { id: 'right_left', from: 'right', to: 'left', fromCardinality: 'many', toCardinality: 'one', label: 'settles by' },
    ],
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-label-box-'));
  const { status, stdout, stderr } = render(diagram, directory);
  assert.notEqual(status, 0, 'a label that sits on a table edge is not a pass');
  const message = stdout + stderr;
  assert.match(message, /Label "settles by" overlaps entity "(left|right)"/);

  // The same corridor with room for the drawn mask is accepted, and the mask the
  // renderer writes is the measured box.
  const roomy = clone(diagram);
  roomy.layout.gapX = 88;
  const accepted = render(roomy, directory);
  assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
  const html = fs.readFileSync(accepted.output, 'utf8');
  // Anchor on the label element itself: a span that starts at a table row would
  // let the first key glyph's font-size answer for the label.
  const label = html.match(/<g data-detail="context"[^>]*data-edge-id="right_left"[^>]*>[\s\S]*?<\/g>/);
  assert.ok(label, 'the label is drawn');
  const mask = label[0].match(/<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)" rx="3" class="c-mask"/);
  const text = label[0].match(/<text(?=[^>]*text-anchor="middle")(?=[^>]*font-size="([\d.]+)")[^>]*>settles by<\/text>/);
  assert.ok(text, 'the label text carries the label wording');
  assert.equal(Number(text[1]), 9, 'relationship labels are set at the declared size');
  // 10 text units at 9 units of type with the label's own advance, plus padding.
  assert.equal(Number(mask[3]), Math.max(30, 10 * 9 * 0.62 + 10), 'the drawn mask is the measured box');
});

// The marker spread is a cap, not a floor: a short table with a busy side
// spaces its ports below the height of the glyph they carry, and the drawn feet
// and bars overlap. The routes stay legal, so nothing else reports it; the
// renderer names the table, the side, and the arithmetic.
test('a side that cannot space its cardinality glyphs is a layout diagnostic', () => {
  const hub = {
    id: 'hub', label: 'hub', row: 2, col: 1,
    attributes: [{ name: 'id', type: 'bigint', key: 'pk' }, { name: 'name', type: 'text' }],
  };
  const spokes = [];
  const relationships = [];
  for (let index = 0; index < 5; index += 1) {
    const id = `spoke_${index}`;
    spokes.push({
      id, label: id, row: index, col: 2,
      attributes: [{ name: 'id', type: 'bigint', key: 'pk' }, { name: 'hub_id', type: 'bigint', key: 'fk', references: 'hub.id' }],
    });
    relationships.push({ id: `r${index}`, from: id, to: 'hub', fromCardinality: 'many', toCardinality: 'one' });
  }
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Crowded side', locale: 'en' },
    layout: { mode: 'grid' },
    entities: [hub, ...spokes],
    relationships,
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-side-capacity-'));
  const { status, stdout, stderr } = render(diagram, directory);
  assert.notEqual(status, 0, 'overlapping glyphs are not a pass');
  const message = stdout + stderr;
  assert.match(message, /layout\/marker-capacity/);
  assert.match(message, /"hub" shares its right side with 5 relationship ends/);
  assert.match(message, /under the 14px a cardinality glyph is tall/);
  assert.match(message, /add fields to "hub"/);
});

// The reader's review asked for the default legend to stay in the generated
// content: an automatic canvas is sized to hold it, so a reserved strip that is
// a few units short must grow the drawing area instead of dropping the key. A
// narrow schema wraps the entries into several rows, which is the case where
// that strip is under the most pressure.
test('an automatic canvas is sized so the default legend is always in the content', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Narrow schema', locale: 'en' },
    layout: { mode: 'grid', gapX: 56, gapY: 44 },
    entities: [
      { id: 'a', label: 'a', row: 0, col: 0, attributes: [
        { name: 'id', type: 'bigint', key: 'pk' },
        { name: 'b_id', type: 'bigint', key: 'fk', references: 'b.id' },
        { name: 'sku', type: 'text', key: 'uk' },
      ] },
      { id: 'b', label: 'b', row: 1, col: 0, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    ],
    relationships: [{ id: 'a_b', from: 'a', to: 'b', fromCardinality: 'many', toCardinality: 'one', fromOptional: true }],
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-legend-'));
  const { status, stdout, stderr, output } = render(diagram, directory);
  assert.equal(status, 0, stdout + stderr);
  const html = fs.readFileSync(output, 'utf8');

  const root = html.match(/<svg\b[^>]*>/)[0];
  assert.match(root, /data-reader-fit="intrinsic-height"/, 'an automatic canvas declares its fit contract');
  const viewBoxHeight = Number(root.match(/viewBox="0 0 [\d.]+ ([\d.]+)"/)[1]);
  assert.ok(Number.isFinite(viewBoxHeight) && viewBoxHeight > 0, 'the canvas has a measured height');

  const kinds = [...html.matchAll(/data-legend-semantic-kind="([a-z]+)"/g)].map((match) => match[1]);
  assert.deepEqual(kinds.sort(), ['fk', 'many', 'one', 'optional', 'pk', 'uk'], 'every declared kind keeps its entry');
  const boxes = [...html.matchAll(/<rect x="[\d.]+" y="([\d.]+)" width="[\d.]+" height="([\d.]+)" rx="5" class="c-database"/g)];
  assert.ok(boxes.length >= 2, 'both tables are drawn');
  const contentBottom = Math.max(...boxes.map((match) => Number(match[1]) + Number(match[2])));
  const baselines = [...html.matchAll(/data-legend-baseline="([\d.]+)"/g)].map((match) => Number(match[1]));
  assert.equal(baselines.length, 6, 'every declared kind keeps its entry in the band');
  assert.ok(Math.min(...baselines) > contentBottom, 'the legend band sits below the tables it describes');
  assert.ok(viewBoxHeight >= contentBottom + MARKER_FREE_BAND, 'the drawing area reserves the band below the content');
});

// An authored meta.viewBox is a fixed drawing area. There the same measurement
// is a capacity diagnostic that names what does not fit, rather than a silently
// dropped key.
test('an authored viewBox that cannot hold the legend fails with a capacity diagnostic', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Fixed area', locale: 'en', viewBox: [560, 240] },
    layout: { mode: 'grid' },
    entities: [
      // Tall enough that the fixed area cannot also hold the band below it.
      { id: 'a', label: 'a', row: 0, col: 0, attributes: [
        { name: 'id', type: 'bigint', key: 'pk' },
        { name: 'b_id', type: 'bigint', key: 'fk', references: 'b.id' },
        { name: 'sku', type: 'text', key: 'uk' },
        { name: 'status', type: 'varchar(16)' },
        { name: 'quantity', type: 'int' },
        { name: 'unit_amount', type: 'numeric(12,2)' },
        { name: 'created_at', type: 'timestamptz' },
        { name: 'updated_at', type: 'timestamptz' },
      ] },
      { id: 'b', label: 'b', row: 0, col: 1, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    ],
    relationships: [{ id: 'a_b', from: 'a', to: 'b', fromCardinality: 'many', toCardinality: 'one' }],
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-legend-fixed-'));
  const { status, stdout, stderr } = render(diagram, directory);
  assert.notEqual(status, 0, 'a fixed area that cannot hold the legend is not a pass');
  const message = stdout + stderr;
  assert.match(message, /legend\/(vertical-overflow|label-too-wide|content-overlap)/);
  assert.match(message, /Supported fixes|supportedFixes|shorten legend labels|wider viewBox/);
});

// An automatic ERD canvas is taller than one screen for a real schema, and the
// reader's own review said that is fine. Declaring the height as intrinsic is
// what lets the Viewer scroll instead of shrinking the tables.
test('an automatic canvas declares its height as intrinsic for the reader', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-reader-fit-'));
  const automatic = render(cloneWithoutViews(example), directory);
  assert.equal(automatic.status, 0, automatic.stdout + automatic.stderr);
  const automaticHtml = fs.readFileSync(automatic.output, 'utf8');
  assert.match(automaticHtml, /<svg[^>]*data-reader-fit="intrinsic-height"/);
  assert.match(automaticHtml, /data-reader-min-text="7\.5"/);
  for (const row of automaticHtml.matchAll(/<g data-detail="context" data-er-row="\d+">([\s\S]*?)<\/g>/g)) {
    const texts = [...row[1].matchAll(/<text ([^>]*)>/g)].map((match) => match[1]);
    assert.ok(texts.length >= 2, 'a field row draws its name and its type');
    for (const attributes of texts) {
      assert.match(attributes, /data-detail="context"/, 'every row text declares the level the reader measures');
    }
  }

  const authored = cloneWithoutViews(example);
  authored.meta.viewBox = [960, 620];
  const fixed = render(authored, directory);
  assert.equal(fixed.status, 0, fixed.stdout + fixed.stderr);
  const fixedRoot = fs.readFileSync(fixed.output, 'utf8').match(/<svg\b[^>]*>/)[0];
  assert.doesNotMatch(fixedRoot, /data-reader-fit/, 'an authored viewBox keeps the authored fit contract');
});

// Crow's foot notation is only notation if the foot reads as a foot. Drawn with
// its toes away from the table it looks like an arrowhead pointing at the table
// it describes; the reader's review asked for the foot to open toward the
// entity. Both ends are mirrored copies of one glyph, so both are asserted, and
// the optional circle must stay past the apex rather than inside the toes.
test('the crow\u2019s foot opens toward the entity at both ends', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Foot direction', locale: 'en' },
    layout: { mode: 'grid' },
    entities: [
      { id: 'parent', label: 'parent', row: 0, col: 0, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'child', label: 'child', row: 0, col: 1, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }, { name: 'parent_id', type: 'bigint', key: 'fk', references: 'parent.id' }] },
      { id: 'ticket', label: 'ticket', row: 1, col: 0, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'note', label: 'note', row: 1, col: 1, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }, { name: 'ticket_id', type: 'bigint', key: 'fk', references: 'ticket.id' }] },
    ],
    relationships: [
      // One of each direction, so the mirrored and non-mirrored copies of the
      // glyph are both drawn and both asserted.
      { id: 'child_parent', from: 'child', to: 'parent', fromCardinality: 'many', toCardinality: 'one' },
      { id: 'ticket_note', from: 'ticket', to: 'note', fromCardinality: 'one', toCardinality: 'many', toOptional: true },
    ],
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-foot-'));
  const { status, stdout, stderr, output } = render(diagram, directory);
  assert.equal(status, 0, stdout + stderr);
  const html = fs.readFileSync(output, 'utf8');

  for (const [id, endpoint] of [['er-many-start', 'source'], ['er-many-optional-end', 'target']]) {
    const marker = html.match(new RegExp(`<marker id="${id}"[\\s\\S]*?</marker>`))[0];
    const refX = Number(attrs(marker)['refX']);
    const toes = [...marker.matchAll(/M ([\d.]+) 8 L ([\d.]+) (\d+)/g)].map((match) => ({ apex: Number(match[1]), toe: Number(match[2]), y: Number(match[3]) }));
    assert.equal(toes.length, 3, `${id} draws three toes`);
    for (const toe of toes) {
      assert.equal(toe.toe, refX, `${id}: every toe meets the entity at the marker reference point (${endpoint} end)`);
      assert.ok(toe.apex !== refX, `${id}: the apex sits back from the entity`);
      assert.equal(Math.abs(toe.apex - toe.toe), 14, `${id}: the foot is one glyph deep`);
    }
    assert.deepEqual(toes.map((toe) => toe.y).sort((a, b) => a - b), [1, 8, 15], `${id}: the toes spread across the glyph`);
  }

  const optional = html.match(/<marker id="er-many-optional-end"[\s\S]*?<\/marker>/)[0];
  const optionalRefX = Number(attrs(optional)['refX']);
  const ring = optional.match(/<circle cx="([\d.]+)"/);
  assert.equal(optionalRefX, 22, 'the non-mirrored glyph references the entity end');
  assert.ok(
    Math.abs(Number(ring[1]) - optionalRefX) > 14,
    'the optional circle sits past the apex, not inside the toes',
  );
});

// The bus runs close to the shared side, inside the band a cardinality glyph
// occupies, so it has to be painted under the branches: over them, it drew
// straight through the optionality ring's mask and left a circled slash where
// the reader should see "zero or one".
test('a bundled trunk is painted under the markers it passes', () => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'erd',
    meta: { title: 'Ring over bus', locale: 'en' },
    layout: { mode: 'grid' },
    entities: [
      { id: 'hub', label: 'hub', row: 0, col: 0, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'child_a', label: 'child_a', row: 0, col: 1, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
      { id: 'child_b', label: 'child_b', row: 1, col: 1, attributes: [{ name: 'id', type: 'bigint', key: 'pk' }] },
    ],
    relationships: [
      { id: 'a_hub', from: 'child_a', to: 'hub', fromCardinality: 'many', toCardinality: 'many', toOptional: true },
      { id: 'b_hub', from: 'child_b', to: 'hub', fromCardinality: 'many', toCardinality: 'many', toOptional: true },
    ],
  };
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-er-trunk-order-'));
  const { status, stdout, stderr, output } = render(diagram, directory);
  assert.equal(status, 0, stdout + stderr);
  const html = fs.readFileSync(output, 'utf8');
  const svg = html.slice(html.indexOf('<svg'));
  assert.ok(/<path data-er-trunk=""/.test(svg), 'the fan-in bundles onto a trunk');
  assert.ok(
    svg.indexOf('data-er-trunk') < svg.indexOf('<!-- Relationship paths'),
    'the bus is painted under the branches that carry the markers',
  );
  assert.match(
    html,
    /<circle[^>]*class="c-mask"\/>\s*<circle[^>]*\/>/,
    'the optionality ring masks the relationship line it sits on',
  );
});
