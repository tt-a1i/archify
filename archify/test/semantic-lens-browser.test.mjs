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

test('Semantic Lens preserves selection, legend preview and panel contracts', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser Semantic Lens checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-lens-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidence = process.env.ARCHIFY_LENS_EVIDENCE;
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
  // Initialization fixtures alter only inputs immediately before Lens captures DOM/media.
  const original = fs.readFileSync(files.architecture, 'utf8');
  assert.ok(original.includes('    Archify.semanticLens = (function () {'), 'Lens fixture anchor');
  for (const [name, source] of Object.entries({
    absent: `document.querySelector('[data-legend-bridge]').remove();`,
    small: `document.querySelectorAll('[data-legend-kind]').forEach((e,i)=>{if(i>1)e.remove();});`,
    zero: `document.querySelector('[data-legend-kind]').setAttribute('data-legend-kind','missing');`,
    coarse: `window.lensMatchMedia=window.matchMedia;window.matchMedia=q=>q==='(hover: hover) and (pointer: fine)'?{matches:false}:lensMatchMedia(q);`,
  })) {
    files[name] = path.join(scratch, name + '.html');
    fs.writeFileSync(files[name], original.replace('    Archify.semanticLens = (function () {', source + '\n    Archify.semanticLens = (function () {'));
  }
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
    window.lensErrors=[];window.lensEnds=[];addEventListener('animationend',e=>{if(e.target.matches('.semantic-lens-flow'))lensEnds.push({name:e.animationName,trusted:e.isTrusted});},true);addEventListener('error',e=>lensErrors.push(e.message));
    addEventListener('unhandledrejection',e=>lensErrors.push(String(e.reason)));
    try {localStorage.removeItem('archify-motion');} catch (_) {}
    window.lensWait=predicate=>new Promise((resolve,reject)=>{
      const start=performance.now();function sample(){if(predicate())return resolve();
      if(performance.now()-start>12000)return reject(new Error('Lens observation timed out'));requestAnimationFrame(sample);}requestAnimationFrame(sample);
    });
  ` });
  async function load(mode = 'architecture', { theme = 'dark', reduced = false, suffix = '' } = {}) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(files[mode]).href + `?theme=${theme}` + suffix });
    await loaded;
    await checkPointer();
    await run('document.fonts.ready'); await run('Archify.viewerChromeLayout.whenStable()');
  }
  async function point(selector) {
    return run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
  }
  async function move(selector) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...(selector ? await point(selector) : { x: 0, y: 0 }) }); }
  async function click(selector) {
    const p = await point(selector);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
  }
  async function key(key, code, windowsVirtualKeyCode) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, text: key === 'Enter' ? '\r' : key === ' ' ? ' ' : undefined });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  }
  const legend = kind => `[data-legend-kind="${kind}"]`;
  async function snapshot(scenario) {
    const state = await run(`(()=>{
      const svg=document.querySelector('.diagram-container > svg'),p=Archify.semanticLens;
      const ids=a=>[...svg.querySelectorAll('[data-node-id]['+a+']')].map(n=>n.getAttribute('data-node-id'));
      return {active:p.active(),open:p.isOpen(),kinds:p.kinds(),hash:location.hash,
        selected:ids('data-lens-selected'),peers:ids('data-lens-peer'),preview:svg.getAttribute('data-legend-preview-active'),
        previewSelected:ids('data-legend-preview-selected'),previewPeers:ids('data-legend-preview-peer'),
        edges:[...svg.querySelectorAll('[data-edge-from][data-lens-match]')].map(n=>[n.getAttribute('data-edge-from'),n.getAttribute('data-edge-to'),n.getAttribute('data-edge-key')]),
        count:svg.getAttribute('data-lens-flow-count'),density:svg.getAttribute('data-lens-flow-density'),
        overlays:svg.querySelectorAll('[data-semantic-lens-overlay]').length,
        directions:[...svg.querySelectorAll('.semantic-lens-flow')].map(n=>n.getAttribute('data-direction')),
        status:document.getElementById('semantic-lens-status').textContent,
        buttons:[...document.querySelectorAll('#semantic-lens-kinds button')].map(n=>({kind:n.dataset.kind,disabled:n.disabled,pressed:n.getAttribute('aria-pressed'),label:n.getAttribute('aria-label')})),
        owner:Archify.motionGovernor.owner(),errors:lensErrors,external:performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/^https?:/.test(n))};
    })()`);
    assert.deepEqual(state.errors, [], scenario); assert.deepEqual(state.external, [], scenario);
    records.push({ scenario, ...state }); return state;
  }
  async function hash(value) {
    await run(`new Promise(resolve=>{addEventListener('hashchange',()=>resolve(),{once:true});location.hash=${JSON.stringify(value)};})`);
  }

  await t.test('five modes and optional legend initialization preserve counts, roles and embed boundaries', async () => {
    for (const mode of Object.keys(cases)) {
      await load(mode); const state = await snapshot(mode + '-initial');
      assert.equal(state.active, null); assert.equal(state.open, false);
      assert.deepEqual(await run('Object.keys(Archify.semanticLens).sort()'), ['active', 'clear', 'clearPreview', 'close', 'copyLink', 'isOpen', 'kinds', 'open', 'select', 'toggle']);
      assert.deepEqual(state.buttons.map(n => n.kind), state.kinds.map(n => n.id));
      assert.ok(state.kinds.every((k, i, a) => i === 0 || a[i - 1].count >= k.count));
      assert.equal(await run(`(()=>{const svg=document.querySelector('.diagram-container > svg');return Archify.semanticLens.kinds().reduce((n,k)=>n+k.count,0)===new Set([...svg.querySelectorAll('[data-node-id][data-node-kind]')].map(n=>n.dataset.nodeId).filter(Boolean)).size;})()`), true);
    }
    for (const mode of ['absent', 'small', 'zero']) {
      await load(mode);
      const facts = await run(`(()=>{const b=document.querySelector('[data-legend-bridge]'),z=document.querySelector('[data-legend-zero]');return {role:b?.getAttribute('role')||null,buttons:b?.querySelectorAll('[role="button"]').length||0,zero:z?{count:z.dataset.legendCount,role:z.getAttribute('role'),hit:!!z.querySelector('[data-legend-hit]'),badge:!!z.querySelector('[data-legend-count-badge]')}:null};})()`);
      if (mode === 'absent') assert.equal(facts.role, null);
      if (mode === 'small') { assert.equal(facts.role, 'group'); assert.equal(facts.buttons, 2); }
      if (mode === 'zero') assert.deepEqual(facts.zero, { count: '0', role: null, hit: true, badge: true });
      assert.equal(await run(`Archify.semanticLens.select('backend')`), true); await snapshot(mode);
    }
    await load('architecture', { suffix: '&embed=1#lens=backend' });
    assert.equal(await run('Archify.semanticLens.open()'), false);
    assert.equal(await run(`document.querySelectorAll('[data-legend-bridge-runtime]').length`), 0);
    assert.deepEqual((await snapshot('embed-hash')).active, ['backend']);
    assert.equal((await snapshot('embed-flow')).overlays, 0);
  });

  await t.test('trusted buttons, selection transitions, return values and three cleanup operations stay distinct', async () => {
    await load(); await click('#btn-semantic-lens');
    await run(`lensWait(()=>document.activeElement.matches('#semantic-lens-kinds button'))`);
    await click('#semantic-lens-kinds [data-kind="backend"]');
    let s = await snapshot('one-kind'); assert.deepEqual(s.active, ['backend']); assert.equal(s.open, true);
    assert.deepEqual(s.selected, ['api', 'worker']); assert.ok(s.peers.length > 0); assert.ok(s.edges.length > 0);
    await click('#semantic-lens-kinds [data-kind="database"]');
    s = await snapshot('two-kinds'); assert.deepEqual(s.active, ['backend', 'database']);
    assert.ok(s.buttons.filter(n => !s.active.includes(n.kind)).every(n => n.disabled));
    assert.equal(await run('Archify.semanticLens.clearPreview()===undefined'), true);
    s = await snapshot('selection-after-clear-preview'); assert.deepEqual(s.active, ['backend', 'database']); assert.equal(s.open, true); assert.equal(s.hash, '#lens=backend~database');
    assert.equal(await run(`Archify.semanticLens.select('cloud')`), false);
    assert.equal(await run(`Archify.semanticLens.select('unknown')`), false);
    assert.equal(await run(`(()=>{const a=Archify.semanticLens.active();a.push('fake');return Archify.semanticLens.active().length;})()`), 2);
    const close = await run(`(()=>{const p=Archify.semanticLens,h=location.hash,o=document.querySelector('[data-semantic-lens-overlay]');return {value:p.close(),hash:h===location.hash,overlay:o===document.querySelector('[data-semantic-lens-overlay]'),focus:document.activeElement.id};})()`);
    assert.deepEqual(close, { value: false, hash: true, overlay: true, focus: 'btn-semantic-lens' });
    assert.equal((await snapshot('closed-selected')).open, false);
    assert.equal(await run(`Archify.semanticLens.select('database')`), true);
    await run('Archify.view.zoomIn()'); const zoom = await run('Archify.view.state()');
    assert.equal(await run(`Archify.semanticLens.select('backend')`), false);
    assert.deepEqual(await run('Archify.view.state()'), zoom);
    await run(`Archify.semanticLens.select('backend');Archify.semanticLens.open()`);
    await run(`lensWait(()=>document.activeElement.matches('#semantic-lens-kinds button'))`);
    await run('Archify.view.zoomIn()'); const beforeClear = await run('Archify.view.state()');
    assert.equal(await run(`Archify.semanticLens.clear({preserveView:true,updateUrl:false})`), false);
    s = await snapshot('clear-preserve'); assert.equal(s.active, null); assert.equal(s.open, true); assert.equal(s.hash, '#lens=backend');
    assert.deepEqual(await run('Archify.view.state()'), beforeClear);
    await run(`Archify.semanticLens.clear({closePanel:true})`);
    s = await snapshot('clear-default'); assert.equal(s.open, false); assert.equal(s.hash, ''); assert.equal(s.overlays, 0);
    assert.equal(await run('Archify.view.state().scale'), 1);
    await move(legend('backend')); assert.equal((await snapshot('preview-only')).preview, 'backend');
    assert.equal(await run(`Archify.semanticLens.clear({preserveView:true});document.querySelector('.diagram-container > svg').getAttribute('data-legend-preview-active')`), 'backend');
    assert.equal(await run('Archify.semanticLens.clearPreview()===undefined'), true);
    assert.equal((await snapshot('preview-cleared')).preview, null);
    // Retained hover reference is reused by the original focusout sync path.
    await run(`document.querySelector(${JSON.stringify(legend('database'))}).focus();document.activeElement.blur()`);
    assert.equal((await snapshot('retained-hover')).preview, 'backend');
    assert.equal(await run(`Archify.semanticLens.select('unknown')`), false);
    assert.equal((await snapshot('invalid-clears-preview')).preview, null);
  });

  await t.test('native legend focus, pointer transitions, keyboard activation and opener restoration', async () => {
    await load(); await move(legend('backend'));
    let s = await snapshot('legend-hover'); assert.equal(s.preview, 'backend'); assert.equal(s.active, null); assert.equal(s.overlays, 0); assert.equal(s.hash, '');
    await run(`document.querySelector(${JSON.stringify(legend('database'))}).focus()`);
    await move(legend('cloud')); assert.equal((await snapshot('focus-preferred')).preview, 'database');
    await run('document.activeElement.blur()'); assert.equal((await snapshot('hover-fallback')).preview, 'cloud');
    const internal = await run(`(()=>{const e=document.querySelector(${JSON.stringify(legend('cloud'))});e.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,pointerType:'mouse',relatedTarget:e.querySelector('text')}));return document.querySelector('.diagram-container > svg').getAttribute('data-legend-preview-active');})()`);
    assert.equal(internal, 'cloud');
    await move(); await run(`document.querySelector('[data-legend-kind][role="button"]').focus()`);
    const entries = await run(`Array.from(document.querySelectorAll('[data-legend-kind][role="button"]'),n=>n.dataset.legendKind)`);
    await key('End', 'End', 35); assert.equal(await run('document.activeElement.dataset.legendKind'), entries.at(-1));
    await key('ArrowRight', 'ArrowRight', 39); assert.equal(await run('document.activeElement.dataset.legendKind'), entries[0]);
    await key('ArrowLeft', 'ArrowLeft', 37); assert.equal(await run('document.activeElement.dataset.legendKind'), entries.at(-1));
    await key('Home', 'Home', 36); assert.equal(await run('document.activeElement.dataset.legendKind'), entries[0]);
    assert.equal(await run(`document.querySelectorAll('[data-legend-kind][tabindex="0"]').length`), 1);
    await key('Enter', 'Enter', 13);
    await run(`lensWait(()=>document.activeElement.matches('#semantic-lens-kinds button'))`);
    assert.deepEqual((await snapshot('legend-enter')).active, [entries[0]]);
    await key('Escape', 'Escape', 27); assert.equal(await run('document.activeElement.dataset.legendKind'), entries[0]);
    await key(' ', 'Space', 32); await run(`lensWait(()=>document.activeElement.matches('#semantic-lens-kinds button'))`);
    s = await snapshot('legend-space-toggle'); assert.equal(s.active, null); assert.equal(s.open, true);
    await key('Enter', 'Enter', 13); assert.ok((await snapshot('panel-native-enter')).active);
    // Selection rebuilds buttons and removes the focused target; refocus the new button.
    await run(`document.querySelector('#semantic-lens-kinds [aria-pressed="true"]').focus()`);
    await key(' ', 'Space', 32);
    assert.equal((await snapshot('panel-native-space')).active, null);
    await run(`Archify.semanticLens.clear({closePanel:true,preserveView:true});Archify.semanticLens.select('backend');Archify.semanticLens.select('database');`);
    await click(legend('cloud'));
    s = await snapshot('third-legend-opens'); assert.deepEqual(s.active, ['backend', 'database']); assert.equal(s.open, true);
    await run(`lensWait(()=>document.activeElement.matches('#semantic-lens-kinds button'))`); await key('Escape', 'Escape', 27);
    assert.equal(await run('document.activeElement.dataset.legendKind'), 'cloud');
    for (const mode of ['architecture', 'coarse']) {
      await load(mode);
      await run(`document.querySelector(${JSON.stringify(legend('backend'))}).dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:${JSON.stringify(mode === 'coarse' ? 'mouse' : 'touch')}}))`);
      assert.equal((await snapshot(mode + '-filtered-pointer')).preview, null);
    }
  });

  await t.test('minimal SVG fixtures preserve node indexing, grouped directions, first-member geometry and 24/25 threshold', async () => {
    await load();
    const data = await run(`(()=>{
      const svg=document.querySelector('.diagram-container > svg'),p=Archify.semanticLens;
      svg.innerHTML='<g data-edge-from="a" data-edge-to="b" data-edge-key="ab" transform="translate(3 4)"><path id="source-path" d="M0 0 L10 10" class="author" style="opacity:.7" marker-end="url(#arrow)"/><line x1="1" y1="2" x2="3" y2="4"/></g><path data-edge-from="a" data-edge-to="b" data-edge-key="ab" d="M1 1 L2 2"/><polyline data-edge-from="b" data-edge-to="a" points="1,2 3,4"/><path data-edge-from="b" data-edge-to="a" d="M3 3 L5 5"/><path data-edge-from="a" data-edge-to="a" d="M0 0 C1 2 3 4 0 0"/><g data-node-id="a" data-node-kind="backend"/><g data-node-id="b" data-node-kind="database"/><g data-node-id="a" data-node-kind="ignored"/><g data-node-id="missing-kind"/><g data-node-id="" data-node-kind="ignored"/><g data-node-id="solo" data-node-kind=""/>';
      const before=svg.querySelector('#source-path').outerHTML;p.select('backend');
      const overlay=svg.querySelector('[data-semantic-lens-overlay]'),shapes=[...overlay.querySelectorAll('.semantic-lens-flow')];
      const result={kinds:p.kinds(),single:{count:svg.dataset.lensFlowCount,matched:svg.querySelectorAll('[data-edge-from][data-lens-match]').length,directions:shapes.map(n=>n.dataset.direction),status:document.getElementById('semantic-lens-status').textContent},
        geometry:{transform:overlay.firstElementChild.getAttribute('transform'),d:shapes[0].getAttribute('d'),points:shapes[2].getAttribute('points'),delays:shapes.map(n=>n.style.getPropertyValue('--lens-flow-delay')),stripped:!overlay.querySelector('[id],[marker-end],[data-edge-from]'),normalized:shapes.every(n=>n.getAttribute('pathLength')==='1'),unchanged:before===svg.querySelector('#source-path').outerHTML,beforeNode:overlay.nextElementSibling.hasAttribute('data-node-id')}};
      p.select('database');result.double={count:svg.dataset.lensFlowCount,directions:[...svg.querySelectorAll('.semantic-lens-flow')].map(n=>n.dataset.direction),peers:svg.querySelectorAll('[data-lens-peer]').length,status:document.getElementById('semantic-lens-status').textContent};
      p.clear({preserveView:true});p.select('database');p.select('backend');result.reverse=[...svg.querySelectorAll('.semantic-lens-flow')].map(n=>n.dataset.direction);
      p.clear({preserveView:true});p.select('neutral');p.select('backend');result.zero={count:svg.dataset.lensFlowCount,overlays:svg.querySelectorAll('[data-semantic-lens-overlay]').length};return result;
    })()`);
    assert.deepEqual(data.kinds.map(n => n.id).sort(), ['backend', 'database', 'neutral']);
    assert.ok(data.kinds.every(n => n.count === 1));
    assert.equal(data.single.count, '3'); assert.equal(data.single.matched, 5);
    assert.deepEqual(data.single.directions, ['out', 'out', 'in', 'within']); assert.match(data.single.status, /3 touching relationships/);
    assert.deepEqual(data.geometry, { transform: 'translate(3 4)', d: 'M0 0 L10 10', points: '1,2 3,4', delays: ['0.00s', '0.00s', '0.08s', '0.16s'], stripped: true, normalized: true, unchanged: true, beforeNode: true });
    assert.equal(data.double.count, '2'); assert.equal(data.double.peers, 0);
    assert.deepEqual(data.double.directions, ['forward', 'forward', 'reverse']);
    assert.deepEqual(data.reverse, ['reverse', 'reverse', 'forward']); assert.deepEqual(data.zero, { count: '0', overlays: 0 });
    records.push({ scenario: 'geometry-fixture', ...data });
    for (const count of [24, 25, 24, 0]) {
      await run(`(()=>{const svg=document.querySelector('.diagram-container > svg');Archify.semanticLens.clear({preserveView:true});svg.innerHTML=Array.from({length:${count}},(_,i)=>'<path data-edge-from="a" data-edge-to="b" data-edge-key="e'+i+'" d="M0 0 L10 10"/>').join('')+'<g data-node-id="a" data-node-kind="backend"/><g data-node-id="b" data-node-kind="database"/>';Archify.semanticLens.select('backend');})()`);
      const s = await snapshot('threshold-' + count); assert.equal(s.count, String(count)); assert.equal(s.edges.length, count);
      assert.equal(s.overlays, count > 0 && count <= 24 ? 1 : 0); assert.equal(s.density, count > 24 ? 'quiet' : null);
    }
    await run(`(()=>{const svg=document.querySelector('.diagram-container > svg');Archify.semanticLens.clear({preserveView:true});svg.innerHTML='<g data-edge-from="a" data-edge-to="b"><text>No shape</text></g><g data-node-id="a" data-node-kind="backend"/><g data-node-id="b" data-node-kind="database"/>';Archify.semanticLens.select('backend');})()`);
    const s = await snapshot('no-shape'); assert.equal(s.count, '1'); assert.equal(s.overlays, 0);
  });

  await t.test('initial URL, hashchange and controlled clipboard boundaries retain normalization and feedback', async () => {
    await load('architecture', { suffix: '&keep=yes#lens=database~database~unknown~backend~cloud' });
    let s = await snapshot('initial-hash'); assert.deepEqual(s.active, ['database', 'backend']); assert.equal(s.open, false);
    assert.equal(s.hash, '#lens=database~database~unknown~backend~cloud');
    await hash('#lens=unknown'); assert.deepEqual((await snapshot('invalid-hash')).active, ['database', 'backend']);
    await hash('#lens='); assert.equal((await snapshot('empty-hash')).active, null);
    await hash('#lens=backend'); await hash('#unrelated=1'); assert.equal((await snapshot('missing-hash')).active, null);
    assert.equal(await run('Archify.semanticLens.copyLink()'), false);
    await run(`Archify.semanticLens.select('backend',{updateUrl:false})`);
    assert.equal(await run('location.hash'), '#unrelated=1');
    await run(`Archify.semanticLens.select('database')`); assert.equal(await run('location.search'), '?theme=dark&keep=yes');
    // Never touch the host clipboard: replace both the preferred API and fallback.
    for (const mode of ['success', 'reject', 'absent', 'failure', 'throw']) {
      const copied = await run(`(async()=>{
        const descriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard'),exec=document.execCommand;let captured,commands=0;
        const expected=location.href.replace(/#.*$/,'')+'#lens=backend~database';
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:${mode === 'success' ? "{writeText:v=>{captured=v;return Promise.resolve();}}" : mode === 'reject' ? "{writeText:()=>Promise.reject(new Error('fixture'))}" : 'undefined'}});
        document.execCommand=command=>{commands++;captured=document.activeElement.value;if(${JSON.stringify(mode)}==='throw')throw new Error('fixture');return ${JSON.stringify(mode)}!=='failure';};
        try {const value=await Archify.semanticLens.copyLink();return {value,commands,correct:captured===expected,fields:document.querySelectorAll('textarea[readonly]').length,text:document.getElementById('semantic-lens-copy').textContent};}
        finally {document.execCommand=exec;if(descriptor)Object.defineProperty(navigator,'clipboard',descriptor);else delete navigator.clipboard;}
      })()`);
      assert.equal(copied.value, !['failure', 'throw'].includes(mode)); assert.equal(copied.commands, mode === 'success' ? 0 : 1);
      assert.equal(copied.correct, true); assert.equal(copied.fields, 0);
      assert.match(copied.text, copied.value ? /Copied/ : /Copy failed/i);
      await run(`lensWait(()=>document.getElementById('semantic-lens-copy').textContent==='Copy link')`);
      records.push({ scenario: 'copy-' + mode, ...copied });
    }
    await snapshot('copy-feedback-restored');
  });

  await t.test('actual capability handoffs and blocked previews preserve existing ownership', async () => {
    for (const [name, action] of [
      ['focus', `Archify.focus.set('api',{toggle:false})`],
      ['route', `Archify.routeProbe.begin({source:'users'})`],
      ['guided', `Archify.guidedViews.activate('request-path');await lensWait(()=>!Archify.guidedViews.handoff())`],
      ['intent', `Archify.intentTrace.show('api',{announce:true})`],
    ]) {
      await load('trace'); await run(`(async()=>{${action}})()`); await run(`Archify.semanticLens.select('backend')`);
      const result = await run(`({focus:Archify.focus.active(),route:Archify.routeProbe.active(),intent:Archify.intentTrace.active(),guided:Archify.guidedViews.active()})`);
      assert.deepEqual(result, { focus: null, route: null, intent: null, guided: null });
      await run(`lensWait(()=>Archify.motionGovernor.owner()==='lens')`); await snapshot(name + '-to-lens');
    }
    await run('Archify.semanticLens.open();Archify.finder.open()');
    assert.equal(await run('Archify.semanticLens.isOpen()'), false); assert.equal(await run('Archify.finder.isOpen()'), true);
    await run('Archify.semanticLens.open();Archify.guide.open()');
    assert.equal(await run('Archify.semanticLens.isOpen()'), false); await snapshot('lens-to-guide');
    await load();
    const blockers = await run(`(()=>{
      const svg=document.querySelector('.diagram-container > svg'),html=document.documentElement,e=document.querySelector(${JSON.stringify(legend('backend'))});
      return [[html,'data-present'],[svg,'data-focus-active'],[svg,'data-intent-trace-active'],[svg,'data-route-picking'],[svg,'data-route-active'],[svg,'data-story-active'],[svg,'data-relationship-preview-active']].map(([el,a])=>{
        el.setAttribute(a,'true');e.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}));const preview=svg.getAttribute('data-legend-preview-active');e.dispatchEvent(new PointerEvent('pointerout',{bubbles:true,pointerType:'mouse'}));el.removeAttribute(a);return {attribute:a,preview};});
    })()`);
    assert.ok(blockers.every(row => row.preview === null)); records.push({ scenario: 'blocker-fixture', blockers });
  });

  await t.test('panel events, pending frames and controlled docking geometry preserve responsive branches', async () => {
    await load(); await key('l', 'KeyL', 76);
    await run(`lensWait(()=>document.activeElement.matches('#semantic-lens-kinds button'))`);
    await click('#semantic-lens-kinds [data-kind="backend"]'); assert.equal(await run('Archify.semanticLens.isOpen()'), true);
    await click('h1'); assert.equal(await run('Archify.semanticLens.isOpen()'), false);
    await click('#btn-semantic-lens'); await click('#btn-semantic-lens'); assert.equal(await run('Archify.semanticLens.isOpen()'), false);
    const quick = await run(`new Promise(resolve=>{const p=Archify.semanticLens;const values=[p.open(),p.open(),p.close({restoreFocus:false})];requestAnimationFrame(()=>resolve({values,open:p.isOpen(),dock:document.getElementById('semantic-lens').getAttribute('data-dock-side')}));})`);
    assert.deepEqual(quick, { values: [true, true, false], open: false, dock: null });
    // Only measured rectangle inputs are overridden; public open/select/resize drive docking.
    const docking = await run(`(async()=>{
      const panel=document.getElementById('semantic-lens'),svg=document.querySelector('.diagram-container > svg'),container=svg.parentElement,nav=container.querySelector('.diagram-nav'),legend=svg.querySelector('[data-legend]'),node=svg.querySelector('[data-node-id="api"]');
      const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
      const elements=[panel,container,nav,legend,node].filter(Boolean),saved=elements.map(e=>Object.getOwnPropertyDescriptor(e,'getBoundingClientRect'));
      let position=700;panel.getBoundingClientRect=()=>rect(700,100,200,200);container.getBoundingClientRect=()=>rect(0,0,1000,800);
      [nav,legend].filter(Boolean).forEach(e=>e.getBoundingClientRect=()=>rect(0,600,100,20));node.getBoundingClientRect=()=>rect(position,100,200,200);
      try {Archify.semanticLens.open();await new Promise(requestAnimationFrame);const sides=[];for(const x of [700,16,400]){position=x;dispatchEvent(new Event('resize'));sides.push(panel.getAttribute('data-dock-side'));}return sides;}
      finally {elements.forEach((e,i)=>{if(saved[i])Object.defineProperty(e,'getBoundingClientRect',saved[i]);else delete e.getBoundingClientRect;});}
    })()`);
    assert.deepEqual(docking, ['left', 'right', 'right']); records.push({ scenario: 'docking-fixture', sides: docking });
    for (const width of [720, 721, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await run(`lensWait(()=>innerWidth===${width}).then(()=>Archify.viewerChromeLayout.whenStable())`);
      const dock = await run(`document.getElementById('semantic-lens').getAttribute('data-dock-side')`);
      if (width === 720) assert.equal(dock, null); else assert.ok(['left', 'right'].includes(dock));
      assert.equal(await run(`Array.from(document.querySelectorAll('[data-legend-hit]'),n=>Number(n.getAttribute('width'))).every(w=>w>=24)`), true);
      records.push({ scenario: 'width-' + width, dock });
    }
  });

  await t.test('themes, reduced motion, Still and real SVG export retain selection and preview rendering', async () => {
    for (const theme of ['dark', 'light']) {
      for (const state of ['selection', 'preview']) {
        await load('trace', { theme, reduced: true });
        if (state === 'selection') await run(`Archify.semanticLens.select('backend')`); else await move(legend('backend'));
        await run(`lensWait(()=>Archify.motionGovernor.owner()===${JSON.stringify(state === 'selection' ? 'lens' : 'legend')})`);
        const s = await snapshot(theme + '-' + state); assert.equal(state === 'selection' ? s.active[0] : s.preview, 'backend');
        if (state === 'selection') {
          const style = await run(`(()=>{const n=document.querySelector('.semantic-lens-flow'),c=getComputedStyle(n);return {animation:c.animationName,pointer:getComputedStyle(n.parentElement.parentElement).pointerEvents};})()`);
          assert.deepEqual(style, { animation: 'none', pointer: 'none' });
        }
        if (evidence) {
          await run(`Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{})))`);
          const shot = await send('Page.captureScreenshot', { format: 'png' });
          fs.writeFileSync(path.join(evidence, theme + '-' + state + '.png'), Buffer.from(shot.data, 'base64'));
        }
        const exported = await run(`(async()=>{
          const original=URL.createObjectURL;let blob;URL.createObjectURL=function(v){if(v.type.startsWith('image/svg+xml'))blob=v;return original.call(URL,v);};
          try {await Archify.exportMenu.run('svg');}finally{URL.createObjectURL=original;}
          const root=new DOMParser().parseFromString(await blob.text(),'image/svg+xml').documentElement;
          return {clean:!root.hasAttribute('data-lens-active')&&!root.hasAttribute('data-legend-preview-active')&&!root.querySelector('[data-semantic-lens-overlay],[data-lens-match],[data-lens-selected],[data-lens-peer],[data-legend-preview-match],[data-legend-bridge-runtime],[data-legend-count]'),viewBox:root.getAttribute('viewBox')===document.querySelector('.diagram-container > svg').getAttribute('viewBox')};
        })()`);
        assert.deepEqual(exported, { clean: true, viewBox: true });
      }
    }
    await load('trace'); await run(`Archify.semanticLens.select('backend')`);
    const animation = await run(`getComputedStyle(document.querySelector('.semantic-lens-flow')).animationName`);
    assert.equal(animation, 'archify-semantic-lens-flow');
    await run(`lensWait(()=>lensEnds.some(e=>e.trusted&&e.name==='archify-semantic-lens-flow'))`);
    assert.deepEqual((await snapshot('animation-finished')).active, ['backend']);
    await run(`Archify.motionGovernor.setMode('still')`);
    await run(`lensWait(()=>getComputedStyle(document.querySelector('.semantic-lens-flow')).animationName==='none')`);
    assert.deepEqual((await snapshot('still-selection')).active, ['backend']);
  });
});
