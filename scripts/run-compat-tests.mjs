#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCompatibilityInventory } from './compat-test-inventory.mjs';
import { testRunnerOptions } from './test-runner-options.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
let options;
try {
  options = testRunnerOptions(argv, {
    repoRoot, testFiles: validateCompatibilityInventory(repoRoot),
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
if (options.list) {
  console.log(options.files.join('\n'));
  process.exit(0);
}

console.error(`Compatibility tests: golden outputs plus ${options.files.length} runtime suites`);
// Delegate to the existing runner so compatibility tests have the same option
// handling, isolated update cache, cleanup and child-failure behavior.
const runnerFlags = argv.filter(argument => argument.startsWith('--'));
for (const args of [
  ['test/golden.mjs'],
  ['scripts/run-tests.mjs', ...runnerFlags, ...options.files],
]) {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.signal) console.error(`compatibility test runner terminated by ${result.signal}`);
  if (result.signal || result.status !== 0) {
    process.exitCode = result.signal ? 1 : (result.status ?? 1);
    break;
  }
}
