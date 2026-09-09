import assert from 'node:assert/strict';
import test from 'node:test';
import { LocateError } from '../locate/error.mjs';
import {
  OWNERSHIP_PRESET_NAMES,
  OWNERSHIP_PRESETS,
  classifyPath,
  inheritParentExcluded,
  undeclaredPresetSuggestions,
  validateChildOwnershipSubset,
} from '../locate/ownership.mjs';
import { locateLint, locateRange } from '../locate/locate.mjs';
import { validateSchema } from '../renderers/shared/validator.mjs';

const emptyMap = {
  schema_version: 1,
  diagram_type: 'architecture',
  meta: { title: 'Presets' },
  components: [{ id: 'test', type: 'backend', label: 'Test' }],
};

function ownership(extra = {}) {
  return {
    schema_version: 1,
    kind: 'ownership',
    map: 'map.json',
    excluded: extra.excluded || [],
    presets: extra.presets,
    components: extra.components || [{ id: 'test', globs: ['archify/test/**'] }],
  };
}

test('owned test file stays touched when the tests preset is declared', () => {
  const sidecar = ownership({ presets: ['docs', 'tests'] });
  assert.deepEqual(classifyPath('archify/test/locate.test.mjs', sidecar), {
    state: 'touched',
    componentId: 'test',
    matchedGlob: 'archify/test/**',
  });
  assert.equal(classifyPath('docs/guide.md', sidecar).state, 'excluded');
  assert.equal(classifyPath('docs/guide.md', sidecar).matchedGlob, 'preset:docs');
});

test('each preset matches representative paths and undeclared presets do nothing', () => {
  const samples = {
    docs: ['README.md', 'docs/guide.md', 'LICENSE', 'NOTICE.txt'],
    tests: ['src/__tests__/a.js', 'pkg/foo.test.ts', 'pkg/foo_test.go', 'test_app.py', 'lib/testdata/x', 'lib/fixtures/y'],
    ci: ['.github/workflows/ci.yml', '.gitlab-ci.yml', '.circleci/config.yml', 'Dockerfile', 'dependabot.yml'],
    lockfiles: ['package-lock.json', 'go.sum', 'requirements-dev.txt'],
    generated: ['app.min.js', 'app.js.map', 'dist/out.js', 'build/out.js', '__generated__/x.ts', 'snap.snap', 'shot.png'],
  };
  for (const name of OWNERSHIP_PRESET_NAMES) {
    const declared = ownership({ components: [{ id: 'test', globs: [] }], presets: [name] });
    const silent = ownership({ components: [{ id: 'test', globs: [] }] });
    for (const filePath of samples[name]) {
      assert.deepEqual(
        classifyPath(filePath, declared),
        { state: 'excluded', matchedGlob: `preset:${name}` },
        `${name} should exclude ${filePath}`,
      );
      assert.deepEqual(classifyPath(filePath, silent), { state: 'uncovered' }, `undeclared ${name} leaves ${filePath} uncovered`);
    }
  }
  const ci = ownership({ components: [{ id: 'test', globs: [] }], presets: ['ci'] });
  assert.equal(classifyPath('config/app.yml', ci).state, 'uncovered', 'nested yaml is not a root-only ci match');
  assert.equal(classifyPath('charts/values.yaml', ci).state, 'uncovered');
});

test('explicit excluded still wins over component globs and presets', () => {
  const sidecar = ownership({
    excluded: ['archify/test/secret.mjs'],
    presets: ['tests'],
  });
  assert.deepEqual(classifyPath('archify/test/secret.mjs', sidecar), {
    state: 'excluded',
    matchedGlob: 'archify/test/secret.mjs',
  });
});

test('lint suggestions are deterministic and skip declared presets', () => {
  const files = [
    { path: 'README.md', state: 'uncovered' },
    { path: 'docs/a.md', state: 'uncovered' },
    { path: 'src/foo.test.js', state: 'uncovered' },
    { path: 'src/main.js', state: 'touched' },
  ];
  assert.deepEqual(undeclaredPresetSuggestions(files, {}), [
    'declare presets: ["docs"] to exclude 2 uncovered paths',
    'declare presets: ["tests"] to exclude 1 uncovered paths',
  ]);
  assert.deepEqual(undeclaredPresetSuggestions(files, { presets: ['docs'] }), [
    'declare presets: ["tests"] to exclude 1 uncovered paths',
  ]);
});

test('child presets must be a subset of the parent sidecar presets', () => {
  const parent = { presets: ['docs', 'tests'], components: [{ id: 'core', globs: ['src/**'] }] };
  assert.deepEqual(validateChildOwnershipSubset(parent, 'core', {
    presets: ['docs'],
    components: [{ id: 'api', globs: ['src/api/**'] }],
  }), []);
  const extra = validateChildOwnershipSubset(parent, 'core', {
    presets: ['ci'],
    components: [{ id: 'api', globs: ['src/api/**'] }],
  });
  assert.equal(extra[0].code, 'locate/ownership-not-subset');
  assert.equal(extra[0].glob, 'preset:ci');
  const none = validateChildOwnershipSubset({ components: [{ id: 'core', globs: ['src/**'] }] }, 'core', {
    presets: ['docs'],
    components: [{ id: 'api', globs: ['src/api/**'] }],
  });
  assert.equal(none[0].code, 'locate/ownership-not-subset');
});

test('child inherits parent presets at projection time', () => {
  const inherited = inheritParentExcluded(
    { presets: ['docs', 'tests'], excluded: ['vendor/**'], components: [] },
    { components: [{ id: 'api', globs: [] }] },
  );
  assert.deepEqual(inherited.presets, ['docs', 'tests']);
  assert.equal(classifyPath('README.md', inherited).matchedGlob, 'preset:docs');
});

test('locatorVersion 2 receipts record ownership.presets and validate', () => {
  const receipt = locateRange({
    base: 'a'.repeat(40),
    head: 'b'.repeat(40),
    map: emptyMap,
    ownership: ownership({ presets: ['docs', 'tests'] }),
    changes: [{ changeType: 'M', path: 'README.md' }],
    headTree: ['README.md', 'archify/test/locate.test.mjs'],
    mapPath: 'map.json',
    ownershipPath: 'map.ownership.json',
    ownershipSha256: 'a'.repeat(64),
  });
  assert.equal(receipt.locatorVersion, 2);
  assert.deepEqual(receipt.ownership.presets, ['docs', 'tests']);
  assert.equal(receipt.files.find((file) => file.path === 'README.md').matchedGlob, 'preset:docs');
  validateSchema('locate-receipt', receipt);

  const lint = locateLint({
    revision: 'c'.repeat(40),
    map: emptyMap,
    ownership: ownership({ components: [{ id: 'test', globs: [] }] }),
    tree: ['README.md', 'src/foo.test.js'],
    mapPath: 'map.json',
    ownershipPath: 'map.ownership.json',
    ownershipSha256: 'a'.repeat(64),
  });
  assert.equal(lint.locatorVersion, 2);
  assert.deepEqual(lint.ownership.presets, []);
  assert.deepEqual(lint.supportedFixes, [
    'declare presets: ["docs"] to exclude 1 uncovered paths',
    'declare presets: ["tests"] to exclude 1 uncovered paths',
  ]);
  validateSchema('locate-receipt', lint);
});

test('OWNERSHIP_PRESETS is the single list and covers every named preset', () => {
  assert.deepEqual(Object.keys(OWNERSHIP_PRESETS), [...OWNERSHIP_PRESET_NAMES]);
  for (const name of OWNERSHIP_PRESET_NAMES) {
    assert.ok(OWNERSHIP_PRESETS[name].length > 0);
  }
});
