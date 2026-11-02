import assert from 'node:assert/strict';
import test from 'node:test';
import { isTransientNetworkFailure, runWithTransientNetworkRetry } from '../scripts/transient-retry.mjs';
test('network retry classification matches complete codes, not unrelated identifiers', () => {
 for(const code of ['NOT_ETIMEDOUT','ECONNRESETTING','EAI_AGAINST']) {
  assert.equal(isTransientNetworkFailure({stderr:`npm ERR! lifecycle failure in ${code}`}),false,code);
  let calls=0;
  const outcome=runWithTransientNetworkRetry(()=>{calls++;return {status:1,stderr:`npm ERR! lifecycle failure in ${code}`};});
  assert.equal(calls,1);assert.equal(outcome.attempts,1);
 }
 for(const code of ['ETIMEDOUT','ECONNRESET','EAI_AGAIN']) {
  assert.equal(isTransientNetworkFailure({stderr:`npm ERR! code ${code}\nrequest failed`}),true,code);
  assert.equal(isTransientNetworkFailure({error:{code}}),true,code);
 }
});
