import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-v1-compat-'));

function render(mode, doc) {
  const input = path.join(tmp, `${mode}.json`);
  const output = path.join(tmp, `${mode}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    execFileSync('node', [
      path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
      input,
      output,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return { code: 0, stderr: '', output };
  } catch (error) {
    return { code: error.status ?? 1, stderr: String(error.stderr || ''), output };
  }
}

function validate(mode, doc) {
  const input = path.join(tmp, `${mode}-validate.json`);
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    execFileSync('node', [
      path.join(skillRoot, 'bin/archify.mjs'),
      'validate',
      mode,
      input,
      '--json',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return { code: 0, stderr: '' };
  } catch (error) {
    return { code: error.status ?? 1, stderr: String(error.stderr || error.stdout || '') };
  }
}

function check(output) {
  const stdout = execFileSync('node', [
    path.join(skillRoot, 'scripts/check-render-output.mjs'),
    output,
  ], { encoding: 'utf8' });
  return JSON.parse(stdout);
}

function legacyDataflowDocument() {
  return {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Legacy data flow', viewBox: [1080, 760] },
    stages: [{ label: 'Sources' }, { label: 'Ingest' }],
    nodes: [
      { id: 'web', type: 'frontend', label: 'Web App', stage: 0, row: 0 },
      { id: 'edge', type: 'cloud', label: 'Edge API', stage: 1, row: 1 },
    ],
    flows: [
      {
        from: 'web',
        to: 'edge',
        label: 'clickstream',
        fromSide: 'right',
        toSide: 'left',
        via: [[184, 157], [184, 271]],
        labelAt: [204, 190],
      },
    ],
  };
}

const OFFICIAL_V1_EXAMPLES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

for (const [mode, filename] of Object.entries(OFFICIAL_V1_EXAMPLES)) {
  test(`official v1 ${mode} baseline remains renderable and valid`, () => {
    const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v1-baseline', filename), 'utf8'));
    assert.equal(doc.schema_version, 1);
    assert.equal(doc.meta.quality_profile, undefined);
    const rendered = render(mode, doc);
    assert.equal(rendered.code, 0, rendered.stderr);
    assert.ok(fs.statSync(rendered.output).size > 0);
    const validated = validate(mode, doc);
    assert.equal(validated.code, 0, validated.stderr);
  });
}

test('quality-profile lifecycle keeps the checked-in authored via authoritative', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/agent-run.lifecycle.json'), 'utf8'));
  const transition = doc.transitions.find(({ id }) => id === 'approval-cancelled');
  assert.deepEqual(transition.via, [[480, 336], [480, 432], [402, 432]]);

  const rendered = render('lifecycle', doc);
  assert.equal(rendered.code, 0, rendered.stderr);
  const html = fs.readFileSync(rendered.output, 'utf8');
  assert.match(
    html,
    /data-edge-id="approval-cancelled"[^>]*data-composition-points="[^"]*480,336;480,432;402,432[^"]*"/,
  );
  const validated = validate('lifecycle', doc);
  assert.equal(validated.code, 0, validated.stderr);
});

test('legacy v1 architecture auto viewBox accommodates all seven implicit auto legend kinds', () => {
  const types = ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'];
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Narrow legacy architecture' },
    components: types.map((type, index) => ({
      id: `component_${index}`,
      type,
      label: type,
      pos: [0, 40 + index * 76],
      size: [120, 52],
    })),
    connections: [],
  };

  const rendered = render('architecture', doc);
  assert.equal(rendered.code, 0, rendered.stderr);
  const html = fs.readFileSync(rendered.output, 'utf8');
  const svg = html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/)?.slice(1).map(Number);
  const baselines = [...svg.matchAll(/data-legend-baseline="([\d.]+)"/g)].map((match) => Number(match[1]));
  assert.deepEqual([...svg.matchAll(/data-legend-semantic-kind="([^"]+)"/g)].map((match) => match[1]), types);
  assert.ok(viewBox && baselines.length === types.length);
  assert.ok(viewBox[0] > 160, 'auto viewBox should widen for its widest measured legend entry');
  assert.ok(Math.max(...baselines) < viewBox[1]);
  assert.ok(Math.min(...baselines) > 40 + (types.length - 1) * 76 + 52);

  const validated = validate('architecture', doc);
  assert.equal(validated.code, 0, validated.stderr);
});

function narrowExplicitViewBoxDocuments() {
  const componentTypes = ['frontend', 'backend', 'database', 'cloud', 'security', 'messagebus', 'external'];
  return {
    architecture: {
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'Legacy narrow architecture', viewBox: [320, 800] },
      components: componentTypes.map((type, index) => ({
        id: `component_${index}`,
        type,
        label: type,
        pos: [40, 90 + index * 90],
        size: [120, 52],
      })),
      connections: [],
    },
    workflow: {
      schema_version: 1,
      diagram_type: 'workflow',
      meta: { title: 'Legacy narrow workflow', viewBox: [700, 400] },
      lanes: [{ id: 'first', label: 'First' }, { id: 'second', label: 'Second' }],
      nodes: componentTypes.map((type, index) => ({
        id: `node_${index}`,
        lane: index < 3 ? 'first' : 'second',
        col: index < 3 ? index * 2 : [0, 2, 4, 5][index - 3],
        type,
        label: type,
      })),
      edges: [],
    },
    sequence: {
      schema_version: 1,
      diagram_type: 'sequence',
      meta: { title: 'Legacy narrow sequence', viewBox: [480, 480] },
      participants: [
        { id: 'left', type: 'frontend', label: 'Left' },
        { id: 'right', type: 'backend', label: 'Right' },
      ],
      messages: ['emphasis', 'return', 'security', 'dashed', 'default'].map((variant, index) => ({
        from: index % 2 ? 'right' : 'left',
        to: index % 2 ? 'left' : 'right',
        y: 170 + index * 40,
        label: variant,
        variant,
      })),
    },
    dataflow: {
      schema_version: 1,
      diagram_type: 'dataflow',
      meta: { title: 'Legacy narrow dataflow', viewBox: [423, 720] },
      stages: [{ label: 'Input' }, { label: 'Output' }],
      nodes: [
        { id: 'in_0', type: 'backend', label: 'In 0', stage: 0, row: 0 },
        { id: 'out_0', type: 'database', label: 'Out 0', stage: 1, row: 0 },
        { id: 'in_1', type: 'backend', label: 'In 1', stage: 0, row: 1 },
        { id: 'out_1', type: 'backend', label: 'Out 1', stage: 1, row: 1 },
        { id: 'in_2', type: 'backend', label: 'In 2', stage: 0, row: 2 },
        { id: 'out_2', type: 'backend', label: 'Out 2', stage: 1, row: 2 },
        { id: 'in_3', type: 'backend', label: 'In 3', stage: 0, row: 3 },
        { id: 'out_3', type: 'backend', label: 'Out 3', stage: 1, row: 3 },
      ],
      flows: ['emphasis', 'security', 'dashed', 'default'].map((variant, index) => ({
        from: `in_${index}`,
        to: `out_${index}`,
        label: variant,
        variant,
        route: 'straight',
      })),
    },
    lifecycle: {
      schema_version: 1,
      diagram_type: 'lifecycle',
      meta: { title: 'Legacy narrow lifecycle', viewBox: [420, 800] },
      lanes: [{ id: 'main', label: 'Lifecycle' }],
      states: ['start', 'active', 'waiting', 'decision', 'success', 'failure', 'neutral', 'external'].map((type, index) => ({
        id: `state_${index}`,
        type,
        label: type,
        lane: 'main',
        col: index % 2,
        yOffset: Math.floor(index / 2) * 72,
      })),
      transitions: [],
    },
  };
}

test('legacy v1 explicit narrow viewBoxes never hard-fail on an implicit auto legend', () => {
  const expectedNodeCounts = { architecture: 7, workflow: 7, sequence: 2, dataflow: 8, lifecycle: 8 };
  for (const [mode, doc] of Object.entries(narrowExplicitViewBoxDocuments())) {
    assert.equal(doc.meta.legend, undefined);
    const rendered = render(mode, doc);
    assert.equal(rendered.code, 0, `${mode}: ${rendered.stderr}`);
    const svg = fs.readFileSync(rendered.output, 'utf8').match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
    assert.equal((svg.match(/data-node-id=/g) || []).length, expectedNodeCounts[mode], `${mode}: topology must remain intact`);
    if (mode === 'lifecycle') {
      assert.match(svg, />Legend</, 'a fitting implicit legend should remain visible');
      assert.equal((svg.match(/data-legend-semantic-kind=/g) || []).length, 8);
    } else {
      assert.doesNotMatch(svg, />Legend</, `${mode}: an unfit implicit legend should degrade without overlap`);
    }
    const validated = validate(mode, doc);
    assert.equal(validated.code, 0, `${mode}: ${validated.stderr}`);
  }
});

test('legacy v1 architecture geometry remains renderable without an explicit quality profile', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Legacy architecture' },
    components: [
      { id: 'auth', type: 'security', label: 'Auth Provider', pos: [40, 110], size: [120, 64] },
      { id: 'lb', type: 'cloud', label: 'Load Balancer', pos: [460, 300], size: [130, 60] },
      { id: 'api', type: 'backend', label: 'API Server', pos: [670, 300], size: [130, 60] },
    ],
    connections: [
      {
        from: 'auth',
        to: 'api',
        label: 'verify JWT',
        fromSide: 'right',
        toSide: 'left',
        via: [[620, 142], [620, 330]],
      },
    ],
  };

  const result = render('architecture', doc);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(fs.statSync(result.output).size > 0);
});

test('legacy v1 data-flow geometry remains renderable without an explicit quality profile', () => {
  const result = render('dataflow', legacyDataflowDocument());
  assert.equal(result.code, 0, result.stderr);
  assert.ok(fs.statSync(result.output).size > 0);
});

test('legacy v1 data-flow artifact remains valid without an explicit quality profile', () => {
  const result = validate('dataflow', legacyDataflowDocument());
  assert.equal(result.code, 0, result.stderr);
});

test('legacy v1 composition findings remain visible as advisory warnings', () => {
  const rendered = render('dataflow', legacyDataflowDocument());
  assert.equal(rendered.code, 0, rendered.stderr);
  const receipt = check(rendered.output);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.composition.metrics.containerBorderRuns, 1);
  assert.equal(receipt.composition.summary.errors, 0);
  assert.equal(receipt.composition.issues[0].severity, 'warning');
});

test('legacy v1 lifecycle geometry remains renderable without an explicit quality profile', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Legacy lifecycle', viewBox: [980, 660] },
    lanes: [
      { id: 'main', label: 'Lifecycle phases' },
      { id: 'waiting', label: 'Interruptions' },
      { id: 'exceptions', label: 'Recovery loop' },
      { id: 'terminal', label: 'Terminal exits' },
    ],
    states: [
      { id: 'executing', type: 'active', label: 'Executing', lane: 'main', col: 2 },
      { id: 'approval', type: 'waiting', label: 'Needs Approval', lane: 'waiting', col: 0 },
      { id: 'failed', type: 'failure', label: 'Failed', lane: 'exceptions', col: 0, yOffset: 78 },
      { id: 'cancelled', type: 'failure', label: 'Cancelled', lane: 'terminal', col: 0 },
    ],
    transitions: [
      { from: 'executing', to: 'failed', fromSide: 'left', toSide: 'top', via: [[320, 157], [320, 342], [402, 342]] },
      { from: 'approval', to: 'cancelled', fromSide: 'bottom', toSide: 'top', via: [[320, 336], [320, 430], [402, 430]] },
    ],
  };

  const result = render('lifecycle', doc);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(fs.statSync(result.output).size > 0);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
