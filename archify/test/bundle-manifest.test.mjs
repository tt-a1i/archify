import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { BundleError, buildBundleManifest, bundleRendererEnv, extractBundleManifestText, validateBundle } from '../bundle/diagram-bundle.mjs';
import { disposeBundleFixture, stageBundleFixture } from './helpers/bundle-fixture.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('buildBundleManifest writes a schema-valid manifest and a byte-identical entry embed', () => {
  const dir = stageBundleFixture({ prefix: 'archify-bundle-manifest-' });
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.equal(manifest.entry, 'checkout-platform');
    assert.equal(manifest.max_depth, 2);
    assert.equal(manifest.diagrams.length, 3);
    assert.ok(manifest.drilldowns.some((row) => row.component === 'payments' && row.child === 'payments'));
    assert.ok(manifest.drilldowns.some((row) => row.component === 'queue' && row.child === 'ledger-flow'));
    const entryHtml = fs.readFileSync(path.join(dir, 'checkout-platform.html'), 'utf8');
    const embedded = extractBundleManifestText(entryHtml);
    assert.equal(embedded, fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    assert.deepEqual(validateBundle(dir), { ok: true, checksPassed: 10, checkCount: 10 });
  } finally {
    disposeBundleFixture(dir);
  }
});

test('bundleRendererEnv supplies ARCHIFY_REPO_ROOT from the git top-level', () => {
  const repoRoot = path.resolve(skillRoot, '..');
  const env = bundleRendererEnv(repoRoot, { PATH: process.env.PATH });
  assert.equal(env.ARCHIFY_REPO_ROOT, repoRoot);
  const inherited = bundleRendererEnv(repoRoot, { PATH: process.env.PATH, ARCHIFY_REPO_ROOT: '/tmp/explicit-root' });
  assert.equal(inherited.ARCHIFY_REPO_ROOT, '/tmp/explicit-root');
});

test('buildBundleManifest requires <entryId>.ownership.json when other sidecars exist', () => {
  const dir = stageBundleFixture({ prefix: 'archify-bundle-own-missing-' });
  try {
    fs.writeFileSync(path.join(dir, 'aaa.ownership.json'), '{}\n');
    fs.writeFileSync(path.join(dir, 'zzz.ownership.json'), '{}\n');
    assert.throws(
      () => buildBundleManifest(dir),
      (error) => error instanceof BundleError
        && error.details.failures.some((item) => String(item).includes('bundle/ownership-missing: checkout-platform.ownership.json')),
    );
  } finally {
    disposeBundleFixture(dir);
  }
});
