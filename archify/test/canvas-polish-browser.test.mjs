import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../bin/visual-check.mjs';
import { desktopBrowser } from './helpers/desktop-browser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
const examples = { architecture: 'web-app.architecture.json', workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json', dataflow: 'product-analytics.dataflow.json', lifecycle: 'agent-run.lifecycle.json' };
const observation = `(()=>{
  const c=document.querySelector('.diagram-container'),s=c.querySelector(':scope > svg'),d=c.querySelector('.fixed-legend'),n=c.querySelector('.diagram-nav');
  const r=e=>{const b=e.getBoundingClientRect();return {left:b.left,top:b.top,right:b.right,bottom:b.bottom,width:b.width,height:b.height};};
  const visible=e=>!!e&&!e.hidden&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden';
  const entries=e=>[...e.querySelectorAll('[data-legend-semantic-kind]')].map(n=>({kind:n.dataset.legendSemanticKind,role:n.getAttribute('role'),count:n.getAttribute('data-legend-count'),label:n.querySelector('text,span')?.textContent}));
  const source=s.querySelector('[data-legend]');
  return {fixed:document.documentElement.hasAttribute('data-fixed-canvas'),dockVisible:visible(d),sourceVisible:visible(source),
    dock:d?r(d):null,container:r(c),nav:r(n),font:d?getComputedStyle(d).fontSize:null,
    collapsed:d?.hasAttribute('data-collapsed'),listHidden:d?.querySelector('.fixed-legend-list').hidden,
    source:source?entries(source):[],entries:d?entries(d):[],state:Archify.view.state(),
    buttons:[...n.querySelectorAll('button')].map(b=>({...r(b),font:parseFloat(getComputedStyle(b).fontSize)})),
    grid:parseFloat(c.style.getPropertyValue('--archify-grid-minor')),gridOrigin:[c.style.getPropertyValue('--archify-grid-x'),c.style.getPropertyValue('--archify-grid-y')],
    range:[document.scrollingElement.scrollWidth-innerWidth,document.scrollingElement.scrollHeight-innerHeight],
    preset:document.documentElement.dataset.preset,theme:document.documentElement.dataset.theme,
    duplicateIds:[...document.querySelectorAll('[id]')].map(n=>n.id).filter((id,i,a)=>a.indexOf(id)!==i),errors:polishErrors};
})()`;

test('Canvas polish preserves authored legends, docking, input, mode fallback and export', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for canvas polish browser acceptance.',
}, async t => {
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'archify-polish-'));
  t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
  const evidence=process.env.ARCHIFY_POLISH_EVIDENCE;
  if(evidence)fs.mkdirSync(evidence,{recursive:true});
  const records=[];
  t.after(()=>{if(evidence)fs.writeFileSync(path.join(evidence,'observations.json'),JSON.stringify(records,null,2)+'\n');});
  const files={};
  function render(name,mode,source) {
    const file=path.join(scratch,name+'.html');
    execFileSync(process.execPath,[path.join(root,'bin/archify.mjs'),'render',mode,source,file]);files[name]=file;
  }
  for(const [mode,file] of Object.entries(examples))render(mode,mode,path.join(root,'examples',file));
  const input=JSON.parse(fs.readFileSync(path.join(root,'examples',examples.architecture)));
  for(const [name,legend] of [['none',{mode:'hidden'}],['all',{mode:'all'}],['single',{mode:'all',entries:Object.fromEntries(['frontend','database','cloud','security','messagebus','external'].map(kind=>[kind,{visible:false}]))}],['long',{mode:'all',entries:{backend:{label:'Backend service with a deliberately long complete name'},database:{label:'Database storage with a deliberately long complete name'}}}]]){
    const doc=structuredClone(input);doc.meta.legend=legend;doc.meta.viewBox=[4000,1200];
    const source=path.join(scratch,name+'.json');fs.writeFileSync(source,JSON.stringify(doc));render(name,'architecture',source);
  }
  for(const locale of ['en','zh-CN','es']) {
    const doc=structuredClone(input);doc.meta.locale=locale;
    const source=path.join(scratch,locale+'.json');fs.writeFileSync(source,JSON.stringify(doc));render(locale,'architecture',source);
  }
  // Match the existing legacy bridge zero-count fixture: an old artifact can
  // publish an interactive kind for which the current node catalog has no fact.
  files.zero=path.join(scratch,'zero.html');
  fs.writeFileSync(files.zero,fs.readFileSync(files.architecture,'utf8').replace('data-legend-kind="backend"','data-legend-kind="missing"'));
  const huge=structuredClone(input);huge.meta.viewBox=[400000,1200];delete huge.boundaries;
  const hugeSource=path.join(scratch,'huge.json');fs.writeFileSync(hugeSource,JSON.stringify(huge));render('huge','architecture',hugeSource);
  const browser=desktopBrowser(chrome);t.after(()=>browser.close());const session=await browser.sessionPromise;
  const send=(m,p={})=>browser.cdp.send(m,p,session);
  const run=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result?.value;};
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.polishErrors=[];addEventListener('error',e=>polishErrors.push(e.message));addEventListener('unhandledrejection',e=>polishErrors.push(String(e.reason)));`});
  async function stable(){await run('document.fonts.ready.then(()=>Archify.readerLayout.whenStable()).then(()=>Archify.viewerChromeLayout.whenStable())');}
  async function size(width,height){await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await stable();}
  let loadId=0;
  async function load(name,theme='light',preset='classic',width=1440,height=900){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    const ready=browser.cdp.waitFor('Page.loadEventFired',session);
    await send('Page.navigate',{url:pathToFileURL(files[name]).href+`?theme=${theme}&preset=${preset}&polish=${++loadId}`});await ready;await run(`Archify.preset.apply(${JSON.stringify(preset)})`);await stable();
    assert.equal(await run('Archify.preset.current()'),preset);
  }
  async function sample(name){const o=await run(observation);records.push({name,...o});assert.deepEqual(o.errors,[],name);assert.deepEqual(o.duplicateIds,[],name);return o;}
  async function shot(name){if(evidence){const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(r.data,'base64'));}}
  async function key(key,code,vk){for(const type of ['keyDown','keyUp'])await send('Input.dispatchKeyEvent',{type,key,code,windowsVirtualKeyCode:vk});}
  async function click(selector){const p=await run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);for(const type of ['mousePressed','mouseReleased'])await send('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});}
  const inside=(o)=>{assert.ok(o.nav.left-o.dock.right>=8,JSON.stringify(o));assert.ok(Math.abs(o.dock.left-o.container.left-17)<=1);assert.ok(Math.abs(o.container.bottom-o.dock.bottom-17)<=1);assert.ok(o.range.every(n=>n<=1));};
  for(const mode of Object.keys(examples))for(const theme of ['light','dark'])await t.test(mode+' '+theme,async()=>{
    await load(mode,theme);const first=await sample(mode+'-'+theme);await shot(mode+'-'+theme+'-fit');
    if(first.source.length){assert.equal(first.dockVisible,true);assert.equal(first.sourceVisible,false);assert.deepEqual(first.entries,first.source);inside(first);}
    for(const button of first.buttons){assert.ok(button.width>=32&&button.height>=32);assert.ok(button.font>=11);}
    await run('Archify.view.reset()');await stable();await shot(mode+'-'+theme+'-read');
    const before=await sample(mode+'-'+theme+'-read');
    await run(`(async()=>{for(let i=0;i<20;i++){Archify.view.panBy(i%2?61:-61,i%2?-43:43);Archify.view.zoomAt(i%2?1:.5,500,400);await new Promise(r=>requestAnimationFrame(r));}})()`);
    const after=await sample(mode+'-'+theme+'-gestures');
    if(first.source.length){for(const p of ['left','top','width','height'])assert.ok(Math.abs(after.dock[p]-before.dock[p])<=1,p);assert.equal(after.font,before.font);}
    for(let i=0;i<before.buttons.length;i++)assert.ok(Math.abs(before.buttons[i].left-after.buttons[i].left)<=1,'stable zoom label');
  });
  await t.test('presets, sidebar and breakpoints retain one visible legend and preserve focus',async()=>{
    for(const preset of ['classic','signal-flow','blueprint','editorial'])for(const theme of ['light','dark']){
      await load('architecture',theme,preset);inside(await sample(preset+'-'+theme));await shot(preset+'-'+theme);
    }
    for(const [width,height] of [[1024,600],[1366,768],[2048,1320]]){
      await size(width,height);inside(await sample('viewport-'+width));
      await click('#btn-diagram-notes');await stable();inside(await sample('notes-'+width));await shot('notes-'+width);
      await click('#btn-diagram-notes');await stable();
    }
    for(const [width,height] of [[1023,600],[1024,599],[390,844]]){
      await size(1440,900);await run(`document.querySelector('.fixed-legend [role="button"]').focus()`);
      await size(width,height);const o=await sample('fallback-'+width+'-'+height);assert.equal(o.dockVisible,false);assert.equal(o.sourceVisible,true);
      assert.equal(await run(`getComputedStyle(document.activeElement).visibility`),'visible');
      await size(1440,900);assert.equal((await sample('restored')).dockVisible,true);
    }
    await run(`document.documentElement.setAttribute('data-present','true')`);await stable();assert.equal((await sample('present')).dockVisible,false);
    await run(`document.documentElement.removeAttribute('data-present')`);await stable();assert.equal((await sample('reader')).dockVisible,true);
    await send('Emulation.setEmulatedMedia',{media:'print'});await stable();const p=await sample('print');assert.equal(p.sourceVisible,true);assert.equal(p.dockVisible,false);await shot('print-preview');
    await send('Emulation.setEmulatedMedia',{media:''});await stable();
  });
  await t.test('overflow is readable, keyboard reachable and does not reframe the camera',async()=>{
    await load('long','light','classic',1024,600);await click('#btn-diagram-notes');await stable();
    const before=await sample('overflow-before');assert.equal(before.collapsed,true);inside(before);
    await click('.fixed-legend-toggle');await key('End','End',35);
    const expanded=await run(`(()=>{const l=document.querySelector('.fixed-legend-list'),a=document.activeElement;l.scrollTop=l.scrollHeight;return {last:a===l.querySelector('[role="button"]:last-child'),height:l.offsetHeight,client:l.clientHeight,scroll:l.scrollHeight,text:l.textContent};})()`);
    assert.equal(expanded.last,true);assert.ok(expanded.height<=before.container.height*.5+2);assert.match(expanded.text,/deliberately long complete name/);
    const wheelPoint=await run(`(()=>{const r=document.querySelector('.fixed-legend-list').getBoundingClientRect();return {x:r.left+20,y:r.top+20};})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',...wheelPoint,deltaY:150,deltaX:0});
    assert.deepEqual((await sample('overflow-open')).state,before.state);await shot('overflow-open');
    await key('Escape','Escape',27);assert.equal(await run('document.activeElement.className'),'fixed-legend-toggle');
    assert.equal((await sample('overflow-closed')).listHidden,true);
  });
  await t.test('canonical SVG exports retain the original legend while the live dock and camera stay intact',async()=>{
    await browser.cdp.send('Browser.setDownloadBehavior',{behavior:'deny'});
    for(const mode of Object.keys(examples)){
      await load(mode);const o=await run(`(async()=>{const s=document.querySelector('.diagram-container > svg'),before=s.outerHTML,camera=JSON.stringify(Archify.view.state());let blob;const orig=URL.createObjectURL;URL.createObjectURL=b=>{blob=b;return orig(b);};try{await Archify.exportMenu.run('svg');}finally{URL.createObjectURL=orig;}const text=await blob.text(),doc=new DOMParser().parseFromString(text,'image/svg+xml');return {source:!!s.querySelector('[data-legend]'),count:doc.querySelectorAll('[data-legend]').length,live:s.outerHTML===before,camera:camera===JSON.stringify(Archify.view.state()),shell:!!doc.querySelector('.fixed-legend'),hidden:doc.querySelector('[data-legend]')?.getAttribute('style')};})()`);
      assert.equal(o.count,o.source?1:0);assert.equal(o.live,true);assert.equal(o.camera,true);assert.equal(o.shell,false);assert.ok(!o.hidden?.includes('hidden'));
    }
  });
  await t.test('three languages and all presets retain readable controls and contrast',async()=>{
    for(const locale of ['en','zh-CN','es'])for(const preset of ['classic','signal-flow','blueprint','editorial'])for(const theme of ['light','dark']) {
      await load(locale,theme,preset,1024,600);await click('#btn-diagram-notes');await stable();inside(await sample(locale+'-'+preset+'-'+theme));
      const contrast=await run(`(async()=>{
        const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');
        const rgb=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
        const lum=a=>a.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
        const bg=rgb(getComputedStyle(document.querySelector('.diagram-nav')).backgroundColor);
        const buttons=[...document.querySelectorAll('.diagram-nav button:not(:disabled)')];
        const measure=state=>buttons.map(b=>{
          const style=getComputedStyle(b),fg=rgb(style.color),a=fg[3]/255,button=rgb(style.backgroundColor);
          const base=button.map((v,i)=>i<3?v*button[3]/255+bg[i]*(1-button[3]/255):255);
          const l1=lum(fg.map((v,i)=>i<3?v*a+base[i]*(1-a):255)),l2=lum(base);
          return {state,id:b.id||b.dataset.view,ratio:(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05),overflow:b.scrollWidth>b.clientWidth+1};
        });
        const result=measure('normal'),attrs=[];
        buttons.forEach(b=>['aria-pressed','aria-expanded'].forEach(name=>{if(b.hasAttribute(name)){attrs.push([b,name,b.getAttribute(name)]);b.setAttribute(name,'true');}}));
        await new Promise(r=>setTimeout(r,180));result.push(...measure('selected'));
        attrs.forEach(([b,name,value])=>b.setAttribute(name,value));
        return result;
      })()`);
      for(const c of contrast){assert.ok(c.ratio>=4.5,locale+'/'+preset+'/'+theme+JSON.stringify(c));assert.equal(c.overflow,false,JSON.stringify(c));}
      await shot(locale+'-'+preset+'-'+theme);
    }
  });
  await t.test('sub-percent grid and threshold crossings share the camera origin without relaying out the dock',async()=>{
    await load('huge');assert.ok((await sample('sub-percent-fit')).state.scale<.01);
    for(const scale of [.003,.01,.05,.1,.24999,.25,.25001,.49999,.5,.50001,1,2,4]){
      await run(`Archify.view.zoomAt(${scale},500,400)`);await stable();const o=await sample('grid-'+scale);
      assert.ok(o.grid>=23.999&&o.grid<=48.001);await shot('grid-'+scale);
    }
    await run(`Archify.view.reset()`);await stable();
    const writes=await run(`(async()=>{let writes=0;const o=new MutationObserver(r=>writes+=r.length);o.observe(document.querySelector('.fixed-legend'),{attributes:true,childList:true,subtree:true});for(let i=0;i<120;i++){Archify.view.panBy(i%2?3:-3,0,{manual:false,defer:true});await new Promise(r=>requestAnimationFrame(r));}o.disconnect();return writes;})()`);
    assert.equal(writes,0,'camera frames do not lay out or rewrite the legend');
  });
  await t.test('disabled JavaScript retains the authored legend without a second shell',async()=>{
    await send('Emulation.setScriptExecutionDisabled',{value:true});
    const ready=browser.cdp.waitFor('Page.loadEventFired',session);
    await send('Page.navigate',{url:pathToFileURL(files.architecture).href+'?nojs=1'});await ready;
    await send('Emulation.setScriptExecutionDisabled',{value:false});
    assert.deepEqual(await run(`({source:getComputedStyle(document.querySelector('[data-legend]')).visibility,dock:!!document.querySelector('.fixed-legend')})`),{source:'visible',dock:false});
  });
  await t.test('no legend creates no shell and stable Still mode adds no ongoing dock work',async()=>{
    await load('all');const all=await sample('all-entries');assert.deepEqual(all.entries,all.source);assert.ok(all.entries.some(e=>e.role===null&&e.count===null));
    await load('zero');const zero=await sample('zero-count');assert.deepEqual(zero.entries,zero.source);assert.ok(zero.entries.some(e=>e.count==='0'&&e.role===null));
    await load('single');const single=await sample('single-entry');assert.equal(single.entries.length,1);assert.deepEqual(single.entries,single.source);
    await load('none');assert.equal(await run(`!!document.querySelector('.fixed-legend')`),false);
    await load('architecture');await run(`document.documentElement.setAttribute('data-motion','still')`);await stable();
    const writes=await run(`new Promise(resolve=>{let n=0;const o=new MutationObserver(r=>n+=r.length);o.observe(document.querySelector('.fixed-legend'),{attributes:true,childList:true,subtree:true});setTimeout(()=>{o.disconnect();resolve(n);},600);})`);assert.equal(writes,0);
  });
});
