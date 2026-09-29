import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {VISUAL} from './visual-style.js';
export function styleIdentity(root){return {id:VISUAL.id,sha256:createHash('sha256').update(['visual-style.js','scene3d.js','style.css','air-route-style.js'].map(f=>fs.readFileSync(path.join(root,f),'utf8')).join('\n')).digest('hex')};}
export function buildPackages({root,html,data,camera,threeBundle,buildSync,check}){
  const read=f=>fs.readFileSync(path.join(root,f),'utf8'),digest=b=>createHash('sha256').update(b).digest('hex');
  const outputs=new Map(),manifest={schema:1,style:data.visualStyle,groups:{},shared:{}};
  function asset(name,body,group,label,type='application/json'){const b=Buffer.from(body),sha256=digest(b),ext=type==='application/json'?'json':'js',url='packages/'+name+'.'+sha256.slice(0,16)+'.'+ext;outputs.set(url,b);return {url,bytes:b.length,sha256,group,label,type};}
  const trip={...data.trip,backdrop:[],water:[],buildings:[]};
  for(const family of ['france','paris','shanghai']){
    const scenes=Object.fromEntries(Object.entries(data.scenes).filter(([id])=>id===family||(family==='shanghai'&&id==='disney')));
    const payload={...data,scenes,disney:family==='shanghai'?{...data.disney,buildings:[]}:{backdrop:[],water:[],buildings:[]},trip:family==='paris'?{...data.trip,buildings:[]}:trip,shanghai:family==='shanghai'?{...data.shanghai,buildings:[]}:{backdrop:[],water:[],buildings:[]}};
    manifest.groups[family]={base:asset(family+'-base',JSON.stringify(payload),family,family+' · 地理与行程')};
    if(family!=='france')manifest.groups[family].height=asset(family+'-height',JSON.stringify({disneyBuildings:family==='shanghai'?data.disney.buildings:[],buildings:(family==='paris'?data.trip:data.shanghai).buildings}),family,family+' · 建筑高度');
  }
  manifest.shared.atlas=asset('atlas',`var Archify={};function viewerText(){return ''; }\n${camera}\n${read('runtime.js')}\n${read('planner.js')}
${read('flow-view.js')}`,'engine','互动界面','text/javascript');
  manifest.shared.renderer=asset('renderer',threeBundle,'engine','固定插画渲染器','text/javascript');
  const boot=buildSync({entryPoints:[path.join(root,'bootstrap.js')],bundle:true,format:'iife',write:false,minify:true,target:'es2020'}).outputFiles[0].text;
  const bootstrap=asset('bootstrap',boot,'engine','数据包加载器','text/javascript');
  let online=html.slice(0,html.indexOf('<script id="travel-data"'));
  online+='<script id="travel-data" type="application/json">{}</script><script id="package-manifest" type="application/json">'+JSON.stringify(manifest).replace(/</g,'\\u003c')+'</script><script src="'+bootstrap.url+'"></script></body></html>';
  const shellVersion=digest(online).slice(0,16);
  outputs.set('sw.js',Buffer.from(`const NAME='archify-travel-shell-${shellVersion}',FILES=['./index.html','./world.html','./${bootstrap.url}'];
self.addEventListener('install',event=>event.waitUntil(caches.open(NAME).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('archify-travel-shell-')&&k!==NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url),base=new URL('./',self.location.href);if(url.origin!==base.origin)return;const rel=url.pathname.slice(base.pathname.length);if(event.request.mode==='navigate'&&['','index.html','world.html'].includes(rel)){event.respondWith(fetch(event.request).catch(async()=>{const cache=await caches.open(NAME);return await cache.match(rel==='world.html'?'./world.html':'./index.html')||Response.error();}));}else if(url.href===new URL('./${bootstrap.url}',base).href){event.respondWith(caches.open(NAME).then(async cache=>await cache.match(url.href)||fetch(event.request)));}});
`));
  outputs.set('index.html',Buffer.from(online));outputs.set('offline.html',Buffer.from(html));outputs.set('packages/manifest.json',Buffer.from(JSON.stringify(manifest,null,2)));
  for(const [name,b] of outputs){const file=path.join(root,name);if(check){if(!fs.existsSync(file)||!fs.readFileSync(file).equals(b))throw Error('Stale package: '+name);}else{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,b);}}
  // Keep immutable previous releases: already-open pages may still reference them.
  return manifest;
}
