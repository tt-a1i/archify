#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../archify/bin/visual-check.mjs';
import { testRunnerOptions } from './test-runner-options.mjs';

import { browserTestFiles, storyMediaBrowserTest } from './browser-test-inventory.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let options;
try {
  const profile = process.env.CI_BROWSER_PROFILE ?? 'full';
  const storyOwner = process.env.CI_STORY_BROWSER_OWNER ?? 'browser';
  if (!['full', 'atlas', 'changed'].includes(profile)) throw new Error(`Unknown browser test profile: ${profile}`);
  if (!['browser', 'webm'].includes(storyOwner)) throw new Error(`Unknown Story browser test owner: ${storyOwner}`);
  let testFiles = browserTestFiles.filter(filename =>
    (profile !== 'atlas' || filename.startsWith('code-analysis-')) &&
    (storyOwner === 'browser' || filename !== storyMediaBrowserTest));
  if (profile === 'changed') {
    const changed = JSON.parse(process.env.CI_BROWSER_TESTS ?? '[]');
    const available = new Set(testFiles.map(file => `test/${file}`));
    if (!Array.isArray(changed) || !changed.length || new Set(changed).size !== changed.length ||
        changed.some(file => !available.has(file))) {
      throw new Error('Changed browser profile requires a nonempty, unique list of owned browser test paths');
    }
    testFiles = testFiles.filter(file => changed.includes(`test/${file}`));
  }
  if (!testFiles.length) throw new Error('The browser test profile selected no tests');
  if (new Set(testFiles).size !== testFiles.length) throw new Error('Browser inventory contains duplicate files');
  options = testRunnerOptions(process.argv.slice(2), {
    repoRoot, testFiles: testFiles.map(file => path.join('test', file)), allowShards: true,
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
  console.error('Browser tests require an executable Chrome/Chromium (or Microsoft Edge). Set ARCHIFY_CHROME to its path; this gate cannot skip browser coverage.');
  process.exit(1);
}

console.error(`Browser tests: ${options.files.length} files, concurrency ${options.concurrency}${options.shard ? `, shard ${options.shard.index}/${options.shard.count}` : ''}`);
// Browser fixtures also deliver artifacts and check for updates. Give each
// invocation its own cache, just like the ordinary repository test runner.
const updateCache = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'archify-browser-update-')));
let result;
try {
  result = spawnSync(process.execPath, options.args, {
    cwd: repoRoot,
    env: { ...process.env, ARCHIFY_CHROME: chrome, ARCHIFY_UPDATE_CACHE_DIRECTORY: updateCache },
    stdio: 'inherit',
  });
} finally {
  fs.rmSync(updateCache, { recursive: true, force: true });
}
if (result.error) throw result.error;
if (result.signal) console.error(`browser test runner terminated by ${result.signal}`);
process.exitCode = result.signal ? 1 : (result.status ?? 1);
