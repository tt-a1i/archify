import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ANALYZERS_ROOT, runCli } from './helpers.mjs';

const FIXTURE = path.join(ANALYZERS_ROOT, 'test', 'fixtures', 'ts-basic');

test('extract: synthetic fixture yields the expected files, imports, and unresolved counts', () => {
  const result = runCli(['extract', FIXTURE, '--json', '--out', path.join(process.env.TMPDIR || '/tmp', 'archify-analyzers-fixture.json')]);
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
  const missing = runCli(['extract', path.join(FIXTURE, 'nope'), '--json']);
  assert.equal(missing.status, 1);
  assert.equal(missing.json.status, 'failed');
  assert.equal(missing.json.diagnostics[0].code, 'cli/root-invalid');
  assert.ok(!missing.stdout.includes('at '), 'no stack frames in machine output');

  const badOption = runCli(['extract', FIXTURE, '--bogus', '--json']);
  assert.equal(badOption.json.diagnostics[0].code, 'cli/option-unknown');
});
