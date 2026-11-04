(() => {
  'use strict';
  const P = JSON.parse(document.getElementById('scene-payload').textContent);
  const S = P.scene, F = P.finding, A = window.Archify;
  const svg = document.querySelector('.diagram-container > svg');
  const board = document.querySelector('.diagram-container');
  for(const [i,e] of F.graph.edges.entries())if(e.basis==='source')svg.querySelectorAll('[data-edge-id="e'+i+'"] path,path[data-edge-id="e'+i+'"]').forEach(el=>el.style.strokeDasharray='none');
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const value = x => x === null ? '未返回' : typeof x === 'boolean' ? (x ? '是' : '否') : typeof x === 'object' ? JSON.stringify(x) : String(x);
  const nodes = new Map(F.graph.nodes.map(n => [n.id,n]));
  const reverseIds = Object.fromEntries(Object.entries(P.native_ids).map(([a,b]) => [b,a]));
  const nativeNode = id => svg.querySelector('[data-node-id="'+P.native_ids[id]+'"]');
  const basis = {source:'源码确认',inference:'源码推导',unknown:'尚待核定'};
  const roles = {step:'处理环节',guard:'已有保护',failure:'偏差位置',unknown:'待核定'};
  let sample = S.default_scenario;
  let selected = {node:F.graph.nodes.find(n=>n.role==='failure')?.id || S.input_node};
  const current = () => S.scenarios.find(s=>s.id===sample);
  const isReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fragment = (markup, className) => {const el=document.createElement('section');el.className=className;el.innerHTML=markup;return el;};
  const controls = fragment('<div class="sr-scenario-controls"><span>输入场景</span><div class="sr-scenarios" role="group" aria-label="输入场景">'+S.scenarios.map(c=>'<button data-case="'+esc(c.id)+'" aria-pressed="false">'+esc(c.title)+'</button>').join('')+'</div></div><span id="sr-record-status"></span><button id="sr-toggle-canvas" class="sr-mobile-toggle" aria-expanded="false">展开交互画布</button>', 'sr-scenario-bar');
  board.before(controls);
  const context = fragment('<span class="sr-context-brand">Source Review</span><span>'+esc(P.project)+'</span><span>'+esc(F.severity)+' · '+esc(P.status_label)+'</span>', 'sr-context');
  document.querySelector('.header').before(context);
  const note = fragment('<div class="sr-legend"><span class="sr-dot cyan">共享输入</span><span class="sr-dot green">已有保护</span><span class="sr-dot rose">问题路径</span><span>实线：源码确认 · 虚线：源码推导 / 待核定</span></div><p>流动是过程示意，不是线上轨迹。切换输入仅查看已有隔离验证。</p>', 'sr-reading-note');
  board.after(note);
  const body = fragment('<div class="sr-input-strip" id="sr-input-strip"></div><div class="sr-mobile-index" id="sr-mobile-index"></div><section id="sr-detail" class="sr-detail" aria-label="源码与证据"><header><div><span id="sr-detail-role"></span><h2 id="sr-detail-title"></h2></div><button id="sr-focus-node">在画布中定位</button></header><div id="sr-detail-content" class="sr-detail-grid"></div></section><section class="sr-boundaries"><div><h3>影响与边界</h3><p>'+esc(F.impact)+'</p></div><div><h3>已检查的保护</h3>'+F.counterevidence.map(c=>'<p>'+esc(c.reason)+'</p>').join('')+'</div><div><h3>尚未证明</h3>'+F.gaps.map(g=>'<p>'+esc(g)+'</p>').join('')+'</div></section><details class="sr-verification"><summary>验证记录与修复验收</summary><div id="sr-verification-content"></div><p>'+esc(F.recommendation)+'</p>'+F.acceptance.map(a=>'<p>'+esc(a.id)+' · '+esc(a.text)+'</p>').join('')+'<button id="sr-task">导出'+(P.task.kind==='repair'?'修复候选':'调查')+'任务</button></details><footer class="sr-footer"><span>'+P.sources.map(s=>esc(s.id)+' '+esc(s.revision.slice(0,12))).join(' · ')+'</span><span>报告 '+esc(S.report_digest.slice(0,12))+' · 查看器 <a href="https://github.com/tt-a1i/archify/tree/a4065941f12be7967436261d9934784e381d423c" target="_blank" rel="noreferrer">Archify</a></span></footer>', 'sr-review');
  note.after(body);
  // Native runtime keeps camera/focus/route state. Only scenario presentation changes.
  const ns='http://www.w3.org/2000/svg';
  function svgEl(tag,attrs,text){const el=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text!==undefined)el.textContent=text;return el;}
  function wrap(text,width,font=13){const lines=[];let line='',size=0;const tokens=String(text).match(/[A-Za-z0-9_.]+|[^\n]|\n/gu)||[];for(const token of tokens){const w=[...token].reduce((sum,c)=>sum+(c.charCodeAt(0)>255?1:.64)*font,0);if(token==='\n'||size+w>width){if(line)lines.push(line);line='';size=0;}if(token!=='\n'){line+=token;size+=w;}}if(line)lines.push(line);return lines;}
  function drawContent(id,c){
    const n=nativeNode(id),original=nodes.get(id),box=n.querySelector('rect'),x=+box.getAttribute('x'),y=+box.getAttribute('y'),w=+box.getAttribute('width'),h=+box.getAttribute('height');
    n.querySelectorAll(':scope>text,:scope>.sr-node-content').forEach(e=>e.remove());
    const g=svgEl('g',{class:'sr-node-content','pointer-events':'none'});n.append(g);
    const lane=S.lanes.find(l=>l.nodes.includes(id)),output=lane?.output_node===id,input=id===S.input_node;
    const text=(t,dx,dy,size=13,cls='t-primary',weight=400)=>{const el=svgEl('text',{x:x+dx,y:y+dy,'font-size':size,class:cls,'font-weight':weight},t);g.append(el);return el;};
    const line=dy=>g.append(svgEl('line',{x1:x+18,x2:x+w-18,y1:y+dy,y2:y+dy,stroke:'var(--panel-border)','stroke-width':1}));
    const title=n.getAttribute('data-node-label'),heading=text(title,18,32,17,'t-primary',650);heading.setAttribute('data-node-label','');
    const role=input?'共享输入':output?'隔离验证结果':roles[original.role];text(role,18,53,11,'t-muted');line(66);
    const state=c.states.find(s=>s.node===id);
    if(input){
      let dy=89;
      for(const group of c.input.groups){text(group.label,18,dy,12,'t-muted');dy+=22;
        for(const field of group.fields){const name=field.label.split(' · ').at(-1);text(name,18,dy,13,'t-primary',550);const v=text(value(field.value)+' '+field.unit,w-18,dy,13);v.setAttribute('text-anchor','end');dy+=22;}dy+=10;}
      const tag=text(c.title,18,h-12,11,'t-muted');tag.classList.add('sr-value');
      n.setAttribute('data-node-tag',c.title);
    }else if(output){
      const known=Object.hasOwn(c.outputs,id),v=known?value(c.outputs[id]):'未验证';
      const number=text(v,18,115,34,'t-primary',650);const measured=number.getComputedTextLength();
      if(measured>w-70)number.setAttribute('font-size',Math.max(11,34*(w-70)/measured));
      text(known?lane.measure.unit:'',Math.min(w-44,26+number.getComputedTextLength()),115,13,'t-muted');
      text(lane.measure.label,18,140,12,'t-muted');
      const note=known?'来源：历史隔离验证':'没有验证记录，不能判断运行输出';
      text(note,18,170,11,'t-muted');
      const tag=text(known?(c.record.fresh?'已核对采集源码':'当前源码待核定'):'源码推导不等于运行结果',18,h-12,10,'t-muted');
      tag.classList.add('sr-value');tag.dataset.actual=known?value(c.outputs[id]):'未验证';
      n.setAttribute('data-node-tag',known?v+' '+lane.measure.unit+' · 隔离验证':'未验证');
    }else{
      const summary=state?.summary||original.detail;
      const lines=wrap(summary,w-36,13);lines.slice(0,4).forEach((t,i)=>text(t+(i===3&&lines.length>4?'…':''),18,91+i*22,13));
      const focus=S.focus[id],e=P.evidence[focus?.evidence||original.evidence[0]],loc=e?e.path.split('/').pop()+':'+(focus?.highlight?.[0]||focus?.start||e.start):'依据尚待补充';
      text(loc,18,h-30,11,'t-muted');text((state?basis[state.basis]:'源码依据')+' · 点击展开证据',18,h-12,10,'t-muted');
      n.setAttribute('data-node-sublabel',summary);
    }
  }
  function inputMarkup(c) {
    return c.input.groups.map(g=>'<div class="sr-input-group"><strong>'+esc(g.label)+'</strong>'+g.fields.map(f=>'<span>'+esc(f.label)+' <b>'+esc(value(f.value))+' '+esc(f.unit)+'</b></span>').join('')+'</div>').join('');
  }
  function updateScenario() {
    const c=current();
    controls.querySelectorAll('[data-case]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.case===sample)));
    document.getElementById('sr-record-status').textContent=c.record?(c.record.fresh?'已有隔离验证记录':'历史隔离验证 · 当前源码待核定'):'尚未运行验证';
    for(const id of nodes.keys())drawContent(id,c);
    document.getElementById('sr-input-strip').innerHTML='<div class="sr-input-caption"><strong>'+esc({synthetic:'合成输入',observed:'观测输入',hypothetical:'假设输入'}[c.input.origin])+'</strong><span>同一份数据进入 '+S.lanes.length+' 条路径</span></div>'+inputMarkup(c);
    document.getElementById('sr-mobile-index').innerHTML=S.lanes.map(l=>'<div><strong>'+esc(l.title)+'</strong>'+l.nodes.map(id=>{const n=nodes.get(id),state=c.states.find(s=>s.node===id);return '<button data-node="'+esc(id)+'"><b>'+esc(n.title)+'</b><span>'+esc(state?.summary||n.detail)+'</span>'+(id===l.output_node?'<strong>'+esc(Object.hasOwn(c.outputs,id)?value(c.outputs[id])+' '+l.measure.unit+' · 隔离验证':'未验证')+'</strong>':'')+'</button>';}).join('')+'</div>').join('');
    document.getElementById('sr-verification-content').innerHTML='<div class="sr-table-wrap"><table><thead><tr><th>输入场景</th>'+S.lanes.map(l=>'<th>'+esc(l.title)+'</th>').join('')+'</tr></thead><tbody>'+S.scenarios.map(s=>'<tr><td>'+esc(s.title)+'</td>'+S.lanes.map(l=>'<td>'+esc(Object.hasOwn(s.outputs,l.output_node)?value(s.outputs[l.output_node])+' '+l.measure.unit:'未验证')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+(c.record?'<p>来源：'+esc(c.record.run)+' / '+esc(c.record.name)+'</p>'+c.record.limitations.map(t=>'<p>'+esc(t)+'</p>').join(''):'<p>本场景没有验证记录，输出不作数值判断。</p>');
    showDetail();
    const active=A.focus.active();if(typeof active==='string')A.focus.set(active,{toggle:false,updateUrl:false});
    // Native node index uses stable titles; scenario values live in the tags above.
    try{sessionStorage.setItem('sr-scenario:'+S.report_digest,sample);}catch(_){}
  }
  function showDetail(evidenceId) {
    const c=current(),edge=selected.edge!==undefined?F.graph.edges[selected.edge]:null;
    const n=edge?null:nodes.get(selected.node),refs=edge?edge.evidence:n.evidence,focus=n?S.focus[n.id]:null;
    const e=P.evidence[evidenceId || focus?.evidence || refs[0]];
    document.getElementById('sr-detail-role').textContent=edge?basis[edge.basis]:n.id===S.input_node?'共享输入':roles[n.role];
    document.getElementById('sr-detail-role').dataset.role=edge?'step':n.role;
    document.getElementById('sr-detail-title').textContent=edge?edge.label:n.title;
    document.getElementById('sr-focus-node').hidden=!!edge;
    const state=n?c.states.find(s=>s.node===n.id):null;
    const measure=n?S.lanes.find(l=>l.output_node===n.id)?.measure:null;
    let explanation='<p>'+esc(edge?nodes.get(edge.from).title+' → '+nodes.get(edge.to).title:n.detail)+'</p>';
    if(state)explanation+='<h3>'+esc(c.title)+'时会发生什么</h3><p>'+esc(state.summary)+'</p><small>'+esc(basis[state.basis])+' · '+state.evidence.length+' 份依据</small>';
    if(measure)explanation+='<h3>'+esc(measure.label)+'</h3><p>'+esc(Object.hasOwn(c.outputs,n.id)?value(c.outputs[n.id])+' '+measure.unit:'未验证')+'</p>';
    if(n?.id===S.input_node)explanation+=inputMarkup(c);
    const links=F.graph.edges.map((link,i)=>({...link,i})).filter(link=>edge?link.i===selected.edge:link.from===n.id||link.to===n.id);
    explanation+='<div class="sr-links"><h3>相关关系</h3>'+links.map(l=>'<button data-edge="'+l.i+'"><span>'+esc(l.label)+'</span><small>'+esc(basis[l.basis])+'</small></button>').join('')+'</div>';
    let source='<p>还没有直接源码依据。'+esc(F.next_query)+'</p>';
    if(e){const focused=focus?.evidence===e.id,start=focused?focus.start:e.start,end=focused?focus.end:Math.min(e.end,e.start+12),high=focused?focus.highlight:[];
      source='<header class="sr-source-header"><h3>源码依据</h3><span>'+start+'–'+end+' 行</span></header><div class="sr-codebox"><div class="sr-source-path">'+esc(e.repository+'/'+e.path)+'</div><div class="sr-code-lines">'+e.excerpt.split('\n').slice(start-e.start,end-e.start+1).map((line,i)=>'<div class="sr-code-row '+(high.includes(start+i)?'highlight':'')+'"><span>'+(start+i)+'</span><code>'+esc(line)+'</code></div>').join('')+'</div></div><p class="sr-meta">SHA256 '+esc(e.sha256.slice(0,12))+' · '+esc({current:'采集文件一致',changed:'源文件已变化',missing:'源文件缺失',unavailable:'无法核验'}[P.freshness.evidence[e.id]]||'未核验')+'</p><div class="sr-refs">'+refs.map(id=>'<button data-evidence="'+esc(id)+'" aria-pressed="'+(id===e.id)+'">'+esc(P.evidence[id].label)+'</button>').join('')+'</div>';
    }
    document.getElementById('sr-detail-content').innerHTML='<div class="sr-explanation">'+explanation+'</div><div class="sr-source">'+source+'</div>';
  }
  let lastFocus='';
  function syncSelection(){const relationship=A.focus.relationship(),active=A.focus.active();const key=JSON.stringify([relationship?.id,active]);if(key===lastFocus)return;lastFocus=key;
    if(relationship?.id?.match(/^e\d+$/)){selected={edge:Number(relationship.id.slice(1))};showDetail();}
    else if(typeof active==='string'&&reverseIds[active]){selected={node:reverseIds[active]};showDetail();}
  }
  new MutationObserver(syncSelection).observe(svg,{attributes:true,attributeFilter:['data-focus-active','data-relationship-pin-active','data-reach-active'],subtree:true});
  const sourceButton=document.createElement('button');sourceButton.className='sr-show-source';sourceButton.textContent='展开源码与证据';sourceButton.onclick=()=>document.getElementById('sr-detail').scrollIntoView({behavior:isReduced()?'instant':'smooth',block:'start'});
  document.getElementById('focus-chip').append(sourceButton);
  function openCanvas(){document.body.classList.add('sr-canvas-open');const b=document.getElementById('sr-toggle-canvas');b.setAttribute('aria-expanded','true');b.textContent='收起交互画布';A.view.sync();}
  document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b)return;
    if(b.dataset.case){sample=b.dataset.case;updateScenario();}
    else if(b.id==='sr-toggle-canvas'){const open=document.body.classList.toggle('sr-canvas-open');b.setAttribute('aria-expanded',String(open));b.textContent=open?'收起交互画布':'展开交互画布';A.view.sync();}
    else if(b.dataset.node){selected={node:b.dataset.node};A.focus.set(P.native_ids[selected.node],{toggle:false});A.view.reveal([P.native_ids[selected.node]],{includeNeighbors:true,reason:'focus'});showDetail();}
    else if(b.dataset.edge!==undefined){selected={edge:Number(b.dataset.edge)};A.focus.inspectRelationshipById('e'+selected.edge,{toggle:false});showDetail();}
    else if(b.dataset.evidence)showDetail(b.dataset.evidence);
    else if(b.id==='sr-focus-node'){openCanvas();A.focus.set(P.native_ids[selected.node],{toggle:false});A.view.reveal([P.native_ids[selected.node]],{includeNeighbors:true,reason:'focus'});board.scrollIntoView({behavior:isReduced()?'instant':'smooth',block:'center'});}
    else if(b.id==='sr-task'){const u=URL.createObjectURL(new Blob([JSON.stringify(P.task,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=u;a.download=F.id+'.task.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
  });
  try{const saved=sessionStorage.getItem('sr-scenario:'+S.report_digest);if(S.scenarios.some(s=>s.id===saved))sample=saved;}catch(_){}
  updateScenario();
  // The requested live flow is native Archify. Pause and reduced-motion remain native.
  let preference;try{preference=localStorage.getItem('archify-motion');}catch(_){}
  if(!preference&&!isReduced())A.motionGovernor.setMode('live',{persist:false});
})();
