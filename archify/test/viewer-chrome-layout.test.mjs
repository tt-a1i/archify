import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import { MIN_PROJECTED_NODE_TEXT_PX } from '../renderers/shared/desktop-readability.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-viewer-chrome-layout-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;

const CASES = {
  architecture: 'web-app.architecture.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
};

function render(mode, example) {
  const output = path.join(tmp, `${mode}.html`);
  execFileSync(process.execPath, [
    path.join(skillRoot, 'bin', 'archify.mjs'),
    'render',
    mode,
    path.join(skillRoot, 'examples', example),
    output,
  ]);
  return output;
}

function canonicalSvg(html) {
  return html.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
}

async function evaluate(browser, sessionId, expression, awaitPromise = false) {
  const response = await browser.cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
  }, sessionId);
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description
      || response.exceptionDetails.text
      || 'Runtime.evaluate failed');
  }
  return response.result?.value;
}

async function waitForLayout(browser, sessionId) {
  return evaluate(browser, sessionId, `(function () {
    var fontsReady = document.fonts && document.fonts.ready
      ? document.fonts.ready.catch(function () {})
      : Promise.resolve();
    return fontsReady.then(function () {
      return new Promise(function (resolve, reject) {
        var previous = '';
        var stableFrames = 0;
        var sampledFrames = 0;
        function rect(element) {
          if (!element) return 'missing';
          var value = element.getBoundingClientRect();
          return [value.left, value.top, value.right, value.bottom].map(function (entry) {
            return Math.round(entry * 100) / 100;
          }).join(',');
        }
        function sample() {
          sampledFrames += 1;
          var container = document.querySelector('.diagram-container');
          var current = [
            rect(container),
            rect(container && container.querySelector(':scope > svg')),
            rect(document.querySelector('.diagram-nav')),
            rect(document.querySelector('[data-legend]')),
            rect(document.getElementById('semantic-lens')),
            rect(document.getElementById('overview-map')),
            container ? getComputedStyle(container).getPropertyValue('--archify-nav-reserve') : ''
          ].join('|');
          if (current === previous) stableFrames += 1;
          else {
            previous = current;
            stableFrames = 0;
          }
          /* Final-artifact tests cannot inspect private scheduler flags. Eight
             equal frames cover the public three-frame contract plus any
             reader/viewer handoff queued after a ResizeObserver callback. */
          if (stableFrames >= 8) {
            resolve({ stable: true, snapshot: current, sampledFrames: sampledFrames });
            return;
          }
          if (sampledFrames >= 240) {
            reject(new Error('Final Viewer geometry did not stabilize.'));
            return;
          }
          requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
    });
  })()`, true);
}

async function finalGeometry(browser, sessionId) {
  return evaluate(browser, sessionId, `(function () {
    function area(a, b) {
      if (!a || !b || !a.width || !a.height || !b.width || !b.height) return 0;
      return Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    }
    var container = document.querySelector('.diagram-container');
    var legend = document.querySelector('[data-legend]');
    var nav = document.querySelector('.diagram-nav');
    var svg = container && container.querySelector(':scope > svg');
    var lens = document.getElementById('semantic-lens');
    var radar = document.getElementById('overview-map');
    var passport = document.getElementById('focus-chip');
    var chromeReceipt = window.Archify && Archify.viewerChromeLayout
      && typeof Archify.viewerChromeLayout.receipt === 'function'
      ? Archify.viewerChromeLayout.receipt()
      : null;
    var viewBox = svg && svg.viewBox && svg.viewBox.baseVal;
    var projectedScale = svg && viewBox && viewBox.width > 0
      ? Math.min(1, svg.getBoundingClientRect().width / viewBox.width)
      : 0;
    var minimumProjectedNodeTextPx = null;
    if (svg && projectedScale > 0) {
      Array.from(svg.querySelectorAll('text[data-node-label], text[data-boundary-label], text[data-detail="context"]')).forEach(function (text) {
        if (text.hasAttribute('data-detail') && !text.closest('[data-node-id]')) return;
        var sourceFontPx = parseFloat(text.getAttribute('font-size') || '');
        if (!Number.isFinite(sourceFontPx)) return;
        var projectedFontPx = sourceFontPx * projectedScale;
        if (minimumProjectedNodeTextPx == null || projectedFontPx < minimumProjectedNodeTextPx) {
          minimumProjectedNodeTextPx = projectedFontPx;
        }
      });
    }
    var legendRect = legend && getComputedStyle(legend).display !== 'none' ? legend.getBoundingClientRect() : null;
    var navRect = nav && getComputedStyle(nav).display !== 'none' ? nav.getBoundingClientRect() : null;
    var svgRect = svg ? svg.getBoundingClientRect() : null;
    var lensRect = lens && !lens.hidden && getComputedStyle(lens).display !== 'none' ? lens.getBoundingClientRect() : null;
    var radarRect = radar && !radar.hidden && getComputedStyle(radar).display !== 'none' ? radar.getBoundingClientRect() : null;
    var passportRect = passport && !passport.hidden && getComputedStyle(passport).display !== 'none' ? passport.getBoundingClientRect() : null;
    var semanticDockIntersectionArea = navRect && svg
      ? Array.from(svg.querySelectorAll('[data-node-id]')).reduce(function (maximum, node) {
          return Math.max(maximum, area(node.getBoundingClientRect(), navRect));
        }, 0)
      : 0;
    return {
      reserve: parseFloat(getComputedStyle(container).getPropertyValue('--archify-nav-reserve')) || 0,
      receiptReserve: chromeReceipt ? chromeReceipt.reserve : null,
      receiptEligible: chromeReceipt ? chromeReceipt.eligible : null,
      receiptStageIntersectionArea: chromeReceipt ? chromeReceipt.stageIntersectionArea : null,
      minimumProjectedNodeTextPx: minimumProjectedNodeTextPx,
      stageGap: navRect && svgRect ? navRect.top - svgRect.bottom : null,
      dockStageIntersectionArea: area(svgRect, navRect),
      legendDockIntersectionArea: area(legendRect, navRect),
      semanticDockIntersectionArea: semanticDockIntersectionArea,
      legendLensIntersectionArea: area(legendRect, lensRect),
      navLensIntersectionArea: area(navRect, lensRect),
      legendRadarIntersectionArea: area(legendRect, radarRect),
      navRadarIntersectionArea: area(navRect, radarRect),
      legendPassportIntersectionArea: area(legendRect, passportRect),
      navPassportIntersectionArea: area(navRect, passportRect),
      radarPassportIntersectionArea: area(radarRect, passportRect),
      legendRect: legendRect ? { left: legendRect.left, right: legendRect.right, top: legendRect.top, bottom: legendRect.bottom } : null,
      navRect: navRect ? { left: navRect.left, right: navRect.right, top: navRect.top, bottom: navRect.bottom } : null,
      passportRect: passportRect ? { left: passportRect.left, right: passportRect.right, top: passportRect.top, bottom: passportRect.bottom } : null,
      radarRect: radarRect ? { left: radarRect.left, right: radarRect.right, top: radarRect.top, bottom: radarRect.bottom } : null,
      hasLegend: Boolean(legendRect && legendRect.width && legendRect.height),
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      containerBottom: container ? container.getBoundingClientRect().bottom : null,
      containerHeight: container ? container.clientHeight : null,
      receiptGap: chromeReceipt ? chromeReceipt.gap : null,
      navBottom: navRect ? navRect.bottom : null
    };
  })()`);
}

async function load(browser, artifactPath, { width = 1440, height = 900, query = '' } = {}) {
  const sessionId = await browser.sessionPromise;
  await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
  const navigation = await browser.cdp.send('Page.navigate', {
    url: pathToFileURL(artifactPath).href + query,
  }, sessionId);
  if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
  await loaded;
  await evaluate(browser, sessionId, `document.documentElement.setAttribute('data-motion', 'still')`);
  await waitForLayout(browser, sessionId);
  return sessionId;
}

test('the public CLI gives all typed renderers one final Viewer contract', () => {
  for (const [mode, example] of Object.entries(CASES)) {
    const output = render(mode, example);
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /class="[^"]*\bdiagram-nav\b[^"]*"/, mode);
    assert.match(html, /data-legend/, mode);
    assert.doesNotMatch(canonicalSvg(html), /nav-safe-rail|archify-nav-reserve|viewerChromeLayout/, mode);
    execFileSync(process.execPath, [path.join(skillRoot, 'bin', 'archify.mjs'), 'check', output]);
  }
});

test('Viewer chrome remains outside the canonical SVG export boundary', () => {
  const html = fs.readFileSync(render('architecture', CASES.architecture), 'utf8');
  const svg = canonicalSvg(html);
  assert.match(svg, /data-legend/);
  assert.doesNotMatch(svg, /diagram-nav|data-nav-stage-rail|viewerChromeLayout/);
});

test('Dock Safe Rail keeps typed renderers clear across themes, Presentation, and low-height desktops', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  const matrix = Object.keys(CASES).flatMap((mode) => [
    { mode, theme: 'light', width: 1440, height: 820, present: false },
    { mode, theme: 'dark', width: 1440, height: 900, present: true },
  ]);
  try {
    for (const entry of matrix) {
      const query = `?theme=${entry.theme}${entry.present ? '&present=1' : ''}`;
      const sessionId = await load(browser, render(entry.mode, CASES[entry.mode]), {
        width: entry.width,
        height: entry.height,
        query,
      });
      const receipt = await finalGeometry(browser, sessionId);
      const message = `${entry.mode}: ${JSON.stringify({ entry, receipt })}`;
      assert.ok(receipt.reserve > 0, message);
      assert.ok(receipt.stageGap >= 9, message);
      assert.ok(receipt.scrollWidth <= receipt.innerWidth, message);
      assert.ok(receipt.navBottom <= receipt.containerBottom + 0.5, message);
      /* Normal artifacts intentionally keep supporting cards in document
         flow on low-height pages. Presentation removes that document scroll
         while every mode keeps the Viewer itself vertically contained. */
      if (entry.present) {
        assert.ok(receipt.scrollHeight <= receipt.innerHeight, message);
      }
      assert.ok(receipt.minimumProjectedNodeTextPx >= MIN_PROJECTED_NODE_TEXT_PX, message);
    }
  } finally {
    await browser.close();
  }
});

test('an artifact with no Legend still receives the desktop stage rail', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, render('architecture', CASES.architecture));
    await evaluate(browser, sessionId, `(function () {
      var legend = document.querySelector('[data-legend]');
      if (legend) legend.remove();
      return Archify.viewerChromeLayout.reprobe();
    })()`, true);
    await waitForLayout(browser, sessionId);
    const receipt = await finalGeometry(browser, sessionId);

    assert.equal(receipt.hasLegend, false, JSON.stringify(receipt));
    assert.ok(receipt.reserve > 0, JSON.stringify(receipt));
    assert.ok(receipt.stageGap >= 9, JSON.stringify(receipt));
    assert.ok(receipt.navBottom <= receipt.containerBottom + 0.5, JSON.stringify(receipt));
  } finally {
    await browser.close();
  }
});

test('Dock Safe Rail resolves a forced Legend collision across the shared diagram viewer', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    for (const [mode, example] of Object.entries(CASES)) {
      const sessionId = await load(browser, render(mode, example));
      const setup = await evaluate(browser, sessionId, `(function () {
        var nav = document.querySelector('.diagram-nav');
        var legendElement = document.querySelector('[data-legend]');
        if (!legendElement) {
          return { noLegend: true };
        }
        var initialLegend = legendElement.getBoundingClientRect();
        var containerRect = document.querySelector('.diagram-container').getBoundingClientRect();
        nav.style.right = 'auto';
        nav.style.left = Math.max(0, initialLegend.left - containerRect.left) + 'px';
        nav.style.bottom = Math.max(0, containerRect.bottom - initialLegend.bottom) + 'px';
        nav.style.width = Math.max(240, initialLegend.width) + 'px';
        window.dispatchEvent(new Event('resize'));
        return { noLegend: false };
      })()`);

      if (setup.noLegend) {
        const receipt = await finalGeometry(browser, sessionId);
        assert.ok(receipt.reserve > 0, mode);
        assert.ok(receipt.stageGap >= 9, mode);
        continue;
      }
      await waitForLayout(browser, sessionId);
      const receipt = await finalGeometry(browser, sessionId);
      assert.ok(receipt.reserve > 0, `${mode}: ${JSON.stringify(receipt)}`);
      assert.equal(receipt.legendDockIntersectionArea, 0, `${mode}: ${JSON.stringify(receipt)}`);
      assert.ok(receipt.stageGap >= 9, `${mode}: ${JSON.stringify(receipt)}`);
    }
  } finally {
    await browser.close();
  }
});

test('Maka remains collision-free at the reported Retina-equivalent viewport', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const output = path.join(tmp, 'maka-architecture.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'bin', 'archify.mjs'),
    'render',
    'architecture',
    path.resolve(skillRoot, '..', 'examples', 'maka-architecture.architecture.json'),
    output,
  ]);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, output, { width: 1484, height: 724 });
    const receipt = await evaluate(browser, sessionId, `(function () {
      var legend = document.querySelector('[data-legend]').getBoundingClientRect();
      var dock = document.querySelector('.diagram-nav').getBoundingClientRect();
      var width = Math.max(0, Math.min(legend.right, dock.right) - Math.max(legend.left, dock.left));
      var height = Math.max(0, Math.min(legend.bottom, dock.bottom) - Math.max(legend.top, dock.top));
      return {
        intersectionArea: width * height,
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth
      };
    })()`);

    assert.equal(receipt.intersectionArea, 0, JSON.stringify(receipt));
    assert.ok(receipt.scrollWidth <= receipt.innerWidth, JSON.stringify(receipt));
  } finally {
    await browser.close();
  }
});

test('a real 5px Legend gap keeps the stage rail and Legend clear', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, render('architecture', CASES.architecture));
    await evaluate(browser, sessionId, `(function () {
      var container = document.querySelector('.diagram-container');
      var legend = document.querySelector('[data-legend]');
      var nav = document.querySelector('.diagram-nav');
      var legendRect = legend.getBoundingClientRect();
      var containerRect = container.getBoundingClientRect();
      nav.style.right = 'auto';
      nav.style.left = (legendRect.right - containerRect.left + 5) + 'px';
      nav.style.bottom = Math.max(0, containerRect.bottom - legendRect.bottom) + 'px';
      window.dispatchEvent(new Event('resize'));
    })()`);
    await waitForLayout(browser, sessionId);
    const receipt = await finalGeometry(browser, sessionId);

    assert.equal(receipt.legendDockIntersectionArea, 0, JSON.stringify(receipt));
    assert.ok(receipt.reserve > 0, JSON.stringify(receipt));
    assert.ok(receipt.stageGap >= 9, JSON.stringify(receipt));
  } finally {
    await browser.close();
  }
});

test('Presentation keeps its visible Dock clear of a colliding Legend', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, render('architecture', CASES.architecture), { query: '?present=1' });
    await evaluate(browser, sessionId, `(function () {
      var container = document.querySelector('.diagram-container');
      var legend = document.querySelector('[data-legend]');
      var nav = document.querySelector('.diagram-nav');
      var legendRect = legend.getBoundingClientRect();
      var containerRect = container.getBoundingClientRect();
      nav.style.right = 'auto';
      nav.style.left = Math.max(0, legendRect.left - containerRect.left) + 'px';
      nav.style.bottom = Math.max(0, containerRect.bottom - legendRect.bottom) + 'px';
      nav.style.width = Math.max(240, legendRect.width) + 'px';
      window.dispatchEvent(new Event('resize'));
    })()`);
    await waitForLayout(browser, sessionId);
    const receipt = await finalGeometry(browser, sessionId);

    assert.equal(receipt.legendDockIntersectionArea, 0, JSON.stringify(receipt));
    assert.ok(receipt.reserve > 0, JSON.stringify(receipt));
  } finally {
    await browser.close();
  }
});

test('manual zoom and pan reschedules Legend and Dock collision measurement', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, render('architecture', CASES.architecture));
    await evaluate(browser, sessionId, `(function () {
      var container = document.querySelector('.diagram-container');
      var zoomIn = document.querySelector('[data-view="in"]');
      for (var index = 0; index < 8; index += 1) zoomIn.click();
      var svg = container.querySelector(':scope > svg');
      var rect = svg.getBoundingClientRect();
      var pointer = { bubbles: true, pointerId: 7, button: 0 };
      var startX = rect.left + rect.width / 2;
      var startY = rect.top + rect.height / 2;
      container.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ clientX: startX, clientY: startY }, pointer)));
      container.dispatchEvent(new PointerEvent('pointermove', Object.assign({ clientX: startX + 210, clientY: startY - 500 }, pointer)));
      container.dispatchEvent(new PointerEvent('pointerup', Object.assign({ clientX: startX + 210, clientY: startY - 500 }, pointer)));
    })()`);
    await waitForLayout(browser, sessionId);
    const receipt = await finalGeometry(browser, sessionId);

    assert.equal(receipt.legendDockIntersectionArea, 0, JSON.stringify(receipt));
    assert.equal(receipt.semanticDockIntersectionArea, 0, JSON.stringify(receipt));
    assert.ok(receipt.reserve > 0, JSON.stringify(receipt));
  } finally {
    await browser.close();
  }
});

test('zoom keeps the desktop rail bounded and reports transformed stage geometry truthfully', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, render('architecture', CASES.architecture));
    const baseline = await finalGeometry(browser, sessionId);
    await evaluate(browser, sessionId, `(function () {
      var container = document.querySelector('.diagram-container');
      var zoomIn = document.querySelector('[data-view="in"]');
      for (var index = 0; index < 8; index += 1) zoomIn.click();
      var svg = container.querySelector(':scope > svg');
      var rect = svg.getBoundingClientRect();
      var pointer = { bubbles: true, pointerId: 13, button: 0 };
      var startX = rect.left + rect.width / 2;
      var startY = rect.top + rect.height / 2;
      container.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ clientX: startX, clientY: startY }, pointer)));
      container.dispatchEvent(new PointerEvent('pointermove', Object.assign({ clientX: startX + 210, clientY: startY - 500 }, pointer)));
      container.dispatchEvent(new PointerEvent('pointerup', Object.assign({ clientX: startX + 210, clientY: startY - 500 }, pointer)));
    })()`);
    await waitForLayout(browser, sessionId);
    const zoomed = await finalGeometry(browser, sessionId);

    assert.ok(
      zoomed.reserve <= baseline.reserve + zoomed.containerHeight * 0.25 + 1,
      JSON.stringify({ baseline, zoomed }),
    );
    assert.ok(
      Math.abs(zoomed.receiptStageIntersectionArea - zoomed.dockStageIntersectionArea) <= 0.5,
      JSON.stringify({ baseline, zoomed }),
    );
  } finally {
    await browser.close();
  }
});

test('Reset followed immediately by zoom and pan retains a collision-free desktop rail', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, render('architecture', CASES.architecture));
    const baseline = await finalGeometry(browser, sessionId);
    await evaluate(browser, sessionId, `(function () {
      var container = document.querySelector('.diagram-container');
      document.querySelector('[data-view="reset"]').click();
      var zoomIn = document.querySelector('[data-view="in"]');
      for (var index = 0; index < 8; index += 1) zoomIn.click();
      var svg = container.querySelector(':scope > svg');
      var rect = svg.getBoundingClientRect();
      var pointer = { bubbles: true, pointerId: 11, button: 0 };
      var startX = rect.left + rect.width / 2;
      var startY = rect.top + rect.height / 2;
      container.dispatchEvent(new PointerEvent('pointerdown', Object.assign({ clientX: startX, clientY: startY }, pointer)));
      container.dispatchEvent(new PointerEvent('pointermove', Object.assign({ clientX: startX, clientY: startY + 500 }, pointer)));
      container.dispatchEvent(new PointerEvent('pointerup', Object.assign({ clientX: startX, clientY: startY + 500 }, pointer)));
    })()`);
    await waitForLayout(browser, sessionId);
    const receipt = await finalGeometry(browser, sessionId);

    assert.ok(receipt.reserve > 0, JSON.stringify({ baseline, receipt }));
    assert.ok(receipt.reserve <= baseline.reserve + 1, JSON.stringify({ baseline, receipt }));
    assert.equal(receipt.semanticDockIntersectionArea, 0, JSON.stringify({ baseline, receipt }));
  } finally {
    await browser.close();
  }
});

test('zoomed camera restores its bounded desktop rail after crossing the mobile breakpoint', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, render('architecture', CASES.architecture));
    const baseline = await finalGeometry(browser, sessionId);
    await evaluate(browser, sessionId, `(function () {
      var zoomIn = document.querySelector('[data-view="in"]');
      for (var index = 0; index < 8; index += 1) zoomIn.click();
    })()`);
    await waitForLayout(browser, sessionId);
    const zoomed = await finalGeometry(browser, sessionId);

    await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 720,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await waitForLayout(browser, sessionId);
    const mobile = await finalGeometry(browser, sessionId);
    assert.equal(mobile.reserve, 0, JSON.stringify(mobile));

    await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await waitForLayout(browser, sessionId);
    const restored = await finalGeometry(browser, sessionId);

    assert.ok(Math.abs(restored.reserve - baseline.reserve) <= 1, JSON.stringify({ baseline, zoomed, restored }));
    assert.equal(restored.receiptReserve, restored.reserve, JSON.stringify(restored));
    assert.equal(restored.receiptEligible, true, JSON.stringify(restored));
    assert.ok(restored.scrollHeight <= restored.innerHeight, JSON.stringify(restored));
  } finally {
    await browser.close();
  }
});

test('localized multiline Legends remain clear across themes, presets, and zoom levels', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  const cases = [
    { preset: 'classic', theme: 'light', zoom: 1 },
    { preset: 'signal-flow', theme: 'dark', zoom: 1.25 },
    { preset: 'blueprint', theme: 'light', zoom: 2 },
    { preset: 'editorial', theme: 'dark', zoom: 2 },
  ];
  try {
    const sessionId = await load(browser, render('architecture', CASES.architecture), { width: 1920, height: 1080 });
    await evaluate(browser, sessionId, `(function () {
      var text = document.querySelector('[data-legend] text');
      var x = text.getAttribute('x') || '0';
      var namespace = 'http://www.w3.org/2000/svg';
      text.textContent = '';
      var first = document.createElementNS(namespace, 'tspan');
      first.setAttribute('x', x);
      first.textContent = '应用与运行时编排服务（本地化长标签）';
      var second = document.createElementNS(namespace, 'tspan');
      second.setAttribute('x', x);
      second.setAttribute('dy', '14');
      second.textContent = '第二行语义说明';
      text.appendChild(first);
      text.appendChild(second);
    })()`);

    for (const entry of cases) {
      await evaluate(browser, sessionId, `(function () {
        var html = document.documentElement;
        var nav = document.querySelector('.diagram-nav');
        html.setAttribute('data-preset', ${JSON.stringify(entry.preset)});
        html.setAttribute('data-theme', ${JSON.stringify(entry.theme)});
        html.style.fontSize = ${JSON.stringify(`${entry.zoom * 100}%`)};
        document.body.style.zoom = ${JSON.stringify(String(entry.zoom))};
        nav.removeAttribute('style');
        window.dispatchEvent(new Event('resize'));
      })()`);
      await waitForLayout(browser, sessionId);
      let receipt = null;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await evaluate(browser, sessionId, `(function () {
          var container = document.querySelector('.diagram-container');
          var legend = document.querySelector('[data-legend]').getBoundingClientRect();
          var nav = document.querySelector('.diagram-nav');
          var containerRect = container.getBoundingClientRect();
          var renderedZoom = nav.offsetHeight ? nav.getBoundingClientRect().height / nav.offsetHeight : ${entry.zoom};
          nav.style.right = '0';
          nav.style.left = '0';
          nav.style.bottom = Math.max(0, (containerRect.bottom - legend.bottom) / renderedZoom) + 'px';
          nav.style.width = 'auto';
          window.dispatchEvent(new Event('resize'));
        })()`);
        await waitForLayout(browser, sessionId);
        receipt = await finalGeometry(browser, sessionId);
        if (receipt.reserve > 0) break;
      }
      assert.equal(receipt.legendDockIntersectionArea, 0, JSON.stringify({ ...entry, receipt }));
      assert.ok(receipt.reserve > 0, JSON.stringify({ ...entry, receipt }));
    }
  } finally {
    await browser.close();
  }
});

test('Semantic Lens and Radar protect the final Legend and Dock rectangles', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await load(browser, render('architecture', CASES.architecture), { width: 1440, height: 900 });
    await evaluate(browser, sessionId, `document.getElementById('btn-semantic-lens').click()`);
    await waitForLayout(browser, sessionId);
    let receipt = await finalGeometry(browser, sessionId);
    assert.equal(receipt.legendLensIntersectionArea, 0, JSON.stringify(receipt));
    assert.equal(receipt.navLensIntersectionArea, 0, JSON.stringify(receipt));

    await evaluate(browser, sessionId, `(function () {
      document.getElementById('btn-semantic-lens').click();
      document.getElementById('btn-overview-map').click();
    })()`);
    await waitForLayout(browser, sessionId);
    receipt = await finalGeometry(browser, sessionId);
    assert.equal(receipt.legendRadarIntersectionArea, 0, JSON.stringify(receipt));
    assert.equal(receipt.navRadarIntersectionArea, 0, JSON.stringify(receipt));
  } finally {
    await browser.close();
  }
});

test('Radar, Passport, Legend, and Dock remain mutually clear on desktop and narrow viewports', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const artifact = render('architecture', CASES.architecture);
    for (const viewport of [
      { width: 1440, height: 900, label: 'desktop' },
      { width: 390, height: 600, label: 'narrow' },
    ]) {
      const sessionId = await load(browser, artifact, viewport);
      await evaluate(browser, sessionId, `(function () {
        var container = document.querySelector('.diagram-container');
        window.scrollTo(0, Math.max(0, container.offsetTop));
        Archify.focus.set('lb', { toggle: false });
        Archify.radar.open();
        window.dispatchEvent(new Event('resize'));
      })()`);
      await waitForLayout(browser, sessionId);
      const receipt = await finalGeometry(browser, sessionId);
      const message = viewport.label + ': ' + JSON.stringify(receipt);

      assert.equal(receipt.legendDockIntersectionArea, 0, message);
      assert.equal(receipt.legendPassportIntersectionArea, 0, message);
      assert.equal(receipt.navPassportIntersectionArea, 0, message);
      assert.equal(receipt.legendRadarIntersectionArea, 0, message);
      assert.equal(receipt.navRadarIntersectionArea, 0, message);
      assert.equal(receipt.radarPassportIntersectionArea, 0, message);
    }
  } finally {
    await browser.close();
  }
});

test('mobile, embed, and print keep zero reserve while hidden Legends retain the stage rail', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    let sessionId = await load(browser, render('architecture', CASES.architecture), { width: 720, height: 900 });
    let receipt = await finalGeometry(browser, sessionId);
    assert.equal(receipt.reserve, 0, `mobile: ${JSON.stringify(receipt)}`);
    assert.equal(receipt.legendDockIntersectionArea, 0, `mobile: ${JSON.stringify(receipt)}`);

    sessionId = await load(browser, render('architecture', CASES.architecture), { query: '?embed=1' });
    receipt = await finalGeometry(browser, sessionId);
    assert.equal(receipt.reserve, 0, `embed: ${JSON.stringify(receipt)}`);

    sessionId = await load(browser, render('architecture', CASES.architecture));
    await evaluate(browser, sessionId, `(function () {
      document.querySelector('[data-legend]').hidden = true;
      window.dispatchEvent(new Event('resize'));
    })()`);
    await waitForLayout(browser, sessionId);
    receipt = await finalGeometry(browser, sessionId);
    assert.ok(receipt.reserve > 0, `hidden: ${JSON.stringify(receipt)}`);
    assert.ok(receipt.stageGap >= 9, `hidden: ${JSON.stringify(receipt)}`);

    await browser.cdp.send('Emulation.setEmulatedMedia', { media: 'print' }, sessionId);
    await waitForLayout(browser, sessionId);
    receipt = await finalGeometry(browser, sessionId);
    assert.equal(receipt.reserve, 0, `print: ${JSON.stringify(receipt)}`);
  } finally {
    await browser.close();
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
