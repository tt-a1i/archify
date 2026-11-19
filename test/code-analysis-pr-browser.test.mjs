import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { analyzeRepository } from '../archify/modules/code-analysis/overlay/page.mjs';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
const chrome=process.env.ARCHIFY_CHROME?findChrome():null;

async function closeBrowser(browser) {
  if (browser.child.exitCode === null && browser.child.signalCode === null) {
    const exit = once(browser.child, 'exit', { signal: AbortSignal.timeout(5_000) }).catch(() => {});
    await browser.cdp.send('Browser.close').catch(() => {});
    await exit;
  }
  await browser.close();
}

test('native PR view keeps comparison chart visible and shares localized source/task interactions',{skip:chrome?false:'Set ARCHIFY_CHROME for PR browser acceptance.'},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-pr-browser-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const roots={base:path.join(dir,'before'),head:path.join(dir,'after')};
  for(const root of Object.values(roots))fs.mkdirSync(root);
  fs.writeFileSync(path.join(roots.base,'main.mjs'),'export function run(x){return 1;}\nexport function gone(){return 1;}\n');
  fs.writeFileSync(path.join(roots.head,'main.mjs'),"import './old.mjs';\nexport function run(x){"+'if(x)return 2;'.repeat(25)+'return 0;}\nexport function fresh(){return 2;}\n');
  fs.writeFileSync(path.join(roots.base,'removed.mjs'),'export const removed = 1;\n');
  for(const root of Object.values(roots)){
    fs.writeFileSync(path.join(root,'old.mjs'),'export function oldHotspot(x){'+'if(x)return 1;'.repeat(35)+'return 0;}\n');
    fs.mkdirSync(path.join(root,'other'));fs.writeFileSync(path.join(root,'other/helper.mjs'),'export const helper=1;\n');
  }
  const baseSHA='a'.repeat(40),headSHA='b'.repeat(40);
  const browser=new ChromeVisualBrowser(chrome);t.after(()=>closeBrowser(browser));
  const session=await browser.sessionPromise,send=(m,p={})=>browser.cdp.send(m,p,session);
  await send('Page.addScriptToEvaluateOnNewDocument',{source:`window.__atlasTexts=[];window.__atlasGlyphs={};const original=CanvasRenderingContext2D.prototype.fillText;CanvasRenderingContext2D.prototype.fillText=function(value,x,y){const text=String(value);window.__atlasTexts.push(text);if(['+','−','◇'].includes(text)){const p=this.getTransform().transformPoint({x,y});window.__atlasGlyphs[text]={x:p.x,y:p.y};}return original.apply(this,arguments);};`});
  const run=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result?.value;};
  const settle=()=>run("new Promise((resolve,reject)=>{const deadline=performance.now()+3000;function check(){if(!document.documentElement.hasAttribute('data-bauify-atlas-animating'))resolve();else if(performance.now()>deadline)reject(Error('Atlas animation did not settle'));else requestAnimationFrame(check);}requestAnimationFrame(check);})");
  for(const locale of ['en','zh-CN']){
    const out=path.join(dir,locale),source={root:'.',sourceKind:'git-tree',baseRevision:baseSHA,revision:baseSHA};
    analyzeRepository({root:roots.base,out:path.join(out,'base'),locale,source,language:'ts'});
    const result=analyzeRepository({root:roots.head,out,locale,language:'ts',source:{...source,revision:headSHA},previous:path.join(out,'base/findings.json'),
      pullRequest:{pr:{number:null,simulation:true,title:'</script><script>window.prInjected=1</script>',repository:'example/project',mergeBaseSHA:baseSHA,headSHA,baseSHA,capturedAt:'2026-11-14T05:02:16Z'},scope:'.',changedFiles:[{path:'main.mjs',status:'modified'},{path:'removed.mjs',status:'removed'}],manifests:{base:{skipped:[]},head:{skipped:[]}},sourceRoot:roots.head}});
    const loaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:pathToFileURL(result.overlay.html).href});await loaded;
    await run("document.fonts.ready.then(()=>new Promise(r=>setTimeout(r,200)))");
    const marks=await run(`(()=>{const d=JSON.parse(document.getElementById('bauify-analysis').textContent),change=d.pullRequest.changes.find(c=>c.path==='main.mjs'&&c.kind==='file');return {module:d.pullRequest.moduleChanges.find(m=>m.id===change.module),texts:window.__atlasTexts,glyphs:Object.keys(window.__atlasGlyphs)};})()`);
    assert.deepEqual(marks.module.functions,{added:1,removed:1,modified:1});
    assert.ok(marks.texts.includes(locale==='zh-CN'?'+1/−1 函数':'+1/−1 fn'));
    for(const glyph of ['+','−','◇'])assert.ok(marks.glyphs.includes(glyph),'the canvas paints '+glyph);
    // The merged sector zoom and PR markers share the final rendered geometry.
    await settle();
    const owner=await run("(()=>{const a=JSON.parse(document.getElementById('bauify-atlas-data').textContent);return a.files.find(f=>f[0]==='main.mjs')[1];})()");
    await run(`document.querySelector('#bauify-atlas [data-module="${owner}"]').click()`);await settle();
    assert.equal(await run("(()=>{const e=new WheelEvent('wheel',{deltaY:-180,cancelable:true});document.querySelector('#bauify-atlas canvas').dispatchEvent(e);return e.defaultPrevented;})()"),true);
    await settle();
    await run("let p=window.__atlasGlyphs['−'],c=document.querySelector('#bauify-atlas canvas'),r=c.getBoundingClientRect();c.dispatchEvent(new MouseEvent('click',{clientX:r.left+p.x,clientY:r.top+p.y,bubbles:true}))");
    assert.equal(await run("document.getElementById('bauify-code').hidden"),false);
    assert.match(await run("document.getElementById('bauify-code').textContent"),/gone/);
    assert.doesNotMatch(await run("document.getElementById('bauify-code').textContent"),/fresh/);
    await run("document.querySelector('#bauify-code .close').click();document.querySelector('.atlas-expand').click()");await settle();
    assert.equal(await run("document.querySelector('.atlas-expand').getAttribute('aria-pressed')"),'false');
    assert.equal(await run("(()=>{const e=new WheelEvent('wheel',{deltaY:-180,cancelable:true});document.querySelector('#bauify-atlas canvas').dispatchEvent(e);return e.defaultPrevented;})()"),false);
    await run("document.querySelector('.atlas-expand').click();document.querySelector('.atlas-clear').click()");await settle();
    const assessments=await run(`(()=>{const a=document.querySelector('[data-assessment=architecture]'),c=document.querySelector('[data-assessment=complexity]');return {count:document.querySelectorAll('.pr-assessment').length,architecture:a.querySelector('.pr-origin').textContent,complexity:c.querySelector('.pr-origin').textContent,architecturePriorities:a.querySelectorAll('.priority-card').length,complexityPriorities:c.querySelectorAll('.priority-card').length,ai:!!document.querySelector('.pr-ai-status'),body:c.textContent};})()`);
    assert.equal(assessments.count,2);assert.equal(assessments.architecture,locale==='zh-CN'?'自动检测':'Automatic detection');assert.equal(assessments.complexity,assessments.architecture);
    assert.ok(assessments.architecturePriorities>=1);assert.ok(assessments.complexityPriorities>=1);assert.equal(assessments.ai,false);assert.match(assessments.body,/1 → 26/);
    assert.equal(await run("document.querySelector('.pr-review').textContent.includes('oldHotspot')"),false);
    assert.equal(await run("(()=>{const card=document.querySelector('.pr-impact-record');const evidence=card.querySelector('.pr-impact-evidence');return evidence.getBoundingClientRect().width >= card.getBoundingClientRect().width * .9;})()"),true);
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
  const ordinary=analyzeRepository({root:roots.head,out:path.join(dir,'ordinary'),locale:'en',language:'ts'});
  const ordinaryLoaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:pathToFileURL(ordinary.overlay.html).href});await ordinaryLoaded;
  await run("document.fonts.ready.then(()=>new Promise(r=>setTimeout(r,100)))");
  assert.equal(await run("!!JSON.parse(document.getElementById('bauify-analysis').textContent).pullRequest"),false);
  assert.deepEqual(await run('Object.keys(window.__atlasGlyphs)'),[]);
  assert.equal(await run("window.__atlasTexts.some(t=>/^[+−][0-9]/.test(t))"),false);
});

test('Atlas Files opens pinned renamed and removed sources and downloads only the selected PR context', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for PR browser acceptance.',
  timeout: 180_000,
}, async t => {
  const evidence = process.env.ARCHIFY_PR_FILES_EVIDENCE;
  const external = process.env.ARCHIFY_PR_FILES_REAL_REPORT;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-pr-files-'));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(async () => {
    await closeBrowser(browser);
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const baseSHA = 'a'.repeat(40), headSHA = 'b'.repeat(40);
  let report = external;
  if (!report) {
    const base = path.join(dir, 'base'), head = path.join(dir, 'head'), out = path.join(dir, 'report');
    for (const root of [base, head]) fs.mkdirSync(root);
    fs.writeFileSync(path.join(base, 'old.ts'), 'export const priorMarker = 1;\n');
    fs.writeFileSync(path.join(head, 'new.ts'), 'export const nextMarker = 2;\n');
    fs.writeFileSync(path.join(base, 'gone.ts'), 'export const onlyBase = 3;\n');
    fs.writeFileSync(path.join(head, 'private.ts'), 'export const unrelatedMarker = 4;\n');
    const previous = path.join(out, 'base');
    const source = { root: '.', sourceKind: 'git-tree', baseRevision: baseSHA, revision: baseSHA };
    analyzeRepository({ root: base, out: previous, language: 'ts', source });
    const result = analyzeRepository({
      root: head, out, language: 'ts', source: { ...source, revision: headSHA }, previous: path.join(previous, 'findings.json'),
      pullRequest: { pr: { simulation: true, title: 'File review', repository: 'example/project', mergeBaseSHA: baseSHA, headSHA, baseSHA },
        scope: '.', changedFiles: [{ path: 'new.ts', previousPath: 'old.ts', status: 'renamed' },
          { path: 'gone.ts', status: 'removed' }, { path: 'README.md', status: 'modified' }],
        manifests: { base: { skipped: [] }, head: { skipped: [] } }, sourceRoot: head, baseSourceRoot: base },
    });
    report = result.overlay.html;
  }
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const read = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result.value;
  };
  const literal = JSON.stringify;
  const click = async selector => {
    const point = await read('(() => {const b=document.querySelector(' + literal(selector) + ');if(!b)throw Error("Control missing");' +
      'b.scrollIntoView({block:"nearest"});const r=b.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;' +
      'if(!b.contains(document.elementFromPoint(x,y)))throw Error("Control obstructed: "+b.textContent);return {x,y};})()');
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  };
  const image = async name => {
    if (evidence) fs.writeFileSync(path.join(evidence, name + '.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  };
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  await send('Page.navigate', { url: pathToFileURL(report).href });
  await loaded;
  await click('#atlas-tab-files');
  const query = '#bauify-atlas .atlas-file-query';
  assert.equal(await read('document.activeElement.matches(' + literal(query) + ')'), true);
  await send('Input.insertText', { text: external ? 'hydrateFragment.ts' : 'old.ts' });
  assert.equal(await read('document.querySelectorAll("[data-changed-file]").length'), 1);
  await click('[data-changed-file]');
  const expected = external ? await read('JSON.parse(document.getElementById("bauify-analysis").textContent).pullRequest') : { baseSHA, headSHA };
  await image('lens-files-selected');
  await click('[data-atlas-change-source="base"]');
  assert.equal(await read('document.querySelector(".pr-source-pin").textContent'), expected.baseSHA);
  if (!external) assert.match(await read('document.querySelector("#bauify-code h3").textContent'), /old\.ts/u);
  await click('[data-pr-side="head"]');
  assert.equal(await read('document.querySelector(".pr-source-pin").textContent'), expected.headSHA);
  if (!external) assert.match(await read('document.querySelector("#bauify-code pre").textContent'), /nextMarker/u);
  await image('lens-files-pinned-head');
  await click('.source-back');
  assert.equal(await read('document.querySelector("[data-changed-file]").getAttribute("aria-current")'), 'true');
  await click('.atlas-change-download');
  const downloaded = path.join(dir, 'pr-file-review.md');
  for (let i = 0; !fs.existsSync(downloaded) && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 100));
  const markdown = fs.readFileSync(downloaded, 'utf8');
  assert.ok(markdown.includes(expected.baseSHA) && markdown.includes(expected.headSHA));
  if (!external) {
    assert.match(markdown, /old\.ts/u);
    assert.match(markdown, /new\.ts/u);
    assert.doesNotMatch(markdown, /Marker|gone\.ts|README/u);
    for (const [term, enabled] of [['gone', true], ['README', false]]) {
      await read('document.querySelector(' + literal(query) + ').value = ' + literal(term) + '; document.querySelector(' + literal(query) + ').dispatchEvent(new Event("input"))');
      await click('[data-changed-file]');
      assert.equal(await read('document.querySelector("[data-atlas-change-source=base]").disabled'), !enabled);
      assert.equal(await read('document.querySelector("[data-atlas-change-source=head]").disabled'), true);
    }
  }
  if (evidence) fs.copyFileSync(downloaded, path.join(evidence, 'pr-file-review.md'));
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  assert.equal(await read('document.documentElement.scrollWidth > innerWidth'), false);
});
