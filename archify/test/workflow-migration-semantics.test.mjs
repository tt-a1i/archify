import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { intrinsicWorkflow, planningWorkflow } from '../renderers/workflow/workflow-migration-geometry.mjs';
import { compileWorkflow } from '../renderers/workflow/workflow-compiler.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const contracts = {
  requiredEdges: [{ from: 'a', to: 'b' }],
  requiredPaths: [{ from: 'a', to: 'b' }],
  allowedRoots: ['a', 'c', 'obstacle'],
  allowedTerminals: ['b', 'd', 'obstacle'],
};

function document(semanticChecks) {
  return {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Fallback semantic contract', output: 'fallback.html', viewBox: [720, 520], legend: { mode: 'hidden' } },
    lanes: [
      { id: 'pin', label: 'Pinned label' },
      { id: 'straight', label: 'Straight constraint' },
      { id: 'blocker', label: 'Blocker' },
    ],
    nodes: [
      { id: 'a', lane: 'pin', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'pin', col: 1, type: 'backend', label: 'B' },
      { id: 'c', lane: 'straight', col: 0, type: 'backend', label: 'C' },
      { id: 'd', lane: 'straight', col: 1, type: 'backend', label: 'D' },
      { id: 'obstacle', lane: 'blocker', col: 4, type: 'database', label: 'Obstacle' },
    ],
    mainPath: ['a', 'b'],
    semanticChecks: structuredClone(semanticChecks),
    edges: [
      { id: 'pin-edge', from: 'a', to: 'b', label: 'p', labelAt: [562, 367], route: 'bottom-channel', fromSide: 'bottom', toSide: 'bottom' },
      { id: 'straight-edge', from: 'c', to: 'd', label: 'x', route: 'straight' },
    ],
  };
}

function fixture(t, checks) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-migration-semantics-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'source.workflow.json');
  const destination = path.join(root, 'destination.workflow.json');
  const original = document(checks);
  const bytes = Buffer.from(`${JSON.stringify(original, null, 2)}\n`);
  fs.writeFileSync(source, bytes);
  return { root, source, destination, original, bytes };
}

function run(command, source, destination) {
  const result = spawnSync(process.execPath, [
    cli, command, 'workflow', source,
    ...(command === 'migrate' ? [destination, '--to-schema', '2'] : []), '--json',
  ], { cwd: skillRoot, encoding: 'utf8', timeout: 30000 });
  assert.ifError(result.error);
  return { ...result, report: JSON.parse(result.stdout) };
}

for (const [name, checks] of [...Object.entries(contracts).map(([key, value]) => [key, { [key]: value }]), ['combined contracts', contracts]]) {
  test(`fallback migration preserves valid ${name}`, { timeout: 60000 }, (t) => {
    const data = fixture(t, checks);
    const validated = run('validate', data.source);
    assert.equal(validated.status, 0, validated.stderr || validated.stdout);
    const result = run('migrate', data.source, data.destination);
    assert.deepEqual(fs.readFileSync(data.source), data.bytes, 'source bytes must remain unchanged');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.report.ok, true);
    const output = fs.readFileSync(data.destination);
    const migrated = JSON.parse(output);
    assert.equal(migrated.schema_version, 2);
    assert.deepEqual(migrated.semanticChecks, checks);
    assert.deepEqual(migrated.mainPath, data.original.mainPath);
    assert.deepEqual(migrated.edges[0].labelAt, [643.52, 367]);
    const expected = structuredClone(data.original);
    expected.schema_version = 2;
    expected.edges[0].labelAt[0] = 643.52;
    // Capacity expansion is allowed; no other authored field may change.
    expected.meta.viewBox = migrated.meta.viewBox;
    assert.deepEqual(migrated, expected);
    assert.ok(migrated.meta.viewBox.every((value, index) => value >= data.original.meta.viewBox[index]));
    assert.deepEqual(result.report.changedCoordinates, [{ path: '/edges/0/labelAt/0', from: 562, to: 643.52 }]);
    assert.deepEqual(result.report.newSchemaDiagnostics, []);
    assert.equal(result.report.source.sha256, hash(data.bytes));
    assert.equal(result.report.destination.sha256, hash(output));
    const destinationValidation = run('validate', data.destination);
    assert.equal(destinationValidation.status, 0, destinationValidation.stdout);

    if (name === 'combined contracts') {
      const repeated = path.join(data.root, 'repeated.workflow.json');
      const repeat = run('migrate', data.destination, repeated);
      assert.equal(repeat.status, 0, repeat.stderr || repeat.stdout);
      assert.deepEqual(fs.readFileSync(repeated), output, 'schema-v2 migration must be byte-idempotent');
      assert.deepEqual(fs.readFileSync(data.destination), output);
      assert.deepEqual(repeat.report.changedCoordinates, []);
    }
  });
}

for (const [field, value, code] of [
  ['requiredEdges', [{ from: 'a', to: 'c' }], 'workflow/required-edge'],
  ['requiredPaths', [{ from: 'b', to: 'a' }], 'workflow/required-path'],
  ['allowedRoots', ['c', 'obstacle'], 'workflow/unexpected-root'],
  ['allowedTerminals', ['d', 'obstacle'], 'workflow/unexpected-terminal'],
]) {
  test(`authored invalid ${field} still rejects validation and migration`, { timeout: 60000 }, (t) => {
    const data = fixture(t, { [field]: value });
    const previous = Buffer.from('{"existing":"trusted destination"}\n');
    fs.writeFileSync(data.destination, previous);
    for (const command of ['validate', 'migrate']) {
      const result = run(command, data.source, data.destination);
      assert.notEqual(result.status, 0);
      assert.equal(result.report.ok, false);
      assert.ok(result.report.diagnostics.some((entry) => entry.code === code), result.stdout);
      assert.deepEqual(fs.readFileSync(data.source), data.bytes);
      assert.deepEqual(fs.readFileSync(data.destination), previous);
    }
    assert.equal(fs.readdirSync(data.root).some((name) => name.startsWith('.archify-migration-')), false);
  });
}

test('only the incomplete planning projection omits semantic contracts without mutating the source', () => {
  const authored = document(contracts);
  const before = structuredClone(authored);
  const intrinsic = intrinsicWorkflow(authored);
  assert.deepEqual(intrinsic.semanticChecks, contracts);
  assert.deepEqual(intrinsic.edges, authored.edges);
  assert.equal(compileWorkflow({ workflow: intrinsic }).ok, false, 'legacy absolute pins require fallback planning');
  const planned = planningWorkflow(authored);
  assert.deepEqual(planned.edges.map(({ id }) => id), ['straight-edge']);
  assert.equal(planned.mainPath, undefined);
  assert.equal(planned.semanticChecks, undefined);
  assert.equal(compileWorkflow({ workflow: planned }).ok, true);
  assert.deepEqual(authored, before);
});

test('planning keeps semantic contracts when it retains every authored edge', () => {
  const authored = document(contracts);
  authored.edges[0] = { id: 'pin-edge', from: 'a', to: 'b', label: 'p', route: 'auto' };
  const before = structuredClone(authored);
  const planned = planningWorkflow(authored);
  assert.deepEqual(planned.semanticChecks, contracts);
  assert.deepEqual(planned.edges.map(({ id }) => id), authored.edges.map(({ id }) => id));
  assert.deepEqual(planned.mainPath, authored.mainPath);
  assert.equal(compileWorkflow({ workflow: planned }).ok, true);
  assert.deepEqual(authored, before);
});
