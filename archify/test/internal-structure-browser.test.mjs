import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findChrome } from '../bin/visual-check.mjs';
import { desktopBrowser } from './helpers/desktop-browser.mjs';
import { hostileStructureText, makeInternalStructureFixture } from './helpers/internal-structure-browser-fixture.mjs';

const chromeConfigured = Object.prototype.hasOwnProperty.call(process.env, 'ARCHIFY_CHROME');
const chrome = chromeConfigured ? findChrome() : null;
if (chromeConfigured && !chrome) {
  throw new Error('ARCHIFY_CHROME must name an executable browser; an invalid explicit path is not a skipped acceptance run.');
}

test('internal structure preserves the graph, history, tree semantics, responsive layout, and canonical references', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for real CLI internal-structure browser acceptance; requires approved GUI execution.',
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-internal-structure-browser-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fixture = makeInternalStructureFixture(directory);
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;

  async function evaluate(expression) {
    const result = await browser.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description || result.exceptionDetails?.text);
    return result.result?.value;
  }
  async function waitFor(expression, message) {
    await evaluate(`new Promise((resolve,reject)=>{const deadline=performance.now()+12000;(function poll(){try{if(${expression})return resolve(true);}catch(_){}if(performance.now()>deadline)return reject(new Error(${JSON.stringify(message)}));requestAnimationFrame(poll);})()})`);
  }
  async function open(mode, locale = 'zh-CN', hash = '') {
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, session);
    const url = `${pathToFileURL(fixture.outputs[locale][mode]).href}${hash || (mode === 'atlas' ? '#diagram=system' : '')}`;
    await browser.cdp.send('Page.navigate', { url }, session);
    const view = mode === 'atlas' ? `document.querySelector('iframe[data-atlas-state="active"]')?.contentWindow` : 'window';
    await waitFor(`(()=>{const w=${view};return w?.Archify?.internalStructure && (!w.ArchifyAddress.context || w.ArchifyAddress.active)})()`, `${mode} did not initialize`);
    return view;
  }
  const inView = (view, expression) => evaluate(`(()=>{const w=${view};return w.eval(${JSON.stringify(expression)});})()`);

  for (const mode of ['architecture', 'atlas']) {
    const view = await open(mode);
    await inView(view, `Promise.resolve().then(()=>Archify.readerLayout.whenStable()).then(()=>Archify.viewerChromeLayout.whenStable()).then(()=>Archify.readerLayout.whenStable())`);
    const before = await inView(view, `(()=>{const r=document.querySelector('.diagram-container').getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}})()`);
    const historyBefore = await evaluate('history.length');
    await inView(view, `Archify.focus.set('users',{toggle:false})`);
    assert.equal(await inView(view, `document.querySelector('#focus-internal-structure').hidden`), true);
    await inView(view, `Archify.focus.set('db',{toggle:false})`);
    assert.deepEqual(await inView(view, `[...document.querySelectorAll('[data-structure-entry]')].map(x=>x.dataset.structureEntry)`), ['state']);
    await inView(view, `Archify.focus.set('controller',{toggle:false})`);
    await inView(view, `Promise.resolve().then(()=>Archify.readerLayout.whenStable()).then(()=>Archify.viewerChromeLayout.whenStable()).then(()=>Archify.readerLayout.whenStable())`);
    const quicklook = await inView(view, `(()=>{const q=document.querySelector('#focus-internal-structure');const r=document.querySelector('.diagram-container').getBoundingClientRect();return {hidden:q.hidden,entries:[...q.querySelectorAll('[data-structure-entry]')].map(x=>({section:x.dataset.structureEntry,text:x.textContent})),rect:{left:r.left,top:r.top,right:r.right,bottom:r.bottom},tabs:[...document.querySelectorAll('[data-atlas-tab]')].map(x=>x.dataset.atlasTab)}})()`);
    assert.equal(quicklook.hidden, false);
    assert.deepEqual(quicklook.entries.map(entry => entry.section), ['code', 'state']);
    assert.deepEqual(quicklook.rect, { left: before.left, top: before.top, right: before.right, bottom: before.bottom });
    if (mode === 'atlas') assert.deepEqual(quicklook.tabs, ['details', 'relationships', 'sources']);

    await inView(view, `(()=>{const entry=document.querySelector('[data-structure-entry="code"]');entry.focus();entry.click()})()`);
    await waitFor(`(()=>{const w=${view};return w?.document.documentElement.dataset.readerSurface==='structure' && w.Archify.internalStructure.section()==='code'})()`, `${mode} structure did not open`);
    await waitFor(`history.length===${historyBefore + 1}`, `${mode} structure did not commit one history entry`);
    const opened = await inView(view, `(()=>({
      surface:document.documentElement.dataset.readerSurface,
      graphHidden:document.querySelector('.diagram-container').hidden,
      rootCount:document.querySelectorAll('#node-internal-structure').length,
      modes:[...document.querySelectorAll('.node-structure-mode[data-structure-section]')].map(x=>x.dataset.structureSection),
      role:document.querySelector('.node-structure-tree')?.getAttribute('role'),
      selected:document.querySelector('[role="treeitem"][aria-selected="true"]')?.dataset.structureItem
    }))()`);
    assert.equal(opened.surface, 'structure');
    assert.equal(opened.graphHidden, true);
    assert.equal(opened.rootCount, 1);
    assert.deepEqual(opened.modes, ['code', 'state']);
    assert.equal(opened.role, 'tree');
    assert.equal(opened.selected, 'src');
    assert.equal(await inView(view, `document.querySelectorAll('[role="treeitem"][tabindex="0"]').length`), 1,
      `${mode} tree must expose one roving Tab stop`);
    const modeKeyboard = await inView(view, `(()=>{const code=document.querySelector('.node-structure-mode[data-structure-section="code"]');code.focus();code.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));return {section:Archify.internalStructure.section(),active:document.activeElement?.dataset.structureSection}})()`);
    assert.deepEqual(modeKeyboard, { section: 'state', active: 'state' });
    const modeKeyboardBack = await inView(view, `(()=>{const state=document.activeElement;state.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));return {section:Archify.internalStructure.section(),active:document.activeElement?.dataset.structureSection}})()`);
    assert.deepEqual(modeKeyboardBack, { section: 'code', active: 'code' });
    const openedHistory = await evaluate('history.length');
    assert.equal(openedHistory, historyBefore + 1);

    const keyboard = await inView(view, `(()=>{const root=document.querySelector('[data-structure-item="src"]');root.focus();root.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));const child=document.activeElement;child.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return {focused:child.dataset.structureItem,selected:document.querySelector('[role="treeitem"][aria-selected="true"]')?.dataset.structureItem}})()`);
    assert.deepEqual(keyboard, { focused: 'runtime-file', selected: 'runtime-file' });
    const afterItem = await inView(view, `(()=>({item:new URLSearchParams(ArchifyAddress.location.hash.slice(1)).get('item'),heading:document.querySelector('#node-structure-item-title').textContent}))()`);
    assert.equal(await evaluate('history.length'), openedHistory);
    assert.equal(afterItem.item, 'runtime-file');
    assert.equal(afterItem.heading, 'runtime.mjs');
    await inView(view, `document.querySelector('.node-structure-mode[data-structure-section="state"]').click()`);
    const afterState = await inView(view, `(()=>({section:new URLSearchParams(ArchifyAddress.location.hash.slice(1)).get('section'),selected:document.querySelector('[role="treeitem"][aria-selected="true"]')?.dataset.structureItem,value:document.querySelector('.node-structure-code')?.textContent}))()`);
    assert.equal(await evaluate('history.length'), openedHistory);
    assert.equal(afterState.section, 'state');
    assert.equal(afterState.selected, 'runtime-state');

    await inView(view, `document.querySelector('.node-structure-mode[data-structure-section="code"]').click()`);
    assert.equal(await inView(view, `document.querySelector('[role="treeitem"][aria-selected="true"]')?.dataset.structureItem`), 'runtime-file');
    const nestedKeyboard = await inView(view, `(()=>{const file=document.querySelector('[data-structure-item="runtime-file"]');file.focus();file.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));const symbol=document.activeElement;symbol.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));return {focused:symbol.dataset.structureItem,selected:document.querySelector('[role="treeitem"][aria-selected="true"]')?.dataset.structureItem}})()`);
    assert.deepEqual(nestedKeyboard, { focused: 'accept', selected: 'accept' });
    const relation = await inView(view, `(()=>({kind:document.querySelector('.node-structure-relation-kind')?.textContent,text:document.querySelector('.node-structure-relation')?.textContent,source:document.querySelector('.node-structure-source')?.textContent}))()`);
    assert.ok(relation.kind);
    assert.match(relation.text, /state|状态|stores value/);
    assert.ok(relation.source);
    await inView(view, `document.querySelector('.node-structure-mode[data-structure-section="state"]').click()`);

    await evaluate('history.back()');
    await waitFor(`(()=>{const w=${view};return w?.Archify?.internalStructure?.surface()==='graph'&&w.document.activeElement?.id==='focus-internal-structure-code'})()`, `${mode} Back did not restore the graph and structure-entry focus`);
    assert.equal(await inView(view, `document.activeElement?.id`), 'focus-internal-structure-code',
      `${mode} Back must restore focus to the structure entry`);
    await evaluate('history.forward()');
    await waitFor(`(()=>{const w=${view};return w?.Archify?.internalStructure?.surface()==='structure'&&w.Archify.internalStructure.section()==='state'})()`, `${mode} Forward did not restore the structure`);
    assert.equal(await inView(view, `document.querySelector('[role="treeitem"][aria-selected="true"]')?.dataset.structureItem`), 'runtime-state');
    assert.equal(await evaluate('history.length'), openedHistory);

    await inView(view, `dispatchEvent(new Event('beforeprint'))`);
    await browser.cdp.send('Emulation.setEmulatedMedia', { media: 'print' }, session);
    const print = await inView(view, `(()=>({graph:getComputedStyle(document.querySelector('.diagram-container')).display,structure:getComputedStyle(document.querySelector('#node-internal-structure')).display}))()`);
    assert.notEqual(print.graph, 'none', `${mode} print must expose the canonical graph`);
    assert.equal(print.structure, 'none', `${mode} print must omit the interactive structure reader`);
    await browser.cdp.send('Emulation.setEmulatedMedia', { media: 'screen' }, session);
    await inView(view, `dispatchEvent(new Event('afterprint'))`);

    for (const viewport of [[1024, 768], [720, 800], [390, 844], [320, 568]]) {
      await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport[0], height: viewport[1], deviceScaleFactor: 1, mobile: viewport[0] <= 390 }, session);
      await inView(view, `Promise.resolve().then(()=>Archify.readerLayout.whenStable()).then(()=>Archify.viewerChromeLayout.whenStable()).then(()=>Archify.readerLayout.whenStable())`);
      const responsive = await inView(view, `(()=>({overflow:document.documentElement.scrollWidth-innerWidth,columns:getComputedStyle(document.querySelector('.node-structure-body')).gridTemplateColumns,minTargets:[...document.querySelectorAll('.node-structure-mode,.node-structure-treeitem,.node-structure-actions button,.node-structure-source')].filter(x=>x.getClientRects().length).every(x=>x.getBoundingClientRect().height>=44)}))()`);
      assert.ok(responsive.overflow <= 1, `${viewport}: ${JSON.stringify(responsive)}`);
      assert.equal(responsive.columns.split(' ').length, viewport[0] >= 1024 ? 2 : 1);
      assert.equal(responsive.minTargets, true, `${viewport}: ${JSON.stringify(responsive)}`);
    }
    if (mode === 'atlas') {
      await evaluate(`document.getElementById('atlas-directory-toggle').click()`);
      assert.equal(await evaluate(`document.getElementById('atlas-directory').hidden`), false);
      await inView(view, `document.querySelector('#node-structure-relations').click()`);
      await waitFor(`(()=>{const w=${view};return w?.Archify?.internalStructure?.surface()==='graph'})()`, 'Atlas relationship return did not restore the graph');
      assert.equal(await evaluate(`document.getElementById('atlas-directory').hidden`), true);
      assert.equal(await inView(view, `document.querySelector('[data-atlas-tab="relationships"]')?.getAttribute('aria-selected')`), 'true');
      assert.equal(await inView(view, `document.activeElement?.id`), 'btn-focus-relations');
    }
  }

  const standalone = await open('architecture', 'en', '#focus=controller&inspect=structure&section=code&item=accept');
  await waitFor(`Archify.internalStructure.surface()==='structure'`, 'standalone cold structure did not open');
  const coldSelected = await inView(standalone, `(()=>{const item=document.querySelector('[data-structure-item="accept"]');return {exists:Boolean(item),selected:item?.getAttribute('aria-selected'),visible:Boolean(item?.getClientRects().length)}})()`);
  assert.deepEqual(coldSelected, { exists: true, selected: 'true', visible: true });
  const selectedSource = await inView(standalone, `document.querySelector('.node-structure-source').getAttribute('data-structure-source-ref')`);
  await inView(standalone, `document.querySelector('.node-structure-source').click()`);
  await waitFor(`Archify.internalStructure.surface()==='graph'`, 'local-only source action did not return to the graph');
  assert.equal(await inView(standalone, `document.querySelector('#focus-evidence')?.hidden`), false);
  assert.equal(await inView(standalone, `document.activeElement?.getAttribute('data-source-id')`), selectedSource);

  await inView(standalone, `Archify.focus.set('controller',{toggle:false})`);
  await inView(standalone, `document.querySelector('[data-structure-entry="code"]').click()`);
  await waitFor(`Archify.internalStructure.surface()==='structure'`, 'controller structure did not reopen');
  await inView(standalone, `document.querySelector('[data-structure-item="runtime-file"]').click()`);
  await inView(standalone, `document.querySelector('[data-structure-item="accept"]').click()`);
  await inView(standalone, `document.querySelector('#node-structure-back').click()`);
  await waitFor(`Archify.internalStructure.surface()==='graph'`, 'controller structure did not close');
  await inView(standalone, `Archify.focus.set('redis',{toggle:false})`);
  await inView(standalone, `document.querySelector('[data-structure-entry="code"]').click()`);
  await waitFor(`Archify.internalStructure.surface()==='structure'`, 'redis structure did not open');
  assert.equal(await inView(standalone, `document.querySelector('[role="treeitem"][aria-selected="true"]')?.dataset.structureItem`), 'src',
    'a new node must not inherit another node selection with the same item ids');

  const atlas = await open('atlas', 'en', '#diagram=payment&focus=redis');
  await inView(atlas, `Archify.focus.set('redis',{toggle:false})`);
  assert.equal(await inView(atlas, `document.querySelector('#atlas-open-internal-structure').hidden`), false);
  await inView(atlas, `document.querySelector('#atlas-open-internal-structure').click()`);
  await waitFor(`location.hash.includes('diagram=system')&&location.hash.includes('focus=redis')&&location.hash.includes('inspect=structure')`, 'canonical structure did not open');
  const canonicalView = `document.querySelector('iframe[data-atlas-state="active"]')?.contentWindow`;
  await waitFor(`(()=>{const w=${canonicalView};return w?.Archify?.internalStructure?.surface()==='structure'})()`, 'canonical structure surface did not become ready');
  assert.equal(await inView(canonicalView, `document.querySelector('#structure-injected')===null && document.body.textContent.includes(${JSON.stringify(hostileStructureText)})`), true);

  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(fs.readFileSync(fixture.outputs.en.atlas));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  await browser.cdp.send('Page.navigate', { url: `http://127.0.0.1:${address.port}/atlas.html#diagram=system&focus=controller` }, session);
  await waitFor(`(()=>{const w=${canonicalView};return w?.Archify?.internalStructure&&w.Archify.focus.active()==='controller'})()`, 'HTTP Atlas did not initialize');
  await inView(canonicalView, `document.querySelector('[data-structure-entry="code"]').click()`);
  await waitFor(`(()=>{const w=${canonicalView};return w?.Archify?.internalStructure?.surface()==='structure'})()`, 'HTTP internal structure did not open');
});
