import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { globToRegex, Map0, replay, anchorDecay, stats } from './historical-method.mjs';

// Protect historically different behavior; these are not current Locate rules.
assert.equal(globToRegex('a/**').test('a/'), true);
const map = { base: 'base', components: { old: { globs: ['old/**'] }, next: { globs: ['next/**'] } }, excluded: ['next/ignored'] };
assert.deepEqual(new Map0(map).classify('next/ignored'), { state: 'excluded' });
const replies = new Map([
  [['rev-list', '--reverse', '--first-parent', 'base..head'].join('\0'), 'head\n'],
  [['rev-list', '--count', 'base..head'].join('\0'), '1\n'],
  [['ls-tree', '-r', '--name-only', 'base'].join('\0'), 'old/file\n'],
  [['log', '-1', '--format=%s', 'head'].join('\0'), 'rename\n'],
  [['log', '-1', '--format=%P', 'head'].join('\0'), 'base\n'],
  [['diff', '--name-status', '-M', '-z', 'head^', 'head'].join('\0'), 'R100\0old/file\0next/file\0R100\0unowned/file\0next/ignored\0'],
]);
const git = args => {
  const answer = replies.get(args.join('\0'));
  assert.notEqual(answer, undefined, `Unexpected Git operation: ${args.join(' ')}`);
  return answer;
};
const result = replay({ git, BASE: 'base', HEAD: 'head', mapInput: map, edits: {} });
assert.deepEqual(result.replay.trace[0].componentsTouched, ['next']);
assert.equal(result.replay.trace[0].requiresMapEdit, false);
assert.deepEqual(result.replay.trace[0].before, { excluded: 1, covered: 1, uncovered: 0, ambiguous: 0 });

// First invalidation persists even if the exact pinned text later returns.
const selection = [1, 2, 3].map(line => ({ component: 'sample', path: 'file.mjs', line }));
const decay = anchorDecay({
  BASE: 'base', HEAD: 'head', selection,
  git: args => args.includes('--reverse') ? 'middle\nhead\n' : 'head\nmiddle\n',
  show: revision => revision === 'middle' ? 'Y1\nY2\nY3' : 'X1\nX2\nX3',
});
assert.equal(decay.summary.anchorsValidAtHead, 3);
assert.equal(decay.summary.commitsInvalidatingAtLeastOneAnchor, 1);
assert.deepEqual(decay.perCommit.map(commit => commit.anchorFilesTouched), [3, 3]);
assert.deepEqual(decay.perCommit.map(commit => commit.invalidated), [3, 0]);
assert.ok(decay.anchors.every(anchor => anchor.validAtHead && anchor.firstInvalidatedAt === 'middle'));

// Stats uses the supplied new trace, not the historical tracked replay on disk.
const measured = stats({ git: () => 'next/file\n', HEAD: 'head', map: result.map, replay: result.replay });
assert.equal(measured.commits, 1);
assert.deepEqual(measured.commitsTouchingComponent, { next: 1 });

// Refusing an existing output is public CLI behavior and must not alter evidence.
const existing = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-e3-output-check-'));
try {
  fs.writeFileSync(path.join(existing, 'sentinel'), 'preserve');
  const run = fileURLToPath(new URL('./run.mjs', import.meta.url));
  const response = spawnSync(process.execPath, [run, '--repo', '.', '--out', existing], { encoding: 'utf8' });
  assert.equal(response.status, 2);
  assert.match(response.stderr, /must be a new directory/);
  assert.deepEqual(fs.readdirSync(existing), ['sentinel']);
  assert.equal(fs.readFileSync(path.join(existing, 'sentinel'), 'utf8'), 'preserve');
} finally {
  fs.rmSync(existing, { recursive: true });
}
console.log('E3 self-check passed: historical matcher/rename, anchor recovery/counts, supplied stats trace, output preservation.');
