import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseSources, descendants } from '../extract/java/parse.mjs';
import { loadConfig, extractFacts, buildGraph, evaluateGraph, stableJson } from '../lib/analysis.mjs';
import { resolveImports } from '../extract/java/imports.mjs';
import { buildTask, renderTaskMarkdown } from '../lib/task.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';
import { spawnSync } from 'node:child_process';
import { MODULE_ROOT, ARCHIFY_PACKAGE } from './helpers.mjs';
import { buildOverlay } from '../overlay/inject.mjs';

const config = () => ({ ...loadConfig(), include: ['**/*.java'] });
function fixture(t, sources) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-java-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(sources)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

test('java: captured sources retain exact text, line positions, roles and exclusions', t => {
  const text = '// 😀\r\npackage demo;\r\nclass A {\r\n  void run() {}\r\n}\r\n';
  const root = fixture(t, { 'src/main/java/demo/A.java': text, 'src/test/java/demo/ATest.java': 'class ATest {}', 'build/Hidden.java': 'bad', 'readme.txt': 'ignored' });
  const parsed = parseSources(root, config());
  assert.deepEqual(parsed.files.map(({ path, loc, role }) => ({ path, loc, role })), [
    { path: 'src/main/java/demo/A.java', loc: 5, role: 'source' },
    { path: 'src/test/java/demo/ATest.java', loc: 1, role: 'test' },
  ]);
  assert.equal(parsed.files[0].sourceText, text);
  const method = [...descendants(parsed.units[0].cst)].find(n => n.name === 'methodDeclaration');
  assert.equal(method.location.startLine, 4);
  assert.equal(text.slice(method.location.startOffset, method.location.endOffset + 1), 'void run() {}');
});

test('java: records, compact constructors, sealed types and switch patterns are parsed', t => {
  const root = fixture(t, { 'Modern.java': `sealed interface Shape permits Point {}
record Point(int x) implements Shape { Point { if (x < 0) throw new IllegalArgumentException(); } }
class Modern { int size(Object o) { return switch (o) { case String s when !s.isEmpty() -> 1; case null -> 0; default -> -1; }; } }` });
  const parsed = parseSources(root, config());
  assert.deepEqual(parsed.parse_errors, []);
  const names = [...descendants(parsed.units[0].cst)].map(n => n.name);
  assert.ok(names.includes('compactConstructorDeclaration'));
  assert.ok(names.includes('switchRule'));
});

test('java: empty member records are types, not methods, through dependencies and boundaries', t => {
  const root = fixture(t, {
    'p/Outer.java': 'package p;\npublic class Outer { public record Value(int x) {} @Deprecated record Many(String... names) { ; } }',
    'p/Shapes.java': 'package p;\npublic interface Shapes { record Point() {} }',
    'p/Legacy.java': 'package p;\nclass record {}\nabstract class Legacy { record make() { return null; } abstract record later(); }',
    'q/Use.java': 'package q;\nimport p.Outer.Value;\npublic class Use { Value v; p.Outer.Many m; p.Shapes.Point point; }',
  });
  const cfg = { ...config(), boundaries: { layers: { api: ['q/**'], core: ['p/**'] }, rules: [{ from: 'api', disallow: ['core'] }] } };
  const { facts } = extractFacts(root, { language: 'java', config: cfg });
  assert.equal(facts.parse_errors, undefined);
  assert.deepEqual(facts.functions.map(f => f.qualname), ['Legacy.make()'], 'misparsed records emit no function records');
  const use = facts.imports.filter(i => i.from === 'q/Use.java');
  for (const specifier of ['p.Outer.Value', 'Value', 'p.Outer.Many', 'p.Shapes.Point']) {
    assert.equal(use.find(i => i.specifier === specifier)?.to, specifier === 'p.Shapes.Point' ? 'p/Shapes.java' : 'p/Outer.java', specifier);
  }
  assert.ok(!facts.imports.some(i => i.from === 'p/Outer.java' && i.specifier === 'record'), 'the record keyword is not a type reference');
  const findings = evaluateGraph(buildGraph(facts, cfg), cfg, facts);
  assert.deepEqual(findings.diagnostics.filter(d => d.code === 'architecture/boundary').map(d => d.subject.boundary), [{ from: 'api', to: 'core' }]);
});

test('java: instance creation, constructor references and class literals are type references', t => {
  const root = fixture(t, {
    'p/A.java': 'package p;\nclass A { Object make() { return new B(); } }',
    'p/B.java': 'package p;\nclass B { Object make() { return new A(); } }',
    'p/Foo.java': 'package p;\npublic class Foo { static void bar() {} }',
    'p/Inner.java': 'package p;\npublic class Inner {}',
    'p/Outer.java': 'package p;\npublic class Outer { public class Inner {} }',
    'q/Use.java': `package q;
class Use {
  Object created = new p.Foo();
  java.util.function.Supplier<Object> constructor = p.Foo::new;
  java.util.function.IntFunction<Object> array = p.Foo[]::new;
  Object literal = p.Foo.class;
}`,
    'p/Guards.java': `package p;
class Guards {
  Outer outer;
  Object qualified = outer.new Inner();
  Runnable method = Foo::bar;
}`,
  });
  const { facts, config: cfg } = extractFacts(root, { language: 'java' });
  const use = facts.imports.filter(i => i.from === 'q/Use.java' && i.specifier === 'p.Foo');
  assert.deepEqual(use.map(i => [i.line, i.to]), [[3, 'p/Foo.java'], [4, 'p/Foo.java'], [5, 'p/Foo.java'], [6, 'p/Foo.java']]);
  const guards = facts.imports.filter(i => i.from === 'p/Guards.java');
  assert.ok(!guards.some(i => i.to === 'p/Inner.java'), 'a qualified creation is relative to its outer instance');
  assert.ok(!guards.some(i => i.to === 'p/Foo.java'), 'a method reference may start with an expression');
  const cycle = evaluateGraph(buildGraph(facts, cfg), cfg, facts).diagnostics.find(d => d.code === 'coupling/import-cycle');
  assert.deepEqual(cycle?.subject.files, ['p/A.java', 'p/B.java'], 'a cycle formed only by instance creation is reported');
});

test('java: duplicate enclosing declarations keep member types ambiguous on every lookup path', t => {
  // Each source set compiles on its own: one declares Inner, the other inherits it.
  const root = fixture(t, {
    'main/p/Outer.java': 'package p;\npublic class Outer { public static class Inner { public static int TOKEN; } }',
    'alt/p/Outer.java': 'package p;\npublic class Outer extends Base {}',
    'alt/p/Base.java': 'package p;\npublic class Base { public static class Inner { public static int TOKEN; } }',
    'q/Imported.java': 'package q;\nimport p.Outer.Inner;\nclass Imported { Inner inner; }',
    'q/Qualified.java': 'package q;\nclass Qualified { p.Outer.Inner inner; }',
    'q/Deep.java': 'package q;\nimport static p.Outer.Inner.TOKEN;\nclass Deep {}',
    'p/Peer.java': 'package p;\nclass Peer { Outer.Inner inner; }',
    'p/Unique.java': 'package p;\npublic class Unique { public static class Member { public static int TOKEN; } }',
    'q/Control.java': 'package q;\nimport static p.Unique.Member.TOKEN;\nclass Control { p.Unique.Member member; }',
  });
  const { imports } = resolveImports(parseSources(root, config()).units);
  for (const [from, specifier] of [['q/Imported.java', 'p.Outer.Inner'], ['q/Imported.java', 'Inner'], ['q/Qualified.java', 'p.Outer.Inner'],
    ['q/Deep.java', 'p.Outer.Inner.TOKEN'], ['p/Peer.java', 'Outer.Inner']]) {
    const edge = imports.find(i => i.from === from && i.specifier === specifier);
    assert.equal(edge?.resolved, false, `${from} ${specifier}`);
  }
  const control = imports.filter(i => i.from === 'q/Control.java');
  assert.deepEqual(control.map(i => [i.specifier, i.to]), [['p.Unique.Member.TOKEN', 'p/Unique.java'], ['p.Unique.Member', 'p/Unique.java']]);
});

test('java: classes local to interface methods and initializer blocks are not member types', t => {
  const root = fixture(t, {
    'p/Helper.java': 'package p;\npublic class Helper {}',
    'p/I.java': `package p;
public interface I {
  default void a() { class Helper {} }
  static void b() { class Tool {} }
  int X = switch (0) { default -> { class Gadget {} yield 1; } };
  class Nested { Helper helper; }
}`,
    'q/Other.java': 'package q;\nclass Other { p.I.Helper helper; p.I.Tool tool; p.I.Gadget gadget; }',
  });
  const { imports } = resolveImports(parseSources(root, config()).units);
  // A local name shadows conservatively: it is no dependency and never an edge.
  assert.ok(!imports.some(i => i.from === 'p/I.java' && i.line === 6 && i.specifier === 'Helper' && i.resolved));
  for (const name of ['Helper', 'Tool', 'Gadget']) {
    assert.equal(imports.find(i => i.from === 'q/Other.java' && i.specifier === `p.I.${name}`)?.resolved, false, `local ${name} has no canonical member name`);
  }
});

test('java: explicitly and implicitly static member types can be statically imported', t => {
  const root = fixture(t, {
    'p/Outer.java': `package p;
public class Outer {
  public static class Nested {}
  public class Inner {}
  public enum Mode { A }
  public record Point(int x) {}
  public interface Callback {}
  public @interface Marker {}
}`,
    'p/Api.java': 'package p;\npublic interface Api { class Config {} }',
    'q/Use.java': `package q;
import static p.Outer.Nested;
import static p.Outer.Inner;
import static p.Outer.Mode;
import static p.Outer.Point;
import static p.Outer.Callback;
import static p.Outer.Marker;
import static p.Api.Config;
class Use {}`,
  });
  const { imports } = resolveImports(parseSources(root, config()).units);
  const status = Object.fromEntries(imports.filter(i => i.from === 'q/Use.java').map(i => [i.specifier.split('.').at(-1), i.to ?? null]));
  assert.deepEqual(status, { Nested: 'p/Outer.java', Inner: null, Mode: 'p/Outer.java', Point: 'p/Outer.java', Callback: 'p/Outer.java', Marker: 'p/Outer.java', Config: 'p/Api.java' });
});

test('java: build-output defaults exclude Java sources only, keeping existing JS/TS scans and overrides', t => {
  const root = fixture(t, {
    'entry.mjs': "import { dep } from './target/dep.mjs';\nexport const entry = () => dep;\n",
    'target/dep.mjs': "import { entry } from '../entry.mjs';\nexport const dep = () => entry;\n",
    'target/classes/Generated.java': 'class Generated {}',
  });
  const ts = extractFacts(root, { language: 'ts' });
  assert.deepEqual(ts.facts.files.map(f => f.path), ['entry.mjs', 'target/dep.mjs']);
  const cycle = evaluateGraph(buildGraph(ts.facts, ts.config), ts.config, ts.facts).diagnostics.find(d => d.code === 'coupling/import-cycle');
  assert.deepEqual(cycle?.subject.files, ['entry.mjs', 'target/dep.mjs']);
  assert.deepEqual(extractFacts(root, { language: 'java' }).facts.files, []);
  const custom = path.join(root, 'analysis.json');
  fs.writeFileSync(custom, JSON.stringify({ exclude: [] }));
  assert.deepEqual(extractFacts(root, { language: 'java', config: custom }).facts.files.map(f => f.path), ['target/classes/Generated.java']);
});

test('java: unresolved counters follow the shared contract: external outside the sources, unknown for internal gaps', t => {
  const clean = fixture(t, {
    'p/A.java': 'package p;\nimport java.util.List;\nimport org.example.Lib;\npublic class A<T> { String s; List<String> l; Lib lib; T t; B b; java.util.Map<String, String> m; }',
    'p/B.java': 'package p;\npublic class B {}',
  });
  const complete = resolveImports(parseSources(clean, config()).units);
  assert.deepEqual(complete.unresolved, { external: 2, outside: 0, unknown: 0, opaque: 0 }, 'a fully resolved tree has no unknown');
  assert.deepEqual(complete.imports.filter(i => !i.resolved).map(i => i.specifier).sort(), ['java.util.List', 'org.example.Lib'], 'only the imports represent external dependencies');
  assert.deepEqual(complete.imports.filter(i => i.resolved).map(i => [i.specifier, i.to]), [['B', 'p/B.java']]);
  const gaps = fixture(t, {
    'p/A.java': 'package p;\nimport p.gen.Generated;\npublic class A { Dup dup; }',
    'main/p/Dup.java': 'package p;\nclass Dup {}',
    'test/p/Dup.java': 'package p;\nclass Dup {}',
  });
  const missing = resolveImports(parseSources(gaps, config()).units);
  assert.deepEqual(missing.unresolved, { external: 0, outside: 0, unknown: 2, opaque: 0 }, 'a missing analyzed type and an ambiguous one are internal gaps');
});

test('java: broken syntax and unsupported input stay visible without partial facts', t => {
  const root = fixture(t, { 'Broken.java': 'class Broken { void run( {', 'Escaped.java': 'class Escaped { \\u0076oid run() {} }', 'Invalid.java': Buffer.from([0xff]), 'Valid.java': '\ufeffclass Valid {}' });
  const parsed = parseSources(root, config());
  assert.equal(parsed.files.length, 4);
  assert.deepEqual(parsed.units.map(u => u.file), ['Valid.java']);
  assert.deepEqual(parsed.parse_errors.map(e => e.path), ['Broken.java', 'Escaped.java', 'Invalid.java']);
  assert.match(parsed.parse_errors[0].message, /line: 1, column:/);
  assert.equal(parsed.files.find(f => f.path === 'Valid.java').sourceText, 'class Valid {}');
});

test('java: explicit, static, nested, same-package and qualified type references resolve to declarations', t => {
  const root = fixture(t, {
    'odd/location/Types.java': 'package demo; public class Types { public static int VALUE; public static void work() {} public static class Nested {} }',
    'other/Peer.java': 'package demo; class Peer {}',
    'Use.java': `package demo;
import demo.Types;
import demo.Types.Nested;
import static demo.Types.VALUE;
import static demo.Types.work;
class Use { Peer peer; demo.Types qualified; Nested nested; }`,
  });
  const result = resolveImports(parseSources(root, config()).units);
  const edges = result.imports.filter(e => e.from === 'Use.java');
  for (const name of ['demo.Types', 'demo.Types.Nested', 'demo.Types.VALUE', 'demo.Types.work', 'Peer', 'Nested']) {
    const found = edges.find(e => e.specifier === name);
    assert.equal(found?.resolved, true, name);
    assert.equal(found.to, name === 'Peer' ? 'other/Peer.java' : 'odd/location/Types.java');
  }
});

test('java: duplicate types, unknown static members, wildcard and shadowed names never create guessed edges', t => {
  const root = fixture(t, {
    'main/Target.java': 'package demo; class Target {}',
    'test/Target.java': 'package demo; class Target {}',
    'main/Constants.java': 'package demo; class Constants { static int VALUE; }',
    'test/Constants.java': 'package demo; class Constants {}',
    'Types.java': 'package demo; class Types { static int KNOWN; }',
    'T.java': 'package demo; class T {}',
    'Use.java': `package demo;
import demo.Target;
import demo.*;
import static demo.Types.MISSING;
import static demo.Constants.VALUE;
class Use<T> { T t; Target target; Missing absent; }`,
    'Inherited.java': 'package demo; class Inherited extends UnknownBase { Types mayBeInherited; }',
  });
  const { imports, unresolved } = resolveImports(parseSources(root, config()).units);
  assert.ok(imports.length > 0);
  assert.ok(imports.every(e => !e.resolved));
  assert.equal(Object.values(unresolved).reduce((a,b) => a+b), imports.length);
  assert.ok(imports.some(e => e.specifier === 'demo.*'));
  assert.equal(imports.find(e => e.specifier === 'demo.Constants.VALUE').resolved, false);
});

test('java: wildcard declarations do not manufacture dependencies on unused package members', t => {
  const root = fixture(t, { 'A.java': 'package lib; class A {}', 'B.java': 'package lib; class B {}', 'Use.java': 'import lib.*; class Use {}' });
  const { imports } = resolveImports(parseSources(root, config()).units);
  assert.deepEqual(imports, [{ from: 'Use.java', specifier: 'lib.*', kind: 'static', line: 1, resolved: false }]);
});

test('java: anonymous initializer members are not static members of their enclosing field owner', t => {
  const root = fixture(t, { 'A.java': 'package demo; class A { static Object value = new Object() { int MISSING; }; }', 'Use.java': 'import static demo.A.MISSING; class Use {}' });
  const { imports } = resolveImports(parseSources(root, config()).units);
  assert.equal(imports.find(e => e.specifier === 'demo.A.MISSING').resolved, false);
});

test('java: the public pipeline preserves deterministic facts, structural cycles and Java task semantics', t => {
  const root = fixture(t, {
    'a/A.java': 'package a; import b.B; class A { B b; void work(boolean x) { if (x) {} } }',
    'b/B.java': 'package b; import a.A; class B { A a; }',
    'target/Generated.java': 'this must not parse',
  });
  const first = extractFacts(root);
  assert.equal(first.adapter, 'java');
  const { facts, config } = first;
  assert.equal(stableJson(facts), stableJson(extractFacts(root).facts));
  assert.equal(facts.files.length, 2);
  const graph = buildGraph(facts, config);
  assert.ok(graph.edges.every(e => e.kinds.eager === 0));
  const findings = evaluateGraph(graph, config, facts);
  const cycle = findings.diagnostics.find(f => f.code === 'coupling/import-cycle');
  assert.equal(cycle.severity, 'info');
  assert.equal(cycle.evidence.kind, 'structural');
  assert.doesNotMatch(JSON.stringify(cycle), /partial-initialization|function-scope import|from module import/);
  const task = buildTask({ findings, facts, ids: [cycle.id] });
  assert.deepEqual(schemaErrors('ai-task', task), []);
  assert.doesNotMatch(JSON.stringify(task), /at import time|partially initialized|module-level side effects/);
  assert.match(task.impact[0].statement, /structurally/);
  assert.match(renderTaskMarkdown(task), /^```java$/m, 'Java excerpts are fenced as Java');
  assert.equal(facts.functions[0].complexity, 2);
  const ir = { components: [{ id: 'app', label: 'App', sources: [{ path: 'a/A.java' }] }], connections: [] };
  const view = buildOverlay({ graph, facts, findings: findings.diagnostics, ir, html: '<html><body><div class="toolbar"></div><svg><g data-node-id="app"></g></svg></body></html>' });
  const payload = JSON.parse(view.html.match(/<script type="application\/json" id="bauify-analysis">([\s\S]*?)<\/script>/)[1]);
  const indicator = payload.components[0].indicators.items.find(i => i.key === 'cycle');
  assert.match(indicator.value, /structural Java dependency cycle/);
  assert.doesNotMatch(indicator.value, /deferred|conditional/);
});

test('java: CLI check writes every stage and mixed-language selection reports omitted files', t => {
  const root = fixture(t, { 'A.java': 'class A {}', 'other.py': 'pass' });
  const automatic = extractFacts(root);
  assert.equal(automatic.adapter, 'py', 'Java sources beside another language keep that language');
  assert.deepEqual(automatic.otherLanguages, [{ adapter: 'java', files: 1 }]);
  const tsRoot = fixture(t, { 'src/a.js': 'export const a = 1;', 'android/Main.java': 'class Main {}' });
  assert.equal(extractFacts(tsRoot).adapter, 'ts');
  const mixed = fixture(t, { 'A.java': 'class A {}', 'a.js': 'export const a = 1;', 'b.py': 'pass' });
  assert.throws(() => extractFacts(mixed), e => e.diagnostics?.[0]?.code === 'extract/adapter-ambiguous'
    && e.diagnostics[0].evidence.detected.join() === 'ts,py');
  const spring = fixture(t, { 'pom.xml': '<project/>', 'src/main/java/A.java': 'class A {}', 'src/main/resources/static/app.js': 'export {};' });
  assert.throws(() => extractFacts(spring), e => e.diagnostics?.[0]?.code === 'extract/adapter-ambiguous'
    && e.diagnostics[0].evidence.detected.join() === 'ts,java', 'a root build file marks a Java project');
  const gradle = fixture(t, { 'settings.gradle.kts': '', 'core/build.gradle.kts': '', 'core/src/main/java/c/C.java': 'package c; class C {}', 'scripts/release.py': 'pass' });
  assert.throws(() => extractFacts(gradle), e => e.diagnostics?.[0]?.code === 'extract/adapter-ambiguous', 'a Gradle settings file marks one too');
  const selected = extractFacts(root, { language: 'java' });
  assert.deepEqual(selected.otherLanguages, [{ adapter: 'py', files: 1 }]);
  const out = path.join(root, 'out');
  const result = spawnSync(process.execPath, [path.join(ARCHIFY_PACKAGE, 'bin/archify.mjs'), 'code-analysis', 'check', root, '--language', 'java', '--out', out, '--json'], { encoding: 'utf8', cwd: MODULE_ROOT, timeout: 20000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const stage of ['raw-facts', 'module-graph', 'findings', 'review', 'overview']) assert.ok(fs.existsSync(path.join(out, `${stage}.json`)), stage);
  assert.equal(JSON.parse(fs.readFileSync(path.join(out, 'raw-facts.json'))).repository.language, 'java');
  const text = spawnSync(process.execPath, [path.join(ARCHIFY_PACKAGE, 'bin/archify.mjs'), 'code-analysis', 'check', root, '--language', 'java'], { encoding: 'utf8', cwd: MODULE_ROOT, timeout: 20000 });
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.match(text.stdout, /^ {2}Java · 1 files · rules:/m);
});

test('java: Unicode escapes in comments are rejected rather than hiding pre-lexing Java code', t => {
  const root = fixture(t, { 'Use.java': '// \\u000aimport demo.Target;\nclass Use {}' });
  const { facts } = extractFacts(root, { language: 'java' });
  assert.match(facts.parse_errors[0].message, /Unicode escape preprocessing/);
  assert.deepEqual(facts.imports, []);
  assert.deepEqual(facts.functions, []);
});

test('java: conflicting single imports stay ambiguous, and declared interface static members resolve', t => {
  const root = fixture(t, {
    'Target.java': 'package demo; class Target {}',
    'Constants.java': 'package demo; interface Constants { int VALUE = 1; static void work() {} }',
    'Nested.java': 'package demo; class Nested {}',
    'Types.java': 'package lib; class Types { public static class Nested {} }',
    'Shadowed.java': 'package demo; import static lib.Types.Nested; class Shadowed { Nested value; }',
    'Use.java': 'import demo.Target; import unknown.Target; import static demo.Constants.VALUE; import static demo.Constants.work; class Use { Target value; }',
  });
  const { facts } = extractFacts(root, { language: 'java' });
  assert.equal(facts.imports.find(i => i.specifier === 'Target').resolved, false);
  for (const name of ['VALUE', 'work']) assert.equal(facts.imports.find(i => i.specifier === `demo.Constants.${name}`).to, 'Constants.java');
  assert.equal(facts.imports.find(i => i.from === 'Shadowed.java' && i.specifier === 'Nested').resolved, false);
});

test('java: local and anonymous scopes do not turn inherited names into package dependencies', t => {
  const root = fixture(t, {
    'Target.java': 'package demo; class Target {}',
    'Base.java': 'package demo; class Base { static class Target {} }',
    'Use.java': 'package demo; class Use { Object value = new Base() { Target field; class Inner {} }; void run() { class Local extends Base { Target field; } } }',
    'Other.java': 'import demo.Use.Inner; class Other {}',
  });
  const { facts } = extractFacts(root, { language: 'java' });
  const references = facts.imports.filter(i => i.from === 'Use.java' && i.specifier === 'Target');
  assert.ok(references.length > 0);
  assert.ok(references.every(i => !i.resolved));
  assert.equal(facts.imports.find(i => i.specifier === 'demo.Use.Inner').resolved, false);
});

test('java: a lexical member type prefix blocks unrelated package and import fallbacks', t => {
  const root = fixture(t, {
    'Base.java': 'package app; class Base { static class Target {} }',
    'UsePackage.java': 'package app; class UsePackage { static class pkg extends Base {} pkg.Target field; }',
    'UseImport.java': 'package app; import other.Prefix; class UseImport { static class Prefix extends Base {} Prefix.Target field; }',
    'pkg/Target.java': 'package pkg; public class Target {}',
    'other/Prefix.java': 'package other; public class Prefix { public static class Target {} }',
    'Direct.java': 'package app; class Direct { static class Prefix { static class Target {} } Prefix.Target field; }',
    'Unshadowed.java': 'package app; class Unshadowed { pkg.Target field; }',
    'Nearest.java': 'package app; class Nearest { static class Prefix { static class Target {} } static class Inner { static class Prefix extends Base {} Prefix.Target field; } }',
  });
  const { imports } = resolveImports(parseSources(root, config()).units);
  for (const [from, specifier] of [['UsePackage.java', 'pkg.Target'], ['UseImport.java', 'Prefix.Target'], ['Nearest.java', 'Prefix.Target']]) {
    assert.equal(imports.find(i => i.from === from && i.specifier === specifier)?.resolved, false, from);
  }
  assert.equal(imports.find(i => i.from === 'UseImport.java' && i.specifier === 'other.Prefix')?.to, 'other/Prefix.java');
  assert.equal(imports.find(i => i.from === 'Unshadowed.java' && i.specifier === 'pkg.Target')?.to, 'pkg/Target.java');
  assert.ok(!imports.some(i => i.from === 'Direct.java' && i.specifier === 'Prefix.Target'), 'same-file member references do not add file dependencies');
});

test('java: initializer-local classes are not indexed as externally accessible member types', t => {
  const root = fixture(t, {
    'Base.java': 'package demo; class Base { static class Local {} }',
    'Instance.java': 'package demo; class Instance extends Base { { class Local { static int VALUE; static class Nested {} } } }',
    'Static.java': 'package demo; class Static extends Base { static { class Local { static int VALUE; static class Nested {} } } }',
    'Member.java': 'package demo; class Member { static class Local { static int VALUE; } }',
    'Other.java': `package demo;
import demo.Instance.Local;
import demo.Static.Local.Nested;
import static demo.Instance.Local.VALUE;
import static demo.Static.Local.VALUE;
class Other { Instance.Local one; Static.Local two; }`,
    'Valid.java': 'import demo.Member.Local; import static demo.Member.Local.VALUE; class Valid {}',
  });
  const { imports } = resolveImports(parseSources(root, config()).units);
  const other = imports.filter(i => i.from === 'Other.java');
  assert.equal(other.length, 6);
  assert.ok(other.every(i => !i.resolved), 'initializer-local types and their members cannot be named from another file');
  const valid = imports.filter(i => i.from === 'Valid.java');
  assert.equal(valid.length, 2);
  assert.ok(valid.every(i => i.resolved && i.to === 'Member.java'), 'genuine member classes remain accessible');
});

test('java: ordinary declaration headers resolve proven types, and analyzed supertypes open class bodies', t => {
  const root = fixture(t, {
    'Base.java': 'package demo; public class Base {}',
    'Api.java': 'package demo; public interface Api {}',
    'Bound.java': 'package demo; interface Bound {}',
    'SamePackage.java': 'package demo;\nclass SamePackage extends Base implements Api {\n  Base field; Api other;\n}',
    'Imported.java': 'import demo.Base;\nimport demo.Api;\nclass Imported extends Base implements Api {\n  Base field;\n}',
    'Qualified.java': 'class Qualified extends demo.Base implements demo.Api {\n  demo.Base field;\n}',
    'Subinterface.java': 'package demo;\ninterface Subinterface extends Api {\n  Api next();\n}',
    'Bounded.java': 'package demo;\nclass Bounded<T extends Bound> extends Base {}',
    'OwnMember.java': 'package demo;\nclass OwnMember extends Base { static class Base {} }',
    'OwnInterface.java': 'package demo;\ninterface OwnInterface extends Api { class Api {} }',
  });
  const { imports } = resolveImports(parseSources(root, config()).units);
  for (const [from, line, specifier, to] of [
    ['SamePackage.java', 2, 'Base', 'Base.java'], ['SamePackage.java', 2, 'Api', 'Api.java'],
    ['Imported.java', 3, 'Base', 'Base.java'], ['Imported.java', 3, 'Api', 'Api.java'],
    ['Qualified.java', 1, 'demo.Base', 'Base.java'], ['Qualified.java', 1, 'demo.Api', 'Api.java'],
    ['Subinterface.java', 2, 'Api', 'Api.java'], ['Bounded.java', 2, 'Bound', 'Bound.java'],
    ['Bounded.java', 2, 'Base', 'Base.java'], ['OwnMember.java', 2, 'Base', 'Base.java'],
    ['OwnInterface.java', 2, 'Api', 'Api.java'],
  ]) {
    assert.equal(imports.find(i => i.from === from && i.line === line && i.specifier === specifier)?.to, to, `${from}:${line} ${specifier}`);
  }
  // Analyzed supertypes without member types cannot shadow these body names.
  for (const [from, line, specifier, to] of [
    ['SamePackage.java', 3, 'Base', 'Base.java'], ['SamePackage.java', 3, 'Api', 'Api.java'], ['Imported.java', 4, 'Base', 'Base.java'],
    ['Qualified.java', 2, 'demo.Base', 'Base.java'], ['Subinterface.java', 3, 'Api', 'Api.java'],
  ]) {
    assert.equal(imports.find(i => i.from === from && i.line === line && i.specifier === specifier)?.to, to, `${from}:${line} ${specifier}`);
  }
});

test('java: inherited member types bind body names; unknown supertype chains keep the body guard', t => {
  // Each binding was checked with javac: Base.Helper, Api.Nested and java.lang.Enum.EnumDesc win.
  const root = fixture(t, {
    'p/Base.java': 'package p; public class Base { public static class Helper {} }',
    'p/Api.java': 'package p; public interface Api { class Nested {} }',
    'p/Mid.java': 'package p; public class Mid extends Base implements Api {}',
    'p/Helper.java': 'package p; public class Helper {}',
    'p/Nested.java': 'package p; public class Nested {}',
    'p/EnumDesc.java': 'package p; public class EnumDesc {}',
    'p/Target.java': 'package p; public class Target {}',
    'p/Deep.java': 'package p; class Deep extends Mid { Target target; }',
    'p/Shadowed.java': 'package p; class Shadowed extends Mid { Helper helper; Nested nested; }',
    // The nested header is bound in Outer's body, where Base.Helper is inherited.
    'p/Outer.java': 'package p; class Outer extends Base { static class Inner extends Helper { Target target; } }',
    'p/Color.java': 'package p; enum Color { RED; Object desc = EnumDesc.class; Target target; }',
    'p/External.java': 'package p; class External extends java.util.AbstractMap<String, String> { Target target; }',
    'p/CycleA.java': 'package p; class CycleA extends CycleB { Target target; }',
    'p/CycleB.java': 'package p; class CycleB extends CycleA {}',
    'p/Dup.java': 'package p; class Dup {}',
    'alt/p/Dup.java': 'package p; class Dup {}',
    'p/FromDup.java': 'package p; class FromDup extends Dup { Target target; }',
    // An inherited member shadows external imports, single-type and static (javac: Base.Helper).
    'ext/Helper.java': 'package ext; public class Helper { public static class Inner {} }',
    'p/OverImport.java': 'package p; import ext.Helper; class OverImport extends Mid { Helper helper; }',
    'p/OverStatic.java': 'package p; import static ext.Helper.Inner; class OverStatic extends Base { static class Inner {} Inner own; }',
    // javac: p.Partial$N, declared by an analyzed class whose own supertype is external.
    'p/Partial.java': 'package p; public class Partial extends java.util.AbstractList<String> { public static class N {} }',
    'ext/N.java': 'package ext; public class N {}',
    'p/OverPartial.java': 'package p; import ext.N; class OverPartial extends Partial { N n; }',
  });
  const { imports, unresolved } = resolveImports(parseSources(root, { ...config(), exclude: ['ext/**'] }).units);
  const find = (from, specifier) => imports.find(i => i.from === from && i.specifier === specifier);
  assert.equal(find('p/OverImport.java', 'Helper')?.resolved, false, 'counted, not dropped behind the external import');
  assert.ok(!find('p/OverStatic.java', 'Inner'), 'a declared member shadows a static import and binds in the same file');
  assert.equal(find('p/OverPartial.java', 'N')?.resolved, false, 'a member known from an analyzed ancestor is counted');
  assert.ok(unresolved.unknown >= 2);
  assert.equal(find('p/Deep.java', 'Target')?.to, 'p/Target.java', 'a chain of analyzed supertypes opens the body');
  assert.equal(find('p/Color.java', 'Target')?.to, 'p/Target.java', 'an enum body resolves names java.lang.Enum does not declare');
  for (const [from, specifier] of [['p/Shadowed.java', 'Helper'], ['p/Shadowed.java', 'Nested'], ['p/Outer.java', 'Helper'],
    ['p/Outer.java', 'Target'], ['p/Color.java', 'EnumDesc'], ['p/External.java', 'Target'], ['p/CycleA.java', 'Target'], ['p/FromDup.java', 'Target']]) {
    assert.equal(find(from, specifier)?.resolved, false, `${from} ${specifier}`);
  }
});

test('java: listed JDK supertypes named by a single import or qualified name open class bodies', t => {
  // javac: Owner, Registry, Task, Both and Unknown's `pet` is p.Pet; Registry's `entry` is java.util.Map$Entry;
  // Fault's is p.Error$Pet (an unanalyzed Error shadows java.lang.Error); Inner's is lib.Base$Serializable$Pet.
  const root = fixture(t, {
    'p/BaseEntity.java': 'package p; import java.io.Serializable; public class BaseEntity implements Serializable {}',
    'p/Person.java': 'package p; public class Person extends BaseEntity {}',
    'p/Owner.java': 'package p; public class Owner extends Person { Pet pet; }',
    'p/Pet.java': 'package p; public class Pet {}',
    'p/Entry.java': 'package p; public class Entry {}',
    'p/Task.java': 'package p; abstract class Task implements Runnable, Comparable<Task> { Pet pet; }',
    'p/Registry.java': 'package p; abstract class Registry implements java.util.Map<String, String> { Entry entry; Pet pet; }',
    'p/Both.java': 'package p; import java.awt.*; import java.util.*; abstract class Both implements Collection<String> { Pet pet; }',
    'p/Unknown.java': 'package p; import org.lib.*; abstract class Unknown implements Runnable { Pet pet; }',
    'p/Unlisted.java': 'package p; abstract class Unlisted extends java.util.AbstractMap<String, String> { Pet pet; }',
    // Unparsable, so unanalyzed: only an implicit java.lang binding would claim Error.
    'p/Error.java': 'package p; public class Error { public static class Pet {} } // caf\\u00e9',
    'p/Fault.java': 'package p; abstract class Fault extends Error { Pet pet; }',
    'lib/Base.java': 'package lib; public class Base { public interface Serializable { class Pet {} } }',
    'p/Enclosed.java': 'package p; import java.io.Serializable; class Enclosed extends lib.Base { class Inner implements Serializable { Pet pet; } }',
    'p/Base2.java': 'package p; public class Base2 { public interface Serializable { class Pet {} } }',
    'p/Enclosed2.java': 'package p; import java.io.Serializable; class Enclosed2 extends Base2 { class Inner implements Serializable { Pet pet; } }',
    'p/Obscured.java': 'package p; import other.*; abstract class Obscured implements java.io.Serializable { Pet pet; }',
  });
  const parsed = parseSources(root, { ...config(), exclude: ['lib/**'] });
  assert.deepEqual(parsed.parse_errors.map(e => e.path), ['p/Error.java']);
  const { imports } = resolveImports(parsed.units);
  const find = (from, specifier) => imports.find(i => i.from === from && i.specifier === specifier);
  for (const from of ['p/Owner.java', 'p/Registry.java']) assert.equal(find(from, 'Pet')?.to, 'p/Pet.java', from);
  assert.equal(find('p/Registry.java', 'Entry')?.resolved, false, 'Map contributes Entry');
  // Implicit java.lang and on-demand bindings are not inferred; nor is one under an unknown enclosing chain.
  for (const from of ['p/Task.java', 'p/Both.java', 'p/Unknown.java', 'p/Unlisted.java', 'p/Fault.java', 'p/Enclosed.java', 'p/Enclosed2.java', 'p/Obscured.java']) {
    assert.equal(find(from, 'Pet')?.resolved, false, `${from} keeps the guard`);
  }
});

test('java: member records holding only member types keep those members, in the owner and in subclasses', t => {
  // javac binds Base$Pair, Base$Box and Owner$Point; the parser reads these records as methods.
  const root = fixture(t, {
    'p/Base.java': 'package p; public class Base { public record Pair(int a) { public static class Helper {} } public record Box(int v) { interface Marker {} ; } }',
    'p/Pair.java': 'package p; public class Pair {}',
    'p/Box.java': 'package p; public class Box {}',
    'p/Point.java': 'package p; public class Point {}',
    'p/Sub.java': 'package p; class Sub extends Base { Pair pair; Box box; }',
    'p/Owner.java': 'package p; class Owner { public record Point(int x, int y) { public static final class Builder {} } Point origin; }',
    'q/Use.java': 'package q; import p.Base.Pair.Helper; import p.Shapes.Shape.Part; class Use { Helper helper; Part part; }',
    'p/Shapes.java': 'package p; public interface Shapes { record Shape(int s) { class Part {} } }',
  });
  const { facts } = extractFacts(root, { language: 'java' });
  assert.equal(facts.parse_errors, undefined);
  for (const specifier of ['Pair', 'Box']) assert.equal(facts.imports.find(i => i.from === 'p/Sub.java' && i.specifier === specifier)?.resolved, false, specifier);
  assert.ok(!facts.imports.some(i => i.from === 'p/Owner.java' && i.specifier === 'Point'), 'Point binds the same-file member record');
  assert.equal(facts.imports.find(i => i.from === 'q/Use.java' && i.specifier === 'p.Base.Pair.Helper')?.to, 'p/Base.java');
  assert.equal(facts.imports.find(i => i.from === 'q/Use.java' && i.specifier === 'p.Shapes.Shape.Part')?.to, 'p/Shapes.java', 'records in interfaces too');
  assert.deepEqual(facts.functions.filter(f => /Base|Owner/.test(f.file)), [], 'misparsed records emit no function records');
});

test('java: enum and record members are out of scope in their own implements clauses', t => {
  // javac binds both clauses to p.I; a record's component types still see its members.
  const root = fixture(t, {
    'p/I.java': 'package p; public interface I {}',
    'p/Api.java': 'package p; public class Api {}',
    'p/Target.java': 'package p; public class Target {}',
    'p/E.java': 'package p; enum E implements I { A; interface I {} }',
    'p/R.java': 'package p; record R(int x) implements I { interface I {} }',
    'p/C.java': 'package p; record C(Api api) { static class Api {} }',
    'p/Mode.java': 'package p; enum Mode implements I { ON; Target target; }',
  });
  const { imports } = resolveImports(parseSources(root, config()).units);
  for (const from of ['p/E.java', 'p/R.java', 'p/Mode.java']) assert.equal(imports.find(i => i.from === from && i.specifier === 'I')?.to, 'p/I.java', from);
  assert.ok(!imports.some(i => i.from === 'p/C.java' && i.specifier === 'Api'), 'a record component type binds the record member');
  assert.equal(imports.find(i => i.from === 'p/Mode.java' && i.specifier === 'Target')?.to, 'p/Target.java', 'an enum implementing an analyzed interface opens its body');
});

test('java: modules follow Maven/Gradle modules, or packages in a single-module build', t => {
  const multi = fixture(t, {
    'pom.xml': '<project/>',
    'core/pom.xml': '<project/>',
    'core/src/main/java/x/core/Core.java': 'package x.core; public class Core {}',
    'plugins/web/build.gradle': '',
    'plugins/web/src/main/java/x/web/Web.java': 'package x.web; import x.core.Core; class Web { Core core; }',
    'plugins/web/api/pom.xml': '<project/>',
    'plugins/web/api/src/main/java/x/api/Api.java': 'package x.api; import x.core.Core; class Api { Core core; }',
  });
  const first = extractFacts(multi);
  const graph = buildGraph(first.facts, first.config);
  assert.equal(graph.grouping.java, 'build-modules');
  assert.deepEqual(graph.modules.map(m => m.path).sort(), ['core', 'plugins/web', 'plugins/web/api'], 'build modules deeper than the depth budget stay apart');
  assert.deepEqual(schemaErrors('module-graph', graph), []);

  const single = fixture(t, {
    'pom.xml': '<project/>',
    'src/main/java/org/x/lib/Root.java': 'package org.x.lib; public class Root {}',
    'src/main/java/org/x/lib/bag/Bag.java': 'package org.x.lib.bag; import org.x.lib.Root; public class Bag { Root root; }',
    'src/main/java/org/x/lib/map/Map.java': 'package org.x.lib.map; import org.x.lib.bag.Bag; class Map { Bag bag; }',
    'src/main/java/org/x/lib/map/impl/Hash.java': 'package org.x.lib.map.impl; class Hash {}',
    'src/test/java/org/x/lib/BagTest.java': 'package org.x.lib; class BagTest {}',
    'src/integrationTest/java/org/x/lib/it/Flow.java': 'package org.x.lib.it; class Flow {}',
    'tools/gen/Gen.java': 'class Gen {}',
    'src/main/java/module-info.java': 'module org.x.lib {}',
  });
  const facts = extractFacts(single);
  const packages = buildGraph(facts.facts, facts.config);
  assert.equal(packages.grouping.java, 'packages');
  assert.deepEqual(packages.modules.map(m => m.path).sort(), ['src/integrationTest/java/org/x/lib/it', 'src/main/java', 'src/main/java/org/x/lib',
    'src/main/java/org/x/lib/bag', 'src/main/java/org/x/lib/map', 'tools/gen'], 'each source root splits by package; other files keep depth');
  assert.equal(packages.edges.length, 2);
  const depth = buildGraph(facts.facts, { ...facts.config, modules: { depth: 2 } });
  assert.equal(depth.grouping.java, undefined, 'a configured depth keeps directory-depth grouping');
  assert.deepEqual(depth.modules.map(m => m.path).sort(), ['src/integrationTest', 'src/main', 'tools/gen']);
  const flat = buildGraph(facts.facts, { ...facts.config, modules: { packageBoundaries: false } });
  assert.equal(flat.grouping.java, undefined, 'packageBoundaries: false also keeps directory depth');
  const loose = fixture(t, { 'o/x/a/A.java': 'package o.x.a; public class A {}', 'o/x/b/B.java': 'package o.x.b; class B { o.x.a.A a; }', 'o/y/Y.java': 'package o.y; class Y {}' });
  const looseFacts = extractFacts(loose);
  const grouped = buildGraph(looseFacts.facts, { ...looseFacts.config, modules: { groups: { tooling: ['o/y/**'] } } });
  assert.deepEqual(grouped.modules.map(m => m.path).sort(), ['o/x/a', 'o/x/b', 'tooling'], 'grouped files do not narrow the package split');
  assert.equal(grouped.edges.length, 1);
  const pinned = buildGraph(looseFacts.facts, { ...looseFacts.config, modules: { groups: { all: ['o/**'] } } });
  assert.equal(pinned.grouping.java, undefined, 'groups claiming every file leave no Java default');
  const plain = fixture(t, { 'src/main/java/a/one/A.java': 'package a.one; class A {}', 'src/main/java/a/two/B.java': 'package a.two; class B {}' });
  const noBuild = extractFacts(plain);
  assert.deepEqual(buildGraph(noBuild.facts, noBuild.config).modules.map(m => m.path), ['src/main/java/a/one', 'src/main/java/a/two'], 'no build file: packages');
});

test('java: qualified names start at a package or an in-scope type, never at a subpackage', t => {
  // javac: p.A for `p.A` in package x, and q.r.R for `r.R` under `import q.*`.
  const root = fixture(t, {
    'p/A.java': 'package p; public class A {}',
    'x/p/A.java': 'package x.p; public class A {}',
    'x/C.java': 'package x; public class C { p.A field; }',
    'r/R.java': 'package r; public class R {}',
    'q/r.java': 'package q; public class r { public static class R {} }',
    'q/B2.java': 'package q; public class B2 { public static class r { public static class R {} } }',
    'u/Use.java': 'package u; import q.*; class Use { r.R field; }',
    'u/UseStatic.java': 'package u; import static q.B2.*; class UseStatic { r.R field; }',
    'u/Plain.java': 'package u; class Plain { r.R field; }',
  });
  const { imports } = resolveImports(parseSources(root, config()).units);
  const find = (from, specifier) => imports.find(i => i.from === from && i.specifier === specifier);
  assert.equal(find('x/C.java', 'p.A')?.to, 'p/A.java');
  for (const from of ['u/Use.java', 'u/UseStatic.java']) assert.equal(find(from, 'r.R')?.resolved, false, `${from}: a type imported on demand obscures the package`);
  assert.equal(find('u/Plain.java', 'r.R')?.to, 'r/R.java');
});

test('java: declaration headers preserve outer, local, parameter and static-import guards', t => {
  const root = fixture(t, {
    'Api.java': 'package demo; public interface Api {}',
    'Base.java': 'package demo; class Base {}',
    'Generic.java': 'package lib; public class Generic<T> {}',
    'Types.java': 'package lib; public class Types { public static class Api {} }',
    'Outer.java': 'package demo; class Outer extends Unknown { class Inner implements Api {} }',
    'Parameter.java': 'package demo; class Parameter<Api> extends lib.Generic<Api> {}',
    'StaticHeader.java': 'package demo; import static lib.Types.Api; class StaticHeader implements Api {}',
    'LocalHeader.java': 'package demo; class LocalHeader { void run() { class Local implements Api {} } }',
    'AnonymousHeader.java': 'package demo; class AnonymousHeader { Object x = new Unknown() { class Inner implements Api {} }; }',
    'RecordHeader.java': 'package demo; record RecordHeader(Api api) { static class Api {} }',
    'KnownOuter.java': 'package demo; class KnownOuter { static class Base {} class Inner extends Base {} }',
    'Duplicate.java': 'package demo; interface Duplicate {}',
    'other/Duplicate.java': 'package demo; interface Duplicate {}',
    'Ambiguous.java': 'package demo; class Ambiguous implements Duplicate {}',
  });
  const { imports } = resolveImports(parseSources(root, config()).units);
  assert.ok(!imports.some(i => i.from === 'Parameter.java' && i.specifier === 'Api'), 'a type parameter is no dependency');
  for (const from of ['Outer.java', 'StaticHeader.java', 'LocalHeader.java', 'AnonymousHeader.java']) {
    assert.equal(imports.find(i => i.from === from && i.specifier === 'Api')?.resolved, false, from);
  }
  assert.equal(imports.find(i => i.from === 'Parameter.java' && i.specifier === 'lib.Generic')?.to, 'Generic.java');
  assert.ok(!imports.some(i => i.from === 'RecordHeader.java' && i.specifier === 'Api'), 'record header retains its own member scope');
  assert.ok(!imports.some(i => i.from === 'KnownOuter.java' && i.specifier === 'Base'), 'an outer member still binds a nested declaration header');
  assert.equal(imports.find(i => i.from === 'Ambiguous.java' && i.specifier === 'Duplicate')?.resolved, false);
});
