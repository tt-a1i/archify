import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  copyableTrackedSkillPath,
  stageCleanSkill,
} from '../../scripts/stage-clean-skill.mjs';

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

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result;
}

function initSkillFixture() {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-skill-fixture-'));
  fs.writeFileSync(path.join(source, 'package.json'), `${JSON.stringify({ name: 'archify' }, null, 2)}\n`);
  fs.writeFileSync(path.join(source, 'SKILL.md'), '# archify\n');
  fs.mkdirSync(path.join(source, 'renderers', 'shared'), { recursive: true });
  fs.writeFileSync(path.join(source, 'renderers', 'shared', 'generated-validators.mjs'), 'export default {};\n');
  fs.mkdirSync(path.join(source, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(source, 'assets', 'template.html'), '<html></html>\n');
  git(source, ['init']);
  git(source, ['add', '.']);
  git(source, [
    '-c',
    'user.email=archify-test@example.com',
    '-c',
    'user.name=archify-test',
    'commit',
    '-m',
    'fixture',
  ]);
  return source;
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

test('stageCleanSkill copies tracked files only and skips untracked Skill paths', () => {
  const source = initSkillFixture();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-clean-skill-'));
  const markerName = 'review-untracked-marker.txt';
  fs.writeFileSync(path.join(source, markerName), 'should-not-pack\n');
  try {
    stageCleanSkill(source, dest);
    assert.equal(fs.existsSync(path.join(dest, 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(dest, 'assets', 'template.html')), true);
    assert.equal(fs.existsSync(path.join(dest, markerName)), false);
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('stageCleanSkill refuses to follow a tracked file symlink', () => {
  const source = initSkillFixture();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-symlink-file-'));
  try {
    const secret = path.join(source, 'secret.txt');
    fs.writeFileSync(secret, 'secret\n');
    fs.rmSync(path.join(source, 'SKILL.md'));
    fs.symlinkSync(secret, path.join(source, 'SKILL.md'));
    git(source, ['add', 'SKILL.md']);
    git(source, [
      '-c',
      'user.email=archify-test@example.com',
      '-c',
      'user.name=archify-test',
      'commit',
      '-m',
      'symlink',
    ]);
    assert.throws(() => stageCleanSkill(source, dest), /refusing to follow source symlink: SKILL.md/);
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('stageCleanSkill refuses a tracked path that resolves outside the source root', () => {
  const source = initSkillFixture();
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-symlink-dir-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-outside-'));
  try {
    fs.writeFileSync(path.join(outside, 'template.html'), 'pwned\n');
    fs.rmSync(path.join(source, 'assets'), { recursive: true, force: true });
    fs.symlinkSync(outside, path.join(source, 'assets'));
    assert.throws(
      () => stageCleanSkill(source, dest),
      /refusing to follow source symlink: assets\/template.html/,
    );
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(dest, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('copyableTrackedSkillPath refuses a leaf symlink without following it', () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-symlink-helper-'));
  try {
    const target = path.join(source, 'secret.txt');
    fs.writeFileSync(target, 'secret\n');
    fs.symlinkSync(target, path.join(source, 'SKILL.md'));
    assert.throws(
      () => copyableTrackedSkillPath(source, 'SKILL.md'),
      /refusing to follow source symlink: SKILL.md/,
    );
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
  }
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
