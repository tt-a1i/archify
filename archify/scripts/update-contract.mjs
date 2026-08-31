export const SKILL_ID = 'archify';
export const EXPECTED_REPOSITORY = 'https://github.com/tt-a1i/archify';
export const DEFAULT_MANIFEST_URL = 'https://tt-a1i.github.io/archify/skill-updates/archify/stable.json';

const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

export class UpdateContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UpdateContractError';
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return isPlainObject(value)
    && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

export function parseSemver(value) {
  if (typeof value !== 'string' || value.length > 128) {
    throw new UpdateContractError(`invalid SemVer: ${JSON.stringify(value)}`);
  }
  const match = SEMVER.exec(value);
  if (!match) throw new UpdateContractError(`invalid SemVer: ${JSON.stringify(value)}`);
  const prerelease = match[4]?.split('.') ?? null;
  if (prerelease?.some((identifier) => /^\d+$/.test(identifier)
    && identifier.length > 1 && identifier.startsWith('0'))) {
    throw new UpdateContractError(`invalid SemVer: ${JSON.stringify(value)}`);
  }
  return {
    core: match.slice(1, 4),
    prerelease,
    build: match[5]?.split('.') ?? null,
  };
}

function compareNumericIdentifiers(left, right) {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

function comparePrerelease(left, right) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    if (left[index] === right[index]) continue;
    const leftNumeric = /^\d+$/.test(left[index]);
    const rightNumeric = /^\d+$/.test(right[index]);
    if (leftNumeric && rightNumeric) return compareNumericIdentifiers(left[index], right[index]);
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left[index] < right[index] ? -1 : 1;
  }
  return 0;
}

export function compareSemver(leftValue, rightValue) {
  const left = parseSemver(leftValue);
  const right = parseSemver(rightValue);
  for (let index = 0; index < left.core.length; index += 1) {
    const comparison = compareNumericIdentifiers(left.core[index], right.core[index]);
    if (comparison !== 0) return comparison;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

export function releaseChannelForVersion(value) {
  return parseSemver(value).prerelease ? 'development' : 'stable';
}

export function isStableCoreVersion(value) {
  try {
    const parsed = parseSemver(value);
    return parsed.prerelease === null && parsed.build === null;
  } catch {
    return false;
  }
}

export function validateCanonicalUtcTimestamp(value) {
  if (typeof value !== 'string' || !UTC_SECONDS.test(value)) {
    throw new UpdateContractError('publication time must use YYYY-MM-DDTHH:mm:ssZ');
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)
    || new Date(timestamp).toISOString().replace('.000Z', 'Z') !== value) {
    throw new UpdateContractError('publication time is not a real UTC calendar instant');
  }
  return value;
}

export function validateLocalRelease(value) {
  if (!hasExactKeys(value, [
    'schemaVersion', 'skillId', 'channel', 'version', 'source', 'updateManifestUrl',
  ])
    || value.schemaVersion !== 1
    || value.skillId !== SKILL_ID
    || !hasExactKeys(value.source, ['repository'])
    || value.source.repository !== EXPECTED_REPOSITORY
    || value.updateManifestUrl !== DEFAULT_MANIFEST_URL) {
    throw new UpdateContractError('invalid local release identity');
  }
  const expectedChannel = releaseChannelForVersion(value.version);
  if (value.channel !== expectedChannel) {
    throw new UpdateContractError('local release channel does not match its version');
  }
  return {
    schemaVersion: value.schemaVersion,
    skillId: value.skillId,
    channel: value.channel,
    version: value.version,
    source: { repository: value.source.repository },
    updateManifestUrl: value.updateManifestUrl,
  };
}

export function validateReleaseNotesUrl(value, version) {
  if (!isStableCoreVersion(version)) {
    throw new UpdateContractError('release notes require a stable core version');
  }
  const expected = `https://github.com/tt-a1i/archify/releases/tag/v${version}`;
  if (value !== expected) {
    throw new UpdateContractError('release notes URL is outside the exact trusted release path');
  }
  return value;
}

export function validateStableUpdateManifest(value) {
  if (!hasExactKeys(value, [
    'schemaVersion', 'skillId', 'channel', 'version', 'publishedAt', 'source',
    'artifact', 'summary', 'releaseNotes', 'severity',
  ])
    || value.schemaVersion !== 1
    || value.skillId !== SKILL_ID
    || value.channel !== 'stable'
    || !isStableCoreVersion(value.version)
    || !hasExactKeys(value.source, ['repository', 'ref', 'treeSha'])
    || value.source.repository !== EXPECTED_REPOSITORY
    || value.source.ref !== `v${value.version}`
    || !HEX_40.test(value.source.treeSha)
    || !hasExactKeys(value.artifact, ['sha256'])
    || !HEX_64.test(value.artifact.sha256)) {
    throw new UpdateContractError('invalid immutable stable release identity');
  }
  validateCanonicalUtcTimestamp(value.publishedAt);
  if (typeof value.summary !== 'string' || value.summary.length < 1 || value.summary.length > 160
    || CONTROL_OR_BIDI.test(value.summary)) {
    throw new UpdateContractError('invalid release summary');
  }
  validateReleaseNotesUrl(value.releaseNotes, value.version);
  if (!['normal', 'security'].includes(value.severity)) {
    throw new UpdateContractError('invalid update severity');
  }
  return {
    schemaVersion: value.schemaVersion,
    skillId: value.skillId,
    channel: value.channel,
    version: value.version,
    publishedAt: value.publishedAt,
    source: {
      repository: value.source.repository,
      ref: value.source.ref,
      treeSha: value.source.treeSha,
    },
    artifact: { sha256: value.artifact.sha256 },
    summary: value.summary,
    releaseNotes: value.releaseNotes,
    severity: value.severity,
  };
}
