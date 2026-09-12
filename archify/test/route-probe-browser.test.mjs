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

test('Route Probe preserves directed paths, Journey and export contracts', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser Route Probe checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-route-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidence = process.env.ARCHIFY_ROUTE_EVIDENCE;
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
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  const click = await createViewerClick({ send, run, timeout: 12000 });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.routeErrors=[];window.routeEnds=[];addEventListener('animationend',e=>{if(e.target.matches('.route-journey-flow'))routeEnds.push({name:e.animationName,trusted:e.isTrusted});},true);addEventListener('error',e=>routeErrors.push(e.message));
    addEventListener('unhandledrejection',e=>routeErrors.push(String(e.reason)));
    try {localStorage.removeItem('archify-motion');} catch (_) {}
    window.routeWait=predicate=>new Promise((resolve,reject)=>{
      const start=performance.now();function sample(){if(predicate())return resolve();
      if(performance.now()-start>12000)return reject(new Error('Route observation timed out'));requestAnimationFrame(sample);}requestAnimationFrame(sample);
    });
  ` });
  async function load(mode = 'architecture', { theme = 'dark', reduced = false, suffix = '' } = {}) {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(files[mode]).href + `?theme=${theme}` + suffix });
    await loaded; await run('document.fonts.ready'); await run('Archify.viewerChromeLayout.whenStable()');
  }
  async function key(key, code, windowsVirtualKeyCode) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode, text: key === 'Enter' ? '\r' : key === ' ' ? ' ' : undefined });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  }
  const node = id => `.diagram-container > svg [data-node-id="${id}"]`;
  async function snapshot(scenario) {
    const state = await run(`(()=>{
      const svg=document.querySelector('.diagram-container > svg'),p=Archify.routeProbe,panel=document.getElementById('route-probe');
      return {active:p.active(),result:p.result(),panel:panel.dataset.state,hidden:panel.hidden,hash:location.hash,
        nodes:[...svg.querySelectorAll('[data-node-id][data-route-match]')].map(n=>n.dataset.nodeId),
        candidates:[...svg.querySelectorAll('[data-route-candidate]')].map(n=>n.dataset.nodeId),
        edges:[...svg.querySelectorAll('[data-edge-from][data-route-match]')].map(n=>({key:n.dataset.edgeKey||null,from:n.dataset.edgeFrom,to:n.dataset.edgeTo,step:n.dataset.routeStep})),
        journey:[...svg.querySelectorAll('[data-node-id][data-route-journey-state]')].map(n=>({id:n.dataset.nodeId,state:n.dataset.routeJourneyState})),
        currentEdges:[...svg.querySelectorAll('[data-edge-from][data-route-journey-current]')].map(n=>n.dataset.edgeKey||null),
        overlays:svg.querySelectorAll('[data-route-probe-overlay]').length,pulses:svg.querySelectorAll('[data-route-journey-overlay]').length,
        chips:[...panel.querySelectorAll('[data-route-journey-index]')].map(n=>({id:n.dataset.routeNodeId,tab:n.tabIndex,current:n.getAttribute('aria-current')})),
        controls:[...document.querySelectorAll('#route-journey-controls button')].map(n=>({id:n.id,disabled:n.disabled,pressed:n.getAttribute('aria-pressed')})),
        status:document.getElementById('route-probe-status').textContent,focus:Archify.focus.active(),owner:Archify.motionGovernor.owner(),
        errors:routeErrors,external:performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/^https?:/.test(n))};
    })()`);
    assert.deepEqual(state.errors, [], scenario); assert.deepEqual(state.external, [], scenario);
    records.push({ scenario, ...state }); return state;
  }
  async function route(source = 'users', target = 'db') {
    assert.equal(await run(`Archify.routeProbe.begin({source:${JSON.stringify(source)}});Archify.routeProbe.choose(${JSON.stringify(target)})`), true);
  }
  async function hash(value) {
    await run(`new Promise(resolve=>{addEventListener('hashchange',()=>requestAnimationFrame(resolve),{once:true});location.hash=${JSON.stringify(value)};})`);
  }
  // Synchronous clock fixture isolates callbacks, including cancelled callbacks.
  // Real playback and animation completion are exercised separately below.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.routeClock=body=>{
      const schedule=window.setTimeout,cancel=window.clearTimeout,clock=Date.now;let now=1000,serial=0;const jobs=[];
      window.setTimeout=(fn,delay)=>{const job={id:++serial,fn,delay,cancelled:false};jobs.push(job);return job.id;};
      window.clearTimeout=id=>{const job=jobs.find(j=>j.id===id);if(job)job.cancelled=true;};Date.now=()=>now;
      try{return body({jobs,advance:ms=>now+=ms,last:delay=>jobs.filter(j=>j.delay===delay).at(-1),fire:job=>job.fn()});}
      finally{window.setTimeout=schedule;window.clearTimeout=cancel;Date.now=clock;}
    };
  ` });

  await t.test('five modes initialize and trusted endpoint input preserves capture and error recovery', async () => {
    for (const mode of Object.keys(cases)) {
      await load(mode); const s = await snapshot(mode + '-initial'); assert.equal(s.active, null); assert.equal(s.hidden, true); assert.equal(s.result, null);
      assert.deepEqual(await run('Object.keys(Archify.routeProbe).sort()'), ['active', 'begin', 'choose', 'clear', 'copyLink', 'escape', 'exportSnapshot', 'finderClosed', 'finderContext', 'finderOpening', 'isJourneyPlaying', 'openFinder', 'pauseJourney', 'playJourney', 'result', 'selectJourneyIndex', 'showOverview', 'syncMotion', 'toggle']);
    }
    await load(); await click('#btn-route-probe'); assert.equal((await snapshot('source')).active, 'source');
    await click(node('users')); let s = await snapshot('target'); assert.equal(s.active, 'target'); assert.equal(s.focus, null);
    assert.deepEqual(s.candidates, ['cdn', 'lb', 'api', 'cache', 'db', 's3', 'queue', 'worker']);
    assert.equal(await run(`Archify.routeProbe.choose('unknown')`), false);
    await click(node('users')); s = await snapshot('same-node'); assert.equal(s.active, 'target'); assert.equal(s.panel, 'error');
    await run(`document.querySelector(${JSON.stringify(node('auth'))}).focus()`); await key('Enter', 'Enter', 13);
    s = await snapshot('unreachable'); assert.equal(s.active, 'target'); assert.equal(s.panel, 'error'); assert.equal(s.focus, null);
    await run(`document.querySelector(${JSON.stringify(node('db'))}).focus()`); await key(' ', 'Space', 32);
    s = await snapshot('result'); assert.deepEqual(s.result.nodes, ['users', 'cdn', 'lb', 'api', 'db']); assert.equal(s.result.hops, 4);
    assert.equal(s.result.journey, -1); assert.equal(s.result.playing, false); assert.equal(s.focus, null);
    assert.deepEqual(s.edges.map(e => [e.from, e.to]), [['users', 'cdn'], ['cdn', 'lb'], ['lb', 'api'], ['api', 'db']]);
    assert.equal(await run(`Archify.routeProbe.choose('cache')`), false);
    assert.equal(await run(`(()=>{const r=Archify.routeProbe.result();r.nodes.length=0;return Archify.routeProbe.result().nodes.length;})()`), 5);
    await load(); await run(`Archify.focus.set('api',{toggle:false});Archify.routeProbe.begin()`);
    assert.equal((await snapshot('focus-seeded')).active, 'target');
    await load(); await run(`Archify.focus.setMany(['api','db']);Archify.routeProbe.begin({focusNode:true})`);
    assert.equal((await snapshot('multi-focus-source')).active, 'source');
    assert.equal(await run('document.activeElement.dataset.nodeId'), 'users');
    const filtered = await run(`(()=>{const p=Archify.routeProbe,svg=document.querySelector('.diagram-container > svg'),container=svg.parentElement,n=svg.querySelector('[data-node-id="users"]');
      const event=key=>new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true});const unrelated=event('ArrowRight');n.dispatchEvent(unrelated);container.setAttribute('data-just-panned','true');const panned=event('Enter');let capture;svg.addEventListener('keydown',()=>{capture={mode:p.active(),prevented:panned.defaultPrevented};},{capture:true,once:true});n.dispatchEvent(panned);container.removeAttribute('data-just-panned');return {capture,mode:p.active(),unrelated:unrelated.defaultPrevented,panned:panned.defaultPrevented,focus:Archify.focus.active()};})()`);
    // Route lets the panned key through; the existing Focus handler then consumes it.
    assert.deepEqual(filtered, { capture: { mode: 'source', prevented: false }, mode: null, unrelated: false, panned: true, focus: 'users' });
    await load('architecture', { suffix: '&embed=1#route=users~db' });
    assert.equal(await run('Archify.routeProbe.begin()'), false); assert.equal((await snapshot('embed-hash')).active, null);
  });

  await t.test('SVG graph fixtures preserve directed BFS order, parallel edges and strict export snapshots', async () => {
    await load('trace');
    // Isolate noncanonical graph inputs; original renderers remain unchanged.
    await run(`window.routeGraph=()=>{
      Archify.routeProbe.clear({preserveView:true});const svg=document.querySelector('.diagram-container > svg');
      svg.innerHTML='<g data-edge-from="a" data-edge-to="b" data-edge-key="ab" data-edge-id="first" transform="translate(3 4)"><path id="author-path" d="M0 0 L10 10" class="author" style="opacity:.7" marker-end="url(#arrow)"/><line x1="0" y1="0" x2="5" y2="5"/></g><path data-edge-from="a" data-edge-to="b" data-edge-key="parallel" d="M2 2 L20 20"/><path data-edge-from="a" data-edge-to="c" data-edge-key="ac" d="M0 0 L10 10"/><polyline data-edge-from="b" data-edge-to="d" data-edge-key="bd" points="0,0 10,10"/><path data-edge-from="c" data-edge-to="d" data-edge-key="cd" d="M0 0 L10 10"/><path data-edge-from="b" data-edge-to="a" data-edge-key="cycle" d="M0 0 L10 10"/><path data-edge-from="a" data-edge-to="a" data-edge-key="loop" d="M0 0 L10 10"/><path data-edge-from="a" data-edge-to="missing" data-edge-key="dangling" d="M0 0 L10 10"/>'+['a','b','c','d','solo'].map((id,i)=>'<g data-node-id="'+id+'" data-node-label="'+id.toUpperCase()+'" data-node-kind="backend" transform="translate('+i*100+' 100)"><rect width="60" height="40"/></g>').join('');
    }`);
    await run('routeGraph()'); await route('a', 'd');
    let s = await snapshot('graph-order'); assert.deepEqual(s.result.nodes, ['a', 'b', 'd']); assert.deepEqual(s.edges.map(e => e.key), ['ab', 'bd']);
    const shape = await run(`(()=>{const overlay=document.querySelector('[data-route-probe-overlay]'),shapes=[...overlay.querySelectorAll('.route-probe-flow')];return {count:shapes.length,transform:overlay.firstElementChild.getAttribute('transform'),d:shapes[0].getAttribute('d'),points:shapes[2].getAttribute('points'),steps:shapes.map(n=>n.style.getPropertyValue('--route-step')),normalized:shapes.every(n=>n.getAttribute('pathLength')==='1'),stripped:!overlay.querySelector('[id],[marker-end],[data-edge-key]'),original:document.getElementById('author-path').getAttribute('d'),beforeNode:overlay.nextElementSibling.hasAttribute('data-node-id')};})()`);
    assert.deepEqual(shape, { count: 3, transform: 'translate(3 4)', d: 'M0 0 L10 10', points: '0,0 10,10', steps: ['0', '0', '1'], normalized: true, stripped: true, original: 'M0 0 L10 10', beforeNode: true });
    const valid = await run(`(()=>{const p=Archify.routeProbe,s=p.exportSnapshot();s.nodeIds.length=0;s.edges[0].key='mutated';s.source.label='mutated';return p.exportSnapshot();})()`);
    assert.deepEqual(valid.nodeIds, ['a', 'b', 'd']); assert.equal(valid.edges[0].key, 'ab'); assert.equal(valid.source.label, 'A'); records.push({ scenario: 'geometry', shape, snapshot: valid });
    await run(`(()=>{routeGraph();const svg=document.querySelector('.diagram-container > svg');svg.insertBefore(svg.querySelector('[data-edge-key="ac"]'),svg.firstChild);})()`); await route('a', 'd');
    assert.deepEqual((await snapshot('reordered-tie')).result.nodes, ['a', 'c', 'd']);
    await run(`Archify.routeProbe.begin({source:'d'})`); assert.equal(await run(`Archify.routeProbe.choose('a')`), false);
    s = await snapshot('directed-unreachable'); assert.deepEqual(s.candidates, []); assert.equal(s.active, 'target');
    for (const [name, mutation] of [
      ['duplicate-node', `svg.appendChild(svg.querySelector('[data-node-id="a"]').cloneNode(true))`],
      ['detached-edge', `edge.remove()`], ['missing-key', `edge.removeAttribute('data-edge-key')`],
      ['duplicate-key', `svg.querySelector('[data-edge-key="bd"]').setAttribute('data-edge-key','ab')`],
      ['inconsistent-fragment', `const n=document.createElementNS(svg.namespaceURI,'text');n.setAttribute('data-edge-key','ab');n.setAttribute('data-edge-from','a');n.setAttribute('data-edge-to','c');svg.appendChild(n)`],
      ['multiple-drawable', `svg.appendChild(edge.cloneNode(true))`],
      ['zero-drawable', `edge.querySelectorAll('path,line').forEach(n=>n.remove())`],
      ['different-drawable', `const n=edge.cloneNode(true);edge.querySelectorAll('path,line').forEach(n=>n.remove());svg.appendChild(n)`],
    ]) {
      await run('routeGraph()'); await route('a', 'd');
      const rejected = await run(`(()=>{const svg=document.querySelector('.diagram-container > svg'),edge=svg.querySelector('[data-edge-key="ab"]');${mutation};return {result:Archify.routeProbe.result()!==null,snapshot:Archify.routeProbe.exportSnapshot()};})()`);
      assert.deepEqual(rejected, { result: true, snapshot: null }, name); records.push({ scenario: 'snapshot-' + name, ...rejected });
    }
    await run(`(()=>{routeGraph();const svg=document.querySelector('.diagram-container > svg');svg.querySelectorAll('[data-edge-from]').forEach(e=>{e.querySelectorAll('path,line,polyline').forEach(n=>n.remove());if(e.matches('path,line,polyline'))e.remove();});})()`);
    await route('a', 'b'); assert.equal(await run(`document.querySelector('[data-route-probe-overlay]').children.length`), 0);
    await run('Archify.routeProbe.selectJourneyIndex(1)'); assert.equal((await snapshot('no-geometry')).pulses, 0);
    await run(`Archify.routeProbe.clear();document.querySelector('.diagram-container > svg').innerHTML='';Archify.routeProbe.begin({focusNode:true})`);
    assert.deepEqual(await run('Archify.routeProbe.finderContext().allowedIds'), []); assert.equal(await run(`Archify.routeProbe.choose('missing')`), false); await snapshot('empty-graph');
  });

  await t.test('native Journey controls, finite playback, pause and layered Escape preserve path state', async () => {
    await load('trace'); await route();
    await run(`document.querySelector('[data-route-journey-index="0"]').focus()`); await key('ArrowLeft', 'ArrowLeft', 37);
    assert.equal(await run('document.activeElement.dataset.routeJourneyIndex'), '0');
    await key('End', 'End', 35); await key('ArrowRight', 'ArrowRight', 39); assert.equal(await run('document.activeElement.dataset.routeJourneyIndex'), '4');
    await key('Home', 'Home', 36); await key('ArrowRight', 'ArrowRight', 39); await key('Enter', 'Enter', 13);
    let s = await snapshot('journey-position'); assert.equal(s.result.journey, 1); assert.deepEqual(s.currentEdges, [s.edges[0].key]);
    assert.deepEqual(s.journey.map(n=>n.state), ['past','current','future','future','future']); assert.equal(s.chips.filter(n=>n.tab===0).length, 1);
    await run(`routeWait(()=>!document.querySelector('.diagram-container').hasAttribute('data-camera-transaction'))`);
    await click('#route-journey-next'); assert.equal((await snapshot('journey-next')).result.journey, 2);
    await click('#route-journey-prev'); assert.equal((await snapshot('journey-prev')).result.journey, 1);
    await click('#route-journey-overview'); assert.equal((await snapshot('overview')).result.journey, -1);
    await click('#route-journey-play'); assert.equal(await run('Archify.routeProbe.isJourneyPlaying()'), true);
    await run(`routeWait(()=>Archify.routeProbe.result().journey>=1)`); await snapshot('real-play-step');
    await key('Escape', 'Escape', 27); s = await snapshot('escape-paused'); assert.equal(s.result.playing, false); assert.ok(s.result.journey >= 1);
    await key('Escape', 'Escape', 27); assert.equal((await snapshot('escape-overview')).result.journey, -1);
    await key('Escape', 'Escape', 27); assert.equal((await snapshot('escape-cleared')).active, null);
    await route('api', 'db'); await click('#route-journey-play');
    assert.equal(await run('Archify.routeProbe.isJourneyPlaying()'), true, 'native Play click starts the journey');
    await run(`routeWait(()=>!Archify.routeProbe.isJourneyPlaying())`);
    s = await snapshot('natural-completion'); assert.equal(s.result.journey, 1); assert.equal(s.hash, '#route=api~db');
    assert.match(await run(`document.getElementById('route-journey-play').getAttribute('aria-label')`), /Replay/i);
    await click('#route-journey-play'); s = await snapshot('replay'); assert.equal(s.result.journey, 0); assert.equal(s.result.playing, true);
    await run(`document.querySelector('[data-route-journey-index="1"]').focus()`); assert.equal(await run('Archify.routeProbe.isJourneyPlaying()'), false);
    await key(' ', 'Space', 32); assert.equal((await snapshot('native-space-position')).result.journey, 1);
  });

  await t.test('controlled clocks preserve elapsed dwell, fresh steps, stale generations and pulse cleanup', async () => {
    await load('trace'); await route();
    const timing = await run(`routeClock(({jobs,last,advance,fire})=>{
      const p=Archify.routeProbe;const started=p.playJourney(),first=last(1100);advance(400);p.pauseJourney();const paused=p.result();p.playJourney();const resumed=jobs.at(-1).delay;fire(jobs.at(-1));const advanced=p.result();const fresh=jobs.at(-1).delay;
      p.clear({preserveView:true});const afterClear=p.result();fire(first);const stale=p.result();
      p.begin({source:'api'});p.choose('db');p.playJourney();const replaced=last(1100);p.begin({source:'users'});p.choose('cache');const replacement=p.result();fire(replaced);const afterReplacement=p.result();p.clear({preserveView:true});
      const cancelled=['overview','manual'].map(action=>{p.begin({source:'users'});p.choose('db');p.playJourney();const job=last(1100);if(action==='overview')p.showOverview({reveal:false});else p.selectJourneyIndex(2);const before=p.result();fire(job);const after=p.result();p.clear({preserveView:true});return {action,before,after};});
      return {cancelled,started,paused,advanced,resumed,fresh,afterClear,stale,replacement,afterReplacement};
    })`);
    assert.equal(timing.started, true); assert.equal(timing.paused.playing, false); assert.equal(timing.paused.journey, 0);
    assert.equal(timing.resumed, 700); assert.equal(timing.advanced.journey, 1); assert.equal(timing.fresh, 1100);
    for (const row of timing.cancelled) assert.deepEqual(row.after, row.before, row.action);
    assert.equal(timing.afterClear, null); assert.equal(timing.stale, null); assert.deepEqual(timing.afterReplacement, timing.replacement); records.push({ scenario: 'clock-fixture', ...timing });
    await route();
    const pulses = await run(`routeClock(({last,fire})=>{
      const p=Archify.routeProbe;p.selectJourneyIndex(1);const old=document.querySelector('[data-route-journey-overlay]'),fallback=last(860);p.selectJourneyIndex(2);const next=document.querySelector('[data-route-journey-overlay]');fire(fallback);const retained=next.isConnected;p.clear({preserveView:true});fire(last(860));return {oldGone:!old.isConnected,retained,afterClear:document.querySelectorAll('[data-route-journey-overlay]').length};
    })`);
    assert.deepEqual(pulses, { oldGone: true, retained: true, afterClear: 0 });
    await route();
    const fallback = await run(`routeClock(({last,fire})=>{Archify.routeProbe.selectJourneyIndex(1);const before=!!document.querySelector('[data-route-journey-overlay]');fire(last(860));return {before,after:!!document.querySelector('[data-route-journey-overlay]'),result:Archify.routeProbe.result()};})`);
    assert.equal(fallback.before, true); assert.equal(fallback.after, false); assert.equal(fallback.result.journey, 1);
    records.push({ scenario: 'pulse-fixture', pulses, fallback });
    await run('Archify.routeProbe.selectJourneyIndex(2)');
    await run(`routeWait(()=>routeEnds.some(e=>e.trusted&&e.name==='archify-route-journey-flow'))`);
    await run(`routeWait(()=>!document.querySelector('[data-route-journey-overlay]'))`);
    assert.equal((await snapshot('real-animation-complete')).result.journey, 2);
    await run(`Archify.routeProbe.selectJourneyIndex(3);window.foreignToken=Archify.motionGovernor.claim('story',()=>{})`);
    assert.equal((await snapshot('owner-replacement')).pulses, 0);
    await run('Archify.motionGovernor.release(foreignToken)'); await snapshot('owner-released');
  });

  await t.test('actual Finder, Focus, Lens, Guide and Camera handoffs retain cleanup options', async () => {
    await load('trace'); await click('#btn-route-probe'); await click('#route-probe-find');
    await run(`routeWait(()=>document.activeElement.id==='node-finder-input')`);
    assert.equal(await run('Archify.finder.context()'), 'route-source');
    assert.equal(await run(`document.getElementById('route-probe').dataset.finderOpen`), 'true');
    await key('Escape', 'Escape', 27); assert.equal(await run('document.activeElement.id'), 'route-probe-find');
    await run(`Archify.routeProbe.choose('users')`);
    const context = await run('Archify.routeProbe.finderContext()'); assert.ok(context.allowedIds.includes('db')); assert.ok(!context.allowedIds.includes('auth')); assert.match(context.badges.db, /4/);
    assert.equal(await run('Archify.routeProbe.openFinder()'), true);
    await run(`routeWait(()=>document.activeElement.id==='node-finder-input')`);
    await run(`document.getElementById('node-finder-input').value='PostgreSQL';document.getElementById('node-finder-input').dispatchEvent(new Event('input',{bubbles:true}))`);
    await key('Enter', 'Enter', 13); assert.equal((await snapshot('finder-result')).active, 'result');
    for (const [name, action] of [
      ['focus', `Archify.focus.set('api',{toggle:false})`], ['lens', `Archify.semanticLens.select('backend')`],
    ]) {
      await load('trace'); await route(); await run('Archify.routeProbe.playJourney()'); await run(action);
      const s = await snapshot(name + '-takeover'); assert.equal(s.active, null); assert.equal(s.overlays, 0); assert.equal(s.pulses, 0);
    }
    for (const [name, action] of [
      ['camera', `Archify.view.zoomIn()`], ['guide', `Archify.guide.open()`], ['still', `Archify.motionGovernor.pause()`],
      ['print-fixture', `dispatchEvent(new Event('beforeprint'))`],
      ['hidden-fixture', `Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))`],
    ]) {
      await load('trace'); await route(); await run('Archify.routeProbe.playJourney()'); await run(action);
      const s = await snapshot(name + '-pause'); assert.equal(s.active, 'result'); assert.equal(s.result.playing, false); assert.equal(s.result.journey, 0);
      if (name === 'hidden-fixture') { await run(`delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))`); assert.equal(await run('Archify.routeProbe.isJourneyPlaying()'), false); }
      if (name === 'still') { await run('Archify.motionGovernor.resume()'); assert.equal(await run('Archify.routeProbe.isJourneyPlaying()'), false); }
    }
    await load(); await route(); assert.equal(await run('Archify.routeProbe.playJourney()'), false);
    await run('Archify.view.zoomIn()'); const view = await run('Archify.view.state()');
    assert.equal(await run('Archify.routeProbe.clear({preserveView:true,updateUrl:false})===undefined'), true);
    assert.deepEqual(await run('Archify.view.state()'), view); assert.equal((await snapshot('clear-preserved')).hash, '#route=users~db');
    await run('Archify.routeProbe.clear()'); assert.deepEqual(await run('Archify.view.state()'), view);
    await route(); await run('Archify.view.zoomIn();Archify.routeProbe.clear({restoreFocus:true})');
    assert.equal(await run('Archify.view.state().scale'), 1); assert.equal(await run('document.activeElement.id'), 'btn-route-probe'); await snapshot('clear-reset');
  });

  await t.test('hash restoration and controlled clipboard preserve invalid states, query and delayed feedback', async () => {
    await load('architecture', { suffix: '&keep=yes#route=users~db' });
    let s = await snapshot('initial-hash'); assert.equal(s.active, 'result'); assert.equal(s.result.journey, -1);
    for (const value of ['#route=users', '#route=unknown~db', '#route=users~db~api']) {
      await hash(value); assert.deepEqual((await snapshot(value)).result.nodes, ['users','cdn','lb','api','db']);
    }
    await hash('#route=users~users'); s = await snapshot('hash-same'); assert.equal(s.active, 'target'); assert.equal(s.panel, 'error'); assert.equal(s.hash, '#route=users~users');
    await hash('#route=db~users'); s = await snapshot('hash-unreachable'); assert.equal(s.active, 'target'); assert.equal(s.panel, 'error');
    await hash('#route='); assert.equal((await snapshot('hash-empty')).active, null);
    await hash('#route=api~db'); await hash('#unrelated=yes'); assert.equal((await snapshot('hash-missing')).active, null);
    assert.equal(await run('Archify.routeProbe.copyLink()'), false);
    await run(`Archify.routeProbe.begin({source:'api'});Archify.routeProbe.choose('db',{updateUrl:false})`); assert.equal(await run('location.hash'), '#unrelated=yes');
    assert.equal(await run('location.search'), '?theme=dark&keep=yes');
    for (const mode of ['success','reject','absent','failure','throw']) {
      const copied = await run(`(async()=>{
        const descriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard'),exec=document.execCommand;let captured,commands=0;
        const expected=location.href.replace(/#.*$/,'')+'#route=api~db';
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:${mode === 'success' ? "{writeText:v=>{captured=v;return Promise.resolve();}}" : mode === 'reject' ? "{writeText:()=>Promise.reject(new Error('fixture'))}" : 'undefined'}});
        document.execCommand=command=>{commands++;captured=document.activeElement.value;if(${JSON.stringify(mode)}==='throw')throw new Error('fixture');return ${JSON.stringify(mode)}!=='failure';};
        try {const value=await Archify.routeProbe.copyLink(),button=document.getElementById('route-probe-copy');return {value,commands,correct:captured===expected,fields:document.querySelectorAll('textarea[readonly]').length,text:button.textContent,aria:button.getAttribute('aria-label')};}
        finally {document.execCommand=exec;if(descriptor)Object.defineProperty(navigator,'clipboard',descriptor);else delete navigator.clipboard;}
      })()`);
      assert.equal(copied.value, !['failure','throw'].includes(mode)); assert.equal(copied.commands, mode === 'success' ? 0 : 1); assert.equal(copied.correct, true); assert.equal(copied.fields, 0);
      assert.match(copied.text, copied.value ? /Copied/ : /Copy failed/i); assert.match(copied.aria, copied.value ? /copied/i : /Could not copy/i);
      // A pending feedback callback is not cancelled by clearing the route.
      if (mode === 'throw') await run('Archify.routeProbe.clear()');
      await run(`routeWait(()=>document.getElementById('route-probe-copy').getAttribute('aria-label')==='Copy link to traced route')`);
      records.push({ scenario: 'copy-' + mode, ...copied });
    }
    await snapshot('feedback-after-clear');
  });

  await t.test('docking rectangle and timer fixtures preserve top/bottom ties, resize and scroll', async () => {
    await load(); await route();
    await run(`routeWait(()=>!document.querySelector('.diagram-container').hasAttribute('data-camera-transaction'))`);
    const docked = await run(`(()=>{
      const panel=document.getElementById('route-probe'),container=document.querySelector('.diagram-container'),nav=container.querySelector('.diagram-nav'),nodes=[...container.querySelectorAll('[data-node-id]')],elements=[panel,container,nav,...nodes];
      const saved=elements.map(e=>Object.getOwnPropertyDescriptor(e,'getBoundingClientRect')),props=['offsetWidth','offsetHeight'].map(n=>Object.getOwnPropertyDescriptor(panel,n));let top=10,size=100;
      const rect=(x,y,w,h)=>({left:x,right:x+w,top:y,bottom:y+h,width:w,height:h});
      panel.getBoundingClientRect=()=>rect(0,10,200,100);container.getBoundingClientRect=()=>rect(0,0,1000,1000);nav.getBoundingClientRect=()=>rect(600,900,300,40);
      nodes.forEach(n=>n.getBoundingClientRect=()=>rect(0,top,200,100));Object.defineProperty(panel,'offsetWidth',{configurable:true,get:()=>size?200:0});Object.defineProperty(panel,'offsetHeight',{configurable:true,get:()=>size});
      try {const sides=[];for(const value of [10,790,400]){top=value;container.dispatchEvent(new Event('scroll'));sides.push(panel.dataset.routeDock);}size=0;container.dispatchEvent(new Event('scroll'));const noSize=panel.dataset.routeDock;
        const scheduled=routeClock(({jobs})=>{dispatchEvent(new Event('resize'));return jobs.map(j=>j.delay);});Archify.routeProbe.clear({preserveView:true});container.dispatchEvent(new Event('scroll'));return {sides,noSize,scheduled,hidden:panel.getAttribute('data-route-dock')};}
      finally{elements.forEach((e,i)=>{if(saved[i])Object.defineProperty(e,'getBoundingClientRect',saved[i]);else delete e.getBoundingClientRect;});['offsetWidth','offsetHeight'].forEach((n,i)=>{if(props[i])Object.defineProperty(panel,n,props[i]);else delete panel[n];});}
    })()`);
    assert.deepEqual(docked.sides, ['bottom','top','top']); assert.equal(docked.noSize, 'top'); assert.equal(docked.hidden, null);
    assert.ok(docked.scheduled.includes(120)); assert.ok(docked.scheduled.includes(560)); records.push({ scenario: 'docking-fixture', ...docked });
    await route();
    for (const width of [720, 390, 1440]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await run('Archify.viewerChromeLayout.whenStable()');
      await run(`routeWait(()=>['top','bottom'].includes(document.getElementById('route-probe').dataset.routeDock))`);
      const state = await run(`(()=>{const p=document.getElementById('route-probe'),container=document.querySelector('.diagram-container');container.scrollLeft=40;return {width:innerWidth,dock:p.dataset.routeDock,hidden:p.hidden};})()`);
      assert.equal(state.hidden, false); records.push({ scenario: 'viewport-' + width, ...state });
    }
  });

  await t.test('theme snapshots, Still rendering and real exports retain authored route semantics', async () => {
    for (const theme of ['dark','light']) {
      for (const position of [-1, 2]) {
        await load('trace', { theme, reduced: true }); await route();
        if (position >= 0) await run(`Archify.routeProbe.selectJourneyIndex(${position})`);
        await run(`routeWait(()=>!document.querySelector('.diagram-container').hasAttribute('data-camera-transaction'))`);
        assert.equal(await run('Archify.routeProbe.playJourney()'), false);
        const style = await run(`({flow:getComputedStyle(document.querySelector('.route-probe-flow')).animationName,pulses:document.querySelectorAll('[data-route-journey-overlay]').length})`);
        assert.deepEqual(style, { flow: 'none', pulses: 0 }); await snapshot(theme + '-' + position);
        if (evidence) {
          await run(`Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{})))`);
          await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
          const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,theme+(position<0?'-overview':'-position')+'.png'),Buffer.from(shot.data,'base64'));
        }
        const exported = await run(`(async()=>{
          const original=URL.createObjectURL;let blob;URL.createObjectURL=function(v){if(v.type.startsWith('image/svg+xml'))blob=v;return original.call(URL,v);};
          try {await Archify.exportMenu.run('svg');}finally{URL.createObjectURL=original;}
          const root=new DOMParser().parseFromString(await blob.text(),'image/svg+xml').documentElement;
          return {clean:!root.hasAttribute('data-route-active')&&!root.hasAttribute('data-route-journey')&&!root.querySelector('[data-route-match],[data-route-step],[data-route-journey-current],[data-route-probe-overlay],[data-route-journey-overlay]'),viewBox:root.getAttribute('viewBox')===document.querySelector('.diagram-container > svg').getAttribute('viewBox')};
        })()`);
        assert.deepEqual(exported, { clean: true, viewBox: true });
      }
    }
    await load('trace'); await route(); await run('Archify.motionGovernor.pause()');
    assert.equal(await run(`getComputedStyle(document.querySelector('.route-probe-flow')).animationName`), 'none');
    assert.equal(await run('Archify.routeProbe.playJourney()'), false);
    await run('Archify.exportMenu.open()');
    const share = await run(`(()=>{const n=document.querySelector('[data-action="route-share-card"]');return {hidden:n.hidden,disabled:n.disabled};})()`);
    assert.deepEqual(share, { hidden: false, disabled: false });
    await run('Archify.routeProbe.clear({preserveView:true})');
    assert.equal(await run(`document.querySelector('[data-action="route-share-card"]').hidden`), true);
  });
});
