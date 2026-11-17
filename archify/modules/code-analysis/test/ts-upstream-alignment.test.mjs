import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import { extract } from '../extract/ts/index.mjs';
import { semanticErrors } from '../schemas/semantics.mjs';
import { extractFacts } from '../lib/analysis.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../config/defaults.json', import.meta.url), 'utf8'));

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ts-upstream-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, text] of Object.entries(files)) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return root;
}

test('upstream configured-project theme: sibling jsconfig changes the import target', t => {
  // Derived from TypeScript's tsserver/configuredProjects.ts sibling-jsconfig
  // scenario; the alias makes the project-selection effect observable in facts.
  const root = fixture(t, {
    'src/main.js': 'import { run } from "@lib/helper"; run();',
    'src/lib/helper.js': 'export function run() {}',
    'src/jsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@lib/*': ['lib/*'] } } }),
  });
  const configPath = path.join(root, 'src/jsconfig.json');
  const loaded = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(loaded.error, undefined);
  const project = ts.parseJsonConfigFileContent(loaded.config, ts.sys, path.dirname(configPath), undefined, configPath);
  assert.deepEqual(project.errors, []);
  const upstream = ts.resolveModuleName('@lib/helper', path.join(root, 'src/main.js'), project.options, ts.sys);
  assert.equal(fs.realpathSync.native(upstream.resolvedModule?.resolvedFileName), fs.realpathSync.native(path.join(root, 'src/lib/helper.js')));

  const facts = extract(root, config);
  const imported = facts.imports.find(item => item.specifier === '@lib/helper');
  assert.ok(imported);
  assert.equal(imported.resolved, true);
  assert.equal(imported.to, 'src/lib/helper.js');
  assert.equal(facts.languageScope.projects[0].config, 'src/jsconfig.json');
  assert.deepEqual(facts.languageScope.projects[0].files, ['src/lib/helper.js', 'src/main.js']);
});

test('upstream JSX-in-JS theme: syntax coverage follows the selected file kind', t => {
  // Minimal parser projection from compiler/jsxPreserveWithJsInput.ts.
  const files = {
    'a.js': 'var elemA = 42;',
    'b.jsx': 'var elemB = <b>{"test"}</b>;',
    'c.js': 'var elemC = <c>{42}</c>;',
    'e.tsx': 'var elemE = <e>{true}</e>;',
    'tsconfig.json': JSON.stringify({ compilerOptions: { allowJs: true, jsx: 'preserve' } }),
  };
  const root = fixture(t, files);
  const parsedBySdk = Object.entries(files).filter(([name]) => /\.(?:js|jsx|tsx)$/.test(name))
    .map(([name, source]) => [name, ts.createSourceFile(name, source, ts.ScriptTarget.ESNext, true,
      name.endsWith('.tsx') ? ts.ScriptKind.TSX : name.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.JS).parseDiagnostics.length > 0]);
  const facts = extract(root, config);
  assert.deepEqual(facts.files.map(file => file.path), ['a.js', 'b.jsx', 'c.js', 'e.tsx']);
  assert.deepEqual(parsedBySdk, facts.files.map(file => [file.path, Boolean(facts.parse_errors?.some(error => error.path === file.path))]));
  assert.equal(facts.parse_errors?.length ?? 0, 0);
});

test('upstream definition theme: navigation does not prove a runtime member-call target', t => {
  // TypeScript's goToDefinitionJsModuleExports.ts verifies navigation from a
  // JS property call to an assignment. Archify makes a stronger call-edge claim.
  const source = 'const api = {}; api.run = () => 1; api.run();';
  const root = fixture(t, { 'main.js': source });
  const file = path.join(root, 'main.js');
  const languageService = ts.createLanguageService({
    getScriptFileNames: () => [file],
    getScriptVersion: () => '0',
    getScriptSnapshot: name => fs.existsSync(name) ? ts.ScriptSnapshot.fromString(fs.readFileSync(name, 'utf8')) : undefined,
    getCurrentDirectory: () => root,
    getCompilationSettings: () => ({ allowJs: true, noLib: true }),
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
  });
  const callStart = source.lastIndexOf('run');
  const definitions = languageService.getDefinitionAtPosition(file, callStart);
  assert.ok(definitions?.some(definition => fs.realpathSync.native(definition.fileName) === fs.realpathSync.native(file)
    && definition.textSpan.start < callStart));
  const call = extract(root, config).calls.find(item => item.line === 1 && item.column > 30);
  assert.equal(call?.resolution, 'unresolved');
  assert.equal(call?.reason, 'unsupported-callee');
});

test('upstream CommonJS reference theme: a stable destructured require reaches one function', t => {
  // The virtual files are from fourslash/findAllRefsCommonJsRequire2.ts. The
  // final f() is an Archify call projection; upstream tests a reference only.
  const root = fixture(t, {
    'a.js': 'function f() { }\nmodule.exports.f = f',
    'b.js': "const { f } = require('./a');\nf();",
  });
  const upstream = ts.resolveModuleName('./a', path.join(root, 'b.js'), {
    allowJs: true, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10,
  }, ts.sys);
  assert.equal(fs.realpathSync.native(upstream.resolvedModule?.resolvedFileName), fs.realpathSync.native(path.join(root, 'a.js')));
  const facts = extract(root, config);
  assert.deepEqual(facts.imports.filter(item => item.from === 'b.js').map(item => item.to), ['a.js']);
  const call = facts.calls.find(item => item.file === 'b.js' && item.line === 2);
  assert.equal(call?.resolution, 'commonjs-function');
  assert.deepEqual(call?.target, { file: 'a.js', name: 'f', line: 1, column: 1 });
  assert.deepEqual(semanticErrors('raw-facts', facts), []);
  const historical = structuredClone(facts); historical.callModel = 'js-ts-lexical-v5';
  assert.ok(semanticErrors('raw-facts', historical).some(error => error.message.includes('v6 CommonJS')));
  const wrongEdge = structuredClone(facts); wrongEdge.calls.find(item => item.resolution === 'commonjs-function').target.file = 'b.js';
  assert.ok(semanticErrors('raw-facts', wrongEdge).some(error => error.message.includes('recorded CommonJS require')));
});

test('CommonJS call attribution requires stable static exports and bindings', t => {
  const root = fixture(t, {
    'safe.cjs': 'function f() {}\nmodule.exports = { f };',
    'mutated.cjs': 'function f() {}\nmodule.exports.f = f;\nmodule.exports.f = () => {};',
    'aliased.cjs': 'function f() {}\nconst out = module.exports;\nout.f = f;',
    'dynamic.cjs': 'function f() {}\nmodule.exports["f"] = f;',
    'changed.cjs': 'function f() {}\nmodule.exports.f = f;\nf = () => {};',
    'caller.cjs': [
      "const { f: safe } = require('./safe.cjs'); safe();",
      "const { f: mutated } = require('./mutated.cjs'); mutated();",
      "const { f: aliased } = require('./aliased.cjs'); aliased();",
      "const { f: dynamic } = require('./dynamic.cjs'); dynamic();",
      "const { f: changed } = require('./changed.cjs'); changed();",
      "const { f: rebound } = require('./safe.cjs'); rebound = () => {}; rebound();",
    ].join('\n'),
  });
  const facts = extract(root, config);
  const calls = facts.calls.filter(item => item.file === 'caller.cjs' && item.column > 40);
  assert.equal(calls.length, 6);
  assert.equal(calls[0].resolution, 'commonjs-function');
  assert.deepEqual(calls.slice(1).map(item => item.resolution), ['unresolved', 'unresolved', 'unresolved', 'unresolved', 'unresolved']);
});

test('CommonJS targets stay unknown when a captured require result can be mutated or escape', t => {
  const mutations = [
    'require("./a.cjs").f = changed;',
    'const api = require("./a.cjs"); api.f = changed;',
    'Object.defineProperty(require("./a.cjs"), "f", { value: changed });',
    'consume(require("./a.cjs"));',
    'require.cache[require.resolve("./a.cjs")].exports.f = changed;',
    'const loader = require; loader("./a.cjs").f = changed;',
    'const name = "./a.cjs"; require(name).f = changed;',
    'module.require("./a.cjs").f = changed;',
  ];
  for (const [index, mutation] of mutations.entries()) {
    const root = fixture(t, { 'a.cjs': 'function original() {} module.exports.f = original;',
      'b.cjs': `function changed() {}\n${mutation}\nconst { f } = require("./a.cjs"); f();` });
    const { facts } = extractFacts(root, { language: 'ts', config });
    const call = facts.calls.find(item => item.file === 'b.cjs' && item.line === 3 && item.column > 30);
    assert.equal(call?.resolution, 'unresolved', `mutation/escape ${index}`);
  }
});

test('a loader escape in another captured source blocks CommonJS attribution', t => {
  const root = fixture(t, {
    'a.cjs': 'function f() {} module.exports.f = f;',
    'b.cjs': 'const { f } = require("./a.cjs"); f();',
    'c.cjs': 'require.cache[require.resolve("./a.cjs")].exports.f = () => {};',
  });
  const { facts } = extractFacts(root, { language: 'ts', config });
  assert.equal(facts.calls.find(call => call.file === 'b.cjs' && call.column > 30)?.resolution, 'unresolved');
});

test('a static self-require retains a valid CommonJS source target', t => {
  const root = fixture(t, { 'self.cjs': 'function original() {}\nmodule.exports.f = original;\nconst { f } = require("./self.cjs");\nf();' });
  const { facts } = extractFacts(root, { language: 'ts', config });
  assert.deepEqual(facts.calls.find(call => call.line === 4)?.target, { file: 'self.cjs', name: 'original', line: 1, column: 1 });
});

test('upstream binary-expression stress retains function metrics, imports and CommonJS targets', t => {
  // Derived from compiler/binderBinaryExpressionStressJs.ts. The named function
  // and require additionally exercise Archify's metric and stability traversals.
  const chain = Array(6001).fill('1').join(' + ');
  const root = fixture(t, {
    'target.cjs': `function f(flag) { return flag ? ${chain} : 0; } module.exports.f = f;`,
    'main.cjs': `const { f } = require("./target.cjs"); f();\n${chain};`,
  });
  const { facts } = extractFacts(root, { language: 'ts', config });
  assert.equal(facts.functions.find(fn => fn.name === 'f').complexity, 2);
  assert.equal(facts.imports[0].to, 'target.cjs');
  assert.equal(facts.calls.find(call => call.resolution === 'commonjs-function')?.target.file, 'target.cjs');
  assert.equal(facts.parse_errors?.length || 0, 0);
});

test('upstream declaration-only package stays outside captured runtime edges', t => {
  // compiler/nodeNextModuleResolution2.ts resolves foo/index.d.ts as a type
  // source. Archify's module graph intentionally records no runtime file edge.
  const root = fixture(t, {
    'node_modules/foo/index.d.ts': 'export declare let x: number;',
    'node_modules/foo/package.json': JSON.stringify({ name: 'foo', type: 'module', exports: { '.': './index.d.ts' } }),
    'app.mts': 'import { x } from "foo"; export const value = x;',
  });
  const upstream = ts.resolveModuleName('foo', path.join(root, 'app.mts'), {
    module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  }, ts.sys, undefined, undefined, ts.ModuleKind.ESNext);
  assert.equal(fs.realpathSync.native(upstream.resolvedModule?.resolvedFileName), fs.realpathSync.native(path.join(root, 'node_modules/foo/index.d.ts')));
  const facts = extract(root, config);
  assert.equal(facts.imports[0].resolved, false);
  assert.equal(facts.unresolved.external, 1);
});
