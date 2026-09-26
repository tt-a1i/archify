import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runFinalize } from '../bin/finalize.mjs';
import { CAPTURE_VIEWPORTS, VISUAL_CHECK_VIEWPORTS } from '../bin/visual-check.mjs';

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-finalize-browser-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function identity(contents) {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
  };
}

function stageResult(receipt, status = 0) {
  return { status, stdout: JSON.stringify(receipt), stderr: '' };
}

function delivery({ input, output, source }) {
  const artifact = '<!doctype html><title>browser lifecycle</title>';
  fs.writeFileSync(output, artifact);
  const receipt = {
    schemaVersion: 1,
    receiptId: '11111111-1111-4111-8111-111111111111',
    ok: true,
    command: 'deliver',
    type: 'architecture',
    input,
    output,
    specification: identity(source),
    artifact: identity(artifact),
    validation: {
      checksPassed: 9,
      checkCount: 9,
      compositionProfile: 'showcase',
      compositionStatus: 'pass',
      errors: 0,
      warnings: 0,
    },
  };
  fs.writeFileSync(output.replace(/\.html?$/i, '.delivery.json'), `${JSON.stringify({
    schemaVersion: 1,
    receiptId: receipt.receiptId,
    status: 'current',
    command: 'deliver',
    type: receipt.type,
    input: receipt.input,
    output: receipt.output,
    specification: receipt.specification,
    artifact: receipt.artifact,
  })}\n`);
  return receipt;
}

function check(output, delivered) {
  return {
    schemaVersion: 1,
    ok: true,
    file: output,
    artifact: delivered.artifact,
    checks: Array.from({ length: 9 }, (_, index) => ({ name: `check-${index}`, ok: true })),
    provenance: 'current',
    deliveryReceiptId: delivered.receiptId,
    composition: {
      schemaVersion: 1,
      profile: 'showcase',
      status: 'pass',
      summary: { errors: 0, warnings: 0 },
    },
  };
}

function browserReceipt(output, delivered, outDir) {
  return {
    schemaVersion: 1,
    ok: true,
    command: 'browser-check',
    evidenceKind: 'automated-browser',
    status: 'pass',
    provenance: 'current',
    deliveryReceiptId: delivered.receiptId,
    artifact: { path: output, ...delivered.artifact },
    containment: {
      status: 'pass',
      viewports: VISUAL_CHECK_VIEWPORTS.map(({ width, height }) => ({ width, height, theme: 'light', ok: true })),
    },
    themeStates: {
      status: 'pass',
      viewports: [
        ...VISUAL_CHECK_VIEWPORTS.map((viewport) => ({ ...viewport, requestedTheme: 'light', resolvedTheme: 'light', ok: true })),
        ...CAPTURE_VIEWPORTS.map((viewport) => ({ ...viewport, requestedTheme: 'dark', resolvedTheme: 'dark', ok: true })),
      ],
    },
    readability: {
      status: 'pass',
      viewports: VISUAL_CHECK_VIEWPORTS.map(({ width, height }) => ({
        width, height, theme: 'light', ok: true, readabilityOk: true,
      })),
    },
    viewerChrome: {
      status: 'pass',
      viewports: VISUAL_CHECK_VIEWPORTS.map(({ width, height }) => ({
        width, height, theme: 'light', ok: true, viewerChromeOk: true,
      })),
    },
    sidecars: { directory: outDir, receipt: 'diagram.browser-check.json' },
  };
}

function browser(events, sessionPromise = Promise.resolve()) {
  return {
    sessionPromise,
    async inspect() { events.push('inspect'); },
    async close() { events.push('close'); },
  };
}

function inputs(t) {
  const directory = workspace(t);
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  const outDir = path.join(directory, 'evidence');
  const source = '{"meta":{"quality_profile":"showcase"}}';
  fs.writeFileSync(input, source);
  return { directory, input, output, outDir, source };
}

function options({ input, output, outDir, runCommand, runBrowserCheck, resolveChrome, createBrowser }) {
  return {
    cliPath: '/fake/archify.mjs',
    type: 'architecture',
    input,
    output,
    outDir,
    runCommand,
    runBrowserCheck,
    resolveChrome,
    createBrowser,
  };
}

test('finalize prestarts Chrome during deliver without inspecting it before the browser gate consumes it', async t => {
  const { input, output, outDir, source } = inputs(t);
  const events = [];
  let delivered;
  const finalized = await runFinalize(options({
    input, output, outDir,
    resolveChrome: () => '/fake/chrome',
    createBrowser: (chromePath, { env }) => {
      assert.equal(chromePath, '/fake/chrome');
      assert.ok(env);
      events.push('create');
      return browser(events);
    },
    runCommand: async ({ stage }) => {
      events.push(`run:${stage}`);
      assert.deepEqual(events.filter((event) => event === 'inspect'), []);
      if (stage === 'deliver') {
        assert.deepEqual(events, ['create', 'run:deliver']);
        await Promise.resolve();
        delivered = delivery({ input, output, source });
        return stageResult(delivered);
      }
      assert.deepEqual(events, ['create', 'run:deliver', 'run:check']);
      return stageResult(check(output, delivered));
    },
    runBrowserCheck: async ({ artifactPath, outDir: receivedOutDir, chromePath, resolveChrome, browserFactory }) => {
      assert.equal(artifactPath, output);
      assert.equal(receivedOutDir, outDir);
      assert.equal(chromePath, '/fake/chrome');
      assert.equal(resolveChrome(), '/fake/chrome');
      const reusable = browserFactory();
      await reusable.sessionPromise;
      await reusable.inspect();
      await reusable.close();
      return { exitCode: 0, receipt: browserReceipt(output, delivered, outDir) };
    },
  }));

  assert.equal(finalized.exitCode, 0);
  assert.equal(finalized.receipt.stages['browser-check'].execution, 'in-process');
  assert.deepEqual(events, ['create', 'run:deliver', 'run:check', 'inspect', 'close']);
});

test('finalize closes a prestarted browser without navigation when deliver or check fails', async t => {
  for (const failedStage of ['deliver', 'check']) {
    const { input, output, outDir, source } = inputs(t);
    const events = [];
    let delivered;
    const finalized = await runFinalize(options({
      input, output, outDir,
      resolveChrome: () => '/fake/chrome',
      createBrowser: () => { events.push('create'); return browser(events); },
      runBrowserCheck: () => { throw new Error('browser gate must not run'); },
      runCommand: ({ stage }) => {
        events.push(`run:${stage}`);
        if (stage === failedStage) return stageResult({ ok: false, command: stage, diagnostics: [] }, 1);
        delivered = delivery({ input, output, source });
        return stageResult(delivered);
      },
    }));
    assert.equal(finalized.exitCode, 1, failedStage);
    assert.equal(finalized.receipt.failedStage, failedStage === 'deliver' ? 'deliver' : 'check', failedStage);
    assert.equal(events.includes('inspect'), false, failedStage);
    assert.equal(events.filter((event) => event === 'close').length, 1, failedStage);
  }
});

test('a rejected Chrome attach does not replace a delivery failure or emit an unhandled rejection', async t => {
  const { input, output, outDir } = inputs(t);
  const events = [];
  const unhandled = [];
  const onUnhandled = (reason) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const finalized = await runFinalize(options({
      input, output, outDir,
      resolveChrome: () => '/fake/chrome',
      createBrowser: () => browser(events, Promise.reject(new Error('attach failed'))),
      runBrowserCheck: () => { throw new Error('browser gate must not run'); },
      runCommand: () => stageResult({ ok: false, command: 'deliver', diagnostics: [] }, 1),
    }));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(finalized.exitCode, 1);
    assert.equal(finalized.receipt.failedStage, 'deliver');
    assert.deepEqual(unhandled, []);
    assert.deepEqual(events, ['close']);
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

test('Chrome startup and discovery failures are reported by the browser gate', async t => {
  const scenarios = [
    {
      name: 'startup failure',
      resolveChrome: () => '/fake/chrome',
      createBrowser: () => { throw new Error('Chrome attach failed'); },
      exitCode: 1,
      expectedStatus: 'fail',
    },
    {
      name: 'Chrome unavailable',
      resolveChrome: () => null,
      createBrowser: () => { throw new Error('must not construct'); },
      exitCode: 2,
      expectedStatus: 'skipped',
    },
  ];
  for (const scenario of scenarios) {
    const { input, output, outDir, source } = inputs(t);
    let delivered;
    let created = false;
    const finalized = await runFinalize(options({
      input, output, outDir,
      resolveChrome: scenario.resolveChrome,
      createBrowser: (...args) => {
        created = true;
        return scenario.createBrowser(...args);
      },
      runCommand: ({ stage }) => {
        if (stage === 'deliver') {
          delivered = delivery({ input, output, source });
          return stageResult(delivered);
        }
        return stageResult(check(output, delivered));
      },
      runBrowserCheck: ({ browserFactory }) => {
        if (scenario.exitCode === 1) {
          assert.throws(browserFactory, /Chrome attach failed/);
          return { exitCode: 1, receipt: { ok: false, command: 'browser-check', diagnostics: [] } };
        }
        assert.throws(browserFactory, /unavailable/);
        return { exitCode: 2, receipt: { ok: false, command: 'browser-check', status: 'skipped' } };
      },
    }));
    assert.equal(finalized.exitCode, scenario.exitCode, scenario.name);
    assert.equal(finalized.receipt.stages['browser-check'].status, scenario.expectedStatus, scenario.name);
    assert.equal(finalized.receipt.failedStage, 'browser-check', scenario.name);
    assert.equal(created, scenario.exitCode === 1, scenario.name);
  }
});

test('finalize closes an unconsumed browser when the in-process browser callback throws', async t => {
  const { input, output, outDir, source } = inputs(t);
  const events = [];
  let delivered;
  await assert.rejects(() => runFinalize(options({
    input, output, outDir,
    resolveChrome: () => '/fake/chrome',
    createBrowser: () => browser(events),
    runCommand: ({ stage }) => {
      if (stage === 'deliver') {
        delivered = delivery({ input, output, source });
        return stageResult(delivered);
      }
      return stageResult(check(output, delivered));
    },
    runBrowserCheck: () => { throw new Error('browser callback failed before consume'); },
  })), /browser callback failed before consume/);
  assert.deepEqual(events, ['close']);
});
