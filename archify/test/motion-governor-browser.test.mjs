import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Motion Governor preserves mode, ownership, ambient completion and real callers', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser motion checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-motion-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidence = process.env.ARCHIFY_MOTION_EVIDENCE;
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
    const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
    doc.meta.animation = 'trace';
    const input = path.join(scratch, mode + '.json');
    fs.writeFileSync(input, JSON.stringify(doc));
    files[mode] = path.join(scratch, mode + '.html');
    execFileSync(process.execPath, [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), input, files[mode]]);
  }
  files.static = path.join(scratch, 'static.html');
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(skillRoot, 'examples', cases.architecture), files.static]);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  let startup;
  let navigationId = 0;
  async function media(reduced) {
    await send('Emulation.setEmulatedMedia', { media: '', features: [
      { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
    ] });
  }
  async function load(mode = 'architecture', { theme = 'dark', reduced = false, fixture = '', preserveStorage = false, query = '' } = {}) {
    const expectedNavigation = ++navigationId;
    if (startup) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: startup });
    ({ identifier: startup } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      if (new URL(location.href).searchParams.get('testNavigation') !== '${expectedNavigation}') return;
      window.motionNavigation = ${expectedNavigation};
      try { window.motionStartupPreference = localStorage.getItem('archify-motion'); }
      catch (error) { window.motionStartupPreference = String(error); }
      window.motionErrors = []; window.motionEnds = []; window.motionAmbient = [];
      addEventListener('error', e => motionErrors.push(e.message));
      addEventListener('unhandledrejection', e => motionErrors.push(String(e.reason)));
      addEventListener('animationend', e => {
        if (e.target.matches('[data-animate]')) motionEnds.push({ trusted:e.isTrusted, name:e.animationName });
      }, true);
      new MutationObserver(records => {
        for (const r of records) if (r.attributeName === 'data-ambient-motion') {
          motionAmbient.push({ before:r.oldValue, after:r.target.getAttribute(r.attributeName) });
        }
      }).observe(document, { subtree:true, attributes:true, attributeOldValue:true, attributeFilter:['data-ambient-motion'] });
      window.motionWait = predicate => new Promise((resolve, reject) => {
        const start = performance.now();
        function sample() {
          if (predicate()) return resolve();
          if (performance.now() - start > 12000) return reject(new Error('Motion observation timed out'));
          requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      ${preserveStorage ? '' : "try { localStorage.removeItem('archify-motion'); } catch (_) {}"}
      ${fixture}
    })();` }));
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await media(reduced);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    const navigation = await send('Page.navigate', { url: pathToFileURL(files[mode]).href + `?theme=${theme}&testNavigation=${expectedNavigation}${query}` });
    assert.ok(navigation.loaderId, 'Motion fixture must load a new document.');
    await loaded;
    await run('document.fonts.ready');
    assert.equal(await run('window.motionNavigation'), expectedNavigation, 'Motion fixture document identity');
  }
  async function snapshot(label) {
    const value = await run(`(() => {
      const m = Archify.motionGovernor, root = document.documentElement, btn = document.getElementById('btn-motion');
      return { capable:m.capable, mode:m.mode(), paused:m.isPaused(), owner:m.owner(),
        rootMode:root.getAttribute('data-motion'), rootOwner:root.getAttribute('data-motion-owner'),
        ambient:root.getAttribute('data-ambient-motion'), reason:root.getAttribute('data-ambient-settle-reason'),
        hidden:btn.hidden, disabled:btn.disabled, pressed:btn.getAttribute('aria-pressed'),
        label:document.getElementById('motion-label').textContent, aria:btn.getAttribute('aria-label'), errors:motionErrors };
    })()`);
    assert.deepEqual(value.errors, [], label);
    records.push({ scenario: label, ...value });
    return value;
  }
  async function screenshot(name) {
    if (!evidence) return;
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(evidence, name + '.png'), Buffer.from(shot.data, 'base64'));
  }

  await t.test('five trace modes initialize; representative CSS animation completes once; static methods remain inert', async () => {
    for (const mode of Object.keys(cases)) {
      await load(mode);
      const initial = await snapshot(mode + '-initial');
      assert.equal(initial.capable, true); assert.equal(initial.mode, 'live');
      // All modes share the same Governor/CSS. One real completion plus the
      // five-mode initialization contract covers this seam without five waits.
      if (mode === 'architecture') {
        await run(`motionWait(() => document.documentElement.getAttribute('data-ambient-motion') === 'settled')`);
        const state = await snapshot(mode + '-settled');
        assert.equal(state.capable, true); assert.equal(state.mode, 'live'); assert.equal(state.reason, 'complete');
        const ambient = await run(`({ running:motionAmbient.some(r => r.after === 'running' || r.before === 'running'),
          ended:motionEnds.some(e => e.trusted), animations:Array.from(document.querySelectorAll('[data-animate]'), e => getComputedStyle(e).animationName),
          security:Array.from(document.querySelectorAll('.a-security'), e => getComputedStyle(e).strokeDasharray) })`);
        assert.equal(ambient.running, true); assert.equal(ambient.ended, true);
        assert.ok(ambient.animations.every(name => name === 'none'));
        assert.ok(ambient.security.every(dash => dash === '5px, 5px'));
      }
      await run(`Archify.motionGovernor.pause(); Archify.motionGovernor.resume();`);
      assert.equal((await snapshot(mode + '-resumed')).ambient, 'settled');
    }
    await load('static');
    const inert = await run(`(() => { const m=Archify.motionGovernor; return [m.capable,m.pause(),m.resume(),m.toggle(),m.setMode('live'),m.mode(),m.claim('story'),m.release(1),m.suspend('test')(),m.isPaused(),m.owner()]; })()`);
    assert.deepEqual(inert, [false,false,false,false,'still','still',0,false,false,true,'']);
    assert.equal((await snapshot('static')).hidden, true);
  });

  await t.test('stored user intent remains distinct from reduced motion and suspension', async () => {
    await load();
    assert.equal(await run('Archify.motionGovernor.pause()'), true);
    assert.equal(await run(`localStorage.getItem('archify-motion')`), 'still');
    for (let reload = 0; reload < 5; reload++) {
      await load('architecture', { preserveStorage: true });
      const stored = await run(`({initial:motionStartupPreference,current:localStorage.getItem('archify-motion'),navigation:motionNavigation,url:location.href})`);
      assert.equal((await snapshot('stored-still-' + reload)).mode, 'still', JSON.stringify(stored));
    }
    assert.equal(await run(`Archify.motionGovernor.setMode('live', {persist:false})`), 'live');
    assert.equal(await run(`localStorage.getItem('archify-motion')`), 'still');
    assert.equal(await run('Archify.motionGovernor.resume()'), false);
    assert.equal(await run(`localStorage.getItem('archify-motion')`), null);
    await media(true);
    await run('motionWait(() => document.getElementById("btn-motion").disabled)');
    assert.equal(await run('Archify.motionGovernor.resume()'), false);
    assert.equal((await snapshot('reduced-resume')).mode, 'still');
    await run('window.releaseTest = Archify.motionGovernor.suspend("test")');
    await media(false);
    await run('motionWait(() => !document.getElementById("btn-motion").disabled)');
    assert.equal((await snapshot('suspension-after-media')).mode, 'still');
    assert.equal(await run('releaseTest()'), true);
    assert.equal(await run('releaseTest()'), false);
    assert.equal((await snapshot('released')).mode, 'live');
    assert.equal(await run('Archify.motionGovernor.toggle()'), true);
    assert.equal(await run('Archify.motionGovernor.toggle()'), false);
    await load('architecture', { fixture: `Storage.prototype.getItem = Storage.prototype.setItem = Storage.prototype.removeItem = function () { throw new Error('storage fixture'); };` });
    assert.equal(await run('Archify.motionGovernor.pause()'), true);
    assert.equal(await run('Archify.motionGovernor.resume()'), false);
    await snapshot('storage-unavailable');
  });

  await t.test('claims preempt cleanup, normal release does not, and SVG owners fall back automatically', async () => {
    await load();
    await run(`window.main = document.querySelector('.diagram-container > svg'); main.setAttribute('data-focus-active','true'); main.setAttribute('data-route-active','true');`);
    await run(`motionWait(() => Archify.motionGovernor.owner() === 'route')`);
    assert.equal((await snapshot('derived-route')).rootOwner, 'route');
    const claims = await run(`(() => {
      const m=Archify.motionGovernor, events=[];
      const a=m.claim('story',()=>events.push('A'));
      const b=m.claim('story',()=>{ events.push('B'); throw new Error('cleanup fixture'); });
      const stale=m.release(a), ownerAfterStale=m.owner();
      const c=m.claim('handoff',()=>events.push('C'));
      const released=m.release(c), repeated=m.release(c);
      return {events,stale,ownerAfterStale,released,repeated,increasing:a<b&&b<c,owner:m.owner(),empty:m.claim('')};
    })()`);
    assert.deepEqual(claims, { events:['A','B'], stale:false, ownerAfterStale:'story', released:true, repeated:false, increasing:true, owner:'route', empty:0 });
    await run(`main.removeAttribute('data-route-active')`);
    await run(`motionWait(() => Archify.motionGovernor.owner() === 'focus')`);
    const focus = await snapshot('derived-focus'); assert.equal(focus.rootOwner, 'focus'); assert.match(focus.aria, /focus/i);
    await run(`main.removeAttribute('data-focus-active')`);
    await run(`motionWait(() => Archify.motionGovernor.owner() === '')`);
    assert.equal((await snapshot('derived-empty')).rootOwner, null);
  });

  await t.test('counted suspensions and the existing visibility-key interaction remain distinct', async () => {
    await load();
    const values = await run(`(() => {
      const m=Archify.motionGovernor, a=m.suspend('a'), b=m.suspend('a'), c=m.suspend('c');
      const first=[c(),m.isPaused(),b(),m.isPaused(),b(),a(),m.isPaused()];
      const releaseVisibility=m.suspend('visibility');
      Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange'));
      const hidden=m.mode();
      Object.defineProperty(document,'hidden',{configurable:true,value:false}); document.dispatchEvent(new Event('visibilitychange'));
      const shown=m.mode(),released=releaseVisibility(); delete document.hidden;
      return {first,hidden,shown,released,hiddenAttr:document.documentElement.getAttribute('data-document-hidden')};
    })()`);
    assert.deepEqual(values, {first:[true,true,true,true,false,true,false],hidden:'still',shown:'live',released:true,hiddenAttr:null});
    await snapshot('visibility-key-fixture');
  });

  await t.test('ambient cancellation, empty targets and optional platform interfaces keep their fallback', async () => {
    await load();
    const cancelled = await run(`(() => {
      const root=document.documentElement, svg=document.querySelector('.diagram-container > svg');
      const before=root.getAttribute('data-ambient-motion');
      svg.dispatchEvent(new Event('animationcancel',{bubbles:true}));
      const ignored=root.getAttribute('data-ambient-motion');
      svg.querySelectorAll('[data-animate="edge"], [data-animate="node"]').forEach(e=>e.dispatchEvent(new Event('animationcancel',{bubbles:true})));
      return {before,ignored,after:root.getAttribute('data-ambient-motion'),reason:root.getAttribute('data-ambient-settle-reason')};
    })()`);
    assert.deepEqual(cancelled, {before:'running',ignored:'running',after:'settled',reason:'complete'});
    await load('architecture', { fixture: `const query = Element.prototype.querySelectorAll; Element.prototype.querySelectorAll = function (s) { return s === '[data-animate="edge"], [data-animate="node"]' ? [] : query.call(this,s); };` });
    assert.equal((await snapshot('empty-target-fixture')).reason, 'empty');
    for (const [name, fixture] of [
      ['no-media', 'window.matchMedia = undefined;'],
      ['legacy-media', `const nativeMatch=window.matchMedia.bind(window); window.matchMedia=q=>{const m=nativeMatch(q); m.addEventListener=undefined; return m;};`],
      ['no-observer', 'window.MutationObserver = undefined;'],
    ]) {
      await load('architecture', { fixture });
      assert.equal(await run('Archify.motionGovernor.pause()'), true);
      assert.equal((await snapshot(name)).mode, 'still');
      if (name === 'legacy-media') {
        await run('Archify.motionGovernor.resume()'); await media(true);
        await run('motionWait(() => document.getElementById("btn-motion").disabled)');
        assert.equal((await snapshot('legacy-media-changed')).mode, 'still');
      }
    }
    for (const query of ['&embed=1', '&play=1']) {
      await load('architecture', { query });
      // Share playback sets its root flag after Governor initialization.
      await run(`motionWait(() => document.documentElement.getAttribute('data-ambient-settle-reason') === 'suppressed')`);
      assert.equal((await snapshot('suppressed-' + query)).ambient, 'settled');
    }
    await load('architecture', { fixture: `Object.defineProperty(document,'hidden',{configurable:true,value:true});` });
    assert.equal((await snapshot('initial-hidden-fixture')).mode, 'still');
  });

  await t.test('Motion pauses actual Story, handoff and Route without discarding elapsed dwell', async () => {
    await load();
    await run(`Archify.guidedViews.activate('request-path'); motionWait(() => !Archify.guidedViews.handoff())`);
    assert.equal(await run('Archify.guidedViews.play()'), true);
    assert.equal(await run('Archify.guidedViews.isPlaying()'), true);
    await run('Archify.motionGovernor.pause()');
    assert.equal(await run('Archify.guidedViews.isPlaying()'), false);
    await run('Archify.motionGovernor.resume()');
    assert.equal(await run('Archify.guidedViews.isPlaying()'), false);
    await load();
    await run(`Archify.guidedViews.activate('request-path'); motionWait(() => !Archify.guidedViews.handoff())`);
    const handoff = await run(`(() => {
      Archify.guidedViews.activate('identity-and-cache');
      const before=Archify.guidedViews.handoff(); Archify.motionGovernor.pause();
      return {before:!!before,after:Archify.guidedViews.handoff()};
    })()`);
    assert.deepEqual(handoff, {before:true,after:null});
    await load();
    const route = await run(`(async () => {
      Archify.routeProbe.begin({source:'users'}); Archify.routeProbe.choose('db');
      const schedule=window.setTimeout, delays=[];
      window.setTimeout=function(callback,delay,...args){ delays.push(delay); return schedule(callback,delay,...args); };
      const started=Archify.routeProbe.playJourney();
      await new Promise(resolve=>schedule(resolve,180));
      const before=Archify.routeProbe.result(), pauses=[], pause=Archify.routeProbe.pauseJourney;
      Archify.routeProbe.pauseJourney=function(options){pauses.push(options); return pause(options);};
      Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange'));
      const paused=Archify.routeProbe.result();
      Object.defineProperty(document,'hidden',{configurable:true,value:false}); document.dispatchEvent(new Event('visibilitychange'));
      const autoResumed=Archify.routeProbe.isJourneyPlaying();
      delays.length=0; const resumed=Archify.routeProbe.playJourney();
      const remaining=delays.at(-1); window.setTimeout=schedule; delete document.hidden;
      Archify.routeProbe.pauseJourney=pause; pause();
      return {started,before,paused,autoResumed,resumed,remaining,pauses};
    })()`);
    assert.equal(route.started, true); assert.equal(route.before.playing, true); assert.equal(route.paused.playing, false);
    assert.equal(route.paused.journey, route.before.journey); assert.equal(route.autoResumed, false); assert.equal(route.resumed, true);
    assert.ok(route.pauses.some(options => options.preserveElapsed === true && options.reason === 'hidden'));
    assert.ok(route.remaining > 0 && route.remaining < 1000, JSON.stringify(route));
    await snapshot('route-hidden-pause');
  });

  await t.test('dark and light modes expose the same controls and computed Still state', async () => {
    for (const theme of ['dark', 'light']) {
      await load('architecture', { theme });
      await run(`motionWait(() => document.documentElement.getAttribute('data-ambient-motion') === 'settled')`);
      const live = await snapshot('live-' + theme); assert.equal(live.pressed, 'true');
      await screenshot('live-' + theme);
      await run(`document.getElementById('btn-motion').click()`);
      const still = await snapshot('still-' + theme); assert.equal(still.mode, 'still'); assert.equal(still.pressed, 'false');
      assert.match(still.aria, /resume/i);
      assert.equal(await run(`getComputedStyle(document.querySelector('.pulse-dot')).animationName`), 'none');
      await screenshot('still-' + theme);
      await run(`Archify.focus.set('api', {toggle:false}); motionWait(() => Archify.motionGovernor.owner() === 'focus')`);
      const exported = await run(`(async () => {
        const svg=document.querySelector('.diagram-container > svg'), m=Archify.motionGovernor;
        const before={svg:svg.outerHTML,mode:m.mode(),owner:m.owner()}, original=URL.createObjectURL;
        let blob, serialized;
        URL.createObjectURL=function(value){if(value.type.startsWith('image/svg+xml'))blob=value;return original.call(URL,value);};
        // Capture serialization synchronously; the later download click can
        // reach the existing outside-click Focus handler.
        try {
          const pending=Archify.exportMenu.run('svg');
          serialized={svg:svg.outerHTML,mode:m.mode(),owner:m.owner()};
          await pending;
        } finally { URL.createObjectURL=original; }
        const text=await blob.text(), root=new DOMParser().parseFromString(text,'image/svg+xml').documentElement;
        return {unchanged:before.svg===serialized.svg&&before.mode===serialized.mode&&before.owner===serialized.owner,
          modeUnchanged:before.mode===m.mode(),
          clean:!root.querySelector('[data-focus-selected], [data-radar-node-id]')&&!root.hasAttribute('data-focus-active'),
          geometry:root.getAttribute('viewBox')===svg.getAttribute('viewBox')};
      })()`);
      assert.deepEqual(exported, {unchanged:true,modeUnchanged:true,clean:true,geometry:true});
      await snapshot('export-' + theme);

    }
  });
});
