// Execute generated commands in the advertised shell, not an argv simulator.
// Windows CI runs this file through native cmd.exe on both maintained lanes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { baselineCommand, taskCommand } from '../lib/task-command.mjs';

const CHECK = fileURLToPath(new URL('../bin/check.mjs', import.meta.url));
const windows = process.platform === 'win32';
const shellName = windows ? 'cmd.exe (delayed expansion on)' : 'POSIX sh';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-command-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function execute(command) {
  // /v:on is stricter than the usual Command Prompt default. Values containing
  // ! must remain literal there too. Do not pass command via shell:true, which
  // would introduce an extra, platform-dependent quoting layer.
  return spawnSync(windows ? process.env.ComSpec || 'cmd.exe' : '/bin/sh',
    windows ? ['/d', '/v:on', '/s', '/c', command] : ['-c', command], {
      encoding: 'utf8', timeout: 60000, windowsVerbatimArguments: windows,
      env: { ...process.env, ARCHIFY_COMMAND_EXPANSION: 'must-not-expand',
        PATH: `${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || ''}` },
    });
}

for (const name of ["tool's home & (space)", 'tool %ARCHIFY_COMMAND_EXPANSION% !ARCHIFY_COMMAND_EXPANSION!']) {
  test(`task command: ${shellName} preserves CLI, output and root paths in ${name}`, (t) => {
    const dir = path.join(fixture(t), name);
    fs.mkdirSync(dir);
    const cli = path.join(dir, "capture's args.cjs");
    fs.writeFileSync(cli, 'console.log(JSON.stringify(process.argv.slice(2)));');
    const out = path.join(dir, "analysis's output");
    const root = `${path.join(dir, "repo's sources")}${path.sep}`;
    const id = 'COMP-123456abcdef';
    const command = taskCommand(cli, id, root, out);
    const result = execute(command);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ['code-analysis', 'task', out, '--root', root, '--format', 'json', '--finding', id]);

    // The text-template placeholder is an argument, never shell redirection.
    const template = execute(taskCommand(cli, '<id>', root, out));
    assert.equal(template.status, 0, template.stdout + template.stderr);
    assert.equal(JSON.parse(template.stdout).at(-1), '<id>');

    const config = path.join(dir, "analysis's config.json");
    const baseline = path.join(dir, "analysis's baseline.json");
    const adopt = baselineCommand(cli, root, { language: 'ts', config, baseline });
    const adopted = execute(adopt);
    assert.equal(adopted.status, 0, adopted.stdout + adopted.stderr);
    assert.deepEqual(JSON.parse(adopted.stdout), ['code-analysis', 'check', root, '--language', 'ts', '--config', config,
      '--baseline', baseline, '--update-baseline', '--reason', 'existing findings recorded when adopting Code Analysis']);

    fs.writeFileSync(cli, 'process.exitCode = 2;');
    assert.equal(execute(command).status, 2, 'the copied command preserves a task failure exit code');
    assert.equal(execute(adopt).status, 2, 'the copied baseline command preserves a failure exit code');
  });
}

test(`check receipt: a copied lead prepares a verified task through ${shellName}`, (t) => {
  const dir = fixture(t);
  const root = path.join(dir, "repo's sources & spaces");
  const out = path.join(dir, "analysis's output & spaces");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'app.ts'), 'export function f(x: boolean) { if (x) return 1; return 0; }\n');
  const config = path.join(dir, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ rules: { complexity: { function: { warning: { complexity: 0 } } } } }));
  const checked = spawnSync(process.execPath, [CHECK, root, '--language', 'ts', '--config', config, '--out', out, '--fail-on', 'never', '--json'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  const receipt = JSON.parse(checked.stdout);
  assert.equal(receipt.investigation.shell, windows ? 'cmd.exe' : 'POSIX sh');
  const lead = receipt.investigation.leads[0];
  assert.ok(lead, 'fixture produces a real finding');
  const result = execute(lead.task);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const task = JSON.parse(result.stdout);
  assert.ok(task.findings.some((finding) => finding.id === lead.id));
  assert.equal(task.evidence.status, 'valid');
});
