#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = path.join(repoRoot, 'archify');
const testRoot = path.join(skillRoot, 'test');
const testFiles = fs.readdirSync(testRoot)
  .filter((entry) => entry.endsWith('.test.mjs'))
  .sort()
  .map((entry) => path.join('test', entry));
const matchedAbTest = path.join(repoRoot, 'benchmarks', 'matched-ab', 'test', 'matched-ab.test.mjs');
if (fs.existsSync(matchedAbTest)) testFiles.push(matchedAbTest);

const [major, minor] = process.versions.node.split('.').map(Number);
const supportsConcurrencyFlag = major > 18 || (major === 18 && minor >= 19);
const args = ['--test'];
if (supportsConcurrencyFlag) args.push('--test-concurrency=2');
args.push(...testFiles);

const result = spawnSync(process.execPath, args, {
  cwd: skillRoot,
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.signal) {
  process.stderr.write(`test runner terminated by ${result.signal}\n`);
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
