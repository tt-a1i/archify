import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { parsePullRequest, preparePullRequest, normalizeScope } from '../lib/pull-request.mjs';
import { materializeTree } from '../lib/git-sources.mjs';
import { startAnalysisView, parseArgs } from '../bin/serve.mjs';
import { prepareAnalysisView } from '../bin/prepare.mjs';

const payload = html => JSON.parse(html.match(/id="bauify-analysis">([\s\S]*?)<\/script>/)[1]);
const git = (root,args) => execFileSync('git',['-C',root,...args],{encoding:'utf8',windowsHide:true,env:{...process.env,GIT_NO_LAZY_FETCH:'1'},stdio:['ignore','pipe','pipe']}).trim();
function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-pr-native-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const root=path.join(dir,'repo');fs.mkdirSync(root);git(root,['init']);
  const write=(file,text)=>fs.writeFileSync(path.join(root,file),text);
  const commit=()=>{git(root,['add','.']);git(root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','fixture']);return git(root,['rev-parse','HEAD']);};
  write('a.ts',"import { b } from './b'; export function a(x:boolean){return b();}\n");
  write('b.ts',"import { a } from './a'; export function b(){return a(true);}\n");
  write('removed.ts','export const previous=1;\n');
  const base=commit();
  write('a.ts',"import { b } from './b'; export function a(x:boolean){"+'if(x)return b();'.repeat(25)+"return 0;}\n");
  write('b.ts','export function b(){return 1;}\n');
  write('added.ts','export function added(){return 2;}\n');
  fs.unlinkSync(path.join(root,'removed.ts'));
  const head=commit();
  const files=[{filename:'a.ts',status:'modified'},{filename:'b.ts',status:'modified'},{filename:'added.ts',status:'added'},{filename:'removed.ts',status:'removed'}];
  const meta={number:42,title:'native PR flow',state:'open',changed_files:files.length,base:{sha:base,ref:'main'},head:{sha:head},updated_at:'2026-11-14T05:02:16Z'};
  let fail=false;
  const fetchJSON=async route=>{if(fail)throw Error('simulated capture failure');return route.includes('/files?')?files:route.includes('/compare/')?{merge_base_commit:{sha:base}}:meta;};
  const dependencies={preparePRSources:options=>preparePullRequest(options,{fetchJSON})};
  const args=['--pr','https://github.com/example/project/pull/42','--locale','zh-CN'];
  return {dir,root,base,head,args,dependencies,fail:()=>{fail=true;}};
}

test('PR options reuse native grammar and reject ambiguous sources',()=>{
  assert.equal(parseArgs(['repo','--out','out','--pr','42']).options['--pr'],'42');
  assert.throws(()=>parseArgs(['repo','--out','out','--repository','a/b']),/require --pr/);
  assert.deepEqual(parsePullRequest('https://github.com/a/b/pull/42'),{repository:'a/b',number:42,url:'https://github.com/a/b/pull/42'});
  for(const value of ['https://elsewhere.test/a/b/pull/42','https://github.com/a/b/pull/42?token=secret','42; echo test'])assert.throws(()=>parsePullRequest(value));
  for(const scope of ['../outside','/absolute','src/../outside','src\\file','.git/objects'])assert.throws(()=>normalizeScope(scope));
});

test('partial Git capture requests only selected blobs and preserves their exact bytes',async t=>{
  const f=fixture(t),cache=path.join(f.dir,'cache'),target=path.join(f.dir,'captured');
  git(f.root,['config','uploadpack.allowFilter','true']);
  fs.mkdirSync(path.join(f.root,'src'));fs.writeFileSync(path.join(f.root,'src/b with spaces.bin'),Buffer.from([0,1,10,255]));git(f.root,['add','.']);git(f.root,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','binary']);
  const sha=git(f.root,['rev-parse','HEAD']);
  git(f.dir,['clone','--bare','--no-local','--filter=blob:none',pathToFileURL(f.root).href,cache]);
  const outside=git(f.root,['rev-parse','HEAD:a.ts']);
  assert.throws(()=>git(cache,['cat-file','-e',outside]));
  await materializeTree({cache,sha,scope:'src',target,blobSource:f.root});
  assert.deepEqual(fs.readFileSync(path.join(target,'b with spaces.bin')),Buffer.from([0,1,10,255]));
  assert.throws(()=>git(cache,['cat-file','-e',outside]),'unrelated blobs remain unfetched');
});

test('offline PR preparation uses native findings, localization, source markers and tasks',async t=>{
  const f=fixture(t),out=path.join(f.dir,'out'),dirtyBefore=git(f.root,['status','--porcelain']);
  const result=await prepareAnalysisView([f.root,'--out',out,...f.args],f.dependencies);
  const data=payload(fs.readFileSync(result.html,'utf8'));
  assert.equal(result.diagram,null);assert.equal(data.ui.locale,'zh-CN');assert.equal(data.ui.mode,'standalone');
  assert.equal(data.pullRequest.baseSHA,f.base);assert.equal(data.pullRequest.headSHA,f.head);
  assert.equal(data.repository.sourceKind,'git-tree');assert.equal(data.repository.revision,f.head);
  assert.equal(data.overview.review.comparison.comparable,true);assert.ok(data.overview.review.comparison.notDetected.length>0);
  for(const id of data.overview.priorities) assert.ok(['new','evidence-changed'].includes(data.findings.find(f=>f.id===id).review.since));
  assert.ok(data.snippets['a.ts'].changes.modified.length>0);
  assert.match(data.pullRequest.beforeSources['b.ts'].lines.join('\n'),/import/);
  assert.ok(data.pullRequest.changes.some(c=>c.path==='removed.ts'&&c.status==='removed'));
  assert.match(result.resume.command,/--pr https:\/\/github.com\/example\/project\/pull\/42/);
  assert.ok(Object.keys(data.tasks).length>0);
  for(const item of Object.values(data.tasks))assert.equal(item.task.source.gitHead,f.head);
  assert.equal(git(f.root,['status','--porcelain']),dirtyBefore);
  assert.equal(git(f.root,['rev-parse','HEAD']),f.head);
});

test('live PR analysis verifies tasks against captured head, retains merge-base on review and preserves good results after failure',async t=>{
  const f=fixture(t),view=await startAnalysisView([f.root,'--out',path.join(f.dir,'out'),...f.args],f.dependencies);
  t.after(()=>{view.server.closeAllConnections();view.server.close();});
  const post=(route,input,refresh=false)=>fetch(view.url+route,{method:'POST',headers:{Origin:view.url,'X-Analysis-Token':view.token,'Content-Type':'application/json',...(refresh?{'X-Analysis-Refresh':'1'}:{})},...(input?{body:JSON.stringify(input)}:{})});
  assert.equal((await fetch(view.url+'/analyze',{method:'POST'})).status,403);
  const analyzed=await post('/analyze');assert.equal(analyzed.status,200,await analyzed.clone().text());
  const html=await analyzed.text(),data=payload(html),finding=data.findings[0];assert.ok(finding);
  // Mutable local edits must neither replace PR evidence nor invalidate pinned tasks.
  fs.writeFileSync(path.join(f.root,'a.ts'),'not the PR head anymore\n');
  const task=await post('/task',{ids:[finding.id],expected:{[finding.id]:finding.reviewTarget}});
  assert.equal(task.status,200,await task.clone().text());assert.equal((await task.json()).task.evidence.status,'valid');
  const review=await post('/review',{action:'accept',id:finding.id,expected:finding.reviewTarget,reason:'existing PR scope'});
  assert.equal(review.status,200,await review.clone().text());const saved=await review.json();
  assert.equal(payload(saved.html).pullRequest.baseSHA,f.base);assert.equal(payload(saved.html).overview.review.comparison.comparable,true);
  const last=fs.readFileSync(path.join(view.out,'analysis/repo.analysis.html'),'utf8');
  f.fail();const failed=await post('/analyze',null,true);assert.equal(failed.status,500);
  assert.equal(fs.readFileSync(path.join(view.out,'analysis/repo.analysis.html'),'utf8'),last);
});
