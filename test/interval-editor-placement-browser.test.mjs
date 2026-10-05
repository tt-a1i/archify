import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../archify');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('interval editor starts label drags at their rendered position and maps scaled coordinates', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser interval checks.',
  timeout: 120000,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-interval-editor-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expression, awaitPromise = false) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  };
  const drag = async ({ x, y }) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x + 18, y, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + 18, y, button: 'left', clickCount: 1 });
  };
  for (const scale of [1, 2]) {
    const source = { schema_version: 1, diagram_type: 'interval', meta: { title: 'Editor placement', output: 'diagram.html' },
      horizontalScale: scale, unitWidth: 100, tracks: [{ id: 'work', height: 55, gapBefore: 65,
        spans: [
          { from: 20, to: 22, label: 'Automatic span label' },
          { from: 45, to: 47, label: 'Explicit span label', labelOffset: [25, -70] },
          { from: '70%', to: '85%', label: 'Percentage span' },
        ],
      }, { id: 'points', height: 45, gapBefore: 85,
        points: [{ at: 58, label: 'P1' }, { at: 60, label: 'P2' }],
      }] };
    const input = path.join(dir, `source-${scale}.json`), artifact = path.join(dir, `diagram-${scale}.html`);
    fs.writeFileSync(input, JSON.stringify(source));
    execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'render', 'interval', input, artifact]);

    const load = async () => {
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      await send('Page.navigate', { url: pathToFileURL(artifact).href + "?edit=1" });
      await loaded;
      await evaluate(`(async () => {
        await document.fonts.ready;
        await Archify.readerLayout.whenStable();
        await Archify.viewerChromeLayout.whenStable();
      })()`, true);
      await evaluate(`document.querySelector('[data-editor-action="toggle"]').click()`);
    };
    const info = async (collection, index, handle) => evaluate(`(() => {
      const path = ['tracks', ${collection === 'points' ? 1 : 0}, ${JSON.stringify(collection)}, ${index}];
      const node = [...document.querySelectorAll(${JSON.stringify(handle ? '[data-edit-handle="to"]' : 'text[data-layout-offset]')})]
        .find(e => JSON.stringify(JSON.parse(e.dataset.editPath)) === JSON.stringify(${handle ? 'path' : '[...path, "label"]'}));
      if (!node) return null;
      const r = node.getBoundingClientRect();
      const svg = document.querySelector('.diagram-container > svg');
      const p = svg.createSVGPoint(); p.x = r.x + r.width / 2; p.y = r.y + r.height / 2;
      const q = svg.createSVGPoint(); q.x = p.x + 18; q.y = p.y;
      const hit = document.elementFromPoint(p.x, p.y);
      return { x: p.x, y: p.y, dx: q.matrixTransform(svg.getScreenCTM().inverse()).x - p.matrixTransform(svg.getScreenCTM().inverse()).x,
        hit: hit?.outerHTML.slice(0, 180),
        offset: node.dataset.layoutOffset ? JSON.parse(node.dataset.layoutOffset) : null,
        textX: Number(node.getAttribute('x')) };
    })()`);

    for (const [collection, index] of [['spans', 0], ['spans', 1], ['points', 1]]) {
      await load();
      const before = await info(collection, index, false);
      assert.ok(before, `${collection}/${index} label exists at scale ${scale}`);
      if (index === 0 || collection === 'points')
        assert.ok(before.offset.some(value => value !== 0), `${collection}/${index} exercises automatic displacement at scale ${scale}`);
      await drag(before);
      const after = await evaluate(`(() => {
        const spec = JSON.parse(document.querySelector('.interval-json').value);
        const item = spec.tracks[${collection === 'points' ? 1 : 0}][${JSON.stringify(collection)}][${index}];
        const node = [...document.querySelectorAll('text[data-layout-offset]')]
          .find(e => JSON.stringify(JSON.parse(e.dataset.editPath)) === JSON.stringify(['tracks',${collection === 'points' ? 1 : 0},${JSON.stringify(collection)},${index},'label']));
        return { offset: item.labelOffset, textX: Number(node.getAttribute('x')),
          status: document.querySelector('.interval-status').textContent };
      })()`);
      assert.ok(after.offset, `${collection}/${index} drag updated source at scale ${scale}: ${JSON.stringify({before,after})}`);
      assert.ok(Math.abs(after.offset[0] - (before.offset[0] + before.dx)) < 1,
        `${collection}/${index} first drag starts from rendered offset at scale ${scale}: ${JSON.stringify({before,after})}`);
      assert.ok(Math.abs(after.textX - (before.textX + before.dx)) < 1,
        `${collection}/${index} label remains under pointer after rerender at scale ${scale}`);
    }

    for (const [index, initial] of [[0, 22], [2, 85]]) {
      await load();
      const before = await info('spans', index, true);
      assert.ok(before, `endpoint handle exists for span ${index} at scale ${scale}`);
      await drag(before);
      const after = await evaluate(`JSON.parse(document.querySelector('.interval-json').value).tracks[0].spans[${index}].to`);
      const numeric = typeof after === 'string' ? parseFloat(after) : after;
      assert.ok(Math.abs(numeric - (initial + before.dx * 100 / (720 * scale))) < 0.05,
        `endpoint retains ${index === 2 ? 'percentage' : 'numeric'} mapping at scale ${scale}`);
    }
  }
});
