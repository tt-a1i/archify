import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { extractFacts, buildGraph, evaluateGraph, loadConfig, mergeConfig } from '../lib/analysis.mjs';
import { comparability } from '../lib/review.mjs';
import { buildQuestion } from '../lib/explain.mjs';
import { captureChangeSide, buildChangeQuestion } from '../lib/change-question.mjs';
import * as fileCycle from '../evaluate/rules/coupling/import-cycle.mjs';
import * as moduleCycle from '../evaluate/rules/coupling/cycle.mjs';

function available(t) {
  const python = process.env.ARCHIFY_CPP_PYTHON || 'python3';
  const probe = spawnSync(python, ['-c', 'import os; from clang import cindex; cindex.Config.set_library_file(os.environ["ARCHIFY_LIBCLANG"]) if os.environ.get("ARCHIFY_LIBCLANG") else None; cindex.Index.create()'], { encoding: 'utf8', timeout: 5000 });
  if (probe.status !== 0) { t.skip('Python clang bindings and libclang are not installed for this platform lane'); return false; }
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
