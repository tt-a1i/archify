import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { EXTRACT_RUNNER } from './helpers.mjs';
import { describeRepository, stripCredentials } from '../extract/shared/git.mjs';
function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-extract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}
function extract(root, extra = [], env = process.env) {
  return spawnSync(process.execPath, [EXTRACT_RUNNER, root, ...extra], { encoding: 'utf8', timeout: 20000, env });
}
test('CommonJS directory requires find the captured JS entry behind separate declarations', (t) => {
  const root = fixture(t, {
    'package.json': JSON.stringify({ main: './index.js', types: './types/index.d.ts' }),
    'index.js': 'exports.value = 1;',
    'types/index.d.ts': 'export declare const value: number;',
    'test/use.cjs': [
      "require('../');", "require('../nested');", "require('../default/');",
      "require('../shadow/');", "require('../shadow');", "require('../data/');", "import('../');",
    ].join('\n'),
    'test/type.cts': "import type lib = require('../');",
    'nested/package.json': JSON.stringify({ main: './lib/run.cjs', types: '../types/index.d.ts' }),
    'nested/lib/run.cjs': 'module.exports = 1;',
    'default/index.d.ts': 'export declare const value: number;',
    'default/index.js': 'exports.value = 1;',
    'shadow/package.json': JSON.stringify({ main: './index.js', types: '../types/index.d.ts' }),
    'shadow/index.js': '', 'shadow.json': '{}',
    'data/package.json': JSON.stringify({ main: './data.json', types: '../types/index.d.ts' }),
    'data/data.json': '{}', 'data/index.js': '',
  });
  const file = path.join(root, 'facts.json');
  const result = extract(root, ['--language', 'ts', '--out', file, '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const { imports } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const runtime = createRequire(path.join(root, 'test/use.cjs'));
  const requires = imports.filter(edge => edge.from === 'test/use.cjs' && edge.kind === 'require');
  assert.equal(requires.length, 6);
  for (const edge of requires) {
    const target = path.relative(fs.realpathSync(root), runtime.resolve(edge.specifier)).split(path.sep).join('/');
    assert.equal(edge.to, target.endsWith('.json') ? undefined : target, edge.specifier);
  }
  assert.equal(imports.find(edge => edge.kind === 'dynamic').resolved, false);
  assert.equal(imports.find(edge => edge.typeOnly).resolved, false);
});

test('capturing declarations distinguishes a directory require from a type-only import', (t) => {
  const root = fixture(t, {
    'package.json': JSON.stringify({ main: './index.js', types: './types/index.d.ts' }),
    'index.js': 'exports.value = 1;', 'types/index.d.ts': 'export declare const value: number;',
    'test/use.cjs': "require('../');", 'test/use.cts': "import type lib = require('../');",
    'config.json': JSON.stringify({ exclude: [] }),
  });
  const result = extract(root, ['--language', 'ts', '--config', path.join(root, 'config.json')]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const { imports } = JSON.parse(result.stdout);
  assert.equal(imports.find(edge => edge.from === 'test/use.cjs').to, 'index.js');
  assert.equal(imports.find(edge => edge.typeOnly).to, 'types/index.d.ts');
});

test('extract preserves import-equals and ignores locally bound require calls', (t) => {
  const root = fixture(t, {
    'dep.ts': 'export const value = 1;\n',
    'entry.ts': `import dep = require('./dep');
require('./dep');
function parameter(require: (s: string) => string) { require('./dep'); }
function local() { require('./dep'); var require = (s: string) => s; }
{ const { require } = { require: (s: string) => s }; require('./dep'); }
try {} catch (require) { require('./dep'); }
export {};
`,
    'loader.mjs': `import { createRequire as makeRequire } from 'node:module';
const require = makeRequire(import.meta.url);
require('./dep');`,
    'other-base.mjs': `import { createRequire } from 'node:module';
const require = createRequire('/another/project/entry.mjs');
require('./dep');`,
    'arrow.ts': `export const f = (require: (s: string) => string) => require('./dep');`,
  });
  const result = extract(root);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).imports.map(({ from, line, to, kind }) => ({ from, line, to, kind })), [
    { from: 'entry.ts', line: 1, to: 'dep.ts', kind: 'require' },
    { from: 'entry.ts', line: 2, to: 'dep.ts', kind: 'require' },
    { from: 'loader.mjs', line: 1, to: undefined, kind: 'static' },
    { from: 'loader.mjs', line: 3, to: 'dep.ts', kind: 'require' },
    { from: 'other-base.mjs', line: 1, to: undefined, kind: 'static' },
  ]);
});
test('extract rejects an unmatched configured brace without hanging or writing output', (t) => {
  const root = fixture(t, { 'index.ts': 'export {};', 'config.json': JSON.stringify({ include: ['**/*.{ts,js'] }) });
  const out = path.join(root, 'facts.json');
  const result = extract(root, ['--config', path.join(root, 'config.json'), '--out', out, '--json']);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'cli/config-invalid');
  assert.equal(fs.existsSync(out), false);
});
test('extract bytes do not depend on locale for Unicode paths', (t) => {
  const root = fixture(t, { 'ä/entry.mjs': "import 'node:fs';", 'z/entry.mjs': "import 'node:fs';" });
  const a = extract(root, [], { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' });
  const b = extract(root, [], { ...process.env, LANG: 'sv_SE.UTF-8', LC_ALL: 'sv_SE.UTF-8' });
  assert.equal(a.status, 0, a.stderr);
  assert.equal(b.status, 0, b.stderr);
  assert.equal(a.stdout, b.stdout);
  assert.deepEqual(JSON.parse(a.stdout).imports.map((i) => i.from), ['z/entry.mjs', 'ä/entry.mjs']);
});
test('repository roots are relative to Git through directory aliases', (t) => {
  const root = fixture(t, { 'repo/sub/entry.ts': 'export {};' });
  const repo = path.join(root, 'repo');
  const init = spawnSync('git', ['init', repo], { encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const alias = path.join(root, 'alias');
  fs.symlinkSync(repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(describeRepository(alias).root, '.');
  assert.equal(describeRepository(path.join(alias, 'sub')).root, 'sub');
});

test('an in-root directory whose name starts with ".." is not classified as outside', (t) => {
  const root = fixture(t, {
    '..generated/table.mjs': 'export const table = [];\n',
    'entry.mjs': "import { table } from './..generated/table.mjs';\nexport { table };\n",
  });
  const out = path.join(root, 'facts.json');
  const result = extract(root, ['--out', out, '--json']);
  assert.equal(result.status, 0, result.stdout);
  const facts = JSON.parse(fs.readFileSync(out, 'utf8'));
  const edge = facts.imports.find((i) => i.from === 'entry.mjs');
  assert.equal(edge.resolved, true);
  assert.equal(edge.to, '..generated/table.mjs');
  assert.deepEqual(facts.unresolved, { external: 0, outside: 0, unknown: 0, opaque: 0 });
});

test('Python records a NUL byte as a per-file parse error', (t) => {
  const root = fixture(t, { 'broken.py': 'value = 1\0\n', 'valid.py': 'value = 2\n' });
  const out = path.join(root, 'facts.json');
  const result = extract(root, ['--language', 'py', '--out', out, '--json']);
  assert.equal(result.status, 0, result.stdout || result.stderr);
  const facts = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(facts.parse_errors.map((error) => error.path), ['broken.py']);
  assert.deepEqual(facts.files.map((file) => file.path), ['broken.py', 'valid.py']);
});

test('raw-facts schema requires unresolved counters and enforces the resolved/to invariant', async () => {
  const { schemaErrors } = await import('../extract/shared/schema.mjs');
  const base = {
    schema_version: 1,
    repository: { root: '.', revision: null, sourceKind: 'working-tree', snapshotId: '0'.repeat(64), url: null, language: 'ts', adapter: 'typescript@test' },
    files: [{ path: 'a.mjs', sourceText: '', loc: 1, role: 'source' }, { path: 'b.mjs', sourceText: '', loc: 1, role: 'source' }],
    imports: [],
    symbols: [],
    calls: [],
    unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 },
  };
  assert.deepEqual(schemaErrors('raw-facts', base), []);

  const { sourceKind, ...repositoryWithoutSourceKind } = base.repository;
  assert.ok(schemaErrors('raw-facts', { ...base, repository: repositoryWithoutSourceKind }).length, 'missing sourceKind must fail');
  const { snapshotId, ...repositoryWithoutSnapshotId } = base.repository;
  assert.ok(schemaErrors('raw-facts', { ...base, repository: repositoryWithoutSnapshotId }).length, 'missing snapshotId must fail');
  const { sourceText, ...fileWithoutSourceText } = base.files[0];
  assert.ok(schemaErrors('raw-facts', { ...base, files: [fileWithoutSourceText, base.files[1]] }).length, 'missing sourceText must fail');

  const { unresolved, ...missingCounters } = base;
  assert.ok(schemaErrors('raw-facts', missingCounters).length, 'missing unresolved must fail');
  assert.ok(schemaErrors('raw-facts', { ...base, unresolved: { external: 0 } }).length, 'partial counters must fail');

  const edge = { from: 'a.mjs', specifier: './b.mjs', kind: 'static', line: 1 };
  assert.ok(schemaErrors('raw-facts', { ...base, imports: [{ ...edge, resolved: true }] }).length, 'resolved without to must fail');
  assert.ok(schemaErrors('raw-facts', { ...base, imports: [{ ...edge, resolved: false, to: 'b.mjs' }] }).length, 'unresolved with to must fail');
  assert.deepEqual(schemaErrors('raw-facts', { ...base, imports: [{ ...edge, resolved: true, to: 'b.mjs' }] }), []);
  assert.deepEqual(schemaErrors('raw-facts', { ...base, imports: [{ ...edge, resolved: false }], unresolved: { ...base.unresolved, unknown: 1 } }), []);
});

test('regression: a credentialed origin (https://user@github.com/…) is recorded without the credential, so evidence mode and links still work', (t) => {
  assert.equal(stripCredentials('https://yijiez666-alt@github.com/a/b.git'), 'https://github.com/a/b.git');
  assert.equal(stripCredentials('https://user:token@github.com/a/b'), 'https://github.com/a/b');
  assert.equal(stripCredentials('git@github.com:a/b.git'), 'git@github.com:a/b.git', 'ssh form is untouched');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-origin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q'); git('remote', 'add', 'origin', 'https://someone@github.com/someone/repo.git');
  assert.equal(describeRepository(root).url, 'https://github.com/someone/repo.git');
});
