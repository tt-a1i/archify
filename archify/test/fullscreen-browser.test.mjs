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

test('diagram fullscreen uses native state and preserves viewer contracts', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser fullscreen checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-fullscreen-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const files = {};
  for (const [mode, example] of Object.entries(cases)) {
    const input = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
    if (mode === 'workflow') input.meta.locale = 'zh-CN';
    const source = path.join(scratch, `${mode}.json`);
    files[mode] = path.join(scratch, `${mode}.html`);
    fs.writeFileSync(source, JSON.stringify(input));
    execFileSync(process.execPath, [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), source, files[mode]]);
  }
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.fullscreenErrors = [];
    addEventListener('error', e => fullscreenErrors.push(e.message));
    addEventListener('unhandledrejection', e => fullscreenErrors.push(String(e.reason)));
    window.fullscreenWait = predicate => new Promise((resolve, reject) => {
      const start = performance.now();
      function poll() {
        if (predicate()) return resolve();
        if (performance.now() - start > 10000) return reject(new Error('Fullscreen observation timed out'));
        setTimeout(poll, 20);
      }
      poll();
    });
    if (new URL(location.href).searchParams.has('unsupported')) {
      Object.defineProperty(document, 'fullscreenEnabled', { value: false });
    }
    window.fullscreenBlobs = new Map();
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); fullscreenBlobs.set(url, blob); return url; };
    HTMLAnchorElement.prototype.click = function () { window.fullscreenExport = fullscreenBlobs.get(this.href); };
  ` });
  async function stable() {
    await run(`(async () => {
      await document.fonts.ready;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      await Archify.readerLayout.whenStable();
      await Archify.viewerChromeLayout.whenStable();
    })()`);
  }
  async function load(mode, query = '') {
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(files[mode]).href + query });
    await loaded;
    await stable();
  }
  async function click(selector) {
    const point = await run(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function enter() {
    await click('#btn-fullscreen');
    await run(`fullscreenWait(() => document.fullscreenElement === document.querySelector('.diagram-container') && document.getElementById('btn-fullscreen').getAttribute('aria-pressed') === 'true')`);
    await stable();
  }
  async function exited() {
    await run(`fullscreenWait(() => !document.fullscreenElement && document.getElementById('btn-fullscreen').getAttribute('aria-pressed') === 'false')`);
    await stable();
  }

  await t.test('all five modes fill the viewport with reachable controls and unchanged exports', async () => {
    for (const mode of Object.keys(cases)) {
      await load(mode, mode === 'workflow' ? '?theme=light' : '?theme=dark');
      const url = await run('location.href');
      const label = await run(`document.getElementById('btn-fullscreen').getAttribute('aria-label')`);
      assert.equal(label, mode === 'workflow' ? '全屏显示图表' : 'Show diagram fullscreen');
      const before = await run(`(async () => { await Archify.exportMenu.run('svg'); return fullscreenExport.text(); })()`);
      await enter();
      const layout = await run(`(() => {
        const container = document.querySelector('.diagram-container');
        const box = container.getBoundingClientRect();
        const nav = container.querySelector('.diagram-nav').getBoundingClientRect();
        const svg = container.querySelector(':scope > svg').getBoundingClientRect();
        return { fills: box.x === 0 && box.y === 0 && box.width === innerWidth && box.height === innerHeight,
          controls: nav.left >= 0 && nav.right <= innerWidth && nav.top >= 0 && nav.bottom <= innerHeight,
          clearance: svg.bottom <= nav.top, pressed: document.getElementById('btn-fullscreen').getAttribute('aria-pressed') };
      })()`);
      assert.deepEqual(layout, { fills: true, controls: true, clearance: true, pressed: 'true' }, mode);
      await click('[data-view="in"]');
      assert.ok(await run('Archify.view.state().scale > 1'), mode);
      const during = await run(`(async () => { await Archify.exportMenu.run('svg'); return fullscreenExport.text(); })()`);
      assert.equal(during, before, `${mode}: canonical SVG bytes`);
      await click('#btn-fullscreen');
      await exited();
      assert.equal(await run('location.href'), url, `${mode}: no presentation URL changes`);
      assert.equal(await run('document.activeElement.id'), 'btn-fullscreen', mode);
      assert.equal(await run(`document.getElementById('btn-fullscreen').getAttribute('aria-label')`), label);
      assert.deepEqual(await run('fullscreenErrors'), [], mode);
    }
  });

  await t.test('browser-driven exit and existing presentation state are respected', async () => {
    await load('architecture', '?present=1#view=all');
    const url = await run('location.href');
    await enter();
    // Browser Escape and browser chrome use this same native fullscreenchange path.
    await run('document.exitFullscreen()');
    await exited();
    assert.equal(await run('Archify.presentation.active()'), true);
    assert.equal(await run('location.href'), url);
  });

  await t.test('unsupported and embedded readers keep existing presentation behavior', async () => {
    await load('architecture', '?unsupported=1');
    assert.equal(await run(`document.getElementById('btn-fullscreen').hidden`), true);
    await run('Archify.presentation.enter()');
    assert.equal(await run('Archify.presentation.active()'), true);
    await load('architecture', '?embed=1');
    assert.equal(await run(`document.getElementById('btn-fullscreen').getClientRects().length`), 0);
  });

  await t.test('resize, pan and printing retain a usable diagram and restore the page', async () => {
    await load('workflow');
    await run('window.scrollTo(0, document.body.scrollHeight)');
    // Match the visible button position before recording the return position.
    await run(`document.getElementById('btn-fullscreen').scrollIntoView({ block: 'nearest' })`);
    const scroll = await run('({ x: scrollX, y: scrollY })');
    await enter();
    await send('Emulation.setDeviceMetricsOverride', { width: 900, height: 650, deviceScaleFactor: 1, mobile: false });
    await stable();
    assert.equal(await run(`document.querySelector('.diagram-container').getBoundingClientRect().width`), 900);
    await click('[data-view="in"]');
    const initial = await run('Archify.view.state()');
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 40, y: 40, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20, y: 20, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 20, y: 20, button: 'left', clickCount: 1 });
    assert.notDeepEqual(await run('Archify.view.state()'), initial);
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    assert.equal(await run(`getComputedStyle(document.querySelector('.diagram-nav')).display`), 'none');
    await send('Emulation.setEmulatedMedia', { media: '' });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await stable();
    await click('#btn-fullscreen');
    await exited();
    assert.deepEqual(await run('({ x: scrollX, y: scrollY })'), scroll);
    assert.deepEqual(await run('fullscreenErrors'), []);
  });

  await t.test('permission rejection is announced and a subsequent attempt can succeed', async () => {
    await load('architecture');
    await run(`window.nativeFullscreen = Element.prototype.requestFullscreen;
      Element.prototype.requestFullscreen = () => Promise.reject(new Error('Denied'));`);
    await click('#btn-fullscreen');
    await run(`fullscreenWait(() => !document.getElementById('fullscreen-status').hidden)`);
    assert.equal(await run('document.fullscreenElement'), null);
    assert.equal(await run(`document.getElementById('btn-fullscreen').getAttribute('aria-pressed')`), 'false');
    assert.match(await run(`document.getElementById('fullscreen-status').textContent`), /presentation/);
    await run('Element.prototype.requestFullscreen = nativeFullscreen');
    await enter();
    assert.equal(await run(`document.getElementById('fullscreen-status').hidden`), true);
    await click('#btn-fullscreen');
    await exited();
    assert.deepEqual(await run('fullscreenErrors'), []);
  });

  await t.test('rejected exit keeps fullscreen state and announces the attempted transition', async () => {
    for (const mode of ['architecture', 'workflow']) {
      await load(mode);
      await enter();
      await run(`window.nativeExitFullscreen = document.exitFullscreen;
        document.exitFullscreen = () => Promise.reject(new Error('Exit denied'));`);
      await click('#btn-fullscreen');
      await run(`fullscreenWait(() => !document.getElementById('fullscreen-status').hidden)`);
      assert.equal(await run(`document.fullscreenElement === document.querySelector('.diagram-container')`), true);
      assert.equal(await run(`document.getElementById('btn-fullscreen').getAttribute('aria-pressed')`), 'true');
      assert.equal(await run(`document.getElementById('fullscreen-status').textContent`), mode === 'workflow'
        ? '退出全屏失败，请重试或按 Esc。'
        : 'Could not exit fullscreen. Try again or press Esc.');
      await run('document.exitFullscreen = nativeExitFullscreen');
      await click('#btn-fullscreen');
      await exited();
      assert.equal(await run(`document.getElementById('fullscreen-status').hidden`), true);
      assert.deepEqual(await run('fullscreenErrors'), []);
    }
  });
});
