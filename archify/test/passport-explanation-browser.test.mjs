import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../bin/visual-check.mjs';
import { desktopBrowser, desktopPointerCheck } from './helpers/desktop-browser.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Semantic Passport flips to an authored explanation and back without moving or exporting it', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser passport explanation checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-passport-explanation-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  diagram.components.find((c) => c.id === 'users').explanation = 'Anyone with the app installed.\n\nThey never hold a key; only a session.';
  const input = path.join(scratch, 'explained.json');
  const output = path.join(scratch, 'explained.html');
  fs.writeFileSync(input, JSON.stringify(diagram));
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'), input, output]);

  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const checkPointer = await desktopPointerCheck(browser, session);
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  async function run(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(r.exceptionDetails, undefined, r.exceptionDetails?.exception?.description);
    return r.result?.value;
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `window.pageErrors=[];addEventListener('error',e=>pageErrors.push(e.message));` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(output).href + '?theme=dark&keep=yes' });
  await loaded;
  await checkPointer();
  await run('document.fonts.ready');
  await run('Archify.viewerChromeLayout.whenStable()');

  const state = () => run(`(() => { const chip = document.getElementById('focus-chip'); const face = document.getElementById('focus-explanation'); const r = chip.getBoundingClientRect();
    return { active: Archify.focus.active(), explaining: Archify.focus.explaining(), attr: chip.getAttribute('data-explaining'), chipHidden: chip.hidden, btnHidden: document.getElementById('btn-focus-explain').hidden,
      faceHidden: face.hidden, paragraphs: face.querySelectorAll('p').length, title: document.getElementById('focus-explanation-title').textContent, left: r.left, top: r.top, height: r.height,
      focused: document.activeElement && document.activeElement.id, errors: pageErrors }; })()`);

  assert.equal(await run(`Archify.focus.set('users')`), true);
  const front = await state();
  assert.equal(front.active, 'users');
  assert.equal(front.btnHidden, false, 'Explain is offered for a node with an explanation');
  assert.equal(front.explaining, false);

  await run(`document.getElementById('btn-focus-explain').click()`);
  const flipped = await state();
  assert.equal(flipped.explaining, true);
  assert.equal(flipped.attr, 'true');
  assert.equal(flipped.faceHidden, false);
  assert.equal(flipped.paragraphs, 2, 'blank lines split paragraphs');
  assert.equal(flipped.title, 'Users');
  assert.equal(flipped.left, front.left, 'the passport does not move when it flips');
  assert.equal(flipped.top, front.top, 'the passport does not move when it flips');
  assert.equal(flipped.focused, 'focus-explanation-back', 'the back link takes focus');

  const exported = await run(`(() => { const clone = Archify.exportMenu && Archify.exportMenu.snapshot ? null : null; const svg = document.querySelector('.diagram-container > svg').outerHTML; return { svg }; })()`);
  assert.doesNotMatch(exported.svg, /Anyone with the app installed/, 'prose stays outside the canonical SVG');

  await run(`document.getElementById('focus-explanation-back').click()`);
  const back = await state();
  assert.equal(back.explaining, false);
  assert.equal(back.attr, null);
  assert.equal(back.chipHidden, false, 'clicking the face returns to the passport, not to nothing');
  assert.equal(back.active, 'users');
  assert.equal(back.focused, 'btn-focus-explain', 'focus returns to the Explain action');

  await run(`document.getElementById('btn-focus-explain').click()`);
  await run(`document.getElementById('focus-explanation-back').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  const escaped = await state();
  assert.equal(escaped.explaining, false, 'Escape on the back link closes the explanation');
  assert.equal(escaped.chipHidden, false, 'the passport stays open after Escape on the face');

  assert.equal(await run(`Archify.focus.set('cdn')`), true);
  const other = await state();
  assert.equal(other.btnHidden, true, 'nodes without an explanation offer no Explain action');
  assert.equal(other.explaining, false);
  assert.deepEqual(other.errors, []);
});
