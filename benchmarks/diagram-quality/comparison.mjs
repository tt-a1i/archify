import fs from 'node:fs';
import path from 'node:path';
import {scoreRun,SCORE_PROFILE,weightedTotals} from './scoring.mjs';
import {evaluateRun,attachHumanReview} from './records.mjs';
import {parseSource} from './adapters.mjs';
import {sha256,evaluatorHash,checkCorpus} from './verification.mjs';
import {renderComparisonReport,comparisonCSV,renderReviewForm} from './score-report.mjs';

const fields=['content','layout','speed','cost','human'];
const totals=['automatic','comprehensive'];
const rawFields=['durationMs','deliveryDurationMs','totalTokens','costUsd'];
const requireValue=(ok,message)=>{if(!ok)throw new TypeError(message);};
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const key=v=>stable([v.taskId,v.model,v.repeat]);
const mean=v=>v.length&&v.every(Number.isFinite)?v.reduce((a,b)=>a+b,0)/v.length:null;

export function buildComparison({baseRevision,candidateRevision,plannedRuns,rows,tasks=[]}) {
 for(const revision of [baseRevision,candidateRevision])requireValue(/^[a-f0-9]{40}$/i.test(revision),'Comparison revision must be a full commit SHA');
 requireValue(baseRevision!==candidateRevision,'Base and candidate revisions must differ');
 requireValue(Array.isArray(plannedRuns)&&plannedRuns.length>0,'Comparison requires planned runs');
 const plan=new Map();
 for(const item of plannedRuns){
  requireValue(typeof item.taskId==='string'&&item.taskId&&typeof item.model==='string'&&item.model&&Number.isInteger(item.repeat)&&item.repeat>0,'Invalid planned run');
  requireValue(!plan.has(key(item)),'Duplicate planned cell');plan.set(key(item),item);
 }
 requireValue(new Set(plannedRuns.map(p=>p.model)).size===1,'Use one fixed model per comparison');
 rows=rows.map(row=>({...row}));
 const seen=new Map(),runIds=new Set();let identity=null,configuration=null;
 for(const row of rows){
  requireValue(['base','candidate'].includes(row.arm),'Run arm must be base or candidate');
  requireValue(row.revision===(row.arm==='base'?baseRevision:candidateRevision),'Run revision does not match its comparison arm');
  requireValue(plan.has(key(row)),'Unplanned run');
  requireValue(typeof row.runId==='string'&&!runIds.has(row.runId),'Duplicate or missing runId');runIds.add(row.runId);
  const cell=row.arm+':'+key(row);requireValue(!seen.has(cell),'Duplicate recorded cell');seen.set(cell,row);
  const id=stable(row.identity),config=stable(row.modelConfiguration??null);
  requireValue(identity===null||identity===id,'Mixed evaluator/corpus/profile/budget identity');identity=id;
  requireValue(configuration===null||configuration===config,'Mixed model configuration');configuration=config;
  for(const field of fields)requireValue(row.scores[field]===null||Number.isFinite(row.scores[field])&&row.scores[field]>=0&&row.scores[field]<=100,'Invalid per-metric score');
  Object.assign(row,weightedTotals(row.scores,{knownFailure:row.knownFailure,incomplete:row.status==='incomplete'}));
  for(const field of rawFields)requireValue(row.raw[field]===null||Number.isFinite(row.raw[field])&&row.raw[field]>=0,'Invalid raw measurement');
 }
 const pairs=plannedRuns.map(item=>{
  const base=seen.get('base:'+key(item))??null,candidate=seen.get('candidate:'+key(item))??null;
  if(base?.promptHash&&candidate?.promptHash)requireValue(base.promptHash===candidate.promptHash,'Paired prompt digest differs');
  const delta=Object.fromEntries(fields.map(f=>[f,Number.isFinite(base?.scores[f])&&Number.isFinite(candidate?.scores[f])?candidate.scores[f]-base.scores[f]:null]));
  for(const field of totals)delta[field]=Number.isFinite(base?.[field])&&Number.isFinite(candidate?.[field])?candidate[field]-base[field]:null;
  return {...item,prompt:tasks.find(t=>t.id===item.taskId)?.prompt??null,base,candidate,delta};
 });
 const summarize=arm=>{
  const values=pairs.map(p=>p[arm]),recorded=values.filter(Boolean);
  // Repeats are averaged within a task before giving each task equal weight.
  const taskIds=[...new Set(plannedRuns.map(p=>p.taskId))];
  const averages=section=>Object.fromEntries((section==='scores'?fields:rawFields).map(f=>[f,mean(taskIds.map(id=>mean(pairs.filter(p=>p.taskId===id).map(p=>p[arm]?.[section]?.[f]??null))))]));
  const weighted=Object.fromEntries(totals.map(f=>[f,mean(taskIds.map(id=>mean(pairs.filter(p=>p.taskId===id).map(p=>p[arm]?.[f]??null))))]));
  return {...weighted,humanProvisional:recorded.some(r=>r.human?.provisional===true),planned:values.length,recorded:recorded.length,delivered:recorded.filter(r=>r.delivery?.status==='delivered').length,failed:recorded.filter(r=>r.knownFailure||r.status==='failed').length,missing:values.length-recorded.length,scores:averages('scores'),raw:averages('raw')};
 };
 return {schemaVersion:1,kind:'archify-before-after',metricsVersion:SCORE_PROFILE.version,scoreWeights:SCORE_PROFILE.weights,evaluatorHash:evaluatorHash(),baseRevision,candidateRevision,pairs,summary:{base:summarize('base'),candidate:summarize('candidate')}};
}

const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function copyEvidence(file,root,out,{artifact=false,expectedHash=null,png=false}={}) {
 if(!file)return null;
 const source=path.resolve(root,file),bytes=fs.readFileSync(source),hash=sha256(bytes);
 requireValue(!expectedHash||hash===expectedHash,'Evidence digest mismatch: '+file);
 if(png)requireValue(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'Preview must be a PNG');
 let ext=path.extname(source).slice(1).toLowerCase();
 requireValue(['json','jsonl','html','svg','png','txt','md'].includes(ext),'Unsupported evidence file extension: '+file);
 if(png)ext='png';
 const relative=(artifact?'artifacts/':'evidence/')+hash+'.'+ext,target=path.join(out,relative);
 if(!fs.existsSync(target))fs.writeFileSync(target,bytes,{flag:'wx'});
 return {path:relative,hash};
}

export async function compareFromFiles({plan:planFile,output,reviews:reviewFile}) {
 const planPath=path.resolve(planFile),root=path.dirname(planPath),plan=read(planPath),corpusPath=path.resolve(root,plan.corpus),corpus=read(corpusPath);
 checkCorpus(corpus);requireValue(Array.isArray(plan.runs),'Plan needs recorded runs (possibly an empty array)');
 const out=path.resolve(output);
 requireValue(!fs.existsSync(out)||!fs.lstatSync(out).isSymbolicLink()&&fs.statSync(out).isDirectory()&&fs.readdirSync(out).length===0,'Output must be a new or empty directory');
 const entries=plan.runs.map(entry=>({...entry,receiptFile:path.resolve(root,entry.receipt)}));
 // Check plan structure before publishing any report.
 buildComparison({...plan,rows:[],tasks:corpus.tasks});
 const importedReviews=reviewFile?read(path.resolve(reviewFile)):[];
 const reviews=Array.isArray(importedReviews)?importedReviews:importedReviews.reviews;
 requireValue(Array.isArray(reviews),'Reviews must be an array or {reviews:[]}');
 const usedReviews=new Set(),rows=[],receipts=[];
 fs.mkdirSync(path.join(out,'artifacts'),{recursive:true});fs.mkdirSync(path.join(out,'evidence'),{recursive:true});
 try {
  for(const entry of entries){
   const original=read(entry.receiptFile),receiptRoot=path.dirname(entry.receiptFile),task=corpus.tasks.find(t=>t.id===original.taskId);
   requireValue(task,'Unknown recorded task');
   requireValue(original.schemaVersion===2&&original.benchmark==='diagram-quality','Unsupported receipt');
   requireValue(original.identity?.manifestHash===sha256(fs.readFileSync(corpusPath)),'Receipt corpus digest differs from the plan');
   requireValue(original.identity?.profileHash===sha256(JSON.stringify(corpus.profile)),'Receipt geometry profile differs from the plan');
   requireValue(!original.revision||original.revision===entry.revision,'Recorded revision mismatch');
   const evidence={candidates:[],missing:[],historyComplete:false,receiptPath:copyEvidence(entry.receipt,root,out).path};
   let source=null;
   if(entry.source){
    const copied=copyEvidence(entry.source,root,out,{expectedHash:original.sourceHash});
    evidence.sourcePath=copied.path;source=fs.readFileSync(path.resolve(root,entry.source),'utf8');
   }else evidence.missing.push('final source unavailable');
   if(entry.artifact){
    requireValue(original.artifactHash,'Artifact requires a recorded digest');
    evidence.artifactPath=copyEvidence(entry.artifact,root,out,{artifact:true,expectedHash:original.artifactHash}).path;
   }else if(original.status==='completed')evidence.missing.push('final artifact unavailable');
   if(entry.prompt)evidence.promptPath=copyEvidence(entry.prompt,root,out).path;
   else evidence.missing.push('original prompt export unavailable');
   if(entry.session)evidence.sessionPath=copyEvidence(entry.session,root,out).path;
   else evidence.missing.push('full session export unavailable');
   evidence.sessionOrigin=entry.sessionOrigin??'Imported session; completeness is a recorder claim';
   for(const [i,candidate] of (entry.candidates??[]).entries()){
    const recorded=original.candidates?.[i];
    requireValue(!candidate.submittedAt||!recorded?.submittedAt||candidate.submittedAt===recorded.submittedAt,'Candidate timestamp differs from its recorded submission');
    const item={submittedAt:recorded?.submittedAt??candidate.submittedAt??null,bound:false};
    const expectedSource=recorded?.sourceHash??(i===(original.candidates?.length??0)-1?original.sourceHash:null);
    if(candidate.source){
     const copied=copyEvidence(candidate.source,root,out,{expectedHash:expectedSource});
     item.sourcePath=copied.path;item.bound=!!recorded&&!!expectedSource&&copied.hash===expectedSource;
     // Invalid generated JSON is still evidence of a failed attempt.
     const bytes=fs.readFileSync(path.resolve(root,candidate.source),'utf8');
     try{item.documentHash=sha256(stable(JSON.parse(bytes)));}catch{item.documentHash=sha256(bytes);}
    }
    if(candidate.artifact)item.artifactPath=copyEvidence(candidate.artifact,root,out,{artifact:true,expectedHash:recorded?.artifactHash}).path;
    if(candidate.receipt)item.receiptPath=copyEvidence(candidate.receipt,root,out).path;
    evidence.candidates.push(item);
   }
   evidence.historyComplete=entry.historyComplete===true&&!!evidence.sessionPath&&evidence.candidates.length>0&&evidence.candidates.every(c=>c.bound&&c.sourcePath&&c.submittedAt)&&evidence.candidates.length===original.candidates.length;
   if(!evidence.historyComplete)evidence.missing.push('complete first-draft/repair history unavailable');
   // Imported receipts retain their recorded evaluator identity; new metric normalization has its own identity.
   // Recompute rule outcomes from the saved observation, not from imported passed/score fields.
   const graph=source?parseSource('archify',source,{type:task.type}):{status:'unverified',nodes:[],edges:[],unknownReasons:['source missing']};
   let receipt=evaluateRun({task,run:original,graph,observation:original.observation,profile:corpus.profile,editability:original.editability});
   receipt.evidenceOrigin='imported recorded observations; no new model generation';
   receipt.artifactPath=evidence.artifactPath??null;if(!evidence.artifactPath&&original.status==='completed')receipt.delivery={status:'unverified'};receipt.revision=entry.revision;receipt.arm=entry.arm;
   // Never retain a preview that was not copied into this output bundle.
   delete receipt.reviewImage;
   const previewFile=entry.preview??(original.reviewImage?.path&&fs.existsSync(path.resolve(receiptRoot,original.reviewImage.path))?path.resolve(receiptRoot,original.reviewImage.path):null);
   if(previewFile){
    const preview=copyEvidence(previewFile,root,out,{artifact:true,png:true,expectedHash:original.reviewImage?.hash??null});
    receipt.reviewImage={hash:preview.hash,path:preview.path};evidence.previewPath=preview.path;
   }else evidence.missing.push('PNG preview unavailable; inspect original artifact');
   // Existing ratings are tied to original artifact bytes; an explicit newer import wins.
   const storedReviews=original.human?.reviews??[];
   if(receipt.delivery.status==='delivered')for(const review of storedReviews)receipt=attachHumanReview(receipt,review);
   else if(storedReviews.length)evidence.missing.push('stored human reviews not bound: final artifact unavailable');
   for(const [i,review] of reviews.entries())if(review.taskId===receipt.taskId&&review.artifactHash===receipt.artifactHash){receipt=attachHumanReview(receipt,review);usedReviews.add(i);}
   const row=scoreRun({task,receipt});
   Object.assign(row,{revision:entry.revision,evidence,delivery:receipt.delivery,repairCount:evidence.historyComplete?evidence.candidates.slice(1).filter((c,i)=>c.documentHash!==evidence.candidates[i].documentHash).length:null,semanticMeasurements:{nodes:receipt.objective.semantic.nodes??null,edges:receipt.objective.semantic.edges??null},semanticDefects:receipt.objective.semantic.violations,sourceEvidence:original.sourceEvidence??null});
   row.runId=original.runId;row.arm=entry.arm;row.promptHash=original.promptHash??null;
   if(entry.prompt){const hash=sha256(fs.readFileSync(path.resolve(root,entry.prompt)));requireValue(!original.promptHash||original.promptHash===hash,'Prompt digest mismatch');row.promptHash=hash;}
   rows.push(row);receipts.push(receipt);
  }
  requireValue(usedReviews.size===reviews.length,'Review refers to an unknown task/artifact');
  const comparison=buildComparison({...plan,rows,tasks:corpus.tasks});
  comparison.evidenceOrigin='Recorded artifacts and sessions; metrics recomputed from saved observations. No fresh generation.';
  const write=(name,value)=>fs.writeFileSync(path.join(out,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  write('comparison.json',comparison);write('comparison.csv',comparisonCSV(comparison));write('index.html',renderComparisonReport(comparison));
  write('review.html',renderReviewForm({receipts:receipts.filter(r=>r.delivery.status==='delivered'&&r.artifactPath),tasks:corpus.tasks,seed:plan.baseRevision+plan.candidateRevision}));
  return {comparison,outputDir:out};
 }catch(error){
  // Remove only the output directory owned by this invocation, never caller inputs.
  fs.rmSync(out,{recursive:true,force:true});throw error;
 }
}
