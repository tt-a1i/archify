import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ChromeVisualBrowser,
  VISUAL_CHECK_VIEWPORTS,
  chromeVisualBrowserArgs,
  findChrome,
  persistVisualCheckFailure,
  runVisualCheck,
  sidecarPaths,
} from '../bin/visual-check.mjs';
import { sameLocation } from '../renderers/shared/path-semantics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-check-'));
const png = Buffer.from('89504e470d0a1a0a', 'hex');

test('invalid Atlas preserves unowned stale evidence before attempting Chrome', () => {
  for (const payload of ['{broken', JSON.stringify({ bundle_version: 1 })]) {
    const input = artifact('invalid-atlas.html');
    const outputs = sidecarPaths(input);
    fs.writeFileSync(input, `<script id="archify-atlas-data" type="application/json">${payload}</script>`);
    const memberCapture = `${outputs.base}.previous.1440x900.light.png`;
    const unrelated = `${outputs.base}.keep.png`;
    fs.writeFileSync(outputs.receipt, JSON.stringify({ status: 'pass' }));
    fs.writeFileSync(outputs.contactSheet, 'old passing evidence');
    fs.writeFileSync(memberCapture, png);
    fs.writeFileSync(unrelated, 'unrelated');
    const result = spawnSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'visual-check', input, '--json'], {
      encoding: 'utf8', env: { ...process.env, ARCHIFY_CHROME: '/nonexistent/chrome' },
    });
    assert.equal(result.status, 1);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.status, 'fail');
    assert.equal(receipt.artifact.sha256, sha256(input));
    assert.equal(receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict');
    assert.deepEqual(JSON.parse(fs.readFileSync(outputs.receipt, 'utf8')), { status: 'pass' });
    assert.equal(fs.existsSync(memberCapture), true);
    assert.equal(fs.existsSync(outputs.contactSheet), true);
    assert.equal(fs.readFileSync(unrelated, 'utf8'), 'unrelated');
  }
});

function artifact(name = 'diagram.html') {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, '<!doctype html><html><body>checked artifact</body></html>');
  return file;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function entryIdentity(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  return { device: stat.dev, inode: stat.ino, mode: stat.mode };
}

function stagingDirectories(directory) {
  return fs.readdirSync(directory).filter((name) => name.startsWith('.archify-visual-check-'));
}

function fakeBrowser({ overflowAt, unreadableAt, chromeCollisionAt, stageCollisionAt, stageGapAt, screenshotFailure } = {}) {
  const calls = [];
  return {
    calls,
    async inspect({ width, height, theme, screenshotPath, writeScreenshot }) {
      calls.push({ width, height, theme, screenshotPath });
      if (screenshotPath && screenshotFailure?.({ width, height, theme })) {
        throw new Error('synthetic screenshot failure');
      }
      if (screenshotPath) {
        if (writeScreenshot) writeScreenshot(png);
        else fs.writeFileSync(screenshotPath, png, { flag: 'wx' });
      }
      const overflow = overflowAt?.({ width, height, theme }) || false;
      const unreadable = unreadableAt?.({ width, height, theme }) || false;
      const chromeCollision = chromeCollisionAt?.({ width, height, theme }) || false;
      const stageCollision = stageCollisionAt?.({ width, height, theme }) || false;
      const dockStageGap = stageGapAt?.({ width, height, theme }) ?? (stageCollision ? -12 : 10);
      const stageClearanceFailure = stageCollision || dockStageGap < 10;
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
        dockStageIntersectionArea: stageCollision ? 84 : 0,
        dockStageGap,
        viewerChromeRequiredGap: 10,
        viewerChromeReserve: chromeCollision || stageClearanceFailure ? 0 : 44,
        viewerChromeActive: !chromeCollision && !stageClearanceFailure,
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

test('visual-check closes its owned pipes even when Chrome exits before inherited streams close', async () => {
  for (const exited of [false, true]) {
    const child = fakeChromeChild();
    const browser = new ChromeVisualBrowser('/fake/chrome', { spawnImpl: () => child });
    const startup = browser.sessionPromise.catch(() => {});
    if (exited) child.exitCode = 0;
    await browser.close(); await startup;
    assert.ok(child.stdio.filter(Boolean).every(stream => stream.destroyed), 'Browser-owned pipes must not keep the caller alive');
    assert.equal(browser.cdp.pending.size, 0);
  }
});

test('findChrome discovers chrome.exe from a Windows PATH after default locations', () => {
  const checked = [];
  const expected = String.raw`D:\Browser Bin\chrome.EXE`;
  const resolved = findChrome({
    platform: 'win32',
    env: {
      PROGRAMFILES: String.raw`C:\Program Files`,
      PATH: String.raw`C:\Tools;D:\Browser Bin`,
      PATHEXT: '.EXE;.CMD',
    },
    resolveExecutable(candidate) {
      checked.push(candidate);
      return candidate === expected ? candidate : null;
    },
  });

  assert.equal(resolved, expected);
  assert.deepEqual(checked.slice(0, 2), [
    String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`,
    String.raw`C:\Program Files\Chromium\Application\chrome.exe`,
  ]);
  assert.ok(
    checked.indexOf(String.raw`C:\Program Files\Chromium\Application\chrome.exe`)
      < checked.indexOf(String.raw`C:\Tools\chrome.EXE`),
    'default install locations must be checked before PATH',
  );
});

test('findChrome keeps an installed Windows Chrome ahead of PATH candidates', () => {
  const checked = [];
  const installed = String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;
  const portable = String.raw`D:\Browser Bin\chrome.EXE`;
  const resolved = findChrome({
    platform: 'win32',
    env: {
      PROGRAMFILES: String.raw`C:\Program Files`,
      PATH: String.raw`D:\Browser Bin`,
      PATHEXT: '.EXE',
    },
    resolveExecutable(candidate) {
      checked.push(candidate);
      return candidate === installed || candidate === portable ? candidate : null;
    },
  });

  assert.equal(resolved, installed);
  assert.deepEqual(checked, [installed]);
});

test('findChrome checks Chromium command names on a Windows PATH', () => {
  const checked = [];
  const expected = String.raw`D:\Browser Bin\chromium.EXE`;
  const resolved = findChrome({
    platform: 'win32',
    env: {
      PATH: String.raw`D:\Browser Bin`,
      PATHEXT: '.EXE',
    },
    resolveExecutable(candidate) {
      checked.push(candidate);
      return candidate === expected ? candidate : null;
    },
  });

  assert.equal(resolved, expected);
  assert.deepEqual(checked, [
    String.raw`D:\Browser Bin\chrome.EXE`,
    String.raw`D:\Browser Bin\google-chrome.EXE`,
    String.raw`D:\Browser Bin\google-chrome-stable.EXE`,
    expected,
  ]);
});

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
  assert.equal(outputs.screenshots.every((entry) => fs.existsSync(entry.path)), true);
  const contactSheet = fs.readFileSync(outputs.contactSheet, 'utf8');
  assert.match(contactSheet, /Automated browser evidence/);
  assert.match(contactSheet, /perceptual visual review pending/);
  for (const screenshot of outputs.screenshots) {
    assert.match(contactSheet, new RegExp(path.basename(screenshot.path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(contactSheet, new RegExp(screenshot.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('visual-check inspects a private snapshot even if the public artifact is replaced and restored', async () => {
  const input = artifact('private-inspection-snapshot.html');
  const original = fs.readFileSync(input);
  const displaced = path.join(tmp, 'private-inspection-original.html');
  const replacement = Buffer.from('<!doctype html><title>replacement must not be inspected</title>');
  const browser = fakeBrowser();
  const inspect = browser.inspect.bind(browser);
  const inspectedPaths = [];
  let calls = 0;
  browser.inspect = async (args) => {
    inspectedPaths.push(path.resolve(args.artifactPath));
    assert.deepEqual(fs.readFileSync(args.artifactPath), original);
    calls += 1;
    if (calls === 1) {
      fs.renameSync(input, displaced);
      fs.writeFileSync(input, replacement, { flag: 'wx' });
    }
    if (calls === 6) {
      fs.unlinkSync(input);
      fs.renameSync(displaced, input);
    }
    return inspect(args);
  };

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  assert.equal(result.exitCode, 0, JSON.stringify(result.receipt.diagnostics));
  assert.equal(inspectedPaths.length, 6);
  assert.equal(inspectedPaths.every((candidate) => candidate !== path.resolve(input)), true);
  assert.deepEqual(fs.readFileSync(input), original);
});

for (const browserFailure of [false, true]) {
  test(`visual-check uses and retires a short local snapshot with long evidence paths${browserFailure ? ' after a browser failure' : ''}`, async (t) => {
    const input = artifact(`local-inspection-${browserFailure}.html`);
    const original = fs.readFileSync(input);
    const originalDigest = sha256(input);
    const root = fs.mkdtempSync(path.join(tmp, 'long-evidence-'));
    const outDir = path.join(root, ...Array.from({ length: 5 }, (_, index) => `${index}-${'long'.repeat(16)}`));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const browser = fakeBrowser();
    const inspect = browser.inspect.bind(browser);
    let inspectionPath;
    browser.inspect = async (args) => {
      inspectionPath = args.artifactPath;
      const inspectionParent = path.dirname(path.dirname(inspectionPath));
      assert.equal(sameLocation(inspectionParent, os.tmpdir()).status, 'match');
      assert.ok(inspectionPath.length < outDir.length);
      assert.deepEqual(fs.readFileSync(inspectionPath), original);
      assert.equal(sha256(inspectionPath), originalDigest);
      if (args.screenshotPath) {
        assert.equal(sameLocation(path.dirname(path.dirname(args.screenshotPath)), outDir).status, 'match');
      }
      if (browserFailure) throw new Error('synthetic local snapshot browser failure');
      return inspect(args);
    };

    const result = await runVisualCheck({
      artifactPath: input,
      outDir,
      chromePath: '/fake/chrome',
      browserFactory: async () => browser,
    });

    assert.equal(result.exitCode, browserFailure ? 1 : 0, JSON.stringify(result.receipt.diagnostics));
    assert.ok(inspectionPath);
    assert.equal(fs.existsSync(inspectionPath), false);
    assert.equal(fs.existsSync(path.dirname(inspectionPath)), false);
    assert.deepEqual(stagingDirectories(outDir), []);
    assert.equal(fs.existsSync(sidecarPaths(input, { outDir }).receipt), true);
    if (browserFailure) assert.match(result.receipt.error, /synthetic local snapshot browser failure/);
  });
}

test('visual-check retains and reports a local inspection directory that cannot be removed', async (t) => {
  const input = artifact('local-inspection-rmdir-failure.html');
  const browser = fakeBrowser();
  const inspect = browser.inspect.bind(browser);
  const rmdirSync = fs.rmdirSync.bind(fs);
  let inspectionDirectory;
  browser.inspect = async (args) => {
    inspectionDirectory = path.dirname(args.artifactPath);
    return inspect(args);
  };
  t.mock.method(fs, 'rmdirSync', (directory, ...args) => {
    if (String(directory) === inspectionDirectory) {
      throw Object.assign(new Error('synthetic local inspection directory removal failure'), { code: 'EACCES' });
    }
    return rmdirSync(directory, ...args);
  });
  t.after(() => {
    t.mock.restoreAll();
    if (inspectionDirectory) fs.rmSync(inspectionDirectory, { recursive: true, force: true });
  });

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  assert.equal(result.exitCode, 1);
  assert.equal(sameLocation(path.dirname(inspectionDirectory), os.tmpdir()).status, 'match');
  assert.equal(result.receipt.publication?.status, 'committed-with-warning');
  assert.equal(result.receipt.publication?.recoveryDirectory, inspectionDirectory);
  assert.ok(result.receipt.publication.cleanupErrors.some((entry) => entry.file === inspectionDirectory));
  assert.deepEqual(fs.readdirSync(inspectionDirectory), []);
});

test('visual-check reports the retained local snapshot directory when its identity is unavailable', async (t) => {
  const input = artifact('local-inspection-unknown-identity.html');
  const lstatSync = fs.lstatSync.bind(fs);
  let inspectionDirectory;
  let browserStarted = false;
  t.mock.method(fs, 'lstatSync', (file, ...args) => {
    const stat = lstatSync(file, ...args);
    if (!inspectionDirectory && path.basename(String(file)).startsWith('archify-inspection-')) {
      inspectionDirectory = String(file);
      stat.ino = 0n;
    }
    return stat;
  });
  t.after(() => {
    if (inspectionDirectory) fs.rmSync(inspectionDirectory, { recursive: true, force: true });
  });

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => {
      browserStarted = true;
      return fakeBrowser();
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(browserStarted, false);
  assert.equal(result.receipt.diagnostics[0]?.code, 'viewer/artifact-snapshot');
  assert.ok(result.receipt.diagnostics.at(-1)?.evidence?.errors.some(
    (entry) => entry.file === inspectionDirectory && entry.recoveryDirectory === inspectionDirectory,
  ));
  assert.deepEqual(fs.readdirSync(inspectionDirectory), []);
});

for (const claimantFile of [false, true]) {
  test(`visual-check preserves a replacement local snapshot directory${claimantFile ? ' containing a file' : ' that is empty'} and reports its location`, async (t) => {
    const input = artifact(`local-inspection-directory-claimant-${claimantFile}.html`);
    const sentinel = 'external local snapshot directory claimant\n';
    let inspectionDirectory;
    let detached;
    let claimantPath;
    t.after(() => {
      if (inspectionDirectory) fs.rmSync(inspectionDirectory, { recursive: true, force: true });
      if (detached) fs.rmSync(detached, { recursive: true, force: true });
    });
    const result = await runVisualCheck({
      artifactPath: input,
      chromePath: '/fake/chrome',
      browserFactory: async () => ({
        async inspect({ artifactPath }) {
          inspectionDirectory = path.dirname(artifactPath);
          detached = `${inspectionDirectory}-detached`;
          fs.renameSync(inspectionDirectory, detached);
          fs.mkdirSync(inspectionDirectory);
          claimantPath = path.join(inspectionDirectory, 'artifact-snapshot.html');
          if (claimantFile) fs.writeFileSync(claimantPath, sentinel, { flag: 'wx' });
          throw new Error('synthetic browser failure after directory replacement');
        },
        async close() {},
      }),
    });

    assert.equal(result.exitCode, 1);
    assert.equal(sameLocation(path.dirname(inspectionDirectory), os.tmpdir()).status, 'match');
    if (claimantFile) assert.equal(fs.readFileSync(claimantPath, 'utf8'), sentinel);
    else assert.deepEqual(fs.readdirSync(inspectionDirectory), []);
    const errors = result.receipt.diagnostics.at(-1)?.evidence?.errors;
    assert.ok(errors.some((entry) => entry.file === inspectionDirectory
      && entry.recoveryDirectory === inspectionDirectory
      && /identity changed; it was preserved/.test(entry.reason)));
    assert.equal(fs.existsSync(path.join(detached, 'artifact-snapshot.html')), true);
  });
}

for (const scenario of [
  { name: 'a regular screenshot claimant swapped before registration', replace: true },
  { name: 'screenshot bytes changed after capture without an identity change', replace: false },
]) {
  test(`visual-check preserves ${scenario.name}`, async (t) => {
    const input = artifact(`staged-screenshot-regular-claimant-${scenario.replace}.html`);
    const outputs = sidecarPaths(input);
    const browser = fakeBrowser();
    const inspect = browser.inspect.bind(browser);
    const sentinel = Buffer.from('external regular screenshot claimant\n');
    const stagingBefore = new Set(stagingDirectories(path.dirname(outputs.receipt)));
    let claimantPath;
    browser.inspect = async (args) => {
      const metrics = await inspect(args);
      if (!claimantPath && args.screenshotPath) {
        claimantPath = args.screenshotPath;
        const before = entryIdentity(claimantPath);
        if (scenario.replace) fs.unlinkSync(claimantPath);
        fs.writeFileSync(claimantPath, sentinel, { flag: scenario.replace ? 'wx' : 'w' });
        if (!scenario.replace) assert.deepEqual(entryIdentity(claimantPath), before);
      }
      return metrics;
    };
    t.after(() => {
      for (const directory of stagingDirectories(path.dirname(outputs.receipt))) {
        if (!stagingBefore.has(directory)) {
          fs.rmSync(path.join(path.dirname(outputs.receipt), directory), { recursive: true, force: true });
        }
      }
    });

    const result = await runVisualCheck({
      artifactPath: input,
      chromePath: '/fake/chrome',
      browserFactory: async () => browser,
    });

    assert.equal(result.exitCode, 1);
    assert.deepEqual(fs.readFileSync(claimantPath), sentinel);
    assert.equal(fs.existsSync(outputs.receipt), false);
    const cleanupErrors = result.receipt.diagnostics.at(-1)?.evidence?.errors;
    assert.ok(cleanupErrors.some((entry) => entry.file === claimantPath && /preserved/.test(entry.reason)));
  });
}

test('visual-check cleanup preserves a successor swapped at its final removal boundary', async (t) => {
  const input = artifact('staged-cleanup-successor.html');
  const outputs = sidecarPaths(input);
  const detached = path.join(tmp, 'detached-owned-artifact-snapshot.html');
  const successor = Buffer.from('external artifact snapshot cleanup successor\n');
  const unlinkSync = fs.unlinkSync.bind(fs);
  const renameSync = fs.renameSync.bind(fs);
  let stagedPath;
  let injected = false;
  const inject = (source) => {
    injected = true;
    stagedPath = String(source);
    renameSync(stagedPath, detached);
    fs.writeFileSync(stagedPath, successor, { flag: 'wx' });
  };
  t.mock.method(fs, 'unlinkSync', (file) => {
    if (!injected && path.basename(String(file)) === 'artifact-snapshot.html') inject(file);
    return unlinkSync(file);
  });
  t.mock.method(fs, 'renameSync', (source, destination) => {
    if (!injected
      && path.basename(String(source)) === 'artifact-snapshot.html'
      && path.basename(path.dirname(String(destination))).startsWith('.archify-remove-')) {
      inject(source);
    }
    return renameSync(source, destination);
  });
  t.after(() => {
    fs.rmSync(detached, { force: true });
    if (stagedPath) fs.rmSync(path.dirname(stagedPath), { recursive: true, force: true });
    for (const directory of stagingDirectories(path.dirname(outputs.receipt))) {
      fs.rmSync(path.join(path.dirname(outputs.receipt), directory), { recursive: true, force: true });
    }
  });

  const result = await runVisualCheck({
    artifactPath: input,
    verifyArtifact() {
      throw new Error('synthetic failure after private snapshot staging');
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(injected, true);
  assert.equal(fs.existsSync(stagedPath), true);
  assert.deepEqual(fs.readFileSync(stagedPath), successor);
  assert.equal(fs.existsSync(detached), true);
});

test('sidecarPaths places outputs in outDir instead of beside the artifact', () => {
  const input = artifact('outdir-source.html');
  const separateDir = path.join(tmp, 'evidence-nested', 'deeper');
  assert.equal(fs.existsSync(separateDir), false, 'precondition: outDir must not exist yet');

  const outputs = sidecarPaths(input, { outDir: separateDir });

  assert.equal(fs.existsSync(separateDir), false, 'calculating paths must not create directories');
  assert.equal(path.dirname(outputs.receipt), separateDir);
  assert.equal(path.dirname(outputs.contactSheet), separateDir);
  assert.equal(outputs.screenshots.every((entry) => path.dirname(entry.path) === separateDir), true);
  assert.equal(path.basename(outputs.receipt), 'outdir-source.visual-check.json');

  // Omitting outDir keeps evidence beside the physical artifact.
  const defaultOutputs = sidecarPaths(input);
  assert.equal(path.dirname(defaultOutputs.receipt), path.dirname(fs.realpathSync.native(input)));
});

test('sidecarPaths keeps source-distinct case and Unicode names distinct under target semantics', (t) => {
  const sourceDir = path.join(tmp, 'semantic-source-directory');
  const outDir = path.join(tmp, 'semantic-target-directory');
  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const artifactNames = ['Report.html', 'report.html', 'Caf\u00e9.html', 'Cafe\u0301.html'];
  const artifacts = artifactNames.map((name) => path.join(sourceDir, name));

  const targetSemanticKey = (name) => name
    .normalize('NFC')
    .toLocaleUpperCase('en-US')
    .toLocaleLowerCase('en-US')
    .normalize('NFC');
  const simulatedEntries = new Map();
  const originalOpen = fs.openSync;
  const originalStat = fs.statSync;
  const originalRealpath = fs.realpathSync.native;
  const sourcePhysical = originalRealpath(sourceDir);
  const outPhysical = originalRealpath(outDir);
  const sourceProbes = new Set();
  fs.openSync = function simulateTargetSemantics(file, ...args) {
    const descriptor = originalOpen.call(this, file, ...args);
    if (path.basename(String(file)).startsWith('.archify-path-semantics-')) {
      if (path.dirname(String(file)) === outPhysical) {
        simulatedEntries.set(targetSemanticKey(path.basename(String(file))), String(file));
      } else if (path.dirname(String(file)) === sourcePhysical) {
        sourceProbes.add(String(file));
      }
    }
    return descriptor;
  };
  fs.statSync = function resolveSimulatedAlias(file, ...args) {
    if (path.dirname(String(file)) === sourcePhysical
      && path.basename(String(file)).startsWith('.archify-path-semantics-')
      && !sourceProbes.has(String(file))) {
      const error = new Error('simulated case- and normalization-sensitive lookup');
      error.code = 'ENOENT';
      throw error;
    }
    const alias = path.dirname(String(file)) === outPhysical
      ? simulatedEntries.get(targetSemanticKey(path.basename(String(file))))
      : undefined;
    return originalStat.call(this, alias || file, ...args);
  };
  fs.realpathSync.native = function resolveSimulatedAlias(file, ...args) {
    if (path.dirname(String(file)) === sourceDir
      && !path.basename(String(file)).startsWith('.archify-path-semantics-')) {
      return path.join(sourcePhysical, path.basename(String(file)));
    }
    const alias = path.dirname(String(file)) === outPhysical
      ? simulatedEntries.get(targetSemanticKey(path.basename(String(file))))
      : undefined;
    return originalRealpath.call(this, alias || file, ...args);
  };
  t.after(() => {
    fs.openSync = originalOpen;
    fs.statSync = originalStat;
    fs.realpathSync.native = originalRealpath;
  });

  const calculateOutputs = () => artifacts.map((file) => {
    fs.writeFileSync(file, '<!doctype html>', { flag: 'wx' });
    try {
      return sidecarPaths(file, { outDir });
    } finally {
      fs.unlinkSync(file);
    }
  });
  const outputs = calculateOutputs();
  const outputNames = outputs.map(({ receipt }) => path.basename(receipt));
  assert.notEqual(
    targetSemanticKey(outputNames[0]),
    targetSemanticKey(outputNames[1]),
    `case-distinct source artifacts must not claim one case-insensitive target name: ${outputNames.join(', ')}`,
  );
  assert.notEqual(
    targetSemanticKey(outputNames[2]),
    targetSemanticKey(outputNames[3]),
    'normalization-distinct source artifacts must not claim one normalization-insensitive target name',
  );
  assert.deepEqual(
    calculateOutputs().map(({ receipt }) => receipt),
    outputs.map(({ receipt }) => receipt),
    'the namespace must be deterministic',
  );
  const futureOutDir = path.join(tmp, 'future-semantic-target-directory');
  fs.writeFileSync(artifacts[0], '<!doctype html>', { flag: 'wx' });
  try {
    const beforeCreation = sidecarPaths(artifacts[0], { outDir: futureOutDir });
    fs.mkdirSync(futureOutDir);
    const afterCreation = sidecarPaths(artifacts[0], { outDir: futureOutDir });
    assert.deepEqual(afterCreation, beforeCreation, 'creating --out-dir must not rename its sidecars');
  } finally {
    fs.unlinkSync(artifacts[0]);
  }
  for (const [{ receipt }, file] of outputs.map((entry, index) => [entry, artifacts[index]])) {
    assert.match(path.basename(receipt), new RegExp(`^${path.basename(file, '.html')}.*\\.visual-check\\.json$`, 'u'));
    assert.ok(Buffer.byteLength(path.basename(receipt), 'utf8') <= 255);
  }
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
  assert.equal(outputs.screenshots.every((entry) => fs.existsSync(entry.path)), true);

  const besideArtifact = sidecarPaths(input);
  assert.equal(fs.existsSync(besideArtifact.receipt), false, 'no sidecar should land beside the artifact when outDir is set');
  assert.equal(fs.existsSync(besideArtifact.contactSheet), false);
});

test('visual-check sidecar directory identity treats a physical alias as redundant', async (t) => {
  const physicalDirectory = path.join(tmp, 'physical-sidecar-directory');
  const aliasDirectory = path.join(tmp, 'aliased-sidecar-directory');
  fs.mkdirSync(physicalDirectory, { recursive: true });
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

  const input = path.join(physicalDirectory, 'aliased-sidecars.html');
  fs.writeFileSync(input, '<!doctype html><html><body>aliased evidence</body></html>');
  const outputs = sidecarPaths(input, { outDir: aliasDirectory });
  assert.notEqual(path.dirname(outputs.receipt), path.dirname(input), 'precondition: spellings differ');

  const result = await runVisualCheck({
    artifactPath: input,
    outDir: aliasDirectory,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });
  assert.equal(result.exitCode, 0);
  assert.equal('directory' in result.receipt.sidecars, false);

  const failure = persistVisualCheckFailure(input, {
    schemaVersion: 1,
    command: 'visual-check',
    artifact: { path: input },
    error: 'synthetic delivery failure',
    diagnostics: [{ code: 'delivery/provenance-failed' }],
  }, { outDir: aliasDirectory });
  assert.equal('directory' in failure.sidecars, false);
});

test('visual-check preserves unowned receipt, contact-sheet, and screenshot path collisions', async () => {
  const cases = [
    { name: 'receipt', select: (outputs) => outputs.receipt, bytes: Buffer.from('{"foreign":true}\n') },
    { name: 'contact-sheet', select: (outputs) => outputs.contactSheet, bytes: Buffer.from('<!doctype html><title>real artifact</title>\n') },
    { name: 'screenshot', select: (outputs) => outputs.screenshots[0].path, bytes: Buffer.from('foreign png bytes\n') },
  ];

  for (const scenario of cases) {
    const input = artifact(`unowned-${scenario.name}.html`);
    const outputs = sidecarPaths(input);
    const collision = scenario.select(outputs);
    fs.writeFileSync(collision, scenario.bytes);
    let launched = false;

    const result = await runVisualCheck({
      artifactPath: input,
      chromePath: '/fake/chrome',
      browserFactory: async () => {
        launched = true;
        return fakeBrowser();
      },
    });

    assert.equal(result.exitCode, 1, scenario.name);
    assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict', scenario.name);
    assert.equal(launched, false, scenario.name);
    assert.deepEqual(fs.readFileSync(collision), scenario.bytes, scenario.name);
  }

  const input = artifact('unowned-persist-failure.html');
  const outputs = sidecarPaths(input);
  const sentinel = Buffer.from('<!doctype html><title>real artifact</title>\n');
  fs.writeFileSync(outputs.contactSheet, sentinel);
  const receipt = persistVisualCheckFailure(input, {
    schemaVersion: 1,
    command: 'visual-check',
    artifact: { path: input, sha256: sha256(input), bytes: fs.statSync(input).size },
    error: 'synthetic delivery failure',
    diagnostics: [{ code: 'delivery/provenance-failed' }],
  });
  assert.equal(receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict');
  assert.deepEqual(fs.readFileSync(outputs.contactSheet), sentinel);
  assert.equal(fs.existsSync(outputs.receipt), false);
});

test('visual-check preserves receipt, contact-sheet, and PNG claimants created after preflight', async () => {
  const cases = [
    { name: 'receipt', select: (outputs) => outputs.receipt, noChrome: true },
    { name: 'contact-sheet', select: (outputs) => outputs.contactSheet },
    { name: 'screenshot', select: (outputs) => outputs.screenshots[0].path },
  ];

  for (const scenario of cases) {
    const input = artifact(`late-${scenario.name}-claimant.html`);
    const outDir = path.join(tmp, `late-${scenario.name}-evidence`);
    const outputs = sidecarPaths(input, { outDir });
    const claimant = scenario.select(outputs);
    const sentinel = Buffer.from(`late ${scenario.name} claimant\n`);
    let claimed = false;
    const claim = () => {
      if (claimed) return;
      claimed = true;
      fs.writeFileSync(claimant, sentinel, { flag: 'wx' });
    };
    const browser = fakeBrowser();
    const inspect = browser.inspect.bind(browser);
    browser.inspect = async (args) => {
      const metrics = await inspect(args);
      claim();
      return metrics;
    };

    const result = await runVisualCheck({
      artifactPath: input,
      outDir,
      ...(scenario.noChrome
        ? { resolveChrome: () => { claim(); return null; } }
        : { chromePath: '/fake/chrome', browserFactory: async () => browser }),
    });

    assert.equal(result.exitCode, 1, scenario.name);
    assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict', scenario.name);
    assert.deepEqual(fs.readFileSync(claimant), sentinel, scenario.name);
    assert.deepEqual(stagingDirectories(outDir), [], scenario.name);
    for (const target of [outputs.receipt, outputs.contactSheet, ...outputs.screenshots.map((entry) => entry.path)]) {
      if (target !== claimant) assert.equal(fs.existsSync(target), false, `${scenario.name}: ${target}`);
    }
  }
});

test('visual-check preserves receipt, contact-sheet, and PNG replacements made after preflight', async () => {
  const cases = [
    { name: 'receipt', select: (outputs) => outputs.receipt, noChrome: true },
    { name: 'contact-sheet', select: (outputs) => outputs.contactSheet },
    { name: 'screenshot', select: (outputs) => outputs.screenshots[0].path },
  ];

  for (const scenario of cases) {
    const input = artifact(`late-${scenario.name}-replacement.html`);
    const outputs = sidecarPaths(input);
    const first = await runVisualCheck({
      artifactPath: input,
      chromePath: '/fake/chrome',
      browserFactory: async () => fakeBrowser(),
    });
    assert.equal(first.exitCode, 0, `${scenario.name}: initial evidence`);
    const targets = [outputs.receipt, outputs.contactSheet, ...outputs.screenshots.map((entry) => entry.path)];
    const before = new Map(targets.map((target) => [target, fs.readFileSync(target)]));
    const replaced = scenario.select(outputs);
    const sentinel = Buffer.from(`replacement ${scenario.name}\n`);
    let replacementIdentity;
    let injected = false;
    const replace = () => {
      if (injected) return;
      injected = true;
      fs.unlinkSync(replaced);
      fs.writeFileSync(replaced, sentinel, { flag: 'wx' });
      replacementIdentity = entryIdentity(replaced);
    };
    const browser = fakeBrowser();
    const inspect = browser.inspect.bind(browser);
    browser.inspect = async (args) => {
      const metrics = await inspect(args);
      replace();
      return metrics;
    };

    const result = await runVisualCheck({
      artifactPath: input,
      ...(scenario.noChrome
        ? { resolveChrome: () => { replace(); return null; } }
        : { chromePath: '/fake/chrome', browserFactory: async () => browser }),
    });

    assert.equal(result.exitCode, 1, scenario.name);
    assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict', scenario.name);
    assert.deepEqual(fs.readFileSync(replaced), sentinel, scenario.name);
    assert.deepEqual(entryIdentity(replaced), replacementIdentity, scenario.name);
    for (const target of targets) {
      if (target !== replaced) assert.deepEqual(fs.readFileSync(target), before.get(target), `${scenario.name}: ${target}`);
    }
    assert.deepEqual(stagingDirectories(path.dirname(outputs.receipt)), [], scenario.name);
  }
});

test('visual-check preserves a regular successor swapped at the backup link boundary', async (t) => {
  const input = artifact('backup-link-regular-successor.html');
  const outputs = sidecarPaths(input);
  const first = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });
  assert.equal(first.exitCode, 0);

  const displaced = path.join(tmp, 'backup-link-regular-displaced.json');
  const successor = Buffer.from('external regular successor at backup boundary\n');
  const stagingBefore = new Set(stagingDirectories(path.dirname(outputs.receipt)));
  const linkSync = fs.linkSync.bind(fs);
  const renameSync = fs.renameSync.bind(fs);
  let injected = false;
  let successorIdentity;
  t.after(() => {
    fs.rmSync(displaced, { force: true });
    for (const directory of stagingDirectories(path.dirname(outputs.receipt))) {
      if (!stagingBefore.has(directory)) {
        fs.rmSync(path.join(path.dirname(outputs.receipt), directory), { recursive: true, force: true });
      }
    }
  });
  t.mock.method(fs, 'linkSync', (source, target) => {
    const sourcePath = String(source);
    const targetPath = String(target);
    if (!injected
      && path.basename(sourcePath) === path.basename(outputs.receipt)
      && path.basename(targetPath) === 'previous-0'
      && path.basename(path.dirname(targetPath)).startsWith('.archify-visual-check-')) {
      renameSync(sourcePath, displaced);
      fs.writeFileSync(sourcePath, successor, { flag: 'wx' });
      successorIdentity = entryIdentity(sourcePath);
      injected = true;
    }
    return linkSync(sourcePath, targetPath);
  });

  const result = await runVisualCheck({
    artifactPath: input,
    resolveChrome: () => null,
  });

  assert.equal(injected, true);
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict');
  assert.deepEqual(fs.readFileSync(outputs.receipt), successor);
  assert.deepEqual(entryIdentity(outputs.receipt), successorIdentity);
});

for (const scenario of [
  {
    name: 'directory',
    create(file) {
      fs.mkdirSync(file);
    },
    assertPreserved(file) {
      assert.equal(fs.lstatSync(file).isDirectory(), true);
    },
  },
  {
    name: 'FIFO',
    skip: process.platform === 'win32' && 'POSIX FIFOs are not native Windows filesystem entries',
    create(file, t) {
      const created = spawnSync('mkfifo', [file], { encoding: 'utf8' });
      if (created.status !== 0) {
        t.skip(`mkfifo is unavailable: ${created.stderr || `exit ${created.status}`}`);
        const error = new Error('mkfifo unavailable');
        error.code = 'ARCHIFY_TEST_SKIPPED';
        throw error;
      }
      assert.equal(fs.lstatSync(file).isFIFO(), true, 'mkfifo must create a native FIFO visible to Node');
    },
    assertPreserved(file) {
      assert.equal(fs.lstatSync(file).isFIFO(), true);
    },
  },
  {
    name: 'symlink',
    create(file, t) {
      const target = path.join(tmp, 'backup-link-symlink-target');
      fs.writeFileSync(target, 'symlink target', { flag: fs.existsSync(target) ? 'w' : 'wx' });
      try {
        fs.symlinkSync(target, file, 'file');
      } catch (error) {
        if (error?.code === 'EPERM') {
          t.skip(`file symlinks are unavailable: ${error.message}`);
          const skipped = new Error('file symlinks unavailable');
          skipped.code = 'ARCHIFY_TEST_SKIPPED';
          throw skipped;
        }
        throw error;
      }
    },
    assertPreserved(file) {
      assert.equal(fs.lstatSync(file).isSymbolicLink(), true);
    },
  },
]) {
  test(`visual-check preserves a ${scenario.name} swapped at the backup link boundary`, {
    skip: scenario.skip,
  }, async (t) => {
    const input = artifact(`backup-link-${scenario.name.toLowerCase()}-successor.html`);
    const outputs = sidecarPaths(input);
    const first = await runVisualCheck({
      artifactPath: input,
      chromePath: '/fake/chrome',
      browserFactory: async () => fakeBrowser(),
    });
    assert.equal(first.exitCode, 0);

    const displaced = path.join(tmp, `backup-link-${scenario.name.toLowerCase()}-displaced.json`);
    const stagingBefore = new Set(stagingDirectories(path.dirname(outputs.receipt)));
    const linkSync = fs.linkSync.bind(fs);
    const renameSync = fs.renameSync.bind(fs);
    let injected = false;
    t.after(() => {
      fs.rmSync(displaced, { force: true });
      fs.rmSync(outputs.receipt, { recursive: true, force: true });
      for (const directory of stagingDirectories(path.dirname(outputs.receipt))) {
        if (!stagingBefore.has(directory)) {
          fs.rmSync(path.join(path.dirname(outputs.receipt), directory), { recursive: true, force: true });
        }
      }
    });
    t.mock.method(fs, 'linkSync', (source, target) => {
      const sourcePath = String(source);
      const targetPath = String(target);
      if (!injected
        && path.basename(sourcePath) === path.basename(outputs.receipt)
        && path.basename(targetPath) === 'previous-0'
        && path.basename(path.dirname(targetPath)).startsWith('.archify-visual-check-')) {
        renameSync(sourcePath, displaced);
        scenario.create(sourcePath, t);
        injected = true;
      }
      return linkSync(sourcePath, targetPath);
    });

    let result;
    try {
      result = await runVisualCheck({
        artifactPath: input,
        resolveChrome: () => null,
      });
    } catch (error) {
      if (error?.code === 'ARCHIFY_TEST_SKIPPED') return;
      throw error;
    }

    assert.equal(injected, true);
    assert.equal(result.exitCode, 1);
    assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict');
    scenario.assertPreserved(outputs.receipt);
  });
}

test('visual-check preserves an in-place evidence edit made after preflight', async () => {
  const input = artifact('late-in-place-evidence-edit.html');
  const outputs = sidecarPaths(input);
  const first = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });
  assert.equal(first.exitCode, 0);

  const targets = [
    outputs.receipt,
    outputs.contactSheet,
    ...outputs.screenshots.map((entry) => entry.path),
  ];
  const before = new Map(targets.map((target) => [target, fs.readFileSync(target)]));
  const originalIdentity = entryIdentity(outputs.contactSheet);
  const sentinel = Buffer.from('external in-place contact-sheet edit\n');
  let editedIdentity;
  let injected = false;
  const browser = fakeBrowser();
  const inspect = browser.inspect.bind(browser);
  browser.inspect = async (args) => {
    const metrics = await inspect(args);
    if (!injected) {
      fs.writeFileSync(outputs.contactSheet, sentinel);
      editedIdentity = entryIdentity(outputs.contactSheet);
      injected = true;
    }
    return metrics;
  };

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  assert.equal(injected, true);
  assert.deepEqual(editedIdentity, originalIdentity, 'the injected edit must retain the captured inode');
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict');
  assert.equal(
    result.receipt.diagnostics.at(-1)?.evidence?.reason?.code,
    'previous-evidence-content-changed',
  );
  assert.deepEqual(fs.readFileSync(outputs.contactSheet), sentinel);
  assert.deepEqual(entryIdentity(outputs.contactSheet), editedIdentity);
  for (const target of targets) {
    if (target !== outputs.contactSheet) assert.deepEqual(fs.readFileSync(target), before.get(target), target);
  }
  assert.deepEqual(stagingDirectories(path.dirname(outputs.receipt)), []);
});

test('visual-check preserves an in-place backup edit made before cleanup', async (t) => {
  const input = artifact('late-in-place-backup-edit.html');
  const outputs = sidecarPaths(input);
  const first = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });
  assert.equal(first.exitCode, 0);

  const targets = [
    outputs.receipt,
    outputs.contactSheet,
    ...outputs.screenshots.map((entry) => entry.path),
  ];
  const before = new Map(targets.map((target) => [target, fs.readFileSync(target)]));
  const originalIdentity = entryIdentity(outputs.contactSheet);
  const sentinel = Buffer.from('external in-place backup edit\n');
  const linkSync = fs.linkSync.bind(fs);
  let editedIdentity;
  let injected = false;
  t.mock.method(fs, 'linkSync', (source, target) => {
    const result = linkSync(source, target);
    if (!injected
      && path.basename(String(source)) === 'receipt.json'
      && path.basename(path.dirname(String(source))).startsWith('.archify-visual-check-')) {
      const backup = path.join(path.dirname(String(source)), 'previous-1');
      fs.writeFileSync(backup, sentinel);
      editedIdentity = entryIdentity(backup);
      injected = true;
    }
    return result;
  });

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });

  assert.equal(injected, true);
  assert.deepEqual(editedIdentity, originalIdentity, 'the injected edit must retain the backup inode');
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict');
  assert.equal(
    result.receipt.diagnostics.at(-1)?.evidence?.reason?.code,
    'backup-content-changed-before-cleanup',
  );
  assert.deepEqual(fs.readFileSync(outputs.contactSheet), sentinel);
  assert.deepEqual(entryIdentity(outputs.contactSheet), editedIdentity);
  for (const target of targets) {
    if (target !== outputs.contactSheet) assert.deepEqual(fs.readFileSync(target), before.get(target), target);
  }
  assert.deepEqual(stagingDirectories(path.dirname(outputs.receipt)), []);
});

test('visual-check refuses hard-linked receipt, contact-sheet, and PNG evidence without mutation', async (t) => {
  const selectors = [
    ['receipt', (outputs) => outputs.receipt],
    ['contact-sheet', (outputs) => outputs.contactSheet],
    ['screenshot', (outputs) => outputs.screenshots[0].path],
  ];

  for (const [name, select] of selectors) {
    const input = artifact(`hardlinked-${name}.html`);
    const outputs = sidecarPaths(input);
    const first = await runVisualCheck({
      artifactPath: input,
      chromePath: '/fake/chrome',
      browserFactory: async () => fakeBrowser(),
    });
    assert.equal(first.exitCode, 0, `${name}: initial evidence`);
    const target = select(outputs);
    const alias = `${target}.alias`;
    try {
      fs.linkSync(target, alias);
    } catch (error) {
      t.skip(`hard links are unavailable: ${error.message}`);
      return;
    }
    const before = fs.readFileSync(target);
    let launched = false;
    const result = await runVisualCheck({
      artifactPath: input,
      chromePath: '/fake/chrome',
      browserFactory: async () => { launched = true; return fakeBrowser(); },
    });
    assert.equal(result.exitCode, 1, name);
    assert.equal(launched, false, name);
    assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict', name);
    assert.match(
      result.receipt.diagnostics.at(-1)?.evidence?.reason?.code || '',
      /^(?:requested-entry|target)-hardlinked$/,
      name,
    );
    assert.deepEqual(fs.readFileSync(target), before, name);
    assert.deepEqual(fs.readFileSync(alias), before, `${name}: alias`);
  }
});

test('visual-check rejects an lstat-to-open symlink substitution without following it', async (t) => {
  const input = artifact('staged-evidence-symlink-race.html');
  const outputs = sidecarPaths(input);
  const sentinel = path.join(tmp, 'staged-evidence-symlink-sentinel.txt');
  const probe = path.join(tmp, 'staged-evidence-symlink-probe');
  const sentinelBytes = Buffer.from('must never be read through the staged evidence path\n');
  fs.writeFileSync(sentinel, sentinelBytes);
  try {
    fs.symlinkSync(sentinel, probe, 'file');
    fs.unlinkSync(probe);
  } catch (error) {
    t.skip(`file symlinks are unavailable: ${error.message}`);
    return;
  }

  const browser = fakeBrowser();
  const inspect = browser.inspect.bind(browser);
  let screenshotReady = false;
  browser.inspect = async (args) => {
    const metrics = await inspect(args);
    if (args.screenshotPath) screenshotReady = true;
    return metrics;
  };

  const openSync = fs.openSync.bind(fs);
  let injected = false;
  let claimant;
  t.mock.method(fs, 'openSync', (file, flags, mode) => {
    const candidate = String(file);
    if (!injected
      && screenshotReady
      && path.basename(candidate) === 'capture-0.png'
      && path.basename(path.dirname(candidate)).startsWith('.archify-visual-check-')) {
      fs.unlinkSync(candidate);
      fs.symlinkSync(sentinel, candidate, 'file');
      claimant = candidate;
      injected = true;
    }
    return openSync(file, flags, mode);
  });
  t.after(() => {
    for (const directory of stagingDirectories(path.dirname(outputs.receipt))) {
      fs.rmSync(path.join(path.dirname(outputs.receipt), directory), { recursive: true, force: true });
    }
  });

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  assert.equal(injected, true);
  assert.equal(result.exitCode, 1);
  assert.deepEqual(fs.readFileSync(sentinel), sentinelBytes);
  assert.equal(fs.lstatSync(claimant).isSymbolicLink(), true);
  assert.equal(fs.existsSync(outputs.receipt), false);
  assert.equal(fs.existsSync(outputs.contactSheet), false);
  assert.equal(outputs.screenshots.every((entry) => !fs.existsSync(entry.path)), true);
});

test('visual-check rejects an lstat-to-open FIFO substitution without blocking', {
  skip: process.platform === 'win32' ? 'named pipes use different APIs on Windows' : false,
  timeout: 5_000,
}, async (t) => {
  const input = artifact('staged-evidence-fifo-race.html');
  const outputs = sidecarPaths(input);
  const probe = path.join(tmp, 'staged-evidence-fifo-probe');
  const probeResult = spawnSync('mkfifo', [probe]);
  if (probeResult.status !== 0) {
    t.skip(`mkfifo is unavailable: ${probeResult.stderr?.toString() || 'unknown error'}`);
    return;
  }
  fs.unlinkSync(probe);

  const browser = fakeBrowser();
  const inspect = browser.inspect.bind(browser);
  let screenshotReady = false;
  browser.inspect = async (args) => {
    const metrics = await inspect(args);
    if (args.screenshotPath) screenshotReady = true;
    return metrics;
  };

  const openSync = fs.openSync.bind(fs);
  let injected = false;
  let claimant;
  t.mock.method(fs, 'openSync', (file, flags, mode) => {
    const candidate = String(file);
    if (!injected
      && screenshotReady
      && path.basename(candidate) === 'capture-0.png'
      && path.basename(path.dirname(candidate)).startsWith('.archify-visual-check-')) {
      fs.unlinkSync(candidate);
      const created = spawnSync('mkfifo', [candidate]);
      assert.equal(created.status, 0, created.stderr?.toString());
      claimant = candidate;
      injected = true;
    }
    return openSync(file, flags, mode);
  });
  t.after(() => {
    for (const directory of stagingDirectories(path.dirname(outputs.receipt))) {
      fs.rmSync(path.join(path.dirname(outputs.receipt), directory), { recursive: true, force: true });
    }
  });

  const started = Date.now();
  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  assert.equal(injected, true);
  assert.equal(result.exitCode, 1);
  assert.ok(Date.now() - started < 2_000, 'FIFO inspection must fail without waiting for a writer');
  assert.equal(fs.lstatSync(claimant).isFIFO(), true);
  assert.equal(fs.existsSync(outputs.receipt), false);
  assert.equal(fs.existsSync(outputs.contactSheet), false);
  assert.equal(outputs.screenshots.every((entry) => !fs.existsSync(entry.path)), true);
});

for (const operation of ['run', 'persist-failure']) {
  test(`visual-check ${operation} rejects an artifact changed to a FIFO before open`, {
    skip: process.platform === 'win32' ? 'named pipes use different APIs on Windows' : false,
    timeout: 10_000,
  }, (t) => {
    const input = artifact(`artifact-fifo-substitution-${operation}.html`);
    const outputs = sidecarPaths(input);
    const visualCheckUrl = new URL('../bin/visual-check.mjs', import.meta.url).href;
    t.after(() => {
      try {
        if (fs.lstatSync(input).isFIFO()) fs.unlinkSync(input);
      } catch {}
    });
    const script = `
      import { spawnSync } from 'node:child_process';
      import fs from 'node:fs';
      import path from 'node:path';
      import { persistVisualCheckFailure, runVisualCheck } from ${JSON.stringify(visualCheckUrl)};
      const artifact = ${JSON.stringify(input)};
      const openSync = fs.openSync.bind(fs);
      let injected = false;
      fs.openSync = (file, flags, mode) => {
        if (!injected && path.resolve(String(file)) === artifact) {
          fs.unlinkSync(artifact);
          const created = spawnSync('mkfifo', [artifact]);
          if (created.status !== 0) throw new Error(created.stderr?.toString() || 'mkfifo failed');
          injected = true;
        }
        return openSync(file, flags, mode);
      };
      ${operation === 'run'
        ? `try {
            await runVisualCheck({ artifactPath: artifact, resolveChrome: () => null });
            console.error('operation unexpectedly accepted the FIFO');
            process.exitCode = 2;
          } catch (error) {
            console.log(JSON.stringify({ injected, reason: error.evidenceReason?.code || error.message }));
          }`
        : `const receipt = persistVisualCheckFailure(artifact, {
            schemaVersion: 1,
            command: 'visual-check',
            status: 'fail',
            diagnostics: [],
          });
          console.log(JSON.stringify({
            injected,
            reason: receipt.diagnostics?.at(-1)?.evidence?.reason?.code || receipt.error,
          }));`}
    `;

    const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
      encoding: 'utf8',
      timeout: 3_000,
    });

    assert.equal(child.error, undefined, child.error?.message);
    assert.equal(child.status, 0, child.stderr || child.stdout);
    const observed = JSON.parse(child.stdout);
    assert.equal(observed.injected, true);
    assert.match(observed.reason, /not-regular-file|changed-during-inspection|artifact-unreadable/);
    assert.equal(fs.lstatSync(input).isFIFO(), true);
    assert.equal(fs.existsSync(outputs.receipt), false);
    assert.equal(fs.existsSync(outputs.contactSheet), false);
    assert.equal(outputs.screenshots.every((entry) => !fs.existsSync(entry.path)), true);
  });
}

test('visual-check rejects a previous receipt changed to a FIFO before its content open', {
  skip: process.platform === 'win32' ? 'named pipes use different APIs on Windows' : false,
  timeout: 10_000,
}, async (t) => {
  const input = artifact('previous-receipt-fifo-substitution.html');
  const outputs = sidecarPaths(input);
  const first = await runVisualCheck({ artifactPath: input, resolveChrome: () => null });
  assert.equal(first.exitCode, 2);
  const receiptBefore = fs.readFileSync(outputs.receipt);
  const visualCheckUrl = new URL('../bin/visual-check.mjs', import.meta.url).href;
  t.after(() => {
    try {
      if (fs.lstatSync(outputs.receipt).isFIFO()) fs.unlinkSync(outputs.receipt);
    } catch {}
  });
  const script = `
    import { spawnSync } from 'node:child_process';
    import fs from 'node:fs';
    import path from 'node:path';
    import { runVisualCheck } from ${JSON.stringify(visualCheckUrl)};
    const artifact = ${JSON.stringify(input)};
    const receipt = ${JSON.stringify(outputs.receipt)};
    const openSync = fs.openSync.bind(fs);
    let receiptOpens = 0;
    let injected = false;
    fs.openSync = (file, flags, mode) => {
      if (path.resolve(String(file)) === receipt) {
        receiptOpens += 1;
        if (!injected && receiptOpens === 3) {
          fs.unlinkSync(receipt);
          const created = spawnSync('mkfifo', [receipt]);
          if (created.status !== 0) throw new Error(created.stderr?.toString() || 'mkfifo failed');
          injected = true;
        }
      }
      return openSync(file, flags, mode);
    };
    const result = await runVisualCheck({ artifactPath: artifact, resolveChrome: () => null });
    console.log(JSON.stringify({
      injected,
      receiptOpens,
      exitCode: result.exitCode,
      reason: result.receipt.diagnostics?.at(-1)?.evidence?.reason?.code,
    }));
  `;

  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    timeout: 3_000,
  });

  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr || child.stdout);
  const observed = JSON.parse(child.stdout);
  assert.equal(observed.injected, true, JSON.stringify(observed));
  assert.equal(observed.receiptOpens, 3);
  assert.equal(observed.exitCode, 1);
  assert.equal(observed.reason, 'requested-entry-changed-during-inspection');
  assert.equal(fs.lstatSync(outputs.receipt).isFIFO(), true);
  assert.deepEqual(receiptBefore.length > 0, true);
  assert.deepEqual(stagingDirectories(path.dirname(outputs.receipt)), []);
});

test('visual-check preserves existing evidence modes under a restrictive umask', async (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX permission bits are not portable to Windows');
    return;
  }

  const input = artifact('preserved-evidence-modes.html');
  const outputs = sidecarPaths(input);
  const targets = [
    outputs.receipt,
    outputs.contactSheet,
    ...outputs.screenshots.map((entry) => entry.path),
  ];
  const first = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });
  assert.equal(first.exitCode, 0);
  for (const target of targets) fs.chmodSync(target, 0o666);

  const previousUmask = process.umask(0o077);
  let second;
  try {
    second = await runVisualCheck({
      artifactPath: input,
      chromePath: '/fake/chrome',
      browserFactory: async () => fakeBrowser(),
    });
  } finally {
    process.umask(previousUmask);
  }

  assert.equal(second.exitCode, 0);
  for (const target of targets) {
    assert.equal(fs.statSync(target).mode & 0o777, 0o666, target);
  }
});

test('visual-check never follows the former predictable temporary symlink', async (t) => {
  const input = artifact('predictable-temporary-symlink.html');
  const outputs = sidecarPaths(input);
  const sentinel = path.join(tmp, 'predictable-temporary-sentinel.txt');
  const temporary = `${outputs.receipt}.tmp-${process.pid}`;
  const bytes = Buffer.from('must not be truncated\n');
  fs.writeFileSync(sentinel, bytes);
  try {
    fs.symlinkSync(sentinel, temporary, 'file');
  } catch (error) {
    t.skip(`file symlinks are unavailable: ${error.message}`);
    return;
  }

  const result = await runVisualCheck({ artifactPath: input, resolveChrome: () => null });

  assert.equal(result.exitCode, 2);
  assert.deepEqual(fs.readFileSync(sentinel), bytes);
  assert.equal(fs.lstatSync(temporary).isSymbolicLink(), true);
  assert.deepEqual(stagingDirectories(path.dirname(outputs.receipt)), []);
});

test('visual-check preserves absent and replaced paths that become symlinks after preflight', async (t) => {
  const sentinel = path.join(tmp, 'late-symlink-sentinel.txt');
  const sentinelBytes = Buffer.from('symlink claimant target\n');
  fs.writeFileSync(sentinel, sentinelBytes);
  const cases = [
    { name: 'absent', prepare: async () => {} },
    {
      name: 'existing',
      prepare: async (input) => {
        const first = await runVisualCheck({
          artifactPath: input,
          chromePath: '/fake/chrome',
          browserFactory: async () => fakeBrowser(),
        });
        assert.equal(first.exitCode, 0);
      },
    },
  ];

  for (const scenario of cases) {
    const input = artifact(`late-${scenario.name}-symlink.html`);
    const outputs = sidecarPaths(input);
    await scenario.prepare(input);
    const before = new Map(
      [outputs.contactSheet, ...outputs.screenshots.map((entry) => entry.path)]
        .filter((file) => fs.existsSync(file))
        .map((file) => [file, fs.readFileSync(file)]),
    );
    let injected = false;
    const inject = () => {
      if (injected) return;
      injected = true;
      if (fs.existsSync(outputs.receipt)) fs.unlinkSync(outputs.receipt);
      fs.symlinkSync(sentinel, outputs.receipt, 'file');
    };

    let result;
    try {
      result = await runVisualCheck({
        artifactPath: input,
        resolveChrome: () => { inject(); return null; },
      });
    } catch (error) {
      if (error?.code === 'EPERM') {
        t.skip(`file symlinks are unavailable: ${error.message}`);
        return;
      }
      throw error;
    }

    assert.equal(result.exitCode, 1, scenario.name);
    assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict', scenario.name);
    assert.equal(fs.lstatSync(outputs.receipt).isSymbolicLink(), true, scenario.name);
    assert.deepEqual(fs.readFileSync(sentinel), sentinelBytes, scenario.name);
    for (const [file, bytes] of before) assert.deepEqual(fs.readFileSync(file), bytes, `${scenario.name}: ${file}`);
    assert.deepEqual(stagingDirectories(path.dirname(outputs.receipt)), [], scenario.name);
  }
});

test('visual-check rejects a screenshot candidate externally hard-linked before registration', async (t) => {
  const input = artifact('staged-screenshot-hardlink.html');
  const outputs = sidecarPaths(input);
  const alias = path.join(tmp, 'staged-screenshot-external-alias.png');
  const browser = fakeBrowser();
  const inspect = browser.inspect.bind(browser);
  let injected = false;
  let hardLinkUnavailable;
  browser.inspect = async (args) => {
    const metrics = await inspect(args);
    if (args.screenshotPath && !injected && !hardLinkUnavailable) {
      try {
        fs.linkSync(args.screenshotPath, alias);
      } catch (error) {
        if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
          hardLinkUnavailable = error;
          return metrics;
        }
        throw error;
      }
      injected = true;
    }
    return metrics;
  };

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  if (hardLinkUnavailable) {
    t.skip(`hard links are unavailable: ${hardLinkUnavailable.message}`);
    return;
  }
  assert.equal(injected, true, 'the staged screenshot hard-link injection must run');
  assert.equal(result.exitCode, 1);
  assert.equal(fs.existsSync(alias), true);
  assert.deepEqual(fs.readFileSync(alias), png);
  assert.equal(fs.lstatSync(alias, { bigint: true }).nlink, 1n);
  assert.equal(fs.existsSync(outputs.contactSheet), false);
  assert.equal(outputs.screenshots.every((entry) => !fs.existsSync(entry.path)), true);
  assert.deepEqual(stagingDirectories(path.dirname(outputs.receipt)), []);
});

for (const candidate of [
  { name: 'contact-sheet', stagedName: 'contact-sheet.html', chrome: true },
  { name: 'receipt', stagedName: 'receipt.json', chrome: false },
]) {
  test(`visual-check rolls back when the staged ${candidate.name} gains an external hard link during publish`, async (t) => {
    const input = artifact(`staged-${candidate.name}-publish-hardlink.html`);
    const outputs = sidecarPaths(input);
    const alias = path.join(tmp, `staged-${candidate.name}-publish-external-alias`);
    const linkSync = fs.linkSync.bind(fs);
    let injected = false;
    t.mock.method(fs, 'linkSync', (source, target) => {
      if (!injected && path.basename(source) === candidate.stagedName) {
        linkSync(source, alias);
        injected = true;
      }
      return linkSync(source, target);
    });

    const result = await runVisualCheck({
      artifactPath: input,
      ...(candidate.chrome
        ? { chromePath: '/fake/chrome', browserFactory: async () => fakeBrowser() }
        : { resolveChrome: () => null }),
    });

    assert.equal(injected, true);
    assert.equal(result.exitCode, 1);
    assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict');
    assert.equal(fs.existsSync(alias), true);
    assert.equal(fs.lstatSync(alias, { bigint: true }).nlink, 1n);
    assert.equal(fs.existsSync(outputs.receipt), false);
    assert.equal(fs.existsSync(outputs.contactSheet), false);
    assert.equal(outputs.screenshots.every((entry) => !fs.existsSync(entry.path)), true);
    assert.deepEqual(stagingDirectories(path.dirname(outputs.receipt)), []);
  });
}

test('visual-check keeps staged evidence identity-bound across public link creation', async (t) => {
  const input = artifact('staged-publication-binding.html');
  const outputs = sidecarPaths(input);
  const first = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });
  assert.equal(first.exitCode, 0);
  const targets = [
    outputs.receipt,
    outputs.contactSheet,
    ...outputs.screenshots.map((entry) => entry.path),
  ];
  const before = new Map(targets.map((target) => [target, fs.readFileSync(target)]));
  const stagingBefore = new Set(stagingDirectories(path.dirname(outputs.receipt)));
  const detached = path.join(tmp, 'detached-bound-contact-sheet.html');
  const claimant = Buffer.from('external staged contact-sheet claimant\n');
  const linkSync = fs.linkSync.bind(fs);
  let stagedClaimant;
  let injected = false;
  t.mock.method(fs, 'linkSync', (source, target) => {
    const sourcePath = String(source);
    const targetPath = String(target);
    if (!injected
      && path.basename(sourcePath) === 'contact-sheet.html'
      && path.basename(path.dirname(sourcePath)).startsWith('.archify-visual-check-')
      && path.resolve(targetPath) === path.resolve(outputs.contactSheet)) {
      injected = true;
      stagedClaimant = sourcePath;
      fs.renameSync(sourcePath, detached);
      fs.writeFileSync(sourcePath, claimant, { flag: 'wx' });
    }
    return linkSync(sourcePath, targetPath);
  });
  t.after(() => {
    fs.rmSync(detached, { force: true });
    for (const directory of stagingDirectories(path.dirname(outputs.receipt))) {
      if (!stagingBefore.has(directory)) {
        fs.rmSync(path.join(path.dirname(outputs.receipt), directory), { recursive: true, force: true });
      }
    }
  });

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });

  assert.equal(injected, true);
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict');
  for (const target of targets) assert.deepEqual(fs.readFileSync(target), before.get(target), target);
  assert.deepEqual(fs.readFileSync(stagedClaimant), claimant);
  assert.equal(fs.existsSync(detached), true);
});

for (const scenario of [
  {
    name: 'contact sheet',
    selectEarly: (outputs) => outputs.contactSheet,
    triggerStagedName: 'capture-0.png',
  },
  {
    name: 'first screenshot',
    selectEarly: (outputs) => outputs.screenshots[0].path,
    triggerStagedName: 'receipt.json',
  },
]) {
  test(`visual-check final set sweep preserves a replacement of the early ${scenario.name}`, async (t) => {
    const input = artifact(`final-sweep-${scenario.name.replaceAll(' ', '-')}.html`);
    const outputs = sidecarPaths(input);
    const stagingBefore = new Set(stagingDirectories(path.dirname(outputs.receipt)));
    t.after(() => {
      for (const directory of stagingDirectories(path.dirname(outputs.receipt))) {
        if (!stagingBefore.has(directory)) {
          fs.rmSync(path.join(path.dirname(outputs.receipt), directory), { recursive: true, force: true });
        }
      }
    });
    const first = await runVisualCheck({
      artifactPath: input,
      chromePath: '/fake/chrome',
      browserFactory: async () => fakeBrowser(),
    });
    assert.equal(first.exitCode, 0);
    const targets = [outputs.receipt, outputs.contactSheet, ...outputs.screenshots.map((entry) => entry.path)];
    const before = new Map(targets.map((target) => [target, fs.readFileSync(target)]));
    const replaced = scenario.selectEarly(outputs);
    const sentinel = Buffer.from(`late replacement of ${scenario.name}\n`);
    const linkSync = fs.linkSync.bind(fs);
    let replacementIdentity;
    let injected = false;
    t.mock.method(fs, 'linkSync', (source, target) => {
      const result = linkSync(source, target);
      if (!injected
          && path.basename(String(source)) === scenario.triggerStagedName
          && path.basename(path.dirname(String(source))).startsWith('.archify-visual-check-')) {
        injected = true;
        fs.unlinkSync(replaced);
        fs.writeFileSync(replaced, sentinel, { flag: 'wx' });
        replacementIdentity = entryIdentity(replaced);
      }
      return result;
    });

    const result = await runVisualCheck({
      artifactPath: input,
      chromePath: '/fake/chrome',
      browserFactory: async () => fakeBrowser(),
    });

    assert.equal(injected, true);
    assert.equal(result.exitCode, 1);
    assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict');
    assert.equal(result.receipt.diagnostics.at(-1)?.evidence?.reason?.code, 'published-set-identity-mismatch');
    assert.deepEqual(fs.readFileSync(replaced), sentinel);
    assert.deepEqual(entryIdentity(replaced), replacementIdentity);
    for (const target of targets) {
      if (target !== replaced) assert.deepEqual(fs.readFileSync(target), before.get(target), target);
    }
  });
}

test('visual-check rollback preserves an in-place edit to an already published member', async (t) => {
  const input = artifact('rollback-published-content-edit.html');
  const outputs = sidecarPaths(input);
  const first = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });
  assert.equal(first.exitCode, 0);

  const targets = [
    outputs.receipt,
    outputs.contactSheet,
    ...outputs.screenshots.map((entry) => entry.path),
  ];
  const before = new Map(targets.map((target) => [target, fs.readFileSync(target)]));
  const originalContactIdentity = entryIdentity(outputs.contactSheet);
  const stagingBefore = new Set(stagingDirectories(path.dirname(outputs.receipt)));
  t.after(() => {
    for (const directory of stagingDirectories(path.dirname(outputs.receipt))) {
      if (!stagingBefore.has(directory)) {
        fs.rmSync(path.join(path.dirname(outputs.receipt), directory), { recursive: true, force: true });
      }
    }
  });

  const sentinel = Buffer.from('external in-place edit after contact-sheet publication\n');
  const linkSync = fs.linkSync.bind(fs);
  let firstPublishedIdentity;
  let editedIdentity;
  let injected = false;
  t.mock.method(fs, 'linkSync', (source, target) => {
    const sourceName = path.basename(String(source));
    const fromStaging = path.basename(path.dirname(String(source))).startsWith('.archify-visual-check-');
    if (!injected && firstPublishedIdentity && fromStaging && sourceName === 'capture-0.png') {
      fs.writeFileSync(outputs.contactSheet, sentinel);
      editedIdentity = entryIdentity(outputs.contactSheet);
      injected = true;
      throw new Error('synthetic later evidence publication failure');
    }
    const result = linkSync(source, target);
    if (!firstPublishedIdentity && fromStaging && sourceName === 'contact-sheet.html') {
      firstPublishedIdentity = entryIdentity(target);
    }
    return result;
  });

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });

  assert.equal(injected, true);
  assert.deepEqual(editedIdentity, firstPublishedIdentity, 'the edit must retain the published inode');
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/evidence-write');
  const rollbackReasons = result.receipt.diagnostics.at(-1)?.evidence?.errors
    ?.map((entry) => entry.reason).join('\n') || '';
  assert.match(rollbackReasons, /published entry content changed; it was preserved/);
  assert.match(rollbackReasons, /final path is occupied; the owned backup was preserved/);
  assert.deepEqual(fs.readFileSync(outputs.contactSheet), sentinel);
  assert.deepEqual(entryIdentity(outputs.contactSheet), editedIdentity);
  for (const target of targets) {
    if (target !== outputs.contactSheet) assert.deepEqual(fs.readFileSync(target), before.get(target), target);
  }

  const retained = stagingDirectories(path.dirname(outputs.receipt))
    .filter((directory) => !stagingBefore.has(directory));
  assert.equal(retained.length, 1);
  const backup = path.join(path.dirname(outputs.receipt), retained[0], 'previous-1');
  assert.deepEqual(fs.readFileSync(backup), before.get(outputs.contactSheet));
  assert.deepEqual(entryIdentity(backup), originalContactIdentity);
});

test('visual-check rollback preserves a successor swapped at the public removal boundary', async (t) => {
  const input = artifact('rollback-public-removal-successor.html');
  const outputs = sidecarPaths(input);
  const first = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });
  assert.equal(first.exitCode, 0);

  const stagingBefore = new Set(stagingDirectories(path.dirname(outputs.receipt)));
  const displaced = path.join(tmp, 'rollback-public-removal-owned-displaced.html');
  const successor = Buffer.from('external successor at the public removal boundary\n');
  t.after(() => {
    fs.rmSync(displaced, { force: true });
    for (const directory of stagingDirectories(path.dirname(outputs.receipt))) {
      if (!stagingBefore.has(directory)) {
        fs.rmSync(path.join(path.dirname(outputs.receipt), directory), { recursive: true, force: true });
      }
    }
  });

  const linkSync = fs.linkSync.bind(fs);
  const renameSync = fs.renameSync.bind(fs);
  let contactPublished = false;
  let failureInjected = false;
  let successorInjected = false;
  let successorIdentity;
  t.mock.method(fs, 'linkSync', (source, target) => {
    const sourceName = path.basename(String(source));
    const fromStaging = path.basename(path.dirname(String(source))).startsWith('.archify-visual-check-');
    if (!failureInjected && contactPublished && fromStaging && sourceName === 'capture-0.png') {
      failureInjected = true;
      throw new Error('synthetic later evidence publication failure');
    }
    const result = linkSync(source, target);
    if (!contactPublished && fromStaging && sourceName === 'contact-sheet.html') {
      contactPublished = true;
    }
    return result;
  });
  t.mock.method(fs, 'renameSync', (source, target) => {
    const sourcePath = String(source);
    const targetPath = String(target);
    if (failureInjected
      && !successorInjected
      && path.basename(sourcePath) === path.basename(outputs.contactSheet)
      && path.basename(path.dirname(targetPath)).startsWith('.archify-remove-')) {
      renameSync(sourcePath, displaced);
      fs.writeFileSync(sourcePath, successor, { flag: 'wx' });
      successorIdentity = entryIdentity(sourcePath);
      successorInjected = true;
    }
    return renameSync(sourcePath, targetPath);
  });

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });

  assert.equal(failureInjected, true, JSON.stringify(result.receipt.diagnostics.at(-1)));
  assert.equal(successorInjected, true, JSON.stringify(result.receipt.diagnostics.at(-1)));
  assert.equal(result.exitCode, 1);
  assert.deepEqual(fs.readFileSync(outputs.contactSheet), successor);
  assert.deepEqual(entryIdentity(outputs.contactSheet), successorIdentity);
  const rollbackErrors = result.receipt.diagnostics.at(-1)?.evidence?.errors || [];
  assert.ok(rollbackErrors.some(
    (entry) => entry.file
      && path.basename(entry.file) === path.basename(outputs.contactSheet)
      && /successor was restored and preserved/.test(entry.reason),
  ));
});

test('visual-check restore rollback preserves a successor swapped at its public cleanup boundary', async (t) => {
  const input = artifact('restore-public-cleanup-successor.html');
  const outputs = sidecarPaths(input);
  const first = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });
  assert.equal(first.exitCode, 0);

  const displaced = path.join(tmp, 'restore-public-cleanup-owned-displaced.html');
  const successor = Buffer.from('external successor at restore cleanup boundary\n');
  const stagingBefore = new Set(stagingDirectories(path.dirname(outputs.receipt)));
  const linkSync = fs.linkSync.bind(fs);
  const lstatSync = fs.lstatSync.bind(fs);
  const unlinkSync = fs.unlinkSync.bind(fs);
  const renameSync = fs.renameSync.bind(fs);
  let publicationFailed = false;
  let corruptNextRestoredStat = false;
  let verificationInjected = false;
  let successorInjected = false;
  let successorIdentity;
  const injectSuccessor = (publicPath) => {
    renameSync(publicPath, displaced);
    fs.writeFileSync(publicPath, successor, { flag: 'wx' });
    successorIdentity = entryIdentity(publicPath);
    successorInjected = true;
  };
  t.after(() => {
    fs.rmSync(displaced, { force: true });
    for (const directory of stagingDirectories(path.dirname(outputs.receipt))) {
      if (!stagingBefore.has(directory)) {
        fs.rmSync(path.join(path.dirname(outputs.receipt), directory), { recursive: true, force: true });
      }
    }
  });
  t.mock.method(fs, 'linkSync', (source, target) => {
    const sourcePath = String(source);
    const targetPath = String(target);
    const fromStaging = path.basename(path.dirname(sourcePath)).startsWith('.archify-visual-check-');
    if (!publicationFailed
      && fromStaging
      && path.basename(sourcePath) === 'contact-sheet.html'
      && path.basename(targetPath) === path.basename(outputs.contactSheet)) {
      publicationFailed = true;
      throw new Error('synthetic publication failure before backup restore');
    }
    const result = linkSync(sourcePath, targetPath);
    if (path.basename(sourcePath) === 'previous-1'
      && path.basename(targetPath) === path.basename(outputs.contactSheet)) {
      corruptNextRestoredStat = true;
    }
    return result;
  });
  t.mock.method(fs, 'lstatSync', (file, options) => {
    const filePath = String(file);
    const stat = lstatSync(filePath, options);
    if (corruptNextRestoredStat
      && path.basename(filePath) === path.basename(outputs.contactSheet)) {
      corruptNextRestoredStat = false;
      verificationInjected = true;
      return new Proxy(stat, {
        get(target, property, receiver) {
          if (property === 'ino') return target.ino + 1n;
          const value = Reflect.get(target, property, receiver);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
    }
    return stat;
  });
  t.mock.method(fs, 'unlinkSync', (file) => {
    const filePath = String(file);
    if (verificationInjected
      && !successorInjected
      && path.basename(filePath) === path.basename(outputs.contactSheet)) {
      injectSuccessor(filePath);
    }
    return unlinkSync(filePath);
  });
  t.mock.method(fs, 'renameSync', (source, target) => {
    const sourcePath = String(source);
    const targetPath = String(target);
    if (verificationInjected
      && !successorInjected
      && path.basename(sourcePath) === path.basename(outputs.contactSheet)
      && path.basename(path.dirname(targetPath)).startsWith('.archify-remove-')) {
      injectSuccessor(sourcePath);
    }
    return renameSync(sourcePath, targetPath);
  });

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });

  assert.equal(publicationFailed, true);
  assert.equal(verificationInjected, true);
  assert.equal(successorInjected, true);
  assert.equal(result.exitCode, 1);
  assert.equal(fs.existsSync(outputs.contactSheet), true);
  assert.deepEqual(fs.readFileSync(outputs.contactSheet), successor);
  assert.deepEqual(entryIdentity(outputs.contactSheet), successorIdentity);
});

for (const scenario of [
  { name: 'backup unlink', fault: 'unlink' },
  { name: 'staging rmdir', fault: 'rmdir' },
]) {
  test(`visual-check reports committed cleanup warning after ${scenario.name} failure`, async (t) => {
    const input = artifact(`committed-cleanup-${scenario.fault}.html`);
    const outputs = sidecarPaths(input);
    const first = await runVisualCheck({
      artifactPath: input,
      chromePath: '/fake/chrome',
      browserFactory: async () => fakeBrowser(),
    });
    assert.equal(first.exitCode, 0);
    const oldContactSheet = fs.readFileSync(outputs.contactSheet);
    const stagingBefore = new Set(stagingDirectories(path.dirname(outputs.receipt)));
    const claimantBytes = Buffer.from('external staging cleanup claimant\n');
    let injected = false;
    let retainedPath;

    if (scenario.fault === 'unlink') {
      const unlinkSync = fs.unlinkSync.bind(fs);
      t.mock.method(fs, 'unlinkSync', (file) => {
        const candidate = String(file);
        if (!injected
          && path.basename(candidate) === 'previous-1'
          && path.basename(path.dirname(candidate)).startsWith('.archify-remove-')) {
          injected = true;
          retainedPath = candidate;
          const error = new Error('synthetic backup unlink failure');
          error.code = 'EACCES';
          throw error;
        }
        return unlinkSync(file);
      });
    } else {
      const rmdirSync = fs.rmdirSync.bind(fs);
      t.mock.method(fs, 'rmdirSync', (directory) => {
        const candidate = String(directory);
        if (!injected && path.basename(candidate).startsWith('.archify-visual-check-')) {
          retainedPath = path.join(candidate, 'external-cleanup-claimant');
          fs.writeFileSync(retainedPath, claimantBytes, { flag: 'wx' });
          injected = true;
        }
        return rmdirSync(directory);
      });
    }
    t.after(() => {
      for (const directory of stagingDirectories(path.dirname(outputs.receipt))) {
        if (!stagingBefore.has(directory)) {
          fs.rmSync(path.join(path.dirname(outputs.receipt), directory), { recursive: true, force: true });
        }
      }
    });

    const result = await runVisualCheck({
      artifactPath: input,
      chromePath: '/fake/chrome',
      browserFactory: async () => fakeBrowser(),
    });

    assert.equal(injected, true);
    assert.equal(result.exitCode, 1);
    assert.equal(result.receipt.ok, false);
    assert.equal(result.receipt.status, 'fail');
    assert.equal(result.receipt.publication?.status, 'committed-with-warning');
    const expectedRecovery = scenario.fault === 'unlink'
      ? path.dirname(path.dirname(retainedPath))
      : path.dirname(retainedPath);
    assert.equal(result.receipt.publication?.recoveryDirectory, expectedRecovery);
    assert.ok(result.receipt.publication?.cleanupErrors?.length > 0);
    assert.match(result.receipt.error, /cleanup is incomplete/i);
    assert.ok(result.receipt.error.includes(expectedRecovery));
    const cleanupDiagnostic = result.receipt.diagnostics.at(-1);
    assert.equal(cleanupDiagnostic?.code, 'viewer/evidence-cleanup-incomplete');
    assert.equal(cleanupDiagnostic?.severity, 'warning');
    assert.equal(
      cleanupDiagnostic?.evidence?.recoveryDirectory,
      expectedRecovery,
    );
    assert.equal(fs.existsSync(retainedPath), true);
    assert.deepEqual(
      fs.readFileSync(retainedPath),
      scenario.fault === 'unlink' ? oldContactSheet : claimantBytes,
    );
    assert.equal(JSON.parse(fs.readFileSync(outputs.receipt, 'utf8')).status, 'pass');
    assert.equal(fs.existsSync(outputs.contactSheet), true);
    assert.equal(outputs.screenshots.every((entry) => fs.existsSync(entry.path)), true);
  });
}

test('public visual-check CLI reports a committed cleanup warning', (t) => {
  const input = artifact('public-cli-committed-cleanup-warning.html');
  const outputs = sidecarPaths(input);
  const cli = path.join(skillRoot, 'bin', 'archify.mjs');
  const missingChrome = path.join(tmp, 'missing-cleanup-warning-chrome');
  const baseEnv = {
    ...process.env,
    ARCHIFY_CHROME: missingChrome,
    ARCHIFY_UPDATE_CHECK_DISABLED: '1',
  };
  const first = spawnSync(process.execPath, [cli, 'visual-check', input, '--json'], {
    encoding: 'utf8',
    env: baseEnv,
  });
  assert.equal(first.status, 2, first.stderr || first.stdout);
  const oldReceipt = fs.readFileSync(outputs.receipt);
  const stagingBefore = new Set(stagingDirectories(path.dirname(outputs.receipt)));
  const hook = path.join(tmp, 'visual-cleanup-warning-hook.mjs');
  fs.writeFileSync(hook, `
    import fs from 'node:fs';
    import path from 'node:path';
    const unlinkSync = fs.unlinkSync.bind(fs);
    let injected = false;
    fs.unlinkSync = (file) => {
      const candidate = String(file);
      if (!injected
        && path.basename(candidate) === 'previous-0'
        && path.basename(path.dirname(candidate)).startsWith('.archify-remove-')) {
        injected = true;
        const error = new Error('synthetic public CLI backup unlink failure');
        error.code = 'EACCES';
        throw error;
      }
      return unlinkSync(file);
    };
  `);
  t.after(() => {
    for (const directory of stagingDirectories(path.dirname(outputs.receipt))) {
      if (!stagingBefore.has(directory)) {
        fs.rmSync(path.join(path.dirname(outputs.receipt), directory), { recursive: true, force: true });
      }
    }
  });

  const second = spawnSync(process.execPath, [cli, 'visual-check', input, '--json'], {
    encoding: 'utf8',
    env: {
      ...baseEnv,
      NODE_OPTIONS: `--import=${pathToFileURL(hook).href}`,
    },
  });

  assert.equal(second.status, 1, second.stderr || second.stdout);
  const receipt = JSON.parse(second.stdout);
  assert.equal(receipt.status, 'fail');
  assert.equal(receipt.ok, false);
  assert.equal(receipt.publication?.status, 'committed-with-warning');
  assert.match(receipt.error, /cleanup is incomplete/i);
  assert.equal(receipt.diagnostics.at(-1)?.code, 'viewer/evidence-cleanup-incomplete');
  assert.equal(receipt.diagnostics.at(-1)?.severity, 'warning');
  const recoveryDirectory = receipt.publication?.recoveryDirectory;
  assert.equal(typeof recoveryDirectory, 'string');
  const quarantine = fs.readdirSync(recoveryDirectory)
    .find((entry) => entry.startsWith('.archify-remove-'));
  assert.equal(typeof quarantine, 'string');
  const retained = path.join(recoveryDirectory, quarantine, 'previous-0');
  assert.deepEqual(fs.readFileSync(retained), oldReceipt);
  assert.equal(JSON.parse(fs.readFileSync(outputs.receipt, 'utf8')).status, 'skipped');
});

test('visual-check retries transient remote ENOTEMPTY during staging cleanup', async (t) => {
  const input = artifact('transient-staging-enotempty.html');
  const outputDirectory = path.dirname(input);
  const rmdirSync = fs.rmdirSync.bind(fs);
  let injected = false;
  t.mock.method(fs, 'rmdirSync', (directory, ...args) => {
    if (!injected && path.basename(String(directory)).startsWith('.archify-visual-check-')) {
      injected = true;
      throw Object.assign(new Error('simulated remote deletion visibility delay'), { code: 'ENOTEMPTY' });
    }
    return rmdirSync(directory, ...args);
  });

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });

  assert.equal(injected, true);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.receipt.diagnostics, []);
  assert.deepEqual(stagingDirectories(outputDirectory), []);
});

for (const scenario of ['successful evidence set', 'failure receipt', 'publication rollback']) {
  test(`visual-check closes staged bindings before SMB cleanup for ${scenario}`, async (t) => {
    const input = artifact(`smb-binding-cleanup-${scenario.replaceAll(' ', '-')}.html`);
    const outDir = fs.mkdtempSync(path.join(tmp, 'smb-binding-cleanup-'));
    t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
    const openSync = fs.openSync.bind(fs);
    const closeSync = fs.closeSync.bind(fs);
    const renameSync = fs.renameSync.bind(fs);
    const rmdirSync = fs.rmdirSync.bind(fs);
    const linkSync = fs.linkSync.bind(fs);
    const descriptors = new Map();
    const quarantines = new Map();
    let deferredRemovals = 0;
    let publicationFailed = false;
    const identityKey = (stat) => `${stat.dev}:${stat.ino}`;
    t.mock.method(fs, 'openSync', (...args) => {
      const descriptor = openSync(...args);
      descriptors.set(descriptor, identityKey(fs.fstatSync(descriptor, { bigint: true })));
      return descriptor;
    });
    t.mock.method(fs, 'closeSync', (descriptor) => {
      closeSync(descriptor);
      descriptors.delete(descriptor);
    });
    t.mock.method(fs, 'renameSync', (source, destination) => {
      const directory = path.dirname(String(destination));
      if (path.basename(directory).startsWith('.archify-remove-')) {
        quarantines.set(directory, identityKey(fs.lstatSync(source, { bigint: true })));
      }
      return renameSync(source, destination);
    });
    t.mock.method(fs, 'rmdirSync', (directory, ...args) => {
      const identity = quarantines.get(String(directory));
      if (identity && [...descriptors.values()].includes(identity)) {
        deferredRemovals += 1;
        throw Object.assign(new Error('SMB deletion remains pending while a file handle is open'), {
          code: 'ENOTEMPTY',
        });
      }
      return rmdirSync(directory, ...args);
    });
    if (scenario === 'publication rollback') {
      t.mock.method(fs, 'linkSync', (source, destination) => {
        if (!publicationFailed && path.basename(String(source)) === 'capture-0.png') {
          publicationFailed = true;
          throw new Error('synthetic screenshot publication failure');
        }
        return linkSync(source, destination);
      });
    }

    const result = await runVisualCheck({
      artifactPath: input,
      outDir,
      chromePath: '/fake/chrome',
      browserFactory: async () => fakeBrowser({
        screenshotFailure: () => scenario === 'failure receipt',
      }),
    });

    assert.ok(deferredRemovals > 0, 'the fixture must exercise an open-handle SMB deletion delay');
    assert.equal(result.exitCode, scenario === 'successful evidence set' ? 0 : 1);
    assert.equal(publicationFailed, scenario === 'publication rollback');
    assert.deepEqual(stagingDirectories(outDir), []);
    assert.equal(descriptors.size, 0);
    assert.doesNotMatch(JSON.stringify(result.receipt.diagnostics), /ENOTEMPTY|cleanup is incomplete/);
  });
}

test('visual-check reports a claimant retained by deferred staging cleanup', async (t) => {
  const input = artifact('smb-binding-cleanup-claimant.html');
  const outDir = fs.mkdtempSync(path.join(tmp, 'smb-cleanup-claimant-'));
  t.after(() => fs.rmSync(outDir, { recursive: true, force: true }));
  const rmdirSync = fs.rmdirSync.bind(fs);
  const sentinel = 'external claimant retained during deferred cleanup\n';
  let claimantPath;
  t.mock.method(fs, 'rmdirSync', (directory, ...args) => {
    if (!claimantPath && path.basename(String(directory)).startsWith('.archify-remove-')) {
      claimantPath = path.join(directory, 'external-claimant');
      fs.writeFileSync(claimantPath, sentinel, { flag: 'wx' });
    }
    return rmdirSync(directory, ...args);
  });

  const result = await runVisualCheck({
    artifactPath: input,
    outDir,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.publication?.status, 'committed-with-warning');
  assert.equal(fs.readFileSync(claimantPath, 'utf8'), sentinel);
  const cleanupError = result.receipt.publication.cleanupErrors.find(
    (entry) => entry.recoveryDirectory === path.dirname(claimantPath),
  );
  assert.equal(cleanupError?.reason, 'removal-quarantine-cleanup-failed');
  assert.equal(cleanupError?.bindingState.systemCode, 'ENOTEMPTY');
  assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/evidence-cleanup-incomplete');
});

test('visual-check rolls back when staged evidence changes after receipt binding', async (t) => {
  const input = artifact('staged-content-changed-after-receipt-binding.html');
  const outputs = sidecarPaths(input);
  const sentinel = Buffer.from('mutated staged screenshot bytes\n');
  const linkSync = fs.linkSync.bind(fs);
  const stagingBefore = new Set(stagingDirectories(path.dirname(outputs.receipt)));
  let changedPath;
  t.after(() => {
    for (const directory of stagingDirectories(path.dirname(outputs.receipt))) {
      if (!stagingBefore.has(directory)) {
        fs.rmSync(path.join(path.dirname(outputs.receipt), directory), { recursive: true, force: true });
      }
    }
  });
  let injected = false;
  t.mock.method(fs, 'linkSync', (source, target) => {
    const result = linkSync(source, target);
    if (!injected
      && path.basename(String(source)) === 'contact-sheet.html'
      && path.basename(path.dirname(String(source))).startsWith('.archify-visual-check-')) {
      changedPath = path.join(path.dirname(String(source)), 'capture-0.png');
      fs.writeFileSync(changedPath, sentinel);
      injected = true;
    }
    return result;
  });

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });

  assert.equal(injected, true);
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict');
  assert.equal(
    result.receipt.diagnostics.at(-1)?.evidence?.reason?.code,
    'staged-evidence-content-mismatch',
  );
  assert.equal(fs.existsSync(outputs.receipt), false);
  assert.equal(fs.existsSync(outputs.contactSheet), false);
  assert.equal(outputs.screenshots.every((entry) => !fs.existsSync(entry.path)), true);
  assert.deepEqual(fs.readFileSync(changedPath), sentinel);
  const rollbackErrors = result.receipt.diagnostics.at(-1)?.evidence?.rollbackErrors;
  assert.ok(rollbackErrors.some((entry) => entry.file === changedPath && /content changed; it was preserved/.test(entry.reason)));
});

test('visual-check preserves digest-mismatched evidence instead of treating its receipt as ownership', async () => {
  const input = artifact('digest-mismatched-evidence.html');
  const outputs = sidecarPaths(input);
  const first = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });
  assert.equal(first.exitCode, 0);
  const sentinel = Buffer.from('tampered contact sheet\n');
  fs.writeFileSync(outputs.contactSheet, sentinel);
  const receiptBefore = fs.readFileSync(outputs.receipt);
  let launched = false;

  const result = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => { launched = true; return fakeBrowser(); },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(launched, false);
  assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict');
  assert.equal(result.receipt.diagnostics.at(-1)?.evidence?.reason?.code, 'ownership-evidence-digest-mismatch');
  assert.deepEqual(fs.readFileSync(outputs.contactSheet), sentinel);
  assert.deepEqual(fs.readFileSync(outputs.receipt), receiptBefore);
});

test('public visual-check CLI preserves an unowned contact-sheet path', () => {
  const input = artifact('public-cli-evidence-collision.html');
  const outputs = sidecarPaths(input);
  const sentinel = Buffer.from('<!doctype html><title>independent artifact</title>\n');
  fs.writeFileSync(outputs.contactSheet, sentinel);

  const result = spawnSync(process.execPath, [
    path.join(skillRoot, 'bin', 'archify.mjs'),
    'visual-check',
    input,
    '--json',
  ], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_CHROME: '' },
  });

  assert.equal(result.status, 1, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.diagnostics.at(-1)?.code, 'viewer/evidence-path-conflict');
  assert.deepEqual(fs.readFileSync(outputs.contactSheet), sentinel);
  assert.equal(fs.existsSync(outputs.receipt), false);
});

test('visual-check fails closed without writes when sidecar directory identity is unknown', async () => {
  const input = artifact('unknown-sidecar-identity.html');
  const unknownIdentity = () => ({
    status: 'unknown',
    reason: { code: 'synthetic-identity-unavailable', systemCode: 'EACCES' },
  });
  const runOutDir = path.join(tmp, 'unknown-sidecar-run');
  let launched = false;

  const result = await runVisualCheck({
    artifactPath: input,
    outDir: runOutDir,
    chromePath: '/fake/chrome',
    compareSidecarParents: unknownIdentity,
    browserFactory: async () => {
      launched = true;
      return fakeBrowser();
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.status, 'fail');
  assert.match(result.receipt.error, /physical identity/i);
  assert.equal(result.receipt.diagnostics.at(-1)?.code, 'viewer/sidecar-directory-identity');
  assert.equal(
    result.receipt.diagnostics.at(-1)?.evidence?.comparison?.code,
    'synthetic-identity-unavailable',
  );
  assert.equal(launched, false);
  assert.equal(fs.existsSync(runOutDir), false, 'identity failure must precede evidence directory creation');

  const persistOutDir = path.join(tmp, 'unknown-sidecar-persist');
  const persistOutputs = sidecarPaths(input, { outDir: persistOutDir });
  fs.mkdirSync(persistOutDir, { recursive: true });
  const existingEvidence = [
    persistOutputs.receipt,
    persistOutputs.contactSheet,
    ...persistOutputs.screenshots.map((entry) => entry.path),
  ];
  for (const [index, file] of existingEvidence.entries()) {
    fs.writeFileSync(file, `existing evidence ${index}\n`);
  }
  const before = existingEvidence.map((file) => fs.readFileSync(file));
  const failure = persistVisualCheckFailure(input, {
    schemaVersion: 1,
    command: 'visual-check',
    artifact: { path: input },
    error: 'synthetic delivery failure',
    diagnostics: [{ code: 'delivery/provenance-failed' }],
  }, {
    outDir: persistOutDir,
    compareSidecarParents: unknownIdentity,
  });
  assert.match(failure.error, /physical identity/i);
  assert.equal(failure.diagnostics.at(-1)?.code, 'viewer/sidecar-directory-identity');
  assert.deepEqual(
    existingEvidence.map((file) => fs.readFileSync(file)),
    before,
    'failure persistence must not invalidate or replace evidence on unknown identity',
  );
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

test('visual-check refuses changed delivery evidence before launching a browser', async () => {
  const input = artifact('changed-before-browser.html');
  const outDir = path.join(tmp, 'changed-before-browser-evidence');
  const outputs = sidecarPaths(input, { outDir });
  const previous = await runVisualCheck({
    artifactPath: input,
    outDir,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });
  assert.equal(previous.exitCode, 0);
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
  assert.ok(outputs.screenshots.every((entry) => !fs.existsSync(entry.path)));
  assert.equal(fs.existsSync(sidecarPaths(input).receipt), false);
});

test('visual-check failure persistence refuses an unowned non-file evidence path', () => {
  const input = artifact('uncleanable-evidence.html');
  const outputs = sidecarPaths(input);
  fs.mkdirSync(outputs.screenshots[0].path);
  const receipt = persistVisualCheckFailure(input, {
    schemaVersion: 1, command: 'visual-check', artifact: { path: input },
    error: 'delivery failed', diagnostics: [{ code: 'delivery/provenance-failed' }],
  });
  assert.equal(receipt.diagnostics[1].code, 'viewer/evidence-path-conflict');
  assert.equal(receipt.diagnostics[1].subject.evidencePath, outputs.screenshots[0].path);
  assert.equal(fs.existsSync(outputs.receipt), false);
  assert.equal(fs.statSync(outputs.screenshots[0].path).isDirectory(), true);
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
  assert.ok(outputs.screenshots.every((entry) => !fs.existsSync(entry.path)));
});

test('visual-check preserves a screenshot-path claimant after post-capture provenance failure', async () => {
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
    'viewer/evidence-path-conflict',
  ]);
  assert.equal(result.receipt.diagnostics[1].subject.evidencePath, outputs.screenshots[0].path);
  assert.equal(fs.statSync(outputs.screenshots[0].path).isDirectory(), true);
  assert.equal(fs.existsSync(outputs.receipt), false);
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
  const previous = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });
  assert.equal(previous.exitCode, 0);

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

test('a no-Chrome rerun retires captures only when the successful receipt proves ownership', async () => {
  const input = artifact('no-chrome-owned-rerun.html');
  const outputs = sidecarPaths(input);
  const first = await runVisualCheck({
    artifactPath: input,
    chromePath: '/fake/chrome',
    browserFactory: async () => fakeBrowser(),
  });
  assert.equal(first.exitCode, 0);
  assert.equal(fs.existsSync(outputs.contactSheet), true);
  assert.equal(outputs.screenshots.every((entry) => fs.existsSync(entry.path)), true);

  const skipped = await runVisualCheck({ artifactPath: input, resolveChrome: () => null });

  assert.equal(skipped.exitCode, 2);
  assert.equal(JSON.parse(fs.readFileSync(outputs.receipt, 'utf8')).status, 'skipped');
  assert.equal(fs.existsSync(outputs.contactSheet), false);
  assert.equal(outputs.screenshots.every((entry) => !fs.existsSync(entry.path)), true);
  assert.deepEqual(stagingDirectories(path.dirname(outputs.receipt)), []);
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

test('visual-check reports local inspection cleanup failure alongside an evidence target conflict', async (t) => {
  const input = artifact('inspection-cleanup-target-conflict.html');
  const outDir = fs.mkdtempSync(path.join(tmp, 'inspection-cleanup-target-conflict-'));
  const outputs = sidecarPaths(input, { outDir });
  const sentinel = 'external receipt claimant\n';
  const browser = fakeBrowser();
  const inspect = browser.inspect.bind(browser);
  const rmdirSync = fs.rmdirSync.bind(fs);
  let inspectionDirectory;
  let claimed = false;
  let cleanupAttempts = 0;
  browser.inspect = async (args) => {
    inspectionDirectory = path.dirname(args.artifactPath);
    if (!claimed) {
      fs.writeFileSync(outputs.receipt, sentinel, { flag: 'wx' });
      claimed = true;
    }
    return inspect(args);
  };
  t.mock.method(fs, 'rmdirSync', (directory, ...args) => {
    if (String(directory) === inspectionDirectory) {
      cleanupAttempts += 1;
      throw Object.assign(new Error('synthetic inspection cleanup denied during target conflict'), {
        code: 'EACCES',
      });
    }
    return rmdirSync(directory, ...args);
  });
  t.after(() => {
    t.mock.restoreAll();
    if (inspectionDirectory) fs.rmSync(inspectionDirectory, { recursive: true, force: true });
    fs.rmSync(outDir, { recursive: true, force: true });
  });

  const result = await runVisualCheck({
    artifactPath: input,
    outDir,
    chromePath: '/fake/chrome',
    browserFactory: async () => browser,
  });

  assert.equal(claimed, true);
  assert.ok(cleanupAttempts > 0, 'the fixture must exercise local inspection cleanup failure');
  assert.equal(result.exitCode, 1);
  assert.equal(fs.readFileSync(outputs.receipt, 'utf8'), sentinel);
  assert.deepEqual(fs.readdirSync(inspectionDirectory), []);
  assert.deepEqual(stagingDirectories(outDir), []);
  const conflict = result.receipt.diagnostics.at(-1);
  assert.equal(conflict?.code, 'viewer/evidence-path-conflict');
  assert.ok(conflict.evidence.rollbackErrors?.some((entry) => (
    entry.file === inspectionDirectory
    && entry.recoveryDirectory === inspectionDirectory
    && /synthetic inspection cleanup denied/.test(entry.reason)
  )), 'the conflict must report the retained local inspection directory');
});
