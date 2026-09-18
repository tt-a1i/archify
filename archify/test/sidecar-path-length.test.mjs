import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';

import { sidecarPaths } from '../bin/visual-check.mjs';
import { sidecarNamespaceComponentKey } from '../renderers/shared/path-semantics.mjs';

function basenameFits(file) {
  const name = path.basename(file);
  return name.length <= 255 && Buffer.byteLength(name, 'utf8') <= 255;
}

function windowsShortPath(targetPath) {
  const result = spawnSync(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', '"for %I in ("%ARCHIFY_SHORT_PATH_TARGET%") do @echo %~sI"'],
    {
      encoding: 'utf8',
      env: { ...process.env, ARCHIFY_SHORT_PATH_TARGET: targetPath },
      windowsHide: true,
      windowsVerbatimArguments: true,
    },
  );
  if (result.error) throw new Error(`Could not query a Windows 8.3 path: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`Could not query a Windows 8.3 path: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  const shortPath = result.stdout.trim();
  if (!shortPath) throw new Error('Windows returned an empty 8.3 path');
  if (path.resolve(shortPath).toLowerCase() === path.resolve(targetPath).toLowerCase()) return null;
  if (fs.realpathSync.native(shortPath).toLowerCase()
    !== fs.realpathSync.native(targetPath).toLowerCase()) {
    throw new Error('Windows returned an 8.3 path for a different filesystem entry');
  }
  return shortPath;
}

function assignWindowsShortName(targetPath, shortName) {
  const result = spawnSync(
    'fsutil.exe',
    ['file', 'setshortname', targetPath, shortName],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.error) {
    throw new Error(`Could not assign Windows 8.3 name ${shortName}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || 'no command output';
    throw new Error(`Could not assign Windows 8.3 name ${shortName} (exit ${result.status}): ${detail}`);
  }
  const alias = path.join(path.dirname(targetPath), shortName);
  const aliasStat = fs.statSync(alias, { bigint: true });
  const targetStat = fs.statSync(targetPath, { bigint: true });
  assert.deepEqual(
    [aliasStat.dev, aliasStat.ino],
    [targetStat.dev, targetStat.ino],
    'the explicitly assigned 8.3 name must resolve to the requested entry',
  );
  return alias;
}

function controlledWindowsShortRoot(required) {
  const root = process.env.ARCHIFY_WINDOWS_8DOT3_ROOT;
  const shortRoot = process.env.ARCHIFY_WINDOWS_8DOT3_SHORT_ROOT;
  if (!root && !shortRoot) {
    if (required) {
      assert.fail('ARCHIFY_REQUIRE_WINDOWS_8DOT3=1 requires the controlled long and short roots');
    }
    return null;
  }
  assert.ok(root && shortRoot, 'the controlled Windows 8.3 roots must be configured together');
  assert.match(path.win32.basename(shortRoot), /~/u, 'the controlled short root must use an explicit 8.3 alias');
  assert.equal(
    fs.realpathSync.native(root).toLowerCase(),
    fs.realpathSync.native(shortRoot).toLowerCase(),
    'the controlled long and short roots must identify the same directory',
  );
  return { root, shortRoot };
}

test('visual-check deterministically bounds every derived sidecar component', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-sidecar-bounded-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const stem = 'é'.repeat(120);
  const first = sidecarPaths(path.join(directory, `${stem}.html`));
  const second = sidecarPaths(path.join(directory, `${stem}.html`));
  const files = [first.receipt, first.contactSheet, ...first.screenshots.map(({ path: file }) => file)];

  assert.deepEqual(first, second);
  assert.equal(files.every(basenameFits), true);
  assert.match(path.basename(first.receipt), /\.~archify-[0-9a-f]{64}\.visual-check\.json$/);
});

test('different overlong artifact stems do not collapse to one visual-check sidecar name', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-sidecar-distinct-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const left = sidecarPaths(path.join(directory, `${'x'.repeat(260)}-left.html`));
  const right = sidecarPaths(path.join(directory, `${'x'.repeat(260)}-right.html`));
  assert.notEqual(path.basename(left.receipt), path.basename(right.receipt));
});

test('html and htm artifacts use distinct visual-check sidecar namespaces', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-sidecar-extensions-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const html = sidecarPaths(path.join(directory, 'diagram.html'));
  const htm = sidecarPaths(path.join(directory, 'diagram.htm'));

  assert.notEqual(html.receipt, htm.receipt);
  assert.equal(path.basename(html.receipt), 'diagram.visual-check.json');
  assert.match(
    path.basename(htm.receipt),
    /^diagram\.htm\.~archify-[0-9a-f]{64}\.visual-check\.json$/u,
  );
});

test('HTML extension case follows the containing filesystem semantics', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-sidecar-extension-case-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const lower = path.join(directory, 'diagram.html');
  const upper = path.join(directory, 'diagram.HTML');
  const lowerPaths = sidecarPaths(lower);
  const upperPaths = sidecarPaths(upper);
  fs.writeFileSync(lower, '<!doctype html>');

  if (fs.existsSync(upper)) {
    assert.deepEqual(upperPaths, lowerPaths);
  } else {
    assert.notEqual(upperPaths.receipt, lowerPaths.receipt);
    assert.match(
      path.basename(upperPaths.receipt),
      /^diagram\.HTML\.~archify-[0-9a-f]{64}\.visual-check\.json$/u,
    );
  }
});

test('bounded html and htm artifacts retain distinct hash namespaces', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-sidecar-bounded-extensions-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const stem = 'x'.repeat(225);
  const html = sidecarPaths(path.join(directory, `${stem}.html`));
  const htm = sidecarPaths(path.join(directory, `${stem}.htm`));

  assert.notEqual(html.receipt, htm.receipt);
  assert.match(path.basename(html.receipt), /\.~archify-[0-9a-f]{64}\.visual-check\.json$/u);
  assert.match(path.basename(htm.receipt), /\.~archify-[0-9a-f]{64}\.visual-check\.json$/u);
});

test('a crafted bounded stem cannot enter another artifact visual-check namespace', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-sidecar-crafted-stem-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const long = sidecarPaths(path.join(directory, `${'x'.repeat(245)}.html`));
  const encodedStem = path.basename(long.base).replace(/\.visual-check$/u, '');
  const crafted = sidecarPaths(path.join(directory, `${encodedStem}.html`));
  const allPaths = (value) => [
    value.receipt,
    value.contactSheet,
    ...value.screenshots.map(({ path: screenshot }) => screenshot),
  ];

  const longPaths = new Set(allPaths(long));
  assert.equal(allPaths(crafted).some((file) => longPaths.has(file)), false);
});

test('existing overlong artifact aliases derive identical visual-check sidecar paths', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-sidecar-alias-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const canonical = path.join(directory, `${'A'.repeat(225)}.html`);
  const alias = path.join(directory, `${'a'.repeat(225)}.html`);
  fs.writeFileSync(canonical, '<!doctype html>');

  if (!fs.existsSync(alias)) {
    t.skip('requires a case-insensitive filesystem');
    return;
  }

  assert.deepEqual(sidecarPaths(alias), sidecarPaths(canonical));
});

test('existing short-stem artifacts use the physical directory sidecar namespace', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-sidecar-directory-alias-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const physicalDirectory = path.join(root, 'physical');
  const aliasDirectory = path.join(root, 'alias');
  fs.mkdirSync(physicalDirectory);
  try {
    fs.symlinkSync(
      physicalDirectory,
      aliasDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    t.skip(`directory aliases are unavailable: ${error.message}`);
    return;
  }
  const physicalArtifact = path.join(physicalDirectory, 'diagram.html');
  const aliasArtifact = path.join(aliasDirectory, 'diagram.html');
  fs.writeFileSync(physicalArtifact, '<!doctype html>');

  assert.deepEqual(sidecarPaths(aliasArtifact), sidecarPaths(physicalArtifact));
});

test('future short-stem artifacts use the physical parent sidecar namespace', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-sidecar-future-parent-alias-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const physicalDirectory = path.join(root, 'physical');
  const aliasDirectory = path.join(root, 'alias');
  fs.mkdirSync(physicalDirectory);
  try {
    fs.symlinkSync(
      physicalDirectory,
      aliasDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    t.skip(`directory aliases are unavailable: ${error.message}`);
    return;
  }

  assert.deepEqual(
    sidecarPaths(path.join(aliasDirectory, 'diagram.html')),
    sidecarPaths(path.join(physicalDirectory, 'diagram.html')),
  );
});

test('native existing file aliases use the physical basename sidecar namespace', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-sidecar-native-file-alias-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const physicalArtifact = path.join(directory, 'diagram artifact with long name.html');
  const authoredAlias = path.join(directory, 'DIAGRA~1.HTM');
  fs.writeFileSync(physicalArtifact, '<!doctype html>');
  const nativeRealpath = fs.realpathSync.native;
  fs.realpathSync.native = (candidate, ...args) => (
    path.resolve(String(candidate)) === authoredAlias
      ? physicalArtifact
      : nativeRealpath(candidate, ...args)
  );
  t.after(() => {
    fs.realpathSync.native = nativeRealpath;
  });

  assert.deepEqual(sidecarPaths(authoredAlias), sidecarPaths(physicalArtifact));
});

test('Windows existing 8.3 artifact aliases derive one visual-check sidecar namespace', (t) => {
  const requiresWindows8dot3 = process.env.ARCHIFY_REQUIRE_WINDOWS_8DOT3 === '1';
  if (process.platform !== 'win32') {
    if (requiresWindows8dot3) assert.fail('ARCHIFY_REQUIRE_WINDOWS_8DOT3=1 requires Windows');
    t.skip('Windows-only 8.3 visual sidecar regression');
    return;
  }
  const controlledRoot = controlledWindowsShortRoot(requiresWindows8dot3);
  const directory = controlledRoot
    ? fs.mkdtempSync(path.join(controlledRoot.root, 'visual-sidecar-'))
    : fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-sidecar-eight-dot-three-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const artifact = path.join(directory, 'diagram artifact with long name.html');
  fs.writeFileSync(artifact, '<!doctype html>');
  const shortArtifact = controlledRoot
    ? assignWindowsShortName(artifact, 'ARCHVS~1.HTM')
    : windowsShortPath(artifact);
  if (!shortArtifact) {
    if (requiresWindows8dot3) assert.fail('the controlled Windows volume did not expose a file 8.3 alias');
    t.skip('the Windows volume does not expose a distinct file 8.3 alias');
    return;
  }

  assert.deepEqual(sidecarPaths(shortArtifact), sidecarPaths(artifact));
});

test('existing overlong Unicode aliases derive identical visual-check sidecar paths', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-sidecar-unicode-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const composedStem = `${'x'.repeat(219)}éé`;
  const decomposedStem = composedStem.normalize('NFD');
  const canonical = path.join(directory, `${composedStem}.html`);
  const alias = path.join(directory, `${decomposedStem}.html`);
  fs.writeFileSync(canonical, '<!doctype html>');

  if (!fs.existsSync(alias)) {
    t.skip('requires a Unicode-normalization-insensitive filesystem');
    return;
  }

  assert.deepEqual(sidecarPaths(alias), sidecarPaths(canonical));
});

test('future and existing case aliases keep one bounded sidecar namespace', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-sidecar-case-lifecycle-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const canonical = path.join(directory, `${'A'.repeat(225)}.html`);
  const alias = path.join(directory, `${'a'.repeat(225)}.html`);
  const future = sidecarPaths(alias);
  fs.writeFileSync(canonical, '<!doctype html>');
  if (!fs.existsSync(alias)) {
    t.skip('requires a case-insensitive filesystem');
    return;
  }

  assert.deepEqual(sidecarPaths(alias), future);
  assert.deepEqual(sidecarPaths(canonical), future);
});

test('future and existing normalization aliases keep one bounded sidecar namespace', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-sidecar-unicode-lifecycle-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const composedStem = `${'x'.repeat(219)}éé`;
  const decomposedStem = composedStem.normalize('NFD');
  const canonical = path.join(directory, `${composedStem}.html`);
  const alias = path.join(directory, `${decomposedStem}.html`);
  const future = sidecarPaths(alias);
  fs.writeFileSync(canonical, '<!doctype html>');
  if (!fs.existsSync(alias)) {
    t.skip('requires a Unicode-normalization-insensitive filesystem');
    return;
  }

  assert.deepEqual(sidecarPaths(alias), future);
  assert.deepEqual(sidecarPaths(canonical), future);
});

test('case-expansion keys follow the directory filesystem instead of generic Unicode folding', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-sidecar-case-expansion-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const prefix = 'x'.repeat(221);
  const sharpS = path.join(directory, `${prefix}ß.html`);
  const expanded = path.join(directory, `${prefix}ss.html`);
  const futureSharpS = sidecarPaths(sharpS);
  fs.writeFileSync(sharpS, '<!doctype html>');

  let distinct = true;
  try {
    fs.writeFileSync(expanded, '<!doctype html>', { flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    distinct = false;
  }

  if (process.platform === 'win32') {
    assert.equal(distinct, true, 'NTFS-style one-to-one upcase keeps ß and ss distinct');
  }
  if (distinct) {
    assert.notEqual(sidecarPaths(sharpS).receipt, sidecarPaths(expanded).receipt);
  } else {
    assert.deepEqual(sidecarPaths(sharpS), futureSharpS);
    assert.deepEqual(sidecarPaths(expanded), futureSharpS);
  }
});

test('an indeterminate bounded namespace fails closed before returning sidecar paths', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-sidecar-unknown-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const stem = 'A'.repeat(225);
  const originalOpen = fs.openSync;
  fs.openSync = function rejectSidecarProbe(file, ...args) {
    if (path.basename(String(file)).startsWith('.archify-path-semantics-')) {
      const error = new Error('synthetic probe denial');
      error.code = 'EACCES';
      throw error;
    }
    return originalOpen.call(this, file, ...args);
  };
  t.after(() => {
    fs.openSync = originalOpen;
  });

  const key = sidecarNamespaceComponentKey(directory, stem);
  assert.equal(key.status, 'unknown');
  assert.equal(key.reason.code, 'sidecar-case-semantics-indeterminate');
  assert.throws(
    () => sidecarPaths(path.join(directory, `${stem}.html`)),
    (error) => error?.code === 'ARCHIFY_SIDECAR_NAMESPACE_INDETERMINATE',
  );
  assert.deepEqual(fs.readdirSync(directory), []);
});
