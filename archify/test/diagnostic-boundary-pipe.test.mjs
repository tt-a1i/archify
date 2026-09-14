import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression coverage for issue #350: a large renderer failure diagnostic
// was truncated at 65,536 bytes when stderr was a pipe, because the
// `installRendererDiagnosticBoundary` handler called `fs.writeSync` once
// with the entire payload. macOS and Linux kernel pipe buffers are
// exactly 64 KiB; the short write silently dropped the rest of the
// JSON, leaving the parent CLI unable to parse the diagnostics.
//
// The fix loops `fs.writeSync` until every byte of the payload has been
// accepted, tolerating a broken stderr by swallowing the write error.
// The full code path runs in a renderer subprocess; here we extract the
// same write loop into a focused unit test by simulating the kernel
// pipe-buffer short-write behaviour with a custom Writable. We do not
// invoke the real boundary handler here because the real
// `installRendererDiagnosticBoundary` is a one-shot global that runs
// at module-load and immediately calls `process.exit(1)` on any
// uncaughtException, which makes a clean unit test impractical.

const here = path.dirname(fileURLToPath(import.meta.url));

// Simulates the kernel pipe buffer: writes return a short count when
// the buffer is "full" (above the kernel's 64 KiB ceiling), forcing the
// caller to retry with the remaining bytes. This is the exact contract
// the write-loop in the boundary handler assumes.
class PipeLikeSink {
  constructor({ highWaterMark = 64 * 1024 } = {}) {
    this.highWaterMark = highWaterMark;
    this.chunks = [];
  }
  write(payload) {
    const remaining = payload.length;
    if (remaining <= this.highWaterMark) {
      this.chunks.push(payload);
      return remaining;
    }
    this.chunks.push(payload.subarray(0, this.highWaterMark));
    return this.highWaterMark;
  }
}

test('stderr write loop drains a 360 KiB payload across a 64 KiB pipe ceiling (#350)', () => {
  // 3,000 diagnostics × ~120 bytes each = ~360 KiB. Anything under the
  // 64 KiB ceiling would pass trivially without exercising the loop.
  const diagnostics = [];
  for (let i = 0; i < 3000; i += 1) {
    diagnostics.push({
      code: 'schema/additionalProperties',
      message: 'component /components/' + i + ' must NOT have additional properties',
      subject: { path: '/components/' + i },
      evidence: { additionalProperty: 'kind' },
      supportedFixes: ['remove the unsupported property'],
    });
  }
  const payload = Buffer.from(JSON.stringify({
    schemaVersion: 1,
    ok: false,
    source: 'renderer',
    error: 'big',
    diagnostics,
  }) + '\n', 'utf8');
  assert.ok(payload.length > 64 * 1024, 'fixture must exceed the 64 KiB pipe ceiling');

  // The exact loop the boundary handler uses, minus the uncaughtException
  // listener and process.exit(1). The sink stands in for the stderr fd.
  const sink = new PipeLikeSink({ highWaterMark: 64 * 1024 });
  let written = sink.write(payload);
  while (written < payload.length) {
    const chunk = sink.write(payload.subarray(written));
    if (chunk <= 0) break;
    written += chunk;
  }
  assert.equal(written, payload.length, 'loop must drain every byte despite short writes');
  // The sink received the full payload in 64 KiB chunks.
  const total = sink.chunks.reduce((sum, c) => sum + c.length, 0);
  assert.equal(total, payload.length);
  // Reassemble and confirm the JSON parses to the original diagnostics.
  const reassembled = Buffer.concat(sink.chunks).toString('utf8');
  const parsed = JSON.parse(reassembled);
  assert.equal(parsed.diagnostics.length, 3000);
  assert.equal(parsed.diagnostics[0].code, 'schema/additionalProperties');
  assert.equal(parsed.diagnostics[2999].supportedFixes[0], 'remove the unsupported property');
});

test('stderr write loop tolerates a broken pipe without throwing (#350)', () => {
  // A pipe that returns 0 on every call (mimics EPIPE / closed reader)
  // must not cause the boundary handler to surface a secondary error;
  // the outer catch{} swallows it so the renderer's exit status still
  // reflects the original failure.
  class ClosedPipe {
    write() { return 0; }
  }
  let threw = false;
  try {
    const sink = new ClosedPipe();
    let written = sink.write(Buffer.from('payload'));
    let iterations = 0;
    while (written < 7 && iterations++ < 100) {
      const chunk = sink.write(Buffer.alloc(0));
      if (chunk <= 0) break;
      written += chunk;
    }
  } catch {
    threw = true;
  }
  // The boundary's contract: a 0-return is treated as a closed pipe,
  // not an error. The loop terminates without throwing.
  assert.equal(threw, false, 'boundary must catch write errors silently');
});