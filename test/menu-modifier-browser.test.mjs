import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chromeConfigured = Object.prototype.hasOwnProperty.call(process.env, 'ARCHIFY_CHROME');
const chrome = chromeConfigured ? findChrome() : null;
if (chromeConfigured && !chrome) {
  throw new Error(`ARCHIFY_CHROME does not resolve to an executable browser: ${process.env.ARCHIFY_CHROME}`);
}

test('Viewer menus preserve modified navigation keys', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser menu checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-menu-modifier-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const source = path.join(skillRoot, 'examples', 'web-app.architecture.json');
  const output = path.join(scratch, 'viewer.html');
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'), source, output]);

  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(output).href });
  await loaded;

  const run = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  };
  const state = await run(`(() => {
    const modifiers = ['ctrlKey', 'altKey', 'metaKey', 'shiftKey'];
    const inspect = (open, close, isOpen, menu, trigger) => {
      trigger.focus();
      const triggerEvents = modifiers.map(modifier => {
        const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, [modifier]: true });
        trigger.dispatchEvent(event);
        return { modifier, prevented: event.defaultPrevented };
      });
      open();
      const item = [...menu.querySelectorAll('button')].find(button => !button.hidden && !button.disabled);
      item.focus();
      const items = modifiers.map(modifier => {
        const event = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true, [modifier]: true });
        item.dispatchEvent(event);
        return { modifier, prevented: event.defaultPrevented, focused: document.activeElement === item };
      });
      const openState = isOpen();
      close();
      return { triggerEvents, openState, items };
    };
    return {
      export: inspect(Archify.exportMenu.open, Archify.exportMenu.close, Archify.exportMenu.isOpen, document.getElementById('export-menu'), document.getElementById('btn-export')),
      preset: inspect(Archify.preset.open, Archify.preset.close, Archify.preset.isOpen, document.getElementById('preset-menu'), document.getElementById('btn-preset')),
    };
  })()`);
  for (const [name, value] of Object.entries(state)) {
    for (const triggerEvent of value.triggerEvents) {
      assert.equal(triggerEvent.prevented, false, `${name} trigger preserves ${triggerEvent.modifier}+ArrowDown`);
    }
    assert.equal(value.openState, true, `${name} still opens through its public controller: ${JSON.stringify(value)}`);
    for (const item of value.items) {
      assert.equal(item.prevented, false, `${name} preserves ${item.modifier}+End`);
      assert.equal(item.focused, true, `${name} retains focused item for ${item.modifier}+End`);
    }
  }
  const helpShortcut = await run(`(() => {
    const event = new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true, shiftKey: true });
    document.dispatchEvent(event);
    return { prevented: event.defaultPrevented, open: Archify.guide.isOpen() };
  })()`);
  assert.deepEqual(helpShortcut, { prevented: true, open: true }, 'Shift+? retains the help shortcut');
});
