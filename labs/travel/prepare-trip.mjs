// Offline preparation: node labs/travel/prepare-trip.mjs roads.osm.json core.osm.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const roads=JSON.parse(fs.readFileSync(process.argv[2]));
const core=JSON.parse(fs.readFileSync(process.argv[3]));
if(roads.remark||core.remark)throw Error('Incomplete Overpass response');
const places=JSON.parse(fs.readFileSync(path.join(root,'data/places.json')));
const distance=(a,b)=>Math.hypot((a[0]-b[0])*73200,(a[1]-b[1])*111320);
const nodes=new Map(),edges=new Map();
const allowed=new Set(['footway','pedestrian','path','steps','living_street','residential','service','unclassified','tertiary','secondary','primary','tertiary_link','secondary_link','primary_link']);
const ways=roads.elements.filter(e=>e.type==='way'&&e.geometry&&e.nodes&&allowed.has(e.tags?.highway)&&e.tags.area!=='yes'&&e.tags.indoor!=='yes'&&!['no','private'].includes(e.tags.foot)&&(!['no','private'].includes(e.tags.access)||['yes','designated','permissive'].includes(e.tags.foot))&&e.tags.construction===undefined);
for(const w of ways)for(let i=0;i<w.nodes.length;i++){
  const g=w.geometry[i];if(!g)continue;const id=w.nodes[i],p=[g.lon,g.lat];nodes.set(id,p);if(!edges.has(id))edges.set(id,[]);
}
for(const w of ways)for(let i=1;i<w.nodes.length;i++){
  const a=w.nodes[i-1],b=w.nodes[i];if(!nodes.has(a)||!nodes.has(b))continue;const d=distance(nodes.get(a),nodes.get(b));
  if(w.tags['oneway:foot']!=='-1')edges.get(a).push([b,d,w.id]);
  if(w.tags['oneway:foot']!=='yes')edges.get(b).push([a,d,w.id]);
}
// Restrict snapping to the main connected walking network, avoiding isolated courtyards.
let largest=new Set();const visited=new Set();for(const start of nodes.keys()){
  if(visited.has(start))continue;const component=new Set([start]),stack=[start];visited.add(start);
  while(stack.length)for(const [to] of edges.get(stack.pop()))if(!visited.has(to)){visited.add(to);component.add(to);stack.push(to);}
  if(component.size>largest.size)largest=component;
}
function snap(p){let best=null,d=Infinity;for(const id of largest){const next=distance(p,nodes.get(id));if(next<d){d=next;best=id;}}if(d>300)throw Error('Endpoint too far from walking graph: '+d);return {id:best,gap:Math.round(d)};}
class Heap{a=[];push(v){let i=this.a.length;this.a.push(v);while(i){const p=(i-1)>>1;if(this.a[p][0]<=v[0])break;this.a[i]=this.a[p];i=p;}this.a[i]=v;}pop(){const first=this.a[0],last=this.a.pop();if(this.a.length){let i=0;while(i*2+1<this.a.length){let c=i*2+1;if(c+1<this.a.length&&this.a[c+1][0]<this.a[c][0])c++;if(this.a[c][0]>=last[0])break;this.a[i]=this.a[c];i=c;}this.a[i]=last;}return first;}}
function route(from,to){const a=places.find(p=>p.id===from),b=places.find(p=>p.id===to),start=snap(a.coordinates),end=snap(b.coordinates);const heap=new Heap(),best=new Map([[start.id,0]]),prev=new Map();heap.push([0,start.id]);
  while(heap.a.length){const [cost,id]=heap.pop();if(cost!==best.get(id))continue;if(id===end.id)break;for(const [next,d,way] of edges.get(id)){const c=cost+d;if(c<(best.get(next)??Infinity)){best.set(next,c);prev.set(next,[id,way]);heap.push([c,next]);}}}
  if(!best.has(end.id))throw Error('Disconnected route');const ids=[end.id],wayIds=[];while(ids.at(-1)!==start.id){const [p,w]=prev.get(ids.at(-1));ids.push(p);wayIds.push(w);}ids.reverse();
  return {from,to,meters:Math.round(best.get(end.id)),walkMinutes:Math.ceil(best.get(end.id)/70),endpointGaps:[start.gap,end.gap],coordinates:ids.map(id=>nodes.get(id)),wayIds:[...new Set(wayIds)],kind:'osm-walk-preview'};
}
const days=[
 {day:1,title:'巴黎初见 · 城市地标',color:'#b16a35',stops:[{id:'Q64436',time:'11:00',duration:'1.5 小时',note:'凯旋门登顶或外观；从地下通道进入，不横穿环岛。'},{id:'Q243',time:'15:00',duration:'2–3 小时',note:'午餐后前往铁塔；登塔需另行预约，傍晚留给塞纳河。'}],extra:'12:30 午餐与步行缓冲 · 晚餐自行安排'},
 {day:2,title:'艺术的一天 · 两岸博物馆',color:'#36766d',stops:[{id:'Q19675',time:'09:00',duration:'3 小时',note:'卢浮宫选择感兴趣的展厅，避免一次看完。周二闭馆。'},{id:'Q23402',time:'14:00',duration:'2.5 小时',note:'午餐后过河到奥赛；周一闭馆。不爱博物馆可缩短参观。'}],extra:'12:00 午餐与过河步行 · 17:00 后自由活动'},
 {day:3,title:'西岱岛 · 玻璃与石头',color:'#76619e',stops:[{id:'Q193193',time:'10:00',duration:'1 小时',note:'圣礼拜堂彩窗；按预约时段入场，预留安检时间。'},{id:'Q2981',time:'11:30',duration:'1–1.5 小时',note:'巴黎圣母院与广场；入内安排以官方预约及当日开放为准。'}],extra:'13:00 午餐 · 下午拉丁区自由漫步或返程，不另加跨城行程'}
];
const routes=days.map(d=>({...route(d.stops[0].id,d.stops[1].id),day:d.day,color:d.color}));
const corridor=routes.flatMap(r=>r.coordinates.filter((_,i)=>i%8===0));
const footprints=core.elements.filter(e=>e.type==='way'&&e.tags?.building&&e.geometry?.length>=4&&e.nodes?.[0]===e.nodes?.at(-1)&&!e.tags['building:part']).map(e=>{
 const coords=e.geometry.map(p=>[p.lon,p.lat]),center=coords.reduce((a,p)=>[a[0]+p[0]/coords.length,a[1]+p[1]/coords.length],[0,0]);
 const h=Number(e.tags.height),levels=Number(e.tags['building:levels']);return {id:e.id,coordinates:coords,center,height:Number.isFinite(h)&&h>0?Math.min(h,100):Number.isFinite(levels)&&levels>0?Math.min(levels*3,100):12,heightSource:h>0?'osm-height':levels>0?'estimated-from-levels':'illustrative-default'};
}).filter(b=>corridor.some(p=>distance(p,b.center)<110)&&!places.filter(p=>!['Q90','Q456','Q42807','Q12191'].includes(p.id)).some(p=>distance(p.coordinates,b.center)<100)).slice(0,900);
const backdrop=ways.filter(w=>['primary','secondary','tertiary','residential','pedestrian'].includes(w.tags.highway)).map(w=>w.geometry.map(p=>[p.lon,p.lat]));
const water=core.elements.filter(e=>e.type==='way'&&e.tags?.natural==='water'&&e.geometry&&e.nodes?.[0]===e.nodes?.at(-1)).map(e=>e.geometry.map(p=>[p.lon,p.lat]));
const result={title:'法国 3 天 · 巴黎慢游',prompt:'我有3天时间去法国玩，给我个推荐图',days,routes,backdrop,water,buildings:footprints,provenance:{source:'https://www.openstreetmap.org/copyright',license:'ODbL',attribution:'© OpenStreetMap contributors',osmTimestamp:roads.osm3s.timestamp_osm_base,method:'Dijkstra on selected OSM walking ways; nearest network nodes, not verified entrances. No live closures, node barriers, accessibility or turn restrictions. Endpoint gaps excluded from route distance.',buildingScope:'Up to 900 simple building rings within 110m of sampled route vertices; complex relations and holes excluded. Heights without OSM height are estimates.'},official:{Q64436:'https://www.paris-arc-de-triomphe.fr/en/visit/practical-information',Q243:'https://www.toureiffel.paris/en/rates-opening-times',Q19675:'https://www.louvre.fr/en/visit/hours-admission',Q23402:'https://www.musee-orsay.fr/fr/visite',Q193193:'https://www.sainte-chapelle.fr/en/visit/practical-information',Q2981:'https://www.notredamedeparis.fr/en/'}};
fs.writeFileSync(path.join(root,'data/trip.json'),JSON.stringify(result)+'\n');console.log(JSON.stringify({routes:routes.map(({coordinates,wayIds,...r})=>({...r,points:coordinates.length})),buildings:footprints.length,roads:backdrop.length}));
