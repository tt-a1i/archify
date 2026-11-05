import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { bipartiteArchitectureSpec } from './helpers/dense-fixture.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repo, 'archify/bin/archify.mjs');
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pause = () => new Promise(resolve => setTimeout(resolve, 10));
function groupMembers(group) {
  return spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,command='], { encoding: 'utf8' }).stdout
    .split('\n').map(line => line.trim().split(/\s+/)).filter(row => Number(row[2]) === group)
    .map(row => ({ pid: Number(row[0]), command: row.slice(3).join(' ') }));
}
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cancel-'));
  fs.mkdirSync(path.join(root, 'tmp'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, TMPDIR: path.join(root, 'tmp'), ARCHIFY_UPDATE_CHECK_DISABLED: '1' };
  for (const key of ['NODE_OPTIONS', 'ARCHIFY_CHECK_MAX_BUFFER', 'ARCHIFY_CHECK_MAX_CROSSING_PAIR_CHECKS', 'ARCHIFY_CHECK_MAX_CROSSING_SEGMENT_PAIR_CHECKS']) delete env[key];
  return { root, env };
}
function run(args, env) {
  return spawnSync(process.execPath, [cli, ...args], { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 20000 });
}
function start(t, args, env) {
  const child = spawn(process.execPath, args, { env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  });
  const finished = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, finished };
}
async function waitFor(read, description) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = read();
    if (value) return value;
    await pause();
  }
  throw new Error(`Did not observe ${description}`);
}

for (const [command, stage, signal, target] of [
  ['validate', 'render', 'SIGINT', 'group'],
  ['deliver', 'render', 'SIGINT', 'group'],
  ['deliver', 'check', 'SIGTERM', 'group'],
  ['finalize', 'check', 'SIGINT', 'group'],
  ['finalize', 'render', 'SIGINT', 'parent'],
  ['finalize', 'check', 'SIGINT', 'worker'],
  ['deliver', 'check', 'SIGINT', 'worker'],
  ['check', 'check', 'SIGINT', 'parent'],
  ['deliver', 'check', 'SIGKILL', 'group'],
]) {
  test(`cancellation: ${command} ${stage} ${signal} to ${target} preserves output and retry semantics`, { skip: process.platform === 'win32', timeout: 30000 }, async t => {
    const { root, env } = workspace(t);
    const input = path.join(root, 'dense.json');
    const output = path.join(root, 'published.html');
    fs.writeFileSync(input, JSON.stringify(bipartiteArchitectureSpec(stage === 'render' ? 30 : 11)));
    const control = command === 'check' ? input : path.join(repo, 'archify/examples/web-app.architecture.json');
    const seed = run(['deliver', 'architecture', control, output, '--json'], env);
    assert.equal(seed.status, 0, seed.stderr || seed.stdout);
    const original = sha(output);
    const args = command === 'check' ? ['check', output, '--require-provenance'] : [command, 'architecture', input,
      ...(['deliver', 'finalize'].includes(command) ? [output] : []), '--quality', 'standard', '--json'];
    const { child, finished } = start(t, [cli, ...args], env);
    const workerName = stage === 'render' ? 'render-architecture.mjs' : 'check-render-output.mjs';
    const worker = await waitFor(() => groupMembers(child.pid).find(row => row.command.includes(workerName)), workerName);
    if (target === 'group') process.kill(-child.pid, signal);
    else process.kill(target === 'worker' ? worker.pid : child.pid, signal);
    const result = await finished;
    assert.equal(sha(output), original, 'interruption replaced the previous artifact');
    assert.deepEqual(groupMembers(child.pid), [], 'an interrupted worker outlived the CLI');
    if (signal === 'SIGKILL') {
      assert.equal(result.signal, 'SIGKILL');
      const retry = run(['deliver', 'architecture', control, output, '--json'], env);
      assert.equal(retry.status, 1);
      assert.equal(JSON.parse(retry.stdout).diagnostics[0].code, 'delivery/lock-stale');
      return;
    }
    assert.equal(result.code, signal === 'SIGTERM' ? 143 : 130, result.stderr);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.ok, false);
    const diagnostic = receipt.diagnostics.find(item => item.code === 'cli/interrupted');
    assert.ok(diagnostic, result.stdout);
    assert.equal(diagnostic.subject.stage, stage);
    assert.equal(diagnostic.evidence.signal, signal);
    assert.equal(diagnostic.evidence.origin, target === 'worker' ? 'child' : 'command');
    assert.equal(diagnostic.evidence.inspectionComplete, false);
    assert.ok(diagnostic.supportedFixes.length);
    if (command === 'finalize' && ((stage === 'render' && target === 'parent') || (stage === 'check' && target === 'worker'))) {
      assert.equal(receipt.failedStage, 'deliver');
      assert.equal('nextAction' in receipt, false);
    }
    assert.equal(fs.existsSync(path.join(root, '.archify-delivery-lock.json')), false);
    assert.equal(fs.existsSync(path.join(root, 'published.delivery-lock.json')), false);
    assert.deepEqual(fs.readdirSync(path.join(root, 'tmp')), []);
    assert.equal(fs.readdirSync(root).some(name => name.startsWith('.archify-delivery-')), false);
    const strict = run(['check', output, '--require-provenance'], env);
    assert.equal(strict.status, ['deliver', 'finalize'].includes(command) ? 1 : 0);
    const retry = run(['deliver', 'architecture', control, output, '--json'], env);
    assert.equal(retry.status, 0, retry.stderr || retry.stdout);
    assert.equal(sha(output), original);
    assert.equal(run(['check', output, '--require-provenance'], env).status, 0);
  });
}

test('cancellation: a coordinator waits for a stubborn worker to stop and its child to finish cleanup', { skip: process.platform === 'win32', timeout: 15000 }, async t => {
  const { root, env } = workspace(t);
  const ready = path.join(root, 'ready');
  const worker = path.join(root, 'worker.mjs');
  const inner = path.join(root, 'inner.mjs');
  const parent = path.join(root, 'parent.mjs');
  const cleaned = path.join(root, 'cleaned');
  const cancellationModule = JSON.stringify(pathToFileURL(path.join(repo, 'archify/bin/command-cancellation.mjs')).href);
  fs.writeFileSync(worker, `import fs from 'node:fs';
process.on('SIGINT', () => {}); process.on('SIGTERM', () => {});
fs.writeFileSync(${JSON.stringify(ready)}, String(process.pid)); setInterval(() => {}, 1000);`);
  fs.writeFileSync(inner, `import fs from 'node:fs';
import {createCommandCancellation} from ${cancellationModule};
const cancellation = createCommandCancellation();
try {
  const result = await cancellation.run('check', [${JSON.stringify(worker)}]);
  fs.writeFileSync(${JSON.stringify(cleaned)}, 'child stopped; cleanup finished');
  console.log(JSON.stringify(result)); process.exitCode = result.status;
}
finally { cancellation.dispose(); }`);
  fs.writeFileSync(parent, `import {createCommandCancellation} from ${cancellationModule};
const cancellation = createCommandCancellation();
try { console.log(JSON.stringify(await cancellation.run('deliver', [${JSON.stringify(inner)}], {coordinator: true}))); }
finally { cancellation.dispose(); }`);
  const { child, finished } = start(t, [parent], env);
  await waitFor(() => fs.existsSync(ready), 'stubborn worker readiness');
  child.kill('SIGINT');
  await pause();
  child.kill('SIGINT');
  const result = await finished;
  assert.equal(result.code, 0, result.stderr);
  const stopped = JSON.parse(result.stdout);
  assert.equal(stopped.status, 130);
  assert.equal(stopped.interruption.forced, false, 'coordinator killed its child before cleanup');
  const workerResult = JSON.parse(stopped.stdout);
  assert.equal(workerResult.signal, 'SIGKILL');
  assert.equal(workerResult.interruption.forced, true);
  assert.equal(fs.readFileSync(cleaned, 'utf8'), 'child stopped; cleanup finished');
  assert.deepEqual(groupMembers(child.pid), []);
});

test('cancellation: layout diagnostics cannot hide an interrupt at renderer completion', { skip: process.platform === 'win32', timeout: 15000 }, t => {
  const { root, env } = workspace(t);
  const input = path.join(root, 'overlap.json');
  const diagram = JSON.parse(fs.readFileSync(path.join(repo, 'archify/examples/web-app.architecture.json')));
  diagram.components[1].pos = diagram.components[0].pos;
  fs.writeFileSync(input, JSON.stringify(diagram));
  const args = ['validate', 'architecture', input, '--layout-json', '--json'];
  const control = run(args, env);
  assert.equal(control.status, 1, control.stderr);
  const rejected = JSON.parse(control.stdout);
  assert.equal(rejected.ok, false);
  assert.ok(rejected.contract && rejected.diagnostics.length, control.stdout);

  // Use the real renderer result, but deliver SIGINT before its callback is
  // consumed so this narrow completion race is deterministic.
  const wrapper = path.join(root, 'interrupt-layout.mjs');
  fs.writeFileSync(wrapper, `import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
const original = childProcess.execFile;
childProcess.execFile = (file, args, options, callback) => original(file, args, options, (error, stdout, stderr) => {
  if (!args.includes('--layout-json')) return callback(error, stdout, stderr);
  const deadline = setTimeout(() => { throw new Error('SIGINT was not delivered'); }, 2000);
  process.once('SIGINT', () => {
    clearTimeout(deadline);
    setImmediate(() => callback(error, stdout, stderr));
  });
  process.kill(process.pid, 'SIGINT');
});
syncBuiltinESMExports();
process.argv = [process.execPath, ${JSON.stringify(cli)}, ...${JSON.stringify(args)}];
await import(${JSON.stringify(pathToFileURL(cli).href)});`);
  const interrupted = spawnSync(process.execPath, [wrapper], { env, encoding: 'utf8', timeout: 10000 });
  assert.equal(interrupted.status, 130, interrupted.stderr);
  const receipt = JSON.parse(interrupted.stdout);
  assert.equal(receipt.ok, false);
  const diagnostic = receipt.diagnostics.find(entry => entry.code === 'cli/interrupted');
  assert.ok(diagnostic, interrupted.stdout);
  assert.equal(diagnostic.subject.stage, 'render');
  assert.equal(diagnostic.evidence.signal, 'SIGINT');
  assert.equal(diagnostic.evidence.inspectionComplete, false);
});
