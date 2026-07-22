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

test('render output check: shared endpoints and endpoint touches pass showcase', () => {
  const { code, result } = checkHtml('showcase-exemptions', `
    <path data-edge-from="a" data-edge-to="b" d="M 20 60 L 200 60" class="a-default" marker-end="url(#arrowhead)"/>
    <path data-edge-from="a" data-edge-to="c" d="M 100 20 L 100 90" class="a-dashed" marker-end="url(#arrowhead-dashed)"/>
    <path data-edge-from="d" data-edge-to="e" d="M 20 100 L 100 100" class="a-default" marker-end="url(#arrowhead)"/>
    <path data-edge-from="f" data-edge-to="g" d="M 100 100 L 100 140" class="a-default" marker-end="url(#arrowhead)"/>
  `, 'showcase');
  assert.equal(code, 0);
  assert.equal(result.composition.metrics.properCrossings, 0);
  assert.equal(result.composition.metrics.ambiguousCorridors, 0);
});

test('render output check: relationship labels cannot hide another shared-source route', () => {
  for (const profile of ['standard', 'showcase']) {
    const { code, result } = checkHtml(`label-route-${profile}`, `
      <path data-edge-key="0" data-edge-id="approved" data-edge-from="dlq" data-edge-to="replay" data-composition-points="20,60;200,60" d="M 20 60 L 200 60" class="a-default" marker-end="url(#arrowhead)"/>
      <path data-edge-key="1" data-edge-id="sample" data-edge-from="dlq" data-edge-to="ops" data-composition-points="70,55;150,55" d="M 70 55 L 150 55" class="a-dashed" marker-end="url(#arrowhead-dashed)"/>
      <g data-detail="context" data-edge-key="0" data-edge-id="approved" data-edge-from="dlq" data-edge-to="replay" data-edge-label="approved replay">
        <rect x="80" y="48" width="60" height="14" rx="3" class="c-mask"/>
        <text x="110" y="58">approved replay</text>
      </g>
    `, profile);

    assert.equal(result.composition.metrics.labelRouteClearanceIssues, 1);
    assert.equal(result.composition.metrics.minLabelRouteClearance, 0);
    const issue = result.composition.issues.find((item) => item.code === 'composition/label-route-clearance');
    assert.deepEqual(issue.labelRelationship, { id: 'approved', from: 'dlq', to: 'replay', label: 'approved replay', collectionIndex: 0, artifactIndex: 1 });
    assert.deepEqual(issue.otherRelationship, { id: 'sample', from: 'dlq', to: 'ops', label: '', collectionIndex: 1, artifactIndex: 2 });
    assert.equal(issue.segmentIndex, 0);
    assert.deepEqual(issue.labelRect, { x: 80, y: 48, width: 60, height: 14 });
    assert.equal(issue.clearance, 0);
    assert.equal(issue.intersectionLength, 60);
    assert.equal(issue.threshold, profile === 'showcase' ? 4 : 2);
    const check = result.checks.find((item) => item.name === 'label_route_clearance');
    if (profile === 'standard') {
      assert.equal(code, 0);
      assert.equal(check.ok, true);
      assert.equal(issue.severity, 'warning');
      assert.deepEqual(result.composition.summary, { errors: 0, warnings: 1 });
    } else {
      assert.notEqual(code, 0);
      assert.equal(check.ok, false);
      assert.match(check.details[0], /approved.*sample/);
      assert.match(check.details[0], /labelAt.*labelDx.*labelDy.*labelSegment/);
      assert.equal(issue.severity, 'error');
      assert.deepEqual(result.composition.summary, { errors: 1, warnings: 0 });
    }
  }
});

test('render output check: repeated endpoint messages keep their own stable owner identity', () => {
  const { code, result } = checkHtml('sequence-repeated-endpoints', `
    <g data-edge-key="0" data-edge-from="client" data-edge-to="api" data-edge-label="first request">
      <path data-composition-edge-from="client" data-composition-edge-to="api" data-composition-points="20,20;200,20" d="M 20 20 L 200 20" class="a-default" marker-end="url(#arrowhead)"/>
      <g data-detail="context"><rect x="70" y="2" width="80" height="16" class="c-mask"/></g>
    </g>
    <g data-edge-key="1" data-edge-from="client" data-edge-to="api" data-edge-label="second request">
      <path data-composition-edge-from="client" data-composition-edge-to="api" data-composition-points="20,60;200,60" d="M 20 60 L 200 60" class="a-default" marker-end="url(#arrowhead)"/>
      <g data-detail="context"><rect x="70" y="72" width="80" height="16" class="c-mask"/></g>
    </g>
    <path data-edge-key="2" data-edge-from="worker" data-edge-to="store" data-composition-points="20,80;200,80" d="M 20 80 L 200 80" class="a-dashed" marker-end="url(#arrowhead-dashed)"/>
  `, 'showcase');
  assert.notEqual(code, 0);
  const issues = result.composition.issues.filter((item) => item.code === 'composition/label-route-clearance');
  assert.equal(issues.length, 1);
  assert.equal(issues[0].label, 'second request');
  assert.equal(issues[0].labelRelationship.collectionIndex, 1);
  assert.equal(issues[0].otherRelationship.collectionIndex, 2);
});

test('render output check: duplicate fragments of the owning relationship stay exempt', () => {
  const { code, result } = checkHtml('label-owner-fragments', `
    <path data-edge-key="0" data-edge-id="approved" data-edge-from="dlq" data-edge-to="replay" data-composition-points="20,60;200,60" d="M 20 60 L 200 60" class="a-default" marker-end="url(#arrowhead)"/>
    <path data-edge-key="0" data-edge-id="approved" data-edge-from="dlq" data-edge-to="replay" data-composition-points="20,60;200,60" d="M 20 60 L 200 60" class="a-default" marker-end="url(#arrowhead)"/>
    <g data-detail="context" data-edge-key="0" data-edge-id="approved" data-edge-from="dlq" data-edge-to="replay" data-edge-label="approved replay">
      <rect x="80" y="48" width="60" height="14" rx="3" class="c-mask"/>
      <text x="110" y="58">approved replay</text>
    </g>
  `, 'showcase');
  assert.equal(code, 0);
  assert.equal(result.composition.metrics.labelRouteClearanceIssues, 0);
  assert.equal(result.composition.metrics.minLabelRouteClearance, null);
});

test('render output check: duplicate fragments of another relationship count once', () => {
  const { result } = checkHtml('label-other-fragments', `
    <path data-edge-key="0" data-edge-id="approved" data-edge-from="dlq" data-edge-to="replay" data-composition-points="20,60;200,60" d="M 20 60 L 200 60" class="a-default" marker-end="url(#arrowhead)"/>
    <path data-edge-key="1" data-edge-id="sample" data-edge-from="dlq" data-edge-to="ops" data-composition-points="70,55;150,55" d="M 70 55 L 150 55" class="a-dashed" marker-end="url(#arrowhead-dashed)"/>
    <path data-edge-key="1" data-edge-id="sample" data-edge-from="dlq" data-edge-to="ops" data-composition-points="70,55;150,55" d="M 70 55 L 150 55" class="a-dashed" marker-end="url(#arrowhead-dashed)"/>
    <g data-detail="context" data-edge-key="0" data-edge-id="approved" data-edge-from="dlq" data-edge-to="replay" data-edge-label="approved replay">
      <rect x="80" y="48" width="60" height="14" rx="3" class="c-mask"/>
      <text x="110" y="58">approved replay</text>
    </g>
  `, 'showcase');
  assert.equal(result.composition.metrics.labelRouteClearanceIssues, 1);
});

test('render output check: label-route thresholds include exact 2px and 4px boundaries', () => {
  const body = (otherY) => `
    <path data-edge-key="0" data-edge-from="a" data-edge-to="b" data-composition-points="20,70;200,70" d="M 20 70 L 200 70" class="a-default" marker-end="url(#arrowhead)"/>
    <path data-edge-key="1" data-edge-from="c" data-edge-to="d" data-composition-points="70,${otherY};150,${otherY}" d="M 70 ${otherY} L 150 ${otherY}" class="a-dashed" marker-end="url(#arrowhead-dashed)"/>
    <g data-detail="context" data-edge-key="0" data-edge-from="a" data-edge-to="b" data-edge-label="handoff">
      <rect x="80" y="48" width="60" height="14" rx="3" class="c-mask"/>
      <text x="110" y="58">handoff</text>
    </g>
  `;
  const standardAtTwo = checkHtml('label-standard-two', body(64), 'standard');
  assert.equal(standardAtTwo.code, 0);
  assert.equal(standardAtTwo.result.composition.metrics.labelRouteClearanceIssues, 0);
  assert.equal(standardAtTwo.result.composition.metrics.minLabelRouteClearance, 2);

  const standardBelowTwo = checkHtml('label-standard-one-nine', body(63.9), 'standard');
  assert.equal(standardBelowTwo.code, 0);
  assert.equal(standardBelowTwo.result.composition.metrics.labelRouteClearanceIssues, 1);
  assert.equal(standardBelowTwo.result.composition.summary.warnings, 1);

  const showcaseAtTwo = checkHtml('label-showcase-two', body(64), 'showcase');
  assert.notEqual(showcaseAtTwo.code, 0);
  assert.equal(showcaseAtTwo.result.composition.metrics.labelRouteClearanceIssues, 1);
  assert.equal(showcaseAtTwo.result.composition.issues.find((item) => item.code === 'composition/label-route-clearance').threshold, 4);

  const showcaseAtFour = checkHtml('label-showcase-four', body(66), 'showcase');
  assert.equal(showcaseAtFour.code, 0);
  assert.equal(showcaseAtFour.result.composition.metrics.labelRouteClearanceIssues, 0);
  assert.equal(showcaseAtFour.result.composition.metrics.minLabelRouteClearance, 4);

  const showcaseBelowFour = checkHtml('label-showcase-three-nine', body(65.9), 'showcase');
  assert.notEqual(showcaseBelowFour.code, 0);
  assert.equal(showcaseBelowFour.result.composition.metrics.labelRouteClearanceIssues, 1);
  assert.equal(showcaseBelowFour.result.composition.summary.errors, 1);
});

test('render output check: unrelated shared corridors warn in standard and fail showcase', () => {
  for (const profile of ['standard', 'showcase']) {
    const { code, result } = checkHtml(`corridor-${profile}`, `
      <path data-edge-id="first" data-edge-from="a" data-edge-to="b" data-composition-points="20,60;140,60;140,100" d="M 20 60 L 140 60 L 140 100" class="a-default" marker-end="url(#arrowhead)"/>
      <path data-edge-id="second" data-edge-from="c" data-edge-to="d" data-composition-points="60,60;180,60;180,100" d="M 60 60 L 180 60 L 180 100" class="a-dashed" marker-end="url(#arrowhead-dashed)"/>
    `, profile);
    assert.equal(result.composition.metrics.ambiguousCorridors, 1);
    assert.equal(result.composition.issues[0].code, 'composition/ambiguous-corridor');
    assert.equal(result.composition.issues[0].overlapLength, 80);
    assert.deepEqual(result.composition.issues[0].from, [60, 60]);
    assert.deepEqual(result.composition.issues[0].to, [140, 60]);
    const check = result.checks.find((item) => item.name === 'relationship_corridors');
    if (profile === 'standard') {
      assert.equal(code, 0);
      assert.equal(check.ok, true);
      assert.deepEqual(result.composition.summary, { errors: 0, warnings: 1 });
      assert.equal(result.composition.issues[0].severity, 'warning');
    } else {
      assert.notEqual(code, 0);
      assert.equal(check.ok, false);
      assert.match(check.details[0], /\[composition\/ambiguous-corridor\] showcase/);
      assert.match(check.details[0], /relationship id "first".*relationship id "second"/);
      assert.deepEqual(result.composition.summary, { errors: 1, warnings: 0 });
      assert.equal(result.composition.issues[0].severity, 'error');
    }
  }
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
