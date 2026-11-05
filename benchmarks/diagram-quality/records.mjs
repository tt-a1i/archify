import { evaluateSemantics, evaluateGeometry } from './metrics.mjs';

const clone = value => structuredClone(value);
function requireValue(ok, message) { if (!ok) throw new TypeError(message); }
function text(value, name) { requireValue(typeof value === 'string' && value.trim().length > 0, `${name} must be a nonempty string`); return value; }
function finiteData(value, path = 'data') {
 if (typeof value === 'number') requireValue(Number.isFinite(value), `${path} must be finite`);
 else if (value && typeof value === 'object') for (const [key,item] of Object.entries(value)) finiteData(item, `${path}.${key}`);
}
function stable(value) {
 if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
 if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
 return JSON.stringify(value);
}
function identityOf(value) {
 const identity=value.identity ?? value;
 for(const key of ['manifestHash','evaluatorHash','profileHash']) text(identity[key],key);
 requireValue(identity.budget && typeof identity.budget === 'object' && !Array.isArray(identity.budget),'budget must be an object');
 finiteData(identity.budget,'budget');
 for(const key of ['maxCandidates','maxDurationMs','maxTokens','maxCostUsd']) if(key in identity.budget) requireValue(typeof identity.budget[key]==='number' && identity.budget[key]>=0 && (key!=='maxCandidates' || Number.isInteger(identity.budget[key])),`budget.${key} must be a nonnegative finite number`);
 for(const [key,n] of Object.entries(identity.budget)) if(typeof n==='number') requireValue(n>=0, `budget.${key} must be nonnegative`);
 return clone({manifestHash:identity.manifestHash,evaluatorHash:identity.evaluatorHash,profileHash:identity.profileHash,budget:identity.budget});
}
function cell(value) {
 for(const key of ['taskId','arm','model']) text(value[key],key);
 requireValue(Number.isInteger(value.repeat) && value.repeat>=1,'repeat must be a positive integer');
 return stable([value.taskId,value.arm,value.model,value.repeat]);
}
function time(value,name) { requireValue(typeof value==='string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)), `${name} time must be ISO timestamp`);return Date.parse(value); }
const usageFields=['inputTokens','outputTokens','cachedInputTokens','reasoningTokens','costUsd'];
function oneUsage(value={}) {
 const out={};
 for(const field of usageFields) {
  const n=value[field] ?? null;
  requireValue(n===null || (typeof n==='number' && Number.isFinite(n) && n>=0 && (field==='costUsd' || Number.isInteger(n))),`${field} must be finite and nonnegative`);
  out[field]=n;
 }
 requireValue(out.cachedInputTokens===null || out.inputTokens===null || value.cachedIncludedInInput===false || out.cachedInputTokens<=out.inputTokens,'cached input exceeds input tokens');
 requireValue(out.reasoningTokens===null || out.outputTokens===null || value.reasoningIncludedInOutput===false || out.reasoningTokens<=out.outputTokens,'reasoning exceeds output tokens');
 // Canonical input/output counts include cached inputs and reasoning, unless the provider explicitly says otherwise.
 if(value.cachedIncludedInInput===false) out.inputTokens=out.inputTokens===null || out.cachedInputTokens===null ? null : out.inputTokens+out.cachedInputTokens;
 if(value.reasoningIncludedInOutput===false) out.outputTokens=out.outputTokens===null || out.reasoningTokens===null ? null : out.outputTokens+out.reasoningTokens;
 out.cachedIncludedInInput=true;out.reasoningIncludedInOutput=true;
 out.totalTokens=out.inputTokens===null || out.outputTokens===null ? null : out.inputTokens+out.outputTokens;
 finiteData(out,'usage');
 out.status=value.status==='unknown'?'unknown':value.status==='partial' || value.complete===false || out.totalTokens===null || out.costUsd===null ? 'partial' : 'complete';
 out.complete=out.status==='complete';
 return out;
}
function usageOf(value) {
 if (!value) return {...oneUsage(),status:'unknown',calls:[]};
 if (!Array.isArray(value.calls)) return {...clone(value),...oneUsage(value)};
 const ids=new Set();
 const calls=value.calls.map(call=>{ text(call.callId,'usage callId');requireValue(!ids.has(call.callId),'duplicate usage callId');ids.add(call.callId);return {...clone(call),...oneUsage(call)}; });
 const totals={};
 for(const field of [...usageFields,'totalTokens']) totals[field]=calls.length && calls.every(call=>call[field]!==null) ? calls.reduce((sum,call)=>sum+call[field],0) : null;
 const observed={};for(const field of [...usageFields,'totalTokens']) observed[field]=calls.reduce((sum,call)=>sum+(call[field]??0),0);
 finiteData(totals,'usage totals');finiteData(observed,'usage observed');
 const status=value.status==='unknown'?'unknown':value.status==='partial' || value.complete===false || !calls.length || calls.some(call=>call.status!=='complete')?'partial':'complete';
 return {...totals,observed,complete:status==='complete',status,calls};
}
export function evaluateRun({task,run,graph,observation,profile={},editability}) {
 finiteData({task,run,graph,observation,profile,editability});
 text(run.runId,'runId');cell(run);requireValue(task.id===run.taskId,'task identity mismatch');
 const identity=identityOf(run),status=run.status??'completed';
 requireValue(['completed','timeout','no_candidate','provider_error','invalid_source','failed'].includes(status),'invalid run status');
 const start=time(run.startedAt,'startedAt'),end=run.completedAt==null?null:time(run.completedAt,'completedAt');
 requireValue(end===null||end>=start,'completed time precedes start');
 const candidates=clone(run.candidates??[]);requireValue(Array.isArray(candidates),'candidates must be an array');let previous=start;
 for(const candidate of candidates){
  if(status==='completed'||candidate.artifactHash!=null)text(candidate.artifactHash,'candidate artifactHash');
  else requireValue(typeof candidate.sourceHash==='string'&&/^[a-f0-9]{64}$/i.test(candidate.sourceHash),'rejected candidate needs a source SHA256 hash');const at=time(candidate.submittedAt,'candidate');requireValue(at>=previous&&(end===null||at<=end),'candidate time out of order');previous=at;}
 if(status==='completed'&&candidates.length)requireValue(candidates.at(-1).artifactHash===run.artifactHash,'final candidate hash must match artifactHash');
 if(status==='completed'){text(run.artifactHash,'artifactHash');requireValue(candidates.length>0,'completed run needs candidates');}
 const delivery=clone(run.delivery??{status:status==='completed'&&run.artifactHash?'delivered':status});
 text(delivery.status,'delivery status');
 const usage=usageOf(run.usage),budget=identity.budget;
 const budgetPassed=!(budget.maxCandidates!=null&&candidates.length>budget.maxCandidates)&&!(budget.maxDurationMs!=null&&(end===null||end-start>budget.maxDurationMs))&&!(budget.maxTokens!=null&&(usage.totalTokens===null||usage.complete===false||usage.totalTokens>budget.maxTokens))&&!(budget.maxCostUsd!=null&&(usage.costUsd===null||usage.complete===false||usage.costUsd>budget.maxCostUsd));
 const semantic=status==='completed'?evaluateSemantics(task.expected,graph,observation):{status:'unverified',passed:false,violations:[]};
 const geometry=status==='completed'?evaluateGeometry(observation,profile):{status:'unverified',passed:false,violations:[]};
 const editable=editability??{status:'unverified',passed:false,unknownReasons:['independent editability evidence missing']};
 const verified=status==='completed'&&semantic.status==='verified'&&geometry.status==='verified'&&editable.status==='verified';
 const passed=verified&&delivery.status==='delivered'&&semantic.passed&&geometry.passed&&editable.passed===true&&budgetPassed;
 return {schemaVersion:2,benchmark:'diagram-quality',identity,runId:run.runId,revision:run.revision??null,promptHash:run.promptHash??null,taskId:task.id,taskType:task.type,complexity:task.complexity,arm:run.arm,model:run.model,modelConfiguration:clone(run.modelConfiguration??null),repeat:run.repeat,status,startedAt:run.startedAt,completedAt:run.completedAt??null,candidates,artifactHash:run.artifactHash??null,sourceHash:run.sourceHash??null,artifactPath:run.artifactPath??null,sourceEvidence:clone(run.sourceEvidence??null),environment:clone(run.environment??null),agent:clone(run.agent??null),observation:clone(observation??null),delivery,editability:clone(editable),objective:{status:verified?'verified':'unverified',passed:!!passed,score:passed?1:0,budgetPassed,semantic,geometry},usage,human:{status:'not_requested',reviews:[]},unknownReasons:[...(graph?.unknownReasons??[]),...(observation?.unknownReasons??[]),...(editable.unknownReasons??[])]};
}
export function attachHumanReview(receipt,review) {
 finiteData(review,'review');
 requireValue(review.artifactHash===receipt.artifactHash && review.artifactHash!=null,'human artifact hash mismatch');
 requireValue(review.taskId===receipt.taskId,'human task mismatch');
 text(review.reviewerId,'reviewerId');text(review.rubricVersion,'rubricVersion');
 requireValue(['requested','in_progress','completed','partial','skipped'].includes(review.status),'invalid human status');
 const fields=['readability','hierarchy','layout','style','aesthetics'];
 for(const [key,value] of Object.entries(review.ratings??{})) requireValue(fields.includes(key) && Number.isInteger(value) && value>=1 && value<=5,'invalid human rating');
 if(review.status==='completed') {
  requireValue(receipt.delivery.status==='delivered','human completion requires delivered artifact');
  requireValue(fields.every(field=>Number.isInteger(review.ratings?.[field])),'completed review needs all five ratings');
  if(review.semantic != null) requireValue(['correct','incorrect','unverified'].includes(review.semantic.judgement),'invalid optional semantic judgement');
 }
 const result=clone(receipt); const reviews=(result.human?.reviews??[]).filter(old=>old.reviewerId!==review.reviewerId || old.rubricVersion!==review.rubricVersion);
 reviews.push(clone(review)); result.human={status:reviews.some(item=>item.status==='completed')?'completed':review.status,reviews};return result;
}
