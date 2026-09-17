import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
const browserSkip = chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.';

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

function renderArtifact(tmp) {
  const artifact = path.join(tmp, 'wheel-zoom.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'bin', 'archify.mjs'),
    'render',
    'workflow',
    path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'),
    artifact,
    '--quality',
    'showcase',
  ], { cwd: skillRoot, encoding: 'utf8' });
  return artifact;
}

// Settled layout, not merely a loaded one: the chrome reserve measurement moves
// the SVG after load, so measuring an earlier rect would misread the anchor.
async function stableLayout(browser, sessionId) {
  await evaluate(browser, sessionId, `(async function () {
    await document.fonts.ready;
    function wait(predicate) {
      return new Promise(function (resolve, reject) {
        var frames = 0;
        function sample() {
          if (predicate()) return resolve();
          if (++frames > 300) return reject(new Error('Viewer layout did not settle'));
          requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
    }
    var previous = '';
    var equal = 0;
    await wait(function () {
      var container = document.querySelector('.diagram-container');
      var svg = container.querySelector(':scope > svg');
      var rect = svg.getBoundingClientRect();
      var current = JSON.stringify([Archify.view.state(), getComputedStyle(svg).transform,
        svg.style.clipPath, container.scrollLeft, container.getAttribute('data-camera-transaction'),
        container.style.getPropertyValue('--archify-nav-reserve'), rect.x, rect.y, rect.width, rect.height]);
      equal = current === previous ? equal + 1 : 0;
      previous = current;
      return equal >= 8 && !container.hasAttribute('data-camera-transaction');
    });
  })()`, true);
}

async function loadArtifact(browser, artifactPath, { width = 1440, height = 900 } = {}) {
  const sessionId = await browser.sessionPromise;
  await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
  const navigation = await browser.cdp.send('Page.navigate', {
    url: pathToFileURL(artifactPath).href,
  }, sessionId);
  if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
  await loaded;
  await evaluate(browser, sessionId, `document.documentElement.setAttribute('data-motion', 'still')`);
  await stableLayout(browser, sessionId);
  return sessionId;
}

// Records the bubble-phase view of each wheel event, so a test can assert whether
// the camera consumed the gesture instead of inferring it from scrolling alone.
async function installWheelLog(browser, sessionId) {
  await evaluate(browser, sessionId, `(function () {
    window.__archifyWheelLog = [];
    window.addEventListener('wheel', function (event) {
      window.__archifyWheelLog.push({
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        prevented: event.defaultPrevented,
        target: (event.target.tagName || '') + '.' + String(event.target.className || '').slice(0, 40)
      });
    }, false);
  })()`);
}

async function wheelLog(browser, sessionId) {
  return evaluate(browser, sessionId, `window.__archifyWheelLog`);
}

async function wheelAt(browser, sessionId, x, y, { deltaX = 0, deltaY = 0, ctrl = false, shift = false } = {}) {
  await browser.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX,
    deltaY,
    modifiers: (ctrl ? 2 : 0) | (shift ? 8 : 0),
  }, sessionId);
}

async function settle(ms = 420) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function viewState(browser, sessionId) {
  return evaluate(browser, sessionId, `(function () {
    var svg = document.querySelector('.diagram-container > svg');
    var rect = svg.getBoundingClientRect();
    return {
      scale: Archify.view.state().scale,
      x: Archify.view.state().x,
      y: Archify.view.state().y,
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      transform: getComputedStyle(svg).transform,
    };
  })()`);
}

async function pageState(browser, sessionId) {
  return evaluate(browser, sessionId, `({
    scrollY: window.scrollY,
    scrollable: document.documentElement.scrollHeight - window.innerHeight
  })`);
}

async function scrollTo(browser, sessionId, y) {
  await evaluate(browser, sessionId, `window.scrollTo(0, ${y})`);
  await settle(120);
}

// A point inside the diagram stage, clamped to the visible viewport.
async function diagramPoint(browser, sessionId, fx = 0.34, fy = 0.31) {
  const state = await viewState(browser, sessionId);
  const viewport = await evaluate(browser, sessionId, `({ width: window.innerWidth, height: window.innerHeight })`);
  return {
    x: Math.min(Math.max(state.rect.left + state.rect.width * fx, 8), viewport.width - 8),
    y: Math.min(Math.max(state.rect.top + state.rect.height * fy, 8), viewport.height - 8),
  };
}

async function reset(browser, sessionId) {
  await evaluate(browser, sessionId, `Archify.view.reset()`);
  await stableLayout(browser, sessionId);
}

async function withArtifact(run) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-wheel-zoom-'));
  try {
    const artifact = renderArtifact(tmp);
    const browser = new ChromeVisualBrowser(chromePath);
    try {
      return await run(browser, artifact);
    } finally {
      await browser.close();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

test('plain wheel zooms toward the pointer and leaves Ctrl+wheel untouched', {
  skip: browserSkip,
}, async () => {
  await withArtifact(async (browser, artifact) => {
    const sessionId = await loadArtifact(browser, artifact);
    const initial = await viewState(browser, sessionId);
    const point = await diagramPoint(browser, sessionId);

    await wheelAt(browser, sessionId, point.x, point.y, { deltaY: -120 });
    await settle();
    const zoomed = await viewState(browser, sessionId);

    assert.ok(zoomed.scale > initial.scale, `plain wheel must zoom in (${initial.scale} -> ${zoomed.scale})`);
    assert.notEqual(zoomed.scale, initial.scale, 'plain wheel must not pass through unchanged');

    const anchorBeforeX = (point.x - initial.rect.left) / initial.scale;
    const anchorAfterX = (point.x - zoomed.rect.left) / zoomed.scale;
    assert.ok(Math.abs(anchorBeforeX - anchorAfterX) < 1.5,
      `pointer X anchor must stay fixed (${anchorBeforeX} -> ${anchorAfterX})`);

    const anchorBeforeY = (point.y - initial.rect.top) / initial.scale;
    const anchorAfterY = (point.y - zoomed.rect.top) / zoomed.scale;
    assert.ok(Math.abs(anchorBeforeY - anchorAfterY) < 1.5,
      `pointer Y anchor must stay fixed (${anchorBeforeY} -> ${anchorAfterY})`);

    await reset(browser, sessionId);
    const resetState = await viewState(browser, sessionId);
    assert.equal(resetState.scale, 1, 'reset restores 1x');
    assert.equal(resetState.transform, 'matrix(1, 0, 0, 1, 0, 0)', 'reset restores identity transform');

    await wheelAt(browser, sessionId, point.x, point.y, { deltaY: -120, ctrl: true });
    await settle();
    const afterCtrl = await viewState(browser, sessionId);
    assert.equal(afterCtrl.scale, 1, 'Ctrl+wheel must not zoom Archify');
    assert.equal(afterCtrl.x, 0, 'Ctrl+wheel must not move the camera');
    assert.equal(afterCtrl.y, 0, 'Ctrl+wheel must not move the camera');
  });
});

test('wheel gestures the camera cannot consume keep native page scrolling', {
  skip: browserSkip,
}, async () => {
  await withArtifact(async (browser, artifact) => {
    // The reviewed reproduction: a 1440x700 page whose cards sit below the graph.
    const sessionId = await loadArtifact(browser, artifact, { width: 1440, height: 700 });
    await installWheelLog(browser, sessionId);
    const page = await pageState(browser, sessionId);
    assert.ok(page.scrollable > 40,
      `fixture must render content below the graph (scrollable ${page.scrollable})`);

    // 1x, wheel down: the camera cannot zoom out, so the page must scroll.
    await scrollTo(browser, sessionId, 0);
    await reset(browser, sessionId);
    await evaluate(browser, sessionId, `window.__archifyWheelLog.length = 0`);
    const floorPoint = await diagramPoint(browser, sessionId);
    await wheelAt(browser, sessionId, floorPoint.x, floorPoint.y, { deltaY: 120 });
    await settle();
    const atFloor = await viewState(browser, sessionId);
    const scrolled = await pageState(browser, sessionId);
    const floorLog = await wheelLog(browser, sessionId);
    assert.equal(atFloor.scale, 1, 'wheel down at 1x must not change the camera');
    assert.equal(floorLog.at(-1)?.prevented, false, 'wheel down at 1x must not preventDefault');
    assert.ok(scrolled.scrollY > 0, `wheel down at 1x must scroll the page (scrollY ${scrolled.scrollY})`);

    // 3x, wheel up: the camera cannot zoom in any further, so the page must scroll.
    await scrollTo(browser, sessionId, 0);
    await reset(browser, sessionId);
    for (let step = 0; step < 4; step += 1) {
      const climb = await diagramPoint(browser, sessionId);
      await wheelAt(browser, sessionId, climb.x, climb.y, { deltaY: -120 });
      await settle(240);
    }
    const ceiling = await viewState(browser, sessionId);
    assert.equal(ceiling.scale, 3, 'fixture must reach the 3x ceiling before the bound check');
    const room = await pageState(browser, sessionId);
    await scrollTo(browser, sessionId, Math.min(120, Math.max(40, Math.floor(room.scrollable / 2))));
    const parked = await pageState(browser, sessionId);
    assert.ok(parked.scrollY > 0, 'fixture must park below the top before testing the upper bound');
    await evaluate(browser, sessionId, `window.__archifyWheelLog.length = 0`);
    const ceilingPoint = await diagramPoint(browser, sessionId);
    await wheelAt(browser, sessionId, ceilingPoint.x, ceilingPoint.y, { deltaY: -120 });
    await settle();
    const atCeiling = await viewState(browser, sessionId);
    const ceilingScroll = await pageState(browser, sessionId);
    const ceilingLog = await wheelLog(browser, sessionId);
    assert.equal(atCeiling.scale, 3, 'wheel up at 3x must not change the camera');
    assert.equal(ceilingLog.at(-1)?.prevented, false, 'wheel up at 3x must not preventDefault');
    assert.ok(ceilingScroll.scrollY < parked.scrollY,
      `wheel up at 3x must scroll the page (${parked.scrollY} -> ${ceilingScroll.scrollY})`);
  });
});

test('excluded UI and horizontal wheel never zoom', {
  skip: browserSkip,
}, async () => {
  await withArtifact(async (browser, artifact) => {
    // 1440x900 keeps the navigation overlay inside the viewport with no page
    // scrolling. A scrolled page cannot host these checks: right after a scroll
    // the headless compositor can still hit-test the pre-scroll offset, so the
    // wheel lands on the diagram and the overlay never sees the gesture. The
    // native-scroll consequence of a declined gesture is covered by the bounds
    // case above, which runs unscrolled at 1440x700.
    const sessionId = await loadArtifact(browser, artifact, { width: 1440, height: 900 });
    await installWheelLog(browser, sessionId);
    await reset(browser, sessionId);
    const start = await pageState(browser, sessionId);
    assert.equal(start.scrollY, 0, 'excluded-UI checks must start with an unscrolled page');

    const nav = await evaluate(browser, sessionId, `(function () {
      var node = document.querySelector('.diagram-container .diagram-nav');
      var rect = node.getBoundingClientRect();
      var x = rect.left + rect.width / 2;
      var y = rect.top + rect.height / 2;
      var hit = document.elementFromPoint(x, y);
      return {
        x: x,
        y: y,
        visible: rect.top >= 0 && rect.bottom <= window.innerHeight && rect.width > 0,
        hitsOverlay: !!(hit && hit.closest && hit.closest('.diagram-nav'))
      };
    })()`);
    assert.ok(nav.visible, 'fixture must show the excluded navigation overlay inside the viewport');
    assert.ok(nav.hitsOverlay, 'the wheel point must land on the excluded navigation overlay');

    // Wheel up zooms in on the stage. Over the excluded overlay it must not.
    await evaluate(browser, sessionId, `window.__archifyWheelLog.length = 0`);
    await wheelAt(browser, sessionId, nav.x, nav.y, { deltaY: -120 });
    await settle();
    const overlayLog = await wheelLog(browser, sessionId);
    const afterOverlay = await viewState(browser, sessionId);
    const overlayPage = await pageState(browser, sessionId);
    assert.equal(afterOverlay.scale, 1,
      `wheel over the excluded overlay must not zoom: ${JSON.stringify(overlayLog)}`);
    assert.equal(overlayLog.at(-1)?.prevented, false,
      'wheel over the excluded overlay must not preventDefault');
    assert.equal(overlayPage.scrollY, 0, 'the excluded overlay must not consume the gesture');

    // The same gesture on the stage does zoom, so the check above is meaningful.
    const stage = await diagramPoint(browser, sessionId);
    await wheelAt(browser, sessionId, stage.x, stage.y, { deltaY: -120 });
    await settle();
    const zoomed = await viewState(browser, sessionId);
    assert.ok(zoomed.scale > 1, 'fixture must zoom in before the horizontal checks');

    // Horizontal input is never a zoom gesture, including Shift+wheel.
    await evaluate(browser, sessionId, `window.__archifyWheelLog.length = 0`);
    const horizontalPoint = await diagramPoint(browser, sessionId);
    await wheelAt(browser, sessionId, horizontalPoint.x, horizontalPoint.y, { deltaY: 120, shift: true });
    await wheelAt(browser, sessionId, horizontalPoint.x, horizontalPoint.y, { deltaX: 120, deltaY: 0 });
    await settle();
    const afterHorizontal = await viewState(browser, sessionId);
    const horizontalLog = await wheelLog(browser, sessionId);
    assert.equal(afterHorizontal.scale, zoomed.scale, 'horizontal wheel must not zoom');
    assert.deepEqual(horizontalLog.map((entry) => entry.prevented), [false, false],
      'horizontal wheel must not preventDefault');
  });
});
