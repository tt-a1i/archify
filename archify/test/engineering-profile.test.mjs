import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deploymentOwnershipDiagnostics,
  validateEngineeringProfile,
} from '../renderers/shared/engineering-profiles.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const examplePath = path.join(skillRoot, 'examples', 'production-deployment.architecture.json');
const example = JSON.parse(fs.readFileSync(examplePath, 'utf8'));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validateJson(input, output) {
  return spawnSync(process.execPath, [cli, 'validate', 'architecture', input, '--json'], {
    cwd: path.dirname(output),
    encoding: 'utf8',
  });
}

test('deployment ownership profile passes the checked production example and stays opt-in', () => {
  assert.equal(example.meta.engineering_profile, 'deployment-ownership');
  assert.deepEqual(deploymentOwnershipDiagnostics(example), []);
  assert.doesNotThrow(() => validateEngineeringProfile('architecture', example));

  const ordinary = clone(example);
  delete ordinary.meta.engineering_profile;
  ordinary.boundaries = [];
  ordinary.components.forEach((component) => { delete component.tag; });
  assert.doesNotThrow(() => validateEngineeringProfile('architecture', ordinary));
});

test('deployment ownership profile reports exact owners, scopes, state, and crossing mechanisms', () => {
  const candidate = clone(example);
  delete candidate.components.find((component) => component.id === 'edge').tag;
  candidate.boundaries.find((boundary) => boundary.label.includes('us-east-1')).wraps =
    candidate.boundaries.find((boundary) => boundary.label.includes('us-east-1')).wraps.filter((id) => id !== 'edge');
  candidate.boundaries.find((boundary) => boundary.label === 'private application network').wraps =
    candidate.boundaries.find((boundary) => boundary.label === 'private application network').wraps.filter((id) => id !== 'redis');
  const crossing = candidate.connections.find((connection) => connection.from === 'gateway' && connection.to === 'api_a');
  crossing.label = '';

  const diagnostics = deploymentOwnershipDiagnostics(candidate);
  const codes = new Set(diagnostics.map((entry) => entry.code));
  assert.ok(codes.has('engineering/deployment-owner-missing'));
  assert.ok(codes.has('engineering/deployment-region-scope'));
  assert.ok(codes.has('engineering/deployment-private-state'));
  assert.ok(codes.has('engineering/deployment-crossing-mechanism'));

  const boundaryDiagnostic = diagnostics.find((entry) => entry.code === 'engineering/deployment-crossing-mechanism');
  assert.equal(boundaryDiagnostic.subject.collection, 'connections');
  assert.equal(boundaryDiagnostic.evidence.from, 'gateway');
  assert.equal(boundaryDiagnostic.evidence.to, 'api_a');
  assert.ok(boundaryDiagnostic.evidence.crossedBoundaries.some((boundary) => boundary.kind === 'security-group'));
  assert.deepEqual(boundaryDiagnostic.supportedFixes, [
    `set /connections/${boundaryDiagnostic.subject.index}/label to the real cross-boundary mechanism`,
  ]);
});

test('deployment ownership profile requires both region and private boundary kinds', () => {
  const candidate = clone(example);
  candidate.boundaries = candidate.boundaries.filter((boundary) => boundary.kind === 'region');
  const diagnostics = deploymentOwnershipDiagnostics(candidate);
  assert.ok(diagnostics.some((entry) => entry.code === 'engineering/deployment-boundary-kind'
    && entry.evidence.requiredKind === 'security-group'));
});

test('deployment ownership profile rejects ambiguous regions and cross-region private groups', () => {
  const candidate = clone(example);
  const secondRegion = candidate.boundaries.find((boundary) => boundary.label.includes('eu-west-1'));
  secondRegion.wraps.push('api_a');
  const diagnostics = deploymentOwnershipDiagnostics(candidate);
  assert.ok(diagnostics.some((entry) => entry.code === 'engineering/deployment-region-ambiguous'
    && entry.subject.id === 'api_a'));
  assert.ok(diagnostics.some((entry) => entry.code === 'engineering/deployment-private-region-consistency'
    && entry.subject.collection === 'boundaries'));
});

test('deployment ownership crossing math follows authored membership instead of geometry or labels', () => {
  const cases = [
    ['outside to region', 'clients', 'edge'],
    ['region to region', 'postgres', 'replica'],
    ['public to private', 'gateway', 'api_a'],
    ['private to public', 'worker', 'audit'],
  ];
  for (const [name, from, to] of cases) {
    const candidate = clone(example);
    candidate.connections.forEach((connection) => {
      connection.label ||= 'same-scope relation';
    });
    const connection = candidate.connections.find((entry) => entry.from === from && entry.to === to);
    connection.label = '';
    const crossings = deploymentOwnershipDiagnostics(candidate)
      .filter((diagnostic) => diagnostic.code === 'engineering/deployment-crossing-mechanism');
    assert.equal(crossings.length, 1, name);
    assert.equal(crossings[0].evidence.from, from, name);
    assert.equal(crossings[0].evidence.to, to, name);
  }

  const sameScope = clone(example);
  sameScope.connections.forEach((connection) => {
    connection.label ||= 'same-scope relation';
  });
  sameScope.connections.find((connection) => connection.from === 'api_a' && connection.to === 'redis').label = '';
  sameScope.connections.push({ from: 'api_a', to: 'api_a', label: '' });
  assert.ok(!deploymentOwnershipDiagnostics(sameScope)
    .some((diagnostic) => diagnostic.code === 'engineering/deployment-crossing-mechanism'));
});

test('other diagram modes reject the architecture-only engineering profile', () => {
  const fixtures = [
    ['workflow', 'agent-tool-call.workflow.json'],
    ['sequence', 'cache-miss-request.sequence.json'],
    ['dataflow', 'product-analytics.dataflow.json'],
    ['lifecycle', 'agent-run.lifecycle.json'],
  ];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-engineering-schema-'));
  try {
    for (const [mode, fixture] of fixtures) {
      const candidate = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', fixture), 'utf8'));
      candidate.meta.engineering_profile = 'deployment-ownership';
      const input = path.join(tmp, `${mode}.json`);
      fs.writeFileSync(input, JSON.stringify(candidate));
      const result = spawnSync(process.execPath, [cli, 'validate', mode, input, '--json'], {
        cwd: tmp,
        encoding: 'utf8',
      });
      assert.notEqual(result.status, 0, mode);
      const receipt = JSON.parse(result.stdout);
      assert.ok(receipt.diagnostics.some((diagnostic) => diagnostic.code === 'schema/additionalProperties'), mode);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('validate and deliver expose one truthful engineering-profile receipt', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-engineering-profile-'));
  try {
    const invalidPath = path.join(tmp, 'invalid.architecture.json');
    const invalid = clone(example);
    const crossing = invalid.connections.find((connection) => connection.from === 'gateway' && connection.to === 'api_a');
    crossing.label = '';
    fs.writeFileSync(invalidPath, JSON.stringify(invalid, null, 2));

    const preservedOutput = path.join(tmp, 'preserved.html');
    const preservedBytes = Buffer.from('last known good deployment');
    fs.writeFileSync(preservedOutput, preservedBytes);
    const failedDelivery = spawnSync(process.execPath, [
      cli, 'deliver', 'architecture', invalidPath, preservedOutput, '--json',
    ], { cwd: tmp, encoding: 'utf8' });
    assert.notEqual(failedDelivery.status, 0);
    assert.equal(fs.readFileSync(preservedOutput).equals(preservedBytes), true);

    const failed = validateJson(invalidPath, path.join(tmp, 'unused.html'));
    assert.notEqual(failed.status, 0);
    assert.equal(failed.stderr, '');
    const failure = JSON.parse(failed.stdout);
    assert.equal(failure.ok, false);
    assert.equal(failure.stage, 'render');
    assert.ok(failure.diagnostics.some((entry) => entry.code === 'engineering/deployment-crossing-mechanism'));

    const validated = spawnSync(process.execPath, [cli, 'validate', 'architecture', examplePath, '--json'], {
      cwd: tmp,
      encoding: 'utf8',
    });
    assert.equal(validated.status, 0, validated.stderr);
    assert.equal(JSON.parse(validated.stdout).engineeringProfile, 'deployment-ownership');

    const output = path.join(tmp, 'deployment.html');
    const delivered = spawnSync(process.execPath, [cli, 'deliver', 'architecture', examplePath, output, '--json'], {
      cwd: tmp,
      encoding: 'utf8',
    });
    assert.equal(delivered.status, 0, delivered.stderr);
    const receipt = JSON.parse(delivered.stdout);
    assert.equal(receipt.validation.engineeringProfile, 'deployment-ownership');
    assert.match(fs.readFileSync(output, 'utf8'), /data-engineering-profile="deployment-ownership"/);

    const secondOutput = path.join(tmp, 'deployment-second.html');
    const repeated = spawnSync(process.execPath, [
      cli, 'deliver', 'architecture', examplePath, secondOutput, '--json',
    ], { cwd: tmp, encoding: 'utf8' });
    assert.equal(repeated.status, 0, repeated.stderr);
    const digest = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    assert.equal(digest(output), digest(secondOutput));

    const ordinaryInput = path.join(skillRoot, 'examples', 'web-app.architecture.json');
    const ordinaryOutput = path.join(tmp, 'ordinary.html');
    const ordinary = spawnSync(process.execPath, [
      cli, 'render', 'architecture', ordinaryInput, ordinaryOutput,
    ], { cwd: tmp, encoding: 'utf8' });
    assert.equal(ordinary.status, 0, ordinary.stderr);
    assert.doesNotMatch(fs.readFileSync(ordinaryOutput, 'utf8'), /data-engineering-profile=/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
