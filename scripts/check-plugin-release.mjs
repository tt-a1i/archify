#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootFlag = process.argv.indexOf('--root');
const repoRoot = rootFlag === -1 ? scriptRoot : path.resolve(process.argv[rootFlag + 1] || '');
const receiptGitPath = 'plugins/archify/release-receipt.json';
const write = process.argv.includes('--write');
const receiptPath = path.join(repoRoot, receiptGitPath);

const versionPaths = [
  ['.claude-plugin/marketplace.json', (value) => value.plugins?.[0]?.version],
  ['.grok-plugin/marketplace.json', (value) => value.plugins?.[0]?.version],
  ['plugins/archify/plugin.json', (value) => value.version],
  ['plugins/archify/.claude-plugin/plugin.json', (value) => value.version],
  ['plugins/archify/.codex-plugin/plugin.json', (value) => value.version],
];

const manifestPaths = [
  '.agents/plugins/marketplace.json',
  '.claude-plugin/marketplace.json',
  '.grok-plugin/marketplace.json',
  'package.json',
  'plugins/archify/.claude-plugin/plugin.json',
  'plugins/archify/.codex-plugin/openai.yaml',
  'plugins/archify/.codex-plugin/plugin.json',
  'plugins/archify/plugin.json',
];

function assertRegularReleaseInput(relative) {
  const full = path.join(repoRoot, relative);
  const stat = fs.lstatSync(full);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`plugin release input must be a regular file: ${relative}`);
  }
}

function readJson(relative) {
  assertRegularReleaseInput(relative);
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relative), 'utf8'));
}

function readReleaseBytes(relative) {
  assertRegularReleaseInput(relative);
  return fs.readFileSync(path.join(repoRoot, relative));
}

function collectFiles(relativeRoot) {
  const root = path.join(repoRoot, relativeRoot);
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const relative = path.relative(repoRoot, full).split(path.sep).join('/');
      if (entry.isSymbolicLink()) {
        throw new Error(`plugin release input must not be a symlink: ${relative}`);
      }
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(relative);
      else throw new Error(`plugin release input must be a regular file: ${relative}`);
    }
  }
  walk(root);
  return files;
}

function payloadDigest() {
  const files = [...manifestPaths, ...collectFiles('plugins/archify/skills/archify')].sort();
  const hash = crypto.createHash('sha256');
  for (const relative of files) {
    hash.update(`${relative}\0`);
    hash.update(readReleaseBytes(relative));
    hash.update('\0');
  }
  return { files, sha256: hash.digest('hex') };
}

function readReceipt() {
  if (!fs.existsSync(receiptPath)) return null;
  return readJson(receiptGitPath);
}

function readCommittedReceipt() {
  const result = spawnSync('git', ['-C', repoRoot, 'show', `HEAD:${receiptGitPath}`], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error('committed plugin release receipt is not valid JSON');
  }
}

function releaseAnchors() {
  const anchors = [];
  const committed = readCommittedReceipt();
  const working = readReceipt();
  if (committed) anchors.push(['HEAD', committed]);
  if (working) anchors.push(['working tree', working]);
  return anchors;
}

function assertNoSilentReleaseUnderVersion(anchors, payloadSha256, releaseVersion) {
  for (const [source, anchor] of anchors) {
    if (anchor.version === releaseVersion && anchor.sha256 !== payloadSha256) {
      throw new Error(`plugin bytes changed without a version increment from ${releaseVersion} (relative to ${source}); bump every plugin manifest version, then regenerate the release receipt`);
    }
  }
}

const versions = versionPaths.map(([relative, select]) => [relative, select(readJson(relative))]);
const uniqueVersions = new Set(versions.map(([, version]) => version));
if (uniqueVersions.size !== 1 || uniqueVersions.has(undefined)) {
  throw new Error(`plugin versions must match:\n${versions.map(([file, version]) => `  ${file}: ${version || '(missing)'}`).join('\n')}`);
}

const version = versions[0][1];
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`plugin version is not valid SemVer: ${version}`);
}

const payload = payloadDigest();
const receipt = readReceipt();
const anchors = releaseAnchors();

if (write) {
  assertNoSilentReleaseUnderVersion(anchors, payload.sha256, version);
  if (anchors.some(([, anchor]) => anchor.version === version && anchor.sha256 === payload.sha256)) {
    process.stdout.write(`plugin release receipt is already up to date for ${version}\n`);
    process.exit(0);
  }
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ version, ...payload }, null, 2)}\n`);
  process.stdout.write(`wrote plugin release receipt for ${version}\n`);
  process.exit(0);
}

if (!receipt) {
  throw new Error('plugin release receipt is missing — run node scripts/check-plugin-release.mjs --write after an intentional plugin release');
}
if (receipt.version !== version) {
  throw new Error(`plugin release receipt is for ${receipt.version || '(missing)'}, but manifests declare ${version}; update the receipt only with an intentional plugin release`);
}
if (receipt.sha256 !== payload.sha256) {
  throw new Error(`plugin bytes changed without a version increment from ${version}; bump every plugin manifest version, then regenerate the release receipt`);
}
if (JSON.stringify(receipt.files) !== JSON.stringify(payload.files)) {
  throw new Error('plugin release receipt file list is stale');
}

process.stdout.write(`plugin release identity ok: ${version}\n`);
