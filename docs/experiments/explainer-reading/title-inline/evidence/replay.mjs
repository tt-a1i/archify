import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {renderExplainer as baseRender} from './base/archify/explainer/render.mjs';
import {renderExplainer as candidateRender} from '/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/archify/explainer/render.mjs';
import {unpackPageBundle} from './base/archify/explainer/page-bundle.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),lab='/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading';
const index=fs.readFileSync(lab+'/index.html','utf8');const cases=Function('return '+index.match(/const cases=(\[[\s\S]*?\n\]);/)[1])();
const results=[];
for(const entry of cases)for(const [i,version] of entry.versions.entries()){
 const name=entry.id+'-'+i,file=version[1],html=fs.readFileSync(lab+'/'+file,'utf8'),bundle=unpackPageBundle(JSON.parse(html.match(/<script\b[^>]*\bid="archify-explainer-prepared"[^>]*>([\s\S]*?)<\/script>/)[1]));
 const output={};for(const [variant,render]of [['base',baseRender],['candidate',candidateRender]]){fs.mkdirSync(root+'/'+variant,{recursive:true});output[variant]=render(bundle.document,{...bundle,preparedBundle:bundle});fs.writeFileSync(root+'/'+variant+'/'+name+'.html',output[variant]);}
 const heading=t=>t.match(/<h1>([\s\S]*?)<\/h1>/)[1],title=t=>t.match(/<title>([\s\S]*?)<\/title>/)[1];
 const withoutHead=t=>t.replace(/<h1>[\s\S]*?<\/h1>/,'<h1></h1>').replace(/<title>[\s\S]*?<\/title>/,'<title></title>');
 results.push({name,file,authoredTitle:bundle.document.meta.title,byteIdentical:output.base===output.candidate,restIdentical:withoutHead(output.base)===withoutHead(output.candidate),baseHeading:heading(output.base),candidateHeading:heading(output.candidate),baseTitle:title(output.base),candidateTitle:title(output.candidate),sha256:Object.fromEntries(Object.entries(output).map(([k,v])=>[k,createHash('sha256').update(v).digest('hex')]))});
}
fs.writeFileSync(root+'/replay.json',JSON.stringify({base:'56027318779fb1b5a665dce16a8eba7a631821d6',scope:'32 frozen authored documents and prepared resources; only current renderer differs, not new generation or provenance acceptance',results},null,2)+'\n');
console.log({total:results.length,identical:results.filter(x=>x.byteIdentical).length,changed:results.filter(x=>!x.byteIdentical).map(x=>({name:x.name,title:x.authoredTitle,restIdentical:x.restIdentical}))});
