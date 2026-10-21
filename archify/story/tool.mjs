import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {compileBrief,draftBrief,nativeMotions,openingModes} from './story-plan.mjs';
import {resolveOutputPath} from '../renderers/shared/output-path.mjs';
import {writeStoryOutput,rollbackStoryOutput} from './output.mjs';
import {parse,serializeOuter} from './vendor/html-parser.mjs';
import {attachStory} from './story-attachment.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));

const attr=(node,key)=>node?.attrs?.find(a=>a.name===key)?.value;
const walk=node=>[node,...(node.childNodes||[]).flatMap(walk)];
const text=node=>(node?.childNodes||[]).map(child=>child.value||text(child)).join('').trim();
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function read(file){
  const html=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(fs.readFileSync(file)),tree=walk(parse(html));
  const diagrams=tree.filter(node=>node.tagName==='svg'&&attr(node,'data-quality-profile'));
  if(diagrams.length!==1)throw Error('Story needs exactly one Archify native diagram in the HTML.');
  const [svg]=diagrams;
  const elements=walk(svg),declared=new Map(elements.filter(node=>attr(node,'data-edge-id')&&attr(node,'data-edge-key')!==undefined).map(node=>[attr(node,'data-edge-key'),attr(node,'data-edge-id')]));
  for(const node of elements)if(attr(node,'data-edge-from')&&!attr(node,'data-edge-id')&&attr(node,'data-edge-key')!==undefined){
    node.attrs.push({name:'data-edge-id',value:declared.get(attr(node,'data-edge-key'))||'edge:'+attr(node,'data-edge-key')});
  }
  for(const node of elements.filter(node=>attr(node,'data-domain-band')!==undefined)){
    const rect=walk(node).find(child=>child.tagName==='rect');if(!rect)continue;
    for(const [name,value]of Object.entries({'data-composition-frame-id':'domain:'+attr(node,'data-domain-band'),'data-composition-frame-kind':'domain','data-composition-frame-label':attr(node,'data-domain-band'),...Object.fromEntries(['x','y','width','height'].map(key=>[key,attr(rect,key)]))}))node.attrs.push({name,value});
  }
  return {html,tree,svg,elements};
}

function factsOf(source){
  const evidenceNode=source.tree.find(node=>node.tagName==='script'&&attr(node,'id')==='archify-source-evidence-data');
  const evidence=evidenceNode?JSON.parse(text(evidenceNode)):null;
  const edgeMap=new Map();
  for(const node of source.elements.filter(node=>attr(node,'data-edge-id'))){
    const id=attr(node,'data-edge-id'),values={id,key:attr(node,'data-edge-key'),from:attr(node,'data-edge-from'),to:attr(node,'data-edge-to'),label:attr(node,'data-edge-label'),ends:attr(node,'data-er-ends'),kind:attr(node,'data-class-relationship')};
    if(walk(node).some(part=>attr(part,'data-animate')==='edge'))values.animated=true;
    const previous=edgeMap.get(id);
    for(const key of ['key','from','to','label','ends','kind'])if(values[key]!==undefined&&previous?.[key]!==undefined&&values[key]!==previous[key])throw Error('Conflicting source connection '+id+' ('+key+').');
    edgeMap.set(id,{...previous,...Object.fromEntries(Object.entries(values).filter(([,value])=>value!==undefined))});
  }
  const edges=[...edgeMap.values()];
  for(const edge of edges)edge.animated=!!edge.animated;
  const structure=['class','tree','timeline','waterfall'].find(type=>attr(source.svg,'data-'+type+'-ui')!==undefined)
    ||(attr(source.svg,'data-erd-ui')!==undefined||edges.some(edge=>edge.ends)?'erd':null);
  const nodes=source.elements.filter(node=>attr(node,'data-node-id')).map(node=>{
    const id=attr(node,'data-node-id');
    return {id,label:attr(node,'data-node-label'),kind:attr(node,'data-node-kind'),sublabel:attr(node,'data-node-sublabel'),
      tag:attr(node,'data-node-tag'),context:attr(node,'data-node-context'),
      details:walk(node).filter(child=>child.tagName==='text').map(child=>text(child)).filter(Boolean),
      incoming:edges.filter(edge=>edge.to===id).map(edge=>edge.id),outgoing:edges.filter(edge=>edge.from===id).map(edge=>edge.id),
      ...(attr(node,'data-timeline-at')!==undefined?{at:attr(node,'data-timeline-at'),timeMs:Number(attr(node,'data-timeline-ms'))}:{}),
      ...(attr(node,'data-waterfall-start')!==undefined?{timing:{start:Number(attr(node,'data-waterfall-start')),end:attr(node,'data-waterfall-end')===''?null:Number(attr(node,'data-waterfall-end')),duration:Number(attr(node,'data-waterfall-duration')),depth:Number(attr(node,'data-waterfall-depth')),status:attr(node,'data-waterfall-status')}}:{}),
      sources:evidence?.verified===true?evidence.nodes?.[id]||[]:[]};
  });
  const ids=new Set();for(const node of nodes){if(ids.has(node.id))throw Error('Duplicate source node '+node.id);ids.add(node.id);}
  if(!nodes.length)throw Error('The source diagram has no nodes to explain.');
  for(const edge of edges)if(!ids.has(edge.from)||!ids.has(edge.to))throw Error('Connection '+edge.id+' has an unknown source endpoint.');
  const lanes=source.elements.filter(node=>attr(node,'data-composition-frame-kind')==='lane').map(node=>{
    const children=node.parentNode.childNodes,index=children.indexOf(node),label=children.slice(index+1).find(child=>child.tagName==='text');
    return {id:attr(node,'data-composition-frame-id'),label:text(label).replace(/^(?:\d+|EX)\s*\/\s*/,''),
      ...Object.fromEntries(['x','y','width','height'].map(key=>[key,Number(attr(node,key))]))};
  });
  const phases=source.elements.filter(node=>node.tagName==='text'&&attr(node,'letter-spacing')==='.04em').map(node=>({label:text(node),x:Number(attr(node,'x'))}));
  const frames=source.elements.filter(node=>(node.tagName==='rect'||attr(node,'data-domain-band')!==undefined)&&attr(node,'data-composition-frame-id')).map(node=>{
    const siblings=node.parentNode.childNodes,following=siblings.slice(siblings.indexOf(node)+1).find(child=>child.tagName);
    const segmentLabel=attr(node,'data-composition-frame-kind')==='segment'?source.elements.find(child=>child.tagName==='text'&&Number(attr(child,'x'))>=Number(attr(node,'x'))&&Number(attr(child,'x'))<=Number(attr(node,'x'))+24&&Math.abs(Number(attr(child,'y'))-Number(attr(node,'y')))<=14):null;
    return {id:attr(node,'data-composition-frame-id'),kind:attr(node,'data-composition-frame-kind'),
      label:attr(node,'data-composition-frame-label')||(following?.tagName==='text'?text(following).replace(/^(?:\d+|EX)\s*\/\s*/,''):text(segmentLabel)),
      ...Object.fromEntries(['x','y','width','height'].map(key=>[key,Number(attr(node,key))]))};
  });
  const legend=source.elements.filter(node=>attr(node,'data-legend-kind')).map(node=>({kind:attr(node,'data-legend-kind'),label:attr(node,'data-legend-label')}));
  return {title:text(source.tree.find(node=>node.tagName==='title')),viewBox:attr(source.svg,'viewBox'),sequence:attr(source.svg,'data-sequence-column-fit')!==undefined,choreography:attr(source.svg,'data-motion-choreography')||'relay',defaultAction:structure?'relation':'trace',...(attr(source.svg,'data-waterfall-unit')?{unit:attr(source.svg,'data-waterfall-unit')} :{}),nodes,edges,lanes,frames,phases,legend,
    repository:evidence?.verified===true?evidence.repository:null};
}

function excerpt(spec,anchor,facts,repoRoot){
  const source=facts.nodes.find(node=>node.id===(spec.node||anchor))?.sources[spec.source||0];
  const revision=facts.repository?.revision,root=repoRoot;
  if(!source||!root||!/^[a-f0-9]{40}$/i.test(revision||''))throw Error('Code requires a verified node source and an explicit --repo-root.');
  if(!source.path||path.isAbsolute(source.path)||source.path.split(/[\\/]/).includes('..')||/[\0\r\n:]/.test(source.path))throw Error('Invalid repository source path.');
  const content=execFileSync('git',['show','--no-textconv',`${revision}:${source.path}`],{cwd:root,encoding:'utf8',maxBuffer:2*1024*1024,windowsHide:true});
  if(content.includes('\0'))throw Error('Code excerpts require text files.');
  const lines=content.split(/\r?\n/),first=source.line||1,last=source.endLine||lines.length;
  const from=spec.fromLine??first,to=spec.toLine??Math.min(last,from+13);
  if(!Number.isInteger(from)||!Number.isInteger(to)||from<first||to>last||to<from||to-from>=20)throw Error('Code excerpt must fit its source range and contain at most 20 lines.');
  return {path:source.path,revision,line:from,endLine:to,lines:lines.slice(from-1,to).map((value,index)=>({number:from+index,text:value,emphasis:(spec.emphasis||[]).includes(from+index)}))};
}

export function buildStory(file,planFile,out,{standalone=false,repoRoot}={}){
  const attach=!standalone;
  const outputGuard={requestedOutput:out,inputPaths:[file,planFile],inputDescription:'the source HTML or brief'};
  out=resolveOutputPath(outputGuard).outputPath;
  const source=read(file),facts=factsOf(source),input=JSON.parse(fs.readFileSync(planFile,'utf8'));
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('The story brief must be a JSON object.');
  if(input.accent!==undefined&&(typeof input.accent!=='string'||!/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(input.accent)))throw Error('Accent must be a literal hex color (#rgb, #rgba, #rrggbb or #rrggbbaa).');
  if(attach&&!['btn-motion','motion-label','export-menu'].every(id=>source.tree.some(node=>attr(node,'id')===id)))throw Error('Story attachment needs the native Viewer controls; generate the source with archify render first.');
  const plan=input.version===2?compileBrief(input,facts):input;
  plan.defaultMode='explain';
  const nodes=new Set(facts.nodes.map(node=>node.id)),edges=new Set(facts.edges.map(edge=>edge.id));
  if(plan.version!==1||!plan.shots?.length)throw Error('Invalid story plan.');
  if(plan.scopeStyle&&plan.scopeStyle!=='field')throw Error('Unknown scope presentation.');
  if(plan.opening&&!openingModes.includes(plan.opening))throw Error('Opening must be auto, fit, scan-x or scan-y.');
  for(const base of plan.shots){
    if(base.explain){const {explain,...common}=base;base.explain={...common,...explain};}
    for(const variant of [base,base.explain].filter(Boolean)){
      if(!(variant.duration>0&&Number.isFinite(variant.duration)))throw Error('Every shot needs a finite duration.');
      if(!['establish','follow','inspect','resolve'].includes(variant.preset))throw Error('Unknown shot preset.');
      for(const id of variant.nodes||[])if(!nodes.has(id))throw Error('Unknown source node '+id);
      for(const id of variant.edges||[])if(!edges.has(id))throw Error('Unknown source edge '+id);
      for(const [id,time] of Object.entries(variant.edgeTimes||{}))if(!variant.edges?.includes(id)||!Number.isFinite(time)||time<0||time>=variant.duration)throw Error('Invalid edge action time '+id);
      for(const [id,value] of Object.entries(variant.edgeDurations||{}))if(!variant.edges?.includes(id)||!Number.isFinite(value)||value<.5||value>3)throw Error('Invalid edge travel time '+id);
      for(const [id,value] of Object.entries(variant.edgeModes||{}))if(!variant.edges?.includes(id)||!['trace','relation'].includes(value))throw Error('Invalid edge presentation '+id);
      variant.edgeModes={...variant.edgeModes};
      for(const id of variant.edges||[]){
        variant.edgeModes[id]??=facts.defaultAction;
        if(variant.edgeModes[id]!=='relation'&&!facts.edges.find(edge=>edge.id===id).animated)throw Error('Connection '+id+' has no native transfer animation; use action: relation.');
      }
      for(const view of variant.views||[]){
        if(!Number.isFinite(view.at)||view.at<0||view.at>=variant.duration||!variant.annotations?.[view.note])throw Error('Invalid camera view.');
        for(const id of view.nodes||[])if(!nodes.has(id))throw Error('Unknown camera node '+id);
        for(const id of view.edges||[])if(!edges.has(id))throw Error('Unknown camera connection '+id);
      }
      for(const note of variant.annotations||[]){
        if(!nodes.has(note.anchor))throw Error('Unknown annotation anchor '+note.anchor);
        if(!Number.isFinite(note.at??1.45)||!Number.isFinite(note.until??variant.duration)|| (note.at??1.45)<0 || (note.until??variant.duration)>(variant.duration) || (note.at??1.45)>=(note.until??variant.duration))throw Error('Invalid annotation time range.');
        for(const id of note.relations||[])if(!edges.has(id))throw Error('Unknown annotation relationship '+id);
        if(note.code)note.excerpt=excerpt(note.code,note.anchor,facts,repoRoot);
      }
    }
    if(base.preset==='establish')base.duration=Math.min(6,base.duration);
    if(base.explain&&(base.explain.preset||base.preset)==='establish')base.explain.duration=Math.min(6,base.explain.duration??base.duration);
  }
  const styles=source.tree.filter(node=>node.tagName==='style').map(node=>(node.childNodes||[]).map(child=>child.value||'').join('')).join('\n');
  const nativeMotion=fs.readFileSync(path.join(here,'native-motion.js'),'utf8');
  const data=JSON.stringify({plan,source:{file:path.basename(file),sha256:createHash('sha256').update(source.html).digest('hex')},facts}).replace(/</g,'\\u003c');
  const briefPath=path.relative(path.dirname(out),planFile);
  const scriptRef=path.isAbsolute(briefPath)?pathToFileURL(planFile).href:'./'+briefPath.split(path.sep).map(encodeURIComponent).join('/');
  const brandRef='data:image/svg+xml;base64,'+fs.readFileSync(path.join(here,'brand.svg')).toString('base64');
  if(plan.motion){
    if(!nativeMotions.includes(plan.motion))throw Error('Unknown native motion choreography.');
    const motion=source.svg.attrs.find(attribute=>attribute.name==='data-motion-choreography');
    if(motion)motion.value=plan.motion;else source.svg.attrs.push({name:'data-motion-choreography',value:plan.motion});
  }
  const storyHtml=`<!doctype html><html lang="${esc(attr(source.tree.find(node=>node.tagName==='html'),'lang')||'en')}" data-theme="light" style="--accent:${esc(plan.accent||'#477bbe')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(plan.title)} · Archify Story Studio</title><style>${styles}</style><style id="story-style">${fs.readFileSync(path.join(here,'story.css'),'utf8')}</style></head><body>
<div class="lab"><header class="lab-head" lang="en"><b>Archify · Story Studio / Detailed walkthrough</b><nav><a data-mode="explain" aria-current="page">Detailed walkthrough</a><a href="${esc(scriptRef)}">Story brief ↗</a></nav></header>
<main class="stage"><div class="ambient"></div><div class="mast"><div class="brand"><img src="${brandRef}" alt="">Archify<span>STORY STUDIO</span></div><div class="chapter"></div></div><div class="heading"><div class="eyebrow">${esc(plan.eyebrow)}</div><div class="headlines"><div class="headline-old" aria-hidden="true"></div><h1>${esc(plan.title)}</h1></div></div><div class="phase-rail"></div><div class="plot-safe-area" aria-hidden="true"></div><div class="viewport"><div class="art diagram-container">${serializeOuter(source.svg)}</div></div><div class="callouts"></div><div class="subtitle-wrap"><div class="subtitle"></div></div><div class="transition-light"></div></main>
<div class="controls" lang="en"><button data-play>Play</button><button data-replay>Replay</button><input class="timeline" aria-label="Story playback position" type="range" min="0" max="30" step="0.01" value="0"><span class="clock"></span><button data-sound aria-pressed="true">Sound on</button></div><p class="notes" lang="en">Native node entrances, connections and sound share the story timeline. Space to play or pause.</p></div><div hidden><button id="btn-motion"><span id="motion-label"></span></button></div>
<script type="application/json" id="story-data">${data}</script><script>if(new URLSearchParams(location.search).has('export'))document.body.classList.add('export');window.Archify={};function viewerText(key){return key;}</script><script>${nativeMotion}</script><script>${fs.readFileSync(path.join(here,'story-audio.js'),'utf8')}</script><script>${fs.readFileSync(path.join(here,'scope-field.js'),'utf8')}</script><script>${fs.readFileSync(path.join(here,'story.js'),'utf8')}</script><script>${fs.readFileSync(path.join(here,'story-webm.js'),'utf8')}</script><script>${fs.readFileSync(path.join(here,'story-export.js'),'utf8')}</script></body></html>`;
  const html=attach?attachStory(source.html,storyHtml):storyHtml;
  writeStoryOutput(out,html,()=>resolveOutputPath(outputGuard));
  return {output:out,bytes:Buffer.byteLength(html),duration:plan.shots.reduce((sum,shot)=>sum+(plan.defaultMode==='explain'?shot.explain?.duration??shot.duration:shot.duration),0),source:facts.title,nodes:facts.nodes.length,edges:facts.edges.length,
    briefCharacters:[...JSON.stringify(input)].length,planCharacters:[...JSON.stringify(plan)].length};
}

export function scanStory(file){return factsOf(read(file));}

export function draftStory(file,target){
  const facts=scanStory(file),sourceMap=target.replace(/\.json$/i,'')+'.source.json';
  const guard={requestedOutput:target,requiredExtension:'.json',inputPaths:[file],otherOutputPaths:[sourceMap]};
  resolveOutputPath(guard);resolveOutputPath({requestedOutput:sourceMap,requiredExtension:'.json',inputPaths:[file],otherOutputPaths:[target]});
  if(fs.existsSync(target)||fs.existsSync(sourceMap))throw Error('Draft output already exists; choose a new brief path.');
  const brief=JSON.stringify(draftBrief(facts),null,2)+'\n',map=JSON.stringify(facts,null,2)+'\n';
  const committed=[];
  try{
    writeStoryOutput(sourceMap,map,()=>resolveOutputPath({requestedOutput:sourceMap,requiredExtension:'.json',inputPaths:[file],otherOutputPaths:[target]}),{createOnly:true,committed});
    writeStoryOutput(target,brief,()=>resolveOutputPath(guard),{createOnly:true,committed});
  }
  catch(error){
    const details=[];
    for(const output of committed.reverse())try{
      const cleanup=rollbackStoryOutput(output);
      if(!['removed','absent','preserved'].includes(cleanup.status)||cleanup.release)details.push(path.basename(output.file)+': '+cleanup.status+(cleanup.release?'; handle release: '+(cleanup.release.reason?.code||cleanup.release.status):''));
    }catch(cleanupError){details.push(path.basename(output.file)+': '+cleanupError.message);}
    if(details.length){
      const message=' Draft rollback: '+details.join('; ')+'; choose a new draft path.';
      error.message+=message;
      for(const diagnostic of error.archifyDiagnostics||[])diagnostic.message+=message;
    }
    throw error;
  }
  return {brief:target,sourceMap,nodes:facts.nodes.length,edges:facts.edges.length};
}
