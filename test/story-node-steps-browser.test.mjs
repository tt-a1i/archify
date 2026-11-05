import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {findChrome} from '../archify/bin/visual-check.mjs';
import {desktopBrowser} from './helpers/desktop-browser.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const chrome=process.env.ARCHIFY_CHROME?findChrome():null;
test('Passport retains native appearance, keyboard focus, reach links, movement and dismissal',{
  skip:chrome?false:'Set ARCHIFY_CHROME for the real-browser Passport check.',
},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-passport-parity-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli=path.join(root,'archify/bin/archify.mjs'),fixture=path.join(root,'test/fixtures/story-node-steps');
  const native=path.join(dir,'native.html'),output=path.join(dir,'steps.html');
  execFileSync(process.execPath,[cli,'render','architecture',path.join(fixture,'diagram.json'),native]);
  execFileSync(process.execPath,[cli,'story','attach',native,path.join(fixture,'brief.json'),output]);
  const browser=desktopBrowser(chrome);t.after(()=>browser.close());const session=await browser.sessionPromise;
  const send=(method,params={})=>browser.cdp.send(method,params,session,30000);
  const run=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});assert.equal(r.exceptionDetails,undefined,JSON.stringify(r.exceptionDetails));return r.result?.value;};
  const settle=()=>run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  let navigation=0;
  const load=async(file=output,hash='focus=page',theme='light')=>{const loaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:pathToFileURL(file).href+'?theme='+theme+'&case='+(++navigation)+'#'+hash});await loaded;await settle();};
  const click=selector=>run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const key=async(key,code=key,modifiers=0)=>{await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});await settle();};
  await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await t.test('the inherited card shell and title styles match the native card in both themes',async()=>{
    const styles=()=>run(`Object.fromEntries(['#focus-chip','#focus-label','#focus-detail','#btn-focus-clear','#btn-focus-copy','.relationship-lens-head'].map(selector=>{const s=getComputedStyle(document.querySelector(selector));return [selector,Object.fromEntries(['fontFamily','fontSize','fontWeight','color','backgroundColor','backgroundImage','borderRadius','borderColor','boxShadow','backdropFilter','padding'].map(k=>[k,s[k]]))];}))`);
    for(const theme of ['light','dark']){await load(native,'focus=page',theme);const before=await styles();await load(output,'focus=page',theme);assert.deepEqual(await styles(),before);}
  });
  await t.test('stage arrows move focus with selection; Enter, Home, End and modifiers stay coherent',async()=>{
    await load();await click('.passport-step-toggle');await run(`document.querySelector('.passport-step').focus()`);await key('ArrowDown');
    assert.equal(await run(`document.activeElement.getAttribute('aria-current')`),'step');
    await key('Enter');assert.equal(await run(`document.querySelector('.passport-step-position strong').textContent`),'2');
    await key('End');assert.equal(await run(`document.activeElement.textContent.includes('Parallel writes')`),true);
    await key('Home');assert.equal(await run(`document.querySelector('.passport-step-position strong').textContent`),'1');
    await key('ArrowDown','ArrowDown',2);assert.equal(await run(`document.querySelector('.passport-step-position strong').textContent`),'1');
  });
  await t.test('authored reach links open native details and returning to stages clears reach semantics',async()=>{
    await load(output,'focus=page&reach=downstream');
    assert.equal(await run(`document.documentElement.hasAttribute('data-passport-steps')`),false);
    assert.equal(await run(`getComputedStyle(document.querySelector('#focus-reach')).display`),'grid');
    assert.equal(await run(`Archify.focus.reachability().direction`),'downstream');
    await click('.passport-step-back');await settle();
    assert.equal(await run(`Archify.focus.reachability()`),null);assert.equal(await run(`location.hash`),'#focus=page');
    assert.equal(await run(`document.documentElement.hasAttribute('data-passport-steps')`),true);
    const copied=await run(`(async()=>{let link;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:value=>{link=value;return Promise.resolve();}}});await Archify.focus.copyLink();return new URL(link).hash;})()`);
    assert.equal(copied,'#focus=page');
  });
  await t.test('native drag handle keyboard movement, reset and Escape preserve stage state and return focus',async()=>{
    await load();await run(`document.querySelector('#btn-focus-move').focus()`);await key('ArrowRight');
    assert.equal(await run(`document.querySelector('#focus-chip').hasAttribute('data-manual-placement')`),true);
    const left=await run(`document.querySelector('#focus-chip').getBoundingClientRect().left`);
    await click('.passport-step-toggle');await settle();assert.equal(await run(`document.querySelector('#focus-chip').getBoundingClientRect().left`),left);
    await run(`document.querySelector('#btn-focus-move').focus()`);await key('Home');
    assert.equal(await run(`document.querySelector('#focus-chip').hasAttribute('data-manual-placement')`),false);
    await click('.passport-step-play');await key('Escape');
    assert.equal(await run(`Archify.passportSteps.isPlaying()`),false);
    assert.equal(await run(`document.activeElement.getAttribute('data-node-id')`),'page');
    assert.equal(await run(`document.querySelector('#focus-chip').hidden`),true);
  });
});
test('Passport plays authored stages, yields cleanly and preserves canonical exports and narrow-screen access',{
  skip:chrome?false:'Set ARCHIFY_CHROME for the real-browser Passport check.',
},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-passport-steps-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const cli=path.join(root,'archify/bin/archify.mjs'),fixture=path.join(root,'test/fixtures/story-node-steps');
  const native=path.join(dir,'native.html'),output=path.join(dir,'steps.html');
  execFileSync(process.execPath,[cli,'render','architecture',path.join(fixture,'diagram.json'),native]);
  execFileSync(process.execPath,[cli,'story','attach',native,path.join(fixture,'brief.json'),output]);
  const browser=desktopBrowser(chrome);t.after(()=>browser.close());const session=await browser.sessionPromise;
  const send=(method,params={})=>browser.cdp.send(method,params,session,30000);
  const evaluate=async expression=>{let r;try{r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});}catch(error){error.message+='\nWhile evaluating: '+expression.slice(0,180);throw error;}assert.equal(r.exceptionDetails,undefined,JSON.stringify(r.exceptionDetails));return r.result?.value;};
  await send('Network.enable');await send('Network.setBlockedURLs',{urls:['http://*','https://*']});
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  const navigate=async file=>{const loaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:pathToFileURL(file).href});await loaded;};
  const settle=()=>evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  const click=selector=>evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const wait=expression=>evaluate(`new Promise((resolve,reject)=>{const start=performance.now();function check(){if(${expression})return resolve();if(performance.now()-start>6000)return reject(Error('stage did not advance'));setTimeout(check,30);}check();})`);
  const state=()=>evaluate(`({active:document.documentElement.hasAttribute('data-passport-steps'),stage:document.querySelector('.passport-step-position strong')?.textContent,playing:Archify.passportSteps?.isPlaying(),expanded:document.querySelector('#focus-chip').hasAttribute('data-steps-expanded'),edges:[...document.querySelectorAll('path[data-passport-step]')].map(e=>e.getAttribute('data-edge-id'))})`);
  await navigate(output);
  await evaluate(`localStorage.removeItem('archify-motion');Archify.motionGovernor.setMode('still',{persist:false});window.downloads=[];const create=URL.createObjectURL;URL.createObjectURL=blob=>{downloads.push(blob);return create(blob);};`);
  const exported=()=>evaluate(`(async()=>{await Archify.exportMenu.run('svg');return downloads.findLast(b=>b.type.includes('svg')).text();})()`);
  const canonical=await exported();
  await evaluate(`Archify.focus.set('page',{toggle:false})`);await settle();
  assert.deepEqual(await state(),{active:true,stage:'1',playing:false,expanded:false,edges:['classify-call']});
  await send('Emulation.setEmulatedMedia',{media:'print'});
  const printStyles=await evaluate(`(()=>{const svg=document.querySelector('.diagram-container > svg');const selected=svg.querySelector('path[data-passport-step]'),unselected=svg.querySelector('path[data-edge-id="extract-call"]'),label=svg.querySelector('g[data-passport-step] text');const styles=()=>({stroke:getComputedStyle(selected).stroke,opacity:getComputedStyle(unselected).opacity,fill:getComputedStyle(label).fill,weight:getComputedStyle(label).fontWeight});const highlighted=styles();document.documentElement.removeAttribute('data-passport-steps');const canonical=styles();document.documentElement.setAttribute('data-passport-steps','');return {highlighted,canonical};})()`);
  assert.deepEqual(printStyles.highlighted,printStyles.canonical,'printing ignores stage-only diagram styles');
  await send('Emulation.setEmulatedMedia',{media:'screen'});
  for(const mode of ['still','live']){
    await evaluate(`Archify.motionGovernor.setMode(${JSON.stringify(mode)},{persist:false})`);
    await click('.passport-step-play');
    const preempted=await evaluate(`(()=>{const token=Archify.motionGovernor.claim('test-preempt',()=>{});const state={playing:Archify.passportSteps.isPlaying(),mode:Archify.motionGovernor.mode(),owner:Archify.motionGovernor.owner()};Archify.motionGovernor.release(token);return state;})()`);
    assert.deepEqual(preempted,{playing:false,mode,owner:'test-preempt'},'competing motion retains the reader mode and owns the handoff');
    assert.equal(await evaluate(`Archify.motionGovernor.mode()`),mode);
  }
  await evaluate(`Archify.motionGovernor.setMode('still',{persist:false})`);
  await click('.passport-step-toggle');assert.equal((await state()).expanded,true);
  assert.equal(await evaluate(`document.querySelectorAll('.passport-step-list button').length`),5);
  await click('.passport-step-play');await wait(`document.querySelector('.passport-step-position strong').textContent==='2'`);
  await click('#btn-motion');await settle();
  assert.deepEqual(await state(),{active:true,stage:'2',playing:false,expanded:true,edges:['extract-call']});
  assert.equal(await evaluate(`Archify.motionGovernor.mode()`),'still');
  await evaluate('new Promise(r=>setTimeout(r,2600))');assert.equal((await state()).stage,'2','pause cancels future advancement');
  await click('.passport-step-play');await wait(`document.querySelector('.passport-step-position strong').textContent==='3'`);
  await click('.passport-step-list li:nth-child(4) button');assert.equal((await state()).playing,false,'manual selection pauses');
  await click('.passport-step-play');await wait(`!Archify.passportSteps.isPlaying()`);
  assert.deepEqual((await state()).edges,['write-a','write-b']);assert.equal((await state()).stage,'5');
  assert.equal(await exported(),canonical,'active highlighting never leaks into the canonical SVG');
  assert.equal(await evaluate(`document.documentElement.dataset.lastExportCanonical`),'true');
  await click('.passport-step-play');assert.equal((await state()).stage,'1');await click('.passport-step-play');
  await click('.passport-step-details');assert.equal((await state()).active,false);
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('#focus-reach')).display`),'grid');
  assert.equal(await evaluate(`document.querySelectorAll('#relationship-lens-list .relationship-lens-row').length`),6);
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
  await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
  await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9,modifiers:8});
  assert.deepEqual(await evaluate(`(()=>{const back=document.querySelector('.passport-step-back');return {visible:back.matches(':focus-visible'),outline:getComputedStyle(back).outlineStyle};})()`),{visible:true,outline:'solid'},'return to stages keeps a visible keyboard focus ring in native details');
  await click('.passport-step-back');assert.equal((await state()).active,true);
  await click('.passport-step-play');await evaluate(`Archify.focus.set('classify',{toggle:false})`);await settle();
  assert.equal((await state()).active,false);assert.equal((await state()).playing,false);
  assert.equal(await evaluate(`document.querySelector('#focus-label').textContent`),'Classify API');
  await evaluate(`Archify.focus.set('page',{toggle:false})`);await settle();await click('.passport-step-play');
  await evaluate(`Archify.story.setView('story')`);await settle();assert.equal((await state()).playing,false);assert.equal((await state()).active,false);
  await evaluate(`Archify.story.setView('still')`);await settle();assert.equal((await state()).active,true);
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await settle();
  await click('.passport-step-play');await wait(`document.querySelector('.passport-step-position strong').textContent==='2'`);await click('.passport-step-play');
  assert.deepEqual(await evaluate(`document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.target?.closest('.diagram-container')).map(a=>({target:a.effect.target.tagName,class:a.effect.target.getAttribute('class'),name:a.animationName||a.transitionProperty}))`),[],'reduced motion uses static highlighting, without moving paths or panel animation');
  for(const width of [615,390,768]){
    t.diagnostic('Checking viewport '+width);
    await send('Emulation.setDeviceMetricsOverride',{width,height:width===615?792:1024,deviceScaleFactor:1,mobile:false});await settle();
    if(!(await state()).expanded)await click('.passport-step-toggle');
    await click('.passport-step-list li:nth-child(5) button');await settle();
    const narrow=await evaluate(`({overflow:document.documentElement.scrollWidth>innerWidth,grip:getComputedStyle(document.querySelector('#btn-focus-move')).display,targets:[...document.querySelectorAll('[data-node-id="store-a"],[data-node-id="store-b"]')].map(e=>e.getBoundingClientRect().bottom),height:innerHeight})`);
    assert.equal(narrow.overflow,false);assert.equal(narrow.grip,'none');assert.equal((await state()).expanded,false);
    assert.ok(narrow.targets.every(bottom=>bottom<=narrow.height),'both parallel targets stay visible in the representative collapsed view');
  }
  await click('.passport-step-play');await click('#btn-focus-clear');await settle();
  assert.equal((await state()).active,false);assert.equal((await state()).playing,false);assert.deepEqual((await state()).edges,[]);
  // Distinct scenarios for one caller must not become one long sequence.
  // Exercise long authored copy and localized controls at the narrow breakpoint.
  const localized=JSON.parse(fs.readFileSync(path.join(fixture,'diagram.json'),'utf8'));
  localized.meta.locale='es';
  const scenarios=JSON.parse(fs.readFileSync(path.join(fixture,'brief.json'),'utf8'));
  const alternative=structuredClone(scenarios.scenes[0]);alternative.title='Una alternativa independiente';
  alternative.points=alternative.points.slice(3).reverse();
  alternative.points[0].title='Guardar las copias del documento en ambos destinos independientes';
  scenarios.scenes.push(alternative);
  const localizedInput=path.join(dir,'localized.json'),scenarioInput=path.join(dir,'scenarios.json');
  fs.writeFileSync(localizedInput,JSON.stringify(localized));fs.writeFileSync(scenarioInput,JSON.stringify(scenarios));
  execFileSync(process.execPath,[cli,'render','architecture',localizedInput,native]);
  execFileSync(process.execPath,[cli,'story','attach',native,scenarioInput,output]);
  await navigate(output);await evaluate(`Archify.focus.set('page',{toggle:false})`);await settle();
  assert.equal(await evaluate(`document.querySelector('.passport-step-play').textContent`),'Reproducir');
  await click('.passport-step-play');
  await evaluate(`const select=document.querySelector('.passport-step-scenario');select.value='1';select.dispatchEvent(new Event('change',{bubbles:true}));`);await settle();
  assert.deepEqual(await state(),{active:true,stage:'1',playing:false,expanded:false,edges:['write-a','write-b']});
  assert.equal(await evaluate(`document.querySelectorAll('.passport-step-list button').length`),2);
  await click('.passport-step-toggle');await settle();
  assert.equal(await evaluate(`document.querySelector('#focus-chip').scrollWidth>document.querySelector('#focus-chip').clientWidth`),false,'localized copy fits the panel');
  await click('.passport-step-list li:nth-child(2) button');await settle();
  assert.deepEqual((await state()).edges,['upload-file']);assert.equal((await state()).expanded,false);
  // Older native Viewers retain their original Passport rather than loading a
  // controller whose export cleanup and placement hooks they do not support.
  const old=path.join(dir,'old.html'),oldOutput=path.join(dir,'old-story.html');
  fs.writeFileSync(old,fs.readFileSync(native,'utf8').replace('supportsPassportSteps: true,',''));
  execFileSync(process.execPath,[cli,'story','attach',old,path.join(fixture,'brief.json'),oldOutput]);
  await navigate(oldOutput);await evaluate(`Archify.focus.set('page',{toggle:false})`);await settle();
  assert.equal(await evaluate(`document.querySelector('.passport-steps')`),null);
  assert.equal(await evaluate(`document.querySelectorAll('#relationship-lens-list .relationship-lens-row').length`),6);
});
