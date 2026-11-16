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
const output = path.join(website, '.browser-evidence', target, 'guide-keyboard');

test('real Chrome: Guide native keyboard activation retains focus and exposes selected filters', {
  skip: enabled ? false : 'Set ARCHIFY_SITE_INTEGRATION=1 and ARCHIFY_CHROME to run Guide keyboard evidence.',
  timeout: 120000,
}, async () => {
  const chrome = findChrome();
  assert.ok(chrome, 'The requested Guide keyboard gate requires usable Chrome.');
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

    const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const press = async (key, shift = false) => {
      const code = { Enter: 'Enter', ' ': 'Space', Tab: 'Tab' }[key];
      const keyCode = { Enter: 13, ' ': 32, Tab: 9 }[key];
      const data = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers: shift ? 8 : 0 };
      await browser.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...data, ...(key === ' ' ? { text: ' ' } : key === 'Enter' ? { text: '\r' } : {}) }, session);
      await browser.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...data }, session);
      await settle();
    };
    const click = async selector => {
      const point = await evaluate(`(async () => {
        const e = document.querySelector(${JSON.stringify(selector)});
        e.scrollIntoView({block:'center', behavior:'instant'});
        // A previous card may still have a compositor-driven smooth scroll.
        // Measure after frames settle, not in the same call as scrollIntoView.
        let previous, stable = 0;
        const deadline = performance.now() + 3000;
        while (performance.now() < deadline) {
          await new Promise(resolve => requestAnimationFrame(resolve));
          const r = e.getBoundingClientRect(), current = { x:r.x + r.width/2, y:r.y + r.height/2, scroll:scrollY };
          const hit = document.elementFromPoint(current.x, current.y);
          const targetHit = hit === e || e.contains(hit);
          stable = previous && targetHit && Math.abs(current.x - previous.x) < .25 && Math.abs(current.y - previous.y) < .25 && Math.abs(current.scroll - previous.scroll) < .25 ? stable + 1 : 0;
          previous = current;
          if (stable >= 3) {
            window.guidePointerReceipt = { selector:${JSON.stringify(selector)}, point:current, events:[] };
            for (const type of ['mousedown', 'mouseup', 'click']) document.addEventListener(type, event => {
              window.guidePointerReceipt.events.push({ type, intended:event.target === e || e.contains(event.target), target:event.target.id || event.target.tagName, x:event.clientX, y:event.clientY, scroll:scrollY });
            }, { once:true, capture:true });
            return { x:current.x, y:current.y };
          }
        }
        throw new Error('Pointer target did not settle: ' + ${JSON.stringify(selector)} + ' ' + JSON.stringify(previous));
      })()`);
      for (const type of ['mousePressed', 'mouseReleased']) await browser.cdp.send('Input.dispatchMouseEvent', { type, ...point, button:'left', clickCount:1 }, session);
      await settle();
      const receipt = await evaluate('window.guidePointerReceipt');
      manifest.pointerEvents ??= [];
      manifest.pointerEvents.push(receipt);
      fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
      assert.deepEqual(receipt.events.map(event => event.type), ['mousedown', 'mouseup', 'click'], 'native pointer dispatch produces the complete activation sequence');
      assert.ok(receipt.events.every(event => event.intended), 'native pointer events must hit the intended control: ' + JSON.stringify(receipt));
    };
    const focus = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    const active = () => evaluate(`(() => { const e = document.activeElement; return e.dataset.filter || e.id || e.className || e.tagName; })()`);
    const capture = async (lang, width, theme, region) => {
      await evaluate(`document.activeElement.scrollIntoView({block:'center', behavior:'instant'})`);
      await settle();
      const receipt = await evaluate(`(() => {
        const e = document.activeElement, r = e.getBoundingClientRect(), s = getComputedStyle(e);
        return { text:e.textContent, focusVisible:e.matches(':focus-visible'), outline:s.outlineStyle, outlineWidth:s.outlineWidth,
          fits:r.left >= 0 && r.right <= innerWidth && r.top >= document.querySelector('.site-nav').getBoundingClientRect().bottom && r.bottom <= innerHeight,
          pageWidth:document.documentElement.scrollWidth, lang:document.documentElement.lang };
      })()`);
      const file = `${lang}-${width}-${theme}-${region}.png`;
      const image = await browser.cdp.send('Page.captureScreenshot', { format: 'png' }, session);
      fs.writeFileSync(path.join(output, file), Buffer.from(image.data, 'base64'));
      manifest.screenshots.push({ file, receipt });
      assert.ok(receipt.focusVisible && receipt.outline !== 'none' && parseFloat(receipt.outlineWidth) >= 2, `${file}: visible focus`);
      assert.ok(receipt.fits && receipt.pageWidth <= width + 1, `${file}: focus remains visible without overflow`);
    };
    await browser.cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, session);
    for (const lang of ['en', 'zh']) for (const width of [320, 1440]) for (const theme of ['light', 'dark']) {
      await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: width === 320 }, session);
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session); loaded.catch(() => {});
      await browser.cdp.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}${mount}/${lang === 'zh' ? 'zh/' : ''}guide.html` }, session);
      await loaded;
      await evaluate(`document.fonts.ready`);
      await evaluate(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
      // Let existing theme transitions settle before taking visual evidence.
      await evaluate('new Promise(resolve => setTimeout(resolve, 300))');
      // Pointer smoke is separate from the native keyboard regressions below.
      await click('[data-filter="workflow"]');
      assert.equal(await active(), 'workflow');
      await click('[data-recipe]');
      assert.equal(await evaluate(`document.activeElement.matches('[data-recipe]')`), true, 'card activation preserves its focused control');
      await evaluate(`document.getElementById('scenario').value = 'api request cache miss event stream'`);
      await click('#recommend'); assert.equal(await active(), 'recommend');
      await click('[data-alt]'); assert.equal(await active(), 'result-title', 'focused pointer alternative receives a sensible replacement target');
      await click('#recommend');
      await focus('#scenario');
      await evaluate(`document.querySelector('[data-alt]').click()`);
      assert.equal(await active(), 'scenario', 'unfocused programmatic activation does not steal another control’s focus');
      manifest.receipts.push({ lang, width, theme, pointer: 'card, recommendation and alternative focus verified', unfocusedAlternative: 'scenario focus preserved' });
      for (const key of ['Enter', ' ']) {
        await focus('[data-filter="workflow"]');
        await press(key);
        assert.equal(await active(), 'workflow', 'activation does not discard the focused filter');
        const filters = await evaluate(`(() => ({
          selected:[...document.querySelectorAll('[data-filter][aria-pressed="true"]')].map(e => e.dataset.filter),
          unselected:[...document.querySelectorAll('[data-filter]:not([data-filter="workflow"])')].every(e => e.getAttribute('aria-pressed') === 'false'),
          cards:[...document.querySelectorAll('#cards .card-type')].map(e => e.textContent),
          expected:JSON.parse(document.getElementById('guide-data').textContent).filter(r => r.type === 'workflow').length
        }))()`);
        assert.deepEqual(filters.selected, ['workflow']); assert.equal(filters.unselected, true);
        assert.equal(filters.cards.length, filters.expected); assert.ok(filters.cards.every(type => type === 'workflow'));
        if (key === 'Enter') await capture(lang, width, theme, 'filter');
        await press('Tab'); assert.equal(await active(), 'sequence');
        await press('Tab', true); assert.equal(await active(), 'workflow');
        await press('Tab', true); assert.equal(await active(), 'architecture');
        // Switch selection as well as reactivating an already selected filter.
        await press(key); assert.equal(await active(), 'architecture');
        assert.equal(await evaluate(`document.querySelector('[data-filter="architecture"]').getAttribute('aria-pressed')`), 'true');
        assert.equal(await evaluate(`document.querySelector('[data-filter="workflow"]').getAttribute('aria-pressed')`), 'false');

        await evaluate(`document.getElementById('scenario').value = 'api request cache miss event stream'`);
        await focus('#recommend'); await press(key);
        assert.equal(await active(), 'recommend', 'recommendation does not gratuitously move focus');
        const expected = await evaluate(`(() => {
          const e = document.querySelector('[data-alt]');
          const r = JSON.parse(document.getElementById('guide-data').textContent).find(r => r.id === e.dataset.alt);
          return { title:r[${JSON.stringify(lang)}].title, prompt:r[${JSON.stringify(lang)}].prompt, next:r.proof ? 'proof-link' : 'copy-prompt' };
        })()`);
        await focus('[data-alt]'); await press(key);
        assert.equal(await active(), 'result-title', 'replaced alternative transfers focus to its new result heading');
        assert.equal(await evaluate(`document.querySelector('#result-title').textContent`), expected.title);
        assert.equal(await evaluate(`document.querySelector('.prompt-text').textContent`), expected.prompt);
        assert.equal(await evaluate(`document.querySelectorAll('[data-alt]').length`), 0);
        if (key === 'Enter') await capture(lang, width, theme, 'result');
        await press('Tab'); assert.equal(await active(), expected.next, 'Tab continues into the selected result');
        await focus('#result-title'); await press('Tab', true); assert.equal(await active(), 'clear', 'Shift+Tab returns to preceding controls');
        manifest.receipts.push({ lang, width, theme, key, filters, result: expected });
        fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
      }
    }
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
});
