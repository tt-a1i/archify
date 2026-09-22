import assert from 'node:assert/strict';
import {createPublisher} from './source/publisher.mjs';
const receipts = [];
for (const scenario of ['closed', 'denied', 'denied-zero', 'success', 'authorize-error', 'convert-error', 'save-error', 'skip-error', 'close-during-authorize']) {
  const calls = [];
  const failure = new Error('fixture');
  let publisher;
  const callback = name => async value => {
    calls.push([name, value]);
    if (scenario === `${name}-error` || scenario === 'skip-error' && name === 'onSkip') throw failure;
    if (name === 'authorize') {
      if (scenario === 'close-during-authorize') publisher.close();
      return scenario === 'denied-zero' ? 0 : scenario !== 'denied';
    }
    if (name === 'convert') return {body: value.toUpperCase()};
  };
  publisher = createPublisher(Object.fromEntries(['authorize','convert','save','onSkip'].map(n=>[n, callback(n)])));
  if (scenario === 'closed' || scenario === 'skip-error') publisher.close();
  let result, error;
  try { result = await publisher.publish('hello'); } catch (caught) { assert.equal(caught, failure); error = 'fixture'; }
  const names = calls.map(c=>c[0]);
  const expected = {
    closed:['onSkip'],denied:['authorize','onSkip'],'denied-zero':['authorize','onSkip'],success:['authorize','convert','save'],
    'authorize-error':['authorize'],'convert-error':['authorize','convert'],
    'save-error':['authorize','convert','save'],'skip-error':['onSkip'],
    'close-during-authorize':['authorize','convert','save'],
  }[scenario];
  assert.deepEqual(names, expected);
  assert.equal(publisher.status().published, scenario === 'success' || scenario === 'close-during-authorize' ? 1 : 0);
  assert.equal(Boolean(error), scenario.endsWith('-error'));
  receipts.push({scenario, calls, result, error, state: publisher.status()});
}
console.log(JSON.stringify({fixture:'document-publisher',cases:receipts},null,2));
