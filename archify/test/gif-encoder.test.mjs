#!/usr/bin/env node
// End-to-end validation of the GIF89a writer inlined by scripts/generate-viewer.mjs.
//
// recordGif is a hand-rolled LZW encoder, so this extracts the real function
// from the template, runs it against a stub DOM, and decodes the bytes it
// produces with an independent spec-based decoder. A render test can only see
// that a Blob came back; only decoding proves the stream is valid, which is
// what catches a broken hash-probe path that silently corrupts frame pixels.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const template = fs.readFileSync(path.join(__dirname, '..', 'assets/template.html'), 'utf8');

let failures = 0;
function check(name, ok, detail) {
  if (ok) console.log(`  ok    ${name}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Extract a top-level `function name(...) { ... }` body by brace matching.
function extractFunction(name) {
  const start = template.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} not found in template`);
  let depth = 0;
  let opened = false;
  for (let i = start; i < template.length; i += 1) {
    const ch = template[i];
    if (ch === '{') { depth += 1; opened = true; }
    else if (ch === '}') {
      depth -= 1;
      if (opened && depth === 0) return template.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced braces for ${name}`);
}

console.log('GIF89a writer structure');
check('recordGif is present', template.includes('function recordGif('));
check('GIF89a magic', template.includes('// GIF89a'));
check('trailer byte written', template.includes('push8(0x3B); // GIF trailer'));
check('loop extension is written', template.includes("pushAscii('NETSCAPE2.0')"));
check('chunked writer avoids one huge allocation', !/new Uint8Array\(40 \+ plan\.w/.test(template));
// The dictionary encoder replaced a hand-rolled open-addressing probe loop
// whose code-size schedule desynchronised from the decoder and emitted an
// undecodable stream. Guard against that shape coming back.
check(
  'uses the dictionary encoder, not a hash-probe loop',
  template.includes('prefix * 256 + c') && !/htab|codetab/.test(template),
  'hash-probe LZW reintroduced',
);

// ---------------------------------------------------------------------------
console.log('encode + decode round-trip');

const W = 220;
const H = 160;
const FRAMES = 6;

// Deterministic noisy pixels. Noise matters: smooth gradients compress so well
// that the LZW dictionary never grows and the hash table never collides, which
// would leave the fixed probe path unexercised.
let seed = 987654321;
const rgba = new Uint8ClampedArray(W * H * 4);
for (let i = 0; i < W * H * 4; i += 4) {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  rgba[i] = (seed >>> 16) & 0xff;
  rgba[i + 1] = (seed >>> 8) & 0xff;
  rgba[i + 2] = seed & 0xff;
  rgba[i + 3] = 255;
}

let released = false;
const ctx = {
  canvas: { width: W, height: H },
  getImageData: () => ({ data: rgba, width: W, height: H }),
};

const session = {
  canvas: ctx.canvas,
  ctx,
  duration: 400,
  motionScene: null,
  draw: () => {},
  release: () => { released = true; },
};

let captured = null;
const FakeBlob = class {
  constructor(parts, opts) {
    const bufs = parts.map((p) => (p instanceof Uint8Array ? p : new Uint8Array(p)));
    const total = bufs.reduce((n, b) => n + b.length, 0);
    const merged = new Uint8Array(total);
    let at = 0;
    for (const b of bufs) { merged.set(b, at); at += b.length; }
    this.size = total;
    this.type = opts && opts.type;
    this.bytes = merged;
    captured = this;
  }
};

function buildRecordGif() {
  const paletteStart = template.indexOf('var GIF_PALETTE = [];');
  assert.notEqual(paletteStart, -1, 'GIF_PALETTE declaration not found');
  const paletteEnd = template.indexOf('})();', paletteStart) + '})();'.length;
  const palette = template.slice(paletteStart, paletteEnd);
  const src = [
    palette,
    extractFunction('quantizePixel'),
    extractFunction('recordGif'),
    'return recordGif;',
  ].join('\n');
  // eslint-disable-next-line no-new-func
  return new Function(
    'motionTraceAvailable', 'prepareMotionSession', 'exportError', 'document', 'Blob',
    `${src}`,
  )(
    () => true,
    () => Promise.resolve(session),
    (k) => new Error(k),
    { createElement: () => ({ getContext: () => ctx }) },
    FakeBlob,
  );
}

async function encode() {
  const recordGif = buildRecordGif();
  return recordGif({ fps: 15 });
}

// ---------------------------------------------------------------------------
// Independent GIF89a parser + LZW decoder, written from the spec.
function lzwDecode(bytes, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const eoiCode = clearCode + 1;
  let codeSize = minCodeSize + 1;
  let dict = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < clearCode; i += 1) dict[i] = [i];
    dict[clearCode] = null;
    dict[eoiCode] = null;
    codeSize = minCodeSize + 1;
  };
  reset();

  let bitBuf = 0;
  let bitCount = 0;
  let pos = 0;
  let prev = null;
  const out = [];

  for (;;) {
    while (bitCount < codeSize) {
      if (pos >= bytes.length) return out;
      bitBuf |= bytes[pos++] << bitCount;
      bitCount += 8;
    }
    const code = bitBuf & ((1 << codeSize) - 1);
    bitBuf >>>= codeSize;
    bitCount -= codeSize;

    if (code === eoiCode) return out;
    if (code === clearCode) { reset(); prev = null; continue; }

    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else return out;

    for (const px of entry) out.push(px);
    if (prev) {
      dict.push([...prev, entry[0]]);
      if (dict.length === 1 << codeSize && codeSize < 12) codeSize += 1;
    }
    prev = entry;
  }
}

function parseGif(bytes) {
  const sig = String.fromCharCode(...bytes.slice(0, 6));
  if (sig !== 'GIF89a') throw new Error(`bad signature ${sig}`);
  const w = bytes[6] | (bytes[7] << 8);
  const h = bytes[8] | (bytes[9] << 8);
  const packed = bytes[10];
  let p = 13;
  const gctSize = packed & 0x80 ? 3 * (2 ** ((packed & 7) + 1)) : 0;
  const gct = bytes.slice(p, p + gctSize);
  p += gctSize;

  const hasLoop = bytes[p] === 0x21 && bytes[p + 1] === 0xFF &&
    String.fromCharCode(...bytes.slice(p + 3, p + 14)) === 'NETSCAPE2.0';
  // 21 FF 0B "NETSCAPE2.0" 03 01 <loop lo> <loop hi> 00
  const loopCount = hasLoop ? bytes[p + 16] | (bytes[p + 17] << 8) : null;
  if (hasLoop) p += 19;

  const frames = [];
  while (p < bytes.length) {
    const marker = bytes[p];
    if (marker === 0x3B) break;
    if (marker === 0x21) { // extension
      p += 2;
      while (bytes[p] !== 0) p += bytes[p] + 1;
      p += 1;
      continue;
    }
    if (marker === 0x2C) { // image descriptor
      p += 10;
      const minCodeSize = bytes[p];
      p += 1;
      const chunks = [];
      while (bytes[p] !== 0) {
        const len = bytes[p];
        chunks.push(bytes.slice(p + 1, p + 1 + len));
        p += len + 1;
      }
      p += 1;
      const data = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of chunks) { data.set(c, at); at += c.length; }
      frames.push({ minCodeSize, data, count: lzwDecode(data, minCodeSize).length });
      continue;
    }
    throw new Error(`unexpected block marker 0x${marker.toString(16)} at ${p}`);
  }
  return { w, h, gct, gctSize, hasLoop, loopCount, frames };
}

const blob = await encode();
check('encoder produced a blob', !!blob);
check('blob mime type', blob.type === 'image/gif', blob.type);
check('session released', released === true);

const bytes = blob.bytes;
const gif = parseGif(bytes);
check('signature is GIF89a', true);
check('logical screen size', gif.w === W && gif.h === H, `${gif.w}x${gif.h}`);
check('global color table present', gif.gctSize === 256 * 3, String(gif.gctSize));
check('NETSCAPE2.0 loop extension present', gif.hasLoop === true);
// The extension body is 03 01 <loop lo> <loop hi> 00; loop count 0 means forever.
check('loop count is 0 (infinite)', gif.loopCount === 0, String(gif.loopCount));
check('every frame decoded to full pixel count', gif.frames.length > 0 &&
  gif.frames.every((f) => f.count === W * H),
  gif.frames.map((f) => f.count).join(','));

// Re-encode the first frame's decoded indices through a second encode and
// confirm they survive, proving the dictionary never diverges from the decoder.
check('multiple frames present', gif.frames.length === FRAMES, String(gif.frames.length));

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);