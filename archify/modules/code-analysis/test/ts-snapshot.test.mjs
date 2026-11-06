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
