#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

const TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);
const DELIVERY_SIDECAR_SUFFIXES = Object.freeze([
  '.delivery.json',
  '.delivery-pending.json',
  '.delivery-lock.json',
]);
const COMPARE_SIDECAR_SUFFIXES = Object.freeze(['.receipt.json']);
const DELIVERY_DIRECTORY_LOCK = '.archify-delivery-lock.json';
let sidecarNamespaceComponentKeyRuntime;
let boundedSidecarStem;
let isBoundedSidecarStem;
let sidecarStemFromComponent;
let sidecarStemNeedsBounding;

async function loadSidecarPathRuntime() {
  ({
    boundedSidecarStem,
    isBoundedSidecarStem,
    sidecarStemFromComponent,
    sidecarStemNeedsBounding,
  } = await import('../renderers/shared/sidecar-path.mjs'));
}

function deliverySidecarNamespace(artifactPath) {
  let artifact = path.resolve(artifactPath);
  try {
    artifact = fs.realpathSync.native(artifact);
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
  }
  if (typeof sidecarNamespaceComponentKeyRuntime !== 'function') {
    throw new Error('The sidecar namespace runtime is unavailable.');
  }
  const namespace = sidecarNamespaceComponentKeyRuntime(
    path.dirname(artifact),
    path.basename(artifact),
  );
  if (namespace.status !== 'resolved') {
    const error = new Error(
      `Could not establish a stable sidecar namespace (${namespace.reason?.code || 'unknown'}).`,
    );
    error.code = 'ARCHIFY_SIDECAR_NAMESPACE_INDETERMINATE';
    error.sidecarNamespaceReason = namespace.reason;
    throw error;
  }
  return { directory: namespace.directoryPath, ...sidecarStemFromComponent(namespace.componentKey) };
}

function deliverySidecarPath(artifactPath, suffix) {
  const { directory, stem, options } = deliverySidecarNamespace(artifactPath);
  return path.join(
    directory,
    `${boundedSidecarStem(stem, DELIVERY_SIDECAR_SUFFIXES, options)}${suffix}`,
  );
}

function deliveryProvenancePath(artifactPath) {
  return deliverySidecarPath(artifactPath, '.delivery.json');
}

function deliveryPendingPath(artifactPath) {
  return deliverySidecarPath(artifactPath, '.delivery-pending.json');
}

function rawHeadDeliverySidecarPath(artifactPath, suffix) {
  const { directory, stem, options } = deliverySidecarNamespace(artifactPath);
  if (options?.force) return undefined;
  if (sidecarStemNeedsBounding(stem, DELIVERY_SIDECAR_SUFFIXES)
    || !isBoundedSidecarStem(stem)) return undefined;
  return path.join(directory, `${stem}${suffix}`);
}

function rawHeadDeliveryProvenancePath(artifactPath) {
  return rawHeadDeliverySidecarPath(artifactPath, '.delivery.json');
}

function rawHeadDeliveryPendingPath(artifactPath) {
  return rawHeadDeliverySidecarPath(artifactPath, '.delivery-pending.json');
}

function legacyExtensionDeliverySidecarPath(artifactPath, suffix) {
  let artifact = path.resolve(artifactPath);
  try {
    artifact = fs.realpathSync.native(artifact);
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
  }
  const component = path.basename(artifact);
  if (!/\.html$/iu.test(component) || component.endsWith('.html')) return undefined;
  const legacyComponent = `${component.slice(0, -'.html'.length)}${suffix}`;
  if (legacyComponent.length > 255 || Buffer.byteLength(legacyComponent, 'utf8') > 255) {
    return undefined;
  }
  return path.join(path.dirname(artifact), legacyComponent);
}

function canonicalExistingDeliveryOutput(outputPath) {
  const output = path.resolve(outputPath);
  try {
    return fs.realpathSync.native(output);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return output;
    throw error;
  }
}

function legacyDeliveryLockPath(artifactPath) {
  const artifact = path.resolve(artifactPath);
  return `${artifact.replace(/\.html?$/i, '')}.delivery-lock.json`;
}

function legacyDeliveryLockPaths(artifactPaths) {
  const paths = [];
  for (const artifactPath of artifactPaths) {
    const lockPath = legacyDeliveryLockPath(artifactPath);
    const name = path.basename(lockPath);
    const canExist = process.platform === 'win32'
      ? name.length <= 255
      : Buffer.byteLength(name, 'utf8') <= 255;
    if (canExist && !paths.includes(lockPath)) paths.push(lockPath);
  }
  return paths;
}

function deliveryLockPath(artifactPath) {
  // A directory-wide mutex is deliberately conservative. Future 8.3, case,
  // and Unicode aliases cannot be assigned a sound canonical filename before
  // the artifact exists, so a per-artifact lock can split one delivery into
  // multiple owners. Provenance and pending journals remain artifact-specific.
  const artifact = path.resolve(artifactPath);
  let directory;
  try {
    directory = path.dirname(fs.realpathSync.native(artifact));
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    const authoredDirectory = path.dirname(artifact);
    try {
      directory = fs.realpathSync.native(authoredDirectory);
    } catch (directoryError) {
      if (directoryError?.code !== 'ENOENT' && directoryError?.code !== 'ENOTDIR') throw directoryError;
      directory = authoredDirectory;
    }
  }
  return path.join(directory, DELIVERY_DIRECTORY_LOCK);
}

function deliveryLockInvalid(lockPath) {
  return Object.assign(new Error(`Unrecognized delivery lock at "${lockPath}"; inspect the existing entry before retrying.`), {
    deliveryLockCode: 'delivery/lock-invalid',
    deliveryLockPath: lockPath,
  });
}

function regularDeliveryLockExists(lockPath) {
  try {
    if (!fs.lstatSync(lockPath).isFile()) throw deliveryLockInvalid(lockPath);
    return true;
  } catch (error) {
    if (error.deliveryLockCode) throw error;
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw deliveryLockInvalid(lockPath);
  }
}

function rejectExistingDeliveryLock(lockPath, output, fileBindingRuntime) {
  const {
    captureRegularFileBinding,
    releaseRegularFileBinding,
  } = fileBindingRuntime || {};
  let lock;
  let captured;
  try {
    if (typeof captureRegularFileBinding !== 'function'
      || typeof releaseRegularFileBinding !== 'function') {
      throw new Error('The regular-file binding runtime is unavailable.');
    }
    captured = captureRegularFileBinding(lockPath, {
      subject: 'delivery-lock',
      expectedLinks: 1,
      includeContent: true,
    });
    if (captured.status !== 'captured') throw new Error('Not a stable regular lock file.');
    lock = JSON.parse(captured.content.buffer.toString('utf8'));
    if (lock?.schemaVersion !== 1 || !Number.isSafeInteger(lock.pid) || lock.pid <= 0
      || typeof lock.receiptId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(lock.receiptId)) {
      throw new Error('Unrecognized delivery lock.');
    }
  } catch {
    throw deliveryLockInvalid(lockPath);
  } finally {
    if (captured?.binding) releaseRegularFileBinding(captured.binding);
  }
  if (processIsRunning(lock.pid)) {
    throw Object.assign(new Error(`Another delivery attempt owns "${output}" through lock "${lockPath}".`), {
      deliveryLockCode: 'delivery/concurrent-attempt',
      deliveryLockPath: lockPath,
    });
  }
  throw Object.assign(new Error(`A stale delivery lock remains at "${lockPath}"; recover it serially before retrying.`), {
    deliveryLockCode: 'delivery/lock-stale',
    deliveryLockPath: lockPath,
    deliveryLockOwner: { pid: lock.pid, receiptId: lock.receiptId },
  });
}

function processIsRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

const deliveryOwnershipStates = new WeakMap();

function deliveryOwnershipFailure(state, operation, reason, evidence = {}) {
  const error = new Error(`Delivery ownership was lost while attempting to ${operation}: ${reason}`);
  error.deliveryOwnershipCode = 'delivery/ownership-lost';
  error.deliveryOwnershipDetails = {
    operation,
    lock: state?.lockPath,
    expectedReceiptId: state?.receiptId,
    reason,
    ...evidence,
  };
  if (state && state.phase !== 'released') state.phase = 'lost';
  return error;
}

function deliveryOwnershipState(ownership, operation) {
  const state = deliveryOwnershipStates.get(ownership);
  if (!state) throw deliveryOwnershipFailure(undefined, operation, 'the ownership capability is invalid');
  if (state.phase === 'lost' || state.phase === 'released') {
    throw deliveryOwnershipFailure(state, operation, `the capability is already ${state.phase}`);
  }
  return state;
}

function sameFileIdentity(actual, expected) {
  const hasIdentity = (entry) => entry?.ino !== undefined && entry.ino !== 0 && entry.ino !== 0n;
  return hasIdentity(actual)
    && hasIdentity(expected)
    && actual.dev === expected.dev
    && actual.ino === expected.ino;
}

function assertOwnedDeliveryLock(state, ownedLock, operation, { verifyReceipt = true } = {}) {
  const {
    captureRegularFileBinding,
    releaseRegularFileBinding,
  } = state?.fileBindingRuntime || {};
  let captured;
  try {
    if (typeof captureRegularFileBinding !== 'function'
      || typeof releaseRegularFileBinding !== 'function') {
      throw new Error('The regular-file binding runtime is unavailable.');
    }
    captured = captureRegularFileBinding(ownedLock.path, {
      subject: 'owned-delivery-lock',
      ...(ownedLock.content ? {
        expectedSha256: ownedLock.content.sha256,
        expectedBytes: ownedLock.content.bytes,
      } : {}),
      expectedMode: Number(ownedLock.identity.mode & 0o777n),
      expectedLinks: 1,
      includeContent: verifyReceipt,
    });
  } catch (error) {
    throw deliveryOwnershipFailure(state, operation, 'an owned lock entry can no longer be inspected', {
      lock: ownedLock.path,
      ...(error?.code ? { systemCode: error.code } : {}),
    });
  }
  if (captured.status !== 'captured'
    || captured.identity.device !== ownedLock.identity.dev
    || captured.identity.inode !== ownedLock.identity.ino) {
    if (captured?.binding) releaseRegularFileBinding(captured.binding);
    throw deliveryOwnershipFailure(state, operation, 'an owned lock path no longer names the entry created by this attempt', {
      lock: ownedLock.path,
      ...(captured?.reason ? { lockState: captured.reason } : {}),
    });
  }
  try {
    if (!verifyReceipt) return;
    let lock;
    try {
      lock = JSON.parse(captured.content.buffer.toString('utf8'));
    } catch (error) {
      throw deliveryOwnershipFailure(state, operation, 'an owned lock receipt can no longer be verified', {
        lock: ownedLock.path,
        ...(error?.code ? { systemCode: error.code } : {}),
      });
    }
    if (lock?.schemaVersion !== 1 || lock.receiptId !== state.receiptId || lock.pid !== state.pid) {
      throw deliveryOwnershipFailure(state, operation, 'an owned lock receipt no longer matches this attempt', {
        lock: ownedLock.path,
        ...(typeof lock?.receiptId === 'string' ? { observedReceiptId: lock.receiptId } : {}),
      });
    }
  } catch (error) {
    throw error;
  } finally {
    releaseRegularFileBinding(captured.binding);
  }
}

function assertDeliveryOwnership(ownership, operation, { allowInitializing = false, pending = 'ignore' } = {}) {
  const state = deliveryOwnershipState(ownership, operation);
  const verifyReceipt = !allowInitializing || !['acquiring', 'initializing'].includes(state.phase);
  for (const ownedLock of state.ownedLocks) {
    assertOwnedDeliveryLock(state, ownedLock, operation, { verifyReceipt });
  }
  if (pending !== 'ignore') {
    const pendingPath = state.pendingPath;
    if (pending === 'absent') {
      try {
        fs.lstatSync(pendingPath);
      } catch (error) {
        if (error.code === 'ENOENT') return state;
        throw deliveryOwnershipFailure(state, operation, 'the finalized delivery journal can no longer be inspected', {
          journal: pendingPath,
          ...(error?.code ? { systemCode: error.code } : {}),
        });
      }
      throw deliveryOwnershipFailure(state, operation, 'the finalized delivery journal was recreated', { journal: pendingPath });
    }
    const {
      captureRegularFileBinding,
      releaseRegularFileBinding,
    } = state.fileBindingRuntime || {};
    let captured;
    try {
      if (typeof captureRegularFileBinding !== 'function'
        || typeof releaseRegularFileBinding !== 'function') {
        throw new Error('The regular-file binding runtime is unavailable.');
      }
      captured = captureRegularFileBinding(pendingPath, {
        subject: 'owned-delivery-journal',
        expectedSha256: state.pendingContent?.sha256,
        expectedBytes: state.pendingContent?.bytes,
        expectedMode: state.pendingIdentity?.mode,
        expectedLinks: 1,
        includeContent: pending === 'owned',
      });
    } catch (error) {
      throw deliveryOwnershipFailure(state, operation, 'the owned delivery journal can no longer be inspected', {
        journal: pendingPath,
        ...(error?.code ? { systemCode: error.code } : {}),
      });
    }
    if (captured.status !== 'captured'
      || !state.pendingIdentity
      || captured.identity.device !== state.pendingIdentity.dev
      || captured.identity.inode !== state.pendingIdentity.ino) {
      if (captured?.binding) releaseRegularFileBinding(captured.binding);
      throw deliveryOwnershipFailure(state, operation, 'the delivery journal no longer names the entry created by this attempt', {
        journal: pendingPath,
        ...(captured?.reason ? { journalState: captured.reason } : {}),
      });
    }
    try {
      if (pending === 'owned') {
        let journal;
        try {
          journal = JSON.parse(captured.content.buffer.toString('utf8'));
        } catch {
          throw deliveryOwnershipFailure(state, operation, 'the delivery journal receipt is malformed', {
            journal: pendingPath,
          });
        }
        if (journal?.receiptId !== state.receiptId) {
          throw deliveryOwnershipFailure(state, operation, 'the delivery journal receipt belongs to another attempt', {
            journal: pendingPath,
            ...(typeof journal?.receiptId === 'string' ? { observedReceiptId: journal.receiptId } : {}),
          });
        }
      }
    } finally {
      releaseRegularFileBinding(captured.binding);
    }
  }
  return state;
}

function quarantineRemoveOwnedDeliveryEntry(state, {
  filePath,
  identity,
  content,
  subject,
  operation,
  evidenceKey,
}) {
  const {
    captureRegularFileBinding,
    quarantineRemoveRegularFileBinding,
    releaseRegularFileBinding,
  } = state?.fileBindingRuntime || {};
  let captured;
  try {
    if (typeof captureRegularFileBinding !== 'function'
      || typeof quarantineRemoveRegularFileBinding !== 'function'
      || typeof releaseRegularFileBinding !== 'function') {
      throw new Error('The regular-file binding runtime is unavailable.');
    }
    captured = captureRegularFileBinding(filePath, {
      subject,
      ...(content ? {
        expectedSha256: content.sha256,
        expectedBytes: content.bytes,
      } : {}),
      expectedMode: typeof identity?.mode === 'bigint'
        ? Number(identity.mode & 0o777n)
        : identity?.mode,
      expectedIdentity: {
        device: identity?.dev,
        inode: identity?.ino,
      },
      expectedLinks: 1,
    });
  } catch (error) {
    throw deliveryOwnershipFailure(state, operation, `the owned ${subject} can no longer be captured for removal`, {
      [evidenceKey]: filePath,
      ...(error?.code ? { systemCode: error.code } : {}),
    });
  }
  if (captured.status !== 'captured') {
    throw deliveryOwnershipFailure(state, operation, `the owned ${subject} changed before removal`, {
      [evidenceKey]: filePath,
      entryState: captured.reason,
    });
  }
  try {
    const removed = quarantineRemoveRegularFileBinding(captured.binding, filePath, {
      subject,
      expectedLinks: 1,
    });
    if (removed.status === 'removed') return;
    const removalCode = removed.reason?.code;
    if (removed.status === 'unknown'
      && ['removal-quarantine-create-failed', `${subject}-quarantine-move-failed`]
        .includes(removalCode)) {
      const detail = removed.reason?.message ? `: ${removed.reason.message}` : '';
      const error = new Error(`The owned ${subject} could not be moved into its private removal quarantine (${removalCode})${detail}.`);
      if (removed.reason?.systemCode) error.code = removed.reason.systemCode;
      if (subject === 'delivery-lock') {
        error.deliveryOwnershipCode = 'delivery/lock-release';
        error.deliveryOwnershipDetails = {
          operation,
          lock: filePath,
          reason: error.message,
          entryState: removed.reason,
        };
      } else {
        error.deliveryJournalRemovalState = removed;
      }
      throw error;
    }
    throw deliveryOwnershipFailure(
      state,
      operation,
      removed.status === 'recovery-required'
        ? `a replacement ${subject} could not be restored from quarantine`
        : `the public ${subject} changed during removal and was preserved`,
      {
        [evidenceKey]: filePath,
        entryState: removed.reason,
        ...(removed.status === 'recovery-required' ? {
          recoveryRequired: true,
          recoveryDirectory: removed.recoveryDirectory,
          recoveryFiles: [{
            label: `preserved replacement ${subject}`,
            path: removed.recoveryFile,
            target: filePath,
          }],
        } : {}),
      },
    );
  } finally {
    releaseRegularFileBinding(captured.binding);
  }
}

function releaseDeliveryOwnership(ownership, { allowInitializing = false } = {}) {
  const current = deliveryOwnershipState(ownership, 'release the delivery lock');
  const pending = current.phase === 'finalized'
    ? 'absent'
    : current.pendingIdentity
      ? 'identity'
      : 'ignore';
  const state = assertDeliveryOwnership(ownership, 'release the delivery lock', { allowInitializing, pending });
  const verifyReceipt = !allowInitializing || !['acquiring', 'initializing'].includes(state.phase);
  for (const ownedLock of state.ownedLocks) {
    assertOwnedDeliveryLock(state, ownedLock, 'release the delivery lock', { verifyReceipt });
    quarantineRemoveOwnedDeliveryEntry(state, {
      filePath: ownedLock.path,
      identity: ownedLock.identity,
      content: ownedLock.content,
      subject: 'delivery-lock',
      operation: 'release the delivery lock',
      evidenceKey: 'lock',
    });
  }
  state.phase = 'released';
}

function acquireDeliveryLock(
  output,
  receiptId,
  inputPath,
  pathsAlias,
  recordInitializationFailure,
  legacyOutputPaths = [],
  fileBindingRuntime,
) {
  const stableOutput = canonicalExistingDeliveryOutput(output);
  const lockPath = deliveryLockPath(stableOutput);
  const comparableLockPath = (candidate) => {
    const absolute = path.resolve(candidate);
    try {
      return path.join(fs.realpathSync.native(path.dirname(absolute)), path.basename(absolute));
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
      return absolute;
    }
  };
  const lockPathsAlias = (left, right) => {
    const comparableLeft = comparableLockPath(left);
    const comparableRight = comparableLockPath(right);
    if (!pathsAlias(path.dirname(comparableLeft), path.dirname(comparableRight))) return false;
    return pathsAlias(comparableLeft, comparableRight);
  };
  const legacyFencePathsAlias = (left, right) => {
    const comparableLeft = comparableLockPath(left);
    const comparableRight = comparableLockPath(right);
    if (comparableLeft === comparableRight) return true;
    try {
      return lockPathsAlias(comparableLeft, comparableRight);
    } catch {
      // An indeterminate future-name relation is not evidence of aliasing.
      // Keep both candidates; an EEXIST below is accepted only when dev/ino
      // proves that it names a lock already created by this attempt.
      return false;
    }
  };
  const legacyLockPaths = [];
  for (const candidate of legacyDeliveryLockPaths([
    ...legacyOutputPaths.filter(Boolean),
    output,
    stableOutput,
  ])) {
    if (!legacyLockPaths.some((existing) => legacyFencePathsAlias(candidate, existing))) {
      legacyLockPaths.push(candidate);
    }
  }
  const pendingPath = deliveryPendingPath(stableOutput);
  const provenancePath = deliveryProvenancePath(stableOutput);
  const rawHeadPendingPath = rawHeadDeliveryPendingPath(stableOutput);
  const existingLegacyLocks = legacyLockPaths.filter((candidate) => regularDeliveryLockExists(candidate));
  regularDeliveryLockExists(lockPath);
  const conflictingLockPath = [lockPath, ...legacyLockPaths]
    .find((candidate) => lockPathsAlias(candidate, inputPath));
  if (conflictingLockPath) {
    throw Object.assign(new Error('Delivery lock path aliases the input specification; choose another output path.'), {
      deliveryLockCode: 'delivery/lock-path-conflict',
      deliveryLockPath: conflictingLockPath,
    });
  }
  if (existingLegacyLocks.length) {
    rejectExistingDeliveryLock(existingLegacyLocks[0], output, fileBindingRuntime);
  }
  const openedLocks = [];
  const ownership = Object.freeze({});
  deliveryOwnershipStates.set(ownership, {
    output: stableOutput,
    lockPath,
    pendingPath,
    provenancePath,
    receiptId,
    pid: process.pid,
    ownedLocks: openedLocks,
    fileBindingRuntime,
    phase: 'acquiring',
  });
  let collisionPath;
  try {
    const openOwnedLock = (ownedLockPath, { allowOwnedAlias = false } = {}) => {
      let descriptor;
      try {
        descriptor = fs.openSync(ownedLockPath, 'wx', 0o600);
      } catch (error) {
        if (error.code === 'EEXIST' && allowOwnedAlias) {
          try {
            const existingEntry = fs.lstatSync(ownedLockPath, { bigint: true });
            if (existingEntry.isFile()
              && openedLocks.some((ownedLock) => sameFileIdentity(existingEntry, ownedLock.identity))) {
              return undefined;
            }
          } catch {
            // Preserve the original EEXIST classification below.
          }
        }
        if (error.code === 'EEXIST') collisionPath = ownedLockPath;
        throw error;
      }
      let handleIdentity;
      let handleIdentityError;
      try {
        handleIdentity = fs.fstatSync(descriptor, { bigint: true });
      } catch (error) {
        // A transient first inspection failure must not strand the public
        // lock. Bind ownership from the still-open handle before cleanup.
        try {
          handleIdentity = fs.fstatSync(descriptor, { bigint: true });
        } catch {
          // Both handle metadata reads failed. Stamp the still-open inode with
          // this attempt's unpredictable receipt before consulting the public
          // path. A replacement claimant cannot be mistaken for our empty
          // lock, while a successful content-bound capture gives cleanup the
          // identity it needs after the original descriptor is closed.
          const recoveryReceipt = `${JSON.stringify({ schemaVersion: 1, receiptId, pid: process.pid })}\n`;
          const recoveryContent = artifactIdentity(Buffer.from(recoveryReceipt));
          let captured;
          try {
            fs.writeFileSync(descriptor, recoveryReceipt);
            captured = fileBindingRuntime?.captureRegularFileBinding?.(ownedLockPath, {
              subject: 'owned-delivery-lock',
              expectedSha256: recoveryContent.sha256,
              expectedBytes: recoveryContent.bytes,
              expectedLinks: 1,
            });
          } catch {}
          if (captured?.status === 'captured') {
            fileBindingRuntime.releaseRegularFileBinding(captured.binding);
            openedLocks.push({
              path: ownedLockPath,
              identity: {
                dev: captured.identity.device,
                ino: captured.identity.inode,
                mode: BigInt(captured.mode),
              },
              content: recoveryContent,
              descriptor,
            });
          } else {
            try {
              fs.closeSync(descriptor);
            } catch (closeError) {
              error.lockCleanupError = closeError.message;
            }
          }
          throw error;
        }
        handleIdentityError = error;
      }
      const ownedLock = {
        path: ownedLockPath,
        identity: handleIdentity,
        descriptor,
      };
      openedLocks.push(ownedLock);
      const pathIdentity = fs.lstatSync(ownedLockPath, { bigint: true });
      if (!handleIdentity.isFile()
        || handleIdentity.ino === 0n
        || !pathIdentity.isFile()
        || pathIdentity.isSymbolicLink()
        || pathIdentity.ino === 0n
        || !sameFileIdentity(pathIdentity, handleIdentity)) {
        throw new Error('Delivery lock path identity could not be verified safely.');
      }
      if (handleIdentityError) throw handleIdentityError;
      return ownedLock;
    };

    openOwnedLock(lockPath);
    for (const legacyLockPath of legacyLockPaths) {
      openOwnedLock(legacyLockPath, { allowOwnedAlias: true });
    }
    const state = deliveryOwnershipStates.get(ownership);
    if (rawHeadPendingPath && pathEntryExists(rawHeadPendingPath)) {
      throw Object.assign(new Error(`A pre-namespace delivery journal remains at "${rawHeadPendingPath}"; recover it before retrying.`), {
        deliveryLockCode: 'delivery/legacy-pending',
        deliveryLockPath: rawHeadPendingPath,
      });
    }
    state.phase = 'initializing';
    const lockReceipt = `${JSON.stringify({ schemaVersion: 1, receiptId, pid: process.pid })}\n`;
    const lockContent = artifactIdentity(Buffer.from(lockReceipt));
    for (const ownedLock of openedLocks) {
      fs.writeFileSync(ownedLock.descriptor, lockReceipt);
      ownedLock.content = lockContent;
    }
    for (const ownedLock of openedLocks) {
      fs.closeSync(ownedLock.descriptor);
      ownedLock.descriptor = undefined;
    }
    state.phase = 'owned';
    return ownership;
  } catch (error) {
    for (const ownedLock of openedLocks) {
      if (ownedLock.descriptor === undefined) continue;
      try {
        fs.closeSync(ownedLock.descriptor);
        ownedLock.descriptor = undefined;
      } catch (closeError) {
        error.lockCleanupError = closeError.message;
      }
    }
    const state = deliveryOwnershipStates.get(ownership);
    let preserveOwnership = false;
    try {
      if (state.phase === 'initializing') {
        assertDeliveryOwnership(ownership, 'record a lock initialization failure', { allowInitializing: true });
        error.deliveryFailureRecord = recordInitializationFailure?.(error, ownership);
        if (error.deliveryFailureRecord?.journalRecovery) {
          error.deliveryJournalRecovery = error.deliveryFailureRecord.journalRecovery.deliveryJournalRecovery;
          preserveOwnership = true;
        }
        if (error.deliveryFailureRecord?.provenanceRecovery) {
          error.deliveryProvenanceRecovery = error.deliveryFailureRecord.provenanceRecovery.deliveryProvenanceRecovery;
          preserveOwnership = true;
        }
      }
      if (!preserveOwnership) {
        releaseDeliveryOwnership(ownership, { allowInitializing: true });
      }
    } catch (cleanupError) {
      if (cleanupError.deliveryOwnershipCode) {
        cleanupError.deliveryOwnershipDetails = {
          ...(cleanupError.deliveryOwnershipDetails || {}),
          initializationError: error.message,
          ...(error?.code ? { initializationSystemCode: error.code } : {}),
        };
        if (cleanupError.deliveryOwnershipCode === 'delivery/lock-release' && error.deliveryFailureRecord) {
          cleanupError.deliveryFailureRecord = error.deliveryFailureRecord;
        }
        throw cleanupError;
      }
      error.lockCleanupError = cleanupError.message;
    }
    if (collisionPath) rejectExistingDeliveryLock(collisionPath, output, fileBindingRuntime);
    throw error;
  }
}

function pathEntryExists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

function captureOwnedStagingFile(registry, filePath, fileBindingRuntime, {
  subject = 'private-staging-entry',
  content,
  expectedLinks = 1,
} = {}) {
  const { captureRegularFileBinding } = fileBindingRuntime || {};
  if (typeof captureRegularFileBinding !== 'function') {
    throw new Error('The regular-file binding runtime is unavailable.');
  }
  let captured = captureRegularFileBinding(filePath, {
    subject,
    ...(content ? {
      expectedSha256: content.sha256,
      expectedBytes: content.bytes,
    } : {}),
    expectedLinks,
  });
  if (captured.status === 'unsupported'
    && String(captured.reason?.code || '').endsWith('-hardlinked')
    && content) {
    const observedLinks = Number(captured.reason?.links);
    if (Number.isSafeInteger(observedLinks) && observedLinks > expectedLinks) {
      captured = captureRegularFileBinding(filePath, {
        subject,
        expectedSha256: content.sha256,
        expectedBytes: content.bytes,
        expectedLinks: observedLinks,
      });
      expectedLinks = observedLinks;
    }
  }
  if (captured.status !== 'captured') {
    const error = new Error(`Could not bind the owned staging entry "${filePath}" (${captured.reason?.code || 'unknown state'}).`);
    error.stagingCapture = captured;
    throw error;
  }
  registry.push({ filePath, binding: captured.binding, subject, expectedLinks });
  return captured;
}

function cleanupOwnedStagingDirectory(directory, identity, registry, fileBindingRuntime) {
  const {
    quarantineRemoveRegularFileBinding,
    releaseRegularFileBinding,
  } = fileBindingRuntime || {};
  if (typeof quarantineRemoveRegularFileBinding !== 'function'
    || typeof releaseRegularFileBinding !== 'function') {
    throw new Error('The regular-file binding runtime is unavailable.');
  }
  const failures = [];
  for (const entry of [...registry].reverse()) {
    try {
      const removed = quarantineRemoveRegularFileBinding(entry.binding, entry.filePath, {
        subject: entry.subject,
        expectedLinks: entry.expectedLinks,
      });
      // A missing path means the transaction already moved or finalized this
      // owned inode. Every other non-removal result is deliberately preserved:
      // it may be a concurrent claimant rather than an entry we created.
      if (removed.status !== 'removed'
        && !['ENOENT', 'ENOTDIR'].includes(removed.reason?.systemCode)) {
        failures.push(`${entry.filePath}: ${removed.reason?.code || removed.status}`);
      }
    } catch (error) {
      failures.push(`${entry.filePath}: ${error.message}`);
    } finally {
      const released = releaseRegularFileBinding(entry.binding);
      if (released.status !== 'released') {
        failures.push(`${entry.filePath}: ${released.reason?.code || released.status}`);
      }
    }
  }
  registry.length = 0;
  try {
    if (!removeOwnedEmptyStagingDirectory(directory, identity, { throwOnFailure: true })) {
      failures.push(`${directory}: staging directory was retained because its identity changed`);
    }
  } catch (error) {
    failures.push(`${directory}: ${error.message}`);
  }
  if (failures.length) throw new Error(failures.join('; '));
}

function createOwnedEmptyStagingDirectory(prefix) {
  // Node's Windows mkdtemp binding does not consistently promote an ordinary
  // UNC prefix past MAX_PATH. Use the equivalent namespaced spelling for the
  // syscall while preserving the same physical directory identity.
  const directory = fs.mkdtempSync(path.toNamespacedPath(prefix));
  const metadata = fs.lstatSync(directory, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || metadata.ino === 0n) {
    throw new Error(`Private staging directory identity is unavailable: ${directory}`);
  }
  return {
    directory,
    identity: { device: metadata.dev, inode: metadata.ino },
  };
}

function createStagingRetirementQuarantine(parent) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const directory = path.join(parent, `.archify-staging-remove-${randomUUID()}`);
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
      return directory;
    } catch (error) {
      if (error?.code !== 'EEXIST') return undefined;
    }
  }
  return undefined;
}

const stagingRemovalSignal = new Int32Array(new SharedArrayBuffer(4));
const stagingRemovalAttempts = 10;

function removeEmptyStagingDirectoryWithRetry(directory) {
  let failure;
  for (let attempt = 0; attempt < stagingRemovalAttempts; attempt += 1) {
    try {
      fs.rmdirSync(directory);
      return;
    } catch (error) {
      failure = error;
      // SMB can acknowledge the last file removal before the directory view
      // catches up. Retrying an empty-directory removal is claimant-safe: any
      // real entry keeps returning ENOTEMPTY and is never removed recursively.
      if (error?.code !== 'ENOTEMPTY' || attempt === stagingRemovalAttempts - 1) break;
      Atomics.wait(
        stagingRemovalSignal,
        0,
        0,
        Math.min(5 * (2 ** attempt), 250),
      );
    }
  }
  throw failure;
}

function stagingDirectoryAppearsEmpty(directory) {
  for (let attempt = 0; attempt < stagingRemovalAttempts; attempt += 1) {
    try {
      if (fs.readdirSync(directory).length === 0) return true;
    } catch {
      return false;
    }
    if (attempt === stagingRemovalAttempts - 1) break;
    Atomics.wait(
      stagingRemovalSignal,
      0,
      0,
      Math.min(5 * (2 ** attempt), 250),
    );
  }
  return false;
}

function removeOwnedEmptyStagingDirectory(directory, identity, { throwOnFailure = false } = {}) {
  let current;
  try {
    current = fs.lstatSync(directory, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    throw error;
  }
  if (!current.isDirectory()
    || current.isSymbolicLink()
    || current.ino === 0n
    || current.dev !== identity.device
    || current.ino !== identity.inode) return false;
  if (!stagingDirectoryAppearsEmpty(directory)) return false;
  const quarantine = createStagingRetirementQuarantine(path.dirname(directory));
  if (!quarantine) return false;
  const movedPath = path.join(quarantine, path.basename(directory));
  try {
    fs.renameSync(directory, movedPath);
  } catch (error) {
    if (throwOnFailure) throw error;
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
    || moved.dev !== identity.device
    || moved.ino !== identity.inode) {
    // A claimant won the public move boundary. Preserve it under the private
    // quarantine name; directories have no portable no-clobber restore link.
    return false;
  }
  try {
    // The unpredictable 0700 quarantine closes the public replacement race.
    // Never recurse: unexpected contents remain available for recovery.
    removeEmptyStagingDirectoryWithRetry(movedPath);
    removeEmptyStagingDirectoryWithRetry(quarantine);
    return true;
  } catch (error) {
    if (throwOnFailure) throw error;
    return false;
  }
}

function releaseOwnedStagingBindings(registry, fileBindingRuntime) {
  const { releaseRegularFileBinding } = fileBindingRuntime || {};
  if (typeof releaseRegularFileBinding !== 'function') return;
  for (const entry of registry) releaseRegularFileBinding(entry.binding);
  registry.length = 0;
}

function artifactIdentity(artifact) {
  return { sha256: createHash('sha256').update(artifact).digest('hex'), bytes: artifact.byteLength };
}

function beginDeliveryAttempt({ ownership, input, pathsAlias, fileBindingRuntime }) {
  const state = assertDeliveryOwnership(ownership, 'begin the delivery journal', { allowInitializing: true });
  const {
    output, pendingPath: journal, provenancePath, receiptId,
  } = state;
  for (const protectedPath of [input, output, provenancePath].filter(Boolean)) {
    if (pathsAlias(journal, protectedPath)) throw new Error('Delivery journal aliases an input or output.');
  }
  const published = writeDeliveryProvenance(journal, {
    schemaVersion: 1, command: 'deliver', status: 'pending', receiptId,
    input, output: path.resolve(output),
  }, {
    beforeReplace: () => assertDeliveryOwnership(ownership, 'create the delivery journal', { allowInitializing: true }),
    fileBindingRuntime,
  });
  state.pendingIdentity = {
    dev: published.identity.device,
    ino: published.identity.inode,
    mode: published.identity.mode,
  };
  state.pendingContent = published.content;
  assertDeliveryOwnership(ownership, 'finish creating the delivery journal', { allowInitializing: true });
}

function writeDeliveryProvenance(file, value, { beforeReplace, fileBindingRuntime } = {}) {
  const {
    backupPublicRegularFileBinding,
    captureRegularFileBinding,
    quarantineRemoveRegularFileBinding,
    verifyRegularFileBinding,
    releaseRegularFileBinding,
  } = fileBindingRuntime || {};
  if (typeof captureRegularFileBinding !== 'function'
    || typeof backupPublicRegularFileBinding !== 'function'
    || typeof quarantineRemoveRegularFileBinding !== 'function'
    || typeof verifyRegularFileBinding !== 'function'
    || typeof releaseRegularFileBinding !== 'function') {
    const error = new Error('The regular-file binding runtime is unavailable.');
    error.deliveryJournalState = {
      status: 'unknown',
      reason: { code: 'atomic-output-runtime-unavailable' },
    };
    throw error;
  }
  const staging = createOwnedEmptyStagingDirectory(
    path.join(path.dirname(file), '.archify-provenance-'),
  );
  const stagingDirectory = staging.directory;
  const temporary = path.join(stagingDirectory, path.basename(file));
  const backup = path.join(stagingDirectory, '.previous-journal');
  const serialized = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const expectedContent = artifactIdentity(serialized);
  let candidateCapture;
  let previousCapture;
  let candidatePresent = false;
  let backupPresent = false;
  let backupVerified = false;
  let published = false;
  let retainStaging = false;
  const bindingError = (result, action) => {
    const error = new Error(`Could not ${action} delivery journal "${file}" safely (${result.reason?.code || 'unknown target state'}).`);
    error.deliveryJournalState = result;
    return error;
  };
  try {
    fs.writeFileSync(temporary, serialized, { flag: 'wx' });
    candidatePresent = true;
    candidateCapture = captureRegularFileBinding(temporary, {
      subject: 'delivery-journal-candidate',
      expectedSha256: expectedContent.sha256,
      expectedBytes: expectedContent.bytes,
      expectedLinks: 1,
    });
    if (candidateCapture.status !== 'captured') throw bindingError(candidateCapture, 'prepare the');

    let existing = false;
    try {
      fs.lstatSync(file);
      existing = true;
    } catch (error) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error;
    }
    if (existing) {
      previousCapture = captureRegularFileBinding(file, {
        subject: 'previous-delivery-journal',
        expectedLinks: 1,
      });
      if (previousCapture.status !== 'captured') {
        throw bindingError(previousCapture, 'snapshot the existing');
      }
    }
    beforeReplace?.();
    if (previousCapture) {
      const moved = backupPublicRegularFileBinding(previousCapture.binding, file, backup, {
        subject: 'previous-delivery-journal',
      });
      backupPresent = moved.backupCreated === true;
      backupVerified = moved.backupVerified === true;
      if (moved.status !== 'backed-up') throw bindingError(moved, 'back up the existing');
    }

    const ready = verifyRegularFileBinding(candidateCapture.binding, {
      filePath: temporary,
      expectedLinks: 1,
    });
    if (ready.status !== 'match') throw bindingError(ready, 'verify the staged');
    try {
      fs.linkSync(temporary, file);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw bindingError({
          status: 'different',
          reason: { code: 'target-claimed-during-publish', phase: 'journal-publish' },
        }, 'publish the');
      }
      throw error;
    }
    published = true;
    for (const target of [temporary, file]) {
      const linked = verifyRegularFileBinding(candidateCapture.binding, {
        filePath: target,
        expectedLinks: 2,
      });
      if (linked.status !== 'match') throw bindingError(linked, 'verify the published');
    }
    const retiredCandidate = quarantineRemoveRegularFileBinding(
      candidateCapture.binding,
      temporary,
      { subject: 'delivery-journal-candidate', expectedLinks: 2 },
    );
    if (retiredCandidate.status !== 'removed') {
      retainStaging = true;
      throw bindingError(retiredCandidate, 'retire the staged');
    }
    candidatePresent = false;
    const finalized = verifyRegularFileBinding(candidateCapture.binding, {
      filePath: file,
      expectedLinks: 1,
    });
    if (finalized.status !== 'match') throw bindingError(finalized, 'finalize the');
    if (backupPresent) {
      const previous = verifyRegularFileBinding(previousCapture.binding, {
        filePath: backup,
        expectedLinks: 1,
      });
      if (previous.status !== 'match') throw bindingError(previous, 'verify the previous');
      const retiredBackup = quarantineRemoveRegularFileBinding(
        previousCapture.binding,
        backup,
        { subject: 'previous-delivery-journal', expectedLinks: 1 },
      );
      if (retiredBackup.status !== 'removed') {
        retainStaging = true;
        throw bindingError(retiredBackup, 'retire the previous');
      }
      backupPresent = false;
    }
    return {
      identity: candidateCapture.identity,
      content: candidateCapture.content,
    };
  } catch (cause) {
    const rollbackErrors = [];
    const publicRecoveryFiles = [];
    if (cause.deliveryJournalState?.status === 'recovery-required'
      && cause.deliveryJournalState.recoveryFile) {
      publicRecoveryFiles.push({
        label: 'preserved journal replacement',
        path: cause.deliveryJournalState.recoveryFile,
        target: file,
      });
    }
    if (published) {
      try {
        const removed = quarantineRemoveRegularFileBinding(candidateCapture.binding, file, {
          subject: 'published-delivery-journal',
          expectedLinks: candidatePresent ? 2 : 1,
        });
        if (removed.status === 'removed') {
          published = false;
        } else {
          rollbackErrors.push(`the published journal could not be removed safely (${removed.reason?.code || 'unknown target state'})`);
          if (removed.status === 'recovery-required') {
            publicRecoveryFiles.push({
              label: 'preserved journal replacement',
              path: removed.recoveryFile,
              target: file,
            });
          }
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') rollbackErrors.push(`published journal cleanup failed (${error.message})`);
      }
    }
    if (candidatePresent) {
      try {
        const current = verifyRegularFileBinding(candidateCapture.binding, {
          filePath: temporary,
          expectedLinks: published ? 2 : 1,
        });
        if (current.status === 'match') {
          const retiredCandidate = quarantineRemoveRegularFileBinding(
            candidateCapture.binding,
            temporary,
            {
              subject: 'delivery-journal-candidate',
              expectedLinks: published ? 2 : 1,
            },
          );
          if (retiredCandidate.status !== 'removed') {
            throw bindingError(retiredCandidate, 'retire the staged');
          }
          candidatePresent = false;
        } else {
          rollbackErrors.push('the staged journal candidate was replaced before cleanup');
          retainStaging = true;
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') rollbackErrors.push(`staged journal cleanup failed (${error.message})`);
      }
    }
    if (backupPresent) {
      try {
        if (!backupVerified) {
          throw new Error('the backup entry was never verified as the previous journal');
        }
        if (pathEntryExists(file)) throw new Error('a new journal claimant prevents restoring the previous journal');
        const previous = verifyRegularFileBinding(previousCapture.binding, {
          filePath: backup,
          expectedLinks: 1,
        });
        if (previous.status !== 'match') {
          backupVerified = false;
          throw bindingError(previous, 'verify the previous');
        }
        try {
          fs.linkSync(backup, file);
        } catch (error) {
          if (error?.code === 'EEXIST') {
            throw new Error('a new journal claimant prevents restoring the previous journal');
          }
          throw error;
        }
        for (const target of [backup, file]) {
          const restored = verifyRegularFileBinding(previousCapture.binding, {
            filePath: target,
            expectedLinks: 2,
          });
          if (restored.status !== 'match') throw bindingError(restored, 'verify the restored');
        }
        const retiredBackup = quarantineRemoveRegularFileBinding(
          previousCapture.binding,
          backup,
          { subject: 'previous-delivery-journal', expectedLinks: 2 },
        );
        if (retiredBackup.status !== 'removed') {
          throw bindingError(retiredBackup, 'retire the restored backup');
        }
        backupPresent = false;
        const restored = verifyRegularFileBinding(previousCapture.binding, {
          filePath: file,
          expectedLinks: 1,
        });
        if (restored.status !== 'match') throw bindingError(restored, 'finalize the restored');
      } catch (error) {
        rollbackErrors.push(`previous journal restore failed (${error.message})`);
        retainStaging = backupPresent || candidatePresent;
      }
    }
    const claimantConflict = cause.deliveryJournalState?.reason?.code === 'target-claimed-during-publish';
    if (rollbackErrors.length || claimantConflict) {
      cause.deliveryJournalRecovery = {
        recoveryRequired: true,
        journal: file,
        ...(claimantConflict ? { claimantConflict: true } : {}),
        rollbackErrors,
        ...(retainStaging ? {
          recoveryDirectory: stagingDirectory,
        } : publicRecoveryFiles.length ? {
          recoveryDirectory: path.dirname(publicRecoveryFiles[0].path),
        } : {}),
        ...(backupPresent || (candidatePresent && retainStaging) || publicRecoveryFiles.length ? {
          recoveryFiles: [
            ...(backupPresent ? [{
              label: backupVerified
                ? 'previous delivery journal'
                : 'unverified preserved journal backup entry',
              path: backup,
              target: file,
              verifiedPrevious: backupVerified,
            }] : []),
            ...(candidatePresent && retainStaging ? [{ label: 'preserved staged journal entry', path: temporary }] : []),
            ...publicRecoveryFiles,
          ],
        } : {}),
      };
    }
    throw cause;
  } finally {
    if (candidateCapture?.binding) releaseRegularFileBinding(candidateCapture.binding);
    if (previousCapture?.binding) releaseRegularFileBinding(previousCapture.binding);
    if (!retainStaging) removeOwnedEmptyStagingDirectory(stagingDirectory, staging.identity);
  }
}

function writeCapturedDeliveryProvenance(file, value, {
  beforeCommit,
  capture,
  verifyAtomicOutput,
  fileBindingRuntime,
} = {}) {
  const {
    backupPublicRegularFileBinding,
    captureRegularFileBinding,
    quarantineRemoveRegularFileBinding,
    verifyRegularFileBinding,
    releaseRegularFileBinding,
  } = fileBindingRuntime || {};
  if (!capture
    || typeof verifyAtomicOutput !== 'function'
    || typeof backupPublicRegularFileBinding !== 'function'
    || typeof captureRegularFileBinding !== 'function'
    || typeof quarantineRemoveRegularFileBinding !== 'function'
    || typeof verifyRegularFileBinding !== 'function'
    || typeof releaseRegularFileBinding !== 'function') {
    throw deliveryTargetStateError(file, 'delivery provenance', {
      status: 'unknown',
      reason: { code: 'atomic-output-runtime-unavailable' },
    });
  }
  const staging = createOwnedEmptyStagingDirectory(
    path.join(path.dirname(file), '.archify-provenance-'),
  );
  const stagingDirectory = staging.directory;
  const candidate = path.join(stagingDirectory, path.basename(file));
  const backup = path.join(stagingDirectory, '.previous-provenance');
  let candidateIdentity;
  let candidateBinding;
  let previousBinding;
  let candidatePresent = false;
  let backupPresent = false;
  let backupVerified = false;
  let published = false;
  let retainStaging = false;
  try {
    const serialized = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    const expectedContent = artifactIdentity(serialized);
    fs.writeFileSync(candidate, serialized, { flag: 'wx' });
    candidatePresent = true;
    if (capture.mode !== null) fs.chmodSync(candidate, capture.mode);
    const candidateCapture = captureRegularFileBinding(candidate, {
      subject: 'delivery-provenance-candidate',
      expectedSha256: expectedContent.sha256,
      expectedBytes: expectedContent.bytes,
      ...(capture.mode === null ? {} : { expectedMode: capture.mode }),
      expectedLinks: 1,
    });
    if (candidateCapture.status !== 'captured') {
      throw deliveryTargetStateError(file, 'delivery provenance', candidateCapture);
    }
    candidateBinding = candidateCapture.binding;
    candidateIdentity = {
      dev: candidateCapture.identity.device,
      ino: candidateCapture.identity.inode,
    };
    beforeCommit?.();
    const verification = verifyAtomicOutput(capture.snapshot);
    if (verification.status !== 'match') {
      throw deliveryTargetStateError(file, 'delivery provenance', verification);
    }
    if (capture.snapshot.target.kind === 'file') {
      const expected = capture.snapshot.target;
      const previous = captureRegularFileBinding(capture.commitPath, {
        subject: 'previous-delivery-provenance',
        expectedIdentity: { device: expected.device, inode: expected.inode },
        expectedMode: expected.mode,
        expectedLinks: 1,
      });
      if (previous.status !== 'captured') {
        throw deliveryTargetStateError(file, 'delivery provenance', previous);
      }
      previousBinding = previous.binding;
      const moved = backupPublicRegularFileBinding(
        previousBinding,
        capture.commitPath,
        backup,
        { subject: 'previous-delivery-provenance' },
      );
      backupPresent = moved.backupCreated === true;
      backupVerified = moved.backupVerified === true;
      if (moved.status !== 'backed-up') {
        throw deliveryTargetStateError(file, 'delivery provenance', moved);
      }
    }
    const currentCandidate = verifyRegularFileBinding(candidateBinding, {
      filePath: candidate,
      expectedLinks: 1,
    });
    if (currentCandidate.status !== 'match') {
      throw deliveryTargetStateError(file, 'delivery provenance', currentCandidate);
    }
    try {
      fs.linkSync(candidate, capture.commitPath);
    } catch (error) {
      if (error?.code === 'EEXIST') {
        throw deliveryTargetStateError(file, 'delivery provenance', {
          status: 'different',
          reason: { code: 'target-claimed-during-publish' },
        });
      }
      throw error;
    }
    published = true;
    for (const target of [candidate, capture.commitPath]) {
      const linked = verifyRegularFileBinding(candidateBinding, {
        filePath: target,
        expectedLinks: 2,
      });
      if (linked.status !== 'match') {
        throw deliveryTargetStateError(file, 'delivery provenance', linked);
      }
    }
    const retiredCandidate = quarantineRemoveRegularFileBinding(
      candidateBinding,
      candidate,
      { subject: 'delivery-provenance-candidate', expectedLinks: 2 },
    );
    if (retiredCandidate.status !== 'removed') {
      retainStaging = true;
      throw deliveryTargetStateError(file, 'delivery provenance', retiredCandidate);
    }
    candidatePresent = false;
    const finalized = verifyRegularFileBinding(candidateBinding, {
      filePath: capture.commitPath,
      expectedLinks: 1,
    });
    if (finalized.status !== 'match') {
      throw deliveryTargetStateError(file, 'delivery provenance', finalized);
    }
    if (backupPresent) {
      const currentBackup = verifyRegularFileBinding(previousBinding, {
        filePath: backup,
        expectedLinks: 1,
      });
      if (currentBackup.status !== 'match') {
        backupVerified = false;
        throw deliveryTargetStateError(file, 'delivery provenance', {
          status: 'different',
          reason: { code: 'backup-identity-changed-before-finalize' },
        });
      }
      const retiredBackup = quarantineRemoveRegularFileBinding(
        previousBinding,
        backup,
        { subject: 'previous-delivery-provenance', expectedLinks: 1 },
      );
      if (retiredBackup.status !== 'removed') {
        retainStaging = true;
        throw deliveryTargetStateError(file, 'delivery provenance', retiredBackup);
      }
      backupPresent = false;
    }
  } catch (cause) {
    const rollbackErrors = [];
    const publicRecoveryFiles = [];
    if (cause.deliveryTargetState?.status === 'recovery-required'
      && cause.deliveryTargetState.recoveryFile) {
      publicRecoveryFiles.push({
        label: 'preserved provenance replacement',
        path: cause.deliveryTargetState.recoveryFile,
        target: capture.commitPath,
      });
    }
    if (published) {
      try {
        const removed = quarantineRemoveRegularFileBinding(candidateBinding, capture.commitPath, {
          subject: 'published-delivery-provenance',
          expectedLinks: candidatePresent ? 2 : 1,
        });
        if (removed.status === 'removed') {
          published = false;
        } else {
          rollbackErrors.push(`the published provenance could not be removed safely (${removed.reason?.code || 'unknown target state'})`);
          if (removed.status === 'recovery-required') {
            publicRecoveryFiles.push({
              label: 'preserved provenance replacement',
              path: removed.recoveryFile,
              target: capture.commitPath,
            });
          }
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') rollbackErrors.push(`published provenance cleanup failed (${error.message})`);
      }
    }
    if (candidatePresent) {
      try {
        const current = verifyRegularFileBinding(candidateBinding, {
          filePath: candidate,
          expectedLinks: published ? 2 : 1,
        });
        if (current.status === 'match') {
          const retiredCandidate = quarantineRemoveRegularFileBinding(
            candidateBinding,
            candidate,
            {
              subject: 'delivery-provenance-candidate',
              expectedLinks: published ? 2 : 1,
            },
          );
          if (retiredCandidate.status !== 'removed') {
            throw deliveryTargetStateError(
              file,
              'delivery provenance',
              retiredCandidate,
            );
          }
          candidatePresent = false;
        } else {
          rollbackErrors.push('the staged provenance candidate was replaced before cleanup');
          retainStaging = true;
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          rollbackErrors.push(`staged provenance cleanup failed (${error.message})`);
          retainStaging = true;
        }
      }
    }
    if (backupPresent) {
      try {
        if (!backupVerified) {
          throw new Error('the backup entry was never verified as the previous provenance');
        }
        if (pathEntryExists(capture.commitPath)) {
          throw new Error('a new target claimant prevents restoring the previous provenance');
        }
        const currentBackup = verifyRegularFileBinding(previousBinding, {
          filePath: backup,
          expectedLinks: 1,
        });
        if (currentBackup.status !== 'match') {
          backupVerified = false;
          throw new Error('the previous provenance backup identity changed');
        }
        fs.linkSync(backup, capture.commitPath);
        for (const target of [backup, capture.commitPath]) {
          const restored = verifyRegularFileBinding(previousBinding, {
            filePath: target,
            expectedLinks: 2,
          });
          if (restored.status !== 'match') {
            throw new Error('the restored provenance identity could not be verified');
          }
        }
        const retiredBackup = quarantineRemoveRegularFileBinding(
          previousBinding,
          backup,
          { subject: 'previous-delivery-provenance', expectedLinks: 2 },
        );
        if (retiredBackup.status !== 'removed') {
          throw deliveryTargetStateError(file, 'delivery provenance', retiredBackup);
        }
        backupPresent = false;
        const restoredFinal = verifyRegularFileBinding(previousBinding, {
          filePath: capture.commitPath,
          expectedLinks: 1,
        });
        if (restoredFinal.status !== 'match') {
          throw new Error('the restored provenance link count could not be verified');
        }
      } catch (error) {
        rollbackErrors.push(`previous provenance restore failed (${error.message})`);
        retainStaging = true;
      }
    }
    const recoveryFiles = [
      ...(backupPresent ? [{
        label: backupVerified
          ? 'preserved delivery provenance backup entry'
          : 'unverified preserved delivery provenance backup entry',
        path: backup,
        target: capture.commitPath,
        verifiedPrevious: backupVerified,
      }] : []),
      ...(candidatePresent && retainStaging ? [{ label: 'preserved staged provenance entry', path: candidate }] : []),
      ...publicRecoveryFiles,
    ];
    if (rollbackErrors.length) {
      cause.deliveryProvenanceRecovery = {
        recoveryRequired: true,
        rollbackErrors,
        ...(recoveryFiles.length ? {
          recoveryDirectory: retainStaging
            ? stagingDirectory
            : path.dirname(recoveryFiles[0].path),
          recoveryFiles,
        } : {}),
      };
    }
    if (rollbackErrors.length && cause?.archifyDiagnostics?.[0]) {
      const [issue] = cause.archifyDiagnostics;
      issue.evidence = {
        ...(issue.evidence || {}),
        rollbackErrors,
        ...(recoveryFiles.length ? {
          recoveryDirectory: retainStaging
            ? stagingDirectory
            : path.dirname(recoveryFiles[0].path),
          recoveryFile: recoveryFiles[0].path,
          recoveryFiles,
        } : {}),
      };
    }
    throw cause;
  } finally {
    if (candidateBinding) releaseRegularFileBinding(candidateBinding);
    if (previousBinding) releaseRegularFileBinding(previousBinding);
    if (!retainStaging) removeOwnedEmptyStagingDirectory(stagingDirectory, staging.identity);
  }
}

function recordDeliveryFailure(options) {
  const {
    output, stage, input, error, receiptId, pathsAlias, ownership: suppliedOwnership,
    releaseOwnership: shouldReleaseSuppliedOwnership = false, legacyOutputPaths = [],
    captureAtomicOutput, verifyAtomicOutput, fileBindingRuntime,
  } = options;
  if (!output || !/\.html?$/i.test(output)) return { ok: true, status: 'not-applicable' };
  let ownership = suppliedOwnership;
  let acquiredHere = false;
  if (!ownership) {
    try {
      ownership = acquireDeliveryLock(
        output,
        receiptId,
        input,
        pathsAlias,
        (lockError, initializingOwnership) => recordDeliveryFailure({
          ...options,
          error: `Could not start delivery for "${output}": ${lockError.message}`,
          ownership: initializingOwnership,
          releaseOwnership: false,
        }),
        legacyOutputPaths,
        fileBindingRuntime,
      );
      acquiredHere = true;
    } catch (lockError) {
      const reportedLockError = lockError?.code === 'ARCHIFY_SIDECAR_NAMESPACE_INDETERMINATE'
        && lockError.sidecarNamespaceReason?.code === 'sidecar-directory-missing'
        ? Object.assign(
          new Error(`Delivery lock parent directory does not exist for "${output}".`),
          { code: 'ENOENT', cause: lockError },
        )
        : lockError;
      return {
        ...(lockError.deliveryFailureRecord || { ok: false, status: 'unrecorded' }),
        lockError: reportedLockError,
      };
    }
  }
  const state = deliveryOwnershipStates.get(ownership);
  let recorded;
  if (!state?.deliveryTargets) {
    try {
      captureDeliveryTargetState({
        state,
        requestedOutput: legacyOutputPaths[0] || output,
        pathsAlias,
        captureAtomicOutput,
        verifyAtomicOutput,
      });
    } catch (captureError) {
      recorded = {
        ok: false,
        status: 'unrecorded',
        diagnostic: captureError.archifyDiagnostics?.[0] || diagnostic({
          code: 'output/target-indeterminate',
          message: captureError.message,
          subject: { output },
          evidence: { ...(captureError?.code ? { systemCode: captureError.code } : {}) },
          supportedFixes: ['use ordinary absent or regular-file delivery targets, then retry'],
        }),
      };
    }
  }
  const stableOutput = state?.output || canonicalExistingDeliveryOutput(output);
  // Keep independent evidence even when the artifact is unreadable or the
  // provenance target is locked, aliases the input, or cannot be replaced.
  let journalError;
  if (!recorded && !state?.pendingIdentity) {
    try {
      beginDeliveryAttempt({ ownership, input, pathsAlias, fileBindingRuntime });
    } catch (cause) {
      if (cause.deliveryOwnershipCode === 'delivery/ownership-lost') {
        recorded = { ok: false, status: 'unrecorded', ownershipError: cause };
      } else if (cause.deliveryJournalRecovery?.recoveryRequired) {
        recorded = {
          ok: false,
          status: 'unrecorded',
          journalRecovery: cause,
          diagnostic: deliveryJournalRecoveryDiagnostic(stableOutput, cause),
        };
      }
      journalError = cause;
    }
  }
  if (!recorded) {
    let artifact;
    let artifactBinding;
    const {
      captureRegularFileBinding,
      verifyRegularFileBinding,
      releaseRegularFileBinding,
    } = fileBindingRuntime || {};
    try {
      if (typeof captureRegularFileBinding === 'function') {
        const artifactCapture = captureRegularFileBinding(stableOutput, {
          subject: 'failed-delivery-artifact',
          expectedLinks: 1,
          includeContent: true,
        });
        if (artifactCapture.status === 'captured') {
          artifact = artifactCapture.content.buffer;
          artifactBinding = artifactCapture.binding;
        } else if (['ENOENT', 'ENOTDIR'].includes(artifactCapture.reason?.systemCode)) {
          recorded = { ok: true, status: 'absent' };
        }
        // A failed marker does not need an artifact hash to invalidate old
        // evidence. Non-regular or changing paths are never followed.
      }
      if (!recorded) {
      const provenancePath = state?.provenancePath || deliveryProvenancePath(stableOutput);
      let aliasesProtectedPath;
      try {
        aliasesProtectedPath = (input && pathsAlias(provenancePath, input))
          || pathsAlias(provenancePath, stableOutput);
      } catch (aliasError) {
        recorded = {
          ok: false,
          status: 'unrecorded',
          diagnostic: diagnostic({
            code: 'delivery/provenance-path-resolution',
            message: 'Delivery failure provenance could not resolve its target safely.',
            subject: { output: stableOutput, provenance: provenancePath },
            evidence: {
              reason: aliasError.message,
              ...(aliasError?.code ? { systemCode: aliasError.code } : {}),
            },
            supportedFixes: ['remove the sidecar path conflict or symbolic-link cycle, then rerun deliver'],
          }),
        };
      }
      if (!recorded && aliasesProtectedPath) {
        recorded = {
          ok: false,
          status: 'unrecorded',
          diagnostic: diagnostic({
            code: 'delivery/provenance-target-alias',
            message: 'Delivery failure provenance could not be recorded without replacing an input or the artifact.',
            subject: { output: stableOutput, provenance: provenancePath },
            evidence: { ...(input ? { input: path.resolve(input) } : {}) },
            supportedFixes: ['choose an output whose .delivery.json sidecar is distinct from every input and the HTML artifact'],
          }),
        };
      }
      if (!recorded) {
        try {
          writeCapturedDeliveryProvenance(provenancePath, {
            schemaVersion: 1,
            receiptId,
            status: 'failed',
            command: 'deliver',
            stage,
            input,
            output: stableOutput,
            ...(artifact ? { artifact: artifactIdentity(artifact) } : {}),
            error,
          }, {
            beforeCommit: () => {
              assertDeliveryOwnership(ownership, 'record failed delivery provenance', {
                allowInitializing: true,
                pending: state?.pendingIdentity ? 'owned' : 'ignore',
              });
              if (artifactBinding) {
                const verification = verifyRegularFileBinding(artifactBinding, {
                  filePath: stableOutput,
                  expectedLinks: 1,
                });
                if (verification.status !== 'match') {
                  throw deliveryTargetStateError(
                    stableOutput,
                    'failed delivery artifact',
                    verification,
                  );
                }
              }
            },
            capture: state?.deliveryTargets?.provenance,
            verifyAtomicOutput,
            fileBindingRuntime,
          });
          recorded = { ok: true, status: 'failed' };
        } catch (writeError) {
          if (writeError.deliveryOwnershipCode === 'delivery/ownership-lost') {
            recorded = { ok: false, status: 'unrecorded', ownershipError: writeError };
          } else if (writeError.deliveryProvenanceRecovery?.recoveryRequired) {
            const recovery = writeError.deliveryProvenanceRecovery;
            recorded = {
              ok: false,
              status: 'unrecorded',
              provenanceRecovery: writeError,
              diagnostic: diagnostic({
                code: 'delivery/provenance-recovery-required',
                message: 'Failed-delivery provenance could not be rolled back safely.',
                subject: { output: stableOutput, provenance: provenancePath },
                evidence: {
                  reason: writeError.message,
                  recoveryRequired: true,
                  ...(recovery.recoveryDirectory ? { recoveryDirectory: recovery.recoveryDirectory } : {}),
                  ...(recovery.recoveryFiles?.length ? { recoveryFiles: recovery.recoveryFiles } : {}),
                  ...(recovery.rollbackErrors?.length ? { rollbackErrors: recovery.rollbackErrors } : {}),
                },
                supportedFixes: ['leave the delivery lock and journal untouched, inspect the retained recovery files, then recover serially'],
              }),
            };
          } else if (writeError.deliveryTargetState) {
            recorded = {
              ok: false,
              status: 'unrecorded',
              diagnostic: writeError.archifyDiagnostics?.[0],
            };
          } else {
            recorded = {
              ok: false,
              status: 'unrecorded',
              diagnostic: diagnostic({
                code: 'delivery/provenance-write',
                message: 'The failed delivery could not persist its stale-artifact marker.',
                subject: { output: stableOutput, provenance: provenancePath },
                evidence: {
                  reason: writeError.message,
                  ...(writeError?.code ? { systemCode: writeError.code } : {}),
                  failureJournalRecorded: !journalError,
                  ...(journalError ? { journalError: journalError.message } : {}),
                },
                supportedFixes: ['restore write access to the output directory, then rerun deliver before trusting the artifact'],
              }),
            };
          }
        }
      }
      }
    } finally {
      if (artifactBinding && typeof releaseRegularFileBinding === 'function') {
        releaseRegularFileBinding(artifactBinding);
      }
    }
  }
  if (recorded?.journalRecovery || recorded?.provenanceRecovery) return recorded;
  if (acquiredHere || shouldReleaseSuppliedOwnership) {
    try {
      releaseDeliveryOwnership(ownership, { allowInitializing: true });
    } catch (lockError) {
      if (lockError.deliveryOwnershipCode === 'delivery/ownership-lost') {
        const ownershipError = recorded.ownershipError || lockError;
        if (options.recoveryDirectory) {
          ownershipError.deliveryCommitDetails = {
            ...(ownershipError.deliveryCommitDetails || {}),
            recoveryRequired: true,
            recoveryDirectory: options.recoveryDirectory,
            recoverableBackups: [],
          };
        }
        return {
          ...recorded,
          ok: false,
          status: 'unrecorded',
          ownershipError,
          lockError,
        };
      }
      return { ...recorded, lockError: recorded.ownershipError || lockError };
    }
  }
  return recorded;
}

function deliverySuccessProvenance(receipt) {
  return {
    schemaVersion: 1,
    receiptId: receipt.receiptId,
    status: 'current',
    command: 'deliver',
    type: receipt.type,
    input: receipt.input,
    output: receipt.output,
    specification: receipt.specification,
    artifact: receipt.artifact,
  };
}

function inspectDeliveryProvenance(artifactPath, artifact, {
  requireProvenance = false,
  pathIdentityRuntime,
  expectedSidecar,
  inspection,
} = {}) {
  let sidecar = deliveryProvenancePath(artifactPath);
  const rawHeadSidecar = rawHeadDeliveryProvenancePath(artifactPath);
  const pending = deliveryPendingPath(artifactPath);
  const rawHeadPending = rawHeadDeliveryPendingPath(artifactPath);
  const legacyExtensionPending = legacyExtensionDeliverySidecarPath(
    artifactPath,
    '.delivery-pending.json',
  );
  const legacyExtensionSidecar = legacyExtensionDeliverySidecarPath(
    artifactPath,
    '.delivery.json',
  );
  const stableOutput = canonicalExistingDeliveryOutput(artifactPath);
  const locks = [
    deliveryLockPath(stableOutput),
    ...legacyDeliveryLockPaths([artifactPath, stableOutput]),
  ];
  let foundPending;
  try {
    for (const candidate of [...new Set([
      pending,
      rawHeadPending,
      legacyExtensionPending,
    ].filter(Boolean))]) {
      if (pathEntryExists(candidate)) {
        foundPending = candidate;
        break;
      }
    }
    if (foundPending) {
      return {
        ok: false, status: 'failed',
        diagnostics: [diagnostic({
          code: 'delivery/provenance-failed',
          message: 'A delivery attempt is unfinished or failed; complete a successful deliver before trusting this artifact.',
          subject: { artifact: path.resolve(artifactPath), provenance: sidecar },
          evidence: { pendingJournal: foundPending, found: true },
          supportedFixes: ['finish any active delivery, then rerun deliver successfully; retain the pending journal until recovery succeeds'],
        })],
      };
    }
  } catch (error) {
    return invalidProvenance(artifactPath, foundPending || pending, error.message);
  }
  for (const lock of locks) {
    try {
      if (pathEntryExists(lock)) {
        return {
          ok: false, status: 'locked',
          diagnostics: [diagnostic({
            code: 'delivery/provenance-locked',
            message: 'Delivery ownership is unresolved while the output lock remains; complete or recover delivery before trusting this artifact.',
            subject: { artifact: path.resolve(artifactPath), lock },
            evidence: { deliveryLock: lock, found: true },
            supportedFixes: ['finish the active delivery or inspect and recover the preserved lock, then rerun deliver successfully'],
          })],
        };
      }
    } catch (error) {
      return invalidProvenance(artifactPath, lock, error.message);
    }
  }
  let found;
  try {
    found = pathEntryExists(sidecar);
  } catch (error) {
    return invalidProvenance(artifactPath, sidecar, error.message);
  }
  if (!found && rawHeadSidecar) {
    try {
      found = pathEntryExists(rawHeadSidecar);
      if (found) sidecar = rawHeadSidecar;
    } catch (error) {
      return invalidProvenance(artifactPath, rawHeadSidecar, error.message);
    }
  }
  if (!found && legacyExtensionSidecar) {
    try {
      found = pathEntryExists(legacyExtensionSidecar);
      if (found) sidecar = legacyExtensionSidecar;
    } catch (error) {
      return invalidProvenance(artifactPath, legacyExtensionSidecar, error.message);
    }
  }
  if (!found) {
    if (!requireProvenance) return { ok: true, status: 'unknown' };
    const message = 'Delivery provenance is required, but the artifact has no .delivery.json sidecar.';
    return {
      ok: false,
      status: 'unknown',
      diagnostics: [diagnostic({
        code: 'delivery/provenance-required',
        message,
        subject: { artifact: path.resolve(artifactPath), provenance: sidecar },
        evidence: { required: true, found: false },
        supportedFixes: ['rerun deliver for the current specification, then retry with --require-provenance'],
      })],
    };
  }
  let receipt;
  let sidecarCapture;
  try {
    const {
      captureRegularFileBinding,
      releaseRegularFileBinding,
    } = pathIdentityRuntime || {};
    if (typeof captureRegularFileBinding !== 'function'
      || typeof releaseRegularFileBinding !== 'function') {
      throw new Error('The regular-file binding runtime is unavailable.');
    }
    sidecarCapture = captureRegularFileBinding(sidecar, {
      subject: 'delivery-provenance',
      ...(expectedSidecar ? {
        expectedIdentity: expectedSidecar.identity,
        expectedSha256: expectedSidecar.content.sha256,
        expectedBytes: expectedSidecar.content.bytes,
        expectedMode: expectedSidecar.mode,
      } : {}),
      expectedLinks: 1,
      includeContent: true,
    });
    if (sidecarCapture.status !== 'captured') {
      if (sidecarCapture.reason?.code === 'delivery-provenance-hardlinked') {
      return {
        ok: false,
        status: 'unsupported',
        diagnostics: [diagnostic({
          code: 'delivery/provenance-hardlink-unsupported',
          message: 'Delivery provenance is hard-linked and cannot prove that every linked name was updated atomically.',
          subject: { artifact: path.resolve(artifactPath), provenance: sidecar },
          evidence: { links: sidecarCapture.reason.links },
          supportedFixes: ['remove extra hard links to the provenance sidecar, then rerun deliver'],
        })],
      };
      }
      throw new Error(`Delivery provenance is not a stable regular file (${sidecarCapture.reason?.code || 'unknown target state'}).`);
    }
    receipt = JSON.parse(sidecarCapture.content.buffer.toString('utf8'));
    const identityValid = (value) => value && typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sha256)
      && Number.isSafeInteger(value.bytes) && value.bytes >= 0;
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
      || receipt.schemaVersion !== 1 || receipt.command !== 'deliver'
      || typeof receipt.receiptId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receipt.receiptId)
      || typeof receipt.output !== 'string' || !path.isAbsolute(receipt.output)
      || typeof receipt.input !== 'string' || !path.isAbsolute(receipt.input)
      || !['current', 'failed'].includes(receipt.status)
      || (receipt.status === 'current' && (!TYPES.has(receipt.type)
        || !identityValid(receipt.specification) || !identityValid(receipt.artifact)))
      || (receipt.status === 'failed' && typeof receipt.stage !== 'string')) {
      throw new Error('Delivery provenance does not conform to the supported receipt schema.');
    }
    if (inspection) {
      inspection.sidecar = {
        path: sidecar,
        identity: {
          device: sidecarCapture.identity.device,
          inode: sidecarCapture.identity.inode,
        },
        content: {
          sha256: sidecarCapture.content.sha256,
          bytes: sidecarCapture.content.bytes,
        },
        mode: sidecarCapture.mode,
      };
    }
  } catch (error) {
    const message = `Could not read delivery provenance: ${error.message}`;
    return {
      ok: false,
      status: 'invalid',
      diagnostics: [diagnostic({
        code: 'delivery/provenance-invalid',
        message,
        subject: { artifact: path.resolve(artifactPath), provenance: sidecar },
        evidence: { reason: error.message },
        supportedFixes: ['rerun deliver to replace the invalid provenance sidecar'],
      })],
    };
  } finally {
    if (sidecarCapture?.binding) {
      pathIdentityRuntime.releaseRegularFileBinding(sidecarCapture.binding);
    }
  }
  let outputIdentity;
  if (typeof pathIdentityRuntime?.sameEntry !== 'function') {
    const error = pathIdentityRuntime?.error;
    outputIdentity = {
      status: 'unknown',
      reason: {
        code: 'path-semantics-runtime-unavailable',
        ...(typeof error?.code === 'string' ? { systemCode: error.code } : {}),
      },
    };
  } else {
    try {
      outputIdentity = pathIdentityRuntime.sameEntry(receipt.output, artifactPath);
    } catch (error) {
      outputIdentity = {
        status: 'unknown',
        reason: {
          code: 'path-identity-check-failed',
          ...(typeof error?.code === 'string' ? { systemCode: error.code } : {}),
        },
      };
    }
  }
  if (outputIdentity.status === 'unknown') {
    return {
      ok: false,
      status: 'invalid',
      diagnostics: [diagnostic({
        code: 'delivery/provenance-output-indeterminate',
        message: 'Delivery provenance could not determine whether its recorded output identifies the inspected artifact.',
        subject: {
          artifact: path.resolve(artifactPath),
          provenance: sidecar,
          recordedOutput: receipt.output,
        },
        evidence: { pathIdentity: outputIdentity.reason },
        supportedFixes: ['restore access to both the artifact and its recorded output path, then rerun deliver successfully'],
      })],
    };
  }
  if (outputIdentity.status !== 'match') {
    return invalidProvenance(
      artifactPath,
      sidecar,
      'The recorded delivery output does not identify this artifact.',
      { recordedOutput: receipt.output, pathIdentity: outputIdentity.reason },
    );
  }
  const actualSha256 = createHash('sha256').update(artifact).digest('hex');
  if (receipt.status === 'failed') {
    const message = 'The artifact is stale because the latest delivery attempt failed.';
    return {
      ok: false,
      status: 'failed',
      receiptId: receipt.receiptId,
      diagnostics: [diagnostic({
        code: 'delivery/provenance-failed',
        message,
        subject: { artifact: path.resolve(artifactPath), provenance: sidecar },
        evidence: { stage: receipt.stage, deliveryReceiptId: receipt.receiptId },
        supportedFixes: ['repair the specification and complete a successful deliver before checking this artifact'],
      })],
    };
  }
  if (receipt.artifact?.sha256 !== actualSha256 || receipt.artifact?.bytes !== artifact.byteLength) {
    const message = 'The artifact bytes do not match their delivery provenance.';
    return {
      ok: false,
      status: 'mismatch',
      receiptId: receipt.receiptId,
      diagnostics: [diagnostic({
        code: 'delivery/provenance-mismatch',
        message,
        subject: { artifact: path.resolve(artifactPath), provenance: sidecar },
        evidence: {
          expectedSha256: receipt.artifact?.sha256,
          actualSha256,
          expectedBytes: receipt.artifact?.bytes,
          actualBytes: artifact.byteLength,
        },
        supportedFixes: ['restore the delivered artifact or rerun deliver to create a matching artifact and provenance pair'],
      })],
    };
  }
  return { ok: true, status: 'current', receiptId: receipt.receiptId, artifact: receipt.artifact };
}

function invalidProvenance(artifactPath, sidecar, reason, evidence = {}) {
  return {
    ok: false, status: 'invalid',
    diagnostics: [diagnostic({
      code: 'delivery/provenance-invalid', message: 'Delivery provenance could not be verified.',
      subject: { artifact: artifactPath, provenance: sidecar }, evidence: { reason, ...evidence },
      supportedFixes: ['restore access to the delivery records, then rerun deliver successfully'],
    })],
  };
}

function usage() {
  return `Usage:
  archify render <type> <input.json> [output.html] [--quality standard|showcase] [--repo-root path]
  archify compare architecture <base.json> <head.json> [output.html] [--receipt path] [--json] [--quality standard|showcase] [--repo-root path]
  archify deliver <type> <input.json> [output.html] [--json] [--open] [--quality standard|showcase] [--repo-root path]
  archify preview <type> <input.json> [output.html] [--no-open] [--quality standard|showcase] [--repo-root path]
  archify validate <type> <input.json> [--json] [--layout-json] [--quality standard|showcase] [--repo-root path]
  archify migrate workflow <old.json> <new.json> --to-schema 2 [--output portable.html] [--json] [--repo-root path]
  archify inspect <type> <input.json>
  archify check <output.html> [--require-provenance]
  archify visual-check <output.html> [--json] [--require-provenance] [--out-dir <dir>]
  archify guide [scenario or question] [--json] [--lang en|zh]
  archify brands [name, alias, domain, or category] [--json]
  archify brands capture <url> [--json]
  archify examples
  archify doctor
  archify demo [output-directory]

Types:
  architecture, workflow, sequence, dataflow, lifecycle
  deliver also supports atlas (local architecture atlas manifest)
`;
}

function fail(message, code = 2) {
  console.error(message);
  process.exit(code);
}

function rejectCliArgument(message, details = {}) {
  const error = new Error(message);
  error.archifyArgument = {
    code: details.code || 'cli/invalid-arguments',
    subject: details.subject || {},
    evidence: details.evidence || {},
    supportedFixes: details.supportedFixes || ['correct the command arguments and retry'],
  };
  throw error;
}

function rendererPath(type) {
  if (!TYPES.has(type)) {
    rejectCliArgument(`Unknown diagram type "${type}". Expected one of: ${[...TYPES].join(', ')}`, {
      code: 'cli/unknown-diagram-type',
      subject: { type },
      evidence: { supportedTypes: [...TYPES] },
      supportedFixes: [`use one of: ${[...TYPES].join(', ')}`],
    });
  }
  return path.join(skillRoot, 'renderers', type, `render-${type}.mjs`);
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    stdio: options.stdio || 'inherit',
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
}

function extractQualityArgs(args) {
  const rest = [];
  let quality;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--quality') {
      quality = args[index + 1];
      if (!quality || quality.startsWith('--')) rejectCliArgument('--quality requires standard or showcase.', {
        code: 'cli/missing-option-value',
        subject: { option: '--quality' },
        supportedFixes: ['provide --quality standard or --quality showcase'],
      });
      index += 1;
      continue;
    }
    if (arg.startsWith('--quality=')) {
      quality = arg.slice('--quality='.length);
      if (!quality) rejectCliArgument('--quality requires standard or showcase.', {
        code: 'cli/missing-option-value',
        subject: { option: '--quality' },
        supportedFixes: ['provide --quality standard or --quality showcase'],
      });
      continue;
    }
    rest.push(arg);
  }
  if (quality !== undefined && !['standard', 'showcase'].includes(quality)) {
    rejectCliArgument(`Unknown quality profile "${quality}". Expected standard or showcase.`, {
      code: 'cli/invalid-option-value',
      subject: { option: '--quality' },
      evidence: { value: quality, supportedValues: ['standard', 'showcase'] },
      supportedFixes: ['use --quality standard or --quality showcase'],
    });
  }
  return { rest, quality };
}

function extractRepoRootArgs(args) {
  const rest = [];
  let repoRoot;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--repo-root') {
      repoRoot = args[index + 1];
      if (!repoRoot || repoRoot.startsWith('--')) rejectCliArgument('--repo-root requires a repository path.', {
        code: 'cli/missing-option-value',
        subject: { option: '--repo-root' },
        supportedFixes: ['provide one repository path after --repo-root'],
      });
      index += 1;
      continue;
    }
    if (arg.startsWith('--repo-root=')) {
      repoRoot = arg.slice('--repo-root='.length);
      if (!repoRoot) rejectCliArgument('--repo-root requires a repository path.', {
        code: 'cli/missing-option-value',
        subject: { option: '--repo-root' },
        supportedFixes: ['provide one repository path after --repo-root'],
      });
      continue;
    }
    rest.push(arg);
  }
  return { rest, repoRoot: repoRoot ? path.resolve(repoRoot) : undefined };
}

function extractOutDirArgs(args) {
  const rest = [];
  let outDir;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--out-dir') {
      outDir = args[index + 1];
      if (!outDir || outDir.startsWith('--')) fail('--out-dir requires a directory path.');
      index += 1;
      continue;
    }
    if (arg.startsWith('--out-dir=')) {
      outDir = arg.slice('--out-dir='.length);
      if (!outDir) fail('--out-dir requires a directory path.');
      continue;
    }
    rest.push(arg);
  }
  return { rest, outDir };
}

function rendererEnv(quality, repoRoot, diagnosticJson = false) {
  return {
    ...(quality ? { ARCHIFY_QUALITY_PROFILE: quality } : {}),
    ...(repoRoot ? { ARCHIFY_REPO_ROOT: repoRoot } : {}),
    ...(diagnosticJson ? { ARCHIFY_DIAGNOSTIC_FORMAT: 'json' } : {}),
  };
}

function diagnostic({ code, message, subject = {}, evidence = {}, supportedFixes = [], severity = 'error' }) {
  return {
    code,
    severity,
    message,
    subject,
    evidence,
    supportedFixes,
  };
}

function deliveryLockFailureDiagnostic(output, error) {
  const code = error.deliveryOwnershipCode || error.deliveryLockCode || 'delivery/lock-acquire';
  if (code === 'delivery/legacy-pending') {
    return diagnostic({
      code,
      message: `A pre-namespace delivery journal blocks delivery for "${output}".`,
      subject: { output, journal: error.deliveryLockPath },
      evidence: { pendingJournal: error.deliveryLockPath, found: true },
      supportedFixes: ['recover the unfinished delivery and remove only its journal after recovery succeeds'],
    });
  }
  const lock = error.deliveryOwnershipDetails?.lock
    || error.deliveryLockPath
    || deliveryLockPath(output);
  return diagnostic({
    code,
    message: code === 'delivery/lock-release'
      ? `Delivery lock could not be released for "${output}": ${error.message}`
      : code === 'delivery/ownership-lost'
        ? `Delivery ownership was lost for "${output}": ${error.message}`
        : `Could not start delivery for "${output}": ${error.message}`,
    subject: { output, lock },
    evidence: {
      reason: error.message,
      ...(error.code ? { systemCode: error.code } : {}),
      ...(error.lockCleanupError ? { cleanupError: error.lockCleanupError } : {}),
      ...(error.deliveryLockOwner || {}),
      ...(error.deliveryOwnershipDetails || {}),
      ...(error.deliveryCommitDetails || {}),
    },
    supportedFixes: code === 'delivery/concurrent-attempt'
        ? ['wait for the active delivery to finish, then retry']
      : code === 'delivery/lock-stale'
        ? [
          'confirm no delivery attempt is active for this output',
          `remove only the preserved lock "${lock}", then rerun deliver successfully`,
        ]
      : code === 'delivery/lock-path-conflict'
        ? ['choose an output whose lock path is distinct from the input specification']
        : code === 'delivery/lock-invalid'
          ? ['inspect and preserve the unrecognized lock entry, or choose another output path']
          : code === 'delivery/ownership-lost'
            ? ['leave the replacement lock and journal untouched, inspect the reported owner, then retry only after that attempt finishes or is recovered']
            : code === 'delivery/lock-release'
              ? ['preserve the reported lock, restore permission to remove that exact entry, then recover serially before retrying']
          : ['resolve the reported filesystem error and any lock cleanup error, then retry'],
  });
}

function deliveryJournalRecoveryDiagnostic(output, error) {
  const recovery = error.deliveryJournalRecovery || {};
  const location = recovery.recoveryDirectory
    ? ` Recovery material was retained at "${recovery.recoveryDirectory}".`
    : '';
  return diagnostic({
    code: 'delivery/journal-recovery-required',
    message: `Delivery journal publication could not be rolled back safely.${location}`,
    subject: { output, journal: recovery.journal || deliveryPendingPath(output) },
    evidence: {
      reason: error.message,
      recoveryRequired: true,
      ...(recovery.recoveryDirectory ? { recoveryDirectory: recovery.recoveryDirectory } : {}),
      ...(recovery.recoveryFiles?.length ? { recoveryFiles: recovery.recoveryFiles } : {}),
      ...(recovery.rollbackErrors?.length ? { rollbackErrors: recovery.rollbackErrors } : {}),
    },
    supportedFixes: recovery.recoveryDirectory
      ? [
        'leave the delivery lock and current journal claimant untouched',
        `inspect every recovery file in ${JSON.stringify(recovery.recoveryDirectory)} and restore the previous journal only after the claimant is resolved`,
      ]
      : ['leave the delivery lock and journal untouched, inspect their current owners, then recover serially'],
  });
}

function deliveryCommitRecoveryDiagnostic(output, error) {
  const recovery = error.deliveryCommitDetails || {};
  return diagnostic({
    code: 'delivery/commit-recovery-required',
    message: `Delivery rollback could not safely restore the previous output pair for "${output}".`,
    subject: { output },
    evidence: {
      reason: recovery.reason || error.message,
      recoveryRequired: true,
      ...(recovery.recoveryDirectory ? { recoveryDirectory: recovery.recoveryDirectory } : {}),
      ...(recovery.recoverableBackups?.length
        ? { recoverableBackups: recovery.recoverableBackups }
        : {}),
      ...(recovery.rollbackErrors?.length ? { rollbackErrors: recovery.rollbackErrors } : {}),
    },
    supportedFixes: [
      'leave the delivery lock, journal, current claimants, and retained backups untouched',
      'inspect the reported files and restore the previous pair only after resolving every claimant',
    ],
  });
}

function deliveryTargetStateDiagnostic(output, role, result) {
  const reason = result?.reason || { code: 'target-state-unavailable' };
  const hardlinked = typeof reason.code === 'string' && reason.code.endsWith('-hardlinked');
  const provenanceTarget = /provenance/iu.test(role);
  const code = hardlinked
    ? provenanceTarget ? 'delivery/provenance-hardlink-unsupported' : 'output/target-hardlinked'
    : ['target-not-regular-file', 'requested-entry-symbolic-link', 'requested-entry-not-regular-file'].includes(reason.code)
      ? 'output/target-not-regular-file'
      : result?.status === 'different'
        ? 'output/target-changed'
        : 'output/target-indeterminate';
  const message = hardlinked
    ? `The ${role} target is hard-linked and cannot be replaced atomically.`
    : code === 'output/target-not-regular-file'
      ? `The ${role} target is not a regular file.`
      : code === 'output/target-changed'
        ? `The ${role} target changed while the verified delivery pair was being prepared.`
        : `The ${role} target identity could not be determined safely.`;
  return diagnostic({
    code,
    message,
    subject: { output: path.resolve(output), role },
    evidence: { targetState: reason },
    supportedFixes: hardlinked
      ? ['remove extra hard links or choose a new output path, then rerun deliver']
      : code === 'output/target-not-regular-file'
        ? ['choose an absent or regular-file target, then rerun deliver']
        : code === 'output/target-changed'
          ? ['retry only after other processes stop creating, replacing, retargeting, or changing the output pair']
          : ['use an ordinary local filesystem path with stable file identity, then retry'],
  });
}

function deliveryTargetStateError(output, role, result) {
  const issue = deliveryTargetStateDiagnostic(output, role, result);
  const error = new Error(issue.message);
  error.archifyDiagnostics = [issue];
  error.deliveryTargetState = result;
  return error;
}

function captureDeliveryTargetState({
  state,
  requestedOutput,
  pathsAlias,
  captureAtomicOutput,
  verifyAtomicOutput,
  preparedTargets,
}) {
  if (typeof captureAtomicOutput !== 'function' || typeof verifyAtomicOutput !== 'function') {
    throw deliveryTargetStateError(requestedOutput, 'delivery pair', {
      status: 'unknown',
      reason: { code: 'atomic-output-runtime-unavailable' },
    });
  }
  const artifactTarget = preparedTargets?.artifact || {
    requestedPath: requestedOutput,
    ...captureAtomicOutput(requestedOutput),
  };
  if (artifactTarget.status !== 'captured') {
    throw deliveryTargetStateError(requestedOutput, 'HTML artifact', artifactTarget);
  }
  if (!pathsAlias(artifactTarget.commitPath, state.output)) {
    throw deliveryTargetStateError(requestedOutput, 'HTML artifact', {
      status: 'different',
      reason: {
        code: 'write-slot-changed-before-snapshot',
        plannedCommitPath: state.output,
        currentCommitPath: artifactTarget.commitPath,
      },
    });
  }
  const requestedProvenancePath = preparedTargets?.provenance?.requestedPath
    || deliveryProvenancePath(artifactTarget.commitPath);
  const provenanceTarget = preparedTargets?.provenance || {
    requestedPath: requestedProvenancePath,
    ...captureAtomicOutput(requestedProvenancePath, {
      requestedEntryPolicy: 'regular-or-absent',
    }),
  };
  if (provenanceTarget.status !== 'captured') {
    throw deliveryTargetStateError(requestedProvenancePath, 'delivery provenance', provenanceTarget);
  }
  for (const [role, target] of [
    ['HTML artifact', artifactTarget],
    ['delivery provenance', provenanceTarget],
  ]) {
    const verification = verifyAtomicOutput(target.snapshot);
    if (verification.status !== 'match') {
      throw deliveryTargetStateError(target.requestedPath, role, verification);
    }
  }
  state.output = artifactTarget.commitPath;
  state.provenancePath = provenanceTarget.commitPath;
  state.pendingPath = deliveryPendingPath(artifactTarget.commitPath);
  state.verifyAtomicOutput = verifyAtomicOutput;
  state.deliveryTargets = {
    artifact: artifactTarget,
    provenance: provenanceTarget,
  };
  return state.deliveryTargets;
}

function inputDiagnostic(error, inputPath) {
  const isSyntax = error instanceof SyntaxError;
  return diagnostic({
    code: isSyntax ? 'input/json-parse' : 'input/read',
    message: isSyntax
      ? `Input JSON could not be parsed: ${error.message}`
      : `Input could not be read: ${error.message}`,
    subject: { input: inputPath },
    evidence: {
      ...(error?.code ? { systemCode: error.code } : {}),
      reason: error.message,
    },
    supportedFixes: [isSyntax
      ? 'repair the JSON syntax and run validation again'
      : 'provide one readable JSON input file'],
  });
}

function rendererFailure(result) {
  if (result.error) {
    return {
      error: 'Renderer process could not start.',
      diagnostics: [diagnostic({
        code: 'internal/renderer-process',
        message: 'Renderer process could not start.',
        evidence: { reason: result.error.message },
      })],
    };
  }
  try {
    const payload = JSON.parse((result.stderr || '').trim());
    if (payload?.ok === false && Array.isArray(payload.diagnostics) && payload.diagnostics.length) {
      return {
        error: payload.error || payload.diagnostics[0].message,
        diagnostics: payload.diagnostics,
      };
    }
  } catch {
    // The diagnostic boundary is intentionally fail-closed. Never copy a raw
    // Node stack into a machine receipt when a renderer exits unexpectedly.
  }
  return {
    error: 'Renderer failed before emitting a structured diagnostic.',
    diagnostics: [diagnostic({
      code: 'internal/unclassified',
      message: 'Renderer failed before emitting a structured diagnostic.',
      evidence: { exitCode: result.status ?? 1 },
    })],
  };
}

const COMPOSITION_CHECKS = new Set([
  'label_route_clearance',
  'relationship_crossings',
  'relationship_corridors',
  'container_border_runs',
  'route_rhythm',
]);

const CHECK_FIXES = {
  single_svg: ['remove additional SVG roots so the artifact contains exactly one diagram SVG'],
  finite_svg: ['replace non-finite coordinates before rendering again'],
  orthogonal_arrows: ['use renderer-supported orthogonal routing controls'],
  legend_clearance: ['move the route or enlarge the viewBox so relationships do not enter the legend'],
};

const COMPOSITION_FIXES = {
  'composition/proper-crossing': ['adjust route/via or channel coordinates so unrelated relationships use separate corridors'],
  'composition/ambiguous-corridor': ['adjust route/via or channel coordinates so unrelated relationships do not visually merge'],
  'composition/container-border-run': ['route across the frame perpendicularly through a clear opening'],
  'composition/label-route-clearance': ['adjust labelAt, labelDx, labelDy, labelSegment, message y, or the other relationship route'],
  'composition/label-canvas-containment': ['adjust labelAt, labelDx, labelDy, or labelSegment so the label rect stays inside the viewBox, or enlarge meta.viewBox'],
  'composition/desktop-readability': ['reduce the viewBox width, shorten node copy, widen affected nodes, or split the diagram so node context remains at least 6px at a 1440px desktop viewport'],
  'composition/micro-segment': ['move the route/channel/via point so every visible segment is at least 8px'],
  'composition/short-interior-segment': ['move the route/channel/via point so every interior turn has at least 16px'],
};

function checkerDiagnostics(checker) {
  const diagnostics = [];
  for (const issue of checker?.composition?.issues || []) {
    if (issue.severity !== 'error') continue;
    const { severity, code, relationship, nodeId, ...evidence } = issue;
    diagnostics.push(diagnostic({
      code,
      severity,
      message: `Final artifact failed ${code}.`,
      subject: relationship ? { relationship } : { check: 'composition', ...(nodeId ? { nodeId } : {}) },
      evidence,
      supportedFixes: COMPOSITION_FIXES[code] || [],
    }));
  }
  for (const check of checker?.checks || []) {
    if (check.ok || COMPOSITION_CHECKS.has(check.name)) continue;
    diagnostics.push(diagnostic({
      code: `artifact/${check.name.replaceAll('_', '-')}`,
      message: (check.details || []).find(Boolean) || `Final artifact failed ${check.name}.`,
      subject: { check: check.name },
      evidence: { details: check.details || [] },
      supportedFixes: CHECK_FIXES[check.name] || [],
    }));
  }
  return diagnostics.length ? diagnostics : [diagnostic({
    code: 'artifact/check-failed',
    message: 'Final artifact check failed without a classified diagnostic.',
    subject: { check: 'unknown' },
    evidence: {},
  })];
}

function formatDiagnostics(error, diagnostics = []) {
  if (!diagnostics.length) return error;
  return [
    error,
    ...diagnostics.map((entry) => {
      const fix = entry.supportedFixes?.length ? ` Fix: ${entry.supportedFixes.join('; ')}.` : '';
      return `[${entry.code}] ${entry.message}${fix}`;
    }),
  ].join('\n');
}

function exitFrom(result) {
  if (result.error) fail(result.error.message, 1);
  process.exit(result.status ?? 1);
}

function reportCompareFailure({ json, stage, error, code = 'delta/internal', details = {}, status = 1 }) {
  const receipt = {
    schemaVersion: 1,
    ok: false,
    command: 'compare',
    type: 'architecture',
    stage,
    error,
    diagnostics: [{
      code,
      severity: 'error',
      message: error,
      subject: details.side ? { side: details.side, ...(details.path ? { path: details.path } : {}) } : {},
      evidence: Object.fromEntries(Object.entries(details).filter(([key]) => !['side', 'path', 'supportedFixes'].includes(key))),
      supportedFixes: details.supportedFixes || [],
    }],
  };
  if (json) console.log(JSON.stringify(receipt, null, 2));
  else console.error(formatDiagnostics(error, receipt.diagnostics));
  process.exitCode = status;
}

function extractCompareOptions(args) {
  const positional = [];
  let receipt;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--receipt') {
      receipt = args[index + 1];
      if (!receipt || receipt.startsWith('--')) fail('--receipt requires a JSON output path.');
      index += 1;
      continue;
    }
    if (arg.startsWith('--receipt=')) {
      receipt = arg.slice('--receipt='.length);
      if (!receipt) fail('--receipt requires a JSON output path.');
      continue;
    }
    if (arg.startsWith('--')) fail(`Unknown compare option "${arg}".`);
    positional.push(arg);
  }
  return { positional, receipt, json };
}

function compareReceiptPath(outputPath) {
  const { directory, stem, options } = deliverySidecarNamespace(outputPath);
  return path.join(
    directory,
    `${boundedSidecarStem(stem, COMPARE_SIDECAR_SUFFIXES, options)}.receipt.json`,
  );
}

function compareCommitError(message, code, details = {}) {
  const error = new Error(message);
  error.compareStage = 'commit';
  error.compareCode = code;
  error.compareDetails = details;
  return error;
}

function compareAtomicOutputFailure(result, label, requestedPath, stage) {
  const reason = result.reason || { code: 'atomic-output-unknown' };
  let code = 'output/target-indeterminate';
  let message = `The compare ${label} target identity could not be verified safely.`;
  let supportedFixes = ['use an ordinary local filesystem path with stable file identity, then retry'];
  if (typeof reason.code === 'string' && reason.code.endsWith('-hardlinked')) {
    code = 'output/target-hardlinked';
    message = `The compare ${label} target has multiple hard links and cannot be replaced atomically.`;
    supportedFixes = [`choose a ${label} path that is absent or names a regular file with one link`];
  } else if (reason.code === 'target-not-regular-file') {
    code = 'output/target-not-regular-file';
    message = `The compare ${label} target is not a regular file.`;
    supportedFixes = [`choose an absent or regular-file path for the ${label}`];
  } else if (result.status === 'different') {
    code = 'output/target-changed';
    message = `The compare ${label} target changed while the artifact pair was being prepared.`;
    supportedFixes = ['retry after other processes stop creating, replacing, or redirecting compare outputs'];
  }
  return {
    stage,
    code,
    message,
    details: {
      side: label,
      path: requestedPath,
      atomicOutput: reason,
      supportedFixes,
    },
  };
}

function commitComparePair({
  htmlCandidate,
  htmlContent,
  receiptCandidate,
  receiptContent,
  outputCapture,
  receiptCapture,
  stagingDirectory,
  verifyAtomicOutput,
  fileBindingRuntime,
}) {
  const {
    backupPublicRegularFileBinding,
    captureRegularFileBinding,
    quarantineRemoveRegularFileBinding,
    verifyRegularFileBinding,
    releaseRegularFileBinding,
  } = fileBindingRuntime || {};
  const targets = [
    {
      label: 'HTML artifact', capture: outputCapture, candidate: htmlCandidate, content: htmlContent, backup: path.join(stagingDirectory, '.previous-output'),
    },
    {
      label: 'receipt', capture: receiptCapture, candidate: receiptCandidate, content: receiptContent, backup: path.join(stagingDirectory, '.previous-receipt'),
    },
  ];
  const targetChanged = (item, result) => {
    const normalized = typeof result === 'string'
      ? { status: 'different', reason: { code: result } }
      : result;
    const failure = compareAtomicOutputFailure(
      normalized,
      item.label,
      item.capture.snapshot.requestedPath,
      'commit',
    );
    const error = compareCommitError(failure.message, failure.code, failure.details);
    error.compareFailure = failure;
    return error;
  };

  const backedUp = [];
  const committed = [];
  let retainSuccessfulBackupBindings = false;
  try {
    if (typeof backupPublicRegularFileBinding !== 'function'
      || typeof captureRegularFileBinding !== 'function'
      || typeof quarantineRemoveRegularFileBinding !== 'function'
      || typeof verifyRegularFileBinding !== 'function'
      || typeof releaseRegularFileBinding !== 'function') {
      throw targetChanged(targets[0], {
        status: 'unknown',
        reason: { code: 'atomic-output-runtime-unavailable' },
      });
    }
    // Re-resolve and bind both requested write slots and candidate inodes
    // before moving either target. The held handles keep bytes, mode and
    // identity authoritative across every publish/finalize transition.
    for (const item of targets) {
      const verification = verifyAtomicOutput(item.capture.snapshot);
      if (verification.status !== 'match') throw targetChanged(item, verification);
      if (item.capture.mode !== null) fs.chmodSync(item.candidate, item.capture.mode);
      const candidate = captureRegularFileBinding(item.candidate, {
        subject: 'compare-candidate',
        expectedSha256: item.content.sha256,
        expectedBytes: item.content.bytes,
        ...(item.capture.mode === null ? {} : { expectedMode: item.capture.mode }),
        expectedLinks: 1,
      });
      if (candidate.status !== 'captured') throw targetChanged(item, candidate);
      item.candidateBinding = candidate.binding;
      item.candidatePresent = true;
      item.candidateIdentity = {
        dev: candidate.identity.device,
        ino: candidate.identity.inode,
      };
      item.candidateMode = candidate.mode;
      if (item.capture.snapshot.target.kind === 'file') {
        const expected = item.capture.snapshot.target;
        const previous = captureRegularFileBinding(item.capture.commitPath, {
          subject: 'previous-compare-target',
          expectedIdentity: { device: expected.device, inode: expected.inode },
          expectedMode: expected.mode,
          expectedLinks: 1,
        });
        if (previous.status !== 'captured') throw targetChanged(item, previous);
        item.previousBinding = previous.binding;
      }
    }
    for (const item of targets) {
      if (item.capture.snapshot.target.kind !== 'file') continue;
      const moved = backupPublicRegularFileBinding(
        item.previousBinding,
        item.capture.commitPath,
        item.backup,
        { subject: 'previous-compare-target' },
      );
      item.backupPresent = moved.backupCreated === true;
      item.backupVerified = moved.backupVerified === true;
      if (item.backupPresent) backedUp.push(item);
      if (moved.status === 'recovery-required' && moved.recoveryFile) {
        item.backupRecovery = moved.recoveryFile;
      }
      if (moved.status !== 'backed-up') throw targetChanged(item, moved);
    }
    for (const item of targets) {
      const candidate = verifyRegularFileBinding(item.candidateBinding, {
        filePath: item.candidate,
        expectedLinks: 1,
      });
      if (candidate.status !== 'match') throw targetChanged(item, candidate);
      try {
        // linkSync is the no-clobber publish primitive: unlike renameSync, it
        // fails with EEXIST if another writer claims an absent slot after the
        // final snapshot verification.
        fs.linkSync(item.candidate, item.capture.commitPath);
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw targetChanged(
            item,
            'target-claimed-during-publish',
          );
        }
        throw error;
      }
      item.committedIdentity = item.candidateIdentity;
      committed.push(item);
      const linked = verifyRegularFileBinding(item.candidateBinding, {
        filePath: item.capture.commitPath,
        expectedLinks: 2,
      });
      if (linked.status !== 'match') throw targetChanged(item, linked);
    }
    for (const item of committed) {
      const current = verifyRegularFileBinding(item.candidateBinding, {
        filePath: item.capture.commitPath,
        expectedLinks: 2,
      });
      if (current.status !== 'match') throw targetChanged(item, current);
    }
    // The target remains the durable link. Removing the staging links inside
    // the transaction keeps successful outputs at nlink=1 even if the outer
    // best-effort staging-directory cleanup later fails.
    for (const item of committed) {
      const staged = verifyRegularFileBinding(item.candidateBinding, {
        filePath: item.candidate,
        expectedLinks: 2,
      });
      if (staged.status !== 'match') throw targetChanged(item, staged);
      const retired = quarantineRemoveRegularFileBinding(
        item.candidateBinding,
        item.candidate,
        { subject: 'compare-candidate', expectedLinks: 2 },
      );
      if (retired.status !== 'removed') throw targetChanged(item, retired);
      item.candidatePresent = false;
    }
    for (const item of committed) {
      const finalized = verifyRegularFileBinding(item.candidateBinding, {
        filePath: item.capture.commitPath,
        expectedLinks: 1,
      });
      if (finalized.status !== 'match') throw targetChanged(item, finalized);
    }
    retainSuccessfulBackupBindings = true;
    return {
      ownedBackupEntries: backedUp
        .filter((item) => item.backupPresent)
        .map((item) => ({
          filePath: item.backup,
          binding: item.previousBinding,
          subject: 'previous-compare-backup',
          expectedLinks: 1,
        })),
    };
  } catch (cause) {
    const rollbackErrors = [];
    const recoveryFiles = targets
      .filter((item) => item.backupRecovery)
      .map((item) => ({
        backup: item.backupRecovery,
        target: item.capture.commitPath,
        verifiedPrevious: false,
      }));
    for (const item of [...committed].reverse()) {
      try {
        const removed = quarantineRemoveRegularFileBinding(
          item.candidateBinding,
          item.capture.commitPath,
          {
            subject: 'published-compare-target',
            expectedLinks: item.candidatePresent ? 2 : 1,
          },
        );
        if (removed.status !== 'removed') {
          if (removed.status === 'recovery-required') {
            recoveryFiles.push({
              backup: removed.recoveryFile,
              target: item.capture.commitPath,
            });
          }
          throw new Error(`the committed target could not be removed safely (${removed.reason?.code || 'unknown target state'})`);
        }
      } catch (error) {
        rollbackErrors.push(`${item.label}: remove failed (${error.message})`);
      }
    }
    for (const item of [...backedUp].reverse()) {
      try {
        if (pathEntryExists(item.capture.commitPath)) {
          const current = item.candidateBinding
            ? verifyRegularFileBinding(item.candidateBinding, {
              filePath: item.capture.commitPath,
              expectedLinks: item.candidatePresent ? 2 : 1,
            })
            : { status: 'different' };
          if (current.status !== 'match') {
            throw new Error(`a changed target claimant prevents restoring the previous file (${current.reason?.code || 'unknown target state'})`);
          }
          const removed = quarantineRemoveRegularFileBinding(
            item.candidateBinding,
            item.capture.commitPath,
            {
              subject: 'published-compare-target',
              expectedLinks: item.candidatePresent ? 2 : 1,
            },
          );
          if (removed.status !== 'removed') {
            if (removed.status === 'recovery-required') {
              recoveryFiles.push({
                backup: removed.recoveryFile,
                target: item.capture.commitPath,
              });
            }
            throw new Error(`the committed target could not be removed safely (${removed.reason?.code || 'unknown target state'})`);
          }
        }
        if (item.backupVerified !== true) {
          throw new Error('the backup entry was never verified as the previous file');
        }
        const currentBackup = verifyRegularFileBinding(item.previousBinding, {
          filePath: item.backup,
          expectedLinks: 1,
        });
        if (currentBackup.status !== 'match') {
          item.backupVerified = false;
          throw new Error('the recoverable backup was replaced before rollback');
        }
        // Publish the previous file without clobbering a claimant that appears
        // after the absence check. The backup remains the recovery source until
        // the restored hard link has been identity-verified.
        fs.linkSync(item.backup, item.capture.commitPath);
        for (const restoredPath of [item.capture.commitPath, item.backup]) {
          const restored = verifyRegularFileBinding(item.previousBinding, {
            filePath: restoredPath,
            expectedLinks: 2,
          });
          if (restored.status !== 'match') {
            throw new Error('the restored target identity could not be verified');
          }
        }
        const retired = quarantineRemoveRegularFileBinding(
          item.previousBinding,
          item.backup,
          { subject: 'previous-compare-target', expectedLinks: 2 },
        );
        if (retired.status !== 'removed') {
          throw new Error(`the restored backup could not be retired safely (${retired.reason?.code || 'unknown target state'})`);
        }
        item.backupPresent = false;
        const finalized = verifyRegularFileBinding(item.previousBinding, {
          filePath: item.capture.commitPath,
          expectedLinks: 1,
        });
        if (finalized.status !== 'match') {
          throw new Error('the restored target changed before rollback finalized');
        }
      } catch (error) {
        rollbackErrors.push(`${item.label}: restore failed (${error.message})`);
        // Track failed restoration rather than probing existence: a permission
        // error must not make cleanup discard a potentially recoverable backup.
        if (item.backupPresent !== false) {
          recoveryFiles.push({
            backup: item.backup,
            target: item.capture.commitPath,
            verifiedPrevious: item.backupVerified === true,
          });
        }
      }
    }
    if (!rollbackErrors.length && cause.compareFailure) {
      throw compareCommitError(
        cause.message,
        cause.compareFailure.code,
        {
          ...cause.compareFailure.details,
          reason: cause.message,
        },
      );
    }
    throw compareCommitError(
      (rollbackErrors.length
        ? 'Architecture Delta pair commit failed and its previous files could not be fully restored.'
        : 'Architecture Delta pair commit failed; the previous files were restored.')
        + (recoveryFiles.length
          ? ` Recovery directory retained at ${path.dirname(recoveryFiles[0].backup)}.`
          : ''),
      rollbackErrors.length ? 'delta/commit-rollback-failed' : 'delta/commit-failed',
      {
        reason: cause.message,
        ...(rollbackErrors.length ? { rollbackErrors } : {}),
        ...(recoveryFiles.length ? {
          recoveryDirectory: path.dirname(recoveryFiles[0].backup),
          recoveryDirectories: [...new Set(recoveryFiles.map(({ backup }) => path.dirname(backup)))],
          recoveryFiles,
        } : {}),
        supportedFixes: recoveryFiles.length
          ? [
            ...recoveryFiles.map(({ backup, target, verifiedPrevious }) => verifiedPrevious
              ? `resolve the filesystem error, inspect the current target, then restore ${JSON.stringify(backup)} to ${JSON.stringify(target)} before retrying`
              : `preserve and inspect the unverified entry at ${JSON.stringify(backup)}; do not treat it as the previous file for ${JSON.stringify(target)}`),
            'remove the recovery directory only after the previous files have been recovered and verified',
          ]
          : ['check that both output paths are writable regular files, then retry'],
      },
    );
  } finally {
    for (const item of targets) {
      if (item.candidateBinding) releaseRegularFileBinding(item.candidateBinding);
      if (item.previousBinding
        && !(retainSuccessfulBackupBindings && item.backupPresent)) {
        releaseRegularFileBinding(item.previousBinding);
      }
    }
  }
}

function commitDeliveryPair({
  htmlCandidate,
  htmlContent,
  provenanceCandidate,
  provenanceContent,
  stagingDirectory,
  ownership,
  verifyAtomicOutput,
  fileBindingRuntime,
}) {
  const {
    backupPublicRegularFileBinding,
    captureRegularFileBinding,
    quarantineRemoveRegularFileBinding,
    verifyRegularFileBinding,
    releaseRegularFileBinding,
  } = fileBindingRuntime || {};
  const state = assertDeliveryOwnership(ownership, 'start the delivery pair commit', { pending: 'owned' });
  const snapshots = state.deliveryTargets;
  if (!snapshots?.artifact || !snapshots?.provenance) {
    throw deliveryTargetStateError(state.output, 'delivery pair', {
      status: 'unknown',
      reason: { code: 'target-snapshot-missing' },
    });
  }
  const targets = [
    {
      label: 'HTML artifact',
      target: snapshots.artifact.commitPath,
      candidate: htmlCandidate,
      content: htmlContent,
      backup: path.join(stagingDirectory, '.previous-output'),
      capture: snapshots.artifact,
    },
    {
      label: 'delivery provenance',
      target: snapshots.provenance.commitPath,
      candidate: provenanceCandidate,
      content: provenanceContent,
      backup: path.join(stagingDirectory, '.previous-provenance'),
      capture: snapshots.provenance,
    },
  ];
  const backedUp = [];
  const retainedBackups = new Set();
  const publicRecoveryBackups = [];
  let retainSuccessfulBackupBindings = false;
  const committed = [];
  try {
    if (typeof backupPublicRegularFileBinding !== 'function'
      || typeof captureRegularFileBinding !== 'function'
      || typeof quarantineRemoveRegularFileBinding !== 'function'
      || typeof verifyRegularFileBinding !== 'function'
      || typeof releaseRegularFileBinding !== 'function') {
      throw deliveryTargetStateError(state.output, 'delivery pair', {
        status: 'unknown',
        reason: { code: 'atomic-output-runtime-unavailable' },
      });
    }
    for (const item of targets) {
      const verification = verifyAtomicOutput(item.capture.snapshot);
      if (verification.status !== 'match') {
        throw deliveryTargetStateError(item.capture.requestedPath, item.label, verification);
      }
      if (item.capture.mode !== null) fs.chmodSync(item.candidate, item.capture.mode);
      const candidate = captureRegularFileBinding(item.candidate, {
        subject: 'delivery-candidate',
        expectedSha256: item.content.sha256,
        expectedBytes: item.content.bytes,
        ...(item.capture.mode === null ? {} : { expectedMode: item.capture.mode }),
        expectedLinks: 1,
      });
      if (candidate.status !== 'captured') {
        throw deliveryTargetStateError(item.capture.requestedPath, item.label, candidate);
      }
      item.candidateBinding = candidate.binding;
      item.candidatePresent = true;
      item.candidateIdentity = {
        dev: candidate.identity.device,
        ino: candidate.identity.inode,
      };
      item.candidateMode = candidate.mode;
      if (item.capture.snapshot.target.kind === 'file') {
        const expected = item.capture.snapshot.target;
        const previous = captureRegularFileBinding(item.target, {
          subject: 'previous-delivery-target',
          expectedIdentity: { device: expected.device, inode: expected.inode },
          expectedMode: expected.mode,
          expectedLinks: 1,
        });
        if (previous.status !== 'captured') {
          throw deliveryTargetStateError(item.capture.requestedPath, item.label, previous);
        }
        item.previousBinding = previous.binding;
      }
    }
    for (const item of targets) {
      if (item.capture.snapshot.target.kind !== 'file') continue;
      assertDeliveryOwnership(ownership, `back up the ${item.label}`, { pending: 'owned' });
      const moved = backupPublicRegularFileBinding(
        item.previousBinding,
        item.target,
        item.backup,
        { subject: 'previous-delivery-target' },
      );
      item.backupPresent = moved.backupCreated === true;
      item.backupVerified = moved.backupVerified === true;
      if (item.backupPresent) backedUp.push(item);
      if (moved.status === 'recovery-required' && moved.recoveryFile) {
        publicRecoveryBackups.push({
          label: `preserved replacement for ${item.label}`,
          path: moved.recoveryFile,
          target: item.target,
        });
      }
      if (moved.status !== 'backed-up') {
        throw deliveryTargetStateError(item.capture.requestedPath, item.label, moved);
      }
      retainedBackups.add(item);
    }
    for (const item of targets) {
      assertDeliveryOwnership(ownership, `commit the ${item.label}`, { pending: 'owned' });
      const candidate = verifyRegularFileBinding(item.candidateBinding, {
        filePath: item.candidate,
        expectedLinks: 1,
      });
      if (candidate.status !== 'match') {
        throw deliveryTargetStateError(item.capture.requestedPath, item.label, candidate);
      }
      try {
        fs.linkSync(item.candidate, item.target);
      } catch (error) {
        if (error?.code === 'EEXIST') {
          throw deliveryTargetStateError(item.capture.requestedPath, item.label, {
            status: 'different',
            reason: { code: 'target-claimed-during-publish' },
          });
        }
        throw error;
      }
      item.committedIdentity = item.candidateIdentity;
      committed.push(item);
      const linked = verifyRegularFileBinding(item.candidateBinding, {
        filePath: item.target,
        expectedLinks: 2,
      });
      if (linked.status !== 'match') {
        throw deliveryTargetStateError(item.capture.requestedPath, item.label, linked);
      }
    }
    for (const item of committed) {
      assertDeliveryOwnership(ownership, `verify the committed ${item.label}`, { pending: 'owned' });
      const current = verifyRegularFileBinding(item.candidateBinding, {
        filePath: item.target,
        expectedLinks: 2,
      });
      if (current.status !== 'match') {
        throw deliveryTargetStateError(item.capture.requestedPath, item.label, current);
      }
    }
    for (const item of committed) {
      const staged = verifyRegularFileBinding(item.candidateBinding, {
        filePath: item.candidate,
        expectedLinks: 2,
      });
      if (staged.status !== 'match') {
        throw deliveryTargetStateError(item.capture.requestedPath, item.label, staged);
      }
      const retired = quarantineRemoveRegularFileBinding(
        item.candidateBinding,
        item.candidate,
        { subject: 'delivery-candidate', expectedLinks: 2 },
      );
      if (retired.status !== 'removed') {
        throw deliveryTargetStateError(item.capture.requestedPath, item.label, retired);
      }
      item.candidatePresent = false;
    }
    for (const item of committed) {
      const finalized = verifyRegularFileBinding(item.candidateBinding, {
        filePath: item.target,
        expectedLinks: 1,
      });
      if (finalized.status !== 'match') {
        throw deliveryTargetStateError(item.capture.requestedPath, item.label, finalized);
      }
    }
    // Finalization is part of the commit: keep the old files recoverable until
    // the journal has been removed and checkers can accept the new artifact.
    assertDeliveryOwnership(ownership, 'finalize the delivery journal', { pending: 'owned' });
    quarantineRemoveOwnedDeliveryEntry(state, {
      filePath: state.pendingPath,
      identity: state.pendingIdentity,
      content: state.pendingContent,
      subject: 'delivery-journal',
      operation: 'finalize the delivery journal',
      evidenceKey: 'journal',
    });
    assertDeliveryOwnership(ownership, 'finish finalizing the delivery journal', { pending: 'absent' });
    state.pendingIdentity = undefined;
    state.pendingContent = undefined;
    state.phase = 'finalized';
    retainSuccessfulBackupBindings = true;
    return {
      recoverableBackups: [
        ...[...retainedBackups].map((item) => ({ label: item.label, path: item.backup })),
        ...publicRecoveryBackups,
      ],
      ownedBackupEntries: backedUp
        .filter((item) => item.backupPresent)
        .map((item) => ({
          filePath: item.backup,
          binding: item.previousBinding,
          subject: 'previous-delivery-backup',
          expectedLinks: 1,
        })),
    };
  } catch (cause) {
    const recoveryDetails = () => ({
      recoveryRequired: true,
      recoveryDirectory: stagingDirectory,
      recoverableBackups: [
        ...[...retainedBackups].map((item) => ({ label: item.label, path: item.backup })),
        ...publicRecoveryBackups,
      ],
    });
    if (cause.deliveryOwnershipCode === 'delivery/ownership-lost') {
      cause.deliveryCommitDetails = { ...(cause.deliveryCommitDetails || {}), ...recoveryDetails() };
      throw cause;
    }
    const rollbackErrors = [];
    const recoverableBackups = [];
    try {
      for (const item of [...committed].reverse()) {
        try {
          assertDeliveryOwnership(ownership, `roll back the ${item.label}`, { pending: 'identity' });
          const removed = quarantineRemoveRegularFileBinding(item.candidateBinding, item.target, {
            subject: 'published-delivery-target',
            expectedLinks: item.candidatePresent ? 2 : 1,
          });
          if (removed.status !== 'removed') {
            if (removed.status === 'recovery-required') {
              publicRecoveryBackups.push({
                label: `preserved replacement for ${item.label}`,
                path: removed.recoveryFile,
                target: item.target,
              });
            }
            throw new Error(`the committed target could not be removed safely (${removed.reason?.code || 'unknown target state'})`);
          }
        } catch (error) {
          if (error.deliveryOwnershipCode === 'delivery/ownership-lost') throw error;
          rollbackErrors.push(`${item.label}: remove failed (${error.message})`);
        }
      }
      for (const item of [...backedUp].reverse()) {
        try {
          assertDeliveryOwnership(ownership, `restore the previous ${item.label}`, { pending: 'identity' });
          if (pathEntryExists(item.target)) {
            const current = item.candidateBinding
              ? verifyRegularFileBinding(item.candidateBinding, {
                filePath: item.target,
                expectedLinks: item.candidatePresent ? 2 : 1,
              })
              : { status: 'different' };
            if (current.status !== 'match') {
              throw new Error(`a changed target claimant prevents restoring the previous file (${current.reason?.code || 'unknown target state'})`);
            }
            const removed = quarantineRemoveRegularFileBinding(item.candidateBinding, item.target, {
              subject: 'published-delivery-target',
              expectedLinks: item.candidatePresent ? 2 : 1,
            });
            if (removed.status !== 'removed') {
              if (removed.status === 'recovery-required') {
                publicRecoveryBackups.push({
                  label: `preserved replacement for ${item.label}`,
                  path: removed.recoveryFile,
                  target: item.target,
                });
              }
              throw new Error(`the committed target could not be removed safely (${removed.reason?.code || 'unknown target state'})`);
            }
          }
          assertDeliveryOwnership(ownership, `restore the previous ${item.label}`, { pending: 'identity' });
          if (item.backupVerified !== true) {
            throw new Error('the backup entry was never verified as the previous delivery file');
          }
          const currentBackup = verifyRegularFileBinding(item.previousBinding, {
            filePath: item.backup,
            expectedLinks: 1,
          });
          if (currentBackup.status !== 'match') {
            item.backupVerified = false;
            retainedBackups.delete(item);
            throw new Error('the previous delivery backup identity changed');
          }
          try {
            fs.linkSync(item.backup, item.target);
          } catch (error) {
            if (error?.code === 'EEXIST') {
              throw new Error('a new target claimant prevents restoring the previous file');
            }
            throw error;
          }
          for (const restoredPath of [item.target, item.backup]) {
            const restored = verifyRegularFileBinding(item.previousBinding, {
              filePath: restoredPath,
              expectedLinks: 2,
            });
            if (restored.status !== 'match') {
              throw new Error('the restored delivery target identity could not be verified');
            }
          }
          const retired = quarantineRemoveRegularFileBinding(
            item.previousBinding,
            item.backup,
            { subject: 'previous-delivery-target', expectedLinks: 2 },
          );
          if (retired.status !== 'removed') {
            throw new Error(`the restored delivery backup could not be retired safely (${retired.reason?.code || 'unknown target state'})`);
          }
          item.backupPresent = false;
          const restoredFinal = verifyRegularFileBinding(item.previousBinding, {
            filePath: item.target,
            expectedLinks: 1,
          });
          if (restoredFinal.status !== 'match') {
            throw new Error('the restored delivery target link count could not be verified');
          }
          retainedBackups.delete(item);
        } catch (error) {
          if (error.deliveryOwnershipCode === 'delivery/ownership-lost') throw error;
          rollbackErrors.push(`${item.label}: restore failed (${error.message})`);
          // A failed restoration leaves this exact backup at its source path.
          // Record it without probing the failing recovery path again.
          if (item.backupPresent !== false) {
            recoverableBackups.push({
              label: item.backupVerified === true
                ? item.label
                : `unverified preserved backup entry for ${item.label}`,
              path: item.backup,
              target: item.target,
              verifiedPrevious: item.backupVerified === true,
            });
          }
        }
      }
      assertDeliveryOwnership(ownership, 'finish the delivery rollback', { pending: 'identity' });
    } catch (rollbackError) {
      if (rollbackError.deliveryOwnershipCode === 'delivery/ownership-lost') {
        rollbackError.deliveryCommitDetails = {
          ...(rollbackError.deliveryCommitDetails || {}),
          commitError: {
            reason: cause.message,
            ...(cause?.code ? { systemCode: cause.code } : {}),
          },
          ...recoveryDetails(),
        };
        throw rollbackError;
      }
      rollbackErrors.push(rollbackError.message);
    }
    const error = new Error(rollbackErrors.length
      ? 'Delivery pair commit failed and its previous files could not be fully restored.'
      : 'Delivery pair commit failed; the previous files were restored.');
    error.deliveryCommitDetails = {
      reason: cause.message,
      ...(rollbackErrors.length ? {
        rollbackErrors,
        recoveryRequired: true,
        recoveryDirectory: stagingDirectory,
        recoverableBackups: [...recoverableBackups, ...publicRecoveryBackups],
      } : {}),
    };
    if (cause.deliveryTargetState) {
      error.deliveryTargetState = cause.deliveryTargetState;
      error.archifyDiagnostics = cause.archifyDiagnostics;
    }
    throw error;
  } finally {
    for (const item of targets) {
      if (item.candidateBinding) releaseRegularFileBinding(item.candidateBinding);
      if (item.previousBinding
        && !(retainSuccessfulBackupBindings && item.backupPresent)) {
        releaseRegularFileBinding(item.previousBinding);
      }
    }
  }
}

function renderValidatedArchitecture(inputPath, outputPath, quality, repoRoot, captureStagingFile) {
  const render = runNode([rendererPath('architecture'), inputPath, outputPath], {
    stdio: 'pipe',
    env: rendererEnv(quality, repoRoot, true),
  });
  if (render.status !== 0) {
    const failure = rendererFailure(render);
    const error = new Error(failure.error);
    error.compareStage = 'input';
    error.compareStatus = render.status ?? 1;
    error.diagnostics = failure.diagnostics;
    throw error;
  }
  let artifact;
  if (captureStagingFile) {
    artifact = fs.readFileSync(outputPath);
    captureStagingFile(outputPath, artifactIdentity(artifact));
  }
  const check = runNode([path.join(skillRoot, 'scripts/check-render-output.mjs'), outputPath], { stdio: 'pipe' });
  if (check.status !== 0) {
    const error = new Error('Validated snapshot failed final artifact checks.');
    error.compareStage = 'check';
    error.compareStatus = check.status ?? 1;
    try {
      error.checker = JSON.parse(check.stdout);
      error.diagnostics = checkerDiagnostics(error.checker);
    } catch {
      error.diagnostics = [];
    }
    throw error;
  }
  artifact ||= fs.readFileSync(outputPath);
  return {
    artifact,
    html: artifact.toString('utf8'),
    checks: JSON.parse(check.stdout),
    sourceEvidence: sourceEvidenceFromArtifact(artifact),
  };
}

async function commandCompare(args) {
  await loadSidecarPathRuntime();
  const {
    canonicalFuturePath,
    resolveOutputPath,
    validateAuthoredOutputPath,
  } = await import('../renderers/shared/output-path.mjs');
  const {
    captureAtomicOutput,
    verifyAtomicOutput,
    backupPublicRegularFileBinding,
    captureRegularFileBinding,
    quarantineRemoveRegularFileBinding,
    verifyRegularFileBinding,
    releaseRegularFileBinding,
  } = await import('../renderers/shared/atomic-output.mjs');
  const fileBindingRuntime = {
    backupPublicRegularFileBinding,
    captureRegularFileBinding,
    quarantineRemoveRegularFileBinding,
    verifyRegularFileBinding,
    releaseRegularFileBinding,
  };
  const {
    sameParent,
    sidecarNamespaceComponentKey,
  } = await import('../renderers/shared/path-semantics.mjs');
  sidecarNamespaceComponentKeyRuntime = sidecarNamespaceComponentKey;
  const qualityArgs = extractQualityArgs(args);
  const repoArgs = extractRepoRootArgs(qualityArgs.rest);
  const options = extractCompareOptions(repoArgs.rest);
  const [type, baseInput, headInput, requestedOutput] = options.positional;
  if (type !== 'architecture' || !baseInput || !headInput || options.positional.length > 4) fail(usage());
  let deltaRuntime;
  try {
    deltaRuntime = await import(pathToFileURL(path.join(skillRoot, 'delta/architecture-delta.mjs')).href);
  } catch (error) {
    reportCompareFailure({ json: options.json, stage: 'prepare', error: 'Architecture compare runtime is unavailable.', code: 'delta/runtime-missing', details: { reason: error.message, supportedFixes: ['install the complete Archify skill package'] } });
    return;
  }
  const {
    ArchitectureDeltaError,
    annotateArchitectureSideSvg,
    buildDeltaSvg,
    canonicalArchitecture,
    canonicalArchitectureJson,
    compareArchitecture,
    extractArchitectureSvg,
    extractArtifactCss,
    renderArchitectureDeltaHtml,
    validateArchitectureDeltaHtml,
  } = deltaRuntime;

  const basePath = path.resolve(baseInput);
  const headPath = path.resolve(headInput);
  const explicitReceiptTarget = options.receipt ? path.resolve(options.receipt) : undefined;
  const rawOutputTarget = requestedOutput || 'architecture-delta.html';
  const rawOutputExtension = path.extname(rawOutputTarget);
  // Preserve the established alias-first diagnostic for an already-invalid
  // CLI extension without letting this legacy spelling select the real
  // sidecar namespace for any valid compare output.
  const invalidOutputAliasPreflight = !explicitReceiptTarget
    && rawOutputExtension.toLowerCase() !== '.html'
    ? path.resolve(rawOutputExtension
      ? `${rawOutputTarget.slice(0, -rawOutputExtension.length)}.receipt.json`
      : `${rawOutputTarget}.receipt.json`)
    : undefined;
  let outputPath;
  try {
    ({ outputPath } = resolveOutputPath({
      requestedOutput,
      defaultOutput: 'architecture-delta.html',
      inputPaths: [basePath, headPath],
      otherOutputPaths: explicitReceiptTarget
        ? [explicitReceiptTarget]
        : (invalidOutputAliasPreflight ? [invalidOutputAliasPreflight] : []),
    }));
  } catch (error) {
    const outputDiagnostic = error.archifyDiagnostics?.[0];
    reportCompareFailure({
      json: options.json,
      stage: 'prepare',
      error: error.message,
      code: outputDiagnostic?.code || 'output/path-resolution',
      details: {
        ...(outputDiagnostic?.subject || {}),
        ...(outputDiagnostic?.evidence || {}),
        supportedFixes: outputDiagnostic?.supportedFixes || ['choose a safe output path and retry'],
      },
    });
    return;
  }
  const requestedOutputPath = outputPath;
  let receiptPath;
  let requestedReceiptPath;
  if (explicitReceiptTarget) {
    try {
      ({ outputPath: receiptPath } = resolveOutputPath({
        requestedOutput: options.receipt,
        defaultOutput: options.receipt,
        requiredExtension: '.json',
        inputPaths: [basePath, headPath],
        otherOutputPaths: [outputPath],
      }));
      requestedReceiptPath = receiptPath;
    } catch (error) {
      const outputDiagnostic = error.archifyDiagnostics?.[0];
      reportCompareFailure({
        json: options.json,
        stage: 'prepare',
        error: error.message,
        code: outputDiagnostic?.code || 'output/path-resolution',
        details: {
          ...(outputDiagnostic?.subject || {}),
          ...(outputDiagnostic?.evidence || {}),
          supportedFixes: outputDiagnostic?.supportedFixes || ['choose a safe receipt path and retry'],
        },
      });
      return;
    }
  }
  try {
    outputPath = canonicalFuturePath(requestedOutputPath);
    if (requestedReceiptPath) receiptPath = canonicalFuturePath(requestedReceiptPath);
  } catch (error) {
    const outputDiagnostic = error.archifyDiagnostics?.[0];
    reportCompareFailure({
      json: options.json,
      stage: 'prepare',
      error: error.message,
      code: outputDiagnostic?.code || 'output/path-resolution',
      details: {
        ...(outputDiagnostic?.subject || {}),
        ...(outputDiagnostic?.evidence || {}),
        supportedFixes: outputDiagnostic?.supportedFixes || ['choose safe compare output paths and retry'],
      },
    });
    return;
  }
  let baseBuffer;
  let headBuffer;
  let base;
  let head;
  try {
    baseBuffer = fs.readFileSync(basePath);
    base = JSON.parse(baseBuffer.toString('utf8'));
  } catch (error) {
    reportCompareFailure({ json: options.json, stage: 'input', error: `Could not read base input: ${error.message}`, code: 'delta/base-input', details: { side: 'base', reason: error.message } });
    return;
  }
  try {
    headBuffer = fs.readFileSync(headPath);
    head = JSON.parse(headBuffer.toString('utf8'));
  } catch (error) {
    reportCompareFailure({ json: options.json, stage: 'input', error: `Could not read head input: ${error.message}`, code: 'delta/head-input', details: { side: 'head', reason: error.message } });
    return;
  }

  for (const [side, document] of [['base', base], ['head', head]]) {
    try {
      validateAuthoredOutputPath(document?.meta?.output);
    } catch (error) {
      const diagnosticEntry = error.archifyDiagnostics?.[0];
      reportCompareFailure({
        json: options.json,
        stage: 'input',
        error: `${side === 'base' ? 'Base' : 'Head'} snapshot failed validation: ${error.message}`,
        code: diagnosticEntry?.code || `delta/${side}-validation`,
        details: {
          side,
          ...(diagnosticEntry?.subject?.path ? { path: diagnosticEntry.subject.path } : {}),
          ...(diagnosticEntry?.evidence || {}),
          supportedFixes: diagnosticEntry?.supportedFixes || [],
        },
      });
      return;
    }
  }

  let outputDirectory = path.dirname(outputPath);
  if (receiptPath) {
    const explicitReceiptDirectoryIdentity = sameParent(outputPath, receiptPath);
    if (explicitReceiptDirectoryIdentity.status === 'unknown') {
      reportCompareFailure({
        json: options.json,
        stage: 'prepare',
        error: 'The compare receipt directory identity could not be verified.',
        code: 'delta/receipt-directory-identity-indeterminate',
        details: {
          artifactDirectory: outputDirectory,
          receiptDirectory: path.dirname(receiptPath),
          pathIdentity: explicitReceiptDirectoryIdentity.reason,
          supportedFixes: ['restore access to both output directories or choose paths in one verifiable directory'],
        },
      });
      return;
    }
    if (explicitReceiptDirectoryIdentity.status !== 'match') {
      reportCompareFailure({
        json: options.json,
        stage: 'prepare',
        error: 'The compare receipt must be written beside the HTML artifact.',
        code: 'delta/receipt-directory',
        details: {
          artifactDirectory: outputDirectory,
          receiptDirectory: path.dirname(receiptPath),
          pathIdentity: explicitReceiptDirectoryIdentity.reason,
          supportedFixes: ['choose a --receipt path in the same directory as output.html'],
        },
      });
      return;
    }
  }
  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
  } catch (error) {
    reportCompareFailure({ json: options.json, stage: 'prepare', error: `Could not create compare output directory: ${error.message}`, code: 'delta/output-directory', details: { reason: error.message } });
    return;
  }

  if (!receiptPath) {
    try {
      const defaultReceiptPath = compareReceiptPath(outputPath);
      ({ outputPath: receiptPath } = resolveOutputPath({
        requestedOutput: defaultReceiptPath,
        defaultOutput: defaultReceiptPath,
        requiredExtension: '.json',
        inputPaths: [basePath, headPath],
        otherOutputPaths: [outputPath],
      }));
      requestedReceiptPath = receiptPath;
      receiptPath = canonicalFuturePath(requestedReceiptPath);
    } catch (error) {
      const outputDiagnostic = error.archifyDiagnostics?.[0];
      const namespaceIndeterminate = error?.code === 'ARCHIFY_SIDECAR_NAMESPACE_INDETERMINATE';
      reportCompareFailure({
        json: options.json,
        stage: 'prepare',
        error: error.message,
        code: namespaceIndeterminate
          ? 'delta/receipt-namespace-indeterminate'
          : outputDiagnostic?.code || 'output/path-resolution',
        details: {
          ...(outputDiagnostic?.subject || {}),
          ...(outputDiagnostic?.evidence || {}),
          ...(namespaceIndeterminate ? { pathIdentity: error.sidecarNamespaceReason } : {}),
          supportedFixes: outputDiagnostic?.supportedFixes
            || ['choose a safe receipt path beside the compare artifact and retry'],
        },
      });
      return;
    }
  }

  const receiptDirectoryIdentity = sameParent(outputPath, receiptPath);
  if (receiptDirectoryIdentity.status === 'unknown') {
    reportCompareFailure({
      json: options.json,
      stage: 'prepare',
      error: 'The compare receipt directory identity could not be verified.',
      code: 'delta/receipt-directory-identity-indeterminate',
      details: {
        artifactDirectory: outputDirectory,
        receiptDirectory: path.dirname(receiptPath),
        pathIdentity: receiptDirectoryIdentity.reason,
        supportedFixes: ['restore access to both output directories or choose paths in one verifiable directory'],
      },
    });
    return;
  }
  if (receiptDirectoryIdentity.status !== 'match') {
    reportCompareFailure({
      json: options.json,
      stage: 'prepare',
      error: 'The compare receipt must be written beside the HTML artifact.',
      code: 'delta/receipt-directory',
      details: {
        artifactDirectory: outputDirectory,
        receiptDirectory: path.dirname(receiptPath),
        pathIdentity: receiptDirectoryIdentity.reason,
        supportedFixes: ['choose a --receipt path in the same directory as output.html'],
      },
    });
    return;
  }

  const outputCapture = captureAtomicOutput(requestedOutputPath);
  const receiptCapture = captureAtomicOutput(requestedReceiptPath);
  for (const [capture, label, requestedPath] of [
    [outputCapture, 'HTML artifact', requestedOutputPath],
    [receiptCapture, 'receipt', requestedReceiptPath],
  ]) {
    if (capture.status === 'captured') continue;
    const failure = compareAtomicOutputFailure(capture, label, requestedPath, 'prepare');
    reportCompareFailure({
      json: options.json,
      stage: failure.stage,
      error: failure.message,
      code: failure.code,
      details: failure.details,
    });
    return;
  }
  const outputParent = outputCapture.snapshot.slot;
  const receiptParent = receiptCapture.snapshot.slot;
  if (outputParent.parentDevice !== receiptParent.parentDevice
    || outputParent.parentInode !== receiptParent.parentInode) {
    reportCompareFailure({
      json: options.json,
      stage: 'prepare',
      error: 'The compare receipt must be written beside the HTML artifact.',
      code: 'delta/receipt-directory',
      details: {
        artifactDirectory: outputParent.parentPath,
        receiptDirectory: receiptParent.parentPath,
        supportedFixes: ['choose a --receipt path in the same physical directory as output.html'],
      },
    });
    return;
  }
  outputPath = outputCapture.commitPath;
  receiptPath = receiptCapture.commitPath;
  outputDirectory = path.dirname(outputPath);

  let stagingDirectory;
  let stagingIdentity;
  try {
    const staging = createOwnedEmptyStagingDirectory(
      path.join(outputDirectory, '.archify-compare-'),
    );
    stagingDirectory = staging.directory;
    stagingIdentity = staging.identity;
  } catch (error) {
    reportCompareFailure({ json: options.json, stage: 'prepare', error: `Could not create compare candidate: ${error.message}`, code: 'delta/candidate-directory', details: { reason: error.message } });
    return;
  }

  const baseCandidate = path.join(stagingDirectory, 'base.html');
  const headCandidate = path.join(stagingDirectory, 'head.html');
  const rawBaseCandidate = path.join(stagingDirectory, 'base.raw.html');
  const rawHeadCandidate = path.join(stagingDirectory, 'head.raw.html');
  const rawBaseInput = path.join(stagingDirectory, 'base.snapshot.json');
  const rawHeadInput = path.join(stagingDirectory, 'head.snapshot.json');
  const canonicalBaseInput = path.join(stagingDirectory, 'base.architecture.json');
  const canonicalHeadInput = path.join(stagingDirectory, 'head.architecture.json');
  const htmlCandidate = path.join(stagingDirectory, path.basename(outputPath));
  const receiptCandidate = path.join(stagingDirectory, path.basename(receiptPath));
  let preserveRecoveryDirectory = false;
  const stagingOwnership = [];
  const captureCompareStagingFile = (filePath, content) => captureOwnedStagingFile(
    stagingOwnership,
    filePath,
    fileBindingRuntime,
    { subject: 'compare-staging-entry', content },
  );

  try {
    let baseResult;
    let headResult;
    for (const { side, snapshotPath, buffer } of [
      { side: 'base', snapshotPath: rawBaseInput, buffer: baseBuffer },
      { side: 'head', snapshotPath: rawHeadInput, buffer: headBuffer },
    ]) {
      try {
        fs.writeFileSync(snapshotPath, buffer, { flag: 'wx' });
        captureCompareStagingFile(snapshotPath, artifactIdentity(buffer));
      } catch (error) {
        const message = `Could not freeze ${side} compare snapshot: ${error.message}`;
        reportCompareFailure({
          json: options.json,
          stage: 'prepare',
          error: message,
          code: 'delta/freeze-snapshot',
          details: {
            side,
            ...(error?.code ? { systemCode: error.code } : {}),
            reason: error.message,
            supportedFixes: ['choose a writable compare output directory on the target filesystem'],
          },
        });
        return;
      }
    }
    try {
      renderValidatedArchitecture(
        rawBaseInput,
        rawBaseCandidate,
        qualityArgs.quality,
        repoArgs.repoRoot,
        captureCompareStagingFile,
      );
    } catch (error) {
      const diagnosticEntry = error.diagnostics?.[0];
      reportCompareFailure({
        json: options.json,
        stage: error.compareStage || 'validate',
        error: `Base snapshot failed validation: ${error.message}`,
        code: diagnosticEntry?.code || 'delta/base-validation',
        details: { side: 'base', ...(diagnosticEntry?.subject?.path ? { path: diagnosticEntry.subject.path } : {}), ...(diagnosticEntry?.evidence || {}), supportedFixes: diagnosticEntry?.supportedFixes || [] },
        status: error.compareStatus || 1,
      });
      return;
    }
    try {
      renderValidatedArchitecture(
        rawHeadInput,
        rawHeadCandidate,
        qualityArgs.quality,
        repoArgs.repoRoot,
        captureCompareStagingFile,
      );
    } catch (error) {
      const diagnosticEntry = error.diagnostics?.[0];
      reportCompareFailure({
        json: options.json,
        stage: error.compareStage || 'validate',
        error: `Head snapshot failed validation: ${error.message}`,
        code: diagnosticEntry?.code || 'delta/head-validation',
        details: { side: 'head', ...(diagnosticEntry?.subject?.path ? { path: diagnosticEntry.subject.path } : {}), ...(diagnosticEntry?.evidence || {}), supportedFixes: diagnosticEntry?.supportedFixes || [] },
        status: error.compareStatus || 1,
      });
      return;
    }

    // Validation must see the exact authored inputs. Only after both sides
    // pass do we canonicalize their collection order for deterministic SVG
    // geometry and stable artifact bytes.
    const canonicalBase = canonicalArchitecture(base);
    const canonicalHead = canonicalArchitecture(head);
    canonicalBase.meta.output = base.meta.output;
    canonicalHead.meta.output = head.meta.output;
    const canonicalBaseBytes = Buffer.from(JSON.stringify(canonicalBase));
    const canonicalHeadBytes = Buffer.from(JSON.stringify(canonicalHead));
    fs.writeFileSync(canonicalBaseInput, canonicalBaseBytes);
    captureCompareStagingFile(canonicalBaseInput, artifactIdentity(canonicalBaseBytes));
    fs.writeFileSync(canonicalHeadInput, canonicalHeadBytes);
    captureCompareStagingFile(canonicalHeadInput, artifactIdentity(canonicalHeadBytes));
    baseResult = renderValidatedArchitecture(
      canonicalBaseInput,
      baseCandidate,
      qualityArgs.quality,
      repoArgs.repoRoot,
      captureCompareStagingFile,
    );
    headResult = renderValidatedArchitecture(
      canonicalHeadInput,
      headCandidate,
      qualityArgs.quality,
      repoArgs.repoRoot,
      captureCompareStagingFile,
    );

    const semanticHash = (diagram) => createHash('sha256').update(canonicalArchitectureJson(diagram)).digest('hex');
    let compareIr;
    try {
      compareIr = compareArchitecture(base, head, {
        baseRawSha256: createHash('sha256').update(baseBuffer).digest('hex'),
        headRawSha256: createHash('sha256').update(headBuffer).digest('hex'),
        baseSemanticSha256: semanticHash(base),
        headSemanticSha256: semanticHash(head),
        baseBytes: baseBuffer.byteLength,
        headBytes: headBuffer.byteLength,
        baseVerified: Boolean(baseResult.sourceEvidence),
        headVerified: Boolean(headResult.sourceEvidence),
      });
    } catch (error) {
      if (!(error instanceof ArchitectureDeltaError)) throw error;
      reportCompareFailure({ json: options.json, stage: 'compare', error: error.message, code: error.code, details: error.details });
      return;
    }

    const baseSourceSvg = extractArchitectureSvg(baseResult.html);
    const headSourceSvg = extractArchitectureSvg(headResult.html);
    const baseSvg = annotateArchitectureSideSvg(baseSourceSvg, compareIr, 'base');
    const headSvg = annotateArchitectureSideSvg(headSourceSvg, compareIr, 'head');
    const deltaSvg = buildDeltaSvg(baseSourceSvg, headSourceSvg, compareIr);
    // Raw input hashes and byte counts belong in the sidecar receipt, not the
    // artifact. Keeping them out makes formatting-only input rewrites produce
    // the exact same canonical review HTML and artifact hash.
    const artifactIr = {
      ...compareIr,
      base: Object.fromEntries(Object.entries(compareIr.base).filter(([key]) => !['rawSha256', 'bytes'].includes(key))),
      head: Object.fromEntries(Object.entries(compareIr.head).filter(([key]) => !['rawSha256', 'bytes'].includes(key))),
    };
    const html = renderArchitectureDeltaHtml({
      receipt: artifactIr,
      baseSvg,
      deltaSvg,
      headSvg,
      baseHtml: baseResult.html,
      headHtml: headResult.html,
      artifactCss: extractArtifactCss(headResult.html),
    });
    const deltaValidation = validateArchitectureDeltaHtml(html, artifactIr);
    fs.writeFileSync(htmlCandidate, html);
    if (outputCapture.mode !== null) fs.chmodSync(htmlCandidate, outputCapture.mode);
    const artifact = fs.readFileSync(htmlCandidate);
    captureCompareStagingFile(htmlCandidate, artifactIdentity(artifact));
    const baseChecks = baseResult.checks.checks.filter((check) => check.ok).length;
    const headChecks = headResult.checks.checks.filter((check) => check.ok).length;
    const finalReceipt = {
      ...compareIr,
      artifact: artifactIdentity(artifact),
      validation: {
        checksPassed: baseChecks + headChecks + deltaValidation.checksPassed,
        checkCount: baseResult.checks.checks.length + headResult.checks.checks.length + deltaValidation.checkCount,
        baseComposition: baseResult.checks.composition.status,
        headComposition: headResult.checks.composition.status,
      },
    };
    const receiptBytes = Buffer.from(`${JSON.stringify(finalReceipt, null, 2)}\n`);
    fs.writeFileSync(receiptCandidate, receiptBytes);
    if (receiptCapture.mode !== null) fs.chmodSync(receiptCandidate, receiptCapture.mode);
    captureCompareStagingFile(receiptCandidate, artifactIdentity(receiptBytes));

    try {
      const currentOutput = resolveOutputPath({
        requestedOutput,
        defaultOutput: 'architecture-delta.html',
        inputPaths: [basePath, headPath],
        otherOutputPaths: [requestedReceiptPath],
      }).outputPath;
      resolveOutputPath({
        requestedOutput: options.receipt || compareReceiptPath(currentOutput),
        defaultOutput: compareReceiptPath(currentOutput),
        requiredExtension: '.json',
        inputPaths: [basePath, headPath],
        otherOutputPaths: [currentOutput],
      });
    } catch (error) {
      const outputDiagnostic = error.archifyDiagnostics?.[0];
      reportCompareFailure({
        json: options.json,
        stage: 'commit',
        error: error.message,
        code: outputDiagnostic?.code || 'output/path-resolution',
        details: {
          ...(outputDiagnostic?.subject || {}),
          ...(outputDiagnostic?.evidence || {}),
          supportedFixes: outputDiagnostic?.supportedFixes || ['restore safe output paths and retry'],
        },
      });
      return;
    }

    const committed = commitComparePair({
      htmlCandidate,
      htmlContent: finalReceipt.artifact,
      receiptCandidate,
      receiptContent: artifactIdentity(receiptBytes),
      outputCapture,
      receiptCapture,
      stagingDirectory,
      verifyAtomicOutput,
      fileBindingRuntime,
    });
    stagingOwnership.push(...committed.ownedBackupEntries);
    if (options.json) console.log(JSON.stringify(finalReceipt, null, 2));
    else {
      console.log(`compared architecture ${requestedOutputPath}`);
      console.log(`${finalReceipt.validation.checksPassed}/${finalReceipt.validation.checkCount} checks; completeness ${finalReceipt.completeness}; ${finalReceipt.proofLevel}; sha256 ${finalReceipt.artifact.sha256.slice(0, 12)}`);
      console.log(`receipt ${requestedReceiptPath}`);
    }
  } catch (error) {
    if (error instanceof ArchitectureDeltaError) {
      reportCompareFailure({ json: options.json, stage: 'artifact', error: error.message, code: error.code, details: error.details });
    } else if (error.compareStage === 'commit') {
      preserveRecoveryDirectory = Boolean(error.compareDetails?.recoveryFiles?.length);
      reportCompareFailure({
        json: options.json,
        stage: error.compareStage,
        error: error.message,
        code: error.compareCode,
        details: error.compareDetails,
      });
    } else {
      reportCompareFailure({ json: options.json, stage: 'internal', error: 'Architecture compare failed before commit.', code: 'delta/internal', details: { reason: error.message } });
    }
  } finally {
    try {
      if (!preserveRecoveryDirectory) {
        cleanupOwnedStagingDirectory(
          stagingDirectory,
          stagingIdentity,
          stagingOwnership,
          fileBindingRuntime,
        );
      } else {
        releaseOwnedStagingBindings(stagingOwnership, fileBindingRuntime);
      }
    } catch (error) {
      console.error(`Warning: could not remove compare staging directory: ${error.message}`);
    }
  }
}

function commandRender(args) {
  const qualityArgs = extractQualityArgs(args);
  const repoArgs = extractRepoRootArgs(qualityArgs.rest);
  // render takes no options of its own once --quality and --repo-root are
  // stripped, so anything left starting with -- is a typo. Without this a
  // mistyped flag was taken as the output path: `render architecture spec.json
  // --json out.html` wrote a file literally named `--json` and never wrote
  // out.html, exiting 0. Every sibling subcommand already guards this.
  const unknown = repoArgs.rest.filter((arg) => arg.startsWith('--'));
  if (unknown.length) fail(`Unknown render option "${unknown[0]}".`);
  const [type, input, output] = repoArgs.rest;
  if (!type || !input || repoArgs.rest.length > 3) fail(usage());
  const result = runNode([rendererPath(type), input, ...(output ? [output] : [])], {
    env: rendererEnv(qualityArgs.quality, repoArgs.repoRoot),
  });
  if (result.status !== 0) exitFrom(result);
}

function reportArtifactFailure({ command, json, stage, type, input, output, error, diagnostics = [], status = 1, checker, receiptId, provenance }) {
  const receipt = {
    schemaVersion: 1,
    ok: false,
    command,
    ...(receiptId ? { receiptId } : {}),
    stage,
    type,
    input,
    ...(output === undefined ? {} : { output }),
    error,
    diagnostics,
    ...(provenance ? { provenance } : {}),
    ...(checker ? { checker } : {}),
  };
  if (json) console.log(JSON.stringify(receipt, null, 2));
  else console.error(formatDiagnostics(error, diagnostics));
  process.exitCode = status;
}

function writeDeliveryFailureReceipt(options) {
  const receiptId = options.receiptId || randomUUID();
  const recorded = recordDeliveryFailure({ ...options, receiptId });
  const ownershipOrLockError = recorded.ownershipError || recorded.lockError;
  if (ownershipOrLockError) {
    const failureWasRecorded = recorded.status && recorded.status !== 'unrecorded';
    const lockOrOwnershipFailure = Boolean(
      ownershipOrLockError.deliveryLockCode
      || ownershipOrLockError.deliveryOwnershipCode,
    );
    reportArtifactFailure({
      ...options,
      command: 'deliver',
      receiptId,
      status: 1,
      error: lockOrOwnershipFailure
        ? `Could not safely continue delivery for "${options.output}": ${ownershipOrLockError.message}`
        : options.error,
      ...(failureWasRecorded ? { provenance: recorded.status } : {}),
      diagnostics: lockOrOwnershipFailure
        ? [
          deliveryLockFailureDiagnostic(options.output, ownershipOrLockError),
          ...(options.diagnostics || []),
          ...(recorded.diagnostic ? [recorded.diagnostic] : []),
        ]
        : [
          ...(options.diagnostics || []),
          deliveryLockFailureDiagnostic(options.output, ownershipOrLockError),
          ...(recorded.diagnostic ? [recorded.diagnostic] : []),
        ],
    });
    return recorded;
  }
  const recoveryDiagnosticFirst = Boolean(recorded.journalRecovery || recorded.provenanceRecovery);
  const diagnostics = recoveryDiagnosticFirst
    ? [
      ...(recorded.diagnostic ? [recorded.diagnostic] : []),
      ...(options.diagnostics || []),
    ]
    : [
      ...(options.diagnostics || []),
      ...(recorded.diagnostic ? [recorded.diagnostic] : []),
    ];
  reportArtifactFailure({
    ...options,
    command: 'deliver',
    receiptId,
    provenance: recorded.status,
    diagnostics,
  });
  return recorded;
}

function reportValidateFailure(options) {
  reportArtifactFailure({ ...options, command: 'validate' });
}

function reportArtifactArgumentFailure(command, error) {
  const details = error.archifyArgument || {};
  reportArtifactFailure({
    command,
    json: true,
    stage: 'arguments',
    error: error.message,
    diagnostics: [diagnostic({
      code: details.code || 'cli/invalid-arguments',
      message: error.message,
      subject: { command, ...(details.subject || {}) },
      evidence: details.evidence || {},
      supportedFixes: details.supportedFixes || ['correct the command arguments and retry'],
    })],
    status: 2,
  });
}

function sourceEvidenceFromArtifact(artifact) {
  const html = artifact.toString('utf8');
  const match = html.match(/<script id="archify-source-evidence-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  const evidence = JSON.parse(match[1]);
  if (evidence?.verified !== true || !evidence.repository?.url || !evidence.repository?.revision || !Number.isInteger(evidence.referenceCount)) {
    throw new Error('Rendered source evidence receipt is incomplete.');
  }
  return evidence;
}

async function internalStructureReceiptFromArtifact(artifact) {
  const { findHtmlScriptsById, parseInternalStructurePayload } = await import('../renderers/shared/utils.mjs');
  const html = artifact.toString('utf8');
  const matches = findHtmlScriptsById(html, 'archify-internal-structure-data');
  if (!matches.length) return null;
  if (matches.length !== 1) throw new Error('Rendered internal structure payload must appear exactly once.');
  const match = matches[0];
  if (String(match.attributes.type || '').trim().toLowerCase() !== 'application/json') {
    throw new Error('Rendered internal structure payload script must use type="application/json".');
  }
  if (!match.closed) throw new Error('Rendered internal structure payload script is not closed.');
  const encoded = match.content;
  const parsed = parseInternalStructurePayload(encoded);
  return {
    schemaVersion: 1,
    nodeCount: parsed.nodeCount,
    itemCount: parsed.itemCount,
    relationCount: parsed.relationCount,
    sourceCount: parsed.sourceCount,
    bytes: parsed.bytes,
    sha256: createHash('sha256').update(encoded).digest('hex'),
  };
}

function engineeringProfileFromArtifact(artifact) {
  const match = artifact.toString('utf8').match(/<svg[^>]*\sdata-engineering-profile="([^"]+)"/);
  return match ? match[1] : null;
}

async function commandDeliver(args) {
  await loadSidecarPathRuntime();
  const qualityArgs = extractQualityArgs(args);
  const repoArgs = extractRepoRootArgs(qualityArgs.rest);
  const json = repoArgs.rest.includes('--json');
  const open = repoArgs.rest.includes('--open');
  const knownOptions = new Set(['--json', '--open']);
  const unknown = repoArgs.rest.filter((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknown.length) rejectCliArgument(`Unknown deliver option "${unknown[0]}".`, {
    code: 'cli/unknown-option',
    subject: { option: unknown[0] },
    supportedFixes: ['remove the unknown option and retry'],
  });
  const positional = repoArgs.rest.filter((arg) => !knownOptions.has(arg));
  const [type, input, requestedOutput] = positional;
  if (!type || !input || positional.length > 3) rejectCliArgument(usage(), {
    code: 'cli/usage',
    supportedFixes: ['use: archify deliver <type> <input.json> [output.html] [options]'],
  });
  if (type === 'atlas') {
    try {
      const { deliverAtlas } = await import('../renderers/shared/atlas-delivery.mjs');
      const receipt = await deliverAtlas({ input, requestedOutput, quality: qualityArgs.quality, repoRoot: repoArgs.repoRoot });
      if (open) {
        try {
          const { openArtifact } = await import('./open-artifact.mjs');
          receipt.open = openArtifact(receipt.output);
        } catch {
          receipt.open = { requested: true, status: 'unsupported', target: receipt.output, method: null };
        }
        if (receipt.open.status !== 'opened') console.error(`Could not open the verified artifact (${receipt.open.status}). Open it manually: ${receipt.output}`);
      }
      console.log(json ? JSON.stringify(receipt, null, 2) : `delivered atlas ${receipt.output}`);
    } catch (error) {
      reportArtifactFailure({ command: 'deliver', json, type, input: path.resolve(input), output: path.resolve(requestedOutput || input.replace(/\.[^.]+$/, '') + '.html'),
        stage: error.atlasStage || 'input', error: error.message,
        diagnostics: error.archifyDiagnostics || [diagnostic({ code: 'atlas/delivery', message: error.message })] });
    }
    return;
  }
  const renderer = rendererPath(type);
  const {
    canonicalFuturePath,
    pathsAlias,
    resolveOutputPath,
    validateAuthoredOutputPath,
  } = await import('../renderers/shared/output-path.mjs');
  const {
    captureAtomicOutput,
    verifyAtomicOutput,
    backupPublicRegularFileBinding,
    captureRegularFileBinding,
    quarantineRemoveRegularFileBinding,
    verifyRegularFileBinding,
    releaseRegularFileBinding,
  } = await import('../renderers/shared/atomic-output.mjs');
  ({ sidecarNamespaceComponentKey: sidecarNamespaceComponentKeyRuntime }
    = await import('../renderers/shared/path-semantics.mjs'));
  const fileBindingRuntime = {
    backupPublicRegularFileBinding,
    captureRegularFileBinding,
    quarantineRemoveRegularFileBinding,
    verifyRegularFileBinding,
    releaseRegularFileBinding,
  };
  const receiptId = randomUUID();
  let deliveryOwnership;
  let recoveryRequired = false;
  let stagingDirectory;
  let stagingIdentity;
  let deliveryAliasOutput;
  const reportDeliveryFailure = (options) => {
    const ownership = deliveryOwnership;
    deliveryOwnership = undefined;
    const recorded = writeDeliveryFailureReceipt({
      ...options,
      pathsAlias,
      receiptId,
      ownership,
      releaseOwnership: Boolean(ownership),
      recoveryDirectory: stagingDirectory,
      legacyOutputPaths: deliveryAliasOutput ? [deliveryAliasOutput] : [],
      captureAtomicOutput,
      verifyAtomicOutput,
      fileBindingRuntime,
    });
    if (ownership && (recorded?.ownershipError || recorded?.lockError)?.deliveryOwnershipCode === 'delivery/ownership-lost') {
      recoveryRequired = true;
    }
  };
  const inputPath = path.resolve(input);
  let specification;
  let diagram;
  try {
    specification = fs.readFileSync(inputPath);
    diagram = JSON.parse(specification.toString('utf8'));
  } catch (error) {
    const repair = inputDiagnostic(error, inputPath);
    reportDeliveryFailure({
      json,
      stage: 'input',
      type,
      input: inputPath,
      output: path.resolve(requestedOutput || `${type}.html`),
      error: `Could not read delivery input "${inputPath}": ${error.message}`,
      diagnostics: [repair],
    });
    return;
  }

  const authoredOutput = diagram?.meta?.output;
  let outputPath;
  let provenancePath;
  let preparedDeliveryTargets;
  try {
    validateAuthoredOutputPath(authoredOutput);
    ({ outputPath } = resolveOutputPath({
      requestedOutput,
      authoredOutput,
      defaultOutput: `${type}.html`,
      inputPaths: [inputPath],
    }));
    deliveryAliasOutput = outputPath;
    // Redelivery through a case, normalization, 8.3, or file-symlink alias
    // must replace the existing physical artifact without changing its stored
    // spelling. That keeps its realpath-derived sidecars discoverable.
    outputPath = canonicalFuturePath(outputPath);
  } catch (error) {
    const attemptedOutput = path.resolve(
      requestedOutput
      || (typeof authoredOutput === 'string' && authoredOutput)
      || `${type}.html`,
    );
    const failure = {
      json,
      stage: 'prepare',
      type,
      input: inputPath,
      output: attemptedOutput,
      error: error.message,
      diagnostics: error.archifyDiagnostics || [diagnostic({
        code: 'output/path-resolution',
        message: error.message,
        subject: { output: attemptedOutput },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}) },
        supportedFixes: ['choose a safe output path and retry'],
      })],
    };
    if (outputPath) {
      reportDeliveryFailure(failure);
    } else {
      reportArtifactFailure({ ...failure, command: 'deliver', receiptId });
    }
    return;
  }
  let outputDirectory = path.dirname(outputPath);
  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
  } catch (error) {
    const message = `Could not create delivery directory "${outputDirectory}": ${error.message}`;
    reportDeliveryFailure({
      json,
      stage: 'prepare',
      type,
      input: inputPath,
      output: outputPath,
      error: message,
      diagnostics: [diagnostic({
        code: 'delivery/prepare-directory',
        message,
        subject: { outputDirectory },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
        supportedFixes: ['choose a writable output directory'],
      })],
    });
    return;
  }

  // Name semantics such as NTFS per-directory case sensitivity cannot be
  // projected through an unmaterialized directory. Creating the requested
  // physical parent is directory preparation, not artifact/sidecar
  // publication; all input, portable-path and native-resolution contracts
  // above have already passed. Only now may sidecar naming probe the actual
  // directory. A later target snapshot still rejects any authored alias that
  // was retargeted across this boundary.
  try {
    const defaultProvenancePath = deliveryProvenancePath(outputPath);
    ({ outputPath: provenancePath } = resolveOutputPath({
      requestedOutput: defaultProvenancePath,
      defaultOutput: defaultProvenancePath,
      requiredExtension: '.json',
      inputPaths: [inputPath],
      inputDescription: 'the delivery input',
      otherOutputPaths: [outputPath],
    }));
  } catch (error) {
    const attemptedOutput = path.resolve(requestedOutput || authoredOutput || `${type}.html`);
    const failure = {
      json,
      stage: 'prepare',
      type,
      input: inputPath,
      output: attemptedOutput,
      error: error.message,
      diagnostics: error.archifyDiagnostics || [diagnostic({
        code: 'output/path-resolution',
        message: error.message,
        subject: { output: attemptedOutput },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}) },
        supportedFixes: ['choose a safe output path and retry'],
      })],
    };
    if (error?.code === 'ARCHIFY_SIDECAR_NAMESPACE_INDETERMINATE') {
      reportArtifactFailure({ ...failure, command: 'deliver', receiptId });
    } else {
      reportDeliveryFailure(failure);
    }
    return;
  }

  try {
    const plannedOutputPath = outputPath;
    const artifactCapture = {
      requestedPath: deliveryAliasOutput || outputPath,
      ...captureAtomicOutput(deliveryAliasOutput || outputPath),
    };
    if (artifactCapture.status !== 'captured') {
      throw deliveryTargetStateError(artifactCapture.requestedPath, 'HTML artifact', artifactCapture);
    }
    if (!pathsAlias(artifactCapture.commitPath, plannedOutputPath)) {
      throw deliveryTargetStateError(artifactCapture.requestedPath, 'HTML artifact', {
        status: 'different',
        reason: {
          code: 'write-slot-changed-before-snapshot',
          plannedCommitPath: plannedOutputPath,
          currentCommitPath: artifactCapture.commitPath,
        },
      });
    }
    const requestedProvenancePath = deliveryProvenancePath(artifactCapture.commitPath);
    const provenanceCapture = {
      requestedPath: requestedProvenancePath,
      ...captureAtomicOutput(requestedProvenancePath, {
        requestedEntryPolicy: 'regular-or-absent',
      }),
    };
    if (provenanceCapture.status !== 'captured') {
      throw deliveryTargetStateError(requestedProvenancePath, 'delivery provenance', provenanceCapture);
    }
    preparedDeliveryTargets = { artifact: artifactCapture, provenance: provenanceCapture };
    outputPath = artifactCapture.commitPath;
    provenancePath = provenanceCapture.commitPath;
    outputDirectory = path.dirname(outputPath);
  } catch (error) {
    reportArtifactFailure({
      command: 'deliver', json, stage: 'prepare', type, input: inputPath, output: outputPath, receiptId,
      error: error.message,
      diagnostics: error.archifyDiagnostics || [diagnostic({
        code: 'output/target-indeterminate',
        message: error.message,
        subject: { output: outputPath },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}) },
        supportedFixes: ['retry only after the output path and its parent directories stop changing'],
      })],
    });
    return;
  }

  // Keep the candidate beside the target so the final rename is one
  // same-filesystem commit. A render or artifact-check failure never touches
  // an existing trusted output.
  try {
    const staging = createOwnedEmptyStagingDirectory(
      path.join(outputDirectory, '.archify-delivery-'),
    );
    stagingDirectory = staging.directory;
    stagingIdentity = staging.identity;
  } catch (error) {
    const message = `Could not create a delivery candidate beside "${outputPath}": ${error.message}`;
    reportDeliveryFailure({
      json,
      stage: 'prepare',
      type,
      input: inputPath,
      output: outputPath,
      error: message,
      diagnostics: [diagnostic({
        code: 'delivery/prepare-candidate',
        message,
        subject: { output: outputPath },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
        supportedFixes: ['choose a writable output directory on the target filesystem'],
      })],
    });
    return;
  }
  const candidatePath = path.join(stagingDirectory, path.basename(outputPath));
  const specificationSnapshotPath = path.join(stagingDirectory, 'specification.snapshot.json');
  const provenanceCandidatePath = path.join(stagingDirectory, 'delivery-provenance.json');
  let commitRecoveryBackups = [];
  const stagingOwnership = [];
  const captureDeliveryStagingFile = (filePath, content) => captureOwnedStagingFile(
    stagingOwnership,
    filePath,
    fileBindingRuntime,
    { subject: 'delivery-staging-entry', content },
  );

  try {
    try {
      deliveryOwnership = acquireDeliveryLock(
        outputPath,
        receiptId,
        inputPath,
        pathsAlias,
        (lockError, initializingOwnership) => recordDeliveryFailure({
          output: outputPath,
          stage: 'prepare',
          input: inputPath,
          error: `Could not start delivery for "${outputPath}": ${lockError.message}`,
          receiptId,
          pathsAlias,
          ownership: initializingOwnership,
          captureAtomicOutput,
          verifyAtomicOutput,
          fileBindingRuntime,
        }),
        deliveryAliasOutput ? [deliveryAliasOutput] : [],
        fileBindingRuntime,
      );
    } catch (error) {
      const message = `Could not start delivery for "${outputPath}": ${error.message}`;
      const recorded = error.deliveryFailureRecord;
      reportArtifactFailure({
        command: 'deliver', json, stage: 'prepare', type, input: inputPath, output: outputPath, receiptId,
        error: message,
        ...(recorded ? { provenance: recorded.status } : {}),
        diagnostics: error.deliveryJournalRecovery?.recoveryRequired
          ? [deliveryJournalRecoveryDiagnostic(outputPath, error)]
          : error.deliveryProvenanceRecovery?.recoveryRequired
            ? [
              ...(recorded?.diagnostic ? [recorded.diagnostic] : []),
              deliveryLockFailureDiagnostic(outputPath, error),
            ]
            : [
              deliveryLockFailureDiagnostic(outputPath, error),
              ...(recorded?.diagnostic ? [recorded.diagnostic] : []),
            ],
      });
      return;
    }

    try {
      const state = deliveryOwnershipStates.get(deliveryOwnership);
      const targets = captureDeliveryTargetState({
        state,
        requestedOutput: deliveryAliasOutput || outputPath,
        pathsAlias,
        captureAtomicOutput,
        verifyAtomicOutput,
        preparedTargets: preparedDeliveryTargets,
      });
      outputPath = targets.artifact.commitPath;
      provenancePath = targets.provenance.commitPath;
    } catch (error) {
      let releaseError;
      try {
        releaseDeliveryOwnership(deliveryOwnership);
      } catch (cause) {
        releaseError = cause;
      }
      deliveryOwnership = undefined;
      reportArtifactFailure({
        command: 'deliver', json, stage: 'prepare', type, input: inputPath, output: outputPath, receiptId,
        error: error.message,
        diagnostics: [
          ...(releaseError ? [deliveryLockFailureDiagnostic(outputPath, releaseError)] : []),
          ...(error.archifyDiagnostics || [diagnostic({
            code: 'output/target-indeterminate',
            message: error.message,
            subject: { output: outputPath },
            evidence: { ...(error?.code ? { systemCode: error.code } : {}) },
          })]),
        ],
      });
      return;
    }

    try {
      beginDeliveryAttempt({
        ownership: deliveryOwnership,
        input: inputPath,
        pathsAlias,
        fileBindingRuntime,
      });
    } catch (error) {
      if (error.deliveryJournalRecovery?.recoveryRequired) {
        // The lock is the remaining fail-closed barrier. Do not write failure
        // provenance or release it after journal rollback itself became unsafe.
        deliveryOwnership = undefined;
        reportArtifactFailure({
          command: 'deliver', json, stage: 'prepare', type, input: inputPath, output: outputPath, receiptId,
          error: `Could not persist the delivery attempt before rendering: ${error.message}`,
          diagnostics: [deliveryJournalRecoveryDiagnostic(outputPath, error)],
        });
        return;
      }
      if (error.deliveryOwnershipCode === 'delivery/ownership-lost') {
        deliveryOwnership = undefined;
        recoveryRequired = true;
        error.deliveryCommitDetails = {
          recoveryRequired: true,
          recoveryDirectory: stagingDirectory,
          recoverableBackups: [],
        };
        reportArtifactFailure({
          command: 'deliver', json, stage: 'prepare', type, input: inputPath, output: outputPath, receiptId,
          error: `Could not persist the delivery attempt before rendering: ${error.message}`,
          diagnostics: [deliveryLockFailureDiagnostic(outputPath, error)],
        });
        return;
      }
      reportDeliveryFailure({
        json, stage: 'prepare', type, input: inputPath, output: outputPath,
        error: 'Could not persist the delivery attempt before rendering.',
        diagnostics: [diagnostic({
          code: 'delivery/journal-write', message: 'Could not persist the delivery attempt before rendering.',
          subject: {
            output: outputPath,
            journal: deliveryOwnershipStates.get(deliveryOwnership)?.pendingPath
              || deliveryPendingPath(outputPath),
          },
          evidence: { reason: error.message },
          supportedFixes: ['choose a writable output directory with a journal path distinct from the input'],
        })],
      });
      return;
    }

    try {
      fs.writeFileSync(specificationSnapshotPath, specification, { flag: 'wx' });
      captureDeliveryStagingFile(
        specificationSnapshotPath,
        artifactIdentity(Buffer.from(specification)),
      );
    } catch (error) {
      const message = `Could not freeze the delivery specification: ${error.message}`;
      reportDeliveryFailure({
        json,
        stage: 'prepare',
        type,
        input: inputPath,
        output: outputPath,
        error: message,
        diagnostics: [diagnostic({
          code: 'delivery/freeze-specification',
          message,
          subject: { input: inputPath },
          evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
          supportedFixes: ['choose a writable output directory on the target filesystem'],
        })],
      });
      return;
    }

    const render = runNode([renderer, specificationSnapshotPath, candidatePath], {
      stdio: 'pipe',
      env: rendererEnv(qualityArgs.quality, repoArgs.repoRoot, true),
    });
    if (render.status !== 0) {
      const failure = rendererFailure(render);
      reportDeliveryFailure({
        json,
        stage: 'render',
        type,
        input: inputPath,
        output: outputPath,
        error: failure.error,
        diagnostics: failure.diagnostics,
        status: render.status ?? 1,
      });
      return;
    }
    try {
      const renderedCandidate = fs.readFileSync(candidatePath);
      if (preparedDeliveryTargets.artifact.mode !== null) {
        fs.chmodSync(candidatePath, preparedDeliveryTargets.artifact.mode);
      }
      captureDeliveryStagingFile(candidatePath, artifactIdentity(renderedCandidate));
    } catch {
      // The commit path performs the authoritative candidate classification.
      // Leave an unbound entry untouched during private-directory cleanup.
    }

    const check = runNode([path.join(skillRoot, 'scripts/check-render-output.mjs'), candidatePath], {
      stdio: 'pipe',
    });
    if (check.status !== 0) {
      if (check.stderr) process.stderr.write(check.stderr);
      let checker;
      try {
        checker = JSON.parse(check.stdout);
        checker.file = outputPath;
      } catch {
        checker = { ok: false, file: outputPath, diagnostic: check.stdout.trim() };
      }
      reportDeliveryFailure({
        json,
        stage: 'check',
        type,
        input: inputPath,
        output: outputPath,
        error: 'Final artifact check failed; the previous artifact was preserved.',
        diagnostics: checkerDiagnostics(checker),
        status: check.status ?? 1,
        checker,
      });
      return;
    }

    let result;
    try {
      result = JSON.parse(check.stdout);
    } catch (error) {
      const message = `Could not parse the successful artifact-check receipt: ${error.message}`;
      reportDeliveryFailure({
        json,
        stage: 'receipt',
        type,
        input: inputPath,
        output: outputPath,
        error: message,
        diagnostics: [diagnostic({
          code: 'delivery/receipt-invalid',
          message,
          subject: { output: outputPath },
          evidence: { reason: error.message },
        })],
      });
      return;
    }
    let artifact;
    try {
      artifact = fs.readFileSync(candidatePath);
    } catch (error) {
      const message = `Could not read the verified delivery candidate: ${error.message}`;
      reportDeliveryFailure({
        json,
        stage: 'receipt',
        type,
        input: inputPath,
        output: outputPath,
        error: message,
        diagnostics: [diagnostic({
          code: 'delivery/candidate-unreadable',
          message,
          subject: { output: outputPath },
          evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
        })],
      });
      return;
    }
    let sourceEvidence;
    try {
      sourceEvidence = sourceEvidenceFromArtifact(artifact);
    } catch (error) {
      const message = `Could not read the repository evidence receipt: ${error.message}`;
      reportDeliveryFailure({
        json,
        stage: 'receipt',
        type,
        input: inputPath,
        output: outputPath,
        error: message,
        diagnostics: [diagnostic({
          code: 'delivery/evidence-receipt-invalid',
          message,
          subject: { output: outputPath },
          evidence: { reason: error.message },
        })],
      });
      return;
    }
    let internalStructure;
    try {
      internalStructure = await internalStructureReceiptFromArtifact(artifact);
    } catch (error) {
      const message = `Could not read the internal structure receipt: ${error.message}`;
      reportDeliveryFailure({
        json,
        stage: 'receipt',
        type,
        input: inputPath,
        output: outputPath,
        error: message,
        diagnostics: [diagnostic({
          code: 'delivery/internal-structure-receipt-invalid',
          message,
          subject: { output: outputPath },
          evidence: { reason: error.message },
        })],
      });
      return;
    }
    const engineeringProfile = engineeringProfileFromArtifact(artifact);
    const receipt = {
      schemaVersion: 1,
      receiptId,
      ok: true,
      command: 'deliver',
      type,
      input: inputPath,
      output: outputPath,
      specification: {
        sha256: createHash('sha256').update(specification).digest('hex'),
        bytes: specification.byteLength,
      },
      artifact: {
        sha256: createHash('sha256').update(artifact).digest('hex'),
        bytes: artifact.byteLength,
      },
      validation: {
        checksPassed: result.checks.filter((checkItem) => checkItem.ok).length,
        checkCount: result.checks.length,
        compositionProfile: result.composition.profile,
        compositionStatus: result.composition.status,
        ...(engineeringProfile ? { engineeringProfile } : {}),
        errors: result.composition.summary.errors,
        warnings: result.composition.summary.warnings,
      },
      ...(sourceEvidence ? {
        evidence: {
          verified: true,
          repository: sourceEvidence.repository.url,
          revision: sourceEvidence.repository.revision,
          references: sourceEvidence.referenceCount,
          ...(sourceEvidence.repository.linkMode ? { linkMode: sourceEvidence.repository.linkMode } : {}),
        },
      } : {}),
      ...(internalStructure ? { internalStructure } : {}),
    };

    const provenanceBytes = Buffer.from(`${JSON.stringify(deliverySuccessProvenance(receipt), null, 2)}\n`);
    try {
      fs.writeFileSync(provenanceCandidatePath, provenanceBytes, { flag: 'wx' });
      if (preparedDeliveryTargets.provenance.mode !== null) {
        fs.chmodSync(provenanceCandidatePath, preparedDeliveryTargets.provenance.mode);
      }
      try {
        captureDeliveryStagingFile(
          provenanceCandidatePath,
          artifactIdentity(provenanceBytes),
        );
      } catch {
        // commitDeliveryPair classifies this path against the expected bytes;
        // cleanup must not claim a candidate that could not be bound here.
      }
    } catch (error) {
      reportDeliveryFailure({
        json,
        stage: 'commit',
        type,
        input: inputPath,
        output: outputPath,
        error: `Could not prepare delivery provenance for "${outputPath}": ${error.message}`,
        diagnostics: [diagnostic({
          code: 'delivery/provenance-prepare',
          message: 'Could not prepare the artifact-bound delivery provenance.',
          subject: { output: outputPath },
          evidence: { reason: error.message },
          supportedFixes: ['choose a writable output directory and rerun deliver'],
        })],
      });
      return;
    }

    try {
      const currentOutputPath = canonicalFuturePath(resolveOutputPath({
        requestedOutput,
        authoredOutput,
        defaultOutput: `${type}.html`,
        inputPaths: [inputPath],
        otherOutputPaths: [provenancePath],
      }).outputPath);
      resolveOutputPath({
        requestedOutput: deliveryProvenancePath(currentOutputPath),
        defaultOutput: deliveryProvenancePath(currentOutputPath),
        requiredExtension: '.json',
        inputPaths: [inputPath],
        inputDescription: 'the delivery input',
        otherOutputPaths: [currentOutputPath],
      });
    } catch (error) {
      reportDeliveryFailure({
        json,
        stage: 'commit',
        type,
        input: inputPath,
        output: outputPath,
        error: error.message,
        diagnostics: error.archifyDiagnostics || [diagnostic({
          code: 'output/path-resolution',
          message: error.message,
          subject: { output: outputPath },
          evidence: { ...(error?.code ? { systemCode: error.code } : {}) },
          supportedFixes: ['restore a safe output path and retry'],
        })],
      });
      return;
    }

    try {
      const committed = commitDeliveryPair({
        htmlCandidate: candidatePath,
        htmlContent: receipt.artifact,
        provenanceCandidate: provenanceCandidatePath,
        provenanceContent: artifactIdentity(provenanceBytes),
        stagingDirectory,
        ownership: deliveryOwnership,
        verifyAtomicOutput,
        fileBindingRuntime,
      });
      commitRecoveryBackups = committed.recoverableBackups;
      stagingOwnership.push(...committed.ownedBackupEntries);
    } catch (error) {
      if (error.deliveryOwnershipCode === 'delivery/ownership-lost' && !error.deliveryCommitDetails) {
        error.deliveryCommitDetails = {
          recoveryRequired: true,
          recoveryDirectory: stagingDirectory,
          recoverableBackups: [],
        };
      }
      recoveryRequired = error.deliveryCommitDetails?.recoveryRequired === true;
      const message = `Could not commit verified delivery "${outputPath}": ${error.message}`;
      if (recoveryRequired) {
        // The owned lock and pending journal are the remaining fail-closed
        // barrier around retained backups and any claimant we did not create.
        // Do not write failure provenance or release ownership here.
        deliveryOwnership = undefined;
        reportArtifactFailure({
          command: 'deliver', json, stage: 'commit', type, input: inputPath, output: outputPath, receiptId,
          error: message,
          diagnostics: [
            ...(error.deliveryOwnershipCode === 'delivery/ownership-lost'
              ? [deliveryLockFailureDiagnostic(outputPath, error)]
              : []),
            ...(error.archifyDiagnostics || []),
            deliveryCommitRecoveryDiagnostic(outputPath, error),
          ],
        });
        return;
      }
      if (error.deliveryTargetState) {
        let releaseError;
        try {
          releaseDeliveryOwnership(deliveryOwnership);
        } catch (cause) {
          releaseError = cause;
        }
        deliveryOwnership = undefined;
        reportArtifactFailure({
          command: 'deliver', json, stage: 'commit', type, input: inputPath, output: outputPath, receiptId,
          error: message,
          diagnostics: [
            ...(releaseError ? [deliveryLockFailureDiagnostic(outputPath, releaseError)] : []),
            ...(error.archifyDiagnostics || []),
          ],
        });
        return;
      }
      if (error.deliveryOwnershipCode === 'delivery/ownership-lost') {
        deliveryOwnership = undefined;
        reportArtifactFailure({
          command: 'deliver', json, stage: 'commit', type, input: inputPath, output: outputPath, receiptId,
          error: message,
          diagnostics: [deliveryLockFailureDiagnostic(outputPath, error)],
        });
        return;
      }
      reportDeliveryFailure({
        json,
        stage: 'commit',
        type,
        input: inputPath,
        output: outputPath,
        error: message,
        diagnostics: error.archifyDiagnostics || [diagnostic({
          code: 'delivery/commit',
          message,
          subject: { output: outputPath },
          evidence: {
            ...(error?.code ? { systemCode: error.code } : {}),
            reason: error.message,
            ...(error.deliveryCommitDetails || {}),
          },
          supportedFixes: ['choose replaceable regular-file artifact and provenance targets on the same writable filesystem'],
        })],
      });
      return;
    }

    try {
      releaseDeliveryOwnership(deliveryOwnership);
      deliveryOwnership = undefined;
    } catch (error) {
      deliveryOwnership = undefined;
      if (error.deliveryOwnershipCode === 'delivery/ownership-lost') {
        recoveryRequired = true;
        error.deliveryCommitDetails = {
          recoveryRequired: true,
          recoveryDirectory: stagingDirectory,
          recoverableBackups: commitRecoveryBackups,
        };
      }
      const message = `Delivery committed, but its lock could not be released for "${outputPath}": ${error.message}`;
      reportArtifactFailure({
        command: 'deliver', json, stage: 'release', type, input: inputPath, output: outputPath, receiptId,
        error: message,
        diagnostics: [deliveryLockFailureDiagnostic(outputPath, error)],
      });
      return;
    }

    if (open) {
      try {
        const { openArtifact } = await import('./open-artifact.mjs');
        receipt.open = openArtifact(outputPath);
      } catch {
        receipt.open = {
          requested: true,
          status: 'unsupported',
          target: outputPath,
          method: null,
        };
      }
      if (receipt.open.status !== 'opened') {
        console.error(`Could not open the verified artifact (${receipt.open.status}). ${receipt.open.failure?.reason || 'Open it manually.'} Target: ${outputPath}`);
      }
    }

    if (json) {
      console.log(JSON.stringify(receipt, null, 2));
    } else {
      console.log(`delivered ${type} ${outputPath}`);
      const engineering = receipt.validation.engineeringProfile
        ? `; engineering ${receipt.validation.engineeringProfile}: pass`
        : '';
      console.log(`${receipt.validation.checksPassed}/${receipt.validation.checkCount} artifact checks; composition ${receipt.validation.compositionProfile}: ${receipt.validation.compositionStatus}${engineering}; sha256 ${receipt.artifact.sha256.slice(0, 12)}`);
      if (receipt.open?.status === 'opened') console.log(`opened ${outputPath}`);
    }
  } finally {
    if (deliveryOwnership) {
      try {
        releaseDeliveryOwnership(deliveryOwnership, { allowInitializing: true });
      } catch (error) {
        if (error.deliveryOwnershipCode === 'delivery/ownership-lost') {
          recoveryRequired = true;
          error.deliveryCommitDetails = {
            ...(error.deliveryCommitDetails || {}),
            recoveryRequired: true,
            recoveryDirectory: stagingDirectory,
            recoverableBackups: commitRecoveryBackups,
          };
        }
        console.error(formatDiagnostics(
          `Delivery cleanup could not release its lock for "${outputPath}".`,
          [deliveryLockFailureDiagnostic(outputPath, error)],
        ));
        process.exitCode = 1;
      }
    }
    if (recoveryRequired) {
      releaseOwnedStagingBindings(stagingOwnership, fileBindingRuntime);
      console.error(`Recovery required: delivery backups were retained at "${stagingDirectory}".`);
    } else {
      try {
        cleanupOwnedStagingDirectory(
          stagingDirectory,
          stagingIdentity,
          stagingOwnership,
          fileBindingRuntime,
        );
      } catch (error) {
        console.error(`Warning: could not remove delivery staging directory "${stagingDirectory}": ${error.message}`);
      }
    }
  }
}

async function commandPreview(args) {
  const qualityArgs = extractQualityArgs(args);
  const repoArgs = extractRepoRootArgs(qualityArgs.rest);
  const noOpen = repoArgs.rest.includes('--no-open');
  const knownOptions = new Set(['--no-open']);
  const unknown = repoArgs.rest.filter((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknown.length) fail(`Unknown preview option "${unknown[0]}".`);
  const positional = repoArgs.rest.filter((arg) => !knownOptions.has(arg));
  const [type, input, output] = positional;
  if (!type || !input || positional.length > 3) fail(usage());
  rendererPath(type);

  try {
    const source = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
    const { validateAuthoredOutputPath } = await import('../renderers/shared/output-path.mjs');
    validateAuthoredOutputPath(source?.meta?.output);
  } catch (error) {
    // Preserve live repair for unreadable or malformed JSON. A parsed document,
    // however, must already carry the durable output contract before preview
    // allocates a server, watcher, or staging directory.
    if (error?.archifyDiagnostics) fail(`Could not start live preview: ${error.message}`, 1);
  }

  let runPreview;
  try {
    ({ runPreview } = await import('./preview.mjs'));
  } catch (error) {
    fail(`Could not load live preview: ${error.message}`, 1);
  }
  try {
    await runPreview({
      type,
      input,
      output,
      quality: qualityArgs.quality,
      repoRoot: repoArgs.repoRoot,
      open: !noOpen,
    });
  } catch (error) {
    fail(`Could not start live preview: ${error.message}`, 1);
  }
}

async function loadPathIdentityRuntime() {
  try {
    await loadSidecarPathRuntime();
    const {
      sameEntry,
      sidecarNamespaceComponentKey,
    } = await import('../renderers/shared/path-semantics.mjs');
    sidecarNamespaceComponentKeyRuntime = sidecarNamespaceComponentKey;
    const {
      captureRegularFileBinding,
      verifyRegularFileBinding,
      releaseRegularFileBinding,
    } = await import('../renderers/shared/atomic-output.mjs');
    return {
      sameEntry,
      captureRegularFileBinding,
      verifyRegularFileBinding,
      releaseRegularFileBinding,
    };
  } catch (error) {
    return { error };
  }
}

function inspectArtifactDeliveryProvenance(
  artifactPath,
  requireProvenance,
  pathIdentityRuntime,
  expectedBindings,
) {
  const {
    captureRegularFileBinding,
    verifyRegularFileBinding,
    releaseRegularFileBinding,
  } = pathIdentityRuntime || {};
  const stableArtifactPath = canonicalExistingDeliveryOutput(artifactPath);
  let artifactCapture;
  try {
    if (typeof captureRegularFileBinding !== 'function'
      || typeof verifyRegularFileBinding !== 'function'
      || typeof releaseRegularFileBinding !== 'function') {
      throw new Error('The regular-file binding runtime is unavailable.');
    }
    artifactCapture = captureRegularFileBinding(stableArtifactPath, {
      subject: 'delivery-artifact',
      ...(expectedBindings?.artifact ? {
        expectedIdentity: expectedBindings.artifact.identity,
        expectedSha256: expectedBindings.artifact.content.sha256,
        expectedBytes: expectedBindings.artifact.content.bytes,
        expectedMode: expectedBindings.artifact.mode,
      } : {}),
      expectedLinks: 1,
      includeContent: true,
    });
    if (artifactCapture.status !== 'captured') {
      if (artifactCapture.reason?.code === 'delivery-artifact-hardlinked') {
        const message = 'Delivery provenance is unsupported for a hard-linked artifact because one receipt cannot prove every linked name was updated atomically.';
        return {
          ok: false,
          status: 'unsupported',
          diagnostics: [diagnostic({
            code: 'output/target-hardlinked',
            message,
            subject: { artifact: path.resolve(artifactPath) },
            evidence: { links: artifactCapture.reason.links },
            supportedFixes: ['remove the extra hard links, then rerun deliver and strict check on the remaining artifact path'],
          })],
        };
      }
      throw new Error(`The artifact is not a stable regular file (${artifactCapture.reason?.code || 'unknown target state'}).`);
    }
  } catch (error) {
    return {
      ok: false, status: 'unknown',
      diagnostics: [diagnostic({
        code: 'input/artifact-unreadable', message: `Could not read the HTML artifact: ${error.message}`,
        subject: { artifact: artifactPath },
        evidence: { reason: error.message, ...(error.code ? { systemCode: error.code } : {}) },
        supportedFixes: ['provide an existing readable .html artifact, then rerun the checker'],
      })],
    };
  }
  try {
    const inspection = {};
    const provenance = inspectDeliveryProvenance(
      artifactPath,
      artifactCapture.content.buffer,
      {
        requireProvenance,
        pathIdentityRuntime,
        expectedSidecar: expectedBindings?.sidecar,
        inspection,
      },
    );
    const verification = verifyRegularFileBinding(artifactCapture.binding, {
      filePath: stableArtifactPath,
      expectedLinks: 1,
    });
    if (verification.status !== 'match') {
      return {
        ok: false,
        status: 'mismatch',
        diagnostics: [diagnostic({
          code: 'delivery/provenance-mismatch',
          message: 'The artifact changed while delivery provenance was being inspected.',
          subject: { artifact: artifactPath },
          evidence: { artifactState: verification.reason },
          supportedFixes: ['finish delivery and other writes before rerunning the checker'],
        })],
      };
    }
    const result = {
      ...provenance,
      artifact: {
        sha256: artifactCapture.content.sha256,
        bytes: artifactCapture.content.bytes,
      },
    };
    Object.defineProperty(result, 'fileBindings', {
      enumerable: false,
      value: {
        artifact: {
          identity: {
            device: artifactCapture.identity.device,
            inode: artifactCapture.identity.inode,
          },
          content: {
            sha256: artifactCapture.content.sha256,
            bytes: artifactCapture.content.bytes,
          },
          mode: artifactCapture.mode,
        },
        ...(inspection.sidecar ? { sidecar: inspection.sidecar } : {}),
      },
    });
    return result;
  } finally {
    releaseRegularFileBinding(artifactCapture.binding);
  }
}

function verifyDeliveryUnchanged(artifactPath, expected, checkedArtifact, pathIdentityRuntime) {
  const current = inspectArtifactDeliveryProvenance(
    artifactPath,
    false,
    pathIdentityRuntime,
    expected?.fileBindings,
  );
  if (current && !current.ok) return current;
  if (!current || !expected || current.status !== expected.status || current.receiptId !== expected.receiptId
    || current.artifact.sha256 !== expected.artifact.sha256 || current.artifact.bytes !== expected.artifact.bytes
    || checkedArtifact.sha256 !== expected.artifact.sha256 || checkedArtifact.bytes !== expected.artifact.bytes) {
    return {
      ok: false, status: 'mismatch',
      diagnostics: [diagnostic({
        code: 'delivery/provenance-mismatch', message: 'The artifact or delivery record changed during inspection.',
        subject: { artifact: artifactPath },
        evidence: { expected: expected?.artifact, checked: checkedArtifact, current: current?.artifact },
        supportedFixes: ['finish delivery and other writes before rerunning the checker'],
      })],
    };
  }
  return current;
}

function provenanceFailureReceipt({ command, artifactPath, provenance }) {
  const error = provenance.diagnostics[0].message;
  return {
    schemaVersion: 1,
    ok: false,
    command,
    ...(command === 'visual-check' ? {
      evidenceKind: 'automated-browser',
      status: 'fail',
      visualReview: 'pending',
    } : {}),
    provenance: provenance.status,
    ...(provenance.receiptId ? { deliveryReceiptId: provenance.receiptId } : {}),
    artifact: { path: artifactPath },
    error,
    ...(command === 'check' ? { file: artifactPath, diagnostic: error } : {}),
    diagnostics: provenance.diagnostics,
  };
}

async function commandCheck(args) {
  const knownOptions = new Set(['--require-provenance']);
  const unknown = args.find((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknown) fail(`Unknown check option "${unknown}".`);
  const requireProvenance = args.includes('--require-provenance');
  const positional = args.filter((arg) => !knownOptions.has(arg));
  const [html] = positional;
  if (!html || positional.length !== 1) fail(usage());
  const artifactPath = path.resolve(html);
  const pathIdentityRuntime = await loadPathIdentityRuntime();
  const provenance = inspectArtifactDeliveryProvenance(
    artifactPath,
    requireProvenance,
    pathIdentityRuntime,
  );
  if (provenance && !provenance.ok) {
    console.log(JSON.stringify(provenanceFailureReceipt({ command: 'check', artifactPath, provenance }), null, 2));
    process.exitCode = 1;
    return;
  }
  const result = runNode([path.join(skillRoot, 'scripts/check-render-output.mjs'), html], { stdio: 'pipe' });
  if (result.error) {
    console.error(result.error.message);
    process.exitCode = 1;
    return;
  }
  if (result.stdout) {
    let receipt;
    try {
      receipt = JSON.parse(result.stdout);
    } catch {
      process.stdout.write(result.stdout);
    }
    if (receipt) {
      if (provenance) {
        const verified = verifyDeliveryUnchanged(
          artifactPath,
          provenance,
          receipt.artifact || {},
          pathIdentityRuntime,
        );
        if (!verified.ok) {
          console.log(JSON.stringify(provenanceFailureReceipt({ command: 'check', artifactPath, provenance: verified }), null, 2));
          process.exitCode = 1;
          return;
        }
        receipt.provenance = provenance.status;
        if (provenance.receiptId) receipt.deliveryReceiptId = provenance.receiptId;
      }
      console.log(JSON.stringify(receipt, null, 2));
    }
  }
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

async function commandVisualCheck(rawArgs) {
  const { rest: args, outDir: rawOutDir } = extractOutDirArgs(rawArgs);
  const json = args.includes('--json');
  const requireProvenance = args.includes('--require-provenance');
  const knownOptions = new Set(['--json', '--require-provenance']);
  const unknown = args.filter((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknown.length) fail(`Unknown visual-check option "${unknown[0]}".`, 1);
  const positional = args.filter((arg) => !knownOptions.has(arg));
  if (positional.length !== 1) fail(usage(), 1);

  const artifactPath = path.resolve(positional[0]);
  let outDir;
  if (rawOutDir !== undefined) {
    const { resolveNativeOutputDirectory } = await import('../renderers/shared/output-path.mjs');
    try {
      outDir = resolveNativeOutputDirectory(rawOutDir);
    } catch (error) {
      const outputDiagnostic = error.archifyDiagnostics?.[0] || diagnostic({
        code: 'output/native-path-syntax',
        message: error.message,
        subject: { output: rawOutDir },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}) },
        supportedFixes: ['choose an ordinary native filesystem directory and retry'],
      });
      const failure = {
        schemaVersion: 1,
        ok: false,
        command: 'visual-check',
        evidenceKind: 'automated-browser',
        status: 'fail',
        visualReview: 'pending',
        artifact: { path: artifactPath },
        error: error.message,
        diagnostics: [outputDiagnostic],
      };
      if (json) console.log(JSON.stringify(failure, null, 2));
      else {
        console.error(formatDiagnostics(`automated browser evidence failed: ${failure.error}`, failure.diagnostics));
        console.error('perceptual visual review pending');
      }
      process.exitCode = 1;
      return;
    }
  }
  const pathIdentityRuntime = await loadPathIdentityRuntime();
  const provenance = inspectArtifactDeliveryProvenance(
    artifactPath,
    requireProvenance,
    pathIdentityRuntime,
  );
  let runVisualCheck;
  let persistVisualCheckFailure;
  try {
    ({ runVisualCheck, persistVisualCheckFailure } = await import('./visual-check.mjs'));
  } catch (error) {
    fail(`Could not load visual-check: ${error.message}`, 1);
  }
  if (provenance && !provenance.ok) {
    const receipt = persistVisualCheckFailure(artifactPath,
      provenanceFailureReceipt({ command: 'visual-check', artifactPath, provenance }),
      { outDir });
    if (json) console.log(JSON.stringify(receipt, null, 2));
    else {
      console.error(formatDiagnostics(`automated browser evidence failed: ${receipt.error}`, receipt.diagnostics));
      console.error('perceptual visual review pending');
    }
    process.exitCode = 1;
    return;
  }

  let result;
  try {
    result = await runVisualCheck({
      artifactPath: positional[0],
      outDir,
      ...(provenance ? { deliveryProvenance: provenance } : {}),
      verifyArtifact: (bytes) => {
        const verified = verifyDeliveryUnchanged(
          artifactPath,
          provenance,
          artifactIdentity(bytes),
          pathIdentityRuntime,
        );
        if (!verified.ok) {
          const error = new Error(verified.diagnostics[0].message);
          error.deliveryProvenance = verified;
          error.archifyDiagnostics = verified.diagnostics;
          throw error;
        }
      },
    });
  } catch (error) {
    const failure = persistVisualCheckFailure(artifactPath, {
        schemaVersion: 1,
        ok: false,
        command: 'visual-check',
        evidenceKind: 'automated-browser',
        status: 'fail',
        visualReview: 'pending',
        ...(provenance ? {
          provenance: provenance.status,
          ...(provenance.receiptId ? { deliveryReceiptId: provenance.receiptId } : {}),
        } : {}),
        artifact: { path: path.resolve(positional[0]) },
        error: error.message,
        diagnostics: [diagnostic({
          code: 'viewer/visual-check-input',
          message: 'visual-check could not read a valid HTML input or prepare its evidence files.',
          subject: { artifact: path.resolve(positional[0]) },
          evidence: { reason: error.message, ...(error.code ? { systemCode: error.code } : {}) },
          supportedFixes: ['provide an existing readable .html artifact and a writable directory for evidence files'],
        })],
      }, { outDir });
    if (json) {
      console.log(JSON.stringify(failure, null, 2));
    } else {
      console.error(formatDiagnostics(`automated browser evidence failed: ${failure.error}`, failure.diagnostics));
      console.error('perceptual visual review pending');
    }
    process.exitCode = 1;
    return;
  }

  if (json) {
    console.log(JSON.stringify(result.receipt, null, 2));
  } else {
    const sidecarDirectory = outDir || path.dirname(result.receipt.artifact.path);
    console.log(`automated browser evidence ${result.receipt.status}: ${result.receipt.artifact.path}`);
    console.log(`visual-check containment ${result.receipt.containment.status}; captures ${result.receipt.captures.status}; perceptual visual review pending`);
    console.log(`receipt ${path.join(sidecarDirectory, result.receipt.sidecars.receipt)}`);
    if (result.receipt.captures.contactSheet) {
      console.log(`contact sheet ${path.join(sidecarDirectory, result.receipt.captures.contactSheet)}`);
    }
    if (result.receipt.error) console.error(result.receipt.error);
  }
  process.exitCode = result.exitCode;
}

function commandExamples(args) {
  const unknown = args.find((arg) => arg.startsWith('--'));
  if (unknown) fail(`Unknown examples option "${unknown}".`);
  if (args.length) fail(usage());
  const result = runNode([path.join(skillRoot, 'scripts/render-examples.mjs')], { cwd: skillRoot });
  if (result.status !== 0) exitFrom(result);
}

async function commandDoctor(args) {
  const unknown = args.find((arg) => arg.startsWith('--'));
  if (unknown) fail(`Unknown doctor option "${unknown}".`);
  if (args.length) fail(usage());
  const checks = [];
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0], 10);
  checks.push({
    label: `Node.js v${process.versions.node} (requires >=18)`,
    ok: nodeMajor >= 18,
    missing: 0,
    failureLabel: 'unsupported',
  });

  const template = path.join(skillRoot, 'assets/template.html');
  checks.push({
    label: 'Core template',
    ok: fs.existsSync(template),
    missing: fs.existsSync(template) ? 0 : 1,
  });

  const examplesRenderer = path.join(skillRoot, 'scripts/render-examples.mjs');
  checks.push({
    label: 'Example renderer',
    ok: fs.existsSync(examplesRenderer),
    missing: fs.existsSync(examplesRenderer) ? 0 : 1,
  });

  const previewRuntime = path.join(skillRoot, 'bin/preview.mjs');
  checks.push({
    label: 'Live preview runtime',
    ok: fs.existsSync(previewRuntime),
    missing: fs.existsSync(previewRuntime) ? 0 : 1,
  });

  const visualCheckRuntime = path.join(skillRoot, 'bin/visual-check.mjs');
  checks.push({
    label: 'Visual-check runtime',
    ok: fs.existsSync(visualCheckRuntime),
    missing: fs.existsSync(visualCheckRuntime) ? 0 : 1,
  });

  const outputPathRuntime = path.join(skillRoot, 'renderers/shared/output-path.mjs');
  checks.push({
    label: 'Output path safety runtime',
    ok: fs.existsSync(outputPathRuntime),
    missing: fs.existsSync(outputPathRuntime) ? 0 : 1,
  });

  const atomicOutputRuntime = path.join(skillRoot, 'renderers/shared/atomic-output.mjs');
  checks.push({
    label: 'Atomic output safety runtime',
    ok: fs.existsSync(atomicOutputRuntime),
    missing: fs.existsSync(atomicOutputRuntime) ? 0 : 1,
  });

  const pathSemanticsRuntime = path.join(skillRoot, 'renderers/shared/path-semantics.mjs');
  checks.push({
    label: 'Physical path semantics runtime',
    ok: fs.existsSync(pathSemanticsRuntime),
    missing: fs.existsSync(pathSemanticsRuntime) ? 0 : 1,
  });

  const sidecarPathRuntime = path.join(skillRoot, 'renderers/shared/sidecar-path.mjs');
  checks.push({
    label: 'Sidecar path naming runtime',
    ok: fs.existsSync(sidecarPathRuntime),
    missing: fs.existsSync(sidecarPathRuntime) ? 0 : 1,
  });

  const portablePathRuntime = path.join(skillRoot, 'renderers/shared/portable-path.mjs');
  checks.push({
    label: 'Portable path contract runtime',
    ok: fs.existsSync(portablePathRuntime),
    missing: fs.existsSync(portablePathRuntime) ? 0 : 1,
  });

  const scenarioGuide = path.join(skillRoot, 'recipes/scenarios.mjs');
  checks.push({
    label: 'Scenario recipe guide',
    ok: fs.existsSync(scenarioGuide),
    missing: fs.existsSync(scenarioGuide) ? 0 : 1,
  });

  const authoringReferences = [
    path.join(skillRoot, 'references', 'authoring-contract.md'),
    path.join(skillRoot, 'references', 'viewer-runtime.md'),
    path.join(skillRoot, 'references', 'delivery-contract.md'),
    path.join(skillRoot, 'references', 'architecture-atlas.md'),
  ];
  const authoringReferencesMissing = authoringReferences.filter((file) => !fs.existsSync(file)).length;
  checks.push({
    label: 'Progressive authoring references',
    ok: authoringReferencesMissing === 0,
    missing: authoringReferencesMissing,
  });

  const compareRuntime = path.join(skillRoot, 'delta/architecture-delta.mjs');
  const compareFixtures = [
    path.join(skillRoot, 'examples/checkout-platform.base.architecture.json'),
    path.join(skillRoot, 'examples/checkout-platform.head.architecture.json'),
  ];
  const compareMissing = [compareRuntime, ...compareFixtures].filter((file) => !fs.existsSync(file)).length;
  checks.push({
    label: 'Architecture compare runtime and proof fixtures',
    ok: compareMissing === 0,
    missing: compareMissing,
  });

  const validators = path.join(skillRoot, 'renderers/shared/generated-validators.mjs');
  const validatorsExist = fs.existsSync(validators);
  let validatorsValid = false;
  if (validatorsExist) {
    try {
      const module = await import(`${pathToFileURL(validators).href}?doctor=${Date.now()}`);
      validatorsValid = [...TYPES].every((type) => typeof module[type] === 'function');
    } catch {
      validatorsValid = false;
    }
  }
  checks.push({
    label: 'Standalone schema validators',
    ok: validatorsValid,
    missing: validatorsExist ? 0 : 1,
    invalid: validatorsExist && !validatorsValid ? 1 : 0,
    failureLabel: validatorsExist ? 'invalid' : 'missing',
  });

  const examples = {
    architecture: 'web-app.architecture.json',
    workflow: 'agent-tool-call.workflow.json',
    sequence: 'cache-miss-request.sequence.json',
    dataflow: 'product-analytics.dataflow.json',
    lifecycle: 'agent-run.lifecycle.json',
  };

  for (const type of TYPES) {
    const required = [
      path.join(skillRoot, 'renderers', type, `render-${type}.mjs`),
      path.join(skillRoot, 'schemas', `${type}.schema.json`),
      path.join(skillRoot, 'examples', examples[type]),
    ];
    const missing = required.filter((file) => !fs.existsSync(file)).length;
    checks.push({
      label: `${type} renderer, schema, and example`,
      ok: missing === 0,
      missing,
    });
  }

  console.log('Archify doctor\n');
  for (const check of checks) {
    console.log(`[${check.ok ? 'ok' : (check.failureLabel || 'missing')}] ${check.label}`);
  }

  const nodeFailed = checks[0].ok ? 0 : 1;
  const missingFiles = checks.reduce((count, check) => count + check.missing, 0);
  const invalidRuntime = checks.reduce((count, check) => count + (check.invalid || 0), 0);
  if (nodeFailed === 0 && missingFiles === 0 && invalidRuntime === 0) {
    console.log('\nArchify is ready.');
    return;
  }

  const problems = [];
  if (nodeFailed) problems.push('Node.js 18 or newer is required');
  if (missingFiles) problems.push(`${missingFiles} required file${missingFiles === 1 ? '' : 's'} missing`);
  if (invalidRuntime) problems.push(`${invalidRuntime} runtime check${invalidRuntime === 1 ? '' : 's'} failed`);
  console.error(`\nArchify is not ready: ${problems.join('; ')}.`);
  process.exitCode = 1;
}

async function commandGuide(args) {
  let lang;
  let json = false;
  const queryParts = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
    } else if (arg === '--lang') {
      const value = args[index + 1];
      if (value !== 'en' && value !== 'zh') fail('--lang must be "en" or "zh".');
      lang = value;
      index += 1;
    } else if (arg.startsWith('--lang=')) {
      const value = arg.slice('--lang='.length);
      if (value !== 'en' && value !== 'zh') fail('--lang must be "en" or "zh".');
      lang = value;
    } else if (arg.startsWith('--')) {
      fail(`Unknown guide option "${arg}".`);
    } else {
      queryParts.push(arg);
    }
  }

  const guidePath = path.join(skillRoot, 'recipes/scenarios.mjs');
  let guide;
  try {
    guide = await import(pathToFileURL(guidePath).href);
  } catch (error) {
    fail(`Could not load the scenario recipe guide: ${error.message}`, 1);
  }

  const query = queryParts.join(' ').trim();
  if (!query) {
    const selectedLang = lang || 'en';
    if (json) {
      console.log(JSON.stringify({
        ok: true,
        mode: 'list',
        lang: selectedLang,
        recipes: guide.listScenarioRecipes(selectedLang),
      }, null, 2));
    } else {
      console.log(guide.formatScenarioList(selectedLang));
    }
    return;
  }

  const result = guide.recommendScenario(query, lang ? { lang } : {});
  console.log(json ? JSON.stringify(result, null, 2) : guide.formatScenarioRecommendation(result));
}

async function commandBrands(args) {
  const json = args.includes('--json');
  const unknown = args.filter((arg) => arg.startsWith('--') && arg !== '--json');
  if (unknown.length) fail(`Unknown brands option "${unknown[0]}".`);
  const positional = args.filter((arg) => arg !== '--json');
  if (positional[0] === 'capture') {
    if (positional.length !== 2) fail('Usage: archify brands capture <url> [--json]');
    const { captureBrandReference } = await import('../renderers/shared/brand-marks.mjs');
    let capture;
    try {
      capture = await captureBrandReference(positional[1]);
    } catch (error) {
      fail(error.message);
    }
    const result = {
      schemaVersion: 1,
      ok: true,
      command: 'brands capture',
      brand: capture.brand,
      evidence: {
        status: capture.resolved.status,
        source: capture.resolved.sourceUrl,
        ...(capture.resolved.sha256 ? { sha256: capture.resolved.sha256 } : {}),
        ...(capture.resolved.contentType ? { contentType: capture.resolved.contentType } : {}),
      },
    };
    console.log(json ? JSON.stringify(result, null, 2) : JSON.stringify(result.brand));
    return;
  }
  const query = positional.join(' ').trim();
  const { listBrandMarks } = await import('../renderers/shared/brand-marks.mjs');
  const marks = listBrandMarks(query);
  if (json) {
    console.log(JSON.stringify({
      schemaVersion: 1,
      ok: true,
      command: 'brands',
      query,
      count: marks.length,
      marks,
      fallback: 'Run "archify brands capture <url> --json", then use the returned digest-pinned brand value.',
    }, null, 2));
    return;
  }
  if (!marks.length) {
    console.log(`No built-in brand matched "${query}". Run "archify brands capture <url> --json", then use the returned digest-pinned brand value.`);
    return;
  }
  const grouped = Map.groupBy
    ? Map.groupBy(marks, (mark) => mark.category)
    : marks.reduce((map, mark) => map.set(mark.category, [...(map.get(mark.category) || []), mark]), new Map());
  for (const [category, entries] of grouped) {
    console.log(`${category}: ${entries.map((mark) => mark.id).join(', ')}`);
  }
}

function commandDemo(args) {
  const unknown = args.find((arg) => arg.startsWith('--'));
  if (unknown) fail(`Unknown demo option "${unknown}".`);
  if (args.length > 1) fail(usage());

  const outputDirectory = path.resolve(args[0] || process.cwd());
  const output = path.join(outputDirectory, 'archify-demo.html');
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');

  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
  } catch (error) {
    fail(`Could not create demo directory "${outputDirectory}": ${error.message}`, 1);
  }

  const result = runNode([rendererPath('architecture'), input, output]);
  if (result.status !== 0) exitFrom(result);

  console.log(`\nDemo ready: ${output}`);
  console.log('Next: open the HTML in your browser, then render your own diagram:');
  console.log('  archify render architecture <input.json> <output.html>');
}

function migrationPathDiagnostics(error, sourcePath, destinationPath) {
  if (Array.isArray(error?.archifyDiagnostics) && error.archifyDiagnostics.length) {
    return error.archifyDiagnostics.map((entry) => ({
      ...entry,
      subject: { ...(entry.subject || {}) },
      evidence: { ...(entry.evidence || {}) },
      supportedFixes: [...(entry.supportedFixes || [])],
    }));
  }
  return [diagnostic({
    code: 'migration/path-preflight',
    message: 'Could not verify that the workflow migration paths are distinct.',
    subject: { source: sourcePath, destination: destinationPath },
    evidence: {
      ...(error?.code ? { systemCode: error.code } : {}),
      reason: error?.message || String(error),
    },
    supportedFixes: ['remove unsafe path aliases or choose a different destination path'],
  })];
}

function migrationReport({
  ok,
  sourcePath,
  destinationPath,
  sourceBytes,
  destinationBytes,
  fromSchemaVersion,
  preExistingDiagnostics = [],
  migrationDiagnostics = [],
  newSchemaDiagnostics = [],
  changedCoordinates = [],
  oldRequiredViewBox = null,
  newRequiredViewBox = null,
}) {
  const report = {
    ok,
    command: 'migrate',
    type: 'workflow',
    source: {
      path: sourcePath,
      ...(sourceBytes ? {
        sha256: createHash('sha256').update(sourceBytes).digest('hex'),
        bytes: sourceBytes.length,
      } : {}),
    },
    destination: {
      path: destinationPath,
      ...(destinationBytes ? {
        sha256: createHash('sha256').update(destinationBytes).digest('hex'),
        bytes: destinationBytes.length,
      } : {}),
    },
    fromSchemaVersion: fromSchemaVersion ?? null,
    toSchemaVersion: 2,
    preExistingDiagnostics,
    migrationDiagnostics,
    newSchemaDiagnostics,
    changedCoordinates,
    oldRequiredViewBox,
    newRequiredViewBox,
  };
  if (!ok) {
    report.diagnostics = [
      ...migrationDiagnostics,
      ...newSchemaDiagnostics,
      ...preExistingDiagnostics,
    ];
    if (!report.diagnostics.length) {
      report.diagnostics.push(diagnostic({
        code: 'migration/internal',
        message: 'Workflow migration failed without a classified diagnostic.',
      }));
    }
    report.error = report.diagnostics[0].message;
  }
  return report;
}

function extractMigrationOptions(args) {
  const positional = [];
  let json = false;
  let toSchema;
  let output;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      json = true;
      continue;
    }
    if (arg === '--to-schema') {
      toSchema = args[index + 1];
      if (!toSchema || toSchema.startsWith('--')) fail('--to-schema requires a schema version.');
      index += 1;
      continue;
    }
    if (arg.startsWith('--to-schema=')) {
      toSchema = arg.slice('--to-schema='.length);
      if (!toSchema) fail('--to-schema requires a schema version.');
      continue;
    }
    if (arg === '--output') {
      output = args[index + 1];
      if (!output || output.startsWith('--')) fail('--output requires a portable HTML path.');
      index += 1;
      continue;
    }
    if (arg.startsWith('--output=')) {
      output = arg.slice('--output='.length);
      if (!output) fail('--output requires a portable HTML path.');
      continue;
    }
    if (arg.startsWith('--')) fail(`Unknown migrate option "${arg}".`);
    positional.push(arg);
  }
  return { positional, json, toSchema, output };
}

async function commandMigrate(args) {
  const repoArgs = extractRepoRootArgs(args);
  const options = extractMigrationOptions(repoArgs.rest);
  const [type, sourceArgument, destinationArgument] = options.positional;
  if (
    type !== 'workflow'
    || !sourceArgument
    || !destinationArgument
    || options.positional.length !== 3
    || options.toSchema !== '2'
  ) {
    fail('Usage: archify migrate workflow <old.json> <new.json> --to-schema 2 [--output portable.html] [--json] [--repo-root path]');
  }

  const sourcePath = path.resolve(sourceArgument);
  const destinationPath = path.resolve(destinationArgument);
  let sourceBytes;
  let sourceDocument;
  const reportMigrationFailure = ({ status = 1, ...details }) => {
    const report = migrationReport({
      ...details,
      ok: false,
      sourcePath,
      destinationPath,
      sourceBytes,
      fromSchemaVersion: sourceDocument?.schema_version,
    });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else console.error(formatDiagnostics(report.error, report.diagnostics));
    process.exitCode = status;
  };
  try {
    sourceBytes = fs.readFileSync(sourcePath);
    sourceDocument = JSON.parse(sourceBytes.toString('utf8'));
  } catch (error) {
    reportMigrationFailure({
      preExistingDiagnostics: [inputDiagnostic(error, sourcePath)],
    });
    return;
  }
  const { pathsAlias, validateAuthoredOutputPath } = await import('../renderers/shared/output-path.mjs');
  const {
    backupPublicRegularFileBinding,
    captureAtomicOutput,
    captureRegularFileBinding,
    quarantineRemoveRegularFileBinding,
    releaseRegularFileBinding,
    verifyAtomicOutput,
    verifyRegularFileBinding,
  } = await import('../renderers/shared/atomic-output.mjs');
  // `--output` repairs only the durable output field in the migration
  // candidate. It never writes the source and deliberately leaves every
  // other schema and compiler failure visible to the normal migration path.
  let migrationSourceDocument = sourceDocument;
  if (options.output !== undefined) {
    try {
      validateAuthoredOutputPath(options.output);
    } catch (error) {
      reportMigrationFailure({
        preExistingDiagnostics: migrationPathDiagnostics(error, sourcePath, destinationPath),
      });
      return;
    }
    if (sourceDocument?.meta && typeof sourceDocument.meta === 'object' && !Array.isArray(sourceDocument.meta)) {
      migrationSourceDocument = {
        ...sourceDocument,
        meta: { ...sourceDocument.meta, output: options.output },
      };
    }
  }
  if (migrationSourceDocument?.meta?.output !== undefined) {
    try {
      validateAuthoredOutputPath(migrationSourceDocument.meta.output);
    } catch (error) {
      reportMigrationFailure({
        preExistingDiagnostics: migrationPathDiagnostics(error, sourcePath, destinationPath),
      });
      return;
    }
  }
  // Unlike render/validate, migrate has no --quality override. Pin every stage
  // to the document's durable policy and scrub any ambient profile from the
  // staged renderer by passing this value explicitly.
  const activeQualityProfile = migrationSourceDocument?.meta?.quality_profile || 'standard';

  let sourceDestinationAlias;
  try {
    sourceDestinationAlias = pathsAlias(sourcePath, destinationPath);
  } catch (error) {
    reportMigrationFailure({
      migrationDiagnostics: migrationPathDiagnostics(error, sourcePath, destinationPath),
    });
    return;
  }
  if (sourceDestinationAlias) {
    reportMigrationFailure({
      migrationDiagnostics: [diagnostic({
        code: 'migration/source-destination',
        message: 'Workflow migration source and destination must be different files.',
        subject: { source: sourcePath, destination: destinationPath },
        supportedFixes: ['choose a different destination path and keep the source unchanged'],
      })],
    });
    return;
  }

  const { migrateWorkflowDocument, serializeMigratedWorkflow } = await import('../migrations/workflow-v2.mjs');
  let migration;
  try {
    migration = migrateWorkflowDocument(migrationSourceDocument);
  } catch (error) {
    migration = {
      ok: false,
      migrationDiagnostics: [diagnostic({
        code: 'migration/internal',
        message: 'Workflow migration failed unexpectedly.',
        evidence: { reason: error.message },
        supportedFixes: ['report the source workflow and this diagnostic to the Archify maintainers'],
      })],
    };
  }

  if (!migration.ok) {
    reportMigrationFailure(migration);
    return;
  }

  const destinationDirectory = path.dirname(destinationPath);
  let stagingDirectory;
  let stagingIdentity;
  let destinationCapture;
  try {
    fs.mkdirSync(destinationDirectory, { recursive: true });
    destinationCapture = captureAtomicOutput(destinationPath, {
      requestedEntryPolicy: 'regular-or-absent',
    });
    if (destinationCapture.status !== 'captured') {
      reportMigrationFailure({
        ...migration,
        migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
          code: 'migration/destination-type',
          message: 'Workflow migration destination must be an absent or stable regular file path.',
          subject: { destination: destinationPath },
          evidence: { targetState: destinationCapture.reason },
          supportedFixes: ['choose a destination path that is absent or names one non-hardlinked regular file'],
        })],
      });
      return;
    }
    const staging = createOwnedEmptyStagingDirectory(
      path.join(destinationDirectory, '.archify-migration-'),
    );
    stagingDirectory = staging.directory;
    stagingIdentity = staging.identity;
  } catch (error) {
    reportMigrationFailure({
      ...migration,
      migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
        code: 'migration/prepare-destination',
        message: 'Could not prepare the workflow migration destination.',
        subject: { destination: destinationPath },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
        supportedFixes: ['choose a writable destination directory'],
      })],
    });
    return;
  }

  const candidatePath = path.join(stagingDirectory, 'candidate.workflow.json');
  const artifactPath = path.join(stagingDirectory, 'migration-check.html');
  const destinationBytes = Buffer.from(serializeMigratedWorkflow(migration.document));
  let candidateBinding = null;
  let previousDestinationBinding = null;
  let preserveRecoveryDirectory = false;
  const fileBindingRuntime = {
    captureRegularFileBinding,
    quarantineRemoveRegularFileBinding,
    releaseRegularFileBinding,
  };
  const stagingOwnership = [];
  try {
    fs.writeFileSync(candidatePath, destinationBytes, { flag: 'wx' });
    if (destinationCapture.mode !== null) fs.chmodSync(candidatePath, destinationCapture.mode);
    const candidateCapture = captureOwnedStagingFile(
      stagingOwnership,
      candidatePath,
      fileBindingRuntime,
      {
        subject: 'migration-candidate',
        content: artifactIdentity(destinationBytes),
      },
    );
    candidateBinding = candidateCapture.binding;
    const render = runNode([rendererPath('workflow'), candidatePath, artifactPath], {
      stdio: 'pipe',
      env: rendererEnv(activeQualityProfile, repoArgs.repoRoot, true),
    });
    if (render.status !== 0) {
      const failure = rendererFailure(render);
      reportMigrationFailure({
        ...migration,
        newSchemaDiagnostics: [...migration.newSchemaDiagnostics, ...failure.diagnostics],
        status: render.status ?? 1,
      });
      return;
    }
    const migrationArtifact = fs.readFileSync(artifactPath);
    captureOwnedStagingFile(stagingOwnership, artifactPath, fileBindingRuntime, {
      subject: 'migration-check-artifact',
      content: artifactIdentity(migrationArtifact),
    });

    const check = runNode([path.join(skillRoot, 'scripts/check-render-output.mjs'), artifactPath], {
      stdio: 'pipe',
    });
    if (check.status !== 0) {
      let checker;
      try {
        checker = JSON.parse(check.stdout);
      } catch {
        checker = null;
      }
      reportMigrationFailure({
        ...migration,
        newSchemaDiagnostics: [
          ...migration.newSchemaDiagnostics,
          ...checkerDiagnostics(checker),
        ],
        status: check.status ?? 1,
      });
      return;
    }

    if (pathsAlias(sourcePath, destinationPath)) {
      reportMigrationFailure({
        ...migration,
        migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
          code: 'migration/source-destination',
          message: 'Workflow migration source and destination resolved to the same file before commit.',
          subject: { source: sourcePath, destination: destinationPath },
          supportedFixes: ['choose a different destination path and retry'],
        })],
      });
      return;
    }
    const currentSourceBytes = fs.readFileSync(sourcePath);
    if (!currentSourceBytes.equals(sourceBytes)) {
      reportMigrationFailure({
        ...migration,
        migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
          code: 'migration/source-changed',
          message: 'Workflow migration source changed while the destination was being verified.',
          subject: { source: sourcePath },
          supportedFixes: ['retry the migration from a stable workflow source file'],
        })],
      });
      return;
    }

    const candidateVerification = verifyRegularFileBinding(candidateBinding, { expectedLinks: 1 });
    if (candidateVerification.status !== 'match') {
      reportMigrationFailure({
        ...migration,
        migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
          code: 'migration/candidate-changed',
          message: 'Workflow migration candidate changed before the destination commit.',
          subject: { destination: destinationPath },
          evidence: { candidateState: candidateVerification.reason },
          supportedFixes: ['retry the migration from a stable workflow source and destination'],
        })],
      });
      return;
    }

    const destinationVerification = verifyAtomicOutput(destinationCapture.snapshot);
    if (destinationVerification.status !== 'match') {
      reportMigrationFailure({
        ...migration,
        migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
          code: 'migration/destination-changed',
          message: 'Workflow migration destination changed while the candidate was being verified.',
          subject: { destination: destinationPath },
          evidence: { targetState: destinationVerification.reason },
          supportedFixes: ['retry only after other processes stop creating, replacing, or redirecting the destination'],
        })],
      });
      return;
    }
    const backupPath = path.join(stagingDirectory, '.previous-destination');
    let backupPresent = false;
    if (destinationCapture.snapshot.target.kind === 'file') {
      const expected = destinationCapture.snapshot.target;
      const previousCapture = captureRegularFileBinding(destinationCapture.commitPath, {
        subject: 'previous-migration-destination',
        expectedIdentity: { device: expected.device, inode: expected.inode },
        expectedMode: expected.mode,
        expectedLinks: 1,
      });
      if (previousCapture.status !== 'captured') {
        reportMigrationFailure({
          ...migration,
          migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
            code: 'migration/destination-changed',
            message: 'Workflow migration destination changed before publication.',
            subject: { destination: destinationPath },
            evidence: { targetState: previousCapture.reason },
            supportedFixes: ['retry only after other processes stop changing the destination'],
          })],
        });
        return;
      }
      previousDestinationBinding = previousCapture.binding;
      const backedUp = backupPublicRegularFileBinding(
        previousDestinationBinding,
        destinationCapture.commitPath,
        backupPath,
        { subject: 'previous-migration-destination' },
      );
      backupPresent = backedUp.backupCreated === true;
      if (backedUp.status !== 'backed-up') {
        preserveRecoveryDirectory = backupPresent || backedUp.status === 'recovery-required';
        reportMigrationFailure({
          ...migration,
          migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
            code: 'migration/destination-changed',
            message: 'Workflow migration destination changed while its previous value was being preserved.',
            subject: { destination: destinationPath },
            evidence: {
              targetState: backedUp.reason,
              ...(backedUp.recoveryFile ? { recoveryFile: backedUp.recoveryFile } : {}),
            },
            supportedFixes: ['inspect the retained recovery entry before retrying'],
          })],
        });
        return;
      }
    }

    const candidateBeforePublish = verifyRegularFileBinding(candidateBinding, {
      filePath: candidatePath,
      expectedLinks: 1,
    });
    if (candidateBeforePublish.status !== 'match') {
      preserveRecoveryDirectory = backupPresent;
      reportMigrationFailure({
        ...migration,
        migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
          code: 'migration/candidate-changed',
          message: 'Workflow migration candidate changed before publication.',
          subject: { destination: destinationPath },
          evidence: { candidateState: candidateBeforePublish.reason },
          supportedFixes: ['inspect any retained previous destination, then retry'],
        })],
      });
      return;
    }
    try {
      fs.linkSync(candidatePath, destinationCapture.commitPath);
    } catch (error) {
      preserveRecoveryDirectory = backupPresent;
      reportMigrationFailure({
        ...migration,
        migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
          code: 'migration/destination-changed',
          message: 'Workflow migration destination was claimed during publication.',
          subject: { destination: destinationPath },
          evidence: {
            ...(error?.code ? { systemCode: error.code } : {}),
            ...(backupPresent ? { recoveryFile: backupPath } : {}),
          },
          supportedFixes: backupPresent
            ? ['preserve the claimant and inspect the retained previous destination before retrying']
            : ['preserve the claimant and retry with a different destination'],
        })],
      });
      return;
    }
    const published = verifyRegularFileBinding(candidateBinding, {
      filePath: destinationCapture.commitPath,
      expectedLinks: 2,
    });
    if (published.status !== 'match') {
      preserveRecoveryDirectory = backupPresent;
      reportMigrationFailure({
        ...migration,
        migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
          code: 'migration/destination-changed',
          message: 'Workflow migration destination changed during publication.',
          subject: { destination: destinationPath },
          evidence: { targetState: published.reason },
          supportedFixes: ['preserve the current claimant and inspect any retained recovery entry'],
        })],
      });
      return;
    }
    const removedCandidate = quarantineRemoveRegularFileBinding(candidateBinding, candidatePath, {
      subject: 'migration-candidate',
      expectedLinks: 2,
    });
    if (removedCandidate.status !== 'removed') {
      preserveRecoveryDirectory = backupPresent || removedCandidate.status === 'recovery-required';
      reportMigrationFailure({
        ...migration,
        migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
          code: 'migration/candidate-changed',
          message: 'Workflow migration candidate changed while publication was finalized.',
          subject: { destination: destinationPath },
          evidence: { candidateState: removedCandidate.reason },
          supportedFixes: ['preserve the candidate claimant and inspect the published destination'],
        })],
      });
      return;
    }
    const finalized = verifyRegularFileBinding(candidateBinding, {
      filePath: destinationCapture.commitPath,
      expectedLinks: 1,
    });
    if (finalized.status !== 'match') {
      preserveRecoveryDirectory = backupPresent;
      reportMigrationFailure({
        ...migration,
        migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
          code: 'migration/destination-changed',
          message: 'Published workflow migration changed before final verification.',
          subject: { destination: destinationPath },
          evidence: { targetState: finalized.reason },
          supportedFixes: ['preserve the current claimant and inspect any retained recovery entry'],
        })],
      });
      return;
    }
    if (backupPresent) {
      const removedBackup = quarantineRemoveRegularFileBinding(
        previousDestinationBinding,
        backupPath,
        { subject: 'previous-migration-destination', expectedLinks: 1 },
      );
      if (removedBackup.status === 'removed') backupPresent = false;
    }
    const finalPublishedState = verifyRegularFileBinding(candidateBinding, {
      filePath: destinationCapture.commitPath,
      expectedLinks: 1,
    });
    if (finalPublishedState.status !== 'match') {
      preserveRecoveryDirectory = backupPresent;
      reportMigrationFailure({
        ...migration,
        migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
          code: 'migration/destination-changed',
          message: 'Published workflow migration did not remain stable through finalization.',
          subject: { destination: destinationPath },
          evidence: { targetState: finalPublishedState.reason },
          supportedFixes: ['preserve the current destination and inspect any retained recovery entry'],
        })],
      });
      return;
    }
    const report = migrationReport({
      ...migration,
      sourcePath,
      destinationPath,
      sourceBytes,
      destinationBytes,
      fromSchemaVersion: sourceDocument.schema_version,
    });
    if (options.json) console.log(JSON.stringify(report, null, 2));
    else if (sourceDocument.schema_version === 1) {
      console.log(`migrated workflow schema v1→v2: ${sourcePath} → ${destinationPath}`);
    } else {
      console.log(`verified workflow schema v2 migration: ${sourcePath} → ${destinationPath}`);
    }
  } catch (error) {
    const migrationDiagnostics = Array.isArray(error?.archifyDiagnostics)
      ? migrationPathDiagnostics(error, sourcePath, destinationPath)
      : [diagnostic({
        code: 'migration/commit',
        message: 'Could not commit the verified workflow migration.',
        subject: { destination: destinationPath },
        evidence: { ...(error?.code ? { systemCode: error.code } : {}), reason: error.message },
        supportedFixes: ['choose a writable regular-file destination and retry'],
      })];
    reportMigrationFailure({
      ...migration,
      migrationDiagnostics: [...migration.migrationDiagnostics, ...migrationDiagnostics],
    });
  } finally {
    if (previousDestinationBinding) releaseRegularFileBinding(previousDestinationBinding);
    try {
      if (preserveRecoveryDirectory) {
        releaseOwnedStagingBindings(stagingOwnership, fileBindingRuntime);
      } else {
        cleanupOwnedStagingDirectory(
          stagingDirectory,
          stagingIdentity,
          stagingOwnership,
          fileBindingRuntime,
        );
      }
    } catch (error) {
      console.error(`Warning: could not remove workflow migration staging directory "${stagingDirectory}": ${error.message}`);
    }
  }
}

async function commandValidate(args) {
  const qualityArgs = extractQualityArgs(args);
  const repoArgs = extractRepoRootArgs(qualityArgs.rest);
  args = repoArgs.rest;
  const quality = qualityArgs.quality;
  const repoRoot = repoArgs.repoRoot;
  const knownOptions = new Set(['--json', '--layout-json']);
  const unknown = args.filter((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknown.length) rejectCliArgument(`Unknown validate option "${unknown[0]}".`, {
    code: 'cli/unknown-option',
    subject: { option: unknown[0] },
    supportedFixes: ['remove the unknown option and retry'],
  });
  const json = args.includes('--json');
  const layoutJson = args.includes('--layout-json');
  const rest = args.filter((arg) => !knownOptions.has(arg));
  const [type, input] = rest;
  if (!type || !input || rest.length !== 2) rejectCliArgument(usage(), {
    code: 'cli/usage',
    supportedFixes: ['use: archify validate <type> <input.json> [options]'],
  });
  const renderer = rendererPath(type);

  if (layoutJson && !['architecture', 'workflow'].includes(type)) {
    rejectCliArgument('--layout-json is currently supported for architecture and workflow diagrams only.', {
      code: 'cli/unsupported-option',
      subject: { option: '--layout-json', type },
      supportedFixes: ['remove --layout-json or use an architecture or workflow diagram'],
    });
  }

  const inputPath = path.resolve(input);
  try {
    const document = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const [{ validateAuthoredOutputPath }, { validateSchema }] = await Promise.all([
      import('../renderers/shared/output-path.mjs'),
      import('../renderers/shared/validator.mjs'),
    ]);
    if (document?.meta?.output === undefined) validateSchema(type, document);
    else validateAuthoredOutputPath(document.meta.output);
  } catch (error) {
    const diagnostics = error.archifyDiagnostics || [inputDiagnostic(error, inputPath)];
    reportValidateFailure({
      json,
      stage: diagnostics.some((entry) => entry.code.startsWith('input/')) ? 'input' : 'render',
      type,
      input: inputPath,
      error: error.message,
      diagnostics,
      status: 1,
    });
    return;
  }

  if (layoutJson) {
    // Layout mode emits JSON without writing HTML; keep its unused target typed.
    const layoutOutput = path.join(os.tmpdir(), `archify-layout-${process.pid}-${type}.html`);
    const result = runNode([renderer, input, layoutOutput, '--layout-json'], {
      stdio: 'pipe',
      env: rendererEnv(quality, repoRoot, true),
    });
    if (result.status !== 0) {
      try {
        const receipt = JSON.parse(result.stdout);
        if (receipt?.contract && Array.isArray(receipt.diagnostics)) {
          process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
          process.exitCode = result.status ?? 1;
          return;
        }
      } catch {
        // Fall through to the renderer failure contract when no compiler
        // receipt was produced (for example, input JSON could not be read).
      }
      const failure = rendererFailure(result);
      reportValidateFailure({
        json,
        stage: failure.diagnostics.some((entry) => entry.code.startsWith('input/')) ? 'input' : 'render',
        type,
        input: path.resolve(input),
        error: failure.error,
        diagnostics: failure.diagnostics,
        status: result.status ?? 1,
      });
      return;
    }
    process.stdout.write(result.stdout);
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-validate-'));
  const out = path.join(tmp, `${type}.html`);
  let exitCode = 0;

  try {
    const render = runNode([renderer, input, out], {
      stdio: 'pipe',
      env: rendererEnv(quality, repoRoot, true),
    });
    if (render.status !== 0) {
      const failure = rendererFailure(render);
      reportValidateFailure({
        json,
        stage: failure.diagnostics.some((entry) => entry.code.startsWith('input/')) ? 'input' : 'render',
        type,
        input: path.resolve(input),
        error: failure.error,
        diagnostics: failure.diagnostics,
        status: render.status ?? 1,
      });
      exitCode = render.status ?? 1;
    } else {
      const check = runNode([path.join(skillRoot, 'scripts/check-render-output.mjs'), out], { stdio: 'pipe' });
      if (check.status !== 0) {
        let checker;
        try {
          checker = JSON.parse(check.stdout);
          checker.file = path.resolve(input);
        } catch {
          checker = { ok: false, diagnostic: 'Artifact checker failed without a parseable receipt.' };
        }
        reportValidateFailure({
          json,
          stage: 'check',
          type,
          input: path.resolve(input),
          error: 'Final artifact check failed.',
          diagnostics: checkerDiagnostics(checker),
          checker,
          status: check.status ?? 1,
        });
        exitCode = check.status ?? 1;
      } else {
        const result = JSON.parse(check.stdout);
        const engineeringProfile = engineeringProfileFromArtifact(fs.readFileSync(out));
        if (json) {
          console.log(JSON.stringify({
            schemaVersion: 1,
            ok: true,
            command: 'validate',
            type,
            input: path.resolve(input),
            checks: result.checks,
            composition: result.composition,
            ...(engineeringProfile ? { engineeringProfile } : {}),
          }, null, 2));
        } else {
          const engineering = engineeringProfile
            ? `; engineering ${engineeringProfile}: pass`
            : '';
          console.log(`ok ${type} ${path.resolve(input)} (${result.checks.length} artifact checks; composition ${result.composition.profile}: ${result.composition.summary.errors} errors, ${result.composition.summary.warnings} warnings${engineering})`);
        }
      }
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (exitCode !== 0) process.exitCode = exitCode;
}

const [command, ...args] = process.argv.slice(2);

try {
  switch (command) {
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      console.log(usage());
      break;
    case 'render':
      commandRender(args);
      break;
    case 'compare':
      await commandCompare(args);
      break;
    case 'deliver':
      await commandDeliver(args);
      break;
    case 'preview':
      await commandPreview(args);
      break;
    case 'validate':
      await commandValidate(args);
      break;
    case 'migrate':
      await commandMigrate(args);
      break;
    case 'inspect':
      if (args[0] !== 'architecture') {
        fail('inspect is currently supported for architecture diagrams only.');
      }
      commandValidate([...args, '--layout-json']);
      break;
    case 'check':
      await commandCheck(args);
      break;
    case 'visual-check':
      await commandVisualCheck(args);
      break;
    case 'guide':
      await commandGuide(args);
      break;
    case 'brands':
      await commandBrands(args);
      break;
    case 'examples':
      commandExamples(args);
      break;
    case 'doctor':
      await commandDoctor(args);
      break;
    case 'demo':
      commandDemo(args);
      break;
    default:
      fail(`Unknown command "${command}".\n\n${usage()}`);
  }
} catch (error) {
  if (!error.archifyArgument) throw error;
  if (['validate', 'deliver'].includes(command) && args.includes('--json')) {
    reportArtifactArgumentFailure(command, error);
  } else {
    fail(error.message);
  }
}
