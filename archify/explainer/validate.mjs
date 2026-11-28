import { explainer as validateGenerated } from '../renderers/shared/generated-validators.mjs';
import { validateSchema } from '../renderers/shared/validator.mjs';
import { parseInline } from './inline.mjs';
import { lintExplainerWriting } from './writing.mjs';
import { parseExplainerDiff } from './diff.mjs';
import { compileWhatIf, isWhatIf, resolveSlot, templateParts, WhatIfError } from './whatif-engine.mjs';
import { checkWhatIfGrid } from './whatif-grid.mjs';
import { compileExplainerChart } from './charts.mjs';

const ID = /^[A-Za-z][A-Za-z0-9_-]*$/;
const READER_IDS = new Set(['board','diagram-dialog','diagram-dialog-title','toast']);
const NODE_KEYS = {architecture:'components',sequence:'participants',lifecycle:'states',erd:'entities',class:'types',timeline:'events',waterfall:'spans',workflow:'nodes',dataflow:'nodes',tree:'nodes'};
const EDGE_KEYS = {architecture:'connections',sequence:'messages',lifecycle:'transitions',erd:'relationships',class:'relationships',workflow:'edges',dataflow:'edges'};
const at = (document,pointer) => pointer.split('/').slice(1).reduce((value,key)=>value?.[key.replaceAll('~1','/').replaceAll('~0','~')],document);

// Keep authored formula/selector data out of the inline prose grammar.
export function visitWhatIfLabels(block, visit) {
  const labels = (items, path) => items?.forEach((item, i) => visit(item.label, `${path}/${i}/label`));
  labels(block.cases, '/cases');
  labels(block.inputs, '/inputs');
  block.inputs?.forEach((input, i) => labels(input.options, `/inputs/${i}/options`));
  labels(block.presets, '/presets');
  labels(block.thresholds, '/thresholds');
  labels(block.computed?.series, '/computed/series');
  block.computed?.labels?.forEach((label, i) => visit(label, `/computed/labels/${i}`));
}

export function visitLiveSlots(document, visit, onError = error => { throw error; }) {
  function field(value, path) {
    let count = 0;
    function walk(tokens) {
      for (const token of tokens) {
        if (token.children) walk(token.children);
        if (token.type !== 'text') continue;
        try {
          for (const slot of templateParts(token.value)) {
            if (!slot.kind) continue;
            if (++count > 32) throw new WhatIfError('calc-budget', 'A live text field may use at most 32 slots.', slot.offset);
            visit({ ...slot, path, offset: token.offsets?.[slot.offset] ?? token.offset + slot.offset });
          }
        } catch(error) {
          error.path ??= path;
          error.offset = token.offsets?.[error.offset] ?? token.offset + error.offset;
          onError(error);
        }
      }
    }
    walk(parseInline(value,{textOffsets:true}).tokens);
  }
  if(document.answer.live)field(document.answer.summary,'/answer/summary');
  document.panels.forEach((panel, pi) => panel.blocks.forEach((block, bi) => {
    if(block.live)field(block.text,`/panels/${pi}/blocks/${bi}/text`);
  }));
}

export function compileExplainerWhatIf(document) {
  const model=compileWhatIf(document);
  visitLiveSlots(document, slot=>model.slots.push({...resolveSlot(model,{...slot,offset:0}),...slot}));
  return model;
}

/** Structural and semantic author validation; resource preparation owns byte and Git verification.
 * Deferred references into external native files are checked after prepareExplainerDiagrams.
 */
export function validateExplainer(document, {sourceMap = {}, sourceText, inputPath, writingMode = 'warn'} = {}) {
  const diagnostics = [], entries = [];
  function location(pointer,component,panelId) {
    let key=pointer, value;
    while(value===undefined) { value=sourceMap instanceof Map?sourceMap.get(key):sourceMap[key]; if(!key)break;key=key.slice(0,key.lastIndexOf('/')); }
    return {line:value?.line || 1,column:value?.column || 1,component,path:pointer,...(panelId?{panelId}:{}),...(inputPath?{input:inputPath}:{})};
  }
  function expressionLocation(pointer, offset, where) {
    const mapped = sourceMap instanceof Map ? sourceMap.get(pointer) : sourceMap[pointer];
    if (mapped && /^\s*[{[]/u.test(sourceText || '') && sourceText[mapped.start] === '"') {
      // A JSON string pointer includes its quotes. Count decoded UTF-16
      // units to locate the authored operator even after a JSON escape.
      let raw = mapped.start + 1;
      for (let decoded = 0; decoded < offset && raw < mapped.end - 1; decoded++) {
        if (sourceText[raw] === '\\') raw += sourceText[raw+1] === 'u' ? 6 : 2;
        else raw++;
      }
      return { line:where.line, column:where.column + raw - mapped.start };
    }
    if (mapped?.quote) {
      let raw = mapped.start;
      for (let decoded = 0; decoded < offset && raw < mapped.end; decoded++, raw++) {
        if (sourceText?.[raw] === '\\' && [mapped.quote,'\\'].includes(sourceText[raw+1])) raw++;
      }
      return {line:mapped.line,column:mapped.column + raw - mapped.start};
    }
    const text = at(document,pointer);
    const prefix = typeof text === 'string' ? text.slice(0,offset).split('\n') : [];
    const row = mapped?.rows?.[prefix.length-1];
    if (row) {
      let raw = row.start;
      for (let i = 0; i < prefix.at(-1).length && raw < row.end; i++, raw++) {
        if (sourceText?.[raw] === '\\' && ['|','\\'].includes(sourceText[raw+1])) raw++;
      }
      return {line:row.line,column:row.column + raw - row.start};
    }
    if (prefix.length > 1) return { line:where.line + prefix.length - 1, column:prefix.at(-1).length + 1 };
    return { line:where.line, column:where.column + offset };
  }
  function fail(code,pointer,component,reason,example,panelId) {
    diagnostics.push({code:`explainer/${code}`,severity:'error',message:reason,subject:location(pointer,component,panelId),
      evidence:{reason,example},supportedFixes:[`Use a valid form, for example: ${example}`]});
  }
  if(!validateGenerated(document)) {
    const seen=new Set();
    for(const error of validateGenerated.errors||[]) {
      if(error.keyword==='if')continue;
      let pointer=error.instancePath||'';
      if(error.keyword==='required')pointer+=`/${error.params.missingProperty}`;
      if(error.keyword==='additionalProperties')pointer+=`/${error.params.additionalProperty}`;
      const blockPath=pointer.match(/^\/panels\/\d+\/blocks\/\d+/u)?.[0];
      const component=blockPath?at(document,blockPath)?.type||'block':pointer.startsWith('/sources/')?'source':pointer.startsWith('/panels/')?'panel':'document';
      const reason=`${pointer||'/'} ${error.message}`;
      const key=`${error.keyword}\0${pointer}\0${JSON.stringify(error.params)}`;if(seen.has(key))continue;seen.add(key);
      let example;
      if(error.keyword==='required')example=`Add ${error.params.missingProperty} to the ${component}.`;
      else if(error.keyword==='additionalProperties')example=`Remove unsupported ${error.params.additionalProperty}.`;
      else if(pointer==='/meta/output')example='"output":"answer.html"';
      else if(error.keyword==='type')example=error.params.type==='number'?'value=12.5':error.params.type==='boolean'?'multiple=true':error.params.type==='array'?'"items":["First item","Second item"]':error.params.type==='object'?'"meta":{"id":"answer-page","title":"Answer"}':'"text":"A direct explanation."';
      else if(error.keyword==='const')example=`Use ${JSON.stringify(error.params.allowedValue)}.`;
      else if(error.keyword==='enum')example=`Choose ${error.params.allowedValues.map(value=>JSON.stringify(value)).join(', ')}.`;
      else if(error.keyword==='oneOf'&&component==='diagram')example='@diagram sequence source=request.sequence.json';
      else if(error.keyword==='minimum'||error.keyword==='exclusiveMinimum'||error.keyword==='maximum')example=`Use a finite value satisfying the stated bound, such as ${error.params.limit + (error.keyword==='exclusiveMinimum'?1:0)}.`;
      else if(error.keyword==='pattern')example=pointer.endsWith('/revision')?'revision=0123456789abcdef0123456789abcdef01234567':'id=request-path';
      else if(error.keyword==='minItems')example='| a | First option |\n| b | Second option |';
      else if(error.keyword==='minLength')example='text="A direct explanation."';
      else example=component==='panel'?'## Why does this happen? {#reasoning}\nA direct explanation.':component==='source'?'@source facts example title="Stated facts"':`@${component} id=example`;
      fail(`schema-${error.keyword}`,pointer||'/',component,reason,example);
    }
    return {ok:false,diagnostics};
  }
  const targets=new Map([['answer',{pointer:'/answer',component:'answer'}]]), sourceIds=new Map(), diagrams=new Map(), invalidNative=new Set();
  function id(value,pointer,component,panelId,registry=targets) {
    if(!ID.test(value)||value.length>100)fail('id',pointer,component,'IDs require an ASCII letter followed by letters, digits, hyphens or underscores.','id=request-path',panelId);
    if(registry.has(value))fail('duplicate-id',pointer,component,'This identity is already used. Use an explicit distinct ID.','id=request-path-branch',panelId);
    registry.set(value,{pointer,component,panelId});
    if(registry===targets&&(value.startsWith('explainer-')||READER_IDS.has(value)))fail('reserved-id',pointer,component,'This identity is reserved for reader controls or generated footnotes.','id=request-path',panelId);
  }
  for(const [si,source]of document.sources.entries())id(source.id,`/sources/${si}/id`,'source',undefined,sourceIds);
  for(const [pi,panel]of document.panels.entries()) {
    const pp=`/panels/${pi}`;id(panel.id,`${pp}/id`,'panel',panel.id);
    for(const [bi,block]of panel.blocks.entries()) {
      const bp=`${pp}/blocks/${bi}`;id(block.id,`${bp}/id`,block.type,panel.id);
      if(block.type==='diagram') {
        diagrams.set(block.id,{block,pointer:bp,panelId:panel.id});
        if(block.spec) {
          if(block.spec.diagram_type!==block.diagramType)fail('diagram-type',`${bp}/spec/diagram_type`,block.type,'The native specification must match the declared diagram type.','@sequence source=request.sequence.json',panel.id);
          try{validateSchema(block.diagramType,block.spec);}catch(error){
            invalidNative.add(block);
            for(const entry of error.archifyDiagnostics||[])diagnostics.push({...entry,code:`explainer/native-${entry.code}`,subject:location(`${bp}/spec${entry.subject?.path==='/'?'':entry.subject?.path||''}`,block.type,panel.id),evidence:{...entry.evidence,reason:entry.message,example:`Use valid native ${block.diagramType} JSON.`}});
          }
        }
      }
      if(['comparison','steps'].includes(block.type))for(const [ii,item]of (block.rows||block.items).entries()) {
        const ip=`${bp}/${block.rows?'rows':'items'}/${ii}`;id(item.id,`${ip}/id`,block.type,panel.id);
      }
    }
  }
  for(const sourceId of sourceIds.keys())if(targets.has(`source-${sourceId}`))fail('reserved-id',targets.get(`source-${sourceId}`).pointer,'source','This identity collides with a generated source anchor.','id=reader-section');
  function reference(value,pointer,component,panelId,registry,example) {
    if(!registry.has(value))fail('unresolved-reference',pointer,component,'The referenced identity does not exist or has the wrong component type.',example,panelId);
  }
  function references(values,pointer,component,panelId,registry,example) {
    const seen=new Set();for(const [i,value]of (values||[]).entries()) {reference(value,`${pointer}/${i}`,component,panelId,registry,example);if(seen.has(value))fail('duplicate-reference',`${pointer}/${i}`,component,'Each reference may occur only once.','Use each ID once.',panelId);seen.add(value);}
  }
  function diagramTarget(target,pointer,component,panelId) {
    if (target.node !== undefined && target.route !== undefined) fail('diagram-target-exclusive',pointer,component,'A diagram target cannot select a node and a route at the same time.','{"diagram":"request-path","node":"api"} or {"diagram":"request-path","route":["api","redis"]}',panelId);
    reference(target.diagram,`${pointer}/diagram`,component,panelId,diagrams,'Use the ID of a diagram block, such as request-path.');
    const diagram=diagrams.get(target.diagram);if(!diagram?.block.spec||invalidNative.has(diagram.block))return;
    const spec=diagram.block.spec;
    const nodes=new Set((spec[NODE_KEYS[diagram.block.diagramType]]||[]).map(node=>node.id));
    const edges=spec[EDGE_KEYS[diagram.block.diagramType]]||[];
    if(target.node!==undefined&&!nodes.has(target.node))fail('diagram-node',`${pointer}/node`,component,'The node does not exist in the authored native diagram.','node=api',panelId);
    for(const node of target.route||[])if(!nodes.has(node))fail('diagram-route',`${pointer}/route`,component,'A route endpoint does not exist in the authored native diagram.','route=api~redis',panelId);
    if(target.edges)references(target.edges,`${pointer}/edges`,component,panelId,new Map(edges.filter(edge=>edge.id).map(edge=>[edge.id,edge])),'Use an edge ID from the native diagram.');
  }
  function text(value,pointer,component,panelId,live = false,plain = false) {
    if(typeof value!=='string')return;
    const where=location(pointer,component,panelId);
    const parsed=parseInline(value,{...where,input:inputPath});diagnostics.push(...parsed.diagnostics.map(entry=>({...entry,subject:{...entry.subject,path:pointer}})));
    if (plain && !parsed.diagnostics.length &&
        (parsed.tokens.some(token=>token.type!=='text') || parsed.tokens.map(token=>token.value).join('')!==value)) {
      fail('label-markup',pointer,component,'Use plain text in interactive labels.','Warm cache',panelId);
      return;
    }
    const mask = value => live ? value.replace(/\{\{(?:value:[A-Za-z][\w-]*|metric:[A-Za-z][\w-]*|scenario)\}\}/gu, match=>' '.repeat(match.length)) : value;
    const prose=tokens=>tokens.map(token=>token.type==='code'?'':token.children?prose(token.children):token.type==='link'?token.label:mask(token.value||'')).join('');
    if(component!=='source')entries.push({text:prose(parsed.tokens),raw:mask(value),pointer,line:where.line,component,...(panelId?{panelId}:{})});
    for(const ref of parsed.references) {
      if(ref.kind==='source')reference(ref.id,pointer,component,panelId,sourceIds,'[Evidence](source:known-source)');
      if(ref.kind==='block')reference(ref.id,pointer,component,panelId,targets,'[Read explanation](block:known-block)');
      if(ref.kind==='node')diagramTarget({diagram:ref.diagram,node:ref.node},pointer,component,panelId);
      if(ref.kind==='route')diagramTarget({diagram:ref.diagram,route:[ref.from,ref.to]},pointer,component,panelId);
      if(ref.kind==='typical'&&!['source','scope'].includes(component))entries.push({text:ref.text,line:where.line,component:'typical',...(panelId?{panelId}:{})});
    }
  }
  text(document.meta.title,'/meta/title','title');text(document.answer.summary,'/answer/summary','answer',undefined,Boolean(document.answer.live));(document.answer.reasons||[]).forEach((reason,i)=>text(reason,`/answer/reasons/${i}`,'answer'));
  text(document.answer.scope,'/answer/scope','scope');
  for(const [si,source]of document.sources.entries()) {
    const pointer=`/sources/${si}`;text(source.title,`${pointer}/title`,'source');
    if(source.lines&&source.lines[1]<source.lines[0])fail('source-lines',`${pointer}/lines`,'source','The repository line range must be ordered.','lines=10:20');
    if(source.url) {let url;try{url=new URL(source.url);}catch{}if(!url||!['http:','https:'].includes(url.protocol)||url.username||url.password||/[\u0000-\u0020\u007f]/u.test(source.url))fail('source-url',`${pointer}/url`,'source','Source URLs must be credential-free HTTP(S) links.','url=https://example.com/docs');}
  }
  for(const [pi,panel]of document.panels.entries()) {
    const pp=`/panels/${pi}`;text(panel.title,`${pp}/title`,'panel',panel.id);
    for(const [bi,block]of panel.blocks.entries()) {
      const bp=`${pp}/blocks/${bi}`, component=block.type;
      if(component==='diff')diagnostics.push(...parseExplainerDiff(block.text,{...location(`${bp}/text`,component,panel.id),input:inputPath}).diagnostics);
      if(component==='chart'&&block.text!==undefined){const chart=compileExplainerChart(block.text);if(chart.error){const before=diagnostics.length;fail('chart',`${bp}/text`,component,chart.error,chart.example,panel.id);if(chart.line>0)diagnostics[before].subject.line+=chart.line-1;}}
      for(const key of ['text','title','label','note','caption','alt'])if(!['diff','snippet','chart'].includes(component)||key!=='text')text(block[key],`${bp}/${key}`,component,panel.id,key==='text'&&Boolean(block.live));
      visitWhatIfLabels(block,(value,pointer)=>text(value,bp+pointer,component,panel.id,false,true));
      if(component==='list')block.items.forEach((item,i)=>text(item,`${bp}/items/${i}`,component,panel.id));
      if(component==='facts')block.entries.forEach((item,i)=>{text(item.key,`${bp}/entries/${i}/key`,component,panel.id);text(item.value,`${bp}/entries/${i}/value`,component,panel.id);});
      if(component==='comparison') {
        block.columns.forEach((column,i)=>text(column,`${bp}/columns/${i}`,component,panel.id));text(block.labelColumn,`${bp}/labelColumn`,component,panel.id);
        block.rows.forEach((row,i)=>{const rp=`${bp}/rows/${i}`;text(row.label,`${rp}/label`,component,panel.id);if(row.cells.length!==block.columns.length)fail('table-width',`${rp}/cells`,component,'Each row must have one cell for every comparison column.','| Criterion | Option A | Option B |',panel.id);row.cells.forEach((cell,j)=>{text(cell.text,`${rp}/cells/${j}/text`,component,panel.id);text(cell.verdict,`${rp}/cells/${j}/verdict`,component,panel.id);});});
      }
      if(component==='steps')block.items.forEach((item,i)=>{text(item.text,`${bp}/items/${i}/text`,component,panel.id);text(item.detail,`${bp}/items/${i}/detail`,component,panel.id);if(item.target)diagramTarget(item.target,`${bp}/items/${i}/target`,component,panel.id);});
      if(component==='code') {reference(block.source,`${bp}/source`,component,panel.id,sourceIds,'source=repository-snippet');if(sourceIds.has(block.source)&&document.sources.find(source=>source.id===block.source)?.path===undefined)fail('code-source-kind',`${bp}/source`,component,'Code blocks require a repository source whose commit and lines can be checked.','@source snippet title="Code" path=src/router.js lines=1:10',panel.id);}
      if(component==='diagram'&&block.nodeSources)for(const [node,source] of Object.entries(block.nodeSources))reference(source,`${bp}/nodeSources/${node}`,component,panel.id,sourceIds,`| ${node} | Label | backend | source:router |`);
      if(component==='diagram'&&block.nodeBlocks)for(const [node,target] of Object.entries(block.nodeBlocks)) {
        reference(target,`${bp}/nodeBlocks/${node}`,component,panel.id,targets,`@prose id=${target}\nThe node's explanation.`);
        if(targets.has(target)&&!['prose','callout','list','facts'].includes(targets.get(target).component))fail('content-reference',`${bp}/nodeBlocks/${node}`,component,'Node content must reference a prose, callout, list or facts block.','@prose id=node-notes\nThe node\'s explanation.',panel.id);
      }
      if(component==='diagram')for(const key of ['nodeSources','nodeBlocks'])for(const node of Object.keys(block[key]||{}))diagramTarget({diagram:block.id,node},`${bp}/${key}/${node}`,component,panel.id);
    }
  }
  let grid;
  if (isWhatIf(document)) {
    const report = (error, detail = {}) => {
      if (!(error instanceof WhatIfError)) throw error;
      const pointer=error.path || '/';
      const panel=at(document,pointer.match(/^\/panels\/\d+/u)?.[0] || '/');
      const component=at(document,pointer.match(/^\/panels\/\d+\/blocks\/\d+/u)?.[0] || '/')?.type ||
        (pointer.startsWith('/answer/') ? 'answer' : 'calc');
      const where=location(pointer,component,panel?.id);
      const example='Correct the indicated expression, binding or input domain.';
      diagnostics.push({code:`explainer/${error.code}`,severity:'error',message:error.message,
        subject:{...where,...expressionLocation(pointer,error.offset,where),expressionOffset:error.offset},
        evidence:{reason:error.message,example,...detail},supportedFixes:[example]});
    };
    try {
      const model=compileWhatIf(document);
      visitLiveSlots(document, slot=>{
        try { model.slots.push(resolveSlot(model,slot)); }
        catch(error) { error.path=slot.path; report(error); }
      },report);
      if (!diagnostics.some(entry=>entry.severity==='error')) grid=checkWhatIfGrid(model,report);
    } catch(error) { report(error); }
  }
  diagnostics.push(...lintExplainerWriting(entries,{mode:writingMode,locale:document.meta.locale||'auto'}).map(entry=>({...entry,subject:{...entry.subject,...(inputPath?{input:inputPath}:{})}})));
  return {ok:!diagnostics.some(entry=>entry.severity==='error'),diagnostics,...(grid ? {grid} : {})};
}
