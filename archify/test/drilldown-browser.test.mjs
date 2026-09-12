import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import { disposeBundleFixture, stageBundleFixture } from './helpers/bundle-fixture.mjs';

const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
const options = { skip: chromePath ? false : 'Set ARCHIFY_CHROME to run drilldown pixel-restore browser smoke.' };

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 800, height: 600 },
];

async function evaluate(browser, expression) {
  const result = await browser.cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  }, await browser.sessionPromise, 30000);
  return result.result?.value;
}

function walkFrames(node, acc = []) {
  acc.push(node.frame);
  for (const child of node.childFrames || []) walkFrames(child, acc);
  return acc;
}

async function evaluateChildFrame(browser, urlPattern, expression) {
  const sessionId = await browser.sessionPromise;
  const tree = await browser.cdp.send('Page.getFrameTree', {}, sessionId);
  const frame = walkFrames(tree.frameTree).find((item) => urlPattern.test(item.url));
  if (!frame) return null;
  const world = await browser.cdp.send('Page.createIsolatedWorld', {
    frameId: frame.id,
    grantUniveralAccess: true,
  }, sessionId);
  const result = await browser.cdp.send('Runtime.evaluate', {
    expression,
    contextId: world.executionContextId,
    returnByValue: true,
  }, sessionId);
  return result.result?.value ?? null;
}

async function assertGeometryRestore(browser, artifactPath, { width, height }) {
  await browser.inspect({
    artifactPath,
    width,
    height,
    theme: 'light',
  });
  const before = await evaluate(browser, `(async () => {
    const canvas = document.querySelector('.diagram-container');
    const frame = document.getElementById('archify-drilldown-frame');
    canvas.style.height = '240px';
    canvas.style.overflow = 'auto';
    if (frame) frame.style.minHeight = '80vh';
    window.scrollTo(40, 80);
    canvas.scrollLeft = 12;
    canvas.scrollTop = 24;
    const svg = document.querySelector('.diagram-container svg');
    const nodes = [...svg.querySelectorAll('[data-node-id]')].map((node) => {
      const box = node.getBoundingClientRect();
      return { id: node.getAttribute('data-node-id'), x: box.x, y: box.y, w: box.width, h: box.height };
    });
    return {
      viewBox: svg.getAttribute('viewBox'),
      nodes,
      windowX: window.scrollX,
      windowY: window.scrollY,
      canvasX: canvas.scrollLeft,
      canvasY: canvas.scrollTop,
    };
  })()`);
  const during = await evaluate(browser, `(async () => {
    if (!window.Archify || !Archify.drilldown) return { ok: false };
    Archify.drilldown.descend('payments');
    await new Promise((resolve) => setTimeout(resolve, 1300));
    const currents = [...document.querySelectorAll('[aria-current="page"]')].map((node) => node.textContent);
    const frame = document.getElementById('archify-drilldown-frame');
    const payments = document.querySelector('[data-node-id="payments"]');
    let inside = '';
    let badge = '';
    if (window.Archify && Archify.drilldown && payments) {
      Archify.drilldown.applyProjection({ payments: 'touched' }, [payments], { payments: 3 });
      inside = payments.getAttribute('data-locate-inside') || '';
      const mark = payments.querySelector('[data-locate-inside-count]');
      badge = mark ? mark.textContent : '';
      Archify.drilldown.applyProjection({ payments: 'touched' }, [payments], { payments: 0 });
    }
    return {
      ok: true,
      currents,
      childMinHeight: frame ? frame.style.minHeight : '',
      state: document.documentElement.getAttribute('data-drilldown-state'),
      childSrc: frame ? frame.getAttribute('src') : '',
      inside,
      badge,
    };
  })()`);
  assert.equal(during.ok, true, `${width}x${height}: descend failed`);
  assert.equal(during.state, 'level1', `${width}x${height}: handshake`);
  assert.equal(during.currents.length, 1, `${width}x${height}: breadcrumb current`);
  assert.doesNotMatch(during.currents[0], /^(.+) · \1$/, `${width}x${height}: breadcrumb must not repeat an equal label`);
  // file:// iframes hide contentDocument; inspect the child frame over CDP.
  const childChrome = await evaluateChildFrame(browser, /payments\.html/, `({
    nested: document.documentElement.getAttribute('data-bundle-nested'),
    toolbarDisplay: document.querySelector('.toolbar')
      ? getComputedStyle(document.querySelector('.toolbar')).display : '',
    navDisplay: document.querySelector('.diagram-nav')
      ? getComputedStyle(document.querySelector('.diagram-nav')).display : '',
  })`);
  assert.ok(childChrome, `${width}x${height}: child frame ${during.childSrc}`);
  assert.equal(childChrome.nested, 'true', `${width}x${height}: child handshake marks nested`);
  assert.equal(childChrome.toolbarDisplay, 'none', `${width}x${height}: nested toolbar hidden`);
  assert.equal(childChrome.navDisplay, 'none', `${width}x${height}: nested PATH/MAP/LENS hidden`);
  assert.equal(during.inside, '3', `${width}x${height}: parent-box count`);
  assert.equal(during.badge, '3', `${width}x${height}: parent-box badge`);
  assert.equal(during.childMinHeight, '80vh', `${width}x${height}: child height must differ from parent canvas`);
  await evaluate(browser, `(async () => {
    Archify.drilldown.back();
    await new Promise((resolve) => setTimeout(resolve, 400));
    return true;
  })()`);
  const after = await evaluate(browser, `(async () => {
    const canvas = document.querySelector('.diagram-container');
    const svg = document.querySelector('.diagram-container svg');
    const nodes = [...svg.querySelectorAll('[data-node-id]')].map((node) => {
      const box = node.getBoundingClientRect();
      return { id: node.getAttribute('data-node-id'), x: box.x, y: box.y, w: box.width, h: box.height };
    });
    return {
      viewBox: svg.getAttribute('viewBox'),
      hidden: svg.hasAttribute('hidden'),
      visibility: getComputedStyle(svg).visibility,
      nodes,
      windowX: window.scrollX,
      windowY: window.scrollY,
      canvasX: canvas.scrollLeft,
      canvasY: canvas.scrollTop,
    };
  })()`);
  assert.equal(after.viewBox, before.viewBox, `${width}x${height}: viewBox`);
  assert.equal(after.hidden, false, `${width}x${height}: hidden attr`);
  assert.equal(after.visibility, 'visible', `${width}x${height}: visibility`);
  assert.deepEqual(after.nodes, before.nodes, `${width}x${height}: node boxes`);
  assert.equal(after.windowX, before.windowX, `${width}x${height}: windowX`);
  assert.equal(after.windowY, before.windowY, `${width}x${height}: windowY`);
  assert.equal(after.canvasX, before.canvasX, `${width}x${height}: canvasX`);
  assert.equal(after.canvasY, before.canvasY, `${width}x${height}: canvasY`);
}

test('ascending restores parent viewBox, node boxes, and scroll position', options, async () => {
  const dir = stageBundleFixture({ prefix: 'archify-drilldown-browser-' });
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const artifactPath = path.join(dir, 'checkout-platform.html');
    for (const viewport of VIEWPORTS) {
      await assertGeometryRestore(browser, artifactPath, viewport);
    }
  } finally {
    await browser.close();
    disposeBundleFixture(dir);
  }
});
