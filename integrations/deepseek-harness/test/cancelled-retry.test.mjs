import assert from 'node:assert/strict';
import test from 'node:test';
import { runWithTransientNetworkRetry } from '../scripts/transient-retry.mjs';
test('a terminated subprocess is not restarted because its old log mentions a network error', () => {
  for (const signal of ['SIGTERM','SIGINT','SIGKILL']) {
    let calls=0;
    const result={status:null,signal,stderr:'npm ERR! ECONNRESET request failed'};
    const outcome=runWithTransientNetworkRetry(()=>{ calls++; return result; });
    assert.equal(calls,1,signal);
    assert.equal(outcome.attempts,1);
    assert.equal(outcome.result,result);
  }
});
