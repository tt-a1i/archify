import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { startPreview } from '../bin/preview.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = path.join(root, 'bin/archify.mjs');
const workflow = path.join(root, 'examples/agent-tool-call.workflow.json');
const architecture = path.join(root, 'examples/web-app.architecture.json');
const base = path.join(root, 'examples/checkout-platform.base.architecture.json');
const head = path.join(root, 'examples/checkout-platform.head.architecture.json');
const marker = 'MARKER=do-not-destroy';
function workspace(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cli-types-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
}

for (const command of ['render', 'deliver', 'compare']) {
  test(`${command} rejects a non-HTML target without replacing existing bytes`, t => {
    const dir = workspace(t);
    const cwd = path.join(dir, 'working');
    fs.mkdirSync(cwd);
    const output = path.join(dir, 'marker.env');
    fs.writeFileSync(output, marker);
    const args = command === 'compare' ? ['compare', 'architecture', base, head] : [command, 'workflow', workflow];
    const result = run([...args, '../marker.env', ...(command === 'render' ? [] : ['--json'])], cwd);
    assert.equal(result.status, 1, result.stderr);
    if (command === 'render') assert.match(result.stderr, /output\/cli-extension/);
    else assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'output/cli-extension');
    assert.equal(fs.readFileSync(output, 'utf8'), marker);
    assert.deepEqual(fs.readdirSync(cwd), []);
  });
}

test('preview rejects a non-HTML target before publishing or starting a server', async t => {
  const cwd = workspace(t);
  const output = path.join(cwd, 'marker.env');
  fs.writeFileSync(output, marker);
  let session;
  try {
    await assert.rejects(async () => {
      session = await startPreview({ type: 'workflow', input: workflow, output, cwd, open: false });
    }, error => error.archifyDiagnostics?.[0]?.code === 'output/cli-extension');
  } finally {
    if (session) { session.stop(); await session.closed; }
  }
  assert.equal(fs.readFileSync(output, 'utf8'), marker);
});

test('render and deliver reject HTML symlinks resolving to non-HTML files', t => {
  const cwd = workspace(t);
  const target = path.join(cwd, 'marker.env');
  const output = path.join(cwd, 'diagram.html');
  fs.writeFileSync(target, marker);
  try { fs.symlinkSync(target, output, 'file'); }
  catch (error) {
    if (error.code === 'EPERM') { t.skip('symlink creation requires permission'); return; }
    throw error;
  }
  for (const command of ['render', 'deliver']) {
    const result = run([command, 'workflow', workflow, output, ...(command === 'deliver' ? ['--json'] : [])], cwd);
    assert.equal(result.status, 1, result.stderr);
    if (command === 'deliver') assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'output/cli-resolved-extension');
    else assert.match(result.stderr, /output\/cli-resolved-extension/);
    assert.equal(fs.readFileSync(target, 'utf8'), marker);
    assert.equal(fs.lstatSync(output).isSymbolicLink(), true);
  }
});

test('compare rejects a non-JSON receipt before writing either output', t => {
  const cwd = workspace(t);
  const output = path.join(cwd, 'delta.html');
  const receipt = path.join(cwd, 'marker.env');
  fs.writeFileSync(output, marker);
  fs.writeFileSync(receipt, marker);
  const result = run(['compare', 'architecture', base, head, output, '--receipt', receipt, '--json'], cwd);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'output/cli-extension');
  assert.equal(fs.readFileSync(output, 'utf8'), marker);
  assert.equal(fs.readFileSync(receipt, 'utf8'), marker);
});

for (const aliasKind of ['same path', 'symlink alias']) {
  test(`compare reports target alias before CLI extension for ${aliasKind}`, t => {
    const cwd = workspace(t);
    const output = path.join(cwd, 'same.json');
    const receipt = aliasKind === 'same path'
      ? output
      : path.join(cwd, 'receipt.json');
    fs.writeFileSync(output, marker);
    if (aliasKind === 'symlink alias') {
      try { fs.symlinkSync(output, receipt, 'file'); }
      catch (error) {
        if (error.code === 'EPERM') { t.skip('symlink creation requires permission'); return; }
        throw error;
      }
    }

    const result = run([
      'compare', 'architecture', base, head, output,
      '--receipt', receipt, '--json',
    ], cwd);

    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'output/target-alias');
    assert.equal(fs.readFileSync(output, 'utf8'), marker);
    if (aliasKind === 'symlink alias') assert.equal(fs.readlinkSync(receipt), output);
  });
}

test('compare keeps CLI extension precedence for distinct invalid outputs', t => {
  const cwd = workspace(t);
  const output = path.join(cwd, 'artifact.json');
  const receipt = path.join(cwd, 'receipt.txt');
  fs.writeFileSync(output, marker);
  fs.writeFileSync(receipt, marker);

  const result = run([
    'compare', 'architecture', base, head, output,
    '--receipt', receipt, '--json',
  ], cwd);

  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'output/cli-extension');
  assert.equal(fs.readFileSync(output, 'utf8'), marker);
  assert.equal(fs.readFileSync(receipt, 'utf8'), marker);
});

test('compare reports target alias before CLI extension for a derived receipt symlink', t => {
  const cwd = workspace(t);
  const output = path.join(cwd, 'artifact.json');
  const receipt = path.join(cwd, 'artifact.receipt.json');
  fs.writeFileSync(output, marker);
  try { fs.symlinkSync(output, receipt, 'file'); }
  catch (error) {
    if (error.code === 'EPERM') { t.skip('symlink creation requires permission'); return; }
    throw error;
  }

  const result = run(['compare', 'architecture', base, head, output, '--json'], cwd);

  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'output/target-alias');
  assert.equal(fs.readFileSync(output, 'utf8'), marker);
  assert.equal(fs.readlinkSync(receipt), output);
});

test('absolute HTML and JSON outputs outside cwd remain supported', t => {
  const dir = workspace(t);
  const cwd = path.join(dir, 'working');
  fs.mkdirSync(cwd);
  const output = path.join(dir, 'diagram.HTML');
  const delivered = run(['deliver', 'workflow', workflow, output, '--json'], cwd);
  assert.equal(delivered.status, 0, delivered.stderr);
  assert.equal(JSON.parse(delivered.stdout).ok, true);
  assert.match(fs.readFileSync(output, 'utf8'), /<!DOCTYPE html>/i);
  const receipt = path.join(dir, 'delta.JSON');
  const compared = run(['compare', 'architecture', base, head, output, '--receipt', receipt, '--json'], cwd);
  assert.equal(compared.status, 0, compared.stderr || compared.stdout);
  assert.equal(JSON.parse(fs.readFileSync(receipt, 'utf8')).ok, true);
});

test('validate, inspect and layout JSON retain their internal no-output behavior', t => {
  const cwd = workspace(t);
  for (const args of [
    ['validate', 'architecture', architecture, '--json'],
    ['inspect', 'architecture', architecture],
    ['validate', 'workflow', workflow, '--layout-json'],
  ]) {
    const result = run(args, cwd);
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotThrow(() => JSON.parse(result.stdout));
    assert.deepEqual(fs.readdirSync(cwd), []);
  }
});

test('compare rejects a JSON receipt symlink to a non-JSON target', t => {
  const cwd = workspace(t);
  const target = path.join(cwd, 'marker.env');
  const receipt = path.join(cwd, 'receipt.json');
  const output = path.join(cwd, 'delta.html');
  fs.writeFileSync(target, marker);
  try { fs.symlinkSync(target, receipt, 'file'); }
  catch (error) {
    if (error.code === 'EPERM') { t.skip('symlink creation requires permission'); return; }
    throw error;
  }
  const result = run(['compare', 'architecture', base, head, output, '--receipt', receipt, '--json'], cwd);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'output/cli-resolved-extension');
  assert.equal(fs.readFileSync(target, 'utf8'), marker);
  assert.equal(fs.existsSync(output), false);
});
