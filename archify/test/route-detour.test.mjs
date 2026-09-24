import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/archify.mjs');

function component(id, pos, size = [120, 60]) {
  return { id, type: 'backend', label: id, pos, size };
}

function validate(t, diagram, extra = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-route-detour-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'diagram.json');
  fs.writeFileSync(input, JSON.stringify(diagram));
  const result = spawnSync(process.execPath, [
    cli, 'validate', 'architecture', input, '--quality', diagram.meta.quality_profile,
    '--layout-json', '--json', ...extra,
  ], { cwd: directory, encoding: 'utf8' });
  assert.equal(result.stderr, '', result.stderr);
  return { result, receipt: JSON.parse(result.stdout) };
}

function longDetour(profile = 'showcase') {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Long detour', output: 'diagram.html', quality_profile: profile },
    components: [
      component('sources', [60, 300], [150, 64]),
      component('worker', [410, 300], [150, 64]),
      component('cache', [290, 480], [150, 64]),
    ],
    connections: [{
      id: 'sources-to-worker', from: 'sources', to: 'worker', label: 'collect',
      fromSide: 'bottom', toSide: 'bottom', via: [[135, 1120], [485, 1120]],
    }],
  };
}

test('showcase rejects an authored route whose empty-space detour is far longer than a legal orthogonal route', t => {
  const { result, receipt } = validate(t, longDetour());
  assert.equal(result.status, 1);
  const diagnosis = receipt.diagnostics.find(({ code }) => code === 'composition/excessive-route-detour');
  assert.ok(diagnosis, JSON.stringify(receipt));
  assert.equal(diagnosis.subject.id, 'sources-to-worker');
  assert.equal(diagnosis.evidence.actualLengthPx, 1862);
  assert.equal(diagnosis.evidence.shortestLegalLengthPx, 358);
  assert.equal(diagnosis.evidence.detourRatio, 5.2);
  assert.equal(diagnosis.evidence.emptyExcursionPx.bottom, 576);
  assert.equal(diagnosis.evidence.emptyControlPointClearancePx.maximum, 731);
  assert.deepEqual(diagnosis.evidence.shortestLegalPoints, [
    [135, 364], [135, 368], [485, 368], [485, 364],
  ]);
  assert.match(diagnosis.supportedFixes.join(' '), /remove the distant via points/);
});

test('an unnecessary control corridor is diagnosed inside a large content envelope', t => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Internal empty corridor', output: 'diagram.html', quality_profile: 'showcase' },
    components: [
      component('source', [60, 100]),
      component('target', [410, 100]),
      component('lower-content', [60, 700]),
    ],
    connections: [{
      id: 'internal-detour', from: 'source', to: 'target',
      fromSide: 'bottom', toSide: 'bottom', via: [[120, 500], [470, 500]],
    }],
  };
  const { result, receipt } = validate(t, diagram);
  assert.equal(result.status, 1);
  const diagnosis = receipt.diagnostics.find(({ code }) => code === 'composition/excessive-route-detour');
  assert.ok(diagnosis, JSON.stringify(receipt));
  assert.equal(diagnosis.evidence.emptyExcursionPx.maximum, 0);
  assert.equal(diagnosis.evidence.emptyControlPointClearancePx.maximum, 340);
});

test('the same relationship passes after the unnecessary authored detour is removed', t => {
  const diagram = longDetour();
  diagram.connections[0] = { id: 'sources-to-worker', from: 'sources', to: 'worker', label: 'collect' };
  const { result, receipt } = validate(t, diagram);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(receipt.ok, true);
});

test('standard keeps authored route freedom while showcase owns the compactness gate', t => {
  const { result, receipt } = validate(t, longDetour('standard'));
  assert.equal(result.status, 0, result.stdout);
  assert.equal(receipt.ok, true);
});

test('an explicit route around an opaque obstacle is not reported as an excessive detour', t => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Obstacle route', output: 'diagram.html', quality_profile: 'showcase' },
    components: [
      component('source', [60, 100]),
      component('blocker', [240, 80], [100, 100]),
      component('target', [410, 100]),
    ],
    connections: [{
      id: 'around-blocker', from: 'source', to: 'target',
      fromSide: 'right', toSide: 'left',
      via: [[200, 130], [200, 190], [390, 190], [390, 130]],
    }],
  };
  const { result, receipt } = validate(t, diagram);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(receipt.ok, true);
});

test('a related shared outer corridor is treated as an intentional bus', t => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Shared bus', output: 'diagram.html', quality_profile: 'showcase' },
    components: [
      component('source', [60, 100]),
      component('first', [410, 100]),
      component('second', [410, 260]),
    ],
    connections: [
      {
        id: 'bus-first', from: 'source', to: 'first',
        fromSide: 'bottom', toSide: 'bottom', via: [[120, 700], [470, 700]],
      },
      {
        id: 'bus-second', from: 'source', to: 'second',
        fromSide: 'bottom', toSide: 'bottom', via: [[120, 700], [470, 700]],
      },
    ],
  };
  const { receipt } = validate(t, diagram);
  assert.equal(
    receipt.diagnostics?.some(({ code }) => code === 'composition/excessive-route-detour') || false,
    false,
    JSON.stringify(receipt),
  );
});

test('a direct relationship crossing a region boundary is not a detour', t => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Boundary crossing', output: 'diagram.html', quality_profile: 'showcase' },
    components: [component('outside', [40, 120]), component('inside', [340, 120])],
    boundaries: [{ kind: 'region', label: 'Runtime', wraps: ['inside'] }],
    connections: [{ id: 'enter', from: 'outside', to: 'inside' }],
  };
  const { result, receipt } = validate(t, diagram);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(receipt.ok, true);
});

test('showcase rejects a feedback route that frames the entire scene to avoid one crossing', t => {
  const diagram = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Local team loop', output: 'diagram.html', quality_profile: 'showcase' },
    components: [
      component('browser', [40, 260], [170, 68]),
      component('http', [330, 260], [190, 68]),
      component('runtime', [650, 260], [190, 68]),
      component('orchestrator', [970, 100], [190, 68]),
      component('worker', [970, 420], [190, 68]),
      component('sqlite', [650, 550], [190, 68]),
      component('tasks', [330, 550], [190, 68]),
    ],
    connections: [
      { from: 'browser', to: 'http' },
      { from: 'http', to: 'runtime' },
      { from: 'runtime', to: 'orchestrator' },
      { from: 'orchestrator', to: 'http' },
      { from: 'runtime', to: 'worker' },
      { id: 'worker-report', from: 'worker', to: 'http', fromSide: 'bottom', toSide: 'left',
        via: [[1065, 700], [250, 700], [250, 294]] },
      { from: 'runtime', to: 'sqlite' },
      { from: 'http', to: 'tasks' },
    ],
  };
  const { result, receipt } = validate(t, diagram);
  assert.equal(result.status, 1);
  const diagnosis = receipt.diagnostics.find(({ code }) => code === 'composition/excessive-route-detour');
  assert.ok(diagnosis, JSON.stringify(receipt));
  assert.equal(diagnosis.subject.id, 'worker-report');
});
