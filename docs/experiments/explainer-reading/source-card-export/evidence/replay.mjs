import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {renderExplainer as baseRender} from './frozen/archify/explainer/render.mjs';
import {renderExplainer as candidateRender} from '/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/archify/explainer/render.mjs';
import {unpackPageBundle} from './frozen/archify/explainer/page-bundle.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),lab='/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading';
const index=fs.readFileSync(lab+'/index.html','utf8');const cases=Function('return '+index.match(/const cases=(\[[\s\S]*?\n\]);/)[1])();
const results=[];
for(const entry of cases)for(const [i,version] of entry.versions.entries()){
 const name=entry.id+'-'+i,file=version[1],html=fs.readFileSync(lab+'/'+file,'utf8'),bundle=unpackPageBundle(JSON.parse(html.match(/<script\b[^>]*\bid="archify-explainer-prepared"[^>]*>([\s\S]*?)<\/script>/)[1]));
 const output={};for(const [variant,render]of [['base',baseRender],['candidate',candidateRender]]){fs.mkdirSync(root+'/'+variant,{recursive:true});output[variant]=render(bundle.document,{...bundle,preparedBundle:bundle});fs.writeFileSync(root+'/'+variant+'/'+name+'.html',output[variant]);}
 const baseAssets=['reader.css','reader.js'].map(n=>fs.readFileSync(root+'/frozen/archify/explainer/'+n,'utf8'));
 const candidateAssets=['reader.css','reader.js'].map(n=>fs.readFileSync('/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/archify/explainer/'+n,'utf8'));
 const strip=(html,assets)=>assets.reduce((s,asset)=>{if(!s.includes(asset))throw Error('missing embedded runtime');return s.replace(asset,'');},html);
 results.push({name,file,restIdentical:strip(output.base,baseAssets)===strip(output.candidate,candidateAssets),sha256:Object.fromEntries(Object.entries(output).map(([k,v])=>[k,createHash('sha256').update(v).digest('hex')]))});
}
fs.writeFileSync(root+'/replay.json',JSON.stringify({base:'0b91a0cf1ffca41ba2b386473d3da910dab8d4e0',scope:'34 frozen authored documents/prepared resources; reader script only; fixed input, not author generation',results},null,2)+'\n');
console.log({total:results.length,restIdentical:results.filter(x=>x.restIdentical).length});
