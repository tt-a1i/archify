import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../archify/bin/visual-check.mjs';
import { exportSvgArtifacts } from '../archify/renderers/shared/svg-export.mjs';
import { desktopBrowser } from './helpers/desktop-browser.mjs';
import { createScratchDirectory } from './helpers/scratch-directory.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

function changeSequence() {
  return {
    schema_version: 1,
    diagram_type: 'sequence',
    meta: { title: 'Checkout change pack', output: 'change.html' },
    participants: [
      { id: 'web', label: 'Web', type: 'frontend' },
      { id: 'api', label: 'Checkout API', type: 'backend', change: 'modified' },
      { id: 'ledger', label: 'Ledger', type: 'database', change: 'added' },
      { id: 'legacy', label: 'Legacy Pay', type: 'security', change: 'removed' },
    ],
    messages: [
      { id: 'm-create', from: 'web', to: 'api', y: 180, label: 'POST /checkout', change: 'modified' },
      { id: 'm-ledger', from: 'api', to: 'ledger', y: 250, label: 'append()', change: 'added' },
      { id: 'm-legacy', from: 'api', to: 'legacy', y: 320, label: 'charge()', change: 'removed' },
      { id: 'm-done', from: 'api', to: 'web', y: 390, label: '200 OK', variant: 'return' },
    ],
  };
}

// GitHub renders PR images through Camo inside a plain <img>: no scripts, no
// external fetches, no stylesheet from the page. This host page mimics that
// surface with file:// and data: sources and a prefers-color-scheme <picture>.
function hostPage(light, dark) {
  const dataUrl = (file) => `data:image/svg+xml;base64,${fs.readFileSync(file).toString('base64')}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#777}img{display:block}</style></head><body>
<img id="light-file" src="${pathToFileURL(light).href}" alt="light">
<img id="dark-file" src="${pathToFileURL(dark).href}" alt="dark">
<img id="light-data" src="${dataUrl(light)}" alt="light data">
<img id="dark-data" src="${dataUrl(dark)}" alt="dark data">
<a id="picture-link" href="${pathToFileURL(light).href}"><picture><source media="(prefers-color-scheme: dark)" srcset="${pathToFileURL(dark).href}"><img id="picture" alt="Checkout change pack" src="${pathToFileURL(light).href}"></picture></a>
</body></html>`;
}

async function openHost(t, hostFile, colorScheme) {
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.pageErrors=[];addEventListener('error',e=>pageErrors.push(e.message));` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 2400, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: colorScheme }] });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(hostFile).href });
  await loaded;
  await run(`Promise.all([...(document.images || [])].map((img) => img.complete ? Promise.resolve() : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; })))`);
  return { run, send };
}

// Opens the baked SVG as the document itself so its geometry can be measured;
// the file carries no scripts, so only the test's own CDP evaluation runs.
async function measureSvg(t, svgFile, colorScheme) {
  const { run } = await openHost(t, svgFile, colorScheme);
  return run(`(() => {
    const root = document.documentElement;
    const rootBox = root.getBoundingClientRect();
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const inside = (r) => r.left >= rootBox.left - 0.5 && r.top >= rootBox.top - 0.5 && r.right <= rootBox.right + 0.5 && r.bottom <= rootBox.bottom + 0.5;
    const texts = [...document.querySelectorAll('text')].filter((el) => el.textContent.trim() && !el.closest('defs'))
      .map((el) => ({ text: el.textContent.trim(), ...box(el), inside: inside(el.getBoundingClientRect()), decoration: getComputedStyle(el).textDecorationLine }));
    const badges = [...document.querySelectorAll('[data-change-badge]')].map((el) => {
      const rect = el.querySelector('rect'), glyph = el.querySelector('text');
      const r = box(rect), g = box(glyph);
      return { change: el.getAttribute('data-change-badge'), rect: r, glyph: g, inside: inside(rect.getBoundingClientRect()),
        glyphInside: g.left >= r.left - 0.5 && g.right <= r.right + 0.5 && g.top >= r.top - 0.5 && g.bottom <= r.bottom + 0.5 };
    });
    const removed = [...document.querySelectorAll('[data-change="removed"]')].map((el) => {
      const shapes = [...el.querySelectorAll('rect, path, circle, polygon')].concat(el.matches('rect, path') ? [el] : []);
      return { dashed: shapes.some((shape) => getComputedStyle(shape).strokeDasharray !== 'none'),
        struck: [...el.querySelectorAll('text')].some((text) => getComputedStyle(text).textDecorationLine.includes('line-through')),
        opacity: Number(getComputedStyle(el).opacity) };
    });
    return { root: { width: rootBox.width, height: rootBox.height }, texts, badges, removed, errors: pageErrors };
  })()`);
}

function viewBoxOf(svgFile) {
  const [, viewBox] = fs.readFileSync(svgFile, 'utf8').match(/<svg\b[^>]*\sviewBox="([^"]+)"/);
  const [, , width, height] = viewBox.split(/\s+/).map(Number);
  return { width, height };
}

const PRESETS = ['classic', 'signal-flow', 'blueprint', 'editorial'];

for (const preset of PRESETS) test(`baked ${preset} SVGs render inside a sandboxed <img> with their authored size in both themes`, {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser SVG export checks.',
}, async (t) => {
  const scratch = createScratchDirectory(path.join(os.tmpdir(), `archify-svg-export-img-${preset}-`));
  const input = path.join(scratch, 'change.sequence.json');
  fs.writeFileSync(input, JSON.stringify(changeSequence()));
  const receipt = await exportSvgArtifacts({ type: 'sequence', input, output: path.join(scratch, `change-${preset}`), preset });
  assert.equal(receipt.preset, preset);
  const light = receipt.outputs.find((entry) => entry.theme === 'light').path;
  const dark = receipt.outputs.find((entry) => entry.theme === 'dark').path;
  for (const file of [light, dark]) {
    const svg = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(svg, /color-mix\(/, `${preset} ${path.basename(file)} expands color-mix statically`);
    assert.doesNotMatch(svg, /var\(--/, `${preset} ${path.basename(file)} resolves every custom property`);
  }
  const hostFile = path.join(scratch, 'host.html');
  fs.writeFileSync(hostFile, hostPage(light, dark));
  const expected = viewBoxOf(light);
  assert.deepEqual(viewBoxOf(dark), expected);

  for (const scheme of ['dark', 'light']) {
    const { run } = await openHost(t, hostFile, scheme);
    const state = await run(`(() => {
      const sizes = Object.fromEntries([...document.images].map((img) => [img.id, { complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, width: img.getBoundingClientRect().width }]));
      const picture = document.getElementById('picture');
      const sample = (id) => {
        const img = document.getElementById(id);
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
        const context = canvas.getContext('2d');
        context.drawImage(img, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const corner = [data[0], data[1], data[2], data[3]];
        const colours = new Set();
        let differing = 0;
        for (let index = 0; index < data.length; index += 16) {
          const key = (data[index] >> 4) + ',' + (data[index + 1] >> 4) + ',' + (data[index + 2] >> 4);
          colours.add(key);
          if (Math.abs(data[index] - corner[0]) + Math.abs(data[index + 1] - corner[1]) + Math.abs(data[index + 2] - corner[2]) > 48) differing += 1;
        }
        return { corner, distinctColours: colours.size, differingShare: differing / (data.length / 16) };
      };
      return { sizes, currentSrc: picture.currentSrc, lightPixels: sample('light-data'), darkPixels: sample('dark-data'), errors: pageErrors };
    })()`);
    assert.deepEqual(state.errors, []);
    for (const [id, size] of Object.entries(state.sizes)) {
      assert.equal(size.complete, true, `${id} loaded`);
      assert.equal(size.naturalWidth, expected.width, `${id} natural width equals the viewBox width`);
      assert.equal(size.naturalHeight, expected.height, `${id} natural height equals the viewBox height`);
      assert.ok(size.width > 0, `${id} is laid out`);
    }
    assert.ok(state.currentSrc.endsWith(scheme === 'dark' ? path.basename(dark) : path.basename(light)), `picture picks the ${scheme} source (${state.currentSrc})`);
    const [lr, lg, lb, la] = state.lightPixels.corner;
    const [dr, dg, db, da] = state.darkPixels.corner;
    assert.equal(la, 255, 'light export paints an opaque background');
    assert.equal(da, 255, 'dark export paints an opaque background');
    assert.ok(lr + lg + lb > 600, `light background is light (${state.lightPixels.corner})`);
    assert.ok(dr + dg + db < 150, `dark background is dark (${state.darkPixels.corner})`);
    for (const [theme, pixels] of [['light', state.lightPixels], ['dark', state.darkPixels]]) {
      assert.ok(pixels.distinctColours >= 12, `${theme} export draws nodes, arrows, change marks and legend (${pixels.distinctColours} colour buckets)`);
      assert.ok(pixels.differingShare > 0.02 && pixels.differingShare < 0.9, `${theme} export has visible content over the background (${pixels.differingShare})`);
    }

    const geometry = await measureSvg(t, scheme === 'dark' ? dark : light, scheme);
    const where = `${preset}/${scheme}`;
    assert.deepEqual(geometry.errors, [], `${where}: no page errors`);
    assert.deepEqual({ width: geometry.root.width, height: geometry.root.height }, expected, `${where}: document renders at the authored size`);
    assert.ok(geometry.texts.length >= 8, `${where}: labels, messages and legend text present`);
    for (const text of geometry.texts) {
      assert.ok(text.width > 0 && text.height > 0, `${where}: "${text.text}" is laid out`);
      assert.ok(text.inside, `${where}: "${text.text}" stays inside the viewBox`);
    }
    assert.equal(geometry.badges.map((badge) => badge.change).sort().join(','), 'added,added,modified,modified,removed,removed', `${where}: one badge per marked participant and message`);
    for (const [index, badge] of geometry.badges.entries()) {
      assert.ok(badge.inside, `${where}: ${badge.change} badge stays inside the viewBox`);
      assert.ok(badge.glyphInside, `${where}: ${badge.change} badge glyph sits inside its pill ${JSON.stringify(badge)}`);
      for (const other of geometry.badges.slice(index + 1)) {
        const separated = badge.rect.right <= other.rect.left || other.rect.right <= badge.rect.left || badge.rect.bottom <= other.rect.top || other.rect.bottom <= badge.rect.top;
        assert.ok(separated, `${where}: badges overlap ${JSON.stringify([badge.rect, other.rect])}`);
      }
    }
    assert.equal(geometry.removed.length, 2, `${where}: removed participant and message keep their ghosts`);
    for (const ghost of geometry.removed) {
      assert.ok(ghost.dashed, `${where}: removed ghost is drawn dashed ${JSON.stringify(ghost)}`);
      assert.ok(ghost.struck, `${where}: removed label is struck through ${JSON.stringify(ghost)}`);
      assert.ok(ghost.opacity < 1 && ghost.opacity > 0.3, `${where}: removed ghost stays legible (${ghost.opacity})`);
    }
  }
});
