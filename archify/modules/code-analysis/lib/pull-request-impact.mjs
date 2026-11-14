// A bounded delta over existing snapshots. No extraction, project scan, package
// execution or transitive/runtime analysis. Definition reading and reverse
// references reuse the existing question readers.
import { capturedDefinitions } from './change-question.mjs';
import { questionCalls } from './question-calls.mjs';
import { questionIncoming, indexIncoming } from './question-incoming.mjs';
import { readInside } from './evidence.mjs';
import { comparability } from './review.mjs';

const LIMITS = { files: 32, definitions: 80, bytes: 4 * 1024 * 1024, records: 160, references: 5 };
const key = (...parts) => JSON.stringify(parts);
const unique = items => [...new Set(items)];
const functionKey = fn => key(fn.file, fn.qualname || fn.name);
const groups = (items, identify) => {
  const map = new Map();
  for (const item of items) { const id=identify(item), list=map.get(id)||[];list.push(item);map.set(id,list); }
  return map;
};
const location = (side,file,line=1) => ({side,file,line});
const metrics = fn => fn ? {complexity:fn.complexity,nesting:fn.nesting,length:fn.endLine-fn.line+1} : null;
// Read already-computed rule observations; do not recalculate graph closure or
// compare source coordinates/digests as if they were structural measurements.
function structuralMeasures(finding) {
  const evidence=finding.evidence||{},values={};
  for(const section of ['reach','size']) for(const [field,value]of Object.entries(evidence[section]||{})) if(typeof value==='number') values[section+'.'+field]=value;
  for(const field of ['lines','fileLines','loc']) if(typeof evidence[field]==='number') values[field]=evidence[field];
  return values;
}

function snapshotReader(facts, root) {
  const files=new Map(facts.files.map(file=>[file.path,file])), inspected=new Map(), calls=new Map();
  const index=indexIncoming(facts);
  const inspect=file=>{
    if(inspected.has(file)) return inspected.get(file);
    const captured=files.get(file),current=root?readInside(root,file):{status:'not-checked'};
    const result={file,parseErrors:(facts.parse_errors||[]).filter(error=>error.path===file),currentStatus:current.status,
      factsStatus:!captured?'unverifiable':current.status!=='ok'?current.status:current.text===captured.sourceText?'valid':'changed'};
    inspected.set(file,result);return result;
  };
  const fileCalls = file => {
    const entry=inspect(file);
    if(!calls.has(file)) calls.set(file,questionCalls({facts,inspect,entry,text:files.get(file)?.sourceText,symbol:null,location:null}));
    return {entry,calls:calls.get(file)};
  };
  return {
    files,
    fileReferences(file) {
      return questionIncoming({facts,inspect,...fileCalls(file),symbol:null,index});
    },
    references(definition) {
      const selected=fileCalls(definition.file),entry=selected.entry;
      // The exact range is from the same shared definition reader used by
      // change-question, rather than from a name search or rebound symbol.
      return questionIncoming({facts,inspect,entry,symbol:definition.qualname||definition.name,
        selectedFunction:definition,calls:{...selected.calls,selection:{...selected.calls.selection,range:definition}},index});
    }
  };
}

function topology(facts, graph) {
  const modules=new Map(graph.modules.map(module=>[module.id,module]));
  const fileModules=new Map(Object.entries(graph.fileModules||{}));
  const files=new Set(facts.files.filter(file=>fileModules.has(file.path)).map(file=>file.path)),edges=new Map();
  for(const item of facts.imports) {
    if(!item.resolved||!files.has(item.from)||!files.has(item.to)) continue;
    const id=key(item.from,item.to),old=edges.get(id);
    const form=JSON.stringify({kind:item.kind||null,typeOnly:!!item.typeOnly,lazy:!!item.lazy,conditional:!!item.conditional,deferred:!!item.deferred,level:item.level||null});
    if(!old) edges.set(id,{from:item.from,to:item.to,line:item.line,forms:[form]});
    else {old.line=Math.min(old.line,item.line);if(!old.forms.includes(form))old.forms.push(form);}
  }
  for(const edge of edges.values())edge.forms.sort();
  return {modules,fileModules,edges};
}

export function buildPullRequestImpact({baseFacts,headFacts,baseGraph,headGraph,baseFindings,headFindings,baseRoot=null,headRoot=null,changedFiles,limits={}}) {
  const budget={...LIMITS,...limits},records=[],skipped=[],shifted=[];
  const base=snapshotReader(baseFacts,baseRoot),head=snapshotReader(headFacts,headRoot);
  const before=topology(baseFacts,baseGraph),after=topology(headFacts,headGraph);
  // External producer/binding limits remain separate from native measurements.
  const comparison=comparability({...baseFindings.analysis,external:[]},{...headFindings.analysis,external:[]});
  const changed=new Set(changedFiles.flatMap(file=>[file.path,file.previousPath].filter(Boolean)));
  const headById=new Map(headFindings.diagnostics.map(f=>[f.id,f])),baseById=new Map(baseFindings.diagnostics.map(f=>[f.id,f]));
  const contexts=(record)=>headFindings.diagnostics.filter(f=>{
    if(f.external||!baseById.has(f.id)||!['coupling','architecture'].includes(f.dimension)) return false;
    const s=f.subject||{},mods=[s.module,...(s.modules||[])].filter(Boolean);
    if(mods.length) return record.module?mods.includes(record.module):mods.includes(after.fileModules.get(record.from))&&mods.includes(after.fileModules.get(record.to));
    const files=[s.file,...(s.files||[])].filter(Boolean);return files.includes(record.from)&&files.includes(record.to);
  }).slice(0,3).map(f=>({id:f.id,code:f.code}));
  const add=record=>{records.push({id:key(record.kind,record.path||record.from||record.module,record.name||record.to||''),severity:'info',...record});};
  function collectDependencies() {
    for(const id of new Set([...before.edges.keys(),...after.edges.keys()])) {
      const a=before.edges.get(id),b=after.edges.get(id);if(a&&b&&JSON.stringify(a.forms)===JSON.stringify(b.forms)) continue;
      const edge=b||a,side=b?'head':'base',record={kind:a&&b?'dependency-changed':b?'dependency-added':'dependency-removed',category:'architecture',...edge,
        before:a?{forms:a.forms.map(JSON.parse)}:null,after:b?{forms:b.forms.map(JSON.parse)}:null,
        locations:[location(side,edge.from,edge.line),location(side,edge.to)],rank:2};
      if(a&&b)record.locations.unshift(location('base',a.from,a.line));
      record.contexts=contexts(record);
      const changedConstraint=comparison.comparable===true&&record.contexts.find(context=>baseById.get(context.id)?.severity!==headById.get(context.id)?.severity);
      if(changedConstraint){record.findingId=changedConstraint.id;record.severity=headById.get(changedConstraint.id).severity;}
      add(record);
    }
  }
  function collectModuleCoupling() {
    for(const id of new Set([...before.modules.keys(),...after.modules.keys()])) {
      const a=before.modules.get(id),b=after.modules.get(id);
      if(a&&b&&a.fanIn===b.fanIn&&a.fanOut===b.fanOut) continue;
      const touched=records.filter(r=>r.category==='architecture'&&(after.fileModules.get(r.from)===id||after.fileModules.get(r.to)===id||before.fileModules.get(r.from)===id||before.fileModules.get(r.to)===id));
      if(!touched.length) continue;
      const record={kind:!a?'module-added':!b?'module-removed':'module-coupling',category:'architecture',module:id,
        before:a?{fanIn:a.fanIn,fanOut:a.fanOut}:null,after:b?{fanIn:b.fanIn,fanOut:b.fanOut}:null,
        locations:touched.flatMap(r=>r.locations).slice(0,budget.references),rank:1};
      record.contexts=contexts(record);add(record);
    }
  }
  function collectStructuralMeasures() {
    if(comparison.comparable===true) for(const finding of headFindings.diagnostics) {
      const previous=baseById.get(finding.id);
      if(!previous||finding.external||!['coupling','architecture'].includes(finding.dimension)) continue;
      const a=structuralMeasures(previous),b=structuralMeasures(finding);
      const changes=unique([...Object.keys(a),...Object.keys(b)]).filter(field=>a[field]!==b[field]).map(field=>({field,before:a[field]??null,after:b[field]??null}));
      if(!changes.length) continue;
      const module=finding.subject?.module,path=finding.subject?.file;
      const file=path||[...after.fileModules].find(([,owner])=>owner===module)?.[0];
      if(!file) continue;
      const oldFile=path||[...before.fileModules].find(([,owner])=>owner===module)?.[0];
      add({kind:'structural-measures',category:'architecture',module,path:file,name:finding.id,changes,findingId:finding.id,
        severity:finding.severity,locations:[...(oldFile?[location('base',oldFile)]:[]),location('head',file)],
        contexts:[{id:finding.id,code:finding.code}],rank:1,proof:{measurement:'existing-native-rule-evidence',causality:'aggregate-snapshot-delta; individual-edge-causality-not-determined'}});
    }
  }
  const baseFunctions=groups(baseFacts.functions,functionKey),headFunctions=groups(headFacts.functions,functionKey);
  const findingFunctions=groups(headFindings.diagnostics.filter(f=>!f.external&&f.code==='complexity/function'),f=>key(f.subject.file,f.subject.function));
  const work={parsedFiles:0,parsedBytes:0,definitions:0,repositoryScans:0};
  function compareDefinitions(file, bs, hs) {
      for(const slot of new Set([...bs.keys(),...hs.keys()])) {
        const aa=bs.get(slot)||[],bb=hs.get(slot)||[];
        if(aa.length>1||bb.length>1) {skipped.push({file,reason:'ambiguous-definition-slot'});continue;}
        const prev=aa[0],next=bb[0],definition=next||prev;
        if(prev&&next&&prev.textSha256===next.textSha256) {
          if(prev.line!==next.line||prev.column!==next.column) shifted.push({file,name:definition.qualname||definition.name});
          continue;
        }
        if(work.definitions>=budget.definitions) {skipped.push({file,reason:'definition-reading-budget'});break;}
        work.definitions++;
        const name=definition.qualname||definition.name,id=key(file,name),af=baseFunctions.get(id)||[],bf=headFunctions.get(id)||[];
        const old=af.length===1?metrics(af[0]):null,current=bf.length===1?metrics(bf[0]):null;
        const measured=prev&&next&&old&&current&&JSON.stringify(old)!==JSON.stringify(current);
        const finding=findingFunctions.get(id)?.length===1?findingFunctions.get(id)[0]:null;
        const refs=next?head.references(next):base.references(prev),side=next?'head':'base';
        const callers=refs.callers.records.filter(item=>item.navigation.status==='valid');
          const sourceLocations=[...(prev?[location('base',file,prev.line)]:[]),...(next?[location('head',file,next.line)]:[])];
        const kind=!prev?'definition-added':!next?'definition-removed':measured?'function-metrics':'definition-text';
        add({kind,category:'complexity',path:file,name,before:old,after:current,locations:sourceLocations,
          findingId:finding?.id||null,severity:finding?.severity||'info',rank:measured?1:!prev||!next?2:3,
          callers:{coverage:refs.callers.coverage,total:refs.callers.total,omitted:refs.callers.omitted},
          proof:{base:prev?.textSha256||null,head:next?.textSha256||null,pairing:'unique-file-qualified-name-and-syntax-kind',behavior:'not-determined'}});
        if(callers.length) add({kind:'known-users',category:'architecture',path:file,name,rank:3,
          locations:[...sourceLocations,...callers.slice(0,budget.references).map(item=>({...item.navigation.location,side,relation:'bound-call',unchanged:base.files.get(item.fact.file)?.sourceText===head.files.get(item.fact.file)?.sourceText}))],
          callers:{coverage:refs.callers.coverage,total:refs.callers.total,omitted:refs.callers.omitted},importers:refs.importers.total,
          unchangedCallers:callers.filter(item=>base.files.get(item.fact.file)?.sourceText===head.files.get(item.fact.file)?.sourceText).length,
          proof:{changedDefinition:sourceLocations,runtimeTarget:'not-determined',transitiveImpact:'not-computed'}});
      }
  }
  function collectSourceChanges() {
    for(const file of [...changed].sort()) {
      const a=base.files.get(file),b=head.files.get(file);
      if(!a&&!b) {skipped.push({file,reason:'not-in-captured-language-selection'});continue;}
      if(!before.fileModules.has(file)&&!after.fileModules.has(file)) {skipped.push({file,reason:'outside-analyzed-modules'});continue;}
      if(a?.sourceText===b?.sourceText) continue;
      const bytes=Buffer.byteLength(a?.sourceText||'')+Buffer.byteLength(b?.sourceText||'');
      if(work.parsedFiles>=budget.files||work.parsedBytes+bytes>budget.bytes) {skipped.push({file,reason:'source-reading-budget'});continue;}
      work.parsedFiles++;work.parsedBytes+=bytes;
      const parsed={};
      for(const [side,facts] of [['base',baseFacts],['head',headFacts]]) {
        const definitions=capturedDefinitions(facts,file);
        if(!['available','not-captured'].includes(definitions.coverage)) skipped.push({file,side,reason:definitions.coverage});
        parsed[side]=groups(definitions.records,definition=>key(definition.qualname||definition.name,definition.kind));
      }
      const bs=parsed.base,hs=parsed.head,definitionsBefore=work.definitions;
      compareDefinitions(file,bs,hs);
      // Module-level initializers/exports can change without changing a function
      // metric. Retain a bounded reading signal, not a claim about its behavior.
      if(work.definitions===definitionsBefore&&(a?.sourceText||'').replace(/\r\n/g,'\n').trim()!==(b?.sourceText||'').replace(/\r\n/g,'\n').trim()) {
        const locations=[...(a?[location('base',file)]:[]),...(b?[location('head',file)]:[])];
        add({kind:'file-source',category:'complexity',path:file,locations,rank:4,proof:{behavior:'not-determined'}});
      }
      // A file import does not prove that a particular changed export is used.
      // Keep this context once per changed file, separate from exact bound calls.
      if(work.definitions>definitionsBefore||(a?.sourceText||'').replace(/\r\n/g,'\n').trim()!==(b?.sourceText||'').replace(/\r\n/g,'\n').trim()) {
        const side=b?'head':'base',refs=(b?head:base).fileReferences(file).importers;
        const importers=refs.records.filter(item=>item.navigation.status==='valid');
        if(importers.length) add({kind:'known-importers',category:'architecture',path:file,rank:4,importers:refs.total,
          locations:[location(side,file),...importers.slice(0,budget.references).map(item=>({...item.navigation.location,side,relation:'file-import',unchanged:base.files.get(item.fact.from)?.sourceText===head.files.get(item.fact.from)?.sourceText}))]});
      }
    }
  }
  // A new native structural finding needs a changed dependency witness. Merely
  // getting a different evidence digest never promotes an existing finding.
  function collectNewStructuralFindings() {
    if(comparison.comparable===true) for(const f of headFindings.diagnostics) {
      if(f.external||baseById.has(f.id)||!['coupling','architecture'].includes(f.dimension)) continue;
      const files=new Set([f.subject?.file,...(f.subject?.files||[]),...(f.evidence?.imports||[]).flatMap(i=>[i.file,i.to])].filter(Boolean));
      const mods=new Set([f.subject?.module,...(f.subject?.modules||[])].filter(Boolean));
      const witness=records.find(r=>r.kind.startsWith('dependency-')&&(files.has(r.from)||files.has(r.to)||mods.has(after.fileModules.get(r.from))||mods.has(after.fileModules.get(r.to))))
        || (Object.keys(structuralMeasures(f)).length?records.find(r=>r.kind.startsWith('dependency-')||changed.has(f.subject?.file)&&r.path===f.subject.file):null);
      if(witness) add({kind:'structural-finding-added',category:'architecture',path:witness.from||witness.path,name:f.id,module:f.subject?.module,code:f.code,findingId:f.id,severity:f.severity,locations:witness.locations,rank:0});
    }
  }
  collectDependencies();
  collectModuleCoupling();
  collectStructuralMeasures();
  collectSourceChanges();
  collectNewStructuralFindings();
  records.sort((a,b)=>a.rank-b.rank||a.id.localeCompare(b.id));
  const total=records.length,included=records.slice(0,budget.records),categories={};
  for(const category of ['architecture','complexity']) {
    const list=included.filter(record=>record.category===category);
    categories[category]={total:records.filter(record=>record.category===category).length,priorities:list.slice(0,3).map(record=>record.id)};
  }
  return {schema_version:1,status:skipped.length||total>included.length?'partial':'available',basis:'pinned-snapshot-delta-and-existing-static-references',
    comparison,records:included,total,included:included.length,omitted:total-included.length,categories,
    findingIds:unique(included.map(record=>record.findingId).filter(id=>id&&headById.has(id))),
    coverage:{limits:budget,work,positionOnly:shifted.length,skipped,unresolvedCalls:{base:baseFacts.calls?.filter(c=>!c.target).length??null,head:headFacts.calls?.filter(c=>!c.target).length??null},
      runtime:'not-executed',transitiveImpact:'not-computed',unknowns:'Unresolved, dynamic, external and excluded references are not known zero.'}};
}
