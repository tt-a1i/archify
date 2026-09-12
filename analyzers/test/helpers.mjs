import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ANALYZERS_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(ANALYZERS_ROOT, '..');
export const CLI = path.join(ANALYZERS_ROOT, 'bin', 'analyze.mjs');

export function runCli(args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', cwd: ANALYZERS_ROOT });
  return { ...result, json: safeJson(result.stdout) };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
