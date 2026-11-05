import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { stageSkillDistribution } from '../scripts/stage-skill-distribution.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
test('discovery archive preserves every canonical package file without its wrapper', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-discovery-test-'));
  try {
    const output = path.join(scratch, 'public');
    stageSkillDistribution(repo, output);
    const indexPath = path.join(output, '.well-known/agent-skills/index.json');
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    assert.equal(index.$schema, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json');
    assert.equal(index.skills.length, 1);
    const [entry] = index.skills;
    assert.equal(entry.name, 'archify');
    assert.equal(entry.type, 'archive');
    const archive = fileURLToPath(new URL(entry.url, pathToFileURL(indexPath)));
    assert.equal(entry.digest, `sha256:${createHash('sha256').update(fs.readFileSync(archive)).digest('hex')}`);
    const original = path.join(scratch, 'canonical');
    const downloaded = path.join(scratch, 'downloaded');
    for (const [zip, destination] of [[path.join(repo, 'archify.zip'), original], [archive, downloaded]]) {
      fs.mkdirSync(destination, { recursive: true });
      if (process.platform === 'win32') execFileSync('tar', ['-xf', zip, '-C', destination]);
      else execFileSync('unzip', ['-q', zip, '-d', destination]);
    }
    const inventory = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() ? inventory(path.join(dir, entry.name)).map(name => `${entry.name}/${name}`) : [entry.name]).sort();
    const expected = path.join(original, 'archify');
    assert.deepEqual(inventory(downloaded), inventory(expected));
    for (const name of inventory(expected)) {
      assert.deepEqual(fs.readFileSync(path.join(downloaded, name)), fs.readFileSync(path.join(expected, name)), name);
    }
    assert.equal(fs.existsSync(path.join(downloaded, 'SKILL.md')), true);
    // Catch conflicting tracked assets instead of publishing an ambiguous index.
    assert.throws(() => stageSkillDistribution(repo, output), /collide/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
