import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const childPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'delivery-update-child.mjs');
const DEADLINE_MS = 1_000;
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
      : 'A newer release is available.'} Release notes: ${result.releaseNotes}. The installed Skill has not changed; ask to snooze or ignore this reminder.`
    : null;
  return {
    status: 'update_available',
    installedVersion: result.installedVersion,
    availableVersion: result.latestVersion,
    releaseNotes: result.releaseNotes,
    severity: result.severity,
    checkedAt: result.checkedAt,
    source: result.source,
    noticeRequired,
    noticeText,
    ...(result.eventKey ? { eventKey: result.eventKey } : {}),
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.suppressedUntil ? { suppressedUntil: result.suppressedUntil } : {}),
  };
}

export function startDeliveryUpdateCheck({
  env = process.env, deadlineMs = DEADLINE_MS, checkerPath = childPath,
} = {}) {
  if (env.ARCHIFY_UPDATE_CHECK_DISABLED === '1') return Promise.resolve(unavailable('disabled'));
  return new Promise((resolve) => {
    let child;
    try {
      const deadlineNs = process.hrtime.bigint() + BigInt(Math.floor(deadlineMs * 1_000_000));
      child = spawn(process.execPath, [checkerPath, String(deadlineNs)], {
        env,
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
    } catch {
      resolve(unavailable('runtime-unavailable'));
      return;
    }
    let output = '';
    let timedOut = false;
    let overflow = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, deadlineMs);
    child.stdout.on('data', (chunk) => {
      if (Buffer.byteLength(output) + chunk.length > MAX_OUTPUT_BYTES) {
        overflow = true;
        child.kill('SIGKILL');
      } else output += chunk.toString('utf8');
    });
    child.on('error', () => {});
    child.on('close', (code) => {
      clearTimeout(timer);
      if (overflow) return resolve(unavailable('invalid-result'));
      // A synchronous renderer can delay both this callback and the parent's
      // timer. A complete child result wins even if the timer fired meanwhile.
      if (code === 0 && output.endsWith('\n')) {
        try { return resolve(normalize(JSON.parse(output))); }
        catch { return resolve(unavailable('invalid-result')); }
      }
      resolve(unavailable(timedOut || child.signalCode === 'SIGKILL' ? 'timeout' : 'check-failed'));
    });
  });
}
