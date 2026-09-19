import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import ts from 'typescript';
import { extract as extractTs } from '../extract/ts/index.mjs';
import { buildModuleGraph } from '../graphs/module.mjs';
import { evaluate } from '../evaluate/index.mjs';
import { buildOverlay } from '../overlay/inject.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';
import { evaluateGraph, extractFacts } from '../lib/analysis.mjs';
import { DiagnosticError } from '../extract/shared/diagnostics.mjs';

const config = JSON.parse(fs.readFileSync(new URL('../config/defaults.json', import.meta.url)));

function analyze(t, files, language = 'py', options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bauify-semantics-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content);
  }
  const { facts } = extractFacts(root, { language, config });
  const graph = buildModuleGraph(facts, options);
  const findings = evaluate(graph, {}, facts);
  for (const [name, doc] of [['raw-facts', facts], ['module-graph', graph], ['findings', findings]]) assert.deepEqual(schemaErrors(name, doc), []);
  return { root, facts, graph, findings, cycles: findings.diagnostics.filter((f) => f.code === 'coupling/import-cycle') };
}

// Only these small, test-authored fixtures are executed. The analyzer still
// never imports or executes source from the repository under analysis.
function python(root, code) {
  const commands = process.env.BAUIFY_PYTHON ? [[process.env.BAUIFY_PYTHON]] : [['python3'], ['python'], ['py', '-3']];
  for (const [command, ...args] of commands) {
    const result = spawnSync(command, [...args, '-c', code], { cwd: root, encoding: 'utf8', timeout: 10000 });
    if (!result.error) return result;
  }
  assert.fail('Python interpreter unavailable');
}

test('Python TYPE_CHECKING aliases stay as structural edges, never runtime-cycle errors', (t) => {
  for (const [header, guard] of [
    ['from typing import TYPE_CHECKING', 'TYPE_CHECKING'],
    ['from typing import TYPE_CHECKING as TC', 'TC'],
    ['import typing as ty', 'ty.TYPE_CHECKING'],
  ]) {
    const { root, facts, cycles, graph } = analyze(t, {
      'a.py': `${header}\nif ${guard}:\n    from b import B\nclass A: pass\n`,
      'b.py': 'from a import A\nclass B: pass\n',
    });
    assert.equal(facts.imports.find((e) => e.to === 'b.py').typeOnly, true);
    assert.equal(cycles.length, 0);
    assert.equal(graph.edges.length, 2, 'type dependency remains available for structural analysis');
    for (const order of ['import a; import b', 'import b; import a']) assert.equal(python(root, order).status, 0);
  }
});

test('Python reassignment of TYPE_CHECKING cannot hide a runtime dependency', (t) => {
  const { facts } = analyze(t, { 'a.py': 'from typing import TYPE_CHECKING\nTYPE_CHECKING = True\nif TYPE_CHECKING:\n    import b\n', 'b.py': '' });
  const edge = facts.imports.find((e) => e.to === 'b.py');
  assert.equal(edge.typeOnly, undefined);
  assert.equal(edge.conditional, true);
});

test('Python TYPE_CHECKING else branch is runtime, unknown guards are conditional', (t) => {
  const { facts } = analyze(t, { 'a.py': 'from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    import b\nelse:\n    import c\nif 1 == 2:\n    import d\n', 'b.py': '', 'c.py': '', 'd.py': '' });
  assert.equal(facts.imports.find((e) => e.to === 'b.py').typeOnly, true);
  assert.equal(facts.imports.find((e) => e.to === 'c.py').typeOnly, undefined);
  assert.equal(facts.imports.find((e) => e.to === 'd.py').conditional, true);
});

test('Python dynamic and opaque imports inherit function scope; default expressions do not', (t) => {
  const { root, facts, cycles } = analyze(t, {
    'a.py': 'import importlib\ndef load(name):\n    importlib.import_module(name)\n    return importlib.import_module("b")\nclass A: pass\n',
    'b.py': 'from a import A\n',
  });
  assert.ok(facts.imports.filter((e) => e.kind === 'dynamic').every((e) => e.lazy));
  assert.equal(cycles[0].evidence.risk.loading, 'not-proven');
  assert.equal(python(root, 'import a; import b').status, 0);
  const defaults = analyze(t, { 'a.py': 'import importlib\ndef f(x=importlib.import_module("b")):\n    return importlib.import_module("c")\n', 'b.py': '', 'c.py': '' });
  assert.equal(defaults.facts.imports.find((e) => e.to === 'b.py').lazy, undefined);
  assert.equal(defaults.facts.imports.find((e) => e.to === 'c.py').lazy, true);
});

test('A deferred import may fail during initialization: do not assert import safety', (t) => {
  const { root, cycles } = analyze(t, {
    'a.py': 'def load():\n    from b import B\nload()\nclass A: pass\n',
    'b.py': 'from a import A\nclass B: pass\n',
  });
  const actual = python(root, 'import a');
  assert.notEqual(actual.status, 0);
  assert.match(actual.stderr, /ImportError/);
  assert.equal(cycles[0].evidence.risk.loading, 'not-proven');
  assert.doesNotMatch(cycles[0].message, /nothing runs|no import.time risk|safe at import/i);
});

test('Python submodule imports include package initialization, exposing the real file cycle', (t) => {
  const { root, facts, cycles } = analyze(t, {
    'a.py': 'from pkg import sub\nclass A: pass\n',
    'pkg/__init__.py': 'from a import A\n', 'pkg/sub.py': 'B = 1\n',
  });
  assert.ok(facts.imports.some((e) => e.from === 'a.py' && e.to === 'pkg/__init__.py' && e.implicit && e.line === 1));
  assert.ok(cycles.some((f) => f.severity === 'warning' && f.subject.files.includes('pkg/__init__.py')));
  assert.match(python(root, 'import a').stderr, /ImportError/);
});

test('Python nested package initializers are included once, without false ancestor re-entry', (t) => {
  const { facts } = analyze(t, { 'a.py': 'import pkg.deep.sub\n', 'pkg/__init__.py': 'from .deep import sub\n', 'pkg/deep/__init__.py': '', 'pkg/deep/sub.py': 'from . import other\n', 'pkg/deep/other.py': '' });
  assert.deepEqual(facts.imports.filter((e) => e.from === 'a.py').map((e) => e.to), ['pkg/__init__.py', 'pkg/deep/__init__.py', 'pkg/deep/sub.py']);
  assert.ok(!facts.imports.some((e) => e.implicit && e.from === 'pkg/deep/sub.py'));
});

test('Python simple eager failure is a candidate, not a claim that static line order is proof', (t) => {
  const { root, cycles } = analyze(t, { 'a.py': 'from b import B\nclass A: pass\n', 'b.py': 'from a import A\nclass B: pass\n' });
  assert.match(python(root, 'import a').stderr, /ImportError/);
  assert.equal(cycles[0].severity, 'warning');
  assert.equal(cycles[0].evidence.risk.loading, 'potential-partial-init');
  assert.ok(cycles[0].evidence.partialInitCandidate);
  assert.ok(cycles[0].confidence < 1);
});

test('TypeScript type-only cycles are erased in JavaScript and excluded from runtime findings', (t) => {
  const files = { 'a.ts': 'import type {B} from "./b.js";\nexport interface A { b?: B }\n', 'b.ts': 'import type {A} from "./a.js";\nexport interface B { a?: A }\n' };
  const { facts, cycles } = analyze(t, files, 'ts');
  assert.ok(facts.imports.every((e) => e.typeOnly));
  assert.equal(cycles.length, 0);
  for (const text of Object.values(files)) assert.doesNotMatch(ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText, /from ["']/);
});

test('TypeScript inline type specifiers respect verbatimModuleSyntax side effects', (t) => {
  const files = { 'a.ts': 'import { type B } from "./b.js";\n', 'b.ts': 'export interface B {}\n' };
  const erased = analyze(t, files, 'ts');
  assert.equal(erased.facts.imports[0].typeOnly, true);
  const preserved = analyze(t, { ...files, 'tsconfig.json': JSON.stringify({ compilerOptions: { verbatimModuleSyntax: true } }) }, 'ts');
  assert.equal(preserved.facts.imports[0].typeOnly, undefined);
  assert.match(ts.transpileModule(files['a.ts'], { compilerOptions: { module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true } }).outputText, /import \{\} from/);
});

test('JavaScript function-scope import() and require are deferred; top-level require remains eager', (t) => {
  const { root, facts, cycles } = analyze(t, { 'a.mjs': 'export async function load() { return import("./b.mjs"); }\nexport const A = 1;\n', 'b.mjs': 'import {A} from "./a.mjs";\nexport const B = A;\n' }, 'ts');
  assert.equal(facts.imports.find((e) => e.kind === 'dynamic').lazy, true);
  assert.equal(cycles[0].evidence.risk.loading, 'not-proven');
  const actual = spawnSync(process.execPath, ['--input-type=module', '-e', 'import("./a.mjs").then(m=>m.load()).then(m=>console.log(m.B))'], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(actual.status, 0, actual.stderr);
  assert.equal(actual.stdout.trim(), '1');
  const commonjs = analyze(t, { 'a.cjs': 'require("./b.cjs");\nfunction f() { return require("./b.cjs"); }\n', 'b.cjs': '' }, 'ts');
  assert.deepEqual(commonjs.facts.imports.map((e) => Boolean(e.lazy)), [false, true]);
});

test('TypeScript uses tsconfig path aliases and ignores Python files in explicitly selected TS trees', (t) => {
  const { facts } = analyze(t, { 'a.ts': 'import {b} from "@lib/b";\n', 'lib/b.ts': 'export const b = 1;\n', 'other.py': 'print("not TypeScript")\n', 'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@lib/*': ['lib/*'] } } }) }, 'ts');
  assert.equal(facts.imports[0].to, 'lib/b.ts');
  assert.ok(facts.files.every((f) => !f.path.endsWith('.py')));
});

test('Module IDs are unique and deterministic for path, case, root-file and Unicode collisions', (t) => {
  const { facts, graph } = analyze(t, { 'a-b/x.py': 'import core\n', 'a/b/x.py': 'import core\n', 'core.py': '', 'core/sub.py': '', '中文/x.py': '', '日本語/x.py': '' });
  assert.equal(new Set(graph.modules.map((m) => m.id)).size, graph.modules.length);
  assert.equal(new Set(graph.edges.map((e) => e.from)).size, 2);
  const reordered = buildModuleGraph({ ...facts, files: [...facts.files].reverse() });
  assert.deepEqual(reordered.modules.map((m) => [m.label, m.id]), graph.modules.map((m) => [m.label, m.id]));
  for (const id of Object.values(graph.fileModules)) assert.ok(graph.modules.some((m) => m.id === id));
  const caseGraph = buildModuleGraph({ ...facts, imports: [], files: ['Case/x.py', 'case/x.py'].map((p) => ({ path: p, role: 'source', loc: 0 })) });
  assert.equal(new Set(caseGraph.modules.map((m) => m.id)).size, 2);
});

test('Overlay uses exact ownership for root files and explicitly grouped modules', (t) => {
  const { facts, graph } = analyze(t, { 'a.py': '', 'b.py': '', 'src/c.py': '' }, 'py', { modules: { groups: { custom: ['src/**'] } } });
  const ir = { components: ['a.py', 'b.py', 'src/c.py'].map((file, i) => ({ id: `c${i}`, label: file, sources: [{ path: file }] })) };
  const result = buildOverlay({ ir, graph, facts, html: '<body><div class="toolbar"></div><svg><g data-node-id="c0"></g></svg></body>' });
  const payload = JSON.parse(result.html.match(/id="bauify-analysis">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(payload.components.map((c) => c.fileList.map((f) => f.path)), [['a.py'], ['b.py'], ['src/c.py']]);
  const script = result.html.match(/id="bauify-script">([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Function(script), 'the embedded viewer script must remain valid JavaScript');
});

test('Semantic validation rejects duplicate IDs, dangling edges and inconsistent ownership', (t) => {
  const { graph, facts } = analyze(t, { 'a.py': 'import b\n', 'b.py': '' });
  const duplicate = structuredClone(graph); duplicate.modules[1].id = duplicate.modules[0].id;
  assert.ok(schemaErrors('module-graph', duplicate).some((e) => e.message.includes('unique')));
  const missing = structuredClone(graph); missing.edges[0].to = 'missing';
  assert.ok(schemaErrors('module-graph', missing).some((e) => e.message.includes('existing module')));
  const wrongOwner = structuredClone(graph); wrongOwner.fileModules['a.py'] = 'b';
  assert.ok(schemaErrors('module-graph', wrongOwner).some((e) => e.message.includes('ownership')));
  const badFacts = structuredClone(facts); badFacts.imports[0].to = 'missing.py';
  assert.ok(schemaErrors('raw-facts', badFacts).some((e) => e.message.includes('recorded file')));
});

test('evaluate rejects raw facts from a different revision and invalid file records', (t) => {
  const { graph, facts } = analyze(t, { 'a.py': 'import b\n', 'b.py': '' });
  const code = (fn) => { try { fn(); } catch (error) { assert.ok(error instanceof DiagnosticError); return error.diagnostics[0].code; } assert.fail('expected a diagnostic'); };
  const other = structuredClone(facts); other.repository.revision = 'a'.repeat(40);
  assert.equal(code(() => evaluateGraph(graph, {}, other)), 'input/facts-incompatible');
  const invalid = structuredClone(facts); invalid.files[0] = null;
  assert.equal(code(() => evaluateGraph(graph, {}, invalid)), 'input/facts-incompatible');
});

test('single-file runtime cycles retain eager and deferred risk semantics', (t) => {
  const eager = analyze(t, { 'a/x.py': 'from a.x import X as Y\nX = 1\n' });
  assert.equal(eager.cycles.length, 1);
  assert.deepEqual(eager.cycles[0].subject.files, ['a/x.py']);
  assert.deepEqual(eager.cycles[0].evidence.path, ['a/x.py']);
  assert.equal(eager.cycles[0].severity, 'warning');
  assert.equal(eager.cycles[0].evidence.risk.loading, 'potential-partial-init');
  const lazy = analyze(t, { 'a/x.py': 'def load():\n    import a.x\n' });
  assert.equal(lazy.cycles.length, 1);
  assert.equal(lazy.cycles[0].evidence.risk.loading, 'not-proven');
  const typed = analyze(t, { 'a/x.py': 'from typing import TYPE_CHECKING\nif TYPE_CHECKING:\n    import a.x\n' });
  assert.equal(typed.cycles.length, 0);
});

test('TypeScript extraction ignores ancestor configs but honors a root config', (t) => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'bauify-parent-config-'));
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'project');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'entry.ts'), "import { type T } from './dep';\nimport '@alias/dep';\n");
  fs.writeFileSync(path.join(root, 'dep.ts'), 'export type T = string;\n');
  const baseline = extractTs(root, config).imports;
  const options = { compilerOptions: { verbatimModuleSyntax: true, baseUrl: './project', paths: { '@alias/*': ['*'] } } };
  fs.writeFileSync(path.join(parent, 'tsconfig.json'), JSON.stringify(options));
  assert.deepEqual(extractTs(root, config).imports, baseline);
  fs.writeFileSync(path.join(parent, 'tsconfig.json'), '{ invalid');
  assert.deepEqual(extractTs(root, config).imports, baseline);
  options.compilerOptions.baseUrl = '.';
  fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify(options));
  const imports = extractTs(root, config).imports;
  assert.equal(imports[0].typeOnly, undefined);
  assert.equal(imports[1].to, 'dep.ts');
});

test('raw facts reject unresolved implicit package initialization edges', (t) => {
  const { facts } = analyze(t, { 'a.py': 'import pkg.sub\n', 'pkg/__init__.py': '', 'pkg/sub.py': '' });
  const invalid = structuredClone(facts);
  const edge = invalid.imports.find((e) => e.implicit);
  assert.ok(edge);
  edge.resolved = false;
  delete edge.to;
  assert.notDeepEqual(schemaErrors('raw-facts', invalid), []);
});

test('review regressions: loop targets and statement-scoped initializer deduplication', (t) => {
  const { facts } = analyze(t, {
    'entry.py': 'import pkg.a, pkg.b\nimport pkg.a; import pkg.b; import importlib\nfor items[importlib.import_module(name).key] in values:\n    pass\n',
    'pkg/__init__.py': '', 'pkg/a.py': '', 'pkg/b.py': '',
  });
  assert.equal(facts.imports.filter((e) => e.implicit && e.line === 1).length, 1);
  assert.equal(facts.imports.filter((e) => e.implicit && e.line === 2).length, 2);
  const opaque = facts.imports.find((e) => e.specifier === '<computed>');
  assert.equal(opaque.conditional, true);
  assert.equal(facts.unresolved.opaque, 1);
});

test('review regressions: explicit zero eager counts and legacy graph classification', (t) => {
  const { graph } = analyze(t, { 'a.py': 'def f():\n    import b\n', 'b.py': 'import a\n' });
  assert.ok(graph.edges.some((e) => e.kinds.eager === 0));
  assert.equal(evaluate(graph).diagnostics.find((d) => d.code === 'coupling/cycle').evidence.kind, 'mixed');
  for (const e of graph.edges) e.kinds = { static: e.weight };
  assert.deepEqual(schemaErrors('module-graph', graph), []);
  assert.equal(evaluate(graph).diagnostics.find((d) => d.code === 'coupling/cycle').evidence.kind, 'eager');
});

test('review regressions: import evidence and ownership errors are order independent', (t) => {
  const { facts, graph } = analyze(t, { 'a.py': 'import b\n', 'b.py': 'import a\n' });
  facts.imports = Array.from({ length: 20 }, (_, n) => ({ ...facts.imports[0], names: ['Z', String(n)] })).concat(facts.imports[1]);
  const first = evaluate(graph, {}, facts);
  facts.imports.reverse();
  assert.deepEqual(evaluate(graph, {}, facts), first);
  graph.fileModules = { 'z.py': 'missing-z', 'a.py': 'missing-a' };
  const errors = schemaErrors('module-graph', graph);
  graph.fileModules = Object.fromEntries(Object.entries(graph.fileModules).reverse());
  assert.deepEqual(schemaErrors('module-graph', graph), errors);
});

test('review regressions: overlay renders candidate references without safety claims', (t) => {
  const { facts, graph } = analyze(t, { 'a.py': 'import b\nclass A: pass\n', 'b.py': 'from a import A\n' });
  const ir = { components: [{ id: 'a', label: 'a', sources: [{ path: 'a.py' }] }] };
  const result = buildOverlay({ ir, graph, facts, html: '<body><div class="toolbar"></div><svg><g data-node-id="a"></g></svg></body>' });
  const script = result.html.match(/id="bauify-script">([\s\S]*?)<\/script>/)[1];
  const cardStart = script.indexOf('  function findingCard');
  const cardEnd = script.indexOf('\n  }', cardStart) + 4;
  const functions = script.slice(script.indexOf('  function ref('), cardEnd);
  const render = new Function('function esc(v){return String(v)}; function short(v){return v};' + functions + '; return findingCard;')();
  const finding = evaluate(graph, {}, facts).diagnostics.find((d) => d.code === 'coupling/import-cycle');
  finding.evidence.imports.push({ file: 'a.py', line: 1, to: 'b.py', conditional: true });
  const card = render(finding);
  assert.match(card, /Potential partial initialization/);
  assert.match(card, /Execution timing is not proven/);
  assert.doesNotMatch(card, /keeps the cycle out|Raises ImportError/);
  assert.doesNotThrow(() => new Function(script));
});

test('evaluate rejects changed dependency aggregates with identical metadata', (t) => {
  const { graph, facts } = analyze(t, { 'a.py': 'import b\n', 'b.py': 'import a\n' });
  assert.doesNotThrow(() => evaluateGraph(graph, {}, facts));
  for (const change of [(g) => { g.edges.pop(); }, (g) => { g.edges[0].weight++; }, (g) => { g.edges[0].kinds.eager = 0; }]) {
    const altered = structuredClone(graph); change(altered);
    assert.throws(() => evaluateGraph(altered, {}, facts), (error) => error instanceof DiagnosticError && error.diagnostics[0].code === 'input/facts-incompatible');
  }
});

test('Python generic function bounds retain deferred imports on 3.12+', (t) => {
  const probe = python(os.tmpdir(), 'import sys; print(sys.version_info >= (3, 12))');
  if (probe.stdout.trim() !== 'True') return t.skip('type parameter syntax requires Python 3.12+');
  const { facts } = analyze(t, { 'a.py': 'def f[T: __import__(name)]():\n    pass\n' });
  const edge = facts.imports.find((e) => e.specifier === '<computed>');
  assert.ok(edge);
  assert.equal(edge.lazy, true);
  assert.equal(facts.unresolved.opaque, 1);
});

test('overlay draws a recorded singleton self-import instead of missing-path text', (t) => {
  const { graph, facts, cycles } = analyze(t, { 'a.py': 'import a\n' });
  const ir = { components: [{ id: 'a', label: 'a', sources: [{ path: 'a.py' }] }] };
  const result = buildOverlay({ ir, graph, facts, html: '<body><div class="toolbar"></div><svg><g data-node-id="a"></g></svg></body>' });
  const script = result.html.match(/id="bauify-script">([\s\S]*?)<\/script>/)[1];
  const start = script.indexOf('  function cycleDiagram(');
  const end = script.indexOf('\n  }', start) + 4;
  const draw = new Function('function svgOpen(){return "<svg>"};function short(v){return v};function nodeRect(){return "<rect/>"};function arrow(){throw Error("self-loop must use curved path")};' + script.slice(start, end) + ';return cycleDiagram;')();
  const output = draw({ fileList: [{ path: 'a.py' }], modules: [] }, cycles);
  assert.match(output, /<path/);
  assert.match(output, /<rect/);
  assert.doesNotMatch(output, /Cycle path not recorded/);
  assert.doesNotThrow(() => new Function(script));
});

test('eager module cycles choose a supporting eager path despite shorter lazy cycles', (t) => {
  const { findings } = analyze(t, { 'a.py': 'import b\n', 'b.py': 'import c\ndef f():\n    import a\n', 'c.py': 'import a\n' });
  const cycle = findings.diagnostics.find((f) => f.code === 'coupling/cycle');
  assert.equal(cycle.evidence.kind, 'eager');
  assert.equal(cycle.evidence.path.length, 3);
  cycle.evidence.path.forEach((from, i, nodes) => {
    const edge = cycle.evidence.edges.find((e) => e.from === from && e.to === nodes[(i + 1) % nodes.length]);
    assert.equal(edge.deferred, false);
  });
});

test('finally imports inherit enclosing flags instead of adding a conditional guard', (t) => {
  const { facts } = analyze(t, { 'a.py': 'try:\n    pass\nfinally:\n    import b\nif flag:\n    try:\n        pass\n    finally:\n        import b\ndef f():\n    try:\n        pass\n    finally:\n        import b\n', 'b.py': '' });
  const imports = facts.imports.filter((e) => e.to === 'b.py');
  assert.equal(imports.length, 3);
  assert.equal(imports[0].conditional, undefined);
  assert.equal(imports[1].conditional, true);
  assert.equal(imports[2].lazy, true);
  assert.equal(imports[2].conditional, undefined);
});

test('Python 3.12 class bounds and aliases are lazy while class bases and bodies are eager', (t) => {
  if (python(os.tmpdir(), 'import sys; print(sys.version_info >= (3, 12))').stdout.trim() !== 'True') return t.skip('requires Python 3.12+');
  const { facts } = analyze(t, { 'a.py': 'class C[T: __import__(bound)](__import__(base).Base):\n    value = __import__(body)\ntype Alias[T: __import__(constraint)] = __import__(alias)\n' });
  assert.equal(facts.unresolved.opaque, 5);
  assert.equal(facts.imports.filter((e) => e.lazy).length, 3);
  assert.equal(facts.imports.filter((e) => !e.lazy).length, 2);
});

test('module kind evidence rejects empty and eager-only counts while preserving legacy forms', (t) => {
  const { graph } = analyze(t, { 'a.py': 'import b\n', 'b.py': '' });
  for (const kinds of [{}, { eager: 0 }, { eager: 1 }]) {
    graph.edges[0].kinds = kinds;
    assert.notDeepEqual(schemaErrors('module-graph', graph), []);
  }
  for (const kinds of [{ static: 1 }, { eager: 0, lazy: 1 }, { eager: 1, static: 1 }]) {
    graph.edges[0].kinds = kinds;
    assert.deepEqual(schemaErrors('module-graph', graph), []);
  }
});

test('Python expression guards preserve eager prefixes and deferred bodies', (t) => {
  const expressions = [
    '__import__("b") if flag else None',
    'flag and __import__("b")',
    'flag or __import__("b")',
    '(__import__("b") for x in [])',
    '[__import__("b") for x in []]',
    '{__import__("b") for x in []}',
    '{x: __import__("b") for x in []}',
  ];
  for (const expression of expressions) {
    const { facts, cycles } = analyze(t, { 'a.py': `value = ${expression}\n`, 'b.py': 'import a\n' });
    assert.equal(facts.imports.find(e => e.to === 'b.py').conditional, true, expression);
    assert.equal(cycles[0].severity, 'info', expression);
  }
  for (const expression of ['__import__("b") and flag', 'value if __import__("b") else None', '(x for x in __import__("b"))', '[x for x in __import__("b")]']) {
    const { facts, cycles } = analyze(t, { 'a.py': `value = ${expression}\n`, 'b.py': 'import a\n' });
    const edge = facts.imports.find(e => e.to === 'b.py');
    assert.equal(edge.conditional, undefined, expression);
    assert.equal(edge.lazy, undefined, expression);
    assert.equal(cycles[0].severity, 'warning', expression);
  }
  const { facts } = analyze(t, {
    'a.py': 'value = (__import__("elt") for x in __import__("outer") if __import__("guard") for y in __import__("inner"))\ndef f():\n    return [x for x in __import__("nested")]\n',
  });
  for (const name of ['elt', 'guard', 'inner']) {
    const edge = facts.imports.find(e => e.specifier === name);
    assert.equal(edge.lazy, true);
    assert.equal(edge.conditional, true);
  }
  assert.equal(facts.imports.find(e => e.specifier === 'outer').lazy, undefined);
  assert.equal(facts.imports.find(e => e.specifier === 'nested').lazy, true);
});

test('declaration imports remain structural without runtime cycles', (t) => {
  for (const extension of ['mts', 'cts']) {
    const suffix = extension === 'mts' ? 'mjs' : 'cjs';
    const { facts, cycles, graph } = analyze(t, {
      [`a.d.${extension}`]: `import { B } from './b.${suffix}'; export interface A { b: B }`,
      [`b.d.${extension}`]: `export { A } from './a.${suffix}'; export interface B { value: string }`,
    }, 'ts');
    assert.equal(facts.imports.length, 2);
    assert.ok(facts.imports.every(e => e.typeOnly));
    assert.equal(graph.edges.length, 2);
    assert.equal(cycles.length, 0);
  }
});

test('raw facts reject undercounted and overcounted unresolved imports', (t) => {
  const { facts } = analyze(t, { 'a.py': 'import missing\n' });
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
  for (const total of [0, 2]) {
    const changed = structuredClone(facts);
    changed.unresolved = { external: total, outside: 0, unknown: 0, opaque: 0 };
    assert.ok(schemaErrors('raw-facts', changed).some(e => e.path === '/unresolved'));
  }
});
