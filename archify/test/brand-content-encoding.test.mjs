import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, deflateSync } from 'node:zlib';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const icon = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const digest = createHash('sha256').update(icon).digest('hex');
const compressors = { gzip: gzipSync, br: brotliCompressSync, deflate: deflateSync };
const page = Buffer.from('<html><head><link rel="icon" href="/icon"></head></html>');

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: skillRoot, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
      env: { ...process.env, ARCHIFY_BRAND_ALLOW_PRIVATE: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status) => resolve({ status, stdout, stderr }));
  });
}

async function fixture(t, handler) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ path: request.url, encoding: request.headers['accept-encoding'] });
    handler(request, response);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(resolve);
  }));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests };
}

function send(response, body, type, encoding) {
  response.writeHead(200, { 'content-type': type, ...(encoding ? { 'content-encoding': encoding } : {}) });
  response.end(body);
}
function negotiated(request, response, body, type, encoding) {
  if (request.headers['accept-encoding'] === 'identity') send(response, body, type);
  else send(response, compressors[encoding](body), type, encoding);
}
function assertIdentity(data, paths) {
  assert.deepEqual(data.requests.map(({ path }) => path), paths);
  assert.ok(data.requests.every(({ encoding }) => encoding === 'identity'), JSON.stringify(data.requests));
}
async function capture(url) {
  const result = await run(['brands', 'capture', url, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt.brand, { url, sha256: digest });
  assert.equal(receipt.evidence.sha256, digest);
  return receipt.brand;
}

for (const coding of ['gzip', 'br']) {
  test(`capture negotiates identity for ${coding}-capable pages, icons, and redirects`, { timeout: 20000 }, async (t) => {
    const data = await fixture(t, (request, response) => {
      if (request.url === '/start' || request.url === '/icon') {
        response.writeHead(302, { location: request.url === '/start' ? '/page' : '/mark.png' });
        response.end();
      } else if (request.url === '/page') negotiated(request, response, page, 'text/html', coding);
      else if (request.url === '/mark.png') negotiated(request, response, icon, 'image/png', coding);
      else { response.writeHead(404); response.end(); }
    });
    await capture(`${data.origin}/start`);
    assertIdentity(data, ['/start', '/page', '/icon', '/mark.png']);
  });
}

for (const direct of [true, false]) {
  test(`capture negotiates identity for ${direct ? 'direct images' : 'favicon fallback'}`, { timeout: 20000 }, async (t) => {
    const data = await fixture(t, (request, response) => {
      if (!direct && request.url === '/page') send(response, '<html><head></head></html>', 'text/html');
      else negotiated(request, response, icon, 'image/png', 'gzip');
    });
    await capture(`${data.origin}/${direct ? 'mark.png' : 'page'}`);
    assertIdentity(data, direct ? ['/mark.png'] : ['/page', '/favicon.ico']);
  });
}

for (const [stage, encoding] of [
  ['page', 'gzip'], ['icon', 'br'], ['direct', 'deflate'],
  ['page', 'custom-coding'], ['icon', 'gzip, br'],
]) {
  test(`capture rejects forced ${encoding} on ${stage} without hiding it behind favicon failure`, { timeout: 20000 }, async (t) => {
    const data = await fixture(t, (request, response) => {
      if (request.url === '/favicon.ico') { response.writeHead(404); response.end(); return; }
      if (stage === 'icon' && request.url === '/page') { send(response, page, 'text/html'); return; }
      const body = stage === 'page' ? page : icon;
      send(response, compressors[encoding] ? compressors[encoding](body) : body,
        stage === 'page' ? 'text/html' : 'image/png', encoding);
    });
    const result = await run(['brands', 'capture', `${data.origin}/${stage === 'direct' ? 'mark.png' : 'page'}`, '--json']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unsupported brand content encoding/i);
    assert.ok(result.stderr.includes(encoding));
    assert.ok(data.requests.every(({ encoding }) => encoding === 'identity'));
  });
}

test('unsupported encoding closes an unfinished icon response before the server ends it', { timeout: 20000 }, async (t) => {
  let endedByServer = false;
  let closedEarly = false;
  const data = await fixture(t, (request, response) => {
    if (request.url === '/page') { send(response, page, 'text/html'); return; }
    if (request.url === '/favicon.ico') { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'content-type': 'image/png', 'content-encoding': 'gzip' });
    response.write(gzipSync(icon));
    const guard = setTimeout(() => { endedByServer = true; response.end(); }, 2000);
    response.once('close', () => { closedEarly = !endedByServer; clearTimeout(guard); });
  });
  const result = await run(['brands', 'capture', `${data.origin}/page`, '--json']);
  assert.notEqual(result.status, 0);
  assert.equal(closedEarly, true, 'reject the coding and destroy the stream without waiting for its body');
  assert.match(result.stderr, /unsupported brand content encoding/i);
});

test('HTTP error status retains priority over the error response coding', { timeout: 20000 }, async (t) => {
  const data = await fixture(t, (_request, response) => {
    response.writeHead(404, { 'content-encoding': 'gzip' });
    response.end(gzipSync('missing'));
  });
  const result = await run(['brands', 'capture', `${data.origin}/missing`, '--json']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /HTTP 404/);
  assert.doesNotMatch(result.stderr, /unsupported brand content encoding/);
  assertIdentity(data, ['/missing']);
});

test('an encoded icon does not prevent a later usable candidate from succeeding', { timeout: 20000 }, async (t) => {
  const data = await fixture(t, (request, response) => {
    if (request.url === '/page') send(response, '<head><link rel="icon" href="/compressed.png"><link rel="icon" href="/usable.png"></head>', 'text/html');
    else if (request.url === '/compressed.png') send(response, gzipSync(icon), 'image/png', 'gzip');
    else if (request.url === '/usable.png') send(response, icon, 'image/png');
    else { response.writeHead(404); response.end(); }
  });
  await capture(`${data.origin}/page`);
  assertIdentity(data, ['/page', '/compressed.png', '/usable.png']);
});

for (const encoding of [undefined, 'IdEnTiTy']) {
  test(`capture accepts ${encoding || 'absent'} content encoding`, { timeout: 20000 }, async (t) => {
    const data = await fixture(t, (_request, response) => send(response, icon, 'image/png', encoding));
    await capture(`${data.origin}/mark.png`);
  });
}

test('digest-pinned validation and rendering inherit identity negotiation', { timeout: 45000 }, async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-brand-encoding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const data = await fixture(t, (request, response) => {
    negotiated(request, response, request.url === '/page' ? page : icon,
      request.url === '/page' ? 'text/html' : 'image/png', 'br');
  });
  const brand = await capture(`${data.origin}/page`);
  assertIdentity(data, ['/page', '/icon']);
  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  diagram.components[0].brand = brand;
  const input = path.join(root, 'diagram.json');
  const output = path.join(root, 'diagram.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  for (const command of ['validate', 'render']) {
    data.requests.length = 0;
    const result = await run([command, 'architecture', input, ...(command === 'render' ? [output] : ['--json'])]);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assertIdentity(data, ['/page', '/icon']);
  }
  const html = fs.readFileSync(output, 'utf8');
  assert.ok(html.includes(`data-brand-sha256="${digest}"`));
  assert.ok(html.includes(`data:image/png;base64,${icon.toString('base64')}`));
});
