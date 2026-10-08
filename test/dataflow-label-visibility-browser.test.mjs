import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/dataflow-label-visibility.json', import.meta.url));

test('dataflow classification plates preserve their own connector in Read and Detail', async (t) => {
  if (!Object.hasOwn(process.env, 'ARCHIFY_CHROME')) return t.skip('Set ARCHIFY_CHROME for real browser checks');
  const chrome = findChrome();
  assert.ok(chrome, 'The configured browser regression requires Chrome');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dataflow-label-visibility-'));
  const browser = new ChromeVisualBrowser(chrome);
  try {
    const artifact = path.join(dir, 'diagram.html');
    execFileSync(process.execPath, [cli, 'render', 'dataflow', fixture, artifact], { stdio: ['ignore', 'pipe', 'pipe'] });
    const session = await browser.sessionPromise;
    for (const theme of ['light', 'dark']) {
      for (const mode of ['read', 'full']) {
        await t.test(`${theme}/${mode}`, async () => {
          await browser.inspect({ artifactPath: artifact, width: 1440, height: 900, theme });
          const evaluated = await browser.cdp.send('Runtime.evaluate', {
            awaitPromise: true, returnByValue: true,
            expression: `(async () => {
              const panel = document.querySelector('.diagram-container');
              if (${JSON.stringify(mode)} === 'full') {
                const zoomIn = panel.querySelector('button[data-view="in"]');
                for (let click = 0; click < 5 && Archify.view.state().scale < 1.75; click++) zoomIn.click();
              }
              await document.fonts.ready;
              // Detail opacity transitions must finish before measuring visibility.
              await Promise.all([...panel.getAnimations({ subtree: true })].map(animation => animation.finished.catch(() => {})));
              const svg = panel.querySelector(':scope > svg');
              const route = svg.querySelector('path[data-edge-id="launch"]');
              const label = svg.querySelector('g[data-detail="context"][data-edge-id="launch"]');
              const mask = label.querySelector('rect');
              const rect = element => {
                const box = element.getBoundingClientRect();
                return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
              };
              const maskBox = rect(mask), matrix = route.getScreenCTM();
              const stroke = getComputedStyle(route);
              const length = route.getTotalLength();
              const covered = [];
              // This reproduction has one horizontal connector. Sample its actual
              // rendered centerline against the actual opaque plate drawn above it.
              for (let sample = 0; sample <= 200; sample++) {
                const point = route.getPointAtLength(length * sample / 200).matrixTransform(matrix);
                if (point.x > maskBox.left && point.x < maskBox.right
                    && point.y > maskBox.top && point.y < maskBox.bottom) covered.push(sample);
              }
              return {
                theme: document.documentElement.dataset.theme,
                mode: panel.dataset.detailLevel, scale: Archify.view.state().scale,
                stroke: stroke.stroke, strokeOpacity: Number(stroke.strokeOpacity),
                mask: { box: maskBox, fill: getComputedStyle(mask).fill, opacity: Number(getComputedStyle(mask).opacity) },
                coveredSamples: covered.length,
                labels: [...label.querySelectorAll('text')].map(text => ({
                  value: text.textContent, box: rect(text), fine: text.dataset.detail === 'fine',
                  opacity: Number(getComputedStyle(text).opacity), fill: getComputedStyle(text).fill,
                })),
              };
            })()`,
          }, session);
          assert.equal(evaluated.exceptionDetails, undefined, evaluated.exceptionDetails?.text);
          const observed = evaluated.result.value;
          assert.equal(observed.theme, theme);
          assert.equal(observed.mode, mode);
          if (mode === 'read') assert.equal(observed.scale, 1);
          else assert.ok(observed.scale >= 1.75, 'Detail must use the real zoom control');
          assert.deepEqual(observed.labels.map(({ value }) => value), ['argv / JSON-RPC', 'Native flags']);
          assert.notEqual(observed.stroke, 'none');
          assert.notEqual(observed.stroke, observed.mask.fill, 'the connector must contrast with its plate');
          assert.ok(observed.strokeOpacity > 0);
          assert.notEqual(observed.mask.fill, 'none');
          assert.equal(observed.mask.opacity, 1);
          const classification = observed.labels.find(({ fine }) => fine);
          assert.equal(classification.opacity, mode === 'read' ? 0 : 1, 'Read hides classification; Detail reveals it');
          for (const label of observed.labels.filter(({ opacity }) => opacity > 0)) {
            const box = label.box, mask = observed.mask.box;
            assert.ok(box.left >= mask.left - 0.5 && box.right <= mask.right + 0.5
              && box.top >= mask.top - 0.5 && box.bottom <= mask.bottom + 0.5,
            'real visible glyph bounds must fit the complete label plate: ' + JSON.stringify({ label, mask }));
            assert.notEqual(label.fill, observed.mask.fill, 'the themed label must remain visible against its plate');
          }
          assert.equal(observed.coveredSamples, 0,
            'the complete classification plate must not conceal its own connector: ' + JSON.stringify(observed));
        });
      }
    }
  } finally {
    await browser.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
