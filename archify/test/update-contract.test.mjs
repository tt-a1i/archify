import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MANIFEST_URL,
  EXPECTED_REPOSITORY,
  SKILL_ID,
  UpdateContractError,
  compareSemver,
  isStableCoreVersion,
  releaseChannelForVersion,
  validateCanonicalUtcTimestamp,
  validateLocalRelease,
  validateStableUpdateManifest,
} from '../scripts/update-contract.mjs';

function localRelease(overrides = {}) {
  return {
    schemaVersion: 1,
    skillId: SKILL_ID,
    channel: 'stable',
    version: '2.16.0',
    source: { repository: EXPECTED_REPOSITORY },
    updateManifestUrl: DEFAULT_MANIFEST_URL,
    ...overrides,
  };
}

function stableManifest(overrides = {}) {
  return {
    schemaVersion: 1,
    skillId: SKILL_ID,
    channel: 'stable',
    version: '2.16.0',
    publishedAt: '2026-08-28T07:00:00Z',
    source: {
      repository: EXPECTED_REPOSITORY,
      ref: 'v2.16.0',
      treeSha: 'a'.repeat(40),
    },
    artifact: { sha256: 'b'.repeat(64) },
    summary: 'Contract fixture.',
    releaseNotes: 'https://github.com/tt-a1i/archify/releases/tag/v2.16.0',
    severity: 'normal',
    ...overrides,
  };
}

test('shared release constants identify the only trusted updater source', () => {
  assert.equal(SKILL_ID, 'archify');
  assert.equal(EXPECTED_REPOSITORY, 'https://github.com/tt-a1i/archify');
  assert.equal(
    DEFAULT_MANIFEST_URL,
    'https://tt-a1i.github.io/archify/skill-updates/archify/stable.json',
  );
});

test('SemVer precedence follows the complete prerelease ordering vector', () => {
  const ordered = [
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0',
  ];
  for (let index = 1; index < ordered.length; index += 1) {
    assert.equal(compareSemver(ordered[index - 1], ordered[index]), -1);
  }
  assert.equal(compareSemver('1.0.0+build.9', '1.0.0+build.1'), 0);
  assert.equal(compareSemver('9007199254740993.0.0', '9007199254740992.0.0'), 1);
  assert.throws(() => compareSemver('1.0.0-alpha.01', '1.0.0'), UpdateContractError);
});

test('release channels and stable manifest versions use distinct SemVer policies', () => {
  assert.equal(releaseChannelForVersion('2.16.0'), 'stable');
  assert.equal(releaseChannelForVersion('2.16.0+local.1'), 'stable');
  assert.equal(releaseChannelForVersion('2.16.0-dev.0'), 'development');
  assert.equal(isStableCoreVersion('2.16.0'), true);
  assert.equal(isStableCoreVersion('2.16.0+build.1'), false);
  assert.equal(isStableCoreVersion('2.16.0-dev.0'), false);
  assert.equal(isStableCoreVersion('02.16.0'), false);
});

test('local release identity is exact and channel-consistent', () => {
  assert.deepEqual(validateLocalRelease(localRelease()), localRelease());
  assert.deepEqual(validateLocalRelease(localRelease({
    channel: 'development',
    version: '2.17.0-dev.0',
  })), localRelease({
    channel: 'development',
    version: '2.17.0-dev.0',
  }));
  assert.throws(() => validateLocalRelease(localRelease({ extra: true })), UpdateContractError);
  assert.throws(() => validateLocalRelease(localRelease({
    source: { repository: EXPECTED_REPOSITORY, extra: true },
  })), UpdateContractError);
  assert.throws(() => validateLocalRelease(localRelease({ channel: 'development' })), UpdateContractError);
  assert.throws(() => validateLocalRelease(localRelease({ version: '02.16.0' })), UpdateContractError);
});

test('publication timestamps are canonical UTC seconds with real calendar dates', () => {
  assert.equal(validateCanonicalUtcTimestamp('2024-02-29T23:59:59Z'), '2024-02-29T23:59:59Z');
  for (const value of [
    '2026-08-28T15:00:00+08:00',
    '2026-08-28',
    '2026-02-30T00:00:00Z',
    '2026-08-28T00:00:00.000Z',
  ]) {
    assert.throws(() => validateCanonicalUtcTimestamp(value), UpdateContractError, value);
  }
});

test('stable manifests enforce one exact schema and canonical release identity', () => {
  assert.deepEqual(validateStableUpdateManifest(stableManifest()), stableManifest());
  const invalid = [
    stableManifest({ extra: true }),
    stableManifest({ version: '2.16.0+build.1' }),
    stableManifest({ publishedAt: '2026-08-28T15:00:00+08:00' }),
    stableManifest({ source: { ...stableManifest().source, extra: true } }),
    stableManifest({ artifact: { sha256: 'b'.repeat(64), extra: true } }),
    stableManifest({ summary: '\u202eunsafe' }),
    stableManifest({ severity: 'urgent' }),
    stableManifest({ releaseNotes: 'https://github.com:443/tt-a1i/archify/releases/tag/v2.16.0' }),
    stableManifest({ releaseNotes: 'https://github.com/tt-a1i/archify/releases/tag/v2.16.0?' }),
    stableManifest({ releaseNotes: 'https://GITHUB.COM/tt-a1i/archify/releases/tag/v2.16.0' }),
  ];
  for (const value of invalid) {
    assert.throws(() => validateStableUpdateManifest(value), UpdateContractError);
  }
});
