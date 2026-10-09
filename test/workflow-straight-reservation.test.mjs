import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';
import { labelPoint } from '../archify/renderers/shared/geometry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.join(root, 'test/fixtures/workflow-first-draft/automatic-fanout.workflow.json');
const cli = path.join(root, 'archify/bin/archify.mjs');
const load = () => JSON.parse(fs.readFileSync(fixture, 'utf8'));
const length = points => points.slice(1).reduce((sum, point, index) => (
  sum + Math.hypot(point[0] - points[index][0], point[1] - points[index][1])
), 0);
const edgeById = (result, id) => result.receipt.edges.find(edge => edge.id === id);

function assertShortFanOut(result) {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.receipt.diagnostics, []);
  const main = edgeById(result, 'begin-llm');
  const branch = edgeById(result, 'begin-messages');
  // On the old straight-first path the branch grew to 1494px and displaced
  // the main edge. Bound the user-visible detour, without choosing its ports
  // or freezing a better future automatic route to these exact coordinates.
  assert.ok(length(main.points) <= 200, JSON.stringify(main));
  assert.ok(length(branch.points) <= 650, JSON.stringify(branch));
  assert.ok(main.points.length - 2 <= 2);
  assert.ok(branch.points.length - 2 <= 4);
}

test('a facing but non-straight automatic branch keeps short collision-free routes in both profiles', () => {
  for (const qualityProfile of ['standard', 'showcase']) {
    assertShortFanOut(compileWorkflow({ workflow: load(), qualityProfile }));
  }
});

test('public validation and rendered SVG preserve the mixed fan-out without a large detour', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-straight-reservation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const run = args => spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8', env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  const validated = run(['validate', 'workflow', fixture, '--quality', 'showcase', '--json']);
  assert.equal(validated.status, 0, validated.stdout + validated.stderr);
  const receipt = JSON.parse(validated.stdout);
  for (const metric of ['properCrossings', 'ambiguousCorridors', 'arrowheadCollisions']) {
    assert.equal(receipt.composition.metrics[metric], 0, metric);
  }
  const output = path.join(directory, 'fan-out.html');
  const rendered = run(['render', 'workflow', fixture, output, '--quality', 'showcase']);
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
  const html = fs.readFileSync(output, 'utf8');
  for (const id of ['begin-llm', 'begin-messages']) {
    const tag = [...html.matchAll(/<path\b[^>]*>/g)].map(match => match[0])
      .find(value => value.includes(`data-edge-id="${id}"`));
    assert.ok(tag, id);
    const points = tag.match(/data-composition-points="([^"]+)"/)[1]
      .split(';').map(pair => pair.split(',').map(Number));
    assert.ok(length(points) <= (id === 'begin-llm' ? 200 : 650), id);
  }
});

test('an already valid same-style fan-out keeps short routes rather than moving to an outer corridor', () => {
  const workflow = load();
  workflow.edges[0].variant = 'emphasis';
  delete workflow.edges[0].role;
  assertShortFanOut(compileWorkflow({ workflow, qualityProfile: 'showcase' }));
});

test('straight reservation preserves input content and deterministic node geometry', () => {
  const workflow = load();
  const before = JSON.stringify(workflow);
  const first = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  const reordered = structuredClone(workflow);
  reordered.nodes.reverse();
  reordered.edges.reverse();
  const second = compileWorkflow({ workflow: reordered, qualityProfile: 'showcase' });
  assert.equal(JSON.stringify(workflow), before);
  assert.deepEqual(second, first);
  assert.equal(first.receipt.nodes.length, workflow.nodes.length);
  assert.equal(first.receipt.edges.length, workflow.edges.length);
});

test('explicit canvas, node dimensions, endpoint sides and absolute waypoints stay authoritative', () => {
  const workflow = load();
  workflow.meta.viewBox = [1024, 1000];
  workflow.nodes.forEach(node => { node.width = node.id === 'messages' ? 128 : 92; });
  Object.assign(workflow.edges[0], {
    fromSide: 'right', toSide: 'top', via: [[276, 246], [276, 483], [214, 483]],
  });
  const before = JSON.stringify(workflow);
  const result = compileWorkflow({ workflow, qualityProfile: 'standard' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(result.receipt.diagnostics, []);
  assert.equal(JSON.stringify(workflow), before);
  assert.deepEqual(result.receipt.viewBox, workflow.meta.viewBox);
  for (const node of workflow.nodes) {
    assert.equal(result.receipt.nodes.find(entry => entry.id === node.id).width, node.width);
  }
  const edge = edgeById(result, 'begin-messages');
  assert.deepEqual(edge.points.slice(1, -1), workflow.edges[0].via);
  const source = result.receipt.nodes.find(node => node.id === 'begin');
  const target = result.receipt.nodes.find(node => node.id === 'messages');
  assert.equal(edge.points[0][0], source.x + source.width);
  assert.equal(edge.points.at(-1)[1], target.y);
  // The neighbour may slide its own port to distinguish its stroke from the
  // pinned branch. It must leave the authored route and all boxes untouched.
  const showcase = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(showcase.ok, true, JSON.stringify(showcase.diagnostics));
  assert.deepEqual(showcase.receipt.diagnostics, []);
  assert.deepEqual(showcase.receipt.nodes, result.receipt.nodes);
  assert.deepEqual(showcase.receipt.viewBox, workflow.meta.viewBox);
  assert.deepEqual(edgeById(showcase, 'begin-messages').points, edge.points);
  const main = edgeById(showcase, 'begin-llm');
  assert.ok(length(main.points) <= 200, JSON.stringify(main));
  assert.notDeepEqual(main.points[0], edge.points[0]);
});

test('endpoint clearance repair does not move the neighbours authored endpoint-side controls', () => {
  const workflow = load();
  workflow.meta.viewBox = [1024, 1000];
  workflow.nodes.forEach(node => { node.width = node.id === 'messages' ? 128 : 92; });
  Object.assign(workflow.edges[0], {
    fromSide: 'right', toSide: 'top', via: [[276, 246], [276, 483], [214, 483]],
  });
  // With both source sides pinned, the collision remains actionable; a
  // successful repair must never be obtained by silently sliding either pin.
  workflow.edges[1].fromSide = 'right';
  const result = compileWorkflow({ workflow, qualityProfile: 'standard' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.ok(result.receipt.diagnostics.some(diagnostic => diagnostic.code === 'composition/ambiguous-corridor'));
  const branch = edgeById(result, 'begin-messages');
  assert.deepEqual(branch.points.slice(1, -1), workflow.edges[0].via);
  const source = result.receipt.nodes.find(node => node.id === 'begin');
  const main = edgeById(result, 'begin-llm');
  assert.equal(main.points[0][0], source.x + source.width);
  assert.deepEqual(main.points[0], branch.points[0]);
});

test('authored zero-valued relative label controls retain their source segment anchor', () => {
  const workflow = load();
  Object.assign(workflow.edges[0], { labelDx: 0, labelDy: 0, labelSegment: 0 });
  const before = JSON.stringify(workflow);
  const result = compileWorkflow({ workflow, qualityProfile: 'standard' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(JSON.stringify(workflow), before);
  const edge = edgeById(result, 'begin-messages');
  const label = result.receipt.labels.find(entry => entry.edge === 'begin-messages');
  assert.deepEqual([label.x, label.y], labelPoint(workflow.edges[0], edge.points));
});
