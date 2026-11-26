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

test('kotlin review2: lowercase enum entries resolve and constructor arguments do not', t => {
  const root = fixture(t, {
    'p/Mode.kt': 'package p\nenum class Mode {\n  active(ONE),\n  INACTIVE;\n  fun label() = name\n}\nobject ONE\n',
    'p/Use.kt': 'package p\nimport p.Mode.active\nclass Use(val mode: Mode)\n',
    'p/Bad.kt': 'package p\nimport p.Mode.ONE\nclass Bad(val mode: Mode)\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(facts.parse_errors, undefined);
  assert.equal(facts.imports.find(imp => imp.specifier === 'p.Mode.active').resolved, true);
  // ONE is a constructor argument of the entry, never an entry itself.
  assert.equal(facts.imports.find(imp => imp.specifier === 'p.Mode.ONE').resolved, false);
});

test('kotlin review2: enum entry bodies feed dependencies and complexity', t => {
  const root = fixture(t, {
    'p/Dep.kt': 'package p\nclass Dep\n',
    'p/Mode.kt': 'package p\nenum class Mode {\n  active {\n    override fun label(): Dep = Dep()\n  },\n  INACTIVE;\n  abstract fun label(): Dep\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(facts.parse_errors, undefined);
  assert.equal(edges(facts, 'p/Mode.kt', 'Dep').length > 0, true);
  assert.equal(facts.functions.some(f => (f.qualname || '').includes('active') && f.name === 'label'), true);
});

test('kotlin review2: entry-body members never become enum member evidence', t => {
  const root = fixture(t, {
    'p/Mode.kt': 'package p\nenum class Mode {\n  active {\n    fun special(): Int = 1\n  },\n  INACTIVE;\n  abstract fun label(): Int\n}\n',
    'p/Use.kt': 'package p\nimport p.Mode.special\nclass Use(val mode: Mode)\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  // special is declared only inside the entry body: it is not a member of the
  // enum type, so the member import stays unresolved.
  assert.equal(facts.imports.find(imp => imp.specifier === 'p.Mode.special').resolved, false);
  // The entry itself remains valid member evidence.
  const root2 = fixture(t, {
    'p/Mode2.kt': 'package p\nenum class Mode2 {\n  active {\n    override fun label(): Int = 1\n  };\n  abstract fun label(): Int\n}\n',
    'p/Use2.kt': 'package p\nimport p.Mode2.active\nclass Use2(val mode: Mode2)\n',
  });
  const r2 = extractFacts(root2, { language: 'kotlin', config: config() });
  assert.equal(r2.facts.imports.find(imp => imp.specifier === 'p.Mode2.active').resolved, true);
});

test('kotlin review2: private setters never misplace following nested types', t => {
  const root = fixture(t, {
    'p/Counter.kt': 'package p\nclass Counter {\n  var count = 0\n    private set(value) {\n      if (value >= 0) {\n        field = value\n      }\n    }\n  class Snapshot\n}\n',
    'p/Use.kt': 'package p\nclass Use(val snap: Counter.Snapshot)\n',
  });
  const parsed = parseSources(root, config());
  assert.deepEqual(parsed.parse_errors, []);
  const counter = parsed.units[0].declarations[0];
  assert.equal(counter.name, 'Counter');
  assert.equal(counter.members.some(m => m.name === 'Snapshot'), true);
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(edges(facts, 'p/Use.kt', 'Counter.Snapshot').length > 0, true);
});

test('kotlin review2: parenthesized function-type receivers do not drop the file', t => {
  const root = fixture(t, {
    'p/Dep.kt': 'package p\nclass Dep\n',
    'p/Mode.kt': 'package p\nenum class Mode {\n  ACTIVE {\n    private fun (() -> Dep).runAction(): Int = 1\n    override fun run() = 1\n  };\n  abstract fun run(): Int\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(facts.parse_errors, undefined);
  assert.equal(facts.functions.some(f => f.file.endsWith('p/Mode.kt')), true);
  // The type inside the receiver is genuine dependency evidence.
  assert.equal(edges(facts, 'p/Mode.kt', 'Dep').length > 0, true);
});

test('kotlin review2: enum entry calls are inventoried without same-scope binding', t => {
  const root = fixture(t, {
    'p/Mode.kt': 'package p\nenum class Mode {\n  ACTIVE {\n    override fun run() {\n      helper()\n    }\n  };\n  abstract fun run()\n  fun helper() {}\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const site = facts.calls.find(c => c.file.endsWith('p/Mode.kt'));
  assert.ok(site, 'the call inside the entry override must be inventoried');
  // helper is a member of the enum, but the entry body is an anonymous
  // subclass: the conservative lexical model must not bind it same-scope.
  assert.equal(site.target ?? null, null);
});
