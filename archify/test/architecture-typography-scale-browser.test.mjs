import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('architecture typography scale keeps real-browser text inside the SVG in ordinary and present modes', async (t) => {
  if (!Object.hasOwn(process.env, 'ARCHIFY_CHROME')) return t.skip('Set ARCHIFY_CHROME for real browser checks');
  const chrome = findChrome();
  assert.ok(chrome);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-typography-scale-browser-'));
  const input = path.join(dir, 'input.json');
  const output = path.join(dir, 'output.html');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Typography scale browser', output: 'output.html', quality_profile: 'showcase', typography_scale: 1.25 },
    components: [
      { id: 'gateway', type: 'backend', label: 'Gateway', sublabel: 'request broker', tag: 'edge', pos: [80, 130], size: [150, 72] },
      { id: 'store', type: 'database', label: 'Store', sublabel: 'durable records', tag: 'primary', pos: [390, 130], size: [150, 72] },
    ],
    boundaries: [{ kind: 'region', label: 'Application zone', wraps: ['gateway', 'store'] }],
    connections: [{ from: 'gateway', to: 'store', label: 'writes records' }],
  }));
  execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'render', 'architecture', input, output]);
  const browser = new ChromeVisualBrowser(chrome);
  try {
    const session = await browser.sessionPromise;
    const send = (method, params = {}) => browser.cdp.send(method, params, session);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    for (const presentation of [false, true]) {
      for (const theme of ['light', 'dark']) {
        const url = pathToFileURL(output);
        url.searchParams.set('theme', theme);
        if (presentation) url.searchParams.set('present', '1');
        const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
        await send('Page.navigate', { url: url.href });
        await loaded;
        const result = await send('Runtime.evaluate', {
          awaitPromise: true,
          returnByValue: true,
          expression: `(async () => {
            await document.fonts.ready;
            await Archify.layoutStability.whenStable();
            const svg = document.querySelector('.diagram-container > svg');
            const svgRect = svg.getBoundingClientRect();
            const bounds = { left: svgRect.left, top: svgRect.top, right: svgRect.right, bottom: svgRect.bottom };
            const text = [...svg.querySelectorAll('text')].map((entry) => {
              const box = entry.getBoundingClientRect();
              return { value: entry.textContent, left: box.left, top: box.top, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
            }).filter((entry) => entry.width > 0 && entry.height > 0);
            const primary = [...svg.querySelectorAll('text[data-node-label]')].map((entry) => Number(entry.getAttribute('font-size')));
            return { bounds, text, primary, scrollWidth: document.documentElement.scrollWidth };
          })()`,
        });
        assert.equal(result.exceptionDetails, undefined);
        const observed = result.result.value;
        const label = `${presentation ? 'present' : 'ordinary'}/${theme}`;
        assert.ok(Math.min(...observed.primary) >= 13.7, `${label}: primary label was not scaled`);
        for (const text of observed.text) {
          assert.ok(text.left >= observed.bounds.left - 1 && text.right <= observed.bounds.right + 1
            && text.top >= observed.bounds.top - 1 && text.bottom <= observed.bounds.bottom + 1,
          `${label}: text escaped SVG: ${JSON.stringify(text)}`);
        }
        assert.ok(observed.scrollWidth <= 1440, `${label}: horizontal document overflow`);
      }
    }
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
