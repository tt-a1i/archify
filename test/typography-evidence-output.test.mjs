import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as generator from '../docs/evidence/workflow-typography/zoom-comparison/generate.mjs';

const script = fileURLToPath(new URL('../docs/evidence/workflow-typography/zoom-comparison/generate.mjs', import.meta.url));

function scratch(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-evidence-output-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function prepare(...args) {
  assert.equal(typeof generator.prepareEvidenceDirectory, 'function');
  return generator.prepareEvidenceDirectory(...args);
}

function seedEvidence(directory) {
  fs.mkdirSync(path.join(directory, 'release-overview'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'release-overview/before.html'), '<html>original before</html>\n');
  fs.writeFileSync(path.join(directory, 'release-overview/after.html'), '<html>original after</html>\n');
  fs.writeFileSync(path.join(directory, 'release-overview/after.png'), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  fs.writeFileSync(path.join(directory, 'measurements.json'), '{"artifact":"original"}\n');
}

function snapshot(directory) {
  return Object.fromEntries(fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => [entry.name, entry.isDirectory()
      ? snapshot(path.join(directory, entry.name)) : fs.readFileSync(path.join(directory, entry.name))]));
}

test('importing the evidence generator does not run its CLI', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e',
    `await import(${JSON.stringify(new URL('../docs/evidence/workflow-typography/zoom-comparison/generate.mjs', import.meta.url).href)});`],
  { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('default evidence directories are distinct and retain earlier evidence bytes', t => {
  const first = prepare();
  // 只清理由本次调用创建的临时目录，防止错误实现指向仓库时误删历史证据。
  assert.equal(fs.realpathSync(path.dirname(first)), fs.realpathSync(os.tmpdir()));
  assert.deepEqual(fs.readdirSync(first), []);
  t.after(() => fs.rmSync(first, { recursive: true, force: true }));
  seedEvidence(first);
  const before = snapshot(first);
  const second = prepare();
  assert.notEqual(second, first);
  assert.equal(fs.realpathSync(path.dirname(second)), fs.realpathSync(os.tmpdir()));
  assert.deepEqual(fs.readdirSync(second), []);
  t.after(() => fs.rmSync(second, { recursive: true, force: true }));
  assert.deepEqual(snapshot(first), before);
});

test('explicit evidence output accepts a new or empty directory', t => {
  const root = scratch(t);
  const fresh = path.join(root, 'new', 'evidence');
  assert.equal(prepare(fresh), fresh);
  assert.equal(fs.statSync(fresh).isDirectory(), true);
  assert.deepEqual(fs.readdirSync(fresh), []);
  const empty = path.join(root, 'empty');
  fs.mkdirSync(empty);
  assert.equal(prepare(empty), empty);
  assert.deepEqual(fs.readdirSync(empty), []);
});

test('explicit nonempty evidence output is rejected without changing HTML, PNG or measurements', t => {
  const root = scratch(t);
  seedEvidence(root);
  const before = snapshot(root);
  assert.throws(() => prepare(root), /new or empty|nonempty/i);
  assert.deepEqual(snapshot(root), before);
});

test('an ordinary file cannot be used as the evidence output directory', t => {
  const file = path.join(scratch(t), 'existing-file');
  fs.writeFileSync(file, 'retain this file\n');
  assert.throws(() => prepare(file), /directory/i);
  assert.equal(fs.readFileSync(file, 'utf8'), 'retain this file\n');
});

test('the real generator CLI rejects existing evidence before repository work or artifact writes', t => {
  const root = scratch(t);
  seedEvidence(root);
  const before = snapshot(root);
  const result = spawnSync(process.execPath, [script, '--base-repo', path.join(root, 'missing-repository'), '--out-dir', root],
    { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /new or empty|nonempty/i);
  assert.deepEqual(snapshot(root), before);
});
