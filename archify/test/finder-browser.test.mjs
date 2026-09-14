import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import { createViewerClick } from './helpers/viewer-click.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Finder preserves search, keyboard, contextual Route selection and cleanup', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser Finder checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-finder-browser-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidence = process.env.ARCHIFY_FINDER_EVIDENCE;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  const records = [];
  t.after(() => {
    if (evidence) fs.writeFileSync(path.join(evidence, 'observations.json'), JSON.stringify(records, null, 2) + '\n');
  });
  const cases = {
    architecture: 'web-app.architecture.json', workflow: 'agent-tool-call.workflow.json',
    sequence: 'cache-miss-request.sequence.json', dataflow: 'product-analytics.dataflow.json',
    lifecycle: 'agent-run.lifecycle.json',
  };
  const files = {};
  for (const [mode, example] of Object.entries(cases)) {
    files[mode] = path.join(scratch, mode + '.html');
    execFileSync(process.execPath, [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
      path.join(skillRoot, 'examples', example), files[mode]]);
  }
  // A controlled metadata fixture exercises the Finder's input boundary;
  // repository verification and brand rendering have their own tests.
  files.metadata = path.join(scratch, 'metadata.html');
  const metadataSource = fs.readFileSync(files.architecture, 'utf8');
  assert.ok(metadataSource.includes('    Archify.finder = (function () {'), 'Finder fixture anchor');
  fs.writeFileSync(files.metadata, metadataSource.replace(
    '    Archify.finder = (function () {', `
    document.querySelector('[data-node-id="api"]').setAttribute('data-node-brand', 'finder-brand-token');
    var finderOriginalSources = Archify.sourceEvidence.node;
    Archify.sourceEvidence.node = function (id) {
      return id === 'api' ? [{path:'src/finder-proof.js',label:'Finder proof',line:12,endLine:18}] : finderOriginalSources(id);
    };
    Archify.finder = (function () {`));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  // Match the focused-page setup used by the WebM browser harness so that
  // programmatic SVG focus also dispatches native focusin/focusout events.
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  const click = await createViewerClick({ send, run, timeout: 10000 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.finderErrors = [];
    addEventListener('error', e => finderErrors.push(e.message));
    addEventListener('unhandledrejection', e => finderErrors.push(String(e.reason)));
    window.finderWait = (predicate, description = 'Finder observation') => new Promise((resolve, reject) => {
      const start = performance.now();
      function sample() {
        if (predicate()) return resolve();
        if (performance.now()-start > 10000) return reject(new Error(description + ' timed out; open=' + Archify.finder.isOpen() + ', active=' + document.activeElement.id));
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
  ` });
  async function load(mode = 'architecture', { theme = 'dark', width = 1440, height = 900, reduced = false, query = '' } = {}) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { media: '', features: [
      { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
    ] });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(files[mode]).href + `?theme=${theme}${query}` });
    await loaded;
    await run('document.fonts.ready');
    await run('Archify.viewerChromeLayout.whenStable()');
  }
  async function key(key, code, windowsVirtualKeyCode) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  }
  async function opened() {
    await run(`finderWait(() => Archify.finder.isOpen(), 'Finder panel opening')`);
    await run(`finderWait(() => document.activeElement.id === 'node-finder-input', 'Finder input focus')`);
  }
  async function search(text) {
    await run(`document.getElementById('node-finder-input').select()`);
    await send('Input.insertText', { text });
  }
  async function snapshot(scenario) {
    const value = await run(`(() => {
      const panel=document.getElementById('node-finder'), input=document.getElementById('node-finder-input');
      return {open:Archify.finder.isOpen(), context:Archify.finder.context(), count:Archify.finder.count,
        expanded:document.getElementById('btn-node-finder').getAttribute('aria-expanded'),
        panelContext:panel.getAttribute('data-context'), title:document.getElementById('node-finder-title').textContent,
        query:input.value, placeholder:input.placeholder, empty:document.getElementById('node-finder-empty').hidden,
        status:document.getElementById('node-finder-status').textContent,
        results:[...panel.querySelectorAll('.node-finder-result')].map(el=>({id:el.dataset.nodeId,badge:el.querySelector('em').textContent,aria:el.getAttribute('aria-label')})),
        activeId:document.activeElement.id, activeNode:document.activeElement.getAttribute('data-node-id'),
        focus:Archify.focus.active(), route:Archify.routeProbe.active(),
        routeFinder:document.getElementById('route-probe').getAttribute('data-finder-open'),
        errors:finderErrors,
        external:performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/^https?:/.test(n))};
    })()`);
    assert.deepEqual(value.errors, [], scenario); assert.deepEqual(value.external, [], scenario);
    records.push({ scenario, ...value });
    return value;
  }
  const ids = state => state.results.map(item => item.id);

  await t.test('five modes initialize one index and no external resources', async () => {
    for (const mode of Object.keys(cases)) {
      await load(mode);
      const state = await snapshot(mode + '-initial');
      assert.equal(state.open, false); assert.equal(state.count, state.results.length);
      assert.equal(state.count, await run(`document.querySelectorAll('.diagram-container svg [data-node-id]').length`));
      assert.equal(new Set(ids(state)).size, state.count);
      // One full open/close cycle covers the shared controller; retain
      // initialization and index checks for all five renderer inputs.
      if (mode === 'architecture') {
        await click('#btn-node-finder'); await opened();
        assert.equal((await snapshot(mode + '-open')).expanded, 'true');
        await key('Escape', 'Escape', 27);
        assert.equal((await snapshot(mode + '-closed')).activeId, 'btn-node-finder');
      }
    }
  });

  await t.test('search normalizes queries and preserves contextual lists and retained context', async () => {
    await load('metadata'); await click('#btn-node-finder'); await opened();
    for (const query of ['  API SERVER  ', 'finder-brand-token', 'src/finder-proof.js']) {
      await search(query); const state = await snapshot('query-' + query.trim());
      assert.deepEqual(ids(state), ['api']); assert.equal(state.empty, true);
      assert.match(state.status, /1/);
    }
    await search('no-matching-node');
    const empty = await snapshot('query-empty'); assert.deepEqual(ids(empty), []); assert.equal(empty.empty, false);
    await key('Enter', 'Enter', 13); assert.equal(await run('Archify.finder.isOpen()'), true);
    await run(`Archify.finder.open({context:{kind:'fixture',allowedIds:['db','api'],badges:{api:'custom badge'}}})`); await opened();
    const restricted = await snapshot('restricted');
    assert.deepEqual(ids(restricted), ['api', 'db']); assert.equal(restricted.results[0].badge, 'custom badge');
    await run(`Archify.finder.close()`);
    const closed = await snapshot('retained-context');
    assert.equal(closed.context, 'fixture'); assert.deepEqual(closed.results, restricted.results);
    await run(`Archify.finder.open({context:{allowedIds:[]}})`); await opened();
    assert.deepEqual(ids(await snapshot('no-allowed-items')), []);
    assert.equal(await run(`Archify.finder.select('missing')`), false);
    // Filtering is a list contract; the public select method uses all items.
    assert.equal(await run(`Archify.finder.select('api')`), true);
    assert.equal(await run('Archify.focus.active()'), 'api');
    await run('Archify.finder.open()'); await opened();
    const reset = await snapshot('default-restored'); assert.equal(reset.context, 'focus'); assert.equal(reset.results.length, reset.count);
  });

  await t.test('trusted keyboard navigation, selection and Escape preserve focus boundaries', async () => {
    await load();
    await key('/', 'Slash', 191); await opened();
    await key('ArrowDown', 'ArrowDown', 40);
    const first = await snapshot('keyboard-first'); assert.equal(first.activeNode, first.results[0].id);
    await key('ArrowUp', 'ArrowUp', 38);
    assert.equal((await snapshot('keyboard-wrap')).activeNode, first.results.at(-1).id);
    await key('Home', 'Home', 36); assert.equal((await snapshot('keyboard-home')).activeNode, first.results[0].id);
    await key('End', 'End', 35); assert.equal((await snapshot('keyboard-end')).activeNode, first.results.at(-1).id);
    await key('Escape', 'Escape', 27);
    assert.equal((await snapshot('keyboard-escape')).activeId, 'btn-node-finder');
    await run(`Archify.guidedViews.activate('request-path')`);
    await run(`finderWait(() => !Archify.guidedViews.handoff())`);
    await key('/', 'Slash', 191); await opened(); await search('API Server');
    // Slash in an input must not reopen the panel and erase the query.
    await key('/', 'Slash', 191); assert.equal(await run(`document.getElementById('node-finder-input').value`), 'API Server');
    await key('Enter', 'Enter', 13);
    await run(`finderWait(() => !document.querySelector('.diagram-container').hasAttribute('data-camera-transaction'))`);
    const selected = await snapshot('normal-selection');
    assert.equal(selected.open, false); assert.equal(selected.focus, 'api'); assert.equal(selected.activeNode, 'api');
    assert.equal(await run('Archify.guidedViews.active()'), null);
    assert.match(await run('location.hash'), /focus=api/);
    assert.equal(await run(`(() => {const n=document.querySelector('.diagram-container svg [data-node-id="api"]').getBoundingClientRect(),s=Archify.viewerChromeLayout.stageRect();return n.right>s.left&&n.left<s.right&&n.bottom>s.top&&n.top<s.bottom;})()`), true);
  });

  await t.test('real Route controls select source and target; cancellation restores Route focus', async () => {
    await load(); await click('#btn-route-probe'); await click('#route-probe-find'); await opened();
    let state = await snapshot('route-source');
    assert.equal(state.context, 'route-source'); assert.equal(state.routeFinder, 'true');
    assert.ok(ids(state).includes('users')); assert.ok(!ids(state).includes('db'));
    await key('Escape', 'Escape', 27);
    state = await snapshot('route-source-cancel'); assert.equal(state.route, 'source'); assert.equal(state.routeFinder, null); assert.equal(state.activeId, 'route-probe-find');
    await click('#route-probe-find'); await opened(); await search('Users');
    await click('.node-finder-result[data-node-id="users"]');
    state = await snapshot('route-source-selected'); assert.equal(state.route, 'target'); assert.equal(state.open, false); assert.equal(state.routeFinder, null);
    await click('#route-probe-find'); await opened();
    state = await snapshot('route-target'); assert.equal(state.context, 'route-target');
    assert.ok(ids(state).includes('db')); assert.ok(!ids(state).includes('users')); assert.ok(!ids(state).includes('auth'));
    assert.match(state.results.find(item => item.id === 'db').badge, /4/);
    assert.equal(await run(`Archify.finder.select('auth')`), false);
    assert.equal(await run('Archify.finder.isOpen()'), true);
    await key('Escape', 'Escape', 27);
    assert.equal((await snapshot('route-target-cancel')).activeId, 'route-probe-find');
    await click('#route-probe-find'); await opened(); await search('PostgreSQL');
    await key('Enter', 'Enter', 13);
    state = await snapshot('route-result'); assert.equal(state.route, 'result'); assert.equal(state.routeFinder, null); assert.equal(state.open, false);
    const result = await run('Archify.routeProbe.result()');
    assert.deepEqual(result.nodes, ['users', 'cdn', 'lb', 'api', 'db']); assert.equal(result.hops, 4);
    // A sink is allowed by Route's public API even though the source picker
    // filters it out. Its actual target context must render an empty list.
    await run(`Archify.routeProbe.begin({source:'db'})`);
    await click('#route-probe-find'); await opened();
    state = await snapshot('route-empty-target');
    assert.equal(state.context, 'route-target'); assert.deepEqual(ids(state), []); assert.equal(state.empty, false);
    await key('Enter', 'Enter', 13); assert.equal(await run('Archify.routeProbe.active()'), 'target');
    await key('Escape', 'Escape', 27);
    await click('#route-probe-clear'); await key('/', 'Slash', 191); await opened();
    assert.equal((await snapshot('route-cleared-default')).context, 'focus');
  });

  await t.test('panel coordination, outside clicks, repeated close and embed retain baseline semantics', async () => {
    await load();
    await run('Archify.exportMenu.open(); Archify.finder.open()'); await opened();
    assert.equal(await run('Archify.exportMenu.isOpen()'), false);
    await run('Archify.semanticLens.open(); Archify.finder.open()'); await opened();
    assert.equal(await run('Archify.semanticLens.isOpen()'), false);
    await run(`Archify.finder.close(); document.querySelector('[data-legend-kind][role="button"]').focus()`);
    assert.equal(await run(`document.querySelector('.diagram-container > svg').hasAttribute('data-legend-preview-active')`), true);
    await run('Archify.finder.open()'); await opened();
    assert.equal(await run(`document.querySelector('.diagram-container > svg').hasAttribute('data-legend-preview-active')`), false);
    await click('#btn-node-finder'); assert.equal(await run('Archify.finder.isOpen()'), false);
    await click('#btn-node-finder'); await opened();
    await click('h1'); assert.equal(await run('Archify.finder.isOpen()'), false);
    const rapid = await run(`(() => {Archify.finder.open(); const a=Archify.finder.close({restoreFocus:false}); const b=Archify.finder.close({restoreFocus:false}); return {a:a===undefined,b:b===undefined,open:Archify.finder.isOpen()};})()`);
    assert.deepEqual(rapid, { a: true, b: true, open: false });
    await run('new Promise(resolve => requestAnimationFrame(resolve))');
    await snapshot('rapid-close');
    await load('architecture', { query: '&embed=1' });
    assert.equal(await run('Archify.finder.open()'), false); assert.equal((await snapshot('embed')).open, false);
  });

  await t.test('themes, constrained viewport, reduced motion and exported SVG', async () => {
    for (const theme of ['dark', 'light']) {
      await load('architecture', { theme, width: 640, height: 600, reduced: true });
      await click('#btn-node-finder'); await opened();
      const layout = await run(`(() => {const p=document.getElementById('node-finder').getBoundingClientRect(),r=document.getElementById('node-finder-results'); return {visible:p.width>0&&p.height>0,within:p.left>=-1&&p.right<=innerWidth+1&&p.top>=-1&&p.bottom<=innerHeight+1,scroll:getComputedStyle(r).overflowY};})()`);
      assert.equal(layout.visible, true); assert.equal(layout.within, true); assert.match(layout.scroll, /auto|scroll/);
      await snapshot('constrained-' + theme);
      if (evidence) {
        await run(`Promise.all(document.querySelector('.node-finder-search').getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})))`);
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(evidence, theme + '.png'), Buffer.from(shot.data, 'base64'));
      }
      await search('API Server'); await key('Enter', 'Enter', 13);
      await run(`finderWait(() => !document.querySelector('.diagram-container').hasAttribute('data-camera-transaction'))`);
      assert.equal(await run('Archify.focus.active()'), 'api');
      const exported = await run(`(async () => {
        const original=URL.createObjectURL; let blob;
        URL.createObjectURL=function(value){if(value.type.startsWith('image/svg+xml'))blob=value;return original.call(URL,value);};
        try {await Archify.exportMenu.run('svg');} finally {URL.createObjectURL=original;}
        const text=await blob.text(),root=new DOMParser().parseFromString(text,'image/svg+xml').documentElement;
        return {clean:!root.querySelector('[id^="node-finder"],.node-finder-result,[data-focus-selected]')&&!root.hasAttribute('data-focus-active'),geometry:root.getAttribute('viewBox')===document.querySelector('.diagram-container > svg').getAttribute('viewBox')};
      })()`);
      assert.deepEqual(exported, { clean: true, geometry: true });
      await snapshot('export-' + theme);
    }
  });
});
