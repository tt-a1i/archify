import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export async function createMapBrowser(browser, directory) {
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  fs.mkdirSync(directory, { recursive: true });
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory });
  const run = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  };
  async function waitFor(predicate, label, duration = 10_000) {
    const until = Date.now() + duration;
    do {
      const value = await run(predicate);
      if (value) return value;
      await delay(70);
    } while (Date.now() < until);
    assert.fail(label);
  }
  async function click(selector) {
    await waitFor('!!document.querySelector(' + JSON.stringify(selector) + ')', 'Missing ' + selector);
    const hit = await run('(' + prepareClick.toString() + ')(' + JSON.stringify(selector) + ')');
    assert.ok(hit.matches, selector + ' is covered or disabled: ' + JSON.stringify(hit));
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hit.x, y: hit.y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hit.x, y: hit.y, button: 'left', clickCount: 1 });
    assert.equal(await run('window.__mapClick'), true, 'Trusted click missed ' + selector);
  }

  async function open(url, width = 1520, height = 920) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    const load = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url });
    await load;
    await waitFor('document.fonts.status === "loaded"', 'Fonts did not settle');
  }
  async function search(term) {
    await click('.map-controls input[type=search]');
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
    if (term) await send('Input.insertText', { text: term });
    else {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    }
    assert.equal(await run('document.querySelector(".map-controls input").value'), term);
  }
  async function download(name) {
    const file = path.join(directory, name);
    assert.equal(fs.existsSync(file), false, 'Download directory should not have a prior artifact of this name');
    await click('.map-export summary');
    const preview = await run('document.querySelector(".map-export textarea").value');
    await click('.map-export .map-actions button:nth-child(2)');
    const until = Date.now() + 10_000;
    while (!fs.existsSync(file) && Date.now() < until) await delay(75);
    assert.ok(fs.existsSync(file), 'File did not reach disk: ' + name);
    const bytes = fs.readFileSync(file);
    assert.ok(bytes.length > 0 && bytes.length <= 8192);
    assert.equal(bytes.toString('utf8'), preview, 'Downloaded bytes do not match the preview');
    return { name, bytes: bytes.length, text: preview };
  }
  return { send, run, click, open, search, download, waitFor };
}

function prepareClick(selector) {
  const target = document.querySelector(selector);
  target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
  const rect = target.getBoundingClientRect();
  const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  const matches = (target === hit || target.contains(hit)) && !target.disabled;
  window.__mapClick = null;
  window.addEventListener('click', e => {
    window.__mapClick = e.isTrusted && (e.target === target || target.contains(e.target));
  }, { capture: true, once: true });
  return { x, y, matches, overlay: hit?.id || hit?.className || hit?.tagName };
}
