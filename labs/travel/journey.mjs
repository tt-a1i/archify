import {VISUAL} from './visual-style.js';
import {buildFlow} from './build-flow.mjs';

const fail=m=>{throw Error('行程数据无效：'+m);};
const str=(x,label,max=300)=>{if(typeof x!=='string'||!x.trim()||x.length>max)fail(label);return x;};
const coord=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
const source=x=>{try{const u=new URL(x);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}};
export function validateJourney(input){
  if(input?.version!==1)fail('version 必须是 1');str(input.title,'title');str(input.prompt,'prompt',4000);
  if(!Array.isArray(input.preferences)||input.preferences.some(p=>typeof p!=='string'||p.length>200))fail('preferences');
  if(!Array.isArray(input.places)||!input.places.length||input.places.length>1500)fail('places 数量');
  const ids=new Set();for(const p of input.places){str(p.id,'place.id',80);if(!/^[\w-]+$/.test(p.id)||ids.has(p.id))fail('地点 ID 必须唯一且只含字母数字下划线连字符');ids.add(p.id);str(p.name,'place.name',80);if(!coord(p.coordinates))fail(p.id+' 坐标');if(!source(p.source))fail(p.id+' 缺少坐标来源 URL');if(!VISUAL.icons.includes(p.icon))fail(p.id+' 模型不在固定模型库中');}
  if(!Array.isArray(input.days)||!input.days.length||input.days.length>120)fail('days 需为 1–120 天');
  for(const [i,d] of input.days.entries()){
    if(d.day!==i+1)fail('天数必须从 1 连续编号');str(d.title,'day.title',100);
    if(!Array.isArray(d.stops)||!d.stops.length||d.stops.length>48)fail('每天需 1–48 站');
    for(const s of d.stops){if(!ids.has(s.placeId))fail('未知地点 '+s.placeId);str(s.time,'stop.time',40);str(s.duration,'stop.duration',50);if(s.note!==undefined)str(s.note,'stop.note',800);}
    const g=d.geography;if(!g)continue;if(!source(g.source))fail('地图需要来源 URL');
    for(const key of ['roads','water','buildings']){if(!Array.isArray(g[key])||g[key].length>20000)fail('地图图层 '+key);for(const shape of g[key]){const points=key==='buildings'?shape.coordinates:shape;if(!Array.isArray(points)||points.length<2||points.length>5000||!points.every(coord))fail('地图坐标 '+key);if(key==='buildings'&&(!Number.isFinite(shape.height)||shape.height<=0||shape.height>1000))fail('建筑高度');}}
  }
  return input;
}
// Unwrap at the largest longitude gap: trips across the dateline stay compact.
function extent(points){const xs=points.map(p=>(p[0]+360)%360).sort((a,b)=>a-b);let gap=-1,start=xs[0];for(let i=0;i<xs.length;i++){const next=xs[(i+1)%xs.length]+(i===xs.length-1?360:0);if(next-xs[i]>gap){gap=next-xs[i];start=next%360;}}const unwrap=x=>{x=(x+360)%360;return x<start?x+360:x;};const lats=points.map(p=>p[1]),ys=[Math.min(...lats),Math.max(...lats)],lngs=points.map(p=>unwrap(p[0]));const cos=Math.max(.08,Math.cos((ys[0]+ys[1])/2*Math.PI/180));const size=Math.max(.008,(Math.max(...lngs)-Math.min(...lngs))*cos,ys[1]-ys[0])*1.25;const cx=(Math.min(...lngs)+Math.max(...lngs))/2,cy=(ys[0]+ys[1])/2;return {size,unwrap,cos,cx,cy,project:p=>[700+(unwrap(p[0])-cx)*cos/size*820,525-(p[1]-cy)/size*820]};}
function cutLine(line,frame){const out=[];let run=[];for(const p of line){const q=frame.project(p);if(q[0]>=290&&q[0]<=1110&&q[1]>=115&&q[1]<=935)run.push(q);else{if(run.length>1)out.push(run);run=[];}}if(run.length>1)out.push(run);return out;}
export function createJourney(candidate){
  const input=validateJourney(candidate),lookup=new Map(input.places.map(p=>[p.id,p])),visits=[],days=[];
  for(const d of input.days){const color=VISUAL.dayColors[(d.day-1)%VISUAL.dayColors.length];days.push({...d,color,scene:'day-'+d.day,stops:d.stops.map((s,i)=>{const place=lookup.get(s.placeId),id=`v${d.day}-${i+1}`;visits.push({...place,id,placeId:place.id,day:d.day,label:place.name,category:'landmark',description:s.note||'固定风格示意模型，非实景测绘。',caption:'第 '+d.day+' 天',views:{}});return {...s,id};})});}
  const scenes={},tiles={},routes=[];
  const scene=(id,name)=>{scenes[id]={name,english:name,subtitle:'地标与方向 · 示意模型',paths:[{name:'行程展示范围，非行政边界',d:'M290,115H1110V935H290Z'}]};};
  scene('journey',input.title);tiles.journey={backdrop:[],water:[],buildings:[],bounds:null};
  const overview=extent(visits.map(p=>p.coordinates));
  for(const p of visits){p.views.journey=overview.project(p.coordinates);p.point=p.views.journey;p.scene='journey';}
  for(let i=1;i<visits.length;i++){const a=visits[i-1],b=visits[i];routes.push({day:b.day,from:a.id,to:b.id,color:days[b.day-1].color,points:[a.views.journey,b.views.journey],transfer:a.day!==b.day});}
  for(const d of days){const ps=visits.filter(p=>p.day===d.day),frame=extent(ps.map(p=>p.coordinates));scene(d.scene,'第 '+d.day+' 天 · '+d.title);for(const p of ps)p.views[d.scene]=frame.project(p.coordinates);
    const g=d.geography,inside=line=>line.every(p=>{const q=frame.project(p);return q[0]>=290&&q[0]<=1110&&q[1]>=115&&q[1]<=935;});
    tiles[d.scene]={backdrop:g?g.roads.flatMap(l=>cutLine(l,frame)):[],water:g?g.water.filter(inside).map(l=>l.map(frame.project)):[],buildings:g?g.buildings.filter(b=>inside(b.coordinates)).map(b=>({points:b.coordinates.map(frame.project),height:b.height,heightSource:b.heightSource||'estimated'})):[],source:g?.source||null};
    delete d.geography;
  }
  const plan={title:input.title,prompt:input.prompt,preferences:input.preferences,days,routes,official:Object.fromEntries(input.places.filter(p=>source(p.official)).map(p=>[p.id,p.official])),provenance:input.places.map(p=>({id:p.id,source:p.source}))};
  return {journey:{plan,tiles},scenes,places:visits,flows:{journey:buildFlow(plan,visits)},sources:[],visualStyle:{id:VISUAL.id}};
}

export function demoJourney(data,family,raw){
  const plan=family==='shanghai'?data.shanghaiTrip:data.trip,ids=new Set(plan.days.flatMap(d=>d.stops.map(s=>s.id)));
  return createJourney({version:1,title:plan.title,prompt:plan.prompt||plan.title,preferences:['经典地标','适度节奏'],places:data.places.filter(p=>ids.has(p.id)).map(p=>({...p,official:plan.official?.[p.id],source:p.source||'https://www.wikidata.org/wiki/'+p.id})),days:plan.days.map(d=>{const city=family==='shanghai'?(d.day===2?raw.disney:raw.shanghai):raw.paris;return {...d,stops:d.stops.map(s=>({...s,placeId:s.id})),geography:{source:'https://www.openstreetmap.org/copyright',roads:city.backdrop,water:city.water||[],buildings:city.buildings.map(b=>({coordinates:b.coordinates,height:b.height,heightSource:b.heightSource}))}};})});
}
