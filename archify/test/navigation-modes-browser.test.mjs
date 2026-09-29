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
const controls = { route: '#btn-route-probe', map: '#btn-overview-map', lens: '#btn-semantic-lens' };

test('Path, Map and Lens are exclusive navigation tools', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for navigation tool switching.',
}, async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-navigation-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const file = path.join(scratch, 'architecture.html');
  execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'render', 'architecture',
    path.join(root, 'examples/web-app.architecture.json'), file]);
  const browser = desktopBrowser(chrome); t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async expression => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(r.exceptionDetails, undefined, r.exceptionDetails?.exception?.description);
    return r.result?.value;
  };
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.navigationErrors=[];addEventListener('error',e=>navigationErrors.push(e.message));addEventListener('unhandledrejection',e=>navigationErrors.push(String(e.reason)));` });
  async function settle() {
    await run(`Archify.viewerChromeLayout.whenStable().then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`);
  }
  async function load() {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const ready = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(file).href + '?theme=light' }); await ready;
    await run('document.fonts.ready.then(()=>Archify.readerLayout.whenStable())'); await settle();
    await run('Archify.view.panBy(30,-15)'); await settle();
  }
  async function click(selector) {
    const p = await run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1 });
    await settle();
  }
  async function state() {
    return run(`(()=>{const svg=document.querySelector('.diagram-container > svg');return {
      modes:{route:!!Archify.routeProbe.active(),map:Archify.radar.isOpen(),lens:Archify.semanticLens.isOpen()||!!Archify.semanticLens.active()},
      buttons:Object.fromEntries(Object.entries(${JSON.stringify(controls)}).map(([k,s])=>{const b=document.querySelector(s);return [k,b.getAttribute('aria-pressed')==='true'||b.getAttribute('aria-expanded')==='true'];})),
      panels:{route:!document.getElementById('route-probe').hidden,map:!document.getElementById('overview-map').hidden,lens:!document.getElementById('semantic-lens').hidden},
      lens:Archify.semanticLens.active(),route:Archify.routeProbe.active(),hash:location.hash,camera:Archify.view.state(),
      routePaint:svg.querySelectorAll('[data-route-match],[data-route-step]').length,
      lensPaint:svg.querySelectorAll('[data-lens-match]').length,playing:Archify.routeProbe.isJourneyPlaying(),errors:navigationErrors};})()`);
  }
  function exclusive(s, selected) {
    const expected = Object.fromEntries(Object.keys(controls).map(k => [k, k === selected]));
    assert.deepEqual(s.modes, expected); assert.deepEqual(s.buttons, expected); assert.deepEqual(s.panels, expected);
    assert.deepEqual(s.errors, []);
  }
  for (const from of Object.keys(controls)) for (const to of Object.keys(controls)) {
    if (from === to) continue;
    await t.test(`${from} to ${to}: native buttons preserve camera and leave one tool`, async () => {
      await load(); const camera = await run('Archify.view.state()');
      await click(controls[from]); exclusive(await state(), from);
      await click(controls[to]); const s = await state(); exclusive(s, to);
      assert.deepEqual(s.camera, camera);
    });
  }
  for (const to of ['route', 'map']) await t.test(`active Lens to ${to} clears selection and share state`, async () => {
    await load(); await click('.fixed-legend [data-legend-kind="database"]');
    assert.match((await state()).hash, /lens=database/);
    const camera = await run('Archify.view.state()');
    await click(controls[to]); const s = await state(); exclusive(s, to);
    assert.equal(s.lens, null); assert.equal(s.lensPaint, 0); assert.equal(s.hash, ''); assert.deepEqual(s.camera, camera);
  });
  for (const to of ['map', 'lens']) await t.test(`completed Path to ${to} clears route and share state`, async () => {
    await load(); await run(`Archify.routeProbe.begin({source:'users'});Archify.routeProbe.choose('db');`);
    await run(`new Promise(resolve=>{let n=0;function tick(){if(++n>45)return resolve();requestAnimationFrame(tick);}tick();})`);
    assert.match((await state()).hash, /route=/);
    const camera = await run('Archify.view.state()');
    await click(controls[to]); const s = await state(); exclusive(s, to);
    assert.equal(s.route, null); assert.equal(s.routePaint, 0); assert.equal(s.playing, false); assert.equal(s.hash, ''); assert.deepEqual(s.camera, camera);
  });
  await t.test('keyboard shortcuts and rapid API switches use the same ownership rules', async () => {
    await load();
    for (const [selected, key] of [['route','r'],['map','m'],['lens','l'],['map','m'],['route','r'],['lens','l']]) {
      await run('document.activeElement.blur()');
      for (const type of ['keyDown','keyUp']) await send('Input.dispatchKeyEvent', { type, key, code:'Key'+key.toUpperCase(), windowsVirtualKeyCode:key.toUpperCase().charCodeAt(0) });
      await settle(); exclusive(await state(), selected);
    }
    await run('Archify.semanticLens.open();Archify.routeProbe.begin();Archify.radar.open()');
    await settle(); exclusive(await state(), 'map');
    await click('.fixed-legend [data-legend-kind="database"]'); exclusive(await state(), 'lens');
  });
  await t.test('route deep links still survive taking ownership from an active Lens', async () => {
    await load(); await click('.fixed-legend [data-legend-kind="database"]');
    await run(`location.hash='route=users~db'`); await settle();
    const s = await state(); exclusive(s, 'route'); assert.equal(s.route, 'result'); assert.equal(s.hash, '#route=users~db');
  });
  await t.test('direct Lens selection also exits Map without requiring the panel to open', async () => {
    await load(); await click(controls.map);
    await run(`Archify.semanticLens.select('database')`); await settle();
    const s = await state();
    assert.deepEqual(s.modes, { route: false, map: false, lens: true });
    assert.deepEqual(s.buttons, { route: false, map: false, lens: true });
    assert.deepEqual(s.panels, { route: false, map: false, lens: false });
    assert.equal(s.hash, '#lens=database'); assert.deepEqual(s.errors, []);
  });
});
