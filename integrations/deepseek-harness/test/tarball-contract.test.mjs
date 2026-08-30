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
const DSH_RELEASE_REF = 'archify-dsh-v0.1.0';

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
      'skills/archify/SKILL.md',
      'skills/archify/bin/archify.mjs',
    ]) {
      assert.ok(files.includes(required), `tarball missing ${required}`);
    }
    const skillEntries = files.filter((file) => file === 'skills/archify/SKILL.md' || file.endsWith('/SKILL.md'));
    assert.deepEqual(skillEntries, ['skills/archify/SKILL.md']);
    for (const notifierFile of [
      'skills/archify/skill-release.json',
      'skills/archify/scripts/check-update.mjs',
      'skills/archify/scripts/update-contract.mjs',
    ]) {
      assert.equal(files.includes(notifierFile), false, `DSH 0.1.0 must not contain ${notifierFile}`);
    }
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

test('packed Skill payload remains byte-identical to the DSH 0.1.0 release tag', () => {
  const { scratch, out, result } = packTarball();
  try {
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    const packedRoot = path.join(scratch, 'packed');
    fs.mkdirSync(packedRoot);
    const tar = spawnSync('tar', ['-xzf', path.basename(out), '-C', packedRoot], {
      cwd: path.dirname(out),
      encoding: 'utf8',
    });
    assert.equal(tar.status, 0, tar.stderr);
    const skillRoot = path.join(packedRoot, 'package', 'skills', 'archify');
    const skillFiles = receipt.files
      .map((file) => file.path.replace(/^package\//, ''))
      .filter((file) => file.startsWith('skills/archify/'))
      .filter((file) => file !== 'skills/archify/package.json');
    for (const packagedPath of skillFiles) {
      const relative = packagedPath.slice('skills/archify/'.length);
      const tagged = spawnSync('git', [
        'show',
        `${DSH_RELEASE_REF}:archify/${relative}`,
      ], {
        cwd: repoRoot,
        encoding: null,
      });
      assert.equal(tagged.status, 0, tagged.stderr?.toString('utf8'));
      assert.deepEqual(
        fs.readFileSync(path.join(skillRoot, ...relative.split('/'))),
        tagged.stdout,
        `${packagedPath} differs from ${DSH_RELEASE_REF}`,
      );
    }
    const skillPackage = JSON.parse(fs.readFileSync(path.join(skillRoot, 'package.json'), 'utf8'));
    assert.equal(skillPackage.version, '2.14.0');
    assert.doesNotMatch(fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8'), /## Update awareness/);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
