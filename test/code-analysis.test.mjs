import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const cli = path.join(root, 'bin/archify.mjs');
const moduleRoot = path.join(root, 'modules/code-analysis');
const run = args => spawnSync(process.execPath, [cli, 'code-analysis', ...args], { encoding: 'utf8' });
test('Code Analysis exposes the workbench, checks, task and verification commands through the Archify CLI', () => {
  const publicHelp = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(publicHelp.status, 0);
  assert.match(publicHelp.stdout.replace(/\s+/g, ' '), /start <repo-root> \[--ir <architecture.json>\] \[--locale/);
  assert.match(publicHelp.stdout, /prepare <repo-root> --out <dir> \[--ir/);
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
  const verifyHelp = run(['verify-change', '--help']);
  assert.equal(verifyHelp.status, 0, verifyHelp.stderr);
  assert.match(verifyHelp.stdout, /archify code-analysis verify-change <analysis-dir> --task <task.json>/);
  const other = run(['extract', path.join(moduleRoot, 'test/fixtures/ts-basic')]);
  assert.notEqual(other.status, 0);
  const operationList = other.stderr.match(/^archify code-analysis commands: (.+)\.$/m);
  assert.ok(operationList, other.stderr);
  for (const operation of ['prepare', 'serve', 'check', 'task', 'verify-change', 'import-review', 'drift', 'verify-drift']) {
    assert.ok(operationList[1].split(', ').includes(operation), operation);
  }
  const driftHelp = run(['drift', '--help']);
  assert.equal(driftHelp.status, 0, driftHelp.stderr);
  assert.match(driftHelp.stdout, /code-analysis drift <git-repo> --base <full-sha> --head <full-sha>/);
  const missing = run(['serve', path.join(moduleRoot, 'test/fixtures/ts-basic')]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /requires --out/);
  for (const command of ['prepare', 'serve']) {
    const invalid = run([command, moduleRoot, '--out', 'unused', '--map', 'missing.json']);
    assert.equal(invalid.status, 2);
    assert.match(invalid.stderr + invalid.stdout, /--map requires --ir/);
  }

});
