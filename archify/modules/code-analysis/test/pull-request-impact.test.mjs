import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {extractFacts,buildGraph,evaluateGraph,loadConfig,mergeConfig} from '../lib/analysis.mjs';
import {buildPullRequestImpact} from '../lib/pull-request-impact.mjs';
import {buildOverview} from '../overlay/overview.mjs';
import {buildAtlas} from '../overlay/atlas.mjs';
import {buildMarkerModel} from '../overlay/pull-request.mjs';

function pair(t,baseFiles,headFiles,custom={},language='ts') {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-impact-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const roots={},sides={},config=mergeConfig(loadConfig(),custom);
  for(const [side,files]of[['base',baseFiles],['head',headFiles]]){
    const root=path.join(dir,side);roots[side]=root;fs.mkdirSync(root);
    for(const [file,text]of Object.entries(files)){const target=path.join(root,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,text);}
    const {facts}=extractFacts(root,{language,config}),graph=buildGraph(facts,config),findings=evaluateGraph(graph,config,facts,{root});
    sides[side]={facts,graph,findings};
  }
  const changedFiles=[...new Set([...Object.keys(baseFiles),...Object.keys(headFiles)])].filter(file=>baseFiles[file]!==headFiles[file]).map(file=>({path:file,status:!baseFiles[file]?'added':!headFiles[file]?'removed':'modified'}));
  const options={baseFacts:sides.base.facts,headFacts:sides.head.facts,baseGraph:sides.base.graph,headGraph:sides.head.graph,
    baseFindings:sides.base.findings,headFindings:sides.head.findings,baseRoot:roots.base,headRoot:roots.head,changedFiles};
  return {options,sides,impact:buildPullRequestImpact(options)};
}
const stable={
  'lib/target.ts':'export function target(x:boolean){return 1;}\n',
  'app/caller.ts':"import {target} from '../lib/target'; export function caller(){return target(true);}\n",
  'unrelated/hot.ts':'export function hot(x:boolean){'+'if(x)return 1;'.repeat(35)+'return 0;}\n'
};

test('PR impact follows a same-metric source change into an unchanged caller and leaves old hotspots out',t=>{
  const {impact,sides}=pair(t,stable,{...stable,'lib/target.ts':'export function target(x:boolean){return 2;}\n'});
  assert.ok(impact.records.some(r=>r.kind==='definition-text'&&r.path==='lib/target.ts'));
  const users=impact.records.find(r=>r.kind==='known-users'&&r.path==='lib/target.ts');
  assert.ok(users);assert.equal(users.callers.coverage,'available');assert.equal(users.callers.total,1);assert.equal(users.unchangedCallers,1);
  assert.ok(users.locations.some(loc=>loc.file==='app/caller.ts'&&loc.relation==='bound-call'&&loc.unchanged));
  assert.equal(impact.records.some(r=>r.path==='unrelated/hot.ts'),false);
  assert.equal(impact.records.some(r=>r.kind==='function-metrics'),false);
  assert.equal(impact.coverage.work.parsedFiles,1);assert.equal(impact.coverage.work.repositoryScans,0);
  const atlases=['base','head'].map(side=>buildAtlas({facts:sides[side].facts,graph:sides[side].graph,findings:sides[side].findings.diagnostics}));
  const markers=buildMarkerModel(...atlases,['lib/target.ts'],impact.records);
  const changed=markers.records.find(record=>record.kind==='function'&&record.path==='lib/target.ts');
  assert.equal(changed.status,'modified');assert.equal(changed.before.complexity,changed.after.complexity);
  assert.equal(markers.modules.find(module=>module.id==='lib').functions.modified,1);
});

test('line-only movement does not turn an existing warning or a shifted reference into PR impact',t=>{
  const {impact}=pair(t,stable,{...stable,'lib/target.ts':'\n\n'+stable['lib/target.ts']});
  assert.equal(impact.records.length,0);assert.equal(impact.coverage.positionOnly,1);
});

for(const [language,files,target,caller] of [
  ['py',{'lib/target.py':'def target():\n    return 1\n','app/caller.py':'from lib.target import target\ndef caller():\n    return target()\n'},'lib/target.py','app/caller.py'],
  ['java',{'core/Target.java':'package core; public class Target { public static int target(){return 1;} }\n','app/Caller.java':'package app; import core.Target; public class Caller { public static int caller(){return Target.target();} }\n'},'core/Target.java','app/Caller.java'],
]) test(`${language} PR impact reuses native definition ranges and direct bindings`,t=>{
  const {impact}=pair(t,files,{...files,[target]:files[target].replace('return 1','return 2')},{},language);
  assert.ok(impact.records.some(record=>record.kind==='definition-text'&&record.path===target));
  assert.ok(impact.records.some(record=>record.kind==='known-users'&&record.locations.some(loc=>loc.file===caller&&loc.relation==='bound-call'&&loc.unchanged)));
  assert.equal(impact.records.some(record=>record.kind==='function-metrics'),false);
});

test('a changed module-level value retains its unchanged importer without inventing a function metric',t=>{
  const original={'lib/value.ts':'export const value=1;\n','app/reader.ts':"import {value} from '../lib/value';export const result=value;\n"};
  const {impact}=pair(t,original,{...original,'lib/value.ts':'export const value=2;\n'});
  assert.ok(impact.records.some(record=>record.kind==='file-source'&&record.path==='lib/value.ts'));
  const users=impact.records.find(record=>record.kind==='known-importers');assert.ok(users);
  assert.ok(users.locations.some(loc=>loc.file==='app/reader.ts'&&loc.unchanged));
  assert.equal(impact.records.some(record=>record.kind==='function-metrics'),false);
});

test('a new dependency reports its effect on an existing module and links the existing constraint as context',t=>{
  const {impact,sides}=pair(t,stable,{...stable,'feature/consumer.ts':"import {target} from '../lib/target';export const result=target(true);\n"},{rules:{coupling:{hub:{fanIn:1,fanOut:0}}}});
  const module=impact.records.find(r=>r.kind==='module-coupling'&&r.module==='lib');
  assert.ok(module);assert.equal(module.before.fanIn,1);assert.equal(module.after.fanIn,2);
  const hub=sides.base.findings.diagnostics.find(f=>f.code==='coupling/hub'&&f.subject.module==='lib');assert.ok(hub);
  assert.ok(module.contexts.some(context=>context.id===hub.id));
  assert.ok(impact.records.some(r=>r.kind==='dependency-added'&&r.from==='feature/consumer.ts'&&r.to==='lib/target.ts'));
  assert.equal(impact.findingIds.includes(hub.id),false,'the unchanged constraint is supporting context, not a newly introduced finding');
});

test('existing transitive reach measurements can change even when that module and its direct fan-in are untouched',t=>{
  const original={'core/shared.ts':'export function shared(){return 1;}\n','mid/api.ts':"import {shared} from '../core/shared';export function api(){return shared();}\n",'app/main.ts':"import {api} from '../mid/api';export const value=api();\n"};
  const {impact,sides}=pair(t,original,{...original,'feature/use.ts':"import {api} from '../mid/api';export const value=api();\n"},{rules:{coupling:{concentration:{minModules:3,reachShare:0.4,sizeShare:1}}}});
  assert.equal(sides.base.graph.modules.find(m=>m.id==='core').fanIn,sides.head.graph.modules.find(m=>m.id==='core').fanIn);
  const measured=impact.records.find(r=>r.kind==='structural-measures'&&r.module==='core');assert.ok(measured);
  assert.ok(measured.changes.some(change=>change.field==='reach.dependents'&&change.before===2&&change.after===3));
  assert.equal(impact.records.some(r=>r.kind==='definition-text'&&r.path==='core/shared.ts'),false);
});

test('type-only to value import is a dependency change even when file endpoints are identical',t=>{
  const original={'a.ts':"import type {B} from './b';export const a:B|null=null;\n",'b.ts':"import {a} from './a';export interface B{x:number};export const b=a;\n"};
  const {impact,sides}=pair(t,original,{...original,'a.ts':"import {b} from './b';export const a=b;\n"});
  const dependency=impact.records.find(r=>r.kind==='dependency-changed'&&r.from==='a.ts'&&r.to==='b.ts');assert.ok(dependency);
  assert.equal(dependency.before.forms[0].typeOnly,true);assert.equal(dependency.after.forms[0].typeOnly,false);
  const existing=sides.base.findings.diagnostics.find(f=>f.code==='coupling/cycle');assert.ok(existing);
  assert.ok(dependency.contexts.some(context=>context.id===existing.id));
  assert.equal(sides.base.findings.diagnostics.some(f=>f.code==='coupling/import-cycle'),false);
  assert.ok(impact.records.some(record=>record.kind==='structural-finding-added'&&record.code==='coupling/import-cycle'));
});

test('budgets and unknown call models stay explicit rather than claiming no affected callers',t=>{
  const {options}=pair(t,stable,{...stable,'lib/target.ts':'export function target(x:boolean){return 2;}\n'});
  const limited=buildPullRequestImpact({...options,limits:{files:0}});
  assert.equal(limited.status,'partial');assert.equal(limited.coverage.work.parsedFiles,0);assert.ok(limited.coverage.skipped.some(s=>s.reason==='source-reading-budget'));
  const unknown=buildPullRequestImpact({...options,headFacts:{...options.headFacts,callModel:'future-unknown-model'}});
  const source=unknown.records.find(r=>r.kind==='definition-text');assert.ok(source);assert.equal(source.callers.coverage,'unavailable');assert.equal(source.callers.total,null);
  assert.equal(unknown.records.some(r=>r.kind==='known-users'),false);assert.equal(unknown.records.find(r=>r.kind==='known-importers').importers,1);
});

test('PR priorities never fall back to the full head when the impact evidence is missing',()=>{
  const finding={id:'COMP-111111111111',code:'complexity/function',dimension:'complexity',severity:'warning',subject:{file:'old.ts',function:'old'},evidence:{complexity:99},moduleIds:['app'],componentIds:[]};
  const graph={repository:{language:'ts'},modules:[{id:'app',files:1,loc:1,fanIn:0,fanOut:0}],edges:[],excluded:{roles:[],files:0},unresolved:{}};
  const overview=buildOverview({findings:[finding],graph,run:{pullRequest:{},review:{comparison:{comparable:false,new:[],notDetected:[],evidenceChanged:[]}}}});
  assert.deepEqual(overview.priorities,[]);assert.equal(overview.counts.findings,1);
});
