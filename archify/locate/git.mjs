import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { LocateError, locateFail } from './error.mjs';

const SHA_RE = /^[a-f0-9]{40}$/;

export function runGit(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) {
    locateFail('locate/git-unavailable', `Could not run Git: ${result.error.message}`, {
      evidence: { reason: result.error.message },
      supportedFixes: ['install Git and ensure it is available on PATH'],
    });
  }
  return result;
}

function gitValue(root, args, code, message) {
  const result = runGit(root, args);
  if (result.status !== 0) {
    locateFail(code, message, {
      evidence: { gitArgs: args, exitCode: result.status, stderr: (result.stderr || '').trim() },
      supportedFixes: ['use the intended local Git repository and verify the revision exists'],
    });
  }
  return result.stdout;
}

export function gitTopLevel(root) {
  return gitValue(root, ['rev-parse', '--show-toplevel'], 'locate/git-command', `Could not resolve Git top-level for "${root}".`).trim();
}

export function resolveRepoRoot(requested) {
  const resolved = path.resolve(requested);
  let real;
  try {
    real = fs.realpathSync(resolved);
  } catch (error) {
    locateFail('locate/root-unreadable', `Could not resolve repository root "${resolved}": ${error.message}`, {
      evidence: { reason: error.message },
      supportedFixes: ['pass a readable Git top-level directory as --repo-root'],
    });
  }
  let top;
  try {
    top = gitTopLevel(real);
  } catch (error) {
    if (error instanceof LocateError && error.code === 'locate/git-command') {
      locateFail('locate/root-not-top-level', `Repository root "${real}" is not a Git top-level.`, {
        evidence: { repoRoot: real },
        supportedFixes: ['pass the Git top-level directory as --repo-root'],
      });
    }
    throw error;
  }
  let realTop;
  try {
    realTop = fs.realpathSync(top);
  } catch (error) {
    locateFail('locate/root-unreadable', `Could not resolve Git top-level "${top}": ${error.message}`, {
      evidence: { reason: error.message },
    });
  }
  if (realTop !== real) {
    locateFail('locate/root-not-top-level', `Repository root must be the Git top-level directory: ${realTop}`, {
      evidence: { repoRoot: real, gitTopLevel: realTop },
      supportedFixes: [`pass --repo-root ${realTop}`],
    });
  }
  return realTop;
}

export function resolveCommit(root, rev) {
  const result = runGit(root, ['rev-parse', '--verify', `${rev}^{commit}`]);
  if (result.error) {
    locateFail('locate/git-unavailable', `Could not run Git: ${result.error.message}`, {
      evidence: { reason: result.error.message },
    });
  }
  if (result.status !== 0) {
    locateFail('locate/revision-unavailable', `Revision ${JSON.stringify(rev)} is not available in the local repository.`, {
      evidence: { revision: rev, exitCode: result.status, stderr: (result.stderr || '').trim() },
      supportedFixes: ['fetch the commit or pass a revision that exists locally'],
    });
  }
  const sha = result.stdout.trim().toLowerCase();
  if (!SHA_RE.test(sha)) {
    locateFail('locate/revision-unavailable', `Revision ${JSON.stringify(rev)} did not resolve to a 40-character commit SHA.`, {
      evidence: { revision: rev, resolved: sha },
    });
  }
  return sha;
}

export function parseNameStatus(stdout) {
  const fields = stdout.split('\0');
  if (fields.length && fields[fields.length - 1] === '') fields.pop();
  const changes = [];
  let index = 0;
  while (index < fields.length) {
    const statusRaw = fields[index];
    if (!statusRaw) {
      index += 1;
      continue;
    }
    const changeType = statusRaw[0];
    if (changeType === 'R' || changeType === 'C') {
      const oldPath = fields[index + 1];
      const newPath = fields[index + 2];
      if (oldPath == null || newPath == null) break;
      changes.push({ changeType, oldPath, path: newPath });
      index += 3;
      continue;
    }
    const filePath = fields[index + 1];
    if (filePath == null) break;
    changes.push({ changeType, path: filePath });
    index += 2;
  }
  return changes;
}

export function diffNameStatus(root, base, head) {
  const stdout = gitValue(
    root,
    ['diff', '--name-status', '-M', '-z', base, head],
    'locate/git-command',
    `git diff --name-status failed for ${base}..${head}.`,
  );
  return parseNameStatus(stdout);
}

export function listTree(root, rev) {
  const stdout = gitValue(
    root,
    ['ls-tree', '-r', '--name-only', '-z', rev],
    'locate/git-command',
    `git ls-tree failed for ${rev}.`,
  );
  const fields = stdout.split('\0');
  if (fields.length && fields[fields.length - 1] === '') fields.pop();
  return fields.filter(Boolean);
}

export function revListCount(root, from, to) {
  const stdout = gitValue(
    root,
    ['rev-list', '--count', `${from}..${to}`],
    'locate/git-command',
    `git rev-list --count failed for ${from}..${to}.`,
  );
  return Number(stdout.trim());
}

export function gitShow(root, rev, filePath) {
  return gitValue(
    root,
    ['show', `${rev}:${filePath}`],
    'locate/git-command',
    `git show failed for ${rev}:${filePath}.`,
  );
}
