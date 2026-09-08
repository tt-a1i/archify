import { spawnSync } from 'node:child_process';
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
  if (!top) return { revision: null, root: '.' };
  const rel = toPosix(path.relative(path.resolve(top), analyzedRoot)) || '.';
  const revision = git(analyzedRoot, ['rev-parse', 'HEAD']);
  return { revision: revision && /^[a-f0-9]{40}$/.test(revision) ? revision : null, root: rel };
}
