import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {ChromeVisualBrowser} from '../../archify/bin/visual-check.mjs';
import {createServer} from './serve.mjs';

test('global map defaults offline; selected live buildings/terrain load and can be removed', {skip:!process.env.ARCHIFY_CHROME||!process.env.ARCHIFY_WORLD_LIVE,timeout:180000},async t=>{
  const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const browser=new ChromeVisualBrowser(process.env.ARCHIFY_CHROME,{spawnImpl:(c,a,o)=>spawn(c,['--use-angle=swiftshader','--enable-unsafe-swiftshader',...a],o)});t.after(()=>browser.close());const session=await browser.sessionPromise;
  const send=(m,p={})=>browser.cdp.send(m,p,session);
  const run=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result?.value;};
  const wait=async condition=>{for(let i=0;i<60;i++){if(await run(condition))return;await run('new Promise(r=>setTimeout(r,750))');}assert.fail(condition+'; '+JSON.stringify(await run('({state:window.ArchifyWorld?.state(),errors:worldErrors,status:document.getElementById("status").textContent})')));};
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.worldErrors=[];addEventListener('error',e=>worldErrors.push(e.message));addEventListener('unhandledrejection',e=>worldErrors.push(String(e.reason)))"});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  const loaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/world.html`});await loaded;
  await wait('window.ArchifyWorld?.state().ready&&ArchifyWorld.map.loaded()');assert.equal(await run('ArchifyWorld.state().requests'),0);assert.equal(await run('ArchifyWorld.state().terrain'),false);assert.deepEqual(await run('worldErrors'),[]);
  await run("document.getElementById('destination').value='paris';document.getElementById('destination').dispatchEvent(new Event('change'));document.getElementById('buildings').checked=true;document.getElementById('apply').click()");
  await wait("ArchifyWorld.state().ready&&ArchifyWorld.map.getLayer('building-3d')&&ArchifyWorld.map.queryRenderedFeatures({layers:['building-3d']}).length>0");
  assert.equal(await run("ArchifyWorld.map.getLayoutProperty('building-3d','visibility')"),'visible');assert.ok(await run('ArchifyWorld.state().requests>0'));assert.equal(await run('ArchifyWorld.state().terrain'),false);
  console.log('Live Paris buildings rendered');
  async function shot(name){if(!process.env.ARCHIFY_TRAVEL_EVIDENCE)return;fs.mkdirSync(process.env.ARCHIFY_TRAVEL_EVIDENCE,{recursive:true});const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(process.env.ARCHIFY_TRAVEL_EVIDENCE+'/'+name+'.png',Buffer.from(r.data,'base64'));}
  await shot('world-paris-buildings');
  await run("document.getElementById('destination').value='alps';document.getElementById('destination').dispatchEvent(new Event('change'));document.getElementById('buildings').checked=false;document.getElementById('terrain').checked=true;document.getElementById('apply').click()");
  await wait('ArchifyWorld.state().ready&&ArchifyWorld.state().terrain&&ArchifyWorld.map.queryTerrainElevation(ArchifyWorld.map.getCenter())>500');
  await wait('ArchifyWorld.map.areTilesLoaded()&&!ArchifyWorld.map.isMoving()');
  console.log('Live Alps elevation',await run('ArchifyWorld.map.queryTerrainElevation(ArchifyWorld.map.getCenter())'));await shot('world-alps-terrain');
  await run("document.getElementById('terrain').checked=false;document.getElementById('geography').value='light';document.getElementById('apply').click()");await wait('ArchifyWorld.state().ready&&!ArchifyWorld.state().terrain');assert.equal(await run("!!ArchifyWorld.map.getSource('terrain-dem')"),false);assert.equal(await run("!!ArchifyWorld.map.getLayer('building-3d')"),false);
  await run("window.fetch=()=>Promise.reject(new Error('fixture offline'));document.getElementById('geography').value='streets';document.getElementById('apply').click()");await wait("document.getElementById('status').textContent.includes('加载失败')");assert.equal(await run("!!ArchifyWorld.map.getLayer('countries')"),true);assert.equal(await run("document.getElementById('apply').disabled"),false);
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await run('void ArchifyWorld.map.resize()');assert.ok(await run('document.documentElement.scrollWidth<=innerWidth+1'));assert.deepEqual(await run('worldErrors'),[]);
});
