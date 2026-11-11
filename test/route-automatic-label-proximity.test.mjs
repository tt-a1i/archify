import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { placeAutomaticLabels } from '../archify/renderers/shared/automatic-labels.mjs';
import { rectsOverlap, segmentRectClearance } from '../archify/renderers/shared/geometry.mjs';

test('blocked own-route slots retain a diagnostic collision instead of orphaning a label', () => {
  const label = { relation: {}, relationIndex: 0, lx: 100, ly: 100, x: 80, y: 90, width: 40, height: 14 };
  const obstacle = { x: 0, y: 60, width: 200, height: 80 };
  const scene = { labels: [label], components: [obstacle], titles: [], viewBox: [200, 200],
    routes: [
      { relationIndex: 0, points: [[20, 100], [180, 100]] },
      // An unrelated relationship is close to the clear ring fallback but
      // outside its route-mask clearance. It must not satisfy an own-route bound.
      { relationIndex: 1, points: [[20, 25], [180, 25]] },
    ] };
  const [unrestricted] = placeAutomaticLabels(scene);
  assert.equal(rectsOverlap(unrestricted, obstacle), false, 'fixture offers a distant clear fallback');
  const clearance = route => segmentRectClearance({ start: route.points[0], end: route.points[1] }, unrestricted);
  assert.ok(clearance(scene.routes[0]) > 36, 'the clear fallback is outside both own-route bounds');
  assert.ok(clearance(scene.routes[1]) > 4 && clearance(scene.routes[1]) < label.height * 2,
    'the competing route is unmasked but near enough to expose incorrect relationship filtering');
  for (const policy of [{ keepFallbackNearRoute: true }, { maxOwnRouteDistance: 36 }]) {
    const [bounded] = placeAutomaticLabels({ ...scene, ...policy });
    assert.deepEqual(bounded, label, JSON.stringify(policy));
    assert.equal(rectsOverlap(bounded, obstacle), true, 'validation must retain the original repairable collision');
  }
});

test('Architecture showcase caller keeps a blocked label attached to its own route', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-route-label-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(directory, 'source.json');
  const diagram = {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Blocked label', output: 'diagram.html', quality_profile: 'showcase', viewBox: [560, 320] },
    components: [
      { id: 'source', type: 'backend', label: 'Source', pos: [0, 100], size: [120, 60] },
      { id: 'destination', type: 'database', label: 'Destination', pos: [400, 100], size: [120, 60] },
      { id: 'blocker', type: 'backend', label: 'Blocked corridor', pos: [128, 60], size: [264, 140] },
    ],
    // The authored corridor is deliberately blocked: validation should explain
    // that defect, rather than making its unpinned label look unrelated.
    connections: [{ id: 'read', from: 'source', to: 'destination', label: 'Read result', via: [[200, 130], [300, 130]] }],
  };
  const source = JSON.stringify(diagram);
  fs.writeFileSync(input, source);
  const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--layout-json'], { encoding: 'utf8' });
  assert.equal(result.stderr, '');
  assert.equal(fs.readFileSync(input, 'utf8'), source);
  const report = JSON.parse(result.stdout);
  assert.equal(report.labels.length, 1);
  const [label] = report.labels;
  assert.equal(label.text, 'Read result');
  const blocker = report.components.find(component => component.id === 'blocker');
  if (rectsOverlap(label, blocker)) {
    assert.ok(report.diagnostics?.some(diagnostic =>
      /Label "Read result" overlaps component "blocker"/.test(diagnostic.message)),
    'a retained collision must include its repair diagnostic');
  } else {
    // Measure the actual finite route, including its endpoints. A label next
    // to the route's infinite extension is still detached from the connection.
    const points = report.connections[0].points;
    assert.ok(points.length >= 2, 'the caller report includes its routed connection');
    const clearances = points.slice(1).map((point, index) =>
      segmentRectClearance({ start: points[index], end: point }, label));
    assert.ok(clearances.every(clearance => Number.isFinite(clearance)),
      'all reported route segments have measurable clearance');
    const ownRouteDistance = Math.min(...clearances);
    assert.ok(ownRouteDistance <= label.height * 2,
      `clear label moved ${ownRouteDistance}px away from its route`);
  }
});
