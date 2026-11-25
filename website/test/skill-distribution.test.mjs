import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stageCleanCompanionSkill } from '../../scripts/stage-clean-companion-skill.mjs';
import { stageSkillDistribution } from '../scripts/stage-skill-distribution.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));

function inventory(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? inventory(path.join(dir, entry.name)).map((name) => `${entry.name}/${name}`) : [entry.name]).sort();
}

function extractArchive(zip, destination) {
  fs.mkdirSync(destination, { recursive: true });
  if (process.platform === 'win32') execFileSync('tar', ['-xf', zip, '-C', destination]);
  else execFileSync('unzip', ['-q', zip, '-d', destination]);
}

function assertMatchingTrees(left, right) {
  assert.deepEqual(inventory(left), inventory(right));
  for (const name of inventory(left)) {
    assert.deepEqual(fs.readFileSync(path.join(left, name)), fs.readFileSync(path.join(right, name)), name);
  }
}

test('discovery archives preserve every canonical package file without wrappers', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-discovery-test-'));
  try {
    const output = path.join(scratch, 'public');
    stageSkillDistribution(repo, output);
    const indexPath = path.join(output, '.well-known/agent-skills/index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.equal(index.$schema, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json');
    assert.deepEqual(index.skills.map((entry) => entry.name), ['archify', 'archify-pr']);
    const byName = Object.fromEntries(index.skills.map((entry) => [entry.name, entry]));

    const archifyArchive = fileURLToPath(new URL(byName.archify.url, pathToFileURL(indexPath)));
    assert.equal(byName.archify.type, 'archive');
    assert.equal(byName.archify.digest, `sha256:${createHash('sha256').update(fs.readFileSync(archifyArchive)).digest('hex')}`);
    const original = path.join(scratch, 'canonical');
    const downloaded = path.join(scratch, 'downloaded');
    extractArchive(path.join(repo, 'archify.zip'), original);
    extractArchive(archifyArchive, downloaded);
    assertMatchingTrees(path.join(original, 'archify'), downloaded);
    assert.equal(fs.existsSync(path.join(downloaded, 'SKILL.md')), true);

    const companionArchive = fileURLToPath(new URL(byName['archify-pr'].url, pathToFileURL(indexPath)));
    assert.equal(byName['archify-pr'].type, 'archive');
    assert.equal(byName['archify-pr'].digest, `sha256:${createHash('sha256').update(fs.readFileSync(companionArchive)).digest('hex')}`);
    const companionCanonical = path.join(scratch, 'companion-canonical');
    const companionDownloaded = path.join(scratch, 'companion-downloaded');
    stageCleanCompanionSkill({ repoRoot: repo, destination: companionCanonical });
    extractArchive(companionArchive, companionDownloaded);
    assertMatchingTrees(companionCanonical, companionDownloaded);
    assert.equal(fs.existsSync(path.join(companionDownloaded, 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(companionDownloaded, 'bin', 'archify-pr.mjs')), true);

    // Catch conflicting tracked assets instead of publishing an ambiguous index.
    assert.throws(() => stageSkillDistribution(repo, output), /collide/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('companion staging rejects a symlinked source directory', (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-companion-test-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const repoRoot = path.join(scratch, 'repo');
  const companion = path.join(repoRoot, 'archify-pr');
  fs.mkdirSync(repoRoot);
  fs.cpSync(path.join(repo, 'archify-pr'), companion, { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: repoRoot });
  execFileSync('git', ['add', '--', 'archify-pr'], { cwd: repoRoot });

  const bin = path.join(companion, 'bin');
  const movedBin = path.join(scratch, 'bin');
  fs.renameSync(bin, movedBin);
  fs.symlinkSync(movedBin, bin, process.platform === 'win32' ? 'junction' : 'dir');

  assert.throws(
    () => stageCleanCompanionSkill({ repoRoot, destination: path.join(scratch, 'staged') }),
    /refusing to package path through symlink: archify-pr\/bin/,
  );
});
