import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const manifest = JSON.parse(read('integrations/deepseek-harness/package.json'));
const release = JSON.parse(read('integrations/deepseek-harness/release.json'));
const published = Object.freeze({
  adapterVersion: '0.1.0',
  skillVersion: '2.14.0',
  dshVersion: '0.1.0-rc.6',
});
const candidate = Object.freeze({
  adapterVersion: manifest.version,
  skillVersion: release.skillVersion,
  dshVersion: release.dshVersion,
  sourceCommit: release.sourceCommit,
});

test('README.md and README_EN.md stay byte-identical after the DSH docs', () => {
  assert.equal(read('README.md'), read('README_EN.md'));
});

test('DSH documentation identifies the published release and pinned candidate snapshot', () => {
  const integration = read('integrations/deepseek-harness/README.md');
  assert.ok(integration.includes(`currently published npm package is **v${published.adapterVersion}**`));
  assert.ok(integration.includes(`@deepseek-ai/dsh@${published.dshVersion}`));
  assert.ok(integration.includes(`Archify Skill **${published.skillVersion}**`));
  assert.ok(integration.includes(`pending **v${candidate.adapterVersion}** release`));
  assert.ok(integration.includes(`Archify ${candidate.skillVersion}`));
  assert.ok(integration.includes(candidate.sourceCommit));
  assert.ok(integration.includes(`@deepseek-ai/dsh@${candidate.dshVersion}`));
  assert.match(integration, /not published or available as an npm install yet/);
  assert.match(integration, /not an Archify 2\.17 stable release/);
  assert.match(integration, /notification-only/);
  assert.match(integration, /does not update an already installed plugin/);
  assert.match(integration, /repository root is not a DSH package/);
  assert.match(integration, /current adapter Git HEAD blob/);
  assert.match(integration, /working-tree edits are not package inputs/);
});

test('English and Chinese docs cover install, invoke, uninstall, community wording, and Produced Files', () => {
  const englishRoot = read('README.md');
  const chineseRoot = read('README_ZH.md');
  const integration = read('integrations/deepseek-harness/README.md');
  const english = [englishRoot, integration].join('\n');
  const chinese = [chineseRoot, integration].join('\n');
  const publishedInstall = `dsh plugin --profile web add @tt-a1i/archify-dsh@${published.adapterVersion}`;
  const candidateInstall = `dsh plugin --profile web add @tt-a1i/archify-dsh@${candidate.adapterVersion}`;

  for (const source of [english, chinese, englishRoot, chineseRoot]) {
    assert.ok(source.includes(publishedInstall));
    assert.ok(!source.includes(candidateInstall));
    assert.ok(source.includes(`@deepseek-ai/dsh@${published.dshVersion}`));
    assert.ok(source.replaceAll('\\|', '|').includes(manifest.engines.node));
    assert.match(source, /dsh plugin --profile web remove @tt-a1i\/archify-dsh/);
    assert.match(source, /Use the archify skill to map this repository's runtime architecture/);
    assert.doesNotMatch(source, /dsh plugin[^\n]*github:tt-a1i\/archify/);
    assert.doesNotMatch(source, /allowBuilds:\s*true/);
    assert.doesNotMatch(source, /npm install github:/);
  }

  assert.match(english, /community integration/i);
  assert.match(english, /developer-preview/i);
  assert.match(english, /not an official DeepSeek/i);
  assert.match(english, /Produced Files/i);
  assert.match(english, /exact workspace paths/);
  assert.match(english, /no telemetry/i);

  assert.match(chinese, /社区集成/);
  assert.match(chinese, /开发者预览/);
  assert.match(chinese, /不是 DeepSeek 官方/);
  assert.match(chinese, /Produced Files/);
  assert.match(chinese, /精确工作区路径/);
  assert.match(chinese, /遥测/);
});

test('Skills CLI, Cursor, Codex, Claude Code, OpenCode, and Raven remain the default main path', () => {
  const english = read('README.md');
  const chinese = read('README_ZH.md');
  assert.match(english, /^```bash\nnpx skills add tt-a1i\/archify -g\n```$/m);
  assert.match(chinese, /^```bash\nnpx skills add tt-a1i\/archify -g\n```$/m);
  assert.match(english, /## Quick start/);
  assert.match(chinese, /## 快速开始/);
  const dshEnglishIndex = english.indexOf('DeepSeek Harness');
  const quickStartIndex = english.indexOf('## Quick start');
  assert.ok(dshEnglishIndex > quickStartIndex, 'DSH docs must not precede the default quick start');
});
