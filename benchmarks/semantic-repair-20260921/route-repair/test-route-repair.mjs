import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { repair } from './route-repair.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const shortInterior = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/short-interior-route.architecture.json'), 'utf8'));

function withoutVia(document) {
  const copy = structuredClone(document);
  for (const connection of copy.connections ?? []) delete connection.via;
  return copy;
}

test('automatic short interior segment is repaired through measured local corridor evidence', () => {
  const result = repair(shortInterior);
  assert.equal(result.status, 'repaired', result.reasons?.join(' '));
  assert.deepEqual(result.receipt.initialDiagnosticCodes, ['composition/short-interior-segment']);
  assert.deepEqual(result.receipt.selectedConnection, { index: 1, id: 'ac' });
  assert.equal(result.receipt.trialCount, 1);
  assert.equal(result.receipt.attempts[0].recipe, 'measured-local-detour');
  assert.equal(result.receipt.attempts[0].ok, true);
  assert.equal(result.receipt.finalizeRequired, true);
  assert.deepEqual(withoutVia(result.candidate), withoutVia(shortInterior), 'repair may only add the diagnosed route geometry');
  assert.deepEqual(result.candidate.connections.map((connection) => connection.id), shortInterior.connections.map((connection) => connection.id));
  assert.equal(result.quality.ok, true);
  assert.equal(result.quality.candidateSha256, result.quality.validationReceipt.candidate.sha256, 'acceptance is bound to the exact candidate bytes');
  assert.equal(result.quality.validationReceipt.composition.summary.errors, 0);
  assert.equal(result.quality.validationReceipt.composition.summary.warnings, 0);
  assert.ok(result.quality.validationReceipt.checks.every((check) => check.ok));
});

test('already valid candidate is a no-op', () => {
  const input = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'No-op route', quality_profile: 'showcase', viewBox: [480, 320] },
    components: [
      { id: 'client', type: 'frontend', label: 'Client', pos: [40, 100], size: [120, 60] },
      { id: 'api', type: 'backend', label: 'API', pos: [280, 100], size: [120, 60] },
    ],
    connections: [{ id: 'request', from: 'client', to: 'api' }],
  };
  const result = repair(input);
  assert.equal(result.status, 'unchanged');
  assert.deepEqual(result.candidate, input);
  assert.equal(result.receipt.trialCount, 0);
  assert.equal(result.quality.ok, true);
});

test('authored route controls are protected before any repair trial', () => {
  const input = structuredClone(shortInterior);
  input.connections[1].via = [[20, 124], [20, 236]];
  const result = repair(input);
  assert.equal(result.status, 'declined');
  assert.match(result.reasons.join(' '), /authored route controls/);
  assert.equal(result.receipt.trialCount, 0);
});

test('unsupported or non-geometric failures decline rather than broadening the repair', () => {
  const nonGeometric = structuredClone(shortInterior);
  nonGeometric.components[0].sublabel = 'A deliberately long detail that exceeds this authored component width';
  const nonGeometricResult = repair(nonGeometric);
  assert.equal(nonGeometricResult.status, 'declined');
  assert.match(nonGeometricResult.reasons.join(' '), /non-route diagnostics: layout\/constraint/);

  const unsupported = { ...shortInterior, diagram_type: 'dataflow' };
  const unsupportedResult = repair(unsupported);
  assert.equal(unsupportedResult.status, 'declined');
  assert.match(unsupportedResult.reasons.join(' '), /only architecture diagrams/);
});
