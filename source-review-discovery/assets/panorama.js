(() => {
  'use strict';
  const P = JSON.parse(document.getElementById('panorama-payload').textContent);
  const A = window.Archify, board = document.querySelector('.diagram-container');
  const svg = board.querySelector('svg');
  const modules = new Map(P.modules.map(m => [m.id, m]));
  const findings = new Map(P.findings.map(f => [f.id, f]));
  const positionLabel = m => m.faults.some(id=>findings.get(id).verdict==='static_confirmed') ? '问题位置' : '待核定位置';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const statuses = {open:'待处理', needs_evidence:'待补证', pending_recheck:'待复查', resolved:'已修复', withdrawn:'已撤回', reopened:'重新打开'};
  const verdicts = {static_confirmed:'源码路径已确认', conditional:'条件待确认', design_question:'设计疑问', withdrawn:'已撤回'};
  let selected = null, query = '', filter = 'verified';
  const storageKey = 'sr-panorama:' + P.digest;
  const create = (tag, cls, html) => {const el = document.createElement(tag);el.className = cls;el.innerHTML = html;return el;};
  document.body.classList.add('sr-panorama');
  document.querySelector('[data-preset-badge-signal-flow]').setAttribute('data-preset-badge-signal-flow','目录地图');
  document.querySelector('.header').before(create('nav','panorama-context','<strong>Source Review</strong><span>'+esc(P.project)+'</span><a href="review.json" download>下载结果 JSON</a>'));
  document.querySelector('.subtitle').textContent = '从模块找到问题，再沿处理路径核对源码与验证结果。';
  const summary = create('section','panorama-summary','<span><b>'+P.file_count+'</b> 个源码文件</span><span><b>'+P.import_count+'</b> 处内部引用</span><span><b>'+P.findings.filter(f=>f.verified).length+'</b> 项已最小验证</span><span><b>'+P.findings.filter(f=>!f.verified).length+'</b> 项其他记录</span><span class="snapshot-note">源码快照 · 非运行拓扑</span>');
  const workspace = create('main','panorama-workspace','');
  const map = create('section','panorama-map','<div class="panorama-mapbar"><div><h2>模块与问题分布</h2><p>目录分区 · 选择模块查看问题、文件与静态引用</p></div><button id="show-all">全部问题</button></div>');
  const inspector = create('aside','panorama-inspector','');
  inspector.setAttribute('aria-label','模块与问题详情');
  board.before(summary,workspace);
  workspace.append(map,inspector);map.append(board);
  map.append(create('div','panorama-key','<span class="key-fault">问题位置</span><span class="key-pending">待核定位置</span><span class="key-related">关联证据</span><span class="key-unknown">其他源码</span><span>未标记 ≠ 已审查</span>'));
  map.append(create('div','panorama-module-list',P.groups.map(g=>'<section><h3>'+esc(g.source.title)+'</h3>'+g.modules.map(id=>{const m=modules.get(id);return '<button data-module="'+id+'"><span>'+esc(m.label)+'</span><small>'+m.files.length+' 文件 · '+(m.faults.length?m.faults.length+' 项'+positionLabel(m):m.findings.length?m.findings.length+' 项关联发现':'无关联发现')+'</small></button>';}).join('')+'</section>').join('')));
  const scope = P.runs.at(-1).coverage;
  workspace.after(create('details','panorama-coverage','<summary>审查范围与地图边界</summary><div class="coverage-columns"><section><h3>本轮检查</h3><ul>'+scope.checked.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></section><section><h3>排除与限制</h3><ul>'+[...scope.excluded,...scope.limitations,...P.coverage.limitations].map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul></section><section><h3>源码版本</h3>'+P.groups.map(g=>'<p>'+esc(g.source.title)+'<br><code>'+esc(g.source.revision.slice(0,12))+'</code></p>').join('')+'<p>未解析或排除的引用：'+P.coverage.unresolved_or_excluded_imports+'</p></section></div>'));
  document.querySelector('.container').append(create('footer','panorama-footer','<span>报告 '+esc(P.digest.slice(0,12))+'</span><span>目录描述结构；引用不代表执行顺序或已证实影响。</span>'));

  function activeFindings(ids) {
    return ids.map(id=>findings.get(id)).filter(f=>filter==='all'||(filter==='verified'?f.verified:!f.verified));
  }
  function findingRows(ids) {
    const rows=activeFindings(ids).filter(f=>(f.title+' '+f.impact).toLowerCase().includes(query));
    return rows.map(f=>'<article class="panorama-finding"><div class="finding-status"><span>'+esc(f.severity)+' · '+esc(statuses[f.state])+'</span><span class="'+(f.verified?'verified':'pending')+'">'+(f.verified?'最小验证已复现':esc(verdicts[f.verdict]))+'</span></div><a class="finding-title" data-open-finding="'+esc(f.id)+'" href="'+esc(f.href)+'">'+esc(f.title)+'</a><p>'+esc(f.presentation?.summary||f.impact)+'</p><div class="finding-modules">'+P.modules.filter(m=>m.faults.includes(f.id)).map(m=>'<button data-module="'+m.id+'">'+esc(m.label)+'</button>').join('')+'</div><a class="finding-open" data-open-finding="'+esc(f.id)+'" href="'+esc(f.href)+'">查看问题路径与证据 <span aria-hidden="true">→</span></a></article>').join('') || '<p class="panorama-empty">当前筛选下没有关联发现。未标记不表示已完成审查。</p>';
  }
  function relationList(m) {
    const relations = P.dependencies.filter(e=>e.from===m.id||e.to===m.id);
    if(!relations.length)return '<p class="panorama-empty">当前提取范围内没有跨模块引用；动态加载与外部依赖可能未覆盖。</p>';
    return relations.map(e=>{const target=modules.get(e.from===m.id?e.to:e.from);return '<details class="dependency-row"><summary><span>'+(e.from===m.id?'引用':'被引用于')+' <b>'+esc(target.label)+'</b></span><span>'+e.references.length+' 处</span></summary><button data-module="'+target.id+'">定位 '+esc(target.label)+'</button><ul>'+e.references.map(r=>'<li><code>'+esc(r.file||r.from)+':'+r.line+'</code><br>'+esc(r.specifier)+'</li>').join('')+'</ul></details>';}).join('');
  }
  function renderInspector() {
    const m=modules.get(selected);
    inspector.innerHTML='<header class="inspector-heading">'+(m?'<button id="back-to-findings">全部问题</button><h2>'+esc(m.label)+'</h2><p class="module-path">'+esc(m.path)+'</p><p>'+m.files.length+' 个文件 · '+m.loc.toLocaleString()+' 行 · '+m.findings.length+' 项关联发现</p>':'<h2>发现的问题</h2><p>优先查看已完成最小验证的记录。</p>')+'</header><div class="panorama-filters"><label for="panorama-filter">显示</label><select id="panorama-filter"><option value="verified">已最小验证</option><option value="pending">其他记录（含历史）</option><option value="all">全部记录</option></select><label class="visually-hidden" for="panorama-search">搜索问题</label><input id="panorama-search" type="search" placeholder="搜索问题或影响" value="'+esc(query)+'"></div><div id="panorama-findings">'+findingRows(m?m.findings:P.findings.map(f=>f.id))+'</div>'+(m?'<section class="module-dependencies"><h3>静态引用</h3>'+relationList(m)+'</section><details class="module-files"><summary>源码文件 · '+m.files.length+'</summary>'+m.files.map(f=>'<p><code>'+esc(f.repository_path)+'</code><span>'+f.loc+' 行</span></p>').join('')+'</details>':'<div class="panorama-hint"><b>从全景到证据</b><p>选模块定位相关发现；进入问题后，对照输入、处理与输出，再查看源码及验证边界。</p></div>');
    inspector.querySelector('#panorama-filter').value=filter;
  }
  const ns='http://www.w3.org/2000/svg';
  for(const m of P.modules) {
    const node=svg.querySelector('[data-node-id="'+m.id+'"]'),rect=node.querySelector('rect');
    const x=+rect.getAttribute('x'),y=+rect.getAttribute('y'),w=+rect.getAttribute('width');
    node.querySelectorAll(':scope>text').forEach(el=>el.remove());
    const g=document.createElementNS(ns,'g');g.setAttribute('pointer-events','none');g.classList.add('panorama-node-content');node.append(g);
    function text(value,dx,dy,size,cls='t-primary',weight=400) {const t=document.createElementNS(ns,'text');for(const [k,v]of Object.entries({x:x+dx,y:y+dy,'font-size':size,class:cls,'font-weight':weight}))t.setAttribute(k,v);t.textContent=value;g.append(t);return t;}
    const title=text(m.label,18,30,17,'t-primary',600);const measured=title.getComputedTextLength();if(measured>w-36)title.setAttribute('font-size',Math.max(11,17*(w-36)/measured));
    text(m.files.length+' 个文件 · '+m.loc.toLocaleString()+' 行',18,56,12,'t-muted');
    const label=m.faults.length?m.faults.length+' 项'+positionLabel(m):m.findings.length?m.findings.length+' 项关联发现':'无关联发现';
    text(label,18,87,13,'t-primary',500);
    const outgoing=P.dependencies.filter(e=>e.from===m.id).length;
    const incoming=P.dependencies.filter(e=>e.to===m.id).length;
    text('引用 '+outgoing+' · 被 '+incoming+' 个模块引用',18,110,12,'t-muted');
    node.setAttribute('data-node-tag',label);
  }

  function remember() {
    const state=A.view.state(),box=svg.viewBox.baseVal,w=svg.clientWidth,h=svg.clientHeight;
    const scale=Math.min(w/box.width,h/box.height);
    const camera=scale>0?{scale:state.scale,
      x:box.x+((w/2-state.x)/state.scale-(w-box.width*scale)/2)/scale,
      y:box.y+((h/2-state.y)/state.scale-(h-box.height*scale)/2)/scale}:null;
    try{sessionStorage.setItem(storageKey,JSON.stringify({selected,filter,query,camera,scrollY:window.scrollY}));}catch(_){}
  }
  function choose(id, focus=true) {
    if(id&&!modules.has(id))return;
    selected=id;renderInspector();
    if(focus&&id)A.focus.set(id,{toggle:false,updateUrl:false});
    if(!id)A.focus.clear();
    remember();
  }
  let lastFocus='';
  new MutationObserver(()=>{const id=A.focus.active();if(id===lastFocus)return;lastFocus=id;if(modules.has(id)&&id!==selected)choose(id,false);}).observe(svg,{attributes:true,attributeFilter:['data-focus-active'],subtree:true});
  // Capture before the native viewer clears focus/camera on an outside click.
  window.addEventListener('click',e=>{if(e.target.closest('[data-open-finding]'))remember();},true);
  document.addEventListener('click',e=>{
    const module=e.target.closest('[data-module]');
    if(module){choose(module.dataset.module);if(innerWidth<=760)inspector.scrollIntoView({block:'start'});return;}
    if(e.target.closest('#show-all,#back-to-findings')){choose(null);return;}
  });
  inspector.addEventListener('change',e=>{if(e.target.id==='panorama-filter'){filter=e.target.value;renderInspector();remember();}});
  inspector.addEventListener('input',e=>{if(e.target.id==='panorama-search'){query=e.target.value.toLowerCase();inspector.querySelector('#panorama-findings').innerHTML=findingRows(selected?modules.get(selected).findings:P.findings.map(f=>f.id));remember();}});
  let saved;
  try{saved=JSON.parse(sessionStorage.getItem(storageKey));}catch(_){}
  if(saved){selected=modules.has(saved.selected)?saved.selected:null;filter=['all','verified','pending'].includes(saved.filter)?saved.filter:'verified';query=typeof saved.query==='string'?saved.query:'';}
  const fromFinding=new URLSearchParams(location.hash.slice(1)).get('finding');
  if(!selected&&fromFinding)selected=P.modules.find(m=>m.faults.includes(fromFinding))?.id||null;
  renderInspector();
  if(selected)A.focus.set(selected,{toggle:false,updateUrl:false});
  // The upstream camera uses a transform, not SVG viewBox. Restore through its
  // public API after its initial focus-sync frame, retaining the logical center.
  requestAnimationFrame(()=>{
    const c=saved?.camera;
    if(c&&[c.x,c.y,c.scale].every(Number.isFinite))A.view.centerAt(c.x,c.y,{scale:c.scale,instant:true});
    if(Number.isFinite(saved?.scrollY))window.scrollTo(0,saved.scrollY);
  });
})();
