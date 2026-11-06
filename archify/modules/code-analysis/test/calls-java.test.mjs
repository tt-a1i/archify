import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { ARCHIFY_PACKAGE } from './helpers.mjs';
import { extractFacts } from '../lib/analysis.mjs';
import { buildQuestion } from '../lib/explain.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

function fixture(t, source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-java-calls-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'A.java'), source);
  const { facts } = extractFacts(root, { language: 'java' });
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
  return { root, facts, entry: 'A.java', question: 'Where should I read next?' };
}
const spelling = (source, call) => source.split(/\r\n|[\r\n]/)[call.line - 1].slice(call.column - 1, call.endColumn - 1);

test('Java calls inventory keeps full chained UTF16 spans and excludes constructors/references/annotations', t => {
  const source = 'class A { static A make() { return null; } static void sink(Object x) {} @Deprecated void chosen() { String s = "😀"; make().toString(); sink(make()); new A(); Runnable r = A::make; Runnable l = () -> make(); } }';
  const args = fixture(t, source);
  assert.equal(args.facts.callModel, 'java-static-lexical-v1');
  assert.deepEqual(args.facts.calls.map(call => spelling(source, call)), ['make()', 'make().toString()', 'sink(make())', 'make()', 'make()']);
  assert.deepEqual(args.facts.calls.map(call => call.resolution), ['same-file-static-method', 'unresolved', 'same-file-static-method', 'same-file-static-method', 'same-file-static-method']);
  const [first, chained] = args.facts.calls;
  assert.equal(first.column, source.indexOf('make().') + 1);
  assert.equal(first.column, chained.column);
  const question = buildQuestion({ ...args, symbol: 'chosen' });
  assert.equal(question.calls.total, 5);
  assert.equal(question.calls.bindingCoverage, 'top-level-class-unique-static-fixed-arity-source-candidates');
  assert.ok(question.calls.records.filter(record => record.fact.target).every(record => record.targetNavigation.status === 'valid'));
  assert.ok(question.calls.limitations.some(text => text.includes('compilation are not checked')));
});

test('Java lexical candidates reject overloads, members, explicit type args, arity, varargs and inherited Object names', t => {
  const source = `class A {
 static void yes() {} static void overloaded() {} static void overloaded(int x) {}
 static void spread(String... x) {} static void one(int x) {} void instance() {}
 static <T> void generic() {} public String toString() { return ""; }
 void chosen() { yes(); overloaded(); spread(); one(); instance(); A.yes(); this.instance(); A.<String>generic(); toString(); missing(); }
}`;
  const { facts } = fixture(t, source);
  assert.equal(facts.calls.length, 10);
  assert.deepEqual(facts.calls.filter(call => call.target).map(call => call.target.name), ['yes']);
  assert.equal(facts.calls.find(call => spelling(source, call) === 'overloaded()').reason, 'ambiguous-binding');
});

test('Java invocation inventory retains nested/local/anonymous sites while target binding excludes those owners and supertypes', t => {
  const source = `class A {
 static void yes() {} void chosen() { yes(); class Local { void run() { yes(); } } new Object() { void run() { yes(); } }; }
 static class Nested { static void yes() {} void run() { yes(); } }
}
class B extends A { void run() { yes(); } }
class C implements Runnable { static void yes() {} public void run() { yes(); } }
interface I { static void yes() {} default void run() { yes(); } }
record R(int x) { static void yes() {} void run() { yes(); } }
enum E { VALUE; static void yes() {} void run() { yes(); } }`;
  const args = fixture(t, source);
  assert.equal(args.facts.calls.length, 9);
  assert.equal(args.facts.calls.filter(call => call.target).length, 1);
  assert.equal(buildQuestion({ ...args, symbol: 'A.chosen()' }).calls.total, 3);
});

test('Java exact function selection excludes same-line neighbours; historical, zero, parse failure and freshness remain distinct', t => {
  const source = 'class A { static void yes() {} void before() { yes(); } void chosen() { yes(); } void after() { yes(); } void empty() {} }';
  const args = fixture(t, source);
  const selected = buildQuestion({ ...args, symbol: 'chosen' }).calls;
  assert.equal(selected.coverage, 'available'); assert.equal(selected.total, 1);
  assert.equal(selected.records[0].fact.column, source.indexOf('yes();', source.indexOf('void chosen')) + 1);
  assert.equal(buildQuestion({ ...args, symbol: 'empty' }).calls.total, 0);
  const historical = structuredClone(args.facts); delete historical.callModel; historical.calls = [];
  assert.equal(buildQuestion({ ...args, facts: historical, symbol: 'chosen' }).calls.total, null);
  const wrong = structuredClone(args.facts); wrong.calls[0].target.column++;
  assert.ok(schemaErrors('raw-facts', wrong).some(error => error.path === '/calls/0/target'));
  const corrupt = structuredClone(args.facts);
  corrupt.functions.find(fn => fn.name === 'chosen').sourceRange.sha256 = '0'.repeat(64);
  assert.ok(schemaErrors('raw-facts', corrupt).some(error => error.path.endsWith('/sourceRange')));
  assert.equal(buildQuestion({ ...args, facts: corrupt, symbol: 'chosen' }).calls.reason, 'function-range-unavailable');
  const missing = structuredClone(args.facts);
  delete missing.functions[0].sourceRange;
  assert.ok(schemaErrors('raw-facts', missing).some(error => error.path === '/functions/0/sourceRange'));
  fs.appendFileSync(path.join(args.root, args.entry), '\n// changed');
  assert.equal(buildQuestion({ ...args, symbol: 'chosen' }).calls.reason, 'entry-changed');
  const broken = fixture(t, 'class A { void chosen() { missing(); } void broken( }');
  assert.equal(broken.facts.calls.length, 0);
  assert.equal(buildQuestion({ ...broken }).calls.reason, 'entry-parse-errors');
});

test('public saved Java task exposes lexical calls and historical unknown separately', t => {
  const args = fixture(t, 'class A { static void helper() {} void chosen() { helper(); missing(); } }');
  const analysis = path.join(args.root, 'saved'); fs.mkdirSync(analysis);
  const factsPath = path.join(analysis, 'raw-facts.json');
  const run = () => {
    const result = spawnSync(process.execPath, [path.join(ARCHIFY_PACKAGE, 'bin/archify.mjs'), 'code-analysis', 'task', analysis,
      '--question', args.question, '--entry', args.entry, '--function', 'chosen', '--root', args.root, '--format', 'json'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout).calls;
  };
  fs.writeFileSync(factsPath, JSON.stringify(args.facts));
  const current = run();
  assert.equal(current.coverage, 'available'); assert.equal(current.total, 2);
  assert.deepEqual(current.records.map(record => record.targetNavigation.status), ['valid', 'unresolved']);
  delete args.facts.callModel; args.facts.calls = [];
  fs.writeFileSync(factsPath, JSON.stringify(args.facts));
  const old = run(); assert.equal(old.coverage, 'unavailable'); assert.equal(old.total, null);
});


test('Java multiline CRLF invocation ranges and declaration hashes preserve original source positions', t => {
  const source = ['class A {', ' static void helper(int x) {}', ' void chosen() {', '  String label = "😀"; helper(', '   1', '  );', ' }', '}'].join('\r\n');
  const args = fixture(t, source);
  const calls = buildQuestion({ ...args, symbol: 'chosen' }).calls;
  assert.equal(calls.total, 1);
  assert.deepEqual(calls.selection.range, { line: 3, column: 2, endLine: 7, endColumn: 3 });
  const call = calls.records[0];
  assert.deepEqual({ line: call.fact.line, column: call.fact.column, endLine: call.fact.endLine, endColumn: call.fact.endColumn },
    { line: 4, column: source.split('\r\n')[3].indexOf('helper(') + 1, endLine: 6, endColumn: 4 });
  assert.equal(call.targetNavigation.status, 'valid');
  assert.equal(call.targetNavigation.location.column, 2);
});
