// Usage: node labs/travel/prepare-shanghai.mjs out/shanghai-core.osm.json out/shanghai-places.json
import fs from 'node:fs';
const raw=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const places=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const bounds=[121.48,31.225,121.513,31.25];
const inside=p=>p[0]>=bounds[0]&&p[0]<=bounds[2]&&p[1]>=bounds[1]&&p[1]<=bounds[3];
const coords=e=>(e.geometry||[]).filter(p=>p&&Number.isFinite(p.lon)&&Number.isFinite(p.lat)).map(p=>[p.lon,p.lat]);
function clip(points){
  for(const [axis,value,sign] of [[0,bounds[0],1],[0,bounds[2],-1],[1,bounds[1],1],[1,bounds[3],-1]]){
    const output=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length],ai=(a[axis]-value)*sign>=0,bi=(b[axis]-value)*sign>=0;
      if(ai)output.push(a);if(ai!==bi){const t=(value-a[axis])/(b[axis]-a[axis]);output.push(a.map((v,j)=>v+(b[j]-v)*t));}}
    points=output;
  }return points;
}
const ways=raw.elements.filter(e=>e.type==='way');
const buildings=ways.filter(e=>e.tags?.building&&e.geometry?.length>3).flatMap(e=>{
  const points=coords(e);if(!points.every(inside))return [];
  const center=points.reduce((a,p)=>[a[0]+p[0]/points.length,a[1]+p[1]/points.length],[0,0]);
  if(places.some(p=>Math.hypot((center[0]-p.coordinates[0])*.855,center[1]-p.coordinates[1])<.001))return [];
  const height=parseFloat(e.tags.height),levels=parseFloat(e.tags['building:levels']);
  return [{id:e.id,coordinates:points,height:Number.isFinite(height)?height:Number.isFinite(levels)?levels*3:12,heightSource:Number.isFinite(height)?'OSM height':Number.isFinite(levels)?'estimated from levels':'illustrative default'}];
});
const backdrop=ways.filter(e=>e.tags?.highway).flatMap(e=>{const runs=[];let run=[];for(const p of coords(e)){if(inside(p))run.push(p);else{if(run.length>1)runs.push(run);run=[];}}if(run.length>1)runs.push(run);return runs;});
const water=ways.filter(e=>e.tags?.natural==='water'&&e.nodes?.[0]===e.nodes?.at(-1)).map(e=>clip(coords(e))).filter(p=>p.length>2);
const data={bounds,places,buildings,backdrop,water,source:{url:'https://www.openstreetmap.org/copyright',license:'ODbL-1.0',date:'2026-09-29',osmTimestamp:raw.osm3s?.timestamp_osm_base,query:'[out:json][timeout:60][bbox:31.225,121.48,31.25,121.513];(way[building];way[highway];way[waterway=river];nwr[natural=water];);out geom;',scope:'陆家嘴与外滩局部视窗，不是上海行政边界；仅使用闭合水面 ways。'}};
fs.writeFileSync(new URL('./data/shanghai.json',import.meta.url),JSON.stringify(data));
console.log({buildings:buildings.length,roads:backdrop.length,water:water.length});
