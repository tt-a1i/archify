import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const benchmarkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(benchmarkRoot, 'matched-ab.mjs');
const observerPath = path.join(benchmarkRoot, 'test', 'fixtures', 'observer.mjs');
const schemaRoot = path.join(benchmarkRoot, 'schemas');

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd ?? benchmarkRoot,
    encoding: 'utf8',
    env: { ...process.env, ...options.env },
  });
}

function createGitFixture() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-matched-ab-repo-'));
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'fixed source\n');
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 'Archify Benchmark'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 'benchmark@example.invalid'], { cwd: repoRoot });
  execFileSync('git', ['add', 'README.md'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repoRoot });
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
  return { repoRoot, revision };
}

test('quality gate reports every lost semantic fact, node, message, and view', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-matched-ab-quality-'));
  const baselinePath = path.join(tempRoot, 'baseline.json');
  const candidatePath = path.join(tempRoot, 'candidate.json');

  writeJson(baselinePath, {
    facts: ['fact:source', 'fact:sink'],
    nodes: ['node:api', 'node:db'],
    messages: ['message:request', 'message:reply'],
    views: ['view:light-desktop', 'view:dark-mobile'],
  });
  writeJson(candidatePath, {
    facts: ['fact:source'],
    nodes: ['node:api'],
    messages: ['message:request'],
    views: ['view:light-desktop'],
  });

  const result = runCli([
    'quality',
    '--baseline', baselinePath,
    '--candidate', candidatePath,
  ]);

  assert.equal(result.status, 2);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.deepEqual(report.missing, {
    facts: ['fact:sink'],
    nodes: ['node:db'],
    messages: ['message:reply'],
    views: ['view:dark-mobile'],
  });
});

test('quality gate accepts an exact semantic baseline plus additive detail', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-matched-ab-quality-pass-'));
  const baselinePath = path.join(tempRoot, 'baseline.json');
  const candidatePath = path.join(tempRoot, 'candidate.json');
  const baseline = {
    facts: ['fact:source'],
    nodes: ['node:api'],
    messages: ['message:request'],
    views: ['view:light-desktop'],
  };
  writeJson(baselinePath, baseline);
  writeJson(candidatePath, {
    facts: [...baseline.facts, 'fact:latency'],
    nodes: [...baseline.nodes, 'node:cache'],
    messages: [...baseline.messages, 'message:reply'],
    views: [...baseline.views, 'view:dark-mobile'],
  });

  const result = runCli([
    'quality',
    '--baseline', baselinePath,
    '--candidate', candidatePath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);
});

test('machine harness runs warmup plus multi-round ABBA and reports paired statistics', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-matched-ab-run-'));
  const { repoRoot, revision } = createGitFixture();
  const manifestPath = path.join(tempRoot, 'manifest.json');
  const receiptPath = path.join(tempRoot, 'receipt.json');

  writeJson(manifestPath, {
    schemaVersion: 'archify.matched-ab.manifest.v1',
    benchmarkId: 'fixture-machine-abba',
    machine: {
      command: [process.execPath, observerPath],
      warmupPerVariant: 1,
      rounds: 2,
      order: 'ABBA',
      timeoutMs: 2000,
      env: {},
      runtime: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      fixedConfig: {
        projectRevision: 'pi-fixture-revision',
        diagramSet: ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'],
      },
      variants: {
        A: { label: 'baseline', cwd: repoRoot, revision },
        B: { label: 'candidate', cwd: repoRoot, revision },
      },
    },
    quality: {
      semanticCoverage: {
        facts: ['fact:source', 'fact:sink'],
        nodes: ['node:api', 'node:db'],
        messages: ['message:request', 'message:reply'],
        views: ['view:light-desktop', 'view:dark-mobile'],
      },
    },
  });

  const result = runCli([
    'run',
    '--manifest', manifestPath,
    '--receipt', receiptPath,
  ]);

  assert.equal(result.status, 0, result.stderr);
  const receipt = readJson(receiptPath);
  assert.equal(receipt.schemaVersion, 'archify.matched-ab.receipt.v1');
  assert.equal(receipt.manifest.benchmarkId, 'fixture-machine-abba');
  assert.equal(receipt.runs.filter((run) => run.phase === 'warmup').length, 2);
  const measured = receipt.runs.filter((run) => run.phase === 'measure');
  assert.equal(measured.length, 8);
  assert.deepEqual(
    measured.filter((run) => run.round === 1).map((run) => run.variant),
    ['A', 'B', 'B', 'A'],
  );
  assert.deepEqual(
    measured.filter((run) => run.round === 2).map((run) => run.variant),
    ['A', 'B', 'B', 'A'],
  );
  assert.equal(receipt.summary.A.samples, 4);
  assert.equal(receipt.summary.B.samples, 4);
  assert.equal(receipt.summary.paired.samples, 4);
  assert.ok(receipt.summary.A.medianMs > receipt.summary.B.medianMs);
  assert.ok(receipt.summary.A.p95Ms >= receipt.summary.A.medianMs);
  assert.ok(receipt.summary.paired.medianDeltaMs < 0);
  assert.ok(receipt.summary.paired.medianDeltaPercent < 0);
  assert.equal(receipt.quality.ok, true);
  assert.equal(receipt.provenance.sources.A.revision, revision);
  assert.equal(receipt.provenance.sources.B.revision, revision);
  assert.equal(receipt.provenance.runtime.nodeVersion, process.version);
  assert.match(receipt.provenance.fixedConfigSha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.provenance.manifestSha256, /^[a-f0-9]{64}$/);
});

test('machine harness fails closed when either variant loses semantic coverage', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-matched-ab-loss-'));
  const { repoRoot, revision } = createGitFixture();
  const manifestPath = path.join(tempRoot, 'manifest.json');
  const receiptPath = path.join(tempRoot, 'receipt.json');
  writeJson(manifestPath, {
    schemaVersion: 'archify.matched-ab.manifest.v1',
    benchmarkId: 'fixture-semantic-loss',
    machine: {
      command: [process.execPath, observerPath],
      warmupPerVariant: 0,
      rounds: 1,
      order: 'ABBA',
      timeoutMs: 2000,
      env: {},
      runtime: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      fixedConfig: { dropSemanticCoverageFor: 'B' },
      variants: {
        A: { cwd: repoRoot, revision },
        B: { cwd: repoRoot, revision },
      },
    },
    quality: {
      semanticCoverage: {
        facts: ['fact:source', 'fact:sink'],
        nodes: ['node:api', 'node:db'],
        messages: ['message:request', 'message:reply'],
        views: ['view:light-desktop', 'view:dark-mobile'],
      },
    },
  });

  const result = runCli([
    'run',
    '--manifest', manifestPath,
    '--receipt', receiptPath,
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /lost semantic coverage/);
  assert.equal(fs.existsSync(receiptPath), false);
});

test('machine harness rejects a source revision mismatch before timing commands', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-matched-ab-revision-'));
  const { repoRoot, revision } = createGitFixture();
  const manifestPath = path.join(tempRoot, 'manifest.json');
  const receiptPath = path.join(tempRoot, 'receipt.json');
  writeJson(manifestPath, {
    schemaVersion: 'archify.matched-ab.manifest.v1',
    benchmarkId: 'fixture-revision-mismatch',
    machine: {
      command: [process.execPath, observerPath],
      warmupPerVariant: 0,
      rounds: 1,
      order: 'ABBA',
      timeoutMs: 2000,
      env: {},
      runtime: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      fixedConfig: { projectRevision: 'fixed-project-revision' },
      variants: {
        A: { cwd: repoRoot, revision: '0'.repeat(40) },
        B: { cwd: repoRoot, revision },
      },
    },
    quality: {
      semanticCoverage: {
        facts: ['fact:source'],
        nodes: ['node:api'],
        messages: ['message:request'],
        views: ['view:light-desktop'],
      },
    },
  });

  const result = runCli([
    'run',
    '--manifest', manifestPath,
    '--receipt', receiptPath,
  ]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /A revision mismatch/);
  assert.equal(fs.existsSync(receiptPath), false);
});

test('agentic receipt validator accepts observed runs and rejects synthetic repeats', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-agentic-receipt-'));
  const manifestPath = path.join(tempRoot, 'agentic-manifest.json');
  const receiptPath = path.join(tempRoot, 'agentic-receipt.json');
  const digest = 'a'.repeat(64);
  const fixedInputs = {
    projectRevision: 'pi-e86823096c5bad39e1ca282ec24bc5eb9bec745b',
    archifyRevision: 'b6e7cf9d65b5a0ef9214de1a564247ec071882a2',
    skillSha256: digest,
    promptSha256: digest,
    configSha256: digest,
    runtimeSha256: digest,
    model: 'configured-model',
    reasoningEffort: 'configured-effort',
  };
  writeJson(manifestPath, {
    schemaVersion: 'archify.agentic-ab.manifest.v1',
    benchmarkId: 'pi-five-diagram-agentic',
    runId: 'run-a-001',
    variant: 'A',
    executionMode: 'observed-agent-run',
    fixedInputs,
  });
  writeJson(receiptPath, {
    schemaVersion: 'archify.agentic-ab.receipt.v1',
    benchmarkId: 'pi-five-diagram-agentic',
    runId: 'run-a-001',
    variant: 'A',
    measurement: { kind: 'observed', clock: 'epoch-ms' },
    fixedInputs,
    startedAtEpochMs: 1000,
    endedAtEpochMs: 1450,
    durationMs: 450,
    stages: [
      { name: 'author', startedAtEpochMs: 1000, endedAtEpochMs: 1300, durationMs: 300 },
      { name: 'validate', startedAtEpochMs: 1300, endedAtEpochMs: 1450, durationMs: 150 },
    ],
    artifactSha256: digest,
    qualityReceiptSha256: digest,
  });

  const accepted = runCli([
    'validate-agentic',
    '--manifest', manifestPath,
    '--receipt', receiptPath,
  ]);
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).ok, true);

  const synthetic = readJson(receiptPath);
  synthetic.measurement.kind = 'synthetic';
  writeJson(receiptPath, synthetic);
  const rejected = runCli([
    'validate-agentic',
    '--manifest', manifestPath,
    '--receipt', receiptPath,
  ]);
  assert.equal(rejected.status, 2);
  assert.match(JSON.parse(rejected.stdout).errors.join('\n'), /measurement.kind must be observed/);

  synthetic.measurement.kind = 'observed';
  synthetic.syntheticRepeats = [{ durationMs: 1 }];
  writeJson(receiptPath, synthetic);
  const invented = runCli([
    'validate-agentic',
    '--manifest', manifestPath,
    '--receipt', receiptPath,
  ]);
  assert.equal(invented.status, 2);
  assert.match(JSON.parse(invented.stdout).errors.join('\n'), /syntheticRepeats is not allowed/);
});

test('published machine and agentic contracts are valid JSON schemas', () => {
  const expected = [
    'agentic-manifest.schema.json',
    'agentic-receipt.schema.json',
    'machine-manifest.schema.json',
    'machine-receipt.schema.json',
  ];
  assert.deepEqual(fs.readdirSync(schemaRoot).sort(), expected);
  for (const fileName of expected) {
    const schema = readJson(path.join(schemaRoot, fileName));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.match(schema.$id, /^https:\/\/archify\.dev\/schemas\/matched-ab\//);
    assert.equal(schema.type, 'object');
  }
});

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
