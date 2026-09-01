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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-semantic-passport-move-'));
const chromePath = process.env.ARCHIFY_CHROME ? findChrome() : null;
let artifactSequence = 0;

function renderArtifact(locale = 'en', animation = null) {
  artifactSequence += 1;
  const artifact = path.join(tmp, `passport-move-${artifactSequence}.html`);
  let input = path.join(skillRoot, 'examples/web-app.architecture.json');
  if (locale !== 'en' || animation) {
    const document = JSON.parse(fs.readFileSync(input, 'utf8'));
    document.meta.locale = locale;
    if (animation) document.meta.animation = animation;
    input = path.join(tmp, `passport-move-${artifactSequence}.${locale}.json`);
    fs.writeFileSync(input, JSON.stringify(document));
  }
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    input,
    artifact,
  ]);
  return artifact;
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

async function loadArtifact(browser, artifact, { width = 1440, height = 900, mobile = false } = {}) {
  const sessionId = await browser.sessionPromise;
  await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
  }, sessionId);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
  const navigation = await browser.cdp.send('Page.navigate', {
    url: pathToFileURL(artifact).href,
  }, sessionId);
  if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
  await loaded;
  await evaluate(browser, sessionId, `(function () {
    document.documentElement.setAttribute('data-motion', 'still');
    var fontsReady = document.fonts && document.fonts.ready
      ? document.fonts.ready.catch(function () {})
      : Promise.resolve();
    return fontsReady.then(function () {
      return new Promise(function (resolve) {
        requestAnimationFrame(function () { requestAnimationFrame(resolve); });
      });
    });
  })()`, true);
  return sessionId;
}

async function settle(browser, sessionId, delay = 0) {
  await evaluate(browser, sessionId, `new Promise(function (resolve) {
    setTimeout(function () {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    }, ${delay});
  })`, true);
}

async function passportState(browser, sessionId) {
  return evaluate(browser, sessionId, `(function () {
    var chip = document.getElementById('focus-chip');
    var handle = document.getElementById('btn-focus-move');
    var container = document.querySelector('.diagram-container');
    var chipRect = chip.getBoundingClientRect();
    var handleRect = handle.getBoundingClientRect();
    var containerRect = container.getBoundingClientRect();
    return {
      hidden: chip.hidden,
      manual: chip.getAttribute('data-manual-placement'),
      dragging: chip.getAttribute('data-panel-dragging'),
      styleLeft: chip.style.left,
      styleTop: chip.style.top,
      chip: { left: chipRect.left, top: chipRect.top, right: chipRect.right, bottom: chipRect.bottom, width: chipRect.width, height: chipRect.height },
      handle: { left: handleRect.left, top: handleRect.top, right: handleRect.right, bottom: handleRect.bottom, width: handleRect.width, height: handleRect.height },
      handleDisplay: getComputedStyle(handle).display,
      container: { left: containerRect.left, top: containerRect.top, right: containerRect.right, bottom: containerRect.bottom, width: containerRect.width, height: containerRect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      scroll: { left: container.scrollLeft, width: container.scrollWidth, clientWidth: container.clientWidth },
      wide: container.getAttribute('data-wide-diagram')
    };
  })()`);
}

async function focusNode(browser, sessionId, id) {
  const focused = await evaluate(browser, sessionId, `Archify.focus.set(${JSON.stringify(id)}, { toggle: false })`);
  assert.equal(focused, true, `could not focus ${id}`);
  await settle(browser, sessionId, 40);
  return passportState(browser, sessionId);
}

async function dragMouse(browser, sessionId, from, to, { release = true } = {}) {
  await browser.cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: from.x,
    y: from.y,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  }, sessionId);
  await browser.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: to.x,
    y: to.y,
    button: 'left',
    buttons: 1,
  }, sessionId);
  if (release) {
    await browser.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: to.x,
      y: to.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    }, sessionId);
  }
  await settle(browser, sessionId, 20);
}

async function dragHandleTo(browser, sessionId, target) {
  const state = await passportState(browser, sessionId);
  assert.notEqual(state.handleDisplay, 'none', JSON.stringify(state, null, 2));
  const start = {
    x: state.handle.left + state.handle.width / 2,
    y: state.handle.top + state.handle.height / 2,
  };
  await dragMouse(browser, sessionId, start, target);
  return passportState(browser, sessionId);
}

async function pressKey(browser, sessionId, key, { shift = false } = {}) {
  const modifiers = shift ? 8 : 0;
  await browser.cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code: key,
    modifiers,
  }, sessionId);
  await browser.cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code: key,
    modifiers,
  }, sessionId);
  await settle(browser, sessionId, 20);
}

function assertBounded(state, padding) {
  const minimumLeft = Math.max(state.container.left + padding, padding);
  const maximumRight = Math.min(state.container.right - padding, state.viewport.width - padding);
  const minimumTop = Math.max(state.container.top + padding, padding);
  const maximumBottom = Math.min(state.container.bottom - padding, state.viewport.height - padding);
  assert.ok(state.chip.left >= minimumLeft - 2, JSON.stringify({ state, minimumLeft }, null, 2));
  assert.ok(state.chip.right <= maximumRight + 2, JSON.stringify({ state, maximumRight }, null, 2));
  assert.ok(state.chip.top >= minimumTop - 2, JSON.stringify({ state, minimumTop }, null, 2));
  assert.ok(state.chip.bottom <= maximumBottom + 2, JSON.stringify({ state, maximumBottom }, null, 2));
}

function overlaps(first, second, gap = 0) {
  return first.left < second.right + gap
    && first.right > second.left - gap
    && first.top < second.bottom + gap
    && first.bottom > second.top - gap;
}

test('Semantic Passport pointer movement honors threshold, capture, four-edge clamp, persistence, cancel, and resets', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await loadArtifact(browser, renderArtifact());
    const initial = await focusNode(browser, sessionId, 'lb');
    const handleCenter = {
      x: initial.handle.left + initial.handle.width / 2,
      y: initial.handle.top + initial.handle.height / 2,
    };

    await dragMouse(browser, sessionId, handleCenter, { x: handleCenter.x + 2, y: handleCenter.y });
    const belowThreshold = await passportState(browser, sessionId);
    assert.equal(belowThreshold.manual, null, JSON.stringify({ initial, belowThreshold }, null, 2));
    assert.ok(Math.abs(belowThreshold.chip.left - initial.chip.left) <= 1, JSON.stringify({ initial, belowThreshold }, null, 2));
    assert.ok(Math.abs(belowThreshold.chip.top - initial.chip.top) <= 1, JSON.stringify({ initial, belowThreshold }, null, 2));

    const moved = await dragHandleTo(browser, sessionId, {
      x: handleCenter.x + 180,
      y: handleCenter.y + 90,
    });
    assert.equal(moved.manual, 'true', JSON.stringify(moved, null, 2));
    assert.ok(moved.chip.left > initial.chip.left + 100, JSON.stringify({ initial, moved }, null, 2));
    assert.ok(moved.chip.top > initial.chip.top + 40, JSON.stringify({ initial, moved }, null, 2));
    assertBounded(moved, 16);

    const beforeCancel = moved;
    const cancelStart = {
      x: moved.handle.left + moved.handle.width / 2,
      y: moved.handle.top + moved.handle.height / 2,
    };
    await dragMouse(browser, sessionId, cancelStart, {
      x: cancelStart.x + 70,
      y: cancelStart.y + 50,
    }, { release: false });
    const duringCancelDrag = await passportState(browser, sessionId);
    assert.notEqual(duringCancelDrag.styleLeft, beforeCancel.styleLeft, JSON.stringify({ beforeCancel, duringCancelDrag }, null, 2));

    // A responsive breakpoint can hide the handle and invalidate the live
    // placement while the pointer is still captured. Cancellation must restore
    // the pre-drag coordinates in private state, ready for desktop to return.
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 700,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await settle(browser, sessionId, 160);
    await evaluate(browser, sessionId, `document.getElementById('btn-focus-move').dispatchEvent(new PointerEvent('pointercancel', {
      bubbles: true,
      pointerId: 1,
      pointerType: 'mouse'
    }))`);
    await browser.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: cancelStart.x + 70,
      y: cancelStart.y + 50,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    }, sessionId);
    await settle(browser, sessionId, 20);
    const cancelledOnMobile = await passportState(browser, sessionId);
    assert.equal(cancelledOnMobile.handleDisplay, 'none', JSON.stringify(cancelledOnMobile, null, 2));
    assert.equal(cancelledOnMobile.manual, null, JSON.stringify(cancelledOnMobile, null, 2));
    assert.equal(cancelledOnMobile.dragging, null, JSON.stringify(cancelledOnMobile, null, 2));

    await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await settle(browser, sessionId, 160);
    const cancelled = await passportState(browser, sessionId);
    assert.equal(cancelled.manual, 'true', JSON.stringify(cancelled, null, 2));
    assert.equal(cancelled.styleLeft, beforeCancel.styleLeft, JSON.stringify({ beforeCancel, cancelled }, null, 2));
    assert.equal(cancelled.styleTop, beforeCancel.styleTop, JSON.stringify({ beforeCancel, cancelled }, null, 2));
    assert.equal(cancelled.dragging, null, JSON.stringify(cancelled, null, 2));

    const topLeft = await dragHandleTo(browser, sessionId, { x: 1, y: 1 });
    assertBounded(topLeft, 16);
    assert.ok(Math.abs(topLeft.chip.left - Math.max(topLeft.container.left + 16, 16)) <= 2, JSON.stringify(topLeft, null, 2));
    assert.ok(Math.abs(topLeft.chip.top - Math.max(topLeft.container.top + 16, 16)) <= 2, JSON.stringify(topLeft, null, 2));

    const bottomRight = await dragHandleTo(browser, sessionId, {
      x: topLeft.viewport.width - 1,
      y: topLeft.viewport.height - 1,
    });
    assertBounded(bottomRight, 16);
    assert.ok(Math.abs(bottomRight.chip.right - Math.min(bottomRight.container.right - 16, bottomRight.viewport.width - 16)) <= 2, JSON.stringify(bottomRight, null, 2));
    assert.ok(Math.abs(bottomRight.chip.bottom - Math.min(bottomRight.container.bottom - 16, bottomRight.viewport.height - 16)) <= 2, JSON.stringify(bottomRight, null, 2));

    const stable = await dragHandleTo(browser, sessionId, { x: 80, y: 160 });
    const switched = await focusNode(browser, sessionId, 'api');
    assert.equal(switched.manual, 'true', JSON.stringify({ stable, switched }, null, 2));
    assert.equal(switched.styleLeft, stable.styleLeft, JSON.stringify({ stable, switched }, null, 2));
    assert.equal(switched.styleTop, stable.styleTop, JSON.stringify({ stable, switched }, null, 2));

    await browser.cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x: switched.handle.left + switched.handle.width / 2,
      y: switched.handle.top + switched.handle.height / 2,
      button: 'left',
      buttons: 1,
      clickCount: 2,
    }, sessionId);
    await browser.cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: switched.handle.left + switched.handle.width / 2,
      y: switched.handle.top + switched.handle.height / 2,
      button: 'left',
      buttons: 0,
      clickCount: 2,
    }, sessionId);
    await settle(browser, sessionId, 40);
    const doubleClickReset = await passportState(browser, sessionId);
    assert.equal(doubleClickReset.manual, null, JSON.stringify(doubleClickReset, null, 2));
    assert.equal(doubleClickReset.styleLeft, '', JSON.stringify(doubleClickReset, null, 2));

    await dragHandleTo(browser, sessionId, { x: 220, y: 220 });
    await evaluate(browser, sessionId, `document.getElementById('btn-focus-clear').click()`);
    await settle(browser, sessionId, 20);
    const closed = await passportState(browser, sessionId);
    assert.equal(closed.hidden, true, JSON.stringify(closed, null, 2));
    assert.equal(closed.manual, null, JSON.stringify(closed, null, 2));
    assert.equal(closed.styleLeft, '', JSON.stringify(closed, null, 2));
    assert.equal(closed.styleTop, '', JSON.stringify(closed, null, 2));

    const reopened = await focusNode(browser, sessionId, 'lb');
    assert.equal(reopened.manual, null, JSON.stringify(reopened, null, 2));
    assert.equal(reopened.styleLeft, '', JSON.stringify(reopened, null, 2));
  } finally {
    await browser.close();
  }
});

test('Semantic Passport keyboard movement uses coarse/fine steps, Home reset, and resize reclamping', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await loadArtifact(browser, renderArtifact());
    const initial = await focusNode(browser, sessionId, 'lb');
    await evaluate(browser, sessionId, `document.getElementById('btn-focus-move').focus()`);

    await pressKey(browser, sessionId, 'ArrowRight');
    const coarse = await passportState(browser, sessionId);
    assert.equal(coarse.manual, 'true', JSON.stringify(coarse, null, 2));
    assert.ok(Math.abs(coarse.chip.left - initial.chip.left - 16) <= 1, JSON.stringify({ initial, coarse }, null, 2));

    await pressKey(browser, sessionId, 'ArrowLeft', { shift: true });
    const fine = await passportState(browser, sessionId);
    assert.ok(Math.abs(fine.chip.left - coarse.chip.left + 4) <= 1, JSON.stringify({ coarse, fine }, null, 2));

    await pressKey(browser, sessionId, 'Home');
    const reset = await passportState(browser, sessionId);
    assert.equal(reset.manual, null, JSON.stringify(reset, null, 2));
    assert.equal(reset.styleLeft, '', JSON.stringify(reset, null, 2));

    const corner = await dragHandleTo(browser, sessionId, {
      x: initial.viewport.width - 1,
      y: initial.viewport.height - 1,
    });
    assert.equal(corner.manual, 'true', JSON.stringify(corner, null, 2));

    await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 940,
      height: 640,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await settle(browser, sessionId, 240);
    const resized = await passportState(browser, sessionId);
    assert.equal(resized.manual, 'true', JSON.stringify(resized, null, 2));
    assertBounded(resized, 16);
    assert.ok(resized.chip.left < corner.chip.left, JSON.stringify({ corner, resized }, null, 2));
    assert.ok(resized.chip.top < corner.chip.top, JSON.stringify({ corner, resized }, null, 2));

    await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 700,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await settle(browser, sessionId, 160);
    const mobile = await passportState(browser, sessionId);
    assert.equal(mobile.handleDisplay, 'none', JSON.stringify(mobile, null, 2));
    assert.equal(mobile.manual, null, JSON.stringify(mobile, null, 2));
    assert.equal(mobile.styleLeft, '', JSON.stringify(mobile, null, 2));
    assertBounded(mobile, 8);

    await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 940,
      height: 640,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);
    await settle(browser, sessionId, 160);
    const restoredDesktop = await passportState(browser, sessionId);
    assert.equal(restoredDesktop.handleDisplay, 'block', JSON.stringify(restoredDesktop, null, 2));
    assert.equal(restoredDesktop.manual, 'true', JSON.stringify(restoredDesktop, null, 2));
    assertBounded(restoredDesktop, 16);
  } finally {
    await browser.close();
  }
});

test('mobile scrolling and wide coarse pointers keep automatic placement and hide the move affordance', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await loadArtifact(browser, renderArtifact(), { width: 390, height: 600 });
    const initial = await focusNode(browser, sessionId, 'lb');
    assert.equal(initial.wide, 'true', JSON.stringify(initial, null, 2));
    assert.equal(initial.handleDisplay, 'none', JSON.stringify(initial, null, 2));
    assert.equal(initial.manual, null, JSON.stringify(initial, null, 2));
    assert.ok(initial.scroll.width > initial.scroll.clientWidth, JSON.stringify(initial, null, 2));

    await evaluate(browser, sessionId, `(function () {
      var container = document.querySelector('.diagram-container');
      container.scrollLeft = container.scrollWidth - container.clientWidth;
      container.dispatchEvent(new Event('scroll'));
    })()`);
    await settle(browser, sessionId, 80);
    const scrolled = await passportState(browser, sessionId);
    assert.equal(scrolled.handleDisplay, 'none', JSON.stringify(scrolled, null, 2));
    assert.equal(scrolled.manual, null, JSON.stringify(scrolled, null, 2));
    assert.ok(scrolled.scroll.left > 0, JSON.stringify(scrolled, null, 2));
    assertBounded(scrolled, 8);

    await browser.cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 1,
    }, sessionId);
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1024,
      height: 768,
      deviceScaleFactor: 1,
      mobile: true,
    }, sessionId);
    await settle(browser, sessionId, 180);
    const coarse = await passportState(browser, sessionId);
    const coarseInput = await evaluate(browser, sessionId, `(function () {
      var chip = document.getElementById('focus-chip');
      var handle = document.getElementById('btn-focus-move');
      var before = { manual: chip.getAttribute('data-manual-placement'), left: chip.style.left, top: chip.style.top };
      handle.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true, pointerId: 91, pointerType: 'touch', button: 0, buttons: 1, clientX: 120, clientY: 120
      }));
      handle.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true, pointerId: 91, pointerType: 'touch', button: 0, buttons: 1, clientX: 240, clientY: 220
      }));
      handle.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true, pointerId: 91, pointerType: 'touch', button: 0, buttons: 0, clientX: 240, clientY: 220
      }));
      return {
        coarse: matchMedia('(pointer: coarse)').matches,
        fine: matchMedia('(hover: hover) and (pointer: fine)').matches,
        before: before,
        after: { manual: chip.getAttribute('data-manual-placement'), left: chip.style.left, top: chip.style.top }
      };
    })()`);
    assert.equal(coarse.viewport.width, 1024, JSON.stringify(coarse, null, 2));
    assert.equal(coarse.handleDisplay, 'none', JSON.stringify(coarse, null, 2));
    assert.equal(coarseInput.coarse, true, JSON.stringify(coarseInput, null, 2));
    assert.equal(coarseInput.fine, false, JSON.stringify(coarseInput, null, 2));
    assert.deepEqual(coarseInput.after, coarseInput.before, JSON.stringify(coarseInput, null, 2));
  } finally {
    await browser.close();
  }
});

test('move affordance exposes localized accessible names and a visible keyboard focus ring', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await loadArtifact(browser, renderArtifact());
    await focusNode(browser, sessionId, 'lb');

    async function accessibilityState() {
      await browser.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab' }, sessionId);
      await browser.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab' }, sessionId);
      return evaluate(browser, sessionId, `(function () {
        var handle = document.getElementById('btn-focus-move');
        handle.focus({ preventScroll: true, focusVisible: true });
        var style = getComputedStyle(handle);
        return {
          ariaLabel: handle.getAttribute('aria-label'),
          title: handle.getAttribute('title'),
          active: document.activeElement === handle,
          focusVisible: handle.matches(':focus-visible'),
          outlineStyle: style.outlineStyle,
          outlineWidth: style.outlineWidth
        };
      })()`);
    }

    const english = await accessibilityState();
    assert.equal(english.ariaLabel, 'Move semantic passport. Drag, use arrow keys, or press Home to reset.');
    assert.equal(english.title, english.ariaLabel);
    assert.equal(english.active, true, JSON.stringify(english, null, 2));
    assert.equal(english.focusVisible, true, JSON.stringify(english, null, 2));
    assert.equal(english.outlineStyle, 'solid', JSON.stringify(english, null, 2));
    assert.equal(english.outlineWidth, '2px', JSON.stringify(english, null, 2));

    await loadArtifact(browser, renderArtifact('zh-CN'));
    await focusNode(browser, sessionId, 'lb');
    const chinese = await accessibilityState();
    assert.equal(chinese.ariaLabel, '移动语义护照。可拖动、使用方向键移动，或按 Home 恢复自动位置。');
    assert.equal(chinese.title, chinese.ariaLabel);
    assert.equal(chinese.active, true, JSON.stringify(chinese, null, 2));
    assert.equal(chinese.focusVisible, true, JSON.stringify(chinese, null, 2));
    assert.equal(chinese.outlineStyle, 'solid', JSON.stringify(chinese, null, 2));
    assert.equal(chinese.outlineWidth, '2px', JSON.stringify(chinese, null, 2));
  } finally {
    await browser.close();
  }
});

test('manual Passport placement composes with Radar, Legend, Dock, and clean SVG, PNG, and WebM export', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await loadArtifact(browser, renderArtifact('en', 'trace'));
    await focusNode(browser, sessionId, 'lb');
    const manual = await dragHandleTo(browser, sessionId, { x: 520, y: 230 });
    assert.equal(manual.manual, 'true', JSON.stringify(manual, null, 2));

    const exported = await evaluate(browser, sessionId, `(async function () {
      var objectUrlBlobs = [];
      var originalCreateObjectURL = URL.createObjectURL;
      var originalClick = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = function (blob) {
        objectUrlBlobs.push(blob);
        return originalCreateObjectURL.call(URL, blob);
      };
      HTMLAnchorElement.prototype.click = function () {};
      async function summarize(blobs) {
        var forbidden = ['focus-chip', 'btn-focus-move', 'relationship-lens-drag-handle', 'data-manual-placement', 'data-panel-dragging'];
        var sourceBlobs = blobs.filter(function (blob) { return blob.type.indexOf('image/svg+xml') === 0; });
        var sources = await Promise.all(sourceBlobs.map(function (blob) { return blob.text(); }));
        return {
          blobs: blobs.map(function (blob) { return { type: blob.type, size: blob.size }; }),
          sources: sources.map(function (text) {
            return {
              bytes: text.length,
              forbidden: forbidden.filter(function (token) { return text.indexOf(token) !== -1; }),
              rootFocusActive: /<svg\\b[^>]*\\bdata-focus-active=/.test(text)
            };
          })
        };
      }
      try {
        await Archify.exportMenu.run('svg');
        var svg = await summarize(objectUrlBlobs.splice(0));
        await Archify.exportMenu.run('png');
        var png = await summarize(objectUrlBlobs.splice(0));
        var canRecordWebm = Archify.motion.canRecord();
        var webm = canRecordWebm ? await Archify.motion.recordWebm({ duration: 300, fps: 5 }) : null;
        var webmSources = await summarize(objectUrlBlobs.splice(0));
        return {
          canonical: document.documentElement.getAttribute('data-last-export-canonical'),
          manual: document.getElementById('focus-chip').getAttribute('data-manual-placement'),
          svg: svg,
          png: png,
          webm: webmSources,
          canRecordWebm: canRecordWebm,
          webmBlob: webm ? { type: webm.type, size: webm.size } : null,
          liveSvg: document.querySelector('.diagram-container > svg').outerHTML
        };
      } finally {
        URL.createObjectURL = originalCreateObjectURL;
        HTMLAnchorElement.prototype.click = originalClick;
      }
    })()`, true);
    assert.equal(exported.canonical, 'true', JSON.stringify(exported, null, 2));
    assert.equal(exported.manual, 'true', JSON.stringify(exported, null, 2));
    for (const format of ['svg', 'png', 'webm']) {
      assert.ok(exported[format].sources.length > 0, `${format} did not serialize the canonical diagram: ${JSON.stringify(exported[format], null, 2)}`);
      for (const serialization of exported[format].sources) {
        assert.ok(serialization.bytes > 0, JSON.stringify({ format, serialization }, null, 2));
        assert.deepEqual(serialization.forbidden, [], JSON.stringify({ format, serialization }, null, 2));
        assert.equal(serialization.rootFocusActive, false, JSON.stringify({ format, serialization }, null, 2));
      }
    }
    assert.ok(exported.svg.blobs.some((blob) => blob.type.startsWith('image/svg+xml') && blob.size > 0), JSON.stringify(exported.svg.blobs, null, 2));
    assert.ok(exported.png.blobs.some((blob) => blob.type === 'image/png' && blob.size > 0), JSON.stringify(exported.png.blobs, null, 2));
    assert.equal(exported.canRecordWebm, true, JSON.stringify(exported, null, 2));
    assert.match(exported.webmBlob.type, /^video\/webm/, JSON.stringify(exported.webmBlob, null, 2));
    assert.ok(exported.webmBlob.size > 0, JSON.stringify(exported.webmBlob, null, 2));
    assert.equal(exported.liveSvg.includes('btn-focus-move'), false);

    const combined = await evaluate(browser, sessionId, `(async function () {
      Archify.radar.open();
      await new Promise(function (resolve) { setTimeout(resolve, 120); });
      var radar = document.getElementById('overview-map');
      var radarRect = radar.getBoundingClientRect();
      var passport = document.getElementById('focus-chip');
      var passportRect = passport.getBoundingClientRect();
      var manualBeforeDock = passport.getAttribute('data-manual-placement');
      var beforeScale = Archify.view.state().scale;
      document.querySelector('.diagram-nav [data-view="in"]').click();
      await new Promise(function (resolve) {
        requestAnimationFrame(function () { requestAnimationFrame(resolve); });
      });
      return {
        radarHidden: radar.hidden,
        radar: { left: radarRect.left, top: radarRect.top, right: radarRect.right, bottom: radarRect.bottom },
        passport: { left: passportRect.left, top: passportRect.top, right: passportRect.right, bottom: passportRect.bottom },
        manualBeforeDock: manualBeforeDock,
        manualAfterDock: passport.getAttribute('data-manual-placement'),
        beforeScale: beforeScale,
        afterScale: Archify.view.state().scale
      };
    })()`, true);
    assert.equal(combined.radarHidden, false, JSON.stringify(combined, null, 2));
    assert.equal(combined.manualBeforeDock, 'true', JSON.stringify(combined, null, 2));
    assert.equal(overlaps(combined.radar, combined.passport, 10), false, JSON.stringify(combined, null, 2));
    assert.ok(combined.afterScale > combined.beforeScale, JSON.stringify(combined, null, 2));

    const lens = await evaluate(browser, sessionId, `(async function () {
      var entry = document.querySelector('[data-legend-kind][role="button"]');
      entry.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await new Promise(function (resolve) {
        requestAnimationFrame(function () { requestAnimationFrame(resolve); });
      });
      var panel = document.getElementById('semantic-lens');
      return {
        passportHidden: document.getElementById('focus-chip').hidden,
        radarHidden: document.getElementById('overview-map').hidden,
        lensHidden: panel.hidden,
        dockSide: panel.getAttribute('data-dock-side'),
        lensActive: document.querySelector('.diagram-container > svg').getAttribute('data-lens-active')
      };
    })()`, true);
    assert.equal(lens.passportHidden, true, JSON.stringify(lens, null, 2));
    assert.equal(lens.radarHidden, true, JSON.stringify(lens, null, 2));
    assert.equal(lens.lensHidden, false, JSON.stringify(lens, null, 2));
    assert.match(lens.dockSide || '', /^(left|right)$/, JSON.stringify(lens, null, 2));
    assert.ok(lens.lensActive, JSON.stringify(lens, null, 2));
  } finally {
    await browser.close();
  }
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
