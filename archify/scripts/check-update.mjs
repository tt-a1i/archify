#!/usr/bin/env node

import crypto from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_MANIFEST_URL,
  SKILL_ID,
  UpdateContractError,
  compareSemver,
  isStableCoreVersion,
  parseSemver,
  validateLocalRelease,
  validateReleaseNotesUrl,
  validateStableUpdateManifest,
} from './update-contract.mjs';

const OPERATION_STATE_FILE = 'state.json';
const OPERATION_OWNER_FILE = 'owner.json';
const ACTIVE_CLAIM_DIRECTORY = 'active-claim';
const OPERATION_NAME = /^(reserved|pending|committed|fenced|cancelled)-(\d{1,20})$/;
const MAX_OPERATION_GENERATION = (10n ** 20n) - 1n;
const CHECK_TTL_MS = 72 * 60 * 60 * 1_000;
const MAX_CACHE_HORIZON_MS = Math.ceil(CHECK_TTL_MS * 1.2);
const FIRST_FAILURE_DELAY_MS = 6 * 60 * 60 * 1_000;
const LATER_FAILURE_DELAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 1_000;
const MAX_RESPONSE_BYTES = 32 * 1_024;
const MAX_LOCAL_RELEASE_BYTES = 4 * 1_024;
const MAX_CACHE_STATE_BYTES = 64 * 1_024;
const MAX_CLAIM_OWNER_BYTES = 1_024;
const LONGEST_ISO_TIMESTAMP = '+275760-09-13T00:00:00.000Z';
const LOCK_STALE_MS = 30_000;
const ACK_LOCK_WAIT_MS = 1_200;
const LOCK_RETRY_DELAY_MS = 20;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultReleasePath = path.resolve(scriptDirectory, '..', 'skill-release.json');

class FileIdentityChangedError extends Error {}

function silent(reason) {
  return { status: 'silent', reason };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value, allowed) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function validateManifest(value) {
  const manifest = validateStableUpdateManifest(value);
  return {
    version: manifest.version,
    targetDigest: `sha256:${manifest.artifact.sha256}`,
    severity: manifest.severity,
    releaseNotes: manifest.releaseNotes,
  };
}

function validateCachedCandidate(value) {
  if (!isPlainObject(value)
    || !hasOnlyKeys(value, new Set([
      'version', 'targetDigest', 'severity', 'releaseNotes',
    ]))) return null;
  try {
    if (!isStableCoreVersion(value.version)) return null;
    if (!DIGEST_PATTERN.test(value.targetDigest)
      || !['normal', 'security'].includes(value.severity)) return null;
    validateReleaseNotesUrl(value.releaseNotes, value.version);
    return { ...value };
  } catch {
    return null;
  }
}

function emptyState(installedVersion = null) {
  return {
    schemaVersion: 1,
    skillId: SKILL_ID,
    installedVersion,
    check: {
      nextCheckAt: null,
      consecutiveFailures: 0,
    },
    notification: {
      offeredDigests: [],
      acknowledgedDigests: [],
    },
  };
}

function encodeBoundedState(state) {
  const encoded = Buffer.from(`${JSON.stringify(state)}\n`, 'utf8');
  return encoded.length <= MAX_CACHE_STATE_BYTES ? encoded : null;
}

function stateAfterAcknowledgement(state, targetDigest) {
  const alreadyAcknowledged = state.notification.acknowledgedDigests.includes(targetDigest);
  return {
    ...state,
    notification: {
      offeredDigests: state.notification.offeredDigests
        .filter((digest) => digest !== targetDigest),
      acknowledgedDigests: alreadyAcknowledged
        ? [...state.notification.acknowledgedDigests]
        : [...state.notification.acknowledgedDigests, targetDigest],
    },
  };
}

function stateWithFailureCheck(state, nextCheckAt, consecutiveFailures, withdrawCandidate = false) {
  const failedState = {
    ...state,
    check: { nextCheckAt, consecutiveFailures },
  };
  if (withdrawCandidate) delete failedState.candidate;
  return failedState;
}

function encodeRecoverableState(state) {
  const encoded = encodeBoundedState(state);
  if (!encoded) return null;
  if (!encodeBoundedState(stateWithFailureCheck(state, LONGEST_ISO_TIMESTAMP, 2))) return null;
  let acknowledgementState = state;
  for (const targetDigest of state.notification.offeredDigests) {
    acknowledgementState = stateAfterAcknowledgement(acknowledgementState, targetDigest);
    if (!encodeBoundedState(acknowledgementState)
      || !encodeBoundedState(stateWithFailureCheck(
        acknowledgementState,
        LONGEST_ISO_TIMESTAMP,
        2,
      ))) return null;
  }
  return encoded;
}

function versionCacheDirectory(cacheDirectory, installedVersion) {
  const partition = crypto.createHash('sha256').update(installedVersion).digest('hex').slice(0, 24);
  return path.join(cacheDirectory, `version-${partition}`);
}

function normalizeState(value, installedVersion) {
  const effectiveInstalledVersion = installedVersion ?? value?.installedVersion ?? null;
  if (!isPlainObject(value) || value.schemaVersion !== 1 || value.skillId !== SKILL_ID
    || (installedVersion !== null && value.installedVersion !== installedVersion)
    || (value.installedVersion !== null && typeof value.installedVersion !== 'string')
    || !isPlainObject(value.check)
    || !(value.check.nextCheckAt === null || typeof value.check.nextCheckAt === 'string')
    || !Number.isSafeInteger(value.check.consecutiveFailures)
    || value.check.consecutiveFailures < 0
    || !isPlainObject(value.notification)) return null;
  if (effectiveInstalledVersion !== null) {
    try {
      parseSemver(effectiveInstalledVersion);
    } catch {
      return null;
    }
  }

  const state = emptyState(effectiveInstalledVersion);
  state.check.nextCheckAt = value.check.nextCheckAt;
  state.check.consecutiveFailures = value.check.consecutiveFailures;
  const { offeredDigests, acknowledgedDigests } = value.notification;
  if (!Array.isArray(offeredDigests)
    || offeredDigests.some((digest) => typeof digest !== 'string' || !DIGEST_PATTERN.test(digest))) {
    return null;
  }
  state.notification.offeredDigests = [...new Set(offeredDigests)];

  if (!Array.isArray(acknowledgedDigests)
    || acknowledgedDigests.some((digest) => typeof digest !== 'string' || !DIGEST_PATTERN.test(digest))) {
    return null;
  }
  state.notification.acknowledgedDigests = [...new Set(acknowledgedDigests)];
  const hasCandidate = Object.hasOwn(value, 'candidate');
  const candidate = validateCachedCandidate(value.candidate);
  if (hasCandidate && !candidate) return null;
  if (candidate) {
    if (effectiveInstalledVersion !== null
      && compareSemver(candidate.version, effectiveInstalledVersion) > 0
      && !state.notification.offeredDigests.includes(candidate.targetDigest)
      && !state.notification.acknowledgedDigests.includes(candidate.targetDigest)) return null;
    state.candidate = candidate;
  }
  return encodeRecoverableState(state) ? state : null;
}

function isSameFile(left, right) {
  if (left.dev !== right.dev || left.ino !== right.ino) return false;
  if (left.ino !== 0n) return true;
  if (left.birthtimeNs === 0n || right.birthtimeNs === 0n) return false;
  return left.birthtimeNs === right.birthtimeNs
    && left.mode === right.mode;
}

function assertBoundedRegularFile(metadata, maxBytes) {
  if (!metadata.isFile()
    || metadata.isSymbolicLink()
    || metadata.size > BigInt(maxBytes)) {
    throw new Error('unsafe JSON file');
  }
}

async function readJsonFile(target, maxBytes, expectedMetadata = null) {
  const pathMetadata = await fs.lstat(target, { bigint: true });
  if (expectedMetadata && !isSameFile(expectedMetadata, pathMetadata)) {
    throw new FileIdentityChangedError('JSON file identity changed');
  }
  assertBoundedRegularFile(pathMetadata, maxBytes);
  const flags = fsConstants.O_RDONLY
    | (fsConstants.O_NOFOLLOW ?? 0)
    | (fsConstants.O_NONBLOCK ?? 0);
  const handle = await fs.open(target, flags);
  try {
    const handleMetadata = await handle.stat({ bigint: true });
    const currentPathMetadata = await fs.lstat(target, { bigint: true });
    assertBoundedRegularFile(handleMetadata, maxBytes);
    assertBoundedRegularFile(currentPathMetadata, maxBytes);
    if (!isSameFile(pathMetadata, handleMetadata)
      || !isSameFile(currentPathMetadata, handleMetadata)) {
      throw new FileIdentityChangedError('JSON file changed while opening');
    }

    const chunks = [];
    let size = 0;
    while (size <= maxBytes) {
      const chunk = Buffer.allocUnsafe(Math.min(8 * 1_024, (maxBytes + 1) - size));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, size);
      if (bytesRead === 0) break;
      chunks.push(chunk.subarray(0, bytesRead));
      size += bytesRead;
    }
    if (size > maxBytes) throw new Error('JSON file is too large');
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8'));
  } finally {
    await handle.close();
  }
}

function isWithinDirectory(directory, target) {
  const relative = path.relative(directory, target);
  return relative === ''
    || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function canonicalizeTrustedDirectoryPrefix(target) {
  const absoluteTarget = path.resolve(target);
  const trustedDirectories = [...new Set([os.homedir(), os.tmpdir()].map((directory) => (
    path.resolve(directory)
  )))].sort((left, right) => right.length - left.length);
  for (const trustedDirectory of trustedDirectories) {
    if (!isWithinDirectory(trustedDirectory, absoluteTarget)) continue;
    try {
      const canonicalDirectory = await fs.realpath(trustedDirectory);
      return path.resolve(canonicalDirectory, path.relative(trustedDirectory, absoluteTarget));
    } catch {
      // Fall back to validating the absolute path from its filesystem root.
    }
  }
  return target;
}

function assertSafeDirectory(metadata) {
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('unsafe cache directory');
  }
}

class CachePathChangedError extends Error {}
class CacheOperationRaceError extends Error {}
class OperationFencedError extends Error {}

const preparedCacheDirectories = new Map();

function invalidateCacheToken(token, message, cause) {
  token.trusted = false;
  if (cause instanceof CachePathChangedError) return cause;
  const error = new CachePathChangedError(message);
  if (cause) error.cause = cause;
  return error;
}

async function verifyDirectorySnapshots(token, snapshots, description) {
  if (!token.trusted) throw new CachePathChangedError('cache directory is no longer trusted');
  try {
    for (const snapshot of snapshots) {
      const metadata = await fs.lstat(snapshot.directory, { bigint: true });
      assertSafeDirectory(metadata);
      if (!isSameFile(snapshot.metadata, metadata)) {
        throw new Error(`${description} changed`);
      }
    }
  } catch (error) {
    throw invalidateCacheToken(token, `${description} changed`, error);
  }
}

async function verifyCacheToken(token) {
  await verifyDirectorySnapshots(token, token.ancestorSnapshots, 'cache directory');
}

async function guardedCacheRead(token, read) {
  await verifyCacheToken(token);
  let result;
  try {
    result = await read();
  } catch (error) {
    await verifyCacheToken(token);
    throw error;
  }
  await verifyCacheToken(token);
  return result;
}

function cacheTokenFor(cacheDirectory) {
  const token = preparedCacheDirectories.get(path.resolve(cacheDirectory));
  if (!token || !token.trusted) {
    throw new CachePathChangedError('cache directory has not been prepared safely');
  }
  return token;
}

function resolveCacheTarget(token, target) {
  const resolved = path.resolve(target);
  if (resolved === token.directory || !isWithinDirectory(token.directory, resolved)) {
    throw invalidateCacheToken(token, 'cache mutation escaped its prepared directory');
  }
  return resolved;
}

async function captureMutationParentSnapshots(token, targets) {
  await verifyCacheToken(token);
  const snapshots = new Map();
  try {
    for (const target of targets) {
      const parent = path.dirname(resolveCacheTarget(token, target));
      const relative = path.relative(token.directory, parent);
      let current = token.directory;
      for (const component of relative.split(path.sep).filter(Boolean)) {
        current = path.join(current, component);
        if (snapshots.has(current)) continue;
        const metadata = await fs.lstat(current, { bigint: true });
        assertSafeDirectory(metadata);
        snapshots.set(current, { directory: current, metadata });
      }
    }
  } catch (error) {
    throw invalidateCacheToken(token, 'cache mutation parent changed', error);
  }
  const captured = [...snapshots.values()];
  await verifyMutationParentSnapshots(token, captured);
  await verifyCacheToken(token);
  return captured;
}

async function verifyMutationParentSnapshots(token, snapshots) {
  try {
    for (const snapshot of snapshots) {
      const metadata = await fs.lstat(snapshot.directory, { bigint: true });
      assertSafeDirectory(metadata);
      if (!isSameFile(snapshot.metadata, metadata)) {
        throw new Error('cache mutation parent changed');
      }
    }
  } catch (error) {
    const raced = new CacheOperationRaceError('cache mutation parent changed');
    raced.cause = error;
    throw raced;
  }
}

async function verifyMutationContext(token, parentSnapshots) {
  await verifyCacheToken(token);
  await verifyMutationParentSnapshots(token, parentSnapshots);
  await verifyCacheToken(token);
}

function assertSafeCacheEntry(metadata) {
  if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
    throw new Error('unsafe cache entry');
  }
}

function assertSafeRegularFile(metadata) {
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('unsafe cache file');
  }
}

function assertRenameableCacheEntry(metadata) {
  if (!metadata.isDirectory() && !metadata.isFile() && !metadata.isSymbolicLink()) {
    throw new Error('unsafe cache rename entry');
  }
}

async function stableCacheEntry(
  token,
  target,
  validate,
  expectedMetadata = null,
  missingIsOperationRace = false,
) {
  const resolved = resolveCacheTarget(token, target);
  try {
    const first = await fs.lstat(resolved, { bigint: true });
    validate(first);
    if (expectedMetadata && !isSameFile(expectedMetadata, first)) {
      throw new Error('cache entry identity changed');
    }
    await verifyCacheToken(token);
    const second = await fs.lstat(resolved, { bigint: true });
    validate(second);
    if (!isSameFile(first, second)
      || (expectedMetadata && !isSameFile(expectedMetadata, second))) {
      throw new Error('cache entry identity changed');
    }
    return second;
  } catch (error) {
    if (missingIsOperationRace && error?.code === 'ENOENT') {
      await verifyCacheToken(token);
      throw error;
    }
    throw invalidateCacheToken(token, 'cache mutation produced an untrusted object', error);
  }
}

async function guardedCacheEntryRead(
  token,
  target,
  validate,
  read,
  expectedMetadata = null,
) {
  const metadata = await stableCacheEntry(
    token,
    target,
    validate,
    expectedMetadata,
    true,
  );
  let result;
  try {
    result = await read(metadata);
  } catch (error) {
    await stableCacheEntry(token, target, validate, metadata, true);
    throw error;
  }
  await stableCacheEntry(token, target, validate, metadata, true);
  return result;
}

async function stablePreparedDirectory(token, target) {
  try {
    const first = await fs.lstat(target, { bigint: true });
    assertSafeDirectory(first);
    await verifyCacheToken(token);
    const second = await fs.lstat(target, { bigint: true });
    assertSafeDirectory(second);
    if (!isSameFile(first, second)) throw new Error('prepared directory identity changed');
    return second;
  } catch (error) {
    throw invalidateCacheToken(token, 'prepared directory could not be verified', error);
  }
}

async function assertCacheTargetAbsent(token, target) {
  const resolved = resolveCacheTarget(token, target);
  try {
    await fs.lstat(resolved, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw invalidateCacheToken(token, 'cache mutation target could not be verified', error);
  }
  throw invalidateCacheToken(token, 'cache mutation left an unexpected object');
}

async function guardedCacheMutation(token, parentSnapshots, {
  mutate,
  verifyBefore = null,
  verifyAfter,
}) {
  await verifyMutationContext(token, parentSnapshots);
  if (verifyBefore) await verifyBefore();
  let result;
  try {
    result = await mutate();
  } catch (error) {
    await verifyMutationContext(token, parentSnapshots);
    throw error;
  }
  try {
    await verifyMutationContext(token, parentSnapshots);
    const verified = await verifyAfter(result);
    await verifyMutationContext(token, parentSnapshots);
    return verified ?? result;
  } catch (error) {
    if (error instanceof CacheOperationRaceError) throw error;
    throw invalidateCacheToken(token, 'cache mutation could not be verified', error);
  }
}

async function cacheMkdirWithToken(token, target, options, parentSnapshots = null) {
  const resolved = path.resolve(target);
  const parents = parentSnapshots ?? await captureMutationParentSnapshots(token, [resolved]);
  return guardedCacheMutation(token, parents, {
    mutate: () => fs.mkdir(resolved, options),
    verifyAfter: () => (parentSnapshots === null
      ? stableCacheEntry(token, resolved, assertSafeDirectory)
      : stablePreparedDirectory(token, resolved)),
  });
}

async function cacheMkdir(cacheDirectory, target, options) {
  return cacheMkdirWithToken(cacheTokenFor(cacheDirectory), target, options);
}

async function cacheWriteFile(cacheDirectory, target, data, options) {
  if (options?.flag !== 'wx') {
    throw new Error('cache files must be created exclusively');
  }
  const token = cacheTokenFor(cacheDirectory);
  const resolved = resolveCacheTarget(token, target);
  const parents = await captureMutationParentSnapshots(token, [resolved]);
  return guardedCacheMutation(token, parents, {
    mutate: async () => {
      const flags = fsConstants.O_WRONLY
        | fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | (fsConstants.O_NOFOLLOW ?? 0);
      const handle = await fs.open(resolved, flags, options.mode);
      try {
        const openedMetadata = await handle.stat({ bigint: true });
        if (!openedMetadata.isFile() || openedMetadata.isSymbolicLink()) {
          throw new Error('cache write did not open a regular file');
        }
        await handle.writeFile(data, options.encoding ? { encoding: options.encoding } : undefined);
        const writtenMetadata = await handle.stat({ bigint: true });
        const expectedBytes = Buffer.isBuffer(data)
          ? data.length
          : Buffer.byteLength(data, options.encoding || 'utf8');
        if (!isSameFile(openedMetadata, writtenMetadata)
          || writtenMetadata.size !== BigInt(expectedBytes)) {
          throw new Error('cache write did not preserve the opened file identity and size');
        }
        return writtenMetadata;
      } finally {
        await handle.close();
      }
    },
    verifyAfter: (writtenMetadata) => stableCacheEntry(token, resolved, (metadata) => {
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error('cache write did not create a regular file');
      }
    }, writtenMetadata),
  });
}

async function cacheRename(
  cacheDirectory,
  source,
  destination,
  validate,
  expectedSourceMetadata = null,
) {
  if (typeof validate !== 'function') {
    throw new TypeError('cache rename requires an explicit entry validator');
  }
  const token = cacheTokenFor(cacheDirectory);
  const resolvedSource = resolveCacheTarget(token, source);
  const resolvedDestination = resolveCacheTarget(token, destination);
  const parents = await captureMutationParentSnapshots(
    token,
    [resolvedSource, resolvedDestination],
  );
  const sourceMetadata = await stableCacheEntry(
    token,
    resolvedSource,
    validate,
    expectedSourceMetadata,
    true,
  );
  return guardedCacheMutation(token, parents, {
    verifyBefore: () => stableCacheEntry(
      token,
      resolvedSource,
      validate,
      sourceMetadata,
      true,
    ),
    mutate: () => fs.rename(resolvedSource, resolvedDestination),
    verifyAfter: async () => {
      await assertCacheTargetAbsent(token, resolvedSource);
      return stableCacheEntry(
        token,
        resolvedDestination,
        validate,
        sourceMetadata,
      );
    },
  });
}

async function cacheRm(cacheDirectory, target, options) {
  if (options?.recursive) {
    throw new Error('recursive cache removal is not allowed');
  }
  const token = cacheTokenFor(cacheDirectory);
  const resolved = resolveCacheTarget(token, target);
  const parents = await captureMutationParentSnapshots(token, [resolved]);
  let initialMetadata;
  try {
    initialMetadata = await fs.lstat(resolved, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT' && options?.force) {
      await verifyMutationContext(token, parents);
      return;
    }
    throw error;
  }
  try {
    assertSafeCacheEntry(initialMetadata);
  } catch (error) {
    throw invalidateCacheToken(token, 'cache removal target is unsafe', error);
  }
  const targetMetadata = await stableCacheEntry(
    token,
    resolved,
    assertSafeCacheEntry,
    initialMetadata,
  );
  return guardedCacheMutation(token, parents, {
    verifyBefore: () => stableCacheEntry(
      token,
      resolved,
      assertSafeCacheEntry,
      targetMetadata,
    ),
    mutate: () => fs.rm(resolved, options),
    verifyAfter: () => assertCacheTargetAbsent(token, resolved),
  });
}

async function prepareCacheDirectory(cacheDirectory) {
  const absoluteTarget = path.resolve(cacheDirectory);
  const target = await canonicalizeTrustedDirectoryPrefix(absoluteTarget);
  const parsed = path.parse(target);
  const components = target.slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  const token = {
    directory: target,
    ancestorSnapshots: [],
    trusted: true,
  };

  for (const component of components) {
    current = path.join(current, component);
    let metadata;
    try {
      metadata = await fs.lstat(current, { bigint: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      try {
        await cacheMkdirWithToken(token, current, { mode: 0o700 }, []);
      } catch (mkdirError) {
        if (mkdirError?.code !== 'EEXIST') throw mkdirError;
      }
      metadata = await fs.lstat(current, { bigint: true });
    }
    assertSafeDirectory(metadata);
    token.ancestorSnapshots.push({ directory: current, metadata });
  }

  await verifyCacheToken(token);
  preparedCacheDirectories.set(target, token);
  return target;
}

function operationName(kind, generation) {
  return `${kind}-${generation.toString().padStart(20, '0')}`;
}

function parseOperationName(name) {
  const match = OPERATION_NAME.exec(name);
  if (!match) return null;
  return { kind: match[1], generation: BigInt(match[2]) };
}

async function listOperations(cacheDirectory, token = cacheTokenFor(cacheDirectory)) {
  return guardedCacheRead(token, async () => {
    try {
      const entries = await fs.readdir(cacheDirectory, { withFileTypes: true });
      return entries.flatMap((entry) => {
        const parsed = parseOperationName(entry.name);
        if (!parsed) return [];
        if (!entry.isDirectory() || entry.isSymbolicLink()) {
          throw invalidateCacheToken(
            token,
            `cache operation ${entry.name} is not a safe directory`,
          );
        }
        return [{ ...parsed, name: entry.name, directory: path.join(cacheDirectory, entry.name) }];
      });
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  });
}

async function readState(cacheDirectory, installedVersion = null) {
  const token = cacheTokenFor(cacheDirectory);
  return guardedCacheRead(token, async () => {
    const operations = (await listOperations(cacheDirectory, token))
      .filter((operation) => operation.kind === 'committed')
      .sort((left, right) => (left.generation > right.generation ? -1 : 1));
    for (const operation of operations) {
      try {
        const state = await guardedCacheEntryRead(
          token,
          operation.directory,
          assertSafeDirectory,
          async () => normalizeState(
            await readJsonFile(
              path.join(operation.directory, OPERATION_STATE_FILE),
              MAX_CACHE_STATE_BYTES,
            ),
            installedVersion,
          ),
        );
        if (state) return state;
      } catch (error) {
        if (error instanceof FileIdentityChangedError
          || error instanceof CachePathChangedError
          || error instanceof CacheOperationRaceError) throw error;
        // An incomplete or corrupt generation is ignored in favor of the previous commit.
      }
    }
    return emptyState(installedVersion);
  });
}

async function operationIsActive(
  cacheDirectory,
  operation,
  token = cacheTokenFor(cacheDirectory),
) {
  try {
    return await guardedCacheEntryRead(
      token,
      operation.directory,
      assertSafeDirectory,
      async (directoryMetadata) => {
        try {
          const ownerMetadata = await fs.lstat(
            path.join(operation.directory, OPERATION_OWNER_FILE),
            { bigint: true },
          );
          if (!ownerMetadata.isFile() || ownerMetadata.isSymbolicLink()) return false;
          return metadataIsWithinLease(ownerMetadata);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
          return metadataIsWithinLease(directoryMetadata);
        }
      },
    );
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function validateClaimOwner(value) {
  if (!isPlainObject(value)
    || !hasOnlyKeys(value, new Set(['pid', 'token', 'generation']))
    || !Number.isSafeInteger(value.pid)
    || value.pid <= 0
    || typeof value.token !== 'string'
    || !/^[a-f0-9]{32}$/.test(value.token)
    || typeof value.generation !== 'string'
    || !/^[1-9]\d*$/.test(value.generation)) return null;
  return { ...value, generation: BigInt(value.generation) };
}

function metadataIsWithinLease(metadata) {
  if (typeof metadata.mtimeNs === 'bigint') {
    const ageNs = (BigInt(Date.now()) * 1_000_000n) - metadata.mtimeNs;
    const absoluteAgeNs = ageNs < 0n ? -ageNs : ageNs;
    return absoluteAgeNs <= BigInt(LOCK_STALE_MS) * 1_000_000n;
  }
  return Math.abs(Date.now() - metadata.mtimeMs) <= LOCK_STALE_MS;
}

function corruptClaimStatus(directory, directoryMetadata, ownerMetadata = directoryMetadata) {
  if (metadataIsWithinLease(ownerMetadata)) {
    return { state: 'busy', directory, metadata: directoryMetadata, owner: null };
  }
  const fingerprint = crypto.createHash('sha256')
    .update(JSON.stringify({
      directory: {
        dev: directoryMetadata.dev.toString(),
        ino: directoryMetadata.ino.toString(),
        mode: directoryMetadata.mode.toString(),
        birthtimeNs: directoryMetadata.birthtimeNs.toString(),
      },
    }))
    .digest('hex')
    .slice(0, 24);
  return {
    state: 'releasable',
    directory,
    metadata: directoryMetadata,
    key: `corrupt-${fingerprint}`,
    owner: null,
  };
}

async function inspectActiveClaim(cacheDirectory) {
  const token = cacheTokenFor(cacheDirectory);
  return guardedCacheRead(token, async () => {
    const directory = path.join(cacheDirectory, ACTIVE_CLAIM_DIRECTORY);
    let directoryMetadata;
    try {
      directoryMetadata = await fs.lstat(directory, { bigint: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return { state: 'absent', directory };
      throw error;
    }
    if (!directoryMetadata.isDirectory() || directoryMetadata.isSymbolicLink()) {
      return corruptClaimStatus(directory, directoryMetadata);
    }
    return guardedCacheEntryRead(
      token,
      directory,
      assertSafeDirectory,
      async (stableDirectoryMetadata) => {
        const ownerPath = path.join(directory, OPERATION_OWNER_FILE);
        let ownerMetadata = stableDirectoryMetadata;
        let owner = null;
        try {
          ownerMetadata = await fs.lstat(ownerPath, { bigint: true });
          if (!ownerMetadata.isFile()
            || ownerMetadata.isSymbolicLink()
            || ownerMetadata.size > BigInt(MAX_CLAIM_OWNER_BYTES)) {
            return corruptClaimStatus(directory, stableDirectoryMetadata, ownerMetadata);
          }
          const ownerSource = await readJsonFile(
            ownerPath,
            MAX_CLAIM_OWNER_BYTES,
            ownerMetadata,
          );
          owner = validateClaimOwner(ownerSource);
        } catch (error) {
          if (error instanceof FileIdentityChangedError) throw error;
          // A malformed claim is recoverable only after the same hard lease as a crashed owner.
        }

        if (owner) {
          const operations = await listOperations(cacheDirectory, token);
          if (operations.some((operation) => operation.generation === owner.generation
            && ['committed', 'fenced', 'cancelled'].includes(operation.kind))) {
            return {
              state: 'releasable',
              directory,
              metadata: stableDirectoryMetadata,
              key: owner.generation.toString(),
              owner,
            };
          }
          const pending = operations.find((operation) => operation.kind === 'pending'
            && operation.generation === owner.generation);
          if (pending) {
            if (await operationIsActive(cacheDirectory, pending, token)) {
              return {
                state: 'busy',
                directory,
                metadata: stableDirectoryMetadata,
                owner,
              };
            }
            return {
              state: 'releasable',
              directory,
              metadata: stableDirectoryMetadata,
              key: owner.generation.toString(),
              owner,
            };
          }
        }

        return corruptClaimStatus(directory, stableDirectoryMetadata, ownerMetadata);
      },
      directoryMetadata,
    );
  });
}

async function retireActiveClaim(cacheDirectory, claim) {
  const retirement = path.join(cacheDirectory, `retired-claim-${claim.key}`);
  await cacheMkdir(cacheDirectory, retirement, { mode: 0o700 }).catch((error) => {
    if (error?.code !== 'EEXIST') throw error;
  });
  try {
    const retirementMetadata = await fs.lstat(retirement);
    if (!retirementMetadata.isDirectory() || retirementMetadata.isSymbolicLink()) return false;
  } catch (error) {
    if (error instanceof CacheOperationRaceError) return false;
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  try {
    const metadata = await fs.lstat(claim.directory);
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) {
      await cacheWriteFile(
        cacheDirectory,
        path.join(claim.directory, '.retirement-guard'),
        `${claim.key}\n`,
        { encoding: 'utf8', flag: 'wx', mode: 0o600 },
      ).catch((error) => {
        if (error?.code !== 'EEXIST') throw error;
      });
    }
  } catch (error) {
    if (error instanceof CacheOperationRaceError) return false;
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  try {
    await cacheRename(
      cacheDirectory,
      claim.directory,
      path.join(retirement, 'active'),
      assertRenameableCacheEntry,
      claim.metadata,
    );
    return true;
  } catch (error) {
    if (error instanceof CacheOperationRaceError) return false;
    if (['ENOENT', 'EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error?.code)) return false;
    throw error;
  }
}

async function prepareOperationClaim(cacheDirectory, operation) {
  const directory = path.join(cacheDirectory, operationName('claim', operation.generation));
  await cacheMkdir(cacheDirectory, directory, { mode: 0o700 });
  await cacheWriteFile(
    cacheDirectory,
    path.join(directory, OPERATION_OWNER_FILE),
    `${JSON.stringify({
      pid: process.pid,
      token: operation.token,
      generation: operation.generation.toString(),
    })}\n`,
    { encoding: 'utf8', flag: 'wx', mode: 0o600 },
  );
  operation.preparedClaimDirectory = directory;
}

async function discardPreparedClaim(cacheDirectory, operation) {
  if (!operation.preparedClaimDirectory) return;
  const discarded = path.join(
    cacheDirectory,
    `discarded-claim-${operation.generation.toString().padStart(20, '0')}-${operation.token}`,
  );
  try {
    await cacheRename(
      cacheDirectory,
      operation.preparedClaimDirectory,
      discarded,
      assertSafeDirectory,
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  delete operation.preparedClaimDirectory;
}

async function promoteOperationClaim(cacheDirectory, operation) {
  await prepareOperationClaim(cacheDirectory, operation);
  const activeDirectory = path.join(cacheDirectory, ACTIVE_CLAIM_DIRECTORY);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (await operationIsSuperseded(cacheDirectory, operation)) {
      await discardPreparedClaim(cacheDirectory, operation);
      return false;
    }
    const active = await inspectActiveClaim(cacheDirectory);
    if (active.state === 'busy') {
      await discardPreparedClaim(cacheDirectory, operation);
      return false;
    }
    if (active.state === 'releasable') {
      if (active.owner?.generation > operation.generation) {
        await discardPreparedClaim(cacheDirectory, operation);
        return false;
      }
      await retireActiveClaim(cacheDirectory, active);
      continue;
    }
    try {
      await cacheRename(
        cacheDirectory,
        operation.preparedClaimDirectory,
        activeDirectory,
        assertSafeDirectory,
      );
      delete operation.preparedClaimDirectory;
      if (!await operationIsActive(cacheDirectory, operation)) return false;
      return true;
    } catch (promotionError) {
      const raced = await inspectActiveClaim(cacheDirectory);
      if (raced.state === 'absent') {
        if (['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(promotionError?.code)) continue;
        await discardPreparedClaim(cacheDirectory, operation);
        throw promotionError;
      }
      continue;
    }
  }
  await discardPreparedClaim(cacheDirectory, operation);
  return false;
}

async function operationOwnsActiveClaim(cacheDirectory, operation) {
  const active = await inspectActiveClaim(cacheDirectory);
  return active.state === 'busy'
    && active.owner?.generation === operation.generation
    && active.owner.token === operation.token;
}

async function hasActivePendingOperation(cacheDirectory) {
  const token = cacheTokenFor(cacheDirectory);
  return guardedCacheRead(token, async () => {
    const pending = (await listOperations(cacheDirectory, token))
      .filter((operation) => operation.kind === 'pending');
    return (await Promise.all(pending.map(
      (operation) => operationIsActive(cacheDirectory, operation, token),
    ))).some(Boolean);
  });
}

async function reserveOperation(cacheDirectory) {
  cacheDirectory = await prepareCacheDirectory(cacheDirectory);
  const operations = await listOperations(cacheDirectory);
  const occupied = new Set(operations.map((operation) => operation.generation.toString()));
  let generation = 1n;
  while (true) {
    while (occupied.has(generation.toString())) generation += 1n;
    if (generation > MAX_OPERATION_GENERATION) throw new Error('operation generation space exhausted');
    const reservation = path.join(cacheDirectory, operationName('reserved', generation));
    try {
      await cacheMkdir(cacheDirectory, reservation, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      occupied.add(generation.toString());
      generation += 1n;
      continue;
    }
    const directory = path.join(cacheDirectory, operationName('pending', generation));
    try {
      await cacheMkdir(cacheDirectory, directory, { mode: 0o700 });
      const operation = {
        generation,
        token: crypto.randomBytes(16).toString('hex'),
        directory,
      };
      try {
        await cacheWriteFile(
          cacheDirectory,
          path.join(directory, OPERATION_OWNER_FILE),
          `${JSON.stringify({ pid: process.pid, token: operation.token })}\n`,
          { encoding: 'utf8', flag: 'wx', mode: 0o600 },
        );
      } catch (error) {
        if (await operationWasFenced(cacheDirectory, operation)) {
          const fencedError = new OperationFencedError('operation was fenced while reserving');
          fencedError.cause = error;
          throw fencedError;
        }
        await cacheRename(
          cacheDirectory,
          directory,
          path.join(cacheDirectory, operationName('cancelled', generation)),
          assertSafeDirectory,
        ).catch(() => {});
        throw error;
      }
      return operation;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      occupied.add(generation.toString());
      generation += 1n;
    }
  }
}

async function operationIsSuperseded(cacheDirectory, operation) {
  return (await listOperations(cacheDirectory))
    .some((candidate) => candidate.generation > operation.generation);
}

async function operationWasFenced(cacheDirectory, operation) {
  const token = cacheTokenFor(cacheDirectory);
  return guardedCacheRead(token, async () => {
    try {
      await fs.lstat(operation.directory, { bigint: true });
      return false;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const fencedDirectory = path.join(
      cacheDirectory,
      operationName('fenced', operation.generation),
    );
    try {
      await stableCacheEntry(
        token,
        fencedDirectory,
        assertSafeDirectory,
        null,
        true,
      );
      return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  });
}

async function transitionOperation(cacheDirectory, operation, kind) {
  const destination = path.join(cacheDirectory, operationName(kind, operation.generation));
  await cacheRename(cacheDirectory, operation.directory, destination, assertSafeDirectory);
}

async function cancelOperation(cacheDirectory, operation) {
  try {
    await transitionOperation(cacheDirectory, operation, 'cancelled');
  } catch (error) {
    // A higher generation may already have fenced this unique pending directory.
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function acquireOperation(cacheDirectory) {
  cacheDirectory = await prepareCacheDirectory(cacheDirectory);
  if ((await inspectActiveClaim(cacheDirectory)).state === 'busy') return null;
  if (await hasActivePendingOperation(cacheDirectory)) return null;
  let operation;
  try {
    operation = await reserveOperation(cacheDirectory);
  } catch (error) {
    if (error instanceof OperationFencedError) return null;
    throw error;
  }
  if (!await operationIsSuperseded(cacheDirectory, operation)
    && await promoteOperationClaim(cacheDirectory, operation)) return operation;
  await cancelOperation(cacheDirectory, operation);
  return null;
}

async function fenceLowerOperations(cacheDirectory, operation) {
  const lower = (await listOperations(cacheDirectory))
    .filter((candidate) => candidate.kind === 'pending'
      && candidate.generation < operation.generation)
    .sort((left, right) => (left.generation < right.generation ? -1 : 1));
  for (const candidate of lower) {
    try {
      await cacheRename(
        cacheDirectory,
        candidate.directory,
        path.join(cacheDirectory, operationName('fenced', candidate.generation)),
        assertSafeDirectory,
      );
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

async function commitOperation(cacheDirectory, operation, installedVersion, mutate) {
  if (!await operationOwnsActiveClaim(cacheDirectory, operation)) {
    await cancelOperation(cacheDirectory, operation);
    return { fenced: true, result: silent('check-in-progress') };
  }
  await fenceLowerOperations(cacheDirectory, operation);
  if (!await operationOwnsActiveClaim(cacheDirectory, operation)) {
    await cancelOperation(cacheDirectory, operation);
    return { fenced: true, result: silent('check-in-progress') };
  }
  const state = await readState(cacheDirectory, installedVersion);
  const decision = mutate(state);
  if (!decision.state) {
    await cancelOperation(cacheDirectory, operation);
    return { fenced: false, result: decision.result };
  }
  let committedState = decision.state;
  let committedResult = decision.result;
  let encodedState = encodeRecoverableState(committedState);
  if (!encodedState && decision.capacityFallback) {
    committedState = decision.capacityFallback.state;
    committedResult = decision.capacityFallback.result;
    encodedState = encodeRecoverableState(committedState);
  }
  if (!encodedState) {
    await cancelOperation(cacheDirectory, operation);
    return { fenced: false, result: silent('cache-unavailable') };
  }
  const temporary = path.join(
    operation.directory,
    `.state.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
  );
  try {
    await cacheWriteFile(cacheDirectory, temporary, encodedState, {
      flag: 'wx',
      mode: 0o600,
    });
    await cacheRename(
      cacheDirectory,
      temporary,
      path.join(operation.directory, OPERATION_STATE_FILE),
      assertSafeRegularFile,
    );
    await transitionOperation(cacheDirectory, operation, 'committed');
    return { fenced: false, result: committedResult };
  } catch (error) {
    if (await operationWasFenced(cacheDirectory, operation)) {
      return { fenced: true, result: silent('check-in-progress') };
    }
    await cacheRm(cacheDirectory, temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function nextSuccessfulCheck(nowMs, random) {
  const boundedRandom = Math.min(1, Math.max(0, Number(random()) || 0));
  const multiplier = 0.8 + (boundedRandom * 0.4);
  return new Date(nowMs + Math.round(CHECK_TTL_MS * multiplier)).toISOString();
}

function nextFailedCheck(nowMs, failures) {
  const delay = failures <= 1 ? FIRST_FAILURE_DELAY_MS : LATER_FAILURE_DELAY_MS;
  return new Date(nowMs + delay).toISOString();
}

function stateAfterFailedCheck(state, nowMs, withdrawCandidate = false) {
  const failures = Math.min(state.check.consecutiveFailures + 1, 2);
  return stateWithFailureCheck(
    state,
    nextFailedCheck(nowMs, failures),
    failures,
    withdrawCandidate,
  );
}

function eventKeyForDigest(targetDigest) {
  return `${SKILL_ID}@${targetDigest}`;
}

function digestForEventKey(eventKey) {
  const prefix = `${SKILL_ID}@`;
  if (typeof eventKey !== 'string' || !eventKey.startsWith(prefix)) return null;
  const digest = eventKey.slice(prefix.length);
  return DIGEST_PATTERN.test(digest) ? digest : null;
}

function notification(localRelease, candidate) {
  return {
    status: 'update_available',
    eventKey: eventKeyForDigest(candidate.targetDigest),
    installedVersion: localRelease.version,
    latestVersion: candidate.version,
    targetDigest: candidate.targetDigest,
    severity: candidate.severity,
    summary: `Archify ${candidate.version} is available; see the official release notes for details.`,
    releaseNotes: candidate.releaseNotes,
  };
}

function resultForCandidate(localRelease, state) {
  if (!state.candidate) return silent('cache-valid');
  const comparison = compareSemver(state.candidate.version, localRelease.version);
  if (comparison <= 0) return silent('current');
  if (state.notification.acknowledgedDigests.includes(state.candidate.targetDigest)) {
    return silent('already-notified');
  }
  return notification(localRelease, state.candidate);
}

async function readBoundedBody(response) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    await cancelResponseBody(response);
    throw new UpdateContractError('manifest response is too large');
  }
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw new UpdateContractError('manifest response has no bounded stream');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new UpdateContractError('manifest response is too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(joined);
  } catch {
    throw new UpdateContractError('manifest is not valid UTF-8');
  }
}

async function cancelResponseBody(response) {
  try {
    if (response.body && typeof response.body.cancel === 'function') {
      await response.body.cancel();
    }
  } catch {
    // Network cleanup is best-effort; the original response classification wins.
  }
}

async function fetchCandidate({ fetchImpl, manifestUrl, timeoutMs }) {
  if (manifestUrl !== DEFAULT_MANIFEST_URL) throw new UpdateContractError('unexpected manifest URL');
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('update check timed out'));
    }, timeoutMs);
  });
  const request = (async () => {
    const headers = { accept: 'application/json' };
    const response = await fetchImpl(manifestUrl, {
      method: 'GET',
      headers,
      redirect: 'error',
      signal: controller.signal,
    });
    if (response.status !== 200) {
      await cancelResponseBody(response);
      throw new Error(`manifest returned HTTP ${response.status}`);
    }
    const mediaType = response.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (mediaType !== 'application/json') {
      await cancelResponseBody(response);
      throw new UpdateContractError('manifest is not JSON');
    }
    const source = await readBoundedBody(response);
    let decoded;
    try {
      decoded = JSON.parse(source);
    } catch {
      throw new UpdateContractError('manifest is not valid bounded JSON');
    }
    return { candidate: validateManifest(decoded) };
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function defaultCacheDirectory() {
  const homeDirectory = os.homedir();
  if (process.platform === 'win32') {
    const localData = process.env.LOCALAPPDATA;
    return path.join(localData && path.isAbsolute(localData) ? localData : path.join(homeDirectory, 'AppData', 'Local'), 'archify-skill');
  }
  if (process.platform === 'darwin') return path.join(homeDirectory, 'Library', 'Caches', 'archify-skill');
  const xdgCache = process.env.XDG_CACHE_HOME;
  return path.join(xdgCache && path.isAbsolute(xdgCache) ? xdgCache : path.join(homeDirectory, '.cache'), 'archify-skill');
}

function freshStateResult(localRelease, state, nowMs) {
  const nextCheckAt = Date.parse(state.check.nextCheckAt || '');
  if (Number.isFinite(nextCheckAt) && nextCheckAt > nowMs
    && nextCheckAt <= nowMs + MAX_CACHE_HORIZON_MS) {
    return resultForCandidate(localRelease, state);
  }
  return null;
}

async function resultAfterLosingOperation(cacheDirectory, operation, localRelease) {
  await cancelOperation(cacheDirectory, operation);
  const cached = await readState(cacheDirectory, localRelease.version);
  if (cached.candidate
    && cached.notification.offeredDigests.includes(cached.candidate.targetDigest)) {
    return resultForCandidate(localRelease, cached);
  }
  return silent('check-in-progress');
}

async function waitUntilRetry(deadline, monotonicNow) {
  let remaining;
  try {
    remaining = deadline - Number(monotonicNow());
  } catch {
    return false;
  }
  if (!Number.isFinite(remaining) || remaining <= 0) return false;
  await new Promise((resolve) => setTimeout(
    resolve,
    Math.min(LOCK_RETRY_DELAY_MS, remaining),
  ));
  return true;
}

export async function checkForUpdate({
  releasePath = defaultReleasePath,
  cacheDirectory = defaultCacheDirectory(),
  fetchImpl = globalThis.fetch,
  now = Date.now,
  random = Math.random,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') return silent('runtime-unavailable');
  let localRelease;
  try {
    localRelease = validateLocalRelease(await readJsonFile(releasePath, MAX_LOCAL_RELEASE_BYTES));
  } catch {
    return silent('invalid-local-release');
  }

  const nowMs = Number(now());
  if (!Number.isFinite(nowMs)) return silent('invalid-clock');
  let stateDirectory = versionCacheDirectory(cacheDirectory, localRelease.version);
  let state;
  try {
    stateDirectory = await prepareCacheDirectory(stateDirectory);
    state = await readState(stateDirectory, localRelease.version);
  } catch {
    return silent('cache-unavailable');
  }
  const cachedResult = freshStateResult(localRelease, state, nowMs);
  if (cachedResult) return cachedResult;

  let operation;
  try {
    operation = await acquireOperation(stateDirectory);
  } catch {
    return silent('cache-unavailable');
  }
  if (!operation) {
    try {
      const cached = await readState(stateDirectory, localRelease.version);
      if (cached.candidate
        && cached.notification.offeredDigests.includes(cached.candidate.targetDigest)) {
        return resultForCandidate(localRelease, cached);
      }
    } catch {
      return silent('cache-unavailable');
    }
    return silent('check-in-progress');
  }

  try {
    state = await readState(stateDirectory, localRelease.version);
    const racedResult = freshStateResult(localRelease, state, nowMs);
    if (racedResult) {
      await cancelOperation(stateDirectory, operation);
      return racedResult;
    }

    if (!await operationOwnsActiveClaim(stateDirectory, operation)) {
      return await resultAfterLosingOperation(stateDirectory, operation, localRelease);
    }

    await verifyCacheToken(cacheTokenFor(stateDirectory));
    if (!await operationOwnsActiveClaim(stateDirectory, operation)) {
      return await resultAfterLosingOperation(stateDirectory, operation, localRelease);
    }
    let fetched;
    try {
      fetched = await fetchCandidate({
        fetchImpl,
        manifestUrl: localRelease.updateManifestUrl,
        timeoutMs,
      });
    } catch (error) {
      const reason = error instanceof UpdateContractError ? 'invalid-manifest' : 'check-failed';
      try {
        const committed = await commitOperation(
          stateDirectory,
          operation,
          localRelease.version,
          (current) => ({
            state: stateAfterFailedCheck(current, nowMs),
            result: silent(reason),
          }),
        );
        return committed.result;
      } catch {
        await cancelOperation(stateDirectory, operation).catch(() => {});
        return silent('cache-unavailable');
      }
    }

    try {
      const committed = await commitOperation(
        stateDirectory,
        operation,
        localRelease.version,
        (current) => {
          const next = {
            ...current,
            candidate: fetched.candidate,
            check: {
              nextCheckAt: nextSuccessfulCheck(nowMs, random),
              consecutiveFailures: 0,
            },
            notification: {
              offeredDigests: [...current.notification.offeredDigests],
              acknowledgedDigests: [...current.notification.acknowledgedDigests],
            },
          };
          const result = resultForCandidate(localRelease, next);
          if (result.status === 'update_available') {
            if (!next.notification.offeredDigests.includes(next.candidate.targetDigest)) {
              next.notification.offeredDigests.push(next.candidate.targetDigest);
            }
          }
          return {
            state: next,
            result,
            capacityFallback: {
              state: stateAfterFailedCheck(current, nowMs, true),
              result: silent('cache-unavailable'),
            },
          };
        },
      );
      return committed.result;
    } catch {
      await cancelOperation(stateDirectory, operation).catch(() => {});
      return silent('cache-unavailable');
    }
  } catch {
    await cancelOperation(stateDirectory, operation).catch(() => {});
    return silent('cache-unavailable');
  }
}

export async function acknowledgeUpdate({
  releasePath = defaultReleasePath,
  cacheDirectory = defaultCacheDirectory(),
  eventKey,
  monotonicNow = () => performance.now(),
} = {}) {
  const targetDigest = digestForEventKey(eventKey);
  if (!targetDigest || typeof monotonicNow !== 'function') {
    return silent('invalid-acknowledgement');
  }
  let localRelease;
  try {
    localRelease = validateLocalRelease(await readJsonFile(releasePath, MAX_LOCAL_RELEASE_BYTES));
  } catch {
    return silent('invalid-local-release');
  }
  let stateDirectory = versionCacheDirectory(cacheDirectory, localRelease.version);
  try {
    stateDirectory = await prepareCacheDirectory(stateDirectory);
  } catch {
    return silent('cache-unavailable');
  }
  let deadline;
  try {
    deadline = Number(monotonicNow()) + ACK_LOCK_WAIT_MS;
  } catch {
    return silent('invalid-acknowledgement');
  }
  if (!Number.isFinite(deadline)) return silent('invalid-acknowledgement');
  while (true) {
    let operation;
    try {
      operation = await acquireOperation(stateDirectory);
    } catch {
      return silent('cache-unavailable');
    }
    if (!operation) {
      if (!await waitUntilRetry(deadline, monotonicNow)) return silent('check-in-progress');
      continue;
    }
    try {
      const committed = await commitOperation(
        stateDirectory,
        operation,
        localRelease.version,
        (state) => {
          const wasOffered = state.notification.offeredDigests.includes(targetDigest);
          const wasAcknowledged = state.notification.acknowledgedDigests.includes(targetDigest);
          if (!wasOffered && !wasAcknowledged) {
            return { state: null, result: silent('invalid-acknowledgement') };
          }
          return {
            state: stateAfterAcknowledgement(state, targetDigest),
            result: { status: 'acknowledged', eventKey },
          };
        },
      );
      if (!committed.fenced) return committed.result;
      if (!await waitUntilRetry(deadline, monotonicNow)) return silent('check-in-progress');
    } catch {
      await cancelOperation(stateDirectory, operation).catch(() => {});
      return silent('cache-unavailable');
    }
  }
}

async function runCli() {
  if (process.env.ARCHIFY_UPDATE_CHECK_DISABLED === '1') return silent('disabled');
  const argumentsList = process.argv.slice(2);
  if (argumentsList.length === 0) return checkForUpdate();
  if (argumentsList.length === 2 && argumentsList[0] === '--ack') {
    return acknowledgeUpdate({ eventKey: argumentsList[1] });
  }
  return silent('invalid-arguments');
}

async function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    const [entryPath, modulePath] = await Promise.all([
      fs.realpath(path.resolve(process.argv[1])),
      fs.realpath(fileURLToPath(import.meta.url)),
    ]);
    return entryPath === modulePath;
  } catch {
    return path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
  }
}

if (await isMainModule()) {
  let result;
  try {
    result = await runCli();
  } catch {
    result = silent('check-failed');
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
