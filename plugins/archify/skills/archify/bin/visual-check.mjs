import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const VISUAL_CHECK_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 1440, height: 900 }),
  Object.freeze({ width: 1600, height: 1000 }),
  Object.freeze({ width: 1920, height: 1080 }),
  Object.freeze({ width: 2048, height: 1320 }),
]);

const CAPTURE_VIEWPORTS = Object.freeze([
  Object.freeze({ width: 1440, height: 900 }),
  Object.freeze({ width: 2048, height: 1320 }),
]);
const THEMES = Object.freeze(['light', 'dark']);
const EXIT = Object.freeze({ pass: 0, fail: 1, skipped: 2 });

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function safeUnlink(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // A stale optional sidecar must never make the delivered HTML mutable.
  }
}

function writeAtomic(file, contents) {
  const temporary = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, contents, { flag: 'w' });
    fs.renameSync(temporary, file);
  } finally {
    safeUnlink(temporary);
  }
}

function screenshotKey(width, height, theme) {
  return `${width}x${height}:${theme}`;
}

export function sidecarPaths(artifactPath) {
  const artifact = path.resolve(artifactPath);
  const stem = artifact.replace(/\.html?$/i, '');
  const base = `${stem}.visual-check`;
  const screenshots = CAPTURE_VIEWPORTS.flatMap(({ width, height }) => THEMES.map((theme) => ({
    width,
    height,
    theme,
    path: `${base}.${width}x${height}.${theme}.png`,
  })));
  return {
    base,
    receipt: `${base}.json`,
    contactSheet: `${base}.html`,
    screenshots,
  };
}

function cleanupCaptureSidecars(paths) {
  safeUnlink(paths.contactSheet);
  for (const screenshot of paths.screenshots) safeUnlink(screenshot.path);
}

function executable(file, platform = process.platform) {
  if (!file) return null;
  try {
    fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return path.resolve(file);
  } catch {
    return null;
  }
}

function findOnPath(command, env, platform) {
  const directories = String(env.PATH || '').split(path.delimiter).filter(Boolean);
  const extensions = platform === 'win32'
    ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      const resolved = executable(candidate, platform);
      if (resolved) return resolved;
    }
  }
  return null;
}

export function findChrome({ env = process.env, platform = process.platform } = {}) {
  if (Object.prototype.hasOwnProperty.call(env, 'ARCHIFY_CHROME')) {
    return executable(env.ARCHIFY_CHROME, platform);
  }

  const fixed = [];
  const commands = [];
  if (platform === 'darwin') {
    fixed.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else if (platform === 'win32') {
    for (const root of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)) {
      fixed.push(
        path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(root, 'Chromium', 'Application', 'chrome.exe'),
      );
    }
  } else {
    commands.push('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser');
  }

  for (const candidate of fixed) {
    const resolved = executable(candidate, platform);
    if (resolved) return resolved;
  }
  for (const command of commands) {
    const resolved = findOnPath(command, env, platform);
    if (resolved) return resolved;
  }
  return null;
}

class PipeCdp {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.buffer = '';
    this.pending = new Map();
    this.waiters = [];
    child.stdio[4].setEncoding('utf8');
    child.stdio[4].on('data', (chunk) => this.consume(chunk));
    child.once('error', (error) => this.failAll(error));
    child.once('exit', (code) => this.failAll(new Error(`Chrome exited before visual-check completed (${code})`)));
  }

  consume(chunk) {
    this.buffer += chunk;
    let boundary;
    while ((boundary = this.buffer.indexOf('\0')) >= 0) {
      const raw = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 1);
      if (!raw) continue;
      let message;
      try {
        message = JSON.parse(raw);
      } catch (error) {
        this.failAll(new Error(`Chrome DevTools returned invalid JSON: ${error.message}`));
        continue;
      }
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        continue;
      }
      for (const waiter of [...this.waiters]) {
        if (waiter.method !== message.method) continue;
        if (waiter.sessionId && waiter.sessionId !== message.sessionId) continue;
        clearTimeout(waiter.timer);
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(message.params || {});
      }
    }
  }

  send(method, params = {}, sessionId = undefined, timeoutMs = 15000) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      this.child.stdio[3].write(`${JSON.stringify(message)}\0`);
    });
  }

  waitFor(method, sessionId, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const waiter = { method, sessionId, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error(`${method}: event timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
    this.waiters = [];
  }
}

async function evaluate(cdp, sessionId, expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description
      || response.exceptionDetails.text
      || 'Runtime.evaluate failed');
  }
  return response.result?.value;
}

class ChromeVisualBrowser {
  constructor(chromePath) {
    this.profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-check-profile-'));
    const args = [
      '--headless=new',
      '--remote-debugging-pipe',
      '--disable-gpu',
      '--hide-scrollbars',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-sync',
      '--metrics-recording-only',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--force-device-scale-factor=1',
      `--user-data-dir=${this.profileRoot}`,
      'about:blank',
    ];
    if (typeof process.getuid === 'function' && process.getuid() === 0) args.unshift('--no-sandbox');
    this.child = spawn(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    this.stderr = '';
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-8000);
    });
    this.cdp = new PipeCdp(this.child);
    this.sessionPromise = this.attach();
  }

  async attach() {
    const targets = await this.cdp.send('Target.getTargets');
    let target = targets.targetInfos?.find((item) => item.type === 'page');
    if (!target) {
      const created = await this.cdp.send('Target.createTarget', { url: 'about:blank' });
      target = { targetId: created.targetId };
    }
    const attached = await this.cdp.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    await this.cdp.send('Page.enable', {}, attached.sessionId);
    await this.cdp.send('Runtime.enable', {}, attached.sessionId);
    return attached.sessionId;
  }

  async inspect({ artifactPath, width, height, theme, screenshotPath }) {
    const sessionId = await this.sessionPromise;
    await this.cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);

    const url = new URL(pathToFileURL(artifactPath).href);
    url.searchParams.set('theme', theme);
    const loaded = this.cdp.waitFor('Page.loadEventFired', sessionId);
    const navigation = await this.cdp.send('Page.navigate', { url: url.href }, sessionId);
    if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
    await loaded;
    await evaluate(this.cdp, sessionId, `new Promise(function (resolve) {
      document.documentElement.setAttribute('data-motion', 'still');
      var panel = document.querySelector('.diagram-container');
      if (panel) panel.setAttribute('data-detail-level', 'read');
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    })`, true);

    const metrics = await evaluate(this.cdp, sessionId, `({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      scrollWidth: Math.ceil(document.documentElement.scrollWidth),
      scrollHeight: Math.ceil(document.documentElement.scrollHeight),
      resolvedTheme: document.documentElement.getAttribute('data-theme') || ''
    })`);
    if (!metrics || !Number.isFinite(metrics.scrollWidth) || !Number.isFinite(metrics.scrollHeight)) {
      throw new Error('Chrome returned incomplete containment metrics.');
    }

    if (screenshotPath) {
      const capture = await this.cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      }, sessionId, 20000);
      if (!capture.data) throw new Error('Chrome returned an empty screenshot.');
      fs.writeFileSync(screenshotPath, Buffer.from(capture.data, 'base64'));
    }
    return metrics;
  }

  async close() {
    this.cdp.failAll(new Error('visual-check finished'));
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGTERM');
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
          resolve();
        }, 1500);
        this.child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    try {
      fs.rmSync(this.profileRoot, { recursive: true, force: true });
    } catch {
      // Chrome may briefly retain profile files on Windows; evidence is done.
    }
  }
}

function observation({ width, height, theme, metrics }) {
  const innerWidth = Number(metrics.innerWidth);
  const innerHeight = Number(metrics.innerHeight);
  const scrollWidth = Number(metrics.scrollWidth);
  const scrollHeight = Number(metrics.scrollHeight);
  const overflowX = scrollWidth > innerWidth;
  const overflowY = scrollHeight > innerHeight;
  return {
    width,
    height,
    theme,
    innerWidth,
    innerHeight,
    scrollWidth,
    scrollHeight,
    overflowX,
    overflowY,
    ok: !overflowX && !overflowY,
    resolvedTheme: metrics.resolvedTheme || theme,
  };
}

function contactSheetHtml({ artifactPath, receipt, screenshots }) {
  const cards = screenshots.map((entry) => `
      <figure>
        <img src="${htmlEscape(entry.file)}" alt="${htmlEscape(`${entry.theme} ${entry.width} by ${entry.height}`)}">
        <figcaption><strong>${htmlEscape(entry.theme.toUpperCase())}</strong> · ${entry.width}×${entry.height} · containment ${entry.ok ? 'pass' : 'fail'}</figcaption>
      </figure>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Archify visual-check · ${htmlEscape(path.basename(artifactPath))}</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#e9eef5;color:#172033;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}header{max-width:1500px;margin:0 auto 18px}h1{margin:0 0 6px;font-size:20px}p{margin:0;color:#526176}.grid{max-width:1500px;margin:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}figure{margin:0;padding:10px;background:white;border:1px solid #c9d4e3;border-radius:12px;box-shadow:0 10px 30px rgba(15,23,42,.08)}img{display:block;width:100%;height:auto;border:1px solid #e2e8f0}figcaption{padding:9px 4px 2px;color:#526176}@media(max-width:900px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><h1>Archify visual-check</h1><p>${htmlEscape(path.basename(artifactPath))} · automated containment ${htmlEscape(receipt.containment.status)} · visual review pending</p></header>
<main class="grid">${cards}
</main>
</body>
</html>
`;
}

function baseReceipt({ artifactPath, artifact, outputs, chrome }) {
  return {
    schemaVersion: 1,
    ok: false,
    command: 'visual-check',
    status: 'fail',
    visualReview: 'pending',
    artifact: {
      path: artifactPath,
      sha256: sha256(artifact),
      bytes: artifact.byteLength,
    },
    state: { detail: 'read', motion: 'still' },
    chrome,
    containment: { status: 'fail', viewports: [] },
    captures: { status: 'fail', screenshots: [], contactSheet: null },
    sidecars: {
      receipt: path.basename(outputs.receipt),
      contactSheet: path.basename(outputs.contactSheet),
    },
  };
}

function persistReceipt(outputs, receipt) {
  writeAtomic(outputs.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
}

export async function runVisualCheck({
  artifactPath,
  chromePath,
  resolveChrome = findChrome,
  browserFactory = async (resolvedChrome) => new ChromeVisualBrowser(resolvedChrome),
} = {}) {
  if (!artifactPath) throw new Error('visual-check requires one delivered HTML artifact.');
  const artifact = path.resolve(artifactPath);
  if (!/\.html?$/i.test(artifact)) throw new Error('visual-check requires an .html artifact.');
  const artifactBytes = fs.readFileSync(artifact);
  const outputs = sidecarPaths(artifact);
  cleanupCaptureSidecars(outputs);
  safeUnlink(outputs.receipt);

  const resolvedChrome = chromePath || resolveChrome();
  const receipt = baseReceipt({
    artifactPath: artifact,
    artifact: artifactBytes,
    outputs,
    chrome: resolvedChrome
      ? { status: 'available', executable: resolvedChrome }
      : { status: 'unavailable', executable: null },
  });

  if (!resolvedChrome) {
    receipt.status = 'skipped';
    receipt.containment.status = 'skipped';
    receipt.captures.status = 'skipped';
    receipt.error = 'Chrome or Chromium is unavailable. Set ARCHIFY_CHROME to its executable path.';
    persistReceipt(outputs, receipt);
    return { exitCode: EXIT.skipped, receipt };
  }

  let browser;
  try {
    browser = await browserFactory(resolvedChrome);
    const observations = new Map();
    const screenshotsByKey = new Map(outputs.screenshots.map((entry) => [
      screenshotKey(entry.width, entry.height, entry.theme),
      entry,
    ]));

    for (const viewport of VISUAL_CHECK_VIEWPORTS) {
      const key = screenshotKey(viewport.width, viewport.height, 'light');
      const screenshot = screenshotsByKey.get(key);
      const metrics = await browser.inspect({
        artifactPath: artifact,
        ...viewport,
        theme: 'light',
        ...(screenshot ? { screenshotPath: screenshot.path } : {}),
      });
      observations.set(key, observation({ ...viewport, theme: 'light', metrics }));
    }
    for (const viewport of CAPTURE_VIEWPORTS) {
      const key = screenshotKey(viewport.width, viewport.height, 'dark');
      const screenshot = screenshotsByKey.get(key);
      const metrics = await browser.inspect({
        artifactPath: artifact,
        ...viewport,
        theme: 'dark',
        screenshotPath: screenshot.path,
      });
      observations.set(key, observation({ ...viewport, theme: 'dark', metrics }));
    }

    const afterBytes = fs.readFileSync(artifact);
    if (sha256(afterBytes) !== receipt.artifact.sha256 || afterBytes.byteLength !== receipt.artifact.bytes) {
      throw new Error('The delivered artifact changed while visual-check was running.');
    }

    receipt.containment.viewports = VISUAL_CHECK_VIEWPORTS.map(({ width, height }) => (
      observations.get(screenshotKey(width, height, 'light'))
    ));
    receipt.captures.screenshots = outputs.screenshots.map((entry) => ({
      ...observations.get(screenshotKey(entry.width, entry.height, entry.theme)),
      file: path.basename(entry.path),
    }));
    const allObservations = [...observations.values()];
    const containmentPass = allObservations.every((entry) => entry.ok);
    receipt.containment.status = containmentPass ? 'pass' : 'fail';
    receipt.captures.status = 'pass';
    receipt.captures.contactSheet = path.basename(outputs.contactSheet);
    receipt.status = containmentPass ? 'pass' : 'fail';
    receipt.ok = containmentPass;
    writeAtomic(outputs.contactSheet, contactSheetHtml({
      artifactPath: artifact,
      receipt,
      screenshots: receipt.captures.screenshots,
    }));
    persistReceipt(outputs, receipt);
    return { exitCode: containmentPass ? EXIT.pass : EXIT.fail, receipt };
  } catch (error) {
    cleanupCaptureSidecars(outputs);
    receipt.status = 'fail';
    receipt.ok = false;
    receipt.error = error.message;
    receipt.containment.status = 'fail';
    receipt.captures.status = 'fail';
    receipt.captures.screenshots = [];
    receipt.captures.contactSheet = null;
    persistReceipt(outputs, receipt);
    return { exitCode: EXIT.fail, receipt };
  } finally {
    if (browser?.close) await browser.close();
  }
}
