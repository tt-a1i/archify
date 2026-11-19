import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { driftFixture } from './helpers/code-analysis-drift-fixture.mjs';

const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Architecture drift opens from the toolbar, navigates pinned source and downloads the selected edge', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to verify architecture drift in Chrome.', timeout: 240_000,
}, async t => {
  const paths = process.env.ARCHIFY_DRIFT_REAL_SAMPLES?.split('|');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-drift-download-'));
  let browser;
  t.after(async () => {
    if (browser) {
      await browser.cdp.send('Browser.close').catch(() => {});
      await browser.close();
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const fixture = paths ? null : driftFixture(t);
  const candidate = paths ? null : fixture.analyze();
  if (candidate) assert.equal(candidate.p.status, 0, candidate.p.stdout + candidate.p.stderr);
  const out = paths?.[0] || candidate.out;
  const result = JSON.parse(fs.readFileSync(path.join(out, 'architecture-drift.json')));
  const actual = paths
    ? { from: 'vapour-dom', to: 'vapour-slots', file: 'hydrateFragment.ts', line: 38, token: 'hasSlotFallback',
      old: 'vapour-dom:runtime-dom', token2: 'recheckSlotResolution', ids: ['vapour-dom', 'vapour-slots'] }
    : { from: 'app', to: 'db', file: 'main.ts', line: 2, token: "import { db }", old: 'app:ui', ids: ['app', 'db'] };

  browser = new ChromeVisualBrowser(chrome);
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const evalValue = async expression => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    assert.equal(response.exceptionDetails, undefined, response.exceptionDetails?.exception?.description);
    return response.result.value;
  };
  const navigate = async folder => {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(path.join(folder, 'architecture-drift.html')).href });
    await loaded;
  };
  const click = async (selector, text = null) => {
    const point = await evalValue('(() => {' +
      'const b = [...document.querySelectorAll(' + JSON.stringify(selector) + ')].find(el => ' +
      (text === null ? 'true' : 'el.textContent.includes(' + JSON.stringify(text) + ')') + ');' +
      'if (!b) throw Error("control not found"); b.scrollIntoView({block:"nearest"});' +
      'const r = b.getBoundingClientRect(), x = r.left+r.width/2, y = r.top+r.height/2;' +
      'if (!b.contains(document.elementFromPoint(x, y))) throw Error("control was obstructed: " + b.textContent);' +
      'return {x,y};})()');
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  };
  const read = selector => evalValue('document.querySelector(' + JSON.stringify(selector) + ').innerText');
  const take = async name => {
    if (!process.env.ARCHIFY_DRIFT_BROWSER_EVIDENCE) return;
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(process.env.ARCHIFY_DRIFT_BROWSER_EVIDENCE, name + '.png'), Buffer.from(screenshot.data, 'base64'));
  };

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  await navigate(out);
  const panel = '#architecture-drift-panel';
  assert.equal(await evalValue('document.querySelector("#architecture-drift-panel").hidden'), true);
  await click('#architecture-drift-toggle');
  assert.match(await read(panel), /1 new undeclared/);
  await click('[data-drift-pair="' + actual.from + ':' + actual.to + '"]');
  assert.equal(await evalValue('document.querySelector(".drift-geometry").dataset.state'), 'new-undeclared');
  assert.deepEqual((await evalValue('[...document.querySelectorAll("[data-drift-endpoint]")].map(g => g.dataset.driftEndpoint)')).sort(), actual.ids);
  assert.equal(await evalValue('!document.querySelector(".diagram-container > svg:first-child").querySelector(".drift-geometry")'), true);
  await take('drift-positive-relationship');
  await click('[data-drift-location="head-0"]');
  assert.match(await read(panel + ' pre'), new RegExp(actual.token.replace(/[{}]/g, '\\$&')));
  assert.match(await read(panel + ' .drift-location'), new RegExp(actual.file + ':' + actual.line));
  assert.ok((await read(panel)).includes(result.pins.head));
  await take('drift-positive-source');
  await click(panel + ' button', 'Back to relationship');
  if (actual.token2) {
    await click('[data-drift-location="head-1"]');
    assert.match(await read(panel + ' pre'), new RegExp(actual.token2));
    await click(panel + ' button', 'Back to relationship');
  }
  await click(panel + ' button', 'Download .md');
  const download = path.join(dir, 'architecture-drift.md');
  for (let i = 0; !fs.existsSync(download) && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 100));
  const md = fs.readFileSync(download, 'utf8');
  for (const expected of [result.pins.base, result.pins.head, actual.file + ':' + actual.line, 'not a runtime or whole-repository assessment', 'New, not declared']) {
    assert.ok(md.includes(expected), expected);
  }
  if (actual.token2) assert.ok(md.includes(actual.file + ':39'));
  assert.ok(!md.includes('onlyWorkingTree'));
  if (process.env.ARCHIFY_DRIFT_BROWSER_EVIDENCE) fs.copyFileSync(download, path.join(process.env.ARCHIFY_DRIFT_BROWSER_EVIDENCE, 'architecture-drift.md'));

  await evalValue('document.querySelector("#architecture-drift-filter").value="all"; document.querySelector("#architecture-drift-filter").dispatchEvent(new Event("change"))');
  await click('[data-drift-pair="' + actual.old + '"]');
  for (const side of ['base', 'head']) {
    await click('[data-drift-location="' + side + '-0"]');
    assert.ok((await read(panel)).includes(result.pins[side]));
    await click(panel + ' button', 'Back to relationship');
  }
  await click(panel + ' button', 'Close');
  assert.equal(await evalValue('document.querySelector(".drift-geometry") === null && document.activeElement.id === "architecture-drift-toggle"'), true);

  await send('Emulation.setDeviceMetricsOverride', { width: 560, height: 700, deviceScaleFactor: 1, mobile: false });
  await navigate(paths?.[1] || out);
  await click('#architecture-drift-toggle');
  if (paths) assert.match(await read(panel), /0 new undeclared/);
  const width = await evalValue('document.querySelector("#architecture-drift-panel").getBoundingClientRect().width');
  assert.ok(width <= 560, 'panel stays within the narrow viewport');
  await take(paths ? 'drift-negative-narrow' : 'drift-narrow');
});
