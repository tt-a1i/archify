import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
const TITLE = 'Preparation phase';

// Phase headings identify authored timeline sections in Read and Full detail.
// A real browser resolves the preset/theme ink and the opaque title plate.
test('sequence phase headings retain readable contrast in Read and Full detail', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser contrast checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-segment-contrast-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const input = path.join(scratch, 'segment.json');
  const file = path.join(scratch, 'segment.html');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1, diagram_type: 'sequence',
    meta: { title: 'Phase heading contrast', output: 'segment.html', quality_profile: 'showcase' },
    participants: [
      { id: 'client', type: 'external', label: 'Client' },
      { id: 'api', type: 'backend', label: 'API' },
      { id: 'worker', type: 'cloud', label: 'Worker' },
      { id: 'db', type: 'database', label: 'DB' },
    ],
    segments: [{ from: 145, to: 205, label: TITLE }],
    messages: [{ from: 'client', to: 'api', y: 170, label: 'Begin request' }],
  }));
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/sequence/render-sequence.mjs'), input, file]);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(file).href });
  await loaded;
  await run('document.fonts.ready');
  await run('Archify.readerLayout.whenStable()');
  for (const mode of ['read', 'full']) {
    if (mode === 'full') await run('for (let i = 0; i < 3; i++) Archify.view.zoomIn()');
    for (const preset of ['classic', 'signal-flow', 'blueprint', 'editorial']) {
      for (const theme of ['light', 'dark']) {
        await t.test(`${preset} ${theme} ${mode} phase heading has at least 4.5:1 contrast`, async () => {
          await run(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
            document.documentElement.setAttribute('data-preset', ${JSON.stringify(preset)});
            document.querySelector('.diagram-container > svg').setAttribute('data-preset', ${JSON.stringify(preset)});
            new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
          const colors = await run(`(() => {
            const group = document.querySelector('[data-graph-role="segment-label"]');
            const title = group.querySelector('text'), plate = group.querySelector('rect');
            const style = getComputedStyle(title), plateStyle = getComputedStyle(plate);
            const rgba = value => {
              const parts = value.match(/[\\d.]+/g).map(Number);
              return [...parts.slice(0, 3), parts[3] ?? 1];
            };
            const background = rgba(plateStyle.fill), foreground = rgba(style.fill);
            const luminance = rgb => rgb.slice(0, 3).map(c => {
              c /= 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
            const a = luminance(foreground), b = luminance(background);
            const visible = [title, plate, group].every(el => {
              const s = getComputedStyle(el);
              return s.opacity === '1' && s.visibility === 'visible' && s.display !== 'none';
            });
            const box = title.getBBox(), plateBox = plate.getBBox();
            return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
              foreground, background, fillOpacity: style.fillOpacity, plateFillOpacity: plateStyle.fillOpacity,
              visible, title: title.textContent, count: document.querySelectorAll('[data-graph-role="segment-label"]').length,
              detail: document.querySelector('.diagram-container').dataset.detailLevel,
              contained: box.x >= plateBox.x && box.y >= plateBox.y && box.x + box.width <= plateBox.x + plateBox.width && box.y + box.height <= plateBox.y + plateBox.height };
          })()`);
          assert.equal(colors.count, 1);
          assert.equal(colors.title, TITLE, 'the authored heading is retained');
          assert.equal(colors.detail, mode);
          assert.equal(colors.visible, true, 'contrast is measured on visible text and plate');
          assert.equal(colors.contained, true, 'the measured plate lies behind the complete heading');
          assert.equal(colors.foreground[3], 1);
          assert.equal(colors.background[3], 1, 'the title plate is opaque');
          assert.equal(colors.fillOpacity, '1');
          assert.equal(colors.plateFillOpacity, '1');
          t.diagnostic(`${preset} ${theme} ${mode}: ${colors.ratio.toFixed(5)}:1; foreground ${colors.foreground}; plate ${colors.background}`);
          assert.ok(colors.ratio >= 4.5, `phase heading contrast ${colors.ratio.toFixed(3)}:1 must be at least 4.5:1`);
        });
      }
    }
  }
});
