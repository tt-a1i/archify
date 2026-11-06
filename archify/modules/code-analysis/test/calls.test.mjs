import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { extractFacts, buildGraph, evaluateGraph } from '../lib/analysis.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';
import { comparability } from '../lib/review.mjs';

function extract(t, sources) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-calls-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(sources)) fs.writeFileSync(path.join(root, file), text);
  return extractFacts(root, { language: 'ts' });
}

test('TS calls bind declarations rather than names across shadowing, nested scopes and closures', (t) => {
  const text = [
    'export function target() {}',
    'target();',
    'function shadow(target: () => void) { target(); }',
    'function nested() { function target() {} target(); }',
    'function closure() { target(); }',
    '{ const target = () => {}; target(); }',
    'const alias = target; alias();',
    'const obj = { target }; obj.target();',
    'target?.();',
    'import { imported } from "./other.js"; imported();',
    '(target)();',
    'import("./other.js");',
  ].join('\n');
  const { facts } = extract(t, { 'main.ts': text, 'other.js': 'export function imported() {}' });
  const calls = facts.calls.filter((c) => c.file === 'main.ts');
  assert.equal(calls.length, 11);
  assert.deepEqual(calls.filter((c) => c.target).map((c) => [c.line, c.target.name, c.target.line, c.target.column]), [[2, 'target', 1, 1], [4, 'target', 4, 21], [5, 'target', 1, 1], [6, 'target', 6, 18], [10, 'imported', 1, 1]]);
  assert.equal(calls.find((c) => c.line === 4).column, 42);
  for (const line of [3, 7]) assert.equal(calls.find((c) => c.line === line).reason, 'no-local-function-binding');
  for (const line of [8, 11, 12]) assert.equal(calls.find((c) => c.line === line).reason, 'unsupported-callee');
  assert.equal(calls.find((c) => c.line === 9).reason, 'optional-call');
  assert.deepEqual(facts.symbols, [], 'Python binding-order symbols are not repurposed');
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
});

test('overloads select the sole body; duplicate bodies and cross-file global bindings stay unresolved', (t) => {
  const { facts } = extract(t, {
    'overload.ts': 'export function pick(x: number): number;\nexport function pick(x: string): string;\nexport function pick(x: any) { return x; }\npick(1);',
    'duplicate.js': 'export {}; function twice() {} function twice() {} twice();',
    'global-a.js': 'function externalGlobal() {}',
    'global-b.js': 'externalGlobal();',
  });
  assert.deepEqual(facts.calls.find((c) => c.file === 'overload.ts').target, { name: 'pick', line: 3, column: 1 });
  assert.equal(facts.calls.find((c) => c.file === 'duplicate.js').reason, 'ambiguous-binding');
  assert.equal(facts.calls.find((c) => c.file === 'global-b.js').reason, 'no-local-function-binding');
});

test('parameter-default scopes preserve valid outer bindings and initializer-created function scopes', (t) => {
  const { facts } = extract(t, { 'defaults.mjs': [
    'function f() {}',
    'function outerControl(value=f()) { return value; }',
    'function collision(value=f()) { function f() {} return value; }',
    'function local(value=()=>{ function f() {} return f(); }) { return value; }',
    'function localConst(value=()=>{ const f=()=>{}; return f(); }) { return value; }',
    'function closure(value=()=>{ function f() {} return ()=>f(); }) { return value; }',
  ].join('\n') });
  const calls = facts.calls;
  assert.equal(calls.length, 5);
  assert.equal(calls.find(c => c.line === 2).target.line, 1);
  assert.equal(calls.find(c => c.line === 3).resolution, 'unresolved');
  for (const line of [4, 6]) {
    const call = calls.find(c => c.line === line);
    assert.equal(call.resolution, 'same-file-function');
    assert.equal(call.target.line, line);
  }
  assert.equal(calls.find(c => c.line === 5).resolution, 'same-file-function-initializer');
  assert.equal(calls.find(c => c.line === 5).target.line, 5);
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
});

test('lexical binding remains a declaration fact under reassignment; syntax errors skip whole files', (t) => {
  const { facts } = extract(t, {
    'binding.mjs': 'function chosen() {}\nchosen = () => {};\nchosen();\nnew chosen();\nchosen`text`;',
    'broken.ts': 'function good() {}\ngood();\nfunction broken( {',
    'ambient.d.ts': 'declare function ambient(): void;',
  });
  assert.deepEqual(facts.calls, [{ file: 'binding.mjs', line: 3, column: 1, endLine: 3, endColumn: 9, resolution: 'same-file-function', target: { name: 'chosen', line: 1, column: 1 } }]);
  assert.ok(facts.parse_errors.some((e) => e.path === 'broken.ts'));
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
});

test('call schema rejects unsupported targets/positions and retains empty historical calls; revision change is not source change', (t) => {
  const { facts, config } = extract(t, { 'a.mjs': 'export function f() {}\nf();' });
  const bad = (mutate) => { const copy = structuredClone(facts); mutate(copy); assert.ok(schemaErrors('raw-facts', copy).length); };
  bad((f) => { f.calls[0].file = 'missing.mjs'; });
  bad((f) => { f.calls[0].column = 999; });
  bad((f) => { f.calls[0].endColumn = 999; });
  bad((f) => { f.calls[0].endLine = 1; });
  bad((f) => { f.calls[0].endColumn = 1; });
  bad((f) => { f.calls[0].target.name = 'not-a-function'; });
  bad((f) => { f.calls[0].reason = 'unsupported-callee'; });
  bad((f) => { f.calls[0].resolution = 'unresolved'; f.calls[0].reason = 'unsupported-callee'; });
  bad((f) => { f.callModel = ''; });
  bad((f) => { f.callModel = false; });
  assert.equal(facts.callModel, 'js-ts-lexical-v1');
  assert.deepEqual(schemaErrors('raw-facts', { ...facts, callModel: 'future-call-model' }), []);
  const previous = { ...facts, calls: [], repository: { ...facts.repository, adapterRevision: 1 } };
  delete previous.callModel;
  assert.deepEqual(schemaErrors('raw-facts', previous), []);
  assert.equal(facts.repository.adapterRevision, 10);
  const revision2 = { ...facts, repository: { ...facts.repository, adapterRevision: 2 } };
  assert.deepEqual(schemaErrors('raw-facts', revision2), []);
  const after = evaluateGraph(buildGraph(facts, config), config, facts).analysis;
  const before = evaluateGraph(buildGraph(previous, config), config, previous).analysis;
  assert.equal(comparability(after, after).comparable, true);
  assert.equal(comparability(evaluateGraph(buildGraph(revision2, config), config, revision2).analysis, after).comparable, false);
  assert.equal(comparability(before, after).comparable, false);
  assert.ok(comparability(before, after).reasons.some((r) => r.code === 'adapter-changed'));
});


test('nested call expressions sharing a start preserve every expression', (t) => {
  const { facts } = extract(t, { 'chain.js': 'function factory() { return () => {}; }\rfactory()();\u2028factory().then();' });
  assert.equal(facts.calls.length, 4);
  for (const line of [2, 3]) {
    const calls = facts.calls.filter((c) => c.line === line);
    assert.equal(calls.length, 2);
    assert.ok(calls.every((c) => c.column === 1));
    assert.equal(calls.filter((c) => c.target?.name === 'factory').length, 1);
    assert.notEqual(calls[0].endColumn, calls[1].endColumn);
    assert.equal(calls.filter((c) => c.reason === 'unsupported-callee').length, 1);
  }
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
});


test('multiline calls use end-exclusive UTF-16 source ranges', (t) => {
  const { facts } = extract(t, { 'range.js': 'function f() {}\n"😀"; f(\n  1\n);' });
  assert.deepEqual(facts.calls[0], { file: 'range.js', line: 2, column: 7, endLine: 4, endColumn: 2, resolution: 'same-file-function', target: { name: 'f', line: 1, column: 1 } });
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
});

test('const direct initializers use measured names and positions; named expression inner bindings remain unknown', (t) => {
  const { facts } = extract(t, { 'initializers.mjs': [
    'const arrow = () => 1;',
    'const anonymous = function () {};',
    'const outer = function inner() { inner(); };',
    'arrow(); anonymous(); outer();',
    'before(); const before = () => {};',
  ].join('\n') });
  const resolved = facts.calls.filter((c) => c.resolution === 'same-file-function-initializer');
  assert.deepEqual(resolved.map((c) => c.target), [
    { name: 'arrow', line: 1, column: 15 },
    { name: 'anonymous', line: 2, column: 19 },
    { name: 'inner', line: 3, column: 15 },
    { name: 'before', line: 5, column: 26 },
  ]);
  assert.equal(facts.calls.find((c) => c.line === 3).reason, 'no-local-function-binding');
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
});

test('const binding follows parameter and block shadowing, excludes mutable, wrapped and indirect initializers', (t) => {
  const { facts } = extract(t, { 'scope.ts': [
    'const chosen = () => {};',
    'function parameter(chosen: () => void) { chosen(); }',
    '{ const chosen = function local() {}; chosen(); }',
    '{ let chosen = () => {}; chosen(); }',
    'chosen();',
    'let mutable = () => {}; mutable();',
    'var legacy = function () {}; legacy();',
    'const alias = chosen; alias();',
    'const object = { chosen }; object.chosen();',
    'const wrapped = (() => {}); wrapped();',
    'const asserted = (() => {}) as () => void; asserted();',
    'import { imported } from "./other.js"; imported();',
    'const { picked } = object; picked();',
    'chosen?.();',
  ].join('\n'), 'other.js': 'export const imported = () => {};' });
  const calls = facts.calls.filter((c) => c.file === 'scope.ts');
  assert.deepEqual(calls.filter((c) => c.target).map((c) => [c.line, c.target.name, c.target.line]), [[3, 'local', 3], [5, 'chosen', 1], [12, 'imported', 1]]);
  for (const line of [2, 4, 6, 7, 8, 10, 11, 13]) assert.equal(calls.find((c) => c.line === line).reason, 'no-local-function-binding');
  assert.equal(calls.find((c) => c.line === 9).reason, 'unsupported-callee');
  assert.equal(calls.find((c) => c.line === 14).reason, 'optional-call');
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
});

test('nonunique variable declarations and cross-file globals cannot acquire an initializer target', (t) => {
  const { facts } = extract(t, {
    'duplicate.js': 'export {}; var duplicate = () => {}; var duplicate = () => {}; duplicate();',
    'a.js': 'const globalArrow = () => {};',
    'b.js': 'globalArrow();',
  });
  assert.ok(facts.calls.every((c) => c.resolution === 'unresolved'));
  assert.equal(facts.calls.find((c) => c.file === 'b.js').reason, 'no-local-function-binding');
});
