import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { injectUpdateNotice } from '../archify/bin/update-notice.mjs';
import { inspectPublicHtml } from '../archify/explainer/browser-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chromeConfigured = Object.prototype.hasOwnProperty.call(process.env, 'ARCHIFY_CHROME');
const chromePath = chromeConfigured ? findChrome() : null;
if (chromeConfigured && !chromePath) {
  throw new Error(`ARCHIFY_CHROME does not resolve to an executable browser: ${process.env.ARCHIFY_CHROME}`);
}

test('the Viewer notice docks without moving the diagram, copies offline, and suppresses in other modes', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-update-notice-browser-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const plain = path.join(scratch, 'plain.html');
  execFileSync(process.execPath, [
    path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'),
    path.join(skillRoot, 'examples/checkout-ledger.architecture.json'),
    plain,
  ]);
  const noticed = path.join(scratch, 'noticed.html');
  const injected = injectUpdateNotice(fs.readFileSync(plain, 'utf8'), {
    installedVersion: '2.15.0', availableVersion: '2.16.0', severity: 'normal',
    releaseNotes: 'https://github.com/tt-a1i/archify/releases/tag/v2.16.0',
  });
  assert.equal(injected.embedded, true);
  fs.writeFileSync(noticed, injected.html);
  const browser = new ChromeVisualBrowser(chromePath);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const requests = [];
  browser.cdp.subscribe((event) => {
    const url = event.params?.request?.url;
    if (event.sessionId === session && event.method === 'Network.requestWillBeSent' && /^https?:/.test(url)) requests.push(url);
  });
  await browser.cdp.send('Network.enable', {}, session);
  const resize = (width, height = 900) => browser.cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, session);
  const evaluate = async (expression) => {
    const result = await browser.cdp.send('Runtime.evaluate', {
      awaitPromise: true, returnByValue: true, userGesture: true, expression,
    }, session, 20000);
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result.value;
  };
  const state = () => evaluate(`(async () => {
    await Archify.layoutStability.whenStable();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const rect = el => el?.getBoundingClientRect().toJSON();
    const notice = document.querySelector('[data-archify-update-notice]');
    return {
      diagram: rect(document.querySelector('.diagram-container')),
      svg: rect(document.querySelector('.diagram-container svg')),
      row: rect(document.querySelector('.header-row')),
      title: rect(document.querySelector('.header h1')),
      toolbar: rect(document.querySelector('.toolbar')),
      pill: rect(notice?.firstElementChild),
      footer: notice?.parentElement.matches('footer.page-feedback'),
      shown: (notice?.getBoundingClientRect().height ?? 0) > 0,
      pillBackground: notice && getComputedStyle(notice.firstElementChild).backgroundColor,
    };
  })()`);
  const load = async (file, { media = 'screen', theme = 'light' } = {}) => {
    await browser.cdp.send('Emulation.setEmulatedMedia', { media }, session);
    const url = pathToFileURL(file);
    url.searchParams.set('theme', theme);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    loaded.catch(() => {});
    await browser.cdp.send('Page.navigate', { url: url.href }, session);
    await loaded;
    return state();
  };
  const assertHeader = ({ shown, footer, pill, row, title, toolbar }) => {
    assert.ok(shown && !footer, JSON.stringify({ shown, footer, pill, row, title, toolbar }));
    const titleEnd = Math.max(row.right, title.right);
    assert.ok(pill.left >= titleEnd + 12 && pill.right <= toolbar.left - 12);
    assert.ok(Math.abs((pill.left + pill.right) / 2 - (titleEnd + toolbar.left) / 2) < 1);
    assert.ok(pill.top >= row.top && pill.bottom <= row.bottom);
  };
  const assertFooter = ({ shown, footer, pill, row, toolbar }) => {
    assert.ok(shown && footer);
    assert.ok(pill.top >= Math.max(row.bottom, toolbar.bottom));
  };
  await resize(1440);
  const base = await load(plain);
  const candidate = await load(noticed);
  assertHeader(candidate);
  assert.deepEqual(candidate.diagram, base.diagram);
  assert.deepEqual(candidate.svg, base.svg);
  const dark = await load(noticed, { theme: 'dark' });
  assertHeader(dark);
  assert.notEqual(dark.pillBackground, candidate.pillBackground);

  await resize(760);
  assertFooter(await state());
  await resize(390, 844);
  assertFooter(await state());
  await resize(1440);
  assertHeader(await state());
  await evaluate("document.querySelector('.header h1').textContent = 'A long diagram title '.repeat(12)");
  assertFooter(await state());
  await evaluate("document.querySelector('.header h1').textContent = 'Checkout ledger'");
  assertHeader(await state());
  await evaluate("document.querySelector('.toolbar').style.minWidth = '650px'");
  assertFooter(await state());
  await evaluate("document.querySelector('.toolbar').style.minWidth = ''");
  assertHeader(await state());

  const prompt = 'Update my installed Archify skill to 2.16.0 (confirm my current install method and scope first, then follow https://archify.si/llms.txt).';
  const copyState = await evaluate(`(async () => {
    const button = document.querySelector('.archify-update-notice__copy');
    const initial = button.textContent;
    let copied;
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { copied = text; } } });
    button.click();
    await Promise.resolve();
    const feedback = { text: button.textContent, state: button.dataset.copied };
    const deadline = performance.now() + 2500;
    while (button.dataset.copied && performance.now() < deadline) {
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return { copied, initial, feedback, restored: button.textContent, cleared: !button.dataset.copied };
  })()`);
  assert.deepEqual(copyState, {
    copied: prompt, initial: 'Copy update prompt', feedback: { text: 'Copied for Agent', state: 'true' },
    restored: 'Copy update prompt', cleared: true,
  });
  // Exercise the real file:// fallback without writing to the host clipboard.
  const { x, y } = await evaluate(`(() => {
    const button = document.querySelector('.archify-update-notice__copy');
    Object.defineProperty(navigator, 'clipboard', { value: undefined });
    document.addEventListener('copy', event => {
      event.preventDefault();
      const field = document.activeElement;
      window.selectedPrompt = field.value.slice(field.selectionStart, field.selectionEnd);
    }, { once: true });
    button.scrollIntoView({ block: 'nearest' });
    const box = button.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  })()`);
  await browser.cdp.send('Page.bringToFront', {}, session);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await browser.cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, session);
  }
  assert.deepEqual(await evaluate(`({
    selected: window.selectedPrompt,
    copied: document.querySelector('.archify-update-notice__copy').dataset.copied,
  })`), { selected: prompt, copied: 'true' });
  assert.deepEqual(requests, [], 'page load and copy send no HTTP requests');

  for (const mode of ['present', 'embed']) {
    // Test the actual CSS contract without coupling to Viewer mode controls.
    assert.equal(await evaluate(`(() => {
      const root = document.documentElement;
      const attr = 'data-${mode}';
      const notice = document.querySelector('[data-archify-update-notice]');
      root.setAttribute(attr, 'true');
      const hidden = notice.getBoundingClientRect().height === 0;
      root.removeAttribute(attr);
      return hidden;
    })()`), true, mode);
  }
  await evaluate("document.querySelector('.archify-update-notice__close').click()");
  assert.equal((await state()).shown, false);
  assert.equal((await load(noticed, { media: 'print' })).shown, false);
  await load(noticed);
  await resize(760);
  assertFooter(await state());
  await evaluate("document.querySelector('.archify-update-notice__close').click()");
  assert.equal((await state()).shown, false);

  await browser.inspect({ artifactPath: noticed, width: 1440, height: 900, theme: 'light' });
  assert.equal(await evaluate("document.querySelector('[data-archify-update-notice]') === null"), true);
});

// Explainer image export clones the whole page and captures 48px below the
// shell; the notice must not reach PNG/WebP/JPG downloads.
test('Explainer image export is unchanged by a visible update notice', {
  skip: chromePath ? false : 'Set ARCHIFY_CHROME to run the real browser regression.',
}, async () => {
  const { renderExplainer } = await import('../archify/explainer/render.mjs');
  const document = { schema_version: 1, diagram_type: 'explainer', meta: { id: 'notice-export', title: 'Notice export', locale: 'en' }, answer: { summary: 'Read the cache first.', reasons: ['Fewer database queries'], scope: 'Illustrative request path' }, panels: [{ id: 'why', title: 'Why does it work?', blocks: [{ id: 'claim', type: 'prose', text: 'A cached read is fast.' }] }], sources: [{ id: 'example', title: 'Example' }] };
  const plainHtml = renderExplainer(document, { preparedSources: { sources: { example: { id: 'example', title: 'Example' } } }, sourceText: JSON.stringify(document) });
  const injected = injectUpdateNotice(plainHtml, {
    installedVersion: '2.15.0', availableVersion: '2.16.0', severity: 'normal',
    releaseNotes: 'https://github.com/tt-a1i/archify/releases/tag/v2.16.0',
  });
  assert.equal(injected.embedded, true);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-update-notice-explainer-'));
  const plain = path.join(scratch, 'plain.html');
  const noticed = path.join(scratch, 'noticed.html');
  fs.writeFileSync(plain, plainHtml);
  fs.writeFileSync(noticed, injected.html);
  const browser = new ChromeVisualBrowser(chromePath);
  try {
    const session = await browser.sessionPromise;
    await browser.cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, session);
    const exported = async (file) => {
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
      loaded.catch(() => {});
      await browser.cdp.send('Page.navigate', { url: pathToFileURL(file).href }, session);
      await loaded;
      const result = await browser.cdp.send('Runtime.evaluate', {
        awaitPromise: true,
        returnByValue: true,
        expression: `document.fonts.ready.then(async function () {
          var notice = document.querySelector('[data-archify-update-notice]');
          var blob = await window.ArchifyExplainer.pageImage();
          var bitmap = await createImageBitmap(blob), canvas = document.createElement('canvas');
          canvas.width = bitmap.width; canvas.height = bitmap.height;
          var context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0);
          var bytes = context.getImageData(0, 0, canvas.width, canvas.height).data, hash = 0;
          for (var i = 0; i < bytes.length; i++) hash = (hash * 31 + bytes[i]) >>> 0;
          bitmap.close();
          return { width: canvas.width, height: canvas.height, hash: hash, noticeShown: Boolean(notice) && notice.getBoundingClientRect().height > 0, footer: notice?.parentElement === document.body || notice?.parentElement.matches('footer.page-feedback') };
        })`,
      }, session, 20000);
      assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
      return result.result.value;
    };
    const base = await exported(plain);
    const candidate = await exported(noticed);
    assert.equal(base.noticeShown, false);
    assert.equal(candidate.noticeShown, true);
    assert.equal(candidate.footer, true);
    assert.deepEqual(
      { width: candidate.width, height: candidate.height, hash: candidate.hash },
      { width: base.width, height: base.height, hash: base.hash },
    );
    const checked = await inspectPublicHtml(browser, { artifactPath: noticed, keyboard: false });
    assert.doesNotMatch(checked.bodyText, /Archify 2\.16\.0 available/);
    assert.deepEqual(checked.consoleErrors, []);
  } finally {
    await browser.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});
