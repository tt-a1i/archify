import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {PackageCache} from './package-cache.js';
import {createServer} from './serve.mjs';
import {ChromeVisualBrowser} from '../../archify/bin/visual-check.mjs';

test('cache validates bytes, evicts LRU, protects active/pinned packages and survives quota errors',async()=>{
  globalThis.location={href:'https://example.test/'};
  const items=new Map();let quota=false,network=true;
  const cache={keys:async()=>[...items.keys()].map(url=>({url})),match:async key=>items.get(key.url||key)?.clone(),delete:async key=>items.delete(key.url||key),put:async(key,response)=>{if(quota)throw new DOMException('Full','QuotaExceededError');items.set(key,response.clone());}};
  const bytes=new TextEncoder().encode('abc'),entry=name=>({url:name,bytes:3,sha256:createHash('sha256').update(bytes).digest('hex'),group:name,label:name});
  const manager=new PackageCache({storage:{open:async()=>cache},budget:6,estimate:async()=>({quota:100,usage:0}),fetcher:async()=>{if(!network)throw Error('offline');return new Response(bytes);}});
  await manager.get(entry('a'));await manager.get(entry('b'));manager.active.add('https://example.test/a');await manager.get(entry('c'));assert.ok(items.has('https://example.test/a'));assert.ok(!items.has('https://example.test/b'));
  manager.pins.add('c');await manager.get(entry('d'));assert.ok(!items.has('https://example.test/d'));assert.equal(items.size,2);
  network=false;assert.equal((await manager.get(entry('a'))).byteLength,3);network=true;
  items.set('https://example.test/a',new Response('bad'));await manager.get(entry('a'));assert.equal(await (await cache.match('https://example.test/a')).text(),'abc');
  manager.active.clear();manager.pins.clear();await manager.trim(0,true);quota=true;assert.equal((await manager.get(entry('e'))).byteLength,3);assert.equal(items.size,0);
  await assert.rejects(manager.get({...entry('f'),sha256:'0'.repeat(64)}),/校验失败/);
});

test('package manifest pins all bytes and city layers separately',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('./packages/manifest.json',import.meta.url)));
  assert.deepEqual(manifest.style,JSON.parse(fs.readFileSync(new URL('./visual-lock.json',import.meta.url))),'visual changes require an explicit baseline review');
  for(const entry of [...Object.values(manifest.shared),...Object.values(manifest.groups).flatMap(g=>[g.base,...Object.values(g.days||{})])]){const b=fs.readFileSync(new URL('./'+entry.url,import.meta.url));assert.equal(b.length,entry.bytes);assert.equal(createHash('sha256').update(b).digest('hex'),entry.sha256);}
  const sh=JSON.parse(fs.readFileSync(new URL('./'+manifest.groups.shanghai.base.url,import.meta.url)));assert.equal(sh.journey.tiles.journey.buildings.length,0);assert.equal(sh.scenes.paris,undefined);assert.ok(sh.scenes['day-2']);assert.equal(sh.journey.tiles['day-2'].pending,true);
});

test('HTTP packages: lazy height, cached reload, offline shell, navigation and deterministic appearance',{skip:!process.env.ARCHIFY_CHROME},async t=>{
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const url='http://127.0.0.1:'+server.address().port+'/';
  const browser=new ChromeVisualBrowser(process.env.ARCHIFY_CHROME,{spawnImpl:(cmd,args,options)=>spawn(cmd,['--use-angle=swiftshader','--enable-unsafe-swiftshader',...args],options)});t.after(()=>browser.close());const session=await browser.sessionPromise;
  const send=(m,p={})=>browser.cdp.send(m,p,session),run=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result?.value;};
  async function wait(expression){for(let i=0;i<120;i++){if(await run(expression))return;await new Promise(r=>setTimeout(r,100));}throw Error('Timed out: '+expression+' '+JSON.stringify(await run('({status:document.getElementById("package-status")?.textContent,errors:window.errors})')));}
  async function stable(){await run('(async()=>{await document.fonts.ready;for(let i=0;i<35;i++)await new Promise(requestAnimationFrame)})()');}
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));"});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:url+'?view=flow#scene=shanghai'});await wait('Boolean(window.Archify?.travel3d)');await stable();
  assert.equal(await run('Archify.travel3d.state().active'),false);
  assert.equal(await run("document.querySelectorAll('#flow-drawing [data-node-id]').length"),6);
  assert.equal(await run("getComputedStyle(document.getElementById('mode-flat')).display"),'none');
  assert.equal(await run("getComputedStyle(document.getElementById('mode-2d')).display"),'none');
  if(process.env.ARCHIFY_TRAVEL_EVIDENCE){fs.mkdirSync(process.env.ARCHIFY_TRAVEL_EVIDENCE,{recursive:true});const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(process.env.ARCHIFY_TRAVEL_EVIDENCE+'/shanghai-flow.png',Buffer.from(shot.data,'base64'));}
  assert.equal(await run("performance.getEntriesByType('resource').some(r=>r.name.includes('shanghai-day-'))"),false);
  assert.equal(await run("performance.getEntriesByType('resource').some(r=>/paris-base|france-base/.test(r.name))"),false);
  await run("document.getElementById('mode-3d').click()");await wait('Archify.travel3d.state().active&&Archify.travel3d.state().heightMode');await stable();
  assert.ok(await run('Archify.travel3d.state().markerHeights.some(h=>h>100)'));
  assert.equal(await run('Archify.travel3d.state().places.length'),6);assert.equal(await run('Archify.travel3d.state().routeArrows'),5);assert.equal(await run('Archify.travel3d.state().detailBuildings'),0);
  assert.equal(await run("performance.getEntriesByType('resource').some(r=>r.name.includes('shanghai-day-'))"),false,'overview never fetches detailed day packages');
  await run("document.getElementById('mode-flow').click();document.querySelector('#flow-drawing [data-node-id=\"v2-1\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))");await wait('Archify.travel3d.state().active&&Archify.travel3d.state().detailBuildings>0');await stable();assert.equal(await run('Archify.travel.scene()'),'day-2');assert.equal(await run('Archify.travel3d.state().active'),true);assert.ok(await run("TravelData.journey.tiles['day-2'].buildings.length>0&&TravelData.journey.tiles['day-2'].backdrop.length>0&&TravelData.journey.tiles['day-2'].water.length>0"));
  assert.equal(await run("performance.getEntriesByType('resource').some(r=>/shanghai-day-[13]/.test(r.name))"),false,'only the chosen day downloads');
  if(process.env.ARCHIFY_TRAVEL_EVIDENCE){fs.mkdirSync(process.env.ARCHIFY_TRAVEL_EVIDENCE,{recursive:true});const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(process.env.ARCHIFY_TRAVEL_EVIDENCE+'/disney-map.png',Buffer.from(shot.data,'base64'));}
  await run("document.querySelector('#trip-days [data-day=\"0\"]').click()");await stable();assert.equal(await run('Archify.travel.scene()'),'journey');assert.equal(await run('Archify.travel3d.state().detailBuildings'),0);
  const pixels=await run("document.querySelector('#stage-3d canvas').toDataURL()");const beforeCamera=await run('Archify.travel3d.state().camera');
  await wait('Boolean(navigator.serviceWorker.controller)');{const loaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.reload');await loaded;}await wait('Boolean(window.Archify?.travel3d?.state().active)');await stable();
  assert.deepEqual(await run('Archify.travel3d.state().camera'),beforeCamera);
  if(process.env.ARCHIFY_TRAVEL_EVIDENCE){fs.writeFileSync(process.env.ARCHIFY_TRAVEL_EVIDENCE+'/before-cache.png',Buffer.from(pixels.split(',')[1],'base64'));fs.writeFileSync(process.env.ARCHIFY_TRAVEL_EVIDENCE+'/after-cache.png',Buffer.from((await run("document.querySelector('#stage-3d canvas').toDataURL()")).split(',')[1],'base64'));}
  assert.equal(createHash('sha256').update(await run("document.querySelector('#stage-3d canvas').toDataURL()")).digest('hex'),createHash('sha256').update(pixels).digest('hex'),'same camera and cached data retain appearance');
  assert.equal(await run("performance.getEntriesByType('resource').some(r=>r.name.includes('shanghai-day-'))"),false,'overview does not reload any height layer');
  await run("document.getElementById('trip-form').requestSubmit()");await stable();assert.equal(await run("document.body.dataset.travelView"),'flow');await run("document.getElementById('mode-3d').click()");await stable();assert.equal(await run("document.querySelector('#stage-3d canvas').toDataURL()"),pixels,'generation changes no visual style');
  await send('Network.enable');await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});{const loaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.reload');await loaded;}await wait('Boolean(window.Archify?.travel3d?.state().active)');await stable();assert.equal(await run('Archify.travel.scene()'),'journey');
  await run("document.querySelector('#trip-days [data-day=\"2\"]').click()");await wait('Archify.travel3d.state().detailBuildings>0');assert.equal(await run('Archify.travel3d.state().places.length'),1,'cached day available offline');
  await send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
  {const loaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:url+'?destination=paris&view=3d#scene=journey'});await loaded;}await wait("window.TravelPackages?.group==='paris'&&window.Archify?.travel3d?.state().active");assert.equal(await run('Archify.travel3d.state().routeArrows'),5);
  if(process.env.ARCHIFY_TRAVEL_EVIDENCE){await stable();fs.mkdirSync(process.env.ARCHIFY_TRAVEL_EVIDENCE,{recursive:true});const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(process.env.ARCHIFY_TRAVEL_EVIDENCE+'/packages-paris.png',Buffer.from(shot.data,'base64'));}
});
