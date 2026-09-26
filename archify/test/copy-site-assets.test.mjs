import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { copySiteAssets } from '../../scripts/copy-site-assets.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDirectory, '../..');
const canonicalAssets = path.join(repoRoot, 'docs', 'assets');

function workspace(t, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function assertThrowsWithCauseCode(action, expectedCode) {
  assert.throws(action, (error) => {
    assert.equal(error?.cause?.code, expectedCode);
    return true;
  });
}

function createDirectorySymlink(t, target, alias) {
  try {
    fs.symlinkSync(target, alias, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`directory symlinks unavailable: ${error.code}`);
      return false;
    }
    throw error;
  }
}

function createFileSymlink(t, target, alias) {
  try {
    fs.symlinkSync(target, alias, process.platform === 'win32' ? 'file' : undefined);
    return true;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`file symlinks unavailable: ${error.code}`);
      return false;
    }
    throw error;
  }
}

test('copySiteAssets rejects an assets-directory symlink without modifying its external target', (t) => {
  const root = workspace(t, 'archify-copy-site-assets-directory-link-');
  const outputParent = path.join(root, 'site');
  const external = path.join(root, 'external');
  fs.mkdirSync(outputParent);
  fs.mkdirSync(external);
  const sentinel = path.join(external, 'sentinel.txt');
  fs.writeFileSync(sentinel, 'external-owned\n');
  const assets = path.join(outputParent, 'assets');
  if (!createDirectorySymlink(t, external, assets)) return;

  assert.throws(
    () => copySiteAssets(path.join(outputParent, 'index.html')),
    /must be a physical directory, not a symbolic link or special entry/i,
  );
  assert.equal(fs.lstatSync(assets).isSymbolicLink(), true);
  assert.deepEqual(fs.readdirSync(external), ['sentinel.txt']);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'external-owned\n');
});

test('copySiteAssets rejects existing and dangling asset symlinks without following them', (t) => {
  const root = workspace(t, 'archify-copy-site-assets-leaf-link-');
  for (const kind of ['existing', 'dangling']) {
    const outputParent = path.join(root, kind, 'site');
    const assets = path.join(outputParent, 'assets');
    const external = path.join(root, kind, 'external', 'site-language.js');
    fs.mkdirSync(assets, { recursive: true });
    fs.mkdirSync(path.dirname(external), { recursive: true });
    if (kind === 'existing') fs.writeFileSync(external, 'external-owned\n');
    const target = path.join(assets, 'site-language.js');
    if (!createFileSymlink(t, external, target)) return;

    assertThrowsWithCauseCode(
      () => copySiteAssets(path.join(outputParent, 'index.html')),
      'requested-entry-symbolic-link',
    );
    assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
    if (kind === 'existing') {
      assert.equal(fs.readFileSync(external, 'utf8'), 'external-owned\n');
    } else {
      assert.equal(fs.existsSync(external), false);
    }
    assert.equal(fs.existsSync(path.join(assets, 'site-navigation.css')), false);
  }
});

test('copySiteAssets preflights both asset targets before publishing either one', (t) => {
  const root = workspace(t, 'archify-copy-site-assets-two-target-preflight-');
  const outputParent = path.join(root, 'site');
  const assets = path.join(outputParent, 'assets');
  const first = path.join(assets, 'site-language.js');
  const second = path.join(assets, 'site-navigation.css');
  const external = path.join(root, 'external-navigation.css');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(first, 'first asset remains unchanged\n');
  fs.writeFileSync(external, 'external navigation remains unchanged\n');
  if (!createFileSymlink(t, external, second)) return;

  assertThrowsWithCauseCode(
    () => copySiteAssets(path.join(outputParent, 'index.html')),
    'requested-entry-symbolic-link',
  );
  assert.equal(fs.readFileSync(first, 'utf8'), 'first asset remains unchanged\n');
  assert.equal(fs.lstatSync(second).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(external, 'utf8'), 'external navigation remains unchanged\n');
});

test('copySiteAssets rolls back the pair when publishing the second asset fails', (t) => {
  const root = workspace(t, 'archify-copy-site-assets-pair-rollback-');
  const outputParent = path.join(root, 'site');
  const assets = path.join(outputParent, 'assets');
  const language = path.join(assets, 'site-language.js');
  const navigation = path.join(assets, 'site-navigation.css');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(language, 'previous language asset\n');
  fs.writeFileSync(navigation, 'previous navigation asset\n');

  const linkSync = fs.linkSync.bind(fs);
  let injected = false;
  t.mock.method(fs, 'linkSync', (source, destination) => {
    if (!injected
      && path.basename(destination) === 'site-navigation.css'
      && path.basename(source).startsWith('.site-navigation.css.archify-')) {
      injected = true;
      throw Object.assign(new Error('injected second publication failure'), { code: 'EIO' });
    }
    return linkSync(source, destination);
  });

  assertThrowsWithCauseCode(
    () => copySiteAssets(path.join(outputParent, 'index.html')),
    'site-asset-publish-failed',
  );
  assert.equal(injected, true, 'the second publication must reach the injected failure');
  assert.equal(fs.readFileSync(language, 'utf8'), 'previous language asset\n');
  assert.equal(fs.readFileSync(navigation, 'utf8'), 'previous navigation asset\n');
  assert.deepEqual(
    fs.readdirSync(assets).sort(),
    ['site-language.js', 'site-navigation.css'],
    'rollback must not leave candidates or backups behind',
  );
});

test('copySiteAssets keeps the committed pair when retiring a previous backup needs recovery', (t) => {
  const root = workspace(t, 'archify-copy-site-assets-backup-recovery-');
  const outputParent = path.join(root, 'site');
  const assets = path.join(outputParent, 'assets');
  const language = path.join(assets, 'site-language.js');
  const navigation = path.join(assets, 'site-navigation.css');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(language, 'previous language asset\n');
  fs.writeFileSync(navigation, 'previous navigation asset\n');

  const unlinkSync = fs.unlinkSync.bind(fs);
  let injected = false;
  t.mock.method(fs, 'unlinkSync', (file, ...args) => {
    if (!injected
      && path.basename(String(file)).startsWith('.archify-site-backup-')
      && path.basename(path.dirname(String(file))).startsWith('.archify-remove-')) {
      injected = true;
      throw Object.assign(new Error('injected previous-backup cleanup failure'), { code: 'EIO' });
    }
    return unlinkSync(file, ...args);
  });

  assertThrowsWithCauseCode(
    () => copySiteAssets(path.join(outputParent, 'index.html')),
    'previous-site-asset-target-quarantine-cleanup-failed',
  );
  assert.equal(injected, true, 'the previous-backup retirement must reach the injected failure');
  assert.deepEqual(fs.readFileSync(language), fs.readFileSync(path.join(canonicalAssets, 'site-language.js')));
  assert.deepEqual(fs.readFileSync(navigation), fs.readFileSync(path.join(canonicalAssets, 'site-navigation.css')));
});

test('copySiteAssets rolls back the first asset and preserves a claimant of the second target', (t) => {
  const root = workspace(t, 'archify-copy-site-assets-second-claimant-');
  const outputParent = path.join(root, 'site');
  const assets = path.join(outputParent, 'assets');
  const language = path.join(assets, 'site-language.js');
  const navigation = path.join(assets, 'site-navigation.css');
  fs.mkdirSync(assets, { recursive: true });

  const linkSync = fs.linkSync.bind(fs);
  let injected = false;
  t.mock.method(fs, 'linkSync', (source, destination) => {
    if (!injected
      && path.basename(destination) === 'site-navigation.css'
      && path.basename(source).startsWith('.site-navigation.css.archify-')) {
      fs.writeFileSync(navigation, 'concurrent navigation claimant\n', { flag: 'wx' });
      injected = true;
    }
    return linkSync(source, destination);
  });

  assertThrowsWithCauseCode(
    () => copySiteAssets(path.join(outputParent, 'index.html')),
    'site-asset-target-claimed-during-publish',
  );
  assert.equal(injected, true, 'the second target must be claimed after the first publish');
  assert.equal(fs.existsSync(language), false, 'the first publication must roll back to absence');
  assert.equal(fs.readFileSync(navigation, 'utf8'), 'concurrent navigation claimant\n');
  assert.deepEqual(fs.readdirSync(assets), ['site-navigation.css']);
});

test('copySiteAssets preserves a target introduced after capture and before publication', (t) => {
  const root = workspace(t, 'archify-copy-site-assets-target-swap-');
  const outputParent = path.join(root, 'site');
  const assets = path.join(outputParent, 'assets');
  const target = path.join(assets, 'site-language.js');
  fs.mkdirSync(assets, { recursive: true });

  const copyFileSync = fs.copyFileSync.bind(fs);
  const writeFileSync = fs.writeFileSync.bind(fs);
  let swapped = false;
  t.mock.method(fs, 'copyFileSync', (source, destination, mode) => {
    if (!swapped && path.basename(source) === 'site-language.js'
      && path.basename(destination) === 'site-language.js') {
      fs.writeFileSync(target, 'late claimant\n', { flag: 'wx' });
      swapped = true;
    }
    const result = copyFileSync(source, destination, mode);
    if (!swapped && path.basename(source) === 'site-language.js') {
      fs.writeFileSync(target, 'late claimant\n', { flag: 'wx' });
      swapped = true;
    }
    return result;
  });
  t.mock.method(fs, 'writeFileSync', (file, data, options) => {
    const result = writeFileSync(file, data, options);
    if (!swapped && typeof file === 'number') {
      writeFileSync(target, 'late claimant\n', { flag: 'wx' });
      swapped = true;
    }
    return result;
  });

  assertThrowsWithCauseCode(
    () => copySiteAssets(path.join(outputParent, 'index.html')),
    'requested-entry-changed',
  );
  assert.equal(swapped, true, 'the race fixture must replace the captured absent target');
  assert.equal(fs.readFileSync(target, 'utf8'), 'late claimant\n');
  assert.deepEqual(fs.readdirSync(assets), ['site-language.js']);
});

test('copySiteAssets rejects a candidate modified while the final target state is checked', (t) => {
  const root = workspace(t, 'archify-copy-site-assets-candidate-mutation-');
  const outputParent = path.join(root, 'site');
  const assets = path.join(outputParent, 'assets');
  const target = path.join(assets, 'site-language.js');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(target, 'original public asset\n');

  const lstatSync = fs.lstatSync.bind(fs);
  const writeFileSync = fs.writeFileSync.bind(fs);
  let candidatePath;
  let candidateInspections = 0;
  let armed = false;
  let injected = false;
  t.mock.method(fs, 'lstatSync', (file, options) => {
    const metadata = lstatSync(file, options);
    const basename = path.basename(String(file));
    if (basename.startsWith('.site-language.js.archify-') && basename.endsWith('.tmp')) {
      candidatePath = String(file);
      candidateInspections += 1;
      if (candidateInspections === 3) armed = true;
    } else if (armed && !injected && basename === 'site-language.js') {
      writeFileSync(candidatePath, 'mutated candidate\n');
      injected = true;
    }
    return metadata;
  });

  assertThrowsWithCauseCode(
    () => copySiteAssets(path.join(outputParent, 'index.html')),
    'site-asset-candidate-content-changed',
  );
  assert.equal(injected, true, 'the race fixture must mutate the staged candidate');
  assert.equal(fs.readFileSync(target, 'utf8'), 'original public asset\n');
  assert.deepEqual(fs.readdirSync(assets), ['site-language.js']);
});

test('copySiteAssets preserves a successor that replaces the random candidate during target verification', (t) => {
  if (process.platform === 'win32') {
    t.skip('Replacing an open candidate is not portable to Windows.');
    return;
  }
  const root = workspace(t, 'archify-copy-site-assets-candidate-successor-');
  const outputParent = path.join(root, 'site');
  const assets = path.join(outputParent, 'assets');
  const target = path.join(assets, 'site-language.js');
  const displaced = path.join(assets, 'displaced-owned-candidate');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(target, 'original public asset\n');

  const lstatSync = fs.lstatSync.bind(fs);
  const writeFileSync = fs.writeFileSync.bind(fs);
  let candidatePath;
  let candidateInspections = 0;
  let armed = false;
  let injected = false;
  t.mock.method(fs, 'lstatSync', (file, options) => {
    const metadata = lstatSync(file, options);
    const basename = path.basename(String(file));
    if (basename.startsWith('.site-language.js.archify-') && basename.endsWith('.tmp')) {
      candidatePath = String(file);
      candidateInspections += 1;
      if (candidateInspections === 3) armed = true;
    } else if (armed && !injected && basename === 'site-language.js') {
      fs.renameSync(candidatePath, displaced);
      writeFileSync(candidatePath, 'candidate successor\n', { flag: 'wx' });
      injected = true;
    }
    return metadata;
  });

  assertThrowsWithCauseCode(
    () => copySiteAssets(path.join(outputParent, 'index.html')),
    'site-asset-candidate-identity-changed',
  );
  assert.equal(injected, true, 'the race fixture must replace the staged candidate');
  assert.match(path.basename(candidatePath), /^\.site-language\.js\.archify-[a-f\d]{32}\.tmp$/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'original public asset\n');
  assert.equal(fs.readFileSync(candidatePath, 'utf8'), 'candidate successor\n');
  assert.deepEqual(fs.readFileSync(displaced), fs.readFileSync(path.join(canonicalAssets, 'site-language.js')));
});

test('copySiteAssets rejects a hardlinked asset without modifying either name', (t) => {
  const root = workspace(t, 'archify-copy-site-assets-hardlink-');
  const outputParent = path.join(root, 'site');
  const assets = path.join(outputParent, 'assets');
  const external = path.join(root, 'external.js');
  const target = path.join(assets, 'site-language.js');
  fs.mkdirSync(assets, { recursive: true });
  fs.writeFileSync(external, 'external-owned\n');
  try {
    fs.linkSync(external, target);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EXDEV'].includes(error?.code)) {
      t.skip(`hard links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  assertThrowsWithCauseCode(
    () => copySiteAssets(path.join(outputParent, 'index.html')),
    'requested-entry-hardlinked',
  );
  assert.equal(fs.readFileSync(target, 'utf8'), 'external-owned\n');
  assert.equal(fs.readFileSync(external, 'utf8'), 'external-owned\n');
  assert.equal(fs.lstatSync(target, { bigint: true }).ino, fs.lstatSync(external, { bigint: true }).ino);
  assert.deepEqual(fs.readdirSync(assets), ['site-language.js']);
});

test('copySiteAssets rejects a special asset entry without replacing it', (t) => {
  if (process.platform === 'win32') {
    t.skip('FIFO fixture is POSIX-only.');
    return;
  }
  const root = workspace(t, 'archify-copy-site-assets-special-');
  const outputParent = path.join(root, 'site');
  const assets = path.join(outputParent, 'assets');
  const target = path.join(assets, 'site-language.js');
  fs.mkdirSync(assets, { recursive: true });
  const created = spawnSync('mkfifo', [target], { encoding: 'utf8' });
  if (created.status !== 0) {
    t.skip(`mkfifo unavailable: ${created.stderr || created.error?.message || created.status}`);
    return;
  }

  assertThrowsWithCauseCode(
    () => copySiteAssets(path.join(outputParent, 'index.html')),
    'requested-entry-not-regular-file',
  );
  assert.equal(fs.lstatSync(target).isFIFO(), true);
  assert.deepEqual(fs.readdirSync(assets), ['site-language.js']);
});

test('copySiteAssets atomically refreshes regular assets and leaves no temporary entries', (t) => {
  const root = workspace(t, 'archify-copy-site-assets-success-');
  const outputParent = path.join(root, 'site');
  const assets = path.join(outputParent, 'assets');
  fs.mkdirSync(assets, { recursive: true });
  const existing = path.join(assets, 'site-language.js');
  fs.writeFileSync(existing, 'stale\n');
  let previousUmask;
  if (process.platform !== 'win32') {
    fs.chmodSync(existing, 0o666);
    previousUmask = process.umask(0o077);
  }

  try {
    copySiteAssets(path.join(outputParent, 'index.html'));
  } finally {
    if (previousUmask !== undefined) process.umask(previousUmask);
  }

  for (const asset of [
    'site-language.js',
    'site-navigation.css',
    'archify-lockup-light.svg',
    'archify-mark.svg',
  ]) {
    assert.deepEqual(
      fs.readFileSync(path.join(assets, asset)),
      fs.readFileSync(path.join(canonicalAssets, asset)),
    );
  }
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(existing).mode & 0o777, 0o666);
  }
  assert.deepEqual(fs.readdirSync(assets).sort(), [
    'archify-lockup-light.svg',
    'archify-mark.svg',
    'site-language.js',
    'site-navigation.css',
  ]);
});
