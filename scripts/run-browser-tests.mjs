#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../archify/bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
// Shared by PR CI and tag releases. WebM decoding stays in test:webm.
const testFiles = [
  'desktop-reader-browser.test.mjs',
  'reader-layout-browser.test.mjs',
  'sequence-header-clearance.test.mjs',
  'lifecycle-rail-browser.test.mjs',
  'export-cleanup-browser.test.mjs',
  'offline-font-browser.test.mjs',
  'i18n.test.mjs',
  'semantic-radar.test.mjs',
  'viewer-chrome-layout.test.mjs',
  'viewer-camera-browser.test.mjs',
  'motion-governor-browser.test.mjs',
  'finder-browser.test.mjs',
  'intent-trace-browser.test.mjs',
  'semantic-lens-browser.test.mjs',
  'route-probe-browser.test.mjs',
  'guided-views-browser.test.mjs',
  'focus-browser.test.mjs',
  'semantic-passport-move-browser.test.mjs',
  'export-browser.test.mjs',
  'viewer-identifiers-browser.test.mjs',
  'repository-evidence.test.mjs',
  'repository-evidence-types-browser.test.mjs',
];
const serialTestFiles = [
  'atlas-browser.test.mjs',
  'atlas-compact-browser.test.mjs',
  'atlas-export-browser.test.mjs',
  'atlas-lifecycle-browser.test.mjs',
  'atlas-seamless-browser.test.mjs',
  'internal-structure-browser.test.mjs',
  'atlas-workbench-browser.test.mjs',
];

const chrome = findChrome();
if (!chrome) {
  console.error('Browser tests require an executable Chrome/Chromium. Set ARCHIFY_CHROME to its path; this gate cannot skip browser coverage.');
  process.exit(1);
}

const [major, minor] = process.versions.node.split('.').map(Number);
const supportsConcurrency = major > 18 || (major === 18 && minor >= 19);

function run(files, concurrency) {
  const args = ['--test'];
  if (supportsConcurrency) args.push(`--test-concurrency=${concurrency}`);
  args.push(...files.map((file) => path.join('test', file)));
  return spawnSync(process.execPath, args, {
    cwd: skillRoot,
    env: { ...process.env, ARCHIFY_CHROME: chrome },
    stdio: 'inherit',
  });
}

const parallel = run(testFiles, 2);
if (parallel.error) throw parallel.error;
if (parallel.signal) console.error(`browser test runner terminated by ${parallel.signal}`);
if (parallel.status !== 0) process.exit(parallel.status ?? 1);

const serial = run(serialTestFiles, 1);
if (serial.error) throw serial.error;
if (serial.signal) console.error(`browser test runner terminated by ${serial.signal}`);
process.exitCode = serial.status ?? 1;
