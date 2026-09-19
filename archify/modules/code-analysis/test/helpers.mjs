import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

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
export function runExtract(args, env = process.env) {
  const result = spawnSync(process.execPath, [EXTRACT_RUNNER, ...args], { encoding: 'utf8', cwd: MODULE_ROOT, env, timeout: 20000 });
  return { ...result, json: safeJson(result.stdout) };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
