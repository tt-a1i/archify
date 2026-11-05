import { spawnSync, execFileSync } from 'node:child_process';
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
    let source = repoRoot;
    for (const segment of relative.split('/')) {
      source = path.join(source, segment);
      if (fs.lstatSync(source).isSymbolicLink()) throw new Error(`Fixture refuses source symlink: ${relative}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
  };
  // Exercise the real full-site publication hook and all locale routes while
  // replacing only the community registry. Do not copy arbitrary untracked files.
  const tracked = execFileSync('git', ['ls-files', '-z', '--',
    'website/src/', 'website/public/', 'website/astro.config.mjs', 'website/scripts/', 'website/package.json',
    'archify/package.json', 'archify/skill-release.json', 'archify/recipes/',
    'scripts/site-copy.mjs', 'scripts/check-community-packages.mjs',
    'docs/gallery/', 'docs/assets/', 'docs/cases/life/'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0').filter(Boolean);
  for (const relative of tracked) copy(relative);
  fs.symlinkSync(path.join(websiteRoot, 'node_modules'), path.join(root, 'website/node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const publicRoot = path.join(root, 'website/.public');
  fs.mkdirSync(publicRoot, { recursive: true });
  // Only the tracked public evidence/assets above enter the fixture output.
  // Production stage-public remains unchanged and keeps its own tracked-only gate.
  for (const relative of tracked.filter(file => file.startsWith('docs/') || file.startsWith('website/public/'))) {
    const prefix = relative.startsWith('docs/') ? 'docs/' : 'website/public/';
    const target = path.join(publicRoot, relative.slice(prefix.length));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(root, relative), target);
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
        env: { ...process.env, ARCHIFY_SITE_TARGET: 'github' },
      });
    },
    close() { fs.rmSync(root, { recursive: true, force: true }); },
  };
}
