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

async function loadArtifact(browser, artifactPath) {
  const sessionId = await browser.sessionPromise;
  await browser.cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  }, sessionId);
  const loaded = browser.cdp.waitFor('Page.loadEventFired', sessionId);
  const navigation = await browser.cdp.send('Page.navigate', {
    url: pathToFileURL(artifactPath).href,
  }, sessionId);
  if (navigation.errorText) throw new Error(`Chrome navigation failed: ${navigation.errorText}`);
  await loaded;
  await evaluate(browser, sessionId, `(function () {
    document.documentElement.setAttribute('data-motion', 'still');
    return new Promise(function (resolve) {
      requestAnimationFrame(function () { requestAnimationFrame(resolve); });
    });
  })()`, true);
  return sessionId;
}

test('lifecycle rail stays ordinary in READ and hides for hover, relationship preview, and committed focus', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-lifecycle-rail-browser-'));
  const artifact = path.join(tmp, 'agent-run.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/lifecycle/render-lifecycle.mjs'),
    path.join(skillRoot, 'examples/agent-run.lifecycle.json'),
    artifact,
  ]);

  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const sessionId = await loadArtifact(browser, artifact);
    const states = await evaluate(browser, sessionId, `(async function () {
      function settle(delay) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            requestAnimationFrame(function () { requestAnimationFrame(resolve); });
          }, delay || 0);
        });
      }
      function snapshot() {
        var svg = document.querySelector('svg');
        var rail = svg.querySelector('[data-lifecycle-rail]');
        return {
          railPresent: Boolean(rail),
          railSemantic: rail ? rail.hasAttribute('data-edge-from') || rail.hasAttribute('data-edge-to') : null,
          railOpacity: rail ? getComputedStyle(rail).opacity : null,
          finePointer: window.matchMedia('(hover: hover) and (pointer: fine)').matches,
          intent: svg.hasAttribute('data-intent-trace-active'),
          relationship: svg.hasAttribute('data-relationship-preview-active'),
          focus: svg.hasAttribute('data-focus-active')
        };
      }

      var svg = document.querySelector('svg');
      var node = svg.querySelector('[data-node-id="executing"]');
      var relationship = svg.querySelector('[data-relationship-hit-overlay] [data-relationship-hit-key]');
      var initial = snapshot();

      node.dispatchEvent(new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse',
        pointerId: 1
      }));
      await settle(180);
      var nodeHover = snapshot();

      node.dispatchEvent(new PointerEvent('pointerout', {
        bubbles: true,
        pointerType: 'mouse',
        pointerId: 1,
        relatedTarget: svg
      }));
      await settle(40);

      relationship.dispatchEvent(new PointerEvent('pointerover', {
        bubbles: true,
        pointerType: 'mouse',
        pointerId: 2
      }));
      await settle(180);
      var relationshipHover = snapshot();

      relationship.dispatchEvent(new PointerEvent('pointerout', {
        bubbles: true,
        pointerType: 'mouse',
        pointerId: 2,
        relatedTarget: svg
      }));
      await settle(180);

      node.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      await settle(40);
      var committedFocus = snapshot();

      return { initial, nodeHover, relationshipHover, committedFocus };
    })()`, true);

    assert.equal(states.initial.railPresent, true, JSON.stringify(states, null, 2));
    assert.equal(states.initial.railSemantic, false, JSON.stringify(states, null, 2));
    assert.notEqual(states.initial.railOpacity, '0', JSON.stringify(states, null, 2));

    assert.equal(states.nodeHover.intent, true, JSON.stringify(states, null, 2));
    assert.equal(states.nodeHover.railOpacity, '0', JSON.stringify(states, null, 2));

    assert.equal(states.relationshipHover.relationship, true, JSON.stringify(states, null, 2));
    assert.equal(states.relationshipHover.railOpacity, '0', JSON.stringify(states, null, 2));

    assert.equal(states.committedFocus.focus, true, JSON.stringify(states, null, 2));
    assert.equal(states.committedFocus.railOpacity, '0', JSON.stringify(states, null, 2));
  } finally {
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
