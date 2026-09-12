import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LocateError } from '../locate/error.mjs';
import {
  classifyPath,
  defaultOwnershipPath,
  inheritParentExcluded,
  loadOwnership,
  validateChildOwnershipSubset,
} from '../locate/ownership.mjs';
import { OWNERSHIP_SUBSET_CASES } from './helpers/ownership-subset-cases.mjs';

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ownership-'));
  const map = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Ownership fixture' },
    components: [
      { id: 'cli', type: 'frontend', label: 'CLI' },
      { id: 'core', type: 'backend', label: 'Core' },
    ],
    connections: [{ id: 'cli-core', from: 'cli', to: 'core' }],
  };
  const ownership = {
    schema_version: 1,
    kind: 'ownership',
    map: 'map.architecture.json',
    excluded: extra.excluded,
    components: extra.components || [
      { id: 'cli', globs: ['bin/**'] },
      { id: 'core', globs: extra.coreGlobs || ['src/**'] },
    ],
    ...('parent' in extra ? { parent: extra.parent } : {}),
  };
  const mapPath = path.join(root, 'map.architecture.json');
  const ownershipPath = path.join(root, 'map.architecture.ownership.json');
  writeJson(mapPath, map);
  writeJson(ownershipPath, ownership);
  return { root, map, ownership, mapPath, ownershipPath };
}

function load(extra) {
  const data = fixture(extra);
  return { ...data, loaded: loadOwnership({ ownershipPath: data.ownershipPath, mapPath: data.mapPath, map: data.map }) };
}

test('default sidecar path strips .json then appends .ownership.json', () => {
  assert.equal(
    defaultOwnershipPath('/tmp/archify-self.architecture.json'),
    '/tmp/archify-self.architecture.ownership.json',
  );
  assert.equal(
    defaultOwnershipPath('/tmp/archify-self.json'),
    '/tmp/archify-self.ownership.json',
  );
});

test('loadOwnership resolves <stem>.ownership.json for <stem>.json', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ownership-stem-'));
  const map = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Stem' },
    components: [{ id: 'cli', type: 'frontend', label: 'CLI' }],
  };
  const mapPath = path.join(root, 'archify-self.json');
  const ownershipPath = defaultOwnershipPath(mapPath);
  assert.equal(path.basename(ownershipPath), 'archify-self.ownership.json');
  writeJson(mapPath, map);
  writeJson(ownershipPath, {
    schema_version: 1,
    kind: 'ownership',
    map: 'archify-self.json',
    components: [{ id: 'cli', globs: ['bin/**'] }],
  });
  const loaded = loadOwnership({ ownershipPath, mapPath, map });
  assert.equal(loaded.ownership.map, 'archify-self.json');
});

test('unknown sidecar id fails closed', () => {
  assert.throws(() => load({
    components: [
      { id: 'cli', globs: ['bin/**'] },
      { id: 'core', globs: ['src/**'] },
      { id: 'ghost', globs: ['ghost/**'] },
    ],
  }), (error) => error instanceof LocateError && error.code === 'locate/ownership-unknown-component');
});

test('duplicate sidecar id fails closed', () => {
  assert.throws(() => load({
    components: [
      { id: 'cli', globs: ['bin/**'] },
      { id: 'cli', globs: ['src/**'] },
      { id: 'core', globs: [] },
    ],
  }), (error) => error instanceof LocateError && error.code === 'locate/ownership-duplicate-component');
});

test('unmapped map component fails closed', () => {
  assert.throws(() => load({
    components: [{ id: 'cli', globs: ['bin/**'] }],
  }), (error) => error instanceof LocateError && error.code === 'locate/ownership-component-unmapped');
});

test('empty globs are allowed', () => {
  const data = load({
    components: [
      { id: 'cli', globs: [] },
      { id: 'core', globs: ['src/**'] },
    ],
  });
  assert.deepEqual(classifyPath('bin/cli.mjs', data.loaded.ownership), { state: 'uncovered' });
  assert.equal(classifyPath('src/main.mjs', data.loaded.ownership).state, 'touched');
});

test('invalid glob fails closed', () => {
  assert.throws(() => load({
    components: [
      { id: 'cli', globs: ['bin/{unclosed'] },
      { id: 'core', globs: [] },
    ],
  }), (error) => error instanceof LocateError && error.code === 'locate/ownership-glob-invalid');
});

test('missing parent map fails closed as ownership-parent-missing', () => {
  const data = fixture({
    parent: { map: 'missing-parent.json', component: 'core' },
  });
  assert.throws(
    () => loadOwnership({ ownershipPath: data.ownershipPath, mapPath: data.mapPath, map: data.map }),
    (error) => error instanceof LocateError
      && error.code === 'locate/ownership-parent-missing'
      && String(error.message).includes('missing-parent.json'),
  );
});

test('missing parent sidecar fails closed as ownership-parent-missing', () => {
  const data = fixture();
  writeJson(path.join(data.root, 'parent.architecture.json'), {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Parent' },
    components: [{ id: 'core', type: 'backend', label: 'Core' }],
  });
  writeJson(data.ownershipPath, {
    schema_version: 1,
    kind: 'ownership',
    map: 'map.architecture.json',
    parent: { map: 'parent.architecture.json', component: 'core' },
    components: [
      { id: 'cli', globs: ['bin/**'] },
      { id: 'core', globs: ['src/**'] },
    ],
  });
  assert.throws(
    () => loadOwnership({ ownershipPath: data.ownershipPath, mapPath: data.mapPath, map: data.map }),
    (error) => error instanceof LocateError
      && error.code === 'locate/ownership-parent-missing'
      && String(error.message).includes('parent.architecture.ownership.json'),
  );
});

test('parent pointer mismatch fails closed', () => {
  const data = fixture();
  const parentMap = path.join(data.root, 'parent.architecture.json');
  const parentOwn = path.join(data.root, 'parent.architecture.ownership.json');
  writeJson(parentMap, {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Parent' },
    components: [{ id: 'core', type: 'backend', label: 'Core' }],
  });
  writeJson(parentOwn, {
    schema_version: 1,
    kind: 'ownership',
    map: 'parent.architecture.json',
    components: [{ id: 'core', globs: ['src/**', 'bin/**', 'map.architecture.json'], child_map: 'other.json' }],
  });
  writeJson(data.ownershipPath, {
    schema_version: 1,
    kind: 'ownership',
    map: 'map.architecture.json',
    parent: { map: 'parent.architecture.json', component: 'core' },
    components: [
      { id: 'cli', globs: ['bin/**'] },
      { id: 'core', globs: ['src/**'] },
    ],
  });
  assert.throws(
    () => loadOwnership({ ownershipPath: data.ownershipPath, mapPath: data.mapPath, map: data.map }),
    (error) => error instanceof LocateError && error.code === 'locate/ownership-parent-mismatch',
  );
});

function subsetPair(testCase) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ownership-subset-'));
  const parentMap = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Parent' },
    components: [{ id: 'payments', type: 'backend', label: 'Payments' }],
  };
  const childMap = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Child' },
    components: [{ id: 'api', type: 'backend', label: 'API' }],
  };
  const parentMapPath = path.join(root, 'checkout-platform.json');
  const childMapPath = path.join(root, 'payments.json');
  writeJson(parentMapPath, parentMap);
  writeJson(childMapPath, childMap);
  writeJson(defaultOwnershipPath(parentMapPath), {
    schema_version: 1,
    kind: 'ownership',
    map: 'checkout-platform.json',
    excluded: testCase.parentExcluded,
    components: [{ id: 'payments', globs: testCase.parentGlobs, child_map: 'payments.json' }],
  });
  writeJson(defaultOwnershipPath(childMapPath), {
    schema_version: 1,
    kind: 'ownership',
    map: 'payments.json',
    parent: { map: 'checkout-platform.json', component: 'payments' },
    excluded: testCase.childExcluded,
    components: [{ id: 'api', globs: testCase.childGlobs }],
  });
  return { root, parentMap, childMap, parentMapPath, childMapPath };
}

for (const testCase of OWNERSHIP_SUBSET_CASES) {
  test(`loadOwnership subset: ${testCase.name}`, () => {
    const data = subsetPair(testCase);
    const load = () => loadOwnership({
      ownershipPath: defaultOwnershipPath(data.childMapPath),
      mapPath: data.childMapPath,
      map: data.childMap,
    });
    const direct = validateChildOwnershipSubset(
      {
        components: [{ id: 'payments', globs: testCase.parentGlobs }],
      },
      'payments',
      {
        excluded: testCase.childExcluded,
        components: [{ id: 'api', globs: testCase.childGlobs }],
      },
    );
    if (testCase.ok) {
      assert.doesNotThrow(load);
      assert.deepEqual(direct, []);
    } else {
      assert.throws(load, (error) => error instanceof LocateError && error.code === 'locate/ownership-not-subset');
      assert.ok(direct.some((item) => item.glob === testCase.glob && item.code === 'locate/ownership-not-subset'));
    }
  });
}

test('subset violation fails closed', () => {
  const data = fixture();
  const parentMap = path.join(data.root, 'parent.architecture.json');
  const parentOwn = path.join(data.root, 'parent.architecture.ownership.json');
  writeJson(parentMap, {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Parent' },
    components: [{ id: 'core', type: 'backend', label: 'Core' }],
  });
  writeJson(parentOwn, {
    schema_version: 1,
    kind: 'ownership',
    map: 'parent.architecture.json',
    components: [{ id: 'core', globs: ['src/**'], child_map: 'map.architecture.json' }],
  });
  writeJson(data.ownershipPath, {
    schema_version: 1,
    kind: 'ownership',
    map: 'map.architecture.json',
    parent: { map: 'parent.architecture.json', component: 'core' },
    components: [
      { id: 'cli', globs: ['bin/**'] },
      { id: 'core', globs: ['src/**'] },
    ],
  });
  assert.throws(
    () => loadOwnership({ ownershipPath: data.ownershipPath, mapPath: data.mapPath, map: data.map }),
    (error) => error instanceof LocateError && error.code === 'locate/ownership-not-subset',
  );
});

test('classifyPath applies excluded first and reports ambiguity without priority', () => {
  const ownership = {
    excluded: ['vendor/**'],
    components: [
      { id: 'cli', globs: ['src/**'] },
      { id: 'core', globs: ['src/**'] },
    ],
  };
  assert.deepEqual(classifyPath('vendor/pkg/index.js', ownership), {
    state: 'excluded',
    matchedGlob: 'vendor/**',
  });
  assert.deepEqual(classifyPath('src/main.js', ownership), {
    state: 'ambiguous',
    candidates: ['cli', 'core'],
  });
});
