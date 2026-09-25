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

test('automatic crossover masks follow live relationship state without becoming semantic edges', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser crossover checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-crossover-state-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const input = path.join(scratch, 'crossing.architecture.json');
  const output = path.join(scratch, 'crossing.architecture.html');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Crossover reader state', output: 'crossing.architecture.html', quality_profile: 'showcase', animation: 'trace',
    },
    components: [
      { id: 'left', type: 'frontend', label: 'Left', pos: [40, 170], size: [80, 60] },
      { id: 'right', type: 'backend', label: 'Right', pos: [480, 170], size: [80, 60] },
      { id: 'top', type: 'database', label: 'Top', pos: [260, 20], size: [80, 60] },
      { id: 'bottom', type: 'external', label: 'Bottom', pos: [260, 320], size: [80, 60] },
    ],
    connections: [
      { id: 'horizontal', from: 'left', to: 'right', fromSide: 'right', toSide: 'left' },
      { id: 'vertical', from: 'top', to: 'bottom', fromSide: 'bottom', toSide: 'top' },
    ],
  }));
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'), input, output]);

  const rendered = fs.readFileSync(output, 'utf8');
  const svgMarkup = rendered.match(/<svg\b[\s\S]*?<\/svg>/i)?.[0] || '';
  assert.equal((svgMarkup.match(/data-graph-role="automatic-crossover"/g) || []).length, 2);
  assert.equal((svgMarkup.match(/data-graph-role="automatic-crossover-underlay"/g) || []).length, 2);
  assert.equal((svgMarkup.match(/data-edge-from=/g) || []).length, 2);
  assert.doesNotMatch(svgMarkup, /automatic-crossover-underlay"[^>]*data-edge-/);

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
  async function load() {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(output).href });
    await loaded;
    await run('(async () => { await document.fonts.ready; await Archify.viewerChromeLayout.whenStable(); })()', true);
  }
  async function pairedOpacity() {
    return run(`(() => [...document.querySelectorAll('[data-graph-role="automatic-crossover"]')].map(wrapper => {
      const edge = wrapper.querySelector('[data-edge-from]');
      const underlay = wrapper.querySelector('[data-graph-role="automatic-crossover-underlay"]');
      return { id: edge.getAttribute('data-edge-id'), wrapper: Number(getComputedStyle(wrapper).opacity), edge: Number(getComputedStyle(edge).opacity), underlay: Number(getComputedStyle(underlay).opacity),
        matched: edge.hasAttribute('data-focus-match'), preview: edge.hasAttribute('data-relationship-preview') };
    }))()`);
  }
  function assertPaired(state, expected = {}) {
    for (const relation of state) {
      assert.equal(relation.wrapper, 1, JSON.stringify(relation));
      assert.equal(relation.underlay, relation.edge, JSON.stringify(relation));
      if (expected[relation.id] != null) assert.equal(relation.edge, expected[relation.id], JSON.stringify(relation));
    }
  }
  async function samplePairs(frames) {
    return run(`new Promise(resolve => {
      const samples = [];
      function read() {
        return [...document.querySelectorAll('[data-graph-role="automatic-crossover"]')].map(wrapper => {
          const edge = wrapper.querySelector('[data-edge-from]');
          const underlay = wrapper.querySelector('[data-graph-role="automatic-crossover-underlay"]');
          return {
            id: edge.getAttribute('data-edge-id'),
            edge: Number(getComputedStyle(edge).opacity), underlay: Number(getComputedStyle(underlay).opacity),
            edgeAnimation: getComputedStyle(edge).animationName,
            underlayAnimation: getComputedStyle(underlay).animationName,
            edgeDashoffset: getComputedStyle(edge).strokeDashoffset,
            underlayDashoffset: getComputedStyle(underlay).strokeDashoffset,
            edgeTransition: edge.getAnimations().some(animation => animation.transitionProperty === 'opacity'),
            underlayTransition: underlay.getAnimations().some(animation => animation.transitionProperty === 'opacity'),
          };
        });
      }
      (function sample() {
        samples.push(read());
        if (samples.length >= ${Number(frames)}) return resolve(samples);
        requestAnimationFrame(sample);
      })();
    })`, true);
  }
  function assertTimedPairs(samples) {
    for (const sample of samples) {
      for (const relation of sample) {
        assert.ok(Math.abs(relation.edge - relation.underlay) < 0.002, JSON.stringify(relation));
        assert.equal(relation.edgeAnimation, relation.underlayAnimation, JSON.stringify(relation));
        assert.equal(relation.edgeDashoffset, relation.underlayDashoffset, JSON.stringify(relation));
        assert.equal(relation.edgeTransition, relation.underlayTransition, JSON.stringify(relation));
      }
    }
  }

  await load();
  assert.equal(await run(`CSS.supports('selector(g:has(> path))')`), true);
  const trace = await samplePairs(8);
  assertTimedPairs(trace);
  assert.equal(trace.some((sample) => sample.some((relation) => relation.edgeAnimation === 'archify-edge-flow' && relation.edge < 0.99)), true);
  await run(`new Promise((resolve, reject) => {
    const start = performance.now();
    (function waitForAmbientSettle() {
      if (document.documentElement.getAttribute('data-ambient-motion') === 'settled') return resolve();
      if (performance.now() - start > 6500) return reject(new Error('Ambient trace did not settle'));
      requestAnimationFrame(waitForAmbientSettle);
    })();
  })`, true);
  await run(`Archify.focus.set('left', { toggle: false, updateUrl: false })`);
  const focusTransition = await samplePairs(8);
  assertTimedPairs(focusTransition);
  assert.equal(focusTransition.some((sample) => sample.some((relation) => relation.edgeTransition)), true);
  await run(`new Promise(resolve => setTimeout(resolve, 220))`, true);
  const focus = await pairedOpacity();
  assertPaired(focus, { horizontal: 1, vertical: 0.13 });
  assert.deepEqual(focus.map((relation) => relation.id), ['horizontal', 'vertical']);

  await run(`Archify.focus.inspectRelationshipById('horizontal', { updateUrl: false })`);
  const preview = await pairedOpacity();
  assertPaired(preview, { horizontal: 1, vertical: 0.13 });
  assert.equal(preview.find((relation) => relation.id === 'horizontal').preview, true);

  await load();
  await run(`Archify.routeProbe.begin({ source: 'left', focusNode: false }); Archify.routeProbe.choose('right', { updateUrl: false })`);
  async function shareExport(method) {
    return run(`(async () => {
    const original = URL.createObjectURL;
    let source;
    URL.createObjectURL = value => {
      if (value.type.startsWith('image/svg+xml')) source = value;
      return original.call(URL, value);
    };
    try { await Archify.exportMenu[${JSON.stringify(method)}](); }
    finally { URL.createObjectURL = original; }
    if (!source) throw new Error('Share export did not create its SVG source');
    const text = await source.text();
    const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-9999px;top:0;width:600px;height:400px';
    const renderedRoot = document.importNode(root, true);
    host.appendChild(renderedRoot); document.body.appendChild(host);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rendered = [...renderedRoot.querySelectorAll('[data-graph-role="automatic-crossover"]')].map(wrapper => {
      const edge = wrapper.querySelector('[data-edge-from]');
      const underlay = wrapper.querySelector('[data-graph-role="automatic-crossover-underlay"]');
      return { id: edge.getAttribute('data-edge-id'), edge: Number(getComputedStyle(edge).opacity), underlay: Number(getComputedStyle(underlay).opacity) };
    });
    host.remove();
    return {
      semanticEdges: root.querySelectorAll('[data-edge-from]').length,
      wrappers: root.querySelectorAll('[data-graph-role="automatic-crossover"]').length,
      underlays: root.querySelectorAll('[data-graph-role="automatic-crossover-underlay"]').length,
      style: root.querySelector('style')?.textContent || '',
      rendered,
    };
  })()`, true);
  }
  const exported = await shareExport('downloadRouteShareCard');
  assert.deepEqual({ semanticEdges: exported.semanticEdges, wrappers: exported.wrappers, underlays: exported.underlays },
    { semanticEdges: 2, wrappers: 2, underlays: 2 });
  assert.match(exported.style, /automatic-crossover-underlay/);
  assert.match(exported.style, /data-share-route-match/);
  assert.deepEqual(exported.rendered, [
    { id: 'horizontal', edge: 1, underlay: 1 },
    { id: 'vertical', edge: 0.18, underlay: 0.18 },
  ]);

  await load();
  await run(`Archify.focus.set('left', { toggle: false, updateUrl: false }); Archify.focus.reach('downstream', { toggle: false, updateUrl: false, reveal: false })`);
  const reachExported = await shareExport('downloadReachShareCard');
  assert.deepEqual(reachExported.rendered, [
    { id: 'horizontal', edge: 1, underlay: 1 },
    { id: 'vertical', edge: 0.14, underlay: 0.14 },
  ]);
});
