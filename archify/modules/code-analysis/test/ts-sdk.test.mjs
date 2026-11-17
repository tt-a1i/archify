import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';
import { extract } from '../extract/ts/index.mjs';
import { extractFacts, buildGraph } from '../lib/analysis.mjs';
import { analysisContext } from '../evaluate/index.mjs';
import { comparability } from '../lib/review.mjs';
import { schemaErrors } from '../schemas/index.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../config/defaults.json', import.meta.url), 'utf8'));
const require = createRequire(import.meta.url);

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
  const { facts } = extractFacts(root, { language: 'ts', config });
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

test('a source subtree resolves the installed SDK from its ancestor project', t => {
  const root = project(t, { 'package.json': JSON.stringify({ devDependencies: { typescript: '5.9.71' } }),
    'src/main.js': 'function run() {} run();' });
  installedSdk(root);
  const facts = extract(path.join(root, 'src'), { ...config, typescript: { requireProjectSdk: true } });
  assert.equal(facts.repository.adapter, 'typescript@5.9.71');
  assert.equal(facts.languageScope.sdk.source, 'project');
});

test('a changed SDK version at the same installation path is reloaded on the next capture', t => {
  const root = project(t);
  installedSdk(root, '5.9.71');
  assert.equal(extract(root, config).repository.adapter, 'typescript@5.9.71');
  installedSdk(root, '5.9.72');
  assert.equal(extract(root, config).repository.adapter, 'typescript@5.9.72');
});

test('a relinked installed SDK resolves to its new package instead of a cached Node path', t => {
  const root = project(t), first = installedSdk(project(t), '5.9.71'), second = installedSdk(project(t), '5.9.72');
  fs.mkdirSync(path.join(root, 'node_modules'));
  const link = path.join(root, 'node_modules/typescript');
  fs.symlinkSync(first, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(extract(root, config).repository.adapter, 'typescript@5.9.71');
  fs.unlinkSync(link);
  fs.symlinkSync(second, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(extract(root, config).repository.adapter, 'typescript@5.9.72');
});

test('declared but missing SDK is reported; strict mode refuses to fall back', t => {
  const root = project(t, { 'package.json': JSON.stringify({ devDependencies: { typescript: '5.9.71' } }) });
  const facts = extract(root, config);
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
  const mixed = extract(root, config);
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
  const { facts } = extractFacts(root, { language: 'ts', config });
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
  const facts = extract(root, { ...config, exclude: [...config.exclude, 'old/**'] });
  assert.deepEqual(facts.files.map(file => file.path), ['main.js']);
  assert.deepEqual(facts.languageScope.sdks.map(sdk => sdk.version), [ts.version]);
  assert.throws(() => extract(root, config), error => error.diagnostics?.[0].code === 'extract/typescript-sdk-unsupported');
});

test('different selected SDK versions make history comparisons noncomparable', t => {
  const roots = ['5.9.71', '5.9.72'].map(version => {
    const root = project(t, { 'package.json': JSON.stringify({ devDependencies: { typescript: version } }) });
    installedSdk(root, version);
    return root;
  });
  const contexts = roots.map(root => {
    const { facts } = extractFacts(root, { language: 'ts', config });
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
  const { facts } = extractFacts(root, { language: 'ts', config });
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
    const { facts } = extractFacts(root, { language: 'ts', config });
    assert.equal(facts.repository.adapter, 'typescript@multi');
    return analysisContext({ graph: buildGraph(facts, config), config, facts });
  });
  assert.ok(comparability(...contexts).reasons.some(reason => reason.code === 'typescript-project-scope-changed'));
});
