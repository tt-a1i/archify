import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const diagnostics = new URL('../renderers/shared/diagnostics.mjs', import.meta.url).href;

// A pipe holds 8KB on macOS and 64KB on Linux before it blocks. The large case
// stays far above both so the receipt cannot leave the renderer in one write.
const LARGE_DIAGNOSTIC_COUNT = 400;
const SMALL_DIAGNOSTIC_COUNT = 2;
const LARGEST_COMMON_PIPE_BUFFER = 64 * 1024;
const STALLED_READER_MS = 300;

function crashingRenderer(t, count) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-diagnostic-boundary-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const script = path.join(dir, 'crash.mjs');
  fs.writeFileSync(script, [
    `import { installRendererDiagnosticBoundary, throwDiagnosticError } from ${JSON.stringify(diagnostics)};`,
    '',
    'installRendererDiagnosticBoundary();',
    '',
    `const diagnostics = Array.from({ length: ${count} }, (unused, index) => ({`,
    "  code: 'layout/constraint',",
    "  severity: 'error',",
    "  message: 'transition ' + index + ' is too short — ' + 'route it through a channel. '.repeat(12),",
    '  subject: { transition: index },',
    "  evidence: { clearance: index, detail: 'measured segment. '.repeat(8) },",
    "  supportedFixes: ['route it through a channel or drop its label'],",
    '}));',
    '',
    'setImmediate(() => {',
    "  throwDiagnosticError('Lifecycle layout validation failed', diagnostics);",
    '});',
    '',
  ].join('\n'));
  return script;
}

function runCrashingRenderer(script) {
  return spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json' },
    maxBuffer: 64 * 1024 * 1024,
  });
}

test('the renderer boundary delivers a receipt larger than the pipe buffer', t => {
  const result = runCrashingRenderer(crashingRenderer(t, LARGE_DIAGNOSTIC_COUNT));

  assert.equal(result.status, 1, result.stderr);
  assert.ok(
    Buffer.byteLength(result.stderr, 'utf8') > LARGEST_COMMON_PIPE_BUFFER,
    'the regression needs a receipt that cannot fit in one pipe write',
  );

  // A partial write used to truncate this receipt mid-JSON, so the parent CLI
  // discarded every computed diagnostic and reported internal/unclassified.
  const receipt = JSON.parse(result.stderr);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.source, 'renderer');
  assert.equal(receipt.diagnostics.length, LARGE_DIAGNOSTIC_COUNT);
  assert.deepEqual([...new Set(receipt.diagnostics.map(entry => entry.code))], ['layout/constraint']);
  assert.equal(receipt.diagnostics.at(-1).subject.transition, LARGE_DIAGNOSTIC_COUNT - 1);
});

test('the renderer boundary waits for a stalled reader instead of truncating', async t => {
  const script = crashingRenderer(t, LARGE_DIAGNOSTIC_COUNT);
  const child = spawn(process.execPath, [script], {
    env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  t.after(() => child.kill('SIGKILL'));

  // A parent that has not started reading fills the pipe, so every write
  // reports EAGAIN. A fixed retry budget expires here in a few milliseconds and
  // delivers a truncated receipt, which is the same data loss under a different
  // trigger.
  const chunks = [];
  child.stderr.on('data', (chunk) => chunks.push(chunk));
  child.stderr.pause();
  const delivered = once(child.stderr, 'end');
  const exited = once(child, 'exit');

  await delay(STALLED_READER_MS);
  child.stderr.resume();
  await delivered;

  assert.deepEqual(await exited, [1, null]);
  const receipt = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(receipt.diagnostics.length, LARGE_DIAGNOSTIC_COUNT);
  assert.equal(receipt.diagnostics.at(-1).subject.transition, LARGE_DIAGNOSTIC_COUNT - 1);
});

test('the renderer boundary keeps delivering receipts that fit in one write', t => {
  const result = runCrashingRenderer(crashingRenderer(t, SMALL_DIAGNOSTIC_COUNT));

  assert.equal(result.status, 1, result.stderr);
  const receipt = JSON.parse(result.stderr);
  assert.equal(receipt.diagnostics.length, SMALL_DIAGNOSTIC_COUNT);
  assert.equal(receipt.diagnostics[0].code, 'layout/constraint');
});
