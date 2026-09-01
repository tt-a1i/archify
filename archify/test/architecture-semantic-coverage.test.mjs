import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateArchitectureSemanticCoverage } from '../renderers/architecture/semantic-coverage.mjs';
import { validateSchema } from '../renderers/shared/validator.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-coverage-'));

function incompleteArchitecture() {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Semantic coverage fixture', viewBox: [800, 300] },
    semanticChecks: {
      requiredComponents: ['scheduler'],
      requiredEdges: [{ from: 'api', to: 'ingestion' }],
      requiredPaths: [{ from: 'api', to: 'mail' }],
      requireExternalLabels: true,
    },
    components: [
      { id: 'operator', type: 'external', label: 'Operator', pos: [40, 100] },
      { id: 'api', type: 'backend', label: 'API', pos: [220, 100] },
      { id: 'ingestion', type: 'backend', label: 'Ingestion', pos: [400, 100] },
      { id: 'mail', type: 'external', label: 'Mail Provider', pos: [580, 100] },
    ],
    connections: [
      { from: 'operator', to: 'api', label: 'POST /run' },
      { from: 'ingestion', to: 'mail' },
    ],
  };
}

function completeArchitecture() {
  const architecture = incompleteArchitecture();
  architecture.semanticChecks = {
    requiredComponents: ['api'],
    requiredEdges: [{ from: 'operator', to: 'api' }],
    requiredPaths: [{ from: 'operator', to: 'api' }],
    requireExternalLabels: true,
  };
  architecture.connections[1].label = 'SMTP send';
  return architecture;
}

function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function repositoryBackedSchedulerFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-discovery-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'api.js'), 'export function handleRequest() {}\n');
  fs.writeFileSync(path.join(root, 'src', 'scheduler.js'), 'export function runScheduler() {}\n');
  git(root, ['init']);
  git(root, ['config', 'user.name', 'Archify Tests']);
  git(root, ['config', 'user.email', 'archify@example.test']);
  git(root, ['remote', 'add', 'origin', 'https://github.com/example/semantic-discovery.git']);
  git(root, ['add', 'src']);
  git(root, ['commit', '-m', 'fixture']);
  const revision = git(root, ['rev-parse', 'HEAD']);
  const input = path.join(root, 'input.architecture.json');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Repository semantic discovery fixture',
      viewBox: [600, 240],
      repository: { url: 'https://github.com/example/semantic-discovery', revision },
    },
    components: [{
      id: 'api',
      type: 'backend',
      label: 'API',
      pos: [220, 90],
      sources: [{ path: 'src/api.js', line: 1 }],
    }],
    connections: [],
  }, null, 2));
  return { root, input };
}

test('architecture semantic coverage records represented and missing requirements with evidence', () => {
  const coverage = evaluateArchitectureSemanticCoverage(incompleteArchitecture());

  assert.equal(coverage.status, 'warn');
  assert.deepEqual(coverage.summary, {
    checked: 5,
    represented: 1,
    missing: 4,
    omitted: 0,
    warnings: 4,
  });
  assert.deepEqual(coverage.requirements.map((entry) => entry.status), [
    'missing',
    'missing',
    'missing',
    'represented',
    'missing',
  ]);
  assert.deepEqual(coverage.diagnostics.map((entry) => entry.code), [
    'architecture/semantic-required-component',
    'architecture/semantic-required-edge',
    'architecture/semantic-required-path',
    'architecture/semantic-external-label',
  ]);
  for (const entry of coverage.diagnostics) {
    assert.equal(entry.subject.diagramType, 'architecture');
    assert.ok(entry.evidence && typeof entry.evidence === 'object');
    assert.ok(Array.isArray(entry.supportedFixes) && entry.supportedFixes.length > 0);
  }
});

test('passing coverage receipt preserves every represented requirement', () => {
  const coverage = evaluateArchitectureSemanticCoverage(completeArchitecture());

  assert.equal(coverage.status, 'pass');
  assert.deepEqual(coverage.summary, {
    checked: 5,
    represented: 5,
    missing: 0,
    omitted: 0,
    warnings: 0,
  });
  assert.equal(coverage.requirements.length, 5);
  assert.ok(coverage.requirements.every((entry) => entry.status === 'represented'));
  assert.deepEqual(
    coverage.requirements.find((entry) => entry.subject.kind === 'path').evidence.path,
    ['operator', 'api'],
  );
});

test('architecture semantic coverage accepts explicit reasoned omissions and audits them', () => {
  const architecture = incompleteArchitecture();
  architecture.semanticChecks.omissions = [
    { kind: 'component', id: 'scheduler', reason: 'Not deployed in the inspected runtime profile.' },
    { kind: 'edge', from: 'api', to: 'ingestion', reason: 'Handled by an out-of-scope gateway.' },
    { kind: 'path', from: 'api', to: 'mail', reason: 'The user requested only the ingestion boundary.' },
    { kind: 'external-label', from: 'ingestion', to: 'mail', reason: 'Protocol is selected at deployment time.' },
  ];

  const coverage = evaluateArchitectureSemanticCoverage(architecture);
  assert.equal(coverage.status, 'pass');
  assert.deepEqual(coverage.summary, {
    checked: 5,
    represented: 1,
    missing: 0,
    omitted: 4,
    warnings: 0,
  });
  assert.deepEqual(coverage.diagnostics, []);
  assert.equal(coverage.requirements.filter((entry) => entry.status === 'omitted').length, 4);
  assert.equal(
    coverage.requirements.find((entry) => entry.status === 'omitted').evidence.reason,
    architecture.semanticChecks.omissions[0].reason,
  );
});

test('architecture semantic coverage is opt-in', () => {
  const architecture = incompleteArchitecture();
  delete architecture.semanticChecks;
  assert.equal(evaluateArchitectureSemanticCoverage(architecture), null);
});

test('repository-backed validation discovers an omitted scheduler through the public CLI', () => {
  const fixture = repositoryBackedSchedulerFixture();
  try {
    const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', fixture.input, '--repo-root', fixture.root, '--json'], {
      cwd: tmp,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.ok, true);
    assert.equal(receipt.composition.semanticCoverage.status, 'warn');
    assert.deepEqual(receipt.composition.semanticCoverage.summary, {
      checked: 1,
      represented: 0,
      missing: 1,
      omitted: 0,
      warnings: 1,
    });
    const [requirement] = receipt.composition.semanticCoverage.requirements;
    assert.equal(requirement.status, 'missing');
    assert.equal(requirement.subject.sourcePath, 'src/scheduler.js');
    assert.equal(requirement.subject.discoveredKind, 'scheduler');
    assert.equal(requirement.evidence.discovery.detection, 'runtime-source-path');
    const [warning] = receipt.composition.issues.filter((entry) => (
      entry.code === 'architecture/semantic-discovered-lifecycle-component'
    ));
    assert.equal(warning.code, 'architecture/semantic-discovered-lifecycle-component');
    assert.equal(warning.subject.sourcePath, 'src/scheduler.js');
    assert.equal(warning.subject.discoveredKind, 'scheduler');
    assert.equal(warning.evidence.discovery.detection, 'runtime-source-path');
    assert.ok(warning.supportedFixes.length > 0);

    const intentionallyOmitted = JSON.parse(fs.readFileSync(fixture.input, 'utf8'));
    intentionallyOmitted.semanticChecks = {
      omissions: [{
        kind: 'repository-component',
        path: 'src/scheduler.js',
        reason: 'The scheduler is disabled in the reviewed deployment profile.',
      }],
    };
    fs.writeFileSync(fixture.input, JSON.stringify(intentionallyOmitted, null, 2));
    const omittedResult = spawnSync(process.execPath, [cli, 'validate', 'architecture', fixture.input, '--repo-root', fixture.root, '--json'], {
      cwd: tmp,
      encoding: 'utf8',
    });
    assert.equal(omittedResult.status, 0, omittedResult.stderr || omittedResult.stdout);
    const omittedReceipt = JSON.parse(omittedResult.stdout);
    assert.equal(omittedReceipt.composition.semanticCoverage.status, 'pass');
    assert.equal(omittedReceipt.composition.semanticCoverage.requirements[0].status, 'omitted');
    assert.equal(omittedReceipt.composition.semanticCoverage.requirements[0].evidence.reason, intentionallyOmitted.semanticChecks.omissions[0].reason);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('required self-path passes only when the authored endpoint exists', () => {
  const architecture = incompleteArchitecture();
  architecture.semanticChecks = { requiredPaths: [{ from: 'missing', to: 'missing' }] };
  const missing = evaluateArchitectureSemanticCoverage(architecture);
  assert.equal(missing.status, 'warn');
  assert.equal(missing.requirements[0].status, 'missing');
  assert.deepEqual(missing.requirements[0].evidence, {
    fromExists: false,
    toExists: false,
    reachableNodes: [],
  });

  architecture.semanticChecks = { requiredPaths: [{ from: 'api', to: 'api' }] };
  const represented = evaluateArchitectureSemanticCoverage(architecture);
  assert.equal(represented.status, 'pass');
  assert.deepEqual(represented.requirements[0].evidence, { path: ['api'], hopCount: 0 });
});

test('architecture semantic coverage rejects empty and whitespace-only omission reasons', () => {
  for (const omission of [
    { kind: 'component', id: 'scheduler', reason: '' },
    { kind: 'component', id: 'scheduler', reason: '   ' },
    { kind: 'edge', from: 'api', to: 'ingestion', reason: '\t' },
    { kind: 'path', from: 'api', to: 'mail', reason: '\n' },
    { kind: 'external-label', from: 'ingestion', to: 'mail', reason: '  \t  ' },
    { kind: 'repository-component', path: 'src/scheduler.js', reason: '\n' },
  ]) {
    const architecture = incompleteArchitecture();
    architecture.semanticChecks.omissions = [omission];
    assert.throws(
      () => validateSchema('architecture', architecture),
      /semanticChecks\/omissions/,
      JSON.stringify(omission),
    );
  }
});

test('validate embeds the auditable coverage ledger and non-blocking warnings in its receipt', () => {
  const input = path.join(tmp, 'incomplete.architecture.json');
  fs.writeFileSync(input, JSON.stringify(incompleteArchitecture(), null, 2));

  const result = spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--json'], {
    cwd: tmp,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.composition.metrics.semanticCoverageWarnings, 4);
  assert.ok(receipt.composition.summary.warnings >= 4);
  assert.deepEqual(receipt.composition.semanticCoverage.summary, {
    checked: 5,
    represented: 1,
    missing: 4,
    omitted: 0,
    warnings: 4,
  });
  assert.equal(receipt.composition.semanticCoverage.requirements.length, 5);
  assert.deepEqual(
    receipt.composition.issues
      .filter((entry) => entry.code.startsWith('architecture/semantic-'))
      .map((entry) => entry.code),
    [
      'architecture/semantic-required-component',
      'architecture/semantic-required-edge',
      'architecture/semantic-required-path',
      'architecture/semantic-external-label',
    ],
  );
  for (const entry of receipt.composition.issues.filter((item) => item.code.startsWith('architecture/semantic-'))) {
    assert.ok(entry.evidence && typeof entry.evidence === 'object');
    assert.ok(Array.isArray(entry.supportedFixes) && entry.supportedFixes.length > 0);
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
