import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { extractFacts, loadConfig, mergeConfig, buildGraph, evaluateGraph } from '../lib/analysis.mjs';
import { buildQuestion } from '../lib/explain.mjs';
import { captureChangeSide, buildChangeQuestion } from '../lib/change-question.mjs';
import { buildTask } from '../lib/task.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';
function fixture(t,files,edition='2021'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'archify-rust-calls-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 for(const[file,text]of Object.entries({'Cargo.toml':`[package]\nname="sample"\nversion="0.1.0"\nedition="${edition}"\n[features]\ndefault=[]\nchosen=[]\n`,...files})){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text)}return root;
}
const config=overrides=>mergeConfig(loadConfig(),{rust:{offline:true},...overrides});
const capture=(root,overrides)=>extractFacts(root,{language:'rust',config:config(overrides)}).facts;
const calls=(facts,file)=>facts.calls.filter(call=>call.file===file);

test('Rust crate paths, module use aliases and block-use hoisting navigate to exact definitions',t=>{
 const root=fixture(t,{'src/lib.rs':'mod util;\nuse crate::util::work as run;\npub fn caller(){ run(); util::work(); }\npub fn local(){ run(); use crate::util::work as run; }\n','src/util.rs':'pub fn work() {}\n'});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 assert.ok(calls(facts,'src/lib.rs').every(c=>c.resolution==='rust-direct-function'));
 assert.deepEqual(calls(facts,'src/lib.rs')[0].target,{file:'src/util.rs',name:'work',line:1,column:1});
 assert.ok(facts.imports.some(i=>i.from==='src/lib.rs'&&i.to==='src/util.rs'&&i.line===2));
 const question=buildQuestion({root,facts,entry:'src/lib.rs',symbol:'caller',question:'Where is work?'});assert.equal(question.calls.coverage,'available');assert.ok(question.calls.records.every(r=>r.targetNavigation.status==='valid'));
});

test('Rust editions preserve root vs local use namespaces and value names do not shadow modules',t=>{
 for(const edition of ['2015','2018','2021']){
  const root=fixture(t,{'src/lib.rs':'mod a { pub fn run(){} }\nmod b { pub mod a { pub fn run(){} } use a::run; pub fn caller(){run();} }\nfn value(){let a=0;a::run();}\n'},edition);
  const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);const selected=calls(facts,'src/lib.rs').find(c=>c.line===2);assert.equal(selected.target.line,edition==='2015'?1:2);assert.equal(calls(facts,'src/lib.rs').find(c=>c.line===3).target.line,1);
 }
});

test('Rust lexical values, patterns, generic/trait methods and macros keep unsupported dispatch unknown',t=>{
 const root=fixture(t,{'src/lib.rs':`pub fn run(){}
trait T{fn method();}
fn parameter(run:fn()){run();}
fn shadow(){let run=||{};run();}
fn pattern(value:Option<fn()>){if let Some(run)=value {run();}}
fn generic<F:T>(){F::method();}
fn methods(value:&str){value.len();}
fn macros(){unknown!();}
mod util{pub fn run()->u8{0}}
fn nested_use(){let run=||0u16;{use crate::util::run;let _:u8=run();}}
`});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 for(const line of [3,4,5,6,7,8])assert.ok(calls(facts,'src/lib.rs').filter(c=>c.line===line).every(c=>c.resolution==='unresolved'),`line ${line}`);
 assert.equal(calls(facts,'src/lib.rs').find(c=>c.line===10&&c.target)?.target.line,9);
});

test('Rust cfg profile, unknown build flags and path attributes preserve target boundaries',t=>{
 const root=fixture(t,{'src/lib.rs':'mod outer;\n#[cfg(feature="chosen")] mod yes;\n#[cfg(not(feature="chosen"))] mod no;\n#[cfg(build_generated)] mod generated;\npub fn caller(){outer::call();}\n','src/outer.rs':'#[path="right.rs"] mod picked;\npub fn call(){picked::work();}\n','src/right.rs':'pub fn work(){}\n','src/outer/right.rs':'pub fn wrong(){}\n','src/yes.rs':'pub fn selected(){}\n','src/no.rs':'pub fn fallback(){}\n','src/generated.rs':'pub fn generated(){}\n'});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);assert.equal(calls(facts,'src/outer.rs')[0].target.file,'src/right.rs');assert.ok(facts.files.some(f=>f.path==='src/no.rs'));assert.ok(!facts.files.some(f=>f.path==='src/yes.rs'));
 const selected=capture(root,{rust:{offline:true,features:{sample:['chosen']}}});assert.ok(selected.files.some(f=>f.path==='src/yes.rs'));assert.ok(!selected.files.some(f=>f.path==='src/no.rs'));
 assert.ok(facts.languageScope.excludedRegions.length>0);
});

test('Rust workspace dependency aliases point to the actual library crate rather than adjacent files',t=>{
 const root=fixture(t,{'Cargo.toml':'[workspace]\nmembers=["api","app"]\nresolver="2"\n','api/Cargo.toml':'[package]\nname="real-api"\nversion="0.1.0"\nedition="2021"\n','api/src/lib.rs':'pub fn work(){}\n','app/Cargo.toml':'[package]\nname="app"\nversion="0.1.0"\nedition="2021"\n[dependencies]\nrenamed={package="real-api",path="../api"}\n','app/src/lib.rs':'pub fn caller(){renamed::work();}\n'});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);assert.equal(calls(facts,'app/src/lib.rs')[0].target.file,'api/src/lib.rs');
});

test('Rust UTF16/source hashes, fresh paired references and metadata changes reuse investigation evidence',t=>{
 const text='pub fn work(){let _="😀";}\npub fn caller(){work();}\n';const root=fixture(t,{'src/lib.rs':text});const cfg=config();const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const base=captureChangeSide(root,cfg,'rust');const headRoot=fixture(t,{'src/lib.rs':text.replace('"😀"','"😀 changed"')});const head=captureChangeSide(headRoot,cfg,'rust');const paired=buildChangeQuestion({question:'Known callers?',entry:'src/lib.rs',base,head,config:cfg});const changed=paired.changedDefinitions.items.find(row=>row.head.definition.name==='work');assert.equal(changed.head.knownReferences.total,1);
 fs.appendFileSync(path.join(root,'Cargo.toml'),'\n# changed manifest\n');const q=buildQuestion({root,facts,entry:'src/lib.rs',symbol:'caller',question:'Fresh?'});assert.equal(q.calls.coverage,'unavailable');assert.equal(q.entry.factsStatus,'resolution-input-changed');
});

test('Rust unknown conditional imports and duplicate block aliases never select an arbitrary target',t=>{
 const root=fixture(t,{'src/lib.rs':`mod a{pub fn run(){}}
mod b{pub fn run(){}}
pub fn run(){}
fn conditional(){#[cfg(build_unknown)] use crate::a::run;run();}
fn duplicate(){use crate::a::run;use crate::b::run;run();}
mod unknown{#[cfg(build_unknown)] use crate::a::*;pub fn caller(){run();}}
`});const facts=capture(root);
 for(const line of [4,5,6])assert.equal(calls(facts,'src/lib.rs').find(c=>c.line===line).resolution,'unresolved');
});

test('Rust cfg_attr path selection and opaque attribute macros do not invent expanded targets',t=>{
 const root=fixture(t,{'src/lib.rs':'#[cfg_attr(feature="chosen",path="yes.rs")] mod selected;\n#[unknown_attribute]pub fn generated(){}\npub fn caller(){selected::work();generated();}\n','src/selected.rs':'pub fn work(){}\n','src/yes.rs':'pub fn work(){}\n'});
 for(const [features,file]of [[[], 'src/selected.rs'],[['chosen'],'src/yes.rs']]){
  const facts=capture(root,{rust:{offline:true,features:{sample:features}}});const body=calls(facts,'src/lib.rs').filter(c=>c.line===3);assert.equal(body[0].target.file,file);assert.equal(body[1].resolution,'unresolved');assert.ok(facts.languageScope.opaqueMacros.some(x=>x.kind==='attribute-expansion'));
 }
});


test('Rust structural source cycles do not claim runtime partial initialization or force a load-order fix',t=>{
 const root=fixture(t,{'src/lib.rs':'mod a;mod b;\n','src/a.rs':'use crate::b::work_b;\npub fn work_a(){}\npub fn call(){work_b();}\n','src/b.rs':'use crate::a::work_a;\npub fn work_b(){}\npub fn call(){work_a();}\n'});
 const facts=capture(root),cfg=config(),graph=buildGraph(facts,cfg),findings=evaluateGraph(graph,cfg,facts);
 const cycles=findings.diagnostics.filter(d=>d.code==='coupling/import-cycle');assert.ok(cycles.length);
 assert.ok(cycles.every(d=>d.severity==='info'&&d.evidence.kind==='structural'&&d.evidence.risk.loading==='not-assessed'));
 assert.ok(cycles.every(d=>!d.message.includes('accesses to partially initialized')));
 const task=buildTask({findings,facts,ids:[cycles[0].id]});assert.equal(task.title,'Review the Rust structural dependency cycle');assert.ok(task.impact[0].statement.includes('compile-time'));assert.ok(task.acceptance.some(text=>text.includes('intentionally retained')));
});

// Compiler control: Cargo exposes [lib].name, not the package spelling.
test('Rust custom library names and explicit extern self aliases preserve crate boundaries',t=>{
 const root=fixture(t,{'Cargo.toml':'[workspace]\nmembers=["api","app"]\nresolver="2"\n','api/Cargo.toml':'[package]\nname="real-api"\nversion="0.1.0"\nedition="2021"\n[lib]\nname="actual_api"\n','api/src/lib.rs':'extern crate self as own;\npub fn work(){}\npub fn caller(){own::work();actual_api::work();}\n','app/Cargo.toml':'[package]\nname="app"\nversion="0.1.0"\nedition="2021"\n[dependencies]\nreal-api={path="../api"}\n','app/src/lib.rs':'pub fn caller(){actual_api::work();real_api::work();}\n'});
 const facts=capture(root);for(const file of ['api/src/lib.rs','app/src/lib.rs']){const rows=calls(facts,file);assert.equal(rows[0].target.file,'api/src/lib.rs');assert.equal(rows[1].resolution,'unresolved');}
});
