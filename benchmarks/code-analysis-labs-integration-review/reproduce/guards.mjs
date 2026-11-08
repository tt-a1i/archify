import fs from 'node:fs';
import path from 'node:path';
import {extractFacts,loadConfig} from './candidate/archify/modules/code-analysis/lib/analysis.mjs';
const out=path.dirname(new URL(import.meta.url).pathname),results=[];
const cases=[
 ['js','ts',{'impl.mjs':'export function f(){return 1}','entry.mjs':'import {f} from "./impl.mjs"; export function run(f){return f()}'}],
 ['ts','ts',{'impl.ts':'export function f(){return 1}','entry.ts':'import {f} from "./impl"; export function run(f:()=>number){return f()}'}],
 ['py','py',{'impl.py':'def f(): return 1\n','entry.py':'from impl import f\ndef run(f): return f()\n'}],
 ['java','java',{'Impl.java':'public class Impl { public static int f(){return 1;} }','Other.java':'public class Other { public int f(){return 2;} }','Entry.java':'public class Entry { public static int run(Other Impl){return Impl.f();} }'}],
 ['go','go',{'go.mod':'module example.com/probe\ngo 1.18\n','entry.go':'package p\nfunc f() int {return 1}; func run(f func() int) int {return f()}'}],
 ['rust','rust',{'Cargo.toml':'[package]\nname="probe"\nversion="0.1.0"\nedition="2021"\n','src/lib.rs':'pub struct X; impl X {pub fn f()->i32 {1}} pub fn run<X>() {X::f();}'}]
];
for(const [label,language,files] of cases){const root=path.join(out,'guards',label);for(const[file,text]of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),text)}const config=loadConfig();config.go={stdlib:false};config.rust={offline:true};const {facts}=extractFacts(root,{language,config});const targets=facts.calls.filter(c=>c.target);results.push({label,model:facts.callModel,expected:'one unresolved call, no target under value/type parameter shadow',observed:facts.calls,pass:targets.length===0&&facts.calls.length===1&&facts.calls[0].resolution==='unresolved'});}
fs.writeFileSync(path.join(out,'guards.json'),JSON.stringify({revision:'996e073ded7b99cbe885fbc4afab5d125412f6c1',results},null,2));console.log(JSON.stringify(results,null,2));if(results.some(r=>!r.pass))process.exitCode=1;
