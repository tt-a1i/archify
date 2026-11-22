import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

// Actual Chrome downloads for the #1024 filename policy: the authored
// `.header h1` names the file in every locale; without it the complete
// document.title is kept, suffix-like words included; `diagram` is the
// last resort. Adapted from @BlueboxC's fork test for the same policy.
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Export downloads name files from the authored heading, then the complete page title', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser download checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-filename-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const downloads = path.join(scratch, 'downloads');
  fs.mkdirSync(downloads);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  async function download(expression, expected) {
    for (const name of fs.readdirSync(downloads)) fs.unlinkSync(path.join(downloads, name));
    await run(expression);
    const file = path.join(downloads, expected);
    const deadline = Date.now() + 10000;
    while (!fs.existsSync(file) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 40));
    assert.ok(fs.existsSync(file), `expected ${expected}; got ${fs.readdirSync(downloads).join(', ') || 'nothing'}`);
    assert.ok(fs.statSync(file).size > 0, `${expected} is empty`);
    assert.deepEqual(fs.readdirSync(downloads), [expected]);
  }

  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  for (const [locale, title, pageTitle, headingName, fallbackName] of [
    ['en', 'Checkout Platform', 'Checkout Platform Diagram', 'checkout-platform', 'checkout-platform-diagram'],
    ['en', 'Checkout Diagram', 'Checkout Diagram Diagram', 'checkout-diagram', 'checkout-diagram-diagram'],
    ['es', 'Pagos', 'Pagos · Diagrama', 'pagos', 'pagos-diagrama'],
    ['ko', '결제', '결제 다이어그램', '결제', '결제-다이어그램'],
    ['ar', 'النظام', 'النظام — مخطّط', 'النظام', 'النظام-مخطّط'],
    ['zh-CN', '订单平台', '订单平台', '订单平台', '订单平台'],
  ]) {
    const input = path.join(scratch, 'input.json');
    const file = path.join(scratch, 'page.html');
    fs.writeFileSync(input, JSON.stringify({ ...source, meta: { ...source.meta, locale, title } }));
    execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'), input, file]);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(file).href });
    await loaded;
    await run('document.fonts.ready');
    assert.equal(await run(`document.querySelector('.header h1').textContent.trim()`), title);
    assert.equal(await run('document.title'), pageTitle);
    // The heading wins over the locale's page-title decoration.
    await download(`Archify.exportMenu.run('svg-light')`, `${headingName}-light.svg`);
    // A blank heading falls back to the complete page title, decoration and all.
    await run(`document.querySelector('.header h1').textContent = '  '`);
    await download(`Archify.exportMenu.run('svg-dark')`, `${fallbackName}-dark.svg`);
  }

  // Without a heading, suffix-like words in the page title are authored text.
  await run(`document.querySelector('.header h1').remove(); document.title = 'Checkout Diagram'`);
  await download(`Archify.exportMenu.run('png')`, 'checkout-diagram.png');
  await run(`Archify.routeProbe.begin({ source: 'users', focusNode: false }); Archify.routeProbe.choose('db', { updateUrl: false })`);
  await download('Archify.exportMenu.downloadRouteShareCard()', 'checkout-diagram-route-share-card.png');
  await run(`document.title = ''`);
  await download(`Archify.exportMenu.run('svg-light')`, 'diagram-light.svg');
});
