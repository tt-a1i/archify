import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {createJourney,validateJourney,clipWater} from './journey.mjs';
import {sampleElevation,terrainHeight,generalizeElevation} from './elevation.js';
import {ChromeVisualBrowser} from '../../archify/bin/visual-check.mjs';
const sample=()=>JSON.parse(fs.readFileSync(new URL('./examples/host-journey.json',import.meta.url)));
test('overview elevation is coarse, sourced, geographically aligned and excluded from daily detail',()=>{
  const input=sample(),flat=createJourney(input);
  input.elevation={bounds:[120,30,123,33],columns:2,rows:2,values:[0,100,50,150],source:'https://example.com/dem',attribution:'Test slope'};
  const raised=createJourney(input),grid=raised.journey.tiles.journey.elevation;
  assert.equal(grid.values.length,4225);assert.ok(grid.maximum>grid.minimum);assert.ok(grid.exaggeration>=1&&grid.exaggeration<=12);
  assert.ok(terrainHeight(grid,410,-410)>terrainHeight(grid,-410,-410));
  assert.equal(sampleElevation(input.elevation,.2,.3),35);assert.equal(sampleElevation(input.elevation,.8,.7),115);
  assert.deepEqual(raised.places.map(p=>p.views),flat.places.map(p=>p.views));assert.equal(raised.journey.tiles['day-1'].elevation,undefined);
  for(const change of [e=>e.values=[0],e=>e.values[0]=NaN,e=>e.source='javascript:foo',e=>e.columns=130,e=>e.bounds=[0,0,1,1]]){const bad=structuredClone(input);change(bad.elevation);assert.throws(()=>createJourney(bad),/高程/);}
});
test('overview generalization removes isolated spikes and preserves broad slopes',()=>{
  const slope=Array.from({length:81},(_,i)=>i%9+2*Math.floor(i/9));
  assert.equal(generalizeElevation(slope,9,9)[40],slope[40]);
  const spike=Array(81).fill(0);spike[40]=100;const result=generalizeElevation(spike,9,9);
  assert.ok(result[40]<20);assert.ok(result.every(v=>v>=0&&v<=100));
});
test('water crossing the tile is clipped, retained in overview, and absent off-tile',()=>{
  const polygon=clipWater([[0,300],[1400,300],[1400,600],[0,600]]);
  assert.equal(polygon.length,4);assert.ok(polygon.every(([x,y])=>x>=290&&x<=1110&&y>=115&&y<=935));
  assert.deepEqual(clipWater([[0,0],[10,0],[0,10]]),[]);
  const input=sample();const p=input.places.find(p=>p.id===input.days[0].stops[0].placeId).coordinates;
  input.days[0].geography={source:'https://www.openstreetmap.org/copyright',roads:[],buildings:[],water:[[[p[0]-.1,p[1]-.002],[p[0]+.1,p[1]-.002],[p[0]+.1,p[1]+.002],[p[0]-.1,p[1]+.002]]]};
  const data=createJourney(input);assert.equal(data.journey.tiles.journey.water.length,1);assert.equal(data.journey.tiles['day-1'].water.length,1);
  input.days=input.days.slice(0,1);input.days[0].stops=[{placeId:input.days[0].stops[0].placeId,time:'上午',duration:'1 小时'}];
  input.days[0].geography.water=[[[p[0]-.002,p[1]-.001],[p[0]-.001,p[1]-.001],[p[0]-.001,p[1]+.001],[p[0]-.002,p[1]+.001]]];
  const west=createJourney(input).journey.tiles['day-1'].water;assert.equal(west.length,1);assert.ok(west[0].every(([x])=>x>290&&x<700),'nearby water west of the first landmark must not wrap around the globe');
});
test('overview preserves geographic direction, distance ratios and positions independent of visit order',()=>{
  const input=sample();input.days=input.days.slice(0,1);input.places=input.places.slice(0,3);
  input.places.forEach((p,i)=>{p.coordinates=[121+i*.01,31];});
  input.days[0].stops=input.places.map(p=>({placeId:p.id,time:'上午',duration:'1 小时'}));
  const result=createJourney(input),[a,b,c]=result.places.map(p=>p.views.journey);
  assert.ok(a[0]<b[0]&&b[0]<c[0]);assert.equal(a[1],c[1]);assert.ok(Math.abs((c[0]-a[0])/(b[0]-a[0])-2)<1e-8);
  input.days[0].stops.reverse();const reversed=createJourney(input);
  for(const p of result.places)assert.deepEqual(p.views.journey,reversed.places.find(q=>q.placeId===p.placeId).views.journey);
  assert.equal(reversed.journey.plan.routes.length,2);
});
test('host contract supports different duration, repeated visits, long days and rejects unsafe/invalid input',()=>{
  const input=sample();input.days.push({day:5,title:'自由安排',stops:Array.from({length:7},()=>({...input.days[0].stops[0]}))});
  const result=createJourney(input);assert.equal(result.journey.plan.days.length,5);assert.equal(result.places.length,13);assert.equal(result.journey.plan.routes.length,12);assert.equal(new Set(result.places.map(p=>p.id)).size,13);assert.ok(result.flows.journey.workflow.lanes.some(l=>l.id==='day5-1'));
  for(const change of [x=>x.places[0].icon='javascript',x=>x.places[0].source='javascript:alert(1)',x=>x.places[0].coordinates=[181,0],x=>x.days[0].stops[0].placeId='missing',x=>x.days[0].day=0]){const bad=sample();change(bad);assert.throws(()=>validateJourney(bad),/行程数据无效/);}
});
test('daily geography is clipped while overview stays geometry-free, including the date line',()=>{
  const input=sample();input.days=input.days.slice(0,1);input.places=input.places.slice(0,2);input.places[0].coordinates=[179.999,10];input.places[1].coordinates=[-179.999,10];input.days[0].stops=input.places.map(p=>({placeId:p.id,time:'上午',duration:'1 小时'}));
  input.days[0].geography={source:'https://www.openstreetmap.org/copyright',roads:[[[179.999,10],[-179.999,10]],[[0,0],[1,1]]],water:[],buildings:[{coordinates:[[179.999,10],[179.9991,10],[179.9991,10.0001],[179.999,10]],height:12},{coordinates:[[0,0],[0,1],[1,1],[0,0]],height:20}]};
  const result=createJourney(input),tile=result.journey.tiles['day-1'];assert.equal(tile.buildings.length,1);assert.equal(tile.backdrop.length,1);assert.ok(result.places.every(p=>p.views['day-1'].every(Number.isFinite)));assert.equal(result.journey.tiles.journey.buildings.length,0);
});
test('host CLI delivers portable multi-day flow/3D, isolates visits and releases previous geometry',{skip:!process.env.ARCHIFY_CHROME},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-journey-')),output=path.join(dir,'trip.html');
  const stdout=execFileSync(process.execPath,[new URL('./render-journey.mjs',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),new URL('./examples/host-journey.json',import.meta.url).pathname.replace(/^\/(\w:)/,'$1'),output],{encoding:'utf8'});assert.equal(JSON.parse(stdout).days,4);
  const browser=new ChromeVisualBrowser(process.env.ARCHIFY_CHROME,{spawnImpl:(cmd,args,opts)=>spawn(cmd,['--use-angle=swiftshader','--enable-unsafe-swiftshader',...args],opts)});t.after(()=>browser.close());const session=await browser.sessionPromise;
  const send=(m,p={})=>browser.cdp.send(m,p,session),run=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result.value;};
  const stable=()=>run('(async()=>{for(let i=0;i<18;i++)await new Promise(requestAnimationFrame)})()');
  await send('Page.addScriptToEvaluateOnNewDocument',{source:"window.errors=[];addEventListener('error',e=>errors.push(e.message));addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));"});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  const loaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:pathToFileURL(output).href});await loaded;await stable();
  assert.equal(await run("document.querySelectorAll('#trip-days button').length"),5);assert.equal(await run("document.querySelectorAll('#flow-drawing [data-node-id]').length"),6);
  await run("document.getElementById('mode-3d').click()");await stable();assert.equal(await run('Archify.travel3d.state().routeArrows'),5);assert.equal(await run('Archify.travel3d.state().places.length'),6);const count=await run('Archify.travel3d.state().geometries');
  for(let i=0;i<3;i++){await run("document.querySelector('#trip-days [data-day=\"3\"]').click()");await stable();assert.equal(await run('Archify.travel3d.state().places.length'),1);assert.equal(await run('Archify.travel3d.state().routeArrows'),0);await run("document.querySelector('#trip-days [data-day=\"0\"]').click()");await stable();assert.equal(await run('Archify.travel3d.state().geometries'),count,'switches do not accumulate GPU geometry');}
  await run("document.querySelector('#trip-days [data-day=\"4\"]').click()");await stable();assert.equal(await run('Archify.travel3d.state().places.length'),1);assert.equal(await run('Archify.travel3d.state().scene'),'day-4');
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});await stable();assert.ok(await run('document.documentElement.scrollWidth<=innerWidth+1'));assert.deepEqual(await run('errors'),[]);
});
