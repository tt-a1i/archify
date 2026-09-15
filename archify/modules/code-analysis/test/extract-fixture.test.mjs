import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { BAUIFY_ROOT, runExtract } from './helpers.mjs';

const FIXTURE = path.join(BAUIFY_ROOT, 'test', 'fixtures', 'ts-basic');

test('extract: synthetic fixture yields the expected files, imports, and unresolved counts', () => {
  const result = runExtract([FIXTURE, '--json', '--out', path.join(process.env.TMPDIR || os.tmpdir(), 'bauify-fixture.json')]);
  assert.equal(result.status, 0, result.stderr);
  const facts = JSON.parse(fs.readFileSync(result.json.out, 'utf8'));
  const expected = JSON.parse(fs.readFileSync(path.join(FIXTURE, 'expected.json'), 'utf8'));
  assert.deepEqual(facts.files, expected.files);
  assert.deepEqual(facts.imports, expected.imports);
  assert.deepEqual(facts.unresolved, expected.unresolved);
  assert.equal(facts.schema_version, 1);
  assert.equal(facts.repository.language, 'ts');
});

test('extract: failures are structured diagnostics, never stacks', () => {
  const missing = runExtract([path.join(FIXTURE, 'nope'), '--json']);
  assert.equal(missing.status, 1);
  assert.equal(missing.json.status, 'failed');
  assert.equal(missing.json.diagnostics[0].code, 'cli/root-invalid');
  assert.ok(!missing.stdout.includes('at '), 'no stack frames in machine output');

  const badOption = runExtract([FIXTURE, '--bogus', '--json']);
  assert.equal(badOption.json.diagnostics[0].code, 'cli/option-unknown');
});
