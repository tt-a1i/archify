import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from '../vendor/typescript.cjs';
import { extract } from '../extract/ts/index.mjs';
import { extractFacts, buildGraph } from '../lib/analysis.mjs';
import { analysisContext } from '../evaluate/index.mjs';
import { comparability } from '../lib/review.mjs';
import { semanticErrors } from '../schemas/semantics.mjs';
import { schemaErrors } from '../schemas/index.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../config/defaults.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);
const auto = { ...config, typescript: { sdk: 'auto' } };

function project(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-project-ts-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [relative, text] of Object.entries({ 'main.js': 'function run() {} run();', ...files })) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return root;
}

function installedSdk(root, version = '5.9.71', { suppressCalls = true } = {}) {
  const directory = path.join(root, 'node_modules/typescript');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: 'typescript', version, main: 'index.cjs' }));
  // Reuse the tested compiler functions, but make one parser predicate observably
  // different. This proves the selected SDK reaches the extractor helpers too.
  fs.writeFileSync(path.join(directory, 'index.cjs'), [
    `const ts = require(${JSON.stringify(require.resolve('typescript'))});`,
    `module.exports = { ...ts, version: ${JSON.stringify(version)}${suppressCalls ? ', isCallExpression: () => false' : ''} };`,
  ].join('\n'));
  return directory;
}

test('auto selects the project SDK for extraction and records its provenance', t => {
  const root = project(t, { 'package.json': JSON.stringify({ devDependencies: { typescript: '5.9.71' } }) });
  installedSdk(root);
  const { facts } = extractFacts(root, { language: 'ts', config: auto });
  assert.equal(facts.repository.adapter, 'typescript@5.9.71');
  assert.deepEqual(facts.languageScope.sdk, { version: '5.9.71', source: 'project', status: 'matched' });
  assert.deepEqual(facts.calls, []);
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
});

test('bundled SDK remains available for JS without a TypeScript dependency', t => {
  const facts = extract(project(t), config);
  assert.equal(facts.repository.adapter, `typescript@${ts.version}`);
  assert.deepEqual(facts.languageScope.sdk, { version: ts.version, source: 'bundled', status: 'fallback' });
  assert.equal(facts.languageScope.limitations.length, 0);
  assert.equal(facts.calls.length, 1);
});

test('a missing declared base config omits only its nested package and blocks cross-package bindings', t => {
  const root = project(t, {
    'website/package.json': '{"devDependencies":{"shared-config":"1.0.0"}}',
    'website/tsconfig.json': '{"extends":"shared-config/strict"}',
    'website/app.ts': 'export function load() {}',
    'service/tsconfig.json': '{"compilerOptions":{"moduleResolution":"bundler","module":"esnext"}}',
    'service/index.ts': 'import { load } from "../website/app"; load();',
  });
  const capture = options => extractFacts(root, { language: 'ts', config, ...options }).facts;
  const partial = capture();
  assert.deepEqual(partial.files.map(f => f.path), ['main.js', 'service/index.ts']);
  assert.deepEqual(partial.languageScope.excludedByProject, [{ file: 'website/app.ts', config: 'website/tsconfig.json' }]);
  assert.deepEqual(partial.languageScope.unavailableProjects, [{ config: 'website/tsconfig.json', missingExtends: ['shared-config/strict'] }]);
  assert.deepEqual(partial.imports.map(i => [i.from, i.resolved]), [['service/index.ts', false]]);
  assert.equal(partial.calls.find(call => call.file === 'service/index.ts').target, undefined);
  assert.deepEqual(semanticErrors('raw-facts', partial), []);
  assert.deepEqual(capture({ capturedOnly: true }).languageScope.excludedByProject, partial.languageScope.excludedByProject);
  const installed = path.join(root, 'website/node_modules/shared-config');
  fs.mkdirSync(installed, { recursive: true });
  fs.writeFileSync(path.join(installed, 'package.json'), '{"name":"shared-config","version":"1.0.0"}');
  fs.writeFileSync(path.join(installed, 'strict.json'), '{"compilerOptions":{"strict":true}}');
  const complete = capture();
  const context = facts => analysisContext({ graph: buildGraph(facts, config), config, facts, active: [] });
  assert.equal(complete.languageScope.unavailableProjects, undefined);
  assert.equal(complete.calls.find(call => call.file === 'service/index.ts').target.file, 'website/app.ts');
  assert.equal(comparability(context(complete), context(complete)).comparable, true);
  for (const [left, right] of [[partial, complete], [complete, partial], [partial, partial]]) {
    const comparison = comparability(context(left), context(right));
    assert.equal(comparison.comparable, false);
    assert.ok(comparison.reasons.some(reason => reason.code === 'typescript-project-coverage-incomplete'));
  }
  assert.deepEqual(capture({ capturedOnly: true }).languageScope.excludedByProject, partial.languageScope.excludedByProject,
    'pinned capture does not use a base config installed only in the working tree');
});

test('root, malformed, local, undeclared and cross-package config failures stay hard errors', t => {
  const declared = '{"devDependencies":{"shared-config":"1.0.0"}}';
  for (const files of [
    { 'package.json': declared, 'tsconfig.json': '{"extends":"shared-config/strict"}' },
    { 'website/package.json': declared, 'website/tsconfig.json': '{"extends": "shared-config/strict", broken:' },
    { 'website/package.json': declared, 'website/tsconfig.json': '{"extends":"../base.json"}' },
    { 'website/package.json': '{}', 'website/tsconfig.json': '{"extends":"shared-config/strict"}' },
    { 'website/package.json': declared, 'website/tsconfig.json': '{"extends":"shared-config/strict","files":["../main.ts"]}', 'main.ts': 'export {}' },
  ]) {
    const root = project(t, { 'website/app.ts': 'export {}', ...files });
    assert.throws(() => extract(root, config), error => error.diagnostics?.[0].code === 'extract/tsconfig-invalid');
  }
  const root = project(t, {
    'website/package.json': declared,
    'website/tsconfig.json': '{"extends":"shared-config/strict"}',
    'website/app.ts': 'export {}',
  });
  fs.rmSync(path.join(root, 'main.js'));
  assert.throws(() => extract(root, config), error => error.diagnostics?.[0].code === 'extract/tsconfig-invalid',
    'an entirely omitted selection must not return empty success');
});

test('an installed config package with a missing subpath is a configuration error', t => {
  const root = project(t, {
    'website/package.json': '{"devDependencies":{"shared-config":"1.0.0"}}',
    'website/tsconfig.json': '{"extends":"shared-config/strict"}',
    'website/app.ts': 'export {}',
    'node_modules/shared-config/package.json': '{"name":"shared-config","version":"1.0.0"}',
    'node_modules/shared-config/base.json': '{}',
  });
  assert.throws(() => extract(root, config), error => error.diagnostics?.[0].code === 'extract/tsconfig-invalid');
});

test('unavailable nested configs do not hide inherited or referenced errors', t => {
  const shared = {
    'website/package.json': '{"devDependencies":{"shared-config":"1.0.0"}}',
    'website/app.ts': 'export {}',
  };
  for (const files of [
    {
      'website/tsconfig.json': '{"extends":["shared-config/strict","../base.json"]}',
      'base.json': '{"extends":"shared-config/strict"}',
    },
    {
      'website/tsconfig.json': '{"extends":"shared-config/strict","references":[{"path":"../other"}]}',
      'other/tsconfig.json': '{"compilerOptions": broken}',
    },
  ]) {
    const root = project(t, { ...shared, ...files });
    assert.throws(() => extract(root, config), error => error.diagnostics?.[0].code === 'extract/tsconfig-invalid');
  }
});

test('default and explicit bundled mode follow project references without loading installed SDKs', t => {
  const parent = project(t, {
    'package.json': '{"devDependencies":{"typescript":"5.9.71"}}',
    'app/package.json': '{"devDependencies":{"typescript":"5.9.71"}}',
    'app/tsconfig.json': '{"files":[],"references":[{"path":"./config/tsconfig.app.json"}]}',
    'app/config/tsconfig.app.json': '{"files":["../entry.ts","../target.ts"],"compilerOptions":{"paths":{"#run":["../target.ts"]}}}',
    'app/entry.ts': 'import { run } from "#run"; run();',
    'app/target.ts': 'export function run() {}',
  });
  const root = path.join(parent, 'app');
  for (const directory of [parent, root]) {
    const sdk = installedSdk(directory);
    fs.writeFileSync(path.join(sdk, 'index.cjs'), 'throw new Error("bundled capture loaded an installed SDK");');
  }
  const { typescript, ...withoutSdk } = config;
  assert.equal(typescript.sdk, 'bundled');
  for (const settings of [config, withoutSdk, { ...config, typescript: { sdk: 'bundled' } }]) {
    const { facts } = extractFacts(root, { language: 'ts', config: settings });
    assert.equal(facts.languageScope.sdk.source, 'bundled');
    assert.deepEqual(facts.languageScope.projects.map(project => [project.config, project.members]), [
      ['config/tsconfig.app.json', ['entry.ts', 'target.ts']],
    ]);
    assert.equal(facts.imports[0].to, 'target.ts');
    assert.equal(facts.calls[0].resolution, 'imported-function');
  }
  for (const sdk of [undefined, 'bundled']) {
    assert.throws(() => extract(root, { ...config, typescript: { sdk, requireProjectSdk: true } }),
      error => error.diagnostics?.[0].code === 'extract/typescript-sdk-required'
        && error.diagnostics[0].supportedFixes.some(fix => fix.includes('"auto"')));
  }
});

test('a source subtree resolves the installed SDK from its ancestor project', t => {
  const root = project(t, { 'package.json': JSON.stringify({ devDependencies: { typescript: '5.9.71' } }),
    'src/main.js': 'function run() {} run();' });
  installedSdk(root);
  const facts = extract(path.join(root, 'src'), { ...config, typescript: { sdk: 'auto', requireProjectSdk: true } });
  assert.equal(facts.repository.adapter, 'typescript@5.9.71');
  assert.equal(facts.languageScope.sdk.source, 'project');
});

test('pinned-tree capture uses the bundled SDK and frozen resolution inputs', t => {
  const parent = project(t);
  const sdk = installedSdk(parent);
  fs.writeFileSync(path.join(parent, 'base.json'),
    JSON.stringify({ compilerOptions: { paths: { '#target': ['./tree/target.js'] } } }));
  const root = path.join(parent, 'tree');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'jsconfig.json'), JSON.stringify({ extends: '../base.json' }));
  fs.writeFileSync(path.join(root, 'main.js'), 'import { target } from "#target"; target();');
  fs.writeFileSync(path.join(root, 'target.js'), 'export function target() {}');
  const settings = { ...config, typescript: { sdk, requireProjectSdk: true } };
  const live = extract(root, settings);
  assert.equal(live.repository.adapter, 'typescript@5.9.71');
  assert.equal(live.imports[0].to, 'target.js');

  assert.throws(() => extract(root, settings, { capturedOnly: true }),
    error => error.diagnostics?.[0].code === 'extract/tsconfig-invalid'
      && error.diagnostics[0].evidence.errors.some(message => message.includes('base.json')));

  fs.writeFileSync(path.join(root, 'jsconfig.json'), JSON.stringify({ compilerOptions: { paths: { '#target': ['./target.js'] } } }));
  let capture;
  // An uncached package makes execution observable under either opt-in.
  installedSdk(parent, '5.9.72');
  fs.writeFileSync(path.join(sdk, 'index.cjs'), 'throw new Error("pinned capture loaded the project SDK");');
  for (const sdkMode of ['auto', sdk]) {
    const pinned = extract(root, { ...config, typescript: { sdk: sdkMode, requireProjectSdk: true } },
      { capturedOnly: true, onCapture: value => { capture = value; } });
    assert.equal(pinned.repository.adapter, `typescript@${ts.version}`);
    assert.equal(pinned.languageScope.sdk.source, 'bundled');
    assert.equal(pinned.repository.sourceKind, 'working-tree');
    assert.equal(pinned.repository.root, '.');
    assert.equal(pinned.imports[0].to, 'target.js');
    assert.equal(pinned.calls[0].resolution, 'imported-function');
    assert.ok(capture.reads.has(path.join(root, 'jsconfig.json')));
    assert.equal(capture.reads.get(path.join(parent, 'base.json')), undefined);
  }
});

test('a changed SDK version at the same installation path is reloaded on the next capture', t => {
  const root = project(t);
  installedSdk(root, '5.9.71');
  assert.equal(extract(root, auto).repository.adapter, 'typescript@5.9.71');
  installedSdk(root, '5.9.72');
  assert.equal(extract(root, auto).repository.adapter, 'typescript@5.9.72');
});

test('a relinked installed SDK resolves to its new package instead of a cached Node path', t => {
  const root = project(t), first = installedSdk(project(t), '5.9.71'), second = installedSdk(project(t), '5.9.72');
  fs.mkdirSync(path.join(root, 'node_modules'));
  const link = path.join(root, 'node_modules/typescript');
  fs.symlinkSync(first, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(extract(root, auto).repository.adapter, 'typescript@5.9.71');
  fs.unlinkSync(link);
  fs.symlinkSync(second, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(extract(root, auto).repository.adapter, 'typescript@5.9.72');
});

test('declared but missing SDK is reported; strict mode refuses to fall back', t => {
  const root = project(t, { 'package.json': JSON.stringify({ devDependencies: { typescript: '5.9.71' } }) });
  const facts = extract(root, auto);
  assert.equal(facts.languageScope.sdk.source, 'bundled');
  assert.match(facts.languageScope.limitations[0], /declared but unavailable/);
  assert.throws(() => extract(root, { ...config, typescript: { sdk: 'auto', requireProjectSdk: true } }),
    error => error.diagnostics?.[0].code === 'extract/typescript-sdk-required');
});

test('explicit SDK path is selected and invalid paths are errors', t => {
  const root = project(t);
  const sdk = installedSdk(root);
  const facts = extract(root, { ...config, typescript: { sdk: path.relative(root, sdk) } });
  assert.deepEqual(facts.languageScope.sdk, { version: '5.9.71', source: 'explicit', status: 'matched' });
  assert.throws(() => extract(root, { ...config, typescript: { sdk: 'missing' } }),
    error => error.diagnostics?.[0].code === 'extract/typescript-sdk-invalid');
  assert.throws(() => extract(root, { ...config, typescript: { sdk: '' } }),
    error => error.diagnostics?.[0].code === 'extract/typescript-settings-invalid');
});

test('an external explicit SDK keeps a stable identity across analysis-root depths', t => {
  const sdk = installedSdk(project(t));
  const shallow = project(t);
  const deep = path.join(project(t), 'nested', 'project');
  fs.mkdirSync(deep, { recursive: true });
  fs.writeFileSync(path.join(deep, 'main.js'), 'function run() {} run();');
  const settings = { ...config, typescript: { sdk } };
  const first = extract(shallow, settings), second = extract(deep, settings);
  assert.equal(first.languageScope.sdks[0].packagePath, fs.realpathSync(sdk));
  assert.equal(second.languageScope.sdks[0].packagePath, fs.realpathSync(sdk));
});

test('different installed SDKs in one capture keep each project and its calls attributed', t => {
  const root = project(t, {
    'a/package.json': JSON.stringify({ devDependencies: { typescript: '5.9.71' } }),
    'a/main.js': 'import { a } from "./run.js"; import "../b/run.js"; a();',
    'a/run.js': 'export function a() {}',
    'b/package.json': JSON.stringify({ devDependencies: { typescript: '5.9.72' } }),
    'b/main.js': 'import { b } from "./run.js"; b();',
    'b/run.js': 'export function b() {}',
  });
  fs.unlinkSync(path.join(root, 'main.js'));
  installedSdk(path.join(root, 'a'), '5.9.71', { suppressCalls: false });
  installedSdk(path.join(root, 'b'), '5.9.72', { suppressCalls: false });
  const mixed = extract(root, auto);
  assert.equal(mixed.repository.adapter, 'typescript@multi');
  assert.deepEqual(mixed.languageScope.sdks.map(sdk => sdk.version), ['5.9.71', '5.9.72']);
  assert.deepEqual(mixed.languageScope.projects.map(project => [project.sdkVersion, project.files]), [
    ['5.9.71', ['a/main.js', 'a/run.js']], ['5.9.72', ['b/main.js', 'b/run.js']],
  ]);
  assert.ok(mixed.imports.some(edge => edge.from === 'a/main.js' && edge.to === 'b/run.js'));
  assert.deepEqual(mixed.calls.map(call => [call.file, call.target?.file, call.resolution]), [
    ['a/main.js', 'a/run.js', 'imported-function'], ['b/main.js', 'b/run.js', 'imported-function'],
  ]);
  assert.deepEqual(schemaErrors('raw-facts', { ...mixed, repository: { ...mixed.repository, snapshotId: '0'.repeat(64) } }), []);
  const wrongMarker = structuredClone(mixed);
  wrongMarker.languageScope.sdk.source = 'bundled';
  assert.ok(schemaErrors('raw-facts', { ...wrongMarker, repository: { ...wrongMarker.repository, snapshotId: '0'.repeat(64) } })
    .some(error => error.message.includes('multi-SDK provenance')));
  const forced = extract(root, { ...config, typescript: { sdk: 'a/node_modules/typescript' } });
  assert.deepEqual(forced.languageScope.sdk, { version: '5.9.71', source: 'explicit', status: 'matched' });
});

test('a shared ancestor config supplies paths to a nested package with its own SDK', t => {
  const root = project(t, {
    'tsconfig.json': JSON.stringify({
      compilerOptions: { paths: { '#run': ['./nested/run.ts'] } },
      include: ['main.ts', 'nested/*.ts'],
    }),
    'main.ts': 'export const root = true;',
    'nested/main.ts': 'import { run } from "#run"; run();',
    'nested/run.ts': 'export function run() {}',
  });
  fs.unlinkSync(path.join(root, 'main.js'));
  installedSdk(root, '5.9.71', { suppressCalls: false });
  installedSdk(path.join(root, 'nested'), '5.9.72', { suppressCalls: false });
  const { facts } = extractFacts(root, { language: 'ts', config: auto });
  assert.deepEqual(facts.languageScope.projects.map(project => [project.config, project.sdkVersion, project.files]), [
    ['tsconfig.json', '5.9.71', ['main.ts']],
    ['tsconfig.json', '5.9.72', ['nested/main.ts', 'nested/run.ts']],
  ]);
  assert.equal(facts.imports[0].to, 'nested/run.ts');
  assert.equal(facts.calls[0].resolution, 'imported-function');
});

test('a solution parses each referenced config with its selected SDK', t => {
  const root = project(t, {
    'tsconfig.json': '{"files":[],"references":[{"path":"./configs/api.json"},{"path":"./configs/web.json"}]}',
    'configs/api.json': '{"files":["../api/main.ts"]}',
    'api/main.ts': 'export const api = 1;',
    'configs/web.json': '{"files":["../web/main.ts","../web/run.ts"],"compilerOptions":{"erasableSyntaxOnly":true,"paths":{"#run":["../web/run.ts"]}}}',
    'web/main.ts': 'import { run } from "#run"; run();',
    'web/run.ts': 'export function run() {}',
  });
  fs.unlinkSync(path.join(root, 'main.js'));
  const api = path.join(root, 'api'), web = path.join(root, 'web');
  const oldSdk = process.env.ARCHIFY_TEST_TYPESCRIPT_SDK_OLD;
  const newSdk = process.env.ARCHIFY_TEST_TYPESCRIPT_SDK_NEW;
  const usingRealSdks = oldSdk && newSdk;
  const older = installedSdk(api, '5.7.3', { suppressCalls: false });
  const newer = installedSdk(web, '6.0.3', { suppressCalls: false });
  // The regular platform suite has bundled TypeScript only. Model the older
  // option table with a shim there, and allow a run with both real packages.
  if (usingRealSdks) {
    for (const [target, directory] of [[oldSdk, older], [newSdk, newer]]) {
      fs.rmSync(directory, { recursive: true });
      fs.symlinkSync(target, directory, process.platform === 'win32' ? 'junction' : 'dir');
    }
  } else {
    fs.appendFileSync(path.join(older, 'index.cjs'), `
const parse = ts.parseJsonConfigFileContent;
module.exports.parseJsonConfigFileContent = (config, ...args) => {
  const result = parse(config, ...args);
  if (config.compilerOptions?.erasableSyntaxOnly) result.errors.push({ code: 5023, messageText: "Unknown compiler option 'erasableSyntaxOnly'." });
  return result;
};
`);
  }
  assert.throws(() => extract(root, { ...config, typescript: { sdk: older } }),
    error => error.diagnostics?.[0].code === 'extract/tsconfig-invalid'
      && error.diagnostics[0].evidence.errors.some(message => message.includes('erasableSyntaxOnly')));
  const { facts } = extractFacts(root, { language: 'ts', config: auto });
  assert.deepEqual(facts.languageScope.projects.map(project => [project.config, project.sdkVersion, project.members]), [
    ['configs/api.json', usingRealSdks ? require(oldSdk).version : '5.7.3', ['api/main.ts']],
    ['configs/web.json', usingRealSdks ? require(newSdk).version : '6.0.3', ['web/main.ts', 'web/run.ts']],
  ]);
  assert.equal(facts.imports[0].to, 'web/run.ts');
  assert.equal(facts.calls[0].resolution, 'imported-function');

  if (usingRealSdks) fs.unlinkSync(newer);
  else fs.rmSync(newer, { recursive: true });
  const fallback = extract(root, auto);
  const webProject = fallback.languageScope.projects.find(project => project.config === 'configs/web.json');
  assert.equal(fallback.languageScope.sdks[webProject.sdkIndex].source, 'bundled');
  assert.equal(fallback.imports[0].to, 'web/run.ts');
});

test('the project SDK index must point to a recorded SDK even when its version is omitted', t => {
  const { facts } = extractFacts(project(t), { language: 'ts', config });
  assert.equal(facts.languageScope.projects[0].sdkIndex, 0);
  assert.deepEqual(semanticErrors('raw-facts', facts), []);
  const projectRecord = facts.languageScope.projects[0];
  projectRecord.sdkIndex = 99;
  delete projectRecord.sdkVersion;
  assert.ok(semanticErrors('raw-facts', facts).some(error => error.path === '/languageScope/projects/0/sdkIndex'));
});

test('SDKs of inferred sources remain captured producers', t => {
  const root = project(t, {
    'a/package.json': JSON.stringify({ devDependencies: { typescript: '5.9.71' } }),
    'a/main.js': 'export function a() {}',
    'b/package.json': JSON.stringify({ devDependencies: { typescript: '5.9.72' } }),
    'b/jsconfig.json': JSON.stringify({ include: ['other.js'] }),
    'b/main.js': 'export function b() {}',
  });
  fs.unlinkSync(path.join(root, 'main.js'));
  installedSdk(path.join(root, 'a'), '5.9.71');
  installedSdk(path.join(root, 'b'), '5.9.72');
  const { facts } = extractFacts(root, { language: 'ts', config: auto });
  assert.equal(facts.repository.adapter, 'typescript@multi');
  assert.deepEqual(facts.languageScope.sdks.map(sdk => sdk.version), ['5.9.71', '5.9.72']);
  assert.deepEqual(facts.files.map(file => file.path), ['a/main.js', 'b/main.js']);
  assert.deepEqual(facts.languageScope.excludedByProject, []);
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
});

test('strict SDK selection also applies to inferred sources outside a configured project', t => {
  const root = project(t, {
    'a/package.json': JSON.stringify({ devDependencies: { typescript: '5.9.71' } }),
    'a/main.js': 'export function a() {}',
    'b/package.json': JSON.stringify({ devDependencies: { typescript: '5.9.72' } }),
    'b/jsconfig.json': JSON.stringify({ include: ['other.js'] }),
    'b/main.js': 'export function b() {}',
  });
  fs.unlinkSync(path.join(root, 'main.js'));
  installedSdk(path.join(root, 'a'), '5.9.71');
  assert.throws(() => extract(root, { ...config, typescript: { sdk: 'auto', requireProjectSdk: true } }),
    error => error.diagnostics?.[0].code === 'extract/typescript-sdk-required');
});

test('unvalidated SDK versions fail with a version diagnostic', t => {
  const root = project(t);
  installedSdk(root, '4.9.5');
  assert.throws(() => extract(root, { ...config, typescript: { sdk: 'node_modules/typescript' } }),
    error => error.diagnostics?.[0].code === 'extract/typescript-sdk-unsupported');
});

test('an unsupported auto SDK is ignored only when Archify excludes all its sources', t => {
  const root = project(t, {
    'old/package.json': JSON.stringify({ devDependencies: { typescript: '4.9.5' } }),
    'old/jsconfig.json': JSON.stringify({ include: ['other.js'] }),
    'old/main.js': 'export {};',
  });
  installedSdk(path.join(root, 'old'), '4.9.5');
  const facts = extract(root, { ...auto, exclude: [...auto.exclude, 'old/**'] });
  assert.deepEqual(facts.files.map(file => file.path), ['main.js']);
  assert.deepEqual(facts.languageScope.sdks.map(sdk => sdk.version), [ts.version]);
  assert.throws(() => extract(root, auto), error => error.diagnostics?.[0].code === 'extract/typescript-sdk-unsupported');
});

test('auto skips unsupported installed SDKs when no sources are selected', t => {
  const root = project(t);
  installedSdk(root, '4.9.5');
  const facts = extract(root, { ...auto, include: ['**/*.ts'] });
  assert.deepEqual(facts.files, []);
  assert.equal(facts.languageScope.sdk.source, 'bundled');
  assert.throws(() => extract(root, auto), error => error.diagnostics?.[0].code === 'extract/typescript-sdk-unsupported');
});

test('auto ignores NODE_PATH packages while explicit paths can select them', t => {
  const root = project(t, { 'package.json': '{"devDependencies":{"typescript":"5.9.71"}}' });
  const sdk = installedSdk(project(t));
  const entry = new URL('../extract/ts/index.mjs', import.meta.url).href;
  const code = `
    import assert from 'node:assert/strict';
    import { extract } from ${JSON.stringify(entry)};
    const root = ${JSON.stringify(root)}, config = ${JSON.stringify(auto)};
    const facts = extract(root, config);
    assert.equal(facts.languageScope.sdk.source, 'bundled');
    assert.match(facts.languageScope.limitations[0], /declared but unavailable/);
    const explicit = extract(root, { ...config, typescript: { sdk: ${JSON.stringify(sdk)} } });
    assert.equal(explicit.languageScope.sdk.source, 'explicit');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, NODE_PATH: path.dirname(sdk) }, encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});

test('different selected SDK versions make history comparisons noncomparable', t => {
  const roots = ['5.9.71', '5.9.72'].map(version => {
    const root = project(t, { 'package.json': JSON.stringify({ devDependencies: { typescript: version } }) });
    installedSdk(root, version);
    return root;
  });
  const contexts = roots.map(root => {
    const { facts } = extractFacts(root, { language: 'ts', config: auto });
    return analysisContext({ graph: buildGraph(facts, config), config, facts });
  });
  assert.ok(comparability(...contexts).reasons.some(reason => reason.code === 'adapter-changed'));
});

test('shared source targets do not exchange ASTs between selected SDKs', t => {
  const root = project(t, {
    'a/package.json': JSON.stringify({ devDependencies: { typescript: '5.9.71' } }),
    'a/main.js': 'import { run } from "../b/run.js"; run();',
    'b/package.json': JSON.stringify({ devDependencies: { typescript: '5.9.72' } }),
    'b/run.js': 'export function run() {}',
  });
  fs.unlinkSync(path.join(root, 'main.js'));
  installedSdk(path.join(root, 'a'), '5.9.71', { suppressCalls: false });
  installedSdk(path.join(root, 'b'), '5.9.72', { suppressCalls: false });
  const { facts } = extractFacts(root, { language: 'ts', config: auto });
  assert.equal(facts.imports[0].to, 'b/run.js');
  assert.equal(facts.calls[0].resolution, 'unresolved');
  assert.deepEqual(facts.languageScope.projects.find(p => p.files.includes('a/main.js')).members, ['a/main.js']);
  const mixed = structuredClone(facts);
  mixed.languageScope.projects.find(p => p.files.includes('a/main.js')).members.push('b/run.js');
  assert.ok(schemaErrors('raw-facts', mixed).some(error => error.message.includes('same SDK')));
});

test('changing one SDK in a multi-version capture changes project comparison scope', t => {
  const contexts = ['5.9.72', '5.9.73'].map(secondVersion => {
    const root = project(t, {
      'a/package.json': JSON.stringify({ devDependencies: { typescript: '5.9.71' } }),
      'a/main.js': 'export const a = 1;',
      'b/package.json': JSON.stringify({ devDependencies: { typescript: secondVersion } }),
      'b/main.js': 'export const b = 2;',
    });
    fs.unlinkSync(path.join(root, 'main.js'));
    installedSdk(path.join(root, 'a'), '5.9.71');
    installedSdk(path.join(root, 'b'), secondVersion);
    const { facts } = extractFacts(root, { language: 'ts', config: auto });
    assert.equal(facts.repository.adapter, 'typescript@multi');
    return analysisContext({ graph: buildGraph(facts, config), config, facts });
  });
  assert.ok(comparability(...contexts).reasons.some(reason => reason.code === 'typescript-project-scope-changed'));
});
