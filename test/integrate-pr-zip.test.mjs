import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const helper = fileURLToPath(new URL('../scripts/integrate-pr-zip.mjs', import.meta.url));
function fixture(t, { sourceConflict = false, buildFailure = false, corruptSource = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-zip-integration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const repo = path.join(dir, 'repo');
  const work = path.join(dir, 'isolated');
  fs.mkdirSync(repo);
  const git = (args, cwd = repo) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr || r.stdout);
    return r.stdout.trim();
  };
  git(['init', '-b', 'base']);
  git(['config', 'user.name', 'Integration fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  git(['config', 'commit.gpgsign', 'false']);
  fs.mkdirSync(path.join(repo, 'scripts'));
  fs.writeFileSync(path.join(repo, 'scripts/build-zip.sh'), buildFailure ? '#!/bin/bash\necho fixture-build-failure >&2\nexit 7\n' : `#!/bin/bash\nset -eu\n${corruptSource ? 'echo lost > head.txt\n' : ''}cat head.txt base.txt > archify.zip\n`);
  fs.writeFileSync(path.join(repo, 'source.txt'), 'original\n');
  fs.writeFileSync(path.join(repo, 'archify.zip'), Buffer.from([0, 1, 2, 3]));
  git(['add', '.']);
  git(['commit', '-m', 'common ancestor']);
  git(['branch', 'candidate']);
  fs.writeFileSync(path.join(repo, 'base.txt'), 'base contribution\n');
  fs.writeFileSync(path.join(repo, 'archify.zip'), Buffer.from([0, 2, 3, 4]));
  if (sourceConflict) fs.writeFileSync(path.join(repo, 'source.txt'), 'base edit\n');
  git(['add', '.']);
  git(['commit', '-m', 'base work']);
  const base = git(['rev-parse', 'HEAD']);
  git(['worktree', 'add', work, 'candidate']);
  fs.writeFileSync(path.join(work, 'head.txt'), 'head contribution\n');
  fs.writeFileSync(path.join(work, 'archify.zip'), Buffer.from([0, 4, 5, 6]));
  if (sourceConflict) fs.writeFileSync(path.join(work, 'source.txt'), 'candidate edit\n');
  git(['add', '.'], work);
  git(['commit', '-m', 'candidate work'], work);
  const head = git(['rev-parse', 'HEAD'], work);
  const invoke = (extra = [], overrides = {}) => spawnSync(process.execPath, [helper, '--base', 'base', '--expect-head', overrides.head || head, '--expect-base', overrides.base || base, ...extra], { cwd: overrides.cwd || work, encoding: 'utf8' });
  const snapshot = () => ({ head: git(['rev-parse', 'HEAD'], work), status: git(['status', '--porcelain=v1', '-uall'], work), index: git(['ls-files', '--stage'], work), files: Object.fromEntries(['archify.zip', 'source.txt', 'head.txt', 'base.txt', 'dirty.txt'].filter(name => fs.existsSync(path.join(work, name))).map(name => [name, fs.readFileSync(path.join(work, name)).toString('base64')])) });
  return { repo, work, git, invoke, snapshot, head, base };
}

test('plan leaves checkout unchanged; apply combines source, rebuilds ZIP and retains uncommitted parents', t => {
  const f = fixture(t);
  const before = f.snapshot();
  const plan = f.invoke();
  assert.equal(plan.status, 0, plan.stderr);
  const receipt = JSON.parse(plan.stdout);
  assert.equal(receipt.mode, 'plan');
  assert.deepEqual(receipt.conflicts, ['archify.zip']);
  assert.deepEqual(f.snapshot(), before);
  assert.equal(f.git(['rev-parse', '--verify', 'HEAD'], f.work), f.head);
  const apply = f.invoke(['--apply']);
  assert.equal(apply.status, 0, apply.stderr);
  const result = JSON.parse(apply.stdout);
  assert.equal(result.head, f.head);
  assert.equal(result.base, f.base);
  assert.equal(f.git(['rev-parse', 'HEAD'], f.work), f.head);
  assert.equal(f.git(['rev-parse', 'MERGE_HEAD'], f.work), f.base);
  assert.equal(f.git(['write-tree'], f.work), result.resultTree);
  assert.equal(f.git(['diff', '--name-only', '--diff-filter=U'], f.work), '');
  assert.equal(f.git(['diff', '--name-only'], f.work), '');
  assert.equal(fs.readFileSync(path.join(f.work, 'archify.zip'), 'utf8'), 'head contribution\nbase contribution\n');
  assert.equal(fs.readFileSync(path.join(f.work, 'head.txt'), 'utf8'), 'head contribution\n');
  assert.equal(fs.readFileSync(path.join(f.work, 'base.txt'), 'utf8'), 'base contribution\n');
  assert.match(result.required, /CI including ZIP freshness/);
});

for (const refusal of ['dirty', 'source conflict', 'head drift', 'base drift', 'in-progress merge']) {
  test(`${refusal} is refused before modifying checkout`, t => {
    const f = fixture(t, { sourceConflict: refusal === 'source conflict' });
    if (refusal === 'dirty') fs.writeFileSync(path.join(f.work, 'dirty.txt'), 'preserve me');
    if (refusal === 'in-progress merge') fs.writeFileSync(path.resolve(f.work, f.git(['rev-parse', '--git-path', 'MERGE_HEAD'], f.work)), `${f.base}\n`);
    const before = f.snapshot();
    const overrides = refusal === 'head drift' ? { head: f.base } : refusal === 'base drift' ? { base: f.head } : {};
    const result = f.invoke(['--apply'], overrides);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /clean|source.txt|drift|In-progress/);
    assert.deepEqual(f.snapshot(), before);
  });
}

test('apply refuses a primary checkout even when clean', t => {
  const f = fixture(t);
  const result = f.invoke(['--apply'], { cwd: f.repo, head: f.base });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /isolated linked worktree/);
  assert.equal(f.git(['status', '--porcelain=v1'], f.repo), '');
});

for (const failure of ['build failure', 'builder source mutation']) {
  test(`${failure} reports recoverable merge and preserves both contributions`, t => {
    const f = fixture(t, { buildFailure: failure === 'build failure', corruptSource: failure === 'builder source mutation' });
    const result = f.invoke(['--apply']);
    assert.equal(result.status, 1);
    assert.match(result.stderr, failure === 'build failure' ? /fixture-build-failure/ : /Source differs/);
    assert.match(result.stderr, /git merge --abort/);
    assert.equal(f.git(['rev-parse', 'HEAD'], f.work), f.head);
    assert.equal(f.git(['rev-parse', 'MERGE_HEAD'], f.work), f.base);
    assert.equal(fs.readFileSync(path.join(f.work, 'base.txt'), 'utf8'), 'base contribution\n');
    f.git(['merge', '--abort'], f.work);
    if (failure === 'build failure') {
      assert.equal(f.git(['status', '--porcelain=v1'], f.work), '');
      assert.equal(fs.readFileSync(path.join(f.work, 'head.txt'), 'utf8'), 'head contribution\n');
    } else {
      assert.match(result.stderr, /Builder edits may remain/);
      assert.equal(fs.readFileSync(path.join(f.work, 'head.txt'), 'utf8'), 'lost\n');
    }
  });
}

test('a conflict-free merge is refused without creating a merge state', t => {
  const f = fixture(t);
  f.git(['checkout', 'base', '--', 'archify.zip'], f.work);
  f.git(['commit', '-m', 'already matching ZIP'], f.work);
  const head = f.git(['rev-parse', 'HEAD'], f.work);
  const before = f.snapshot();
  const result = f.invoke(['--apply'], { head });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /found: no conflicts/);
  assert.deepEqual(f.snapshot(), before);
});

test('--help describes the read-only default and review boundary', () => {
  const result = spawnSync(process.execPath, [helper, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Default: inspect/);
  assert.match(result.stdout, /No fetch, commit or push/);
});
