import test from 'node:test';
import assert from 'node:assert/strict';
const scoring = await import('../benchmarks/diagram-quality/scoring.mjs').catch(error => {
 if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
 return {};
});
const call = name => (...args) => { assert.equal(typeof scoring[name], 'function', `${name} export`); return scoring[name](...args); };
const scoreRun = call('scoreRun');
const rect = (x,y,width=40,height=30) => ({x,y,width,height});
const identity = {manifestHash:'manifest',evaluatorHash:'evaluator',profileHash:'legacy-profile',budget:{maxCandidates:5,maxDurationMs:120000,maxTokens:10000,maxCostUsd:1}};
const task = {id:'one',type:'workflow',complexity:'small',expected:{nodes:[{id:'a',label:'Alpha'},{id:'b',label:'Beta'}],edges:[{from:'a',to:'b',label:'yes'}],requiredLabels:['Alpha','Beta','yes']}};
const observation = () => ({status:'verified',bounds:rect(0,0,400,200),nodes:[{id:'a',label:'Alpha',visible:true,rect:rect(10,10),fontSize:12},{id:'b',label:'Beta',visible:true,rect:rect(160,10),fontSize:12}],texts:[{nodeId:'a',text:'Alpha',visible:true,rect:rect(15,15,30,12),fontSize:12},{nodeId:'b',text:'Beta',visible:true,rect:rect(165,15,30,12),fontSize:12},{edgeFrom:'a',edgeTo:'b',text:'yes',visible:true,rect:rect(90,45,20,12),fontSize:12}],edges:[{from:'a',to:'b',label:'yes',visible:true,points:[{x:50,y:25},{x:160,y:25}]}]});
const review = (reviewerId,rating=5) => ({reviewerId,rubricVersion:'diagram-quality-human-v1',taskId:'one',artifactHash:'artifact',status:'completed',independent:true,ratings:{readability:rating,hierarchy:rating,layout:rating,style:rating,aesthetics:rating}});
function receipt(change={}) { return {schemaVersion:2,benchmark:'diagram-quality',identity:structuredClone(identity),runId:'r1',taskId:'one',arm:'archify',model:'model',repeat:1,taskType:'workflow',complexity:'small',artifactHash:'artifact',status:'completed',startedAt:'2026-10-21T00:00:00Z',completedAt:'2026-10-21T00:00:40Z',candidates:[{artifactHash:'artifact',submittedAt:'2026-10-21T00:00:35Z'}],delivery:{status:'delivered'},editability:{status:'verified',passed:true},objective:{status:'verified',passed:true,semantic:{status:'verified',passed:true,nodes:{f1:1},edges:{f1:1}},geometry:{status:'verified',passed:true}},observation:observation(),usage:{status:'complete',inputTokens:100,outputTokens:20,totalTokens:120,costUsd:.13},human:{reviews:[review('first'),review('second')]},...change}; }
const score = (r=receipt(), t=task) => scoreRun({task:t,receipt:r});
const close = (actual, expected) => assert.ok(Math.abs(actual-expected)<1e-8, `${actual} != ${expected}`);

test('fixed anchors yield continuous efficiency and full scores without trusting legacy binary geometry',()=>{
 const r=receipt();r.objective.geometry.passed=false;
 const row=score(r);
 assert.deepEqual(row.scores,{content:100,layout:100,speed:40,cost:50,human:100});
 close(row.automatic,74/.85);close(row.comprehensive,89);assert.equal(row.optimization,undefined);
 assert.equal(row.status,'complete');assert.equal(row.raw.durationMs,40000);assert.equal(row.raw.deliveryDurationMs,35000);assert.equal(row.scores.speed,40);assert.equal(row.raw.totalTokens,120);assert.equal(row.raw.costUsd,.13);
 assert.equal(row.scoreVersion,scoring.SCORE_PROFILE.version);
});

test('partial independent semantic facts earn partial content and no speed or cost reward',()=>{
 const r=receipt();r.objective.semantic={status:'verified',passed:false,nodes:{f1:.5},edges:{f1:.25}};
 const row=score(r);close(row.scores.content,35);assert.equal(row.scores.speed,0);assert.equal(row.scores.cost,0);
 assert.equal(row.status,'complete');
 const noEdges={...task,expected:{nodes:task.expected.nodes,edges:[]}};r.objective.semantic.edges.f1=0;
 close(score(r,noEdges).scores.content,50);
});

test('11.9px labels incur only a continuous font deduction',()=>{
 const r=receipt();r.observation.texts.forEach(t=>t.fontSize=11.9);
 const row=score(r);close(row.layoutDetails.font,99.16666666666667);close(row.scores.layout,99.79166666666667);
 assert.equal(row.scores.content,100);assert.equal(row.status,'complete');
});

test('a fully covered mandatory label has no effective readable font area',()=>{
 const r=receipt();r.observation.nodes.push({id:'cover',label:'overlay',visible:true,rect:rect(90,45,20,12)});
 const row=score(r);close(row.layoutDetails.font,66.66666666666667);
});

test('a path on the board boundary remains visible rather than fully clipped',()=>{
 const r=receipt();r.observation.edges[0].points=[{x:0,y:0},{x:100,y:0}];
 close(score(r).layoutDetails.clipping,100);
});

test('occlusion counts covered area union once and padding cannot increase denominator',()=>{
 const t={...task,expected:{nodes:[{id:'a',label:'Alpha'}],edges:[]}};
 const r=receipt();r.observation.nodes=[{id:'a',label:'Alpha',visible:true,rect:rect(10,10,100,100)}, {id:'x',label:'decoration',visible:true,rect:rect(10,10,50,100)}, {id:'y',label:'decoration',visible:true,rect:rect(10,10,50,100)}];
 r.observation.texts=[{nodeId:'a',text:'Alpha',visible:true,rect:rect(70,70,30,12),fontSize:12}];r.observation.edges=[];
 const first=score(r,t);close(first.layoutDetails.occlusion,75);
 for(let i=0;i<100;i++)r.observation.nodes.push({id:`pad-${i}`,label:'padding',visible:true,rect:rect(300,100,1,1)});
 close(score(r,t).scores.layout,first.scores.layout);
});

test('missing required objects receive zero and optional labels cannot replace a bound required label',()=>{
 const r=receipt();r.observation.nodes.pop();r.observation.texts=r.observation.texts.filter(t=>t.nodeId!=='b');r.observation.edges=[];
 const first=score(r);assert.ok(first.scores.layout<70);assert.equal(first.layoutDetails.path,0);
 for(let i=0;i<50;i++)r.observation.texts.push({text:'Beta',visible:true,nodeId:`padding-${i}`,rect:rect(300,100+i,20,1),fontSize:12});
 assert.ok(score(r).scores.layout<=first.scores.layout);
});

test('legal containment avoids overlap deductions and clips labels to their owner continuously',()=>{
 const r=receipt();r.observation.nodes[0].rect=rect(0,0,250,100);r.observation.containments=[{parent:'a',child:'b'}];
 r.observation.edges[0].points=[{x:50,y:70},{x:160,y:70}];
 const row=score(r);close(row.layoutDetails.occlusion,100);
 r.observation.texts[1].rect=rect(190,15,20,12);
 close(score(r).layoutDetails.clipping,94.44444444444444);
});

test('path readability uses intrusion length ratio and legal endpoint contacts',()=>{
 const t=structuredClone(task);t.expected.nodes.push({id:'c',label:'Gamma'});t.expected.requiredLabels.push('Gamma');
 const r=receipt();r.observation.nodes.push({id:'c',label:'Gamma',visible:true,rect:rect(90,15,20,20)});r.observation.texts.push({nodeId:'c',text:'Gamma',visible:true,rect:rect(91,16,18,12),fontSize:12});
 const row=score(r,t);close(row.layoutDetails.path,81.81818181818183);
 r.observation.nodes[2].rect.y=25;
 r.observation.edges[0].points=[{x:50,y:25},{x:160,y:25}];
 close(score(r,t).layoutDetails.path,100);
});

test('a declared geometric endpoint container permits its internal route without reducing layout',()=>{
 const t=structuredClone(task);t.expected.nodes.push({id:'p',label:'Parent'});t.expected.requiredLabels.push('Parent');
 const r=receipt();
 r.observation.nodes.forEach(n=>n.rect.y+=30);r.observation.texts.filter(text=>text.nodeId).forEach(text=>text.rect.y+=30);
 r.observation.texts.find(text=>text.edgeFrom).rect.y=85;
 r.observation.edges[0].points=[{x:50,y:55},{x:160,y:55}];
 r.observation.nodes.push({id:'p',label:'Parent',visible:true,rect:rect(0,0,250,150),fontSize:12});
 r.observation.texts.push({nodeId:'p',text:'Parent',visible:true,rect:rect(15,10,40,12),fontSize:12});
 r.observation.containments=[{parent:'p',child:'a'},{parent:'p',child:'b'}];
 const nested=score(r,t);assert.equal(nested.layoutDetails.path,100);assert.equal(nested.scores.layout,100);
 r.observation.containments=[];assert.equal(score(r,t).layoutDetails.path,0);
 r.observation.containments=[{parent:'p',child:'a'},{parent:'p',child:'b'}];
 r.observation.nodes.find(n=>n.id==='p').rect=rect(65,40,70,30);
 close(score(r,t).layoutDetails.path,36.36363636363637);
});

test('known failures zero automatic credits without inventing human ratings',()=>{
 for(const r of [receipt({status:'timeout',delivery:{status:'timeout'},artifactHash:null,candidates:[],usage:{status:'unknown'}}),receipt({editability:{status:'verified',passed:false}})]){
  const row=score(r);assert.deepEqual(row.scores,{content:0,layout:0,speed:0,cost:0,human:null});assert.equal(row.status,'failed');assert.deepEqual(row.human,{count:0,complete:false,provisional:false});
 }
 const r=receipt();r.objective.semantic.nodes.f1=0;r.objective.semantic.edges.f1=0;r.objective.semantic.passed=false;
 const row=score(r);assert.deepEqual(row.scores,{content:0,layout:0,speed:0,cost:0,human:null});
});

test('unknown semantic/editability evidence and absent geometry measurements remain incomplete',()=>{
 for(const mutate of [r=>r.objective.semantic.status='unverified',r=>r.editability.status='unverified',r=>delete r.observation,r=>delete r.observation.nodes[0].rect]){
  const r=receipt();mutate(r);const row=score(r);assert.equal(row.status,'incomplete');assert.ok(row.missing.length);
 }
});

test('offline render time and absent actual usage cannot become free fast generation',()=>{
 for(const r of [receipt({environment:{measurementMode:'offline-render'}}),receipt({usage:{status:'unknown',totalTokens:null,costUsd:null}})]){
  const row=score(r);assert.equal(row.scores.cost,null);assert.equal(row.status,'incomplete');assert.equal(row.raw.costUsd,null);
 }
 const offline=score(receipt({environment:{measurementMode:'offline-render'}}));assert.equal(offline.scores.speed,null);assert.equal(offline.raw.durationMs,null);assert.equal(offline.raw.deliveryDurationMs,null);
});

test('budget violations independently remove both efficiency credits',()=>{
 for(const budget of [{maxDurationMs:30000},{maxTokens:119},{maxCostUsd:.12},{maxCandidates:0}]){
  const r=receipt({identity:{...identity,budget}});const row=score(r);assert.equal(row.scores.speed,0);assert.equal(row.scores.cost,0);
 }
});

test('an earlier correct draft cannot claim faster delivery than the final correct candidate',()=>{
 const r=receipt();const prior=receipt({artifactHash:'prior'});r.candidates.unshift({artifactHash:'prior',submittedAt:'2026-10-21T00:00:10Z',verifiedReceipt:prior});
 let row=score(r);assert.equal(row.scores.speed,40);assert.equal(row.raw.durationMs,40000);
 r.objective.semantic.passed=false;r.objective.semantic.edges.f1=0;row=score(r);assert.equal(row.scores.speed,0);assert.equal(row.scores.cost,0);
});

test('candidate timing stays separate from the whole-session speed measurement',()=>{
 const r=receipt();r.candidates.unshift({artifactHash:'prior',submittedAt:'2026-10-21T00:00:10Z',objectivePassed:true});
 const row=score(r);assert.equal(row.scores.speed,40);assert.equal(row.raw.durationMs,40000);assert.equal(row.status,'complete');
 r.candidates=[];const missing=score(r);assert.equal(missing.scores.speed,40);assert.equal(missing.raw.deliveryDurationMs,null);assert.equal(missing.status,'complete');
});

test('human anchors use equal independent rater means and require two distinct reviewers',()=>{
 for(const [rating,want] of [[1,0],[3,50],[5,100]]){
  const row=score(receipt({human:{reviews:[review('first',rating),review('second',rating)]}}));assert.equal(row.scores.human,want);assert.equal(row.human.complete,true);assert.equal(row.human.provisional,false);
 }
 const r=receipt({human:{reviews:[review('first',3),review('first',5)]}});const row=score(r);assert.equal(row.human.count,1);assert.equal(row.human.complete,false);assert.equal(row.human.provisional,true);assert.equal(row.scores.human,100);assert.equal(row.status,'complete');
 r.human.reviews.push({...review('second'),independent:false});assert.equal(score(r).human.complete,false);
 const wrongRubric=receipt({human:{reviews:[{...review('first'),rubricVersion:'old'},{...review('second'),rubricVersion:'old'}]}});
 assert.equal(score(wrongRubric).scores.human,null);assert.equal(score(wrongRubric).human.complete,false);
});

test('ratings need all five integer anchors, binding and independence but comments are optional',()=>{
 const r=receipt();assert.equal(score(r).scores.human,100);
 for(const bad of [{...review('bad'),artifactHash:'different'},{...review('bad'),ratings:{...review('bad').ratings,style:3.5}},{...review('bad'),taskId:'different'}]){
  assert.throws(()=>score(receipt({human:{reviews:[bad]}})),/human|rating|artifact|task/i);
 }
});

test('scoring rejects nonfinite data and contradictions instead of manufacturing a finite total',()=>{
 const r=receipt();r.usage.costUsd=NaN;assert.throws(()=>score(r),/finite/i);
 assert.throws(()=>score(receipt({taskId:'else'})),/task/i);
 assert.throws(()=>score(receipt({complexity:'large'})),/complexity/i);
 assert.throws(()=>score(receipt({identity:{...identity,budget:{maxTokens:null}}})),/budget/i);
 const invalid=receipt();invalid.candidates[0].artifactHash='different';assert.throws(()=>score(invalid),/candidate|artifact/i);
 const broken=structuredClone(scoring.SCORE_PROFILE);broken.thresholds.small.timeMs.bad=broken.thresholds.small.timeMs.good;
 assert.throws(()=>scoreRun({task,receipt:receipt(),profile:broken}),/threshold|anchor|bad/i);
});

test('frozen metric version cannot silently change anchors',()=>{
 const profile=structuredClone(scoring.SCORE_PROFILE);profile.thresholds.small.timeMs.good=1;
 assert.throws(()=>scoreRun({task,receipt:receipt(),profile}),/version/i);
 const invalid={...structuredClone(scoring.SCORE_PROFILE),version:'custom',minFontPx:'12'};
 assert.throws(()=>scoreRun({task,receipt:receipt(),profile:invalid}),/font/i);
});


test('session completion beyond the duration budget removes efficiency credit despite earlier submission',()=>{
 const r=receipt({identity:{...identity,budget:{maxDurationMs:30000}}});
 r.candidates[0].submittedAt='2026-10-21T00:00:25Z';
 const row=score(r);
 assert.equal(row.raw.durationMs,40000);assert.equal(row.raw.deliveryDurationMs,25000);
 assert.equal(row.scores.speed,0);assert.equal(row.scores.cost,0);
});

test('unrated optional human evidence is null and keeps automatic measurements complete',()=>{
 const row=score(receipt({human:{reviews:[]}}));
 assert.equal(row.scores.human,null);assert.equal(row.status,'complete');
 assert.deepEqual(row.human,{count:0,complete:false,provisional:false});
 assert.equal(scoring.SCORE_PROFILE.version,'archify-comparison-weighted-v1');
 assert.deepEqual(scoring.SCORE_PROFILE.weights,{content:.45,layout:.2,speed:.1,cost:.1,human:.15});
 assert.equal(scoring.aggregateScorecards,undefined);assert.equal(scoring.weightSensitivity,undefined);
});

test('weighted totals keep optional human ratings independent from the automatic score',()=>{
 const r=receipt(),row=score(r);
 close(row.automatic,74/.85);close(row.comprehensive,89);
 r.human={reviews:[]};const unrated=score(r);
 close(unrated.automatic,row.automatic);assert.equal(unrated.comprehensive,null);
 r.human={reviews:[review('single-reviewer',4)]};const single=score(r);
 close(single.automatic,row.automatic);close(single.comprehensive,85.25);assert.equal(single.human.provisional,true);
 const incomplete=score({...r,usage:{status:'unknown'}});assert.equal(incomplete.automatic,null);assert.equal(incomplete.comprehensive,null);
 const failed=score({...r,status:'timeout',candidates:[],artifactHash:null});
 assert.equal(failed.automatic,0);assert.equal(failed.comprehensive,0);assert.equal(failed.scores.human,null);
 assert.deepEqual(unrated.raw,row.raw);
});
