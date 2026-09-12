import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listTree } from '../locate/git.mjs';

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

test('listTree returns raw unicode and tab paths, not core.quotePath C-escapes', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-listtree-'));
  git(repo, 'init');
  git(repo, 'config', 'user.name', 'Archify Tests');
  git(repo, 'config', 'user.email', 'archify@example.test');
  git(repo, 'config', 'commit.gpgsign', 'false');
  git(repo, 'config', 'core.quotepath', 'true');
  const unicode = path.join(repo, 'src/文档.mjs');
  const tab = path.join(repo, 'src/has\ttab.mjs');
  fs.mkdirSync(path.dirname(unicode), { recursive: true });
  fs.writeFileSync(unicode, 'export const z = 1\n');
  fs.writeFileSync(tab, 'export const t = 1\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-m', 'unicode');
  const listed = listTree(repo, 'HEAD');
  assert.ok(listed.includes('src/文档.mjs'), `expected raw unicode, got ${JSON.stringify(listed)}`);
  assert.ok(listed.includes('src/has\ttab.mjs'), `expected raw tab path, got ${JSON.stringify(listed)}`);
  assert.equal(listed.some((item) => item.startsWith('"') || item.includes('\\346')), false);
});
