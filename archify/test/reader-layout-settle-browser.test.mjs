import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeConfigured = Object.prototype.hasOwnProperty.call(process.env, 'ARCHIFY_CHROME');
const chromePath = chromeConfigured ? findChrome() : null;
if (chromeConfigured && !chromePath) {
  throw new Error(`ARCHIFY_CHROME does not resolve to an executable browser: ${process.env.ARCHIFY_CHROME}`);
}

// A portrait architecture whose conclusion cards rewrap as the Reader narrows.
// Before the settled-width cap, measure() widened the stage from the shorter
// cards, settle() narrowed it from the resulting overflow, and the two never
// met: whenStable() timed out and visual-check reported a runtime failure
// instead of a layout verdict.
test('Reader Layout settles when card height depends on the reader width', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-reader-settle-'));
  const output = path.join(scratch, 'portrait-cards.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(skillRoot, 'test/fixtures/architecture-viewport/portrait-cards.architecture.json'),
    output,
  ]);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const session = await browser.sessionPromise;
    for (const [width, height] of [[1440, 900], [2048, 1320]]) {
      await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, session);
      const url = pathToFileURL(output);
      url.searchParams.set('theme', 'light');
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      loaded.catch(() => {});
      await browser.cdp.send('Page.navigate', { url: url.href }, session);
      await loaded;
      const result = await browser.cdp.send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: `(function () {
          // Same page state visual-check establishes before its joint wait.
          document.documentElement.setAttribute('data-motion', 'still');
          var panel = document.querySelector('.diagram-container');
          if (panel) panel.setAttribute('data-detail-level', 'read');
          return Archify.layoutStability.whenStable();
        })().then(function (value) {
          var html = document.documentElement;
          return {
            sampledFrames: value.sampledFrames,
            readerWidth: html.style.getPropertyValue('--archify-reader-width'),
            overflow: html.getAttribute('data-reader-overflow'),
            scrollHeight: Math.ceil(html.scrollHeight),
            innerHeight: window.innerHeight
          };
        })`,
      }, session, 20000);
      assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
      const value = result.result.value;
      assert.ok(value.sampledFrames < 60, `${width}x${height} settled in ${value.sampledFrames} frames`);
      assert.match(value.readerWidth, /^\d+px$/);
      if (value.overflow === 'reduced') {
        assert.ok(value.scrollHeight <= value.innerHeight + 1,
          `${width}x${height}: a reduced reader must actually fit (${value.scrollHeight} vs ${value.innerHeight})`);
      }
    }
  } finally {
    await browser.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
