import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const integrationRoot = path.resolve(here, '..');
const repoRoot = path.resolve(integrationRoot, '..', '..');
const packScript = path.join(integrationRoot, 'scripts', 'pack.mjs');

const FORBIDDEN = [
  '/test/',
  'package-lock.json',
  '/node_modules/',
  '.hive',
  '.workbuddy',
  'probe-skills',
  'generate-brand-marks.mjs',
  'generate-validators.mjs',
  'distribution-acceptance',
];

function packTarball() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dsh-tarball-'));
  const out = path.join(scratch, 'tt-a1i-archify-dsh-0.1.0.tgz');
  const result = spawnSync(process.execPath, [packScript, '--out', out, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return { scratch, out, result };
}

test('pack command emits a real npm tarball with the expected identity and file list', () => {
  const { scratch, out, result } = packTarball();
  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.name, '@tt-a1i/archify-dsh');
    assert.equal(receipt.version, '0.1.0');
    assert.equal(fs.existsSync(out), true);
    const files = receipt.files.map((file) => file.path.replace(/^package\//, ''));
    for (const required of [
      'package.json',
      'cordis.patch.yml',
      'lib/index.js',
      'README.md',
      'LICENSE',
      '.dsh-bundled-skills/archify/SKILL.md',
      '.dsh-bundled-skills/archify/bin/archify.mjs',
    ]) {
      assert.ok(files.includes(required), `tarball missing ${required}`);
    }
    const skillEntries = files.filter((file) => file === '.dsh-bundled-skills/archify/SKILL.md' || file.endsWith('/SKILL.md'));
    assert.deepEqual(skillEntries, ['.dsh-bundled-skills/archify/SKILL.md']);
    for (const file of files) {
      for (const forbidden of FORBIDDEN) {
        assert.equal(file.includes(forbidden), false, `tarball contains forbidden ${file}`);
      }
    }
    assert.equal(files.some((file) => file.startsWith('test/')), false);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('packed Skill payload matches the checked-in static runtime projection', () => {
  const { scratch, out, result } = packTarball();
  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const packedRoot = path.join(scratch, 'packed');
    fs.mkdirSync(packedRoot);
    const tar = spawnSync('tar', ['-xzf', path.basename(out), '-C', packedRoot], {
      cwd: path.dirname(out),
      encoding: 'utf8',
    });
    assert.equal(tar.status, 0, tar.stderr);
    const diff = spawnSync('diff', [
      '-r',
      path.join(packedRoot, 'package', '.dsh-bundled-skills', 'archify'),
      path.join(integrationRoot, '.dsh-bundled-skills', 'archify'),
    ], { encoding: 'utf8' });
    assert.equal(diff.status, 0, diff.stdout || diff.stderr);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
