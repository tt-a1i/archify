import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { analyzeRepository } from '../archify/modules/code-analysis/overlay/page.mjs';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
const chrome=process.env.ARCHIFY_CHROME?findChrome():null;

test('native PR view keeps comparison chart visible and shares localized source/task interactions',{skip:chrome?false:'Set ARCHIFY_CHROME for PR browser acceptance.'},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-pr-browser-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const roots={base:path.join(dir,'before'),head:path.join(dir,'after')};
  for(const root of Object.values(roots))fs.mkdirSync(root);
  fs.writeFileSync(path.join(roots.base,'main.mjs'),'export function run(x){return 1;}\n');
  fs.writeFileSync(path.join(roots.head,'main.mjs'),'export function run(x){'+'if(x)return 2;'.repeat(25)+'return 0;}\n');
  fs.writeFileSync(path.join(roots.base,'removed.mjs'),'export const removed = 1;\n');
  for(const root of Object.values(roots))fs.writeFileSync(path.join(root,'old.mjs'),'export function oldHotspot(x){'+'if(x)return 1;'.repeat(35)+'return 0;}\n');
  const baseSHA='a'.repeat(40),headSHA='b'.repeat(40);
  const browser=new ChromeVisualBrowser(chrome);t.after(()=>browser.close());
  const session=await browser.sessionPromise,send=(m,p={})=>browser.cdp.send(m,p,session);
  const run=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result?.value;};
  for(const locale of ['en','zh-CN']){
    const out=path.join(dir,locale),source={root:'.',sourceKind:'git-tree',baseRevision:baseSHA,revision:baseSHA};
    analyzeRepository({root:roots.base,out:path.join(out,'base'),locale,source,language:'ts'});
    const result=analyzeRepository({root:roots.head,out,locale,language:'ts',source:{...source,revision:headSHA},previous:path.join(out,'base/findings.json'),
      pullRequest:{pr:{number:null,simulation:true,title:'</script><script>window.prInjected=1</script>',repository:'example/project',mergeBaseSHA:baseSHA,headSHA,baseSHA,capturedAt:'2026-11-14T05:02:16Z'},scope:'.',changedFiles:[{path:'main.mjs',status:'modified'},{path:'removed.mjs',status:'removed'}],manifests:{base:{skipped:[]},head:{skipped:[]}},sourceRoot:roots.head}});
    const loaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:pathToFileURL(result.overlay.html).href});await loaded;
    const assessments=await run(`(()=>{const a=document.querySelector('[data-assessment=architecture]'),c=document.querySelector('[data-assessment=complexity]');return {count:document.querySelectorAll('.pr-assessment').length,architecture:a.querySelector('.pr-origin').textContent,complexity:c.querySelector('.pr-origin').textContent,architecturePriorities:a.querySelectorAll('.priority-card').length,complexityPriorities:c.querySelectorAll('.priority-card').length,ai:!!document.querySelector('.pr-ai-status'),body:c.textContent};})()`);
    assert.equal(assessments.count,2);assert.equal(assessments.architecture,locale==='zh-CN'?'自动检测':'Automatic detection');assert.equal(assessments.complexity,assessments.architecture);
    assert.equal(assessments.architecturePriorities,0);assert.ok(assessments.complexityPriorities>=1);assert.equal(assessments.ai,false);assert.match(assessments.body,/1 → 26/);
    assert.equal(await run("document.querySelector('.pr-review').textContent.includes('oldHotspot')"),false);
    for(const theme of ['light','dark'])for(const [width,height] of [[1440,900],[390,844]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await run(`if(document.documentElement.getAttribute('data-theme')!==${JSON.stringify(theme)})document.getElementById('btn-theme').click();document.fonts.ready.then(()=>new Promise(r=>setTimeout(r,250)))`);
      const state=await run(`(()=>{let chart=document.querySelector('.pr-distribution'),r=chart.getBoundingClientRect(),panel=document.getElementById('bauify-atlas'),s=panel.querySelector('.atlas-side').getBoundingClientRect();return {locale:panel.lang,bands:chart.querySelectorAll('.pr-band').length,visible:getComputedStyle(chart).display!=='none',inView:innerWidth<1000||r.top>=s.top&&r.bottom<=Math.min(s.bottom,innerHeight),overflow:document.documentElement.scrollWidth>innerWidth,injected:window.prInjected};})()`);
      assert.equal(state.locale,locale);assert.equal(state.bands,6);assert.equal(state.visible,true);assert.equal(state.inView,true,JSON.stringify(state));assert.equal(state.overflow,false);assert.equal(state.injected,undefined);
    }
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    await run("document.querySelector('.pr-changes').open=true;const d=JSON.parse(document.getElementById('bauify-analysis').textContent),i=d.pullRequest.changes.findIndex(c=>c.path==='main.mjs'&&c.kind==='function');document.querySelector('[data-pr-change=\"'+i+'\"]').click()");
    assert.equal(await run("document.getElementById('bauify-code').hidden"),false);
    assert.match(await run("document.getElementById('bauify-code').textContent"),/if\(x\)return 2/);
    await run("document.querySelector('[data-pr-side=base]').click()");
    assert.match(await run("document.getElementById('bauify-code').textContent"),/return 1/);
    assert.doesNotMatch(await run("document.getElementById('bauify-code').textContent"),/if\(x\)return 2/);
    await run("document.querySelector('[data-pr-side=head]').click();document.querySelector('#bauify-code .close').click()");
    await run("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.prTask=text}});document.querySelector('.priority-card .quick-copy').click();new Promise(r=>setTimeout(r,100))");
    assert.match(await run('window.prTask'),new RegExp(headSHA));
    assert.doesNotMatch(await run('window.prTask'),/working tree was analyzed/);
    await run("document.querySelector('.brief-copy').click();new Promise(r=>setTimeout(r,100))");
    const copiedImpact=JSON.parse(await run('window.prTask'));assert.equal(copiedImpact.head,headSHA);assert.ok(copiedImpact.impact.records.length>0);assert.doesNotMatch(JSON.stringify(copiedImpact),/oldHotspot/);
  }
  // Imported diagnostics retain their producer; they are neither native checks
  // nor proof that an AI review ran in this page.
  const report=path.join(dir,'eslint.json'),config=path.join(dir,'external.json');
  fs.writeFileSync(report,JSON.stringify([{filePath:'main.mjs',messages:[{ruleId:'example-rule',severity:1,message:'Review this source',line:1,column:1}]}]));
  fs.writeFileSync(config,JSON.stringify({external:{sources:[{id:'external-ui',format:'eslint',file:report}]}}));
  const out=path.join(dir,'en');
  const imported=analyzeRepository({root:roots.head,out,locale:'en',language:'ts',config,source:{root:'.',sourceKind:'git-tree',baseRevision:baseSHA,revision:headSHA},previous:path.join(out,'base/findings.json'),pullRequest:{pr:{number:null,simulation:true,title:'External attribution',repository:'example/project',mergeBaseSHA:baseSHA,headSHA,baseSHA},scope:'.',changedFiles:[{path:'main.mjs',status:'modified'}],manifests:{base:{skipped:[]},head:{skipped:[]}},sourceRoot:roots.head}});
  const importedLoaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:pathToFileURL(imported.overlay.html).href});await importedLoaded;
  const attribution=await run(`(()=>{let d=JSON.parse(document.getElementById('bauify-analysis').textContent);return {comparable:d.overview.review.comparison.comparable,origins:[...document.querySelectorAll('[data-assessment] .pr-origin')].map(e=>e.textContent),review:document.querySelector('.pr-review').textContent,external:!!document.querySelector('.external-entry'),ai:!!document.querySelector('.pr-ai-status')};})()`);
  assert.equal(attribution.comparable,false);assert.deepEqual(attribution.origins,['Automatic detection','Automatic detection']);assert.doesNotMatch(attribution.review,/ESLint|Review this source/);assert.equal(attribution.external,true);assert.equal(attribution.ai,false);
});
