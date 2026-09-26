import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backupPublicRegularFileBinding,
  captureAtomicOutput,
  captureRegularFileBinding,
  quarantineRemoveRegularFileBinding,
  releaseRegularFileBinding,
  removeOwnedRegularFile,
} from '../renderers/shared/atomic-output.mjs';
import { loadDiagram, writeDiagram } from '../renderers/shared/cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const workflowFixture = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');

function workspace(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function loadWorkflow(input, output) {
  return loadDiagram({
    rendererDir: path.join(skillRoot, 'renderers/workflow'),
    diagramType: 'workflow',
    defaultExample: 'agent-tool-call.workflow.json',
    argv: ['node', 'render-workflow.mjs', input, output],
  });
}

function writeWorkflow(loaded) {
  writeDiagram({
    outPath: loaded.outPath,
    template: loaded.template,
    diagramType: 'workflow',
    meta: loaded.diagram.meta,
    svg: '<svg role="img"></svg>',
    cards: [],
  });
}

function renderCandidates(directory) {
  return fs.readdirSync(directory).filter((entry) => entry.startsWith('.archify-render-'));
}

function createFifo(target) {
  const created = spawnSync('mkfifo', [target], { encoding: 'utf8' });
  if (created.error?.code === 'ENOENT') return false;
  assert.equal(created.status, 0, created.stderr || created.error?.message);
  return true;
}

test('a first candidate handle identity failure removes the exclusive render candidate', (t) => {
  const root = workspace(t, 'archify-render-atomic-first-fstat-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  fs.copyFileSync(workflowFixture, input);
  const loaded = loadWorkflow(input, output);
  const openSync = fs.openSync;
  const fstatSync = fs.fstatSync;
  let candidateDescriptor;
  let injected = false;
  t.mock.method(fs, 'openSync', (target, ...args) => {
    const descriptor = openSync(target, ...args);
    if (path.basename(String(target)).startsWith('.archify-render-')) {
      candidateDescriptor = descriptor;
    }
    return descriptor;
  });
  t.mock.method(fs, 'fstatSync', (descriptor, ...args) => {
    if (!injected && descriptor === candidateDescriptor) {
      injected = true;
      throw Object.assign(new Error('injected first candidate fstat failure'), { code: 'EIO' });
    }
    return fstatSync(descriptor, ...args);
  });

  assert.throws(() => writeWorkflow(loaded), /injected first candidate fstat failure/);
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(renderCandidates(root), []);
});

function fileSymlinksAvailable(t, root) {
  const target = path.join(root, 'symlink-capability-target');
  const link = path.join(root, 'symlink-capability-link');
  try {
    fs.symlinkSync(target, link, process.platform === 'win32' ? 'file' : undefined);
    fs.unlinkSync(link);
    return true;
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`file aliases unavailable: ${error.code}`);
      return false;
    }
    throw error;
  }
}

test('a partial candidate write preserves the previous artifact and removes the candidate', (t) => {
  const root = workspace(t, 'archify-render-atomic-partial-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  const previous = '<!doctype html><title>trusted previous artifact</title>\n';
  fs.copyFileSync(workflowFixture, input);
  fs.writeFileSync(output, previous);
  const loaded = loadWorkflow(input, output);

  const writeFileSync = fs.writeFileSync;
  let injected = false;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    if (!injected) {
      injected = true;
      writeFileSync(file, 'partial artifact');
      throw Object.assign(new Error('injected partial render write'), {
        code: 'ENOSPC',
        errno: -28,
        syscall: 'write',
      });
    }
    return writeFileSync(file, ...args);
  });

  assert.throws(() => writeWorkflow(loaded), /Output could not be written/);
  assert.equal(fs.readFileSync(output, 'utf8'), previous);
  assert.deepEqual(renderCandidates(root), []);
});

test('an existing output directory is rejected before a render candidate is written', (t) => {
  const root = workspace(t, 'archify-render-atomic-directory-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  fs.copyFileSync(workflowFixture, input);
  fs.mkdirSync(output);
  const loaded = loadWorkflow(input, output);
  let writes = 0;
  const writeFileSync = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (...args) => {
    writes += 1;
    return writeFileSync(...args);
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-not-regular-file'
      && error.archifyDiagnostics[0].evidence.relation.entryType === 'directory',
  );
  assert.equal(writes, 0);
  assert.equal(fs.statSync(output).isDirectory(), true);
  assert.deepEqual(renderCandidates(root), []);
});

test('an existing output FIFO is rejected before a render candidate is written', (t) => {
  if (process.platform === 'win32') {
    t.skip('FIFO files are unavailable on Windows');
    return;
  }
  const root = workspace(t, 'archify-render-atomic-fifo-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  fs.copyFileSync(workflowFixture, input);
  if (!createFifo(output)) {
    t.skip('mkfifo is unavailable');
    return;
  }
  const loaded = loadWorkflow(input, output);
  let writes = 0;
  const writeFileSync = fs.writeFileSync;
  t.mock.method(fs, 'writeFileSync', (...args) => {
    writes += 1;
    return writeFileSync(...args);
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-not-regular-file'
      && error.archifyDiagnostics[0].evidence.relation.entryType === 'fifo',
  );
  assert.equal(writes, 0);
  assert.equal(fs.statSync(output).isFIFO(), true);
  assert.deepEqual(renderCandidates(root), []);
});

test('a no-follow atomic output policy rejects symlinks, including dangling aliases', (t) => {
  const root = workspace(t, 'archify-render-atomic-no-follow-alias-');
  if (!fileSymlinksAvailable(t, root)) return;
  const target = path.join(root, 'target.html');
  const existingAlias = path.join(root, 'existing.delivery.json');
  const danglingAlias = path.join(root, 'dangling.delivery.json');
  fs.writeFileSync(target, 'target\n');
  fs.symlinkSync(target, existingAlias, process.platform === 'win32' ? 'file' : undefined);
  fs.symlinkSync(
    path.join(root, 'missing-target.html'),
    danglingAlias,
    process.platform === 'win32' ? 'file' : undefined,
  );

  for (const output of [existingAlias, danglingAlias]) {
    const captured = captureAtomicOutput(output, { requestedEntryPolicy: 'regular-or-absent' });
    assert.equal(captured.status, 'unsupported');
    assert.equal(captured.reason.code, 'requested-entry-symbolic-link');
    assert.equal(captured.reason.entryType, 'symbolic-link');
  }
  assert.equal(fs.lstatSync(existingAlias).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(danglingAlias).isSymbolicLink(), true);
});

test('a no-follow atomic output policy rejects special and hardlinked requested entries', (t) => {
  const root = workspace(t, 'archify-render-atomic-no-follow-entry-');
  const output = path.join(root, 'receipt.delivery.json');
  const alias = path.join(root, 'receipt-alias.delivery.json');

  if (process.platform !== 'win32' && createFifo(output)) {
    const fifo = captureAtomicOutput(output, { requestedEntryPolicy: 'regular-or-absent' });
    assert.equal(fifo.status, 'unsupported');
    assert.equal(fifo.reason.code, 'requested-entry-not-regular-file');
    assert.equal(fifo.reason.entryType, 'fifo');
    fs.unlinkSync(output);
  }

  fs.writeFileSync(output, 'owned\n');
  try {
    fs.linkSync(output, alias);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EXDEV'].includes(error.code)) {
      t.skip(`hard links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const hardlinked = captureAtomicOutput(output, { requestedEntryPolicy: 'regular-or-absent' });
  assert.equal(hardlinked.status, 'unsupported');
  assert.equal(hardlinked.reason.code, 'requested-entry-hardlinked');
  assert.equal(fs.readFileSync(output, 'utf8'), 'owned\n');
  assert.equal(fs.readFileSync(alias, 'utf8'), 'owned\n');
});

test('an existing output with no stable file identity fails closed before staging', (t) => {
  const root = workspace(t, 'archify-render-atomic-zero-inode-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  fs.copyFileSync(workflowFixture, input);
  fs.writeFileSync(output, '<!doctype html><title>original</title>\n');
  const loaded = loadWorkflow(input, output);
  const physicalOutput = fs.realpathSync.native(output);

  const lstatSync = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (target, options) => {
    const metadata = lstatSync(target, options);
    if (options?.bigint && path.resolve(target) === physicalOutput) {
      return new Proxy(metadata, {
        get(value, property) {
          if (property === 'ino') return 0n;
          const member = Reflect.get(value, property, value);
          return typeof member === 'function' ? member.bind(value) : member;
        },
      });
    }
    return metadata;
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-indeterminate'
      // Without a directory alias, the requested-entry inspection encounters
      // the unavailable identity before the resolved-target inspection does.
      && ['requested-entry-identity-unavailable', 'target-identity-unavailable']
        .includes(error.archifyDiagnostics[0].evidence.relation.code),
  );
  assert.match(fs.readFileSync(output, 'utf8'), /original/);
  assert.deepEqual(renderCandidates(root), []);
});

for (const linkCount of [0n, 2n]) {
  test(`an existing output with handle link count ${linkCount} fails closed before staging`, (t) => {
    const root = workspace(t, `archify-render-atomic-handle-links-${linkCount}-`);
    const input = path.join(root, 'diagram.workflow.json');
    const output = path.join(root, 'diagram.html');
    fs.copyFileSync(workflowFixture, input);
    fs.writeFileSync(output, '<!doctype html><title>original</title>\n');
    const loaded = loadWorkflow(input, output);
    const identity = fs.statSync(output, { bigint: true });

    const fstatSync = fs.fstatSync;
    t.mock.method(fs, 'fstatSync', (descriptor, options) => {
      const metadata = fstatSync(descriptor, options);
      if (options?.bigint && metadata.dev === identity.dev && metadata.ino === identity.ino) {
        return new Proxy(metadata, {
          get(value, property) {
            if (property === 'nlink') return linkCount;
            const member = Reflect.get(value, property, value);
            return typeof member === 'function' ? member.bind(value) : member;
          },
        });
      }
      return metadata;
    });
    const writeFileSync = fs.writeFileSync;
    let writes = 0;
    t.mock.method(fs, 'writeFileSync', (...args) => {
      writes += 1;
      return writeFileSync(...args);
    });

    assert.throws(
      () => writeWorkflow(loaded),
      (error) => error.archifyDiagnostics?.[0]?.code === (linkCount === 0n
        ? 'output/target-indeterminate'
        : 'output/target-hardlinked')
        && error.archifyDiagnostics[0].evidence.relation.code === (linkCount === 0n
          ? 'target-link-count-unavailable'
          : 'target-hardlinked'),
    );
    assert.equal(writes, 0);
    assert.match(fs.readFileSync(output, 'utf8'), /original/);
    assert.deepEqual(renderCandidates(root), []);
  });
}

test('a path link count of one cannot hide a hardlinked handle identity', (t) => {
  const root = workspace(t, 'archify-render-atomic-windows-link-fallback-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  fs.copyFileSync(workflowFixture, input);
  fs.writeFileSync(output, '<!doctype html><title>original</title>\n');
  const loaded = loadWorkflow(input, output);
  const identity = fs.statSync(output, { bigint: true });

  const lstatSync = fs.lstatSync;
  t.mock.method(fs, 'lstatSync', (target, options) => {
    const metadata = lstatSync(target, options);
    if (options?.bigint && metadata.dev === identity.dev && metadata.ino === identity.ino) {
      return new Proxy(metadata, {
        get(value, property) {
          if (property === 'nlink') return 1n;
          const member = Reflect.get(value, property, value);
          return typeof member === 'function' ? member.bind(value) : member;
        },
      });
    }
    return metadata;
  });
  const fstatSync = fs.fstatSync;
  t.mock.method(fs, 'fstatSync', (descriptor, options) => {
    const metadata = fstatSync(descriptor, options);
    if (options?.bigint && metadata.dev === identity.dev && metadata.ino === identity.ino) {
      return new Proxy(metadata, {
        get(value, property) {
          if (property === 'nlink') return 2n;
          const member = Reflect.get(value, property, value);
          return typeof member === 'function' ? member.bind(value) : member;
        },
      });
    }
    return metadata;
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-hardlinked'
      && error.archifyDiagnostics[0].evidence.relation.code === 'target-hardlinked',
  );
  assert.match(fs.readFileSync(output, 'utf8'), /original/);
  assert.deepEqual(renderCandidates(root), []);
});

test('an existing output whose handle cannot be inspected fails closed before staging', (t) => {
  const root = workspace(t, 'archify-render-atomic-handle-open-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  fs.copyFileSync(workflowFixture, input);
  fs.writeFileSync(output, '<!doctype html><title>original</title>\n');
  const loaded = loadWorkflow(input, output);
  const physicalOutput = fs.realpathSync.native(output);

  const openSync = fs.openSync;
  t.mock.method(fs, 'openSync', (target, ...args) => {
    if (path.resolve(target) === physicalOutput) {
      throw Object.assign(new Error('injected sharing violation'), { code: 'EBUSY' });
    }
    return openSync(target, ...args);
  });
  const writeFileSync = fs.writeFileSync;
  let writes = 0;
  t.mock.method(fs, 'writeFileSync', (...args) => {
    writes += 1;
    return writeFileSync(...args);
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-indeterminate'
      && error.archifyDiagnostics[0].evidence.relation.code === 'target-handle-inspection-failed'
      && error.archifyDiagnostics[0].evidence.relation.systemCode === 'EBUSY',
  );
  assert.equal(writes, 0);
  // Node 18 readFileSync calls the public openSync; stop injecting the fault
  // before inspecting the original bytes preserved by the failed render.
  fs.openSync.mock.restore();
  assert.match(fs.readFileSync(output, 'utf8'), /original/);
  assert.deepEqual(renderCandidates(root), []);
});

test('a staged candidate whose handle has multiple links is not published', (t) => {
  const root = workspace(t, 'archify-render-atomic-candidate-links-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  fs.copyFileSync(workflowFixture, input);
  const loaded = loadWorkflow(input, output);

  const openSync = fs.openSync;
  const closeSync = fs.closeSync;
  const fstatSync = fs.fstatSync;
  const openPaths = new Map();
  t.mock.method(fs, 'openSync', (target, ...args) => {
    const descriptor = openSync(target, ...args);
    openPaths.set(descriptor, path.resolve(target));
    return descriptor;
  });
  t.mock.method(fs, 'fstatSync', (descriptor, options) => {
    const metadata = fstatSync(descriptor, options);
    if (options?.bigint
      && path.basename(openPaths.get(descriptor) || '').startsWith('.archify-render-')) {
      return new Proxy(metadata, {
        get(value, property) {
          if (property === 'nlink') return 2n;
          const member = Reflect.get(value, property, value);
          return typeof member === 'function' ? member.bind(value) : member;
        },
      });
    }
    return metadata;
  });
  t.mock.method(fs, 'closeSync', (descriptor) => {
    openPaths.delete(descriptor);
    return closeSync(descriptor);
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-hardlinked'
      && error.archifyDiagnostics[0].evidence.relation.code === 'candidate-hardlinked',
  );
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(renderCandidates(root), []);
});

test('a staged candidate modified in place after capture is not published', (t) => {
  const root = workspace(t, 'archify-render-atomic-candidate-content-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  fs.copyFileSync(workflowFixture, input);
  const loaded = loadWorkflow(input, output);

  const openSync = fs.openSync;
  const lstatSync = fs.lstatSync;
  const writeFileSync = fs.writeFileSync;
  let candidatePath;
  let modified = false;
  t.mock.method(fs, 'openSync', (target, ...args) => {
    const descriptor = openSync(target, ...args);
    if (path.basename(target).startsWith('.archify-render-')
      && (args[0] & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) === 0) {
      candidatePath = path.resolve(target);
    }
    return descriptor;
  });
  t.mock.method(fs, 'lstatSync', (target, ...args) => {
    if (!modified && candidatePath && path.resolve(target) === output) {
      const before = fs.statSync(candidatePath, { bigint: true });
      writeFileSync(candidatePath, '<!doctype html><title>same inode claimant</title>');
      const after = fs.statSync(candidatePath, { bigint: true });
      assert.equal(after.dev, before.dev);
      assert.equal(after.ino, before.ino);
      modified = true;
    }
    return lstatSync(target, ...args);
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-changed'
      && error.archifyDiagnostics[0].evidence.relation.code === 'candidate-content-changed',
  );
  assert.equal(modified, true);
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(renderCandidates(root), []);
});

test('a staged candidate chmod after capture is not published', (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX candidate mode regression');
    return;
  }
  const root = workspace(t, 'archify-render-atomic-candidate-mode-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  fs.copyFileSync(workflowFixture, input);
  const loaded = loadWorkflow(input, output);

  const openSync = fs.openSync;
  const lstatSync = fs.lstatSync;
  let candidatePath;
  let modified = false;
  t.mock.method(fs, 'openSync', (target, ...args) => {
    const descriptor = openSync(target, ...args);
    if (path.basename(target).startsWith('.archify-render-')
      && (args[0] & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) === 0) {
      candidatePath = path.resolve(target);
    }
    return descriptor;
  });
  t.mock.method(fs, 'lstatSync', (target, ...args) => {
    if (!modified && candidatePath && path.resolve(target) === output) {
      const before = fs.statSync(candidatePath, { bigint: true });
      fs.chmodSync(candidatePath, Number(before.mode & 0o777n) ^ 0o111);
      const after = fs.statSync(candidatePath, { bigint: true });
      assert.equal(after.dev, before.dev);
      assert.equal(after.ino, before.ino);
      assert.notEqual(after.mode & 0o777n, before.mode & 0o777n);
      modified = true;
    }
    return lstatSync(target, ...args);
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-changed'
      && error.archifyDiagnostics[0].evidence.relation.code === 'candidate-mode-changed',
  );
  assert.equal(modified, true);
  assert.equal(fs.existsSync(output), false);
  assert.deepEqual(renderCandidates(root), []);
});

test('a staged candidate replaced after capture preserves the claimant', (t) => {
  const root = workspace(t, 'archify-render-atomic-candidate-replacement-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  const detachedCandidate = path.join(root, 'detached-render-candidate.html');
  const sentinel = '<!doctype html><title>claimant must survive</title>';
  fs.copyFileSync(workflowFixture, input);
  const loaded = loadWorkflow(input, output);

  const openSync = fs.openSync;
  const lstatSync = fs.lstatSync;
  const writeFileSync = fs.writeFileSync;
  let candidatePath;
  let replaced = false;
  t.mock.method(fs, 'openSync', (target, ...args) => {
    const descriptor = openSync(target, ...args);
    if (path.basename(target).startsWith('.archify-render-')
      && (args[0] & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) === 0) {
      candidatePath = path.resolve(target);
    }
    return descriptor;
  });
  t.mock.method(fs, 'lstatSync', (target, ...args) => {
    if (!replaced && candidatePath && path.resolve(target) === output) {
      fs.renameSync(candidatePath, detachedCandidate);
      writeFileSync(candidatePath, sentinel);
      replaced = true;
    }
    return lstatSync(target, ...args);
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-changed'
      && error.archifyDiagnostics[0].evidence.relation.code === 'candidate-identity-changed',
  );
  assert.equal(replaced, true);
  assert.equal(fs.existsSync(output), false);
  assert.equal(fs.readFileSync(candidatePath, 'utf8'), sentinel);
  assert.equal(fs.existsSync(detachedCandidate), true);
});

test('a candidate swapped at the publication boundary cannot replace the prior artifact', (t) => {
  const root = workspace(t, 'archify-render-atomic-publication-binding-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  const detachedCandidate = path.join(root, 'detached-bound-candidate.html');
  const previous = '<!doctype html><title>trusted previous artifact</title>\n';
  const claimant = '<!doctype html><title>publication boundary claimant</title>\n';
  fs.copyFileSync(workflowFixture, input);
  fs.writeFileSync(output, previous);
  const loaded = loadWorkflow(input, output);

  const openSync = fs.openSync.bind(fs);
  const closeSync = fs.closeSync.bind(fs);
  const linkSync = fs.linkSync.bind(fs);
  let candidatePath;
  let candidateDescriptor;
  let injected = false;
  const inject = () => {
    injected = true;
    fs.renameSync(candidatePath, detachedCandidate);
    fs.writeFileSync(candidatePath, claimant, { flag: 'wx' });
  };
  t.mock.method(fs, 'openSync', (file, flags, ...args) => {
    const descriptor = openSync(file, flags, ...args);
    const resolved = path.resolve(String(file));
    if (path.basename(resolved).startsWith('.archify-render-')
      && (flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) === 0) {
      candidatePath = resolved;
      candidateDescriptor = descriptor;
    }
    return descriptor;
  });
  t.mock.method(fs, 'closeSync', (descriptor) => {
    const result = closeSync(descriptor);
    if (!injected && descriptor === candidateDescriptor && fs.existsSync(candidatePath)) inject();
    return result;
  });
  t.mock.method(fs, 'linkSync', (source, target) => {
    if (!injected
      && candidatePath
      && path.resolve(String(source)) === candidatePath
      && path.basename(String(target)) === path.basename(output)) inject();
    return linkSync(source, target);
  });

  let thrown;
  try {
    writeWorkflow(loaded);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown, 'the publication race must fail closed');
  assert.equal(injected, true, JSON.stringify(thrown.archifyDiagnostics || thrown.message));
  assert.equal(fs.readFileSync(output, 'utf8'), previous);
  assert.equal(fs.readFileSync(candidatePath, 'utf8'), claimant);
  assert.equal(fs.existsSync(detachedCandidate), true);
});

test('a byte-identical replacement before candidate capture is not published', (t) => {
  const root = workspace(t, 'archify-render-atomic-candidate-pre-capture-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  const detachedCandidate = path.join(root, 'detached-owned-candidate.html');
  fs.copyFileSync(workflowFixture, input);
  const loaded = loadWorkflow(input, output);

  const openSync = fs.openSync;
  const lstatSync = fs.lstatSync;
  let candidatePath;
  let claimantIdentity;
  let replaced = false;
  t.mock.method(fs, 'openSync', (target, ...args) => {
    const descriptor = openSync(target, ...args);
    if (path.basename(target).startsWith('.archify-render-')
      && (args[0] & (fs.constants.O_WRONLY | fs.constants.O_RDWR)) !== 0) {
      candidatePath = path.resolve(target);
    }
    return descriptor;
  });
  t.mock.method(fs, 'lstatSync', (target, ...args) => {
    if (!replaced && candidatePath && path.resolve(target) === candidatePath) {
      const owned = fs.statSync(candidatePath, { bigint: true });
      fs.renameSync(candidatePath, detachedCandidate);
      fs.copyFileSync(detachedCandidate, candidatePath);
      fs.chmodSync(candidatePath, Number(owned.mode & 0o777n));
      claimantIdentity = fs.statSync(candidatePath, { bigint: true });
      assert.notEqual(claimantIdentity.ino, owned.ino);
      replaced = true;
    }
    return lstatSync(target, ...args);
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-changed'
      && error.archifyDiagnostics[0].evidence.relation.code === 'candidate-identity-changed',
  );
  assert.equal(replaced, true);
  assert.equal(fs.existsSync(output), false);
  assert.equal(fs.statSync(candidatePath, { bigint: true }).ino, claimantIdentity.ino);
  assert.deepEqual(fs.readFileSync(candidatePath), fs.readFileSync(detachedCandidate));
});

test('a concurrent replacement of an existing output is not overwritten', (t) => {
  const root = workspace(t, 'archify-render-atomic-replaced-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  const detached = path.join(root, 'detached-original.html');
  const replacement = '<!doctype html><title>concurrent replacement</title>\n';
  fs.copyFileSync(workflowFixture, input);
  fs.writeFileSync(output, '<!doctype html><title>original</title>\n');
  const loaded = loadWorkflow(input, output);

  const writeFileSync = fs.writeFileSync;
  let replaced = false;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    const result = writeFileSync(file, ...args);
    if (!replaced && (typeof file === 'number'
      || path.basename(file).startsWith('.archify-render-'))) {
      replaced = true;
      fs.renameSync(output, detached);
      writeFileSync(output, replacement);
    }
    return result;
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-changed',
  );
  assert.equal(fs.readFileSync(output, 'utf8'), replacement);
  assert.deepEqual(renderCandidates(root), []);
});

test('a concurrent symlink claim cannot disguise an existing-output replacement', (t) => {
  const root = workspace(t, 'archify-render-atomic-replaced-by-symlink-');
  if (!fileSymlinksAvailable(t, root)) return;
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  const detached = path.join(root, 'detached-original.html');
  const previous = '<!doctype html><title>original owner</title>\n';
  fs.copyFileSync(workflowFixture, input);
  fs.writeFileSync(output, previous);
  const loaded = loadWorkflow(input, output);

  const writeFileSync = fs.writeFileSync;
  let replaced = false;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    const result = writeFileSync(file, ...args);
    if (!replaced && (typeof file === 'number'
      || path.basename(file).startsWith('.archify-render-'))) {
      replaced = true;
      fs.renameSync(output, detached);
      fs.symlinkSync(detached, output, process.platform === 'win32' ? 'file' : undefined);
    }
    return result;
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-changed',
  );
  assert.equal(fs.lstatSync(output).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(output, 'utf8'), previous);
  assert.deepEqual(renderCandidates(root), []);
});

test('a concurrently claimed new output is not overwritten', (t) => {
  const root = workspace(t, 'archify-render-atomic-claimed-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  const replacement = '<!doctype html><title>concurrent owner</title>\n';
  fs.copyFileSync(workflowFixture, input);
  const loaded = loadWorkflow(input, output);

  const writeFileSync = fs.writeFileSync;
  let claimed = false;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    const result = writeFileSync(file, ...args);
    if (!claimed && (typeof file === 'number'
      || path.basename(file).startsWith('.archify-render-'))) {
      claimed = true;
      writeFileSync(output, replacement);
    }
    return result;
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-changed',
  );
  assert.equal(fs.readFileSync(output, 'utf8'), replacement);
  assert.deepEqual(renderCandidates(root), []);
});

test('a concurrently claimed new output symlink is not overwritten', (t) => {
  const root = workspace(t, 'archify-render-atomic-symlink-claim-');
  if (!fileSymlinksAvailable(t, root)) return;
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  const claimTarget = path.join(root, 'concurrent-owner.html');
  fs.copyFileSync(workflowFixture, input);
  const loaded = loadWorkflow(input, output);

  const writeFileSync = fs.writeFileSync;
  let claimed = false;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    const result = writeFileSync(file, ...args);
    if (!claimed && (typeof file === 'number'
      || path.basename(file).startsWith('.archify-render-'))) {
      claimed = true;
      fs.symlinkSync(claimTarget, output, process.platform === 'win32' ? 'file' : undefined);
    }
    return result;
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-changed',
  );
  assert.equal(fs.lstatSync(output).isSymbolicLink(), true);
  assert.equal(fs.existsSync(claimTarget), false);
  assert.deepEqual(renderCandidates(root), []);
});

test('the output alias is revalidated after staging and before the atomic commit', (t) => {
  const root = workspace(t, 'archify-render-atomic-alias-');
  const inputDirectory = path.join(root, 'input');
  const safeDirectory = path.join(root, 'safe-output');
  const linkedDirectory = path.join(root, 'linked-output');
  fs.mkdirSync(inputDirectory);
  fs.mkdirSync(safeDirectory);
  try {
    fs.symlinkSync(safeDirectory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`directory aliases unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const input = path.join(inputDirectory, 'diagram.workflow.html');
  const output = path.join(linkedDirectory, 'diagram.workflow.html');
  const source = fs.readFileSync(workflowFixture);
  fs.writeFileSync(input, source);
  const loaded = loadWorkflow(input, output);

  const writeFileSync = fs.writeFileSync;
  let redirected = false;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    const result = writeFileSync(file, ...args);
    if (!redirected) {
      redirected = true;
      fs.unlinkSync(linkedDirectory);
      fs.symlinkSync(inputDirectory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
    }
    return result;
  });

  assert.throws(() => writeWorkflow(loaded), /output must not replace an input/i);
  assert.deepEqual(fs.readFileSync(input), source);
  assert.deepEqual(renderCandidates(safeDirectory), []);
  assert.deepEqual(fs.readdirSync(safeDirectory), []);
});

test('a non-alias output redirect cannot commit to a stale physical target', (t) => {
  const root = workspace(t, 'archify-render-atomic-redirect-');
  const firstDirectory = path.join(root, 'first-output');
  const secondDirectory = path.join(root, 'second-output');
  const linkedDirectory = path.join(root, 'linked-output');
  fs.mkdirSync(firstDirectory);
  fs.mkdirSync(secondDirectory);
  try {
    fs.symlinkSync(firstDirectory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`directory aliases unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(linkedDirectory, 'diagram.html');
  fs.copyFileSync(workflowFixture, input);
  const loaded = loadWorkflow(input, output);

  const writeFileSync = fs.writeFileSync;
  let redirected = false;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    const result = writeFileSync(file, ...args);
    if (!redirected) {
      redirected = true;
      fs.unlinkSync(linkedDirectory);
      fs.symlinkSync(secondDirectory, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir');
    }
    return result;
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-changed',
  );
  assert.deepEqual(fs.readdirSync(firstDirectory), []);
  assert.deepEqual(fs.readdirSync(secondDirectory), []);
});

test('a nested directory-alias redirect cannot commit to either physical target', (t) => {
  const root = workspace(t, 'archify-render-atomic-nested-redirect-');
  const firstDirectory = path.join(root, 'first-output');
  const secondDirectory = path.join(root, 'second-output');
  const innerAlias = path.join(root, 'inner-output');
  const outerAlias = path.join(root, 'outer-output');
  fs.mkdirSync(firstDirectory);
  fs.mkdirSync(secondDirectory);
  try {
    fs.symlinkSync(firstDirectory, innerAlias, process.platform === 'win32' ? 'junction' : 'dir');
    fs.symlinkSync(innerAlias, outerAlias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`nested directory aliases unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(outerAlias, 'diagram.html');
  fs.copyFileSync(workflowFixture, input);
  const loaded = loadWorkflow(input, output);

  const writeFileSync = fs.writeFileSync;
  let redirected = false;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    const result = writeFileSync(file, ...args);
    if (!redirected && (typeof file === 'number'
      || path.basename(file).startsWith('.archify-render-'))) {
      redirected = true;
      fs.unlinkSync(innerAlias);
      fs.symlinkSync(secondDirectory, innerAlias, process.platform === 'win32' ? 'junction' : 'dir');
    }
    return result;
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-changed'
      && error.archifyDiagnostics[0].evidence.relation.code === 'write-slot-changed',
  );
  assert.equal(redirected, true);
  assert.deepEqual(fs.readdirSync(firstDirectory), []);
  assert.deepEqual(fs.readdirSync(secondDirectory), []);
});

test('a hardlinked existing output is rejected before staging', (t) => {
  const root = workspace(t, 'archify-render-atomic-hardlink-');
  const output = path.join(root, 'diagram.html');
  const alias = path.join(root, 'diagram-alias.html');
  const previous = '<!doctype html><title>shared old inode</title>\n';
  fs.writeFileSync(output, previous);
  try {
    fs.linkSync(output, alias);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EXDEV'].includes(error.code)) {
      t.skip(`hard links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const input = path.join(root, 'diagram.workflow.json');
  fs.copyFileSync(workflowFixture, input);
  const loaded = loadWorkflow(input, output);

  const writeFileSync = fs.writeFileSync;
  let writes = 0;
  t.mock.method(fs, 'writeFileSync', (...args) => {
    writes += 1;
    return writeFileSync(...args);
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-hardlinked'
      && error.archifyDiagnostics[0].evidence.relation.code === 'target-hardlinked',
  );
  assert.equal(writes, 0);
  assert.equal(fs.readFileSync(output, 'utf8'), previous);
  assert.equal(fs.readFileSync(alias, 'utf8'), previous);
  assert.deepEqual(renderCandidates(root), []);
});

test('no-clobber publication retains recovery bytes while the public name is absent', (t) => {
  const root = workspace(t, 'archify-render-atomic-rename-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  const previous = '<!doctype html><title>trusted previous artifact</title>\n';
  fs.copyFileSync(workflowFixture, input);
  fs.writeFileSync(output, previous);
  if (process.platform !== 'win32') fs.chmodSync(output, 0o640);
  const previousMode = fs.statSync(output).mode & 0o777;
  const physicalOutput = fs.realpathSync.native(output);
  const loaded = loadWorkflow(input, output);

  const linkSync = fs.linkSync.bind(fs);
  let publications = 0;
  t.mock.method(fs, 'linkSync', (source, target) => {
    if (path.basename(String(source)).startsWith('.archify-render-')) {
      publications += 1;
      assert.equal(target, physicalOutput);
      assert.equal(fs.existsSync(output), false);
      const recoveryDirectories = fs.readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name.startsWith('.archify-remove-'));
      assert.equal(recoveryDirectories.length, 1);
      assert.equal(
        fs.readFileSync(path.join(root, recoveryDirectories[0].name, 'previous'), 'utf8'),
        previous,
      );
      assert.match(fs.readFileSync(source, 'utf8'), /<svg role="img"><\/svg>/);
    }
    return linkSync(source, target);
  });

  writeWorkflow(loaded);

  assert.equal(publications, 1);
  assert.notEqual(fs.readFileSync(output, 'utf8'), previous);
  assert.equal(fs.statSync(output).mode & 0o777, previousMode);
  assert.deepEqual(renderCandidates(root), []);
});

test('no-clobber replacement preserves permissive existing modes despite a restrictive umask', (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX mode and umask regression');
    return;
  }
  const root = workspace(t, 'archify-render-atomic-umask-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  fs.copyFileSync(workflowFixture, input);
  fs.writeFileSync(output, '<!doctype html><title>previous</title>\n');
  fs.chmodSync(output, 0o666);
  const loaded = loadWorkflow(input, output);

  const previousUmask = process.umask(0o077);
  try {
    writeWorkflow(loaded);
  } finally {
    process.umask(previousUmask);
  }

  assert.equal(fs.statSync(output).mode & 0o777, 0o666);
  assert.deepEqual(renderCandidates(root), []);
});

test('a concurrent mode change is preserved and fails the commit', (t) => {
  if (process.platform === 'win32') {
    t.skip('POSIX mode identity regression');
    return;
  }
  const root = workspace(t, 'archify-render-atomic-mode-race-');
  const input = path.join(root, 'diagram.workflow.json');
  const output = path.join(root, 'diagram.html');
  const previous = '<!doctype html><title>previous mode owner</title>\n';
  fs.copyFileSync(workflowFixture, input);
  fs.writeFileSync(output, previous);
  fs.chmodSync(output, 0o640);
  const loaded = loadWorkflow(input, output);

  const writeFileSync = fs.writeFileSync;
  let changed = false;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    const result = writeFileSync(file, ...args);
    if (!changed && (typeof file === 'number'
      || path.basename(file).startsWith('.archify-render-'))) {
      changed = true;
      fs.chmodSync(output, 0o600);
    }
    return result;
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-changed'
      && error.archifyDiagnostics[0].evidence.relation.code === 'target-mode-changed',
  );
  assert.equal(fs.readFileSync(output, 'utf8'), previous);
  assert.equal(fs.statSync(output).mode & 0o777, 0o600);
  assert.deepEqual(renderCandidates(root), []);
});

test('replacing the requested output symlink with a hardlink fails instead of reporting stale success', (t) => {
  const root = workspace(t, 'archify-render-atomic-request-alias-');
  if (!fileSymlinksAvailable(t, root)) return;
  const input = path.join(root, 'diagram.workflow.json');
  const target = path.join(root, 'target.html');
  const output = path.join(root, 'linked.html');
  const hardlinkProbe = path.join(root, 'hardlink-capability-probe');
  const previous = '<!doctype html><title>previous target</title>\n';
  fs.copyFileSync(workflowFixture, input);
  fs.writeFileSync(target, previous);
  try {
    fs.linkSync(target, hardlinkProbe);
    fs.unlinkSync(hardlinkProbe);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EXDEV'].includes(error.code)) {
      t.skip(`hard links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  fs.symlinkSync(target, output, process.platform === 'win32' ? 'file' : undefined);
  const loaded = loadWorkflow(input, output);

  const writeFileSync = fs.writeFileSync;
  let replaced = false;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    const result = writeFileSync(file, ...args);
    if (!replaced && (typeof file === 'number'
      || path.basename(file).startsWith('.archify-render-'))) {
      replaced = true;
      fs.unlinkSync(output);
      fs.linkSync(target, output);
    }
    return result;
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-changed',
  );
  assert.equal(fs.lstatSync(output).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(output, 'utf8'), previous);
  assert.equal(fs.readFileSync(target, 'utf8'), previous);
  assert.deepEqual(renderCandidates(root), []);
});

test('recreating the requested output symlink to the same target fails closed', (t) => {
  const root = workspace(t, 'archify-render-atomic-recreated-alias-');
  if (!fileSymlinksAvailable(t, root)) return;
  const input = path.join(root, 'diagram.workflow.json');
  const target = path.join(root, 'target.html');
  const output = path.join(root, 'linked.html');
  const previous = '<!doctype html><title>previous target</title>\n';
  fs.copyFileSync(workflowFixture, input);
  fs.writeFileSync(target, previous);
  fs.symlinkSync(target, output, process.platform === 'win32' ? 'file' : undefined);
  const loaded = loadWorkflow(input, output);

  const writeFileSync = fs.writeFileSync;
  let replaced = false;
  t.mock.method(fs, 'writeFileSync', (file, ...args) => {
    const result = writeFileSync(file, ...args);
    if (!replaced && (typeof file === 'number'
      || path.basename(file).startsWith('.archify-render-'))) {
      replaced = true;
      fs.unlinkSync(output);
      fs.symlinkSync(target, output, process.platform === 'win32' ? 'file' : undefined);
    }
    return result;
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-changed'
      && error.archifyDiagnostics[0].evidence.relation.code === 'requested-entry-changed',
  );
  assert.equal(fs.lstatSync(output).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(target, 'utf8'), previous);
  assert.deepEqual(renderCandidates(root), []);
});

test('recreating a requested symlink during handle inspection fails before staging', (t) => {
  const root = workspace(t, 'archify-render-atomic-capture-alias-');
  if (!fileSymlinksAvailable(t, root)) return;
  const input = path.join(root, 'diagram.workflow.json');
  const target = path.join(root, 'target.html');
  const output = path.join(root, 'linked.html');
  const previous = '<!doctype html><title>previous target</title>\n';
  fs.copyFileSync(workflowFixture, input);
  fs.writeFileSync(target, previous);
  fs.symlinkSync(target, output, process.platform === 'win32' ? 'file' : undefined);
  const loaded = loadWorkflow(input, output);
  const physicalTarget = fs.realpathSync.native(target);

  const openSync = fs.openSync;
  let replaced = false;
  t.mock.method(fs, 'openSync', (candidate, ...args) => {
    if (!replaced && path.resolve(candidate) === physicalTarget) {
      replaced = true;
      fs.unlinkSync(output);
      fs.symlinkSync(target, output, process.platform === 'win32' ? 'file' : undefined);
    }
    return openSync(candidate, ...args);
  });
  const writeFileSync = fs.writeFileSync;
  let writes = 0;
  t.mock.method(fs, 'writeFileSync', (...args) => {
    writes += 1;
    return writeFileSync(...args);
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-indeterminate'
      && error.archifyDiagnostics[0].evidence.relation.code === 'requested-entry-changed-during-inspection',
  );
  assert.equal(replaced, true);
  assert.equal(writes, 0);
  assert.equal(fs.lstatSync(output).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(target, 'utf8'), previous);
  assert.deepEqual(renderCandidates(root), []);
});

test('a requested symlink replaced during canonical resolution fails before staging', (t) => {
  const root = workspace(t, 'archify-render-atomic-resolution-race-');
  if (!fileSymlinksAvailable(t, root)) return;
  const input = path.join(root, 'diagram.workflow.json');
  const target = path.join(root, 'target.html');
  const output = path.join(root, 'linked.html');
  const hardlinkProbe = path.join(root, 'hardlink-capability-probe');
  const previous = '<!doctype html><title>previous target</title>\n';
  fs.copyFileSync(workflowFixture, input);
  fs.writeFileSync(target, previous);
  try {
    fs.linkSync(target, hardlinkProbe);
    fs.unlinkSync(hardlinkProbe);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EXDEV'].includes(error.code)) {
      t.skip(`hard links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  fs.symlinkSync(target, output, process.platform === 'win32' ? 'file' : undefined);
  const loaded = loadWorkflow(input, output);

  const physicalTarget = fs.realpathSync.native(target);
  const nativeRealpath = fs.realpathSync.native;
  let replaced = false;
  t.mock.method(fs.realpathSync, 'native', (candidate) => {
    const resolved = nativeRealpath(candidate);
    if (!replaced && resolved === physicalTarget) {
      replaced = true;
      fs.unlinkSync(output);
      fs.linkSync(target, output);
    }
    return resolved;
  });
  const writeFileSync = fs.writeFileSync;
  let writes = 0;
  t.mock.method(fs, 'writeFileSync', (...args) => {
    writes += 1;
    return writeFileSync(...args);
  });

  assert.throws(
    () => writeWorkflow(loaded),
    (error) => error.archifyDiagnostics?.[0]?.code === 'output/target-hardlinked',
  );
  assert.equal(replaced, true);
  assert.equal(writes, 0);
  assert.equal(fs.lstatSync(output).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(output, 'utf8'), previous);
  assert.equal(fs.readFileSync(target, 'utf8'), previous);
  assert.deepEqual(renderCandidates(root), []);
});

test('an existing output symlink remains intact while its resolved target is replaced', (t) => {
  const root = workspace(t, 'archify-render-atomic-symlink-');
  const input = path.join(root, 'diagram.workflow.json');
  const target = path.join(root, 'target.html');
  const output = path.join(root, 'linked.html');
  fs.copyFileSync(workflowFixture, input);
  fs.writeFileSync(target, '<!doctype html><title>previous target</title>\n');
  try {
    fs.symlinkSync(target, output, 'file');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`file aliases unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const loaded = loadWorkflow(input, output);

  writeWorkflow(loaded);

  assert.equal(fs.lstatSync(output).isSymbolicLink(), true);
  assert.match(fs.readFileSync(target, 'utf8'), /<svg role="img"><\/svg>/);
  assert.deepEqual(renderCandidates(root), []);
});

test('quarantine removal deletes only the public entry still owned by its binding', (t) => {
  const root = workspace(t, 'archify-quarantine-remove-owned-');
  const target = path.join(root, 'public.lock');
  fs.writeFileSync(target, 'owned\n');
  const captured = captureRegularFileBinding(target, { subject: 'test-owned-entry' });
  assert.equal(captured.status, 'captured');
  try {
    const removed = quarantineRemoveRegularFileBinding(captured.binding, target, {
      subject: 'test-owned-entry',
    });
    assert.equal(removed.status, 'removed');
    assert.equal(fs.existsSync(target), false);
    assert.deepEqual(
      fs.readdirSync(root).filter((entry) => entry.startsWith('.archify-remove-')),
      [],
    );
  } finally {
    releaseRegularFileBinding(captured.binding);
  }
});

test('quarantine removal defers remote ENOTEMPTY until its binding handle closes', (t) => {
  const root = workspace(t, 'archify-quarantine-remove-remote-delay-');
  const target = path.join(root, 'public.lock');
  fs.writeFileSync(target, 'owned\n');
  const captured = captureRegularFileBinding(target, { subject: 'test-owned-entry' });
  assert.equal(captured.status, 'captured');
  const closeSync = fs.closeSync.bind(fs);
  const rmdirSync = fs.rmdirSync.bind(fs);
  let bindingClosed = false;
  let delayedAttempts = 0;
  let postCloseDelays = 0;
  t.mock.method(fs, 'closeSync', (descriptor) => {
    bindingClosed = true;
    return closeSync(descriptor);
  });
  t.mock.method(fs, 'rmdirSync', (directory) => {
    if (path.basename(String(directory)).startsWith('.archify-remove-')) {
      if (!bindingClosed) delayedAttempts += 1;
      else if (postCloseDelays < 1) postCloseDelays += 1;
      else return rmdirSync(directory);
      throw Object.assign(new Error('injected remote deletion visibility delay'), { code: 'ENOTEMPTY' });
    }
    return rmdirSync(directory);
  });
  let released = false;
  try {
    const removed = quarantineRemoveRegularFileBinding(captured.binding, target, {
      subject: 'test-owned-entry',
    });
    assert.equal(removed.status, 'removed');
    assert.equal(delayedAttempts, 1);
    assert.equal(fs.existsSync(target), false);
    assert.equal(
      fs.readdirSync(root).some((entry) => entry.startsWith('.archify-remove-')),
      true,
    );
    const release = releaseRegularFileBinding(captured.binding);
    released = true;
    assert.equal(release.status, 'released');
    assert.equal(postCloseDelays, 1);
    assert.deepEqual(
      fs.readdirSync(root).filter((entry) => entry.startsWith('.archify-remove-')),
      [],
    );
  } finally {
    if (!released) releaseRegularFileBinding(captured.binding);
  }
});

test('remote quarantine cleanup waits for every binding of the published inode to close', (t) => {
  const root = workspace(t, 'archify-quarantine-remove-duplicate-handles-');
  const candidate = path.join(root, 'candidate.html');
  const published = path.join(root, 'published.html');
  fs.writeFileSync(candidate, 'owned artifact\n');
  const staging = captureRegularFileBinding(candidate, { subject: 'staging-entry' });
  const transaction = captureRegularFileBinding(candidate, { subject: 'transaction-entry' });
  assert.equal(staging.status, 'captured');
  assert.equal(transaction.status, 'captured');
  fs.linkSync(candidate, published);
  const closeSync = fs.closeSync.bind(fs);
  const rmdirSync = fs.rmdirSync.bind(fs);
  let closedBindings = 0;
  t.mock.method(fs, 'closeSync', (descriptor) => {
    const result = closeSync(descriptor);
    closedBindings += 1;
    return result;
  });
  t.mock.method(fs, 'rmdirSync', (directory) => {
    if (path.basename(String(directory)).startsWith('.archify-remove-')
      && closedBindings < 2) {
      throw Object.assign(new Error('remote deletion is pending on another binding handle'), { code: 'ENOTEMPTY' });
    }
    return rmdirSync(directory);
  });
  let transactionReleased = false;
  let stagingReleased = false;
  try {
    const removed = quarantineRemoveRegularFileBinding(transaction.binding, candidate, {
      expectedLinks: 2,
    });
    assert.equal(removed.status, 'removed');
    const releasedTransaction = releaseRegularFileBinding(transaction.binding);
    transactionReleased = true;
    assert.equal(releasedTransaction.status, 'released');
    assert.equal(fs.existsSync(candidate), false);
    assert.equal(fs.readFileSync(published, 'utf8'), 'owned artifact\n');

    const retiredStaging = quarantineRemoveRegularFileBinding(staging.binding, candidate);
    assert.equal(retiredStaging.reason.systemCode, 'ENOENT');
    const releasedStaging = releaseRegularFileBinding(staging.binding);
    stagingReleased = true;
    assert.equal(releasedStaging.status, 'released');
    assert.deepEqual(fs.readdirSync(root), ['published.html']);
  } finally {
    if (!transactionReleased) releaseRegularFileBinding(transaction.binding);
    if (!stagingReleased) releaseRegularFileBinding(staging.binding);
  }
});

test('deferred quarantine cleanup preserves a real claimant and fails closed', (t) => {
  const root = workspace(t, 'archify-quarantine-remove-deferred-claimant-');
  const target = path.join(root, 'public.lock');
  fs.writeFileSync(target, 'owned\n');
  const captured = captureRegularFileBinding(target, { subject: 'test-owned-entry' });
  assert.equal(captured.status, 'captured');
  const rmdirSync = fs.rmdirSync.bind(fs);
  let claimant;
  t.mock.method(fs, 'rmdirSync', (directory) => {
    if (!claimant && path.basename(String(directory)).startsWith('.archify-remove-')) {
      claimant = path.join(String(directory), 'claimant');
      fs.writeFileSync(claimant, 'external claimant\n', { flag: 'wx' });
    }
    return rmdirSync(directory);
  });

  const removed = quarantineRemoveRegularFileBinding(captured.binding, target, {
    subject: 'test-owned-entry',
  });
  assert.equal(removed.status, 'removed');
  assert.ok(claimant);
  const release = releaseRegularFileBinding(captured.binding);
  assert.equal(release.status, 'unknown');
  assert.equal(release.reason.code, 'removal-quarantine-cleanup-failed');
  assert.equal(release.reason.systemCode, 'ENOTEMPTY');
  assert.equal(fs.readFileSync(claimant, 'utf8'), 'external claimant\n');
});

test('owned-file cleanup preserves a successor swapped at the unlink boundary', (t) => {
  const root = workspace(t, 'archify-owned-cleanup-successor-');
  const target = path.join(root, 'candidate.html');
  const detached = path.join(root, 'detached-owned-candidate.html');
  fs.writeFileSync(target, 'owned candidate\n');
  const metadata = fs.lstatSync(target, { bigint: true });
  const identity = { device: metadata.dev, inode: metadata.ino };
  const unlinkSync = fs.unlinkSync.bind(fs);
  const renameSync = fs.renameSync.bind(fs);
  let injected = false;
  const injectSuccessor = () => {
    renameSync(target, detached);
    fs.writeFileSync(target, 'successor claimant\n', { flag: 'wx' });
    injected = true;
  };
  t.mock.method(fs, 'unlinkSync', (file) => {
    if (!injected && path.resolve(String(file)) === target) {
      injectSuccessor();
    }
    return unlinkSync(file);
  });
  t.mock.method(fs, 'renameSync', (source, destination) => {
    if (!injected && path.resolve(String(source)) === target) injectSuccessor();
    return renameSync(source, destination);
  });

  const removed = removeOwnedRegularFile(target, identity);

  assert.equal(injected, true);
  assert.notEqual(removed.status, 'removed');
  assert.equal(fs.readFileSync(target, 'utf8'), 'successor claimant\n');
  assert.equal(fs.readFileSync(detached, 'utf8'), 'owned candidate\n');
});

test('quarantine removal restores a successor swapped at the final move boundary', (t) => {
  const root = workspace(t, 'archify-quarantine-remove-successor-');
  const target = path.join(root, 'public.lock');
  const displacedOwner = path.join(root, 'displaced-owner');
  fs.writeFileSync(target, 'owned\n');
  const captured = captureRegularFileBinding(target, { subject: 'test-owned-entry' });
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
      subject: 'test-owned-entry',
    });
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

test('quarantine removal retains a moved successor when its public name is reclaimed', (t) => {
  const root = workspace(t, 'archify-quarantine-remove-recovery-');
  const target = path.join(root, 'public.lock');
  const displacedOwner = path.join(root, 'displaced-owner');
  fs.writeFileSync(target, 'owned\n');
  const captured = captureRegularFileBinding(target, { subject: 'test-owned-entry' });
  assert.equal(captured.status, 'captured');
  const renameSync = fs.renameSync;
  let injected = false;
  t.mock.method(fs, 'renameSync', (source, destination) => {
    if (!injected && source === target
      && path.basename(path.dirname(destination)).startsWith('.archify-remove-')) {
      injected = true;
      renameSync(target, displacedOwner);
      fs.writeFileSync(target, 'moved successor\n', { flag: 'wx' });
      const result = renameSync(source, destination);
      fs.writeFileSync(target, 'later claimant\n', { flag: 'wx' });
      return result;
    }
    return renameSync(source, destination);
  });
  try {
    const removed = quarantineRemoveRegularFileBinding(captured.binding, target, {
      subject: 'test-owned-entry',
    });
    assert.equal(injected, true);
    assert.equal(removed.status, 'recovery-required');
    assert.equal(fs.readFileSync(target, 'utf8'), 'later claimant\n');
    assert.equal(fs.readFileSync(displacedOwner, 'utf8'), 'owned\n');
    assert.equal(fs.readFileSync(removed.recoveryFile, 'utf8'), 'moved successor\n');
    assert.equal(path.dirname(removed.recoveryFile), removed.recoveryDirectory);
  } finally {
    releaseRegularFileBinding(captured.binding);
  }
});

test('public backup keeps the bound file under a private no-clobber name', (t) => {
  const root = workspace(t, 'archify-public-backup-owned-');
  const target = path.join(root, 'artifact.html');
  const backup = path.join(root, '.previous-artifact');
  fs.writeFileSync(target, 'previous\n');
  const captured = captureRegularFileBinding(target, { subject: 'test-previous-entry' });
  assert.equal(captured.status, 'captured');
  try {
    const moved = backupPublicRegularFileBinding(captured.binding, target, backup, {
      subject: 'test-previous-entry',
    });
    assert.equal(moved.status, 'backed-up');
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.readFileSync(backup, 'utf8'), 'previous\n');
    assert.equal(fs.lstatSync(backup).nlink, 1);
  } finally {
    releaseRegularFileBinding(captured.binding);
  }
});

test('public backup restores a successor swapped at its final public move boundary', (t) => {
  const root = workspace(t, 'archify-public-backup-successor-');
  const target = path.join(root, 'artifact.html');
  const backup = path.join(root, '.previous-artifact');
  const displacedOwner = path.join(root, 'displaced-owner');
  fs.writeFileSync(target, 'previous\n');
  const captured = captureRegularFileBinding(target, { subject: 'test-previous-entry' });
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
    const moved = backupPublicRegularFileBinding(captured.binding, target, backup, {
      subject: 'test-previous-entry',
    });
    assert.equal(injected, true);
    assert.equal(moved.status, 'preserved');
    assert.equal(moved.backupCreated, true);
    assert.equal(moved.backupVerified, true);
    assert.equal(fs.readFileSync(target, 'utf8'), 'successor\n');
    assert.equal(fs.readFileSync(backup, 'utf8'), 'previous\n');
    assert.equal(fs.readFileSync(displacedOwner, 'utf8'), 'previous\n');
  } finally {
    releaseRegularFileBinding(captured.binding);
  }
});
