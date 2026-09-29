import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { desktopBrowser } from '../../archify/test/helpers/desktop-browser.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
test('travel artifact is reproducible and source coordinates have valid provenance', () => {
  execFileSync(process.execPath, [path.join(root,'build.mjs'), '--check']);
  const places=JSON.parse(fs.readFileSync(path.join(root,'data/places.json')));
  assert.equal(new Set(places.map(p=>p.id)).size,8);
  for(const p of places){assert.ok(p.source.endsWith(p.id));assert.ok(p.coordinates[0]>-6&&p.coordinates[0]<10);assert.ok(p.coordinates[1]>41&&p.coordinates[1]<52);}
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'data/paris-arrondissements.geojson'))).features.length,20);
});
test('country/city navigation, filtering, detail, depth, saved state, links and responsive camera work in Chrome', {skip:!process.env.ARCHIFY_CHROME}, async t => {
  const browser=desktopBrowser(process.env.ARCHIFY_CHROME);t.after(()=>browser.close());const session=await browser.sessionPromise;
  const send=(method,params={})=>browser.cdp.send(method,params,session);
  const run=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result?.value;};
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.travelErrors=[];addEventListener('error',e=>travelErrors.push(e.message));addEventListener('unhandledrejection',e=>travelErrors.push(String(e.reason)));"});
  const url=pathToFileURL(path.join(root,'index.html')).href;
  let loadNumber=0;
  async function load(hash=''){const ready=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:url+'?test='+ (++loadNumber)+hash});await ready;await stable();}
  async function stable(){await run('(async()=>{await document.fonts.ready;for(let i=0;i<12;i++)await new Promise(requestAnimationFrame);})()');}
  async function shot(name){if(!process.env.ARCHIFY_TRAVEL_EVIDENCE)return;fs.mkdirSync(process.env.ARCHIFY_TRAVEL_EVIDENCE,{recursive:true});const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(process.env.ARCHIFY_TRAVEL_EVIDENCE,name+'.png'),Buffer.from(r.data,'base64'));}
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});await load();
  assert.deepEqual(await run('travelErrors'),[]);
  assert.equal(await run('Archify.travel.scene()'),'france');assert.equal(await run('Archify.travel.visible().length'),4);
  await shot('france');
  await run("document.querySelector('.place-row[data-place=Q90]').click();document.getElementById('enter-city').click()");await stable();
  assert.equal(await run('Archify.travel.scene()'),'paris');assert.equal(await run("document.querySelectorAll('.district').length"),20);
  await shot('paris');
  await run("document.getElementById('day').value='1';document.getElementById('day').dispatchEvent(new Event('change'))");
  assert.deepEqual(await run('Archify.travel.visible()'),['Q243','Q64436']);
  await run("document.querySelector('.poi[data-place=Q243]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");assert.equal(await run('Archify.travel.selected()'),'Q243');
  await run("document.getElementById('save').click()");assert.equal(await run("document.getElementById('save').getAttribute('aria-pressed')"),'true');
  await run('Archify.view.zoomAt(2,900,400)');await stable();assert.equal(await run("document.querySelector('.diagram-container').dataset.travelDepth"),'detail');
  const before=await run('Archify.view.state()');await run('Archify.view.panBy(90,30)');assert.notEqual((await run('Archify.view.state()')).x,before.x);
  await run("document.getElementById('search').value='no-match';document.getElementById('search').dispatchEvent(new Event('input'))");assert.equal(await run('Archify.travel.visible().length'),0);assert.equal(await run("document.getElementById('detail').hidden"),true);
  await load('#scene=paris&place=Q243');assert.equal(await run('Archify.travel.selected()'),'Q243');assert.equal(await run("document.getElementById('save').getAttribute('aria-pressed')"),'true');
  await run("document.getElementById('country').click();document.getElementById('search').value='Louvre';document.getElementById('search').dispatchEvent(new Event('input'));document.querySelector('.place-row').click()");assert.equal(await run('Archify.travel.scene()'),'paris');assert.equal(await run('Archify.travel.selected()'),'Q19675');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await stable();assert.ok(await run('document.documentElement.scrollWidth<=innerWidth+1'));await shot('mobile');
  assert.deepEqual(await run('travelErrors'),[]);
});
