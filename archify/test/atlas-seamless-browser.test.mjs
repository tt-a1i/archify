import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { findChrome } from '../bin/visual-check.mjs';
import { desktopBrowser } from './helpers/desktop-browser.mjs';
import { createSeamlessFixture } from './helpers/seamless-atlas-fixture.mjs';
import { collectProcessEvidence } from './helpers/seamless-process-evidence.mjs';
import { assertProcessFrames, assertCommittedGeometry, assertStableChrome } from './helpers/seamless-process-assertions.mjs';

// This suite launches an actual browser ONLY with an explicit executable.
// On macOS run it outside the sandbox through the normal approval path. It is
// never an alternative route to content rejected by a browser URL policy.
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
if (process.env.ARCHIFY_CHROME && !chrome) throw new Error('ARCHIFY_CHROME must name an executable browser; an invalid explicit path is not a skipped acceptance run.');
const active = 'document.querySelector("iframe[data-atlas-state=active]")?.contentWindow';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function installProcessProbe(forceStill = true) {
  const nativeRaf = requestAnimationFrame.bind(window);
  const listeners = new Map();
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (type, callback, options) {
    if (callback) {
      let registrations = listeners.get(this);
      if (!registrations) listeners.set(this, registrations = []);
      const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
      if (!registrations.some(item => item.type === type && item.callback === callback && item.capture === capture)) registrations.push({ type, callback, capture });
    }
    return add.call(this, type, callback, options);
  };
  EventTarget.prototype.removeEventListener = function (type, callback, options) {
    const registrations = listeners.get(this);
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const index = registrations?.findIndex(item => item.type === type && item.callback === callback && item.capture === capture);
    if (index >= 0) registrations.splice(index, 1);
    return remove.call(this, type, callback, options);
  };
  const timers = new Set();
  const intervals = new Set();
  const nativeTimeout = setTimeout.bind(window);
  const nativeClearTimeout = clearTimeout.bind(window);
  const nativeInterval = setInterval.bind(window);
  const nativeClearInterval = clearInterval.bind(window);
  window.setTimeout = (callback, delay, ...args) => {
    let id;
    id = nativeTimeout(() => { timers.delete(id); typeof callback === 'function' ? callback(...args) : window.eval(callback); }, delay);
    timers.add(id); return id;
  };
  window.clearTimeout = id => { timers.delete(id); return nativeClearTimeout(id); };
  window.setInterval = (...args) => { const id = nativeInterval(...args); intervals.add(id); return id; };
  window.clearInterval = id => { intervals.delete(id); return nativeClearInterval(id); };
  const errors = [];
  const recordError = message => {
    errors.push(message);
    if (parent !== window) parent.__atlasProcessProbe?.errors.push(message);
  };
  add.call(window, 'error', event => recordError(event.message));
  add.call(window, 'unhandledrejection', event => recordError(String(event.reason)));
  const resources = () => ({ listeners: [...listeners.values()].reduce((sum, list) => sum + list.length, 0), timers: timers.size, intervals: intervals.size });
  window.__atlasProcessProbe = { errors, resources };
  const still = () => {
    if (document.documentElement) document.documentElement.dataset.motion = 'still';
    const style = document.createElement('style');
    style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}';
    (document.head || document.documentElement).append(style);
  };
  if (forceStill) add.call(document, 'DOMContentLoaded', still, { once: true });
  if (parent !== window) {
    add.call(window, 'message', event => {
      if (event.data?.archifyAtlas !== 1 || event.data.type !== 'init') return;
      window.__atlasProcessProbe.entryId = event.data.entryId;
      const diagram = new URLSearchParams(new URL(event.data.href).hash.slice(1)).get('diagram');
      if (parent.__atlasProcessProbe?.faults?.[diagram] === 'init-error') {
        Object.defineProperty(document.fonts, 'ready', { configurable: true,
          get: () => Promise.reject(new Error(`Injected initialization failure: ${diagram}`)) });
      }
    }, true);
    return;
  }
  const probe = window.__atlasProcessProbe;
  Object.assign(probe, { faults: {}, holds: {}, held: [], frames: [], events: [], recording: true,
    samplingErrors: [], everCommitted: false, intent: { mode: 'cold', at: 0 } });
  const originalIdentities = new Map();
  const frameIds = new WeakMap();
  let nextFrameId = 0;
  const rect = element => {
    if (!element) return null;
    const value = element.getBoundingClientRect();
    return { x: value.x, y: value.y, width: value.width, height: value.height };
  };
  const visible = element => {
    const bounds = element.getBoundingClientRect();
    if (!bounds.width || !bounds.height || element.hidden) return false;
    for (let node = element; node?.nodeType === 1; node = node.parentElement) {
      const style = node.ownerDocument.defaultView.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const identities = { brand: '.atlas-host-brand', directory: '#atlas-directory', search: '#atlas-directory-search', toolbar: '#atlas-toolbar' };
  probe.remember = () => {
    for (const [name, selector] of Object.entries(identities)) originalIdentities.set(name, document.querySelector(selector));
  };
  probe.mark = mode => {
    const recovering = mode === 'explicit' && ['history', 'history-recovery'].includes(probe.intent.mode)
      && ![...document.querySelectorAll('iframe')].some(frame => frame.contentWindow.ArchifyAddress?.active);
    probe.intent = { mode: recovering ? 'history-recovery' : mode, at: performance.now() };
    probe.events.push({ type: 'intent', ...probe.intent });
  };
  probe.sample = () => {
    const frames = [...document.querySelectorAll('iframe')].map(frame => {
      if (!frameIds.has(frame)) frameIds.set(frame, ++nextFrameId);
      const member = frame.contentWindow;
      const graph = member.document.querySelector('.diagram-container');
      return {
        id: frameIds.get(frame), diagram: member.ArchifyAddress?.context?.diagram || null, entryId: member.__atlasProcessProbe?.entryId,
        state: frame.dataset.atlasState, visible: visible(frame), active: member.ArchifyAddress?.active === true,
        ready: Boolean(member.Archify && !member.ArchifyAddress.restoring), inert: frame.inert,
        ariaHidden: frame.getAttribute('aria-hidden'), tabIndex: frame.tabIndex,
        theme: member.document.documentElement?.dataset.theme, preset: member.document.documentElement?.dataset.preset,
        bounds: rect(frame), graph: rect(graph), graphVisible: Boolean(graph && visible(graph)), camera: member.Archify?.view?.snapshot(),
        resources: member.__atlasProcessProbe?.resources(),
        requests: performance.getEntriesByType('resource').concat(member.performance.getEntriesByType('resource')).filter(entry => /^https?:/.test(entry.name)).map(entry => entry.name),
      };
    });
    if (frames.some(frame => frame.active && frame.visible)) probe.everCommitted = true;
    return {
      at: performance.now(), documentTimeOrigin: performance.timeOrigin, href: location.href, historyLength: history.length, entryId: history.state?.entryId,
      theme: document.documentElement?.dataset.theme, viewport: { width: innerWidth, height: innerHeight },
      applicationPresent: Boolean(document.getElementById('archify-atlas-data')), everCommitted: probe.everCommitted,
      intent: { ...probe.intent }, errors: [...errors], samplingErrors: [...probe.samplingErrors],
      frames, current: document.querySelector('#atlas-workbench [data-atlas-diagram][aria-current=page]')?.dataset.atlasDiagram,
      mode: document.getElementById('atlas-workbench')?.dataset.layout,
      error: Boolean(document.getElementById('atlas-error') && visible(document.getElementById('atlas-error'))),
      status: [...document.querySelectorAll('.atlas-host-status,[role=status]')].filter(visible).map(node => node.textContent.trim()).filter(Boolean),
      shell: Object.fromEntries(Object.entries(identities).map(([name, selector]) => {
        const node = document.querySelector(selector);
        return [name, { same: originalIdentities.get(name) === node, present: Boolean(node), bounds: rect(node) }];
      })), resources: resources(),
    };
  };
  probe.release = diagram => {
    delete probe.holds[diagram];
    const held = probe.held.filter(item => item.diagram === diagram);
    probe.held = probe.held.filter(item => item.diagram !== diagram);
    for (const item of held) window.dispatchEvent(new MessageEvent('message', { data: item.data, source: item.source }));
    return held.length;
  };
  add.call(window, 'message', event => {
    const message = event.data;
    if (message?.archifyAtlas !== 1) return;
    const diagram = event.source?.ArchifyAddress?.context?.diagram;
    probe.events.push({ at: performance.now(), type: message.type, diagram, entryId: message.entryId, transaction: message.transaction, message: message.message });
    if (message.type === 'ready' && probe.holds[diagram]) {
      event.stopImmediatePropagation();
      probe.held.push({ diagram, data: message, source: event.source });
    }
  }, true);
  const sample = () => {
    try { if (probe.recording) probe.frames.push(probe.sample()); }
    catch (error) { probe.samplingErrors.push(error.message); }
    finally { nativeRaf(sample); }
  };
  nativeRaf(sample);
}

test('Atlas seamless navigation records actual intermediate frames and validates lifecycle', {
  skip: chrome ? false : 'Not visually verified. Set ARCHIFY_CHROME and run outside the sandbox with approval.',
}, async t => {
  const evidence = process.env.ARCHIFY_ATLAS_EVIDENCE_DIR
    ? path.resolve(process.env.ARCHIFY_ATLAS_EVIDENCE_DIR)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'archify-seamless-evidence-'));
  fs.mkdirSync(evidence, { recursive: true });
  // Deliberately retained, including on test failure, for actual visual review.
  const fixture = createSeamlessFixture(path.join(evidence, 'artifact'));
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  let viewportOperation = Promise.resolve();
  const send = (method, params = {}) => {
    // Chrome screenshot capture temporarily applies/restores viewport metrics.
    // A concurrent resize can otherwise be silently reverted by the capture,
    // manufacturing a resize the reader never requested in the tested page.
    if (method === 'Page.captureScreenshot' || method === 'Emulation.setDeviceMetricsOverride') {
      const result = viewportOperation.then(() => browser.cdp.send(method, params, session));
      viewportOperation = result.catch(() => {});
      return result;
    }
    return browser.cdp.send(method, params, session);
  };
  const browserVersion = await browser.cdp.send('Browser.getVersion');
  const report = { browser: browserVersion, artifact: fixture.provenance, scenarios: [], perceptualReview: 'pending',
    networkRequests: [],
    limitations: 'PNG captures and requestAnimationFrame samples can miss compositor frames. Review the continuous sequences; automated assertions alone do not establish perceptual acceptance.' };
  t.after(() => {
    fs.writeFileSync(path.join(evidence, 'process-evidence.json'), `${JSON.stringify(report, null, 2)}\n`);
    t.diagnostic(`Retained process evidence: ${evidence}; perceptual review remains pending.`);
  });
  const allowedDocuments = new Set();
  const withoutHash = value => { const url = new URL(value); url.hash = ''; return url.href; };
  // PipeCdp.waitFor is one-shot and can miss sibling events in the same chunk.
  // Observe this already-authorized test browser's existing pipe continuously;
  // no second connection, target or browser process is created.
  let networkBuffer = '';
  const networkEvents = chunk => {
    networkBuffer += chunk;
    let boundary;
    while ((boundary = networkBuffer.indexOf('\0')) >= 0) {
      const raw = networkBuffer.slice(0, boundary); networkBuffer = networkBuffer.slice(boundary + 1);
      if (!raw) continue;
      const event = JSON.parse(raw);
      if (event.method !== 'Network.requestWillBeSent' || event.sessionId !== session) continue;
      const request = event.params;
      const url = new URL(request.request.url);
      const localResource = !['http:', 'https:', 'file:'].includes(url.protocol);
      const document = request.type === 'Document' && allowedDocuments.has(withoutHash(url.href));
      const favicon = url.pathname === '/favicon.ico' && [...allowedDocuments].some(value => new URL(value).origin === url.origin);
      report.networkRequests.push({ url: url.href, type: request.type, frameId: request.frameId,
        initiator: request.initiator, timestamp: request.timestamp, allowed: localResource || document || favicon });
    }
  };
  browser.cdp.readPipe.on('data', networkEvents);
  t.after(() => browser.cdp.readPipe.removeListener('data', networkEvents));
  await send('Network.enable');
  async function navigatePage(url) {
    allowedDocuments.add(withoutHash(url));
    return send('Page.navigate', { url });
  }
  let probeScript = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installProcessProbe.toString()})()` });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  const member = expression => run(`${active}.eval(${JSON.stringify(expression)})`);
  async function until(expression, message, timeout = 16000) {
    const deadline = Date.now() + timeout;
    while (!(await run(expression))) {
      assert.ok(Date.now() < deadline, message);
      await pause(25);
    }
  }
  async function ready(diagram) {
    await until(`(${active})?.ArchifyAddress?.active && (${active}).ArchifyAddress.context.diagram === ${JSON.stringify(diagram)} && !document.querySelector('iframe[data-atlas-state=staging]')`, `Did not commit ${diagram}`);
    await member('Promise.all([Archify.readerLayout.whenStable(), Archify.viewerChromeLayout.whenStable()])');
    await member('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  }
  async function open({ width = 1440, height = 900, theme = 'light', hash = 'diagram=system', url = pathToFileURL(fixture.output).href } = {}) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await navigatePage('about:blank');
    await navigatePage(`${url}?theme=${theme}#${hash}`);
    await ready(new URLSearchParams(hash).get('diagram'));
    await run('__atlasProcessProbe.remember()');
  }
  async function click(selector, inMember = false) {
    if (selector === '#atlas-back') await run('__atlasProcessProbe.mark("history")');
    const point = await run(`(() => {
      const owner = ${inMember ? active : 'window'};
      const node = owner.document.querySelector(${JSON.stringify(selector)});
      if (!node) throw new Error('Missing target: ' + ${JSON.stringify(selector)});
      node.scrollIntoView({block:'nearest',inline:'nearest'});
      const box = node.getBoundingClientRect();
      const frame = owner === window ? {x:0,y:0} : owner.frameElement.getBoundingClientRect();
      if (!box.width || !box.height) throw new Error('Hidden target: ' + ${JSON.stringify(selector)});
      return {x:frame.x+box.x+box.width/2,y:frame.y+box.y+box.height/2};
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function directory(diagram) {
    await run('__atlasProcessProbe.mark("explicit")');
    if (await run('document.getElementById("atlas-directory").hidden')) await click('#atlas-directory-toggle');
    await click(`#atlas-workbench [data-atlas-diagram="${diagram}"]`);
  }
  async function traverse(direction) {
    assert.ok(['back', 'forward'].includes(direction));
    await run(`__atlasProcessProbe.mark('history');history.${direction}()`);
  }
  async function record(name, action, options = {}) {
    const location = path.join(evidence, name);
    fs.mkdirSync(location, { recursive: true });
    if (!options.cold) await run('__atlasProcessProbe.frames=[];__atlasProcessProbe.events=[];__atlasProcessProbe.recording=true');
    const data = await collectProcessEvidence({
      directory: location, action,
      read: async () => {
        try {
          return await run(`(() => {
            const probe=window.__atlasProcessProbe;
            const target=${options.targetHref ? `new URL(${JSON.stringify(options.targetHref)})` : 'null'};
            if (!probe || (target && (location.origin!==target.origin || location.pathname!==target.pathname))
              || performance.timeOrigin === ${JSON.stringify(options.excludeTimeOrigin ?? null)}) return {sample:null,frames:[],events:[]};
            return {sample:probe.sample(),frames:probe.frames.splice(0),events:probe.events.splice(0)};
          })()`);
        } catch (error) {
          if (options.cold && /Cannot find context|Execution context was destroyed|Cannot find default execution context/.test(error.message)) {
            return { sample: null, frames: [], events: [{ type: 'document-navigation-gap', message: error.message }] };
          }
          throw error;
        }
      },
      capture: () => send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false }),
      timestamp: () => run('performance.now()'),
    });
    const images = data.images;
    fs.writeFileSync(path.join(location, 'review.html'), `<!doctype html><meta charset="utf-8"><title>${name}: continuous captures</title>
      <style>body{margin:16px;font:14px system-ui;background:#eee;color:#111}img{display:block;max-width:100%;height:auto}input{width:70%}button{margin:8px}output{font-variant-numeric:tabular-nums}</style>
      <p>${name} · 连续采样；自动断言不替代观感审阅。PNG 与逐帧 DOM 采样可能漏掉合成器帧。</p>
      <button id="play">播放 / 暂停</button><input id="seek" type="range" min="0" max="${Math.max(images.length - 1, 0)}" value="0"><output id="position"></output><img id="capture">
      <script>const frames=${JSON.stringify(images)},seek=document.getElementById('seek'),capture=document.getElementById('capture'),position=document.getElementById('position'),play=document.getElementById('play');let running=false,timer;const show=()=>{const frame=frames[Number(seek.value)];if(frame){capture.src=frame.file;position.textContent=seek.value+' / '+(frames.length-1)+' · '+Math.round(frame.before)+'ms · '+frame.visible.join(', ');}};
      seek.oninput=show;play.onclick=()=>{running=!running;clearTimeout(timer);const tick=()=>{if(!running)return;seek.value=(Number(seek.value)+1)%frames.length;show();const next=frames[(Number(seek.value)+1)%frames.length];timer=setTimeout(tick,Math.max(16,next.before-frames[Number(seek.value)].before));};if(running)tick();};show();</script>`);
    if (!data.errors.length) try {
      assert.ok(images.length >= 3, 'Keep continuous PNGs, not only endpoint screenshots');
      assertProcessFrames(data.frames, options);
      if (options.stableChrome) assertStableChrome(data.frames);
      if (options.stableGeometry) assertCommittedGeometry(data.frames);
      if (options.verify) options.verify(data);
    } catch (error) { data.errors.push({ phase: 'verification', error }); }
    const summary = { name, path: location, pngCount: images.length, animationFrameCount: data.frames.length,
      errors: data.errors.map(({ phase, error }) => ({ phase, message: error.message })),
      perceptualReview: 'pending', firstRafAt: data.frames[0]?.at, lastRafAt: data.frames.at(-1)?.at };
    fs.writeFileSync(path.join(location, 'verification.json'), `${JSON.stringify(summary, null, 2)}\n`);
    report.scenarios.push(summary);
    if (data.errors.length) throw new AggregateError(data.errors.map(item => item.error), `${name}: ${summary.errors.map(item => item.message).join('; ')}`);
    return data;
  }

  await t.test('cold light/dark opening records the first document frames before readiness', async () => {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const theme of ['light', 'dark']) {
      await navigatePage('about:blank');
      const previousDocument = await run('performance.timeOrigin');
      const targetHref = `${pathToFileURL(fixture.output).href}?theme=${theme}#diagram=system`;
      await record(`cold-first-frames-${theme}`, async () => {
        await navigatePage(targetHref);
        await ready('system');
        await run('__atlasProcessProbe.remember()');
      }, { cold: true, targetHref, excludeTimeOrigin: previousDocument, expectedTheme: theme, expectedDiagram: 'system', stableGeometry: true,
        verify(data) {
          assert.ok(data.frames.some(frame => !frame.everCommitted), 'Cold recording must include frames preceding the first committed member');
          assert.ok(data.frames.some(frame => frame.everCommitted), 'Cold recording must include the first committed member');
        } });
    }
  });

  await t.test('three levels, reference, return: desktop sizes, breakpoint sides, narrow, both themes', async () => {
    for (const [width, height] of [[1440, 900], [1600, 1000], [1920, 1080], [2048, 1320], [1275, 900], [1293, 900], [760, 1000]]) {
      for (const theme of ['light', 'dark']) {
        await open({ width, height, theme });
        await record(`path-${width}x${height}-${theme}`, async () => {
          await directory('payment'); await ready('payment');
          await directory('worker'); await ready('worker');
          await click('#atlas-back', true); await ready('payment');
          await traverse('back'); await ready('system');
        }, { stableChrome: true, stableGeometry: true });
      }
    }
  });

  await t.test('normal motion preference preserves the same continuous three-level navigation', async () => {
    await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: probeScript.identifier });
    probeScript = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installProcessProbe.toString()})(false)` });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    try {
      for (const theme of ['light', 'dark']) {
        await open({ theme });
        await record(`normal-motion-${theme}`, async () => {
          await directory('payment'); await ready('payment');
          await directory('worker'); await ready('worker');
          await traverse('back'); await ready('payment');
          await traverse('back'); await ready('system');
        }, { stableChrome: true, stableGeometry: true });
      }
    } finally {
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: probeScript.identifier });
      probeScript = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${installProcessProbe.toString()})()` });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    }
  });

  await t.test('Chinese composition and keyboard focus survive an unrelated member navigation', async () => {
    await open();
    await member(`Archify.focus.set('controller',{toggle:false})`);
    await click('#atlas-directory-toggle');
    await run(`window.compositionEvents=[];const search=document.getElementById('atlas-directory-search');
      for(const type of ['compositionstart','compositionupdate','compositionend'])search.addEventListener(type,event=>compositionEvents.push({type:event.type,data:event.data}));`);
    await send('Input.imeSetComposition', { text: '模块', selectionStart: 2, selectionEnd: 2 });
    assert.equal(await run('document.getElementById("atlas-directory-search").value'), '模块');
    assert.equal(await run('compositionEvents[0].type'), 'compositionstart');
    await record('composition-during-navigation', async () => {
      await run('__atlasProcessProbe.mark("explicit")');
      await member(`document.querySelector('[data-atlas-detail=controller]').click()`);
      await ready('payment');
      assert.equal(await run('document.activeElement.id'), 'atlas-directory-search');
      assert.equal(await run('compositionEvents.some(event=>event.type==="compositionend")'), false);
      assert.equal(await run('document.getElementById("atlas-directory-search").value'), '模块');
      await send('Input.insertText', { text: '模块' });
      assert.equal(await run('compositionEvents.filter(event=>event.type==="compositionend").length'), 1);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      assert.equal(await run('document.activeElement.closest("#atlas-workbench")!==null'), true);
      await traverse('back'); await ready('system');
      assert.equal(await run('document.getElementById("atlas-directory-search").value'), '模块');
    });
  });

  await t.test('slow preparation retains the old graph, shared focus and final reading snapshot', async () => {
    await open();
    await member(`Archify.focus.set('controller',{toggle:false});Archify.view.centerAt(500,250,{scale:1.75,instant:true})`);
    await member(`document.querySelector('[data-atlas-tab=sources]').click()`);
    const camera = await member('Archify.view.snapshot()');
    await click('#atlas-directory-toggle');
    await run(`const search=document.getElementById('atlas-directory-search');search.value='模块';search.dispatchEvent(new Event('input',{bubbles:true}));search.focus();search.setSelectionRange(0,1);__atlasProcessProbe.holds.payment=true;`);
    const identity = await run(`({search:document.getElementById('atlas-directory-search').value,selection:[document.getElementById('atlas-directory-search').selectionStart,document.getElementById('atlas-directory-search').selectionEnd],history:history.length})`);
    let intentAt;
    let finalCamera;
    await record('slow-reading-continuity', async () => {
      // An existing in-member navigation while the user is editing the shared
      // directory must not recreate or steal the outer search's current focus.
      intentAt = await run('__atlasProcessProbe.mark("explicit");performance.now()');
      await member(`document.querySelector('[data-atlas-detail=controller]').click()`);
      await until('__atlasProcessProbe.held.some(item=>item.diagram==="payment")', 'Candidate ready was not held');
      await pause(1000);
      assert.match((await run('__atlasProcessProbe.sample().status')).join(' '), /打开|进入|加载/);
      assert.equal(await run('history.length'), identity.history);
      assert.equal(await member('ArchifyAddress.context.diagram'), 'system');
      assert.equal(await run('document.getElementById("btn-export").disabled'), true);
      const staging = await send('Runtime.evaluate', { expression: 'document.querySelector("iframe[data-atlas-state=staging]")' });
      const ax = await send('Accessibility.getPartialAXTree', { objectId: staging.result.objectId, fetchRelatives: false });
      assert.ok(ax.nodes.every(node => node.ignored), 'Staging viewer must be excluded from the accessibility tree');
      await member(`Archify.view.centerAt(520,270,{scale:1.8,instant:true})`);
      finalCamera = await member('Archify.view.snapshot()');
      await run('__atlasProcessProbe.release("payment")'); await ready('payment');
      assert.equal(await run('document.getElementById("atlas-directory-search").value'), identity.search);
      assert.deepEqual(await run('[document.getElementById("atlas-directory-search").selectionStart,document.getElementById("atlas-directory-search").selectionEnd]'), identity.selection);
      assert.equal(await run('document.activeElement.id'), 'atlas-directory-search');
      await traverse('back'); await ready('system');
      const restored = await member('Archify.view.snapshot()');
      for (const field of ['centerX', 'centerY', 'scrollLeft', 'scrollTop', 'scale']) {
        assert.ok(Math.abs(restored[field] - finalCamera[field]) < (field === 'scale' ? .002 : 2), JSON.stringify({ field, camera, finalCamera, restored }));
      }
      assert.equal(await member('Archify.focus.active()'), 'controller');
      assert.equal(await member(`document.querySelector('[data-atlas-tab][aria-selected=true]').dataset.atlasTab`), 'sources');
    }, { verify(data) {
      assert.ok(data.frames.some(frame => frame.frames.some(item => item.state === 'staging')), 'Capture actual preparation frames');
      assert.ok(data.frames.some(frame => frame.at > intentAt && frame.at < intentAt + 280), 'Capture the interval before delayed feedback');
      assert.equal(data.frames.filter(frame => frame.at >= intentAt && frame.at < intentAt + 280).some(frame => frame.status.some(status => /正在打开/.test(status))), false);
      assert.ok(data.frames.some(frame => frame.at >= intentAt + 300 && frame.status.some(status => /正在打开/.test(status))));
    } });
  });

  await t.test('latest intent, repeat coalescing, cancel, late ready, and prepare resize/theme', async () => {
    await open();
    await record('race-cancel-resize-theme', async () => {
      await run('__atlasProcessProbe.holds={payment:true,worker:true,orders:true}');
      const initialHistory = await run('history.length');
      await directory('payment');
      await until('__atlasProcessProbe.held.some(item=>item.diagram==="payment")', 'Payment ready missing');
      const id = await run('__atlasProcessProbe.sample().frames.find(item=>item.state==="staging").id');
      await directory('payment');
      assert.equal(await run('__atlasProcessProbe.sample().frames.find(item=>item.state==="staging").id'), id);
      await directory('system');
      assert.equal(await run('document.querySelectorAll("iframe").length'), 1);
      await run('__atlasProcessProbe.release("payment")');
      assert.equal(await member('ArchifyAddress.context.diagram'), 'system');
      await run('__atlasProcessProbe.holds.payment=true');
      await directory('payment');
      await until('__atlasProcessProbe.held.some(item=>item.diagram==="payment")', 'Late Payment candidate did not reach ready');
      await directory('worker');
      await until('__atlasProcessProbe.held.some(item=>item.diagram==="worker")', 'Late Worker candidate did not reach ready');
      await directory('orders');
      await until('__atlasProcessProbe.held.some(item=>item.diagram==="orders")', 'Orders ready missing');
      await click('#btn-theme');
      await click('#btn-preset');
      await click('#preset-menu [data-preset-value=blueprint]');
      await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
      await run('__atlasProcessProbe.release("payment");__atlasProcessProbe.release("worker");__atlasProcessProbe.release("orders")');
      await ready('orders');
      assert.equal(await run('history.length'), initialHistory + 1);
      assert.equal(await member('document.documentElement.dataset.theme'), 'dark');
      assert.equal(await member('document.documentElement.dataset.preset'), 'blueprint');
      assert.equal(await member('innerWidth'), 1600);
    }, { stableGeometry: true });
  });

  await t.test('explicit initialization failure stays usable; native-history failure retains target URL', async () => {
    await open();
    await record('explicit-initialization-failure', async () => {
      const href = await run('location.href');
      await run('__atlasProcessProbe.faults.payment="init-error"');
      await directory('payment');
      await until('!document.querySelector("iframe[data-atlas-state=staging]")', 'Failed candidate not disposed');
      assert.equal(await run('location.href'), href);
      assert.equal(await member('ArchifyAddress.context.diagram'), 'system');
      assert.equal(await run('document.getElementById("atlas-error").hidden'), false);
      assert.match(await run('document.getElementById("atlas-error").textContent'), /Injected initialization failure: payment/);
      await run('delete __atlasProcessProbe.faults.payment');
      await directory('payment'); await ready('payment');
    }, { allowedErrors: ['Injected initialization failure: payment', 'Error: Injected initialization failure: payment'] });
    await record('native-failure-and-explicit-recovery', async () => {
      await run('__atlasProcessProbe.faults.system="init-error"'); await traverse('back');
      await until('location.hash.includes("diagram=system") && !document.querySelector("iframe[data-atlas-state=staging]")', 'Native failure not settled');
      assert.equal(await run('[...document.querySelectorAll("iframe")].some(frame=>frame.contentWindow.ArchifyAddress.active)'), false);
      assert.equal(await run('document.getElementById("atlas-error").hidden'), false);
      assert.match(await run('document.getElementById("atlas-error").textContent'), /Injected initialization failure: system/);
      assert.match(await run('location.hash'), /diagram=system/);
      await directory('payment'); await ready('payment');
      assert.match(await run('location.hash'), /diagram=payment/);
    }, { allowedErrors: ['Injected initialization failure: payment', 'Error: Injected initialization failure: payment', 'Injected initialization failure: system', 'Error: Injected initialization failure: system'] });
  });

  await t.test('startup timeout keeps the old graph available and permits a fresh choice', async () => {
    await open();
    await record('startup-timeout', async () => {
      const href = await run('location.href');
      await run('__atlasProcessProbe.holds.payment=true');
      await directory('payment');
      await until('__atlasProcessProbe.held.some(item=>item.diagram==="payment")', 'Ready message was not held');
      await until('!document.querySelector("iframe[data-atlas-state=staging]")', 'Startup timeout did not clear candidate', 17000);
      assert.equal(await run('location.href'), href);
      assert.match(await run('document.getElementById("atlas-error").textContent'), /超时|timed out/i);
      assert.equal(await member('ArchifyAddress.active'), true);
      await run('__atlasProcessProbe.release("payment")');
      await directory('orders'); await ready('orders');
    });
  });

  await t.test('a stale preview clicked during native Back becomes a new visit, never a revived session', async () => {
    await open();
    await directory('payment'); await ready('payment');
    await record('native-pending-new-explicit-intent', async () => {
      const old = await run('__atlasProcessProbe.sample().frames[0].id');
      await run('__atlasProcessProbe.holds.system=true'); await traverse('back');
      await until('__atlasProcessProbe.held.some(item=>item.diagram==="system")', 'Native Back did not prepare system');
      assert.equal(await run(`document.querySelector('iframe:not([data-atlas-state=staging])').contentWindow.ArchifyAddress.active`), false);
      await directory('payment'); await ready('payment');
      assert.notEqual(await run('__atlasProcessProbe.sample().frames[0].id'), old);
      await run('__atlasProcessProbe.release("system")');
      assert.equal(await member('ArchifyAddress.context.diagram'), 'payment');
      assert.match(await run('location.hash'), /diagram=payment/);
    });
  });

  await t.test('shared references, valid cold state and refresh keep existing address semantics', async () => {
    await open({ hash: 'diagram=payment&focus=controller&view=request-path' });
    assert.deepEqual(await member('Archify.focus.active()'), ['users', 'cdn', 'lb', 'controller', 'db']);
    assert.equal(await member('Archify.guidedViews.active()'), 'request-path');
    await record('reference-and-forward-history', async () => {
      await member(`Archify.focus.set('redis',{toggle:false})`);
      await member(`new Promise(resolve=>requestAnimationFrame(resolve))`);
      await run('__atlasProcessProbe.mark("explicit")');
      await click('[data-atlas-reference=redis]', true); await ready('system');
      assert.equal(await member('Archify.focus.active()'), 'redis');
      await traverse('back'); await ready('payment');
      await traverse('forward'); await ready('system');
    });
    const targetHref = await run('location.href');
    const previousDocument = await run('performance.timeOrigin');
    await record('refresh-first-frames', async () => {
      allowedDocuments.add(withoutHash(targetHref));
      const reloaded = browser.cdp.waitFor('Page.loadEventFired', session);
      await send('Page.reload'); await reloaded; await ready('system');
      assert.equal(await member('Archify.focus.active()'), 'redis');
    }, { cold: true, targetHref, excludeTimeOrigin: previousDocument, expectedTheme: 'light', expectedDiagram: 'system', stableGeometry: true,
      verify(data) { assert.ok(data.frames.some(frame => !frame.everCommitted), 'Refresh must capture initialization before the first committed member'); } });
    const invalid = `${pathToFileURL(fixture.output).href}?theme=light#diagram=missing-member`;
    await navigatePage(invalid);
    await until('Boolean(document.getElementById("atlas-error") && !document.getElementById("atlas-error").hidden)', 'Invalid cold link must expose an error');
    assert.equal(await run('location.hash'), '#diagram=missing-member');
    assert.equal(await run('document.documentElement.dataset.theme'), 'light');
    assert.equal(await run('[...document.querySelectorAll("iframe")].some(frame=>frame.contentWindow.ArchifyAddress?.active)'), false);
    await directory('system'); await ready('system');
  });

  await t.test('twenty transitions dispose renderers and return live resources to baseline', async () => {
    await open();
    // The first viewer creates the persistent toolbar. Compare equivalent
    // steady visits after this one-time host setup has completed.
    await directory('payment'); await ready('payment');
    await directory('system'); await ready('system');
    const baseline = await run('__atlasProcessProbe.sample()');
    await record('twenty-switches-cleanup', async () => {
      for (let index = 0; index < 10; index++) {
        await directory('payment'); await ready('payment');
        await directory('system'); await ready('system');
      }
      const final = await run('__atlasProcessProbe.sample()');
      assert.equal(final.frames.length, 1);
      assert.equal(final.resources.listeners, baseline.resources.listeners, 'Outer event registrations grew across visits');
      assert.equal(final.frames[0].resources.listeners, baseline.frames[0].resources.listeners, 'Equivalent member event registrations grew');
      assert.equal(final.frames[0].resources.intervals, baseline.frames[0].resources.intervals);
      assert.ok(final.resources.timers <= baseline.resources.timers + 1, 'Retired navigation timers remain live');
      assert.deepEqual(final.frames[0].requests, [], 'Offline graph must not request autonomous HTTP resources');
    });
  });

  await t.test('the exact same final bytes work over local HTTP with no autonomous requests', async () => {
    const requests = [];
    const bytes = fs.readFileSync(fixture.output);
    const server = http.createServer((request, response) => {
      requests.push(request.url);
      if (request.url?.split('?')[0] !== '/seamless.html') { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(bytes);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => server.close(resolve)));
    await open({ url: `http://127.0.0.1:${server.address().port}/seamless.html` });
    await record('http-same-artifact', async () => {
      await directory('payment'); await ready('payment');
      await directory('worker'); await ready('worker');
      await traverse('back'); await ready('payment');
    });
    assert.equal(requests.filter(url => !url.startsWith('/seamless.html') && url !== '/favicon.ico').length, 0);
  });
  await t.test('all members, including retired viewers, make no autonomous network requests', () => {
    assert.deepEqual(report.networkRequests.filter(request => !request.allowed), []);
  });
});
