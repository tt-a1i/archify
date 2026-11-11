import assert from 'node:assert/strict';
import test from 'node:test';
import { runWithTransientNetworkRetry } from '../scripts/transient-retry.mjs';
test('retry budgets cannot skip work or silently run a fractional number of attempts', () => {
 for(const maxAttempts of [0,-1,1.5,NaN,Infinity,9007199254740992,'2']) {
  let calls=0;
  assert.throws(()=>runWithTransientNetworkRetry(()=>{calls++;return {status:1,stderr:'ECONNRESET'};},{maxAttempts}),/maxAttempts/);
  assert.equal(calls,0,'invalid configuration fails before executing an install');
 }
});
test('safe integer budgets preserve exact attempt counts', () => {
 let calls=0;
 const outcome=runWithTransientNetworkRetry(()=>{calls++;return {status:1,stderr:'ECONNRESET'};},{maxAttempts:3});
 assert.equal(calls,3);assert.equal(outcome.attempts,3);assert.equal(outcome.result.status,1);
});
