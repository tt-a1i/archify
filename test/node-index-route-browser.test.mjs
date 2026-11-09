import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { createViewerClick } from './helpers/viewer-click.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = path.join(root, 'archify');
const chromeConfigured = Object.prototype.hasOwnProperty.call(process.env, 'ARCHIFY_CHROME');
const chrome = chromeConfigured ? findChrome() : null;
if (chromeConfigured && !chrome) throw new Error(`ARCHIFY_CHROME does not resolve to an executable browser: ${process.env.ARCHIFY_CHROME}`);

test('Node index picks route endpoints while ROUTE is picking', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run the real-browser node-index route check.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-node-index-route-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const artifact = path.join(scratch, 'architecture.html');
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(skillRoot, 'examples/web-app.architecture.json'), artifact]);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  const click = await createViewerClick({ send, run, timeout: 10000 });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(artifact).href + '?theme=dark' });
  await loaded;
  await run('document.fonts.ready.then(() => Archify.readerLayout.whenStable())');
  async function waitFor(expression, label) {
    await run(`new Promise((resolve, reject) => {
      const start = performance.now();
      (function poll() {
        if (${expression}) return resolve();
        if (performance.now() - start > 10000) return reject(new Error(${JSON.stringify(label + ' did not settle')}));
        requestAnimationFrame(poll);
      })();
    })`);
  }

  // The Finder is never opened here: that is the reported case. Its stored
  // context stays "focus", so a stale selection would focus the node and end
  // route picking instead of choosing the endpoint.
  await click('#btn-route-probe');
  assert.equal(await run('Archify.routeProbe.active()'), 'source');

  await click('[data-outline-node="users"]');
  await waitFor(`Archify.routeProbe.active() === 'target'`, 'route source pick');
  assert.equal(await run('Archify.focus.active()'), null);

  await click('[data-outline-node="db"]');
  await waitFor(`Archify.routeProbe.active() === 'result'`, 'route target pick');
  assert.equal(await run('location.hash'), '#route=users~db');
  assert.deepEqual(await run('Archify.routeProbe.result().nodes'), ['users', 'cdn', 'lb', 'api', 'db']);
});
