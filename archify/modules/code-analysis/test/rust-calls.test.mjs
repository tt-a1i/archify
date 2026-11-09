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

test('Rust native LF ranges preserve bare CR inside block comments', t => {
 const source = '/* a\rb */ pub fn work()->i32 {/* c\rd */ 1}\npub fn caller()->i32 {work()}\n';
 const root = fixture(t, {'src/lib.rs': source});
 const facts = capture(root); assert.deepEqual(schemaErrors('raw-facts', facts), []);
 const question = buildQuestion({root,facts,entry:'src/lib.rs',symbol:'caller',question:'Where is work?'});
 assert.equal(question.calls.coverage,'available');
 assert.deepEqual(question.calls.records[0].targetNavigation.location,{file:'src/lib.rs',name:'work',line:1,column:11});
 const settings=config(); const base=captureChangeSide(root,settings,'rust');
 const headRoot=fixture(t,{'src/lib.rs':source.replace('d */ 1','d */ 2')});
 const head=captureChangeSide(headRoot,settings,'rust');
 const pair=buildChangeQuestion({root:headRoot,baseRoot:root,base,head,config:settings,entry:'src/lib.rs',question:'What changed?'});
 assert.equal(pair.status,'ready');assert.equal(pair.changedDefinitions.total,1);assert.equal(pair.changedDefinitions.items[0].head.knownReferences.total,1);
});

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
 for(const line of [3,4,5,7,8])assert.ok(calls(facts,'src/lib.rs').filter(c=>c.line===line).every(c=>c.resolution==='unresolved'),`line ${line}`);
 const generic=calls(facts,'src/lib.rs').find(c=>c.line===6);
 assert.equal(generic.resolution,'rust-trait-method-candidate');assert.equal(generic.target.line,2);assert.equal(generic.target.name,'method');
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
 assert.equal(facts.callModel,'rust-source-direct-v12');
 const direct=calls(facts,'src/lib.rs').filter(c=>c.line===8);
 assert.deepEqual(direct.map(c=>c.target.file),['src/text.rs','src/bytes.rs','src/text.rs']);
 assert.ok(direct.every(c=>c.resolution==='rust-inherent-source-candidate'));
 assert.ok(facts.imports.some(i=>i.resolved&&i.names?.includes('Imported')&&i.to==='src/text.rs'));
 assert.equal(calls(facts,'src/lib.rs').find(c=>c.line===9).target.file,'src/text.rs');
 for(const line of [5,6,7]){const call=calls(facts,'src/lib.rs').find(c=>c.line===line);assert.equal(call.resolution,'rust-trait-method-candidate',`line ${line}`);assert.equal(call.target.line,3)}
 const qualified=calls(facts,'src/lib.rs').find(c=>c.line===10);assert.equal(qualified.resolution,'rust-trait-impl');assert.equal(qualified.target.line,9);
 for(const line of [14,15])assert.equal(calls(facts,'src/lib.rs').find(c=>c.line===line).resolution,'unresolved',`line ${line}`);
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

test('Rust trait impl calls separate definite targets from trait-only candidates',t=>{
 const root=fixture(t,{'src/lib.rs':`pub trait Left { fn act(&self) -> u8; }
pub trait Right { fn act(&self) -> u8; }
pub struct A;
pub struct B;
impl Left for A { fn act(&self) -> u8 { 1 } }
impl Left for B { fn act(&self) -> u8 { 2 } }
impl Right for A { fn act(&self) -> u8 { 3 } }
pub fn definite() { <A as Left>::act(&A); <A as Right>::act(&A); }
pub fn generic<T: Left>(x: T) { x.act(); T::act(&x); }
pub fn object(x: &dyn Left) { x.act(); }
pub fn ambiguous(x: &A) { x.act(); }
`});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 assert.equal(facts.callModel,'rust-source-direct-v12');
 const call=(line,column)=>calls(facts,'src/lib.rs').find(c=>c.line===line&&c.column===column);
 assert.equal(call(8,21).resolution,'rust-trait-impl');assert.equal(call(8,21).target.line,5);
 assert.equal(call(8,43).resolution,'rust-trait-impl');assert.equal(call(8,43).target.line,7);
 for(const column of [33,42]){const item=call(9,column);assert.equal(item.resolution,'rust-trait-method-candidate');assert.equal(item.target.line,1)}
 const object=call(10,31);assert.equal(object.resolution,'rust-trait-method-candidate');assert.equal(object.target.line,1);
 assert.equal(call(11,27).resolution,'unresolved');
 const edges=facts.traitImplementations.filter(edge=>edge.traitMethod.name==='act');
 assert.deepEqual(edges.filter(edge=>edge.trait.name==='Left').map(edge=>edge.selfType).sort(),['A','B']);
 assert.deepEqual(edges.filter(edge=>edge.selfType==='A').map(edge=>edge.trait.name).sort(),['Left','Right']);
 const settings=config();const headRoot=fixture(t,{'src/lib.rs':fs.readFileSync(path.join(root,'src/lib.rs'),'utf8').replace('fn act(&self) -> u8 { 1 }','fn act(&self) -> u8 { 10 }')});
 const pair=buildChangeQuestion({base:captureChangeSide(root,settings,'rust'),head:captureChangeSide(headRoot,settings,'rust'),config:settings,entry:'src/lib.rs',question:'Which callers reach the changed trait method?'});
 const a=pair.unpairedDefinitions.items.find(item=>item.side==='head'&&item.definition.line===5);
 assert.ok(a,'duplicate trait-method qualnames stay explicit; the head impl Left for A remains inspectable');
 assert.equal(a.reason,'duplicate-slot');
 const direct=a.knownReferences.items.map(record=>record.fact.line);
 assert.deepEqual(direct,[8]);
 const candidates=a.traitCandidates;assert.equal(candidates.coverage,'available');assert.equal(candidates.runtimeTarget,'not-determined');
 assert.deepEqual(candidates.items.map(record=>record.fact.line),[9,9,10]);
 assert.ok(candidates.items.every(record=>record.fact.target.line===1&&record.reason.includes('not determined')));
 assert.equal(a.traitCandidates.role.includes('not proof of runtime dispatch'),true);
});

test('Rust trait default bodies are inventoried once with context and leave Self-dependent calls unknown', t => {
 const source=`pub trait Left { fn act(&self) -> u8; }
pub trait Defaults {
    fn twice(&self) -> u8 {
        let ret = A::new();
        ret.act()
    }
    fn via_self(&self) -> u8 { self.act() }
}
pub struct A(u8);
impl A { pub fn new() -> Self { A(0) } }
pub struct B(u8);
impl B { pub fn new() -> Self { B(0) } }
impl Left for A { fn act(&self) -> u8 { 1 } }
impl Left for B { fn act(&self) -> u8 { 2 } }
impl Defaults for A {}
impl Defaults for B {}
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const defaultCalls=facts.calls.filter(call=>call.defaultMethod);
 const twice=defaultCalls.filter(call=>call.defaultMethod.name==='twice');
 assert.equal(twice.filter(call=>call.line===4&&call.column===19).length,1,'constructor call appears once despite two implementing types');
 const hit=twice.filter(call=>call.line===5&&call.column===9);
 assert.equal(hit.length,1,'one source call is scanned once despite two implementing types');
 assert.equal(hit[0].resolution,'rust-trait-impl');assert.equal(hit[0].target.line,13);
 assert.deepEqual(hit[0].defaultMethod,{file:'src/lib.rs',name:'twice',qualname:'Defaults::twice',line:3,column:8,trait:'Defaults'});
 const selfCall=defaultCalls.find(call=>call.defaultMethod.name==='via_self');
 assert.equal(selfCall.resolution,'unresolved');assert.equal(selfCall.reason,'rust-trait-or-method-dispatch');
 assert.ok(!defaultCalls.some(call=>call.defaultMethod.name==='act'),'a bodyless trait declaration produces no calls');
});

test('Rust direct caller names a local function and keeps the enclosing default method', t => {
 const source=`pub trait Defaults {
    fn twice(&self) -> u8 { fn inner() -> u8 { A::new().act() } inner() }
}
pub struct A(u8);
impl A { pub fn new() -> Self { A(0) } }
pub trait Left { fn act(&self) -> u8; }
impl Left for A { fn act(&self) -> u8 { 1 } }
impl Defaults for A {}
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const call=facts.calls.find(row=>row.line===2&&row.column===48&&row.resolution==='rust-trait-impl');
 assert.ok(call,'the call inside the local function is captured');
 assert.deepEqual(call.directCaller,{file:'src/lib.rs',name:'inner',qualname:'Defaults::twice::inner',kind:'local-function',line:2,column:29});
 assert.deepEqual(call.defaultMethod,{file:'src/lib.rs',name:'twice',qualname:'Defaults::twice',line:2,column:8,trait:'Defaults'});
 const outer=facts.calls.find(row=>row.line===2&&row.column===65);
 assert.equal(outer.directCaller.name,'twice');assert.equal(outer.directCaller.kind,'trait-default-method');assert.equal(outer.directCaller.column,5);
});

test('Rust changed trait default method lists trait-bound calls but not concrete impl calls', t => {
 const body = (result) => `pub trait Gate {
    fn enabled(&self) -> bool { ${result} }
}

pub struct S;

impl Gate for S {
    fn enabled(&self) -> bool { false }
}

fn accept<G: Gate>(g: &G) -> bool { g.enabled() }

fn concrete(s: &S) -> bool { s.enabled() }
`;
 const root=fixture(t,{'src/lib.rs':body('true')});
 const headRoot=fixture(t,{'src/lib.rs':body('false')});
 const settings=config();
 const pair=buildChangeQuestion({root:headRoot,baseRoot:root,base:captureChangeSide(root,settings,'rust'),head:captureChangeSide(headRoot,settings,'rust'),config:settings,entry:'src/lib.rs',question:'Who calls the changed default?'});
 assert.equal(pair.status,'ready');
 const change=pair.changedDefinitions.items[0];
 assert.equal(change.head.definition.qualname,'Gate::enabled');
 assert.equal(change.head.definition.line,2);
 assert.equal(change.head.knownReferences.total,1);
 const ref=change.head.knownReferences.items[0];
 assert.equal(ref.fact.resolution,'rust-trait-method-candidate');
 assert.equal(ref.fact.target.line,2);
 assert.equal(ref.fact.target.column,8);
 assert.equal(ref.fact.directCaller.name,'accept');
 assert.equal(ref.fact.directCaller.kind,'function');
});

test('Rust default body self-calls bind the enclosing trait declaration only', t => {
 const body = (result) => `pub trait Gate {
    fn base(&self) -> u8 { ${result} }
    fn via(&self) -> u8 { self.base() }
    fn other(&self) -> u8 { self.missing() }
}
pub struct S;
impl Gate for S { fn base(&self) -> u8 { 2 } }
pub struct Plain;
impl Gate for Plain {}
fn concrete(s: &S) -> u8 { s.base() }
fn plain(p: &Plain) -> u8 { p.base() }
`;
 const root=fixture(t,{'src/lib.rs':body('1')});
 const headRoot=fixture(t,{'src/lib.rs':body('3')});
 const facts=capture(headRoot);
 const via=facts.calls.find(call=>call.directCaller?.name==='via');
 assert.ok(via,'the self-call in the default body is captured');
 assert.equal(via.resolution,'rust-trait-method-candidate');
 assert.equal(via.target.line,2);
 assert.equal(via.target.name,'base');
 assert.equal(via.directCaller.kind,'trait-default-method');
 const other=facts.calls.find(call=>call.directCaller?.name==='other');
 assert.ok(other,'a self-call to a method outside the trait is still captured');
 assert.equal(other.resolution,'unresolved');
 assert.equal(other.target,undefined,'the current trait is not claimed for an unknown method');
 const plain=facts.calls.find(call=>call.directCaller?.name==='plain');
 assert.ok(plain,'a concrete call without an override reaches the inherited default');
 assert.equal(plain.resolution,'rust-trait-method-candidate');
 assert.equal(plain.target.line,2);
 const concrete=facts.calls.find(call=>call.directCaller?.name==='concrete');
 assert.ok(concrete,'a concrete override call resolves to the impl body');
 assert.equal(concrete.resolution,'rust-trait-impl');
 assert.equal(concrete.target.line,7);
 const settings=config();
 const pair=buildChangeQuestion({root:headRoot,baseRoot:root,base:captureChangeSide(root,settings,'rust'),head:captureChangeSide(headRoot,settings,'rust'),config:settings,entry:'src/lib.rs',question:'Who calls the changed default?'});
 assert.equal(pair.status,'ready');
 const refs=pair.changedDefinitions.items[0].head.knownReferences;
 assert.deepEqual(refs.items.map(record=>record.fact.directCaller.name),['via','plain'],'the override call is not a reference to the default body');
});

test('Rust zero-argument impl-body macros expose forwarding calls as candidates', t => {
 const source=`pub trait Gate { fn check(&self) -> u8 { 1 } }
macro_rules! forward {
    () => {
        fn check(&self) -> u8 { (**self).check() }
    };
}
impl<T: Gate + ?Sized> Gate for &mut T { forward!(); }
impl<T: Gate + ?Sized> Gate for Box<T> { forward!(); }
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const calls=facts.calls.filter(call=>call.line===4);
 assert.equal(calls.length,1,'one physical template position is kept for both impls');
 assert.equal(calls[0].resolution,'rust-trait-method-candidate');
 assert.equal(calls[0].target.line,1);
 assert.equal(calls[0].target.name,'check');
 assert.equal(calls[0].directCaller.kind,'macro-generated-method');
 assert.equal(calls[0].directCaller.line,4);
 assert.ok(calls[0].directCaller.qualname.endsWith('::forward!::check'),'caller names the template, not the first impl');
 assert.deepEqual(calls[0].macroTemplate.definition,{file:'src/lib.rs',name:'forward',line:2,column:14});
 assert.deepEqual(calls[0].macroTemplate.expansions.map(origin=>[origin.line,origin.implLine,origin.selfType.replace(/\s/g,''),origin.trait]).sort(),[[7,7,'&mutT','Gate'],[8,8,'Box<T>','Gate']]);
 const edges=facts.traitImplementations.filter(edge=>edge.implementation.name==='check');
 assert.equal(edges.length,2,'both generated forwarding methods are inventoried');
});

test('Rust impl-body macro calls respect invocation, method, impl and expression cfg', t => {
 const source=`pub fn target() {}
macro_rules! invocation { () => { fn run() { target(); } }; }
macro_rules! method { () => { #[cfg(feature="chosen")] fn run() { target(); } }; }
macro_rules! outer { () => { fn run() { target(); } }; }
macro_rules! expression { () => { fn run() { #[cfg(feature="chosen")] target(); } }; }
macro_rules! unknown { () => { fn run() { target(); } }; }
struct A; struct B; struct C; struct D; struct E;
impl A { #[cfg_attr(not(feature="chosen"), cfg(any()))] invocation!(); }
impl B { method!(); }
#[cfg(feature="chosen")] impl C { outer!(); }
impl D { expression!(); }
impl E { #[cfg(build_unknown)] unknown!(); }
macro_rules! nested { () => { fn run() { target(); } }; }
struct F;
impl F { #[cfg_attr(all(), cfg_attr(not(feature="chosen"), cfg(any())))] nested!(); }
`;
 const root=fixture(t,{'src/lib.rs':source});
 for(const enabled of [false,true]){
  const facts=capture(root,{rust:{offline:false,features:{sample:enabled?['chosen']:[]}}});
  assert.deepEqual(schemaErrors('raw-facts',facts),[]);
  assert.deepEqual(facts.calls.filter(call=>call.target?.name==='target').map(call=>call.line).sort((a,b)=>a-b),enabled?[2,3,4,5,13]:[]);
  assert.deepEqual(facts.calls.map(call=>call.line).sort((a,b)=>a-b),enabled?[2,3,4,5,6,13]:[6],'excluded calls are absent, not merely unresolved');
  const unknown=facts.calls.find(call=>call.line===6);
  assert.equal(unknown.resolution,'unresolved');
  assert.equal(unknown.reason,'rust-cfg-unselected');
  assert.equal(unknown.target,undefined);
  assert.equal(unknown.macroTemplate.expansions[0].line,12);
 }
});

test('Rust shared macro positions preserve both origins without choosing divergent trait targets', t => {
 const source=`pub trait Left { fn check(&self) -> u8 { 1 } }
pub trait Right { fn check(&self) -> u8 { 2 } }
macro_rules! forward { () => { fn check(&self) -> u8 { (**self).check() } }; }
impl<T: Left + ?Sized> Left for &mut T { forward!(); }
impl<T: Right + ?Sized> Right for Box<T> { forward!(); }
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const [call]=facts.calls;
 assert.equal(facts.calls.length,1);
 assert.equal(call.resolution,'unresolved');
 assert.equal(call.reason,'rust-context-dependent');
 assert.equal(call.target,undefined);
 assert.ok(call.directCaller.qualname.endsWith('::forward!::check'));
 assert.deepEqual(call.macroTemplate.expansions.map(origin=>origin.trait).sort(),['Left','Right']);
 const conditional=fixture(t,{'src/lib.rs':source.replace('Right for Box<T> { forward!(); }','Right for Box<T> { #[cfg(feature="chosen")] forward!(); }')});
 const selected=capture(conditional).calls[0];
 assert.equal(selected.target.line,1,'a disabled competing expansion does not contribute a target or origin');
 assert.deepEqual(selected.macroTemplate.expansions.map(origin=>origin.trait),['Left']);
 const uncertain=fixture(t,{'src/lib.rs':source.replace('Right for Box<T> { forward!(); }','Right for Box<T> { #[cfg(build_unknown)] forward!(); }')});
 const unknown=capture(uncertain).calls[0];
 assert.equal(unknown.resolution,'unresolved');
 assert.equal(unknown.target,undefined,'an unknown competing expansion cannot be discarded to select Left');
 assert.equal(unknown.macroTemplate.expansions.length,2);
});

test('Rust shared-file template callers do not discard an agreed target', t => {
 const root=fixture(t,{'src/lib.rs':`pub fn target() {}
#[path="shared.rs"] mod left;
#[path="shared.rs"] mod right;
`,'src/shared.rs':`macro_rules! forward { () => { pub fn run() { crate::target(); } }; }
struct A;
impl A { forward!(); }
`});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 assert.equal(facts.calls.length,1);
 const [call]=facts.calls;
 assert.equal(call.target.file,'src/lib.rs');
 assert.equal(call.target.name,'target');
 assert.equal(call.directCaller,undefined,'a shared source does not choose one module caller identity');
 assert.equal(call.macroTemplate.definition.name,'forward');
 assert.equal(call.macroTemplate.expansions.length,1,'physical expansion sites remain deduplicated');
});

test('Rust cfg-unknown macro accessors cannot establish return-type evidence', t => {
 const source=`pub trait Left { fn enabled(&self) -> bool { true } }
pub trait Right { fn enabled(&self) -> bool { false } }
struct A; struct B; struct W;
impl Left for A {} impl Right for B {}
impl AsRef<A> for W { fn as_ref(&self) -> &A { &A } }
macro_rules! accessor_b { () => { fn as_ref(&self) -> &B { &B } }; }
#[cfg(build_unknown)] impl AsRef<B> for W { accessor_b!(); }
macro_rules! check { () => { fn check(&self) -> bool { self.as_ref().enabled() } }; }
impl W { check!(); }
`;
 for(const attribute of ['#[cfg(build_unknown)]','#[cfg(any())]']){
  const root=fixture(t,{'src/lib.rs':source.replace('#[cfg(build_unknown)]',attribute)});
  const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
  const call=facts.calls.find(call=>call.line===8&&call.target?.name==='enabled')??facts.calls.find(call=>call.line===8);
  if(attribute==='#[cfg(any())]') assert.equal(call.target.line,1,'excluded competitors do not block known accessors');
  else {
   assert.equal(call.resolution,'unresolved');
   assert.equal(call.target,undefined,'unknown competitors prevent selecting the active accessor target');
  }
 }
 const root=fixture(t,{'src/lib.rs':`pub trait Gate { fn enabled(&self) -> bool { true } }
struct A; struct W;
impl Gate for A {}
macro_rules! accessor { () => { fn as_ref(&self) -> &A { &A } }; }
impl W { #[cfg(build_unknown)] accessor!(); }
macro_rules! check { () => { fn check(&self) -> bool { self.as_ref().enabled() } }; }
impl W { check!(); }
`});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const calls=facts.calls.filter(call=>call.line===6);
 assert.equal(calls.length,2);
 assert.ok(calls.every(call=>call.resolution==='unresolved'&&!call.target),'an unknown inherent accessor cannot lend a known return type');
});

test('Rust unknown generated trait implementations block method and qualified targets', t => {
 const root=fixture(t,{'src/lib.rs':`struct W<T>(T);
trait Gate { fn check(&self) {} }
impl Gate for W<u8> { fn check(&self) {} }
macro_rules! methods { () => { fn check(&self) {} }; }
impl Gate for W<u16> { #[cfg(build_unknown)] methods!(); }
fn caller(w: &W<u16>) {
    w.check();
    <W<u16> as Gate>::check(w);
}
`});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 assert.deepEqual(facts.calls.map(call=>call.line),[7,8]);
 assert.ok(facts.calls.every(call=>call.resolution==='unresolved'&&!call.target),'an unknown specialization cannot disappear and select the other implementation');
});

test('Rust impl-body macro expansion keeps unsupported invocations and local derefs unknown', t => {
 const source=`pub trait Gate { fn check(&self) -> u8 { 1 } }
macro_rules! forward {
    ($arg:expr) => {
        fn check(&self) -> u8 { (**self).check() }
    };
}
impl<T: Gate + ?Sized> Gate for &mut T { forward!(1); }
fn local<G: Gate>(g: &mut G) -> u8 { (**g).check() }
macro_rules! zero {
    () => {
        fn zeroed(&self) -> u8 { (**self).zeroed() }
    };
}
impl<T: Gate + ?Sized> Gate for Box<T> { fn extra(&self) {} zero!(); }
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 assert.equal(facts.calls.filter(call=>call.line===4).length,0,'a non-empty matcher is not expanded');
 assert.equal(facts.calls.filter(call=>call.line===12).length,0,'a macro mixed with other impl items is not treated as the whole body');
 const local=facts.calls.find(call=>call.directCaller?.name==='local');
 assert.ok(local,'the local deref call is captured');
 assert.equal(local.resolution,'unresolved');
 assert.equal(local.target,undefined,'deref of a local generic is not claimed without proof');
});

test('Rust method receiver fields resolve trait bounds and unique concrete impls', t => {
 const source=`pub trait Gate { fn enabled(&self) -> bool { true } }
pub struct Holder<G> { gate: G }
impl<G: Gate> Holder<G> { pub fn check(&self) -> bool { self.gate.enabled() } }
pub struct S;
impl Gate for S { fn enabled(&self) -> bool { false } }
pub struct Concrete { gate: S }
impl Concrete { pub fn check(&self) -> bool { self.gate.enabled() } }
pub struct Erased<T> { gate: T }
impl<T: Gate> Erased<u8> { pub fn check(&self) -> bool { self.gate.enabled() } }
pub struct Borrowed<G>(G);
impl<G: Gate> Borrowed<G> { pub fn check(&self) -> bool { self.as_ref().enabled() } }
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const bound=facts.calls.find(row=>row.line===3&&row.resolution==='rust-trait-method-candidate');
 assert.ok(bound,'a field with a generic type reaches the trait bound');
 assert.equal(bound.target.name,'enabled');
 assert.equal(bound.directCaller.name,'check');
 const concrete=facts.calls.find(row=>row.line===7&&row.resolution==='rust-trait-impl');
 assert.ok(concrete,'a field with a nominal type reaches the unique impl');
 assert.equal(concrete.target.name,'enabled');
 assert.equal(concrete.target.line,5);
 const erased=facts.calls.find(row=>row.line===9);
 assert.ok(erased,'the call through a differently instantiated generic field is still captured');
 assert.equal(erased.resolution,'unresolved');
 assert.equal(erased.target,undefined);
 const borrowed=facts.calls.filter(row=>row.line===11);
 assert.ok(borrowed.length>0,'self.as_ref() without wrapping evidence is still captured');
 assert.ok(borrowed.every(row=>row.resolution!=='rust-trait-method-candidate'&&row.resolution!=='rust-trait-impl'),'an unevidenced self.as_ref() stays unknown instead of reaching the trait bound');
});

test('Rust accessor receivers follow captured wrapping implementations', t => {
 const source=`pub trait Gate { fn enabled(&self) -> bool { true } }
pub struct Wrap<G>(G);
impl<G: Gate> std::convert::AsRef<G> for Wrap<G> { fn as_ref(&self) -> &G { &self.0 } }
impl<G: Gate> std::ops::Deref for Wrap<G> { type Target = G; fn deref(&self) -> &G { &self.0 } }
impl<G: Gate> std::borrow::Borrow<G> for Wrap<G> { fn borrow(&self) -> &G { &self.0 } }
impl<G: Gate> Wrap<G> {
 pub fn via_as_ref(&self) -> bool { self.as_ref().enabled() }
 pub fn via_deref(&self) -> bool { self.deref().enabled() }
 pub fn via_borrow(&self) -> bool { self.borrow().enabled() }
}
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 for (const line of [7,8,9]) {
  const call=facts.calls.find(row=>row.line===line&&row.resolution==='rust-trait-method-candidate');
  assert.ok(call,`line ${line} follows the captured wrapping target to the trait bound`);
  assert.equal(call.target.name,'enabled');
 }
});

test('Rust inherent accessor shadows wrapping inference', t => {
 const source=`pub trait Gate { fn enabled(&self) -> bool { true } }
pub struct Other;
impl Other {
 pub fn enabled(&self) -> bool { false }
}
pub struct Wrapper<T> { inner: T }
impl<T: Gate> Wrapper<T> {
 pub fn as_ref(&self) -> &Other { &Other }
 pub fn check(&self) -> bool { self.as_ref().enabled() }
}
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const call=facts.calls.find(row=>row.line===9&&row.resolution==='rust-inherent-source-candidate'&&row.target.name==='enabled');
 assert.ok(call,'the inherent as_ref return type selects Other::enabled');
 assert.equal(call.target.line,4);
 assert.equal(facts.calls.filter(row=>row.line===9&&row.resolution==='rust-trait-method-candidate').length,0,'the trait bound is not claimed when an inherent accessor exists');
});

test('Rust defaulted generic structs expose field receivers and inherent methods', t => {
 const source=`pub struct HeaderMap<T = u8> { x: T }
impl<T> HeaderMap<T> {
 fn hidden(&self) -> u8 { 0 }
}
pub struct Occupied<'a, T> { map: &'a mut HeaderMap<T> }
impl<'a, T> Occupied<'a, T> {
 fn call(&self) { self.map.hidden(); }
}
mod util {
 pub fn helper() { work_inner(); }
 fn work_inner() {}
}
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const call=facts.calls.find(row=>row.line===7&&row.target?.name==='hidden');
 assert.ok(call,'a defaulted generic owner still exposes field and inherent-method evidence');
 assert.equal(call.target.line,3);
 const helper=facts.calls.find(row=>row.line===10);
 assert.equal(helper.target?.name,'work_inner');
 assert.equal(helper.directCaller.kind,'function','module-level functions are not methods');
});

test('Rust impl where clauses and default type parameters resolve field receivers', t => {
 const source=`pub trait Subscriber { fn event_enabled(&self) -> bool { true } }
pub trait Layer<S> { fn event_enabled(&self, s: &S) -> bool { true } }
pub struct Layered<L, I, S = I> { layer: L, inner: I, _s: std::marker::PhantomData<fn(S)> }
impl<L, S> Subscriber for Layered<L, S>
where
 L: Layer<S>,
 S: Subscriber,
{
 fn event_enabled(&self) -> bool { self.inner.event_enabled() }
}
impl<A, B, S> Layered<A, B, S>
where
 A: Layer<S>,
 B: Layer<S>,
{
 fn check(&self, s: &S) -> bool { self.layer.event_enabled(s) }
}
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const inner=facts.calls.find(row=>row.line===9&&row.target?.name==='event_enabled');
 assert.ok(inner,'the omitted default parameter maps inner to S');
 assert.equal(inner.target.line,1);
 const layer=facts.calls.find(row=>row.line===16&&row.target?.name==='event_enabled');
 assert.ok(layer,'a where-clause bound on the impl generic is available');
 assert.equal(layer.target.line,2);
});

test('Rust standard smart-pointer accessors return their type argument', t => {
 const source=`pub trait Gate { fn enabled(&self) -> bool { true } }
use std::sync::Arc;
use std::boxed::Box;
pub struct Shared;
impl<S: Gate> Gate for Arc<S> { fn enabled(&self) -> bool { self.as_ref().enabled() } }
impl<S: Gate> Gate for Box<S> { fn enabled(&self) -> bool { self.as_ref().enabled() } }
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 for (const line of [5,6]) {
  const call=facts.calls.find(row=>row.line===line&&row.target?.name==='enabled');
  assert.ok(call,`line ${line} follows the pointer payload`);
  assert.equal(call.target.line,1);
 }
});

test('Rust tuple-variant bindings resolve through the scrutinee type', t => {
 const source=`pub trait Gate { fn enabled(&self) -> bool { true } }
pub enum Maybe<T> { Yes(T), No }
impl<T: Gate> Maybe<T> {
 pub fn check(&self) -> bool {
  match self {
   Maybe::Yes(inner) => inner.enabled(),
   Maybe::No => false,
  }
 }
}
pub trait Layer<S> { fn event_enabled(&self, s: &S) -> bool { true } }
impl<L, S> Layer<S> for Option<L>
where
 L: Layer<S>,
{
 fn event_enabled(&self, s: &S) -> bool {
  match self {
   Some(inner) => inner.event_enabled(s),
   None => false,
  }
 }
}
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const local=facts.calls.find(row=>row.line===6&&row.target?.name==='enabled');
 assert.ok(local,'a captured tuple variant binds its payload type');
 assert.equal(local.target.line,1);
 const option=facts.calls.find(row=>row.line===18&&row.target?.name==='event_enabled');
 assert.ok(option,'the standard Option payload binds through the impl argument');
 assert.equal(option.target.line,11);
});

test('Rust local same-name accessor traits follow their declared return type', t => {
 const source=`pub trait AsRef<T> { fn as_ref(&self) -> &Other; }
pub struct First;
pub struct Other;
impl First { pub fn enabled(&self) -> bool { false } }
impl Other { pub fn enabled(&self) -> bool { true } }
pub struct Wrap;
impl AsRef<First> for Wrap { fn as_ref(&self) -> &Other { &Other } }
impl Wrap { pub fn check(&self) -> bool { self.as_ref().enabled() } }
pub fn run(w: &Wrap) -> bool { w.as_ref().enabled() }
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 for (const line of [8,9]) {
  const call=facts.calls.find(row=>row.line===line&&row.resolution==='rust-inherent-source-candidate');
  assert.ok(call,`line ${line} follows the local trait declaration`);
  assert.equal(call.target.name,'enabled');
  assert.equal(call.target.line,5,'the local AsRef<First> declaration returns Other');
  assert.equal(facts.calls.filter(row=>row.line===line&&row.target?.line===4).length,0,'the trait argument First is not used as the return type');
 }
});

test('Rust local Borrow and Deref declarations follow their own targets', t => {
 const source=`pub trait Borrow<T> { fn borrow(&self) -> &Other; }
pub trait Deref { type Target; fn deref(&self) -> &Self::Target; }
pub struct First;
pub struct Other;
impl First { pub fn enabled(&self) -> bool { false } }
impl Other { pub fn enabled(&self) -> bool { true } }
pub struct Wrap;
impl Borrow<First> for Wrap { fn borrow(&self) -> &Other { &Other } }
impl Deref for Wrap { type Target = Other; fn deref(&self) -> &Other { &Other } }
impl Wrap {
 pub fn via_borrow(&self) -> bool { self.borrow().enabled() }
 pub fn via_deref(&self) -> bool { self.deref().enabled() }
}
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 for (const line of [11,12]) {
  const call=facts.calls.find(row=>row.line===line&&row.resolution==='rust-inherent-source-candidate');
  assert.ok(call,`line ${line} follows the local declaration`);
  assert.equal(call.target.line,6);
 }
});

test('Rust accessor aliases resolve local declarations and standard paths', t => {
 const source=`pub struct First;
pub struct Other;
impl First { pub fn enabled(&self) -> bool { false } }
impl Other { pub fn enabled(&self) -> bool { true } }
mod custom { use super::{First, Other}; pub trait AsRef<T> { fn as_ref(&self) -> &Other; } }
use crate::custom::AsRef as LocalRef;
use std::convert::AsRef as StdRef;
pub struct Local;
pub struct Standard;
impl LocalRef<First> for Local { fn as_ref(&self) -> &Other { &Other } }
impl StdRef<First> for Standard { fn as_ref(&self) -> &First { &First } }
impl Local { pub fn check(&self) -> bool { self.as_ref().enabled() } }
impl Standard { pub fn check(&self) -> bool { self.as_ref().enabled() } }
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const local=facts.calls.find(row=>row.line===12&&row.target?.name==='enabled');
 assert.ok(local,'the local alias resolves to the local trait declaration');
 assert.equal(local.target.line,4);
 const standard=facts.calls.find(row=>row.line===13&&row.target?.name==='enabled');
 assert.ok(standard,'the standard alias keeps the AsRef argument type');
 assert.equal(standard.target.line,3);
});

test('Rust external same-name accessor without captured evidence stays unknown', t => {
 const source=`use external::AsRef;
pub struct First;
pub struct Other;
impl Other { pub fn enabled(&self) -> bool { true } }
pub struct Wrap;
impl AsRef<First> for Wrap { fn as_ref(&self) -> &Other { &Other } }
impl Wrap { pub fn check(&self) -> bool { self.as_ref().enabled() } }
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const call=facts.calls.find(row=>row.line===7&&row.target?.name==='enabled');
 assert.equal(call,undefined,'an uncaptured external AsRef signature is not assumed');
});

test('Rust swapped generic parameters map field positions', t => {
 const source=`pub trait Left { fn make(&self) -> bool { true } }
pub trait Right { fn make(&self) -> bool { true } }
pub struct Pair<X, Y> { first: X, second: Y }
impl<A: Right, B: Left> Pair<B, A> {
 pub fn first(&self) -> bool { self.first.make() }
 pub fn second(&self) -> bool { self.second.make() }
}
pub struct S;
impl Left for S { fn make(&self) -> bool { false } }
impl Right for S { fn make(&self) -> bool { false } }
`;
 const root=fixture(t,{'src/lib.rs':source});
 const facts=capture(root);assert.deepEqual(schemaErrors('raw-facts',facts),[]);
 const first=facts.calls.find(row=>row.line===5&&row.resolution==='rust-trait-method-candidate');
 const second=facts.calls.find(row=>row.line===6&&row.resolution==='rust-trait-method-candidate');
 assert.ok(first&&second,'both fields resolve through the swapped impl parameters');
 assert.equal(first.target.line,1);
 assert.equal(second.target.line,2);
});

test('Rust default-method references stay within the declaring crate file', t => {
 const source = value => `pub trait Gate { fn enabled(&self) -> bool { ${value} } }
pub fn use_gate<G: Gate>(gate: &G) -> bool { gate.enabled() }
`;
 const files = {
  'Cargo.toml': '[workspace]\nmembers=["api","app"]\nresolver="2"\n',
  'api/Cargo.toml': '[package]\nname="api"\nversion="0.1.0"\nedition="2021"\n',
  'app/Cargo.toml': '[package]\nname="app"\nversion="0.1.0"\nedition="2021"\n',
  'api/src/lib.rs': source('true'),
  'app/src/lib.rs': source('false')
 };
 const root = fixture(t, files);
 const headRoot = fixture(t, { ...files, 'api/src/lib.rs': source('1') });
 const settings = config();
 const base = captureChangeSide(root, settings, 'rust');
 const head = captureChangeSide(headRoot, settings, 'rust');
 const pair = buildChangeQuestion({ root: headRoot, baseRoot: root, base, head, config: settings, entry: 'api/src/lib.rs', question: 'Which callers reach Gate::enabled?' });
 const row = (pair.changedDefinitions.items || []).find(item => item.head.definition.file === 'api/src/lib.rs');
 assert.ok(row, 'the changed default body in the api crate is a changed definition');
 assert.equal(row.head.knownReferences.total, 1);
 assert.deepEqual(row.head.knownReferences.items.map(item => item.fact.file), ['api/src/lib.rs']);
});

test('Rust preserves only single-expression local macro arguments proven used once', t => {
 const source = [
  'pub struct Parser;',
  'pub struct Error;',
  'impl Parser {',
  '    pub fn parse(&self) -> Result<u8, Error> { Ok(1) }',
  '}',
  'macro_rules! ok {',
  '    ($e:expr) => { match $e { Ok(v) => v, Err(_) => panic!() } };',
  '}',
  'macro_rules! discard {',
  '    ($e:expr) => { () };',
  '}',
  'macro_rules! twice {',
  '    ($e:expr) => { let _ = ($e, $e); };',
  '}',
  'macro_rules! wrapped {',
  '    ($e:expr) => { assert!($e) };',
  '}',
  'macro_rules! listed {',
  '    ($($e:expr),*) => { vec![$($e),*] };',
  '}',
  'pub fn preserved(p: Parser) -> u8 { ok!(p.parse()) }',
  'pub fn discarded(p: Parser) { discard!(p.parse()); }',
  'pub fn duplicated(p: Parser) { twice!(p.parse()); }',
  'pub fn wrapped_call(p: Parser) { wrapped!(p.parse().is_ok()); }',
  'pub fn repeated(p: Parser) { let _ = listed!(p.parse().is_ok(), true); }',
 ].join('\n') + '\n';
 const root = fixture(t, {'src/lib.rs': source});
 const facts = capture(root); assert.deepEqual(schemaErrors('raw-facts', facts), []);
 const at = line => calls(facts, 'src/lib.rs').find(c => c.line === line);
 const preserved = at(21);
 assert.equal(preserved.resolution, 'rust-inherent-source-candidate');
 assert.deepEqual(preserved.target, {file:'src/lib.rs', name:'parse', line:4, column:5});
 assert.deepEqual(preserved.macroEvidence, [{name:'ok', definition:{file:'src/lib.rs', line:6, column:14}, argumentUse:'once', expansion:'preserved'}]);
 for (const line of [22, 23, 24, 25]) {
  const control = at(line);
  assert.equal(control.resolution, 'unresolved', `line ${line} stays opaque`);
  assert.equal(control.reason, 'rust-macro-not-expanded');
  assert.equal(control.macroEvidence, undefined);
 }
});

test('Rust traverses a preserving macro only when cfg selects the callsite', t => {
 const source = 'pub struct Parser;\nimpl Parser { pub fn parse(&self) -> bool { true } }\nmacro_rules! ok { ($e:expr) => { $e }; }\npub fn plain(p: Parser) { ok!(p.parse()); }\n#[cfg(feature = "extra")]\npub fn gated(p: Parser) { ok!(p.parse()); }\n';
 const files = {'src/lib.rs': source, 'Cargo.toml': '[package]\nname="sample"\nversion="0.1.0"\nedition="2021"\n[features]\ndefault=[]\nextra=[]\n'};
 const root = fixture(t, files);
 const active = line => calls(capture(root, {rust:{features:{sample:['extra']}}}), 'src/lib.rs').filter(c => c.line === line);
 const inactive = line => calls(capture(root), 'src/lib.rs').filter(c => c.line === line);
 assert.equal(active(4)[0].macroEvidence[0].name, 'ok');
 assert.equal(active(6)[0].macroEvidence[0].name, 'ok');
 assert.equal(inactive(4)[0].macroEvidence[0].name, 'ok');
 assert.deepEqual(inactive(6), []);
});

test('Rust duplicate macro definitions stay opaque instead of choosing one', t => {
 const source = 'pub struct Parser;\nimpl Parser { pub fn parse(&self) -> bool { true } }\nmod a { macro_rules! ok { ($e:expr) => { $e }; } pub fn one(p: super::Parser) { ok!(p.parse()); } }\nmod b { macro_rules! ok { ($e:expr) => { $e }; } pub fn two(p: super::Parser) { ok!(p.parse()); } }\n';
 const facts = capture(fixture(t, {'src/lib.rs': source}));
 assert.deepEqual(schemaErrors('raw-facts', facts), []);
 const macroCalls = calls(facts, 'src/lib.rs').filter(c => c.reason === 'rust-macro-not-expanded');
 assert.equal(macroCalls.length, 2);
 assert.ok(macroCalls.every(c => c.macroEvidence === undefined));
});

test('Rust does not attribute an imported macro name to a local definition', t => {
 const source = [
  'pub struct Parser;',
  'impl Parser { pub fn parse(&self) -> bool { true } }',
  '#[macro_use]',
  'mod helpers { macro_rules! ok { ($e:expr) => { $e }; } }',
  'mod user { use other::ok; pub fn f(p: super::Parser) { ok!(p.parse()); } }',
 ].join('\n') + '\n';
 const facts = capture(fixture(t, {'src/lib.rs': source}));
 assert.deepEqual(schemaErrors('raw-facts', facts), []);
 const macroCall = calls(facts, 'src/lib.rs').find(c => c.line === 5);
 assert.equal(macroCall.resolution, 'unresolved');
 assert.equal(macroCall.reason, 'rust-macro-not-expanded');
 assert.equal(macroCall.macroEvidence, undefined);
});

test('Rust follows a #[macro_use] sibling only when it precedes the callsite module', t => {
 const before = [
  'pub struct Parser;',
  'impl Parser { pub fn parse(&self) -> bool { true } }',
  '#[macro_use]',
  'mod macros { macro_rules! ok { ($e:expr) => { $e }; } }',
  'mod user { pub fn f(p: super::Parser) { ok!(p.parse()); } }',
 ].join('\n') + '\n';
 const after = [
  'pub struct Parser;',
  'impl Parser { pub fn parse(&self) -> bool { true } }',
  'mod user { pub fn f(p: super::Parser) { ok!(p.parse()); } }',
  '#[macro_use]',
  'mod macros { macro_rules! ok { ($e:expr) => { $e }; } }',
 ].join('\n') + '\n';
 const visible = calls(capture(fixture(t, {'src/lib.rs': before})), 'src/lib.rs').find(c => c.line === 5);
 assert.equal(visible.resolution, 'rust-inherent-source-candidate');
 assert.equal(visible.macroEvidence[0].name, 'ok');
 const opaque = calls(capture(fixture(t, {'src/lib.rs': after})), 'src/lib.rs').find(c => c.line === 3);
 assert.equal(opaque.resolution, 'unresolved');
 assert.equal(opaque.macroEvidence, undefined);
});

test('Rust requires a cfg-gated macro definition to be selected', t => {
 const source = 'pub struct Parser;\nimpl Parser { pub fn parse(&self) -> bool { true } }\n#[cfg(feature = "extra")]\nmacro_rules! ok { ($e:expr) => { $e }; }\npub fn f(p: Parser) { ok!(p.parse()); }\n';
 const files = {'src/lib.rs': source, 'Cargo.toml': '[package]\nname="sample"\nversion="0.1.0"\nedition="2021"\n[features]\ndefault=[]\nextra=[]\n'};
 const root = fixture(t, files);
 const inactive = calls(capture(root), 'src/lib.rs').find(c => c.line === 5);
 assert.equal(inactive.resolution, 'unresolved');
 assert.equal(inactive.macroEvidence, undefined);
 const active = calls(capture(root, {rust:{features:{sample:['extra']}}}), 'src/lib.rs').find(c => c.line === 5);
 assert.equal(active.resolution, 'rust-inherent-source-candidate');
 assert.equal(active.macroEvidence[0].name, 'ok');
});


test('Rust follows the block-local macro binding and restores the outer one after the block', t => {
 const source = [
  'pub struct Parser;',
  'impl Parser { pub fn parse(&self) -> bool { true } }',
  'macro_rules! ok { ($e:expr) => { $e }; }',
  'pub fn local_discard(p: Parser) { macro_rules! ok { ($e:expr) => { () }; } let _ = ok!(p.parse()); }',
  'pub fn restored(p: Parser) { let _ = ok!(p.parse()); }',
  'pub fn before_local(p: Parser) { let _ = ok!(p.parse()); macro_rules! ok { ($e:expr) => { () }; } }',
  'pub fn local_keep(p: Parser) { macro_rules! ok { ($e:expr) => { $e }; } let _ = ok!(p.parse()); }',
 ].join('\n') + '\n';
 const facts = capture(fixture(t, {'src/lib.rs': source}));
 assert.deepEqual(schemaErrors('raw-facts', facts), []);
 const at = line => calls(facts, 'src/lib.rs').find(c => c.line === line);
 const local = at(4);
 assert.equal(local.resolution, 'unresolved');
 assert.equal(local.reason, 'rust-macro-not-expanded');
 assert.equal(local.macroEvidence, undefined);
 const restored = at(5);
 assert.equal(restored.resolution, 'rust-inherent-source-candidate');
 assert.equal(restored.macroEvidence[0].definition.line, 3);
 const beforeLocal = at(6);
 assert.equal(beforeLocal.resolution, 'rust-inherent-source-candidate');
 assert.equal(beforeLocal.macroEvidence[0].definition.line, 3);
 const localKeep = at(7);
 assert.equal(localKeep.resolution, 'rust-inherent-source-candidate');
 assert.equal(localKeep.macroEvidence[0].definition.line, 7);
});

test('Rust keeps a macro argument only when the active cfg keeps its use', t => {
 const source = [
  'pub struct Parser;',
  'impl Parser { pub fn parse(&self) -> bool { true } }',
  'macro_rules! gated { ($e:expr) => { { #[cfg(feature = "extra")] let _ = $e; } }; }',
  'macro_rules! dead { ($e:expr) => { { #[cfg(any())] let _ = $e; } }; }',
  'pub fn kept(p: Parser) { let _ = gated!(p.parse()); }',
  'pub fn deleted(p: Parser) { let _ = dead!(p.parse()); }',
 ].join('\n') + '\n';
 const files = {'src/lib.rs': source, 'Cargo.toml': '[package]\nname="sample"\nversion="0.1.0"\nedition="2021"\n[features]\ndefault=[]\nextra=[]\n'};
 const root = fixture(t, files);
 const inactive = capture(root);
 for (const line of [5, 6]) {
  const row = calls(inactive, 'src/lib.rs').find(c => c.line === line);
  assert.equal(row.resolution, 'unresolved', `line ${line} stays unknown while the cfg is off`);
  assert.equal(row.reason, 'rust-macro-not-expanded');
  assert.equal(row.macroEvidence, undefined);
 }
 const active = calls(capture(root, {rust:{features:{sample:['extra']}}}), 'src/lib.rs');
 const kept = active.find(c => c.line === 5);
 assert.equal(kept.resolution, 'rust-inherent-source-candidate');
 assert.equal(kept.macroEvidence[0].name, 'gated');
 assert.equal(kept.macroEvidence[0].definition.line, 3);
 const stillDeleted = active.find(c => c.line === 6);
 assert.equal(stillDeleted.resolution, 'unresolved');
 assert.equal(stillDeleted.macroEvidence, undefined);
});
