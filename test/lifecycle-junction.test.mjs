import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAmbiguousCorridors, collectArrowheadCollisions } from '../archify/renderers/shared/geometry.mjs';

const skillRoot = fileURLToPath(new URL('../archify/', import.meta.url));
const state = (id, type = 'active') => ({ id, type, label: id });
const bus = {
  schema_version: 3, diagram_type: 'lifecycle',
  meta: { title: 'Shared exits', output: 'bus.html', quality_profile: 'showcase' },
  mainPath: ['a', 'b', 'c'],
  states: [state('a', 'start'), state('b'), state('c', 'success'), state('x', 'failure'), state('y', 'failure')],
  transitions: [
    { from: 'a', to: 'b' }, { from: 'b', to: 'c' },
    ...['a', 'c'].flatMap(from => ['x', 'y'].map(to => ({ from, to, label: 'exit' }))),
  ],
};

test('multi-target lifecycle bus passes the public artifact checker and validation', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-lifecycle-junction-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const input = path.join(dir, 'bus.json');
  const output = path.join(dir, 'bus.html');
  fs.writeFileSync(input, JSON.stringify(bus));
  const render = spawnSync(process.execPath, [path.join(skillRoot, 'renderers/lifecycle/render-lifecycle.mjs'), input, output], { encoding: 'utf8' });
  assert.equal(render.status, 0, render.stderr);
  assert.match(fs.readFileSync(output, 'utf8'), /data-composition-junction="a\+c"/);
  const check = spawnSync(process.execPath, [path.join(skillRoot, 'scripts/check-render-output.mjs'), output], { encoding: 'utf8' });
  const receipt = JSON.parse(check.stdout);
  assert.equal(check.status, 0, check.stdout);
  assert.equal(receipt.composition.metrics.ambiguousCorridors, 0);
  assert.equal(receipt.composition.metrics.arrowheadCollisions, 0);
  const validate = spawnSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'validate', 'lifecycle', input, '--json'], { encoding: 'utf8' });
  assert.equal(validate.status, 0, validate.stdout + validate.stderr);
});

const route = (from, to, points, junction = 'a+c') => ({ relation: { from, to, junction }, points });
const corridors = (...routedRelations) => collectAmbiguousCorridors({ routedRelations, includeSharedEndpoints: () => true });

test('one junction shares only the first tick at the same source port', () => {
  const first = route('a', 'x', [[20, 20], [20, 60], [100, 60], [100, 100]]);
  const second = route('a', 'y', [[20, 20], [20, 60], [160, 60], [160, 100]]);
  assert.deepEqual(corridors(first, second), []);
  assert.equal(corridors(first, { ...second, sourceEndpoint: false }).length, 1,
    'a disconnected interior subpath is not the source tick');
  const differentPort = route('a', 'y', [[20, 30], [20, 60], [160, 60], [160, 100]]);
  assert.equal(corridors(first, differentPort).length, 1, 'source identity alone does not declare a common port');
  const unrelated = route('b', 'y', second.points);
  assert.equal(corridors(first, unrelated).length, 1, 'junction identity alone does not declare a common source');
});

test('interior vertical overlap remains ambiguous within the same junction', () => {
  const first = route('a', 'x', [[20, 20], [20, 60], [100, 60], [100, 120], [160, 120]]);
  const second = route('a', 'y', [[20, 20], [20, 40], [100, 40], [100, 100], [220, 100]]);
  const hits = corridors(first, second);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].leftSegment, 2);
  assert.equal(hits[0].rightSegment, 2);
  assert.equal(hits[0].overlapLength, 40);
});

test('public checker rejects interior vertical overlaps even when the junction and source match', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-junction-overlap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const junction of ['a+c', 'other']) {
    const first = route('a', 'x', [[20, 20], [20, 60], [100, 60], [100, 120], [160, 120]]);
    const second = route('a', 'y', [[20, 20], [20, 40], [100, 40], [100, 100], [220, 100]], junction);
    const strokes = [first, second].map(({ relation, points }) => {
      const d = points.map(([x, y], index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
      return `<path data-graph-role="automatic-crossover-underlay" d="${d}" fill="none" stroke="var(--mask)" stroke-width="5" pointer-events="none"/>
        <path d="${d}" data-edge-from="${relation.from}" data-edge-to="${relation.to}"
          data-composition-junction="${relation.junction}" data-composition-independent="true"
          data-composition-crossover="halo" class="a-default" stroke-width="1.5" marker-end="url(#arrow)"/>`;
    }).join('\n');
    const file = path.join(dir, `${junction}.html`);
    fs.writeFileSync(file, `<html><body><svg viewBox="0 0 300 200" data-quality-profile="showcase">${strokes}</svg></body></html>`);
    const checked = spawnSync(process.execPath, [path.join(skillRoot, 'scripts/check-render-output.mjs'), file], { encoding: 'utf8' });
    const receipt = JSON.parse(checked.stdout);
    assert.equal(checked.status, 1);
    assert.equal(receipt.composition.metrics.ambiguousCorridors, 1);
    const issue = receipt.composition.issues.find(entry => entry.code === 'composition/ambiguous-corridor');
    assert.equal(issue.segmentIndex, 2);
    assert.equal(issue.otherSegmentIndex, 2);
    assert.equal(issue.overlapLength, 40);
  }
});

test('different junctions cannot share a source tick or a bus', () => {
  const first = route('a', 'x', [[20, 20], [20, 60], [100, 60], [100, 100]]);
  const second = route('a', 'y', [[20, 20], [20, 60], [160, 60], [160, 100]], 'other');
  assert.equal(corridors(first, second).length, 1);
});

test('same-target junction merged drops retain a single arrowhead', () => {
  const first = route('a', 'x', [[20, 20], [20, 60], [100, 60], [100, 100]]);
  const second = route('c', 'x', [[160, 20], [160, 60], [100, 60], [100, 100]]);
  assert.deepEqual(corridors(first, second), []);
  assert.deepEqual(collectArrowheadCollisions({ routedRelations: [first, second] }), []);
  second.relation.junction = 'other';
  assert.equal(corridors(first, second).length, 1);
  assert.equal(collectArrowheadCollisions({ routedRelations: [first, second] }).length, 1);
});
