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

test('real Chrome: gallery evidence limits and life-card entry points stay readable and usable', {
  skip: enabled ? false : 'Set ARCHIFY_SITE_INTEGRATION=1 and ARCHIFY_CHROME to run gallery browser evidence.',
  timeout: 180000,
}, async () => {
  const chrome = findChrome();
  assert.ok(chrome, 'The requested gallery gate requires usable Chrome.');
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
  const saveManifest = () => fs.writeFileSync(path.join(output, 'gallery-manifest.json'), JSON.stringify(manifest, null, 2));
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
    const urlFor = lang => `http://127.0.0.1:${server.address().port}${mount}/${lang === 'zh' ? 'zh/' : ''}gallery${mount ? '.html' : ''}`;
    const navigate = url => loadedAction(() => browser.cdp.send('Page.navigate', { url }, session));
    await browser.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, session);
    for (const width of [1440, 390, 320]) for (const lang of ['en', 'zh']) {
      await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width < 768 }, session);
      await navigate(urlFor(lang));
      for (const theme of ['light', 'dark']) {
        await evaluate(`(async () => {
          if (document.documentElement.dataset.theme !== ${JSON.stringify(theme)}) document.querySelector('[data-theme-toggle]').click();
          // Finish finite theme transitions before inspecting their actual appearance.
          await Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect.getComputedTiming().endTime)).map(a => a.finished.catch(() => {})));
        })()`);
        for (const region of ['limit', 'life-0', 'life-1', 'life-2', 'life-3']) {
          const selector = region === 'limit' ? '#gallery-evidence-limit' : `.life-section:not(#pages) .life-card:nth-child(${Number(region.slice(-1)) + 1})`;
          await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
          await settled();
          const receipt = await evaluate(`(() => {
            const region = document.querySelector(${JSON.stringify(selector)});
            const nodes = ${JSON.stringify(region)} === 'limit' ? [region] : [...region.querySelectorAll('.life-q, .life-links a')];
            return { lang: document.documentElement.lang, theme: document.documentElement.dataset.theme, width: innerWidth, pageWidth: document.documentElement.scrollWidth,
              nodes: nodes.map(node => { const r = node.getBoundingClientRect(), style = getComputedStyle(node); return {
                text: node.innerText, href: node.getAttribute('href'), height: r.height,
                visible: style.visibility === 'visible' && Number(style.opacity) === 1 && r.width > 0 && r.height > 0,
                fits: r.left >= -1 && r.right <= innerWidth + 1 && r.top >= document.querySelector('.site-nav').getBoundingClientRect().bottom && r.bottom <= innerHeight,
                reachable: !node.href || document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('a') === node
              }; }) };
          })()`);
          const name = `gallery-${lang}-${width}-${theme}-${region}.png`;
          const image = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, session);
          fs.writeFileSync(path.join(output, name), Buffer.from(image.data, 'base64'));
          manifest.screenshots.push({ file: name, width, lang, theme, region, receipt }); saveManifest();
          assert.equal(receipt.lang, lang === 'zh' ? 'zh-Hans' : 'en');
          assert.equal(receipt.theme, theme);
          assert.ok(receipt.pageWidth <= width + 1, `${name}: no page overflow`);
          assert.equal(receipt.nodes.length, region === 'limit' ? 1 : 4);
          for (const node of receipt.nodes) {
            assert.ok(node.visible && node.fits && node.reachable, `${name}: readable and reachable ${node.text}`);
            if (node.href) assert.ok(node.height >= 44, `${name}: touch target`);
          }
        }
      }
      for (const [index, type] of ['workflow', 'lifecycle', 'dataflow', 'sequence'].entries()) {
        await navigate(urlFor(lang));
        const point = await evaluate(`(() => {
          const link = document.querySelectorAll('.life-card .create-link')[${index}];
          link.scrollIntoView({block:'center',behavior:'instant'});
          const r = link.getBoundingClientRect(); return { x:r.x+r.width/2, y:r.y+r.height/2 };
        })()`);
        await settled();
        await loadedAction(async () => {
          for (const eventType of ['mousePressed', 'mouseReleased']) await browser.cdp.send('Input.dispatchMouseEvent', { type:eventType, ...point, button:'left', clickCount:1 }, session);
        });
        const receipt = await evaluate(`(() => ({ lang:document.documentElement.lang, path:location.pathname, query:Object.fromEntries(new URL(location.href).searchParams), type:document.querySelector('[data-type][aria-selected="true"]').dataset.type, input:document.querySelector('[data-input][aria-selected="true"]').dataset.input, prompt:document.getElementById('recipe-prompt').innerText, expected:JSON.parse(document.getElementById('start-data').textContent)[${JSON.stringify(type)}][${JSON.stringify(lang)}].descriptionPrompt }))()`);
        manifest.navigation.push({ width, lang, type, receipt }); saveManifest();
        assert.equal(receipt.lang, lang === 'zh' ? 'zh-Hans' : 'en');
        assert.equal(receipt.path, `${mount}/${lang === 'zh' ? 'zh/' : ''}start${mount ? '.html' : ''}`);
        assert.equal(receipt.query.type, type); assert.equal(receipt.query.input, 'description'); assert.equal(receipt.query.source, 'gallery');
        assert.equal(receipt.type, type); assert.equal(receipt.input, 'description');
        assert.equal(receipt.prompt, receipt.expected, 'destination uses the existing generic type prompt, not a recreated life template');
      }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
