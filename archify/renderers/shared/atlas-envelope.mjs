import crypto from 'node:crypto';
import fs from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';

import { serializeScriptJson } from './utils.mjs';

const ENVELOPE_VERSION = 1;
const CODEC = 'gzip-base64';
const CHUNK_CHARACTERS = 7600;
const ENVELOPE_KEYS = ['envelope_version', 'codec', 'uncompressed_bytes', 'payload_sha256', 'chunks'];
const fallbackPath = new URL('../../assets/vendor/fflate-gunzip-0.8.2.min.js', import.meta.url);
const fallbackLicensePath = new URL('../../assets/vendor/fflate-MIT.txt', import.meta.url);

function envelopeError(message, path = '') {
  const error = new Error(message);
  error.atlasBundleCode = 'bundle-data';
  error.atlasBundleEvidence = { path };
  throw error;
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function splitBase64(value) {
  const chunks = [];
  for (let offset = 0; offset < value.length; offset += CHUNK_CHARACTERS) {
    chunks.push(value.slice(offset, offset + CHUNK_CHARACTERS));
  }
  return chunks;
}

function parseEnvelopeSource(source) {
  let value;
  try { value = JSON.parse(source); }
  catch (error) {
    error.atlasBundleCode = 'bundle-data';
    error.atlasBundleEvidence = { path: 'archify-atlas-data', parseError: error.message };
    throw error;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'envelope_version')) {
    return { payload: value, source, envelope: null };
  }
  if (Object.keys(value).length !== ENVELOPE_KEYS.length || ENVELOPE_KEYS.some(key => !Object.hasOwn(value, key))) {
    envelopeError('Atlas compression envelope fields are invalid.', 'envelope');
  }
  if (value.envelope_version !== ENVELOPE_VERSION) {
    envelopeError('Unsupported Atlas compression envelope version.', 'envelope_version');
  }
  if (value.codec !== CODEC) envelopeError('Unsupported Atlas compression codec.', 'codec');
  if (!Number.isSafeInteger(value.uncompressed_bytes) || value.uncompressed_bytes <= 0) {
    envelopeError('Atlas compression envelope byte length is invalid.', 'uncompressed_bytes');
  }
  if (!/^[a-f0-9]{64}$/.test(value.payload_sha256 || '')) {
    envelopeError('Atlas compression envelope digest is invalid.', 'payload_sha256');
  }
  if (!Array.isArray(value.chunks) || !value.chunks.length || value.chunks.some(chunk =>
    typeof chunk !== 'string' || !chunk.length || chunk.length > CHUNK_CHARACTERS)) {
    envelopeError('Atlas compression envelope chunks are invalid.', 'chunks');
  }
  const encoded = value.chunks.join('');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    envelopeError('Atlas compression envelope Base64 is invalid.', 'chunks');
  }
  const compressed = Buffer.from(encoded, 'base64');
  if (compressed.toString('base64') !== encoded) {
    envelopeError('Atlas compression envelope Base64 is not canonical.', 'chunks');
  }
  return { envelope: value, compressed };
}

export function serializeAtlasPayload(payload, { compressed = true } = {}) {
  const source = serializeScriptJson(payload, 2);
  if (!compressed) return source;
  const bytes = Buffer.from(source, 'utf8');
  const encoded = gzipSync(bytes, { level: 9, mtime: 0 }).toString('base64');
  return serializeScriptJson({
    envelope_version: ENVELOPE_VERSION,
    codec: CODEC,
    uncompressed_bytes: bytes.length,
    payload_sha256: sha256(bytes),
    chunks: splitBase64(encoded),
  }, 2);
}

export function decodeAtlasPayload(source) {
  const parsed = parseEnvelopeSource(source);
  if (!parsed.envelope) return parsed;
  let bytes;
  try { bytes = gunzipSync(parsed.compressed); }
  catch (error) {
    envelopeError(`Atlas gzip payload is invalid: ${error.message}`, 'chunks');
  }
  if (bytes.length !== parsed.envelope.uncompressed_bytes) {
    envelopeError('Atlas payload length differs from its compression envelope.', 'uncompressed_bytes');
  }
  if (sha256(bytes) !== parsed.envelope.payload_sha256) {
    envelopeError('Atlas payload digest differs from its compression envelope.', 'payload_sha256');
  }
  let payload;
  const decoded = bytes.toString('utf8');
  try { payload = JSON.parse(decoded); }
  catch (error) {
    error.atlasBundleCode = 'bundle-data';
    error.atlasBundleEvidence = { path: 'payload', parseError: error.message };
    throw error;
  }
  return { payload, source: decoded, envelope: parsed.envelope };
}

// This function is embedded verbatim in Atlas HTML. Keep every helper local and
// every dependency passed as an argument so Node and browser fixtures exercise
// the same implementation that a delivered artifact runs.
export async function decodeAtlasPayloadBrowser(source, fallbackGunzip) {
  const fail = message => { throw new Error(message); };
  const sha256Fallback = input => {
    const constants = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const state = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(input); padded[input.length] = 0x80;
    const lengthView = new DataView(padded.buffer);
    const bitLength = input.length * 8;
    lengthView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
    lengthView.setUint32(paddedLength - 4, bitLength >>> 0);
    const words = new Uint32Array(64);
    const rotate = (value, bits) => value >>> bits | value << 32 - bits;
    for (let offset = 0; offset < paddedLength; offset += 64) {
      for (let index = 0; index < 16; index++) words[index] = lengthView.getUint32(offset + index * 4);
      for (let index = 16; index < 64; index++) {
        const x = words[index - 15], y = words[index - 2];
        const a = rotate(x, 7) ^ rotate(x, 18) ^ x >>> 3;
        const b = rotate(y, 17) ^ rotate(y, 19) ^ y >>> 10;
        words[index] = (words[index - 16] + a + words[index - 7] + b) >>> 0;
      }
      let [a, b, c, d, e, f, g, h] = state;
      for (let index = 0; index < 64; index++) {
        const sigma1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
        const choose = e & f ^ ~e & g;
        const first = (h + sigma1 + choose + constants[index] + words[index]) >>> 0;
        const sigma0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
        const majority = a & b ^ a & c ^ b & c;
        const second = (sigma0 + majority) >>> 0;
        h = g; g = f; f = e; e = (d + first) >>> 0;
        d = c; c = b; b = a; a = (first + second) >>> 0;
      }
      for (const [index, value] of [a, b, c, d, e, f, g, h].entries()) state[index] = (state[index] + value) >>> 0;
    }
    const digest = new Uint8Array(32);
    const view = new DataView(digest.buffer);
    state.forEach((value, index) => view.setUint32(index * 4, value));
    return digest;
  };
  let value;
  try { value = JSON.parse(source); }
  catch (error) { fail(`Atlas payload is not valid JSON: ${error.message}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'envelope_version')) {
    return { payload: value, source, envelope: null, decoder: 'raw' };
  }
  const keys = ['envelope_version', 'codec', 'uncompressed_bytes', 'payload_sha256', 'chunks'];
  if (Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) {
    fail('Atlas compression envelope fields are invalid.');
  }
  if (value.envelope_version !== 1) fail('Unsupported Atlas compression envelope version.');
  if (value.codec !== 'gzip-base64') fail('Unsupported Atlas compression codec.');
  if (!Number.isSafeInteger(value.uncompressed_bytes) || value.uncompressed_bytes <= 0) {
    fail('Atlas compression envelope byte length is invalid.');
  }
  if (!/^[a-f0-9]{64}$/.test(value.payload_sha256 || '')) fail('Atlas compression envelope digest is invalid.');
  if (!Array.isArray(value.chunks) || !value.chunks.length || value.chunks.some(chunk =>
    typeof chunk !== 'string' || !chunk.length || chunk.length > 7600)) {
    fail('Atlas compression envelope chunks are invalid.');
  }
  const encoded = value.chunks.join('');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    fail('Atlas compression envelope Base64 is invalid.');
  }
  let binary;
  try { binary = atob(encoded); }
  catch (error) { fail(`Atlas compression envelope Base64 is invalid: ${error.message}`); }
  const compressed = Uint8Array.from(binary, character => character.charCodeAt(0));
  let bytes;
  let decoder;
  if (typeof DecompressionStream === 'function') {
    try {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
      decoder = 'native';
    } catch (error) { fail(`Atlas gzip payload is invalid: ${error.message}`); }
  } else {
    if (typeof fallbackGunzip !== 'function') fail('This browser cannot decompress the Atlas payload.');
    try { bytes = new Uint8Array(fallbackGunzip(compressed)); decoder = 'fallback'; }
    catch (error) { fail(`Atlas gzip payload is invalid: ${error.message}`); }
    if (compressed.length < 18 || compressed[0] !== 31 || compressed[1] !== 139 || compressed[2] !== 8) {
      fail('Atlas gzip payload header is invalid.');
    }
    const footer = compressed.length - 8;
    const uint32 = offset => (compressed[offset] | compressed[offset + 1] << 8 |
      compressed[offset + 2] << 16 | compressed[offset + 3] << 24) >>> 0;
    if ((bytes.length >>> 0) !== uint32(footer + 4)) fail('Atlas gzip payload length checksum differs.');
    let checksum = 0xFFFFFFFF;
    for (const byte of bytes) {
      checksum ^= byte;
      for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xEDB88320 : 0);
    }
    if (((checksum ^ 0xFFFFFFFF) >>> 0) !== uint32(footer)) fail('Atlas gzip payload checksum differs.');
  }
  if (bytes.length !== value.uncompressed_bytes) {
    fail('Atlas payload length differs from its compression envelope.');
  }
  const digest = globalThis.crypto?.subtle
    ? new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
    : sha256Fallback(bytes);
  const actual = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
  if (actual !== value.payload_sha256) fail('Atlas payload digest differs from its compression envelope.');
  let decoded;
  try { decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (error) { fail(`Atlas payload is not valid UTF-8: ${error.message}`); }
  try { return { payload: JSON.parse(decoded), source: decoded, envelope: value, decoder }; }
  catch (error) { fail(`Atlas payload is not valid JSON: ${error.message}`); }
}

export function readAtlasGzipFallbackSource() {
  const license = fs.readFileSync(fallbackLicensePath, 'utf8').trimEnd();
  const source = fs.readFileSync(fallbackPath, 'utf8').trim();
  return `/* fflate 0.8.2\n${license}\n*/\n${source}`;
}
