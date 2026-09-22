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
  CHROME_STARTUP_TIMEOUT_MS,
  verticalBudgetFixes,
  ChromeVisualBrowser,
  VISUAL_CHECK_VIEWPORTS,
  browserCheckSidecarPaths,
  chromeVisualBrowserArgs,
  persistVisualCheckFailure,
  runBrowserCheck,
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

function fakeBrowser({
  overflowAt,
  tallAt,
  readableScrollAt,
  unreadableAt,
  chromeCollisionAt,
  stageCollisionAt,
  stageGapAt,
  resolvedThemeAt,
  screenshotFailure,
} = {}) {
  const calls = [];
  const captureCalls = [];
  return {
    calls,
    captureCalls,
    async inspect({ width, height, theme, screenshotPath }) {
      calls.push({ width, height, theme, screenshotPath });
      if (screenshotPath && screenshotFailure?.({ width, height, theme })) {
        throw new Error('synthetic screenshot failure');
      }
      if (screenshotPath) fs.writeFileSync(screenshotPath, png);
      const overflow = overflowAt?.({ width, height, theme }) || false;
      const tall = tallAt?.({ width, height, theme }) || false;
      const readableScroll = readableScrollAt?.({ width, height, theme }) || false;
      const unreadable = unreadableAt?.({ width, height, theme }) || false;
      const chromeCollision = chromeCollisionAt?.({ width, height, theme }) || false;
      const stageCollision = stageCollisionAt?.({ width, height, theme }) || false;
      const dockStageGap = stageGapAt?.({ width, height, theme }) ?? (stageCollision ? -12 : 10);
      const stageClearanceFailure = stageCollision || dockStageGap < 10;
      return {
        innerWidth: width,
        innerHeight: height,
        scrollWidth: width + (overflow ? 1 : 0),
        scrollHeight: height + (readableScroll ? 240 : 0) + (tall ? 300 : 0),
        resolvedTheme: resolvedThemeAt?.({ width, height, theme }) || theme,
        ...(tall ? {
          pageComposition: {
            bodyPaddingPx: 12, headerPx: 40, guidedViewsPx: 60, diagramChromePx: 76,
            svgPx: 800, cardsPx: 212, viewBoxHeight: 1000,
          },
        } : {}),
        readerLayout: readableScroll ? 'adaptive' : null,
        readerOverflow: readableScroll ? 'authored' : null,
        readerFit: readableScroll ? 'intrinsic-height' : null,
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
      };
    },
    async capturePage({ screenshotPath }) {
      captureCalls.push({ screenshotPath });
      fs.writeFileSync(screenshotPath, png);
      return { width: 1600, height: 1200 };
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

test('visual-check keeps slow Chrome startup inside one bounded gate invocation', async () => {
  assert.equal(CHROME_STARTUP_TIMEOUT_MS, 90000);
  const input = artifact('chrome-startup-timeout.html');
  const child = fakeChromeChild();

  const result = await runBrowserCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => new ChromeVisualBrowser('/fake/chrome', {
      startupTimeoutMs: 5,
      spawnImpl: () => child,
    }),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.diagnostics[0]?.code, 'viewer/chrome-startup-timeout');
  assert.match(result.receipt.error, /Target\.getTargets: timed out after 5ms/);
  assert.match(result.receipt.error, /Chrome process: still running/);
  assert.match(
    result.receipt.diagnostics[0]?.supportedFixes?.join('\n') || '',
    /do not edit or simplify the artifact/,
  );
  assert.match(
    result.receipt.diagnostics[0]?.supportedFixes?.join('\n') || '',
    /retry browser-check once.*stop and report the environment failure/,
  );
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
    deliveryProvenance: { status: 'current', receiptId: 'delivery-receipt-123' },
    browserFactory: async () => browser,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.receipt.status, 'pass');
  assert.equal(result.receipt.evidenceKind, 'automated-browser');
  assert.equal(result.receipt.provenance, 'current');
  assert.equal(result.receipt.deliveryReceiptId, 'delivery-receipt-123');
  assert.deepEqual(result.receipt.diagnostics, []);
  assert.equal(result.receipt.visualReview, 'pending');
  assert.equal(result.receipt.themeStates.status, 'pass');
  assert.deepEqual(
    result.receipt.themeStates.viewports.map(({ width, height, requestedTheme, resolvedTheme, ok }) => (
      [width, height, requestedTheme, resolvedTheme, ok]
    )),
    [
      [1440, 900, 'light', 'light', true],
      [1440, 900, 'dark', 'dark', true],
      [2048, 1320, 'light', 'light', true],
      [2048, 1320, 'dark', 'dark', true],
    ],
  );
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
  assert.equal(JSON.parse(fs.readFileSync(outputs.receipt, 'utf8')).deliveryReceiptId, 'delivery-receipt-123');
  assert.equal(fs.existsSync(outputs.contactSheet), true);
  assert.equal(fs.existsSync(outputs.contactSheetImage), true);
  assert.equal(result.receipt.captures.contactSheetImage, path.basename(outputs.contactSheetImage));
  assert.deepEqual(result.receipt.captures.contactSheetImageSize, { width: 1600, height: 1200 });
  assert.equal(outputs.screenshots.every((entry) => fs.existsSync(entry.path)), true);
  const contactSheet = fs.readFileSync(outputs.contactSheet, 'utf8');
  assert.match(contactSheet, /Automated browser evidence/);
  assert.match(contactSheet, /perceptual visual review pending/);
  for (const screenshot of outputs.screenshots) {
    assert.match(contactSheet, new RegExp(path.basename(screenshot.path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(contactSheet, new RegExp(screenshot.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('browser-check proves rendered behavior without creating screenshots or requiring perceptual review', async () => {
  const input = artifact('browser-check-passing.html');
  const browser = fakeBrowser();
  const result = await runBrowserCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.receipt.command, 'browser-check');
  assert.equal(result.receipt.status, 'pass');
  assert.equal(result.receipt.visualReview, 'not-requested');
  assert.equal(result.receipt.themeStates.status, 'pass');
  assert.equal(result.receipt.themeStates.viewports.length, 4);
  assert.equal(result.receipt.captures.status, 'not-requested');
  assert.deepEqual(result.receipt.captures.screenshots, []);
  assert.equal(result.receipt.captures.contactSheet, null);
  assert.equal(result.receipt.captures.contactSheetImage, null);
  assert.equal(browser.calls.length, VISUAL_CHECK_VIEWPORTS.length + 2);
  assert.equal(browser.calls.every(({ screenshotPath }) => screenshotPath === undefined), true);
  assert.deepEqual(browser.captureCalls, []);

  const outputs = browserCheckSidecarPaths(input);
  assert.equal(fs.existsSync(outputs.receipt), true);
  assert.equal(fs.existsSync(outputs.contactSheet), false);
  assert.equal(fs.existsSync(outputs.contactSheetImage), false);
  assert.equal(outputs.screenshots.every(({ path: screenshot }) => !fs.existsSync(screenshot)), true);
  assert.deepEqual(result.receipt.sidecars, { receipt: path.basename(outputs.receipt) });
});

test('browser-check fails when an endpoint theme does not resolve without needing image inspection', async () => {
  const input = artifact('browser-check-theme-mismatch.html');
  const browser = fakeBrowser({
    resolvedThemeAt: ({ theme }) => theme === 'dark' ? 'light' : theme,
  });
  const result = await runBrowserCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.equal(result.receipt.themeStates.status, 'fail');
  assert.equal(result.receipt.themeStates.viewports.filter(({ ok }) => !ok).length, 2);
  assert.equal(result.receipt.diagnostics.filter(({ code }) => code === 'viewer/theme-state').length, 2);
  assert.equal(result.receipt.captures.status, 'not-requested');
  assert.deepEqual(browser.captureCalls, []);
});

test('sidecarPaths places outputs in outDir instead of beside the artifact', () => {
  const input = artifact('outdir-source.html');
  const separateDir = path.join(tmp, 'evidence-nested', 'deeper');
  assert.equal(fs.existsSync(separateDir), false, 'precondition: outDir must not exist yet');

  const outputs = sidecarPaths(input, { outDir: separateDir });

  assert.equal(fs.existsSync(separateDir), false, 'calculating paths must not create directories');
  assert.equal(path.dirname(outputs.receipt), separateDir);
  assert.equal(path.dirname(outputs.contactSheet), separateDir);
  assert.equal(path.dirname(outputs.contactSheetImage), separateDir);
  assert.equal(outputs.screenshots.every((entry) => path.dirname(entry.path) === separateDir), true);
  assert.equal(path.basename(outputs.receipt), 'outdir-source.visual-check.json');

  // Omitting outDir keeps the existing beside-the-artifact behavior unchanged.
  const defaultOutputs = sidecarPaths(input);
  assert.equal(path.dirname(defaultOutputs.receipt), path.dirname(input));
});

test('visual-check writes all sidecars into --out-dir end-to-end, none beside the artifact', async () => {
  const input = artifact('outdir-e2e.html');
  const outDir = path.join(tmp, 'outdir-e2e-evidence');
  const browser = fakeBrowser();
  const result = await runVisualCheck({
    artifactPath: input,
    outDir,
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.receipt.status, 'pass');

  const outputs = sidecarPaths(input, { outDir });
  assert.equal(result.receipt.sidecars.directory, outDir);
  assert.equal(fs.existsSync(path.join(result.receipt.sidecars.directory, result.receipt.sidecars.receipt)), true);
  assert.equal(fs.existsSync(path.join(result.receipt.sidecars.directory, result.receipt.captures.contactSheet)), true);
  assert.equal(fs.existsSync(outputs.receipt), true);
  assert.equal(fs.existsSync(outputs.contactSheet), true);
  assert.equal(fs.existsSync(outputs.contactSheetImage), true);
  assert.equal(outputs.screenshots.every((entry) => fs.existsSync(entry.path)), true);

  const besideArtifact = sidecarPaths(input);
  assert.equal(fs.existsSync(besideArtifact.receipt), false, 'no sidecar should land beside the artifact when outDir is set');
  assert.equal(fs.existsSync(besideArtifact.contactSheet), false);
  assert.equal(fs.existsSync(besideArtifact.contactSheetImage), false);
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

test('vertical overflow fixes state the stacked page budget and the actionable target', () => {
  const page = { bodyPaddingPx: 12, headerPx: 40, guidedViewsPx: 60, diagramChromePx: 76, svgPx: 800, cardsPx: 212, viewBoxHeight: 1000 };
  const base = { overflowY: true, innerHeight: 900, scrollHeight: 1200, diagramWidth: 930, pageComposition: page };

  const atMinimum = verticalBudgetFixes({ ...base, readerLayout: 'adaptive', readerOverflow: 'authored' });
  assert.match(atMinimum[0], /300px too tall/);
  assert.match(atMinimum[0], /12px body padding \+ 40px header \+ 60px guided views \+ 76px diagram chrome \+ 800px SVG \+ 212px cards = 1200px against 900px/);
  assert.match(atMinimum[0], /reduce the viewBox height to at most 625 \(from 1000\)/, 'SVG height follows viewBox height at the fixed minimum width: 1000 * 500 / 800');
  assert.equal(atMinimum.length, 1, 'cards (212px) cannot absorb a 300px excess, so no card alternative is offered');

  const fullWidth = verticalBudgetFixes({ ...base, readerLayout: null, readerOverflow: null });
  assert.match(fullWidth[0], /viewBox ratio is below 1\.55/);
  assert.match(fullWidth[0], /remove meta\.viewBox|1\.55x wider than tall/);

  const cardsAbsorb = verticalBudgetFixes({ ...base, scrollHeight: 1000, readerLayout: 'adaptive', readerOverflow: 'authored' });
  assert.match(cardsAbsorb[1], /cards take at most 112px/);

  assert.deepEqual(verticalBudgetFixes({ ...base, pageComposition: undefined }), [], 'old artifacts without composition metrics keep the generic fix');
  assert.deepEqual(verticalBudgetFixes({ ...base, overflowY: false }), []);
});

test('visual-check reports the page composition when a viewport overflows vertically', async () => {
  const input = artifact('tall-overflow.html');
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({ tallAt: ({ width }) => width === 1440 }),
  });

  assert.equal(result.exitCode, 1);
  const diagnostic = result.receipt.diagnostics.find((entry) => entry.code === 'viewer/viewport-overflow');
  assert.equal(diagnostic.evidence.pageComposition.svgPx, 800);
  assert.match(diagnostic.evidence.pageCompositionMeasurement, /sum to scrollHeight/);
  assert.match(diagnostic.supportedFixes[0], /300px too tall/);
  assert.equal(diagnostic.supportedFixes.some((fix) => /contain the rendered layout within/.test(fix)), false, 'the numeric budget replaces the generic instruction');
  const viewport = result.receipt.containment.viewports.find(({ width }) => width === 1440);
  assert.equal(viewport.pageComposition.cardsPx, 212);
});

test('visual-check accepts only Reader-declared readable vertical page scrolling', async () => {
  const input = artifact('readable-scroll.html');
  const target = ({ width, theme }) => width === 1440 && theme === 'light';
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({ readableScrollAt: target }),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.receipt.status, 'pass');
  assert.equal(result.receipt.containment.status, 'pass');
  assert.equal(result.receipt.containment.policy, 'fit-or-reader-declared-readable-vertical-scroll');
  const viewport = result.receipt.containment.viewports.find(({ width }) => width === 1440);
  assert.equal(viewport.overflowY, true);
  assert.equal(viewport.verticalScrollAccepted, true);
  assert.equal(viewport.overflowDisposition, 'readable-vertical-scroll');
  assert.equal(viewport.readerLayout, 'adaptive');
  assert.equal(viewport.readerOverflow, 'authored');
  assert.equal(viewport.readerFit, 'intrinsic-height');
  assert.equal(result.receipt.diagnostics.some(({ code }) => code === 'viewer/viewport-overflow'), false);
});

test('visual-check still rejects horizontal overflow and unreadable text in Reader scroll state', async () => {
  const input = artifact('invalid-readable-scroll.html');
  const target = ({ width, theme }) => width === 1440 && theme === 'light';
  const horizontal = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({ overflowAt: target, readableScrollAt: target }),
  });
  const horizontalViewport = horizontal.receipt.containment.viewports.find(({ width }) => width === 1440);
  assert.equal(horizontal.exitCode, 1);
  assert.equal(horizontalViewport.verticalScrollAccepted, false);
  assert.equal(horizontalViewport.overflowDisposition, 'unexpected-overflow');
  assert.ok(horizontal.receipt.diagnostics.some(({ code }) => code === 'viewer/viewport-overflow'));

  const unreadable = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser({ readableScrollAt: target, unreadableAt: target }),
  });
  const unreadableViewport = unreadable.receipt.containment.viewports.find(({ width }) => width === 1440);
  assert.equal(unreadable.exitCode, 1);
  assert.equal(unreadableViewport.verticalScrollAccepted, false);
  assert.equal(unreadableViewport.overflowDisposition, 'unexpected-overflow');
  assert.ok(unreadable.receipt.diagnostics.some(({ code }) => code === 'viewer/viewport-overflow'));
  assert.ok(unreadable.receipt.diagnostics.some(({ code }) => code === 'viewer/projected-text-readability'));
});

test('visual-check refuses changed delivery evidence before launching a browser', async () => {
  const input = artifact('changed-before-browser.html');
  const outDir = path.join(tmp, 'changed-before-browser-evidence');
  const outputs = sidecarPaths(input, { outDir });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outputs.contactSheet, 'old evidence');
  fs.writeFileSync(outputs.contactSheetImage, png);
  for (const entry of outputs.screenshots) fs.writeFileSync(entry.path, png);
  let launched = false;
  const result = await runVisualCheck({
    artifactPath: input,
    outDir,
    verifyArtifact: () => {
      const error = new Error('delivery changed');
      error.deliveryProvenance = { status: 'mismatch' };
      error.archifyDiagnostics = [{ code: 'delivery/provenance-mismatch' }];
      throw error;
    },
    browserFactory: async () => { launched = true; return fakeBrowser(); },
  });
  assert.equal(launched, false);
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.provenance, 'mismatch');
  assert.equal(result.receipt.sidecars.directory, outDir);
  assert.equal(JSON.parse(fs.readFileSync(outputs.receipt)).status, 'fail');
  assert.equal(fs.existsSync(outputs.contactSheet), false);
  assert.equal(fs.existsSync(outputs.contactSheetImage), false);
  assert.ok(outputs.screenshots.every((entry) => !fs.existsSync(entry.path)));
  assert.equal(fs.existsSync(sidecarPaths(input).receipt), false);
});

test('visual-check persists cleanup errors in its failure receipt', () => {
  const input = artifact('uncleanable-evidence.html');
  const outputs = sidecarPaths(input);
  fs.mkdirSync(outputs.screenshots[0].path);
  const receipt = persistVisualCheckFailure(input, {
    schemaVersion: 1, command: 'visual-check', artifact: { path: input },
    error: 'delivery failed', diagnostics: [{ code: 'delivery/provenance-failed' }],
  });
  const saved = JSON.parse(fs.readFileSync(outputs.receipt));
  assert.deepEqual(saved.diagnostics, receipt.diagnostics);
  assert.equal(saved.diagnostics[1].code, 'viewer/evidence-write');
  assert.equal(saved.diagnostics[1].evidence.errors[0].file, outputs.screenshots[0].path);
  assert.equal(saved.status, 'fail');
});

test('visual-check rechecks delivery evidence after capture and discards screenshots on failure', async () => {
  const input = artifact('changed-during-browser.html');
  let failedDelivery = false;
  const before = fs.readFileSync(input);
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    deliveryProvenance: { status: 'current', receiptId: 'previous-receipt' },
    verifyArtifact: (bytes) => {
      assert.deepEqual(bytes, before);
      if (failedDelivery) {
        const error = new Error('Another delivery failed during capture.');
        error.deliveryProvenance = { status: 'failed' };
        error.archifyDiagnostics = [{ code: 'delivery/provenance-failed' }];
        throw error;
      }
    },
    browserFactory: async () => { failedDelivery = true; return fakeBrowser(); },
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.provenance, 'failed');
  assert.equal(result.receipt.diagnostics[0].code, 'delivery/provenance-failed');
  const outputs = sidecarPaths(input);
  assert.equal(JSON.parse(fs.readFileSync(outputs.receipt)).status, 'fail');
  assert.equal(fs.existsSync(outputs.contactSheet), false);
  assert.equal(fs.existsSync(outputs.contactSheetImage), false);
  assert.ok(outputs.screenshots.every((entry) => !fs.existsSync(entry.path)));
});

test('visual-check records cleanup errors after post-capture provenance failure', async () => {
  const input = artifact('changed-with-uncleanable-browser-evidence.html');
  const outputs = sidecarPaths(input);
  let verificationCount = 0;
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    deliveryProvenance: { status: 'current', receiptId: 'previous-receipt' },
    verifyArtifact: () => {
      verificationCount += 1;
      if (verificationCount === 2) {
        fs.rmSync(outputs.screenshots[0].path);
        fs.mkdirSync(outputs.screenshots[0].path);
        const error = new Error('Another delivery failed during capture.');
        error.deliveryProvenance = { status: 'failed' };
        error.archifyDiagnostics = [{ code: 'delivery/provenance-failed' }];
        throw error;
      }
    },
    browserFactory: async () => fakeBrowser(),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.provenance, 'failed');
  assert.deepEqual(result.receipt.diagnostics.map((entry) => entry.code), [
    'delivery/provenance-failed',
    'viewer/evidence-write',
  ]);
  assert.equal(result.receipt.diagnostics[1].evidence.errors[0].file, outputs.screenshots[0].path);
  const saved = JSON.parse(fs.readFileSync(outputs.receipt));
  assert.deepEqual(saved.diagnostics, result.receipt.diagnostics);
  assert.equal(saved.status, 'fail');
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
  fs.writeFileSync(outputs.contactSheetImage, png);
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
  assert.equal(fs.existsSync(outputs.contactSheetImage), false);
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
  assert.equal(result.receipt.diagnostics[0]?.code, 'viewer/chrome-unavailable');
  assert.ok(result.receipt.diagnostics[0]?.supportedFixes.some((fix) => fix.includes('ARCHIFY_CHROME')));
  assert.equal(fs.existsSync(sidecarPaths(input).receipt), true);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

test('vertical workflow overflow reports measured frames and conditional reflow guidance without changing the artifact', async () => {
  const file = artifact('workflow-overflow.html');
  const before = sha256(file);
  const browser = fakeBrowser();
  const inspect = browser.inspect.bind(browser);
  const lanes = [{ frameId: 'lane-0', heightPx: 720, nodeCount: 12, nodeIds: ['wait', 'cancel'], nodeSpanPx: 480, spaceAboveNodesPx: 180, spaceBelowNodesPx: 60 }];
  browser.inspect = async (args) => ({ ...(await inspect(args)), scrollHeight: args.height + 599, workflowLanes: lanes });
  const result = await runVisualCheck({ artifactPath: file, chromePath: '/fake/chrome', browserFactory: async () => browser });
  assert.equal(result.exitCode, 1);
  const diagnostic = result.receipt.diagnostics.find(({ code }) => code === 'viewer/viewport-overflow');
  assert.deepEqual(diagnostic.evidence.workflowLanes, lanes);
  assert.match(diagnostic.evidence.measurement, /not guaranteed removable/);
  assert.match(diagnostic.supportedFixes.join('\n'), /--layout-json/);
  assert.match(diagnostic.supportedFixes.join('\n'), /ownership and explicit geometry permit/);
  assert.match(diagnostic.supportedFixes.join('\n'), /not a verified coordinate fix/);
  assert.equal(sha256(file), before);
  browser.inspect = async (args) => ({ ...(await inspect(args)), scrollWidth: args.width + 1, workflowLanes: lanes });
  const horizontal = await runVisualCheck({ artifactPath: file, chromePath: '/fake/chrome', browserFactory: async () => browser });
  const horizontalOverflow = horizontal.receipt.diagnostics.find(({ code }) => code === 'viewer/viewport-overflow');
  assert.equal(horizontalOverflow.evidence.workflowLanes, undefined);
  assert.equal(horizontalOverflow.supportedFixes.length, 1);
});
