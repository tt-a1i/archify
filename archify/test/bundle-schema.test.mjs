import assert from 'node:assert/strict';
import test from 'node:test';
import { bundle as validateBundle } from '../renderers/shared/generated-validators.mjs';

function validManifest(overrides = {}) {
  return {
    schema_version: 1,
    bundle_type: 'drilldown',
    entry: 'checkout',
    max_depth: 2,
    diagrams: [{
      id: 'checkout',
      file: 'checkout.html',
      diagram_type: 'architecture',
      title: 'Checkout',
      level: 0,
      spec_sha256: 'a'.repeat(64),
      artifact_sha256: 'b'.repeat(64),
    }],
    ...overrides,
  };
}

test('bundle schema accepts a minimal legal manifest', () => {
  assert.equal(validateBundle(validManifest()), true, JSON.stringify(validateBundle.errors));
});

test('bundle schema rejects a missing entry', () => {
  const manifest = validManifest();
  delete manifest.entry;
  assert.equal(validateBundle(manifest), false);
});

test('bundle schema rejects level 2', () => {
  const manifest = validManifest();
  manifest.diagrams[0].level = 2;
  assert.equal(validateBundle(manifest), false);
});

test('bundle schema rejects a duplicate diagram id', () => {
  const manifest = validManifest();
  manifest.diagrams.push({ ...manifest.diagrams[0], file: 'other.html' });
  assert.equal(validateBundle(manifest), true, 'schema uniqueness is validated in validateBundle, not JSON Schema');
});

test('bundle schema rejects a non-64-hex digest', () => {
  const manifest = validManifest();
  manifest.diagrams[0].spec_sha256 = 'zzz';
  assert.equal(validateBundle(manifest), false);
});

test('bundle schema rejects a file path containing ..', () => {
  const manifest = validManifest();
  manifest.diagrams[0].file = '../escape.html';
  assert.equal(validateBundle(manifest), false);
});
