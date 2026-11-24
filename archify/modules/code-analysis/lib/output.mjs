import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { DiagnosticError, fail } from '../core/index.mjs';

const RECOVERY_REQUIRED = 'analysis/output-recovery-required';
export const OUTPUT_BUSY = 'analysis/output-busy';
const OWNER = /^([0-9a-f]{16})-([1-9][0-9]{0,9})-[0-9a-f]{16}$/;
const HOST = createHash('sha256').update(os.hostname()).digest('hex').slice(0, 16);
const MOVE_PLAN = 'move-plan.json';
const ROLLBACK_FAILED = 'rollback-failed';
const RECOVERY_FIXES = ['retain the output and backups for recovery', 'use another --out directory for a new run'];

export function needsOutputRecovery(error) {
  return error instanceof DiagnosticError && error.diagnostics.some(diagnostic => diagnostic.code === RECOVERY_REQUIRED);
}

// The claimant owns this directory from reading the comparison through publish.
// Keep backups when a rollback cannot finish, so a retry cannot use mixed data.
export async function withAnalysisOutput(out, run) {
  fs.mkdirSync(out, { recursive: true });
  const lock = path.join(out, '.archify-analysis.lock');
  const workspace = claimOutput(lock);
  let preserve = false;
  try {
    return await run(workspace);
  } catch (error) {
    preserve = needsOutputRecovery(error);
    throw error;
  } finally {
    if (!preserve) {
      try {
        fs.rmSync(workspace, { recursive: true, force: true });
        removeVacantLock(lock);
      } catch (error) {
        // Cleanup can warn about a retained lock without changing a committed gate result.
        process.emitWarning(`Could not remove the analysis output lock ${JSON.stringify(lock)} (${error.code || 'unknown error'}).`, { code: 'ARCHIFY_ANALYSIS_LOCK_CLEANUP' });
      }
    }
  }
}

function busy(lock, pid = null) {
  fail(OUTPUT_BUSY, 'An analysis already owns this output directory.', {
    subject: { out: path.dirname(lock), lock }, evidence: { pid },
    supportedFixes: ['retry after the other analysis finishes or choose another --out directory'],
  });
}

function removeVacantLock(lock) {
  try {
    fs.rmdirSync(lock);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error;
  }
}

function claimOutput(lock) {
  const label = `${HOST}-${process.pid}-${randomBytes(8).toString('hex')}`;
  const workspace = path.join(lock, label);
  const candidate = fs.mkdtempSync(path.join(path.dirname(lock), '.archify-analysis.claim-'));
  const claim = () => {
    try {
      // An existing claimant's directory is nonempty and cannot be replaced.
      fs.renameSync(candidate, lock);
      return true;
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code)) throw error;
      return false;
    }
  };
  try {
    fs.mkdirSync(path.join(candidate, label));
    if (claim()) return workspace;
    let owners = [];
    try {
      if (outputEntry(lock, { directory: true })) owners = fs.readdirSync(lock, { withFileTypes: true });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (owners.length === 0) {
      removeVacantLock(lock);
      if (claim()) return workspace;
      busy(lock);
    }
    const [owner] = owners;
    const ownerParts = owners.length === 1 && owner.isDirectory() ? OWNER.exec(owner.name) : null;
    const pid = ownerParts ? Number(ownerParts[2]) : null;
    if (!ownerParts || pid > 0x7fffffff) busy(lock, pid);

    const abandoned = path.join(lock, owner.name);
    const plan = path.join(abandoned, MOVE_PLAN);
    // A workbench can stay alive after its publication has stopped.
    const rollbackFailed = outputEntry(path.join(abandoned, ROLLBACK_FAILED));
    if (!rollbackFailed && (ownerParts[1] !== HOST || processExists(pid))) busy(lock, pid);
    if (rollbackFailed || outputEntry(plan)) {
      const message = rollbackFailed
        ? 'An analysis publication still needs recovery after a failed rollback.'
        : 'An interrupted analysis left a publication that needs recovery.';
      fail(RECOVERY_REQUIRED, message, {
        subject: { out: path.dirname(lock), lock, plan }, evidence: { pid },
        supportedFixes: RECOVERY_FIXES,
      });
    }
    try {
      // Claim this exact abandoned owner. If two retries race, only one can
      // move its unique name, and the public lock never becomes vacant.
      fs.renameSync(abandoned, workspace);
    } catch (error) {
      if (error.code === 'ENOENT') busy(lock);
      throw error;
    }
    for (const entry of fs.readdirSync(workspace)) fs.rmSync(path.join(workspace, entry), { recursive: true, force: true });
    return workspace;
  } finally {
    fs.rmSync(candidate, { recursive: true, force: true });
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code !== 'ESRCH';
  }
}

export function outputEntry(target, { directory = false } = {}) {
  try {
    const stat = fs.lstatSync(target);
    if (directory ? stat.isDirectory() : stat.isFile()) return stat;
    fail('analysis/output-path-conflict', `An analysis output path is occupied by an unexpected entry: ${target}`, {
      subject: { file: target }, supportedFixes: ['choose another --out directory or move the conflicting entry'],
    });
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// All destinations have been made vacant by the time their move is applied.
// Reverse order restores both the staged candidate and any public entries.
export function publishAnalysisMoves(moves, lock) {
  const plan = path.join(lock, MOVE_PLAN);
  fs.writeFileSync(plan, JSON.stringify(moves, null, 2), { flag: 'wx' });
  const applied = [];
  try {
    for (const [from, to] of moves) {
      fs.renameSync(from, to);
      applied.push([from, to]);
    }
  } catch (error) {
    while (applied.length) {
      const [from, to] = applied[applied.length - 1];
      try {
        fs.renameSync(to, from);
        applied.pop();
      } catch (rollback) {
        const evidence = {
          publishError: error.message,
          rollbackError: rollback.message,
          restore: applied.reverse().map(([before, after]) => ({ from: after, to: before })),
        };
        // The plan already protects the backups if recording the terminal state also fails.
        try { fs.writeFileSync(path.join(lock, ROLLBACK_FAILED), '', { flag: 'wx' }); }
        catch (markerError) { evidence.recoveryMarkerError = markerError.message; }
        fail(RECOVERY_REQUIRED, 'Analysis publication failed and the previous output could not be fully restored.', {
          subject: { out: path.dirname(path.dirname(lock)), lock, plan },
          evidence,
          supportedFixes: RECOVERY_FIXES,
        });
      }
    }
    throw error;
  }
}

export function writeCheckOutputs(out, lock, files) {
  const candidates = path.join(lock, 'next');
  const backups = path.join(lock, 'previous');
  fs.mkdirSync(candidates);
  fs.mkdirSync(backups);
  const moves = [];
  for (const [name, contents] of files) {
    const target = path.join(out, name);
    const candidate = path.join(candidates, name);
    const existing = outputEntry(target);
    if (existing) fs.accessSync(target, fs.constants.W_OK);
    fs.writeFileSync(candidate, contents, { flag: 'wx' });
    if (existing) {
      fs.chmodSync(candidate, existing.mode & 0o777);
      moves.push([target, path.join(backups, name)]);
    }
    moves.push([candidate, target]);
  }
  publishAnalysisMoves(moves, lock);
}
