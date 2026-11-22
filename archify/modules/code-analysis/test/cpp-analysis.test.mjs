import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractFacts, buildGraph, evaluateGraph, loadConfig, mergeConfig } from '../lib/analysis.mjs';
import { comparability } from '../lib/review.mjs';
import { buildQuestion } from '../lib/explain.mjs';
import { captureChangeSide, buildChangeQuestion } from '../lib/change-question.mjs';
import * as fileCycle from '../evaluate/rules/coupling/import-cycle.mjs';
import * as moduleCycle from '../evaluate/rules/coupling/cycle.mjs';
import { otherLanguageFiles, selectAdapter } from '../extract/index.mjs';

function available(t) {
  const python = process.env.ARCHIFY_CPP_PYTHON || 'python3';
  const probe = spawnSync(python, ['-c', 'import os; from clang import cindex; cindex.Config.set_library_file(os.environ["ARCHIFY_LIBCLANG"]) if os.environ.get("ARCHIFY_LIBCLANG") else None; cindex.Index.create()'], { encoding: 'utf8', timeout: 5000 });
  if (probe.status !== 0) {
    assert.notEqual(process.env.ARCHIFY_CPP_REQUIRED, '1', `Required C/C++ parser is unavailable: ${probe.error?.message || probe.stderr}`);
    t.skip('Python clang bindings and libclang are not installed for this platform lane');
    return false;
  }
  return true;
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify cpp analysis '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const files = {
    'a.cpp': '#include "choice.h"\n#include "names.h"\n#include "a.h"\n#include <system.h>\nint alpha() { return chosen(); }\n#define INVOKE() chosen()\nint macro_entry() { return INVOKE(); }\nint pointer_entry(int (*fn)()) { return fn(); }\ntemplate<class T> T identity(T value) { return value; }\nint template_entry() { return identity(1); }\ntemplate<class T> struct Box { int size() const { return 1; } };\nint boxed_entry() { Box<int> box; return box.size(); }\n',
    'b.cpp': '#include "choice.h"\n#include "names.h"\n#include "b.h"\nint beta() { return chosen(); }\n',
    'c.c': 'int square(int n) { if (n) return n*n; return 0; }\n',
    'extra.cpp': 'int not_selected() { return 0; }\n',
    'choice.h': '#pragma once\n#if defined(FEATURE_A)\ninline int chosen() { return 1; }\n#else\ninline int chosen() { return 2; }\n#endif\n',
    'names.h': '#pragma once\ninline int REBOUND() { return 1; }\n',
    'deps/system.h': '#pragma once\n',
    'a.h': '#pragma once\n#ifdef FEATURE_A\n#include "b.h"\n#endif\n',
    'b.h': '#pragma once\n#ifdef FEATURE_B\n#include "a.h"\n#endif\n',
  };
  for (const [name, contents] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), contents);
  }
  const database = [
    { directory: root, file: 'a.cpp', arguments: ['compiler-must-not-run', '-std=c++17', '-DFEATURE_A', '-DREBOUND=first', '-DPRIVATE_TOKEN=do-not-save', '-I.', '-isystemdeps', '-c', 'a.cpp'] },
    { directory: root, file: 'b.cpp', command: 'compiler-must-not-run -std=c++17 -DFEATURE_B -DREBOUND=second -I. -c b.cpp' },
    { directory: root, file: 'c.c', arguments: ['compiler-must-not-run', '-std=c11', '-c', 'c.c'] },
  ];
  const writeDatabase = () => fs.writeFileSync(path.join(root, 'compile_commands.json'), JSON.stringify(database));
  writeDatabase();
  return { root, database, writeDatabase };
}

function capture(root, language = 'cpp') {
  const config = mergeConfig(loadConfig(), { cpp: { compileCommands: 'compile_commands.json' } });
  const { facts, otherLanguages } = extractFacts(root, { language, config });
  const graph = buildGraph(facts, config);
  return { facts, graph, findings: evaluateGraph(graph, config, facts), otherLanguages };
}

test('C/C++ uses exact database commands, active include contexts and frozen source definitions', t => {
  if (!available(t)) return;
  const { root, database, writeDatabase } = fixture(t);
  const { facts, graph, findings, otherLanguages } = capture(root);
  assert.equal(facts.repository.language, 'cpp');
  assert.equal(facts.languageScope.build.units.length, 3);
  assert.ok(!JSON.stringify(facts).includes('do-not-save'));
  assert.deepEqual(facts.languageScope.excludedFiles, [{ file: 'extra.cpp', reason: 'no-compile-command' }]);
  assert.ok(!facts.files.some(file => file.path === 'extra.cpp'));
  assert.ok(!otherLanguages.some(row => row.adapter === 'c'));
  const chosen = facts.functions.filter(fn => fn.file === 'choice.h' && fn.name === 'chosen');
  assert.deepEqual(chosen.map(fn => fn.contexts), [['a.cpp'], ['b.cpp']], JSON.stringify({ errors: facts.parse_errors, functions: facts.functions }));
  assert.ok(!facts.functions.some(fn => fn.file === 'names.h'));
  assert.ok(facts.languageScope.conflicts.some(row => row.file === 'names.h' && row.reason === 'context-dependent-definition'));
  assert.ok(chosen.every(fn => /^[a-f0-9]{64}$/.test(fn.sourceRange.sha256)));
  assert.deepEqual(facts.imports.find(row => row.from === 'a.h').contexts, ['a.cpp']);
  assert.deepEqual(facts.imports.find(row => row.to === 'deps/system.h').contexts, ['a.cpp']);
  assert.ok(facts.languageScope.build.units[0].configuration.includePaths.includes(path.join(fs.realpathSync(root), 'deps')));
  assert.deepEqual(facts.imports.find(row => row.from === 'b.h').contexts, ['b.cpp']);
  assert.equal(facts.calls.find(call => call.directCaller?.name === 'pointer_entry')?.reason, 'cpp-function-pointer');
  assert.equal(facts.calls.find(call => call.directCaller?.name === 'template_entry')?.resolution, 'unresolved');
  assert.equal(facts.calls.find(call => call.directCaller?.name === 'boxed_entry')?.resolution, 'unresolved');
  assert.ok(facts.calls.filter(call => call.directCaller?.name === 'macro_entry').every(call => !call.target));
  assert.ok(graph.edges.every(edge => edge.kinds.eager === 0));
  assert.ok(!findings.diagnostics.some(row => ['coupling/import-cycle', 'coupling/cycle', 'coupling/internal-leak'].includes(row.code)));
  const question = buildQuestion({ root, facts, entry: 'a.cpp', symbol: 'alpha', question: 'Where is chosen?' });
  assert.equal(question.calls.coverage, 'available');
  assert.equal(question.calls.records[0].targetNavigation.status, 'valid');
  assert.equal(question.calls.records[0].targetNavigation.location.file, 'choice.h');
  assert.throws(() => buildQuestion({ root, facts, entry: 'choice.h', symbol: 'chosen', question: 'Who calls it?' }), error => error.diagnostics?.[0]?.code === 'task/context-required');
  const header = buildQuestion({ root, facts, entry: 'choice.h', context: 'a.cpp', symbol: 'chosen', question: 'Who calls it?' });
  assert.equal(header.callers.total, 1);
  assert.deepEqual(header.scope.translationUnit, 'a.cpp');
  const config = mergeConfig(loadConfig(), { cpp: { compileCommands: 'compile_commands.json' } });
  const side = captureChangeSide(root, config, 'cpp');
  const pair = buildChangeQuestion({ question: 'What changed?', entry: 'a.cpp', base: side, head: side, config });
  assert.equal(pair.status, 'ready');
  assert.equal(pair.definitionCoverage.base, 'available');
  const oldScope = findings.analysis;
  database[0].arguments[2] = '-DFEATURE_B';
  writeDatabase();
  const next = capture(root);
  assert.equal(comparability(oldScope, next.findings.analysis).comparable, false);
  assert.ok(comparability(oldScope, next.findings.analysis).reasons.some(row => row.code === 'cpp-build-scope-changed'));
  const stale = buildQuestion({ root, facts, entry: 'a.cpp', symbol: 'alpha', question: 'Where is chosen?' });
  assert.equal(stale.entry.factsStatus, 'resolution-input-changed');
  assert.equal(stale.calls.coverage, 'unavailable');
  assert.equal(capture(root, 'c').facts.languageScope.build.units.length, 1);
});

test('C/C++ reports missing configuration and ambiguous or unsafe commands', t => {
  if (!available(t)) return;
  const { root, database, writeDatabase } = fixture(t);
  assert.throws(() => extractFacts(root, { language: 'cpp', config: loadConfig() }), error => error.diagnostics?.[0]?.code === 'extract/cpp-database-missing');
  assert.throws(() => extractFacts(root, { language: 'cpp', config: mergeConfig(loadConfig(), { cpp: { compileCommands: 'compile_commands.json', timeoutMs: 600001 } }) }), error => error.diagnostics?.[0]?.code === 'extract/cpp-timeout-invalid');
  database.push({ directory: root, file: 'a.cpp', arguments: ['compiler-must-not-run', '-std=c++17', '-DFEATURE_B', '-c', 'a.cpp'] });
  writeDatabase();
  assert.throws(() => capture(root), error => error.diagnostics?.[0]?.code === 'extract/cpp-command-ambiguous');
  database.pop();
  database[0].arguments.splice(2, 0, '-Xclang', '-load');
  writeDatabase();
  assert.throws(() => capture(root), error => error.diagnostics?.[0]?.code === 'extract/cpp-command-unsupported');
  database[0].arguments.splice(2, 2);
  writeDatabase();
  const excluded = mergeConfig(loadConfig(), { cpp: { compileCommands: 'compile_commands.json' }, exclude: ['**/choice.h'] });
  assert.throws(() => extractFacts(root, { language: 'cpp', config: excluded }), error => error.diagnostics?.[0]?.code === 'extract/cpp-header-excluded');
  const choicePath = path.join(root, 'choice.h');
  const originalChoice = fs.readFileSync(choicePath);
  fs.writeFileSync(choicePath, '#error invalid header\n');
  assert.throws(() => extractFacts(root, { language: 'cpp', config: excluded }), error => error.diagnostics?.[0]?.code === 'extract/cpp-header-excluded');
  fs.writeFileSync(choicePath, originalChoice);
  fs.writeFileSync(path.join(root, 'part.custom'), 'inline int extra_answer() { return 7; }\n');
  fs.writeFileSync(path.join(root, 'a.cpp'),
    `#include "part.custom"\n${fs.readFileSync(path.join(root, 'a.cpp'), 'utf8')}`);
  assert.throws(() => capture(root), error => error.diagnostics?.[0]?.code === 'extract/cpp-source-not-captured');
  fs.writeFileSync(path.join(root, 'part.custom'), '#error invalid header\n');
  assert.throws(() => capture(root), error => error.diagnostics?.[0]?.code === 'extract/cpp-source-not-captured');
});

test('C/C++ rejects plugin and response options and drops build outputs before native parsing', t => {
  // Isolate Python from site packages so the guard can be regressed without
  // opening libclang, reading a response file or attempting to load a plugin.
  const probe = [
    'import json, os, runpy, sys',
    'from types import SimpleNamespace',
    'module = runpy.run_path(sys.argv[1])',
    'def result(action):',
    '    try: return action()',
    '    except module["ScopeError"] as error: return error.code',
    'root = os.getcwd()',
    'source = os.path.join(root, "a.cpp")',
    'def flags(*options):',
    '    command = SimpleNamespace(arguments=["cc", *options, "-c", source])',
    '    return result(lambda: module["flags"](command, source, root, ""))',
    'def database(**spelling):',
    '    entry = dict(directory=root, file=source, **spelling)',
    '    return result(lambda: module["main"]({"database": json.dumps([entry])}))',
    'print(json.dumps([',
    '    flags("-fpass-plugin=unused"),',
    '    database(arguments=["cc", "@unused", "a.cpp"]),',
    '    database(command="cc \'@unused\' a.cpp"),',
    '    flags("-MMD", "-MP", "-MF", "unused.d", "--write-dependencies",',
    '          "-ftime-trace", "-ftime-trace=unused.json", "-ftime-trace-granularity=10",',
    '          "-std=c++17", "-DFEATURE=1"),',
    ']))',
  ].join('\n');
  const helper = fileURLToPath(new URL('../extract/cpp/extract.py', import.meta.url));
  const run = spawnSync(process.env.ARCHIFY_CPP_PYTHON || 'python3', ['-I', '-S', '-c', probe, helper], { encoding: 'utf8', timeout: 5000 });
  if (run.error?.code === 'ENOENT' && process.env.ARCHIFY_CPP_REQUIRED !== '1') return t.skip('Python 3 is unavailable');
  assert.equal(run.status, 0, run.error?.message || run.stderr);
  assert.deepEqual(JSON.parse(run.stdout), [
    'extract/cpp-command-unsupported',
    'extract/cpp-command-unsupported',
    'extract/cpp-command-unsupported',
    ['-std=c++17', '-DFEATURE=1'],
  ]);
});

test('C/C++ ignores invalid bytes in an unused default-excluded build header', t => {
  if (!available(t)) return;
  const { root } = fixture(t);
  fs.mkdirSync(path.join(root, 'build'));
  fs.writeFileSync(path.join(root, 'build/ignored.h'), Buffer.from([0xff]));
  const { facts } = capture(root);
  assert.ok(facts.languageScope.build.units.some(unit => unit.file === 'a.cpp' && unit.status === 'parsed'));
  assert.ok(!facts.files.some(file => file.path === 'build/ignored.h'));
});

test('C/C++ honors a directory-only exclude for an active project header', t => {
  if (!available(t)) return;
  const { root } = fixture(t);
  fs.mkdirSync(path.join(root, 'build'));
  fs.writeFileSync(path.join(root, 'build/part.h'), 'inline int hidden_answer() { return 7; }\n');
  fs.writeFileSync(path.join(root, 'a.cpp'),
    `#include "build/part.h"\n${fs.readFileSync(path.join(root, 'a.cpp'), 'utf8')}`);
  const config = mergeConfig(loadConfig(), { cpp: { compileCommands: 'compile_commands.json' }, exclude: ['build/'] });
  assert.throws(() => extractFacts(root, { language: 'cpp', config }), error => error.diagnostics?.[0]?.code === 'extract/cpp-header-excluded');
});

test('C/C++ ignores invalid bytes in an unused header but rejects an active one', t => {
  if (!available(t)) return;
  const { root } = fixture(t);
  fs.writeFileSync(path.join(root, 'unused.h'), Buffer.from([0xff]));
  assert.ok(capture(root).facts.languageScope.build.units.some(unit => unit.status === 'parsed'));
  fs.writeFileSync(path.join(root, 'choice.h'), Buffer.from([0xff]));
  assert.throws(() => capture(root), error => error.diagnostics?.[0]?.code === 'extract/cpp-encoding-invalid');
});

test('C/C++ ignores invalid bytes in a source without a compile command', t => {
  if (!available(t)) return;
  const { root } = fixture(t);
  fs.writeFileSync(path.join(root, 'extra.cpp'), Buffer.from([0xff]));
  const { facts } = capture(root);
  assert.deepEqual(facts.languageScope.excludedFiles, [{ file: 'extra.cpp', reason: 'no-compile-command' }]);
  assert.ok(!facts.files.some(file => file.path === 'extra.cpp'));
  fs.writeFileSync(path.join(root, 'a.cpp'), Buffer.from([0xff]));
  assert.throws(() => capture(root), error => error.diagnostics?.[0]?.code === 'extract/cpp-encoding-invalid');
});

test('C/C++ supports captured implementation headers through saved source questions', t => {
  if (!available(t)) return;
  const { root } = fixture(t);
  const suffixes = ['ipp', 'inl', 'tcc', 'tpp', 'def'];
  for (const suffix of suffixes) fs.writeFileSync(path.join(root, `part.${suffix}`), `inline int ${suffix}_answer() { return 7; }\n`);
  fs.writeFileSync(path.join(root, 'a.cpp'),
    `${suffixes.map(suffix => `#include "part.${suffix}"\n`).join('')}${fs.readFileSync(path.join(root, 'a.cpp'), 'utf8')}\n`
      + suffixes.map(suffix => `int ${suffix}_entry() { return ${suffix}_answer(); }\n`).join(''));
  const { facts } = capture(root);
  for (const suffix of suffixes) {
    const entry = `part.${suffix}`;
    assert.equal(facts.calls.find(call => call.directCaller?.name === `${suffix}_entry`)?.target?.file, entry);
    const question = buildQuestion({ root, facts, entry, context: 'a.cpp', symbol: `${suffix}_answer`, question: 'Who calls it?' });
    assert.equal(question.calls.coverage, 'available');
    assert.equal(question.callers.total, 1);
    assert.equal(question.callers.records[0].navigation.status, 'valid');
    assert.equal(question.callers.records[0].fact.directCaller.name, `${suffix}_entry`);
    assert.throws(() => buildQuestion({ root, facts, entry, question: 'Who calls it?' }), error => error.diagnostics?.[0]?.code === 'task/context-required');
  }
});

test('C/C++ captures a project header included through an external wrapper', t => {
  if (!available(t)) return;
  const { root } = fixture(t);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), 'archify cpp external '));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'bridge-target.h'), 'inline int bridged_answer() { return 7; }\n');
  fs.writeFileSync(path.join(external, 'wrapper.h'), `#include "${path.join(root, 'bridge-target.h').split(path.sep).join('/')}"\n`);
  fs.writeFileSync(path.join(root, 'a.cpp'), `#include "${path.join(external, 'wrapper.h').split(path.sep).join('/')}"\nint bridged_entry() { return bridged_answer(); }\n`);
  const { facts } = capture(root);
  assert.ok(facts.files.some(file => file.path === 'bridge-target.h'));
  assert.deepEqual(facts.languageScope.fileContexts['bridge-target.h'], ['a.cpp']);
  assert.equal(facts.calls.find(call => call.directCaller?.name === 'bridged_entry')?.target?.file, 'bridge-target.h');
  const question = buildQuestion({ root, facts, entry: 'bridge-target.h', context: 'a.cpp', symbol: 'bridged_answer', question: 'Who calls it?' });
  assert.equal(question.callers.total, 1);
  assert.equal(question.callers.records[0].navigation.status, 'valid');
});

test('C/C++ keeps macro callees unknown while binding ordinary calls with macro arguments', t => {
  if (!available(t)) return;
  const { root } = fixture(t);
  fs.writeFileSync(path.join(root, 'a.cpp'), `int target(int x) { return x; }
int plain(int x) { return x; }
struct Receiver { int method(int x) { return x; } };
namespace ns { int target(int x) { return x; } }
#define target(x) target(x + 1)
#define method(x) method(x + 1)
#define ALIAS plain
#define WRAPPER(x) plain(x)
#define VALUE 1
int same_name_entry() { return target(1); }
int member_entry(Receiver& receiver) { return receiver.method(1); }
int qualified_entry() { return ns::target(1); }
int alias_entry() { return ALIAS(1); }
int wrapper_entry() { return WRAPPER(1); }
int ordinary_entry() { return plain(VALUE); }
int nested_entry() { return plain(target(1)); }
`);
  const { facts } = capture(root);
  for (const name of ['same_name_entry', 'member_entry', 'qualified_entry', 'alias_entry', 'wrapper_entry']) {
    const calls = facts.calls.filter(call => call.directCaller?.name === name);
    assert.equal(calls.length, 1, name);
    assert.equal(calls[0].reason, 'cpp-macro-expansion', name);
    assert.ok(!calls[0].target, name);
  }
  assert.equal(facts.calls.find(call => call.directCaller?.name === 'ordinary_entry')?.target?.name, 'plain');
  const nested = facts.calls.filter(call => call.directCaller?.name === 'nested_entry');
  assert.equal(nested.filter(call => call.target?.name === 'plain').length, 1);
  assert.equal(nested.filter(call => call.reason === 'cpp-macro-expansion' && !call.target).length, 1);
});

test('C/C++ removes conflicting caller identities without discarding an agreed caller', t => {
  if (!available(t)) return;
  const { root } = fixture(t);
  fs.writeFileSync(path.join(root, 'names.h'), '#pragma once\ninline int callee() { return 1; }\ninline int REBOUND() { return callee(); }\n');
  fs.writeFileSync(path.join(root, 'stable.h'), '#pragma once\n#include "choice.h"\ninline int stable() { return chosen(); }\n');
  for (const file of ['a.cpp', 'b.cpp']) fs.writeFileSync(path.join(root, file), `#include "stable.h"\n${fs.readFileSync(path.join(root, file), 'utf8')}`);
  const { facts } = capture(root);
  const conflicted = facts.calls.find(call => call.file === 'names.h');
  assert.equal(conflicted.reason, 'cpp-context-dependent');
  assert.ok(!conflicted.directCaller);
  const stable = facts.calls.find(call => call.file === 'stable.h');
  assert.equal(stable.reason, 'cpp-context-dependent');
  assert.equal(stable.directCaller.name, 'stable');
  for (const context of ['a.cpp', 'b.cpp']) {
    const question = buildQuestion({ root, facts, entry: 'names.h', context, question: 'What calls are here?' });
    assert.equal(question.calls.total, 1);
    assert.ok(!question.calls.records[0].fact.directCaller);
  }
});

test('C/C++ structural cycle rules require a common translation-unit context', () => {
  const graph = { repository: { language: 'cpp' }, excluded: { roles: [] },
    modules: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }],
    fileModules: { 'a/a.h': 'a', 'b/b.h': 'b' }, edges: [] };
  const facts = { repository: { language: 'cpp' }, files: [{ path: 'a/a.h', role: 'source' }, { path: 'b/b.h', role: 'source' }],
    imports: [
      { from: 'a/a.h', to: 'b/b.h', kind: 'static', line: 1, resolved: true, contexts: ['first.cpp'] },
      { from: 'b/b.h', to: 'a/a.h', kind: 'static', line: 1, resolved: true, contexts: ['second.cpp'] },
    ] };
  assert.deepEqual(fileCycle.run({ graph, facts }), []);
  assert.deepEqual(moduleCycle.run({ graph, facts }), []);
  facts.imports[1].contexts.push('first.cpp');
  const files = fileCycle.run({ graph, facts }), modules = moduleCycle.run({ graph, facts });
  assert.equal(files.length, 1);
  assert.deepEqual(files[0].evidence.contexts, ['first.cpp']);
  assert.match(files[0].message, /structural preprocessor/);
  assert.equal(modules.length, 1);
  assert.deepEqual(modules[0].evidence.contexts, ['first.cpp']);
  facts.imports[0].contexts.push('second.cpp');
  assert.deepEqual(fileCycle.run({ graph, facts })[0].evidence.contexts, ['first.cpp', 'second.cpp']);
  assert.equal(moduleCycle.run({ graph, facts })[0].evidence.exampleContext, 'first.cpp');
});

test('C/C++ only participates in automatic language selection with a configured database', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify mixed C '));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = loadConfig();
  const configured = mergeConfig(config, { cpp: { compileCommands: 'compile_commands.json' } });
  fs.writeFileSync(path.join(root, 'ext.c'), 'int ext() { return 1; }\n');
  assert.equal(selectAdapter(root, configured).id, 'c');
  fs.writeFileSync(path.join(root, 'app.py'), 'print(1)\n');
  assert.equal(selectAdapter(root, config).id, 'py');
  fs.rmSync(path.join(root, 'app.py'));
  fs.writeFileSync(path.join(root, 'hello.C'), 'int hello() { return 1; }\n');
  assert.equal(selectAdapter(root, configured).id, 'cpp');
  for (const language of ['c', 'cpp']) {
    assert.equal(selectAdapter(root, config, language).id, language);
  }
  fs.writeFileSync(path.join(root, 'app.ts'), 'export const app = 1;\n');
  assert.equal(selectAdapter(root, config).id, 'ts');
  assert.deepEqual(otherLanguageFiles(root, config, 'ts'), [{ adapter: 'c', files: 1 }, { adapter: 'cpp', files: 1 }]);
  assert.deepEqual(otherLanguageFiles(root, mergeConfig(config, { include: ['**/*.ts'] }), 'ts'), []);
  assert.throws(() => selectAdapter(root, configured), error => {
    const diagnostic = error.diagnostics?.[0];
    assert.equal(diagnostic?.code, 'extract/adapter-ambiguous');
    assert.deepEqual(diagnostic.evidence.counts, [{ adapter: 'cpp', files: 2 }, { adapter: 'ts', files: 1 }]);
    return true;
  });
});

for (const [adapter, compiled] of [['c', 'compiled.c'], ['cpp', 'compiled.cpp']]) {
  test(`${adapter} mixed-language dominance cannot be inferred from a partial compilation database`, t => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'archify partial C ')));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const config = mergeConfig(loadConfig(), { cpp: { compileCommands: 'compile_commands.json' } });
    for (let i = 0; i < 18; i += 1) fs.writeFileSync(path.join(root, `uncompiled${i}.c`), 'int uncompiled(void) { return 0; }');
    fs.writeFileSync(path.join(root, compiled), 'int compiled(void) { return 1; }');
    fs.writeFileSync(path.join(root, 'app.ts'), 'export const app = 1;');
    fs.writeFileSync(path.join(root, 'compile_commands.json'), JSON.stringify([
      { directory: root, file: compiled, arguments: ['clang', '-c', compiled] },
    ]));

    assert.throws(() => selectAdapter(root, config), error => {
      const diagnostic = error.diagnostics?.[0];
      assert.equal(diagnostic?.code, 'extract/adapter-ambiguous');
      assert.ok(diagnostic.supportedFixes.some(fix => fix.startsWith(`pass --language ${adapter} `)));
      assert.ok(diagnostic.supportedFixes.includes('pass --language ts (1 file)'));
      return true;
    });
  });
}
