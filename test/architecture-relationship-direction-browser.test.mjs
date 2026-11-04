import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { buildStory } from '../archify/story/tool.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
test('mixed Architecture relationships preserve direction, identity and static semantics through Viewer and exports', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for real browser verification.',
}, async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-directions-browser-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidence = process.env.ARCHIFY_DIRECTION_EVIDENCE;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  const output = path.join(scratch, 'directions.html');
  execFileSync(process.execPath, [path.join(root, 'archify/bin/archify.mjs'), 'render', 'architecture',
    path.join(root, 'test/fixtures/architecture-directions.json'), output]);
  const browser = new ChromeVisualBrowser(chrome); t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.directionErrors=[];addEventListener('error',e=>directionErrors.push(e.message));
    addEventListener('unhandledrejection',e=>directionErrors.push(String(e.reason)));
    window.downloads=[];const urls=new Map(),create=URL.createObjectURL.bind(URL);
    URL.createObjectURL=blob=>{const url=create(blob);urls.set(url,blob);return url;};
    HTMLAnchorElement.prototype.click=function(){if(this.download)downloads.push({name:this.download,blob:urls.get(this.href)});};
    window.waitFor=predicate=>new Promise((resolve,reject)=>{const start=performance.now();function check(){if(predicate())return resolve();if(performance.now()-start>12000)return reject(Error('Observation timed out'));requestAnimationFrame(check);}check();});
    try{localStorage.clear();}catch(_){}
  ` });
  async function load(theme = 'light', reduced = false) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(output).href + '?theme=' + theme }); await loaded;
    await run('document.fonts.ready'); await run('Archify.viewerChromeLayout.whenStable()');
  }
  async function route(from, to) {
    return run(`Archify.routeProbe.begin({source:${JSON.stringify(from)}});Archify.routeProbe.choose(${JSON.stringify(to)})`);
  }
  async function screenshot(name) {
    if (!evidence) return;
    const captured = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(evidence, name + '.png'), Buffer.from(captured.data, 'base64'));
  }
  await load(); await screenshot('mixed-light');
  const svgState = await run(`(()=>{const svg=document.querySelector('.diagram-container > svg');return {edges:[...svg.querySelectorAll('path[data-edge-id]')].map(e=>({id:e.dataset.edgeId,direction:e.dataset.edgeDirection||'forward',start:!!e.getAttribute('marker-start'),end:!!e.getAttribute('marker-end')})),legend:[...svg.querySelectorAll('[data-legend-semantic-kind^="relation-"]')].map(e=>e.textContent.trim())};})()`);
  assert.deepEqual(svgState.edges, [
    { id: 'shared-id', direction: 'none', start: false, end: false },
    { id: 'status-sync', direction: 'both', start: true, end: true },
    { id: 'publish', direction: 'forward', start: false, end: true },
  ]);
  assert.equal(svgState.legend.length, 3);
  await t.test('reverse paths retain authored endpoints and unique IDs without inventing flow', async () => {
    await run(`Archify.motionGovernor.setMode('live')`);
    assert.equal(await route('erp', 'crm'), true);
    const snapshot = await run('Archify.routeProbe.exportSnapshot()');
    assert.deepEqual(snapshot.nodeIds, ['erp', 'ppm', 'crm']);
    assert.deepEqual(snapshot.edges.map(e => [e.id, e.from, e.to, e.direction]), [
      ['status-sync', 'ppm', 'erp', 'both'], ['shared-id', 'crm', 'ppm', 'none'],
    ]);
    assert.equal(await run(`document.querySelectorAll('.route-probe-flow').length`), 0);
    assert.equal(await run(`document.getElementById('route-probe-path').textContent`), 'ERP↔Project tool—CRM');
    assert.match(await run(`document.getElementById('route-probe-status').textContent`), /structural/);
    await run(`Archify.routeProbe.selectJourneyIndex(1,{pulse:true})`);
    assert.equal(await run(`document.querySelectorAll('[data-route-journey-overlay]').length`), 0);
    const card = await run(`(async()=>{const blob=await Archify.exportMenu.downloadRouteShareCard();return {type:blob?.type,size:blob?.size};})()`);
    assert.equal(card.type, 'image/png'); assert.ok(card.size > 1000);
    await screenshot('reverse-route');
    assert.equal(await route('crm', 'platform'), true);
    assert.deepEqual(await run('Archify.routeProbe.exportSnapshot().nodeIds'), ['crm', 'ppm', 'platform']);
    assert.equal(await route('platform', 'crm'), false);
    assert.equal(await route('erp', 'crm'), true);
    await run(`document.querySelectorAll('[data-edge-id="status-sync"]').forEach(e=>e.setAttribute('data-edge-direction','none'))`);
    assert.equal(await run('Archify.routeProbe.exportSnapshot()'), null, 'changed directions invalidate an existing route');
  });
  await t.test('Reach counts structural relationships once in both directions and preserves exports', async () => {
    await load();
    await run(`Archify.focus.set('erp',{toggle:false});Archify.focus.reach('downstream')`);
    const snapshot = await run('Archify.focus.reachabilitySnapshot()');
    assert.deepEqual([...snapshot.nodeIds].sort(), ['crm', 'erp', 'platform', 'ppm']);
    assert.equal(snapshot.edges.length, 3);
    assert.equal(new Set(snapshot.edges.map(e => e.id)).size, 3);
    assert.equal(snapshot.edges.find(e => e.id === 'shared-id').direction, 'none');
    const card = await run(`(async()=>{const blob=await Archify.exportMenu.downloadReachShareCard();return {type:blob?.type,size:blob?.size};})()`);
    assert.equal(card.type, 'image/png'); assert.ok(card.size > 1000);
    await run(`Archify.focus.clearReach();Archify.focus.reach('upstream')`);
    assert.deepEqual((await run('Archify.focus.reachabilitySnapshot().nodeIds')).sort(), ['crm', 'erp', 'ppm']);
    await run(`document.querySelectorAll('[data-edge-id="status-sync"]').forEach(e=>e.setAttribute('data-edge-direction','none'))`);
    assert.equal(await run('Archify.focus.reachabilitySnapshot()'), null);
  });
  await t.test('previews and semantic lenses leave structural relations static', async () => {
    await load(); await run(`Archify.motionGovernor.setMode('live')`);
    assert.equal(await run(`Archify.focus.inspectRelationshipById('shared-id')`), true);
    assert.match(await run(`document.getElementById('relationship-lens-list').textContent`), /Undirected association|Shared opportunity ID/);
    assert.equal(await run(`document.querySelectorAll('[data-relationship-preview-source],[data-relationship-preview-target]').length`), 0);
    assert.equal(await run(`document.querySelectorAll('[data-relationship-pulse-overlay]').length`), 0);
    await run(`Archify.focus.clear();Archify.intentTrace.show('crm',{announce:true})`);
    assert.equal(await run(`document.querySelectorAll('[data-intent-trace-overlay] path').length`), 0);
    await run(`Archify.intentTrace.clear();Archify.semanticLens.select('frontend');Archify.semanticLens.select('backend')`);
    assert.equal(await run(`document.querySelectorAll('[data-semantic-lens-overlay] path').length`), 0);
    await run(`Archify.semanticLens.clear();Archify.semanticLens.select('backend');Archify.semanticLens.select('cloud')`);
    assert.ok(await run(`document.querySelectorAll('[data-semantic-lens-overlay] path').length > 0`), 'the directed control still animates');
  });
  await t.test('SVG and PNG exports retain the actual legend and arrowheads in both themes', async () => {
    for (const theme of ['light', 'dark']) {
      await load(theme, theme === 'dark');
      await screenshot('mixed-' + theme);
      await run(`Archify.exportMenu.run('svg');waitFor(()=>downloads.length===1)`);
      const svg = await run('downloads[0].blob.text()');
      assert.match(svg, /Undirected association/); assert.match(svg, /Bidirectional relationship/);
      assert.match(svg, /orient="auto-start-reverse"/);
      assert.match(svg, /data-edge-direction="none"/);
      await run(`Archify.exportMenu.run('png')`);
      const png = await run(`(async()=>{const blob=downloads[1].blob,image=await createImageBitmap(blob);const result={type:blob.type,width:image.width,height:image.height};image.close();return result;})()`);
      assert.equal(png.type, 'image/png'); assert.ok(png.width > 0 && png.height > 0);
      if (evidence) {
        fs.writeFileSync(path.join(evidence, 'export-' + theme + '.svg'), svg);
        const data = await run(`new Promise(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.readAsDataURL(downloads[1].blob);})`);
        fs.writeFileSync(path.join(evidence, 'export-' + theme + '.png'), Buffer.from(data, 'base64'));
      }
      assert.deepEqual(await run('directionErrors'), []);
    }
  });
  await t.test('Story renders both new relationships statically without synthesizing an association arrow', async () => {
    const brief = {version:2,title:'System relationships',intro:'Read the systems.',outro:'Return to context.',scenes:[
      {title:'Shared context',points:[
        {anchor:'crm',via:'shared-id',title:'Shared ID',text:'The systems refer to the same opportunity identifier.'},
        {anchor:'erp',via:'status-sync',title:'Status sync',text:'Both systems synchronize status.'},
      ]},
    ]};
    const briefFile=path.join(scratch,'brief.json'),story=path.join(scratch,'story.html');
    fs.writeFileSync(briefFile,JSON.stringify(brief));buildStory(output,briefFile,story,{standalone:true});
    const loaded=browser.cdp.waitFor('Page.loadEventFired',session);
    await send('Page.navigate',{url:pathToFileURL(story).href});await loaded;
    await run(`waitFor(()=>window.storyReady===true)`);
    const actions=await run(`Story.actions.filter(a=>a.edge==='shared-id'||a.edge==='status-sync').map(a=>a.kind)`);
    assert.deepEqual(actions,['relation','relation']);
    await run(`Story.seek(Story.shots[1].start+Story.shots[1].annotations[0].at+1)`);
    const figures=await run(`[...document.querySelectorAll('.note-diagram path[data-figure-edge-id]')].map(p=>({id:p.dataset.figureEdgeId,d:p.getAttribute('d'),start:p.getAttribute('marker-start'),end:p.getAttribute('marker-end')}))`);
    const association=figures.find(p=>p.id==='shared-id'),both=figures.find(p=>p.id==='status-sync');
    assert.ok(association);assert.equal(association.start,null);assert.equal(association.end,null);
    assert.equal((association.d.match(/M/g)||[]).length,1,'the association has no synthesized arrow path');
    assert.ok(both?.start&&both?.end);
    assert.deepEqual(await run('directionErrors'),[]);
    await screenshot('story-structural');
  });
});
