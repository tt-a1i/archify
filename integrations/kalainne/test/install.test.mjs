import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const installer = path.join(repoRoot, 'integrations', 'kalainne', 'bin', 'install.mjs');

function run(args) {
  return spawnSync(process.execPath, [installer, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

test('project install records this checkout for a repo without the CLI', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'kalainne-project-'));
  const result = run(['install', '--scope', 'project', '--target', target, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.record.resolution, 'recorded-root');
  assert.equal(payload.record.archifyRoot, repoRoot);
  const skill = path.join(target, '.agents', 'skills', 'kalainne-archify', 'SKILL.md');
  const rule = path.join(target, '.cursor', 'rules', 'kalainne-archify.mdc');
  assert.match(fs.readFileSync(skill, 'utf8'), /^name: kalainne-archify$/m);
  assert.match(fs.readFileSync(rule, 'utf8'), /alwaysApply: true/);
  assert.equal(fs.existsSync(path.join(target, '.cursor', 'skills')), false);
});

test('project install inside this repo resolves to the workspace', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'kalainne-workspace-'));
  fs.mkdirSync(path.join(target, 'archify', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(target, 'archify', 'bin', 'archify.mjs'), '');
  const result = run(['install', '--scope', 'project', '--target', target, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const record = readJson(path.join(target, '.agents', 'skills', 'kalainne-archify', 'archify-root.json'));
  assert.equal(record.resolution, 'workspace');
  assert.equal(record.archifyRoot, undefined);
});

test('user install writes the two Cursor skill roots with the same bytes', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kalainne-home-'));
  const first = run(['install', '--scope', 'user', '--home', home, '--json']);
  const second = run(['install', '--scope', 'user', '--home', home, '--json']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  const agents = path.join(home, '.agents', 'skills', 'kalainne-archify');
  const cursor = path.join(home, '.cursor', 'skills', 'kalainne-archify');
  assert.equal(fs.readFileSync(path.join(agents, 'SKILL.md'), 'utf8'), fs.readFileSync(path.join(cursor, 'SKILL.md'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(agents, 'archify-root.json'), 'utf8'), fs.readFileSync(path.join(cursor, 'archify-root.json'), 'utf8'));
  assert.equal(readJson(path.join(agents, 'archify-root.json')).resolution, 'recorded-root');
});

test('doctor uses the workspace CLI and a user install for another project', () => {
  const workspace = run(['doctor', '--target', repoRoot, '--json']);
  assert.equal(workspace.status, 0, workspace.stderr);
  const local = JSON.parse(workspace.stdout);
  assert.equal(local.ok, true);
  assert.equal(local.resolution, 'workspace');
  assert.equal(local.bin, path.join(repoRoot, 'archify', 'bin', 'archify.mjs'));

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kalainne-doctor-home-'));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'kalainne-doctor-target-'));
  assert.equal(run(['install', '--scope', 'user', '--home', home]).status, 0);
  const remote = run(['doctor', '--target', target, '--home', home, '--json']);
  assert.equal(remote.status, 0, remote.stderr);
  assert.equal(JSON.parse(remote.stdout).resolution, 'recorded-root');
});

test('missing target and unknown argument fail before writing', () => {
  const missing = run(['install', '--scope', 'project', '--target', path.join(os.tmpdir(), 'kalainne-missing-dir')]);
  assert.equal(missing.status, 2);
  const unknown = run(['doctor', '--target', repoRoot, '--nope']);
  assert.equal(unknown.status, 2);
});
