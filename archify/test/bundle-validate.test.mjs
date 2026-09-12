import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { BundleError, validateBundle } from '../bundle/diagram-bundle.mjs';
import { disposeBundleFixture, stageBundleFixture } from './helpers/bundle-fixture.mjs';

function stage() {
  return stageBundleFixture({ prefix: 'archify-bundle-validate-' });
}

function patchManifest(dir, mutate) {
  const file = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  mutate(manifest);
  fs.writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

function expectFailure(dir, snippet) {
  assert.throws(
    () => validateBundle(dir),
    (error) => error instanceof BundleError
      && error.code === 'bundle/invalid'
      && error.details.failures.some((item) => String(item).includes(snippet)),
  );
}

test('validateBundle is all-green on a freshly built fixture bundle', () => {
  const dir = stage();
  try {
    const result = validateBundle(dir);
    assert.deepEqual(result, { ok: true, checksPassed: 10, checkCount: 10 });
    assert.equal(result.checksPassed, result.checkCount);
  } finally {
    disposeBundleFixture(dir);
  }
});

test('validateBundle fails schema when entry is missing', () => {
  const dir = stage();
  try {
    patchManifest(dir, (manifest) => { delete manifest.entry; });
    expectFailure(dir, 'bundle/schema');
  } finally {
    disposeBundleFixture(dir);
  }
});

test('validateBundle fails when the entry is not level 0', () => {
  const dir = stage();
  try {
    patchManifest(dir, (manifest) => {
      const entry = manifest.diagrams.find((item) => item.id === manifest.entry);
      entry.level = 1;
    });
    expectFailure(dir, 'bundle/entry-level');
  } finally {
    disposeBundleFixture(dir);
  }
});

test('validateBundle fails on a duplicate diagram id', () => {
  const dir = stage();
  try {
    patchManifest(dir, (manifest) => {
      manifest.diagrams.push({ ...manifest.diagrams[1], file: 'copy.html' });
      fs.writeFileSync(path.join(dir, 'copy.html'), '<svg></svg>');
      fs.writeFileSync(path.join(dir, 'copy.json'), fs.readFileSync(path.join(dir, `${manifest.diagrams[1].id}.json`)));
    });
    expectFailure(dir, 'bundle/duplicate-id');
  } finally {
    disposeBundleFixture(dir);
  }
});

test('validateBundle fails when data-bundle attributes do not match', () => {
  const dir = stage();
  try {
    const htmlPath = path.join(dir, 'payments.html');
    const html = fs.readFileSync(htmlPath, 'utf8').replace(/data-bundle-id="payments"/, 'data-bundle-id="nope"');
    fs.writeFileSync(htmlPath, html);
    const sha = createHash('sha256').update(fs.readFileSync(htmlPath)).digest('hex');
    patchManifest(dir, (manifest) => {
      manifest.diagrams.find((item) => item.id === 'payments').artifact_sha256 = sha;
    });
    expectFailure(dir, 'bundle/child-stale');
  } finally {
    disposeBundleFixture(dir);
  }
});

test('validateBundle fails when spec bytes no longer match spec_sha256', () => {
  const dir = stage();
  try {
    const specPath = path.join(dir, 'payments.json');
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    spec.meta.title = 'Stale title';
    fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    expectFailure(dir, 'bundle/child-stale');
  } finally {
    disposeBundleFixture(dir);
  }
});

test('validateBundle fails when the embedded manifest is not byte-identical', () => {
  const dir = stage();
  try {
    const htmlPath = path.join(dir, 'checkout-platform.html');
    const html = fs.readFileSync(htmlPath, 'utf8').replace(
      /<script id="archify-bundle-manifest" type="application\/json">[\s\S]*?<\/script>/,
      '<script id="archify-bundle-manifest" type="application/json">{"stale":true}</script>',
    );
    fs.writeFileSync(htmlPath, html);
    expectFailure(dir, 'bundle/embed-mismatch');
  } finally {
    disposeBundleFixture(dir);
  }
});

test('validateBundle fails when a drilldown component is not in the entry', () => {
  const dir = stage();
  try {
    patchManifest(dir, (manifest) => {
      manifest.drilldowns.push({ parent: 'checkout-platform', component: 'missing', child: 'payments' });
    });
    expectFailure(dir, 'bundle/drilldown-component');
  } finally {
    disposeBundleFixture(dir);
  }
});

test('validateBundle fails when a diagram exceeds the 12-node cap', () => {
  const dir = stage();
  try {
    const specPath = path.join(dir, 'payments.json');
    const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    for (let index = spec.components.length; index < 13; index += 1) {
      spec.components.push({
        id: `extra${index}`,
        type: 'backend',
        label: `Extra ${index}`,
        pos: [40, 40],
        size: [80, 40],
      });
    }
    fs.writeFileSync(specPath, `${JSON.stringify(spec, null, 2)}\n`);
    const specSha = createHash('sha256').update(fs.readFileSync(specPath)).digest('hex');
    const htmlPath = path.join(dir, 'payments.html');
    const html = fs.readFileSync(htmlPath, 'utf8').replace(
      /data-bundle-spec-sha256="[a-f0-9]{64}"/,
      `data-bundle-spec-sha256="${specSha}"`,
    );
    fs.writeFileSync(htmlPath, html);
    const artifactSha = createHash('sha256').update(fs.readFileSync(htmlPath)).digest('hex');
    patchManifest(dir, (manifest) => {
      const row = manifest.diagrams.find((item) => item.id === 'payments');
      row.spec_sha256 = specSha;
      row.artifact_sha256 = artifactSha;
    });
    const entry = fs.readFileSync(path.join(dir, 'checkout-platform.html'), 'utf8');
    const manifestText = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
    fs.writeFileSync(path.join(dir, 'checkout-platform.html'), entry.replace(
      /<script id="archify-bundle-manifest" type="application\/json">[\s\S]*?<\/script>/,
      `<script id="archify-bundle-manifest" type="application/json">${manifestText}</script>`,
    ));
    expectFailure(dir, 'bundle/node-cap');
  } finally {
    disposeBundleFixture(dir);
  }
});

test('validateBundle reports checksPassed === checkCount - 1 when one check fails', () => {
  const dir = stage();
  try {
    const htmlPath = path.join(dir, 'payments.html');
    const html = fs.readFileSync(htmlPath, 'utf8').replace(
      /data-node-id="api"/,
      'data-node-id="api" data-drilldown-child="nope"',
    );
    fs.writeFileSync(htmlPath, html);
    const artifactSha = createHash('sha256').update(fs.readFileSync(htmlPath)).digest('hex');
    patchManifest(dir, (manifest) => {
      manifest.diagrams.find((item) => item.id === 'payments').artifact_sha256 = artifactSha;
    });
    const entry = fs.readFileSync(path.join(dir, 'checkout-platform.html'), 'utf8');
    const manifestText = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
    fs.writeFileSync(path.join(dir, 'checkout-platform.html'), entry.replace(
      /<script id="archify-bundle-manifest" type="application\/json">[\s\S]*?<\/script>/,
      `<script id="archify-bundle-manifest" type="application/json">${manifestText}</script>`,
    ));
    try {
      validateBundle(dir);
      assert.fail('expected validateBundle to fail');
    } catch (error) {
      assert.ok(error instanceof BundleError);
      assert.equal(error.details.checkCount, 10);
      assert.equal(error.details.checksPassed, error.details.checkCount - 1);
      assert.ok(error.details.failures.some((item) => String(item).includes('bundle/child-mark')));
    }
  } finally {
    disposeBundleFixture(dir);
  }
});

test('validateBundle fails when a child HTML still has a drilldown mark', () => {
  const dir = stage();
  try {
    const htmlPath = path.join(dir, 'payments.html');
    const html = fs.readFileSync(htmlPath, 'utf8').replace(
      /data-node-id="api"/,
      'data-node-id="api" data-drilldown-child="nope"',
    );
    fs.writeFileSync(htmlPath, html);
    const artifactSha = createHash('sha256').update(fs.readFileSync(htmlPath)).digest('hex');
    patchManifest(dir, (manifest) => {
      manifest.diagrams.find((item) => item.id === 'payments').artifact_sha256 = artifactSha;
    });
    const entry = fs.readFileSync(path.join(dir, 'checkout-platform.html'), 'utf8');
    const manifestText = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
    fs.writeFileSync(path.join(dir, 'checkout-platform.html'), entry.replace(
      /<script id="archify-bundle-manifest" type="application\/json">[\s\S]*?<\/script>/,
      `<script id="archify-bundle-manifest" type="application/json">${manifestText}</script>`,
    ));
    expectFailure(dir, 'bundle/child-mark');
  } finally {
    disposeBundleFixture(dir);
  }
});

test('validateBundle fails when an ownership sidecar is not a subset', () => {
  const dir = stage();
  try {
    const parent = {
      schema_version: 1,
      kind: 'ownership',
      map: 'checkout-platform.json',
      components: [{ id: 'payments', globs: ['src/payments/**'] }],
      excluded: ['dist/**'],
    };
    const child = {
      schema_version: 1,
      kind: 'ownership',
      map: 'payments.json',
      parent: { map: 'checkout-platform.json', component: 'payments' },
      components: [{ id: 'api', globs: ['src/checkout/**'] }],
      excluded: [],
    };
    fs.writeFileSync(path.join(dir, 'checkout-platform.ownership.json'), `${JSON.stringify(parent)}\n`);
    fs.writeFileSync(path.join(dir, 'payments.ownership.json'), `${JSON.stringify(child)}\n`);
    const bytes = fs.readFileSync(path.join(dir, 'payments.ownership.json'));
    patchManifest(dir, (manifest) => {
      manifest.ownership = {
        file: 'payments.ownership.json',
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    });
    const entry = fs.readFileSync(path.join(dir, 'checkout-platform.html'), 'utf8');
    const manifestText = fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8');
    fs.writeFileSync(path.join(dir, 'checkout-platform.html'), entry.replace(
      /<script id="archify-bundle-manifest" type="application\/json">[\s\S]*?<\/script>/,
      `<script id="archify-bundle-manifest" type="application/json">${manifestText}</script>`,
    ));
    expectFailure(dir, 'bundle/ownership-not-subset');
  } finally {
    disposeBundleFixture(dir);
  }
});
