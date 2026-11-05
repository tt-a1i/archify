import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const skillRoot = fileURLToPath(new URL('../archify/', import.meta.url));
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('local sibling navigation preserves reader context, authored overrides and parent context', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for real local-file navigation.',
}, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-drilldown-browser-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const run = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  };
  const loaded = async action => {
    const ready = browser.cdp.waitFor('Page.loadEventFired', session);
    await action();
    await ready;
    await run('document.fonts.ready.then(() => true)');
  };
  const child = path.join(root, 'drilldown-integrations.html');
  fs.copyFileSync(path.join(skillRoot, 'examples/drilldown-integrations.html'), child);
  const parent = path.join(root, 'drilldown-platform.html');
  for (const authored of ['', '?theme=light&embed=0&present=0', '#focus=gateway', '?theme=light&embed=0&present=0#focus=gateway']) {
    const spec = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/drilldown-platform.architecture.json')));
    spec.components.find(node => node.href).href = `drilldown-integrations.html${authored}`;
    const input = path.join(root, 'parent.json');
    fs.writeFileSync(input, JSON.stringify(spec));
    execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'), input, parent]);
    await loaded(() => send('Page.navigate', { url: pathToFileURL(parent).href + '?theme=dark&embed=1&present=1' }));
    const exported = await run(`(async () => {
      var blob;
      var create = URL.createObjectURL;
      var click = HTMLAnchorElement.prototype.click;
      URL.createObjectURL = value => { blob = value; return create.call(URL, value); };
      HTMLAnchorElement.prototype.click = function () {};
      try { await Archify.exportMenu.run('svg'); } finally {
        URL.createObjectURL = create;
        HTMLAnchorElement.prototype.click = click;
      }
      const text = await blob.text();
      const frame = document.createElement('iframe');
      frame.style.display = 'none';
      const ready = new Promise(resolve => frame.onload = resolve);
      frame.srcdoc = text;
      document.body.appendChild(frame);
      await ready;
      const doc = frame.contentDocument;
      const anchor = doc.querySelector('a[data-archify-drilldown]');
      const arrow = doc.querySelector('.archify-drilldown-mark-arrow');
      const result = { href: anchor.getAttribute('href'),
        runtime: anchor.hasAttribute('data-archify-authored-href'),
        stroke: frame.contentWindow.getComputedStyle(arrow).stroke };
      frame.remove();
      return result;
    })()`);
    assert.equal(exported.href, `drilldown-integrations.html${authored}`);
    assert.equal(exported.runtime, false);
    assert.notEqual(exported.stroke, 'none', 'exported sibling mark retains its visible arrow');
    const target = await run(`(() => {
      const a = document.querySelector('a[data-archify-drilldown]');
      const r = a.getBoundingClientRect();
      return { href: a.getAttribute('href'), x:r.x+r.width/2, y:r.y+r.height/2 };
    })()`);
    await loaded(async () => {
      await send('Input.dispatchMouseEvent', { type:'mousePressed', x:target.x, y:target.y, button:'left', clickCount:1 });
      await send('Input.dispatchMouseEvent', { type:'mouseReleased', x:target.x, y:target.y, button:'left', clickCount:1 });
    });
    const state = await run(`({ href:location.href, theme:document.documentElement.dataset.theme,
      embed:document.documentElement.dataset.embed || null, present:document.documentElement.dataset.present || null })`);
    assert.equal(path.basename(fileURLToPath(new URL(state.href))), 'drilldown-integrations.html');
    assert.equal(state.theme, authored.startsWith('?') ? 'light' : 'dark');
    assert.equal(state.embed, authored.startsWith('?') ? null : 'true');
    assert.equal(state.present, authored.startsWith('?') ? null : 'true');
    if (authored.includes('#')) assert.equal(new URL(state.href).hash, '#focus=gateway');
    // The parent may be embedded, so trigger its same Back handler directly.
    await loaded(() => run("document.getElementById('btn-parent-back').click()"));
    const back = new URL(await run('location.href'));
    assert.equal(path.basename(fileURLToPath(back)), 'drilldown-platform.html');
    assert.equal(back.searchParams.get('theme'), 'dark');
    assert.equal(back.searchParams.get('embed'), '1');
    assert.equal(back.searchParams.get('present'), '1');
  }
});
