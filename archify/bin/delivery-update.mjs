import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const childPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'delivery-update-child.mjs');
// Delivery waits at most DEADLINE_MS. A check that is still running then
// continues in the background until REFRESH_DEADLINE_MS, so that a slow but
// reachable manifest updates the cache and the next delivery shows the notice.
const DEADLINE_MS = 1_000;
// Keep below the preference wait in scripts/check-update.mjs, so that a user's
// snooze or ignore outlasts a refresh that holds the cache claim.
const REFRESH_DEADLINE_MS = 6_000;
const MAX_OUTPUT_BYTES = 16 * 1_024;

function unavailable(reason) {
  return { status: 'unavailable', installedVersion: null, availableVersion: null,
    releaseNotes: null, checkedAt: null, source: null, noticeRequired: false,
    noticeText: null, reason };
}

function normalize(result) {
  if (result?.status === 'current') return {
    status: 'current', installedVersion: result.installedVersion,
    availableVersion: result.availableVersion, releaseNotes: null,
    checkedAt: result.checkedAt, source: result.source,
    noticeRequired: false, noticeText: null,
  };
  if (result?.status !== 'update_available') {
    return unavailable(result?.reason || (result?.status === 'silent' ? 'no-update' : 'invalid-result'));
  }
  const noticeRequired = result.noticeRequired !== false;
  const cached = result.source === 'cache';
  const noticeText = noticeRequired
    ? `Archify ${result.severity === 'security' ? 'security update' : 'update'}: ${result.installedVersion} → ${result.latestVersion}. ${cached
      ? `A previous check at ${result.checkedAt} found a newer release.`
      : 'A newer release is available.'} Release notes: ${result.releaseNotes}. Would you like me to update Archify?`
    : null;
  return {
    status: 'update_available',
    installedVersion: result.installedVersion,
    availableVersion: result.latestVersion,
    releaseNotes: result.releaseNotes,
    severity: result.severity,
    summary: result.summary ?? null,
    checkedAt: result.checkedAt,
    source: result.source,
    noticeRequired,
    noticeText,
    ...(result.eventKey ? { eventKey: result.eventKey } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.suppressedUntil ? { suppressedUntil: result.suppressedUntil } : {}),
  };
}

function parseMessage(line) {
  try {
    const message = JSON.parse(line);
    if (message && typeof message === 'object' && ['pending', 'final'].includes(message.phase)) return message;
  } catch {
    // Reported below as an invalid result.
  }
  return null;
}

export function startDeliveryUpdateCheck({
  env = process.env, deadlineMs = DEADLINE_MS, refreshDeadlineMs = REFRESH_DEADLINE_MS,
  checkerPath = childPath, onBackgroundRefresh,
} = {}) {
  if (env.ARCHIFY_UPDATE_CHECK_DISABLED === '1') return Promise.resolve(unavailable('disabled'));
  const refreshMs = Math.max(deadlineMs, refreshDeadlineMs);
  return new Promise((resolve) => {
    let child;
    try {
      const startedNs = process.hrtime.bigint();
      const deadlineNs = startedNs + BigInt(Math.floor(deadlineMs * 1_000_000));
      const refreshNs = startedNs + BigInt(Math.floor(refreshMs * 1_000_000));
      child = spawn(process.execPath, [checkerPath, String(deadlineNs), String(refreshNs)], {
        env,
        // Only a detached process survives its parent on Windows, where Node
        // otherwise terminates children with the parent's job object.
        detached: refreshMs > deadlineMs,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      resolve(unavailable('runtime-unavailable'));
      return;
    }
    let settled = false;
    let output = '';
    let pending = null;
    let overflow = false;
    let killed = false;
    const exited = new Promise((resolveExit) => {
      child.on('close', (code, signal) => resolveExit({ code, signal }));
    });
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(waitTimer);
      resolve(result);
    };
    const kill = () => {
      killed = true;
      child.kill('SIGKILL');
    };
    // Stop reading without waiting for exit, so that the child cannot delay
    // delivery or keep this process alive; it enforces its own deadline.
    const release = () => {
      child.stdout.destroy();
      child.unref();
    };
    const consume = (chunk) => {
      if (settled) return;
      if (Buffer.byteLength(output) + chunk.length > MAX_OUTPUT_BYTES) {
        overflow = true;
        kill();
        return;
      }
      output += chunk.toString('utf8');
      let newline;
      while (!settled && (newline = output.indexOf('\n')) !== -1) {
        const message = parseMessage(output.slice(0, newline));
        output = output.slice(newline + 1);
        if (message?.phase === 'pending') pending = message;
        else if (message?.phase === 'final') {
          settle(normalize(message.result));
          release();
        }
      }
    };
    const stopWaiting = () => {
      if (settled) return;
      settle(pending ? normalize(pending.result) : unavailable('timeout'));
      if (refreshMs <= deadlineMs) {
        kill();
        return;
      }
      release();
      const refreshTimer = setTimeout(kill, Math.max(0, refreshMs - deadlineMs));
      refreshTimer.unref();
      exited.then(() => clearTimeout(refreshTimer));
      if (typeof onBackgroundRefresh === 'function') onBackgroundRefresh({ pid: child.pid, exited });
    };
    // A synchronous renderer can delay this timer, the child's output and its
    // exit together. Read output that is already available before deciding,
    // so that a complete result wins even if the timer fired late.
    const waitTimer = setTimeout(() => setImmediate(stopWaiting), deadlineMs);
    child.stdout.on('data', consume);
    child.on('error', () => {});
    exited.then(({ code, signal }) => {
      if (settled) return;
      if (overflow || code === 0) return settle(unavailable('invalid-result'));
      if (killed || signal === 'SIGKILL') {
        return settle(pending ? normalize(pending.result) : unavailable('timeout'));
      }
      settle(unavailable('check-failed'));
    });
  });
}
