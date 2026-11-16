import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
const bootstrap = path.join(repoRoot, 'integrations', 'kalainne', 'bin', 'bootstrap.mjs');

function run(args) {
  return spawnSync(process.execPath, [bootstrap, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

function writeTargets(file, projects, archifyCheckout = repoRoot) {
  fs.writeFileSync(file, `${JSON.stringify({
    schema_version: 1,
    archifyCheckout,
    projects,
  }, null, 2)}\n`);
}

test('bootstrap installs every listed project and is idempotent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kalainne-bootstrap-ok-'));
  const projectA = path.join(root, 'site-kalainne');
  const projectB = path.join(root, 'salon-pro');
  fs.mkdirSync(projectA);
  fs.mkdirSync(projectB);
  const targets = path.join(root, 'targets.json');
  writeTargets(targets, [
    { id: 'site-kalainne', path: projectA },
    { id: 'salon-pro', path: projectB },
  ]);

  const first = run(['--targets', targets, '--json']);
  assert.equal(first.status, 0, first.stderr + first.stdout);
  const payload = JSON.parse(first.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.projects.length, 2);
  assert.equal(payload.projects.every((row) => row.status === 'ok'), true);
  assert.equal(payload.user, null);

  for (const project of [projectA, projectB]) {
    const skill = path.join(project, '.agents', 'skills', 'kalainne-archify', 'SKILL.md');
    const rootFile = path.join(project, '.agents', 'skills', 'kalainne-archify', 'archify-root.json');
    const rule = path.join(project, '.cursor', 'rules', 'kalainne-archify.mdc');
    assert.equal(fs.existsSync(skill), true, skill);
    assert.equal(fs.existsSync(rule), true, rule);
    assert.equal(JSON.parse(fs.readFileSync(rootFile, 'utf8')).resolution, 'recorded-root');
  }

  const second = run(['--targets', targets, '--json']);
  assert.equal(second.status, 0, second.stderr + second.stdout);
  assert.equal(JSON.parse(second.stdout).ok, true);
});

test('bootstrap with --with-user writes the desktop skill roots', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kalainne-bootstrap-user-'));
  const home = path.join(root, 'home');
  const project = path.join(root, 'project');
  fs.mkdirSync(home);
  fs.mkdirSync(project);
  const targets = path.join(root, 'targets.json');
  writeTargets(targets, [{ id: 'project', path: project }]);

  const result = run(['--targets', targets, '--with-user', '--home', home, '--json']);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.user.status, 'ok');
  assert.equal(fs.existsSync(path.join(home, '.agents', 'skills', 'kalainne-archify', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(home, '.cursor', 'skills', 'kalainne-archify', 'SKILL.md')), true);
});

test('bootstrap fails when a listed project path is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kalainne-bootstrap-missing-'));
  const project = path.join(root, 'exists');
  fs.mkdirSync(project);
  const targets = path.join(root, 'targets.json');
  writeTargets(targets, [
    { id: 'exists', path: project },
    { id: 'missing', path: path.join(root, 'does-not-exist') },
  ]);

  const result = run(['--targets', targets, '--json']);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  const missing = payload.projects.find((row) => row.id === 'missing');
  assert.equal(missing.status, 'failed');
});

test('bootstrap requires --targets and rejects a wrong archifyCheckout', () => {
  const missing = run(['--json']);
  assert.equal(missing.status, 2);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kalainne-bootstrap-checkout-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  const targets = path.join(root, 'targets.json');
  writeTargets(targets, [{ id: 'project', path: project }], path.join(root, 'other-archify'));
  const wrong = run(['--targets', targets, '--json']);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stdout + wrong.stderr, /archifyCheckout/);
});
