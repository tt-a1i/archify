import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
const ref = (anchor, offset = 0) => ({ anchor, offset });
const initialPoints = [[200, 230], [200, 270], [340, 270], [340, 390], [200, 390], [200, 430]];

function setup(t) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-relative-via-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const input = path.join(cwd, 'source.json');
  const output = path.join(cwd, 'diagram.html');
  const diagram = {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Anchored corridor', output: 'diagram.html', quality_profile: 'showcase', viewBox: [700, 750], legend: { mode: 'hidden' } },
    layout: { mode: 'grid', origin: [100, 150], cols: 1, cellW: 200, cellH: 80, gapY: 200 },
    components: [
      { id: 'source', type: 'backend', label: 'Source', row: 0, col: 0, size: [200, 80] },
      { id: 'target', type: 'backend', label: 'Target', row: 1, col: 0, size: [200, 80] },
    ],
    connections: [{
      id: 'request', from: 'source', to: 'target', label: 'request', fromSide: 'bottom', toSide: 'top',
      via: [[ref('from'), ref('from', 40)], [340, ref('from', 40)], [340, ref('to', -40)], [ref('to'), ref('to', -40)]],
      labelSegment: 2, labelDy: 10,
    }],
  };
  function run(command = 'validate', flags = ['--layout-json'], status = 0) {
    const bytes = JSON.stringify(diagram);
    fs.writeFileSync(input, bytes);
    const result = spawnSync(process.execPath, [cli, command, 'architecture', input,
      ...(command === 'deliver' || command === 'render' ? [output] : []), ...flags], {
      cwd, encoding: 'utf8', env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
    });
    assert.equal(result.status, status, result.stdout + result.stderr);
    assert.equal(fs.readFileSync(input, 'utf8'), bytes, 'resolution must not overwrite authored bindings');
    return flags.length ? JSON.parse(result.stdout) : result;
  }
  return { diagram, input, output, run };
}

test('relative coordinates follow grid, pos and measured size while the channel stays fixed', t => {
  const { diagram, run } = setup(t);
  assert.deepEqual(run().connections[0].points, initialPoints);
  diagram.layout.gapY = 280;
  let edge = run().connections[0];
  assert.deepEqual(edge.points, [[200, 230], [200, 270], [340, 270], [340, 470], [200, 470], [200, 510]]);
  assert.deepEqual(edge.labelAt, [340, 370]);
  diagram.components[1].pos = [180, 510];
  diagram.components[0].size = [201, 100];
  edge = run().connections[0];
  assert.deepEqual(edge.points, [[200.5, 250], [200.5, 290], [340, 290], [340, 470], [280, 470], [280, 510]]);
  assert.deepEqual(edge.labelAt, [340, 380]);
});

test('equivalent absolute and relative inputs render identical geometry and bind original source bytes', t => {
  const { diagram, input, output, run } = setup(t);
  const relativeLayout = run();
  const delivered = run('deliver', ['--json']);
  const relativeHtml = fs.readFileSync(output, 'utf8');
  assert.equal(delivered.specification.sha256, createHash('sha256').update(fs.readFileSync(input)).digest('hex'));
  diagram.connections[0].via = initialPoints.slice(1, -1);
  assert.deepEqual(run(), relativeLayout);
  run('render', []);
  const svg = html => html.match(/<svg\b[\s\S]*?<\/svg>/)[0];
  assert.equal(svg(fs.readFileSync(output, 'utf8')), svg(relativeHtml));
});

test('mixed numeric points and references preserve authored collinear indices and absolute labels', t => {
  const { diagram, run } = setup(t);
  const edge = diagram.connections[0];
  edge.via.splice(2, 0, [340, 300]);
  edge.labelSegment = 3;
  assert.deepEqual(run().connections[0].labelAt, [340, 345]);
  edge.labelAt = [400, 330];
  edge.labelSegment = 99;
  diagram.layout.gapY = 280;
  const moved = run().connections[0];
  assert.deepEqual(moved.points[3], [340, 300]);
  assert.deepEqual(moved.labelAt, [400, 330]);
});

test('only referenced endpoints require explicit sides', t => {
  const { diagram, run } = setup(t);
  const edge = diagram.connections[0];
  edge.via[2] = [340, 390];
  edge.via[3] = [200, 390];
  delete edge.toSide;
  assert.deepEqual(run().connections[0].points, initialPoints);
  delete edge.via[0][0].offset;
  assert.deepEqual(run().connections[0].points, initialPoints, 'offset defaults to zero');
});

test('horizontal anchors track left/right ports and negative offsets', t => {
  const { diagram, run } = setup(t);
  diagram.components[0].pos = [100, 150];
  diagram.components[1].pos = [460, 310];
  Object.assign(diagram.connections[0], {
    fromSide: 'right', toSide: 'left', labelSegment: 1,
    via: [[ref('from', 40), ref('from')], [ref('from', 40), ref('to')], [ref('to', -40), ref('to')]],
  });
  assert.deepEqual(run().connections[0].points, [[300, 190], [340, 190], [340, 350], [420, 350], [460, 350]]);
});

test('missing anchor sides give actionable field diagnostics and preserve output', t => {
  const { diagram, output, run } = setup(t);
  run('deliver', ['--json']);
  const original = fs.readFileSync(output);
  delete diagram.connections[0].fromSide;
  const failed = run('deliver', ['--json'], 1);
  const diagnostic = failed.diagnostics.find(d => d.code === 'architecture/relative-via-side');
  assert.ok(diagnostic, JSON.stringify(failed.diagnostics));
  assert.equal(diagnostic.subject.path, '/connections/0/via/0/0');
  assert.equal(diagnostic.subject.connection, 'request');
  assert.ok(diagnostic.supportedFixes.some(fix => fix.includes('/connections/0/fromSide')));
  assert.deepEqual(fs.readFileSync(output), original);
  diagram.connections[0].fromSide = 'bottom';
  assert.equal(run('deliver', ['--json']).ok, true, 'the suggested repair restores delivery');
});

test('unknown nodes and overflow are typed resolution failures', t => {
  const { diagram, run } = setup(t);
  diagram.connections[0].from = 'missing';
  let failed = run('validate', ['--json'], 1);
  assert.ok(failed.diagnostics.some(d => d.code === 'architecture/relative-via-endpoint' && d.evidence.nodeId === 'missing'));
  diagram.connections[0].from = 'source';
  diagram.components[0].pos = [1e308, 150];
  diagram.connections[0].via[0][0].offset = 1e308;
  failed = run('validate', ['--json'], 1);
  assert.ok(failed.diagnostics.some(d => d.code === 'architecture/relative-via-coordinate'));
});

test('schema rejects arbitrary references and conflicting coordinate representations', t => {
  const { diagram, run } = setup(t);
  for (const coordinate of [{ anchor: 'other-node' }, { anchor: 'from', offset: '40' }, { anchor: 'to', absolute: 340 }, null]) {
    diagram.connections[0].via[0][0] = coordinate;
    const failed = run('validate', ['--json'], 1);
    assert.ok(failed.diagnostics.some(d => d.code.startsWith('schema/') && d.subject.path.startsWith('/connections/0/via/0/0')));
    assert.ok(!failed.diagnostics.some(d => d.code === 'internal/unclassified'));
  }
});

test('collapsed or invalid label segments fail without silently selecting another segment', t => {
  const { diagram, run } = setup(t);
  diagram.connections[0].labelSegment = 99;
  let failed = run('validate', ['--layout-json'], 1);
  assert.ok(failed.diagnostics.some(d => d.code === 'architecture/relative-via-label-segment'));
  diagram.connections[0].labelSegment = 2;
  diagram.layout.gapY = 80;
  failed = run('validate', ['--layout-json'], 1);
  const diagnostic = failed.diagnostics.find(d => d.code === 'architecture/relative-via-label-segment');
  assert.deepEqual(diagnostic.evidence.start, [340, 270]);
  assert.deepEqual(diagnostic.evidence.end, [340, 270]);
  diagram.layout.gapY = 200;
  assert.equal(run().ok, true);
});

test('relative resolution retains endpoint-direction, obstacle and canvas checks', t => {
  const { diagram, run } = setup(t);
  const via = structuredClone(diagram.connections[0].via);
  diagram.connections[0].via[0][1].offset = -40;
  let failed = run('validate', ['--json'], 1);
  assert.ok(failed.diagnostics.some(d => d.code === 'clean-flow/endpoint-side-direction'), JSON.stringify(failed.diagnostics));
  diagram.connections[0].via = via;
  diagram.components.push({ id: 'blocker', type: 'backend', label: 'Blocker', pos: [300, 300], size: [160, 60] });
  failed = run('validate', ['--json'], 1);
  assert.match(JSON.stringify(failed), /crosses|intersects|overlaps/);
  diagram.components.pop();
  diagram.connections[0].via[1][0] = 800;
  diagram.connections[0].via[2][0] = 800;
  failed = run('validate', ['--json'], 1);
  assert.ok(failed.diagnostics.some(d => d.code === 'layout/route-out-of-bounds'));
});
