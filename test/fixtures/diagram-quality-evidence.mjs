import fs from 'node:fs';
import path from 'node:path';
import {evaluateRun} from '../../benchmarks/diagram-quality/records.mjs';
import {sha256,evaluatorHash} from '../../benchmarks/diagram-quality/verification.mjs';
export function comparisonFixture(root) {
 const write=(name,value)=>{const file=path.join(root,name);fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));return file;};
 const task={id:'one',type:'architecture',complexity:'small',prompt:'Show Alpha.',expected:{nodes:[{id:'a',label:'Alpha'}],edges:[]}};
 const corpus={schemaVersion:2,publicPilot:true,profile:{minFontPx:12,epsilonPx:.5,calibrated:false},tasks:[task]};
 write('corpus.json',corpus);
 const source={diagram_type:'architecture',components:[{id:'a',label:'Alpha'}],connections:[]};
 const sourceBytes=JSON.stringify(source),artifact='<svg xmlns="http://www.w3.org/2000/svg"><text>Alpha</text></svg>';
 write('source.json',sourceBytes);write('artifact.html',artifact);write('prompt.md',task.prompt);
 write('session.json',{kind:'synthetic offline fixture only',events:['first source captured','native check recorded']});
 const graph={status:'verified',nodes:source.components,edges:[]};
 const observation={status:'verified',method:'synthetic-test-observation',bounds:{x:0,y:0,width:300,height:200},nodes:[{id:'a',label:'Alpha',visible:true,rect:{x:10,y:10,width:100,height:50},fontSize:14}],texts:[{nodeId:'a',text:'Alpha',visible:true,rect:{x:20,y:20,width:60,height:20},fontSize:14}],edges:[]};
 const baseRevision='a'.repeat(40),candidateRevision='b'.repeat(40);
 const identity={manifestHash:sha256(fs.readFileSync(path.join(root,'corpus.json'))),evaluatorHash:evaluatorHash(),profileHash:sha256(JSON.stringify(corpus.profile)),budget:{maxDurationMs:60000}};
 const plan={baseRevision,candidateRevision,corpus:'corpus.json',plannedRuns:[{taskId:'one',model:'fixture-only-model',repeat:1}],runs:[]};
 for(const arm of ['base','candidate']){
  const run={runId:arm+'-fixture',taskId:'one',arm:'historical-arm',model:'fixture-only-model',modelConfiguration:{temperature:0},repeat:1,identity,status:'completed',startedAt:'2026-10-23T00:00:00Z',completedAt:'2026-10-23T00:00:20Z',artifactHash:sha256(artifact),sourceHash:sha256(sourceBytes),candidates:[{artifactHash:sha256(artifact),sourceHash:sha256(sourceBytes),submittedAt:'2026-10-23T00:00:15Z'}],usage:{inputTokens:100,outputTokens:20,costUsd:.02},sourceEvidence:'Synthetic test fixture, not a real model result'};
  const receipt=evaluateRun({task,run,graph,observation,profile:corpus.profile,editability:{status:'verified',passed:true,method:'synthetic-fixture'}});
  write(arm+'.json',receipt);
  plan.runs.push({arm,revision:arm==='base'?baseRevision:candidateRevision,receipt:arm+'.json',source:'source.json',artifact:'artifact.html',prompt:'prompt.md',session:'session.json',sessionOrigin:'Synthetic test session',historyComplete:true,candidates:[{source:'source.json',artifact:'artifact.html',submittedAt:run.candidates[0].submittedAt}]});
 }
 write('plan.json',plan);return {write,plan,corpus,task};
}
