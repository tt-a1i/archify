// Independent inputs for the same-version tsserver/Compiler API peer tests.
// These are product differential probes, separate from migrated upstream cases.
export const PROJECT_CASES = [
  { id: 'project/jsconfig-paths', entry: 'src/main.js', config: 'jsconfig.json', files: {
    'jsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '@lib': ['src/lib.js'] } } },
    'src/main.js': 'import { run } from "@lib"; run();', 'src/lib.js': 'export function run() {}',
  } },
  { id: 'project/tsconfig-paths', entry: 'src/main.js', config: 'tsconfig.json', files: {
    'tsconfig.json': { compilerOptions: { allowJs: true, baseUrl: '.', paths: { '@lib': ['src/lib.js'] } } },
    'src/main.js': 'import { run } from "@lib"; run();', 'src/lib.js': 'export function run() {}',
  } },
  { id: 'project/excluded-import', entry: 'src/main.js', config: 'jsconfig.json', files: {
    'jsconfig.json': { include: ['src/main.js'], exclude: ['src/hidden/**'] },
    'src/main.js': 'import { run } from "./hidden/run.js"; run();',
    'src/hidden/run.js': 'export function run() {}', 'src/hidden/unused.js': 'export {};',
  } },
  { id: 'project/files-before-exclude', entry: 'main.js', config: 'jsconfig.json', files: {
    'jsconfig.json': { files: ['main.js', 'run.js'], exclude: ['run.js'] },
    'main.js': 'import { run } from "./run.js"; run();', 'run.js': 'export function run() {}',
  } },
  { id: 'project/extends-relative', entry: 'src/main.js', config: 'jsconfig.json', files: {
    'jsconfig.json': { extends: './config/base.json', include: ['src/**/*'] },
    'config/base.json': { compilerOptions: { target: 'ES2020', baseUrl: '..', paths: { '@lib': ['src/run.js'] } } },
    'src/main.js': 'import { run } from "@lib"; run();', 'src/run.js': 'export function run() {}',
  } },
  { id: 'project/extends-array-order', entry: 'main.js', config: 'jsconfig.json', files: {
    'jsconfig.json': { extends: ['./first.json', './second.json'] },
    'first.json': { compilerOptions: { target: 'ES2018', module: 'CommonJS' } },
    'second.json': { compilerOptions: { target: 'ES2020' } }, 'main.js': 'export function run() {}',
  } },
  { id: 'project/nested-jsconfig', entry: 'nested/main.js', config: 'nested/jsconfig.json', files: {
    'tsconfig.json': { compilerOptions: { allowJs: true, baseUrl: '.', paths: { '@lib': ['root.js'] } }, include: ['root.js'] },
    'root.js': 'export function run() {}',
    'nested/jsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '@lib': ['run.js'] } } },
    'nested/main.js': 'import { run } from "@lib"; run();', 'nested/run.js': 'export function run() {}',
  } },
  { id: 'project/tsconfig-precedes-jsconfig', entry: 'main.js', config: 'tsconfig.json', files: {
    'tsconfig.json': { compilerOptions: { allowJs: true, target: 'ES2020' } },
    'jsconfig.json': { compilerOptions: { target: 'ES2018' } }, 'main.js': 'export function run() {}',
  } },
  { id: 'project/allow-js-false', entry: 'main.ts', config: 'tsconfig.json', files: {
    'tsconfig.json': { compilerOptions: { allowJs: false } },
    'main.ts': 'export function run() {}', 'stray.js': 'function stray() {}',
  } },
  { id: 'project/tsconfig-allow-js-default', entry: 'main.ts', config: 'tsconfig.json', files: {
    'tsconfig.json': {}, 'main.ts': 'export function run() {}', 'stray.js': 'function stray() {}',
  } },
  { id: 'project/inferred-import', entry: 'main.js', config: null, files: {
    'main.js': 'import { run } from "./run.js"; run();', 'run.js': 'export function run() {}',
  } },
  { id: 'project/import-from-out-dir', entry: 'main.js', config: 'jsconfig.json', files: {
    'jsconfig.json': { compilerOptions: { outDir: './out' } },
    'main.js': 'import { run } from "./out/run.js"; run();', 'out/run.js': 'export function run() {}',
  } },
  { id: 'project/no-resolve', entry: 'main.js', config: 'jsconfig.json', files: {
    'jsconfig.json': { compilerOptions: { noResolve: true }, include: ['main.js'] },
    'main.js': 'import { run } from "./hidden/run.js"; run();', 'hidden/run.js': 'export function run() {}',
  } },
  { id: 'project/root-dirs', entry: 'src/main.js', config: 'jsconfig.json', files: {
    'jsconfig.json': { compilerOptions: { rootDirs: ['./src', './generated'] }, include: ['src/**/*'] },
    'src/main.js': 'import { run } from "./run.js"; run();', 'generated/run.js': 'export function run() {}',
  } },
  { id: 'project/triple-slash-reference', entry: 'main.ts', config: 'tsconfig.json', files: {
    'tsconfig.json': { include: ['main.ts'], exclude: ['hidden/**'] },
    'main.ts': '/// <reference path="./hidden/helper.ts" />\nhelper();', 'hidden/helper.ts': 'function helper() {}',
  } },
  { id: 'project/commonjs-transitive-exclude', entry: 'main.cjs', config: 'jsconfig.json', files: {
    'jsconfig.json': { include: ['main.cjs'], exclude: ['hidden/**'] },
    'main.cjs': 'const { run } = require("./hidden/run.cjs"); run();',
    'hidden/run.cjs': 'require("./leaf.cjs"); function run() {} module.exports.run = run;', 'hidden/leaf.cjs': 'exports.value = 1;',
  } },
  { id: 'project/excluded-open-file-is-inferred', entry: 'orphan.js', config: null, files: {
    'jsconfig.json': { include: ['main.js'] }, 'main.js': 'export {};', 'orphan.js': 'export function orphan() {}',
  } },
  { id: 'project/javascript-outside-tsconfig-is-inferred', entry: 'stray.js', config: null, files: {
    'tsconfig.json': { compilerOptions: { allowJs: false } }, 'main.ts': 'export {};', 'stray.js': 'export function stray() {}',
  } },
  { id: 'project/workspace-stops-ancestor-config', entry: 'main.js', root: 'src', config: null, files: {
    'jsconfig.json': { compilerOptions: { baseUrl: '.', paths: { '@lib': ['src/run.js'] } } },
    'src/main.js': 'import { run } from "@lib"; run();', 'src/run.js': 'export function run() {}', 'outside.js': 'export {};',
  } },
  { id: 'project/referenced-named-config', entry: 'lib/main.js', config: 'lib/tsconfig.app.json', files: {
    'tsconfig.json': { files: [], references: [{ path: './lib/tsconfig.app.json' }] },
    'lib/tsconfig.app.json': { compilerOptions: { allowJs: true, composite: true }, include: ['*.js'] },
    'lib/main.js': 'import { run } from "./run.js"; run();', 'lib/run.js': 'export function run() {}',
  } },
  { id: 'project/shared-source-prefers-nearest-config', entry: 'nested/run.js', config: 'nested/jsconfig.json',
    callFrom: 'main.js', callTarget: { file: 'nested/run.js', name: 'run', line: 1, column: 1 }, files: {
    'jsconfig.json': { include: ['main.js'] }, 'main.js': 'import { run } from "./nested/run.js"; run();',
    'nested/jsconfig.json': {}, 'nested/run.js': 'export function run() {}',
  } },
  { id: 'project/excluded-nearby-source-keeps-importing-owner', entry: 'nested/run.js', config: 'jsconfig.json', files: {
    'jsconfig.json': { include: ['main.js'] }, 'main.js': 'import { run } from "./nested/run.js"; run();',
    'nested/jsconfig.json': { include: ['own.js'] }, 'nested/run.js': 'export function run() {}', 'nested/own.js': 'export {};',
  } },
  { id: 'project/empty-config-roots-are-inferred', entry: 'main.js', config: null, files: {
    'tsconfig.json': { files: [] }, 'main.js': 'export function run() {}',
  } },
  { id: 'project/references-cycle', entry: 'b/main.ts', config: 'b/tsconfig.json', files: {
    'tsconfig.json': { files: [], references: [{ path: './a' }] },
    'a/tsconfig.json': { compilerOptions: { composite: true }, references: [{ path: '../b' }] },
    'a/main.ts': 'export function run() {}',
    'b/tsconfig.json': { compilerOptions: { composite: true }, references: [{ path: '../a' }] },
    'b/main.ts': 'export function run() {}',
  } },
  { id: 'project/utf16-configuration', entry: 'main.js', config: 'jsconfig.json', files: {
    'jsconfig.json': Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('{"compilerOptions":{"target":"ES2020"}}', 'utf16le')]),
    'main.js': 'export function run() {}',
  } },
];

export const DEFINITION_CASES = [
  { id: 'definition/local-function', entry: 'main.js', call: 'run', bound: true, files: {
    'main.js': 'function run() {} run();',
  } },
  { id: 'definition/const-arrow', entry: 'main.js', call: 'run', bound: true, files: {
    'main.js': 'const run = () => {}; run();',
  } },
  { id: 'definition/named-esm-alias', entry: 'main.js', call: 'call', bound: true, files: {
    'main.js': 'import { run as call } from "./run.js"; call();', 'run.js': 'export function run() {}',
  } },
  { id: 'definition/default-esm', entry: 'main.js', call: 'call', bound: true, files: {
    'main.js': 'import call from "./run.js"; call();', 'run.js': 'export default function run() {}',
  } },
  { id: 'definition/explicit-forwarding', entry: 'main.js', call: 'call', bound: true, files: {
    'main.js': 'import { forwarded as call } from "./bridge.js"; call();',
    'bridge.js': 'export { run as forwarded } from "./run.js";', 'run.js': 'export function run() {}',
  } },
  { id: 'definition/commonjs-destructure', entry: 'main.cjs', call: 'f', bound: true, files: {
    'main.cjs': 'const { f } = require("./run.cjs"); f();', 'run.cjs': 'function original() {} module.exports.f = original;',
  } },
  { id: 'definition/commonjs-self-require', entry: 'main.cjs', call: 'f', bound: true, files: {
    'main.cjs': 'function original() {} module.exports.f = original; const { f } = require("./main.cjs"); f();',
  } },
  { id: 'definition/member-navigation-is-not-dispatch', entry: 'main.js', call: 'api.run', bound: false, files: {
    'main.js': 'const api = { run() {} }; api.run();',
  } },
  { id: 'definition/rebound-export-stays-unknown', entry: 'main.js', call: 'run', bound: false, files: {
    'main.js': 'import { run } from "./run.js"; run();', 'run.js': 'export function run() {} run = () => {};',
  } },
];

export const MODULE_CASES = [
  { id: 'module/inferred-extensionless', entry: 'main.js', specifier: './run', files: {
    'main.js': 'import { run } from "./run"; run();', 'run.js': 'export function run() {}',
  } },
  { id: 'module/inferred-preserve-import-condition', entry: 'main.js', specifier: '#run', files: {
    'package.json': { imports: { '#run': { import: './esm.js', require: './cjs.cjs' } } },
    'main.js': 'import { run } from "#run"; run();', 'esm.js': 'export function run() {}', 'cjs.cjs': 'exports.run = () => {};',
  } },
  { id: 'module/inferred-preserve-require-condition', entry: 'main.cjs', specifier: '#run', files: {
    'package.json': { imports: { '#run': { import: './esm.js', require: './cjs.cjs' } } },
    'main.cjs': 'const { run } = require("#run"); run();', 'esm.js': 'export function run() {}', 'cjs.cjs': 'exports.run = () => {};',
  } },
  { id: 'module/commonjs-default-node10', entry: 'main.js', specifier: './run', options: { module: 'CommonJS' }, files: {
    'main.js': 'import { run } from "./run"; run();', 'run.js': 'export function run() {}',
  } },
  { id: 'module/amd-default-classic', entry: 'main.ts', specifier: 'run', options: { module: 'AMD' }, files: {
    'main.ts': 'import { run } from "run"; run();', 'run.ts': 'export function run() {}',
  } },
  { id: 'module/nodenext-esm-relative', entry: 'main.mjs', specifier: './run.js', options: { module: 'NodeNext', moduleResolution: 'NodeNext' }, files: {
    'main.mjs': 'import { run } from "./run.js"; run();', 'run.js': 'export function run() {}',
  } },
  { id: 'module/nodenext-cjs-relative', entry: 'main.cjs', specifier: './run.js', options: { module: 'NodeNext', moduleResolution: 'NodeNext' }, files: {
    'main.cjs': 'const { run } = require("./run.js"); run();', 'run.js': 'function run() {} exports.run = run;',
  } },
  { id: 'module/nodenext-dynamic-import-in-commonjs', entry: 'main.cjs', specifier: '#run', options: { module: 'NodeNext', moduleResolution: 'NodeNext' }, files: {
    'package.json': { imports: { '#run': { import: './esm.js', require: './cjs.cjs' } } },
    'main.cjs': 'import("#run");', 'esm.js': 'export function run() {}', 'cjs.cjs': 'exports.run = () => {};',
  } },
  { id: 'module/node16-static-cjs-import', entry: 'main.cjs', specifier: '#run', options: { module: 'Node16', moduleResolution: 'Node16' }, files: {
    'package.json': { imports: { '#run': { import: './esm.js', require: './cjs.cjs' } } },
    'main.cjs': 'import { run } from "#run"; run();', 'esm.js': 'export function run() {}', 'cjs.cjs': 'exports.run = () => {};',
  } },
  { id: 'module/paths-wildcard', entry: 'main.js', specifier: '@lib/run', options: { baseUrl: '.', paths: { '@lib/*': ['lib/*'] } }, files: {
    'main.js': 'import { run } from "@lib/run"; run();', 'lib/run.js': 'export function run() {}',
  } },
  { id: 'module/paths-longest-prefix', entry: 'main.js', specifier: '@lib/run', options: { baseUrl: '.', paths: { '@*': ['fallback/*'], '@lib/*': ['lib/*'] } }, files: {
    'main.js': 'import { run } from "@lib/run"; run();', 'lib/run.js': 'export function run() {}', 'fallback/lib/run.js': 'export function run() {}',
  } },
  { id: 'module/module-suffixes', entry: 'main.js', specifier: './run', options: { moduleSuffixes: ['.native', ''] }, files: {
    'main.js': 'import { run } from "./run"; run();', 'run.js': 'export function run() {}', 'run.native.js': 'export function run() {}',
  } },
  { id: 'module/root-dirs', entry: 'src/main.js', specifier: './run.js', options: { rootDirs: ['src', 'generated'] }, files: {
    'src/main.js': 'import { run } from "./run.js"; run();', 'generated/run.js': 'export function run() {}',
  } },
  { id: 'module/package-imports-pattern', entry: 'main.mjs', specifier: '#lib/run', options: { module: 'NodeNext', moduleResolution: 'NodeNext' }, files: {
    'package.json': { imports: { '#lib/*': './lib/*.js' } },
    'main.mjs': 'import { run } from "#lib/run"; run();', 'lib/run.js': 'export function run() {}',
  } },
  { id: 'module/package-self-export', entry: 'main.mjs', specifier: 'self-probe', options: { module: 'NodeNext', moduleResolution: 'NodeNext' }, files: {
    'package.json': { name: 'self-probe', exports: './run.js' },
    'main.mjs': 'import { run } from "self-probe"; run();', 'run.js': 'export function run() {}',
  } },
  { id: 'module/custom-condition', entry: 'main.mjs', specifier: '#run', options: { module: 'NodeNext', moduleResolution: 'NodeNext', customConditions: ['development'] }, files: {
    'package.json': { imports: { '#run': { development: './dev.js', default: './prod.js' } } },
    'main.mjs': 'import { run } from "#run"; run();', 'dev.js': 'export function run() {}', 'prod.js': 'export function run() {}',
  } },
  { id: 'module/package-imports-disabled', entry: 'main.js', specifier: '#run', options: { module: 'Preserve', moduleResolution: 'Bundler', resolvePackageJsonImports: false }, files: {
    'package.json': { imports: { '#run': './run.js' } }, 'main.js': 'import { run } from "#run";', 'run.js': 'export function run() {}',
  } },
  { id: 'module/missing-relative', entry: 'main.js', specifier: './missing', files: { 'main.js': 'import "./missing";' } },
  { id: 'module/directory-package-main', entry: 'main.js', specifier: './lib', files: {
    'main.js': 'import { run } from "./lib"; run();', 'lib/package.json': { main: './entry.js' }, 'lib/entry.js': 'export function run() {}',
  } },
  { id: 'module/typescript-substitution', entry: 'main.ts', specifier: './run.js', options: { module: 'Preserve', moduleResolution: 'Bundler' }, files: {
    'main.ts': 'import { run } from "./run.js"; run();', 'run.ts': 'export function run() {}', 'run.js': 'export function run() {}',
  } },
  { id: 'module/declaration-runtime-projection', entry: 'main.mjs', specifier: './run.js', options: { module: 'NodeNext', moduleResolution: 'NodeNext' },
    projection: 'runtime', officialTo: 'run.d.ts', target: 'run.js', files: {
      'main.mjs': 'import { run } from "./run.js"; run();', 'run.d.ts': 'export declare function run(): void;', 'run.js': 'export function run() {}',
    } },
  { id: 'module/external-package', entry: 'main.js', specifier: 'external-probe', projection: 'external', files: {
    'main.js': 'import { run } from "external-probe"; run();',
    'node_modules/external-probe/package.json': { main: 'index.js', types: 'index.d.ts' },
    'node_modules/external-probe/index.d.ts': 'export declare function run(): void;', 'node_modules/external-probe/index.js': 'exports.run = () => {};',
  } },
  { id: 'module/json-outside-source-model', entry: 'main.js', specifier: './data.json', options: { module: 'Preserve', moduleResolution: 'Bundler', resolveJsonModule: true },
    projection: 'unsupported-source', officialTo: 'data.json', files: { 'main.js': 'import data from "./data.json";', 'data.json': { value: 1 } } },
  { id: 'module/type-only-declaration', entry: 'main.ts', specifier: './shape', options: { module: 'Preserve', moduleResolution: 'Bundler' }, files: {
    'main.ts': 'import type { Shape } from "./shape"; export type Local = Shape;', 'shape.d.ts': 'export interface Shape { value: number; }',
  } },
  { id: 'module/nodenext-extension-required', entry: 'main.mjs', specifier: './run', options: { module: 'NodeNext', moduleResolution: 'NodeNext' }, files: {
    'main.mjs': 'import { run } from "./run";', 'run.js': 'export function run() {}',
  } },
  { id: 'module/type-only-resolution-mode', entry: 'main.ts', specifier: 'self-probe', options: { module: 'NodeNext', moduleResolution: 'NodeNext' }, files: {
    'package.json': { name: 'self-probe', exports: { import: './import.d.ts', require: './require.d.ts' } },
    'main.ts': 'import type { Shape } from "self-probe" with { "resolution-mode": "import" }; export type Local = Shape;',
    'import.d.ts': 'export interface Shape { imported: true; }', 'require.d.ts': 'export interface Shape { required: true; }',
  } },
];

export const SYNTAX_CASES = [
  ...['js', 'cjs', 'mjs', 'jsx', 'ts', 'tsx', 'mts', 'cts'].map(extension => ({
    id: `syntax/file-kind-${extension}`, entry: `main.${extension}`, source: 'function run() { return 1; } run();',
  })),
  { id: 'syntax/jsx-expression', entry: 'main.jsx', source: 'export const view = () => <div>{read()}</div>;' },
  { id: 'syntax/typescript-jsx', entry: 'main.tsx', source: 'export function view() { return <div>{read()}</div>; }' },
  { id: 'syntax/arrow-initializer', entry: 'main.js', source: 'const run = () => 1; run();' },
  { id: 'syntax/object-accessors-method', entry: 'main.js', source: 'const api = { run() { return 1; }, get size() { return 2; }, set size(x) {} }; api.run();' },
  { id: 'syntax/generator', entry: 'main.js', source: 'function* run() { yield 1; } run();' },
  { id: 'syntax/overload-signatures', entry: 'main.ts', source: 'function run(x: string): string; function run(x: number): number; function run(x: any) { return x; } run(1);' },
  { id: 'syntax/utf16-columns', entry: 'main.js', source: 'const text = "🐈"; function run() { return text; } run();' },
  { id: 'syntax/unicode-line-separators', entry: 'main.js', source: 'function first() {}\u2028function second() {}\u2029second();' },
  { id: 'syntax/error-recovery', entry: 'main.js', source: 'function valid() {}\nfunction broken( {' },
  { id: 'syntax/declaration-file', entry: 'main.d.ts', source: 'export declare function run(): void;' },
  { id: 'syntax/utf8-bom-capture', entry: 'main.js', source: '\uFEFFfunction run() {} run();' },
  { id: 'syntax/utf16le-bom', entry: 'main.js', source: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('function run() {} run();', 'utf16le')]) },
  { id: 'syntax/utf16be-bom', entry: 'main.js', source: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('function run() {} run();', 'utf16le')]).swap16() },
  { id: 'syntax/optional-constructor-tagged-inventory', entry: 'main.js', source: 'function run() {} run?.(); new run(); run`value`; run();' },
  { id: 'syntax/decorated-method', entry: 'main.ts', source: '@decorate class Example { @trace run() { return 1; } }' },
];
