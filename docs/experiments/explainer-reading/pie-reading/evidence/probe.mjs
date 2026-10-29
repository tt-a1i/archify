import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {compileExplainerChart as before} from './before-runtime/archify/explainer/charts.mjs';
import {compileExplainerChart as after} from './runtime/archify/explainer/charts.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),data='pie\n "A":10\n "B":3\n "C":8';
const cases={plain:data,comment:'%% comment\n'+data,frontmatter:'---\nconfig:\n  pie:\n    legendPosition: bottom\n---\n'+data,directive:'%%{init: {"pie":{"legendPosition":"bottom"}}}%%\n'+data,multiline:'pie\n showData\n "A"\n :\n 10\n "B":3\n "C":8',duplicate:'pie\n "A":1\n "A":9\n "B":1',negative:'pie\n "A":-1\n "B":3',bar:'xychart-beta\n x-axis [A,B,C]\n bar [10,3,8]'};
fs.mkdirSync(root+'/probe-svg',{recursive:true});
const rows=Object.entries(cases).map(([name,input])=>{const a=before(input),b=after(input),result={name,input,before:{width:a.width,height:a.height,error:a.error,line:a.line,text:[...((a.svg||'').matchAll(/<text\b[^>]*>([^<]*)<\/text>/g))].map(x=>x[1])},after:{width:b.width,height:b.height,error:b.error,line:b.line,text:[...((b.svg||'').matchAll(/<text\b[^>]*>([^<]*)<\/text>/g))].map(x=>x[1])},identical:JSON.stringify(a)===JSON.stringify(b)};for(const [arm,value] of [['before',a],['after',b]])if(value.svg)fs.writeFileSync(`${root}/probe-svg/${name}-${arm}.svg`,value.svg);return result;});
for(const name of ['comment','frontmatter','directive']){const row=rows.find(r=>r.name===name);if(!row.after.text.includes('A · 10 (48%)')||row.before.text.includes('A · 10 (48%)'))throw new Error('Expected configured legend contrast: '+name);}
const duplicate=rows.find(r=>r.name==='duplicate');if(!duplicate.after.text.includes('A · 1 (50%)')||!duplicate.after.text.includes('B · 1 (50%)'))throw new Error('Duplicate semantics differ');
if(rows.find(r=>r.name==='multiline').after.error)throw new Error('Multiline compatibility failed');if(!rows.find(r=>r.name==='negative').after.error)throw new Error('Negative value accepted');if(!rows.find(r=>r.name==='bar').identical)throw new Error('Bar control changed');
fs.writeFileSync(process.argv[2]||root+'/probe-1.json',JSON.stringify(rows,null,2)+'\n');console.log(rows.map(({name,identical,before,after})=>({name,identical,before:before.text,after:after.text,error:after.error})));
