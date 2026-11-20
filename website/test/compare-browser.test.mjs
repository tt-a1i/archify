import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ChromeVisualBrowser, findChrome } from '../../archify/bin/visual-check.mjs';

const website = fileURLToPath(new URL('../', import.meta.url));
const enabled = process.env.ARCHIFY_SITE_INTEGRATION === '1';
const root = path.resolve(process.env.ARCHIFY_SITE_ROOT || path.join(website, 'dist'));
const mount = process.env.ARCHIFY_SITE_BASE ?? '/archify';
const target = mount ? 'github' : 'cloudflare';
const output = path.join(website, '.browser-evidence', target);

test('real Chrome: comparison page answers first, keeps the table scrollable, and switches language', {
  skip: enabled ? false : 'Set ARCHIFY_SITE_INTEGRATION=1 and ARCHIFY_CHROME to run comparison browser evidence.',
  timeout: 120000,
}, async () => {
  const chrome = findChrome();
  assert.ok(chrome, 'The requested comparison gate requires usable Chrome.');
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (mount && !url.pathname.startsWith(`${mount}/`)) return response.writeHead(404).end();
    let relative = url.pathname.slice(mount.length).replace(/^\/+/, '') || 'index.html';
    if (!path.extname(relative) && fs.existsSync(path.join(root, `${relative}.html`))) relative += '.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(`${root}${path.sep}`)) return response.writeHead(404).end();
    try {
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
      response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      response.end(fs.readFileSync(file));
    } catch { response.writeHead(404).end(); }
  });
  let browser;
  fs.mkdirSync(output, { recursive: true });
  const manifest = {
    capturedAt: new Date().toISOString(), target,
    checkoutSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: website, encoding: 'utf8' }).trim(),
    runId: process.env.GITHUB_RUN_ID || null, receipts: [],
  };
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = new ChromeVisualBrowser(chrome);
    const session = await browser.sessionPromise;
    const evaluate = async expression => {
      const result = await browser.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const urlFor = lang => `http://127.0.0.1:${server.address().port}${mount}/${lang === 'zh' ? 'zh/' : ''}compare${mount ? '.html' : ''}`;
    const navigate = async url => {
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      loaded.catch(() => {});
      await browser.cdp.send('Page.navigate', { url }, session);
      await loaded;
      await evaluate('document.fonts.ready');
    };
    await browser.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, session);
    for (const width of [1440, 320]) for (const lang of ['en', 'zh']) {
      await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 }, session);
      await navigate(urlFor(lang));
      const layout = await evaluate(`(() => {
        const table = document.querySelector('article table');
        const nav = document.querySelector('.site-nav');
        return {
          lang: document.documentElement.lang,
          h1: document.querySelectorAll('article h1').length,
          rows: table ? table.querySelectorAll('tr').length : 0,
          toc: document.querySelectorAll('.article-toc a').length,
          pageOverflow: document.documentElement.scrollWidth - innerWidth,
          tableOverflow: table ? table.scrollWidth - table.clientWidth : null,
          navBottom: nav.getBoundingClientRect().bottom,
        };
      })()`);
      manifest.receipts.push({ width, lang, layout });
      assert.equal(layout.lang, lang === 'zh' ? 'zh-Hans' : 'en');
      assert.equal(layout.h1, 1);
      assert.equal(layout.rows, 9, 'header plus eight comparison dimensions');
      assert.equal(layout.toc, 5);
      assert.ok(layout.pageOverflow <= 0, `${lang} ${width}: the page must not overflow`);
      if (width === 320) assert.ok(layout.tableOverflow > 0, `${lang}: the wide table scrolls inside its own box`);
      else assert.ok(layout.tableOverflow <= 1, `${lang}: the table fits the desktop column`);

      await evaluate('document.querySelector(".article-toc a").click()');
      await new Promise(resolve => setTimeout(resolve, 250));
      const anchor = await evaluate(`(() => {
        const heading = document.querySelector('article h2');
        const box = heading.getBoundingClientRect();
        return { hash: location.hash, top: box.top, bottom: box.bottom, navBottom: document.querySelector('.site-nav').getBoundingClientRect().bottom, height: innerHeight };
      })()`);
      assert.equal(anchor.hash, '#answer');
      assert.ok(anchor.top >= anchor.navBottom - 1 && anchor.bottom <= anchor.height, `${lang}: TOC target stays below the fixed navigation`);

      const switched = browser.cdp.waitFor('Page.loadEventFired', session);
      switched.catch(() => {});
      await evaluate('document.querySelector("[data-language-switch]").click()');
      await switched;
      const next = await evaluate('({ lang: document.documentElement.lang, path: location.pathname })');
      assert.equal(next.lang, lang === 'zh' ? 'en' : 'zh-Hans');
      assert.equal(next.path, new URL(urlFor(lang === 'zh' ? 'en' : 'zh')).pathname);
      fs.writeFileSync(path.join(output, 'compare-manifest.json'), JSON.stringify(manifest, null, 2));
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
