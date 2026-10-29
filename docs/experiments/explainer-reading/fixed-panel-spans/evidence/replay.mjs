import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {renderExplainer as baseRender} from './base/archify/explainer/render.mjs';
import {renderExplainer as candidateRender} from '/Users/tsk/.codex/worktrees/explainer-reading-lab/archify/archify/explainer/render.mjs';
import {unpackPageBundle} from './base/archify/explainer/page-bundle.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),repo='/Users/tsk/.codex/worktrees/explainer-reading-lab/archify',lab=repo+'/docs/experiments/explainer-reading';
const cases=[['git-explicit','git-diff-endpoints/attempts/candidate-2.html'],['git-auto','git-diff-endpoints/author/answer.html'],['rust','rust-default/candidate.html'],['jq','jq-default/candidate.html'],['thread','thread-cancel/two-columns.html'],['pie','pie-reading/candidate.html'],['native','phone-preview/candidate.html']];
const results=[];for(const [name,file] of cases){
 const html=fs.readFileSync(lab+'/'+file,'utf8'),bundle=unpackPageBundle(JSON.parse(html.match(/<script\b[^>]*\bid="archify-explainer-prepared"[^>]*>([\s\S]*?)<\/script>/)[1]));
 for(const [variant,render] of [['base',baseRender],['candidate',candidateRender]]){
  fs.mkdirSync(root+'/'+variant,{recursive:true});const text=render(bundle.document,{...bundle,preparedBundle:bundle});fs.writeFileSync(root+'/'+variant+'/'+name+'.html',text);
  results.push({name,file,variant,fixed:bundle.document.panels.filter(p=>p.span!==undefined).map(p=>({id:p.id,span:p.span})),sha256:createHash('sha256').update(text).digest('hex')});
 }
}fs.writeFileSync(root+'/replay-identity.json',JSON.stringify({base:'7e836b98525a5bcbc2d8e5c1ce2b2d962b077130',scope:'frozen authored document, sources and prepared diagrams; only reader runtime differs; not new generation or artifact provenance acceptance',results},null,2)+'\n');console.log(results.map(r=>({name:r.name,variant:r.variant,fixed:r.fixed})));
