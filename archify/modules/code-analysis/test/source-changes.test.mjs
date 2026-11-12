import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { test } from 'node:test';
import { sourceChanges } from '../overlay/source-changes.mjs';

test('source markers compare captured text with HEAD, including staged edits and new files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-markers-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  git('config', 'core.autocrlf', 'false');
  fs.mkdirSync(path.join(root, 'src'));
  const base = { 'added.py': 'first\nlast\n', 'modified.py': 'first\nold\nlast\n', 'deleted.py': 'first\nremove\nlast\n', 'empty.py': 'remove\n', 'crlf.py': 'first\nlast\n', 'head.py': 'remove\nkeep\n' };
  base['blank.py'] = Array.from({ length: 39 }, (_, i) => `# Line ${i + 1}\n`).join('') + '\nlast\n';
  base['whitespace.py'] = 'first\n \t\nlast\n';
  base['mixed.py'] = 'first\n\nold\nlast\n';
  for (const [file, text] of Object.entries(base)) fs.writeFileSync(path.join(root, 'src', file), text);
  git('add', '.'); git('commit', '-qm', 'Base');
  const repository = { sourceKind: 'working-tree', baseRevision: git('rev-parse', 'HEAD'), root: 'src', language: 'py' };
  const captured = new Map([
    ['added.py', 'first\n# saved comment\nlast\n'], ['modified.py', 'first\nnew\nlast\n'],
    ['deleted.py', 'first\nlast\n'], ['empty.py', ''], ['crlf.py', 'first\r\nlast\r\n'],
    ['head.py', 'keep\n'], ['new.py', 'new file\n'], ['new-empty.py', ''],
    ['blank.py', base['blank.py'].replace('\n\nlast', '\n# Saved comment\nlast')],
    ['whitespace.py', 'first\nvalue = 1\nlast\n'],
    ['mixed.py', 'first\n# Added comment\nnew\nlast\n'],
  ]);
  fs.writeFileSync(path.join(root, 'src/modified.py'), captured.get('modified.py'));
  git('add', 'src/modified.py');
  // Neither the index nor a later working-file edit may change this comparison.
  fs.writeFileSync(path.join(root, 'src/added.py'), 'unrelated later edit\n');
  const changes = sourceChanges(path.join(root, 'src'), repository, captured);
  assert.deepEqual(changes.get('added.py'), { status: 'modified', added: [2], modified: [], deleted: [] });
  assert.deepEqual(changes.get('modified.py').modified, [2]);
  assert.deepEqual(changes.get('blank.py'), { status: 'modified', added: [40], modified: [], deleted: [] });
  assert.deepEqual(changes.get('whitespace.py').added, [2]);
  assert.deepEqual(changes.get('mixed.py'), { status: 'modified', added: [2], modified: [3], deleted: [] });
  assert.deepEqual(changes.get('deleted.py').deleted, [{ after: 1, count: 1 }]);
  assert.deepEqual(changes.get('empty.py').deleted, [{ after: 0, count: 1 }]);
  assert.deepEqual(changes.get('head.py').deleted, [{ after: 0, count: 1 }]);
  assert.equal(changes.get('crlf.py').status, 'unchanged');
  assert.deepEqual(changes.get('new.py').added, [1]);
  assert.equal(changes.get('new.py').status, 'added');
  assert.deepEqual(changes.get('new-empty.py').added, []);
  assert.equal(sourceChanges(root, { ...repository, baseRevision: 'f'.repeat(40) }, captured).get('new.py').status, 'unavailable');
  assert.equal(sourceChanges(root, { sourceKind: 'working-tree', baseRevision: null }, captured).get('new.py').status, 'unavailable');
});

test('batched markers retain per-file attribution, unusual names, text boundaries and binary status', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-markers-batch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  git('config', 'core.autocrlf', 'false'); git('config', 'diff.renames', 'copies');
  const pairs = new Map([
    ['remove.py', ['move me\n', '']], ['receive.py', ['', 'move me\n']],
    ['日本語 space.py', ['old', 'new']],
    ['binary.py', ['old\0data\n', 'new\0data\n']], ['bom.py', ['\ufeffold\n', '\ufeffnew\n']],
    ['latin.py', [Buffer.from([0xe9, 10]), 'é\n']],
  ]);
  // These filenames are illegal on Windows; the other boundary cases still run.
  if (process.platform !== 'win32') {
    pairs.set('line\nbreak.py', ['old\n', 'new\n']);
    pairs.set('tab\tquote".py', ['old\n', 'new']);
  }
  for (const [file, [before]] of pairs) fs.writeFileSync(path.join(root, file), before);
  git('add', '.'); git('commit', '-qm', 'Base');
  const repository = { sourceKind: 'working-tree', baseRevision: git('rev-parse', 'HEAD'), root: '.', language: 'py' };
  const captured = new Map([...pairs].map(([file, [, after]]) => [file, after]));
  const modified = { status: 'modified', added: [], modified: [1], deleted: [] };
  const expected = new Map([...pairs].map(([file]) => [file, modified]));
  expected.set('remove.py', { status: 'modified', added: [], modified: [], deleted: [{ after: 0, count: 1 }] });
  expected.set('receive.py', { status: 'modified', added: [1], modified: [], deleted: [] });
  expected.set('binary.py', { status: 'modified', added: [], modified: [], deleted: [] });
  expected.set('latin.py', { status: 'unchanged', added: [], modified: [], deleted: [] });

  const originalSpawn = childProcess.spawnSync;
  const run = inject => {
    const diffs = [];
    childProcess.spawnSync = (command, args, options) => {
      assert.equal(options.maxBuffer, 64 * 1024 * 1024);
      assert.equal(options.timeout, 10000);
      if (!args.includes('diff')) return originalSpawn(command, args, options);
      diffs.push(args);
      return inject?.(diffs.length, command, args, options) ?? originalSpawn(command, args, options);
    };
    syncBuiltinESMExports();
    try {
      const changes = sourceChanges(root, repository, captured);
      for (const args of diffs) assert.equal(fs.existsSync(args[2]), false, 'scratch is removed after every outcome');
      return { changes, diffs };
    } finally {
      childProcess.spawnSync = originalSpawn;
      syncBuiltinESMExports();
    }
  };
  const success = run();
  assert.deepEqual(success.changes, expected);
  assert.equal(success.diffs.length, 1, 'changed sources share one Git diff process');
  assert.deepEqual(success.diffs[0].slice(-2), ['before', 'after']);

  for (const failure of [
    { status: 2, stdout: Buffer.alloc(0) },
    { status: 1, error: Object.assign(new Error('output limit'), { code: 'ENOBUFS' }), stdout: Buffer.from('partial') },
    { status: 1, stdout: Buffer.from('diff --git a/before/0 b/after/0\n') },
    'wrong-attribution', 'duplicate-section', 'missing-hunk-body',
  ]) {
    const fallback = run((call, command, args, options) => {
      if (call !== 1) return;
      if (typeof failure !== 'string') return failure;
      const diff = originalSpawn(command, args, options);
      const report = diff.stdout.toString('utf8');
      const damaged = failure === 'wrong-attribution' ? report.replace('b/after/0', 'b/after/999')
        : failure === 'duplicate-section' ? report.replace('a/before/1 b/after/1', 'a/before/0 b/after/0')
        : report.replace('-move me\n', '');
      return { ...diff, stdout: Buffer.from(damaged) };
    });
    assert.deepEqual(fallback.changes, expected, 'failed or incomplete batches use per-file diffs');
    assert.equal(fallback.diffs.length, pairs.size, 'one batch attempt plus one diff per changed file');
  }
  const failed = run(() => ({ status: 1, error: new Error('Git failed'), stdout: Buffer.alloc(0) }));
  assert.equal(failed.changes.get('remove.py').status, 'unavailable');
  assert.equal(failed.changes.get('latin.py').status, 'unchanged');

  const localized = run((_call, command, args, options) => {
    const diff = originalSpawn(command, args, options);
    return { ...diff, stdout: Buffer.from(diff.stdout.toString('utf8').replace(/^Binary files .+ differ$/gm, 'Binärdateien unterscheiden sich')) };
  });
  assert.deepEqual(localized.changes, expected, 'localized binary output preserves legacy single-file status');
  assert.equal(localized.diffs.length, pairs.size, 'unrecognized batch output falls back per file');

  const nonPython = sourceChanges(root, { ...repository, language: 'ts' }, captured);
  assert.equal(nonPython.get('latin.py').status, 'unavailable', 'invalid UTF-8 retains the adapter-specific fallback');
});
