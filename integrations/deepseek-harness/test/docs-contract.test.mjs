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
  adapterVersion: '1.0.0',
  skillVersion: '3.0.1',
  dshVersion: '0.1.2-rc.1',
});
const bundled = Object.freeze({
  adapterVersion: manifest.version,
  skillVersion: release.skillVersion,
  dshVersion: release.dshVersion,
  sourceCommit: release.sourceCommit,
});

test('README.md and README_EN.md stay byte-identical after the DSH docs', () => {
  assert.equal(read('README.md'), read('README_EN.md'));
});

test('DSH documentation identifies the published release and its pinned snapshot', () => {
  const integration = read('integrations/deepseek-harness/README.md');
  assert.ok(integration.includes(`currently published npm package is **v${published.adapterVersion}**`));
  assert.ok(integration.includes(`@deepseek-ai/dsh@${published.dshVersion}`));
  assert.ok(integration.includes(`Archify Skill **${published.skillVersion}**`));
  assert.equal(bundled.adapterVersion, published.adapterVersion);
  assert.equal(bundled.skillVersion, published.skillVersion);
  assert.equal(bundled.dshVersion, published.dshVersion);
  assert.ok(integration.includes(`Archify ${bundled.skillVersion}`));
  assert.ok(integration.includes(bundled.sourceCommit));
  assert.ok(integration.includes(`@deepseek-ai/dsh@${bundled.dshVersion}`));
  assert.doesNotMatch(integration, /not published or available as an npm install yet|pending \*\*v1\.0\.0/);
  assert.ok(integration.includes(`releases/tag/archify-dsh-v${published.adapterVersion}`));
  assert.match(integration, /pinned to stable `main` commit/);
  assert.match(integration, /landed after the `v3\.0\.1` tag/);
  assert.match(integration, /not a byte-for-byte copy of that tag/);
  assert.match(integration, /notification-only/);
  assert.match(integration, /does not update an already installed plugin/);
  assert.match(integration, /repository root is not a DSH package/);
  assert.match(integration, /current adapter Git HEAD blob/);
  assert.match(integration, /working-tree edits are not package inputs/);
  assert.match(integration, /`cordis\.patch\.yml` file is configuration consumed by the DSH host/);
  assert.match(integration, /`!!js` expression to resolve the installed package's `skills` directory/);
  assert.match(integration, /runs in the DSH host process, outside the agent sandbox/);
  assert.match(integration, /does not fetch data, read credentials, spawn processes, or register another permission path/);
  assert.match(integration, /`!!js` expression that DSH evaluates during host activation/);
  assert.match(integration, /locating its packaged `skills` directory/);
  assert.match(integration, /rather than entirely declarative data/);
});

test('English, Chinese, and Japanese docs cover install, invoke, uninstall, community wording, and Produced Files', () => {
  const englishRoot = read('README.md');
  const chineseRoot = read('README_ZH.md');
  const japaneseRoot = read('README_JA.md');
  const integration = read('integrations/deepseek-harness/README.md');
  const english = [englishRoot, integration].join('\n');
  const chinese = [chineseRoot, integration].join('\n');
  const japanese = [japaneseRoot, integration].join('\n');
  const publishedInstall = `dsh plugin --profile web add @tt-a1i/archify-dsh@${published.adapterVersion}`;

  for (const source of [english, chinese, japanese, englishRoot, chineseRoot, japaneseRoot]) {
    assert.ok(source.includes(publishedInstall));
    assert.ok(!source.includes('dsh plugin --profile web add @tt-a1i/archify-dsh@0.1.0'));
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

  assert.match(japanese, /コミュニティ統合/);
  assert.match(japanese, /開発者プレビュー/);
  assert.match(japanese, /DeepSeek 公式製品ではなく/);
  assert.match(japanese, /Produced Files/);
  assert.match(japanese, /正確なワークスペースパス/);
  assert.match(japanese, /テレメトリ/);
});

test('Skills CLI, Cursor, Codex, Claude Code, OpenCode, and Raven remain the default main path', () => {
  const english = read('README.md');
  const chinese = read('README_ZH.md');
  const japanese = read('README_JA.md');
  assert.match(english, /^```bash\nnpx skills add tt-a1i\/archify -g\n```$/m);
  assert.match(chinese, /^```bash\nnpx skills add tt-a1i\/archify -g\n```$/m);
  assert.match(japanese, /^```bash\nnpx skills add tt-a1i\/archify -g\n```$/m);
  assert.match(english, /## Quick start/);
  assert.match(chinese, /## 快速开始/);
  assert.match(japanese, /## クイックスタート/);
  const dshEnglishIndex = english.indexOf('DeepSeek Harness');
  const quickStartIndex = english.indexOf('## Quick start');
  assert.ok(dshEnglishIndex > quickStartIndex, 'DSH docs must not precede the default quick start');
});

test('npm README describes the packaged version independently of publication status', () => {
  const packaged = read('integrations/deepseek-harness/PACKAGE_README.md');
  assert.ok(packaged.includes(`@tt-a1i/archify-dsh@${bundled.adapterVersion}`));
  assert.ok(packaged.includes(`Archify ${bundled.skillVersion}`));
  assert.ok(packaged.includes(`@deepseek-ai/dsh@${bundled.dshVersion}`));
  assert.ok(packaged.includes(bundled.sourceCommit));
  assert.ok(packaged.includes(manifest.engines.node));
  assert.doesNotMatch(packaged, /currently published npm package|not published or available as an npm install yet/);
  assert.match(packaged, /After this version is available in the npm registry/);
  assert.match(packaged, /outside the agent sandbox/);
});
