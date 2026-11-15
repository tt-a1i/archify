import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skill = path.join(root, 'archify');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Viewer toolbars move focus between enabled top-level controls with directional keys', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser toolbar keyboard checks.',
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-toolbar-keyboard-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const input = path.join(skill, 'examples', 'web-app.architecture.json');
  const artifact = path.join(directory, 'diagram.html');
  execFileSync(process.execPath, [path.join(skill, 'bin/archify.mjs'), 'render', 'architecture', input, artifact]);

  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function observe(width) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(artifact).href });
    await loaded;
    const result = await send('Runtime.evaluate', {
      expression: `(() => {
        const key = (value, options = {}) => new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...options });
        const run = (toolbar, selector) => {
          const controls = [...toolbar.querySelectorAll(selector)].filter(button => !button.disabled && !button.hidden && button.getClientRects().length);
          const identify = () => document.activeElement.id || document.activeElement.getAttribute('data-view');
          const sequence = [];
          controls[0].focus();
          for (let i = 0; i < controls.length; i++) {
            sequence.push(identify());
            document.activeElement.dispatchEvent(key('ArrowRight'));
          }
          const last = controls[controls.length - 1].id || controls[controls.length - 1].getAttribute('data-view');
          controls[0].focus(); const first = identify();
          const right = controls[0].dispatchEvent(key('ArrowRight')); const second = identify();
          controls[1].dispatchEvent(key('ArrowLeft')); const returned = identify();
          document.activeElement.dispatchEvent(key('End')); const end = identify();
          document.activeElement.dispatchEvent(key('Home')); const home = identify();
          controls[controls.length - 1].focus(); const forwardWrap = document.activeElement.dispatchEvent(key('ArrowRight')); const wrappedFirst = identify();
          controls[0].focus(); const backwardWrap = document.activeElement.dispatchEvent(key('ArrowLeft')); const wrappedLast = identify();
          const modified = ['ctrlKey', 'altKey', 'metaKey', 'shiftKey'].map(modifier => {
            controls[0].focus();
            const allowed = controls[0].dispatchEvent(key('ArrowRight', { [modifier]: true }));
            return { allowed, focus: identify() };
          });
          return { sequence, count: controls.length, first, second, returned, end, last, home, right, forwardWrap, wrappedFirst, backwardWrap, wrappedLast, modified };
        };
        return {
          page: run(document.querySelector('.toolbar'), '#btn-theme, #btn-preset, #btn-motion, #btn-present, #btn-export'),
          dock: run(document.querySelector('.diagram-nav'), ':scope > button'),
          rail: (() => {
            const toolbar = document.querySelector('.rail-controls');
            document.documentElement.dataset.readerRail = 'true';
            for (const button of toolbar.querySelectorAll('button')) button.hidden = false;
            return run(toolbar, ':scope > button');
          })()
        };
      })()`, returnByValue: true,
    });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    assert.deepEqual(result.result.value.page.sequence, ['btn-theme', 'btn-preset', 'btn-motion', 'btn-present', 'btn-export'], `${width}: every visible page-toolbar trigger is reachable in order`);
    for (const [name, value] of Object.entries(result.result.value)) {
      assert.ok(value.count > 1, `${width}/${name}: expected multiple enabled controls`);
      assert.notEqual(value.first, value.second, `${width}/${name}: ArrowRight moves focus`);
      assert.equal(value.returned, value.first, `${width}/${name}: ArrowLeft returns focus`);
      assert.equal(value.end, value.last, `${width}/${name}: End selects last control`);
      assert.equal(value.home, value.first, `${width}/${name}: Home selects first control`);
      assert.equal(value.right, false, `${width}/${name}: handled key prevents default`);
      assert.equal(value.forwardWrap, false, `${width}/${name}: ArrowRight wrap prevents default`);
      assert.equal(value.wrappedFirst, value.first, `${width}/${name}: ArrowRight wraps to first control`);
      assert.equal(value.backwardWrap, false, `${width}/${name}: ArrowLeft wrap prevents default`);
      assert.equal(value.wrappedLast, value.last, `${width}/${name}: ArrowLeft wraps to last control`);
      for (const modifier of value.modified) {
        assert.equal(modifier.allowed, true, `${width}/${name}: modified key preserves default behavior`);
        assert.equal(modifier.focus, value.first, `${width}/${name}: modified key preserves focus`);
      }
    }
  }
  await observe(1440);
  await observe(640);
});
