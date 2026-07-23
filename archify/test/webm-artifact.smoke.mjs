import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-webm-artifact-'));
const externalReachSource = process.env.ARCHIFY_REACH_CARD_SOURCE
  ? path.resolve(process.env.ARCHIFY_REACH_CARD_SOURCE)
  : '';
const externalReachOutput = process.env.ARCHIFY_REACH_CARD_OUTPUT
  ? path.resolve(process.env.ARCHIFY_REACH_CARD_OUTPUT)
  : '';
assert.equal(Boolean(externalReachSource), Boolean(externalReachOutput), 'ARCHIFY_REACH_CARD_SOURCE and ARCHIFY_REACH_CARD_OUTPUT must be set together');

function executable(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.includes(path.sep)) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    try {
      return execFileSync('sh', ['-c', `command -v "$1"`, 'archify-which', candidate], { encoding: 'utf8' }).trim();
    } catch (_) {
      // Try the next platform-specific name.
    }
  }
  return '';
}

const chrome = executable([
  process.env.ARCHIFY_CHROME,
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]);
const ffmpeg = executable([process.env.ARCHIFY_FFMPEG, 'ffmpeg']);

assert.ok(chrome, 'Chrome/Chromium is required for the WebM artifact smoke test (or set ARCHIFY_CHROME)');
assert.ok(ffmpeg, 'ffmpeg is required for the WebM artifact smoke test (or set ARCHIFY_FFMPEG)');

const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
source.meta.animation = 'trace';
source.meta.visual_preset = 'signal-flow';

const input = path.join(tmp, 'motion.architecture.json');
const output = path.join(tmp, 'motion.html');
fs.writeFileSync(input, JSON.stringify(source));
execFileSync(process.execPath, [
  path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
  input,
  output,
], { stdio: ['ignore', 'ignore', 'pipe'] });

const sequenceOutput = path.join(tmp, 'sequence.html');
execFileSync(process.execPath, [
  path.join(skillRoot, 'renderers/sequence/render-sequence.mjs'),
  path.join(skillRoot, 'examples/cache-miss-request.sequence.json'),
  sequenceOutput,
], { stdio: ['ignore', 'ignore', 'pipe'] });

const routeOutputs = {
  architecture: output,
  sequence: sequenceOutput,
};
for (const [mode, example] of Object.entries({
  workflow: 'agent-tool-call.workflow.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
})) {
  const rendered = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
    path.join(skillRoot, 'examples', example),
    rendered,
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  routeOutputs[mode] = rendered;
}

const parallelSource = JSON.parse(JSON.stringify(source));
parallelSource.meta.title = 'Parallel Route Identity';
parallelSource.connections[0].label = '';
parallelSource.connections.splice(1, 0, {
  id: 'users-to-cdn-alternate',
  from: 'users',
  to: 'cdn',
  label: '',
});
const parallelInput = path.join(tmp, 'parallel.architecture.json');
const parallelOutput = path.join(tmp, 'parallel.html');
fs.writeFileSync(parallelInput, JSON.stringify(parallelSource));
execFileSync(process.execPath, [
  path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
  parallelInput,
  parallelOutput,
], { stdio: ['ignore', 'ignore', 'pipe'] });

const specialSourceLabel = '入口 <script>window.__routeLabelExecuted = true</script> 汉字 🚀 with an intentionally very long endpoint label';
const specialTargetLabel = '终点服务 ✅ emoji + CJK + a second deliberately long endpoint label for header fitting';
const specialComponents = Array.from({ length: 11 }, (_, index) => ({
  id: index === 0 ? 'Route_Source-01' : index === 10 ? 'Route_Target-10' : `route_step-${index}`,
  type: index === 0 ? 'external' : index === 10 ? 'database' : 'backend',
  label: index === 0 ? specialSourceLabel : index === 10 ? specialTargetLabel : `步骤 ${index} · service_${index} ⚙️`,
  sublabel: `hop ${index}`,
  pos: [40 + index * 820, 280],
  size: [index === 0 || index === 10 ? 780 : 220, 72],
}));
const specialRouteSource = {
  schema_version: 1,
  diagram_type: 'architecture',
  meta: {
    title: '多语言 Route Share Card 🚀 with a deliberately long original diagram title that must fit safely',
    subtitle: 'Ten exact authored hops',
    animation: 'trace',
  },
  components: specialComponents,
  boundaries: [],
  connections: specialComponents.slice(0, -1).map((component, index) => ({
    id: `route_edge-${index + 1}`,
    from: component.id,
    to: specialComponents[index + 1].id,
    label: '',
  })),
  cards: [],
};
const specialRouteInput = path.join(tmp, 'special-route.architecture.json');
const specialRouteOutput = path.join(tmp, 'special-route.html');
fs.writeFileSync(specialRouteInput, JSON.stringify(specialRouteSource));
execFileSync(process.execPath, [
  path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
  specialRouteInput,
  specialRouteOutput,
], { stdio: ['ignore', 'ignore', 'pipe'] });

assert.equal(typeof WebSocket, 'function', 'Node.js 22+ is required for the Chrome DevTools smoke harness');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  return Promise.race([
    once(child, 'exit').then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
}

async function removeTempTree(directory) {
  const transientCodes = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM']);
  let lastError;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      return;
    } catch (error) {
      if (!transientCodes.has(error?.code)) throw error;
      lastError = error;
      await delay(100 * (attempt + 1));
    }
  }
  console.warn(`warning: temporary Chrome profile cleanup deferred (${lastError?.code || 'unknown'}): ${directory}`);
}

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function devtoolsEndpoint(port, chromeProcess, diagnostics) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return (await response.json()).webSocketDebuggerUrl;
    } catch (_) {
      // Chrome may need a moment to bind the debugging port.
    }
    if (chromeProcess.exitCode !== null) break;
    await delay(50);
  }
  const stderr = diagnostics().trim();
  const exit = chromeProcess.exitCode === null ? 'still running' : `exited with code ${chromeProcess.exitCode}`;
  throw new Error(`Chrome did not expose a DevTools endpoint (${exit})${stderr ? `:\n${stderr}` : ''}`);
}

async function connectCdp(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  socket.addEventListener('close', () => {
    for (const request of pending.values()) request.reject(new Error('Chrome DevTools connection closed'));
    pending.clear();
  });
  return {
    socket,
    send(method, params = {}, sessionId) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });
    },
  };
}

async function evaluate(cdp, sessionId, expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || 'browser evaluation failed');
  }
  return response.result?.value;
}

const port = await freePort();
let chromeStderr = '';
const chromeProcess = spawn(chrome, [
  '--headless=new',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--allow-file-access-from-files',
  '--autoplay-policy=no-user-gesture-required',
  '--log-level=3',
  `--user-data-dir=${path.join(tmp, 'chrome-profile')}`,
  '--remote-debugging-address=127.0.0.1',
  `--remote-debugging-port=${port}`,
  'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
chromeProcess.stderr.setEncoding('utf8');
chromeProcess.stderr.on('data', (chunk) => {
  chromeStderr = `${chromeStderr}${chunk}`.slice(-64 * 1024);
});

let cdp;
let targetId;

try {
  cdp = await connectCdp(await devtoolsEndpoint(port, chromeProcess, () => chromeStderr));
  ({ targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }));
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  await cdp.send('Page.enable', {}, sessionId);
  await cdp.send('Runtime.enable', {}, sessionId);

  async function navigateReady(file, condition, label) {
    await cdp.send('Page.navigate', { url: pathToFileURL(file).href }, sessionId);
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
      ready = await evaluate(cdp, sessionId, `document.readyState === "complete" && (${condition})`);
      if (!ready) await delay(50);
    }
    assert.equal(ready, true, `${label} did not expose its browser export surface`);
  }

  async function captureShareCard(file, label) {
    await navigateReady(file, '!!(window.Archify && Archify.exportMenu && Archify.exportMenu.shareCard)', label);
    const sharePayload = await withTimeout(evaluate(cdp, sessionId, String.raw`(async function () {
      try {
        var blob = await Archify.exportMenu.shareCard();
        var bytes = new Uint8Array(await blob.arrayBuffer());
        var binary = '';
        for (var offset = 0; offset < bytes.length; offset += 32768) {
          binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 32768));
        }
        return { ok: true, type: blob.type, size: blob.size, base64: btoa(binary) };
      } catch (error) {
        return { ok: false, error: String(error && error.message || error) };
      }
    })()`, true), 10_000, `${label} Share Card export`);

    assert.equal(sharePayload?.ok, true, sharePayload?.error || `${label} Share Card export failed`);
    assert.equal(sharePayload.type, 'image/png');
    assert.ok(sharePayload.size > 20_000, `${label} Share Card is unexpectedly small (${sharePayload.size} bytes)`);

    const png = Buffer.from(sharePayload.base64, 'base64');
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${label} output is not a PNG`);
    assert.equal(png.readUInt32BE(16), 1200, `${label} Share Card width`);
    assert.equal(png.readUInt32BE(20), 630, `${label} Share Card height`);

    const pngPath = path.join(tmp, `${label}.share-card.png`);
    fs.writeFileSync(pngPath, png);
    const pixels = execFileSync(ffmpeg, [
      '-v', 'error',
      '-i', pngPath,
      '-vf', 'scale=120:63',
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-',
    ], { maxBuffer: 4 * 1024 * 1024 });
    const colors = new Set();
    const counts = new Map();
    for (let offset = 0; offset < pixels.length; offset += 3) {
      const color = pixels.subarray(offset, offset + 3).toString('hex');
      colors.add(color);
      counts.set(color, (counts.get(color) || 0) + 1);
    }
    const largestColorShare = Math.max(...counts.values()) / (pixels.length / 3);
    assert.ok(colors.size >= 24, `${label} Share Card has only ${colors.size} sampled colors`);
    assert.ok(largestColorShare < 0.96, `${label} Share Card is visually near-blank (${Math.round(largestColorShare * 100)}% one color)`);
    console.log(`ok ${label} Share Card: ${sharePayload.size} bytes, 1200x630, ${colors.size} sampled colors`);
  }

  async function captureCopiedShareCard(file, label) {
    await navigateReady(file, '!!(window.Archify && Archify.exportMenu && Archify.exportMenu.copyShareCard)', label);
    const copiedPayload = await withTimeout(evaluate(cdp, sessionId, String.raw`(async function () {
      try {
        Object.defineProperty(window, 'ClipboardItem', {
          configurable: true,
          value: function ClipboardItem(items) { this.items = items; }
        });
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            write: async function (items) {
              window.__archifyCopiedShareCard = await Promise.resolve(items[0].items['image/png']);
            }
          }
        });
        window.alert = function (message) { window.__archifyCopyAlert = message; };
        await Archify.exportMenu.copyShareCard();
        var blob = window.__archifyCopiedShareCard;
        if (!blob) throw new Error(window.__archifyCopyAlert || 'clipboard received no blob');
        var bytes = new Uint8Array(await blob.arrayBuffer());
        var binary = '';
        for (var offset = 0; offset < bytes.length; offset += 32768) {
          binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 32768));
        }
        return {
          ok: true,
          type: blob.type,
          size: blob.size,
          base64: btoa(binary),
          receipt: {
            format: document.documentElement.getAttribute('data-last-export-format'),
            width: document.documentElement.getAttribute('data-last-export-width'),
            height: document.documentElement.getAttribute('data-last-export-height'),
            canonical: document.documentElement.getAttribute('data-last-export-canonical'),
            error: document.documentElement.getAttribute('data-last-export-error')
          }
        };
      } catch (error) {
        return { ok: false, error: String(error && error.message || error) };
      }
    })()`, true), 10_000, `${label} Copy Share Card`);

    assert.equal(copiedPayload?.ok, true, copiedPayload?.error || `${label} Copy Share Card failed`);
    assert.equal(copiedPayload.type, 'image/png');
    assert.ok(copiedPayload.size > 20_000, `${label} copied Share Card is unexpectedly small`);
    const png = Buffer.from(copiedPayload.base64, 'base64');
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${label} copied output is not a PNG`);
    assert.equal(png.readUInt32BE(16), 1200, `${label} copied Share Card width`);
    assert.equal(png.readUInt32BE(20), 630, `${label} copied Share Card height`);
    assert.deepEqual(copiedPayload.receipt, {
      format: 'share-card',
      width: '1200',
      height: '630',
      canonical: 'true',
      error: null,
    });
    console.log(`ok ${label} Copy Share Card: ${copiedPayload.size} bytes, image/png, truthful receipt`);
  }

  async function captureRouteShareCard(file, label, sourceId, targetId, options = {}) {
    await navigateReady(file, '!!(window.Archify && Archify.routeProbe && Archify.exportMenu && Archify.exportMenu.downloadRouteShareCard)', label);
    const routePayload = await withTimeout(evaluate(cdp, sessionId, String.raw`(async function () {
      try {
        window.alert = function (message) { window.__archifyRouteAlert = message; };
        Archify.routeProbe.begin({ source: ${JSON.stringify(sourceId)}, focusNode: false });
        if (!Archify.routeProbe.choose(${JSON.stringify(targetId)}, { updateUrl: false })) {
          throw new Error('route did not resolve');
        }
        var snapshot = Archify.routeProbe.exportSnapshot();
        if (!snapshot) throw new Error('resolved route exposed no export snapshot');
        Archify.exportMenu.syncRouteShare();
        var routeMenuItem = document.querySelector('[data-action="route-share-card"]');
        var menuResolved = !!routeMenuItem && !routeMenuItem.hidden && !routeMenuItem.disabled;
        var svg = document.querySelector('.diagram-container svg');
        var firstEdgeKey = snapshot.edges[0].key;
        var primaryCarrier = Array.from(svg.querySelectorAll('[data-edge-key]')).find(function (element) {
          return element.getAttribute('data-edge-key') === firstEdgeKey && hasDrawableGeometry(element);
        });
        if (!primaryCarrier) throw new Error('route exposed no primary geometry carrier');
        var duplicateCarrier = primaryCarrier.cloneNode(true);
        var duplicateGeometry = /^(path|line|polyline)$/i.test(duplicateCarrier.tagName)
          ? duplicateCarrier
          : duplicateCarrier.querySelector('path, line, polyline');
        if (duplicateGeometry.tagName.toLowerCase() === 'path') {
          duplicateGeometry.setAttribute('d', duplicateGeometry.getAttribute('d') + ' M 0 0 L 1 1');
        }
        svg.appendChild(duplicateCarrier);
        var duplicateGeometryRejected = Archify.routeProbe.exportSnapshot() === null;
        var duplicateExportError = '';
        try { await Archify.exportMenu.shareCard({ variant: 'route' }); }
        catch (error) { duplicateExportError = String(error && error.message || error); }
        duplicateCarrier.remove();
        var primaryGeometry = /^(path|line|polyline)$/i.test(primaryCarrier.tagName)
          ? primaryCarrier
          : primaryCarrier.querySelector('path, line, polyline');
        var geometryAttribute = primaryGeometry.tagName.toLowerCase() === 'path' ? 'd' :
          primaryGeometry.tagName.toLowerCase() === 'polyline' ? 'points' : 'x2';
        var originalGeometry = primaryGeometry.getAttribute(geometryAttribute);
        primaryGeometry.setAttribute(geometryAttribute, '');
        var emptyGeometryRejected = Archify.routeProbe.exportSnapshot() === null;
        var emptyGeometryExportError = '';
        try { await Archify.exportMenu.shareCard({ variant: 'route' }); }
        catch (error) { emptyGeometryExportError = String(error && error.message || error); }
        primaryGeometry.setAttribute(geometryAttribute, originalGeometry);
        await new Promise(function (resolve) {
          requestAnimationFrame(function () { requestAnimationFrame(resolve); });
        });
        function stableLiveSnapshot() {
          var clone = svg.cloneNode(true);
          clone.style.removeProperty('transform');
          clone.removeAttribute('data-view-scale');
          Array.from(clone.querySelectorAll('[data-legend-bridge-runtime]')).forEach(function (element) { element.remove(); });
          return clone.outerHTML;
        }
        var liveBefore = stableLiveSnapshot();
        var captured = [];
        var downloads = [];
        var originalCreateObjectURL = URL.createObjectURL.bind(URL);
        var originalAnchorClick = HTMLAnchorElement.prototype.click;
        var originalFillText = CanvasRenderingContext2D.prototype.fillText;
        var headerMetrics = [];
        URL.createObjectURL = function (blob) {
          if (blob && blob.type && blob.type.indexOf('image/svg+xml') === 0) {
            captured.push(blob.text());
          }
          return originalCreateObjectURL(blob);
        };
        HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
        CanvasRenderingContext2D.prototype.fillText = function (text, x, y) {
          if (headerMetrics.length < 2 && (y === 62 || y === 87)) {
            headerMetrics.push({
              y: y,
              text: String(text),
              width: this.measureText(String(text)).width,
              maxWidth: y === 62 ? 798 : 848
            });
          }
          return originalFillText.apply(this, arguments);
        };

        var blob;
        var canonicalBlob;
        var routeReceipt;
        var ordinaryReceipt;
        var routeFingerprints = [];
        try {
          blob = await Archify.exportMenu.downloadRouteShareCard();
          routeReceipt = {
            format: document.documentElement.getAttribute('data-last-export-format'),
            variant: document.documentElement.getAttribute('data-last-export-variant'),
            width: document.documentElement.getAttribute('data-last-export-width'),
            height: document.documentElement.getAttribute('data-last-export-height'),
            canonical: document.documentElement.getAttribute('data-last-export-canonical'),
            routeStateClean: document.documentElement.getAttribute('data-last-export-route-state-clean'),
            error: document.documentElement.getAttribute('data-last-export-error')
          };
          var routeSvgText = captured[0] ? await captured[0] : '';
          function fingerprint(text) {
            var hash = 2166136261;
            for (var index = 0; index < text.length; index++) {
              hash ^= text.charCodeAt(index);
              hash = Math.imul(hash, 16777619);
            }
            return (hash >>> 0).toString(16);
          }
          routeFingerprints.push(fingerprint(routeSvgText));

          if (${JSON.stringify(options.journeyInvariance === true)}) {
            async function captureJourneySource(action) {
              action();
              var captureIndex = captured.length;
              await Archify.exportMenu.shareCard({ variant: 'route' });
              routeFingerprints.push(fingerprint(await captured[captureIndex]));
            }
            await captureJourneySource(function () { Archify.routeProbe.selectJourneyIndex(0); });
            await captureJourneySource(function () { Archify.routeProbe.selectJourneyIndex(Math.floor(snapshot.nodeIds.length / 2)); });
            await captureJourneySource(function () { Archify.routeProbe.selectJourneyIndex(snapshot.nodeIds.length - 1); });
            Archify.routeProbe.showOverview({ reveal: false });
            var started = Archify.routeProbe.playJourney();
            if (!started) throw new Error('Route Journey could not enter playing state for invariance check');
            await captureJourneySource(function () {});
            Archify.routeProbe.pauseJourney({ preserveElapsed: false });
            await captureJourneySource(function () {});
            document.documentElement.setAttribute('data-motion', 'still');
            await captureJourneySource(function () {});
            document.documentElement.setAttribute('data-motion', 'live');
            Archify.routeProbe.showOverview({ reveal: false });
          }

          var toBlobError = '';
          var originalToBlob = HTMLCanvasElement.prototype.toBlob;
          HTMLCanvasElement.prototype.toBlob = function (callback) { callback(null); };
          try { await Archify.exportMenu.shareCard({ variant: 'route' }); }
          catch (error) { toBlobError = String(error && error.message || error); }
          finally { HTMLCanvasElement.prototype.toBlob = originalToBlob; }

          var missingToBlobError = '';
          HTMLCanvasElement.prototype.toBlob = undefined;
          try { await Archify.exportMenu.shareCard({ variant: 'route' }); }
          catch (error) { missingToBlobError = String(error && error.message || error); }
          finally { HTMLCanvasElement.prototype.toBlob = originalToBlob; }

          var missingContextError = '';
          var originalGetContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function () { return null; };
          try { await Archify.exportMenu.shareCard({ variant: 'route' }); }
          catch (error) { missingContextError = String(error && error.message || error); }
          finally { HTMLCanvasElement.prototype.getContext = originalGetContext; }

          var imageDecodeError = '';
          var OriginalImage = window.Image;
          function FailingImage() {}
          Object.defineProperty(FailingImage.prototype, 'src', {
            set: function () {
              var instance = this;
              queueMicrotask(function () {
                if (typeof instance.onerror === 'function') instance.onerror(new Event('error'));
              });
            }
          });
          window.Image = FailingImage;
          try { await Archify.exportMenu.shareCard({ variant: 'route' }); }
          catch (error) { imageDecodeError = String(error && error.message || error); }
          finally { window.Image = OriginalImage; }

          var unknownVariantError = '';
          try { await Archify.exportMenu.shareCard({ variant: 'unknown' }); }
          catch (error) { unknownVariantError = String(error && error.message || error); }

          var canonicalIndex = captured.length;
          canonicalBlob = await Archify.exportMenu.shareCard();
          var canonicalSvgText = captured[canonicalIndex] ? await captured[canonicalIndex] : '';
          await Archify.exportMenu.run('share-card');
          ordinaryReceipt = {
            format: document.documentElement.getAttribute('data-last-export-format'),
            variant: document.documentElement.getAttribute('data-last-export-variant'),
            width: document.documentElement.getAttribute('data-last-export-width'),
            height: document.documentElement.getAttribute('data-last-export-height'),
            canonical: document.documentElement.getAttribute('data-last-export-canonical'),
            routeStateClean: document.documentElement.getAttribute('data-last-export-route-state-clean'),
            error: document.documentElement.getAttribute('data-last-export-error')
          };
          var svgDownloadIndex = captured.length;
          await Archify.exportMenu.run('svg');
          var exportedSvgText = captured[svgDownloadIndex] ? await captured[svgDownloadIndex] : '';
          var svgReceipt = {
            format: document.documentElement.getAttribute('data-last-export-format'),
            variant: document.documentElement.getAttribute('data-last-export-variant'),
            canonical: document.documentElement.getAttribute('data-last-export-canonical')
          };
          await Archify.exportMenu.run('png');
          var pngReceipt = {
            format: document.documentElement.getAttribute('data-last-export-format'),
            variant: document.documentElement.getAttribute('data-last-export-variant'),
            canonical: document.documentElement.getAttribute('data-last-export-canonical')
          };

          var parser = new DOMParser();
          var routeSvg = parser.parseFromString(routeSvgText, 'image/svg+xml').documentElement;
          var canonicalSvg = parser.parseFromString(canonicalSvgText, 'image/svg+xml').documentElement;
          var exportedSvg = parser.parseFromString(exportedSvgText, 'image/svg+xml').documentElement;
          var matchedNodeIds = Array.from(routeSvg.querySelectorAll('[data-node-id][data-share-route-match]')).map(function (node) {
            return { id: node.getAttribute('data-node-id'), step: Number(node.getAttribute('data-share-route-step')) };
          }).sort(function (a, b) { return a.step - b.step; }).map(function (item) { return item.id; });
          var edgeSteps = new Map();
          Array.from(routeSvg.querySelectorAll('[data-edge-key][data-share-route-match]')).forEach(function (edge) {
            edgeSteps.set(edge.getAttribute('data-edge-key'), Number(edge.getAttribute('data-share-route-step')));
          });
          var matchedEdgeKeys = Array.from(edgeSteps).sort(function (a, b) { return a[1] - b[1]; }).map(function (entry) { return entry[0]; });
          var expectedEdgeKeys = snapshot.edges.map(function (edge) { return edge.key; });
          var routeNodeIds = Array.from(routeSvg.querySelectorAll('[data-node-id]')).map(function (node) { return node.getAttribute('data-node-id'); }).sort();
          var liveNodeIds = Array.from(svg.querySelectorAll('[data-node-id]')).map(function (node) { return node.getAttribute('data-node-id'); }).sort();
          var routeEdgeKeys = Array.from(new Set(Array.from(routeSvg.querySelectorAll('[data-edge-key]')).map(function (edge) { return edge.getAttribute('data-edge-key'); }))).sort();
          var liveEdgeKeys = Array.from(new Set(Array.from(svg.querySelectorAll('[data-edge-key]')).map(function (edge) { return edge.getAttribute('data-edge-key'); }))).sort();

          var bytes = new Uint8Array(await blob.arrayBuffer());
          var binary = '';
          for (var offset = 0; offset < bytes.length; offset += 32768) {
            binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 32768));
          }

          await new Promise(function (resolve) {
            requestAnimationFrame(function () { requestAnimationFrame(resolve); });
          });
          var liveAfter = stableLiveSnapshot();
          var liveUnchanged = liveBefore === liveAfter;
          var liveDiff = '';
          if (!liveUnchanged) {
            var diffIndex = 0;
            while (diffIndex < liveBefore.length && diffIndex < liveAfter.length && liveBefore[diffIndex] === liveAfter[diffIndex]) diffIndex++;
            liveDiff = 'at ' + diffIndex + ': before=' + liveBefore.slice(Math.max(0, diffIndex - 80), diffIndex + 160) +
              ' after=' + liveAfter.slice(Math.max(0, diffIndex - 80), diffIndex + 160);
          }

          var asyncClearIndex = captured.length;
          var asyncClearPromise = Archify.exportMenu.shareCard({ variant: 'route' });
          Archify.routeProbe.clear({ updateUrl: false, preserveView: true });
          var asyncClearBlob = await asyncClearPromise;
          var asyncClearFingerprint = fingerprint(await captured[asyncClearIndex]);
          var hiddenAfterClear = routeMenuItem.hidden && routeMenuItem.disabled &&
            getComputedStyle(routeMenuItem).display === 'none';
          var staleError = '';
          try { await Archify.exportMenu.shareCard({ variant: 'route' }); }
          catch (error) { staleError = String(error && error.message || error); }
          await Archify.exportMenu.downloadRouteShareCard();
          var failedReceipt = {
            format: document.documentElement.getAttribute('data-last-export-format'),
            variant: document.documentElement.getAttribute('data-last-export-variant'),
            errorFormat: document.documentElement.getAttribute('data-last-export-error-format'),
            error: document.documentElement.getAttribute('data-last-export-error')
          };

          return {
            ok: true,
            type: blob.type,
            size: blob.size,
            base64: btoa(binary),
            snapshot: snapshot,
            matchedNodeIds: matchedNodeIds,
            matchedEdgeKeys: matchedEdgeKeys,
            expectedEdgeKeys: expectedEdgeKeys,
            routeShare: routeSvg.hasAttribute('data-share-route'),
            routeLiveResidue: routeSvg.querySelectorAll('[data-route-match], [data-route-step], [data-route-start], [data-route-end], [data-route-journey-state], [data-route-journey-current], [data-route-journey-overlay]').length,
            routeMotionResidue: (routeSvg.hasAttribute('data-animation') ? 1 : 0) + routeSvg.querySelectorAll('[data-animate]').length,
            routeNodeIds: routeNodeIds,
            liveNodeIds: liveNodeIds,
            routeEdgeKeys: routeEdgeKeys,
            liveEdgeKeys: liveEdgeKeys,
            canonicalRouteResidue: canonicalSvg.querySelectorAll('[data-route-match], [data-route-step], [data-route-start], [data-route-end], [data-share-route-match], [data-share-route-step], [data-share-route-start], [data-share-route-end], [data-share-route-middle]').length,
            canonicalRouteActive: canonicalSvg.hasAttribute('data-route-active') || canonicalSvg.hasAttribute('data-share-route'),
            canonicalSize: canonicalBlob.size,
            liveUnchanged: liveUnchanged,
            liveDiff: liveDiff,
            menuResolved: menuResolved,
            duplicateGeometryRejected: duplicateGeometryRejected,
            duplicateExportError: duplicateExportError,
            emptyGeometryRejected: emptyGeometryRejected,
            emptyGeometryExportError: emptyGeometryExportError,
            toBlobError: toBlobError,
            missingToBlobError: missingToBlobError,
            missingContextError: missingContextError,
            imageDecodeError: imageDecodeError,
            unknownVariantError: unknownVariantError,
            headerMetrics: headerMetrics,
            routeLabelExecuted: !!window.__routeLabelExecuted,
            svgReceipt: svgReceipt,
            pngReceipt: pngReceipt,
            exportedSvgRouteResidue: exportedSvg.hasAttribute('data-route-active') ||
              exportedSvg.hasAttribute('data-share-route') ||
              exportedSvg.querySelectorAll('[data-route-match], [data-route-step], [data-route-start], [data-route-end], [data-share-route-match], [data-share-route-step], [data-share-route-start], [data-share-route-end], [data-share-route-middle]').length > 0,
            exportedSvgDualTheme: /prefers-color-scheme:\s*light/.test(Array.from(exportedSvg.querySelectorAll('style')).map(function (style) { return style.textContent; }).join('\n')),
            asyncClearStable: asyncClearBlob && asyncClearBlob.type === 'image/png' && asyncClearFingerprint === routeFingerprints[0],
            hiddenAfterClear: hiddenAfterClear,
            staleSnapshot: Archify.routeProbe.exportSnapshot(),
            staleError: staleError,
            routeFingerprints: routeFingerprints,
            downloads: downloads,
            routeReceipt: routeReceipt,
            ordinaryReceipt: ordinaryReceipt,
            failedReceipt: failedReceipt
          };
        } finally {
          URL.createObjectURL = originalCreateObjectURL;
          HTMLAnchorElement.prototype.click = originalAnchorClick;
          CanvasRenderingContext2D.prototype.fillText = originalFillText;
        }
      } catch (error) {
        return { ok: false, error: String(error && error.message || error) };
      }
    })()`, true), 25_000, `${label} Route Card export`);

    assert.equal(routePayload?.ok, true, routePayload?.error || `${label} Route Card export failed`);
    assert.equal(routePayload.type, 'image/png');
    assert.ok(routePayload.size > 20_000, `${label} Route Card is unexpectedly small (${routePayload.size} bytes)`);
    const png = Buffer.from(routePayload.base64, 'base64');
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${label} Route Card is not a PNG`);
    assert.equal(png.readUInt32BE(16), 1200, `${label} Route Card width`);
    assert.equal(png.readUInt32BE(20), 630, `${label} Route Card height`);
    const pngPath = path.join(tmp, `${label}.route-share-card.png`);
    fs.writeFileSync(pngPath, png);
    const sampledPixels = execFileSync(ffmpeg, [
      '-v', 'error',
      '-i', pngPath,
      '-vf', 'scale=120:63',
      '-frames:v', '1',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgb24',
      '-',
    ], { maxBuffer: 4 * 1024 * 1024 });
    const sampledColors = new Set();
    for (let offset = 0; offset < sampledPixels.length; offset += 3) {
      sampledColors.add(sampledPixels.subarray(offset, offset + 3).toString('hex'));
    }
    assert.ok(sampledColors.size >= 20, `${label} Route Card has only ${sampledColors.size} sampled colors`);
    assert.equal(routePayload.routeShare, true);
    assert.deepEqual(routePayload.matchedNodeIds, routePayload.snapshot.nodeIds);
    assert.deepEqual(routePayload.matchedEdgeKeys, routePayload.expectedEdgeKeys);
    assert.equal(routePayload.routeLiveResidue, 0);
    assert.equal(routePayload.routeMotionResidue, 0);
    assert.deepEqual(routePayload.routeNodeIds, routePayload.liveNodeIds);
    assert.deepEqual(routePayload.routeEdgeKeys, routePayload.liveEdgeKeys);
    assert.equal(routePayload.canonicalRouteResidue, 0);
    assert.equal(routePayload.canonicalRouteActive, false);
    assert.equal(routePayload.liveUnchanged, true, routePayload.liveDiff);
    assert.equal(routePayload.menuResolved, true);
    assert.equal(routePayload.duplicateGeometryRejected, true);
    assert.match(routePayload.duplicateExportError, /Trace a route before exporting a Route Share Card/);
    assert.equal(routePayload.emptyGeometryRejected, true);
    assert.match(routePayload.emptyGeometryExportError, /Trace a route before exporting a Route Share Card/);
    assert.match(routePayload.toBlobError, /toBlob returned null for Share Card/);
    assert.match(routePayload.missingToBlobError, /canvas\.toBlob unavailable for Share Card/);
    assert.match(routePayload.missingContextError, /2D canvas context unavailable for Share Card/);
    assert.ok(routePayload.imageDecodeError);
    assert.match(routePayload.unknownVariantError, /Unknown Share Card variant: unknown/);
    assert.equal(routePayload.routeLabelExecuted, false);
    assert.deepEqual(routePayload.headerMetrics.map((metric) => metric.y), [62, 87]);
    assert.ok(routePayload.headerMetrics.every((metric) => metric.width <= metric.maxWidth + 0.5), `${label} title/subtitle overflowed the Share Card header`);
    assert.deepEqual(routePayload.svgReceipt, { format: 'svg', variant: null, canonical: 'true' });
    assert.deepEqual(routePayload.pngReceipt, { format: 'png', variant: null, canonical: 'true' });
    assert.equal(routePayload.exportedSvgRouteResidue, false);
    assert.equal(routePayload.exportedSvgDualTheme, true);
    assert.equal(routePayload.asyncClearStable, true);
    assert.equal(routePayload.hiddenAfterClear, true);
    assert.equal(routePayload.staleSnapshot, null);
    assert.match(routePayload.staleError, /Trace a route before exporting a Route Share Card/);
    assert.ok(routePayload.routeFingerprints.every((fingerprint) => fingerprint === routePayload.routeFingerprints[0]), `${label} Route source changed across Journey state`);
    assert.match(routePayload.downloads[0], /-route-share-card\.png$/);
    assert.doesNotMatch(routePayload.downloads[0], /-route-.+-to-.+\.png$/);
    assert.deepEqual(routePayload.routeReceipt, {
      format: 'share-card',
      variant: 'route',
      width: '1200',
      height: '630',
      canonical: 'false',
      routeStateClean: 'true',
      error: null,
    });
    assert.deepEqual(routePayload.ordinaryReceipt, {
      format: 'share-card',
      variant: null,
      width: '1200',
      height: '630',
      canonical: 'true',
      routeStateClean: null,
      error: null,
    });
    assert.equal(routePayload.failedReceipt.format, null);
    assert.equal(routePayload.failedReceipt.variant, null);
    assert.equal(routePayload.failedReceipt.errorFormat, 'share-card');
    assert.match(routePayload.failedReceipt.error, /Trace a route before exporting a Route Share Card/);
    if (options.expectedHops !== undefined) assert.equal(routePayload.snapshot.hops, options.expectedHops);
    if (options.expectedSourceLabel !== undefined) assert.equal(routePayload.snapshot.source.label, options.expectedSourceLabel);
    if (options.expectedTargetLabel !== undefined) assert.equal(routePayload.snapshot.target.label, options.expectedTargetLabel);
    console.log(`ok ${label} Route Card: ${routePayload.size} bytes, ${routePayload.snapshot.nodeIds.length} nodes, ${routePayload.snapshot.edges.length} exact hops`);
  }

  async function verifyDynamicReducedMotionRoute(file, label, sourceId, targetId) {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    }, sessionId);
    await navigateReady(file, '!!(window.Archify && Archify.routeProbe && Archify.exportMenu && Archify.motionGovernor)', label);

    async function sourceFingerprint() {
      return withTimeout(evaluate(cdp, sessionId, String.raw`(async function () {
        var originalCreateObjectURL = URL.createObjectURL.bind(URL);
        var sourcePromise = null;
        URL.createObjectURL = function (blob) {
          if (!sourcePromise && blob && blob.type && blob.type.indexOf('image/svg+xml') === 0) sourcePromise = blob.text();
          return originalCreateObjectURL(blob);
        };
        try {
          await Archify.exportMenu.shareCard({ variant: 'route' });
          var source = await sourcePromise;
          var hash = 2166136261;
          for (var index = 0; index < source.length; index++) {
            hash ^= source.charCodeAt(index);
            hash = Math.imul(hash, 16777619);
          }
          return (hash >>> 0).toString(16);
        } finally {
          URL.createObjectURL = originalCreateObjectURL;
        }
      })()`, true), 10_000, `${label} source fingerprint`);
    }

    const setup = await evaluate(cdp, sessionId, `(function () {
      Archify.routeProbe.begin({ source: ${JSON.stringify(sourceId)}, focusNode: false });
      if (!Archify.routeProbe.choose(${JSON.stringify(targetId)}, { updateUrl: false })) return { resolved: false };
      Archify.routeProbe.showOverview({ reveal: false });
      return {
        resolved: true,
        started: Archify.routeProbe.playJourney(),
        playing: Archify.routeProbe.isJourneyPlaying(),
        motion: document.documentElement.getAttribute('data-motion')
      };
    })()`);
    assert.deepEqual(setup, { resolved: true, started: true, playing: true, motion: 'live' });
    const before = await sourceFingerprint();

    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    }, sessionId);
    let reduced = null;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      reduced = await evaluate(cdp, sessionId, `({
        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        motion: document.documentElement.getAttribute('data-motion'),
        playing: Archify.routeProbe.isJourneyPlaying()
      })`);
      if (reduced.matches && reduced.motion === 'still' && !reduced.playing) break;
      await delay(20);
    }
    assert.deepEqual(reduced, { matches: true, motion: 'still', playing: false });
    const after = await sourceFingerprint();
    assert.equal(after, before, `${label} source changed after dynamic reduced-motion paused Journey`);

    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
    }, sessionId);
    console.log(`ok ${label}: dynamic reduced-motion paused Journey without changing Route Card source`);
  }

  async function captureRouteVisualMatrix(file, label, sourceId, targetId) {
    await navigateReady(file, '!!(window.Archify && Archify.preset && Archify.routeProbe && Archify.exportMenu)', label);
    const matrix = await withTimeout(evaluate(cdp, sessionId, String.raw`(async function () {
      Archify.routeProbe.begin({ source: ${JSON.stringify(sourceId)}, focusNode: false });
      if (!Archify.routeProbe.choose(${JSON.stringify(targetId)}, { updateUrl: false })) {
        throw new Error('route did not resolve');
      }
      var identity = JSON.stringify(Archify.routeProbe.exportSnapshot());
      var results = [];
      for (var preset of ['classic', 'signal-flow', 'blueprint']) {
        if (!Archify.preset.apply(preset)) throw new Error('could not apply preset ' + preset);
        for (var theme of ['dark', 'light']) {
          document.documentElement.setAttribute('data-theme', theme);
          var blob = await Archify.exportMenu.shareCard({ variant: 'route' });
          var bytes = new Uint8Array(await blob.arrayBuffer());
          var hash = 2166136261;
          for (var index = 0; index < bytes.length; index++) {
            hash ^= bytes[index];
            hash = Math.imul(hash, 16777619);
          }
          var view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          results.push({
            preset: preset,
            theme: theme,
            type: blob.type,
            size: blob.size,
            width: view.getUint32(16),
            height: view.getUint32(20),
            hash: (hash >>> 0).toString(16),
            identity: JSON.stringify(Archify.routeProbe.exportSnapshot())
          });
        }
      }
      return { identity: identity, results: results };
    })()`, true), 20_000, `${label} Route visual matrix`);

    assert.equal(matrix.results.length, 6);
    for (const result of matrix.results) {
      assert.equal(result.type, 'image/png', `${label} ${result.preset}/${result.theme} MIME`);
      assert.equal(result.width, 1200, `${label} ${result.preset}/${result.theme} width`);
      assert.equal(result.height, 630, `${label} ${result.preset}/${result.theme} height`);
      assert.ok(result.size > 20_000, `${label} ${result.preset}/${result.theme} is unexpectedly small`);
      assert.equal(result.identity, matrix.identity, `${label} ${result.preset}/${result.theme} changed route identity`);
    }
    assert.equal(new Set(matrix.results.map((result) => result.hash)).size, 6, `${label} presets/themes should produce six distinct PNGs`);
    console.log(`ok ${label} Route visual matrix: Classic/Flow/Blueprint x dark/light`);
  }

  async function captureReachShareCard(file, label, originId, direction, options = {}) {
    await navigateReady(file, '!!(window.Archify && Archify.focus && Archify.focus.reachabilitySnapshot && Archify.exportMenu && Archify.exportMenu.downloadReachShareCard)', label);
    const reachPayload = await withTimeout(evaluate(cdp, sessionId, String.raw`(async function () {
      try {
        window.alert = function (message) { window.__archifyReachAlert = String(message); };
        if (!Archify.focus.set(${JSON.stringify(originId)}, { toggle: false, updateUrl: false })) {
          throw new Error('focus origin did not resolve');
        }
        if (!Archify.focus.reach(${JSON.stringify(direction)}, { toggle: false, updateUrl: false, reveal: false })) {
          throw new Error('authored reach did not resolve');
        }
        var snapshot = Archify.focus.reachabilitySnapshot();
        if (!snapshot) throw new Error('active authored reach exposed no export snapshot');
        Archify.exportMenu.syncReachShare();
        var reachMenuItem = document.querySelector('[data-action="reach-share-card"]');
        var menuResolved = !!reachMenuItem && !reachMenuItem.hidden && !reachMenuItem.disabled &&
          getComputedStyle(reachMenuItem).display !== 'none';
        var svg = document.querySelector('.diagram-container svg');

        var firstEdge = snapshot.edges[0];
        var primaryCarrier = Array.from(svg.querySelectorAll('[data-edge-key]')).find(function (element) {
          return element.getAttribute('data-edge-key') === firstEdge.key && hasDrawableGeometry(element);
        });
        if (!primaryCarrier) throw new Error('reach exposed no primary geometry carrier');
        var duplicateCarrier = primaryCarrier.cloneNode(true);
        var duplicateGeometry = /^(path|line|polyline)$/i.test(duplicateCarrier.tagName)
          ? duplicateCarrier
          : duplicateCarrier.querySelector('path, line, polyline');
        if (duplicateGeometry.tagName.toLowerCase() === 'path') {
          duplicateGeometry.setAttribute('d', duplicateGeometry.getAttribute('d') + ' M 0 0 L 1 1');
        }
        svg.appendChild(duplicateCarrier);
        var duplicateGeometryRejected = Archify.focus.reachabilitySnapshot() === null;
        var duplicateExportError = '';
        try { await Archify.exportMenu.shareCard({ variant: 'reach' }); }
        catch (error) { duplicateExportError = String(error && error.message || error); }
        duplicateCarrier.remove();
        snapshot = Archify.focus.reachabilitySnapshot();
        if (!snapshot) throw new Error('reach snapshot did not recover after geometry restoration');

        function stableLiveSnapshot() {
          var clone = svg.cloneNode(true);
          clone.style.removeProperty('transform');
          clone.removeAttribute('data-view-scale');
          Array.from(clone.querySelectorAll('[data-legend-bridge-runtime]')).forEach(function (element) { element.remove(); });
          return clone.outerHTML;
        }
        function fingerprintBytes(bytes) {
          var hash = 2166136261;
          for (var index = 0; index < bytes.length; index++) {
            hash ^= bytes[index];
            hash = Math.imul(hash, 16777619);
          }
          return (hash >>> 0).toString(16);
        }
        var liveBefore = stableLiveSnapshot();
        var captured = [];
        var downloads = [];
        var originalCreateObjectURL = URL.createObjectURL.bind(URL);
        var originalAnchorClick = HTMLAnchorElement.prototype.click;
        URL.createObjectURL = function (blob) {
          if (blob && blob.type && blob.type.indexOf('image/svg+xml') === 0) captured.push(blob.text());
          return originalCreateObjectURL(blob);
        };
        HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };

        try {
          var blob = await Archify.exportMenu.shareCard({ variant: 'reach' });
          var reachSvgText = captured[0] ? await captured[0] : '';
          var downloadedBlob = await Archify.exportMenu.downloadReachShareCard();
          var reachReceipt = {
            format: document.documentElement.getAttribute('data-last-export-format'),
            variant: document.documentElement.getAttribute('data-last-export-variant'),
            width: document.documentElement.getAttribute('data-last-export-width'),
            height: document.documentElement.getAttribute('data-last-export-height'),
            canonical: document.documentElement.getAttribute('data-last-export-canonical'),
            routeStateClean: document.documentElement.getAttribute('data-last-export-route-state-clean'),
            reachStateClean: document.documentElement.getAttribute('data-last-export-reach-state-clean'),
            error: document.documentElement.getAttribute('data-last-export-error')
          };

          var parser = new DOMParser();
          var reachSvg = parser.parseFromString(reachSvgText, 'image/svg+xml').documentElement;
          var matchedNodeIds = Array.from(reachSvg.querySelectorAll('[data-node-id][data-share-reach-match]')).map(function (node) {
            return node.getAttribute('data-node-id');
          });
          var matchedEdgeKeys = Array.from(new Set(Array.from(reachSvg.querySelectorAll('[data-edge-key][data-share-reach-match]')).map(function (edge) {
            return edge.getAttribute('data-edge-key');
          })));
          var reachNodeIds = Array.from(reachSvg.querySelectorAll('[data-node-id]')).map(function (node) {
            return node.getAttribute('data-node-id');
          }).sort();
          var liveNodeIds = Array.from(svg.querySelectorAll('[data-node-id]')).map(function (node) {
            return node.getAttribute('data-node-id');
          }).sort();
          var reachEdgeKeys = Array.from(new Set(Array.from(reachSvg.querySelectorAll('[data-edge-key]')).map(function (edge) {
            return edge.getAttribute('data-edge-key');
          }))).sort();
          var liveEdgeKeys = Array.from(new Set(Array.from(svg.querySelectorAll('[data-edge-key]')).map(function (edge) {
            return edge.getAttribute('data-edge-key');
          }))).sort();
          var reachStyles = Array.from(reachSvg.querySelectorAll('style')).map(function (style) { return style.textContent; }).join('\n');

          await new Promise(function (resolve) {
            requestAnimationFrame(function () { requestAnimationFrame(resolve); });
          });
          var liveAfter = stableLiveSnapshot();

          var matrix = [];
          if (${JSON.stringify(options.matrix === true)}) {
            var identity = JSON.stringify(snapshot);
            for (var preset of ['classic', 'signal-flow', 'blueprint']) {
              if (!Archify.preset.apply(preset)) throw new Error('could not apply preset ' + preset);
              for (var theme of ['dark', 'light']) {
                document.documentElement.setAttribute('data-theme', theme);
                var matrixBlob = await Archify.exportMenu.shareCard({ variant: 'reach' });
                var matrixBytes = new Uint8Array(await matrixBlob.arrayBuffer());
                var matrixView = new DataView(matrixBytes.buffer, matrixBytes.byteOffset, matrixBytes.byteLength);
                matrix.push({
                  preset: preset,
                  theme: theme,
                  type: matrixBlob.type,
                  size: matrixBlob.size,
                  width: matrixView.getUint32(16),
                  height: matrixView.getUint32(20),
                  hash: fingerprintBytes(matrixBytes),
                  identity: JSON.stringify(Archify.focus.reachabilitySnapshot())
                });
              }
            }
            if (matrix.some(function (entry) { return entry.identity !== identity; })) {
              throw new Error('visual matrix changed authored reach identity');
            }
          }

          Archify.focus.clearReach({ updateUrl: false });
          Archify.exportMenu.syncReachShare();
          var hiddenAfterClear = reachMenuItem.hidden && reachMenuItem.disabled &&
            getComputedStyle(reachMenuItem).display === 'none';
          var staleError = '';
          try { await Archify.exportMenu.shareCard({ variant: 'reach' }); }
          catch (error) { staleError = String(error && error.message || error); }
          await Archify.exportMenu.downloadReachShareCard();
          var failedReceipt = {
            format: document.documentElement.getAttribute('data-last-export-format'),
            variant: document.documentElement.getAttribute('data-last-export-variant'),
            errorFormat: document.documentElement.getAttribute('data-last-export-error-format'),
            error: document.documentElement.getAttribute('data-last-export-error')
          };
          var canonicalIndex = captured.length;
          var canonicalBlob = await Archify.exportMenu.shareCard();
          var canonicalSvgText = captured[canonicalIndex] ? await captured[canonicalIndex] : '';
          var canonicalSvg = parser.parseFromString(canonicalSvgText, 'image/svg+xml').documentElement;
          var canonicalReachResidue = canonicalSvg.hasAttribute('data-share-reach') ||
            canonicalSvg.hasAttribute('data-reach-active') ||
            canonicalSvg.querySelectorAll('[data-share-reach-match], [data-share-reach-origin], [data-share-reach-depth], [data-reach-match], [data-reach-origin], [data-reach-depth]').length > 0;

          var bytes = new Uint8Array(await blob.arrayBuffer());
          var binary = '';
          for (var offset = 0; offset < bytes.length; offset += 32768) {
            binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 32768));
          }
          return {
            ok: true,
            type: blob.type,
            size: blob.size,
            base64: btoa(binary),
            snapshot: snapshot,
            matchedNodeIds: matchedNodeIds,
            matchedEdgeKeys: matchedEdgeKeys,
            expectedEdgeKeys: snapshot.edges.map(function (edge) { return edge.key; }),
            reachDirection: reachSvg.getAttribute('data-share-reach'),
            originCount: reachSvg.querySelectorAll('[data-node-id][data-share-reach-origin]').length,
            reachLiveResidue: reachSvg.hasAttribute('data-reach-active') || reachSvg.querySelectorAll('[data-reach-match], [data-reach-origin], [data-reach-depth]').length > 0,
            routeResidue: reachSvg.hasAttribute('data-share-route') || reachSvg.querySelectorAll('[data-share-route-match], [data-share-route-step], [data-route-match], [data-route-step]').length > 0,
            motionResidue: reachSvg.hasAttribute('data-animation') || reachSvg.querySelectorAll('[data-animate]').length > 0,
            blueprintStaticRule: /data-preset=\"blueprint\"\]\[data-share-reach\][^}]*filter:\s*none/.test(reachStyles),
            reachNodeIds: reachNodeIds,
            liveNodeIds: liveNodeIds,
            reachEdgeKeys: reachEdgeKeys,
            liveEdgeKeys: liveEdgeKeys,
            liveUnchanged: liveBefore === liveAfter,
            menuResolved: menuResolved,
            duplicateGeometryRejected: duplicateGeometryRejected,
            duplicateExportError: duplicateExportError,
            downloadStable: downloadedBlob && downloadedBlob.type === 'image/png',
            downloads: downloads,
            reachReceipt: reachReceipt,
            hiddenAfterClear: hiddenAfterClear,
            staleSnapshot: Archify.focus.reachabilitySnapshot(),
            staleError: staleError,
            failedReceipt: failedReceipt,
            canonicalSize: canonicalBlob.size,
            canonicalReachResidue: canonicalReachResidue,
            matrix: matrix
          };
        } finally {
          URL.createObjectURL = originalCreateObjectURL;
          HTMLAnchorElement.prototype.click = originalAnchorClick;
        }
      } catch (error) {
        return { ok: false, error: String(error && error.message || error) };
      }
    })()`, true), options.matrix ? 35_000 : 15_000, `${label} Reach Card export`);

    assert.equal(reachPayload?.ok, true, reachPayload?.error || `${label} Reach Card export failed`);
    assert.equal(reachPayload.type, 'image/png');
    assert.ok(reachPayload.size > 20_000, `${label} Reach Card is unexpectedly small (${reachPayload.size} bytes)`);
    const png = Buffer.from(reachPayload.base64, 'base64');
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${label} Reach Card is not a PNG`);
    assert.equal(png.readUInt32BE(16), 1200, `${label} Reach Card width`);
    assert.equal(png.readUInt32BE(20), 630, `${label} Reach Card height`);
    if (options.outputPath) {
      fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
      fs.writeFileSync(options.outputPath, png);
    }
    assert.equal(reachPayload.reachDirection, direction);
    assert.deepEqual(reachPayload.matchedNodeIds.slice().sort(), reachPayload.snapshot.nodeIds.slice().sort());
    assert.deepEqual(reachPayload.matchedEdgeKeys.slice().sort(), reachPayload.expectedEdgeKeys.slice().sort());
    assert.equal(reachPayload.originCount, 1);
    assert.equal(reachPayload.reachLiveResidue, false);
    assert.equal(reachPayload.routeResidue, false);
    assert.equal(reachPayload.motionResidue, false);
    assert.equal(reachPayload.blueprintStaticRule, true);
    assert.deepEqual(reachPayload.reachNodeIds, reachPayload.liveNodeIds);
    assert.deepEqual(reachPayload.reachEdgeKeys, reachPayload.liveEdgeKeys);
    assert.equal(reachPayload.liveUnchanged, true);
    assert.equal(reachPayload.menuResolved, true);
    assert.equal(reachPayload.duplicateGeometryRejected, true);
    assert.match(reachPayload.duplicateExportError, /Trace authored reach before exporting a Reach Share Card/);
    assert.equal(reachPayload.downloadStable, true);
    assert.match(reachPayload.downloads[0], new RegExp(`-${direction}-reach-share-card\\.png$`));
    assert.deepEqual(reachPayload.reachReceipt, {
      format: 'share-card',
      variant: 'reach',
      width: '1200',
      height: '630',
      canonical: 'false',
      routeStateClean: null,
      reachStateClean: 'true',
      error: null,
    });
    assert.equal(reachPayload.hiddenAfterClear, true);
    assert.equal(reachPayload.staleSnapshot, null);
    assert.match(reachPayload.staleError, /Trace authored reach before exporting a Reach Share Card/);
    assert.equal(reachPayload.failedReceipt.format, null);
    assert.equal(reachPayload.failedReceipt.variant, null);
    assert.equal(reachPayload.failedReceipt.errorFormat, 'share-card');
    assert.match(reachPayload.failedReceipt.error, /Trace authored reach before exporting a Reach Share Card/);
    assert.ok(reachPayload.canonicalSize > 20_000);
    assert.equal(reachPayload.canonicalReachResidue, false);
    if (options.matrix) {
      assert.equal(reachPayload.matrix.length, 6);
      assert.equal(new Set(reachPayload.matrix.map((entry) => entry.hash)).size, 6, `${label} Reach presets/themes should produce six distinct PNGs`);
      for (const entry of reachPayload.matrix) {
        assert.equal(entry.type, 'image/png');
        assert.equal(entry.width, 1200);
        assert.equal(entry.height, 630);
        assert.ok(entry.size > 20_000);
      }
    }
    console.log(`ok ${label} Reach Card: ${reachPayload.size} bytes, ${reachPayload.snapshot.nodeIds.length} nodes, ${reachPayload.snapshot.edges.length} authored links`);
  }

  await captureShareCard(output, 'architecture-wide');
  await captureShareCard(sequenceOutput, 'sequence-tall');
  await captureCopiedShareCard(output, 'architecture-wide');
  await captureRouteShareCard(routeOutputs.architecture, 'architecture-route', 'users', 'api', { journeyInvariance: true });
  await captureRouteShareCard(routeOutputs.workflow, 'workflow-route', 'user', 'approval');
  await captureRouteShareCard(routeOutputs.sequence, 'sequence-route', 'web', 'db');
  await captureRouteShareCard(routeOutputs.dataflow, 'dataflow-route', 'web', 'dashboard');
  await captureRouteShareCard(routeOutputs.lifecycle, 'lifecycle-route', 'executing', 'cancelled');
  await captureRouteShareCard(parallelOutput, 'parallel-route', 'users', 'cdn');
  await captureRouteShareCard(specialRouteOutput, 'special-10-hop-route', 'Route_Source-01', 'Route_Target-10', {
    expectedHops: 10,
    expectedSourceLabel: specialSourceLabel,
    expectedTargetLabel: specialTargetLabel,
  });
  await captureRouteVisualMatrix(routeOutputs.architecture, 'architecture-route', 'users', 'api');
  await captureRouteVisualMatrix(routeOutputs.sequence, 'sequence-route', 'web', 'db');
  await captureReachShareCard(routeOutputs.architecture, 'architecture-reach', 'users', 'downstream', { matrix: true });
  await captureReachShareCard(routeOutputs.workflow, 'workflow-reach', 'user', 'downstream');
  await captureReachShareCard(routeOutputs.sequence, 'sequence-reach', 'web', 'downstream');
  await captureReachShareCard(routeOutputs.dataflow, 'dataflow-reach', 'web', 'downstream');
  await captureReachShareCard(routeOutputs.lifecycle, 'lifecycle-reach', 'executing', 'downstream');
  if (externalReachSource) {
    assert.ok(fs.existsSync(externalReachSource), `external Reach Card source does not exist: ${externalReachSource}`);
    await captureReachShareCard(
      externalReachSource,
      'external-reach',
      process.env.ARCHIFY_REACH_CARD_ORIGIN || 'router',
      process.env.ARCHIFY_REACH_CARD_DIRECTION || 'downstream',
      { outputPath: externalReachOutput },
    );
    console.log(`ok external Reach Card artifact: ${externalReachOutput}`);
  }
  await verifyDynamicReducedMotionRoute(routeOutputs.architecture, 'architecture-route reduced motion', 'users', 'api');
  await navigateReady(output, '!!(window.Archify && Archify.motion && Archify.motion.canRecord())', 'motion artifact');

  const payload = await withTimeout(evaluate(cdp, sessionId, String.raw`(async function () {
    try {
      var blob = await Archify.motion.recordWebm({ duration: 1400, fps: 12 });
      var bytes = new Uint8Array(await blob.arrayBuffer());
      var binary = '';
      for (var offset = 0; offset < bytes.length; offset += 32768) {
        binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 32768));
      }
      return { ok: true, type: blob.type, size: blob.size, base64: btoa(binary) };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  })()`, true), 20_000, 'WebM recording');
  assert.equal(payload?.ok, true, payload?.error || 'WebM recording failed');
  assert.match(payload.type, /^video\/webm/);
  assert.ok(payload.size > 10_000, `WebM is unexpectedly small (${payload.size} bytes)`);

  const webm = path.join(tmp, 'motion.webm');
  fs.writeFileSync(webm, Buffer.from(payload.base64, 'base64'));
  const frameMd5 = execFileSync(ffmpeg, [
    '-v', 'error',
    '-i', webm,
    '-vf', 'fps=6,scale=320:-2',
    '-f', 'framemd5',
    '-',
  ], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  const hashes = frameMd5
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(',').at(-1).trim());
  const uniqueFrames = new Set(hashes);

  assert.ok(hashes.length >= 4, `decoded only ${hashes.length} WebM frames`);
  assert.ok(uniqueFrames.size >= 2, 'decoded WebM frames are static');
  console.log(`ok WebM artifact: ${payload.size} bytes, ${hashes.length} sampled frames, ${uniqueFrames.size} unique`);
} finally {
  if (cdp && targetId) await withTimeout(cdp.send('Target.closeTarget', { targetId }), 500, 'target close').catch(() => {});
  if (cdp) cdp.socket.close();
  chromeProcess.kill('SIGTERM');
  if (!(await waitForExit(chromeProcess, 1000))) {
    chromeProcess.kill('SIGKILL');
    await waitForExit(chromeProcess, 1000);
  }
  await removeTempTree(tmp);
}
