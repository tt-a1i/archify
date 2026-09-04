#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertThirdPartyNotices } from './third-party-notices-contract.mjs';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED_INPUTS = new Set([
  'archify/LICENSE',
  'archify/THIRD_PARTY_NOTICES.md',
  'archify/renderers/shared/generated-validators.mjs',
  'archify/scripts/check-update.mjs',
  'archify/scripts/update-contract.mjs',
  'archify/skill-release.json',
]);
const EXCLUDED_FILES = new Set([
  'archify/package-lock.json',
  'archify/scripts/generate-brand-marks.mjs',
  'archify/scripts/generate-validators.mjs',
]);
const EXCLUDED_SEGMENTS = new Set([
  '.DS_Store',
  '.hive',
  '.workbuddy',
  'node_modules',
]);

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1] || null;
}

function decodeGitOutput(value) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value);
  } catch {
    throw new Error('tracked Archify paths must be valid UTF-8');
  }
}

function gitFailureDetail(result) {
  if (result.stderr?.length) return decodeGitOutput(result.stderr).trim();
  if (result.error?.message) return result.error.message;
  return `exit status ${result.status ?? 'unknown'}`;
}

function trackedEntries(repoRoot) {
  const result = spawnSync('git', ['ls-files', '--stage', '-z', '--', 'archify'], {
    cwd: repoRoot,
    encoding: 'buffer',
  });
  if (result.status !== 0) {
    throw new Error(`unable to enumerate tracked Archify files: ${gitFailureDetail(result)}`);
  }
  return decodeGitOutput(result.stdout).split('\0').filter(Boolean).map((record) => {
    const separator = record.indexOf('\t');
    const metadata = separator === -1 ? [] : record.slice(0, separator).split(' ');
    const relative = separator === -1 ? '' : record.slice(separator + 1);
    if (metadata.length !== 3 || !relative.startsWith('archify/')) {
      throw new Error(`invalid tracked package record: ${JSON.stringify(record)}`);
    }
    return {
      mode: metadata[0],
      stage: metadata[2],
      relative,
    };
  });
}

function requireTrackedFile(repoRoot, relative) {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', '--', relative], {
    cwd: repoRoot,
    encoding: 'buffer',
  });
  if (result.status !== 0) {
    throw new Error(`required repository input is not tracked by Git: ${relative}`);
  }
}

function excluded(relative) {
  if (EXCLUDED_FILES.has(relative)) return true;
  const insideSkill = relative.slice('archify/'.length);
  if (insideSkill === 'test' || insideSkill.startsWith('test/')) return true;
  return insideSkill.split('/').some((segment) => (
    EXCLUDED_SEGMENTS.has(segment) || segment.startsWith('.validator-check-')
  ));
}

function preflightSourceEntry(repoRoot, entry) {
  const segments = entry.relative.split('/');
  let current = repoRoot;
  let sourceMetadata;
  const sourcePath = [];
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let metadata;
    try {
      metadata = fs.lstatSync(current, { bigint: true });
    } catch {
      throw new Error(`tracked package input is missing or unreadable: ${entry.relative}`);
    }
    const traversed = segments.slice(0, index + 1).join('/');
    const isLeaf = index === segments.length - 1;
    if (metadata.isSymbolicLink()) {
      if (isLeaf) throw new Error(`refusing to package tracked symlink: ${entry.relative}`);
      throw new Error(`refusing to package path through symlink: ${traversed} (for ${entry.relative})`);
    }
    if (!isLeaf && !metadata.isDirectory()) {
      throw new Error(`tracked package path has a non-directory ancestor: ${traversed}`);
    }
    if (isLeaf && !metadata.isFile()) {
      throw new Error(`tracked package input is not a regular file: ${entry.relative}`);
    }
    sourcePath.push({ absolute: current, metadata });
    if (isLeaf) sourceMetadata = metadata;
  }
  if (!['100644', '100755'].includes(entry.mode)) {
    throw new Error(`unsupported tracked package mode ${entry.mode}: ${entry.relative}`);
  }
  return { ...entry, source: current, sourceMetadata, sourcePath };
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshotState(left, right) {
  return sameFileIdentity(left, right)
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function sourcePathUnchanged(entry) {
  return entry.sourcePath.every(({ absolute, metadata }, index) => {
    let current;
    try {
      current = fs.lstatSync(absolute, { bigint: true });
    } catch {
      return false;
    }
    const isLeaf = index === entry.sourcePath.length - 1;
    return !current.isSymbolicLink()
      && (isLeaf ? current.isFile() : current.isDirectory())
      && sameSnapshotState(metadata, current);
  });
}

function snapshotSourceEntry(entry) {
  const flags = fs.constants.O_RDONLY
    | (fs.constants.O_NOFOLLOW ?? 0)
    | (fs.constants.O_NONBLOCK ?? 0);
  let descriptor;
  try {
    descriptor = fs.openSync(entry.source, flags);
  } catch {
    throw new Error(`tracked package input changed or became unreadable: ${entry.relative}`);
  }

  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile()
      || !sameFileIdentity(entry.sourceMetadata, before)
      || !sourcePathUnchanged(entry)) {
      throw new Error(`tracked package path changed before it could be read: ${entry.relative}`);
    }
    const content = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!after.isFile()
      || !sameSnapshotState(before, after)
      || !sourcePathUnchanged(entry)) {
      throw new Error(`tracked package path changed while being read: ${entry.relative}`);
    }
    return { ...entry, content };
  } finally {
    fs.closeSync(descriptor);
  }
}

function cleanPackageManifest(destination) {
  const packagePath = path.join(destination, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  delete packageJson.scripts;
  delete packageJson.devDependencies;
  fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function validateThirdPartyNoticeInputs(repoRoot, packageEntries) {
  const packagedEntry = packageEntries.find((entry) => (
    entry.relative === 'archify/THIRD_PARTY_NOTICES.md'
  ));
  if (!packagedEntry) {
    throw new Error('required package input is missing: archify/THIRD_PARTY_NOTICES.md');
  }

  const repositoryPath = path.join(repoRoot, 'THIRD_PARTY_NOTICES.md');
  let repositoryNotices;
  try {
    const metadata = fs.lstatSync(repositoryPath);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('not a regular file');
    repositoryNotices = fs.readFileSync(repositoryPath);
  } catch {
    throw new Error('repository THIRD_PARTY_NOTICES.md is missing or unreadable');
  }

  const packagedNotices = packagedEntry.content;
  assertThirdPartyNotices(repositoryNotices.toString('utf8'), 'repository THIRD_PARTY_NOTICES.md');
  assertThirdPartyNotices(packagedNotices.toString('utf8'), 'archify/THIRD_PARTY_NOTICES.md');
  if (!packagedNotices.equals(repositoryNotices)) {
    throw new Error('archify/THIRD_PARTY_NOTICES.md must byte-match the repository notice');
  }
}

export function stageCleanSkill({ repoRoot = scriptRoot, destination }) {
  const resolvedRoot = fs.realpathSync(path.resolve(repoRoot));
  if (!destination) throw new Error('clean Skill staging requires a destination');
  const resolvedDestination = path.resolve(destination);
  if (fs.existsSync(resolvedDestination)) {
    throw new Error(`clean Skill staging destination already exists: ${resolvedDestination}`);
  }

  const entries = trackedEntries(resolvedRoot);
  for (const entry of entries) {
    if (entry.stage !== '0') {
      throw new Error(`refusing to package unmerged index entry (stage ${entry.stage}): ${entry.relative}`);
    }
  }
  const tracked = new Set(entries.map((entry) => entry.relative));
  for (const required of REQUIRED_INPUTS) {
    if (!tracked.has(required)) {
      throw new Error(`required package input is not tracked by Git: ${required}`);
    }
  }
  requireTrackedFile(resolvedRoot, 'THIRD_PARTY_NOTICES.md');

  const packageEntries = entries
    .filter((entry) => !excluded(entry.relative))
    .map((entry) => preflightSourceEntry(resolvedRoot, entry))
    .map((entry) => snapshotSourceEntry(entry));
  validateThirdPartyNoticeInputs(resolvedRoot, packageEntries);

  fs.mkdirSync(resolvedDestination, { recursive: true, mode: 0o755 });
  let fileCount = 0;
  try {
    for (const entry of packageEntries) {
      const relativeInsideSkill = entry.relative.slice('archify/'.length);
      const target = path.join(resolvedDestination, ...relativeInsideSkill.split('/'));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, entry.content);
      if (entry.mode === '100755') fs.chmodSync(target, 0o755);
      else fs.chmodSync(target, 0o644);
      fileCount += 1;
    }
    cleanPackageManifest(resolvedDestination);
  } catch (error) {
    fs.rmSync(resolvedDestination, { recursive: true, force: true });
    throw error;
  }

  return { destination: resolvedDestination, fileCount };
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(path.resolve(process.argv[1]))
      === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  }
}

if (isMainModule()) {
  try {
    const result = stageCleanSkill({
      repoRoot: argument('--root', scriptRoot),
      destination: argument('--dest'),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
