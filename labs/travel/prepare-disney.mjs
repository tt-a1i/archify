// node labs/travel/prepare-disney.mjs out/disney.osm.json out/disney-boundary.osm.json
import fs from 'node:fs';
const raw=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),boundaryRaw=JSON.parse(fs.readFileSync(process.argv[3],'utf8'));
const coord=e=>(e.geometry||[]).filter(p=>p&&Number.isFinite(p.lon)&&Number.isFinite(p.lat)).map(p=>[p.lon,p.lat]);
const boundary=boundaryRaw.elements.find(e=>e.tags?.wikidata==='Q865312'&&e.type==='way');
if(!boundary||boundary.nodes[0]!==boundary.nodes.at(-1))throw Error('Expected sourced closed park boundary');
const ring=coord(boundary),min=axis=>Math.min(...ring.map(p=>p[axis])),max=axis=>Math.max(...ring.map(p=>p[axis]));
const bounds=[min(0)-.0005,min(1)-.0005,max(0)+.0005,max(1)+.0005];
function inside([x,y]){let yes=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])yes=!yes;}return yes;}
const ways=raw.elements.filter(e=>e.type==='way');
const castle=ways.find(e=>e.tags?.wikidata==='Q21512567');if(!castle)throw Error('Castle location missing');
const cp=coord(castle),center=cp.reduce((a,p)=>[a[0]+p[0]/cp.length,a[1]+p[1]/cp.length],[0,0]);
const buildings=ways.filter(e=>e.tags?.building&&e.id!==castle.id&&e.nodes[0]===e.nodes.at(-1)).flatMap(e=>{const points=coord(e);if(points.length<4||!points.every(inside))return [];const h=parseFloat(e.tags.height),levels=parseFloat(e.tags['building:levels']);return [{id:e.id,coordinates:points,height:Number.isFinite(h)?h:Number.isFinite(levels)?levels*3:9,heightSource:Number.isFinite(h)?'OSM height':Number.isFinite(levels)?'estimated from levels':'illustrative default'}];});
const backdrop=ways.filter(e=>e.tags?.highway).flatMap(e=>{const runs=[];let run=[];for(const p of coord(e)){if(inside(p))run.push(p);else{if(run.length>1)runs.push(run);run=[];}}if(run.length>1)runs.push(run);return runs;});
const water=ways.filter(e=>e.tags?.natural==='water'&&e.nodes[0]===e.nodes.at(-1)).map(coord).filter(points=>points.length>3&&points.every(inside));
const result={bounds,boundary:{type:'Polygon',coordinates:[ring]},castle:{id:castle.id,coordinates:center,source:'https://www.openstreetmap.org/way/'+castle.id},backdrop,water,buildings,source:{license:'ODbL-1.0',attribution:'© OpenStreetMap contributors',osmTimestamp:raw.osm3s.timestamp_osm_base,boundaryWay:boundary.id,bbox:[31.137,121.649,31.151,121.666],queries:['(way[building];way[highway];way[natural=water]);out geom;','nwr[tourism=theme_park];out geom;'],method:'Closed ways wholly inside the park; road runs keep only in-boundary vertices. Relations, partial edge buildings and crossing water polygons omitted. Not official navigation or live access data.'}};
fs.writeFileSync(new URL('./data/disney.json',import.meta.url),JSON.stringify(result));console.log({buildings:buildings.length,roads:backdrop.length,water:water.length,bounds});
