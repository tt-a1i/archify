import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-checks-'));
const checker = path.join(skillRoot, 'scripts/check-render-output.mjs');

function checkHtml(name, svgBody, profile = 'standard') {
  const htmlPath = path.join(tmp, `${name}.html`);
  fs.writeFileSync(htmlPath, `<!doctype html><html><body><svg viewBox="0 0 240 160" data-quality-profile="${profile}">${svgBody}</svg></body></html>`);
  try {
    const stdout = execFileSync('node', [checker, htmlPath], { encoding: 'utf8' });
    return { code: 0, result: JSON.parse(stdout) };
  } catch (err) {
    return { code: err.status ?? 1, result: JSON.parse(String(err.stdout || '{}')) };
  }
}

test('render output check: accepts orthogonal arrows away from legend', () => {
  const { code, result } = checkHtml('clean', `
    <path d="M 20 20 L 120 20 L 120 60" class="a-default" stroke-width="1.4" marker-end="url(#arrowhead)"/>
    <!-- Legend -->
    <text x="40" y="120" class="t-primary" font-size="10">Legend</text>
    <rect x="40" y="132" width="14" height="9" class="c-backend"/>
    <text x="60" y="140" class="t-muted" font-size="7">Backend</text>
  `);
  assert.equal(code, 0);
  assert.equal(result.ok, true);
});

test('render output check: rejects two-point diagonal arrows', () => {
  const { code, result } = checkHtml('diagonal', `
    <path d="M 20 20 L 120 80" class="a-default" stroke-width="1.4" marker-end="url(#arrowhead)"/>
    <!-- Legend -->
    <text x="40" y="120" class="t-primary" font-size="10">Legend</text>
  `);
  assert.notEqual(code, 0);
  const check = result.checks.find((item) => item.name === 'orthogonal_arrows');
  assert.equal(check.ok, false);
  assert.match(check.details[0], /path 1/);
});

test('render output check: rejects arrows crossing legend text', () => {
  const { code, result } = checkHtml('legend-crossing', `
    <path d="M 20 112 L 180 112" class="a-dashed" stroke-width="1.4" marker-end="url(#arrowhead-dashed)"/>
    <!-- Legend -->
    <text x="40" y="120" class="t-primary" font-size="10">Legend</text>
    <rect x="40" y="132" width="14" height="9" class="c-backend"/>
    <text x="60" y="140" class="t-muted" font-size="7">Backend</text>
  `);
  assert.notEqual(code, 0);
  const check = result.checks.find((item) => item.name === 'legend_clearance');
  assert.equal(check.ok, false);
  assert.match(check.details[0], /Legend/);
});

test('render output check: ignores unmarked sequence lifelines near legend', () => {
  const { code, result } = checkHtml('lifeline-near-legend', `
    <path d="M 60 20 L 60 126" class="a-default" stroke-width="0.8" stroke-dasharray="3,7"/>
    <!-- Legend -->
    <text x="40" y="120" class="t-primary" font-size="10">Legend</text>
    <path d="M 120 136 L 154 136" class="a-default" stroke-width="1.4" stroke-dasharray="3,5" marker-end="url(#arrowhead)"/>
    <text x="163" y="139" class="t-muted" font-size="8">return</text>
  `);
  assert.equal(code, 0);
  assert.equal(result.ok, true);
});

test('render output check: standard records a proper X as a composition warning', () => {
  const { code, result } = checkHtml('standard-crossing', `
    <path data-edge-from="a" data-edge-to="b" d="M 20 60 L 200 60" class="a-default" marker-end="url(#arrowhead)"/>
    <path data-edge-from="c" data-edge-to="d" d="M 103 20 L 103 120" class="a-dashed" marker-end="url(#arrowhead-dashed)"/>
  `);
  assert.equal(code, 0);
  assert.equal(result.composition.profile, 'standard');
  assert.deepEqual(result.composition.summary, { errors: 0, warnings: 1 });
  assert.equal(result.composition.metrics.properCrossings, 1);
  assert.equal(result.composition.issues[0].code, 'composition/proper-crossing');
  assert.equal(result.composition.issues[0].severity, 'warning');
});

test('render output check: showcase rejects a proper X with semantic identities', () => {
  const { code, result } = checkHtml('showcase-crossing', `
    <path data-edge-id="left" data-edge-from="a" data-edge-to="b" d="M 20 60 L 200 60" class="a-default" marker-end="url(#arrowhead)"/>
    <path data-edge-id="right" data-edge-from="c" data-edge-to="d" d="M 100 20 L 100 120" class="a-dashed" marker-end="url(#arrowhead-dashed)"/>
  `, 'showcase');
  assert.notEqual(code, 0);
  const check = result.checks.find((item) => item.name === 'relationship_crossings');
  assert.equal(check.ok, false);
  assert.match(check.details[0], /\[composition\/proper-crossing\] showcase/);
  assert.match(check.details[0], /relationship id "left"/);
  assert.deepEqual(result.composition.summary, { errors: 1, warnings: 0 });
});

test('render output check: shared endpoints, endpoint touches, and collinear corridors pass showcase', () => {
  const { code, result } = checkHtml('showcase-exemptions', `
    <path data-edge-from="a" data-edge-to="b" d="M 20 60 L 200 60" class="a-default" marker-end="url(#arrowhead)"/>
    <path data-edge-from="a" data-edge-to="c" d="M 100 20 L 100 120" class="a-dashed" marker-end="url(#arrowhead-dashed)"/>
    <path data-edge-from="d" data-edge-to="e" d="M 20 100 L 100 100" class="a-default" marker-end="url(#arrowhead)"/>
    <path data-edge-from="f" data-edge-to="g" d="M 100 100 L 100 140" class="a-default" marker-end="url(#arrowhead)"/>
    <path data-edge-from="h" data-edge-to="i" d="M 40 150 L 160 150" class="a-default" marker-end="url(#arrowhead)"/>
    <path data-edge-from="j" data-edge-to="k" d="M 80 150 L 180 150" class="a-dashed" marker-end="url(#arrowhead-dashed)"/>
  `, 'showcase');
  assert.equal(code, 0);
  assert.equal(result.composition.metrics.properCrossings, 0);
});

test('render output check: visible quadratic crossing is caught in showcase', () => {
  const { code, result } = checkHtml('showcase-quadratic-crossing', `
    <path data-edge-from="a" data-edge-to="b" d="M 20 90 Q 100 10 180 90" class="a-default" marker-end="url(#arrowhead)"/>
    <path data-edge-from="c" data-edge-to="d" d="M 103 20 L 103 120" class="a-dashed" marker-end="url(#arrowhead-dashed)"/>
  `, 'showcase');
  assert.notEqual(code, 0);
  assert.equal(result.composition.metrics.properCrossings, 1);
  assert.equal(result.composition.status, 'fail');
});

test('render output check: container border runs fail both profiles with frame identity', () => {
  for (const profile of ['standard', 'showcase']) {
    const { code, result } = checkHtml(`border-run-${profile}`, `
      <rect data-composition-frame-kind="stage" data-composition-frame-id="sources" x="40" y="40" width="160" height="80" rx="10"/>
      <path data-edge-id="events" data-edge-from="web" data-edge-to="edge" data-composition-points="60,40;150,40" d="M 60 40 L 150 40" class="a-default" marker-end="url(#arrowhead)"/>
    `, profile);
    assert.notEqual(code, 0);
    const check = result.checks.find((item) => item.name === 'container_border_runs');
    assert.equal(check.ok, false);
    assert.match(check.details[0], /\[composition\/container-border-run\].*relationship id "events"/);
    assert.match(check.details[0], /stage "sources" top border for 90px/);
    assert.equal(result.composition.summary.errors, 1);
    assert.equal(result.composition.metrics.containerBorderRuns, 1);
    assert.equal(result.composition.issues[0].code, 'composition/container-border-run');
  }
});

test('render output check: perpendicular crossings, rounded-corner touches, and tangent Q curves pass', () => {
  const { code, result } = checkHtml('border-run-exemptions', `
    <rect data-composition-frame-kind="group" data-composition-frame-id="safe" x="40" y="40" width="160" height="80" rx="10"/>
    <path data-edge-from="a" data-edge-to="b" d="M 100 10 L 100 80" class="a-default" marker-end="url(#arrowhead)"/>
    <path data-edge-from="c" data-edge-to="d" d="M 40 40 L 49 40" class="a-default" marker-end="url(#arrowhead)"/>
    <path data-edge-from="e" data-edge-to="f" d="M 20 70 Q 40 40 60 40" class="a-default" marker-end="url(#arrowhead)"/>
  `, 'showcase');
  assert.equal(code, 0);
  assert.equal(result.composition.metrics.containerBorderRuns, 0);
});

test('render output check: a fully collinear quadratic primitive is a border run', () => {
  const { code, result } = checkHtml('border-run-collinear-q', `
    <rect data-composition-frame-kind="segment" data-composition-frame-id="retry" x="40" y="40" width="160" height="80" rx="10"/>
    <path data-edge-from="a" data-edge-to="b" d="M 60 40 Q 100 40 140 40" class="a-default" marker-end="url(#arrowhead)"/>
  `);
  assert.notEqual(code, 0);
  assert.equal(result.composition.metrics.containerBorderRuns, 1);
});

test('render output check: composition receipt records neutral normalized route metrics', () => {
  const { code, result } = checkHtml('route-metrics', `
    <path data-edge-from="a" data-edge-to="b" data-composition-points="0,20;10,20;30,20;30,28;50,28;50,50" d="M 0 20 L 30 20 L 30 28 L 50 28 L 50 50" class="a-default" marker-end="url(#arrowhead)"/>
  `);
  assert.equal(code, 0);
  assert.equal(result.composition.metrics.maxBends, 3);
  assert.equal(result.composition.metrics.routesOverSuggestedBends, 1);
  assert.equal(result.composition.metrics.minSegmentPx, 8);
  assert.equal(result.composition.metrics.shortSegmentCount, 1);
  assert.equal(result.composition.metrics.shortInteriorSegmentCount, 1);
  assert.equal(result.composition.metrics.shortEndpointSegmentCount, 0);
  assert.equal(result.composition.metrics.microSegmentCount, 0);
  assert.deepEqual(result.composition.suggestedLimits, { bendsPerRelationship: 2, stretch: 1.35, segmentPx: 16, microSegmentPx: 8 });
});

test('render output check: endpoint stubs from 8px pass while cramped interior turns are profile-aware', () => {
  const clean = checkHtml('endpoint-stubs', `
    <path data-edge-id="lane-hop" data-edge-from="a" data-edge-to="b" data-composition-points="0,20;13,20;13,60;80,60;80,73" d="M 0 20 L 13 20 L 13 60 L 80 60 L 80 73" class="a-default" marker-end="url(#arrowhead)"/>
  `, 'showcase');
  assert.equal(clean.code, 0);
  assert.equal(clean.result.composition.metrics.shortEndpointSegmentCount, 2);
  assert.equal(clean.result.composition.metrics.shortInteriorSegmentCount, 0);

  const standard = checkHtml('short-turn-standard', `
    <path data-edge-id="tight" data-edge-from="a" data-edge-to="b" data-composition-points="0,20;24,20;24,29;80,29" d="M 0 20 L 24 20 L 24 29 L 80 29" class="a-default" marker-end="url(#arrowhead)"/>
  `, 'standard');
  assert.equal(standard.code, 0);
  assert.deepEqual(standard.result.composition.summary, { errors: 0, warnings: 1 });
  assert.equal(standard.result.composition.issues[0].code, 'composition/short-interior-segment');
  assert.equal(standard.result.checks.find((item) => item.name === 'route_rhythm').ok, true);

  const showcase = checkHtml('short-turn-showcase', `
    <path data-edge-id="tight" data-edge-from="a" data-edge-to="b" data-composition-points="0,20;24,20;24,29;80,29" d="M 0 20 L 24 20 L 24 29 L 80 29" class="a-default" marker-end="url(#arrowhead)"/>
  `, 'showcase');
  assert.notEqual(showcase.code, 0);
  assert.deepEqual(showcase.result.composition.summary, { errors: 1, warnings: 0 });
  const rhythm = showcase.result.checks.find((item) => item.name === 'route_rhythm');
  assert.equal(rhythm.ok, false);
  assert.match(rhythm.details[0], /\[composition\/short-interior-segment\] showcase relationship id "tight"/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
