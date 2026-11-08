import fs from 'node:fs';
import path from 'node:path';
import {loadConfig,extractFacts} from './candidate/archify/modules/code-analysis/lib/analysis.mjs';
import {captureChangeSide,buildChangeQuestion} from './candidate/archify/modules/code-analysis/lib/change-question.mjs';
import {buildQuestion} from './candidate/archify/modules/code-analysis/lib/explain.mjs';
const out=path.dirname(new URL(import.meta.url).pathname),results=[];
const cases=[
 ['js','ts','impl.mjs','caller.mjs',{'impl.mjs':'export function f(){ return 1 }','api.mjs':'export {f} from "./impl.mjs";','caller.mjs':'import {f} from "./api.mjs"; export function run(){ return f() }'}],
 ['ts','ts','impl.ts','caller.ts',{'impl.ts':'export function f(){ return 1 }','api.ts':'export {f} from "./impl";','caller.ts':'import {f} from "./api"; export function run(){ return f() }'}],
 ['py','py','impl.py','caller.py',{'impl.py':'def f(): return 1\n','api.py':'from impl import f\n','caller.py':'from api import f\ndef run(): return f()\n'}],
 ['java','java','Impl.java','Caller.java',{'Impl.java':'public class Impl { public static int f() { return 1; } }','Caller.java':'public class Caller { public static int run() { return Impl.f(); } }'}],
 ['go','go','impl.go','caller.go',{'go.mod':'module example.com/probe\ngo 1.18\n','impl.go':'package p\nfunc f() int { return 1 }','caller.go':'package p\nfunc run() int { return f() }'}],
 ['rust','rust','src/imp.rs','src/lib.rs',{'Cargo.toml':'[package]\nname="probe"\nversion="0.1.0"\nedition="2021"\n','src/imp.rs':'pub fn f()->i32 { return 1; }','src/lib.rs':'mod imp; pub fn run()->i32 { imp::f() }'}]
];
for(const [label,language,entry,caller,files] of cases){
 const roots=['base','head'].map(side=>path.join(out,'contracts',label,side));
 for(const [i,root] of roots.entries())for(const [file,source]of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),i&&file===entry?source.replace('return 1','return 2'):source)}
 const config=loadConfig();config.go={stdlib:false};config.rust={offline:true};
 const base=captureChangeSide(roots[0],config,language),head=captureChangeSide(roots[1],config,language);
 const args={question:'What changed?',entry,base,head,config};
 const q=buildChangeQuestion(args),f= q.changedDefinitions.items[0];
 const saved=buildQuestion({question:'Where does run call?',entry:caller,root:roots[1],facts:head.facts});
 const originalModel=head.facts.callModel;
 head.facts.callModel='review-unknown-v999';
 const unknown=buildQuestion({question:'Where does run call?',entry:caller,root:roots[1],facts:head.facts});
 head.facts.callModel=originalModel;
 fs.appendFileSync(path.join(roots[1],caller),'\n// reviewer drift\n');
 const stale=buildChangeQuestion(args).changedDefinitions.items[0].head.knownReferences;
 const observed={changed:q.changedDefinitions.total,baseRefs:f?.base.knownReferences.total,headRefs:f?.head.knownReferences.total,savedNavigation:saved.calls.records.map(r=>r.targetNavigation.status),unknownCoverage:unknown.calls.coverage,unknownTotal:unknown.calls.total,staleNavigation:stale.items.map(r=>r.navigation.status)};
 const expected={changed:1,baseRefs:1,headRefs:1,savedNavigation:['valid'],unknownCoverage:'unavailable',unknownTotal:null,staleNavigation:['changed']};
 results.push({label,expected,observed,pass:JSON.stringify(observed)===JSON.stringify(expected),brief:q});
}
fs.writeFileSync(path.join(out,'contracts.json'),JSON.stringify({revision:'996e073ded7b99cbe885fbc4afab5d125412f6c1',results},null,2));
console.log(JSON.stringify(results.map(({brief,...r})=>r),null,2));
if(results.some(r=>!r.pass))process.exitCode=1;
