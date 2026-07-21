#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const assetsRoot = path.join(repoRoot, 'docs', 'assets');
const outputPath = path.resolve(process.argv[2] || path.join(assetsRoot, 'archify-live-proof.gif'));
const receiptPath = outputPath.replace(/\.gif$/i, '.json');
const width = 960;
const height = 540;
const fps = 10;
const framesPerScene = 18;

const scenes = [
  {
    id: 'signal-flow',
    artifact: 'docs/gallery/artifacts/agent-tool-call.workflow.html',
    view: 'happy-path',
    eyebrow: 'WORKFLOW · SIGNAL FLOW',
    title: 'Agent Tool Call',
    receipt: '12 nodes · 11 edges · 7/7 checks',
    accent: '#67e8f9',
  },
  {
    id: 'blueprint',
    artifact: 'docs/gallery/artifacts/production-deployment.architecture.html',
    view: 'request-boundary',
    eyebrow: 'ARCHITECTURE · BLUEPRINT',
    title: 'Production Deployment',
    receipt: '12 nodes · 12 edges · 7/7 checks',
    accent: '#f6c453',
  },
  {
    id: 'classic',
    artifact: 'docs/gallery/artifacts/cache-miss.sequence.html',
    view: 'cache-fallback',
    eyebrow: 'SEQUENCE · CLASSIC',
    title: 'Cache Miss Request',
    receipt: '7 participants · 12 messages · 7/7 checks',
    accent: '#c4b5fd',
  },
];

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function executable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return file;
  } catch {
    return null;
  }
}

function commandPath(command) {
  const result = spawnSync('sh', ['-c', 'command -v "$1"', 'archify-showcase', command], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function findChrome() {
  const candidates = [
    process.env.ARCHIFY_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    commandPath('google-chrome'),
    commandPath('google-chrome-stable'),
    commandPath('chromium'),
    commandPath('chromium-browser'),
  ].filter(Boolean);
  return candidates.map(executable).find(Boolean) || null;
}

function requireCommand(command, installHint) {
  const resolved = commandPath(command);
  if (!resolved) throw new Error(`${command} is required. ${installHint}`);
  return resolved;
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function wrapperHtml(scene, index) {
  const artifact = path.join(repoRoot, scene.artifact);
  const artifactUrl = `${pathToFileURL(artifact).href}?embed=1&play=1&theme=dark#view=${encodeURIComponent(scene.view)}`;
  return `<!doctype html>
<html lang="en" style="--accent:${esc(scene.accent)};--fade:1">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#020617;color:#f8fafc;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace}
  iframe{position:absolute;inset:0;width:100%;height:100%;border:0;background:#020617}
  .edge{position:absolute;inset:0;z-index:2;pointer-events:none;border:1px solid rgba(148,163,184,.24);box-shadow:inset 0 0 0 1px rgba(255,255,255,.025)}
  .topbar{position:absolute;z-index:3;top:0;left:0;right:0;height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;background:linear-gradient(180deg,rgba(2,6,23,.98),rgba(2,6,23,.8) 72%,transparent);pointer-events:none}
  .brand{display:flex;align-items:center;gap:10px;font-size:12px;font-weight:800;letter-spacing:.04em}.mark{width:22px;height:22px}.live{color:#6ee7b7;font-size:9px;font-weight:700;letter-spacing:.13em}.live:before{content:'';display:inline-block;width:6px;height:6px;margin-right:7px;border-radius:50%;background:currentColor;box-shadow:0 0 12px currentColor}
  .count{color:#64748b;font-size:9px;letter-spacing:.12em}.count strong{color:#cbd5e1;font-weight:600}
  .caption{position:absolute;z-index:3;left:0;right:0;bottom:0;min-height:72px;display:flex;align-items:flex-end;justify-content:space-between;gap:28px;padding:26px 20px 16px;background:linear-gradient(0deg,rgba(2,6,23,.99),rgba(2,6,23,.86) 58%,transparent);pointer-events:none}
  .eyebrow{margin-bottom:5px;color:var(--accent);font-size:9px;font-weight:800;letter-spacing:.12em}.title{font-size:16px;font-weight:800;letter-spacing:-.02em}.receipt{text-align:right;color:#94a3b8;font-size:9px;line-height:1.6}.receipt strong{display:block;color:#e2e8f0;font-size:10px}.fade{position:absolute;inset:0;z-index:5;background:#020617;opacity:var(--fade);pointer-events:none}
</style>
</head>
<body>
  <iframe src="${esc(artifactUrl)}" title="${esc(scene.title)} generated Archify artifact"></iframe>
  <div class="edge"></div>
  <div class="topbar">
    <div class="brand">
      <svg class="mark" viewBox="0 0 28 28" fill="none" aria-hidden="true"><polygon points="14,2 26,8 26,20 14,26 2,20 2,8" fill="rgba(8,51,68,.8)" stroke="#22d3ee" stroke-width="1.5"/><polygon points="14,7 21,11 21,19 14,23 7,19 7,11" stroke="rgba(34,211,238,.45)"/><circle cx="14" cy="15" r="2.5" fill="#22d3ee"/></svg>
      <span>ARCHIFY</span><span class="live">LIVE PROOF</span>
    </div>
    <div class="count"><strong>${String(index + 1).padStart(2, '0')} / ${String(scenes.length).padStart(2, '0')}</strong></div>
  </div>
  <div class="caption">
    <div><div class="eyebrow">${esc(scene.eyebrow)}</div><div class="title">${esc(scene.title)}</div></div>
    <div class="receipt"><strong>GENERATED · CHECKED · INTERACTIVE</strong>${esc(scene.receipt)}</div>
  </div>
  <div class="fade"></div>
  <script>
    window.__archifyShowcaseReady=false;
    const frame=document.querySelector('iframe');
    frame.addEventListener('load',()=>setTimeout(()=>{window.__archifyShowcaseReady=true},260),{once:true});
  </script>
</body>
</html>`;
}

class PipeCdp {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.buffer = '';
    this.pending = new Map();
    this.waiters = [];
    child.stdio[4].setEncoding('utf8');
    child.stdio[4].on('data', chunk => this.consume(chunk));
    child.once('exit', code => this.failAll(new Error(`Chrome exited before capture completed (${code})`)));
  }

  consume(chunk) {
    this.buffer += chunk;
    let boundary;
    while ((boundary = this.buffer.indexOf('\0')) >= 0) {
      const raw = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 1);
      if (!raw) continue;
      const message = JSON.parse(raw);
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
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  }, sessionId);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed');
  }
  return result.result?.value;
}

async function captureFrames(chromePath, tempRoot) {
  const profileRoot = path.join(tempRoot, 'profile');
  const framesRoot = path.join(tempRoot, 'frames');
  fs.mkdirSync(profileRoot, { recursive: true });
  fs.mkdirSync(framesRoot, { recursive: true });

  const chromeArgs = [
    '--headless=new', '--remote-debugging-pipe', '--disable-gpu', '--hide-scrollbars',
    '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
    '--disable-sync', '--metrics-recording-only', '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding', '--force-device-scale-factor=1',
    `--window-size=${width},${height}`, `--user-data-dir=${profileRoot}`, 'about:blank',
  ];
  if (typeof process.getuid === 'function' && process.getuid() === 0) chromeArgs.unshift('--no-sandbox');

  const chrome = spawn(chromePath, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let chromeErrors = '';
  chrome.stderr.setEncoding('utf8');
  chrome.stderr.on('data', chunk => { chromeErrors = `${chromeErrors}${chunk}`.slice(-8000); });
  const cdp = new PipeCdp(chrome);

  try {
    const targets = await cdp.send('Target.getTargets');
    let target = targets.targetInfos?.find(item => item.type === 'page');
    if (!target) {
      const created = await cdp.send('Target.createTarget', { url: 'about:blank', width, height });
      target = { targetId: created.targetId };
    }
    const attached = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const sessionId = attached.sessionId;
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false,
    }, sessionId);

    let frameIndex = 0;
    for (const [sceneIndex, scene] of scenes.entries()) {
      const wrapperPath = path.join(tempRoot, `showcase-${scene.id}.html`);
      fs.writeFileSync(wrapperPath, wrapperHtml(scene, sceneIndex));
      const loaded = cdp.waitFor('Page.loadEventFired', sessionId);
      const navigation = await cdp.send('Page.navigate', { url: pathToFileURL(wrapperPath).href }, sessionId);
      if (navigation.errorText) throw new Error(`${scene.id}: ${navigation.errorText}`);
      await loaded;
      await evaluate(cdp, sessionId, `new Promise((resolve,reject)=>{const end=Date.now()+12000;const poll=()=>window.__archifyShowcaseReady?resolve(true):Date.now()>end?reject(new Error('artifact load timeout')):setTimeout(poll,40);poll()})`, true);

      for (let i = 0; i < framesPerScene; i += 1) {
        const fade = i === 0 ? 0.82 : i === 1 ? 0.38 : i === framesPerScene - 1 ? 0.42 : 0;
        await evaluate(cdp, sessionId, `document.documentElement.style.setProperty('--fade','${fade}')`);
        if (i > 0) await sleep(88);
        const screenshot = await cdp.send('Page.captureScreenshot', {
          format: 'png', fromSurface: true, captureBeyondViewport: false,
        }, sessionId, 20000);
        const filename = `frame-${String(frameIndex).padStart(4, '0')}.png`;
        fs.writeFileSync(path.join(framesRoot, filename), Buffer.from(screenshot.data, 'base64'));
        frameIndex += 1;
      }
    }
    return { framesRoot, frameCount: frameIndex };
  } catch (error) {
    if (chromeErrors.trim()) error.message += `\nChrome diagnostics:\n${chromeErrors.trim()}`;
    throw error;
  } finally {
    cdp.failAll(new Error('capture finished'));
    chrome.kill('SIGTERM');
  }
}

function buildGif(ffmpeg, framesRoot) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const filter = [
    `fps=${fps},scale=${width}:${height}:flags=lanczos,split[s0][s1]`,
    '[s0]palettegen=max_colors=112:stats_mode=diff[p]',
    '[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
  ].join(';');
  const result = spawnSync(ffmpeg, [
    '-y', '-loglevel', 'error', '-framerate', String(fps),
    '-i', path.join(framesRoot, 'frame-%04d.png'),
    '-filter_complex', filter, '-loop', '0', outputPath,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffmpeg failed:\n${result.stderr || result.stdout}`);
}

async function main() {
  for (const scene of scenes) {
    const artifact = path.join(repoRoot, scene.artifact);
    if (!fs.existsSync(artifact)) throw new Error(`${scene.id}: missing ${scene.artifact}; run node scripts/build-gallery.mjs`);
  }
  const chromePath = findChrome();
  if (!chromePath) throw new Error('Chrome or Chromium is required. Set ARCHIFY_CHROME to its executable path.');
  const ffmpeg = requireCommand('ffmpeg', 'Install it with your system package manager.');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-readme-showcase-'));
  try {
    const { framesRoot, frameCount } = await captureFrames(chromePath, tempRoot);
    buildGif(ffmpeg, framesRoot);
    const receipt = {
      schemaVersion: 1,
      generator: 'scripts/build-readme-showcase.mjs',
      output: path.relative(repoRoot, outputPath),
      width,
      height,
      fps,
      frameCount,
      durationSeconds: frameCount / fps,
      bytes: fs.statSync(outputPath).size,
      sha256: sha256(outputPath),
      scenes: scenes.map(scene => ({
        id: scene.id,
        artifact: scene.artifact,
        artifactSha256: sha256(path.join(repoRoot, scene.artifact)),
        view: scene.view,
        eyebrow: scene.eyebrow,
        title: scene.title,
        receipt: scene.receipt,
      })),
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(`README showcase ${frameCount} frames / ${receipt.durationSeconds.toFixed(1)}s / ${receipt.bytes} bytes`);
    console.log(outputPath);
    console.log(receiptPath);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
