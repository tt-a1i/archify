import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPaths } from '../scripts/ci-scope.mjs';

test('community documentation takes the fast path', () => {
  assert.equal(classifyPaths(['README.md', 'README_EN.md', 'README_ZH.md', 'docs/assets/community/qq.svg', 'docs/assets/community/wechat-qr.png']), 'docs');
});

test('unknown, mixed, and behavior-bearing changes retain full CI', () => {
  for (const path of ['archify/SKILL.md', 'archify/assets/template.html', 'test/readme-showcase.test.mjs', '.github/workflows/ci.yml', 'scripts/ci-scope.mjs', 'docs/guide.html', 'docs/assets/community/script.js', 'README-other.md']) {
    assert.equal(classifyPaths(['README.md', path]), 'full', path);
  }
  assert.equal(classifyPaths([]), 'full');
  // --no-renames reports the old runtime path as well as the new documentation path.
  assert.equal(classifyPaths(['archify/bin/archify.mjs', 'docs/assets/community/example.svg']), 'full');
});

// Exercise Git and output handling, not just the path allowlist.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const script = fileURLToPath(new URL('../scripts/ci-scope.mjs', import.meta.url));

test('scope CLI handles documentation, renames, main pushes, and invalid bases', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ci-scope-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
    git('init', '-q');
    git('config', 'user.name', 'CI Test');
    git('config', 'user.email', 'ci@example.invalid');
    fs.writeFileSync(path.join(root, 'README.md'), 'before');
    fs.writeFileSync(path.join(root, 'runtime.js'), 'runtime');
    git('add', '.'); git('commit', '-qm', 'base');
    const base = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(root, 'README.md'), 'after');
    git('add', '.'); git('commit', '-qm', 'docs');
    const output = path.join(root, 'output');
    const run = (event, sha = base) => {
      fs.writeFileSync(output, '');
      const result = spawnSync(process.execPath, [script], { cwd: root, env: { ...process.env, CI_EVENT_NAME: event, CI_BASE_SHA: sha, GITHUB_OUTPUT: output } });
      return { status: result.status, output: fs.readFileSync(output, 'utf8') };
    };
    assert.deepEqual(run('pull_request'), { status: 0, output: 'scope=docs\nwebsite=false\n' });
    assert.deepEqual(run('push'), { status: 0, output: 'scope=full\nwebsite=true\n' });
    assert.notEqual(run('pull_request', 'bad').status, 0);
    assert.deepEqual(run('pull_request', 'f'.repeat(40)), { status: 1, output: '' });
    git('mv', 'runtime.js', 'README_EN.md');
    git('commit', '-qm', 'rename runtime into docs');
    assert.deepEqual(run('pull_request'), { status: 0, output: 'scope=full\nwebsite=false\n' });
    fs.mkdirSync(path.join(root, 'website'));
    fs.writeFileSync(path.join(root, 'website', 'astro.config.mjs'), 'export default {};');
    git('add', 'website'); git('commit', '-qm', 'website change');
    assert.deepEqual(run('pull_request'), { status: 0, output: 'scope=full\nwebsite=true\n' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('scope workflow fetches only the exact base for a shallow PR merge checkout', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const scopeJob = workflow.split('\n  test:')[0];
  assert.match(scopeJob, /fetch-depth: 1/);
  assert.doesNotMatch(scopeJob, /fetch-depth: 0/);
  const fetchStep = scopeJob.match(/      - name: Fetch PR comparison base\n([\s\S]*?)      - uses:/)?.[1];
  assert.ok(fetchStep, 'scope job must fetch the PR base before classification');
  assert.match(fetchStep, /if: github.event_name == 'pull_request'/);
  const fetchScript = fetchStep.split('        run: |\n')[1].split('\n')
    .filter(line => line.trim()).map(line => line.slice(10)).join('\n');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ci-scope-shallow-'));
  try {
    const origin = path.join(root, 'origin');
    const checkout = path.join(root, 'checkout');
    fs.mkdirSync(origin);
    const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git(origin, 'init', '-q');
    git(origin, 'config', 'user.name', 'CI Test');
    git(origin, 'config', 'user.email', 'ci@example.invalid');
    fs.writeFileSync(path.join(origin, 'README.md'), 'before');
    fs.writeFileSync(path.join(origin, 'runtime.js'), 'before');
    fs.mkdirSync(path.join(origin, 'website'));
    fs.writeFileSync(path.join(origin, 'website', 'config.js'), 'before');
    git(origin, 'add', '.'); git(origin, 'commit', '-qm', 'common ancestor');
    git(origin, 'branch', 'pr');
    // The PR is behind the base: merge checkout incorporates base-only changes.
    fs.writeFileSync(path.join(origin, 'runtime.js'), 'base change');
    fs.writeFileSync(path.join(origin, 'website', 'config.js'), 'base change');
    git(origin, 'add', '.'); git(origin, 'commit', '-qm', 'base advance');
    const base = git(origin, 'rev-parse', 'HEAD');
    git(origin, 'tag', 'unrelated-tag');
    git(origin, 'checkout', '-q', 'pr');
    fs.writeFileSync(path.join(origin, 'README.md'), 'PR docs change');
    git(origin, 'add', '.'); git(origin, 'commit', '-qm', 'PR docs');
    git(origin, 'merge', '--no-ff', '-qm', 'PR merge checkout', base);
    git(root, 'clone', '-q', '--no-tags', '--depth=1', '--branch=pr', pathToFileURL(origin).href, checkout);
    assert.equal(git(checkout, 'rev-parse', '--is-shallow-repository'), 'true');
    assert.notEqual(spawnSync('git', ['cat-file', '-e', base], { cwd: checkout }).status, 0);
    const output = path.join(root, 'output');
    const run = (cwd, event = 'pull_request', sha = base, fetchBase = true) => {
      fs.writeFileSync(output, '');
      const env = { ...process.env, CI_EVENT_NAME: event, CI_BASE_SHA: sha, GITHUB_OUTPUT: output };
      const fetch = event === 'pull_request' && fetchBase ? spawnSync('bash', ['-e', '-c', fetchScript], { cwd, env }) : { status: 0 };
      const result = fetch.status === 0 ? spawnSync(process.execPath, [script], { cwd, env }) : fetch;
      return { status: result.status, output: fs.readFileSync(output, 'utf8') };
    };
    assert.deepEqual(run(checkout), { status: 0, output: 'scope=docs\nwebsite=false\n' });
    assert.deepEqual(run(checkout), run(origin, 'pull_request', base, false), 'shallow and full history must classify the same merge tree');
    assert.equal(git(checkout, 'rev-parse', '--is-shallow-repository'), 'true');
    assert.equal(git(checkout, 'branch', '-r'), 'origin/pr', 'fetch must not collect other branches');
    assert.equal(git(checkout, 'tag'), '', 'fetch must not collect tags');
    for (const sha of ['bad', 'f'.repeat(40)]) {
      const result = run(checkout, 'pull_request', sha);
      assert.notEqual(result.status, 0);
      assert.equal(result.output, '', 'failed base fetch must not emit a successful classification');
    }
    assert.deepEqual(run(checkout, 'push', 'bad'), { status: 0, output: 'scope=full\nwebsite=true\n' });
    git(checkout, 'config', 'user.name', 'CI Test');
    git(checkout, 'config', 'user.email', 'ci@example.invalid');
    fs.mkdirSync(path.join(checkout, 'docs', 'assets', 'community'), { recursive: true });
    fs.writeFileSync(path.join(checkout, 'docs', 'assets', 'community', 'image.svg'), '<svg/>');
    git(checkout, 'add', '.'); git(checkout, 'commit', '-qm', 'community image');
    assert.deepEqual(run(checkout), { status: 0, output: 'scope=docs\nwebsite=true\n' });
    fs.writeFileSync(path.join(checkout, 'website', 'config.js'), 'PR website change');
    git(checkout, 'add', '.'); git(checkout, 'commit', '-qm', 'website');
    assert.deepEqual(run(checkout), { status: 0, output: 'scope=full\nwebsite=true\n' });
    git(checkout, 'remote', 'set-url', 'origin', pathToFileURL(path.join(root, 'unavailable')).href);
    const unavailable = run(checkout);
    assert.notEqual(unavailable.status, 0);
    assert.equal(unavailable.output, '', 'unavailable remote must fail even with a cached base');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
