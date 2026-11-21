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

test('real Chrome: MCO case stays readable and navigable in both languages, themes and narrow viewports', {
  skip: enabled ? false : 'Set ARCHIFY_SITE_INTEGRATION=1 and ARCHIFY_CHROME to run MCO case browser evidence.',
  timeout: 180000,
}, async () => {
  const chrome = findChrome();
  assert.ok(chrome, 'The requested agent guide gate requires usable Chrome.');
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (mount && !url.pathname.startsWith(`${mount}/`)) return response.writeHead(404).end();
    let relative = url.pathname.slice(mount.length).replace(/^\/+/, '') || 'index.html';
    // Resolve actual static HTML routes, never an SPA fallback.
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
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')) : null;
  const manifest = {
    capturedAt: new Date().toISOString(), target,
    checkoutSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: website, encoding: 'utf8' }).trim(),
    pullRequestHead: event?.pull_request?.head?.sha || null,
    runId: process.env.GITHUB_RUN_ID || null,
    screenshots: [], navigation: [],
  };
  const saveManifest = () => fs.writeFileSync(path.join(output, 'mco-case-manifest.json'), JSON.stringify(manifest, null, 2));
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = new ChromeVisualBrowser(chrome);
    const session = await browser.sessionPromise;
    const evaluate = async expression => {
      const result = await browser.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const settled = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const loadedAction = async action => {
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      loaded.catch(() => {});
      await action();
      await loaded;
      await evaluate('document.fonts.ready');
    };
    const assertSectionVisible = async () => {
      const position = await evaluate(`(async () => {
        // Let native smooth fragment navigation finish, without overriding it.
        const started = performance.now(); let last = scrollY, stable = 0;
        while (performance.now() - started < 2500) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          stable = Math.abs(scrollY - last) < .5 ? stable + 1 : 0; last = scrollY;
          if (stable >= 5 && performance.now() - started > 200) break;
        }
        const anchor = document.getElementById(location.hash.slice(1));
        const boundary = anchor?.parentElement.tagName === 'P' ? anchor.parentElement : anchor;
        const heading = boundary?.nextElementSibling;
        const box = heading?.getBoundingClientRect();
        return { tag: heading?.tagName, top: box?.top, bottom: box?.bottom, navBottom: document.querySelector('.site-nav').getBoundingClientRect().bottom, height: innerHeight };
      })()`);
      assert.equal(position.tag, 'H2');
      assert.ok(position.top >= position.navBottom - 1 && position.bottom <= position.height, 'fragment target heading is visible below the fixed navigation');
      return position;
    };
    const urlFor = (page, lang) => `http://127.0.0.1:${server.address().port}${mount}/${lang === 'zh' ? 'zh/' : ''}${page}${mount ? '.html' : ''}`;
    const navigate = url => loadedAction(() => browser.cdp.send('Page.navigate', { url }, session));
    await browser.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, session);
    for (const width of [1440, 390, 320]) for (const lang of ['en', 'zh']) {
      await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 }, session);
      await navigate(urlFor('cases/mco-runtime', lang));
      for (const theme of ['light', 'dark']) {
        await evaluate(`if (document.documentElement.dataset.theme !== ${JSON.stringify(theme)}) document.querySelector('[data-theme-toggle]').click()`);
        await settled();
        const reading = await evaluate(`(() => {
          const article = document.querySelector('.article-body');
          const failures = [];
          const walker = document.createTreeWalker(article, NodeFilter.SHOW_TEXT);
          while (walker.nextNode()) {
            const node = walker.currentNode;
            if (!node.textContent.trim()) continue;
            for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
              const style = getComputedStyle(parent);
              if (style.visibility !== 'visible' || style.display === 'none' || Number(style.opacity) === 0) failures.push({ text: node.textContent.slice(0, 100), reason: 'hidden text' });
            }
            const range = document.createRange(); range.selectNodeContents(node);
            const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
            if (!rects.length) failures.push({ text: node.textContent.slice(0, 100), reason: 'text has no rendered bounds' });
            for (const rect of rects) {
              if (rect.left < -1 || rect.right > innerWidth + 1) failures.push({ text: node.textContent.slice(0, 100), reason: 'outside viewport horizontally' });
              for (let parent = node.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
                const style = getComputedStyle(parent), box = parent.getBoundingClientRect();
                if (['hidden', 'clip'].includes(style.overflowX) && (rect.left < box.left - 1 || rect.right > box.right + 1)) failures.push({ text: node.textContent.slice(0, 100), reason: 'horizontal clipping' });
                if (['hidden', 'clip'].includes(style.overflowY) && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1)) failures.push({ text: node.textContent.slice(0, 100), reason: 'vertical clipping' });
              }
            }
          }
          return { lang: document.documentElement.lang, theme: document.documentElement.dataset.theme, width: innerWidth, pageWidth: document.documentElement.scrollWidth, failures };
        })()`);
        // Capture bounded viewport tiles so long mobile source explanations and limits are not
        // silently cropped or squeezed into an unreadable full-page thumbnail.
        for (const region of ['opening', 'file-ownership', 'persistence-limits']) {
          const bounds = await evaluate(`(() => {
            const article = document.querySelector('.article-body');
            const start = ${JSON.stringify(region)} === 'opening' ? article.querySelector('h1') : document.getElementById(${JSON.stringify(region === 'file-ownership' ? 'case-file-writes' : 'case-persistence')});
            const end = document.getElementById(${JSON.stringify(region === 'opening' ? 'case-version-boundary' : region === 'file-ownership' ? 'case-persistence' : 'case-limits')});
            return { top: start.getBoundingClientRect().top + scrollY, bottom: (${JSON.stringify(region)} === 'persistence-limits' ? article.getBoundingClientRect().bottom : end.getBoundingClientRect().top) + scrollY, nav: document.querySelector('.site-nav').getBoundingClientRect().bottom };
          })()`);
          const inset = bounds.nav + 20;
          const step = 1000 - inset - 40;
          const tiles = Math.max(1, Math.ceil((bounds.bottom - bounds.top) / step));
          assert.ok(tiles <= 12, `${region}: unexpectedly unbounded article region`);
          for (let tile = 0; tile < tiles; tile++) {
            await evaluate(`scrollTo({ top: ${Math.max(0, bounds.top - inset + tile * step)}, behavior: 'instant' })`);
            await settled();
            const receipt = await evaluate(`({ scrollY, viewport: { width: innerWidth, height: innerHeight }, lang: document.documentElement.lang, theme: document.documentElement.dataset.theme })`);
            const name = `mco-case-${lang}-${width}-${theme}-${region}-${tile + 1}.png`;
            const image = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, session);
            fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'));
            manifest.screenshots.push({ file: name, width, height: 1000, lang, theme, region, tile: tile + 1, tiles, bounds, receipt, reading });
            saveManifest();
          }
        }
        assert.equal(reading.lang, lang === 'en' ? 'en' : 'zh-Hans');
        assert.equal(reading.theme, theme);
        assert.equal(reading.width, width);
        assert.ok(reading.pageWidth <= width + 1, 'no horizontal page overflow');
        assert.deepEqual(reading.failures, [], 'all article text remains visible and unclipped');
      }
      // Exercise real authored links, including section and locale continuity.
      await evaluate(`document.querySelector('.article-toc a[href$="#case-file-writes"]').click()`);
      await settled();
      assert.equal(await evaluate('location.hash'), '#case-file-writes');
      const tocPosition = await assertSectionVisible();
      await loadedAction(() => evaluate(`document.querySelector('[data-language-switch]').click()`));
      const other = lang === 'en' ? 'zh' : 'en';
      assert.equal(await evaluate('location.pathname'), new URL(urlFor('cases/mco-runtime', other)).pathname);
      assert.equal(await evaluate('document.documentElement.lang'), other === 'zh' ? 'zh-Hans' : 'en');
      assert.equal(await evaluate('location.hash'), '#case-file-writes');
      assert.equal(await evaluate('!!document.getElementById(location.hash.slice(1))'), true);
      const localePosition = await assertSectionVisible();
      await loadedAction(() => evaluate(`document.querySelector('.article-body a[href="cases/mco-runtime.architecture.html"]').click()`));
      assert.ok((await evaluate('location.pathname')).endsWith('/cases/mco-runtime.architecture.html'));
      assert.equal(await evaluate('!!document.querySelector("svg")'), true, 'existing linked artifact actually loads');
      const caseHref = `${lang === 'zh' ? 'zh/' : ''}cases/mco-runtime${mount ? '.html' : ''}`;
      await navigate(urlFor('gallery', lang));
      await loadedAction(() => evaluate(`document.querySelector('a[href="${caseHref}"]').click()`));
      assert.equal(await evaluate('location.pathname'), new URL(urlFor('cases/mco-runtime', lang)).pathname);
      await loadedAction(() => evaluate(`document.querySelector('.article-footer a').click()`));
      assert.equal(await evaluate('location.pathname'), new URL(urlFor('agent-diagrams', lang)).pathname);
      await loadedAction(() => evaluate(`document.querySelector('a[href="${caseHref}"]').click()`));
      assert.equal(await evaluate('location.pathname'), new URL(urlFor('cases/mco-runtime', lang)).pathname);
      manifest.navigation.push({ width, lang, result: 'passed', tocPosition, localePosition, paths: ['toc', 'language with fragment', 'existing artifact loads SVG', 'gallery to case', 'case to agent guide', 'agent guide to case'] });
      saveManifest();
    }
  } finally {
    saveManifest();
    if (browser) await browser.close();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  }
});
