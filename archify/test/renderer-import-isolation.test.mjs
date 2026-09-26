import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const compilerUrl = new URL('../renderers/workflow/workflow-compiler.mjs', import.meta.url).href;
const skillRoot = fileURLToPath(new URL('../', import.meta.url));

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-import-isolation-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function run(args, cwd, format) {
  const env = { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: format === 'json' ? 'json' : '' };
  delete env.ARCHIFY_QUALITY_PROFILE;
  return spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', timeout: 15000 });
}

for (const format of ['human', 'json']) {
  test(`workflow compiler import preserves host state outside the repository (${format})`, t => {
    const cwd = workspace(t);
    const script = `
      import assert from 'node:assert/strict';
      const events = ['uncaughtException', 'unhandledRejection'];
      for (const event of events) process.on(event, () => {});
      const listeners = events.map(event => process.rawListeners(event));
      const argv = [...process.argv];
      const env = { ...process.env };
      process.exitCode = 23;
      await import(process.argv[1]);
      for (const [index, event] of events.entries()) {
        assert.deepEqual(process.rawListeners(event), listeners[index], event);
      }
      assert.deepEqual(process.argv, argv);
      assert.deepEqual({ ...process.env }, env);
      assert.equal(process.exitCode, 23);
      process.stdout.write('import complete');
    `;
    const child = run(['--input-type=module', '--eval', script, compilerUrl], cwd, format);
    assert.equal(child.status, 23, child.stderr || child.error?.message);
    assert.equal(child.stdout, 'import complete');
    assert.equal(child.stderr, '');
    assert.deepEqual(fs.readdirSync(cwd), []);
  });

  test(`failed workflow compilation leaves a later exception to the host (${format})`, t => {
    const cwd = workspace(t);
    const script = `
      import assert from 'node:assert/strict';
      process.once('uncaughtException', error => {
        process.stdout.write(error.message);
        process.exitCode = 23;
      });
      const { compileWorkflow } = await import(process.argv[1]);
      const result = compileWorkflow({ workflow: {} });
      assert.equal(result.ok, false);
      assert.ok(result.diagnostics.length > 0);
      setImmediate(() => { throw new Error('host-owned failure'); });
    `;
    const child = run(['--input-type=module', '--eval', script, compilerUrl], cwd, format);
    assert.equal(child.status, 23, child.stderr || child.error?.message);
    assert.equal(child.stdout, 'host-owned failure');
    assert.equal(child.stderr, '');
    assert.deepEqual(fs.readdirSync(cwd), []);
  });
}

// All five entrypoints use the shared loader. Moving its diagnostic boundary
// must still classify failures that happen before a diagram can be compiled.
for (const type of ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']) {
  test(`${type} CLI installs JSON diagnostics before reading and validating input`, t => {
    const cwd = workspace(t);
    const output = path.join(cwd, 'diagram.html');
    fs.writeFileSync(output, 'previous artifact');
    const renderer = path.join(skillRoot, 'renderers', type, `render-${type}.mjs`);
    for (const [name, contents, code] of [
      ['missing', null, 'input/read'],
      ['malformed', '{"broken":', 'input/json-parse'],
      ['schema', '{}', 'schema/required'],
    ]) {
      const input = path.join(cwd, `${name}.json`);
      if (contents !== null) fs.writeFileSync(input, contents);
      const child = run([renderer, input, output], cwd, 'json');
      assert.equal(child.status, 1, child.stderr || child.error?.message);
      assert.equal(child.stdout, '');
      const receipt = JSON.parse(child.stderr);
      assert.equal(receipt.ok, false);
      assert.equal(receipt.source, 'renderer');
      assert.ok(receipt.diagnostics.length > 0);
      assert.ok(receipt.diagnostics.every(entry => entry.code === code), child.stderr);
      assert.equal(fs.readFileSync(output, 'utf8'), 'previous artifact');
    }
  });
}
