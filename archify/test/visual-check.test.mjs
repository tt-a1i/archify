import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';

import {
  ChromeVisualBrowser,
  VISUAL_CHECK_VIEWPORTS,
  chromeVisualBrowserArgs,
  runVisualCheck,
  sidecarPaths,
} from '../bin/visual-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-check-'));
const png = Buffer.from('89504e470d0a1a0a', 'hex');

function artifact(name = 'diagram.html') {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, '<!doctype html><html><body>checked artifact</body></html>');
  return file;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fakeBrowser({ overflowAt, unreadableAt, chromeCollisionAt, screenshotFailure } = {}) {
  const calls = [];
  return {
    calls,
    async inspect({ width, height, theme, screenshotPath }) {
      calls.push({ width, height, theme, screenshotPath });
      if (screenshotPath && screenshotFailure?.({ width, height, theme })) {
        throw new Error('synthetic screenshot failure');
      }
      if (screenshotPath) fs.writeFileSync(screenshotPath, png);
      const overflow = overflowAt?.({ width, height, theme }) || false;
      const unreadable = unreadableAt?.({ width, height, theme }) || false;
      const chromeCollision = chromeCollisionAt?.({ width, height, theme }) || false;
      return {
        innerWidth: width,
        innerHeight: height,
        scrollWidth: width + (overflow ? 1 : 0),
        scrollHeight: height,
        resolvedTheme: theme,
        readerWidth: 960,
        diagramWidth: 930,
        viewBoxWidth: 1300,
        minimumProjectedNodeTextPx: unreadable ? 5.72 : 6.44,
        minimumProjectedNodeText: unreadable ? 'Compact node' : 'Readable node',
        minimumProjectedNodeTextDetail: unreadable ? 'primary' : 'context',
        hasLegend: true,
        hasNavigationDock: true,
        legendDockIntersectionArea: chromeCollision ? 42 : 0,
        viewerChromeReserve: chromeCollision ? 0 : 44,
        viewerChromeActive: !chromeCollision,
      };
    },
    async close() {},
  };
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

test('visual-check disables the Chrome sandbox only for root or an explicit environment opt-in', () => {
  const profileRoot = path.join(tmp, 'chrome-profile');
  const ordinary = chromeVisualBrowserArgs(profileRoot, { env: {}, getuid: () => 1001 });
  const optedIn = chromeVisualBrowserArgs(profileRoot, {
    env: { ARCHIFY_CHROME_NO_SANDBOX: '1' },
    getuid: () => 1001,
  });
  const root = chromeVisualBrowserArgs(profileRoot, { env: {}, getuid: () => 0 });

  assert.equal(ordinary.includes('--no-sandbox'), false);
  assert.equal(optedIn.includes('--no-sandbox'), true);
  assert.equal(root.includes('--no-sandbox'), true);
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
  assert.equal(result.receipt.status, 'pass');
  assert.equal(result.receipt.visualReview, 'pending');
  assert.equal(result.receipt.viewerChrome.status, 'pass');
  assert.equal(result.receipt.containment.viewports.length, VISUAL_CHECK_VIEWPORTS.length);
  assert.equal(result.receipt.containment.viewports.every((entry) => entry.ok), true);
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
  assert.equal(fs.existsSync(outputs.contactSheet), false);
  assert.equal(outputs.screenshots.some((entry) => fs.existsSync(entry.path)), false);
  assert.equal(fs.existsSync(outputs.receipt), true);
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
  assert.equal(fs.existsSync(sidecarPaths(input).receipt), true);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
