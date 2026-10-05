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

test('interval uses native themes and keeps editing and exports sound in Chrome', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser interval checks.',
  timeout: 60000,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-interval-browser-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = JSON.parse(fs.readFileSync(path.join(root, 'examples/storage.interval.json'), 'utf8'));
  source.palette = { span: '#123456' };
  source.horizontalScale = 1.5;
  const input = path.join(dir, 'diagram.json');
  const artifact = path.join(dir, 'diagram.html');
  fs.writeFileSync(input, JSON.stringify(source));
  execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'render', 'interval', input, artifact]);

  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.intervalTestErrors = [];
    addEventListener('error', e => intervalTestErrors.push(e.message));
    addEventListener('unhandledrejection', e => intervalTestErrors.push(String(e.reason)));
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  async function evaluate(expression, awaitPromise = false) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  async function load(theme, edit = true) {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    const result = await send('Page.navigate', { url: pathToFileURL(artifact).href + `?theme=${theme}${edit ? "&edit=1" : ""}` });
    assert.equal(result.errorText, undefined);
    await loaded;
    await evaluate(`(async () => {
      await document.fonts.ready;
      await Archify.readerLayout.whenStable();
      await Archify.viewerChromeLayout.whenStable();
    })()`, true);
    assert.deepEqual(await evaluate('intervalTestErrors'), []);
  }

  await load('light', false);
  assert.equal(await evaluate("document.querySelector('.interval-editor') === null"), true);
  await load('light');
  const light = await evaluate(`(() => {
    const svg = document.querySelector('.diagram-container > svg');
    const rect = svg.querySelector('g[data-kind="span"] rect');
    const text = svg.querySelector('text');
    return { fill: getComputedStyle(rect).fill, text: getComputedStyle(text).fill,
      explicit: [...svg.querySelectorAll('*')].some(e => getComputedStyle(e).fill === 'rgb(18, 52, 86)') };
  })()`);
  await load('dark');
  const dark = await evaluate(`(() => {
    const svg = document.querySelector('.diagram-container > svg');
    const rect = svg.querySelector('g[data-kind="span"] rect');
    const text = svg.querySelector('text');
    return { fill: getComputedStyle(rect).fill, text: getComputedStyle(text).fill,
      explicit: [...svg.querySelectorAll('*')].some(e => getComputedStyle(e).fill === 'rgb(18, 52, 86)') };
  })()`);
  assert.notEqual(light.text, dark.text, 'theme changes default text ink');
  assert.equal(light.explicit, true, 'light theme keeps authored color');
  assert.equal(dark.explicit, true, 'dark theme keeps authored color');

  const invalid = await evaluate(`(async () => {
    const svg = document.querySelector('.diagram-container > svg');
    const before = svg.outerHTML;
    const panel = document.querySelector('.interval-editor');
    panel.querySelector('.interval-json-toggle').click();
    const input = panel.querySelector('.interval-json');
    const spec = JSON.parse(input.value);
    spec.unitWidth = -1;
    input.value = JSON.stringify(spec);
    panel.querySelector('.interval-apply').click();
    const afterApply = svg.outerHTML;
    let downloaded;
    const original = URL.createObjectURL;
    URL.createObjectURL = function (blob) { downloaded = blob; return original.call(this, blob); };
    try { panel.querySelector('[data-editor-action="download"]').click(); }
    finally { URL.createObjectURL = original; }
    return { unchanged: before === afterApply, downloaded: downloaded ? JSON.parse(await downloaded.text()) : null,
      status: panel.querySelector('.interval-status').textContent };
  })()`, true);
  assert.equal(invalid.unchanged, true, 'invalid JSON leaves the verified diagram intact');
  assert.equal(invalid.downloaded.unitWidth, source.unitWidth, 'download uses last valid source, not invalid draft');

  // Restore authored JSON, zoom, and drag one interval endpoint with real CDP input.
  const handle = await evaluate(`(() => {
    const panel = document.querySelector('.interval-editor');
    panel.querySelector('.interval-json').value = JSON.stringify(JSON.parse(document.getElementById('archify-interval-data').textContent).spec);
    panel.querySelector('.interval-apply').click();
    Archify.view.zoomIn();
    panel.querySelector('[data-editor-action="toggle"]').click();
    const node = document.querySelector('.diagram-container [data-edit-handle="to"]');
    const rect = node.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2,
      camera: Archify.view.state(), before: panel.querySelector('.interval-json').value };
  })()`);
  assert.ok(handle.x > 0 && handle.y > 0, 'endpoint handle is visible');
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x, y: handle.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: handle.x, y: handle.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: handle.x + 45, y: handle.y, button: 'left', buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: handle.x + 45, y: handle.y, button: 'left', clickCount: 1 });
  const edited = await evaluate(`(() => ({
    camera: Archify.view.state(),
    after: document.querySelector('.interval-json').value,
    errors: intervalTestErrors,
  }))()`);
  assert.deepEqual(edited.camera, handle.camera, 'editor drag keeps the camera state');
  assert.notEqual(edited.after, handle.before, 'endpoint drag edits the source');
  assert.deepEqual(edited.errors, []);

  const exported = await evaluate(`(async () => {
    const original = URL.createObjectURL;
    let blob;
    URL.createObjectURL = function (value) {
      if (value.type.startsWith('image/svg+xml')) blob = value;
      return original.call(URL, value);
    };
    try { await Archify.exportMenu.run('svg'); }
    finally { URL.createObjectURL = original; }
    const text = await blob.text();
    const root = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement;
    return { handles: root.querySelectorAll('.edit-handle, [data-edit-handle]').length,
      transient: root.querySelectorAll('[transform^="translate"] [data-edit-path]').length,
      errors: intervalTestErrors };
  })()`, true);
  assert.equal(exported.handles, 0, 'SVG export excludes editor handles');
  assert.equal(exported.transient, 0, 'SVG export excludes active drag transforms');
  assert.deepEqual(exported.errors, []);
});

test('interval reader stops resizing with an in-flow editor at short desktop heights', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser interval checks.', timeout: 60000,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-interval-settle-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const artifact = path.join(dir, 'diagram.html'), input = path.join(dir, 'input.json');
  fs.writeFileSync(input, JSON.stringify({schema_version: 1, diagram_type: 'interval',
    meta: { title: 'Interval reader regression', output: 'diagram.html' }, horizontalScale: 1.8, unitWidth: 100,
    tracks: Array.from({length: 5}, (_, i) => ({id: `t${i}`, height: 40, gapBefore: 65,
      spans: [{from: 0, to: 60, label: 'Work'}]}))}));
  execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'render', 'interval', input, artifact]);
  const browser = new ChromeVisualBrowser(chrome); t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  for (const [width, height] of [[1440,700], [1600,800], [1280,600]]) {
    await send('Emulation.setDeviceMetricsOverride', {width,height,deviceScaleFactor:1,mobile:false});
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', {url:pathToFileURL(artifact).href}); await loaded;
    const result = await send('Runtime.evaluate', {awaitPromise:true,returnByValue:true,expression:`(async()=>{
      await document.fonts.ready; await new Promise(r=>setTimeout(r,400));
      const widths=[]; for(let i=0;i<24;i++){
        widths.push(document.querySelector('.container').getBoundingClientRect().width);
        await new Promise(r=>setTimeout(r,40));
      } return [...new Set(widths.slice(-12))];
    })()`});
    assert.equal(result.result.value.length, 1, `reader oscillates at ${width}x${height}: ${result.result.value}`);
  }
});
