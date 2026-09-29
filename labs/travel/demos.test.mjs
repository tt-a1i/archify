import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
import {ChromeVisualBrowser} from '../../archify/bin/visual-check.mjs';

for(const city of ['shanghai','paris'])test(`${city} downloadable demo is current and works offline`,{skip:!process.env.ARCHIFY_CHROME},async t=>{
  const root=fileURLToPath(new URL('.',import.meta.url)),file=path.join(root,'demo',city+'.html'),temp=fs.mkdtempSync(path.join(os.tmpdir(),'archify-demo-'));
  execFileSync(process.execPath,[path.join(root,'build.mjs'),'--demo',city,'--output',path.join(temp,'demo.html')]);
  assert.equal(fs.readFileSync(file,'utf8'),fs.readFileSync(path.join(temp,'demo.html'),'utf8'),'download is reproducible from current sources');
  const browser=new ChromeVisualBrowser(process.env.ARCHIFY_CHROME,{spawnImpl:(cmd,args,options)=>spawn(cmd,['--use-angle=swiftshader','--enable-unsafe-swiftshader',...args],options)});t.after(()=>browser.close());const session=await browser.sessionPromise;
  const send=(m,p={})=>browser.cdp.send(m,p,session),run=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result?.value;};
  await send('Network.enable');await send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.demoErrors=[];addEventListener('error',e=>demoErrors.push(e.message));addEventListener('unhandledrejection',e=>demoErrors.push(String(e.reason)));"});
  const loaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:pathToFileURL(file).href});await loaded;
  const stable=()=>run('(async()=>{await document.fonts.ready;for(let i=0;i<25;i++)await new Promise(requestAnimationFrame)})()');await stable();
  assert.equal(await run("document.querySelectorAll('#flow-drawing [data-node-id]').length"),6);
  await run("document.getElementById('mode-3d').click()");await stable();assert.equal(await run('Archify.travel3d.state().routeArrows'),2);
  for(const day of [1,2,3]){await run(`document.querySelector('#trip-days [data-day="${day}"]').click()`);await stable();assert.equal(await run('Archify.travel3d.state().scene'),'day-'+day);assert.ok(await run('Archify.travel3d.state().detailBuildings>0'));}
  assert.deepEqual(await run('demoErrors'),[]);assert.equal(await run("performance.getEntriesByType('resource').filter(r=>/^https?:/.test(r.name)).length"),0,'offline demo requests no external resources');
});
