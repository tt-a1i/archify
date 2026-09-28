import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { isProcessRunning } from '../renderers/shared/process-running.mjs';

// Live PID: fork a sleeping child and confirm we correctly report it as running.
test('process-running: a live PID from a freshly forked child is reported as running', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  try {
    assert.equal(isProcessRunning(child.pid), true, `expected PID ${child.pid} to be reported as running`);
  } finally {
    child.kill('SIGKILL');
    await new Promise((resolve) => child.on('exit', resolve));
  }
});

// After kill, the PID must be reported as not running.
test('process-running: a forked PID is reported as not running after SIGKILL', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' });
  const pid = child.pid;
  child.kill('SIGKILL');
  await new Promise((resolve) => child.on('exit', resolve));
  assert.equal(isProcessRunning(pid), false, `expected PID ${pid} to be reported as not running after kill`);
});

// Boundary contract: invalid inputs must always return false, never throw.
// Defensive: callers may hand us a NaN, undefined, string, or array if the
// lock receipt was tampered with. We must fail closed (return false -> the
// delivery protocol then treats the receipt as malformed and emits
// `delivery/lock-invalid` from the schema guard, not a stale-lock recovery)
// instead of throwing.
test('process-running: invalid PIDs return false without throwing', () => {
  for (const bad of [0, -1, NaN, 1.5, Infinity, -Infinity, null, undefined, '123', {}, []]) {
    assert.equal(isProcessRunning(bad), false, `expected isProcessRunning(${JSON.stringify(bad)}) === false`);
  }
});

// Cross-platform contract: an EPERM error from process.kill means "the
// process exists but we cannot signal it." Per the delivery contract, that
// case is "death cannot be established" and must be reported as running so
// the caller emits `delivery/concurrent-attempt` instead of letting
// stale-lock recovery delete a lock whose owner is still active. The
// earlier draft returned false for this case; that violated the contract.
test('process-running: EPERM from process.kill is treated as running', () => {
  const original = process.kill;
  try {
    process.kill = function mockedKill(pid, signal) {
      if (signal === 0 && pid === 999_999_999) {
        const error = new Error('operation not permitted');
        error.code = 'EPERM';
        throw error;
      }
      return original.call(this, pid, signal);
    };
    assert.equal(isProcessRunning(999_999_999), true);
  } finally {
    process.kill = original;
  }
});

// Cross-platform contract: an ESRCH error from process.kill (the canonical
// "PID does not exist" answer on both POSIX and Windows) must always be
// treated as not running. This is the common-case path the delivery
// protocol depends on for `delivery/lock-stale`.
test('process-running: ESRCH from process.kill is treated as not running', () => {
  const original = process.kill;
  try {
    process.kill = function mockedKill(pid, signal) {
      if (signal === 0 && pid === 999_999_998) {
        const error = new Error('no such process');
        error.code = 'ESRCH';
        throw error;
      }
      return original.call(this, pid, signal);
    };
    assert.equal(isProcessRunning(999_999_998), false);
  } finally {
    process.kill = original;
  }
});

// Cross-platform contract: any non-ESRCH error is treated as "uncertain,
// assume alive". On POSIX that means EPERM (cross-uid / cross-container);
// on Windows that includes EPERM, EACCES, and a handful of permission
// surfaces that all signal "the process may still be there." This pins the
// fail-OPEN-on-uncertainty path so a future "fail closed" rewrite does not
// silently regress the contract.
test('process-running: any non-ESRCH error code is treated as running', () => {
  const original = process.kill;
  try {
    process.kill = function mockedKill(pid, signal) {
      if (signal === 0 && pid === 999_999_997) {
        const error = new Error('access denied');
        error.code = 'EACCES';
        throw error;
      }
      return original.call(this, pid, signal);
    };
    assert.equal(isProcessRunning(999_999_997), true);
  } finally {
    process.kill = original;
  }
});

// No unexpected side-effects: isProcessRunning must not actually send a signal.
// We assert that by mocking process.kill and confirming we never call it with
// signal !== 0 for any input we feed the function.
test('process-running: never sends a real signal', () => {
  const original = process.kill;
  try {
    const sent = [];
    process.kill = function mockedKill(pid, signal) {
      sent.push({ pid, signal });
      // Pretend success for liveness (signal 0 path).
      return true;
    };
    isProcessRunning(12345);
    isProcessRunning(Number.MAX_SAFE_INTEGER);
    assert.deepEqual(sent, [
      { pid: 12345, signal: 0 },
      { pid: Number.MAX_SAFE_INTEGER, signal: 0 },
    ]);
  } finally {
    process.kill = original;
  }
});