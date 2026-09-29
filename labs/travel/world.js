import {Map as MapLibre, NavigationControl, ScaleControl, setWorkerUrl} from './vendor/maplibre/maplibre-gl.mjs';
setWorkerUrl(new URL('./vendor/maplibre/maplibre-gl-worker.mjs',import.meta.url).href);
const $=id=>document.getElementById(id);
const catalog=await (await fetch(new URL('./data/package-catalog.json',import.meta.url))).json();
const pack=id=>catalog.packages.find(p=>p.id===id);
const destinations={world:{center:[12,20],zoom:1.5},paris:{center:[2.335,48.86],zoom:15.5},alps:{center:[6.865,45.91],zoom:11.5},tokyo:{center:[139.767,35.681],zoom:15.5},shanghai:{center:[121.493,31.239],zoom:15.5},newyork:{center:[-73.985,40.748],zoom:15.5},rio:{center:[-43.209,-22.952],zoom:14}};
let map,ready=false,serial=0,requests=0,lastError='',applied={geography:'light',buildings:false,terrain:false};
const lightStyle=()=>({version:8,sources:{countries:{type:'geojson',data:new URL(pack('world-boundaries').url,import.meta.url).href,attribution:'Natural Earth · public domain'}},layers:[{id:'sea',type:'background',paint:{'background-color':'#dce9e7'}},{id:'countries',type:'fill',source:'countries',paint:{'fill-color':'#d6dfc0','fill-outline-color':'#8da184'}}]});
const notice=(message,error=false)=>{$('status').textContent=message;$('status').classList.toggle('error',error);$('retry').hidden=!error;};
const choices=()=>({geography:$('geography').value,buildings:$('buildings').checked,terrain:$('terrain').checked});
function summary(){const layers=[applied.geography==='light'?'全球轮廓':'街道 / 公园 / 水系'];if(applied.buildings)layers.push('立体建筑');if(applied.terrain)layers.push('真实地形 1×');$('active-layers').textContent=layers.join(' · ');$('usage').textContent=`本次页面已请求 ${requests} 个在线资源（含瓦片、文字和样式）。传输字节数未由服务完整提供，不显示推算下载量。`;}
function applyLayers(){
  if(!map.getSource('terrain-dem')&&applied.terrain)map.addSource('terrain-dem',{type:'raster-dem',tiles:[pack('world-terrain').url],tileSize:256,encoding:'terrarium',maxzoom:15,attribution:'Terrain: Mapzen / <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank">source attribution</a>'});
  map.setTerrain(applied.terrain?{source:'terrain-dem',exaggeration:1}:null);
  if(applied.terrain&&!map.getLayer('terrain-shading'))map.addLayer({id:'terrain-shading',type:'hillshade',source:'terrain-dem',paint:{'hillshade-exaggeration':.35}},map.getStyle().layers.find(l=>l.type==='symbol')?.id);
  for(const layer of map.getStyle().layers||[])if(layer.type==='fill-extrusion')map.setLayoutProperty(layer.id,'visibility',applied.buildings?'visible':'none');
  if(!applied.terrain&&map.getLayer('terrain-shading'))map.removeLayer('terrain-shading');
  if(!applied.terrain&&map.getSource('terrain-dem'))map.removeSource('terrain-dem');
  const pitch=applied.terrain||applied.buildings?55:0;map.easeTo({pitch,duration:400});summary();
}
async function apply(){
  const turn=++serial;let next=choices();if(next.buildings&&next.geography==='light'){next.geography='streets';$('geography').value='streets';}
  $('apply').disabled=true;ready=false;lastError='';notice('正在加载所选数据…');
  try{
    let style=lightStyle();if(next.geography==='streets'){
      const response=await fetch(pack('world-streets').url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('底图服务 HTTP '+response.status);style=await response.json();
      // Do not allow a style's default extrusion to silently enable buildings.
      for(const l of style.layers||[])if(l.type==='fill-extrusion')l.layout={...l.layout,visibility:next.buildings?'visible':'none'};
    }
    if(turn!==serial)return;applied=next;
    map.once('style.load',()=>{if(turn!==serial)return;try{applyLayers();ready=true;if(!lastError)notice('图层已启用，视野内数据正在按需加载。');}catch(e){lastError=e.message;notice('图层加载失败：'+e.message,true);}finally{$('apply').disabled=false;}});
    map.setStyle(style,{diff:false});try{localStorage.setItem('archify-world-preferences',JSON.stringify(next));}catch{}
  }catch(e){if(turn!==serial)return;lastError=e.message;ready=!!map?.isStyleLoaded();$('apply').disabled=false;notice('加载失败，保留当前地图。'+e.message,true);}
}
try{
  map=new MapLibre({container:'map',style:lightStyle(),center:destinations.world.center,zoom:destinations.world.zoom,maxPitch:75,attributionControl:{compact:false},transformRequest:(url)=>{if(url.startsWith('https://'))requests++;return {url};}});
  map.addControl(new NavigationControl({visualizePitch:true}),'top-right');map.addControl(new ScaleControl(),'bottom-right');
  map.on('load',()=>{ready=true;notice('轻量全球底图已加载。选择精细层后点击“应用选择”。');summary();});
  map.on('idle',()=>{summary();if(ready&&!lastError)notice('当前视野已加载。'+(applied.buildings&&map.getZoom()<14?'放大到街区查看建筑。':''));});
  map.on('error',e=>{lastError=e.error?.message||'资源无法加载';notice('部分数据未加载：'+lastError,true);$('apply').disabled=false;summary();});
  map.on('moveend',()=>{$('longitude').value=map.getCenter().lng.toFixed(5);$('latitude').value=map.getCenter().lat.toFixed(5);summary();});
  map.on('click',e=>{if(applied.geography!=='light'||!map.getLayer('countries'))return;const features=map.queryRenderedFeatures(e.point,{layers:['countries']});if(!features.length)return;notice('所选区域：'+features[0].properties.name+'。可开启街道、建筑或地形后放大。');});
  $('apply').addEventListener('click',apply);$('retry').addEventListener('click',apply);
  $('buildings').addEventListener('change',()=>{if($('buildings').checked){$('geography').value='streets';$('selection-note').textContent='立体建筑需要详细底图；应用后按视野加载，不下载整个世界。';}});
  $('destination').addEventListener('change',()=>map.jumpTo(destinations[$('destination').value]));
  $('coordinates').addEventListener('submit',e=>{e.preventDefault();map.jumpTo({center:[Number($('longitude').value),Number($('latitude').value)],zoom:14});});
  try{const saved=JSON.parse(localStorage.getItem('archify-world-preferences'));if(saved){$('geography').value=saved.geography==='streets'?'streets':'light';$('buildings').checked=saved.buildings===true;$('terrain').checked=saved.terrain===true;$('selection-note').textContent='已恢复上次选项，点击应用后才加载在线精细数据。';}}catch{}
}catch(e){$('fallback').hidden=false;notice('无法启动地图：'+e.message,true);$('apply').disabled=true;}
window.ArchifyWorld={map,apply,catalog,state:()=>({ready,applied:{...applied},requests,error:lastError,terrain:!!map?.getTerrain()})};
