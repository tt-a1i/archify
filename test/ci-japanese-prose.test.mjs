import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyPaths } from '../scripts/ci-scope.mjs';
test('Japanese README receives the same repository prose coverage as other languages', () => {
  assert.deepEqual(classifyPaths(['README_JA.md']), classifyPaths(['README_EN.md']));
  assert.deepEqual(classifyPaths(['README_JA.md','archify/bin/archify.mjs']), classifyPaths(['README_EN.md','archify/bin/archify.mjs']));
});
