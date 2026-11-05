import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';
import { validateSchema } from '../archify/renderers/shared/validator.mjs';
import { migrateWorkflowDocument } from '../archify/migrations/workflow-v2.mjs';
import { planningWorkflow } from '../archify/renderers/workflow/workflow-migration-geometry.mjs';

function fixture() {
  return {
    schema_version: 2, diagram_type: 'workflow',
    meta: { title: 'Branch conditions', output: 'conditions.html', quality_profile: 'showcase' },
    lanes: [{ id: 'policy', label: 'Policy' }, { id: 'recovery', label: 'Recovery' }],
    nodes: [
      { id: 'gate', lane: 'policy', col: 0, type: 'security', label: 'Policy', decision: true },
      { id: 'run', lane: 'policy', col: 3, type: 'backend', label: 'Run tool' },
      { id: 'stop', lane: 'recovery', col: 3, type: 'backend', label: 'Stop' },
    ],
    edges: [
      { id: 'yes', from: 'gate', to: 'run', condition: { value: 'Approved' } },
      { id: 'no', from: 'gate', to: 'stop', condition: { value: 'Denied' }, role: 'error' },
    ],
  };
}

function compile(document) {
  const result = compileWorkflow({ workflow: document });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result;
}

test('decision identity preserves type; conditions use the existing visible and accessible label path', () => {
  const document = fixture();
  const snapshot = JSON.stringify(document);
  const { svg, receipt } = compile(document);
  assert.equal(JSON.stringify(document), snapshot, 'compilation must preserve authored text');
  assert.match(svg, /id="node-gate"[^>]*data-node-kind="security"/);
  assert.match(svg, /data-node-context="[^"]*Decision/);
  assert.match(svg, /aria-label="[^"]*Decision/);
  assert.match(svg, /data-semantic-sigil="decision" class="semantic-sigil s-security"/);
  assert.match(svg, /data-edge-label="Approved"/);
  assert.match(svg, />Approved<\/text>/);
  assert.deepEqual(receipt.labels.map(({ label }) => label).sort(), ['Approved', 'Denied']);
  assert.deepEqual(receipt.diagnostics, []);
  assert.deepEqual(compile(document), { ok: true, svg, receipt }, 'recompiling must not duplicate conditions');
});

test('condition and action text share measured geometry without swallowing or duplicating author text', () => {
  for (const [condition, label, visible] of [
    [undefined, 'run tool', 'run tool'],
    ['Approved', undefined, 'Approved'],
    ['Approved', 'Approved', 'Approved'],
    ['Approved', 'run tool', 'Approved · run tool'],
    ['批准', '运行工具', '批准 · 运行工具'],
    ['A < B & "ready"', 'send', 'A < B & "ready" · send'],
  ]) {
    const document = fixture();
    document.edges = [{ id: 'yes', from: 'gate', to: 'run', ...(label === undefined ? {} : { label }),
      ...(condition === undefined ? {} : { condition: { value: condition } }) }];
    const equivalent = structuredClone(document);
    delete equivalent.nodes[0].decision;
    delete equivalent.edges[0].condition;
    equivalent.edges[0].label = visible;
    const result = compile(document);
    const baseline = compile(equivalent);
    assert.deepEqual(result.receipt.nodes, baseline.receipt.nodes);
    assert.deepEqual(result.receipt.edges, baseline.receipt.edges);
    assert.deepEqual(result.receipt.labels, baseline.receipt.labels);
    assert.equal(result.receipt.labels[0].label, visible);
    if (condition?.includes('<')) assert.match(result.svg, /A &lt; B &amp; &quot;ready&quot; · send/);
  }
});

test('missing conditions warn on authored outgoing edges even in showcase; partial and terminal views stay valid', () => {
  const document = fixture();
  document.edges.reverse(); // canonical sorting must not change the reported input path
  delete document.edges[1].condition;
  document.edges[1].label = 'Approved'; // a label is not an explicit condition
  for (const profile of ['standard', 'showcase']) {
    document.meta.quality_profile = profile;
    const warnings = compile(document).receipt.diagnostics;
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].code, 'workflow/missing-branch-condition');
    assert.equal(warnings[0].severity, 'warning');
    assert.equal(warnings[0].subject.path, '/edges/1/condition');
    assert.equal(warnings[0].subject.from, 'gate');
    assert.ok(warnings[0].supportedFixes.some(fix => fix.includes('condition.value')));
  }
  document.edges = [document.edges[0]];
  assert.deepEqual(compile(document).receipt.diagnostics, []);
  document.edges = [];
  assert.deepEqual(compile(document).receipt.diagnostics, []);
});

test('explicit icons remain authoritative; decorative icons and branch count never imply a decision', () => {
  const document = fixture();
  document.nodes[0].icon = 'security';
  let result = compile(document);
  assert.match(result.svg, /data-semantic-sigil="security"/);
  assert.match(result.svg, /data-node-context="[^"]*Decision/);
  document.nodes[0].icon = 'none';
  result = compile(document);
  assert.doesNotMatch(result.svg, /data-semantic-sigil="decision"/);
  assert.match(result.svg, /data-node-context="[^"]*Decision/);
  delete document.nodes[0].decision;
  document.nodes[0].icon = 'decision';
  document.edges.forEach(edge => { delete edge.condition; });
  assert.deepEqual(compile(document).receipt.diagnostics, []);
});

test('optional authoring fields work in v1 and v2 without inferring condition logic', () => {
  for (const version of [1, 2]) {
    const document = fixture();
    document.schema_version = version;
    document.nodes[0].type = 'backend';
    document.nodes[0].label = 'Retry';
    document.edges[0].condition.value = 'Budget left';
    document.edges[1].condition.value = 'Budget left';
    assert.deepEqual(compile(document).receipt.diagnostics, []);
    const old = structuredClone(document);
    old.nodes.forEach(node => { delete node.decision; });
    old.edges.forEach(edge => { edge.label = edge.condition.value; delete edge.condition; });
    const explicitFalse = structuredClone(old);
    explicitFalse.nodes[0].decision = false;
    assert.deepEqual(compile(explicitFalse), compile(old));
  }
});

test('invalid condition shapes fail schema validation, independently of a missing-condition warning', () => {
  for (const condition of ['', null, {}, { value: '' }, { value: ' \t\n' }, { value: 1 }, { value: 'ok', op: 'all' }]) {
    const document = fixture();
    document.edges[0].condition = condition;
    assert.throws(() => validateSchema('workflow', document), /condition/);
  }
});

test('migration keeps authored conditions and reserves their text in its automatic rank plan', () => {
  const document = fixture();
  document.schema_version = 1;
  document.edges = [document.edges[0]];
  document.edges[0].condition.value = 'Budget remaining and request is retryable';
  document.edges[0].label = 'try again';
  const before = JSON.stringify(document);
  const visible = 'Budget remaining and request is retryable · try again';
  const legacyLabels = structuredClone(document);
  delete legacyLabels.edges[0].condition;
  legacyLabels.edges[0].label = visible;
  const planned = compile(planningWorkflow(document));
  const equivalent = compile(planningWorkflow(legacyLabels));
  assert.deepEqual(planned.receipt.labels, equivalent.receipt.labels);
  assert.deepEqual(planned.receipt.columns, equivalent.receipt.columns);
  const migrated = migrateWorkflowDocument(document);
  assert.equal(migrated.ok, true, JSON.stringify(migrated));
  assert.equal(JSON.stringify(document), before);
  assert.deepEqual(migrated.document.edges, document.edges);
  assert.equal(migrated.document.nodes[0].decision, true);
  assert.equal(compile(migrated.document).receipt.labels[0].label, visible);
});

test('public validate and deliver expose the same warning and still deliver a partial showcase', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-decision-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const document = fixture();
  document.edges = [document.edges[0]];
  delete document.edges[0].condition;
  const input = path.join(dir, 'input.json');
  const output = path.join(dir, 'output.html');
  fs.writeFileSync(input, JSON.stringify(document));
  for (const args of [['validate', 'workflow', input, '--json'], ['deliver', 'workflow', input, output, '--json']]) {
    const result = spawnSync(process.execPath, ['archify/bin/archify.mjs', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.ok, true);
    const warnings = receipt.diagnostics?.filter(entry => entry.code === 'workflow/missing-branch-condition');
    assert.equal(warnings?.length, 1);
    assert.equal(warnings[0].severity, 'warning');
  }
  assert.ok(fs.existsSync(output));
  const renderer = spawnSync(process.execPath, ['archify/renderers/workflow/render-workflow.mjs', input, path.join(dir, 'direct.html')], { encoding: 'utf8' });
  assert.equal(renderer.status, 0, renderer.stderr);
  assert.match(renderer.stderr, /workflow\/missing-branch-condition/);
});
