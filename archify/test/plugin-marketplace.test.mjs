import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function json(relativePath) {
  return JSON.parse(read(relativePath));
}

test('Claude, Grok, and Codex marketplaces point at the same skill package', () => {
  const claude = json('.claude-plugin/marketplace.json');
  const grok = json('.grok-plugin/marketplace.json');
  const codex = json('.agents/plugins/marketplace.json');
  const pkg = json('archify/package.json');

  assert.equal(claude.name, 'archify');
  assert.equal(grok.name, 'archify');
  assert.equal(codex.name, 'archify');
  assert.equal(claude.plugins.length, 1);
  assert.equal(grok.plugins.length, 1);
  assert.equal(codex.plugins.length, 1);
  assert.equal(claude.plugins[0].name, 'archify');
  assert.equal(grok.plugins[0].name, 'archify');
  assert.equal(codex.plugins[0].name, 'archify');
  assert.equal(claude.plugins[0].source, './archify');
  assert.deepEqual(grok.plugins[0].source, { type: 'local', path: './archify' });
  assert.deepEqual(codex.plugins[0].source, { source: 'local', path: './archify' });
  assert.equal(claude.plugins[0].version, pkg.version);
  assert.equal(grok.plugins[0].version, pkg.version);
});

test('host plugin manifests stay lockstep with the renderer package', () => {
  const pkg = json('archify/package.json');
  const claude = json('archify/.claude-plugin/plugin.json');
  const grok = json('archify/plugin.json');
  const codex = json('archify/.codex-plugin/plugin.json');

  assert.equal(claude.name, 'archify');
  assert.equal(grok.name, 'archify');
  assert.equal(codex.name, 'archify');
  assert.equal(claude.version, pkg.version);
  assert.equal(grok.version, pkg.version);
  assert.equal(codex.version, pkg.version);
  assert.equal(claude.license, 'MIT');
  assert.equal(grok.license, 'MIT');
  assert.equal(codex.license, 'MIT');
  assert.equal(grok.skills, undefined);
  assert.equal(codex.skills, './skills/');
});

test('hosts discover one skill package without a Grok agents/ leaf', () => {
  const hosted = path.join(skillRoot, 'skills', 'archify');
  assert.equal(fs.lstatSync(path.join(hosted, 'SKILL.md')).isSymbolicLink(), true);
  assert.equal(fs.realpathSync(path.join(hosted, 'SKILL.md')), path.join(skillRoot, 'SKILL.md'));
  assert.equal(fs.realpathSync(path.join(hosted, 'bin')), path.join(skillRoot, 'bin'));
  assert.ok(fs.existsSync(path.join(hosted, 'bin', 'archify.mjs')));
  assert.ok(fs.existsSync(path.join(hosted, 'agents', 'openai.yaml')));
  assert.equal(fs.existsSync(path.join(skillRoot, 'agents')), false);
});

test('Pi package declares the existing skill directory and does not add runtime deps', () => {
  const root = json('package.json');
  assert.equal(root.private, true);
  assert.ok(root.keywords.includes('pi-package'));
  assert.deepEqual(root.pi, { skills: ['./archify'] });
  assert.equal(root.dependencies, undefined);
  assert.equal(root.devDependencies, undefined);
  assert.ok(fs.existsSync(path.join(repoRoot, 'archify', 'SKILL.md')));
});

test('the skill zip excludes host-plugin manifests so npx skills add stays unchanged', () => {
  const buildZip = read('scripts/build-zip.sh');
  for (const exclude of ['.claude-plugin', '.codex-plugin', 'plugin.json', 'skills', 'agents']) {
    assert.match(
      buildZip,
      new RegExp(`--exclude '${exclude.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`),
      `${exclude} must stay out of archify.zip`,
    );
  }
});
