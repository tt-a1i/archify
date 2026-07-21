import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
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

assert.equal(typeof WebSocket, 'function', 'Node.js 22+ is required for the Chrome DevTools smoke harness');

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  await cdp.send('Page.navigate', { url: pathToFileURL(output).href }, sessionId);

  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
    ready = await evaluate(cdp, sessionId, 'document.readyState === "complete" && !!(window.Archify && Archify.motion && Archify.motion.canRecord())');
    if (!ready) await delay(50);
  }
  assert.equal(ready, true, 'rendered artifact did not expose a recordable motion surface');

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
  await Promise.race([
    new Promise((resolve) => chromeProcess.once('exit', resolve)),
    delay(1000).then(() => chromeProcess.kill('SIGKILL')),
  ]);
  fs.rmSync(tmp, { recursive: true, force: true });
}
