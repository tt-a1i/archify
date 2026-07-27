import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../..');
const installer = path.join(repoRoot, 'scripts', 'install-raven.sh');
const archive = path.join(repoRoot, 'archify.zip');

test('Raven onboarding uses the repository-owned direct installer', () => {
  const english = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const chinese = fs.readFileSync(path.join(repoRoot, 'README_ZH.md'), 'utf8');

  for (const surface of [english, chinese]) {
    assert.match(surface, /Raven/);
    assert.match(surface, /scripts\/install-raven\.sh/);
    assert.doesNotMatch(surface, /--agent raven/);
  }
});

test('the direct installer copies the packaged skill into a Raven workspace', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-raven-onboarding-'));
  const workspace = path.join(root, 'workspace');

  try {
    const output = execFileSync(
      'bash',
      [installer, '--workspace', workspace, '--archive', archive],
      { encoding: 'utf8' }
    );
    const installed = path.join(workspace, 'skills', 'archify');

    assert.match(output, /Archify is ready\./);
    assert.match(output, /Archify installed for Raven:/);
    assert.equal(fs.existsSync(path.join(installed, 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(installed, 'bin', 'archify.mjs')), true);

    const doctor = execFileSync('node', [path.join(installed, 'bin', 'archify.mjs'), 'doctor'], {
      encoding: 'utf8',
    });
    assert.match(doctor, /Archify is ready\./);

    const secondInstall = spawnSync(
      'bash',
      [installer, '--workspace', workspace, '--archive', archive],
      { encoding: 'utf8' }
    );
    assert.notEqual(secondInstall.status, 0);
    assert.match(secondInstall.stderr, /Archify is already installed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
