import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  captureAtomicOutput,
  captureRegularFileBinding,
  publishRegularFileBinding,
  recoverRetiredPublication,
  releaseRegularFileBinding,
} from '../renderers/shared/atomic-output.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const atomicOutput = path.join(skillRoot, 'renderers/shared/atomic-output.mjs');
const recoveryCli = path.join(skillRoot, 'bin/recover-output.mjs');

function workspace(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function recoveryDirectory(parent) {
  const matches = fs.readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('.archify-remove-'));
  assert.equal(matches.length, 1, `expected one recovery directory in ${parent}`);
  return path.join(parent, matches[0].name);
}

function crashPublisher({ output, candidate, phase }) {
  const script = `
    import fs from 'node:fs';
    import {
      captureAtomicOutput,
      captureRegularFileBinding,
      publishRegularFileBinding,
    } from ${JSON.stringify(atomicOutput)};

    const output = process.env.ARCHIFY_RECOVERY_OUTPUT;
    const candidatePath = process.env.ARCHIFY_RECOVERY_CANDIDATE;
    const snapshot = captureAtomicOutput(output);
    if (snapshot.status !== 'captured') throw new Error(JSON.stringify(snapshot));
    const candidate = captureRegularFileBinding(candidatePath, { subject: 'crash-candidate' });
    if (candidate.status !== 'captured') throw new Error(JSON.stringify(candidate));
    const linkSync = fs.linkSync.bind(fs);
    fs.linkSync = (source, target) => {
      if (source === candidatePath && target === snapshot.commitPath) {
        if (process.env.ARCHIFY_RECOVERY_PHASE === 'after-link') {
          linkSync(source, target);
        }
        process.kill(process.pid, 'SIGKILL');
      }
      return linkSync(source, target);
    };
    publishRegularFileBinding(candidate.binding, candidatePath, snapshot.snapshot, { subject: 'crash-candidate' });
  `;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      ARCHIFY_RECOVERY_OUTPUT: output,
      ARCHIFY_RECOVERY_CANDIDATE: candidate,
      ARCHIFY_RECOVERY_PHASE: phase,
    },
  });
}

function crashRecoveryAfterLink(directory) {
  const script = `
    import fs from 'node:fs';
    import { recoverRetiredPublication } from ${JSON.stringify(atomicOutput)};

    const linkSync = fs.linkSync.bind(fs);
    fs.linkSync = (source, target) => {
      const result = linkSync(source, target);
      if (path.basename(source) === 'previous' && path.basename(target) === 'diagram.html') {
        process.kill(process.pid, 'SIGKILL');
      }
      return result;
    };
    recoverRetiredPublication(process.env.ARCHIFY_RECOVERY_DIRECTORY);
  `;
  return spawnSync(process.execPath, ['--input-type=module', '--eval', `import path from 'node:path';${script}`], {
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_RECOVERY_DIRECTORY: directory },
  });
}

function runRecovery(directory) {
  const result = spawnSync(process.execPath, [recoveryCli, directory, '--json'], {
    encoding: 'utf8',
  });
  return {
    ...result,
    body: result.stdout ? JSON.parse(result.stdout) : undefined,
  };
}

test('recovery CLI help is successful and unknown options do not name a recovery directory', () => {
  for (const option of ['--help', '-h']) {
    const result = spawnSync(process.execPath, [recoveryCli, option], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Usage: node bin\/recover-output\.mjs/m);
    assert.equal(result.stderr, '');
  }

  const result = spawnSync(process.execPath, [recoveryCli, '--unexpected-option'], {
    encoding: 'utf8',
  });
  assert.equal(result.status, 64, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^Usage: node bin\/recover-output\.mjs/m);
});

function portableRecoveryFixture(t) {
  const root = workspace(t, 'archify-portable-publication-recovery-');
  const output = path.join(root, 'diagram.html');
  const recovery = path.join(root, `.archify-remove-${'a'.repeat(32)}`);
  const backup = path.join(recovery, 'previous');
  const recordPath = path.join(recovery, 'publication-recovery-v1.json');
  const previous = 'portable previous artifact\n';
  const targetSnapshot = captureAtomicOutput(output);
  assert.equal(targetSnapshot.status, 'captured');
  fs.mkdirSync(recovery, { mode: 0o700 });
  fs.writeFileSync(backup, previous);
  const backupMetadata = fs.lstatSync(backup, { bigint: true });
  const recoveryMetadata = fs.lstatSync(recovery, { bigint: true });
  const record = {
    version: 1,
    kind: 'archify-retired-output-recovery',
    backup: {
      name: 'previous',
      sha256: createHash('sha256').update(previous).digest('hex'),
      bytes: Buffer.byteLength(previous),
      mode: Number(backupMetadata.mode & 0o777n),
      device: backupMetadata.dev.toString(),
      inode: backupMetadata.ino.toString(),
    },
    recovery: {
      name: path.basename(recovery),
      device: recoveryMetadata.dev.toString(),
      inode: recoveryMetadata.ino.toString(),
    },
    target: {
      requestedPath: targetSnapshot.snapshot.requestedPath,
      requestedEntryPolicy: targetSnapshot.snapshot.requestedEntryPolicy,
      requestedEntry: targetSnapshot.snapshot.requestedEntry,
      commitPath: targetSnapshot.snapshot.slot.commitPath,
      parentPath: targetSnapshot.snapshot.slot.parentPath,
      parentDevice: targetSnapshot.snapshot.slot.parentDevice.toString(),
      parentInode: targetSnapshot.snapshot.slot.parentInode.toString(),
      name: targetSnapshot.snapshot.slot.name,
    },
  };
  fs.writeFileSync(recordPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  return { output, recovery, backup, previous };
}

function interruptedReplacement(t, { phase = 'before-link', throughAlias = false } = {}) {
  if (process.platform === 'win32') {
    t.skip('SIGKILL recovery regression is POSIX-only');
    return null;
  }
  const root = workspace(t, 'archify-publication-recovery-');
  const actualParent = throughAlias ? path.join(root, 'actual') : root;
  if (throughAlias) fs.mkdirSync(actualParent);
  const requestedParent = throughAlias ? path.join(root, 'alias') : actualParent;
  if (throughAlias) fs.symlinkSync(actualParent, requestedParent, 'dir');
  const output = path.join(requestedParent, 'diagram.html');
  const candidate = path.join(actualParent, '.archify-render-candidate');
  const previous = '<!doctype html><title>previous trusted artifact</title>\n';
  const next = '<!doctype html><title>new candidate artifact</title>\n';
  fs.writeFileSync(output, previous);
  fs.writeFileSync(candidate, next);
  const crashed = crashPublisher({ output, candidate, phase });
  assert.equal(crashed.signal, 'SIGKILL', crashed.stderr);
  return {
    root,
    actualParent,
    requestedParent,
    output,
    candidate,
    previous,
    next,
    recovery: recoveryDirectory(actualParent),
  };
}

test('an actual killed publisher after old-name retirement restores only its bound previous output', (t) => {
  const interrupted = interruptedReplacement(t);
  if (!interrupted) return;
  const { output, candidate, previous, next, recovery } = interrupted;
  assert.equal(fs.existsSync(output), false);
  assert.equal(fs.readFileSync(path.join(recovery, 'previous'), 'utf8'), previous);
  assert.equal(fs.lstatSync(path.join(recovery, 'publication-recovery-v1.json')).nlink, 1);
  assert.equal(fs.statSync(recovery).mode & 0o077, 0);

  const recovered = runRecovery(recovery);
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(recovered.body.status, 'recovered');
  assert.equal(fs.readFileSync(output, 'utf8'), previous);
  assert.equal(fs.readFileSync(candidate, 'utf8'), next);
  assert.equal(fs.existsSync(recovery), false);

  const repeated = runRecovery(recovery);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.equal(repeated.body.status, 'absent');
});

test('the explicit recovery consumer accepts a bound portable fixture and preserves a claimant', (t) => {
  const recoverable = portableRecoveryFixture(t);
  const restored = runRecovery(recoverable.recovery);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(restored.body.status, 'recovered');
  assert.equal(fs.readFileSync(recoverable.output, 'utf8'), recoverable.previous);

  const claimed = portableRecoveryFixture(t);
  fs.writeFileSync(claimed.output, 'new public claimant\n', { flag: 'wx' });
  const preserved = runRecovery(claimed.recovery);
  assert.equal(preserved.status, 2, preserved.stderr);
  assert.equal(preserved.body.status, 'preserved');
  assert.equal(preserved.body.reason.code, 'publication-recovery-target-present');
  assert.equal(fs.readFileSync(claimed.output, 'utf8'), 'new public claimant\n');
  assert.equal(fs.readFileSync(claimed.backup, 'utf8'), claimed.previous);
});

test('a process killed after the recovery link preserves both public bytes and recovery evidence', (t) => {
  if (process.platform === 'win32') {
    t.skip('SIGKILL recovery-interruption regression is POSIX-only');
    return;
  }
  const fixture = portableRecoveryFixture(t);
  const crashed = crashRecoveryAfterLink(fixture.recovery);
  assert.equal(crashed.signal, 'SIGKILL', crashed.stderr);
  assert.equal(fs.readFileSync(fixture.output, 'utf8'), fixture.previous);
  assert.equal(fs.readFileSync(fixture.backup, 'utf8'), fixture.previous);
  assert.equal(fs.existsSync(path.join(fixture.recovery, 'publication-recovery-v1.json')), true);

  const repeated = runRecovery(fixture.recovery);
  assert.equal(repeated.status, 2, repeated.stderr);
  assert.equal(repeated.body.status, 'preserved');
  assert.equal(repeated.body.reason.code, 'publication-recovery-target-present');
});

test('explicit recovery preserves a new public claimant and remains repeatable', (t) => {
  const interrupted = interruptedReplacement(t);
  if (!interrupted) return;
  const { output, previous, recovery } = interrupted;
  fs.writeFileSync(output, 'new claimant\n', { flag: 'wx' });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = runRecovery(recovery);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.body.status, 'preserved');
    assert.match(result.body.reason.code, /target-present|target-created/);
    assert.equal(fs.readFileSync(output, 'utf8'), 'new claimant\n');
    assert.equal(fs.readFileSync(path.join(recovery, 'previous'), 'utf8'), previous);
  }
});

test('recovery refuses a tampered record or backup without recreating the public name', (t) => {
  const recordInterrupted = interruptedReplacement(t);
  if (!recordInterrupted) return;
  const recordPath = path.join(recordInterrupted.recovery, 'publication-recovery-v1.json');
  fs.writeFileSync(recordPath, '{"untrusted":true}\n');
  const recordResult = runRecovery(recordInterrupted.recovery);
  assert.equal(recordResult.status, 1, recordResult.stderr);
  assert.equal(fs.existsSync(recordInterrupted.output), false);
  assert.equal(fs.existsSync(path.join(recordInterrupted.recovery, 'previous')), true);

  const backupInterrupted = interruptedReplacement(t);
  const backupPath = path.join(backupInterrupted.recovery, 'previous');
  fs.writeFileSync(backupPath, 'tampered backup\n');
  const backupResult = runRecovery(backupInterrupted.recovery);
  assert.equal(backupResult.status, 1, backupResult.stderr);
  assert.equal(fs.existsSync(backupInterrupted.output), false);
  assert.equal(fs.readFileSync(backupPath, 'utf8'), 'tampered backup\n');
});

test('recovery refuses a replaced directory alias even while the former target is absent', (t) => {
  const interrupted = interruptedReplacement(t, { throughAlias: true });
  if (!interrupted) return;
  const replacement = path.join(interrupted.root, 'replacement');
  fs.mkdirSync(replacement);
  fs.unlinkSync(interrupted.requestedParent);
  fs.symlinkSync(replacement, interrupted.requestedParent, 'dir');

  const result = runRecovery(interrupted.recovery);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.body.status, 'different');
  assert.match(result.body.reason.code, /slot-changed/);
  assert.equal(fs.existsSync(path.join(replacement, 'diagram.html')), false);
  assert.equal(fs.readFileSync(path.join(interrupted.recovery, 'previous'), 'utf8'), interrupted.previous);
});

test('recovery record is bound to its generated direct-parent directory identity', (t) => {
  const copied = interruptedReplacement(t);
  if (!copied) return;
  const copiedDirectory = path.join(
    copied.actualParent,
    `.archify-remove-${'1'.repeat(32)}`,
  );
  fs.cpSync(copied.recovery, copiedDirectory, { recursive: true });
  fs.chmodSync(copiedDirectory, 0o700);
  const copiedResult = runRecovery(copiedDirectory);
  assert.equal(copiedResult.status, 1, copiedResult.stderr);
  assert.equal(copiedResult.body.status, 'different');
  assert.equal(copiedResult.body.reason.code, 'publication-recovery-directory-not-target-child');
  assert.equal(fs.existsSync(copied.output), false);

  const replaced = interruptedReplacement(t);
  const replacementDirectory = path.join(replaced.root, 'replacement-directory');
  fs.cpSync(replaced.recovery, replacementDirectory, { recursive: true });
  fs.chmodSync(replacementDirectory, 0o700);
  fs.rmSync(replaced.recovery, { recursive: true, force: true });
  fs.renameSync(replacementDirectory, replaced.recovery);
  const replacedResult = runRecovery(replaced.recovery);
  assert.equal(replacedResult.status, 1, replacedResult.stderr);
  assert.equal(replacedResult.body.status, 'different');
  assert.equal(replacedResult.body.reason.code, 'publication-recovery-directory-identity-changed');
  assert.equal(fs.existsSync(replaced.output), false);

  const moved = interruptedReplacement(t);
  const foreignParent = path.join(moved.root, 'foreign');
  fs.mkdirSync(foreignParent);
  const movedDirectory = path.join(foreignParent, path.basename(moved.recovery));
  fs.renameSync(moved.recovery, movedDirectory);
  const movedResult = runRecovery(movedDirectory);
  assert.equal(movedResult.status, 1, movedResult.stderr);
  assert.equal(movedResult.body.status, 'different');
  assert.equal(movedResult.body.reason.code, 'publication-recovery-directory-not-target-child');
  assert.equal(fs.existsSync(moved.output), false);
});

test('a parent swap during recovery linking removes only the positively identified new alias', (t) => {
  if (process.platform === 'win32') {
    t.skip('directory rename with live POSIX descriptors regression');
    return;
  }
  const fixture = portableRecoveryFixture(t);
  const displacedRoot = `${path.dirname(fixture.output)}-displaced`;
  const originalLink = fs.linkSync;
  let swapped = false;
  t.after(() => fs.rmSync(displacedRoot, { recursive: true, force: true }));
  t.mock.method(fs, 'linkSync', (source, target, ...args) => {
    if (!swapped && path.basename(String(source)) === 'previous'
      && path.basename(String(target)) === 'diagram.html') {
      swapped = true;
      const parent = path.dirname(fixture.output);
      fs.renameSync(parent, displacedRoot);
      fs.mkdirSync(parent);
      const fakeRecovery = path.join(parent, path.basename(fixture.recovery));
      fs.mkdirSync(fakeRecovery, { mode: 0o700 });
      fs.writeFileSync(path.join(fakeRecovery, 'previous'), 'untrusted replacement\n');
    }
    return originalLink(source, target, ...args);
  });

  const result = recoverRetiredPublication(fixture.recovery);
  assert.equal(swapped, true);
  assert.equal(result.status, 'recovery-required');
  assert.equal(result.reason.code, 'publication-recovery-link-verification-failed');
  assert.equal(fs.existsSync(fixture.output), false);
  assert.equal(
    fs.readFileSync(path.join(displacedRoot, path.basename(fixture.recovery), 'previous'), 'utf8'),
    fixture.previous,
  );
  assert.equal(
    fs.readFileSync(path.join(path.dirname(fixture.output), path.basename(fixture.recovery), 'previous'), 'utf8'),
    'untrusted replacement\n',
  );
});

test('a killed publisher after candidate publication leaves the new public output intact', (t) => {
  const interrupted = interruptedReplacement(t, { phase: 'after-link' });
  if (!interrupted) return;
  const { output, next, previous, recovery } = interrupted;
  assert.equal(fs.readFileSync(output, 'utf8'), next);

  const result = runRecovery(recovery);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.body.status, 'preserved');
  assert.equal(result.body.reason.code, 'publication-recovery-target-present');
  assert.equal(fs.readFileSync(output, 'utf8'), next);
  assert.equal(fs.readFileSync(path.join(recovery, 'previous'), 'utf8'), previous);
});

test('a failed recovery-record create leaves the old output and no empty recovery directory', (t) => {
  const root = workspace(t, 'archify-publication-recovery-record-create-');
  const output = path.join(root, 'diagram.html');
  const candidatePath = path.join(root, '.archify-render-candidate');
  fs.writeFileSync(output, 'previous artifact\n');
  fs.writeFileSync(candidatePath, 'candidate artifact\n');
  const snapshot = captureAtomicOutput(output);
  const candidate = captureRegularFileBinding(candidatePath, { subject: 'record-create-candidate' });
  assert.equal(snapshot.status, 'captured');
  assert.equal(candidate.status, 'captured');
  const openSync = fs.openSync;
  t.mock.method(fs, 'openSync', (file, ...args) => {
    if (path.basename(String(file)) === 'publication-recovery-v1.json') {
      throw Object.assign(new Error('injected recovery record create failure'), { code: 'EIO' });
    }
    return openSync(file, ...args);
  });
  try {
    const result = publishRegularFileBinding(candidate.binding, candidatePath, snapshot.snapshot, {
      subject: 'record-create-candidate',
    });
    assert.equal(result.status, 'unknown');
    assert.equal(result.reason.code, 'publication-recovery-record-write-failed');
    assert.equal(fs.readFileSync(output, 'utf8'), 'previous artifact\n');
    assert.deepEqual(
      fs.readdirSync(root).filter((entry) => entry.startsWith('.archify-remove-')),
      [],
    );
  } finally {
    releaseRegularFileBinding(candidate.binding);
  }
});
