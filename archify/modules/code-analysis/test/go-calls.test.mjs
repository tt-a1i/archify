import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractFacts, buildGraph, loadConfig, mergeConfig } from '../lib/analysis.mjs';
import { buildQuestion } from '../lib/explain.mjs';
import { captureChangeSide, buildChangeQuestion } from '../lib/change-question.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

function fixture(t, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-go-calls-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [file, text] of Object.entries({ 'go.mod': 'module example.org/app\n\ngo 1.18\n', ...files })) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); fs.writeFileSync(path.join(root, file), text);
  }
  return root;
}
const scopeConfig = config => mergeConfig(loadConfig(), config || {});
const capture = (root, config) => extractFacts(root, { language: 'go', config: scopeConfig(config) }).facts;
const callsIn = (facts, file) => facts.calls.filter(call => call.file === file);

test('Go native LF ranges preserve bare CR inside raw strings and comments', t => {
  const root = fixture(t, {
    'entry.go': 'package p\n/* a\rb */ func Work() string { return `a\rb` }\nfunc Caller() string { return Work() }\n',
  });
  const facts = capture(root, { go: { stdlib: false } });
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
  const question = buildQuestion({ root, facts, entry: 'entry.go', symbol: 'Caller', question: 'Where is Work?' });
  assert.equal(question.calls.coverage, 'available');
  assert.deepEqual(question.calls.records[0].targetNavigation.location, { file: 'entry.go', name: 'Work', line: 2, column: 11 });
  const config = scopeConfig({ go: { stdlib: false } });
  const base = captureChangeSide(root, config, 'go');
  const headRoot = fixture(t, { 'entry.go': 'package p\n/* a\rb */ func Work() string { return `a\rc` }\nfunc Caller() string { return Work() }\n' });
  const head = captureChangeSide(headRoot, config, 'go');
  const pair = buildChangeQuestion({ root: headRoot, baseRoot: root, base, head, config, entry: 'entry.go', question: 'What changed?' });
  assert.equal(pair.status, 'ready'); assert.equal(pair.changedDefinitions.total, 1);
  assert.equal(pair.changedDefinitions.items[0].head.knownReferences.total, 1);
});

test('Go ordinary and alias imports, same-package cross-file calls and external tests navigate to declaration starts', t => {
  const root = fixture(t, {
    'lib/work.go': 'package lib\nfunc Work() {}\n',
    'lib/other.go': 'package lib\nfunc Other() { Work() }\n',
    'main.go': 'package main\nimport alias "example.org/app/lib"\nfunc main() { alias.Work(); alias.Other() }\n',
    'lib/internal_test.go': 'package lib\nfunc testHelper() {}\nfunc TestInternal() { testHelper(); Work() }\n',
    'lib/work_test.go': 'package lib_test\nimport "example.org/app/lib"\nfunc TestIt() { lib.Work() }\n',
  });
  const facts = capture(root); assert.deepEqual(schemaErrors('raw-facts', facts), []);
  for (const file of ['main.go', 'lib/other.go', 'lib/work_test.go']) {
    const call = callsIn(facts, file)[0]; assert.equal(call.resolution, 'go-direct-function');
    assert.deepEqual(call.target, { file: 'lib/work.go', name: 'Work', line: 2, column: 1 });
  }
  const internalCalls = callsIn(facts, 'lib/internal_test.go');
  assert.equal(internalCalls[0].target.name, 'testHelper'); assert.equal(internalCalls[1].target.name, 'Work');
  const question = buildQuestion({ root, facts, question: 'Follow aliases', entry: 'main.go', symbol: 'main' });
  assert.equal(question.calls.coverage, 'available'); assert.ok(question.calls.records.every(row => row.targetNavigation.status === 'valid'));
  assert.equal(question.scope.languageScope.module, 'example.org/app');
  const graph = buildGraph(facts, {}); assert.equal(graph.modules.length, 2);
  assert.equal(graph.fileModules['lib/work.go'], graph.fileModules['lib/other.go']);
  assert.notEqual(graph.fileModules['main.go'], graph.fileModules['lib/work.go']);
});

test('Go interface/variable calls, shadows and invalid duplicate functions stay unknown beside concrete methods', t => {
  const root = fixture(t, {
    'lib/work.go': 'package lib\nfunc Work() {}\nfunc Clash() {}\nvar Clash func()\n',
    'main.go': `package main
import alias "example.org/app/lib"
type I interface { Work() }
type S struct{}
func (S) Work() {}
var callback = alias.Work
func use(i I, s S) { i.Work(); s.Work(); callback(); alias.Clash() }
func shadow() { alias := struct{ Work func() }{}; alias.Work() }
`,
  });
  const facts = capture(root); assert.deepEqual(schemaErrors('raw-facts', facts), []);
  const calls = callsIn(facts, 'main.go');
  assert.equal(calls[1].resolution, 'go-direct-method');
  assert.deepEqual(calls[1].target, { name: 'Work', line: 5, column: 1 });
  assert.equal(calls[0].resolution, 'go-interface-method');
  assert.deepEqual(calls[0].target, { name: 'Work', line: 3, column: 20 });
  assert.ok(calls.filter((_, i) => i > 1).every(call => call.resolution === 'unresolved'));
  assert.ok(facts.languageScope.typing.errorCount > 0);
});

test('Go source scope honors platform/tags, tests and nested module identity; parse failure is visible', t => {
  const root = fixture(t, {
    'a_linux.go': 'package app\nfunc Platform() {}\n',
    'a_windows.go': 'package app\nfunc Platform() {}\n',
    'custom.go': '//go:build extra\n\npackage app\nfunc Extra() {}\n',
    'entry.go': 'package app\nfunc Entry() { Platform() }\n',
    'bad.go': 'package app\nfunc Broken( {\n',
    'entry_test.go': 'package app\nfunc TestEntry() { Entry() }\n',
    'nested/go.mod': 'module other.org/nested\n', 'nested/main.go': 'package nested\nfunc Hidden() {}\n',
  });
  const facts = capture(root, { include: ['**/*.go'], exclude: [], go: { goos: 'linux', goarch: 'amd64', tests: false, tags: [] } });
  assert.deepEqual(schemaErrors('raw-facts', facts), []); assert.equal(facts.parse_errors[0].path, 'bad.go');
  assert.equal(callsIn(facts, 'entry.go')[0].resolution, 'unresolved');
  const excluded = new Map(facts.languageScope.excludedFiles.map(row => [row.file, row.reason]));
  assert.equal(excluded.get('a_windows.go'), 'build-conditions-or-filename');
  assert.equal(excluded.get('custom.go'), 'build-conditions-or-filename');
  assert.equal(excluded.get('entry_test.go'), 'tests-disabled');
  assert.equal(excluded.get('nested/main.go'), 'nested-module-not-loaded');
  assert.deepEqual(Object.fromEntries(['goos', 'goarch', 'cgo', 'goWork', 'replace', 'tags', 'tests'].map(key => [key, facts.languageScope.build[key]])), { goos: 'linux', goarch: 'amd64', cgo: false, goWork: 'not-loaded', replace: 'not-loaded', tags: [], tests: false });
  assert.ok(facts.languageScope.build.releaseTags.includes('go1.18'));
  assert.equal(facts.languageScope.build.goFlags, 'not-loaded');
  fs.unlinkSync(path.join(root, 'bad.go'));
  const tagged = capture(root, { include: ['**/*.go'], exclude: [], go: { goos: 'windows', tags: ['extra'] } });
  assert.ok(tagged.files.some(file => file.path === 'custom.go'));
  assert.equal(callsIn(tagged, 'entry.go')[0].target.file, 'a_windows.go');
});

test('Go imported module identity differs from directory names and package-declared names', t => {
  const root = fixture(t, { 'local/work.go': 'package different\nfunc Work() {}\n',
    'entry.go': 'package app\nimport "example.org/app/local"\nimport bad "wrong.org/app/local"\nfunc Entry() { different.Work(); bad.Work() }\n' });
  const facts = capture(root); const calls = callsIn(facts, 'entry.go');
  assert.equal(calls[0].target.file, 'local/work.go'); assert.equal(calls[1].resolution, 'unresolved');
  assert.ok(facts.languageScope.typing.externalPackagesNotLoaded.includes('wrong.org/app/local'));
});

test('Go UTF-16 ranges, saved metadata freshness and paired changed-definition callers reuse source evidence', t => {
  const root = fixture(t, { 'lib/work.go': 'package lib\nfunc Work() { _ = "😀"; println("x"); }\n',
    'entry.go': 'package app\nimport "example.org/app/lib"\nfunc Entry() { lib.Work() }\n' });
  const facts = capture(root); assert.deepEqual(schemaErrors('raw-facts', facts), []);
  const unicodeCall = callsIn(facts, 'lib/work.go')[0];
  assert.equal(unicodeCall.column, fs.readFileSync(path.join(root, 'lib/work.go'), 'utf8').split('\n')[1].indexOf('println') + 1);
  const base = captureChangeSide(root, scopeConfig({ include: ['**/*.go'], exclude: [] }), 'go');
  fs.writeFileSync(path.join(root, 'lib/work.go'), 'package lib\nfunc Work() { _ = "😀"; println("changed"); }\n');
  const headRoot = fixture(t, { 'lib/work.go': fs.readFileSync(path.join(root, 'lib/work.go'), 'utf8'),
    'entry.go': fs.readFileSync(path.join(root, 'entry.go'), 'utf8') });
  // Keep base sources fresh for paired navigation.
  fs.writeFileSync(path.join(root, 'lib/work.go'), 'package lib\nfunc Work() { _ = "😀"; println("x"); }\n');
  const head = captureChangeSide(headRoot, scopeConfig({ include: ['**/*.go'], exclude: [] }), 'go');
  const paired = buildChangeQuestion({ question: 'What references changed Work?', entry: 'lib/work.go', base, head, config: scopeConfig({ include: ['**/*.go'], exclude: [] }) });
  const change = paired.changedDefinitions.items.find(row => row.head.definition.name === 'Work');
  assert.equal(change.head.knownReferences.total, 1); assert.equal(change.head.knownReferences.items[0].navigation.location.file, 'entry.go');
  fs.writeFileSync(path.join(root, 'go.mod'), 'module wrong.org/app\n');
  const question = buildQuestion({ root, facts, question: 'Follow Work', entry: 'entry.go', symbol: 'Entry' });
  assert.equal(question.calls.coverage, 'unavailable'); assert.equal(question.entry.factsStatus, 'resolution-input-changed');
});


test('Go missing compiler and invalid scope fail through the normal CLI with actionable diagnostics', t => {
  const root = fixture(t, { 'entry.go': 'package app\nfunc Work() {}\n' });
  const check = fileURLToPath(new URL('../bin/check.mjs', import.meta.url));
  const missing = spawnSync(process.execPath, [check, root, '--language', 'go', '--fail-on', 'never', '--json'], {
    encoding: 'utf8', env: { ...process.env, ARCHIFY_GO: path.join(root, 'missing-go') },
  });
  assert.equal(missing.status, 2); const error = JSON.parse(missing.stdout);
  assert.equal(error.diagnostics[0].code, 'extract/go-unavailable');
  assert.ok(error.diagnostics[0].supportedFixes.some(fix => fix.includes('Go 1.26+')));
  assert.throws(() => capture(root, { go: { tags: 'wrong' } }), error => error.diagnostics?.[0].code === 'extract/go-config-invalid');
});

test('Go compiler-selected concrete methods distinguish receivers and follow aliases, promotion, generic instances and method expressions', t => {
  const root=fixture(t,{
    'lib/types.go': 'package lib\ntype T struct{}\nfunc (*T) M(){}\ntype U struct{}\nfunc (*U) M(){}\ntype Wrapper struct{*T}\ntype G[P any] struct{}\nfunc (*G[P]) M(){}\ntype Alias = T\n',
    'entry.go': 'package app\nimport "example.org/app/lib"\nfunc Entry(t *lib.T,u *lib.U,w lib.Wrapper,g *lib.G[int],a *lib.Alias){t.M();u.M();w.M();g.M();a.M();(*lib.T).M(t)}\n',
  });
  const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
  const calls=callsIn(facts,'entry.go');
  assert.ok(calls.every(c=>c.resolution==='go-direct-method'));
  assert.deepEqual(calls.map(c=>c.target),[
    {file:'lib/types.go',name:'M',line:3,column:1},
    {file:'lib/types.go',name:'M',line:5,column:1},
    {file:'lib/types.go',name:'M',line:3,column:1},
    {file:'lib/types.go',name:'M',line:8,column:1},
    {file:'lib/types.go',name:'M',line:3,column:1},
    {file:'lib/types.go',name:'M',line:3,column:1},
  ]);
  const q=buildQuestion({root,facts,entry:'entry.go',symbol:'Entry',question:'Where are these concrete methods defined?'});
  assert.equal(q.calls.bindingCoverage,'go-types-direct-functions-concrete-methods-and-interface-declarations-with-recorded-sdk-and-incomplete-thirdparty-types');
  assert.ok(q.calls.records.every(r=>r.targetNavigation.status==='valid'));
});

test('Go method targets do not guess through interfaces, function fields, missing bodies or duplicate receiver methods', t => {
  const root=fixture(t,{
    'entry.go':`package app
 type T struct{}
 func (*T) M(){}
 func (*T) M(){}
 type I interface{M()}
 type Embedded struct{I}
 type Holder struct{M func()}
 type NoBody struct{}
 func (*NoBody) M()
 func Entry(t *T,i I,h Holder,n *NoBody,e Embedded){t.M();i.M();h.M();n.M();e.M()}
 func Param[P I](p P){p.M()}
`,
  });
  const facts=capture(root);assert.ok(facts.languageScope.typing.errorCount>0);
  const calls=callsIn(facts,'entry.go');
  assert.equal(calls[1].resolution,'go-interface-method');
  assert.deepEqual(calls[1].target,{name:'M',line:5,column:19});
  assert.equal(calls[1].receiverPromotion,undefined);
  assert.equal(calls[4].resolution,'go-interface-method');
  assert.deepEqual(calls[4].target,{name:'M',line:5,column:19});
  assert.equal(calls[4].receiverPromotion,'embedded-interface');
  assert.equal(calls[4].receiverInterface.qualname,'I');
  assert.ok(calls.filter((_,i)=>i!==1&&i!==4).every(c=>c.resolution==='unresolved'));
});

test('Go changed concrete method definitions recover foreign callers and keep historical v1 coverage distinct',t=>{
  const files={'lib/types.go':'package lib\ntype T struct{}\nfunc (*T) M(){println(1)}\n','entry.go':'package app\nimport "example.org/app/lib"\nfunc Entry(t *lib.T){t.M()}\n'};
  const root=fixture(t,files),headRoot=fixture(t,{...files,'lib/types.go':files['lib/types.go'].replace('println(1)','println(2)')});
  const config=scopeConfig();const base=captureChangeSide(root,config,'go'),head=captureChangeSide(headRoot,config,'go');
  const q=buildChangeQuestion({question:'Which known callers reach changed T.M?',entry:'lib/types.go',base,head,config});
  const changed=q.changedDefinitions.items.find(d=>d.head?.definition.qualname==='*T.M');
  for(const side of ['base','head']){assert.equal(changed[side].knownReferences.total,1);assert.equal(changed[side].knownReferences.items[0].navigation.status,'valid');}
  const incompatible=structuredClone(base.facts);incompatible.callModel='go-source-direct-v1';assert.ok(schemaErrors('raw-facts',incompatible).some(e=>e.message.includes('Go v2')));
  const historical=structuredClone(base.facts);historical.callModel='go-source-direct-v1';historical.calls=historical.calls.map(c=>c.resolution==='go-direct-method'?{file:c.file,line:c.line,column:c.column,endLine:c.endLine,endColumn:c.endColumn,resolution:'unresolved',reason:'go-method-dispatch'}:c);
  const old=buildQuestion({root,facts:historical,entry:'entry.go',symbol:'Entry',question:'What was captured before method support?'});
  assert.equal(old.calls.bindingCoverage,'go-types-direct-source-functions-with-incomplete-external-types');
  assert.equal(old.calls.records[0].targetNavigation.status,'unresolved');
});


test('Go SDK types recover explicit local receivers without binding SDK bodies or interface implementations',t=>{
 const root=fixture(t,{'entry.go':`package app
import ("net/http";"sync")
type Context struct{}
func (*Context) Reset(){}
var pool sync.Pool
func Entry(r *http.Request){c,_:=r.Context().Value("key").(*Context);c=pool.Get().(*Context);c.Reset();var h http.Handler;h.ServeHTTP(nil,r);http.NotFound(nil,r)}
`});
 const before=capture(root,{go:{stdlib:false}}),facts=capture(root);
 const reset=f=>callsIn(f,'entry.go').find(c=>c.target?.name==='Reset');
 assert.equal(reset(before),undefined);assert.deepEqual(reset(facts).target,{name:'Reset',line:4,column:1});
 assert.equal(facts.callModel,'go-source-direct-v6');assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 assert.equal(facts.languageScope.typing.errorCount,0);assert.equal(facts.files.length,1);
 assert.equal(before.languageScope.standardLibrary.mode,'disabled');
 const disabledQuestion=buildQuestion({root,facts:before,entry:'entry.go',symbol:'Entry',question:'What remains unknown without SDK types?'});
 assert.equal(disabledQuestion.calls.bindingCoverage,'go-types-direct-functions-concrete-methods-and-interface-declarations-with-sdk-types-disabled');
 const sdk=facts.languageScope.standardLibrary;assert.equal(sdk.mode,'compiler-exports');
 assert.ok(sdk.packages.some(p=>p.path==='net/http'&&p.sha256.length===64&&p.bytes>0));
 assert.ok(sdk.packages.some(p=>p.path==='sync'));assert.equal(sdk.sourceFilesAnalyzed,false);assert.equal(sdk.projectCommands,true);
 const calls=callsIn(facts,'entry.go');assert.equal(calls.at(-2).resolution,'unresolved');assert.equal(calls.at(-1).resolution,'unresolved');
 assert.ok(!facts.languageScope.typing.externalPackagesNotLoaded.includes('net/http'));
 const historical=structuredClone(facts);historical.callModel='go-source-direct-v2';delete historical.languageScope.standardLibrary;
 const q=buildQuestion({root,facts:historical,entry:'entry.go',symbol:'Entry',question:'Read the earlier concrete-method capture contract'});
 assert.equal(q.calls.bindingCoverage,'go-types-direct-functions-and-concrete-methods-with-incomplete-external-types');
 assert.ok(q.calls.records.some(r=>r.fact.target?.name==='Reset'&&r.targetNavigation.status==='valid'));
});

test('Go SDK unsafe is an intrinsic type package; bad SDK scopes fail explicitly and can select captured-only mode',t=>{
 const root=fixture(t,{'entry.go':'package app\nimport "unsafe"\ntype T struct{}\nfunc (*T) M(){}\nfunc Entry(p unsafe.Pointer){(*T)(p).M()}\n'});
 const facts=capture(root);assert.equal(facts.languageScope.typing.errorCount,0);
 assert.deepEqual(facts.languageScope.standardLibrary.intrinsicPackages,['unsafe']);
 assert.ok(callsIn(facts,'entry.go').some(c=>c.target?.name==='M'));
 assert.throws(()=>capture(root,{go:{stdlib:'yes'}}),e=>e.diagnostics?.[0].code==='extract/go-config-invalid');
 const other=fixture(t,{'entry.go':'package app\nimport "sync"\nvar P sync.Pool\n'});
 assert.throws(()=>capture(other,{go:{goos:'madeup'}}),e=>e.diagnostics?.[0].code==='extract/go-failed'&&e.diagnostics[0].supportedFixes.some(f=>f.includes('stdlib: false')));
});


test('Go SDK intrinsic typing uses the declared architecture size, including raw-string imports',t=>{
 const root=fixture(t,{'entry.go':'package app\nimport `unsafe`\nvar _ [4 - unsafe.Sizeof(uintptr(0))]byte\n'});
 const narrow=capture(root,{go:{goos:'linux',goarch:'386'}}),wide=capture(root,{go:{goos:'linux',goarch:'amd64'}});
 assert.equal(narrow.languageScope.typing.errorCount,0);assert.ok(wide.languageScope.typing.errorCount>0);
 assert.deepEqual(narrow.languageScope.standardLibrary.intrinsicPackages,['unsafe']);
 assert.equal(narrow.languageScope.build.goarch,'386');assert.equal(narrow.files.length,1);
});

test('Go changed concrete methods list direct calls and interface candidates with full method-set evidence', t => {
  const base = fixture(t, { 'main.go': `package app
type I interface { M() }
type A struct{}
func (A) M(){ println(1) }
type B struct{}
func (*B) M(){}
type C struct{}
func (C) M(int){}
func Use(i I, a A, b B, c C){ i.M(); a.M(); b.M(); c.M(1) }
` });
  const head = fixture(t, { 'main.go': `package app
type I interface { M() }
type A struct{}
func (A) M(){ println(2) }
type B struct{}
func (*B) M(){}
type C struct{}
func (C) M(int){}
func Use(i I, a A, b B, c C){ i.M(); a.M(); b.M(); c.M(1) }
` });
  const config = scopeConfig();
  const question = buildChangeQuestion({ question: 'Which callers reach changed A.M?', entry: 'main.go', base: captureChangeSide(base, config, 'go'), head: captureChangeSide(head, config, 'go'), config });
  const changed = question.changedDefinitions.items.find(row => row.head?.definition.qualname === 'A.M');
  assert.equal(changed.head.knownReferences.total, 1);
  assert.equal(changed.head.interfaceCandidates.coverage, 'available');
  assert.equal(changed.head.interfaceCandidates.total, 1);
  const candidate = changed.head.interfaceCandidates.items[0];
  assert.equal(candidate.fact.line, 9);
  assert.equal(candidate.interface.qualname, 'I');
  assert.equal(candidate.interfaceMethod.qualname, 'I.M');
  assert.equal(candidate.runtimeTarget, 'not-determined');
  assert.deepEqual(candidate.implementations.items.map(row => `${row.type.qualname}:${row.valueSatisfies}:${row.pointerSatisfies}`).sort(), ['A:true:true', 'B:false:true']);
  assert.ok(!candidate.implementations.items.some(row => row.type.qualname === 'C'));
});

test('Go pointer-only implementations are labelled by *T and stay candidates for the changed value method', t => {
  const source = body => `package app
type I interface { M() }
type A struct{}
func (A) M(){}
type B struct{}
func (*B) M(){ println(${body}) }
func Use(i I, a A, b *B){ i.M(); a.M(); b.M() }
`;
  const base = fixture(t, { 'main.go': source(1) }), head = fixture(t, { 'main.go': source(2) });
  const config = scopeConfig();
  const question = buildChangeQuestion({ question: 'Which callers reach changed B.M?', entry: 'main.go', base: captureChangeSide(base, config, 'go'), head: captureChangeSide(head, config, 'go'), config });
  const changed = question.changedDefinitions.items.find(row => row.head?.definition.qualname === '*B.M');
  assert.equal(changed.head.knownReferences.total, 1);
  assert.equal(changed.head.interfaceCandidates.total, 1);
  const candidate = changed.head.interfaceCandidates.items[0];
  assert.equal(candidate.changedImplementation.valueSatisfies, false);
  assert.equal(candidate.changedImplementation.pointerSatisfies, true);
  assert.equal(candidate.changedImplementation.methodSet, 'pointer');
  assert.match(candidate.reason, /\*B/);
  assert.equal(candidate.implementations.items.find(row => row.type.qualname === 'A').valueSatisfies, true);
});

test('Go sibling interfaces with the same method name keep candidates separate', t => {
  const source = body => `package app
type G interface { Gather() int }
type TG interface { Gather() (int, func()) }
type R struct{}
func (*R) Gather() int { println(${body}); return 0 }
type Q struct{}
func (*Q) Gather() (int, func()) { return 0, nil }
func Use(g G, tg TG, r *R, q *Q){ g.Gather(); tg.Gather(); r.Gather(); q.Gather() }
`;
  const base = fixture(t, { 'main.go': source(1) }), head = fixture(t, { 'main.go': source(2) });
  const config = scopeConfig();
  const question = buildChangeQuestion({ question: 'Which callers reach changed R.Gather?', entry: 'main.go', base: captureChangeSide(base, config, 'go'), head: captureChangeSide(head, config, 'go'), config });
  const changed = question.changedDefinitions.items.find(row => row.head?.definition.qualname === '*R.Gather');
  assert.equal(changed.head.knownReferences.total, 1);
  assert.equal(changed.head.interfaceCandidates.total, 1);
  assert.equal(changed.head.interfaceCandidates.items[0].interface.qualname, 'G');
  assert.ok(!changed.head.interfaceCandidates.items.some(row => row.interface.qualname === 'TG'));
});

test('Go embedded interfaces and interface-valued wrappers remain explicit alternatives', t => {
  const source = body => `package app
type I interface { M() }
type J interface { I }
type A struct{}
func (A) M(){ println(${body}) }
type Wrap struct{ I }
func Use(j J, i I){ j.M(); i.M() }
`;
  const base = fixture(t, { 'main.go': source(1) }), head = fixture(t, { 'main.go': source(2) });
  const config = scopeConfig();
  const question = buildChangeQuestion({ question: 'Which interface callers reach changed A.M?', entry: 'main.go', base: captureChangeSide(base, config, 'go'), head: captureChangeSide(head, config, 'go'), config });
  const changed = question.changedDefinitions.items.find(row => row.head?.definition.qualname === 'A.M');
  assert.equal(changed.head.interfaceCandidates.total, 2);
  assert.deepEqual(changed.head.interfaceCandidates.items.map(row => row.interface.qualname).sort(), ['I', 'J']);
  const wrapper = changed.head.interfaceCandidates.items[0].implementations.items.find(row => row.type.qualname === 'Wrap');
  assert.equal(wrapper.reason, 'promoted-interface-method');
  assert.equal(wrapper.method, undefined);
  assert.equal(wrapper.promotedDeclaration.qualname, 'I.M');
});

test('Go interface candidates include calls captured in package tests', t => {
  const base = fixture(t, {
    'lib/lib.go': 'package lib\ntype I interface{ M() }\ntype T struct{}\nfunc (T) M(){ println(1) }\n',
    'lib/lib_test.go': 'package lib\nfunc use(i I){ i.M() }\n',
  });
  const head = fixture(t, {
    'lib/lib.go': 'package lib\ntype I interface{ M() }\ntype T struct{}\nfunc (T) M(){ println(2) }\n',
    'lib/lib_test.go': 'package lib\nfunc use(i I){ i.M() }\n',
  });
  const config = scopeConfig();
  const question = buildChangeQuestion({ question: 'Which test callers reach changed T.M?', entry: 'lib/lib.go', base: captureChangeSide(base, config, 'go'), head: captureChangeSide(head, config, 'go'), config });
  const changed = question.changedDefinitions.items.find(row => row.head?.definition.qualname === 'T.M');
  assert.equal(changed.head.knownReferences.total, 0);
  assert.equal(changed.head.interfaceCandidates.total, 1);
  assert.equal(changed.head.interfaceCandidates.items[0].fact.file, 'lib/lib_test.go');
  assert.equal(changed.head.interfaceCandidates.items[0].interface.qualname, 'I');
});

test('Go calls through an external embedded interface keep an unlocated candidate', t => {
 const source = body => `package app
import ("bufio"; "net"; "net/http")
type RW interface { http.Hijacker; Status() int }
type W struct{}
func (W) Status() int { return 200 }
func (W) Hijack() (net.Conn, *bufio.ReadWriter, error) {
  _ = ${body}
  return nil, nil, nil
}
func Use(w RW) { w.Hijack() }
`;
 const config = scopeConfig();
 const base = captureChangeSide(fixture(t, { 'main.go': source(1) }), config, 'go');
 const head = captureChangeSide(fixture(t, { 'main.go': source(2) }), config, 'go');
 const question = buildChangeQuestion({ question: 'Which callers reach changed W.Hijack?', entry: 'main.go', base, head, config });
 const changed = question.changedDefinitions.items.find(row => row.head?.definition.qualname === 'W.Hijack');
 assert.equal(changed.head.knownReferences.total, 0);
 assert.equal(changed.head.interfaceCandidates.total, 1);
 const candidate = changed.head.interfaceCandidates.items[0];
 assert.equal(candidate.fact.file, 'main.go');
 assert.equal(candidate.fact.line, 10);
 assert.equal(candidate.fact.target, undefined,'the external declaration has no captured source target');
 assert.equal(candidate.interface.qualname, 'RW');
 assert.equal(candidate.interfaceMethod.package, 'net/http');
 assert.equal(candidate.interfaceMethod.name, 'Hijack');
 assert.match(candidate.reason, /net\/http/);
 assert.ok(candidate.implementations.items.some(row => row.type.qualname === 'W' && row.method?.qualname === 'W.Hijack'));
});

test('Go wrapper calls promoted from an embedded interface stay interface candidates', t => {
  const source = body => `package app
type I interface { M() }
type A struct{}
func (A) M(){ println(${body}) }
type Wrap struct{ I }
func Use(w Wrap, i I){ w.M(); i.M() }
`;
  const config = scopeConfig();
  const base = captureChangeSide(fixture(t, { 'main.go': source(1) }), config, 'go');
  const head = captureChangeSide(fixture(t, { 'main.go': source(2) }), config, 'go');
  const question = buildChangeQuestion({ question: 'Which interface-reaching callers reach changed A.M?', entry: 'main.go', base, head, config });
  const changed = question.changedDefinitions.items.find(row => row.head?.definition.qualname === 'A.M');
  assert.equal(changed.head.knownReferences.total, 0);
  assert.equal(changed.head.interfaceCandidates.total, 2);
  const wrapper = changed.head.interfaceCandidates.items.find(row => row.fact.receiverPromotion === 'embedded-interface');
  assert.equal(wrapper.fact.file, 'main.go');
  assert.equal(wrapper.interface.qualname, 'I');
  assert.match(wrapper.reason, /embedded field/);
  assert.ok(wrapper.implementations.items.some(row => row.type.qualname === 'Wrap' && row.reason === 'promoted-interface-method'));
});

test('Go captures without interface implementation edges report candidates as unavailable, not zero', t => {
  const source = body => `package app
type I interface { M() }
type A struct{}
func (A) M(){ println(${body}) }
func Use(i I, a A){ i.M(); a.M() }
`;
  const config = scopeConfig();
  const base = captureChangeSide(fixture(t, { 'main.go': source(1) }), config, 'go');
  const head = captureChangeSide(fixture(t, { 'main.go': source(2) }), config, 'go');
  const old = structuredClone(head);
  delete old.facts.interfaceImplementations;
  if (old.facts.languageScope) delete old.facts.languageScope.interfaceEvidence;
  const question = buildChangeQuestion({ question: 'Which callers reach changed A.M?', entry: 'main.go', base, head: old, config });
  assert.equal(question.status, 'partial');
  assert.ok(question.comparison.reasons.some(reason => reason.code === 'interface-implementation-evidence-unavailable' && reason.side === 'head'));
  const changed = question.changedDefinitions.items.find(row => row.head?.definition.qualname === 'A.M');
  assert.equal(changed.head.knownReferences.total, 1);
  assert.equal(changed.head.interfaceCandidates.coverage, 'unavailable');
  assert.equal(changed.head.interfaceCandidates.reason, 'interface-implementation-evidence-not-captured');
  assert.equal(changed.head.interfaceCandidates.total, null);
});

test('Go interface method declaration changes pair with interface-typed call sites', t => {
  const baseRoot = fixture(t, { 'main.go': 'package app\ntype I interface { Work() }\nfunc Use(i I) { i.Work() }\n' });
  const headRoot = fixture(t, { 'main.go': 'package app\ntype I interface { Work(int) }\nfunc Use(i I) { i.Work(1) }\n' });
  const config = scopeConfig();
  const base = captureChangeSide(baseRoot, config, 'go'), head = captureChangeSide(headRoot, config, 'go');
  const q = buildChangeQuestion({ question: 'Which callers use I.Work?', entry: 'main.go', base, head, config });
  const change = q.changedDefinitions.items.find(d => d.head?.definition.kind === 'InterfaceMethod' && d.head.definition.qualname === 'I.Work');
  assert.ok(change);
  assert.equal(change.head.knownReferences.total, 1);
  assert.equal(change.head.knownReferences.items[0].navigation.status, 'valid');
  assert.equal(change.head.knownReferences.items[0].navigation.location.file, 'main.go');
});

test('Go direct caller identifies the innermost enclosing function or method', t => {
  const root = fixture(t, { 'main.go': `package app
type T struct{}
func (T) M(){}
func Use(t T){
  t.M()
  f := func(){ t.M() }
  f()
}
func (T) Caller(t T){
  t.M()
}
` });
  const facts = capture(root, { go: { stdlib: false } });
  assert.deepEqual(schemaErrors('raw-facts', facts), []);
  const calls = callsIn(facts, 'main.go').filter(call => call.resolution === 'go-direct-method');
  assert.deepEqual(calls.map(call => call.directCaller), [
    { file: 'main.go', name: 'Use', qualname: 'Use', kind: 'function', line: 4, column: 1 },
    { file: 'main.go', name: 'Use', qualname: 'Use', kind: 'function', line: 4, column: 1 },
    { file: 'main.go', name: 'Caller', qualname: 'T.Caller', kind: 'method', line: 9, column: 1 },
  ]);
});

test('Go changed interface methods list captured implementations without claiming dispatch', t => {
  const base = fixture(t, { 'main.go': `package app
type I interface { M() }
type A struct{}
func (A) M(){}
type B struct{}
func (*B) M(){}
type C struct{}
func (C) M(int){}
func Use(i I){ i.M() }
` });
  const head = fixture(t, { 'main.go': `package app
type I interface { M() error }
type A struct{}
func (A) M() error { return nil }
type B struct{}
func (*B) M() error { return nil }
type C struct{}
func (C) M(int){}
func Use(i I){ i.M() }
` });
  const config = scopeConfig();
  const question = buildChangeQuestion({ question: 'Which implementations satisfy changed I.M?', entry: 'main.go', base: captureChangeSide(base, config, 'go'), head: captureChangeSide(head, config, 'go'), config });
  const changed = question.changedDefinitions.items.find(row => row.head?.definition.qualname === 'I.M');
  assert.ok(changed, 'the changed interface method is a definition');
  assert.equal(changed.head.knownReferences.total, 1);
  const candidates = changed.head.interfaceCandidates;
  assert.equal(candidates.coverage, 'available');
  assert.equal(candidates.total, 0);
  assert.equal(candidates.runtimeTarget, 'not-determined');
  assert.deepEqual(candidates.implementations.items.map(row => row.implementation.type.qualname).sort(), ['A', 'B']);
  assert.equal(candidates.implementations.items.find(row => row.implementation.type.qualname === 'B').implementation.pointerSatisfies, true);
  assert.ok(!candidates.implementations.items.some(row => row.implementation.type.qualname === 'C'));
});
