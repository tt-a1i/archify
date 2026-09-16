import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../bin/visual-check.mjs';
import { desktopBrowser, desktopPointerCheck } from './helpers/desktop-browser.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Intent Trace preserves input handoffs, transient geometry and cleanup', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser Intent Trace checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-intent-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidence = process.env.ARCHIFY_INTENT_EVIDENCE;
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
  const trace = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', cases.architecture), 'utf8'));
  trace.meta.animation = 'trace';
  const traceInput = path.join(scratch, 'trace.json');
  fs.writeFileSync(traceInput, JSON.stringify(trace)); files.trace = path.join(scratch, 'trace.html');
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'), traceInput, files.trace]);

  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const checkPointer = await desktopPointerCheck(browser, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.intentErrors=[]; window.intentEnds=[];
    addEventListener('error',e=>intentErrors.push(e.message));
    addEventListener('unhandledrejection',e=>intentErrors.push(String(e.reason)));
    addEventListener('animationend',e=>{if(e.target.matches('.intent-trace-flow'))intentEnds.push({name:e.animationName,trusted:e.isTrusted});},true);
    try {localStorage.removeItem('archify-motion');} catch (_) {}
    window.intentWait=predicate=>new Promise((resolve,reject)=>{
      const start=performance.now();
      function sample(){if(predicate())return resolve();if(performance.now()-start>12000)return reject(new Error('Intent observation timed out'));requestAnimationFrame(sample);}
      requestAnimationFrame(sample);
    });
    // This synchronous fixture isolates timer ordering; ordinary pointer tests
    // below still use the browser's real timers and CDP input.
    window.intentTimerFixture=body=>{
      const schedule=window.setTimeout,cancel=window.clearTimeout,queue=new Map(),delays=[];let serial=0;
      window.setTimeout=(fn,delay)=>{delays.push(delay);queue.set(++serial,fn);return serial;};
      window.clearTimeout=id=>queue.delete(id);
      const node=id=>document.querySelector('.diagram-container svg [data-node-id="'+id+'"]');
      const over=(id,related=null,pointerType='mouse')=>node(id).dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType,relatedTarget:related}));
      const out=id=>node(id).dispatchEvent(new PointerEvent('pointerout',{bubbles:true,pointerType:'mouse'}));
      try {return body({node,over,out,queue,delays,fire:()=>{const [id,fn]=queue.entries().next().value;queue.delete(id);fn();}});}
      finally {window.setTimeout=schedule;window.clearTimeout=cancel;}
    };
  ` });
  async function media(reduced) {
    await send('Emulation.setEmulatedMedia', { media: '', features: [
      { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
    ] });
  }
  async function load(mode = 'architecture', { theme = 'dark', reduced = false } = {}) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await media(reduced);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(files[mode]).href + `?theme=${theme}` });
    await loaded;
    await checkPointer();
    await run('document.fonts.ready'); await run('Archify.viewerChromeLayout.whenStable()');
  }
  async function point(selector) {
    return run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  }
  async function move(id) {
    const p = id ? await point(`.diagram-container svg [data-node-id="${id}"]`) : { x: 0, y: 0 };
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p });
  }
  async function click(selector) {
    const p = await point(selector);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
  }
  async function key(key, code, windowsVirtualKeyCode) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  }
  async function snapshot(scenario) {
    const state = await run(`(()=>{
      const svg=document.querySelector('.diagram-container > svg');
      return {active:Archify.intentTrace.active(),attribute:svg.getAttribute('data-intent-trace-active'),
        selected:[...svg.querySelectorAll('[data-intent-trace-selected]')].map(n=>n.getAttribute('data-node-id')),
        matched:[...svg.querySelectorAll('[data-node-id][data-intent-trace-match]')].map(n=>n.getAttribute('data-node-id')),
        edges:svg.querySelectorAll('[data-edge-from][data-intent-trace-match]').length,
        overlays:svg.querySelectorAll('[data-intent-trace-overlay]').length,
        directions:[...svg.querySelectorAll('.intent-trace-flow')].map(n=>n.getAttribute('data-direction')),
        status:document.getElementById('intent-trace-status').textContent,
        focus:Archify.focus.active(),route:Archify.routeProbe.active(),owner:Archify.motionGovernor.owner(),
        errors:intentErrors,external:performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/^https?:/.test(n))};
    })()`);
    assert.deepEqual(state.errors, [], scenario); assert.deepEqual(state.external, [], scenario);
    records.push({ scenario, ...state }); return state;
  }
  async function afterTimer() { await run('new Promise(resolve=>setTimeout(resolve,150))'); }

  await t.test('five modes initialize and public return/broadcast contracts remain intact', async () => {
    for (const mode of Object.keys(cases)) {
      await load(mode); const initial = await snapshot(mode + '-initial');
      assert.equal(initial.active, null); assert.equal(initial.overlays, 0); assert.equal(initial.status, '');
      assert.deepEqual(await run('Object.keys(Archify.intentTrace).sort()'), ['active', 'clear', 'show']);
    }
    await load();
    const api = await run(`(()=>{
      const p=Archify.intentTrace;const shown=p.show('api',{announce:true}),text=document.getElementById('intent-trace-status').textContent;
      const overlay=document.querySelector('[data-intent-trace-overlay]');
      const repeated=p.show('api',{announce:true}),same=overlay===document.querySelector('[data-intent-trace-overlay]');
      const missing=p.show('missing'),retained=document.getElementById('intent-trace-status').textContent===text;
      const empty=p.show(''),cleared=p.clear(),twice=p.clear();
      return {shown,repeated,same,missing,retained,empty,cleared:cleared===undefined,twice:twice===undefined,text};
    })()`);
    assert.deepEqual({ ...api, text: '' }, { shown: true, repeated: true, same: true, missing: false, retained: true, empty: false, cleared: true, twice: true, text: '' });
    assert.match(api.text, /API Server/); assert.equal((await snapshot('public-cleared')).status, '');
  });

  await t.test('real pointer delay, fast exit, keyboard focus and Escape share cleanup', async () => {
    await load(); await move('api');
    await run(`intentWait(()=>Archify.intentTrace.active()==='api')`);
    let state = await snapshot('hover-api'); assert.equal(state.status, ''); assert.equal(state.overlays, 1);
    await move(); await afterTimer(); assert.equal((await snapshot('hover-left')).active, null);
    await move('db'); await move(); await afterTimer(); assert.equal((await snapshot('fast-exit')).active, null);
    await move('api'); await move('db');
    await run(`intentWait(()=>Archify.intentTrace.active()==='db')`); await afterTimer();
    assert.equal((await snapshot('hover-replaced')).active, 'db');
    await run(`document.querySelector('.diagram-container svg [data-node-id="api"]').focus()`);
    state = await snapshot('keyboard-api'); assert.equal(state.active, 'api'); assert.match(state.status, /API Server/);
    const internalFocus = await run(`(()=>{
      const overlay=document.querySelector('[data-intent-trace-overlay]'),child=document.querySelector('.diagram-container svg [data-node-id="api"] text');
      child.setAttribute('tabindex','0');child.focus();
      const same=overlay===document.querySelector('[data-intent-trace-overlay]')&&Archify.intentTrace.active()==='api';
      child.blur();child.removeAttribute('tabindex');return same;
    })()`);
    assert.equal(internalFocus, true);
    assert.equal((await snapshot('focusout-falls-back')).active, 'db');
    await move();
    await run(`document.querySelector('.diagram-container svg [data-node-id="api"]').focus()`);
    await key('Escape', 'Escape', 27);
    state = await snapshot('escape'); assert.equal(state.active, null); assert.equal(state.status, '');
    await move('db'); await run(`intentWait(()=>Archify.intentTrace.active()==='db')`);
    // Pointerout sync can reuse the retained keyboard reference after clear.
    await move(); assert.equal((await snapshot('retained-focus')).active, 'api');
    await click('.diagram-nav'); await afterTimer();
    assert.equal((await snapshot('outside-pointerdown')).active, null);
  });

  await t.test('controlled timers preserve repeated-show, retained-input and input-filter semantics', async () => {
    await load();
    const result = await run(`intentTimerFixture(({node,over,out,queue,delays,fire})=>{
      const p=Archify.intentTrace;
      node('api').focus();const text=document.getElementById('intent-trace-status').textContent;
      over('db');p.show('api',{announce:true});const pending=queue.size;fire();const afterHover=p.active();
      out('db');const afterSync=p.active();
      over('db');p.clear({announce:false});const cancelled=queue.size,retained=document.getElementById('intent-trace-status').textContent===text;
      out('db');const reactivated=p.active();
      over('api',node('api').querySelector('text'));const internal=queue.size;
      node('api').blur();p.clear();over('db',null,'touch');const touch=queue.size;
      const mm=window.matchMedia;window.matchMedia=()=>({matches:false});over('db');const coarse=queue.size;
      window.matchMedia=undefined;over('db');const fallback=queue.size;fire();window.matchMedia=mm;
      const fallbackActive=p.active();p.clear();
      return {pending,afterHover,afterSync,cancelled,retained,reactivated,internal,touch,coarse,fallback,fallbackActive,delays};
    })`);
    assert.deepEqual(result, { pending: 1, afterHover: 'db', afterSync: 'api', cancelled: 0, retained: true, reactivated: 'api', internal: 0, touch: 0, coarse: 0, fallback: 1, fallbackActive: 'db', delays: [90, 90, 90] });
    await snapshot('timer-fixture');
    await load(); await move('api'); await run('Archify.intentTrace.clear()'); await afterTimer();
    assert.equal((await snapshot('pending-clear')).active, null);
    await run(`Archify.intentTrace.show('api',{announce:true}); window.dispatchEvent(new Event('blur'))`); await afterTimer();
    const blurred = await snapshot('blur-fixture'); assert.equal(blurred.active, null); assert.match(blurred.status, /API Server/);
  });

  await t.test('a minimal SVG fixture preserves counting, cloned geometry and isolated nodes', async () => {
    await load();
    const result = await run(`(()=>{
      const svg=document.querySelector('.diagram-container > svg');
      svg.innerHTML='<g data-edge-from="a" data-edge-to="b" data-edge-key="ab" transform="translate(3 4)"><path id="original-path" d="M0 0 L10 10" class="original" style="opacity:.7" marker-end="url(#arrow)"/><line x1="1" y1="2" x2="3" y2="4"/></g><path data-edge-from="a" data-edge-to="b" data-edge-key="ab" d="M2 3 L4 5"/><polyline data-edge-from="c" data-edge-to="a" data-edge-label="incoming" points="1,2 3,4"/><path data-edge-from="a" data-edge-to="a" d="M0 0 C1 2 3 4 0 0"/><g data-node-id="a" data-node-label="Alpha"><rect width="10" height="10"/></g><g data-node-id="b"/><g data-node-id="c"/><g data-node-id="solo"/>';
      const original=svg.querySelector('#original-path').outerHTML;Archify.intentTrace.show('a',{announce:true});
      const overlay=svg.querySelector('[data-intent-trace-overlay]'),shapes=[...overlay.querySelectorAll('.intent-trace-flow')];
      const data={directions:shapes.map(n=>n.getAttribute('data-direction')),status:document.getElementById('intent-trace-status').textContent,
        transform:overlay.firstElementChild.getAttribute('transform'),d:shapes[0].getAttribute('d'),points:shapes[3].getAttribute('points'),
        stripped:!overlay.querySelector('[id],[style],[marker-end],[data-edge-from]'),pathLength:shapes.every(n=>n.getAttribute('pathLength')==='1'),
        original:svg.querySelector('#original-path').outerHTML===original,beforeEdges:overlay.nextElementSibling.hasAttribute('data-edge-from')};
      Archify.intentTrace.show('solo',{announce:true});data.solo={active:Archify.intentTrace.active(),overlays:svg.querySelectorAll('[data-intent-trace-overlay]').length,status:document.getElementById('intent-trace-status').textContent};
      return data;
    })()`);
    assert.deepEqual(result.directions, ['out', 'out', 'out', 'in', 'loop']);
    assert.match(result.status, /Alpha/); assert.match(result.status, /1 outgoing/); assert.match(result.status, /1 incoming/);
    assert.match(result.status, /1 self loop/); assert.match(result.status, /3 connections/);
    assert.equal(result.transform, 'translate(3 4)'); assert.equal(result.d, 'M0 0 L10 10'); assert.equal(result.points, '1,2 3,4');
    for (const flag of ['stripped', 'pathLength', 'original', 'beforeEdges']) assert.equal(result[flag], true, flag);
    assert.equal(result.solo.active, 'solo'); assert.equal(result.solo.overlays, 0);
    assert.match(result.solo.status, /0 connections/);
    await snapshot('geometry-fixture');
  });

  await t.test('blockers gate requests while actual Focus, Route and Lens retain handoff behavior', async () => {
    await load();
    const blockers = await run(`(()=>{
      const html=document.documentElement,svg=document.querySelector('.diagram-container > svg'),container=svg.parentElement,p=Archify.intentTrace;
      const cases=[[html,'data-embed','true'],[html,'data-guide-open','true'],[svg,'data-lens-active',''],[svg,'data-story-active',''],[svg,'data-relationship-preview-active','']];
      const results=cases.map(([el,name,value])=>{p.show('api');el.setAttribute(name,value);const before=p.active(),rejected=p.show('api'),after=p.active();el.removeAttribute(name);return {before,rejected,after};});
      container.classList.add('is-panning');results.push({rejected:p.show('api'),after:p.active()});container.classList.remove('is-panning');return results;
    })()`);
    for (const row of blockers) { assert.equal(row.rejected, false); assert.equal(row.after, null); }
    assert.ok(blockers.slice(0, 5).every(row => row.before === 'api'));
    for (const [name, action, release] of [
      ['focus', `Archify.focus.set('api',{toggle:false})`, `Archify.focus.clear({updateUrl:false})`],
      ['route', `Archify.routeProbe.begin({source:'users'})`, `Archify.routeProbe.clear({updateUrl:false})`],
      ['lens', `Archify.semanticLens.select('backend')`, `Archify.semanticLens.clear({updateUrl:false})`],
    ]) {
      await load(); await move('db'); await run(`intentWait(()=>Archify.intentTrace.active()==='db')`);
      await run(action); await snapshot(name + '-handoff');
      assert.equal(await run(`Archify.intentTrace.show('db')`), false);
      assert.equal((await snapshot(name + '-blocked')).overlays, 0);
      await run(release); await move(); await move('db');
      await run(`intentWait(()=>Archify.intentTrace.active()==='db')`);
      assert.equal((await snapshot(name + '-released')).active, 'db');
    }
  });

  await t.test('real CSS completion, Motion ownership, reduced motion and themes preserve previews', async () => {
    await load('trace'); await run(`intentWait(()=>document.documentElement.getAttribute('data-ambient-motion')==='settled')`);
    await move('api'); await run(`intentWait(()=>Archify.motionGovernor.owner()==='intent')`);
    await run(`intentWait(()=>intentEnds.some(e=>e.trusted&&e.name==='archify-intent-trace-flow'))`);
    assert.equal((await snapshot('animation-complete')).active, 'api');
    const direction = await run(`getComputedStyle(document.querySelector('.intent-trace-flow[data-direction="in"]')).animationDirection`);
    assert.equal(direction, 'normal');
    await move(); await run(`intentWait(()=>Archify.motionGovernor.owner()==='')`);
    await snapshot('owner-cleared');
    for (const theme of ['dark', 'light']) {
      await load('trace', { theme, reduced: true });
      const scheduled = await run(`intentTimerFixture(({over,queue,delays,fire})=>{over('api');const before=Archify.intentTrace.active();fire();return {before,after:Archify.intentTrace.active(),delays};})`);
      assert.deepEqual(scheduled, { before: null, after: 'api', delays: [0] });
      await run(`intentWait(()=>Archify.motionGovernor.owner()==='intent')`);
      const style = await run(`(()=>{const c=getComputedStyle(document.querySelector('.intent-trace-flow'));return {animation:c.animationName,pointer:getComputedStyle(document.querySelector('.intent-trace-overlay')).pointerEvents,dash:c.strokeDasharray};})()`);
      assert.equal(style.animation, 'none'); assert.equal(style.pointer, 'none'); assert.equal(style.dash, 'none');
      await snapshot('reduced-' + theme);
      if (evidence) {
        await run(`Promise.all([...document.querySelectorAll('[data-intent-trace-match]')].flatMap(n=>n.getAnimations()).filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{})))`);
        await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(evidence, theme + '.png'), Buffer.from(shot.data, 'base64'));
      }
      const exported = await run(`(async()=>{
        const original=URL.createObjectURL;let blob;
        URL.createObjectURL=function(v){if(v.type.startsWith('image/svg+xml'))blob=v;return original.call(URL,v);};
        try {await Archify.exportMenu.run('svg');}finally{URL.createObjectURL=original;}
        const root=new DOMParser().parseFromString(await blob.text(),'image/svg+xml').documentElement;
        return {clean:!root.hasAttribute('data-intent-trace-active')&&!root.querySelector('[data-intent-trace-overlay],[data-intent-trace-match],[data-intent-trace-selected]'),viewBox:root.getAttribute('viewBox')===document.querySelector('.diagram-container > svg').getAttribute('viewBox')};
      })()`);
      assert.deepEqual(exported, { clean: true, viewBox: true });
      await click('.diagram-container svg [data-node-id="api"]');
      assert.equal(await run('Archify.focus.active()'), 'api');
    }
  });
});
