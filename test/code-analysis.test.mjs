import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createTranslator, messagesFor } from '../archify/modules/code-analysis/overlay/i18n.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const cli = path.join(root, 'bin/archify.mjs');
const moduleRoot = path.join(root, 'modules/code-analysis');
const run = args => spawnSync(process.execPath, [cli, 'code-analysis', ...args], { encoding: 'utf8' });
test('verification labels and mismatch guidance have Chinese translations', () => {
  const translate = createTranslator(messagesFor('zh-CN'));
  assert.equal(translate('Task JSON from the previous run'), '上一轮导出的任务 JSON');
  assert.equal(translate('The task does not match the previous analysis.'), '任务与上一轮分析不匹配。');
});
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
  for (const output of [prepareHelp.stdout, help.stdout]) {
    assert.match(output, /--base <commit> --head <commit>/);
  }
  for (const synopsis of publicHelp.stdout.split('\n').filter(line => /archify (?:start|code-analysis (?:prepare|serve)) <repo-root>/.test(line))) {
    assert.match(synopsis, /--base <commit> --head <commit>/);
  }
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
