import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isMainModule, stageCleanSkill } from '../../scripts/stage-clean-skill.mjs';

const stagerPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../scripts/stage-clean-skill.mjs');
const canonicalNotices = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../THIRD_PARTY_NOTICES.md'),
  'utf8',
);

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

function write(root, relative, content, mode = null) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  if (mode !== null) fs.chmodSync(target, mode);
  return target;
}

function repositoryFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-clean-stage-'));
  write(root, 'THIRD_PARTY_NOTICES.md', canonicalNotices);
  write(root, 'archify/LICENSE', 'MIT License\n');
  write(root, 'archify/THIRD_PARTY_NOTICES.md', canonicalNotices);
  write(root, 'archify/package.json', JSON.stringify({
    name: 'archify-fixture',
    scripts: { test: 'node --test' },
    devDependencies: { ajv: '1.0.0' },
  }));
  write(root, 'archify/package-lock.json', '{}\n');
  write(root, 'archify/skill-release.json', '{}\n');
  write(root, 'archify/scripts/check-update.mjs', 'export {};\n');
  write(root, 'archify/scripts/update-contract.mjs', 'export {};\n');
  write(root, 'archify/renderers/shared/generated-validators.mjs', 'export {};\n');
  write(root, 'archify/schemas/atlas.schema.json', '{}\n');
  for (const name of ['atlas-manifest', 'atlas-delivery', 'atlas-bundle', 'atlas-envelope', 'atlas-shell', 'atlas-navigation']) {
    write(root, `archify/renderers/shared/${name}.mjs`, 'export {};\n');
  }
  write(root, 'archify/assets/vendor/fflate-gunzip-0.8.2.min.js', 'globalThis.ArchifyGzipFallback=()=>{};\n');
  write(root, 'archify/assets/vendor/fflate-MIT.txt', 'MIT License\n');
  write(root, 'archify/references/architecture-atlas.md', '# Atlas\n');
  write(root, 'archify/renderers/shared/path-semantics.mjs', 'export {};\n');
  write(root, 'archify/renderers/shared/portable-path.mjs', 'export {};\n');
  write(root, 'archify/test/repository-only.test.mjs', 'throw new Error();\n');
  git(root, ['init']);
  git(root, ['add', 'THIRD_PARTY_NOTICES.md']);
  return root;
}

test('clean staging entry detection accepts a physical alias and fails closed when identity is unknown', (t) => {
  const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-stage-entry-alias-'));
  t.after(() => fs.rmSync(aliasRoot, { recursive: true, force: true }));
  const aliasPath = path.join(aliasRoot, 'stage-clean-alias.mjs');
  try {
    fs.linkSync(stagerPath, aliasPath);
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'EXDEV'].includes(error?.code)) {
      t.skip(`hard-link aliases unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  assert.equal(isMainModule({ argvPath: aliasPath, modulePath: stagerPath }), true);
  assert.equal(isMainModule({
    argvPath: path.join(aliasRoot, 'missing-entry.mjs'),
    modulePath: stagerPath,
  }), false);
});

test('clean staging rejects a packaged notice that diverges from the repository notice', () => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  try {
    git(root, ['add', '.']);
    fs.writeFileSync(
      path.join(root, 'archify', 'THIRD_PARTY_NOTICES.md'),
      canonicalNotices.replace('Simple Icons 16.28.0', 'Simple Icons 16.28.0 modified'),
    );

    assert.throws(
      () => stageCleanSkill({ repoRoot: root, destination }),
      /must byte-match the repository notice/,
    );
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging requires shared path runtimes only when packaged code imports them', () => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  try {
    fs.writeFileSync(
      path.join(root, 'archify', 'renderers', 'shared', 'generated-validators.mjs'),
      "const runtime = import /* keep release dependencies complete */ (`./portable-path.mjs`);\nexport { runtime };\n",
    );
    git(root, ['add', '.']);
    git(root, ['rm', '--cached', '-f', 'archify/renderers/shared/portable-path.mjs']);

    assert.throws(
      () => stageCleanSkill({ repoRoot: root, destination }),
      /required package input is not tracked by Git: archify\/renderers\/shared\/portable-path[.]mjs/,
    );
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging keeps pre-Atlas snapshots reproducible but rejects a partial Atlas slice', () => {
  const atlasFiles = [
    'archify/schemas/atlas.schema.json',
    ...['atlas-manifest', 'atlas-delivery', 'atlas-bundle', 'atlas-envelope', 'atlas-shell', 'atlas-navigation']
      .map((name) => `archify/renderers/shared/${name}.mjs`),
    'archify/references/architecture-atlas.md',
    'archify/assets/vendor/fflate-gunzip-0.8.2.min.js',
    'archify/assets/vendor/fflate-MIT.txt',
  ];

  for (const partial of [false, true]) {
    const root = repositoryFixture();
    const destination = path.join(root, 'staged-skill');
    try {
      git(root, ['add', '.']);
      const removed = partial ? atlasFiles.slice(1) : atlasFiles;
      git(root, ['rm', '--cached', '-f', '--', ...removed]);
      if (partial) {
        assert.throws(
          () => stageCleanSkill({ repoRoot: root, destination }),
          /required package input is not tracked by Git: archify\/renderers\/shared\/atlas-manifest[.]mjs/,
        );
        assert.equal(fs.existsSync(destination), false);
      } else {
        stageCleanSkill({ repoRoot: root, destination });
        assert.equal(fs.existsSync(path.join(destination, 'schemas', 'atlas.schema.json')), false);
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('clean staging rejects byte-identical but incomplete repository and packaged notices', () => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  try {
    const incomplete = canonicalNotices.replace(/## OpenAI mark[\s\S]*?## No additional rights granted/, '## No additional rights granted');
    fs.writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), incomplete);
    fs.writeFileSync(path.join(root, 'archify', 'THIRD_PARTY_NOTICES.md'), incomplete);
    git(root, ['add', '.']);

    assert.throws(
      () => stageCleanSkill({ repoRoot: root, destination }),
      /repository THIRD_PARTY_NOTICES\.md is incomplete; missing required disclosure: .*OpenAI/,
    );
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging preserves index modes and strips repository-only package metadata', () => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  try {
    write(root, 'archify/bin/executable.mjs', '#!/usr/bin/env node\n', 0o644);
    write(root, 'archify/runtime/test/required.dat', 'runtime fixture\n', 0o755);
    git(root, ['add', 'archify']);
    // Index modes must win over working-tree permissions, including on Windows.
    git(root, ['update-index', '--chmod=+x', 'archify/bin/executable.mjs']);
    git(root, ['update-index', '--chmod=-x', 'archify/runtime/test/required.dat']);
    const result = stageCleanSkill({ repoRoot: root, destination });

    const executable = path.join(destination, 'bin', 'executable.mjs');
    const runtimeFixture = path.join(destination, 'runtime', 'test', 'required.dat');
    assert.equal(result.modes['bin/executable.mjs'], '100755');
    assert.equal(result.modes['runtime/test/required.dat'], '100644');
    // Windows chmod cannot expose Unix executable bits through stat.
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(executable).mode & 0o777, 0o755);
      assert.equal(fs.statSync(runtimeFixture).mode & 0o777, 0o644);
    }
    assert.equal(fs.existsSync(path.join(destination, 'test')), false);
    assert.equal(
      fs.readFileSync(path.join(destination, 'runtime', 'test', 'required.dat'), 'utf8'),
      'runtime fixture\n',
      'only the repository-root test tree is excluded',
    );
    assert.equal(fs.existsSync(path.join(destination, 'package-lock.json')), false);
    const packageJson = JSON.parse(fs.readFileSync(path.join(destination, 'package.json'), 'utf8'));
    assert.equal(Object.hasOwn(packageJson, 'scripts'), false);
    assert.equal(Object.hasOwn(packageJson, 'devDependencies'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging records Git index modes in a manifest outside the staged tree', () => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  const manifest = path.join(root, 'staged-modes.json');
  try {
    write(root, 'archify/bin/executable.mjs', '#!/usr/bin/env node\n');
    write(root, 'archify/renderers/shared/plain.mjs', 'export {};\n');
    git(root, ['add', 'archify']);
    // Set the index modes explicitly so the expectation does not depend on
    // whether this checkout can represent executable bits (core.fileMode).
    git(root, ['update-index', '--chmod=+x', 'archify/bin/executable.mjs']);
    git(root, ['update-index', '--chmod=-x', 'archify/renderers/shared/plain.mjs']);

    const result = stageCleanSkill({ repoRoot: root, destination, modeManifest: manifest });

    const recorded = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    assert.equal(recorded['bin/executable.mjs'], '100755');
    assert.equal(recorded['renderers/shared/plain.mjs'], '100644');
    assert.deepEqual(result.modes, recorded);
    assert.deepEqual(Object.keys(recorded), [...Object.keys(recorded)].sort(), 'manifest keys are sorted');

    const stagedFiles = [];
    const walk = (directory, prefix) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path.join(directory, entry.name), relative);
        else stagedFiles.push(relative);
      }
    };
    walk(destination, '');
    assert.deepEqual(
      Object.keys(recorded).sort(),
      stagedFiles.sort(),
      'the manifest must list every staged file and nothing else',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging refuses to write the mode manifest inside the staged tree', () => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  try {
    git(root, ['add', 'archify']);
    const rejected = [
      destination,
      path.join(destination, 'modes.json'),
      path.join(destination, 'nested', 'modes.json'),
    ];
    for (const manifest of rejected) {
      assert.throws(
        () => stageCleanSkill({ repoRoot: root, destination, modeManifest: manifest }),
        /mode manifest must be written outside the staged Skill tree/,
      );
      assert.equal(fs.existsSync(destination), false, 'a rejected manifest location must not leave a staged tree behind');
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging refuses an existing mode manifest path and leaves it untouched', () => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  const manifest = path.join(root, 'existing-modes.json');
  try {
    git(root, ['add', 'archify']);
    fs.writeFileSync(manifest, 'not ours\n');
    assert.throws(
      () => stageCleanSkill({ repoRoot: root, destination, modeManifest: manifest }),
      /mode manifest path already exists/,
    );
    assert.equal(fs.readFileSync(manifest, 'utf8'), 'not ours\n', 'an existing file at the manifest path must be preserved');
    assert.equal(fs.existsSync(destination), false, 'a refused manifest path must not leave a staged tree behind');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging never adopts a claimant that wins destination-root creation', () => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  const claimant = path.join(destination, 'claimant.txt');
  const originalMkdirSync = fs.mkdirSync;
  let injected = false;
  try {
    git(root, ['add', 'archify']);
    fs.mkdirSync = function injectDestinationClaimant(target, ...args) {
      if (!injected && path.resolve(target) === path.resolve(destination)) {
        injected = true;
        originalMkdirSync.call(fs, target, { mode: 0o755 });
        fs.writeFileSync(claimant, 'claimant root\n');
      }
      return originalMkdirSync.call(fs, target, ...args);
    };

    assert.throws(
      () => stageCleanSkill({ repoRoot: root, destination }),
      /clean Skill staging destination already exists/,
    );
    assert.equal(injected, true, 'the deterministic destination-root race must run');
    assert.equal(
      fs.readFileSync(claimant, 'utf8'),
      'claimant root\n',
      'a destination claimant must not be adopted or removed',
    );
  } finally {
    fs.mkdirSync = originalMkdirSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging never overwrites or recursively removes a claimant file', () => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  const claimant = path.join(destination, 'LICENSE');
  const originalOpenSync = fs.openSync;
  let injected = false;
  try {
    git(root, ['add', 'archify']);
    fs.openSync = function injectFileClaimant(target, ...args) {
      if (!injected && path.resolve(String(target)) === path.resolve(claimant)) {
        injected = true;
        fs.writeFileSync(claimant, 'claimant file\n', { flag: 'wx' });
      }
      return originalOpenSync.call(fs, target, ...args);
    };

    assert.throws(
      () => stageCleanSkill({ repoRoot: root, destination }),
      /EEXIST|staging entry already exists/,
    );
    assert.equal(injected, true, 'the deterministic destination-file race must run');
    assert.equal(
      fs.readFileSync(claimant, 'utf8'),
      'claimant file\n',
      'a file claimant must survive cleanup byte-for-byte',
    );
  } finally {
    fs.openSync = originalOpenSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging preserves a file claimant swapped at the retirement syscall boundary', () => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  const ownedFile = path.join(destination, 'LICENSE');
  const displacedOwnedFile = path.join(root, 'displaced-owned-license');
  const laterFile = path.join(destination, 'THIRD_PARTY_NOTICES.md');
  const originalOpenSync = fs.openSync;
  const originalRenameSync = fs.renameSync;
  let injected = false;
  try {
    git(root, ['add', 'archify']);
    fs.openSync = function failAfterFirstStagedFile(target, ...args) {
      if (path.resolve(String(target)) === path.resolve(laterFile)) {
        throw Object.assign(new Error('injected staging failure'), { code: 'EIO' });
      }
      return originalOpenSync.call(fs, target, ...args);
    };
    fs.renameSync = function swapClaimantAtRetirement(source, target, ...args) {
      if (!injected
        && path.resolve(String(source)) === path.resolve(ownedFile)
        && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
        injected = true;
        originalRenameSync.call(fs, ownedFile, displacedOwnedFile);
        fs.writeFileSync(ownedFile, 'claimant file\n', { flag: 'wx' });
      }
      return originalRenameSync.call(fs, source, target, ...args);
    };

    assert.throws(
      () => stageCleanSkill({ repoRoot: root, destination }),
      /injected staging failure/,
    );
    assert.equal(injected, true, 'cleanup must reach the deterministic retirement race');
    assert.equal(fs.readFileSync(ownedFile, 'utf8'), 'claimant file\n');
    assert.equal(fs.readFileSync(displacedOwnedFile, 'utf8'), 'MIT License\n');
  } finally {
    fs.openSync = originalOpenSync;
    fs.renameSync = originalRenameSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging preserves a directory claimant swapped at the retirement syscall boundary', () => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  const modeManifest = path.join(root, 'modes.json');
  const ownedDirectory = path.join(destination, 'renderers', 'shared');
  const displacedOwnedDirectory = path.join(root, 'displaced-owned-shared');
  const originalOpenSync = fs.openSync;
  const originalRenameSync = fs.renameSync;
  let injected = false;
  const matchingFiles = (directory, name) => {
    const matches = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) matches.push(...matchingFiles(absolute, name));
      else if (entry.isFile() && entry.name === name) matches.push(absolute);
    }
    return matches;
  };
  try {
    git(root, ['add', 'archify']);
    fs.openSync = function failModeManifest(target, ...args) {
      if (path.resolve(String(target)) === path.resolve(modeManifest)) {
        throw Object.assign(new Error('injected manifest failure'), { code: 'EIO' });
      }
      return originalOpenSync.call(fs, target, ...args);
    };
    fs.renameSync = function swapDirectoryClaimantAtRetirement(source, target, ...args) {
      if (!injected
        && path.resolve(String(source)) === path.resolve(ownedDirectory)
        && path.basename(path.dirname(String(target))).startsWith('.archify-stage-remove-')) {
        injected = true;
        originalRenameSync.call(fs, ownedDirectory, displacedOwnedDirectory);
        fs.mkdirSync(ownedDirectory);
        fs.writeFileSync(path.join(ownedDirectory, 'claimant.txt'), 'claimant directory\n');
      }
      return originalRenameSync.call(fs, source, target, ...args);
    };

    assert.throws(
      () => stageCleanSkill({ repoRoot: root, destination, modeManifest }),
      /injected manifest failure/,
    );
    assert.equal(injected, true, 'cleanup must reach the deterministic directory-retirement race');
    const claimants = matchingFiles(root, 'claimant.txt');
    assert.equal(claimants.length, 1, 'the directory claimant must remain available for recovery');
    assert.equal(fs.readFileSync(claimants[0], 'utf8'), 'claimant directory\n');
    assert.equal(
      fs.existsSync(displacedOwnedDirectory),
      true,
      'the displaced owned directory must not be mistaken for the claimant',
    );
  } finally {
    fs.openSync = originalOpenSync;
    fs.renameSync = originalRenameSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging detects a destination-ancestor swap before writing through the opened descriptor', (t) => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  const detachedDestination = path.join(root, 'detached-owned-stage');
  const external = path.join(root, 'external-destination');
  const sentinel = path.join(external, 'sentinel.txt');
  const redirectedFile = path.join(external, 'LICENSE');
  const targetFile = path.join(destination, 'LICENSE');
  const originalOpenSync = fs.openSync;
  const originalWriteFileSync = fs.writeFileSync;
  const originalRenameSync = fs.renameSync;
  let swapped = false;
  let redirectedIdentity;
  let wroteRedirectedFile = false;
  try {
    git(root, ['add', 'archify']);
    fs.mkdirSync(external);
    fs.writeFileSync(sentinel, 'external sentinel\n');
    const probe = path.join(root, 'destination-symlink-probe');
    try {
      fs.symlinkSync(external, probe, process.platform === 'win32' ? 'junction' : 'dir');
      fs.rmSync(probe, { force: true });
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
        t.skip(`symlinks unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    fs.openSync = function redirectAtOpen(target, ...args) {
      if (!swapped && path.resolve(String(target)) === path.resolve(targetFile)) {
        swapped = true;
        originalRenameSync.call(fs, destination, detachedDestination);
        fs.symlinkSync(external, destination, process.platform === 'win32' ? 'junction' : 'dir');
        const descriptor = originalOpenSync.call(fs, target, ...args);
        redirectedIdentity = fs.fstatSync(descriptor, { bigint: true });
        return descriptor;
      }
      return originalOpenSync.call(fs, target, ...args);
    };
    fs.writeFileSync = function observeRedirectedWrite(target, ...args) {
      if (swapped && typeof target === 'number' && redirectedIdentity) {
        const current = fs.fstatSync(target, { bigint: true });
        if (current.dev === redirectedIdentity.dev && current.ino === redirectedIdentity.ino) {
          wroteRedirectedFile = true;
        }
      }
      return originalWriteFileSync.call(fs, target, ...args);
    };

    assert.throws(
      () => stageCleanSkill({ repoRoot: root, destination }),
      /clean Skill staging directory changed/,
    );
    assert.equal(swapped, true, 'the deterministic destination-ancestor race must run');
    assert.equal(wroteRedirectedFile, false, 'no package bytes may be written through a redirected ancestor');
    assert.equal(fs.existsSync(redirectedFile), false, 'the exclusively created empty file must be retired safely');
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'external sentinel\n');
    assert.equal(fs.lstatSync(destination).isSymbolicLink(), true, 'the ancestor claimant must be preserved');
  } finally {
    fs.openSync = originalOpenSync;
    fs.writeFileSync = originalWriteFileSync;
    fs.renameSync = originalRenameSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging rejects a mode manifest that aliases the staged tree through a symlinked ancestor', (t) => {
  const root = repositoryFixture();
  const physical = path.join(root, 'physical');
  const alias = path.join(root, 'alias');
  try {
    git(root, ['add', 'archify']);
    fs.mkdirSync(physical);
    try {
      fs.symlinkSync(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
        t.skip(`symlinks unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    const cases = [
      { destination: path.join(alias, 'staged'), modeManifest: path.join(physical, 'staged', 'modes.json') },
      { destination: path.join(physical, 'staged'), modeManifest: path.join(alias, 'staged', 'modes.json') },
    ];
    for (const { destination, modeManifest } of cases) {
      assert.throws(
        () => stageCleanSkill({ repoRoot: root, destination, modeManifest }),
        /mode manifest must be written outside the staged Skill tree/,
      );
      assert.equal(
        fs.existsSync(path.join(physical, 'staged')),
        false,
        'a rejected manifest location must not leave a staged tree behind',
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging rejects a symlink in a tracked file ancestor before copying bytes', (t) => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  try {
    const runtime = path.join(root, 'archify', 'runtime');
    write(root, 'archify/runtime/payload.txt', 'tracked fixture\n');
    git(root, ['add', 'archify']);
    fs.rmSync(runtime, { recursive: true });
    const external = path.join(root, 'outside-runtime');
    write(root, 'outside-runtime/payload.txt', 'external secret\n');
    try {
      fs.symlinkSync(external, runtime, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
        t.skip(`symlinks unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    assert.throws(
      () => stageCleanSkill({ repoRoot: root, destination }),
      /refusing to package path through symlink: archify\/runtime/,
    );
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging rejects tracked symlinks before reading through them', (t) => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  try {
    const external = write(root, 'outside.txt', 'private fixture\n');
    const linked = path.join(root, 'archify', 'linked.txt');
    try {
      fs.symlinkSync(external, linked);
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
        t.skip(`symlinks unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    git(root, ['add', 'archify']);

    assert.throws(
      () => stageCleanSkill({ repoRoot: root, destination }),
      /refusing to package tracked symlink: archify\/linked\.txt/,
    );
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging snapshots unstaged tracked bytes before a source ancestor can be swapped', (t) => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  const runtime = path.join(root, 'archify', 'runtime');
  const external = path.join(root, 'outside-runtime');
  const originalMkdirSync = fs.mkdirSync;
  let swapped = false;
  try {
    const payload = write(root, 'archify/runtime/payload.txt', 'indexed fixture\n');
    write(root, 'outside-runtime/payload.txt', 'external secret\n');
    git(root, ['add', 'archify']);
    fs.writeFileSync(payload, 'unstaged working-tree fixture\n');

    const probe = path.join(root, 'symlink-probe');
    try {
      fs.symlinkSync(external, probe, process.platform === 'win32' ? 'junction' : 'dir');
      fs.rmSync(probe, { force: true });
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
        t.skip(`symlinks unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    fs.mkdirSync = function swapSourceAfterSnapshot(target, ...args) {
      const result = originalMkdirSync.call(fs, target, ...args);
      if (!swapped && path.resolve(target) === path.resolve(destination)) {
        fs.rmSync(runtime, { recursive: true });
        fs.symlinkSync(external, runtime, process.platform === 'win32' ? 'junction' : 'dir');
        swapped = true;
      }
      return result;
    };

    stageCleanSkill({ repoRoot: root, destination });

    assert.equal(swapped, true, 'the deterministic ancestor-swap attack must run');
    assert.equal(
      fs.readFileSync(path.join(destination, 'runtime', 'payload.txt'), 'utf8'),
      'unstaged working-tree fixture\n',
      'staging keeps the tracked working-tree snapshot and never follows the replacement ancestor',
    );
  } finally {
    fs.mkdirSync = originalMkdirSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging rejects a source ancestor swapped during preflight traversal', (t) => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  const runtime = path.join(root, 'archify', 'runtime');
  const external = path.join(root, 'outside-runtime');
  const originalLstatSync = fs.lstatSync;
  let swapped = false;
  try {
    write(root, 'archify/runtime/payload.txt', 'tracked fixture\n');
    write(root, 'outside-runtime/payload.txt', 'external secret\n');
    git(root, ['add', 'archify']);
    const canonicalRuntime = path.join(fs.realpathSync(root), 'archify', 'runtime');

    const probe = path.join(root, 'symlink-probe');
    try {
      fs.symlinkSync(external, probe, process.platform === 'win32' ? 'junction' : 'dir');
      fs.rmSync(probe, { force: true });
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
        t.skip(`symlinks unavailable: ${error.code}`);
        return;
      }
      throw error;
    }

    fs.lstatSync = function swapSourceBetweenAncestorAndLeaf(target, ...args) {
      const metadata = originalLstatSync.call(fs, target, ...args);
      if (!swapped && path.resolve(target) === canonicalRuntime) {
        // Guard before mutation: recursive removal can re-enter the patched
        // lstatSync implementation on Linux.
        swapped = true;
        fs.rmSync(runtime, { recursive: true });
        fs.symlinkSync(external, runtime, process.platform === 'win32' ? 'junction' : 'dir');
      }
      return metadata;
    };

    assert.throws(
      () => stageCleanSkill({ repoRoot: root, destination }),
      /(?:tracked package path changed before it could be read: archify\/|tracked package input is missing or unreadable: archify\/runtime\/payload\.txt)/,
    );
    assert.equal(swapped, true, 'the deterministic mid-preflight ancestor swap must run');
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.lstatSync = originalLstatSync;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('clean staging reports the Git spawn error when Git cannot start', () => {
  const root = repositoryFixture();
  const destination = path.join(root, 'staged-skill');
  try {
    git(root, ['add', 'archify']);
    const result = spawnSync(process.execPath, [
      stagerPath,
      '--root', root,
      '--dest', destination,
    ], {
      encoding: 'utf8',
      env: { ...process.env, PATH: '' },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /unable to enumerate tracked Archify files: .*ENOENT/);
    assert.doesNotMatch(result.stderr, /tracked Archify paths must be valid UTF-8/);
    assert.equal(fs.existsSync(destination), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Historical DSH snapshots predate embedded fonts and must remain packageable.
for (const fontPath of [null, 'archify/assets/template.html', 'archify/examples/standalone.html']) {
  const embedded = fontPath !== null;
  test(`clean staging applies font disclosures to snapshot contents (fontPath=${fontPath})`, () => {
    const root = repositoryFixture();
    const destination = path.join(root, 'staged-skill');
    try {
      const legacy = canonicalNotices.replace(/## JetBrains Mono[\s\S]*?(?=\n## |$)/, '');
      write(root, 'THIRD_PARTY_NOTICES.md', legacy);
      write(root, 'archify/THIRD_PARTY_NOTICES.md', legacy);
      write(root, 'archify/assets/template.html', '<html>legacy viewer</html>');
      if (embedded) write(root, fontPath, '@font-face { src: url(data:font/woff2;base64,fixture); }');
      write(root, 'archify/assets/JetBrainsMono-OFL.txt', 'fixture license');
      git(root, ['add', '.']);
      if (embedded) {
        assert.throws(() => stageCleanSkill({ repoRoot: root, destination }), /missing required disclosure: JetBrains Mono/);
        assert.equal(fs.existsSync(destination), false);
        write(root, 'THIRD_PARTY_NOTICES.md', canonicalNotices);
        write(root, 'archify/THIRD_PARTY_NOTICES.md', canonicalNotices);
        stageCleanSkill({ repoRoot: root, destination });
        assert.equal(fs.readFileSync(path.join(destination, 'assets/JetBrainsMono-OFL.txt'), 'utf8'), 'fixture license');
        fs.rmSync(destination, { recursive: true });
        fs.unlinkSync(path.join(root, 'archify/assets/JetBrainsMono-OFL.txt'));
        git(root, ['add', '.']);
        assert.throws(() => stageCleanSkill({ repoRoot: root, destination }), /requires assets\/JetBrainsMono-OFL.txt/);
      } else {
        stageCleanSkill({ repoRoot: root, destination });
        assert.equal(fs.readFileSync(path.join(destination, 'THIRD_PARTY_NOTICES.md'), 'utf8'), legacy);
      }
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}
