import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSvgPath } from '../archify/renderers/shared/svg-path-analysis.mjs';
import { prepareCrossingPath, visibleCrossings } from '../archify/renderers/shared/route-crossings.mjs';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
const spec = name => fileURLToPath(new URL(`fixtures/architecture-route-regressions/${name}.json`, import.meta.url));
const path = d => prepareCrossingPath(analyzeSvgPath(d).subpaths[0].commands);
const run = (args, overrides = {}) => spawnSync(process.execPath, [cli, ...args], {
  encoding: 'utf8', env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1', ...overrides },
});

function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'archify-visible-crossings-'));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  return dir;
}

const reviewedPaths = {
  // Chromium's two centerlines touch at (200, 200) without changing sides.
  tangent: [
    'M 198.125 199.875 Q 206.125 199.875 206.125 207.875',
    'M 198.828125 199.921875 Q 203.828125 199.921875 203.828125 204.921875',
  ],
  // At x = 199.99, 200, 200.01 the side ordering is +, -, +.
  'double crossing': [
    'M 192.903168 196.472832 Q 200.903168 196.472832 200.903168 204.472832',
    'M 199.112896 199.559024 Q 200.112896 199.559024 200.112896 200.559024',
  ],
};

for (const [name, paths] of Object.entries(reviewedPaths)) {
  test(`visible quadratic ${name} agrees with Chromium and the architecture checker`, t => {
    const isCrossing = name === 'double crossing';
    const [a, b] = paths.map(path);
    const hits = visibleCrossings(a, b);
    assert.equal(hits.length, isCrossing ? 2 : 0, JSON.stringify(hits));
    assert.equal(visibleCrossings(b, a).length, hits.length);
    const output = join(scratch(t), 'chart.html');
    const arrows = paths.map((d, i) =>
      `<path class="a-default" data-edge-from="a${i}" data-edge-to="b${i}" d="${d}" marker-end="url(#arrowhead)"/>`);
    writeFileSync(output, `<!doctype html><html><body><svg viewBox="0 0 420 280" data-diagram-type="architecture" data-quality-profile="showcase">${arrows.join('')}</svg></body></html>`);
    const result = run(['check', output, '--json']);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.composition.metrics.properCrossings, Number(isCrossing));
    assert.equal(result.status, Number(isCrossing), result.stdout);
    if (isCrossing) {
      const capped = run(['check', output, '--json'], { ARCHIFY_CHECK_MAX_CROSSING_SEGMENT_PAIR_CHECKS: '4' });
      assert.match(capped.stdout, /composition\/crossing-analysis-budget/);
    }
  });
}

test('a common tangent can cross at a command join only when the branches change sides', () => {
  const lineIntoCorner = path('M -10 0 L 0 0 Q 5 0 10 10');
  const differentSides = path('M -10 1 Q 0 -1 10 1');
  const sameSide = path('M -10 -1 Q 0 1 10 -1');
  assert.deepEqual(visibleCrossings(lineIntoCorner, differentSides).map(({ point }) => point), [[0, 0]]);
  assert.deepEqual(visibleCrossings(lineIntoCorner, sameSide), []);
});

test('the renderer and checker accept a rounded shared-origin near miss', t => {
  const output = join(scratch(t), 'chart.html');
  const render = run(['render', 'architecture', spec('shared-origin-rounded-near-miss'), output]);
  assert.equal(render.status, 0, render.stdout + render.stderr);
  const checked = run(['check', output, '--json']);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.equal(JSON.parse(checked.stdout).composition.metrics.properCrossings, 0);
});

for (const [name, point] of [
  ['authored-straight-waypoint-control', [300, 130]],
  ['B-straight-waypoint-crossing', [326, 162]],
  ['B-straight-waypoint-crossing-control', [326, 162]],
]) {
  test(`showcase reports the drawn crossing for ${name}`, () => {
    const result = run(['validate', 'architecture', spec(name), '--layout-json']);
    assert.equal(result.status, 1);
    const receipt = JSON.parse(result.stdout);
    assert.deepEqual(receipt.diagnostics.find(({ code }) => code === 'composition/proper-crossing')?.evidence.point, point);
  });
}

test('collinear waypoint metadata cannot conceal an SVG crossing', t => {
  const html = join(scratch(t), 'chart.html');
  writeFileSync(html, `<!doctype html><html><body><svg viewBox="0 0 600 320" data-diagram-type="architecture" data-quality-profile="showcase">
    <path class="a-default" data-edge-from="a" data-edge-to="b" data-composition-points="130,130;300,130;450,130"
      d="M 130 130 L 292 130 Q 300 130 308 130 L 450 130" marker-end="url(#arrowhead)"/>
    <path class="a-default" data-edge-from="c" data-edge-to="d"
      d="M 300 60 L 300 200" marker-end="url(#arrowhead)"/>
    </svg></body></html>`);
  const result = run(['check', html, '--json']);
  assert.equal(result.status, 1);
  const { composition } = JSON.parse(result.stdout);
  assert.equal(composition.metrics.properCrossings, 1);
  assert.deepEqual(composition.issues.find(issue => issue.code === 'composition/proper-crossing').point, [300, 130]);
});

test('a rounded crossing diagnostic cites the original polyline segment', () => {
  const result = run(['validate', 'architecture', spec('rounded-crossing-segment-index'), '--layout-json']);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  const { evidence } = report.diagnostics.find(({ code }) => code === 'composition/proper-crossing');
  assert.deepEqual(evidence.point, [298, 222]);
  assert.equal(evidence.segmentIndex, 3);
  assert.equal(evidence.otherSegmentIndex, 0);
});


test('the artifact checker names the route competing for a relationship label', t => {
  const html = join(scratch(t), 'chart.html');
  writeFileSync(html, `<!doctype html><html><body><svg viewBox="0 0 400 250" data-diagram-type="architecture">
    <path class="a-default" data-edge-from="a" data-edge-to="b" data-edge-key="1"
      d="M 40 70 L 340 70" marker-end="url(#arrowhead)"/>
    <path class="a-default" data-edge-from="b" data-edge-to="a" data-edge-key="2"
      d="M 340 125 L 40 125" marker-end="url(#arrowhead)"/>
    <g data-edge-from="a" data-edge-to="b" data-edge-key="1" data-edge-label="Request">
      <rect class="c-mask" x="140" y="108" width="80" height="10"/>
      <text x="180" y="115">Request</text>
    </g></svg></body></html>`);
  const checked = run(['check', html, '--json']);
  assert.equal(checked.status, 0, checked.stdout);
  const issue = JSON.parse(checked.stdout).composition.issues.find(item => item.code === 'composition/label-route-ownership');
  assert.equal(issue.label, 'Request');
  assert.equal(issue.ownClearance, 38);
  assert.equal(issue.otherClearance, 7);
  assert.equal(issue.otherRelationship.from, 'b');
});
