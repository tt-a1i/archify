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
const cases = {
  architecture: 'web-app.architecture.json', workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json', dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

test('Camera preserves transactions, rendered state and real caller handoffs', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser camera checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-camera-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidence = process.env.ARCHIFY_CAMERA_EVIDENCE;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  const records = [];
  t.after(() => {
    if (evidence) fs.writeFileSync(path.join(evidence, 'observations.json'), JSON.stringify(records, null, 2) + '\n');
  });
  const files = {};
  for (const [mode, example] of Object.entries(cases)) {
    files[mode] = path.join(scratch, `${mode}.html`);
    execFileSync(process.execPath, [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
      path.join(skillRoot, 'examples', example), files[mode]]);
  }
  const trace = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', cases.architecture), 'utf8'));
  trace.meta.animation = 'trace';
  fs.writeFileSync(path.join(scratch, 'trace.json'), JSON.stringify(trace));
  files.trace = path.join(scratch, 'trace.html');
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(scratch, 'trace.json'), files.trace]);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  async function run(expression, awaitPromise = false) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.cameraErrors = [];
    addEventListener('error', e => cameraErrors.push(e.message));
    addEventListener('unhandledrejection', e => cameraErrors.push(String(e.reason)));
    window.cameraWait = predicate => new Promise((resolve, reject) => {
      let frames = 0;
      function sample() {
        if (predicate()) return resolve();
        if (++frames > 300) return reject(new Error('Camera observation did not settle'));
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    });
  ` });
  async function viewport(width = 1440, height = 900) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  }
  async function stable() {
    // Observe automatic camera/layout work without forcing sync or measurement.
    await run(`(async () => {
      await document.fonts.ready;
      let previous = '', equal = 0;
      await cameraWait(() => {
        const container = document.querySelector('.diagram-container');
        const svg = container.querySelector(':scope > svg');
        const rect = svg.getBoundingClientRect();
        const current = JSON.stringify([Archify.view.state(), getComputedStyle(svg).transform,
          svg.style.clipPath, container.scrollLeft, container.getAttribute('data-camera-transaction'),
          container.style.getPropertyValue('--archify-nav-reserve'), rect.x, rect.y, rect.width, rect.height]);
        equal = current === previous ? equal + 1 : 0;
        previous = current;
        return equal >= 8 && !container.hasAttribute('data-camera-transaction');
      });
    })()`, true);
  }
  async function load(mode = 'architecture', { width = 1440, height = 900, theme = 'dark', reduced = false } = {}) {
    await viewport(width, height);
    await send('Emulation.setEmulatedMedia', { media: '', features: [
      { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
    ] });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(files[mode]).href + `?theme=${theme}` });
    await loaded;
    await stable();
  }
  const snapshotExpression = `(() => {
      const c = document.querySelector('.diagram-container'), svg = c.querySelector(':scope > svg');
      const rect = e => { const r = e.getBoundingClientRect(); return [r.x,r.y,r.width,r.height]; };
      return { state: Archify.view.state(), viewport: Archify.view.logicalViewport(),
        transform: getComputedStyle(svg).transform, clip: svg.style.clipPath,
        stage: rect(svg), nav: rect(c.querySelector('.diagram-nav')), scrollLeft: c.scrollLeft,
        reserve: c.style.getPropertyValue('--archify-nav-reserve'),
        transaction: c.getAttribute('data-camera-transaction'),
        mode: c.getAttribute('data-camera-mode'), detail: c.getAttribute('data-detail-level'),
        viewBox: svg.getAttribute('viewBox'), errors: cameraErrors,
        external: performance.getEntriesByType('resource').map(e => e.name).filter(n => /^https?:/.test(n)) };
    })()`;
  async function snapshot(label, captured) {
    const value = captured || await run(snapshotExpression);
    assert.deepEqual(value.errors, [], label);
    assert.deepEqual(value.external, [], label);
    records.push({ label, ...value });
    return value;
  }
  async function screenshot(name) {
    if (!evidence) return;
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(evidence, `${name}.png`), Buffer.from(shot.data, 'base64'));
  }

  await t.test('five modes keep initial state, zoom limits and canonical geometry', async () => {
    for (const mode of Object.keys(cases)) {
      await load(mode);
      const initial = await snapshot(`${mode}-initial`);
      assert.deepEqual(initial.state, { scale: 1, x: 0, y: 0, mode: 'overview' });
      const limits = await run(`(() => {
        const copy = Archify.view.state(); copy.scale = 99;
        const independent = Archify.view.state().scale === 1;
        for (let i = 0; i < 12; i++) Archify.view.zoomIn();
        const max = Archify.view.state().scale;
        for (let i = 0; i < 12; i++) Archify.view.zoomOut();
        return { independent, max, min: Archify.view.state().scale };
      })()`);
      assert.deepEqual(limits, { independent: true, max: 3, min: 1 });
      await stable();
      assert.equal((await snapshot(`${mode}-limits`)).viewBox, initial.viewBox);
    }
  });

  await t.test('pointer cancellation ends dragging and controls do not begin a pan', async () => {
    await load();
    await run('Archify.view.zoomIn()');
    await stable();
    const result = await run(`(() => {
      const c = document.querySelector('.diagram-container'), svg = c.querySelector(':scope > svg');
      const geometry = () => [...svg.querySelectorAll('[data-node-id], [data-edge-id]')].map(n =>
        ['data-node-id','data-edge-id','transform','d','x','y','width','height'].map(a => n.getAttribute(a)));
      const beforeGeometry = JSON.stringify(geometry());
      const pointer = (type, x, y) => new PointerEvent(type, { bubbles: true, pointerId: 31, button: 0, clientX: x, clientY: y });
      const before = Archify.view.state();
      c.querySelector('.diagram-nav').dispatchEvent(pointer('pointerdown', 500, 400));
      c.dispatchEvent(pointer('pointermove', 450, 350));
      const controlExcluded = JSON.stringify(before) === JSON.stringify(Archify.view.state());
      c.dispatchEvent(pointer('pointerdown', 500, 400));
      c.dispatchEvent(pointer('pointermove', 450, 350));
      const dragged = c.classList.contains('is-panning');
      c.dispatchEvent(pointer('pointercancel', 450, 350));
      const cancelled = !c.classList.contains('is-panning');
      const ended = Archify.view.state();
      c.dispatchEvent(pointer('pointermove', 100, 100));
      return { step: before.scale, controlExcluded, dragged, cancelled,
        unchanged: JSON.stringify(ended) === JSON.stringify(Archify.view.state()),
        geometryUnchanged: beforeGeometry === JSON.stringify(geometry()) };
    })()`);
    assert.deepEqual(result, { step: 1.25, controlExcluded: true, dragged: true, cancelled: true, unchanged: true, geometryUnchanged: true });
    await stable();
    await snapshot('pointer-cancel');
  });

  await t.test('target selection, failure branches and instant options preserve their side effects', async () => {
    await load();
    const value = await run(`(async () => {
      const v = Archify.view, node = document.querySelector('[data-node-id="api"]');
      const original = node.getBBox;
      const empty = v.reveal([], { instant: true });
      const unknown = v.reveal(['missing'], { instant: true });
      node.getBBox = () => { throw new Error('test geometry'); };
      const failedBox = v.reveal(['api'], { instant: true });
      node.getBBox = original;
      const mixed = v.reveal(['missing', 'api'], { instant: true, maxScale: 1.5, padding: 64 });
      const mixedResult = await mixed.finished;
      const multi = v.reveal(['api', 'db'], { instant: true, includeNeighbors: true });
      await multi.finished;
      return { empty, unknown, failedBox, mixed: mixedResult.state, scale: mixed.target.scale,
        multi: multi.settled, badCenter: v.centerAt('invalid', 10) };
    })()`, true);
    assert.deepEqual(value, { empty: false, unknown: false, failedBox: false, mixed: 'complete', scale: 1.5, multi: true, badCenter: false });
    await stable();
    await snapshot('targets');
  });

  await t.test('running transactions complete, replace, cancel and yield to manual navigation', async () => {
    for (const theme of ['dark', 'light']) {
      await load('architecture', { theme });
      // Start and observe in one page evaluation: CDP round trips may outlast
      // the animation, so the middle snapshot must be captured in its frame.
      const animation = await run(`(async () => {
        const camera = Archify.view.reveal(['api'], { duration: 520 });
        const samples = [];
        let middle = null;
        function sampleCamera() {
          const svg = document.querySelector('.diagram-container > svg');
          const state = Archify.view.state();
          samples.push({ state, transform: getComputedStyle(svg).transform, clip: svg.style.clipPath, settled: camera.settled });
          if (!middle && !camera.settled && state.scale > 1.15) middle = ${snapshotExpression};
          if (!camera.settled) requestAnimationFrame(sampleCamera);
        }
        requestAnimationFrame(sampleCamera);
        const outcome = await camera.finished;
        return { middle, samples, outcome };
      })()`, true);
      assert.ok(animation.middle, 'the running animation must yield a middle snapshot');
      const middle = await snapshot(`animation-middle-${theme}`, animation.middle);
      assert.ok(middle.state.scale > 1 && middle.state.scale < 2.15);
      assert.equal(animation.outcome.state, 'complete');
      assert.ok(animation.samples.filter(s => !s.settled && s.clip).length > 1);
      if (evidence) fs.writeFileSync(path.join(evidence, `animation-${theme}.json`), JSON.stringify(animation.samples, null, 2));
      await stable();
      await snapshot(`animation-final-${theme}`);
      await screenshot(`animation-final-${theme}`);
    }
    const results = await run(`(async () => {
      const v = Archify.view, results = [];
      for (const action of ['replace', 'cancel', 'commit', 'manual', 'reset']) {
        v.reset({ automatic: true });
        const first = v.reveal(['api'], { duration: 520 });
        await cameraWait(() => !first.settled && v.state().scale > 1.05);
        const before = v.state();
        let second;
        if (action === 'replace') second = v.reveal(['db'], { instant: true });
        else if (action === 'cancel' || action === 'commit') first.cancel('test-stop', action === 'commit');
        else if (action === 'manual') v.zoomOut();
        else v.reset({ automatic: true });
        const outcome = await first.finished;
        const repeated = first.cancel('again', true);
        const ended = v.state();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        results.push({ action, outcome: outcome.state, repeated, settled: first.settled,
          before, ended, target: first.target,
          unchanged: JSON.stringify(ended) === JSON.stringify(v.state()),
          next: second ? (await second.finished).state : null });
      }
      return results;
    })()`, true);
    assert.deepEqual(results.map(r => r.outcome), ['replaced', 'test-stop', 'test-stop', 'manual', 'reset']);
    for (const r of results) {
      assert.equal(r.repeated, false); assert.equal(r.settled, true); assert.equal(r.unchanged, true);
      if (r.action === 'cancel' || r.action === 'commit') {
        assert.notDeepEqual(r.before, r.target, 'cancellation must occur before reaching the target');
        assert.deepEqual(r.ended, r.action === 'commit' ? r.target : r.before, r.action);
      }
    }
    records.push({ label: 'transaction-results', results });
    await stable();
  });

  await t.test('mobile branches, automatic scroll guard and scrollTo fallback stay distinct', async () => {
    for (const width of [719, 720, 721]) {
      await load('architecture', { width });
      const result = await run(`(async () => {
        const receipt = Archify.view.reveal(['db'], { instant: true });
        return { outcome: (await receipt.finished).state, scrollTarget: 'scrollLeft' in receipt.target };
      })()`, true);
      assert.equal(result.scrollTarget, width <= 720);
      await stable();
      await snapshot(`width-${width}`);
    }
    await load('architecture', { width: 720 });
    const value = await run(`(async () => {
      const c = document.querySelector('.diagram-container'), v = Archify.view;
      const empty = v.reveal([]);
      const emptyMode = v.state().mode;
      c.removeAttribute('data-wide-diagram');
      const contained = v.reveal([]);
      const containedOutcome = (await contained.finished).state;
      c.setAttribute('data-wide-diagram', 'true');
      const original = c.scrollTo;
      c.scrollTo = () => { throw new Error('test scroll fallback'); };
      const fallback = v.reveal(['db'], { instant: true });
      await fallback.finished;
      // Even the assignment fallback participates in the container's existing
      // smooth-scroll CSS. Receipt completion alone is not scroll convergence.
      await cameraWait(() => Math.abs(c.scrollLeft - fallback.target.scrollLeft) < 1);
      const reached = Math.abs(c.scrollLeft - fallback.target.scrollLeft) < 1;
      c.scrollTo = original;
      v.reset({ automatic: true });
      const started = Date.now(), moving = v.reveal(['users']);
      c.dispatchEvent(new Event('scroll'));
      const protectedMode = v.state().mode;
      const outcome = await moving.finished;
      await cameraWait(() => Date.now() - started > 500);
      c.dispatchEvent(new Event('scroll'));
      return { empty, emptyMode, containedOutcome, reached, protectedMode, outcome: outcome.state, manualMode: v.state().mode };
    })()`, true);
    assert.deepEqual(value, { empty: false, emptyMode: 'semantic', containedOutcome: 'complete', reached: true,
      protectedMode: 'semantic', outcome: 'complete', manualMode: 'manual' });
    await stable();
    await snapshot('mobile-scroll');
  });

  await t.test('reduced motion and call-time hidden state keep immediate completion semantics', async () => {
    await load('architecture', { theme: 'light', reduced: true });
    assert.equal(await run(`Archify.view.reveal(['api']).finished.then(r => r.state)`, true), 'reduced-motion');
    await stable();
    await snapshot('reduced-motion');
    await load();
    // A local capability fixture exercises the call-time branch. It does not
    // claim to emulate background-tab frame throttling or visibility events.
    const hidden = await run(`(async () => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      try { return (await Archify.view.reveal(['api']).finished).state; }
      finally { delete document.hidden; }
    })()`, true);
    assert.equal(hidden, 'hidden');
    await stable();
    await snapshot('hidden-call-fixture');
  });

  await t.test('actual Story, Route, Finder and Radar callers retain camera ownership', async () => {
    await load('trace');
    const story = await run(`(async () => {
      Archify.motionGovernor.resume();
      Archify.guidedViews.activate('request-path');
      await cameraWait(() => !Archify.guidedViews.handoff());
      Archify.guidedViews.activate('identity-and-cache');
      await cameraWait(() => Archify.guidedViews.handoff()?.mode === 'settling');
      const wasHandoff = !!Archify.guidedViews.handoff();
      Archify.view.zoomIn();
      const cleared = Archify.guidedViews.handoff() === null;
      const played = Archify.guidedViews.play();
      const wasPlaying = Archify.guidedViews.isPlaying();
      Archify.view.zoomOut();
      return { wasHandoff, cleared, played, wasPlaying, paused: !Archify.guidedViews.isPlaying() };
    })()`, true);
    assert.deepEqual(story, { wasHandoff: true, cleared: true, played: true, wasPlaying: true, paused: true });
    await stable();
    await snapshot('story-takeover');
    await load('trace');
    const route = await run(`(() => {
      Archify.motionGovernor.resume();
      Archify.routeProbe.begin({ source: 'users' });
      Archify.routeProbe.choose('db');
      const played = Archify.routeProbe.playJourney();
      const before = Archify.routeProbe.result();
      Archify.view.zoomIn();
      const after = Archify.routeProbe.result();
      return { played, before, after };
    })()`);
    assert.equal(route.played, true); assert.equal(route.before.playing, true); assert.equal(route.after.playing, false);
    assert.deepEqual(route.after.nodes, route.before.nodes);
    assert.equal(route.after.journey, route.before.journey);
    await stable();
    await snapshot('route-takeover');
    await load('architecture', { height: 600 });
    await run(`Archify.finder.select('api')`);
    await stable();
    assert.equal(await run(`Archify.focus.active()`), 'api');
    await snapshot('finder-low-height');
    await run(`window.scrollTo(0, 160); Archify.radar.open(); Archify.radar.focus('db')`);
    await stable();
    assert.equal(await run(`Archify.focus.active()`), 'db');
    await snapshot('radar-focus');
    await viewport(1280, 720);
    await stable();
    await snapshot('automatic-resize');
    await run(`location.hash = 'focus=api'`);
    await run(`cameraWait(() => Archify.focus.active() === 'api')`, true);
    await stable();
    await snapshot('automatic-hashchange');
  });

  await t.test('export removes camera transforms without mutating the live camera', async () => {
    await load();
    await run(`Archify.view.reveal(['api'], { instant: true })`);
    await stable();
    const exported = await run(`(async () => {
      const svg = document.querySelector('.diagram-container > svg'), before = svg.outerHTML;
      const state = JSON.stringify(Archify.view.state()), original = URL.createObjectURL;
      let blob;
      URL.createObjectURL = value => { if (value.type.startsWith('image/svg+xml')) blob = value; return original.call(URL, value); };
      let after;
      try { const pending = Archify.exportMenu.run('svg'); after = svg.outerHTML; await pending; }
      finally { URL.createObjectURL = original; }
      const text = await blob.text();
      const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
      return { text, unchanged: before === after && state === JSON.stringify(Archify.view.state()),
        clean: !root.hasAttribute('data-view-scale') && !root.style.transform && !root.style.clipPath,
        geometry: root.getAttribute('viewBox') === svg.getAttribute('viewBox'),
        ids: [...root.querySelectorAll('[data-node-id]')].map(n => n.getAttribute('data-node-id')).join() === [...svg.querySelectorAll('[data-node-id]')].map(n => n.getAttribute('data-node-id')).join() };
    })()`, true);
    assert.equal(exported.unchanged, true); assert.equal(exported.clean, true); assert.equal(exported.geometry, true); assert.equal(exported.ids, true);
    if (evidence) fs.writeFileSync(path.join(evidence, 'camera-export.svg'), exported.text);
    await snapshot('export');
  });
});
