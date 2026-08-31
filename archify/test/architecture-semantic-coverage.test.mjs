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

test('architecture semantic coverage reports omitted components, edges, paths, and external labels', () => {
  const coverage = evaluateArchitectureSemanticCoverage(incompleteArchitecture());

  assert.equal(coverage.status, 'warn');
  assert.equal(coverage.summary.warnings, 4);
  assert.deepEqual(coverage.diagnostics.map((entry) => entry.code), [
    'architecture/semantic-required-component',
    'architecture/semantic-required-edge',
    'architecture/semantic-required-path',
    'architecture/semantic-external-label',
  ]);
});

test('architecture semantic coverage accepts explicit reasoned omissions', () => {
  const architecture = incompleteArchitecture();
  architecture.semanticChecks.omissions = [
    { kind: 'component', id: 'scheduler', reason: 'Not deployed in the inspected runtime profile.' },
    { kind: 'edge', from: 'api', to: 'ingestion', reason: 'Handled by an out-of-scope gateway.' },
    { kind: 'path', from: 'api', to: 'mail', reason: 'The user requested only the ingestion boundary.' },
    { kind: 'external-label', from: 'ingestion', to: 'mail', reason: 'Protocol is selected at deployment time.' },
  ];

  const coverage = evaluateArchitectureSemanticCoverage(architecture);
  assert.equal(coverage.status, 'pass');
  assert.equal(coverage.summary.warnings, 0);
  assert.deepEqual(coverage.diagnostics, []);
  assert.equal(coverage.omissions.length, 4);
});

test('architecture semantic coverage is opt-in', () => {
  const architecture = incompleteArchitecture();
  delete architecture.semanticChecks;
  assert.equal(evaluateArchitectureSemanticCoverage(architecture), null);
});

test('architecture semantic coverage rejects omissions without a reason', () => {
  const architecture = incompleteArchitecture();
  architecture.semanticChecks.omissions = [{ kind: 'component', id: 'scheduler', reason: '' }];
  assert.throws(() => validateSchema('architecture', architecture), /semanticChecks\/omissions/);
});

test('validate embeds semantic coverage and exposes non-blocking warnings in its receipt', () => {
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
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
