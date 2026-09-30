import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('an unbreakable token in a summary card wraps inside the card instead of overflowing the document', async (t) => {
  if (!Object.hasOwn(process.env, 'ARCHIFY_CHROME')) return t.skip('Set ARCHIFY_CHROME for real browser checks');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cards-rail-overflow-'));
  const input = path.join(dir, 'input.json');
  const output = path.join(dir, 'output.html');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Cards rail overflow', output: 'output.html', quality_profile: 'showcase' },
    components: [
      { id: 'client', type: 'frontend', label: 'Client', pos: [40, 80], size: [140, 60] },
      { id: 'api', type: 'backend', label: 'API', pos: [280, 80], size: [120, 60] },
      { id: 'store', type: 'database', label: 'Store', pos: [520, 80], size: [120, 60] },
    ],
    connections: [{ from: 'client', to: 'api' }, { from: 'api', to: 'store' }],
    cards: [
      { dot: 'cyan', title: 'Edge', items: ['CloudFront CDN fronts all traffic'] },
      { dot: 'emerald', title: 'Application', items: ['FastAPI behind an HTTPS load balancer'] },
      { dot: 'violet', title: 'Data', items: ['PostgreSQL primary with a read replica'] },
      { dot: 'rose', title: 'Compliance', items: ['checkout/payment/refunds/ledger/reconciliation/verification/processor/boundary enforcement is documented end to end'] },
    ],
  }));
  execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'render', 'architecture', input, output]);
  const browser = new ChromeVisualBrowser(findChrome());
  try {
    const session = await browser.sessionPromise;
    const send = (method, params = {}) => browser.cdp.send(method, params, session);
    const evaluate = async (expression) => {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      assert.equal(result.exceptionDetails, undefined);
      return result.result?.value;
    };
    for (const [width, height] of [[1440, 900], [1600, 1000]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      await send('Page.navigate', { url: pathToFileURL(output).href });
      await loaded;
      for (const theme of ['light', 'dark']) {
        const observed = await evaluate(`(async () => {
          await document.fonts.ready;
          if (document.documentElement.dataset.theme !== '${theme}') document.getElementById('btn-theme').click();
          await Archify.layoutStability.whenStable();
          const cards = document.querySelector('.cards');
          return {
            cardCount: cards.querySelectorAll('.card').length,
            documentScrollWidth: document.documentElement.scrollWidth,
            cardsScrollWidth: cards.scrollWidth,
            cardsClientWidth: cards.clientWidth,
          };
        })()`);
        const label = `${width}x${height}/${theme}`;
        assert.equal(observed.cardCount, 4, label + ': fixture must render four cards');
        // The long token sits in one card; the grid track must never grow
        // past the card's share to fit it (issue #617).
        assert.ok(observed.documentScrollWidth <= width, label + ': horizontal overflow (scrollWidth ' + observed.documentScrollWidth + ' > ' + width + ')');
        assert.ok(observed.cardsScrollWidth <= observed.cardsClientWidth + 1, label + ': cards rail overflows internally ' + JSON.stringify(observed));
      }
    }
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
