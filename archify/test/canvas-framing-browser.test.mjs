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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configured = Object.hasOwn(process.env, 'ARCHIFY_CHROME');
const chrome = configured ? findChrome() : null;
if (configured && !chrome) throw new Error('ARCHIFY_CHROME must identify an executable browser.');
const examples = {architecture:'web-app.architecture.json',workflow:'agent-tool-call.workflow.json',
  sequence:'cache-miss-request.sequence.json',dataflow:'product-analytics.dataflow.json',lifecycle:'agent-run.lifecycle.json'};
const observation = `(() => {
  const c=document.querySelector('.diagram-container'),s=c.querySelector(':scope > svg'),v=s.viewBox.baseVal;
  const r=e=>{const a=e.getBoundingClientRect();return {left:a.left,top:a.top,right:a.right,bottom:a.bottom,width:a.width,height:a.height};};
  const style=getComputedStyle(c),b=c.getBoundingClientRect();
  const stage={left:Math.max(b.left+c.clientLeft,0)+parseFloat(style.paddingLeft),top:Math.max(b.top+c.clientTop,0)+parseFloat(style.paddingTop),
    right:Math.min(b.left+c.clientLeft+c.clientWidth,innerWidth)-parseFloat(style.paddingRight),bottom:Math.min(b.top+c.clientTop+c.clientHeight,innerHeight)-parseFloat(style.paddingBottom)};
  const matrix=s.getScreenCTM(),p=new DOMPoint((stage.left+stage.right)/2,(stage.top+stage.bottom)/2).matrixTransform(matrix.inverse());
  return {state:Archify.view.state(),fixed:document.documentElement.hasAttribute('data-fixed-canvas'),
    stage,svg:r(s),effective:matrix.a,center:{x:p.x,y:p.y},node:r(s.querySelector('[data-node-id]')),
    viewBox:s.getAttribute('viewBox'),range:[document.scrollingElement.scrollWidth-innerWidth,document.scrollingElement.scrollHeight-innerHeight],
    page:[scrollX,scrollY],notes:document.documentElement.hasAttribute('data-notes-open'),
    nodes:[...s.querySelectorAll('[data-node-id]')].map(n=>n.dataset.nodeId),
    texts:[...s.querySelectorAll('text')].map(n=>n.textContent),errors:framingErrors};
})()`;
function contained(o,label) {
  assert.equal(o.fixed,true,label);
  for(const [a,b,sign] of [['left','left',1],['top','top',1],['right','right',-1],['bottom','bottom',-1]])
    assert.ok(sign*(o.svg[a]-o.stage[b])>=14,`${label} ${a}: ${JSON.stringify(o)}`);
  assert.ok(Math.abs((o.svg.left+o.svg.right-o.stage.left-o.stage.right)/2)<=2,label+' horizontal center');
  assert.ok(Math.abs((o.svg.top+o.svg.bottom-o.stage.top-o.stage.bottom)/2)<=2,label+' vertical center');
  assert.ok(o.effective>0&&o.effective<=1.00001,label+' no automatic enlargement');
  assert.ok(Math.abs(o.effective-o.state.scale)<=Math.max(1e-6,o.state.scale*.005),label+' honest scale');
  assert.ok(o.range.every(v=>v<=1),label+' page containment');assert.deepEqual(o.errors,[]);
}
function sameReading(before,after,label) {
  assert.ok(Math.abs(after.effective/before.effective-1)<=.005,label+' actual scale');
  for(const k of ['width','height'])assert.ok(Math.abs(after.node[k]-before.node[k])<=1,label+' actual node '+k);
  assert.ok(Math.abs(after.center.x-before.center.x)*after.effective<=2,label+' horizontal reading point');
  assert.ok(Math.abs(after.center.y-before.center.y)*after.effective<=2,label+' vertical reading point');
  assert.deepEqual(after.errors,[]);
}

function framingFixtures(scratch) {
  const fixtures=[];
  function render(name,mode,source,repo) {
    const file=path.join(scratch,name+'.html');
    execFileSync(process.execPath,[path.join(root,'bin/archify.mjs'),'render',mode,source,file,...(repo?['--repo-root',repo]:[])]);
    fixtures.push({name,file,source,sha256:createHash('sha256').update(fs.readFileSync(source)).digest('hex')});
  }
  for(const [mode,name] of Object.entries(examples))render(mode,mode,path.join(root,'examples',name));
  if(process.env.ARCHIFY_FRAMING_MAKA_SOURCE)render('maka','architecture',process.env.ARCHIFY_FRAMING_MAKA_SOURCE,process.env.ARCHIFY_FRAMING_MAKA_ROOT);
  const small={schema_version:1,diagram_type:'architecture',meta:{title:'Small diagram',output:'small.html',viewBox:[600,260]},
    components:[{id:'entry',type:'frontend',label:'Entry',sublabel:'Input context',pos:[40,70],size:[180,70]},
      {id:'result',type:'backend',label:'Result',sublabel:'Output context',pos:[380,70],size:[180,70]}],
    connections:[{from:'entry',to:'result',label:'Execute'}],
    cards:[{dot:'cyan',title:'Complete explanation',items:Array.from({length:80},(_,i)=>'Explanation item '+(i+1))}]};
  const smallSource=path.join(scratch,'small.json');fs.writeFileSync(smallSource,JSON.stringify(small));render('small','architecture',smallSource);
  render('long-300','workflow',path.resolve(root,'../benchmarks/hybrid-large-world-viewer-pilot/corpus/workflow-300.workflow.json'));
  const wide=JSON.parse(fs.readFileSync(path.join(root,'examples',examples.sequence)));wide.meta.viewBox[0]=24000;
  const wideSource=path.join(scratch,'wide.json');fs.writeFileSync(wideSource,JSON.stringify(wide));render('wide','sequence',wideSource);
  return fixtures;
}

test('Canvas framing fixtures render successfully before browser verification',t=>{
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'archify-framing-preflight-'));
  t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
  const fixtures=framingFixtures(scratch);
  for(const fixture of fixtures)assert.ok(fs.statSync(fixture.file).size>0,fixture.name);
});

test('Stable canvas framing preserves complete first view and manual reading geometry',{
  skip:chrome?false:'Set ARCHIFY_CHROME to run stable framing browser acceptance.',
},async t=>{
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'archify-framing-'));
  t.after(()=>fs.rmSync(scratch,{recursive:true,force:true}));
  const evidence=process.env.ARCHIFY_FRAMING_EVIDENCE;
  if(evidence)fs.mkdirSync(evidence,{recursive:true});
  const records=[];t.after(()=>{if(evidence)fs.writeFileSync(path.join(evidence,'observations.json'),JSON.stringify(records,null,2)+'\n');});
  const fixtures=framingFixtures(scratch);
  const browser=desktopBrowser(chrome);t.after(()=>browser.close());const session=await browser.sessionPromise;
  const send=(method,params={})=>browser.cdp.send(method,params,session);
  async function run(expression){const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result?.value;}
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`
    window.framingErrors=[];window.framingFrames=[];
    if(new URLSearchParams(location.search).has('framingDelayFonts')){
      const originalFonts=document.fonts;
      Object.defineProperty(document,'fonts',{configurable:true,value:{ready:new Promise(resolve=>{
        window.releaseFramingFonts=()=>{Object.defineProperty(document,'fonts',{configurable:true,value:originalFonts});resolve();};
      })}});
    }
    addEventListener('error',e=>framingErrors.push(e.message));addEventListener('unhandledrejection',e=>framingErrors.push(String(e.reason)));
    function frame(){const c=document.querySelector('.diagram-container'),s=c&&c.querySelector(':scope > svg');
      if(s&&s.clientWidth&&window.Archify&&Archify.view){const r=s.getBoundingClientRect(),b=c.getBoundingClientRect();
        framingFrames.push({state:Archify.view.state(),fixed:document.documentElement.hasAttribute('data-fixed-canvas'),
          rect:{left:r.left,right:r.right,top:r.top,bottom:r.bottom},stage:{left:b.left,right:b.right,top:b.top,bottom:b.bottom}});}
      if(framingFrames.length<24)requestAnimationFrame(frame);}
    requestAnimationFrame(frame);`});
  async function stable(){await run(`(async()=>{await document.fonts.ready;await Archify.readerLayout.whenStable();await Archify.viewerChromeLayout.whenStable();
    let previous='',equal=0;for(let n=0;n<150;n++){await new Promise(requestAnimationFrame);const s=document.querySelector('.diagram-container > svg');
      const value=JSON.stringify([Archify.view.state(),s.getBoundingClientRect().toJSON(),getComputedStyle(s).transform]);
      equal=value===previous?equal+1:0;previous=value;if(equal>=8&&!document.querySelector('[data-camera-transaction]'))return;}
    throw new Error('Framing did not settle');})()`);}
  let loadId=0;
  async function load(file,width=1440,height=900,theme='light',hash='',wait=true){
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
    // Each case tests initialization, including links that otherwise navigate only the hash.
    const ready=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:pathToFileURL(file).href+'?theme='+theme+'&framingLoad='+(++loadId)+hash});await ready;if(wait)await stable();
  }
  async function shot(name){if(evidence){const r=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,name+'.png'),Buffer.from(r.data,'base64'));}}
  async function sample(label){const o=await run(observation);records.push({label,...o});return o;}
  for(const fixture of fixtures.filter(f=>f.name!=='small'&&f.name!=='long-300'&&f.name!=='wide')){
    for(const [width,height] of [[1366,768],[1440,900],[2048,1320]])for(const theme of ['light','dark']){
      await t.test(`${fixture.name}-${width}-${theme} first view`,async()=>{
        const label=`${fixture.name}-${width}-${theme}`;
        const baseline=process.env.ARCHIFY_FRAMING_BASELINE&&path.join(process.env.ARCHIFY_FRAMING_BASELINE,fixture.name+'.html');
        let before;
        if(baseline&&fs.existsSync(baseline)){
          await load(baseline,width,height,theme);before=await sample('baseline-'+label);await shot('baseline-'+label);
          const spec=path.join(process.env.ARCHIFY_FRAMING_BASELINE,fixture.name+'.json');
          assert.equal(createHash('sha256').update(fs.readFileSync(spec)).digest('hex'),fixture.sha256,'same input');
        }
        await load(fixture.file,width,height,theme);const o=await sample('candidate-'+label);await shot('candidate-'+label);
        if(before){assert.equal(o.viewBox,before.viewBox);assert.deepEqual(o.nodes,before.nodes);assert.deepEqual(o.texts,before.texts);}
        contained(o,label);
        const frames=await run('framingFrames');records.push({label:'first-frames-'+label,frames});
        for(const frame of frames){assert.equal(frame.fixed,true);assert.ok(frame.rect.top>=frame.stage.top-2&&frame.rect.bottom<=frame.stage.bottom+2,label+' no clipped first frame');}
        if(width===1440){
          await run('Archify.view.reset()');await stable();
          const reading=await sample('reading-100-'+label);await shot('reading-100-'+label);
          assert.ok(Math.abs(reading.effective-1)<=.005,'100% uses authored size');
          assert.deepEqual(reading.texts,o.texts,'all original text remains at reading scale');
        }
      });
    }
  }
  for(const name of ['small','long-300','wide'])await t.test(name+' complete initial view and continuous zoom',async()=>{
    const f=fixtures.find(f=>f.name===name);await load(f.file);const initial=await sample(name+'-initial');await shot(name+'-initial');contained(initial,name);
    if(name==='small')assert.equal(initial.effective,1);
    if(name!=='small')assert.ok(initial.effective<.25);
    await run('Archify.view.zoomIn()');await stable();const zoomed=await sample(name+'-zoom');assert.ok(zoomed.effective>initial.effective);
    if(initial.effective<.2)assert.ok(zoomed.effective<.25);
    for(const axis of ['x','y'])assert.ok(Math.abs(zoomed.center[axis]-initial.center[axis])*zoomed.effective<=2,
      name+' zoom buttons must keep the visible reading center');
  });
  await t.test('manual proportions and reading center survive notes and resize',async()=>{
    await load(fixtures.find(f=>f.name==='small').file);
    for(const scale of [.1,.5,1,2]){
      // The low-scale case uses the large fixture whose valid minimum is below 25%.
      if(scale===.1)await load(fixtures.find(f=>f.name==='wide').file);
      else await load(fixtures.find(f=>f.name==='small').file);
      await run(`Archify.view.reset();Archify.view.zoomAt(${scale},400,300);Archify.view.panBy(-180,90)`);await stable();
      let previous=await sample('manual-'+scale);assert.ok(Math.abs(previous.effective-scale)<.005);
      const hasNotes=await run(`!document.getElementById('btn-diagram-notes').hidden`);
      if(hasNotes)for(let i=0;i<20;i++){
        await run(`document.getElementById('btn-diagram-notes').click()`);await stable();const next=await sample('notes-'+scale+'-'+i);sameReading(previous,next,'notes '+scale);previous=next;
        if(i<2)await shot('notes-'+scale+'-'+i);
      }
      for(let i=0;i<3;i++)for(const [width,height] of [[1100,700],[2048,1320],[1440,900]]){
        await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});await stable();
        const next=await sample('resize-'+scale+'-'+i+'-'+width);sameReading(previous,next,'resize '+scale);previous=next;
      }
      for(let i=0;i<3;i++){
        await send('Emulation.setDeviceMetricsOverride',{width:1023,height:599,deviceScaleFactor:1,mobile:false});await stable();
        await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await stable();
        const next=await sample('breakpoint-'+scale+'-'+i);sameReading(previous,next,'breakpoint '+scale);previous=next;
      }
      await run('Archify.view.fitAll()');await stable();contained(await sample('fit-restored-'+scale),'fit restored');
    }
  });
  await t.test('document-mode input owns the reading point when returning to fixed canvas',async()=>{
    await load(fixtures.find(f=>f.name==='small').file);
    await run('Archify.view.zoomAt(2,400,300);Archify.view.panBy(-90,70)');await stable();
    await send('Emulation.setDeviceMetricsOverride',{width:1023,height:599,deviceScaleFactor:1,mobile:false});await stable();
    await run('Archify.view.zoomAt(.8,400,300);Archify.view.panBy(110,-70)');await stable();
    const before=await sample('fallback-latest-input');assert.equal(before.fixed,false);
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await stable();
    const after=await sample('fallback-latest-return');sameReading(before,after,'newest fallback intent');
  });
  await t.test('delayed font readiness cannot overwrite manual or explicit deep-link intent',async()=>{
    const fixture=fixtures.find(f=>f.name==='maka')||fixtures[0];
    const source=JSON.parse(fs.readFileSync(fixture.source));
    const hashes=['',source.components?.[0]?.id&&'#focus='+encodeURIComponent(source.components[0].id),
      source.meta.views?.[0]?.id&&'#view='+encodeURIComponent(source.meta.views[0].id)].filter(v=>v!==undefined);
    for(const hash of hashes){
      await load(fixture.file,1440,900,'light','&framingDelayFonts=1'+hash,false);
      await run(`(async()=>{for(let i=0;i<45;i++)await new Promise(requestAnimationFrame);})()`);
      assert.equal(await run('typeof releaseFramingFonts'),'function');
      if(!hash)await run('Archify.view.zoomAt(1.5,400,300);Archify.view.panBy(-70,50)');
      const before=await sample('fonts-pending-'+hash);
      assert.equal(before.state.mode,hash?'semantic':'manual');
      await run('releaseFramingFonts()');await stable();
      const after=await sample('fonts-released-'+hash);await shot('fonts-released-'+(hash?'linked':'manual'));
      assert.equal(after.state.mode,before.state.mode);
      if(!hash)sameReading(before,after,'late fonts preserve manual input');
      else {
        sameReading(before,after,'late fonts preserve explicit target');
        assert.ok(Math.abs(after.state.scale-before.state.scale)<=1e-6,'semantic scale stays unchanged');
        for(const axis of ['x','y'])assert.ok(Math.abs(after.state[axis]-before.state[axis])<=.5,'semantic position stays unchanged');
      }
    }
  });
  await t.test('node, chapter and invalid deep links preserve explicit navigation priority',async()=>{
    const fixture=fixtures.find(f=>f.name==='maka')||fixtures[0];
    const source=JSON.parse(fs.readFileSync(fixture.source));
    const node=source.components?.[0]?.id;const chapter=source.meta.views?.[0]?.id;
    for(const hash of [node&&'#focus='+encodeURIComponent(node),chapter&&'#view='+encodeURIComponent(chapter),'#focus=missing-framing-node','#view=missing-framing-chapter'].filter(Boolean)){
      await load(fixture.file,1440,900,'light',hash);let before=await sample('deep-link-'+hash);
      if(hash.includes('missing-'))contained(before,'invalid link falls back');
      else assert.equal(before.state.mode,'semantic');
      await run(`dispatchEvent(new Event('load'));Archify.readerLayout.schedule()`);await stable();
      assert.deepEqual((await sample('late-layout-'+hash)).state,before.state);
      await run('Archify.view.panBy(80,-50)');await stable();before=await sample('user-wins-'+hash);
      await run(`Archify.readerLayout.schedule();Archify.viewerChromeLayout.schedule()`);await stable();
      sameReading(before,await sample('late-user-'+hash),'late initialization');
    }
  });
});

test('semantic selection framing contains every target with desktop notes open or closed', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to check semantic chapter containment.',
}, async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-chapter-fit-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const source = path.join(root, 'examples', examples.architecture);
  const spec = JSON.parse(fs.readFileSync(source, 'utf8'));
  const file = path.join(scratch, 'architecture.html');
  execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'render', 'architecture', source, file]);
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined);
    return result.result?.value;
  }
  async function stable() {
    await run(`(async()=>{
      await document.fonts.ready;
      await Archify.readerLayout.whenStable();
      await Archify.viewerChromeLayout.whenStable();
      for(let i=0,previous='',same=0;i<180;i++){
        await new Promise(requestAnimationFrame);
        const value=JSON.stringify([Archify.view.state(),document.querySelector('.diagram-container').getBoundingClientRect().toJSON()]);
        same=value===previous?same+1:0;previous=value;
        if(same>=8&&!document.querySelector('[data-camera-transaction]'))return;
      }
      throw new Error('Chapter framing did not settle');
    })()`);
  }
  const records = [];
  for (const width of [1024, 1440, 2048]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(file).href + '?chapter-fit=' + width });
    await loaded; await stable();
    for (const notes of [false, true]) {
      if (notes) { await run("document.getElementById('btn-diagram-notes').click()"); await stable(); }
      // Guided chapters were retired on dev. Exercise the same multi-target
      // camera contract through the supported reveal API instead.
      for (const chapter of [{ id: 'all-components', focus: spec.components.map(c => c.id) }]) {
        await run(`Archify.view.reveal(${JSON.stringify(chapter.focus)})`);
        await stable();
        const observed = await run(`(()=>{
          const stage=Archify.viewerChromeLayout.stageRect();
          return {state:Archify.view.state(),stage,nodes:${JSON.stringify(chapter.focus)}.map(id=>{
            const r=document.querySelector('[data-node-id="'+id+'"]').getBoundingClientRect();
            return {id,left:r.left,right:r.right,top:r.top,bottom:r.bottom};
          })};
        })()`);
        records.push({ width, notes, chapter: chapter.id, ...observed });
        assert.equal(observed.state.mode, 'semantic');
        for (const node of observed.nodes) {
          assert.ok(node.left >= observed.stage.left - 1 && node.right <= observed.stage.right + 1 &&
            node.top >= observed.stage.top - 1 && node.bottom <= observed.stage.bottom + 1,
          JSON.stringify({ width, notes, chapter: chapter.id, ...observed }));
        }
      }
    }
  }
  if (process.env.ARCHIFY_FRAMING_EVIDENCE) {
    fs.mkdirSync(process.env.ARCHIFY_FRAMING_EVIDENCE, { recursive: true });
    fs.writeFileSync(path.join(process.env.ARCHIFY_FRAMING_EVIDENCE, 'chapter-containment.json'), JSON.stringify(records, null, 2) + '\n');
  }
});
