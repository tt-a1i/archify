import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const cli = path.join(root, 'bin/archify.mjs');
const moduleRoot = path.join(root, 'modules/code-analysis');
const run = args => spawnSync(process.execPath, [cli, 'code-analysis', ...args], { encoding: 'utf8' });
test('Code Analysis exposes prepare, serve, check and task through the Archify CLI', () => {
  const prepareHelp = run(['prepare', '--help']);
  assert.equal(prepareHelp.status, 0, prepareHelp.stderr);
  assert.match(prepareHelp.stdout, /archify code-analysis prepare/);
  const help = run(['serve', '--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /archify code-analysis serve/);
  const checkHelp = run(['check', '--help']);
  assert.equal(checkHelp.status, 0, checkHelp.stderr);
  assert.match(checkHelp.stdout, /archify code-analysis check <repo-root>/);
  assert.match(checkHelp.stdout, /Exit codes: 0 passed, 1 gate failed, 2 analysis or usage error/);
  const taskHelp = run(['task', '--help']);
  assert.equal(taskHelp.status, 0, taskHelp.stderr);
  assert.match(taskHelp.stdout, /archify code-analysis task/);
  const other = run(['extract', path.join(moduleRoot, 'test/fixtures/ts-basic')]);
  assert.notEqual(other.status, 0);
  assert.match(other.stderr, /commands: prepare, serve, check, task, import-review/);
  const missing = run(['serve', path.join(moduleRoot, 'test/fixtures/ts-basic')]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /requires --out/);
  for (const command of ['prepare', 'serve']) {
    const invalid = run([command, moduleRoot, '--out', 'unused', '--map', 'missing.json']);
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr + invalid.stdout, /--map requires --ir/);
  }

});
test('Code Analysis regression suite', () => {
  const tests = fs.readdirSync(path.join(moduleRoot, 'test')).filter(f => f.endsWith('.test.mjs')).sort().map(f => path.join(moduleRoot, 'test', f));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', ...tests], { env, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
