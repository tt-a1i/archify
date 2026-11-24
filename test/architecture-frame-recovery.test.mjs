import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectionLabelBoxAt } from '../archify/renderers/architecture/routing.mjs';
import { frameBorderSegments, roundedPathSegments, segmentRectClearance } from '../archify/renderers/shared/geometry.mjs';
import { drawnPathRectClearance, prepareCrossingPath } from '../archify/renderers/shared/route-crossings.mjs';

const fixtures = new URL('fixtures/architecture-frame-recovery/', import.meta.url);
const cases = JSON.parse(readFileSync(new URL('cases.json', fixtures), 'utf8'));
const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));

for (const [name, { file, passes, diagnostic, round5Svg, round8Svg, round11Svg, cleanArtifact, routeLengthLimits, straightConnections }] of Object.entries(cases)) {
  test(`frame recovery preserves the validated layout for ${name}`, t => {
    const scratch = mkdtempSync(join(tmpdir(), 'archify-fixed-canvas-'));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    const output = join(scratch, 'chart.html');
    const env = { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' };
    delete env.ARCHIFY_QUALITY_PROFILE;
    const result = spawnSync(process.execPath, [cli, 'render', 'architecture', fileURLToPath(new URL(file, fixtures)), output], {
      encoding: 'utf8', env,
    });
    const failure = result.stdout + result.stderr;
    assert.equal(result.status === 0, passes, failure);
    if (diagnostic) assert.ok(failure.includes(`[${diagnostic}]`), failure);
    const expectedSvg = round5Svg ?? round8Svg ?? round11Svg;
    if (expectedSvg) {
      // Fixed-canvas compatibility includes routes, labels and frames.
      const svg = readFileSync(output, 'utf8').match(/<svg\b[\s\S]*?<\/svg>/g)
        .reduce((longest, match) => match.length > longest.length ? match : longest);
      assert.equal(createHash('sha256').update(svg).digest('hex'), expectedSvg);
    }
    if (cleanArtifact || routeLengthLimits) {
      const checked = spawnSync(process.execPath, [cli, 'check', output, '--json'], { encoding: 'utf8', env });
      assert.equal(checked.status, 0, checked.stdout + checked.stderr);
      assert.deepEqual(JSON.parse(checked.stdout).composition.issues, []);
    }
    if (routeLengthLimits || straightConnections) {
      const validated = spawnSync(process.execPath,
        [cli, 'validate', 'architecture', fileURLToPath(new URL(file, fixtures)), '--layout-json'], { encoding: 'utf8', env });
      assert.equal(validated.status, 0, validated.stdout + validated.stderr);
      const { connections } = JSON.parse(validated.stdout);
      for (const [from, to] of straightConnections ?? []) {
        const { points } = connections.find(connection => connection.from === from && connection.to === to);
        assert.equal(points.length, 2, `${from} to ${to} should take its clear straight corridor`);
      }
      for (const [label, maximum] of Object.entries(routeLengthLimits ?? {})) {
        const { points } = connections.find(connection => connection.label === label);
        const length = points.slice(1).reduce((sum, [x, y], index) =>
          sum + Math.abs(x - points[index][0]) + Math.abs(y - points[index][1]), 0);
        assert.ok(length <= maximum, `${label} takes ${length}px (maximum ${maximum}px)`);
      }
    }
  });
}

for (const [name, expectedLengths] of [
  ['fixed-canvas-reciprocal-detour', [80, 92, 92]],
  ['fixed-canvas-new-arrowhead-mask', [60]],
]) {
  test(`fixed-canvas placement preserves the earlier route quality in ${name}`, t => {
    const fixture = fileURLToPath(new URL(`review7-${name}.json`, fixtures));
    const scratch = mkdtempSync(join(tmpdir(), 'archify-fixed-quality-'));
    t.after(() => rmSync(scratch, { recursive: true, force: true }));
    const output = join(scratch, 'chart.html');
    const render = spawnSync(process.execPath, [cli, 'render', 'architecture', fixture, output], { encoding: 'utf8' });
    assert.equal(render.status, 0, render.stdout + render.stderr);
    const checked = spawnSync(process.execPath, [cli, 'check', output, '--json'], { encoding: 'utf8' });
    const receipt = JSON.parse(checked.stdout);
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    assert.ok(!receipt.composition.issues.some(issue => issue.code === 'composition/label-arrowhead-mask'));
    const diagnostic = spawnSync(process.execPath, [cli, 'validate', 'architecture', fixture, '--layout-json'], { encoding: 'utf8' });
    const { connections } = JSON.parse(diagnostic.stdout);
    const lengths = connections.map(({ points }) => points.slice(1).reduce((length, [x, y], index) =>
      length + Math.abs(x - points[index][0]) + Math.abs(y - points[index][1]), 0));
    assert.ok(lengths.every((length, index) => length <= expectedLengths[index]), JSON.stringify(lengths));
  });
}

test('a fixed-canvas label clears both the frame border and the routes', () => {
  const fixture = new URL('label-fixed-074-frame-16.json', fixtures);
  const input = JSON.parse(readFileSync(fixture, 'utf8'));
  const result = spawnSync(process.execPath,
    [cli, 'validate', 'architecture', fileURLToPath(fixture), '--quality', 'standard', '--layout-json'],
    { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const { boundaries, connections } = JSON.parse(result.stdout);
  const index = connections.findIndex(({ label }) => label === 'Fetch data 5');
  const label = connectionLabelBoxAt(input.connections[index], connections[index].labelAt);
  for (const frame of boundaries) {
    for (const edge of frameBorderSegments({ ...frame, radius: 12 })) {
      assert.ok(segmentRectClearance(edge, label) >= 0.5, `label covers the frame's ${edge.side} border`);
    }
  }
  for (const [index, { points }] of connections.entries()) {
    const { width, variant } = input.connections[index];
    const stroke = width || (variant === 'emphasis' ? 1.8 : 1.5);
    const path = prepareCrossingPath(roundedPathSegments(points, 8));
    assert.ok(drawnPathRectClearance(path, label) >= stroke / 2, `label covers shaft ${index}`);
  }
});

test('a route can cross the worker frame while leaving its border and title clear', t => {
  const fixture = new URL('../architecture-route-regressions/label-fixed-125-frame-29.json', fixtures);
  const result = spawnSync(process.execPath,
    [cli, 'validate', 'architecture', fileURLToPath(fixture), '--quality', 'showcase', '--layout-json'],
    { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const { boundaries, connections } = JSON.parse(result.stdout);
  const { points } = connections.find(({ from, to }) => from === 'n4' && to === 'n1');
  for (const { start, end, side } of boundaries.flatMap(frame => frameBorderSegments({ ...frame, radius: 12 }))) {
    const axis = start[0] === end[0] ? 1 : 0;
    const across = 1 - axis;
    for (const [index, b] of points.slice(1).entries()) {
      const a = points[index];
      if (a[across] !== b[across]) continue;
      const overlap = Math.min(Math.max(a[axis], b[axis]), Math.max(start[axis], end[axis]))
        - Math.max(Math.min(a[axis], b[axis]), Math.min(start[axis], end[axis]));
      if (overlap >= 8) assert.ok(Math.abs(a[across] - start[across]) >= 8, `route runs along the ${side} border`);
    }
  }
  const scratch = mkdtempSync(join(tmpdir(), 'archify-frame-title-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const output = join(scratch, 'chart.html');
  const rendered = spawnSync(process.execPath,
    [cli, 'render', 'architecture', fileURLToPath(fixture), output, '--quality', 'showcase'], { encoding: 'utf8' });
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
  const html = readFileSync(output, 'utf8');
  const mask = html.match(/<rect data-graph-role="structural-frame-label-mask" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/);
  assert.ok(mask, 'expected a drawn frame title');
  const [x, y, width, height] = mask.slice(1).map(Number);
  const path = prepareCrossingPath(roundedPathSegments(points, 8));
  assert.ok(drawnPathRectClearance(path, { x, y, width, height }) >= 0.75, 'frame title covers the route');
});

test('facing ports eliminate the short dogleg between staggered cards', () => {
  const fixture = new URL('label-fixed-074-frame-16.json', fixtures);
  const result = spawnSync(process.execPath,
    [cli, 'validate', 'architecture', fileURLToPath(fixture), '--quality', 'standard', '--layout-json'],
    { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const { connections } = JSON.parse(result.stdout);
  const { points } = connections.find(({ from, to }) => from === 'n1' && to === 'n2');
  assert.equal(points.length, 2, 'the path should have no short Z between the two cards');
  assert.equal(points[0][1], points[1][1], 'the ports should face across the clear horizontal gap');
});
