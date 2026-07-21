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
      { from: 'auth', to: 'api', label: 'verify JWT', fromSide: 'right', toSide: 'top' },
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
      { from: 'executing', to: 'failed', fromSide: 'left', toSide: 'top', via: [[340, 342], [402, 342]] },
      { from: 'approval', to: 'cancelled', fromSide: 'bottom', toSide: 'top', route: 'straight' },
    ],
  };

  const result = render('lifecycle', doc);
  assert.equal(result.code, 0, result.stderr);
  assert.ok(fs.statSync(result.output).size > 0);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
