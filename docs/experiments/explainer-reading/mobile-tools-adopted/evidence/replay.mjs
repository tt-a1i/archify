import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {renderExplainer as baseRender} from './frozen/archify/explainer/render.mjs';
import {renderExplainer as candidateRender} from '/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/archify/explainer/render.mjs';
import {unpackPageBundle} from './frozen/archify/explainer/page-bundle.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),lab='/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/docs/experiments/explainer-reading';
const index=fs.readFileSync(root+'/index.frozen.html','utf8');const cases=Function('return '+index.match(/const cases=(\[[\s\S]*?\n\]);/)[1])();
const results=[];
for(const entry of cases)for(const [i,version] of entry.versions.entries()){
 const name=entry.id+'-'+i,file=version[1],html=fs.readFileSync(lab+'/'+file,'utf8'),bundle=unpackPageBundle(JSON.parse(html.match(/<script\b[^>]*\bid="archify-explainer-prepared"[^>]*>([\s\S]*?)<\/script>/)[1]));
 const output={};for(const [variant,render]of [['base',baseRender],['candidate',candidateRender]]){fs.mkdirSync(root+'/'+variant,{recursive:true});output[variant]=render(bundle.document,{...bundle,preparedBundle:bundle});const target=root+'/'+variant+'/'+name+'.html';if(fs.existsSync(target)){if(fs.readFileSync(target,'utf8')!==output[variant])throw Error('frozen output changed: '+target);}else fs.writeFileSync(target,output[variant]);}
 const baseAssets=['reader.css','reader.js'].map(n=>fs.readFileSync(root+'/frozen/archify/explainer/'+n,'utf8'));
 const candidateAssets=['reader.css','reader.js'].map(n=>fs.readFileSync('/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/archify/explainer/'+n,'utf8'));
 const strip=(html,assets)=>assets.reduce((s,asset)=>{if(!s.includes(asset))throw Error('missing embedded runtime');return s.replace(asset,'');},html);
 results.push({name,file,restIdentical:strip(output.base,baseAssets)===strip(output.candidate,candidateAssets),sha256:Object.fromEntries(Object.entries(output).map(([k,v])=>[k,createHash('sha256').update(v).digest('hex')]))});
}
fs.writeFileSync(root+'/replay.json',JSON.stringify({base:'6828a8678b55dd698798ca7b0e8107eafeb7a946',scope:'46 frozen authored documents/prepared resources; exact CSS-only proposal from PR 1076; fixed input, not author generation',results},null,2)+'\n');
console.log({total:results.length,restIdentical:results.filter(x=>x.restIdentical).length});
