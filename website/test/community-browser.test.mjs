import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { ChromeVisualBrowser, findChrome } from '../../archify/bin/visual-check.mjs';
import { createCommunityFixture, payload, websiteRoot } from './helpers/community-fixture.mjs';

const integrationEnabled = process.env.ARCHIFY_SITE_INTEGRATION === '1';
const chrome = integrationEnabled ? findChrome() : null;
const siteRoot = process.env.ARCHIFY_SITE_ROOT ? path.resolve(process.env.ARCHIFY_SITE_ROOT) : path.join(websiteRoot, 'dist');
const siteBase = process.env.ARCHIFY_SITE_BASE ?? '/archify';

test('real Chrome: community metadata remains text through language, filter and navigation changes', {
  skip: integrationEnabled ? false : 'Set ARCHIFY_SITE_INTEGRATION=1 and ARCHIFY_CHROME to run the community browser regression.',
  timeout: 60000,
}, async () => {
  assert.ok(chrome, 'The requested community integration gate requires usable Chrome.');
  const fixture = createCommunityFixture();
  let server;
  let fixtureServer;
  let browser;
  try {
    const built = fixture.build();
    assert.equal(built.status, 0, built.stdout + built.stderr);
    const serve = (root, mount) => http.createServer((request, response) => {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (mount && !url.pathname.startsWith(`${mount}/`)) return response.writeHead(404).end();
      let relative = url.pathname.slice(mount.length).replace(/^\/+/, '') || 'index.html';
      // Serve only actual file-format routes; never introduce an SPA fallback.
      if (['zh', 'start', 'guide', 'gallery', 'community', 'zh/start', 'zh/guide', 'zh/gallery', 'zh/community'].includes(relative)) relative += '.html';
      const file = path.resolve(root, relative);
      if (!file.startsWith(`${root}${path.sep}`)) return response.writeHead(404).end();
      try {
        const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
        response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
        response.end(fs.readFileSync(file));
      } catch { response.writeHead(404).end(); }
    });
    server = serve(siteRoot, siteBase);
    fixtureServer = serve(fixture.dist, '/archify');
    await Promise.all([server, fixtureServer].map(server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve))));
    const base = `http://127.0.0.1:${server.address().port}`;
    const fixtureBase = `http://127.0.0.1:${fixtureServer.address().port}/archify`;
    browser = new ChromeVisualBrowser(chrome);
    const session = await browser.sessionPromise;
    const evaluate = async expression => {
      const result = await browser.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result?.value;
    };
    const navigate = async url => {
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      await browser.cdp.send('Page.navigate', { url }, session);
      await loaded;
    };
    const switchLanguage = async () => {
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      await evaluate("document.getElementById('language').click()");
      await loaded;
    };
    const assertText = async language => {
      const state = await evaluate(`({
        language: document.documentElement.lang,
        executed: document.documentElement.dataset.communityAudit || null,
        summary: document.querySelector('.package-summary').textContent,
        evidence: [...document.querySelectorAll('.evidence-link')].map(node => ({ text: node.textContent, href: node.href })),
        injected: document.querySelectorAll('.package-summary svg, .evidence-link svg').length,
        linksFit: [...document.querySelectorAll('.evidence-link')].every(node => node.scrollWidth <= node.clientWidth + 1),
        heroMarkup: !!document.querySelector('h1 br') && !!document.querySelector('h1 em'),
        width: document.documentElement.scrollWidth, viewport: innerWidth
      })`);
      assert.equal(state.language, language === 'en' ? 'en' : 'zh-Hans');
      assert.equal(state.executed, null);
      assert.equal(state.summary, language === 'en' ? payload : `测试 ${payload}`);
      assert.deepEqual(state.evidence, fixture.entry.evidence.map(item => ({ text: `${item.label} ↗`, href: item.url })));
      assert.equal(state.injected, 0);
      assert.ok(state.linksFit, 'long evidence labels must remain readable inside their cards');
      assert.ok(state.heroMarkup, 'fixed title must preserve trusted markup');
      assert.ok(state.width <= state.viewport, 'catalog must fit the viewport');
    };
    for (const width of [1440, 390]) {
      await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false }, session);
      for (const language of ['en', 'zh']) {
        await navigate(`${fixtureBase}/${language === 'zh' ? 'zh/' : ''}community.html`);
        await assertText(language);
        await switchLanguage();
        await assertText(language === 'en' ? 'zh' : 'en');
        await switchLanguage();
        await assertText(language);
      }
      await evaluate("document.querySelector('[data-filter=recipe]').click()");
      assert.deepEqual(await evaluate(`({ visible: [...document.querySelectorAll('.package-card')].filter(node => !node.hidden).length, empty: getComputedStyle(document.getElementById('empty-state')).display, type: new URL(location.href).searchParams.get('type') })`), { visible: 0, empty: 'block', type: 'recipe' });
      await navigate(`${fixtureBase}/community.html?type=skill`);
      assert.equal(await evaluate("document.querySelector('[data-filter=skill]').getAttribute('aria-pressed')"), 'true');
      assert.equal(await evaluate("document.querySelector('.package-card').hidden"), false);
      await navigate(`${base}${siteBase}/${siteBase ? 'zh.html' : 'zh'}`);
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      await evaluate(`document.querySelector('footer a[href="zh/community${siteBase ? ".html" : ""}"]').click()`);
      await loaded;
      assert.equal(await evaluate('document.documentElement.lang'), 'zh-Hans');
      assert.equal(await evaluate('location.pathname'), `${siteBase}/zh/community${siteBase ? ".html" : ""}`);
    }
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    if (fixtureServer) await new Promise(resolve => fixtureServer.close(resolve));
    fixture.close();
  }
});
