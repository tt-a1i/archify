import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';

function fixture() {
  const rows = [
    ['submit', 'buyer', 0, 0], ['retry', 'buyer', 3, 0],
    ['validate', 'order', 0, -50], ['pending', 'order', 1, 50], ['rejected', 'order', 3, -50],
    ['reserve', 'stock', 0, -50], ['release', 'stock', 4, 50],
    ['pay', 'payment', 1, -50], ['result', 'payment', 2, -50],
    ['failed', 'payment', 3, -50], ['deadline', 'payment', 4, 50],
    ['paid', 'confirmation', 2, 0], ['event', 'confirmation', 3, 0], ['close', 'confirmation', 4, 0],
    ['pick', 'warehouse', 3, 0], ['ship', 'warehouse', 4, 0],
  ];
  const links = [
    ['submit', 'validate', ''], ['validate', 'reserve', 'Valid'],
    ['reserve', 'pending', 'Held'], ['reserve', 'rejected', 'Empty', 'error'],
    ['pending', 'pay', ''], ['pay', 'result', ''],
    ['result', 'paid', 'Yes'], ['result', 'failed', 'No', 'error'],
    ['failed', 'retry', 'Retry', 'return'], ['retry', 'pay', 'In time', 'return'],
    ['pending', 'deadline', 'Wait', 'branch'], ['deadline', 'close', 'Yes', 'error'],
    ['paid', 'event', ''], ['event', 'pick', 'Paid', 'async'],
    ['pick', 'ship', ''], ['close', 'release', 'Release'],
  ];
  return {
    schema_version: 2, diagram_type: 'workflow',
    meta: { title: 'Retry and expiry', output: 'retry-expiry.html' },
    lanes: ['buyer', 'order', 'stock', 'payment', 'confirmation', 'warehouse'].map(id => ({ id, label: id })),
    nodes: rows.map(([id, lane, col, yOffset]) => ({ id, lane, col, yOffset, type: 'backend', label: id, width: 152, height: 60 })),
    edges: links.map(([from, to, label, role]) => ({ id: `${from}-${to}`, from, to, label, ...(role ? { role } : {}) })),
    mainPath: ['submit', 'validate', 'reserve', 'pending', 'pay', 'result', 'paid', 'event', 'pick', 'ship'],
    semanticChecks: { allowedRoots: ['submit'], allowedTerminals: ['rejected', 'release', 'ship'], requiredPaths: [{ from: 'failed', to: 'pay' }, { from: 'pending', to: 'release' }] },
  };
}

function findRepair(result) {
  return result.diagnostics?.map(d => d.evidence?.verifiedRepair).find(r => r?.kind === 'optional-node-placement');
}

function withoutPositions(workflow) {
  const copy = structuredClone(workflow);
  for (const node of copy.nodes) { delete node.col; delete node.yOffset; }
  return copy;
}

function applyRepair(workflow, repair) {
  const copy = structuredClone(workflow);
  for (const change of repair.changes) {
    assert.ok(['replace', 'add'].includes(change.op));
    const match = change.path.match(/^\/nodes\/(\d+)\/(col|yOffset)$/);
    assert.ok(match, `only node placement may change: ${change.path}`);
    assert.ok(Number.isFinite(change.value));
    copy.nodes[Number(match[1])][match[2]] = change.value;
  }
  assert.deepEqual(withoutPositions(copy), withoutPositions(workflow));
  return copy;
}

test('failed workflow offers a complete optional placement repair without applying it', () => {
  const input = fixture(), original = structuredClone(input);
  const result = compileWorkflow({ workflow: input, qualityProfile: 'showcase' });
  assert.equal(result.ok, false);
  assert.deepEqual(input, original);
  const repair = findRepair(result);
  assert.ok(repair, JSON.stringify(result.diagnostics));
  assert.equal(repair.scope, 'complete-workflow-compile');
  const diagnostic = result.diagnostics.find(d => d.evidence?.verifiedRepair === repair);
  assert.match(diagnostic.supportedFixes[0], /if node columns and row offsets are flexible/);
  assert.match(diagnostic.supportedFixes[0], /browser verification and visual review still required/);
  const repaired = applyRepair(input, repair);
  const success = compileWorkflow({ workflow: repaired, qualityProfile: 'showcase' });
  assert.equal(success.ok, true, JSON.stringify(success.diagnostics));
  assert.equal(success.receipt.nodes.length, input.nodes.length);
  assert.equal(success.receipt.edges.length, input.edges.length);
  assert.equal(findRepair(success), undefined);
});

test('placement patch indexes follow authored node order and do not depend on domain IDs', () => {
  const input = fixture();
  const names = new Map(input.nodes.map((n, i) => [n.id, `step-${i}`]));
  input.nodes = input.nodes.map(n => ({ ...n, id: names.get(n.id) })).reverse();
  input.edges = input.edges.map(e => ({ ...e, from: names.get(e.from), to: names.get(e.to) })).reverse();
  input.mainPath = input.mainPath.map(id => names.get(id));
  input.semanticChecks.allowedRoots = input.semanticChecks.allowedRoots.map(id => names.get(id));
  input.semanticChecks.allowedTerminals = input.semanticChecks.allowedTerminals.map(id => names.get(id));
  input.semanticChecks.requiredPaths = input.semanticChecks.requiredPaths.map(p => ({ from: names.get(p.from), to: names.get(p.to) }));
  const result = compileWorkflow({ workflow: input, qualityProfile: 'showcase' });
  const repair = findRepair(result);
  assert.ok(repair, JSON.stringify(result.diagnostics));
  assert.equal(compileWorkflow({ workflow: applyRepair(input, repair), qualityProfile: 'showcase' }).ok, true);
});

test('standard acceptance and an authored canvas do not acquire placement suggestions', () => {
  const input = fixture();
  assert.equal(findRepair(compileWorkflow({ workflow: input, qualityProfile: 'standard' })), undefined);
  input.meta.viewBox = [1200, 1600];
  const original = structuredClone(input);
  assert.equal(findRepair(compileWorkflow({ workflow: input, qualityProfile: 'showcase' })), undefined);
  assert.deepEqual(input, original);
});

test('a proposed route repair that still fails text checks is not advertised as complete', () => {
  const input = fixture();
  input.nodes.find(n => n.id === 'retry').label = 'W'.repeat(30);
  const result = compileWorkflow({ workflow: input, qualityProfile: 'showcase' });
  assert.equal(result.ok, false);
  assert.equal(findRepair(result), undefined);
});

test('source and brand context survives scaled optional placement repair probes', async t => {
  const { sourceTypographyFixture, runWorkflow, sourceEvidencePayload } = await import('./helpers/workflow-typography.mjs');
  const source = sourceTypographyFixture(t, { scale: 1.01 });
  const input = fixture();
  input.meta.typography_scale = 1.01;
  input.meta.repository = source.diagram.meta.repository;
  Object.assign(input.nodes[0], { brand: 'openai', sources: [{ path: 'source.js', line: 1 }] });
  const options = { repoRoot: source.root, quality: 'showcase' };
  const failed = runWorkflow(t, input, 'validate', options);
  assert.equal(failed.status, 1, failed.stdout + failed.stderr);
  const repair = findRepair(failed.receipt);
  assert.ok(repair, failed.stdout);
  const repaired = applyRepair(input, repair);
  const rendered = runWorkflow(t, repaired, 'render', options);
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
  assert.match(rendered.svg, /data-brand-mark="openai"/);
  assert.equal(sourceEvidencePayload(rendered.html).referenceCount, 1);
});
