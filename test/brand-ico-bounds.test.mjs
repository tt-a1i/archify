import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
// BITMAPINFOHEADER, one opaque red BGRA pixel, and a DWORD-aligned AND mask.
const dib = Buffer.alloc(48);
dib.writeUInt32LE(40, 0);
dib.writeInt32LE(1, 4);
dib.writeInt32LE(2, 8); // ICO DIB height includes the XOR and AND planes.
dib.writeUInt16LE(1, 12);
dib.writeUInt16LE(32, 14);
dib.writeUInt32LE(8, 20);
dib[42] = 255;
dib[43] = 255;

function ico(payloads, order = payloads.map((_, index) => index)) {
  const directory = Buffer.alloc(6 + 16 * order.length);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(order.length, 4);
  const offsets = payloads.map((_, index) => directory.length
    + payloads.slice(0, index).reduce((sum, value) => sum + value.length, 0));
  order.forEach((payload, index) => {
    const entry = 6 + index * 16;
    directory[entry] = 1;
    directory[entry + 1] = 1;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(payloads[payload].length, entry + 8);
    directory.writeUInt32LE(offsets[payload], entry + 12);
  });
  return Buffer.concat([directory, ...payloads]);
}
function entry(value, { index = 0, size, offset }) {
  const bytes = Buffer.from(value);
  if (size !== undefined) bytes.writeUInt32LE(size, 6 + index * 16 + 8);
  if (offset !== undefined) bytes.writeUInt32LE(offset, 6 + index * 16 + 12);
  return bytes;
}
const valid = ico([png]);
const invalid = [
  ['zero image length', entry(valid, { size: 0 })],
  ['offset inside header', entry(valid, { offset: 0 })],
  ['offset inside directory', entry(valid, { offset: 21 })],
  ['image ends one byte beyond EOF', entry(valid, { size: png.length + 1 })],
  ['missing image bytes', valid.subarray(0, 22)],
  ['maximum uint32 offset', entry(valid, { offset: 0xffffffff })],
  ['maximum uint32 size', entry(valid, { size: 0xffffffff })],
  ['truncated directory', ico([png, dib]).subarray(0, 37)],
  ['later image entry out of bounds', entry(ico([png, dib]), { index: 1, size: dib.length + 1 })],
];

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: skillRoot, stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000,
      env: { ...process.env, ARCHIFY_BRAND_ALLOW_PRIVATE: '1' },
    });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', (status) => resolve({ status, stdout, stderr }));
  });
}
async function fixture(t, routes) {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push(request.url);
    const resource = routes[request.url];
    response.writeHead(resource ? 200 : 404, { 'content-type': resource?.type || 'text/plain' });
    response.end(resource?.bytes || 'missing');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }));
  return { origin: `http://127.0.0.1:${server.address().port}`, requests };
}
const resource = (bytes, type = 'image/x-icon') => ({ bytes, type });
async function successfulCapture(url, bytes) {
  const result = await run(['brands', 'capture', url, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.deepEqual(receipt.brand, { url, sha256: sha256(bytes) });
  assert.equal(receipt.evidence.sha256, sha256(bytes));
  return receipt.brand;
}

for (const [name, bytes] of invalid) {
  test(`ICO capture rejects ${name}`, { timeout: 20000 }, async (t) => {
    const data = await fixture(t, { '/icon.ico': resource(bytes) });
    const result = await run(['brands', 'capture', `${data.origin}/icon.ico`, '--json']);
    assert.notEqual(result.status, 0, 'must not pin a directory with an invalid image range');
    assert.match(result.stderr, /brand asset bytes do not match image\/x-icon/);
    assert.deepEqual(data.requests, ['/icon.ico']);
  });
}

for (const type of ['image/x-icon', 'image/vnd.microsoft.icon']) {
  for (const [format, bytes] of [['PNG', valid], ['DIB', ico([dib])]]) {
    test(`ICO capture retains ${format} bytes served as ${type}`, { timeout: 20000 }, async (t) => {
      const data = await fixture(t, { '/icon.ico': resource(bytes, type) });
      await successfulCapture(`${data.origin}/icon.ico`, bytes);
    });
  }
}
for (const [name, bytes] of [
  ['multiple images out of directory order', ico([png, dib], [1, 0])],
  ['multiple entries sharing image data', ico([png], [0, 0])],
  ['trailing byte after image data', Buffer.concat([valid, Buffer.from([0])])],
]) {
  test(`ICO capture accepts ${name}`, { timeout: 20000 }, async (t) => {
    const data = await fixture(t, { '/icon.ico': resource(bytes) });
    await successfulCapture(`${data.origin}/icon.ico`, bytes);
  });
}

for (const laterValid of [true, false]) {
  test(`HTML icon discovery ${laterValid ? 'continues to a valid candidate' : 'rejects all malformed candidates'}`, { timeout: 20000 }, async (t) => {
    const page = '<head><link rel="icon" href="/bad.ico"><link rel="icon" href="/next.ico"></head>';
    const data = await fixture(t, {
      '/page': resource(page, 'text/html'), '/bad.ico': resource(invalid[0][1]),
      '/next.ico': resource(laterValid ? valid : invalid[4][1]),
      '/favicon.ico': resource(invalid[1][1]),
    });
    if (laterValid) await successfulCapture(`${data.origin}/page`, valid);
    else {
      const result = await run(['brands', 'capture', `${data.origin}/page`, '--json']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /brand asset bytes do not match/);
    }
    assert.deepEqual(data.requests, laterValid ? ['/page', '/bad.ico', '/next.ico']
      : ['/page', '/bad.ico', '/next.ico', '/favicon.ico']);
  });
}

for (const healthy of [false, true]) {
  test(`digest-pinned validation and rendering ${healthy ? 'preserve valid ICO bytes' : 'reject malformed ICO even with a matching digest'}`, { timeout: 45000 }, async (t) => {
    const bytes = healthy ? valid : invalid[4][1];
    const data = await fixture(t, { '/icon.ico': resource(bytes) });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ico-pin-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const input = path.join(root, 'input.json'), output = path.join(root, 'output.html');
    const document = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
    // Author the known digest directly: rejection must validate bytes, not rely on prior capture.
    document.components[0].brand = { url: `${data.origin}/icon.ico`, sha256: sha256(bytes) };
    fs.writeFileSync(input, JSON.stringify(document));
    const previous = Buffer.from('previous trusted artifact');
    fs.writeFileSync(output, previous);
    for (const command of ['validate', 'render']) {
      data.requests.length = 0;
      const result = await run([command, 'architecture', input, ...(command === 'render' ? [output] : ['--json'])]);
      assert.deepEqual(data.requests, ['/icon.ico']);
      if (healthy) assert.equal(result.status, 0, result.stderr || result.stdout);
      else {
        assert.notEqual(result.status, 0);
        assert.match(result.stdout + result.stderr, /brand asset bytes do not match/);
        assert.doesNotMatch(result.stdout + result.stderr, /digest-mismatch/);
        assert.deepEqual(fs.readFileSync(output), previous);
      }
    }
    if (healthy) {
      const html = fs.readFileSync(output, 'utf8');
      assert.ok(html.includes(`data-brand-sha256="${sha256(bytes)}"`));
      assert.ok(html.includes(`data:image/x-icon;base64,${bytes.toString('base64')}`));
    }
  });
}
