import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
const base = process.env.ARCHIFY_DEFINITION_TEST_MODULE;
const load = relative => import(base ? pathToFileURL(path.join(base, relative)) : new URL(`../${relative}`, import.meta.url));
const { extractFacts } = await load('lib/analysis.mjs');
const { schemaErrors } = await load('extract/shared/schema.mjs');
const { measureFunctions } = await load('extract/java/functions.mjs');
const { lexAndParse } = await import('java-parser');

function capture(t, language, source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-definition-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, language === 'py' ? 'entry.py' : 'Example.java'), source);
  const { facts } = extractFacts(root, { language });
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
  return facts;
}
// Expectations come from literal source substrings, never from parser ranges.
function exact(source, fn, expected, kind) {
  assert.ok(fn.definition, `${fn.qualname} has captured definition metadata`);
  assert.equal(fn.definition.kind, kind);
  const at = source.indexOf(expected);
  assert.notEqual(at, -1);
  const point = offset => {
    const prefix = source.slice(0, offset).split(/\r\n|[\r\n]/);
    return { line: prefix.length, column: prefix.at(-1).length + 1 };
  };
  const start = point(at), end = point(at + expected.length);
  assert.deepEqual(fn.definition.sourceRange, { ...start, endLine: end.line, endColumn: end.column,
    sha256: createHash('sha256').update(expected).digest('hex') });
}

test('definition metadata: Python owns actual stacked parenthesized decorator tokens while call starts stay at def', t => {
  const owned = '@(\r\n    decorate("😀")\r\n)\r\n@other(\r\n    1\r\n)\r\nasync def run(x=1):\r\n    return x';
  const source = '# unrelated comment\r\n' + owned + '\r\n';
  const facts = capture(t, 'py', source), fn = facts.functions[0];
  exact(source, fn, owned, 'AsyncFunctionDef');
  assert.equal(fn.sourceRange.line, 8);
  assert.equal(fn.sourceRange.column, 1);
  assert.equal(fn.line, 8);
  const changed = capture(t, 'py', source.replace('other(', 'changed(')).functions[0];
  assert.equal(changed.sourceRange.sha256, fn.sourceRange.sha256, 'decorator edit does not change python-lexical-v1 extent');
  assert.notEqual(changed.definition.sourceRange.sha256, fn.definition.sourceRange.sha256, 'decorator edit is captured');
});

test('definition metadata: Python nested/class/duplicate definitions retain independent owned ranges', t => {
  const source = 'class C:\n    @((deco))\n    def run(self):\n        @wrap\n        def inner(): return "😀"\n        return inner\ndef same(): pass\ndef same(): return 1\n';
  const facts = capture(t, 'py', source);
  exact(source, facts.functions[0], '@((deco))\n    def run(self):\n        @wrap\n        def inner(): return "😀"\n        return inner', 'FunctionDef');
  exact(source, facts.functions[1], '@wrap\n        def inner(): return "😀"', 'FunctionDef');
  assert.equal(facts.functions[1].qualname, 'C.run.<locals>.inner');
  assert.deepEqual(facts.functions.slice(2).map(fn => fn.qualname), ['same', 'same']);
  for (const fn of facts.functions.slice(2)) assert.deepEqual(fn.definition.sourceRange, fn.sourceRange);
});

test('definition metadata: Java includes annotations/modifiers with exact same-line, CRLF and astral bounds', t => {
  const method = '@Deprecated public static String run() { return "😀\\u0041"; }';
  const source = '// not owned\r\nabstract class Example {\r\n  /* 😀 */ ' + method + ' void run(int x) {}\r\n  @Deprecated public Example() {}\r\n  abstract void absent(); native void nativeAbsent();\r\n  static {} { } Runnable callback = () -> {};\r\n}\r\ninterface I { default void go() {} void absent(); }\r\nrecord R(int x) { R { } }\r\n';
  const facts = capture(t, 'java', source);
  const fn = facts.functions.find(f => f.qualname === 'Example.run()');
  exact(source, fn, method, 'methodDeclaration');
  exact(source, facts.functions.find(f => f.qualname === 'Example.run(int)'), 'void run(int x) {}', 'methodDeclaration');
  exact(source, facts.functions.find(f => f.qualname === 'Example.Example()'), '@Deprecated public Example() {}', 'constructorDeclaration');
  exact(source, facts.functions.find(f => f.qualname === 'I.go()'), 'default void go() {}', 'interfaceMethodDeclaration');
  exact(source, facts.functions.find(f => f.qualname === 'R.R(int)'), 'R { }', 'compactConstructorDeclaration');
  assert.ok(!facts.functions.some(f => f.name.includes('absent') || f.name === 'nativeAbsent'));
  assert.ok(facts.functions.filter(f => f.name.includes('initializer') || f.name === 'callback').every(f => !f.definition));
  const changed = capture(t, 'java', source.replace('public static String run', 'private static String run')).functions.find(f => f.qualname === fn.qualname);
  assert.notEqual(changed.definition.sourceRange.sha256, fn.definition.sourceRange.sha256);
});

test('definition metadata: Java preprocessing-required escapes remain parse-invalid; invalid offsets are unavailable', t => {
  const facts = capture(t, 'java', 'class Example { void r\\u0075n() {} }');
  assert.equal(facts.parse_errors.length, 1);
  assert.deepEqual(facts.functions, []);
  const sourceText = 'class Example { void run() {} }';
  const parsed = lexAndParse(sourceText);
  const visit = node => {
    if (node.name === 'methodDeclaration') node.location.endOffset = sourceText.length + 10;
    for (const child of Object.values(node.children).flat()) if (child.name) visit(child);
  };
  visit(parsed.cst);
  const fn = measureFunctions({ file: 'Example.java', sourceText, ...parsed })[0];
  assert.ok(!fn.definition, 'invalid CST offset never becomes guessed whole-line evidence');
});

test('definition metadata: schema rejects corrupt hashes, reversed/outside ranges and wrong language kinds; historical metadata is optional', t => {
  for (const language of ['py', 'java']) {
    const facts = capture(t, language, language === 'py' ? '@deco\ndef run(): return 1\n' : 'class Example { void run() {} }');
    const mutate = edit => { const bad = structuredClone(facts); edit(bad.functions[0].definition); return schemaErrors('raw-facts', bad); };
    assert.ok(mutate(d => { d.sourceRange.sha256 = '0'.repeat(64); }).some(e => e.path.includes('/definition/')));
    assert.ok(mutate(d => { d.sourceRange.column = 1000; }).length);
    assert.ok(mutate(d => { d.sourceRange.endLine = 1; d.sourceRange.endColumn = 1; }).length);
    assert.ok(mutate(d => { d.kind = language === 'py' ? 'methodDeclaration' : 'FunctionDef'; }).length);
    delete facts.functions[0].definition;
    assert.deepEqual(schemaErrors('raw-facts', facts), []);
  }
});
