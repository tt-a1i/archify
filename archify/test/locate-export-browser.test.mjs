import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import { disposeBundleFixture, stageBundleFixture } from './helpers/bundle-fixture.mjs';

const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
test('SVG export removes Locate projection and inside counts without changing the live diagram', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run Locate export browser checks.',
}, async (t) => {
  const directory = stageBundleFixture({ prefix: 'archify-locate-export-' });
  t.after(() => disposeBundleFixture(directory));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  await browser.inspect({ artifactPath: path.join(directory, 'checkout-platform.html'), width: 1440, height: 900, theme: 'light' });
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  const result = await browser.cdp.send('Runtime.evaluate', {
    awaitPromise: true, returnByValue: true,
    expression: `(async () => {
      const svg = document.querySelector('.diagram-container > svg');
      const payments = svg.querySelector('[data-node-id="payments"]');
      const original = URL.createObjectURL;
      let blob;
      URL.createObjectURL = function (value) {
        if (value.type.startsWith('image/svg+xml')) blob = value;
        return original.call(URL, value);
      };
      try {
        await Archify.exportMenu.run('svg');
        const pristine = await blob.text();
        Archify.drilldown.applyProjection({ payments: 'touched' }, [payments], { payments: 3 });
        svg.setAttribute('data-locate-active', 'true');
        const before = svg.outerHTML;
        const count = payments.querySelector('[data-locate-inside-count]').textContent;
        await Archify.exportMenu.run('svg');
        const exported = await blob.text();
        const root = new DOMParser().parseFromString(exported, 'image/svg+xml').documentElement;
        return { pristine, exported, count, liveUnchanged: svg.outerHTML === before,
          active: root.hasAttribute('data-locate-active'),
          transient: root.querySelectorAll('[data-locate-state], [data-locate-inside], [data-locate-inside-count]').length };
      } finally { URL.createObjectURL = original; }
    })()`,
  }, await browser.sessionPromise);
  assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
  const value = result.result.value;
  assert.equal(value.count, '3', 'fixture must exercise an actual runtime badge');
  assert.equal(value.liveUnchanged, true);
  assert.equal(value.active, false);
  assert.equal(value.transient, 0, 'temporary Locate state must not enter the exported SVG');
  assert.equal(value.exported.replace(/ style=""/g, ''), value.pristine.replace(/ style=""/g, ''));
});
