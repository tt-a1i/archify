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
const renderer = path.join(skillRoot, 'renderers', 'class', 'render-class.mjs');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const fixtures = path.join(__dirname, 'fixtures', 'class-first-draft');

function render(diagram) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-class-first-draft-'));
  const input = path.join(directory, 'candidate.json');
  const output = path.join(directory, 'candidate.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  const result = spawnSync(process.execPath, [renderer, input, output], { cwd: directory, encoding: 'utf8' });
  return { ...result, input, html: result.status === 0 ? fs.readFileSync(output, 'utf8') : '' };
}

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));
const svgOf = (html) => html.match(/<svg\b[\s\S]*?<\/svg>/i)[0];

function routes(html) {
  return [...svgOf(html).matchAll(/<path\b[^>]*data-class-relationship[^>]*>/g)].map((match) => attrs(match[0]))
    .filter((route) => route['data-composition-points'])
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

function typeBoxes(html) {
  const boxes = new Map();
  for (const match of svgOf(html).matchAll(/data-node-id="([^"]+)"[^>]*>[\s\S]{0,600}?<rect x="([\d.-]+)" y="([\d.-]+)" width="([\d.]+)" height="([\d.]+)"/g)) {
    if (!boxes.has(match[1])) boxes.set(match[1], { x: +match[2], y: +match[3], width: +match[4], height: +match[5] });
  }
  return boxes;
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

for (const name of ['notifications', 'repository', 'shapes']) {
  test(`unpinned class first draft "${name}" passes showcase without a crossing or a repair`, () => {
    const diagram = JSON.parse(fs.readFileSync(path.join(fixtures, `${name}.class.json`), 'utf8'));
    assert.equal(diagram.meta.quality_profile, 'showcase');
    const result = render(diagram);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(properCrossings(result.html), []);
    // shapes used to run 3 units along the Shape type, notifications along
    // EmailChannel: a detour keeps a readable gap from the types it passes.
    assert.deepEqual(routeHugs(routes(result.html), typeBoxes(result.html)), []);
    assert.ok(labelBoxes(result.html).length > 0, 'the fixture draws relationship labels');
    const validation = spawnSync(process.execPath, [cli, 'validate', 'class', result.input, '--quality', 'showcase', '--json'], { encoding: 'utf8' });
    assert.equal(validation.status, 0, validation.stdout + validation.stderr);
  });
}

test('the repository draft keeps the "publishes" label off the Order type', () => {
  const diagram = JSON.parse(fs.readFileSync(path.join(fixtures, 'repository.class.json'), 'utf8'));
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const order = [...svgOf(result.html).matchAll(/data-node-id="order"[\s\S]{0,400}?<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"/g)]
    .map((match) => ({ x: +match[1], y: +match[2], width: +match[3], height: +match[4] }))[0];
  assert.ok(order, 'the Order type is drawn');
  for (const label of labelBoxes(result.html)) assert.ok(!rectsOverlap(label, order), `label ${label.id} overlaps Order`);
});

test('a pinned label point is never moved by the automatic placer', () => {
  const diagram = JSON.parse(fs.readFileSync(path.join(fixtures, 'shapes.class.json'), 'utf8'));
  const relationship = diagram.relationships.find((entry) => entry.label);
  const before = render(diagram);
  const [authored] = labelBoxes(before.html).filter((box) => box.id === relationship.id);
  relationship.labelAt = [authored.x + authored.width / 2 + 4, authored.y + 10];
  const pinned = render(diagram);
  assert.equal(pinned.status, 0, pinned.stdout + pinned.stderr);
  const [moved] = labelBoxes(pinned.html).filter((box) => box.id === relationship.id);
  assert.equal(moved.x, authored.x + 4);
  assert.equal(moved.y, authored.y);
});
