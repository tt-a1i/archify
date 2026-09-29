import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  checkForUpdate,
  isMainModule,
  setUpdatePreference,
} from '../scripts/check-update.mjs';
import { DEFAULT_MANIFEST_URL, compareSemver, parseSemver } from '../scripts/update-contract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const checkerPath = path.join(skillRoot, 'scripts', 'check-update.mjs');
const contractPath = path.join(skillRoot, 'scripts', 'update-contract.mjs');
const expectedRepository = 'https://github.com/tt-a1i/archify';
const expectedManifestUrl = 'https://tt-a1i.github.io/archify/skill-updates/archify/stable.json';
const baseTime = Date.parse('2026-08-28T08:00:00Z');
const childCheckTimeoutMs = 2_000;
const parentCheckTimeoutMs = 5_000;

function writeJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function compactStateSource(state) {
  return `${JSON.stringify(state)}\n`;
}

function metadataWithOverrides(metadata, overrides) {
  return new Proxy(metadata, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function expiredCachedState() {
  return {
    schemaVersion: 2,
    skillId: 'archify',
    installedVersion: '2.15.0',
    check: {
      nextCheckAt: '2020-01-01T00:00:00.000Z',
      consecutiveFailures: 0,
    },
    preferences: [],
  };
}

function writeCompactCommittedState(testFixture, state, generation = 1n) {
  const target = path.join(operationPath(testFixture, 'committed', generation), 'state.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, compactStateSource(state));
  return target;
}

function committedStateFiles(testFixture) {
  return fs.readdirSync(stateDirectory(testFixture), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^committed-\d+$/.test(entry.name))
    .map((entry) => path.join(stateDirectory(testFixture), entry.name, 'state.json'));
}

function localRelease(version = '2.15.0') {
  return {
    schemaVersion: 1,
    skillId: 'archify',
    channel: version.includes('-') ? 'development' : 'stable',
    version,
    source: { repository: expectedRepository },
    updateManifestUrl: expectedManifestUrl,
  };
}

function remoteRelease(overrides = {}) {
  return {
    schemaVersion: 1,
    skillId: 'archify',
    channel: 'stable',
    version: '2.16.0',
    publishedAt: '2026-08-28T07:00:00Z',
    source: {
      repository: expectedRepository,
      ref: 'v2.16.0',
      treeSha: 'a'.repeat(40),
    },
    artifact: {
      sha256: 'b'.repeat(64),
    },
    summary: 'Improve large-repository scanning and diagram layout.',
    releaseNotes: 'https://github.com/tt-a1i/archify/releases/tag/v2.16.0',
    severity: 'normal',
    ...overrides,
  };
}

function remoteReleaseForVersion(version, digest = 'b'.repeat(64)) {
  const release = remoteRelease();
  return {
    ...release,
    version,
    source: { ...release.source, ref: `v${version}` },
    artifact: { sha256: digest },
    releaseNotes: `https://github.com/tt-a1i/archify/releases/tag/v${version}`,
  };
}

function response(body, { status = 200, etag = '"archify-2.16.0"' } = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      etag,
    },
  });
}

function fixture(version = '2.15.0') {
  const root = fs.realpathSync(fs.mkdtempSync(
    path.join(os.tmpdir(), 'archify-update-notifier-'),
  ));
  const releasePath = path.join(root, 'skill-release.json');
  const cacheDirectory = path.join(root, 'cache');
  writeJson(releasePath, localRelease(version));
  return { root, releasePath, cacheDirectory };
}

function caseVariant(target) {
  const name = path.basename(target);
  const index = name.search(/[A-Za-z]/);
  if (index === -1) throw new Error(`path has no ASCII case variant: ${target}`);
  const character = name[index];
  const replacement = character === character.toLowerCase()
    ? character.toUpperCase()
    : character.toLowerCase();
  return path.join(path.dirname(target), `${name.slice(0, index)}${replacement}${name.slice(index + 1)}`);
}

function windowsShortPath(target) {
  const result = spawnSync(
    process.env.ComSpec || 'cmd.exe',
    ['/d', '/s', '/c', '"for %I in ("%ARCHIFY_SHORT_PATH_TARGET%") do @echo %~sI"'],
    {
      encoding: 'utf8',
      env: { ...process.env, ARCHIFY_SHORT_PATH_TARGET: target },
      windowsHide: true,
      windowsVerbatimArguments: true,
    },
  );
  if (result.error) throw new Error(`Could not query a Windows 8.3 path: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || 'no stderr';
    throw new Error(`Could not query a Windows 8.3 path (exit ${result.status}): ${detail}`);
  }
  const shortPath = result.stdout.trim();
  if (!shortPath) throw new Error('Windows returned an empty 8.3 path');
  if (path.resolve(shortPath).toLowerCase() === path.resolve(target).toLowerCase()) return null;
  if (fs.realpathSync.native(shortPath).toLowerCase()
    !== fs.realpathSync.native(target).toLowerCase()) {
    throw new Error('Windows returned an 8.3 path for a different directory');
  }
  return shortPath;
}

function stateDirectory(testFixture, version = '2.15.0') {
  const partition = crypto.createHash('sha256').update(version).digest('hex').slice(0, 24);
  return path.join(testFixture.cacheDirectory, `version-${partition}`);
}

function statePath(testFixture, version = '2.15.0') {
  const directory = stateDirectory(testFixture, version);
  let committed = [];
  try {
    committed = fs.readdirSync(directory)
      .filter((name) => /^committed-\d+$/.test(name))
      .sort((left, right) => {
        const leftGeneration = BigInt(left.slice('committed-'.length));
        const rightGeneration = BigInt(right.slice('committed-'.length));
        return leftGeneration > rightGeneration ? -1 : 1;
      });
  } catch {
    // A seed may be written before the cache partition exists.
  }
  return committed[0]
    ? path.join(directory, committed[0], 'state.json')
    : path.join(operationPath(testFixture, 'committed', 1n, version), 'state.json');
}

function operationPath(testFixture, kind, generation, version = '2.15.0') {
  return path.join(
    stateDirectory(testFixture, version),
    `${kind}-${BigInt(generation).toString().padStart(20, '0')}`,
  );
}

function writePendingOperation(testFixture, {
  generation = 1n,
  owner = { pid: process.pid, token: 'e'.repeat(32) },
  modifiedAt = new Date(),
} = {}) {
  const directory = operationPath(testFixture, 'pending', generation);
  fs.mkdirSync(directory, { recursive: true });
  const ownerPath = path.join(directory, 'owner.json');
  fs.writeFileSync(ownerPath, typeof owner === 'string' ? owner : `${JSON.stringify(owner)}\n`);
  fs.utimesSync(ownerPath, modifiedAt, modifiedAt);
  return directory;
}

function pauseMkdirOnce(targetPath) {
  const originalMkdir = fsPromises.mkdir;
  let release;
  let markReached;
  let intercepted = false;
  const reached = new Promise((resolve) => { markReached = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  fsPromises.mkdir = async (target, ...args) => {
    if (!intercepted && path.resolve(target) === path.resolve(targetPath)) {
      intercepted = true;
      markReached();
      await gate;
    }
    return originalMkdir(target, ...args);
  };
  return {
    reached,
    release,
    restore() {
      release();
      fsPromises.mkdir = originalMkdir;
    },
  };
}

function pauseReaddirSnapshot(targetDirectory, callNumber) {
  const originalReaddir = fsPromises.readdir;
  let release;
  let markReached;
  let calls = 0;
  const reached = new Promise((resolve) => { markReached = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  fsPromises.readdir = async (target, ...args) => {
    const result = await originalReaddir(target, ...args);
    if (path.resolve(target) === path.resolve(targetDirectory) && ++calls === callNumber) {
      markReached();
      await gate;
    }
    return result;
  };
  return {
    reached,
    release,
    restore() {
      release();
      fsPromises.readdir = originalReaddir;
    },
  };
}

function pauseReaddirSnapshotOnce(targetDirectory, predicate) {
  const originalReaddir = fsPromises.readdir;
  let release;
  let markReached;
  let intercepted = false;
  const reached = new Promise((resolve) => { markReached = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  fsPromises.readdir = async (target, ...args) => {
    const result = await originalReaddir(target, ...args);
    if (!intercepted
      && path.resolve(target) === path.resolve(targetDirectory)
      && predicate(result)) {
      intercepted = true;
      markReached();
      await gate;
    }
    return result;
  };
  return {
    reached,
    release,
    restore() {
      release();
      fsPromises.readdir = originalReaddir;
    },
  };
}

function pauseOpenOnce(predicate) {
  const originalOpen = fsPromises.open;
  let release;
  let markReached;
  let intercepted = false;
  const reached = new Promise((resolve) => { markReached = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  fsPromises.open = async (target, ...args) => {
    if (!intercepted && predicate(target)) {
      intercepted = true;
      markReached();
      await gate;
    }
    return originalOpen(target, ...args);
  };
  return {
    reached,
    release,
    restore() {
      release();
      fsPromises.open = originalOpen;
    },
  };
}

function pauseWriteOnce(basename) {
  return pauseOpenOnce((target) => path.basename(target) === basename);
}

function pauseRenameMatchingOnce(predicate) {
  const originalRename = fsPromises.rename;
  let release;
  let markReached;
  let intercepted = false;
  const reached = new Promise((resolve) => { markReached = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  fsPromises.rename = async (source, destination, ...args) => {
    if (!intercepted && predicate(source, destination)) {
      intercepted = true;
      markReached();
      await gate;
    }
    return originalRename(source, destination, ...args);
  };
  return {
    reached,
    release,
    restore() {
      release();
      fsPromises.rename = originalRename;
    },
  };
}

function pauseRenameOnce(sourcePath, destinationPath) {
  return pauseRenameMatchingOnce((source, destination) => (
    path.resolve(source) === path.resolve(sourcePath)
      && path.resolve(destination) === path.resolve(destinationPath)
  ));
}

function options(testFixture, fetchImpl, overrides = {}) {
  return {
    releasePath: testFixture.releasePath,
    cacheDirectory: testFixture.cacheDirectory,
    fetchImpl,
    now: () => baseTime,
    random: () => 0.5,
    timeoutMs: 50,
    ...overrides,
  };
}

function cachedUpdateState() {
  return {
    schemaVersion: 2,
    skillId: 'archify',
    installedVersion: '2.15.0',
    check: {
      nextCheckAt: new Date(baseTime + (24 * 60 * 60 * 1_000)).toISOString(),
      consecutiveFailures: 0,
    },
    preferences: [],
    candidate: {
      version: '2.16.0',
      targetDigest: `sha256:${'b'.repeat(64)}`,
      severity: 'normal',
      releaseNotes: 'https://github.com/tt-a1i/archify/releases/tag/v2.16.0',
      checkedAt: new Date(baseTime).toISOString(),
    },
  };
}

function currentResult(availableVersion = '2.15.0', {
  installedVersion = '2.15.0', checkedAtMs = baseTime, source = 'network',
} = {}) {
  return {
    status: 'current', installedVersion, availableVersion,
    checkedAt: new Date(checkedAtMs).toISOString(), source, noticeRequired: false,
  };
}

function snooze(testFixture, eventKey, nowMs = baseTime) {
  return setUpdatePreference({
    releasePath: testFixture.releasePath,
    cacheDirectory: testFixture.cacheDirectory,
    eventKey,
    mode: 'snooze',
    now: () => nowMs,
  });
}

function snoozed(eventKey, nowMs = baseTime) {
  return {
    status: 'snoozed', eventKey,
    suppressedUntil: new Date(nowMs + (7 * 24 * 60 * 60 * 1_000)).toISOString(),
  };
}

function createFifo(target) {
  const created = spawnSync('mkfifo', [target], { encoding: 'utf8' });
  if (created.error?.code === 'ENOENT') return false;
  assert.equal(created.status, 0, created.stderr || created.error?.message);
  return true;
}

function runCheckInChild(testFixture) {
  const manifest = remoteReleaseForVersion('2.15.0', 'd'.repeat(64));
  const childSource = `
    import { checkForUpdate } from ${JSON.stringify(pathToFileURL(checkerPath).href)};
    const watchdog = setTimeout(() => {
      process.stderr.write('child update check timed out\\n');
      process.exit(124);
    }, ${childCheckTimeoutMs});
    let requests = 0;
    try {
      const result = await checkForUpdate({
        releasePath: ${JSON.stringify(testFixture.releasePath)},
        cacheDirectory: ${JSON.stringify(testFixture.cacheDirectory)},
        fetchImpl: async () => {
          requests += 1;
          return new Response(${JSON.stringify(JSON.stringify(manifest))}, {
            status: 200,
            headers: { 'content-type': 'application/json' },
          });
        },
        now: () => ${baseTime},
        random: () => 0.5,
        timeoutMs: 50,
      });
      process.stdout.write(JSON.stringify({ result, requests }));
    } finally {
      clearTimeout(watchdog);
    }
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', childSource], {
    cwd: skillRoot,
    encoding: 'utf8',
    timeout: parentCheckTimeoutMs,
  });
  const diagnostics = [child.error?.stack, child.stderr, child.stdout].filter(Boolean).join('\n');
  assert.equal(child.error, undefined, diagnostics);
  assert.equal(child.status, 0, diagnostics);
  return JSON.parse(child.stdout);
}

function assertUnsafeCacheStateIsIgnored(testFixture) {
  assert.deepEqual(runCheckInChild(testFixture), {
    result: currentResult(),
    requests: 1,
  });
}

test('production manifest URL is a fixed trusted GitHub Pages resource', () => {
  assert.equal(DEFAULT_MANIFEST_URL, expectedManifestUrl);
  const local = JSON.parse(fs.readFileSync(path.join(skillRoot, 'skill-release.json'), 'utf8'));
  assert.equal(local.updateManifestUrl, expectedManifestUrl);
  assert.equal(local.source.repository, expectedRepository);
});

test('SemVer comparison handles stable, prerelease, and downgrade ordering', () => {
  assert.equal(compareSemver('2.16.0', '2.15.0'), 1);
  assert.equal(compareSemver('2.16.0-dev.0', '2.15.0'), 1);
  assert.equal(compareSemver('2.16.0', '2.16.0-dev.9'), 1);
  assert.equal(compareSemver('2.16.0-dev.2', '2.16.0-dev.10'), -1);
  assert.equal(compareSemver('2.16.0', '2.16.0'), 0);
  assert.equal(compareSemver('2.16.0+build.9', '2.16.0+build.1'), 0);
  assert.equal(compareSemver('9007199254740993.0.0', '9007199254740992.0.0'), 1);
  assert.equal(compareSemver('2.16.0-dev.9007199254740993', '2.16.0-dev.9007199254740992'), 1);
  assert.throws(() => compareSemver('2.16.0-dev.01', '2.16.0'));
});

test('development installs never treat the older stable release as an update', async (t) => {
  const testFixture = fixture('2.16.0-dev.0');
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));

  const result = await checkForUpdate(options(
    testFixture,
    async () => response(remoteRelease({
      version: '2.15.0',
      source: {
        repository: expectedRepository,
        ref: 'v2.15.0',
        treeSha: 'c'.repeat(40),
      },
      artifact: { sha256: 'd'.repeat(64) },
      releaseNotes: 'https://github.com/tt-a1i/archify/releases/tag/v2.15.0',
    })),
  ));

  assert.deepEqual(result, currentResult('2.15.0', { installedVersion: '2.16.0-dev.0' }));
});

test('a changed digest never bypasses same-version or downgrade protection', async () => {
  for (const [version, digest] of [
    ['2.15.0', 'c'.repeat(64)],
    ['2.14.9', 'd'.repeat(64)],
  ]) {
    const testFixture = fixture();
    try {
      const result = await checkForUpdate(options(
        testFixture,
        async () => response(remoteReleaseForVersion(version, digest)),
      ));
      assert.deepEqual(result, currentResult(version));
    } finally {
      fs.rmSync(testFixture.root, { recursive: true, force: true });
    }
  }
});

test('a successful refresh withdraws a previously offered higher candidate', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return response(requests === 1
      ? remoteReleaseForVersion('3.0.0', 'c'.repeat(64))
      : remoteReleaseForVersion('2.15.0', 'd'.repeat(64)));
  };

  const offered = await checkForUpdate(options(testFixture, fetchImpl));
  assert.equal(offered.status, 'update_available');
  assert.equal(offered.latestVersion, '3.0.0');

  const withdrawn = await checkForUpdate(options(testFixture, fetchImpl, {
    now: () => baseTime + (73 * 60 * 60 * 1_000),
  }));
  assert.deepEqual(withdrawn, currentResult('2.15.0', { checkedAtMs: baseTime + (73 * 60 * 60 * 1_000) }));
  assert.equal(JSON.parse(fs.readFileSync(statePath(testFixture), 'utf8')).candidate.version, '2.15.0');
  assert.equal(requests, 2);
});

test('a newer immutable candidate is repeated from cache on every check', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return response(remoteRelease());
  };

  const first = await checkForUpdate(options(testFixture, fetchImpl));
  assert.equal(first.status, 'update_available');
  assert.equal(first.installedVersion, '2.15.0');
  assert.equal(first.latestVersion, '2.16.0');
  assert.equal(first.eventKey, `archify@sha256:${'b'.repeat(64)}`);
  assert.equal(first.targetDigest, `sha256:${'b'.repeat(64)}`);
  assert.equal(first.source, 'network');
  assert.equal(first.noticeRequired, true);
  assert.equal(Object.hasOwn(first, 'updateCommand'), false);
  assert.equal(first.summary, 'Archify 2.16.0 is available; see the official release notes for details.');
  const persisted = JSON.parse(fs.readFileSync(statePath(testFixture), 'utf8'));
  assert.deepEqual(Object.keys(persisted).sort(), [
    'candidate', 'check', 'installedVersion', 'preferences', 'schemaVersion', 'skillId',
  ]);
  assert.deepEqual(Object.keys(persisted.candidate).sort(), [
    'checkedAt', 'releaseNotes', 'severity', 'targetDigest', 'version',
  ]);

  for (let index = 0; index < 2; index += 1) {
    const repeated = await checkForUpdate(options(testFixture, fetchImpl));
    assert.equal(repeated.eventKey, first.eventKey);
    assert.equal(repeated.source, 'cache');
    assert.equal(repeated.checkedAt, first.checkedAt);
    assert.equal(repeated.noticeRequired, true);
  }
  assert.equal(requests, 1, 'fresh cached candidates must not make another request');
});

test('opaque response validators are neither persisted nor replayed after the check TTL', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  let requests = 0;
  const fetchImpl = async (_url, init) => {
    requests += 1;
    assert.equal(init.headers['if-none-match'], undefined);
    return response(remoteRelease(), { etag: `"per-client-${requests}"` });
  };

  const first = await checkForUpdate(options(testFixture, fetchImpl));
  assert.equal(first.status, 'update_available');

  const second = await checkForUpdate(options(testFixture, fetchImpl, {
    now: () => baseTime + (73 * 60 * 60 * 1_000),
  }));
  assert.equal(second.status, 'update_available');
  assert.equal(second.eventKey, first.eventKey);
  assert.equal(requests, 2);
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(statePath(testFixture), 'utf8')).check, 'etag'), false);
});

test('an HTTP 304 is always a failed unconditional refresh', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    if (requests === 1) {
      return new Response(JSON.stringify(remoteRelease()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(null, { status: 304 });
  };

  assert.equal((await checkForUpdate(options(testFixture, fetchImpl))).status, 'update_available');
  const refresh = await checkForUpdate(options(testFixture, fetchImpl, {
    now: () => baseTime + (73 * 60 * 60 * 1_000),
  }));

  assert.equal(refresh.status, 'update_available');
  assert.equal(refresh.source, 'cache');
  assert.equal(requests, 2);
  assert.equal(JSON.parse(fs.readFileSync(statePath(testFixture), 'utf8')).check.consecutiveFailures, 1);
});

test('a failed refresh keeps repeating the last validated candidate', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    if (requests === 1) return response(remoteRelease());
    throw new Error('offline');
  };

  const first = await checkForUpdate(options(testFixture, fetchImpl));
  assert.equal(first.status, 'update_available');
  const failed = await checkForUpdate(options(testFixture, fetchImpl, {
    now: () => baseTime + (73 * 60 * 60 * 1_000),
  }));
  assert.equal(failed.status, 'update_available');
  assert.equal(failed.eventKey, first.eventKey);
  assert.equal(failed.checkedAt, first.checkedAt);

  const cached = await checkForUpdate(options(testFixture, fetchImpl, {
    now: () => baseTime + (74 * 60 * 60 * 1_000),
  }));
  assert.equal(cached.status, 'update_available');
  assert.equal(cached.eventKey, first.eventKey);
  assert.equal(requests, 2);
});

test('failure backoff saturates safely instead of overflowing the cache counter', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  writeJson(statePath(testFixture), {
    schemaVersion: 2,
    skillId: 'archify',
    installedVersion: '2.15.0',
    check: {
      nextCheckAt: new Date(baseTime - 1_000).toISOString(),
      consecutiveFailures: Number.MAX_SAFE_INTEGER,
    },
    preferences: [],
  });
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    throw new Error('offline');
  };

  assert.deepEqual(await checkForUpdate(options(testFixture, fetchImpl)), {
    status: 'silent',
    reason: 'check-failed',
  });
  assert.deepEqual(await checkForUpdate(options(testFixture, fetchImpl, {
    now: () => baseTime + (60 * 60 * 1_000),
  })), { status: 'silent', reason: 'cache-valid' });
  assert.equal(requests, 1);
  assert.equal(JSON.parse(fs.readFileSync(statePath(testFixture), 'utf8')).check.consecutiveFailures, 2);
});

test('a committed cache FIFO is ignored without blocking the update check', (t) => {
  if (process.platform === 'win32') {
    t.skip('FIFO files are unavailable on Windows');
    return;
  }
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const cacheStatePath = statePath(testFixture);
  fs.mkdirSync(path.dirname(cacheStatePath), { recursive: true });
  if (!createFifo(cacheStatePath)) {
    t.skip('mkfifo is unavailable');
    return;
  }

  assertUnsafeCacheStateIsIgnored(testFixture);
});

test('a committed cache state symlink is ignored without following its target', (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const cacheStatePath = statePath(testFixture);
  const linkedTarget = path.join(testFixture.root, 'linked-state-target');
  fs.mkdirSync(path.dirname(cacheStatePath), { recursive: true });
  const targetIsFifo = process.platform !== 'win32' && createFifo(linkedTarget);
  if (!targetIsFifo) writeJson(linkedTarget, cachedUpdateState());
  fs.symlinkSync(linkedTarget, cacheStatePath, process.platform === 'win32' ? 'file' : undefined);

  assertUnsafeCacheStateIsIgnored(testFixture);
});

test('an oversized committed cache state is ignored without an unbounded read', (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const oversizedState = `${JSON.stringify(cachedUpdateState())}${' '.repeat(256 * 1_024)}`;
  const cacheStatePath = statePath(testFixture);
  fs.mkdirSync(path.dirname(cacheStatePath), { recursive: true });
  fs.writeFileSync(cacheStatePath, oversizedState);

  assertUnsafeCacheStateIsIgnored(testFixture);
});

test('a cache ancestor replaced before a cached read cannot inject a reminder', async (t) => {
  const testFixture = fixture();
  const originalReaddir = fsPromises.readdir;
  t.after(() => {
    fsPromises.readdir = originalReaddir;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  writeCompactCommittedState(testFixture, expiredCachedState());
  const replacementRoot = path.join(testFixture.root, 'replacement-cache');
  writeJson(
    path.join(replacementRoot, path.basename(stateDirectory(testFixture)),
      path.basename(operationPath(testFixture, 'committed', 1n)), 'state.json'),
    cachedUpdateState(),
  );
  const detachedCache = path.join(testFixture.root, 'detached-cache');
  const probe = path.join(testFixture.root, 'symlink-probe');
  try {
    fs.symlinkSync(
      replacementRoot,
      probe,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    fs.unlinkSync(probe);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`directory symlinks are unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  let replaced = false;
  fsPromises.readdir = async (target, ...args) => {
    if (!replaced && path.resolve(target) === path.resolve(stateDirectory(testFixture))) {
      replaced = true;
      fs.renameSync(testFixture.cacheDirectory, detachedCache);
      fs.symlinkSync(
        replacementRoot,
        testFixture.cacheDirectory,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    return originalReaddir(target, ...args);
  };
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.equal(replaced, true);
  assert.deepEqual(result, { status: 'silent', reason: 'cache-unavailable' });
  assert.equal(requests, 0);
});

test('a committed directory replaced by a symlink cannot inject a reminder', async (t) => {
  const testFixture = fixture();
  const originalReaddir = fsPromises.readdir;
  t.after(() => {
    fsPromises.readdir = originalReaddir;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  writeCompactCommittedState(testFixture, expiredCachedState());
  const committed = operationPath(testFixture, 'committed', 1n);
  const replacement = path.join(testFixture.root, 'replacement-committed');
  writeJson(path.join(replacement, 'state.json'), cachedUpdateState());
  const probe = path.join(testFixture.root, 'nested-symlink-probe');
  try {
    fs.symlinkSync(
      replacement,
      probe,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    fs.unlinkSync(probe);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`directory symlinks are unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const detached = path.join(stateDirectory(testFixture), 'detached-committed');
  let replaced = false;
  fsPromises.readdir = async (target, ...args) => {
    const entries = await originalReaddir(target, ...args);
    if (!replaced && path.resolve(target) === path.resolve(stateDirectory(testFixture))) {
      replaced = true;
      fs.renameSync(committed, detached);
      fs.symlinkSync(
        replacement,
        committed,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    return entries;
  };
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.equal(replaced, true);
  assert.deepEqual(result, { status: 'silent', reason: 'cache-unavailable' });
  assert.equal(requests, 0);
});

test('a pending directory replaced by a symlink cannot be ignored as inactive', async (t) => {
  const testFixture = fixture();
  const originalReaddir = fsPromises.readdir;
  t.after(() => {
    fsPromises.readdir = originalReaddir;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  const pending = writePendingOperation(testFixture);
  const replacement = path.join(testFixture.root, 'replacement-pending');
  writePendingOperation({
    ...testFixture,
    cacheDirectory: path.join(testFixture.root, 'replacement-cache'),
  }, { modifiedAt: new Date(Date.now() - 60_000) });
  const replacementPending = operationPath({
    ...testFixture,
    cacheDirectory: path.join(testFixture.root, 'replacement-cache'),
  }, 'pending', 1n);
  fs.renameSync(replacementPending, replacement);
  const probe = path.join(testFixture.root, 'pending-symlink-probe');
  try {
    fs.symlinkSync(
      replacement,
      probe,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    fs.unlinkSync(probe);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`directory symlinks are unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const detached = path.join(stateDirectory(testFixture), 'detached-pending');
  let replaced = false;
  fsPromises.readdir = async (target, ...args) => {
    const entries = await originalReaddir(target, ...args);
    if (!replaced && path.resolve(target) === path.resolve(stateDirectory(testFixture))) {
      replaced = true;
      fs.renameSync(pending, detached);
      fs.symlinkSync(
        replacement,
        pending,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    return entries;
  };
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.equal(replaced, true);
  assert.deepEqual(result, { status: 'silent', reason: 'cache-unavailable' });
  assert.equal(requests, 0);
});

test('zero-inode cache metadata uses timestamp fallback to reject a replaced ancestor', async (t) => {
  const testFixture = fixture();
  const originalLstat = fsPromises.lstat;
  const originalReaddir = fsPromises.readdir;
  t.after(() => {
    fsPromises.lstat = originalLstat;
    fsPromises.readdir = originalReaddir;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  writeCompactCommittedState(testFixture, expiredCachedState());
  const replacementRoot = path.join(testFixture.root, 'replacement-cache');
  writeJson(
    path.join(replacementRoot, path.basename(stateDirectory(testFixture)),
      path.basename(operationPath(testFixture, 'committed', 1n)), 'state.json'),
    cachedUpdateState(),
  );
  const detachedCache = path.join(testFixture.root, 'detached-cache');
  fsPromises.lstat = async (target, ...args) => {
    const metadata = await originalLstat(target, ...args);
    const resolved = path.resolve(target);
    const isCachePath = resolved === path.resolve(testFixture.cacheDirectory)
      || resolved.startsWith(`${path.resolve(testFixture.cacheDirectory)}${path.sep}`);
    if (args[0]?.bigint && isCachePath && metadata.isDirectory()) {
      return metadataWithOverrides(metadata, {
        ino: 0n,
        birthtimeNs: replaced ? 2_000n : 1_000n,
      });
    }
    return metadata;
  };
  let replaced = false;
  fsPromises.readdir = async (target, ...args) => {
    if (!replaced && path.resolve(target) === path.resolve(stateDirectory(testFixture))) {
      replaced = true;
      fs.renameSync(testFixture.cacheDirectory, detachedCache);
      fs.renameSync(replacementRoot, testFixture.cacheDirectory);
    }
    return originalReaddir(target, ...args);
  };
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.equal(replaced, true);
  assert.deepEqual(result, { status: 'silent', reason: 'cache-unavailable' });
  assert.equal(requests, 0);
});

test('zero-inode cache metadata still supports a normal check and snooze', async (t) => {
  const testFixture = fixture();
  const originalLstat = fsPromises.lstat;
  const originalOpen = fsPromises.open;
  t.after(() => {
    fsPromises.lstat = originalLstat;
    fsPromises.open = originalOpen;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  const cacheRoot = path.resolve(testFixture.cacheDirectory);
  const isCachePath = (target) => {
    const resolved = path.resolve(target);
    return resolved === cacheRoot || resolved.startsWith(`${cacheRoot}${path.sep}`);
  };
  fsPromises.lstat = async (target, ...args) => {
    const metadata = await originalLstat(target, ...args);
    if (args[0]?.bigint && isCachePath(target)) {
      return metadataWithOverrides(metadata, { ino: 0n, birthtimeNs: 1_000n });
    }
    return metadata;
  };
  fsPromises.open = async (target, ...args) => {
    const handle = await originalOpen(target, ...args);
    if (!isCachePath(target)) return handle;
    return new Proxy(handle, {
      get(fileHandle, property) {
        if (property === 'stat') {
          return async (...statArguments) => {
            const metadata = await fileHandle.stat(...statArguments);
            return statArguments[0]?.bigint
              ? metadataWithOverrides(metadata, { ino: 0n, birthtimeNs: 1_000n })
              : metadataWithOverrides(metadata, { ino: 0 });
          };
        }
        const value = Reflect.get(fileHandle, property, fileHandle);
        return typeof value === 'function' ? value.bind(fileHandle) : value;
      },
    });
  };
  let requests = 0;

  const offered = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));
  const snoozed = await setUpdatePreference({
    releasePath: testFixture.releasePath,
    cacheDirectory: testFixture.cacheDirectory,
    eventKey: offered.eventKey,
    mode: 'snooze',
    now: () => baseTime,
  });

  assert.equal(offered.status, 'update_available');
  assert.equal(snoozed.status, 'snoozed');
  assert.equal(snoozed.eventKey, offered.eventKey);
  assert.equal(requests, 1);
});

test('zero-inode cache metadata without birthtime fails closed', async (t) => {
  const testFixture = fixture();
  const originalLstat = fsPromises.lstat;
  t.after(() => {
    fsPromises.lstat = originalLstat;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  const cacheRoot = path.resolve(testFixture.cacheDirectory);
  fsPromises.lstat = async (target, ...args) => {
    const metadata = await originalLstat(target, ...args);
    const resolved = path.resolve(target);
    if (args[0]?.bigint
      && (resolved === cacheRoot || resolved.startsWith(`${cacheRoot}${path.sep}`))) {
      return metadataWithOverrides(metadata, { ino: 0n, birthtimeNs: 0n });
    }
    return metadata;
  };
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.deepEqual(result, { status: 'silent', reason: 'cache-unavailable' });
  assert.equal(requests, 0);
});

test('a state write replaced before post-verification is never reported as committed', async (t) => {
  const testFixture = fixture();
  const originalOpen = fsPromises.open;
  const originalWriteFile = fsPromises.writeFile;
  t.after(() => {
    fsPromises.open = originalOpen;
    fsPromises.writeFile = originalWriteFile;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  let replaced = false;
  const replaceStateFile = (target) => {
    if (replaced) return;
    replaced = true;
    fs.renameSync(target, `${target}.written-by-checker`);
    fs.writeFileSync(target, '{}\n', { flag: 'wx', mode: 0o600 });
  };
  fsPromises.writeFile = async (target, ...args) => {
    const result = await originalWriteFile(target, ...args);
    if (path.basename(target).startsWith('.state.')) replaceStateFile(target);
    return result;
  };
  fsPromises.open = async (target, ...args) => {
    const handle = await originalOpen(target, ...args);
    if (!path.basename(target).startsWith('.state.')) return handle;
    return {
      stat: handle.stat.bind(handle),
      writeFile: handle.writeFile.bind(handle),
      close: async () => {
        const result = await handle.close();
        replaceStateFile(target);
        return result;
      },
    };
  };

  const result = await checkForUpdate(options(testFixture, async () => response(remoteRelease())));

  assert.equal(replaced, true);
  assert.equal(result.status, 'update_available');
  assert.equal(result.source, 'network');
  for (const committed of committedStateFiles(testFixture)) {
    assert.notDeepEqual(JSON.parse(fs.readFileSync(committed, 'utf8')), {});
  }
});

test('a pending directory replaced by a symlink cannot be reported as committed', async (t) => {
  const testFixture = fixture();
  const originalRename = fsPromises.rename;
  t.after(() => {
    fsPromises.rename = originalRename;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  const probe = path.join(testFixture.root, 'symlink-probe');
  try {
    fs.mkdirSync(probe);
    const probeLink = `${probe}-link`;
    fs.symlinkSync(probe, probeLink, process.platform === 'win32' ? 'junction' : 'dir');
    fs.unlinkSync(probeLink);
    fs.rmdirSync(probe);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`directory symlinks are unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const detachedPending = path.join(testFixture.root, 'detached-pending');
  let pending = null;
  let replaced = false;
  fsPromises.rename = async (source, destination, ...args) => {
    if (!pending
      && path.basename(source).startsWith('.state.')
      && path.basename(destination) === 'state.json') {
      const result = await originalRename(source, destination, ...args);
      pending = path.dirname(destination);
      return result;
    }
    if (!replaced
      && pending
      && path.resolve(source) === path.resolve(pending)
      && path.basename(destination).startsWith('committed-')) {
      replaced = true;
      fs.renameSync(pending, detachedPending);
      fs.symlinkSync(
        detachedPending,
        pending,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    return originalRename(source, destination, ...args);
  };
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.equal(replaced, true);
  assert.equal(result.status, 'update_available');
  assert.equal(result.source, 'network');
  assert.equal(requests, 1);
  assert.equal(fs.existsSync(path.join(detachedPending, 'state.json')), true);
});

test('a cache trust failure while cancelling cannot return a cached reminder', async (t) => {
  const testFixture = fixture();
  const originalRename = fsPromises.rename;
  t.after(() => {
    fsPromises.rename = originalRename;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  const stale = cachedUpdateState();
  stale.check.nextCheckAt = new Date(baseTime - 1_000).toISOString();
  const committed = writeCompactCommittedState(testFixture, stale);
  const detachedCache = path.join(testFixture.root, 'detached-cache');
  let refreshed = false;
  let replaced = false;
  fsPromises.rename = async (source, destination, ...args) => {
    const sourceName = path.basename(source);
    const destinationName = path.basename(destination);
    if (!refreshed && sourceName.startsWith('claim-') && destinationName === 'active-claim') {
      const result = await originalRename(source, destination, ...args);
      const fresh = cachedUpdateState();
      writeJson(committed, fresh);
      refreshed = true;
      return result;
    }
    if (!replaced && sourceName.startsWith('pending-') && destinationName.startsWith('cancelled-')) {
      replaced = true;
      fs.renameSync(testFixture.cacheDirectory, detachedCache);
      fs.symlinkSync(
        detachedCache,
        testFixture.cacheDirectory,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    return originalRename(source, destination, ...args);
  };
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.equal(refreshed, true);
  assert.equal(replaced, true);
  assert.deepEqual(result, { status: 'silent', reason: 'cache-unavailable' });
  assert.equal(requests, 0);
});

test('prepared claim cleanup never recursively deletes through a replaced cache ancestor', async (t) => {
  const testFixture = fixture();
  const originalOpen = fsPromises.open;
  const originalRm = fsPromises.rm;
  const originalWriteFile = fsPromises.writeFile;
  t.after(() => {
    fsPromises.open = originalOpen;
    fsPromises.rm = originalRm;
    fsPromises.writeFile = originalWriteFile;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  const activeClaim = path.join(stateDirectory(testFixture), 'active-claim');
  let injectedActiveClaim = false;
  const injectActiveClaim = () => {
    if (injectedActiveClaim) return;
    injectedActiveClaim = true;
    fs.mkdirSync(activeClaim);
  };
  fsPromises.writeFile = async (target, ...args) => {
    const result = await originalWriteFile(target, ...args);
    if (path.basename(path.dirname(target)).startsWith('claim-')
      && path.basename(target) === 'owner.json') injectActiveClaim();
    return result;
  };
  fsPromises.open = async (target, ...args) => {
    const handle = await originalOpen(target, ...args);
    if (path.basename(path.dirname(target)).startsWith('claim-')
      && path.basename(target) === 'owner.json') {
      return {
        stat: handle.stat.bind(handle),
        writeFile: handle.writeFile.bind(handle),
        close: async () => {
          const result = await handle.close();
          injectActiveClaim();
          return result;
        },
      };
    }
    return handle;
  };
  const victimRoot = path.join(testFixture.root, 'victim-cache');
  const victimClaim = path.join(
    victimRoot,
    path.basename(stateDirectory(testFixture)),
    path.basename(operationPath(testFixture, 'claim', 1n)),
  );
  const victimFile = path.join(victimClaim, 'important.txt');
  fs.mkdirSync(victimClaim, { recursive: true });
  fs.writeFileSync(victimFile, 'must survive\n');
  const detachedCache = path.join(testFixture.root, 'detached-cache');
  let interceptedRemoval = false;
  fsPromises.rm = async (target, ...args) => {
    if (!interceptedRemoval && path.basename(target).startsWith('claim-')) {
      interceptedRemoval = true;
      fs.renameSync(testFixture.cacheDirectory, detachedCache);
      fs.symlinkSync(
        victimRoot,
        testFixture.cacheDirectory,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    return originalRm(target, ...args);
  };
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.equal(injectedActiveClaim, true);
  assert.equal(requests, 0);
  assert.equal(result.status, 'silent');
  assert.equal(interceptedRemoval, false);
  assert.equal(fs.readFileSync(victimFile, 'utf8'), 'must survive\n');
  const coordinationEntries = fs.readdirSync(stateDirectory(testFixture));
  assert.deepEqual(
    coordinationEntries.filter((name) => name.startsWith('claim-')),
    [],
  );
  const discardedClaims = coordinationEntries
    .filter((name) => name.startsWith('discarded-claim-'));
  assert.equal(discardedClaims.length, 1);
  const discardedOwnerPath = path.join(
    stateDirectory(testFixture),
    discardedClaims[0],
    'owner.json',
  );
  const discardedOwner = JSON.parse(fs.readFileSync(discardedOwnerPath, 'utf8'));
  assert.deepEqual(Object.keys(discardedOwner).sort(), ['generation', 'pid', 'token']);
  assert.equal(discardedOwner.generation, '1');
  assert.match(discardedOwner.token, /^[a-f0-9]{32}$/);
  assert.equal(discardedClaims[0].endsWith(`-${discardedOwner.token}`), true);
});

test('a cache path case alias is accepted on case-aliasing filesystems', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const aliasedRoot = caseVariant(testFixture.root);
  if (!fs.existsSync(aliasedRoot)) {
    t.skip('the fixture filesystem does not alias path casing');
    return;
  }
  const cacheDirectory = path.join(aliasedRoot, 'cache');

  const result = await checkForUpdate(options(
    testFixture,
    async () => response(remoteRelease()),
    { cacheDirectory },
  ));

  assert.equal(result.status, 'update_available');
  assert.ok(fs.readdirSync(stateDirectory({ ...testFixture, cacheDirectory })).some(
    (entry) => entry.startsWith('committed-'),
  ));
});

test('updater accepts a Windows 8.3 short path for its cache', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows-only 8.3 cache path regression');
    return;
  }
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const realDirectory = path.join(testFixture.root, 'cache directory requiring short alias');
  fs.mkdirSync(realDirectory);
  const shortDirectory = windowsShortPath(realDirectory);
  if (!shortDirectory) {
    t.skip('the Windows volume does not expose a distinct 8.3 short path');
    return;
  }
  const cacheDirectory = path.join(shortDirectory, 'cache');

  const result = await checkForUpdate(options(
    testFixture,
    async () => response(remoteRelease()),
    { cacheDirectory },
  ));

  assert.equal(result.status, 'update_available');
  const physicalCache = path.join(realDirectory, 'cache');
  assert.ok(fs.readdirSync(stateDirectory({ ...testFixture, cacheDirectory: physicalCache })).some(
    (entry) => entry.startsWith('committed-'),
  ));
});

test('updater rejects a case-only alias of its prepared cache root', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('Windows-only cache root alias regression');
    return;
  }
  const testFixture = fixture();
  const originalJoin = path.join;
  const originalMkdir = fsPromises.mkdir;
  let injected = false;
  let rootAlias = null;
  let rootMutationAttempts = 0;
  t.after(() => {
    path.join = originalJoin;
    fsPromises.mkdir = originalMkdir;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  path.join = (...parts) => {
    if (!injected
      && parts.length === 2
      && /^reserved-\d{20}$/.test(String(parts[1]))) {
      injected = true;
      rootAlias = caseVariant(parts[0]);
      assert.equal(fs.existsSync(rootAlias), true);
      return rootAlias;
    }
    return originalJoin(...parts);
  };
  fsPromises.mkdir = async (target, ...args) => {
    if (rootAlias !== null && path.resolve(target) === path.resolve(rootAlias)) {
      rootMutationAttempts += 1;
    }
    return originalMkdir(target, ...args);
  };
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.equal(injected, true);
  assert.deepEqual(result, { status: 'silent', reason: 'cache-unavailable' });
  assert.equal(rootMutationAttempts, 0);
  assert.equal(requests, 0);
});

test('a symlink cache root cannot write into its target', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const protectedTarget = path.join(testFixture.root, 'simulated-project-config');
  fs.mkdirSync(protectedTarget);
  fs.writeFileSync(path.join(protectedTarget, 'settings.json'), '{"protected":true}\n');
  try {
    fs.symlinkSync(
      protectedTarget,
      testFixture.cacheDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`directory symlinks are unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.deepEqual(result, { status: 'silent', reason: 'cache-unavailable' });
  assert.equal(requests, 0);
  assert.deepEqual(fs.readdirSync(protectedTarget), ['settings.json']);
});

test('a cache path equal to a trusted directory through a symlink is still rejected', async (t) => {
  const testFixture = fixture();
  const originalTmpdir = os.tmpdir;
  const protectedTarget = path.join(testFixture.root, 'trusted-target');
  const authoredAlias = path.join(testFixture.root, 'trusted-alias');
  fs.mkdirSync(protectedTarget);
  fs.writeFileSync(path.join(protectedTarget, 'settings.json'), '{"protected":true}\n');
  try {
    fs.symlinkSync(
      protectedTarget,
      authoredAlias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`directory symlinks are unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  os.tmpdir = () => protectedTarget;
  t.after(() => {
    os.tmpdir = originalTmpdir;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }, { cacheDirectory: authoredAlias }));

  assert.deepEqual(result, { status: 'silent', reason: 'cache-unavailable' });
  assert.equal(requests, 0);
  assert.deepEqual(fs.readdirSync(protectedTarget), ['settings.json']);
});

test('a symlink cache ancestor cannot redirect cache writes', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const protectedTarget = path.join(testFixture.root, 'simulated-project-config');
  const linkedAncestor = path.join(testFixture.root, 'cache-parent');
  const cacheDirectory = path.join(linkedAncestor, 'nested', 'cache');
  fs.mkdirSync(protectedTarget);
  fs.writeFileSync(path.join(protectedTarget, 'settings.json'), '{"protected":true}\n');
  try {
    fs.symlinkSync(
      protectedTarget,
      linkedAncestor,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`directory symlinks are unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }, { cacheDirectory }));

  assert.deepEqual(result, { status: 'silent', reason: 'cache-unavailable' });
  assert.equal(requests, 0);
  assert.deepEqual(fs.readdirSync(protectedTarget), ['settings.json']);
});

test('a cache ancestor replaced during preparation cannot redirect later writes', async (t) => {
  const testFixture = fixture();
  const originalLstat = fsPromises.lstat;
  t.after(() => {
    fsPromises.lstat = originalLstat;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  const protectedTarget = path.join(testFixture.root, 'simulated-project-config');
  const protectedVersion = path.join(protectedTarget, path.basename(stateDirectory(testFixture)));
  const detachedCache = path.join(testFixture.root, 'detached-cache');
  const probe = path.join(testFixture.root, 'symlink-probe');
  fs.mkdirSync(testFixture.cacheDirectory);
  fs.mkdirSync(protectedVersion, { recursive: true });
  fs.writeFileSync(path.join(protectedVersion, 'settings.json'), '{"protected":true}\n');
  try {
    fs.symlinkSync(
      protectedTarget,
      probe,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    fs.unlinkSync(probe);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`directory symlinks are unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  let replaced = false;
  const versionDirectoryName = path.basename(stateDirectory(testFixture));
  fsPromises.lstat = async (target, ...args) => {
    if (!replaced && path.basename(target) === versionDirectoryName) {
      replaced = true;
      fs.renameSync(testFixture.cacheDirectory, detachedCache);
      fs.symlinkSync(
        protectedTarget,
        testFixture.cacheDirectory,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    return originalLstat(target, ...args);
  };
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.equal(replaced, true);
  assert.deepEqual(result, { status: 'silent', reason: 'cache-unavailable' });
  assert.equal(requests, 0);
  assert.deepEqual(fs.readdirSync(protectedVersion), ['settings.json']);
});

test('a cache ancestor replaced before reservation creation fails closed', async (t) => {
  const testFixture = fixture();
  const originalMkdir = fsPromises.mkdir;
  t.after(() => {
    fsPromises.mkdir = originalMkdir;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  const replacementRoot = path.join(testFixture.root, 'replacement-cache');
  const replacementVersion = path.join(
    replacementRoot,
    path.basename(stateDirectory(testFixture)),
  );
  const detachedCache = path.join(testFixture.root, 'detached-cache');
  const probe = path.join(testFixture.root, 'symlink-probe');
  fs.mkdirSync(replacementVersion, { recursive: true });
  fs.writeFileSync(path.join(replacementVersion, 'settings.json'), '{"protected":true}\n');
  try {
    fs.symlinkSync(
      replacementRoot,
      probe,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    fs.unlinkSync(probe);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`directory symlinks are unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  let replaced = false;
  fsPromises.mkdir = async (target, ...args) => {
    if (!replaced && path.basename(target).startsWith('reserved-')) {
      replaced = true;
      fs.renameSync(testFixture.cacheDirectory, detachedCache);
      fs.symlinkSync(
        replacementRoot,
        testFixture.cacheDirectory,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    return originalMkdir(target, ...args);
  };
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.equal(replaced, true);
  assert.deepEqual(result, { status: 'silent', reason: 'cache-unavailable' });
  assert.equal(requests, 0);
  const replacementEntries = fs.readdirSync(replacementVersion).sort();
  const reservations = replacementEntries.filter((entry) => entry.startsWith('reserved-'));
  assert.equal(reservations.length, 1);
  assert.deepEqual(
    replacementEntries.filter((entry) => !entry.startsWith('reserved-')),
    ['settings.json'],
  );
  assert.deepEqual(fs.readdirSync(path.join(replacementVersion, reservations[0])), []);
});

test('a cache ancestor replacement restored after reservation creation fails closed', async (t) => {
  const testFixture = fixture();
  const originalMkdir = fsPromises.mkdir;
  t.after(() => {
    fsPromises.mkdir = originalMkdir;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  const replacementRoot = path.join(testFixture.root, 'replacement-cache');
  const replacementVersion = path.join(
    replacementRoot,
    path.basename(stateDirectory(testFixture)),
  );
  const detachedCache = path.join(testFixture.root, 'detached-cache');
  const probe = path.join(testFixture.root, 'symlink-probe');
  fs.mkdirSync(replacementVersion, { recursive: true });
  fs.writeFileSync(path.join(replacementVersion, 'settings.json'), '{"protected":true}\n');
  try {
    fs.symlinkSync(
      replacementRoot,
      probe,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    fs.unlinkSync(probe);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`directory symlinks are unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  let restored = false;
  fsPromises.mkdir = async (target, ...args) => {
    if (!restored && path.basename(target).startsWith('reserved-')) {
      fs.renameSync(testFixture.cacheDirectory, detachedCache);
      fs.symlinkSync(
        replacementRoot,
        testFixture.cacheDirectory,
        process.platform === 'win32' ? 'junction' : 'dir',
      );
      try {
        return await originalMkdir(target, ...args);
      } finally {
        fs.unlinkSync(testFixture.cacheDirectory);
        fs.renameSync(detachedCache, testFixture.cacheDirectory);
        restored = true;
      }
    }
    return originalMkdir(target, ...args);
  };
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.equal(restored, true);
  assert.deepEqual(result, { status: 'silent', reason: 'cache-unavailable' });
  assert.equal(requests, 0);
  const replacementEntries = fs.readdirSync(replacementVersion).sort();
  const reservations = replacementEntries.filter((entry) => entry.startsWith('reserved-'));
  assert.equal(reservations.length, 1);
  assert.deepEqual(
    replacementEntries.filter((entry) => !entry.startsWith('reserved-')),
    ['settings.json'],
  );
  assert.deepEqual(fs.readdirSync(path.join(replacementVersion, reservations[0])), []);
});

test('an authored symlink is rejected even when it is also reported as a trusted prefix', async (t) => {
  const testFixture = fixture();
  const originalHomedir = os.homedir;
  const originalLstat = fsPromises.lstat;
  t.after(() => {
    os.homedir = originalHomedir;
    fsPromises.lstat = originalLstat;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  const trustedAlias = path.join(testFixture.root, 'trusted-home');
  const canonicalHome = path.join(testFixture.root, 'canonical-home');
  const protectedTarget = path.join(testFixture.root, 'simulated-project-config');
  const cacheDirectory = path.join(trustedAlias, 'cache');
  fs.mkdirSync(canonicalHome);
  fs.mkdirSync(protectedTarget);
  fs.writeFileSync(path.join(protectedTarget, 'settings.json'), '{"protected":true}\n');
  try {
    fs.symlinkSync(
      canonicalHome,
      trustedAlias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`directory symlinks are unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  os.homedir = () => trustedAlias;
  const canonicalVersionDirectory = path.join(
    fs.realpathSync(canonicalHome),
    'cache',
    path.basename(stateDirectory(testFixture)),
  );
  let targetVisits = 0;
  let switched = false;
  fsPromises.lstat = async (target, ...args) => {
    const metadata = await originalLstat(target, ...args);
    if (!switched && path.resolve(target) === canonicalVersionDirectory) {
      targetVisits += 1;
      if (targetVisits === 2) {
        switched = true;
        fs.unlinkSync(trustedAlias);
        fs.symlinkSync(
          protectedTarget,
          trustedAlias,
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      }
    }
    return metadata;
  };

  const result = await checkForUpdate(options(testFixture, async () => response(remoteRelease()), {
    cacheDirectory,
  }));

  assert.equal(switched, false);
  assert.deepEqual(result, { status: 'silent', reason: 'cache-unavailable' });
  assert.deepEqual(fs.readdirSync(protectedTarget), ['settings.json']);
  assert.equal(fs.existsSync(canonicalVersionDirectory), false);
});

test('concurrent checks use one writer and leave a valid cache', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  let releaseFetch;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const fetchImpl = async () => {
    markStarted();
    return new Promise((resolve) => { releaseFetch = resolve; });
  };

  const firstCheck = checkForUpdate(options(testFixture, fetchImpl));
  await started;
  const overlapping = await checkForUpdate(options(testFixture, fetchImpl));
  assert.deepEqual(overlapping, { status: 'silent', reason: 'check-in-progress' });

  releaseFetch(response(remoteRelease()));
  const first = await firstCheck;
  assert.equal(first.status, 'update_available');
  assert.doesNotThrow(() => JSON.parse(
    fs.readFileSync(statePath(testFixture), 'utf8'),
  ));
});

test('an empty precheck snapshot cannot start a second concurrent network request', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  fs.mkdirSync(stateDirectory(testFixture), { recursive: true });
  const pause = pauseReaddirSnapshot(stateDirectory(testFixture), 2);
  t.after(() => pause.restore());
  let releaseFetch;
  let markFetchStarted;
  let requests = 0;
  const fetchStarted = new Promise((resolve) => { markFetchStarted = resolve; });
  const fetchImpl = async () => {
    requests += 1;
    markFetchStarted();
    return new Promise((resolve) => { releaseFetch = resolve; });
  };

  const delayedPrecheck = checkForUpdate(options(testFixture, fetchImpl));
  await pause.reached;
  const claimedCheck = checkForUpdate(options(testFixture, fetchImpl));
  await fetchStarted;
  pause.release();
  assert.deepEqual(await delayedPrecheck, { status: 'silent', reason: 'check-in-progress' });
  assert.equal(requests, 1);

  releaseFetch(response(remoteRelease()));
  assert.equal((await claimedCheck).status, 'update_available');
  pause.restore();
  assert.equal(requests, 1);
});

test('two promoters cannot replace and then steal a stale empty active claim', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const activeClaim = path.join(stateDirectory(testFixture), 'active-claim');
  fs.mkdirSync(activeClaim, { recursive: true });
  const staleTime = new Date(Date.now() - 60_000);
  fs.utimesSync(activeClaim, staleTime, staleTime);
  const pause = pauseWriteOnce('.retirement-guard');
  t.after(() => pause.restore());
  let releaseFetch;
  let markFetchStarted;
  let requests = 0;
  const fetchStarted = new Promise((resolve) => { markFetchStarted = resolve; });
  const fetchImpl = async () => {
    requests += 1;
    markFetchStarted();
    return new Promise((resolve) => { releaseFetch = resolve; });
  };

  const delayedRetirement = checkForUpdate(options(testFixture, fetchImpl));
  await pause.reached;
  fs.utimesSync(
    path.join(operationPath(testFixture, 'pending', 1n), 'owner.json'),
    staleTime,
    staleTime,
  );
  const claimedCheck = checkForUpdate(options(testFixture, fetchImpl));
  await fetchStarted;
  pause.release();
  assert.deepEqual(await delayedRetirement, { status: 'silent', reason: 'check-in-progress' });
  assert.equal(requests, 1);

  releaseFetch(response(remoteRelease()));
  assert.equal((await claimedCheck).status, 'update_available');
  pause.restore();
  assert.equal(requests, 1);
});

test('a delayed lower-generation promoter cannot retire a completed higher claim', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const pause = pauseRenameOnce(
    operationPath(testFixture, 'claim', 1n),
    path.join(stateDirectory(testFixture), 'active-claim'),
  );
  t.after(() => pause.restore());
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return response(remoteRelease());
  };

  const delayedLower = checkForUpdate(options(testFixture, fetchImpl));
  await pause.reached;
  const staleTime = new Date(Date.now() - 60_000);
  fs.utimesSync(
    path.join(operationPath(testFixture, 'pending', 1n), 'owner.json'),
    staleTime,
    staleTime,
  );
  assert.equal((await checkForUpdate(options(testFixture, fetchImpl))).status, 'update_available');
  assert.equal(requests, 1);

  pause.release();
  assert.equal((await delayedLower).status, 'update_available');
  pause.restore();
  assert.equal(requests, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(
      path.join(stateDirectory(testFixture), 'active-claim', 'owner.json'),
      'utf8',
    )).generation,
    '2',
  );
});

test('an expired contender cannot fetch after its delayed claim promotion succeeds', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const pause = pauseRenameOnce(
    operationPath(testFixture, 'claim', 1n),
    path.join(stateDirectory(testFixture), 'active-claim'),
  );
  t.after(() => pause.restore());
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return response(remoteRelease());
  };

  const delayedExpired = checkForUpdate(options(testFixture, fetchImpl));
  await pause.reached;
  const staleTime = new Date(Date.now() - 60_000);
  fs.utimesSync(
    path.join(operationPath(testFixture, 'pending', 1n), 'owner.json'),
    staleTime,
    staleTime,
  );
  pause.release();
  assert.deepEqual(await delayedExpired, { status: 'silent', reason: 'check-in-progress' });
  assert.equal(requests, 0);

  assert.equal((await checkForUpdate(options(testFixture, fetchImpl))).status, 'update_available');
  pause.restore();
  assert.equal(requests, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(
      path.join(stateDirectory(testFixture), 'active-claim', 'owner.json'),
      'utf8',
    )).generation,
    '2',
  );
});

test('a stale supersession snapshot cannot let a lower promoter retire a higher claim', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const generationOneClaim = path.basename(operationPath(testFixture, 'claim', 1n));
  const pause = pauseReaddirSnapshotOnce(
    stateDirectory(testFixture),
    (entries) => entries.some((entry) => entry.name === generationOneClaim)
      && !entries.some((entry) => /-(?:0{19}2)$/.test(entry.name)),
  );
  t.after(() => pause.restore());
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return response(remoteRelease());
  };

  const delayedLower = checkForUpdate(options(testFixture, fetchImpl));
  await pause.reached;
  const staleTime = new Date(Date.now() - 60_000);
  fs.utimesSync(
    path.join(operationPath(testFixture, 'pending', 1n), 'owner.json'),
    staleTime,
    staleTime,
  );
  assert.equal((await checkForUpdate(options(testFixture, fetchImpl))).status, 'update_available');
  assert.equal(requests, 1);

  pause.release();
  assert.equal((await delayedLower).status, 'update_available');
  pause.restore();
  assert.equal(requests, 1);
  assert.equal(
    JSON.parse(fs.readFileSync(
      path.join(stateDirectory(testFixture), 'active-claim', 'owner.json'),
      'utf8',
    )).generation,
    '2',
  );
});

test('an owner fenced while active ownership is read cannot issue a second GET', {
  timeout: parentCheckTimeoutMs,
}, async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const directory = stateDirectory(testFixture);
  const originalOpen = fsPromises.open;
  let releaseVerification;
  let markVerification;
  let intercepted = false;
  const verificationReached = new Promise((resolve) => { markVerification = resolve; });
  const verificationGate = new Promise((resolve) => { releaseVerification = resolve; });
  fsPromises.open = async (target, ...args) => {
    const handle = await originalOpen(target, ...args);
    if (intercepted
      || path.resolve(target) !== path.join(directory, 'active-claim', 'owner.json')) {
      return handle;
    }
    intercepted = true;
    return new Proxy(handle, {
      get(fileHandle, property) {
        if (property === 'close') {
          return async () => {
            const result = await fileHandle.close();
            markVerification();
            await verificationGate;
            return result;
          };
        }
        const value = Reflect.get(fileHandle, property, fileHandle);
        return typeof value === 'function' ? value.bind(fileHandle) : value;
      },
    });
  };
  t.after(() => {
    releaseVerification();
    fsPromises.open = originalOpen;
  });
  let requests = 0;
  const checkOptions = options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  });

  const suspendedOwner = checkForUpdate(checkOptions);
  await verificationReached;
  const staleTime = new Date(Date.now() - 60_000);
  fs.utimesSync(
    path.join(operationPath(testFixture, 'pending', 1n), 'owner.json'),
    staleTime,
    staleTime,
  );
  assert.equal((await checkForUpdate(checkOptions)).status, 'update_available');
  assert.equal(requests, 1);

  releaseVerification();
  assert.deepEqual(await suspendedOwner, { status: 'silent', reason: 'cache-unavailable' });
  assert.equal(requests, 1);
});

test('an expired active owner cannot start a network request', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const pendingOne = path.basename(operationPath(testFixture, 'pending', 1n));
  const claimOne = path.basename(operationPath(testFixture, 'claim', 1n));
  const pause = pauseReaddirSnapshotOnce(
    stateDirectory(testFixture),
    (entries) => entries.some((entry) => entry.name === 'active-claim')
      && entries.some((entry) => entry.name === pendingOne)
      && !entries.some((entry) => entry.name === claimOne),
  );
  t.after(() => pause.restore());
  let requests = 0;

  const check = checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));
  await pause.reached;
  const staleTime = new Date(Date.now() - 60_000);
  fs.utimesSync(
    path.join(operationPath(testFixture, 'pending', 1n), 'owner.json'),
    staleTime,
    staleTime,
  );
  pause.release();

  assert.deepEqual(await check, { status: 'silent', reason: 'check-in-progress' });
  pause.restore();
  assert.equal(requests, 0);
});

test('a fenced owner rechecks its active claim immediately before network access', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const pendingOne = path.basename(operationPath(testFixture, 'pending', 1n));
  const claimOne = path.basename(operationPath(testFixture, 'claim', 1n));
  const pause = pauseReaddirSnapshotOnce(
    stateDirectory(testFixture),
    (entries) => entries.some((entry) => entry.name === 'active-claim')
      && entries.some((entry) => entry.name === pendingOne)
      && !entries.some((entry) => entry.name === claimOne),
  );
  t.after(() => pause.restore());
  let requests = 0;
  let releaseFetch;
  let markFetchStarted;
  const fetchStarted = new Promise((resolve) => { markFetchStarted = resolve; });
  const fetchImpl = async () => {
    requests += 1;
    markFetchStarted();
    return new Promise((resolve) => { releaseFetch = resolve; });
  };

  const delayedOwner = checkForUpdate(options(testFixture, fetchImpl, { timeoutMs: 2_000 }));
  await pause.reached;
  const staleTime = new Date(Date.now() - 60_000);
  fs.utimesSync(
    path.join(operationPath(testFixture, 'pending', 1n), 'owner.json'),
    staleTime,
    staleTime,
  );
  const successor = checkForUpdate(options(testFixture, fetchImpl, { timeoutMs: 2_000 }));
  await fetchStarted;
  assert.equal(requests, 1);

  pause.release();
  assert.deepEqual(await delayedOwner, { status: 'silent', reason: 'check-in-progress' });
  pause.restore();
  assert.equal(requests, 1);

  releaseFetch(response(remoteRelease()));
  assert.equal((await successor).status, 'update_available');
  assert.equal(requests, 1);
});

test('an overlapping check reads the last-good candidate while another process refreshes it', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  let requests = 0;
  let releaseRefresh;
  let markRefreshStarted;
  const refreshStarted = new Promise((resolve) => { markRefreshStarted = resolve; });
  const fetchImpl = async () => {
    requests += 1;
    if (requests === 1) return response(remoteRelease());
    markRefreshStarted();
    return new Promise((resolve) => { releaseRefresh = resolve; });
  };

  const first = await checkForUpdate(options(testFixture, fetchImpl));
  const refreshOptions = options(testFixture, fetchImpl, {
    now: () => baseTime + (73 * 60 * 60 * 1_000),
  });
  const refresh = checkForUpdate(refreshOptions);
  await refreshStarted;

  const overlapping = await checkForUpdate(refreshOptions);
  assert.equal(overlapping.status, 'update_available');
  assert.equal(overlapping.eventKey, first.eventKey);
  assert.equal(requests, 2);

  releaseRefresh(response(remoteRelease()));
  assert.equal((await refresh).status, 'update_available');
});

test('a snooze waits briefly for an in-flight refresh instead of losing the choice', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const offered = await checkForUpdate(options(
    testFixture,
    async () => response(remoteRelease()),
  ));
  let releaseRefresh;
  let markRefreshStarted;
  const refreshStarted = new Promise((resolve) => { markRefreshStarted = resolve; });
  const refresh = checkForUpdate(options(testFixture, async () => {
    markRefreshStarted();
    return new Promise((resolve) => { releaseRefresh = resolve; });
  }, {
    now: () => baseTime + (73 * 60 * 60 * 1_000),
  }));
  await refreshStarted;

  const snoozeTime = baseTime + (73 * 60 * 60 * 1_000) + 1;
  const preference = snooze(testFixture, offered.eventKey, snoozeTime);
  await new Promise((resolve) => setTimeout(resolve, 25));
  releaseRefresh(response(remoteRelease()));
  await refresh;

  assert.deepEqual(await preference, snoozed(offered.eventKey, snoozeTime));
  const later = await checkForUpdate(options(testFixture, async () => response(remoteRelease()), {
    now: () => baseTime + (74 * 60 * 60 * 1_000),
  }));
  assert.equal(later.noticeRequired, false);
  assert.equal(later.reason, 'snoozed');
});

test('a snooze for a superseded release never suppresses the newer candidate', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const firstRelease = remoteReleaseForVersion('2.16.0', 'b'.repeat(64));
  const secondRelease = remoteReleaseForVersion('2.17.0', 'c'.repeat(64));
  const offered = await checkForUpdate(options(
    testFixture,
    async () => response(firstRelease),
  ));
  let releaseRefresh;
  let markRefreshStarted;
  const refreshStarted = new Promise((resolve) => { markRefreshStarted = resolve; });
  const refresh = checkForUpdate(options(testFixture, async () => {
    markRefreshStarted();
    return new Promise((resolve) => { releaseRefresh = resolve; });
  }, {
    now: () => baseTime + (73 * 60 * 60 * 1_000),
  }));
  await refreshStarted;

  const visibleDuringRefresh = await checkForUpdate(options(testFixture, async () => {
    assert.fail('an overlapping reader must not start another network request');
  }, {
    now: () => baseTime + (73 * 60 * 60 * 1_000),
  }));
  assert.equal(visibleDuringRefresh.eventKey, offered.eventKey);
  const preference = snooze(testFixture, visibleDuringRefresh.eventKey);
  await new Promise((resolve) => setTimeout(resolve, 25));
  releaseRefresh(response(secondRelease));
  const newer = await refresh;
  assert.equal(newer.latestVersion, '2.17.0');
  assert.deepEqual(await preference, { status: 'silent', reason: 'invalid-preference' });
  const repeated = await checkForUpdate(options(testFixture, async () => {
    assert.fail('a fresh cache must not start another network request');
  }));
  assert.equal(repeated.eventKey, newer.eventKey);
  assert.equal(repeated.noticeRequired, true);
});

test('preference retry budget uses a monotonic clock', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const offered = await checkForUpdate(options(
    testFixture,
    async () => response(remoteRelease()),
  ));
  writePendingOperation(testFixture, { generation: 2n });
  const ticks = [100, 1_301];
  const started = Date.now();

  assert.deepEqual(await setUpdatePreference({
    releasePath: testFixture.releasePath,
    cacheDirectory: testFixture.cacheDirectory,
    eventKey: offered.eventKey,
    mode: 'snooze',
    monotonicNow: () => ticks.shift() ?? 1_301,
  }), { status: 'silent', reason: 'check-in-progress' });
  assert.ok(Date.now() - started < 200, 'an exhausted monotonic budget should not sleep on wall time');
});

test('a delayed allocator cannot reuse a generation after its reservation name was taken', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const firstRelease = remoteReleaseForVersion('2.16.0', 'b'.repeat(64));
  const secondRelease = remoteReleaseForVersion('2.17.0', 'c'.repeat(64));
  const offered = await checkForUpdate(options(
    testFixture,
    async () => response(firstRelease),
  ));
  const pause = pauseMkdirOnce(operationPath(testFixture, 'reserved', 2n));
  t.after(() => pause.restore());

  const preference = snooze(testFixture, offered.eventKey);
  await pause.reached;
  assert.equal((await checkForUpdate(options(testFixture, async () => response(secondRelease), {
    now: () => baseTime + (73 * 60 * 60 * 1_000),
  }))).latestVersion, '2.17.0');

  pause.release();
  assert.deepEqual(await preference, { status: 'silent', reason: 'invalid-preference' });
  pause.restore();
  assert.equal(fs.existsSync(operationPath(testFixture, 'reserved', 2n)), true);
  assert.equal(fs.existsSync(operationPath(testFixture, 'reserved', 3n)), true);
});

test('an oversized generation name cannot poison future allocation', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  fs.mkdirSync(stateDirectory(testFixture), { recursive: true });
  fs.mkdirSync(path.join(stateDirectory(testFixture), `reserved-${'9'.repeat(246)}`));
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return response(remoteRelease());
  };

  assert.equal((await checkForUpdate(options(testFixture, fetchImpl))).status, 'update_available');
  assert.equal((await checkForUpdate(options(testFixture, fetchImpl))).status, 'update_available');
  assert.equal(requests, 1);
  assert.ok(fs.existsSync(operationPath(testFixture, 'reserved', 1n)));
});

test('a lower generation stalled after reservation cannot commit behind a newer generation', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const firstRelease = remoteReleaseForVersion('2.16.0', 'b'.repeat(64));
  const secondRelease = remoteReleaseForVersion('2.17.0', 'c'.repeat(64));
  const offered = await checkForUpdate(options(
    testFixture,
    async () => response(firstRelease),
  ));
  const pause = pauseMkdirOnce(operationPath(testFixture, 'pending', 2n));
  t.after(() => pause.restore());

  const preference = snooze(testFixture, offered.eventKey);
  await pause.reached;
  assert.equal(fs.existsSync(operationPath(testFixture, 'reserved', 2n)), true);
  assert.equal((await checkForUpdate(options(testFixture, async () => response(secondRelease), {
    now: () => baseTime + (73 * 60 * 60 * 1_000),
  }))).latestVersion, '2.17.0');

  pause.release();
  assert.deepEqual(await preference, { status: 'silent', reason: 'invalid-preference' });
  pause.restore();
  assert.equal(fs.existsSync(operationPath(testFixture, 'committed', 2n)), false);
  assert.equal(fs.existsSync(operationPath(testFixture, 'cancelled', 2n)), true);
  assert.equal(fs.existsSync(operationPath(testFixture, 'reserved', 3n)), true);
  assert.equal(fs.existsSync(operationPath(testFixture, 'reserved', 4n)), true);
});

test('a snooze fences an expired refresh and the resumed owner cannot erase it', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const offered = await checkForUpdate(options(
    testFixture,
    async () => response(remoteRelease()),
  ));

  let resumeRefresh;
  let markRefreshStarted;
  const refreshStarted = new Promise((resolve) => { markRefreshStarted = resolve; });
  const refresh = checkForUpdate(options(testFixture, async () => {
    markRefreshStarted();
    return new Promise((resolve) => { resumeRefresh = resolve; });
  }, {
    now: () => baseTime + (73 * 60 * 60 * 1_000),
    timeoutMs: 2_000,
  }));
  await refreshStarted;

  const refreshPending = operationPath(testFixture, 'pending', 2n);
  const staleTime = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(refreshPending, 'owner.json'), staleTime, staleTime);
  const snoozeTime = baseTime + (73 * 60 * 60 * 1_000) + 1;
  assert.deepEqual(await snooze(testFixture, offered.eventKey, snoozeTime),
    snoozed(offered.eventKey, snoozeTime));

  resumeRefresh(response(remoteRelease()));
  assert.equal((await refresh).reason, 'snoozed');
  const later = await checkForUpdate(options(testFixture, async () => response(remoteRelease()), {
    now: () => baseTime + (74 * 60 * 60 * 1_000),
  }));
  assert.equal(later.noticeRequired, false);
  assert.equal(later.reason, 'snoozed');
});

for (const pausePoint of ['pending owner creation', 'state temp creation']) {
  test(`a snooze retries when fenced during ${pausePoint}`, async (t) => {
    const testFixture = fixture();
    t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
    const offered = await checkForUpdate(options(
      testFixture,
      async () => response(remoteRelease()),
    ));
    const pending = operationPath(testFixture, 'pending', 2n);
    const pause = pauseOpenOnce((target) => {
      if (pausePoint === 'pending owner creation') {
        return path.resolve(target) === path.join(pending, 'owner.json');
      }
      return path.dirname(path.resolve(target)) === pending
        && /^\.state\..+\.tmp$/.test(path.basename(target));
    });
    t.after(() => pause.restore());

    const preference = snooze(testFixture, offered.eventKey);
    await pause.reached;
    const staleTime = new Date(Date.now() - 60_000);
    fs.utimesSync(
      pausePoint === 'pending owner creation' ? pending : path.join(pending, 'owner.json'),
      staleTime,
      staleTime,
    );

    assert.equal((await checkForUpdate(options(
      testFixture,
      async () => response(remoteRelease()),
      { now: () => baseTime + (73 * 60 * 60 * 1_000) },
    ))).status, 'update_available');
    assert.equal(fs.existsSync(operationPath(testFixture, 'fenced', 2n)), true);

    pause.release();
    assert.deepEqual(await preference, snoozed(offered.eventKey));
    pause.restore();
  });
}

test('a stale corrupt operation is fenced without exposing a failure', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const staleTime = new Date(Date.now() - 60_000);
  const pending = writePendingOperation(testFixture, {
    owner: 'corrupt-owner',
    modifiedAt: staleTime,
  });

  const result = await checkForUpdate(options(
    testFixture,
    async () => response(remoteRelease()),
  ));

  assert.equal(result.status, 'update_available');
  assert.equal(fs.existsSync(pending), false);
  assert.equal(fs.existsSync(operationPath(testFixture, 'fenced', 1n)), true);
});

test('malformed active-claim shapes recover after the hard lease', async () => {
  for (const shape of ['file', 'symlink', 'owner-directory']) {
    const testFixture = fixture();
    try {
      const directory = stateDirectory(testFixture);
      const activeClaim = path.join(directory, 'active-claim');
      fs.mkdirSync(directory, { recursive: true });
      if (shape === 'file') {
        fs.writeFileSync(activeClaim, 'corrupt claim');
      } else if (shape === 'symlink') {
        fs.symlinkSync(path.join(testFixture.root, 'missing-claim-target'), activeClaim);
      } else {
        fs.mkdirSync(path.join(activeClaim, 'owner.json'), { recursive: true });
      }
      let requests = 0;
      const fetchImpl = async () => {
        requests += 1;
        return response(remoteRelease());
      };

      assert.deepEqual(await checkForUpdate(options(testFixture, fetchImpl)), {
        status: 'silent',
        reason: 'check-in-progress',
      }, `${shape} should retain a fresh hard lease`);
      assert.equal(requests, 0);

      const staleTime = new Date(Date.now() - 60_000);
      if (shape === 'symlink') fs.lutimesSync(activeClaim, staleTime, staleTime);
      else if (shape === 'owner-directory') {
        fs.utimesSync(path.join(activeClaim, 'owner.json'), staleTime, staleTime);
      } else fs.utimesSync(activeClaim, staleTime, staleTime);

      assert.equal((await checkForUpdate(options(testFixture, fetchImpl))).status, 'update_available');
      assert.equal(requests, 1, `${shape} should be retired after its hard lease`);
    } finally {
      fs.rmSync(testFixture.root, { recursive: true, force: true });
    }
  }
});

test('a delayed corrupt-claim retirement cannot move a successor active claim', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const directory = stateDirectory(testFixture);
  const activeClaim = path.join(directory, 'active-claim');
  fs.mkdirSync(activeClaim, { recursive: true });
  const staleTime = new Date(Date.now() - 60_000);
  fs.utimesSync(activeClaim, staleTime, staleTime);
  let firstRetirement = null;
  const pause = pauseRenameMatchingOnce((source, destination) => {
    if (path.resolve(source) !== activeClaim
      || !path.basename(path.dirname(destination)).startsWith('retired-claim-corrupt-')) {
      return false;
    }
    firstRetirement = destination;
    return true;
  });
  t.after(() => pause.restore());

  const delayed = checkForUpdate(options(
    testFixture,
    async () => response(remoteRelease()),
  ));
  await pause.reached;
  fs.utimesSync(activeClaim, staleTime, staleTime);
  fs.utimesSync(
    path.join(operationPath(testFixture, 'pending', 1n), 'owner.json'),
    staleTime,
    staleTime,
  );

  assert.equal((await checkForUpdate(options(
    testFixture,
    async () => response(remoteRelease()),
  ))).status, 'update_available');
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(activeClaim, 'owner.json'), 'utf8')).generation,
    '2',
  );

  pause.release();
  assert.equal((await delayed).status, 'update_available');
  pause.restore();
  assert.equal(firstRetirement !== null, true);
  assert.equal(fs.existsSync(activeClaim), true);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(activeClaim, 'owner.json'), 'utf8')).generation,
    '2',
  );
});

test('repeated corrupt claim contents receive distinct retirement identities', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const directory = stateDirectory(testFixture);
  const activeClaim = path.join(directory, 'active-claim');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(activeClaim, 'same corrupt claim');
  const staleTime = new Date(Date.now() - 60_000);
  fs.utimesSync(activeClaim, staleTime, staleTime);
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return response(remoteRelease());
  };

  assert.equal((await checkForUpdate(options(testFixture, fetchImpl))).status, 'update_available');
  fs.renameSync(activeClaim, path.join(directory, 'test-completed-active-claim'));
  fs.writeFileSync(activeClaim, 'same corrupt claim');
  fs.utimesSync(activeClaim, staleTime, staleTime);
  assert.equal((await checkForUpdate(options(testFixture, fetchImpl, {
    now: () => baseTime + (73 * 60 * 60 * 1_000),
  }))).status, 'update_available');

  assert.equal(requests, 2);
  assert.equal(
    fs.readdirSync(directory).filter((name) => name.startsWith('retired-claim-corrupt-')).length,
    2,
  );
});

test('corrupt claim retirement preserves distinct 64-bit inode identities', async (t) => {
  const testFixture = fixture();
  const originalLstat = fsPromises.lstat;
  t.after(() => {
    fsPromises.lstat = originalLstat;
    fs.rmSync(testFixture.root, { recursive: true, force: true });
  });
  const directory = stateDirectory(testFixture);
  const activeClaim = path.join(directory, 'active-claim');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(activeClaim, 'corrupt claim');
  const staleTime = new Date(Date.now() - 60_000);
  fs.utimesSync(activeClaim, staleTime, staleTime);
  let instance = 1n;
  fsPromises.lstat = async (target, ...args) => {
    const metadata = await originalLstat(target, ...args);
    const resolved = path.resolve(target);
    const isCorruptClaimInstance = resolved === path.resolve(activeClaim)
      || (path.basename(resolved) === 'active'
        && path.basename(path.dirname(resolved)).startsWith('retired-claim-corrupt-'));
    if (!isCorruptClaimInstance || !metadata.isFile()) return metadata;
    const inode = 9_007_199_254_740_992n + (instance - 1n);
    return args[0]?.bigint
      ? metadataWithOverrides(metadata, {
        ino: inode,
        birthtimeNs: 1_000n,
        ctimeNs: 2_000n,
      })
      : metadataWithOverrides(metadata, {
        ino: Number(inode),
        birthtimeMs: 1,
        ctimeMs: 2,
      });
  };
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return response(remoteRelease());
  };

  assert.equal((await checkForUpdate(options(testFixture, fetchImpl))).status, 'update_available');
  fs.renameSync(activeClaim, path.join(directory, 'test-completed-active-claim'));
  fs.writeFileSync(activeClaim, 'corrupt claim');
  fs.utimesSync(activeClaim, staleTime, staleTime);
  instance = 2n;
  assert.equal((await checkForUpdate(options(testFixture, fetchImpl, {
    now: () => baseTime + (73 * 60 * 60 * 1_000),
  }))).status, 'update_available');

  assert.equal(requests, 2);
  assert.equal(
    fs.readdirSync(directory).filter((name) => name.startsWith('retired-claim-corrupt-')).length,
    2,
  );
});

test('a forged retirement symlink cannot move an active claim outside its cache partition', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return response(remoteRelease());
  };
  assert.equal((await checkForUpdate(options(testFixture, fetchImpl))).status, 'update_available');

  const outside = path.join(testFixture.root, 'outside');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(stateDirectory(testFixture), 'retired-claim-1'));
  const refreshOptions = options(testFixture, fetchImpl, {
    now: () => baseTime + (73 * 60 * 60 * 1_000),
  });
  assert.equal((await checkForUpdate(refreshOptions)).status, 'update_available');
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(requests, 1);

  fs.unlinkSync(path.join(stateDirectory(testFixture), 'retired-claim-1'));
  assert.equal((await checkForUpdate(refreshOptions)).status, 'update_available');
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(requests, 2);
});

test('an expired operation is fenced even when its PID was reused by a live process', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const staleTime = new Date(Date.now() - 60_000);
  const pending = writePendingOperation(testFixture, { modifiedAt: staleTime });
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.equal(result.status, 'update_available');
  assert.equal(requests, 1);
  assert.equal(fs.existsSync(pending), false);
  assert.equal(fs.existsSync(operationPath(testFixture, 'fenced', 1n)), true);
});

test('a corrupt future-dated operation cannot suppress checks indefinitely', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const futureTime = new Date(Date.now() + (365 * 24 * 60 * 60 * 1_000));
  const pending = writePendingOperation(testFixture, {
    owner: 'corrupt-owner',
    modifiedAt: futureTime,
  });

  const result = await checkForUpdate(options(
    testFixture,
    async () => response(remoteRelease()),
  ));

  assert.equal(result.status, 'update_available');
  assert.equal(fs.existsSync(pending), false);
  assert.equal(fs.existsSync(operationPath(testFixture, 'fenced', 1n)), true);
});

test('a newly-created operation with slight clock skew is never fenced as stale', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const nearFuture = new Date(Date.now() + 1_000);
  const pending = writePendingOperation(testFixture, {
    owner: 'writer-has-not-finished-the-record',
    modifiedAt: nearFuture,
  });
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.deepEqual(result, { status: 'silent', reason: 'check-in-progress' });
  assert.equal(requests, 0);
  assert.equal(fs.existsSync(pending), true);
});

test('a fenced stale owner cannot overwrite a newer committed candidate after resuming', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  let resumeOldOwner;
  let markOldStarted;
  const oldStarted = new Promise((resolve) => { markOldStarted = resolve; });
  const oldCheck = checkForUpdate(options(testFixture, async () => {
    markOldStarted();
    return new Promise((resolve) => { resumeOldOwner = resolve; });
  }, { timeoutMs: 2_000 }));
  await oldStarted;

  const oldPending = operationPath(testFixture, 'pending', 1n);
  const staleTime = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(oldPending, 'owner.json'), staleTime, staleTime);

  const newer = await checkForUpdate(options(
    testFixture,
    async () => response(remoteReleaseForVersion('3.0.0', 'c'.repeat(64))),
  ));
  assert.equal(newer.status, 'update_available');
  assert.equal(newer.latestVersion, '3.0.0');

  resumeOldOwner(response(remoteReleaseForVersion('2.16.0', 'b'.repeat(64))));
  assert.equal((await oldCheck).latestVersion, '3.0.0');
  const persisted = JSON.parse(fs.readFileSync(statePath(testFixture), 'utf8'));
  assert.equal(persisted.candidate.version, '3.0.0');
  assert.equal(fs.existsSync(operationPath(testFixture, 'fenced', 1n)), true);
});

test('different installed versions share no preference or cache-reset state', async (t) => {
  const testFixture = fixture('2.15.0');
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const olderReleasePath = path.join(testFixture.root, 'older-skill-release.json');
  writeJson(olderReleasePath, localRelease('2.14.0'));
  let requests = 0;
  const fetchImpl = async () => {
    requests += 1;
    return response(remoteRelease());
  };

  const newerInstall = await checkForUpdate(options(testFixture, fetchImpl));
  assert.equal(newerInstall.status, 'update_available');
  assert.deepEqual(await snooze(testFixture, newerInstall.eventKey, baseTime + 1_000),
    snoozed(newerInstall.eventKey, baseTime + 1_000));

  const olderInstallOptions = options(testFixture, fetchImpl, { releasePath: olderReleasePath });
  const olderInstall = await checkForUpdate(olderInstallOptions);
  assert.equal(olderInstall.status, 'update_available');
  assert.equal(olderInstall.installedVersion, '2.14.0');

  assert.equal((await checkForUpdate(options(testFixture, fetchImpl))).reason, 'snoozed');
  const olderAgain = await checkForUpdate(olderInstallOptions);
  assert.equal(olderAgain.status, 'update_available');
  assert.equal(requests, 2, 'each installed version should retain its own fresh cache');
  assert.equal(fs.existsSync(statePath(testFixture, '2.15.0')), true);
  assert.equal(fs.existsSync(statePath(testFixture, '2.14.0')), true);
});

test('an identity mismatch is rejected silently and never cached as a candidate', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));

  const result = await checkForUpdate(options(
    testFixture,
    async () => response(remoteRelease({ skillId: 'different-skill' })),
  ));

  assert.deepEqual(result, { status: 'silent', reason: 'invalid-manifest' });
  const state = JSON.parse(fs.readFileSync(statePath(testFixture), 'utf8'));
  assert.equal(Object.hasOwn(state, 'candidate'), false);
});

test('release notes must byte-match the exact trusted GitHub URL', async () => {
  const base = 'https://github.com/tt-a1i/archify/releases/tag/v2.16.0';
  for (const releaseNotes of [
    'https://github.com:443/tt-a1i/archify/releases/tag/v2.16.0',
    'https://github.com:444/tt-a1i/archify/releases/tag/v2.16.0',
    `${base}?`,
    `${base}#`,
    `${base}?source=manifest`,
    'https://GITHUB.COM/tt-a1i/archify/releases/tag/v2.16.0',
  ]) {
    const testFixture = fixture();
    try {
      const result = await checkForUpdate(options(
        testFixture,
        async () => response(remoteRelease({ releaseNotes })),
      ));
      assert.deepEqual(result, { status: 'silent', reason: 'invalid-manifest' }, releaseNotes);
    } finally {
      fs.rmSync(testFixture.root, { recursive: true, force: true });
    }
  }
});

test('malformed release notes are classified as an invalid manifest', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));

  const result = await checkForUpdate(options(
    testFixture,
    async () => response(remoteRelease({ releaseNotes: 'not-a-url' })),
  ));

  assert.deepEqual(result, { status: 'silent', reason: 'invalid-manifest' });
});

test('publishedAt must use canonical UTC seconds and a real calendar date', async () => {
  for (const publishedAt of [
    '2026-08-28T15:00:00+08:00',
    '2026-08-28',
    '2026-02-30T00:00:00Z',
  ]) {
    const testFixture = fixture();
    try {
      const result = await checkForUpdate(options(
        testFixture,
        async () => response(remoteRelease({ publishedAt })),
      ));
      assert.deepEqual(result, { status: 'silent', reason: 'invalid-manifest' }, publishedAt);
    } finally {
      fs.rmSync(testFixture.root, { recursive: true, force: true });
    }
  }
});

test('stable candidates cannot use prerelease or build metadata', async () => {
  for (const version of ['2.16.0-dev.1', '2.16.0+build.1']) {
    const testFixture = fixture();
    try {
      const result = await checkForUpdate(options(
        testFixture,
        async () => response(remoteReleaseForVersion(version)),
      ));
      assert.deepEqual(result, { status: 'silent', reason: 'invalid-manifest' }, version);
    } finally {
      fs.rmSync(testFixture.root, { recursive: true, force: true });
    }
  }
});

test('an invalid local identity fails before any network disclosure', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  writeJson(testFixture.releasePath, {
    ...localRelease(),
    source: { repository: 'https://example.com/untrusted/archify' },
  });
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.deepEqual(result, { status: 'silent', reason: 'invalid-local-release' });
  assert.equal(requests, 0);
});

test('a bounded timeout fails silently without retrying', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  let requests = 0;
  const fetchImpl = (_url, init) => new Promise((_resolve, reject) => {
    requests += 1;
    init.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });

  const result = await checkForUpdate(options(testFixture, fetchImpl, { timeoutMs: 10 }));
  assert.deepEqual(result, { status: 'silent', reason: 'check-failed' });
  assert.equal(requests, 1);
});

test('non-success responses cancel their unread body before failing silently', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  let cancelled = false;

  const result = await checkForUpdate(options(testFixture, async () => ({
    status: 503,
    headers: new Headers(),
    body: {
      async cancel() {
        cancelled = true;
      },
    },
  })));

  assert.deepEqual(result, { status: 'silent', reason: 'check-failed' });
  assert.equal(cancelled, true);
});

test('media-type and declared-size rejection cancel unread response bodies', async () => {
  for (const headers of [
    { 'content-type': 'text/html' },
    { 'content-type': 'application/json', 'content-length': String((32 * 1024) + 1) },
  ]) {
    const testFixture = fixture();
    let cancelled = false;
    try {
      const result = await checkForUpdate(options(testFixture, async () => ({
        status: 200,
        headers: new Headers(headers),
        body: {
          async cancel() {
            cancelled = true;
          },
        },
      })));
      assert.deepEqual(result, { status: 'silent', reason: 'invalid-manifest' });
      assert.equal(cancelled, true);
    } finally {
      fs.rmSync(testFixture.root, { recursive: true, force: true });
    }
  }
});

test('response stream failures are classified as network failures', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));

  const result = await checkForUpdate(options(testFixture, async () => ({
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    body: {
      getReader() {
        return {
          async read() {
            throw new TypeError('socket closed while reading');
          },
          releaseLock() {},
        };
      },
    },
  })));

  assert.deepEqual(result, { status: 'silent', reason: 'check-failed' });
});

test('invalid UTF-8 is classified as an invalid manifest rather than a network failure', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const result = await checkForUpdate(options(
    testFixture,
    async () => new Response(new Uint8Array([0xff]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ));
  assert.deepEqual(result, { status: 'silent', reason: 'invalid-manifest' });
});

test('chunked responses above 32 KiB are rejected instead of fully trusted', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const oversized = `${JSON.stringify(remoteRelease())}${' '.repeat(33 * 1024)}`;

  const result = await checkForUpdate(options(
    testFixture,
    async () => response(oversized),
  ));

  assert.deepEqual(result, { status: 'silent', reason: 'invalid-manifest' });
});

test('a poisoned far-future cache timestamp cannot suppress checks indefinitely', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  await checkForUpdate(options(testFixture, async () => response(remoteRelease())));
  const cacheStatePath = statePath(testFixture);
  const state = JSON.parse(fs.readFileSync(cacheStatePath, 'utf8'));
  state.check.nextCheckAt = '9999-12-31T23:59:59.000Z';
  writeJson(cacheStatePath, state);
  let requests = 0;

  const result = await checkForUpdate(options(testFixture, async () => {
    requests += 1;
    return response(remoteRelease());
  }));

  assert.equal(result.status, 'update_available');
  assert.equal(requests, 1);
});

test('a semantically corrupt cached candidate discards legacy validators and rebuilds unconditionally', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  await checkForUpdate(options(testFixture, async () => response(remoteRelease())));
  const cacheStatePath = statePath(testFixture);
  const state = JSON.parse(fs.readFileSync(cacheStatePath, 'utf8'));
  state.candidate.targetDigest = 'sha256:corrupt';
  state.check.etag = '"legacy-tracker"';
  state.check.nextCheckAt = '9999-12-31T23:59:59.000Z';
  writeJson(cacheStatePath, state);
  let conditionalHeader = 'not-observed';

  const result = await checkForUpdate(options(testFixture, async (_url, init) => {
    conditionalHeader = init.headers['if-none-match'];
    return response(remoteRelease());
  }));

  assert.equal(result.status, 'update_available');
  assert.equal(conditionalHeader, undefined);
  assert.equal(
    JSON.parse(fs.readFileSync(statePath(testFixture), 'utf8')).candidate.targetDigest,
    result.targetDigest,
  );
});

test('corrupt cache is rebuilt without exposing an error to the user', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  fs.mkdirSync(stateDirectory(testFixture), { recursive: true });
  fs.mkdirSync(path.dirname(statePath(testFixture)), { recursive: true });
  fs.writeFileSync(statePath(testFixture), '{not-json');

  const result = await checkForUpdate(options(
    testFixture,
    async () => response(remoteRelease({ version: '2.15.0' })),
  ));

  assert.deepEqual(result, { status: 'silent', reason: 'invalid-manifest' });
  assert.doesNotThrow(() => JSON.parse(
    fs.readFileSync(statePath(testFixture), 'utf8'),
  ));
});

test('disabled CLI returns one silent JSON line and never needs the network', () => {
  const result = spawnSync(process.execPath, [checkerPath], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { status: 'silent', reason: 'disabled' });
  assert.equal(result.stdout.trim().split('\n').length, 1);
});

test('legacy CLI acknowledgement is a harmless one-line no-op', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-update-cli-ack-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'home');
  const xdg = path.join(root, 'xdg-cache');
  const localData = path.join(root, 'local-data');
  for (const directory of [home, xdg, localData]) fs.mkdirSync(directory, { recursive: true });
  const cacheDirectory = process.platform === 'win32'
    ? path.join(localData, 'archify-skill')
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Caches', 'archify-skill')
      : path.join(xdg, 'archify-skill');
  const releasePath = path.join(skillRoot, 'skill-release.json');
  const installedRelease = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
  const [major, minor, patch] = parseSemver(installedRelease.version).core;
  const candidateVersion = `${major}.${minor}.${BigInt(patch) + 1n}`;
  const offered = await checkForUpdate({
    releasePath,
    cacheDirectory,
    fetchImpl: async () => response(remoteReleaseForVersion(candidateVersion)),
    now: () => baseTime,
    random: () => 0.5,
    timeoutMs: 50,
  });
  assert.equal(offered.status, 'update_available');

  const acknowledgement = spawnSync(process.execPath, [checkerPath, '--ack', offered.eventKey], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      XDG_CACHE_HOME: xdg,
      LOCALAPPDATA: localData,
    },
  });
  assert.equal(acknowledgement.status, 0, acknowledgement.stderr);
  assert.deepEqual(JSON.parse(acknowledgement.stdout), {
    status: 'silent', reason: 'legacy-ack-no-op',
  });
  assert.equal(acknowledgement.stdout.trim().split('\n').length, 1);
});

test('CLI entry detection survives a realpath or symlink alias', (t) => {
  const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-update-cli-alias-'));
  t.after(() => fs.rmSync(aliasRoot, { recursive: true, force: true }));
  const aliasPath = path.join(aliasRoot, 'check-update-alias.mjs');
  try {
    fs.symlinkSync(checkerPath, aliasPath);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
      t.skip(`symlinks unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  const result = spawnSync(process.execPath, [aliasPath], {
    cwd: aliasRoot,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { status: 'silent', reason: 'disabled' });
  assert.equal(isMainModule({ argvPath: aliasPath, modulePath: checkerPath }), true);
  assert.equal(isMainModule({
    argvPath: path.join(aliasRoot, 'missing-entry.mjs'),
    modulePath: checkerPath,
  }), false);
});

test('notifier source has no process execution or remote-origin override surface', () => {
  const checkerSource = fs.readFileSync(checkerPath, 'utf8');
  const contractSource = fs.readFileSync(contractPath, 'utf8');
  const combinedSource = `${checkerSource}\n${contractSource}`;
  assert.doesNotMatch(combinedSource, /(?:node:)?child_process/);
  assert.doesNotMatch(combinedSource, /(?:^|[^\w.])(?:spawn|exec|execFile|fork)(?:Sync)?\s*\(/m);
  assert.doesNotMatch(contractSource, /\bfetch\s*\(/);
  const environmentReads = [...combinedSource.matchAll(/process\.env\.([A-Z0-9_]+)/g)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(environmentReads, [
    'ARCHIFY_UPDATE_CHECK_DISABLED',
    'LOCALAPPDATA',
    'XDG_CACHE_HOME',
  ]);
  assert.doesNotMatch(combinedSource, /updateCommand/);
});

test('delivery preferences are explicit and scoped to the exact release digest', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const first = await checkForUpdate(options(testFixture,
    async () => response(remoteRelease())));
  const ignored = await setUpdatePreference({ ...testFixture,
    eventKey: first.eventKey, mode: 'ignore', now: () => baseTime });
  assert.equal(ignored.status, 'ignored');
  const suppressed = await checkForUpdate(options(testFixture,
    async () => { throw new Error('should use cache'); }));
  assert.equal(suppressed.noticeRequired, false);
  assert.equal(suppressed.reason, 'ignored');
  const newer = await checkForUpdate(options(testFixture,
    async () => response(remoteReleaseForVersion('2.17.0', 'c'.repeat(64))),
    { now: () => baseTime + 2 * 24 * 60 * 60 * 1_000 }));
  assert.equal(newer.status, 'update_available');
  assert.equal(newer.noticeRequired, true);
  const snoozed = await setUpdatePreference({ ...testFixture,
    eventKey: newer.eventKey, mode: 'snooze', now: () => baseTime + 2 * 24 * 60 * 60 * 1_000 });
  assert.equal(snoozed.status, 'snoozed');
  const during = await checkForUpdate(options(testFixture,
    async () => { throw new Error('should use cache'); }, {
      now: () => baseTime + 3 * 24 * 60 * 60 * 1_000 }));
  assert.equal(during.noticeRequired, false);
  assert.equal(during.reason, 'snoozed');
  const after = await checkForUpdate(options(testFixture,
    async () => { throw new Error('offline'); }, {
      now: () => baseTime + 10 * 24 * 60 * 60 * 1_000 }));
  assert.equal(after.noticeRequired, true);
  assert.equal(after.source, 'cache');
});

test('delivery check treats a withdrawn manifest differently from an invalid response', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  await checkForUpdate(options(testFixture,
    async () => response(remoteRelease())));
  const invalid = await checkForUpdate(options(testFixture,
    async () => response('invalid JSON'), {
      now: () => baseTime + 2 * 24 * 60 * 60 * 1_000 }));
  assert.equal(invalid.status, 'update_available');
  assert.equal(invalid.source, 'cache');
  const withdrawn = await checkForUpdate(options(testFixture,
    async () => response('{}', { status: 404 }), {
      now: () => baseTime + 3 * 24 * 60 * 60 * 1_000 }));
  assert.deepEqual(withdrawn, { status: 'silent', reason: 'withdrawn' });
  const cached = await checkForUpdate(options(testFixture,
    async () => { throw new Error('backoff'); }, {
      now: () => baseTime + 3 * 24 * 60 * 60 * 1_000 + 1_000 }));
  assert.notEqual(cached.status, 'update_available');
});

test('a validated network result survives a cache publication failure without inventing an upgrade', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  const originalRename = fsPromises.rename;
  fsPromises.rename = async (source, destination, ...args) => {
    if (destination.endsWith('state.json')) throw Object.assign(new Error('read-only state'), { code: 'EACCES' });
    return originalRename(source, destination, ...args);
  };
  try {
    const offered = await checkForUpdate(options(testFixture,
      async () => response(remoteRelease())));
    assert.equal(offered.status, 'update_available');
    assert.equal(offered.source, 'network');
    const currentFixture = fixture('2.16.0');
    t.after(() => fs.rmSync(currentFixture.root, { recursive: true, force: true }));
    const current = await checkForUpdate(options(currentFixture,
      async () => response(remoteRelease())));
    assert.equal(current.status, 'current');
    assert.equal(current.noticeRequired, false);
  } finally {
    fsPromises.rename = originalRename;
  }
});

test('an offline delivery still offers the last validated candidate when backoff cannot be written', async (t) => {
  const testFixture = fixture();
  t.after(() => fs.rmSync(testFixture.root, { recursive: true, force: true }));
  await checkForUpdate(options(testFixture,
    async () => response(remoteRelease())));
  const originalRename = fsPromises.rename;
  fsPromises.rename = async (source, destination, ...args) => {
    if (destination.endsWith('state.json')) throw Object.assign(new Error('read-only state'), { code: 'EACCES' });
    return originalRename(source, destination, ...args);
  };
  try {
    const result = await checkForUpdate(options(testFixture,
      async () => { throw new Error('offline'); }, {
        now: () => baseTime + 2 * 24 * 60 * 60 * 1_000 }));
    assert.equal(result.status, 'update_available');
    assert.equal(result.source, 'cache');
    assert.equal(result.noticeRequired, true);
  } finally {
    fsPromises.rename = originalRename;
  }
});
