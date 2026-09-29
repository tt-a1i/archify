// A private cache namespace. Never touches other application caches or user files.
export class PackageCache {
  constructor({budget=64*1024*1024,storage=globalThis.caches,fetcher=(...args)=>globalThis.fetch(...args),estimate=()=>navigator.storage.estimate(),notify=()=>{}}={}) {
    Object.assign(this,{budget,storage,fetcher,estimate,notify});this.active=new Set();this.pins=new Set();this.queue=Promise.resolve();
  }
  async open(){try{return await this.storage.open('archify-travel-packages-v1');}catch{return null;}}
  async verified(buffer,entry){if(buffer.byteLength!==entry.bytes)return false;const hash=await crypto.subtle.digest('SHA-256',buffer);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')===entry.sha256;}
  async records(){const cache=await this.open();if(!cache)return [];return Promise.all((await cache.keys()).map(async key=>{const r=await cache.match(key);return {url:key.url,bytes:Number(r.headers.get('x-bytes')),used:Number(r.headers.get('x-used')),group:r.headers.get('x-group')};}));}
  protected(record){return this.active.has(record.url)||this.pins.has(record.group);}
  async trim(incoming=0,clear=false){const cache=await this.open();if(!cache)return;const records=await this.records();let total=records.reduce((n,r)=>n+r.bytes,0);let available=Infinity;try{const e=await this.estimate();available=Math.max(0,(e.quota??Infinity)-(e.usage??0));}catch{}
    for(const r of records.sort((a,b)=>a.used-b.used)){if(!clear&&total+incoming<=this.budget&&available>=incoming)break;if(this.protected(r))continue;await cache.delete(r.url);total-=r.bytes;available+=r.bytes;}
    return total+incoming<=this.budget&&available>=incoming;
  }
  get(entry){const task=()=>this.load(entry);const result=this.queue.then(task,task);this.queue=result.catch(()=>{});return result;}
  async load(entry){const url=new URL(entry.url,location.href).href,cache=await this.open();let cached=cache&&await cache.match(url);if(cached){const b=await cached.arrayBuffer();if(await this.verified(b,entry)){try{await cache.put(url,this.response(b,entry));}catch{}this.notify('已复用本地地图包');return b;}await cache.delete(url);}
    this.notify('正在下载 '+entry.label+'…');const response=await this.fetcher(url,{cache:'no-store'});if(!response.ok)throw new Error('下载失败：'+entry.label+' ('+response.status+')');const bytes=await response.arrayBuffer();if(!await this.verified(bytes,entry))throw new Error('地图包校验失败，已拒绝使用：'+entry.label);
    if(cache&&await this.trim(bytes.byteLength)){try{await cache.put(url,this.response(bytes,entry));this.notify('地图包已保存到本地');return bytes;}catch{}}
    this.notify('缓存不可用或空间不足：本次临时加载，离线时需重新联网');return bytes;
  }
  response(bytes,entry){return new Response(bytes,{headers:{'Content-Type':entry.type||'application/json','x-bytes':String(bytes.byteLength),'x-used':String(Date.now()),'x-group':entry.group}});}
}
