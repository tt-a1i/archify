import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { cli, git, skillRoot } from './helpers/repository-evidence-fixture.mjs';
import { createScratchDirectory } from './helpers/scratch-directory.mjs';
import { findRiskVerdict } from '../archify/pr/markdown.mjs';

function pinnedFixture() {
  const root = createScratchDirectory(path.join(os.tmpdir(), 'archify-lens-git-'));
  git(root, 'init');
  git(root, 'config', 'user.name', 'Archify Tests');
  git(root, 'config', 'user.email', 'archify@example.test');
  git(root, 'config', 'core.autocrlf', 'false');
  const oldName = 'old résumé [a].txt';
  const newName = process.platform === 'win32' ? 'new résumé [a].txt' : ':(literal) new "résumé" [a].txt';
  const write = (name, text) => fs.writeFileSync(path.join(root, name), text);
  const lines = Array.from({ length: 48 }, (_, index) => index === 3 ? '' : `row ${index + 1} with content`);
  const original = lines.join('\r\n');
  write(oldName, original);
  write('plain old.txt', 'same content\n');
  write('removed.txt', 'last line');
  write('mode.txt', 'same mode fixture\n');
  write('binary.bin', Buffer.from([0, 1, 2]));
  write('encoded.txt', Buffer.from([0xff, 1, 2]));
  write('.gitattributes', '*.txt -diff\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-m', 'Base');
  const baseSha = git(root, 'rev-parse', 'HEAD');
  git(root, 'checkout', '-b', 'base-tip');
  write('base-only.txt', 'Branch-specific text\n');
  git(root, 'add', 'base-only.txt');
  git(root, 'commit', '-m', 'Divergent base change');
  git(root, 'checkout', '-b', 'feature', baseSha);
  fs.renameSync(path.join(root, oldName), path.join(root, newName));
  fs.renameSync(path.join(root, 'plain old.txt'), path.join(root, 'plain new.txt'));
  fs.unlinkSync(path.join(root, 'removed.txt'));
  const revised = [...lines];
  revised[4] = 'Updated at five';
  revised[47] = 'Updated final line';
  write(newName, revised.join('\r\n'));
  write('added.txt', 'brand new\n');
  write('empty.txt', '');
  write('binary.bin', Buffer.from([0, 3, 4]));
  write('encoded.txt', Buffer.from([0xfe, 1, 2]));
  git(root, 'add', '-A');
  git(root, 'update-index', '--chmod=+x', 'mode.txt');
  git(root, 'update-index', '--add', '--cacheinfo', `160000,${baseSha},module`);
  git(root, 'commit', '-m', 'Pinned feature');
  const headSha = git(root, 'rev-parse', 'HEAD');
  // Local replacements and unsaved content must never enter a pinned excerpt.
  git(root, 'replace', headSha, git(root, 'rev-parse', 'base-tip'));
  write(newName, 'dirty worktree');
  git(root, 'config', 'diff.suppressBlankEmpty', 'true');

  const diagram = 'checkout-ledger.sequence.json';
  fs.copyFileSync(path.join(skillRoot, 'examples', diagram), path.join(root, diagram));
  const manifest = {
    schema_version: 1, kind: 'pr-pack', title: 'Pinned review', baseRef: 'base-tip', headRef: 'feature', baseSha, headSha,
    stats: { filesChanged: 99, extraCount: 4 },
    views: [{ id: 'flow', type: 'sequence', title: 'Message exchange', input: diagram }],
    walkthrough: { steps: [{ id: 'first', title: 'Two hunks', viewId: 'flow', primarySliceId: 'old', relatedSliceIds: ['new', 'same'] }],
      slices: [
        { id: 'old', side: 'base', path: oldName, line: 5 },
        { id: 'new', side: 'head', path: newName, hunk: 2 },
        { id: 'same', side: 'head', path: newName, line: 5 },
        { id: 'renamed', side: 'base', path: 'plain old.txt' },
        { id: 'binary', side: 'head', path: 'binary.bin' },
        { id: 'empty', side: 'head', path: 'empty.txt' },
        { id: 'encoded', side: 'head', path: 'encoded.txt' },
        { id: 'deleted', side: 'base', path: 'removed.txt' },
        { id: 'added', side: 'head', path: 'added.txt' },
        { id: 'mode', side: 'head', path: 'mode.txt' },
        { id: 'module', side: 'head', path: 'module' },
      ] },
  };
  const file = path.join(root, 'manifest.json');
  const output = path.join(root, 'review');
  const run = (command = 'lens', env = process.env, { input = file, preload = [] } = {}) => {
    fs.writeFileSync(input, JSON.stringify(manifest));
    return spawnSync(process.execPath, [...preload, cli, 'pr', command, input, '--repo-root', root, '--json',
      ...(['lens', 'build'].includes(command) ? ['--out-dir', output] : [])], { encoding: 'utf8', env });
  };
  const lens = (env) => {
    const result = run('lens', env);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const receipt = JSON.parse(result.stdout);
    const html = fs.readFileSync(receipt.output.path, 'utf8');
    return { receipt, model: JSON.parse(html.match(/<script id="lens-data" type="application\/json">([^<]*)<\/script>/)[1]) };
  };
  return { root, manifest, oldName, newName, baseSha, headSha, write, run, lens };
}

test('Lens reads pinned rename hunks, CRLF, missing newline, file-only changes and numstat', () => {
  const { manifest, root, oldName, newName, baseSha, headSha, lens, run } = pinnedFixture();
  manifest.walkthrough.steps[0].relatedSliceIds.push('renamed', 'binary', 'empty', 'encoded', 'deleted', 'added');
  manifest.walkthrough.steps.push({
    id: 'metadata', title: 'File metadata', viewId: 'flow', primarySliceId: 'mode', relatedSliceIds: ['module'],
  });
  const { receipt, model } = lens();
  assert.deepEqual(receipt.revisions, { baseSha, headSha, verified: true });
  assert.equal(receipt.verifiedHunkCount, 4);
  assert.equal(run('validate').status, 0);
  const [first, second, deleted, added] = model.hunks;
  assert.deepEqual([first.oldPath, first.newPath], [oldName, newName]);
  assert.match(first.header, /^@@ -2,7 \+2,7 @@/);
  assert.match(second.header, /^@@ -45,4 \+45,4 @@/);
  assert.match(deleted.header, /^@@ -1 \+0,0 @@/);
  assert.match(added.header, /^@@ -0,0 \+1 @@/);
  assert.equal(first.rows.find((row) => row.oldLine === 4).text, '\r');
  assert.equal(first.rows.find((row) => row.newLine === 5).text, 'Updated at five\r');
  assert.equal(second.rows.filter((row) => row.kind === 'marker').length, 2);
  for (const hunk of model.hunks) {
    const read = (sha, file) => file ? execFileSync('git', ['--no-replace-objects', '-C', root, 'show', `${sha}:${file}`], { encoding: 'utf8' }).split('\n') : [];
    const base = read(baseSha, hunk.oldPath);
    const head = read(headSha, hunk.newPath);
    for (const row of hunk.rows) {
      if (row.oldLine !== null) assert.equal(base[row.oldLine - 1], row.text);
      if (row.newLine !== null) assert.equal(head[row.newLine - 1], row.text);
    }
  }
  const [primary, other, duplicate, rename, binary, empty, encoded] = model.steps[0].citations;
  assert.deepEqual([primary.hunkIndex, other.hunkIndex, duplicate.hunkIndex], [0, 1, 0]);
  assert.match(rename.reason, /renamed/);
  assert.match(binary.reason, /Binary/);
  assert.match(empty.reason, /no text hunk/);
  assert.match(encoded.reason, /encoding/);
  assert.deepEqual(model.steps[1].citations.map(({ reason }) => reason), [
    'File mode changed without text changes.', 'Submodule change has no source text hunk.',
  ]);
  assert.deepEqual(model.counts.map(({ key, value, origin }) => [key, value, origin]), [
    ['filesChanged', 9, 'Git'], ['additions', 5, 'Git'], ['deletions', 4, 'Git'],
    ['filesChanged', 99, 'Declared'], ['extraCount', 4, 'Declared'],
  ]);
});

test('pinned diffs ignore host settings while ordinary origin verification honors insteadOf', () => {
  const { root, baseSha, headSha, manifest, write, lens, run } = pinnedFixture();
  const baseline = lens();
  git(root, 'tag', '-a', 'review-head', '-m', 'Head pin', headSha);
  git(root, 'tag', '-a', 'review-base', '-m', 'Base pin', baseSha);
  delete manifest.baseRef;
  delete manifest.headRef;
  manifest.headSha = git(root, 'rev-parse', 'review-head');
  manifest.baseSha = git(root, 'rev-parse', 'review-base');
  assert.notEqual(manifest.headSha, headSha);
  assert.notEqual(manifest.baseSha, baseSha);

  git(root, 'config', 'diff.renameLimit', '1');
  git(root, 'config', 'diff.unified', '0');
  git(root, 'config', 'diff.blocked.binary', 'true');
  git(root, 'config', 'diff.blocked.textconv', 'false');
  const attributes = '*.txt diff=blocked\n';
  write('.gitattributes', '*.txt -diff\n');
  const global = path.join(root, 'global.gitconfig');
  const attrs = path.join(root, 'global.attributes');
  write('global.attributes', '*.txt -diff\n');
  execFileSync('git', ['config', '--file', global, 'core.attributesFile', attrs]);
  execFileSync('git', ['config', '--file', global, 'url.https://github.com/example/.insteadOf', 'https://mirror.example/']);
  git(root, 'remote', 'add', 'origin', 'https://mirror.example/pinned-review');
  write('.git/info/attributes', attributes);

  const env = {
    ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_SYSTEM: global, GIT_CONFIG_NOSYSTEM: '0',
    GIT_DIFF_OPTS: '--unified=0', GIT_EXTERNAL_DIFF: 'false',
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'diff.renames', GIT_CONFIG_VALUE_0: 'false',
  };
  const actual = lens(env);
  assert.deepEqual(actual.receipt.revisions, { baseSha, headSha, verified: true });
  assert.deepEqual(actual.model.hunks, baseline.model.hunks);
  assert.deepEqual(actual.model.counts, baseline.model.counts);
  const preflight = spawnSync(process.execPath, [cli, 'pr', 'preflight', '--repo-root', root, '--base', baseSha, '--head', headSha, '--json'], {
    encoding: 'utf8', env,
  });
  assert.equal(preflight.status, 0, preflight.stdout + preflight.stderr);
  assert.deepEqual(JSON.parse(preflight.stdout).stats, Object.fromEntries(
    baseline.model.counts.filter(({ origin }) => origin === 'Git').map(({ key, value }) => [key, value]),
  ));
  const validate = run('validate', env);
  assert.equal(validate.status, 0, validate.stdout + validate.stderr);
  assert.equal(JSON.parse(validate.stdout).revisions.headSha, headSha);
  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'web-app.architecture.json'), 'utf8'));
  diagram.meta.repository = { url: 'https://github.com/example/pinned-review', revision: headSha };
  diagram.components[0].sources = [{ path: 'added.txt', line: 1 }];
  write('origin.architecture.json', JSON.stringify(diagram));
  const origin = spawnSync(process.execPath, [cli, 'validate', 'architecture', path.join(root, 'origin.architecture.json'),
    '--repo-root', root, '--json'], { encoding: 'utf8', env });
  assert.equal(origin.status, 0, origin.stdout + origin.stderr);
});

test('walkthrough index failures redact the entire PR error envelope', () => {
  const { root, manifest, write, run } = pinnedFixture();
  const input = path.join(root, 'SAFE.json');
  const hook = path.join(root, 'reject-index.mjs');
  write('reject-index.mjs', `
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const original = childProcess.spawnSync;
    childProcess.spawnSync = (command, args, options) =>
      command === 'git' && args.includes('--name-status')
        ? { status: 128, stdout: Buffer.alloc(0), stderr: Buffer.from('SAFE') }
        : original(command, args, options);
    syncBuiltinESMExports();
  `);
  const options = { input, preload: ['--import', hook] };
  for (const command of ['validate', 'lens', 'build']) {
    const result = run(command, process.env, options);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.diagnostics[0].code, 'pr-pack/invalid-source-anchor');
    assert.equal(Object.hasOwn(report, 'input'), false);
    assert.equal(findRiskVerdict(result.stdout + result.stderr), null);
  }
  delete manifest.walkthrough;
  const noWalkthrough = run('validate', process.env, options);
  assert.equal(noWalkthrough.status, 0, noWalkthrough.stdout + noWalkthrough.stderr);
});

test('legacy build accepts the UTF-8 head side of a rename with an undecodable base path', () => {
  const { root, manifest, run } = pinnedFixture();
  const updateIndex = (input) => execFileSync('git', ['-C', root, 'update-index', '-z', '--index-info'], { input });
  const rawName = Buffer.concat([Buffer.from('old-'), Buffer.from([0xff]), Buffer.from('.txt\0')]);
  git(root, 'replace', '-d', manifest.headSha);
  const blob = git(root, 'rev-parse', 'HEAD:added.txt');
  updateIndex(Buffer.concat([Buffer.from(`100644 ${blob}\t`), rawName]));
  git(root, 'commit', '-m', 'Add undecodable pathname');
  manifest.baseSha = git(root, 'rev-parse', 'HEAD');
  updateIndex(Buffer.concat([Buffer.from(`0 ${'0'.repeat(40)}\t`), rawName, Buffer.from(`100644 ${blob}\treadable.txt\0`)]));
  git(root, 'commit', '-m', 'Rename to a readable pathname');
  manifest.headSha = git(root, 'rev-parse', 'HEAD');
  delete manifest.baseRef;
  delete manifest.headRef;
  delete manifest.walkthrough;
  manifest.changes = [{ subject: 'Rename file', change: 'modified', path: 'readable.txt', line: 1 }];
  const result = run('build');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).revisions.headSha, manifest.headSha);
});

test('pinned selectors fail precisely and legacy lines outside a hunk stay citations', () => {
  const { manifest, oldName, newName, lens, run } = pinnedFixture();
  const first = manifest.walkthrough.slices[0];
  const expectFailure = (code, pointer, command) => {
    const result = run(command);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const [diagnostic] = JSON.parse(result.stdout).diagnostics;
    assert.equal(diagnostic.code, code);
    if (pointer) assert.equal(diagnostic.subject.path, pointer);
  };
  first.path = newName;
  expectFailure('pr-lens/path-not-found', '/walkthrough/slices/0/path');
  first.path = oldName;
  first.line = 21;
  expectFailure('pr-lens/hunk-not-found', '/walkthrough/slices/0/line', 'validate');
  delete first.line;
  first.hunk = 8;
  expectFailure('pr-lens/hunk-not-found', '/walkthrough/slices/0/hunk');
  delete manifest.walkthrough;
  manifest.changes = [
    { subject: 'Outside the hunk', change: 'modified', view: 'flow', path: newName, line: 21 },
    { subject: 'Inside the hunk', change: 'modified', view: 'flow', path: newName, line: 5 },
  ];
  const { model } = lens();
  assert.equal(model.steps[0].citations[0].hunkIndex, 0);
  assert.equal(model.steps[0].citations[1].reason, 'Line outside displayed diff.');
  manifest.headRef = 'missing';
  expectFailure('pr-pack/ref-unavailable');
});

test('Lens refuses prohibited text in real pinned source and selector paths', () => {
  const { manifest, root, write, run } = pinnedFixture();
  git(root, 'replace', '-d', manifest.headSha);
  write('added.txt', 'function call() { /* no_impact */ }\n');
  git(root, 'add', 'added.txt');
  git(root, 'commit', '-m', 'Additional source');
  manifest.headSha = git(root, 'rev-parse', 'HEAD');
  const bad = run();
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.equal(JSON.parse(bad.stdout).diagnostics[0].code, 'pr-pack/risk-verdict');
  assert.equal(findRiskVerdict(bad.stdout + bad.stderr), null);
  assert.equal(fs.existsSync(path.join(root, 'review')), false);
  manifest.walkthrough.slices[0].path = 'src/low-risk.txt';
  const invalid = run('validate');
  assert.equal(invalid.status, 1);
  assert.equal(findRiskVerdict(invalid.stdout + invalid.stderr), null);
  assert.equal(JSON.parse(invalid.stdout).diagnostics[0].subject.path, '/walkthrough/slices/0/path');
});
