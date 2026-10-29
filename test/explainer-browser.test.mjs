import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ChromeVisualBrowser,findChrome,runBrowserCheck} from '../archify/bin/visual-check.mjs';
import {unpackPageBundle} from '../archify/explainer/page-bundle.mjs';
import {inspectPublicHtml,inspectExplainerBrowser,inspectNativePreviewLayout,inspectNativeViewer,explainerObservation,explainerObservationDiagnostics} from '../archify/explainer/browser-check.mjs';
// The maintained browser runner supplies ARCHIFY_CHROME; ordinary Node runs stay headless.
const chrome=process.env.ARCHIFY_CHROME || process.env.ARCHIFY_EXPLAINER_BROWSER_TESTS==='1' ? findChrome() : null;
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-explainer-browser-tests-'));
function artifact(name,html){const file=path.join(dir,name+'.html');fs.writeFileSync(file,html);return file;}
const style='<style>body{font:16px/1.5 sans-serif;margin:20px;color:#171717;background:white}button{font:inherit}:focus-visible{outline:2px solid blue}@media(prefers-color-scheme:dark){body{background:#171717;color:white}}</style>';
test('common public HTML QA measures real keyboard, references, themes and horizontal layout without Archify markers',{skip:!chrome},async()=>{
 const browser=new ChromeVisualBrowser(chrome);try {
  const file=artifact('public',`<!doctype html><html><head>${style}</head><body><h1 id="answer">A public answer</h1><p>Readable content</p><a href="#answer">Answer</a><button>Choose</button></body></html>`);
  for(const width of [1280,1440])for(const theme of ['light','dark']){
   const measured=await inspectPublicHtml(browser,{artifactPath:file,width,theme});assert.equal(measured.keyboardTraversal.ok,true,JSON.stringify(measured));assert.deepEqual(measured.consoleErrors,[]);assert.deepEqual(measured.references,[]);assert.equal(measured.resolvedTheme,theme);assert.equal(measured.scrollWidth,width);assert.deepEqual(measured.overflowElements,[]);
  }
  const invalid=artifact('invalid',`<!doctype html><html><head>${style}</head><body><div style="width:2000px">Overflow</div><a href="#absent">Missing</a><div role="button" tabindex="-1" onclick="void 0">Unreachable</div><script>console.error('deliberate regression')</script></body></html>`);
  const measured=await inspectPublicHtml(browser,{artifactPath:invalid,width:1280});assert.ok(measured.scrollWidth>1280);assert.ok(measured.overflowElements.length);assert.ok(measured.keyboardIssues.length);assert.ok(measured.references.length);assert.ok(measured.references[0].stableComponent);assert.equal(measured.references[0].text,'Missing');assert.ok(measured.consoleErrors.some(e=>e.includes('deliberate regression')));
 }finally{await browser.close();}
});
function formalDocument(){return {schema_version:1,diagram_type:'explainer',meta:{id:'browser-case',title:'A test explanation',locale:'en'},answer:{summary:'Read the cache first.',reasons:['Fewer database queries'],scope:'Illustrative request path'},panels:[{id:'why',title:'Why does it work?',blocks:[{id:'claim',type:'prose',text:'A cached read takes [5ms](typical:Illustrative timing only, not measured).'}]}],sources:[{id:'example',title:'Example'}]};}
test('formal renderer retains keyboard navigation, static reading and print modes',{skip:!chrome},async()=>{
 const {renderExplainer}=await import('../archify/explainer/render.mjs');
 const document=formalDocument();
 const file=artifact('formal',renderExplainer(document,{preparedSources:{sources:{example:{id:'example',title:'Example'}}},sourceText:JSON.stringify(document)}));
 const browser=new ChromeVisualBrowser(chrome);try {const metrics=await inspectExplainerBrowser(browser,{artifactPath:file,width:1440,height:900,theme:'light'});const entry=explainerObservation({width:1440,height:900,theme:'light',metrics});assert.deepEqual(explainerObservationDiagnostics({artifact:file,allObservations:[entry]}),[]);}finally{await browser.close();}
 const gate=await runBrowserCheck({artifactPath:file,chromePath:chrome});assert.equal(gate.exitCode,0,JSON.stringify(gate.receipt.diagnostics));assert.equal(gate.receipt.family,'explainer');assert.equal(gate.receipt.containment.viewports.length,4);assert.equal(gate.receipt.noJavaScript.status,'pass');
});
test.after(()=>fs.rmSync(dir,{recursive:true,force:true}));

test('source cards keep their evidence and return link reachable in short viewports',{skip:!chrome},async()=>{
 const {renderExplainer}=await import('../archify/explainer/render.mjs');
 const doc=formalDocument();doc.answer.summary='Read the [source](source:example).';
 const excerpt=Array.from({length:14},(_,i)=>`Evidence line ${i+1}: ${'complete text '.repeat(12)}`).join('\n');
 const source={id:'example',title:'Pinned source excerpt',path:'src/example.js',lines:[10,23],revision:'abc1234',url:'https://example.com/source',text:excerpt};
 const file=artifact('source-card-viewport',renderExplainer(doc,{preparedSources:{sources:{example:source}},sourceText:JSON.stringify(doc)}));
 const browser=new ChromeVisualBrowser(chrome);
 const visible=()=>pageValue(browser,`(()=>{const card=document.querySelector('.source-card'),box=card.getBoundingClientRect();return !card.hidden&&box.top>=0&&box.bottom<=innerHeight+1&&box.left>=0&&box.right<=innerWidth+1;})()`);
 try {
  await inspectPublicHtml(browser,{artifactPath:file,width:390,keyboard:false});
  for(const [width,height] of [[390,480],[1440,480],[390,240],[390,900]]) {
   await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},await browser.sessionPromise);
   await pageValue(browser,'document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
   await pageValue(browser,`(()=>{const a=document.querySelector('.cite a');a.scrollIntoView({block:'center'});a.focus();})()`);
   assert.equal(await visible(),true,`source card remains inside ${width} x ${height}`);
   assert.equal(await pageValue(browser,'document.querySelector(".source-card pre code").textContent.includes("Evidence line 14:")'),true,'the last excerpt line is retained');
   await keyboardActivate(browser,'.cite a','Tab');
   assert.equal(await pageValue(browser,'document.activeElement===document.querySelector(".source-card a")'),true,'the source link remains keyboard reachable');
   assert.equal(await visible(),true,'focusing a card link does not push the card out of view');
   if(height===240) {
    assert.ok(await pageValue(browser,'document.querySelector(".source-card").scrollTop')>0,'the short card scrolls to reveal its source link');
    for(const type of ['keyDown','keyUp'])await browser.cdp.send('Input.dispatchKeyEvent',{type,key:'Home',code:'Home',windowsVirtualKeyCode:36},await browser.sessionPromise);
    assert.equal(await pageValue(browser,'new Promise(resolve=>{const card=document.querySelector(".source-card"),end=performance.now()+2000;function check(){if(card.scrollTop===0)return resolve(true);if(performance.now()>end)return resolve(false);requestAnimationFrame(check);}check();})'),true,'Home returns to the first evidence lines inside the short card');
   }
   await keyboardActivate(browser,'.source-card a','Escape');
   assert.equal(await pageValue(browser,'document.querySelector(".source-card").hidden&&document.activeElement===document.querySelector(".cite a")'),true,'Escape returns to the citation');
   await pageValue(browser,'document.activeElement.blur()');
   if(height===240) {
    await pageValue(browser,'document.querySelector(".cite a").focus()');
    assert.equal(await pageValue(browser,'document.querySelector(".source-card").scrollTop'),0,'reopening starts with the source heading and first lines');
    await keyboardActivate(browser,'.cite a','Escape');
    await pageValue(browser,'document.activeElement.blur()');
   }
  }
 }finally{await browser.close();}
});

test('authored answer and panel spans remain exact through measured layout and reader relayout',{skip:!chrome},async()=>{
 const {renderExplainer}=await import('../archify/explainer/render.mjs');
 const doc=formalDocument();doc.meta.locale='zh-CN';doc.answer.span=12;
 const literal='Keep this complete command: '+ 'x'.repeat(100);
 doc.panels=Array.from({length:12},(_,index)=>({id:`fixed-${index+1}`,title:'Width',span:index+1,blocks:[index===5?{id:'fixed-code',type:'snippet',text:literal}:{id:`text-${index+1}`,type:'prose',text:'X'}]}));
 doc.panels.push({id:'after-full',title:'Last',span:6,blocks:[{id:'last-text',type:'prose',text:'X'}]});
 const file=artifact('fixed-spans',renderExplainer(doc,{sourceText:JSON.stringify(doc)})),browser=new ChromeVisualBrowser(chrome);
 const measure=()=>pageValue(browser,`(()=>{const board=document.querySelector('.board'),gap=parseFloat(getComputedStyle(board).columnGap),column=(board.clientWidth-gap*11)/12;return [...board.querySelectorAll('[data-span-fixed]')].map(panel=>({id:panel.id,span:Number(panel.dataset.spanFixed),width:panel.getBoundingClientRect().width,expected:column*Number(panel.dataset.spanFixed)+gap*(Number(panel.dataset.spanFixed)-1),text:panel.querySelector('.panel-body').textContent}));})()`);
 const exact=async()=>{const rows=await measure();assert.deepEqual(rows.map(row=>row.id),['answer',...doc.panels.map(panel=>panel.id)],'authored panels retain source order');assert.deepEqual(rows.filter(row=>Math.abs(row.width-row.expected)>1),[],'a fixed width is not a minimum or a full-row fallback');assert.ok(rows[6].text.includes(literal),'a narrow authored code panel retains its complete text');};
 const settled=()=>pageValue(browser,'document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))');
 try {
  await inspectPublicHtml(browser,{artifactPath:file,width:1440,theme:'light',keyboard:false});await exact();
  await keyboardActivate(browser,'[data-style-toggle]');await keyboardActivate(browser,'[data-style-choice="editorial"]');await settled();await exact();
  await keyboardActivate(browser,'[data-theme-choice="dark"]');await settled();await exact();
  for(const width of [900,390,1440]){
   await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false},await browser.sessionPromise);await settled();
   if(width===390){const rows=await measure();assert.ok(rows.every(row=>Math.abs(row.width-rows[0].width)<1),'phone panels still stack at the full available width');}
   else await exact();
  }
  assert.equal(await pageValue(browser,"document.querySelector('#fixed-6 pre code').textContent"),literal);
 }finally{await browser.close();}
});

test('retry layout and referenced node explanations remain readable and keyboard accessible after a prose edit',{skip:!chrome},async()=>{
 const {renderExplainer}=await import('../archify/explainer/render.mjs');
 const {compileExplainerDiagram,prepareExplainerDiagrams}=await import('../archify/explainer/diagrams.mjs');
 const rows=['enter | Enter','check | Check?','verify | Verify?','record | Record','done | Done','revise | Revise',
  'enter > check','check > verify | yes','verify > record | yes','record > done',
  'check > revise | no','verify > revise | no','record > revise | error','revise > enter | retry | dashed'];
 const doc=formalDocument();doc.meta.id='shared-explanation';
 doc.panels.push({id:'retry-panel',title:'How does a retry work?',blocks:[{id:'retry',type:'diagram',diagramType:'workflow',
  spec:compileExplainerDiagram('workflow',rows,{id:'retry',title:'Review and retry'}),nodeBlocks:{check:'claim'}}]});
 const preparedDiagrams=await prepareExplainerDiagrams(doc,{baseDir:dir,quality:'showcase'});
 const browser=new ChromeVisualBrowser(chrome);
 try {
  for (const text of ['One original explanation.','An edited explanation with literal `<script>` text.']) {
   doc.panels[0].blocks[0].text=text;
   const file=artifact(text.startsWith('One')?'content-original':'content-edited',renderExplainer(doc,{preparedDiagrams,sourceText:JSON.stringify(doc)}));
   await browser.resetPage();const measured=await inspectPublicHtml(browser,{artifactPath:file,width:1440,keyboard:false});
   assert.deepEqual(measured.consoleErrors,[]);assert.deepEqual(measured.overflowElements,[]);
   const shown=await pageValue(browser,`(function(){const node=document.querySelector('#retry [data-node-id="check"]');node.focus();const card=document.querySelector('.source-card');return {focused:document.activeElement===node,visible:!card.hidden,text:card.querySelector('.source-content').textContent,target:card.querySelector('a').getAttribute('href'),nodes:document.querySelectorAll('#retry [data-node-id]').length,edges:new Set([...document.querySelectorAll('#retry [data-edge-id]')].map(e=>e.dataset.edgeId)).size,uniqueIds:new Set([...document.querySelectorAll('[id]')].map(e=>e.id)).size===document.querySelectorAll('[id]').length};})()`);
   assert.equal(shown.focused,true);assert.equal(shown.visible,true);assert.equal(shown.text,text.replaceAll('`',''));
   assert.equal(shown.target,'#claim');assert.equal(shown.nodes,6);assert.equal(shown.edges,8);assert.equal(shown.uniqueIds,true);
   const tree=await browser.cdp.send('Accessibility.getFullAXTree',{},await browser.sessionPromise);
   const accessible=tree.nodes.find(node=>node.role?.value==='button'&&node.name?.value==='Check?');
   assert.equal(accessible?.description?.value,text.replaceAll('`',''),'assistive readers get the same current paragraph');
  }
  await pageValue(browser,'document.querySelector(\'#retry [data-node-id="check"]\').focus();document.querySelector(".source-card").hidden=true');
  await keyboardActivate(browser,'#retry [data-node-id="check"]','Tab');
  const nextFocus = await pageValue(browser,'document.activeElement.dataset.qaKey');
  assert.ok(nextFocus, 'the invoking node has a normal next keyboard destination');
  await keyboardActivate(browser,'#retry [data-node-id="check"]','Tab');
  assert.equal(await pageValue(browser,'new Promise(resolve=>setTimeout(()=>{const card=document.querySelector(".source-card");resolve(!card.hidden&&document.activeElement===card.querySelector("a"));},220))'),true,'Tab reaches a paragraph link that remains visible after the hide delay');
  await keyboardActivate(browser,'.source-card a','Tab',true);
  assert.equal(await pageValue(browser,'document.activeElement===document.querySelector(\'#retry [data-node-id="check"]\')'),true,'Shift+Tab returns to the invoking node');
  await keyboardActivate(browser,'#retry [data-node-id="check"]','Tab');
  await keyboardActivate(browser,'.source-card a','Tab');
  assert.equal(await pageValue(browser,'document.activeElement.dataset.qaKey'),nextFocus,'Tab leaves the card in the normal document order after its invoking node');
  await keyboardActivate(browser,'#retry [data-node-id="check"]','Tab');
  await keyboardActivate(browser,'.source-card a','Escape');
  assert.equal(await pageValue(browser,'document.querySelector(".source-card").hidden&&document.activeElement===document.querySelector(\'#retry [data-node-id="check"]\')'),true,'Escape closes the card and returns focus');
  await keyboardActivate(browser,'#retry [data-node-id="check"]','Tab');
  assert.equal(await pageValue(browser,'document.activeElement.dataset.qaKey'),nextFocus,'after dismissal, Tab proceeds without reopening the card');
  await keyboardActivate(browser,'#retry [data-node-id="check"]','Tab');
  await keyboardActivate(browser,'.source-card a');
  assert.equal(await pageValue(browser,'location.hash'), '#claim', 'the focused paragraph link navigates with Enter');
  for(const key of ['Enter',' ']) {
   await keyboardActivate(browser,'#retry [data-node-id="check"]',key);
   let focused;for(let attempt=0;attempt<40;attempt++){focused=await inspectNativeViewer(browser);if(focused.available&&focused.nodes.includes('check'))break;await new Promise(resolve=>setTimeout(resolve,50));}
   assert.deepEqual(focused.nodes,['check'],'keyboard activation keeps the existing native Viewer action');
   await keyboardActivate(browser,'[data-close-diagram]');
   assert.equal(await pageValue(browser,'document.activeElement===document.querySelector(\'#retry [data-node-id="check"]\')'),true,'closing the Viewer returns to its invoking node');
  }
 }finally{await browser.close();}
});

test('Explainer toolbar and menus remain inside narrow viewports',{skip:!chrome},async()=>{
 const {renderExplainer}=await import('../archify/explainer/render.mjs');
 const browser=new ChromeVisualBrowser(chrome);
 try {
  for(const locale of ['en','zh-CN']) {
   const document=formalDocument();document.meta.locale=locale;
   const file=artifact('toolbar-'+locale,renderExplainer(document));
   for(const width of [320,390,1440])for(const style of ['clean','editorial','product','swiss']) {
    await browser.resetPage();await inspectPublicHtml(browser,{artifactPath:file,width,height:900,keyboard:false});
    await keyboardActivate(browser,'.style-menu [aria-haspopup]');
    await keyboardActivate(browser,`[data-style-choice="${style}"]`);
    const selected=await pageValue(browser,`({style:document.documentElement.dataset.style,label:document.querySelector('[data-style-label]').textContent,choice:document.querySelector('[data-style-choice="${style}"]').textContent})`);
    assert.equal(selected.style,style);assert.equal(selected.label,selected.choice);
    assert.equal(await pageValue(browser,"document.activeElement===document.querySelector('.style-menu [aria-haspopup]')"),true);
    const containment=await pageValue(browser,`({width:innerWidth,scroll:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('.tools button')].filter(e=>e.getBoundingClientRect().width).map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right}})})`);
    assert.equal(containment.scroll,width,JSON.stringify({locale,width,style,containment}));
    assert.ok(containment.controls.every(r=>r.left>=0&&r.right<=width),JSON.stringify(containment));
    for(const menu of ['.style-menu','.export-menu']) {
     await keyboardActivate(browser,menu+' [aria-haspopup]');
     const popup=await pageValue(browser,`(()=>{const e=document.querySelector(${JSON.stringify(menu+' .menu-options')});const r=e.getBoundingClientRect();return {left:r.left,right:r.right,visible:getComputedStyle(e).display!=='none',scroll:document.documentElement.scrollWidth}})()`);
     assert.equal(popup.visible,true);assert.ok(popup.left>=0&&popup.right<=width,JSON.stringify({locale,width,style,menu,popup}));assert.equal(popup.scroll,width);
     assert.equal(await pageValue(browser,`document.querySelector(${JSON.stringify(menu+' .menu-options')}).contains(document.activeElement)`),true,'Keyboard opening must focus a menu item');
     await keyboardPress(browser,'Escape');
     const closed=await pageValue(browser,`(()=>{const toggle=document.querySelector(${JSON.stringify(menu+' [aria-haspopup]')});return {hidden:document.querySelector(${JSON.stringify(menu+' .menu-options')}).hidden,expanded:toggle.getAttribute('aria-expanded'),focused:document.activeElement===toggle}})()`);
     assert.deepEqual(closed,{hidden:true,expanded:'false',focused:true},JSON.stringify({locale,width,style,menu,closed}));
    }
    await browser.cdp.send('Emulation.setEmulatedMedia',{media:'print'},await browser.sessionPromise);
    assert.equal(await pageValue(browser,"getComputedStyle(document.querySelector('.tools')).display"),'none');
   }
  }
 } finally { await browser.close(); }
});

async function pageValue(browser,expression){const result=await browser.cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},await browser.sessionPromise);if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;}
async function keyboardActivate(browser,selector,key='Enter',shift=false) {assert.equal(await pageValue(browser,`(function(){const e=document.querySelector(${JSON.stringify(selector)});if(!e)return false;e.scrollIntoView({block:'center'});e.focus();return document.activeElement===e;})()`),true,selector);await keyboardPress(browser,key,shift);}
async function keyboardPress(browser,key,shift=false) {for(const type of ['keyDown','keyUp'])await browser.cdp.send('Input.dispatchKeyEvent',{type,key,code:key===' '?'Space':key,windowsVirtualKeyCode:key==='Escape'?27:key===' '?32:key==='Tab'?9:13,modifiers:shift?8:0,...(key==='Enter'&&type==='keyDown'?{text:'\r',unmodifiedText:'\r'}:{})},await browser.sessionPromise);await pageValue(browser,'new Promise(resolve=>setTimeout(resolve,0))');}
test('native step opens the complete Viewer and focuses exact nodes and edges with readable graph text',{skip:!chrome},async()=>{
 const {renderExplainer}=await import('../archify/explainer/render.mjs');const {compileExplainerDiagram,prepareExplainerDiagrams}=await import('../archify/explainer/diagrams.mjs');
 const spec=compileExplainerDiagram('sequence',['actor api | API | backend','actor redis | Redis | database','api | redis | Read cache','redis | api | Return cache'],{title:'Cache lookup',id:'native',quality:'showcase'});
 const doc=formalDocument();doc.meta.id='native-browser';doc.meta.quality_profile='showcase';doc.panels.push({id:'how',title:'Where does the request go?',blocks:[{id:'native',type:'diagram',diagramType:'sequence',spec},{id:'step',type:'steps',items:[{id:'read-step',text:'Read cache',target:{diagram:'native',node:'api',edges:['api-to-redis-1']}},{id:'return-step',text:'Return cache',target:{diagram:'native',node:'redis',edges:['redis-to-api-1']}}]}]});
 const preparedDiagrams=await prepareExplainerDiagrams(doc,{baseDir:dir,sourcePath:path.join(dir,'source.json'),quality:'showcase'});
 const file=artifact('native',renderExplainer(doc,{sourceText:JSON.stringify(doc),preparedDiagrams,preparedSources:{sources:{example:{title:'Example'}}}}));
 const browser=new ChromeVisualBrowser(chrome);try {const metrics=await inspectExplainerBrowser(browser,{artifactPath:file,width:1440,height:900,theme:'light'});assert.deepEqual(metrics.interactionFailures,[]);assert.equal(metrics.nativeText.length,1);assert.ok(metrics.nativeText[0].ratio>=.75,JSON.stringify(metrics.nativeText));assert.equal(metrics.print.ok,true);assert.ok(metrics.noJavaScript.every(e=>e.ok));
  await browser.resetPage();await inspectPublicHtml(browser,{artifactPath:file,width:1440,keyboard:false});
  const focusStep=async(index,nodes,edges)=>{await keyboardActivate(browser,`[data-block-type=steps] [data-diagram-hash="focus=${nodes[0]}"]`);let actual;for(let attempt=0;attempt<40;attempt++){actual=await inspectNativeViewer(browser);if(actual.available&&JSON.stringify(actual.nodes)===JSON.stringify(nodes)&&actual.edges.length===edges.length&&edges.every(id=>actual.edges.includes(id)))break;await new Promise(resolve=>setTimeout(resolve,50));}assert.deepEqual(actual.nodes,nodes,JSON.stringify(actual));assert.deepEqual(actual.edges,edges,JSON.stringify(actual));return actual;};
  const closeStep=async()=>{
   // dialog.close() queues close; the reader restores opener focus in that
   // event. Finish it before the next helper focuses its requested step.
   await pageValue(browser,`(()=>{const dialog=document.querySelector('#diagram-dialog');window.__nativeCloseResult=new Promise(resolve=>{const state=closed=>({closed,open:dialog.open,activeElement:document.activeElement?.outerHTML?.slice(0,400)});const finish=()=>{clearTimeout(timeout);resolve(state(true));};const timeout=setTimeout(()=>{dialog.removeEventListener('close',finish);resolve(state(false));},5000);dialog.addEventListener('close',finish,{once:true});});})()`);
   await keyboardActivate(browser,'[data-close-diagram]');
   const closed=await pageValue(browser,'(async()=>{const result=await window.__nativeCloseResult;delete window.__nativeCloseResult;return result;})()');
   assert.equal(closed.closed,true,JSON.stringify(closed));assert.equal(closed.open,false,JSON.stringify(closed));
  };
  // Closing the modal makes the next step reachable. Reopening uses the same
  // iframe with a different target, and the third opening changes it back. Actual child DOM selection is the proof, not the host's last ack.
  const first=await focusStep(1,['api'],['api-to-redis-1']);await closeStep();const second=await focusStep(2,['redis'],['redis-to-api-1']);assert.equal(second.targetId,first.targetId,'The second step must update the existing native iframe');await closeStep();const reopened=await focusStep(1,['api'],['api-to-redis-1']);assert.equal(reopened.targetId,first.targetId);await closeStep();
  const corrupted=artifact('native-small-text',fs.readFileSync(file,'utf8').replace('</style>','\n.diagram-preview svg{width:100%!important;min-width:0!important}.diagram-preview{width:200px!important}\n</style>'));
  const broken=await inspectExplainerBrowser(browser,{artifactPath:corrupted,width:1440,height:900,theme:'light'});assert.ok(broken.interactionFailures.some(e=>e.name==='diagram-text'),'Actual reduced graph text must fail the 75% gate');
 }finally{await browser.close();}
});

test('wide frozen native previews keep every node visible at 1280 and reclaim the 1440 text floor on live resize',{skip:!chrome},async()=>{
 const {renderExplainer}=await import('../archify/explainer/render.mjs'),{prepareExplainerDiagrams}=await import('../archify/explainer/diagrams.mjs'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 const components=[{id:'browser',type:'external',label:'Browser',pos:[40,40],size:[120,64]},{id:'api',type:'backend',label:'API',pos:[300,40],size:[150,72]},{id:'postgres',type:'database',label:'PostgreSQL',pos:[690,40],size:[150,72]}];
 const connections=[{id:'browser-request',from:'browser',to:'api',label:'请求'},{id:'database-query',from:'api',to:'postgres',label:'查询业务数据'}];
 const makeSpec=(cache)=>({schema_version:1,diagram_type:'architecture',meta:{title:cache?'PostgreSQL + Redis':'PostgreSQL',locale:'zh-CN',quality_profile:'showcase'},components:cache?[...components,{id:'redis',type:'database',label:'Redis',sublabel:'缓存',pos:[300,240],size:[150,72]}]:components,connections:cache?[connections[0],{id:'cache-lookup',from:'api',to:'redis',label:'① 查询缓存'},{id:'database-on-miss',from:'api',to:'postgres',label:'② 缓存未命中时查询'},{id:'cache-fill',from:'api',to:'redis',label:'③ 查询后回写结果'}]:connections});
 const doc=formalDocument();doc.meta.id='responsive-native';doc.meta.quality_profile='showcase';doc.panels.push({id:'plans',title:'Two request paths',blocks:[{id:'pg-only',type:'diagram',diagramType:'architecture',spec:makeSpec(false)},{id:'with-cache',type:'diagram',diagramType:'architecture',spec:makeSpec(true)}]});
 const preparedDiagrams=await prepareExplainerDiagrams(doc,{baseDir:dir,sourcePath:path.join(dir,'responsive.json'),quality:'showcase'}),frozen=Object.fromEntries(Object.entries(preparedDiagrams.diagrams).map(([id,c])=>[id,{sha256:hash(c.html),bytes:Buffer.byteLength(c.html)}]));
 const html=renderExplainer(doc,{sourceText:JSON.stringify(doc),preparedDiagrams,preparedSources:{sources:{example:{title:'Example'}}}}),file=artifact('responsive-native',html),browser=new ChromeVisualBrowser(chrome);
 const assertFit=(measurements,width)=>{assert.equal(measurements.length,2);for(const entry of measurements){assert.equal(new Set(entry.nodes.map(n=>n.id)).size,entry.component==='pg-only'?3:4);assert.deepEqual(entry.outsidePreview,[],JSON.stringify(entry));assert.equal(entry.fit,'fit');assert.ok(entry.scrollWidth<=entry.clientWidth+1,JSON.stringify(entry));assert.equal(parseFloat(entry.minWidth),0);assert.ok(entry.minimum>=10,JSON.stringify(entry));if(width===1440)assert.ok(entry.ratio>=.75,JSON.stringify(entry));}};
 try {
  for(const theme of ['light','dark']) {
   for(const width of [1280,1440]) {
    await browser.resetPage();const common=await inspectPublicHtml(browser,{artifactPath:file,width,theme,keyboard:false});assert.equal(common.scrollWidth,width);assert.deepEqual(common.overflowElements,[]);assert.deepEqual(common.consoleErrors,[]);assertFit(await inspectNativePreviewLayout(browser),width);
   }
   const wide=await inspectNativePreviewLayout(browser);assert.ok(wide.every(e=>parseFloat(e.minWidth)===0&&e.scrollWidth<=e.clientWidth+1),'Complete desktop previews must fit without local horizontal scrolling');
   await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false},await browser.sessionPromise);
   await pageValue(browser,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
   const narrow=await inspectNativePreviewLayout(browser);assertFit(narrow,1280);assert.ok(narrow.every(e=>e.scrollWidth<=e.clientWidth+1&&parseFloat(e.minWidth)===0),'The prior desktop min-width must not remain after a live resize');
  }
  await browser.resetPage();const dark=await inspectPublicHtml(browser,{artifactPath:file,width:1440,theme:'dark',themeControl:'system',javascript:false,keyboard:false});
  const colors=()=>pageValue(browser,`(function(){const background=e=>{for(let p=e;p;p=p.parentElement){const color=getComputedStyle(p).backgroundColor;if(color!=='rgba(0, 0, 0, 0)'&&color!=='transparent')return color;}return 'transparent';};return {body:getComputedStyle(document.body).backgroundColor,previews:Array.from(document.querySelectorAll('.diagram-preview')).map(e=>({background:background(e),edge:getComputedStyle(e.querySelector('text.t-edge-default')).fill}))};})()`);
  const darkColors=await colors();assert.equal(dark.fontReadiness.status,'loaded');assert.deepEqual(dark.consoleErrors,[]);
  await browser.resetPage();const printed=await inspectPublicHtml(browser,{artifactPath:file,width:1440,theme:'dark',themeControl:'system',javascript:false,media:'print',keyboard:false});const printColors=await colors();assert.equal(printed.fontReadiness.status,'loaded');assert.deepEqual(printed.consoleErrors,[]);assert.notEqual(printColors.body,darkColors.body);assert.equal(printColors.body,'rgb(255, 255, 255)');assert.ok(printColors.previews.every(p=>p.background==='rgb(255, 255, 255)'),JSON.stringify(printColors));assert.ok(darkColors.previews.every((p,i)=>p.background!==printColors.previews[i].background&&p.edge!==printColors.previews[i].edge),JSON.stringify({darkColors,printColors}));
  const oversized=structuredClone(doc);oversized.meta.id='oversized-native';oversized.panels.at(-1).blocks=oversized.panels.at(-1).blocks.slice(0,1);oversized.panels.at(-1).blocks[0].spec.components.at(-1).pos=[1200,40];
  const oversizedPrepared=await prepareExplainerDiagrams(oversized,{baseDir:dir,sourcePath:path.join(dir,'oversized.json'),quality:'showcase'}),hugeFile=artifact('oversized-native',renderExplainer(oversized,{sourceText:JSON.stringify(oversized),preparedDiagrams:oversizedPrepared,preparedSources:{sources:{example:{title:'Example'}}}}));
  const huge=await inspectExplainerBrowser(browser,{artifactPath:hugeFile,width:1440,height:900,theme:'light'});assert.equal(huge.nativeText[0].fit,'insufficient');assert.equal(parseFloat(huge.nativeText[0].minWidth),0);assert.ok(huge.nativeText[0].scrollWidth<=huge.nativeText[0].clientWidth+1);assert.ok(huge.interactionFailures.some(e=>e.name==='diagram-fit'&&e.measurement.requiredWidth>e.measurement.clientWidth),'An actually overwide graph must fail with measured fit evidence');assert.ok(huge.interactionFailures.some(e=>e.name==='diagram-text'));
  await browser.resetPage();await inspectPublicHtml(browser,{artifactPath:hugeFile,width:1280,theme:'light',keyboard:false});
  assert.deepEqual(await pageValue(browser,"Array.from(document.querySelectorAll('.panel')).filter(p=>p.scrollHeight>p.offsetHeight+1).map(p=>p.id)"),[],'a fit notice shown after planning must not clip its panel');
  const corrupted=artifact('responsive-retained-floor',html.replace('</style>','\n.diagram-preview>svg{min-width:1321px!important}\n</style>'));await browser.resetPage();await inspectPublicHtml(browser,{artifactPath:corrupted,width:1280,theme:'light',keyboard:false});assert.ok((await inspectNativePreviewLayout(browser)).some(e=>e.outsidePreview.length>0),'A retained desktop floor must be detected through actual clipped node bounds');
  const embedded=Object.fromEntries(Object.entries(unpackPageBundle(await pageValue(browser,"JSON.parse(document.querySelector('#archify-explainer-prepared').textContent)")).preparedDiagrams.diagrams).map(([id,c])=>[id,{html:c.html,sha256:c.sha256,bytes:c.bytes}]));
  for(const [id,c]of Object.entries(embedded)){assert.equal(hash(c.html),frozen[id].sha256);assert.equal(Buffer.byteLength(c.html),frozen[id].bytes);assert.equal(c.sha256,frozen[id].sha256);assert.equal(c.bytes,frozen[id].bytes);}
 }finally{await browser.close();}
});

test('public overflow uses actual clip chains and separates local scroll access from irreversible cropping',{skip:!chrome},async()=>{
 const css=`<style>body{margin:0;font:16px sans-serif}.port{margin:20px 40px;width:500px;height:100px;overflow:auto}.wide{width:1800px;height:60px;position:relative}.far{position:absolute;left:1400px;width:80px}.crop{overflow:hidden}.nested{width:300px;height:70px;overflow:auto}.rtl{direction:rtl}.own-crop{width:100px;overflow:hidden;white-space:nowrap}</style>`;
 const positive=artifact('real-clips',`<!doctype html><html><head>${css}</head><body><div class=port><pre class=wide><code class=far>token</code></pre></div><div class=port><table style="width:1800px;table-layout:fixed"><tr><td style="width:1700px">first cell</td><td>small cell</td></tr></table></div><div class=port><svg width=1800 height=60><rect x=1400 y=10 width=80 height=40 /><text x=1410 y=35>SVG label</text></svg></div><div class="port crop"><div class=wide><span class=far>hidden text</span></div></div><div class=port><div class=nested><div class=wide><span class=far style="transform:translateX(50px)">nested transform</span></div></div></div><div class="port rtl"><div class=wide><span class=far style=left:0>RTL text</span></div></div><div class=port style="transform:translateX(20px)"><span style="position:fixed;left:1400px;width:80px">contained fixed</span></div><p class=own-crop>A sentence whose content exceeds its own hidden box.</p></body></html>`);
 const escaped=artifact('escaping-clips',`<!doctype html><html><head>${css} <style>html,body{overflow-x:hidden}</style></head><body><div class="port crop"><span style="position:absolute;left:1400px;width:80px">absolute escape</span><span style="position:fixed;left:-150px;top:120px;width:80px">fixed escape</span></div><div style="position:fixed;left:1300px;top:250px;width:500px;overflow:auto"><span>scrollport escape</span></div><div style="position:relative;left:1350px;top:350px;width:80px">normal content escape</div></body></html>`);
 const browser=new ChromeVisualBrowser(chrome);try {
  const clipped=await inspectPublicHtml(browser,{artifactPath:positive,width:1280,keyboard:false});assert.equal(clipped.scrollWidth,1280);assert.deepEqual(clipped.overflowElements,[],JSON.stringify(clipped.overflowElements));assert.equal(clipped.measurementMethod.clipping,'native-intersection-observer-expanded-root');assert.ok(clipped.measurementMethod.limits.length);
  const record=text=>clipped.localClipping.find(e=>e.text===text);assert.equal(record('token').access,'manual-scroll',JSON.stringify(record('token')));assert.equal(record('small cell').access,'manual-scroll',JSON.stringify(record('small cell')));assert.equal(record('SVG label').access,'manual-scroll',JSON.stringify(record('SVG label')));assert.equal(record('hidden text').access,'clipped-no-manual-scroll');assert.equal(record('nested transform').access,'manual-scroll');assert.ok(record('RTL text'));assert.equal(clipped.localClipping.find(e=>e.ownContentClipped).access,'clipped-no-manual-scroll');
  const spill=await inspectPublicHtml(browser,{artifactPath:escaped,width:1280,keyboard:false});for(const text of ['absolute escape','fixed escape','scrollport escape'])assert.ok(spill.overflowElements.some(e=>e.text===text),`Actual visible spill must report ${text}: ${JSON.stringify(spill.overflowElements)}`);
  assert.ok(!spill.overflowElements.some(e=>e.text==='normal content escape'),'Body clipping genuinely crops normal content');assert.ok(spill.localClipping.some(e=>e.text==='normal content escape'&&e.access!=='manual-scroll'));const hard=artifact('document-spill',`<!doctype html><html><body><div style="width:1800px;height:40px">real document width</div><span style="display:block;width:80px;transform:translateX(1350px)">transformed escape</span></body></html>`);const extent=await inspectPublicHtml(browser,{artifactPath:hard,width:1280,keyboard:false});assert.ok(extent.scrollWidth>1280);assert.ok(extent.overflowElements.some(e=>e.text==='transformed escape'));
 }finally{await browser.close();}
});

test('public system-theme mode starts with fresh storage and stable DOM identities distinguish duplicate controls',{skip:!chrome},async()=>{
 const file=artifact('system-theme',`<!doctype html><html><head>${style}<style>body[data-light]{background:white;color:black}.small{font-size:8px}.under{position:absolute;left:40px;top:220px}.cover{position:absolute;left:40px;top:220px;width:120px;height:30px;background:red}</style></head><body><button>Same label</button><button>Same label</button><div role=button tabindex=-1>Same label</div><p class=small>Small text</p><button class=under>Covered</button><div class=cover></div><script>window.artifactRan=true;window.seenStored=localStorage.getItem('chosen-theme');if(new URL(location.href).searchParams.has('theme'))document.documentElement.dataset.theme=new URL(location.href).searchParams.get('theme');else document.documentElement.dataset.theme=localStorage.getItem('chosen-theme')||(matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');localStorage.setItem('chosen-theme','light');</script></body></html>`);
 const browser=new ChromeVisualBrowser(chrome);try {
  const queried=await inspectPublicHtml(browser,{artifactPath:file,width:1280,theme:'light'});assert.match(queried.navigationUrl,/theme=light/);assert.equal(queried.fontReadiness.status,'loaded');
  const system=await inspectPublicHtml(browser,{artifactPath:file,width:1440,theme:'dark',themeControl:'system'});assert.equal(new URL(system.navigationUrl).search,'');assert.equal(system.resolvedTheme,'dark');assert.equal(await pageValue(browser,'window.seenStored'),null);assert.equal(system.fontReadiness.status,'loaded');
  const missing=system.keyboardTraversal.missing.find(e=>e.tag==='DIV');assert.ok(missing.stableComponent);assert.equal(missing.text,'Same label');assert.equal(missing.href,null);assert.equal(queried.keyboardTraversal.missing.find(e=>e.tag==='DIV').stableComponent,missing.stableComponent);assert.ok(system.keyboardIssues.every(e=>e.stableComponent));assert.ok(system.occluded.every(e=>e.stableComponent));assert.ok(system.smallText.every(e=>e.stableComponent));
  const duplicates=await pageValue(browser,"Array.from(document.querySelectorAll('button')).filter(e=>e.textContent==='Same label').map(e=>e.dataset.qaPath)");assert.equal(new Set(duplicates).size,2,'Two buttons with the same label have different generic DOM paths');
  await browser.resetPage();const disabled=await inspectPublicHtml(browser,{artifactPath:file,width:1440,theme:'dark',themeControl:'system',javascript:false,keyboard:false});assert.equal(await pageValue(browser,'Boolean(window.artifactRan)'),false);assert.equal(disabled.fontReadiness.status,'loaded');assert.equal(disabled.measurementMethod.clipCoverage,'not-measured-script-disabled');assert.equal(disabled.measurementMethod.documentExtentMeasured,true);assert.equal(disabled.background,'rgb(23, 23, 23)');
 }finally{await browser.close();}
});
test('text names light their diagram nodes and walk-throughs step through steps and messages',{skip:!chrome},async()=>{
 const {renderExplainer}=await import('../archify/explainer/render.mjs');const {compileExplainerDiagram,prepareExplainerDiagrams}=await import('../archify/explainer/diagrams.mjs');
 const spec=compileExplainerDiagram('sequence',['actor api | API | backend','actor redis | Redis | database','api | redis | Read cache','redis | api | Return cache'],{title:'Cache lookup',id:'native',quality:'showcase'});
 const flow=compileExplainerDiagram('workflow',['alert | Alert','check | Check signal','fix | Fix','alert > check','check > fix'],{title:'Triage',id:'flow',quality:'showcase'});
 const doc=formalDocument();doc.meta.id='walk-browser';doc.meta.quality_profile='showcase';doc.panels.push({id:'how',title:'Where does the request go?',blocks:[{id:'native',type:'diagram',diagramType:'sequence',spec},{id:'why',type:'prose',text:'The API asks Redis first, and Redis answers from memory.'},{id:'step',type:'steps',items:[{id:'read-step',text:'Read cache',target:{diagram:'native',node:'api',edges:['api-to-redis-1']}},{id:'return-step',text:'Return cache',target:{diagram:'native',node:'redis',edges:['redis-to-api-1']}}]}]});
 doc.panels.push({id:'triage',title:'How is it handled?',blocks:[{id:'flow',type:'diagram',diagramType:'workflow',spec:flow}]});
 const preparedDiagrams=await prepareExplainerDiagrams(doc,{baseDir:dir,sourcePath:path.join(dir,'walk.json'),quality:'showcase'});
 const file=artifact('walk',renderExplainer(doc,{sourceText:JSON.stringify(doc),preparedDiagrams,preparedSources:{sources:{example:{title:'Example'}}}}));
 const browser=new ChromeVisualBrowser(chrome);try {
  await inspectPublicHtml(browser,{artifactPath:file,width:1440,keyboard:false});
  const result=await pageValue(browser,`(function(){
   const terms=[...document.querySelectorAll('#why .term')].map(t=>t.textContent);
   const redis=document.querySelector('#why .term[data-node="redis"]');redis.dispatchEvent(new MouseEvent('mouseenter'));
   const lit=[...document.querySelectorAll('#native .reader-highlight')].map(e=>e.dataset.nodeId||e.dataset.edgeId);redis.dispatchEvent(new MouseEvent('mouseleave'));
   const step=document.querySelector('#return-step');step.dispatchEvent(new MouseEvent('mouseenter'));const stepHover=[...document.querySelectorAll('#native .reader-highlight')].map(e=>e.dataset.nodeId||e.dataset.edgeId);step.dispatchEvent(new MouseEvent('mouseleave'));const cleared=!document.querySelector('#native .reader-highlight');
   const steps=document.querySelector('ol.steps').previousElementSibling;steps.click();document.querySelector('.walk-bar [data-walk=next]').click();
   const current=document.querySelector('.walk-current')?.id,stepLit=[...document.querySelectorAll('#native .reader-highlight')].map(e=>e.dataset.nodeId||e.dataset.edgeId);
   document.querySelector('.walk-bar [data-walk=end]').click();const ended=!document.querySelector('.walk-bar')&&!document.querySelector('.walk-current');
   const messages=document.querySelector('#native figcaption .walk-start');messages.click();
   const text=document.querySelector('.walk-text').textContent;
   document.querySelector('#how .ask-button').click();document.querySelector('.ask-dialog [data-chip]').click();
   let copied='';navigator.clipboard.writeText=value=>{copied=value;return Promise.resolve();};document.querySelector('.ask-dialog [type=submit]').click();
   return new Promise(resolve=>setTimeout(()=>resolve({terms,lit,stepHover,cleared,current,stepLit,ended,text,copied,open:document.querySelector('.ask-dialog').open}),50));})()`);
  assert.deepEqual(result.terms,['API','Redis'],'each name is linked once per panel');
  assert.deepEqual(result.lit,['redis']);
  const flowWalk=await pageValue(browser,`(function(){const start=document.querySelector('#flow figcaption .walk-start');start.click();const hidden=start.hidden;document.querySelector('.walk-bar [data-walk=next]').click();const lit=[...document.querySelectorAll('#flow .reader-highlight')].map(e=>e.dataset.nodeId||e.dataset.edgeId);const text=document.querySelector('.walk-text').textContent;document.querySelector('.walk-bar [data-walk=end]').click();return {hidden,lit,text,restored:!start.hidden&&!document.querySelector('.walk-bar')};})()`);
  assert.equal(flowWalk.hidden,true,'the walk bar replaces the start button');
  assert.equal(flowWalk.text,'Check signal');
  assert.ok(flowWalk.lit.includes('check')&&flowWalk.lit.includes('alert')&&flowWalk.lit.length>=3,JSON.stringify(flowWalk.lit));
  assert.equal(flowWalk.restored,true);
  assert.deepEqual(result.stepHover.sort(),['redis','redis-to-api-1'],'hovering anywhere in a step lights its node and edge');
  assert.equal(result.cleared,true);
  assert.equal(result.current,'return-step');
  assert.ok(result.stepLit.includes('redis-to-api-1'));
  assert.equal(result.ended,true);
  assert.equal(result.text,'API → Redis: Read cache');
  assert.match(result.copied,/Where: Panel 2 "Where does the request go\?" \(ID: how\)/);
  assert.match(result.copied,/Question: I do not follow this part/);
  assert.match(result.copied,/patch explainer/);
  assert.equal(result.open,false);
  const placement=`(function(){const guide=document.querySelector('#how .guided'),figure=guide.querySelector('.guide-figure').getBoundingClientRect(),text=guide.querySelector('.guide-text').getBoundingClientRect();return {beside:guide.classList.contains('beside'),right:figure.left>=text.right,above:figure.bottom<=text.top,fit:guide.querySelector('.diagram-preview').dataset.diagramFit};})()`;
  assert.deepEqual(await pageValue(browser,placement),{beside:true,right:true,above:false,fit:'fit'},'steps read beside the diagram they walk through');
  await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width:600,height:900,deviceScaleFactor:1,mobile:false},await browser.sessionPromise);
  await pageValue(browser,'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  assert.deepEqual(await pageValue(browser,placement),{beside:false,right:false,above:true,fit:'fit'},'without room for both, the diagram wraps above its steps');
  await pageValue(browser,`document.querySelector('#native .diagram-preview [data-node-id="redis"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);
  let focused;for(let attempt=0;attempt<40;attempt++){focused=await inspectNativeViewer(browser);if(focused.available&&focused.nodes.includes('redis'))break;await new Promise(resolve=>setTimeout(resolve,50));}
  assert.deepEqual(focused.nodes,['redis'],'a node clicked in the preview opens the interactive view focused on it');
  await keyboardActivate(browser,'[data-close-diagram]');
  const style=await pageValue(browser,`(function(){const toggle=document.querySelector('[data-style-toggle]');toggle.click();const open=!document.querySelector('.style-options').hidden&&toggle.getAttribute('aria-expanded')==='true';document.querySelector('[data-style-choice=swiss]').click();return {open,closed:document.querySelector('.style-options').hidden,style:document.documentElement.dataset.style,label:document.querySelector('[data-style-label]').textContent,checked:document.querySelector('[data-style-choice=swiss]').getAttribute('aria-checked'),saved:localStorage.getItem('archify-explainer-style')};})()`);
  assert.deepEqual(style,{open:true,closed:true,style:'swiss',label:'Swiss',checked:'true',saved:'swiss'});
  const image=await pageValue(browser,`window.ArchifyExplainer.pageImage().then(blob=>({type:blob.type,size:blob.size}))`);
  assert.equal(image.type,'image/png');assert.ok(image.size>20000,'the long image carries the rendered page');
 }finally{await browser.close();}
});

test('phone native previews keep readable text with local keyboard scrolling and reset for desktop and print',{skip:!chrome},async()=>{
 const {renderExplainer}=await import('../archify/explainer/render.mjs');
 const {compileExplainerDiagram,prepareExplainerDiagrams}=await import('../archify/explainer/diagrams.mjs');
 const doc=formalDocument();
 const rows=['actor a | Caller A','actor b | Caller B','actor group | Group','actor work | Function','a | group | Start request','group | work | Run function','b | group | Join request','work | group | Result | return','group | a | Result | return','group | b | Same result | return'];
 doc.panels.push({id:'calls',title:'How do calls share work?',blocks:[{id:'calls-flow',type:'diagram',diagramType:'sequence',spec:compileExplainerDiagram('sequence',rows,{id:'calls-flow',title:'Shared work'})}]});
 const preparedDiagrams=await prepareExplainerDiagrams(doc,{baseDir:dir,quality:'showcase'});
 const file=artifact('phone-scroll',renderExplainer(doc,{preparedDiagrams,sourceText:JSON.stringify(doc)}));
 const browser=new ChromeVisualBrowser(chrome);
 try{
  await inspectPublicHtml(browser,{artifactPath:file,width:390,theme:'light',keyboard:false});
  let [preview]=await inspectNativePreviewLayout(browser);
  assert.ok(preview.minimum>=9.95,JSON.stringify(preview));
  assert.ok(preview.scrollWidth>preview.clientWidth,'Overwide diagrams scroll locally instead of shrinking labels');
  assert.equal(await pageValue(browser,'document.querySelector(".diagram-preview").tabIndex'),0);
  const before=await pageValue(browser,'document.querySelector(".diagram-preview").scrollLeft');
  await pageValue(browser,'document.querySelector(".diagram-preview").focus()');
  for(const type of ['keyDown','keyUp'])await browser.cdp.send('Input.dispatchKeyEvent',{type,key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39},await browser.sessionPromise);
  const moved=await pageValue(browser,'new Promise(resolve=>{const start=performance.now();function check(){const left=document.querySelector(".diagram-preview").scrollLeft;if(left>0||performance.now()-start>2000)resolve(left);else requestAnimationFrame(check);}check();})');
  assert.ok(moved>before,'ArrowRight moves the focused preview');
  const exported=await pageValue(browser,`(async()=>{
    const preview=document.querySelector('.diagram-preview');
    preview.scrollLeft=preview.scrollWidth;const left=preview.scrollLeft;
    const originalHeight=Math.ceil(document.querySelector('.shell').getBoundingClientRect().height+48)*2;
    const create=URL.createObjectURL,click=HTMLAnchorElement.prototype.click;
    let finish;const blobReady=new Promise(resolve=>{finish=resolve;});
    URL.createObjectURL=function(blob){finish(blob);return create.call(this,blob);};
    HTMLAnchorElement.prototype.click=function(){if(!this.download)return click.call(this);};
    let timeout;
    try{
      document.querySelector('[data-export-image="png"]').click();
      const blob=await Promise.race([blobReady,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Export did not produce an image')),5000);})]);
      const data=new DataView(await blob.arrayBuffer());
      return {type:blob.type,width:data.getUint32(16),height:data.getUint32(20),originalHeight,left,afterLeft:preview.scrollLeft,roots:document.querySelectorAll('html').length};
    }finally{clearTimeout(timeout);URL.createObjectURL=create;HTMLAnchorElement.prototype.click=click;}
  })()`);
  assert.equal(exported.type,'image/png');assert.equal(exported.width,780);
  assert.ok(exported.height<exported.originalHeight,'Export measures the shorter complete overview instead of retaining the enlarged scroll height');
  assert.equal(exported.left,exported.afterLeft);assert.equal(exported.roots,1);

  assert.equal(await pageValue(browser,'document.querySelector(".panel.diagram-panel").getBoundingClientRect().right<=innerWidth'),true);
  await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false},await browser.sessionPromise);
  await pageValue(browser,'new Promise(resolve=>{const start=performance.now();function check(){const e=document.querySelector(".diagram-preview");if((e.dataset.diagramFit==="fit"&&e.scrollWidth<=e.clientWidth+1)||performance.now()-start>2000)resolve();else requestAnimationFrame(check);}check();})');
  [preview]=await inspectNativePreviewLayout(browser);assert.equal(preview.fit,'fit');assert.ok(preview.scrollWidth<=preview.clientWidth+1);assert.equal(parseFloat(preview.minWidth),0);
  assert.equal(await pageValue(browser,'document.querySelector(".diagram-preview").hasAttribute("tabindex")'),false);
  await browser.cdp.send('Emulation.setDeviceMetricsOverride',{width:390,height:900,deviceScaleFactor:1,mobile:false},await browser.sessionPromise);
  await pageValue(browser,'new Promise(resolve=>{const start=performance.now();function check(){const e=document.querySelector(".diagram-preview");if(e.scrollWidth>e.clientWidth||performance.now()-start>2000)resolve();else requestAnimationFrame(check);}check();})');
  [preview]=await inspectNativePreviewLayout(browser);assert.ok(preview.minimum>=9.95);assert.ok(preview.scrollWidth>preview.clientWidth);
  await browser.cdp.send('Emulation.setEmulatedMedia',{media:'print'},await browser.sessionPromise);
  const printed=await pageValue(browser,'(()=>{const p=document.querySelector(".diagram-preview"),s=p.querySelector("svg");return {svg:s.getBoundingClientRect().width,box:p.clientWidth};})()');
  assert.ok(printed.svg<=printed.box+1,'Print contains the complete diagram instead of clipping the mobile scroll surface');
 }finally{await browser.close();}
});

// Mark the ends of actual content in the bitmap. Geometry alone missed a clipped
// footer during the expanded-export experiment; these colors must survive rasterization.
async function exportContentPixels(browser){
 return pageValue(browser,`(async()=>{
  const style=document.createElement('style');style.textContent=
   '.table-scroll tbody tr:first-child>th::before{content:"";display:inline-block;width:8px;height:8px;background:rgb(3,211,229)}'+
   '.table-scroll tbody tr:last-child>td:last-child::after{content:"";display:inline-block;width:8px;height:8px;float:right;background:rgb(250,13,191)}'+
   '.snippet .export-test-code-end{background:rgb(227,101,7)}'+
   '.export-test-removed-end{background:rgb(3,211,229)}.export-test-added-end{background:rgb(250,13,191)}'+
   'footer::after{content:"";display:block;width:8px;height:8px;background:rgb(19,239,73)}';document.head.append(style);
  const markedContent=[];
  for(const [selector,className] of [['.snippet pre code','export-test-code-end'],['.diff-line.removed code','export-test-removed-end'],['.diff-line.added code','export-test-added-end']]){
   const code=document.querySelector(selector);if(!code)continue;markedContent.push([code,[...code.childNodes]]);
   const text=code.textContent,end=document.createElement('span');end.className=className;end.textContent=text.slice(-16);code.replaceChildren(document.createTextNode(text.slice(0,-16)),end);
  }
  const scrolls=[...document.querySelectorAll('.table-scroll,.diff-scroll,pre')];scrolls.forEach(e=>e.scrollLeft=e.scrollWidth);
  const state=()=>({width:innerWidth,roots:document.querySelectorAll('html').length,frames:document.querySelectorAll('iframe').length,scrolls:scrolls.map(e=>({left:e.scrollLeft,width:e.clientWidth,scrollWidth:e.scrollWidth,text:e.textContent}))});
  const before=state(),blob=await window.ArchifyExplainer.pageImage(),bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');
  try{
   canvas.width=bitmap.width;canvas.height=bitmap.height;const context=canvas.getContext('2d');context.drawImage(bitmap,0,0);
   const pixels=context.getImageData(0,0,canvas.width,canvas.height).data,marks={first:0,last:0,code:0,footer:0};
   for(let i=0;i<pixels.length;i+=4){const r=pixels[i],g=pixels[i+1],b=pixels[i+2];if(r===3&&g===211&&b===229)marks.first++;if(r===250&&g===13&&b===191)marks.last++;if(r===227&&g===101&&b===7)marks.code++;if(r===19&&g===239&&b===73)marks.footer++;}
   return {type:blob.type,width:bitmap.width,height:bitmap.height,marks,before,after:state()};
  }finally{bitmap.close();style.remove();for(const [code,children] of markedContent)code.replaceChildren(...children);}
 })()`);
}
function tableExportDocument(columns){
 const doc=formalDocument();doc.meta.id='complete-table-export';doc.sources=[];
 doc.answer={summary:'Every result belongs in the exported image.',scope:'Synthetic export fixture'};
 doc.panels=[{id:'results',title:'Complete results',blocks:[{id:'matrix',type:'comparison',labelColumn:'Measure',columns:Array.from({length:columns},(_,i)=>'Batch '+(i+1)),rows:[{id:'delta',label:'Delta',cells:Array.from({length:columns},(_,i)=>({text:i===columns-1?'-995':String(i+20)}))}]}]},
  ...Array.from({length:6},(_,i)=>({id:'after-'+i,title:'Following section '+(i+1),blocks:[{id:'text-'+i,type:'prose',text:'This content and the final footer belong after the full comparison.'}]}))];
 return doc;
}
test('image export retains the final table column and footer across responsive widths',{skip:!chrome},async()=>{
 const {renderExplainer}=await import('../archify/explainer/render.mjs');
 const doc=tableExportDocument(12),file=artifact('complete-table-export',renderExplainer(doc,{sourceText:JSON.stringify(doc)}));
 const browser=new ChromeVisualBrowser(chrome);
 try{
  for(const style of ['clean','editorial']){
   await browser.resetPage();await inspectPublicHtml(browser,{artifactPath:file,width:390,theme:'light',keyboard:false});
   await pageValue(browser,`document.querySelector('[data-style-choice="${style}"]').click()`);
   const result=await exportContentPixels(browser);
   assert.ok(result.before.scrolls[0].scrollWidth>result.before.scrolls[0].width,'The fixture must overflow before export');
   assert.ok(result.marks.first>16,'The first table cell survives a live scroll to the end: '+JSON.stringify({width:result.width,height:result.height,marks:result.marks}));
   assert.ok(result.marks.last>16,'The last column must be present in the actual PNG');
   assert.ok(result.marks.footer>16,'The footer must survive responsive export reflow');
   assert.deepEqual(result.after,result.before,'Export leaves live geometry, scroll positions and document ownership intact');
  }
 }finally{await browser.close();}
});
test('image export excludes floating source evidence and preserves the live reading state',{skip:!chrome},async()=>{
 const {renderExplainer}=await import('../archify/explainer/render.mjs');
 const doc=formalDocument();doc.answer.summary='Read the conclusion and its [source](source:example).';
 doc.panels=Array.from({length:3},(_,i)=>({id:'part-'+i,title:'Part '+(i+1),span:6,blocks:[{id:'code-'+i,type:'snippet',text:'A short complete command.'}]}));
 const source={id:'example',title:'Source evidence',path:'src/example.js',lines:[1,14],url:'https://example.com/source',text:Array.from({length:14},(_,i)=>`Line ${i+1}: `+'long source text '.repeat(30)).join('\n')};
 const file=artifact('export-source-card',renderExplainer(doc,{preparedSources:{sources:{example:source}},sourceText:JSON.stringify(doc)})),browser=new ChromeVisualBrowser(chrome);
 const exportPixels=()=>pageValue(browser,`(async()=>{const blob=await window.ArchifyExplainer.pageImage(),bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');try{canvas.width=bitmap.width;canvas.height=bitmap.height;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);const bytes=ctx.getImageData(0,0,canvas.width,canvas.height).data;let popup=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i]===251&&bytes[i+1]===4&&bytes[i+2]===127)popup++;return {width:bitmap.width,height:bitmap.height,popup};}finally{bitmap.close();}})()`);
 const liveState=()=>pageValue(browser,'(()=>{const c=document.querySelector(".source-card"),pre=c.querySelector("pre");return {hidden:c.hidden,text:c.textContent,top:c.scrollTop,codeLeft:pre.scrollLeft,focus:document.activeElement===document.querySelector(".cite a"),panels:[...document.querySelectorAll(".panel")].map(p=>({id:p.id,box:p.getBoundingClientRect().toJSON()}))};})()');
 try {
  for(const width of [1440,390]) {
   await browser.resetPage();await inspectPublicHtml(browser,{artifactPath:file,width,theme:'light',keyboard:false});
   await pageValue(browser,'(()=>{const s=document.createElement("style");s.textContent=".source-card{background:rgb(251,4,127)!important}";document.head.append(s);})()');
   const closed=await exportPixels();
   await pageValue(browser,'document.querySelector(".cite a").focus()');
   assert.equal(await pageValue(browser,'(()=>{const c=document.querySelector(".source-card"),p=c.querySelector("pre");return !c.hidden&&p.scrollWidth>p.clientWidth;})()'),true,'open evidence contains overflowing code outside the page shell');
   const before=await liveState(),opened=await exportPixels();
   assert.equal(opened.popup,0,'the floating source card must not cover the exported explanation');
   assert.deepEqual(opened,closed,'opening source evidence must not change exported page dimensions or content markers');
   assert.deepEqual(await liveState(),before,'export preserves the open live card, source text, focus and panel geometry');
  }
 }finally{await browser.close();}
});

test('image export wraps long snippets while preserving live code',{skip:!chrome},async()=>{
 const {renderExplainer}=await import('../archify/explainer/render.mjs');
 const doc=formalDocument();doc.meta.id='complete-code-export';doc.sources=[];
 const code='printf "%s\\n" "'+ 'complete-result-'.repeat(40)+'"';
 doc.panels=[{id:'command',title:'Read the complete command',blocks:[{id:'literal',type:'snippet',language:'sh',text:code}]}];
 const file=artifact('complete-code-export',renderExplainer(doc,{sourceText:JSON.stringify(doc)}));
 const browser=new ChromeVisualBrowser(chrome);
 try{
  for(const width of [390,1440]){
  await browser.resetPage();await inspectPublicHtml(browser,{artifactPath:file,width,theme:'dark',keyboard:false});
  const result=await exportContentPixels(browser);
  assert.equal(result.width,width*2,'Code wrapping retains the requested viewport width');
  assert.ok(result.before.scrolls[0].scrollWidth>result.before.scrolls[0].width);
  assert.ok(result.marks.code>16,'The final code characters are present in the PNG');
  assert.ok(result.marks.footer>16,'Wrapping height includes the footer');
  assert.equal(result.after.scrolls[0].text,code);
  assert.deepEqual(result.after,result.before);
  }
 }finally{await browser.close();}
});
test('image export bounds wide bitmaps and retains the final cells',{skip:!chrome},async()=>{
 const {renderExplainer}=await import('../archify/explainer/render.mjs');
 const doc=tableExportDocument(160),file=artifact('bounded-table-export',renderExplainer(doc,{sourceText:JSON.stringify(doc)}));
 const browser=new ChromeVisualBrowser(chrome);
 try{
  await inspectPublicHtml(browser,{artifactPath:file,width:390,theme:'light',keyboard:false});
  const result=await exportContentPixels(browser);
  assert.ok(result.before.scrolls[0].scrollWidth>16000,'The fixture exercises the width limit');
  assert.ok(result.width<=16000&&result.height<=16000,'Both bitmap dimensions stay within the existing export limit');
  assert.ok(result.marks.first>4&&result.marks.last>4,'Both ends survive the bounded bitmap: '+JSON.stringify({width:result.width,height:result.height,marks:result.marks}));
  assert.ok(result.marks.footer>4);
  assert.deepEqual(result.after,result.before);
 }finally{await browser.close();}
});

test('image export retains long diff rows and original line numbers',{skip:!chrome},async()=>{
 const {renderExplainer}=await import('../archify/explainer/render.mjs');
 const doc=formalDocument();doc.meta.id='complete-diff-export';doc.sources=[];
 const diff=['@@ -1,3 +1,3 @@',' function message() {','-  const message = "'+'alpha  beta  '.repeat(40)+'OLD-END";','+  const message = "'+'甲方  乙方  '.repeat(40)+'NEW-END";',' }'].join('\n');
 doc.panels=[{id:'change',title:'Read both complete strings',blocks:[{id:'literal-diff',type:'diff',caption:'Synthetic long-line change',text:diff}]},{id:'after',title:'After the change',blocks:[{id:'following',type:'prose',text:'This paragraph follows the complete diff.'}]}];
 const file=artifact('complete-diff-export',renderExplainer(doc,{sourceText:JSON.stringify(doc)})),browser=new ChromeVisualBrowser(chrome);
 try{
  for(const width of [390,1440]){
   await browser.resetPage();await inspectPublicHtml(browser,{artifactPath:file,width,theme:'dark',keyboard:false});
   const result=await exportContentPixels(browser);
   assert.ok(result.before.scrolls[0].scrollWidth>result.before.scrolls[0].width,'The live diff must overflow');
   assert.ok(result.marks.first>16&&result.marks.last>16,'Both removed and added line endings remain in the actual image');
   assert.ok(result.marks.footer>16,'The final footer remains visible');
   assert.deepEqual(result.after,result.before,'Live text, dimensions, scroll positions and ownership remain unchanged');
   const rows=await pageValue(browser,`[...document.querySelectorAll('.diff-code tbody tr')].map(row=>({old:row.dataset.oldLine||null,new:row.dataset.newLine||null,text:row.querySelector('code').textContent}))`);
   assert.equal(rows.map(row=>row.text).join('\n'),diff,'Repeated spaces, prefixes and literal text are preserved');
   assert.deepEqual(rows.map(row=>[row.old,row.new]),[[null,null],['1','1'],['2',null],[null,'2'],['3','3']]);
  }
 }finally{await browser.close();}
});
