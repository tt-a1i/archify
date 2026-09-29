import {PackageCache} from './package-cache.js';
const manifest=JSON.parse(document.getElementById('package-manifest').textContent);
const family=scene=>scene==='disney'?'shanghai':['france','paris','shanghai'].includes(scene)?scene:'france';
const initial=new URLSearchParams(location.hash.slice(1)).get('scene')||'france',group=family(initial);
const banner=document.createElement('p');banner.id='package-status';banner.setAttribute('role','status');banner.className='package-status';document.querySelector('header').after(banner);
let preferences={budget:64,pins:[]};try{const saved=JSON.parse(localStorage.getItem('travel-package-preferences'));if(saved&&Number.isFinite(saved.budget)&&saved.budget>=5&&saved.budget<=256&&Array.isArray(saved.pins))preferences=saved;}catch{}
const manager=new PackageCache({budget:preferences.budget*1024*1024,notify:text=>banner.textContent=text});manager.pins=new Set(preferences.pins);
const entries=manifest.groups[group],absolute=e=>new URL(e.url,location.href).href;
manager.active=new Set([entries.base,entries.height,...Object.values(manifest.shared)].filter(Boolean).map(absolute));
const parse=bytes=>JSON.parse(new TextDecoder().decode(bytes));
let heightPromise,heightsReady=false;
const packages=window.TravelPackages={manifest,group,manager,
  async ensureHeight(){if(heightsReady)return;if(!entries.height)return;if(!heightPromise)heightPromise=manager.get(entries.height).then(bytes=>{const payload=parse(bytes);const city=group==='paris'?window.TravelData.trip:window.TravelData.shanghai;city.buildings=payload.buildings;heightsReady=true;}).finally(()=>heightPromise=null);return heightPromise;},
  navigate(scene,id){if(family(scene)===group)return false;const url=new URL(location.href);url.searchParams.set('destination',family(scene));url.hash='scene='+scene+(id?'&place='+id:'');location.assign(url);return true;}
};
function controls(){const button=document.createElement('button');button.textContent='地图缓存';button.type='button';document.querySelector('header').append(button);const dialog=document.createElement('dialog');dialog.className='cache-dialog';dialog.innerHTML='<h2>地图缓存</h2><p>只下载当前目的地。高度层在选择「3D 有高度」时补充。</p><label>缓存上限（MB） <input id="cache-budget" type="number" min="5" max="256" step="1"></label><label><input id="cache-pin" type="checkbox"> 保留当前目的地已下载的数据</label><p id="cache-usage"></p><p>当前使用的数据不会自动清理。保留标记仅约束本应用；浏览器仍可能回收缓存。</p><button id="cache-save">保存设置</button><button id="cache-clean">清理未使用且未保留的数据</button><button id="cache-close">关闭</button>';document.body.append(dialog);
  const usage=async()=>{const records=await manager.records();dialog.querySelector('#cache-usage').textContent='本地数据与引擎缓存 '+(records.reduce((n,r)=>n+r.bytes,0)/1e6).toFixed(2)+' MB · '+records.length+' 个文件 · '+manifest.style.id;};
  button.onclick=()=>{dialog.querySelector('#cache-budget').value=preferences.budget;dialog.querySelector('#cache-pin').checked=manager.pins.has(group);usage();dialog.showModal();};
  dialog.querySelector('#cache-close').onclick=()=>dialog.close();dialog.querySelector('#cache-clean').onclick=async()=>{await manager.trim(0,true);await usage();};
  dialog.querySelector('#cache-save').onclick=async()=>{const input=dialog.querySelector('#cache-budget');if(!input.reportValidity())return;preferences.budget=Number(input.value);manager.budget=preferences.budget*1024*1024;dialog.querySelector('#cache-pin').checked?manager.pins.add(group):manager.pins.delete(group);preferences.pins=[...manager.pins];try{localStorage.setItem('travel-package-preferences',JSON.stringify(preferences));}catch{banner.textContent='设置无法持久保存，本次会话仍有效';}await manager.trim();await usage();};
}
async function script(entry){const bytes=await manager.get(entry),url=URL.createObjectURL(new Blob([bytes],{type:'text/javascript'}));try{await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=url;script.onload=resolve;script.onerror=()=>reject(new Error('渲染器加载失败'));document.body.append(script);});}finally{URL.revokeObjectURL(url);}}
async function start(){try{banner.textContent='正在准备目的地…';const payload=parse(await manager.get(entries.base));window.TravelData=payload;document.getElementById('travel-data').textContent=JSON.stringify(payload);controls();await script(manifest.shared.atlas);await script(manifest.shared.renderer);document.documentElement.dataset.packagesReady='true';}catch(error){banner.textContent=error.message+'。已保留缓存；联网后重试。';const retry=document.createElement('button');retry.textContent='重试';retry.onclick=()=>location.reload();banner.append(retry);}}
start();
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{banner.textContent+=' · 离线页面缓存不可用';});
