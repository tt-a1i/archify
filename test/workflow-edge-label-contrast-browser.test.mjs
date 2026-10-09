import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));

test('workflow default labels and lane headings remain readable without recoloring semantic ink', async (t) => {
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
    lanes: [
      { id: 'work', label: 'Work' },
      { id: 'normal', label: 'Normal', variant: 'normal' },
      { id: 'exception', label: 'Exception', variant: 'exception' },
    ],
    nodes: [...Array.from({ length: 6 }, (_, col) => ({
      id: `n${col}`, lane: 'work', col, type: 'backend', label: `Step ${col + 1}`,
    })),
      { id: 'normal-node', lane: 'normal', col: 0, type: 'backend', label: 'Normal node' },
      { id: 'exception-node', lane: 'exception', col: 0, type: 'security', label: 'Exception node' },
    ],
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
    await t.test(`${theme} Full-detail labels and normal lane headings meet classic contrast`, async () => {
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
          const over = (foreground, background, alpha = foreground[3]) =>
            foreground.slice(0, 3).map((c, i) => c * alpha + background[i] * (1 - alpha));
          const contrast = (foreground, background) => {
            const a = luminance(foreground), b = luminance(background);
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
          };
          const surface = getComputedStyle(panel), body = getComputedStyle(document.body);
          const dotColors = surface.backgroundImage.match(/rgba?\\([^)]*\\)/g) || [];
          const dot = dotColors.length === 2 ? rgba(dotColors[0]) : null;
          const beneathPanel = [];
          for (let node = panel.parentElement; node && node !== document.body; node = node.parentElement) {
            const style = getComputedStyle(node);
            beneathPanel.push({ color: style.backgroundColor, image: style.backgroundImage, opacity: style.opacity });
          }
          const panelBackground = over(rgba(surface.backgroundColor), rgba(body.backgroundColor));
          // A peak CSS dot covers the panel before the translucent SVG lane.
          // This bounds the declared gradient colors, not sampled glyph pixels.
          const dotBackground = dot ? over(dot, panelBackground) : null;
          const lanes = [...panel.querySelectorAll('[data-composition-frame-kind="lane"]')].map(frame => {
            let text = frame.nextElementSibling;
            const exceptionFrame = text.matches('[data-composition-frame-kind="exception-lane"]') ? text : null;
            if (exceptionFrame) text = text.nextElementSibling;
            const ink = getComputedStyle(text), plate = getComputedStyle(frame), foreground = rgba(ink.fill);
            const laneFill = rgba(plate.fill), laneAlpha = laneFill[3] * Number(plate.fillOpacity);
            const flat = over(laneFill, panelBackground, laneAlpha);
            const peak = dotBackground && over(laneFill, dotBackground, laneAlpha);
            const inkAlpha = foreground[3] * Number(ink.fillOpacity);
            const opacity = [];
            for (let node = text; node; node = node.parentElement) opacity.push(Number(getComputedStyle(node).opacity));
            return { label: text.textContent, fill: ink.fill, fontSize: ink.fontSize, fontWeight: ink.fontWeight,
              visibility: ink.visibility, display: ink.display, opacity, laneOpacity: Number(plate.opacity),
              flatBackground: flat, dotPeakBackground: peak,
              flatRatio: contrast(over(foreground, flat, inkAlpha), flat),
              dotPeakRatio: peak && contrast(over(foreground, peak, inkAlpha), peak),
              exceptionStroke: exceptionFrame && getComputedStyle(exceptionFrame).stroke,
              exceptionClass: exceptionFrame && text.getAttribute('class') };
          });
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
            motion: document.documentElement.dataset.motion,
            detail: panel.dataset.detailLevel, scale: Archify.view.state().scale, edges, lanes, beneathPanel,
            surface: { image: surface.backgroundImage,
              bodyImage: body.backgroundImage, bodyAlpha: rgba(body.backgroundColor)[3], dotColors,
              dotEndAlpha: dotColors.length === 2 ? rgba(dotColors[1])[3] : null,
              svgBackground: getComputedStyle(panel.querySelector('svg')).backgroundColor,
              svgImage: getComputedStyle(panel.querySelector('svg')).backgroundImage,
              gridStrokes: [...panel.querySelectorAll('.c-grid')].map(grid => getComputedStyle(grid).stroke) } };
        })()`,
      }, session);
      assert.equal(evaluated.exceptionDetails, undefined, evaluated.exceptionDetails?.exception?.description);
      const observed = evaluated.result.value;
      assert.equal(observed.theme, theme);
      assert.equal(observed.preset, 'classic');
      assert.equal(observed.motion, 'still');
      assert.equal(observed.detail, 'full');
      assert.equal(observed.scale, 1);
      assert.equal(observed.surface.bodyImage, 'none', 'the classic body has a flat opaque base');
      assert.equal(observed.surface.bodyAlpha, 1);
      assert.equal(observed.surface.svgBackground, 'rgba(0, 0, 0, 0)');
      assert.equal(observed.surface.svgImage, 'none');
      assert.ok(observed.beneathPanel.every(surface => surface.color === 'rgba(0, 0, 0, 0)'
        && surface.image === 'none' && Number(surface.opacity) === 1), 'no intervening ancestor surface changes the backdrop');
      assert.match(observed.surface.image, /^radial-gradient\([^()]*rgba?\([^)]*\)[^()]*rgba?\([^)]*\)[^()]*\)(?:,\s*none)?$/,
        'the peak model requires a single radial gradient with no extra image layer');
      assert.equal(observed.surface.dotColors.length, 2, 'model the actual two-stop CSS dot rule');
      assert.equal(observed.surface.dotEndAlpha, 0, 'the dot blends to a transparent endpoint');
      assert.ok(observed.surface.gridStrokes.every(stroke => stroke === 'rgba(0, 0, 0, 0)'), 'classic SVG grid adds no visible ink');
      assert.deepEqual(observed.lanes.map(lane => lane.label), ['01 / Work', '02 / Normal', 'EX / Exception']);
      for (const lane of observed.lanes) {
        assert.equal(lane.fontSize, '10px');
        assert.equal(lane.fontWeight, '600');
        assert.ok(lane.opacity.every(value => value === 1));
        assert.equal(lane.laneOpacity, 1);
        assert.notEqual(lane.visibility, 'hidden');
        assert.notEqual(lane.display, 'none');
      }
      assert.equal(observed.lanes[2].exceptionClass, 't-security');
      assert.equal(observed.lanes[2].fill, observed.lanes[2].exceptionStroke, 'EX heading retains its semantic frame ink');
      assert.equal(observed.lanes[0].fill, observed.lanes[1].fill, 'default and explicit normal headings share their ink');
      for (const lane of observed.lanes.slice(0, 2)) {
        t.diagnostic(`${theme} ${lane.label}: flat ${lane.flatRatio.toFixed(6)}:1, CSS dot peak ${lane.dotPeakRatio.toFixed(6)}:1; fill ${lane.fill}; flat background ${lane.flatBackground}; dot peak background ${lane.dotPeakBackground}`);
      }
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
      assert.ok(observed.lanes.slice(0, 2).every(lane => Number.isFinite(lane.flatRatio)
        && Number.isFinite(lane.dotPeakRatio) && lane.flatRatio >= 4.5 && lane.dotPeakRatio >= 4.5),
        `classic normal headings must have at least 4.5:1 flat and CSS dot peak contrast: ${JSON.stringify(observed.lanes.slice(0, 2))}`);
    });
  }
});
