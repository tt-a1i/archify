import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { collectLabelRouteClearance, rectsOverlap, labelPoint } from '../renderers/shared/geometry.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/archify.mjs');
function inspect(t, diagram, extra = []) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-auto-labels-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const input = path.join(cwd, 'source.json');
  const source = JSON.stringify(diagram);
  fs.writeFileSync(input, source);
  const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--layout-json', ...extra], { encoding: 'utf8' });
  assert.equal(result.stderr, '');
  assert.equal(fs.readFileSync(input, 'utf8'), source);
  return { result, report: JSON.parse(result.stdout), cwd, input };
}
function vertical() {
  return {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Cache read', output: 'diagram.html', quality_profile: 'showcase', viewBox: [480, 480] },
    components: [
      { id: 'api', type: 'backend', label: 'API', pos: [120, 70] },
      { id: 'cache', type: 'database', label: 'Cache', pos: [120, 320] },
    ],
    connections: [{ id: 'read', from: 'api', to: 'cache', label: 'Read cache' }],
  };
}
function assertLabelsClear(diagram, report) {
  for (const label of report.labels) {
    for (const component of report.components) assert.equal(rectsOverlap(label, component, -2), false);
  }
  const hits = collectLabelRouteClearance({
    labels: report.labels.map((label, relationIndex) => ({ ...label, relationIndex, relation: diagram.connections[relationIndex] })),
    routedRelations: report.connections.map((route, relationIndex) => ({ ...route, relationIndex, relation: diagram.connections[relationIndex] })),
    threshold: 4,
  });
  assert.deepEqual(hits, []);
}

test('vertical auto label clears the source without moving endpoints and is consistent in delivered SVG', t => {
  const diagram = vertical();
  const { result, report, input, cwd } = inspect(t, diagram);
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(report.connections[0].points, [[180, 130], [180, 320]]);
  assert.deepEqual(report.viewBox, diagram.meta.viewBox);
  assertLabelsClear(diagram, report);
  assert.notDeepEqual(report.connections[0].labelAt, labelPoint(diagram.connections[0], report.connections[0].points));
  const output = path.join(cwd, 'out.html');
  const delivery = spawnSync(process.execPath, [cli, 'deliver', 'architecture', input, output, '--json'], { encoding: 'utf8' });
  assert.equal(delivery.status, 0, delivery.stdout + delivery.stderr);
  const [x, y] = report.connections[0].labelAt;
  assert.ok(fs.readFileSync(output, 'utf8').includes(`<text x="${x}" y="${y}"`));
  const check = spawnSync(process.execPath, [cli, 'check', output, '--require-provenance'], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stdout + check.stderr);
});

test('frozen K2.8 draft clears its labels and renderer-owned automatic crossing', t => {
  const diagram = JSON.parse(fs.readFileSync(path.join(root, 'test/fixtures/architecture-label-repair/worldscope.json')));
  const { result, report } = inspect(t, diagram);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.diagnostics, undefined);
  assertLabelsClear(diagram, report);
  const standard = structuredClone(diagram);
  standard.meta.quality_profile = 'standard';
  const old = inspect(t, standard).report;
  assert.deepEqual(report.components, old.components);
  assert.deepEqual(report.connections.map(c => c.points), old.connections.map(c => c.points));
  assert.deepEqual(report.viewBox, old.viewBox);
  assert.deepEqual(report.connections.map(c => [c.from, c.to, c.label]), old.connections.map(c => [c.from, c.to, c.label]));
  assert.deepEqual(report.labels, inspect(t, diagram).report.labels);
});

for (const control of [{ labelDx: 0 }, { labelDy: 0 }, { labelSegment: 0 }, { labelAt: [180, 120] }]) {
  test(`explicit ${Object.keys(control)[0]} preserves the authored collision and failure`, t => {
    const diagram = vertical();
    Object.assign(diagram.connections[0], control);
    const { report, result } = inspect(t, diagram);
    assert.equal(result.status, 1);
    assert.deepEqual(report.connections[0].labelAt, [180, 120]);
    assert.ok(report.diagnostics.some(d => /overlaps component/.test(d.message)));
  });
}

test('standard preserves default placement and failure', t => {
  const diagram = vertical();
  diagram.meta.quality_profile = 'standard';
  const { result, report } = inspect(t, diagram);
  assert.equal(result.status, 1);
  assert.deepEqual(report.connections[0].labelAt, [180, 120]);
});

test('clear horizontal label and explicit route points stay unchanged', t => {
  const diagram = vertical();
  diagram.components[1].pos = [340, 70];
  diagram.connections[0].label = 'Read';
  diagram.connections[0].via = [[300, 100]];
  const { result, report } = inspect(t, diagram);
  assert.equal(result.status, 0, result.stdout);
  assert.deepEqual(report.connections[0].points, [[240, 100], [300, 100], [340, 100]]);
  assert.deepEqual(report.connections[0].labelAt, [320, 90]);
});

test('bounded fallback finds a clear position without hiding or shrinking the label', t => {
  const diagram = vertical();
  diagram.components[1].pos = [120, 160];
  diagram.components.push(
    { id: 'left', type: 'backend', label: 'Left', pos: [0, 90], size: [112, 150] },
    { id: 'right', type: 'backend', label: 'Right', pos: [248, 90], size: [112, 150] },
  );
  const { result, report } = inspect(t, diagram);
  assert.equal(result.status, 0, result.stdout);
  assert.notDeepEqual(report.connections[0].labelAt, [180, 120]);
  assert.equal(report.labels[0].text, 'Read cache');
  assertLabelsClear(diagram, report);
});

test('a short gap cannot pass by relocating its label above an endpoint', t => {
  const diagram = {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Authentication', output: 'diagram.html', quality_profile: 'showcase' },
    components: [
      { id: 'client', type: 'frontend', label: 'Client', pos: [45, 55], size: [180, 72] },
      { id: 'gateway', type: 'cloud', label: 'Gateway', pos: [310, 55], size: [220, 72] },
    ],
    connections: [{ id: 'login', from: 'client', to: 'gateway', label: '登录 · 配对 · 加密帧' }],
  };
  const crowded = inspect(t, diagram);
  assert.equal(crowded.result.status, 1, crowded.result.stdout);
  const diagnostic = crowded.report.diagnostics.find(d => d.code === 'composition/label-gap');
  assert.ok(diagnostic, crowded.result.stdout);
  assert.equal(diagnostic.subject.id, 'login');
  assert.ok(diagnostic.evidence.minimumGapPx > diagnostic.evidence.clearGapPx);
  assert.ok(diagnostic.supportedFixes.some(fix => /increase the clear gap/.test(fix)));

  for (const control of [{ labelDx: 0 }, { labelAt: [267.5, 81] }]) {
    const pinned = structuredClone(diagram);
    Object.assign(pinned.connections[0], control);
    const explicit = inspect(t, pinned);
    assert.equal(explicit.result.status, 1);
    assert.ok(explicit.report.diagnostics.some(d => /overlaps component/.test(d.message)));
    assert.ok(!explicit.report.diagnostics.some(d => d.code === 'composition/label-gap'));
  }

  diagram.components[1].pos[0] = 390;
  const repaired = inspect(t, diagram);
  assert.equal(repaired.result.status, 0, repaired.result.stdout);
  assertLabelsClear(diagram, repaired.report);
  assert.equal(repaired.report.labels[0].text, diagram.connections[0].label);
});
