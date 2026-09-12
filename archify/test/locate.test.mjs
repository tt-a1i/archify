import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateSchema } from '../renderers/shared/validator.mjs';
import { LocateError } from '../locate/error.mjs';
import { locateLint, locateRange, lintTree } from '../locate/locate.mjs';

function git(repo, ...args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

function write(repo, filePath, contents) {
  const abs = path.join(repo, filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
}

function mapDoc(sources = { cli: ['bin/cli.mjs'], core: ['src/main.mjs'] }) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Locate fixture' },
    components: [
      { id: 'cli', type: 'frontend', label: 'CLI', sources: sources.cli?.map((filePath) => ({ path: filePath })) },
      { id: 'core', type: 'backend', label: 'Core', sources: sources.core?.map((filePath) => ({ path: filePath })) },
    ],
    connections: [{ id: 'cli-core', from: 'cli', to: 'core' }],
  };
}

function ownershipDoc(extra = {}) {
  return {
    schema_version: 1,
    kind: 'ownership',
    map: 'map.architecture.json',
    excluded: extra.excluded || ['vendor/**'],
    components: extra.components || [
      { id: 'cli', globs: ['bin/**'] },
      { id: 'core', globs: ['src/**'] },
    ],
  };
}

function repoFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-locate-repo-'));
  git(root, 'init');
  git(root, 'config', 'user.name', 'Archify Tests');
  git(root, 'config', 'user.email', 'archify@example.test');
  git(root, 'config', 'commit.gpgsign', 'false');
  write(root, 'bin/cli.mjs', 'console.log("cli")\n');
  write(root, 'src/main.mjs', 'export const n = 1\n');
  write(root, 'src/util.mjs', 'export const u = 1\n');
  write(root, 'vendor/lock.txt', 'lock\n');
  write(root, 'README.md', 'readme\n');
  write(root, 'map.architecture.json', JSON.stringify(mapDoc(), null, 2));
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'base');
  const base = git(root, 'rev-parse', 'HEAD');

  write(root, 'bin/cli.mjs', 'console.log("cli2")\n');
  write(root, 'src/added.mjs', 'export const a = 1\n');
  fs.unlinkSync(path.join(root, 'src/util.mjs'));
  fs.renameSync(path.join(root, 'src/main.mjs'), path.join(root, 'bin/moved.mjs'));
  write(root, 'typed.txt', 'plain\n');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'text');
  write(root, 'typed.txt', '#!/bin/sh\n');
  git(root, 'add', 'typed.txt');
  git(root, 'update-index', '--chmod=+x', 'typed.txt');
  write(root, 'vendor/lock.txt', 'lock2\n');
  git(root, 'add', 'vendor/lock.txt');
  git(root, 'commit', '-m', 'head');
  const head = git(root, 'rev-parse', 'HEAD');
  return { root, base, head };
}

test('range classifies A/M/D/R/T, excluded, and validates the receipt', async () => {
  const { parseNameStatus } = await import('../locate/git.mjs');
  const { root, base, head } = repoFixture();
  const stdout = execFileSync('git', ['-C', root, 'diff', '--name-status', '-M', '-z', base, head]).toString('utf8');
  const changes = parseNameStatus(stdout);
  const headTree = execFileSync('git', ['-C', root, 'ls-tree', '-r', '--name-only', head], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  const map = mapDoc({ cli: ['bin/cli.mjs'], core: ['src/gone.mjs'] });
  const ownership = ownershipDoc();
  const receipt = locateRange({
    base,
    head,
    map,
    ownership,
    changes,
    headTree,
    mapPath: 'map.architecture.json',
    ownershipPath: 'map.architecture.ownership.json',
    ownershipSha256: 'a'.repeat(64),
  });
  const types = new Set(receipt.files.map((file) => file.changeType));
  assert.ok(types.has('A') || receipt.files.some((file) => file.path === 'src/added.mjs'));
  assert.ok(receipt.files.some((file) => file.path === 'bin/cli.mjs' && file.changeType === 'M' && file.state === 'touched'));
  assert.ok(receipt.files.some((file) => file.path === 'src/util.mjs' && file.changeType === 'D' && file.state === 'touched'));
  assert.ok(receipt.files.some((file) => file.changeType === 'R' && file.side === 'base'));
  assert.ok(receipt.files.some((file) => file.changeType === 'R' && file.side === 'head' && file.renamedFrom));
  assert.ok(receipt.files.some((file) => file.path.startsWith('vendor/') && file.state === 'excluded'));
  const core = receipt.components.find((component) => component.id === 'core');
  assert.equal(core.state, 'stale');
  assert.equal(core.staleSources[0].path, 'src/gone.mjs');
  const renamed = receipt.files.find((file) => file.changeType === 'R' && file.side === 'head');
  assert.ok(renamed, 'fixture must rename a file with git -M detection');
  assert.equal(renamed.renamedFrom, 'src/main.mjs');
  assert.equal(renamed.path, 'bin/moved.mjs');
  const move = receipt.facts.find((fact) => fact.kind === 'moved_between_components');
  assert.ok(move);
  assert.equal(move.base.path, renamed.renamedFrom);
  assert.equal(move.head.path, renamed.path);
  validateSchema('locate-receipt', receipt);
  const again = locateRange({
    base, head, map, ownership, changes, headTree,
    mapPath: 'map.architecture.json',
    ownershipPath: 'map.architecture.ownership.json',
    ownershipSha256: 'a'.repeat(64),
  });
  assert.equal(JSON.stringify(receipt), JSON.stringify(again));
});

test('ambiguous classification and lintTree warning counts', () => {
  const ownership = ownershipDoc({
    components: [
      { id: 'cli', globs: ['src/**'] },
      { id: 'core', globs: ['src/**'] },
    ],
  });
  const { files, summary } = lintTree({
    tree: ['src/main.mjs', 'README.md', 'vendor/lock.txt'],
    ownership,
  });
  assert.equal(files.find((file) => file.path === 'src/main.mjs').state, 'ambiguous');
  assert.equal(summary.ambiguous, 1);
  assert.equal(summary.uncovered, 1);
  assert.equal(summary.excluded, 1);
});

test('stale rename hint and mapDelta pointer', () => {
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  const map = mapDoc({ cli: ['src/old.mjs'], core: ['src/main.mjs'] });
  const ownership = ownershipDoc();
  const receipt = locateRange({
    base,
    head,
    map,
    ownership,
    changes: [
      { changeType: 'R', oldPath: 'src/old.mjs', path: 'bin/new.mjs' },
      { changeType: 'M', path: 'map.architecture.json' },
    ],
    headTree: ['bin/new.mjs', 'src/main.mjs', 'map.architecture.json'],
    mapPath: 'map.architecture.json',
    ownershipPath: 'map.architecture.ownership.json',
    ownershipSha256: 'a'.repeat(64),
  });
  const cli = receipt.components.find((component) => component.id === 'cli');
  assert.equal(cli.state, 'stale');
  assert.deepEqual(cli.staleSources, [{ path: 'src/old.mjs', renamedTo: 'bin/new.mjs' }]);
  assert.deepEqual(receipt.mapDelta, {
    path: 'map.architecture.json',
    baseBlob: `${base}:map.architecture.json`,
    headBlob: `${head}:map.architecture.json`,
  });
  validateSchema('locate-receipt', receipt);
});

test('facts map unmapped endpoints to componentId null', () => {
  const receipt = locateRange({
    base: 'a'.repeat(40),
    head: 'b'.repeat(40),
    map: mapDoc(),
    ownership: ownershipDoc(),
    changes: [{ changeType: 'M', path: 'bin/cli.mjs' }],
    headTree: ['bin/cli.mjs', 'src/main.mjs'],
    facts: {
      before: {
        imports: [
          { from: 'bin/cli.mjs', to: 'docs/guide.md', specifier: '../docs/guide.md', kind: 'static', line: 3, resolved: true },
        ],
      },
      after: {
        imports: [
          { from: 'bin/cli.mjs', to: 'src/main.mjs', specifier: '../src/main.mjs', kind: 'static', line: 9, resolved: true },
        ],
      },
    },
    mapPath: 'map.architecture.json',
    ownershipPath: 'map.architecture.ownership.json',
    ownershipSha256: 'a'.repeat(64),
  });
  const added = receipt.facts.find((fact) => fact.kind === 'import_edge_change' && fact.change === 'added');
  const removed = receipt.facts.find((fact) => fact.kind === 'import_edge_change' && fact.change === 'removed');
  assert.equal(added.from.componentId, 'cli');
  assert.equal(added.to.componentId, 'core');
  assert.equal(removed.to.componentId, null);
  validateSchema('locate-receipt', receipt);
});

test('facts keep an edge when an endpoint fails the repo-path check', () => {
  const receipt = locateRange({
    base: 'a'.repeat(40),
    head: 'b'.repeat(40),
    map: mapDoc(),
    ownership: ownershipDoc(),
    changes: [{ changeType: 'M', path: 'bin/cli.mjs' }],
    headTree: ['bin/cli.mjs', 'src/main.mjs'],
    facts: {
      before: { imports: [] },
      after: {
        imports: [
          { from: '/abs/out.js', to: 'src/main.mjs', specifier: './main.mjs', kind: 'static', resolved: true },
        ],
      },
    },
    mapPath: 'map.architecture.json',
    ownershipPath: 'map.architecture.ownership.json',
    ownershipSha256: 'a'.repeat(64),
  });
  const added = receipt.facts.find((fact) => fact.kind === 'import_edge_change' && fact.change === 'added');
  assert.equal(added.from.path, '/abs/out.js');
  assert.equal(added.from.componentId, null);
  assert.equal(added.to.componentId, 'core');
  validateSchema('locate-receipt', receipt);
});

test('facts reject a non-string endpoint as facts-invalid', () => {
  assert.throws(
    () => locateRange({
      base: 'a'.repeat(40),
      head: 'b'.repeat(40),
      map: mapDoc(),
      ownership: ownershipDoc(),
      changes: [{ changeType: 'M', path: 'bin/cli.mjs' }],
      headTree: ['bin/cli.mjs'],
      facts: {
        before: { imports: [] },
        after: {
          imports: [
            { from: 'bin/cli.mjs', to: 12, specifier: './x', kind: 'static', resolved: true },
          ],
        },
      },
    }),
    (error) => error instanceof LocateError && error.code === 'locate/facts-invalid',
  );
});

test('inside counts only range paths in the parent component scope', () => {
  const receipt = locateRange({
    base: 'a'.repeat(40),
    head: 'b'.repeat(40),
    map: {
      schema_version: 1,
      diagram_type: 'architecture',
      meta: { title: 'Inside' },
      components: [
        { id: 'parent', type: 'backend', label: 'Parent' },
        { id: 'other', type: 'backend', label: 'Other' },
      ],
    },
    ownership: {
      components: [
        { id: 'parent', globs: ['a/**'], child_map: 'child.json' },
        { id: 'other', globs: ['b/**'] },
      ],
    },
    changes: [
      { changeType: 'M', path: 'a/x/1' },
      { changeType: 'M', path: 'a/y/2' },
      { changeType: 'M', path: 'b/3' },
    ],
    headTree: ['a/x/1', 'a/y/2', 'b/3'],
    children: {
      parent: {
        components: [{ id: 'leaf', globs: ['a/x/**'] }],
      },
    },
    mapPath: 'map.json',
    ownershipPath: 'map.ownership.json',
    ownershipSha256: 'a'.repeat(64),
  });
  assert.deepEqual(receipt.components.find((component) => component.id === 'parent').inside, {
    touched: 1,
    uncovered: 1,
    ambiguous: 0,
    excluded: 0,
  });
});

test('lint receipt uses tracked changeType and revision', () => {
  const receipt = locateLint({
    revision: 'c'.repeat(40),
    map: mapDoc(),
    ownership: ownershipDoc(),
    tree: ['bin/cli.mjs', 'README.md'],
    mapPath: 'map.architecture.json',
    ownershipPath: 'map.architecture.ownership.json',
    ownershipSha256: 'a'.repeat(64),
  });
  assert.equal(receipt.mode, 'lint');
  assert.equal(receipt.repository.revision, 'c'.repeat(40));
  assert.ok(!receipt.repository.base);
  assert.equal(receipt.files[0].changeType, 'tracked');
  validateSchema('locate-receipt', receipt);
});

test('newline path fails closed as locate/path-invalid instead of an invalid receipt', () => {
  assert.throws(
    () => locateRange({
      base: 'a'.repeat(40),
      head: 'b'.repeat(40),
      map: mapDoc(),
      ownership: ownershipDoc(),
      changes: [{ changeType: 'M', path: 'src/new\nline.mjs' }],
      headTree: ['src/new\nline.mjs'],
      mapPath: 'map.architecture.json',
      ownershipPath: 'map.architecture.ownership.json',
      ownershipSha256: 'a'.repeat(64),
    }),
    (error) => error instanceof LocateError && error.code === 'locate/path-invalid',
  );
});
