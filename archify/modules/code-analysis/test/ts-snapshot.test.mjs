import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { extract } from '../extract/ts/index.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../config/defaults.json', import.meta.url)));
function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ts-snapshot-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

// The first compiler-host case-sensitivity query happens after input capture.
// Mutate the real fixture at that boundary, without adding a product test hook.
function afterCapture(action, operation) {
  const descriptor = Object.getOwnPropertyDescriptor(ts.sys, 'useCaseSensitiveFileNames');
  let ran = false;
  Object.defineProperty(ts.sys, 'useCaseSensitiveFileNames', { configurable: true, get() {
    if (!ran) { ran = true; action(); }
    return descriptor.value;
  } });
  try { const result = operation(); assert.ok(ran); return result; }
  finally { Object.defineProperty(ts.sys, 'useCaseSensitiveFileNames', descriptor); }
}

test('TypeScript pins root and extended config, package metadata, sources and resolution inventory', t => {
  const root = fixture(t, {
    'entry.ts': 'import { value } from "@dep"; import "./pkg"; import "./choice";',
    'old.ts': 'export const value = 1;', 'new.ts': 'export const value = 2;',
    'choice.js': 'export {};',
    'tsconfig.json': JSON.stringify({ extends: './configs/base.json' }),
    'configs/base.json': JSON.stringify({ compilerOptions: { baseUrl: '..', paths: { '@dep': ['old.ts'] } } }),
    'pkg/package.json': JSON.stringify({ types: 'old.ts' }),
    'pkg/old.ts': 'export {};', 'pkg/new.ts': 'export {};',
  });
  const before = extract(root, config);
  const after = afterCapture(() => {
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{}');
    fs.writeFileSync(path.join(root, 'configs/base.json'), JSON.stringify({ compilerOptions: { baseUrl: '..', paths: { '@dep': ['new.ts'] } } }));
    fs.writeFileSync(path.join(root, 'pkg/package.json'), JSON.stringify({ types: 'new.ts' }));
    fs.unlinkSync(path.join(root, 'old.ts'));
    fs.writeFileSync(path.join(root, 'choice.ts'), 'export {};');
  }, () => extract(root, config));
  assert.deepEqual(after.imports, before.imports);
  assert.deepEqual(after.files, before.files);
  assert.deepEqual(before.imports.map(e => e.to).sort(), ['choice.js', 'old.ts', 'pkg/old.ts']);
});

test('a tsconfig created after capture cannot change analysis options', t => {
  const root = fixture(t, { 'entry.ts': 'import { type T } from "./dep";', 'dep.ts': 'export interface T {}' });
  const result = afterCapture(() => {
    fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { verbatimModuleSyntax: true } }));
  }, () => extract(root, config));
  assert.equal(result.imports[0].typeOnly, true);
});

test('excluded source stays outside facts but remains known to resolution', t => {
  const root = fixture(t, { 'entry.ts': 'import "./types";', 'types.d.ts': 'export interface T {}' });
  const facts = extract(root, config);
  assert.deepEqual(facts.files.map(f => f.path), ['entry.ts']);
  assert.equal(facts.imports[0].resolved, false);
  assert.equal(facts.unresolved.unknown, 1);
});

test('installed configuration packages remain supported and changes invalidate analysis', t => {
  const root = fixture(t, {
    'entry.ts': 'import { type T } from "./dep";', 'dep.ts': 'export interface T {}',
    'tsconfig.json': JSON.stringify({ extends: 'base-config' }),
    'node_modules/base-config/package.json': JSON.stringify({ name: 'base-config', tsconfig: 'base.json' }),
    'node_modules/base-config/base.json': JSON.stringify({ compilerOptions: { verbatimModuleSyntax: true } }),
  });
  assert.equal(extract(root, config).imports[0].typeOnly, undefined);
  const read = ts.sys.readFile;
  let changed = false;
  ts.sys.readFile = file => {
    const text = read(file);
    if (!changed && path.resolve(file) === path.join(root, 'node_modules/base-config/base.json')) {
      changed = true; fs.writeFileSync(file, '{}');
    }
    return text;
  };
  try { assert.throws(() => extract(root, config), error => error.diagnostics?.[0].code === 'extract/source-changed'); }
  finally { ts.sys.readFile = read; }
  assert.ok(changed);
});

test('unusual config extensions cannot change between capture and first use', t => {
  const root = fixture(t, { 'entry.ts': 'export {};', 'tsconfig.json': '{"extends":"./base.config"}', 'base.config': '{}' });
  afterCapture(() => fs.writeFileSync(path.join(root, 'base.config'), '{"compilerOptions":{"strict":true}}'), () => {
    assert.throws(() => extract(root, config), error => error.diagnostics?.[0].code === 'extract/source-changed');
  });
});

test('captured TypeScript configuration preserves UTF-16 BOM support', t => {
  const root = fixture(t, {
    'entry.ts': 'import { type T } from "./dep";', 'dep.ts': 'export interface T {}',
    'tsconfig.json': Buffer.from('\ufeff{"compilerOptions":{"verbatimModuleSyntax":true}}', 'utf16le'),
  });
  assert.equal(extract(root, config).imports[0].typeOnly, undefined);
});

test('JavaScript package and ESM references select implementations while TypeScript keeps declarations', t => {
  const root = fixture(t, {
    'package.json': JSON.stringify({ name: 'package-entry-fixture', type: 'module',
      exports: { '.': { types: './index.d.ts', import: './index.mjs', require: './index.cjs' },
        './missing': { types: './index.d.ts', import: './missing.js' },
        './excluded': { types: './index.d.ts', import: './excluded.js' } },
      imports: { '#entry': { types: './index.d.ts', import: './index.mjs', require: './index.cjs' } } }),
    'index.d.ts': 'export declare const value: string;',
    'index.mjs': 'export const value = "esm";',
    'index.cjs': 'exports.value = "cjs";',
    'index.mts': 'export const value = "typescript-esm";',
    'index.cts': 'export const value = "typescript-cjs";',
    'excluded.js': 'export const value = "excluded";',
    'relative.js': 'export const value = "runtime";',
    'relative.d.ts': 'export declare const value: string;',
    'entry.mjs': 'import {value} from "package-entry-fixture";\nexport {value} from "#entry";\nimport "package-entry-fixture/missing";\nimport "package-entry-fixture/excluded";\nimport "./relative.js";\n',
    'entry.cjs': 'require("package-entry-fixture");\nimport("#entry");\n',
    'types.ts': 'import type {value} from "package-entry-fixture";',
    'values.ts': 'import {value} from "package-entry-fixture";',
  });
  for (const includeDeclarations of [false, true]) {
    const facts = extract(root, { ...config, exclude: [...(includeDeclarations ? [] : config.exclude), '**/excluded.js'] });
    const targets = from => facts.imports.filter(e => e.from === from).map(e => e.to);
    assert.deepEqual(targets('entry.mjs'), ['index.mjs', 'index.mjs', undefined, undefined, 'relative.js']);
    assert.deepEqual(targets('entry.cjs'), ['index.cjs', 'index.mjs']);
    for (const file of ['types.ts', 'values.ts']) assert.deepEqual(targets(file), [includeDeclarations ? 'index.d.ts' : undefined]);
    assert.equal(facts.imports.find(e => e.from === 'types.ts').typeOnly, true);
  }
});

test('JavaScript package implementation fallback uses the captured manifest and source inventory', t => {
  const manifest = target => JSON.stringify({ type: 'module', imports: { '#entry': { types: './entry.d.ts', import: target } } });
  const root = fixture(t, {
    'package.json': manifest('./old.mjs'),
    'entry.d.ts': 'export declare const value: string;',
    'entry.mjs': 'import {value} from "#entry";',
    'old.mjs': 'export const value = "captured";',
  });
  const result = afterCapture(() => {
    fs.writeFileSync(path.join(root, 'package.json'), manifest('./new.mjs'));
    fs.unlinkSync(path.join(root, 'old.mjs'));
    fs.writeFileSync(path.join(root, 'new.mjs'), 'export const value = "live";');
  }, () => extract(root, config));
  assert.equal(result.imports[0].to, 'old.mjs');
  assert.equal(result.files.find(f => f.path === 'old.mjs').sourceText, 'export const value = "captured";');
  assert.ok(!result.files.some(f => f.path === 'new.mjs'));
});

test('runtime conditional null blocks siblings while arrays retain their next target', t => {
  const root = fixture(t, {
    'package.json': JSON.stringify({ name: 'conditional-null-self', type: 'module', imports: {
      '#conditional': { import: null, default: './fallback.cjs' },
      '#require-blocked': { require: null, default: './fallback.cjs' },
      '#nested': { node: { import: null, default: './fallback.cjs' }, default: './fallback.cjs' },
      '#array': [null, './fallback.cjs'],
      '#conditional-in-array': [{ import: null, default: './fallback.cjs' }, './array-next.cjs'],
      '#empty': [], '#inactive': { browser: null, default: './fallback.cjs' },
      '#typed-blocked': { types: './types.d.ts', import: null, default: './fallback.cjs' },
    }, exports: { '.': { import: null, default: './fallback.cjs' },
      './blocked': { import: null, default: './fallback.cjs' }, './array': [null, './fallback.cjs'] } }),
    'fallback.cjs': 'exports.value = 1;', 'array-next.cjs': 'exports.value = 2;',
    'types.d.ts': 'export declare const value: number;',
    'entry.mjs': ['#conditional', '#require-blocked', '#nested', '#array', '#conditional-in-array', '#empty', '#inactive', '#typed-blocked', 'conditional-null-self/blocked', 'conditional-null-self/array', 'conditional-null-self'].map(s => `import "${s}";`).join('\n'),
    'entry.js': 'import "#conditional";\nimport "#typed-blocked";',
    'entry.cjs': 'require("#conditional");\nrequire("#require-blocked");\nimport("#conditional");\nrequire("#array");',
    'mixed.mjs': 'import {createRequire} from "node:module";\nconst require = createRequire(import.meta.url);\nimport "#conditional";\nrequire("#conditional");',
    'types.ts': 'import type {value} from "#typed-blocked";',
    'values.ts': 'import {value} from "#typed-blocked";',
    'view.jsx': 'import {value} from "#typed-blocked";',
    'view.tsx': 'import {value} from "#typed-blocked";',
  });
  const facts = extract(root, { ...config, exclude: [] });
  const targets = file => facts.imports.filter(e => e.from === file).map(e => e.to);
  // Frozen Node22 resolution-only outcomes, not generated from this extractor.
  assert.deepEqual(targets('entry.mjs'), [undefined, 'fallback.cjs', undefined, 'fallback.cjs', 'array-next.cjs', undefined, 'fallback.cjs', undefined, undefined, 'fallback.cjs', undefined]);
  assert.deepEqual(targets('entry.js'), [undefined, undefined]);
  assert.deepEqual(targets('entry.cjs'), ['fallback.cjs', undefined, undefined, 'fallback.cjs']);
  assert.deepEqual(targets('mixed.mjs'), [undefined, undefined, 'fallback.cjs']);
  for (const file of ['types.ts', 'values.ts', 'view.jsx', 'view.tsx']) assert.deepEqual(targets(file), ['types.d.ts'], file);
  assert.equal(facts.imports.find(e => e.from === 'types.ts').typeOnly, true);
});

test('runtime package arrays stop at selected or unsupported targets, not capture availability', t => {
  const root = fixture(t, {
    'package.json': JSON.stringify({ name: 'array-boundaries', type: 'module', imports: {
      '#empty-array': { import: [], default: './fallback.cjs' },
      '#empty-object': { import: {}, default: './fallback.cjs' },
      '#missing': ['./missing.cjs', null, './fallback.cjs'],
      '#excluded': ['./excluded.cjs', null, './fallback.cjs'],
      '#redirect': ['some-package', null, './fallback.cjs'],
      '#json': ['./data.json', null, './fallback.cjs'],
      '#addons': { 'node-addons': null, default: './fallback.cjs' },
      '#sync': { 'module-sync': null, default: './fallback.cjs' },
      '#wild/*': { import: null, default: './fallback.cjs' },
      '#ordinary': { types: './types.d.ts', import: './fallback.cjs' },
    }, exports: { './fallback': [[], null, {}, 'builtin:x', './fallback.cjs'] } }),
    'entry.mjs': ['#empty-array', '#empty-object', '#missing', '#excluded', '#redirect', '#json', '#addons', '#sync', '#wild/x', '#ordinary', 'array-boundaries/fallback'].map(s => `import "${s}";`).join('\n'),
    'fallback.cjs': 'exports.value = 1;', 'excluded.cjs': 'exports.value = 2;',
    'types.d.ts': 'export declare const value: number;', 'data.json': '{}',
    'nested/package.json': '{}', 'nested/entry.mjs': 'import "#empty-array";',
  });
  const facts = extract(root, { ...config, exclude: ['**/excluded.cjs'] });
  const edges = facts.imports.filter(e => e.from === 'entry.mjs');
  assert.deepEqual(edges.map(e => e.to), [undefined, 'fallback.cjs', undefined, undefined, undefined, undefined, undefined, undefined, undefined, 'fallback.cjs', 'fallback.cjs']);
  assert.equal(facts.imports.find(e => e.from === 'nested/entry.mjs').resolved, false);
  // The export array above is the exact target value in Node's pinned
  // pkgexports/fallbackfile regression fixture: invalid alternatives may fall through.
});

test('runtime package correction respects custom conditions, option gates and captured metadata', t => {
  const manifest = target => JSON.stringify({ type: 'module', imports: {
    '#entry': [{ import: null, default: './fallback.cjs' }, target],
    '#browser': { browser: null, default: './fallback.cjs' },
  } });
  const root = fixture(t, { 'package.json': manifest('./old.mjs'),
    'entry.mjs': 'import "#entry";\nimport "#browser";',
    'old.mjs': 'export {};', 'fallback.cjs': 'exports.value = 1;',
  });
  const captured = afterCapture(() => {
    fs.writeFileSync(path.join(root, 'package.json'), manifest('./new.mjs'));
    fs.writeFileSync(path.join(root, 'new.mjs'), 'export {};');
    fs.unlinkSync(path.join(root, 'old.mjs'));
  }, () => extract(root, config));
  assert.deepEqual(captured.imports.map(e => e.to), ['old.mjs', 'fallback.cjs']);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { customConditions: ['browser'] } }));
  assert.deepEqual(extract(root, config).imports.map(e => e.to), ['new.mjs', undefined]);
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    resolvePackageJsonImports: false, paths: { '#browser': ['./fallback.cjs'] },
  } }));
  assert.equal(extract(root, config).imports.find(e => e.specifier === '#browser').to, 'fallback.cjs');
  const exportsRoot = fixture(t, {
    'package.json': JSON.stringify({ name: 'exports-disabled', type: 'module', exports: { import: null, default: './fallback.cjs' } }),
    'entry.mjs': 'import "exports-disabled";', 'fallback.cjs': 'exports.value = 1;',
    'tsconfig.json': JSON.stringify({ compilerOptions: { resolvePackageJsonExports: false, paths: { 'exports-disabled': ['./fallback.cjs'] } } }),
  });
  assert.equal(extract(exportsRoot, config).imports[0].to, 'fallback.cjs');
});
