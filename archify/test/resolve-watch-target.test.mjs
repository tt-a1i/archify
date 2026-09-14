import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regression coverage for issue #310: on Windows, `fs.watch` crashes when the
// directory path still contains an 8.3 short name. `resolveWatchTarget` must
// call `fs.realpathSync.native` to expand short names and junctions before the
// directory handle is opened. The native variant is a no-op on POSIX, so the
// assertions below hold on every platform the CLI ships to.

const here = path.dirname(fileURLToPath(import.meta.url));
const { resolveWatchTarget } = await import(
  path.resolve(here, '..', 'bin', 'preview.mjs')
);

test('resolveWatchTarget follows symlinks and junctions via realpathSync.native', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-watch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const real = path.join(root, 'real');
  fs.mkdirSync(real);
  // Symlink works on POSIX; on Windows this is the same path realpath would
  // resolve (no junction), but the test is exercising the function's contract.
  const alias = path.join(root, 'alias');
  try {
    fs.symlinkSync(real, alias, 'dir');
  } catch (error) {
    if (error && error.code === 'EPERM') {
      // Windows without Developer Mode skips the symlink dance; the function
      // must still return an absolute path that fs.watch accepts.
      assert.equal(resolveWatchTarget(real), fs.realpathSync.native(real));
      return;
    }
    throw error;
  }
  const resolved = resolveWatchTarget(alias);
  // The resolved path must match what realpathSync.native produces so the
  // subsequent fs.watch sees the same handle Windows would hand it for the
  // underlying inode.
  assert.equal(resolved, fs.realpathSync.native(alias));
  assert.equal(resolved, fs.realpathSync.native(real));
});

test('resolveWatchTarget falls back to path.resolve when the target is missing', () => {
  const ghost = path.join(os.tmpdir(), 'archify-ghost-' + Date.now(), 'missing');
  const resolved = resolveWatchTarget(ghost);
  // ENOENT must NOT bubble up — the polling timer covers the directory.
  assert.equal(resolved, path.resolve(ghost));
});

test('resolveWatchTarget is exported as a pure function', () => {
  // The export is consumed by the watcher inside startPreview; the assertion
  // is here to catch accidental renaming that would silently regress #310.
  assert.equal(typeof resolveWatchTarget, 'function');
  assert.equal(resolveWatchTarget.length, 1);
});