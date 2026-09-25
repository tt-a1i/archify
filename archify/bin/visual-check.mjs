import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DESKTOP_READABILITY_VIEWPORT,
  MIN_PROJECTED_NODE_TEXT_PX,
} from '../renderers/shared/desktop-readability.mjs';
import {
  backupPublicRegularFileBinding,
  captureAtomicOutput,
  captureRegularFileBinding,
  quarantineRemoveLinkedRegularFileAlias,
  quarantineRemoveRegularFileBinding,
  releaseRegularFileBinding,
  removeEmptyDirectoryWithRetry,
  verifyAtomicOutput,
  verifyRegularFileBinding,
} from '../renderers/shared/atomic-output.mjs';
import {
  sameEntry,
  sameLocation,
  sameParent,
  sidecarNamespaceComponentKey,
} from '../renderers/shared/path-semantics.mjs';
import {
  boundedSidecarStem,
  sidecarStemFromComponent,
} from '../renderers/shared/sidecar-path.mjs';

export const VISUAL_CHECK_VIEWPORTS = Object.freeze([
  DESKTOP_READABILITY_VIEWPORT,
  Object.freeze({ width: 1600, height: 1000 }),
  Object.freeze({ width: 1920, height: 1080 }),
  Object.freeze({ width: 2048, height: 1320 }),
]);

export const CAPTURE_VIEWPORTS = Object.freeze([
  VISUAL_CHECK_VIEWPORTS[0],
  VISUAL_CHECK_VIEWPORTS[VISUAL_CHECK_VIEWPORTS.length - 1],
]);
export const THEMES = Object.freeze(['light', 'dark']);
const EXIT = Object.freeze({ pass: 0, fail: 1, skipped: 2 });
export const CHROME_NO_SANDBOX_ENV = 'ARCHIFY_CHROME_NO_SANDBOX';
const VISUAL_SIDECAR_SUFFIXES = Object.freeze([
  '.visual-check.json',
  '.visual-check.html',
  ...CAPTURE_VIEWPORTS.flatMap(({ width, height }) => THEMES.map(
    (theme) => `.visual-check.${width}x${height}.${theme}.png`,
  )),
]);
const visualEvidenceOwnerships = new WeakSet();
export const CHROME_STARTUP_TIMEOUT_MS = 90000;

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function htmlEscape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function pathEntry(file) {
  try {
    return { exists: true, stat: fs.lstatSync(file) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false };
    return { exists: null, error };
  }
}

function visualEvidencePaths(outputs) {
  return outputs.capture === false ? [] : [outputs.contactSheet, ...outputs.screenshots.map((entry) => entry.path)];
}

function regularFileEvidence(file, { expectedLinks = 1 } = {}) {
  const captured = captureRegularFileBinding(file, {
    subject: 'evidence-file',
    expectedLinks,
  });
  if (captured.status !== 'captured') {
    const systemCode = captured.reason?.systemCode;
    return {
      ok: false,
      reason: systemCode === 'ENOENT'
        ? { code: 'missing-evidence-file' }
        : captured.reason?.code === 'evidence-file-not-regular-file'
          ? { code: 'evidence-path-not-regular-file' }
          : {
            code: 'evidence-file-unreadable',
            ...(systemCode ? { systemCode } : {}),
            ...(captured.reason?.code ? { bindingCode: captured.reason.code } : {}),
          },
    };
  }
  const released = releaseRegularFileBinding(captured.binding);
  if (released.status !== 'released') {
    return {
      ok: false,
      reason: {
        code: 'evidence-file-unreadable',
        ...(released.reason?.systemCode ? { systemCode: released.reason.systemCode } : {}),
        ...(released.reason?.code ? { bindingCode: released.reason.code } : {}),
      },
    };
  }
  return {
    ok: true,
    evidence: {
      file: path.basename(file),
      sha256: captured.content.sha256,
      bytes: captured.content.bytes,
    },
    identity: captured.identity,
  };
}

function readRegularFileContents(file, { subject = 'file' } = {}) {
  const captured = captureRegularFileBinding(file, {
    subject,
    expectedLinks: 1,
    includeContent: true,
  });
  if (captured.status !== 'captured') return { ok: false, reason: captured.reason };
  const released = releaseRegularFileBinding(captured.binding);
  if (released.status !== 'released') return { ok: false, reason: released.reason };
  return {
    ok: true,
    bytes: captured.content.buffer,
    evidence: {
      sha256: captured.content.sha256,
      bytes: captured.content.bytes,
    },
    identity: captured.identity,
  };
}

function regularFileCaptureError(label, captured) {
  const reason = captured?.reason || { code: 'regular-file-capture-failed' };
  const error = new Error(`${label} could not be read safely (${reason.code}).`);
  if (reason.systemCode) error.code = reason.systemCode;
  error.evidenceReason = reason;
  return error;
}

function screenshotKey(width, height, theme) {
  return `${width}x${height}:${theme}`;
}

function resolvedSidecarNamespace(artifact, component) {
  const namespace = sidecarNamespaceComponentKey(path.dirname(artifact), component);
  if (namespace.status === 'resolved') return namespace;
  const error = new Error(
    `Could not establish a stable sidecar namespace (${namespace.reason?.code || 'unknown'}).`,
  );
  error.code = 'ARCHIFY_SIDECAR_NAMESPACE_INDETERMINATE';
  error.sidecarNamespaceReason = namespace.reason;
  throw error;
}

function portableSidecarComponentKey(component) {
  return component
    .normalize('NFC')
    .toLocaleUpperCase('en-US')
    .toLocaleLowerCase('en-US')
    .normalize('NFC');
}

function targetSidecarNamespace(directory, component) {
  const namespace = sidecarNamespaceComponentKey(directory, component);
  if (namespace.status === 'resolved') return namespace.componentKey;
  if (namespace.reason?.code === 'sidecar-directory-missing') {
    // A pure path calculation must not create --out-dir. Use the portable
    // collision envelope until the directory exists and can be probed.
    return portableSidecarComponentKey(component);
  }
  const error = new Error(
    `Could not establish target sidecar semantics (${namespace.reason?.code || 'unknown'}).`,
  );
  error.code = 'ARCHIFY_SIDECAR_NAMESPACE_INDETERMINATE';
  error.sidecarNamespaceReason = namespace.reason;
  throw error;
}

function evidenceSidecarPaths(artifactPath, { outDir, command = 'visual-check', capture = true } = {}) {
  let artifact = path.resolve(artifactPath);
  try {
    // Existing aliases, including Windows 8.3 spellings, must share the
    // physical artifact's evidence namespace even when the stem is short.
    artifact = fs.realpathSync.native(artifact);
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR', 'ENAMETOOLONG'].includes(error?.code)) throw error;
    // Missing artifacts still need deterministic failure sidecar paths.
  }
  const namespace = resolvedSidecarNamespace(artifact, path.basename(artifact));
  artifact = path.join(namespace.directoryPath, path.basename(artifact));
  const namespaceStem = sidecarStemFromComponent(namespace.componentKey);
  const directory = outDir ? path.resolve(outDir) : path.dirname(artifact);
  const targetComponentKey = outDir
    ? targetSidecarNamespace(directory, namespace.componentKey)
    : namespace.componentKey;
  const portableTargetKey = outDir
    ? portableSidecarComponentKey(namespace.componentKey)
    : namespace.componentKey;
  const targetAliasesSourceSpelling = targetComponentKey !== namespace.componentKey
    || portableTargetKey !== namespace.componentKey;
  const stem = boundedSidecarStem(
    namespaceStem.stem,
    capture ? VISUAL_SIDECAR_SUFFIXES : ['.browser-check.json'],
    targetAliasesSourceSpelling ? {
      force: true,
      hashDomain: `${command}-artifact\0${artifact}\0target-component\0${portableTargetKey}`,
    } : namespaceStem.options,
  );
  const base = path.join(directory, `${stem}.${command}`);
  const screenshots = (capture ? CAPTURE_VIEWPORTS : []).flatMap(({ width, height }) => THEMES.map((theme) => ({
    width,
    height,
    theme,
    path: `${base}.${width}x${height}.${theme}.png`,
  })));
  return {
    base, command, capture,
    receipt: `${base}.json`,
    contactSheet: `${base}.html`,
    screenshots,
  };
}

export function sidecarPaths(artifactPath, options = {}) {
  return evidenceSidecarPaths(artifactPath, options);
}

export function browserCheckSidecarPaths(artifactPath, options = {}) {
  return evidenceSidecarPaths(artifactPath, { ...options, command: 'browser-check', capture: false });
}

function evidencePathConflict(artifactPath, outputs, file, reason) {
  const target = file || outputs.receipt;
  const error = `${outputs.command} will not replace the existing unowned evidence path "${target}".`;
  return {
    ok: false,
    error,
    diagnostic: failureDiagnostic({
      code: 'viewer/evidence-path-conflict',
      message: error,
      subject: { artifact: path.resolve(artifactPath), evidencePath: target },
      evidence: { reason },
      supportedFixes: [
        `move the conflicting file aside, or choose a separate --out-dir, then rerun ${outputs.command}`,
      ],
    }),
  };
}

function visualEvidenceOwnershipMatches(ownership, artifactPath, outputs) {
  return visualEvidenceOwnerships.has(ownership)
    && ownership.active
    && sameEntry(ownership.artifact, artifactPath).status === 'match'
    && sameLocation(ownership.receipt, outputs.receipt).status === 'match';
}

function visualEvidenceTargets(outputs) {
  return [
    { kind: 'receipt', path: outputs.receipt },
    ...(outputs.capture === false ? [] : [{ kind: 'contact-sheet', path: outputs.contactSheet }]),
    ...outputs.screenshots.map((entry, index) => ({
      kind: 'screenshot',
      index,
      path: entry.path,
    })),
  ];
}

function evidenceWriteFailure(artifactPath, message, errors) {
  return {
    ok: false,
    error: message,
    diagnostic: failureDiagnostic({
      code: 'viewer/evidence-write',
      message,
      subject: { artifact: path.resolve(artifactPath) },
      evidence: { errors },
      supportedFixes: ['restore write access to the evidence directory and rerun visual-check'],
    }),
  };
}

function fileIdentity(stat) {
  return {
    device: stat.dev,
    inode: stat.ino,
    mode: Number(stat.mode & 0o777n),
    links: stat.nlink,
  };
}

function identityMatches(stat, identity, { directory = false } = {}) {
  return stat.dev === identity.device
    && stat.ino === identity.inode
    && Number(stat.mode & 0o777n) === identity.mode
    && (directory ? stat.isDirectory() : stat.isFile())
    && !stat.isSymbolicLink();
}

function evidenceIdentityMatches(actual, expected, expectedLinks = expected?.links ?? 1) {
  return actual?.device === expected?.device
    && actual?.inode === expected?.inode
    && actual?.mode === expected?.mode
    && BigInt(actual?.links ?? 0) === BigInt(expectedLinks);
}

function stagedOutputs(outputs, stagingDirectory) {
  return {
    receipt: path.join(stagingDirectory, 'receipt.json'),
    contactSheet: path.join(stagingDirectory, 'contact-sheet.html'),
    screenshots: outputs.screenshots.map((entry, index) => ({
      ...entry,
      path: path.join(stagingDirectory, `capture-${index}.png`),
    })),
  };
}

function stagedPathFor(ownership, finalPath) {
  return ownership.stagingPaths.get(finalPath);
}

function registerStagedEvidence(ownership, finalPath) {
  const stagedPath = stagedPathFor(ownership, finalPath);
  let stat;
  try {
    stat = fs.lstatSync(stagedPath, { bigint: true });
  } catch (error) {
    throw new Error(`visual-check could not inspect staged evidence "${stagedPath}": ${error.message}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.ino === 0n) {
    throw new Error(`visual-check staged evidence is not a uniquely owned regular file: "${stagedPath}".`);
  }
  if (stat.nlink !== 1n) {
    ownership.stagedEntries.set(finalPath, {
      path: stagedPath,
      identity: fileIdentity(stat),
    });
    throw new Error(`visual-check staged evidence has an external hard link: "${stagedPath}".`);
  }
  const targetMode = ownership.targets.get(finalPath)?.mode;
  if (targetMode !== null && targetMode !== undefined
    && Number(stat.mode & 0o777n) !== targetMode) {
    fs.chmodSync(stagedPath, targetMode);
    const adjusted = fs.lstatSync(stagedPath, { bigint: true });
    if (adjusted.dev !== stat.dev || adjusted.ino !== stat.ino || !adjusted.isFile()) {
      throw new Error(`visual-check staged evidence changed while preserving its mode: "${stagedPath}".`);
    }
    stat = adjusted;
  }
  const entry = {
    path: stagedPath,
    identity: fileIdentity(stat),
  };
  ownership.stagedEntries.set(finalPath, entry);
  const evidence = regularFileEvidence(stagedPath);
  if (!evidence.ok || !evidenceIdentityMatches(evidence.identity, entry.identity)) {
    throw new Error(`visual-check could not bind staged evidence "${stagedPath}" to its contents.`);
  }
  entry.evidence = {
    sha256: evidence.evidence.sha256,
    bytes: evidence.evidence.bytes,
  };
}

function writeStagedEvidence(ownership, finalPath, contents) {
  const stagedPath = stagedPathFor(ownership, finalPath);
  const target = ownership.targets.get(finalPath);
  const mode = target?.mode ?? 0o666;
  let descriptor;
  try {
    descriptor = fs.openSync(stagedPath, 'wx', mode);
    let stat = fs.fstatSync(descriptor, { bigint: true });
    if (!stat.isFile() || stat.ino === 0n) {
      throw new Error('the newly created staging entry has no unique regular-file identity');
    }
    if (target?.mode !== null && target?.mode !== undefined
      && Number(stat.mode & 0o777n) !== target.mode) {
      fs.fchmodSync(descriptor, target.mode);
      const adjusted = fs.fstatSync(descriptor, { bigint: true });
      if (adjusted.dev !== stat.dev || adjusted.ino !== stat.ino || !adjusted.isFile()
        || Number(adjusted.mode & 0o777n) !== target.mode) {
        throw new Error('the staged evidence mode could not be preserved');
      }
      stat = adjusted;
    }
    const entry = {
      path: stagedPath,
      identity: fileIdentity(stat),
    };
    ownership.stagedEntries.set(finalPath, entry);
    if (stat.nlink !== 1n) {
      throw new Error('the newly created staging entry has an external hard link');
    }
    fs.writeFileSync(descriptor, contents);
    const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
    entry.evidence = { sha256: sha256(bytes), bytes: bytes.byteLength };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function unlinkOwnedEntry(file, identity, {
  evidence,
  expectedLinks,
} = {}) {
  const verifiedLinks = Number(expectedLinks ?? identity.links ?? 1);
  let captured = captureRegularFileBinding(file, {
    subject: 'visual-cleanup',
    expectedIdentity: identity,
    expectedMode: identity.mode,
    expectedLinks: verifiedLinks,
    ...(evidence ? {
      expectedSha256: evidence.sha256,
      expectedBytes: evidence.bytes,
    } : {}),
  });
  const reportedLinks = Number(captured.reason?.links);
  if (captured.status === 'unsupported'
    && captured.reason?.code === 'visual-cleanup-hardlinked'
    && Number.isSafeInteger(reportedLinks)
    && reportedLinks > verifiedLinks) {
    captured = captureRegularFileBinding(file, {
      subject: 'visual-cleanup',
      expectedIdentity: identity,
      expectedMode: identity.mode,
      expectedLinks: reportedLinks,
      ...(evidence ? {
        expectedSha256: evidence.sha256,
        expectedBytes: evidence.bytes,
      } : {}),
    });
  }
  if (captured.status !== 'captured') {
    if (captured.reason?.systemCode === 'ENOENT') return { status: 'absent' };
    return {
      status: captured.status === 'different' || captured.status === 'unsupported'
        ? 'different'
        : 'unknown',
      reason: captured.reason?.code?.includes('content-changed') ? 'content' : 'identity',
      error: new Error(captured.reason?.code || 'visual cleanup binding failed'),
      bindingState: captured.reason,
    };
  }
  let removal;
  let released;
  try {
    removal = quarantineRemoveRegularFileBinding(captured.binding, file, {
      subject: 'visual-cleanup',
      expectedLinks: captured.identity?.links ? Number(captured.identity.links) : verifiedLinks,
    });
  } finally {
    released = releaseRegularFileBinding(captured.binding);
  }
  if (released.status !== 'released') {
    return {
      status: 'unknown',
      reason: 'identity',
      error: new Error(released.reason?.code || 'visual cleanup binding release failed'),
      bindingState: released.reason,
    };
  }
  if (removal.status === 'removed' || removal.status === 'absent') return removal;
  return {
    status: removal.status === 'preserved' || removal.status === 'different'
      || removal.status === 'unsupported' ? 'different' : 'unknown',
    reason: 'identity',
    error: new Error(removal.reason?.code || 'visual cleanup quarantine failed'),
    bindingState: removal.reason,
    ...(removal.recoveryDirectory ? {
      recoveryDirectory: removal.recoveryDirectory,
      recoveryFile: removal.recoveryFile,
    } : {}),
  };
}

function backupOwnedPublishedEntry(file, backupPath, identity, evidence) {
  const captured = captureRegularFileBinding(file, {
    subject: 'previous-evidence',
    expectedIdentity: identity,
    expectedMode: identity.mode,
    expectedSha256: evidence.sha256,
    expectedBytes: evidence.bytes,
    expectedLinks: 1,
  });
  if (captured.status !== 'captured') {
    return { ...captured, backupCreated: false, backupVerified: false };
  }
  let backup;
  let released;
  try {
    backup = backupPublicRegularFileBinding(captured.binding, file, backupPath, {
      subject: 'previous-evidence',
    });
  } finally {
    released = releaseRegularFileBinding(captured.binding);
  }
  if (released.status !== 'released') {
    return {
      status: 'recovery-required',
      reason: {
        code: 'previous-evidence-binding-release-failed',
        bindingState: released.reason,
      },
      recoveryDirectory: backup?.recoveryDirectory || path.dirname(backupPath),
      recoveryFile: backup?.recoveryFile || (backup?.backupCreated ? backupPath : undefined),
      target: backup?.target || file,
      backupCreated: backup?.backupCreated === true,
      backupVerified: backup?.backupVerified === true,
    };
  }
  return backup;
}

function publishedRemovalError(file, result) {
  const code = result.reason?.code;
  let reason;
  if (result.status === 'preserved') {
    reason = 'published entry changed during retirement; its successor was restored and preserved';
  } else if (result.status === 'recovery-required') {
    reason = 'published entry changed during retirement; recovery material was preserved';
  } else if (code?.includes('content-changed')) {
    reason = 'published entry content changed; it was preserved';
  } else if (code?.includes('mode-changed')) {
    reason = 'published entry mode changed; it was preserved';
  } else if (result.status === 'different' || result.status === 'unsupported') {
    reason = 'published entry identity changed; it was preserved';
  } else {
    reason = code || 'published entry could not be safely retired; it was preserved';
  }
  return {
    file,
    reason,
    ...(code ? { code } : {}),
    ...(result.recoveryDirectory ? { recoveryDirectory: result.recoveryDirectory } : {}),
    ...(result.recoveryFile ? { recoveryFile: result.recoveryFile } : {}),
    ...(result.target ? { target: result.target } : {}),
  };
}

function cleanupStagedEvidence(ownership, { removeDirectory = false } = {}) {
  const errors = [];
  for (const [finalPath, entry] of [...ownership.stagedEntries]) {
    const result = unlinkOwnedEntry(entry.path, entry.identity, { evidence: entry.evidence });
    if (result.status === 'removed' || result.status === 'absent') {
      ownership.stagedEntries.delete(finalPath);
    } else {
      errors.push({
        file: entry.path,
        reason: result.status === 'different' && result.reason === 'content'
          ? 'staging entry content changed; it was preserved'
          : result.status === 'different'
            ? 'staging entry identity changed; it was preserved'
          : result.error?.message,
      });
    }
  }
  const directories = [
    ownership.inspection,
    ...(removeDirectory ? [{
      directory: ownership.stagingDirectory,
      identity: ownership.stagingIdentity,
    }] : []),
  ].filter(Boolean);
  for (const { directory, identity } of directories) {
    try {
      const stat = fs.lstatSync(directory, { bigint: true });
      if (!identity || !identityMatches(stat, identity, { directory: true })) {
        errors.push({
          file: directory,
          recoveryDirectory: directory,
          reason: 'staging directory identity changed; it was preserved',
        });
      } else {
        removeEmptyDirectoryWithRetry(directory);
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        errors.push({ file: directory, recoveryDirectory: directory, reason: error.message });
      }
    }
  }
  return errors;
}

function verifyVisualEvidenceTargets(artifactPath, outputs, ownership) {
  for (const target of visualEvidenceTargets(outputs)) {
    const captured = ownership.targets.get(target.path);
    const verification = captured ? verifyAtomicOutput(captured.snapshot) : {
      status: 'unknown',
      reason: { code: 'evidence-snapshot-missing' },
    };
    if (verification.status !== 'match') {
      return evidencePathConflict(artifactPath, outputs, target.path, verification.reason);
    }
  }
  return { ok: true };
}

function beginVisualEvidenceWrite(artifactPath, artifactBytes, outputs) {
  const targets = visualEvidenceTargets(outputs);
  const candidates = targets.map((target) => target.path);
  const previousEvidence = new Map();
  try {
    fs.mkdirSync(path.dirname(outputs.receipt), { recursive: true });
  } catch (error) {
    return evidenceWriteFailure(
      artifactPath,
      'visual-check could not create its evidence directory.',
      [{ file: path.dirname(outputs.receipt), reason: error.message }],
    );
  }

  const capturedTargets = new Map();
  for (const target of targets) {
    const captured = captureAtomicOutput(target.path, {
      requestedEntryPolicy: 'regular-or-absent',
    });
    if (captured.status !== 'captured') {
      return evidencePathConflict(artifactPath, outputs, target.path, captured.reason);
    }
    capturedTargets.set(target.path, captured);
  }

  const parent = capturedTargets.get(outputs.receipt).snapshot.slot;
  for (const target of targets.slice(1)) {
    const slot = capturedTargets.get(target.path).snapshot.slot;
    if (slot.parentDevice !== parent.parentDevice || slot.parentInode !== parent.parentInode) {
      return evidencePathConflict(artifactPath, outputs, target.path, {
        code: 'evidence-parent-mismatch',
      });
    }
  }

  const existing = candidates.filter((file) => (
    capturedTargets.get(file).snapshot.requestedEntry.kind === 'existing'
  ));
  if (existing.length) {
    const receiptEntry = capturedTargets.get(outputs.receipt).snapshot.requestedEntry;
    if (receiptEntry.kind !== 'existing') {
      return evidencePathConflict(artifactPath, outputs, existing[0], {
        code: 'ownership-receipt-missing',
      });
    }

    const previousReceipt = readRegularFileContents(outputs.receipt, {
      subject: 'ownership-receipt',
    });
    const capturedReceipt = capturedTargets.get(outputs.receipt).snapshot.target;
    if (!previousReceipt.ok || !evidenceIdentityMatches(previousReceipt.identity, {
      device: capturedReceipt.device,
      inode: capturedReceipt.inode,
      mode: capturedReceipt.mode,
      links: 1,
    })) {
      return evidencePathConflict(artifactPath, outputs, outputs.receipt, {
        code: 'ownership-receipt-invalid',
        ...(previousReceipt.reason?.code ? { bindingCode: previousReceipt.reason.code } : {}),
        ...(previousReceipt.reason?.systemCode
          ? { systemCode: previousReceipt.reason.systemCode } : {}),
      });
    }
    const previousBytes = previousReceipt.bytes;
    let previous;
    try {
      previous = JSON.parse(previousBytes.toString('utf8'));
    } catch (error) {
      return evidencePathConflict(artifactPath, outputs, outputs.receipt, {
        code: 'ownership-receipt-invalid',
        ...(error?.code ? { systemCode: error.code } : {}),
      });
    }
    previousEvidence.set(outputs.receipt, {
      ...previousReceipt.evidence,
    });

    if (previous?.schemaVersion !== 1 || previous?.command !== outputs.command) {
      return evidencePathConflict(artifactPath, outputs, outputs.receipt, {
        code: 'ownership-receipt-schema-mismatch',
      });
    }
    const recordedReceiptName = previous?.sidecars?.receipt;
    const recordedContactName = previous?.sidecars?.contactSheet;
    const recordedDirectory = previous?.sidecars?.directory || path.dirname(previous?.artifact?.path || '');
    const receiptNameSafe = typeof recordedReceiptName === 'string'
      // path-contract-allow: portable-logical-path -- receipt filenames are serialized logical basenames.
      && path.basename(recordedReceiptName) === recordedReceiptName;
    const contactNameSafe = outputs.capture === false || typeof recordedContactName === 'string'
      // path-contract-allow: portable-logical-path -- contact-sheet filenames are serialized logical basenames.
      && path.basename(recordedContactName) === recordedContactName;
    if (!path.isAbsolute(recordedDirectory) || !receiptNameSafe || !contactNameSafe
      || sameLocation(path.join(recordedDirectory, recordedReceiptName), outputs.receipt).status !== 'match'
      || (outputs.capture !== false && sameLocation(path.join(recordedDirectory, recordedContactName), outputs.contactSheet).status !== 'match')) {
      return evidencePathConflict(artifactPath, outputs, outputs.receipt, {
        code: 'ownership-sidecar-path-mismatch',
      });
    }
    if (typeof previous?.artifact?.path !== 'string'
      || !path.isAbsolute(previous.artifact.path)
      || sameEntry(previous.artifact.path, artifactPath).status !== 'match'
      || previous.artifact.sha256 !== sha256(artifactBytes)
      || previous.artifact.bytes !== artifactBytes.byteLength) {
      return evidencePathConflict(artifactPath, outputs, outputs.receipt, {
        code: 'ownership-artifact-mismatch',
      });
    }

    const existingEvidence = visualEvidencePaths(outputs).filter((file) => (
      capturedTargets.get(file).snapshot.requestedEntry.kind === 'existing'
    ));
    const recordedEvidence = previous?.sidecars?.files;
    if (existingEvidence.length && !Array.isArray(recordedEvidence)) {
      return evidencePathConflict(artifactPath, outputs, existingEvidence[0], {
        code: 'ownership-evidence-digests-missing',
      });
    }
    if (Array.isArray(recordedEvidence)) {
      const allowed = new Map(visualEvidencePaths(outputs).map((file) => [path.basename(file), file]));
      const recorded = new Map();
      for (const item of recordedEvidence) {
        if (!item || typeof item.file !== 'string' || recorded.has(item.file) || !allowed.has(item.file)) {
          return evidencePathConflict(artifactPath, outputs, outputs.receipt, {
            code: 'ownership-evidence-list-invalid',
          });
        }
        recorded.set(item.file, item);
      }
      if (recorded.size !== existingEvidence.length
        || existingEvidence.some((file) => !recorded.has(path.basename(file)))) {
        return evidencePathConflict(artifactPath, outputs, outputs.receipt, {
          code: 'ownership-evidence-list-mismatch',
        });
      }
      for (const file of existingEvidence) {
        const actual = regularFileEvidence(file);
        const expected = recorded.get(path.basename(file));
        if (!actual.ok
          || actual.evidence.sha256 !== expected.sha256
          || actual.evidence.bytes !== expected.bytes) {
          return evidencePathConflict(artifactPath, outputs, file, {
            code: actual.ok ? 'ownership-evidence-digest-mismatch' : actual.reason.code,
            ...(!actual.ok && actual.reason.systemCode
              ? { systemCode: actual.reason.systemCode } : {}),
          });
        }
        previousEvidence.set(file, {
          sha256: actual.evidence.sha256,
          bytes: actual.evidence.bytes,
        });
      }
    }

  }

  for (const target of targets) {
    const verification = verifyAtomicOutput(capturedTargets.get(target.path).snapshot);
    if (verification.status !== 'match') {
      return evidencePathConflict(artifactPath, outputs, target.path, verification.reason);
    }
  }

  let stagingDirectory;
  let stagingStat;
  try {
    stagingDirectory = fs.mkdtempSync(path.toNamespacedPath(
      path.join(parent.parentPath, '.archify-visual-check-'),
    ));
    stagingStat = fs.lstatSync(stagingDirectory, { bigint: true });
    if (!stagingStat.isDirectory() || stagingStat.isSymbolicLink() || stagingStat.ino === 0n) {
      throw new Error('the newly created staging directory has no stable directory identity');
    }
  } catch (error) {
    return evidenceWriteFailure(
      artifactPath,
      'visual-check could not create a private evidence staging directory.',
      [{ file: parent.parentPath, reason: error.message }],
    );
  }

  const staged = stagedOutputs(outputs, stagingDirectory);
  const ownership = {
    active: true,
    artifact: path.resolve(artifactPath),
    receipt: outputs.receipt,
    targets: capturedTargets,
    stagingDirectory,
    stagingIdentity: fileIdentity(stagingStat),
    stagedOutputs: staged,
    stagingPaths: new Map([
      [outputs.receipt, staged.receipt],
      [outputs.contactSheet, staged.contactSheet],
      ...outputs.screenshots.map((entry, index) => [entry.path, staged.screenshots[index].path]),
    ]),
    stagedEntries: new Map(),
    previousEvidence,
  };
  visualEvidenceOwnerships.add(ownership);
  return { ok: true, ownership };
}

function recordVisualEvidenceFiles(receipt, outputs, ownership) {
  const files = [];
  for (const file of visualEvidencePaths(outputs)) {
    const staged = ownership.stagedEntries.get(file);
    if (!staged || !currentEvidenceMatches(staged.path, staged.identity, staged.evidence)) {
      const error = new Error(`visual-check could not bind evidence file "${file}" to its receipt.`);
      error.evidenceReason = { code: 'staged-evidence-content-mismatch' };
      throw error;
    }
    files.push({ ...staged.evidence, file: path.basename(file) });
  }
  receipt.sidecars.files = files;
}

function currentEvidenceMatches(file, identity, evidence, {
  expectedLinks = identity.links ?? 1,
} = {}) {
  if (!evidence) return false;
  const current = regularFileEvidence(file, { expectedLinks: Number(expectedLinks) });
  return current.ok
    && evidenceIdentityMatches(current.identity, identity, expectedLinks)
    && current.evidence.sha256 === evidence.sha256
    && current.evidence.bytes === evidence.bytes;
}

function restoreOwnedBackup(backup, errors) {
  const expectedLinks = backup.identity.links ?? 1n;
  const expectedLinkCount = Number(expectedLinks);
  let backupStat;
  try {
    backupStat = fs.lstatSync(backup.path, { bigint: true });
  } catch {
    errors.push({ file: backup.path, reason: 'backup identity changed; it was preserved' });
    return;
  }
  if (!identityMatches(backupStat, backup.identity) || backupStat.nlink !== expectedLinks) {
    errors.push({ file: backup.path, reason: 'backup identity changed; it was preserved' });
    return;
  }
  let captured = backup.evidence && Number.isSafeInteger(expectedLinkCount)
    ? captureRegularFileBinding(backup.path, {
      subject: 'restore-backup',
      expectedIdentity: backup.identity,
      expectedMode: backup.identity.mode,
      expectedSha256: backup.evidence.sha256,
      expectedBytes: backup.evidence.bytes,
      expectedLinks: expectedLinkCount,
    })
    : { status: 'unknown', reason: { code: 'restore-backup-evidence-unavailable' } };
  let contentChanged = false;
  if (captured.status !== 'captured'
    && captured.reason?.code === 'restore-backup-content-changed') {
    captured = captureRegularFileBinding(backup.path, {
      subject: 'restore-backup-claimant',
      expectedIdentity: backup.identity,
      expectedMode: backup.identity.mode,
      expectedLinks: expectedLinkCount,
    });
    contentChanged = captured.status === 'captured';
  }
  if (captured.status !== 'captured') {
    errors.push({
      file: backup.path,
      reason: 'backup bytes, mode, or identity changed; it was preserved',
      ...(captured.reason?.code ? { code: captured.reason.code } : {}),
    });
    return;
  }
  let released;
  try {
    const finalEntry = pathEntry(backup.finalPath);
    if (finalEntry.exists === true) {
      errors.push({
        file: backup.path,
        reason: 'final path is occupied; the owned backup was preserved',
      });
      return;
    }
    if (finalEntry.exists === null) {
      errors.push({ file: backup.finalPath, reason: finalEntry.error?.message });
      return;
    }
    try {
      fs.linkSync(backup.path, backup.finalPath);
      const linkedCount = expectedLinkCount + 1;
      const staged = verifyRegularFileBinding(captured.binding, {
        filePath: backup.path,
        expectedLinks: linkedCount,
      });
      const published = verifyRegularFileBinding(captured.binding, {
        filePath: backup.finalPath,
        expectedLinks: linkedCount,
      });
      if (staged.status !== 'match' || published.status !== 'match') {
        const removed = quarantineRemoveRegularFileBinding(
          captured.binding,
          backup.finalPath,
          { subject: 'restored-evidence', expectedLinks: linkedCount },
        );
        errors.push({
          file: backup.path,
          reason: removed.status === 'removed'
            ? 'restored entry identity could not be verified; the owned backup was preserved'
            : removed.status === 'preserved'
              ? 'restored entry changed during cleanup; its successor and the owned backup were preserved'
              : 'restored entry changed before rollback; both entries were preserved',
          ...(removed.reason?.code ? { code: removed.reason.code } : {}),
          ...(removed.recoveryDirectory ? { recoveryDirectory: removed.recoveryDirectory } : {}),
          ...(removed.recoveryFile ? { recoveryFile: removed.recoveryFile } : {}),
        });
        return;
      }
      const removed = unlinkOwnedEntry(backup.path, backup.identity, {
        evidence: captured.content,
        expectedLinks: linkedCount,
      });
      const finalMatches = verifyRegularFileBinding(captured.binding, {
        filePath: backup.finalPath,
        expectedLinks: expectedLinkCount,
      }).status === 'match';
      if (removed.status !== 'removed' || !finalMatches) {
        errors.push({ file: backup.path, reason: 'restored entry link count could not be finalized' });
      } else if (contentChanged) {
        errors.push({
          file: backup.finalPath,
          reason: 'the backup content changed externally; its current bytes were restored and preserved',
        });
      }
    } catch (error) {
      errors.push({
        file: backup.path,
        reason: error?.code === 'EEXIST'
          ? 'final path was claimed during restore; the owned backup was preserved'
          : error.message,
      });
    }
  } finally {
    released = releaseRegularFileBinding(captured.binding);
    if (released.status !== 'released') {
      errors.push({
        file: backup.path,
        reason: 'restored backup binding could not be released cleanly',
        ...(released.reason?.code ? { code: released.reason.code } : {}),
      });
    }
  }
}

function commitVisualEvidence(artifactPath, outputs, ownership, desiredPaths) {
  const verification = verifyVisualEvidenceTargets(artifactPath, outputs, ownership);
  if (!verification.ok) {
    const cleanupErrors = cleanupStagedEvidence(ownership, { removeDirectory: true });
    if (cleanupErrors.length) verification.diagnostic.evidence.rollbackErrors = cleanupErrors;
    ownership.active = false;
    return verification;
  }

  const desired = new Set(desiredPaths);
  const stagedBindings = new Map();
  const releaseStagedBindings = () => {
    const failures = [];
    for (const [finalPath, binding] of stagedBindings) {
      const released = releaseRegularFileBinding(binding);
      if (released.status !== 'released') {
        failures.push({
          file: finalPath,
          reason: released.reason?.code,
          bindingState: released.reason,
          ...(released.reason?.recoveryDirectory
            ? { recoveryDirectory: released.reason.recoveryDirectory } : {}),
        });
      }
    }
    stagedBindings.clear();
    return failures;
  };
  for (const finalPath of desired) {
    const staged = ownership.stagedEntries.get(finalPath);
    const captured = staged ? captureRegularFileBinding(staged.path, {
      subject: 'staged-evidence',
      expectedIdentity: staged.identity,
      expectedMode: staged.identity.mode,
      expectedSha256: staged.evidence?.sha256,
      expectedBytes: staged.evidence?.bytes,
      expectedLinks: 1,
    }) : null;
    if (!staged || captured?.status !== 'captured') {
      const failure = evidenceWriteFailure(
        artifactPath,
        'visual-check could not verify its staged evidence before publication.',
        [{
          file: staged?.path || stagedPathFor(ownership, finalPath),
          reason: captured?.reason?.code || 'staged entry missing or changed',
        }],
      );
      failure.diagnostic.evidence.errors.push(
        ...releaseStagedBindings(),
        ...cleanupStagedEvidence(ownership, { removeDirectory: true }),
      );
      ownership.active = false;
      return failure;
    }
    stagedBindings.set(finalPath, captured.binding);
  }

  const backups = [];
  const published = [];
  let conflict = null;
  try {
    for (const [index, target] of visualEvidenceTargets(outputs).entries()) {
      const captured = ownership.targets.get(target.path);
      if (captured.snapshot.target.kind !== 'file') continue;
      const backupPath = path.join(ownership.stagingDirectory, `previous-${index}`);
      const identity = {
        device: captured.snapshot.target.device,
        inode: captured.snapshot.target.inode,
        mode: captured.snapshot.target.mode,
        links: 1n,
      };
      const evidence = ownership.previousEvidence.get(target.path);
      if (!evidence) {
        conflict = evidencePathConflict(artifactPath, outputs, target.path, {
          code: 'target-evidence-missing-during-commit',
        });
        throw new Error(conflict.error);
      }
      const backup = {
        targetPath: target.path,
        finalPath: captured.commitPath,
        path: backupPath,
        identity,
        evidence,
      };
      const backupResult = backupOwnedPublishedEntry(
        captured.commitPath,
        backupPath,
        identity,
        evidence,
      );
      if (backupResult.backupCreated) backups.push(backup);
      if (backupResult.status !== 'backed-up'
        || !backupResult.backupCreated
        || !backupResult.backupVerified) {
        conflict = evidencePathConflict(artifactPath, outputs, target.path, {
          code: backupResult.reason?.code || 'target-backup-failed-during-commit',
          backupCreated: backupResult.backupCreated === true,
          backupVerified: backupResult.backupVerified === true,
          ...(backupResult.recoveryDirectory
            ? { recoveryDirectory: backupResult.recoveryDirectory } : {}),
          ...(backupResult.recoveryFile ? { recoveryFile: backupResult.recoveryFile } : {}),
          ...(backupResult.target ? { target: backupResult.target } : {}),
          ...(backupResult.reason ? { bindingState: backupResult.reason } : {}),
        });
        throw new Error(conflict.error);
      }
    }

    const publicationOrder = visualEvidenceTargets(outputs)
      .filter((target) => desired.has(target.path))
      .sort((left, right) => Number(left.kind === 'receipt') - Number(right.kind === 'receipt'));
    for (const target of publicationOrder) {
      const captured = ownership.targets.get(target.path);
      const staged = ownership.stagedEntries.get(target.path);
      const stagedBinding = stagedBindings.get(target.path);
      const beforeLink = verifyRegularFileBinding(stagedBinding, {
        filePath: staged.path,
        expectedLinks: 1,
      });
      if (beforeLink.status !== 'match') {
        conflict = evidencePathConflict(artifactPath, outputs, target.path, {
          code: beforeLink.reason?.code?.includes('content-changed')
            ? 'staged-evidence-content-mismatch'
            : beforeLink.reason?.code || 'staged-evidence-content-mismatch',
        });
        throw new Error(conflict.error);
      }
      try {
        fs.linkSync(staged.path, captured.commitPath);
      } catch (error) {
        if (error?.code === 'EEXIST') {
          conflict = evidencePathConflict(artifactPath, outputs, target.path, {
            code: 'target-created-during-commit',
          });
        }
        throw error;
      }
      published.push({
        finalPath: captured.commitPath,
        stagedPath: staged.path,
        identity: staged.identity,
        evidence: staged.evidence,
        binding: stagedBinding,
      });
      const stagedLinked = verifyRegularFileBinding(stagedBinding, {
        filePath: staged.path,
        expectedLinks: 2,
      });
      const publishedLinked = verifyRegularFileBinding(stagedBinding, {
        filePath: captured.commitPath,
        expectedLinks: 2,
      });
      if (stagedLinked.status !== 'match' || publishedLinked.status !== 'match') {
        conflict = evidencePathConflict(artifactPath, outputs, target.path, {
          code: 'published-entry-identity-mismatch',
          stagedState: stagedLinked.reason,
          publishedState: publishedLinked.reason,
        });
        throw new Error(conflict.error);
      }
      const removed = quarantineRemoveRegularFileBinding(stagedBinding, staged.path, {
        subject: 'staged-evidence',
        expectedLinks: 2,
      });
      if (removed.status !== 'removed' && removed.status !== 'preserved') {
        conflict = evidencePathConflict(artifactPath, outputs, target.path, {
          code: removed.reason?.code || 'published-entry-identity-mismatch',
        });
        throw new Error(`visual-check could not retire staged evidence "${staged.path}".`);
      }
      if (removed.status === 'removed') ownership.stagedEntries.delete(target.path);
      const finalized = verifyRegularFileBinding(stagedBinding, {
        filePath: captured.commitPath,
        expectedLinks: 1,
      });
      if (finalized.status !== 'match') {
        conflict = evidencePathConflict(artifactPath, outputs, target.path, {
          code: 'published-entry-link-count-mismatch',
          bindingState: finalized.reason,
        });
        throw new Error(conflict.error);
      }
    }

    // Receipt publication is the linearization point for the evidence set.
    // Recheck every earlier member afterwards so a writer that replaces a PNG
    // or the contact sheet while later members publish cannot yield success.
    for (const entry of published) {
      const finalState = verifyRegularFileBinding(entry.binding, {
        filePath: entry.finalPath,
        expectedLinks: 1,
      });
      if (finalState.status !== 'match') {
        conflict = evidencePathConflict(artifactPath, outputs, entry.finalPath, {
          code: 'published-set-identity-mismatch',
          bindingState: finalState.reason,
        });
        throw new Error(conflict.error);
      }
    }

    for (const backup of backups) {
      if (!currentEvidenceMatches(
        backup.path,
        backup.identity,
        ownership.previousEvidence.get(backup.targetPath),
      )) {
        conflict = evidencePathConflict(artifactPath, outputs, backup.targetPath, {
          code: 'backup-content-changed-before-cleanup',
        });
        throw new Error(conflict.error);
      }
    }

    // SMB keeps removed staging names pending until every bound handle closes.
    // Publication and backup verification are complete before directory cleanup.
    const cleanupErrors = releaseStagedBindings();
    for (const backup of backups) {
      const removed = unlinkOwnedEntry(backup.path, backup.identity, {
        evidence: backup.evidence,
      });
      if (removed.status !== 'removed' && removed.status !== 'absent') {
        cleanupErrors.push({
          file: backup.path,
          reason: removed.status === 'different' && removed.reason === 'content'
            ? 'backup content changed; it was preserved'
            : removed.status === 'different'
              ? 'backup identity changed; it was preserved'
            : removed.error?.message,
        });
      }
    }
    cleanupErrors.push(...cleanupStagedEvidence(ownership, { removeDirectory: true }));
    ownership.active = false;
    let recoveryDirectory;
    if (cleanupErrors.length) {
      try {
        const retained = fs.lstatSync(ownership.stagingDirectory, { bigint: true });
        if (identityMatches(retained, ownership.stagingIdentity, { directory: true })) {
          recoveryDirectory = ownership.stagingDirectory;
        }
      } catch {}
      recoveryDirectory ||= cleanupErrors.find((entry) => entry.recoveryDirectory)?.recoveryDirectory;
    }
    return {
      ok: true,
      status: cleanupErrors.length ? 'committed-with-warning' : 'committed',
      cleanupErrors,
      ...(recoveryDirectory ? { recoveryDirectory } : {}),
      committedReceipt: outputs.receipt,
    };
  } catch (error) {
    const rollbackErrors = [];
    for (const entry of [...published].reverse()) {
      let removed;
      let ownedMismatch;
      for (const expectedLinks of [2, 1]) {
        const matches = verifyRegularFileBinding(entry.binding, {
          filePath: entry.finalPath,
          expectedLinks,
        });
        if (matches.status === 'match') {
          removed = quarantineRemoveRegularFileBinding(
            entry.binding,
            entry.finalPath,
            { subject: 'published-evidence', expectedLinks },
          );
          break;
        }
        if (matches.reason?.code?.includes('content-changed')
          || matches.reason?.code?.includes('mode-changed')) {
          ownedMismatch = matches;
        } else {
          ownedMismatch ||= matches;
        }
        const reportedLinks = Number(matches.reason?.links);
        if (matches.status === 'unsupported'
          && matches.reason?.code === 'staged-evidence-hardlinked'
          && Number.isSafeInteger(reportedLinks)
          && reportedLinks > expectedLinks) {
          const current = verifyRegularFileBinding(entry.binding, {
            filePath: entry.finalPath,
            expectedLinks: reportedLinks,
          });
          if (current.status === 'match') {
            removed = quarantineRemoveRegularFileBinding(
              entry.binding,
              entry.finalPath,
              { subject: 'published-evidence', expectedLinks: reportedLinks },
            );
            break;
          }
        }
      }
      if (!removed) {
        const claimantRemoval = quarantineRemoveLinkedRegularFileAlias(
          entry.stagedPath,
          entry.finalPath,
          { subject: 'published-evidence-claimant' },
        );
        removed = claimantRemoval.status === 'removed' ? claimantRemoval : ownedMismatch;
      }
      if (removed.status !== 'removed' && removed.status !== 'absent') {
        rollbackErrors.push(publishedRemovalError(entry.finalPath, removed));
      }
    }
    for (const backup of [...backups].reverse()) restoreOwnedBackup(backup, rollbackErrors);
    rollbackErrors.push(...releaseStagedBindings());
    rollbackErrors.push(...cleanupStagedEvidence(ownership, { removeDirectory: true }));
    ownership.active = false;
    if (conflict) {
      if (rollbackErrors.length) conflict.diagnostic.evidence.rollbackErrors = rollbackErrors;
      return conflict;
    }
    return evidenceWriteFailure(
      artifactPath,
      'visual-check could not atomically publish its evidence set.',
      [{ reason: error.message }, ...rollbackErrors],
    );
  } finally {
    releaseStagedBindings();
  }
}

function executable(file, platform = process.platform) {
  if (!file) return null;
  try {
    fs.accessSync(file, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK);
    return path.resolve(file);
  } catch {
    return null;
  }
}

function findOnPath(command, env, platform, resolveExecutable) {
  const pathApi = platform === 'win32' ? path.win32 : path;
  const directories = String(env.PATH || '').split(pathApi.delimiter).filter(Boolean);
  const extensions = platform === 'win32'
    ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean)
    : [''];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = pathApi.join(directory, `${command}${extension}`);
      const resolved = resolveExecutable(candidate, platform);
      if (resolved) return resolved;
    }
  }
  return null;
}

export function findChrome({
  env = process.env,
  platform = process.platform,
  resolveExecutable = executable,
} = {}) {
  if (Object.prototype.hasOwnProperty.call(env, 'ARCHIFY_CHROME')) {
    return resolveExecutable(env.ARCHIFY_CHROME, platform);
  }

  const fixed = [];
  const commands = [];
  if (platform === 'darwin') {
    fixed.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    );
  } else if (platform === 'win32') {
    const pathApi = path.win32;
    for (const root of [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean)) {
      fixed.push(
        pathApi.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe'),
        pathApi.join(root, 'Chromium', 'Application', 'chrome.exe'),
      );
    }
    commands.push('chrome', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser');
  } else {
    commands.push('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser');
  }

  for (const candidate of fixed) {
    const resolved = resolveExecutable(candidate, platform);
    if (resolved) return resolved;
  }
  for (const command of commands) {
    const resolved = findOnPath(command, env, platform, resolveExecutable);
    if (resolved) return resolved;
  }
  return null;
}

class PipeCdp {
  constructor(child, { failureDetails = () => '' } = {}) {
    this.child = child;
    this.failureDetails = failureDetails;
    this.nextId = 1;
    this.buffer = '';
    this.receivedBytes = 0;
    this.receivedMessages = 0;
    this.completedWrites = 0;
    this.writtenBytes = 0;
    this.pending = new Map();
    this.waiters = [];
    this.writePipe = child.stdio[3];
    this.readPipe = child.stdio[4];
    this.readPipe.setEncoding('utf8');
    this.readPipe.on('data', (chunk) => this.consume(chunk));
    this.writePipe.on('error', (error) => this.failAll(this.failure('write pipe', error)));
    this.readPipe.on('error', (error) => this.failAll(this.failure('read pipe', error)));
    this.readPipe.once('end', () => this.failAll(this.failure('read pipe', new Error('stream ended'))));
    this.readPipe.once('close', () => this.failAll(this.failure('read pipe', new Error('stream closed'))));
    this.writePipe.once('close', () => this.failAll(this.failure('write pipe', new Error('stream closed'))));
    child.once('error', (error) => this.failAll(this.failure('process launch', error)));
    child.once('close', (code, signal) => {
      const ending = signal ? `signal ${signal}` : `exit code ${code}`;
      this.failAll(this.failure('process exit', new Error(`Chrome closed with ${ending}`)));
    });
  }

  failure(stage, error) {
    const code = error?.code ? ` [${error.code}]` : '';
    const details = this.failureDetails();
    const failure = new Error([
      `Chrome DevTools ${stage} failed: ${error?.message || String(error)}${code}`,
      details,
      `Chrome transport: Node ${process.version}, libuv ${process.versions.uv}, ${process.platform}; pid=${this.child.pid ?? 'unavailable'}, exitCode=${this.child.exitCode}, signalCode=${this.child.signalCode}.`,
      `Chrome read pipe: readable=${this.readPipe.readable}, ended=${this.readPipe.readableEnded}, destroyed=${this.readPipe.destroyed}, receivedBytes=${this.receivedBytes}, messages=${this.receivedMessages}, bufferedBytes=${Buffer.byteLength(this.buffer)}.`,
      `Chrome write pipe: writable=${this.writePipe.writable}, ended=${this.writePipe.writableEnded}, destroyed=${this.writePipe.destroyed}, completedWrites=${this.completedWrites}, writtenBytes=${this.writtenBytes}, bufferedBytes=${this.writePipe.writableLength}.`,
    ].filter(Boolean).join('\n'));
    if (error?.code) failure.code = error.code;
    if (error?.method) failure.method = error.method;
    return failure;
  }

  consume(chunk) {
    this.receivedBytes += Buffer.byteLength(chunk);
    this.buffer += chunk;
    let boundary;
    while ((boundary = this.buffer.indexOf('\0')) >= 0) {
      const raw = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 1);
      if (!raw) continue;
      let message;
      try {
        message = JSON.parse(raw);
      } catch (error) {
        this.failAll(new Error(`Chrome DevTools returned invalid JSON: ${error.message}`));
        continue;
      }
      this.receivedMessages += 1;
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) continue;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
        continue;
      }
      for (const waiter of [...this.waiters]) {
        if (waiter.method !== message.method) continue;
        if (waiter.sessionId && waiter.sessionId !== message.sessionId) continue;
        clearTimeout(waiter.timer);
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(message.params || {});
      }
    }
  }

  send(method, params = {}, sessionId = undefined, timeoutMs = 15000) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`${method}: timed out after ${timeoutMs}ms`);
        error.code = 'ERR_CHROME_CDP_TIMEOUT';
        error.method = method;
        reject(this.failure('protocol timeout', error));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        const serialized = `${JSON.stringify(message)}\0`;
        this.writePipe.write(serialized, (error) => {
          if (error) {
            this.failAll(this.failure('write pipe', error));
          } else {
            this.completedWrites += 1;
            this.writtenBytes += Buffer.byteLength(serialized);
          }
        });
      } catch (error) {
        this.failAll(this.failure('write pipe', error));
      }
    });
  }

  waitFor(method, sessionId, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const waiter = { method, sessionId, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(this.failure('event timeout', new Error(`${method}: event timed out after ${timeoutMs}ms`)));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
    this.waiters = [];
  }
}

export function chromeVisualBrowserArgs(profileRoot, {
  env = process.env,
  getuid = typeof process.getuid === 'function' ? () => process.getuid() : null,
} = {}) {
  const args = [
    '--headless=new',
    '--remote-debugging-pipe',
    '--disable-gpu',
    '--hide-scrollbars',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--force-device-scale-factor=1',
    `--user-data-dir=${profileRoot}`,
    'about:blank',
  ];
  const rootUser = typeof getuid === 'function' && getuid() === 0;
  const sandboxOptOut = env?.[CHROME_NO_SANDBOX_ENV] === '1';
  if (rootUser || sandboxOptOut) args.unshift('--no-sandbox');
  return args;
}

async function evaluate(cdp, sessionId, expression, awaitPromise = false) {
  const response = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description
      || response.exceptionDetails.text
      || 'Runtime.evaluate failed');
  }
  return response.result?.value;
}

export class ChromeVisualBrowser {
  constructor(chromePath, {
    env = process.env,
    getuid = typeof process.getuid === 'function' ? () => process.getuid() : null,
    spawnImpl = spawn,
    startupTimeoutMs = CHROME_STARTUP_TIMEOUT_MS,
  } = {}) {
    this.profileRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-visual-check-profile-'));
    this.stderr = '';
    const args = chromeVisualBrowserArgs(this.profileRoot, { env, getuid });
    this.child = spawnImpl(chromePath, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (chunk) => {
      this.stderr = `${this.stderr}${chunk}`.slice(-8000);
    });
    this.child.stderr.on('error', (error) => {
      this.stderr = `${this.stderr}\nChrome stderr stream failed: ${error.message}`.trim().slice(-8000);
    });
    this.cdp = new PipeCdp(this.child, {
      failureDetails: () => {
        const exit = this.child.signalCode
          ? `signal ${this.child.signalCode}`
          : this.child.exitCode == null ? 'still running' : `exit code ${this.child.exitCode}`;
        const stderr = this.stderr.trim();
        return [
          `Chrome process: ${exit}.`,
          stderr ? `Chrome stderr:\n${stderr}` : '',
        ].filter(Boolean).join('\n');
      },
    });
    this.startupTimeoutMs = startupTimeoutMs;
    this.sessionPromise = this.attach();
  }

  async attach() {
    // Process launch can be delayed substantially on a busy desktop. Keep the
    // longer allowance inside one gate invocation so an authoring agent does
    // not turn startup jitter into repeated tool calls or candidate edits.
    const targets = await this.cdp.send(
      'Target.getTargets', {}, undefined, this.startupTimeoutMs,
    );
    let target = targets.targetInfos?.find((item) => item.type === 'page');
    if (!target) {
      const created = await this.cdp.send('Target.createTarget', { url: 'about:blank' });
      target = { targetId: created.targetId };
    }
    const attached = await this.cdp.send('Target.attachToTarget', {
      targetId: target.targetId,
      flatten: true,
    });
    await this.cdp.send('Page.enable', {}, attached.sessionId);
    await this.cdp.send('Runtime.enable', {}, attached.sessionId);
    return attached.sessionId;
  }

  async inspect({ artifactPath, width, height, theme, screenshotPath, writeScreenshot }) {
    const sessionId = await this.sessionPromise;
    await this.cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);

    const url = pathToFileURL(artifactPath);
    url.searchParams.set('theme', theme);
    const loaded = this.cdp.waitFor('Page.loadEventFired', sessionId);
    // Navigation can fail before this waiter is awaited. Attach a rejection
    // handler immediately so a later load failure never escapes as an
    // unhandled rejection; awaiting `loaded` below still reports it normally.
    loaded.catch(() => {});
    const navigation = await this.cdp.send('Page.navigate', { url: url.href }, sessionId);
    if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
    await loaded;
    await evaluate(this.cdp, sessionId, `(function () {
      document.documentElement.setAttribute('data-motion', 'still');
      var panel = document.querySelector('.diagram-container');
      if (panel) panel.setAttribute('data-detail-level', 'read');
      var fontsReady = document.fonts && document.fonts.ready
        ? document.fonts.ready.catch(function () {})
        : Promise.resolve();
      if (window.Archify && Archify.layoutStability && typeof Archify.layoutStability.whenStable === 'function') {
        return fontsReady.then(function () { return Archify.layoutStability.whenStable(); });
      }
      return fontsReady.then(function () {
        if (window.Archify && Archify.readerLayout && typeof Archify.readerLayout.whenStable === 'function') {
          return Archify.readerLayout.whenStable();
        }
      }).then(function () {
        if (window.Archify && Archify.viewerChromeLayout && typeof Archify.viewerChromeLayout.whenStable === 'function') {
          return Archify.viewerChromeLayout.whenStable();
        }
      }).then(function () {
        if (window.Archify && Archify.readerLayout && typeof Archify.readerLayout.whenStable === 'function') {
          return Archify.readerLayout.whenStable();
        }
      }).then(function () {
        if (window.Archify && Archify.viewerChromeLayout && typeof Archify.viewerChromeLayout.whenStable === 'function') {
          return Archify.viewerChromeLayout.whenStable();
        }
        return new Promise(function (resolve) {
          requestAnimationFrame(function () { requestAnimationFrame(resolve); });
        });
      });
    })()`, true);

    const metrics = await evaluate(this.cdp, sessionId, `(function () {
      var reader = document.querySelector('.container');
      var diagram = document.querySelector('.diagram-container');
      var svg = diagram && (
        diagram.querySelector(':scope > svg') ||
        diagram.querySelector(':scope > .diagram-stage > svg')
      );
      var stage = diagram && (diagram.querySelector(':scope > .diagram-stage') || svg);
      var legend = svg && svg.querySelector('[data-legend]');
      var navigationDock = diagram && diagram.querySelector('.diagram-nav');
      var viewBox = svg && svg.viewBox && svg.viewBox.baseVal;
      var diagramWidth = svg ? svg.getBoundingClientRect().width : 0;
      var viewBoxWidth = viewBox ? viewBox.width : 0;
      var scale = viewBoxWidth > 0 ? Math.min(1, diagramWidth / viewBoxWidth) : 0;
      var minimum = null;
      var minimumNonEdge = null;
      var minimumEdge = null;
      if (svg && scale > 0) {
        Array.from(svg.querySelectorAll('text[data-node-label], text[data-boundary-label], text[data-detail="context"], g[data-detail="context"] text')).forEach(function (text) {
          if (text.getAttribute('data-detail') === 'fine' || text.closest('[data-detail="fine"]')) return;
          var edge = text.closest('[data-edge-from][data-edge-to]');
          var node = text.closest('[data-node-id]');
          var context = text.getAttribute('data-detail') === 'context' || Boolean(text.closest('g[data-detail="context"]'));
          var detail = text.hasAttribute('data-node-label')
            ? 'primary'
            : text.hasAttribute('data-boundary-label') ? 'boundary'
              : context && edge ? 'edge' : 'context';
          if (detail === 'context' && !node) return;
          var sourceFontPx = parseFloat(text.getAttribute('font-size') || '');
          if (!Number.isFinite(sourceFontPx)) return;
          var projectedFontPx = sourceFontPx * scale;
          var entry = {
            text: (text.textContent || '').trim(),
            detail: detail,
            owner: edge ? {
              kind: 'edge',
              id: edge.getAttribute('data-edge-id'),
              from: edge.getAttribute('data-edge-from'),
              to: edge.getAttribute('data-edge-to')
            } : node ? { kind: 'node', id: node.getAttribute('data-node-id') }
              : detail === 'boundary' ? { kind: 'boundary', id: null } : null,
            sourceFontPx: sourceFontPx,
            projectedFontPx: projectedFontPx
          };
          if (!minimum || projectedFontPx < minimum.projectedFontPx) minimum = entry;
          if (detail === 'edge') {
            if (!minimumEdge || projectedFontPx < minimumEdge.projectedFontPx) minimumEdge = entry;
          } else if (!minimumNonEdge || projectedFontPx < minimumNonEdge.projectedFontPx) {
            minimumNonEdge = entry;
          }
        });
      }
      function intersectionArea(a, b) {
        if (!a || !b || !a.width || !a.height || !b.width || !b.height) return 0;
        var width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
        var height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
        return width * height;
      }
      var legendRect = legend ? legend.getBoundingClientRect() : null;
      var stageRect = window.Archify && Archify.viewerChromeLayout
        && typeof Archify.viewerChromeLayout.stageRect === 'function'
        ? Archify.viewerChromeLayout.stageRect()
        : (stage ? stage.getBoundingClientRect() : null);
      var navigationDockRect = navigationDock ? navigationDock.getBoundingClientRect() : null;
      var stageDockIntersectionArea = intersectionArea(stageRect, navigationDockRect);
      var viewerChromeReceipt = window.Archify && Archify.viewerChromeLayout
        && typeof Archify.viewerChromeLayout.receipt === 'function'
        ? Archify.viewerChromeLayout.receipt()
        : null;
      // Read rendered boxes only; source ownership, offsets and hard pins are unknown.
      var workflowLanes = svg ? Array.from(svg.querySelectorAll('rect[data-composition-frame-kind="lane"]')).map(function (lane) {
        var rect = lane.getBoundingClientRect();
        var members = Array.from(svg.querySelectorAll('g[data-node-id]')).map(function (node) {
          var box = node.querySelector('rect');
          if (!box) return null;
          var bounds = box.getBoundingClientRect();
          if (bounds.top < rect.top - 1 || bounds.bottom > rect.bottom + 1
            || bounds.left < rect.left - 1 || bounds.right > rect.right + 1) return null;
          return { id: node.getAttribute('data-node-id'), top: bounds.top, bottom: bounds.bottom };
        }).filter(Boolean);
        var top = members.length ? members.reduce(function (minimum, node) { return Math.min(minimum, node.top); }, Infinity) : null;
        var bottom = members.length ? members.reduce(function (maximum, node) { return Math.max(maximum, node.bottom); }, -Infinity) : null;
        return {
          frameId: lane.getAttribute('data-composition-frame-id'),
          heightPx: Math.round(rect.height),
          nodeCount: members.length,
          nodeIds: members.slice(0, 12).map(function (node) { return node.id; }),
          nodeSpanPx: top === null ? null : Math.round(bottom - top),
          spaceAboveNodesPx: top === null ? null : Math.round(top - rect.top),
          spaceBelowNodesPx: bottom === null ? null : Math.round(rect.bottom - bottom)
        };
      }).sort(function (a, b) { return b.heightPx - a.heightPx; }).slice(0, 6) : [];
      // Vertical page budget: every block that stacks above or below the SVG,
      // so an overflow receipt can say which part must give up how many pixels.
      function outerHeight(element) {
        if (!element) return 0;
        var style = window.getComputedStyle(element);
        if (element.hidden || style.display === 'none') return 0;
        return element.getBoundingClientRect().height
          + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
      }
      var bodyStyle = window.getComputedStyle(document.body);
      var diagramStyle = diagram ? window.getComputedStyle(diagram) : null;
      var svgHeight = svg ? svg.getBoundingClientRect().height : 0;
      var pageComposition = {
        bodyPaddingPx: Math.round((parseFloat(bodyStyle.paddingTop) || 0) + (parseFloat(bodyStyle.paddingBottom) || 0)),
        headerPx: Math.round(outerHeight(reader && reader.querySelector('.header'))),
        diagramChromePx: Math.round(outerHeight(diagram) - svgHeight),
        svgPx: Math.round(svgHeight),
        cardsPx: Math.round(outerHeight(reader && reader.querySelector('.cards'))),
        viewBoxHeight: viewBox ? viewBox.height : 0
      };
      var svgRect = svg && svg.getBoundingClientRect();
      var diagramRect = diagram && diagram.getBoundingClientRect();
      var documentScrollUnclipped = Boolean(svgRect && diagramRect
        && svgRect.top >= diagramRect.top - 1 && svgRect.left >= diagramRect.left - 1
        && svgRect.bottom <= diagramRect.bottom + 1 && svgRect.right <= diagramRect.right + 1
        && diagram.scrollHeight <= diagram.clientHeight + 1
        && diagram.scrollWidth <= diagram.clientWidth + 1
        && [document.documentElement, document.body].every(function (element) {
          return !['hidden', 'clip'].includes(window.getComputedStyle(element).overflowY);
        }));
      return {
        pageComposition: pageComposition,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        scrollWidth: Math.ceil(document.documentElement.scrollWidth),
        scrollHeight: Math.ceil(document.documentElement.scrollHeight),
        resolvedTheme: document.documentElement.getAttribute('data-theme') || '',
        readerLayout: document.documentElement.getAttribute('data-reader-layout') || null,
        readerOverflow: document.documentElement.getAttribute('data-reader-overflow') || null,
        readerFit: svg ? svg.getAttribute('data-reader-fit') : null,
        diagramType: svg ? svg.getAttribute('data-diagram-type') : null,
        documentScrollUnclipped: documentScrollUnclipped,
        readerWidth: reader ? reader.getBoundingClientRect().width : 0,
        diagramWidth: diagramWidth,
        viewBoxWidth: viewBoxWidth,
        workflowLanes: workflowLanes,
        minimumProjectedNodeTextPx: minimum ? minimum.projectedFontPx : null,
        minimumProjectedNonEdgeTextPx: minimumNonEdge ? minimumNonEdge.projectedFontPx : null,
        minimumProjectedEdgeTextPx: minimumEdge ? minimumEdge.projectedFontPx : null,
        minimumProjectedNodeText: minimum ? minimum.text : null,
        minimumProjectedNodeTextDetail: minimum ? minimum.detail : null,
        minimumProjectedNodeTextOwner: minimum ? minimum.owner : null,
        hasLegend: Boolean(legendRect && legendRect.width && legendRect.height),
        hasNavigationDock: Boolean(navigationDockRect && navigationDockRect.width && navigationDockRect.height),
        legendDockIntersectionArea: stageDockIntersectionArea > 0
          ? intersectionArea(legendRect, navigationDockRect)
          : 0,
        dockStageIntersectionArea: stageDockIntersectionArea,
        dockStageGap: stageRect && navigationDockRect ? navigationDockRect.top - stageRect.bottom : null,
        viewerChromeRequiredGap: viewerChromeReceipt ? viewerChromeReceipt.gap : null,
        viewerChromeReserve: viewerChromeReceipt ? viewerChromeReceipt.reserve : 0,
        viewerChromeActive: viewerChromeReceipt ? viewerChromeReceipt.active : false
      };
    })()`);
    if (!metrics || !Number.isFinite(metrics.scrollWidth) || !Number.isFinite(metrics.scrollHeight)) {
      throw new Error('Chrome returned incomplete containment metrics.');
    }

    if (screenshotPath) {
      const capture = await this.cdp.send('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
        captureBeyondViewport: false,
      }, sessionId, 20000);
      if (!capture.data) throw new Error('Chrome returned an empty screenshot.');
      const screenshot = Buffer.from(capture.data, 'base64');
      if (writeScreenshot) writeScreenshot(screenshot);
      else fs.writeFileSync(screenshotPath, screenshot, { flag: 'wx' });
    }
    return metrics;
  }

  close() {
    if (!this.closePromise) this.closePromise = this.finishClose();
    return this.closePromise;
  }

  async finishClose() {
    this.cdp.failAll(new Error('visual-check finished'));
    try {
      if (this.child.exitCode === null && this.child.signalCode === null) {
        await new Promise((resolve) => {
          let timer = null;
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            this.child.removeListener('exit', finish);
            resolve();
          };
          this.child.once('exit', finish);
          this.child.kill('SIGTERM');
          if (settled) return;
          timer = setTimeout(() => {
            if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill('SIGKILL');
            finish();
          }, 1500);
        });
      }
    } finally {
      // `exit` only reports that Chrome's main process is gone. A helper may
      // still hold an inherited pipe open, so explicitly release every stream
      // this browser instance owns before its test cleanup hook resolves.
      for (const stream of [this.child.stderr, this.child.stdio[3], this.child.stdio[4]]) {
        if (stream && !stream.destroyed) stream.destroy();
      }
    }
    try {
      fs.rmSync(this.profileRoot, { recursive: true, force: true });
    } catch {
      // Chrome may briefly retain profile files on Windows; evidence is done.
    }
  }
}

function observation({ width, height, theme, metrics }) {
  const innerWidth = Number(metrics.innerWidth);
  const innerHeight = Number(metrics.innerHeight);
  const scrollWidth = Number(metrics.scrollWidth);
  const scrollHeight = Number(metrics.scrollHeight);
  const overflowX = scrollWidth > innerWidth;
  const overflowY = scrollHeight > innerHeight;
  const minimumProjectedNodeTextPx = metrics.minimumProjectedNodeTextPx == null
    ? null
    : Number(metrics.minimumProjectedNodeTextPx);
  const minimumProjectedNonEdgeTextPx = metrics.minimumProjectedNonEdgeTextPx == null
    ? null
    : Number(metrics.minimumProjectedNonEdgeTextPx);
  const minimumProjectedEdgeTextPx = metrics.minimumProjectedEdgeTextPx == null
    ? null
    : Number(metrics.minimumProjectedEdgeTextPx);
  const readabilityOk = minimumProjectedNodeTextPx == null
    || minimumProjectedNodeTextPx >= MIN_PROJECTED_NODE_TEXT_PX;
  const readerLayout = metrics.readerLayout || null;
  const readerOverflow = metrics.readerOverflow || null;
  const readerFit = metrics.readerFit || null;
  const verticalScrollAccepted = Boolean(
    overflowY
    && !overflowX
    && readabilityOk
    && Number.isFinite(minimumProjectedNodeTextPx)
    && ((readerLayout === 'adaptive' && readerOverflow === 'authored' && readerFit === 'intrinsic-height')
      || (readerFit === 'authored-height' && metrics.diagramType === 'architecture'
        && metrics.documentScrollUnclipped === true))
  );
  const authoredClipped = readerFit === 'authored-height' && metrics.diagramType === 'architecture'
    && metrics.documentScrollUnclipped !== true;
  const containmentOk = !authoredClipped && !overflowX && (!overflowY || verticalScrollAccepted);
  const legendDockIntersectionArea = Number(metrics.legendDockIntersectionArea) || 0;
  const dockStageIntersectionArea = Number(metrics.dockStageIntersectionArea) || 0;
  const dockStageGap = metrics.dockStageGap == null ? null : Number(metrics.dockStageGap);
  const receiptDockStageGap = metrics.viewerChromeRequiredGap == null
    ? null
    : Number(metrics.viewerChromeRequiredGap);
  const requiredDockStageGap = Number.isFinite(receiptDockStageGap) ? receiptDockStageGap : 0;
  const viewerChromeStageOk = !metrics.hasNavigationDock || (
    Number.isFinite(dockStageGap)
    && dockStageIntersectionArea <= 0.5
    && dockStageGap >= requiredDockStageGap - 1
  );
  const viewerChromeOk = legendDockIntersectionArea <= 0.5 && viewerChromeStageOk;
  return {
    width,
    height,
    theme,
    innerWidth,
    innerHeight,
    scrollWidth,
    scrollHeight,
    overflowX,
    overflowY,
    verticalScrollAccepted,
    overflowDisposition: authoredClipped || overflowX || (overflowY && !verticalScrollAccepted)
      ? 'unexpected-overflow'
      : verticalScrollAccepted ? 'readable-vertical-scroll' : 'contained',
    readerLayout,
    readerOverflow,
    readerFit,
    ...(readerFit === 'authored-height' ? { diagramType: metrics.diagramType, documentScrollUnclipped: metrics.documentScrollUnclipped === true } : {}),
    ok: containmentOk,
    readerWidth: Number(metrics.readerWidth) || null,
    diagramWidth: Number(metrics.diagramWidth) || null,
    ...(metrics.pageComposition ? { pageComposition: metrics.pageComposition } : {}),
    viewBoxWidth: Number(metrics.viewBoxWidth) || null,
    ...(metrics.workflowLanes?.length ? { workflowLanes: metrics.workflowLanes } : {}),
    minimumProjectedNodeTextPx,
    minimumProjectedNonEdgeTextPx,
    minimumProjectedEdgeTextPx,
    minimumProjectedNodeText: metrics.minimumProjectedNodeText || null,
    minimumProjectedNodeTextDetail: metrics.minimumProjectedNodeTextDetail || null,
    minimumProjectedNodeTextOwner: metrics.minimumProjectedNodeTextOwner || null,
    minimumRequiredNodeTextPx: MIN_PROJECTED_NODE_TEXT_PX,
    readabilityOk,
    hasLegend: Boolean(metrics.hasLegend),
    hasNavigationDock: Boolean(metrics.hasNavigationDock),
    legendDockIntersectionArea,
    dockStageIntersectionArea,
    dockStageGap,
    requiredDockStageGap,
    viewerChromeStageOk,
    viewerChromeReserve: Number(metrics.viewerChromeReserve) || 0,
    viewerChromeActive: Boolean(metrics.viewerChromeActive),
    viewerChromeOk,
    resolvedTheme: metrics.resolvedTheme || theme,
  };
}

function contactSheetHtml({ artifactPath, receipt, screenshots }) {
  const cards = screenshots.map((entry) => `
      <figure>
        <img src="${htmlEscape(entry.file)}" alt="${htmlEscape(`${entry.theme} ${entry.width} by ${entry.height}`)}">
        <figcaption><strong>${htmlEscape(entry.theme.toUpperCase())}</strong> · ${entry.width}×${entry.height} · containment ${entry.ok ? 'pass' : 'fail'}${entry.verticalScrollAccepted ? ' · readable vertical scroll' : ''}</figcaption>
      </figure>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Archify automated browser evidence · ${htmlEscape(path.basename(artifactPath))}</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;background:#e9eef5;color:#172033;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}header{max-width:1500px;margin:0 auto 18px}h1{margin:0 0 6px;font-size:20px}p{margin:0;color:#526176}.grid{max-width:1500px;margin:auto;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}figure{margin:0;padding:10px;background:white;border:1px solid #c9d4e3;border-radius:12px;box-shadow:0 10px 30px rgba(15,23,42,.08)}img{display:block;width:100%;height:auto;border:1px solid #e2e8f0}figcaption{padding:9px 4px 2px;color:#526176}@media(max-width:900px){.grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<header><h1>Automated browser evidence</h1><p>${htmlEscape(path.basename(artifactPath))} · visual-check containment ${htmlEscape(receipt.containment.status)} · perceptual visual review pending</p></header>
<main class="grid">${cards}
</main>
</body>
</html>
`;
}

const publishedBrowserEvidenceReceipts = new WeakSet();

// Keep detailed observations in the bound receipt; expose every review image and
// every failure without repeating the same viewport metrics in CLI context.
export function summarizeBrowserEvidence(receipt) {
  const directory = receipt.sidecars?.directory || path.dirname(receipt.artifact.path);
  const evidencePath = (file) => file ? path.resolve(directory, file) : undefined;
  const published = publishedBrowserEvidenceReceipts.has(receipt);
  return {
    schemaVersion: receipt.schemaVersion,
    command: receipt.command,
    ok: receipt.ok,
    status: receipt.status,
    evidenceKind: receipt.evidenceKind,
    visualReview: receipt.visualReview,
    artifact: receipt.artifact,
    provenance: receipt.provenance,
    deliveryReceiptId: receipt.deliveryReceiptId,
    state: receipt.state,
    chrome: receipt.chrome,
    checks: Object.fromEntries(['containment', 'readability', 'viewerChrome', 'themeStates', 'captures']
      .filter((key) => receipt[key])
      .map((key) => [key, receipt[key].status])),
    error: receipt.error,
    publication: receipt.publication,
    diagnostics: receipt.diagnostics || [],
    evidence: {
      receipt: published ? evidencePath(receipt.sidecars?.receipt) : undefined,
      contactSheet: published ? evidencePath(receipt.captures?.contactSheet) : undefined,
      screenshots: (published ? receipt.captures?.screenshots || [] : []).map((entry) => ({
        path: evidencePath(entry.file),
        width: entry.width,
        height: entry.height,
        theme: entry.theme,
        resolvedTheme: entry.resolvedTheme,
      })),
    },
  };
}

function viewportSubject(artifact, entry) {
  return {
    artifact,
    viewport: { width: entry.width, height: entry.height, theme: entry.theme },
  };
}

function failureDiagnostic({ code, message, subject, evidence, supportedFixes, severity = 'error' }) {
  return { code, severity, message, subject, evidence, supportedFixes };
}

function resolveSidecarDirectory(artifactPath, outputs, compareParents) {
  const artifact = path.resolve(artifactPath);
  const artifactDirectory = path.dirname(artifact);
  const sidecarDirectory = path.dirname(outputs.receipt);
  const comparison = compareParents(outputs.receipt, artifact);

  const sidecars = {
    ...(comparison?.status === 'different' ? { directory: sidecarDirectory } : {}),
    receipt: path.basename(outputs.receipt),
    ...(outputs.capture === false ? {} : { contactSheet: path.basename(outputs.contactSheet) }),
  };
  if (comparison?.status === 'match' || comparison?.status === 'different') {
    return { ok: true, sidecars };
  }

  const reason = comparison?.reason || { code: 'invalid-path-identity-result' };
  const error = `visual-check could not determine the physical identity of its evidence directory "${sidecarDirectory}" relative to the artifact directory "${artifactDirectory}".`;
  return {
    ok: false,
    sidecars,
    error,
    diagnostic: failureDiagnostic({
      code: 'viewer/sidecar-directory-identity',
      message: error,
      subject: { artifact, sidecarDirectory },
      evidence: { comparison: reason },
      supportedFixes: [
        'use existing, accessible artifact and evidence directories, then rerun visual-check',
      ],
    }),
  };
}

// Turn a measured vertical overflow into the pixel budget an author can act on:
// which stacked block holds the height, and what the SVG or cards must shrink to.
export function verticalBudgetFixes(entry) {
  const page = entry.pageComposition;
  if (!entry.overflowY || !page) return [];
  const excess = entry.scrollHeight - entry.innerHeight;
  const fixes = [];
  const stacked = `${page.bodyPaddingPx}px body padding + ${page.headerPx}px header + ${page.diagramChromePx}px diagram chrome + ${page.svgPx}px SVG + ${page.cardsPx}px cards = ${entry.scrollHeight}px against ${entry.innerHeight}px`;
  if (page.svgPx > 0 && page.viewBoxHeight > 0) {
    const targetSvg = page.svgPx - excess;
    const targetViewBoxHeight = Math.floor(page.viewBoxHeight * targetSvg / page.svgPx);
    if (entry.readerLayout === 'adaptive') {
      fixes.push(targetSvg > 0
        ? `the page is ${excess}px too tall (${stacked}); the Reader already narrowed the stage to its ${entry.diagramWidth}px minimum, so the SVG height only follows meta.viewBox: keep every node and relationship and reduce the viewBox height to at most ${targetViewBoxHeight} (from ${page.viewBoxHeight}) by tightening vertical gaps and empty rows`
        : `the page is ${excess}px too tall (${stacked}) and the SVG alone exceeds the viewport at the minimum reader width; split the diagram into two`);
    } else {
      fixes.push(`the page is ${excess}px too tall (${stacked}); the SVG spans the full ${entry.diagramWidth}px reader width because its viewBox ratio is below 1.55 and it declares no intrinsic-height fit, so the Reader can neither narrow it nor accept readable vertical scroll: either remove meta.viewBox so the renderer sizes the canvas and declares the fit, or make the viewBox at least 1.55x wider than tall`);
    }
  }
  if (page.cardsPx >= excess) {
    fixes.push(`alternatively, conclusion cards occupy ${page.cardsPx}px below the diagram; shortening card copy or dropping a card row so cards take at most ${page.cardsPx - excess}px also fits`);
  }
  return fixes;
}

function observationDiagnostics({ artifact, allObservations, readabilityObservations, command }) {
  const diagnostics = [];
  for (const entry of allObservations) {
    if (entry.resolvedTheme !== entry.theme) {
      diagnostics.push(failureDiagnostic({
        code: 'viewer/theme-state',
        message: `The rendered artifact resolved ${entry.resolvedTheme || 'no theme'} instead of the requested ${entry.theme} theme at ${entry.width}x${entry.height}.`,
        subject: viewportSubject(artifact, entry),
        evidence: {
          requestedTheme: entry.theme,
          resolvedTheme: entry.resolvedTheme,
        },
        supportedFixes: [
          `restore deterministic ${entry.theme} theme resolution, then rerun ${command}`,
        ],
      }));
    }
    if (!entry.ok) {
      const authoredClipped = entry.readerFit === 'authored-height' && entry.diagramType === 'architecture'
        && !entry.documentScrollUnclipped;
      const budgetFixes = authoredClipped
        ? ['restore the full SVG inside the diagram panel and allow normal document scrolling; remove internal scrollers and clipping without changing authored geometry']
        : verticalBudgetFixes(entry);
      diagnostics.push(failureDiagnostic({
        code: authoredClipped ? 'viewer/diagram-clipped' : 'viewer/viewport-overflow',
        message: authoredClipped
          ? `The authored Architecture canvas is clipped or cannot scroll in the document at ${entry.width}x${entry.height} (${entry.theme}).`
          : `The rendered artifact overflows the ${entry.width}x${entry.height} ${entry.theme} viewport.`,
        subject: viewportSubject(artifact, entry),
        evidence: {
          innerWidth: entry.innerWidth,
          innerHeight: entry.innerHeight,
          scrollWidth: entry.scrollWidth,
          scrollHeight: entry.scrollHeight,
          overflowX: entry.overflowX,
          overflowY: entry.overflowY,
          overflowDisposition: entry.overflowDisposition,
          readerLayout: entry.readerLayout,
          readerOverflow: entry.readerOverflow,
          readerFit: entry.readerFit,
          ...(authoredClipped ? { documentScrollUnclipped: false } : {}),
          ...(entry.overflowY && entry.pageComposition ? {
            pageComposition: entry.pageComposition,
            pageCompositionMeasurement: 'CSS pixels at this viewport; body padding, header, diagram chrome, SVG and cards stack vertically and sum to scrollHeight',
          } : {}),
          ...(entry.overflowY && entry.workflowLanes?.length ? {
            workflowLanes: entry.workflowLanes,
            measurement: 'CSS pixels; rendered node boxes geometrically contained in each lane frame; spaces include headers and routing, not guaranteed removable space',
          } : {}),
        },
        supportedFixes: [
          ...budgetFixes,
          ...(entry.overflowY && entry.workflowLanes?.length ? [
            'run validate workflow <source.json> --layout-json and compare the tallest rendered lane frames with source lanes, col and yOffset; frame IDs are rendered indices, not source lane IDs',
            'where ownership and explicit geometry permit, distribute stacked steps across logical columns and meaningful lanes before increasing yOffset; preserve nodes, branches, labels and hard pins',
            `read references/authoring-contract.md#workflow-viewport-repair, then validate and deliver the changed source before rerunning ${command} on the new artifact; this is inspection guidance, not a verified coordinate fix`,
          ] : budgetFixes.length ? [] : [`contain the rendered layout within ${entry.width}x${entry.height}, then rerun ${command}`]),
        ],
      }));
    }
    if (entry.legendDockIntersectionArea > 0.5) {
      diagnostics.push(failureDiagnostic({
        code: 'viewer/chrome-legend-clearance',
        message: `The navigation Dock obscures the SVG Legend at ${entry.width}x${entry.height} (${entry.theme}).`,
        subject: viewportSubject(artifact, entry),
        evidence: { legendDockIntersectionArea: entry.legendDockIntersectionArea },
        supportedFixes: [
          `move the SVG Legend or Viewer Dock until legendDockIntersectionArea is 0, then rerun ${command}`,
        ],
      }));
    }
    if (!entry.viewerChromeStageOk) {
      const stageOverlapsDock = entry.dockStageIntersectionArea > 0.5;
      diagnostics.push(failureDiagnostic({
        code: 'viewer/chrome-stage-clearance',
        message: stageOverlapsDock
          ? `Navigation Dock enters the protected SVG stage at ${entry.width}x${entry.height} (${entry.theme}).`
          : `Navigation Dock clearance from the protected SVG stage is below the required gap at ${entry.width}x${entry.height} (${entry.theme}).`,
        subject: viewportSubject(artifact, entry),
        evidence: {
          dockStageIntersectionArea: entry.dockStageIntersectionArea,
          dockStageGap: entry.dockStageGap,
          requiredDockStageGap: entry.requiredDockStageGap,
        },
        supportedFixes: [
          `adjust Viewer stage reservation or clipping until dockStageGap is at least ${entry.requiredDockStageGap} and dockStageIntersectionArea is 0, then rerun ${command}`,
        ],
      }));
    }
  }
  for (const entry of readabilityObservations) {
    if (entry.readabilityOk) continue;
    diagnostics.push(failureDiagnostic({
      code: 'viewer/projected-text-readability',
      message: `Projected ${entry.minimumProjectedNodeTextDetail || 'node'} text is below the readability floor at ${entry.width}x${entry.height}.`,
      subject: viewportSubject(artifact, entry),
      evidence: {
        text: entry.minimumProjectedNodeText,
        detail: entry.minimumProjectedNodeTextDetail,
        owner: entry.minimumProjectedNodeTextOwner,
        minimumProjectedNodeTextPx: entry.minimumProjectedNodeTextPx,
        minimumRequiredNodeTextPx: entry.minimumRequiredNodeTextPx,
      },
      supportedFixes: [
        `increase projected ${entry.minimumProjectedNodeTextOwner?.kind === 'edge' ? 'relationship label' : entry.minimumProjectedNodeTextOwner?.kind === 'boundary' ? 'boundary label' : 'node text'} to at least ${entry.minimumRequiredNodeTextPx}px at ${entry.width}x${entry.height}, then rerun ${command}`,
      ],
    }));
  }
  return diagnostics;
}

function baseReceipt({ artifactPath, artifact, sidecars, chrome, deliveryProvenance, command, capture }) {
  return {
    schemaVersion: 1,
    ok: false,
    command,
    evidenceKind: 'automated-browser',
    status: 'fail',
    visualReview: capture ? 'pending' : 'not-requested',
    ...(deliveryProvenance ? {
      provenance: deliveryProvenance.status,
      ...(deliveryProvenance.receiptId ? { deliveryReceiptId: deliveryProvenance.receiptId } : {}),
    } : {}),
    artifact: {
      path: artifactPath,
      sha256: sha256(artifact),
      bytes: artifact.byteLength,
    },
    state: { detail: 'read', motion: 'still' },
    chrome,
    diagnostics: [],
    containment: {
      status: 'fail',
      policy: 'fit-or-reader-declared-readable-vertical-scroll',
      viewports: [],
    },
    themeStates: { status: 'fail', viewports: [] },
    readability: { status: 'fail', minimumProjectedNodeTextPx: MIN_PROJECTED_NODE_TEXT_PX, viewports: [] },
    viewerChrome: { status: 'fail', viewports: [] },
    captures: { status: capture ? 'fail' : 'not-requested', screenshots: [], contactSheet: null },
    sidecars: { ...sidecars, files: [] },
  };
}

function appendEvidencePublicationFailure(receipt, failure) {
  if (!failure?.ok) {
    if (!receipt.error) receipt.error = failure.error;
    receipt.diagnostics = [...(receipt.diagnostics || []), failure.diagnostic];
  }
}

function appendEvidenceCleanupWarning(receipt, publication) {
  if (publication?.status !== 'committed-with-warning') return false;
  const committedStatus = receipt.status;
  const cleanupErrors = publication.cleanupErrors || [];
  const cleanupMessage = publication.recoveryDirectory
    ? `The evidence set was committed, but cleanup is incomplete. Recovery directory: "${publication.recoveryDirectory}".`
    : 'The evidence set was committed, but cleanup is incomplete.';
  receipt.ok = false;
  receipt.status = 'fail';
  receipt.error = receipt.error ? `${receipt.error} ${cleanupMessage}` : cleanupMessage;
  receipt.publication = {
    status: publication.status,
    committedReceipt: publication.committedReceipt,
    ...(publication.recoveryDirectory
      ? { recoveryDirectory: publication.recoveryDirectory } : {}),
    cleanupErrors,
    committedStatus,
  };
  receipt.diagnostics = [...(receipt.diagnostics || []), failureDiagnostic({
    code: 'viewer/evidence-cleanup-incomplete',
    severity: 'warning',
    message: cleanupMessage,
    subject: {
      artifact: receipt.artifact?.path,
      receipt: publication.committedReceipt,
    },
    evidence: {
      publicationStatus: publication.status,
      ...(publication.recoveryDirectory
        ? { recoveryDirectory: publication.recoveryDirectory } : {}),
      cleanupErrors,
    },
    supportedFixes: publication.recoveryDirectory
      ? [`inspect and safely retire the retained files under "${publication.recoveryDirectory}"`]
      : ['resolve the reported filesystem cleanup failure before rerunning visual-check'],
  })];
  return true;
}

function publishReceiptOnly(artifactPath, outputs, receipt, ownership) {
  const cleanupErrors = cleanupStagedEvidence(ownership);
  if (cleanupErrors.length) {
    const failure = evidenceWriteFailure(
      artifactPath,
      'visual-check could not safely retire this run\'s incomplete staged evidence.',
      cleanupErrors,
    );
    cleanupStagedEvidence(ownership, { removeDirectory: true });
    ownership.active = false;
    return failure;
  }
  try {
    writeStagedEvidence(ownership, outputs.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    const failure = evidenceWriteFailure(
      artifactPath,
      'visual-check could not stage its evidence receipt.',
      [{ file: stagedPathFor(ownership, outputs.receipt), reason: error.message }],
    );
    cleanupStagedEvidence(ownership, { removeDirectory: true });
    ownership.active = false;
    return failure;
  }
  return commitVisualEvidence(artifactPath, outputs, ownership, [outputs.receipt]);
}

function persistBrowserEvidenceFailure(
  artifactPath,
  failure,
  { outDir, compareSidecarParents = sameParent, ownership, command = 'visual-check', capture = true } = {},
) {
  const outputs = evidenceSidecarPaths(artifactPath, { outDir, command, capture });
  const directory = resolveSidecarDirectory(artifactPath, outputs, compareSidecarParents);
  const capturedArtifact = readRegularFileContents(artifactPath, {
    subject: 'failure-artifact',
  });
  const artifactBytes = capturedArtifact.ok ? capturedArtifact.bytes : null;
  const receipt = {
    ...failure,
    ok: false, status: 'fail',
    ...(artifactBytes ? {
      artifact: {
        path: path.resolve(artifactPath),
        sha256: sha256(artifactBytes),
        bytes: artifactBytes.byteLength,
      },
    } : {}),
    containment: {
      status: 'fail',
      policy: 'fit-or-reader-declared-readable-vertical-scroll',
      viewports: [],
    },
    captures: { status: capture ? 'fail' : 'not-requested', screenshots: [], contactSheet: null },
    sidecars: { ...directory.sidecars, files: [] },
  };
  if (!directory.ok) {
    receipt.error = directory.error;
    receipt.diagnostics = [...(failure.diagnostics || []), directory.diagnostic];
    return receipt;
  }
  let activeOwnership = ownership;
  if (!visualEvidenceOwnershipMatches(activeOwnership, artifactPath, outputs)) {
    if (!artifactBytes) {
      const conflict = evidencePathConflict(artifactPath, outputs, outputs.receipt, {
        code: 'artifact-unreadable',
      });
      receipt.error = conflict.error;
      receipt.diagnostics = [...(failure.diagnostics || []), conflict.diagnostic];
      return receipt;
    }
    const preflight = beginVisualEvidenceWrite(artifactPath, artifactBytes, outputs);
    if (!preflight.ok) {
      receipt.error = preflight.error;
      receipt.diagnostics = [...(failure.diagnostics || []), preflight.diagnostic];
      return receipt;
    }
    activeOwnership = preflight.ownership;
  }
  const publication = publishReceiptOnly(artifactPath, outputs, receipt, activeOwnership);
  if (publication.ok) publishedBrowserEvidenceReceipts.add(receipt);
  appendEvidencePublicationFailure(receipt, publication);
  appendEvidenceCleanupWarning(receipt, publication);
  return receipt;
}

async function runBrowserEvidence({
  artifactPath,
  outDir,
  chromePath,
  resolveChrome = findChrome,
  browserFactory = async (resolvedChrome) => new ChromeVisualBrowser(resolvedChrome),
  deliveryProvenance,
  verifyArtifact,
  compareSidecarParents = sameParent,
  command, capture,
} = {}) {
  if (!artifactPath) throw new Error(`${command} requires one delivered HTML artifact.`);
  const artifact = path.resolve(artifactPath);
  if (!/\.html?$/i.test(artifact)) throw new Error(`${command} requires an .html artifact.`);
  const capturedArtifact = captureRegularFileBinding(artifact, {
    subject: 'visual-check-artifact',
    expectedLinks: 1,
    includeContent: true,
  });
  if (capturedArtifact.status !== 'captured') {
    throw regularFileCaptureError('The visual-check artifact', capturedArtifact);
  }
  const artifactBytes = capturedArtifact.content.buffer;
  try {
  const outputs = evidenceSidecarPaths(artifact, { outDir, command, capture });
  const directory = resolveSidecarDirectory(artifact, outputs, compareSidecarParents);
  const receipt = baseReceipt({
    artifactPath: artifact,
    artifact: artifactBytes,
    sidecars: directory.sidecars,
    chrome: { status: 'not-checked', executable: null },
    deliveryProvenance, command, capture,
  });
  if (!directory.ok) {
    receipt.error = directory.error;
    receipt.diagnostics = [directory.diagnostic];
    return { exitCode: EXIT.fail, receipt };
  }
  const preflight = beginVisualEvidenceWrite(artifact, artifactBytes, outputs);
  if (!preflight.ok) {
    receipt.error = preflight.error;
    receipt.diagnostics = [preflight.diagnostic];
    return { exitCode: EXIT.fail, receipt };
  }
  const ownership = preflight.ownership;
  let inspectionArtifact;
  try {
    // Chrome's file loader cannot reliably open long Windows/UNC paths. Keep
    // the one inspected snapshot local; publish evidence on its target volume.
    ownership.inspection = {
      directory: fs.mkdtempSync(path.join(os.tmpdir(), 'archify-inspection-')),
    };
    const stat = fs.lstatSync(ownership.inspection.directory, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || stat.ino === 0n) {
      throw new Error('the private inspection directory has no stable identity');
    }
    ownership.inspection.identity = fileIdentity(stat);
    inspectionArtifact = path.join(ownership.inspection.directory, 'artifact-snapshot.html');
    ownership.stagingPaths.set(artifact, inspectionArtifact);
    writeStagedEvidence(ownership, artifact, artifactBytes);
  } catch (error) {
    return { exitCode: EXIT.fail, receipt: persistBrowserEvidenceFailure(artifact, {
      ...receipt,
      status: 'fail',
      ok: false,
      error: `visual-check could not stage its private artifact snapshot: ${error.message}`,
      diagnostics: [failureDiagnostic({
        code: 'viewer/artifact-snapshot',
        message: 'visual-check could not bind a private artifact snapshot.',
        subject: { artifact },
        evidence: { reason: error.message },
        supportedFixes: ['retry after resolving the reported staging filesystem error'],
      })],
    }, { outDir, compareSidecarParents, ownership, command, capture }) };
  }
  const verifyInspectionArtifact = () => {
    const entry = ownership.stagedEntries.get(artifact);
    if (!entry || !currentEvidenceMatches(entry.path, entry.identity, entry.evidence)) {
      throw new Error('The private visual-check artifact snapshot changed during inspection.');
    }
  };
  try {
    verifyArtifact?.(artifactBytes);
  } catch (error) {
    return { exitCode: EXIT.fail, receipt: persistBrowserEvidenceFailure(artifact, {
      schemaVersion: 1, command, evidenceKind: 'automated-browser', visualReview: capture ? 'pending' : 'not-requested',
      artifact: { path: artifact, sha256: sha256(artifactBytes), bytes: artifactBytes.byteLength },
      provenance: error.deliveryProvenance?.status, error: error.message,
      diagnostics: error.archifyDiagnostics || [],
    }, { outDir, compareSidecarParents, ownership, command, capture }) };
  }

  const resolvedChrome = chromePath || resolveChrome();
  receipt.chrome = resolvedChrome
    ? { status: 'available', executable: resolvedChrome }
    : { status: 'unavailable', executable: null };

  if (!resolvedChrome) {
    receipt.status = 'skipped';
    receipt.containment.status = 'skipped';
    receipt.readability.status = 'skipped';
    receipt.viewerChrome.status = 'skipped';
    receipt.themeStates.status = 'skipped';
    if (capture) receipt.captures.status = 'skipped';
    receipt.error = 'Chrome or Chromium is unavailable. Set ARCHIFY_CHROME to its executable path.';
    receipt.diagnostics = [failureDiagnostic({
      code: 'viewer/chrome-unavailable',
      severity: 'warning',
      message: receipt.error,
      subject: { artifact },
      evidence: { executable: null },
      supportedFixes: [`set ARCHIFY_CHROME to a Chrome or Chromium executable and rerun ${command}`],
    })];
    const publication = publishReceiptOnly(artifact, outputs, receipt, ownership);
    if (publication.ok) publishedBrowserEvidenceReceipts.add(receipt);
    if (!publication.ok) {
      appendEvidencePublicationFailure(receipt, publication);
      return { exitCode: EXIT.fail, receipt };
    }
    if (appendEvidenceCleanupWarning(receipt, publication)) {
      return { exitCode: EXIT.fail, receipt };
    }
    return { exitCode: EXIT.skipped, receipt };
  }

  let browser;
  try {
    browser = await browserFactory(resolvedChrome);
    const observations = new Map();
    const screenshotsByKey = new Map(outputs.screenshots.map((entry, index) => [
      screenshotKey(entry.width, entry.height, entry.theme),
      { ...entry, stagedPath: ownership.stagedOutputs.screenshots[index].path },
    ]));

    for (const viewport of VISUAL_CHECK_VIEWPORTS) {
      const key = screenshotKey(viewport.width, viewport.height, 'light');
      const screenshot = screenshotsByKey.get(key);
      const metrics = await browser.inspect({
        artifactPath: inspectionArtifact,
        ...viewport,
        theme: 'light',
        ...(screenshot ? {
          screenshotPath: screenshot.stagedPath,
          writeScreenshot: (bytes) => writeStagedEvidence(ownership, screenshot.path, bytes),
        } : {}),
      });
      verifyInspectionArtifact();
      if (screenshot) {
        if (screenshot && !ownership.stagedEntries.has(screenshot.path)) {
          registerStagedEvidence(ownership, screenshot.path);
        } else {
          const staged = ownership.stagedEntries.get(screenshot.path);
          if (!currentEvidenceMatches(staged.path, staged.identity, staged.evidence)) {
            throw new Error('The staged visual-check screenshot changed after capture.');
          }
        }
      }
      observations.set(key, observation({ ...viewport, theme: 'light', metrics }));
    }
    for (const viewport of CAPTURE_VIEWPORTS) {
      const key = screenshotKey(viewport.width, viewport.height, 'dark');
      const screenshot = screenshotsByKey.get(key);
      const metrics = await browser.inspect({
        artifactPath: inspectionArtifact,
        ...viewport,
        theme: 'dark',
        ...(screenshot ? {
          screenshotPath: screenshot.stagedPath,
          writeScreenshot: (bytes) => writeStagedEvidence(ownership, screenshot.path, bytes),
        } : {}),
      });
      verifyInspectionArtifact();
      if (screenshot && !ownership.stagedEntries.has(screenshot.path)) {
        registerStagedEvidence(ownership, screenshot.path);
      } else if (screenshot) {
        const staged = ownership.stagedEntries.get(screenshot.path);
        if (!currentEvidenceMatches(staged.path, staged.identity, staged.evidence)) {
          throw new Error('The staged visual-check screenshot changed after capture.');
        }
      }
      observations.set(key, observation({ ...viewport, theme: 'dark', metrics }));
    }

    let artifactVerification = verifyRegularFileBinding(capturedArtifact.binding);
    if (artifactVerification.status !== 'match') {
      throw regularFileCaptureError(`The delivered artifact changed while ${command} was running`, artifactVerification);
    }
    verifyArtifact?.(artifactBytes);
    artifactVerification = verifyRegularFileBinding(capturedArtifact.binding);
    if (artifactVerification.status !== 'match') {
      throw regularFileCaptureError(`The delivered artifact changed while ${command} was running`, artifactVerification);
    }

    receipt.containment.viewports = VISUAL_CHECK_VIEWPORTS.map(({ width, height }) => (
      observations.get(screenshotKey(width, height, 'light'))
    ));
    receipt.readability.viewports = receipt.containment.viewports.map((entry) => ({ ...entry }));
    receipt.viewerChrome.viewports = receipt.containment.viewports.map((entry) => ({ ...entry }));
    receipt.captures.screenshots = outputs.screenshots.map((entry) => ({
      ...observations.get(screenshotKey(entry.width, entry.height, entry.theme)),
      file: path.basename(entry.path),
    }));
    const allObservations = [...observations.values()];
    receipt.themeStates.viewports = allObservations.map((entry) => ({
      width: entry.width,
      height: entry.height,
      requestedTheme: entry.theme,
      resolvedTheme: entry.resolvedTheme,
      ok: entry.resolvedTheme === entry.theme,
    }));
    const themeStatePass = receipt.themeStates.viewports.every(entry => entry.ok);
    const containmentPass = allObservations.every((entry) => entry.ok);
    const readabilityPass = receipt.readability.viewports.every((entry) => entry.readabilityOk);
    const viewerChromePass = allObservations.every((entry) => entry.viewerChromeOk);
    receipt.diagnostics = observationDiagnostics({
      artifact,
      allObservations,
      readabilityObservations: receipt.readability.viewports, command,
    });
    receipt.themeStates.status = themeStatePass ? 'pass' : 'fail';
    receipt.containment.status = containmentPass ? 'pass' : 'fail';
    receipt.readability.status = readabilityPass ? 'pass' : 'fail';
    receipt.viewerChrome.status = viewerChromePass ? 'pass' : 'fail';
    if (capture) {
      receipt.captures.status = 'pass';
      receipt.captures.contactSheet = path.basename(outputs.contactSheet);
    }
    receipt.status = containmentPass && themeStatePass && readabilityPass && viewerChromePass ? 'pass' : 'fail';
    receipt.ok = containmentPass && themeStatePass && readabilityPass && viewerChromePass;
    if (capture) writeStagedEvidence(ownership, outputs.contactSheet, contactSheetHtml({
      artifactPath: artifact,
      receipt,
      screenshots: receipt.captures.screenshots,
    }));
    recordVisualEvidenceFiles(receipt, outputs, ownership);
    writeStagedEvidence(ownership, outputs.receipt, `${JSON.stringify(receipt, null, 2)}\n`);
    const publication = commitVisualEvidence(
      artifact,
      outputs,
      ownership,
      visualEvidenceTargets(outputs).map((target) => target.path),
    );
    if (!publication.ok) {
      appendEvidencePublicationFailure(receipt, publication);
      receipt.ok = false;
      receipt.status = 'fail';
      return { exitCode: EXIT.fail, receipt };
    }
    publishedBrowserEvidenceReceipts.add(receipt);
    if (appendEvidenceCleanupWarning(receipt, publication)) {
      return { exitCode: EXIT.fail, receipt };
    }
    return { exitCode: receipt.ok ? EXIT.pass : EXIT.fail, receipt };
  } catch (error) {
    const startupTimeout = error.code === 'ERR_CHROME_CDP_TIMEOUT'
      && error.method === 'Target.getTargets';
    receipt.status = 'fail';
    receipt.ok = false;
    receipt.error = error.message;
    receipt.containment.status = 'fail';
    receipt.readability.status = 'fail';
    receipt.viewerChrome.status = 'fail';
    receipt.themeStates.status = 'fail';
    receipt.captures.status = capture ? 'fail' : 'not-requested';
    receipt.captures.screenshots = [];
    receipt.captures.contactSheet = null;
    if (error.deliveryProvenance) receipt.provenance = error.deliveryProvenance.status;
    receipt.diagnostics = error.archifyDiagnostics || [failureDiagnostic({
      code: startupTimeout ? 'viewer/chrome-startup-timeout' : `viewer/${command}-runtime`,
      message: startupTimeout
        ? 'Chrome did not finish its initial DevTools handshake within the startup window.'
        : `${command} could not complete its Chrome inspection.`,
      subject: { artifact },
      evidence: { reason: error.message },
      supportedFixes: startupTimeout
        ? [
          'do not edit or simplify the artifact because this is a browser-startup failure',
          `retry ${command} once after host load subsides; if it repeats, stop and report the environment failure`,
        ]
        : [`resolve the reported Chrome inspection error, then rerun ${command}`],
    })];
    return {
      exitCode: EXIT.fail,
      receipt: persistBrowserEvidenceFailure(artifact, receipt, {
        outDir,
        compareSidecarParents,
        ownership, command, capture,
      }),
    };
  } finally {
    if (browser?.close) await browser.close();
  }
  } finally {
    releaseRegularFileBinding(capturedArtifact.binding);
  }
}

export function persistVisualCheckFailure(artifactPath, failure, options = {}) {
  return persistBrowserEvidenceFailure(artifactPath, failure, { ...options, command: 'visual-check', capture: true });
}
export function persistBrowserCheckFailure(artifactPath, failure, options = {}) {
  return persistBrowserEvidenceFailure(artifactPath, failure, { ...options, command: 'browser-check', capture: false });
}
export function runVisualCheck(options = {}) {
  return runBrowserEvidence({ ...options, command: 'visual-check', capture: true });
}
export function runBrowserCheck(options = {}) {
  return runBrowserEvidence({ ...options, command: 'browser-check', capture: false });
}
