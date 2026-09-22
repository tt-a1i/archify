import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';

import {
  decodeAtlasPayload,
  decodeAtlasPayloadBrowser,
  readAtlasGzipFallbackSource,
  serializeAtlasPayload,
} from '../renderers/shared/atlas-envelope.mjs';
import { serializeScriptJson } from '../renderers/shared/utils.mjs';

const payload = {
  bundle_version: 2,
  metadata: ['{"bundle_version":1,"entry":"system"}'],
  resources: [['<style>节点 & node { color: red }</style>']],
  documents: {
    system: ['<!doctype html>中文 😀 </script> \\ end', 0, '</html>'],
  },
};

function encoded(value = payload) {
  return serializeAtlasPayload(value);
}

function changedEnvelope(change) {
  const envelope = JSON.parse(encoded());
  change(envelope);
  return serializeScriptJson(envelope, 2);
}

test('Atlas envelope is deterministic, bounded and restores the exact safe v2 payload', () => {
  const first = encoded();
  const second = encoded();
  assert.equal(first, second);
  const envelope = JSON.parse(first);
  assert.deepEqual(Object.keys(envelope), [
    'envelope_version', 'codec', 'uncompressed_bytes', 'payload_sha256', 'chunks',
  ]);
  assert.equal(envelope.envelope_version, 1);
  assert.equal(envelope.codec, 'gzip-base64');
  assert.ok(envelope.chunks.length > 0);
  assert.ok(envelope.chunks.every(chunk => chunk.length <= 7600));
  assert.ok(first.split('\n').every(line => Buffer.byteLength(line) <= 8192));

  const decoded = decodeAtlasPayload(first);
  assert.deepEqual(decoded.payload, payload);
  assert.equal(decoded.source, serializeScriptJson(payload, 2));
  assert.equal(decoded.envelope.envelope_version, 1);
});

test('Atlas decoder retains raw v1 and v2 compatibility', () => {
  for (const value of [{ bundle_version: 1 }, payload]) {
    const source = serializeScriptJson(value, 2);
    assert.deepEqual(decodeAtlasPayload(source), { payload: value, source, envelope: null });
  }
});

test('Atlas envelope rejects malformed and corrupted transport data', () => {
  const cases = [
    ['version', envelope => { envelope.envelope_version = 2; }, /version/i],
    ['codec', envelope => { envelope.codec = 'brotli'; }, /codec/i],
    ['field', envelope => { envelope.uncompressed_bytes = -1; }, /byte/i],
    ['digest-field', envelope => { envelope.payload_sha256 = 'bad'; }, /digest/i],
    ['chunks', envelope => { envelope.chunks = []; }, /chunk/i],
    ['chunk-type', envelope => { envelope.chunks[0] = false; }, /chunk/i],
    ['base64', envelope => { envelope.chunks[0] = `!${envelope.chunks[0].slice(1)}`; }, /base64/i],
    ['gzip', envelope => { envelope.chunks[envelope.chunks.length - 1] = envelope.chunks.at(-1).slice(0, -8); }, /gzip|base64/i],
    ['length', envelope => { envelope.uncompressed_bytes += 1; }, /length/i],
    ['digest', envelope => { envelope.payload_sha256 = '0'.repeat(64); }, /digest/i],
  ];
  for (const [name, mutate, pattern] of cases) {
    assert.throws(() => decodeAtlasPayload(changedEnvelope(mutate)), pattern, name);
  }
});

test('browser decoder restores the same payload through native and fallback paths', async () => {
  const source = encoded();
  const native = await decodeAtlasPayloadBrowser(source, bytes => gunzipSync(bytes));
  assert.deepEqual(native.payload, payload);
  assert.equal(native.source, serializeScriptJson(payload, 2));
  assert.equal(native.decoder, 'native');

  const previous = globalThis.DecompressionStream;
  try {
    globalThis.DecompressionStream = undefined;
    const fallback = await decodeAtlasPayloadBrowser(source, bytes => gunzipSync(bytes));
    assert.deepEqual(fallback.payload, payload);
    assert.equal(fallback.source, serializeScriptJson(payload, 2));
    assert.equal(fallback.decoder, 'fallback');
  } finally {
    globalThis.DecompressionStream = previous;
  }
});

test('browser decoder rejects payload corruption and the checked-in fallback is self-contained', async () => {
  await assert.rejects(
    () => decodeAtlasPayloadBrowser(changedEnvelope(envelope => { envelope.payload_sha256 = '0'.repeat(64); }), bytes => gunzipSync(bytes)),
    /digest/i,
  );
  const fallback = readAtlasGzipFallbackSource();
  assert.match(fallback, /fflate/);
  assert.match(fallback, /MIT License/);
  assert.match(fallback, /ArchifyGzipFallback/);
  assert.doesNotMatch(fallback, /https?:\/\//);
});

test('browser decoder verifies SHA-256 without WebCrypto', async () => {
  const source = serializeAtlasPayload({ bundle_version: 2, unicode: '完整性 ✓' });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
  try {
    const decoded = await decodeAtlasPayloadBrowser(source, bytes => gunzipSync(bytes));
    assert.equal(decoded.payload.unicode, '完整性 ✓');
    const envelope = JSON.parse(source);
    envelope.payload_sha256 = '0'.repeat(64);
    await assert.rejects(
      decodeAtlasPayloadBrowser(JSON.stringify(envelope), bytes => gunzipSync(bytes)),
      /payload digest differs/,
    );
  } finally {
    if (previous) Object.defineProperty(globalThis, 'crypto', previous);
    else delete globalThis.crypto;
  }
});

test('browser fallback validates the gzip footer even when its inflater returns bytes', async () => {
  const envelope = JSON.parse(encoded());
  const compressed = Buffer.from(envelope.chunks.join(''), 'base64');
  compressed[compressed.length - 8] ^= 1;
  envelope.chunks = compressed.toString('base64').match(/.{1,7600}/g);
  const previous = globalThis.DecompressionStream;
  try {
    globalThis.DecompressionStream = undefined;
    await assert.rejects(
      () => decodeAtlasPayloadBrowser(serializeScriptJson(envelope, 2), () => Buffer.from(serializeScriptJson(payload, 2))),
      /checksum/i,
    );
  } finally {
    globalThis.DecompressionStream = previous;
  }
});
