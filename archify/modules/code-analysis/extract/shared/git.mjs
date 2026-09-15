import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { toPosix } from './files.mjs';

function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : null;
}

// Returns { revision, root } where root is the analyzed dir relative to the Git
// top level. Both are null-safe: a non-Git directory still extracts.
export function describeRepository(analyzedRoot) {
  const top = git(analyzedRoot, ['rev-parse', '--show-toplevel']);
  if (!top) return { revision: null, root: '.', url: null };
  const rel = toPosix(path.relative(fs.realpathSync(top), fs.realpathSync(analyzedRoot))) || '.';
  const revision = git(analyzedRoot, ['rev-parse', 'HEAD']);
  const url = git(analyzedRoot, ['remote', 'get-url', 'origin']);
  return { revision: revision && /^[a-f0-9]{40}$/.test(revision) ? revision : null, root: rel, url: url ? stripCredentials(url) : null };
}

// `https://user:token@host/...` is a common per-repository credential setup.
// The credential is never a fact about the repository and must not land in
// any artifact; the origin is recorded without it.
export function stripCredentials(url) {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, '$1');
}
