#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../archify/bin/visual-check.mjs';
import { testRunnerOptions } from './test-runner-options.mjs';

import { browserTestFiles as testFiles } from './browser-test-inventory.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let options;
let shard;
try {
  if (new Set(testFiles).size !== testFiles.length) throw new Error('Browser inventory contains duplicate files');
  const runnerArguments = [];
  for (const argument of process.argv.slice(2)) {
    if (argument.startsWith('--shard')) {
      if (shard) throw new Error('--shard may be specified only once');
      const match = /^--shard=([1-9]\d*)\/([1-9]\d*)$/.exec(argument);
      if (!match) throw new Error('Use --shard=<index>/<count> with positive integers');
      const index = Number(match[1]);
      const count = Number(match[2]);
      if (!Number.isSafeInteger(index) || !Number.isSafeInteger(count) || index > count) {
        throw new Error('--shard index must be a safe integer within the shard count');
      }
      if (count > testFiles.length) throw new Error('--shard count would create empty browser shards');
      shard = { index, count };
    } else {
      runnerArguments.push(argument);
    }
  }
  if (shard && runnerArguments.some(argument => !argument.startsWith('--') || argument.startsWith('--test-name-pattern='))) {
    throw new Error('--shard cannot be combined with explicit files or a test-name selection');
  }
  const inventory = shard
    ? testFiles.filter((_, index) => index % shard.count === shard.index - 1)
    : testFiles;
  options = testRunnerOptions(runnerArguments, {
    repoRoot, testFiles: inventory.map(file => path.join('test', file)),
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
if (options.list) {
  console.log(options.files.join('\n'));
  process.exit(0);
}

const chrome = findChrome();
if (!chrome) {
  console.error('Browser tests require an executable Chrome/Chromium. Set ARCHIFY_CHROME to its path; this gate cannot skip browser coverage.');
  process.exit(1);
}

console.error(`Browser tests: ${options.files.length} files, concurrency ${options.concurrency}${shard ? `, shard ${shard.index}/${shard.count}` : ''}`);
const result = spawnSync(process.execPath, options.args, {
  cwd: repoRoot,
  env: { ...process.env, ARCHIFY_CHROME: chrome },
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.signal) console.error(`browser test runner terminated by ${result.signal}`);
process.exitCode = result.signal ? 1 : (result.status ?? 1);
