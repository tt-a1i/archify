import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Intercept process creation so Windows resolution is exercised on every host.
for (const [command, childEnv, entry] of [
  ['npm', { PATH: 'C:\\child' }, 'C:\\child\\node_modules\\npm\\bin\\npm-cli.js'],
  ['npx', { PATH: 'C:\\child' }, 'C:\\child\\node_modules\\npm\\bin\\npx-cli.js'],
  ['pnpm', { PNPM_HOME: 'C:\\child-pnpm' }, 'C:\\child-pnpm\\node_modules\\pnpm\\bin\\pnpm.cjs'],
]) {
  for (const launcher of ['spawnCli', 'spawnCliSync']) {
    test(`${launcher} prefers child ${command} over an existing parent installation`, t => {
      const parentEntry = path.win32.join(path.win32.dirname(process.execPath), 'node_modules',
        command === 'pnpm' ? 'pnpm' : 'npm', 'bin', path.win32.basename(entry));
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-child-env-'));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const preload = path.join(root, 'capture.cjs');
      fs.writeFileSync(preload, `
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const fs = require('node:fs');
        fs.existsSync = p => p === ${JSON.stringify(entry)} || p === ${JSON.stringify(parentEntry)};
        const cp = require('node:child_process');
        cp.spawn = cp.spawnSync = (command, args, options) => ({command, args, options});
        require('node:module').syncBuiltinESMExports();
      `);
      const moduleUrl = new URL('../scripts/resolve-cli.mjs', import.meta.url).href;
      const result = spawnSync(process.execPath, ['--require', preload, '--input-type=module', '-e', `
        import { spawnCli, spawnCliSync } from ${JSON.stringify(moduleUrl)};
        const options = { env: ${JSON.stringify(childEnv)}, cwd: 'fixture' };
        console.log(JSON.stringify(${launcher}(${JSON.stringify(command)}, ['--version'], options)));
      `], { encoding: 'utf8', env: { ...process.env, npm_execpath: '', PATH: '', PNPM_HOME: '' } });
      assert.equal(result.status, 0, result.stderr);
      const call = JSON.parse(result.stdout);
      assert.equal(call.command, process.execPath);
      assert.deepEqual(call.args, [entry, '--version']);
      assert.deepEqual(call.options.env, childEnv);
      assert.equal(call.options.cwd, 'fixture');
    });
  }
}


for (const [childEnv, expected] of [
  [{ PATH: 'C:\\Git\\usr\\bin' }, 'C:\\Windows\\System32\\tar.exe'],
  [{ PATH: 'C:\\Git\\usr\\bin', SystemRoot: 'C:\\ChildWindows' }, 'C:\\ChildWindows\\System32\\tar.exe'],
]) {
  for (const launcher of ['spawnCli', 'spawnCliSync']) {
    test(`${launcher} retains system tar with child environment ${JSON.stringify(childEnv)}`, t => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-tar-env-'));
      t.after(() => fs.rmSync(root, { recursive: true, force: true }));
      const preload = path.join(root, 'capture.cjs');
      fs.writeFileSync(preload, `
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const fs = require('node:fs');
        const known = ${JSON.stringify(['C:\\Windows\\System32\\tar.exe', 'C:\\ChildWindows\\System32\\tar.exe', 'C:\\Git\\usr\\bin\\tar.exe'])};
        fs.existsSync = p => known.includes(p);
        const cp = require('node:child_process');
        cp.spawn = cp.spawnSync = (command, args, options) => ({ command, args, options });
        require('node:module').syncBuiltinESMExports();
      `);
      const moduleUrl = new URL('../scripts/resolve-cli.mjs', import.meta.url).href;
      const result = spawnSync(process.execPath, ['--require', preload, '--input-type=module', '-e', `
        import { ${launcher} } from ${JSON.stringify(moduleUrl)};
        console.log(JSON.stringify(${launcher}('tar', ['-tf', 'archive.tgz'], {
          env: ${JSON.stringify(childEnv)}, cwd: 'fixture',
        })));
      `], { encoding: 'utf8', env: { ...process.env, SystemRoot: 'C:\\Windows' } });
      assert.equal(result.status, 0, result.stderr);
      const call = JSON.parse(result.stdout);
      assert.equal(call.command, expected);
      assert.deepEqual(call.args, ['-tf', 'archive.tgz']);
      assert.deepEqual(call.options.env, childEnv, 'resolution must not merge parent variables into the child');
      assert.equal(call.options.cwd, 'fixture');
    });
  }
}
