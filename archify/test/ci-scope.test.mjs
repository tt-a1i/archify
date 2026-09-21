import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPaths } from '../../scripts/ci-scope.mjs';

test('community documentation takes the fast path', () => {
  assert.equal(classifyPaths(['README.md', 'README_EN.md', 'README_ZH.md', 'docs/assets/community/qq.svg', 'docs/assets/community/wechat-qr.png']), 'docs');
});

test('unknown, mixed, and behavior-bearing changes retain full CI', () => {
  for (const path of ['archify/SKILL.md', 'archify/assets/template.html', 'archify/test/readme-showcase.test.mjs', '.github/workflows/ci.yml', 'scripts/ci-scope.mjs', 'docs/guide.html', 'docs/assets/community/script.js', 'README-other.md']) {
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
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../../scripts/ci-scope.mjs', import.meta.url));

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
    assert.equal(run('pull_request', 'f'.repeat(40)).output, '');
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
