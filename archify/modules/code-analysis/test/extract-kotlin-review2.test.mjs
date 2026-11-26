// Regression coverage for the second automated-review round on the Kotlin
// adapter (PR #1509). Each test names a finding verified fixed at the head
// that introduced it; do not relax these to match wrong output.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseSources } from '../extract/kotlin/parse.mjs';
import { loadConfig, extractFacts } from '../lib/analysis.mjs';

const config = () => ({ ...loadConfig(), include: ['**/*.kt'] });
function fixture(t, sources) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-kotlin-review2-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(sources)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}
const edges = (facts, file, specifier) =>
  facts.imports.filter(imp => imp.from.endsWith(file) && imp.resolved && (!specifier || imp.specifier === specifier));

test('kotlin review2: type parameters cover bodyless constructor signatures', t => {
  const root = fixture(t, {
    'p/T.kt': 'package p\nclass T\n',
    'p/Box.kt': 'package p\ndata class Box<T>(val item: T)\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(edges(facts, 'p/Box.kt', 'T').length, 0);
});

test('kotlin review2: type parameters cover abstract function return types', t => {
  const root = fixture(t, {
    'p/T.kt': 'package p\nclass T\n',
    'p/Base.kt': 'package p\nabstract class Base {\n  abstract fun <T> read(): T\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(edges(facts, 'p/Base.kt', 'T').length, 0);
});

test('kotlin review2: type parameters cover typealias right-hand sides', t => {
  const root = fixture(t, {
    'p/T.kt': 'package p\nclass T\n',
    'p/Alias.kt': 'package p\ntypealias Box<T> = List<T>\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(edges(facts, 'p/Alias.kt', 'T').length, 0);
});

test('kotlin review2: multiline delegation keeps members inside the class', t => {
  const root = fixture(t, {
    'p/Delegate.kt': 'package p\ninterface Base\nclass User(flag: Boolean, a: Base, b: Base) : Base by if (flag)\n  a\n  else b {\n  fun method() = 1\n}\n',
  });
  const parsed = parseSources(root, config());
  assert.deepEqual(parsed.parse_errors, []);
  const unit = parsed.units[0];
  const user = unit.declarations.find(d => d.name === 'User');
  assert.deepEqual(user.members.map(m => m.name), ['method']);
  assert.equal(unit.declarations.some(d => d.name === 'method'), false);
});

test('kotlin review2: enum entries resolve through member imports', t => {
  const root = fixture(t, {
    'p/Mode.kt': 'package p\nenum class Mode {\n  ACTIVE,\n  INACTIVE;\n  fun label() = name\n}\n',
    'p/Use.kt': 'package p\nimport p.Mode.ACTIVE\nclass Use(val mode: Mode)\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const entry = facts.imports.find(imp => imp.specifier === 'p.Mode.ACTIVE');
  assert.equal(entry.resolved, true);
  assert.equal(entry.to, 'p/Mode.kt');
});

test('kotlin review2: enum member imports still require the entry to exist', t => {
  const root = fixture(t, {
    'p/Mode.kt': 'package p\nenum class Mode {\n  ACTIVE\n}\n',
    'p/Use.kt': 'package p\nimport p.Mode.MISSING\nclass Use(val mode: Mode)\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(facts.imports.find(imp => imp.specifier === 'p.Mode.MISSING').resolved, false);
});

test('kotlin review2: a local class shadows project classifiers in its block', t => {
  const root = fixture(t, {
    'p/Widget.kt': 'package p\nclass Widget\n',
    'p/Use.kt': 'package p\nclass Use {\n  fun run() {\n    class Widget\n    Widget()\n  }\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(edges(facts, 'p/Use.kt', 'Widget').length, 0);
});

test('kotlin review2: a local class does not shadow before its declaration', t => {
  const root = fixture(t, {
    'p/Widget.kt': 'package p\nclass Widget\n',
    'p/Use.kt': 'package p\nclass Use {\n  val early: Widget = Widget()\n  fun run() {\n    class Widget\n    Widget()\n  }\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  // The property type and constructor above the local class still bind the
  // project Widget; only uses inside run's block stay unbound.
  assert.equal(edges(facts, 'p/Use.kt', 'Widget').length > 0, true);
});

test('kotlin review2: qualified construction on a value receiver is no type edge', t => {
  const root = fixture(t, {
    'p/Widget.kt': 'package p\nclass Widget\n',
    'p/Service.kt': 'package p\nclass Service\n',
    'p/Use.kt': 'package p\nclass Use {\n  fun make(p: Service) = p.Widget()\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(facts.imports.filter(imp => imp.from.endsWith('p/Use.kt') && imp.specifier.includes('Widget')).length, 0);
});

test('kotlin review2: qualified construction through a package still resolves', t => {
  const root = fixture(t, {
    'p/Widget.kt': 'package p\nclass Widget\n',
    'q/Use.kt': 'package q\nimport p.Widget\nclass Use {\n  fun make() = p.Widget()\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(edges(facts, 'q/Use.kt', 'p.Widget').length > 0, true);
});

test('kotlin review2: local values suppress constructors only inside their block', t => {
  const root = fixture(t, {
    'p/Widget.kt': 'package p\nclass Widget\n',
    'p/Use.kt': 'package p\nclass Use {\n  fun run(flag: Boolean) {\n    if (flag) {\n      val Widget = { 1 }\n      Widget()\n    }\n    Widget()\n  }\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  // Exactly one edge: the invocation outside the if block constructs the
  // project Widget; the one inside invokes the local callable.
  assert.equal(edges(facts, 'p/Use.kt', 'Widget').length, 1);
});

test('kotlin review2: explicit getter types produce type dependencies', t => {
  const root = fixture(t, {
    'p/Token.kt': 'package p\nclass Token\n',
    'p/Use.kt': 'package p\nclass Use {\n  val token get(): Token = Token()\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(edges(facts, 'p/Use.kt', 'Token').length > 0, true);
});

test('kotlin review2: member imports never bind test helpers from main', t => {
  const root = fixture(t, {
    'build.gradle.kts': '// root\n',
    'src/main/kotlin/p/Use.kt': 'package p\nimport p.helper\nclass Use\n',
    'src/test/kotlin/p/Helpers.kt': 'package p\nfun helper() {}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(facts.imports.find(imp => imp.specifier === 'p.helper').resolved, false);
});

test('kotlin review2: member imports still bind same-module main helpers', t => {
  const root = fixture(t, {
    'build.gradle.kts': '// root\n',
    'src/main/kotlin/p/Use.kt': 'package p\nimport p.helper\nclass Use\n',
    'src/main/kotlin/p/Helpers.kt': 'package p\nfun helper() {}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(facts.imports.find(imp => imp.specifier === 'p.helper').resolved, true);
});
