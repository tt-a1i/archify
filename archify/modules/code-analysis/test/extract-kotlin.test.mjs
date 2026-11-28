import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseSources } from '../extract/kotlin/parse.mjs';
import { loadConfig, extractFacts, buildGraph, evaluateGraph } from '../lib/analysis.mjs';
import { MODULE_ROOT } from './helpers.mjs';

const config = () => ({ ...loadConfig(), include: ['**/*.kt'] });
function fixture(t, sources) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'analysis-kotlin-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(sources)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}

test('kotlin: captured sources retain exact text, line positions, roles and exclusions', t => {
  const text = '// 😀\r\npackage demo\r\nclass A {\r\n  fun run() {}\r\n}\r\n';
  const root = fixture(t, { 'src/main/kotlin/demo/A.kt': text, 'src/test/kotlin/demo/ATest.kt': 'class ATest',
    'build/Hidden.kt': 'bad', 'node_modules/fake/Hidden.kt': 'bad', 'node_modules/fake/pom.xml': '<project/>', 'readme.txt': 'ignored' });
  const parsed = parseSources(root, config());
  assert.deepEqual(parsed.files.map(({ path: file, loc, role }) => ({ path: file, loc, role })), [
    { path: 'src/main/kotlin/demo/A.kt', loc: 5, role: 'source' },
    { path: 'src/test/kotlin/demo/ATest.kt', loc: 1, role: 'test' },
  ]);
  assert.equal(parsed.files[0].sourceText, text);
  assert.ok(!parsed.packageMarkers.some(marker => marker.startsWith('node_modules/')));
  assert.deepEqual(parsed.parse_errors, []);
  const funDecl = parsed.units[0].declarations[0].members[0];
  assert.equal(funDecl.name, 'run');
  assert.equal(funDecl.declStart.startLine, 4);
});

test('kotlin: a secondary top-level type resolves from a different source file', t => {
  const root = fixture(t, {
    'src/main/kotlin/demo/Primary.kt': 'package demo\nclass Primary\nclass Secondary\n',
    'src/main/kotlin/demo/Use.kt': 'package demo\nclass Use(val value: Secondary)\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(facts.parse_errors, undefined);
  assert.equal(facts.imports.find(imp => imp.from === 'src/main/kotlin/demo/Use.kt' && imp.specifier === 'Secondary')?.to,
    'src/main/kotlin/demo/Primary.kt');
});

test('kotlin: constructor, field, parameter, return, supertype, catch and local type sites resolve', t => {
  const root = fixture(t, {
    'p1/X.kt': 'package p1\nclass X\n',
    'p1/Failures.kt': 'package p1\nclass Failures {\n  class Problem : Exception()\n}\n',
    'p1/Field.kt': 'package p1\nclass Field {\n  val value: X? = null\n}\n',
    'p1/Local.kt': 'package p1\nclass Local {\n  fun run() {\n    val value: X? = null\n  }\n}\n',
    'p1/Ctor.kt': 'package p1\nclass Ctor {\n  fun make(): X = X()\n}\n',
    'p1/Param.kt': 'package p1\nclass Param {\n  fun read(value: X) {}\n}\n',
    'p1/Derived.kt': 'package p1\nclass Derived : X()\n',
    'p1/Catch.kt': 'package p1\nclass Catch {\n  fun run() {\n    try {\n    } catch (error: Failures.Problem) {\n    }\n  }\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(facts.parse_errors, undefined);
  for (const name of ['Field', 'Local', 'Ctor', 'Param', 'Derived']) {
    assert.ok(facts.imports.some(imp => imp.from === `p1/${name}.kt` && imp.specifier === 'X'
      && imp.to === 'p1/X.kt'), name);
  }
  assert.ok(facts.imports.some(imp => imp.from === 'p1/Catch.kt' && imp.specifier === 'Failures.Problem'
    && imp.to === 'p1/Failures.kt'));
});

test('kotlin: imports with aliases resolve through the alias name', t => {
  const root = fixture(t, {
    'p1/X.kt': 'package p1\nclass X\n',
    'p2/Use.kt': 'package p2\nimport p1.X as Ex\nclass Use(val value: Ex)\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.ok(facts.imports.some(imp => imp.from === 'p2/Use.kt' && imp.specifier === 'p1.X as Ex' && imp.to === 'p1/X.kt'));
  assert.ok(facts.imports.some(imp => imp.from === 'p2/Use.kt' && imp.specifier === 'Ex' && imp.to === 'p1/X.kt'));
});

test('kotlin: type parameters never resolve to same-named classifiers', t => {
  const root = fixture(t, {
    'p1/T.kt': 'package p1\nclass T\n',
    'p1/Generic.kt': 'package p1\nclass Generic<T> {\n  fun read(value: T): T = value\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.ok(!facts.imports.some(imp => imp.from === 'p1/Generic.kt' && imp.specifier === 'T' && imp.resolved));
});

test('kotlin: nested classifiers resolve inside and outside their owner', t => {
  const root = fixture(t, {
    'p1/Outer.kt': 'package p1\nclass Outer {\n  class Inner\n  fun make(): Inner = Inner()\n}\n',
    'p1/Use.kt': 'package p1\nclass Use {\n  val inner: Outer.Inner? = null\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.ok(facts.imports.some(imp => imp.from === 'p1/Use.kt' && imp.specifier === 'Outer.Inner' && imp.to === 'p1/Outer.kt'));
});

test('kotlin: main source cannot resolve test-only declarations, test can see main', t => {
  const root = fixture(t, {
    'build.gradle.kts': 'plugins {}\n',
    'src/main/kotlin/p1/Shared.kt': 'package p1\nclass Shared\n',
    'src/test/kotlin/p1/Helper.kt': 'package p1\nclass Helper\n',
    'src/main/kotlin/p1/MainUse.kt': 'package p1\nclass MainUse {\n  val helper: Helper? = null\n}\n',
    'src/test/kotlin/p1/TestUse.kt': 'package p1\nclass TestUse {\n  val shared: Shared? = null\n}\n',
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.ok(!facts.imports.some(imp => imp.from === 'src/main/kotlin/p1/MainUse.kt' && imp.specifier === 'Helper' && imp.resolved));
  assert.ok(facts.imports.some(imp => imp.from === 'src/test/kotlin/p1/TestUse.kt' && imp.specifier === 'Shared' && imp.resolved));
});

test('kotlin: string templates, nested comments and raw strings do not produce phantom references', t => {
  const root = fixture(t, {
    'p1/Real.kt': 'package p1\nclass Real\n',
    'p1/Strings.kt': `package p1
class Strings {
  val raw = """
    Real is not a reference here
  """.trimIndent()
  val template = "\${'$'}{1 + 2} Real is not one either"
  /* nested /* Real */ comment */
  fun use(): Real =
    Real()
}
`,
  });
  const { facts } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(facts.parse_errors, undefined);
  const edges = facts.imports.filter(imp => imp.from === 'p1/Strings.kt' && imp.specifier === 'Real' && imp.resolved);
  assert.equal(edges.length, 2);
});

test('kotlin-basic fixture: extraction facts, graph and evaluation agree', () => {
  const root = path.join(MODULE_ROOT, 'test/fixtures/kotlin-basic');
  const { facts, config: cfg } = extractFacts(root, { language: 'kotlin', config: config() });
  assert.equal(facts.parse_errors, undefined);
  assert.equal(facts.files.length, 7);
  assert.ok(facts.imports.filter(imp => imp.resolved).length >= 8);
  const graph = buildGraph(facts, cfg);
  assert.ok(graph.modules.length >= 3);
  const ownerModule = graph.modules.find(mod => mod.id.includes('owner'));
  assert.ok(ownerModule);
  const findings = evaluateGraph(graph, cfg, facts);
  assert.ok(findings.diagnostics.every(diag => diag.severity));
});
