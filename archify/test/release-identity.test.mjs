import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const checker = path.join(repoRoot, 'scripts', 'check-release-identity.mjs');

function writeFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function runCheck(root) {
  return spawnSync(process.execPath, [checker, '--root', root], {
    encoding: 'utf8',
  });
}

function stableUpdateManifest(version) {
  return JSON.stringify({
    schemaVersion: 1,
    skillId: 'archify',
    channel: 'stable',
    version,
    publishedAt: '2026-07-29T00:00:00Z',
    source: {
      repository: 'https://github.com/tt-a1i/archify',
      ref: `v${version}`,
      treeSha: 'a'.repeat(40),
    },
    artifact: { sha256: 'b'.repeat(64) },
    summary: 'Published stable release.',
    releaseNotes: `https://github.com/tt-a1i/archify/releases/tag/v${version}`,
    severity: 'normal',
  });
}

function writeValidDevelopmentFixture(root, overrides = {}) {
  const version = '2.13.0-dev.0';
  const english = [
    '![Development Version](https://img.shields.io/badge/version-2.13.0--dev.0-blue)',
    '',
    `Current development version: \`v${version}\``,
    '',
    'Raven uses manual ZIP installation: extract archify.zip into `~/.raven/workspace/skills`, which yields `~/.raven/workspace/skills/archify`; Raven is not an agent-switcher target.',
  ].join('\n');
  const chinese = [
    '![开发版本](https://img.shields.io/badge/version-2.13.0--dev.0-blue)',
    '',
    `当前开发版本：\`v${version}\``,
    '',
    'Raven 使用 ZIP 手动安装：将 archify.zip 解压到 `~/.raven/workspace/skills`，解压后会得到 `~/.raven/workspace/skills/archify`；Raven 不属于 Agent 切换器目标。',
  ].join('\n');
  const files = {
    'archify/package.json': JSON.stringify({ version }),
    'archify/package-lock.json': JSON.stringify({ version, packages: { '': { version } } }),
    'archify/skill-release.json': JSON.stringify({
      schemaVersion: 1,
      skillId: 'archify',
      channel: 'development',
      version,
      source: { repository: 'https://github.com/tt-a1i/archify' },
      updateManifestUrl: 'https://tt-a1i.github.io/archify/skill-updates/archify/stable.json',
    }),
    'docs/skill-updates/archify/stable.json': stableUpdateManifest('2.12.0'),
    'archify/SKILL.md': '---\nmetadata:\n  version: "2.13"\n---\n',
    'archify/assets/template.html': '<meta name="generator" content="archify 2.13.0-dev.0">',
    'CHANGELOG.md': [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      `> Development identity: \`v${version}\`. Not a stable release.`,
      '',
      '### Added',
      '- Real unreleased work.',
      '',
      '## [2.12.0] — 2026-07-23',
      '',
    ].join('\n'),
    'README.md': english,
    'README_EN.md': english,
    'README_ZH.md': chinese,
    'scripts/start-template.html': 'development · 开发版 · [[ARCHIFY_VERSION]]',
    'scripts/guide-template.html': 'development · 开发版 · [[ARCHIFY_VERSION]]',
    'scripts/gallery-template.html': 'development · 开发版 · [[ARCHIFY_VERSION]]',
    'docs/index.html': `<span>development · v${version} · 开发版 · 9/9 checks</span><p>Raven manual ZIP / ZIP 手动安装: extract archify.zip into ~/.raven/workspace/skills, which yields ~/.raven/workspace/skills/archify; 将 archify.zip 解压到 ~/.raven/workspace/skills，解压后会得到 ~/.raven/workspace/skills/archify; not an agent-switcher target.</p>`,
    'docs/start.html': `<span>development · v${version} · 开发版</span><p>Raven manual ZIP / ZIP 手动安装: extract archify.zip into ~/.raven/workspace/skills, which yields ~/.raven/workspace/skills/archify; 将 archify.zip 解压到 ~/.raven/workspace/skills，解压后会得到 ~/.raven/workspace/skills/archify; not an agent-switcher target.</p>`,
    'ROADMAP.md': `The current development line is \`v${version}\`; it contains the work under Changelog Unreleased and is not a stable release.`,
  };
  for (const [relativePath, content] of Object.entries({ ...files, ...overrides })) {
    writeFile(root, relativePath, content);
  }
}

function writeValidStableFixture(root, overrides = {}) {
  const version = '2.13.0';
  const english = [
    '![Stable Version](https://img.shields.io/badge/version-2.13.0-blue)',
    '',
    `Current stable version: \`v${version}\``,
    '',
    'Raven uses manual ZIP installation: extract archify.zip into `~/.raven/workspace/skills`, which yields `~/.raven/workspace/skills/archify`; Raven is not an agent-switcher target.',
  ].join('\n');
  const chinese = [
    '![稳定版本](https://img.shields.io/badge/version-2.13.0-blue)',
    '',
    `当前稳定版本：\`v${version}\``,
    '',
    'Raven 使用 ZIP 手动安装：将 archify.zip 解压到 `~/.raven/workspace/skills`，解压后会得到 `~/.raven/workspace/skills/archify`；Raven 不属于 Agent 切换器目标。',
  ].join('\n');
  const files = {
    'archify/package.json': JSON.stringify({ version }),
    'archify/package-lock.json': JSON.stringify({ version, packages: { '': { version } } }),
    'archify/skill-release.json': JSON.stringify({
      schemaVersion: 1,
      skillId: 'archify',
      channel: 'stable',
      version,
      source: { repository: 'https://github.com/tt-a1i/archify' },
      updateManifestUrl: 'https://tt-a1i.github.io/archify/skill-updates/archify/stable.json',
    }),
    'docs/skill-updates/archify/stable.json': stableUpdateManifest(version),
    'archify/SKILL.md': '---\nmetadata:\n  version: "2.13"\n---\n',
    'archify/assets/template.html': '<meta name="generator" content="archify 2.13.0">',
    'CHANGELOG.md': [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '## [2.13.0] — 2026-07-29',
      '- Published work.',
      '',
    ].join('\n'),
    'README.md': english,
    'README_EN.md': english,
    'README_ZH.md': chinese,
    'scripts/start-template.html': 'stable · 稳定版 · [[ARCHIFY_VERSION]]',
    'scripts/guide-template.html': 'stable · 稳定版 · [[ARCHIFY_VERSION]]',
    'scripts/gallery-template.html': 'stable · 稳定版 · [[ARCHIFY_VERSION]]',
    'docs/index.html': `<span>stable · v${version} · 稳定版 · 9/9 checks</span><p>Raven manual ZIP / ZIP 手动安装: extract archify.zip into ~/.raven/workspace/skills, which yields ~/.raven/workspace/skills/archify; 将 archify.zip 解压到 ~/.raven/workspace/skills，解压后会得到 ~/.raven/workspace/skills/archify; not an agent-switcher target.</p>`,
    'docs/start.html': `<span>stable · v${version} · 稳定版</span><p>Raven manual ZIP / ZIP 手动安装: extract archify.zip into ~/.raven/workspace/skills, which yields ~/.raven/workspace/skills/archify; 将 archify.zip 解压到 ~/.raven/workspace/skills，解压后会得到 ~/.raven/workspace/skills/archify; not an agent-switcher target.</p>`,
    'ROADMAP.md': `The current stable version is \`v${version}\`.`,
  };
  for (const [relativePath, content] of Object.entries({ ...files, ...overrides })) {
    writeFile(root, relativePath, content);
  }
}

test('an empty Unreleased section accepts a coherent stable release identity', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
  try {
    writeValidStableFixture(fixture);

    const result = runCheck(fixture);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /release identity ok: 2\.13\.0/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('stable release preparation allows only the immediate prior public manifest', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
  try {
    const changelog = [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '## [2.13.0] — 2026-07-29',
      '- Release being prepared.',
      '',
      '## [2.12.0] — 2026-07-23',
      '- Previously published release.',
      '',
    ].join('\n');
    writeValidStableFixture(fixture, {
      'CHANGELOG.md': changelog,
      'docs/skill-updates/archify/stable.json': stableUpdateManifest('2.12.0'),
    });

    const prior = runCheck(fixture);
    assert.equal(prior.status, 0, prior.stderr);

    writeFile(fixture, 'docs/skill-updates/archify/stable.json', stableUpdateManifest('2.11.0'));
    const stale = runCheck(fixture);
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /immediate prior v2\.12\.0/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('the embedded update identity must match the package release exactly', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
  try {
    writeValidDevelopmentFixture(fixture, {
      'archify/skill-release.json': JSON.stringify({
        schemaVersion: 1,
        skillId: 'archify',
        channel: 'stable',
        version: '2.12.0',
        source: { repository: 'https://example.com/untrusted/archify' },
        updateManifestUrl: 'https://example.com/latest.json',
      }),
    });

    const result = runCheck(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /archify\/skill-release\.json must identify archify 2\.13\.0-dev\.0 as development/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('the published update manifest must track the newest stable changelog release', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
  try {
    writeValidDevelopmentFixture(fixture, {
      'docs/skill-updates/archify/stable.json': stableUpdateManifest('2.11.0'),
    });

    const result = runCheck(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /stable\.json must describe the newest published stable v2\.12\.0/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('the published update manifest must use a canonical UTC timestamp', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
  try {
    const manifest = JSON.parse(stableUpdateManifest('2.12.0'));
    manifest.publishedAt = '2026-07-29T08:00:00+08:00';
    writeValidDevelopmentFixture(fixture, {
      'docs/skill-updates/archify/stable.json': JSON.stringify(manifest),
    });

    const result = runCheck(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /stable\.json must describe the newest published stable v2\.12\.0/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('package identities reject leading-zero core and prerelease identifiers', () => {
  for (const version of ['02.13.0', '2.13.0-dev.01']) {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
    try {
      writeValidDevelopmentFixture(fixture, {
        'archify/package.json': JSON.stringify({ version }),
      });
      const result = runCheck(fixture);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /not a supported SemVer identity/, version);
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }
});

test('the newest stable release is selected by SemVer rather than changelog order', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
  try {
    writeValidDevelopmentFixture(fixture, {
      'CHANGELOG.md': [
        '# Changelog',
        '',
        '## [Unreleased]',
        '',
        '> Development identity: `v2.13.0-dev.0`. Not a stable release.',
        '',
        '### Added',
        '- Real unreleased work.',
        '',
        '## [2.11.0] — 2026-07-16',
        '',
        '## [2.12.0] — 2026-07-23',
        '',
      ].join('\n'),
    });

    const result = runCheck(fixture);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('real Unreleased changes cannot reuse a stable published package identity', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
  try {
    writeFile(fixture, 'archify/package.json', JSON.stringify({ version: '2.12.0' }));
    writeFile(fixture, 'CHANGELOG.md', [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      '- Real unreleased work.',
      '',
      '## [2.12.0] — 2026-07-23',
      '',
    ].join('\n'));

    const result = runCheck(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unreleased changes require a prerelease package version/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('package, lockfile, Skill metadata, escaped Shields badge, and public docs share one development identity', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
  try {
    writeFile(fixture, 'archify/package.json', JSON.stringify({ version: '2.13.0-dev.0' }));
    writeFile(fixture, 'archify/package-lock.json', JSON.stringify({
      version: '2.12.0',
      packages: { '': { version: '2.12.0' } },
    }));
    writeFile(fixture, 'archify/SKILL.md', '---\nmetadata:\n  version: "2.12"\n---\n');
    writeFile(fixture, 'CHANGELOG.md', [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '### Added',
      '- Real unreleased work.',
      '',
      '## [2.12.0] — 2026-07-23',
      '',
    ].join('\n'));
    const staleEnglish = [
      '![Version](https://img.shields.io/badge/version-2.13.0-blue)',
      '',
      'Archify 2.12 includes unreleased capabilities.',
    ].join('\n');
    writeFile(fixture, 'README.md', staleEnglish);
    writeFile(fixture, 'README_EN.md', staleEnglish);
    writeFile(fixture, 'README_ZH.md', '![Version](https://img.shields.io/badge/version-2.13.0-blue)\n\nArchify 2.12 包含未发布能力。\n');
    writeFile(fixture, 'docs/index.html', '<span>Agent Skill · v2.12.0</span>');
    writeFile(fixture, 'docs/start.html', '<span>Archify v2.12.0</span>');

    const result = runCheck(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /package-lock\.json must match 2\.13\.0-dev\.0/);
    assert.match(result.stderr, /SKILL\.md metadata version 2\.12 must map to package 2\.13\.0-dev\.0/);
    assert.match(result.stderr, /README\.md must advertise development identity v2\.13\.0-dev\.0/);
    assert.match(result.stderr, /docs\/index\.html must advertise development identity v2\.13\.0-dev\.0/);
    assert.match(result.stderr, /docs\/start\.html must advertise development identity v2\.13\.0-dev\.0/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('landing proof receipt matches the current nine-check artifact contract', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
  try {
    writeValidDevelopmentFixture(fixture, {
      'docs/index.html': '<span>development · v2.13.0-dev.0 · 开发版 · 8/8 checks</span><p>Raven manual ZIP / ZIP 手动安装: extract archify.zip into ~/.raven/workspace/skills, which yields ~/.raven/workspace/skills/archify; 将 archify.zip 解压到 ~/.raven/workspace/skills，解压后会得到 ~/.raven/workspace/skills/archify; not an agent-switcher target.</p>',
    });

    const result = runCheck(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /docs\/index\.html proof receipt must say 9\/9/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('landing rejects every stale N/N contract count even when 9/9 is also present', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
  try {
    writeValidDevelopmentFixture(fixture, {
      'docs/index.html': [
        '<span>development · v2.13.0-dev.0 · 开发版 · 9/9 checks</span>',
        '<span>legacy receipt · 7/7 checks</span>',
        '<p>Raven manual ZIP / ZIP 手动安装: extract archify.zip into ~/.raven/workspace/skills, which yields ~/.raven/workspace/skills/archify; 将 archify.zip 解压到 ~/.raven/workspace/skills，解压后会得到 ~/.raven/workspace/skills/archify; not an agent-switcher target.</p>',
      ].join('\n'),
    });

    const result = runCheck(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /every N\/N proof receipt must be exactly 9\/9; found 7\/7/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('Raven stays a truthful manual ZIP install and never becomes a generated agent-switcher command', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
  try {
    writeValidDevelopmentFixture(fixture, {
      'docs/start.html': [
        '<span>development · v2.13.0-dev.0 · 开发版</span>',
        '<button data-agent="raven">Raven</button>',
        '<pre>npx skills add tt-a1i/archify --agent raven</pre>',
      ].join('\n'),
    });

    const result = runCheck(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Raven must remain a manual ZIP installation outside the agent switcher/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('Raven instructions reject extracting the archive into the final Skill directory', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
  try {
    const nestedEnglish = [
      '![Development Version](https://img.shields.io/badge/version-2.13.0--dev.0-blue)',
      '',
      'Current development version: `v2.13.0-dev.0`',
      '',
      'Raven is manual ZIP only: extract archify.zip into `~/.raven/workspace/skills/archify`; Raven is not an agent-switcher target.',
    ].join('\n');
    writeValidDevelopmentFixture(fixture, {
      'README.md': nestedEnglish,
      'README_EN.md': nestedEnglish,
    });

    const result = runCheck(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /extract archify\.zip into ~\/\.raven\/workspace\/skills, yielding ~\/\.raven\/workspace\/skills\/archify/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('renderer template generator carries the complete package prerelease identity', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
  try {
    writeValidDevelopmentFixture(fixture, {
      'archify/assets/template.html': '<meta name="generator" content="archify 2.12.0">',
    });

    const result = runCheck(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /archify\/assets\/template\.html generator must be archify 2\.13\.0-dev\.0/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('roadmap current identity follows the package release state', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
  try {
    writeValidDevelopmentFixture(fixture, {
      'ROADMAP.md': 'The current development line is `v2.12.0`; it is not a stable release.',
    });

    const result = runCheck(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ROADMAP\.md must declare the current development line as v2\.13\.0-dev\.0/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('generated public-page templates keep a development marker and version placeholder', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-identity-'));
  try {
    writeValidDevelopmentFixture(fixture, {
      'scripts/gallery-template.html': 'Proof Lab / 2.12.0',
    });

    const result = runCheck(fixture);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /scripts\/gallery-template\.html must use \[\[ARCHIFY_VERSION\]\] with development and 开发版 labels/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
