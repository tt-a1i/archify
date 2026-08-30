import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import {
  auditVisualCheckBatch,
  ChromeVisualBrowser,
  VISUAL_CHECK_VIEWPORTS,
  VISUAL_PREFLIGHT_VIEWPORTS,
  VisualCheckSession,
  chromeVisualBrowserArgs,
  preflightSidecarPaths,
  probeVisualCheckCapability,
  runVisualCheck,
  runVisualPreflight,
  sidecarPaths,
} from '../bin/visual-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const archifyCli = path.join(skillRoot, 'bin', 'archify.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-check-'));
function pngHeader(width, height) {
  const buffer = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  name.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.byteLength);
  return chunk;
}

const pngCache = new Map();
function pngBuffer(width, height) {
  const key = `${width}x${height}`;
  if (pngCache.has(key)) return pngCache.get(key);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 0;
  const image = Buffer.alloc((width + 1) * height);
  const value = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(image)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  pngCache.set(key, value);
  return value;
}

const png = pngBuffer(1, 1);

function artifact(name = 'diagram.html') {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, '<!doctype html><html><body>checked artifact</body></html>');
  return file;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

for (const mode of ['full', 'preflight']) {
  test(`visual ${mode} batch treats Darwin case aliases as one sidecar namespace`, () => {
    const upper = path.join(tmp, `case-alias-Case.html`);
    const lower = path.join(tmp, `case-alias-case.htm`);

    const darwin = auditVisualCheckBatch([upper, lower], { mode, platform: 'darwin' });
    const win32 = auditVisualCheckBatch([upper, lower], { mode, platform: 'win32' });
    const linux = auditVisualCheckBatch([upper, lower], { mode, platform: 'linux' });
    const native = auditVisualCheckBatch([upper, lower], { mode });

    assert.equal(darwin.ok, false);
    assert.equal(darwin.code, 'viewer/evidence-path-collision');
    assert.equal(win32.ok, false);
    assert.equal(linux.ok, true);
    assert.equal(native.ok, !['darwin', 'win32'].includes(process.platform));
  });

  test(`visual ${mode} batch treats Darwin NFC and NFD aliases as one sidecar namespace`, () => {
    const nfc = path.join(tmp, `unicode-alias-\u00e9.html`);
    const nfd = path.join(tmp, `unicode-alias-e\u0301.htm`);

    const darwin = auditVisualCheckBatch([nfc, nfd], { mode, platform: 'darwin' });
    const linux = auditVisualCheckBatch([nfc, nfd], { mode, platform: 'linux' });
    const native = auditVisualCheckBatch([nfc, nfd], { mode });

    assert.equal(darwin.ok, false);
    assert.equal(darwin.code, 'viewer/evidence-path-collision');
    assert.equal(linux.ok, true);
    assert.equal(native.ok, process.platform !== 'darwin');
  });
}

function fakeBrowser({
  overflowAt,
  overflowYAt,
  unreadableAt,
  chromeCollisionAt,
  stageCollisionAt,
  stageGapAt,
  screenshotFailure,
  screenshotDimensionsAt,
  screenshotBytesAt,
  resolvedThemeAt,
  detailLevelAt,
  motionAt,
} = {}) {
  const calls = [];
  const captureCalls = [];
  const state = {
    calls,
    captureCalls,
    probeCount: 0,
    resetCount: 0,
    closeCount: 0,
    async probe() {
      state.probeCount += 1;
      return { product: 'FakeChrome/1.0', protocolVersion: '1.3' };
    },
    async inspect({ width, height, theme, screenshotPath }) {
      calls.push({ width, height, theme, screenshotPath });
      if (screenshotPath && screenshotFailure?.({ width, height, theme })) {
        throw new Error('synthetic screenshot failure');
      }
      if (screenshotPath) {
        const dimensions = screenshotDimensionsAt?.({ width, height, theme }) || { width, height };
        const bytes = screenshotBytesAt?.({ width, height, theme });
        fs.writeFileSync(screenshotPath, bytes || pngBuffer(dimensions.width, dimensions.height));
      }
      const overflow = overflowAt?.({ width, height, theme }) || false;
      const overflowYBy = Number(overflowYAt?.({ width, height, theme })) || 0;
      const unreadable = unreadableAt?.({ width, height, theme }) || false;
      const chromeCollision = chromeCollisionAt?.({ width, height, theme }) || false;
      const stageCollision = stageCollisionAt?.({ width, height, theme }) || false;
      const dockStageGap = stageGapAt?.({ width, height, theme }) ?? (stageCollision ? -12 : 10);
      const stageClearanceFailure = stageCollision || dockStageGap < 10;
      return {
        innerWidth: width,
        innerHeight: height,
        scrollWidth: width + (overflow ? 1 : 0),
        scrollHeight: height + overflowYBy,
        resolvedTheme: resolvedThemeAt?.({ width, height, theme }) ?? theme,
        detailLevel: detailLevelAt?.({ width, height, theme }) ?? 'read',
        motion: motionAt?.({ width, height, theme }) ?? 'still',
        readerWidth: 960,
        diagramWidth: 930,
        viewBoxWidth: 1300,
        minimumProjectedNodeTextPx: unreadable ? 5.72 : 6.44,
        minimumProjectedNodeText: unreadable ? 'Compact node' : 'Readable node',
        minimumProjectedNodeTextDetail: unreadable ? 'primary' : 'context',
        hasLegend: true,
        hasNavigationDock: true,
        legendDockIntersectionArea: chromeCollision ? 42 : 0,
        dockStageIntersectionArea: stageCollision ? 84 : 0,
        dockStageGap,
        viewerChromeRequiredGap: 10,
        viewerChromeReserve: chromeCollision || stageClearanceFailure ? 0 : 44,
        viewerChromeActive: !chromeCollision && !stageClearanceFailure,
        readerLayoutActive: true,
        readerOverflowState: overflow || overflowYBy ? 'authored' : null,
        readerLayoutWidth: 960,
        readerLayoutRatio: 1.8,
        fixedHeight: 232,
        availableSvgHeight: height - 232,
        fixedHeightBreakdown: {
          bodyChrome: 32,
          diagramChrome: 24,
          header: 64,
          guidedViews: 0,
          cards: 100,
          safeBottomGap: 12,
        },
      };
    },
    async captureScreenshot(screenshotPath) {
      captureCalls.push(screenshotPath);
      const current = calls.at(-1);
      const dimensions = screenshotDimensionsAt?.(current) || current;
      const bytes = screenshotBytesAt?.(current);
      fs.writeFileSync(screenshotPath, bytes || pngBuffer(dimensions.width, dimensions.height));
    },
    async reset() { state.resetCount += 1; },
    async close() { state.closeCount += 1; },
  };
  return state;
}

function browserWithFakeCdp() {
  const calls = [];
  const browser = Object.create(ChromeVisualBrowser.prototype);
  browser.sessionPromise = Promise.resolve('fake-session');
  let viewport = { width: 0, height: 0 };
  let resolvedTheme = 'light';
  browser.cdp = {
    waitFor(method, sessionId) {
      calls.push({ kind: 'waitFor', method, sessionId });
      return Promise.resolve({});
    },
    async send(method, params = {}, sessionId, timeoutMs) {
      calls.push({ kind: 'send', method, params, sessionId, timeoutMs });
      if (method === 'Emulation.setDeviceMetricsOverride') {
        viewport = { width: params.width, height: params.height };
        return {};
      }
      if (method === 'Page.navigate') {
        resolvedTheme = new URL(params.url).searchParams.get('theme');
        return {};
      }
      if (method === 'Runtime.evaluate') {
        if (params.expression.includes('var reader =')) {
          return { result: { value: {
            innerWidth: viewport.width,
            innerHeight: viewport.height,
            scrollWidth: viewport.width,
            scrollHeight: viewport.height,
            resolvedTheme,
            detailLevel: 'read',
            motion: 'still',
            readerWidth: 960,
            diagramWidth: 930,
            viewBoxWidth: 1300,
            minimumProjectedNodeTextPx: 6.44,
            hasLegend: false,
            hasNavigationDock: false,
            legendDockIntersectionArea: 0,
            dockStageIntersectionArea: 0,
            dockStageGap: null,
            viewerChromeRequiredGap: null,
            viewerChromeReserve: 0,
            viewerChromeActive: false,
            readerLayoutActive: true,
            readerOverflowState: null,
            readerLayoutWidth: 960,
            readerLayoutRatio: 1.8,
            fixedHeight: 232,
            fixedHeightBreakdown: {},
            availableSvgHeight: viewport.height - 232,
          } } };
        }
        return { result: { value: null } };
      }
      return {};
    },
  };
  return { browser, calls };
}

function fakeChromeChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.stderr = new PassThrough();
  child.stdio = [null, null, child.stderr, new PassThrough(), new PassThrough()];
  child.kill = (signal) => {
    child.signalCode = signal;
    queueMicrotask(() => {
      child.emit('exit', null, signal);
      child.emit('close', null, signal);
    });
    return true;
  };
  return child;
}

test('visual-check disables the Chrome sandbox only for an explicit environment opt-in', () => {
  const profileRoot = path.join(tmp, 'chrome-profile');
  const ordinary = chromeVisualBrowserArgs(profileRoot, { env: {}, getuid: () => 1001 });
  const optedIn = chromeVisualBrowserArgs(profileRoot, {
    env: { ARCHIFY_CHROME_NO_SANDBOX: '1' },
    getuid: () => 1001,
  });
  const root = chromeVisualBrowserArgs(profileRoot, { env: {}, getuid: () => 0 });

  assert.equal(ordinary.includes('--no-sandbox'), false);
  assert.equal(optedIn.includes('--no-sandbox'), true);
  assert.equal(root.includes('--no-sandbox'), false);
});

test('Chrome capability probe returns a structured unavailable receipt', async () => {
  const result = await probeVisualCheckCapability({ resolveChrome: () => null });

  assert.equal(result.receipt.schemaVersion, 1, 'capability receipt retains its independent v1 contract');
  assert.equal(result.exitCode, 2);
  assert.equal(result.receipt.ok, false);
  assert.equal(result.receipt.status, 'unavailable');
  assert.equal(result.receipt.chrome.status, 'unavailable');
  assert.equal(result.receipt.chrome.sandbox.automaticOptOut, false);
  assert.equal(result.receipt.cdp.status, 'skipped');
  assert.equal(result.receipt.diagnostics[0]?.code, 'viewer/chrome-unavailable');
});

test('Chrome capability probe verifies CDP once and never retries without sandbox', async () => {
  const browser = fakeBrowser();
  let launches = 0;
  const result = await probeVisualCheckCapability({
    chromePath: '/fake/chrome',
    env: {},
    browserFactory: async () => {
      launches += 1;
      return browser;
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.receipt.schemaVersion, 1, 'capability receipt retains its independent v1 contract');
  assert.equal(result.receipt.status, 'pass');
  assert.equal(result.receipt.cdp.status, 'available');
  assert.equal(result.receipt.cdp.product, 'FakeChrome/1.0');
  assert.equal(result.receipt.chrome.sandbox.status, 'enabled');
  assert.equal(result.receipt.chrome.sandbox.automaticOptOut, false);
  assert.equal(launches, 1);
  assert.equal(browser.probeCount, 1);
  assert.equal(browser.closeCount, 1);
});

test('Chrome capability probe reports launch failure without an automatic no-sandbox retry', async () => {
  let launches = 0;
  const result = await probeVisualCheckCapability({
    chromePath: '/fake/chrome',
    env: {},
    browserFactory: async () => {
      launches += 1;
      throw new Error('synthetic sandbox launch failure');
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.equal(result.receipt.cdp.status, 'failed');
  assert.equal(result.receipt.chrome.sandbox.status, 'enabled');
  assert.equal(launches, 1);
  assert.ok(result.receipt.diagnostics[0]?.supportedFixes.some(
    (fix) => fix.includes('ARCHIFY_CHROME_NO_SANDBOX=1'),
  ));
});

test('visual-check converts a Chrome DevTools pipe reset and captured stderr into a structured failure', async () => {
  const input = artifact('chrome-pipe-reset.html');
  const child = fakeChromeChild();

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => {
      const browser = new ChromeVisualBrowser('/fake/chrome', {
        env: { ARCHIFY_CHROME_NO_SANDBOX: '1' },
        getuid: () => 1001,
        spawnImpl: () => child,
      });
      setImmediate(() => {
        child.stderr.write('Chrome sandbox initialization failed\n');
        const error = new Error('read ECONNRESET');
        error.code = 'ECONNRESET';
        child.stdio[4].emit('error', error);
      });
      return browser;
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.match(result.receipt.error, /Chrome DevTools read pipe failed/);
  assert.match(result.receipt.error, /ECONNRESET/);
  assert.match(result.receipt.error, /Chrome sandbox initialization failed/);
  assert.equal(result.receipt.diagnostics[0]?.code, 'viewer/visual-check-runtime');
  assert.match(result.receipt.diagnostics[0]?.evidence?.reason || '', /ECONNRESET/);
  assert.equal(fs.existsSync(sidecarPaths(input).receipt), true);
});

test('visual-check reports Chrome early exit status and stderr without an uncaught exception', async () => {
  const input = artifact('chrome-early-exit.html');
  const child = fakeChromeChild();

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => {
      const browser = new ChromeVisualBrowser('/fake/chrome', {
        env: { ARCHIFY_CHROME_NO_SANDBOX: '1' },
        getuid: () => 1001,
        spawnImpl: () => child,
      });
      setImmediate(() => {
        child.stderr.write('Chrome rejected its launch flags\n');
        child.exitCode = 23;
        child.emit('close', 23, null);
      });
      return browser;
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.match(result.receipt.error, /Chrome DevTools process exit failed/);
  assert.match(result.receipt.error, /exit code 23/);
  assert.match(result.receipt.error, /Chrome rejected its launch flags/);
  assert.equal(result.receipt.diagnostics[0]?.code, 'viewer/visual-check-runtime');
});

test('visual-check records four containment viewports and four endpoint theme captures', async () => {
  const input = artifact('passing.html');
  const before = sha256(input);
  const browser = fakeBrowser();
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.receipt.schemaVersion, 2);
  assert.equal(result.receipt.status, 'pass');
  assert.deepEqual(result.receipt.diagnostics, []);
  assert.equal(result.receipt.visualReview, 'pending');
  assert.equal(result.receipt.viewerChrome.status, 'pass');
  assert.equal(result.receipt.state.status, 'pass');
  assert.equal(result.receipt.state.observations.length, 6);
  assert.equal(result.receipt.state.observations.every((entry) => (
    entry.resolvedTheme === entry.requestedTheme
      && entry.detailLevel === 'read'
      && entry.motion === 'still'
      && entry.ok
  )), true);
  assert.equal(result.receipt.containment.viewports.length, VISUAL_CHECK_VIEWPORTS.length);
  assert.equal(result.receipt.containment.viewports.every((entry) => entry.ok), true);
  assert.equal(browser.resetCount, 0, 'an owned single-artifact session closes without a redundant reset');
  assert.deepEqual(
    result.receipt.captures.screenshots.map(({ width, height, theme }) => [width, height, theme]),
    [
      [1440, 900, 'light'],
      [1440, 900, 'dark'],
      [2048, 1320, 'light'],
      [2048, 1320, 'dark'],
    ],
  );
  assert.equal(result.receipt.artifact.sha256, before);
  assert.equal(sha256(input), before, 'visual-check mutated the delivered artifact');

  const outputs = sidecarPaths(input);
  assert.equal(fs.existsSync(outputs.receipt), true);
  assert.equal(fs.existsSync(outputs.contactSheet), true);
  assert.equal(outputs.screenshots.every((entry) => fs.existsSync(entry.path)), true);
  const contactSheet = fs.readFileSync(outputs.contactSheet, 'utf8');
  for (const screenshot of outputs.screenshots) {
    assert.match(contactSheet, new RegExp(path.basename(screenshot.path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(contactSheet, new RegExp(screenshot.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('visual-check fails closed when the resolved theme differs from the requested theme', async () => {
  const input = artifact('theme-state-mismatch.html');
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({
      resolvedThemeAt: ({ theme }) => theme === 'dark' ? 'light' : theme,
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.equal(result.receipt.state.status, 'fail');
  const diagnostic = result.receipt.diagnostics.find(
    (entry) => entry.code === 'viewer/theme-state',
  );
  assert.equal(diagnostic?.evidence?.requested, 'dark');
  assert.equal(diagnostic?.evidence?.resolved, 'light');
});

test('visual-check fails closed when READ detail was not observed', async () => {
  const input = artifact('detail-state-mismatch.html');
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({
      detailLevelAt: ({ width, theme }) => width === 1600 && theme === 'light' ? 'map' : 'read',
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.state.status, 'fail');
  const diagnostic = result.receipt.diagnostics.find(
    (entry) => entry.code === 'viewer/detail-state',
  );
  assert.equal(diagnostic?.evidence?.requested, 'read');
  assert.equal(diagnostic?.evidence?.resolved, 'map');
});

test('visual-check fails closed when Still motion was not observed', async () => {
  const input = artifact('motion-state-mismatch.html');
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({
      motionAt: ({ width, theme }) => width === 1920 && theme === 'light' ? 'live' : 'still',
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.state.status, 'fail');
  const diagnostic = result.receipt.diagnostics.find(
    (entry) => entry.code === 'viewer/motion-state',
  );
  assert.equal(diagnostic?.evidence?.requested, 'still');
  assert.equal(diagnostic?.evidence?.resolved, 'live');
});

test('visual-check does not treat absent detail and motion metrics as measured READ/Still state', async () => {
  const input = artifact('state-metrics-absent.html');
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({
      detailLevelAt: () => '',
      motionAt: () => '',
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.state.status, 'fail');
  assert.ok(result.receipt.diagnostics.some((entry) => entry.code === 'viewer/detail-state'));
  assert.ok(result.receipt.diagnostics.some((entry) => entry.code === 'viewer/motion-state'));
});

test('visual-check binds every screenshot receipt to content SHA and measured pixel dimensions', async () => {
  const input = artifact('screenshot-evidence.html');
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.receipt.captures.screenshots.length, 4);
  for (const screenshot of result.receipt.captures.screenshots) {
    assert.match(screenshot.sha256, /^[a-f0-9]{64}$/);
    assert.ok(screenshot.bytes >= 24);
    assert.equal(screenshot.pixelWidth, screenshot.width);
    assert.equal(screenshot.pixelHeight, screenshot.height);
  }
});

test('visual-check rejects a screenshot whose measured pixels do not match its viewport', async () => {
  const input = artifact('screenshot-dimension-mismatch.html');
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({
      screenshotDimensionsAt: ({ width, height, theme }) => (
        width === 1440 && theme === 'dark' ? { width: 1, height: 1 } : { width, height }
      ),
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.captures.status, 'fail');
  const diagnostic = result.receipt.diagnostics.find(
    (entry) => entry.code === 'viewer/screenshot-evidence',
  );
  assert.deepEqual(diagnostic?.evidence?.expected, { width: 1440, height: 900 });
  assert.deepEqual(diagnostic?.evidence?.actual, { width: 1, height: 1 });
});

test('visual-check rejects a truncated PNG header even when its claimed dimensions match', async () => {
  const input = artifact('screenshot-truncated-png.html');
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({
      screenshotBytesAt: ({ width, height, theme }) => (
        width === 1440 && theme === 'dark' ? pngHeader(width, height) : null
      ),
    }),
  });

  assert.equal(result.exitCode, 1);
  const diagnostic = result.receipt.diagnostics.find(
    (entry) => entry.code === 'viewer/screenshot-evidence',
  );
  assert.match(diagnostic?.message || '', /complete PNG chunk structure/i);
});

test('Chrome visual inspection navigates once per artifact and theme, then resizes in place', async () => {
  const input = artifact('navigation-reuse.html');
  const { browser, calls } = browserWithFakeCdp();

  const first = await browser.inspect({ artifactPath: input, width: 1440, height: 900, theme: 'light' });
  const second = await browser.inspect({ artifactPath: input, width: 1600, height: 1000, theme: 'light' });
  const third = await browser.inspect({ artifactPath: input, width: 1440, height: 900, theme: 'dark' });

  assert.deepEqual([first.innerWidth, second.innerWidth, third.resolvedTheme], [1440, 1600, 'dark']);
  assert.equal(calls.filter((entry) => entry.method === 'Page.navigate').length, 2);
  assert.equal(calls.filter((entry) => entry.method === 'Emulation.setDeviceMetricsOverride').length, 3);
});

test('Chrome visual inspection waits on reader and chrome together for each of two stability rounds', async () => {
  const input = artifact('parallel-stability-barrier.html');
  const { browser, calls } = browserWithFakeCdp();

  await browser.inspect({ artifactPath: input, width: 1440, height: 900, theme: 'light' });

  const barriers = calls.filter((entry) => (
    entry.method === 'Runtime.evaluate' && entry.params.expression.includes('document.fonts')
  ));
  assert.equal(barriers.length, 1);
  assert.equal((barriers[0].params.expression.match(/Promise\.all/g) || []).length, 1);
  assert.match(barriers[0].params.expression, /then\(stableRound\)\.then\(stableRound\)/);
  assert.match(barriers[0].params.expression, /readerLayout\.whenStable/);
  assert.match(barriers[0].params.expression, /viewerChromeLayout\.whenStable/);
});

test('visual-check returns 1 and preserves evidence when any viewport overflows', async () => {
  const input = artifact('overflow.html');
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({
      overflowAt: ({ width, theme }) => width === 1600 && theme === 'light',
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.equal(result.receipt.containment.status, 'fail');
  assert.deepEqual(
    result.receipt.containment.viewports.filter((entry) => !entry.ok).map((entry) => [entry.width, entry.height]),
    [[1600, 1000]],
  );
  const diagnostic = result.receipt.diagnostics.find(
    (entry) => entry.code === 'viewer/viewport-overflow',
  );
  assert.deepEqual(diagnostic?.subject, {
    artifact: input,
    viewport: { width: 1600, height: 1000, theme: 'light' },
  });
  assert.equal(diagnostic?.evidence?.scrollWidth, 1601);
  assert.equal(fs.existsSync(sidecarPaths(input).contactSheet), true);
});

test('visual-check returns 1 when the real reader projects node text below 6px', async () => {
  const input = artifact('unreadable.html');
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({
      unreadableAt: ({ width, height, theme }) => width === 1440 && height === 900 && theme === 'light',
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.equal(result.receipt.readability.status, 'fail');
  const desktop = result.receipt.readability.viewports.find(
    (entry) => entry.width === 1440 && entry.height === 900,
  );
  assert.equal(desktop?.diagramWidth, 930);
  assert.equal(desktop?.minimumProjectedNodeText, 'Compact node');
  assert.equal(desktop?.minimumProjectedNodeTextDetail, 'primary');
  assert.equal(desktop?.readabilityOk, false);
  const diagnostic = result.receipt.diagnostics.find(
    (entry) => entry.code === 'viewer/projected-text-readability',
  );
  assert.equal(diagnostic?.evidence?.text, 'Compact node');
  assert.equal(diagnostic?.evidence?.minimumProjectedNodeTextPx, 5.72);
  assert.equal(diagnostic?.evidence?.minimumRequiredNodeTextPx, 6);
});

test('visual-check applies the readability floor to dark capture observations too', async () => {
  const input = artifact('unreadable-dark-capture.html');
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({
      unreadableAt: ({ width, theme }) => width === 1440 && theme === 'dark',
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.readability.status, 'fail');
  const diagnostic = result.receipt.diagnostics.find((entry) => (
    entry.code === 'viewer/projected-text-readability'
      && entry.subject.viewport.theme === 'dark'
  ));
  assert.equal(diagnostic?.evidence?.minimumProjectedNodeTextPx, 5.72);
});

test('visual-check returns 1 when the navigation dock obscures the SVG legend', async () => {
  const input = artifact('viewer-chrome-collision.html');
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({
      chromeCollisionAt: ({ width, height, theme }) => (
        width === 1920 && height === 1080 && theme === 'light'
      ),
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.equal(result.receipt.viewerChrome.status, 'fail');
  const desktop = result.receipt.viewerChrome.viewports.find(
    (entry) => entry.width === 1920 && entry.height === 1080,
  );
  assert.equal(desktop?.legendDockIntersectionArea, 42);
  assert.equal(desktop?.viewerChromeOk, false);
  const diagnostic = result.receipt.diagnostics.find(
    (entry) => entry.code === 'viewer/chrome-legend-clearance',
  );
  assert.equal(diagnostic?.evidence?.legendDockIntersectionArea, 42);
});

test('visual-check returns 1 when the navigation dock enters the SVG stage', async () => {
  const input = artifact('viewer-stage-collision.html');
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({
      stageCollisionAt: ({ width, height, theme }) => (
        width === 1920 && height === 1080 && theme === 'light'
      ),
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.equal(result.receipt.viewerChrome.status, 'fail');
  const desktop = result.receipt.viewerChrome.viewports.find(
    (entry) => entry.width === 1920 && entry.height === 1080,
  );
  assert.equal(desktop?.dockStageIntersectionArea, 84);
  assert.equal(desktop?.dockStageGap, -12);
  assert.equal(desktop?.requiredDockStageGap, 10);
  assert.equal(desktop?.viewerChromeStageOk, false);
  assert.equal(desktop?.viewerChromeOk, false);
  const diagnostic = result.receipt.diagnostics.find(
    (entry) => entry.code === 'viewer/chrome-stage-clearance',
  );
  assert.deepEqual(diagnostic?.subject, {
    artifact: input,
    viewport: { width: 1920, height: 1080, theme: 'light' },
  });
  assert.deepEqual(diagnostic?.evidence, {
    dockStageIntersectionArea: 84,
    dockStageGap: -12,
    requiredDockStageGap: 10,
  });
  assert.match(diagnostic?.message || '', /enters the protected SVG stage/);
  assert.ok(diagnostic?.supportedFixes.some((fix) => fix.includes('dockStageGap')));
  assert.equal(diagnostic?.supportedFixes.some((fix) => fix.includes('regenerate')), false);
});

test('visual-check describes insufficient stage clearance without claiming an overlap', async () => {
  const input = artifact('viewer-stage-low-gap.html');
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({
      stageGapAt: ({ width, height, theme }) => (
        width === 1920 && height === 1080 && theme === 'light' ? 5 : 10
      ),
    }),
  });

  assert.equal(result.exitCode, 1);
  const diagnostic = result.receipt.diagnostics.find(
    (entry) => entry.code === 'viewer/chrome-stage-clearance',
  );
  assert.equal(diagnostic?.evidence?.dockStageIntersectionArea, 0);
  assert.equal(diagnostic?.evidence?.dockStageGap, 5);
  assert.match(diagnostic?.message || '', /clearance.*below the required gap/i);
  assert.doesNotMatch(diagnostic?.message || '', /enters/i);
});

test('visual-check returns 1 and removes misleading capture sidecars on screenshot failure', async () => {
  const input = artifact('capture-failure.html');
  const outputs = sidecarPaths(input);
  fs.writeFileSync(outputs.contactSheet, 'stale');
  for (const screenshot of outputs.screenshots) fs.writeFileSync(screenshot.path, png);

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({
      screenshotFailure: ({ theme }) => theme === 'dark',
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.equal(result.receipt.captures.status, 'fail');
  assert.match(result.receipt.error, /synthetic screenshot failure/);
  assert.equal(result.receipt.diagnostics[0]?.code, 'viewer/visual-check-runtime');
  assert.match(result.receipt.diagnostics[0]?.evidence?.reason || '', /synthetic screenshot failure/);
  assert.equal(fs.existsSync(outputs.contactSheet), false);
  assert.equal(outputs.screenshots.some((entry) => fs.existsSync(entry.path)), false);
  assert.equal(fs.existsSync(outputs.receipt), true);
});

test('visual-preflight checks four light viewports without captures or a contact sheet when containment passes', async () => {
  const input = artifact('preflight-passing.html');
  const browser = fakeBrowser();
  const result = await runVisualPreflight({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.receipt.command, 'visual-preflight');
  assert.equal(result.receipt.schemaVersion, 2);
  assert.deepEqual(result.receipt.automatedChecks, ['containment']);
  assert.equal(result.receipt.state.status, 'pass');
  assert.equal(result.receipt.containment.viewports.length, VISUAL_PREFLIGHT_VIEWPORTS.length);
  assert.equal(browser.calls.length, 4);
  assert.equal(browser.calls.every((entry) => entry.theme === 'light' && !entry.screenshotPath), true);
  assert.equal(browser.captureCalls.length, 0);
  assert.equal(browser.resetCount, 0, 'an owned single-artifact preflight closes without a redundant reset');
  assert.deepEqual(result.receipt.captures, {
    status: 'not-requested', screenshots: [], contactSheet: null,
  });
  assert.equal('readability' in result.receipt, false);
  assert.equal('viewerChrome' in result.receipt, false);
  assert.equal(result.receipt.artifact.verification.unchanged, true);
  const outputs = preflightSidecarPaths(input);
  assert.equal(fs.existsSync(outputs.receipt), true);
  assert.equal(fs.existsSync(outputs.diagnosticScreenshot), false);
  assert.equal('contactSheet' in outputs, false);
});

for (const preflight of [false, true]) {
  test(`visual ${preflight ? 'preflight' : 'full'} batch wrapper and failure children use receipt schema v2`, () => {
    const input = artifact(`schema-v2-${preflight ? 'preflight' : 'full'}.html`);
    const result = spawnSync(process.execPath, [
      archifyCli,
      'visual-check',
      input,
      input,
      ...(preflight ? ['--preflight'] : []),
      '--json',
    ], { encoding: 'utf8' });
    const receipt = JSON.parse(result.stdout);

    assert.equal(result.status, 1);
    assert.equal(receipt.schemaVersion, 2);
    assert.equal(receipt.artifacts.length, 2);
    assert.equal(receipt.artifacts.every((entry) => entry.schemaVersion === 2), true);
  });
}

test('visual-preflight also fails closed when requested viewer state was not measured', async () => {
  const input = artifact('preflight-state-missing.html');
  const result = await runVisualPreflight({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({ detailLevelAt: () => '', motionAt: () => '' }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.containment.status, 'pass');
  assert.equal(result.receipt.state.status, 'fail');
  assert.ok(result.receipt.diagnostics.some((entry) => entry.code === 'viewer/detail-state'));
  assert.ok(result.receipt.diagnostics.some((entry) => entry.code === 'viewer/motion-state'));
});

test('visual-preflight captures at most one light diagnostic screenshot and reports actionable overflow metrics', async () => {
  const input = artifact('preflight-overflow.html');
  const browser = fakeBrowser({
    overflowYAt: ({ width, theme }) => width >= 1600 && theme === 'light' ? 37 : 0,
  });
  const result = await runVisualCheck({
    mode: 'preflight',
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.equal(browser.calls.length, 4);
  assert.equal(browser.calls.every((entry) => entry.theme === 'light'), true);
  assert.equal(browser.captureCalls.length, 1);
  assert.equal(result.receipt.captures.status, 'diagnostic');
  assert.equal(result.receipt.captures.screenshots.length, 1);
  assert.equal(result.receipt.captures.screenshots[0].theme, 'light');
  assert.match(result.receipt.captures.screenshots[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.receipt.captures.screenshots[0].pixelWidth, 1600);
  assert.equal(result.receipt.captures.screenshots[0].pixelHeight, 1000);
  const diagnostic = result.receipt.diagnostics.find(
    (entry) => entry.code === 'viewer/viewport-overflow' && entry.subject.viewport.width === 1600,
  );
  assert.equal(diagnostic?.evidence?.overflowYBy, 37);
  assert.equal(diagnostic?.evidence?.readerLayout?.fixedHeight, 232);
  assert.deepEqual(diagnostic?.evidence?.readerLayout?.fixedHeightBreakdown, {
    bodyChrome: 32,
    diagramChrome: 24,
    header: 64,
    guidedViews: 0,
    cards: 100,
    safeBottomGap: 12,
  });
  assert.ok(diagnostic?.supportedFixes.some((fix) => fix.includes('37px')));
  assert.ok(diagnostic?.supportedFixes.every((fix) => fix.includes('visual-preflight')));
  assert.equal(fs.existsSync(preflightSidecarPaths(input).diagnosticScreenshot), true);
});

test('visual-preflight removes an unverified diagnostic screenshot instead of citing it as evidence', async () => {
  const input = artifact('preflight-invalid-diagnostic.html');
  const result = await runVisualPreflight({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({
      overflowYAt: ({ width }) => width === 1600 ? 1 : 0,
      screenshotDimensionsAt: ({ width, height }) => (
        width === 1600 ? { width: 1, height: 1 } : { width, height }
      ),
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.captures.screenshots.length, 0);
  const warning = result.receipt.diagnostics.find(
    (entry) => entry.code === 'viewer/preflight-diagnostic-capture',
  );
  assert.deepEqual(warning?.evidence?.screenshot?.expected, { width: 1600, height: 1000 });
  assert.deepEqual(warning?.evidence?.screenshot?.actual, { width: 1, height: 1 });
  assert.equal(fs.existsSync(preflightSidecarPaths(input).diagnosticScreenshot), false);
});

test('caller-owned VisualCheckSession reuses one browser and resets only between artifacts', async () => {
  const first = artifact('session-first.html');
  const second = artifact('session-second.html');
  const browser = fakeBrowser();
  let launches = 0;
  const session = new VisualCheckSession({
    chromePath: '/fake/chrome',
    browserFactory: async () => {
      launches += 1;
      return browser;
    },
  });

  const firstResult = await session.preflight({ artifactPath: first });
  const secondResult = await session.preflight({ artifactPath: second, finalArtifact: true });

  assert.equal(firstResult.exitCode, 0);
  assert.equal(secondResult.exitCode, 0);
  assert.equal(firstResult.receipt.artifact.verification.unchanged, true);
  assert.equal(secondResult.receipt.artifact.verification.unchanged, true);
  assert.equal(launches, 1);
  assert.equal(browser.probeCount, 1);
  assert.equal(browser.calls.length, 8);
  assert.equal(browser.resetCount, 1);
  assert.equal(browser.closeCount, 0, 'caller-owned session was closed by an artifact check');

  await session.close();
  assert.equal(browser.closeCount, 1);
});

test('a five-artifact VisualCheckSession batch performs exactly four isolation resets', async () => {
  const inputs = Array.from({ length: 5 }, (_, index) => artifact(`session-five-${index}.html`));
  const browser = fakeBrowser();
  const session = new VisualCheckSession({
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  const results = [];
  for (const [index, artifactPath] of inputs.entries()) {
    results.push(await session.preflight({
      artifactPath,
      finalArtifact: index === inputs.length - 1,
    }));
  }

  assert.equal(results.every((result) => result.exitCode === 0), true);
  assert.equal(browser.calls.length, 20);
  assert.equal(browser.resetCount, 4);
  await session.close();
  assert.equal(browser.closeCount, 1);
});

test('finalArtifact skips reset and seals the VisualCheckSession against further inspection', async () => {
  const first = artifact('session-finalized-first.html');
  const second = artifact('session-finalized-second.html');
  const browser = fakeBrowser();
  const session = new VisualCheckSession({
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  const firstResult = await session.preflight({ artifactPath: first, finalArtifact: true });
  const callsAfterFinal = browser.calls.length;
  const secondResult = await session.preflight({ artifactPath: second });

  assert.equal(firstResult.exitCode, 0);
  assert.equal(browser.resetCount, 0);
  assert.equal(secondResult.exitCode, 1);
  assert.match(secondResult.receipt.error, /session is finalized/i);
  assert.equal(browser.calls.length, callsAfterFinal);
  await session.close();
});

test('VisualCheckSession fails closed when browser state reset fails', async () => {
  const first = artifact('session-reset-failure-first.html');
  const second = artifact('session-reset-failure-second.html');
  const browser = fakeBrowser();
  browser.reset = async () => {
    browser.resetCount += 1;
    throw new Error('synthetic reset failure');
  };
  const session = new VisualCheckSession({
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  const firstResult = await session.preflight({ artifactPath: first });
  const callsAfterFailure = browser.calls.length;
  const secondResult = await session.preflight({ artifactPath: second, finalArtifact: true });

  assert.equal(firstResult.exitCode, 1);
  assert.match(firstResult.receipt.error, /fail-closed.*synthetic reset failure/i);
  assert.equal(secondResult.exitCode, 1);
  assert.match(secondResult.receipt.error, /fail-closed.*synthetic reset failure/i);
  assert.equal(browser.resetCount, 1);
  assert.equal(browser.calls.length, callsAfterFailure, 'poisoned session inspected another artifact');
  await session.close();
});

test('visual-check records before and after hashes and fails when the artifact changes', async () => {
  const input = artifact('artifact-mutated-during-check.html');
  const browser = fakeBrowser();
  const inspect = browser.inspect.bind(browser);
  let mutated = false;
  browser.inspect = async (options) => {
    const metrics = await inspect(options);
    if (!mutated) {
      fs.appendFileSync(input, '<!-- mutation -->');
      mutated = true;
    }
    return metrics;
  };

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.artifact.verification.unchanged, false);
  assert.notEqual(
    result.receipt.artifact.verification.before.sha256,
    result.receipt.artifact.verification.after.sha256,
  );
  assert.match(result.receipt.error, /artifact changed/i);
  assert.deepEqual(result.receipt.diagnostics.map((entry) => entry.code), ['viewer/artifact-changed']);
  assert.deepEqual(
    result.receipt.diagnostics[0].evidence.before,
    result.receipt.artifact.verification.before,
  );
  assert.deepEqual(
    result.receipt.diagnostics[0].evidence.after,
    result.receipt.artifact.verification.after,
  );
});

test('visual-preflight classifies an inspection-time artifact mutation as artifact-changed', async () => {
  const input = artifact('artifact-mutated-during-preflight.html');
  const browser = fakeBrowser();
  const inspect = browser.inspect.bind(browser);
  let mutated = false;
  browser.inspect = async (options) => {
    const metrics = await inspect(options);
    if (!mutated) {
      fs.appendFileSync(input, '<!-- preflight mutation -->');
      mutated = true;
    }
    return metrics;
  };

  const result = await runVisualPreflight({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.artifact.verification.unchanged, false);
  assert.deepEqual(result.receipt.diagnostics.map((entry) => entry.code), ['viewer/artifact-changed']);
  assert.deepEqual(
    result.receipt.diagnostics[0].evidence.before,
    result.receipt.artifact.verification.before,
  );
  assert.deepEqual(
    result.receipt.diagnostics[0].evidence.after,
    result.receipt.artifact.verification.after,
  );
});

test('visual-check returns 2 with a truthful skipped receipt when Chrome is unavailable', async () => {
  const input = artifact('no-chrome.html');
  const result = await runVisualCheck({
    artifactPath: input,
    resolveChrome: () => null,
  });

  assert.equal(result.exitCode, 2);
  assert.equal(result.receipt.status, 'skipped');
  assert.equal(result.receipt.containment.status, 'skipped');
  assert.equal(result.receipt.viewerChrome.status, 'skipped');
  assert.equal(result.receipt.captures.status, 'skipped');
  assert.equal(result.receipt.visualReview, 'pending');
  assert.equal(result.receipt.diagnostics[0]?.code, 'viewer/chrome-unavailable');
  assert.ok(result.receipt.diagnostics[0]?.supportedFixes.some((fix) => fix.includes('ARCHIFY_CHROME')));
  assert.equal(fs.existsSync(sidecarPaths(input).receipt), true);
});

test('visual-check fails when an unavailable probe observes an artifact mutation', async () => {
  const input = artifact('no-chrome-mutated.html');
  const result = await runVisualCheck({
    artifactPath: input,
    resolveChrome: () => {
      fs.appendFileSync(input, '<!-- changed during capability probe -->');
      return null;
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.equal(result.receipt.artifact.verification.unchanged, false);
  assert.equal(result.receipt.containment.status, 'fail');
  assert.equal(result.receipt.readability.status, 'fail');
  assert.equal(result.receipt.viewerChrome.status, 'fail');
  assert.equal(result.receipt.captures.status, 'fail');
  assert.ok(result.receipt.diagnostics.some((entry) => entry.code === 'viewer/artifact-changed'));
});

test('visual-preflight fails when an unavailable probe can no longer read the artifact', async () => {
  const input = artifact('no-chrome-preflight-removed.html');
  const result = await runVisualPreflight({
    artifactPath: input,
    resolveChrome: () => {
      fs.rmSync(input);
      return null;
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.equal(result.receipt.artifact.verification.unchanged, false);
  assert.match(result.receipt.artifact.verification.after.error, /ENOENT|no such file/i);
  assert.equal(result.receipt.containment.status, 'fail');
  assert.equal(result.receipt.captures.status, 'fail');
  assert.ok(result.receipt.diagnostics.some((entry) => entry.code === 'viewer/artifact-changed'));
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
