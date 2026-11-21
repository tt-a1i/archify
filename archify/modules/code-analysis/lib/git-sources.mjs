import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { fail } from '../core/index.mjs';

const SHA = /^[a-f0-9]{40}$/;
const MAX_BYTES = 128 * 1024 * 1024;

export function normalizeScope(value = '.') {
  const scope = value === '.' ? '.' : String(value).replace(/\/$/, '');
  if (!scope || scope.startsWith('/') || scope.includes('\\') || scope.split('/').some(part => !part || part === '..' || part === '.' || part.toLowerCase() === '.git' || /[:\0]/.test(part))) {
    if (scope !== '.') fail('pr/scope-invalid', 'Analysis scope must be a relative directory inside the Git repository.');
  }
  return scope;
}

export async function git(cwd, args, { input = null, noLazyFetch = false } = {}) {
  // execFile arguments never pass through a shell. Do not surface stderr, which
  // may contain local credential-helper output or a credential-bearing URL.
  try {
    return await new Promise((resolve, reject) => {
      let timedOut = false;
      const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
      if (noLazyFetch) env.GIT_NO_LAZY_FETCH = '1';
      for (const key of ['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_PREFIX', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[key];
      const child = execFile('git', ['--no-replace-objects', '--literal-pathspecs', '-c', 'credential.interactive=false', '-C', cwd, ...args], { encoding: 'buffer', maxBuffer: MAX_BYTES, windowsHide: true, env }, (error, stdout) => {
        clearTimeout(timeout);
        if (error) { error.killed ||= timedOut; reject(error); } else resolve(stdout);
      });
      // Git for Windows launches a second git.exe. Kill the process tree before
      // its launcher exits, otherwise a timed-out fetch can keep its lock alive.
      const timeout = setTimeout(() => {
        timedOut = true;
        if (process.platform === 'win32') execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => child.kill());
        else child.kill();
      }, 120000);
      child.stdin.on('error', () => {}); child.stdin.end(input);
    });
  } catch (error) { fail(error.killed ? 'pr/git-timeout' : 'pr/git-failed', error.killed ? 'Git source preparation timed out.' : 'Git could not prepare the requested source objects.', { evidence: { operation: args[0], exitCode: error.code || null }, supportedFixes: ['check local Git and repository access; retry the requested PR'] }); }
}

export async function materializeTree({ cache, sha, scope, target, blobSource = null }) {
  if (!SHA.test(sha)) fail('pr/commit-invalid', 'A source snapshot needs an exact commit SHA.');
  scope = normalizeScope(scope);
  fs.mkdirSync(target, { recursive: true });
  const listing = await git(cache, ['ls-tree', '-rz', '--full-tree', sha, ...(scope === '.' ? [] : ['--', `${scope}/`])]);
  const records = [], skipped = [], names = new Set();
  for (const record of listing.toString('utf8').split('\0').filter(Boolean)) {
    const match = /^(\d+) (\w+) ([a-f0-9]{40})\t([\s\S]+)$/.exec(record);
    if (!match) fail('pr/tree-invalid', 'Git returned an invalid source-tree entry.');
    const [, mode, type, oid, fullPath] = match;
    const relative = scope === '.' ? fullPath : fullPath.slice(scope.length + 1);
    if (scope !== '.' && !fullPath.startsWith(`${scope}/`)) fail('pr/tree-invalid', 'A source entry escaped the selected analysis scope.');
    const parts = relative.split('/');
    const filename = path.resolve(target, relative);
    const folded = process.platform === 'win32' ? relative.toLowerCase() : relative;
    if (!relative || parts.some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git' || /[\\:\0]/.test(part) || (process.platform === 'win32' && (/[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))) || !filename.startsWith(path.resolve(target) + path.sep) || names.has(folded)) {
      fail('pr/tree-path-unsupported', 'A Git tree path cannot be safely materialized on this system.');
    }
    names.add(folded);
    if (type !== 'blob' || !/^100(?:644|755)$/.test(mode)) { skipped.push({ path: relative, mode, type }); continue; }
    records.push({ path: relative, filename, oid, mode });
  }
  // cat-file's partial-clone fallback fetches one missing blob at a time.
  // Request just this scope's missing objects together, without checking out
  // files or fetching unrelated packaged artifacts from the repository.
  if (blobSource && records.length) {
    const ids = [...new Set(records.map(record => record.oid))];
    const checks = await git(cache, ['cat-file', '--batch-check'], { input: ids.join('\n') + '\n', noLazyFetch: true });
    const missing = checks.toString('ascii').trim().split('\n').filter(line => line.endsWith(' missing')).map(line => line.split(' ')[0]);
    if (missing.length) await git(cache, ['fetch', '--no-tags', '--no-write-fetch-head', '--stdin', blobSource], { input: missing.join('\n') + '\n' });
  }
  const blobs = records.length ? await git(cache, ['cat-file', '--batch'], { input: records.map(record => record.oid).join('\n') + '\n', noLazyFetch: !!blobSource }) : Buffer.alloc(0);
  let offset = 0;
  for (const record of records) {
    const end = blobs.indexOf(10, offset);
    const match = /^([a-f0-9]{40}) blob (\d+)$/.exec(blobs.subarray(offset, end).toString('ascii'));
    if (!match || match[1] !== record.oid) fail('pr/blob-invalid', 'Git source bytes did not match the requested object.');
    const size = Number(match[2]); offset = end + 1;
    const bytes = blobs.subarray(offset, offset + size);
    const oid = createHash('sha1').update(`blob ${size}\0`).update(bytes).digest('hex');
    if (bytes.length !== size || oid !== record.oid) fail('pr/blob-invalid', 'A source blob failed identity verification.');
    fs.mkdirSync(path.dirname(record.filename), { recursive: true });
    fs.writeFileSync(record.filename, bytes, { flag: 'wx' }); offset += size + 1;
  }
  return { sha, scope, files: records.map(({ path, oid, mode }) => ({ path, oid, mode })), skipped };
}
