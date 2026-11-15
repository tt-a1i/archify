import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
const PRESETS = ['classic', 'signal-flow', 'blueprint', 'editorial'];
const VARIANTS = ['default', 'emphasis', 'security', 'dashed'];
const EDGES = ['calls', 'writes', 'checks', 'queues'];

// Default relationship labels sit on an opaque mask. Light palettes give them
// readable muted ink while the connector keeps its quiet --arrow stroke; dark
// palettes keep --arrow for both. Colored variants keep their connector color.
test('default relationship labels are readable on their mask in every preset and state', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser contrast checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-edge-label-contrast-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const input = path.join(scratch, 'architecture.json');
  const artifact = path.join(scratch, 'architecture.html');
  fs.writeFileSync(input, JSON.stringify({
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Edge label contrast', output: 'architecture.html', quality_profile: 'standard' },
    components: ['frontend', 'backend', 'database', 'security', 'cloud'].map((type, index) => ({
      id: 'abcde'[index], type, label: `Node ${index + 1}`, pos: [40 + index * 280, 40], size: [160, 70],
    })),
    boundaries: [],
    connections: EDGES.map((id, index) => ({
      id, from: 'abcde'[index], to: 'abcde'[index + 1], label: id,
      ...(VARIANTS[index] === 'default' ? {} : { variant: VARIANTS[index] }),
    })),
    cards: [],
  }));
  execFileSync(process.execPath, [cli, 'render', 'architecture', input, artifact]);

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
  await send('Page.navigate', { url: pathToFileURL(artifact).href });
  await loaded;
  await run('document.fonts.ready');
  await run(`document.documentElement.setAttribute('data-motion', 'still'); Archify.readerLayout.whenStable()`);

  const measure = `(async () => {
    const panel = document.querySelector('.diagram-container');
    Archify.view.reveal([...document.querySelectorAll('[data-node-id]')].map(node => node.dataset.nodeId), { instant: true, maxScale: 1 });
    await Promise.all(panel.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rgba = value => {
      const parts = value.match(/[\\d.]+/g).map(Number);
      return [...parts.slice(0, 3), parts[3] ?? 1];
    };
    const luminance = rgb => rgb.slice(0, 3).map(c => {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
    const token = name => {
      const probe = document.createElement('span');
      probe.style.color = 'var(' + name + ')';
      panel.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const svg = panel.querySelector('svg');
    return {
      theme: document.documentElement.dataset.theme, preset: svg.dataset.preset,
      present: document.documentElement.dataset.present === 'true',
      focus: svg.hasAttribute('data-focus-active'), detail: panel.dataset.detailLevel,
      arrow: token('--arrow'), muted: token('--text-muted'),
      edges: ${JSON.stringify(EDGES)}.map(id => {
        const group = svg.querySelector('g[data-edge-id="' + id + '"]');
        const route = svg.querySelector('path[data-edge-id="' + id + '"]');
        const text = group.querySelector('text'), mask = group.querySelector('rect.c-mask');
        const ink = getComputedStyle(text), plate = getComputedStyle(mask);
        const foreground = rgba(ink.fill), background = rgba(plate.fill);
        const alpha = foreground[3] * Number(ink.fillOpacity);
        const rendered = foreground.slice(0, 3).map((c, i) => c * alpha + background[i] * (1 - alpha));
        const a = luminance(rendered), b = luminance(background);
        const opacity = [];
        for (let node = text; node && node !== svg; node = node.parentElement) opacity.push(Number(getComputedStyle(node).opacity));
        return { id, text: text.textContent, labelClass: text.getAttribute('class'), fill: ink.fill,
          stroke: getComputedStyle(route).stroke, pathClass: route.getAttribute('class'),
          visible: ink.display !== 'none' && ink.visibility !== 'hidden',
          maskAlpha: background[3] * Number(plate.fillOpacity) * Number(plate.opacity), opacity,
          ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
      }),
    };
  })()`;

  function check(observed, { theme, preset, state, print = false }) {
    assert.equal(observed.theme, theme);
    assert.equal(observed.preset, preset);
    assert.equal(observed.detail, 'full', 'relationship labels are measured where they are shown');
    assert.equal(observed.present, state === 'presentation');
    assert.equal(observed.focus, state === 'focused');
    const lightInk = theme === 'light' || print;
    observed.edges.forEach((edge, index) => {
      const variant = VARIANTS[index];
      assert.equal(edge.text, edge.id, 'the authored label is retained');
      assert.equal(edge.pathClass, `a-${variant}`);
      assert.equal(edge.labelClass, `t-edge-${variant}`);
      assert.equal(edge.visible, true);
      if (variant !== 'default') {
        assert.equal(edge.fill, edge.stroke, `${variant} label keeps its connector color`);
        return;
      }
      assert.equal(edge.stroke, observed.arrow, 'the default connector keeps its --arrow stroke');
      assert.equal(edge.maskAlpha, 1, 'the label mask is the opaque text background');
      assert.ok(edge.opacity.every(value => value === 1), `the default label is opaque: ${edge.opacity}`);
      assert.equal(edge.fill, lightInk ? observed.muted : observed.arrow,
        lightInk ? 'light and print labels use --text-muted' : 'dark labels keep --arrow');
      t.diagnostic(`${preset} ${theme}${print ? ' print' : ''} ${state}: default label ${edge.ratio.toFixed(3)}:1, fill ${edge.fill}`);
      assert.ok(edge.ratio >= 4.5, `${preset} ${theme} ${state} default label is ${edge.ratio.toFixed(3)}:1`);
    });
  }

  for (const preset of PRESETS) {
    for (const theme of ['light', 'dark']) {
      for (const state of ['normal', 'presentation', 'focused']) {
        await t.test(`${preset} ${theme} ${state}`, async () => {
          await run(`(() => {
            document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)});
            Archify.preset.apply(${JSON.stringify(preset)});
            Archify.focus.clear();
            if (Archify.presentation.active()) Archify.presentation.exit();
            if (${JSON.stringify(state)} === 'presentation') Archify.presentation.enter();
            if (${JSON.stringify(state)} === 'focused') Archify.focus.set('a', { updateUrl: false });
            return Archify.readerLayout.whenStable();
          })()`);
          check(await run(measure), { theme, preset, state });
        });
      }
    }
  }

  await t.test('classic print uses light label ink from either theme', async () => {
    await run(`Archify.focus.clear(); if (Archify.presentation.active()) Archify.presentation.exit(); Archify.preset.apply('classic')`);
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    try {
      for (const theme of ['light', 'dark']) {
        await run(`document.documentElement.setAttribute('data-theme', ${JSON.stringify(theme)}); Archify.readerLayout.whenStable()`);
        check(await run(measure), { theme, preset: 'classic', state: 'normal', print: true });
      }
    } finally {
      await send('Emulation.setEmulatedMedia', { media: '' });
    }
  });
});
