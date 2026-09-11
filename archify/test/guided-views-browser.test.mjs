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

test('Guided Views preserves chapters, Story playback and handoff contracts', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser Guided Views checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-guided-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidence = process.env.ARCHIFY_GUIDED_EVIDENCE;
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
  // HTML fixtures isolate invalid payloads and graph shapes outside renderer validation.
  function variant(name, views, setup = '') {
    const original = fs.readFileSync(files.trace, 'utf8');
    assert.match(original, /<script id="archify-guided-views-data"[^>]*>[\s\S]*?<\/script>/, 'Guided Views data fixture anchor');
    assert.ok(original.includes('    var Archify = {};'), 'Guided Views setup fixture anchor');
    const html = original.replace(
      /(<script id="archify-guided-views-data"[^>]*>)[\s\S]*?(<\/script>)/,
      (_, start, end) => start + (typeof views === 'string' ? views : JSON.stringify(views)) + end,
    ).replace('    var Archify = {};', setup + '\n    var Archify = {};');
    files[name] = path.join(scratch, name + '.html'); fs.writeFileSync(files[name], html);
  }
  const chapter = (id, focus) => ({ id, label: id, focus, note: 'Chapter ' + id });
  const scrollNodes = ['users','cdn','lb','api','db','cache','worker'];
  variant('scroll', Array.from({length: 9}, (_, i) => chapter('chapter-' + i, scrollNodes)));
  variant('empty', []); variant('invalid', '{');
  variant('filtered', [chapter('filtered', ['users', 'unknown', 'users', 'cdn']), chapter('empty', ['unknown']), chapter('solo', ['db'])]);
  variant('short', [chapter('one', ['users', 'cdn']), chapter('two', ['cdn', 'lb'])]);
  variant('disjoint', [chapter('one', ['users','cdn']), chapter('two', ['api','db'])]);
  variant('relations', [chapter('relations', ['users','cdn','lb','api','db']), chapter('other', ['api','cache'])], `
    document.querySelector('.diagram-container > svg').innerHTML =
      '<g data-edge-from="users" data-edge-to="cdn" data-edge-key="a" data-edge-label="forward"></g>' +
      '<g data-edge-from="users" data-edge-to="cdn" data-edge-key="a" data-edge-label="forward" transform="translate(3 4)"><path d="M 90 100 L 230 100"/></g>' +
      '<path data-edge-from="lb" data-edge-to="cdn" data-edge-key="b" data-edge-label="reverse" d="M 370 100 L 230 100"/>' +
      '<line data-edge-from="lb" data-edge-to="api" data-edge-key="c" x1="370" y1="100" x2="510" y2="100"/>' +
      '<polyline data-edge-from="api" data-edge-to="lb" data-edge-key="d" points="510,110 370,110"/>' +
      ['users','cdn','lb','api','db','cache'].map((id,i)=>'<g tabindex="0" data-node-id="'+id+'" data-node-label="'+id+'" data-node-kind="backend"><rect x="'+(50+i*140)+'" y="80" width="80" height="40"/><text x="'+(50+i*140)+'" y="100">'+id+'</text></g>').join('');
  `);
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
    window.storyErrors=[];window.storyEnds=[];addEventListener('animationend',e=>{if(e.target.matches('.story-trail-flow'))storyEnds.push({name:e.animationName,trusted:e.isTrusted});},true);addEventListener('error',e=>storyErrors.push(e.message));
    addEventListener('unhandledrejection',e=>storyErrors.push(String(e.reason)));
    try {localStorage.removeItem('archify-motion');} catch (_) {}
    window.storyWait=predicate=>new Promise((resolve,reject)=>{
      const start=performance.now();function sample(){if(predicate())return resolve();
      if(performance.now()-start>12000)return reject(new Error('Story observation timed out'));requestAnimationFrame(sample);}requestAnimationFrame(sample);
    });
  ` });
  async function load(mode = 'architecture', { theme = 'dark', reduced = true, suffix = '' } = {}) {
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
  const chapterButton = id => `[data-guided-view-id="${id}"]`;
  const stop = id => `#guided-view-trail [data-story-node="${id}"]`;
  async function activate(id) {
    assert.equal(await run(`Archify.guidedViews.activate(${JSON.stringify(id)})`), true);
    await settled();
  }
  async function settled() {
    await run(`storyWait(()=>!Archify.guidedViews.handoff?.()&&!document.querySelector('.diagram-container').hasAttribute('data-camera-transaction'))`);
  }
  async function hash(value) {
    await run(`new Promise(resolve=>{addEventListener('hashchange',()=>requestAnimationFrame(resolve),{once:true});location.hash=${JSON.stringify(value)};})`);
    await settled();
  }
  async function snapshot(scenario) {
    const state = await run(`(()=>{
      const g=Archify.guidedViews,svg=document.querySelector('.diagram-container > svg'),panel=document.getElementById('guided-views');
      const attrs=el=>Object.fromEntries([...el.attributes].filter(a=>/^(data-(story|chapter|active-view|playing|autoplay|share)|aria-(current|pressed|live))/.test(a.name)).map(a=>[a.name,a.value]));
      return {count:g.count,active:g.active(),beat:g.beat?.()||null,preview:g.preview?.()||null,playing:g.isPlaying?.()||false,focus:g.focus?.()||[],hidden:panel.hidden,
        panel:attrs(panel),svg:attrs(svg),html:attrs(document.documentElement),hash:location.hash,
        chapters:[...document.querySelectorAll('[data-guided-view-id]')].map(n=>({id:n.dataset.guidedViewId,tab:n.tabIndex,preview:n.dataset.previewActive||null,attrs:attrs(n)})),
        stops:[...document.querySelectorAll('#guided-view-trail [data-story-node]')].map(n=>({id:n.dataset.storyNode,relation:n.dataset.storyRelation,disabled:n.disabled,current:n.getAttribute('aria-current')})),
        nodes:[...svg.querySelectorAll('[data-node-id]')].filter(n=>n.hasAttribute('data-story-step')||n.hasAttribute('data-chapter-preview-role')).map(n=>({id:n.dataset.nodeId,attrs:attrs(n)})),
        edges:[...svg.querySelectorAll('[data-edge-from][data-story-beat-step]')].map(n=>({key:n.dataset.edgeKey,from:n.dataset.edgeFrom,to:n.dataset.edgeTo,attrs:attrs(n)})),
        overlays:svg.querySelectorAll('[data-story-overlay]').length,carriers:svg.querySelectorAll('[data-story-carrier-overlay]').length,
        note:document.getElementById('guided-view-note').textContent,caption:document.getElementById('guided-story-caption').textContent.trim(),
        cue:{hidden:document.getElementById('share-chapter-cue').hidden,state:document.getElementById('share-chapter-cue').dataset.state||null},
        errors:storyErrors,external:performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/^https?:/.test(n))};
    })()`);
    assert.deepEqual(state.errors, [], scenario); assert.deepEqual(state.external, [], scenario);
    records.push({ scenario, ...state }); return state;
  }
  // Controlled clocks expose cancelled callbacks; real timing is tested separately.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.storyClock=body=>{
      const schedule=setTimeout,cancel=clearTimeout,clock=Date.now;let now=1000,serial=0;const jobs=[];
      window.setTimeout=(fn,delay)=>{const job={id:++serial,fn,delay,cancelled:false};jobs.push(job);return job.id;};
      window.clearTimeout=id=>{const job=jobs.find(j=>j.id===id);if(job)job.cancelled=true;};Date.now=()=>now;
      try{return body({jobs,advance:ms=>now+=ms,last:delay=>jobs.filter(j=>j.delay===delay).at(-1),fire:job=>job.fn()});}
      finally{window.setTimeout=schedule;window.clearTimeout=cancel;Date.now=clock;}
    };
  ` });

  await t.test('five modes, empty payloads and filtered chapter interfaces initialize faithfully', async () => {
    const members=['count','activate','showAll','play','playCurrent','pause','beatLink','copyBeatLink','cancelHandoff','settleHandoff','clearPreview','isPlaying','handoff','active','preview','delta','beat','focus'];
    for (const mode of Object.keys(cases)) {
      await load(mode); const s=await snapshot(mode+'-initial'); assert.equal(s.count,3); assert.equal(s.active,null); assert.equal(s.hidden,false);
      assert.deepEqual(await run('Object.keys(Archify.guidedViews)'),members);
    }
    for (const mode of ['empty','invalid']) {
      await load(mode); assert.deepEqual(await run('Object.keys(Archify.guidedViews)'),['count','active']);
      const s=await snapshot(mode); assert.equal(s.hidden,true); assert.equal(s.count,0);
    }
    await load('filtered'); await activate('filtered'); assert.deepEqual((await snapshot('filtered')).focus,['users','cdn']);
    await activate('empty'); assert.deepEqual((await snapshot('empty-focus')).stops,[]);
    await activate('solo'); assert.equal((await snapshot('solo')).stops.length,1);
    assert.equal(await run(`Archify.guidedViews.activate('unknown')`),false);
  });

  await t.test('native chapter and beat input preserves preview, focus and Escape ordering', async () => {
    await load(); await click(chapterButton('request-path')); await settled();
    assert.equal((await snapshot('chapter-click')).active,'request-path');
    await run(`document.querySelector(${JSON.stringify(chapterButton('request-path'))}).focus()`);
    await key('ArrowRight','ArrowRight',39); assert.equal(await run('Archify.guidedViews.preview()'),'identity-and-cache');
    await key('End','End',35); await key('ArrowRight','ArrowRight',39);
    assert.equal(await run('document.activeElement.dataset.guidedViewId'),'async-work');
    await key('Home','Home',36); await key('ArrowLeft','ArrowLeft',37);
    assert.equal(await run('document.activeElement.dataset.guidedViewId'),'request-path');
    await key('ArrowRight','ArrowRight',39); await key('Enter','Enter',13); await settled();
    assert.equal((await snapshot('chapter-key')).active,'identity-and-cache');
    await click(stop('cache')); await settled(); assert.equal((await snapshot('beat-click')).beat.nodeId,'cache');
    await run(`document.querySelector(${JSON.stringify(stop('api'))}).focus()`); await key(' ','Space',32); await settled();
    assert.equal((await snapshot('beat-key')).beat.nodeId,'api');
    await run(`document.querySelector(${JSON.stringify(chapterButton('async-work'))}).focus()`);
    assert.equal(await run('Archify.guidedViews.preview()'),'async-work');
    await key('Escape','Escape',27); assert.equal(await run('Archify.guidedViews.preview()'),null); assert.equal(await run('Archify.guidedViews.active()'),'identity-and-cache');
    await key('Escape','Escape',27); assert.equal((await snapshot('escape-overview')).active,null);
    await run('document.activeElement.blur()'); await key(']','BracketRight',221); await settled();
    assert.equal(await run('Archify.guidedViews.active()'),'request-path');
    await key('[','BracketLeft',219); assert.equal(await run('Archify.guidedViews.active()'),null);
    await activate('request-path'); await click('.diagram-container > svg [data-node-id="api"]'); await settled();
    const takeover=await snapshot('node-takeover'); assert.equal(takeover.active,null); assert.equal(await run('Archify.focus.active()'),'api');
    await run(`Archify.guide.open()`); await key(']','BracketRight',221); assert.equal(await run('Archify.guidedViews.active()'),null);
    await run(`Archify.guide.close();Archify.finder.open();document.getElementById('node-finder-input').focus()`);
    await key(']','BracketRight',221); assert.equal(await run('Archify.guidedViews.active()'),null);
  });

  await t.test('chapter preview retains independent pointer and focus intent with owner blocking', async () => {
    await load(); await activate('request-path');
    await run(`document.querySelector(${JSON.stringify(chapterButton('identity-and-cache'))}).focus()`);
    await move(chapterButton('async-work')); await run(`storyWait(()=>Archify.guidedViews.preview()==='async-work')`);
    await snapshot('pointer-wins'); await move(null); await run(`storyWait(()=>Archify.guidedViews.preview()==='identity-and-cache')`);
    await snapshot('focus-fallback'); await run('document.activeElement.blur()'); assert.equal(await run('Archify.guidedViews.preview()'),null);
    const touch=await run(`(()=>{const b=document.querySelector(${JSON.stringify(chapterButton('async-work'))});b.dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'touch'}));return Archify.guidedViews.preview();})()`);
    assert.equal(touch,null);
    for (const [name,action] of [['route',`Archify.routeProbe.begin({source:'users'})`],['lens',`Archify.semanticLens.select('backend')`],['focus',`Archify.guidedViews.showAll();Archify.focus.set('api')`]]) {
      await load(); await activate('request-path'); await run(action);
      await run(`document.querySelector(${JSON.stringify(chapterButton('async-work'))}).focus()`);
      assert.equal((await snapshot('preview-blocked-'+name)).preview,null);
    }
    await load('trace',{reduced:false}); await activate('request-path'); await run('Archify.guidedViews.play()');
    await run(`document.querySelector(${JSON.stringify(chapterButton('async-work'))}).focus()`);
    assert.equal(await run('Archify.guidedViews.isPlaying()'),false); assert.equal(await run('Archify.guidedViews.preview()'),'async-work');
    await snapshot('preview-pauses-play');
  });

  await t.test('Story geometry distinguishes direction, grouping and duplicate fragments without BFS', async () => {
    await load('relations'); await activate('relations');
    let s=await snapshot('relations'); assert.deepEqual(s.stops.map(n=>n.relation),['start','forward','reverse','multiple','group']);
    assert.deepEqual(s.edges.map(e=>e.key),['a','b','c','d']);
    const geometry=await run(`(()=>{const svg=document.querySelector('.diagram-container > svg'),g=Archify.guidedViews;
      const f=g.focus();f.pop();const d=g.delta('other');d.enter.push('bad');
      return {focus:g.focus(),delta:g.delta('other'),shapes:[...svg.querySelectorAll('.story-trail-flow')].map(n=>({tag:n.tagName,d:n.getAttribute('d'),points:n.getAttribute('points'),transform:n.parentElement.getAttribute('transform'),key:n.getAttribute('data-edge-key')}))};})()`);
    assert.deepEqual(geometry.focus,['users','cdn','lb','api','db']); assert.deepEqual(geometry.delta,{stay:['api'],enter:['cache'],leave:['users','cdn','lb','db']});
    assert.equal(geometry.shapes.length,4); assert.equal(geometry.shapes[0].transform,'translate(3 4)'); assert.equal(geometry.shapes[0].d,'M 90 100 L 230 100'); assert.ok(geometry.shapes.every(n=>n.key===null));
    records.push({scenario:'geometry-copies',...geometry});
    for (const id of ['users','cdn','lb','api','db']) {
      await click(stop(id)); await settled(); s=await snapshot('relation-beat-'+id); assert.equal(s.beat.nodeId,id);
      assert.equal(await run(`(()=>{const b=Archify.guidedViews.beat();b.edgeKeys.push('bad');return Archify.guidedViews.beat().edgeKeys.includes('bad');})()`),false);
    }
    await run(`document.querySelectorAll('.diagram-container > svg [data-edge-from]').forEach(e=>e.remove());Archify.guidedViews.activate('relations')`); await settled();
    assert.equal((await snapshot('no-geometry')).overlays,0);
  });

  await t.test('handoff holds an authored anchor and preserves cancellation versus settling', async () => {
    await load('trace',{reduced:false}); await activate('request-path');
    const holding=await run(`(()=>{Archify.guidedViews.activate('identity-and-cache');return {handoff:Archify.guidedViews.handoff(),disabled:[...document.querySelectorAll('#guided-view-trail button')].every(n=>n.disabled),anchor:document.querySelector('.diagram-container > svg').dataset.chapterAnchor};})()`);
    assert.equal(holding.handoff.mode,'holding'); assert.equal(holding.anchor,'api'); assert.equal(holding.disabled,true);
    await settled(); assert.equal((await snapshot('handoff-complete')).active,'identity-and-cache');
    const states=await run(`storyClock(c=>{
      const reveal=Archify.view.reveal;const calls=[];const receipts=[];
      Archify.view.reveal=(ids,opts)=>{let resolve;const finished=new Promise(r=>resolve=r);const receipt={finished,cancel:(reason,commit)=>{calls.push({reason,commit});resolve({state:reason});}};receipts.push({ids:[...ids],opts,resolve});return receipt;};
      const g=Archify.guidedViews;
      try {
        g.activate('request-path');const hold=c.last(110);const first=g.handoff();g.cancelHandoff('manual-test');c.fire(hold);const cancelled=g.handoff();
        g.activate('identity-and-cache');c.fire(c.last(110));g.settleHandoff('settled-test');
        g.activate('request-path');c.fire(c.last(110));g.cancelHandoff('manual-camera');
        return {firstMode:first.mode,cancelled,calls,receipts:receipts.map(r=>({ids:r.ids,duration:r.opts.duration})),remaining:g.handoff()};
      } finally {g.cancelHandoff('fixture-cleanup');Archify.view.reveal=reveal;}
    })`);
    assert.equal(states.firstMode,'holding'); assert.equal(states.cancelled,null); assert.equal(states.remaining,null);
    assert.deepEqual(states.calls,[{reason:'settled-test',commit:true},{reason:'manual-camera',commit:false}]);
    assert.ok(states.receipts.every(r=>r.duration===420)); records.push({scenario:'handoff-clock-camera-fixture',...states});
    await load('disjoint',{reduced:false});await activate('one');
    const noAnchor=await run(`(()=>{Archify.guidedViews.activate('two');return document.querySelector('.diagram-container > svg').dataset.chapterHandoff;})()`);assert.equal(noAnchor,'no-anchor');await settled();await snapshot('no-anchor-handoff');
    await load('relations',{reduced:false}); await activate('relations');
    await run(`Archify.guidedViews.activate('other')`); await settled();
    await run(`Archify.guidedViews.activate('relations')`); await run(`storyWait(()=>Archify.guidedViews.handoff()?.mode==='settling')`);
    await run('Archify.view.zoomIn()'); assert.equal(await run('Archify.guidedViews.handoff()'),null); await snapshot('manual-camera-handoff');
    await load('trace',{reduced:false}); await activate('request-path');
    const replacement=await run(`storyClock(c=>{const g=Archify.guidedViews;g.activate('identity-and-cache');const old=c.last(110);g.activate('async-work');const before=g.handoff();c.fire(old);const same=g.handoff().id===before.id;g.showAll();c.fire(old);return {same,active:g.active(),handoff:g.handoff()};})`);
    assert.deepEqual(replacement,{same:true,active:null,handoff:null}); records.push({scenario:'replaced-hold',...replacement});
  });

  await t.test('real Story and chapter playback complete while precise clock fixtures preserve dwell', async () => {
    await load('short',{reduced:false}); assert.equal(await run('Archify.guidedViews.play()'),true);
    await run(`storyWait(()=>Archify.guidedViews.active()==='two'&&Archify.guidedViews.isPlaying())`);
    await run(`storyWait(()=>!Archify.guidedViews.isPlaying())`); let s=await snapshot('whole-story-complete');
    assert.equal(s.active,'two'); assert.equal(s.beat.nodeId,'lb'); assert.match(await run(`document.getElementById('guided-view-play-label').textContent`),/Replay/);
    assert.equal(await run('Archify.guidedViews.play()'),true); await run('Archify.guidedViews.pause()'); assert.equal(await run('Archify.guidedViews.active()'),'one');
    await load('short',{reduced:false}); assert.equal(await run('Archify.guidedViews.playCurrent()'),true);
    await run(`storyWait(()=>!Archify.guidedViews.isPlaying())`); s=await snapshot('single-chapter-complete'); assert.equal(s.active,'one'); assert.equal(s.panel['data-autoplay'],'complete');
    await load('short',{reduced:false}); await activate('one');
    const timing=await run(`storyClock(c=>{
      const g=Archify.guidedViews;g.play();const initial=c.last(1600);c.advance(400);g.pause();g.play();const resumed=c.last(1200);c.fire(resumed);const next=c.last(1600);const beat=g.beat().nodeId;g.pause();
      g.showAll();c.fire(initial);c.fire(next);return {initial:initial.delay,resumed:resumed.delay,next:next.delay,beat,after:g.active(),playing:g.isPlaying()};
    })`);
    assert.deepEqual(timing,{initial:1600,resumed:1200,next:1600,beat:'cdn',after:null,playing:false}); records.push({scenario:'dwell-clock',...timing});
    await load('trace',{reduced:false}); await activate('request-path');
    const stale=await run(`storyClock(c=>{const g=Archify.guidedViews;g.play();const old=c.last(1100);document.querySelector('[data-story-node="lb"]').click();const before=g.beat().nodeId;c.fire(old);const after=g.beat().nodeId;g.showAll();return {before,after,playing:g.isPlaying()};})`);
    assert.deepEqual(stale,{before:'lb',after:'lb',playing:false}); records.push({scenario:'manual-step-stale-timer',...stale});
  });

  await t.test('Motion lifecycle and real capability handoffs preserve Story cleanup', async () => {
    for (const [name,action] of [
      ['camera',`Archify.view.zoomIn()`],['guide',`Archify.guide.open()`],['still',`Archify.motionGovernor.pause()`],
      ['print-fixture',`dispatchEvent(new Event('beforeprint'))`],
      ['hidden-fixture',`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))`],
    ]) {
      await load('trace',{reduced:false}); await activate('request-path'); await run('Archify.guidedViews.play()'); await run(action);
      let s=await snapshot(name+'-pause'); assert.equal(s.playing,false); assert.equal(s.active,'request-path'); assert.equal(s.carriers,0);
      if(name==='hidden-fixture') await run(`delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))`);
      if(name==='still') await run('Archify.motionGovernor.resume()');
      assert.equal(await run('Archify.guidedViews.isPlaying()'),false);
    }
    for (const [name,action] of [['finder',`Archify.finder.open()`],['route',`Archify.routeProbe.begin({source:'users'})`],['lens',`Archify.semanticLens.select('backend')`]]) {
      await load('trace',{reduced:false}); await activate('request-path'); await run('Archify.guidedViews.play()'); await run(action);
      if(name==='finder'){
        const opened=await snapshot('finder-open-preserves-story');assert.equal(opened.active,'request-path');assert.equal(opened.playing,true);
        await run(`storyWait(()=>document.activeElement.id==='node-finder-input')`);
        await run(`document.getElementById('node-finder-input').value='PostgreSQL';document.getElementById('node-finder-input').dispatchEvent(new Event('input',{bubbles:true}))`);await key('Enter','Enter',13);
      }
      const s=await snapshot(name+'-takeover'); assert.equal(s.active,null); assert.equal(s.playing,false); assert.equal(s.overlays,0);
    }
    await load('trace',{reduced:false});await activate('request-path');await run('Archify.guidedViews.play()');
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
    await run(`storyWait(()=>!Archify.guidedViews.isPlaying())`);await snapshot('live-system-reduced-motion');
    await load('architecture',{reduced:false}); assert.equal(await run('Archify.guidedViews.play()'),true); await run('Archify.guidedViews.pause()'); await snapshot('nontrace-playback');
    await load('trace'); assert.equal(await run('Archify.guidedViews.play()'),false);
    await load('trace',{reduced:false}); await activate('request-path'); await click(stop('cdn')); await settled();
    await run(`storyWait(()=>storyEnds.some(e=>e.trusted)&&!document.querySelector('[data-story-carrier-overlay]'))`);
    assert.equal(await run(`document.querySelectorAll('[data-story-pulse]').length`),0); await snapshot('animationend-cleared');
    const preempt=await run(`(()=>{document.querySelector('[data-story-node="lb"]').click();const before=document.querySelectorAll('[data-story-carrier-overlay]').length;const token=Archify.motionGovernor.claim('handoff',()=>{});const after=document.querySelectorAll('[data-story-carrier-overlay]').length;Archify.motionGovernor.release(token);return {before,after};})()`);
    assert.deepEqual(preempt,{before:1,after:0}); records.push({scenario:'pulse-owner-preempt',...preempt});
    // Explicit hidden-page fixture leaves play=1 pending until visibility resumes.
    variant('pending',[chapter('one',['users','cdn'])],`Object.defineProperty(document,'hidden',{configurable:true,value:true});`);
    await load('pending',{reduced:false,suffix:'&embed=1&play=1#view=one'});
    assert.equal(await run(`document.getElementById('guided-views').dataset.autoplay`),'pending');
    await run(`delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))`);
    assert.equal(await run('Archify.guidedViews.isPlaying()'),true); await run('Archify.guidedViews.pause()'); await snapshot('pending-consumed-on-visible');
  });

  await t.test('hash and moment links retain restoration, query and clipboard feedback contracts', async () => {
    await load('trace',{suffix:'&keep=yes#view=request-path&beat=lb'}); await settled();
    await run(`storyWait(()=>Archify.guidedViews.beat()?.nodeId==='lb')`); assert.equal((await snapshot('initial-linked-beat')).beat.nodeId,'lb');
    const link=await run(`(()=>{const u=new URL(Archify.guidedViews.beatLink());return {hash:u.hash,query:u.search};})()`);
    assert.deepEqual(link,{hash:'#view=request-path&beat=lb',query:'?theme=dark&keep=yes'});
    await hash('#view=identity-and-cache&beat=cache'); assert.equal((await snapshot('hash-beat')).beat.nodeId,'cache');
    await hash('#view=identity-and-cache&beat=unknown'); assert.equal((await snapshot('unknown-beat')).beat,null);
    await hash('#view=unknown'); assert.equal((await snapshot('unknown-view')).active,null);
    await hash('#focus=api'); assert.equal((await snapshot('focus-hash')).active,null);
    await hash('#route=users~db'); assert.equal((await snapshot('route-hash')).active,null);
    await hash(''); assert.equal((await snapshot('empty-hash')).active,null);
    assert.equal(await run('Archify.guidedViews.copyBeatLink()'),false);
    await load('trace',{suffix:'&play=1&keep=yes#view=request-path&beat=cdn'}); await settled();
    await run(`storyWait(()=>Archify.guidedViews.beat()?.nodeId==='cdn')`);
    assert.equal(await run(`new URL(Archify.guidedViews.beatLink()).searchParams.has('play')`),false);
    for (const mode of ['success','reject','absent','failure','throw']) {
      const copied=await run(`(async()=>{
        const descriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard'),exec=document.execCommand;let value='',calls=0;
        const expected=Archify.guidedViews.beatLink();
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:${mode==='success'?"{writeText:v=>{value=v;return Promise.resolve();}}":mode==='reject'?"{writeText:()=>Promise.reject(new Error('fixture'))}":'undefined'}});
        document.execCommand=()=>{calls++;value=document.activeElement.value;if(${JSON.stringify(mode)}==='throw')throw new Error('fixture');return ${JSON.stringify(mode)}!=='failure';};
        try {const ok=await Archify.guidedViews.copyBeatLink();return {ok,calls,correct:value===expected,fields:document.querySelectorAll('textarea[readonly]').length,state:document.getElementById('guided-view-beat-link').dataset.copyState};}
        finally{document.execCommand=exec;if(descriptor)Object.defineProperty(navigator,'clipboard',descriptor);else delete navigator.clipboard;}
      })()`);
      assert.equal(copied.ok,!['failure','throw'].includes(mode)); assert.equal(copied.calls,mode==='success'?0:1); assert.equal(copied.correct,true); assert.equal(copied.fields,0); assert.equal(copied.state,copied.ok?'copied':'failed');
      await run(`storyWait(()=>!document.getElementById('guided-view-beat-link').hasAttribute('data-copy-state'))`); records.push({scenario:'copy-'+mode,...copied});
    }
    const late=await run(`(async()=>{const descriptor=Object.getOwnPropertyDescriptor(navigator,'clipboard');let resolve;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>new Promise(r=>resolve=r)}});
      try{const pending=Archify.guidedViews.copyBeatLink();Archify.guidedViews.showAll();resolve();await pending;const button=document.getElementById('guided-view-beat-link');return {active:Archify.guidedViews.active(),state:button.dataset.copyState,disabled:button.disabled};}
      finally{if(descriptor)Object.defineProperty(navigator,'clipboard',descriptor);else delete navigator.clipboard;}})()`);
    assert.deepEqual(late,{active:null,state:'copied',disabled:true}); records.push({scenario:'copy-completes-after-overview',...late});
    await run(`storyWait(()=>!document.getElementById('guided-view-beat-link').hasAttribute('data-copy-state'))`);
    await load('trace',{reduced:false}); await activate('request-path');
    await run(`location.hash='view=identity-and-cache&beat=cache';new Promise(resolve=>requestAnimationFrame(()=>{location.hash='view=async-work&beat=worker';requestAnimationFrame(resolve);}))`);
    await settled(); await run(`storyWait(()=>Archify.guidedViews.beat()?.nodeId==='worker')`); await snapshot('latest-hash-wins');
  });


  await t.test('active preview, handoff and carrier serialize without leaking transient state', async () => {
    const actions={
      'focus-preview':`document.querySelector('[data-guided-view-id="identity-and-cache"]').focus()`,
      'pointer-preview':`void 0`,
      handoff:`Archify.guidedViews.activate('identity-and-cache')`,
      carrier:`document.querySelector('[data-story-node="cdn"]').click()`,
    };
    for(const [name,action] of Object.entries(actions)){
      await load('trace',{reduced:false});await activate('request-path');
      if(name==='pointer-preview')await move(chapterButton('identity-and-cache'));
      const result=await run(`(async()=>{
        ${action};const svg=document.querySelector('.diagram-container > svg');
        const present=${JSON.stringify(name)}.endsWith('preview')?!!Archify.guidedViews.preview():${JSON.stringify(name)}==='handoff'?!!Archify.guidedViews.handoff():!!svg.querySelector('[data-story-carrier-overlay]');
        const geometry=root=>[...root.querySelectorAll('[data-edge-from]')].map(n=>({tag:n.tagName,key:n.getAttribute('data-edge-key'),d:n.getAttribute('d'),points:n.getAttribute('points'),transform:n.getAttribute('transform')}));
        const sourceGeometry=geometry(svg),before=svg.outerHTML,create=URL.createObjectURL;let blob,after;
        URL.createObjectURL=function(value){if(value.type.startsWith('image/svg+xml'))blob=value;return create.call(URL,value);};
        try{const pending=Archify.exportMenu.run('svg');after=svg.outerHTML;await pending;}finally{URL.createObjectURL=create;}
        const root=new DOMParser().parseFromString(await blob.text(),'image/svg+xml').documentElement;
        return {present,liveSame:before===after,geometrySame:JSON.stringify(sourceGeometry)===JSON.stringify(geometry(root)),viewBox:root.getAttribute('viewBox')===svg.getAttribute('viewBox'),clean:![...root.querySelectorAll('*'),root].some(n=>[...n.attributes].some(a=>/^data-(story|chapter)/.test(a.name)))};
      })()`);
      // Export focuses its trigger before serialization: focus-backed preview clears.
      // Pointer-backed preview remains and must be removed only from the clone.
      assert.deepEqual(result,{present:true,liveSame:name!=='focus-preview',geometrySame:true,viewBox:true,clean:true});records.push({scenario:'export-'+name,...result});
    }
  });

  await t.test('theme, narrow layout, embed moments and real SVG exports keep canonical geometry', async () => {
    for(const theme of ['dark','light']) {
      for(const position of ['overview','beat']) {
        await load('trace',{theme}); await activate('request-path');
        if(position==='beat'){await click(stop('lb'));await settled();}
        const style=await run(`({flow:getComputedStyle(document.querySelector('.story-trail-flow')).animationName,carriers:document.querySelectorAll('[data-story-carrier-overlay]').length})`);
        assert.deepEqual(style,{flow:'none',carriers:0}); await snapshot(theme+'-'+position);
        if(evidence){
          await run(`Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{})))`);
          const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,theme+'-'+position+'.png'),Buffer.from(shot.data,'base64'));
        }
        const exported=await run(`(async()=>{const svg=document.querySelector('.diagram-container > svg'),before=svg.outerHTML,create=URL.createObjectURL;let blob,after;
          URL.createObjectURL=function(value){if(value.type.startsWith('image/svg+xml'))blob=value;return create.call(URL,value);};
          try{const pending=Archify.exportMenu.run('svg');after=svg.outerHTML;await pending;}finally{URL.createObjectURL=create;}
          const root=new DOMParser().parseFromString(await blob.text(),'image/svg+xml').documentElement;
          return {liveSame:before===after,viewBox:root.getAttribute('viewBox')===svg.getAttribute('viewBox'),clean:![...root.querySelectorAll('*'),root].some(n=>[...n.attributes].some(a=>/^data-(story|chapter)/.test(a.name)))};
        })()`); assert.deepEqual(exported,{liveSame:true,viewBox:true,clean:true});
      }
    }
    for(const width of [720,390,1440]) {
      await load(); await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});await run('Archify.viewerChromeLayout.whenStable()');
      await run(`document.querySelector(${JSON.stringify(chapterButton('request-path'))}).focus()`);await key('End','End',35);await key('Enter','Enter',13);await settled();
      await run(`document.querySelector(${JSON.stringify(stop('worker'))}).focus()`);await key('Enter','Enter',13);await settled();
      assert.equal(await run('Archify.guidedViews.active()'), 'async-work');
      assert.equal(await run('Archify.guidedViews.beat().nodeId'), 'worker');
    }
    for(const width of [390,720,1440]) {
      await load('scroll');
      await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
      await run('Archify.viewerChromeLayout.whenStable()');
      // Keyboard activation must reveal and center off-screen items itself.
      // preventScroll keeps native focus scrolling from concealing a regression.
      for(const index of [8,4,0]) {
        const chapterId='chapter-'+index;
        await run(`document.querySelector(${JSON.stringify(chapterButton(chapterId))}).focus({preventScroll:true})`);
        await key('Enter','Enter',13);await settled();await run('Archify.viewerChromeLayout.whenStable()');
        assert.equal(await run('Archify.guidedViews.active()'),chapterId);
        for(const nodeId of [null,'worker','api','users']) {
          if(nodeId) {
            await run(`document.querySelector(${JSON.stringify(stop(nodeId))}).focus({preventScroll:true})`);
            await key('Enter','Enter',13);await settled();
            assert.equal(await run('Archify.guidedViews.beat().nodeId'),nodeId);
          }
          const scroll=await run(`(()=>{
            function measure(container,selector) {
              const c=document.getElementById(container),item=c.querySelector(selector),r=item.getBoundingClientRect(),box=c.getBoundingClientRect();
              const left=box.left+c.clientLeft,right=left+c.clientWidth;
              return {itemWidth:r.width,leftGap:r.left-left,rightGap:right-r.right,
                centerDelta:(r.left+r.right-left-right)/2,scroll:c.scrollLeft,maxScroll:c.scrollWidth-c.clientWidth};
            }
            return ${nodeId ? `{trail:measure('guided-view-trail','[data-story-node="${nodeId}"]')}` : `{chapter:measure('guided-view-chapters','[data-guided-view-id="${chapterId}"]')}`};
          })()`);
          for(const [name,position] of Object.entries(scroll)) {
            const context=JSON.stringify({width,chapterId,nodeId,name,...position});
            assert.ok(position.itemWidth>0 && position.leftGap>=-1 && position.rightGap>=-1,'selected item is fully visible: '+context);
            assert.ok(Math.abs(position.centerDelta)<=1 ||
              (position.scroll<=1 && position.centerDelta<0) ||
              (position.scroll>=position.maxScroll-1 && position.centerDelta>0),'centered or clamped at the corresponding edge: '+context);
            if(width===390) assert.ok(position.maxScroll>20,'fixture genuinely overflows: '+context);
          }
          records.push({scenario:'scroll-'+width+'-'+chapterId+'-'+nodeId,...scroll});
          if(width===390 && index===4 && nodeId==='api') {
            await run(`document.getElementById('guided-view-trail').scrollLeft=0;new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
            assert.equal(await run(`document.getElementById('guided-view-trail').scrollLeft`),0,'manual scrolling alone must not recenter the active beat');
          }
        }
      }
    }
    for(const suffix of ['&embed=1#view=request-path&beat=lb','&embed=1&play=1#view=request-path&beat=lb']) {
      await load('trace',{suffix});await settled();await run(`storyWait(()=>Archify.guidedViews.beat()?.nodeId==='lb')`);
      const s=await snapshot(suffix.includes('play=1')?'embed-static-share':'embed-pinned');assert.equal(s.playing,false);assert.equal(s.cue.hidden,false);assert.equal(s.cue.state,suffix.includes('play=1')?'reduced-motion':'pinned');
    }
  });
});
