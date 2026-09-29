// Explicit maintenance command. Builds small offline snapshots, never runs on page load.
import fs from 'node:fs';
import {inflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';
function decode(png){
  if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Not PNG');
  let w,h,channels;const parts=[];
  for(let p=8;p<png.length;){const n=png.readUInt32BE(p),type=png.toString('ascii',p+4,p+8),d=png.subarray(p+8,p+8+n);p+=12+n;if(type==='IHDR'){w=d.readUInt32BE(0);h=d.readUInt32BE(4);channels=d[9]===2?3:d[9]===6?4:0;if(d[8]!==8||d[12]||!channels||w!==256||h!==256)throw Error('Unsupported terrain PNG');}if(type==='IDAT')parts.push(d);}
  const raw=inflateSync(Buffer.concat(parts)),stride=w*channels,out=Buffer.alloc(h*stride);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<h;y++){const filter=raw[y*(stride+1)];if(filter>4)throw Error('PNG filter');for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=channels?out[i-channels]:0,b=y?out[i-stride]:0,c=y&&x>=channels?out[i-stride-channels]:0;out[i]=(raw[y*(stride+1)+x+1]+[0,a,b,Math.floor((a+b)/2),paeth(a,b,c)][filter])&255;}}
  return (x,y)=>{const i=(y*w+x)*channels;return out[i]*256+out[i+1]+out[i+2]/256-32768;};
}
const regions={shanghai:[121.43,31.07,121.70,31.31],paris:[2.24,48.81,2.40,48.92]};
const zoom=10,n=2**zoom,cache=new Map();
const tilePoint=(lng,lat)=>[(lng+180)/360*n,(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n];
for(const [name,bounds] of Object.entries(regions)){
  const [west,south,east,north]=bounds,columns=49,rows=49,values=[],urls=new Set();
  for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){
    const [x,y]=tilePoint(west+(east-west)*col/(columns-1),north-(north-south)*row/(rows-1));
    const tx=Math.floor(x),ty=Math.floor(y),url=`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`;urls.add(url);
    if(!cache.has(url)){const response=await fetch(url,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`${response.status}: ${url}`);cache.set(url,decode(Buffer.from(await response.arrayBuffer())));}
    values.push(Math.round(cache.get(url)(Math.min(255,Math.floor((x-tx)*256)),Math.min(255,Math.floor((y-ty)*256)))*10)/10);
  }
  const grid={bounds,columns,rows,values,source:'https://registry.opendata.aws/terrain-tiles/',attribution:name==='paris'?'Mapzen Terrain Tiles; EU-DEM produced using Copernicus data and information funded by the European Union; SRTM/GMTED2010 courtesy of USGS':'Mapzen Terrain Tiles; SRTM/GMTED2010 terrain data courtesy of the U.S. Geological Survey',tiles:[...urls],zoom,retrieved:new Date().toISOString().slice(0,10)};
  const output=new URL(`./data/${name}-elevation.json`,import.meta.url);fs.writeFileSync(output,JSON.stringify(grid)+'\n');console.log(JSON.stringify({file:fileURLToPath(output),bytes:fs.statSync(output).size,min:Math.min(...values),max:Math.max(...values),tiles:urls.size}));
}
