import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { startPreview } from '../bin/preview.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function bounded(promise, message, timeout = 1500) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeout); }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function until(predicate, message) {
  const deadline = Date.now() + 8000;
  while (!await predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await delay(20);
  }
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-preview-force-'));
  const input = path.join(root, 'input.json');
  const output = path.join(root, 'output.html');
  fs.copyFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), input);
  return { root, input, output };
}

async function partialRequest(url) {
  const target = new URL(url);
  const socket = net.connect(Number(target.port), target.hostname);
  // A forced server close can reset the peer on some platforms.
  socket.on('error', () => {});
  await bounded(new Promise((resolve) => socket.once('connect', resolve)), 'client did not connect');
  socket.write('GET /state HTTP/1.1\r\n');
  // Let the server receive the partial header before asking it to stop.
  await delay(60);
  return socket;
}

function assertClean(data, previous) {
  assert.deepEqual(fs.readFileSync(data.output), previous, 'shutdown changed the last artifact');
  assert.deepEqual(fs.readdirSync(data.root).filter((name) => name.startsWith('.archify-preview-')), []);
}

for (const gracefulFirst of [false, true]) {
  test(`preview: ${gracefulFirst ? 'escalated' : 'direct'} force closes an unfinished HTTP request`, { timeout: 12000 }, async () => {
    const data = fixture();
    let preview;
    let socket;
    try {
      preview = await startPreview({ ...data, type: 'architecture', open: false });
      await until(() => preview.state().status === 'verified', 'initial delivery did not verify');
      const previous = fs.readFileSync(data.output);
      socket = await partialRequest(preview.url);
      let ordinaryStop;
      if (gracefulFirst) {
        ordinaryStop = preview.stop();
        const completed = await Promise.race([ordinaryStop.then(() => true), delay(60).then(() => false)]);
        assert.equal(completed, false, 'ordinary stop should still wait for the active request');
      }
      await bounded(preview.stop({ force: true }), 'force waited for an unfinished HTTP request');
      if (ordinaryStop) await ordinaryStop;
      await preview.closed;
      await preview.stop({ force: true });
      await preview.stop();
      assertClean(data, previous);
      await assert.rejects(fetch(preview.url));
    } finally {
      socket?.destroy();
      if (preview) await preview.stop({ force: true });
      fs.rmSync(data.root, { recursive: true, force: true });
    }
  });
}

test('preview: force closes SSE clients and remains idempotent', { timeout: 12000 }, async () => {
  const data = fixture();
  let preview;
  let request;
  let response;
  try {
    preview = await startPreview({ ...data, type: 'architecture', open: false });
    await until(() => preview.state().status === 'verified', 'initial delivery did not verify');
    const previous = fs.readFileSync(data.output);
    response = await bounded(new Promise((resolve, reject) => {
      request = http.get(new URL('/events', preview.url), resolve);
      request.on('error', reject);
    }), 'SSE did not connect');
    response.on('error', () => {});
    const peerClosed = new Promise((resolve) => response.once('close', resolve));
    response.resume();
    await bounded(Promise.all([preview.stop({ force: true }), preview.stop({ force: true })]), 'SSE blocked force');
    await bounded(peerClosed, 'SSE peer stayed open');
    await preview.stop();
    assertClean(data, previous);
  } finally {
    response?.destroy();
    request?.destroy();
    if (preview) await preview.stop({ force: true });
    fs.rmSync(data.root, { recursive: true, force: true });
  }
});

test('preview: force closes HTTP while killing an active delivery without publishing it', { timeout: 12000 }, async () => {
  const data = fixture();
  const ready = path.join(data.root, 'child.ready');
  const deliveryCli = path.join(data.root, 'hung-delivery.mjs');
  const previous = Buffer.from('<!doctype html><title>Previous artifact</title>');
  fs.writeFileSync(data.output, previous);
  fs.writeFileSync(deliveryCli, `import fs from 'node:fs';\nprocess.on('SIGTERM', () => {});\nfs.writeFileSync(${JSON.stringify(ready)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`);
  let preview;
  let socket;
  try {
    preview = await startPreview({ ...data, type: 'architecture', open: false, deliveryCli, stopGraceMs: 5000 });
    await until(() => fs.existsSync(ready), 'delivery child did not start');
    socket = await partialRequest(preview.url);
    const ordinaryStop = preview.stop();
    await bounded(preview.stop({ force: true }), 'force did not drain both child and socket');
    await ordinaryStop;
    assertClean(data, previous);
    assert.throws(() => process.kill(Number(fs.readFileSync(ready, 'utf8')), 0), { code: 'ESRCH' });
  } finally {
    socket?.destroy();
    if (preview) await preview.stop({ force: true });
    fs.rmSync(data.root, { recursive: true, force: true });
  }
});

// Windows does not deliver child.kill('SIGINT') as a console Ctrl-C event.
// The public stop() cases above cover force semantics on every platform.
test('preview CLI: second Ctrl-C exits despite an unfinished HTTP request', {
  skip: process.platform === 'win32' ? 'POSIX signal delivery; public stop API is covered on Windows' : false,
  timeout: 15000,
}, async () => {
  const data = fixture();
  const child = spawn(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'preview', 'architecture', data.input, data.output, '--no-open'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let socket;
  let exited = false;
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const closed = new Promise((resolve) => child.once('close', (code, signal) => {
    exited = true;
    resolve({ code, signal });
  }));
  try {
    await until(() => /http:\/\/127\.0\.0\.1:\d+\//.test(stdout), `CLI did not print a preview URL: ${stderr}`);
    const url = stdout.match(/http:\/\/127\.0\.0\.1:\d+\//)[0];
    await until(async () => (await (await fetch(new URL('/state', url))).json()).status === 'verified', 'CLI did not verify');
    const previous = fs.readFileSync(data.output);
    socket = await partialRequest(url);
    child.kill('SIGINT');
    await until(() => stdout.includes('stopping preview'), 'first Ctrl-C was not handled');
    assert.equal(exited, false);
    child.kill('SIGINT');
    assert.deepEqual(await bounded(closed, 'second Ctrl-C did not force HTTP shutdown'), { code: 0, signal: null });
    assert.match(stdout, /forcing preview shutdown/);
    assertClean(data, previous);
  } finally {
    socket?.destroy();
    if (!exited) child.kill('SIGKILL');
    await closed;
    fs.rmSync(data.root, { recursive: true, force: true });
  }
});

for (const window of ['snapshot', 'receipt']) {
  test(`preview: force preserves recovery material at the real delivery ${window} window`, { timeout: 20000 }, async () => {
    const data = fixture();
    const ready = path.join(data.root, 'delivery.ready');
    const deliveryCli = path.join(data.root, 'paused-delivery.mjs');
    const cli = path.join(skillRoot, 'bin/archify.mjs');
    const previous = Buffer.from('<!doctype html><title>Previous verified artifact</title>');
    fs.writeFileSync(data.output, previous);
    // Pause a real deliver at a deterministic boundary, without publishing its
    // receipt to Preview. No environment changes leak into other tests.
    fs.writeFileSync(deliveryCli, window === 'receipt' ? `
      import fs from 'node:fs';
      import { spawnSync } from 'node:child_process';
      const result = spawnSync(process.execPath, [${JSON.stringify(cli)}, ...process.argv.slice(2)], { encoding: 'utf8' });
      if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(result.status || 1); }
      fs.writeFileSync(${JSON.stringify(ready)}, result.stdout);
      setInterval(() => {}, 1000);
    ` : `
      import fs from 'node:fs';
      import path from 'node:path';
      import { pathToFileURL } from 'node:url';
      const write = fs.writeFileSync;
      fs.writeFileSync = function (target, ...args) {
        const result = write.call(this, target, ...args);
        if (typeof target === 'string' && path.basename(target) === 'specification.snapshot.json') {
          write(${JSON.stringify(ready)}, target);
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
        }
        return result;
      };
      await import(pathToFileURL(${JSON.stringify(cli)}).href);
    `);
    let preview;
    let socket;
    try {
      preview = await startPreview({ ...data, type: 'architecture', open: false, deliveryCli });
      await until(() => fs.existsSync(ready), `real delivery did not reach ${window}`);
      const staging = path.join(data.root, fs.readdirSync(data.root).find((name) => name.startsWith('.archify-preview-')));
      const claimant = path.join(staging, 'claimant.txt');
      fs.writeFileSync(claimant, 'unowned content');
      const retained = window === 'snapshot'
        ? [fs.readFileSync(ready, 'utf8')]
        : ['generation-1.html', 'generation-1.delivery.json'].map((name) => path.join(staging, name));
      const bytes = retained.map((file) => fs.readFileSync(file));
      if (window === 'receipt') assert.equal(JSON.parse(fs.readFileSync(ready, 'utf8')).ok, true);
      socket = await partialRequest(preview.url);
      await bounded(preview.stop({ force: true }), 'force blocked with real delivery and an unfinished request');
      await preview.closed;
      await preview.stop({ force: true });
      assert.deepEqual(fs.readFileSync(data.output), previous);
      assert.equal(fs.readFileSync(claimant, 'utf8'), 'unowned content');
      retained.forEach((file, i) => assert.deepEqual(fs.readFileSync(file), bytes[i], 'recovery material changed'));
      assert.equal(fs.existsSync(path.join(staging, 'generation-1.json')), false, 'owned input snapshot was not cleaned');
      await assert.rejects(fetch(preview.url));
    } finally {
      socket?.destroy();
      if (preview) await preview.stop({ force: true });
      fs.rmSync(data.root, { recursive: true, force: true });
    }
  });
}
