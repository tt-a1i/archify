#!/usr/bin/env node

import { checkForUpdate } from './check-update.mjs';

// Arguments: the delivery's wait deadline and, optionally, a later refresh
// deadline, both as process.hrtime.bigint() values. The parent can be busy in
// synchronous renderer work, so this separate event loop enforces them itself.
const FAILURE_RECORD_RESERVE_MS = 150;
const REFRESH_RECORD_RESERVE_MS = 1_000;
const deadlineArgument = /^\d{1,30}$/;
const [waitArgument, refreshArgument = waitArgument] = process.argv.slice(2);
if (!deadlineArgument.test(waitArgument || '') || !deadlineArgument.test(refreshArgument)) process.exit(1);
const waitDeadline = BigInt(waitArgument);
const refreshDeadline = BigInt(refreshArgument) > waitDeadline ? BigInt(refreshArgument) : waitDeadline;
const remainingMs = Number(refreshDeadline - process.hrtime.bigint()) / 1_000_000;
if (remainingMs <= 0) process.exit(1);
const deadlineTimer = setTimeout(() => process.kill(process.pid, 'SIGKILL'), remainingMs);
deadlineTimer.unref();

// A delivery stops reading at its wait deadline. A slow but reachable manifest
// may finish later and records its result in the cache for the next delivery,
// while leaving time to record a failed fetch so that an unreachable network
// still backs off instead of being killed before the cache is updated.
const msToNs = (milliseconds) => BigInt(milliseconds) * 1_000_000n;
const waitFetchDeadline = waitDeadline - msToNs(FAILURE_RECORD_RESERVE_MS);
const refreshFetchDeadline = refreshDeadline - msToNs(REFRESH_RECORD_RESERVE_MS);
const fetchDeadlineNs = refreshFetchDeadline > waitFetchDeadline ? refreshFetchDeadline : waitFetchDeadline;

// The parent may already have closed this pipe; a late write is not an error.
process.stdout.on('error', () => {});
function emit(phase, result) {
  try {
    process.stdout.write(`${JSON.stringify({ phase, result })}\n`);
  } catch {
    // See above.
  }
}

const result = await checkForUpdate({
  ...(process.env.ARCHIFY_UPDATE_RELEASE_PATH
    ? { releasePath: process.env.ARCHIFY_UPDATE_RELEASE_PATH } : {}),
  ...(process.env.ARCHIFY_UPDATE_CACHE_DIRECTORY
    ? { cacheDirectory: process.env.ARCHIFY_UPDATE_CACHE_DIRECTORY } : {}),
  timeoutMs: Math.max(1, Math.floor(Number(fetchDeadlineNs - process.hrtime.bigint()) / 1_000_000)),
  // Recompute the remaining fetch budget after cache preparation, so that
  // startup work cannot consume the failure-recording reserve unnoticed.
  fetchDeadlineNs,
  // A delivery that stops waiting still reports a previously validated update.
  onNetworkCheck: (known) => { if (known) emit('pending', known); },
});
emit('final', result);
