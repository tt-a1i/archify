// Regression coverage for review feedback on the Kotlin adapter (PR #1509):
// each test names the parsing, resolution or integration behaviour a review
// comment showed broken. Do not relax these to match wrong output.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseSources } from '../extract/kotlin/parse.mjs';
import { analysisContext } from '../evaluate/index.mjs';
import { loadConfig, extractFacts, buildGraph, evaluateGraph } from '../lib/analysis.mjs';

const config = () => ({ ...loadConfig(), include: ['**/*.kt'] });
function fixture(t, sources) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-kotlin-review-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(sources)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}
const importsFrom = (facts, file) => facts.imports.filter(imp => imp.from === file && imp.resolved);

test('kotlin review: unicode letters form identifiers and classifiers resolve', t => {
  const root = fixture(t, {
    'p/Üser.kt': 'package p\nclass Üser\n',
    'p/Use.kt': 'package p\nclass Use(val üser: Üser)\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(facts.parse_errors, undefined);
  assert.equal(importsFrom(facts, 'p/Use.kt').find(imp => imp.specifier === 'Üser')?.to, 'p/Üser.kt');
});

test('kotlin review: backtick-escaped names are identifiers, never keywords', t => {
  const root = fixture(t, {
    'p/Escaped.kt': 'package p\nclass `object`\n',
    'p/Use.kt': 'package p\nclass Use(val escaped: `object`)\n',
  });
  const parsed = parseSources(root, config());
  assert.deepEqual(parsed.parse_errors, []);
  assert.equal(parsed.units[0].declarations[0].name, 'object');
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(importsFrom(facts, 'p/Use.kt').length > 0, true);
});

test('kotlin review: in/out variance parses in type arguments and parameters', t => {
  const root = fixture(t, {
    'p/Variance.kt': 'package p\nclass Box<in T>\nclass Source<out R>\nfun copy(target: MutableList<in String>, source: List<out String>) {}\n',
  });
  const parsed = parseSources(root, config());
  assert.deepEqual(parsed.parse_errors, []);
  assert.equal(parsed.units[0].declarations.length, 3);
});

test('kotlin review: semicolons terminate package and import headers', t => {
  const root = fixture(t, {
    'p/Semi.kt': 'package p;\nimport java.util.ArrayList;\nclass Semi\n',
  });
  const parsed = parseSources(root, config());
  assert.deepEqual(parsed.parse_errors, []);
  assert.equal(parsed.units[0].packageName, 'p');
  assert.equal(parsed.units[0].imports[0].name, 'java.util.ArrayList');
});

test('kotlin review: nullable extension receivers parse with the receiver type', t => {
  const root = fixture(t, {
    'p/Ext.kt': 'package p\nfun String?.nullableTag(): String = this ?: ""\nfun String.plainTag(): String = this\n',
  });
  const parsed = parseSources(root, config());
  assert.deepEqual(parsed.parse_errors, []);
  const [nullable, plain] = parsed.units[0].declarations;
  assert.equal(nullable.name, 'nullableTag');
  assert.equal(nullable.receiverReference?.name, 'String');
  assert.equal(plain.receiverReference?.name, 'String');
});

test('kotlin review: explicit getter result types do not corrupt declarations', t => {
  const root = fixture(t, {
    'p/Props.kt': 'package p\nclass Props {\n  val size: Int\n    get(): Int = 1\n}\n',
  });
  const parsed = parseSources(root, config());
  assert.deepEqual(parsed.parse_errors, []);
  assert.equal(parsed.units[0].declarations[0].name, 'Props');
});

test('kotlin review: multiline expression-bodied if reaches the else branch', t => {
  const root = fixture(t, {
    'p/Branch.kt': 'package p\nfun pick(flag: Boolean) = if (flag)\n  "yes"\nelse\n  "no"\nfun next() = 1\n',
  });
  const parsed = parseSources(root, config());
  assert.deepEqual(parsed.parse_errors, []);
  assert.deepEqual(parsed.units[0].declarations.map(d => d.name), ['pick', 'next']);
});

test('kotlin review: a delegation specifier does not swallow the next declaration', t => {
  const root = fixture(t, {
    'p/Delegate.kt': 'package p\ninterface Base\nclass Impl : Base\nclass User(b: Base) : Base by b\nclass After\n',
  });
  const parsed = parseSources(root, config());
  assert.deepEqual(parsed.parse_errors, []);
  assert.deepEqual(parsed.units[0].declarations.map(d => d.name), ['Base', 'Impl', 'User', 'After']);
});

test('kotlin review: type-parameter shadowing is scoped to its declaration', t => {
  const root = fixture(t, {
    'p/T.kt': 'package p\nclass T\n',
    'p/Pair.kt': 'package p\nclass Generic<T> {\n  fun shadowed(value: T): T = value\n}\nclass Plain {\n  fun real(value: T): T = value\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const edges = importsFrom(facts, 'p/Pair.kt');
  // Generic<T>.T is a type parameter: no edge. Plain.T is the real class: exactly one edge.
  assert.equal(edges.filter(imp => imp.specifier === 'T').length, 1);
});

test('kotlin review: a constructor call shadowed by a value parameter is no type edge', t => {
  const root = fixture(t, {
    'p/Widget.kt': 'package p\nclass Widget\n',
    'p/Use.kt': 'package p\nclass Use {\n  fun build(Widget: () -> Unit) {\n    Widget()\n  }\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(importsFrom(facts, 'p/Use.kt').filter(imp => imp.specifier === 'Widget').length, 0);
});

test('kotlin review: private top-level classifiers do not resolve across files', t => {
  const root = fixture(t, {
    'p/Hidden.kt': 'package p\nprivate class Hidden\n',
    'p/Use.kt': 'package p\nclass Use(val hidden: Hidden)\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(importsFrom(facts, 'p/Use.kt').filter(imp => imp.specifier === 'Hidden').length, 0);
});

test('kotlin review: a member import requires the member to exist on the target', t => {
  const root = fixture(t, {
    'p/Foo.kt': 'package p\nclass Foo {\n  fun present() {}\n}\n',
    'p/Use.kt': 'package p\nimport p.Foo.absent\nclass Use(val foo: Foo)\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const member = facts.imports.find(imp => imp.specifier === 'p.Foo.absent');
  assert.equal(member.resolved, false);
});

test('kotlin review: main sources never resolve to test-only classifiers', t => {
  const root = fixture(t, {
    'src/main/kotlin/p/Use.kt': 'package p\nclass Use(val helper: Helper)\n',
    'src/test/kotlin/p/Helper.kt': 'package p\nclass Helper\n',
    'build.gradle.kts': '// marker\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(importsFrom(facts, 'src/main/kotlin/p/Use.kt').filter(imp => imp.specifier === 'Helper').length, 0);
});

test('kotlin review: cross-module test classifiers stay invisible across Gradle modules', t => {
  const root = fixture(t, {
    'app/build.gradle.kts': '// app\n',
    'lib/build.gradle.kts': '// lib\n',
    'app/src/test/kotlin/p/Helper.kt': 'package p\nclass Helper\n',
    'lib/src/test/kotlin/p/Use.kt': 'package p\nclass Use(val helper: Helper)\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(importsFrom(facts, 'lib/src/test/kotlin/p/Use.kt').filter(imp => imp.specifier === 'Helper').length, 0);
});

test('kotlin review: mixed java/kotlin trees autodetect instead of aborting', t => {
  const root = fixture(t, {
    'src/Use.kt': 'package p\nclass Use\n',
    'src/Legacy.java': 'package p;\nclass Legacy {}\n',
  });
  const { facts } = extractFacts(root, { config: config() });
  assert.ok(['java', 'kotlin'].includes(facts.repository.language));
});

test('kotlin review: kotlin-only globs never change another language config digest', () => {
  const graph = { repository: { language: 'ts' }, excluded: { roles: [] }, grouping: {} };
  const base = analysisContext({ graph, config: { include: ['**/*.ts'], exclude: [] } });
  const widened = analysisContext({ graph, config: { include: ['**/*.ts', '**/*.kt'], exclude: ['**/target/**/*.kt'] } });
  assert.equal(widened.configDigest, base.configDigest);
  const shifted = analysisContext({ graph, config: { include: ['**/*.ts', 'lib/**/*.ts'], exclude: [] } });
  assert.notEqual(shifted.configDigest, base.configDigest);
});

test('kotlin review: kotlin-only globs still count for kotlin digests', () => {
  const graph = { repository: { language: 'kotlin' }, excluded: { roles: [] }, grouping: {} };
  const base = analysisContext({ graph, config: { include: ['**/*.kt'], exclude: [] } });
  const widened = analysisContext({ graph, config: { include: ['**/*.kt'], exclude: ['**/target/**/*.kt'] } });
  assert.notEqual(widened.configDigest, base.configDigest);
});

test('kotlin review: kotlin fixture evaluation stays consistent end to end', t => {
  const root = fixture(t, {
    'p/Widget.kt': 'package p\nclass Widget\n',
    'p/Use.kt': 'package p\nclass Use {\n  fun make(): Widget = Widget()\n}\n',
  });
  const { facts, config: cfg } = extractFacts(root, { language: 'kotlin', config: config() });
  const graph = buildGraph(facts, cfg);
  const report = evaluateGraph(graph, cfg, facts);
  assert.ok(report);
  assert.equal(facts.parse_errors, undefined);
});

test('kotlin review: package-qualified constructor invocations resolve as types', t => {
  const root = fixture(t, {
    'p/Widget.kt': 'package p\nclass Widget\n',
    'q/Use.kt': 'package q\nimport p.Widget\nclass Use {\n  fun make() = p.Widget()\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const edge = importsFrom(facts, 'q/Use.kt').find(imp => imp.specifier === 'p.Widget');
  assert.equal(edge?.to, 'p/Widget.kt');
});

test('kotlin review: trailing commas do not inflate call arity', t => {
  // Arity selects between overloads: target(1, 2,) must bind the two-parameter
  // overload; counting the trailing comma as a third argument leaves no match.
  const root = fixture(t, {
    'p/Calls.kt': 'package p\nfun target(a: Int) {}\nfun target(a: Int, b: Int) {}\nfun run() {\n  target(1, 2,)\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const call = facts.calls?.find(site => site.target?.name === 'target');
  assert.equal(call?.target?.line, 3);
});

test('kotlin review: invocations nested in call arguments are scanned', t => {
  const root = fixture(t, {
    'p/Nested.kt': 'package p\nfun outer(x: Int) {}\nfun inner(): Int = 1\nfun run() {\n  outer(inner())\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const inner = facts.calls?.filter(site => site.target?.name === 'inner') || [];
  assert.equal(inner.length > 0, true);
});

test('kotlin review: annotated accessors do not displace later class members', t => {
  // @Synchronized get() { … } is one accessor: without annotation-aware
  // lookahead the accessor body terminates the class early and nested types
  // leak to file scope, breaking cross-file references through the class.
  const root = fixture(t, {
    'p/Counter.kt': 'package p\nclass Counter {\n  val count: Int = 0\n    @Synchronized get() { return 1 }\n  class Snapshot\n}\n',
    'p/Use.kt': 'package p\nclass Use(val s: Counter.Snapshot)\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(facts.parse_errors?.length ?? 0, 0);
  const edge = importsFrom(facts, 'p/Use.kt').find(imp => imp.to === 'p/Counter.kt');
  assert.equal(edge?.to, 'p/Counter.kt');
});

test('kotlin review: annotated setter with arguments and modifier stays inside the class', t => {
  const root = fixture(t, {
    'p/Counter.kt': 'package p\nclass Counter {\n  var count: Int = 0\n    @Suppress("unused") private set(value) { field = value }\n  class Snapshot\n}\n',
    'p/Use.kt': 'package p\nclass Use(val s: Counter.Snapshot)\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const edge = importsFrom(facts, 'p/Use.kt').find(imp => imp.to === 'p/Counter.kt');
  assert.equal(edge?.to, 'p/Counter.kt');
});

test('kotlin review: receiver function type parameters parse without scope loss', t => {
  // String.() -> Unit is the DSL-builder idiom: the dot continues the type.
  // When it failed to parse, recovery skipped tokens one at a time and the
  // function body's closing brace ended the class.
  const root = fixture(t, {
    'p/Builder.kt': 'package p\nclass Builder {\n  fun build(block: String.() -> Unit) { block() }\n  class Snapshot\n}\n',
    'p/Use.kt': 'package p\nclass Use(val s: Builder.Snapshot)\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(facts.parse_errors?.length ?? 0, 0);
  const edge = importsFrom(facts, 'p/Use.kt').find(imp => imp.to === 'p/Builder.kt');
  assert.equal(edge?.to, 'p/Builder.kt');
});

test('kotlin review: qualified types in parenthesized receivers keep their package', t => {
  // Both demo.Payload and other.Payload exist: the receiver of the extension
  // explicitly qualifies other.Payload, so only other/Payload.kt may receive
  // the edge — never the same-package simple-name candidate.
  const root = fixture(t, {
    'demo/Payload.kt': 'package demo\nclass Payload\n',
    'other/Payload.kt': 'package other\nclass Payload\n',
    'demo/Ext.kt': 'package demo\nfun ((other.Payload) -> Unit).runAction() = Unit\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const edges = importsFrom(facts, 'demo/Ext.kt');
  assert.equal(edges.some(imp => imp.to === 'other/Payload.kt'), true);
  assert.equal(edges.some(imp => imp.to === 'demo/Payload.kt'), false);
});

test('kotlin review: receiver lambda parameter names are not types, lowercase-named types are collected', t => {
  // String.(Payload: String, event: Événement) -> Unit: Payload is the NAME
  // of a string parameter and must not link demo/Payload.kt; Événement is a
  // real type reference hidden behind a lowercase name and must resolve.
  const root = fixture(t, {
    'demo/Payload.kt': 'package demo\nclass Payload\n',
    'demo/Événement.kt': 'package demo\nclass Événement\n',
    'demo/Ext.kt': 'package demo\nfun register(block: String.(Payload: String, event: Événement) -> Unit) = Unit\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const edges = importsFrom(facts, 'demo/Ext.kt');
  assert.equal(edges.some(imp => imp.to === 'demo/Événement.kt'), true);
  assert.equal(edges.some(imp => imp.to === 'demo/Payload.kt'), false);
});

test('kotlin review: receiver lambda overloads keep stable finding ids when one is removed', t => {
  // configure(Builder.() -> Unit) and configure(Builder.(String) -> Unit) share
  // the first classifier reference (the receiver). When the signature erased
  // the lambda parameter list both measured as configure(Builder), forcing
  // ordinal disambiguation — and removing the first overload renumbered the
  // second one's finding id.
  const overload = (type) => `  fun configure(block: Builder.${type} -> Unit) {\n    if (block is Any) { println(block) }\n  }\n`;
  const lowThreshold = () => {
    const c = config();
    c.rules = { ...c.rules, complexity: { function: { info: { complexity: 1, nesting: 99 }, warning: { complexity: 99, nesting: 99 } } } };
    return c;
  };
  const idsFor = (members) => {
    const root = fixture(t, { 'Demo.kt': `package demo\nclass Builder\nclass Hooks {\n${members}}\n` });
    const cfg = lowThreshold();
    const { facts } = extractFacts(root, { language: 'kotlin', config: cfg });
    return evaluateGraph(buildGraph(facts, cfg), cfg, facts).diagnostics
      .filter(d => d.code === 'complexity/function')
      .map(d => ({ id: d.id, fn: d.subject.function }));
  };
  const both = idsFor(overload('()') + overload('(String)'));
  const survivorOnly = idsFor(overload('(String)'));
  const survivorInBoth = both.find(d => d.fn.includes('(String)'));
  assert.equal(both.length, 2);
  assert.notEqual(both[0].fn, both[1].fn);
  assert.equal(survivorOnly.length, 1);
  assert.equal(survivorOnly[0].id, survivorInBoth.id);
});

test('kotlin review: type-use annotations in nested function-type results parse and resolve', t => {
  // ((Int) -> @Marker String) -> Unit — the annotation prefixes the result
  // type inside a nested callback. Before type-use annotation support the
  // parse error dropped the entire file: dependencies, plus the complexity
  // measurement of unrelated functions.
  const root = fixture(t, {
    'demo/Marker.kt': 'package demo\n@Target(AnnotationTarget.TYPE)\nannotation class Marker\n',
    'demo/Ext.kt': 'package demo\nfun register(block: ((Int) -> @Marker String) -> Unit) = Unit\nfun other(): Int {\n  if (1 < 2) return 1\n  return 0\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(facts.parse_errors?.length ?? 0, 0);
  const edge = importsFrom(facts, 'demo/Ext.kt').find(imp => imp.to === 'demo/Marker.kt');
  assert.equal(edge?.to, 'demo/Marker.kt');
  const other = (facts.functions ?? []).find(fn => fn.name === 'other');
  assert.equal(typeof other?.complexity, 'number');
});

test('kotlin review: argumentless annotation before a function type keeps the parameter references', t => {
  // @Mark (Payload) -> Result — the group after an argumentless type-use
  // annotation is the function type parameter list, not constructor
  // arguments. Both forms must link Payload: argumentless and with explicit
  // annotation arguments.
  const root = fixture(t, {
    'demo/Mark.kt': 'package demo\n@Target(AnnotationTarget.TYPE)\nannotation class Mark(val value: Int = 0)\n',
    'demo/Payload.kt': 'package demo\nclass Payload\n',
    'demo/Result.kt': 'package demo\nclass Result\n',
    'demo/Ext.kt': 'package demo\nfun register(block: (@Mark (Payload) -> Result) -> Unit) = Unit\n',
    'demo/ExtArgs.kt': 'package demo\nfun registerArgs(block: (@Mark(1) (Payload) -> Result) -> Unit) = Unit\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(facts.parse_errors?.length ?? 0, 0);
  for (const file of ['demo/Ext.kt', 'demo/ExtArgs.kt']) {
    const edges = importsFrom(facts, file);
    assert.equal(edges.some(imp => imp.to === 'demo/Payload.kt'), true, `${file} must link Payload`);
    assert.equal(edges.some(imp => imp.to === 'demo/Result.kt'), true, `${file} must link Result`);
  }
});

test('kotlin review: generic type-use annotation keeps its type argument references', t => {
  // @Mark<Payload>() String — the type arguments of the annotation itself are
  // real references; only the value argument list is expressions.
  const root = fixture(t, {
    'demo/Mark.kt': 'package demo\n@Target(AnnotationTarget.TYPE)\nannotation class Mark<T>\n',
    'demo/Payload.kt': 'package demo\nclass Payload\n',
    'demo/Ext.kt': 'package demo\nfun register(block: (@Mark<Payload>() String) -> Unit) = Unit\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  const edges = importsFrom(facts, 'demo/Ext.kt');
  assert.equal(edges.some(imp => imp.to === 'demo/Mark.kt'), true);
  assert.equal(edges.some(imp => imp.to === 'demo/Payload.kt'), true);
});

test('kotlin review: overloads sharing a type-use annotation keep stable finding ids', t => {
  // route(x: @Mark String) and route(x: @Mark Int) share the annotation as
  // their first reference. The annotation is not the parameter type: removing
  // the first overload must not renumber the surviving finding.
  const overload = (type) => `  fun route(x: @Mark ${type}) {\n    if (x is Any) { println(x) }\n  }\n`;
  const lowThreshold = () => {
    const c = config();
    c.rules = { ...c.rules, complexity: { function: { info: { complexity: 1, nesting: 99 }, warning: { complexity: 99, nesting: 99 } } } };
    return c;
  };
  const header = 'package demo\nannotation class Mark\nclass Hooks {\n';
  const idsFor = (members) => {
    const root = fixture(t, { 'Demo.kt': `${header}${members}}\n` });
    const cfg = lowThreshold();
    const { facts } = extractFacts(root, { language: 'kotlin', config: cfg });
    return evaluateGraph(buildGraph(facts, cfg), cfg, facts).diagnostics
      .filter(d => d.code === 'complexity/function')
      .map(d => ({ id: d.id, fn: d.subject.function }));
  };
  const both = idsFor(overload('String') + overload('Int'));
  const survivorOnly = idsFor(overload('Int'));
  const survivorInBoth = both.find(d => d.fn.includes('Int'));
  assert.equal(both.length, 2);
  assert.notEqual(both[0].fn, both[1].fn);
  assert.equal(survivorOnly.length, 1);
  assert.equal(survivorOnly[0].id, survivorInBoth.id);
});

test('kotlin review: annotated callback overloads do not collide with plain-type overloads', t => {
  // route(x: @Mark() (String) -> Unit) and route(x: String): once the
  // annotation is skipped, the callback's first parameter reference is String
  // — but the parameter type is the function type, not String. Ordinary
  // function types carry a normalized signature excluding type-use
  // annotations, so the two overloads measure distinctly and the survivor
  // keeps its finding id when the other is deleted.
  const overloadFn = (type) => `  fun route(x: ${type}) {\n    if (x is Any) { println(x) }\n  }\n`;
  const lowThreshold = () => {
    const c = config();
    c.rules = { ...c.rules, complexity: { function: { info: { complexity: 1, nesting: 99 }, warning: { complexity: 99, nesting: 99 } } } };
    return c;
  };
  const header = 'package demo\nannotation class Mark\nclass Hooks {\n';
  const idsFor = (members) => {
    const root = fixture(t, { 'Demo.kt': `${header}${members}}\n` });
    const cfg = lowThreshold();
    const { facts } = extractFacts(root, { language: 'kotlin', config: cfg });
    return evaluateGraph(buildGraph(facts, cfg), cfg, facts).diagnostics
      .filter(d => d.code === 'complexity/function')
      .map(d => ({ id: d.id, fn: d.subject.function }));
  };
  const both = idsFor(overloadFn('@Mark() (String) -> Unit') + overloadFn('String'));
  const survivorOnly = idsFor(overloadFn('String'));
  const survivorInBoth = both.find(d => d.fn === 'Hooks.route(String)');
  assert.equal(both.length, 2);
  assert.notEqual(both[0].fn, both[1].fn);
  assert.equal(survivorOnly.length, 1);
  assert.equal(survivorOnly[0].id, survivorInBoth?.id);
});

test('kotlin review: callback formatting edits preserve finding identity', t => {
  // (String) -> Unit, (String,) -> Unit and (x: String) -> Unit are the same
  // type: trailing separators and parameter labels are not part of it. The
  // normalized signature is structural, so spelling-only edits keep the
  // finding id instead of reporting one finding gone and one new.
  const fn = (type) => `  fun route(x: ${type}) {\n    if (x is Any) { println(x) }\n  }\n`;
  const lowThreshold = () => {
    const c = config();
    c.rules = { ...c.rules, complexity: { function: { info: { complexity: 1, nesting: 99 }, warning: { complexity: 99, nesting: 99 } } } };
    return c;
  };
  const idsFor = (members) => {
    const root = fixture(t, { 'Demo.kt': `package demo\nclass Hooks {\n${members}}\n` });
    const cfg = lowThreshold();
    const { facts } = extractFacts(root, { language: 'kotlin', config: cfg });
    return evaluateGraph(buildGraph(facts, cfg), cfg, facts).diagnostics
      .filter(d => d.code === 'complexity/function')
      .map(d => ({ id: d.id, fn: d.subject.function }));
  };
  const before = idsFor(fn('(String) -> Unit'));
  const trailingComma = idsFor(fn('(String,) -> Unit'));
  const renamedLabel = idsFor(fn('(x: String) -> Unit'));
  assert.equal(before.length, 1);
  assert.equal(trailingComma[0]?.id, before[0]?.id);
  assert.equal(renamedLabel[0]?.id, before[0]?.id);
});

test('kotlin review: nullable parenthesized results keep finding identity equivalence', t => {
  // () -> (String)? and () -> String? spell the same type: the finding id
  // must not change when the parameter type is rewritten across the forms.
  const fn = (type) => `  fun route(block: ${type}) {\n    if (block is Any) { println(block) }\n  }\n`;
  const lowThreshold = () => {
    const c = config();
    c.rules = { ...c.rules, complexity: { function: { info: { complexity: 1, nesting: 99 }, warning: { complexity: 99, nesting: 99 } } } };
    return c;
  };
  const idsFor = (members) => {
    const root = fixture(t, { 'Demo.kt': `package demo\nclass Hooks {\n${members}}\n` });
    const cfg = lowThreshold();
    const { facts } = extractFacts(root, { language: 'kotlin', config: cfg });
    return evaluateGraph(buildGraph(facts, cfg), cfg, facts).diagnostics
      .filter(d => d.code === 'complexity/function')
      .map(d => ({ id: d.id, fn: d.subject.function }));
  };
  const parenthesized = idsFor(fn('() -> (String)?'));
  const direct = idsFor(fn('() -> String?'));
  assert.equal(parenthesized.length, 1);
  assert.equal(direct[0]?.id, parenthesized[0]?.id);
});

test('kotlin review: nullable function overloads stay distinct and the survivor keeps its id', t => {
  // () -> (() -> Unit)? is a nullable function; () -> () -> Unit is a function
  // with a non-null function result. They are different types and must measure
  // as different overloads — removing either must not renumber the other.
  const overload = (type) => `  fun route(block: ${type}) {\n    if (block is Any) { println(block) }\n  }\n`;
  const lowThreshold = () => {
    const c = config();
    c.rules = { ...c.rules, complexity: { function: { info: { complexity: 1, nesting: 99 }, warning: { complexity: 99, nesting: 99 } } } };
    return c;
  };
  const idsFor = (members) => {
    const root = fixture(t, { 'Demo.kt': `package demo\nclass Hooks {\n${members}}\n` });
    const cfg = lowThreshold();
    const { facts } = extractFacts(root, { language: 'kotlin', config: cfg });
    return evaluateGraph(buildGraph(facts, cfg), cfg, facts).diagnostics
      .filter(d => d.code === 'complexity/function')
      .map(d => ({ id: d.id, fn: d.subject.function }));
  };
  const nullableFn = '() -> (() -> Unit)?';
  const plainFn = '() -> () -> Unit';
  const both = idsFor(overload(nullableFn) + overload(plainFn));
  assert.equal(both.length, 2);
  assert.notEqual(both[0].fn, both[1].fn);
  const survivorOnly = idsFor(overload(plainFn));
  const survivorInBoth = both.find(d => d.fn === survivorOnly[0]?.fn);
  assert.equal(survivorOnly.length, 1);
  assert.equal(survivorOnly[0].id, survivorInBoth?.id);
});

test('kotlin review: inner classifiers through generic outers are one parameter', t => {
  // (Outer<String>.Inner) -> Unit is one parameter of a function type; the dot
  // after type arguments continues the classifier. It must not split into two
  // parameters and collide with the genuinely two-parameter (Outer<String>,
  // Inner) -> Unit overload.
  const overload = (type) => `  fun route(block: ${type}) {\n    if (block is Any) { println(block) }\n  }\n`;
  const lowThreshold = () => {
    const c = config();
    c.rules = { ...c.rules, complexity: { function: { info: { complexity: 1, nesting: 99 }, warning: { complexity: 99, nesting: 99 } } } };
    return c;
  };
  const idsFor = (members) => {
    const root = fixture(t, { 'Demo.kt': `package demo\nclass Outer<T> {\n  inner class Inner\n}\nclass Hooks {\n${members}}\n` });
    const cfg = lowThreshold();
    const { facts } = extractFacts(root, { language: 'kotlin', config: cfg });
    return evaluateGraph(buildGraph(facts, cfg), cfg, facts).diagnostics
      .filter(d => d.code === 'complexity/function')
      .map(d => ({ id: d.id, fn: d.subject.function }));
  };
  const both = idsFor(overload('(Outer<String>.Inner) -> Unit') + overload('(Outer<String>, Inner) -> Unit'));
  assert.equal(both.length, 2);
  assert.notEqual(both[0].fn, both[1].fn);
});
