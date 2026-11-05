import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
test('a failed candidate replacement leaves the previous candidate complete', async (t) => {
  const { replaceCandidate } = await import('../archify/bin/finalize.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-replace-candidate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const candidate = path.join(dir, 'candidate.json');
  const original = '{"components":[{"id":"a","pos":[40,40]}]}\n';
  fs.writeFileSync(candidate, original);
  const next = '{"components":[{"id":"a","pos":[20,40]}]}\n';
  const partialWrite = (file, bytes) => {
    fs.writeFileSync(file, bytes.subarray(0, 10));
    throw new Error('disk full');
  };
  assert.throws(() => replaceCandidate(candidate, next, { writeFile: partialWrite }), /disk full/);
  assert.equal(fs.readFileSync(candidate, 'utf8'), original);
  const truncatedWrite = (file, bytes) => fs.writeFileSync(file, bytes.subarray(0, 10));
  assert.throws(() => replaceCandidate(candidate, next, { writeFile: truncatedWrite }), /does not match/);
  assert.equal(fs.readFileSync(candidate, 'utf8'), original);
  assert.deepEqual(fs.readdirSync(dir), ['candidate.json'], 'no staged file is left behind');
  replaceCandidate(candidate, next);
  assert.equal(fs.readFileSync(candidate, 'utf8'), next);
});

test('a candidate replacement keeps the candidate private', { skip: process.platform === 'win32' && 'POSIX file modes' }, async (t) => {
  const { replaceCandidate } = await import('../archify/bin/finalize.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-replace-mode-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const candidate = path.join(dir, 'candidate.json');
  fs.writeFileSync(candidate, '{}\n', { mode: 0o600 });
  fs.chmodSync(candidate, 0o600);
  replaceCandidate(candidate, '{"a":1}\n');
  assert.equal(fs.statSync(candidate).mode & 0o777, 0o600);
});

for (const replacement of ['in-place edit', 'new identity', 'symlink']) {
  test(`candidate replacement preserves an external ${replacement} during staging`, {
    skip: process.platform === 'win32' && replacement === 'symlink' && 'POSIX symlink creation',
  }, async (t) => {
    const { replaceCandidate } = await import('../archify/bin/finalize.mjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-replace-conflict-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const candidate = path.join(dir, 'candidate.json');
    const original = '{"title":"original"}';
    const edited = replacement === 'new identity' ? original : '{"title":"external edit"}';
    fs.writeFileSync(candidate, original);
    const writeFile = (staged, bytes, options) => {
      fs.writeFileSync(staged, bytes, options);
      if (replacement === 'new identity') {
        const external = path.join(dir, 'external.json');
        fs.writeFileSync(external, edited);
        fs.renameSync(external, candidate);
      } else if (replacement === 'symlink') {
        const external = path.join(dir, 'external.json');
        fs.writeFileSync(external, edited);
        fs.rmSync(candidate);
        fs.symlinkSync(external, candidate);
      } else fs.writeFileSync(candidate, edited);
    };
    assert.throws(() => replaceCandidate(candidate, '{"title":"repair"}', { writeFile }), /candidate|replacement/);
    assert.equal(fs.readFileSync(candidate, 'utf8'), edited);
    if (replacement === 'symlink') assert.ok(fs.lstatSync(candidate).isSymbolicLink());
    assert.ok(fs.readdirSync(dir).every(name => !name.startsWith('.archify-')));
  });
}

test('candidate replacement preserves a foreign staged claimant', async t => {
  const { replaceCandidate } = await import('../archify/bin/finalize.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-stage-claimant-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const candidate = path.join(directory, 'candidate.json');
  fs.writeFileSync(candidate, '{"original":true}');
  let stagedPath;
  const writeFile = (staged, bytes) => {
    stagedPath = staged;
    const foreign = path.join(directory, 'foreign.json');
    fs.writeFileSync(foreign, bytes);
    fs.renameSync(foreign, staged);
  };
  assert.throws(() => replaceCandidate(candidate, '{"repaired":true}', { writeFile }), /staged candidate changed/);
  assert.equal(fs.readFileSync(candidate, 'utf8'), '{"original":true}');
  assert.equal(fs.readFileSync(stagedPath, 'utf8'), '{"repaired":true}');
});

// These fault injections exercise publication boundaries rather than depending
// on a particular sequence of automatic repairs.
test('candidate replacement preserves a same-inode edit at publication capture', async t => {
  const { replaceCandidate } = await import('../archify/bin/finalize.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-publish-edit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const candidate = path.join(directory, 'candidate.json');
  fs.writeFileSync(candidate, '{"original":true}');
  const open = fs.openSync;
  let injected = false;
  fs.openSync = function (file, ...args) {
    if (!injected && file === candidate && new Error().stack.includes('publishRegularFileBinding')) {
      injected = true;
      fs.writeFileSync(candidate, '{"external":true}');
    }
    return open.call(this, file, ...args);
  };
  try {
    assert.throws(() => replaceCandidate(candidate, '{"repair":true}'), /replacement failed safely/);
  } finally { fs.openSync = open; }
  assert.ok(injected);
  assert.equal(fs.readFileSync(candidate, 'utf8'), '{"external":true}');
});

test('candidate replacement retains recovery ownership and warnings after a committed cleanup failure', async t => {
  const { replaceCandidate } = await import('../archify/bin/finalize.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-publish-warning-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const candidate = path.join(directory, 'candidate.json');
  const original = '{"original":true}';
  fs.writeFileSync(candidate, original);
  const rmdir = fs.rmdirSync;
  let injected = false;
  fs.rmdirSync = function (...args) {
    if (!injected && new Error().stack.includes('cleanupRecoveryDirectory')) {
      injected = true;
      throw Object.assign(new Error('injected cleanup failure'), { code: 'EACCES' });
    }
    return rmdir.apply(this, args);
  };
  let repaired;
  try { repaired = replaceCandidate(candidate, '{"repair":true}'); }
  finally { fs.rmdirSync = rmdir; }
  assert.ok(injected);
  assert.equal(repaired.publication.status, 'committed-with-warning');
  replaceCandidate(candidate, original, { expected: repaired });
  assert.equal(fs.readFileSync(candidate, 'utf8'), original);
});

test('candidate replacement needs no fresh capture after publication', async t => {
  const { replaceCandidate } = await import('../archify/bin/finalize.mjs');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-postpublish-capture-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const candidate = path.join(directory, 'candidate.json');
  fs.writeFileSync(candidate, '{"original":true}');
  const physicalCandidate = fs.realpathSync(candidate);
  const link = fs.linkSync;
  const read = fs.readFileSync;
  let published = false;
  fs.linkSync = function (source, target) {
    const result = link.call(this, source, target);
    if (target === physicalCandidate || target === candidate) published = true;
    return result;
  };
  fs.readFileSync = function (file, ...args) {
    if (published && (file === candidate || file === physicalCandidate)) throw new Error('post-publication capture unavailable');
    return read.call(this, file, ...args);
  };
  let repaired;
  try { repaired = replaceCandidate(candidate, '{"repair":true}'); }
  finally { fs.linkSync = link; fs.readFileSync = read; }
  assert.ok(published);
  replaceCandidate(candidate, '{"original":true}', { expected: repaired });
  assert.equal(fs.readFileSync(candidate, 'utf8'), '{"original":true}');
});
