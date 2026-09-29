import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { ChromeVisualBrowser } from '../../archify/bin/visual-check.mjs';

test('3D geography, rotation, zoom, pan, scene state, export and fallback', {skip:!process.env.ARCHIFY_CHROME}, async t => {
  const browser=new ChromeVisualBrowser(process.env.ARCHIFY_CHROME,{spawnImpl:(command,args,options)=>spawn(command,['--use-angle=swiftshader','--enable-unsafe-swiftshader',...args],options)});
  t.after(()=>browser.close());const session=await browser.sessionPromise;
  const send=(method,params={})=>browser.cdp.send(method,params,session);
  const run=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result?.value;};
  const stable=()=>run('(async()=>{for(let i=0;i<35;i++)await new Promise(requestAnimationFrame)})()');
  const state=()=>run('Archify.travel3d.state()');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));"});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  async function load(suffix=''){const ready=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:new URL('./index.html',import.meta.url).href+suffix});await ready;await stable();}
  await load();assert.deepEqual(await run('errors'),[]);assert.equal((await state()).active,true);assert.ok((await state()).terrainCount>0);assert.equal((await state()).places.length,4);
  const rect=await run('(()=>{const r=document.querySelector("#stage-3d canvas").getBoundingClientRect();return {x:r.x+r.width*.85,y:r.y+r.height*.55}})()');
  async function drag(button,dx,dy){await send('Input.dispatchMouseEvent',{type:'mousePressed',button,clickCount:1,...rect});for(let i=1;i<=8;i++)await send('Input.dispatchMouseEvent',{type:'mouseMoved',button,buttons:button==='left'?1:2,x:rect.x+dx*i/8,y:rect.y+dy*i/8});await send('Input.dispatchMouseEvent',{type:'mouseReleased',button,clickCount:1,x:rect.x+dx,y:rect.y+dy});await stable();}
  const initial=await state();await drag('left',140,65);assert.ok(Math.abs((await state()).azimuth-initial.azimuth)>.2);assert.ok(Math.abs((await state()).polar-initial.polar)>.1);
  const rotated=await state();await send('Input.dispatchMouseEvent',{type:'mouseWheel',...rect,deltaX:0,deltaY:-180});await stable();assert.ok((await state()).distance<rotated.distance,JSON.stringify({rotated,after:await state()}));
  const zoomed=await state();await drag('right',60,30);assert.notDeepEqual((await state()).target,zoomed.target);
  await run("document.getElementById('orbit-reset').click()");await stable();assert.ok(Math.abs((await state()).azimuth-initial.azimuth)<.02);
  const d=(await state()).distance;await run("document.getElementById('orbit-in').click()");await stable();assert.ok((await state()).distance<d,'plus button zooms in');
  await run("document.getElementById('orbit-top').click()");await stable();assert.ok((await state()).polar<.03);
  await run("document.getElementById('orbit-reset').click();document.getElementById('orbit-spin').click()");await stable();const spin=await state();await stable();assert.notEqual((await state()).azimuth,spin.azimuth);await run("document.getElementById('orbit-spin').click()");
  await run("document.getElementById('paris-tab').click()");await stable();assert.equal((await state()).scene,'paris');assert.equal((await state()).terrainCount,20);
  assert.equal((await state()).places.length,6);assert.equal((await state()).routeArrows,3);
  await run("document.getElementById('trip-form').requestSubmit()");await stable();assert.equal(await run("document.getElementById('trip-plan').hidden"),false);assert.equal(await run("document.querySelectorAll('.schedule-stop').length"),6);
  await run("document.querySelectorAll('#trip-days button')[3].click()");await stable();assert.deepEqual((await state()).places,['Q2981','Q193193']);assert.equal((await state()).routeArrows,1);assert.equal(await run("document.querySelectorAll('.schedule-stop').length"),2);
  await run("document.querySelector('.schedule-stop[data-place=Q193193]').click()");assert.equal(await run('Archify.travel.selected()'),'Q193193');assert.ok(Math.abs((await state()).distance-650)<1);
  await run("document.getElementById('trip-date').value='2026-10-04';document.getElementById('trip-date').dispatchEvent(new Event('change'))");assert.ok(await run("document.getElementById('trip-calendar').textContent.includes('奥赛闭馆')"));
  await run("document.getElementById('trip-prompt').value='日本7天';document.getElementById('trip-form').requestSubmit()");assert.ok(await run("document.getElementById('trip-status').textContent.includes('未为这条需求')"));
  await run("document.getElementById('trip-prompt').value='我有3天时间去法国玩，给我个推荐图';document.getElementById('trip-date').value='';document.getElementById('trip-form').requestSubmit()");await stable();
  await run("document.querySelector('.three-label[data-place=Q243]').click()");assert.equal(await run('Archify.travel.selected()'),'Q243');
  await run("document.getElementById('day').value='1';document.getElementById('day').dispatchEvent(new Event('change'))");assert.deepEqual((await state()).places,['Q243','Q64436']);
  await run("document.getElementById('day').value='0';document.getElementById('day').dispatchEvent(new Event('change'));document.getElementById('orbit-reset').click()");await stable();
  if(process.env.ARCHIFY_TRAVEL_EVIDENCE){fs.mkdirSync(process.env.ARCHIFY_TRAVEL_EVIDENCE,{recursive:true});const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(process.env.ARCHIFY_TRAVEL_EVIDENCE+'/paris-3d.png',Buffer.from(shot.data,'base64'));}
  await run("window.exported=null;URL.createObjectURL=b=>{window.exported=b;return 'blob:test'};HTMLAnchorElement.prototype.click=function(){};document.getElementById('export').click()");await stable();assert.equal(await run('exported.type'),'image/png');assert.ok(await run('exported.size>10000'));
  if(process.env.ARCHIFY_TRAVEL_EVIDENCE){const png=await run("new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(exported)})");fs.writeFileSync(process.env.ARCHIFY_TRAVEL_EVIDENCE+'/france-three-days.png',Buffer.from(png,'base64'));}
  await run("document.getElementById('mode-2d').click()");assert.equal((await state()).active,false);await run("document.getElementById('mode-3d').click()");assert.equal((await state()).active,true);
  await run("document.getElementById('shanghai-tab').click()");await stable();assert.equal((await state()).scene,'shanghai');assert.equal((await state()).places.length,6);assert.equal((await state()).routeArrows,3);assert.equal(await run("document.querySelectorAll('.schedule-stop').length"),6);
  if(process.env.ARCHIFY_TRAVEL_EVIDENCE){const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(process.env.ARCHIFY_TRAVEL_EVIDENCE+'/shanghai-3d.png',Buffer.from(shot.data,'base64'));}
  await run("document.getElementById('mode-flat').click()");await stable();assert.equal((await state()).heightMode,false);assert.ok((await state()).markerHeights.every(h=>h<1));assert.equal((await state()).active,true);assert.equal(await run("document.getElementById('mode-flat').getAttribute('aria-pressed')"),'true');
  if(process.env.ARCHIFY_TRAVEL_EVIDENCE){const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(process.env.ARCHIFY_TRAVEL_EVIDENCE+'/shanghai-flat.png',Buffer.from(shot.data,'base64'));}
  await run("document.getElementById('mode-2d').click()");assert.equal((await state()).active,false);assert.equal(await run("document.querySelectorAll('.poi').length"),6);
  await run("document.getElementById('mode-3d').click()");await stable();assert.equal((await state()).heightMode,true);assert.ok((await state()).markerHeights.some(h=>h>100));
  await run("document.querySelectorAll('#trip-days button')[1].click()");await stable();assert.equal((await state()).routeArrows,2);assert.equal((await state()).places.length,3);
  await run("document.querySelectorAll('#trip-days button')[2].click()");await stable();assert.equal((await state()).scene,'disney');assert.deepEqual((await state()).places,['Q865312']);assert.equal((await state()).routeArrows,0);
  if(process.env.ARCHIFY_TRAVEL_EVIDENCE){const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(process.env.ARCHIFY_TRAVEL_EVIDENCE+'/disney-day2.png',Buffer.from(shot.data,'base64'));}
  await run("document.querySelectorAll('#trip-days button')[3].click()");await stable();assert.equal((await state()).scene,'shanghai');assert.equal((await state()).routeArrows,1);assert.deepEqual((await state()).places,['Q125474','Q1328025']);
  await run("document.getElementById('trip-prompt').value='上海3日游，包含陆家嘴、东方明珠、迪士尼、金融中心';document.getElementById('trip-form').requestSubmit()");await stable();assert.equal(await run("document.querySelectorAll('.schedule-stop').length"),6);
  await run("document.getElementById('export').click()");await stable();assert.equal(await run('exported.type'),'image/png');
  if(process.env.ARCHIFY_TRAVEL_EVIDENCE){const png=await run("new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(exported)})");fs.writeFileSync(process.env.ARCHIFY_TRAVEL_EVIDENCE+'/shanghai-three-days.png',Buffer.from(png,'base64'));}
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await stable();assert.ok(await run('document.documentElement.scrollWidth<=innerWidth+1'));assert.deepEqual(await run('errors'),[]);
  await run("document.getElementById('day').value='2';document.getElementById('day').dispatchEvent(new Event('change'))");await stable();assert.equal((await state()).scene,'disney');assert.deepEqual((await state()).places,['Q865312']);
  await run("document.getElementById('day').value='3';document.getElementById('day').dispatchEvent(new Event('change'))");await stable();assert.equal((await state()).scene,'shanghai');assert.equal((await state()).places.length,2);
  for(const level of ['2d','flat','3d']){
    const ready=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:new URL('./world.html',import.meta.url).href});await ready;
    const next=browser.cdp.waitFor('Page.loadEventFired',session);await run("document.getElementById('precision').value="+JSON.stringify(level)+";document.getElementById('apply').click()");await next;await stable();
    assert.equal(await run('Archify.travel.scene()'),'shanghai');assert.equal((await state()).active,level!=='2d');if(level!=='2d')assert.equal((await state()).heightMode,level==='3d');
  }
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"const native=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...args){return kind.startsWith('webgl')?null:native.call(this,kind,...args)}"});
  await load('?fallback');assert.equal((await state()).failed,true);assert.equal(await run("document.querySelector('.diagram-container').hidden"),false);assert.equal(await run('Archify.travel.visible().length'),4);
});
