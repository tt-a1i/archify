import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const cases = [];
for (const [id, seed, method, numeric, expected] of [
  ['sort-default', [2, 10, 1], 'sort', false, [1, 10, 2]],
  ['sort-numeric', [2, 10, 1], 'sort', true, [1, 2, 10]],
  ['toSorted-default', [2, 10, 1], 'toSorted', false, [1, 10, 2]],
  ['toSorted-numeric', [2, 10, 1], 'toSorted', true, [1, 2, 10]],
  ['strings-default', ['2', '10', '1'], 'sort', false, ['1', '10', '2']],
]) {
  const input = [...seed];
  const before = [...input];
  const result = numeric ? input[method]((a, b) => a - b) : input[method]();
  assert.deepEqual(result, expected);
  assert.deepEqual(input, method === 'sort' ? expected : before);
  assert.equal(result === input, method === 'sort');
  assert.deepEqual(result.map(value => typeof value), seed.map(value => typeof value));
  cases.push({ id, method, comparison: numeric ? '(a, b) => a - b' : 'default',
    before, result, after: [...input], returnsSameArray: result === input,
    resultTypes: result.map(value => typeof value), inputTypes: input.map(value => typeof value) });
}

const comparison = {
  numeric: 10 < 2,
  stringRepresentations: [String(10), String(2)],
  stringOrder: String(10) < String(2),
};
assert.equal(comparison.numeric, false);
assert.equal(comparison.stringOrder, true);
console.log(JSON.stringify({
  environment: { node: process.version, v8: process.versions.v8,
    platform: process.platform, arch: process.arch,
    executableSha256: createHash('sha256').update(fs.readFileSync(process.execPath)).digest('hex') },
  cases, comparison,
  scope: 'Dense ordinary Arrays of these finite numbers/strings. No TypedArray, sparse entries, undefined/NaN, BigInt, locale collation, objects, comparator side effects, sort-performance or binary-reproduction claim.',
}, null, 2));
