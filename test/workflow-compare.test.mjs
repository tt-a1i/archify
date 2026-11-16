import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const cli = path.resolve('archify/bin/archify.mjs');

function run(base, head, outputName) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-compare-'));
  const basePath = path.join(directory, 'base.json');
  const headPath = path.join(directory, 'head.json');
  fs.writeFileSync(basePath, JSON.stringify(base));
  fs.writeFileSync(headPath, JSON.stringify(head));
  const args = [cli, 'compare', 'workflow', basePath, headPath];
  if (outputName) args.push(outputName === 'base' ? basePath : path.join(directory, outputName));
  args.push('--json');
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  fs.rmSync(directory, { recursive: true, force: true });
  return { result, receipt: JSON.parse(result.stdout) };
}

function fixture() {
  return JSON.parse(fs.readFileSync('archify/examples/agent-tool-call.workflow.json', 'utf8'));
}

test('Workflow compare reports authored semantic changes and ignores coordinates', () => {
  const base = fixture();
  const head = structuredClone(base);
  head.nodes[0].col = (head.nodes[0].col || 0) + 1;
  head.nodes[0].label = 'Changed';
  const { result, receipt } = run(base, head);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(receipt.changes.nodes.map(change => [change.id, change.change]), [['user', 'modified']]);
  assert.deepEqual(receipt.changes.edges, []);
});

test('Workflow compare ignores presentation-only fields and remains deterministic', () => {
  const base = fixture();
  const head = structuredClone(base);
  const detached = head.nodes.find(node => !head.mainPath.includes(node.id));
  detached.col = detached.col > 0 ? detached.col - 1 : detached.col + 1;
  head.nodes[0].yOffset = 4;
  Object.assign(base.edges[0], { via: [[90, 100]], channelY: 200 });
  Object.assign(head.edges[0], {
    via: [[110, 120]], channelX: 130, channelY: 240, labelAt: [140, 150],
    fromSide: 'left', toSide: 'right', route: 'up-channel', labelSegment: 1,
    labelDx: 8, labelDy: 3, bias: 0.2, width: 3,
  });
  const first = run(base, head).receipt;
  const second = run(base, head).receipt;
  assert.deepEqual(first.changes, { lanes: [], phases: [], groups: [], nodes: [], edges: [], mainPath: [], semanticChecks: [] });
  assert.deepEqual(first, second);
  head.edges[0].label = 'New transition';
  head.edges[0].role = base.edges[0].role === 'async' ? 'return' : 'async';
  const { result, receipt } = run(base, head);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(receipt.changes.edges.length, 1);
  assert.equal(receipt.changes.edges[0].head.label, 'New transition');
  assert.equal(receipt.changes.edges[0].head.role, head.edges[0].role);
  assert.equal(Object.hasOwn(receipt.changes.edges[0].head, 'via'), false);
});

test('Workflow compare reports phase and group column-range changes', () => {
  const base = fixture();
  const head = structuredClone(base);
  head.groups[0].fromCol += 1;
  head.groups[0].toCol += 1;
  const compared = run(base, head);
  assert.equal(compared.result.status, 0, compared.result.stderr);
  assert.deepEqual(compared.receipt.changes.groups.map(change => [change.id, change.change]), [[base.groups[0].id, 'modified']]);
  assert.notEqual(compared.receipt.changes.groups[0].base.fromCol, compared.receipt.changes.groups[0].head.fromCol);

  const unchanged = structuredClone(base);
  unchanged.groups[0].label = base.groups[0].label;
  assert.deepEqual(run(base, unchanged).receipt.changes.groups, []);
});

test('Workflow compare reports lane labels', () => {
  const base = fixture();
  const head = structuredClone(base);
  head.lanes[0].label = 'Renamed lane';
  const compared = run(base, head);
  assert.equal(compared.result.status, 0, compared.result.stderr);
  assert.deepEqual(compared.receipt.changes.lanes.map(change => [change.id, change.change]), [[base.lanes[0].id, 'modified']]);
});

test('Workflow compare usage errors preserve inputs and other destinations', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-compare-options-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const basePath = path.join(directory, 'base.json');
  const headPath = path.join(directory, 'head.json');
  const unrelated = path.join(directory, 'readme.txt');
  const original = JSON.stringify(fixture());
  fs.writeFileSync(basePath, original);
  fs.writeFileSync(headPath, original);
  fs.writeFileSync(unrelated, 'do not replace');
  const args = [cli, 'compare', 'workflow', basePath, headPath];
  for (const rest of [[basePath, '--unknown'], [headPath, 'extra.json'], [unrelated, '--unknown']]) {
    const result = spawnSync(process.execPath, [...args, ...rest, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).code, 'workflow/usage');
    assert.equal(fs.readFileSync(basePath, 'utf8'), original);
    assert.equal(fs.readFileSync(headPath, 'utf8'), original);
    assert.equal(fs.readFileSync(unrelated, 'utf8'), 'do not replace');
  }
  const human = spawnSync(process.execPath, [...args, '--unknown'], { encoding: 'utf8' });
  assert.equal(human.status, 1);
  assert.match(human.stderr, /Usage: compare workflow/u);
});

test('Workflow compare rejects invalid inputs with stable diagnostics', () => {
  const base = fixture();
  const invalid = structuredClone(base);
  invalid.diagram_type = 'architecture';
  const { result, receipt } = run(base, invalid);
  assert.equal(result.status, 1);
  assert.equal(receipt.code, 'workflow/type');
});

test('Workflow compare reports main path changes and rejects dangling endpoints', () => {
  const base = fixture();
  const changedPath = structuredClone(base);
  changedPath.mainPath = changedPath.mainPath.slice(0, -1);
  const pathResult = run(base, changedPath);
  assert.equal(pathResult.result.status, 0, pathResult.result.stderr);
  assert.equal(pathResult.receipt.changes.mainPath.length, 1);

  const invalid = structuredClone(base);
  invalid.edges[0].to = 'missing-node';
  const invalidResult = run(base, invalid);
  assert.equal(invalidResult.result.status, 1);
  assert.equal(invalidResult.receipt.code, 'workflow/head-invalid');
  assert.equal(invalidResult.receipt.diagnostics[0].code, 'workflow/unknown-endpoint');
});

test('Workflow compare rejects non-JSON and input-alias outputs before writing', () => {
  const base = fixture();
  const html = run(base, base, 'comparison.html');
  assert.equal(html.result.status, 1);
  assert.equal(html.receipt.code, 'output/cli-extension');
  const alias = run(base, base, 'base');
  assert.equal(alias.result.status, 1);
  assert.equal(alias.receipt.code, 'output/cli-alias');
});

test('Workflow compare returns a receipt when the output parent is a file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-compare-output-parent-'));
  try {
    const base = fixture();
    const basePath = path.join(directory, 'base.json');
    const headPath = path.join(directory, 'head.json');
    const blocker = path.join(directory, 'blocker');
    fs.writeFileSync(basePath, JSON.stringify(base));
    fs.writeFileSync(headPath, JSON.stringify(base));
    fs.writeFileSync(blocker, 'do not replace');
    const result = spawnSync(process.execPath, [cli, 'compare', 'workflow', basePath, headPath, path.join(blocker, 'receipt.json'), '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(JSON.parse(result.stdout).code, 'output/cli-resolve');
    assert.equal(fs.readFileSync(blocker, 'utf8'), 'do not replace');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Workflow compare reports filesystem failures and cleans its temporary receipt', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-compare-write-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const basePath = path.join(directory, 'base.json');
  const headPath = path.join(directory, 'head.json');
  const blocked = path.join(directory, 'blocked.json');
  const destination = path.join(directory, 'receipt.json');
  const original = JSON.stringify(fixture());
  fs.writeFileSync(basePath, original);
  fs.writeFileSync(headPath, original);
  fs.mkdirSync(blocked);
  const args = [cli, 'compare', 'workflow', basePath, headPath];
  for (const [output, code] of [[path.join(directory, 'missing', 'receipt.json'), 'output/cli-resolve'], [blocked, 'output/cli-write']]) {
    const result = spawnSync(process.execPath, [...args, output, '--json'], { encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr);
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.ok, false);
    assert.equal(failure.diagnostics[0].code, code);
    assert.deepEqual(fs.readdirSync(directory).sort(), ['base.json', 'blocked.json', 'head.json']);
  }
  assert.ok(fs.statSync(blocked).isDirectory());
  const successful = spawnSync(process.execPath, [...args, destination, '--json'], { encoding: 'utf8' });
  assert.equal(successful.status, 0, successful.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(destination, 'utf8')), JSON.parse(successful.stdout));
});

test('Workflow compare reports normalized semantic-check changes', () => {
  const base = fixture();
  base.semanticChecks = {
    allowedRoots: ['store', 'user', 'user'],
    requiredEdges: [{ from: 'user', to: 'chat' }, { from: 'user', to: 'chat' }],
  };
  const reordered = structuredClone(base);
  reordered.semanticChecks = {
    requiredEdges: [{ from: 'user', to: 'chat' }],
    allowedRoots: ['user', 'store'],
  };
  assert.deepEqual(run(base, reordered).receipt.changes.semanticChecks, []);

  const changed = structuredClone(reordered);
  changed.semanticChecks.requiredPaths = [{ from: 'user', to: 'final' }];
  const receipt = run(base, changed).receipt;
  assert.deepEqual(receipt.changes.semanticChecks, [{
    change: 'modified',
    base: { allowedRoots: ['store', 'user'], requiredEdges: [{ from: 'user', to: 'chat' }] },
    head: { allowedRoots: ['store', 'user'], requiredEdges: [{ from: 'user', to: 'chat' }], requiredPaths: [{ from: 'user', to: 'final' }] },
  }]);
  assert.equal(receipt.summary.semanticChecks, 1);

  const empty = structuredClone(reordered);
  empty.semanticChecks.requiredEdges = [];
  empty.semanticChecks.requiredPaths = [];
  const omitted = structuredClone(reordered);
  delete omitted.semanticChecks.requiredEdges;
  assert.deepEqual(run(empty, omitted).receipt.changes.semanticChecks, []);

  const caseOrder = structuredClone(reordered);
  caseOrder.semanticChecks.requiredEdges = [{ from: 'i', to: 'user' }, { from: 'I', to: 'user' }];
  const ordered = run(reordered, caseOrder).receipt;
  assert.deepEqual(ordered.changes.semanticChecks[0].head.requiredEdges, [{ from: 'I', to: 'user' }, { from: 'i', to: 'user' }]);
});

test('Workflow compare rejects a resolved non-JSON receipt destination', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-compare-output-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const basePath = path.join(directory, 'base.json');
  const headPath = path.join(directory, 'head.json');
  const protectedPath = path.join(directory, 'protected.html');
  const receiptPath = path.join(directory, 'receipt.json');
  const base = fixture();
  fs.writeFileSync(basePath, JSON.stringify(base));
  fs.writeFileSync(headPath, JSON.stringify(base));
  fs.writeFileSync(protectedPath, 'do not replace');
  try {
    fs.symlinkSync(protectedPath, receiptPath, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) return t.skip(`symlink support is unavailable: ${error.code}`);
    throw error;
  }
  const result = spawnSync(process.execPath, [cli, 'compare', 'workflow', basePath, headPath, receiptPath, '--json'], { encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).code, 'output/cli-resolved-extension');
  assert.equal(fs.readFileSync(protectedPath, 'utf8'), 'do not replace');
});

test('Workflow compare prints semantic details outside JSON mode', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-compare-human-'));
  try {
    const base = fixture();
    const head = structuredClone(base);
    head.nodes[0].label = 'Changed';
    const basePath = path.join(directory, 'base.json');
    const headPath = path.join(directory, 'head.json');
    fs.writeFileSync(basePath, JSON.stringify(base));
    fs.writeFileSync(headPath, JSON.stringify(head));
    const result = spawnSync(process.execPath, [cli, 'compare', 'workflow', basePath, headPath], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Workflow changes: 1\n/u);
    assert.match(result.stdout, /"nodes"/u);
    assert.match(result.stdout, /"Changed"/u);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('Workflow compare prints stable diagnostics outside JSON mode', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-compare-diagnostics-'));
  try {
    const base = fixture();
    const head = structuredClone(base);
    head.edges[0].to = 'missing-node';
    const basePath = path.join(directory, 'base.json');
    const headPath = path.join(directory, 'head.json');
    fs.writeFileSync(basePath, JSON.stringify(base));
    fs.writeFileSync(headPath, JSON.stringify(head));
    const result = spawnSync(process.execPath, [cli, 'compare', 'workflow', basePath, headPath], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /workflow\/unknown-endpoint/u);
    assert.match(result.stderr, /missing-node/u);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
