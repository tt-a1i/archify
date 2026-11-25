import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { injectUpdateNotice } from '../archify/bin/update-notice.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chromeConfigured = Object.prototype.hasOwnProperty.call(process.env, 'ARCHIFY_CHROME');
const chromePath = chromeConfigured ? findChrome() : null;
if (chromeConfigured && !chromePath) {
  throw new Error(`ARCHIFY_CHROME does not resolve to an executable browser: ${process.env.ARCHIFY_CHROME}`);
}

// The adaptive reader fits the first screen and keeps only the Viewer footer
// below the fold. A notice appended after that footer made the reader shrink
// the diagram; inside the footer the first screen stays identical.
test('the update notice leaves the Viewer first screen unchanged, prints hidden, and dismisses', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-update-notice-browser-'));
  const plain = path.join(scratch, 'plain.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(skillRoot, 'examples/checkout-ledger.architecture.json'),
    plain,
  ]);
  const noticed = path.join(scratch, 'noticed.html');
  const injected = injectUpdateNotice(fs.readFileSync(plain, 'utf8'), {
    installedVersion: '2.15.0', availableVersion: '2.16.0', severity: 'normal',
    releaseNotes: 'https://github.com/tt-a1i/archify/releases/tag/v2.16.0',
  });
  assert.equal(injected.embedded, true);
  fs.writeFileSync(noticed, injected.html);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const session = await browser.sessionPromise;
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, session);
    const load = async (file, media = 'screen') => {
      await browser.cdp.send('Emulation.setEmulatedMedia', { media }, session);
      const url = pathToFileURL(file);
      url.searchParams.set('theme', 'light');
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      loaded.catch(() => {});
      await browser.cdp.send('Page.navigate', { url: url.href }, session);
      await loaded;
      const result = await browser.cdp.send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: `Archify.layoutStability.whenStable().then(function () {
          var rect = function (element) { var box = element.getBoundingClientRect(); return [box.x, box.y, box.width, box.height].map(Math.round); };
          var notice = document.querySelector('[data-archify-update-notice]');
          var shown = function () { return Boolean(notice) && getComputedStyle(notice).display !== 'none' && notice.getBoundingClientRect().height > 0; };
          var state = {
            diagram: rect(document.querySelector('.diagram-container')),
            svg: rect(document.querySelector('.diagram-container svg')),
            readerWidth: document.documentElement.style.getPropertyValue('--archify-reader-width'),
            shown: shown()
          };
          if (notice) notice.querySelector('.archify-update-notice__close').click();
          state.dismissed = Boolean(notice) && !shown();
          return state;
        })`,
      }, session, 20000);
      assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
      return result.result.value;
    };
    const base = await load(plain);
    const candidate = await load(noticed);
    assert.equal(candidate.shown, true);
    assert.equal(candidate.dismissed, true);
    assert.deepEqual(
      { diagram: candidate.diagram, svg: candidate.svg, readerWidth: candidate.readerWidth },
      { diagram: base.diagram, svg: base.svg, readerWidth: base.readerWidth },
    );
    assert.equal((await load(noticed, 'print')).shown, false);
  } finally {
    await browser.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
