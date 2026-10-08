#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testRunnerOptions } from './test-runner-options.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testRoot = path.join(repoRoot, 'test');
const testFiles = fs.readdirSync(testRoot)
  .filter((entry) => entry.endsWith('.test.mjs'))
  .sort()
  .map((entry) => path.join('test', entry));

let options;
try {
  // Node-only files benefit from independent CPU slots. Keep Chrome's lower
  // ceiling when a full run explicitly enables browser cases.
  const parallelism = os.availableParallelism?.() ?? os.cpus().length;
  const defaultConcurrency = process.env.ARCHIFY_CHROME ? 2 : Math.max(1, Math.min(4, parallelism));
  options = testRunnerOptions(process.argv.slice(2), { repoRoot, testFiles, allowRequireFiles: true, defaultConcurrency });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
if (options.list) {
  console.log(options.files.join('\n'));
  process.exit(0);
}
console.error(`Repository tests: ${options.files.length} files, concurrency ${options.concurrency}`);

// Delivery commands check for updates; keep that state out of the user's cache.
const updateCache = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'archify-test-update-')));
let result;
try {
  result = spawnSync(process.execPath, options.args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ARCHIFY_UPDATE_CACHE_DIRECTORY: updateCache },
  });
} finally {
  fs.rmSync(updateCache, { recursive: true, force: true });
}

if (result.error) throw result.error;
if (result.signal) {
  process.stderr.write(`test runner terminated by ${result.signal}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
