import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreRun} from '../benchmarks/diagram-quality/scoring.mjs';
import {evaluateRun,attachHumanReview} from '../benchmarks/diagram-quality/records.mjs';
const identity={manifestHash:'manifest',evaluatorHash:'evaluator',profileHash:'profile',budget:{maxDurationMs:30000}};
const task={id:'one',type:'workflow',expected:{nodes:[{id:'a',label:'Alpha'}],edges:[]}};
const graph={status:'verified',nodes:[{id:'a',label:'Alpha'}],edges:[]};
const observation={status:'verified',bounds:{x:0,y:0,width:300,height:200},nodes:[{id:'a',label:'Alpha',visible:true,rect:{x:10,y:10,width:80,height:40}}],texts:[{nodeId:'a',text:'Alpha',visible:true,fontSize:14,rect:{x:15,y:15,width:50,height:20}}],edges:[]};
const run=()=>({runId:'r',taskId:'one',arm:'base',model:'fixed',repeat:1,identity,artifactHash:'hash',status:'completed',startedAt:'2026-10-23T00:00:00Z',completedAt:'2026-10-23T00:00:20Z',candidates:[{artifactHash:'hash',submittedAt:'2026-10-23T00:00:15Z'}]});
const evaluate=(input=run())=>evaluateRun({task,run:input,graph,observation,profile:{minFontPx:12},editability:{status:'verified',passed:true}});
test('full session deadline includes time after the last candidate, consistently with metric scoring',()=>{
 const input=run();input.completedAt='2026-10-23T00:00:40Z';input.candidates[0].submittedAt='2026-10-23T00:00:25Z';
 const receipt=evaluate(input);assert.equal(receipt.objective.passed,false);assert.equal(receipt.objective.budgetPassed,false);
 assert.equal(evaluate().objective.passed,true);
});
test('failed runs and absent usage remain explicit rather than becoming successful or free',()=>{
 const input={...run(),status:'timeout',artifactHash:null,candidates:[]};const r=evaluate(input);
 assert.equal(r.objective.passed,false);assert.equal(r.delivery.status,'timeout');assert.equal(r.usage.costUsd,null);assert.equal(r.usage.totalTokens,null);
});
test('usage counts retries, preserves partial measurements and avoids cached/reasoning double counting',()=>{
 const input=run();input.usage={calls:[{callId:'first',inputTokens:100,outputTokens:20,cachedInputTokens:50,reasoningTokens:10,costUsd:.01},{callId:'retry',inputTokens:40,outputTokens:10,costUsd:.02}]};
 let r=evaluate(input);assert.equal(r.usage.totalTokens,170);assert.equal(r.usage.costUsd,.03);
 input.usage.calls.push({callId:'unknown'});r=evaluate(input);assert.equal(r.usage.totalTokens,null);assert.equal(r.usage.observed.totalTokens,170);
 input.usage.calls.push({callId:'first'});assert.throws(()=>evaluate(input),/duplicate/i);
});
test('invalid task, candidate chronology and non-finite inputs cannot produce a receipt',()=>{
 assert.throws(()=>evaluate({...run(),taskId:'else'}),/task/i);
 assert.throws(()=>evaluate({...run(),candidates:[{artifactHash:'other',submittedAt:run().completedAt}]}),/hash/i);
 assert.throws(()=>evaluate({...run(),completedAt:'yesterday'}),/time/i);
 assert.throws(()=>evaluate({...run(),usage:{costUsd:Infinity}}),/finite/i);
});
test('optional numeric human reviews bind the exact artifact and preserve automatic observations',()=>{
 const r=evaluate();const review={status:'completed',taskId:'one',artifactHash:'hash',reviewerId:'reviewer',rubricVersion:'diagram-quality-human-v1',independent:true,ratings:{readability:4,hierarchy:4,layout:4,style:4,aesthetics:4}};
 const reviewed=attachHumanReview(r,review);assert.deepEqual(reviewed.objective,r.objective);assert.equal(r.human.reviews.length,0);
 assert.throws(()=>attachHumanReview(r,{...review,artifactHash:'other'}),/artifact/i);
 assert.throws(()=>attachHumanReview(r,{...review,ratings:{readability:4}}),/rating/i);
 assert.throws(()=>attachHumanReview(r,{...review,status:'draft'}),/status/i);
});

test('recorded delivery failure survives reevaluation and cannot earn automatic credit',()=>{
 const receipt=evaluate({...run(),delivery:{status:'failed',reason:'delivery verifier rejected artifact'}});
 assert.equal(receipt.delivery.status,'failed');assert.equal(receipt.delivery.reason,'delivery verifier rejected artifact');
 assert.equal(receipt.objective.passed,false);
 const row=scoreRun({task:{...task,complexity:'small'},receipt});
 assert.equal(row.knownFailure,true);assert.equal(row.scores.content,0);assert.equal(row.scores.speed,0);
});
test('explicit incomplete accounting retains counters without proving budget or cost completeness',()=>{
 for(const status of ['partial','unknown'])for(const form of ['aggregate','calls','call']){
  const counts={inputTokens:100,outputTokens:20,costUsd:.01};
  const usage=form==='aggregate'?{...counts,status}:form==='calls'?{status,calls:[{callId:'one',...counts}]}:{calls:[{callId:'one',...counts,status}]};
  const receipt=evaluate({...run(),identity:{...identity,budget:{maxTokens:1000,maxCostUsd:.1}},usage});
  assert.equal(receipt.usage.totalTokens,120);assert.equal(receipt.usage.costUsd,.01);
  assert.notEqual(receipt.usage.status,'complete');assert.equal(receipt.usage.complete,false);
  assert.equal(receipt.objective.budgetPassed,false);
  const row=scoreRun({task:{...task,complexity:'small'},receipt});
  assert.equal(row.scores.cost,null);assert.equal(row.raw.costUsd,.01);assert.equal(row.raw.totalTokens,120);
  assert.equal(row.status,'incomplete');
 }
 const counts={inputTokens:100,outputTokens:20,costUsd:.01};
 for(const usage of [{...counts,complete:false},{complete:false,calls:[{callId:'one',...counts}]}]){
  const receipt=evaluate({...run(),identity:{...identity,budget:{maxCostUsd:.1}},usage});
  assert.equal(receipt.usage.costUsd,.01);assert.equal(receipt.usage.complete,false);assert.equal(receipt.objective.budgetPassed,false);
 }
});

test('rejected generation retains source-bound candidate history without fabricating artifacts',()=>{
 const input={...run(),status:'failed',artifactHash:null,sourceHash:'b'.repeat(64),candidates:[
  {sourceHash:'a'.repeat(64),submittedAt:'2026-10-23T00:00:10Z'},
  {sourceHash:'b'.repeat(64),submittedAt:'2026-10-23T00:00:15Z'},
 ]};
 const receipt=evaluate(input);assert.deepEqual(receipt.candidates,input.candidates);assert.equal(receipt.artifactHash,null);
 const row=scoreRun({task:{...task,complexity:'small'},receipt});
 assert.equal(row.status,'failed');assert.equal(row.scores.content,0);assert.equal(row.scores.human,null);assert.equal(row.raw.deliveryDurationMs,null);
 assert.throws(()=>evaluate({...input,status:'completed',artifactHash:'hash'}),/artifact|hash/i);
 assert.throws(()=>evaluate({...input,candidates:[{submittedAt:input.candidates[0].submittedAt}]}),/source|artifact|hash/i);
});
