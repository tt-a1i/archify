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
export const VISUAL_PREFLIGHT_VIEWPORTS = VISUAL_CHECK_VIEWPORTS;
export const VISUAL_RECEIPT_SCHEMA_VERSION = 2;

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

class ScreenshotEvidenceError extends Error {
  constructor(message, evidence) {
    super(message);
    this.name = 'ScreenshotEvidenceError';
    this.evidence = evidence;
  }
}

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const PNG_CRC_TABLE = Object.freeze(Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value >>> 0;
}));

function pngCrc32(parts) {
  let crc = 0xffffffff;
  for (const part of parts) {
    for (const byte of part) {
      crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ byte) & 0xff];
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function parsePngStructure(buffer) {
  if (buffer.byteLength < 45 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('missing PNG signature or required chunks');
  }
  let offset = 8;
  let width = null;
  let height = null;
  let sawIdat = false;
  let sawIend = false;
  let chunkIndex = 0;
  while (offset < buffer.byteLength) {
    if (offset + 12 > buffer.byteLength) throw new Error('truncated PNG chunk header');
    const length = buffer.readUInt32BE(offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const chunkEnd = dataEnd + 4;
    if (chunkEnd > buffer.byteLength) throw new Error('truncated PNG chunk data');
    const typeBytes = buffer.subarray(typeStart, dataStart);
    const type = typeBytes.toString('ascii');
    const data = buffer.subarray(dataStart, dataEnd);
    if (buffer.readUInt32BE(dataEnd) !== pngCrc32([typeBytes, data])) {
      throw new Error(`invalid ${type || 'unknown'} chunk CRC`);
    }
    if (chunkIndex === 0 && (type !== 'IHDR' || length !== 13)) {
      throw new Error('first chunk must be a 13-byte IHDR');
    }
    if (type === 'IHDR') {
      if (chunkIndex !== 0 || width !== null) throw new Error('duplicate or misplaced IHDR');
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (width < 1 || height < 1) throw new Error('IHDR dimensions must be positive');
      if (data[10] !== 0 || data[11] !== 0 || ![0, 1].includes(data[12])) {
        throw new Error('unsupported IHDR compression, filter, or interlace method');
      }
    } else if (type === 'IDAT') {
      if (width === null || sawIend) throw new Error('misplaced IDAT');
      sawIdat = true;
    } else if (type === 'IEND') {
      if (length !== 0 || !sawIdat) throw new Error('invalid IEND or missing IDAT');
      sawIend = true;
      if (chunkEnd !== buffer.byteLength) throw new Error('data follows IEND');
    }
    offset = chunkEnd;
    chunkIndex += 1;
  }
  if (width === null || !sawIdat || !sawIend) throw new Error('missing IHDR, IDAT, or IEND');
  return { width, height };
}

function screenshotEvidence(file, { width, height }) {
  let buffer;
  try {
    buffer = fs.readFileSync(file);
  } catch (error) {
    throw new ScreenshotEvidenceError(
      `The expected screenshot could not be read: ${error.message}`,
      { file, expected: { width, height }, actual: null, reason: error.message },
    );
  }
  let pixels;
  try {
    pixels = parsePngStructure(buffer);
  } catch (error) {
    throw new ScreenshotEvidenceError(
      `Chrome screenshot evidence does not have a complete PNG chunk structure: ${error.message}.`,
      {
        file,
        expected: { width, height },
        actual: null,
        bytes: buffer.byteLength,
        sha256: sha256(buffer),
      },
    );
  }
  const pixelWidth = pixels.width;
  const pixelHeight = pixels.height;
  if (pixelWidth !== width || pixelHeight !== height) {
    throw new ScreenshotEvidenceError(
      `Chrome screenshot pixels ${pixelWidth}x${pixelHeight} do not match the requested ${width}x${height} viewport.`,
      {
        file,
        expected: { width, height },
        actual: { width: pixelWidth, height: pixelHeight },
        bytes: buffer.byteLength,
        sha256: sha256(buffer),
      },
    );
  }
  return {
    sha256: sha256(buffer),
    bytes: buffer.byteLength,
    pixelWidth,
    pixelHeight,
  };
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

export function preflightSidecarPaths(artifactPath) {
  const artifact = path.resolve(artifactPath);
  const stem = artifact.replace(/\.html?$/i, '');
  const base = `${stem}.visual-preflight`;
  return {
    base,
    receipt: `${base}.json`,
    diagnosticScreenshot: `${base}.diagnostic.png`,
  };
}

function pathIdentity(file, platform = process.platform) {
  const resolved = path.resolve(file);
  let identity = resolved;
  try {
    identity = fs.realpathSync.native(resolved);
  } catch {
    try {
      identity = path.join(fs.realpathSync.native(path.dirname(resolved)), path.basename(resolved));
    } catch {
      // Artifact validation owns missing parents. The audit still catches
      // lexical aliases when no filesystem identity can be established.
    }
  }
  if (platform === 'darwin') return identity.normalize('NFD').toLowerCase();
  if (platform === 'win32') return identity.toLowerCase();
  return identity;
}

function evidencePaths(artifactPath, mode) {
  if (mode === 'preflight') {
    const outputs = preflightSidecarPaths(artifactPath);
    return [
      { role: 'receipt', path: outputs.receipt },
      { role: 'diagnostic-screenshot', path: outputs.diagnosticScreenshot },
    ];
  }
  const outputs = sidecarPaths(artifactPath);
  return [
    { role: 'receipt', path: outputs.receipt },
    { role: 'contact-sheet', path: outputs.contactSheet },
    ...outputs.screenshots.map((entry) => ({
      role: `screenshot:${entry.width}x${entry.height}:${entry.theme}`,
      path: entry.path,
    })),
  ];
}

/**
 * Resolve the evidence namespace for a multi-artifact invocation before any
 * browser work or sidecar cleanup begins. Single-artifact sidecar naming stays
 * backward compatible; a batch must prove that every artifact and evidence
 * file has an independent path.
 */
export function auditVisualCheckBatch(artifactPaths, {
  mode = 'full',
  platform = process.platform,
} = {}) {
  if (!Array.isArray(artifactPaths)) throw new TypeError('artifactPaths must be an array.');
  if (!['full', 'preflight'].includes(mode)) {
    throw new Error(`Unknown visual-check batch mode ${JSON.stringify(mode)}.`);
  }

  const artifacts = artifactPaths.map((input, index) => ({
    index,
    input,
    path: path.resolve(input),
  }));
  if (artifacts.length < 2) return { ok: true, artifacts, conflicts: [] };

  const artifactsByIdentity = new Map();
  for (const artifact of artifacts) {
    const identity = pathIdentity(artifact.path, platform);
    const group = artifactsByIdentity.get(identity) || [];
    group.push(artifact);
    artifactsByIdentity.set(identity, group);
  }
  const duplicateArtifacts = [...artifactsByIdentity.values()].filter((group) => group.length > 1);
  if (duplicateArtifacts.length) {
    const conflicts = duplicateArtifacts.map((group) => ({
      kind: 'artifact-path',
      path: group[0].path,
      indexes: group.map((entry) => entry.index),
      inputs: group.map((entry) => entry.input),
    }));
    return {
      ok: false,
      code: 'viewer/artifact-path-collision',
      message: `The visual-check batch resolves multiple inputs to the same artifact path: ${conflicts[0].path}`,
      artifacts,
      conflicts,
    };
  }

  const evidenceByIdentity = new Map();
  for (const artifact of artifacts) {
    for (const evidence of evidencePaths(artifact.path, mode)) {
      const entry = { ...evidence, artifactIndex: artifact.index, artifact: artifact.path };
      const identity = pathIdentity(entry.path, platform);
      const group = evidenceByIdentity.get(identity) || [];
      group.push(entry);
      evidenceByIdentity.set(identity, group);
    }
  }

  const conflicts = [];
  for (const group of evidenceByIdentity.values()) {
    const owners = new Set(group.map((entry) => entry.artifactIndex));
    if (owners.size > 1) {
      conflicts.push({
        kind: 'evidence-path',
        path: group[0].path,
        evidence: group,
      });
    }
  }
  for (const group of evidenceByIdentity.values()) {
    const artifactGroup = artifactsByIdentity.get(pathIdentity(group[0].path, platform));
    if (artifactGroup) {
      conflicts.push({
        kind: 'artifact-evidence-path',
        path: group[0].path,
        artifacts: artifactGroup.map((entry) => ({ index: entry.index, path: entry.path })),
        evidence: group,
      });
    }
  }

  if (conflicts.length) {
    return {
      ok: false,
      code: 'viewer/evidence-path-collision',
      message: `The visual-check batch would overwrite shared artifact or evidence paths: ${conflicts[0].path}`,
      artifacts,
      conflicts,
    };
  }
  return { ok: true, artifacts, conflicts: [] };
}

function cleanupCaptureSidecars(paths) {
  safeUnlink(paths.contactSheet);
  for (const screenshot of paths.screenshots) safeUnlink(screenshot.path);
}

function cleanupPreflightSidecars(paths) {
  safeUnlink(paths.diagnosticScreenshot);
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
  const sandboxOptOut = env?.[CHROME_NO_SANDBOX_ENV] === '1';
  // Disabling Chrome's sandbox is always an explicit operator decision. In
  // particular, root execution is reported by the capability probe instead
  // of silently weakening the browser launch contract.
  if (sandboxOptOut) args.unshift('--no-sandbox');
  return args;
}

function chromeSandboxReceipt(env = process.env) {
  const explicitlyDisabled = env?.[CHROME_NO_SANDBOX_ENV] === '1';
  return {
    status: explicitlyDisabled ? 'disabled-explicitly' : 'enabled',
    automaticOptOut: false,
    optOutEnvironment: CHROME_NO_SANDBOX_ENV,
  };
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
    spawnImpl = spawn,
  } = {}) {
    this.profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-check-profile-'));
    this.stderr = '';
    const args = chromeVisualBrowserArgs(this.profileRoot, { env });
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
    this.loadedArtifactTheme = null;
    this.sessionPromise = this.attach();
  }

  async probe() {
    const sessionId = await this.sessionPromise;
    const [version, runtime] = await Promise.all([
      this.cdp.send('Browser.getVersion'),
      evaluate(this.cdp, sessionId, '({ ready: true, href: location.href })'),
    ]);
    if (!runtime?.ready) throw new Error('Chrome Runtime.evaluate probe returned an incomplete result.');
    return {
      protocolVersion: version.protocolVersion || null,
      product: version.product || null,
      revision: version.revision || null,
      userAgent: version.userAgent || null,
      jsVersion: version.jsVersion || null,
      runtime,
    };
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
    if (this.loadedArtifactTheme !== url.href) {
      const loaded = this.cdp.waitFor('Page.loadEventFired', sessionId);
      const navigation = await this.cdp.send('Page.navigate', { url: url.href }, sessionId);
      if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
      await loaded;
      this.loadedArtifactTheme = url.href;
    }
    await evaluate(this.cdp, sessionId, `(function () {
      document.documentElement.setAttribute('data-motion', 'still');
      var panel = document.querySelector('.diagram-container');
      if (panel) panel.setAttribute('data-detail-level', 'read');
      function stableRound() {
        var barriers = [];
        if (window.Archify && Archify.readerLayout && typeof Archify.readerLayout.whenStable === 'function') {
          barriers.push(Archify.readerLayout.whenStable());
        }
        if (window.Archify && Archify.viewerChromeLayout && typeof Archify.viewerChromeLayout.whenStable === 'function') {
          barriers.push(Archify.viewerChromeLayout.whenStable());
        }
        return Promise.all(barriers);
      }
      var fontsReady = document.fonts && document.fonts.ready
        ? document.fonts.ready.catch(function () {})
        : Promise.resolve();
      return fontsReady.then(stableRound).then(stableRound).then(function () {
        return new Promise(function (resolve) {
          requestAnimationFrame(function () { requestAnimationFrame(resolve); });
        });
      });
    })()`, true);

    const metrics = await evaluate(this.cdp, sessionId, `(function () {
      var reader = document.querySelector('.container');
      var diagram = document.querySelector('.diagram-container');
      var header = reader && reader.querySelector('.header');
      var guided = reader && reader.querySelector('.guided-views');
      var cards = reader && reader.querySelector('.cards');
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
      var readerLayoutReceipt = window.Archify && Archify.readerLayout
        && typeof Archify.readerLayout.receipt === 'function'
        ? Archify.readerLayout.receipt()
        : null;
      function number(value) {
        var parsed = parseFloat(value);
        return Number.isFinite(parsed) ? parsed : 0;
      }
      function visible(element) {
        if (!element || element.hidden) return false;
        var style = window.getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }
      function outerHeight(element) {
        if (!visible(element)) return 0;
        var style = window.getComputedStyle(element);
        return element.getBoundingClientRect().height + number(style.marginTop) + number(style.marginBottom);
      }
      var bodyStyle = window.getComputedStyle(document.body);
      var diagramStyle = diagram ? window.getComputedStyle(diagram) : null;
      var bodyChromeHeight = number(bodyStyle.paddingTop) + number(bodyStyle.paddingBottom);
      var diagramChromeHeight = diagramStyle
        ? number(diagramStyle.paddingTop) + number(diagramStyle.paddingBottom)
          + number(diagramStyle.borderTopWidth) + number(diagramStyle.borderBottomWidth)
        : 0;
      var fixedHeightBreakdown = {
        bodyChrome: bodyChromeHeight,
        diagramChrome: diagramChromeHeight,
        header: outerHeight(header),
        guidedViews: outerHeight(guided),
        cards: outerHeight(cards),
        safeBottomGap: 12
      };
      var fixedHeight = Object.keys(fixedHeightBreakdown).reduce(function (sum, key) {
        return sum + fixedHeightBreakdown[key];
      }, 0);
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: Math.ceil(document.documentElement.scrollWidth),
        scrollHeight: Math.ceil(document.documentElement.scrollHeight),
        resolvedTheme: document.documentElement.getAttribute('data-theme') || '',
        detailLevel: diagram ? diagram.getAttribute('data-detail-level') || '' : '',
        motion: document.documentElement.getAttribute('data-motion') || '',
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
        viewerChromeActive: viewerChromeReceipt ? viewerChromeReceipt.active : false,
        readerLayoutActive: document.documentElement.getAttribute('data-reader-layout') === 'adaptive',
        readerOverflowState: document.documentElement.getAttribute('data-reader-overflow') || null,
        readerLayoutWidth: readerLayoutReceipt ? readerLayoutReceipt.width : 0,
        readerLayoutRatio: readerLayoutReceipt ? readerLayoutReceipt.ratio : 0,
        fixedHeight: fixedHeight,
        fixedHeightBreakdown: fixedHeightBreakdown,
        availableSvgHeight: Math.max(0, window.innerHeight - fixedHeight)
      };
    })()`);
    if (!metrics || !Number.isFinite(metrics.scrollWidth) || !Number.isFinite(metrics.scrollHeight)) {
      throw new Error('Chrome returned incomplete containment metrics.');
    }

    if (screenshotPath) await this.captureScreenshot(screenshotPath);
    return metrics;
  }

  async captureScreenshot(screenshotPath) {
    const sessionId = await this.sessionPromise;
    const capture = await this.cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
      captureBeyondViewport: false,
    }, sessionId, 20000);
    if (!capture.data) throw new Error('Chrome returned an empty screenshot.');
    writeAtomic(screenshotPath, Buffer.from(capture.data, 'base64'));
  }

  async reset() {
    const sessionId = await this.sessionPromise;
    await this.cdp.send('Page.stopLoading', {}, sessionId).catch(() => {});
    await evaluate(this.cdp, sessionId, `(function () {
      function clear(storage) {
        try {
          storage.clear();
          return 'cleared';
        } catch (error) {
          if (error && error.name === 'SecurityError') return 'unavailable';
          throw error;
        }
      }
      window.name = '';
      return {
        localStorage: clear(window.localStorage),
        sessionStorage: clear(window.sessionStorage)
      };
    })()`);
    await this.cdp.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
    const loaded = this.cdp.waitFor('Page.loadEventFired', sessionId);
    const navigation = await this.cdp.send('Page.navigate', { url: 'about:blank' }, sessionId);
    if (navigation.errorText) throw new Error(`Chrome reset navigation failed: ${navigation.errorText}`);
    await loaded;
    const href = await evaluate(this.cdp, sessionId, 'location.href');
    if (href !== 'about:blank') throw new Error(`Chrome reset failed closed: expected about:blank, received ${href}.`);
    this.loadedArtifactTheme = null;
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

function capabilityReceipt({ resolvedChrome, env = process.env }) {
  return {
    schemaVersion: 1,
    ok: false,
    command: 'visual-capability-probe',
    status: resolvedChrome ? 'fail' : 'unavailable',
    chrome: {
      status: resolvedChrome ? 'available' : 'unavailable',
      executable: resolvedChrome || null,
      sandbox: chromeSandboxReceipt(env),
    },
    cdp: { status: resolvedChrome ? 'pending' : 'skipped' },
    diagnostics: [],
  };
}

export class VisualCheckSession {
  constructor({
    chromePath,
    resolveChrome = findChrome,
    browserFactory,
    env = process.env,
  } = {}) {
    this.chromePath = chromePath;
    this.resolveChrome = resolveChrome;
    this.browserFactory = browserFactory
      || (async (resolvedChrome) => new ChromeVisualBrowser(resolvedChrome, { env }));
    this.env = env;
    this.browser = null;
    this.capabilityReceipt = null;
    this.probePromise = null;
    this.closed = false;
    this.busy = false;
    this.artifactsInspected = 0;
    this.reusable = true;
    this.finalized = false;
    this.poisoned = null;
  }

  async probe() {
    if (this.closed) throw new Error('VisualCheckSession is closed.');
    if (this.capabilityReceipt) return this.capabilityReceipt;
    if (this.probePromise) return this.probePromise;
    this.probePromise = this.initializeCapability();
    try {
      return await this.probePromise;
    } finally {
      this.probePromise = null;
    }
  }

  async initializeCapability() {
    const resolvedChrome = this.chromePath || this.resolveChrome();
    const receipt = capabilityReceipt({ resolvedChrome, env: this.env });
    if (!resolvedChrome) {
      receipt.diagnostics = [failureDiagnostic({
        code: 'viewer/chrome-unavailable',
        severity: 'warning',
        message: 'Chrome or Chromium is unavailable. Set ARCHIFY_CHROME to its executable path.',
        subject: { executable: null },
        evidence: { executable: null, sandbox: receipt.chrome.sandbox },
        supportedFixes: ['set ARCHIFY_CHROME to a Chrome or Chromium executable and rerun the capability probe'],
      })];
      this.capabilityReceipt = receipt;
      return receipt;
    }

    try {
      this.browser = await this.browserFactory(resolvedChrome);
      const cdp = typeof this.browser?.probe === 'function'
        ? await this.browser.probe()
        : { adapterProbe: 'browserFactory did not expose probe(); creation succeeded' };
      receipt.ok = true;
      receipt.status = 'pass';
      receipt.cdp = { status: 'available', ...cdp };
    } catch (error) {
      receipt.status = 'fail';
      receipt.error = error.message;
      receipt.cdp = { status: 'failed', error: error.message };
      receipt.diagnostics = [failureDiagnostic({
        code: 'viewer/chrome-capability',
        message: 'Chrome was found, but its DevTools capability probe failed.',
        subject: { executable: resolvedChrome },
        evidence: { reason: error.message, sandbox: receipt.chrome.sandbox },
        supportedFixes: [
          'resolve the reported Chrome launch or DevTools error, then rerun the capability probe',
          `only after an explicit security decision, set ${CHROME_NO_SANDBOX_ENV}=1 to opt out of the Chrome sandbox`,
        ],
      })];
      this.poisoned = error;
      if (this.browser?.close) await this.browser.close().catch(() => {});
      this.browser = null;
    }
    this.capabilityReceipt = receipt;
    return receipt;
  }

  async useBrowser(callback, { finalArtifact = false } = {}) {
    if (this.closed) throw new Error('VisualCheckSession is closed.');
    if (this.busy) throw new Error('VisualCheckSession does not allow concurrent artifact inspection.');
    if (this.finalized) throw new Error('VisualCheckSession is finalized after its last artifact.');
    const capability = await this.probe();
    if (this.busy) throw new Error('VisualCheckSession does not allow concurrent artifact inspection.');
    if (!capability.ok || !this.browser) {
      throw new Error(capability.error || 'VisualCheckSession has no usable Chrome capability.');
    }
    if (this.poisoned) {
      throw new Error(`VisualCheckSession is fail-closed after a browser error: ${this.poisoned.message}`);
    }
    if (!this.reusable && this.artifactsInspected > 0) {
      throw new Error('VisualCheckSession browser adapter cannot reset state between artifacts.');
    }

    this.busy = true;
    let value;
    let operationError = null;
    try {
      value = await callback(this.browser);
    } catch (error) {
      operationError = error;
    }

    let resetError = null;
    try {
      if (finalArtifact) this.finalized = true;
      else if (typeof this.browser.reset === 'function') await this.browser.reset();
      else this.reusable = false;
    } catch (error) {
      resetError = error;
      this.poisoned = error;
    } finally {
      this.artifactsInspected += 1;
      this.busy = false;
    }

    if (resetError) {
      const operation = operationError ? ` Inspection also failed: ${operationError.message}` : '';
      throw new Error(`VisualCheckSession could not reset browser state and is fail-closed: ${resetError.message}.${operation}`);
    }
    if (operationError) throw operationError;
    return value;
  }

  run(options = {}) {
    return runVisualCheck({ ...options, session: this });
  }

  preflight(options = {}) {
    return runVisualPreflight({ ...options, session: this });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    if (this.browser?.close) await this.browser.close();
    this.browser = null;
  }
}

export async function probeVisualCheckCapability({ session, ...options } = {}) {
  const activeSession = session || new VisualCheckSession(options);
  try {
    const receipt = await activeSession.probe();
    const exitCode = receipt.status === 'pass' ? EXIT.pass
      : receipt.status === 'unavailable' ? EXIT.skipped : EXIT.fail;
    return { exitCode, receipt };
  } finally {
    if (!session) await activeSession.close();
  }
}

function observation({ width, height, theme, metrics }) {
  const innerWidth = Number(metrics.innerWidth);
  const innerHeight = Number(metrics.innerHeight);
  const scrollWidth = Number(metrics.scrollWidth);
  const scrollHeight = Number(metrics.scrollHeight);
  const overflowX = scrollWidth > innerWidth;
  const overflowY = scrollHeight > innerHeight;
  const overflowXBy = Math.max(0, scrollWidth - innerWidth);
  const overflowYBy = Math.max(0, scrollHeight - innerHeight);
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
  const resolvedTheme = typeof metrics.resolvedTheme === 'string' ? metrics.resolvedTheme : '';
  const detailLevel = typeof metrics.detailLevel === 'string' ? metrics.detailLevel : '';
  const motion = typeof metrics.motion === 'string' ? metrics.motion : '';
  const themeStateOk = resolvedTheme === theme;
  const detailStateOk = detailLevel === 'read';
  const motionStateOk = motion === 'still';
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
    overflowXBy,
    overflowYBy,
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
    requestedTheme: theme,
    resolvedTheme,
    detailLevel,
    motion,
    themeStateOk,
    detailStateOk,
    motionStateOk,
    stateOk: themeStateOk && detailStateOk && motionStateOk,
    readerLayout: {
      active: Boolean(metrics.readerLayoutActive),
      overflowState: metrics.readerOverflowState || null,
      width: Number(metrics.readerLayoutWidth) || 0,
      ratio: Number(metrics.readerLayoutRatio) || 0,
      fixedHeight: Number(metrics.fixedHeight) || 0,
      availableSvgHeight: Number(metrics.availableSvgHeight) || 0,
      fixedHeightBreakdown: Object.fromEntries(Object.entries(metrics.fixedHeightBreakdown || {}).map(
        ([key, value]) => [key, Number(value) || 0],
      )),
    },
  };
}

function containmentObservation({ width, height, theme, metrics }) {
  const entry = observation({ width, height, theme, metrics });
  return {
    width: entry.width,
    height: entry.height,
    theme: entry.theme,
    requestedTheme: entry.requestedTheme,
    resolvedTheme: entry.resolvedTheme,
    detailLevel: entry.detailLevel,
    motion: entry.motion,
    themeStateOk: entry.themeStateOk,
    detailStateOk: entry.detailStateOk,
    motionStateOk: entry.motionStateOk,
    stateOk: entry.stateOk,
    innerWidth: entry.innerWidth,
    innerHeight: entry.innerHeight,
    scrollWidth: entry.scrollWidth,
    scrollHeight: entry.scrollHeight,
    overflowX: entry.overflowX,
    overflowY: entry.overflowY,
    overflowXBy: entry.overflowXBy,
    overflowYBy: entry.overflowYBy,
    ok: entry.ok,
    readerWidth: entry.readerWidth,
    diagramWidth: entry.diagramWidth,
    viewBoxWidth: entry.viewBoxWidth,
    readerLayout: entry.readerLayout,
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

function viewportSubject(artifact, entry) {
  return {
    artifact,
    viewport: { width: entry.width, height: entry.height, theme: entry.theme },
  };
}

function failureDiagnostic({ code, message, subject, evidence, supportedFixes, severity = 'error' }) {
  return { code, severity, message, subject, evidence, supportedFixes };
}

function containmentDiagnostics({ artifact, observations, command = 'visual-check' }) {
  const diagnostics = [];
  for (const entry of observations) {
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
          overflowXBy: entry.overflowXBy,
          overflowYBy: entry.overflowYBy,
          readerLayout: entry.readerLayout,
        },
        supportedFixes: [
          entry.overflowYBy > 0
            ? `reclaim at least ${entry.overflowYBy}px of rendered vertical extent without clipping, hiding overflow, or reducing readable typography, then rerun ${command}`
            : `contain the rendered layout within ${entry.width}x${entry.height}, then rerun ${command}`,
        ],
      }));
    }
  }
  return diagnostics;
}

function stateDiagnostics({ artifact, observations, command = 'visual-check' }) {
  const diagnostics = [];
  for (const entry of observations) {
    if (!entry.themeStateOk) {
      diagnostics.push(failureDiagnostic({
        code: 'viewer/theme-state',
        message: `The viewer resolved ${entry.resolvedTheme || 'no theme'} instead of the requested ${entry.requestedTheme} theme at ${entry.width}x${entry.height}.`,
        subject: viewportSubject(artifact, entry),
        evidence: { requested: entry.requestedTheme, resolved: entry.resolvedTheme || null },
        supportedFixes: [`make the viewer resolve the requested ${entry.requestedTheme} theme, then rerun ${command}`],
      }));
    }
    if (!entry.detailStateOk) {
      diagnostics.push(failureDiagnostic({
        code: 'viewer/detail-state',
        message: `The viewer resolved ${entry.detailLevel || 'no detail state'} instead of READ detail at ${entry.width}x${entry.height} (${entry.theme}).`,
        subject: viewportSubject(artifact, entry),
        evidence: { requested: 'read', resolved: entry.detailLevel || null },
        supportedFixes: [`make the diagram container resolve READ detail, then rerun ${command}`],
      }));
    }
    if (!entry.motionStateOk) {
      diagnostics.push(failureDiagnostic({
        code: 'viewer/motion-state',
        message: `The viewer resolved ${entry.motion || 'no motion state'} instead of Still motion at ${entry.width}x${entry.height} (${entry.theme}).`,
        subject: viewportSubject(artifact, entry),
        evidence: { requested: 'still', resolved: entry.motion || null },
        supportedFixes: [`make the viewer resolve Still motion, then rerun ${command}`],
      }));
    }
  }
  return diagnostics;
}

function stateReceiptObservations(observations) {
  return observations.map((entry) => ({
    width: entry.width,
    height: entry.height,
    requestedTheme: entry.requestedTheme,
    resolvedTheme: entry.resolvedTheme,
    detailLevel: entry.detailLevel,
    motion: entry.motion,
    ok: entry.stateOk,
  }));
}

function observationDiagnostics({ artifact, allObservations, readabilityObservations }) {
  const diagnostics = [
    ...containmentDiagnostics({ artifact, observations: allObservations }),
    ...stateDiagnostics({ artifact, observations: allObservations }),
  ];
  for (const entry of allObservations) {
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
  const initialSha256 = sha256(artifact);
  return {
    schemaVersion: VISUAL_RECEIPT_SCHEMA_VERSION,
    ok: false,
    command: 'visual-check',
    status: 'fail',
    visualReview: 'pending',
    artifact: {
      path: artifactPath,
      sha256: initialSha256,
      bytes: artifact.byteLength,
      verification: {
        before: { sha256: initialSha256, bytes: artifact.byteLength },
        after: null,
        unchanged: null,
      },
    },
    state: { detail: 'read', motion: 'still', status: 'fail', observations: [] },
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

function recordArtifactAfter(artifactPath, receipt) {
  try {
    const after = fs.readFileSync(artifactPath);
    const value = { sha256: sha256(after), bytes: after.byteLength };
    receipt.artifact.verification.after = value;
    receipt.artifact.verification.unchanged = (
      value.sha256 === receipt.artifact.verification.before.sha256
      && value.bytes === receipt.artifact.verification.before.bytes
    );
    return receipt.artifact.verification.unchanged;
  } catch (error) {
    receipt.artifact.verification.after = { error: error.message };
    receipt.artifact.verification.unchanged = false;
    return false;
  }
}

function assertArtifactUnchanged(artifactPath, receipt) {
  if (!recordArtifactAfter(artifactPath, receipt)) {
    throw new Error('The delivered artifact changed while visual inspection was running.');
  }
}

function artifactChangedDiagnostic({ receipt, artifact, command, capabilityError }) {
  const verification = receipt.artifact.verification;
  const reason = verification.after?.error
    ? `The artifact could not be reread: ${verification.after.error}`
    : 'The artifact hash or byte count changed.';
  const message = `The delivered artifact changed or became unreadable during ${command}.`;
  return failureDiagnostic({
    code: 'viewer/artifact-changed',
    message,
    subject: { artifact },
    evidence: {
      reason,
      before: verification.before,
      after: verification.after,
      ...(capabilityError ? { capabilityError } : {}),
    },
    supportedFixes: [
      `restore or regenerate the delivered artifact, then rerun ${command}`,
      'prevent concurrent writers from changing the artifact during visual inspection',
    ],
  });
}

function basePreflightReceipt({ artifactPath, artifact, outputs, chrome }) {
  const initialSha256 = sha256(artifact);
  return {
    schemaVersion: VISUAL_RECEIPT_SCHEMA_VERSION,
    ok: false,
    command: 'visual-preflight',
    status: 'fail',
    automatedChecks: ['containment'],
    artifact: {
      path: artifactPath,
      sha256: initialSha256,
      bytes: artifact.byteLength,
      verification: {
        before: { sha256: initialSha256, bytes: artifact.byteLength },
        after: null,
        unchanged: null,
      },
    },
    state: {
      detail: 'read', motion: 'still', theme: 'light', status: 'fail', observations: [],
    },
    chrome,
    diagnostics: [],
    containment: { status: 'fail', viewports: [] },
    captures: { status: 'not-requested', screenshots: [], contactSheet: null },
    sidecars: {
      receipt: path.basename(outputs.receipt),
      diagnosticScreenshot: path.basename(outputs.diagnosticScreenshot),
    },
  };
}

function unavailableReceipt({ receipt, capability, artifact, command }) {
  receipt.status = capability.status === 'unavailable' ? 'skipped' : 'fail';
  receipt.error = capability.error
    || 'Chrome or Chromium is unavailable. Set ARCHIFY_CHROME to its executable path.';
  receipt.chrome = capability.chrome;
  receipt.state.status = receipt.status === 'skipped' ? 'skipped' : 'fail';
  receipt.containment.status = receipt.status === 'skipped' ? 'skipped' : 'fail';
  if (receipt.readability) receipt.readability.status = receipt.status === 'skipped' ? 'skipped' : 'fail';
  if (receipt.viewerChrome) receipt.viewerChrome.status = receipt.status === 'skipped' ? 'skipped' : 'fail';
  receipt.captures.status = receipt.status === 'skipped' ? 'skipped' : 'fail';
  receipt.diagnostics = capability.status === 'unavailable'
    ? [failureDiagnostic({
      code: 'viewer/chrome-unavailable',
      severity: 'warning',
      message: receipt.error,
      subject: { artifact },
      evidence: { executable: null, capability },
      supportedFixes: [`set ARCHIFY_CHROME to a Chrome or Chromium executable and rerun ${command}`],
    })]
    : [failureDiagnostic({
      code: 'viewer/visual-check-runtime',
      message: `${command} could not start its Chrome inspection.`,
      subject: { artifact },
      evidence: { reason: receipt.error, capability },
      supportedFixes: [`resolve the reported Chrome capability error, then rerun ${command}`],
    })];
  if (!recordArtifactAfter(artifact, receipt)) {
    const capabilityError = receipt.error;
    const integrityDiagnostic = artifactChangedDiagnostic({
      receipt,
      artifact,
      command,
      capabilityError,
    });
    receipt.status = 'fail';
    receipt.ok = false;
    receipt.error = integrityDiagnostic.message;
    receipt.containment.status = 'fail';
    if (receipt.readability) receipt.readability.status = 'fail';
    if (receipt.viewerChrome) receipt.viewerChrome.status = 'fail';
    receipt.captures.status = 'fail';
    receipt.diagnostics.push(integrityDiagnostic);
  }
}

function persistReceipt(outputs, receipt) {
  writeAtomic(outputs.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
}

export async function runVisualCheck(options = {}) {
  if (options.mode === 'preflight') {
    const { mode: _mode, ...preflightOptions } = options;
    return runVisualPreflight(preflightOptions);
  }
  if (options.mode && options.mode !== 'full') {
    throw new Error(`Unknown visual-check mode ${JSON.stringify(options.mode)}.`);
  }
  const {
    artifactPath,
    session,
    finalArtifact,
    chromePath,
    resolveChrome = findChrome,
    browserFactory,
    env = process.env,
  } = options;
  if (!artifactPath) throw new Error('visual-check requires one delivered HTML artifact.');
  const artifact = path.resolve(artifactPath);
  if (!/\.html?$/i.test(artifact)) throw new Error('visual-check requires an .html artifact.');
  const artifactBytes = fs.readFileSync(artifact);
  const outputs = sidecarPaths(artifact);
  cleanupCaptureSidecars(outputs);
  safeUnlink(outputs.receipt);

  const activeSession = session || new VisualCheckSession({
    chromePath,
    resolveChrome,
    browserFactory,
    env,
  });
  const ownsSession = !session;
  const isFinalArtifact = finalArtifact ?? ownsSession;
  const capability = await activeSession.probe();
  const receipt = baseReceipt({
    artifactPath: artifact,
    artifact: artifactBytes,
    outputs,
    chrome: capability.chrome,
  });

  if (!capability.ok) {
    unavailableReceipt({ receipt, capability, artifact, command: 'visual-check' });
    persistReceipt(outputs, receipt);
    if (ownsSession) await activeSession.close();
    return {
      exitCode: receipt.status === 'skipped' ? EXIT.skipped : EXIT.fail,
      receipt,
    };
  }

  try {
    const inspection = await activeSession.useBrowser(async (browser) => {
      const values = new Map();
      const captures = new Map();
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
        values.set(key, observation({ ...viewport, theme: 'light', metrics }));
        if (screenshot) {
          captures.set(key, screenshotEvidence(screenshot.path, viewport));
        }
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
        values.set(key, observation({ ...viewport, theme: 'dark', metrics }));
        captures.set(key, screenshotEvidence(screenshot.path, viewport));
      }
      return { observations: values, captures };
    }, { finalArtifact: isFinalArtifact });
    assertArtifactUnchanged(artifact, receipt);

    receipt.containment.viewports = VISUAL_CHECK_VIEWPORTS.map(({ width, height }) => (
      inspection.observations.get(screenshotKey(width, height, 'light'))
    ));
    receipt.readability.viewports = receipt.containment.viewports.map((entry) => ({ ...entry }));
    receipt.viewerChrome.viewports = receipt.containment.viewports.map((entry) => ({ ...entry }));
    receipt.captures.screenshots = outputs.screenshots.map((entry) => ({
      ...inspection.observations.get(screenshotKey(entry.width, entry.height, entry.theme)),
      ...inspection.captures.get(screenshotKey(entry.width, entry.height, entry.theme)),
      file: path.basename(entry.path),
    }));
    const allObservations = [...inspection.observations.values()];
    const containmentPass = allObservations.every((entry) => entry.ok);
    const readabilityPass = allObservations.every((entry) => entry.readabilityOk);
    const viewerChromePass = allObservations.every((entry) => entry.viewerChromeOk);
    const statePass = allObservations.every((entry) => entry.stateOk);
    receipt.state.observations = stateReceiptObservations(allObservations);
    receipt.state.status = statePass ? 'pass' : 'fail';
    receipt.diagnostics = observationDiagnostics({
      artifact,
      allObservations,
      readabilityObservations: allObservations,
    });
    receipt.containment.status = containmentPass ? 'pass' : 'fail';
    receipt.readability.status = readabilityPass ? 'pass' : 'fail';
    receipt.viewerChrome.status = viewerChromePass ? 'pass' : 'fail';
    receipt.captures.status = 'pass';
    receipt.captures.contactSheet = path.basename(outputs.contactSheet);
    receipt.status = containmentPass && readabilityPass && viewerChromePass && statePass ? 'pass' : 'fail';
    receipt.ok = containmentPass && readabilityPass && viewerChromePass && statePass;
    writeAtomic(outputs.contactSheet, contactSheetHtml({
      artifactPath: artifact,
      receipt,
      screenshots: receipt.captures.screenshots,
    }));
    persistReceipt(outputs, receipt);
    return { exitCode: receipt.ok ? EXIT.pass : EXIT.fail, receipt };
  } catch (error) {
    if (receipt.artifact.verification.after === null) recordArtifactAfter(artifact, receipt);
    const integrityDiagnostic = receipt.artifact.verification.unchanged === false
      ? artifactChangedDiagnostic({ receipt, artifact, command: 'visual-check' })
      : null;
    cleanupCaptureSidecars(outputs);
    receipt.status = 'fail';
    receipt.ok = false;
    receipt.error = integrityDiagnostic?.message || error.message;
    receipt.state.status = 'fail';
    receipt.containment.status = 'fail';
    receipt.readability.status = 'fail';
    receipt.viewerChrome.status = 'fail';
    receipt.captures.status = 'fail';
    receipt.captures.screenshots = [];
    receipt.captures.contactSheet = null;
    receipt.diagnostics = integrityDiagnostic ? [integrityDiagnostic] : [error instanceof ScreenshotEvidenceError
      ? failureDiagnostic({
        code: 'viewer/screenshot-evidence',
        message: error.message,
        subject: { artifact },
        evidence: error.evidence,
        supportedFixes: ['recapture the exact requested viewport and verify its PNG evidence, then rerun visual-check'],
      })
      : failureDiagnostic({
        code: 'viewer/visual-check-runtime',
        message: 'visual-check could not complete its Chrome inspection.',
        subject: { artifact },
        evidence: { reason: error.message },
        supportedFixes: ['resolve the reported Chrome inspection error, then rerun visual-check'],
      })];
    persistReceipt(outputs, receipt);
    return { exitCode: EXIT.fail, receipt };
  } finally {
    if (ownsSession) await activeSession.close();
  }
}

export async function runVisualPreflight({
  artifactPath,
  session,
  finalArtifact,
  chromePath,
  resolveChrome = findChrome,
  browserFactory,
  env = process.env,
} = {}) {
  if (!artifactPath) throw new Error('visual-preflight requires one delivered HTML artifact.');
  const artifact = path.resolve(artifactPath);
  if (!/\.html?$/i.test(artifact)) throw new Error('visual-preflight requires an .html artifact.');
  const artifactBytes = fs.readFileSync(artifact);
  const outputs = preflightSidecarPaths(artifact);
  cleanupPreflightSidecars(outputs);
  safeUnlink(outputs.receipt);

  const activeSession = session || new VisualCheckSession({
    chromePath,
    resolveChrome,
    browserFactory,
    env,
  });
  const ownsSession = !session;
  const isFinalArtifact = finalArtifact ?? ownsSession;
  const capability = await activeSession.probe();
  const receipt = basePreflightReceipt({
    artifactPath: artifact,
    artifact: artifactBytes,
    outputs,
    chrome: capability.chrome,
  });

  if (!capability.ok) {
    unavailableReceipt({ receipt, capability, artifact, command: 'visual-preflight' });
    persistReceipt(outputs, receipt);
    if (ownsSession) await activeSession.close();
    return {
      exitCode: receipt.status === 'skipped' ? EXIT.skipped : EXIT.fail,
      receipt,
    };
  }

  try {
    const result = await activeSession.useBrowser(async (browser) => {
      const viewports = [];
      let diagnostic = null;
      let captureError = null;
      for (const viewport of VISUAL_PREFLIGHT_VIEWPORTS) {
        const metrics = await browser.inspect({
          artifactPath: artifact,
          ...viewport,
          theme: 'light',
        });
        const entry = containmentObservation({ ...viewport, theme: 'light', metrics });
        viewports.push(entry);
        if (!entry.ok && !diagnostic && !captureError) {
          try {
            if (typeof browser.captureScreenshot === 'function') {
              await browser.captureScreenshot(outputs.diagnosticScreenshot);
            } else {
              await browser.inspect({
                artifactPath: artifact,
                ...viewport,
                theme: 'light',
                screenshotPath: outputs.diagnosticScreenshot,
              });
            }
            const evidence = screenshotEvidence(outputs.diagnosticScreenshot, viewport);
            diagnostic = {
              ...entry,
              ...evidence,
              file: path.basename(outputs.diagnosticScreenshot),
            };
          } catch (error) {
            safeUnlink(outputs.diagnosticScreenshot);
            captureError = error;
          }
        }
      }
      return { viewports, diagnostic, captureError };
    }, { finalArtifact: isFinalArtifact });
    assertArtifactUnchanged(artifact, receipt);

    const containmentPass = result.viewports.every((entry) => entry.ok);
    const statePass = result.viewports.every((entry) => entry.stateOk);
    receipt.state.observations = stateReceiptObservations(result.viewports);
    receipt.state.status = statePass ? 'pass' : 'fail';
    receipt.containment.viewports = result.viewports;
    receipt.containment.status = containmentPass ? 'pass' : 'fail';
    receipt.captures.status = result.diagnostic ? 'diagnostic' : 'not-requested';
    receipt.captures.screenshots = result.diagnostic ? [result.diagnostic] : [];
    receipt.diagnostics = [
      ...containmentDiagnostics({
        artifact,
        observations: result.viewports,
        command: 'visual-preflight',
      }),
      ...stateDiagnostics({
        artifact,
        observations: result.viewports,
        command: 'visual-preflight',
      }),
    ];
    if (result.captureError) {
      receipt.diagnostics.push(failureDiagnostic({
        code: 'viewer/preflight-diagnostic-capture',
        severity: 'warning',
        message: 'Containment failed and the optional diagnostic screenshot could not be captured.',
        subject: { artifact },
        evidence: {
          reason: result.captureError.message,
          ...(result.captureError instanceof ScreenshotEvidenceError
            ? { screenshot: result.captureError.evidence }
            : {}),
        },
        supportedFixes: ['use the structured containment metrics to repair overflow, then rerun visual-preflight'],
      }));
    }
    receipt.ok = containmentPass && statePass;
    receipt.status = receipt.ok ? 'pass' : 'fail';
    persistReceipt(outputs, receipt);
    return { exitCode: receipt.ok ? EXIT.pass : EXIT.fail, receipt };
  } catch (error) {
    if (receipt.artifact.verification.after === null) recordArtifactAfter(artifact, receipt);
    const integrityDiagnostic = receipt.artifact.verification.unchanged === false
      ? artifactChangedDiagnostic({ receipt, artifact, command: 'visual-preflight' })
      : null;
    cleanupPreflightSidecars(outputs);
    receipt.status = 'fail';
    receipt.ok = false;
    receipt.error = integrityDiagnostic?.message || error.message;
    receipt.state.status = 'fail';
    receipt.containment.status = 'fail';
    receipt.captures.status = 'fail';
    receipt.captures.screenshots = [];
    receipt.diagnostics = integrityDiagnostic ? [integrityDiagnostic] : [failureDiagnostic({
      code: 'viewer/visual-preflight-runtime',
      message: 'visual-preflight could not complete its Chrome inspection.',
      subject: { artifact },
      evidence: { reason: error.message },
      supportedFixes: ['resolve the reported Chrome inspection error, then rerun visual-preflight'],
    })];
    persistReceipt(outputs, receipt);
    return { exitCode: EXIT.fail, receipt };
  } finally {
    if (ownsSession) await activeSession.close();
  }
}
