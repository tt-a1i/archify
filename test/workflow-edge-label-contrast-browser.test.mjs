import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));

test('workflow default labels remain readable without recoloring connectors or colored labels', async (t) => {
  if (!Object.hasOwn(process.env, 'ARCHIFY_CHROME')) return t.skip('Set ARCHIFY_CHROME for real browser checks');
  const chrome = findChrome();
  assert.ok(chrome, 'The configured browser regression requires Chrome');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workflow-label-contrast-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const input = path.join(scratch, 'workflow.json');
  const artifact = path.join(scratch, 'workflow.html');
  const variants = [undefined, 'default', 'emphasis', 'security', 'dashed'];
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 2, diagram_type: 'workflow',
    meta: { title: 'Workflow label contrast', output: 'workflow.html', quality_profile: 'standard' },
    lanes: [{ id: 'work', label: 'Work' }],
    nodes: Array.from({ length: 6 }, (_, col) => ({
      id: `n${col}`, lane: 'work', col, type: 'backend', label: `Step ${col + 1}`,
    })),
    edges: variants.map((variant, index) => ({
      id: `e${index}`, from: `n${index}`, to: `n${index + 1}`, label: `L${index}`,
      ...(variant ? { variant } : {}),
    })),
  }));
  execFileSync(process.execPath, [cli, 'render', 'workflow', input, artifact]);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  for (const theme of ['light', 'dark']) {
    await t.test(`${theme} Full-detail default and fallback labels have at least 4.5:1 contrast`, async () => {
      await browser.inspect({ artifactPath: artifact, width: 1440, height: 1100, theme });
      const evaluated = await browser.cdp.send('Runtime.evaluate', {
        awaitPromise: true, returnByValue: true,
        expression: `(async () => {
          await document.fonts.ready;
          Archify.view.reveal([...document.querySelectorAll('[data-node-id]')].map(node => node.dataset.nodeId), { instant: true, maxScale: 1 });
          const panel = document.querySelector('.diagram-container');
          await Promise.all(panel.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
          const rgba = value => {
            const parts = value.match(/[\\d.]+/g).map(Number);
            return [...parts.slice(0, 3), parts[3] ?? 1];
          };
          const luminance = rgb => rgb.slice(0, 3).map(c => {
            c /= 255;
            return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
          const edges = Array.from({ length: 5 }, (_, index) => {
            const route = document.querySelector('path[data-edge-id="e' + index + '"]');
            const group = document.querySelector('g[data-edge-id="e' + index + '"]');
            const text = group.querySelector('text'), mask = group.querySelector('rect.c-mask');
            const ink = getComputedStyle(text), plate = getComputedStyle(mask);
            const foreground = rgba(ink.fill), background = rgba(plate.fill);
            const alpha = foreground[3] * Number(ink.fillOpacity);
            const rendered = foreground.slice(0, 3).map((c, i) => c * alpha + background[i] * (1 - alpha));
            const a = luminance(rendered), b = luminance(background);
            const opacity = [];
            for (let node = text; node; node = node.parentElement) opacity.push(Number(getComputedStyle(node).opacity));
            const marker = route.getAttribute('marker-end').match(/#([^)]*)/)[1];
            return { index, label: text.textContent, labelClass: text.getAttribute('class'),
              fill: ink.fill, fontSize: ink.fontSize, visibility: ink.visibility, display: ink.display, opacity,
              maskAlpha: background[3] * Number(plate.fillOpacity) * Number(plate.opacity),
              pathClass: route.getAttribute('class'), stroke: getComputedStyle(route).stroke,
              markerFill: getComputedStyle(document.getElementById(marker).querySelector('polygon')).fill,
              foreground: rendered, background: background.slice(0, 3),
              ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
          });
          return { theme: document.documentElement.dataset.theme, preset: document.documentElement.dataset.preset,
            detail: panel.dataset.detailLevel, scale: Archify.view.state().scale, edges };
        })()`,
      }, session);
      assert.equal(evaluated.exceptionDetails, undefined, evaluated.exceptionDetails?.exception?.description);
      const observed = evaluated.result.value;
      assert.equal(observed.theme, theme);
      assert.equal(observed.preset, 'classic');
      assert.equal(observed.detail, 'full');
      assert.equal(observed.scale, 1);
      for (const edge of observed.edges) {
        const variant = variants[edge.index] || 'default';
        assert.equal(edge.label, `L${edge.index}`);
        assert.equal(edge.fontSize, '8px');
        assert.ok(edge.opacity.every(value => value === 1), 'measure visible text through opaque ancestors');
        assert.notEqual(edge.visibility, 'hidden');
        assert.notEqual(edge.display, 'none');
        assert.equal(edge.maskAlpha, 1, 'the existing opaque plate is the actual text background');
        assert.equal(edge.pathClass, `a-${variant}`);
        assert.equal(edge.markerFill, edge.stroke, 'arrowheads retain the connector color');
        if (edge.index < 2) {
          assert.ok(Number.isFinite(edge.ratio), 'the measured contrast is finite');
          assert.equal(edge.stroke, theme === 'light' ? 'rgb(148, 163, 184)' : 'rgb(100, 116, 139)', 'default connectors retain their existing ink');
          t.diagnostic(`${theme} ${edge.index === 0 ? 'fallback' : 'default'} label: ${edge.ratio.toFixed(3)}:1; foreground ${edge.foreground}; background ${edge.background}`);
        } else {
          assert.equal(edge.labelClass, `t-edge-${variant}`);
          assert.equal(edge.fill, edge.stroke, 'colored labels retain the semantic connector color');
        }
      }
      assert.ok(observed.edges.slice(0, 2).every(edge => edge.ratio >= 4.5),
        `default/fallback labels must have at least 4.5:1 contrast: ${JSON.stringify(observed.edges.slice(0, 2))}`);
    });
  }
});
