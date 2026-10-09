#!/usr/bin/env node

import { checkForUpdate } from './check-update.mjs';

// The parent can be busy in synchronous renderer work. Enforce its original
// deadline here, in a separate event loop, so cache work cannot continue late.
if (!/^\d{1,30}$/.test(process.argv[2] || '')) process.exit(1);
const deadlineAt = BigInt(process.argv[2]);
const remainingMs = Number(deadlineAt - process.hrtime.bigint()) / 1_000_000;
if (remainingMs <= 0) process.exit(1);
const deadlineTimer = setTimeout(() => process.kill(process.pid, 'SIGKILL'), remainingMs);
deadlineTimer.unref();

const result = await checkForUpdate({
  ...(process.env.ARCHIFY_UPDATE_RELEASE_PATH
    ? { releasePath: process.env.ARCHIFY_UPDATE_RELEASE_PATH } : {}),
  ...(process.env.ARCHIFY_UPDATE_CACHE_DIRECTORY
    ? { cacheDirectory: process.env.ARCHIFY_UPDATE_CACHE_DIRECTORY } : {}),
  // Leave time to record a failed fetch, so a slow network backs off instead
  // of being killed before its result reaches the cache.
  timeoutMs: Math.max(1, Math.floor(remainingMs - 150)),
  // Recompute the remaining fetch budget after cache preparation, so that
  // startup work cannot consume the failure-recording reserve unnoticed.
  fetchDeadlineNs: deadlineAt - 150_000_000n,
});
process.stdout.write(`${JSON.stringify(result)}\n`);
