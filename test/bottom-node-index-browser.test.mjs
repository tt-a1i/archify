import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { createViewerClick } from './helpers/viewer-click.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = path.join(root, 'archify');
const chromeConfigured = Object.prototype.hasOwnProperty.call(process.env, 'ARCHIFY_CHROME');
const chrome = chromeConfigured ? findChrome() : null;
if (chromeConfigured && !chrome) throw new Error(`ARCHIFY_CHROME does not resolve to an executable browser: ${process.env.ARCHIFY_CHROME}`);

test('Bottom node index preserves readable rows and native Viewer interaction', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run the real-browser bottom-index check.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-bottom-index-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidence = process.env.ARCHIFY_BOTTOM_INDEX_EVIDENCE;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  const artifact = path.join(scratch, 'architecture.html');
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(skillRoot, 'examples/web-app.architecture.json'), artifact]);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  const click = await createViewerClick({ send, run, timeout: 10000 });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(artifact).href + '?theme=dark' });
  await loaded;
  await run('document.fonts.ready.then(() => Archify.readerLayout.whenStable())');
  const initialRail = await run('document.documentElement.getAttribute("data-reader-rail")');
  assert.ok(['true', 'bottom'].includes(initialRail));

  // Persisted viewer preferences may already select the bottom rail. First
  // return to the ordinary side rail, then exercise the shipped toggle path.
  if (initialRail === 'bottom') {
    await click('#rail-placement');
    await run('Archify.readerLayout.whenStable()');
  }
  assert.equal(await run('document.documentElement.getAttribute("data-reader-rail")'), 'true');
  await click('#rail-placement');
  await run('Archify.readerLayout.whenStable()');
  const bottom = await run(`(() => {
    const item = document.querySelector('[data-outline-node]');
    const name = item.querySelector('strong');
    const description = item.querySelector('small');
    return {
      rail: document.documentElement.getAttribute('data-reader-rail'),
      fontSize: getComputedStyle(name).fontSize,
      nameWhiteSpace: getComputedStyle(name).whiteSpace,
      descriptionWhiteSpace: getComputedStyle(description).whiteSpace,
      nameOverflowWrap: getComputedStyle(name).overflowWrap,
      groupDisplay: getComputedStyle(item.closest('.node-outline-group').querySelector(':scope > ul')).display,
      itemId: item.dataset.outlineNode,
    };
  })()`);
  assert.equal(bottom.rail, 'bottom');
  assert.equal(bottom.fontSize, '13px');
  assert.equal(bottom.nameWhiteSpace, 'normal');
  assert.equal(bottom.descriptionWhiteSpace, 'normal');
  assert.equal(bottom.nameOverflowWrap, 'anywhere');
  assert.equal(bottom.groupDisplay, 'flex');
  async function assertFirstLineAlignment() {
    const items = await run(`(() => [...document.querySelectorAll('[data-outline-node]')].map(item => {
      const firstLine = element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return [...range.getClientRects()];
      };
      const lines = firstLine(item.querySelector('strong'));
      const name = lines[0];
      const dot = item.querySelector('.node-outline-dot').getBoundingClientRect();
      const small = item.querySelector('small');
      const description = small && firstLine(small)[0];
      const center = rect => rect.top + rect.height / 2;
      return {
        id: item.dataset.outlineNode,
        nameLines: lines.length,
        hasDescription: !!small,
        dotOffset: center(dot) - center(name),
        descriptionOffset: description ? center(description) - center(name) : 0,
      };
    }))()`);
    for (const item of items) {
      // Different font sizes have slightly different optical centers. The
      // swatch must still sit beside the first line, even when text wraps.
      assert.ok(Math.abs(item.dotOffset) <= 2, `${item.id}: swatch misses the first text line (${item.dotOffset}px)`);
      assert.ok(Math.abs(item.descriptionOffset) <= 2, `${item.id}: description misses the first text line`);
    }
    return items;
  }
  await assertFirstLineAlignment();
  if (evidence) {
    const capture = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(evidence, 'sample-web-app-1440-dark-integrated.png'), Buffer.from(capture.data, 'base64'));
  }

  async function key(key, code, windowsVirtualKeyCode) {
    const text = key === 'Enter' ? '\r' : undefined;
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text, unmodifiedText: text,
      windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  }
  // The placement control stays before the index in tab order. This makes Tab
  // exercise the browser's native focus navigation rather than a DOM shortcut.
  await run('document.getElementById("rail-placement").focus()');
  await key('Tab', 'Tab', 9);
  assert.equal(await run('document.activeElement.hasAttribute("data-outline-node")'), true);
  const selectedId = await run('document.activeElement.dataset.outlineNode');
  await run(`document.activeElement.addEventListener('click', event => {
    document.documentElement.setAttribute('data-bottom-index-enter-trusted', String(event.isTrusted));
  }, { once: true })`);
  await key('Enter', 'Enter', 13);
  await run(`new Promise((resolve, reject) => {
    const start = performance.now();
    (function waitForSelection() {
      if (Archify.focus.active() === ${JSON.stringify(selectedId)}) return resolve();
      if (performance.now() - start > 10000) return reject(new Error('outline selection did not settle'));
      requestAnimationFrame(waitForSelection);
    })();
  })`);
  assert.equal(await run('document.documentElement.getAttribute("data-bottom-index-enter-trusted")'), 'true');
  assert.equal(await run('Archify.focus.active()'), selectedId);
  assert.equal(await run(`document.querySelector('[data-outline-node=${JSON.stringify(selectedId)}]').getAttribute('aria-current')`), 'true');

  const target = '[data-outline-node="api"]';
  await run('Archify.focus.clear()');
  await run(`document.querySelector(${JSON.stringify(target)}).scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await run('Archify.readerLayout.whenStable()');
  await run(`document.querySelector(${JSON.stringify(target)}).addEventListener('pointerenter', event => {
    document.documentElement.setAttribute('data-bottom-index-hover-trusted', String(event.isTrusted));
  }, { once: true })`);
  const point = await run(`(() => { const item = document.querySelector(${JSON.stringify(target)}); const r = item.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, visible: item.checkVisibility() && r.top >= 0 && r.bottom <= innerHeight }; })()`);
  assert.equal(point.visible, true);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
  await run('new Promise(resolve => setTimeout(resolve, 160))');
  assert.equal(await run('document.documentElement.getAttribute("data-bottom-index-hover-trusted")'), 'true');
  assert.equal(await run('document.querySelector(".diagram-container > svg").getAttribute("data-intent-trace-active")'), 'api');

  await click('#rail-placement');
  await run('Archify.readerLayout.whenStable()');
  assert.equal(await run('document.documentElement.getAttribute("data-reader-rail")'), 'true');
  await click('#rail-placement');
  await run('Archify.readerLayout.whenStable()');
  assert.equal(await run('document.documentElement.getAttribute("data-reader-rail")'), 'bottom');
  assert.equal(await run('document.querySelectorAll("[data-outline-node]").length > 0'), true);

  const wrappedInput = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  wrappedInput.components = wrappedInput.components.filter(node => ['users', 'worker'].includes(node.id));
  wrappedInput.boundaries = [];
  wrappedInput.connections = [];
  wrappedInput.components.find(node => node.id === 'users').label = '跨区域订单处理与权限校验服务 / Regional authorization and audit service';
  wrappedInput.components.find(node => node.id === 'users').sublabel = 'Tenant-aware decisions with durable audit records and cross-region recovery';
  wrappedInput.components.find(node => node.id === 'users').pos = [40, 40];
  wrappedInput.components.find(node => node.id === 'users').size = [600, 80];
  wrappedInput.components.find(node => node.id === 'worker').pos = [700, 40];
  delete wrappedInput.components.find(node => node.id === 'worker').sublabel;
  const wrappedPath = path.join(scratch, 'wrapped.json');
  const wrappedArtifact = path.join(scratch, 'wrapped.html');
  fs.writeFileSync(wrappedPath, JSON.stringify(wrappedInput));
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'), wrappedPath, wrappedArtifact]);
  const wrappedLoaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(wrappedArtifact).href + '?theme=light' });
  await wrappedLoaded;
  await run('document.fonts.ready.then(() => Archify.readerLayout.whenStable())');
  if (await run('document.documentElement.getAttribute("data-reader-rail")') === 'true') {
    await click('#rail-placement');
    await run('Archify.readerLayout.whenStable()');
  }
  assert.equal(await run('document.documentElement.getAttribute("data-reader-rail")'), 'bottom');
  const wrappedItems = await assertFirstLineAlignment();
  assert.ok(wrappedItems.find(item => item.id === 'users').nameLines > 1);
  assert.equal(wrappedItems.find(item => item.id === 'worker').hasDescription, false);
});
