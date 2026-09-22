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

function deliveryProvenancePath(artifactPath) {
  const artifact = path.resolve(artifactPath);
  return `${artifact.replace(/\.html?$/i, '')}.delivery.json`;
}

function deliveryPendingPath(artifactPath) {
  return deliveryProvenancePath(artifactPath).replace(/\.json$/, '-pending.json');
}

function deliveryLockPath(artifactPath) {
  return deliveryProvenancePath(artifactPath).replace(/\.json$/, '-lock.json');
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
  const hasIdentity = (entry) => entry.ino !== 0 && entry.ino !== 0n;
  return hasIdentity(actual)
    && hasIdentity(expected)
    && actual.dev === expected.dev
    && actual.ino === expected.ino;
}

function assertDeliveryOwnership(ownership, operation, { allowInitializing = false, pending = 'ignore' } = {}) {
  const state = deliveryOwnershipState(ownership, operation);
  let lockEntry;
  try {
    lockEntry = fs.lstatSync(state.lockPath);
  } catch (error) {
    throw deliveryOwnershipFailure(state, operation, 'the owned lock entry can no longer be inspected', {
      ...(error?.code ? { systemCode: error.code } : {}),
    });
  }
  if (!lockEntry.isFile() || !sameFileIdentity(lockEntry, state.lockIdentity)) {
    throw deliveryOwnershipFailure(state, operation, 'the lock path no longer names the entry created by this attempt');
  }
  if (state.phase !== 'initializing' || !allowInitializing) {
    let lock;
    try {
      lock = JSON.parse(fs.readFileSync(state.lockPath, 'utf8'));
    } catch (error) {
      throw deliveryOwnershipFailure(state, operation, 'the owned lock receipt can no longer be verified', {
        ...(error?.code ? { systemCode: error.code } : {}),
      });
    }
    if (lock?.schemaVersion !== 1 || lock.receiptId !== state.receiptId || lock.pid !== state.pid) {
      throw deliveryOwnershipFailure(state, operation, 'the lock receipt no longer matches this attempt', {
        ...(typeof lock?.receiptId === 'string' ? { observedReceiptId: lock.receiptId } : {}),
      });
    }
  }
  if (pending !== 'ignore') {
    const pendingPath = deliveryPendingPath(state.output);
    let pendingEntry;
    try {
      pendingEntry = fs.lstatSync(pendingPath);
    } catch (error) {
      if (pending === 'absent' && error.code === 'ENOENT') return state;
      throw deliveryOwnershipFailure(state, operation, 'the owned delivery journal can no longer be inspected', {
        journal: pendingPath,
        ...(error?.code ? { systemCode: error.code } : {}),
      });
    }
    if (pending === 'absent') {
      throw deliveryOwnershipFailure(state, operation, 'the finalized delivery journal was recreated', { journal: pendingPath });
    }
    if (!state.pendingIdentity || !pendingEntry.isFile() || !sameFileIdentity(pendingEntry, state.pendingIdentity)) {
      throw deliveryOwnershipFailure(state, operation, 'the delivery journal no longer names the entry created by this attempt', {
        journal: pendingPath,
      });
    }
    if (pending === 'owned' || pending === 'identity') {
      let journalSource;
      try {
        journalSource = fs.readFileSync(pendingPath, 'utf8');
      } catch (error) {
        // An unreadable journal is a commit/finalization failure. The unchanged
        // lock and journal identities still permit a guarded rollback.
        if (pending === 'owned') throw error;
        return state;
      }
      let journal;
      try {
        journal = JSON.parse(journalSource);
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
  }
  return state;
}

function releaseDeliveryOwnership(ownership, { allowInitializing = false } = {}) {
  const current = deliveryOwnershipState(ownership, 'release the delivery lock');
  const pending = current.phase === 'finalized'
    ? 'absent'
    : current.pendingIdentity
      ? 'identity'
      : 'ignore';
  const state = assertDeliveryOwnership(ownership, 'release the delivery lock', { allowInitializing, pending });
  try {
    fs.unlinkSync(state.lockPath);
  } catch (cause) {
    if (cause.code === 'ENOENT') {
      throw deliveryOwnershipFailure(state, 'release the delivery lock', 'the owned lock disappeared before it could be removed', {
        systemCode: cause.code,
      });
    }
    const error = new Error(`Could not release delivery lock "${state.lockPath}": ${cause.message}`);
    error.code = cause.code;
    error.deliveryOwnershipCode = 'delivery/lock-release';
    error.deliveryOwnershipDetails = {
      operation: 'release the delivery lock',
      lock: state.lockPath,
      expectedReceiptId: state.receiptId,
      reason: cause.message,
    };
    throw error;
  }
  state.phase = 'released';
}

function acquireDeliveryLock(output, receiptId, inputPath, pathsAlias, recordInitializationFailure) {
  const lockPath = deliveryLockPath(output);
  try {
    const existingLock = fs.lstatSync(lockPath);
    if (!existingLock.isFile()) {
      throw Object.assign(new Error(`Unrecognized delivery lock at "${lockPath}"; inspect the existing entry before retrying.`), {
        deliveryLockCode: 'delivery/lock-invalid',
      });
    }
  } catch (error) {
    if (error.deliveryLockCode) throw error;
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') {
      throw Object.assign(new Error(`Unrecognized delivery lock at "${lockPath}"; inspect the existing entry before retrying.`), {
        deliveryLockCode: 'delivery/lock-invalid',
      });
    }
  }
  if (pathsAlias(lockPath, inputPath)) {
    throw Object.assign(new Error('Delivery lock path aliases the input specification; choose another output path.'), {
      deliveryLockCode: 'delivery/lock-path-conflict',
    });
  }
  let descriptor;
  let ownership;
  try {
    descriptor = fs.openSync(lockPath, 'wx', 0o600);
    const lockIdentity = fs.fstatSync(descriptor);
    ownership = Object.freeze({});
    deliveryOwnershipStates.set(ownership, {
      output: path.resolve(output),
      lockPath,
      receiptId,
      pid: process.pid,
      lockIdentity,
      phase: 'initializing',
    });
    fs.writeFileSync(descriptor, `${JSON.stringify({ schemaVersion: 1, receiptId, pid: process.pid })}\n`);
    deliveryOwnershipStates.get(ownership).phase = 'owned';
    fs.closeSync(descriptor);
    descriptor = undefined;
    return ownership;
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch (closeError) {
        error.lockCleanupError = closeError.message;
      }
    }
    if (ownership) {
      try {
        assertDeliveryOwnership(ownership, 'record a lock initialization failure', { allowInitializing: true });
        error.deliveryFailureRecord = recordInitializationFailure?.(error, ownership);
        releaseDeliveryOwnership(ownership, { allowInitializing: true });
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
      throw error;
    }
    if (error.code !== 'EEXIST') throw error;
    let lock;
    try {
      if (!fs.lstatSync(lockPath).isFile()) throw new Error('Not a regular lock file.');
      lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      if (lock?.schemaVersion !== 1 || !Number.isSafeInteger(lock.pid) || lock.pid <= 0
        || typeof lock.receiptId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(lock.receiptId)) {
        throw new Error('Unrecognized delivery lock.');
      }
    } catch {
      throw Object.assign(new Error(`Unrecognized delivery lock at "${lockPath}"; inspect the existing entry before retrying.`), {
        deliveryLockCode: 'delivery/lock-invalid',
      });
    }
    if (processIsRunning(lock.pid)) {
      throw Object.assign(new Error(`Another delivery attempt owns "${output}" through lock "${lockPath}".`), {
        deliveryLockCode: 'delivery/concurrent-attempt',
      });
    }
    throw Object.assign(new Error(`A stale delivery lock remains at "${lockPath}"; recover it serially before retrying.`), {
      deliveryLockCode: 'delivery/lock-stale',
      deliveryLockOwner: { pid: lock.pid, receiptId: lock.receiptId },
    });
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

function artifactIdentity(artifact) {
  return { sha256: createHash('sha256').update(artifact).digest('hex'), bytes: artifact.byteLength };
}

function beginDeliveryAttempt({ ownership, input, pathsAlias }) {
  const state = assertDeliveryOwnership(ownership, 'begin the delivery journal', { allowInitializing: true });
  const { output, receiptId } = state;
  const journal = deliveryPendingPath(output);
  for (const protectedPath of [input, output, deliveryProvenancePath(output)].filter(Boolean)) {
    if (pathsAlias(journal, protectedPath)) throw new Error('Delivery journal aliases an input or output.');
  }
  writeDeliveryProvenance(journal, {
    schemaVersion: 1, command: 'deliver', status: 'pending', receiptId,
    input, output: path.resolve(output),
  }, {
    beforeReplace: () => assertDeliveryOwnership(ownership, 'create the delivery journal', { allowInitializing: true }),
  });
  assertDeliveryOwnership(ownership, 'finish creating the delivery journal', { allowInitializing: true });
  let pendingIdentity;
  try {
    pendingIdentity = fs.lstatSync(journal);
  } catch (error) {
    throw deliveryOwnershipFailure(state, 'finish creating the delivery journal', 'the new journal identity cannot be captured', {
      journal,
      ...(error?.code ? { systemCode: error.code } : {}),
    });
  }
  let pending;
  try {
    pending = JSON.parse(fs.readFileSync(journal, 'utf8'));
  } catch (error) {
    throw deliveryOwnershipFailure(state, 'finish creating the delivery journal', 'the new journal cannot be verified', {
      journal,
      ...(error?.code ? { systemCode: error.code } : {}),
    });
  }
  if (!pendingIdentity.isFile() || pending.receiptId !== receiptId) {
    throw deliveryOwnershipFailure(state, 'finish creating the delivery journal', 'the new journal belongs to another attempt', {
      journal,
      ...(typeof pending?.receiptId === 'string' ? { observedReceiptId: pending.receiptId } : {}),
    });
  }
  assertDeliveryOwnership(ownership, 'finish creating the delivery journal', { allowInitializing: true });
  state.pendingIdentity = pendingIdentity;
}

function writeDeliveryProvenance(file, value, { beforeReplace } = {}) {
  const stagingDirectory = fs.mkdtempSync(path.join(path.dirname(file), '.archify-provenance-'));
  const temporary = path.join(stagingDirectory, path.basename(file));
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    beforeReplace?.();
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

function recordDeliveryFailure(options) {
  const {
    output, stage, input, error, receiptId, pathsAlias, ownership: suppliedOwnership,
    releaseOwnership: shouldReleaseSuppliedOwnership = false,
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
      );
      acquiredHere = true;
    } catch (lockError) {
      return {
        ...(lockError.deliveryFailureRecord || { ok: false, status: 'unrecorded' }),
        lockError,
      };
    }
  }
  const state = deliveryOwnershipStates.get(ownership);
  let recorded;
  // Keep independent evidence even when the artifact is unreadable or the
  // provenance target is locked, aliases the input, or cannot be replaced.
  let journalError;
  if (!state?.pendingIdentity) {
    try {
      beginDeliveryAttempt({ ownership, input, pathsAlias });
    } catch (cause) {
      if (cause.deliveryOwnershipCode === 'delivery/ownership-lost') {
        recorded = { ok: false, status: 'unrecorded', ownershipError: cause };
      }
      journalError = cause;
    }
  }
  if (!recorded) {
    let artifact;
    try {
      artifact = fs.readFileSync(output);
    } catch (readError) {
      if (readError.code === 'ENOENT' || readError.code === 'ENOTDIR') {
        recorded = { ok: true, status: 'absent' };
      }
      // A failed marker does not need an artifact hash to invalidate old evidence.
    }
    if (!recorded) {
      const provenancePath = deliveryProvenancePath(output);
      let aliasesProtectedPath;
      try {
        aliasesProtectedPath = (input && pathsAlias(provenancePath, input))
          || pathsAlias(provenancePath, output);
      } catch (aliasError) {
        recorded = {
          ok: false,
          status: 'unrecorded',
          diagnostic: diagnostic({
            code: 'delivery/provenance-path-resolution',
            message: 'Delivery failure provenance could not resolve its target safely.',
            subject: { output: path.resolve(output), provenance: provenancePath },
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
            subject: { output: path.resolve(output), provenance: provenancePath },
            evidence: { ...(input ? { input: path.resolve(input) } : {}) },
            supportedFixes: ['choose an output whose .delivery.json sidecar is distinct from every input and the HTML artifact'],
          }),
        };
      }
      if (!recorded) {
        try {
          writeDeliveryProvenance(provenancePath, {
            schemaVersion: 1,
            receiptId,
            status: 'failed',
            command: 'deliver',
            stage,
            input,
            output: path.resolve(output),
            ...(artifact ? { artifact: artifactIdentity(artifact) } : {}),
            error,
          }, {
            beforeReplace: () => assertDeliveryOwnership(ownership, 'record failed delivery provenance', {
              allowInitializing: true,
              pending: state?.pendingIdentity ? 'owned' : 'ignore',
            }),
          });
          recorded = { ok: true, status: 'failed' };
        } catch (writeError) {
          if (writeError.deliveryOwnershipCode === 'delivery/ownership-lost') {
            recorded = { ok: false, status: 'unrecorded', ownershipError: writeError };
          } else {
            recorded = {
              ok: false,
              status: 'unrecorded',
              diagnostic: diagnostic({
                code: 'delivery/provenance-write',
                message: 'The failed delivery could not persist its stale-artifact marker.',
                subject: { output: path.resolve(output), provenance: provenancePath },
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
  }
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

function inspectDeliveryProvenance(artifactPath, artifact, { requireProvenance = false } = {}) {
  const sidecar = deliveryProvenancePath(artifactPath);
  const pending = deliveryPendingPath(artifactPath);
  const lock = deliveryLockPath(artifactPath);
  try {
    if (pathEntryExists(pending)) {
      return {
        ok: false, status: 'failed',
        diagnostics: [diagnostic({
          code: 'delivery/provenance-failed',
          message: 'A delivery attempt is unfinished or failed; complete a successful deliver before trusting this artifact.',
          subject: { artifact: path.resolve(artifactPath), provenance: sidecar },
          evidence: { pendingJournal: pending, found: true },
          supportedFixes: ['finish any active delivery, then rerun deliver successfully; retain the pending journal until recovery succeeds'],
        })],
      };
    }
  } catch (error) {
    return invalidProvenance(artifactPath, pending, error.message);
  }
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
  let found;
  try {
    found = pathEntryExists(sidecar);
  } catch (error) {
    return invalidProvenance(artifactPath, sidecar, error.message);
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
  try {
    if (!fs.lstatSync(sidecar).isFile()) throw new Error('Delivery provenance must be a regular file, not a symbolic link or directory.');
    receipt = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
    const identityValid = (value) => value && typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sha256)
      && Number.isSafeInteger(value.bytes) && value.bytes >= 0;
    if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
      || receipt.schemaVersion !== 1 || receipt.command !== 'deliver'
      || typeof receipt.receiptId !== 'string'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receipt.receiptId)
      || typeof receipt.output !== 'string' || !path.isAbsolute(receipt.output) || path.resolve(receipt.output) !== path.resolve(artifactPath)
      || typeof receipt.input !== 'string' || !path.isAbsolute(receipt.input)
      || !['current', 'failed'].includes(receipt.status)
      || (receipt.status === 'current' && (!TYPES.has(receipt.type)
        || !identityValid(receipt.specification) || !identityValid(receipt.artifact)))
      || (receipt.status === 'failed' && typeof receipt.stage !== 'string')) {
      throw new Error('Delivery provenance does not conform to the supported receipt schema.');
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

function invalidProvenance(artifactPath, sidecar, reason) {
  return {
    ok: false, status: 'invalid',
    diagnostics: [diagnostic({
      code: 'delivery/provenance-invalid', message: 'Delivery provenance could not be verified.',
      subject: { artifact: artifactPath, provenance: sidecar }, evidence: { reason },
      supportedFixes: ['restore access to the delivery records, then rerun deliver successfully'],
    })],
  };
}

function usage() {
  return `Usage:
  archify render <type> <input.json> [output.html] [--quality standard|showcase] [--repo-root path]
  archify compare architecture <base.json> <head.json> [output.html] [--receipt path] [--json] [--quality standard|showcase] [--repo-root path]
  archify deliver <type> <input.json> [output.html] [--json] [--open] [--quality standard|showcase] [--repo-root path]
  archify finalize <type> <input.json> <output.html> [--json] [--receipt path] [--out-dir <dir>] [--quality standard|showcase] [--repo-root path] [--candidate-sha256 hex]
  archify preview <type> <input.json> [output.html] [--no-open] [--quality standard|showcase] [--repo-root path]
  archify validate <type> <input.json> [--json] [--layout-json] [--quality standard|showcase] [--repo-root path]
  archify migrate workflow <old.json> <new.json> --to-schema 2 [--json] [--repo-root path]
  archify inspect <type> <input.json>
  archify check <output.html> [--require-provenance]
  archify browser-check <output.html> [--json] [--require-provenance] [--out-dir <dir>]
  archify visual-check <output.html> [--json] [--require-provenance] [--out-dir <dir>]
  archify guide [scenario or question] [--json] [--lang en|zh]
  archify inspect-repo <repository-root> [--batch-size 1..100] [--batch number] [--snapshot file] [--json]
  archify brands [name, alias, domain, or category] [--json]
  archify brands capture <url> [--json]
  archify examples
  archify doctor
  archify demo [output-directory]

Types:
  architecture, workflow, sequence, dataflow, lifecycle
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
  return { rest, outDir: outDir ? path.resolve(outDir) : undefined };
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
  return diagnostic({
    code,
    message: code === 'delivery/lock-release'
      ? `Delivery lock could not be released for "${output}": ${error.message}`
      : code === 'delivery/ownership-lost'
        ? `Delivery ownership was lost for "${output}": ${error.message}`
        : `Could not start delivery for "${output}": ${error.message}`,
    subject: { output, lock: deliveryLockPath(output) },
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
          `remove only the preserved lock "${deliveryLockPath(output)}", then rerun deliver successfully`,
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
      supportedFixes: compositionFixes(issue),
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

function compositionFixes(issue) {
  if (issue.code === 'composition/viewport-height') return [String(issue.detail || '').replace(/^\[[^\]]+\]\s*/, '')];
  if (issue.code !== 'composition/desktop-readability') return COMPOSITION_FIXES[issue.code] || [];
  const sourceFontPx = Number(issue.sourceFontPx);
  const actualBudgetPx = Number(issue.availableDiagramWidth);
  const hardFloorPx = Number(issue.minimumProjectedFontPx);
  const viewBoxWidth = Number(issue.viewBoxWidth);
  const preserveIntent = 'Preserve the semantic text and any supplied coordinates, routes, sides, channels, and labels.';
  const readerCap = issue.budgetBasis === 'recognized-declared-wide'
    ? ` The declared Reader reports a ${issue.budgetLimit} limit and ${actualBudgetPx}px actual diagram budget; do not assume an uncapped viewport.`
    : '';
  if (![sourceFontPx, actualBudgetPx, hardFloorPx, viewBoxWidth].every(Number.isFinite)
    || actualBudgetPx <= 0 || hardFloorPx <= 0 || viewBoxWidth <= 0) {
    return [`${preserveIntent} Repair the measured source font, desktop budget, or complete viewBox width; position-only label controls do not change projected text size.`];
  }
  if (sourceFontPx < hardFloorPx) {
    return [`${preserveIntent} The diagnosed ${sourceFontPx}px source text is below the ${hardFloorPx}px hard floor even at scale 1, so use a renderer-supported semantic text-size setting or renderer-level fix. Position-only label controls cannot repair its projection.${readerCap}`];
  }
  const maximumViewBoxWidth = Math.floor((sourceFontPx * actualBudgetPx) / hardFloorPx);
  return [`${preserveIntent} Compactly reflow automatic spacing and empty corridors so the complete viewBox width is at most ${maximumViewBoxWidth}px (current ${viewBoxWidth}px; ${sourceFontPx}px source text at ${actualBudgetPx}px desktop budget). If supplied geometry fixes that width, use a renderer-supported semantic text-size setting or renderer-level fix instead. Position-only label controls cannot repair its projection.${readerCap}`];
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
  const extension = path.extname(outputPath);
  return extension ? `${outputPath.slice(0, -extension.length)}.receipt.json` : `${outputPath}.receipt.json`;
}

function compareCommitError(message, code, details = {}) {
  const error = new Error(message);
  error.compareStage = 'commit';
  error.compareCode = code;
  error.compareDetails = details;
  return error;
}

function commitComparePair({ htmlCandidate, receiptCandidate, outputPath, receiptPath, stagingDirectory }) {
  const targets = [
    { label: 'HTML artifact', target: outputPath, candidate: htmlCandidate, backup: path.join(stagingDirectory, '.previous-output') },
    { label: 'receipt', target: receiptPath, candidate: receiptCandidate, backup: path.join(stagingDirectory, '.previous-receipt') },
  ];

  // Preflight the whole pair before moving either trusted target. This avoids
  // replacing the HTML and only then discovering that its receipt destination
  // cannot be committed (for example, because it is a directory).
  for (const item of targets) {
    if (!fs.existsSync(item.target)) continue;
    const existing = fs.lstatSync(item.target);
    if (!existing.isFile()) {
      throw compareCommitError(
        `Could not commit Architecture Delta: existing ${item.label} target is not a regular file.`,
        'delta/commit-target',
        {
          target: path.basename(item.target),
          targetType: existing.isDirectory() ? 'directory' : 'non-file',
          supportedFixes: [`choose a regular-file path for the ${item.label}`],
        },
      );
    }
  }

  const backedUp = [];
  const committed = [];
  try {
    for (const item of targets) {
      if (!fs.existsSync(item.target)) continue;
      fs.renameSync(item.target, item.backup);
      backedUp.push(item);
    }
    for (const item of targets) {
      fs.renameSync(item.candidate, item.target);
      committed.push(item);
    }
  } catch (cause) {
    const rollbackErrors = [];
    const recoveryFiles = [];
    for (const item of [...committed].reverse()) {
      try {
        fs.rmSync(item.target, { force: true });
      } catch (error) {
        rollbackErrors.push(`${item.label}: remove failed (${error.message})`);
      }
    }
    for (const item of [...backedUp].reverse()) {
      try {
        if (fs.existsSync(item.target)) fs.rmSync(item.target, { force: true });
        fs.renameSync(item.backup, item.target);
      } catch (error) {
        rollbackErrors.push(`${item.label}: restore failed (${error.message})`);
        // Track failed restoration rather than probing existence: a permission
        // error must not make cleanup discard a potentially recoverable backup.
        recoveryFiles.push({ backup: item.backup, target: item.target });
      }
    }
    throw compareCommitError(
      (rollbackErrors.length
        ? 'Architecture Delta pair commit failed and its previous files could not be fully restored.'
        : 'Architecture Delta pair commit failed; the previous files were restored.')
        + (recoveryFiles.length ? ` Recovery directory retained at ${stagingDirectory}.` : ''),
      rollbackErrors.length ? 'delta/commit-rollback-failed' : 'delta/commit-failed',
      {
        reason: cause.message,
        ...(rollbackErrors.length ? { rollbackErrors } : {}),
        ...(recoveryFiles.length ? { recoveryDirectory: stagingDirectory, recoveryFiles } : {}),
        supportedFixes: recoveryFiles.length
          ? [
            ...recoveryFiles.map(({ backup, target }) => `resolve the filesystem error, inspect the current target, then restore ${JSON.stringify(backup)} to ${JSON.stringify(target)} before retrying`),
            'remove the recovery directory only after the previous files have been recovered and verified',
          ]
          : ['check that both output paths are writable regular files, then retry'],
      },
    );
  }
}

function commitDeliveryPair({ htmlCandidate, provenanceCandidate, outputPath, provenancePath, stagingDirectory, ownership }) {
  const targets = [
    { label: 'HTML artifact', target: outputPath, candidate: htmlCandidate, backup: path.join(stagingDirectory, '.previous-output') },
    { label: 'delivery provenance', target: provenancePath, candidate: provenanceCandidate, backup: path.join(stagingDirectory, '.previous-provenance') },
  ];
  assertDeliveryOwnership(ownership, 'start the delivery pair commit', { pending: 'owned' });
  for (const item of targets) {
    if (!fs.existsSync(item.target)) continue;
    const existing = fs.lstatSync(item.target);
    if (!existing.isFile()) {
      const error = new Error(`Existing ${item.label} target is not a regular file.`);
      error.deliveryCommitDetails = {
        target: item.target,
        targetType: existing.isDirectory() ? 'directory' : 'non-file',
      };
      throw error;
    }
  }

  const backedUp = [];
  const retainedBackups = new Set();
  const committed = [];
  try {
    for (const item of targets) {
      if (!fs.existsSync(item.target)) continue;
      assertDeliveryOwnership(ownership, `back up the ${item.label}`, { pending: 'owned' });
      fs.renameSync(item.target, item.backup);
      backedUp.push(item);
      retainedBackups.add(item);
    }
    for (const item of targets) {
      assertDeliveryOwnership(ownership, `commit the ${item.label}`, { pending: 'owned' });
      fs.renameSync(item.candidate, item.target);
      committed.push(item);
    }
    // Finalization is part of the commit: keep the old files recoverable until
    // the journal has been removed and checkers can accept the new artifact.
    const state = assertDeliveryOwnership(ownership, 'finalize the delivery journal', { pending: 'owned' });
    fs.unlinkSync(deliveryPendingPath(outputPath));
    assertDeliveryOwnership(ownership, 'finish finalizing the delivery journal', { pending: 'absent' });
    state.pendingIdentity = undefined;
    state.phase = 'finalized';
    return {
      recoverableBackups: [...retainedBackups].map((item) => ({ label: item.label, path: item.backup })),
    };
  } catch (cause) {
    const recoveryDetails = () => ({
      recoveryRequired: true,
      recoveryDirectory: stagingDirectory,
      recoverableBackups: [...retainedBackups].map((item) => ({ label: item.label, path: item.backup })),
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
          fs.rmSync(item.target, { force: true });
        } catch (error) {
          if (error.deliveryOwnershipCode === 'delivery/ownership-lost') throw error;
          rollbackErrors.push(`${item.label}: remove failed (${error.message})`);
        }
      }
      for (const item of [...backedUp].reverse()) {
        try {
          assertDeliveryOwnership(ownership, `restore the previous ${item.label}`, { pending: 'identity' });
          if (fs.existsSync(item.target)) fs.rmSync(item.target, { force: true });
          assertDeliveryOwnership(ownership, `restore the previous ${item.label}`, { pending: 'identity' });
          fs.renameSync(item.backup, item.target);
          retainedBackups.delete(item);
        } catch (error) {
          if (error.deliveryOwnershipCode === 'delivery/ownership-lost') throw error;
          rollbackErrors.push(`${item.label}: restore failed (${error.message})`);
          // A failed restoration leaves this exact backup at its source path.
          // Record it without probing the failing recovery path again.
          recoverableBackups.push({ label: item.label, path: item.backup });
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
        recoverableBackups,
      } : {}),
    };
    throw error;
  }
}

function renderValidatedArchitecture(inputPath, outputPath, quality, repoRoot) {
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
  const artifact = fs.readFileSync(outputPath);
  return {
    artifact,
    html: artifact.toString('utf8'),
    checks: JSON.parse(check.stdout),
    sourceEvidence: sourceEvidenceFromArtifact(artifact),
  };
}

async function commandCompare(args) {
  const { resolveOutputPath } = await import('../renderers/shared/output-path.mjs');
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
  const receiptTarget = options.receipt || compareReceiptPath(path.resolve(requestedOutput || 'architecture-delta.html'));
  let outputPath;
  try {
    ({ outputPath } = resolveOutputPath({
      requestedOutput,
      defaultOutput: 'architecture-delta.html',
      inputPaths: [basePath, headPath],
      otherOutputPaths: [path.resolve(receiptTarget)],
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
  let receiptPath;
  try {
    ({ outputPath: receiptPath } = resolveOutputPath({
      requestedOutput: options.receipt || compareReceiptPath(outputPath),
      defaultOutput: compareReceiptPath(outputPath),
      requiredExtension: '.json',
      inputPaths: [basePath, headPath],
      otherOutputPaths: [outputPath],
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
        supportedFixes: outputDiagnostic?.supportedFixes || ['choose a safe receipt path and retry'],
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

  const outputDirectory = path.dirname(outputPath);
  if (path.dirname(receiptPath) !== outputDirectory) {
    reportCompareFailure({ json: options.json, stage: 'prepare', error: 'The compare receipt must be written beside the HTML artifact.', code: 'delta/receipt-directory', details: { supportedFixes: ['choose a --receipt path in the same directory as output.html'] } });
    return;
  }
  try {
    fs.mkdirSync(outputDirectory, { recursive: true });
  } catch (error) {
    reportCompareFailure({ json: options.json, stage: 'prepare', error: `Could not create compare output directory: ${error.message}`, code: 'delta/output-directory', details: { reason: error.message } });
    return;
  }

  let stagingDirectory;
  try {
    stagingDirectory = fs.mkdtempSync(path.join(outputDirectory, '.archify-compare-'));
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

  try {
    let baseResult;
    let headResult;
    for (const { side, snapshotPath, buffer } of [
      { side: 'base', snapshotPath: rawBaseInput, buffer: baseBuffer },
      { side: 'head', snapshotPath: rawHeadInput, buffer: headBuffer },
    ]) {
      try {
        fs.writeFileSync(snapshotPath, buffer, { flag: 'wx' });
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
      renderValidatedArchitecture(rawBaseInput, rawBaseCandidate, qualityArgs.quality, repoArgs.repoRoot);
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
      renderValidatedArchitecture(rawHeadInput, rawHeadCandidate, qualityArgs.quality, repoArgs.repoRoot);
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
    fs.writeFileSync(canonicalBaseInput, JSON.stringify(canonicalArchitecture(base)));
    fs.writeFileSync(canonicalHeadInput, JSON.stringify(canonicalArchitecture(head)));
    baseResult = renderValidatedArchitecture(canonicalBaseInput, baseCandidate, qualityArgs.quality, repoArgs.repoRoot);
    headResult = renderValidatedArchitecture(canonicalHeadInput, headCandidate, qualityArgs.quality, repoArgs.repoRoot);

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
    const artifact = fs.readFileSync(htmlCandidate);
    const baseChecks = baseResult.checks.checks.filter((check) => check.ok).length;
    const headChecks = headResult.checks.checks.filter((check) => check.ok).length;
    const finalReceipt = {
      ...compareIr,
      artifact: { sha256: createHash('sha256').update(artifact).digest('hex'), bytes: artifact.byteLength },
      validation: {
        checksPassed: baseChecks + headChecks + deltaValidation.checksPassed,
        checkCount: baseResult.checks.checks.length + headResult.checks.checks.length + deltaValidation.checkCount,
        baseComposition: baseResult.checks.composition.status,
        headComposition: headResult.checks.composition.status,
      },
    };
    fs.writeFileSync(receiptCandidate, `${JSON.stringify(finalReceipt, null, 2)}\n`);

    try {
      const currentOutput = resolveOutputPath({
        requestedOutput,
        defaultOutput: 'architecture-delta.html',
        inputPaths: [basePath, headPath],
        otherOutputPaths: [receiptPath],
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

    commitComparePair({ htmlCandidate, receiptCandidate, outputPath, receiptPath, stagingDirectory });
    if (options.json) console.log(JSON.stringify(finalReceipt, null, 2));
    else {
      console.log(`compared architecture ${outputPath}`);
      console.log(`${finalReceipt.validation.checksPassed}/${finalReceipt.validation.checkCount} checks; completeness ${finalReceipt.completeness}; ${finalReceipt.proofLevel}; sha256 ${finalReceipt.artifact.sha256.slice(0, 12)}`);
      console.log(`receipt ${receiptPath}`);
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
      if (!preserveRecoveryDirectory) fs.rmSync(stagingDirectory, { recursive: true, force: true });
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
  const diagnostics = [
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

function engineeringProfileFromArtifact(artifact) {
  const match = artifact.toString('utf8').match(/<svg[^>]*\sdata-engineering-profile="([^"]+)"/);
  return match ? match[1] : null;
}

async function commandDeliver(args) {
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
  const renderer = rendererPath(type);
  const { pathsAlias, resolveOutputPath } = await import('../renderers/shared/output-path.mjs');
  const receiptId = randomUUID();
  let deliveryOwnership;
  let recoveryRequired = false;
  let stagingDirectory;
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

  const authoredOutput = typeof diagram?.meta?.output === 'string' && diagram.meta.output
    ? diagram.meta.output
    : undefined;
  let outputPath;
  let provenancePath;
  try {
    ({ outputPath } = resolveOutputPath({
      requestedOutput,
      authoredOutput,
      defaultOutput: `${type}.html`,
      inputPaths: [inputPath],
    }));
    ({ outputPath: provenancePath } = resolveOutputPath({
      requestedOutput: deliveryProvenancePath(outputPath),
      defaultOutput: deliveryProvenancePath(outputPath),
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
    if (outputPath) {
      reportDeliveryFailure(failure);
    } else {
      reportArtifactFailure({ ...failure, command: 'deliver', receiptId });
    }
    return;
  }
  const outputDirectory = path.dirname(outputPath);
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

  // Keep the candidate beside the target so the final rename is one
  // same-filesystem commit. A render or artifact-check failure never touches
  // an existing trusted output.
  try {
    stagingDirectory = fs.mkdtempSync(path.join(outputDirectory, '.archify-delivery-'));
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
        }),
      );
    } catch (error) {
      const message = `Could not start delivery for "${outputPath}": ${error.message}`;
      const recorded = error.deliveryFailureRecord;
      reportArtifactFailure({
        command: 'deliver', json, stage: 'prepare', type, input: inputPath, output: outputPath, receiptId,
        error: message,
        ...(recorded ? { provenance: recorded.status } : {}),
        diagnostics: [
          deliveryLockFailureDiagnostic(outputPath, error),
          ...(recorded?.diagnostic ? [recorded.diagnostic] : []),
        ],
      });
      return;
    }

    try {
      beginDeliveryAttempt({ ownership: deliveryOwnership, input: inputPath, pathsAlias });
    } catch (error) {
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
          subject: { output: outputPath, journal: deliveryPendingPath(outputPath) },
          evidence: { reason: error.message },
          supportedFixes: ['choose a writable output directory with a journal path distinct from the input'],
        })],
      });
      return;
    }

    try {
      fs.writeFileSync(specificationSnapshotPath, specification, { flag: 'wx' });
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
    };

    try {
      fs.writeFileSync(
        provenanceCandidatePath,
        `${JSON.stringify(deliverySuccessProvenance(receipt), null, 2)}\n`,
        { flag: 'wx' },
      );
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
      const currentOutputPath = resolveOutputPath({
        requestedOutput,
        authoredOutput,
        defaultOutput: `${type}.html`,
        inputPaths: [inputPath],
        otherOutputPaths: [provenancePath],
      }).outputPath;
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
        provenanceCandidate: provenanceCandidatePath,
        outputPath,
        provenancePath,
        stagingDirectory,
        ownership: deliveryOwnership,
      });
      commitRecoveryBackups = committed.recoverableBackups;
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
        diagnostics: [diagnostic({
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
        console.error(`Could not open the verified artifact (${receipt.open.status}). Open it manually: ${outputPath}`);
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
      console.error(`Recovery required: delivery backups were retained at "${stagingDirectory}".`);
    } else {
      try {
        fs.rmSync(stagingDirectory, { recursive: true, force: true });
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

function inspectArtifactDeliveryProvenance(artifactPath, requireProvenance) {
  let artifact;
  try {
    artifact = fs.readFileSync(artifactPath);
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
  return { ...inspectDeliveryProvenance(artifactPath, artifact, { requireProvenance }), artifact: artifactIdentity(artifact) };
}

function verifyDeliveryUnchanged(artifactPath, expected, checkedArtifact) {
  const current = inspectArtifactDeliveryProvenance(artifactPath, false);
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
    ...(['visual-check', 'browser-check'].includes(command) ? {
      evidenceKind: 'automated-browser',
      status: 'fail',
      visualReview: command === 'visual-check' ? 'pending' : 'not-requested',
    } : {}),
    provenance: provenance.status,
    ...(provenance.receiptId ? { deliveryReceiptId: provenance.receiptId } : {}),
    artifact: { path: artifactPath },
    error,
    ...(command === 'check' ? { file: artifactPath, diagnostic: error } : {}),
    diagnostics: provenance.diagnostics,
  };
}

function commandCheck(args) {
  const knownOptions = new Set(['--require-provenance']);
  const unknown = args.find((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknown) fail(`Unknown check option "${unknown}".`);
  const requireProvenance = args.includes('--require-provenance');
  const positional = args.filter((arg) => !knownOptions.has(arg));
  const [html] = positional;
  if (!html || positional.length !== 1) fail(usage());
  const artifactPath = path.resolve(html);
  const provenance = inspectArtifactDeliveryProvenance(artifactPath, requireProvenance);
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
    try {
      const receipt = JSON.parse(result.stdout);
      if (provenance) {
        const verified = verifyDeliveryUnchanged(artifactPath, provenance, receipt.artifact || {});
        if (!verified.ok) {
          console.log(JSON.stringify(provenanceFailureReceipt({ command: 'check', artifactPath, provenance: verified }), null, 2));
          process.exitCode = 1;
          return;
        }
        receipt.provenance = provenance.status;
        if (provenance.receiptId) receipt.deliveryReceiptId = provenance.receiptId;
      }
      console.log(JSON.stringify(receipt, null, 2));
    } catch {
      process.stdout.write(result.stdout);
    }
  }
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}

async function executeBrowserEvidence({
  artifactPath, outDir, requireProvenance, command, capture, ...browserOptions
}) {
  const provenance = inspectArtifactDeliveryProvenance(artifactPath, requireProvenance);
  let runEvidence;
  let persistFailure;
  try {
    const evidence = await import('./visual-check.mjs');
    runEvidence = command === 'browser-check' ? evidence.runBrowserCheck : evidence.runVisualCheck;
    persistFailure = command === 'browser-check'
      ? evidence.persistBrowserCheckFailure
      : evidence.persistVisualCheckFailure;
  } catch (error) {
    fail(`Could not load ${command}: ${error.message}`, 1);
  }
  if (provenance && !provenance.ok) {
    const receipt = persistFailure(artifactPath,
      provenanceFailureReceipt({ command, artifactPath, provenance }),
      { outDir });
    return { exitCode: 1, receipt, inputFailure: true };
  }

  let result;
  try {
    result = await runEvidence({
      ...browserOptions,
      artifactPath,
      outDir,
      ...(provenance ? { deliveryProvenance: provenance } : {}),
      verifyArtifact: (bytes) => {
        const verified = verifyDeliveryUnchanged(artifactPath, provenance, artifactIdentity(bytes));
        if (!verified.ok) {
          const error = new Error(verified.diagnostics[0].message);
          error.deliveryProvenance = verified;
          error.archifyDiagnostics = verified.diagnostics;
          throw error;
        }
      },
    });
  } catch (error) {
    const failure = persistFailure(artifactPath, {
        schemaVersion: 1,
        ok: false,
        command,
        evidenceKind: 'automated-browser',
        status: 'fail',
        visualReview: capture ? 'pending' : 'not-requested',
        ...(provenance ? {
          provenance: provenance.status,
          ...(provenance.receiptId ? { deliveryReceiptId: provenance.receiptId } : {}),
        } : {}),
        artifact: { path: artifactPath },
        error: error.message,
        diagnostics: [diagnostic({
          code: `viewer/${command}-input`,
          message: `${command} could not read a valid HTML input or prepare its evidence files.`,
          subject: { artifact: artifactPath },
          evidence: { reason: error.message, ...(error.code ? { systemCode: error.code } : {}) },
          supportedFixes: ['provide an existing readable .html artifact and a writable directory for evidence files'],
        })],
      }, { outDir });
    return { exitCode: 1, receipt: failure, inputFailure: true };
  }

  return result;
}

async function commandBrowserEvidence(rawArgs, { command, capture }) {
  const { rest: args, outDir } = extractOutDirArgs(rawArgs);
  const json = args.includes('--json');
  const requireProvenance = args.includes('--require-provenance');
  const knownOptions = new Set(['--json', '--require-provenance']);
  const unknown = args.filter((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknown.length) fail(`Unknown ${command} option "${unknown[0]}".`, 1);
  const positional = args.filter((arg) => !knownOptions.has(arg));
  if (positional.length !== 1) fail(usage(), 1);

  const artifactPath = path.resolve(positional[0]);
  const result = await executeBrowserEvidence({ artifactPath, outDir, requireProvenance, command, capture });

  if (result.inputFailure) {
    if (json) console.log(JSON.stringify(result.receipt, null, 2));
    else {
      console.error(formatDiagnostics(`automated browser evidence failed: ${result.receipt.error}`, result.receipt.diagnostics));
      console.error(capture ? 'perceptual visual review pending' : 'perceptual visual review not requested');
    }
    process.exitCode = result.exitCode;
    return;
  }

  if (json) {
    console.log(JSON.stringify(result.receipt, null, 2));
  } else {
    const sidecarDirectory = outDir || path.dirname(result.receipt.artifact.path);
    console.log(`automated browser evidence ${result.receipt.status}: ${result.receipt.artifact.path}`);
    console.log(`${command} containment ${result.receipt.containment.status}; captures ${result.receipt.captures.status}; perceptual visual review ${result.receipt.visualReview}`);
    console.log(`receipt ${path.join(sidecarDirectory, result.receipt.sidecars.receipt)}`);
    if (result.receipt.captures.contactSheet) {
      console.log(`contact sheet ${path.join(sidecarDirectory, result.receipt.captures.contactSheet)}`);
    }
    if (result.receipt.captures.contactSheetImage) {
      console.log(`review image ${path.join(sidecarDirectory, result.receipt.captures.contactSheetImage)}`);
    }
    if (result.receipt.error) console.error(result.receipt.error);
  }
  process.exitCode = result.exitCode;
}

async function commandVisualCheck(rawArgs) {
  return commandBrowserEvidence(rawArgs, { command: 'visual-check', capture: true });
}

async function commandBrowserCheck(rawArgs) {
  return commandBrowserEvidence(rawArgs, { command: 'browser-check', capture: false });
}

function extractFinalizeReceiptArgs(args) {
  const rest = [];
  let receiptPath;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--receipt') {
      receiptPath = args[index + 1];
      if (!receiptPath || receiptPath.startsWith('--')) rejectCliArgument('--receipt requires a JSON output path.', {
        code: 'cli/missing-option-value',
        subject: { option: '--receipt' },
        supportedFixes: ['provide one .json path after --receipt'],
      });
      index += 1;
      continue;
    }
    if (arg.startsWith('--receipt=')) {
      receiptPath = arg.slice('--receipt='.length);
      if (!receiptPath) rejectCliArgument('--receipt requires a JSON output path.', {
        code: 'cli/missing-option-value',
        subject: { option: '--receipt' },
        supportedFixes: ['provide one .json path after --receipt'],
      });
      continue;
    }
    rest.push(arg);
  }
  return { rest, receiptPath: receiptPath ? path.resolve(receiptPath) : undefined };
}

function extractCandidateSha256Args(args) {
  const rest = [];
  let candidateSha256;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--candidate-sha256') {
      candidateSha256 = args[index + 1];
      if (!candidateSha256 || candidateSha256.startsWith('--')) rejectCliArgument('--candidate-sha256 requires a SHA-256 digest.', {
        code: 'cli/missing-option-value',
        subject: { option: '--candidate-sha256' },
        supportedFixes: ['provide the candidate sha256 from the passing validate receipt'],
      });
      index += 1;
      continue;
    }
    if (arg.startsWith('--candidate-sha256=')) {
      candidateSha256 = arg.slice('--candidate-sha256='.length);
      if (!candidateSha256) rejectCliArgument('--candidate-sha256 requires a SHA-256 digest.', {
        code: 'cli/missing-option-value',
        subject: { option: '--candidate-sha256' },
        supportedFixes: ['provide the candidate sha256 from the passing validate receipt'],
      });
      continue;
    }
    rest.push(arg);
  }
  if (candidateSha256 !== undefined && !/^[0-9a-f]{64}$/.test(candidateSha256)) {
    rejectCliArgument('--candidate-sha256 must be 64 lowercase hexadecimal characters.', {
      code: 'cli/invalid-option-value',
      subject: { option: '--candidate-sha256' },
      evidence: { value: candidateSha256 },
      supportedFixes: ['copy candidate.sha256 from the passing validate receipt without modification'],
    });
  }
  return { rest, candidateSha256 };
}

async function commandFinalize(rawArgs) {
  const qualityArgs = extractQualityArgs(rawArgs);
  const repoArgs = extractRepoRootArgs(qualityArgs.rest);
  const outDirArgs = extractOutDirArgs(repoArgs.rest);
  const receiptArgs = extractFinalizeReceiptArgs(outDirArgs.rest);
  const candidateArgs = extractCandidateSha256Args(receiptArgs.rest);
  const json = candidateArgs.rest.includes('--json');
  const knownOptions = new Set(['--json']);
  const unknown = candidateArgs.rest.filter((arg) => arg.startsWith('--') && !knownOptions.has(arg));
  if (unknown.length) rejectCliArgument(`Unknown finalize option "${unknown[0]}".`, {
    code: 'cli/unknown-option',
    subject: { option: unknown[0] },
    supportedFixes: ['remove the unknown option and retry'],
  });
  const positional = candidateArgs.rest.filter((arg) => !knownOptions.has(arg));
  const [type, input, output] = positional;
  if (!type || !input || !output || positional.length !== 3) rejectCliArgument(usage(), {
    code: 'cli/usage',
    supportedFixes: ['use: archify finalize <type> <input.json> <output.html> [options]'],
  });
  rendererPath(type);
  if (!/\.html?$/i.test(output)) rejectCliArgument('finalize requires an .html output path.', {
    code: 'output/cli-extension',
    subject: { output: path.resolve(output) },
    supportedFixes: ['choose an output path ending in .html'],
  });
  if (receiptArgs.receiptPath && !/\.json$/i.test(receiptArgs.receiptPath)) {
    rejectCliArgument('The finalize receipt path must end in .json.', {
      code: 'output/cli-extension',
      subject: { receipt: receiptArgs.receiptPath },
      supportedFixes: ['choose a finalize receipt path ending in .json'],
    });
  }

  let runFinalize;
  try {
    ({ runFinalize } = await import('./finalize.mjs'));
  } catch (error) {
    fail(`Could not load finalize: ${error.message}`, 1);
  }

  let result;
  try {
    result = await runFinalize({
      cliPath: fileURLToPath(import.meta.url),
      type,
      input,
      output,
      quality: qualityArgs.quality || 'showcase',
      repoRoot: repoArgs.repoRoot,
      candidateSha256: candidateArgs.candidateSha256,
      outDir: outDirArgs.outDir,
      receiptPath: receiptArgs.receiptPath,
      runBrowserCheck: options => executeBrowserEvidence({
        ...options, command: 'browser-check', capture: false, requireProvenance: true,
      }),
    });
  } catch (error) {
    const failure = {
      schemaVersion: 1,
      ok: false,
      command: 'finalize',
      status: 'fail',
      type,
      quality: qualityArgs.quality || 'showcase',
      specification: { path: path.resolve(input) },
      artifact: { path: path.resolve(output) },
      gates: Object.fromEntries(['validate', 'deliver', 'check', 'browser-check'].map((stage) => [stage, 'not-run'])),
      diagnostics: [{
        code: error.finalizeCode || 'finalize/runtime',
        severity: 'error',
        message: error.message,
        ...(error.finalizeEvidence ? { evidence: error.finalizeEvidence } : {}),
      }],
      visualReview: 'not-requested',
    };
    if (json) console.log(JSON.stringify(failure));
    else console.error(formatDiagnostics('finalize could not start', failure.diagnostics));
    process.exitCode = 1;
    return;
  }

  if (json) {
    console.log(JSON.stringify(result.summary));
  } else {
    console.log(`finalize ${result.summary.status}: ${result.summary.artifact.path}`);
    console.log(`gates ${Object.entries(result.summary.gates).map(([stage, status]) => `${stage}:${status}`).join(' ')}`);
    console.log(`receipt ${result.summary.evidence.receipt}`);
    console.log(`perceptual visual review ${result.summary.visualReview}`);
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

  const finalizeRuntime = path.join(skillRoot, 'bin/finalize.mjs');
  checks.push({
    label: 'Finalize runtime',
    ok: fs.existsSync(finalizeRuntime),
    missing: fs.existsSync(finalizeRuntime) ? 0 : 1,
  });

  const outputPathRuntime = path.join(skillRoot, 'renderers/shared/output-path.mjs');
  checks.push({
    label: 'Output path safety runtime',
    ok: fs.existsSync(outputPathRuntime),
    missing: fs.existsSync(outputPathRuntime) ? 0 : 1,
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

function pruneExpiredInspectSnapshots() {
  const tempRoot = os.tmpdir();
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  let entries;
  try { entries = fs.readdirSync(tempRoot, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('archify-inspect-repo-')) continue;
    const directory = path.join(tempRoot, entry.name);
    try {
      if (fs.statSync(directory).mtimeMs < cutoff) fs.rmSync(directory, { recursive: true, force: true });
    } catch { /* A live or protected session is left alone. */ }
  }
}

async function commandInspectRepo(args) {
  let root;
  let batchSize = 20;
  let batch = 1;
  let snapshotFile;
  let json = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--batch-size' || arg === '--batch' || arg === '--snapshot') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        rejectCliArgument(`${arg} requires a value.`, {
          subject: { option: arg }, supportedFixes: [`provide a value after ${arg}`],
        });
      }
      if (arg === '--batch-size') batchSize = Number(value);
      else if (arg === '--batch') batch = Number(value);
      else snapshotFile = path.resolve(value);
      index += 1;
    } else if (arg === '--json') {
      json = true;
    } else if (arg.startsWith('--')) {
      rejectCliArgument(`Unknown inspect-repo option "${arg}".`, {
        subject: { option: arg },
        supportedFixes: ['use --batch-size, --batch, --snapshot, or --json'],
      });
    } else if (root === undefined) {
      root = arg;
    } else {
      rejectCliArgument('inspect-repo accepts exactly one repository root.', {
        evidence: { extraArgument: arg },
        supportedFixes: ['pass one repository root'],
      });
    }
  }
  if (!root) {
    rejectCliArgument('Usage: archify inspect-repo <repository-root> [--batch-size 1..100] [--batch number] [--snapshot file] [--json]');
  }
  const repositoryIndexPath = path.join(skillRoot, 'modules', 'repository-index', 'index.mjs');
  let repositoryIndex;
  try {
    repositoryIndex = await import(pathToFileURL(repositoryIndexPath).href);
  } catch (error) {
    rejectCliArgument(`Could not load the repository index: ${error.message}`, {
      code: 'repository-index/unavailable',
      supportedFixes: ['restore modules/repository-index/index.mjs and retry'],
    });
  }
  let result;
  let createdSnapshotDirectory;
  const inspectionStarted = process.hrtime.bigint();
  try {
    let snapshot;
    let snapshotReused = false;
    if (snapshotFile) {
      snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
      if (path.resolve(snapshot.root || '') !== path.resolve(root)) throw new Error('Repository snapshot root does not match the requested repository.');
      snapshotReused = true;
    } else {
      snapshot = repositoryIndex.createRepositorySnapshot(root);
      if (snapshot.repositoryState.reusable) {
        pruneExpiredInspectSnapshots();
        createdSnapshotDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-inspect-repo-'));
        snapshotFile = path.join(createdSnapshotDirectory, 'snapshot.json');
        fs.writeFileSync(snapshotFile, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
      }
    }
    result = repositoryIndex.buildRepositoryIndex(root, {
      batchSize, batch, snapshot, snapshotPath: snapshotFile, snapshotReused,
    });
    if (snapshot.repositoryState.reusable) repositoryIndex.assertRepositorySnapshotCurrent(snapshot);
    result.summary.durationMs = Number((process.hrtime.bigint() - inspectionStarted) / 1000000n);
    result.session = {
      reusable: Boolean(snapshotFile),
      reused: snapshotReused,
      ...(snapshotFile ? { snapshot: snapshotFile } : {}),
    };
  } catch (error) {
    if (createdSnapshotDirectory) fs.rmSync(createdSnapshotDirectory, { recursive: true, force: true });
    rejectCliArgument(`Could not inspect the repository: ${error.message}`, {
      code: 'repository-index/failed',
      subject: { root: path.resolve(root) },
      supportedFixes: ['use a readable repository directory and valid inspect-repo options'],
    });
  }
  console.log(json ? JSON.stringify(result, null, 2) : repositoryIndex.formatRepositoryIndex(result));
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
    if (arg.startsWith('--')) fail(`Unknown migrate option "${arg}".`);
    positional.push(arg);
  }
  return { positional, json, toSchema };
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
    fail('Usage: archify migrate workflow <old.json> <new.json> --to-schema 2 [--json] [--repo-root path]');
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
  // Unlike render/validate, migrate has no --quality override. Pin every stage
  // to the document's durable policy and scrub any ambient profile from the
  // staged renderer by passing this value explicitly.
  const activeQualityProfile = sourceDocument?.meta?.quality_profile || 'standard';

  const { pathsAlias } = await import('../renderers/shared/output-path.mjs');
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
    migration = migrateWorkflowDocument(sourceDocument);
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

  if (fs.existsSync(destinationPath) && !fs.lstatSync(destinationPath).isFile()) {
    reportMigrationFailure({
      ...migration,
      migrationDiagnostics: [...migration.migrationDiagnostics, diagnostic({
        code: 'migration/destination-type',
        message: 'Workflow migration destination must be a regular file path.',
        subject: { destination: destinationPath },
        supportedFixes: ['choose a destination path that is absent or names a regular file'],
      })],
    });
    return;
  }

  const destinationDirectory = path.dirname(destinationPath);
  let stagingDirectory;
  try {
    fs.mkdirSync(destinationDirectory, { recursive: true });
    stagingDirectory = fs.mkdtempSync(path.join(destinationDirectory, '.archify-migration-'));
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
  try {
    fs.writeFileSync(candidatePath, destinationBytes, { flag: 'wx' });
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

    fs.renameSync(candidatePath, destinationPath);
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
    try {
      fs.rmSync(stagingDirectory, { recursive: true, force: true });
    } catch (error) {
      console.error(`Warning: could not remove workflow migration staging directory "${stagingDirectory}": ${error.message}`);
    }
  }
}

function commandValidate(args) {
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
          const candidate = {
            path: path.resolve(input),
            ...artifactIdentity(fs.readFileSync(input)),
          };
          const resolvedQuality = quality || result.composition.profile || 'standard';
          console.log(JSON.stringify({
            schemaVersion: 1,
            ok: true,
            command: 'validate',
            type,
            input: candidate.path,
            candidate,
            candidateFrozen: true,
            nextAction: {
              command: 'finalize',
              arguments: [
                type,
                candidate.path,
                '<output.html>',
                '--quality',
                resolvedQuality,
                ...(repoRoot ? ['--repo-root', repoRoot] : []),
                '--candidate-sha256',
                candidate.sha256,
                '--json',
              ],
            },
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
    case 'finalize':
      await commandFinalize(args);
      break;
    case 'preview':
      await commandPreview(args);
      break;
    case 'validate':
      commandValidate(args);
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
      commandCheck(args);
      break;
    case 'visual-check':
      await commandVisualCheck(args);
      break;
    case 'browser-check':
      await commandBrowserCheck(args);
      break;
    case 'guide':
      await commandGuide(args);
      break;
    case 'inspect-repo':
      await commandInspectRepo(args);
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
  if (['validate', 'deliver', 'finalize'].includes(command) && args.includes('--json')) {
    reportArtifactArgumentFailure(command, error);
  } else {
    fail(error.message);
  }
}
