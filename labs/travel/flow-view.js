(() => {
  const data=window.TravelData||JSON.parse(document.getElementById('travel-data').textContent);
  const $=id=>document.getElementById(id);
  const chart=document.createElement('section');chart.id='travel-flow';chart.setAttribute('aria-label','旅游流程图');
  chart.innerHTML='<div class="flow-caption"><h2></h2><p>按天看行程 · 点击景点看立体沙盘</p></div><div id="flow-drawing"></div>';
  document.querySelector('.map-heading').after(chart);
  const button=document.createElement('button');button.id='mode-flow';button.textContent='行程流程图';button.type='button';document.querySelector('.map-heading').append(button);
  const details=document.createElement('details');details.className='trip-more';const summary=document.createElement('summary');summary.textContent='行程说明与预约';details.append(summary);
  $('trip-plan').append(details);
  for(const selector of ['.trip-assumption','#trip-calendar','#trip-schedule','.trip-route-note','#trip-download'])details.append(document.querySelector(selector));
  function render(){
    const family=['shanghai','disney'].includes(Archify.travel.scene())?'shanghai':'paris',flow=data.flows[family];
    chart.querySelector('h2').textContent=flow.workflow.meta.title;
    $('flow-drawing').innerHTML=flow.svg;
    $('flow-drawing').querySelector('svg').setAttribute('role','group');
    chart.querySelectorAll('[data-node-id]').forEach(node=>{
      const day=Number($('day').value),planned=flow.workflow.nodes.find(n=>n.id===node.dataset.nodeId);
      node.style.opacity=day&&planned.lane!=='day'+day?'.3':'1';
      node.setAttribute('tabindex','0');node.setAttribute('role','button');node.setAttribute('aria-label',flow.workflow.nodes.find(n=>n.id===node.dataset.nodeId)?.label+' · 查看 3D');
      const open=()=>{const p=data.places.find(p=>p.id===node.dataset.nodeId);if(!p)return;Archify.travel.changeScene(p.scene);$('day').value=String(p.day||0);$('day').dispatchEvent(new Event('change'));Archify.travel.select(p.id);show(true).then(()=>Archify.travel3d.focus(p.id));};
      node.onclick=open;node.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}};
    });
  }
  async function show(map){
    document.body.dataset.travelView=map?'map':'flow';
    button.setAttribute('aria-pressed',String(!map));
    const url=new URL(location.href);url.searchParams.set('view',map?'3d':'flow');history.replaceState(null,'',url);
    if(Archify.travel3d)await Archify.travel3d.setMode(map,true);
    if(map&&Archify.travel3d&&!Archify.travel3d.state().active){document.body.dataset.travelView='flow';button.setAttribute('aria-pressed','true');}
    $('export').hidden=document.body.dataset.travelView!=='map';
  }
  button.onclick=()=>show(false);
  // Wait for the separately loaded renderer without polling or racing its setup.
  window.addEventListener('archify:3d-ready',()=>{
    $('mode-3d').onclick=()=>show(true);
    show(new URLSearchParams(location.search).get('view')==='3d');
  });
  $('trip-form').addEventListener('submit',()=>show(false));
  window.addEventListener('archify:travel-change',render);
  render();document.body.dataset.travelView=new URLSearchParams(location.search).get('view')==='3d'?'map':'flow';
})();
