import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareStory} from './tool.mjs';
import {resolveOutputPath} from '../renderers/shared/output-path.mjs';
import {captureAtomicOutput,verifyAtomicOutput} from '../renderers/shared/atomic-output.mjs';
import {writeStoryOutput,rollbackStoryOutput} from './output.mjs';
import {parse} from './vendor/html-parser.mjs';

const attr=(node,name)=>node.attrs?.find(value=>value.name===name)?.value;
const walk=node=>[node,...(node.childNodes||[]).flatMap(walk)];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function escape(value){
  value=String(value??'');
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/u.test(value))throw Error('Story text contains a character that XML cannot represent.');
  return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
}
function resource(value,depth=0){
  if(/^#[^\s]+$/.test(value)||/^data:(?:image\/(?:png|jpeg|gif|webp)|font\/(?:woff2?|ttf));base64,[a-z\d+/=\s]+$/i.test(value))return true;
  const svg=/^data:image\/svg\+xml(;base64)?,([\s\S]*)$/i.exec(value);
  if(!svg||depth>=3)return false;
  try{
    const content=svg[1]?Buffer.from(svg[2],'base64').toString('utf8'):decodeURIComponent(svg[2]);
    if(content.length>1024*1024||/<!DOCTYPE|<!ENTITY/i.test(content))return false;
    const tree=walk(parse(content)),roots=tree.filter(node=>node.tagName==='svg');
    if(roots.length!==1)return false;
    validateSource({tree,svg:roots[0]},depth+1);return true;
  }catch{return false;}
}
function checkCss(value,depth=0){
  if(/@import\b|\\|expression\s*\(/i.test(value))throw Error('Story SVG styles must remain self-contained without imported resources or escaped URLs.');
  for(const match of value.matchAll(/url\(\s*([\s\S]*?)\s*\)/gi)){
    const url=match[1].replace(/^(['"])([\s\S]*)\1$/,'$2').trim();
    if(!resource(url,depth))throw Error('Story SVG contains a non-self-contained resource: '+url.slice(0,120));
  }
}
function validateSource(source,depth=0){
  const styles=source.tree.filter(node=>node.tagName==='style').map(node=>(node.childNodes||[]).map(child=>child.value||'').join('')).join('\n');
  checkCss(styles,depth);
  for(const node of walk(source.svg)){
    if(['script','foreignObject','iframe','object','embed','animate','set','animateTransform','animateMotion','discard'].includes(node.tagName))throw Error('Story SVG cannot contain active or external resource content: '+node.tagName);
    for(const value of node.attrs||[]){
      if(/^on/i.test(value.name))throw Error('Story SVG cannot contain event handlers.');
      if(['href','src','data','poster'].includes(value.name)&&!resource(value.value,depth))throw Error('Story SVG contains a non-self-contained resource: '+value.value.slice(0,120));
      if(['style','fill','stroke','filter','clip-path','mask','marker-start','marker-mid','marker-end','cursor'].includes(value.name))checkCss(value.value,depth);
    }
  }
  return styles;
}
function prefixed(value,ids,prefix){
  return value.replace(/#([\w:.-]+)/g,(match,id)=>ids.has(id)?'#'+prefix+id:match);
}
function diagram(source,styles,prefix){
  const names=walk(source.svg).map(node=>attr(node,'id')).filter(Boolean),ids=new Set(names);
  if(ids.size!==names.length)throw Error('Story SVG source contains duplicate SVG identifiers.');
  const targets=new Map();let next=0;
  function serialize(node){
    if(node.nodeName==='#text')return escape(node.value);
    if(!node.tagName)return '';
    const attributes=(node.attrs||[]).filter(value=>value.name!=='xmlns').map(value=>{
      const name=value.prefix?value.prefix+':'+value.name:value.name;
      return name+'="'+escape(value.name==='id'?prefix+value.value:prefixed(value.value,ids,prefix))+'"';
    });
    const identity=attr(node,'data-node-id')||attr(node,'data-edge-id');
    const content='<'+node.tagName+(attributes.length?' '+attributes.join(' '):'')+'>'+(node.childNodes||[]).map(serialize).join('')+'</'+node.tagName+'>';
    if(!identity)return content;
    const variable='--archify-story-focus-'+next++;
    targets.set(identity,[...(targets.get(identity)||[]),variable]);
    return '<g style="filter:var('+variable+',none)">'+content+'</g>';
  }
  const attributes=(source.svg.attrs||[]).filter(value=>!['xmlns','width','height','viewBox','id','data-theme'].includes(value.name)).map(value=>value.name+'="'+escape(prefixed(value.value,ids,prefix))+'"').join(' ');
  return {css:prefixed(styles,ids,prefix),targets,markup:'<g id="story-native"><g '+attributes+(attr(source.svg,'id')?' id="'+escape(prefix+attr(source.svg,'id'))+'"':'')+'>'+(source.svg.childNodes||[]).map(serialize).join('')+'</g></g>'};
}
function lines(value,limit=108){
  const result=[];let line='',width=0;
  for(const char of String(value??'')){
    const size=/[\u2e80-\uffff]/u.test(char)?2:/[WM@#%]/.test(char)?1.7:1;
    if(char==='\n'||width+size>limit){result.push(line);line='';width=0;if(char==='\n')continue;}
    line+=char;width+=size;
  }
  if(line)result.push(line);
  return result;
}
function framesOf(plan){
  const frames=[];let time=0;
  for(const base of plan.shots){
    const shot={...base,...base.explain},duration=shot.duration;
    const events=[0,duration,...(shot.annotations||[]).flatMap(note=>[note.at??1.45,note.until??duration]),...(shot.captions||[]).map(caption=>caption.at),...(shot.views||[]).map(view=>view.at)];
    const boundaries=[...new Set(events.filter(value=>value>=0&&value<=duration))].sort((a,b)=>a-b);
    for(let index=0;index<boundaries.length-1;index++){
      const at=boundaries[index],view=(shot.views||[]).filter(view=>view.at<=at).at(-1);
      const annotations=(shot.annotations||[]).filter(note=>(note.at??1.45)<=at&&(note.until??duration)>at);
      const notes=annotations.flatMap(note=>[
        ...lines(note.title),...lines(note.body),...lines(note.kindExplanation),...lines(note.figureCaption),
        ...(note.fields||[]).flatMap(field=>lines(field.label+': '+field.detail)),
        ...(note.excerpt?[note.excerpt.path+' · '+note.excerpt.revision,...note.excerpt.lines.flatMap(line=>lines(line.number+'  '+line.text))]:[])
      ]);
      const caption=(shot.captions||[]).filter(caption=>caption.at<=at).at(-1)?.text??shot.caption;
      frames.push({start:time+at,end:time+boundaries[index+1],headline:shot.headline,caption:lines(caption),notes,selected:new Set([...(view?.nodes||shot.nodes||[]),...(view?.edges||shot.edges||[])])});
    }
    time+=duration;
  }
  return {frames,duration:time};
}
function render(source,facts,plan,styles,{frames,duration},still){
  const title=lines(plan.title,70),headlineRows=Math.max(...frames.map(frame=>lines(frame.headline,92).length));
  const graphTop=50+title.length*32+headlineRows*25,separator=graphTop+410,copyTop=separator+35;
  const width=1200,height=Math.max(720,...frames.map(frame=>copyTop+(frame.caption.length+frame.notes.length)*25+28));
  const box=(facts.viewBox||'').trim().split(/[\s,]+/).map(Number);
  if(box.length!==4||!box.every(Number.isFinite)||box[2]<=0||box[3]<=0)throw Error('Story SVG requires a finite native viewBox.');
  const scale=Math.min(1144/box[2],390/box[3]),x=28+(1144-box[2]*scale)/2-box[0]*scale,y=graphTop+(390-box[3]*scale)/2-box[1]*scale;
  const percent=value=>Math.min(100,Math.max(0,value/duration*100)).toFixed(6)+'%';
  const active=still?frames.slice(0,1):frames,native=diagram(source,styles,'native-');
  const animations=still?'':frames.map((frame,index)=>'@keyframes story'+index+'{0%{visibility:'+(index===0?'visible':'hidden')+'}'+(frame.start?' '+percent(frame.start)+'{visibility:visible}':'')+' '+percent(frame.end)+'{visibility:hidden}100%{visibility:hidden}} .story-frame-'+index+'{animation:story'+index+' '+duration+'s steps(1,end) infinite}').join('\n');
  const base='.story-frame{visibility:hidden}.story-first{visibility:visible}.story-diagram *{animation:none!important;transition:none!important}.story-diagram [data-animate]{opacity:1!important}.story-focus{filter:drop-shadow(0 0 4px #477bbe)}.story-copy{font-family:system-ui,sans-serif;fill:#202633}.story-heading{font-size:26px;font-weight:650}.story-line{font-size:19px}@media(prefers-reduced-motion:reduce){.story-frame{animation:none!important;visibility:hidden}.story-first{visibility:visible}}';
  const content=active.map((frame,index)=>{
    const rows=[...frame.caption,...frame.notes.filter(line=>!frame.caption.includes(line))],focus=[...new Set([...frame.selected].flatMap(id=>native.targets.get(id)||[]))];
    return '<g class="story-frame story-frame-'+index+(index===0?' story-first':'')+'" data-start="'+frame.start+'" data-end="'+frame.end+'"><rect width="'+width+'" height="'+height+'" fill="#f8fafc"/>'
      +title.map((line,row)=>'<text class="story-copy story-heading" x="28" y="'+(36+row*32)+'">'+escape(line)+'</text>').join('')
      +lines(frame.headline,92).map((line,row)=>'<text class="story-copy story-line" x="28" y="'+(56+title.length*32+row*25)+'">'+escape(line)+'</text>').join('')
      +'<g class="story-diagram" style="'+focus.map(variable=>variable+':drop-shadow(0 0 4px #477bbe)').join(';')+'" transform="translate('+x+' '+y+') scale('+scale+')"><use href="#story-native"/></g><line x1="28" y1="'+separator+'" x2="1172" y2="'+separator+'" stroke="#d5deeb"/>'
      +rows.map((line,row)=>'<text class="story-copy story-line" x="28" y="'+(copyTop+row*25)+'" xml:space="preserve">'+escape(line)+'</text>').join('')+'</g>';
  }).join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" data-theme="light" width="'+width+'" height="'+height+'" viewBox="0 0 '+width+' '+height+'" role="img" aria-labelledby="story-title story-description"><title id="story-title">'+escape(plan.title)+'</title><desc id="story-description">'+escape(still?'First frame. '+frames[0].caption.join(' '):'Timed scenes from the compiled Archify story; '+duration+' seconds. No audio, interactive camera or native edge-transfer choreography.')+'</desc><style>'+escape(native.css+'\n'+base+'\n'+animations)+'</style><defs>'+native.markup+'</defs>'+content+'</svg>';
}

function publish(outputs,guard){
  const saved=new Map(),expected=new Map(),committed=[],backups=[];
  let recovery;
  const clean=()=>{
    for(const record of backups){const result=rollbackStoryOutput(record);if(!['removed','absent'].includes(result.status))throw Error('Recovery copy changed: '+record.file);}
    if(recovery)fs.rmdirSync(recovery);
  };
  try{
    for(const [file]of outputs){
      fs.mkdirSync(path.dirname(file),{recursive:true});
      const captured=captureAtomicOutput(file);if(captured.status!=='captured')throw Error('Story SVG output cannot be published: '+file);
      const previous=captured.snapshot.target.kind==='file'?{bytes:fs.readFileSync(captured.commitPath),mode:captured.mode}:null;
      if(previous){
        recovery??=fs.mkdtempSync(path.join(path.dirname(file),'.archify-story-recovery-'));
        previous.backup=path.join(recovery,'prior-'+saved.size+'.svg');
        writeStoryOutput(previous.backup,previous.bytes,()=>{},{createOnly:true,committed:backups,fallbackMode:previous.mode});
      }
      saved.set(captured.commitPath,previous);expected.set(file,{snapshot:captured.snapshot,digest:previous&&hash(previous.bytes)});
    }
    const check=()=>{
      guard();
      for(const [file,state]of expected){
        if(verifyAtomicOutput(state.snapshot).status!=='match'||state.digest&&hash(fs.readFileSync(file))!==state.digest)throw Error('Story SVG output changed during publication: '+file);
      }
    };
    for(const [file,content]of outputs){
      writeStoryOutput(file,content,check,{committed});
      expected.set(file,{snapshot:captureAtomicOutput(file).snapshot,digest:hash(content)});
    }
  }catch(error){
    const failures=[];
    for(const record of committed.reverse()){
      try{
        const prior=saved.get(record.file),removed=rollbackStoryOutput(record);
        if(removed.status!=='removed')throw Error('A changed output was preserved at '+record.file);
        if(prior)writeStoryOutput(record.file,prior.bytes,guard,{createOnly:true,fallbackMode:prior.mode});
      }catch(cause){failures.push(cause.message);}
    }
    if(!failures.length)try{clean();}catch(cause){failures.push(cause.message);}
    const message=error.message+(failures.length?' Recovery incomplete: '+failures.join('; ')+(recovery?'; recovery directory: '+recovery:''):'');
    error.message=message;
    error.archifyDiagnostics=[{code:'story/svg-publication',severity:'error',message,subject:{outputs:outputs.map(([file])=>file)},evidence:{cause:error.archifyDiagnostics||error.code||error.message,restoration:failures.length?'incomplete':'complete',...(failures.length&&recovery?{recoveryDirectory:recovery,recoveryFiles:[...saved.values()].filter(Boolean).map(prior=>prior.backup)}:{})},supportedFixes:failures.length?['Preserve the reported recovery copies and restore them to their original output paths before retrying.']:['Check output permissions and retry; previous outputs were restored.']}];
    throw error;
  }
  try{clean();}catch(error){
    error.message='Both SVG outputs were published, but recovery cleanup failed: '+error.message+'; recovery directory: '+recovery;
    error.archifyDiagnostics=[{code:'story/svg-recovery-cleanup',severity:'error',message:error.message,subject:{outputs:outputs.map(([file])=>file)},evidence:{publication:'committed',recoveryDirectory:recovery},supportedFixes:['Inspect the published outputs before removing the reported recovery directory.']}];throw error;
  }
}

export function exportStorySvg(file,brief,requestedOutput){
  const still=requestedOutput.replace(/\.svg$/i,'.still.svg');
  const guards=[requestedOutput,still].map((output,index)=>({requestedOutput:output,requiredExtension:'.svg',inputPaths:[file,brief],otherOutputPaths:[index?requestedOutput:still],inputDescription:'the source HTML or brief'}));
  const guard=()=>guards.map(value=>resolveOutputPath(value));
  const [{outputPath:output},{outputPath:stillPath}]=guard();
  const {source,facts,input,plan}=prepareStory(file,brief),styles=validateSource(source),timeline=framesOf(plan);
  const animated=render(source,facts,plan,styles,timeline,false),first=render(source,facts,plan,styles,timeline,true);
  publish([[stillPath,first],[output,animated]],guard);
  return {output,still:stillPath,scenes:input.scenes?.length??plan.shots.filter(shot=>!['establish','resolve'].includes(shot.preset)).length,duration:timeline.duration,bytes:Buffer.byteLength(animated)};
}
