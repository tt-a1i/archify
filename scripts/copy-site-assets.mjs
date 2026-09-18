import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  backupPublicRegularFileBinding,
  captureAtomicOutput,
  captureRegularFileBinding,
  quarantineRemoveRegularFileBinding,
  releaseRegularFileBinding,
  removeOwnedRegularFile,
  verifyAtomicOutput,
  verifyRegularFileBinding,
} from '../archify/renderers/shared/atomic-output.mjs';
import { containedBy, sameLocation } from '../archify/renderers/shared/path-semantics.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(__dirname, '../docs/assets');
const SITE_ASSETS = Object.freeze([
  'site-language.js',
  'site-navigation.css',
]);

function publicationError(asset, state) {
  const reason = state?.reason || state;
  return new Error(`Cannot safely publish site asset "${asset}" (${reason?.code || 'indeterminate'}).`, {
    cause: reason,
  });
}

function stageSiteAsset(source, commitPath, mode) {
  const content = fs.readFileSync(source);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidatePath = path.join(
      path.dirname(commitPath),
      `.${path.basename(commitPath)}.archify-${randomBytes(16).toString('hex')}.tmp`,
    );
    let descriptor;
    let identity;
    try {
      const noFollow = process.platform === 'win32' ? 0 : (fs.constants.O_NOFOLLOW || 0);
      descriptor = fs.openSync(
        candidatePath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
        mode ?? 0o666,
      );
      let metadata;
      try {
        metadata = fs.fstatSync(descriptor, { bigint: true });
      } catch (error) {
        try {
          const retry = fs.fstatSync(descriptor, { bigint: true });
          if (retry.isFile() && retry.ino !== 0n) {
            identity = { device: retry.dev, inode: retry.ino };
          }
        } catch {}
        throw error;
      }
      if (!metadata.isFile() || metadata.ino === 0n) {
        throw new Error('Temporary site asset identity could not be verified safely.');
      }
      identity = { device: metadata.dev, inode: metadata.ino };
      fs.writeFileSync(descriptor, content);
      if (mode !== null) fs.fchmodSync(descriptor, mode);
      fs.closeSync(descriptor);
      descriptor = undefined;
      return { candidatePath, identity };
    } catch (error) {
      if (descriptor !== undefined) {
        try { fs.closeSync(descriptor); } catch {}
      }
      if (error?.code === 'EEXIST') continue;
      if (identity) removeOwnedRegularFile(candidatePath, identity, { subject: 'site-asset-candidate' });
      throw error;
    }
  }
  throw Object.assign(new Error(`Could not reserve a temporary site asset beside "${commitPath}".`), {
    code: 'EEXIST',
  });
}

function removeBoundSiteCandidate(item, expectedLinks) {
  const removed = quarantineRemoveRegularFileBinding(
    item.candidateBinding,
    item.candidatePath,
    { subject: 'site-asset-candidate', expectedLinks },
  );
  if (removed.status === 'removed' || removed.status === 'preserved') return removed;

  // An in-place mutation still belongs to the inode we created. Rebind its
  // current bytes by expected identity so quarantine cleanup remains race-safe
  // without treating a replacement path claimant as ours.
  const rebound = captureRegularFileBinding(item.candidatePath, {
    subject: 'mutated-site-asset-candidate',
    expectedIdentity: item.candidateIdentity,
    expectedLinks,
  });
  if (rebound.status !== 'captured') return removed;
  try {
    return quarantineRemoveRegularFileBinding(
      rebound.binding,
      item.candidatePath,
      { subject: 'mutated-site-asset-candidate', expectedLinks },
    );
  } finally {
    releaseRegularFileBinding(rebound.binding);
  }
}

export function copySiteAssets(outputHtmlPath) {
  const requestedOutputParent = path.dirname(path.resolve(outputHtmlPath));
  fs.mkdirSync(requestedOutputParent, { recursive: true });
  const outputParent = fs.realpathSync.native(requestedOutputParent);
  const targetRoot = path.join(outputParent, 'assets');
  try {
    fs.mkdirSync(targetRoot);
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  const assetsEntry = fs.lstatSync(targetRoot, { bigint: true });
  if (assetsEntry.isSymbolicLink() || !assetsEntry.isDirectory()) {
    throw new Error('Site assets directory must be a physical directory, not a symbolic link or special entry.');
  }
  const containment = containedBy(outputParent, targetRoot);
  if (containment.status !== 'match') {
    throw new Error('Site assets directory is not physically contained by the output directory.', {
      cause: containment.reason,
    });
  }

  const publications = [];
  for (const asset of SITE_ASSETS) {
    const source = path.join(sourceRoot, asset);
    const target = path.join(targetRoot, asset);
    const capture = captureAtomicOutput(target, {
      requestedEntryPolicy: 'regular-or-absent',
    });
    if (capture.status !== 'captured') {
      throw publicationError(asset, capture);
    }
    if (capture.snapshot.slot.parentDevice !== assetsEntry.dev
      || capture.snapshot.slot.parentInode !== assetsEntry.ino) {
      throw new Error(`Cannot safely publish site asset "${asset}" (assets-directory-changed).`);
    }
    const relation = sameLocation(source, capture.commitPath);
    if (relation.status === 'match') continue;
    if (relation.status === 'unknown') {
      throw new Error(`Cannot determine whether site asset source and target alias: ${asset}`, {
        cause: relation.reason,
      });
    }
    publications.push({ asset, source, capture });
  }

  const backedUp = [];
  const committed = [];
  let publicationsFinalized = false;
  let failure;
  try {
    // Stage and bind the full pair before moving either public name. A held
    // descriptor remains the authority for each candidate throughout commit.
    for (const item of publications) {
      const staged = stageSiteAsset(item.source, item.capture.commitPath, item.capture.mode);
      item.candidatePath = staged.candidatePath;
      item.candidateIdentity = staged.identity;
      const candidate = captureRegularFileBinding(item.candidatePath, {
        subject: 'site-asset-candidate',
        expectedIdentity: item.candidateIdentity,
        ...(item.capture.mode === null ? {} : { expectedMode: item.capture.mode }),
      });
      if (candidate.status !== 'captured') throw publicationError(item.asset, candidate);
      item.candidateBinding = candidate.binding;
      item.candidatePresent = true;

      if (item.capture.snapshot.target.kind === 'file') {
        const expected = item.capture.snapshot.target;
        const previous = captureRegularFileBinding(item.capture.commitPath, {
          subject: 'previous-site-asset-target',
          expectedIdentity: { device: expected.device, inode: expected.inode },
          expectedMode: expected.mode,
          expectedLinks: 1,
        });
        if (previous.status !== 'captured') throw publicationError(item.asset, previous);
        item.previousBinding = previous.binding;
        item.backupPath = path.join(
          targetRoot,
          `.archify-site-backup-${randomBytes(16).toString('hex')}.tmp`,
        );
      }
    }

    for (const item of publications) {
      const targetVerification = verifyAtomicOutput(item.capture.snapshot);
      if (targetVerification.status !== 'match') {
        throw publicationError(item.asset, targetVerification);
      }
      const candidateVerification = verifyRegularFileBinding(item.candidateBinding, {
        filePath: item.candidatePath,
        expectedLinks: 1,
      });
      if (candidateVerification.status !== 'match') {
        throw publicationError(item.asset, candidateVerification);
      }
    }

    // Existing targets remain recoverable by identity until both new assets
    // have been published and verified.
    for (const item of publications) {
      if (!item.previousBinding) continue;
      const backup = backupPublicRegularFileBinding(
        item.previousBinding,
        item.capture.commitPath,
        item.backupPath,
        { subject: 'previous-site-asset-target' },
      );
      item.backupPresent = backup.backupCreated === true;
      item.backupVerified = backup.backupVerified === true;
      if (item.backupPresent) backedUp.push(item);
      if (backup.status !== 'backed-up') throw publicationError(item.asset, backup);
    }

    for (const item of publications) {
      const candidateVerification = verifyRegularFileBinding(item.candidateBinding, {
        filePath: item.candidatePath,
        expectedLinks: 1,
      });
      if (candidateVerification.status !== 'match') {
        throw publicationError(item.asset, candidateVerification);
      }
      try {
        // A no-clobber hard link makes an after-preflight target claimant win
        // instead of being overwritten. The binding proves which inode was
        // linked while it remains open through the complete pair commit.
        fs.linkSync(item.candidatePath, item.capture.commitPath);
      } catch (error) {
        throw publicationError(item.asset, {
          code: error?.code === 'EEXIST'
            ? 'site-asset-target-claimed-during-publish'
            : 'site-asset-publish-failed',
          systemCode: error?.code,
        });
      }
      item.committed = true;
      committed.push(item);
      const linked = verifyRegularFileBinding(item.candidateBinding, {
        filePath: item.capture.commitPath,
        expectedLinks: 2,
      });
      if (linked.status !== 'match') throw publicationError(item.asset, linked);
    }

    for (const item of committed) {
      const removed = removeBoundSiteCandidate(item, 2);
      if (removed.status !== 'removed') throw publicationError(item.asset, removed);
      item.candidatePresent = false;
      const finalized = verifyRegularFileBinding(item.candidateBinding, {
        filePath: item.capture.commitPath,
        expectedLinks: 1,
      });
      if (finalized.status !== 'match') throw publicationError(item.asset, finalized);
    }

    // From this point on the new pair is complete and independently bound at
    // both public names. Retiring old backups is cleanup, not part of a
    // rollback-capable phase: a cleanup failure may already have moved one old
    // backup into quarantine, so removing the committed pair would create a
    // public hole that cannot be restored from the stale backup pathname.
    publicationsFinalized = true;

    for (const item of backedUp) {
      const removed = quarantineRemoveRegularFileBinding(
        item.previousBinding,
        item.backupPath,
        { subject: 'previous-site-asset-target', expectedLinks: 1 },
      );
      if (removed.status !== 'removed') throw publicationError(item.asset, removed);
      item.backupPresent = false;
    }
  } catch (error) {
    failure = error;
    if (publicationsFinalized) throw error;
    const rollbackErrors = [];
    for (const item of [...committed].reverse()) {
      const expectedLinks = item.candidatePresent ? 2 : 1;
      const removed = quarantineRemoveRegularFileBinding(
        item.candidateBinding,
        item.capture.commitPath,
        { subject: 'published-site-asset', expectedLinks },
      );
      if (removed.status !== 'removed') {
        rollbackErrors.push(`${item.asset}: remove failed (${removed.reason?.code || removed.status})`);
      } else {
        item.committed = false;
      }
    }
    for (const item of [...backedUp].reverse()) {
      if (!item.backupPresent || item.committed) continue;
      const backup = verifyRegularFileBinding(item.previousBinding, {
        filePath: item.backupPath,
        expectedLinks: 1,
      });
      if (backup.status !== 'match') {
        rollbackErrors.push(`${item.asset}: backup changed (${backup.reason?.code || backup.status})`);
        continue;
      }
      try {
        fs.linkSync(item.backupPath, item.capture.commitPath);
      } catch (restoreError) {
        rollbackErrors.push(`${item.asset}: restore failed (${restoreError.code || restoreError.message})`);
        continue;
      }
      const restored = verifyRegularFileBinding(item.previousBinding, {
        filePath: item.capture.commitPath,
        expectedLinks: 2,
      });
      if (restored.status !== 'match') {
        rollbackErrors.push(`${item.asset}: restore changed (${restored.reason?.code || restored.status})`);
        continue;
      }
      const removedBackup = quarantineRemoveRegularFileBinding(
        item.previousBinding,
        item.backupPath,
        { subject: 'previous-site-asset-target', expectedLinks: 2 },
      );
      if (removedBackup.status !== 'removed') {
        rollbackErrors.push(`${item.asset}: backup cleanup failed (${removedBackup.reason?.code || removedBackup.status})`);
        continue;
      }
      item.backupPresent = false;
      const finalized = verifyRegularFileBinding(item.previousBinding, {
        filePath: item.capture.commitPath,
        expectedLinks: 1,
      });
      if (finalized.status !== 'match') {
        rollbackErrors.push(`${item.asset}: restore finalization failed (${finalized.reason?.code || finalized.status})`);
      }
    }
    if (rollbackErrors.length) {
      throw new AggregateError([error], `Site asset transaction requires recovery: ${rollbackErrors.join('; ')}`);
    }
    throw error;
  } finally {
    for (const item of publications) {
      if (item.candidateBinding && item.candidatePresent) {
        const expectedLinks = item.committed ? 2 : 1;
        const cleanup = removeBoundSiteCandidate(item, expectedLinks);
        if (!failure && cleanup.status !== 'removed' && cleanup.status !== 'preserved') {
          failure = publicationError(item.asset, cleanup);
        }
      } else if (item.candidatePath && item.candidateIdentity) {
        const cleanup = removeOwnedRegularFile(item.candidatePath, item.candidateIdentity, {
          subject: 'site-asset-candidate',
        });
        if (!failure && !['removed', 'absent', 'preserved'].includes(cleanup.status)) {
          failure = publicationError(item.asset, cleanup);
        }
      }
      if (item.candidateBinding) releaseRegularFileBinding(item.candidateBinding);
      if (item.previousBinding) releaseRegularFileBinding(item.previousBinding);
    }
    if (!failure) {
      for (const item of backedUp) {
        if (!item.backupPresent) continue;
        const cleanup = removeOwnedRegularFile(item.backupPath, {
          device: item.capture.snapshot.target.device,
          inode: item.capture.snapshot.target.inode,
        }, { subject: 'previous-site-asset-target' });
        if (!['removed', 'absent', 'preserved'].includes(cleanup.status)) {
          failure = publicationError(item.asset, cleanup);
        }
      }
    }
  }
  if (failure) throw failure;
}
