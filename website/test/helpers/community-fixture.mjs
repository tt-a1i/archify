import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const websiteRoot = fileURLToPath(new URL('../../', import.meta.url));
const repoRoot = path.resolve(websiteRoot, '..');
export const payload = '<svg onload="document.documentElement.dataset.communityAudit=1"></svg>';

export function createCommunityFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-community-build-'));
  const copy = relative => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(repoRoot, relative), target, { recursive: true });
  };
  // Compile the actual page, loader, validator and language script, without
  // modifying the checked-out registry or running any community package code.
  for (const relative of ['website/src', 'website/astro.config.mjs', 'website/package.json',
    'archify/package.json', 'archify/recipes', 'scripts/site-copy.mjs',
    'scripts/check-community-packages.mjs', 'docs/gallery/manifest.json']) copy(relative);
  const pages = path.join(root, 'website/src/pages');
  for (const file of fs.readdirSync(pages)) {
    if (file !== 'community.astro') fs.rmSync(path.join(pages, file), { recursive: true });
  }
  fs.symlinkSync(path.join(websiteRoot, 'node_modules'), path.join(root, 'website/node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const assets = path.join(root, 'website/.public/assets');
  fs.mkdirSync(assets, { recursive: true });
  for (const file of ['site-language.js', 'site-navigation.css', 'archify-lockup-light.svg', 'archify-mark.svg']) {
    fs.copyFileSync(path.join(repoRoot, 'docs/assets', file), path.join(assets, file));
  }
  const registry = path.join(root, 'community/packages');
  fs.mkdirSync(registry, { recursive: true });
  const entry = {
    name: 'security-demo', type: 'skill',
    summary: { en: payload, zh: `测试 ${payload}` },
    author: { name: 'demo' }, repository: 'https://example.com/source',
    archify: '3.0.1', schemaVersions: [1],
    evidence: [{ label: payload, url: 'https://example.com/receipt' }, { label: 'Example HTML', url: 'https://example.com/example' }],
  };
  const write = value => fs.writeFileSync(path.join(registry, 'security-demo.json'), JSON.stringify(value));
  write(entry);
  return {
    root, entry, write, dist: path.join(root, 'website/dist'),
    build() {
      fs.rmSync(path.join(root, 'website/dist'), { recursive: true, force: true });
      return spawnSync(process.execPath, [path.join(websiteRoot, 'node_modules/astro/bin/astro.mjs'), 'build'], {
        cwd: path.join(root, 'website'), encoding: 'utf8', timeout: 60000,
      });
    },
    close() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}
