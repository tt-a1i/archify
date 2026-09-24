import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Monitoring and alert icons remain readable and export-safe', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run role-icon browser checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-role-icons-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));

  const source = path.join(skillRoot, 'examples', 'monitoring-alerts.dataflow.json');
  const output = path.join(scratch, 'monitoring-alerts.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/dataflow/render-dataflow.mjs'),
    source,
    output,
  ]);

  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });

  async function evaluate(expression, awaitPromise = false) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }

  async function load(theme) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-color-scheme', value: theme },
        { name: 'prefers-reduced-motion', value: 'reduce' },
      ],
    });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    const result = await send('Page.navigate', { url: pathToFileURL(output).href + '?theme=' + theme });
    assert.equal(result.errorText, undefined);
    await loaded;
    await evaluate(
      '(async () => { await document.fonts.ready; await Archify.readerLayout.whenStable(); await Archify.viewerChromeLayout.whenStable(); })()',
      true,
    );
  }

  for (const theme of ['dark', 'light']) {
    await load(theme);
    const geometry = await evaluate(`(() => {
      function inspect(id, icon) {
        const node = document.querySelector('[data-node-id="' + id + '"]');
        const sigil = node && node.querySelector('[data-semantic-sigil="' + icon + '"]');
        const label = node && node.querySelector('[data-node-label]');
        if (!node || !sigil || !label) return null;
        const nodeRect = node.getBoundingClientRect();
        const iconRect = sigil.getBoundingClientRect();
        const labelRect = label.getBoundingClientRect();
        const shape = sigil.querySelector('path, rect, circle, ellipse');
        const style = shape ? getComputedStyle(shape) : null;
        const overlap = !(
          iconRect.right <= labelRect.left ||
          iconRect.left >= labelRect.right ||
          iconRect.bottom <= labelRect.top ||
          iconRect.top >= labelRect.bottom
        );
        return {
          node: [nodeRect.left, nodeRect.top, nodeRect.right, nodeRect.bottom],
          icon: [iconRect.left, iconRect.top, iconRect.right, iconRect.bottom],
          width: iconRect.width,
          height: iconRect.height,
          overlap,
          stroke: style && style.stroke,
          strokeWidth: style && style.strokeWidth,
        };
      }
      return {
        monitor: inspect('monitor', 'monitor'),
        alert: inspect('alert', 'alert'),
      };
    })()`);

    for (const [role, item] of Object.entries(geometry)) {
      assert.ok(item, theme + ': missing ' + role + ' icon');
      assert.ok(item.width >= 6, theme + ': ' + role + ' icon is too narrow');
      assert.ok(item.height >= 6, theme + ': ' + role + ' icon is too short');
      assert.equal(item.overlap, false, theme + ': ' + role + ' icon overlaps its label');
      assert.ok(item.icon[0] >= item.node[0] && item.icon[1] >= item.node[1], theme + ': icon begins outside node');
      assert.ok(item.icon[2] <= item.node[2] && item.icon[3] <= item.node[3], theme + ': icon extends outside node');
      assert.notEqual(item.stroke, 'none', theme + ': ' + role + ' icon has no visible stroke');
      assert.notEqual(item.stroke, 'rgba(0, 0, 0, 0)', theme + ': ' + role + ' icon stroke is transparent');
      assert.notEqual(item.strokeWidth, '0px', theme + ': ' + role + ' icon stroke width is zero');
    }
  }

  await load('dark');
  const exported = await evaluate(`(async () => {
    const svg = document.querySelector('.diagram-container > svg');
    const svgRect = svg.getBoundingClientRect();
    const targets = {};
    for (const role of ['monitor', 'alert']) {
      const sigil = document.querySelector(
        '[data-node-id="' + role + '"] [data-semantic-sigil="' + role + '"]'
      );
      if (!sigil) throw new Error('Missing ' + role + ' sigil before PNG export');
      const rect = sigil.getBoundingClientRect();
      targets[role] = {
        element: sigil,
        rect: [rect.left, rect.top, rect.right, rect.bottom],
        display: sigil.style.display,
      };
    }

    const original = URL.createObjectURL;
    const svgBlobs = [];
    const pngBlobs = [];
    URL.createObjectURL = function (value) {
      if (value && value.type === 'image/png') pngBlobs.push(value);
      if (value && String(value.type).startsWith('image/svg+xml')) svgBlobs.push(value);
      return original.call(URL, value);
    };

    try {
      await Archify.exportMenu.run('svg');
      await Archify.exportMenu.run('png');
      for (const target of Object.values(targets)) target.element.style.display = 'none';
      await Archify.exportMenu.run('png');
    } finally {
      for (const target of Object.values(targets)) target.element.style.display = target.display;
      URL.createObjectURL = original;
    }

    const svgBlob = svgBlobs[0];
    const pngBlob = pngBlobs[0];
    const controlBlob = pngBlobs[1];
    if (!svgBlob || !pngBlob || !controlBlob) {
      throw new Error('Expected SVG, PNG, and icon-hidden control PNG exports');
    }

    const svgText = await svgBlob.text();
    const bitmap = await createImageBitmap(pngBlob);
    const control = await createImageBitmap(controlBlob);
    if (bitmap.width !== control.width || bitmap.height !== control.height) {
      throw new Error('PNG control dimensions changed while hiding role icons');
    }

    const dimensions = [bitmap.width, bitmap.height];
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    const actual = context.getImageData(0, 0, canvas.width, canvas.height).data;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(control, 0, 0);
    const hidden = context.getImageData(0, 0, canvas.width, canvas.height).data;

    const scaleX = bitmap.width / svgRect.width;
    const scaleY = bitmap.height / svgRect.height;
    function changedPixels(rect) {
      const x0 = Math.max(0, Math.floor((rect[0] - svgRect.left - 1) * scaleX));
      const y0 = Math.max(0, Math.floor((rect[1] - svgRect.top - 1) * scaleY));
      const x1 = Math.min(bitmap.width, Math.ceil((rect[2] - svgRect.left + 1) * scaleX));
      const y1 = Math.min(bitmap.height, Math.ceil((rect[3] - svgRect.top + 1) * scaleY));
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const offset = (y * bitmap.width + x) * 4;
          const delta =
            Math.abs(actual[offset] - hidden[offset]) +
            Math.abs(actual[offset + 1] - hidden[offset + 1]) +
            Math.abs(actual[offset + 2] - hidden[offset + 2]) +
            Math.abs(actual[offset + 3] - hidden[offset + 3]);
          if (delta >= 24) count += 1;
        }
      }
      return count;
    }

    const iconPixels = {
      monitor: changedPixels(targets.monitor.rect),
      alert: changedPixels(targets.alert.rect),
    };
    bitmap.close();
    control.close();
    return { svgText, pngSize: pngBlob.size, dimensions, iconPixels };
  })()`, true);

  assert.match(exported.svgText, /data-semantic-sigil="monitor"/);
  assert.match(exported.svgText, /data-semantic-sigil="alert"/);
  assert.ok(exported.pngSize > 1000, 'PNG export is unexpectedly empty');
  assert.deepEqual(exported.dimensions, [940 * 4, 520 * 4]);
  assert.ok(exported.iconPixels.monitor >= 20, 'PNG export is missing monitor icon pixels');
  assert.ok(exported.iconPixels.alert >= 20, 'PNG export is missing alert icon pixels');
});
