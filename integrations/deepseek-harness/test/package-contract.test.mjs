import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const integrationRoot = path.resolve(here, '..');
const repoRoot = path.resolve(integrationRoot, '..', '..');
const manifestPath = path.join(integrationRoot, 'package.json');

const DEPENDENCY_FIELDS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'bundledDependencies',
  'bundleDependencies',
];
const LIFECYCLE_SCRIPTS = ['prepare', 'install', 'postinstall', 'preinstall'];

test('adapter source lives only under integrations/deepseek-harness with no root workspace', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'package.json')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'package-lock.json')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'pnpm-workspace.yaml')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'integrations/deepseek-harness/package.json')), true);
});

test('publishable manifest is @tt-a1i/archify-dsh@0.1.0 with a DSH bundle patch and no install surface', () => {
  const pkg = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(pkg.name, '@tt-a1i/archify-dsh');
  assert.equal(pkg.version, '0.1.0');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.main, './lib/index.js');
  assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml');
  assert.equal(fs.existsSync(path.join(integrationRoot, pkg.dsh.bundle.patch)), true);
  assert.equal(pkg.repository?.url, 'git+https://github.com/tt-a1i/archify.git');
  assert.equal(pkg.repository?.directory, 'integrations/deepseek-harness');
  for (const keyword of ['dsh-plugin', 'deepseek-harness', 'agent-skill', 'architecture-diagram']) {
    assert.ok(pkg.keywords?.includes(keyword), `missing keyword ${keyword}`);
  }
  for (const field of DEPENDENCY_FIELDS) {
    assert.equal(Object.prototype.hasOwnProperty.call(pkg, field), false, field);
  }
  assert.deepEqual(pkg.peerDependencies, {
    '@deepseek-ai/dsh-skill-filesystem': '>=0.1.0-rc.6 <0.2.0',
  });
  for (const script of LIFECYCLE_SCRIPTS) {
    assert.equal(pkg.scripts?.[script], undefined, script);
  }
  assert.match(pkg.exports?.['./package.json'] || '', /package\.json/);
});

test('bundle patch inserts one adapter-owned filesystem Skill provider resolved from the installed package', () => {
  const patch = fs.readFileSync(path.join(integrationRoot, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /^- insert:/m);
  assert.match(patch, /id:\s*archify-skill-filesystem/);
  assert.match(patch, /name:\s*'@tt-a1i\/archify-dsh'/);
  assert.match(patch, /providerName:\s*archify-plugin/);
  assert.match(patch, /includeDefaultRoots:\s*false/);
  assert.match(patch, /bundledSkillDir:\s*!!js/);
  assert.doesNotMatch(patch, /customSkillDirs/);
  assert.match(
    patch,
    /createRequire\(baseUrl\)\.resolve\('@tt-a1i\/archify-dsh\/package\.json'\)/,
  );
  assert.doesNotMatch(patch, /new URL\(\s*['"]skills\//);
  assert.doesNotMatch(patch, /archify_render|archify_deliver|dsh\.client|ui-deliverables/);
  const insertBlocks = patch.split(/^- insert:/m).slice(1);
  assert.equal(insertBlocks.length, 1);
  const insertedIds = [...insertBlocks[0].matchAll(/^\s+- id:\s*(\S+)/gm)].map((match) => match[1]);
  assert.deepEqual(insertedIds, ['archify-skill-filesystem']);
});

test('adapter delegates only to DSH public Skill-filesystem surface', () => {
  const source = fs.readFileSync(path.join(integrationRoot, 'lib', 'index.js'), 'utf8');
  assert.match(source, /import \* as skillFilesystem from '@deepseek-ai\/dsh-skill-filesystem'/);
  assert.match(source, /export const inject = \['skills'\]/);
  assert.match(source, /export const Config = skillFilesystem\.Config/);
  assert.match(source, /return skillFilesystem\.apply\(ctx, config\)/);
  assert.match(source, /'\.dsh-bundled-skills'/);
  assert.doesNotMatch(source, /child_process|spawn\(|exec\(|fetch\(|https?:\/\//);
});

test('distribution acceptance reserves stdout for its machine-readable JSON receipt', () => {
  const source = fs.readFileSync(
    path.join(integrationRoot, 'scripts', 'distribution-acceptance.mjs'),
    'utf8',
  );
  assert.match(source, /runWithTransientNetworkRetry/);
  assert.match(source, /run\('pnpm'/);
  assert.match(source, /--allow-build=@deepseek-ai\/dsh-subprocess-local/);
  assert.doesNotMatch(source, /--allow-build=\*/);
  assert.match(source, /stdio:\s*\['ignore',\s*2,\s*2\]/);
  assert.doesNotMatch(source, /stdio:\s*['"]inherit['"]/);
  assert.equal([...source.matchAll(/process\.stdout\.write/g)].length, 2);
});

test('distribution receipt separates canonical ZIP bytes from cross-platform content checks', () => {
  const source = fs.readFileSync(
    path.join(integrationRoot, 'scripts', 'distribution-acceptance.mjs'),
    'utf8',
  );
  assert.match(source, /canonicalZipBytes/);
  assert.match(source, /crossPlatformZipCheck:\s*'extracted-content'/);
  assert.doesNotMatch(source, /zipContainerBytesReproducible/);
  assert.doesNotMatch(source, /rsync\/zip are not on GitHub Windows runners/);
});
