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
  const head = git(repoRoot, ['rev-parse', 'HEAD']);
  const clone = spawnSync('git', ['clone', '--shared', '--no-checkout', '--', repoRoot, checkout], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(clone.status, 0, clone.stderr || clone.stdout);
  git(checkout, ['checkout', '--detach', head]);
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
    assert.match(`${result.stderr}\n${result.stdout}`, /unsupported path|NUL\.js/i);
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
    assert.match(`${result.stderr}\n${result.stdout}`, /collide across supported filesystems|INDEX\.js|index\.js/i);
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
