import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(skillRoot, '..');
const pluginRoot = path.join(repoRoot, 'plugins', 'archify');
const leafRoot = path.join(pluginRoot, 'skills', 'archify');
const pluginVersion = '0.1.0';

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function json(relativePath) {
  return JSON.parse(read(relativePath));
}

function assertRegularFile(filePath) {
  const stat = fs.lstatSync(filePath);
  assert.equal(stat.isSymbolicLink(), false, `${filePath} must not be a symlink`);
  assert.equal(stat.isFile(), true, `${filePath} must be a regular file`);
}

test('Claude, Grok, and Codex marketplaces point at the generated plugin leaf', () => {
  const claude = json('.claude-plugin/marketplace.json');
  const grok = json('.grok-plugin/marketplace.json');
  const codex = json('.agents/plugins/marketplace.json');

  assert.equal(claude.name, 'archify');
  assert.equal(grok.name, 'archify');
  assert.equal(codex.name, 'archify');
  assert.equal(claude.plugins.length, 1);
  assert.equal(grok.plugins.length, 1);
  assert.equal(codex.plugins.length, 1);
  assert.equal(claude.plugins[0].name, 'archify');
  assert.equal(grok.plugins[0].name, 'archify');
  assert.equal(codex.plugins[0].name, 'archify');
  assert.equal(claude.plugins[0].source, './plugins/archify');
  assert.deepEqual(grok.plugins[0].source, { type: 'local', path: './plugins/archify' });
  assert.deepEqual(codex.plugins[0].source, { source: 'local', path: './plugins/archify' });
  assert.equal(claude.plugins[0].version, pluginVersion);
  assert.equal(grok.plugins[0].version, pluginVersion);
});

test('host plugin manifests use an independent plugin version', () => {
  const pkg = json('archify/package.json');
  const claude = json('plugins/archify/.claude-plugin/plugin.json');
  const grok = json('plugins/archify/plugin.json');
  const codex = json('plugins/archify/.codex-plugin/plugin.json');

  assert.equal(claude.name, 'archify');
  assert.equal(grok.name, 'archify');
  assert.equal(codex.name, 'archify');
  assert.equal(claude.version, pluginVersion);
  assert.equal(grok.version, pluginVersion);
  assert.equal(codex.version, pluginVersion);
  assert.notEqual(pluginVersion, pkg.version);
  assert.equal(claude.license, 'MIT');
  assert.equal(grok.license, 'MIT');
  assert.equal(codex.license, 'MIT');
  assert.equal(grok.skills, undefined);
  assert.equal(codex.skills, './skills/');
});

test('the generated Skill leaf is real files and runnable from a foreign cwd', () => {
  for (const relative of ['SKILL.md', 'bin/archify.mjs', 'schemas/architecture.schema.json', 'assets/template.html', 'agents/openai.yaml']) {
    assertRegularFile(path.join(leafRoot, relative));
  }
  assert.equal(fs.existsSync(path.join(pluginRoot, 'agents')), false);
  assert.equal(fs.existsSync(path.join(skillRoot, 'skills')), false);
  assert.equal(fs.existsSync(path.join(skillRoot, '.claude-plugin')), false);
  assert.equal(fs.existsSync(path.join(skillRoot, '.codex-plugin')), false);
  assert.equal(fs.existsSync(path.join(skillRoot, 'plugin.json')), false);

  const leafPkg = json('plugins/archify/skills/archify/package.json');
  assert.equal(leafPkg.scripts, undefined);
  assert.equal(leafPkg.devDependencies, undefined);

  const foreign = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-hosted-cwd-'));
  try {
    const doctor = spawnSync(process.execPath, [path.join(leafRoot, 'bin', 'archify.mjs'), 'doctor'], {
      cwd: foreign,
      encoding: 'utf8',
    });
    assert.equal(doctor.status, 0, doctor.stderr || doctor.stdout);
  } finally {
    fs.rmSync(foreign, { recursive: true, force: true });
  }
});

test('the plugin leaf stays fresh against the Skill SSoT', () => {
  const check = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'build-plugin-leaf.mjs'), '--check'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.match(check.stdout, /plugin leaf is fresh/);
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
