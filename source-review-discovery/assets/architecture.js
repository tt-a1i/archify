  function initAtlas(){
    const A=R.architecture, byId=new Map(A.nodes.map(n=>[n.id,n])), children=new Map(), fileCache=new Map();
    const sourceOf=new Map(A.sources.map(s=>[s.id,s]));
    A.nodes.forEach(n=>{if(n.parent)children.set(n.parent,[...(children.get(n.parent)||[]),n.id]);});
    function files(id){
      if(fileCache.has(id))return fileCache.get(id);
      const n=byId.get(id),value=n?.kind==='file'?[id]:(children.get(id)||[]).flatMap(files);
      fileCache.set(id,value);return value;
    }
    const fileByPath=new Map(A.nodes.filter(n=>n.kind==='file').map(n=>[n.repository+'/'+n.repository_path,n.id]));
    const findingFiles=new Map(),faultFiles=new Map();
    for(const f of R.findings){
      const ids=[...Object.values(f.checks).flatMap(c=>c.evidence),...f.counterevidence.flatMap(c=>c.evidence)];
      const locate=ids=>new Set(ids.map(id=>evidence[id]).filter(Boolean).map(e=>fileByPath.get(e.repository+'/'+e.path)).filter(Boolean));
      findingFiles.set(f.id,locate(ids));faultFiles.set(f.id,locate(f.checks.violation.evidence));
    }
    function related(id){const fs=new Set(files(id));return R.findings.filter(f=>[...findingFiles.get(f.id)].some(x=>fs.has(x)));}
    function group(id,label,members,parent,source){
      byId.set(id,{id,label,parent,source,path:'',kind:'group'});children.set(id,members);return byId.get(id);
    }
    function direct(id){
      const ns=(children.get(id)||[]).map(i=>byId.get(i)),leaves=ns.filter(n=>n.kind==='file');
      return [...ns.filter(n=>n.kind!=='file'),...(leaves.length?[group(id+'::files','本层文件',leaves.map(n=>n.id),id,byId.get(id).source)]:[])];
    }
    const entries=A.sources.map(s=>{
      const id=byId.has(s.id+':'+s.entry)?s.id+':'+s.entry:s.id+':';
      const inside=new Set(files(id)),outside=files(s.id+':').filter(i=>!inside.has(i));
      let nodes=direct(id);
      if(outside.length)nodes.push(group(s.id+'::outside','其他源码',outside,s.id+':',s.id));
      nodes.sort((a,b)=>related(b.id).filter(verified).length-related(a.id).filter(verified).length||files(b.id).length-files(a.id).length||a.id.localeCompare(b.id));
      if(nodes.length>5)nodes=[...nodes.slice(0,4),group(s.id+'::more','其余 '+(nodes.length-4)+' 个模块',nodes.slice(4).map(n=>n.id),id,s.id)];
      return {source:s,id,nodes};
    });
    let root=null,chosen=null,focused=selected,focusOnly=true,mode='map',visible=[],pairs=[],zoom=1,pan={x:0,y:0},width=880,height=740;
    const svg=$('#architecture-map'),number=f=>String(R.findings.indexOf(f)+1).padStart(2,'0');
    document.body.classList.add('atlas-app');
    $('.title-row h1')?.remove();
    $('.queue h2').outerHTML='<h1>发现的问题</h1>';
    $('#map-inspector').append($('#detail'));
    $('#atlas').hidden=false;$('#view-switch').hidden=false;
    $('#map-title').outerHTML='<h1 id="map-title">系统全景</h1>';
    const hits=(set,id)=>files(id).some(i=>set?.has(i));
    function marker(id){
      if(!focused)return '';
      const f=R.findings.find(f=>f.id===focused);
      if(hits(faultFiles.get(focused),id))return f.checks.violation.state==='supported'?'fault':'uncertain';
      return hits(findingFiles.get(focused),id)?'related':'';
    }
    function sourceLinks(ids){
      const seen=new Set();
      return ids.filter(id=>{const e=evidence[id],key=e.repository+'/'+e.path+':'+e.start;if(seen.has(key))return false;seen.add(key);return true;}).map(id=>{
        const e=evidence[id],node=fileByPath.get(e.repository+'/'+e.path);
        return '<div class="location-row"><div><strong>'+esc(e.path.split('/').pop())+':'+e.start+'</strong><span>'+esc(e.path)+'</span></div><div class="location-actions">'+(node?'<button data-locate="'+esc(node)+'">定位</button>':'')+'<button data-evidence="'+esc(id)+'">源码</button></div></div>';
      }).join('');
    }
    function compactProof(f){
      return Object.entries(f.checks).map(([key,c])=>'<details class="proof-section"><summary><span>'+dimensions[key]+'</span><span class="proof-status '+c.state+'">'+(c.state==='open'?'待补证':labels[c.state])+'</span></summary><p>'+esc(c.reason)+'</p>'+refs(c.evidence)+'</details>').join('')+
        '<details class="proof-section"><summary>已有保护与反证</summary>'+f.counterevidence.map(c=>'<p>'+esc(c.reason)+'</p>'+refs(c.evidence)).join('')+'</details>'+
        '<div class="reader-section"><h3>仍需确认</h3><ul>'+(f.gaps.map(s=>'<li>'+esc(s)+'</li>').join('')||'<li>当前源码论证无关键待证项；尚未推断线上发生频率。</li>')+'</ul><p>'+esc(f.next_query)+'</p></div>';
    }
    function renderDetail(f){
      if(!f){$('#detail').innerHTML='<div class="reader-empty"><h2>没有符合筛选的记录</h2><p>可更换筛选或搜索词。地图仍保留已提取的系统结构。</p></div>';return;}
      const verifiedLabel=verified(f)?'最小验证已复现':labels[f.verdict];
      const overview='<div class="reader-section"><h3>什么时候发生</h3><p>'+esc(f.presentation?.condition||f.trigger)+'</p></div>'+
        '<div class="reader-section"><h3>会影响什么</h3><p>'+esc(f.impact)+'</p></div>'+
        '<div class="reader-section"><h3>'+(f.checks.violation.state==='supported'?'偏差定位':'待核定的位置')+'</h3>'+sourceLinks(f.checks.violation.evidence)+'</div>'+
        '<button class="process-link" data-process>展开问题经过 <span aria-hidden="true">→</span></button>';
      const tabs=[['overview','说明'],['proof','证据'],...(R.verifications?[['verification','验证']]:[]),['action','修复']];
      $('#detail').innerHTML='<header class="reader-head"><div class="reader-meta"><span>问题 '+number(f)+'</span><span>'+esc(f.severity)+' · '+esc(labels[state(f)])+'</span></div><h2>'+esc(f.title)+'</h2><p>'+esc(f.presentation?.summary||f.impact)+'</p><div class="reader-status '+(verified(f)?'reproduced':'pending')+'"><i></i>'+esc(verifiedLabel)+'</div></header>'+
        '<div class="reader-tabs tabs" role="tablist" aria-label="问题资料">'+tabs.map(([id,label])=>'<button role="tab" aria-selected="'+(tab===id)+'" data-tab="'+id+'">'+label+'</button>').join('')+'</div>'+
        '<div id="tab-panel" class="reader-body" role="tabpanel">'+(tab==='overview'?overview:tab==='proof'?compactProof(f):tab==='verification'?verificationPanel(f):tab==='history'?history(f):action(f))+'</div>'+
        '<div class="reader-footer"><button id="export-task">'+(P.tasks[f.id].kind==='repair'?'导出修复任务':'导出调查任务')+'</button><button id="show-history" class="tertiary">处理记录</button></div>';
    }
    function moduleDetail(n){
      const fs=related(n.id),visibleFindings=fs.filter(f=>verified(f)||$('#filter').value!=='verified');
      const edges=pairs.filter(e=>e.from===n.id||e.to===n.id);
      $('#detail').innerHTML='<header class="reader-head"><div class="reader-meta">模块 / 文件</div><h2>'+esc(n.label)+'</h2><p class="path">'+esc(n.path||sourceOf.get(n.source)?.title||'模块分组')+'</p><div class="module-facts">'+files(n.id).length+' 个文件 · '+visibleFindings.length+' 项当前可见的关联发现</div><button data-drill="'+esc(n.id)+'">'+(n.kind==='file'?'查看相邻文件':'展开内部结构')+'</button></header>'+
        '<div class="reader-body"><div class="reader-section"><h3>关联问题</h3>'+(visibleFindings.length?visibleFindings.map(f=>'<button class="module-finding" data-finding="'+f.id+'"><span>'+number(f)+'</span>'+esc(f.title)+'</button>').join(''):'<p>当前筛选下没有关联发现。结构已提取，不表示这里已完成审查。</p>')+'</div><div class="reader-section"><h3>当前层级的依赖</h3>'+(edges.length?edges.map(e=>'<button class="dependency-row" data-map-edge="'+esc(e.key)+'"><span>'+(e.from===n.id?'引用 ':'被引用于 ')+esc(byId.get(e.from===n.id?e.to:e.from).label)+'</span><span>'+e.items.length+'</span></button>').join(''):'<p>当前层级没有可解析的外部 import。可以继续展开内部结构。</p>')+'</div><p class="note">问题关联来自证据引用，不代表这些文件都存在偏差。</p></div>';
    }
    function edgeDetail(edge){
      if(!edge)return;
      $('#detail').innerHTML='<header class="reader-head"><h2>模块依赖</h2><p>'+esc(byId.get(edge.from).label)+' → '+esc(byId.get(edge.to).label)+'</p><div class="module-facts">'+edge.items.length+' 条静态 import</div></header><div class="reader-body"><p>箭头从引用方指向被引用方；不表示业务执行顺序。</p><ol class="import-list">'+edge.items.map(e=>'<li><code>'+esc(byId.get(e.file).repository_path||byId.get(e.file).path)+':'+e.line+'</code><p>'+esc(e.specifier)+(e.type_only?' · 仅类型':'')+(e.lazy?' · 局部导入':'')+'</p></li>').join('')+'</ol></div>';
    }
    function collectPairs(){
      const fileVisible=new Map();visible.forEach(n=>files(n.id).forEach(f=>fileVisible.set(f,n.id)));
      const bundled=new Map();
      for(const e of A.edges){const from=fileVisible.get(e.from),to=fileVisible.get(e.to);if(!from||!to||from===to)continue;const key=from+'→'+to;if(!bundled.has(key))bundled.set(key,{key,from,to,items:[]});bundled.get(key).items.push(e);}
      pairs=[...bundled.values()];
    }
    function dependencyLines(){
      const positions=new Map(visible.map(n=>[n.id,n]));
      const shown=pairs.filter(e=>focusOnly&&focused||chosen&&(e.from===chosen||e.to===chosen));
      return shown.map(e=>{
        const a=positions.get(e.from),b=positions.get(e.to),sameRow=a.y===b.y,forward=b.x>a.x;
        let x1,y1,x2,y2,d,lx,ly;
        if(sameRow){
          x1=a.x+(forward?a.w:0);y1=a.y+a.h/2+(forward?-9:9);x2=b.x+(forward?0:b.w);y2=b.y+b.h/2+(forward?-9:9);
          const mid=(x1+x2)/2;d='M'+x1+','+y1+' H'+mid+' V'+y2+' H'+x2;lx=mid;ly=y1+(forward?-9:19);
        }else{
          const down=b.y>a.y,offset=down?-50:50;x1=a.x+a.w/2+offset;y1=a.y+(down?a.h:0);x2=b.x+b.w/2+offset;y2=b.y+(down?0:b.h);
          const mid=(y1+y2)/2;d='M'+x1+','+y1+' V'+mid+' H'+x2+' V'+y2;lx=(x1+x2)/2;ly=mid-8;
        }
        return '<g class="dependency" data-map-edge="'+esc(e.key)+'" role="button" tabindex="0" aria-label="'+esc(a.label+' 引用 '+b.label+'，'+e.items.length+' 条 import')+'"><path class="edge-hit" d="'+d+'"/><path class="edge-ink" d="'+d+'" marker-end="url(#import-arrow)"/><text class="dependency-label" x="'+lx+'" y="'+ly+'" text-anchor="middle">'+e.items.length+' 处引用</text><title>'+esc(a.label+' → '+b.label+'；点击查看实际 import 位置')+'</title></g>';
      }).join('');
    }
    function nodeBoxes(){
      return visible.map(n=>{
        const mark=marker(n.id),f=R.findings.find(f=>f.id===focused),names=wrap(n.label,Math.floor((n.w-32)/16)),nodeFiles=new Set(files(n.id));
        const positions=f?f.checks.violation.evidence.map(id=>evidence[id]).filter(e=>nodeFiles.has(fileByPath.get(e.repository+'/'+e.path))):[];
        const spot=positions[0],path=n.path||sourceOf.get(n.source)?.title||'模块分组';
        const badge=mark==='fault'?'偏差位置':mark==='uncertain'?'待核定':mark==='related'?'关联代码':'';
        const fullLocator=spot?spot.path.split('/').pop()+':'+spot.start:files(n.id).length+' 个文件',limit=Math.floor((n.w-(badge?100:32))/6.8);
        const locator=fullLocator.length>limit?fullLocator.slice(0,limit-1)+'…':fullLocator;
        return '<g class="module-node file-node '+mark+' '+(n.id===chosen?'selected':'')+'" role="button" tabindex="0" data-module="'+esc(n.id)+'" aria-label="'+esc(n.label+'，'+badge+'，'+locator)+'"><rect x="'+n.x+'" y="'+n.y+'" width="'+n.w+'" height="'+n.h+'" rx="8"/>'+names.slice(0,2).map((s,i)=>'<text class="module-title" x="'+(n.x+16)+'" y="'+(n.y+26+i*18)+'">'+esc(s)+'</text>').join('')+'<text class="module-path" x="'+(n.x+16)+'" y="'+(n.y+62)+'">'+esc(path.length>36?path.slice(0,34)+'…':path)+'</text><text class="module-meta" x="'+(n.x+16)+'" y="'+(n.y+n.h-15)+'">'+esc(locator)+'</text>'+(badge?'<text class="node-role" x="'+(n.x+n.w-13)+'" y="'+(n.y+n.h-15)+'" text-anchor="end">'+badge+'</text>':'')+'<title>'+esc(path)+'；点击查看，双击展开</title></g>';
      }).join('');
    }
    function layoutGroups(groups){
      const mobile=innerWidth<=800; width=mobile?380:880;let y=24,backgrounds='';visible=[];
      for(const entry of groups){
        if(!entry.nodes.length)continue;
        const cols=mobile?1:Math.min(3,entry.nodes.length),nodeWidth=mobile?316:cols===1?480:cols===2?338:248;
        const pitch=mobile?148:150,gap=mobile?0:cols===2?94:28,rows=Math.ceil(entry.nodes.length/cols),groupHeight=72+rows*pitch;
        const rowWidth=cols*nodeWidth+(cols-1)*gap,startX=(width-rowWidth)/2;
        entry.nodes.forEach((n,i)=>visible.push({...n,x:startX+(i%cols)*(nodeWidth+gap),y:y+64+Math.floor(i/cols)*pitch,w:nodeWidth,h:108}));
        backgrounds+='<g class="source-region"><rect class="system-boundary" x="'+(mobile?12:22)+'" y="'+y+'" width="'+(width-(mobile?24:44))+'" height="'+groupHeight+'" rx="10"/><text class="system-title" x="'+(mobile?28:44)+'" y="'+(y+28)+'">'+esc(entry.title)+'</text><text class="system-meta" x="'+(mobile?28:44)+'" y="'+(y+47)+'">'+esc(entry.subtitle)+'</text></g>';
        y+=groupHeight+(mobile?26:46);
      }
      height=Math.max(mobile?360:360,y);
      collectPairs();
      return backgrounds+'<g id="dependency-layer">'+dependencyLines()+'</g>'+nodeBoxes();
    }
    function overview(){
      const groups=entries.map(entry=>({title:entry.source.title,subtitle:entry.source.entry+' · '+(focusOnly&&focused?'当前问题关联的模块':'源码模块，可继续展开'),nodes:entry.nodes.filter(n=>!focusOnly||!focused||marker(n.id))})).filter(e=>e.nodes.length);
      return layoutGroups(groups.length?groups:entries.map(entry=>({title:entry.source.title,subtitle:entry.source.entry,nodes:entry.nodes})));
    }
    function inner(){
      const n=byId.get(root);
      let ids=n.kind==='file'?[...new Set([root,...A.edges.filter(e=>e.from===root||e.to===root).map(e=>e.from===root?e.to:e.from)])]:(children.get(root)||[]);
      ids=ids.slice().sort((a,b)=>Number(Boolean(marker(b)))-Number(Boolean(marker(a)))||byId.get(a).label.localeCompare(byId.get(b).label));
      return layoutGroups([{title:n.label,subtitle:n.path||sourceOf.get(n.source)?.title||'模块内部',nodes:ids.map(id=>byId.get(id))}]);
    }
    function camera(){svg.setAttribute('viewBox',pan.x+' '+pan.y+' '+width/zoom+' '+height/zoom);$('#map-fit').textContent=zoom===1?'适应':Math.round(zoom*100)+'%';}
    function draw(){
      const body=root?inner():overview();
      svg.innerHTML='<defs><marker id="import-arrow" viewBox="0 0 8 8" refX="8" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L8 4L0 8" fill="#89939e"/></marker></defs>'+body;
      svg.classList.toggle('inner-map',Boolean(root));svg.style.minHeight=(innerWidth<=800?height:Math.max(360,height*.82))+'px';
      const ancestors=[];for(let n=root&&byId.get(root);n;n=byId.get(n.parent))if(n.kind!=='group')ancestors.unshift(n);
      $('#breadcrumbs').innerHTML='<button data-home>系统</button>'+ancestors.map(n=>'<span>/</span><button data-drill="'+esc(n.id)+'">'+esc(n.label)+'</button>').join('');
      $('#map-title').textContent=root?byId.get(root).label:focusOnly&&focused?'问题关联架构':'系统分区';
      $('#map-guide').textContent=root?'点击看证据；展开看内部结构':focusOnly&&focused?'仅显示当前问题涉及的模块，连线表示静态引用':'按源码区域展开；点击模块查看相邻依赖';
      $('#mobile-subject').textContent=focused?R.findings.find(f=>f.id===focused).title:'浏览系统结构';
      $('#map-focus').disabled=!focused;
      $('#map-overview').setAttribute('aria-pressed',!focusOnly&&!root);
      $('#map-focus').setAttribute('aria-pressed',focusOnly&&!root);
      $('#view-context').textContent=focused?'已定位问题 '+number(R.findings.find(f=>f.id===focused)):'系统结构';
      camera();
      if(chosen)moduleDetail(byId.get(chosen));else renderDetail(R.findings.find(f=>f.id===focused));
    }
    function process(){
      const f=R.findings.find(f=>f.id===focused);
      $('#process-view').innerHTML=f?'<div class="process-heading"><h1>'+esc(f.title)+'</h1><p>'+esc(f.presentation?.summary||f.impact)+'</p></div><div class="process-diagram graph-frame">'+graph(f)+'</div><p class="process-caption">'+esc(f.presentation?.caption||'根据源码整理的解释；点击节点查看依据。')+'</p><div class="process-reading"><h3>阅读这张图</h3><p>'+esc(f.graph.comparison?'按行比较两侧的实际处理，红色文字标出不一致。':f.graph.kind==='failure_window'?'沿步骤看失败窗口，再核查已有恢复渠道。':'从输入沿箭头读到结果，红框标出偏差发生的步骤。')+'</p>'+(f.graph.comparison?'':'<p>实线：源码直接关系 · 虚线：审查推导 · 点线：待核定条件</p>')+'</div>':'<div class="reader-empty"><h1>先选择一个问题</h1><p>左侧保留当前范围的问题记录。</p></div>';
    }
    function showMode(value){
      mode=value;$('#map-viewport').hidden=mode!=='map';$('#process-view').hidden=mode!=='process';$('.map-guide').hidden=mode!=='map';$('#map-legend').hidden=mode!=='map';
      $('.atlas-toolbar').hidden=mode!=='map';$('.map-coverage').hidden=mode!=='map';
      $('#view-map').setAttribute('aria-pressed',mode==='map');$('#view-issues').setAttribute('aria-pressed',mode==='process');
      if(mode==='process'){process();renderDetail(R.findings.find(f=>f.id===focused));}
    }
    function drill(id){if(!byId.has(id))return;root=id;chosen=null;zoom=1;pan={x:0,y:0};showMode('map');draw();$('#map-viewport').scrollTop=0;}
    function home(){root=null;chosen=null;focusOnly=false;zoom=1;pan={x:0,y:0};showMode('map');draw();}
    function focusFinding(id){focused=id;focusOnly=true;root=null;chosen=null;tab='overview';zoom=1;pan={x:0,y:0};showMode('map');draw();}
    atlas={focusFinding,renderDetail,showView:showMode};
    $('#view-map').onclick=()=>showMode('map');$('#view-issues').onclick=()=>showMode('process');
    const count=A.nodes.filter(n=>n.kind==='file').length;
    $('#map-coverage-label').textContent=count.toLocaleString()+' 文件 · '+A.edges.length.toLocaleString()+' 条已解析 import · 查看覆盖范围';
    $('#map-coverage-body').innerHTML='<p>结构提取不等于问题审查。未解析或目标被排除的 import：'+A.coverage.unresolved_or_excluded_imports.toLocaleString()+' 条。</p><p>'+A.coverage.limitations.map(esc).join('<br>')+'</p><p>'+A.sources.map(s=>esc(s.title)+'：'+esc(s.revision.slice(0,12))).join('<br>')+'</p><p>模块位置仅用于布局，距离不表示耦合强度；聚合连线的数量可点击查看。HTTP、消息及动态调用没有被推断为静态 import。</p>';
    $('#atlas').addEventListener('click',e=>{
      const t=e.target.closest('[data-module],[data-drill],[data-home],[data-map-edge],[data-locate],[data-process],button');if(!t)return;
      if(t.dataset.module){chosen=t.dataset.module;svg.querySelectorAll('[data-module]').forEach(el=>el.classList.toggle('selected',el.dataset.module===chosen));$('#dependency-layer').innerHTML=dependencyLines();moduleDetail(byId.get(chosen));}
      else if(t.dataset.drill)drill(t.dataset.drill);
      else if(t.dataset.locate){const n=byId.get(t.dataset.locate);drill(n.parent);chosen=n.id;draw();}
      else if(t.hasAttribute('data-process'))showMode('process');
      else if(t.hasAttribute('data-home')||t.id==='map-overview')home();
      else if(t.id==='map-focus'){focusOnly=true;root=null;chosen=null;zoom=1;pan={x:0,y:0};draw();}
      else if(t.dataset.mapEdge)edgeDetail(pairs.find(p=>p.key===t.dataset.mapEdge));
      else if(t.id==='map-plus'||t.id==='map-minus'){zoom=Math.max(.5,Math.min(3,zoom*(t.id==='map-plus'?1.25:.8)));camera();}
      else if(t.id==='map-fit'){zoom=1;pan={x:0,y:0};camera();}
    });
    $('#atlas').addEventListener('dblclick',e=>{const n=e.target.closest('[data-module]');if(n)drill(n.dataset.module);});
    $('#atlas').addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)&&e.target.matches('g[role=button]')){e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}});
    let drag;
    svg.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'||e.target.closest('g[role=button]'))return;drag={x:e.clientX,y:e.clientY,px:pan.x,py:pan.y};svg.setPointerCapture(e.pointerId);});
    svg.addEventListener('pointermove',e=>{if(!drag)return;const rect=svg.getBoundingClientRect(),ratio=Math.max(width/zoom/rect.width,height/zoom/rect.height);pan={x:drag.px-(e.clientX-drag.x)*ratio,y:drag.py-(e.clientY-drag.y)*ratio};camera();});
    svg.addEventListener('pointerup',()=>drag=null);svg.addEventListener('pointercancel',()=>drag=null);
    $('#module-search').addEventListener('input',e=>{
      const q=e.target.value.trim().toLocaleLowerCase(),results=$('#module-results');
      if(!q){results.hidden=true;return;}
      const ns=A.nodes.filter(n=>(n.label+' '+n.path).toLocaleLowerCase().includes(q)).slice(0,12);
      results.innerHTML=ns.length?ns.map(n=>'<button data-search-node="'+esc(n.id)+'"><strong>'+esc(n.label)+'</strong><span>'+esc(n.path||n.label)+'</span></button>').join(''):'<p>未找到匹配模块或文件。</p>';results.hidden=false;
    });
    $('#module-results').onclick=e=>{const b=e.target.closest('[data-search-node]');if(!b)return;const n=byId.get(b.dataset.searchNode);drill(n.kind==='file'?n.parent:n.id);chosen=n.id;draw();$('#module-results').hidden=true;$('#module-search').value='';};
    document.addEventListener('keydown',e=>{if(e.key==='Escape')$('#module-results').hidden=true;});
    matchMedia('(max-width: 800px)').addEventListener('change',()=>{if(mode==='map')draw();});
    focusFinding(selected);
  }
