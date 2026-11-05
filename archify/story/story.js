(() => {
  const {plan,facts}=JSON.parse(document.querySelector('#story-data').textContent);
  const mode='explain';
  const reducedMotion=Archify.motionGovernor.reducedMotion;
  const $=s=>document.querySelector(s),stage=$('.stage'),viewport=$('.viewport'),svg=$('.art svg');
  const headline=$('h1'),oldHeadline=$('.headline-old'),subtitle=$('.subtitle'),rail=$('.phase-rail');
  const playButton=$('[data-play]'),range=$('.timeline'),clock=$('.clock'),soundButton=$('[data-sound]');
  Archify.motionGovernor.setMode('live',{persist:false});
  document.documentElement.dataset.ambientEntry='running';
  const nodes=[...svg.querySelectorAll('[data-node-id]')],nodeById=new Map(facts.nodes.map(n=>[n.id,n]));
  const edgeElements=[...svg.querySelectorAll('[data-edge-id]')].filter(e=>!e.parentElement.closest('[data-edge-id]'));
  const edgeById=new Map(facts.edges.map(e=>[e.id,e]));
  stage.dataset.mode=mode;
  document.querySelector(`[data-mode="${mode}"]`).setAttribute('aria-current','page');
  const NS='http://www.w3.org/2000/svg',clamp=x=>Math.max(0,Math.min(1,x)),mix=(a,b,t)=>a+(b-a)*t;
  const ease=x=>{x=clamp(x);return x*x*x*(x*(x*6-15)+10);};
  const el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
  const vector=(tag,attrs,parent)=>{const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(parent)parent.append(n);return n;};
  const nodeShape=node=>node.querySelector('rect[data-animate="node"]')||node.querySelector('rect:not(.c-mask):not([data-tree-stack])');
  const rootMatrix=svg.getCTM();
  function measure(n){
    const b=n.getBBox(),m=rootMatrix.inverse().multiply(n.getCTM());
    const corners=[[b.x,b.y],[b.x+b.width,b.y],[b.x,b.y+b.height],[b.x+b.width,b.y+b.height]].map(([x,y])=>new DOMPoint(x,y).matrixTransform(m));
    const x=Math.min(...corners.map(p=>p.x)),y=Math.min(...corners.map(p=>p.y));
    return {x,y,width:Math.max(...corners.map(p=>p.x))-x,height:Math.max(...corners.map(p=>p.y))-y};
  }
  const boxes=new Map(nodes.map(n=>[n.dataset.nodeId,measure(n)])),edgeBoxes=new Map();
  const labelSizes=nodes.map(node=>node.querySelector('text[data-node-label]')||node.querySelector('text')).filter(Boolean).map(label=>parseFloat(getComputedStyle(label).fontSize)).filter(size=>size>0).sort((a,b)=>a-b);
  const labelSize=labelSizes[Math.floor(labelSizes.length/2)]||12;
  for(const edge of edgeElements){const id=edge.dataset.edgeId;if(!edgeBoxes.has(id))edgeBoxes.set(id,[]);edgeBoxes.get(id).push(measure(edge));}
  const contains=(outer,inner)=>inner.x>=outer.x-1&&inner.y>=outer.y-1&&inner.x+inner.width<=outer.x+outer.width+1&&inner.y+inner.height<=outer.y+outer.height+1;
  const scopes=(facts.frames||[]).map(frame=>({...frame,members:nodes.filter(node=>(frame.label&&nodeById.get(node.dataset.nodeId).context?.split(' › ').includes(frame.label))||contains(frame,boxes.get(node.dataset.nodeId))).map(node=>node.dataset.nodeId),
    messages:facts.sequence?facts.edges.filter(edge=>(edgeBoxes.get(edge.id)||[]).some(box=>contains(frame,box))).map(edge=>edge.id):[]}));
  const sequenceCast=facts.sequence?vector('g',{class:'story-sequence-cast'},svg):null,castCopies=new Map();
  if(sequenceCast)for(const node of nodes){const copy=node.cloneNode(true);for(const part of [copy,...copy.querySelectorAll('*')]){for(const name of [...part.attributes].map(a=>a.name))if(name==='id'||name==='tabindex'||name==='role'||name.startsWith('data-')||name.startsWith('aria-'))part.removeAttribute(name);part.style.animation='none';}sequenceCast.append(copy);castCopies.set(node.dataset.nodeId,copy);}
  const contextLabels=[...svg.querySelectorAll(':scope > text')].map(node=>{const b=node.getBBox();return {node,box:{x:b.x,y:b.y,width:b.width,height:b.height}};});
  const entryWrappers=new Map(nodes.map(node=>{const wrapper=vector('g',{class:'story-entry'});node.before(wrapper);wrapper.append(node);return [node,wrapper];}));
  const entryTiming=new Map(nodes.map((node,index)=>{const animations=node.getAnimations({subtree:true}),animation=animations.find(animation=>animation.animationName==='archify-node-enter'),timing=animation?.effect.getTiming(),step=parseFloat(node.querySelector('[data-animate="node"]')?.style.getPropertyValue('--step'));
    return [node,{at:.12+(timing?Number(timing.delay)/1000:(Number.isFinite(step)?step:index)*.16),duration:timing?Number(timing.duration)/1000:.9,pulseEnd:Math.max(0,...animations.filter(animation=>/node-pulse/.test(animation.animationName||'')).map(animation=>{const timing=animation.effect.getTiming();return .12+(Number(timing.delay)+Number(timing.duration))/1000;}))}];}));
  const frames=[...svg.querySelectorAll('[data-composition-frame-id]')];
  const frameBirth=new Map(frames.map((frame,index)=>{const scope=scopes.find(scope=>scope.id===frame.dataset.compositionFrameId&&scope.kind===frame.dataset.compositionFrameKind),members=nodes.filter(node=>scope?.members.includes(node.dataset.nodeId));return [frame,members.length?Math.min(...members.map(node=>entryTiming.get(node).at)):.12+index*.16];}));
  const nodeEnd=Math.max(...[...entryTiming.values()].map(entry=>entry.at+entry.duration),...[...frameBirth.values()].map(at=>at+.55),...contextLabels.map((_,index)=>.12+index*.16+.5));
  const depth=vector('filter',{id:'story-depth',x:'-30%',y:'-40%',width:'160%',height:'200%'},svg.querySelector('defs'));
  vector('feDropShadow',{dx:0,dy:4,stdDeviation:3,'flood-color':'#466c9f','flood-opacity':'.2'},depth);
  const edgePaths=new Map();
  for(const edge of edgeElements){
    if(edgePaths.has(edge.dataset.edgeId)){edgePaths.get(edge.dataset.edgeId).labels.push(edge);continue;}
    const paths=[...(edge.matches('path')?[edge]:edge.querySelectorAll('path'))].filter(p=>!p.hasAttribute('data-ambient-flow-overlay')&&p.getAttribute('d')&&p.getTotalLength?.()>15);
    const path=paths.find(p=>p.hasAttribute('data-animate'))||paths[0];if(!path)continue;
    const length=path.getTotalLength();
    const flows=[];
    for(const shape of paths.filter(p=>p.getAttribute('data-animate')==='edge')){
      let next=shape.nextElementSibling;
      while(next?.hasAttribute('data-ambient-flow-overlay')){next.dataset.storyEdge=edge.dataset.edgeId;flows.push(next);next=next.nextElementSibling;}
    }
    const depart=flows.length?Math.min(...flows.map(flow=>parseFloat(flow.style.getPropertyValue('--flow-delay'))||0)):0;
    const ripple=flows.find(flow=>flow.classList.contains('ambient-flow-ripple'));
    const arrival=parseFloat(ripple?.style.getPropertyValue('--flow-delay'));
    const underlays=paths.flatMap(shape=>shape.parentElement.matches('[data-graph-role="automatic-crossover"]')?[...shape.parentElement.querySelectorAll('[data-graph-role="automatic-crossover-underlay"]')]:[]);
    const labelGroups=[...edge.querySelectorAll('[data-detail="context"]')];
    edgePaths.set(edge.dataset.edgeId,{id:edge.dataset.edgeId,flows,nativeOpening:flows.length>0,underlays,box:measure(path),depart:Number.isFinite(depart)?depart:0,travel:Number.isFinite(arrival)?arrival-depart:Math.min(1.5,Math.max(.42,length/280)),authored:paths,labels:labelGroups.length?labelGroups:[...edge.querySelectorAll('text')]});
  }
  // Guides without a native transfer are not opening events, so they cannot stretch or invalidate that clock.
  const wireSpan=Math.max(0,...[...edgePaths.values()].filter(record=>record.nativeOpening).map(record=>Math.max(record.depart,...record.flows.filter(flow=>!flow.classList.contains('ambient-flow-ripple')).map(flow=>parseFloat(flow.style.getPropertyValue('--flow-delay'))||0))+record.travel+.9));
  // Native ambient playback may omit branches that a local explanation selects.
  const requested=new Set(plan.shots.flatMap(base=>{const shot={...base,...base.explain};return (shot.edges||[]).filter(id=>shot.edgeModes?.[id]!=='relation');}));
  const template=[...edgePaths.values()].find(record=>record.flows.length);
  for(const id of requested){
    const record=edgePaths.get(id);if(!record||record.flows.length)continue;
    if(!template)throw Error('No native transfer layers are available for connection '+id);
    const end=template.flows.findIndex(flow=>flow.classList.contains('ambient-flow-ripple'));
    const layers=template.flows.slice(0,end<0?undefined:end+1);
    for(const shape of record.authored.filter(path=>path.getAttribute('data-animate')==='edge')){
      const d=shape.getAttribute('data-motion-path')||shape.getAttribute('d'),dash=getComputedStyle(shape).strokeDasharray;
      let anchor=shape,geometry;
      for(const layer of layers){
        if(layer.classList.contains('ambient-flow-wake')&&(dash!=='none')!==(getComputedStyle(template.authored[0]).strokeDasharray!=='none'))continue;
        const flow=layer.cloneNode(false);flow.dataset.storyEdge=id;
        for(const name of ['transform','mask','clip-path','vector-effect']){flow.removeAttribute(name);if(shape.hasAttribute(name))flow.setAttribute(name,shape.getAttribute(name));}
        shape.parentElement.insertBefore(flow,anchor.nextSibling);anchor=flow;
        if(flow.localName==='path'){
          flow.setAttribute('d',d);geometry=flow;const length=flow.getTotalLength(),head=Math.min(14,Math.max(7,length*.03)),halo=Math.min(22,Math.max(12,length*.07));
          flow.style.setProperty('--flow-len',length.toFixed(1)+'px');
          if(flow.classList.contains('ambient-flow-wake'))flow.style.setProperty('--flow-dasharray',dash!=='none'?dash:length+' '+length);
          else if(flow.classList.contains('ambient-flow-tail')){
            const tail=length>=120?30:length>=60?13:5;
            flow.style.setProperty('--flow-dasharray',length>=120?'2.5 2 4 3 5.5 4.5 8 '+(length-30):length>=60?'3 3 7 '+(length-13):'5 '+Math.max(4,length-5));
            flow.style.setProperty('--flow-dash',tail+'px');flow.style.setProperty('--flow-shift',(tail-head)+'px');
          }else{const size=flow.classList.contains('ambient-flow-head')?head:halo;flow.style.setProperty('--flow-dash',size+'px');flow.style.setProperty('--flow-shift',((size-head)/2)+'px');}
        }else if(geometry){const tip=geometry.getPointAtLength(geometry.getTotalLength());flow.setAttribute('cx',tip.x);flow.setAttribute('cy',tip.y);flow.removeAttribute('mask');flow.removeAttribute('clip-path');}
        record.flows.push(flow);
      }
    }
    record.localTransfer={depart:template.depart,travel:template.travel};
  }
  let sequenceContent,sequenceClip;
  if(facts.sequence){
    const children=[...svg.children].filter(node=>node!==sequenceCast&&!['defs','style'].includes(node.localName));
    sequenceContent=vector('g',{class:'story-sequence-content'});svg.insertBefore(sequenceContent,sequenceCast);
    for(const child of children)sequenceContent.append(child);
    sequenceClip=vector('rect',{},vector('clipPath',{id:'story-sequence-window',clipPathUnits:'userSpaceOnUse'},svg.querySelector('defs')));
  }
  for(const n of svg.querySelectorAll('text[letter-spacing=".04em"]'))n.classList.add('source-phase');
  // Keep vector text at the output resolution instead of enlarging a cached layer.
  svg.style.width='100%';svg.style.height='100%';svg.setAttribute('preserveAspectRatio','none');
  const phases=plan.phases||facts.phases;
  const phaseEls=phases.map((phase,i)=>{const n=el('div','phase');n.append(el('i','',String(i+1).padStart(2,'0')),el('span','',phase.label));rail.append(n);return n;});rail.style.gridTemplateColumns=`repeat(${phases.length},1fr)`;
  let cursor=0;const shots=plan.shots.map(base=>{const s={...base,...base.explain};if(s.preset==='establish')s.duration=Math.min(6,s.duration);return {...s,start:(cursor+=s.duration)-s.duration,end:cursor};}),total=cursor;
  const cameraDuration=plan.timing?.camera??1.4,cycle=parseFloat(getComputedStyle(svg).getPropertyValue('--flow-cycle'))||6.4;
  const openingSpan=Math.max(nodeEnd+wireSpan,...[...entryTiming.values()].map(entry=>entry.pulseEnd));
  const actions=[],audioCues=[];
  for(const [index,shot] of shots.entries()){
    const intro=shot.preset==='establish',rate=intro?Math.max(1,openingSpan/shot.duration):1;
    shot.motion={edges:new Map(),cameraDuration,...(intro?{opening:{rate,wireStart:nodeEnd,span:openingSpan,complete:openingSpan/rate}}:{})};
    if(intro){
      // The opening melody follows whole-card arrivals, not a second intro clock.
      const arrivals=nodes.map(node=>shot.start+entryTiming.get(node).at/rate).sort((a,b)=>a-b);
      let last=-Infinity;const scale=[293.665,369.994,440,587.33,739.99,880,1108.73];let voice=0;
      for(const at of arrivals)if(at-last>=.24){audioCues.push({kind:'enter',at,duration:.5,hz:scale[Math.min(voice++,scale.length-1)],pan:0,shot:index});last=at;}
      audioCues.push({kind:'intro-root',at:shot.start+.12/rate,duration:Math.min(1.8,nodeEnd/rate),hz:146.832,pan:0,shot:index});
    }
    const selected=intro?[...edgePaths.values()].filter(record=>record.nativeOpening).map(record=>record.id):shot.edges;
    for(const [order,id] of selected.entries()){
      const record=edgePaths.get(id),relation=shot.edgeModes?.[id]==='relation';
      if(!record||(!record.flows.length&&!relation))throw Error('Missing native connection action '+id);
      const timing=!intro&&record.localTransfer||record;
      const start=shot.start+(intro?(nodeEnd+record.depart)/rate:shot.edgeTimes?.[id]??cameraDuration+.25+order*.95);
      const playbackRate=intro?rate:timing.travel/(shot.edgeDurations?.[id]??timing.travel),end=start+timing.travel/playbackRate;
      if(end>shot.end-(intro?.001:.4)){if(!intro)throw Error('Connection action exceeds its scene '+id);continue;}
      const action={edge:id,start,end,rate:playbackRate,depart:timing.depart,shot:index,kind:relation?'relation':'trace'};
      shot.motion.edges.set(id,action);actions.push(action);
      if(!intro&&relation){audioCues.push({kind:'arrive',at:start,duration:.3,hz:659.255,pan:0,edge:id,shot:index});}
      else if(!intro){
        audioCues.push({kind:'flow',at:start,duration:end-start,pan:0,edge:id,shot:index});
        audioCues.push({kind:'arrive',at:end,duration:.32,hz:[880,987.77,1108.73][order%3],pan:0,edge:id,shot:index});
      }
    }
    if(['follow','inspect'].includes(shot.preset)){
      audioCues.push({kind:'local',at:shot.start,duration:Math.min(shot.duration,cameraDuration+2.6),moveDuration:cameraDuration,pan:0,shot:index,move:false});
    }
  }
  let cameras=[],stageWidth=0,viewW=0,viewH=0,layout,current=-1,t=0,playing=false,raf=0,started=0,playbackStart=0,painted=-1,samples=[],soundOn=true,timeLabel='',lastViewBox='',annotations=[],nativeAnimations=[];
  const openingScans=new Map();
  let audioContext,audioOrigin=null,audioToken=0;
  const audioSources=new Set();
  const format=s=>`${Math.floor(s/60).toString().padStart(2,'0')}:${Math.floor(s%60).toString().padStart(2,'0')}`;
  const noteWidth=note=>note?.excerpt?440:note?.body?350:250;
  function camera(ids,overview=false,note,expand=false,connections=[]){
    const selected=overview?[...boxes.values(),...(facts.frames||facts.lanes),...[...edgeBoxes.values()].flat()]:[...ids.map(id=>boxes.get(id)).filter(Boolean),...connections.flatMap(id=>edgeBoxes.get(id)||[])];
    if(facts.sequence&&!overview&&connections.length){
      const messages=connections.flatMap(id=>edgeBoxes.get(id)||[]),top=Math.min(...messages.map(b=>b.y)),bottom=Math.max(...messages.map(b=>b.y+b.height));
      // Keep participant columns, but frame time from the current messages.
      selected.splice(0,selected.length,...selected.map(b=>({x:b.x,width:b.width,y:top-105,height:bottom-top+160})));
    }
    const left=Math.min(...selected.map(b=>b.x)),top=Math.min(...selected.map(b=>b.y)),right=Math.max(...selected.map(b=>b.x+b.width)),bottom=Math.max(...selected.map(b=>b.y+b.height));
    const width=noteWidth(note),leftNote=note?.preferred?.includes('left');
    const region={left:note&&leftNote?layout.left+12+width+40:layout.left,right:note&&!leftNote?layout.right-12-width-40:layout.right};
    const height=expand?viewH:layout.localHeight,pad=stageWidth*(overview?.012:.016),available=(region.right-region.left)/1000*stageWidth;
    const scale=Math.min(Math.max(1,available-pad*2)/Math.max(1,right-left),Math.max(1,height-pad*2)/Math.max(1,bottom-top));
    const center=((region.left+region.right)/2-layout.left)/1000*stageWidth;
    return {scale,x:center-(left+right)/2*scale,y:height/2-(top+bottom)/2*scale,region,bounds:{left,top,right,bottom}};
  }
  function openingViews(base,shot){
    const requested=plan.opening||'auto';if(requested==='fit'||shot.duration<2)return [base];
    const {left,top,right,bottom}=base.bounds,pad=stageWidth*.012,width=right-left,height=bottom-top;
    const fitX=(viewW-pad*2)/width,fitY=(viewH-pad*2)/height,automatic=requested==='auto';
    const axis=automatic?(fitX>fitY?'y':'x'):requested.slice(-1);
    const start=shot.start+.65,end=shot.end-.2,zoomEnd=start+.65;
    const span=(axis==='y'?viewH:viewW)-pad*2,content=axis==='y'?height:width;
    // Bound the sweep to one viewport length per three seconds.
    const sweepScale=span*(1+(end-zoomEnd)/3)/content;
    const readableScale=(stageWidth/1920*20)/labelSize;
    const scale=Math.min(axis==='y'?fitX:fitY,sweepScale,automatic?readableScale:Infinity);
    if(scale<=base.scale*(automatic?1.25:1.05))return [base];
    const center={x:viewW/2-(left+right)/2*scale,y:viewH/2-(top+bottom)/2*scale};
    const first={...center,...(axis==='y'?{y:pad-top*scale}:{x:pad-left*scale})};
    const last={...center,...(axis==='y'?{y:viewH-pad-bottom*scale}:{x:viewW-pad-right*scale})};
    openingScans.set(base.shot,{at:start,axis});
    return [{...base,duration:.45},{...base,scale,...first,at:start,duration:.65},{...base,scale,...last,at:zoomEnd,duration:end-zoomEnd,pan:true}];
  }
  function resize(syncSound=true){
    for(const note of annotations){note.position=null;note.fitWidth=null;for(const drawing of note.item.querySelectorAll('.branch-figure'))layoutBranches(drawing);}
    const frame=stage.getBoundingClientRect();stageWidth=frame.width;
    const gap=stageWidth*.012,caption=subtitle.cloneNode(false);
    Object.assign(caption.style,{position:'absolute',visibility:'hidden',transform:'none',left:'0',right:'0'});subtitle.parentElement.append(caption);
    let captionHeight=0;
    for(const text of new Set(shots.flatMap(shot=>(shot.captions||[{text:shot.caption}]).map(cue=>cue.text)))){caption.textContent=text;captionHeight=Math.max(captionHeight,caption.getBoundingClientRect().height);}
    caption.remove();
    const top=Math.max($('.heading').getBoundingClientRect().bottom,rail.getBoundingClientRect().bottom)-frame.top+gap;
    const style=getComputedStyle(stage),footer=name=>frame.height*parseFloat(style.getPropertyValue(name))/100+captionHeight+gap;
    viewport.style.top=top+'px';viewport.style.bottom=footer('--caption-global-bottom')+'px';
    const safe=$('.plot-safe-area');
    safe.style.top=top+'px';safe.style.bottom=footer('--caption-local-bottom')+'px';
    const view=viewport.getBoundingClientRect(),local=safe.getBoundingClientRect();viewW=view.width;viewH=view.height;
    layout={left:(view.left-frame.left)/stageWidth*1000,right:(view.right-frame.left)/stageWidth*1000,top:(view.top-frame.top)/stageWidth*1000,bottom:(local.bottom-frame.top)/stageWidth*1000,localHeight:local.height};
    openingScans.clear();
    cameras=shots.flatMap((shot,shotIndex)=>(shot.views||[{at:0,nodes:shot.nodes,edges:shot.edges,note:0}]).flatMap(view=>{
      const base={...camera(view.nodes,shot.preset==='establish'||shot.preset==='resolve'||!view.nodes.length,shot.annotations?.[view.note],shot.preset==='establish'||shot.preset==='resolve',view.edges),at:shot.start+view.at,shot:shotIndex,nodes:view.nodes,edges:view.edges};
      return shot.preset==='establish'?openingViews(base,shot):[base];
    }));
    const cues=audioCues.filter(cue=>cue.kind!=='move');
    for(const cue of cues)if(cue.kind==='local')cue.move=false;
    for(let index=1;index<cameras.length;index++)if(['scale','x','y'].some(key=>Math.abs(cameras[index][key]-cameras[index-1][key])>.001)){
      const stop=cameras[index],localCue=stop.at===shots[stop.shot].start?cues.find(cue=>cue.kind==='local'&&cue.shot===stop.shot):null;
      if(shots[stop.shot].preset==='establish')continue;
      if(localCue)localCue.move=true;
      else cues.push({kind:'move',at:stop.at,duration:cameraDuration,pan:0,shot:stop.shot});
    }
    audioCues.splice(0,audioCues.length,...cues.sort((a,b)=>a.at-b.at));seek(t,syncSound!==false);
  }

  function nativeFrame(local,shot){
    const intro=shot.preset==='establish';
    const clock=intro?local*shot.motion.opening.rate:shots[0].duration+local;
    const wireClock=intro?clock-shot.motion.opening.wireStart:clock;
    if(!nativeAnimations.length||nativeAnimations.some(animation=>animation.playState==='idle')){nativeAnimations=svg.getAnimations({subtree:true});for(const animation of nativeAnimations)animation.pause();}
    for(const animation of nativeAnimations){
      const edgeId=animation.effect?.target?.dataset?.storyEdge,record=edgePaths.get(edgeId),action=shot.motion.edges.get(edgeId);
      const entry=/node-enter|node-pulse/.test(animation.animationName||'');
      const timing=entry?animation.effect.getTiming():null;
      const edgeClock=action?Math.min(cycle-.001,action.depart+(t-action.start)*action.rate):-1;
      animation.currentTime=entry?(intro?(clock-.12)*1000:Number(timing.delay)+Number(timing.duration)+1):(record?edgeClock:wireClock)*1000;
    }
    for(const record of edgePaths.values()){
      const action=shot.motion.edges.get(record.id),edgeClock=action?action.depart+(t-action.start)*action.rate:-1;
      for(const flow of record.flows){const delay=parseFloat(flow.style.getPropertyValue('--flow-delay'))||0;flow.style.visibility=action&&action.kind!=='relation'&&t>=action.start&&edgeClock>=delay&&t<action.end+.9/action.rate?'visible':'hidden';}
      for(const shape of record.authored)shape.style.opacity=intro?ease((wireClock-record.depart-record.travel+.1)/.3):'';
      for(const shape of record.underlays)shape.style.opacity=intro?ease((wireClock-record.depart-record.travel+.1)/.3):'';
      for(const label of record.labels)label.style.opacity=intro?ease((wireClock-record.depart-record.travel)/.3):'';
    }
    for(const node of nodes){
      const wrapper=entryWrappers.get(node),entry=entryTiming.get(node);
      const p=clamp((clock-entry.at)/entry.duration),back=1+2.2*(p-1)**3+1.2*(p-1)**2;
      wrapper.style.opacity=intro?ease(p):'';wrapper.style.transform=intro?`translateY(${12*(1-ease(p))}px) scale(${mix(.87,1,back)})`:'';
    }
    frames.forEach(frame=>{frame.style.opacity=intro?ease((clock-frameBirth.get(frame))/.55):'';});
    contextLabels.forEach((label,index)=>{label.node.style.opacity=intro?ease((clock-.12-index*.16)/.5):'';});
    rail.style.opacity=intro?ease(clock/.7):1;
  }

  function legendMark(kind){
      const entry=facts.legend?.find(entry=>entry.kind===kind);
      const original=[...svg.querySelectorAll('[data-legend-kind]')].find(node=>node.dataset.legendKind===kind);
      const shape=original?.querySelector('rect,path,circle,ellipse,polygon');if(!shape||!entry)return null;
      const item=el('div','note-kind'),mark=vector('svg',{viewBox:'-2 -2 18 13','aria-hidden':'true'}),copy=shape.cloneNode(true);
      const x=Number(shape.getAttribute('x')||0),y=Number(shape.getAttribute('y')||0);
      const style=getComputedStyle(shape);copy.style.fill=style.fill;copy.style.stroke=style.stroke;
      item.style.color=style.stroke;
      copy.setAttribute('transform',`translate(${-x} ${-y})`);mark.append(copy);
      item.append(mark,el('span','',entry.label));return item;
  }
  function figureNode(drawing,id,x,y,width=134,height=44,font=11){
    const source=nodes.find(node=>node.dataset.nodeId===id),style=getComputedStyle(nodeShape(source));
    const rect=vector('rect',{'data-figure-node-id':id,x,y,width,height,rx:height===36?6:7,'stroke-width':1},drawing);rect.style.fill=style.fill;rect.style.stroke=style.stroke;
    const label=vector('text',{x:x+width/2,y:y+height/2+4,'text-anchor':'middle','font-size':font},drawing);label.style.fill=getComputedStyle(source.querySelector('text[data-node-label]')||source.querySelector('text')).fill;label.textContent=nodeById.get(id).label;
  }
  function edgePaint(id){
    const record=edgePaths.get(id),path=record?.authored.find(path=>path.getAttribute('data-animate')==='edge')||record?.authored[0];
    const style=path?getComputedStyle(path):null,attrs={stroke:style?.stroke||'#6b839d'};
    if(style?.strokeDasharray&&style.strokeDasharray!=='none')attrs['stroke-dasharray']=style.strokeDasharray;
    for(const name of ['marker-start','marker-end']){const value=path?.getAttribute(name);if(value&&value!=='none')attrs[name]=value;}
    if(path?.hasAttribute('data-class-bus')){const start=attrs['marker-start'];delete attrs['marker-start'];if(attrs['marker-end'])attrs['marker-start']=attrs['marker-end'];if(start)attrs['marker-end']=start;else delete attrs['marker-end'];}
    return attrs;
  }
  const needsArrow=id=>facts.defaultAction!=='relation'&&!edgeById.get(id).ends&&!edgeById.get(id).kind&&!Object.keys(edgePaint(id)).some(key=>key.startsWith('marker-'));
  const messageLabel=edge=>`${String(facts.edges.indexOf(edge)+1).padStart(2,'0')} · ${edge.label||''}`;
  function layoutBranches(drawing){
    const source=drawing.querySelector(':scope > rect[data-figure-node-id]'),targets=[...drawing.querySelectorAll('[data-branch-target]')];
    const sourceWidth=Math.max(132,source.nextElementSibling.getComputedTextLength()+24),targetWidth=Math.max(132,...targets.map(group=>group.querySelector('rect').nextElementSibling.getComputedTextLength()+24));
    const gap=Math.max(84,...targets.map(group=>group.querySelector('[data-branch-label]').getComputedTextLength()+36));
    const height=targets.length*58+18,left=4,targetX=left+sourceWidth+gap,joinX=left+sourceWidth+16;
    drawing.setAttribute('viewBox',`0 0 ${targetX+targetWidth+4} ${height}`);
    source.setAttribute('x',left);source.setAttribute('y',height/2-18);source.setAttribute('width',sourceWidth);
    source.nextElementSibling.setAttribute('x',left+sourceWidth/2);source.nextElementSibling.setAttribute('y',height/2+4);
    for(const [index,group]of targets.entries()){
      const y=20+index*58,card=group.querySelector('rect'),label=group.querySelector('[data-branch-label]');
      card.setAttribute('x',targetX);card.setAttribute('y',y);card.setAttribute('width',targetWidth);
      card.nextElementSibling.setAttribute('x',targetX+targetWidth/2);card.nextElementSibling.setAttribute('y',y+22);
      const arrow=needsArrow(group.dataset.branchTarget),end=targetX-(arrow?5:0);
      group.querySelector('path').setAttribute('d',`M${left+sourceWidth} ${height/2} H${joinX} V${y+18} H${end}`+(arrow?` M${end-5} ${y+14} L${end} ${y+18} L${end-5} ${y+22}`:''));
      label.setAttribute('x',(joinX+targetX-6)/2);label.setAttribute('y',y+8);
    }
  }
  function relationshipFigure(ids){
    const figure=el('div','note-diagram');
    figure.style.setProperty('--figure-count',ids.length);
    const connections=ids.map(id=>edgeById.get(id)),sharedFrom=connections.length>1&&connections.every(edge=>!edge.ends&&!edge.kind&&edge.from===connections[0].from);
    if(sharedFrom){
      figure.style.setProperty('--figure-count',1);
      const drawing=vector('svg',{viewBox:`0 0 350 ${connections.length*58+18}`,class:'branch-figure','aria-label':'Connections from one node'}),height=connections.length*58+18;
      const drawNode=(id,x,y)=>figureNode(drawing,id,x,y,132,36,10);
      drawNode(connections[0].from,0,height/2-18);
      for(const [index,edge]of connections.entries()){
        const y=20+index*58,group=vector('g',{'data-branch-target':edge.id},drawing);
        figureNode(group,edge.to,218,y,132,36,10);
        const paint=edgePaint(edge.id);
        vector('path',{'data-figure-edge-id':edge.id,fill:'none',...paint,'stroke-width':1.2},group);
        const label=vector('text',{'data-branch-label':'',x:200,y:y+8,'text-anchor':'middle','font-size':9},group);label.style.fill=paint.stroke;label.textContent=edge.label||'';
      }
      figure.append(drawing);return figure;
    }
    for(const id of ids){
      const edge=edgeById.get(id),drawing=vector('svg',{viewBox:'0 0 350 82','aria-label':`${nodeById.get(edge.from).label} → ${nodeById.get(edge.to).label}`});
      for(const [index,nodeId] of [edge.from,edge.to].entries())figureNode(drawing,nodeId,index?216:0,23);
      const paint=edgePaint(id),label=vector('text',{x:175,y:13,'text-anchor':'middle','font-size':9},drawing);label.style.fill=paint.stroke;label.textContent=facts.sequence?messageLabel(edge):edge.label||'';
      vector('path',{'data-figure-edge-id':id,d:needsArrow(id)?'M134 45 H211 M206 41 L211 45 L206 49':'M134 45 H216',fill:'none',...paint,'stroke-width':1.3},drawing);
      figure.append(drawing);
    }
    return figure;
  }

  function directionalFigure(shot,spec){
    const active=spec.relations.map(id=>edgeById.get(id)),participants=[...new Set(active.flatMap(edge=>[edge.from,edge.to]))].sort((a,b)=>facts.nodes.findIndex(node=>node.id===a)-facts.nodes.findIndex(node=>node.id===b));
    const context=facts.edges.filter(edge=>shot.edges.includes(edge.id)&&participants.includes(edge.from)&&participants.includes(edge.to));
    // Only combine opposite connections explicitly selected in this scene.
    const duplex=facts.defaultAction!=='relation'&&participants.length===2&&context.length===2&&context.every(edge=>!edge.ends&&!edge.kind)&&context[0].from===context[1].to&&context[0].to===context[1].from;
    if(participants.length!==2||(!duplex&&(!facts.sequence||active.length!==1)))return null;
    const connections=duplex?context:active,messages=facts.sequence?connections:[...connections].sort((a,b)=>Number(b.from===participants[0])-Number(a.from===participants[0]));
    const labelFor=edge=>facts.sequence?messageLabel(edge):edge.label||'';
    const figure=el('div','note-diagram'),drawing=vector('svg',{viewBox:`0 0 350 ${duplex?150:82}`,class:duplex?'paired-links':'',role:'img','aria-label':messages.map(labelFor).join('；')});
    figureNode(drawing,participants[0],0,duplex?51:23);figureNode(drawing,participants[1],216,duplex?51:23);
    for(const [index,edge]of messages.entries()){
      const current=spec.relations.includes(edge.id),group=vector('g',{'data-figure-edge-id':edge.id,'data-current':String(current),opacity:current?1:.28},drawing);
      const paint=edgePaint(edge.id),color=paint.stroke,left=edge.from===participants[0],from=duplex?(left?67:283):(left?134:216),to=duplex?(left?283:67):(left?211:139),y=duplex?(index?95:51):45,bend=index?130:16,direction=duplex?(index?-1:1):(left?1:-1);
      vector('path',{d:duplex?`M${from} ${y} C${from} ${bend} ${to} ${bend} ${to} ${y}`:`M${from} ${y} H${to}`,fill:'none',...paint,'stroke-width':current?1.4:1.1},group);
      vector('path',{d:duplex?`M${to-3.5} ${y-5*direction} L${to} ${y} L${to+3.5} ${y-5*direction}`:`M${to-5*direction} ${y-4} L${to} ${y} L${to-5*direction} ${y+4}`,fill:'none',stroke:color,'stroke-width':1.3},group);
      const label=vector('text',{x:175,y:duplex&&index?145:13,'text-anchor':'middle','font-size':9,'font-weight':current?550:400,fill:color},group);label.textContent=labelFor(edge);
    }
    figure.append(drawing);
    return figure;
  }

  function buildAnnotations(shot){
    $('.callouts').replaceChildren();annotations=[];
    for(const spec of shot.annotations||[]){
      const item=el('div','callout note'),heading=el('div','note-heading',spec.title),body=el('div','note-fields');
      item.append(heading);
      const ids=[spec.anchor,...(spec.relations||[]).flatMap(id=>{const edge=edgeById.get(id);return [edge.from,edge.to];})];
      const legends=[...new Set(ids.map(id=>nodeById.get(id)?.kind))].map(legendMark).filter(Boolean);
      if(legends.length){const row=el('div','note-legends');row.append(...legends);item.append(row);}
      if(spec.kindExplanation)item.append(el('p','kind-explanation',spec.kindExplanation));
      if(spec.body)item.append(el('p','note-body',spec.body));
      for(const field of spec.fields||[]){const row=el('div','note-field');row.append(el('span','note-term',field.label),el('span','note-detail',field.detail));body.append(row);}
      if(spec.fields?.length)item.append(body);
      if(spec.relations?.length){
        const figure=directionalFigure(shot,spec)||relationshipFigure(spec.relations);
        if(plan.scopeStyle==='field'&&!facts.sequence)StoryScopeField.decorate({figure,scopes,source:svg});
        item.append(figure);
      }
      if(spec.figureCaption)item.append(el('p','figure-caption',spec.figureCaption));
      if(spec.excerpt){
        item.classList.add('has-code');
        const code=el('div','code-excerpt'),title=el('div','code-title'),lines=el('div','code-lines');
        title.append(el('span','',spec.excerpt.path),el('span','code-revision',spec.excerpt.revision.slice(0,8)));
        const indent=Math.min(...spec.excerpt.lines.filter(line=>line.text.trim()).map(line=>/^\s*/.exec(line.text)[0].length));
        for(const source of spec.excerpt.lines){const row=el('div','code-row'+(source.emphasis?' is-emphasis':''));row.append(el('span','code-number',source.number),el('code','',source.text.slice(indent)||' '));lines.append(row);}
        code.append(title,lines);item.append(code);
      }
      $('.callouts').append(item);item.style.width=noteWidth(spec)/10+'cqw';
      for(const drawing of item.querySelectorAll('.branch-figure'))layoutBranches(drawing);
      const shape=nodeShape(nodes.find(node=>node.dataset.nodeId===spec.anchor));item.style.setProperty('--note-ink',shape?getComputedStyle(shape).stroke:getComputedStyle(svg).getPropertyValue('--frontend-stroke'));
      annotations.push({spec,item,width:noteWidth(spec),height:0,position:null});
    }
  }
  function projectBox(b,camera){return {x:layout.left+(b.x*camera.scale+camera.x)/stageWidth*1000,y:layout.top+(b.y*camera.scale+camera.y)/stageWidth*1000,w:b.width*camera.scale/stageWidth*1000,h:b.height*camera.scale/stageWidth*1000};}
  function projected(id,camera){const b=boxes.get(id);return b?projectBox(b,camera):null;}
  function locate(note){
    return {x:note.spec.preferred?.includes('left')?layout.left+12:layout.right-12-note.width,y:Math.max(layout.top,(layout.top+layout.bottom-note.height)/2)};
  }
  function enter(index){
    current=index;const shot=shots[index],chosen=new Set(shot.nodes),lines=new Set(shot.edges),full=shot.preset==='establish'||shot.preset==='resolve';
    stage.dataset.scene=shot.preset;
    for(const n of nodes){n.classList.toggle('story-muted',!full&&!chosen.has(n.dataset.nodeId));n.classList.toggle('story-focus',chosen.has(n.dataset.nodeId));n.classList.toggle('story-anchor',shot.annotations?.some(a=>a.anchor===n.dataset.nodeId));}
    for(const e of edgeElements)e.classList.toggle('story-muted',!full&&!lines.has(e.dataset.edgeId));
    headline.textContent=shot.headline;oldHeadline.textContent=index?shots[index-1].headline:'';subtitle.textContent=shot.caption;
    const position=`${String(index+1).padStart(2,'0')} / ${String(shots.length).padStart(2,'0')}`;
    $('.chapter').textContent=shot.label?`${position} — ${shot.label}`:position;
    phaseEls.forEach((n,j)=>{n.classList.toggle('active',j===shot.phase);n.classList.toggle('done',j<shot.phase);});buildAnnotations(shot);
  }
  function seek(value,syncSound=true){
    t=Math.max(0,Math.min(total,Number(value)||0));let i=shots.findIndex(s=>t<s.end);if(i<0)i=shots.length-1;if(i!==current)enter(i);
    const shot=shots[i],local=t-shot.start,stop=Math.max(0,cameras.findLastIndex(c=>c.at<=t)),to=cameras[stop],from=stop?cameras[stop-1]:{scale:to.scale*.97,x:viewW/2+(to.x-viewW/2)*.97,y:viewH/2+(to.y-viewH/2)*.97};
    const progress=(t-to.at)/(to.duration??shot.motion.cameraDuration),travel=reducedMotion()?1:to.pan?clamp(progress):ease(progress),target=to;
    const scale=mix(from.scale,target.scale,travel),x=mix(from.x,target.x,travel),y=mix(from.y,target.y,travel);
    const left=(mix(from.region?.left??layout.left,to.region.left,travel)-layout.left)/(layout.right-layout.left)*100,right=(mix(from.region?.right??layout.right,to.region.right,travel)-layout.left)/(layout.right-layout.left)*100;
    viewport.style.maskImage=`linear-gradient(90deg,transparent ${left}%,#000 ${left+1.3}%,#000 ${right-1.3}%,transparent ${right}%)`;
    viewport.style.clipPath=['establish','resolve'].includes(shot.preset)?'none':`inset(0 0 ${Math.max(0,(viewH-layout.localHeight)/viewH*100)}% 0)`;
    const viewBox=`${-x/scale} ${-y/scale} ${viewW/scale} ${viewH/scale}`;
    if(viewBox!==lastViewBox){svg.setAttribute('viewBox',viewBox);lastViewBox=viewBox;}
    const inside=r=>r.x>=layout.left+4&&r.x+r.w<=layout.right-4&&r.y>=layout.top+4&&r.y+r.h<=layout.bottom-4;
    const full=shot.preset==='establish'||shot.preset==='resolve',chosen=new Set(to.nodes),lines=new Set(to.edges);
    const scan=openingScans.get(i),pinned=facts.sequence&&(!full||scan&&t>=scan.at),castTop=stageWidth*.0094;
    if(sequenceContent){
      sequenceContent.style.clipPath=scan&&pinned?'url(#story-sequence-window)':'';
      const header=castTop+Math.max(...[...boxes.values()].map(box=>box.height))*scale+stageWidth*.0016;
      for(const [key,value]of Object.entries({x:-x/scale,y:(header-y)/scale,width:viewW/scale,height:Math.max(0,viewH-header)/scale}))sequenceClip.setAttribute(key,value);
    }
    for(const node of nodes){const r=projected(node.dataset.nodeId,{scale,x,y});node.classList.toggle('story-cropped',!full&&!chosen.has(node.dataset.nodeId)&&!inside(r));node.classList.toggle('story-muted',!full&&!chosen.has(node.dataset.nodeId));node.classList.toggle('story-focus',chosen.has(node.dataset.nodeId));node.style.visibility=pinned?'hidden':'';}
    for(const edge of edgeElements)edge.classList.toggle('story-muted',!full&&!lines.has(edge.dataset.edgeId));
    if(sequenceCast){sequenceCast.style.display=pinned?'':'none';for(const [id,copy]of castCopies){copy.setAttribute('transform',`translate(0 ${-y/scale+castTop/scale-boxes.get(id).y})`);const entry=entryTiming.get(nodes.find(node=>node.dataset.nodeId===id));copy.style.opacity=scan?String(ease((local*shot.motion.opening.rate-entry.at)/entry.duration)):full?'1':chosen.has(id)?'1':'.12';}}
    for(const label of contextLabels)label.node.classList.toggle('story-cropped',shot.preset!=='establish'&&!inside(projectBox(label.box,{scale,x,y})));
    const titleIn=ease(local/.58);headline.style.opacity=titleIn;headline.style.transform=`translateY(${12*(1-titleIn)}px)`;oldHeadline.style.opacity=1-ease(local/.32);oldHeadline.style.transform=`translateY(${-10*ease(local/.4)}px)`;
    const cues=shot.captions||[{at:0,text:shot.caption}],cueIndex=Math.max(0,cues.findLastIndex(cue=>local>=cue.at)),cue=cues[cueIndex],cueEnd=cues[cueIndex+1]?.at??shot.duration;
    subtitle.textContent=cue.text;
    const caption=ease((local-cue.at-.12)/.35)*ease((cueEnd-local)/.2);subtitle.style.opacity=caption;subtitle.style.transform=`translateY(${5*(1-caption)}px)`;
    nativeFrame(local,shot);

    for(const node of nodes)node.classList.toggle('story-anchor',annotations.some(note=>note.spec.anchor===node.dataset.nodeId&&local>=(note.spec.at??1.45)&&local<(note.spec.until??shot.duration-.12)));
    for(const note of annotations){
      const pop=ease((local-(note.spec.at??1.45))/.65)*ease(((note.spec.until??shot.duration-.12)-local)/.5);
      if(note.fitWidth!==stageWidth){
        note.item.classList.remove('is-dense');const drawings=[...note.item.querySelectorAll('.note-diagram > svg')];
        for(const drawing of drawings)drawing.style.maxHeight='';
        if(note.item.getBoundingClientRect().height>layout.localHeight)note.item.classList.add('is-dense');
        const overflow=note.item.getBoundingClientRect().height-layout.localHeight,height=drawings.reduce((sum,drawing)=>sum+drawing.getBoundingClientRect().height,0);
        if(overflow>0&&height>0)for(const drawing of drawings)drawing.style.maxHeight=Math.max(1,drawing.getBoundingClientRect().height*(height-overflow)/height)+'px';
        note.fitWidth=stageWidth;
      }
      note.height=note.item.getBoundingClientRect().height/stageWidth*1000;
      note.position=locate(note);
      const nx=note.position.x,ny=note.position.y+(1-pop)*7;
      note.item.style.opacity=pop;
      note.item.style.transform='translate3d('+nx/10+'cqw,'+ny/10+'cqw,0)';
    }
    const activeLanes=new Set(to.nodes.map(id=>nodeById.get(id)?.context?.split(' › ')[0]));
    for(const [j,lane]of facts.lanes.entries()){
      const frame=svg.querySelector('[data-composition-frame-id="'+lane.id+'"]');
      const overview=shot.preset==='establish'||shot.preset==='resolve';
      frame.classList.toggle('lane-active',overview?local>j*.55:activeLanes.has(lane.label));
      frame.classList.toggle('lane-muted',!overview&&!activeLanes.has(lane.label));
    }
    phaseEls.forEach((n,j)=>n.style.setProperty('--phase-fill',j<shot.phase?1:j===shot.phase?mix(.18,1,ease(local/shot.duration)):0));
    const wash=$('.transition-light'),sweep=clamp(local/1.3);wash.style.opacity=reducedMotion()?'0':String(Math.sin(sweep*Math.PI)*.55);wash.style.transform=`translateX(${sweep*600-100}%)`;
    const label=`${format(t)} / ${format(total)}`;if(label!==timeLabel){timeLabel=label;clock.textContent=label;}range.value=t;
    if(syncSound&&playing){playbackStart=t;started=performance.now();stopAudio();startAudio();}
    return {time:t,shot:i,headline:shot.headline,camera:{scale,x,y}};
  }
  function stopAudio(){audioToken++;for(const source of audioSources){source.onended=null;source.stop();source.disconnect();source.buffer=null;}audioSources.clear();audioOrigin=null;}
  async function startAudio(){
    if(!soundOn||!playing)return;
    const token=++audioToken;
    try{
      audioContext??=new AudioContext({sampleRate:48000});
      await audioContext.resume();if(token!==audioToken||!playing||!soundOn)return;
      let cursor=t;
      const next=StorySound.renderer(total,audioCues,cursor);
      const schedule=()=>{
        if(token!==audioToken||!playing||!soundOn||cursor>=total)return;
        const sound=next(Math.min(4,total-cursor)),length=sound.channels[0].length;if(!length)return;
        const buffer=audioContext.createBuffer(2,length,sound.rate);sound.channels.forEach((data,index)=>buffer.copyToChannel(data,index));
        const source=audioContext.createBufferSource();source.buffer=buffer;source.connect(audioContext.destination);audioSources.add(source);
        audioOrigin??=audioContext.currentTime-t+.05;
        const at=audioOrigin+cursor;cursor+=length/sound.rate;
        source.onended=()=>{audioSources.delete(source);source.disconnect();source.buffer=null;try{schedule();}catch(error){stopAudio();console.warn('Audio playback unavailable',error);}};
        source.start(at);
      };
      // Keep two short buffers scheduled; synthesis and retained audio stay bounded.
      schedule();schedule();
      started=performance.now();playbackStart=t;
    }catch(error){stopAudio();soundButton.textContent='Enable sound';console.warn('Audio playback unavailable',error);}
  }
  function tick(now){if(!playing)return;const next=audioOrigin!==null?Math.max(playbackStart,audioContext.currentTime-audioOrigin):playbackStart+(now-started)/1000,frame=Math.floor(next*60);if(frame!==painted||next>=total){const begin=performance.now();seek(next,false);samples.push(performance.now()-begin);painted=frame;}if(next<total)raf=requestAnimationFrame(tick);else pause();}
  async function play(){if(playing)return;if(t>=total)seek(0);playing=true;started=performance.now();painted=-1;playbackStart=t;playButton.textContent='Pause';await startAudio();if(playing)raf=requestAnimationFrame(tick);}
  function pause(){playing=false;cancelAnimationFrame(raf);stopAudio();started=0;playButton.textContent='Play';}
  function setSound(on){soundOn=!!on;soundButton.textContent=soundOn?'Sound on':'Sound off';soundButton.setAttribute('aria-pressed',soundOn);playbackStart=t;started=performance.now();stopAudio();if(soundOn&&playing)startAudio();return soundOn;}
  let appearanceVariables=[];
  function setAppearance({theme,preset,variables={},titleFont}={}){
    for(const target of [document.documentElement,svg]){
      for(const [key,value]of Object.entries({theme,preset}))if(value)target.dataset[key]=value;else delete target.dataset[key];
      for(const key of appearanceVariables)if(!Object.hasOwn(variables,key))target.style.removeProperty(key);
      for(const [key,value]of Object.entries(variables))if(key.startsWith('--'))target.style.setProperty(key,value);
    }
    appearanceVariables=Object.keys(variables).filter(key=>key.startsWith('--'));
    stage.dataset.viewerStyle='true';stage.style.setProperty('--story-title-font',titleFont||'inherit');
    current=-1;resize(false);
  }
  playButton.onclick=()=>playing?pause():play();$('[data-replay]').onclick=()=>{pause();seek(0);play();};range.max=total;range.oninput=()=>{pause();seek(range.value);};soundButton.onclick=()=>setSound(!soundOn);
  document.addEventListener('keydown',e=>{if(e.target.matches('input'))return;if(e.code==='Space'){e.preventDefault();playing?pause():play();}if(e.key==='ArrowRight'){pause();seek(t+2);}if(e.key==='ArrowLeft'){pause();seek(t-2);}});
  new ResizeObserver(resize).observe(stage);
  window.Story={seek,play,pause,setSound,setAppearance,duration:total,shots,plan,mode,actions,audioCues,metrics(){return {samples:[...samples],sourceNodes:nodes.length,sourceEdges:edgeById.size,nativeAnimations:nativeAnimations.length,openingView:openingScans.has(0)?'scan-'+openingScans.get(0).axis:'fit',sound:soundOn,audioTime:audioOrigin!==null?Math.max(playbackStart,audioContext.currentTime-audioOrigin):t,audioPlaying:!!audioSources.size,playing};},resetMetrics(){samples=[];}};
  document.fonts.ready.then(()=>{resize();document.documentElement.dataset.storyReady='true';window.storyReady=true;});
})();
