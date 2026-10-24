// Adapted from BlueboxC's fork correction (commit 28fbc157) for PR #1027; see the PR thread for the measured no-JS print reproduction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeConfigured = Object.prototype.hasOwnProperty.call(process.env, 'ARCHIFY_CHROME');
const chrome = chromeConfigured ? findChrome() : null;
if (chromeConfigured && !chrome) throw new Error(`ARCHIFY_CHROME does not resolve to an executable browser: ${process.env.ARCHIFY_CHROME}`);

test('Print hides navigation without retaining screen dock clearance', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for the real Chrome print-media check.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-print-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const artifact = path.join(scratch, 'diagram.html');
  execFileSync(process.execPath, [path.join(root, 'archify/renderers/architecture/render-architecture.mjs'),
    path.join(root, 'archify/examples/web-app.architecture.json'), artifact]);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result.value;
  };
  const settle = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const measure = () => evaluate(`(() => {
    const box = getComputedStyle(document.querySelector('.diagram-container'));
    return { dock: box.getPropertyValue('--archify-dock-h').trim(), padding: parseFloat(box.paddingBottom),
      nav: getComputedStyle(document.querySelector('.diagram-nav')).display };
  })()`);
  for (const javascript of [true, false]) {
  await send("Emulation.setScriptExecutionDisabled", { value: !javascript });
  for (const width of [360, 1440]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { media: 'screen' });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(artifact).href });
    await loaded;
    if (javascript) await evaluate('document.fonts.ready');
    if (javascript) await evaluate('Archify.viewerChromeLayout.whenStable()');
    const screen = await measure();
    assert.notEqual(screen.nav, 'none');
    if (width <= 720) assert.ok(parseFloat(screen.dock) > 0, JSON.stringify(screen));
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    if (javascript) await settle();
    const printed = await measure();
    t.diagnostic(JSON.stringify({ javascript, width, screen, printed }));
    assert.equal(printed.nav, 'none');
    if (width <= 720) assert.equal(parseFloat(printed.dock), 0, 'hidden print dock must reserve no height');
    assert.ok(printed.padding <= 24, `print retained dock padding: ${printed.padding}`);
    await send('Emulation.setEmulatedMedia', { media: 'screen' });
    if (javascript) await settle();
    const restored = await measure();
    assert.notEqual(restored.nav, 'none');
    if (width <= 720) assert.ok(parseFloat(restored.dock) > 0, JSON.stringify(restored));
  }
  }
});
