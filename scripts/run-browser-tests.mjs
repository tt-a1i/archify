#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../archify/bin/visual-check.mjs';
import { testRunnerOptions } from './test-runner-options.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Shared by PR CI and tag releases. WebM decoding stays in test:webm.
// Adjacent heavy suites use opposite indices for CI's two modulo shards.
const testFiles = [
  'finalize-browser.test.mjs',
  'desktop-reader-browser.test.mjs',
  'reader-readability-maintained-browser.test.mjs',
  'reader-layout-browser.test.mjs',
  'reader-layout-settle-browser.test.mjs',
  'reader-cards-overflow-browser.test.mjs',
  'joint-layout-browser.test.mjs',
  'sequence-header-clearance.test.mjs',
  'sequence-width-default-browser.test.mjs',
  'compact-header-clearance.test.mjs',
  'architecture-reading-size-browser.test.mjs',
  'export-cleanup-browser.test.mjs',
  'i18n.test.mjs',
  'offline-font-browser.test.mjs',
  'viewer-chrome-layout.test.mjs',
  'semantic-radar.test.mjs',
  'viewer-camera-browser.test.mjs',
  'motion-governor-browser.test.mjs',
  'finder-browser.test.mjs',
  'intent-trace-browser.test.mjs',
  'semantic-lens-browser.test.mjs',
  'route-probe-browser.test.mjs',
  'focus-browser.test.mjs',
  'crossover-state-browser.test.mjs',
  'semantic-passport-move-browser.test.mjs',
  'export-browser.test.mjs',
  'viewer-identifiers-browser.test.mjs',
  'repository-evidence.test.mjs',
  'repository-evidence-types-browser.test.mjs',
  'tree-branches-browser.test.mjs',
  'class-motion-browser.test.mjs',
  'workflow-typography-browser.test.mjs',
];

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
