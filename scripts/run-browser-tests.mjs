#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from '../archify/bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
// Shared by PR CI and tag releases. WebM decoding stays in test:webm.
const testFiles = [
  'code-analysis-browser.test.mjs',
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

const chrome = findChrome();
if (!chrome) {
  console.error('Browser tests require an executable Chrome/Chromium. Set ARCHIFY_CHROME to its path; this gate cannot skip browser coverage.');
  process.exit(1);
}

const args = ['--test'];
const [major, minor] = process.versions.node.split('.').map(Number);
if (major > 18 || (major === 18 && minor >= 19)) args.push('--test-concurrency=2');
args.push(...testFiles.map((file) => path.join('test', file)));
const result = spawnSync(process.execPath, args, {
  cwd: skillRoot,
  env: { ...process.env, ARCHIFY_CHROME: chrome },
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.signal) console.error(`browser test runner terminated by ${result.signal}`);
process.exitCode = result.status ?? 1;
