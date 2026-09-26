import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalFuturePath } from './output-path.mjs';

function relation(status, code, details = {}) {
  return { status, reason: { code, ...details } };
}

function filesystemFailure(code, error, details = {}) {
  return relation('unknown', code, {
    ...details,
    ...(typeof error?.code === 'string' ? { systemCode: error.code } : {}),
    ...(typeof error?.message === 'string' ? { message: error.message } : {}),
  });
}

function entryType(metadata) {
  if (metadata.isFile()) return 'file';
  if (metadata.isSymbolicLink()) return 'symbolic-link';
  if (metadata.isDirectory()) return 'directory';
  if (metadata.isFIFO()) return 'fifo';
  if (metadata.isSocket()) return 'socket';
  if (metadata.isBlockDevice()) return 'block-device';
  if (metadata.isCharacterDevice()) return 'character-device';
  return 'other';
}

// Windows lstat can fall back to directory enumeration when a file handle
// cannot be opened, and that fallback reports a synthetic link count of one.
// Treat handle-backed fstat as authoritative and fail closed when it cannot be
// reconciled with the no-follow path snapshots on either side of the open.
function captureRegularFileHandle(filePath, initial, subject) {
  const pathKey = subject === 'target'
    ? 'commitPath'
    : subject === 'requested-entry'
      ? 'requestedPath'
      : 'candidatePath';
  if (initial.ino === 0n) {
    return relation('unknown', `${subject}-identity-unavailable`, { [pathKey]: filePath });
  }
  let descriptor;
  let handle;
  let current;
  let closeError;
  try {
    const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);
    const nonBlock = fs.constants.O_NONBLOCK || 0;
    descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | noFollow | nonBlock);
    handle = fs.fstatSync(descriptor, { bigint: true });
    current = fs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    return filesystemFailure(`${subject}-handle-inspection-failed`, error, {
      [pathKey]: filePath,
    });
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch (error) {
        closeError = error;
      }
    }
  }
  if (closeError) {
    return filesystemFailure(`${subject}-handle-close-failed`, closeError, {
      [pathKey]: filePath,
    });
  }
  if (!handle.isFile() || !current.isFile()
    || handle.ino === 0n || current.ino === 0n
    || handle.dev !== initial.dev || handle.ino !== initial.ino
    || current.dev !== handle.dev || current.ino !== handle.ino) {
    return relation('unknown', `${subject}-changed-during-inspection`, {
      [pathKey]: filePath,
    });
  }
  if (handle.nlink === 0n) {
    return relation('unknown', `${subject}-link-count-unavailable`, {
      [pathKey]: filePath,
    });
  }
  if (handle.nlink !== 1n) {
    return relation('unsupported', `${subject}-hardlinked`, {
      [pathKey]: filePath,
      links: handle.nlink.toString(),
    });
  }
  return { status: 'captured', metadata: handle };
}

const regularFileBindings = new WeakMap();
const regularFileBindingGroups = new Map();
const digestChunkBytes = 64 * 1024;
const removalCleanupSignal = new Int32Array(new SharedArrayBuffer(4));
const removalCleanupAttempts = 10;
const publicationRecoveryRecordName = 'publication-recovery-v1.json';
const publicationRecoveryRecordVersion = 1;
const publicationRecoveryRecordMaxBytes = 16 * 1024;

export function removeEmptyDirectoryWithRetry(directory, { retry = true } = {}) {
  const attempts = retry ? removalCleanupAttempts : 1;
  let failure;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmdirSync(directory);
      return;
    } catch (error) {
      failure = error;
      // SMB can acknowledge unlink before a following directory removal sees
      // the deleted entry disappear. Retrying rmdir is claimant-safe: a real
      // entry keeps the directory non-empty and is never removed recursively.
      if (error?.code !== 'ENOTEMPTY' || attempt === attempts - 1) break;
      Atomics.wait(
        removalCleanupSignal,
        0,
        0,
        Math.min(5 * (2 ** attempt), 250),
      );
    }
  }
  throw failure;
}

function validExpectedLinks(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validateBindingExpectations(options) {
  const hasSha256 = options.expectedSha256 !== undefined;
  const hasBytes = options.expectedBytes !== undefined;
  const expectedIdentity = options.expectedIdentity;
  if (hasSha256 !== hasBytes
    || (hasSha256 && !/^[a-f\d]{64}$/i.test(options.expectedSha256))
    || (hasBytes && (!Number.isSafeInteger(options.expectedBytes) || options.expectedBytes < 0))
    || (options.expectedMode !== undefined
      && (!Number.isSafeInteger(options.expectedMode)
        || options.expectedMode < 0
        || options.expectedMode > 0o777))
    || (expectedIdentity !== undefined
      && (typeof expectedIdentity?.device !== 'bigint'
        || typeof expectedIdentity?.inode !== 'bigint'
        || expectedIdentity.inode === 0n))
    || typeof options.includeContent !== 'boolean'
    || !validExpectedLinks(options.expectedLinks)) {
    return relation('unknown', 'invalid-regular-file-binding-expectation');
  }
  return null;
}

function descriptorDigest(descriptor, expectedSize, subject, filePath, includeContent) {
  if (expectedSize < 0n || expectedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
    return relation('unknown', `${subject}-size-unavailable`, { filePath });
  }
  const expectedBytes = Number(expectedSize);
  const digest = createHash('sha256');
  let capturedContent;
  let chunk;
  try {
    capturedContent = includeContent ? Buffer.allocUnsafe(expectedBytes) : null;
    chunk = capturedContent
      || Buffer.allocUnsafe(Math.min(digestChunkBytes, Math.max(1, expectedBytes)));
  } catch (error) {
    return filesystemFailure(`${subject}-content-inspection-failed`, error, { filePath });
  }
  let bytes = 0;
  try {
    while (bytes < expectedBytes) {
      const offset = includeContent ? bytes : 0;
      const read = fs.readSync(
        descriptor,
        chunk,
        offset,
        Math.min(digestChunkBytes, chunk.byteLength - offset, expectedBytes - bytes),
        bytes,
      );
      if (read === 0) break;
      digest.update(chunk.subarray(offset, offset + read));
      bytes += read;
    }
  } catch (error) {
    return filesystemFailure(`${subject}-content-inspection-failed`, error, { filePath });
  }
  return {
    status: 'inspected',
    sha256: digest.digest('hex'),
    bytes,
    ...(includeContent ? { buffer: capturedContent.subarray(0, bytes) } : {}),
  };
}

function sameHandleState(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function inspectRegularFileDescriptor({
  descriptor,
  filePath,
  identity,
  subject,
  expectedLinks,
  phase,
  includeContent = false,
}) {
  let beforeHandle;
  let beforePath;
  let afterHandle;
  let afterPath;
  let content;
  try {
    beforeHandle = fs.fstatSync(descriptor, { bigint: true });
    beforePath = fs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    return filesystemFailure(`${subject}-handle-${phase}-failed`, error, { filePath });
  }
  if (!beforeHandle.isFile() || !beforePath.isFile()) {
    return relation('unsupported', `${subject}-not-regular-file`, {
      filePath,
      entryType: entryType(beforePath),
    });
  }
  if (beforeHandle.ino === 0n || beforePath.ino === 0n) {
    return relation('unknown', `${subject}-identity-unavailable`, { filePath });
  }
  if (beforeHandle.dev !== identity.device
    || beforeHandle.ino !== identity.inode
    || beforePath.dev !== beforeHandle.dev
    || beforePath.ino !== beforeHandle.ino) {
    return relation(phase === 'inspection' ? 'unknown' : 'different',
      `${subject}-${phase === 'inspection' ? 'changed-during-inspection' : 'identity-changed'}`,
      { filePath });
  }
  if (beforeHandle.nlink === 0n) {
    return relation('unknown', `${subject}-link-count-unavailable`, { filePath });
  }
  if (beforeHandle.nlink !== BigInt(expectedLinks)) {
    if (beforeHandle.nlink > BigInt(expectedLinks)) {
      return relation('unsupported', `${subject}-hardlinked`, {
        filePath,
        links: beforeHandle.nlink.toString(),
      });
    }
    return relation('different', `${subject}-link-count-changed`, {
      filePath,
      expectedLinks,
      currentLinks: beforeHandle.nlink.toString(),
    });
  }
  content = descriptorDigest(
    descriptor,
    beforeHandle.size,
    subject,
    filePath,
    includeContent,
  );
  if (content.status !== 'inspected') return content;
  try {
    afterHandle = fs.fstatSync(descriptor, { bigint: true });
    afterPath = fs.lstatSync(filePath, { bigint: true });
  } catch (error) {
    return filesystemFailure(`${subject}-handle-${phase}-failed`, error, { filePath });
  }
  if (!afterHandle.isFile() || !afterPath.isFile()
    || afterHandle.ino === 0n || afterPath.ino === 0n
    || afterHandle.dev !== identity.device || afterHandle.ino !== identity.inode
    || afterPath.dev !== afterHandle.dev || afterPath.ino !== afterHandle.ino) {
    return relation(phase === 'inspection' ? 'unknown' : 'different',
      `${subject}-${phase === 'inspection' ? 'changed-during-inspection' : 'identity-changed'}`,
      { filePath });
  }
  if (!sameHandleState(beforeHandle, afterHandle)) {
    return relation('unknown', `${subject}-changed-during-${phase}`, { filePath });
  }
  if (content.bytes !== Number(afterHandle.size)) {
    return relation('unknown', `${subject}-changed-during-${phase}`, { filePath });
  }
  return { status: 'inspected', metadata: afterHandle, content };
}

function closeCapturedDescriptor(descriptor, subject, filePath) {
  try {
    fs.closeSync(descriptor);
    return null;
  } catch (error) {
    return filesystemFailure(`${subject}-handle-close-failed`, error, { filePath });
  }
}

/**
 * Capture a regular file through an open descriptor. The opaque binding keeps
 * the descriptor alive so callers can prove that the same inode, mode and
 * bytes are still named by either the original path or a deliberate hard-link
 * publication path. Callers must release every successfully captured binding.
 */
export function captureRegularFileBinding(filePath, {
  subject = 'file',
  expectedSha256,
  expectedBytes,
  expectedMode,
  expectedIdentity,
  expectedLinks = 1,
  includeContent = false,
} = {}) {
  const options = {
    expectedSha256,
    expectedBytes,
    expectedMode,
    expectedIdentity,
    expectedLinks,
    includeContent,
  };
  const invalid = validateBindingExpectations(options);
  if (invalid) return invalid;
  const resolvedPath = path.resolve(filePath);
  let initial;
  try {
    initial = fs.lstatSync(resolvedPath, { bigint: true });
  } catch (error) {
    return filesystemFailure(`${subject}-inspection-failed`, error, { filePath: resolvedPath });
  }
  const type = entryType(initial);
  if (type !== 'file') {
    return relation('unsupported', `${subject}-not-regular-file`, {
      filePath: resolvedPath,
      entryType: type,
    });
  }
  if (initial.ino === 0n) {
    return relation('unknown', `${subject}-identity-unavailable`, { filePath: resolvedPath });
  }

  let descriptor;
  try {
    const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);
    const nonBlock = fs.constants.O_NONBLOCK || 0;
    descriptor = fs.openSync(resolvedPath, fs.constants.O_RDONLY | noFollow | nonBlock);
  } catch (error) {
    return filesystemFailure(`${subject}-handle-inspection-failed`, error, { filePath: resolvedPath });
  }
  const identity = { device: initial.dev, inode: initial.ino };
  if (expectedIdentity !== undefined
    && (identity.device !== expectedIdentity.device
      || identity.inode !== expectedIdentity.inode)) {
    const closeFailure = closeCapturedDescriptor(descriptor, subject, resolvedPath);
    return closeFailure || relation('different', `${subject}-identity-changed`, {
      filePath: resolvedPath,
    });
  }
  const inspected = inspectRegularFileDescriptor({
    descriptor,
    filePath: resolvedPath,
    identity,
    subject,
    expectedLinks,
    phase: 'inspection',
    includeContent,
  });
  if (inspected.status !== 'inspected') {
    const closeFailure = closeCapturedDescriptor(descriptor, subject, resolvedPath);
    return closeFailure || inspected;
  }
  const mode = Number(inspected.metadata.mode & 0o777n);
  if (expectedMode !== undefined && mode !== expectedMode) {
    const closeFailure = closeCapturedDescriptor(descriptor, subject, resolvedPath);
    return closeFailure || relation('different', `${subject}-mode-changed`, {
      filePath: resolvedPath,
      expectedMode,
      currentMode: mode,
    });
  }
  if (expectedSha256 !== undefined
    && (inspected.content.sha256.toLowerCase() !== expectedSha256.toLowerCase()
      || inspected.content.bytes !== expectedBytes)) {
    const closeFailure = closeCapturedDescriptor(descriptor, subject, resolvedPath);
    return closeFailure || relation('different', `${subject}-content-changed`, {
      filePath: resolvedPath,
      expectedSha256,
      currentSha256: inspected.content.sha256,
      expectedBytes,
      currentBytes: inspected.content.bytes,
    });
  }

  const identityKey = `${identity.device}:${identity.inode}`;
  let cleanupGroup = regularFileBindingGroups.get(identityKey);
  if (!cleanupGroup) {
    cleanupGroup = { identityKey, bindings: 0, deferredCleanupDirectories: new Set() };
    regularFileBindingGroups.set(identityKey, cleanupGroup);
  }
  cleanupGroup.bindings += 1;
  const binding = Object.freeze({});
  regularFileBindings.set(binding, {
    descriptor,
    filePath: resolvedPath,
    subject,
    expectedLinks,
    cleanupGroup,
    identity,
    mode,
    sha256: inspected.content.sha256,
    bytes: inspected.content.bytes,
  });
  return {
    status: 'captured',
    binding,
    identity: { ...identity, mode, links: inspected.metadata.nlink },
    content: {
      sha256: inspected.content.sha256,
      bytes: inspected.content.bytes,
      ...(includeContent ? { buffer: inspected.content.buffer } : {}),
    },
    mode,
  };
}

/** Verify a captured descriptor against its original or an alternate linked path. */
export function verifyRegularFileBinding(binding, { filePath, expectedLinks } = {}) {
  const captured = regularFileBindings.get(binding);
  if (!captured) return relation('unknown', 'regular-file-binding-unavailable');
  const links = expectedLinks ?? captured.expectedLinks;
  if (!validExpectedLinks(links)) {
    return relation('unknown', 'invalid-regular-file-binding-expectation');
  }
  const verificationPath = path.resolve(filePath ?? captured.filePath);
  const inspected = inspectRegularFileDescriptor({
    descriptor: captured.descriptor,
    filePath: verificationPath,
    identity: captured.identity,
    subject: captured.subject,
    expectedLinks: links,
    phase: 'verification',
  });
  if (inspected.status !== 'inspected') return inspected;
  const mode = Number(inspected.metadata.mode & 0o777n);
  if (mode !== captured.mode) {
    return relation('different', `${captured.subject}-mode-changed`, {
      filePath: verificationPath,
      previousMode: captured.mode,
      currentMode: mode,
    });
  }
  if (inspected.content.sha256 !== captured.sha256
    || inspected.content.bytes !== captured.bytes) {
    return relation('different', `${captured.subject}-content-changed`, {
      filePath: verificationPath,
      previousSha256: captured.sha256,
      currentSha256: inspected.content.sha256,
      previousBytes: captured.bytes,
      currentBytes: inspected.content.bytes,
    });
  }
  return relation('match', `${captured.subject}-binding-match`, {
    filePath: verificationPath,
    links,
  });
}

/** Close and invalidate a captured regular-file binding. */
export function releaseRegularFileBinding(binding) {
  const captured = regularFileBindings.get(binding);
  if (!captured) return relation('unknown', 'regular-file-binding-unavailable');
  regularFileBindings.delete(binding);
  const failure = closeCapturedDescriptor(
    captured.descriptor,
    captured.subject,
    captured.filePath,
  );
  const { cleanupGroup } = captured;
  cleanupGroup.bindings -= 1;
  let cleanupFailure;
  if (cleanupGroup.bindings === 0) {
    regularFileBindingGroups.delete(cleanupGroup.identityKey);
    // A staging registry and its publication transaction can bind the same
    // inode independently. SMB may keep a retired name visible until every
    // descriptor closes, so cleanup belongs to the inode's last binding.
    for (const directory of cleanupGroup.deferredCleanupDirectories) {
      const cleanup = removeEmptyQuarantine(directory, { retry: true });
      cleanupFailure ||= cleanup;
    }
  }
  if (failure || cleanupFailure) return failure || cleanupFailure;
  return relation('released', `${captured.subject}-binding-released`, {
    filePath: captured.filePath,
  });
}

function createRemovalQuarantine(parentPath) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const directory = path.join(
      parentPath,
      `.archify-remove-${randomBytes(16).toString('hex')}`,
    );
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
      return { status: 'created', directory };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        return filesystemFailure('removal-quarantine-create-failed', error, {
          parentPath,
        });
      }
    }
  }
  return relation('unknown', 'removal-quarantine-name-exhausted', { parentPath });
}

function removeEmptyQuarantine(directory, { retry = false } = {}) {
  let failure;
  try {
    removeEmptyDirectoryWithRetry(directory, { retry });
    return null;
  } catch (error) {
    failure = error;
  }
  return filesystemFailure('removal-quarantine-cleanup-failed', failure, {
    recoveryDirectory: directory,
  });
}

function deferEmptyQuarantineCleanup(binding, cleanup) {
  if (cleanup?.reason?.code !== 'removal-quarantine-cleanup-failed'
    || cleanup.reason.systemCode !== 'ENOTEMPTY') return false;
  const captured = regularFileBindings.get(binding);
  if (!captured) return false;
  captured.cleanupGroup.deferredCleanupDirectories.add(cleanup.reason.recoveryDirectory);
  return true;
}

function removalRecovery(subject, code, filePath, quarantineDirectory, quarantineFile, error) {
  return {
    status: 'recovery-required',
    reason: {
      code: `${subject}-${code}`,
      filePath,
      ...(typeof error?.code === 'string' ? { systemCode: error.code } : {}),
      ...(error?.message ? { message: error.message } : {}),
    },
    recoveryDirectory: quarantineDirectory,
    recoveryFile: quarantineFile,
    target: filePath,
  };
}

function decimal(value) {
  return value.toString();
}

function parseDecimal(value) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function parseSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function serializeRequestedEntry(entry) {
  if (entry?.kind === 'absent') return { kind: 'absent' };
  if (entry?.kind !== 'existing' || typeof entry.entryType !== 'string'
    || typeof entry.device !== 'bigint' || typeof entry.inode !== 'bigint') {
    return null;
  }
  return {
    kind: 'existing',
    entryType: entry.entryType,
    device: decimal(entry.device),
    inode: decimal(entry.inode),
    ...(entry.entryType === 'symbolic-link' ? {
      changedAtNs: decimal(entry.changedAtNs),
      createdAtNs: decimal(entry.createdAtNs),
    } : {}),
  };
}

function createPublicationRecoveryRecord(directory, snapshot, previous) {
  const requestedEntry = serializeRequestedEntry(snapshot?.requestedEntry);
  const slot = snapshot?.slot;
  if (!requestedEntry || !slot || typeof snapshot?.requestedPath !== 'string'
    || typeof snapshot?.requestedEntryPolicy !== 'string'
    || typeof slot.commitPath !== 'string' || typeof slot.parentPath !== 'string'
    || typeof slot.name !== 'string' || typeof slot.parentDevice !== 'bigint'
    || typeof slot.parentInode !== 'bigint' || !previous?.identity
    || !previous?.content || !Number.isSafeInteger(previous.mode)) {
    return relation('unknown', 'publication-recovery-record-input-invalid');
  }
  const recordPath = path.join(directory, publicationRecoveryRecordName);
  let directoryMetadata;
  let parentMetadata;
  try {
    directoryMetadata = fs.lstatSync(directory, { bigint: true });
    parentMetadata = fs.statSync(path.dirname(directory), { bigint: true });
  } catch (error) {
    return filesystemFailure('publication-recovery-directory-inspection-failed', error, {
      recoveryDirectory: directory,
    });
  }
  if (!directoryMetadata.isDirectory() || directoryMetadata.ino === 0n
    || !parentMetadata.isDirectory()
    || parentMetadata.dev !== slot.parentDevice || parentMetadata.ino !== slot.parentInode
    || !/^\.archify-remove-[a-f\d]{32}$/.test(path.basename(directory))) {
    return relation('unknown', 'publication-recovery-directory-invalid', {
      recoveryDirectory: directory,
    });
  }
  const record = {
    version: publicationRecoveryRecordVersion,
    kind: 'archify-retired-output-recovery',
    backup: {
      name: 'previous',
      sha256: previous.content.sha256,
      bytes: previous.content.bytes,
      mode: previous.mode,
      device: decimal(previous.identity.device),
      inode: decimal(previous.identity.inode),
    },
    recovery: {
      name: path.basename(directory),
      device: decimal(directoryMetadata.dev),
      inode: decimal(directoryMetadata.ino),
    },
    target: {
      requestedPath: snapshot.requestedPath,
      requestedEntryPolicy: snapshot.requestedEntryPolicy,
      requestedEntry,
      commitPath: slot.commitPath,
      parentPath: slot.parentPath,
      parentDevice: decimal(slot.parentDevice),
      parentInode: decimal(slot.parentInode),
      name: slot.name,
    },
  };
  const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
  let descriptor;
  let writeFailure;
  try {
    descriptor = fs.openSync(
      recordPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600,
    );
    let offset = 0;
    while (offset < bytes.byteLength) {
      const wrote = fs.writeSync(descriptor, bytes, offset, bytes.byteLength - offset);
      if (wrote <= 0) throw Object.assign(new Error('short recovery record write'), { code: 'EIO' });
      offset += wrote;
    }
    fs.fsyncSync(descriptor);
  } catch (error) {
    writeFailure = error;
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch (error) {
        writeFailure ||= error;
      }
    }
  }
  if (writeFailure) {
    return filesystemFailure('publication-recovery-record-write-failed', writeFailure, {
      recoveryDirectory: directory,
      recoveryFile: recordPath,
    });
  }
  // POSIX requires the parent directory entry to be synced separately. Do not
  // claim a kill-recovery record is durable where the platform cannot do that.
  if (process.platform !== 'win32') {
    let directoryDescriptor;
    let directoryFailure;
    try {
      directoryDescriptor = fs.openSync(directory, fs.constants.O_RDONLY);
      fs.fsyncSync(directoryDescriptor);
    } catch (error) {
      directoryFailure = error;
    } finally {
      if (directoryDescriptor !== undefined) {
        try {
          fs.closeSync(directoryDescriptor);
        } catch (error) {
          directoryFailure ||= error;
        }
      }
    }
    if (directoryFailure) {
      return filesystemFailure('publication-recovery-record-directory-sync-failed', directoryFailure, {
        recoveryDirectory: directory,
        recoveryFile: recordPath,
      });
    }
  }
  const captured = captureRegularFileBinding(recordPath, {
    subject: 'publication-recovery-record',
    expectedSha256: createHash('sha256').update(bytes).digest('hex'),
    expectedBytes: bytes.byteLength,
    // Windows reports a synthetic POSIX mode whose read bits cannot represent
    // the private ACL established by the exclusive create above.
    expectedMode: process.platform === 'win32' ? undefined : 0o600,
    expectedLinks: 1,
  });
  if (captured.status !== 'captured') {
    return {
      ...captured,
      recoveryDirectory: directory,
      recoveryFile: recordPath,
    };
  }
  return {
    status: 'created',
    recordPath,
    binding: captured.binding,
  };
}

function discardPublicationRecoveryRecord(record) {
  if (!record?.binding || typeof record.recordPath !== 'string') return null;
  let removed;
  let released;
  try {
    removed = quarantineRemoveRegularFileBinding(record.binding, record.recordPath, {
      subject: 'publication-recovery-record',
      expectedLinks: 1,
    });
  } finally {
    released = releaseRegularFileBinding(record.binding);
  }
  if (released.status !== 'released') return released;
  return removed.status === 'removed' ? null : removed;
}

function releasePublicationRecoveryRecord(record) {
  if (!record?.binding) return null;
  const released = releaseRegularFileBinding(record.binding);
  return released.status === 'released' ? null : released;
}

/**
 * Remove a public regular-file name without a verify-to-unlink race. The
 * public entry is first moved into an unpredictable private directory and is
 * deleted only after the caller's still-open binding proves that the moved
 * inode, mode and bytes are the owned entry. If the move captured a successor,
 * restore it with a no-clobber hard link or retain it as recovery material.
 * The caller retains ownership of `binding` and must release it separately.
 */
export function quarantineRemoveRegularFileBinding(binding, filePath, {
  subject = 'public-entry',
  expectedLinks = 1,
} = {}) {
  if (!validExpectedLinks(expectedLinks)) {
    return relation('unknown', 'invalid-regular-file-binding-expectation');
  }
  const resolvedPath = path.resolve(filePath);
  const beforeMove = verifyRegularFileBinding(binding, {
    filePath: resolvedPath,
    expectedLinks,
  });
  if (beforeMove.status !== 'match') return beforeMove;

  const quarantine = createRemovalQuarantine(path.dirname(resolvedPath));
  if (quarantine.status !== 'created') return quarantine;
  const quarantineFile = path.join(quarantine.directory, path.basename(resolvedPath));
  const removeEmpty = () => removeEmptyQuarantine(quarantine.directory);
  const removeEmptyAfterFileRemoval = () => {
    const cleanup = removeEmpty();
    return cleanup && deferEmptyQuarantineCleanup(binding, cleanup) ? null : cleanup;
  };

  try {
    fs.renameSync(resolvedPath, quarantineFile);
  } catch (error) {
    const cleanup = removeEmpty();
    return cleanup || filesystemFailure(`${subject}-quarantine-move-failed`, error, {
      filePath: resolvedPath,
    });
  }

  const moved = verifyRegularFileBinding(binding, {
    filePath: quarantineFile,
    expectedLinks,
  });
  if (moved.status === 'match') {
    try {
      fs.unlinkSync(quarantineFile);
    } catch (error) {
      return removalRecovery(
        subject,
        'quarantine-cleanup-failed',
        resolvedPath,
        quarantine.directory,
        quarantineFile,
        error,
      );
    }
    const cleanup = removeEmptyAfterFileRemoval();
    return cleanup || relation('removed', `${subject}-removed`, { filePath: resolvedPath });
  }

  let displaced;
  try {
    displaced = fs.lstatSync(quarantineFile, { bigint: true });
  } catch (error) {
    return removalRecovery(
      subject,
      'replacement-inspection-failed',
      resolvedPath,
      quarantine.directory,
      quarantineFile,
      error,
    );
  }
  if (displaced.ino === 0n || displaced.nlink === 0n) {
    return removalRecovery(
      subject,
      'replacement-identity-unavailable',
      resolvedPath,
      quarantine.directory,
      quarantineFile,
    );
  }
  try {
    fs.linkSync(quarantineFile, resolvedPath);
  } catch (error) {
    return removalRecovery(
      subject,
      error?.code === 'EEXIST' ? 'replacement-restore-blocked' : 'replacement-restore-failed',
      resolvedPath,
      quarantine.directory,
      quarantineFile,
      error,
    );
  }

  let restored;
  let retained;
  try {
    restored = fs.lstatSync(resolvedPath, { bigint: true });
    retained = fs.lstatSync(quarantineFile, { bigint: true });
  } catch (error) {
    return removalRecovery(
      subject,
      'replacement-restore-verification-failed',
      resolvedPath,
      quarantine.directory,
      quarantineFile,
      error,
    );
  }
  if (restored.dev !== displaced.dev || restored.ino !== displaced.ino
    || retained.dev !== displaced.dev || retained.ino !== displaced.ino
    || restored.nlink !== displaced.nlink + 1n
    || retained.nlink !== displaced.nlink + 1n) {
    return removalRecovery(
      subject,
      'replacement-restore-identity-changed',
      resolvedPath,
      quarantine.directory,
      quarantineFile,
    );
  }
  try {
    fs.unlinkSync(quarantineFile);
  } catch (error) {
    return removalRecovery(
      subject,
      'replacement-quarantine-cleanup-failed',
      resolvedPath,
      quarantine.directory,
      quarantineFile,
      error,
    );
  }
  try {
    restored = fs.lstatSync(resolvedPath, { bigint: true });
  } catch (error) {
    const cleanup = removeEmptyAfterFileRemoval();
    return cleanup || filesystemFailure(
      `${subject}-replacement-final-verification-failed`,
      error,
      { filePath: resolvedPath },
    );
  }
  if (restored.dev !== displaced.dev || restored.ino !== displaced.ino
    || restored.nlink !== displaced.nlink) {
    const cleanup = removeEmptyAfterFileRemoval();
    return cleanup || relation('different', `${subject}-replacement-final-identity-changed`, {
      filePath: resolvedPath,
    });
  }
  const cleanup = removeEmptyAfterFileRemoval();
  return cleanup || relation('preserved', `${subject}-replacement-restored`, {
    filePath: resolvedPath,
    priorState: moved.reason,
  });
}

/**
 * Create a no-clobber hard-link backup of a bound public file, then remove the
 * public name through the quarantine protocol above. The backup is reported as
 * verified only after both names have been reconciled with the open binding.
 */
export function backupPublicRegularFileBinding(binding, filePath, backupPath, {
  subject = 'public-entry',
} = {}) {
  const resolvedPath = path.resolve(filePath);
  const resolvedBackup = path.resolve(backupPath);
  const beforeLink = verifyRegularFileBinding(binding, {
    filePath: resolvedPath,
    expectedLinks: 1,
  });
  if (beforeLink.status !== 'match') {
    return { ...beforeLink, backupCreated: false, backupVerified: false };
  }
  try {
    fs.linkSync(resolvedPath, resolvedBackup);
  } catch (error) {
    return {
      ...filesystemFailure(`${subject}-backup-link-failed`, error, {
        filePath: resolvedPath,
        backupPath: resolvedBackup,
      }),
      backupCreated: false,
      backupVerified: false,
    };
  }
  for (const linkedPath of [resolvedPath, resolvedBackup]) {
    const linked = verifyRegularFileBinding(binding, {
      filePath: linkedPath,
      expectedLinks: 2,
    });
    if (linked.status !== 'match') {
      return {
        status: 'recovery-required',
        reason: {
          code: `${subject}-backup-binding-mismatch`,
          filePath: resolvedPath,
          backupPath: resolvedBackup,
          linkedState: linked.reason,
        },
        recoveryDirectory: path.dirname(resolvedBackup),
        recoveryFile: resolvedBackup,
        target: resolvedPath,
        backupCreated: true,
        backupVerified: false,
      };
    }
  }
  const removed = quarantineRemoveRegularFileBinding(binding, resolvedPath, {
    subject,
    expectedLinks: 2,
  });
  if (removed.status !== 'removed') {
    return {
      ...removed,
      backupPath: resolvedBackup,
      backupCreated: true,
      backupVerified: true,
    };
  }
  const finalized = verifyRegularFileBinding(binding, {
    filePath: resolvedBackup,
    expectedLinks: 1,
  });
  if (finalized.status !== 'match') {
    return {
      status: 'recovery-required',
      reason: {
        code: `${subject}-backup-finalization-failed`,
        filePath: resolvedPath,
        backupPath: resolvedBackup,
        backupState: finalized.reason,
      },
      recoveryDirectory: path.dirname(resolvedBackup),
      recoveryFile: resolvedBackup,
      target: resolvedPath,
      backupCreated: true,
      backupVerified: false,
    };
  }
  return {
    status: 'backed-up',
    reason: {
      code: `${subject}-backed-up`,
      filePath: resolvedPath,
      backupPath: resolvedBackup,
    },
    backupPath: resolvedBackup,
    backupCreated: true,
    backupVerified: true,
  };
}

/**
 * Remove a hard-link name that this process just introduced while preserving
 * the source claimant. This is the rollback path when a staged pathname was
 * swapped after its expected binding was verified but before `linkSync` used
 * that pathname.
 */
export function quarantineRemoveLinkedRegularFileAlias(sourcePath, aliasPath, {
  subject = 'linked-claimant',
} = {}) {
  const source = path.resolve(sourcePath);
  const alias = path.resolve(aliasPath);
  const captured = captureRegularFileBinding(source, {
    subject,
    expectedLinks: 2,
  });
  if (captured.status !== 'captured') return captured;
  let result;
  let released;
  try {
    const aliasMatches = verifyRegularFileBinding(captured.binding, {
      filePath: alias,
      expectedLinks: 2,
    });
    if (aliasMatches.status !== 'match') {
      result = aliasMatches;
    } else {
      const removal = quarantineRemoveRegularFileBinding(captured.binding, alias, {
        subject,
        expectedLinks: 2,
      });
      if (removal.status !== 'removed') {
        result = removal;
      } else {
        const sourceRemains = verifyRegularFileBinding(captured.binding, {
          filePath: source,
          expectedLinks: 1,
        });
        result = sourceRemains.status === 'match' ? removal : sourceRemains;
      }
    }
  } finally {
    released = releaseRegularFileBinding(captured.binding);
  }
  if (released.status !== 'released') {
    return {
      ...released,
      removalStatus: result?.status,
      ...(result?.recoveryDirectory ? {
        recoveryDirectory: result.recoveryDirectory,
        recoveryFile: result.recoveryFile,
        target: result.target,
      } : {}),
    };
  }
  return result;
}

function removePublishedBindingName(binding, filePath, subject) {
  for (const expectedLinks of [2, 1]) {
    const matches = verifyRegularFileBinding(binding, { filePath, expectedLinks });
    if (matches.status === 'match') {
      return quarantineRemoveRegularFileBinding(binding, filePath, {
        subject,
        expectedLinks,
      });
    }
  }
  return relation('preserved', `${subject}-identity-changed`, { filePath });
}

function restorePublicationBackup(binding, backupPath, commitPath, subject) {
  const backupMatches = verifyRegularFileBinding(binding, {
    filePath: backupPath,
    expectedLinks: 1,
  });
  if (backupMatches.status !== 'match') return backupMatches;
  try {
    fs.linkSync(backupPath, commitPath);
  } catch (error) {
    return filesystemFailure(
      error?.code === 'EEXIST'
        ? `${subject}-restore-blocked`
        : `${subject}-restore-failed`,
      error,
      { backupPath, commitPath },
    );
  }
  for (const linkedPath of [backupPath, commitPath]) {
    const linked = verifyRegularFileBinding(binding, {
      filePath: linkedPath,
      expectedLinks: 2,
    });
    if (linked.status !== 'match') return linked;
  }
  const retired = quarantineRemoveRegularFileBinding(binding, backupPath, {
    subject: `${subject}-backup`,
    expectedLinks: 2,
  });
  if (retired.status !== 'removed') return retired;
  return verifyRegularFileBinding(binding, {
    filePath: commitPath,
    expectedLinks: 1,
  });
}

/**
 * Publish a captured candidate without ever replacing an unverified public
 * entry. Existing output is retained through a bound private backup; the new
 * name is created with a no-clobber hard link while the candidate descriptor
 * remains open. Both the staged and public names are then verified through
 * that descriptor before the staged name is retired via quarantine.
 * Replacing an existing entry is recoverable but not crash-atomic: the public
 * name is absent between retiring the verified previous name and linking the
 * candidate. Portable Node.js exposes no replacement compare-and-swap that
 * also preserves a late claimant.
 *
 * The caller owns `binding` and must release it after this function returns.
 */
export function publishRegularFileBinding(binding, candidatePath, snapshot, {
  subject = 'candidate',
} = {}) {
  const candidate = path.resolve(candidatePath);
  const commitPath = snapshot?.slot?.commitPath;
  if (typeof commitPath !== 'string') {
    return relation('unknown', `${subject}-publication-snapshot-unavailable`);
  }

  const beforePublish = verifyAtomicOutput(snapshot);
  if (beforePublish.status !== 'match') return beforePublish;
  const candidateMatches = verifyRegularFileBinding(binding, {
    filePath: candidate,
    expectedLinks: 1,
  });
  if (candidateMatches.status !== 'match') return candidateMatches;

  let previousBinding;
  let recoveryDirectory;
  let backupPath;
  let recoveryRecord;
  let previousBackedUp = false;
  const finishPrevious = () => {
    if (!previousBinding) return null;
    const released = releaseRegularFileBinding(previousBinding);
    previousBinding = undefined;
    return released.status === 'released' ? null : released;
  };
  const cleanupRecoveryDirectory = () => {
    if (!recoveryDirectory) return null;
    const cleanup = removeEmptyQuarantine(recoveryDirectory);
    if (!cleanup) recoveryDirectory = undefined;
    return cleanup;
  };
  const restorePrevious = () => {
    if (!previousBinding || !previousBackedUp) return null;
    return restorePublicationBackup(
      previousBinding,
      backupPath,
      commitPath,
      'previous-output',
    );
  };
  const rollback = (failure) => {
    let publicRemoval = removePublishedBindingName(
      binding,
      commitPath,
      `${subject}-publication`,
    );
    if (publicRemoval.status === 'preserved') {
      const claimantRemoval = quarantineRemoveLinkedRegularFileAlias(
        candidate,
        commitPath,
        { subject: `${subject}-publication-claimant` },
      );
      if (claimantRemoval.status === 'removed') publicRemoval = claimantRemoval;
    }
    const restored = restorePrevious();
    const recordCleanup = restored?.status === 'match'
      ? discardPublicationRecoveryRecord(recoveryRecord)
      : releasePublicationRecoveryRecord(recoveryRecord);
    recoveryRecord = undefined;
    const released = finishPrevious();
    const directoryCleanup = cleanupRecoveryDirectory();
    return {
      ...failure,
      ...(publicRemoval.status !== 'removed' && publicRemoval.status !== 'absent'
        ? { publicState: publicRemoval.reason } : {}),
      ...(restored && restored.status !== 'match' ? { restoreState: restored.reason } : {}),
      ...(recordCleanup ? { recoveryRecordState: recordCleanup.reason } : {}),
      ...(released ? { releaseState: released.reason } : {}),
      ...(directoryCleanup ? {
        recoveryDirectory: directoryCleanup.reason?.recoveryDirectory || recoveryDirectory,
      } : {}),
      ...((restored && restored.status !== 'match') || recordCleanup || directoryCleanup
        ? { recoveryFile: backupPath } : {}),
    };
  };

  if (snapshot.target.kind === 'file') {
    const previous = captureRegularFileBinding(commitPath, {
      subject: 'previous-output',
      expectedIdentity: {
        device: snapshot.target.device,
        inode: snapshot.target.inode,
      },
      expectedMode: snapshot.target.mode,
      expectedLinks: 1,
    });
    if (previous.status !== 'captured') return previous;
    previousBinding = previous.binding;
    const quarantine = createRemovalQuarantine(path.dirname(commitPath));
    if (quarantine.status !== 'created') {
      const released = finishPrevious();
      return released || quarantine;
    }
    recoveryDirectory = quarantine.directory;
    backupPath = path.join(recoveryDirectory, 'previous');
    const recovery = createPublicationRecoveryRecord(recoveryDirectory, snapshot, previous);
    if (recovery.status !== 'created') {
      const released = finishPrevious();
      const directoryCleanup = cleanupRecoveryDirectory();
      return {
        ...recovery,
        ...(recoveryDirectory ? { recoveryDirectory } : {}),
        ...(released ? { releaseState: released.reason } : {}),
        ...(directoryCleanup ? { directoryCleanupState: directoryCleanup.reason } : {}),
      };
    }
    recoveryRecord = recovery;
    const backup = backupPublicRegularFileBinding(
      previousBinding,
      commitPath,
      backupPath,
      { subject: 'previous-output' },
    );
    previousBackedUp = backup.status === 'backed-up';
    if (!previousBackedUp) {
      const recordCleanup = backup.backupCreated
        ? releasePublicationRecoveryRecord(recoveryRecord)
        : discardPublicationRecoveryRecord(recoveryRecord);
      recoveryRecord = undefined;
      const released = finishPrevious();
      const directoryCleanup = backup.backupCreated ? null : cleanupRecoveryDirectory();
      return {
        ...backup,
        ...(recordCleanup ? { recoveryRecordState: recordCleanup.reason } : {}),
        ...(released ? { releaseState: released.reason } : {}),
        ...(directoryCleanup ? { directoryCleanupState: directoryCleanup.reason } : {}),
      };
    }
  }

  try {
    fs.linkSync(candidate, commitPath);
  } catch (error) {
    return rollback(filesystemFailure(
      error?.code === 'EEXIST'
        ? 'target-created-during-commit'
        : `${subject}-publication-link-failed`,
      error,
      { candidatePath: candidate, commitPath },
    ));
  }

  const published = verifyRegularFileBinding(binding, {
    filePath: commitPath,
    expectedLinks: 2,
  });
  const staged = verifyRegularFileBinding(binding, {
    filePath: candidate,
    expectedLinks: 2,
  });
  if (published.status !== 'match' || staged.status !== 'match') {
    return rollback(relation('different', `${subject}-identity-changed`, {
      candidatePath: candidate,
      commitPath,
      publishedState: published.reason,
      stagedState: staged.reason,
    }));
  }

  const retired = quarantineRemoveRegularFileBinding(binding, candidate, {
    subject: `${subject}-staging`,
    expectedLinks: 2,
  });
  if (retired.status !== 'removed' && retired.status !== 'preserved') {
    return rollback(retired);
  }
  const final = verifyRegularFileBinding(binding, {
    filePath: commitPath,
    expectedLinks: 1,
  });
  if (final.status !== 'match') return rollback(final);

  let cleanupWarning = retired.status === 'preserved' ? retired : undefined;
  if (previousBinding) {
    const backupRemoval = quarantineRemoveRegularFileBinding(
      previousBinding,
      backupPath,
      { subject: 'previous-output-backup', expectedLinks: 1 },
    );
    if (backupRemoval.status !== 'removed') cleanupWarning = backupRemoval;
    const recordCleanup = backupRemoval.status === 'removed'
      ? discardPublicationRecoveryRecord(recoveryRecord)
      : releasePublicationRecoveryRecord(recoveryRecord);
    recoveryRecord = undefined;
    cleanupWarning ||= recordCleanup;
  }
  const released = finishPrevious();
  const directoryCleanup = cleanupRecoveryDirectory();
  cleanupWarning ||= released || directoryCleanup;
  const recoveryFile = cleanupWarning?.recoveryFile
    || (retired.status === 'preserved' ? candidate : undefined)
    || (recoveryDirectory ? backupPath : undefined);
  return {
    status: cleanupWarning ? 'committed-with-warning' : 'committed',
    reason: {
      code: `${subject}-published`,
      candidatePath: candidate,
      commitPath,
      ...(retired.status === 'preserved' ? { stagedSuccessorPreserved: true } : {}),
    },
    ...(cleanupWarning ? {
      cleanupState: cleanupWarning.reason,
      ...(recoveryDirectory ? { recoveryDirectory } : {}),
      ...(recoveryFile ? { recoveryFile } : {}),
    } : {}),
  };
}

/** Remove only the directory entry that still names a caller-owned inode. */
export function removeOwnedRegularFile(filePath, identity, { subject = 'candidate' } = {}) {
  const resolvedPath = path.resolve(filePath);
  let expectedLinks = 1;
  let captured = captureRegularFileBinding(resolvedPath, {
    subject,
    expectedIdentity: identity,
    expectedLinks,
  });
  const reportedLinks = Number(captured.reason?.links);
  if (captured.status === 'unsupported'
    && captured.reason?.code === `${subject}-hardlinked`
    && Number.isSafeInteger(reportedLinks)
    && reportedLinks > 1) {
    expectedLinks = reportedLinks;
    captured = captureRegularFileBinding(resolvedPath, {
      subject,
      expectedIdentity: identity,
      expectedLinks,
    });
  }
  if (captured.status !== 'captured') {
    if (captured.reason?.systemCode === 'ENOENT') {
      return relation('absent', `${subject}-already-absent`, { filePath: resolvedPath });
    }
    if (captured.status === 'different' || captured.status === 'unsupported') {
      return relation('preserved', `${subject}-identity-changed`, {
        filePath: resolvedPath,
        priorState: captured.reason,
      });
    }
    return captured;
  }

  let removal;
  let released;
  try {
    removal = quarantineRemoveRegularFileBinding(captured.binding, resolvedPath, {
      subject,
      expectedLinks,
    });
  } finally {
    released = releaseRegularFileBinding(captured.binding);
  }
  if (released.status !== 'released') {
    return {
      ...released,
      removalStatus: removal?.status,
      ...(removal?.recoveryDirectory ? {
        recoveryDirectory: removal.recoveryDirectory,
        recoveryFile: removal.recoveryFile,
        target: removal.target,
      } : {}),
    };
  }
  return removal;
}

function captureWriteSlot(requestedPath) {
  let commitPath;
  try {
    commitPath = canonicalFuturePath(requestedPath);
  } catch (error) {
    const diagnostic = error?.archifyDiagnostics?.[0];
    return relation('unknown', 'canonicalization-failed', {
      ...(diagnostic?.code ? { diagnosticCode: diagnostic.code } : {}),
      ...(diagnostic?.evidence?.relation ? { relation: diagnostic.evidence.relation } : {}),
    });
  }

  const parentPath = path.dirname(commitPath);
  let parent;
  try {
    parent = fs.statSync(parentPath, { bigint: true });
  } catch (error) {
    return filesystemFailure('parent-inspection-failed', error, { commitPath, parentPath });
  }
  if (!parent.isDirectory()) {
    return relation('unknown', 'parent-not-directory', { commitPath, parentPath });
  }
  if (parent.ino === 0n) {
    return relation('unknown', 'parent-identity-unavailable', { commitPath, parentPath });
  }
  return {
    status: 'captured',
    slot: {
      commitPath,
      parentPath,
      name: path.basename(commitPath),
      parentDevice: parent.dev,
      parentInode: parent.ino,
    },
  };
}

function captureTarget(commitPath) {
  let metadata;
  try {
    // The canonical commit path names the directory entry that rename will
    // replace. Never follow a link introduced after canonicalization.
    metadata = fs.lstatSync(commitPath, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { status: 'captured', target: { kind: 'absent' }, mode: null };
    }
    return filesystemFailure('target-inspection-failed', error, { commitPath });
  }

  const type = entryType(metadata);
  if (type !== 'file') {
    return relation('unsupported', 'target-not-regular-file', { commitPath, entryType: type });
  }
  const inspected = captureRegularFileHandle(commitPath, metadata, 'target');
  if (inspected.status !== 'captured') return inspected;
  metadata = inspected.metadata;
  return {
    status: 'captured',
    target: {
      kind: 'file',
      device: metadata.dev,
      inode: metadata.ino,
      mode: Number(metadata.mode & 0o777n),
    },
    mode: Number(metadata.mode & 0o777n),
  };
}

function captureRequestedEntry(requestedPath, policy) {
  let metadata;
  try {
    metadata = fs.lstatSync(requestedPath, { bigint: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { status: 'captured', entry: { kind: 'absent' } };
    }
    return filesystemFailure('requested-entry-inspection-failed', error, { requestedPath });
  }
  const type = entryType(metadata);
  if (policy === 'regular-or-absent' && type !== 'file') {
    return relation('unsupported', type === 'symbolic-link'
      ? 'requested-entry-symbolic-link'
      : 'requested-entry-not-regular-file', {
      requestedPath,
      entryType: type,
    });
  }
  if (metadata.ino === 0n) {
    return relation('unknown', 'requested-entry-identity-unavailable', { requestedPath });
  }
  if (policy === 'regular-or-absent') {
    const inspected = captureRegularFileHandle(requestedPath, metadata, 'requested-entry');
    if (inspected.status !== 'captured') return inspected;
    metadata = inspected.metadata;
  }
  return {
    status: 'captured',
    entry: {
      kind: 'existing',
      entryType: type,
      device: metadata.dev,
      inode: metadata.ino,
      // An unlinked symlink's inode can be reused immediately. Its target can
      // stay the same while the requested directory entry is a new object.
      // Reading the link only changes atime, so these no-follow timestamps
      // distinguish that replacement without tracking target-file writes.
      ...(type === 'symbolic-link' ? {
        changedAtNs: metadata.ctimeNs,
        createdAtNs: metadata.birthtimeNs,
      } : {}),
    },
  };
}

function requestedEntryMatches(left, right) {
  if (left.kind !== right.kind) return false;
  return left.kind === 'absent'
    || (left.entryType === right.entryType
      && left.device === right.device
      && left.inode === right.inode
      && (left.entryType !== 'symbolic-link'
        || (left.changedAtNs === right.changedAtNs
          && left.createdAtNs === right.createdAtNs)));
}

/**
 * Capture the physical directory-entry slot and target identity used by a
 * verified publication. Hard links are intentionally unsupported: replacing
 * one name cannot safely update its unknown sibling names.
 * `regular-or-absent` additionally rejects requested-entry symlinks and special
 * nodes for sidecars whose public name itself must never be followed.
 */
export function captureAtomicOutput(outputPath, { requestedEntryPolicy = 'followable-alias' } = {}) {
  if (!['followable-alias', 'regular-or-absent'].includes(requestedEntryPolicy)) {
    return relation('unknown', 'invalid-requested-entry-policy', { requestedEntryPolicy });
  }
  const requestedPath = path.resolve(outputPath);
  const requestedEntry = captureRequestedEntry(requestedPath, requestedEntryPolicy);
  if (requestedEntry.status !== 'captured') return requestedEntry;
  const slot = captureWriteSlot(requestedPath);
  if (slot.status !== 'captured') return slot;
  const target = captureTarget(slot.slot.commitPath);
  if (target.status !== 'captured') return target;
  const confirmedRequestedEntry = captureRequestedEntry(requestedPath, requestedEntryPolicy);
  if (confirmedRequestedEntry.status !== 'captured') return confirmedRequestedEntry;
  if (!requestedEntryMatches(confirmedRequestedEntry.entry, requestedEntry.entry)) {
    return relation('unknown', 'requested-entry-changed-during-inspection', { requestedPath });
  }
  return {
    status: 'captured',
    commitPath: slot.slot.commitPath,
    mode: target.mode,
    snapshot: {
      requestedPath,
      requestedEntryPolicy,
      requestedEntry: requestedEntry.entry,
      slot: slot.slot,
      target: target.target,
    },
  };
}

/** Re-resolve and verify the exact write slot plus its absent/file identity. */
export function verifyAtomicOutput(snapshot) {
  const currentRequestedEntry = captureRequestedEntry(
    snapshot.requestedPath,
    snapshot.requestedEntryPolicy || 'followable-alias',
  );
  if (currentRequestedEntry.status !== 'captured') return currentRequestedEntry;
  if (!requestedEntryMatches(currentRequestedEntry.entry, snapshot.requestedEntry)) {
    return relation('different', 'requested-entry-changed', {
      requestedPath: snapshot.requestedPath,
      previousKind: snapshot.requestedEntry.kind === 'absent'
        ? 'absent'
        : snapshot.requestedEntry.entryType,
      currentKind: currentRequestedEntry.entry.kind === 'absent'
        ? 'absent'
        : currentRequestedEntry.entry.entryType,
    });
  }
  const currentSlot = captureWriteSlot(snapshot.requestedPath);
  if (currentSlot.status !== 'captured') return currentSlot;
  const previousSlot = snapshot.slot;
  if (currentSlot.slot.parentDevice !== previousSlot.parentDevice
    || currentSlot.slot.parentInode !== previousSlot.parentInode
    || currentSlot.slot.name !== previousSlot.name) {
    return relation('different', 'write-slot-changed', {
      previousCommitPath: previousSlot.commitPath,
      currentCommitPath: currentSlot.slot.commitPath,
    });
  }

  const currentTarget = captureTarget(previousSlot.commitPath);
  if (currentTarget.status !== 'captured') return currentTarget;
  const previousTarget = snapshot.target;
  if (currentTarget.target.kind !== previousTarget.kind) {
    return relation('different', 'target-existence-changed', {
      commitPath: previousSlot.commitPath,
      previousKind: previousTarget.kind,
      currentKind: currentTarget.target.kind,
    });
  }
  if (previousTarget.kind === 'file'
    && (currentTarget.target.device !== previousTarget.device
      || currentTarget.target.inode !== previousTarget.inode)) {
    return relation('different', 'target-identity-changed', {
      commitPath: previousSlot.commitPath,
    });
  }
  if (previousTarget.kind === 'file'
    && currentTarget.target.mode !== previousTarget.mode) {
    return relation('different', 'target-mode-changed', {
      commitPath: previousSlot.commitPath,
      previousMode: previousTarget.mode,
      currentMode: currentTarget.target.mode,
    });
  }
  return relation('match', 'atomic-output-match', { commitPath: previousSlot.commitPath });
}

function parsePublicationRecoveryRecord(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.byteLength > publicationRecoveryRecordMaxBytes) {
    return relation('unknown', 'publication-recovery-record-too-large');
  }
  let parsed;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch (error) {
    return filesystemFailure('publication-recovery-record-invalid-json', error);
  }
  const backup = parsed?.backup;
  const recovery = parsed?.recovery;
  const target = parsed?.target;
  const requestedEntry = target?.requestedEntry;
  const validEntry = requestedEntry?.kind === 'absent'
    || (requestedEntry?.kind === 'existing'
      && typeof requestedEntry.entryType === 'string'
      && parseDecimal(requestedEntry.device) !== null
      && parseDecimal(requestedEntry.inode) !== null
      && (requestedEntry.entryType !== 'symbolic-link'
        || (parseDecimal(requestedEntry.changedAtNs) !== null
          && parseDecimal(requestedEntry.createdAtNs) !== null)));
  const valid = parsed?.version === publicationRecoveryRecordVersion
    && parsed?.kind === 'archify-retired-output-recovery'
    && backup?.name === 'previous'
    && typeof backup.sha256 === 'string' && /^[a-f\d]{64}$/i.test(backup.sha256)
    && parseSafeInteger(backup.bytes) !== null
    && Number.isSafeInteger(backup.mode) && backup.mode >= 0 && backup.mode <= 0o777
    && parseDecimal(backup.device) !== null && parseDecimal(backup.inode) !== null
    && typeof recovery?.name === 'string' && /^\.archify-remove-[a-f\d]{32}$/.test(recovery.name)
    && parseDecimal(recovery.device) !== null
    && parseDecimal(recovery.inode) !== null
    && typeof target?.requestedPath === 'string' && path.isAbsolute(target.requestedPath)
    && typeof target.requestedEntryPolicy === 'string'
    && ['followable-alias', 'regular-or-absent'].includes(target.requestedEntryPolicy)
    && validEntry
    && typeof target.commitPath === 'string' && path.isAbsolute(target.commitPath)
    && typeof target.parentPath === 'string' && path.isAbsolute(target.parentPath)
    // path-contract-allow: lexical-capability -- A record must exactly decompose the captured canonical target spelling.
    && typeof target.name === 'string' && target.name === path.basename(target.commitPath)
    // path-contract-allow: lexical-capability -- A record must exactly decompose the captured canonical target spelling.
    && target.parentPath === path.dirname(target.commitPath)
    && parseDecimal(target.parentDevice) !== null && parseDecimal(target.parentInode) !== null;
  if (!valid) return relation('unknown', 'publication-recovery-record-invalid');
  return {
    status: 'parsed',
    record: {
      backup: {
        ...backup,
        device: parseDecimal(backup.device),
        inode: parseDecimal(backup.inode),
      },
      recovery: {
        ...recovery,
        device: parseDecimal(recovery.device),
        inode: parseDecimal(recovery.inode),
      },
      target: {
        ...target,
        parentDevice: parseDecimal(target.parentDevice),
        parentInode: parseDecimal(target.parentInode),
        requestedEntry: requestedEntry.kind === 'absent' ? requestedEntry : {
          ...requestedEntry,
          device: parseDecimal(requestedEntry.device),
          inode: parseDecimal(requestedEntry.inode),
          ...(requestedEntry.entryType === 'symbolic-link' ? {
            changedAtNs: parseDecimal(requestedEntry.changedAtNs),
            createdAtNs: parseDecimal(requestedEntry.createdAtNs),
          } : {}),
        },
      },
    },
  };
}

function verifyPublicationRecoveryDirectory(directory, metadata, record) {
  let parentMetadata;
  try {
    parentMetadata = fs.statSync(path.dirname(directory), { bigint: true });
  } catch (error) {
    return filesystemFailure('publication-recovery-parent-inspection-failed', error, {
      recoveryDirectory: directory,
    });
  }
  // path-contract-allow: lexical-capability -- The generated private-directory component is an exact record-bound capability.
  if (path.basename(directory) !== record.recovery.name
    || !parentMetadata.isDirectory()
    || parentMetadata.dev !== record.target.parentDevice
    || parentMetadata.ino !== record.target.parentInode) {
    return relation('different', 'publication-recovery-directory-not-target-child', {
      recoveryDirectory: directory,
      expectedParentPath: record.target.parentPath,
    });
  }
  if (metadata.dev !== record.recovery.device || metadata.ino !== record.recovery.inode) {
    return relation('different', 'publication-recovery-directory-identity-changed', {
      recoveryDirectory: directory,
    });
  }
  return relation('match', 'publication-recovery-directory-match', {
    recoveryDirectory: directory,
  });
}

function verifyRetiredPublicationSlot(record) {
  const { target } = record;
  const slot = captureWriteSlot(target.requestedPath);
  if (slot.status !== 'captured') return slot;
  // path-contract-allow: lexical-capability -- The recaptured canonical commit spelling must exactly match the recorded capability.
  const commitPathChanged = slot.slot.commitPath !== target.commitPath;
  // path-contract-allow: lexical-capability -- The recaptured canonical parent spelling must exactly match the recorded capability.
  const parentPathChanged = slot.slot.parentPath !== target.parentPath;
  if (commitPathChanged
    || parentPathChanged
    || slot.slot.name !== target.name
    || slot.slot.parentDevice !== target.parentDevice
    || slot.slot.parentInode !== target.parentInode) {
    return relation('different', 'publication-recovery-slot-changed', {
      requestedPath: target.requestedPath,
      commitPath: target.commitPath,
    });
  }
  try {
    fs.lstatSync(target.commitPath, { bigint: true });
    return relation('preserved', 'publication-recovery-target-present', {
      commitPath: target.commitPath,
    });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return filesystemFailure('publication-recovery-target-inspection-failed', error, {
        commitPath: target.commitPath,
      });
    }
  }
  let requested;
  try {
    requested = fs.lstatSync(target.requestedPath, { bigint: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return filesystemFailure('publication-recovery-requested-entry-inspection-failed', error, {
        requestedPath: target.requestedPath,
      });
    }
  }
  if (target.requestedEntry.kind === 'existing'
    && target.requestedEntry.entryType === 'symbolic-link') {
    if (!requested?.isSymbolicLink()
      || requested.dev !== target.requestedEntry.device
      || requested.ino !== target.requestedEntry.inode
      || requested.ctimeNs !== target.requestedEntry.changedAtNs
      || requested.birthtimeNs !== target.requestedEntry.createdAtNs) {
      return relation('different', 'publication-recovery-requested-alias-changed', {
        requestedPath: target.requestedPath,
      });
    }
  } else if (requested) {
    return relation('different', 'publication-recovery-requested-entry-reclaimed', {
      requestedPath: target.requestedPath,
    });
  }
  return relation('match', 'publication-recovery-slot-match', {
    commitPath: target.commitPath,
  });
}

function releaseRecoveryBindings(result, recordBinding, backupBinding) {
  const failures = [];
  if (backupBinding) {
    const released = releaseRegularFileBinding(backupBinding);
    if (released.status !== 'released') failures.push(released.reason);
  }
  if (recordBinding) {
    const released = releaseRegularFileBinding(recordBinding);
    if (released.status !== 'released') failures.push(released.reason);
  }
  if (failures.length === 0) return result;
  return {
    ...result,
    status: 'recovery-required',
    releaseState: failures,
  };
}

/**
 * Explicitly restore one retired output after a process crash. This is not a
 * directory scanner: callers must name the private recovery directory they
 * intend to recover. A record is only a claim; the restored byte stream must
 * still match its recorded inode, mode, SHA-256 and size, the original parent
 * slot and aliases must still resolve identically, and the public name must be
 * absent. `linkSync` is deliberately no-clobber, so a later claimant wins.
 */
export function recoverRetiredPublication(recoveryDirectory) {
  const directory = path.resolve(recoveryDirectory);
  let directoryMetadata;
  try {
    directoryMetadata = fs.lstatSync(directory, { bigint: true });
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return relation('absent', 'publication-recovery-already-complete', { recoveryDirectory: directory });
    }
    return filesystemFailure('publication-recovery-directory-inspection-failed', error, {
      recoveryDirectory: directory,
    });
  }
  if (!directoryMetadata.isDirectory()) {
    return relation('unsupported', 'publication-recovery-directory-not-directory', {
      recoveryDirectory: directory,
      entryType: entryType(directoryMetadata),
    });
  }
  if (process.platform !== 'win32' && Number(directoryMetadata.mode & 0o077n) !== 0) {
    return relation('unsupported', 'publication-recovery-directory-not-private', {
      recoveryDirectory: directory,
    });
  }
  const recordPath = path.join(directory, publicationRecoveryRecordName);
  let recordMetadata;
  try {
    recordMetadata = fs.lstatSync(recordPath, { bigint: true });
  } catch (error) {
    return filesystemFailure('publication-recovery-record-inspection-failed', error, {
      recoveryDirectory: directory,
      recoveryFile: recordPath,
    });
  }
  if (!recordMetadata.isFile() || recordMetadata.nlink !== 1n
    || recordMetadata.size > BigInt(publicationRecoveryRecordMaxBytes)) {
    return relation('unsupported', 'publication-recovery-record-not-private-regular-file', {
      recoveryDirectory: directory,
      recoveryFile: recordPath,
    });
  }
  const capturedRecord = captureRegularFileBinding(recordPath, {
    subject: 'publication-recovery-record',
    expectedLinks: 1,
    includeContent: true,
  });
  if (capturedRecord.status !== 'captured') return capturedRecord;
  const parsed = parsePublicationRecoveryRecord(capturedRecord.content.buffer);
  if (parsed.status !== 'parsed') {
    return releaseRecoveryBindings(parsed, capturedRecord.binding);
  }
  const recoveryDirectoryState = verifyPublicationRecoveryDirectory(
    directory,
    directoryMetadata,
    parsed.record,
  );
  if (recoveryDirectoryState.status !== 'match') {
    return releaseRecoveryBindings({
      ...recoveryDirectoryState,
      recoveryDirectory: directory,
      recoveryFile: recordPath,
    }, capturedRecord.binding);
  }
  const slot = verifyRetiredPublicationSlot(parsed.record);
  if (slot.status !== 'match') {
    return releaseRecoveryBindings({
      ...slot,
      recoveryDirectory: directory,
      recoveryFile: recordPath,
    }, capturedRecord.binding);
  }
  const backupPath = path.join(directory, parsed.record.backup.name);
  const capturedBackup = captureRegularFileBinding(backupPath, {
    subject: 'publication-recovery-backup',
    expectedSha256: parsed.record.backup.sha256,
    expectedBytes: parsed.record.backup.bytes,
    expectedMode: parsed.record.backup.mode,
    expectedIdentity: {
      device: parsed.record.backup.device,
      inode: parsed.record.backup.inode,
    },
    expectedLinks: 1,
  });
  if (capturedBackup.status !== 'captured') {
    return releaseRecoveryBindings({
      ...capturedBackup,
      recoveryDirectory: directory,
      recoveryFile: backupPath,
    }, capturedRecord.binding);
  }
  // This second check narrows the remaining path-based link window. It cannot
  // make `linkSync` descriptor-bound, but it avoids linking after an ordinary
  // observed parent, alias, target, or backup change.
  const beforeLinkSlot = verifyRetiredPublicationSlot(parsed.record);
  const beforeLinkBackup = verifyRegularFileBinding(capturedBackup.binding, {
    filePath: backupPath,
    expectedLinks: 1,
  });
  if (beforeLinkSlot.status !== 'match' || beforeLinkBackup.status !== 'match') {
    return releaseRecoveryBindings({
      status: beforeLinkSlot.status === 'match' ? beforeLinkBackup.status : beforeLinkSlot.status,
      reason: {
        code: 'publication-recovery-pre-link-verification-failed',
        slotState: beforeLinkSlot.reason,
        backupState: beforeLinkBackup.reason,
      },
      recoveryDirectory: directory,
      recoveryFile: backupPath,
    }, capturedRecord.binding, capturedBackup.binding);
  }
  try {
    fs.linkSync(backupPath, parsed.record.target.commitPath);
  } catch (error) {
    return releaseRecoveryBindings(relation(
      error?.code === 'EEXIST' ? 'preserved' : 'unknown',
      error?.code === 'EEXIST'
        ? 'publication-recovery-target-created'
        : 'publication-recovery-link-failed',
      {
        recoveryDirectory: directory,
        recoveryFile: backupPath,
        commitPath: parsed.record.target.commitPath,
        ...(typeof error?.code === 'string' ? { systemCode: error.code } : {}),
      },
    ), capturedRecord.binding, capturedBackup.binding);
  }
  const publicState = verifyRegularFileBinding(capturedBackup.binding, {
    filePath: parsed.record.target.commitPath,
    expectedLinks: 2,
  });
  const backupState = verifyRegularFileBinding(capturedBackup.binding, {
    filePath: backupPath,
    expectedLinks: 2,
  });
  if (publicState.status !== 'match' || backupState.status !== 'match') {
    // We may have introduced an alias to a pathname that was swapped after the
    // pre-link checks. Remove only that alias when it is still a verified
    // two-link pair; otherwise preserve every uncertain name for inspection.
    const linkedAliasCleanup = quarantineRemoveLinkedRegularFileAlias(
      backupPath,
      parsed.record.target.commitPath,
      { subject: 'publication-recovery-unverified-link' },
    );
    return releaseRecoveryBindings(relation('recovery-required', 'publication-recovery-link-verification-failed', {
      recoveryDirectory: directory,
      recoveryFile: backupPath,
      commitPath: parsed.record.target.commitPath,
      publicState: publicState.reason,
      backupState: backupState.reason,
      linkedAliasCleanup: linkedAliasCleanup.reason,
    }), capturedRecord.binding, capturedBackup.binding);
  }
  const backupRemoval = quarantineRemoveRegularFileBinding(capturedBackup.binding, backupPath, {
    subject: 'publication-recovery-backup',
    expectedLinks: 2,
  });
  if (backupRemoval.status !== 'removed') {
    return releaseRecoveryBindings({
      ...backupRemoval,
      status: 'recovered-with-warning',
      recoveryDirectory: directory,
      recoveryFile: backupPath,
      target: parsed.record.target.commitPath,
    }, capturedRecord.binding, capturedBackup.binding);
  }
  const recordCleanup = discardPublicationRecoveryRecord({
    recordPath,
    binding: capturedRecord.binding,
  });
  const directoryCleanup = removeEmptyQuarantine(directory);
  const result = {
    status: recordCleanup || directoryCleanup ? 'recovered-with-warning' : 'recovered',
    reason: {
      code: 'publication-recovery-restored',
      recoveryDirectory: directory,
      commitPath: parsed.record.target.commitPath,
    },
    ...(recordCleanup ? { recoveryRecordState: recordCleanup.reason } : {}),
    ...(directoryCleanup ? { directoryCleanupState: directoryCleanup.reason } : {}),
  };
  return releaseRecoveryBindings(result, undefined, capturedBackup.binding);
}
