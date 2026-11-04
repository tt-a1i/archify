(() => {
  'use strict';
  const P = JSON.parse(document.getElementById('payload').textContent), R = P.report;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels = {static_confirmed:'代码路径已确认',conditional:'条件还需确认',design_question:'设计疑问',withdrawn:'已撤回',open:'待处理',needs_evidence:'待补证',pending_recheck:'待复查',resolved:'已修复',reopened:'重新打开',supported:'有依据',contradicted:'有反证',current:'采集文件一致',changed:'文件已变化',missing:'文件缺失',unavailable:'无法校验',discovered:'首次发现',present:'问题仍在',inconclusive:'复查未核定'};
  const dimensions = {contract:'预期行为',reachability:'触发路径',violation:'出错位置',impact:'影响范围',protections:'已有保护'};
  const evidence = Object.fromEntries(R.evidence.map(e=>[e.id,e]));
  const requestedFinding = new URLSearchParams(location.hash.slice(1)).get('finding');
  let selected = R.findings.find(f=>f.id===requestedFinding)?.id || R.findings[0]?.id, tab = 'proof', chosenEvidence = null, atlas = null;
  const verification = Object.fromEntries((R.verifications||[]).map(v=>[v.finding,v]));
  const verified = f => f.verdict==='static_confirmed' && verification[f.id]?.outcome==='reproduced' && P.freshness.verification?.[f.id] === true && !['resolved','withdrawn','pending_recheck'].includes(state(f));
  function download(name,value){const a=document.createElement('a'),u=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000);}
  function badge(label,cls=''){return '<span class="badge '+cls+'">'+esc(label)+'</span>';}
  function dot(state){return '<span class="proof-dot '+esc(state)+'" title="'+esc(labels[state]||'待补证')+'">'+(state==='supported'?'●':state==='open'?'◌':'×')+'</span>';}
  function refs(ids){return '<span class="refs">'+ids.map(id=>'<button class="ref" data-evidence="'+esc(id)+'">'+esc(evidence[id].path.split('/').pop())+':'+evidence[id].start+'</button>').join('')+'</span>';}
  function state(f){return P.states[f.id];}
  function setOverview(){
    $('#scope').textContent=R.project;
    const active=R.findings.filter(f=>!['resolved','withdrawn'].includes(state(f))).length;
    $('#headline').textContent=R.architecture?'先浏览系统，再展开有问题的模块。首页优先显示已完成最小验证的发现。':active+' 项问题值得继续处理：先看会发生什么，再查看代码依据和仍需确认的条件。';
    $('#run-label').textContent=R.runs.at(-1).id;
    $('#snapshot').innerHTML=R.runs.at(-1).sources.map(s=>'<span>'+esc(s.id)+' <code>'+esc(s.revision.slice(0,12))+'</code></span>').join('')+'<span>'+esc(R.runs.at(-1).label||'源码快照')+' · '+(R.verifications?.length?'发现后追加隔离验证；未启动完整产品':R.runs.at(-1).mode==='source'?'纯源码审查，未运行产品':'含运行验证')+'</span>';
    const stats=R.architecture?[[R.architecture.nodes.filter(n=>n.kind==='file').length,'个源码文件'],[R.architecture.edges.length,'条 import 关系'],[R.findings.filter(verified).length,'项最小验证复现'],[R.findings.filter(f=>!verified(f)&&!['resolved','withdrawn'].includes(state(f))).length,'项先收在待验证']]:[[R.findings.length,'项发现'],[R.findings.filter(f=>f.verdict==='static_confirmed').length,'项路径已确认'],[R.findings.filter(f=>['conditional','design_question'].includes(f.verdict)).length,'项条件待确认'],[R.findings.filter(f=>state(f)==='resolved').length,'项复查修复']];
    $('#summary').innerHTML=stats.map(([n,label])=>'<div class="stat"><strong>'+n+'</strong><span>'+label+'</span></div>').join('');
    $('#coverage').innerHTML=R.runs.map(r=>'<h3>'+esc(r.id)+'</h3><p>范围完整度：'+(r.coverage.status==='complete'?'声明范围已查完':'部分完成')+'；不代表全仓覆盖。</p><p>已查：'+esc(r.coverage.checked.join('、'))+'</p><p>未查：'+esc(r.coverage.excluded.join('、')||'未声明')+'</p><ul>'+r.coverage.limitations.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul><p>使用工具：'+esc(r.tools.join('、')||'未记录')+'</p><p>审查者：'+esc(r.reviewer)+'</p>').join('<hr>');
  }
  function queue(){
    const filter=$('#filter').value,query=$('#finding-search').value.trim().toLocaleLowerCase(),fs=R.findings.filter(f=>(filter==='all'||filter===f.verdict||(filter==='verified'&&verified(f))||(filter==='pending'&&!verified(f)&&!['resolved','withdrawn'].includes(state(f)))||(filter==='resolved'&&state(f)==='resolved')||(filter==='unresolved'&&!['resolved','withdrawn'].includes(state(f))))&&(!query||(f.title+' '+f.impact).toLocaleLowerCase().includes(query)));
    $('#finding-count').textContent=fs.length;
    const pending=R.findings.filter(f=>!verified(f)&&!['resolved','withdrawn'].includes(state(f))).length;
    $('#deferred-note').innerHTML=filter==='verified'&&pending?'<button id="show-pending">另有 '+pending+' 项待验证</button><p>保留源码判断及未验证原因。</p>':'';
    if(!fs.length){selected=null;chosenEvidence=null;detail();$('#queue').innerHTML='<p class="empty">没有符合筛选条件的问题。</p>';return;}
    if(!fs.some(f=>f.id===selected)){selected=fs[0].id;chosenEvidence=null;detail();}
    $('#queue').innerHTML=fs.map(f=>'<button class="issue-row '+(f.id===selected?'selected':'')+'" data-finding="'+f.id+'" aria-pressed="'+(f.id===selected)+'"><span class="issue-number">'+String(R.findings.indexOf(f)+1).padStart(2,'0')+'</span><span class="issue-copy"><strong>'+esc(f.title)+'</strong><span class="meta">'+esc(verified(f)?'最小验证已复现':labels[f.verdict])+' · '+esc(f.severity)+'</span></span></button>').join('');
  }
  function wrap(text,n){const tokens=text.match(/[A-Za-z0-9_.]+|./gu)||[],out=[];let line='',width=0;for(const token of tokens){const size=/^[\x00-\x7f]+$/.test(token)?token.length*.55:1;if(width+size>n&&line){out.push(line);line='';width=0;}line+=token;width+=size;}if(line)out.push(line);return out;}
  function graph(f){
    if(f.graph.comparison){
      const c=f.graph.comparison;
      return '<table class="comparison"><thead><tr>'+c.columns.map(s=>'<th>'+esc(s)+'</th>').join('')+'</tr></thead><tbody>'+c.rows.map(r=>'<tr class="'+(r.attention?'attention':'')+'">'+r.cells.map((s,i)=>'<td>'+esc(s)+(i===r.cells.length-1?refs(r.evidence):'')+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
    }
    const nodes=f.graph.nodes,main=nodes.filter(n=>n.role!=='guard'),guards=nodes.filter(n=>n.role==='guard');
    const cols=Math.min(4,main.length||1),w=800,bw=(w-40-(cols-1)*24)/cols,h=70,positions={};
    main.forEach((n,i)=>positions[n.id]={x:20+(i%cols)*(bw+24),y:30+Math.floor(i/cols)*108,w:bw});
    const guardY=30+Math.ceil(main.length/cols)*108;
    guards.forEach((n,i)=>positions[n.id]={x:20+(i%cols)*(bw+24),y:guardY+Math.floor(i/cols)*140,w:bw});
    if(nodes.every(n=>Number.isInteger(n.column)&&Number.isInteger(n.row))){
      const maxCol=Math.max(...nodes.map(n=>n.column)),cw=(w-40-maxCol*42)/(maxCol+1);
      nodes.forEach(n=>positions[n.id]={x:20+n.column*(cw+42),y:30+n.row*68,w:cw});
    }
    const height=Math.max(...Object.values(positions).map(p=>p.y))+h+12;
    const edges=f.graph.edges.map(e=>{
      const a=positions[e.from],b=positions[e.to];let x1=a.x+a.w,y1=a.y+h/2,x2=b.x,y2=b.y+h/2;
      if(a.x===b.x&&a.y!==b.y){x1=a.x+a.w/2;y1=a.y+(b.y>a.y?h:0);x2=b.x+b.w/2;y2=b.y+(b.y>a.y?0:h);}
      const cx=(x1+x2)/2,cy=a.y===b.y?a.y:(y1+y2)/2,color=e.basis==='source'?'#1d5fbf':e.basis==='unknown'?'#92400e':'#646464';
      return '<g><path d="M '+x1+' '+y1+' C '+cx+' '+y1+','+cx+' '+y2+','+x2+' '+y2+'" fill="none" stroke="'+color+'" stroke-width="1.5" '+(e.basis==='unknown'?'stroke-dasharray="2 4"':e.basis==='inference'?'stroke-dasharray="6 4"':'')+' marker-end="url(#arrow-'+e.basis+')"/><text class="edge-label" x="'+cx+'" y="'+(cy-9)+'" text-anchor="middle">'+esc(e.label)+'</text><title>'+esc(e.basis==='source'?'源码关系':e.basis==='inference'?'审查推导':'待证关系')+': '+esc(e.label)+'</title></g>';
    }).join('');
    const boxes=nodes.map(n=>{
      const p=positions[n.id],lines=wrap(n.title,Math.max(6,Math.floor((p.w-24)/13))),e=n.evidence[0];
      return '<g role="button" tabindex="0" class="'+esc(n.role)+' '+(e&&e===chosenEvidence?'chosen':'')+'" data-node="'+esc(n.id)+'" aria-label="查看证据：'+esc(n.title)+'"><rect x="'+p.x+'" y="'+p.y+'" width="'+p.w+'" height="'+h+'" rx="6"/>'+lines.slice(0,2).map((line,j)=>'<text class="node-title" x="'+(p.x+12)+'" y="'+(p.y+23+j*17)+'">'+esc(line)+'</text>').join('')+'<text class="node-meta" x="'+(p.x+12)+'" y="'+(p.y+58)+'">'+esc(n.role==='guard'?'正常路径 / 已有保护':n.role==='unknown'?'此条件还需确认':n.role==='failure'?'问题出在这里':'已核对代码')+ (n.role==='unknown'?'':' · 点击看源码')+'</text><title>'+esc(n.detail)+'</title></g>';
    }).join('');
    const mobile='<div class="mobile-graph">'+f.graph.edges.map(e=>{const a=nodes.find(n=>n.id===e.from),b=nodes.find(n=>n.id===e.to);return '<div class="mobile-edge"><button data-node="'+esc(a.id)+'" class="'+esc(a.role)+'">'+esc(a.title)+'</button><span>'+esc(e.label)+'<br>→<small>'+({source:'源码关系',inference:'审查推导',unknown:'待核定'}[e.basis])+'</small></span><button data-node="'+esc(b.id)+'" class="'+esc(b.role)+'">'+esc(b.title)+'</button></div>';}).join('')+'</div>';
    return '<svg class="graph" viewBox="0 0 800 '+height+'" aria-label="问题 '+esc(f.title)+' 的证据路径图"><defs>'+['source','inference','unknown'].map((type,i)=>'<marker id="arrow-'+type+'" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L8 4L0 8" fill="'+['#1d5fbf','#646464','#92400e'][i]+'"/></marker>').join('')+'</defs>'+edges+boxes+'</svg>'+mobile;
  }
  function proof(f){
    return '<table class="proof-table"><thead><tr><th>核对什么</th><th>进展</th><th>代码依据及解释</th></tr></thead><tbody>'+Object.entries(f.checks).map(([k,c])=>'<tr><td>'+dimensions[k]+'</td><td>'+dot(c.state)+' '+(c.state==='open'?'待补证':labels[c.state])+'</td><td>'+esc(c.reason)+refs(c.evidence)+'</td></tr>').join('')+'</tbody></table><p class="note">这里的判断来自源码审查，不代表线上已发生。引用校验只确认材料完整和文件版本一致。</p><div class="gaps"><h3>已检查的保护与反证</h3>'+f.counterevidence.map(c=>'<p>'+esc(c.reason)+'</p>'+refs(c.evidence)).join('')+'<h3 style="margin-top:14px">剩余未知 / 下一步</h3><ul>'+(f.gaps.map(g=>'<li>'+esc(g)+'</li>').join('')||'<li>当前静态结论无关键待证项；未推断现场发生频率。</li>')+'</ul><p>'+esc(f.next_query)+'</p></div>';
  }
  function history(f){
    return '<ol class="timeline">'+R.events.filter(e=>e.finding===f.id).map(e=>'<li><h3>'+esc(labels[e.outcome])+' '+(e.basis?badge(e.basis==='source'?'源码复查':'运行复验'):'')+'</h3><span class="time">'+esc(e.run)+' · '+esc(e.at)+'</span><p>'+esc(e.reason||'冻结原结论及源码证据；后续复查追加记录。')+'</p>'+refs(e.evidence||[])+(e.acceptance||[]).map(a=>'<p>'+esc(a.id)+' · '+esc(a.status)+' · '+esc(a.reason)+'</p>'+refs(a.evidence)).join('')+'</li>').join('')+'</ol><p class="note">改变文件、重跑无命中、跳过范围或工具出错，都不能自动标为已修复。</p>';
  }
  function action(f){
    const t=P.tasks[f.id],prompt=['使用 $source-review-discovery，读取导出的 '+f.id+'.task.json。','先校验证据和源码版本，按会话授权调查或修复。','完成后按 acceptance 逐项复查，追加新的 recheck 记录，生成下一版 HTML。'].join('\n');
    return '<h3>最小改进</h3><p style="margin-top:8px">'+esc(f.recommendation)+'</p><div class="gaps"><h3>复查验收</h3><ul>'+f.acceptance.map(a=>'<li><code>'+esc(a.id)+'</code> '+esc(a.text)+'</li>').join('')+'</ul></div><div class="instructions"><p>当前导出：'+(t.kind==='repair'?'修复候选任务':'补证调查任务')+'。导出不会开始修改源码。</p><p>在 Agent 会话中继续：</p><pre>'+esc(prompt)+'</pre><p>工具入口：<code>review_report.py recheck --report 基线.json --input 复查草稿.json --out 新版.json</code></p></div>';
  }
  function verificationPanel(f){
    const v=verification[f.id];
    if(!v)return '<p class="instructions">尚未进行最小验证。源码判断保留，不能当作已经复现。</p>';
    const label={reproduced:'在隔离边界中复现',not_reproduced:'本次未复现',inconclusive:'本次无法核定',deferred:'暂不验证'};
    if(v.outcome==='deferred')return '<div class="verification-result"><h3>先保留调查，不进入首页</h3><p>'+esc(v.reason)+'</p><ul>'+v.limitations.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul></div>';
    const format=x=>typeof x==='object'?Object.entries(x).map(([k,v])=>({report:'普通报告指标数',interpretation:'智能解读指标数',thrown:'抛出错误',typed_failure:'保留结构化失败'}[k]||k)+'：'+(typeof v==='boolean'?(v?'是':'否'):v)).join('；'):String(x);
    return '<div class="verification-result"><h3>'+esc(label[v.outcome])+(P.freshness.verification?.[f.id]?'':' · 源码已变化或无法校验')+'</h3><p>'+esc(v.claim)+'</p><table class="comparison"><thead><tr><th>验证输入</th><th>实际执行结果</th></tr></thead><tbody>'+(v.cases||[]).map(c=>'<tr class="'+(c.kind==='trigger'?'attention':'')+'"><td>'+esc(c.name)+'<small>'+ (c.kind==='control'?'正常对照':'触发条件')+'</small></td><td>'+esc(format(c.actual))+'</td></tr>').join('')+'</tbody></table><p class="note">用例通过表示观察到了预设的行为；不表示产品没有缺陷。</p><h3>验证到哪里</h3><ul>'+v.limitations.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul><details><summary>执行方式、隔离条件与原始记录</summary><ul>'+v.isolation.map(s=>'<li>'+esc(s)+'</li>').join('')+'</ul><pre>'+esc(v.command.join(' '))+'</pre><p>'+esc(v.at)+' · '+esc(v.duration_seconds)+' 秒 · exit '+esc(v.execution.exit_code)+'</p><pre>'+esc(v.execution.stdout)+'\n'+esc(v.execution.stderr)+'</pre><p>执行脚本和源码 SHA256 已保存在报告 JSON 中。</p></details><button data-verification="'+f.id+'">下载验证记录与代码</button></div>';
  }
  function detail(){
    const f=R.findings.find(f=>f.id===selected);
    if(atlas){atlas.renderDetail(f);return;}
    if(!f){$('#detail').innerHTML='<p class="empty">当前筛选没有问题记录。可切换筛选，并查看已查范围和覆盖缺口。</p>';return;}
    const present=f.presentation?{...f.presentation}:{summary:f.impact,condition:f.trigger,caption:'关系由审查者根据源码整理；点击节点查看支撑代码。'};
    if(state(f)==='resolved')present.caption='原问题路径（保留作对照）。最新修复依据见处理记录。 '+present.caption;
    const kind={data_flow:'同一份数据，两种处理结果',comparison:'把不一致的两边放在一起看',failure_window:'失败可能发生在哪个环节',decision_flow:'错误提示是怎样产生的'};
    $('#detail').innerHTML='<div class="detail-head"><div class="eyebrow"><button class="mobile-back tertiary" id="back">← 问题列表</button>'+badge(verified(f)?'最小验证已复现':labels[f.verdict],f.verdict==='conditional'?'warning':'')+badge(labels[state(f)],state(f)==='resolved'?'good':'')+'<span>优先级 '+f.severity+'</span></div><h2>'+esc(f.title)+'</h2><p class="plain-summary">'+esc(present.summary)+'</p><div class="actions"><button class="primary" id="export-task">'+(P.tasks[f.id].kind==='repair'?'下载修复任务':'下载调查任务')+'</button><button id="show-history">查看处理记录</button><span class="small muted">不代表线上已经发生；验证边界在下方说明</span></div></div><div class="detail-body"><p class="condition"><strong>什么时候会发生</strong>'+esc(present.condition)+'</p><div class="diagram-heading"><h3>'+esc(kind[f.graph.kind]||'问题经过')+'</h3></div><div class="graph-frame">'+graph(f)+'</div><p class="diagram-caption">'+esc(present.caption)+'</p><div class="explanation"><p><strong>影响到哪里</strong>'+esc(f.impact)+'</p></div><div class="tabs" role="tablist" aria-label="问题详情">'+[...(R.verifications?[['verification','最小验证']]:[]),['proof','源码依据'],['history','处理记录'],['action','修复建议']].map(([id,label])=>'<button role="tab" aria-selected="'+(tab===id)+'" data-tab="'+id+'">'+label+'</button>').join('')+'</div><div id="tab-panel" role="tabpanel">'+(tab==='verification'?verificationPanel(f):tab==='proof'?proof(f):tab==='history'?history(f):action(f))+'</div><div id="evidence"></div></div>';
    const oldEvidence=$('#detail #evidence');if(oldEvidence)oldEvidence.remove();
    if(chosenEvidence)showEvidence(chosenEvidence,false);
  }
  function showEvidence(id,scroll=true){
    const e=evidence[id];if(!e)return;chosenEvidence=id;const s=P.freshness.evidence[id];
    $('#source-drawer').hidden=false;
    $('#evidence').innerHTML='<section class="evidence" aria-label="源码证据"><div class="evidence-head"><div><h3>'+esc(e.label)+'</h3><p>'+esc(e.repository)+'/'+esc(e.path)+':'+e.start+'–'+e.end+'</p><p class="hash">'+esc(e.run)+' · SHA256 '+esc(e.sha256.slice(0,16))+'…</p><p class="hash">'+esc(labels[s])+' · 校验于 '+esc(P.freshness.checked_at)+'；非实时监控</p></div><button id="copy-location" data-copy="'+esc(e.repository+'/'+e.path+':'+e.start)+'">复制位置</button></div><pre>'+esc(e.excerpt.split('\n').map((line,i)=>String(e.start+i).padStart(4)+'  '+line).join('\n'))+'</pre></section>';
    if(scroll)$('#close-source').focus({preventScroll:true});
  }
  document.addEventListener('click',async ev=>{
    const b=ev.target.closest('button,[data-node]');if(!b)return;
    if(b.dataset.finding){selected=b.dataset.finding;chosenEvidence=null;$('#source-drawer').hidden=true;tab=atlas?'overview':verification[selected]?'verification':'proof';if(!verified(R.findings.find(f=>f.id===selected))&&$('#filter').value==='verified')$('#filter').value='all';$('.workspace').classList.add('detail-open');queue();if(atlas)atlas.focusFinding(selected);else{showView('issues');detail();}if(innerWidth<=800)$(atlas?'.work-area':'#detail').scrollIntoView({block:'start'});}
    else if(b.dataset.evidence)showEvidence(b.dataset.evidence);
    else if(b.dataset.node){const f=R.findings.find(f=>f.id===selected),n=f.graph.nodes.find(n=>n.id===b.dataset.node);if(n.evidence.length)showEvidence(n.evidence[0]);else {$('#source-drawer').hidden=false;$('#evidence').innerHTML='<div class="reader-body"><h3>这个条件还需核定</h3><p>'+esc(n.detail)+'</p><p>当前没有直接证据；下一步：'+esc(f.next_query)+'</p></div>';$('#close-source').focus({preventScroll:true});}}
    else if(b.dataset.tab){tab=b.dataset.tab;detail();}
    else if(b.id==='export-report')download('source-review.json',R);
    else if(b.id==='show-pending'){$('#filter').value='pending';queue();if(atlas)atlas.focusFinding(selected);}
    else if(b.id==='close-source'){$('#source-drawer').hidden=true;}
    else if(b.id==='export-task')download(selected+'.task.json',P.tasks[selected]);
    else if(b.dataset.verification)download(b.dataset.verification+'.verification.json',verification[b.dataset.verification]);
    else if(b.id==='show-history'){tab='history';detail();$('#tab-panel').scrollIntoView({block:'nearest',behavior:'smooth'});}
    else if(b.id==='back'||b.id==='mobile-back'){$('.workspace').classList.remove('detail-open');$('.queue').scrollIntoView({block:'start'});}
    else if(b.id==='copy-location'){try{await navigator.clipboard.writeText(b.dataset.copy);b.textContent='已复制';}catch{b.textContent='请选中上方路径复制';}}
  });
  document.addEventListener('keydown',ev=>{if(ev.target.matches('[data-node]')&&['Enter',' '].includes(ev.key)){ev.preventDefault();ev.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
  function showView(view){if(atlas)atlas.showView(view==='issues'?'process':'map');}
    /* ARCHITECTURE_JS */
  if(R.verifications){$('#filter').insertAdjacentHTML('afterbegin','<option value="verified">已最小验证</option><option value="pending">待验证</option>');$('#filter').value='verified';tab='verification';}
  function refreshQueue(){queue();if(atlas)atlas.focusFinding(selected);}
  $('#filter').addEventListener('change',refreshQueue);$('#finding-search').addEventListener('input',refreshQueue);
  document.addEventListener('keydown',ev=>{if(ev.key==='Escape')$('#source-drawer').hidden=true;});
  if(requestedFinding)$('#filter').value='all';
  setOverview();queue();detail();if(R.architecture&&!requestedFinding)initAtlas();
})();
