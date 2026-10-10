import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

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
    meta: {
      title: 'Redacted wide service topology', output: 'output.html', quality_profile: 'showcase',
      typography_scale: 1.25, viewBox: [1440, 520],
    },
    components: [
      { id: 'edge', type: 'backend', label: 'Edge request gateway', sublabel: 'authenticated ingress', tag: 'public API', pos: [80, 220], size: [210, 72] },
      { id: 'policy', type: 'backend', label: 'Authorization policy service', sublabel: 'tenant-aware decisions', tag: 'internal', pos: [430, 220], size: [210, 72] },
      { id: 'ledger', type: 'database', label: 'Durable audit ledger', sublabel: 'append-only records', tag: 'retention', pos: [780, 220], size: [210, 72] },
      { id: 'warehouse', type: 'database', label: 'Reporting warehouse', sublabel: 'governed analytical copy', tag: 'scheduled sync', pos: [1130, 220], size: [210, 72] },
      { id: 'compact', type: 'backend', label: 'Compact policy node', sublabel: 'scoped decisions', tag: 'internal', pos: [645, 355], size: [180, 60] },
      { id: 'tagged', type: 'backend', label: 'Compact tag node', tag: 'internal', pos: [925, 355], size: [180, 41] },
    ],
    boundaries: [{ kind: 'region', label: 'Redacted production service plane', wraps: ['edge', 'policy', 'ledger', 'warehouse', 'compact', 'tagged'] }],
    connections: [
      { from: 'edge', to: 'policy', label: 'authorize' },
      { from: 'policy', to: 'ledger', label: 'record' },
      { from: 'ledger', to: 'warehouse', label: 'replicate' },
    ],
  }));
  execFileSync(process.execPath, [path.join(root, 'archify/bin/archify.mjs'), 'render', 'architecture', input, output]);
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
            const components = [...svg.querySelectorAll('[data-node-id]')].map((node) => {
              const shape = [...node.children].find((entry) => entry.tagName === 'rect' && !entry.classList.contains('c-mask'));
              const box = shape.getBoundingClientRect();
              const text = [...node.querySelectorAll(':scope > text[data-node-label], :scope > text[data-detail="context"], :scope > text[data-detail="fine"]')]
                .map((entry) => {
                  const rect = entry.getBoundingClientRect();
                  return { value: entry.textContent, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
                });
              return { id: node.getAttribute('data-node-id'), box: { top: box.top, bottom: box.bottom, left: box.left, right: box.right }, text };
            });
            return { active: Archify.presentation.active(), bounds, text, primary, components, scrollWidth: document.documentElement.scrollWidth };
          })()`,
        });
        assert.equal(result.exceptionDetails, undefined);
        const observed = result.result.value;
        const label = `${presentation ? 'present' : 'ordinary'}/${theme}`;
        assert.equal(observed.active, presentation, `${label}: presentation mode state mismatch`);
        assert.ok(Math.min(...observed.primary) >= 10, `${label}: primary label fell below the scaled legible minimum`);
        assert.ok(Math.max(...observed.primary) >= 13.7, `${label}: no primary label retained the scaled preferred size`);
        for (const text of observed.text) {
          assert.ok(text.left >= observed.bounds.left - 1 && text.right <= observed.bounds.right + 1
            && text.top >= observed.bounds.top - 1 && text.bottom <= observed.bounds.bottom + 1,
          `${label}: text escaped SVG: ${JSON.stringify(text)}`);
        }
        for (const component of observed.components) {
          for (const text of component.text) {
            assert.ok(text.left >= component.box.left - 1 && text.right <= component.box.right + 1
              && text.top >= component.box.top - 1 && text.bottom <= component.box.bottom + 1,
            `${label}: ${component.id} text escaped its node: ${JSON.stringify(text)}`);
          }
          const ordered = [...component.text].sort((left, right) => left.top - right.top);
          for (let index = 1; index < ordered.length; index += 1) {
            assert.ok(ordered[index - 1].bottom <= ordered[index].top + 1,
              `${label}: ${component.id} text overlaps: ${JSON.stringify(ordered)}`);
          }
        }
        assert.ok(observed.scrollWidth <= 1440, `${label}: horizontal document overflow`);
      }
    }
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
