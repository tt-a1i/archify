// Changing these anchors or geometric rules requires a new metric version.
function freeze(value) { if(value && typeof value==='object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export const SCORE_PROFILE = freeze({
 version:'archify-comparison-weighted-v1',
 weights:{content:.45,layout:.20,speed:.10,cost:.10,human:.15},
 minFontPx:12,
 thresholds:{
  small:{timeMs:{good:10000,bad:60000},costUsd:{good:.01,bad:.25}},
  medium:{timeMs:{good:30000,bad:180000},costUsd:{good:.03,bad:.75}},
  large:{timeMs:{good:60000,bad:360000},costUsd:{good:.06,bad:1.5}},
 },
});
const RATINGS=['readability','hierarchy','layout','style','aesthetics'];
const HUMAN_RUBRIC='diagram-quality-human-v1';
const clone=value=>structuredClone(value);
const requireValue=(ok,message)=>{if(!ok)throw new TypeError(message);};
const nonempty=(v,name)=>requireValue(typeof v==='string' && v.trim().length>0,`${name} must be nonempty`);
const norm=v=>String(v??'').trim().replace(/\s+/g,' ');
const clamp=v=>Math.max(0,Math.min(1,v));
const stable=value=>Array.isArray(value)?`[${value.map(stable).join(',')}]`:value && typeof value==='object'?`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`:JSON.stringify(value);
function finiteData(value,path='data') {
 if(typeof value==='number') requireValue(Number.isFinite(value),`${path} must be finite`);
 else if(value && typeof value==='object') for(const [key,item] of Object.entries(value)) finiteData(item,`${path}.${key}`);
}
function numberOrNull(value,name,{max=Infinity,integer=false}={}) {
 if(value==null)return null;
 requireValue(typeof value==='number' && Number.isFinite(value) && value>=0 && value<=max && (!integer || Number.isInteger(value)),`${name} must be a finite nonnegative${integer?' integer':''}${max===Infinity?'':` <= ${max}`}`);
 return value;
}
const mean=values=>values.length?values.some(v=>v===null)?null:values.reduce((sum,v)=>sum+v/values.length,0):null;
function profileOf(profile) {
 finiteData(profile,'profile');nonempty(profile?.version,'score version');
 const keys=['content','layout','speed','cost','human'];
 requireValue(keys.every(k=>typeof profile.weights?.[k]==='number'&&Number.isFinite(profile.weights[k])&&profile.weights[k]>=0),'weights must be nonnegative finite numbers');
 requireValue(Math.abs(keys.reduce((sum,k)=>sum+profile.weights[k],0)-1)<1e-10,'weights must sum to one');
 requireValue(keys.slice(0,4).reduce((sum,k)=>sum+profile.weights[k],0)>0,'automatic weight must be positive');
 requireValue(typeof profile.minFontPx==='number' && profile.minFontPx>0,'profile minFontPx must be positive');
 for(const complexity of ['small','medium','large']) for(const dimension of ['timeMs','costUsd']) {
  const anchor=profile.thresholds?.[complexity]?.[dimension];
  requireValue(anchor && typeof anchor.good==='number' && anchor.good>=0 && typeof anchor.bad==='number' && anchor.bad>anchor.good,'profile threshold anchors require 0 <= good < bad');
 }
 if(profile.version===SCORE_PROFILE.version)requireValue(stable({weights:profile.weights,minFontPx:profile.minFontPx,thresholds:profile.thresholds})===stable({weights:SCORE_PROFILE.weights,minFontPx:SCORE_PROFILE.minFontPx,thresholds:SCORE_PROFILE.thresholds}),'changed score policy requires a new version');
 return profile;
}
// Totals supplement the raw measurements and component scores; unknowns never become zero.
export function weightedTotals(scores,{profile=SCORE_PROFILE,knownFailure=false,incomplete=false}={}) {
 profileOf(profile);
 const auto=['content','layout','speed','cost'];
 if(incomplete||auto.some(k=>!Number.isFinite(scores[k])))return {automatic:null,comprehensive:null};
 const autoWeight=auto.reduce((sum,k)=>sum+profile.weights[k],0);
 const weightedAuto=auto.reduce((sum,k)=>sum+scores[k]*profile.weights[k],0);
 return {automatic:100*clamp(weightedAuto/autoWeight/100),comprehensive:knownFailure?0:Number.isFinite(scores.human)?100*clamp((weightedAuto+profile.weights.human*scores.human)/100):null};
}
function identityOf(value) {
 const identity=value?.identity;requireValue(identity && typeof identity==='object','receipt identity required');
 for(const key of ['manifestHash','evaluatorHash','profileHash'])nonempty(identity[key],`identity ${key}`);
 requireValue(identity.budget && typeof identity.budget==='object' && !Array.isArray(identity.budget),'identity budget required');
 for(const [key,value] of Object.entries(identity.budget)) {
  requireValue(value!==null && value!==undefined,`budget ${key} must be measured`);
  numberOrNull(value,`budget ${key}`,{integer:key==='maxCandidates' || key==='maxTokens'});
 }
 return clone(identity);
}
function cell(value) {
 for(const key of ['taskId','arm','model'])nonempty(value?.[key],key);
 requireValue(Number.isInteger(value.repeat) && value.repeat>=1,'repeat must be a positive integer');
 return stable([value.taskId,value.arm,value.model,value.repeat]);
}

const validRect=r=>r && ['x','y','width','height'].every(k=>Number.isFinite(r[k])) && r.width>=0 && r.height>=0;
const area=r=>r.width*r.height;
function intersect(a,b) {
 const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);
 return {x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)};
}
const contains=(a,b)=>validRect(a) && validRect(b) && area(intersect(a,b))>=area(b);
// Sweep a union of already-clipped rectangles; overlapping occluders count once.
function unionArea(rects) {
 const useful=rects.filter(r=>area(r)>0),xs=[...new Set(useful.flatMap(r=>[r.x,r.x+r.width]))].sort((a,b)=>a-b);
 let result=0;
 for(let i=1;i<xs.length;i++) {
  const intervals=useful.filter(r=>r.x<xs[i] && r.x+r.width>xs[i-1]).map(r=>[r.y,r.y+r.height]).sort((a,b)=>a[0]-b[0]);
  let length=0,end=-Infinity;
  for(const [a,b] of intervals){length+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
  result+=(xs[i]-xs[i-1])*length;
 }
 return result;
}
// Open interior: a route touching a box border has zero intrusion length.
function segmentInterval(p,q,r,open=true) {
 let low=0,high=1;
 for(const [axis,size] of [['x','width'],['y','height']]) {
  const d=q[axis]-p[axis],min=r[axis],max=min+r[size];
  if(d===0){if(open?p[axis]<=min || p[axis]>=max:p[axis]<min || p[axis]>max)return null;}
  else {let a=(min-p[axis])/d,b=(max-p[axis])/d;if(a>b)[a,b]=[b,a];low=Math.max(low,a);high=Math.min(high,b);if(low>=high)return null;}
 }
 return high>low?[low,high]:null;
}
function unionLength(intervals) {
 let total=0,end=-Infinity;
 for(const [a,b] of intervals.sort((a,b)=>a[0]-b[0])){total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
 return total;
}
const validPath=e=>Array.isArray(e?.points) && e.points.length>=2 && e.points.every(p=>Number.isFinite(p.x) && Number.isFinite(p.y));
function pathFraction(edge,boxes,inside=true) {
 if(!validPath(edge))return null;
 let length=0,covered=0;
 for(let i=1;i<edge.points.length;i++) {
  const p=edge.points[i-1],q=edge.points[i],distance=Math.hypot(q.x-p.x,q.y-p.y);length+=distance;
  covered+=distance*unionLength(boxes.map(r=>segmentInterval(p,q,r,!inside)).filter(Boolean));
 }
 return length?clamp(inside?covered/length:1-covered/length):0;
}
// Deterministic one-to-one slots: matching geometry never changes required denominators.
function assign(wanted,actual,compatible) {
 const owner=new Map();
 const visit=(i,seen)=>{for(let j=0;j<actual.length;j++){if(seen.has(j)||!compatible(wanted[i],actual[j]))continue;seen.add(j);if(!owner.has(j)||visit(owner.get(j),seen)){owner.set(j,i);return true;}}return false;};
 wanted.forEach((_,i)=>visit(i,new Set()));
 return new Map([...owner].map(([j,i])=>[i,actual[j]]));
}
function layoutScore(task,observation,profile) {
 const empty={occlusion:null,clipping:null,font:null,path:null,objects:[],missing:['geometry']};
 if(observation?.status!=='verified' || !validRect(observation.bounds) || area(observation.bounds)===0 || !['nodes','texts','edges'].every(k=>Array.isArray(observation[k])))return {score:null,details:empty};
 const expected=task.expected,nodes=observation.nodes,texts=observation.texts,edges=observation.edges;
 const aliases=n=>[n.label,...(n.aliases??[])].filter(v=>v!=null).map(norm);
 const key=n=>n.key??n.id??n.label;
 const nodeMap=assign(expected.nodes,nodes,(a,b)=>aliases(a).includes(norm(b.label)) && (![a.id,a.key].filter(v=>v!=null).some(id=>nodes.some(n=>n.id===id && aliases(a).includes(norm(n.label)))) || [a.id,a.key].includes(b.id)));
 const nodeSlots=expected.nodes.map((wanted,i)=>({kind:'node',key:key(wanted),wanted,item:nodeMap.get(i)??null}));
 const ids=new Map(nodeSlots.map(s=>[key(s.wanted),s.item?.id]));
 const edgeMap=assign(expected.edges,edges,(a,b)=>ids.get(a.from)!=null && ids.get(a.to)!=null && ids.get(a.from)===b.from && ids.get(a.to)===b.to && norm(a.label)===norm(b.label));
 const edgeSlots=expected.edges.map((wanted,i)=>({kind:'edge',key:`${wanted.from}->${wanted.to}:${norm(wanted.label)}:${i}`,wanted,item:edgeMap.get(i)??null}));
 const labelWanted=[];
 for(const slot of nodeSlots)if(aliases(slot.wanted).length)labelWanted.push({kind:'label',key:`node:${slot.key}`,wanted:slot.wanted,nodeId:slot.item?.id,owner:slot.item,source:slot});
 for(const slot of edgeSlots)if(norm(slot.wanted.label))labelWanted.push({kind:'label',key:`edge:${slot.key}`,wanted:{label:slot.wanted.label},edge:slot.item,source:slot});
 const covered=new Set([...expected.nodes.flatMap(aliases),...expected.edges.map(e=>norm(e.label))]);
 for(const label of expected.requiredLabels??[])if(!covered.has(norm(label)))labelWanted.push({kind:'label',key:`extra:${norm(label)}`,wanted:{label},extra:true});
 const labelMap=assign(labelWanted,texts,(a,b)=>aliases(a.wanted).includes(norm(b.text)) && (a.nodeId!=null?b.nodeId===a.nodeId:a.edge?b.edgeFrom===a.edge.from && b.edgeTo===a.edge.to:a.extra?b.nodeId==null && b.edgeFrom==null:false));
 const labelSlots=labelWanted.map((s,i)=>({...s,item:labelMap.get(i)??null}));
 const legal=(parent,child)=>parent!==child && contains(parent?.rect,child?.rect) && ((child?.parentId===parent?.id && child.containmentAllowed===true) || (observation.containments??[]).some(c=>c.parent===parent?.id && c.child===child?.id));
 const present=s=>s.item?.visible===true;
 const missing=[];
 const measured=(slot,fn)=>{
  if(!present(slot))return 0;
  if(!validRect(slot.item.rect)){missing.push(`geometry:${slot.key}:rect`);return null;}
  if(!area(slot.item.rect))return 0;
  return fn(slot.item);
 };
 const visibleNodes=nodes.filter(n=>n.visible===true && validRect(n.rect));
 const visibleTexts=texts.filter(t=>t.visible===true && validRect(t.rect));
 const endpointContainer=(container,edge)=>{
  const pending=visibleNodes.filter(n=>n.id===edge.from || n.id===edge.to),seen=new Set(pending);
  while(pending.length) {
   const child=pending.pop();
   for(const parent of visibleNodes)if(legal(parent,child)) {
    if(parent===container)return true;
    if(!seen.has(parent)){seen.add(parent);pending.push(parent);}
   }
  }
  return false;
 };
 const occlusion=slot=>measured(slot,item=>{
  const edgeContainer=n=>slot.edge && [slot.edge.from,slot.edge.to].every(id=>n.id===id || visibleNodes.some(child=>child.id===id && legal(n,child)));
  const blockers=slot.kind==='node'?visibleNodes.filter(n=>n!==item && !legal(n,item) && !legal(item,n)):visibleNodes.filter(n=>n.id!==slot.nodeId && !(slot.owner && legal(n,slot.owner)) && !edgeContainer(n));
  const boxes=blockers.map(n=>intersect(item.rect,n.rect));
  if(slot.kind==='label')boxes.push(...visibleTexts.filter(t=>t!==item).map(t=>intersect(item.rect,t.rect)));
  return clamp(1-unionArea(boxes)/area(item.rect));
 });
 const clipping=slot=>measured(slot,item=>{
  let box=intersect(item.rect,observation.bounds);
  if(slot.kind==='label' && slot.owner?.visible===true && validRect(slot.owner.rect))box=intersect(box,slot.owner.rect);
  if(slot.kind==='node')for(const parent of visibleNodes)if(item.parentId===parent.id && item.containmentAllowed===true || (observation.containments??[]).some(c=>c.parent===parent.id && c.child===item.id))box=intersect(box,parent.rect);
  return clamp(area(box)/area(item.rect));
 });
 const font=slot=>measured(slot,item=>{
  if(typeof item.fontSize!=='number' || item.fontSize<0){missing.push(`geometry:${slot.key}:font`);return null;}
  if(clipping(slot)===0 || occlusion(slot)===0)return 0;
  return clamp(item.fontSize/profile.minFontPx);
 });
 const edgeMeasure=(slot,fn)=>{
  if(!present(slot))return 0;
  if(!validPath(slot.item)){missing.push(`geometry:${slot.key}:path`);return null;}
  return fn(slot.item);
 };
 const nodeOcclusion=nodeSlots.map(occlusion),labelOcclusion=labelSlots.map(occlusion),nodeClipping=nodeSlots.map(clipping),labelClipping=labelSlots.map(clipping);
 const edgeClipping=edgeSlots.map(s=>edgeMeasure(s,e=>pathFraction(e,[observation.bounds])));
 const fonts=labelSlots.map(font);
 const paths=edgeSlots.map(s=>edgeMeasure(s,e=>pathFraction(e,nodeSlots.filter(n=>present(n) && validRect(n.item.rect) && n.item.id!==e.from && n.item.id!==e.to && !endpointContainer(n.item,e)).map(n=>n.item.rect),false)));
 const classMean=classes=>{const values=classes.filter(v=>v.length).map(mean);return values.length?mean(values):1;};
 const details={
  occlusion:classMean([nodeOcclusion,labelOcclusion]),clipping:classMean([nodeClipping,labelClipping,edgeClipping]),
  font:fonts.length?mean(fonts):1,path:paths.length?mean(paths):1,
  objects:[...nodeSlots.map((s,i)=>({kind:s.kind,key:s.key,present:present(s),occlusion:nodeOcclusion[i],clipping:nodeClipping[i]})),...labelSlots.map((s,i)=>({kind:s.kind,key:s.key,present:present(s),occlusion:labelOcclusion[i],clipping:labelClipping[i],font:fonts[i]})),...edgeSlots.map((s,i)=>({kind:s.kind,key:s.key,present:present(s),clipping:edgeClipping[i],path:paths[i]}))],
  denominators:{nodes:nodeSlots.length,labels:labelSlots.length,edges:edgeSlots.length},missing:[...new Set(missing)],
 };
 for(const key of ['occlusion','clipping','font','path'])if(details[key]!==null)details[key]*=100;
 return {score:mean(['occlusion','clipping','font','path'].map(k=>details[k])),details};
}
function humanScore(receipt) {
 const byReviewer=new Map();
 for(const review of receipt.human?.reviews??[]) {
  if(review.status!=='completed')continue;
  nonempty(review.reviewerId,'human reviewer');
  requireValue(review.taskId===receipt.taskId,'human task binding mismatch');requireValue(review.artifactHash!=null && review.artifactHash===receipt.artifactHash,'human artifact binding mismatch');
  requireValue(RATINGS.every(k=>Number.isInteger(review.ratings?.[k]) && review.ratings[k]>=1 && review.ratings[k]<=5),'human ratings require five integers in 1–5');
  if(review.independent!==true || review.rubricVersion!==HUMAN_RUBRIC)continue;
  byReviewer.set(review.reviewerId,25*(mean(RATINGS.map(k=>review.ratings[k]))-1));
 }
 const count=byReviewer.size;return {score:mean([...byReviewer.values()]),count,complete:count>=2,provisional:count===1};
}
function timestamp(value,name) {
 if(value==null)return null;
 requireValue(typeof value==='string' && /^\d{4}-\d\d-\d\dT/.test(value) && Number.isFinite(Date.parse(value)),`${name} time must be ISO timestamp`);
 return Date.parse(value);
}
function accounting(receipt) {
 const offline=receipt.environment?.measurementMode==='offline-render';
 const start=timestamp(receipt.startedAt,'startedAt'),end=timestamp(receipt.completedAt,'completedAt');
 requireValue(start===null || end===null || end>=start,'completed time precedes start');
 const usage=receipt.usage??{};
 const totalTokens=numberOrNull(usage.totalTokens,'usage totalTokens',{integer:true}),costUsd=numberOrNull(usage.costUsd,'usage costUsd');
 const complete=usage.status==='complete' && usage.complete!==false && totalTokens!==null && costUsd!==null;
 return {offline,start,complete:complete && !offline,raw:{durationMs:offline || start===null || end===null?null:end-start,totalTokens:offline?null:totalTokens,costUsd:offline?null:costUsd}};
}
function candidatesOf(receipt,start) {
 requireValue(Array.isArray(receipt.candidates??[]),'candidates must be an array');
 let previous=start;const end=timestamp(receipt.completedAt,'completedAt');
 const candidates=(receipt.candidates??[]).map(c=>{
  if(receipt.status==='completed'||c.artifactHash!=null)nonempty(c.artifactHash,'candidate artifactHash');
  else requireValue(typeof c.sourceHash==='string'&&/^[a-f0-9]{64}$/i.test(c.sourceHash),'rejected candidate needs a source SHA256 hash');const time=timestamp(c.submittedAt,'candidate');requireValue(time!==null,'candidate submission time missing');
  requireValue(previous===null || time>=previous,'candidate time out of order');requireValue(end===null || time<=end,'candidate submitted after completion');previous=time;
  return {...c,time};
 });
 if(receipt.status==='completed'&&candidates.length)requireValue(candidates.at(-1).artifactHash===receipt.artifactHash,'final candidate artifact mismatch');
 return candidates;
}
function budgetViolated(receipt,account,candidates) {
 const b=receipt.identity.budget;
 return (b.maxCandidates!=null && candidates.length>b.maxCandidates) || (b.maxDurationMs!=null && account.raw.durationMs!==null && account.raw.durationMs>b.maxDurationMs) || (b.maxTokens!=null && account.raw.totalTokens!==null && account.raw.totalTokens>b.maxTokens) || (b.maxCostUsd!=null && account.raw.costUsd!==null && account.raw.costUsd>b.maxCostUsd);
}
export function scoreRun({task,receipt,profile=SCORE_PROFILE}) {
 profileOf(profile);finiteData(task,'task');finiteData(receipt,'receipt');
 requireValue(receipt?.schemaVersion===2 && receipt.benchmark==='diagram-quality','unsupported receipt schema');
 nonempty(receipt.runId,'runId');cell(receipt);const identity=identityOf(receipt);
 requireValue((task?.id??task?.taskId)===receipt.taskId,'task identity mismatch');
 if(task.type!=null && receipt.taskType!=null)requireValue(task.type===receipt.taskType,'task type identity mismatch');
 if(task.complexity!=null && receipt.complexity!=null)requireValue(task.complexity===receipt.complexity,'task complexity identity mismatch');
 requireValue(Array.isArray(task?.expected?.nodes) && Array.isArray(task?.expected?.edges),'task expected nodes and edges required');
 const account=accounting(receipt),candidates=candidatesOf(receipt,account.start);
 account.raw.deliveryDurationMs=account.offline || account.start===null || !candidates.length || receipt.delivery?.status!=='delivered' || candidates.at(-1).artifactHash!==receipt.artifactHash ? null : candidates.at(-1).time-account.start;
 const budgetFailure=budgetViolated(receipt,account,candidates);
 const semantic=receipt.objective?.semantic;
 const terminal=['timeout','no_candidate','provider_error','failed','invalid_source'].includes(receipt.status);
 const invalidDelivery=receipt.delivery?.status && !['delivered','unknown','unverified'].includes(receipt.delivery.status);
 const invalidEditable=receipt.editability?.status==='verified' && receipt.editability.passed===false;
 const missing=[];
 let knownFailure=terminal || !!invalidDelivery || invalidEditable;
 let content=null;
 if(!knownFailure && semantic?.status==='verified') {
  const nodes=numberOrNull(semantic.nodes?.f1,'semantic node F1',{max:1}),edges=numberOrNull(semantic.edges?.f1,'semantic edge F1',{max:1});
  if(nodes!==null && (!task.expected.edges.length || edges!==null))content=100*(task.expected.edges.length ? .4*nodes+.6*edges : nodes);
 }
 if(content===0)knownFailure=true;
 const layout=knownFailure?{score:0,details:{occlusion:0,clipping:0,font:0,path:0,objects:[],missing:[]}}:layoutScore(task,receipt.observation,profile);
 const human=knownFailure?{score:null,count:0,complete:false,provisional:false}:humanScore(receipt);
 const editable=receipt.editability?.status==='verified' && receipt.editability.passed===true;
 const delivered=receipt.status==='completed' && receipt.delivery?.status==='delivered' && typeof receipt.artifactHash==='string' && receipt.artifactHash.length>0;
 const finalCorrect=content===100 && semantic?.status==='verified' && semantic.passed===true && editable && delivered;
 let speed=null,cost=null;
 if(knownFailure){content=0;speed=0;cost=0;}
 else {
  if(content===null)missing.push('content');
  if(layout.score===null)missing.push(...(layout.details.missing.length?layout.details.missing:['layout']));
  if(!editable)missing.push('editability');if(!delivered)missing.push('delivery');
  const anchor=profile.thresholds[task.complexity??receipt.complexity];
  const efficiency=(value,bounds)=>100*clamp((bounds.bad-value)/(bounds.bad-bounds.good));
  if(content!==null && semantic?.status==='verified' && editable && delivered && !finalCorrect || budgetFailure){speed=0;cost=0;}
  else if(finalCorrect) {
   const elapsed=account.raw.durationMs;
   if(anchor && elapsed!==null)speed=efficiency(elapsed,anchor.timeMs);
   if(anchor && account.complete)cost=efficiency(account.raw.costUsd,anchor.costUsd);
  }
  if(speed===null)missing.push('speed');if(cost===null)missing.push('cost');
  // Actual usage is part of a completed experiment even if a wrong diagram earned no efficiency credit.
  if(!account.complete)missing.push('usage');
 }
 const scores={content,layout:layout.score,speed,cost,human:human.score};
 const incomplete=missing.length>0;
 const status=knownFailure?'failed':incomplete?'incomplete':'complete';
 const result={scoreVersion:profile.version,runId:receipt.runId,taskId:receipt.taskId,arm:receipt.arm,model:receipt.model,repeat:receipt.repeat,taskType:task.type??receipt.taskType??null,complexity:task.complexity??receipt.complexity??null,identity,modelConfiguration:clone(receipt.modelConfiguration??null),artifactHash:receipt.artifactHash??null,artifactPath:receipt.artifactPath??null,scores,...weightedTotals(scores,{profile,knownFailure,incomplete}),status,missing:[...new Set(missing)],knownFailure,layoutDetails:layout.details,raw:account.raw,human:{count:human.count,complete:human.complete,provisional:human.provisional}};
 finiteData(result,'scorecard');return result;
}
