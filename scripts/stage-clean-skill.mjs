#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  captureRegularFileBinding,
  quarantineRemoveRegularFileBinding,
  releaseRegularFileBinding,
} from '../archify/renderers/shared/atomic-output.mjs';
import { containedBy, sameEntry } from '../archify/renderers/shared/path-semantics.mjs';
import { validatePortablePathSet } from '../archify/renderers/shared/portable-path.mjs';
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
const ATLAS_REQUIRED_INPUTS = new Set([
  'archify/schemas/atlas.schema.json',
  'archify/renderers/shared/atlas-manifest.mjs',
  'archify/renderers/shared/atlas-delivery.mjs',
  'archify/renderers/shared/atlas-bundle.mjs',
  'archify/renderers/shared/atlas-envelope.mjs',
  'archify/renderers/shared/atlas-shell.mjs',
  'archify/renderers/shared/atlas-navigation.mjs',
  'archify/references/architecture-atlas.md',
  'archify/assets/vendor/fflate-gunzip-0.8.2.min.js',
  'archify/assets/vendor/fflate-MIT.txt',
]);
const RUNTIME_DEPENDENCIES = Object.freeze([
  'archify/renderers/shared/atomic-output.mjs',
  'archify/renderers/shared/output-path.mjs',
  'archify/renderers/shared/path-semantics.mjs',
  'archify/renderers/shared/portable-path.mjs',
  'archify/renderers/shared/sidecar-path.mjs',
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
    // path-contract-allow: git-path -- git ls-files emits repository-relative POSIX paths.
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

function cleanPackageManifestEntry(packageEntries) {
  const packageEntry = packageEntries.find((entry) => entry.relative === 'archify/package.json');
  if (!packageEntry) throw new Error('required package input is missing: archify/package.json');
  const packageJson = JSON.parse(packageEntry.content.toString('utf8'));
  delete packageJson.scripts;
  delete packageJson.devDependencies;
  packageEntry.content = Buffer.from(`${JSON.stringify(packageJson, null, 2)}\n`);
}

function stagingError(message, cause = undefined) {
  return cause === undefined ? new Error(message) : new Error(message, { cause });
}

function verifiedDirectoryMetadata(directory) {
  const metadata = fs.lstatSync(directory, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.ino === 0n) {
    throw stagingError(`clean Skill staging directory identity is unavailable: ${directory}`);
  }
  return metadata;
}

function assertOwnedDirectory(owned) {
  let current;
  try {
    current = fs.lstatSync(owned.absolute, { bigint: true });
  } catch (error) {
    throw stagingError(`clean Skill staging directory changed: ${owned.absolute}`, error);
  }
  if (!current.isDirectory()
    || current.isSymbolicLink()
    || current.ino === 0n
    || !sameFileIdentity(owned.metadata, current)) {
    throw stagingError(`clean Skill staging directory changed: ${owned.absolute}`);
  }
}

function createOwnedDirectory(absolute, parent, ownership, { destinationRoot = false } = {}) {
  if (parent) assertOwnedDirectory(parent);
  try {
    fs.mkdirSync(absolute, { mode: 0o755 });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      const message = destinationRoot
        ? `clean Skill staging destination already exists: ${absolute}`
        : `clean Skill staging entry already exists: ${absolute}`;
      throw stagingError(message, error);
    }
    throw error;
  }

  // Without a handle-backed identity, cleanup cannot prove that the path is
  // still ours. Leave the entry in place instead of risking a claimant.
  const metadata = verifiedDirectoryMetadata(absolute);
  const owned = { absolute, metadata };
  ownership.directories.push(owned);
  ownership.directoryByPath.set(absolute, owned);
  if (parent) assertOwnedDirectory(parent);
  return owned;
}

function ensureOwnedParentDirectories(destination, relative, ownership) {
  const components = relative.split('/');
  let current = destination;
  let parent = ownership.directoryByPath.get(destination);
  const ancestors = [parent];
  assertOwnedDirectory(parent);
  for (const component of components.slice(0, -1)) {
    current = path.join(current, component);
    let owned = ownership.directoryByPath.get(current);
    if (!owned) owned = createOwnedDirectory(current, parent, ownership);
    else assertOwnedDirectory(owned);
    parent = owned;
    ancestors.push(owned);
  }
  return ancestors;
}

function captureNewFileIdentity(descriptor, absolute, ownership, ancestors) {
  let metadata;
  try {
    metadata = fs.fstatSync(descriptor, { bigint: true });
  } catch (error) {
    // A transient first fstat failure must not turn our just-created file into
    // an unowned cleanup target. Retry only to bind cleanup, then rethrow the
    // original failure.
    try {
      const retry = fs.fstatSync(descriptor, { bigint: true });
      if (retry.isFile() && retry.ino !== 0n) {
        ownership.files.push({ absolute, metadata: retry, ancestors });
      }
    } catch {}
    throw error;
  }
  if (!metadata.isFile() || metadata.ino === 0n) {
    throw stagingError(`clean Skill staging file identity is unavailable: ${absolute}`);
  }
  const owned = { absolute, metadata, ancestors };
  ownership.files.push(owned);
  return owned;
}

function writeOwnedFile(absolute, content, mode, ownership, ancestors = []) {
  for (const ancestor of ancestors) assertOwnedDirectory(ancestor);
  const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW ?? 0);
  let descriptor;
  let owned;
  try {
    descriptor = fs.openSync(
      absolute,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
      mode,
    );
    owned = captureNewFileIdentity(descriptor, absolute, ownership, ancestors);
    // Opening a leaf with O_NOFOLLOW does not prevent a directory ancestor
    // from being redirected between the preflight and open calls. Recheck the
    // complete owned chain while the new file is still empty; descriptor-bound
    // cleanup can then retire that inode without ever writing package bytes
    // through a claimant-controlled ancestor.
    for (const ancestor of ancestors) assertOwnedDirectory(ancestor);
    fs.writeFileSync(descriptor, content);
    fs.fchmodSync(descriptor, mode);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const current = fs.lstatSync(absolute, { bigint: true });
    if (!after.isFile()
      || !current.isFile()
      || after.ino === 0n
      || current.ino === 0n
      || !sameFileIdentity(owned.metadata, after)
      || !sameFileIdentity(after, current)) {
      throw stagingError(`clean Skill staging file changed while being written: ${absolute}`);
    }
    for (const ancestor of ancestors) assertOwnedDirectory(ancestor);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function ownedDirectoryStillNamed(owned) {
  try {
    const current = fs.lstatSync(owned.absolute, { bigint: true });
    return current.isDirectory()
      && !current.isSymbolicLink()
      && current.ino !== 0n
      && sameFileIdentity(owned.metadata, current);
  } catch {
    return false;
  }
}

function retireOwnedStagingFile(owned) {
  const captured = captureRegularFileBinding(owned.absolute, {
    subject: 'clean-staging-file',
    expectedIdentity: {
      device: owned.metadata.dev,
      inode: owned.metadata.ino,
    },
    expectedLinks: 1,
  });
  if (captured.status !== 'captured') return false;
  try {
    const removed = quarantineRemoveRegularFileBinding(
      captured.binding,
      owned.absolute,
      { subject: 'clean-staging-file', expectedLinks: 1 },
    );
    return removed.status === 'removed' || removed.status === 'absent';
  } finally {
    releaseRegularFileBinding(captured.binding);
  }
}

function createDirectoryRetirementQuarantine(parent) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const directory = path.join(
      parent,
      `.archify-stage-remove-${randomBytes(16).toString('hex')}`,
    );
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
      return directory;
    } catch (error) {
      if (error?.code !== 'EEXIST') return null;
    }
  }
  return null;
}

function retireOwnedStagingDirectory(owned) {
  if (!ownedDirectoryStillNamed(owned)) return false;
  try {
    // Keep a known non-empty directory at its public recovery location. Any
    // remaining child was not retired as one of this invocation's owned files
    // and may therefore belong to a claimant.
    if (fs.readdirSync(owned.absolute).length !== 0) return false;
  } catch {
    return false;
  }
  const quarantine = createDirectoryRetirementQuarantine(path.dirname(owned.absolute));
  if (!quarantine) return false;
  const movedPath = path.join(quarantine, path.basename(owned.absolute));
  try {
    fs.renameSync(owned.absolute, movedPath);
  } catch {
    try { fs.rmdirSync(quarantine); } catch {}
    return false;
  }

  let moved;
  try {
    moved = fs.lstatSync(movedPath, { bigint: true });
  } catch {
    return false;
  }
  if (!moved.isDirectory()
    || moved.isSymbolicLink()
    || moved.ino === 0n
    || !sameFileIdentity(owned.metadata, moved)) {
    // A successor won the move boundary. It is retained under the private
    // quarantine name because directories have no portable no-clobber
    // hard-link primitive with which to restore that exact entry safely.
    return false;
  }
  try {
    // Never recurse: unexpected children keep the owned directory as recovery
    // material, and a non-empty successor swapped here cannot be deleted.
    fs.rmdirSync(movedPath);
    fs.rmdirSync(quarantine);
    return true;
  } catch {
    return false;
  }
}

function cleanupOwnedStaging(ownership) {
  for (const owned of [...ownership.files].reverse()) {
    try { retireOwnedStagingFile(owned); } catch {}
  }
  for (const owned of [...ownership.directories].reverse()) {
    try { retireOwnedStagingDirectory(owned); } catch {}
  }
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

  const embeddedFonts = packageEntries.some((entry) => entry.content.includes('data:font/woff2'));
  const fflate = packageEntries.some((entry) => (
    entry.relative === 'archify/assets/vendor/fflate-gunzip-0.8.2.min.js'
  ));
  if (embeddedFonts && !packageEntries.some((entry) => entry.relative === 'archify/assets/JetBrainsMono-OFL.txt')) {
    throw new Error('embedded viewer font requires assets/JetBrainsMono-OFL.txt');
  }
  const packagedNotices = packagedEntry.content;
  assertThirdPartyNotices(repositoryNotices.toString('utf8'), 'repository THIRD_PARTY_NOTICES.md', { embeddedFonts, fflate });
  assertThirdPartyNotices(packagedNotices.toString('utf8'), 'archify/THIRD_PARTY_NOTICES.md', { embeddedFonts, fflate });
  if (!packagedNotices.equals(repositoryNotices)) {
    throw new Error('archify/THIRD_PARTY_NOTICES.md must byte-match the repository notice');
  }
}

function validateRuntimeDependencies(packageEntries) {
  const packaged = new Set(packageEntries.map((entry) => entry.relative));
  for (const relative of RUNTIME_DEPENDENCIES) {
    const basename = path.basename(relative);
    const imported = packageEntries.some((entry) => (
      // path-contract-allow: portable-logical-path -- Both values are tracked package entry names.
      entry.relative !== relative
      && /[.]m?js$/u.test(entry.relative)
      && entry.content.includes(basename)
    ));
    if (imported && !packaged.has(relative)) {
      throw new Error(`required package input is not tracked by Git: ${relative}`);
    }
  }
}

export function stageCleanSkill({ repoRoot = scriptRoot, destination, modeManifest = null }) {
  const resolvedRoot = fs.realpathSync(path.resolve(repoRoot));
  if (!destination) throw new Error('clean Skill staging requires a destination');
  const resolvedDestination = path.resolve(destination);
  // The manifest records each staged file's Git index mode for the archive
  // writer. Filesystem permission bits are not portable (Windows cannot store
  // an executable bit), so the archive must not re-derive modes from stat.
  const resolvedModeManifest = modeManifest === null ? null : path.resolve(modeManifest);
  if (resolvedModeManifest !== null) {
    // The manifest belongs to this invocation only: never overwrite, and never
    // later remove, a file that already existed at that path.
    let manifestExists = true;
    try {
      fs.lstatSync(resolvedModeManifest);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      manifestExists = false;
    }
    if (manifestExists) {
      throw new Error(`mode manifest path already exists: ${resolvedModeManifest}`);
    }
    // Compare physical locations: a symlinked ancestor on either side must not
    // let the manifest land inside the staged tree, where the writer would see
    // an unrecorded file and refuse the archive.
    const manifestContainment = containedBy(resolvedDestination, resolvedModeManifest);
    if (manifestContainment.status === 'match') {
      throw new Error(`mode manifest must be written outside the staged Skill tree: ${resolvedModeManifest}`);
    }
    if (manifestContainment.status === 'unknown') {
      throw new Error(`mode manifest location could not be verified safely (${manifestContainment.reason.code}): ${resolvedModeManifest}`);
    }
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
  // Atlas is a feature-complete package slice. Require every member once any
  // Atlas file is present, while keeping immutable pre-Atlas release snapshots
  // reproducible for adapters that intentionally pin those historical bytes.
  if ([...ATLAS_REQUIRED_INPUTS].some((relative) => tracked.has(relative))) {
    for (const required of ATLAS_REQUIRED_INPUTS) {
      if (!tracked.has(required)) {
        throw new Error(`required package input is not tracked by Git: ${required}`);
      }
    }
  }
  requireTrackedFile(resolvedRoot, 'THIRD_PARTY_NOTICES.md');

  const includedEntries = entries.filter((entry) => !excluded(entry.relative));
  validatePortablePathSet(
    includedEntries.map((entry) => entry.relative.slice('archify/'.length)),
    { profile: 'archive' },
  );

  const packageEntries = includedEntries
    .map((entry) => preflightSourceEntry(resolvedRoot, entry))
    .map((entry) => snapshotSourceEntry(entry));
  // Current packages must contain every imported runtime, while historical
  // snapshots that predate a runtime remain reproducible by the DSH adapter.
  validateRuntimeDependencies(packageEntries);
  validateThirdPartyNoticeInputs(resolvedRoot, packageEntries);
  cleanPackageManifestEntry(packageEntries);

  const modes = Object.fromEntries(
    packageEntries
      .map((entry) => [entry.relative.slice('archify/'.length), entry.mode])
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  );

  const ownership = {
    directories: [],
    directoryByPath: new Map(),
    files: [],
  };
  let fileCount = 0;
  try {
    const destinationParentPath = path.dirname(resolvedDestination);
    fs.mkdirSync(destinationParentPath, { recursive: true, mode: 0o755 });
    const destinationParent = {
      absolute: destinationParentPath,
      metadata: verifiedDirectoryMetadata(destinationParentPath),
    };
    createOwnedDirectory(resolvedDestination, destinationParent, ownership, {
      destinationRoot: true,
    });
    for (const entry of packageEntries) {
      const relativeInsideSkill = entry.relative.slice('archify/'.length);
      const target = path.join(resolvedDestination, ...relativeInsideSkill.split('/'));
      const ancestors = ensureOwnedParentDirectories(
        resolvedDestination,
        relativeInsideSkill,
        ownership,
      );
      writeOwnedFile(
        target,
        entry.content,
        entry.mode === '100755' ? 0o755 : 0o644,
        ownership,
        ancestors,
      );
      fileCount += 1;
    }
    if (resolvedModeManifest !== null) {
      writeOwnedFile(
        resolvedModeManifest,
        `${JSON.stringify(modes, null, 2)}\n`,
        0o644,
        ownership,
      );
    }
    assertOwnedDirectory(ownership.directoryByPath.get(resolvedDestination));
  } catch (error) {
    cleanupOwnedStaging(ownership);
    throw error;
  }

  return { destination: resolvedDestination, fileCount, modes };
}

export function isMainModule({
  argvPath = process.argv[1],
  modulePath = fileURLToPath(import.meta.url),
} = {}) {
  if (!argvPath) return false;
  try {
    return sameEntry(argvPath, modulePath).status === 'match';
  } catch {
    return false;
  }
}

if (isMainModule()) {
  try {
    const modeManifest = argument('--mode-manifest');
    const result = stageCleanSkill({
      repoRoot: argument('--root', scriptRoot),
      destination: argument('--dest'),
      modeManifest,
    });
    const summary = { destination: result.destination, fileCount: result.fileCount };
    if (modeManifest) summary.modeManifest = path.resolve(modeManifest);
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
