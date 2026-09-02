import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isTransientNetworkFailure,
  runWithTransientNetworkRetry,
} from '../scripts/transient-retry.mjs';

test('retries one transient network failure and reports both attempts', () => {
  const results = [
    { status: null, error: Object.assign(new Error('spawnSync npm ETIMEDOUT'), { code: 'ETIMEDOUT' }) },
    { status: 0, stdout: '', stderr: '' },
  ];
  const attempts = [];

  const outcome = runWithTransientNetworkRetry((attempt) => {
    attempts.push(attempt);
    return results.shift();
  });

  assert.equal(outcome.result.status, 0);
  assert.equal(outcome.attempts, 2);
  assert.deepEqual(attempts, [1, 2]);
});

test('does not retry a non-network installation failure', () => {
  let calls = 0;
  const outcome = runWithTransientNetworkRetry(() => {
    calls += 1;
    return { status: 1, stderr: 'npm ERR! lifecycle script failed' };
  });

  assert.equal(outcome.result.status, 1);
  assert.equal(outcome.attempts, 1);
  assert.equal(calls, 1);
});

test('recognizes only the bounded set of transient network failures', () => {
  for (const code of ['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN']) {
    assert.equal(isTransientNetworkFailure({ error: { code } }), true, code);
    assert.equal(isTransientNetworkFailure({ stderr: `request failed: ${code}` }), true, code);
  }
  assert.equal(isTransientNetworkFailure({ stderr: 'npm ERR! EACCES permission denied' }), false);
});
