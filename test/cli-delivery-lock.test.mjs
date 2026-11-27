import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertCheckFailureReceipt, cli, deliveryPendingPath, deliveryProvenancePath,
  makeFakeOpeners, run, sha256, skillRoot, tmp,
} from './helpers/cli.mjs';

function deliveryLockPath(file) {
  const artifact = path.resolve(file);
  let directory;
  try {
    directory = path.dirname(fs.realpathSync.native(artifact));
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    try {
      directory = fs.realpathSync.native(path.dirname(artifact));
    } catch (directoryError) {
      if (directoryError.code !== 'ENOENT' && directoryError.code !== 'ENOTDIR') throw directoryError;
      directory = path.dirname(artifact);
    }
  }
  return path.join(directory, '.archify-delivery-lock.json');
}

function legacyDeliveryLockPath(file) {
  return path.resolve(file).replace(/\.html?$/i, '.delivery-lock.json');
}

function deliveryStagingEntries(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('.archify-delivery-'))
    .map((entry) => entry.name)
    .sort();
}

function successorDeliveryState({ receiptId, input, output, pid = process.pid }) {
  return {
    artifact: '<!doctype html><title>successor artifact</title>\n',
    lock: `${JSON.stringify({ schemaVersion: 1, receiptId, pid })}\n`,
    pending: `${JSON.stringify({
      schemaVersion: 1,
      command: 'deliver',
      status: 'pending',
      receiptId,
      input: path.resolve(input),
      output: path.resolve(output),
    }, null, 2)}\n`,
    provenance: `${JSON.stringify({
      schemaVersion: 1,
      receiptId,
      status: 'failed',
      command: 'deliver',
      stage: 'successor',
      input: path.resolve(input),
      output: path.resolve(output),
      error: 'successor owns this failure record',
    }, null, 2)}\n`,
  };
}

test('cli: delivery pair rollback restores the previous HTML and marks it stale', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-pair-rollback.html');
  const provenancePath = deliveryProvenancePath(out);
  const initial = run(['deliver', 'workflow', input, out, '--json']);
  assert.equal(initial.status, 0, initial.stderr);
  const priorArtifact = fs.readFileSync(out);

  const wrapper = path.join(tmp, 'fail-provenance-commit.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const linkSync = fs.linkSync;
fs.linkSync = (source, target) => {
  if (String(source).endsWith('delivery-provenance.json')) {
    const error = new Error('injected provenance link failure');
    error.code = 'EACCES';
    throw error;
  }
  return linkSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).stage, 'commit');
  assert.match(result.stdout, /previous files were restored/);
  assert.deepEqual(fs.readFileSync(out), priorArtifact);
  assert.equal(JSON.parse(fs.readFileSync(provenancePath, 'utf8')).status, 'failed');
  const checked = run(['check', out]);
  assert.equal(checked.status, 1);
  assert.equal(JSON.parse(checked.stdout).provenance, 'failed');
});

for (const failureMode of ['journal-read', 'journal-unlink', 'journal-unlink-and-restore']) {
  test(`cli: delivery finalization failure preserves previous bytes or recovery backup (${failureMode})`, () => {
    const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
    const replacement = path.join(skillRoot, 'examples/incident-response.workflow.json');
    const out = path.join(tmp, `${failureMode}.html`);
    assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
    const previousHash = sha256(out);
    const wrapper = path.join(tmp, `${failureMode}.mjs`);
    fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const linkSync = fs.linkSync;
const lstatSync = fs.lstatSync;
const renameSync = fs.renameSync;
let pairCommitted = false;
fs.linkSync = (source, target) => {
  if (${JSON.stringify(failureMode)} === 'journal-unlink-and-restore'
      && String(source).endsWith('.previous-output')) {
    throw Object.assign(new Error('injected restore failure'), { code: 'EACCES' });
  }
  const result = linkSync(source, target);
  if (String(source).endsWith('delivery-provenance.json')) pairCommitted = true;
  return result;
};
fs.lstatSync = (file, ...args) => {
  if (${JSON.stringify(failureMode)} === 'journal-read'
      && pairCommitted && String(file) === ${JSON.stringify(deliveryPendingPath(out))}) {
    throw Object.assign(new Error('injected journal finalization failure'), { code: 'EACCES' });
  }
  return lstatSync(file, ...args);
};
fs.renameSync = (source, target) => {
  if (${JSON.stringify(failureMode)} !== 'journal-read'
      && pairCommitted
      && String(source) === ${JSON.stringify(deliveryPendingPath(out))}
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    throw Object.assign(new Error('injected journal finalization failure'), { code: 'EACCES' });
  }
  return renameSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacement)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
    const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.stage, 'commit');
    assert.equal(fs.existsSync(deliveryPendingPath(out)), true);
    if (failureMode !== 'journal-unlink') {
      assert.equal(
        receipt.diagnostics[0].code,
        failureMode === 'journal-read'
          ? 'delivery/ownership-lost'
          : 'delivery/commit-recovery-required',
      );
      const recoveryDiagnostic = receipt.diagnostics.find(
        ({ code }) => code === 'delivery/commit-recovery-required',
      );
      assert.ok(recoveryDiagnostic);
      const evidence = recoveryDiagnostic.evidence;
      assert.equal(evidence.recoveryRequired, true);
      const backup = evidence.recoverableBackups.find((entry) => entry.label === 'HTML artifact');
      assert.ok(backup);
      assert.equal(sha256(backup.path), previousHash);
      assert.equal(run(['check', out, '--require-provenance']).status, 1);
      return;
    } else {
      assert.equal(receipt.diagnostics[0].code, 'delivery/commit');
      assert.equal(sha256(out), previousHash);
      assert.equal(run(['check', out, '--require-provenance']).status, 1);
    }
    const retry = run(['deliver', 'workflow', replacement, out, '--json']);
    assert.equal(retry.status, 0, retry.stderr || retry.stdout);
    assert.equal(run(['check', out, '--require-provenance']).status, 0);
  });
}

test('cli: delivery pair rollback retains recoverable backups when restoration fails', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-pair-recovery-required.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const physicalOut = fs.realpathSync.native(out);
  const priorArtifact = fs.readFileSync(out);

  const wrapper = path.join(tmp, 'fail-delivery-rollback-restore.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const linkSync = fs.linkSync;
fs.linkSync = (source, target) => {
  if (String(source).endsWith('delivery-provenance.json')) {
    const error = new Error('injected provenance link failure');
    error.code = 'EACCES';
    throw error;
  }
  if (String(source).endsWith('.previous-output') && String(target) === ${JSON.stringify(physicalOut)}) {
    const error = new Error('injected output restore failure');
    error.code = 'EACCES';
    throw error;
  }
  return linkSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  const evidence = failure.diagnostics[0].evidence;
  assert.equal(evidence.recoveryRequired, true);
  assert.match(result.stderr, /Recovery required: delivery backups were retained/);
  assert.equal(fs.existsSync(evidence.recoveryDirectory), true);
  const outputBackup = evidence.recoverableBackups.find((entry) => (
    entry.label === 'HTML artifact'
    || entry.label === 'unverified preserved backup entry for HTML artifact'
  ));
  assert.ok(outputBackup);
  assert.deepEqual(fs.readFileSync(outputBackup.path), priorArtifact);
});

test('cli: delivery pair rollback retains backups when recovery-path inspection fails', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-pair-recovery-inspection-failure.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const physicalOut = fs.realpathSync.native(out);
  const priorArtifact = fs.readFileSync(out);

  const wrapper = path.join(tmp, 'fail-delivery-recovery-inspection.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const linkSync = fs.linkSync;
const lstatSync = fs.lstatSync;
let provenanceCommitFailed = false;
fs.linkSync = (source, target) => {
  if (String(source).endsWith('delivery-provenance.json')) {
    provenanceCommitFailed = true;
    const error = new Error('injected provenance link failure');
    error.code = 'EACCES';
    throw error;
  }
  return linkSync(source, target);
};
fs.lstatSync = (target, options) => {
  if (provenanceCommitFailed && String(target).endsWith('.previous-output')) {
    const error = new Error('injected recovery inspection failure');
    error.code = 'EACCES';
    throw error;
  }
  return lstatSync(target, options);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  const evidence = failure.diagnostics[0].evidence;
  assert.equal(evidence.recoveryRequired, true);
  assert.match(result.stderr, /Recovery required: delivery backups were retained/);
  assert.equal(fs.existsSync(evidence.recoveryDirectory), true);
  const outputBackup = evidence.recoverableBackups.find((entry) => (
    entry.label === 'HTML artifact'
    || entry.label === 'unverified preserved backup entry for HTML artifact'
  ));
  assert.ok(outputBackup);
  assert.deepEqual(fs.readFileSync(outputBackup.path), priorArtifact);
});

test('cli: uncertain delivery lock owners preserve every shared path', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  for (const code of ['EPERM', 'EACCES', 'ESRCH']) {
    const root = path.join(tmp, `uncertain-lock-owner-${code}`);
    fs.mkdirSync(root);
    const out = path.join(root, 'artifact.html');
    const lockPath = deliveryLockPath(out);
    const stage = path.join(root, '.archify-delivery-existing-attempt');
    fs.mkdirSync(stage);
    const files = new Map([
      [out, '<!doctype html><title>existing artifact</title>\n'],
      [deliveryProvenancePath(out), 'existing provenance\n'],
      [deliveryPendingPath(out), 'existing pending journal\n'],
      [lockPath, `${JSON.stringify({
        schemaVersion: 1,
        receiptId: '11111111-1111-4111-8111-111111111111',
        pid: 999_999_999,
      })}\n`],
      [path.join(stage, 'candidate.html'), 'existing staged candidate\n'],
    ]);
    for (const [file, content] of files) fs.writeFileSync(file, content);
    const entries = fs.readdirSync(root).sort();
    const wrapper = path.join(tmp, `uncertain-lock-owner-${code}.mjs`);
    fs.writeFileSync(wrapper, `
const kill = process.kill;
process.kill = (pid, signal) => {
  if (pid === 999_999_999 && signal === 0) {
    throw Object.assign(new Error('injected owner probe failure'), { code: ${JSON.stringify(code)} });
  }
  return kill(pid, signal);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
    const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
    assert.equal(result.status, 1, `${code}: ${result.stderr || result.stdout}`);
    const diagnostic = JSON.parse(result.stdout).diagnostics[0];
    assert.equal(diagnostic.code, code === 'ESRCH' ? 'delivery/lock-stale' : 'delivery/concurrent-attempt');
    assert.equal(diagnostic.subject.lock, lockPath);
    for (const [file, content] of files) assert.equal(fs.readFileSync(file, 'utf8'), content, `${code}: ${file}`);
    assert.deepEqual(fs.readdirSync(root).sort(), entries, `${code}: no staging or sidecar additions`);
    assert.deepEqual(fs.readdirSync(stage), ['candidate.html']);
  }
});

test('cli: portable delivery lock: a process exit requires explicit stale-lock recovery before rerun', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'interrupted-delivery-pair.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const initialSha256 = sha256(out);
  const pendingPath = deliveryPendingPath(out);

  const wrapper = path.join(tmp, 'interrupt-after-journal.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const unlinkSync = fs.unlinkSync;
fs.unlinkSync = (target, ...args) => {
  const result = unlinkSync(target, ...args);
  const parent = path.dirname(String(target));
  const retirementDirectory = path.basename(parent).startsWith('.archify-provenance-')
    || (path.basename(parent).startsWith('.archify-remove-')
      && path.basename(path.dirname(parent)).startsWith('.archify-provenance-'));
  if (path.basename(String(target)) === ${JSON.stringify(path.basename(pendingPath))}
      && retirementDirectory) {
    process.exit(86);
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const interrupted = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(interrupted.status, 86);
  assert.equal(sha256(out), initialSha256);
  const lockPath = deliveryLockPath(out);
  const legacyLockPath = legacyDeliveryLockPath(out);
  const provenancePath = deliveryProvenancePath(out);
  assert.equal(fs.existsSync(pendingPath), true);
  assert.equal(fs.existsSync(legacyLockPath), true);
  for (const args of [
    ['check', out],
    ['check', out, '--require-provenance'],
  ]) {
    const checked = run(args);
    assert.equal(checked.status, 1, checked.stderr || checked.stdout);
    assertCheckFailureReceipt(
      JSON.parse(checked.stdout),
      out,
      /^delivery\/provenance-failed$/,
    );
  }

  const artifactBeforeRecovery = fs.readFileSync(out);
  const pendingBeforeRecovery = fs.readFileSync(pendingPath);
  const lockBeforeRecovery = fs.readFileSync(lockPath);
  const provenanceExisted = fs.existsSync(provenancePath);
  const provenanceBeforeRecovery = provenanceExisted ? fs.readFileSync(provenancePath) : undefined;
  const rejected = run(['deliver', 'workflow', replacementInput, out, '--json']);
  assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
  assert.equal(JSON.parse(rejected.stdout).diagnostics[0].code, 'delivery/lock-stale');
  assert.deepEqual(fs.readFileSync(out), artifactBeforeRecovery);
  assert.deepEqual(fs.readFileSync(pendingPath), pendingBeforeRecovery);
  assert.deepEqual(fs.readFileSync(lockPath), lockBeforeRecovery);
  assert.equal(fs.existsSync(provenancePath), provenanceExisted);
  if (provenanceExisted) assert.deepEqual(fs.readFileSync(provenancePath), provenanceBeforeRecovery);

  // Manual recovery is deliberately outside the delivery protocol: after
  // confirming the recorded PID exited, remove each reported stale lock.
  fs.unlinkSync(lockPath);
  const legacyRejected = run(['deliver', 'workflow', replacementInput, out, '--json']);
  assert.equal(legacyRejected.status, 1, legacyRejected.stderr || legacyRejected.stdout);
  assert.equal(JSON.parse(legacyRejected.stdout).diagnostics[0].code, 'delivery/lock-stale');
  assert.equal(JSON.parse(legacyRejected.stdout).diagnostics[0].subject.lock, legacyLockPath);
  assert.equal(fs.existsSync(provenancePath), provenanceExisted);
  if (provenanceExisted) assert.deepEqual(fs.readFileSync(provenancePath), provenanceBeforeRecovery);
  fs.unlinkSync(legacyLockPath);
  const recovered = run(['deliver', 'workflow', replacementInput, out, '--json']);
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
  assert.equal(fs.existsSync(deliveryPendingPath(out)), false);
  for (const args of [
    ['check', out],
    ['check', out, '--require-provenance'],
  ]) {
    const checked = run(args);
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    assert.equal(JSON.parse(checked.stdout).provenance, 'current');
  }
});

test('cli: concurrent deliveries cannot replace the active attempt ownership', async (t) => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'concurrent-delivery.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const ready = path.join(tmp, 'concurrent-delivery.ready');
  const release = path.join(tmp, 'concurrent-delivery.release');
  const wrapper = path.join(tmp, 'hold-active-delivery.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const writeFileSync = fs.writeFileSync;
fs.writeFileSync = (file, value, options) => {
  const result = writeFileSync(file, value, options);
  if (String(file).endsWith('specification.snapshot.json')) {
    writeFileSync(${JSON.stringify(ready)}, 'ready');
    while (!fs.existsSync(${JSON.stringify(release)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const active = spawn(process.execPath, [wrapper], { cwd: skillRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  const activeExitPromise = new Promise((resolve) => {
    active.once('close', (code, signal) => resolve({ code, signal }));
  });
  t.after(() => {
    if (!fs.existsSync(release)) fs.writeFileSync(release, 'release');
    if (active.exitCode === null && active.signalCode === null) active.kill();
  });
  let activeStdout = '';
  let activeStderr = '';
  active.stdout.on('data', (chunk) => { activeStdout += chunk; });
  active.stderr.on('data', (chunk) => { activeStderr += chunk; });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(ready) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.existsSync(ready), true, 'active delivery did not reach the overlap point');

  const rejected = run(['deliver', 'workflow', initialInput, out, '--json']);
  assert.equal(rejected.status, 1);
  const rejection = JSON.parse(rejected.stdout);
  assert.equal(rejection.diagnostics[0].code, 'delivery/concurrent-attempt');
  assert.equal('provenance' in rejection, false);

  fs.writeFileSync(release, 'release');
  const activeExit = await activeExitPromise;
  assert.deepEqual(activeExit, { code: 0, signal: null }, activeStderr);
  const activeReceipt = JSON.parse(activeStdout);
  const provenance = JSON.parse(fs.readFileSync(deliveryProvenancePath(out), 'utf8'));
  assert.equal(provenance.status, 'current');
  assert.equal(provenance.receiptId, activeReceipt.receiptId);
  assert.equal(fs.existsSync(deliveryLockPath(out)), false);
});

test('cli: a pre-lock failure cannot replace an active delivery attempt', async (t) => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'concurrent-pre-lock-failure.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const initialProvenance = fs.readFileSync(deliveryProvenancePath(out), 'utf8');
  const ready = path.join(tmp, 'concurrent-pre-lock-failure.ready');
  const release = path.join(tmp, 'concurrent-pre-lock-failure.release');
  const activeWrapper = path.join(tmp, 'hold-active-pre-lock-delivery.mjs');
  fs.writeFileSync(activeWrapper, `
import fs from 'node:fs';
const writeFileSync = fs.writeFileSync;
fs.writeFileSync = (file, value, options) => {
  const result = writeFileSync(file, value, options);
  if (String(file).endsWith('specification.snapshot.json')) {
    writeFileSync(${JSON.stringify(ready)}, 'ready');
    while (!fs.existsSync(${JSON.stringify(release)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const active = spawn(process.execPath, [activeWrapper], { cwd: skillRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  const activeExitPromise = new Promise((resolve) => {
    active.once('close', (code, signal) => resolve({ code, signal }));
  });
  t.after(() => {
    if (!fs.existsSync(release)) fs.writeFileSync(release, 'release');
    if (active.exitCode === null && active.signalCode === null) active.kill();
  });
  let activeStdout = '';
  let activeStderr = '';
  active.stdout.on('data', (chunk) => { activeStdout += chunk; });
  active.stderr.on('data', (chunk) => { activeStderr += chunk; });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(ready) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.existsSync(ready), true, 'active delivery did not reach the overlap point');
  const activePending = fs.readFileSync(deliveryPendingPath(out), 'utf8');

  const failingWrapper = path.join(tmp, 'fail-before-delivery-lock.mjs');
  fs.writeFileSync(failingWrapper, `
import fs from 'node:fs';
const mkdtempSync = fs.mkdtempSync;
fs.mkdtempSync = (prefix, options) => {
  if (String(prefix).endsWith('.archify-delivery-')) {
    const error = new Error('injected candidate setup failure');
    error.code = 'EACCES';
    throw error;
  }
  return mkdtempSync(prefix, options);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(initialInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const rejected = spawnSync(process.execPath, [failingWrapper], { cwd: skillRoot, encoding: 'utf8' });
  const rejection = JSON.parse(rejected.stdout);
  const pendingAfterRejection = fs.readFileSync(deliveryPendingPath(out), 'utf8');
  const provenanceAfterRejection = fs.readFileSync(deliveryProvenancePath(out), 'utf8');

  fs.writeFileSync(release, 'release');
  const activeExit = await activeExitPromise;

  assert.equal(rejected.status, 1);
  assert.equal(rejection.diagnostics[0].code, 'delivery/concurrent-attempt');
  assert.equal('provenance' in rejection, false);
  assert.equal(pendingAfterRejection, activePending);
  assert.equal(provenanceAfterRejection, initialProvenance);
  assert.deepEqual(activeExit, { code: 0, signal: null }, activeStderr);
  assert.equal(JSON.parse(activeStdout).ok, true);
});

test('cli: portable delivery lock: a stale entry is preserved when a pre-lock failure is reported', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'stale-lock-pre-lock-failure.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(out);
  const provenancePath = deliveryProvenancePath(out);
  const provenanceBefore = fs.readFileSync(provenancePath);
  const lockPath = deliveryLockPath(out);
  const stagingBefore = deliveryStagingEntries(path.dirname(out));
  const exited = spawnSync(process.execPath, ['-e', '']);
  assert.equal(exited.status, 0);
  const staleLock = `${JSON.stringify({
    schemaVersion: 1,
    receiptId: '00000000-0000-4000-8000-000000000000',
    pid: exited.pid,
  })}\n`;
  fs.writeFileSync(lockPath, staleLock);
  const wrapper = path.join(tmp, 'fail-after-stale-delivery-lock.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const mkdtempSync = fs.mkdtempSync;
fs.mkdtempSync = (prefix, options) => {
  if (String(prefix).endsWith('.archify-delivery-')) {
    const error = new Error('injected candidate setup failure');
    error.code = 'EACCES';
    throw error;
  }
  return mkdtempSync(prefix, options);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/lock-stale');
  assert.equal('provenance' in receipt, false);
  assert.equal(receipt.diagnostics[0].subject.output, fs.realpathSync.native(out));
  assert.equal(receipt.diagnostics[0].subject.lock, lockPath);
  assert.equal(receipt.diagnostics[0].evidence.pid, exited.pid);
  assert.equal(receipt.diagnostics[0].evidence.receiptId, '00000000-0000-4000-8000-000000000000');
  assert.ok(receipt.diagnostics[0].supportedFixes.some((fix) => /confirm no delivery attempt is active/i.test(fix)));
  assert.ok(receipt.diagnostics[0].supportedFixes.some((fix) => fix.includes(lockPath)));
  assert.deepEqual(fs.readFileSync(out), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenancePath), provenanceBefore);
  assert.equal(fs.existsSync(deliveryPendingPath(out)), false);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), staleLock);
  assert.deepEqual(
    deliveryStagingEntries(path.dirname(out)),
    stagingBefore,
  );
});

test('cli: portable delivery lock: simultaneous stale-lock contenders both fail closed', async (t) => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'simultaneous-stale-lock-contenders.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(out);
  const provenancePath = deliveryProvenancePath(out);
  const provenanceBefore = fs.readFileSync(provenancePath);
  const lockPath = deliveryLockPath(out);
  const stagingBefore = deliveryStagingEntries(path.dirname(out));
  const exited = spawnSync(process.execPath, ['-e', '']);
  assert.equal(exited.status, 0);
  const staleLock = `${JSON.stringify({
    schemaVersion: 1,
    receiptId: '00000000-0000-4000-8000-000000000000',
    pid: exited.pid,
  })}\n`;
  fs.writeFileSync(lockPath, staleLock);
  const release = path.join(tmp, 'release-stale-lock-contenders');

  const contenders = ['a', 'b'].map((label) => {
    const ready = path.join(tmp, `stale-lock-contender-${label}.ready`);
    const wrapper = path.join(tmp, `stale-lock-contender-${label}.mjs`);
    fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const processKill = process.kill.bind(process);
process.kill = (pid, signal) => {
  if (pid === ${JSON.stringify(exited.pid)} && signal === 0) {
    fs.writeFileSync(${JSON.stringify(ready)}, 'ready');
    while (!fs.existsSync(${JSON.stringify(release)})) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
  }
  return processKill(pid, signal);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
    const child = spawn(process.execPath, [wrapper], { cwd: skillRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const exitedPromise = new Promise((resolve) => {
      child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    return { child, ready, exitedPromise };
  });
  t.after(() => {
    if (!fs.existsSync(release)) fs.writeFileSync(release, 'release');
    for (const { child } of contenders) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  });

  const deadline = Date.now() + 5000;
  while (contenders.some(({ ready }) => !fs.existsSync(ready)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(contenders.every(({ ready }) => fs.existsSync(ready)), true, 'both contenders did not inspect the stale lock');
  fs.writeFileSync(release, 'release');
  const results = await Promise.all(contenders.map(({ exitedPromise }) => exitedPromise));

  for (const result of results) {
    assert.deepEqual({ code: result.code, signal: result.signal }, { code: 1, signal: null }, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.diagnostics[0].code, 'delivery/lock-stale');
    assert.equal('provenance' in receipt, false);
  }
  assert.deepEqual(fs.readFileSync(out), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenancePath), provenanceBefore);
  assert.equal(fs.existsSync(deliveryPendingPath(out)), false);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), staleLock);
  assert.deepEqual(
    deliveryStagingEntries(path.dirname(out)),
    stagingBefore,
  );
});

test('cli: portable delivery lock: lost ownership prevents failure provenance writes', () => {
  const validInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const invalidInput = path.join(tmp, 'lost-delivery-ownership.workflow.json');
  const invalid = JSON.parse(fs.readFileSync(validInput, 'utf8'));
  invalid.nodes[0].unexpected = true;
  fs.writeFileSync(invalidInput, JSON.stringify(invalid));
  const out = path.join(tmp, 'lost-delivery-ownership.html');
  assert.equal(run(['deliver', 'workflow', validInput, out, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(out);
  const provenancePath = deliveryProvenancePath(out);
  const provenanceBefore = fs.readFileSync(provenancePath);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successorReceiptId = '11111111-1111-4111-8111-111111111111';
  const successorLock = `${JSON.stringify({
    schemaVersion: 1,
    receiptId: successorReceiptId,
    pid: process.pid,
  })}\n`;
  const successorProvenance = `${JSON.stringify({
    schemaVersion: 1,
    receiptId: successorReceiptId,
    status: 'failed',
    command: 'deliver',
    stage: 'successor',
    input: path.resolve(validInput),
    output: path.resolve(out),
    error: 'successor owns this failure record',
  }, null, 2)}\n`;
  const wrapper = path.join(tmp, 'lose-delivery-ownership.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const linkSync = fs.linkSync;
const renameSync = fs.renameSync;
const writeFileSync = fs.writeFileSync;
let replaced = false;
fs.linkSync = (source, target) => {
  const result = linkSync(source, target);
  if (!replaced && String(target) === ${JSON.stringify(pendingPath)}
      && path.basename(path.dirname(String(source))).startsWith('.archify-provenance-')) {
    replaced = true;
    renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.lost-owner`)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successorLock)});
    writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successorProvenance)});
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(invalidInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.ok, false);
  assert.ok(receipt.diagnostics.some((entry) => entry.code === 'delivery/ownership-lost'));
  assert.ok(!('provenance' in receipt) || receipt.provenance === 'unrecorded');
  assert.deepEqual(fs.readFileSync(out), artifactBefore);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successorProvenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successorLock);
  assert.equal(JSON.parse(fs.readFileSync(pendingPath, 'utf8')).receiptId, receipt.receiptId);
});

test('cli: portable delivery lock: failure provenance ownership loss reports retained recovery state', () => {
  const validInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const invalidInput = path.join(tmp, 'failure-provenance-ownership-loss.workflow.json');
  const invalid = JSON.parse(fs.readFileSync(validInput, 'utf8'));
  invalid.nodes[0].unexpected = true;
  fs.writeFileSync(invalidInput, JSON.stringify(invalid));
  const out = path.join(tmp, 'failure-provenance-ownership-loss.html');
  assert.equal(run(['deliver', 'workflow', validInput, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '15151515-1515-4515-8515-151515151515',
    input: validInput,
    output: out,
  });
  const wrapper = path.join(tmp, 'failure-provenance-ownership-loss.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
let successorInstalled = false;
fs.writeFileSync = (file, ...args) => {
  const result = writeFileSync(file, ...args);
  if (!successorInstalled
      && path.basename(String(file)) === ${JSON.stringify(path.basename(provenancePath))}
      && path.basename(path.dirname(String(file))).startsWith('.archify-provenance-')) {
    successorInstalled = true;
    renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owner-a`)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successor.lock)}, { flag: 'wx' });
    writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)});
    writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successor.provenance)});
    writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(successor.artifact)});
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(invalidInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/ownership-lost');
  assert.ok(!('provenance' in receipt) || receipt.provenance === 'unrecorded');
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  assert.equal(fs.existsSync(receipt.diagnostics[0].evidence.recoveryDirectory), true);
  assert.deepEqual(receipt.diagnostics[0].evidence.recoverableBackups, []);
  assert.match(failed.stderr, /Recovery required: delivery backups were retained/);
  assert.equal(fs.readFileSync(out, 'utf8'), successor.artifact);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
});

test('cli: portable delivery lock: journal creation cannot overwrite a successor', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'lost-ownership-before-journal-rename.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '12121212-1212-4212-8212-121212121212',
    input,
    output: out,
  });
  const wrapper = path.join(tmp, 'lose-ownership-before-journal-rename.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
let replaced = false;
fs.writeFileSync = (file, ...args) => {
  const result = writeFileSync(file, ...args);
  if (!replaced && path.basename(String(file)) === ${JSON.stringify(path.basename(pendingPath))}
      && path.basename(path.dirname(String(file))).startsWith('.archify-provenance-')) {
    replaced = true;
    renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owner-a`)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successor.lock)}, { flag: 'wx' });
    writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)}, { flag: 'wx' });
    writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successor.provenance)});
    writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(successor.artifact)});
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/ownership-lost');
  assert.equal('provenance' in receipt, false);
  assert.equal(fs.readFileSync(out, 'utf8'), successor.artifact);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
});

test('cli: portable delivery lock: journal publish preserves a final-window claimant', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'journal-final-window-claimant.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(out);
  const provenancePath = deliveryProvenancePath(out);
  const provenanceBefore = fs.readFileSync(provenancePath);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const claimant = '{"claimant":"journal-final-window"}\n';
  const identityFile = path.join(tmp, 'journal-final-window-identity.json');
  const priorJournalStaging = fs.readdirSync(path.dirname(out))
    .filter((name) => name.startsWith('.archify-provenance-'))
    .sort();
  const wrapper = path.join(tmp, 'journal-final-window-claimant.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const linkSync = fs.linkSync;
let injected = false;
fs.linkSync = (source, target) => {
  if (!injected && String(target) === ${JSON.stringify(pendingPath)}
      && path.basename(path.dirname(String(source))).startsWith('.archify-provenance-')) {
    injected = true;
    fs.writeFileSync(target, ${JSON.stringify(claimant)}, { flag: 'wx' });
    const identity = fs.lstatSync(target, { bigint: true });
    fs.writeFileSync(${JSON.stringify(identityFile)}, JSON.stringify({ dev: String(identity.dev), ino: String(identity.ino) }));
  }
  return linkSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/journal-recovery-required');
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  assert.match(receipt.diagnostics[0].evidence.reason, /target-claimed-during-publish/);
  assert.equal('recoveryDirectory' in receipt.diagnostics[0].evidence, false);
  assert.equal('recoveryFiles' in receipt.diagnostics[0].evidence, false);
  assert.ok(!('provenance' in receipt) || receipt.provenance === 'unrecorded');
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), claimant);
  const currentIdentity = fs.lstatSync(pendingPath, { bigint: true });
  assert.deepEqual(
    { dev: String(currentIdentity.dev), ino: String(currentIdentity.ino) },
    JSON.parse(fs.readFileSync(identityFile, 'utf8')),
  );
  assert.deepEqual(fs.readFileSync(out), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenancePath), provenanceBefore);
  assert.equal(fs.existsSync(lockPath), true);
  assert.deepEqual(
    fs.readdirSync(path.dirname(out))
      .filter((name) => name.startsWith('.archify-provenance-'))
      .sort(),
    priorJournalStaging,
  );
});

test('cli: portable delivery lock: journal candidate retirement preserves a replacement claimant', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'journal-candidate-retirement-claimant.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const pendingPath = deliveryPendingPath(out);
  const candidateName = path.basename(pendingPath);
  const claimant = '{"claimant":"journal candidate retirement"}\n';
  const claimantIdentityFile = path.join(tmp, 'journal-candidate-retirement-identity.json');
  const displacedCandidate = path.join(tmp, 'journal-candidate-retirement-displaced');
  const priorStaging = fs.readdirSync(path.dirname(out))
    .filter((name) => name.startsWith('.archify-provenance-'))
    .sort();
  const wrapper = path.join(tmp, 'replace-journal-candidate-at-retirement.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const unlinkSync = fs.unlinkSync;
const renameSync = fs.renameSync;
const writeFileSync = fs.writeFileSync;
let replaced = false;
const isCandidate = (file) => (
  path.basename(String(file)) === ${JSON.stringify(candidateName)}
  && path.basename(path.dirname(String(file))).startsWith('.archify-provenance-')
);
const replaceCandidate = (file) => {
  replaced = true;
  renameSync(file, ${JSON.stringify(displacedCandidate)});
  writeFileSync(file, ${JSON.stringify(claimant)}, { flag: 'wx' });
  const stat = fs.lstatSync(file, { bigint: true });
  writeFileSync(${JSON.stringify(claimantIdentityFile)}, JSON.stringify({
    dev: String(stat.dev),
    ino: String(stat.ino),
  }));
};
fs.unlinkSync = (file, ...args) => {
  if (!replaced && isCandidate(file)) replaceCandidate(file);
  return unlinkSync(file, ...args);
};
fs.renameSync = (source, target, ...args) => {
  if (!replaced
      && isCandidate(source)
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    replaceCandidate(source);
  }
  return renameSync(source, target, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const staging = fs.readdirSync(path.dirname(out))
    .filter((name) => name.startsWith('.archify-provenance-'))
    .filter((name) => !priorStaging.includes(name));
  assert.equal(staging.length, 1, failed.stderr || failed.stdout);
  const candidate = path.join(path.dirname(out), staging[0], candidateName);
  assert.equal(fs.readFileSync(candidate, 'utf8'), claimant);
  const claimantIdentity = fs.lstatSync(candidate, { bigint: true });
  assert.deepEqual(
    { dev: String(claimantIdentity.dev), ino: String(claimantIdentity.ino) },
    JSON.parse(fs.readFileSync(claimantIdentityFile, 'utf8')),
  );
  assert.equal(fs.existsSync(displacedCandidate), true);
});

test('cli: portable delivery lock: failed journal restore retains the previous journal and claimant', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'journal-restore-claimant.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(out);
  const provenancePath = deliveryProvenancePath(out);
  const provenanceBefore = fs.readFileSync(provenancePath);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const previousJournal = '{"previous":"delivery journal"}\n';
  fs.writeFileSync(pendingPath, previousJournal, { flag: 'wx' });
  const previousIdentity = fs.lstatSync(pendingPath, { bigint: true });
  const claimant = '{"claimant":"blocks journal restore"}\n';
  const claimantIdentityFile = path.join(tmp, 'journal-restore-claimant-identity.json');
  const wrapper = path.join(tmp, 'journal-restore-claimant.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const linkSync = fs.linkSync;
let injected = false;
fs.linkSync = (source, target) => {
  if (!injected && String(target) === ${JSON.stringify(pendingPath)}
      && path.basename(path.dirname(String(source))).startsWith('.archify-provenance-')) {
    injected = true;
    fs.writeFileSync(target, ${JSON.stringify(claimant)}, { flag: 'wx' });
    const identity = fs.lstatSync(target, { bigint: true });
    fs.writeFileSync(${JSON.stringify(claimantIdentityFile)}, JSON.stringify({ dev: String(identity.dev), ino: String(identity.ino) }));
  }
  return linkSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  const recovery = receipt.diagnostics[0];
  assert.equal(recovery.code, 'delivery/journal-recovery-required');
  assert.equal(recovery.evidence.recoveryRequired, true);
  assert.match(recovery.evidence.rollbackErrors.join('\n'), /previous journal restore failed/);
  assert.match(recovery.evidence.rollbackErrors.join('\n'), /claimant prevents restoring/);
  assert.equal(fs.existsSync(recovery.evidence.recoveryDirectory), true);
  assert.equal(recovery.evidence.recoveryFiles.length, 1);
  const [previous] = recovery.evidence.recoveryFiles;
  assert.equal(previous.label, 'previous delivery journal');
  assert.equal(previous.target, pendingPath);
  assert.equal(fs.readFileSync(previous.path, 'utf8'), previousJournal);
  const retainedIdentity = fs.lstatSync(previous.path, { bigint: true });
  assert.deepEqual(
    { dev: retainedIdentity.dev, ino: retainedIdentity.ino },
    { dev: previousIdentity.dev, ino: previousIdentity.ino },
  );
  assert.deepEqual(fs.readdirSync(recovery.evidence.recoveryDirectory), ['.previous-journal']);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), claimant);
  const claimantIdentity = fs.lstatSync(pendingPath, { bigint: true });
  assert.deepEqual(
    { dev: String(claimantIdentity.dev), ino: String(claimantIdentity.ino) },
    JSON.parse(fs.readFileSync(claimantIdentityFile, 'utf8')),
  );
  assert.deepEqual(fs.readFileSync(out), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenancePath), provenanceBefore);
  assert.equal(fs.existsSync(lockPath), true);
  const retry = run(['deliver', 'workflow', input, out, '--json']);
  assert.equal(retry.status, 1, retry.stderr || retry.stdout);
  assert.equal(JSON.parse(retry.stdout).diagnostics[0].code, 'delivery/lock-stale');
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), claimant);
  assert.equal(fs.readFileSync(previous.path, 'utf8'), previousJournal);
});

test('cli: portable delivery lock: an unverifiable new journal fails safely', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'unverifiable-new-journal.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(out);
  const provenancePath = deliveryProvenancePath(out);
  const provenanceBefore = fs.readFileSync(provenancePath);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const wrapper = path.join(tmp, 'unverifiable-new-journal.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const lstatSync = fs.lstatSync;
let injected = false;
fs.lstatSync = (file, ...args) => {
  if (!injected && String(file) === ${JSON.stringify(pendingPath)} && fs.existsSync(file)) {
    injected = true;
    throw Object.assign(new Error('injected journal identity failure'), { code: 'EACCES' });
  }
  return lstatSync(file, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/journal-write');
  assert.match(
    receipt.diagnostics[0].evidence.reason,
    /delivery-journal-candidate-handle-verification-failed/,
  );
  assert.equal(receipt.provenance, 'failed');
  assert.deepEqual(fs.readFileSync(out), artifactBefore);
  assert.notDeepEqual(fs.readFileSync(provenancePath), provenanceBefore);
  assert.equal(JSON.parse(fs.readFileSync(provenancePath, 'utf8')).status, 'failed');
  assert.equal(fs.existsSync(pendingPath), true);
  assert.equal(fs.existsSync(lockPath), false);
});

for (const removalRole of ['journal', 'lock']) {
  test(`cli: delivery preserves a ${removalRole} successor swapped at final public removal`, () => {
    const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
    const out = path.join(tmp, `final-remove-${removalRole}.html`);
    assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
    const publicPath = removalRole === 'journal' ? deliveryPendingPath(out) : deliveryLockPath(out);
    const displacedOwner = path.join(tmp, `final-remove-${removalRole}-owner`);
    const successor = `${JSON.stringify({
      schemaVersion: 1,
      receiptId: '56565656-5656-4656-8656-565656565656',
      pid: process.pid,
      role: removalRole,
    })}\n`;
    const identityFile = path.join(tmp, `final-remove-${removalRole}-identity.json`);
    const wrapper = path.join(tmp, `final-remove-${removalRole}.mjs`);
    fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const renameSync = fs.renameSync;
let injected = false;
fs.renameSync = (source, target) => {
  if (!injected && String(source) === ${JSON.stringify(publicPath)}
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    injected = true;
    renameSync(source, ${JSON.stringify(displacedOwner)});
    fs.writeFileSync(source, ${JSON.stringify(successor)}, { flag: 'wx' });
    const identity = fs.lstatSync(source, { bigint: true });
    fs.writeFileSync(${JSON.stringify(identityFile)}, JSON.stringify({ dev: String(identity.dev), ino: String(identity.ino) }));
  }
  return renameSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

    const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
    assert.equal(failed.status, 1, failed.stderr || failed.stdout);
    const receipt = JSON.parse(failed.stdout);
    assert.equal(
      receipt.diagnostics.some((entry) => entry.code === (
        removalRole === 'journal'
          ? 'delivery/commit-recovery-required'
          : 'delivery/ownership-lost'
      )),
      true,
    );
    assert.equal(fs.readFileSync(publicPath, 'utf8'), successor);
    const current = fs.lstatSync(publicPath, { bigint: true });
    assert.deepEqual(
      { dev: String(current.dev), ino: String(current.ino) },
      JSON.parse(fs.readFileSync(identityFile, 'utf8')),
    );
    assert.equal(fs.existsSync(displacedOwner), true);
  });
}

test('cli: portable delivery lock: release loss cannot claim failed provenance', () => {
  const validInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const invalidInput = path.join(tmp, 'release-loss-after-failure.workflow.json');
  const invalid = JSON.parse(fs.readFileSync(validInput, 'utf8'));
  invalid.nodes[0].unexpected = true;
  fs.writeFileSync(invalidInput, JSON.stringify(invalid));
  const out = path.join(tmp, 'release-loss-after-failure.html');
  assert.equal(run(['deliver', 'workflow', validInput, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '13131313-1313-4313-8313-131313131313',
    input: validInput,
    output: out,
  });
  const wrapper = path.join(tmp, 'lose-ownership-after-failure-provenance.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
const linkSync = fs.linkSync;
let replaced = false;
fs.linkSync = (source, target) => {
  const result = linkSync(source, target);
  if (!replaced && String(target) === ${JSON.stringify(provenancePath)}
      && path.basename(path.dirname(String(source))).startsWith('.archify-provenance-')) {
    replaced = true;
    renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owner-a`)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successor.lock)}, { flag: 'wx' });
    writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)});
    renameSync(target, String(target) + '.owner-a');
    writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successor.provenance)});
    writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(successor.artifact)});
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(invalidInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/provenance-recovery-required');
  assert.ok(!('provenance' in receipt) || receipt.provenance === 'unrecorded');
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  assert.equal(fs.existsSync(receipt.diagnostics[0].evidence.recoveryDirectory), true);
  assert.equal(fs.readFileSync(out, 'utf8'), successor.artifact);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
});

test('cli: portable delivery lock: commit entry preserves a successor owner', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'lost-ownership-before-commit.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '22222222-2222-4222-8222-222222222222',
    input: replacementInput,
    output: out,
  });
  const wrapper = path.join(tmp, 'lose-ownership-before-commit.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
let replaced = false;
fs.writeFileSync = (file, ...args) => {
  const result = writeFileSync(file, ...args);
  if (!replaced && path.basename(String(file)) === 'delivery-provenance.json'
      && path.basename(path.dirname(String(file))).startsWith('.archify-delivery-')) {
    replaced = true;
    renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owner-a`)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successor.lock)}, { flag: 'wx' });
    writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)});
    writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successor.provenance)});
    writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(successor.artifact)});
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/ownership-lost');
  assert.equal('provenance' in receipt, false);
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  assert.equal(fs.existsSync(receipt.diagnostics[0].evidence.recoveryDirectory), true);
  assert.match(failed.stderr, /Recovery required: delivery backups were retained/);
  assert.equal(fs.readFileSync(out, 'utf8'), successor.artifact);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
});

test('cli: portable delivery lock: rollback stops after ownership is lost', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'lost-ownership-before-rollback.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const priorArtifact = fs.readFileSync(out);
  const priorProvenance = fs.readFileSync(provenancePath);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '33333333-3333-4333-8333-333333333333',
    input: replacementInput,
    output: out,
  });
  const wrapper = path.join(tmp, 'lose-ownership-before-rollback.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
const linkSync = fs.linkSync;
let replaced = false;
fs.linkSync = (source, target) => {
  if (!replaced && path.basename(String(source)) === 'delivery-provenance.json'
      && path.basename(path.dirname(String(source))).startsWith('.archify-delivery-')) {
    replaced = true;
    renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owner-a`)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successor.lock)}, { flag: 'wx' });
    writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)});
    writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successor.provenance)});
    writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(successor.artifact)});
    throw Object.assign(new Error('injected provenance commit failure'), { code: 'EACCES' });
  }
  return linkSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/ownership-lost');
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  assert.equal(receipt.diagnostics[0].evidence.commitError.reason, 'injected provenance commit failure');
  assert.equal(receipt.diagnostics[0].evidence.commitError.systemCode, 'EACCES');
  assert.ok(receipt.diagnostics[0].evidence.recoverableBackups.length >= 1);
  const outputBackup = receipt.diagnostics[0].evidence.recoverableBackups
    .find((entry) => entry.label === 'HTML artifact');
  const provenanceBackup = receipt.diagnostics[0].evidence.recoverableBackups
    .find((entry) => entry.label === 'delivery provenance');
  assert.deepEqual(fs.readFileSync(outputBackup.path), priorArtifact);
  assert.deepEqual(fs.readFileSync(provenanceBackup.path), priorProvenance);
  assert.match(failed.stderr, /Recovery required: delivery backups were retained/);
  assert.equal(fs.readFileSync(out, 'utf8'), successor.artifact);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
});

test('cli: portable delivery lock: finalization preserves a successor owner', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'lost-ownership-before-finalization.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const priorArtifact = fs.readFileSync(out);
  const priorProvenance = fs.readFileSync(provenancePath);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '44444444-4444-4444-8444-444444444444',
    input: replacementInput,
    output: out,
  });
  const wrapper = path.join(tmp, 'lose-ownership-before-finalization.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
const linkSync = fs.linkSync;
let replaced = false;
fs.linkSync = (source, target) => {
  const result = linkSync(source, target);
  if (!replaced && path.basename(String(source)) === 'delivery-provenance.json'
      && path.basename(path.dirname(String(source))).startsWith('.archify-delivery-')) {
    replaced = true;
    renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owner-a`)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successor.lock)}, { flag: 'wx' });
    writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)});
    writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successor.provenance)});
    writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(successor.artifact)});
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/ownership-lost');
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  const outputBackup = receipt.diagnostics[0].evidence.recoverableBackups
    .find((entry) => entry.label === 'HTML artifact');
  const provenanceBackup = receipt.diagnostics[0].evidence.recoverableBackups
    .find((entry) => entry.label === 'delivery provenance');
  assert.deepEqual(fs.readFileSync(outputBackup.path), priorArtifact);
  assert.deepEqual(fs.readFileSync(provenanceBackup.path), priorProvenance);
  assert.match(failed.stderr, /Recovery required: delivery backups were retained/);
  assert.equal(fs.readFileSync(out, 'utf8'), successor.artifact);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
});

test('cli: portable delivery lock: release preserves a successor owner', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'lost-ownership-before-release.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const priorArtifact = fs.readFileSync(out);
  const priorProvenance = fs.readFileSync(provenancePath);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '55555555-5555-4555-8555-555555555555',
    input: replacementInput,
    output: out,
  });
  const wrapper = path.join(tmp, 'lose-ownership-before-release.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
const lstatSync = fs.lstatSync;
let journalFinalized = false;
let replaced = false;
fs.renameSync = (source, target) => {
  const result = renameSync(source, target);
  if (String(source) === ${JSON.stringify(pendingPath)}
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    journalFinalized = true;
  }
  return result;
};
fs.lstatSync = (file, ...args) => {
  try {
    return lstatSync(file, ...args);
  } catch (error) {
    if (!replaced && journalFinalized && String(file) === ${JSON.stringify(pendingPath)} && error.code === 'ENOENT') {
      replaced = true;
      renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owner-a`)});
      writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successor.lock)}, { flag: 'wx' });
      writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)});
      writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successor.provenance)});
      writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(successor.artifact)});
    }
    throw error;
  }
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.stage, 'release');
  assert.equal(receipt.diagnostics[0].code, 'delivery/ownership-lost');
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  const outputBackup = receipt.diagnostics[0].evidence.recoverableBackups
    .find((entry) => entry.label === 'HTML artifact');
  const provenanceBackup = receipt.diagnostics[0].evidence.recoverableBackups
    .find((entry) => entry.label === 'delivery provenance');
  assert.deepEqual(fs.readFileSync(outputBackup.path), priorArtifact);
  assert.deepEqual(fs.readFileSync(provenanceBackup.path), priorProvenance);
  assert.match(failed.stderr, /Recovery required: delivery backups were retained/);
  assert.equal(fs.readFileSync(out, 'utf8'), successor.artifact);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
});

test('cli: portable delivery lock: release rejects a recreated journal', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'recreated-journal-before-release.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '66666666-6666-4666-8666-666666666666',
    input: replacementInput,
    output: out,
  });
  const wrapper = path.join(tmp, 'recreate-journal-before-release.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
const lstatSync = fs.lstatSync;
let journalFinalized = false;
let postFinalizeLockChecks = 0;
let journalRecreated = false;
fs.renameSync = (source, target) => {
  const result = renameSync(source, target);
  if (String(source) === ${JSON.stringify(pendingPath)}
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    journalFinalized = true;
  }
  return result;
};
fs.lstatSync = (file, ...args) => {
  if (journalFinalized && String(file) === ${JSON.stringify(lockPath)}) {
    postFinalizeLockChecks += 1;
    if (postFinalizeLockChecks === 2) {
      writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)}, { flag: 'wx' });
      journalRecreated = true;
    }
  }
  if (journalRecreated && String(file).includes('.previous-')) {
    throw Object.assign(new Error('injected recovery backup inspection failure'), { code: 'EACCES' });
  }
  return lstatSync(file, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.stage, 'commit');
  assert.equal(receipt.diagnostics[0].code, 'delivery/ownership-lost');
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  assert.ok(receipt.diagnostics[0].evidence.recoverableBackups.length >= 1);
  assert.equal(fs.existsSync(receipt.diagnostics[0].evidence.recoveryDirectory), true);
  assert.equal(fs.existsSync(receipt.diagnostics[0].evidence.recoverableBackups[0].path), true);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
  assert.equal(fs.existsSync(lockPath), true);
  const strict = run(['check', out, '--require-provenance']);
  assert.equal(strict.status, 1, strict.stderr || strict.stdout);
  assert.equal(JSON.parse(strict.stdout).diagnostics[0].code, 'delivery/provenance-failed');
});

test('cli: portable delivery lock: release failure cannot claim delivery success', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-lock-release-failure.html');
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const provenancePath = deliveryProvenancePath(out);
  const wrapper = path.join(tmp, 'delivery-lock-release-failure.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const renameSync = fs.renameSync;
fs.renameSync = (source, target) => {
  if (String(source) === ${JSON.stringify(lockPath)}
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    throw Object.assign(new Error('injected lock release failure'), { code: 'EACCES' });
  }
  return renameSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.stage, 'release');
  assert.equal(receipt.diagnostics[0].code, 'delivery/lock-release');
  assert.equal(fs.existsSync(pendingPath), false);
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  assert.equal(provenance.status, 'current');
  assert.equal(lock.receiptId, provenance.receiptId);
  const strict = run(['check', out, '--require-provenance']);
  assert.equal(strict.status, 1, strict.stderr || strict.stdout);
  assert.equal(JSON.parse(strict.stdout).diagnostics[0].code, 'delivery/provenance-locked');
});

test('cli: portable delivery lock: failure-path release errors override the renderer status', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-failure-lock-release.html');
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const provenancePath = deliveryProvenancePath(out);
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const previousHash = sha256(out);
  const wrapper = path.join(tmp, 'delivery-failure-lock-release.mjs');
  fs.writeFileSync(wrapper, `
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const spawnSync = childProcess.spawnSync;
let rendererFailed = false;
childProcess.spawnSync = (executable, args, options) => {
  if (!rendererFailed && String(args?.[0]).includes('render-workflow.mjs')) {
    rendererFailed = true;
    return { status: 7, stdout: '', stderr: '' };
  }
  return spawnSync(executable, args, options);
};
syncBuiltinESMExports();
const renameSync = fs.renameSync;
fs.renameSync = (source, target) => {
  if (String(source) === ${JSON.stringify(lockPath)}
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    throw Object.assign(new Error('injected failure-path lock release error'), { code: 'EACCES' });
  }
  return renameSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.stage, 'render');
  assert.equal(receipt.provenance, 'failed');
  assert.equal(receipt.diagnostics[0].code, 'delivery/lock-release');
  assert.equal(receipt.diagnostics[1].code, 'internal/unclassified');
  assert.doesNotMatch(receipt.diagnostics[0].message, /committed/i);
  assert.equal(fs.existsSync(lockPath), true);
  assert.equal(fs.existsSync(pendingPath), true);
  assert.equal(JSON.parse(fs.readFileSync(provenancePath, 'utf8')).status, 'failed');
  assert.equal(sha256(out), previousHash);
});

test('cli: portable delivery lock: final cleanup preserves an unexpected primary failure when release also fails', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-unexpected-release-failure.html');
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const wrapper = path.join(tmp, 'delivery-unexpected-release-failure.mjs');
  const stagingBefore = deliveryStagingEntries(path.dirname(out));
  fs.writeFileSync(wrapper, `
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = (executable, args, options) => {
  if (String(args?.[0]).includes('render-workflow.mjs')) {
    throw new Error('injected unexpected renderer dispatch failure');
  }
  return spawnSync(executable, args, options);
};
syncBuiltinESMExports();
const renameSync = fs.renameSync;
fs.renameSync = (source, target) => {
  if (String(source) === ${JSON.stringify(lockPath)}
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    throw Object.assign(new Error('injected final lock release failure'), { code: 'EACCES' });
  }
  return renameSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  assert.match(failed.stderr, /injected unexpected renderer dispatch failure/);
  assert.match(failed.stderr, /\[delivery\/lock-release\]/);
  assert.match(failed.stderr, /injected final lock release failure/);
  assert.equal(fs.existsSync(lockPath), true);
  assert.equal(fs.existsSync(pendingPath), true);
  assert.deepEqual(
    deliveryStagingEntries(path.dirname(out)),
    stagingBefore,
  );
});

test('cli: portable delivery lock: final cleanup preserves successor state after unexpected ownership loss', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-unexpected-ownership-loss.html');
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const provenancePath = deliveryProvenancePath(out);
  const successor = successorDeliveryState({
    receiptId: '16161616-1616-4616-8616-161616161616',
    input,
    output: out,
  });
  const wrapper = path.join(tmp, 'delivery-unexpected-ownership-loss.mjs');
  const stagingBefore = new Set(deliveryStagingEntries(path.dirname(out)));
  fs.writeFileSync(wrapper, `
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = (executable, args, options) => {
  if (String(args?.[0]).includes('render-workflow.mjs')) {
    for (const [target, contents] of ${JSON.stringify([
      [lockPath, successor.lock],
      [pendingPath, successor.pending],
      [provenancePath, successor.provenance],
    ])}) {
      if (fs.existsSync(target)) fs.renameSync(target, \`${'${target}'}.owner-a\`);
      fs.writeFileSync(target, contents, { flag: 'wx' });
    }
    throw new Error('injected unexpected failure after successor takeover');
  }
  return spawnSync(executable, args, options);
};
syncBuiltinESMExports();
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  assert.match(failed.stderr, /injected unexpected failure after successor takeover/);
  assert.match(failed.stderr, /\[delivery\/ownership-lost\]/);
  assert.match(failed.stderr, /Recovery required:/);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  const recoveryDirectories = deliveryStagingEntries(path.dirname(out))
    .filter((entry) => !stagingBefore.has(entry));
  assert.equal(recoveryDirectories.length, 1);
  assert.equal(fs.existsSync(path.join(path.dirname(out), recoveryDirectories[0], 'specification.snapshot.json')), true);
});

test('cli: lock release failure does not invoke the requested opener', (t) => {
  if (process.platform === 'win32') {
    t.skip('fake open and xdg-open executables cover POSIX opener dispatch');
    return;
  }
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-lock-release-no-open.html');
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const fake = makeFakeOpeners('delivery-lock-release-no-open');
  const wrapper = path.join(tmp, 'delivery-lock-release-no-open.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const renameSync = fs.renameSync;
fs.renameSync = (source, target) => {
  if (String(source) === ${JSON.stringify(lockPath)}
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    throw Object.assign(new Error('injected lock release failure'), { code: 'EACCES' });
  }
  return renameSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json', '--open'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: fake.env,
  });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  assert.equal(JSON.parse(failed.stdout).diagnostics[0].code, 'delivery/lock-release');
  assert.equal(fs.existsSync(fake.log), false);
});

test('cli: delivery cleanup preserves an unexpected claimant in private staging', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-staging-claimant.html');
  const stagingBefore = new Set(deliveryStagingEntries(path.dirname(out)));
  const wrapper = path.join(tmp, 'delivery-staging-claimant.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const rmdirSync = fs.rmdirSync.bind(fs);
let claimed = false;
fs.rmdirSync = (directory, ...args) => {
  if (!claimed && path.basename(String(directory)).startsWith('.archify-delivery-')) {
    claimed = true;
    fs.writeFileSync(path.join(directory, 'unknown-claimant.txt'), 'preserve delivery claimant');
  }
  return rmdirSync(directory, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const delivered = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  assert.equal(JSON.parse(delivered.stdout).ok, true);
  assert.match(delivered.stderr, /Warning: could not remove delivery staging directory/);
  const recoveryRoot = fs.readdirSync(path.dirname(out), { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.startsWith('.archify-staging-remove-'));
  assert.ok(recoveryRoot);
  const staging = deliveryStagingEntries(path.join(path.dirname(out), recoveryRoot.name))
    .find((entry) => !stagingBefore.has(entry));
  assert.ok(staging);
  assert.equal(
    fs.readFileSync(path.join(
      path.dirname(out),
      recoveryRoot.name,
      staging,
      'unknown-claimant.txt',
    ), 'utf8'),
    'preserve delivery claimant',
  );
});

test('cli: delivery staging cleanup retries transient remote ENOTEMPTY', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const directory = fs.mkdtempSync(path.join(tmp, 'delivery-staging-transient-enotempty-'));
  const out = path.join(directory, 'diagram.html');
  const observation = path.join(directory, 'observation.json');
  const wrapper = path.join(directory, 'inject-enotempty.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const rmdirSync = fs.rmdirSync.bind(fs);
let injected = false;
fs.rmdirSync = (directory, ...args) => {
  if (!injected
      && path.basename(path.dirname(String(directory))).startsWith('.archify-staging-remove-')
      && path.basename(String(directory)).startsWith('.archify-delivery-')) {
    injected = true;
    throw Object.assign(new Error('simulated remote deletion visibility delay'), { code: 'ENOTEMPTY' });
  }
  return rmdirSync(directory, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
fs.writeFileSync(${JSON.stringify(observation)}, JSON.stringify({ injected }));
`);

  const delivered = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  assert.equal(JSON.parse(delivered.stdout).ok, true);
  assert.equal(JSON.parse(fs.readFileSync(observation, 'utf8')).injected, true);
  assert.doesNotMatch(delivered.stderr, /Warning: could not remove delivery staging directory/);
  assert.deepEqual(deliveryStagingEntries(path.dirname(out)), []);
  assert.deepEqual(
    fs.readdirSync(path.dirname(out))
      .filter((entry) => entry.startsWith('.archify-staging-remove-')),
    [],
  );
});

test('cli: delivery staging cleanup retries a stale remote directory listing', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const directory = fs.mkdtempSync(path.join(tmp, 'delivery-staging-stale-listing-'));
  const out = path.join(directory, 'diagram.html');
  const observation = path.join(directory, 'observation.json');
  const wrapper = path.join(directory, 'inject-stale-listing.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const readdirSync = fs.readdirSync.bind(fs);
let injected = false;
fs.readdirSync = (directory, ...args) => {
  if (!injected && path.basename(String(directory)).startsWith('.archify-delivery-')) {
    injected = true;
    return ['recently-deleted-entry.tmp'];
  }
  return readdirSync(directory, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
fs.writeFileSync(${JSON.stringify(observation)}, JSON.stringify({ injected }));
`);

  const delivered = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  assert.equal(JSON.parse(delivered.stdout).ok, true);
  assert.equal(JSON.parse(fs.readFileSync(observation, 'utf8')).injected, true);
  assert.doesNotMatch(delivered.stderr, /Warning: could not remove delivery staging directory/);
  assert.deepEqual(deliveryStagingEntries(path.dirname(out)), []);
});

test('cli: delivery closes every candidate handle before cleaning delete-pending remote entries', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const directory = fs.mkdtempSync(path.join(tmp, 'delivery-remote-open-handles-'));
  const out = path.join(directory, 'diagram.html');
  const observation = path.join(directory, 'observation.json');
  const wrapper = path.join(directory, 'simulate-delete-pending.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const openSync = fs.openSync.bind(fs);
const fstatSync = fs.fstatSync.bind(fs);
const closeSync = fs.closeSync.bind(fs);
const unlinkSync = fs.unlinkSync.bind(fs);
const rmdirSync = fs.rmdirSync.bind(fs);
const handles = new Map();
const pendingDirectories = new Map();
const multiplyBoundFiles = new Set();
const identity = (metadata) => String(metadata.dev) + ':' + String(metadata.ino);
let blockedRemovals = 0;
fs.openSync = (file, ...args) => {
  const descriptor = openSync(file, ...args);
  const metadata = fstatSync(descriptor, { bigint: true });
  if (metadata.isFile()) handles.set(descriptor, {
    identity: identity(metadata), file: path.basename(String(file)),
  });
  return descriptor;
};
fs.closeSync = (descriptor) => {
  const result = closeSync(descriptor);
  handles.delete(descriptor);
  return result;
};
fs.unlinkSync = (file) => {
  const parent = path.dirname(String(file));
  if (path.basename(parent).startsWith('.archify-remove-')) {
    const key = identity(fs.lstatSync(file, { bigint: true }));
    pendingDirectories.set(parent, key);
    const owners = [...handles.values()].filter((owner) => owner.identity === key);
    if (owners.length > 1) owners.forEach((owner) => multiplyBoundFiles.add(owner.file));
  }
  return unlinkSync(file);
};
fs.rmdirSync = (directory, ...args) => {
  const key = pendingDirectories.get(String(directory));
  if (key && [...handles.values()].some((owner) => owner.identity === key)) {
    blockedRemovals += 1;
    throw Object.assign(new Error('remote child deletion waits for all open handles'), { code: 'ENOTEMPTY' });
  }
  const result = rmdirSync(directory, ...args);
  pendingDirectories.delete(String(directory));
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
fs.writeFileSync(${JSON.stringify(observation)}, JSON.stringify({
  blockedRemovals,
  multiplyBoundFiles: [...multiplyBoundFiles],
  remainingHandles: handles.size,
  pendingDirectories: [...pendingDirectories.keys()],
}));
`);

  const delivered = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  assert.equal(JSON.parse(delivered.stdout).ok, true);
  const observed = JSON.parse(fs.readFileSync(observation, 'utf8'));
  assert.ok(observed.blockedRemovals > 0, JSON.stringify(observed));
  assert.ok(observed.multiplyBoundFiles.includes('diagram.html'), JSON.stringify(observed));
  assert.ok(observed.multiplyBoundFiles.includes('delivery-provenance.json'), JSON.stringify(observed));
  assert.equal(observed.remainingHandles, 0);
  assert.deepEqual(observed.pendingDirectories, []);
  assert.equal(delivered.stderr, '');
  assert.deepEqual(fs.readdirSync(directory).filter((name) => name.startsWith('.archify-')), []);
});

test('cli: repeated lock handle identity failures close the descriptor, remove only the owned lock, and permit retry', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-lock-first-fstat.html');
  const lockPath = deliveryLockPath(out);
  const closeEvidence = path.join(tmp, 'delivery-lock-first-fstat-close.json');
  const wrapper = path.join(tmp, 'delivery-lock-first-fstat.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const openSync = fs.openSync;
const fstatSync = fs.fstatSync;
const closeSync = fs.closeSync;
let lockDescriptor;
let injected = 0;
let lockClosed = false;
fs.openSync = (file, ...args) => {
  const descriptor = openSync(file, ...args);
  if (lockDescriptor === undefined && String(file) === ${JSON.stringify(lockPath)}) {
    lockDescriptor = descriptor;
  }
  return descriptor;
};
fs.fstatSync = (descriptor, ...args) => {
  if (descriptor === lockDescriptor && injected < 2) {
    injected += 1;
    throw Object.assign(new Error('injected repeated lock fstat failure'), { code: 'EIO' });
  }
  return fstatSync(descriptor, ...args);
};
fs.closeSync = (descriptor, ...args) => {
  if (descriptor === lockDescriptor) lockClosed = true;
  return closeSync(descriptor, ...args);
};
process.on('exit', () => fs.writeFileSync(${JSON.stringify(closeEvidence)}, JSON.stringify({ lockClosed, injected })));
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  assert.equal(JSON.parse(failed.stdout).diagnostics[0].code, 'delivery/lock-acquire');
  assert.deepEqual(JSON.parse(fs.readFileSync(closeEvidence, 'utf8')), {
    lockClosed: true,
    injected: 2,
  });
  assert.equal(fs.existsSync(lockPath), false, 'failed identity capture leaked the public lock');
  const retry = run(['deliver', 'workflow', input, out, '--json']);
  assert.equal(retry.status, 0, retry.stderr || retry.stdout);
});

test('cli: repeated lock handle identity failures preserve a claimant that replaces the owned entry', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-lock-repeated-fstat-claimant.html');
  const lockPath = deliveryLockPath(out);
  const detachedOwnedLock = `${lockPath}.detached-double-fstat`;
  const closeEvidence = path.join(tmp, 'delivery-lock-repeated-fstat-claimant-close.json');
  const claimant = 'unrelated lock claimant\n';
  const wrapper = path.join(tmp, 'delivery-lock-repeated-fstat-claimant.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const openSync = fs.openSync.bind(fs);
const fstatSync = fs.fstatSync.bind(fs);
const closeSync = fs.closeSync.bind(fs);
const writeFileSync = fs.writeFileSync.bind(fs);
let lockDescriptor;
let injected = 0;
let replaced = false;
let lockClosed = false;
fs.openSync = (file, ...args) => {
  const descriptor = openSync(file, ...args);
  if (lockDescriptor === undefined && String(file) === ${JSON.stringify(lockPath)}) lockDescriptor = descriptor;
  return descriptor;
};
fs.fstatSync = (descriptor, ...args) => {
  if (descriptor === lockDescriptor && injected < 2) {
    injected += 1;
    throw Object.assign(new Error('injected repeated lock fstat failure'), { code: 'EIO' });
  }
  return fstatSync(descriptor, ...args);
};
fs.writeFileSync = (file, ...args) => {
  const result = writeFileSync(file, ...args);
  if (!replaced && file === lockDescriptor) {
    replaced = true;
    fs.renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(detachedOwnedLock)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(claimant)}, { flag: 'wx' });
  }
  return result;
};
fs.closeSync = (descriptor, ...args) => {
  if (descriptor === lockDescriptor) lockClosed = true;
  return closeSync(descriptor, ...args);
};
process.on('exit', () => writeFileSync(${JSON.stringify(closeEvidence)}, JSON.stringify({ lockClosed, injected, replaced })));
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(closeEvidence, 'utf8')), {
    lockClosed: true,
    injected: 2,
    replaced: true,
  });
  assert.equal(fs.readFileSync(lockPath, 'utf8'), claimant);
  assert.equal(fs.existsSync(detachedOwnedLock), true);
});

for (const failureMode of ['empty-write', 'partial-write', 'close', 'replacement', 'cleanup-failure']) {
  test(`cli: portable delivery lock: failed lock initialization is cleaned up and delivery can retry (${failureMode})`, () => {
    const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
    const out = path.join(tmp, `lock-init-${failureMode}.html`);
    assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
    const previousHash = sha256(out);
    const lockPath = deliveryLockPath(out);
    const wrapper = path.join(tmp, `lock-init-${failureMode}.mjs`);
    fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const openSync = fs.openSync;
let lockDescriptor;
fs.openSync = (file, ...args) => {
  const descriptor = openSync(file, ...args);
  if (String(file) === ${JSON.stringify(lockPath)}) lockDescriptor = descriptor;
  return descriptor;
};
const mode = ${JSON.stringify(failureMode)};
const method = mode === 'close' ? 'closeSync' : 'writeFileSync';
const original = fs[method];
if (mode === 'zero-identity-replacement') {
  const fstatSync = fs.fstatSync;
  const lstatSync = fs.lstatSync;
  fs.fstatSync = (descriptor, ...args) => {
    const entry = fstatSync(descriptor, ...args);
    return descriptor === lockDescriptor ? { ...entry, ino: 0 } : entry;
  };
  fs.lstatSync = (file, ...args) => {
    const entry = lstatSync(file, ...args);
    return String(file) === ${JSON.stringify(lockPath)}
      ? { ...entry, ino: 0, isFile: () => entry.isFile() }
      : entry;
  };
}
if (mode === 'cleanup-failure') {
  const renameSync = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (String(source) === ${JSON.stringify(lockPath)}
        && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
      throw Object.assign(new Error('injected lock cleanup failure'), { code: 'EACCES' });
    }
    return renameSync(source, target);
  };
}
let injected = false;
fs[method] = (descriptor, ...args) => {
  if (descriptor === lockDescriptor && !injected) {
    injected = true;
    if (mode === 'partial-write') original(descriptor, '{');
    if (mode === 'replacement' || mode === 'zero-identity-replacement') {
      fs.renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owned`)});
      original(${JSON.stringify(lockPath)}, 'unrelated replacement');
    }
    throw Object.assign(new Error('injected lock initialization failure'), { code: 'ENOSPC' });
  }
  return original(descriptor, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
    const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    const replacementMode = failureMode === 'replacement' || failureMode === 'zero-identity-replacement';
    const expectedDiagnostic = replacementMode
      ? 'delivery/ownership-lost'
      : failureMode === 'cleanup-failure'
        ? 'delivery/lock-release'
        : 'delivery/lock-acquire';
    assert.equal(receipt.diagnostics[0].code, expectedDiagnostic);
    if (replacementMode || failureMode === 'cleanup-failure') {
      assert.equal(receipt.diagnostics[0].evidence.initializationSystemCode, 'ENOSPC');
    } else {
      assert.equal(receipt.diagnostics[0].evidence.systemCode, 'ENOSPC');
    }
    assert.equal(sha256(out), previousHash);
    const expectedProvenanceCode = replacementMode
      ? /^delivery\/provenance-locked$/
      : /^delivery\/provenance-failed$/;
    for (const args of [
      ['check', out],
      ['check', out, '--require-provenance'],
    ]) {
      const checked = run(args);
      assert.equal(checked.status, 1, checked.stderr || checked.stdout);
      assertCheckFailureReceipt(JSON.parse(checked.stdout), out, expectedProvenanceCode);
    }
    if (replacementMode) {
      assert.equal(fs.readFileSync(lockPath, 'utf8'), 'unrelated replacement');
      assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 1);
      return;
    }
    if (failureMode === 'cleanup-failure') {
      assert.equal(fs.existsSync(lockPath), true);
      assert.equal(receipt.provenance, 'failed');
      assert.equal(receipt.diagnostics[0].evidence.systemCode, 'EACCES');
      assert.match(receipt.diagnostics[0].evidence.reason, /injected lock cleanup failure/);
      assert.doesNotMatch(receipt.diagnostics[0].message, /committed/i);
      return;
    }
    assert.equal(fs.existsSync(lockPath), false);
    const retry = run(['deliver', 'workflow', input, out, '--json']);
    assert.equal(retry.status, 0, retry.stderr || retry.stdout);
    assert.equal(run(['check', out, '--require-provenance']).status, 0);
  });
}

test('cli: portable delivery lock: initialization ownership loss cannot claim failed provenance', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'lock-init-ownership-loss.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '14141414-1414-4414-8414-141414141414',
    input,
    output: out,
  });
  const wrapper = path.join(tmp, 'lock-init-ownership-loss.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const openSync = fs.openSync;
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
const linkSync = fs.linkSync;
let lockDescriptor;
let initializationFailed = false;
let successorInstalled = false;
fs.openSync = (file, ...args) => {
  const descriptor = openSync(file, ...args);
  if (String(file) === ${JSON.stringify(lockPath)}) lockDescriptor = descriptor;
  return descriptor;
};
fs.writeFileSync = (file, ...args) => {
  if (file === lockDescriptor && !initializationFailed) {
    initializationFailed = true;
    throw Object.assign(new Error('injected lock initialization failure'), { code: 'ENOSPC' });
  }
  return writeFileSync(file, ...args);
};
fs.linkSync = (source, target) => {
  const result = linkSync(source, target);
  if (!successorInstalled && initializationFailed
      && String(target) === ${JSON.stringify(provenancePath)}
      && path.basename(path.dirname(String(source))).startsWith('.archify-provenance-')) {
    successorInstalled = true;
    renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owner-a`)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successor.lock)}, { flag: 'wx' });
    writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)});
    renameSync(target, String(target) + '.owner-a');
    writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successor.provenance)});
    writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(successor.artifact)});
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/provenance-recovery-required');
  assert.ok(!('provenance' in receipt) || receipt.provenance === 'unrecorded');
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  const initialization = receipt.diagnostics.find(({ code }) => code === 'delivery/lock-acquire');
  assert.equal(initialization.evidence.systemCode, 'ENOSPC');
  assert.equal(fs.readFileSync(out, 'utf8'), successor.artifact);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
});

test('cli: portable delivery lock: a raw acquisition error does not obscure the input diagnosis', () => {
  const input = path.join(tmp, 'invalid-input-before-lock.json');
  const out = path.join(tmp, 'missing-output-parent', 'invalid-input.html');
  fs.writeFileSync(input, '{ invalid json');

  const failed = run(['deliver', 'workflow', input, out, '--json']);

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.stage, 'input');
  assert.equal(receipt.diagnostics[0].code, 'input/json-parse');
  assert.equal(receipt.diagnostics[1].code, 'delivery/lock-acquire');
  assert.equal(receipt.diagnostics[1].evidence.systemCode, 'ENOENT');
  assert.equal(fs.existsSync(out), false);
});

test('cli: delivery lock cannot replace its input specification', () => {
  const input = path.join(tmp, '.archify-delivery-lock.json');
  const source = fs.readFileSync(path.join(skillRoot, 'examples/agent-tool-call.workflow.json'));
  fs.writeFileSync(input, source);
  const out = path.join(tmp, 'lock-input-alias.html');
  const result = run(['deliver', 'workflow', input, out, '--json']);
  assert.equal(result.status, 1);
  assert.deepEqual(fs.readFileSync(input), source);
  assert.equal(fs.existsSync(out), false);
  assert.equal('provenance' in JSON.parse(result.stdout), false);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'delivery/lock-path-conflict');
});

test('cli: portable delivery lock: a symlink lock is invalid even when it targets the input', (t) => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'symlink-lock-to-input.html');
  const lockPath = deliveryLockPath(out);
  try {
    fs.symlinkSync(input, lockPath, 'file');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip('symlink creation requires permission');
      return;
    }
    throw error;
  }

  const result = run(['deliver', 'workflow', input, out, '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'delivery/lock-invalid');
  assert.equal(fs.lstatSync(lockPath).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(lockPath), input);
  assert.equal(fs.existsSync(out), false);
});

test('cli: an unrecognized delivery lock preserves user data and invalidates the previous artifact', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'unrecognized-lock.html');
  const lock = deliveryLockPath(out);
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, sentinel: 'user data' }));
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const previousHash = sha256(out);
  fs.writeFileSync(lock, bytes);
  const result = run(['deliver', 'workflow', replacementInput, out, '--json']);
  assert.equal(result.status, 1);
  assert.deepEqual(fs.readFileSync(lock), bytes);
  assert.equal(sha256(out), previousHash);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'delivery/lock-invalid');
  for (const args of [
    ['check', out],
    ['check', out, '--require-provenance'],
  ]) {
    const checked = run(args);
    assert.equal(checked.status, 1, checked.stderr || checked.stdout);
    assertCheckFailureReceipt(JSON.parse(checked.stdout), out, /^delivery\/provenance-locked$/);
  }
  for (const args of [
    ['visual-check', out, '--json'],
    ['visual-check', out, '--json', '--require-provenance'],
  ]) {
    const checked = run(args);
    assert.equal(checked.status, 1, checked.stderr || checked.stdout);
    const receipt = JSON.parse(checked.stdout);
    assert.equal(receipt.provenance, 'locked');
    assert.equal(receipt.diagnostics[0].code, 'delivery/provenance-locked');
  }
});

test('cli: a legacy per-artifact delivery lock remains a fail-closed migration barrier', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'legacy-lock-migration.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(out);
  const provenancePath = deliveryProvenancePath(out);
  const provenanceBefore = fs.readFileSync(provenancePath);
  const legacyLock = legacyDeliveryLockPath(out);
  const exited = spawnSync(process.execPath, ['-e', '']);
  assert.equal(exited.status, 0);
  fs.writeFileSync(legacyLock, `${JSON.stringify({
    schemaVersion: 1,
    receiptId: '17171717-1717-4717-8717-171717171717',
    pid: exited.pid,
  })}\n`);

  const failed = run(['deliver', 'workflow', replacementInput, out, '--json']);

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const failure = JSON.parse(failed.stdout);
  assert.equal(failure.diagnostics[0].code, 'delivery/lock-stale');
  assert.equal(failure.diagnostics[0].subject.lock, legacyLock);
  assert.deepEqual(fs.readFileSync(out), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenancePath), provenanceBefore);
  assert.equal(fs.existsSync(deliveryLockPath(out)), false);
  assert.equal(fs.existsSync(legacyLock), true);

  const checked = run(['check', out, '--require-provenance']);
  assert.equal(checked.status, 1, checked.stderr || checked.stdout);
  const checkFailure = JSON.parse(checked.stdout);
  assert.equal(checkFailure.provenance, 'locked');
  assert.equal(checkFailure.diagnostics[0].subject.lock, legacyLock);
});

test('cli: a legacy lock beside a symlinked artifact target remains a migration barrier', (t) => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const root = path.join(tmp, 'legacy-target-lock-symlink');
  const realDirectory = path.join(root, 'real');
  const aliasDirectory = path.join(root, 'alias');
  fs.mkdirSync(realDirectory, { recursive: true });
  fs.mkdirSync(aliasDirectory, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const realOutput = path.join(realDirectory, 'diagram.html');
  const aliasOutput = path.join(aliasDirectory, 'alias.html');
  assert.equal(run(['deliver', 'workflow', initialInput, realOutput, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(realOutput);
  const provenancePath = deliveryProvenancePath(realOutput);
  const provenanceBefore = fs.readFileSync(provenancePath);
  try {
    fs.symlinkSync(realOutput, aliasOutput, 'file');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip(`file symlink creation requires Windows permission (${error.code})`);
      return;
    }
    throw error;
  }
  const targetLegacyLock = legacyDeliveryLockPath(fs.realpathSync.native(realOutput));
  const exited = spawnSync(process.execPath, ['-e', '']);
  assert.equal(exited.status, 0);
  fs.writeFileSync(targetLegacyLock, `${JSON.stringify({
    schemaVersion: 1,
    receiptId: '19191919-1919-4919-8919-191919191919',
    pid: exited.pid,
  })}\n`);

  const failed = run(['deliver', 'workflow', replacementInput, aliasOutput, '--json']);

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const failure = JSON.parse(failed.stdout);
  assert.equal(failure.diagnostics[0].code, 'delivery/lock-stale');
  assert.equal(failure.diagnostics[0].subject.lock, targetLegacyLock);
  assert.equal(fs.lstatSync(aliasOutput).isSymbolicLink(), true);
  assert.deepEqual(fs.readFileSync(realOutput), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenancePath), provenanceBefore);
  assert.equal(fs.existsSync(deliveryLockPath(aliasOutput)), false);

  const checked = run(['check', aliasOutput, '--require-provenance']);
  assert.equal(checked.status, 1, checked.stderr || checked.stdout);
  const checkFailure = JSON.parse(checked.stdout);
  assert.equal(checkFailure.provenance, 'locked');
  assert.equal(checkFailure.diagnostics[0].subject.lock, targetLegacyLock);
});

test('cli: an active delivery fences old binaries at both lexical and physical artifact paths', async (t) => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const root = path.join(tmp, 'dual-lock-active-symlink');
  const realDirectory = path.join(root, 'real');
  const aliasDirectory = path.join(root, 'alias');
  fs.mkdirSync(realDirectory, { recursive: true });
  fs.mkdirSync(aliasDirectory, { recursive: true });
  const realOutput = path.join(realDirectory, 'diagram.html');
  const aliasOutput = path.join(aliasDirectory, 'alias.html');
  assert.equal(run(['deliver', 'workflow', initialInput, realOutput, '--json']).status, 0);
  try {
    fs.symlinkSync(realOutput, aliasOutput, 'file');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip(`file symlink creation requires Windows permission (${error.code})`);
      return;
    }
    throw error;
  }
  const lexicalLegacyLock = legacyDeliveryLockPath(aliasOutput);
  const physicalLegacyLock = legacyDeliveryLockPath(fs.realpathSync.native(realOutput));
  const globalLock = deliveryLockPath(aliasOutput);
  const ready = path.join(root, 'active.ready');
  const release = path.join(root, 'active.release');
  const wrapper = path.join(root, 'hold-active.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const writeFileSync = fs.writeFileSync;
fs.writeFileSync = (file, value, options) => {
  const result = writeFileSync(file, value, options);
  if (String(file).endsWith('specification.snapshot.json')) {
    writeFileSync(${JSON.stringify(ready)}, 'ready');
    while (!fs.existsSync(${JSON.stringify(release)})) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(aliasOutput)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const active = spawn(process.execPath, [wrapper], { cwd: skillRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  active.stdout.on('data', (chunk) => { stdout += chunk; });
  active.stderr.on('data', (chunk) => { stderr += chunk; });
  const activeExit = new Promise((resolve) => {
    active.once('close', (code, signal) => resolve({ code, signal }));
  });
  t.after(() => {
    if (!fs.existsSync(release)) fs.writeFileSync(release, 'release');
    if (active.exitCode === null && active.signalCode === null) active.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(ready) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.existsSync(ready), true, stderr || stdout);
  assert.equal(fs.existsSync(globalLock), true);
  assert.equal(fs.existsSync(lexicalLegacyLock), true);
  assert.equal(fs.existsSync(physicalLegacyLock), true);
  for (const oldLockPath of [lexicalLegacyLock, physicalLegacyLock]) {
    assert.throws(
      () => fs.openSync(oldLockPath, 'wx', 0o600),
      (error) => error?.code === 'EEXIST',
    );
  }

  fs.writeFileSync(release, 'release');
  assert.deepEqual(await activeExit, { code: 0, signal: null }, stderr || stdout);
  assert.equal(fs.existsSync(globalLock), false);
  assert.equal(fs.existsSync(lexicalLegacyLock), false);
  assert.equal(fs.existsSync(physicalLegacyLock), false);
});

test('cli: a legacy-fence acquisition failure cleans every lock created by the new attempt', (t) => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const root = path.join(tmp, 'dual-lock-acquire-cleanup');
  const realDirectory = path.join(root, 'real');
  const aliasDirectory = path.join(root, 'alias');
  fs.mkdirSync(realDirectory, { recursive: true });
  fs.mkdirSync(aliasDirectory, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const realOutput = path.join(realDirectory, 'diagram.html');
  const aliasOutput = path.join(aliasDirectory, 'alias.html');
  assert.equal(run(['deliver', 'workflow', initialInput, realOutput, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(realOutput);
  const provenancePath = deliveryProvenancePath(realOutput);
  const provenanceBefore = fs.readFileSync(provenancePath);
  try {
    fs.symlinkSync(realOutput, aliasOutput, 'file');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip(`file symlink creation requires Windows permission (${error.code})`);
      return;
    }
    throw error;
  }
  const lexicalLegacyLock = legacyDeliveryLockPath(aliasOutput);
  const physicalLegacyLock = legacyDeliveryLockPath(fs.realpathSync.native(realOutput));
  const globalLock = deliveryLockPath(aliasOutput);
  const wrapper = path.join(root, 'fail-physical-legacy-fence.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const openSync = fs.openSync;
fs.openSync = (file, ...args) => {
  if (String(file) === ${JSON.stringify(physicalLegacyLock)}) {
    throw Object.assign(new Error('injected legacy fence acquisition failure'), { code: 'EACCES' });
  }
  return openSync(file, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(aliasOutput)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  assert.equal(JSON.parse(failed.stdout).diagnostics[0].code, 'delivery/lock-acquire');
  assert.equal(fs.existsSync(globalLock), false);
  assert.equal(fs.existsSync(lexicalLegacyLock), false);
  assert.equal(fs.existsSync(physicalLegacyLock), false);
  assert.equal(fs.lstatSync(aliasOutput).isSymbolicLink(), true);
  assert.deepEqual(fs.readFileSync(realOutput), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenancePath), provenanceBefore);
});

test('cli: delivery provenance cannot replace its input specification', () => {
  const input = path.join(tmp, 'provenance-input-alias.delivery.json');
  const source = fs.readFileSync(path.join(skillRoot, 'examples/agent-tool-call.workflow.json'));
  fs.writeFileSync(input, source);
  const out = input.replace(/\.delivery\.json$/, '.html');

  const result = run(['deliver', 'workflow', input, out, '--json']);

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.stage, 'prepare');
  assert.equal(failure.diagnostics[0].code, 'output/input-alias');
  assert.deepEqual(fs.readFileSync(input), source);
  assert.equal(fs.existsSync(out), false);
});

test('cli: rejected authored output does not write provenance outside the working directory', () => {
  const parent = path.join(tmp, 'rejected-authored-output');
  const workingDirectory = path.join(parent, 'work');
  fs.mkdirSync(workingDirectory, { recursive: true });
  const input = path.join(workingDirectory, 'input.workflow.json');
  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/agent-tool-call.workflow.json'), 'utf8'));
  diagram.meta = { ...diagram.meta, output: '../victim.html' };
  fs.writeFileSync(input, JSON.stringify(diagram));
  const victim = path.join(parent, 'victim.html');
  const sidecar = path.join(parent, 'victim.delivery.json');
  const pending = path.join(parent, 'victim.delivery-pending.json');
  const artifactBytes = Buffer.from('<!doctype html><title>untouched</title>\n');
  const sidecarBytes = Buffer.from('{"status":"current","sentinel":true}\n');
  fs.writeFileSync(victim, artifactBytes);
  fs.writeFileSync(sidecar, sidecarBytes);

  const result = run(['deliver', 'workflow', input, '--json'], { cwd: workingDirectory });

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.diagnostics[0].code, 'output/meta-path-syntax');
  assert.deepEqual(fs.readFileSync(victim), artifactBytes);
  assert.deepEqual(fs.readFileSync(sidecar), sidecarBytes);
  assert.equal(fs.existsSync(pending), false);
  assert.equal('provenance' in failure, false);
});

test('cli: a failed provenance marker write and invalidation still leave a fail-closed journal', () => {
  const validInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const invalidInput = path.join(tmp, 'marker-write-failure.workflow.json');
  const invalid = JSON.parse(fs.readFileSync(validInput, 'utf8'));
  invalid.nodes[0].unexpected = true;
  fs.writeFileSync(invalidInput, JSON.stringify(invalid));
  const out = path.join(tmp, 'marker-write-failure.html');
  assert.equal(run(['deliver', 'workflow', validInput, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const pendingPath = deliveryPendingPath(out);
  const priorProvenance = fs.readFileSync(provenancePath);

  const wrapper = path.join(tmp, 'fail-marker-write.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const linkSync = fs.linkSync;
fs.linkSync = (source, target) => {
  if (String(source).includes('.archify-provenance-')
      && !String(source).endsWith('.previous-provenance')
      && String(target) === ${JSON.stringify(provenancePath)}) {
    const error = new Error('injected failure marker publish error');
    error.code = 'EACCES';
    throw error;
  }
  return linkSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(invalidInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.provenance, 'unrecorded');
  assert.ok(failure.diagnostics.some((entry) => entry.code === 'delivery/provenance-write'));
  assert.deepEqual(fs.readFileSync(provenancePath), priorProvenance);
  assert.equal(fs.existsSync(pendingPath), true);
  const permissive = run(['check', out]);
  assert.equal(permissive.status, 1);
  assertCheckFailureReceipt(
    JSON.parse(permissive.stdout),
    out,
    /^delivery\/provenance-failed$/,
  );
  const strict = run(['check', out, '--require-provenance']);
  assert.equal(strict.status, 1);
  assertCheckFailureReceipt(
    JSON.parse(strict.stdout),
    out,
    /^delivery\/provenance-failed$/,
  );
});

test('cli: failed-provenance candidate retirement preserves a replacement claimant', () => {
  const validInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const invalidInput = path.join(tmp, 'failed-provenance-retirement.workflow.json');
  const invalid = JSON.parse(fs.readFileSync(validInput, 'utf8'));
  invalid.nodes[0].unexpected = true;
  fs.writeFileSync(invalidInput, JSON.stringify(invalid));
  const out = path.join(tmp, 'failed-provenance-retirement.html');
  assert.equal(run(['deliver', 'workflow', validInput, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const candidateName = path.basename(provenancePath);
  const claimant = '{"claimant":"failed provenance candidate retirement"}\n';
  const claimantIdentityFile = path.join(tmp, 'failed-provenance-retirement-identity.json');
  const displacedCandidate = path.join(tmp, 'failed-provenance-retirement-displaced');
  const priorStaging = fs.readdirSync(path.dirname(out))
    .filter((name) => name.startsWith('.archify-provenance-'))
    .sort();
  const wrapper = path.join(tmp, 'replace-failed-provenance-candidate-at-retirement.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const unlinkSync = fs.unlinkSync;
const renameSync = fs.renameSync;
const writeFileSync = fs.writeFileSync;
let replaced = false;
const isCandidate = (file) => (
  path.basename(String(file)) === ${JSON.stringify(candidateName)}
  && path.basename(path.dirname(String(file))).startsWith('.archify-provenance-')
);
const replaceCandidate = (file) => {
  replaced = true;
  renameSync(file, ${JSON.stringify(displacedCandidate)});
  writeFileSync(file, ${JSON.stringify(claimant)}, { flag: 'wx' });
  const stat = fs.lstatSync(file, { bigint: true });
  writeFileSync(${JSON.stringify(claimantIdentityFile)}, JSON.stringify({
    dev: String(stat.dev),
    ino: String(stat.ino),
  }));
};
fs.unlinkSync = (file, ...args) => {
  if (!replaced && isCandidate(file)) replaceCandidate(file);
  return unlinkSync(file, ...args);
};
fs.renameSync = (source, target, ...args) => {
  if (!replaced
      && isCandidate(source)
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    replaceCandidate(source);
  }
  return renameSync(source, target, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(invalidInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const staging = fs.readdirSync(path.dirname(out))
    .filter((name) => name.startsWith('.archify-provenance-'))
    .filter((name) => !priorStaging.includes(name));
  assert.equal(staging.length, 1, failed.stderr || failed.stdout);
  const candidate = path.join(path.dirname(out), staging[0], candidateName);
  assert.equal(fs.readFileSync(candidate, 'utf8'), claimant);
  const claimantIdentity = fs.lstatSync(candidate, { bigint: true });
  assert.deepEqual(
    { dev: String(claimantIdentity.dev), ino: String(claimantIdentity.ino) },
    JSON.parse(fs.readFileSync(claimantIdentityFile, 'utf8')),
  );
  assert.equal(fs.existsSync(displacedCandidate), true);
});

test('cli: provenance staging cleanup preserves a directory claimant at the removal boundary', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'provenance-cleanup-claimant.html');
  const observation = path.join(tmp, 'provenance-cleanup-claimant.json');
  const wrapper = path.join(tmp, 'claim-provenance-staging-cleanup.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const rmSync = fs.rmSync.bind(fs);
const rmdirSync = fs.rmdirSync.bind(fs);
let injected = false;
let stagingDirectory;
let claimant;
function inject(target) {
  if (injected || !path.basename(String(target)).startsWith('.archify-provenance-')) return;
  injected = true;
  stagingDirectory = String(target);
  fs.renameSync(stagingDirectory, stagingDirectory + '.owned');
  fs.mkdirSync(stagingDirectory);
  claimant = path.join(stagingDirectory, 'claimant.txt');
  fs.writeFileSync(claimant, 'claimant-owned\\n');
}
fs.rmSync = (target, ...args) => {
  inject(target);
  return rmSync(target, ...args);
};
fs.rmdirSync = (target, ...args) => {
  inject(target);
  return rmdirSync(target, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
fs.writeFileSync(${JSON.stringify(observation)}, JSON.stringify({
  injected,
  stagingDirectory,
  claimantSurvived: claimant ? fs.existsSync(claimant) : false,
  claimantBytes: claimant && fs.existsSync(claimant) ? fs.readFileSync(claimant, 'utf8') : null,
}));
`);

  const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const state = JSON.parse(fs.readFileSync(observation, 'utf8'));
  assert.equal(state.injected, true, 'the cleanup-boundary claimant must be installed');
  assert.equal(state.claimantSurvived, true, 'cleanup must not recursively delete claimant contents');
  assert.equal(state.claimantBytes, 'claimant-owned\n');
  assert.equal(fs.existsSync(out), true);
});

test('cli: delivery staging cleanup preserves an empty directory claimant at the removal boundary', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-cleanup-empty-claimant.html');
  const observation = path.join(tmp, 'delivery-cleanup-empty-claimant.json');
  const wrapper = path.join(tmp, 'claim-delivery-staging-cleanup.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const renameSync = fs.renameSync.bind(fs);
const rmdirSync = fs.rmdirSync.bind(fs);
let injected = false;
let claimantIdentity;
function inject(target) {
  if (injected || !path.basename(String(target)).startsWith('.archify-delivery-')) return;
  injected = true;
  const stagingDirectory = String(target);
  renameSync(stagingDirectory, stagingDirectory + '.owned');
  fs.mkdirSync(stagingDirectory);
  const metadata = fs.lstatSync(stagingDirectory, { bigint: true });
  claimantIdentity = { dev: metadata.dev, ino: metadata.ino };
}
fs.rmdirSync = (target, ...args) => {
  inject(target);
  return rmdirSync(target, ...args);
};
fs.renameSync = (source, target, ...args) => {
  if (path.basename(path.dirname(String(target))).startsWith('.archify-staging-remove-')) {
    inject(source);
  }
  return renameSync(source, target, ...args);
};
function claimantSurvives(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (!entry.isDirectory()) continue;
    const metadata = fs.lstatSync(absolute, { bigint: true });
    if (claimantIdentity
      && metadata.dev === claimantIdentity.dev
      && metadata.ino === claimantIdentity.ino) return true;
    if (claimantSurvives(absolute)) return true;
  }
  return false;
}
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
fs.writeFileSync(${JSON.stringify(observation)}, JSON.stringify({
  injected,
  claimantSurvived: claimantSurvives(${JSON.stringify(tmp)}),
}));
`);

  const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const state = JSON.parse(fs.readFileSync(observation, 'utf8'));
  assert.equal(state.injected, true, 'the cleanup-boundary claimant must be installed');
  assert.equal(state.claimantSurvived, true, 'cleanup must preserve the empty claimant inode');
  assert.equal(fs.existsSync(out), true);
});
