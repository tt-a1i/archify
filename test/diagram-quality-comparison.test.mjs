import test from 'node:test';
import assert from 'node:assert/strict';
import {buildComparison} from '../benchmarks/diagram-quality/comparison.mjs';
const baseRevision='a'.repeat(40),candidateRevision='b'.repeat(40);
const identity={manifestHash:'manifest',evaluatorHash:'recorded-evaluator',profileHash:'profile',budget:{maxDurationMs:60000}};
const plannedRuns=[{taskId:'one',model:'same',repeat:1},{taskId:'two',model:'same',repeat:1}];
const row=(arm,taskId='one',change={})=>({runId:arm+taskId,taskId,arm,model:'same',repeat:1,revision:arm==='base'?baseRevision:candidateRevision,identity,modelConfiguration:{temperature:0},status:'complete',scores:{content:100,layout:90,speed:80,cost:70,human:null},raw:{durationMs:20000,deliveryDurationMs:15000,totalTokens:120,costUsd:.02},delivery:{status:'delivered'},...change});
const build=rows=>buildComparison({baseRevision,candidateRevision,plannedRuns,rows});
test('missing arms remain visible, suppress aggregate scores and never create a fabricated delta',()=>{
 const c=build([row('base'),row('candidate'),row('candidate','two')]);
 assert.equal(c.pairs.length,2);assert.equal(c.pairs[1].base,null);assert.equal(c.pairs[1].delta.content,null);
 assert.equal(c.summary.base.missing,1);assert.equal(c.summary.base.scores.content,null);
 assert.equal(c.summary.base.automatic,null);assert.equal(c.summary.base.comprehensive,null);
});
test('paired improvements retain raw timing and failures in their original task denominator',()=>{
 const failed=row('candidate','two',{status:'failed',knownFailure:true,scores:{content:0,layout:0,speed:0,cost:0,human:null},delivery:{status:'timeout'}});
 const c=build([row('base'),row('base','two'),row('candidate'),failed]);
 assert.equal(c.summary.candidate.scores.content,50);assert.equal(c.summary.candidate.failed,1);assert.equal(c.summary.candidate.delivered,1);
 assert.equal(c.pairs[1].delta.content,-100);assert.equal(c.summary.base.raw.durationMs,20000);assert.equal(c.summary.base.raw.deliveryDurationMs,15000);
});
test('unequal repeats average inside tasks before equal weighting across tasks',()=>{
 const plan=[...plannedRuns,{taskId:'one',model:'same',repeat:2}];
 const rows=['base','candidate'].flatMap(arm=>[row(arm),row(arm,'one',{runId:arm+'repeat',repeat:2,scores:{content:0,layout:0,speed:0,cost:0,human:null}}),row(arm,'two')]);
 const c=buildComparison({baseRevision,candidateRevision,plannedRuns:plan,rows});assert.equal(c.summary.base.scores.content,75);
});
test('mixed model settings, identities, revisions, duplicate and unplanned cells are rejected',()=>{
 for(const bad of [row('candidate','one',{identity:{...identity,profileHash:'other'}}),row('candidate','one',{modelConfiguration:{temperature:1}}),row('candidate','one',{revision:baseRevision})])assert.throws(()=>build([row('base'),bad]),/identity|configuration|revision/i);
 assert.throws(()=>build([row('base'),row('base')]),/duplicate/i);
 assert.throws(()=>build([row('base','unknown')]),/planned/i);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {comparisonFixture} from './fixtures/diagram-quality-evidence.mjs';
import {compareFromFiles} from '../benchmarks/diagram-quality/comparison.mjs';
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-compare-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
test('real file pipeline bundles evidence, drops absent previews and imports exact-artifact human ratings',async t=>{
 const dir=temp(t),{plan,write}=comparisonFixture(dir),original=JSON.parse(fs.readFileSync(path.join(dir,'base.json')));
 original.reviewImage={hash:'f'.repeat(64),path:'artifacts/'+ 'f'.repeat(64)+'.png'};write('base.json',original);
 const review={status:'completed',reviewerId:'one',rubricVersion:'diagram-quality-human-v1',independent:true,taskId:'one',artifactHash:original.artifactHash,ratings:{readability:4,hierarchy:4,layout:4,style:4,aesthetics:4}};
 write('reviews.json',{reviews:[review]});
 const result=await compareFromFiles({plan:path.join(dir,'plan.json'),output:path.join(dir,'out'),reviews:path.join(dir,'reviews.json')});
 const row=result.comparison.pairs[0].base;assert.equal(row.scores.human,75);assert.equal(row.repairCount,0);assert.equal(row.evidence.historyComplete,true);
 const exported=JSON.parse(fs.readFileSync(path.join(dir,'out/comparison.json')));
 assert.equal(exported.pairs[0].base.automatic,row.automatic);assert.equal(exported.pairs[0].base.comprehensive,row.comprehensive);
 assert.ok(Math.abs(row.comprehensive-(45+20+8+(.25-.02)/(.25-.01)*10+11.25))<1e-8);
 const csv=fs.readFileSync(path.join(dir,'out/comparison.csv'),'utf8').replace(/^\uFEFF/,'').trim().split('\r\n').map(line=>line.split(','));
 for(const name of ['automatic','comprehensive'])assert.equal(Number(csv[1][csv[0].indexOf(name)]),row[name]);
 assert.ok(fs.readFileSync(path.join(dir,'out/index.html'),'utf8').includes(row.comprehensive.toFixed(1)));
 assert.equal(row.evidence.previewPath,undefined);assert.ok(row.evidence.missing.some(v=>v.includes('PNG')));
 for(const f of [row.evidence.sourcePath,row.evidence.artifactPath,row.evidence.sessionPath,row.evidence.candidates[0].sourcePath])assert.ok(fs.existsSync(path.join(dir,'out',f)));
 const html=fs.readFileSync(path.join(dir,'out/index.html'),'utf8');assert.ok(html.includes('fixture-only-model'));assert.ok(html.includes('综合分'));
 await assert.rejects(compareFromFiles({plan:path.join(dir,'plan.json'),output:path.join(dir,'out')}),/empty/);
 assert.equal(plan.runs.length,2);
});
test('conflicting candidate timestamps and forged source bytes fail without altering original evidence',async t=>{
 const dir=temp(t),{plan,write}=comparisonFixture(dir),bytes=fs.readFileSync(path.join(dir,'base.json'));
 plan.runs[0].candidates[0].submittedAt='2026-10-23T00:00:10Z';write('plan.json',plan);
 await assert.rejects(compareFromFiles({plan:path.join(dir,'plan.json'),output:path.join(dir,'bad')}),/timestamp/);assert.equal(fs.existsSync(path.join(dir,'bad')),false);
 assert.deepEqual(fs.readFileSync(path.join(dir,'base.json')),bytes);
 plan.runs[0].candidates[0].submittedAt='2026-10-23T00:00:15Z';write('plan.json',plan);write('source.json','{}');
 await assert.rejects(compareFromFiles({plan:path.join(dir,'plan.json'),output:path.join(dir,'bad')}),/digest/);
});
test('repeated checks on identical JSON do not inflate repair counts',async t=>{
 const dir=temp(t),{plan,write}=comparisonFixture(dir);
 for(const arm of ['base','candidate']){
  const receipt=JSON.parse(fs.readFileSync(path.join(dir,arm+'.json')));receipt.candidates.push({...receipt.candidates[0],submittedAt:'2026-10-23T00:00:17Z'});write(arm+'.json',receipt);
  plan.runs.find(r=>r.arm===arm).candidates.push({...plan.runs[0].candidates[0],submittedAt:'2026-10-23T00:00:17Z'});
 }
 write('plan.json',plan);
 const result=await compareFromFiles({plan:path.join(dir,'plan.json'),output:path.join(dir,'out')});
 assert.equal(result.comparison.pairs[0].base.repairCount,0);
});
test('malformed generated JSON remains a recorded failure with inspectable candidate evidence',async t=>{
 const dir=temp(t),{plan,write}=comparisonFixture(dir);
 const {sha256}=await import('../benchmarks/diagram-quality/verification.mjs');
 write('rejected.json','{');
 const receipt=JSON.parse(fs.readFileSync(path.join(dir,'base.json')));
 receipt.status='invalid_source';receipt.delivery={status:'invalid_source'};receipt.sourceHash=sha256('{');receipt.artifactHash=null;
 receipt.candidates=[{sourceHash:receipt.sourceHash,submittedAt:'2026-10-23T00:00:15Z'}];
 write('base.json',receipt);
 Object.assign(plan.runs[0],{source:'rejected.json',artifact:undefined,candidates:[{source:'rejected.json',submittedAt:'2026-10-23T00:00:15Z'}]});
 write('plan.json',plan);
 const result=await compareFromFiles({plan:path.join(dir,'plan.json'),output:path.join(dir,'out')});
 const row=result.comparison.pairs[0].base;
 assert.equal(row.scores.content,0);assert.equal(row.knownFailure,true);
 assert.ok(fs.existsSync(path.join(dir,'out',row.evidence.candidates[0].sourcePath)));
 assert.equal(result.comparison.summary.base.failed,1);
});
test('stored ratings with a missing artifact do not abort the comparison or gain human credit',async t=>{
 const dir=temp(t),{plan,write}=comparisonFixture(dir);
 const receipt=JSON.parse(fs.readFileSync(path.join(dir,'base.json')));
 receipt.human={status:'completed',reviews:[{taskId:'one',artifactHash:receipt.artifactHash,status:'completed',reviewerId:'historical-rater',rubricVersion:'diagram-quality-human-v1',independent:true,ratings:{readability:4,hierarchy:4,layout:4,style:4,aesthetics:4}}]};
 write('base.json',receipt);delete plan.runs[0].artifact;write('plan.json',plan);
 const {comparison}=await compareFromFiles({plan:path.join(dir,'plan.json'),output:path.join(dir,'out')});
 const row=comparison.pairs[0].base;
 assert.equal(row.delivery.status,'unverified');assert.equal(row.scores.human,null);
 assert.ok(row.evidence.missing.some(reason=>reason.includes('stored human reviews')));
 assert.ok(fs.existsSync(path.join(dir,'out/index.html')));
});

test('weighted comparison totals keep missing cells and failed attempts in the task denominator',()=>{
 const failed=row('candidate','two',{status:'failed',knownFailure:true,scores:{content:0,layout:0,speed:0,cost:0,human:null}});
 const c=build([row('base'),row('base','two'),row('candidate'),failed]);
 assert.ok(Math.abs(c.summary.base.automatic-78/.85)<1e-8);
 assert.ok(Math.abs(c.summary.candidate.automatic-39/.85)<1e-8);
 assert.equal(c.summary.base.comprehensive,null);
 assert.equal(c.pairs[1].candidate.comprehensive,0);
 assert.equal(build([row('base')]).summary.candidate.automatic,null);
});
