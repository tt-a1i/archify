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
  await evaluate(browser, sessionId, `(function () {
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

async function wheelAt(browser, sessionId, x, y, deltaY, ctrl = false) {
  await browser.cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX: 0,
    deltaY,
    modifiers: ctrl ? 2 : 0,
  }, sessionId);
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

async function reset(browser, sessionId) {
  await evaluate(browser, sessionId, `Archify.view.reset()`);
  await evaluate(browser, sessionId, `new Promise(function (resolve) {
    requestAnimationFrame(function () { requestAnimationFrame(resolve); });
  })`, true);
}

test('plain wheel zooms toward the pointer and leaves Ctrl+wheel untouched', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-wheel-zoom-'));
  const artifact = path.join(tmp, 'wheel-zoom.html');
  try {
    execFileSync(process.execPath, [
      path.join(skillRoot, 'bin', 'archify.mjs'),
      'render',
      'workflow',
      path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'),
      artifact,
      '--quality',
      'showcase',
    ], { cwd: skillRoot, encoding: 'utf8' });

    const browser = new ChromeVisualBrowser(chromePath);
    try {
      const sessionId = await loadArtifact(browser, artifact);
      const initial = await viewState(browser, sessionId);

      const cx = initial.rect.left + initial.rect.width * 0.34;
      const cy = initial.rect.top + initial.rect.height * 0.31;

      await wheelAt(browser, sessionId, cx, cy, -120);
      await new Promise((resolve) => setTimeout(resolve, 420));
      const zoomed = await viewState(browser, sessionId);

      assert.ok(zoomed.scale > initial.scale, `plain wheel must zoom in (${initial.scale} -> ${zoomed.scale})`);
      assert.notEqual(zoomed.scale, initial.scale, 'plain wheel must not pass through unchanged');

      const anchorBefore = (cx - initial.rect.left) / initial.scale;
      const anchorAfter = (cx - zoomed.rect.left) / zoomed.scale;
      assert.ok(Math.abs(anchorBefore - anchorAfter) < 1.5,
        `pointer anchor must stay fixed (${anchorBefore} -> ${anchorAfter})`);

      await reset(browser, sessionId);
      const resetState = await viewState(browser, sessionId);
      assert.equal(resetState.scale, 1, 'reset restores 1x');
      assert.equal(resetState.transform, 'matrix(1, 0, 0, 1, 0, 0)', 'reset restores identity transform');

      await wheelAt(browser, sessionId, cx, cy, -120, true);
      await new Promise((resolve) => setTimeout(resolve, 420));
      const afterCtrl = await viewState(browser, sessionId);
      assert.equal(afterCtrl.scale, 1, 'Ctrl+wheel must not zoom Archify');
      assert.equal(afterCtrl.x, 0, 'Ctrl+wheel must not move the camera');
      assert.equal(afterCtrl.y, 0, 'Ctrl+wheel must not move the camera');
    } finally {
      await browser.close();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
