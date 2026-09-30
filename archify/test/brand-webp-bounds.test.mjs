import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Pillow-encoded 2x2 images, independently decoded (including both animation frames).
// The runtime and these tests need no image codec dependency.
const valid = [
  ['alpha-extended', Buffer.from('UklGRlwAAABXRUJQVlA4WAoAAAAQAAAAAQAAAQAAQUxQSAUAAAAAgICAgABWUDggMAAAANABAJ0BKgIAAgABQCYloAJ0ugH4AAOwAP7y63/82BXNc+/3/9Lg/S4P0uD/0pAAAA==', 'base64')],
  ['animated', Buffer.from('UklGRoQAAABXRUJQVlA4WAoAAAASAAAAAQAAAQAAQU5JTQYAAAAAAAAAAABBTk1GKAAAAAAAAAAAAAEAAAEAAGQAAAJWUDhMDwAAAC8BQAAQBxD9jwIGIqL/AQBBTk1GKAAAAAAAAAAAAAEAAAEAAGQAAAJWUDhMDwAAAC8BQAAQBxDR/yIHIqL/AQA=', 'base64')],
  ['lossless', Buffer.from('UklGRhwAAABXRUJQVlA4TA8AAAAvAUAAEAcQ/Y8CBiKi/wEA', 'base64')],
  ['lossy', Buffer.from('UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAIAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=', 'base64')],
];
function chunk(fourcc, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(8);
  header.write(fourcc);
  header.writeUInt32LE(payload.length, 4);
  return Buffer.concat([header, payload, Buffer.alloc(payload.length % 2)]);
}
function riff(...chunks) {
  const payload = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write('RIFF');
  header.writeUInt32LE(payload.length + 4, 4);
  header.write('WEBP', 8);
  return Buffer.concat([header, payload]);
}
const lossless = valid.find(([name]) => name === 'lossless')[1];
const imageChunk = lossless.subarray(12);
const extended = Buffer.alloc(10);
const animation = Buffer.alloc(10); animation[0] = 2;
const frame = (payload) => chunk('ANMF', Buffer.concat([Buffer.alloc(16), payload]));
const animated = (...frames) => riff(chunk('VP8X', animation), chunk('ANIM', Buffer.alloc(6)), ...frames);
const hugeChunk = Buffer.alloc(8); hugeChunk.write('VP8 '); hugeChunk.writeUInt32LE(0xffffffff, 4);
const truncated = Buffer.alloc(8); truncated.write('VP8 '); truncated.writeUInt32LE(100, 4);
const missingPadding = chunk('JUNK', Buffer.from([1])).subarray(0, 9);
const highBit = (bytes, offset) => {
  const changed = Buffer.from(bytes); changed[offset] |= 0x80; return changed;
};
const invalid = [
  ['incomplete chunk header', riff(Buffer.from('VP8 '))],
  ['high-bit RIFF header', highBit(lossless, 0)],
  ['high-bit WEBP header', highBit(lossless, 8)],
  ['high-bit bitstream FourCC is not image data', riff(highBit(imageChunk, 0))],
  ['high-bit frame bitstream FourCC is not image data', animated(frame(highBit(imageChunk, 0)))],
  ['empty VP8 image', riff(chunk('VP8 '))],
  ['empty VP8L image', riff(chunk('VP8L'))],
  ['chunk past RIFF boundary', riff(truncated)],
  ['maximum uint32 chunk size', riff(hugeChunk)],
  ['metadata without image', riff(chunk('EXIF', Buffer.from('abc')))],
  ['VP8X without image', riff(chunk('VP8X', extended))],
  ['animation frame without image', animated(frame(Buffer.alloc(0)))],
  ['short animation frame header', animated(chunk('ANMF', Buffer.alloc(15)))],
  ['animation subchunk out of bounds', animated(frame(truncated))],
  ['empty animation bitstream', animated(frame(chunk('VP8L')))],
  ['nested frames cannot supply a frame bitstream', animated(frame(frame(imageChunk)))],
  ['later malformed frame', animated(frame(imageChunk), frame(truncated))],
  ['later incomplete chunk', riff(imageChunk, Buffer.from('JUNK'))],
  ['missing odd payload padding', riff(imageChunk, missingPadding)],
  ['frame missing odd payload padding', animated(frame(Buffer.concat([imageChunk, missingPadding])))],
  ['trailing bytes cannot supply declared image data', Buffer.concat([riff(truncated), Buffer.alloc(100)])],
];
const controls = [...valid,
  ['high-bit unknown chunk beside real image data', riff(imageChunk, highBit(chunk('VP8L'), 0))],
  ['unknown and empty chunks', riff(chunk('VP8X', extended), imageChunk, chunk('JUNK', Buffer.from('odd')), chunk('ZERO'))],
  ['unknown frame subchunks', animated(frame(Buffer.concat([imageChunk, chunk('JUNK', Buffer.from('odd')), chunk('ZERO')])))],
  ['trailing bytes outside RIFF', Buffer.concat([lossless, Buffer.from('permitted trailing bytes')])],
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
const resource = (bytes, type = 'image/webp') => ({ bytes, type });
async function capture(url, bytes) {
  const result = await run(['brands', 'capture', url, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.deepEqual(receipt.brand, { url, sha256: digest(bytes) });
  assert.equal(receipt.evidence.sha256, digest(bytes));
}
for (const [name, bytes] of invalid) {
  test(`WebP capture rejects ${name}`, { timeout: 20000 }, async (t) => {
    const data = await fixture(t, { '/image': resource(bytes) });
    const result = await run(['brands', 'capture', `${data.origin}/image`, '--json']);
    assert.notEqual(result.status, 0, 'must reject incomplete image containers');
    assert.match(result.stderr, /brand asset bytes do not match image\/webp/);
    assert.deepEqual(data.requests, ['/image']);
  });
}
for (const [name, bytes] of controls) {
  test(`WebP capture preserves ${name}`, { timeout: 20000 }, async (t) => {
    const data = await fixture(t, { '/image': resource(bytes) });
    await capture(`${data.origin}/image`, bytes);
  });
}
for (const laterValid of [true, false]) {
  test(`WebP discovery ${laterValid ? 'uses a later valid icon' : 'rejects all malformed icons'}`, { timeout: 20000 }, async (t) => {
    const data = await fixture(t, {
      '/page': resource('<head><link rel="icon" href="/bad"><link rel="icon" href="/next"></head>', 'text/html'),
      '/bad': resource(invalid[0][1]), '/next': resource(laterValid ? lossless : invalid[1][1]),
      '/favicon.ico': resource(invalid[2][1]),
    });
    if (laterValid) await capture(`${data.origin}/page`, lossless);
    else {
      const result = await run(['brands', 'capture', `${data.origin}/page`, '--json']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /brand asset bytes do not match image\/webp/);
    }
    assert.deepEqual(data.requests, laterValid ? ['/page', '/bad', '/next'] : ['/page', '/bad', '/next', '/favicon.ico']);
  });
}
for (const healthy of [false, true]) {
  test(`pinned WebP ${healthy ? 'retains full original bytes including trailing data' : 'rejects a matching digest of malformed bytes'}`, { timeout: 45000 }, async (t) => {
    const bytes = healthy ? controls.at(-1)[1] : invalid[0][1];
    const data = await fixture(t, { '/image': resource(bytes) });
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-webp-bounds-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const input = path.join(root, 'input.json'), output = path.join(root, 'output.html');
    const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
    diagram.components[0].brand = { url: `${data.origin}/image`, sha256: digest(bytes) };
    fs.writeFileSync(input, JSON.stringify(diagram));
    const previous = Buffer.from('previous trusted artifact'); fs.writeFileSync(output, previous);
    for (const command of ['validate', 'render']) {
      const result = await run([command, 'architecture', input, ...(command === 'render' ? [output] : ['--json'])]);
      if (healthy) assert.equal(result.status, 0, result.stderr || result.stdout);
      else {
        assert.notEqual(result.status, 0);
        assert.match(result.stdout + result.stderr, /brand asset bytes do not match image\/webp/);
        assert.doesNotMatch(result.stdout + result.stderr, /digest-mismatch/);
        assert.deepEqual(fs.readFileSync(output), previous);
      }
    }
    if (healthy) {
      const html = fs.readFileSync(output, 'utf8');
      assert.ok(html.includes(`data-brand-sha256="${digest(bytes)}"`));
      assert.ok(html.includes(`data:image/webp;base64,${bytes.toString('base64')}`));
    }
  });
}
