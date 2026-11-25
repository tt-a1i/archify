import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import ts from '../vendor/typescript.cjs';
import { extractFacts, buildGraph } from '../lib/analysis.mjs';
import { evaluate } from '../evaluate/index.mjs';
import { comparability } from '../lib/review.mjs';
import { schemaErrors } from '../schemas/index.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../config/defaults.json', import.meta.url), 'utf8'));

function project(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-ts-projects-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
  }
  return root;
}

function capture(root, settings = config) {
  const { facts } = extractFacts(root, { language: 'ts', config: settings });
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
  const graph = buildGraph(facts, settings);
  const context = evaluate(graph, settings, facts).analysis;
  assert.deepEqual(schemaErrors('findings', {
    schema_version: 1, repository: facts.repository, rules: [], summary: { errors: 0, warnings: 0, info: 0, suppressed: 0 }, analysis: context, diagnostics: [],
  }), []);
  return { facts, context };
}

test('partial coverage reports all missing referenced configurations in one directory', t => {
  const root = project(t, {
    'src/main.ts': 'export const main = 1;',
    'website/package.json': '{"devDependencies":{"app-base":"1.0.0","tools-base":"1.0.0"}}',
    'website/tsconfig.json': '{"files":[],"references":[{"path":"./tsconfig.app.json"},{"path":"./tsconfig.tools.json"}]}',
    'website/tsconfig.app.json': '{"extends":"app-base/strict","include":["app.ts"]}',
    'website/tsconfig.tools.json': '{"extends":"tools-base/strict","include":["app.ts"]}',
    'website/app.ts': 'export const app = 1;',
  });
  const { facts } = capture(root);
  assert.deepEqual(facts.languageScope.unavailableProjects.map(item => item.config), ['website/tsconfig.app.json', 'website/tsconfig.tools.json']);
  assert.deepEqual(facts.languageScope.excludedByProject.map(item => item.file), ['website/app.ts']);
});

test('a project cannot acquire sources through an omitted project subtree', t => {
  const root = project(t, {
    'service/tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '#target': ['target.ts'] } }, files: ['index.ts'] }),
    'service/index.ts': "import '../website/app';",
    'service/target.ts': 'export const target = 1;',
    'website/package.json': '{"devDependencies":{"missing-base":"1.0.0"}}',
    'website/tsconfig.json': '{"extends":"missing-base/strict"}',
    'website/app.ts': "import '../shared/index';",
    'shared/index.ts': "import { target } from '#target'; export const value = target;",
  });
  const { facts } = capture(root);
  assert.equal(facts.imports.find(item => item.from === 'shared/index.ts' && item.specifier === '#target')?.resolved, false);
});

test('an omitted first alias target does not activate a later fallback', t => {
  const root = project(t, {
    'service/tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '#dep': ['../website/dep.ts', '../shared/dep.ts'], '#target': ['target.ts'] } }, files: ['index.ts'] }),
    'service/index.ts': "import '#dep';",
    'service/target.ts': 'export const target = 1;',
    'website/package.json': '{"devDependencies":{"missing-base":"1.0.0"}}',
    'website/tsconfig.json': '{"extends":"missing-base/strict"}',
    'website/dep.ts': 'export const dep = 1;',
    'shared/dep.ts': "import { target } from '#target'; export const value = target;",
  });
  const { facts } = capture(root);
  assert.equal(facts.imports.find(item => item.from === 'shared/dep.ts' && item.specifier === '#target')?.resolved, false);
  assert.ok(!facts.languageScope.projects.find(item => item.config === 'service/tsconfig.json').files.includes('shared/dep.ts'));
});

test('nearest jsconfig and tsconfig give nested files their own resolution options', t => {
  const root = project(t, {
    'tsconfig.json': JSON.stringify({ compilerOptions: { allowJs: true, baseUrl: '.', paths: { '@target': ['root.js'] } }, include: ['*.js'] }),
    'main.js': 'import { value } from "@target";',
    'root.js': 'export const value = 1;',
    'nested/jsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@target': ['nested.js'] } } }),
    'nested/main.js': 'import { value } from "@target";',
    'nested/nested.js': 'export const value = 2;',
  });
  const { facts } = capture(root);
  assert.deepEqual(facts.imports.map(item => [item.from, item.to]), [['main.js', 'root.js'], ['nested/main.js', 'nested/nested.js']]);
  assert.deepEqual(facts.languageScope.projects.map(item => [item.config, item.files]), [
    ['tsconfig.json', ['main.js', 'root.js']],
    ['nested/jsconfig.json', ['nested/main.js', 'nested/nested.js']],
  ]);
});

test('extended configuration selects source files and excludes nonmembers', t => {
  const root = project(t, {
    'tsconfig.json': JSON.stringify({ extends: './base.json', compilerOptions: { allowJs: true }, include: ['src/**/*.js'], exclude: ['src/generated/**'] }),
    'base.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@lib/*': ['src/lib/*'] } } }),
    'src/main.js': 'import { run } from "@lib/run";',
    'src/lib/run.js': 'export function run() {}',
    'src/generated/skip.js': 'export {};',
    'outside.js': 'export {};',
  });
  const { facts } = capture(root);
  assert.deepEqual(facts.files.map(file => file.path), ['outside.js', 'src/generated/skip.js', 'src/lib/run.js', 'src/main.js']);
  assert.deepEqual(facts.languageScope.projects.find(project => project.config === null).files, ['outside.js', 'src/generated/skip.js']);
  assert.deepEqual(facts.languageScope.excludedByProject, []);
  assert.equal(facts.imports[0].to, 'src/lib/run.js');
});

for (const configName of ['tsconfig.json', 'jsconfig.json']) test(`${configName} membership follows transitive imports beyond include and exclude roots`, t => {
  const root = project(t, {
    [configName]: JSON.stringify({ compilerOptions: { allowJs: true, module: 'commonjs' },
      include: ['src/main.js'], exclude: ['src/imported/**'] }),
    'src/main.js': 'const { helper } = require("./imported/helper.js"); helper();',
    'src/imported/helper.js': 'const { leaf } = require("./leaf.js"); function helper() { leaf(); } module.exports.helper = helper;',
    'src/imported/leaf.js': 'function leaf() {} module.exports.leaf = leaf;',
    'src/imported/unused.js': 'export {};',
  });
  const file = path.join(root, configName);
  const loaded = ts.readConfigFile(file, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(loaded.config, ts.sys, root, undefined, file);
  const official = ts.createProgram(parsed.fileNames, { ...parsed.options, noLib: true, types: [] });
  assert.deepEqual(parsed.fileNames.map(name => path.relative(root, name).split(path.sep).join('/')), ['src/main.js']);
  const expected = official.getSourceFiles().map(source => path.relative(root, source.fileName).split(path.sep).join('/')).sort();
  const { facts } = capture(root);
  assert.deepEqual(facts.languageScope.projects.find(project => project.config === configName).files, expected);
  assert.deepEqual(expected, ['src/imported/helper.js', 'src/imported/leaf.js', 'src/main.js']);
  assert.deepEqual(facts.languageScope.projects.find(project => project.config === null).files, ['src/imported/unused.js']);
  assert.deepEqual(facts.languageScope.excludedByProject, []);
  assert.ok(facts.calls.some(call => call.file === 'src/main.js' && call.target?.file === 'src/imported/helper.js'));
  assert.ok(facts.calls.some(call => call.file === 'src/imported/helper.js' && call.target?.file === 'src/imported/leaf.js'));

  const bounded = capture(root, { ...config, exclude: [...config.exclude, 'src/imported/**'] }).facts;
  assert.deepEqual(bounded.files.map(source => source.path), ['src/main.js']);
  assert.equal(bounded.imports[0].resolved, false);

  fs.writeFileSync(file, JSON.stringify({ compilerOptions: { allowJs: true, module: 'commonjs', noResolve: true }, include: ['src/main.js'] }));
  const noResolve = capture(root).facts;
  assert.deepEqual(noResolve.languageScope.projects.find(project => project.config === configName).files, ['src/main.js']);
});

test('configured dependency expansion stays inside the selected analysis root', t => {
  const root = project(t, {
    'jsconfig.json': '{}',
    'src/jsconfig.json': '{}',
    'src/main.js': 'import { helper } from "../outside.js"; helper();',
    'outside.js': 'export function helper() {}',
  });
  const { facts } = capture(path.join(root, 'src'));
  assert.deepEqual(facts.files.map(source => source.path), ['main.js']);
  assert.equal(facts.imports[0].resolved, false);
  assert.equal(facts.unresolved.outside, 1);
});

test('an imported dependency belongs to its importing project when a nearer config excludes it', t => {
  const root = project(t, {
    'jsconfig.json': JSON.stringify({ include: ['main.js'] }),
    'main.js': 'import { helper } from "./nested/helper.js"; helper();',
    'nested/jsconfig.json': JSON.stringify({ include: ['own.js'] }),
    'nested/helper.js': 'export function helper() {}',
    'nested/own.js': 'export function own() {}',
  });
  const { facts } = capture(root);
  assert.deepEqual(facts.files.map(source => source.path), ['main.js', 'nested/helper.js', 'nested/own.js']);
  assert.deepEqual(facts.languageScope.projects.map(item => [item.config, item.files]), [
    ['jsconfig.json', ['main.js', 'nested/helper.js']],
    ['nested/jsconfig.json', ['nested/own.js']],
  ]);
  assert.equal(facts.calls[0].target?.file, 'nested/helper.js');
  assert.deepEqual(facts.languageScope.excludedByProject, []);
});

test('effective project options make otherwise identical runs noncomparable', t => {
  const root = project(t, {
    'jsconfig.json': JSON.stringify({ compilerOptions: { strict: false } }),
    'main.js': 'export const value = 1;',
  });
  const first = capture(root);
  fs.writeFileSync(path.join(root, 'jsconfig.json'), JSON.stringify({ compilerOptions: { strict: true } }));
  const second = capture(root);
  assert.deepEqual(first.facts.files, second.facts.files);
  assert.notEqual(first.facts.languageScope.projects[0].optionsDigest, second.facts.languageScope.projects[0].optionsDigest);
  assert.ok(comparability(first.context, second.context).reasons.some(reason => reason.code === 'typescript-project-scope-changed'));
});

test('adding and deleting source files preserves comparison under the same project settings', t => {
  const root = project(t, { 'jsconfig.json': '{}', 'main.js': 'export function run() {}' });
  const first = capture(root);
  fs.writeFileSync(path.join(root, 'other.js'), 'export function other() {}');
  const added = capture(root);
  assert.deepEqual(comparability(first.context, added.context), { comparable: true, reasons: [] });
  fs.unlinkSync(path.join(root, 'main.js'));
  const deleted = capture(root);
  assert.deepEqual(comparability(added.context, deleted.context), { comparable: true, reasons: [] });
});

test('adding and deleting an importer preserves comparison when it changes another project member', t => {
  const root = project(t, {
    'jsconfig.json': '{"include":["*.js"]}',
    'main.js': 'export const main = true;',
    'lib/jsconfig.json': '{}',
    'lib/run.js': 'export function run() {}',
  });
  const before = capture(root);
  const newFile = path.join(root, 'added.js');
  fs.writeFileSync(newFile, 'import { run } from "./lib/run.js"; run();');
  const after = capture(root);
  const members = run => run.facts.languageScope.projects.find(item => item.config === 'jsconfig.json').members;
  assert.deepEqual(members(before), ['main.js']);
  assert.deepEqual(members(after), ['added.js', 'lib/run.js', 'main.js']);
  assert.deepEqual(comparability(before.context, after.context), { comparable: true, reasons: [] });
  assert.deepEqual(comparability(after.context, before.context), { comparable: true, reasons: [] });
});

test('changing inherited include with noResolve changes comparison scope even with a source addition', t => {
  const root = project(t, {
    'jsconfig.json': '{"extends":"./base.json","compilerOptions":{"noResolve":true}}',
    'base.json': '{"include":["*.js","nested/run.js"]}',
    'main.js': 'import { run } from "./nested/run.js"; run();',
    'nested/jsconfig.json': '{}',
    'nested/run.js': 'export function run() {}',
  });
  const before = capture(root);
  fs.writeFileSync(path.join(root, 'base.json'), '{"include":["*.js"]}');
  fs.writeFileSync(path.join(root, 'added.js'), 'export const added = true;');
  const after = capture(root);
  const rootProject = run => run.facts.languageScope.projects.find(item => item.config === 'jsconfig.json');
  assert.deepEqual(rootProject(before).members, ['main.js', 'nested/run.js']);
  assert.deepEqual(rootProject(after).members, ['added.js', 'main.js']);
  assert.equal(rootProject(before).optionsDigest, rootProject(after).optionsDigest);
  assert.notEqual(rootProject(before).selectionDigest, rootProject(after).selectionDigest);
  assert.ok(comparability(before.context, after.context).reasons.some(reason => reason.code === 'typescript-project-scope-changed'));
});

test('removing a shared file from a caller Program changes comparison scope', t => {
  const root = project(t, {
    'jsconfig.json': '{"files":["main.js"]}',
    'main.js': 'import { run } from "./nested/run.js"; run();',
    'nested/jsconfig.json': '{}',
    'nested/run.js': 'export function run() {}',
  });
  const before = capture(root);
  const rootProject = facts => facts.languageScope.projects.find(item => item.config === 'jsconfig.json');
  assert.deepEqual(rootProject(before.facts).members, ['main.js', 'nested/run.js']);
  fs.writeFileSync(path.join(root, 'main.js'), 'export function main() {}');
  const after = capture(root);
  assert.deepEqual(rootProject(after.facts).members, ['main.js']);
  assert.equal(rootProject(after.facts).optionsDigest, rootProject(before.facts).optionsDigest);
  assert.deepEqual(after.facts.files.map(f => f.path), before.facts.files.map(f => f.path));
  assert.ok(comparability(before.context, after.context).reasons.some(reason => reason.code === 'typescript-project-scope-changed'));
  fs.writeFileSync(path.join(root, 'nested/added.js'), 'export const added = true;');
  assert.ok(comparability(before.context, capture(root).context).reasons.some(reason => reason.code === 'typescript-project-scope-changed'),
    'an addition outside the affected Program does not hide a shared membership change');
});

test('reordering SDK records preserves project identity while changed ownership does not', t => {
  const { context } = capture(project(t, { 'main.js': 'export function run() {}' }));
  const first = structuredClone(context);
  first.tsSdks = [
    { version: '5.9.3', source: 'project', status: 'matched', packagePath: 'a/node_modules/typescript' },
    { version: '6.0.3', source: 'project', status: 'matched', packagePath: 'b/node_modules/typescript' },
  ];
  first.tsProjects = first.tsProjects.map(item => ({ ...item, sdkIndex: 0, sdkVersion: '5.9.3' }));
  first.tsProjects.push({ ...first.tsProjects[0], config: 'b/jsconfig.json', files: ['b/other.js'], sdkIndex: 1, sdkVersion: '6.0.3' });
  const reordered = structuredClone(first);
  reordered.tsSdks.reverse();
  for (const item of reordered.tsProjects) item.sdkIndex = 1 - item.sdkIndex;
  reordered.tsProjects.reverse();
  assert.deepEqual(comparability(first, reordered), { comparable: true, reasons: [] });
  reordered.tsProjects.find(item => item.files.includes('main.js')).config = 'new/jsconfig.json';
  assert.ok(comparability(first, reordered).reasons.some(reason => reason.code === 'typescript-project-scope-changed'));
});

test('shared Program members bind across default owners without duplicating facts', t => {
  const root = project(t, {
    'jsconfig.json': JSON.stringify({ include: ['main.js'] }),
    'main.js': 'import { run } from "./nested/run.js"; run();',
    'nested/jsconfig.json': '{}',
    'nested/run.js': 'export function run() {}',
  });
  const { facts } = capture(root);
  assert.equal(facts.imports[0].to, 'nested/run.js');
  assert.equal(facts.calls[0].resolution, 'imported-function');
  assert.equal(facts.calls[0].target.file, 'nested/run.js');
  assert.deepEqual(facts.languageScope.projects.find(p => p.config === 'jsconfig.json').members, ['main.js', 'nested/run.js']);
  assert.equal(facts.files.length, 2);
  assert.equal(facts.functions.length, 1);
  const outside = structuredClone(facts);
  outside.languageScope.projects.find(p => p.config === 'jsconfig.json').members = ['main.js'];
  assert.ok(schemaErrors('raw-facts', outside).some(error => error.message.includes('members of the caller Program')));
  const historical = structuredClone(facts);
  historical.repository.adapterRevision = 27;
  for (const project of historical.languageScope.projects) delete project.members;
  assert.deepEqual(schemaErrors('raw-facts', historical), [], 'historical scope records remain readable');
});

test('a test Program follows a shared barrel to one overloaded implementation', t => {
  const root = project(t, {
    'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler' }, include: ['src'] }),
    'src/index.ts': 'export { isMatching } from "./is-matching";',
    'src/is-matching.ts': 'export function isMatching(value: string): boolean;\nexport function isMatching(value: unknown): boolean { return Boolean(value); }',
    'tests/tsconfig.json': JSON.stringify({ compilerOptions: { module: 'ESNext', moduleResolution: 'Bundler' }, include: ['.'], exclude: ['../src'] }),
    'tests/main.ts': 'import { isMatching } from "../src";\nisMatching("ok");',
  });
  const { facts } = capture(root);
  const call = facts.calls.find(call => call.file === 'tests/main.ts' && call.line === 2);
  assert.equal(call.resolution, 'imported-function');
  assert.deepEqual(call.target, { file: 'src/is-matching.ts', name: 'isMatching', line: 2, column: 1 });
  assert.deepEqual(call.via, [{ file: 'src/index.ts', line: 1, column: 1 }]);
  const tests = facts.languageScope.projects.find(p => p.config === 'tests/tsconfig.json');
  assert.deepEqual(tests.files, ['tests/main.ts']);
  assert.deepEqual(tests.members, ['src/index.ts', 'src/is-matching.ts', 'tests/main.ts']);
  assert.equal(facts.functions.filter(fn => fn.file === 'src/is-matching.ts').length, 1);
});

test('noResolve does not bind a dependency outside the caller Program', t => {
  const root = project(t, {
    'jsconfig.json': JSON.stringify({ compilerOptions: { noResolve: true }, include: ['main.js'] }),
    'main.js': 'import { run } from "./nested/run.js"; run();',
    'nested/jsconfig.json': '{}', 'nested/run.js': 'export function run() {}',
  });
  const { facts } = capture(root);
  assert.equal(facts.imports[0].to, 'nested/run.js');
  assert.equal(facts.calls[0].resolution, 'unresolved');
  assert.deepEqual(facts.languageScope.projects.find(p => p.config === 'jsconfig.json').members, ['main.js']);
});

test('shared forwarding with different contextual module selections stays unknown', t => {
  const root = project(t, {
    'jsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@impl': ['src/owner.js'] } }, include: ['src'] }),
    'src/bridge.js': 'export { run } from "@impl"; export { run as other } from "./caller.js";',
    'src/owner.js': 'export function run() {}', 'src/caller.js': 'export function run() {}',
    'tests/jsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '..', paths: { '@impl': ['src/caller.js'] } }, include: ['.'] }),
    'tests/main.js': 'import { run } from "../src/bridge.js"; run();',
  });
  const { facts } = capture(root);
  assert.equal(facts.imports.find(edge => edge.from === 'src/bridge.js' && edge.specifier === '@impl').to, 'src/owner.js');
  assert.equal(facts.calls.find(call => call.file === 'tests/main.js').resolution, 'unresolved');
  assert.deepEqual(facts.languageScope.projects.find(p => p.config === 'tests/jsconfig.json').members,
    ['src/bridge.js', 'src/caller.js', 'tests/main.js']);
});

test('shared CommonJS guards use caller Program members and visible mutations', t => {
  const root = project(t, {
    'jsconfig.json': JSON.stringify({ compilerOptions: { module: 'CommonJS' }, include: ['src'] }),
    'src/run.cjs': 'function run() {} module.exports.run = run;',
    'src/mutate.cjs': 'require("./run.cjs").run = () => {};',
    'tests/jsconfig.json': JSON.stringify({ compilerOptions: { module: 'CommonJS' }, include: ['.'] }),
    'tests/main.cjs': 'const { run } = require("../src/run.cjs"); run();',
  });
  const first = capture(root).facts;
  const call = first.calls.find(call => call.file === 'tests/main.cjs' && call.column > 40);
  assert.equal(call?.resolution, 'commonjs-function');
  assert.equal(call.target.file, 'src/run.cjs');
  fs.writeFileSync(path.join(root, 'tests/main.cjs'), 'require("../src/mutate.cjs");\nconst { run } = require("../src/run.cjs"); run();');
  const second = capture(root).facts;
  assert.equal(second.calls.find(call => call.file === 'tests/main.cjs' && call.line === 2 && call.column > 40)?.resolution, 'unresolved');
});

test('captured function spans remain valid after JavaScript Unicode line separators', t => {
  const root = project(t, { 'main.js': 'function first() {}\u2028function second() { return 2; }\u2029second();' });
  const { facts } = capture(root);
  assert.deepEqual(facts.functions.map(fn => [fn.name, fn.sourceRange.line, fn.sourceRange.column]), [
    ['first', 1, 1], ['second', 2, 1],
  ]);
  assert.equal(facts.calls[0].target?.name, 'second');
});
