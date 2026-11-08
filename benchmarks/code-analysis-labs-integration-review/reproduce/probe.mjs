import fs from 'node:fs';
import path from 'node:path';
import { extractFacts,loadConfig } from './candidate/archify/modules/code-analysis/lib/analysis.mjs';
import { buildQuestion } from './candidate/archify/modules/code-analysis/lib/explain.mjs';
import { captureChangeSide,buildChangeQuestion } from './candidate/archify/modules/code-analysis/lib/change-question.mjs';
const out=path.dirname(new URL(import.meta.url).pathname);
const cases = [
 ['ts','entry.ts','/* 😀 */ export function f(){return 1} export function run(){return f()}\r\n'],
 ['js','entry.mjs','/* 😀 */ export function f(){return 1} export function run(){return f()}\r\n'],
 ['py','entry.py','def f(): return "😀"\r\ndef run(): return f()\r\n'],
 ['java','Entry.java','public class Entry { /* 😀 */ public static int f(){return 1;} public static int run(){return f();} }\r\n'],
 ['go','entry.go','package p\n/* 😀 */ func f() int { return 1 }; func run() int { return f() }\r\n'],
 ['rust','src/lib.rs','/* 😀 */ pub fn f()->i32 {1} pub fn run()->i32 {f()}\r\n'],
 ['py-bom','entry.py','\ufeffdef f(): return 1\ndef run(): return f()\n'],
 ['rust-cr-comment','src/lib.rs','/* a\rb */ pub fn f()->i32 {1} pub fn run()->i32 {f()}\n'],
 ['go-cr','entry.go','package main\nfunc f() string { return `a\rb` }\nfunc main() { println(f()) }\n'],
 ['go-cr-comment','entry.go','package p\n/* a\rb */ func f() int { return 1 }; func run() int { return f() }\n'],
 ['rust-cr','src/lib.rs','pub fn f()->&\'static str { "a\rb" }\npub fn run()->&\'static str { f() }\n']
];
const results=[];
for (const [label,file,source] of cases){
 if(process.argv[2] && process.argv[2]!==label) continue;
 const lang=label.startsWith('go')?'go':label.startsWith('rust')?'rust':label==='js'?'ts':label.startsWith('py')?'py':label;
 const root=path.join(out,'fixtures',label);fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),source);
 if(lang==='go') fs.writeFileSync(path.join(root,'go.mod'),'module example.com/probe\n\ngo 1.18\n');
 if(lang==='rust') fs.writeFileSync(path.join(root,'Cargo.toml'),'[package]\nname="probe"\nversion="0.1.0"\nedition="2021"\n');
 try {
  const config=loadConfig();config.go={stdlib:false};config.rust={offline:true};
  const {facts}=extractFacts(root,{language:lang,config});
  fs.writeFileSync(path.join(out,`${label}-facts.json`),JSON.stringify(facts,null,2));
  const q=buildQuestion({question:'Where does run call?',entry:file,root,facts});
  results.push({label,extractOutcome:"returned",model:facts.callModel,functions:facts.functions,calls:facts.calls,entry:q.entry,coverage:q.calls.coverage,reason:q.calls.reason,navigation:q.calls.records.map(r=>r.targetNavigation)});
 } catch(e){ results.push({label,extractOutcome:"threw",message:e.message,diagnostic:e.diagnostic??e.receipt??e}); }
}
fs.writeFileSync(path.join(out,process.argv[2]?`${process.argv[2]}-probes.json`:'probes.json'),JSON.stringify({revision:'996e073ded7b99cbe885fbc4afab5d125412f6c1',scope:'owned independent source/range/navigation fixtures; Go SDK disabled',results},null,2));
console.log(JSON.stringify(results.map(r=>({label:r.label,extractOutcome:r.extractOutcome,model:r.model,message:r.message,calls:r.calls?.map(c=>c.resolution)})),null,2));
