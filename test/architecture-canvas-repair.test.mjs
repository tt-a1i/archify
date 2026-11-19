import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
function inspect(t, spec, expectedStatus = 0) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-canvas-repair-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'diagram.json');
  fs.writeFileSync(input, JSON.stringify(spec));
  const result = spawnSync(process.execPath, [cli, 'inspect', 'architecture', input, '--json'], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
function collisionSpec() {
  return {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Authored canvas', output: 'diagram.html', viewBox: [440, 240] },
    layout: { mode: 'auto' },
    components: [
      { id: 'a', type: 'backend', label: 'A', size: [120, 60], pos: [48, 170] },
      { id: 'b', type: 'backend', label: 'B', size: [120, 60] },
    ],
    connections: [{ from: 'a', to: 'b', label: 'X', labelAt: [320, 189] }],
  };
}
function assertSeparate(a, b) {
  assert.ok(a.x + a.width <= b.x || a.x >= b.x + b.width
    || a.y + a.height <= b.y || a.y >= b.y + b.height);
}
function assertOnCanvas(report) {
  const [width, height] = report.viewBox;
  for (const box of [...report.components, ...report.boundaries]) {
    assert.ok(box.x >= 0 && box.y >= 0);
    assert.ok(box.x + box.width <= width && box.y + box.height <= height);
  }
}

test('architecture collision repair chooses a clear slot within the authored canvas', t => {
  const spec = collisionSpec();
  const report = inspect(t, spec);
  assert.deepEqual(report.viewBox, spec.meta.viewBox);
  assert.deepEqual(report.components[0].pos, spec.components[0].pos);
  assert.deepEqual(report.connections[0].labelAt, spec.connections[0].labelAt);
  assertOnCanvas(report);
  for (const card of report.components) assertSeparate(card, report.labels[0]);
  assertSeparate(...report.components);
});

test('architecture collision repair can grow an inferred canvas', t => {
  const spec = collisionSpec();
  delete spec.meta.viewBox;
  const report = inspect(t, spec);
  assert.ok(report.viewBox[1] > 240);
  assertOnCanvas(report);
  for (const card of report.components) assertSeparate(card, report.labels[0]);
});

test('architecture collision repair preserves impossible authored constraints for validation', t => {
  const spec = collisionSpec();
  spec.meta.viewBox = [320, 240];
  spec.components[1].size = [340, 60];
  const report = inspect(t, spec, 1);
  assert.deepEqual(report.viewBox, spec.meta.viewBox);
  assert.deepEqual(report.components[0].pos, spec.components[0].pos);
  assert.deepEqual(report.connections[0].labelAt, spec.connections[0].labelAt);
  assert.equal(report.ok, false);
  assert.ok(report.diagnostics.length > 0);
});

test('architecture inferred deployment frames remain contained across eight nested scopes', t => {
  const spec = collisionSpec();
  delete spec.meta.viewBox;
  spec.meta.engineering_profile = 'deployment-ownership';
  spec.components = Array.from({ length: 8 }, (_, index) => ({
    id: `c${index}`, type: 'backend', label: `C${index}`, tag: 'OPS', size: [120, 60],
  }));
  spec.connections = [];
  spec.boundaries = Array.from({ length: 8 }, (_, index) => ({
    kind: index === 0 ? 'region' : 'security-group', label: `Scope ${index}`,
    pad: index === 7 ? 30 : 0,
    wraps: spec.components.slice(0, 8 - index).map(card => card.id),
  }));
  for (const quality of [undefined, 'showcase']) {
    if (quality) spec.meta.quality_profile = quality;
    for (const reverse of [false, true]) {
      const input = structuredClone(spec);
      if (reverse) input.boundaries.reverse();
      const report = inspect(t, input);
      assertOnCanvas(report);
      for (const child of report.boundaries) {
        for (const parent of report.boundaries) {
          if (child.wraps.length >= parent.wraps.length) continue;
          assert.ok(parent.x <= child.x && parent.y <= child.y);
          assert.ok(parent.x + parent.width >= child.x + child.width);
          assert.ok(parent.y + parent.height >= child.y + child.height);
        }
      }
      assert.ok(report.components.every(card => !Object.hasOwn(card, 'pos')));
    }
  }
});
