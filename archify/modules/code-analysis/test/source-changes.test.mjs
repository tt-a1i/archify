import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
