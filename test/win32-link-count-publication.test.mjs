import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  backupPublicRegularFileBinding,
  captureRegularFileBinding,
  quarantineRemoveRegularFileBinding,
  releaseRegularFileBinding,
  verifyRegularFileBinding,
} from '../archify/renderers/shared/atomic-output.mjs';

// Win32 keeps reporting the old link count on the surviving name after a hard
// link is removed, so a file this module linked and retired still looks
// hard-linked when it is verified afterwards. These regressions pin the two
// halves of the contract: post-publication verification tolerates the inflated
// count, and inspection of a pre-existing entry keeps failing closed.
//
// The tests build the inflation with a real `linkSync` + `unlinkSync` pair
// rather than mocking `fstatSync`, so they exercise the platform behaviour the
// fix exists for. On platforms that decrement the count correctly the same
// sequence is a no-op and the assertions still hold.

const inflated = process.platform === 'win32';

function workspace(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Give `filePath` a link count that overstates the number of remaining names.
 * Creating a second name and removing it is the exact sequence the publisher
 * performs, and on Win32 it leaves the survivor reporting one link too many. */
function inflateLinkCount(filePath) {
  const alias = `${filePath}.inflate`;
  fs.linkSync(filePath, alias);
  fs.unlinkSync(alias);
}

function observedLinkCount(filePath) {
  return fs.lstatSync(filePath, { bigint: true }).nlink;
}

test('a verified name keeps matching after its link count is inflated', (t) => {
  const root = workspace(t, 'archify-win32-linkcount-verify-');
  const target = path.join(root, 'artifact.html');
  fs.writeFileSync(target, 'payload\n');

  const captured = captureRegularFileBinding(target, { subject: 'win32-linkcount' });
  assert.equal(captured.status, 'captured');
  try {
    inflateLinkCount(target);
    const inflatedCount = observedLinkCount(target);
    if (!inflated) {
      // A platform that decrements correctly leaves a single name behind.
      assert.equal(inflatedCount, 1n);
    }

    const verified = verifyRegularFileBinding(captured.binding, {
      filePath: target,
      expectedLinks: 1,
    });
    assert.equal(verified.status, 'match');
  } finally {
    releaseRegularFileBinding(captured.binding);
  }
});

test('inspection of a pre-existing entry still fails closed on an inflated count', (t) => {
  const root = workspace(t, 'archify-win32-linkcount-inspect-');
  const target = path.join(root, 'existing.html');
  fs.writeFileSync(target, 'payload\n');
  // Inflate before capture, so the entry is inspected the way an entry the
  // caller did not create would be. Only meaningful where the count inflates;
  // elsewhere a truthful count makes this an ordinary successful capture.
  inflateLinkCount(target);
  const inflatedCount = observedLinkCount(target);

  const captured = captureRegularFileBinding(target, { subject: 'win32-linkcount' });
  if (!inflated) {
    assert.equal(inflatedCount, 1n);
    assert.equal(captured.status, 'captured');
    releaseRegularFileBinding(captured.binding);
    return;
  }

  // The count overstates the real number of names, so the entry is treated as a
  // possible hard-link redirection and refused. Relaxing this would drop the
  // guard that `a hardlinked existing output is rejected before staging` covers.
  assert.equal(captured.status, 'unsupported');
  assert.equal(captured.reason.code, 'win32-linkcount-hardlinked');
  assert.equal(captured.reason.links, '2');
});

test('a backup keeps its identity when the bound file reports an inflated count', (t) => {
  const root = workspace(t, 'archify-win32-linkcount-backup-');
  const target = path.join(root, 'artifact.html');
  const backup = path.join(root, '.previous-artifact');
  fs.writeFileSync(target, 'previous\n');

  const captured = captureRegularFileBinding(target, { subject: 'win32-linkcount' });
  assert.equal(captured.status, 'captured');
  try {
    const moved = backupPublicRegularFileBinding(captured.binding, target, backup, {
      subject: 'win32-linkcount',
    });
    assert.equal(moved.status, 'backed-up');
    assert.equal(moved.backupCreated, true);
    assert.equal(moved.backupVerified, true);
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.readFileSync(backup, 'utf8'), 'previous\n');
    const verified = verifyRegularFileBinding(captured.binding, {
      filePath: backup,
      expectedLinks: 1,
    });
    assert.equal(verified.status, 'match');
  } finally {
    releaseRegularFileBinding(captured.binding);
  }
});

test('quarantine removal restores a displaced name despite an inflated count', (t) => {
  const root = workspace(t, 'archify-win32-linkcount-quarantine-');
  const target = path.join(root, 'public.lock');
  const displacedOwner = path.join(root, 'displaced-owner');
  fs.writeFileSync(target, 'owned\n');

  const captured = captureRegularFileBinding(target, { subject: 'win32-linkcount' });
  assert.equal(captured.status, 'captured');
  const renameSync = fs.renameSync;
  let injected = false;
  t.mock.method(fs, 'renameSync', (source, destination) => {
    if (!injected && source === target
      && path.basename(path.dirname(destination)).startsWith('.archify-remove-')) {
      injected = true;
      renameSync(target, displacedOwner);
      fs.writeFileSync(target, 'successor\n', { flag: 'wx' });
    }
    return renameSync(source, destination);
  });
  try {
    const removed = quarantineRemoveRegularFileBinding(captured.binding, target, {
      subject: 'win32-linkcount',
    });
    // The successor must be handed back to the caller rather than deleted, and
    // the restore must recognise its own displaced name through dev+ino even
    // when the restored link count is inflated.
    assert.equal(injected, true);
    assert.equal(removed.status, 'preserved');
    assert.equal(fs.readFileSync(target, 'utf8'), 'successor\n');
    assert.equal(fs.readFileSync(displacedOwner, 'utf8'), 'owned\n');
    assert.deepEqual(
      fs.readdirSync(root).filter((entry) => entry.startsWith('.archify-remove-')),
      [],
    );
  } finally {
    releaseRegularFileBinding(captured.binding);
  }
});
