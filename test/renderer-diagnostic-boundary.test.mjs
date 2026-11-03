import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const diagnostics = new URL('../archify/renderers/shared/diagnostics.mjs', import.meta.url).href;
const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));

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
    // Mirror the CLI's renderer spawn contract: the machine-readable
    // diagnostic channel requires stderr to carry exactly the receipt, so
    // Node runtime warnings must not precede it.
    env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json', NODE_NO_WARNINGS: '1' },
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
    env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json', NODE_NO_WARNINGS: '1' },
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

test('the production JSON-mode spawn path keeps Node warnings off the renderer diagnostic channel', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-production-spawn-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Every Node process in the spawn chain imports this module at startup and
  // prints a warning, mimicking the runtime warnings behind #1191. The test
  // deliberately does not set NODE_NO_WARNINGS itself: the production spawn
  // path (rendererEnv) must carry it to the renderer child.
  const preload = path.join(dir, 'emit-warning.mjs');
  fs.writeFileSync(preload, 'process.emitWarning("synthetic renderer-channel warning");\n');
  const input = path.join(dir, 'wide.lifecycle.json');
  fs.copyFileSync(
    fileURLToPath(new URL('./fixtures/lifecycle-crowded-wide.json', import.meta.url)),
    input,
  );

  const result = spawnSync(process.execPath, [cli, 'validate', 'lifecycle', input, '--json'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--import=${pathToFileURL(preload).href}`,
    },
    maxBuffer: 64 * 1024 * 1024,
  });

  // Without NODE_NO_WARNINGS on the renderer spawn, the warning line precedes
  // the receipt on stderr, the parent's receipt parse fails, and validate
  // reports internal/unclassified instead of the real diagnostic.
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  const codes = (payload.diagnostics ?? []).map(entry => entry.code);
  assert.ok(
    codes.includes('lifecycle/too-wide'),
    `expected the renderer diagnostic to survive, got ${JSON.stringify(codes)}`,
  );
  assert.ok(
    !codes.includes('internal/unclassified'),
    'the receipt must not fail closed when a warning precedes it',
  );
});
