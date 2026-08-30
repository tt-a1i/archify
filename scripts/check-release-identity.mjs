#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  compareSemver,
  isStableCoreVersion,
  parseSemver,
  validateLocalRelease,
  validateStableUpdateManifest,
} from '../archify/scripts/update-contract.mjs';

const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootFlag = process.argv.indexOf('--root');
const repoRoot = rootFlag === -1 ? scriptRoot : path.resolve(process.argv[rootFlag + 1] || '');
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  try {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
  } catch {
    fail(`${relativePath} is missing or unreadable.`);
    return '';
  }
}

function readJson(relativePath) {
  const source = read(relativePath);
  if (!source) return {};
  try {
    return JSON.parse(source);
  } catch {
    fail(`${relativePath} is not valid JSON.`);
    return {};
  }
}

function checkSkillRelease(value, version, isDevelopment) {
  const expectedChannel = isDevelopment ? 'development' : 'stable';
  try {
    const release = validateLocalRelease(value);
    if (release.version === version && release.channel === expectedChannel) return;
  } catch {
    // Report the repository-specific cross-artifact requirement below.
  }
  fail(`archify/skill-release.json must identify archify ${version} as ${expectedChannel}, use the official repository, and pin the trusted update manifest URL.`);
}

function checkStableUpdateManifest(value, expectedVersion, previousVersion, packageVersion, isDevelopment) {
  try {
    const manifest = validateStableUpdateManifest(value);
    const allowedVersions = isDevelopment
      ? [expectedVersion]
      : [expectedVersion, previousVersion].filter(Boolean);
    if (expectedVersion && allowedVersions.includes(manifest.version)
      && (isDevelopment || packageVersion === expectedVersion)) return;
  } catch {
    // Report the repository-specific cross-artifact requirement below.
  }
  const releaseWindow = !isDevelopment && previousVersion
    ? `newest stable v${expectedVersion} or immediate prior v${previousVersion} during the enforced post-Release publication window`
    : `newest published stable v${expectedVersion || '(missing)'}`;
  fail(`docs/skill-updates/archify/stable.json must describe the ${releaseWindow} with the fixed repository, immutable tree/archive digests, and official release-notes URL.`);
}

function shieldEscape(value) {
  return value.replaceAll('_', '__').replaceAll('-', '--');
}

function versionLabels(source) {
  return [...source.matchAll(/\bv(\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?)\b/g)]
    .map((match) => match[1]);
}

function checkReadme(relativePath, source, version, language, isDevelopment) {
  const badge = `/badge/version-${shieldEscape(version)}-`;
  const markerLabel = language === 'zh'
    ? isDevelopment ? '当前开发版本：' : '当前稳定版本：'
    : isDevelopment ? 'Current development version:' : 'Current stable version:';
  const identity = isDevelopment ? 'development' : 'stable';
  const hasMarker = source.split('\n').some((line) => line.includes(markerLabel) && line.includes(`\`v${version}\``));
  if (!source.includes(badge) || !hasMarker) {
    fail(`${relativePath} must advertise ${identity} identity v${version} with an exact escaped badge and explicit ${identity} marker.`);
  }
}

function checkDocument(relativePath, source, version, isDevelopment) {
  const labels = versionLabels(source);
  const identity = isDevelopment ? 'development' : 'stable';
  const englishLabel = isDevelopment ? /development/i : /stable/i;
  const chineseLabel = isDevelopment ? /开发版/ : /稳定版/;
  if (labels.length === 0 || labels.some((label) => label !== version)
    || !englishLabel.test(source) || !chineseLabel.test(source)) {
    fail(`${relativePath} must advertise ${identity} identity v${version} in both languages without a conflicting version alias.`);
  }
}

function checkRavenBoundary(relativePath, source, language) {
  const installParent = String.raw`~\/\.raven\/workspace\/skills`;
  const installedRoot = `${installParent}\/archify`;
  const pathBoundary = String.raw`(?=$|[\s\x60'"<>,.;:，；。])`;
  const hasEnglishManual = /manual ZIP/i.test(source);
  const hasChineseManual = /(?:手动[^\n<]{0,40}ZIP|ZIP[^\n<]{0,40}手动)/i.test(source);
  const hasRequiredCopy = language === 'both'
    ? hasEnglishManual && hasChineseManual
    : language === 'zh' ? hasChineseManual : hasEnglishManual;
  const englishExtractsIntoParent = new RegExp(
    String.raw`(?:extract|unpack)[^\n]{0,180}archify\.zip[^\n]{0,180}(?:into|to)\s*[\x60'"<]*${installParent}${pathBoundary}`,
    'i',
  ).test(source);
  const englishExplainsInstalledRoot = new RegExp(
    String.raw`(?:yields?|creates?|produces?|results? in)[^\n]{0,120}${installedRoot}`,
    'i',
  ).test(source);
  const chineseExtractsIntoParent = new RegExp(
    String.raw`archify\.zip[^\n]{0,100}解压(?:到|至)\s*[\x60'"<]*${installParent}${pathBoundary}`,
    'i',
  ).test(source);
  const chineseExplainsInstalledRoot = new RegExp(
    String.raw`(?:得到|生成|产生|最终位于)[^\n]{0,120}${installedRoot}`,
    'i',
  ).test(source);
  const hasCorrectDestination = language === 'both'
    ? englishExtractsIntoParent && englishExplainsInstalledRoot
      && chineseExtractsIntoParent && chineseExplainsInstalledRoot
    : language === 'zh'
      ? chineseExtractsIntoParent && chineseExplainsInstalledRoot
      : englishExtractsIntoParent && englishExplainsInstalledRoot;
  const nestedDestination = new RegExp(
    String.raw`(?:\b(?:extract|unpack)[^\n]{0,220}(?:into|to)|解压(?:到|至))\s*[\x60'"<]*${installedRoot}`,
    'i',
  ).test(source);
  const inventsSwitcher = /data-agent=["']raven["']/i.test(source)
    || /--agent\s+raven\b/i.test(source)
    || /[?&]agent=raven\b/i.test(source);
  if (!/Raven/i.test(source) || !hasRequiredCopy || !hasCorrectDestination
    || nestedDestination || inventsSwitcher) {
    fail(`${relativePath}: Raven must remain a manual ZIP installation outside the agent switcher: extract archify.zip into ~/.raven/workspace/skills, yielding ~/.raven/workspace/skills/archify.`);
  }
}

function checkIdentityTemplate(relativePath, source, isDevelopment) {
  const hasHardcodedVersion = /\b\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\b/.test(source);
  const identity = isDevelopment ? 'development and 开发版' : 'stable and 稳定版';
  const hasIdentity = isDevelopment
    ? /development/i.test(source) && /开发版/.test(source)
    : /stable/i.test(source) && /稳定版/.test(source);
  if (!source.includes('[[ARCHIFY_VERSION]]') || !hasIdentity || hasHardcodedVersion) {
    fail(`${relativePath} must use [[ARCHIFY_VERSION]] with ${identity} labels, never a hardcoded package version.`);
  }
}

function checkRoadmap(relativePath, source, version, isDevelopment) {
  const identity = isDevelopment ? 'development line' : 'stable version';
  const marker = `The current ${identity} is \`v${version}\``;
  if (!source.includes(marker)) {
    fail(`${relativePath} must declare the current ${identity} as v${version}.`);
  }
}

const packageJson = readJson('archify/package.json');
const changelog = read('CHANGELOG.md');
const unreleasedStart = changelog.search(/^## \[Unreleased\][^\n]*(?:\n|$)/m);
const afterUnreleased = unreleasedStart === -1
  ? ''
  : changelog.slice(unreleasedStart).replace(/^## \[Unreleased\][^\n]*(?:\n|$)/, '');
const nextRelease = afterUnreleased.search(/^## \[/m);
const unreleased = nextRelease === -1 ? afterUnreleased : afterUnreleased.slice(0, nextRelease);
const hasRealUnreleasedChanges = /^\s*-\s+\S/m.test(unreleased);
const version = packageJson.version;
let parsedVersion = null;
try {
  parsedVersion = parseSemver(version);
} catch {
  // The consolidated error below owns package-version policy reporting.
}
const supportedPrerelease = parsedVersion?.prerelease === null
  || (parsedVersion?.prerelease?.length === 2
    && parsedVersion.prerelease[0] === 'dev'
    && /^\d+$/.test(parsedVersion.prerelease[1]));
const hasSupportedVersion = Boolean(parsedVersion && parsedVersion.build === null && supportedPrerelease);
const isDevelopment = Boolean(hasSupportedVersion && parsedVersion.prerelease);
const publishedLabels = [...changelog.matchAll(/^## \[([^\]]+)\]/gm)]
  .map((match) => match[1])
  .filter((label) => label !== 'Unreleased');
for (const label of publishedLabels) {
  if (!isStableCoreVersion(label)) fail(`CHANGELOG published version is not stable SemVer: ${label}.`);
}
const stableLabels = publishedLabels
  .filter(isStableCoreVersion)
  .sort((left, right) => compareSemver(right, left));
const newestStableLabel = stableLabels[0] ?? null;
const previousStableLabel = stableLabels[1] ?? null;

if (!hasSupportedVersion) {
  fail(`package version is not a supported SemVer identity: ${JSON.stringify(version)}`);
} else if (hasRealUnreleasedChanges && !isDevelopment) {
  fail(`Unreleased changes require a prerelease package version; found stable ${version}.`);
}

if (hasSupportedVersion && hasRealUnreleasedChanges) {
  const currentCore = parsedVersion.core.join('.');
  if (newestStableLabel && compareSemver(currentCore, newestStableLabel) <= 0) {
    fail(`Unreleased package core ${currentCore} must be newer than published ${newestStableLabel}.`);
  }
}

if (hasSupportedVersion) {
  checkSkillRelease(readJson('archify/skill-release.json'), version, isDevelopment);
  checkStableUpdateManifest(
    readJson('docs/skill-updates/archify/stable.json'),
    newestStableLabel,
    previousStableLabel,
    version,
    isDevelopment,
  );

  const lock = readJson('archify/package-lock.json');
  if (lock.version !== version || lock.packages?.['']?.version !== version) {
    fail(`archify/package-lock.json must match ${version} at the root and packages[""].`);
  }

  const skill = read('archify/SKILL.md');
  const skillVersion = skill.match(/^\s*version:\s*["']?([^"'\s]+)["']?\s*$/m)?.[1];
  const expectedSkillVersion = `${parsedVersion.core[0]}.${parsedVersion.core[1]}`;
  if (skillVersion !== expectedSkillVersion) {
    fail(`archify/SKILL.md metadata version ${skillVersion || '(missing)'} must map to package ${version} as ${expectedSkillVersion}.`);
  }

  const rendererTemplate = read('archify/assets/template.html');
  const generatorVersions = [...rendererTemplate.matchAll(/<meta\s+name="generator"\s+content="archify\s+([^"]+)"\s*\/?>/g)]
    .map((match) => match[1]);
  if (generatorVersions.length !== 1 || generatorVersions[0] !== version) {
    fail(`archify/assets/template.html generator must be archify ${version}; found ${generatorVersions.join(', ') || '(missing)'}.`);
  }

  const english = read('README.md');
  const englishMirror = read('README_EN.md');
  const chinese = read('README_ZH.md');
  checkReadme('README.md', english, version, 'en', isDevelopment);
  checkReadme('README_EN.md', englishMirror, version, 'en', isDevelopment);
  checkReadme('README_ZH.md', chinese, version, 'zh', isDevelopment);
  checkRavenBoundary('README.md', english, 'en');
  checkRavenBoundary('README_EN.md', englishMirror, 'en');
  checkRavenBoundary('README_ZH.md', chinese, 'zh');
  if (english !== englishMirror) fail('README_EN.md must remain byte-identical to README.md.');

  if (newestStableLabel && isDevelopment) {
    const stableMinor = newestStableLabel.split('.').slice(0, 2).join('\\.');
    if (new RegExp(`Archify ${stableMinor} includes\\b`).test(english)
      || new RegExp(`Archify ${stableMinor} 已覆盖`).test(chinese)) {
      fail(`README capability summary must describe v${version} as development, not published ${newestStableLabel}.`);
    }
  }

  const landing = read('docs/index.html');
  checkDocument('docs/index.html', landing, version, isDevelopment);
  checkRavenBoundary('docs/index.html', landing, 'both');
  const proofCounts = [...landing.matchAll(/\b\d+\/\d+\b/g)].map((match) => match[0]);
  const staleProofCounts = [...new Set(proofCounts.filter((count) => count !== '9/9'))];
  if (proofCounts.length === 0 || staleProofCounts.length > 0) {
    const found = staleProofCounts.length > 0 ? `; found ${staleProofCounts.join(', ')}` : '';
    fail(`docs/index.html proof receipt must say 9/9 everywhere; every N/N proof receipt must be exactly 9/9${found}.`);
  }
  const start = read('docs/start.html');
  checkDocument('docs/start.html', start, version, isDevelopment);
  checkRavenBoundary('docs/start.html', start, 'both');
  checkRoadmap('ROADMAP.md', read('ROADMAP.md'), version, isDevelopment);

  for (const templatePath of [
    'scripts/start-template.html',
    'scripts/guide-template.html',
    'scripts/gallery-template.html',
  ]) {
    checkIdentityTemplate(templatePath, read(templatePath), isDevelopment);
  }

  const changelogMarker = `Development identity: \`v${version}\``;
  if (hasRealUnreleasedChanges && !unreleased.includes(changelogMarker)) {
    fail(`CHANGELOG.md Unreleased must declare ${changelogMarker}.`);
  }
}

if (failures.length > 0) {
  for (const message of failures) console.error(`release identity: ${message}`);
  process.exit(1);
}

console.log(`release identity ok: ${version}`);
