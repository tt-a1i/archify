import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const integrationRoot = path.resolve(here, '..');
const repoRoot = path.resolve(integrationRoot, '..', '..');
const python = process.env.PYTHON || (process.platform === 'win32' ? 'py' : 'python3');
const pythonArgs = !process.env.PYTHON && process.platform === 'win32' ? ['-3'] : [];

function read(relativePath) {
  return fs.readFileSync(path.join(integrationRoot, relativePath), 'utf8');
}

test('Hermes adapter lives only under integrations/hermes-agent', () => {
  assert.equal(fs.existsSync(path.join(integrationRoot, 'plugin.yaml')), true);
  assert.equal(fs.existsSync(path.join(integrationRoot, '__init__.py')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'archify', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(integrationRoot, 'skills')), false);
});

test('plugin is skill-only and does not declare native tools', () => {
  const manifest = read('plugin.yaml');
  assert.match(manifest, /^name: archify$/m);
  assert.match(manifest, /^kind: standalone$/m);
  assert.doesNotMatch(manifest, /provides_tools/);
  assert.doesNotMatch(manifest, /provides_hooks/);

  const init = read('__init__.py');
  assert.match(init, /register_skill\("archify"/);
  assert.doesNotMatch(init, /register_tool\(/);
  assert.match(init, /node bin\/archify\.mjs/);
  assert.match(init, /ARCHIFY_SKILL_ROOT/);
  assert.match(init, /HERMES_HOME/);
});

test('register() registers the in-repo Skill without a packed copy', () => {
  const result = spawnSync(python, [...pythonArgs, '-c', `
import importlib.util
from pathlib import Path
plugin = Path(${JSON.stringify(path.join(integrationRoot, '__init__.py'))})
spec = importlib.util.spec_from_file_location('archify_hermes_plugin', plugin)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
resolved = mod.resolve_skill_md()
print(resolved)
assert resolved.name == 'SKILL.md'
assert resolved.parent.name == 'archify'
from types import SimpleNamespace
calls = []
mod.register(SimpleNamespace(register_skill=lambda *args, **kw: calls.append((args, kw))))
assert len(calls) == 1
assert calls[0][0] == ('archify', resolved)
assert calls[0][1]['description']
`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(path.resolve(result.stdout.trim()), path.join(repoRoot, 'archify', 'SKILL.md'));
});

test('docs stay community opt-in, cover Windows, and refuse a Python rewrite', () => {
  const docs = read('README.md');
  assert.match(docs, /not\*\* an official Nous Research/i);
  assert.match(docs, /Skill-only/);
  assert.match(docs, /Node\.js 18\+/);
  assert.match(docs, /no Python port/i);
  assert.match(docs, /hermes skills install skills-sh\/tt-a1i\/archify\/archify -y/);
  assert.match(docs, /~\/\.hermes\/skills\/archify/);
  assert.match(docs, /skill_view\("archify:archify"\)/);
  assert.match(docs, /New-Item -ItemType SymbolicLink/);
  assert.match(docs, /USERPROFILE/);
  assert.match(docs, /not an agent-switcher target/i);
});

test('README install tables mention Hermes without adding a switcher agent', () => {
  const english = fs.readFileSync(path.join(repoRoot, 'README.md'), 'utf8');
  const chinese = fs.readFileSync(path.join(repoRoot, 'README_ZH.md'), 'utf8');
  const start = fs.readFileSync(path.join(repoRoot, 'docs', 'start.html'), 'utf8');
  assert.match(english, /\| \*\*Hermes Agent\*\* \|/);
  assert.match(chinese, /\| \*\*Hermes Agent\*\* \|/);
  assert.match(english, /integrations\/hermes-agent\/README\.md/);
  assert.match(english, /hermes skills install skills-sh\/tt-a1i\/archify\/archify -y/);
  const skill = fs.readFileSync(path.join(repoRoot, 'archify', 'SKILL.md'), 'utf8');
  assert.match(skill, /^name: archify$/m);
  assert.doesNotMatch(start, /data-agent="hermes"/);
});

test('Archify core does not import or branch on Hermes Agent', () => {
  const grep = spawnSync('git', [
    'grep',
    '-n',
    '-E',
    'hermes-agent|HERMES_HOME|ARCHIFY_SKILL_ROOT',
    '--',
    'archify',
    'scripts/build-zip.sh',
    'scripts/package-smoke.mjs',
  ], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(grep.status, 1, grep.stderr || grep.stdout);
  assert.equal(grep.stdout.trim(), '');
});


test('standalone plugin resolves configured homes and fails when no Skill exists', () => {
  const result = spawnSync(python, [...pythonArgs, '-c', `
import importlib.util, os, shutil, tempfile
from pathlib import Path
with tempfile.TemporaryDirectory() as tmp:
    root = Path(tmp)
    plugin = root / 'plugin' / '__init__.py'
    plugin.parent.mkdir()
    shutil.copyfile(${JSON.stringify(path.join(integrationRoot, '__init__.py'))}, plugin)
    os.environ['HERMES_HOME'] = str(root / 'home')
    os.environ.pop('ARCHIFY_SKILL_ROOT', None)
    spec = importlib.util.spec_from_file_location('isolated_archify', plugin)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    try:
        mod.resolve_skill_md()
        raise AssertionError('missing Skill must fail')
    except FileNotFoundError:
        pass
    home_skill = root / 'home' / 'skills' / 'archify' / 'SKILL.md'
    home_skill.parent.mkdir(parents=True)
    home_skill.write_text('home skill')
    assert mod.resolve_skill_md() == home_skill
    explicit = root / 'explicit'
    explicit.mkdir()
    (explicit / 'SKILL.md').write_text('configured skill')
    os.environ['ARCHIFY_SKILL_ROOT'] = str(explicit)
    assert mod.resolve_skill_md() == explicit / 'SKILL.md'
`], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
