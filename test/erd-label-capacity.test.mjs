import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rectsOverlap, segmentRectClearanceWithin } from '../archify/renderers/shared/geometry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'archify/bin/archify.mjs');
const renderer = path.join(root, 'archify/renderers/erd/render-erd.mjs');
const rows = count => Array.from({ length: count }, (_, index) => ({ name: `field_${index}`, type: 'TEXT' }));

function fixture(quality = 'standard') {
  return {
    schema_version: 1, diagram_type: 'erd', meta: { title: 'Branch labels', locale: 'en', quality_profile: quality },
    layout: { mode: 'grid', gapX: 72, gapY: 40, entityW: 260 },
    entities: [
      { id: 'parent', label: 'Parent', row: 1, col: 0, attributes: rows(9) },
      { id: 'category', label: 'Category', row: 3, col: 0, attributes: rows(12) },
      { id: 'item', label: 'Item', row: 0, col: 1, width: 290, attributes: rows(28) },
    ],
    relationships: [
      { id: 'parent_link', from: 'item', to: 'parent', label: 'parentId', fromCardinality: 'many', toCardinality: 'one' },
      { id: 'category_link', from: 'item', to: 'category', label: 'categoryId', fromCardinality: 'many', toCardinality: 'one' },
    ],
  };
}

function verticalFixture(quality = 'standard') {
  const document = fixture(quality);
  document.entities = [
    { id: 'parent', label: 'Parent', row: 0, col: 0, attributes: rows(3) },
    { id: 'category', label: 'Category', row: 2, col: 0, attributes: rows(3) },
    { id: 'item', label: 'Item', row: 1, col: 0, width: 290, attributes: rows(3) },
  ];
  document.relationships[0].from = 'parent';
  document.relationships[0].to = 'item';
  return document;
}

function invoke(t, document, command = 'render') {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-erd-label-capacity-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  const input = path.join(folder, 'input.json');
  const output = path.join(folder, 'output.html');
  fs.writeFileSync(input, JSON.stringify(document));
  const result = spawnSync(process.execPath, [cli, command, 'erd', input, ...(command === 'render' ? [output] : ['--json'])], {
    encoding: 'utf8', env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  return { ...result, input, output, html: fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '' };
}

function boxes(html, label) {
  const number = '(-?[\\d.]+)';
  const rect = `x="${number}" y="${number}" width="${number}" height="${number}"`;
  return [...html.matchAll(new RegExp(`<rect ${rect}[^>]*class="${label ? 'c-mask' : 'c-database er-table'}"[^>]*>${label ? `\\s*<text[^>]*>${label}<\\/text>` : ''}`, 'g'))]
    .map(match => ({ x: +match[1], y: +match[2], width: +match[3], height: +match[4] }));
}

function routes(html) {
  return [...html.matchAll(/<path\b[^>]*data-edge-label="([^"]*)"[^>]*data-composition-points="([^"]+)"[^>]*marker-end[^>]*>/g)]
    .map(match => ({ label: match[1], points: match[2].split(';').map(pair => pair.split(',').map(Number)) }));
}

test('ERD automatic vertical labels clear authored table geometry in both profiles', t => {
  for (const quality of ['standard', 'showcase']) {
    const result = invoke(t, verticalFixture(quality));
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.html, /parentId/);
    assert.match(result.html, /categoryId/);
    const entities = boxes(result.html);
    assert.deepEqual(entities.map(box => box.width), [260, 260, 290]);
    assert.deepEqual(entities.map(box => box.height), [96, 96, 96]);
    assert.deepEqual(entities.map(box => [box.x, box.y]), [[47, 40], [47, 312], [32, 176]]);
    const paths = routes(result.html);
    for (const label of ['parentId', 'categoryId']) {
      const [rect] = boxes(result.html, label);
      assert.ok(rect, `rendered label ${label}`);
      assert.ok(entities.every(entity => !rectsOverlap(rect, entity, 2)));
      for (const route of paths.filter(route => route.label !== label)) {
        for (let index = 1; index < route.points.length; index++) {
          assert.ok(segmentRectClearanceWithin({ start: route.points[index - 1], end: route.points[index] }, rect, 4) >= 4);
        }
      }
    }
  }
});

test('ERD zero-valued label controls keep the authored failure', t => {
  for (const key of ['labelDx', 'labelDy', 'labelSegment']) {
    const document = verticalFixture();
    document.relationships.forEach(relationship => { relationship[key] = 0; });
    const result = invoke(t, document, 'validate');
    assert.equal(result.status, 1, `${key}: ${result.stdout}`);
    assert.match(result.stdout, /Label.*overlaps entity/);
  }
});

test('ERD bundled labels stay beside unique branches and clear the shared trunk', t => {
  const result = invoke(t, fixture());
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const shared = [...result.html.matchAll(/<path data-er-trunk="" data-composition-points="([^"]+)"/g)]
    .map(match => match[1].split(';').map(pair => pair.split(',').map(Number)));
  assert.ok(shared.length, 'the fixture retains its shared trunk');
  const paths = routes(result.html);
  for (const label of ['parentId', 'categoryId']) {
    const [rect] = boxes(result.html, label);
    assert.ok(boxes(result.html).every(entity => !rectsOverlap(rect, entity, 2)));
    for (const points of shared) {
      for (let index = 1; index < points.length; index++) {
        assert.ok(segmentRectClearanceWithin({ start: points[index - 1], end: points[index] }, rect, 4) >= 4, `${label} must not annotate the shared bus`);
      }
    }
    const own = paths.find(route => route.label === label).points;
    const uniqueStubs = [own.slice(0, 2), own.slice(-2)];
    assert.ok(uniqueStubs.some(([start, end]) => segmentRectClearanceWithin({ start, end }, rect, 22) <= 22), `${label} stays beside its unique source or target stub`);
  }
});

test('ERD explicit label points stay exactly where authored', t => {
  const document = fixture();
  document.relationships[0].labelAt = [200, 600];
  document.relationships[1].labelAt = [200, 900];
  const result = invoke(t, document);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.html, /<text x="200" y="600"[^>]*>parentId<\/text>/);
  assert.match(result.html, /<text x="200" y="900"[^>]*>categoryId<\/text>/);
  assert.deepEqual(labelReport(result).relationships.map(relationship => relationship.labelAt), [[200, 600], [200, 900]]);
});

test('ERD authored waypoints and canvas stay authoritative', t => {
  const document = fixture();
  document.meta.viewBox = [720, 340];
  document.entities = [
    { id: 'parent', label: 'Parent', pos: [32, 40], width: 240, attributes: rows(3) },
    { id: 'item', label: 'Item', pos: [400, 140], width: 240, attributes: rows(3) },
  ];
  document.relationships = [{ id: 'link', from: 'parent', to: 'item', label: 'reference',
    fromSide: 'right', toSide: 'left', via: [[336, 88], [336, 188]],
    fromCardinality: 'one', toCardinality: 'many' }];
  const result = invoke(t, document);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.html, /viewBox="0 0 720 340"/);
  assert.deepEqual(boxes(result.html), [{ x: 32, y: 40, width: 240, height: 96 }, { x: 400, y: 140, width: 240, height: 96 }]);
  assert.deepEqual(routes(result.html)[0].points, [[272, 88], [336, 88], [336, 188], [400, 188]]);
});

test('ERD grid-owned gaps grow to fit labels without changing fields or table dimensions', t => {
  const document = fixture();
  document.layout = { mode: 'grid' };
  document.entities = [
    { id: 'parent', label: 'Parent', row: 0, col: 0, attributes: rows(9) },
    { id: 'item', label: 'Item', row: 0, col: 1, attributes: rows(9) },
  ];
  document.relationships = [{ id: 'link', from: 'parent', to: 'item', label: 'foreign_reference', fromCardinality: 'one', toCardinality: 'many' }];
  const result = invoke(t, document);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const entities = boxes(result.html);
  assert.deepEqual(entities.map(entity => [entity.width, entity.height]), [[240, 216], [240, 216]]);
  const [label] = boxes(result.html, 'foreign_reference');
  assert.ok(entities.every(entity => !rectsOverlap(label, entity, 2)));
  const gap = entities[1].x - entities[0].x - entities[0].width;
  assert.ok(gap >= label.width + 48, 'the gap holds the label and both cardinality glyphs');
  for (const attribute of document.entities[0].attributes) assert.match(result.html, new RegExp(attribute.name));
});

test('ERD automatic labels stay clear of domain captions and the legend', t => {
  const document = verticalFixture();
  document.entities.forEach(entity => { entity.tag = `${entity.label} domain`; });
  document.meta.legend = { entries: { one: { label: 'One referenced entity' } } };
  const result = invoke(t, document);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const viewBox = result.html.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  assert.ok(viewBox);
  const height = +viewBox[2];
  const captions = [...result.html.matchAll(/<text data-domain-label="" x="([\d.]+)" y="([\d.]+)"[^>]*>([^<]+)<\/text>/g)]
    .map(match => ({ x: +match[1], y: +match[2] - 10, width: match[3].length * 9 * 0.6, height: 12 }));
  assert.equal(captions.length, 3);
  for (const label of ['parentId', 'categoryId']) {
    const [rect] = boxes(result.html, label);
    assert.ok(captions.every(caption => !rectsOverlap(rect, caption, 2)));
    assert.ok(rect.y >= 0 && rect.x >= 0 && rect.y + rect.height < height - 40);
  }
});

test('ERD capacity diagnostics give an executable full width without deleting text', t => {
  const document = fixture();
  document.entities = [{ id: 'parent', label: 'Parent', row: 0, col: 0, width: 240,
    attributes: [{ name: 'external_reference_code', type: 'varchar(128)', key: ['pk', 'uk'] }] }];
  document.relationships = [];
  const result = invoke(t, document, 'validate');
  assert.equal(result.status, 1);
  const diagnostic = JSON.parse(result.stdout).diagnostics.find(entry => entry.code === 'erd/attribute-text-capacity');
  assert.ok(diagnostic, result.stdout);
  assert.deepEqual(diagnostic.subject, { diagramType: 'erd', entityId: 'parent', attributeIndex: 0, attributeName: 'external_reference_code' });
  assert.ok(diagnostic.evidence.requiredEntityWidth > 240);
  assert.equal(diagnostic.evidence.keyColumnWidth, 50);
  assert.equal(diagnostic.evidence.paddingWidth, 24);
  assert.equal(diagnostic.evidence.nameFontSize, 11);
  assert.equal(diagnostic.evidence.typeFontSize, 10.5);
  assert.equal(diagnostic.evidence.requiredEntityWidth, 310, 'name + type + text gap + key badges + both paddings');
  assert.ok(Math.abs(diagnostic.evidence.requiredTextWidth - 235.4) < 0.0001);
  assert.equal(diagnostic.evidence.availableTextWidth, 166);
  assert.match(diagnostic.supportedFixes[0], /For this attribute row's text capacity/);
  assert.match(diagnostic.supportedFixes[0], /entities\[0\]\.width/);
  assert.doesNotMatch(diagnostic.message + diagnostic.supportedFixes.join(' '), /drop|shorten/);
  document.entities[0].width = diagnostic.evidence.requiredEntityWidth - 1;
  const tooNarrow = invoke(t, document, 'validate');
  assert.equal(tooNarrow.status, 1);
  assert.ok(JSON.parse(tooNarrow.stdout).diagnostics.some(entry => entry.code === 'erd/attribute-text-capacity'));
  document.entities[0].width = diagnostic.evidence.requiredEntityWidth;
  const repaired = invoke(t, document);
  assert.equal(repaired.status, 0, repaired.stderr + repaired.stdout);
  assert.match(repaired.html, /external_reference_code/);
  assert.match(repaired.html, /varchar\(128\)/);
  assert.match(repaired.html, /font-size="11">external_reference_code<\/text>/);
  assert.match(repaired.html, /class="er-type" font-size="10.5"[^>]*>varchar\(128\)<\/text>/);
  for (const key of ['pk', 'uk']) assert.match(repaired.html, new RegExp(`data-er-badge="${key}"`));
});

function labelReport(result) {
  const reported = spawnSync(process.execPath, [renderer, result.input, result.output, '--layout-json'], { encoding: 'utf8' });
  assert.equal(reported.status, 0, reported.stdout + reported.stderr);
  return JSON.parse(reported.stdout);
}

function labelPoint(html, label) {
  const text = html.match(new RegExp(`<text x="([\\d.-]+)" y="([\\d.-]+)"[^>]*>${label}<\\/text>`));
  assert.ok(text, `rendered text for ${label}`);
  return [Number(text[1]), Number(text[2])];
}

test('ERD layout report exposes each resolved automatic label at its rendered point', t => {
  for (const document of [verticalFixture(), fixture()]) {
    const result = invoke(t, document);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = labelReport(result);
    for (const relationship of report.relationships) {
      assert.deepEqual(relationship.labelAt, labelPoint(result.html, relationship.label).map(Math.round), 'the report uses the shared serializer rounding of the rendered point');
    }
  }
});

test('ERD origin labelAt remains authored in SVG and report while public validation rejects its overflow', t => {
  const document = verticalFixture('showcase');
  document.relationships[0].labelAt = [0, 0];
  const result = invoke(t, document, 'validate');
  assert.equal(result.status, 1, result.stdout);
  const raw = spawnSync(process.execPath, [renderer, result.input, result.output], { encoding: 'utf8' });
  assert.equal(raw.status, 0, raw.stdout + raw.stderr);
  assert.deepEqual(labelPoint(fs.readFileSync(result.output, 'utf8'), 'parentId'), [0, 0]);
  assert.deepEqual(labelReport(result).relationships.find(relationship => relationship.label === 'parentId').labelAt, [0, 0]);
});

test('ERD capacity uses inherited widths, the entity index and no type gap when type is omitted', t => {
  const document = fixture();
  document.layout.entityW = 180;
  document.entities = [
    { id: 'first', label: 'First', row: 0, col: 0, attributes: [{ name: 'id' }] },
    { id: 'second', label: 'Second', row: 0, col: 1, attributes: [{ name: 'a'.repeat(48) }] },
  ];
  document.relationships = [];
  const result = invoke(t, document, 'validate');
  assert.equal(result.status, 1, result.stdout);
  const diagnostic = JSON.parse(result.stdout).diagnostics.find(entry => entry.code === 'erd/attribute-text-capacity');
  assert.equal(diagnostic.subject.entityId, 'second');
  assert.equal(diagnostic.evidence.entityWidth, 180);
  assert.equal(diagnostic.evidence.keyColumnWidth, 30);
  assert.equal(diagnostic.evidence.requiredEntityWidth, 371);
  assert.match(diagnostic.supportedFixes[0], /entities\[1\]\.width/);
  document.entities[1].width = diagnostic.evidence.requiredEntityWidth;
  const repaired = invoke(t, document);
  assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
  assert.match(repaired.html, new RegExp(document.entities[1].attributes[0].name));
});
