import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { extractFacts, loadConfig } from '../lib/analysis.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';
import { buildQuestion } from '../lib/explain.mjs';
import { captureChangeSide, buildChangeQuestion } from '../lib/change-question.mjs';

function fixture(t, sources, exclude = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-import-calls-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries(sources)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  const config = loadConfig(null); config.exclude.push(...exclude);
  return { root, facts: extractFacts(root, { language: 'ts', config }).facts, config, entry: 'entry.mjs', symbol: 'chosen', question: 'Where is this imported helper defined?' };
}

test('relative named import aliases bind direct exported declarations and const initializers using checker identity', (t) => {
  const args = fixture(t, {
    'entry.mjs': 'import { declared as alias, arrow, outer } from "./target.mjs";\nexport function chosen() { alias(); arrow(); outer(); }\nfunction shadow(alias) { alias(); }\n{ const alias = () => {}; alias(); }',
    'target.mjs': 'export function declared() {}\nexport const arrow = () => {};\nexport const outer = function inner() {};',
  });
  const calls = args.facts.calls.filter((c) => c.file === 'entry.mjs');
  assert.deepEqual(calls.filter((c) => c.resolution === 'imported-function').map((c) => c.target), [
    { file: 'target.mjs', name: 'declared', line: 1, column: 1 },
    { file: 'target.mjs', name: 'arrow', line: 2, column: 22 },
    { file: 'target.mjs', name: 'inner', line: 3, column: 22 },
  ]);
  assert.equal(calls.find((c) => c.line === 3).resolution, 'unresolved');
  assert.equal(calls.find((c) => c.line === 4).resolution, 'same-file-function-initializer');
  assert.deepEqual(schemaErrors('raw-facts', args.facts), []);
  const brief = buildQuestion(args);
  assert.equal(brief.calls.total, 3);
  assert.ok(brief.calls.records.every((r) => r.targetNavigation.status === 'valid' && r.targetNavigation.location.file === 'target.mjs'));
});

test('relative default imports bind direct named, anonymous and overloaded function declarations without following shadows', (t) => {
  const args = fixture(t, {
    'entry.ts': [
      'import alias, { default as alsoAlias } from "./named.js";',
      'import anonymous from "./anonymous.js";',
      'import overloaded from "./overloaded.js";',
      'export function chosen() { alias(); alsoAlias(); anonymous(); overloaded("value"); }',
      'function shadow(alias) { alias(); }',
      '{ const alias = () => {}; alias(); }',
    ].join('\n'),
    'named.ts': 'export default function helper() {}',
    'anonymous.ts': 'export default function () {}',
    'overloaded.ts': 'export default function handle(value: string): string;\nexport default function handle(value: string) { return value; }',
  });
  const calls = args.facts.calls.filter((c) => c.file === 'entry.ts');
  assert.deepEqual(calls.filter((c) => c.resolution === 'imported-function').map((c) => c.target), [
    { file: 'named.ts', name: 'helper', line: 1, column: 1 },
    { file: 'named.ts', name: 'helper', line: 1, column: 1 },
    { file: 'anonymous.ts', name: 'default', line: 1, column: 1 },
    { file: 'overloaded.ts', name: 'handle', line: 2, column: 1 },
  ]);
  assert.equal(calls.find((c) => c.line === 5).resolution, 'unresolved');
  assert.equal(calls.find((c) => c.line === 6).resolution, 'same-file-function-initializer');
  assert.deepEqual(schemaErrors('raw-facts', args.facts), []);
  const brief = buildQuestion({ ...args, entry: 'entry.ts' });
  assert.equal(brief.calls.total, 4);
  assert.ok(brief.calls.records.every((r) => r.targetNavigation.status === 'valid'));
});

test('type-only, namespace, packages, re-exports, named aliases and expressions stay unknown', (t) => {
  const { facts } = fixture(t, {
    'entry.ts': [
      'import type { declared as typeClause } from "./target.js"; typeClause();',
      'import { type declared as typeSpecifier } from "./target.js"; typeSpecifier();',
      'import type defaultBinding from "./target.js"; defaultBinding();',
      'import { type default as namedDefault } from "./target.js"; namedDefault();',
      'import type { default as clauseDefault } from "./target.js"; clauseDefault();',
      'import { defaultFunction } from "./target.js"; defaultFunction();',
      'import defaultAlias from "./reexport.js"; defaultAlias();',
      'import localDefault from "./local.js"; localDefault();',
      'import expression from "./expression.js"; expression();',
      'import noDefault from "./no-default.js"; noDefault();',
      'import * as namespace from "./target.js"; namespace.declared();',
      'import { declared as reexported } from "./reexport.js"; reexported();',
      'import { declared as starred } from "./star.js"; starred();',
      'import { hidden, mutable, wrapped, localExport } from "./target.js"; hidden(); mutable(); wrapped(); localExport();',
      'import { declared as packageImport } from "package-name"; packageImport();',
      'const { declared } = require("./target.js"); declared();',
      'import("./target.js").then(x => x.declared());',
    ].join('\n'),
    'target.ts': 'export function declared() {}\nexport default function defaultFunction() {}\nfunction hidden() {}\nexport let mutable = () => {};\nexport const wrapped = (() => {});\nfunction localExport() {} export { localExport };',
    'reexport.ts': 'export { declared, default } from "./target.js";',
    'star.ts': 'export * from "./target.js";',
    'local.ts': 'function local() {} export { local as default };',
    'expression.ts': 'export default () => {};',
    'no-default.ts': 'export function noDefault() {}',
  });
  const calls = facts.calls.filter(c => c.file === 'entry.ts');
  assert.equal(calls.find(c => c.line === 8).resolution, 'imported-function');
  assert.ok(calls.filter(c => c.line !== 8).every(c => c.resolution === 'unresolved'));
});

test('parameter-default calls cannot target declarations in the unavailable function body', (t) => {
  // These are valid JS: Node calls the import, while the TypeScript checker
  // can report a body function declaration unavailable to the parameter scope.
  const { facts } = fixture(t, {
    'entry.mjs': [
      'import { f } from "./target.mjs";',
      'function direct(value=f()) { function f() {} return value; }',
      'function deferred(value=()=>f()) { function f() {} return value; }',
      'function destructured({value=f()}={}) { function f() {} return value; }',
      'function nested(value=(arg=f())=>{ function f() {} return arg; }) { return value; }',
      'function constControl(value=f()) { const f=()=>{}; return value; }',
      'function importControl(value=f()) { return value; }',
      'function bodyControl() { function f() {} return f(); }',
    ].join('\n'),
    'target.mjs': 'export function f() {}',
  });
  assert.equal(facts.parse_errors, undefined);
  const calls = facts.calls.filter(c => c.file === 'entry.mjs');
  assert.equal(calls.length, 7);
  for (const line of [2, 3, 4, 5]) {
    const call = calls.find(c => c.line === line);
    assert.equal(call.resolution, 'unresolved', `line ${line} must not point into its function body`);
    assert.equal(call.reason, 'no-local-function-binding');
    assert.equal(call.target, undefined);
  }
  for (const line of [6, 7]) {
    const call = calls.find(c => c.line === line);
    assert.equal(call.resolution, 'imported-function');
    assert.deepEqual(call.target, { file: 'target.mjs', name: 'f', line: 1, column: 1 });
  }
  assert.equal(calls.find(c => c.line === 8).resolution, 'same-file-function');
  assert.equal(calls.find(c => c.line === 8).target.line, 8);
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
});

test('excluded, missing, syntactically broken and ambiguous export targets cannot be used', (t) => {
  const { facts } = fixture(t, {
    'entry.mjs': 'import aDefault, { a } from "./excluded.mjs"; import bDefault, { b } from "./missing.mjs"; import cDefault, { c } from "./broken.mjs"; import dDefault, { d } from "./ambiguous.mjs"; import declaration from "./declaration.d.ts"; a(); b(); c(); d(); aDefault(); bDefault(); cDefault(); dDefault(); declaration();',
    'excluded.mjs': 'export function a() {} export default function aDefault() {}',
    'broken.mjs': 'export function c() {}\nexport default function cDefault() {}\nfunction broken( {',
    'ambiguous.mjs': 'export function d() {} export function d() {} export default function first() {} export default function second() {}',
    'declaration.d.ts': 'export default function declaration(): void;',
  }, ['excluded.mjs']);
  assert.ok(!facts.files.some((f) => f.path === 'excluded.mjs'));
  assert.ok(facts.calls.filter((c) => c.file === 'entry.mjs').every((c) => c.resolution === 'unresolved'));
});

test('target freshness independently disables navigation, keeps captured evidence and recovers after extraction', (t) => {
  const args = fixture(t, { 'entry.mjs': 'import { helper } from "./target.mjs";\nfunction chosen() { helper(); }', 'target.mjs': 'export function helper() {}' });
  const before = buildQuestion(args).calls.records[0];
  assert.equal(before.targetNavigation.status, 'valid');
  fs.writeFileSync(path.join(args.root, 'target.mjs'), '\nexport function helper() { return 1; }');
  let brief = buildQuestion(args); let record = brief.calls.records[0];
  assert.equal(brief.entry.factsStatus, 'valid');
  assert.deepEqual(record.fact, before.fact);
  assert.equal(record.targetNavigation.status, 'changed'); assert.equal(record.targetNavigation.location, null);
  const refreshed = extractFacts(args.root, { language: 'ts' }).facts;
  record = buildQuestion({ ...args, facts: refreshed }).calls.records[0];
  assert.equal(record.targetNavigation.status, 'valid'); assert.equal(record.targetNavigation.location.line, 2);
  fs.unlinkSync(path.join(args.root, 'target.mjs'));
  record = buildQuestion({ ...args, facts: refreshed }).calls.records[0];
  assert.equal(record.targetNavigation.status, 'missing'); assert.equal(record.targetNavigation.location, null);
  fs.writeFileSync(path.join(args.root, 'target.mjs'), 'export function helper( {');
  const broken = extractFacts(args.root, { language: 'ts' }).facts;
  assert.equal(buildQuestion({ ...args, facts: broken }).calls.records[0].targetNavigation.status, 'unresolved');
});

test('captured target parse errors or missing source evidence never expose current navigation', (t) => {
  const args = fixture(t, { 'entry.mjs': 'import { helper } from "./target.mjs";\nfunction chosen() { helper(); }', 'target.mjs': 'export function helper() {}' });
  const broken = structuredClone(args.facts); broken.parse_errors = [{ path: 'target.mjs', message: 'captured parse failure' }];
  let record = buildQuestion({ ...args, facts: broken }).calls.records[0];
  assert.equal(record.targetNavigation.status, 'parse-error'); assert.equal(record.targetNavigation.location, null);
  const absent = structuredClone(args.facts); absent.files = absent.files.filter((f) => f.path !== 'target.mjs');
  const brief = buildQuestion({ ...args, facts: absent }); record = brief.calls.records[0];
  assert.equal(record.targetNavigation.status, 'unverifiable'); assert.equal(record.targetNavigation.location, null);
  assert.equal(brief.imports[0].target.currentStatus, 'not-checked');
});

test('imported target schema and references reject missing file, parse errors and absent import edges', (t) => {
  const args = fixture(t, { 'entry.mjs': 'import { helper } from "./target.mjs"; helper();', 'target.mjs': 'export function helper() {}' });
  const bad = (mutate) => { const facts = structuredClone(args.facts); mutate(facts); assert.ok(schemaErrors('raw-facts', facts).length); };
  bad((f) => { delete f.calls[0].target.file; });
  bad((f) => { f.calls[0].target.file = 'absent.mjs'; });
  bad((f) => { f.calls[0].target.line = 999; });
  bad((f) => { f.parse_errors = [{ path: 'target.mjs', message: 'broken' }]; });
  bad((f) => { f.imports = []; });
  bad((f) => { f.calls[0].resolution = 'same-file-function'; });
});


test('default references follow ordinary same-module functions and local default aliases without following shadows', t => {
 const args=fixture(t,{
  'entry.mjs':'import plain from "./plain.mjs";import {default as alias} from "./alias.mjs";function chosen(){plain();alias();}function shadow(plain){plain();}',
  'plain.mjs':'export default later; function later(){}',
  'alias.mjs':'function earlier(){} export {earlier as default};',
 });
 const imported=args.facts.calls.filter(c=>c.file==='entry.mjs'&&c.target);
 assert.deepEqual(imported.map(c=>c.target),[{file:'plain.mjs',name:'later',line:1,column:23},{file:'alias.mjs',name:'earlier',line:1,column:1}]);
 assert.equal(args.facts.calls.filter(c=>c.file==='entry.mjs'&&c.resolution==='unresolved').length,1);
 const q=buildQuestion(args);assert.equal(q.calls.bindingCoverage,'declarations-const-initializers-captured-static-imports-and-stable-default-function-references');assert.ok(q.calls.records.every(r=>r.targetNavigation.status==='valid'));
});

test('default references do not claim a function overwritten by assignments, destructuring, loops or opaque eval',t=>{
 const sources={'entry.mjs':''};
 const operations=['f=replacement','[f]=[replacement]','({value:f}={value:replacement})','({f}={f:replacement})','for(f of [replacement]){}','for(f in {x:1}){}','++f','f++','f&&=replacement','eval("f=replacement")'];
 operations.forEach((op,i)=>{sources[`target${i}.mjs`]=`function f(){} function replacement(){} ${op}; export default f;`;sources['entry.mjs']+=`import run${i} from './target${i}.mjs';run${i}();`;});
 sources['live.mjs']='function f(){}function replacement(){}f=replacement;export {f as default};';sources['entry.mjs']+='import live from "./live.mjs";live();';
 const {facts}=fixture(t,sources);assert.ok(facts.calls.filter(c=>c.file==='entry.mjs').every(c=>c.resolution==='unresolved'));
});

test('writes to a different lexical binding or function property do not hide a stable default reference',t=>{
 const args=fixture(t,{'entry.mjs':'import f from "./target.mjs";function chosen(){f();}','target.mjs':'function f(){}function unused(f){f=()=>{};}f.extra=1;export default f;'});
 assert.deepEqual(args.facts.calls.find(c=>c.file==='entry.mjs').target,{file:'target.mjs',name:'f',line:1,column:1});
});

test('default-reference additions retain historical v1/v2 saved coverage without relabeling it',t=>{
 const args=fixture(t,{'entry.mjs':'import f from "./target.mjs";function chosen(){f();}','target.mjs':'function f(){}export default f;'});
 for(const model of ['js-ts-lexical-v1','js-ts-lexical-v2']){
  const historical=structuredClone(args.facts);historical.callModel=model;historical.calls=historical.calls.map(c=>c.file==='entry.mjs'?{file:c.file,line:c.line,column:c.column,endLine:c.endLine,endColumn:c.endColumn,resolution:'unresolved',reason:'no-local-function-binding'}:c);
  const q=buildQuestion({...args,facts:historical});assert.equal(q.calls.coverage,'available');assert.equal(q.calls.records[0].fact.resolution,'unresolved');assert.ok(!q.calls.bindingCoverage.includes('stable-default'));
 }
});


test('changed ordinary function default references recover foreign callers in fresh paired captures',t=>{
 const files={'entry.mjs':'import run from "./target.mjs";export function chosen(){run();}','target.mjs':'function helper(){return 1;}export default helper;'};
 const before=fixture(t,files),after=fixture(t,{...files,'target.mjs':files['target.mjs'].replace('return 1','return 2')});
 const base=captureChangeSide(before.root,before.config,'ts'),head=captureChangeSide(after.root,after.config,'ts');
 const q=buildChangeQuestion({question:'Which known references reach the changed helper?',entry:'target.mjs',base,head,config:before.config});
 const changed=q.changedDefinitions.items.find(x=>x.head?.definition.name==='helper');
 for(const side of ['base','head']){assert.equal(changed[side].knownReferences.total,1);assert.equal(changed[side].knownReferences.items[0].fact.file,'entry.mjs');assert.equal(changed[side].knownReferences.items[0].navigation.status,'valid');}
});


// Expectations follow the authored tsconfig paths and explicit export syntax,
// independently of the extractor's import-edge implementation.
const aliasConfig = JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@local/*': ['src/*'] } } });
test('captured configured aliases bind ordinary exports with independent lexical shadow checks', t => {
  const args = fixture(t, {
    'tsconfig.json': aliasConfig,
    'entry.ts': 'import run, { named as renamed, arrow } from "@local/target";\nexport function chosen(){run();renamed();arrow();}\nfunction shadow(run){run();}\n{const renamed=()=>{};renamed();}',
    'src/target.ts': 'export default function helper() {}\nexport function named() {}\nexport const arrow=()=>{};',
    'js-entry.mjs': 'import run from "@local/plain.mjs";run();',
    'src/plain.mjs': 'export default function plain(){}',
  });
  const calls = args.facts.calls.filter(c=>c.file==='entry.ts');
  assert.deepEqual(args.facts.calls.find(c=>c.file==='js-entry.mjs').target,{file:'src/plain.mjs',name:'plain',line:1,column:1});
  assert.deepEqual(calls.filter(c=>c.resolution==='imported-function').map(c=>c.target),[
    {file:'src/target.ts',name:'helper',line:1,column:1},
    {file:'src/target.ts',name:'named',line:2,column:1},
    {file:'src/target.ts',name:'arrow',line:3,column:20},
  ]);
  assert.equal(calls.find(c=>c.line===3).resolution,'unresolved');
  assert.equal(calls.find(c=>c.line===4).resolution,'same-file-function-initializer');
  const question=buildQuestion({...args,entry:'entry.ts'});
  assert.ok(question.calls.records.every(c=>c.targetNavigation.status==='valid'));
  assert.deepEqual(schemaErrors('raw-facts',args.facts),[]);
});

test('configured alias target omissions, declarations, type-only imports and re-export hops stay unknown', t => {
  const {facts}=fixture(t,{
    'tsconfig.json':aliasConfig,
    'entry.ts':[
      'import excluded from "@local/excluded";excluded();',
      'import missing from "@local/missing";missing();',
      'import declaration from "@local/declaration";declaration();',
      'import type typed from "@local/target";typed();',
      'import { type named } from "@local/target";named();',
      'import barrel from "@local/barrel";barrel();',
      'import factory from "@local/factory";factory();',
      'import external from "external-package";external();',
      'import broken from "@local/broken";broken();',
    ].join('\n'),
    'src/excluded.ts':'export default function excluded(){}',
    'src/declaration.d.ts':'export default function declaration():void;',
    'src/target.ts':'export default function target(){} export function named(){}',
    'src/barrel.ts':'export {default} from "./target";',
    'src/factory.ts':'const factory=(()=>()=>{})();export default factory;',
    'src/broken.ts':'export default function broken(){} function bad( {',
  },['src/excluded.ts']);
  assert.ok(facts.calls.filter(c=>c.file==='entry.ts').every(c=>c.resolution==='unresolved'));
});

test('changed configured alias target recovers the known foreign caller in each snapshot', t=>{
  const sources={'tsconfig.json':aliasConfig,'entry.ts':'import run from "@local/target";export function chosen(){run();}','src/target.ts':'export default function helper(){return 1;}'};
  const before=fixture(t,sources),after=fixture(t,{...sources,'src/target.ts':sources['src/target.ts'].replace('return 1','return 2')});
  const base=captureChangeSide(before.root,before.config,'ts'),head=captureChangeSide(after.root,after.config,'ts');
  const question=buildChangeQuestion({question:'Where is the changed helper called?',entry:'src/target.ts',base,head,config:before.config});
  const changed=question.changedDefinitions.items.find(x=>x.head?.definition.name==='helper');
  for(const side of ['base','head']){assert.equal(changed[side].knownReferences.total,1);assert.equal(changed[side].knownReferences.items[0].fact.file,'entry.ts');assert.equal(changed[side].knownReferences.items[0].navigation.status,'valid');}
});


test('historical v3 captures retain their relative-only binding coverage', t => {
  const args=fixture(t,{'entry.mjs':'import f from "./target.mjs";function chosen(){f();}','target.mjs':'function f(){}export default f;'});
  const historical=structuredClone(args.facts);historical.callModel='js-ts-lexical-v3';
  const question=buildQuestion({...args,facts:historical});
  assert.equal(question.calls.bindingCoverage,'declarations-const-initializers-relative-imports-and-stable-default-function-references');
  assert.equal(question.calls.records[0].targetNavigation.status,'valid');
});
