import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../bin/visual-check.mjs';
import { desktopBrowser } from './helpers/desktop-browser.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configured = Object.hasOwn(process.env, 'ARCHIFY_CHROME');
const chrome = configured ? findChrome() : null;
if (configured && !chrome) throw new Error('ARCHIFY_CHROME must identify an executable browser.');

test('Fixed canvas contains the page without losing diagram or explanation content', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run fixed-canvas browser checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-fixed-canvas-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidence = process.env.ARCHIFY_FIXED_CANVAS_EVIDENCE;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  const records = [];
  t.after(() => {
    if (evidence) fs.writeFileSync(path.join(evidence, 'observations.json'), JSON.stringify(records, null, 2) + '\n');
  });

  // A small, redistributable portrait reproducer: no private repository data.
  const source = {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Canvas containment', output: 'portrait.html', viewBox: [1000, 1300] },
    components: [
      { id: 'entry', type: 'frontend', label: 'Entry', sublabel: 'Input context', tag: 'ENTRY TAG', pos: [380, 90], size: [240, 80] },
      { id: 'result', type: 'backend', label: 'Result', sublabel: 'Output context', tag: 'RESULT TAG', pos: [380, 1120], size: [240, 80] },
    ],
    connections: [{ id: 'entry-result', from: 'entry', to: 'result', label: 'Execute request', labelDy: 24 }],
  };
  const fixtures = [];
  for (const [name, cards] of [
    ['portrait', []],
    ['long-notes', [{ dot: 'cyan', title: 'Complete explanation',
      items: Array.from({ length: 80 }, (_, i) => `Explanation item ${i + 1}`) }]],
  ]) {
    const spec = path.join(scratch, name + '.json');
    const file = path.join(scratch, name + '.html');
    fs.writeFileSync(spec, JSON.stringify({ ...source, cards }));
    execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'), spec, file]);
    fixtures.push({ name, file });
  }
  // The optional local artifact is inspected byte-for-byte; it is never checked in.
  if (process.env.ARCHIFY_FIXED_CANVAS_ARTIFACT) {
    const file = path.join(scratch, 'local-artifact.html');
    fs.copyFileSync(process.env.ARCHIFY_FIXED_CANVAS_ARTIFACT, file);
    fixtures.push({ name: 'local-artifact', file });
  }

  for (const [name, example] of Object.entries({
    architecture:'web-app.architecture.json', workflow:'agent-tool-call.workflow.json',
    sequence:'cache-miss-request.sequence.json', dataflow:'product-analytics.dataflow.json', lifecycle:'agent-run.lifecycle.json',
  })) {
    const file=path.join(scratch,name+'.html');
    execFileSync(process.execPath,[path.join(skillRoot,`renderers/${name}/render-${name}.mjs`),path.join(skillRoot,'examples',example),file]);
    fixtures.push({name,file});
  }

  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.fixedCanvasErrors = [];
    addEventListener('error', e => fixedCanvasErrors.push(e.message));
    addEventListener('unhandledrejection', e => fixedCanvasErrors.push(String(e.reason)));
  ` });
  async function stable() {
    await run(`(async()=>{ await document.fonts.ready;
      await Archify.readerLayout.whenStable(); await Archify.viewerChromeLayout.whenStable();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))); })()`);
  }
  async function load(fixture, width=1440, height=900, theme='light', query='') {
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    const loaded=browser.cdp.waitFor('Page.loadEventFired',session);
    await send('Page.navigate',{url:pathToFileURL(fixture.file).href+'?theme='+theme+query});
    await loaded; await stable();
  }
  async function shot(name) {
    if (!evidence) return;
    const image=await send('Page.captureScreenshot',{format:'png'});
    fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(image.data,'base64'));
  }
  for (const fixture of fixtures) {
    for (const [width, height] of [[1440, 900], [1600,1000], [1920,1080], [2048, 1320]]) {
      for (const theme of ['light','dark']) {
      await t.test(`${fixture.name}-${width}x${height}-${theme}`, async () => {
        await load(fixture,width,height,theme);
        const observation = await run(`(() => {
          const root = document.scrollingElement, body = document.body;
          const rect = e => { const r = e.getBoundingClientRect(); return { x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right }; };
          const diagram = document.querySelector('.diagram-container');
          const svg = diagram.querySelector(':scope > svg');
          return { width:innerWidth, height:innerHeight,
            rootRange:[root.scrollWidth-root.clientWidth,root.scrollHeight-root.clientHeight],
            bodyOverflow:[body.scrollWidth-innerWidth,body.scrollHeight-innerHeight],
            diagram:rect(diagram), nav:rect(diagram.querySelector('.diagram-nav')),
            svgViewBox:svg.getAttribute('viewBox'),
            nodes:[...svg.querySelectorAll('[data-node-id]')].map(n=>n.dataset.nodeId),
            cards:[...document.querySelectorAll('.cards .card')].map(n=>n.textContent.trim()),
            reader:{active:Archify.readerLayout.active(),receipt:Archify.readerLayout.receipt()},
            errors:fixedCanvasErrors };
        })()`);
        observation.artifactSha256 = createHash('sha256').update(fs.readFileSync(fixture.file)).digest('hex');
        if (evidence) {
          const screenshot = await send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(evidence, `${fixture.name}-${width}-${theme}.png`), Buffer.from(screenshot.data, 'base64'));
        }
        observation.attemptedPageScroll = await run(`(async () => {
          window.scrollTo(200,200);
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          const after=[scrollX,scrollY]; window.scrollTo(0,0); return after;
        })()`);
        records.push({ fixture:fixture.name, theme, ...observation });
        // Capture all diagnostic evidence before the first failing assertion.
        assert.deepEqual(observation.errors, []);
        assert.ok(observation.rootRange.every(n=>n<=1), `Page scroll range: ${JSON.stringify(observation)}`);
        assert.ok(observation.bodyOverflow.every(n=>n<=1), `Body extends beyond viewport: ${JSON.stringify(observation)}`);
        assert.ok(observation.attemptedPageScroll.every(n=>Math.abs(n)<=1), 'Window must remain stationary');
        assert.ok(observation.diagram.y>=-1 && observation.diagram.bottom<=height+1, 'Canvas must occupy a real viewport-contained region');
        assert.ok(observation.diagram.height>0 && observation.diagram.width>0);
        assert.ok(observation.nav.y>=-1 && observation.nav.bottom<=height+1, 'Navigation must stay reachable');
        if (fixture.name==='long-notes') assert.ok(observation.cards.join('\n').includes('Explanation item 80'), 'The last note must be preserved');
        const available=await run(`!document.getElementById('btn-diagram-notes').hidden`);
        if(available){
          await run(`document.getElementById('btn-diagram-notes').click()`);await stable();
          const panel=await run(`(()=>{const p=document.getElementById('diagram-notes-content'),r=p.getBoundingClientRect();p.scrollTop=p.scrollHeight;return {open:document.documentElement.hasAttribute('data-notes-open'),range:[document.scrollingElement.scrollWidth-innerWidth,document.scrollingElement.scrollHeight-innerHeight],width:document.querySelector('.diagram-container').clientWidth,bottom:r.bottom,cards:document.getElementById('diagram-notes-content').textContent};})()`);
          assert.equal(panel.open,true);assert.ok(panel.range.every(n=>n<=1));assert.ok(panel.bottom<=height+1);
          assert.ok(panel.width<observation.diagram.width);assert.ok(panel.cards.length>0);
          if(width===1440||width===2048)await shot(fixture.name+'-'+width+'-'+theme+'-notes');
          records.push({case:'matrix-notes',fixture:fixture.name,width,height,theme,...panel});
          await run(`document.getElementById('diagram-notes-close').click()`);await stable();
        }

      });
    }
  }
  }

  await t.test('notes remain reachable and own native scrolling, keyboard focus and side width',async()=>{
    const fixture=fixtures.find(f=>f.name==='long-notes'); await load(fixture);
    const initial=await run(`({width:document.querySelector('.diagram-container').clientWidth, cards:document.querySelector('.cards').textContent})`);
    await run(`document.getElementById('btn-diagram-notes').focus()`);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
    await stable();
    const opened=await run(`(()=>{const p=document.getElementById('diagram-notes-content'),r=p.getBoundingClientRect();
      return {focus:document.activeElement.id,expanded:document.getElementById('btn-diagram-notes').getAttribute('aria-expanded'),
      width:document.querySelector('.diagram-container').clientWidth,cards:document.querySelector('.cards').textContent,
      range:p.scrollHeight-p.clientHeight,x:r.x+r.width/2,y:r.y+r.height/2,state:Archify.view.state()};})()`);
    records.push({case:'notes-opening',opened});
    await shot('notes-opening');
    assert.equal(opened.focus,'diagram-notes-content'); assert.equal(opened.expanded,'true');
    assert.ok(opened.width<initial.width); assert.equal(opened.cards,initial.cards); assert.ok(opened.range>0);
    await run(`document.getElementById('diagram-notes-content').scrollTop=1e6`);
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',x:opened.x,y:opened.y,deltaX:0,deltaY:500});
    await stable();
    const bottom=await run(`(()=>{const p=document.getElementById('diagram-notes-content'),last=p.querySelector('.card li:last-child'),r=last.getBoundingClientRect();return {scroll:p.scrollTop,range:p.scrollHeight-p.clientHeight,last:r.bottom,bottom:p.getBoundingClientRect().bottom,state:Archify.view.state(),page:[scrollX,scrollY]};})()`);
    assert.ok(Math.abs(bottom.scroll-bottom.range)<=1); assert.ok(bottom.last<=bottom.bottom+1);
    assert.deepEqual(bottom.page,[0,0]); assert.deepEqual(bottom.state,opened.state);
    await shot('notes-open-bottom');
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await stable();
    const closed=await run(`({focus:document.activeElement.id,width:document.querySelector('.diagram-container').clientWidth,expanded:document.getElementById('btn-diagram-notes').getAttribute('aria-expanded'),count:document.querySelectorAll('.cards').length})`);
    assert.equal(closed.focus,'btn-diagram-notes'); assert.equal(closed.expanded,'false'); assert.equal(closed.width,initial.width); assert.equal(closed.count,1);
    records.push({case:'notes-native-input',opened,bottom,closed});
  });

  await t.test('native wheel ownership stays on canvas and native note editing stays in the sidebar',async()=>{
    await load(fixtures.find(f=>f.name==='long-notes'));
    const initial=await run(`Archify.view.state()`);
    const outside=await run(`['.toolbar','.header'].map(selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};}).concat([{x:4,y:innerHeight/2}])`);
    for(const point of outside){
      await send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:120,deltaY:160});await stable();
      assert.deepEqual(await run(`({camera:Archify.view.state(),page:[scrollX,scrollY]})`),{camera:initial,page:[0,0]});
    }
    await run(`document.getElementById('btn-diagram-notes').click()`);await stable();
    const editorCamera=await run('Archify.view.state()');
    // Controlled card content exercises native HTML controls, not a new authoring schema.
    await run(`(()=>{const p=document.getElementById('diagram-notes-content');
      const label=document.createElement('label');label.textContent='Editable note';
      const input=document.createElement('input');input.id='note-test-input';input.value='Original';label.append(input);p.prepend(label);
      const link=document.createElement('a');link.id='note-test-link';link.href='#note-test-input';link.textContent='Return to editable note';label.after(link);
      input.focus();input.select();})()`);
    await send('Input.insertText',{text:'Updated note'});
    for(const [key,code,windowsVirtualKeyCode,text] of [[' ','Space',32,' '],['ArrowLeft','ArrowLeft',37,undefined]]){
      await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,...(text?{text}:{})});
      await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});
    }
    await stable();
    const edited=await run(`({text:document.getElementById('note-test-input').value,camera:Archify.view.state(),page:[scrollX,scrollY]})`);
    assert.equal(edited.text,'Updated note ');assert.deepEqual(edited.camera,editorCamera);assert.deepEqual(edited.page,[0,0]);
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});
    assert.equal(await run(`document.activeElement.id`),'note-test-link');
    const top=await run(`(()=>{const p=document.getElementById('diagram-notes-content');p.scrollTop=0;const r=p.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+40};})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',...top,deltaX:0,deltaY:-500});await stable();
    assert.deepEqual(await run(`({camera:Archify.view.state(),page:[scrollX,scrollY]})`),{camera:editorCamera,page:[0,0]});
    await run(`document.getElementById('diagram-notes-close').click()`);await stable();
    const point=await run(`(()=>{const r=document.querySelector('.diagram-container').getBoundingClientRect();return {x:r.left+100,y:r.top+100};})()`);
    await send('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:100,deltaY:120});
    await run(`new Promise((resolve,reject)=>{let n=0;function sample(){const c=document.querySelector('.diagram-container');if(++n>2&&!c.classList.contains('is-wheel-moving'))return resolve();if(n>180)return reject(new Error('wheel did not settle'));requestAnimationFrame(sample);}requestAnimationFrame(sample);})`);
    const panned=await run(`({camera:Archify.view.state(),page:[scrollX,scrollY]})`);
    assert.notEqual(panned.camera.y,initial.y);assert.deepEqual(panned.page,[0,0]);
    records.push({case:'native-input-ownership',edited,panned});
  });

  await t.test('notes resize Fit all, preserve manual scale and survive twenty reversible toggles',async()=>{
    await load(fixtures.find(f=>f.name==='architecture'));
    await run(`Archify.view.fitAll()`);await stable();
    const initial=await run(`Archify.view.state()`);
    await run(`document.getElementById('btn-diagram-notes').click()`);await stable();
    const fitted=await run(`({state:Archify.view.state(),viewport:Archify.view.logicalViewport()})`);
    assert.equal(fitted.state.mode,'fit');
    // Camera percentage is relative to the resized SVG, so it may increase as
    // the sidebar narrows that SVG. Verify rendered containment instead.
    const containment=await run(`(async()=>{let previous='',equal=0,frames=0;
      await new Promise((resolve,reject)=>{function sample(){const svg=document.querySelector('.diagram-container > svg');const value=getComputedStyle(svg).transform+'|'+svg.style.clipPath;equal=value===previous?equal+1:0;previous=value;if(equal>=8)return resolve();if(++frames>180)return reject(new Error('fit camera did not settle'));requestAnimationFrame(sample);}requestAnimationFrame(sample);});
      const svg=document.querySelector('.diagram-container > svg'),v=svg.viewBox.baseVal,m=svg.getScreenCTM();
      function point(x,y){const p=svg.createSVGPoint();p.x=x;p.y=y;const r=p.matrixTransform(m);return {x:r.x,y:r.y};}
      return {start:point(v.x,v.y),end:point(v.x+v.width,v.y+v.height),stage:Archify.viewerChromeLayout.stageRect()};})()`);
    assert.ok(containment.start.x>=containment.stage.left+14,JSON.stringify(containment));
    assert.ok(containment.start.y>=containment.stage.top+14,JSON.stringify(containment));
    assert.ok(containment.end.x<=containment.stage.right-14,JSON.stringify(containment));
    assert.ok(containment.end.y<=containment.stage.bottom-14,JSON.stringify(containment));
    await run(`Archify.view.zoomAt(1.5,500,300)`);await stable();
    const manual=await run(`Archify.view.state()`);
    for(let i=0;i<20;i++){
      await run(`document.getElementById('btn-diagram-notes').click()`);await stable();
      const state=await run(`({camera:Archify.view.state(),count:document.querySelectorAll('.cards').length,overflow:[document.scrollingElement.scrollWidth-innerWidth,document.scrollingElement.scrollHeight-innerHeight]})`);
      assert.equal(state.camera.scale,manual.scale);assert.equal(state.camera.mode,manual.mode);
      assert.equal(state.count,1);assert.ok(state.overflow.every(n=>n<=1));
    }
    records.push({case:'notes-camera-resize',initial,fitted,containment,manual});
  });

  await t.test('text remains painted without hover at every camera scale in all five modes',async()=>{
    for (const fixture of fixtures.filter(f=>f.name!=='long-notes')) {
      await load(fixture); await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
      let original;
      for (const scale of [1,0.5,2,0.1,'fit']) {
        await run(scale==='fit'?`Archify.view.fitAll()`:`Archify.view.zoomAt(${scale},600,350)`);
        await stable();
        const texts=await run(`(()=>{const svg=document.querySelector('.diagram-container > svg');
          return [...svg.querySelectorAll('text')].filter(t=>t.closest('[data-node-id], [data-edge-from], [data-detail]')).map(t=>{
            let hidden=false; for(let n=t;n&&n!==svg.parentElement;n=n.parentElement){const s=getComputedStyle(n);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)hidden=true;}
            return {text:t.textContent,hidden,transform:getComputedStyle(t).transform};});})()`);
        assert.ok(texts.length>0); assert.deepEqual(texts.filter(t=>t.hidden),[],JSON.stringify({fixture:fixture.name,scale,texts}));
        const labels=texts.map(t=>t.text); if(original)assert.deepEqual(labels,original); else original=labels;
        records.push({case:'always-visible-text',fixture:fixture.name,scale,texts});
      }
      await shot(fixture.name+'-full-text-fit');
    }
  });

  await t.test('notes coexist with Radar, Passport, Finder and export without blocking their controls',async()=>{
    await load(fixtures.find(f=>f.name==='architecture'));
    await run(`document.getElementById('btn-diagram-notes').click();Archify.radar.open();Archify.focus.set('api',{toggle:false})`);await stable();
    await run(`Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{})))`);await stable();
    async function reachable(selectors){
      const controls=await run(`(${JSON.stringify(selectors)}).map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {selector,width:r.width,height:r.height,reachable:el===hit||el.contains(hit),name:el.getAttribute('aria-label')||el.textContent};})`);
      for(const control of controls)assert.ok(control.width>0&&control.height>0&&control.reachable&&control.name,JSON.stringify(controls));
      return controls;
    }
    const together=await reachable(['#diagram-notes-close','#btn-focus-clear','#btn-overview-map','[data-view="fit-all"]']);
    if(await run(`!document.getElementById('overview-map').hidden`))await reachable(['#overview-map-close']);
    await shot('notes-radar-passport');
    await run(`Archify.finder.open()`);await stable();
    await reachable(['#diagram-notes-close','#node-finder-input','#node-finder-close']);
    await run(`Archify.finder.close();document.getElementById('btn-export').click()`);await stable();
    await reachable(['#btn-export']);
    assert.ok(await run(`document.getElementById('export-menu').getBoundingClientRect().height>0`));
    // A temporary dropdown may cover underlying content. Its native dismissal
    // must restore access, rather than imposing a new collision policy on menus.
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await stable();
    await reachable(['#diagram-notes-close']);
    records.push({case:'notes-existing-panels',together});
  });

  await t.test('all presets keep authored labels and anchors unchanged across hover and keyboard focus',async()=>{
    await load(fixtures.find(f=>f.name==='portrait'));
    const labelState=`(()=>{const svg=document.querySelector('.diagram-container > svg');return [...svg.querySelectorAll('text')].filter(t=>t.closest('[data-node-id], [data-edge-from], [data-detail]')).map(t=>{let hidden=false;for(let e=t;e&&e!==svg.parentElement;e=e.parentElement){const s=getComputedStyle(e);if(s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)hidden=true;}return {text:t.textContent,x:t.getAttribute('x'),y:t.getAttribute('y'),anchor:t.getAttribute('transform'),transform:getComputedStyle(t).transform,hidden};});})()`;
    for(const preset of ['classic','signal-flow','blueprint','editorial'])for(const theme of ['light','dark']){
      await run(`Archify.preset.apply(${JSON.stringify(preset)});document.documentElement.setAttribute('data-theme',${JSON.stringify(theme)});Archify.focus.clear();Archify.view.reset()`);await stable();
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
      const before=await run(labelState);assert.ok(before.every(t=>!t.hidden));
      const point=await run(`(()=>{const r=document.querySelector('[data-node-id="entry"]').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await stable();
      assert.deepEqual(await run(labelState),before);
      await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
      await run(`document.querySelector('[data-node-id="entry"]').focus({preventScroll:true})`);await stable();
      assert.deepEqual(await run(labelState),before);
      await run(`document.querySelector('[data-node-id="entry"]').blur();Archify.focus.set('entry');Archify.focus.clear()`);await stable();
      assert.deepEqual(await run(labelState),before);
      records.push({case:'preset-hover-focus-text',preset,theme,texts:before});
    }
    for(const [width,height,query] of [[390,844,''],[1440,900,'&present=1'],[1440,900,'&embed=1']]){
      await load(fixtures.find(f=>f.name==='portrait'),width,height,'light',query);
      const texts=await run(labelState);assert.ok(texts.every(t=>!t.hidden));
      records.push({case:'alternate-mode-text',width,height,query,texts});
    }
  });

  await t.test('breakpoints, print and specialized modes release the fixed shell and preserve notes',async()=>{
    await load(fixtures.find(f=>f.name==='long-notes'));
    for(let round=0;round<3;round++)for(const [width,height,fixed] of [[1024,600,true],[1023,600,false],[1024,599,false],[390,844,false],[1440,900,true]]) {
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false}); await stable();
      assert.equal(await run(`document.documentElement.hasAttribute('data-fixed-canvas')`),fixed);
      assert.equal(await run(`document.querySelectorAll('.cards').length`),1);
      if(!fixed)assert.ok(await run(`document.querySelector('.cards').getBoundingClientRect().height>0`));
    }
    await run(`document.getElementById('btn-diagram-notes').click();Archify.view.zoomAt(2,500,300);Archify.view.panBy(80,-150);`);await stable();
    await send('Emulation.setEmulatedMedia',{media:'print'}); await stable();
    const print=await run(`({fixed:document.documentElement.hasAttribute('data-fixed-canvas'),cards:document.querySelector('.cards').getBoundingClientRect().height,overflow:getComputedStyle(document.getElementById('diagram-notes-content')).overflow,transform:getComputedStyle(document.querySelector('.diagram-container > svg')).transform,clip:getComputedStyle(document.querySelector('.diagram-container > svg')).clipPath})`);
    assert.equal(print.fixed,false);assert.ok(print.cards>0);assert.notEqual(print.overflow,'auto');assert.equal(print.transform,'none');assert.equal(print.clip,'none');
    const printedDiagram=await run(`(()=>{const svg=document.querySelector('.diagram-container > svg');return {height:svg.getBoundingClientRect().height,pageHeight:innerHeight,grid:getComputedStyle(document.querySelector('.infinite-canvas-grid')).display};})()`);
    assert.ok(printedDiagram.height<=printedDiagram.pageHeight-120,JSON.stringify(printedDiagram));
    assert.equal(printedDiagram.grid,'none');
    if(evidence){const pdf=await send('Page.printToPDF',{printBackground:true,preferCSSPageSize:true});fs.writeFileSync(path.join(evidence,'complete-diagram-and-notes.pdf'),Buffer.from(pdf.data,'base64'));}
    await send('Emulation.setEmulatedMedia',{media:''});await stable();
    for(const query of ['&embed=1','&present=1','&embed=1&present=1']) {
      await load(fixtures[0],1440,900,'light',query);
      assert.equal(await run(`document.documentElement.hasAttribute('data-fixed-canvas')`),false);
    }
    records.push({case:'fallback-and-print',print});
  });
});
