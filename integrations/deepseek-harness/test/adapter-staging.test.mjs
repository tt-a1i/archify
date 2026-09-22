import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { spawnCliSync } from '../scripts/resolve-cli.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const integrationRoot = path.resolve(here, '..');
const repoRoot = path.resolve(integrationRoot, '..', '..');

function git(cwd, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    ...options,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout.trim();
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dsh-pack-fixture-'));
  const checkout = path.join(root, 'repo');
  const sourceHead = git(repoRoot, ['rev-parse', 'HEAD']);
  const clone = spawnSync('git', ['clone', '--shared', '--no-checkout', '--', repoRoot, checkout], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(clone.status, 0, clone.stderr || clone.stdout);
  git(checkout, ['checkout', '--detach', sourceHead]);

  // Exercise the working contract even before it is committed. In CI these
  // copies are byte-identical to HEAD and no fixture commit is needed.
  const contractFiles = [
    'scripts/stage-clean-skill.mjs',
    'scripts/third-party-notices-contract.mjs',
    'archify/renderers/shared/atomic-output.mjs',
    'archify/renderers/shared/output-path.mjs',
    'archify/renderers/shared/path-semantics.mjs',
    'archify/renderers/shared/portable-path.mjs',
    'archify/renderers/shared/sidecar-path.mjs',
    'integrations/deepseek-harness/scripts/release-source.mjs',
    'integrations/deepseek-harness/scripts/pack.mjs',
  ];
  for (const relative of contractFiles) {
    const target = path.join(checkout, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, ...relative.split('/')), target);
  }
  git(checkout, ['add', '--', ...contractFiles]);
  const diff = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: checkout, encoding: 'utf8' });
  assert.equal(diff.error, undefined, diff.error?.message);
  assert.ok([0, 1].includes(diff.status), diff.stderr || diff.stdout);
  if (diff.status === 1) {
    git(checkout, ['config', 'user.email', 'archify-tests@example.invalid']);
    git(checkout, ['config', 'user.name', 'Archify tests']);
    git(checkout, ['commit', '--no-gpg-sign', '-m', 'test: apply working portable path contract']);
  }
  const head = git(checkout, ['rev-parse', 'HEAD']);
  return { root, checkout, head };
}

function adapterPath(checkout, relative) {
  return path.join(checkout, 'integrations', 'deepseek-harness', ...relative.split('/'));
}

function headBlob(checkout, head, relative) {
  const result = spawnSync('git', ['show', `${head}:integrations/deepseek-harness/${relative}`], {
    cwd: checkout,
    encoding: 'buffer',
  });
  assert.equal(result.status, 0, result.stderr?.toString('utf8'));
  return result.stdout;
}

function pack(checkout, root) {
  const out = path.join(root, 'packed.tgz');
  const script = path.join(checkout, 'integrations', 'deepseek-harness', 'scripts', 'pack.mjs');
  const result = spawnSync(process.execPath, [script, '--out', out, '--json'], {
    cwd: checkout,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: path.join(root, 'npm-cache') },
  });
  return { out, result };
}

function unpack(tarball, root) {
  const destination = path.join(root, 'unpacked');
  fs.mkdirSync(destination);
  const result = spawnCliSync('tar', ['-xzf', path.basename(tarball), '-C', destination], {
    cwd: path.dirname(tarball),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return path.join(destination, 'package');
}

function commitFixture(checkout, message, { stage = true } = {}) {
  git(checkout, ['config', 'user.email', 'archify-tests@example.invalid']);
  git(checkout, ['config', 'user.name', 'Archify tests']);
  if (stage) git(checkout, ['add', '-A', '--', 'integrations/deepseek-harness']);
  git(checkout, ['commit', '--no-gpg-sign', '-m', message]);
}

function addIndexedAdapterBlob(checkout, relative, content) {
  const repositoryRelative = `integrations/deepseek-harness/${relative}`;
  const blob = git(checkout, ['hash-object', '-w', '--stdin'], { input: content });
  git(checkout, ['update-index', '--add', '--cacheinfo', `100644,${blob},${repositoryRelative}`]);
  return repositoryRelative;
}

test('DSH workflow runs when the shared portable-path contract changes', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'dsh.yml'), 'utf8');
  assert.equal(
    workflow.match(/archify\/renderers\/shared\/atomic-output\.mjs/g)?.length,
    2,
    'pull requests and branch pushes must both watch the atomic output runtime',
  );
  assert.equal(
    workflow.match(/archify\/renderers\/shared\/portable-path\.mjs/g)?.length,
    2,
    'pull requests and branch pushes must both watch the shared validator',
  );
  assert.equal(
    workflow.match(/archify\/renderers\/shared\/path-semantics\.mjs/g)?.length,
    2,
    'pull requests and branch pushes must both watch the staging identity runtime',
  );
  assert.equal(
    workflow.match(/archify\/renderers\/shared\/output-path\.mjs/g)?.length,
    2,
    'pull requests and branch pushes must both watch the native output runtime',
  );
  assert.equal(
    workflow.match(/archify\/renderers\/shared\/sidecar-path\.mjs/g)?.length,
    2,
    'pull requests and branch pushes must both watch the bounded sidecar runtime',
  );
});

test('pack stages adapter inputs from the fixture HEAD despite dirty and untracked files', () => {
  const { root, checkout, head } = fixture();
  try {
    const dirtyMarker = 'ARCHIFY_DSH_DIRTY_FIXTURE_MARKER';
    const manifestPath = adapterPath(checkout, 'package.json');
    const releasePath = adapterPath(checkout, 'release.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
    manifest.description = dirtyMarker;
    release.skillVersion = `${release.skillVersion}-dirty`;
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    fs.writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`);
    fs.appendFileSync(adapterPath(checkout, 'cordis.patch.yml'), `\n# ${dirtyMarker}\n`);
    fs.appendFileSync(adapterPath(checkout, 'README.md'), `\n${dirtyMarker}\n`);
    fs.writeFileSync(adapterPath(checkout, 'lib/index.js'), `// ${dirtyMarker}\n`);
    fs.writeFileSync(adapterPath(checkout, 'lib/untracked-dirty.mjs'), dirtyMarker);

    const { out, result } = pack(checkout, root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.adapterCommit, head);
    assert.equal(fs.existsSync(out), true);

    const packageRoot = unpack(out, root);
    for (const relative of ['package.json', 'release.json', 'cordis.patch.yml', 'README.md', 'lib/index.js']) {
      assert.deepEqual(
        fs.readFileSync(path.join(packageRoot, ...relative.split('/'))),
        headBlob(checkout, head, relative),
        `packed adapter input differs from fixture HEAD: ${relative}`,
      );
    }
    assert.equal(fs.existsSync(path.join(packageRoot, 'lib', 'untracked-dirty.mjs')), false);
    const packedText = fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
      + fs.readFileSync(path.join(packageRoot, 'release.json'), 'utf8')
      + fs.readFileSync(path.join(packageRoot, 'cordis.patch.yml'), 'utf8')
      + fs.readFileSync(path.join(packageRoot, 'README.md'), 'utf8')
      + fs.readFileSync(path.join(packageRoot, 'lib', 'index.js'), 'utf8');
    assert.equal(packedText.includes(dirtyMarker), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pack does not follow a live symlink replacing the tracked adapter main', (t) => {
  const { root, checkout, head } = fixture();
  try {
    const mainPath = adapterPath(checkout, 'lib/index.js');
    const outside = path.join(root, 'outside-main.js');
    const marker = 'ARCHIFY_DSH_LIVE_SYMLINK_MARKER';
    fs.writeFileSync(outside, `// ${marker}\n`);
    fs.rmSync(mainPath);
    try {
      fs.symlinkSync(outside, mainPath);
    } catch (error) {
      if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error?.code)) {
        t.skip(`live symlink fixture requires Windows symlink permission (${error.code})`);
        return;
      }
      throw error;
    }

    const { out, result } = pack(checkout, root);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.adapterCommit, head);
    const packageRoot = unpack(out, root);
    const packedMain = path.join(packageRoot, 'lib', 'index.js');
    assert.equal(fs.lstatSync(packedMain).isFile(), true);
    assert.deepEqual(fs.readFileSync(packedMain), headBlob(checkout, head, 'lib/index.js'));
    assert.doesNotMatch(fs.readFileSync(packedMain, 'utf8'), new RegExp(marker));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pack rejects a committed adapter symlink and leaves no target tarball', () => {
  const { root, checkout } = fixture();
  try {
    const mainRelative = 'integrations/deepseek-harness/lib/index.js';
    const target = '/outside/archify-dsh-live-main.js';
    const blob = git(checkout, ['hash-object', '-w', '--stdin'], { input: `${target}\n` });
    git(checkout, ['update-index', '--add', '--cacheinfo', `120000,${blob},${mainRelative}`]);
    commitFixture(checkout, 'test: commit adapter symlink', { stage: false });
    assert.match(git(checkout, ['ls-tree', 'HEAD', '--', mainRelative]), /^120000 blob /);

    const { out, result } = pack(checkout, root);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /symlink/i);
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pack rejects a missing required adapter main and leaves no target tarball', () => {
  const { root, checkout } = fixture();
  try {
    fs.rmSync(adapterPath(checkout, 'lib/index.js'));
    commitFixture(checkout, 'test: remove adapter main');

    const { out, result } = pack(checkout, root);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /lib[\\/]index\.js|main|required/i);
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pack rejects a committed reserved device-name path and leaves no target tarball', () => {
  const { root, checkout } = fixture();
  try {
    // This models a tree created on Linux; keep NTFS protection disabled only
    // in the disposable clone so Git can represent the hostile path on Windows.
    git(checkout, ['config', 'core.protectNTFS', 'false']);
    const invalidRelative = 'integrations/deepseek-harness/lib/NUL.js';
    const blob = git(checkout, ['hash-object', '-w', '--stdin'], { input: 'reserved-name fixture\n' });
    git(checkout, ['update-index', '--add', '--cacheinfo', `100644,${blob},${invalidRelative}`]);
    commitFixture(checkout, 'test: commit reserved adapter path', { stage: false });
    assert.match(git(checkout, ['ls-tree', 'HEAD', '--', invalidRelative]), /^100644 blob /);

    const { out, result } = pack(checkout, root);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /reserved Windows device name/i);
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pack rejects committed adapter paths that collide by case and leaves no target tarball', () => {
  const { root, checkout } = fixture();
  try {
    const collisionRelative = 'integrations/deepseek-harness/lib/INDEX.js';
    const blob = git(checkout, ['hash-object', '-w', '--stdin'], { input: 'case collision fixture\n' });
    git(checkout, ['update-index', '--add', '--cacheinfo', `100644,${blob},${collisionRelative}`]);
    commitFixture(checkout, 'test: commit case-colliding adapter path', { stage: false });
    assert.match(git(checkout, ['ls-tree', 'HEAD', '--', collisionRelative]), /^100644 blob /);
    assert.match(git(checkout, ['ls-tree', 'HEAD', '--', 'integrations/deepseek-harness/lib/index.js']), /^100644 blob /);

    const { out, result } = pack(checkout, root);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /collide under portable filesystem semantics/i);
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pack rejects committed adapter directory prefixes that collide by case', () => {
  const { root, checkout } = fixture();
  try {
    git(checkout, ['config', 'core.ignorecase', 'false']);
    const collisionPaths = [
      addIndexedAdapterBlob(checkout, 'lib/Docs/one.js', 'upper directory fixture\n'),
      addIndexedAdapterBlob(checkout, 'lib/docs/two.js', 'lower directory fixture\n'),
    ];
    commitFixture(checkout, 'test: commit directory-prefix case collision', { stage: false });
    for (const relative of collisionPaths) {
      assert.match(git(checkout, ['ls-tree', 'HEAD', '--', relative]), /^100644 blob /);
    }

    const { out, result } = pack(checkout, root);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /collide under portable filesystem semantics/i);
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pack rejects committed adapter paths that collide by normalization and case', () => {
  const { root, checkout } = fixture();
  try {
    for (const [key, value] of [
      ['core.ignorecase', 'false'],
      ['core.precomposeunicode', 'false'],
      ['core.protectHFS', 'false'],
    ]) git(checkout, ['config', key, value]);
    const paths = [
      addIndexedAdapterBlob(checkout, 'lib/Résumé.js', 'composed collision fixture\n'),
      addIndexedAdapterBlob(checkout, 'lib/re\u0301sume\u0301.js', 'decomposed collision fixture\n'),
    ];
    commitFixture(checkout, 'test: commit normalization-and-case collision', { stage: false });
    for (const relative of paths) {
      assert.match(git(checkout, ['ls-tree', 'HEAD', '--', relative]), /^100644 blob /);
    }

    const { out, result } = pack(checkout, root);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /collide under portable filesystem semantics/i);
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pack accepts committed exact-SemVer dshVersion values including prereleases', () => {
  const { root, checkout } = fixture();
  try {
    const releasePath = adapterPath(checkout, 'release.json');
    for (const dshVersion of ['0.1.2-rc.2', '1.0.0', '2.0.0-alpha.1+build.5']) {
      const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
      release.dshVersion = dshVersion;
      fs.writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`);
      commitFixture(checkout, `test: pin exact dshVersion ${dshVersion}`);
      const { out, result } = pack(checkout, root);
      assert.equal(result.status, 0, `${dshVersion}: ${result.stderr || result.stdout}`);
      assert.equal(fs.existsSync(out), true, dshVersion);
      fs.rmSync(out, { force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pack rejects a committed non-SemVer dshVersion before any install or pack step', () => {
  const { root, checkout } = fixture();
  try {
    const releasePath = adapterPath(checkout, 'release.json');
    const hostileVersions = [
      'npm:attacker-pkg@1.0.0',
      'jsr:attacker-pkg@1.0.0',
      '^0.1.2',
      '0.1.2 || 1.0.0',
      'latest',
      'file:../payload',
      './payload',
      'https://example.invalid/payload.tgz',
      'github:attacker/repo',
    ];
    for (const dshVersion of hostileVersions) {
      const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
      release.dshVersion = dshVersion;
      fs.writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`);
      commitFixture(checkout, `test: pin hostile dshVersion ${dshVersion}`);
      const { out, result } = pack(checkout, root);
      assert.notEqual(result.status, 0, dshVersion);
      assert.match(`${result.stderr}\n${result.stdout}`, /dshVersion must be an exact SemVer version/);
      assert.equal(fs.existsSync(out), false, dshVersion);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pack rejects a committed adapter manifest declaring scripts and leaves no target tarball', () => {
  const { root, checkout } = fixture();
  try {
    const marker = path.join(root, 'lifecycle-marker');
    const manifestPath = adapterPath(checkout, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.scripts = { prepack: `touch ${JSON.stringify(marker)}`, postpack: `touch ${JSON.stringify(marker)}.post` };
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    commitFixture(checkout, 'test: commit adapter lifecycle scripts');

    const { out, result } = pack(checkout, root);
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}\n${result.stdout}`, /must not declare npm scripts/);
    assert.equal(fs.existsSync(out), false);
    assert.equal(fs.existsSync(marker), false, 'prepack must not execute');
    assert.equal(fs.existsSync(`${marker}.post`), false, 'postpack must not execute');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
