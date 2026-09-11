import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { resolveCli, resolveCliInvocation } from '../scripts/resolve-cli.mjs';

test('Windows CLI resolution uses .cmd shims for npm/npx and .exe for other commands', () => {
  assert.equal(resolveCli('npx', 'win32'), 'npx.cmd');
  assert.equal(resolveCli('npm', 'win32'), 'npm.cmd');
  assert.equal(resolveCli('tar', 'win32'), 'tar.exe');
  assert.equal(resolveCli('git', 'win32'), 'git.exe');
  assert.equal(resolveCli('npx.cmd', 'win32'), 'npx.cmd');
  assert.equal(resolveCli('tar.exe', 'win32'), 'tar.exe');
  assert.equal(resolveCli('npx', 'darwin'), 'npx');
  assert.equal(resolveCli('npm', 'linux'), 'npm');
  assert.equal(resolveCli('tar', 'darwin'), 'tar');
});

test('Windows npm shims launch their JavaScript CLI through Node', () => {
  const execPath = 'C:\\node\\node.exe';
  const npmCli = 'C:\\node\\node_modules\\npm\\bin\\npm-cli.js';
  const invocation = resolveCliInvocation('npm', ['--version'], {
    platform: 'win32',
    execPath,
    env: {},
    existsSync(candidate) {
      return candidate === npmCli;
    },
  });
  assert.deepEqual(invocation, { command: execPath, args: [npmCli, '--version'] });
});

test('Windows tar uses the system bsdtar instead of a Git for Windows PATH shadow', () => {
  const systemTar = 'C:\\Windows\\System32\\tar.exe';
  const invocation = resolveCliInvocation('tar', ['-tf', 'archive.tgz'], {
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows' },
    existsSync(candidate) {
      return candidate === systemTar;
    },
  });
  assert.deepEqual(invocation, { command: systemTar, args: ['-tf', 'archive.tgz'] });
});

test('Windows pnpm action-setup and npm-global shims launch JS without shell parsing', () => {
  const execPath = 'C:\\node\\node.exe';
  const args = ['add', 'C:\\workspace with spaces\\plugin.tgz'];
  for (const [root, cliPath] of [
    ['C:\\setup-pnpm\\node_modules\\.bin', 'C:\\setup-pnpm\\node_modules\\pnpm\\bin\\pnpm.cjs'],
    ['C:\\npm-global', 'C:\\npm-global\\node_modules\\pnpm\\bin\\pnpm.cjs'],
  ]) {
    assert.deepEqual(resolveCliInvocation('pnpm', args, {
      platform: 'win32', execPath, env: { Path: root },
      existsSync: (candidate) => candidate === cliPath,
    }), { command: execPath, args: [cliPath, ...args] });
  }
  assert.deepEqual(resolveCliInvocation('pnpm', args, {
    platform: 'win32', execPath, env: {}, existsSync: () => false,
  }), { command: 'pnpm.exe', args });
});

test('resolved npm invocation can actually be spawned', () => {
  const invocation = resolveCliInvocation('npm', ['--version']);
  const result = spawnSync(invocation.command, invocation.args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);
});
