import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DESKTOP_READABILITY_VIEWPORT,
  MIN_PROJECTED_NODE_TEXT_PX,
} from '../renderers/shared/desktop-readability.mjs';

export const VISUAL_CHECK_VIEWPORTS = Object.freeze([
  DESKTOP_READABILITY_VIEWPORT,
  Object.freeze({ width: 1600, height: 1000 }),
  Object.freeze({ width: 1920, height: 1080 }),
  Object.freeze({ width: 2048, height: 1320 }),
]);

const CAPTURE_VIEWPORTS = Object.freeze([
  VISUAL_CHECK_VIEWPORTS[0],
  VISUAL_CHECK_VIEWPORTS[VISUAL_CHECK_VIEWPORTS.length - 1],
]);
const THEMES = Object.freeze(['light', 'dark']);
const EXIT = Object.freeze({ pass: 0, fail: 1, skipped: 2 });
export const CHROME_NO_SANDBOX_ENV = 'ARCHIFY_CHROME_NO_SANDBOX';

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
  constructor(child, { failureDetails = () => '' } = {}) {
    this.child = child;
    this.failureDetails = failureDetails;
    this.nextId = 1;
    this.buffer = '';
    this.pending = new Map();
    this.waiters = [];
    this.writePipe = child.stdio[3];
    this.readPipe = child.stdio[4];
    this.readPipe.setEncoding('utf8');
    this.readPipe.on('data', (chunk) => this.consume(chunk));
    this.writePipe.on('error', (error) => this.failAll(this.failure('write pipe', error)));
    this.readPipe.on('error', (error) => this.failAll(this.failure('read pipe', error)));
    child.once('error', (error) => this.failAll(this.failure('process launch', error)));
    child.once('close', (code, signal) => {
      const ending = signal ? `signal ${signal}` : `exit code ${code}`;
      this.failAll(this.failure('process exit', new Error(`Chrome closed with ${ending}`)));
    });
  }

  failure(stage, error) {
    const code = error?.code ? ` [${error.code}]` : '';
    const details = this.failureDetails();
    return new Error([
      `Chrome DevTools ${stage} failed: ${error?.message || String(error)}${code}`,
      details,
    ].filter(Boolean).join('\n'));
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
      try {
        this.writePipe.write(`${JSON.stringify(message)}\0`, (error) => {
          if (error) this.failAll(this.failure('write pipe', error));
        });
      } catch (error) {
        this.failAll(this.failure('write pipe', error));
      }
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

export function chromeVisualBrowserArgs(profileRoot, {
  env = process.env,
  getuid = typeof process.getuid === 'function' ? () => process.getuid() : null,
} = {}) {
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
    `--user-data-dir=${profileRoot}`,
    'about:blank',
  ];
  const rootUser = typeof getuid === 'function' && getuid() === 0;
  const sandboxOptOut = env?.[CHROME_NO_SANDBOX_ENV] === '1';
  if (rootUser || sandboxOptOut) args.unshift('--no-sandbox');
  return args;
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

export class ChromeVisualBrowser {
  constructor(chromePath, {
    env = process.env,
    getuid = typeof process.getuid === 'function' ? () => process.getuid() : null,
    spawnImpl = spawn,
  } = {}) {
    this.profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-check-profile-'));
    this.stderr = '';
    const args = chromeVisualBrowserArgs(this.profileRoot, { env, getuid });
    this.child = spawnImpl(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-8000);
    });
    this.child.stderr.on('error', (error) => {
      this.stderr = `${this.stderr}\nChrome stderr stream failed: ${error.message}`.trim().slice(-8000);
    });
    this.cdp = new PipeCdp(this.child, {
      failureDetails: () => {
        const exit = this.child.signalCode
          ? `signal ${this.child.signalCode}`
          : this.child.exitCode == null ? 'still running' : `exit code ${this.child.exitCode}`;
        const stderr = this.stderr.trim();
        return [
          `Chrome process: ${exit}.`,
          stderr ? `Chrome stderr:\n${stderr}` : '',
        ].filter(Boolean).join('\n');
      },
    });
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
    await evaluate(this.cdp, sessionId, `(function () {
      document.documentElement.setAttribute('data-motion', 'still');
      var panel = document.querySelector('.diagram-container');
      if (panel) panel.setAttribute('data-detail-level', 'read');
      var fontsReady = document.fonts && document.fonts.ready
        ? document.fonts.ready.catch(function () {})
        : Promise.resolve();
      return fontsReady.then(function () {
        if (window.Archify && Archify.readerLayout && typeof Archify.readerLayout.whenStable === 'function') {
          return Archify.readerLayout.whenStable();
        }
      }).then(function () {
        if (window.Archify && Archify.viewerChromeLayout && typeof Archify.viewerChromeLayout.whenStable === 'function') {
          return Archify.viewerChromeLayout.whenStable();
        }
      }).then(function () {
        if (window.Archify && Archify.readerLayout && typeof Archify.readerLayout.whenStable === 'function') {
          return Archify.readerLayout.whenStable();
        }
      }).then(function () {
        if (window.Archify && Archify.viewerChromeLayout && typeof Archify.viewerChromeLayout.whenStable === 'function') {
          return Archify.viewerChromeLayout.whenStable();
        }
        return new Promise(function (resolve) {
          requestAnimationFrame(function () { requestAnimationFrame(resolve); });
        });
      });
    })()`, true);

    const metrics = await evaluate(this.cdp, sessionId, `(function () {
      var reader = document.querySelector('.container');
      var diagram = document.querySelector('.diagram-container');
      var svg = diagram && (
        diagram.querySelector(':scope > svg') ||
        diagram.querySelector(':scope > .diagram-stage > svg')
      );
      var stage = diagram && (diagram.querySelector(':scope > .diagram-stage') || svg);
      var legend = svg && svg.querySelector('[data-legend]');
      var navigationDock = diagram && diagram.querySelector('.diagram-nav');
      var viewBox = svg && svg.viewBox && svg.viewBox.baseVal;
      var diagramWidth = svg ? svg.getBoundingClientRect().width : 0;
      var viewBoxWidth = viewBox ? viewBox.width : 0;
      var scale = viewBoxWidth > 0 ? Math.min(1, diagramWidth / viewBoxWidth) : 0;
      var minimum = null;
      if (svg && scale > 0) {
        Array.from(svg.querySelectorAll('text[data-node-label], text[data-boundary-label], text[data-detail="context"]')).forEach(function (text) {
          var detail = text.hasAttribute('data-node-label')
            ? 'primary'
            : text.hasAttribute('data-boundary-label') ? 'boundary' : 'context';
          if (detail === 'context' && !text.closest('[data-node-id]')) return;
          var sourceFontPx = parseFloat(text.getAttribute('font-size') || '');
          if (!Number.isFinite(sourceFontPx)) return;
          var projectedFontPx = sourceFontPx * scale;
          if (!minimum || projectedFontPx < minimum.projectedFontPx) {
            minimum = {
              text: (text.textContent || '').trim(),
              detail: detail,
              sourceFontPx: sourceFontPx,
              projectedFontPx: projectedFontPx
            };
          }
        });
      }
      function intersectionArea(a, b) {
        if (!a || !b || !a.width || !a.height || !b.width || !b.height) return 0;
        var width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        var height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return width * height;
      }
      var legendRect = legend ? legend.getBoundingClientRect() : null;
      var stageRect = window.Archify && Archify.viewerChromeLayout
        && typeof Archify.viewerChromeLayout.stageRect === 'function'
        ? Archify.viewerChromeLayout.stageRect()
        : (stage ? stage.getBoundingClientRect() : null);
      var navigationDockRect = navigationDock ? navigationDock.getBoundingClientRect() : null;
      var stageDockIntersectionArea = intersectionArea(stageRect, navigationDockRect);
      var viewerChromeReceipt = window.Archify && Archify.viewerChromeLayout
        && typeof Archify.viewerChromeLayout.receipt === 'function'
        ? Archify.viewerChromeLayout.receipt()
        : null;
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: Math.ceil(document.documentElement.scrollWidth),
        scrollHeight: Math.ceil(document.documentElement.scrollHeight),
        resolvedTheme: document.documentElement.getAttribute('data-theme') || '',
        readerWidth: reader ? reader.getBoundingClientRect().width : 0,
        diagramWidth: diagramWidth,
        viewBoxWidth: viewBoxWidth,
        minimumProjectedNodeTextPx: minimum ? minimum.projectedFontPx : null,
        minimumProjectedNodeText: minimum ? minimum.text : null,
        minimumProjectedNodeTextDetail: minimum ? minimum.detail : null,
        hasLegend: Boolean(legendRect && legendRect.width && legendRect.height),
        hasNavigationDock: Boolean(navigationDockRect && navigationDockRect.width && navigationDockRect.height),
        legendDockIntersectionArea: stageDockIntersectionArea > 0
          ? intersectionArea(legendRect, navigationDockRect)
          : 0,
        dockStageIntersectionArea: stageDockIntersectionArea,
        dockStageGap: stageRect && navigationDockRect ? navigationDockRect.top - stageRect.bottom : null,
        viewerChromeRequiredGap: viewerChromeReceipt ? viewerChromeReceipt.gap : null,
        viewerChromeReserve: viewerChromeReceipt ? viewerChromeReceipt.reserve : 0,
        viewerChromeActive: viewerChromeReceipt ? viewerChromeReceipt.active : false
      };
    })()`);
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
  const minimumProjectedNodeTextPx = metrics.minimumProjectedNodeTextPx == null
    ? null
    : Number(metrics.minimumProjectedNodeTextPx);
  const readabilityOk = minimumProjectedNodeTextPx == null
    || minimumProjectedNodeTextPx >= MIN_PROJECTED_NODE_TEXT_PX;
  const legendDockIntersectionArea = Number(metrics.legendDockIntersectionArea) || 0;
  const dockStageIntersectionArea = Number(metrics.dockStageIntersectionArea) || 0;
  const dockStageGap = metrics.dockStageGap == null ? null : Number(metrics.dockStageGap);
  const receiptDockStageGap = metrics.viewerChromeRequiredGap == null
    ? null
    : Number(metrics.viewerChromeRequiredGap);
  const requiredDockStageGap = Number.isFinite(receiptDockStageGap) ? receiptDockStageGap : 0;
  const viewerChromeStageOk = !metrics.hasNavigationDock || (
    Number.isFinite(dockStageGap)
    && dockStageIntersectionArea <= 0.5
    && dockStageGap >= requiredDockStageGap - 1
  );
  const viewerChromeOk = legendDockIntersectionArea <= 0.5 && viewerChromeStageOk;
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
    readerWidth: Number(metrics.readerWidth) || null,
    diagramWidth: Number(metrics.diagramWidth) || null,
    viewBoxWidth: Number(metrics.viewBoxWidth) || null,
    minimumProjectedNodeTextPx,
    minimumProjectedNodeText: metrics.minimumProjectedNodeText || null,
    minimumProjectedNodeTextDetail: metrics.minimumProjectedNodeTextDetail || null,
    minimumRequiredNodeTextPx: MIN_PROJECTED_NODE_TEXT_PX,
    readabilityOk,
    hasLegend: Boolean(metrics.hasLegend),
    hasNavigationDock: Boolean(metrics.hasNavigationDock),
    legendDockIntersectionArea,
    dockStageIntersectionArea,
    dockStageGap,
    requiredDockStageGap,
    viewerChromeStageOk,
    viewerChromeReserve: Number(metrics.viewerChromeReserve) || 0,
    viewerChromeActive: Boolean(metrics.viewerChromeActive),
    viewerChromeOk,
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
<title>Archify automated browser evidence · ${htmlEscape(path.basename(artifactPath))}</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#e9eef5;color:#172033;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}header{max-width:1500px;margin:0 auto 18px}h1{margin:0 0 6px;font-size:20px}p{margin:0;color:#526176}.grid{max-width:1500px;margin:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}figure{margin:0;padding:10px;background:white;border:1px solid #c9d4e3;border-radius:12px;box-shadow:0 10px 30px rgba(15,23,42,.08)}img{display:block;width:100%;height:auto;border:1px solid #e2e8f0}figcaption{padding:9px 4px 2px;color:#526176}@media(max-width:900px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><h1>Automated browser evidence</h1><p>${htmlEscape(path.basename(artifactPath))} · visual-check containment ${htmlEscape(receipt.containment.status)} · perceptual visual review pending</p></header>
<main class="grid">${cards}
</main>
</body>
</html>
`;
}

function viewportSubject(artifact, entry) {
  return {
    artifact,
    viewport: { width: entry.width, height: entry.height, theme: entry.theme },
  };
}

function failureDiagnostic({ code, message, subject, evidence, supportedFixes, severity = 'error' }) {
  return { code, severity, message, subject, evidence, supportedFixes };
}

function observationDiagnostics({ artifact, allObservations, readabilityObservations }) {
  const diagnostics = [];
  for (const entry of allObservations) {
    if (!entry.ok) {
      diagnostics.push(failureDiagnostic({
        code: 'viewer/viewport-overflow',
        message: `The rendered artifact overflows the ${entry.width}x${entry.height} ${entry.theme} viewport.`,
        subject: viewportSubject(artifact, entry),
        evidence: {
          innerWidth: entry.innerWidth,
          innerHeight: entry.innerHeight,
          scrollWidth: entry.scrollWidth,
          scrollHeight: entry.scrollHeight,
          overflowX: entry.overflowX,
          overflowY: entry.overflowY,
        },
        supportedFixes: [
          `contain the rendered layout within ${entry.width}x${entry.height}, then rerun visual-check`,
        ],
      }));
    }
    if (entry.legendDockIntersectionArea > 0.5) {
      diagnostics.push(failureDiagnostic({
        code: 'viewer/chrome-legend-clearance',
        message: `The navigation Dock obscures the SVG Legend at ${entry.width}x${entry.height} (${entry.theme}).`,
        subject: viewportSubject(artifact, entry),
        evidence: { legendDockIntersectionArea: entry.legendDockIntersectionArea },
        supportedFixes: [
          'move the SVG Legend or Viewer Dock until legendDockIntersectionArea is 0, then rerun visual-check',
        ],
      }));
    }
    if (!entry.viewerChromeStageOk) {
      const stageOverlapsDock = entry.dockStageIntersectionArea > 0.5;
      diagnostics.push(failureDiagnostic({
        code: 'viewer/chrome-stage-clearance',
        message: stageOverlapsDock
          ? `Navigation Dock enters the protected SVG stage at ${entry.width}x${entry.height} (${entry.theme}).`
          : `Navigation Dock clearance from the protected SVG stage is below the required gap at ${entry.width}x${entry.height} (${entry.theme}).`,
        subject: viewportSubject(artifact, entry),
        evidence: {
          dockStageIntersectionArea: entry.dockStageIntersectionArea,
          dockStageGap: entry.dockStageGap,
          requiredDockStageGap: entry.requiredDockStageGap,
        },
        supportedFixes: [
          `adjust Viewer stage reservation or clipping until dockStageGap is at least ${entry.requiredDockStageGap} and dockStageIntersectionArea is 0, then rerun visual-check`,
        ],
      }));
    }
  }
  for (const entry of readabilityObservations) {
    if (entry.readabilityOk) continue;
    diagnostics.push(failureDiagnostic({
      code: 'viewer/projected-text-readability',
      message: `Projected ${entry.minimumProjectedNodeTextDetail || 'node'} text is below the readability floor at ${entry.width}x${entry.height}.`,
      subject: viewportSubject(artifact, entry),
      evidence: {
        text: entry.minimumProjectedNodeText,
        detail: entry.minimumProjectedNodeTextDetail,
        minimumProjectedNodeTextPx: entry.minimumProjectedNodeTextPx,
        minimumRequiredNodeTextPx: entry.minimumRequiredNodeTextPx,
      },
      supportedFixes: [
        `increase projected node text to at least ${entry.minimumRequiredNodeTextPx}px at ${entry.width}x${entry.height}, then rerun visual-check`,
      ],
    }));
  }
  return diagnostics;
}

function baseReceipt({ artifactPath, artifact, outputs, chrome }) {
  return {
    schemaVersion: 1,
    ok: false,
    command: 'visual-check',
    evidenceKind: 'automated-browser',
    status: 'fail',
    visualReview: 'pending',
    artifact: {
      path: artifactPath,
      sha256: sha256(artifact),
      bytes: artifact.byteLength,
    },
    state: { detail: 'read', motion: 'still' },
    chrome,
    diagnostics: [],
    containment: { status: 'fail', viewports: [] },
    readability: { status: 'fail', minimumProjectedNodeTextPx: MIN_PROJECTED_NODE_TEXT_PX, viewports: [] },
    viewerChrome: { status: 'fail', viewports: [] },
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
    receipt.readability.status = 'skipped';
    receipt.viewerChrome.status = 'skipped';
    receipt.captures.status = 'skipped';
    receipt.error = 'Chrome or Chromium is unavailable. Set ARCHIFY_CHROME to its executable path.';
    receipt.diagnostics = [failureDiagnostic({
      code: 'viewer/chrome-unavailable',
      severity: 'warning',
      message: receipt.error,
      subject: { artifact },
      evidence: { executable: null },
      supportedFixes: ['set ARCHIFY_CHROME to a Chrome or Chromium executable and rerun visual-check'],
    })];
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
    receipt.readability.viewports = receipt.containment.viewports.map((entry) => ({ ...entry }));
    receipt.viewerChrome.viewports = receipt.containment.viewports.map((entry) => ({ ...entry }));
    receipt.captures.screenshots = outputs.screenshots.map((entry) => ({
      ...observations.get(screenshotKey(entry.width, entry.height, entry.theme)),
      file: path.basename(entry.path),
    }));
    const allObservations = [...observations.values()];
    const containmentPass = allObservations.every((entry) => entry.ok);
    const readabilityPass = receipt.readability.viewports.every((entry) => entry.readabilityOk);
    const viewerChromePass = allObservations.every((entry) => entry.viewerChromeOk);
    receipt.diagnostics = observationDiagnostics({
      artifact,
      allObservations,
      readabilityObservations: receipt.readability.viewports,
    });
    receipt.containment.status = containmentPass ? 'pass' : 'fail';
    receipt.readability.status = readabilityPass ? 'pass' : 'fail';
    receipt.viewerChrome.status = viewerChromePass ? 'pass' : 'fail';
    receipt.captures.status = 'pass';
    receipt.captures.contactSheet = path.basename(outputs.contactSheet);
    receipt.status = containmentPass && readabilityPass && viewerChromePass ? 'pass' : 'fail';
    receipt.ok = containmentPass && readabilityPass && viewerChromePass;
    writeAtomic(outputs.contactSheet, contactSheetHtml({
      artifactPath: artifact,
      receipt,
      screenshots: receipt.captures.screenshots,
    }));
    persistReceipt(outputs, receipt);
    return { exitCode: receipt.ok ? EXIT.pass : EXIT.fail, receipt };
  } catch (error) {
    cleanupCaptureSidecars(outputs);
    receipt.status = 'fail';
    receipt.ok = false;
    receipt.error = error.message;
    receipt.containment.status = 'fail';
    receipt.readability.status = 'fail';
    receipt.viewerChrome.status = 'fail';
    receipt.captures.status = 'fail';
    receipt.captures.screenshots = [];
    receipt.captures.contactSheet = null;
    receipt.diagnostics = [failureDiagnostic({
      code: 'viewer/visual-check-runtime',
      message: 'visual-check could not complete its Chrome inspection.',
      subject: { artifact },
      evidence: { reason: error.message },
      supportedFixes: ['resolve the reported Chrome inspection error, then rerun visual-check'],
    })];
    persistReceipt(outputs, receipt);
    return { exitCode: EXIT.fail, receipt };
  } finally {
    if (browser?.close) await browser.close();
  }
}
