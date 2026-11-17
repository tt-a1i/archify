import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { stageCleanSkill } from '../scripts/stage-clean-skill.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillsPackage = require.resolve('skills/package.json');
const skillsCli = path.join(path.dirname(skillsPackage), 'bin', 'cli.mjs');
const [major, minor] = process.versions.node.split('.').map(Number);
// Archify supports Node 18+, while this external installer's own minimum is 22.20.
// Canonical Node 22 regression lanes exercise the real installer. Other Node
// compatibility lanes run Archify's core smoke, not this installer matrix.
const installerSkip = major > 22 || (major === 22 && minor >= 20)
  ? false : 'skills 1.7.0 requires Node >=22.20.0';

function metadata(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  assert.ok(match, 'Skill must start with delimited YAML frontmatter');
  const data = parse(match[1]);
  assert.equal(data.name, 'archify');
  assert.equal(typeof data.description, 'string');
  assert.ok(data.description.trim());
  return data;
}

function extractArchive(destination) {
  fs.mkdirSync(destination, { recursive: true });
  const archive = path.join(repoRoot, 'archify.zip');
  const result = process.platform === 'win32'
    ? spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Expand-Archive -LiteralPath $env:ARCHIFY_TEST_ARCHIVE -DestinationPath $env:ARCHIFY_TEST_EXTRACT'], {
      encoding: 'utf8',
      env: { ...process.env, ARCHIFY_TEST_ARCHIVE: archive, ARCHIFY_TEST_EXTRACT: destination },
    })
    : spawnSync('unzip', ['-q', archive, '-d', destination], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.error?.message || result.stderr);
}

test('distributed ZIP carries the same valid Skill frontmatter as source', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-frontmatter-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  extractArchive(tmp);
  const source = fs.readFileSync(path.join(repoRoot, 'archify', 'SKILL.md'), 'utf8');
  const packaged = fs.readFileSync(path.join(tmp, 'archify', 'SKILL.md'), 'utf8');
  assert.equal(packaged, source, 'rebuild archify.zip when Skill instructions change');
  assert.deepEqual(metadata(packaged), metadata(source));
  assert.deepEqual(metadata(packaged.replace(/\r?\n/g, '\r\n')), metadata(source));
});

test('real Skills CLI keeps source and ZIP installs scoped to the requested Skill', {
  skip: installerSkip,
}, async (t) => {
  assert.equal(JSON.parse(fs.readFileSync(skillsPackage, 'utf8')).version, '1.7.0');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-skills-install-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const source = path.join(tmp, 'source');
  const archive = path.join(tmp, 'archive');
  const isolatedHome = path.join(tmp, 'home');
  // Use the repository's tracked-file stager: no node_modules, local Skills,
  // symlinks, or other developer files enter the installation source.
  stageCleanSkill({ repoRoot, destination: path.join(source, 'archify') });
  fs.cpSync(path.join(repoRoot, 'archify-pr'), path.join(source, 'archify-pr'), { recursive: true });
  for (const internal of fs.readdirSync(path.join(repoRoot, '.agents', 'skills'))) {
    const skill = path.join('.agents', 'skills', internal, 'SKILL.md');
    fs.mkdirSync(path.dirname(path.join(source, skill)), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, skill), path.join(source, skill));
  }
  extractArchive(archive);
  function environment(extra = {}) {
    const env = {
      ...process.env,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome,
      INSTALL_INTERNAL_SKILLS: '0',
      DISABLE_TELEMETRY: '1',
      DO_NOT_TRACK: '1',
      NODE_DISABLE_COMPILE_CACHE: '1',
      XDG_STATE_HOME: path.join(tmp, 'state'),
      NO_COLOR: '1',
      ...extra,
    };
    if (!('ARCHIFY_BIN' in extra)) delete env.ARCHIFY_BIN;
    return env;
  }
  let sequence = 0;
  function createTarget(name) {
    const cwd = path.join(tmp, name ?? `target-${sequence++}`);
    fs.mkdirSync(cwd);
    return cwd;
  }
  function invoke(sourcePath, flags, target = createTarget()) {
    const result = spawnSync(process.execPath, [skillsCli, 'add', sourcePath, ...flags], {
      cwd: target, encoding: 'utf8', timeout: 30_000,
      env: environment(),
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    assert.ifError(result.error);
    return { ...result, cwd: target, output };
  }
  function installedNames(cwd) {
    const directory = path.join(cwd, '.agents', 'skills');
    return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
  }
  function install(sourcePath, selection = [], target = createTarget()) {
    return invoke(sourcePath, [...selection, '--agent', 'codex', '--copy', '--yes'], target);
  }
  function installedSkill(cwd, name) {
    return path.join(cwd, '.agents', 'skills', name);
  }
  function runWrapper(cwd, name, args, extraEnv = {}) {
    return spawnSync(process.execPath,
      [path.join(installedSkill(cwd, name), 'bin', 'archify-pr.mjs'), ...args], {
        cwd, encoding: 'utf8', timeout: 30_000,
        env: environment({ ARCHIFY_UPDATE_CHECK_DISABLED: '1', ...extraEnv }),
      });
  }
  function assertDoctor(cwd) {
    const result = spawnSync(process.execPath,
      [path.join(installedSkill(cwd, 'archify'), 'bin', 'archify.mjs'), 'doctor'], {
        cwd: installedSkill(cwd, 'archify'), encoding: 'utf8', timeout: 30_000,
        env: environment({ ARCHIFY_UPDATE_CHECK_DISABLED: '1' }),
      });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Archify is ready\./);
  }
  function writePack(cwd) {
    const directory = path.join(cwd, 'pack');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'topology.json'), JSON.stringify({
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'Checkout topology', output: 'out/topology.html' },
      components: [{ id: 'api', label: 'Checkout API', type: 'backend', pos: [40, 60], size: [130, 60] }],
      connections: [],
    }, null, 2));
    const manifest = path.join(directory, 'pr-pack.json');
    fs.writeFileSync(manifest, JSON.stringify({
      schema_version: 1,
      kind: 'pr-pack',
      title: 'Checkout topology',
      summary: 'Fixture pack for wrapper pass-through.',
      views: [{ id: 'topology', title: 'Service topology', type: 'architecture', input: 'topology.json' }],
    }, null, 2));
    return manifest;
  }

  await t.test('ZIP: default and full-depth discovery expose only archify', () => {
    for (const flags of [['--list'], ['--list', '--full-depth']]) {
      const result = invoke(archive, flags);
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /Found 1 skill\b/);
      assert.match(result.output, /Available Skills[\s\S]*\barchify\b/);
      assert.doesNotMatch(result.output, /archify-review|archify-tuning|archify-pr|YAML parse error/);
      assert.deepEqual(installedNames(result.cwd), []);
    }
  });
  await t.test('ZIP: explicit and unfiltered --yes installs copy only archify', () => {
    for (const selection of [['--skill', 'archify'], [], ['--skill', '*']]) {
      const result = install(archive, selection);
      assert.equal(result.status, 0, result.output);
      assert.deepEqual(installedNames(result.cwd), ['archify']);
      const lock = JSON.parse(fs.readFileSync(path.join(result.cwd, 'skills-lock.json'), 'utf8'));
      assert.deepEqual(Object.keys(lock.skills), ['archify']);
      const installed = installedSkill(result.cwd, 'archify');
      metadata(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf8'));
      assert.equal(fs.lstatSync(installed).isSymbolicLink(), false);
      assertDoctor(result.cwd);
    }
  });
  await t.test('source: discovery exposes the public core and companion Skills only', () => {
    for (const flags of [['--list'], ['--list', '--full-depth']]) {
      const result = invoke(source, flags);
      assert.equal(result.status, 0, result.output);
      assert.match(result.output, /Found 2 skills\b/);
      assert.match(result.output, /Available Skills[\s\S]*\barchify\b[\s\S]*\barchify-pr\b/);
      assert.doesNotMatch(result.output, /archify-review|archify-tuning|YAML parse error/);
      assert.deepEqual(installedNames(result.cwd), []);
    }
  });
  await t.test('source: --skill archify keeps the default install unchanged', () => {
    const result = install(source, ['--skill', 'archify']);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(installedNames(result.cwd), ['archify']);
    const lock = JSON.parse(fs.readFileSync(path.join(result.cwd, 'skills-lock.json'), 'utf8'));
    assert.deepEqual(Object.keys(lock.skills), ['archify']);
    assertDoctor(result.cwd);
  });
  await t.test('source: unfiltered installs and * include both public Skills', () => {
    for (const selection of [[], ['--skill', '*']]) {
      const result = install(source, selection);
      assert.equal(result.status, 0, result.output);
      assert.deepEqual(installedNames(result.cwd), ['archify', 'archify-pr']);
      const lock = JSON.parse(fs.readFileSync(path.join(result.cwd, 'skills-lock.json'), 'utf8'));
      assert.deepEqual(Object.keys(lock.skills).sort(), ['archify', 'archify-pr']);
    }
  });
  await t.test('source: --skill archify-pr installs the companion alone', () => {
    const result = install(source, ['--skill', 'archify-pr']);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(installedNames(result.cwd), ['archify-pr']);
    const lock = JSON.parse(fs.readFileSync(path.join(result.cwd, 'skills-lock.json'), 'utf8'));
    assert.deepEqual(Object.keys(lock.skills), ['archify-pr']);
    const installed = installedSkill(result.cwd, 'archify-pr');
    assert.equal(fs.lstatSync(installed).isSymbolicLink(), false);
    assert.equal(fs.existsSync(path.join(installed, 'bin', 'archify-pr.mjs')), true);
    assert.equal(fs.existsSync(path.join(installed, 'references', 'pr-workflow.md')), true);
  });
  await t.test('companion alone fails closed with archify-pr/core-skill-missing', () => {
    const cwd = createTarget('no-core');
    install(source, ['--skill', 'archify-pr'], cwd);
    const json = runWrapper(cwd, 'archify-pr', ['doctor', '--json']);
    assert.notEqual(json.status, 0);
    const receipt = JSON.parse(json.stdout);
    assert.equal(receipt.schemaVersion, 1);
    assert.equal(receipt.ok, false);
    assert.equal(receipt.command, 'archify-pr');
    assert.equal(receipt.diagnostics[0].code, 'archify-pr/core-skill-missing');
    assert.match(receipt.diagnostics[0].supportedFixes.join('\n'), /npx -y skills add tt-a1i\/archify --skill archify/);
    assert.deepEqual(installedNames(cwd), ['archify-pr']);
    const text = runWrapper(cwd, 'archify-pr', ['doctor']);
    assert.notEqual(text.status, 0);
    assert.match(text.stderr, /archify-pr\/core-skill-missing|archify-pr: The archify core Skill was not found/);
    assert.deepEqual(installedNames(cwd), ['archify-pr']);
    const badBin = runWrapper(cwd, 'archify-pr', ['doctor', '--json'], {
      ARCHIFY_BIN: path.join(cwd, 'missing-archify.mjs'),
    });
    assert.notEqual(badBin.status, 0);
    assert.equal(JSON.parse(badBin.stdout).diagnostics[0].code, 'archify-pr/core-skill-missing');
    const explicitBin = runWrapper(cwd, 'archify-pr', ['--help'], {
      ARCHIFY_BIN: path.join(repoRoot, 'archify', 'bin', 'archify.mjs'),
    });
    assert.equal(explicitBin.status, 0, explicitBin.stderr);
    assert.match(explicitBin.stdout, /Usage:/);
  });
  await t.test('installed companion delegates to a sibling core Skill', () => {
    const cwd = createTarget('dual');
    assert.equal(install(source, ['--skill', 'archify'], cwd).status, 0);
    assert.equal(install(source, ['--skill', 'archify-pr'], cwd).status, 0);
    assert.deepEqual(installedNames(cwd), ['archify', 'archify-pr']);
    const help = runWrapper(cwd, 'archify-pr', ['--help']);
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /Usage:/);
    const doctor = runWrapper(cwd, 'archify-pr', ['doctor']);
    assert.equal(doctor.status, 0, doctor.stderr);
    assert.match(doctor.stdout, /Archify is ready\./);
    const validate = runWrapper(cwd, 'archify-pr', ['pr', 'validate', writePack(cwd), '--json']);
    assert.equal(validate.status, 0, validate.stderr);
    assert.equal(JSON.parse(validate.stdout).ok, true);
  });
  await t.test('maintainers can still explicitly select the internal review Skill', () => {
    const result = install(source, ['--skill', 'archify-review']);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(installedNames(result.cwd), ['archify-review']);
  });
  await t.test('malformed core frontmatter fails explicit selection and never falls back to internal skills', () => {
    const file = path.join(source, 'archify', 'SKILL.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^description:.*$/m,
      'description: steps and states: a plan'));
    const explicit = install(source, ['--skill', 'archify']);
    assert.equal(explicit.status, 1, explicit.output);
    assert.match(explicit.output, /YAML parse error/);
    assert.deepEqual(installedNames(explicit.cwd), []);
    assert.equal(fs.existsSync(path.join(explicit.cwd, 'skills-lock.json')), false);
    const unfiltered = install(source, []);
    assert.equal(unfiltered.status, 0, unfiltered.output);
    assert.match(unfiltered.output, /YAML parse error/);
    assert.deepEqual(installedNames(unfiltered.cwd), ['archify-pr']);
    const lock = JSON.parse(fs.readFileSync(path.join(unfiltered.cwd, 'skills-lock.json'), 'utf8'));
    assert.deepEqual(Object.keys(lock.skills), ['archify-pr']);
    assert.doesNotMatch(unfiltered.output, /archify-review/);
  });
});
