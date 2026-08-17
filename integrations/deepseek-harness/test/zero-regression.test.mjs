import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

function git(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

test('the repository still has exactly one checked-in Archify SKILL.md and no generated DSH payload', () => {
  const skillFiles = git(['ls-files', '*SKILL.md']).split('\n').filter(Boolean);
  assert.deepEqual(skillFiles, ['archify/SKILL.md']);
  assert.equal(fs.existsSync(path.join(repoRoot, 'integrations/deepseek-harness/skills')), false);
  const trackedSkills = git(['ls-files', 'integrations/deepseek-harness/skills']);
  assert.equal(trackedSkills, '');
});

test('Archify core does not import, detect, or branch on DeepSeek Harness', () => {
  const grep = spawnSync('git', [
    'grep',
    '-n',
    '-E',
    'deepseek-harness|@deepseek-ai/dsh|DSH_HOME|DSH_AGENTS_HOME|archify-dsh',
    '--',
    'archify',
    'scripts/build-zip.sh',
    'scripts/package-smoke.mjs',
  ], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(grep.status, 1, grep.stderr || grep.stdout);
  assert.equal(grep.stdout.trim(), '');
});

test('full-depth Skills CLI discovery still finds only one skill named archify', () => {
  const result = spawnSync('npx', ['-y', 'skills', 'add', repoRoot, '--list', '--full-depth'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const names = [...result.stdout.matchAll(/^\s*[-*]\s+(\S+)/gm)].map((match) => match[1])
    .filter((name) => name === 'archify' || /archify/i.test(name));
  const unique = new Set(
    [...result.stdout.matchAll(/\barchify\b/gi)].map((match) => match[0].toLowerCase()),
  );
  assert.ok(result.stdout.includes('archify'), result.stdout);
  assert.equal(unique.size, 1, result.stdout);
  assert.ok(names.length <= 1 || new Set(names).size === 1, result.stdout);
});
