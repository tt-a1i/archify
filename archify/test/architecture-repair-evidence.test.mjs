import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/archify.mjs');
const renderer = path.join(root, 'renderers/architecture/render-architecture.mjs');
function setup(t, positions, viewBox = [600, 420]) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-repair-evidence-'));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  const input = path.join(cwd, 'source.json');
  const diagram = {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Backend', output: 'diagram.html', quality_profile: 'standard', viewBox },
    components: positions.map((pos, index) => ({ id: `n${index}`, type: 'backend', label: `Node ${index}`, pos, size: [120, 60] })),
    boundaries: [{ kind: 'region', label: 'Backend', wraps: positions.map((_, i) => `n${i}`) }],
  };
  fs.writeFileSync(input, JSON.stringify(diagram));
  return { cwd, input, diagram };
}
function run(args, cwd) {
  return spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
}
function validate(input, cwd, flags = []) {
  const result = run([cli, 'validate', 'architecture', input, '--json', ...flags], cwd);
  assert.equal(result.stderr, '', result.stderr);
  return { result, receipt: JSON.parse(result.stdout) };
}

test('layout route coordinates can be reused for an orthogonal repair at fractional ports', t => {
  const { cwd, input, diagram } = setup(t, [[80, 100], [340, 100]]);
  delete diagram.boundaries;
  diagram.components.forEach(c => { c.size = [121, 60]; });
  diagram.connections = [{ from: 'n0', to: 'n1', fromSide: 'top', toSide: 'top' }];
  fs.writeFileSync(input, JSON.stringify(diagram));
  const measured = validate(input, cwd, ['--layout-json']);
  assert.equal(measured.result.status, 0, measured.result.stdout);
  const points = measured.receipt.connections[0].points;
  diagram.connections[0].via = [[points[0][0], 60], [points.at(-1)[0], 60]];
  fs.writeFileSync(input, JSON.stringify(diagram));
  const repaired = validate(input, cwd, ['--layout-json']);
  assert.equal(repaired.result.status, 0, repaired.result.stdout);
  assert.equal(points[0][0], 140.5);
  assert.equal(points.at(-1)[0], 400.5);
});

test('delivered Architecture review names a node blocking the direct main corridor', t => {
  const { cwd, input, diagram } = setup(t, [[50, 100], [250, 100], [450, 100]], [680, 320]);
  diagram.connections = [{ from: 'n0', to: 'n2', fromSide: 'right', toSide: 'left' }];
  fs.writeFileSync(input, JSON.stringify(diagram));
  const output = path.join(cwd, 'diagram.html');
  const rendered = run([cli, 'render', 'architecture', input, output], cwd);
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
  const checked = run([path.join(root, 'scripts/check-render-output.mjs'), output], cwd);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const report = JSON.parse(checked.stdout);
  assert.deepEqual(report.composition.routeReview.detours[0].directCorridorBlockers, [{
    id: 'n1', label: 'Node 1', box: [250, 100, 120, 60],
  }]);
  assert.equal(report.composition.summary.errors, 0, 'an obstacle-aware route remains legal');
});

for (const [side, positions, expected, growsCanvas] of [
  ['left', [[20, 70], [80, 240]], 10, false],
  ['top', [[80, 20], [150, 240]], 10, false],
  ['right', [[480, 70], [440, 240]], 30, true],
  ['bottom', [[80, 70], [150, 350]], 10, true],
]) {
  test(`boundary ${side} overflow gives measured side, members and applicable fixes`, t => {
    const { cwd, input } = setup(t, positions);
    const { result, receipt } = validate(input, cwd);
    assert.equal(result.status, 1);
    const entries = receipt.diagnostics.filter(d => d.code === 'layout/boundary-out-of-bounds');
    assert.equal(entries.length, 1);
    const diagnostic = entries[0];
    assert.deepEqual(diagnostic.subject.boundary.wraps, ['n0', 'n1']);
    assert.equal(diagnostic.evidence.overflow[side], expected);
    assert.deepEqual(diagnostic.evidence.members.map(m => m.id), ['n0', 'n1']);
    assert.deepEqual(diagnostic.evidence.viewBox, [600, 420]);
    assert.equal(diagnostic.supportedFixes.some(f => f.startsWith('increase meta.viewBox')), growsCanvas);
    if (!growsCanvas) assert.match(diagnostic.supportedFixes.join(' '), /enlarging meta.viewBox cannot fix left\/top/);
    assert.equal(receipt.diagnostics.filter(d => d.message === diagnostic.message).length, 1);
  });
}

test('enlarging the canvas cannot repair top overflow; moving members preserves a valid multi-row boundary', t => {
  const { cwd, input, diagram } = setup(t, [[80, 20], [150, 240]]);
  diagram.meta.viewBox = [1200, 800];
  fs.writeFileSync(input, JSON.stringify(diagram));
  assert.equal(validate(input, cwd).result.status, 1);
  diagram.meta.viewBox = [600, 420];
  diagram.components.forEach(c => { c.pos[1] += 30; });
  fs.writeFileSync(input, JSON.stringify(diagram));
  const { result, receipt } = validate(input, cwd);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(receipt.ok, true);
  assert.deepEqual(diagram.boundaries[0].wraps, ['n0', 'n1']);
});

test('rejected layout JSON retains geometry and diagnostics without changing source or trusted output', t => {
  const { cwd, input } = setup(t, [[80, 20], [150, 240]]);
  const before = fs.readFileSync(input);
  const output = path.join(cwd, 'trusted.html');
  fs.writeFileSync(output, 'trusted artifact');
  for (const args of [
    [cli, 'validate', 'architecture', input, '--layout-json'],
    [cli, 'validate', 'architecture', input, '--layout-json', '--json'],
    [renderer, input, output, '--layout-json'],
    [cli, 'inspect', 'architecture', input],
  ]) {
    const result = run(args, cwd);
    assert.equal(result.status, 1, result.stderr);
    assert.equal(result.stderr, '');
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.contract, 'archify-architecture-layout-v1');
    assert.equal(receipt.components.length, 2);
    assert.equal(receipt.boundaries[0].y, -10);
    assert.deepEqual(receipt.connections, []);
    assert.ok(receipt.diagnostics.some(d => d.code === 'layout/boundary-out-of-bounds'));
    assert.deepEqual(fs.readFileSync(input), before);
    assert.equal(fs.readFileSync(output, 'utf8'), 'trusted artifact');
    assert.deepEqual(fs.readdirSync(cwd).sort(), ['source.json', 'trusted.html']);
  }
  const delivery = run([cli, 'deliver', 'architecture', input, output, '--json'], cwd);
  assert.equal(delivery.status, 1);
  assert.equal(fs.readFileSync(output, 'utf8'), 'trusted artifact');
});

test('direct renderer text explains the boundary repair and retains non-zero exit', t => {
  const { cwd, input } = setup(t, [[80, 20], [150, 240]]);
  const result = run([renderer, input, path.join(cwd, 'out.html')], cwd);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /layout\/boundary-out-of-bounds/);
  assert.match(result.stderr, /top by 10px/);
  assert.match(result.stderr, /enlarging meta.viewBox cannot fix left\/top overflow/);
  assert.equal(fs.existsSync(path.join(cwd, 'out.html')), false);
});

test('successful layout keeps existing fields; malformed input never masquerades as computed layout', t => {
  const { cwd, input } = setup(t, [[80, 70], [150, 240]]);
  const good = validate(input, cwd, ['--layout-json']);
  assert.equal(good.result.status, 0);
  assert.equal(good.receipt.ok, true);
  assert.equal(good.receipt.components.length, 2);
  assert.equal(good.receipt.contract, undefined);
  fs.writeFileSync(input, '{"components":');
  const invalid = validate(input, cwd, ['--layout-json']);
  assert.equal(invalid.result.status, 1);
  assert.equal(invalid.receipt.components, undefined);
  assert.ok(invalid.receipt.diagnostics.some(d => d.code === 'input/json-parse'));
});

function outerRoute(t) {
  const { cwd, input, diagram } = setup(t, [[80, 70], [350, 70]]);
  delete diagram.meta.viewBox;
  diagram.meta.quality_profile = 'showcase';
  delete diagram.boundaries;
  diagram.connections = [{ id: 'outer', from: 'n0', to: 'n1', fromSide: 'bottom', toSide: 'bottom', via: [[140, 300], [410, 300]] }];
  fs.writeFileSync(input, JSON.stringify(diagram));
  return { cwd, input, diagram };
}

test('auto canvas includes an outer route even when no label reaches its corridor', t => {
  const { cwd, input, diagram } = outerRoute(t);
  const { result, receipt } = validate(input, cwd, ['--layout-json']);
  assert.equal(result.status, 0, result.stdout);
  assert.ok(receipt.viewBox[1] > 300, JSON.stringify(receipt));
  assert.deepEqual(receipt.connections[0].points, [[140, 130], [140, 300], [410, 300], [410, 130]]);
  assert.equal(validate(input, cwd).result.status, 0);
  diagram.components[1].pos = [350, 240];
  diagram.connections[0] = { id: 'outer', from: 'n0', to: 'n1', fromSide: 'right', toSide: 'right', via: [[800, 100], [800, 270]] };
  fs.writeFileSync(input, JSON.stringify(diagram));
  const right = validate(input, cwd, ['--layout-json']);
  assert.equal(right.result.status, 0, right.result.stdout);
  assert.ok(right.receipt.viewBox[0] > 800);
  assert.equal(validate(input, cwd).result.status, 0);
});

test('showcase reports clipped explicit routes without rewriting their geometry or authored canvas', t => {
  const { cwd, input, diagram } = outerRoute(t);
  diagram.meta.viewBox = [600, 260];
  fs.writeFileSync(input, JSON.stringify(diagram));
  const { result, receipt } = validate(input, cwd, ['--layout-json']);
  assert.equal(result.status, 1);
  const diagnosis = receipt.diagnostics.find(d => d.code === 'layout/route-out-of-bounds');
  assert.ok(diagnosis);
  assert.deepEqual(diagnosis.evidence.outsidePoints, [[140, 300], [410, 300]]);
  assert.equal(diagnosis.subject.id, 'outer');
  assert.deepEqual(receipt.viewBox, [600, 260]);
  assert.deepEqual(JSON.parse(fs.readFileSync(input)), diagram);
  // Standard retains its previous acceptance; stricter clipping diagnostics
  // belong to showcase, just like label canvas containment.
  diagram.meta.quality_profile = 'standard';
  fs.writeFileSync(input, JSON.stringify(diagram));
  assert.equal(validate(input, cwd).result.status, 0);
});

test('auto canvas does not hide a negative route by growing right or down', t => {
  const { cwd, input, diagram } = outerRoute(t);
  diagram.connections[0] = { id: 'outer', from: 'n0', to: 'n1', fromSide: 'top', toSide: 'top', via: [[140, -40], [410, -40]] };
  fs.writeFileSync(input, JSON.stringify(diagram));
  const { result, receipt } = validate(input, cwd, ['--layout-json']);
  assert.equal(result.status, 1);
  assert.ok(receipt.diagnostics.some(d => d.code === 'layout/route-out-of-bounds' && d.evidence.outsidePoints.every(([, y]) => y < 0)));
});
