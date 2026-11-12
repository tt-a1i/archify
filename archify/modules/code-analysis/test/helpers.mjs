import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import assert from 'node:assert/strict';

// Run only test-authored Python fixtures, using the same minimum version as the adapter.
export function runPythonFixture(root, code, commands = process.env.BAUIFY_PYTHON ? [[process.env.BAUIFY_PYTHON]] : [['python3'], ['python'], ['py', '-3']], spawn = spawnSync) {
  for (const [command, ...args] of commands) {
    const probe = spawn(command, [...args, '-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)'], { cwd: root, encoding: 'utf8', timeout: 10000 });
    if (!probe.error && probe.status === 0) return spawn(command, [...args, '-c', code], { cwd: root, encoding: 'utf8', timeout: 10000 });
  }
  assert.fail('Python interpreter unavailable');
}

export const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BAUIFY_ROOT = MODULE_ROOT;

// The self-analysis tests read Archify's renderer package (archify/archify).
// This module lives inside that checkout; BAUIFY_ARCHIFY_ROOT can point elsewhere.
export const ARCHIFY_ROOT = process.env.BAUIFY_ARCHIFY_ROOT
  ? path.resolve(process.env.BAUIFY_ARCHIFY_ROOT)
  : path.resolve(MODULE_ROOT, '..', '..', '..');
export const ARCHIFY_PACKAGE = path.join(ARCHIFY_ROOT, 'archify');
export const ARCHIFY_AVAILABLE = fs.existsSync(path.join(ARCHIFY_PACKAGE, 'bin', 'archify.mjs'));

// Test-only subprocess runner for the extraction stage: some tests need a
// separate process (a different locale, a clean environment) and the
// structured failure shape. There is no product CLI for single stages.
export const EXTRACT_RUNNER = path.join(MODULE_ROOT, 'test', 'run-extract.mjs');
export function runExtract(args, env = process.env, timeout = 20000) {
  const result = spawnSync(process.execPath, [EXTRACT_RUNNER, ...args], { encoding: 'utf8', cwd: MODULE_ROOT, env, timeout });
  return { ...result, json: safeJson(result.stdout) };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
