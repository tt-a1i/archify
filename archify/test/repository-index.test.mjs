import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildRepositoryIndex } from '../modules/repository-index/index.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-repository-index-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, contents) {
  const target = path.join(root, ...relative.split('/'));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function fixture(t) {
  const root = workspace(t);
  write(root, 'package.json', '{"name":"sample-runtime"}\n');
  write(root, 'src/server.js', 'server.listen(3000);\n');
  write(root, 'src/payments/service.js', 'export function charge() { return "private-source-marker"; }\n');
  write(root, 'src/workers/main.py', 'def run_worker():\n    return True\n');
  write(root, 'tests/server.test.js', 'test("server", () => {});\n');
  write(root, 'docs/architecture.md', '# Architecture\n');
  write(root, 'deploy/docker-compose.yml', 'services:\n  api:\n    build: .\n');
  write(root, 'dist/generated.js', 'server.listen(9000);\n');
  write(root, 'generated/client.ts', 'export const generated = true;\n');
  write(root, 'node_modules/pkg/index.js', 'module.exports = {};\n');
  write(root, 'venv-audio/Scripts/Activate.ps1', 'activate\n');
  write(root, 'logs/runtime/server.js', 'server.listen(4000);\n');
  write(root, '_archive/old/main.py', 'print("old runtime")\n');
  write(root, 'debug.log', 'irrelevant log\n');
  write(root, 'package-lock.json', '{"lockfileVersion":3}\n');
  write(root, '.env', 'PRIVATE_TOKEN=secret\n');
  write(root, '.env.example', 'PRIVATE_TOKEN=\n');
  write(root, 'assets/blob.dat', Buffer.from([0, 1, 2, 3]));
  return root;
}

test('repository inventory filters only excluded paths and returns no source bodies or scores', (t) => {
  const root = fixture(t);
  const result = buildRepositoryIndex(root, { batchSize: 100 });
  const paths = result.files.map((file) => file.path);

  assert.equal(result.ok, true);
  assert.equal(result.policy.scoring, false);
  assert.equal(result.policy.ast, false);
  assert.equal(result.policy.sourceBodiesIncluded, false);
  assert.deepEqual(paths, [
    'package.json',
    'deploy/docker-compose.yml',
    'docs/architecture.md',
    'src/server.js',
    'src/payments/service.js',
    'src/workers/main.py',
    'tests/server.test.js',
    '.env.example',
  ]);
  assert.equal(JSON.stringify(result).includes('private-source-marker'), false);
  assert.equal(JSON.stringify(result).includes('"score"'), false);
  assert.equal(paths.some((file) => file.startsWith('dist/')), false);
  assert.equal(paths.some((file) => file.startsWith('generated/')), false);
  assert.equal(paths.some((file) => file.startsWith('node_modules/')), false);
  assert.equal(paths.some((file) => file.startsWith('_archive/')), false);
  assert.equal(paths.includes('debug.log'), false);
  assert.equal(paths.includes('package-lock.json'), false);
  assert.equal(paths.includes('.env'), false);
  assert.ok(paths.includes('.env.example'));
  assert.equal(paths.includes('assets/blob.dat'), false);
  assert.ok(paths.includes('tests/server.test.js'));
  assert.ok(paths.includes('docs/architecture.md'));
});

test('repository inventory uses round-robin batches and reports both coverage levels', (t) => {
  const root = fixture(t);
  const batches = [1, 2, 3].map((batch) => buildRepositoryIndex(root, { batchSize: 3, batch }));

  assert.equal(batches[0].directoryModules.total, 7);
  assert.deepEqual(batches[0].files.map((file) => file.module), ['.', 'deploy', 'docs']);
  assert.deepEqual(batches[1].files.map((file) => file.module), ['src', 'src/payments', 'src/workers']);
  assert.deepEqual(batches[2].files.map((file) => file.module), ['tests', '.']);
  assert.equal(batches[0].coverage.directoryModules.covered, 3);
  assert.equal(batches[0].coverage.directoryModules.complete, false);
  assert.equal(batches[1].coverage.directoryModules.covered, 6);
  assert.equal(batches[2].coverage.directoryModules.covered, 7);
  assert.equal(batches[2].coverage.directoryModules.complete, true);
  assert.equal(batches[2].coverage.fileInventory.complete, true);
  assert.equal(batches[0].coverage.nextBatch, 2);
  assert.deepEqual(batches[0].coverage.nextArguments.slice(-4), ['--batch-size', '3', '--batch', '2', '--json'].slice(-4));
});

test('repository inventory honors Git ignore rules', (t) => {
  const root = workspace(t);
  const initialized = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8' });
  assert.equal(initialized.status, 0, initialized.stderr);
  write(root, '.gitignore', 'ignored/\n');
  write(root, 'src/main.go', 'package main\n');
  write(root, 'ignored/server.go', 'package ignored\n');

  const result = buildRepositoryIndex(root, { batchSize: 100 });

  assert.equal(result.summary.discovery, 'git');
  assert.ok(result.entrypoints.some((entry) => entry.path === 'src/main.go'));
  assert.equal(result.files.some((entry) => entry.path === 'ignored/server.go'), false);
});

test('inspect-repo reuses one Git snapshot across batches and rejects it after the repository changes', (t) => {
  const root = fixture(t);
  for (const args of [
    ['init', '--quiet'],
    ['config', 'user.email', 'snapshot@example.invalid'],
    ['config', 'user.name', 'Snapshot Test'],
    ['add', '.'],
    ['commit', '--quiet', '-m', 'fixture'],
  ]) {
    const git = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(git.status, 0, git.stderr);
  }
  fs.appendFileSync(path.join(root, 'src/server.js'), '// already dirty before snapshot\n');

  const first = spawnSync(process.execPath, [cli, 'inspect-repo', root, '--batch-size', '3', '--json'], {
    cwd: skillRoot, encoding: 'utf8',
  });
  assert.equal(first.status, 0, first.stderr);
  const page1 = JSON.parse(first.stdout);
  assert.equal(page1.session.reusable, true);
  assert.equal(page1.session.reused, false);
  assert.ok(page1.coverage.nextArguments.includes('--snapshot'));
  t.after(() => fs.rmSync(path.dirname(page1.session.snapshot), { recursive: true, force: true }));

  const second = spawnSync(process.execPath, [cli, 'inspect-repo', ...page1.coverage.nextArguments], {
    cwd: skillRoot, encoding: 'utf8',
  });
  assert.equal(second.status, 0, second.stderr);
  const page2 = JSON.parse(second.stdout);
  assert.equal(page2.session.reused, true);
  assert.equal(page2.coverage.batch, 2);

  fs.appendFileSync(path.join(root, 'src/server.js'), '// changed again after snapshot\n');
  const stale = spawnSync(process.execPath, [cli, 'inspect-repo', ...page1.coverage.nextArguments], {
    cwd: skillRoot, encoding: 'utf8',
  });
  assert.equal(stale.status, 2);
  assert.match(stale.stderr, /Repository changed after this inspection snapshot was created/);
});

test('inspect-repo CLI returns a requested deterministic batch', (t) => {
  const root = fixture(t);
  const result = spawnSync(process.execPath, [
    cli, 'inspect-repo', root, '--batch-size', '3', '--batch', '2', '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.command, 'inspect-repo');
  assert.equal(parsed.policy.scoring, false);
  assert.equal(parsed.coverage.batch, 2);
  assert.deepEqual(parsed.files.map((file) => file.module), ['src', 'src/payments', 'src/workers']);
});

test('inspect-repo rejects removed scoring options and invalid batch sizes without a stack', (t) => {
  const root = fixture(t);
  const removed = spawnSync(process.execPath, [cli, 'inspect-repo', root, '--query', 'payments'], {
    cwd: skillRoot, encoding: 'utf8',
  });
  const invalid = spawnSync(process.execPath, [cli, 'inspect-repo', root, '--batch-size', '0'], {
    cwd: skillRoot, encoding: 'utf8',
  });

  assert.equal(removed.status, 2);
  assert.match(removed.stderr, /Unknown inspect-repo option "--query"/);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /batchSize must be an integer from 1 to 100/);
  assert.doesNotMatch(invalid.stderr, /\n\s+at /);
});
