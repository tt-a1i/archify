import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateSchema } from '../renderers/shared/validator.mjs';

const cli = fileURLToPath(new URL('../bin/archify.mjs', import.meta.url));

function git(root, args, input) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', input }).trim();
}

function write(root, file, contents) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function commit(root, message) {
  git(root, ['commit', '-qm', message]);
  return git(root, ['rev-parse', 'HEAD']);
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-locate-hostile-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'repo');
  fs.mkdirSync(root);
  git(root, ['init', '-q', '-b', 'main']);
  for (const [key, value] of Object.entries({
    'user.name': 'Archify Tests',
    'user.email': 'archify@example.test',
    'commit.gpgsign': 'false',
    'core.hooksPath': path.join(directory, 'no-hooks'),
    'core.quotePath': 'true',
    'core.autocrlf': 'false',
  })) git(root, ['config', key, value]);
  write(root, 'map.workflow.json', JSON.stringify({
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Committed path ownership' },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [{ id: 'core', type: 'backend', lane: 'main', col: 0, label: 'Core' }],
    edges: [],
  }));
  write(root, 'map.workflow.ownership.json', JSON.stringify({
    schema_version: 1,
    kind: 'ownership',
    map: 'map.workflow.json',
    excluded: ['map.workflow.json', 'map.workflow.ownership.json'],
    components: [{ id: 'core', globs: ['src/**'] }],
  }));
  write(root, 'src/seed.mjs', 'export const seed = 1;\n');
  git(root, ['add', '.']);
  const base = commit(root, 'base');
  return { root, base, out: path.join(directory, 'out') };
}

// Commit genuine Git tree entries without requiring Windows symlink privileges.
function stageEntry(root, mode, file, contentsOrCommit) {
  const object = mode === '160000'
    ? contentsOrCommit
    : git(root, ['hash-object', '-w', '--stdin'], contentsOrCommit);
  git(root, ['update-index', '-z', '--index-info'], `${mode} ${object}\t${file}\0`);
}

function commitControlPath(root, parent, file) {
  // Build objects directly: neither the filesystem nor a platform-specific
  // Git index path check should need to represent the hostile filename.
  const blob = git(root, ['hash-object', '-w', '--stdin'], 'export const value = 1;\n');
  const sourceEntries = git(root, ['ls-tree', '-z', `${parent}:src`]);
  const sourceTree = git(root, ['mktree', '-z'], `${sourceEntries}100644 blob ${blob}\t${file.slice('src/'.length)}\0`);
  const rootEntries = git(root, ['ls-tree', '-z', parent]).split('\0').filter(entry => entry && !entry.endsWith('\tsrc'));
  const tree = git(root, ['mktree', '-z'], `${rootEntries.join('\0')}\0` + `040000 tree ${sourceTree}\tsrc\0`);
  return git(root, ['commit-tree', tree, '-p', parent, '-m', 'control path']);
}

function locate({ root, out }, revisionArgs) {
  const result = spawnSync(process.execPath, [cli, 'locate', ...revisionArgs,
    '--map', path.join(root, 'map.workflow.json'), '--repo-root', root, '--out', out, '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, '', result.stderr);
  return { result, payload: JSON.parse(result.stdout) };
}

function success(repo, revisionArgs) {
  const { result, payload } = locate(repo, revisionArgs);
  assert.equal(result.status, 0, result.stdout);
  assert.equal(payload.ok, true);
  validateSchema('locate-receipt', payload);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(repo.out, 'locate.receipt.json'), 'utf8')), payload);
  assert.ok(fs.statSync(path.join(repo.out, 'locate.html')).size > 0);
  return payload;
}

test('locate --lint attributes Unicode paths and repeats the delivered output bytes', t => {
  const repo = fixture(t);
  const file = 'src/文档.mjs';
  write(repo.root, file, 'export const documentation = 1;\n');
  git(repo.root, ['add', '.']);
  const revision = commit(repo.root, 'Unicode input');
  const receipt = success(repo, ['--lint', revision]);
  assert.equal(receipt.mode, 'lint');
  assert.equal(receipt.repository.revision, revision);
  assert.deepEqual(receipt.files.find(entry => entry.path === file), {
    path: file, changeType: 'tracked', state: 'touched', componentId: 'core', matchedGlob: 'src/**',
  });
  assert.equal(receipt.summary.files.touched, 2);
  assert.equal(receipt.files.some(entry => entry.path.startsWith('"') || entry.path.includes('\\346')), false);
  const delivered = new Map(['locate.html', 'locate.receipt.json'].map(output =>
    [output, fs.readFileSync(path.join(repo.out, output))]));
  success(repo, ['--lint', revision]);
  for (const [output, bytes] of delivered) {
    assert.deepEqual(fs.readFileSync(path.join(repo.out, output)), bytes, `${output} changed on an identical CLI rerun`);
  }
});

for (const [name, file] of [['tab', 'src/has\ttab.mjs'], ['newline', 'src/new\nline.mjs']]) {
  test(`locate rejects a committed ${name} path without replacing the previous output pair`, t => {
    const repo = fixture(t);
    const head = commitControlPath(repo.root, repo.base, file);
    fs.mkdirSync(repo.out);
    const previous = { 'locate.html': 'trusted HTML', 'locate.receipt.json': '{"previous":true}\n' };
    for (const [output, bytes] of Object.entries(previous)) write(repo.out, output, bytes);
    for (const args of [[`${repo.base}..${head}`], ['--lint', head]]) {
      const { result, payload } = locate(repo, args);
      assert.equal(result.status, 1, result.stdout);
      assert.equal(payload.ok, false);
      assert.equal(payload.diagnostics[0].code, 'locate/path-invalid');
      assert.equal(payload.diagnostics[0].evidence.path, file);
      for (const [output, bytes] of Object.entries(previous)) {
        assert.equal(fs.readFileSync(path.join(repo.out, output), 'utf8'), bytes);
      }
      assert.deepEqual(fs.readdirSync(repo.out).sort(), Object.keys(previous).sort());
    }
  });
}

test('locate attributes symlink retargeting and a symlink-to-file type change to the committed path', t => {
  const repo = fixture(t);
  const file = 'src/link.mjs';
  stageEntry(repo.root, '120000', file, '../../outside-old.mjs');
  const base = commit(repo.root, 'symlink');
  stageEntry(repo.root, '120000', file, '../../outside-new.mjs');
  const retargeted = commit(repo.root, 'retarget symlink');
  stageEntry(repo.root, '100644', file, 'export const local = true;\n');
  const regular = commit(repo.root, 'replace symlink with file');
  assert.match(git(repo.root, ['ls-tree', base, '--', file]), /^120000 blob /);
  assert.match(git(repo.root, ['ls-tree', regular, '--', file]), /^100644 blob /);
  for (const [from, to, changeType] of [[base, retargeted, 'M'], [retargeted, regular, 'T']]) {
    const receipt = success(repo, [`${from}..${to}`]);
    assert.deepEqual(receipt.files.map(({ path: filePath, changeType: type, state, componentId }) =>
      ({ path: filePath, changeType: type, state, componentId })), [
      { path: file, changeType, state: 'touched', componentId: 'core' },
    ]);
  }
});

test('locate reports a gitlink addition and revision update without descending into its target commit', t => {
  const repo = fixture(t);
  const file = 'src/dependency';
  stageEntry(repo.root, '160000', file, repo.base);
  const added = commit(repo.root, 'add gitlink');
  stageEntry(repo.root, '160000', file, added);
  const updated = commit(repo.root, 'update gitlink');
  assert.match(git(repo.root, ['ls-tree', updated, '--', file]), new RegExp(`^160000 commit ${added}\\t`));
  for (const [from, to, changeType] of [[repo.base, added, 'A'], [added, updated, 'M']]) {
    const receipt = success(repo, [`${from}..${to}`]);
    assert.equal(receipt.files.length, 1);
    assert.equal(receipt.files[0].path, file);
    assert.equal(receipt.files[0].changeType, changeType);
    assert.equal(receipt.files[0].state, 'touched');
    assert.equal(receipt.files[0].componentId, 'core');
  }
  const lint = success(repo, ['--lint', updated]);
  assert.equal(lint.files.find(entry => entry.path === file).state, 'touched');
  assert.equal(lint.files.some(entry => entry.path.startsWith(`${file}/`)), false);
});

test('locate compares the two endpoint trees on divergent branches, including deletions from the left tree', t => {
  const repo = fixture(t);
  git(repo.root, ['checkout', '-qb', 'left']);
  write(repo.root, 'src/left.mjs', 'only the left branch\n');
  git(repo.root, ['add', '.']);
  const left = commit(repo.root, 'left');
  git(repo.root, ['checkout', '-qb', 'right', repo.base]);
  write(repo.root, 'src/right.mjs', 'distinct content for the right branch\n');
  git(repo.root, ['add', '.']);
  const right = commit(repo.root, 'right');
  assert.equal(git(repo.root, ['merge-base', left, right]), repo.base);
  const receipt = success(repo, [`${left}..${right}`]);
  assert.equal(receipt.repository.base, left);
  assert.equal(receipt.repository.head, right);
  assert.deepEqual(receipt.files.map(({ path: file, changeType, state, componentId }) =>
    ({ path: file, changeType, state, componentId })), [
    { path: 'src/left.mjs', changeType: 'D', state: 'touched', componentId: 'core' },
    { path: 'src/right.mjs', changeType: 'A', state: 'touched', componentId: 'core' },
  ]);
});
