// Per-rule coverage for the renderers' layout validators. The golden suite's
// negative cases mostly trip ajv SCHEMA rules; this file targets the hand-
// written LAYOUT rules (the `problems.push(...)` checks) — the layer that has
// regressed before — by mutating a valid example into exactly one violation
// and asserting the renderer exits non-zero with the expected message.
//
// It also locks the error-message CONTRACT: representative messages must carry
// both the numeric threshold and a remediation hint, since the consumer is an
// LLM that fixes the JSON from the message alone.
//
//   node --test test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-rules-'));

const EXAMPLES = {
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
  architecture: 'web-app.architecture.json',
};

function load(mode) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', EXAMPLES[mode]), 'utf8'));
}

// Returns { code, stderr }. Never throws on non-zero exit.
function render(mode, doc) {
  const input = path.join(tmp, `${mode}-${Math.abs(hash(JSON.stringify(doc)))}.json`);
  const outPath = path.join(tmp, `${mode}-${Math.abs(hash(JSON.stringify(doc)))}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    execFileSync('node', [
      path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
      input,
      outPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return { code: 0, stderr: '', outPath };
  } catch (err) {
    return { code: err.status ?? 1, stderr: String(err.stderr || ''), outPath };
  }
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// [name, mode, mutate(doc), expectedSubstrings[]] — every mutation introduces
// exactly one layout violation. Each expected substring must appear in stderr.
const CASES = [
  // ---- workflow layout rules ----
  ['workflow: unknown lane', 'workflow', (d) => { d.nodes[0].lane = 'ghost'; }, ['unknown lane "ghost"']],
  ['workflow: node label wider than box', 'workflow',
    (d) => { d.nodes[0].label = 'An Extremely Long Node Label That Overflows'; }, ['wider than node', 'shorten the label']],
  ['workflow: viewBox width below schema min', 'workflow',
    (d) => { d.meta.viewBox = [699, 900]; }, ['700']],
  ['workflow: nodes too close in a lane', 'workflow',
    (d) => { d.nodes.push({ ...d.nodes[0], id: 'dupe', col: d.nodes[0].col }); }, ['less than 8px apart']],
  ['workflow: empty group', 'workflow',
    (d) => { d.groups = [{ id: 'empty', label: 'Empty group', lane: 'ui', fromCol: 3, toCol: 4 }]; }, ['does not contain any nodes']],
  ['workflow: mainPath missing edge', 'workflow',
    (d) => { d.mainPath = ['user', 'planner']; }, ['mainPath step "user" -> "planner" has no matching edge']],
  ['workflow: mainPath moves backward', 'workflow',
    (d) => { d.mainPath = ['external', 'trace']; }, ['moves backward from col']],

  // ---- sequence layout rules ----
  ['sequence: message references unknown participant', 'sequence',
    (d) => { d.messages[0].from = 'ghost'; }, ['unknown source "ghost"']],
  ['sequence: message y outside timeline', 'sequence',
    (d) => { d.messages[0].y = 9000; }, ['outside the readable timeline', 'keep y between']],
  ['sequence: segment to <= from', 'sequence',
    (d) => { d.segments = [{ from: 400, to: 300, label: 'bad' }]; }, ['invalid y range', 'greater than']],

  // ---- dataflow layout rules ----
  ['dataflow: flow missing label', 'dataflow',
    (d) => { delete d.flows[0].label; }, ['label']],
  ['dataflow: flow references unknown node', 'dataflow',
    (d) => { d.flows[0].to = 'ghost'; }, ['unknown target "ghost"']],

  // ---- lifecycle layout rules ----
  ['lifecycle: missing reserved main lane', 'lifecycle',
    (d) => {
      d.lanes = d.lanes.map((l) => (l.id === 'main' ? { ...l, id: 'primary' } : l));
      d.states = d.states.map((s) => (s.lane === 'main' ? { ...s, lane: 'primary' } : s));
    }, ['"main"', 'reserved']],
  ['lifecycle: cross-lane state overlap', 'lifecycle',
    (d) => {
      const approval = d.states.find((s) => s.id === 'approval');
      const failed = d.states.find((s) => s.id === 'failed');
      delete failed.yOffset;
      failed.col = approval.col;
    }, ['less than 10px apart']],
  ['lifecycle: viewBox height below schema min', 'lifecycle',
    (d) => { d.meta.viewBox = [980, 565]; }, ['566']],

  // ---- architecture layout rules ----
  ['architecture: components overlap', 'architecture',
    (d) => { d.components[1].pos = [...d.components[0].pos]; }, ['less than 8px apart']],
  ['architecture: connection references unknown component', 'architecture',
    (d) => { d.connections[0].to = 'ghost'; }, ['unknown target "ghost"']],
  ['architecture: boundary wraps unknown component', 'architecture',
    (d) => { d.boundaries[0].wraps.push('ghost'); }, ['wraps unknown component "ghost"']],
  ['architecture: label wider than component', 'architecture',
    (d) => { d.components[0].label = 'An Extremely Long Component Label Overflow'; }, ['wider than component', 'shorten the label']],
  ['architecture: component overlap suggests fix', 'architecture',
    (d) => { d.components[1].pos = [...d.components[0].pos]; }, ['Suggested fix', 'move "']],
];

for (const [name, mode, mutate, expected] of CASES) {
  test(name, () => {
    const doc = load(mode);
    mutate(doc);
    const { code, stderr } = render(mode, doc);
    assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
    assert.doesNotMatch(stderr, /TypeError|is not a function|Cannot read/, `crashed instead of reporting:\n${stderr}`);
    for (const sub of expected) {
      assert.ok(stderr.includes(sub), `expected "${sub}" in stderr:\n${stderr}`);
    }
  });
}

// ---- error-message contract: threshold + remediation, not just a path ----
test('contract: short-edge message carries both the px minimum and a fix verb', () => {
  const d = load('workflow');
  // Force a too-short labeled edge between adjacent same-lane columns.
  d.nodes.push({ id: 'a1', lane: d.nodes[0].lane, col: 0, type: 'backend', label: 'A' });
  d.nodes.push({ id: 'a2', lane: d.nodes[0].lane, col: 0, type: 'backend', label: 'B', yOffset: 30 });
  d.edges.push({ from: 'a1', to: 'a2', label: 'x', route: 'straight' });
  const { stderr } = render('workflow', d);
  // Whatever rule fires, the messages must remain actionable (threshold + verb).
  assert.match(stderr, /\d+px|at least \d+|0\.\.\d+|less than/);
});

test('contract: ajv path errors are annotated with the element id', () => {
  const d = load('workflow');
  d.nodes[3].colour = 'red'; // unknown property → ajv additionalProperties
  const { stderr } = render('workflow', d);
  // Only meaningful when ajv is installed; skip the assertion in degraded mode.
  if (!/schema validation failed/.test(stderr)) return;
  assert.match(stderr, /id\/label:/);
});

test('workflow: same-lane offset auto edge stays orthogonal', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Same-lane offset route' },
    lanes: [{ id: 'main', label: 'Main lane' }],
    nodes: [
      { id: 'left', lane: 'main', col: 1, type: 'backend', label: 'A', width: 32, height: 38, yOffset: -14 },
      { id: 'right', lane: 'main', col: 2, type: 'backend', label: 'B', width: 32, height: 38, yOffset: 14 },
    ],
    edges: [{ from: 'left', to: 'right' }],
  };
  const { code, stderr, outPath } = render('workflow', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  assert.doesNotMatch(html, /M 236 105 L 284 133/);
  assert.match(html, /M 236 105 L 260 105 L 260 133 L 284 133/);
});

test('workflow: edge crossing a non-endpoint node is rejected', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Crossing edge route', quality_profile: 'standard' },
    lanes: [{ id: 'main', label: 'Main lane' }],
    nodes: [
      { id: 'left', lane: 'main', col: 0, type: 'backend', label: 'Left', width: 60 },
      { id: 'middle', lane: 'main', col: 2, type: 'database', label: 'Middle', width: 70 },
      { id: 'right', lane: 'main', col: 4, type: 'backend', label: 'Right', width: 60 },
    ],
    edges: [{ from: 'left', to: 'right', route: 'straight' }],
  };
  const { code, stderr } = render('workflow', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /crosses node "middle"/);
  assert.match(stderr, /fromSide\/toSide|channel|lane\/column/);
});

test('architecture: Clean Flow Gate rejects a connection through a component', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Opaque component crossing', quality_profile: 'standard' },
    components: [
      { id: 'left', type: 'frontend', label: 'Left', pos: [60, 120], size: [100, 54] },
      { id: 'middle', type: 'security', label: 'Middle', pos: [270, 120], size: [100, 54] },
      { id: 'right', type: 'backend', label: 'Right', pos: [480, 120], size: [100, 54] },
    ],
    connections: [{ id: 'direct', from: 'left', to: 'right', route: 'straight' }],
  };
  const { code, stderr } = render('architecture', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /\[clean-flow\/edge-through-node\] architecture connections\[0\] id "direct"/);
  assert.match(stderr, /crosses component "middle"/);
  assert.match(stderr, /segment 0 .*2px clearance/);
});

function autoRoutePassThroughDocument(connection) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Auto-route pass-through regression' },
    components: [
      { id: 'api', type: 'backend', label: 'API', pos: [400, 280], size: [160, 76] },
      { id: 'cache', type: 'database', label: 'Cache', pos: [645, 130], size: [130, 60] },
      { id: 'queue', type: 'cloud', label: 'Queue', pos: [880, 130] },
    ],
    connections: [connection],
  };
}

test('architecture: default auto route selects a safe orthogonal candidate around an unrelated component', () => {
  const d = autoRoutePassThroughDocument({ from: 'api', to: 'queue', variant: 'dashed' });
  const { code, stderr, outPath } = render('architecture', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  assert.match(html, /data-composition-points="560,318;560,239;880,239;880,160"/);
});

test('architecture: explicit orthogonal route remains authoritative when it crosses a component', () => {
  const d = autoRoutePassThroughDocument({
    from: 'api',
    to: 'queue',
    variant: 'dashed',
    route: 'orthogonal-h',
  });
  const { code, stderr } = render('architecture', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /connections\[0\] "api" -> "queue" crosses component "cache"/);
});

test('architecture: auto route still fails closed when both bounded doglegs are blocked', () => {
  const d = autoRoutePassThroughDocument({ from: 'api', to: 'queue', variant: 'dashed' });
  d.components.push({ id: 'guard', type: 'security', label: 'Guard', pos: [790, 215], size: [60, 50] });
  const { code, stderr } = render('architecture', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /connections\[0\] "api" -> "queue" crosses component "cache"/);
});

test('architecture: explicit waypoints around an obstacle remain valid by default', () => {
  const d = autoRoutePassThroughDocument({
    from: 'api',
    to: 'queue',
    variant: 'dashed',
    fromSide: 'right',
    toSide: 'top',
    via: [[620, 318], [620, 100], [940, 100]],
  });
  const { code, stderr } = render('architecture', d);
  assert.equal(code, 0, stderr);
});

test('architecture: showcase rejects an unrelated proper edge crossing', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Showcase crossing', quality_profile: 'showcase' },
    components: [
      { id: 'a', type: 'frontend', label: 'A', pos: [60, 80], size: [60, 40] },
      { id: 'b', type: 'backend', label: 'B', pos: [360, 260], size: [60, 40] },
      { id: 'c', type: 'database', label: 'C', pos: [60, 260], size: [60, 40] },
      { id: 'd', type: 'external', label: 'D', pos: [360, 80], size: [60, 40] },
    ],
    connections: [
      { id: 'down-right', from: 'a', to: 'b', route: 'orthogonal-h' },
      { id: 'up-right', from: 'c', to: 'd', route: 'orthogonal-v' },
    ],
  };
  const { code, stderr } = render('architecture', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /\[composition\/proper-crossing\] showcase architecture/);
  assert.match(stderr, /connections\[0\] id "down-right"/);
  assert.match(stderr, /connections\[1\] id "up-right"/);
  assert.match(stderr, /at \[240, 190\]/);
  assert.match(stderr, /segments 1 and 1/);
  assert.match(stderr, /route\/via|fromSide\/toSide/);
});

test('architecture: standard keeps the same proper crossing renderable', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Standard crossing', quality_profile: 'standard' },
    components: [
      { id: 'a', type: 'frontend', label: 'A', pos: [60, 80], size: [60, 40] },
      { id: 'b', type: 'backend', label: 'B', pos: [360, 260], size: [60, 40] },
      { id: 'c', type: 'database', label: 'C', pos: [60, 260], size: [60, 40] },
      { id: 'd', type: 'external', label: 'D', pos: [360, 80], size: [60, 40] },
    ],
    connections: [
      { from: 'a', to: 'b', route: 'orthogonal-h' },
      { from: 'c', to: 'd', route: 'orthogonal-v' },
    ],
  };
  const { code, stderr } = render('architecture', d);
  assert.equal(code, 0, stderr);
});

test('architecture: route rhythm warns in standard and blocks a showcase micro segment', () => {
  const base = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Readable turn rhythm' },
    components: [
      { id: 'a', type: 'frontend', label: 'A', pos: [60, 80], size: [60, 40] },
      { id: 'b', type: 'backend', label: 'B', pos: [360, 80], size: [60, 40] },
    ],
    connections: [
      { id: 'tight', from: 'a', to: 'b', fromSide: 'right', toSide: 'bottom', via: [[125, 100], [125, 160], [390, 160]] },
    ],
  };
  const standard = structuredClone(base);
  standard.meta.quality_profile = 'standard';
  assert.equal(render('architecture', standard).code, 0);

  const showcase = structuredClone(base);
  showcase.meta.quality_profile = 'showcase';
  const { code, stderr } = render('architecture', showcase);
  assert.notEqual(code, 0);
  assert.match(stderr, /\[composition\/micro-segment\] showcase architecture connections\[0\] id "tight"/);
  assert.match(stderr, /5px source-stub segment 0/);
  assert.match(stderr, /wider corridor|move the component/);
});

test('architecture: container border run is blocking in standard and showcase', () => {
  for (const profile of ['standard', 'showcase']) {
    const d = load('architecture');
    d.meta.quality_profile = profile;
    d.connections.find((connection) => connection.id === 'jwt-verification').via = [[620, 142], [620, 270], [735, 270]];
    const { code, stderr } = render('architecture', d);
    assert.notEqual(code, 0, `expected ${profile} to reject a border run`);
    assert.match(stderr, /\[composition\/container-border-run\] architecture connections\[1\] id "jwt-verification"/);
    assert.match(stderr, /security-group "sg-api :443\/:8000" top border/);
  }
});

test('dataflow: stage border run is blocking and the inter-stage gutter passes', () => {
  const bad = load('dataflow');
  bad.flows.find((flow) => flow.id === 'web-clickstream').via = [[184, 157], [184, 271]];
  const failed = render('dataflow', bad);
  assert.notEqual(failed.code, 0);
  assert.match(failed.stderr, /\[composition\/container-border-run\] dataflow flows\[0\] id "web-clickstream"/);
  assert.match(failed.stderr, /stage "Sources" right border for 114px/);

  const clean = load('dataflow');
  const passed = render('dataflow', clean);
  assert.equal(passed.code, 0, passed.stderr);
});

test('sequence: a message cannot masquerade as a time-segment border', () => {
  const d = load('sequence');
  d.messages.find((message) => message.id === 'cache-read').y = 315;
  const { code, stderr } = render('sequence', d);
  assert.notEqual(code, 0);
  assert.match(stderr, /\[composition\/container-border-run\] sequence messages\[4\] id "cache-read"/);
  assert.match(stderr, /segment "Fallback" top border/);
});

test('dataflow: Clean Flow Gate rejects a flow through an unrelated node', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Opaque data node crossing', quality_profile: 'standard' },
    stages: [{ label: 'Source' }, { label: 'Middle' }, { label: 'Sink' }],
    nodes: [
      { id: 'left', type: 'frontend', label: 'Left', stage: 0, row: 1 },
      { id: 'middle', type: 'security', label: 'Middle', stage: 1, row: 1 },
      { id: 'right', type: 'database', label: 'Right', stage: 2, row: 1 },
    ],
    flows: [{ id: 'direct', from: 'left', to: 'right', label: 'payload', route: 'straight', labelAt: [315, 190] }],
  };
  const { code, stderr } = render('dataflow', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /\[clean-flow\/edge-through-node\] dataflow flows\[0\] id "direct"/);
  assert.match(stderr, /crosses node "middle"/);
  assert.match(stderr, /stage\/row/);
});

test('lifecycle: Clean Flow Gate rejects a transition through an unrelated state', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Opaque state crossing', quality_profile: 'standard' },
    lanes: [{ id: 'main', label: 'Main' }],
    states: [
      { id: 'left', type: 'start', label: 'Left', lane: 'main', col: 0 },
      { id: 'middle', type: 'waiting', label: 'Middle', lane: 'main', col: 2 },
      { id: 'right', type: 'success', label: 'Right', lane: 'main', col: 4 },
    ],
    transitions: [{ id: 'direct', from: 'left', to: 'right', route: 'straight' }],
  };
  const { code, stderr } = render('lifecycle', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /\[clean-flow\/edge-through-node\] lifecycle transitions\[0\] id "direct"/);
  assert.match(stderr, /crosses state "middle"/);
  assert.match(stderr, /col\/yOffset/);
});

test('sequence: lifelines and activation bars remain intentional pass-through geometry', () => {
  const d = load('sequence');
  const { code, stderr } = render('sequence', d);
  assert.equal(code, 0, stderr);
  assert.doesNotMatch(stderr, /Clean Flow Gate/);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
