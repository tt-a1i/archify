import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractFacts, buildGraph, loadConfig, mergeConfig } from '../lib/analysis.mjs';
import { buildQuestion } from '../lib/explain.mjs';
import { captureChangeSide, buildChangeQuestion } from '../lib/change-question.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-go-calls-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({ 'go.mod': 'module example.org/app\n\ngo 1.18\n', ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}
const scopeConfig = config => mergeConfig(loadConfig(), config || {});
const capture = (root, config) => extractFacts(root, { language: 'go', config: scopeConfig(config) }).facts;
const callsIn = (facts, file) => facts.calls.filter(call => call.file === file);

test('Go ordinary and alias imports, same-package cross-file calls and external tests navigate to declaration starts', t => {
  const root = fixture(t, {
    'lib/work.go': 'package lib\nfunc Work() {}\n',
    'lib/other.go': 'package lib\nfunc Other() { Work() }\n',
    'main.go': 'package main\nimport alias "example.org/app/lib"\nfunc main() { alias.Work(); alias.Other() }\n',
    'lib/internal_test.go': 'package lib\nfunc testHelper() {}\nfunc TestInternal() { testHelper(); Work() }\n',
    'lib/work_test.go': 'package lib_test\nimport "example.org/app/lib"\nfunc TestIt() { lib.Work() }\n',
  });
  const facts = capture(root); assert.deepEqual(schemaErrors('raw-facts', facts), []);
  for (const file of ['main.go', 'lib/other.go', 'lib/work_test.go']) {
    const call = callsIn(facts, file)[0]; assert.equal(call.resolution, 'go-direct-function');
    assert.deepEqual(call.target, { file: 'lib/work.go', name: 'Work', line: 2, column: 1 });
  }
  const internalCalls = callsIn(facts, 'lib/internal_test.go');
  assert.equal(internalCalls[0].target.name, 'testHelper'); assert.equal(internalCalls[1].target.name, 'Work');
  const question = buildQuestion({ root, facts, question: 'Follow aliases', entry: 'main.go', symbol: 'main' });
  assert.equal(question.calls.coverage, 'available'); assert.ok(question.calls.records.every(row => row.targetNavigation.status === 'valid'));
  assert.equal(question.scope.languageScope.module, 'example.org/app');
  const graph = buildGraph(facts, {}); assert.equal(graph.modules.length, 2);
  assert.equal(graph.fileModules['lib/work.go'], graph.fileModules['lib/other.go']);
  assert.notEqual(graph.fileModules['main.go'], graph.fileModules['lib/work.go']);
});

test('Go interface/method/variable calls, shadows and invalid duplicate definitions never manufacture function targets', t => {
  const root = fixture(t, {
    'lib/work.go': 'package lib\nfunc Work() {}\nfunc Clash() {}\nvar Clash func()\n',
    'main.go': `package main
import alias "example.org/app/lib"
type I interface { Work() }
type S struct{}
func (S) Work() {}
var callback = alias.Work
func use(i I, s S) { i.Work(); s.Work(); callback(); alias.Clash() }
func shadow() { alias := struct{ Work func() }{}; alias.Work() }
`,
  });
  const facts = capture(root); assert.deepEqual(schemaErrors('raw-facts', facts), []);
  assert.ok(callsIn(facts, 'main.go').every(call => call.resolution === 'unresolved'));
  assert.deepEqual(callsIn(facts, 'main.go').slice(0, 2).map(call => call.reason), ['go-method-dispatch', 'go-method-dispatch']);
  assert.ok(facts.languageScope.typing.errorCount > 0);
});

test('Go source scope honors platform/tags, tests and nested module identity; parse failure is visible', t => {
  const root = fixture(t, {
    'a_linux.go': 'package app\nfunc Platform() {}\n',
    'a_windows.go': 'package app\nfunc Platform() {}\n',
    'custom.go': '//go:build extra\n\npackage app\nfunc Extra() {}\n',
    'entry.go': 'package app\nfunc Entry() { Platform() }\n',
    'bad.go': 'package app\nfunc Broken( {\n',
    'entry_test.go': 'package app\nfunc TestEntry() { Entry() }\n',
    'nested/go.mod': 'module other.org/nested\n', 'nested/main.go': 'package nested\nfunc Hidden() {}\n',
  });
  const facts = capture(root, { include: ['**/*.go'], exclude: [], go: { goos: 'linux', goarch: 'amd64', tests: false, tags: [] } });
  assert.deepEqual(schemaErrors('raw-facts', facts), []); assert.equal(facts.parse_errors[0].path, 'bad.go');
  assert.equal(callsIn(facts, 'entry.go')[0].resolution, 'unresolved');
  const excluded = new Map(facts.languageScope.excludedFiles.map(row => [row.file, row.reason]));
  assert.equal(excluded.get('a_windows.go'), 'build-conditions-or-filename');
  assert.equal(excluded.get('custom.go'), 'build-conditions-or-filename');
  assert.equal(excluded.get('entry_test.go'), 'tests-disabled');
  assert.equal(excluded.get('nested/main.go'), 'nested-module-not-loaded');
  assert.deepEqual(Object.fromEntries(['goos', 'goarch', 'cgo', 'goWork', 'replace', 'tags', 'tests'].map(key => [key, facts.languageScope.build[key]])), { goos: 'linux', goarch: 'amd64', cgo: false, goWork: 'not-loaded', replace: 'not-loaded', tags: [], tests: false });
  assert.ok(facts.languageScope.build.releaseTags.includes('go1.18'));
  assert.equal(facts.languageScope.build.goFlags, 'not-loaded');
  fs.unlinkSync(path.join(root, 'bad.go'));
  const tagged = capture(root, { include: ['**/*.go'], exclude: [], go: { goos: 'windows', tags: ['extra'] } });
  assert.ok(tagged.files.some(file => file.path === 'custom.go'));
  assert.equal(callsIn(tagged, 'entry.go')[0].target.file, 'a_windows.go');
});

test('Go imported module identity differs from directory names and package-declared names', t => {
  const root = fixture(t, { 'local/work.go': 'package different\nfunc Work() {}\n',
    'entry.go': 'package app\nimport "example.org/app/local"\nimport bad "wrong.org/app/local"\nfunc Entry() { different.Work(); bad.Work() }\n' });
  const facts = capture(root); const calls = callsIn(facts, 'entry.go');
  assert.equal(calls[0].target.file, 'local/work.go'); assert.equal(calls[1].resolution, 'unresolved');
  assert.ok(facts.languageScope.typing.externalPackagesNotLoaded.includes('wrong.org/app/local'));
});

test('Go UTF-16 ranges, saved metadata freshness and paired changed-definition callers reuse source evidence', t => {
  const root = fixture(t, { 'lib/work.go': 'package lib\nfunc Work() { _ = "😀"; println("x"); }\n',
    'entry.go': 'package app\nimport "example.org/app/lib"\nfunc Entry() { lib.Work() }\n' });
  const facts = capture(root); assert.deepEqual(schemaErrors('raw-facts', facts), []);
  const unicodeCall = callsIn(facts, 'lib/work.go')[0];
  assert.equal(unicodeCall.column, fs.readFileSync(path.join(root, 'lib/work.go'), 'utf8').split('\n')[1].indexOf('println') + 1);
  const base = captureChangeSide(root, scopeConfig({ include: ['**/*.go'], exclude: [] }), 'go');
  fs.writeFileSync(path.join(root, 'lib/work.go'), 'package lib\nfunc Work() { _ = "😀"; println("changed"); }\n');
  const headRoot = fixture(t, { 'lib/work.go': fs.readFileSync(path.join(root, 'lib/work.go'), 'utf8'),
    'entry.go': fs.readFileSync(path.join(root, 'entry.go'), 'utf8') });
  // Keep base sources fresh for paired navigation.
  fs.writeFileSync(path.join(root, 'lib/work.go'), 'package lib\nfunc Work() { _ = "😀"; println("x"); }\n');
  const head = captureChangeSide(headRoot, scopeConfig({ include: ['**/*.go'], exclude: [] }), 'go');
  const paired = buildChangeQuestion({ question: 'What references changed Work?', entry: 'lib/work.go', base, head, config: scopeConfig({ include: ['**/*.go'], exclude: [] }) });
  const change = paired.changedDefinitions.items.find(row => row.head.definition.name === 'Work');
  assert.equal(change.head.knownReferences.total, 1); assert.equal(change.head.knownReferences.items[0].navigation.location.file, 'entry.go');
  fs.writeFileSync(path.join(root, 'go.mod'), 'module wrong.org/app\n');
  const question = buildQuestion({ root, facts, question: 'Follow Work', entry: 'entry.go', symbol: 'Entry' });
  assert.equal(question.calls.coverage, 'unavailable'); assert.equal(question.entry.factsStatus, 'resolution-input-changed');
});


test('Go missing compiler and invalid scope fail through the normal CLI with actionable diagnostics', t => {
  const root = fixture(t, { 'entry.go': 'package app\nfunc Work() {}\n' });
  const check = fileURLToPath(new URL('../bin/check.mjs', import.meta.url));
  const missing = spawnSync(process.execPath, [check, root, '--language', 'go', '--fail-on', 'never', '--json'], {
    encoding: 'utf8', env: { ...process.env, ARCHIFY_GO: path.join(root, 'missing-go') },
  });
  assert.equal(missing.status, 2); const error = JSON.parse(missing.stdout);
  assert.equal(error.diagnostics[0].code, 'extract/go-unavailable');
  assert.ok(error.diagnostics[0].supportedFixes.some(fix => fix.includes('Go 1.18+')));
  assert.throws(() => capture(root, { go: { tags: 'wrong' } }), error => error.diagnostics?.[0].code === 'extract/go-config-invalid');
});
