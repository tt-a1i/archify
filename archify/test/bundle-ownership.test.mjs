import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateOwnershipSubset } from '../bundle/diagram-bundle.mjs';
import { disposeBundleFixture, stageBundleFixture } from './helpers/bundle-fixture.mjs';
import { OWNERSHIP_SUBSET_CASES } from './helpers/ownership-subset-cases.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');

const manifest = {
  entry: 'checkout-platform',
  drilldowns: [{ parent: 'checkout-platform', component: 'payments', child: 'payments' }],
  diagrams: [{ id: 'checkout-platform', file: 'checkout-platform.html' }],
};

function sidecar(overrides) {
  return {
    schema_version: 1,
    kind: 'ownership',
    map: 'checkout-platform.json',
    components: [{ id: 'payments', globs: ['src/payments/**'] }],
    ...overrides,
  };
}

function sidecarsFor(testCase) {
  const parent = sidecar({
    excluded: testCase.parentExcluded,
    components: [{ id: 'payments', globs: testCase.parentGlobs }],
  });
  const child = sidecar({
    map: 'payments.json',
    parent: { map: 'checkout-platform.json', component: 'payments' },
    components: [{ id: 'api', globs: testCase.childGlobs }],
    excluded: testCase.childExcluded,
  });
  return { parent, child };
}

for (const testCase of OWNERSHIP_SUBSET_CASES) {
  test(`validateOwnershipSubset: ${testCase.name}`, () => {
    const { parent, child } = sidecarsFor(testCase);
    const failures = validateOwnershipSubset(manifest, child, parent);
    if (testCase.ok) {
      assert.deepEqual(failures, []);
    } else {
      assert.ok(failures.some((item) => item.includes('bundle/ownership-not-subset') && item.includes(testCase.glob)), failures.join('\n'));
    }
  });
}

test('unified subset table through archify bundle --check', () => {
  const dir = stageBundleFixture({ prefix: 'archify-bundle-subset-' });
  try {
    for (const testCase of OWNERSHIP_SUBSET_CASES) {
      const { parent, child } = sidecarsFor(testCase);
      fs.writeFileSync(path.join(dir, 'checkout-platform.ownership.json'), `${JSON.stringify(parent, null, 2)}\n`);
      fs.writeFileSync(path.join(dir, 'payments.ownership.json'), `${JSON.stringify(child, null, 2)}\n`);
      const bytes = fs.readFileSync(path.join(dir, 'payments.ownership.json'));
      const manifestPath = path.join(dir, 'manifest.json');
      const listed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      listed.ownership = {
        file: 'payments.ownership.json',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      const manifestText = `${JSON.stringify(listed, null, 2)}\n`;
      fs.writeFileSync(manifestPath, manifestText);
      const onDisk = fs.readFileSync(manifestPath, 'utf8');
      const entry = fs.readFileSync(path.join(dir, 'checkout-platform.html'), 'utf8');
      fs.writeFileSync(path.join(dir, 'checkout-platform.html'), entry.replace(
        /<script id="archify-bundle-manifest" type="application\/json">[\s\S]*?<\/script>/,
        `<script id="archify-bundle-manifest" type="application/json">${onDisk}</script>`,
      ));
      const result = spawnSync(process.execPath, [cli, 'bundle', dir, '--check', '--json'], {
        cwd: skillRoot,
        encoding: 'utf8',
      });
      if (testCase.ok) {
        assert.equal(result.status, 0, `${testCase.name}\n${result.stderr}\n${result.stdout}`);
      } else {
        assert.notEqual(result.status, 0, testCase.name);
        assert.match(`${result.stdout}\n${result.stderr}`, /bundle\/ownership-not-subset/);
        assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(testCase.glob.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      }
    }
  } finally {
    disposeBundleFixture(dir);
  }
});

test('validateOwnershipSubset rejects an object-map components sidecar', () => {
  const parent = sidecar({});
  const child = {
    schema_version: 1,
    kind: 'ownership',
    map: 'payments.json',
    parent: { map: 'checkout-platform.json', component: 'payments' },
    components: { api: { globs: ['src/payments/api/**'] } },
  };
  const failures = validateOwnershipSubset(manifest, child, parent);
  assert.ok(failures.some((item) => item.includes('bundle/ownership-not-subset')));
});

test('validateOwnershipSubset rejects archify/scripts/*.mjs as covering archify/scripts/**', () => {
  const parent = sidecar({
    components: [{ id: 'payments', globs: ['archify/scripts/*.mjs'] }],
  });
  const child = sidecar({
    map: 'payments.json',
    parent: { map: 'checkout-platform.json', component: 'payments' },
    components: [{ id: 'scripts', globs: ['archify/scripts/**'] }],
  });
  const failures = validateOwnershipSubset(manifest, child, parent);
  assert.ok(
    failures.some((item) => item.includes('bundle/ownership-not-subset') && item.includes('scripts')),
    failures.join('\n'),
  );
});
