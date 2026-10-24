import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paste = 'Install Archify for me by reading https://raw.githubusercontent.com/tt-a1i/archify/main/llms.txt';
const cursorCommand = 'npx -y skills add tt-a1i/archify --skill archify --agent cursor --global --copy --yes';
const discovery = 'npx -y skills add tt-a1i/archify --list --full-depth';
const doctor = 'node <installed-path>/bin/archify.mjs doctor';

const readmes = [
  ['README.md', '## Quick start', '### 1. Install', 'Thanks to everyone who helped build Archify'],
  ['README_EN.md', '## Quick start', '### 1. Install', 'Thanks to everyone who helped build Archify'],
  ['README_ZH.md', '## 快速开始', '### 1. 安装', '感谢每一位参与构建 Archify 的人'],
  ['README_JA.md', '## クイックスタート', '### 1. インストール', 'Archify の開発を支えてくれたすべての人に感謝します'],
  ['README_KO.md', '## 빠른 시작', '### 1. 설치', 'Archify를 함께 만들어 준 모든 분께 감사합니다'],
];

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function switcherAgents() {
  const start = read('docs/start.html');
  const known = start.match(/KNOWN_AGENTS = new Set\(\[([^\]]+)\]\)/);
  assert.ok(known, 'start page must name its switcher agents');
  return [...known[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

function withoutDetails(markdown) {
  return markdown.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
}

test('llms.txt states the package version and the bounded install', () => {
  const version = JSON.parse(read('archify/package.json')).version;
  const root = read('llms.txt');
  const site = read('docs/llms.txt');
  assert.equal(site, root);
  assert.match(root, new RegExp(`^Version: ${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'));
  assert.match(root, /https:\/\/github\.com\/tt-a1i\/archify/);
  assert.match(root, /https:\/\/archify\.si/);
  assert.match(root, /confirm the scope before you install/i);
  assert.match(root, /exactly one skill named `archify`/);
  assert.match(root, new RegExp(discovery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(root, /--skill archify --agent <agent> --global --copy --yes/);
  assert.match(root, /unmanaged files/);
  assert.match(root, new RegExp(doctor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(root, /ten diagram types/i);
  assert.match(root, /one-page explainer/i);
  for (const agent of switcherAgents()) assert.match(root, new RegExp(`\\b${agent}\\b`));
  assert.ok(root.length < 4000, 'llms.txt should stay a bounded agent brief');
});

test('localized quick starts show the agent prompt and non-interactive flags', () => {
  const agents = switcherAgents();
  const multi = `npx -y skills add tt-a1i/archify --skill archify ${agents.map((agent) => `--agent ${agent}`).join(' ')} --global --copy --yes`;
  const wall = 'https://raw.githubusercontent.com/tt-a1i/archify/contributors/contributors.svg';
  const graph = 'https://github.com/tt-a1i/archify/graphs/contributors';

  for (const [filename, quickStart, installHeading, thanks] of readmes) {
    const readme = read(filename);
    const quickAt = readme.indexOf(quickStart);
    const installAt = readme.indexOf(installHeading, quickAt);
    const nextHeading = readme.indexOf('\n### ', installAt + installHeading.length);
    const installSection = withoutDetails(readme.slice(installAt, nextHeading === -1 ? undefined : nextHeading));
    assert.ok(quickAt >= 0 && installAt > quickAt, `${filename}: install section must sit in Quick Start`);
    assert.ok(installSection.includes(paste), `${filename}: agent paste prompt is missing from Quick Start`);
    assert.ok(installSection.includes(cursorCommand), `${filename}: current-agent install must stay outside the collapsed details`);
    assert.ok(installSection.includes(multi), `${filename}: multi-agent install must list every switcher target`);
    const stars = readme.lastIndexOf('## Star History');
    const wallAt = readme.indexOf(wall);
    assert.ok(wallAt > installAt && wallAt < stars, `${filename}: contributors wall must precede Star History`);
    assert.ok(readme.includes(graph), `${filename}: contributors graph link is missing`);
    assert.ok(readme.includes(thanks), `${filename}: thank-you line is missing`);
  }
});
