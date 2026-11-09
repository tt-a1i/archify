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
  assert.equal(facts.callModel, 'js-ts-lexical-v5');
  assert.deepEqual(schemaErrors('raw-facts', { ...facts, callModel: 'future-call-model' }), []);
  const previous = { ...facts, calls: [], repository: { ...facts.repository, adapterRevision: 1 } };
  delete previous.callModel;
  assert.deepEqual(schemaErrors('raw-facts', previous), []);
  const revision2 = { ...facts, repository: { ...facts.repository, adapterRevision: 2 } };
  assert.deepEqual(schemaErrors('raw-facts', revision2), []);
  const after = evaluateGraph(buildGraph(facts, config), config, facts).analysis;
  const before = evaluateGraph(buildGraph(previous, config), config, previous).analysis;
  assert.equal(comparability(after, after).comparable, true);
  assert.equal(comparability(evaluateGraph(buildGraph(revision2, config), config, revision2).analysis, after).comparable, false);
  assert.equal(comparability(before, after).comparable, false);
  assert.ok(comparability(before, after).reasons.some((r) => r.code === 'adapter-changed'));
});


test('call schema validates Rust v13 closure and macro-template origins without rebinding historical callers', () => {
  const template = ['macro_rules! forward {', '    () => { fn method(&self) { self.run(); } };', '}'].join('\n');
  const body = template.split('\n')[1];
  const facts = {
    schema_version: 1, callModel: 'rust-source-direct-v13',
    repository: { root: '.', revision: null, sourceKind: 'working-tree', snapshotId: '0'.repeat(64), language: 'rust', adapter: 'rust-syn@2.0.119', adapterRevision: 13 },
    files: [
      { path: 'template.rs', sourceText: template, loc: 3, role: 'source' },
      { path: 'impls.rs', sourceText: 'impl<T: Gate> Gate for &T {\n    forward!();\n}\nimpl Owner {\n    forward!();\n}', loc: 6, role: 'source' },
    ],
    imports: [], symbols: [], functions: [], unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 },
    calls: [{
      file: 'template.rs', line: 2, column: body.indexOf('self.run()') + 1, endLine: 2, endColumn: body.indexOf('self.run()') + 11,
      resolution: 'unresolved', reason: 'rust-context-dependent',
      directCaller: { file: 'template.rs', name: 'method', qualname: 'forward!::method', kind: 'macro-generated-method', line: 2, column: body.indexOf('fn method') + 1 },
      closure: { file: 'template.rs', line: 2, column: 1 },
      macroTemplate: {
        definition: { file: 'template.rs', name: 'forward', line: 1, column: 14 },
        expansions: [
          { file: 'impls.rs', line: 2, column: 5, implLine: 1, implColumn: 1, selfType: '& T', trait: 'Gate' },
          { file: 'impls.rs', line: 5, column: 5, implLine: 4, implColumn: 1, selfType: 'Owner' },
        ],
      },
    }],
  };
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
  const bad = (mutate, expectedPath = '/calls/0/macroTemplate') => {
    const copy = structuredClone(facts); mutate(copy);
    assert.ok(schemaErrors('raw-facts', copy).some(error => error.path.startsWith(expectedPath)), expectedPath);
  };
  bad(f => { f.callModel = 'rust-source-direct-v11'; });
  bad(f => { f.repository.language = 'ts'; });
  for (const object of ['macroTemplate', 'definition', 'expansion']) {
    bad(f => {
      const macro = f.calls[0].macroTemplate;
      (object === 'macroTemplate' ? macro : object === 'definition' ? macro.definition : macro.expansions[0]).extra = true;
    });
  }
  bad(f => { f.calls[0].macroTemplate.expansions = []; });
  bad(f => { delete f.calls[0].macroTemplate.definition.name; });
  bad(f => { f.calls[0].macroTemplate.definition.name = ''; });
  bad(f => { delete f.calls[0].macroTemplate.expansions[0].selfType; });
  bad(f => { f.calls[0].macroTemplate.expansions[0].selfType = ''; });
  bad(f => { f.calls[0].macroTemplate.expansions[0].trait = ''; });
  for (const field of ['line', 'column', 'implLine', 'implColumn']) {
    for (const value of [0, -1, 1.5, 999]) bad(f => { f.calls[0].macroTemplate.expansions[0][field] = value; });
  }
  for (const field of ['line', 'column']) {
    for (const value of [0, -1, 1.5, 999]) bad(f => { f.calls[0].macroTemplate.definition[field] = value; });
  }
  bad(f => { f.calls[0].macroTemplate.definition.file = 'missing.rs'; });
  bad(f => { f.calls[0].macroTemplate.expansions[0].file = 'missing.rs'; });
  bad(f => { f.parse_errors = [{ path: 'impls.rs', message: 'invalid source' }]; });
  bad(f => { f.parse_errors = [{ path: 'template.rs', message: 'invalid source' }]; });
  bad(f => { f.calls[0].macroTemplate.expansions.push({ ...f.calls[0].macroTemplate.expansions[0] }); });
  bad(f => { f.calls[0].macroTemplate.expansions.push({ ...f.calls[0].macroTemplate.expansions[0], selfType: 'Other' }); });
  bad(f => { f.calls[0].target = { file: 'impls.rs', name: 'run', line: 1, column: 1 }; }, '/calls/0');
  bad(f => { f.calls[0].closure.extra = true; }, '/calls/0/closure');
  bad(f => { delete f.calls[0].closure.line; }, '/calls/0/closure');
  bad(f => { f.calls[0].closure.line = 0; }, '/calls/0/closure');
  bad(f => { f.calls[0].closure.file = 'impls.rs'; }, '/calls/0/closure');
  bad(f => { f.calls[0].closure.line = 99; }, '/calls/0/closure');
  bad(f => { f.calls[0].closure.file = 'missing.rs'; }, '/calls/0/closure');
  const local = structuredClone(facts);
  local.calls[0].directCaller.kind = 'local-function';
  local.calls[0].directCaller.qualname = 'forward!::method::nested';
  assert.deepEqual(schemaErrors('raw-facts', local), []);
  const historical = structuredClone(facts);
  historical.callModel = 'rust-source-direct-v11'; historical.repository.adapterRevision = 11;
  delete historical.calls[0].macroTemplate; delete historical.calls[0].closure;
  historical.calls[0].directCaller.qualname = 'Owner::method';
  assert.deepEqual(schemaErrors('raw-facts', historical), []);
  historical.callModel = 'rust-source-direct-v12';
  assert.deepEqual(schemaErrors('raw-facts', historical), []);
  const legacyClosure = structuredClone(facts);
  legacyClosure.callModel = 'rust-source-direct-v12'; legacyClosure.repository.adapterRevision = 12;
  assert.ok(schemaErrors('raw-facts', legacyClosure).some(error => error.path === '/calls/0/closure'));
  historical.callModel = 'rust-source-direct-v10';
  assert.ok(schemaErrors('raw-facts', historical).some(error => error.path === '/calls/0/directCaller/kind'));
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

test('captured ESM forwarding preserves every hop and selects implementation bodies',t=>{
 for(const ext of ['mjs','ts']){
  const suffix=ext==='ts'?'js':ext;
  const {facts}=extract(t,{
   [`entry.${ext}`]:`import {run} from './mid.${suffix}';\nexport function chosen(){run('x');}\n`,
   [`mid.${ext}`]:`export {work as run} from './api.${suffix}';\n`,
   [`api.${ext}`]:`import implementation from './root.${suffix}';\nexport {implementation as work};\n`,
   [`root.${ext}`]:ext==='ts'?'export default function actual(value:string):string;\nexport default function actual(value:unknown){return value;}\n':'export default function actual(value){return value;}\n',
  });
  const call=facts.calls.find(c=>c.file===`entry.${ext}`);
  assert.equal(call.resolution,'imported-function');
  assert.deepEqual(call.target,{file:`root.${ext}`,name:'actual',line:ext==='ts'?2:1,column:1});
  assert.deepEqual(call.via,[{file:`mid.${ext}`,line:1,column:1},{file:`api.${ext}`,line:1,column:1}]);
  assert.deepEqual(schemaErrors('raw-facts',facts),[]);
  const old=structuredClone(facts);old.callModel='js-ts-lexical-v4';
  assert.ok(schemaErrors('raw-facts',old).some(e=>String(e.message).includes('v5')));
  for(const mutate of [c=>{c.via[0].line=2},c=>{c.via.reverse()},c=>{c.via[0].file=c.file}]){
   const corrupt=structuredClone(facts);mutate(corrupt.calls.find(c=>c.file===`entry.${ext}`));
   assert.ok(schemaErrors('raw-facts',corrupt).some(e=>String(e.message).includes('path')));
  }
  const missing=structuredClone(facts);delete missing.calls.find(c=>c.file===`entry.${ext}`).via;
  assert.ok(schemaErrors('raw-facts',missing).some(e=>String(e.message).includes('import')));
 }
});

test('source-written callable exports cannot claim an implementation through direct or forwarded imports',t=>{
 const {facts}=extract(t,{
  'entry.mjs':"import {work as forwarded} from './api.mjs';import {work} from './root.mjs';\nforwarded();work();\n",
  'api.mjs':"import {work} from './root.mjs';export {work};\n",
  'root.mjs':"export function work(){return 'before'}\nwork=()=> 'after';\n",
 });
 assert.equal(facts.calls.filter(c=>c.file==='entry.mjs').length,2);
 assert.ok(facts.calls.filter(c=>c.file==='entry.mjs').every(c=>c.resolution==='unresolved'));
});

test('forwarding leaves type-only, wildcard, cyclic and opaque exports unresolved',t=>{
 const {facts}=extract(t,{
  'entry.ts':"import {work as type} from './type.js';import {work as star} from './star.js';import {work as cycle} from './cycle.js';import {work as opaque} from './opaque.js';\ntype();star();cycle();opaque();\n",
  'type.ts':"export type {work} from './root.js';\n",
  'star.ts':"export * from './root.js';\n",
  'cycle.ts':"export {work} from './cycle2.js';\n",
  'cycle2.ts':"export {work} from './cycle.js';\n",
  'opaque.ts':"import {work} from './root.js';eval(source);export {work};\n",
  'root.ts':"export function work(){}\n",
 });
 const calls=facts.calls.filter(c=>c.file==='entry.ts');assert.equal(calls.length,4);
 assert.ok(calls.every(c=>c.resolution==='unresolved'));
});

// Parentheses retain direct-eval semantics; TypeScript assertions erase to it.
test('wrapped direct eval prevents imported implementation attribution',t=>{
 for(const [ext,expression] of [['mjs', '(eval)'],['ts','(eval as any)']]){
  const {facts}=extract(t,{
   [`entry.${ext}`]:`import {work} from './root.${ext}';\nwork();\n`,
   [`root.${ext}`]:`export function work(){return 'before'}\n${expression}("work = () => 'after'");\n`,
  });
  assert.equal(facts.calls.find(c=>c.file===`entry.${ext}`).resolution,'unresolved');
 }
});
