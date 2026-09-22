import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import { readAtlasBundle } from '../renderers/shared/atlas-bundle.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
test('atlas real browser initializes, navigates three levels and restores a visit camera', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for actual browser atlas acceptance.',
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-atlas-browser-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'atlas.html');
  execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', 'atlas', path.join(root, 'examples/atlas/project.atlas.json'), output, '--json']);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression, awaitPromise = false) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.atlasErrors=[];addEventListener('error',e=>atlasErrors.push(e.message));
    addEventListener('unhandledrejection',e=>atlasErrors.push(String(e.reason)));
    addEventListener('message',e=>{if(e.data?.archifyAtlas===1 && e.data.type==='init')window.atlasInit=e.data;});
    addEventListener('message',e=>{if(e.data?.type==='init' && parent.failNextLayout) {
      parent.failNextLayout=false;
      Object.defineProperty(document.fonts,'ready',{get:()=>Promise.reject(new Error('Acceptance layout failure'))});
    }});
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  async function ready(id) {
    return run(`new Promise((resolve,reject)=>{let samples=0,equal=0,previous='';const timer=setInterval(()=>{
      const frame=document.querySelector('iframe[data-atlas-state=active]');const child=frame?.contentWindow;
      const current=child?.Archify && child.ArchifyAddress.active && !child.ArchifyAddress.restoring && child.ArchifyAddress.context.diagram===${JSON.stringify(id)}
        ? JSON.stringify(child.Archify.view.state()) : '';
      equal=current && current===previous ? equal+1 : 0;previous=current;
      if(equal>=5){clearInterval(timer);resolve({diagram:child.ArchifyAddress.context.diagram,errors:[...atlasErrors,...child.atlasErrors],count:document.querySelectorAll('iframe').length});}
      else if(++samples>150){clearInterval(timer);reject(new Error('Atlas did not become ready: '+document.getElementById('atlas-error').textContent));}
    },40);})`, true);
  }
  const child = `document.querySelector('iframe[data-atlas-state=active]').contentWindow`;
  async function focusNode(id) {
    await run(`${child}.Archify.focus.set(${JSON.stringify(id)},{toggle:false})`);
    await run('new Promise(resolve=>setTimeout(resolve,0))', true);
  }
  async function openDirectory() {
    await run(`(()=>{if(document.getElementById('atlas-directory').hidden)document.getElementById('atlas-directory-toggle').click();})()`);
    await ready('system');
  }
  async function directoryDetail(node) {
    await run(`document.querySelector('[data-atlas-diagram="'+${child}.ArchifyAddress.context.details[${JSON.stringify(node)}]+'"]').click()`);
  }
  await send('Page.navigate', { url: pathToFileURL(output).href });
  assert.deepEqual(await ready('system'), { diagram: 'system', errors: [], count: 1 });
  await run(`${child}.Archify.focus.set('controller',{toggle:false})`);
  await run(`${child}.Archify.motionGovernor.pause()`);
  await run(`${child}.Archify.view.centerAt(500,250,{scale:1.75,instant:true})`);
  await ready('system');
  const camera = await run(`${child}.Archify.view.snapshot()`);
  const scroll = await run(`({x:${child}.scrollX,y:${child}.scrollY})`);
  const anchorExpression = `(()=>{const r=${child}.document.querySelector('[data-node-id="controller"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`;
  const anchor = await run(anchorExpression);
  await run(`${child}.document.querySelector('[data-atlas-detail="controller"]').click()`);
  await ready('payment');
  const parentContext = await run(`(${readAtlasBundle.toString()})(JSON.parse(document.getElementById('archify-atlas-data').textContent)).bundle.members.payment.parentContext`);
  assert.ok(parentContext.some(edge => !edge.id) && parentContext.some(edge => edge.id));
  assert.equal(await run(`${child}.document.querySelectorAll('#atlas-context button').length`), parentContext.filter(edge => edge.id).length);
  assert.equal(await run(`${child}.document.querySelector('[data-node-id="redis"]').getAttribute('data-node-kind')`), 'database');
  await focusNode('controller');
  await run(`${child}.document.querySelector('[data-atlas-detail="controller"]').click()`);
  await ready('worker');
  assert.match(await run(`${child}.document.querySelector('.atlas-heading').textContent`), /订单平台总览.*支付模块.*执行器/);
  await run('history.back()'); await ready('payment');
  await run('history.back()'); await ready('system');
  const restored = await run(`${child}.Archify.view.snapshot()`);
  const restoredAnchor = await run(anchorExpression);
  const restoredScroll = await run(`({x:${child}.scrollX,y:${child}.scrollY})`);
  assert.ok(Math.abs(restoredScroll.x-scroll.x)<=2 && Math.abs(restoredScroll.y-scroll.y)<=2);
  assert.ok(Math.abs(restored.scrollLeft-camera.scrollLeft)<=2 && Math.abs(restored.scrollTop-camera.scrollTop)<=2);
  assert.ok(Math.abs(restoredAnchor.x - anchor.x) <= 2 && Math.abs(restoredAnchor.y - anchor.y) <= 2, JSON.stringify({ anchor, restoredAnchor }));
  assert.equal(await run(`${child}.Archify.focus.active()`), 'controller');
  assert.equal(await run(`${child}.Archify.motionGovernor.mode()`), 'still');
  assert.ok(Math.abs(restored.scale / camera.scale - 1) <= 0.001, JSON.stringify({ camera, restored }));
  assert.ok(Math.abs(restored.centerX - camera.centerX) < 2, JSON.stringify({ camera, restored }));
  assert.ok(Math.abs(restored.centerY - camera.centerY) < 2, JSON.stringify({ camera, restored }));
  for (let cycle = 0; cycle < 20; cycle++) {
    await run(`${child}.document.querySelector('[data-atlas-detail="controller"]').click()`);
    await ready('payment');
    await run('history.back()');
    assert.equal((await ready('system')).count, 1);
  }
  await run(`${child}.document.querySelector('[data-atlas-detail="controller"]').click()`);
  await ready('payment');
  await focusNode('redis');
  await run(`${child}.document.querySelector('[data-atlas-reference="redis"]').click()`);
  await ready('system');
  assert.equal(await run(`${child}.Archify.focus.active()`), 'redis');
  assert.match(await run('location.hash'), /diagram=system.*focus=redis/);
  await run('history.back()'); await ready('payment');
  const stableEntry = await run('history.state');
  await run(`(()=>{
    const frame=document.querySelector('iframe[data-atlas-state=active]'),current=frame.contentWindow.atlasInit;
    for(const key of ['sessionId','entryId','transaction'])for(const type of ['state','snapshot','error','ready'])window.dispatchEvent(new MessageEvent('message',{
      source:frame.contentWindow,data:{...current,type,[key]:'stale',href:location.href+'&focus=missing',snapshot:{camera:{scale:3}},message:'stale failure'}
    }));
  })()`);
  assert.deepEqual(await run('history.state'), stableEntry);
  assert.equal((await ready('payment')).count, 1);
  await focusNode('controller');
  await run(`(()=>{const entry=history.state.entryId;${child}.document.querySelector('[data-atlas-detail="controller"]').click();if(history.state.entryId!==entry)throw new Error('Preparation must not push history');history.back();})()`);
  await ready('system');
  await run('history.forward()'); await ready('payment');
  for (const action of [
    `Archify.routeProbe.begin({source:'users',focusNode:false});Archify.routeProbe.choose('db');`,
    `Archify.focus.set('controller',{toggle:false});Archify.focus.reach('downstream',{toggle:false,reveal:false});`,
    `Archify.semanticLens.select('backend');`,
    `Archify.guidedViews.activate('request-path');`,
  ]) {
    await send('Page.navigate', { url: 'about:blank' });
    await send('Page.navigate', { url: pathToFileURL(output).href + '?theme=light&preset=blueprint#diagram=system' });
    await ready('system');
    await openDirectory();
    await run(`${child}.eval(${JSON.stringify(action)})`);
    await ready('system');
    const semantic = `(()=>{const a=${child}.Archify;return {focus:a.focus.active(),route:a.routeProbe.result(),reach:a.focus.reachability(),lens:a.semanticLens.active(),chapter:a.guidedViews.active()};})()`;
    const before = await run(semantic);
    await directoryDetail('controller');
    await ready('payment');
    await run('history.back()'); await ready('system');
    assert.deepEqual(await run(semantic), before);
    assert.match(await run('location.search'), /theme=light.*preset=blueprint/);
  }
  // A clicked story stop is committed reading state, unlike playback progress.
  await run(`${child}.document.querySelector('[data-story-node="cdn"]').click()`);
  await ready('system');
  const manualBeat = await run(`${child}.Archify.guidedViews.beat()`);
  const beatCamera = await run(`${child}.Archify.view.snapshot()`);
  assert.equal(manualBeat.nodeId, 'cdn');
  await directoryDetail('controller');
  await ready('payment');
  await run('history.back()'); await ready('system');
  assert.deepEqual(await run(`${child}.Archify.guidedViews.beat()`), manualBeat,
    'Returning to a visit must restore its manually selected story stop');
  const restoredBeatCamera = await run(`${child}.Archify.view.snapshot()`);
  assert.ok(Math.abs(restoredBeatCamera.centerX - beatCamera.centerX) <= 2);
  assert.ok(Math.abs(restoredBeatCamera.centerY - beatCamera.centerY) <= 2);
  assert.ok(Math.abs(restoredBeatCamera.scale / beatCamera.scale - 1) <= 0.001);
  assert.equal(await run(`${child}.Archify.guidedViews.isPlaying()`), false);
  assert.equal(await run(`${child}.Archify.motionGovernor.mode()`), 'still');
  await run(`${child}.Archify.motionGovernor.resume()`);
  assert.equal(await run(`${child}.Archify.guidedViews.playCurrent()`), true);
  await run(`new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{
    const beat=${child}.Archify.guidedViews.beat();
    if(beat && beat.nodeId!=='cdn'){clearInterval(timer);resolve();}
    else if(++n>100){clearInterval(timer);reject(new Error('Story playback did not advance'));}
  },100);})`, true);
  assert.equal(await run(`new URLSearchParams(location.hash.slice(1)).get('beat')`), 'cdn',
    'Automatic playback must not overwrite the manually committed stop');
  await run(`${child}.Archify.guidedViews.pause()`);
  await send('Page.navigate', { url: pathToFileURL(output).href + '#diagram=orders' });
  await ready('orders');
  await focusNode('redis');
  await run(`${child}.document.querySelector('[data-atlas-reference="redis"]').click()`);
  await ready('system');
  assert.equal(await run(`${child}.Archify.focus.active()`), 'redis');
  await run('history.back()'); await ready('orders');
  await send('Page.navigate', { url: pathToFileURL(output).href + '#diagram=payment' });
  await ready('payment');
  await run(`${child}.Archify.routeProbe.begin({source:'controller',focusNode:false});${child}.Archify.routeProbe.choose('db')`);
  assert.deepEqual((await run(`${child}.Archify.routeProbe.result()`)).nodes, ['controller','db']);
  await run(`${child}.Archify.routeProbe.begin({source:'db',focusNode:false});${child}.Archify.routeProbe.choose('controller')`);
  assert.equal(await run(`${child}.Archify.routeProbe.result()`), null, 'Outbound HTTP does not create a reverse response edge or a cross-layer path');
  await run(`${child}.Archify.routeProbe.clear();${child}.Archify.focus.inspectRelationshipById('jwt-verification',{toggle:false})`);
  assert.deepEqual(await run(`${child}.Archify.focus.relationship()`), {id:'jwt-verification',key:await run(`${child}.Archify.focus.relationship().key`),from:'auth',to:'controller',label:'webhook'});
  await run(`${child}.document.getElementById('atlas-parent').open=true;${child}.document.querySelector('#atlas-context button').click()`); await ready('system');
  assert.equal(await run(`${child}.Archify.focus.relationship().id`), parentContext.find(edge=>edge.id).id);
  await run('history.back()'); await ready('payment');
  await focusNode('controller');
  await run(`window.failNextLayout=true;${child}.document.querySelector('[data-atlas-detail="controller"]').click()`);
  const failureMessage = await run(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{
    const text=document.getElementById('atlas-error').textContent;
    if(text.includes('Acceptance layout failure')){clearInterval(t);resolve(text);}
    else if(++n>100){clearInterval(t);reject(new Error('Expected scoped startup failure'));}
  },30);})`, true);
  assert.ok(failureMessage.includes(await run(`(${readAtlasBundle.toString()})(JSON.parse(document.getElementById('archify-atlas-data').textContent)).bundle.members.worker.title`)),
    'The scoped failure identifies the requested diagram by its user-facing title');
  assert.equal(await run('document.querySelectorAll("iframe").length'), 1, 'Explicit failure preserves the committed member');
  assert.equal(await run(`${child}.ArchifyAddress.context.diagram`), 'payment');
  assert.match(await run('location.hash'), /diagram=payment/);
  await run(`document.querySelector('#atlas-error button').click()`); await ready('worker');
  await run('history.back()'); await ready('payment');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await run(`${child}.document.querySelector('[data-atlas-detail="controller"]').click()`); await ready('worker');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await run('history.back()'); await ready('payment');
  const resized = await run(`${child}.Archify.view.snapshot()`);
  assert.ok(Number.isFinite(resized.centerX) && Number.isFinite(resized.centerY) && resized.scale > 0);
  await send('Page.navigate', { url: pathToFileURL(output).href + '#diagram=worker&focus=controller' });
  await ready('worker');
  assert.equal(await run(`${child}.Archify.focus.active()`), 'controller');
  await send('Page.navigate', { url: pathToFileURL(output).href + '#diagram=worker&focus=missing' });
  assert.match(await run(`new Promise(resolve=>setTimeout(()=>resolve(document.getElementById('atlas-error').textContent),200))`, true), /missing/);
  await send('Page.navigate', { url: pathToFileURL(output).href + '#diagram=constructor' });
  assert.match(await run(`new Promise(resolve=>setTimeout(()=>resolve(document.getElementById('atlas-error').textContent),200))`, true), /constructor/);
  assert.equal(await run('document.querySelectorAll("iframe").length'), 0);
});

test('atlas keeps its directory and node inspector outside the graph reading area', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for actual browser atlas acceptance.',
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-atlas-ui-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'atlas.html');
  execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', 'atlas', path.join(root, 'examples/atlas/project.atlas.json'), output, '--json']);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression, member = true) {
    const result = await send('Runtime.evaluate', {
      expression: member ? `document.querySelector('iframe[data-atlas-state=active]').contentWindow.eval(${JSON.stringify(expression)})` : expression,
      returnByValue: true, awaitPromise: true,
    });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  const runWorkbench = expression => run(expression, false);
  async function ready(id) {
    await run(`new Promise((resolve,reject)=>{let n=0;const t=setInterval(()=>{
      const w=document.querySelector('iframe[data-atlas-state=active]')?.contentWindow;
      if(w?.Archify && w.ArchifyAddress.active && !w.ArchifyAddress.restoring && w.ArchifyAddress.context.diagram===${JSON.stringify(id)}){clearInterval(t);resolve();}
      else if(++n>200){clearInterval(t);reject(new Error('Atlas navigation did not settle'));}
    },30)})`, false);
    await run('Archify.readerLayout.whenStable()');
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: pathToFileURL(output).href + '?theme=light' });
  await ready('system');
  assert.equal(await run('document.querySelector("header")===null', false), true);
  assert.equal(await runWorkbench('document.getElementById("atlas-directory").hidden'), true, 'The directory opens on demand at every layout size');
  assert.equal(await run('document.getElementById("atlas-back").getBoundingClientRect().height'), 0);
  assert.equal(await run('document.querySelector(".header [data-atlas-detail],.header [data-atlas-reference]")===null'), true);
  assert.equal(await run('document.querySelector(".atlas-focus-navigation").hidden'), true);
  assert.equal(await run('document.querySelector("[data-node-id=controller] [data-atlas-detail-mark]")!==null'), true);
  const point = await run(`(()=>{const r=document.querySelector('[data-node-id=controller]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  assert.equal(await run('ArchifyAddress.context.diagram'), 'system', 'Ordinary node click must keep the current diagram');
  assert.equal(await run('Archify.focus.active()'), 'controller');
  assert.equal(await run(`document.querySelector('#focus-chip [data-atlas-detail=controller]').textContent`), '进入 支付模块 →');
  await run(`document.querySelector('[data-atlas-detail=controller]').focus()`);
  await run(`document.getElementById('focus-id').textContent='controller';new Promise(resolve=>setTimeout(resolve,0))`);
  assert.equal(await run('document.activeElement.dataset.atlasDetail'), 'controller', 'Refreshing passport identity must not replace a keyboard-focused action');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await ready('payment');
  assert.equal(await run(`document.querySelectorAll('.atlas-breadcrumb button').length`), 1);
  await run(`Archify.focus.set('redis',{toggle:false});new Promise(resolve=>setTimeout(resolve,0))`);
  assert.equal(await run(`document.querySelectorAll('#focus-chip [data-atlas-detail]').length`), 0);
  assert.equal(await run(`document.querySelector('[data-atlas-reference=redis]').textContent`), '查看 订单平台总览 中的定义 ↗');
  await run(`document.querySelector('[data-atlas-reference=redis]').click()`); await ready('system');
  assert.equal(await run('Archify.focus.active()'), 'redis');
  assert.equal(await run('document.querySelector(".atlas-focus-navigation").hidden'), true);
  await run(`document.getElementById('atlas-back').click()`); await ready('payment');
  assert.equal(await run('Archify.focus.active()'), 'redis');
  await runWorkbench(`if(!document.getElementById('atlas-directory').hidden)document.getElementById('atlas-directory-toggle').click()`);
  const directoryPoint = await runWorkbench(`(()=>{const r=document.getElementById('atlas-directory-toggle').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...directoryPoint, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...directoryPoint, button: 'left', clickCount: 1 });
  assert.deepEqual(await runWorkbench(`Array.from(document.querySelectorAll('[data-atlas-diagram]'),b=>b.dataset.atlasDiagram)`), ['system','payment','worker','orders']);
  assert.equal(await runWorkbench(`document.querySelector('[data-atlas-diagram=payment]').getAttribute('aria-current')`), 'page');
  assert.equal(await run('Archify.focus.active()'), 'redis', 'Directory chrome must preserve the reading state');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  assert.equal(await runWorkbench('document.getElementById("atlas-directory").hidden'), true);
  assert.equal(await runWorkbench('document.activeElement.id'), 'atlas-directory-toggle');
  assert.equal(await run('Archify.focus.active()'), 'redis');
  await run(`Archify.focus.setMany(['controller','redis'],{toggle:false});new Promise(resolve=>setTimeout(resolve,0))`);
  assert.equal(await run('document.querySelector(".atlas-focus-navigation").hidden'), true);
  for (const [width,height,theme,preset] of [[1440,900,'light','classic'],[1440,900,'dark','blueprint'],[1600,1000,'light','editorial'],[720,900,'dark','signal-flow']]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: pathToFileURL(output).href + `?theme=${theme}&preset=${preset}#diagram=worker` });
    await ready('worker');
    assert.equal(await run('document.getElementById("atlas-back").hidden'), true, 'Cold deep links have structural ancestors, no invented visit');
    assert.equal(await run(`document.querySelectorAll('.atlas-breadcrumb button').length`), 2);
    await runWorkbench(`if(document.getElementById('atlas-directory').hidden)document.getElementById('atlas-directory-toggle').click()`);
    const geometry = await runWorkbench(`(()=>{const d=document.getElementById('atlas-directory'),r=d.getBoundingClientRect();return {overflow:document.documentElement.scrollWidth>innerWidth,visible:!d.hidden,inside:r.left>=0&&r.right<=innerWidth,background:getComputedStyle(d).backgroundColor,panel:getComputedStyle(document.documentElement).getPropertyValue('--toolbar-menu-bg').trim()}})()`);
    assert.equal(geometry.overflow, false, JSON.stringify({width,preset,geometry}));
    assert.equal(await run('document.documentElement.scrollWidth>innerWidth'), false,
      'The member document also stays inside its viewport behind the persistent directory');
    assert.equal(geometry.visible && geometry.inside, true);
    assert.equal(await runWorkbench(`getComputedStyle(document.getElementById('atlas-directory')).visibility`), 'visible', 'The themed directory remains readable');
  }
});

test('atlas rail keeps graph geometry stable and preserves focus through responsive moves', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for actual browser atlas acceptance.',
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-atlas-rail-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = path.join(directory, 'atlas.html');
  execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', 'atlas', path.join(root, 'examples/atlas/project.atlas.json'), output, '--json']);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression, outer = false) {
    const result = await send('Runtime.evaluate', {
      expression: outer ? expression : `document.querySelector('iframe[data-atlas-state=active]').contentWindow.eval(${JSON.stringify(expression)})`,
      returnByValue: true, awaitPromise: true,
    });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  const runWorkbench = expression => run(expression, true);
  async function stable() {
    await run('Archify.readerLayout.whenStable()');
    await run('Archify.viewerChromeLayout.whenStable()');
  }
  async function viewport(width, height) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }
  const graphRect = `(()=>{const r=document.querySelector('.diagram-container').getBoundingClientRect(),s=document.querySelector('.diagram-container>svg').getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,svgWidth:s.width,svgHeight:s.height}})()`;
  for (const [width, height, theme] of [[1440,900,'light'],[1600,1000,'dark'],[1920,1080,'dark'],[2048,1320,'light']]) {
    await viewport(width, height);
    await send('Page.navigate', { url: pathToFileURL(output).href + `?theme=${theme}` });
    await run(`new Promise((resolve,reject)=>{let n=0;const timer=setInterval(()=>{const w=document.querySelector('iframe[data-atlas-state=active]')?.contentWindow;if(w?.Archify&&w.ArchifyAddress.active && !w.ArchifyAddress.restoring){clearInterval(timer);resolve();}else if(++n>200){clearInterval(timer);reject(new Error('Atlas did not initialize'));}},30)})`, true);
    await stable();
    assert.equal(await run('document.documentElement.dataset.atlasLayout'), 'rail');
    assert.equal(await runWorkbench('document.getElementById("atlas-directory").hidden'), true, 'Wide screens start with the reading workbench');
    const initial = await run(graphRect);
    const rail = await run(`(()=>{const r=document.querySelector('.atlas-rail').getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}})()`);
    assert.ok(rail.left>=0 && rail.width>0, 'The workbench is visible within the left margin');
    assert.ok(rail.right+20<=initial.x+.1, 'The rail and graph have a clear gutter');
    assert.ok(initial.x+initial.width<=width-15, 'Translation must keep the full graph inside the viewport');
    await run(`Archify.focus.set('controller',{toggle:false});new Promise(resolve=>setTimeout(resolve,0))`);
    await stable();
    assert.deepEqual(await run(graphRect), initial, 'Selecting a node must neither move nor shrink the graph');
    assert.equal(await run(`document.querySelector('.diagram-container').contains(document.getElementById('focus-chip'))`), false);
    const selectedRect = await run(`document.querySelector('[data-atlas-detail=controller]').getBoundingClientRect().toJSON()`);
    assert.ok(selectedRect.left>=rail.left && selectedRect.right<=rail.right && selectedRect.bottom<height);
    await run(`document.querySelector('[data-atlas-tab=sources]').click()`); await stable();
    assert.deepEqual(await run(graphRect), initial, 'Inspecting evidence must preserve graph geometry');
    await runWorkbench(`document.getElementById('atlas-directory-toggle').click()`); await stable();
    assert.deepEqual(await run(graphRect), initial, 'Opening the directory must preserve graph geometry');
    await runWorkbench(`document.getElementById('atlas-directory-toggle').click()`); await stable();
    assert.equal(await run('Archify.focus.active()'), 'controller');
    assert.equal(await run('document.documentElement.scrollWidth<=innerWidth'), true);
    // Move the same keyboard-focused control, rather than replacing it, when
    // the rail stops fitting. The document may scroll vertically at this size.
    await run(`document.querySelector('[data-atlas-detail=controller]').focus()`);
    await viewport(1000, 900); await stable();
    assert.equal(await run('document.documentElement.dataset.atlasLayout'), 'stacked');
    assert.equal(await run('document.activeElement.dataset.atlasDetail'), 'controller', 'Responsive moves must preserve keyboard focus');
    assert.equal(await run(`document.querySelector('.atlas-inspection-slot').contains(document.getElementById('focus-chip'))`), true);
    assert.equal(await run(`document.querySelector('.atlas-compact-navigation').contains(document.querySelector('.atlas-workbench-placeholder'))`), true,
      'Compact document flow retains a measured slot for the persistent host directory');
    assert.equal(await runWorkbench(`document.getElementById('atlas-workbench').contains(document.getElementById('atlas-directory'))`), true);
    const compact = await run(graphRect);
    assert.equal(await run(`document.getElementById('focus-chip').getBoundingClientRect().top>=document.querySelector('.container').getBoundingClientRect().bottom`), true, 'Compact inspection follows the reading content');
    await run('Archify.focus.clear()'); await stable();
    assert.deepEqual(await run(graphRect), compact, 'Clearing compact inspection must preserve the graph');
    assert.equal(await run(`getComputedStyle(document.querySelector('.atlas-inspection-slot')).display`), 'none', 'No empty inspector adds compact-page overflow');
    await viewport(720, 900); await stable();
    assert.equal(await run('document.documentElement.scrollWidth<=innerWidth'), true);
    await runWorkbench(`document.getElementById('atlas-directory-toggle').click()`); await stable();
    assert.equal(await runWorkbench('document.getElementById("atlas-directory").hidden'), false);
    assert.equal(await run('document.documentElement.scrollWidth<=innerWidth'), true);
  }
});
