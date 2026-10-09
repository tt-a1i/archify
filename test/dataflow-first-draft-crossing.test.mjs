import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { properSegmentIntersection } from '../archify/renderers/shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..', 'archify');
const renderer = path.join(skillRoot, 'renderers', 'dataflow', 'render-dataflow.mjs');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const fixture = path.join(__dirname, 'fixtures', 'dataflow-first-draft', 'ml-features.dataflow.json');

function render(diagram) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dataflow-first-draft-'));
  const input = path.join(directory, 'candidate.json');
  const output = path.join(directory, 'candidate.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  const result = spawnSync(process.execPath, [renderer, input, output], { cwd: directory, encoding: 'utf8' });
  return { ...result, input, html: result.status === 0 ? fs.readFileSync(output, 'utf8') : '' };
}

const attrs = (tag) => Object.fromEntries([...tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)].map((match) => [match[1], match[2]]));

function routes(html) {
  return [...html.matchAll(/<path\b[^>]*data-composition-points="[^"]*"[^>]*>/g)].map((match) => attrs(match[0]))
    .filter((route) => route['data-edge-from'])
    .map((route) => ({
      from: route['data-edge-from'],
      to: route['data-edge-to'],
      points: route['data-composition-points'].split(';').map((pair) => pair.split(',').map(Number)),
    }));
}

function properCrossings(html) {
  const all = routes(html);
  const crossings = [];
  for (const [index, left] of all.entries()) {
    for (const right of all.slice(index + 1)) {
      if ([left.from, left.to].some((id) => id === right.from || id === right.to)) continue;
      if (left.points.slice(1).some((end, i) => right.points.slice(1).some((otherEnd, j) => (
        properSegmentIntersection(left.points[i], end, right.points[j], otherEnd))))) crossings.push([`${left.from}->${left.to}`, `${right.from}->${right.to}`]);
    }
  }
  return crossings;
}

test('an unpinned dataflow draft re-plans a stage-skipping flow around a vertical flow instead of crossing it', () => {
  const diagram = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(routes(result.html).length >= diagram.flows.length);
  assert.deepEqual(properCrossings(result.html), []);
  const validation = spawnSync(process.execPath, [cli, 'validate', 'dataflow', result.input, '--quality', 'showcase', '--json'], { encoding: 'utf8' });
  assert.equal(validation.status, 0, validation.stdout + validation.stderr);
});

test('a pinned dataflow route keeps its geometry and its crossing diagnostic', () => {
  const diagram = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  for (const flow of diagram.flows) flow.route = 'auto';
  diagram.flows.find((flow) => flow.from === 'store' && flow.to === 'serve').route = 'straight';
  diagram.flows.find((flow) => flow.from === 'train' && flow.to === 'registry').route = 'straight';
  const result = render(diagram);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout + result.stderr, /proper-crossing/);
});

test('two automatic arrivals on one side of a tall node keep at least 16px between their ports', () => {
  const diagram = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const result = render(diagram);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const arrivals = routes(result.html).filter((route) => route.to === 'fe').map((route) => route.points.at(-1));
  assert.ok(arrivals.length >= 2, `expected at least two arrivals into fe, got ${arrivals.length}`);
  const ys = arrivals.map((point) => point[1]).sort((a, b) => a - b);
  for (let index = 1; index < ys.length; index += 1) {
    assert.ok(ys[index] - ys[index - 1] >= 16, `ports ${ys[index - 1]} and ${ys[index]} are only ${ys[index] - ys[index - 1]}px apart`);
  }
});
