import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const checker = path.join(repoRoot, 'scripts', 'check-stable-update-manifest.mjs');

function git(root, args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

function annotatedTaggerTime(root, tag) {
  const result = git(root, [
    'for-each-ref',
    '--format=%(taggerdate:unix)',
    `refs/tags/${tag}`,
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout.trim(), /^\d+$/);
  return new Date(Number(result.stdout.trim()) * 1_000)
    .toISOString()
    .replace('.000Z', 'Z');
}

function writeJson(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`);
}

function runCheck(root, archive, extraArguments = []) {
  return spawnSync(process.execPath, [
    checker,
    '--root', root,
    '--archive', archive,
    '--tag', 'v3.0.0',
    ...extraArguments,
  ], { encoding: 'utf8' });
}

test('stable release gate binds manifest tag, tree, and final archive digest', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-stable-manifest-'));
  try {
    writeJson(path.join(fixture, 'archify', 'package.json'), { version: '3.0.0' });
    fs.writeFileSync(path.join(fixture, 'archify', 'SKILL.md'), 'stable fixture\n');
    assert.equal(git(fixture, ['init']).status, 0);
    assert.equal(git(fixture, ['add', 'archify']).status, 0);
    assert.equal(git(fixture, [
      '-c', 'user.name=Archify Test',
      '-c', 'user.email=archify@example.invalid',
      'commit', '-m', 'stable fixture',
    ]).status, 0);
    assert.equal(git(fixture, [
      '-c', 'user.name=Archify Test',
      '-c', 'user.email=archify@example.invalid',
      'tag', '-a', 'v3.0.0', '-m', 'stable v3.0.0',
    ]).status, 0);
    const publishedAt = annotatedTaggerTime(fixture, 'v3.0.0');
    const tree = git(fixture, ['rev-parse', 'HEAD:archify']);
    assert.equal(tree.status, 0, tree.stderr);
    const treeSha = tree.stdout.trim();
    const archive = path.join(fixture, 'archify.zip');
    const archiveBytes = Buffer.from('deterministic stable archive fixture');
    fs.writeFileSync(archive, archiveBytes);
    const artifactSha = crypto.createHash('sha256').update(archiveBytes).digest('hex');
    const manifestPath = path.join(fixture, 'docs', 'skill-updates', 'archify', 'stable.json');
    const manifest = {
      schemaVersion: 1,
      skillId: 'archify',
      channel: 'stable',
      version: '3.0.0',
      publishedAt,
      source: {
        repository: 'https://github.com/tt-a1i/archify',
        ref: 'v3.0.0',
        treeSha,
      },
      artifact: { sha256: artifactSha },
      summary: 'Stable release fixture.',
      releaseNotes: 'https://github.com/tt-a1i/archify/releases/tag/v3.0.0',
      severity: 'normal',
    };
    writeJson(manifestPath, manifest);

    const passing = runCheck(fixture, archive);
    assert.equal(passing.status, 0, passing.stderr);
    assert.match(passing.stdout, /stable update manifest ok: v3\.0\.0/);

    writeJson(path.join(fixture, 'archify', 'package.json'), { version: '4.0.0-dev.0' });
    const historicalRelease = runCheck(fixture, archive, ['--source-ref', 'v3.0.0']);
    assert.equal(historicalRelease.status, 0, historicalRelease.stderr);
    const wrongHistoricalRef = runCheck(fixture, archive, ['--source-ref', 'v2.9.0']);
    assert.notEqual(wrongHistoricalRef.status, 0);
    assert.match(wrongHistoricalRef.stderr, /--source-ref must be HEAD or the exact release tag/);
    writeJson(path.join(fixture, 'archify', 'package.json'), { version: '3.0.0' });

    writeJson(manifestPath, {
      ...manifest,
      publishedAt: '2026-08-28T08:00:00+08:00',
    });
    const nonUtcTimestamp = runCheck(fixture, archive);
    assert.notEqual(nonUtcTimestamp.status, 0);
    assert.match(nonUtcTimestamp.stderr, /stable update manifest identity/);
    writeJson(manifestPath, manifest);

    writeJson(manifestPath, {
      ...manifest,
      publishedAt: new Date(Date.parse(publishedAt) + 1_000)
        .toISOString()
        .replace('.000Z', 'Z'),
    });
    const wrongTaggerTime = runCheck(fixture, archive);
    assert.notEqual(wrongTaggerTime.status, 0);
    assert.match(wrongTaggerTime.stderr, /publishedAt .* annotated tagger time/);
    writeJson(manifestPath, manifest);

    const invalidContracts = [
      { ...manifest, extra: true },
      { ...manifest, source: { ...manifest.source, extra: true } },
      { ...manifest, artifact: { ...manifest.artifact, extra: true } },
      { ...manifest, summary: '\u202eunsafe' },
      { ...manifest, severity: 'urgent' },
    ];
    for (const invalid of invalidContracts) {
      writeJson(manifestPath, invalid);
      const rejected = runCheck(fixture, archive);
      assert.notEqual(rejected.status, 0);
      assert.match(rejected.stderr, /stable update manifest identity/);
    }
    writeJson(manifestPath, manifest);

    writeJson(manifestPath, null);
    const nullManifest = runCheck(fixture, archive);
    assert.notEqual(nullManifest.status, 0);
    assert.match(nullManifest.stderr, /stable update manifest identity/);
    assert.doesNotMatch(nullManifest.stderr, /TypeError|check-stable-update-manifest\.mjs:\d+/);
    writeJson(manifestPath, manifest);

    fs.appendFileSync(archive, 'tampered');
    const archiveMismatch = runCheck(fixture, archive);
    assert.notEqual(archiveMismatch.status, 0);
    assert.match(archiveMismatch.stderr, /archive sha256 .* does not match/);

    fs.writeFileSync(archive, archiveBytes);
    writeJson(manifestPath, {
      ...manifest,
      source: { ...manifest.source, treeSha: 'c'.repeat(40) },
    });
    const treeMismatch = runCheck(fixture, archive);
    assert.notEqual(treeMismatch.status, 0);
    assert.match(treeMismatch.stderr, /treeSha .* does not match HEAD:archify/);

    writeJson(manifestPath, manifest);
    assert.equal(git(fixture, ['tag', '-d', 'v3.0.0']).status, 0);
    assert.equal(git(fixture, ['tag', 'v3.0.0']).status, 0);
    const lightweightTag = runCheck(fixture, archive);
    assert.notEqual(lightweightTag.status, 0);
    assert.match(lightweightTag.stderr, /must be an annotated tag/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
