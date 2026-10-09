import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { checkForUpdate } from '../archify/scripts/check-update.mjs';
import { startDeliveryUpdateCheck } from '../archify/bin/delivery-update.mjs';
import { runFinalize } from '../archify/bin/finalize.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const installed = '2.15.0';
const available = '2.16.0';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-delivery-update-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const releasePath = path.join(root, 'skill-release.json');
  const cacheDirectory = path.join(root, 'cache');
  fs.writeFileSync(releasePath, `${JSON.stringify({
    schemaVersion: 1, skillId: 'archify', channel: 'stable', version: installed,
    source: { repository: 'https://github.com/tt-a1i/archify' },
    updateManifestUrl: 'https://tt-a1i.github.io/archify/skill-updates/archify/stable.json',
  })}\n`);
  return { root, releasePath, cacheDirectory };
}

function manifest() {
  return {
    schemaVersion: 1, skillId: 'archify', channel: 'stable', version: available,
    publishedAt: '2026-08-28T07:00:00Z',
    source: { repository: 'https://github.com/tt-a1i/archify', ref: 'v2.16.0', treeSha: 'a'.repeat(40) },
    artifact: { sha256: 'b'.repeat(64) },
    summary: 'A release is available.',
    releaseNotes: 'https://github.com/tt-a1i/archify/releases/tag/v2.16.0',
    severity: 'normal',
  };
}

async function seed(testFixture) {
  return checkForUpdate({ ...testFixture,
    fetchImpl: async () => new Response(JSON.stringify(manifest()), {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
  });
}

function env(testFixture) {
  return { ...process.env,
    ARCHIFY_UPDATE_RELEASE_PATH: testFixture.releasePath,
    ARCHIFY_UPDATE_CACHE_DIRECTORY: testFixture.cacheDirectory,
  };
}

test('bounded service returns the same cached notice on repeated deliveries', async (t) => {
  const testFixture = fixture(t);
  assert.equal((await seed(testFixture)).status, 'update_available');
  for (let index = 0; index < 2; index += 1) {
    const started = performance.now();
    const result = await startDeliveryUpdateCheck({ env: env(testFixture) });
    assert.equal(result.status, 'update_available');
    assert.equal(result.source, 'cache');
    assert.equal(result.noticeRequired, true);
    assert.match(result.noticeText, /previous check/);
    assert.match(result.noticeText, /ask to snooze or ignore this reminder/);
    assert.ok(performance.now() - started < 1_200);
  }
});

test('service deadline kills a blocked child and leaves no later result', async (t) => {
  const testFixture = fixture(t);
  const root = testFixture.root;
  const blocker = path.join(root, 'blocker.mjs');
  fs.writeFileSync(blocker, 'setInterval(() => {}, 1000);\n');
  const result = await startDeliveryUpdateCheck({
    env: env(testFixture), checkerPath: blocker,
    deadlineMs: 80,
  });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'timeout');
  assert.deepEqual(fs.readdirSync(root).sort(), ['blocker.mjs', 'skill-release.json']);
});

test('a network timeout persists failure backoff for subsequent checks and deliveries', async (t) => {
  const testFixture = fixture(t);
  const calls = path.join(testFixture.root, 'fetch-calls');
  const fetchImpl = (_url, { signal }) => {
    fs.appendFileSync(calls, 'x');
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  // Exercise the real network abort and persistence without assuming that a
  // child can start, abort its request and publish under a 600ms CPU/I/O budget.
  // The separate blocked-child test retains the service's hard deadline.
  const first = await checkForUpdate({ ...testFixture, fetchImpl, timeoutMs: 25 });
  assert.equal(first.reason, 'check-failed');
  const second = await checkForUpdate({ ...testFixture, fetchImpl, timeoutMs: 25 });
  assert.equal(second.status, 'silent');
  assert.equal(second.reason, 'cache-valid');
  assert.equal(fs.readFileSync(calls, 'utf8'), 'x');
  const preload = path.join(testFixture.root, 'slow-fetch.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs';
globalThis.fetch = () => {
  fs.appendFileSync(${JSON.stringify(calls)}, 'x');
  throw new Error('a recorded failure must back off before another delivery fetch');
};
`);
  const slowEnv = { ...env(testFixture), NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` };
  const delivered = await startDeliveryUpdateCheck({ env: slowEnv });
  assert.equal(delivered.status, 'unavailable');
  assert.equal(delivered.reason, 'cache-valid');
  assert.equal(fs.readFileSync(calls, 'utf8'), 'x');
});

test('cache startup time is deducted before the update fetch timeout starts', async (t) => {
  const testFixture = fixture(t);
  const calls = path.join(testFixture.root, 'fetch-calls');
  const startup = path.join(testFixture.root, 'startup-delay');
  const preload = path.join(testFixture.root, 'delayed-cache.mjs');
  fs.writeFileSync(preload, `import fs from 'node:fs/promises';
import syncFs from 'node:fs';
const open = fs.open;
let delayed = false;
fs.open = async (...args) => {
  if (!delayed && String(args[0]) === ${JSON.stringify(testFixture.releasePath)}) {
    delayed = true;
    await new Promise(resolve => setTimeout(resolve, 300));
    syncFs.appendFileSync(${JSON.stringify(startup)}, 'delayed');
  }
  return open.apply(fs, args);
};
globalThis.fetch = (_url, { signal }) => {
  syncFs.appendFileSync(${JSON.stringify(calls)}, 'x');
  return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
};
`);
  const slowEnv = { ...env(testFixture), NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` };
  const first = await startDeliveryUpdateCheck({ env: slowEnv, deadlineMs: 800 });
  assert.equal(fs.readFileSync(startup, 'utf8'), 'delayed');
  assert.equal(first.reason, 'check-failed');
  const firstCalls = fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : '';
  assert.ok(firstCalls === '' || firstCalls === 'x', 'an expired budget may skip the fetch');
  let retryCalls = 0;
  const second = await checkForUpdate({ ...testFixture, fetchImpl: async () => { retryCalls += 1; throw new Error('unexpected retry'); } });
  assert.equal(second.status, 'silent');
  assert.equal(retryCalls, 0, 'the failed check must persist backoff');
});

test('a synchronous renderer delay does not turn a completed check into a timeout', async (t) => {
  const testFixture = fixture(t);
  await seed(testFixture);
  const pending = startDeliveryUpdateCheck({ env: env(testFixture), deadlineMs: 500 });
  spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 800)'], { timeout: 2_000 });
  const result = await pending;
  assert.equal(result.status, 'update_available');
  assert.equal(result.noticeRequired, true);
});

test('a killed checker holding the cache claim can be followed by a new check', async (t) => {
  const testFixture = fixture(t);
  const blockedChecker = path.join(testFixture.root, 'blocked-checker.mjs');
  fs.writeFileSync(blockedChecker, `
    import { checkForUpdate } from ${JSON.stringify(new URL('../archify/scripts/check-update.mjs', import.meta.url).href)};
    await checkForUpdate({
      releasePath: ${JSON.stringify(testFixture.releasePath)},
      cacheDirectory: ${JSON.stringify(testFixture.cacheDirectory)},
      fetchImpl: async () => {
        process.stdout.write('entered fetch\\n');
        return new Promise(() => {});
      },
    });
  `);
  const killed = await startDeliveryUpdateCheck({
    env: env(testFixture), checkerPath: blockedChecker, deadlineMs: 250,
  });
  assert.equal(killed.reason, 'timeout');
  const fresh = await seed(testFixture);
  assert.equal(fresh.status, 'update_available');
  assert.equal(fresh.source, 'network');
});

test('standalone deliver and finalize receipts include one update without changing diagram identity', async (t) => {
  const testFixture = fixture(t);
  assert.equal((await seed(testFixture)).status, 'update_available');
  const input = path.join(skillRoot, 'examples', 'web-app.architecture.json');
  const output = path.join(testFixture.root, 'diagram.html');
  const environment = { ...env(testFixture), ARCHIFY_CHROME: path.join(testFixture.root, 'missing-chrome') };
  const deliver = spawnSync(process.execPath,
    [cli, 'deliver', 'architecture', input, output, '--quality', 'showcase', '--json'],
    { cwd: skillRoot, encoding: 'utf8', env: environment, timeout: 15_000 });
  assert.equal(deliver.status, 0, deliver.stdout || deliver.stderr);
  const deliveryReceipt = JSON.parse(deliver.stdout);
  assert.equal(deliveryReceipt.update.noticeRequired, true);
  const artifactHash = deliveryReceipt.artifact.sha256;
  const disabled = spawnSync(process.execPath,
    [cli, 'deliver', 'architecture', input, output, '--quality', 'showcase', '--json'],
    { cwd: skillRoot, encoding: 'utf8', env: { ...environment, ARCHIFY_UPDATE_CHECK_DISABLED: '1' }, timeout: 15_000 });
  assert.equal(disabled.status, 0, disabled.stdout || disabled.stderr);
  const disabledReceipt = JSON.parse(disabled.stdout);
  assert.equal(disabledReceipt.update.reason, 'disabled');
  assert.equal(disabledReceipt.artifact.sha256, artifactHash);
  const finalize = spawnSync(process.execPath,
    [cli, 'finalize', 'architecture', input, output, '--quality', 'showcase', '--json'],
    { cwd: skillRoot, encoding: 'utf8', env: environment, timeout: 30_000 });
  assert.equal(finalize.status, 2, finalize.stdout || finalize.stderr);
  const compact = JSON.parse(finalize.stdout);
  const full = JSON.parse(fs.readFileSync(compact.evidence.receipt, 'utf8'));
  assert.equal(compact.update.noticeRequired, true);
  assert.deepEqual(compact.update, full.update);
  assert.equal(full.artifact.sha256, artifactHash);
  assert.equal(full.stages.deliver.receipt.update.reason, 'disabled');
  const readableDeliver = spawnSync(process.execPath,
    [cli, 'deliver', 'architecture', input, output, '--quality', 'showcase'],
    { cwd: skillRoot, encoding: 'utf8', env: environment, timeout: 15_000 });
  assert.equal(readableDeliver.status, 0, readableDeliver.stdout || readableDeliver.stderr);
  assert.match(readableDeliver.stdout, /Archify update:.*2\.15\.0.*2\.16\.0/);
  const readableFinalize = spawnSync(process.execPath,
    [cli, 'finalize', 'architecture', input, output, '--quality', 'showcase'],
    { cwd: skillRoot, encoding: 'utf8', env: environment, timeout: 30_000 });
  assert.equal(readableFinalize.status, 2, readableFinalize.stdout || readableFinalize.stderr);
  assert.match(readableFinalize.stdout, /Archify update:.*2\.15\.0.*2\.16\.0/);
});

test('a failed finalize gate preserves update in full and compact receipts', async (t) => {
  const testFixture = fixture(t);
  const input = path.join(skillRoot, 'examples', 'web-app.architecture.json');
  const output = path.join(testFixture.root, 'failed.html');
  const update = { status: 'update_available', installedVersion: installed,
    availableVersion: available, releaseNotes: manifest().releaseNotes,
    checkedAt: null, source: 'cache', noticeRequired: true,
    noticeText: 'A cached update is available.' };
  const result = await runFinalize({ cliPath: cli, type: 'architecture', input, output,
    startUpdateCheck: async () => update,
    runCommand: async () => ({ status: 1, stdout: JSON.stringify({
      ok: false, command: 'deliver', stage: 'render', diagnostics: [],
    }) }),
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.receipt.update, update);
  assert.deepEqual(result.summary.update, update);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.summary.evidence.receipt)).update, update);
});

test('a standalone delivery quality failure retains a known update', async (t) => {
  const testFixture = fixture(t);
  await seed(testFixture);
  const input = path.join(testFixture.root, 'invalid.json');
  const document = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'web-app.architecture.json')));
  document.components[0].type = 'unknown-component-type';
  fs.writeFileSync(input, `${JSON.stringify(document)}\n`);
  const output = path.join(testFixture.root, 'invalid.html');
  const delivery = spawnSync(process.execPath,
    [cli, 'deliver', 'architecture', input, output, '--quality', 'showcase', '--json'],
    { cwd: skillRoot, encoding: 'utf8', env: env(testFixture), timeout: 15_000 });
  assert.equal(delivery.status, 1, delivery.stdout || delivery.stderr);
  const receipt = JSON.parse(delivery.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.update.noticeRequired, true);
  assert.ok(receipt.diagnostics.length > 0);
});
