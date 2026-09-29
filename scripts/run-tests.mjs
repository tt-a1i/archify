#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = path.join(repoRoot, 'archify');
const testRoot = path.join(skillRoot, 'test');
const testFiles = fs.readdirSync(testRoot)
  .filter((entry) => entry.endsWith('.test.mjs'))
  .sort()
  .map((entry) => path.join('test', entry));

const [major, minor] = process.versions.node.split('.').map(Number);
const supportsConcurrencyFlag = major > 18 || (major === 18 && minor >= 19);
const args = ['--test'];
if (supportsConcurrencyFlag) args.push('--test-concurrency=2');
args.push(...testFiles);

// Delivery commands check for updates; keep that state out of the user's cache.
const updateCache = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'archify-test-update-')));
const result = spawnSync(process.execPath, args, {
  cwd: skillRoot,
  stdio: 'inherit',
  env: { ...process.env, ARCHIFY_UPDATE_CACHE_DIRECTORY: updateCache },
});
fs.rmSync(updateCache, { recursive: true, force: true });

if (result.error) throw result.error;
if (result.signal) {
  process.stderr.write(`test runner terminated by ${result.signal}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
