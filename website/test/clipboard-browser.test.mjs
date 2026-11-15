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
const output = path.join(website, '.browser-evidence', target, 'clipboard');

test('real Chrome: website copy controls report real outcomes and preserve selected text and focus', {
  skip: enabled ? false : 'Set ARCHIFY_SITE_INTEGRATION=1 and ARCHIFY_CHROME to run clipboard browser evidence.',
  timeout: 120000,
}, async () => {
  const chrome = findChrome();
  assert.ok(chrome, 'The requested clipboard gate requires usable Chrome.');
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (mount && !url.pathname.startsWith(`${mount}/`)) return response.writeHead(404).end();
    let relative = url.pathname.slice(mount.length).replace(/^\/+/, '') || 'index.html';
    if (!path.extname(relative)) relative += '.html';
    const file = path.resolve(root, relative);
    if (!file.startsWith(`${root}${path.sep}`)) return response.writeHead(404).end();
    try {
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
      response.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      response.end(fs.readFileSync(file));
    } catch { response.writeHead(404).end(); }
  });
  let browser;
  const manifest = { target, capturedAt: new Date().toISOString(),
    checkoutSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: website, encoding: 'utf8' }).trim(),
    runId: process.env.GITHUB_RUN_ID || null, receipts: [], screenshots: [] };
  fs.mkdirSync(output, { recursive: true });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = new ChromeVisualBrowser(chrome);
    const session = await browser.sessionPromise;
    const evaluate = async expression => {
      const result = await browser.cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    await browser.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, session);
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 320, height: 1000, deviceScaleFactor: 1, mobile: true }, session);
    for (const lang of ['en', 'zh']) for (const page of ['index', 'guide', 'start']) {
      const route = `${lang === 'zh' ? 'zh/' : ''}${page}.html`.replace('zh/index.html', 'zh.html');
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session); loaded.catch(() => {});
      await browser.cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}${mount}/${route}` }, session);
      await loaded;
      await evaluate('document.fonts.ready');
      const controls = await evaluate(`(() => {
        const page = ${JSON.stringify(page)};
        if (page === 'guide') document.querySelectorAll('[data-recipe]')[1].click();
        if (page === 'index') document.querySelector('.agent-tabs [data-agent="cursor"]').click();
        if (page === 'start') {
          document.querySelector('[data-agent="cursor"]').click();
          document.querySelector('[data-type="workflow"]').click();
          document.querySelector('[data-input="repository"]').click();
        }
        return page === 'index' ? ['[data-copy-text]', '[data-copy-from]'] : page === 'guide' ? ['#copy-prompt'] : ['[data-copy-source="agent-install-prompt"]', '[data-copy-source="install-command"]', '[data-copy-source="project-command"]', '#copy-prompt', '#copy-starter'];
      })()`);
      for (const selector of controls) for (const [api, fallback] of [['success', 'throw'], ['missing', 'true'], ['missing', 'false'], ['missing', 'throw'], ['reject', 'true'], ['reject', 'false'], ['reject', 'throw']]) {
        const receipt = await evaluate(`(async () => {
          const page = ${JSON.stringify(page)}, selector = ${JSON.stringify(selector)};
          const api = ${JSON.stringify(api)}, fallback = ${JSON.stringify(fallback)};
          const button = document.querySelector(selector);
          const status = document.querySelector('#' + button.getAttribute('aria-describedby'));
          let expected;
          if (page === 'index') expected = button.dataset.copyText || document.getElementById(button.dataset.copyFrom).textContent;
          else if (page === 'guide') expected = document.querySelector('.prompt-text').textContent;
          else if (button.dataset.copySource) expected = document.getElementById(button.dataset.copySource).textContent.trim();
          else if (selector === '#copy-prompt') expected = document.getElementById('recipe-prompt').textContent;
          else {
            const command = document.getElementById('agent-install-prompt').textContent.trim(), prompt = document.getElementById('recipe-prompt').textContent;
            expected = ${JSON.stringify(lang)} === 'zh' ? '为 Cursor 安装 Archify：\\n' + command + '\\n\\n然后在目标仓库中让 Cursor：\\n' + prompt : 'Install Archify for Cursor:\\n' + command + '\\n\\nThen, in your target repository, ask Cursor:\\n' + prompt;
          }
          const writes = [], legacy = [];
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: api === 'missing' ? undefined : { writeText: async text => { writes.push(text); if (api === 'reject') throw Error('denied'); } } });
          document.execCommand = command => { legacy.push({ command, text: document.activeElement.value }); if (fallback === 'throw') throw Error('unsupported'); return fallback === 'true'; };
          // Settle the previous receipt/recommendation layout before measuring
          // this attempt; clearing old feedback is not a clipboard scroll jump.
          status.textContent = '';
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          button.scrollIntoView({ block: 'center', behavior: 'instant' }); button.focus({ preventScroll: true });
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          let events = 0; const onCopy = () => { events++; };
          window.addEventListener('archify:start-funnel', onCopy);
          const before = { areas: document.querySelectorAll('textarea').length, scroll: scrollY };
          button.click();
          for (let i = 0; !status.textContent && i < 30; i++) await new Promise(resolve => setTimeout(resolve, 10));
          window.removeEventListener('archify:start-funnel', onCopy);
          const box = status.getBoundingClientRect();
          return { expected, writes, legacy, visible: box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth, status: status.textContent, role: status.getAttribute('role'), live: status.getAttribute('aria-live'), focus: document.activeElement === button, areas: document.querySelectorAll('textarea').length - before.areas, scrollDelta: scrollY - before.scroll, events };
        })()`);
        manifest.receipts.push({ lang, page, selector, api, fallback, ...receipt });
        fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
        const ok = api === 'success' || fallback === 'true';
        assert.equal(receipt.status, lang === 'zh' ? (ok ? '已复制到剪贴板。' : '复制失败，请手动选择文本。') : (ok ? 'Copied to clipboard.' : 'Copy failed. Select the text manually.'), `${page} ${selector} ${api}/${fallback}`);
        assert.deepEqual(receipt.writes, api === 'missing' ? [] : [receipt.expected]);
        assert.deepEqual(receipt.legacy, api === 'success' ? [] : [{ command: 'copy', text: receipt.expected }]);
        assert.equal(receipt.visible, true, 'feedback is visible near the clicked control at 320px');
        assert.equal(receipt.focus, true); assert.equal(receipt.areas, 0);
        assert.equal(receipt.scrollDelta, 0, `${lang} ${page} ${selector} ${api}/${fallback}: temporary textarea must not jump scroll`);
        assert.equal(receipt.role, 'status'); assert.equal(receipt.live, 'polite');
        if (page === 'start') assert.equal(receipt.events, ok ? 1 : 0, 'only successful copies emit conversion events');
      }
      if (page === 'start') {
        const lifecycle = await evaluate(`(async () => {
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } });
          const get = id => document.getElementById(id);
          const statuses = () => ['install-copy-status', 'project-copy-status', 'copy-status'].map(id => get(id).textContent);
          const copy = async selector => {
            const button = document.querySelector(selector); button.click();
            const status = get(button.getAttribute('aria-describedby'));
            for (let i = 0; !status.textContent && i < 30; i++) await new Promise(resolve => setTimeout(resolve, 10));
          };
          await copy('[data-copy-source="install-command"]');
          await copy('[data-copy-source="project-command"]');
          await copy('#copy-prompt');
          const before = statuses();
          for (const key of ['agent', 'type', 'input']) document.querySelector('[data-' + key + '][aria-selected="true"]').click();
          const unchanged = statuses();
          document.querySelector('[data-input="description"]').click();
          const inputChanged = statuses();
          await copy('#copy-prompt');
          document.querySelector('[data-type="architecture"]').click();
          const typeChanged = statuses();
          await copy('#copy-prompt');
          document.querySelector('[data-agent="codex"]').click();
          const agentChanged = statuses();
          await copy('#copy-starter');
          document.querySelector('[data-agent="cursor"]').click();
          const starterAgentChanged = statuses();
          await copy('#copy-starter');
          document.querySelector('[data-input="repository"]').click();
          const starterInputChanged = statuses();
          await copy('#copy-starter');
          document.querySelector('[data-type="workflow"]').click();
          const starterTypeChanged = statuses();
          return { before, unchanged, inputChanged, typeChanged, agentChanged, starterAgentChanged, starterInputChanged, starterTypeChanged };
        })()`);
        const success = lang === 'zh' ? '已复制到剪贴板。' : 'Copied to clipboard.';
        assert.deepEqual(lifecycle.before, [success, success, success]);
        assert.deepEqual(lifecycle.unchanged, lifecycle.before, 'active selections preserve completed receipts');
        assert.deepEqual(lifecycle.inputChanged, [success, success, ''], 'input changes only invalidate prompt content');
        assert.deepEqual(lifecycle.typeChanged, [success, success, ''], 'type changes preserve unchanged installation commands');
        assert.deepEqual(lifecycle.agentChanged, ['', '', success], 'agent change invalidates installation but not prompt-only content');
        for (const key of ['starterAgentChanged', 'starterInputChanged', 'starterTypeChanged']) assert.deepEqual(lifecycle[key], ['', '', ''], key);
        manifest.receipts.push({ lang, page, lifecycle });
        fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
      }
      // Slow responses must not overwrite a newer failure, restore stale focus,
      // or launch a fallback after the selected recipe/tab has been replaced.
      for (const lateOutcome of ['resolve', 'reject']) {
      const stale = await evaluate(`(async () => {
        const page = ${JSON.stringify(page)}, button = document.querySelector(${JSON.stringify(controls.at(-1))});
        const status = document.querySelector('#' + button.getAttribute('aria-describedby'));
        let settleFirst, calls = 0, fallbacks = 0, events = 0;
        const onCopy = () => { events++; }; window.addEventListener('archify:start-funnel', onCopy);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => ++calls === 1 ? new Promise((resolve, reject) => { settleFirst = () => ${JSON.stringify(lateOutcome)} === 'resolve' ? resolve() : reject(Error('late')); }) : Promise.reject(Error('denied')) } });
        document.execCommand = () => { fallbacks++; return false; };
        button.click(); button.click();
        await new Promise(resolve => setTimeout(resolve, 20));
        const latest = status.textContent;
        settleFirst(); await new Promise(resolve => setTimeout(resolve, 20));
        const concurrency = { latest, after: status.textContent, fallbacks };
        calls = 0; fallbacks = 0; button.click();
        if (page === 'guide') { document.querySelectorAll('[data-recipe]')[2].click(); document.querySelectorAll('[data-recipe]')[1].click(); }
        else if (page === 'start') { document.querySelector('[data-agent="codex"]').click(); document.querySelector('[data-agent="cursor"]').click(); }
        else { document.querySelector('.agent-tabs [data-agent="codex"]').click(); document.querySelector('.agent-tabs [data-agent="cursor"]').click(); }
        const focused = document.activeElement;
        settleFirst(); await new Promise(resolve => setTimeout(resolve, 20));
        window.removeEventListener('archify:start-funnel', onCopy);
        return { concurrency, fallbacks, events, focus: document.activeElement === focused, status: page === 'guide' ? document.getElementById('prompt-copy-status').textContent : status.textContent };
      })()`);
      assert.ok(stale.concurrency.latest); assert.equal(stale.concurrency.after, stale.concurrency.latest);
      assert.equal(stale.concurrency.fallbacks, 1); assert.equal(stale.fallbacks, 0); assert.equal(stale.events, 0); assert.equal(stale.focus, true); assert.equal(stale.status, '');
      manifest.receipts.push({ lang, page, lateOutcome, stale });
      }
      for (const captureSelector of controls) for (const theme of ['light', 'dark']) {
        await evaluate(`(async () => {
          document.documentElement.dataset.theme = ${JSON.stringify(theme)};
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
          document.execCommand = () => false;
          const button = document.querySelector(${JSON.stringify(captureSelector)}); button.click();
          await new Promise(resolve => setTimeout(resolve, 30));
          const status = document.getElementById(button.getAttribute('aria-describedby'));
          status.scrollIntoView({ block: 'center', behavior: 'instant' });
          await new Promise(resolve => setTimeout(resolve, 300));
        })()`);
        const file = `${lang}-${page}-${controls.indexOf(captureSelector)}-320-${theme}-failure.png`;
        const image = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, session);
        fs.writeFileSync(path.join(output, file), Buffer.from(image.data, 'base64'));
        manifest.screenshots.push(file);
      }
      fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
