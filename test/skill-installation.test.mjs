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
  // Use the repository's tracked-file stager: no node_modules, local Skills,
  // symlinks, or other developer files enter the installation source.
  stageCleanSkill({ repoRoot, destination: path.join(source, 'archify') });
  for (const internal of fs.readdirSync(path.join(repoRoot, '.agents', 'skills'))) {
    const skill = path.join('.agents', 'skills', internal, 'SKILL.md');
    fs.mkdirSync(path.dirname(path.join(source, skill)), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, skill), path.join(source, skill));
  }
  extractArchive(archive);
  let sequence = 0;
  function invoke(sourcePath, flags) {
    const cwd = path.join(tmp, `target-${sequence++}`);
    fs.mkdirSync(cwd);
    const result = spawnSync(process.execPath, [skillsCli, 'add', sourcePath, ...flags], {
      cwd, encoding: 'utf8', timeout: 30_000,
      env: {
        ...process.env, INSTALL_INTERNAL_SKILLS: '0',
        DISABLE_TELEMETRY: '1', DO_NOT_TRACK: '1', NODE_DISABLE_COMPILE_CACHE: '1',
        XDG_STATE_HOME: path.join(tmp, 'state'), NO_COLOR: '1',
      },
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`
      .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
    assert.ifError(result.error);
    return { ...result, cwd, output };
  }
  function installedNames(cwd) {
    const directory = path.join(cwd, '.agents', 'skills');
    return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
  }
  function install(sourcePath, selection = []) {
    return invoke(sourcePath, [...selection, '--agent', 'codex', '--copy', '--yes']);
  }
  for (const [label, sourcePath] of [['source', source], ['ZIP', archive]]) {
    await t.test(`${label}: default and full-depth discovery expose only archify`, () => {
      for (const flags of [['--list'], ['--list', '--full-depth']]) {
        const result = invoke(sourcePath, flags);
        assert.equal(result.status, 0, result.output);
        assert.match(result.output, /Found 1 skill\b/);
        assert.match(result.output, /Available Skills[\s\S]*\barchify\b/);
        assert.doesNotMatch(result.output, /archify-review|archify-tuning|YAML parse error/);
        assert.deepEqual(installedNames(result.cwd), []);
      }
    });
    await t.test(`${label}: explicit and unfiltered --yes installs copy only archify`, () => {
      for (const selection of [['--skill', 'archify'], [], ['--skill', '*']]) {
        const result = install(sourcePath, selection);
        assert.equal(result.status, 0, result.output);
        assert.deepEqual(installedNames(result.cwd), ['archify']);
        const lock = JSON.parse(fs.readFileSync(path.join(result.cwd, 'skills-lock.json'), 'utf8'));
        assert.deepEqual(Object.keys(lock.skills), ['archify']);
        const installed = path.join(result.cwd, '.agents', 'skills', 'archify');
        metadata(fs.readFileSync(path.join(installed, 'SKILL.md'), 'utf8'));
        assert.equal(fs.lstatSync(installed).isSymbolicLink(), false);
        const doctor = spawnSync(process.execPath, [path.join(installed, 'bin', 'archify.mjs'), 'doctor'], {
          cwd: installed, encoding: 'utf8', timeout: 30_000,
          env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
        });
        assert.equal(doctor.status, 0, doctor.stderr);
        assert.match(doctor.stdout, /Archify is ready\./);
      }
    });
  }
  await t.test('maintainers can still explicitly select the internal review Skill', () => {
    const result = install(source, ['--skill', 'archify-review']);
    assert.equal(result.status, 0, result.output);
    assert.deepEqual(installedNames(result.cwd), ['archify-review']);
  });
  await t.test('malformed frontmatter fails without falling back to review or writing a lock', () => {
    const file = path.join(source, 'archify', 'SKILL.md');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^description:.*$/m,
      'description: steps and states: a plan'));
    for (const selection of [['--skill', 'archify'], []]) {
      const result = install(source, selection);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /YAML parse error/);
      assert.deepEqual(installedNames(result.cwd), []);
      assert.equal(fs.existsSync(path.join(result.cwd, 'skills-lock.json')), false);
    }
  });
});
