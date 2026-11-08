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
const config=overrides=>mergeConfig(loadConfig(),{rust:{offline:false},...overrides});
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
 const selected=capture(root,{rust:{offline:false,features:{sample:['chosen']}}});assert.ok(selected.files.some(f=>f.path==='src/yes.rs'));assert.ok(!selected.files.some(f=>f.path==='src/no.rs'));
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
  const facts=capture(root,{rust:{offline:false,features:{sample:features}}});const body=calls(facts,'src/lib.rs').filter(c=>c.line===3);assert.equal(body[0].target.file,file);assert.equal(body[1].resolution,'unresolved');assert.ok(facts.languageScope.opaqueMacros.some(x=>x.kind==='attribute-expansion'));
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

// Source-first compiler controls are frozen in the inherent-function benchmark.
test('Rust inherent source candidates follow nominal modules and import aliases without trait or generic guesses',t=>{
 const root=fixture(t,{'src/lib.rs':`mod text;mod bytes;
use crate::text::Regex as Imported;
trait Build{fn new();}
struct Factory;impl Factory{fn new(){}}
struct Holder<T>(T);impl<Factory:Build> Holder<Factory>{fn call(){Factory::new();}}
fn generic<Factory:Build>(){Factory::new();}
fn nested(){fn inner<Factory:Build>(){Factory::new();}}
fn caller(){text::Regex::new();bytes::Regex::new();Imported::new();}
impl Build for Factory{fn new(){Imported::new();}}
fn trait_call(){<Factory as Build>::new();}
struct Generic<T>(T);impl Generic<u8>{fn new(){}}impl Generic<u16>{fn new(){}}
fn specialized(){Generic::<u8>::new();}
#[cfg(build_unknown)]impl Factory{fn maybe(){}}
fn conditional(){Factory::maybe();}
type Alias=text::Regex;fn alias(){Alias::new();}
`, 'src/text.rs':'pub struct Regex;\nimpl Regex{pub fn new(){}}\n', 'src/bytes.rs':'pub struct Regex;\nimpl Regex{pub fn new(){}}\n'});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 assert.equal(facts.callModel,'rust-source-direct-v4');
 const direct=calls(facts,'src/lib.rs').filter(c=>c.line===8);
 assert.deepEqual(direct.map(c=>c.target.file),['src/text.rs','src/bytes.rs','src/text.rs']);
 assert.ok(direct.every(c=>c.resolution==='rust-inherent-source-candidate'));
 assert.ok(facts.imports.some(i=>i.resolved&&i.names?.includes('Imported')&&i.to==='src/text.rs'));
 assert.equal(calls(facts,'src/lib.rs').find(c=>c.line===9).target.file,'src/text.rs');
 for(const line of [5,6,7,10,12,14,15])assert.equal(calls(facts,'src/lib.rs').find(c=>c.line===line).resolution,'unresolved',`line ${line}`);
 const question=buildQuestion({root,facts,entry:'src/lib.rs',symbol:'caller',question:'Where are the constructors?'});
 assert.ok(question.calls.records.every(r=>r.targetNavigation.status==='valid'));
 const legacy=structuredClone(facts);legacy.callModel='rust-source-direct-v1';
 assert.ok(schemaErrors('raw-facts',legacy).some(e=>String(e.message).includes('v2')));
});

test('Rust inherent lookup preserves namespace ambiguity, cfg alternatives and local Cargo boundaries',t=>{
 const root=fixture(t,{'Cargo.toml':'[workspace]\nmembers=["api","app"]\nresolver="2"\n','api/Cargo.toml':'[package]\nname="api"\nversion="0.1.0"\nedition="2021"\n', 'api/src/lib.rs':`pub struct Factory;
impl Factory{pub fn new(){}}
#[cfg(build_unknown)]impl Factory{pub fn new(){}}
pub struct Unique;impl Unique{pub fn new(){}}
`, 'app/Cargo.toml':'[package]\nname="app"\nversion="0.1.0"\nedition="2021"\n[dependencies]\nrenamed={package="api",path="../api"}\n', 'app/src/lib.rs':`use renamed::Unique as Imported;
pub fn caller(){Imported::new();renamed::Unique::new();renamed::Factory::new();}
mod dual{pub struct Factory{}impl Factory{pub fn new(){}}pub fn Factory(){}}
fn ambiguous(){dual::Factory::new();dual::Factory();}
fn local(){struct Imported;Imported::new();}
`});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const body=calls(facts,'app/src/lib.rs').filter(c=>c.line===2);
 assert.deepEqual(body.slice(0,2).map(c=>c.target.file),['api/src/lib.rs','api/src/lib.rs']);
 assert.equal(body[2].resolution,'unresolved');
 assert.ok(calls(facts,'app/src/lib.rs').filter(c=>c.line>=4).every(c=>c.resolution==='unresolved'));
});

// rustc accepts this collision and selects the tuple variant at both calls.
test('Rust enum variants never navigate to a same-named inherent function',t=>{
 const root=fixture(t,{'src/lib.rs':'enum E{Make(u8)}\nimpl E{fn Make()->Self{E::Make(0)}}\nfn caller(){E::Make(1);}\n'});
 const facts=capture(root);assert.deepEqual(facts.parse_errors||[],[]);
 assert.equal(facts.calls.length,2);assert.ok(facts.calls.every(c=>c.resolution==='unresolved'));
});


test('Rust nested implementation scopes preserve free functions and report excluded method bodies',t=>{
 const root=fixture(t,{'src/lib.rs':`fn work(){}
struct Factory;impl Factory{fn new(){}}
trait Build{fn new();}
fn outer(){struct Local<T>(T);impl<Factory:Build> Local<Factory>{fn call(){Factory::new();work();}}
struct Visitor;impl Visitor{#[cfg(feature="chosen")]fn chosen(){work();}}
}
`});
 const facts=capture(root);assert.ok(calls(facts,'src/lib.rs').some(c=>c.line===4&&c.target?.name==='work'));
 assert.ok(calls(facts,'src/lib.rs').some(c=>c.line===4&&c.resolution==='unresolved'));
 assert.ok(!calls(facts,'src/lib.rs').some(c=>c.line===5));
 assert.ok(facts.languageScope.excludedRegions.some(r=>r.file==='src/lib.rs'&&r.range.line===5));
 const selected=capture(root,{rust:{offline:false,features:{sample:['chosen']}}});
 assert.ok(calls(selected,'src/lib.rs').some(c=>c.line===5&&c.target?.name==='work'));
});

test('Rust bare generic nominal paths expose unique concrete-specialization source candidates',t=>{
 const root=fixture(t,{'src/lib.rs':`mod model;
use crate::model::Boxed as Imported;
pub fn caller(){Imported::new();model::Boxed::new();crate::model::Boxed::new();}
fn explicit(){model::Boxed::<u8>::new();}
`, 'src/model.rs':`pub struct Boxed<T>(T);
impl Boxed<String>{pub fn new()->Self{Self(String::new())}}
`});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const direct=calls(facts,'src/lib.rs').filter(c=>c.line===3);
 assert.equal(direct.length,3);
 assert.ok(direct.every(c=>c.resolution==='rust-specialized-inherent-source-candidate'));
 assert.ok(direct.every(c=>c.target.file==='src/model.rs'&&c.target.line===2&&c.target.name==='new'));
 assert.equal(calls(facts,'src/lib.rs').find(c=>c.line===4).resolution,'unresolved');
 const question=buildQuestion({root,facts,entry:'src/lib.rs',symbol:'caller',question:'Which constructor source is the candidate?'});
 assert.ok(question.calls.records.every(r=>r.targetNavigation.status==='valid'));
 const legacy=structuredClone(facts);legacy.callModel='rust-source-direct-v2';
 assert.ok(schemaErrors('raw-facts',legacy).some(e=>String(e.message).includes('v3')));
});

test('Rust concrete specialization cannot hide a competing generic impl or unsupported owner',t=>{
 const root=fixture(t,{'src/lib.rs':`struct Choice<T>(T);
impl<T:Default> Choice<(T,)>{fn new()->Self{Self((T::default(),))}}
impl Choice<String>{fn new()->Self{Self(String::new())}}
struct Receiver<T>(T);
impl Receiver<String>{fn new()->Self{Self(String::new())}}
impl Receiver<u8>{fn new(self)->Self{self}}
struct Lifetime<'a>(&'a str);impl Lifetime<'static>{fn new()->Self{Self("")}}
struct Fixed<const N:usize>;impl Fixed<3>{fn new()->Self{Self}}
struct General<T>(T);impl<T> General<T>{fn new(value:T)->Self{Self(value)}}
fn chosen(){Choice::new();Receiver::new();Lifetime::new();Fixed::new();General::new(1);}
`});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const uncertain=calls(facts,'src/lib.rs').filter(c=>c.line===10);assert.equal(uncertain.length,5);
 assert.ok(uncertain.every(c=>c.resolution==='unresolved'));
});

test('Rust changed specialized constructor retrieves its verified imported caller',t=>{
 const lib='mod model;use crate::model::Boxed as Imported;\npub fn caller(){Imported::new();}\n';
 const before='pub struct Boxed<T>(T);\nimpl Boxed<String>{pub fn new()->Self{Self(String::new())}}\n';
 const baseRoot=fixture(t,{'src/lib.rs':lib,'src/model.rs':before});
 const root=fixture(t,{'src/lib.rs':lib,'src/model.rs':before.replace('String::new()','String::from("changed")')});
 const cfg=config(),base=captureChangeSide(baseRoot,cfg,'rust'),head=captureChangeSide(root,cfg,'rust');
 const brief=buildChangeQuestion({base,head,config:cfg,entry:'src/model.rs',question:'Which known caller references the changed constructor?'});
 assert.equal(brief.changedDefinitions.total,1);
 for(const side of ['base','head']){
  const refs=brief.changedDefinitions.items[0][side].knownReferences;
  assert.equal(refs.coverage,'available');assert.equal(refs.total,1);
  assert.equal(refs.items[0].navigation.status,'valid');assert.equal(refs.items[0].navigation.location.file,'src/lib.rs');
 }
});

test('Rust lifetime-only constructor paths preserve imported identity and distinguish enum variants',t=>{
 const root=fixture(t,{'Cargo.toml':'[workspace]\nmembers=["api","app"]\nresolver="2"\n',
 'api/Cargo.toml':'[package]\nname="borrowed-api"\nversion="0.1.0"\nedition="2021"\n[lib]\nname="actual_api"\n',
 'app/Cargo.toml':'[package]\nname="client"\nversion="0.1.0"\nedition="2021"\n[dependencies]\nrenamed={package="borrowed-api",path="../api"}\n',
 'api/src/lib.rs':'pub mod model;\n',
 'app/src/lib.rs':"use renamed::model::Borrowed as Imported;\npub fn caller(){Imported::new(\"one\");renamed::model::Borrowed::new(\"two\");renamed::model::Either::new(\"three\");}\n",
 'api/src/model.rs':`pub struct Borrowed<'a>(&'a str);
impl<'a> Borrowed<'a>{pub fn new(v:&'a str)->Self{Self(v)}}
pub enum Either<'a>{Value(&'a str)}
impl<'a> Either<'a>{pub fn new(v:&'a str)->Self{Self::Value(v)}}
pub enum Collision<'a>{Make(&'a str)}
impl<'a> Collision<'a>{pub fn Make()->Self{Self::Make("")}}
pub fn variant(){Collision::Make("value");}
`});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const direct=calls(facts,'app/src/lib.rs');assert.equal(direct.length,3);
 assert.ok(direct.every(c=>c.resolution==='rust-lifetime-inherent-source-candidate'&&c.target.file==='api/src/model.rs'));
 assert.deepEqual(direct.map(c=>c.target.line),[2,2,4]);
 assert.equal(calls(facts,'api/src/model.rs').find(c=>c.line===7).resolution,'unresolved');
 const q=buildQuestion({root,facts,entry:'app/src/lib.rs',symbol:'caller',question:'Which borrowed implementation is selected by these paths?'});
 assert.ok(q.calls.records.every(r=>r.targetNavigation.status==='valid'));
 const old=structuredClone(facts);old.callModel='rust-source-direct-v3';assert.ok(schemaErrors('raw-facts',old).some(e=>String(e.message).includes('v4')));
});

test('Rust lifetime-only candidates retain bounded, concrete, mixed, cfg, receiver and explicit-argument unknowns',t=>{
 const root=fixture(t,{'src/lib.rs':`struct Plain<'a>(&'a str);impl<'a> Plain<'a>{fn new(v:&'a str)->Self{Self(v)}}
struct Bounded<'a:'b,'b>(&'a str,&'b str);impl<'a:'b,'b> Bounded<'a,'b>{fn new(){}}
struct Mixed<'a,T>(&'a T);impl<'a,T> Mixed<'a,T>{fn new(){}}
struct Concrete<'a>(&'a str);impl Concrete<'static>{fn new(){}}
struct Shared<'a,'b>(&'a str,&'b str);impl<'a> Shared<'a,'a>{fn new(){}}
struct Receiver<'a>(&'a str);impl<'a> Receiver<'a>{fn new(self){}}
struct Conditional<'a>(&'a str);impl<'a> Conditional<'a>{fn new(){}}
#[cfg(build_unknown)]impl<'a> Conditional<'a>{fn new(){}}
type Alias<'a>=Plain<'a>;
fn unsupported(){Bounded::new();Mixed::new();Concrete::new();Shared::new();Receiver::new();Conditional::new();Alias::new("");Plain::<'static>::new("");}
`});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const selected=calls(facts,'src/lib.rs').filter(c=>c.line===10);assert.equal(selected.length,8);
 assert.ok(selected.every(c=>c.resolution==='unresolved'));
});

test('Rust paired changed lifetime constructor retrieves its captured imported caller',t=>{
 const lib='mod model;use crate::model::Borrowed as Imported;\npub fn caller(){Imported::new("value");}\n';
 const before="pub struct Borrowed<'a>(&'a str);\nimpl<'a> Borrowed<'a>{pub fn new(v:&'a str)->Self{Self(v)}}\n";
 const baseRoot=fixture(t,{'src/lib.rs':lib,'src/model.rs':before});
 const root=fixture(t,{'src/lib.rs':lib,'src/model.rs':before.replace('Self(v)','Self(if v.is_empty(){"changed"}else{v})')});
 const cfg=config(),base=captureChangeSide(baseRoot,cfg,'rust'),head=captureChangeSide(root,cfg,'rust');
 const q=buildChangeQuestion({base,head,config:cfg,entry:'src/model.rs',question:'Which known caller refers to this changed borrowed constructor?'});
 assert.equal(q.changedDefinitions.total,1);
 for(const side of ['base','head']){
  const refs=q.changedDefinitions.items[0][side].knownReferences;assert.equal(refs.coverage,'available');assert.equal(refs.total,1);
  assert.equal(refs.items[0].fact.resolution,'rust-lifetime-inherent-source-candidate');assert.equal(refs.items[0].navigation.status,'valid');
 }
});
