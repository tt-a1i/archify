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

  await captureShareCard(output, 'architecture-wide');
  await captureShareCard(sequenceOutput, 'sequence-tall');
  await captureCopiedShareCard(output, 'architecture-wide');
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
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
