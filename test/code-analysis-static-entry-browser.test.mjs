import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { startAnalysisView } from '../archify/modules/code-analysis/bin/serve.mjs';
import { fixture, run } from './helpers/repository-evidence-fixture.mjs';

test('repository-bound architecture offers an accessible local analysis guide', {
  skip: process.env.ARCHIFY_CHROME ? false : 'Set ARCHIFY_CHROME to run browser checks.', timeout: 60000,
}, async () => {
  const data = fixture();
  const browser = new ChromeVisualBrowser(findChrome());
  try {
    for (const locale of ['en', 'zh-CN']) {
      data.diagram.meta.locale = locale;
      fs.writeFileSync(data.input, JSON.stringify(data.diagram));
      const artifactPath = path.join(data.root, `${locale}.html`);
      const delivered = run(['deliver', 'architecture', data.input, artifactPath, '--repo-root', data.root, '--json']);
      assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
      for (const theme of ['light', 'dark']) {
        await browser.inspect({ artifactPath, width: 1440, height: 900, theme });
        const session = await browser.sessionPromise;
        const evaluate = async expression => {
          const result = await browser.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
          assert.equal(result.exceptionDetails, undefined);
          return result.result.value;
        };
        const observed = await evaluate(`(async () => {
          const button = document.getElementById('archify-code-analysis-entry');
          button.focus(); button.click();
          const dialog = document.getElementById('archify-code-analysis-guide');
          let copied = null;
          Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied = value; } } });
          dialog.querySelector('[data-copy]').click();
          await new Promise(resolve => setTimeout(resolve, 0));
          return { label: button.textContent, open: dialog.open, copied, status: dialog.querySelector('[role=status]').textContent,
            title: dialog.getAttribute('aria-labelledby'), theme: document.documentElement.dataset.theme };
        })()`);
        assert.equal(observed.label, locale === 'en' ? 'Code Analysis' : '架构诊断');
        assert.equal(observed.open, true);
        assert.equal(observed.copied, 'archify map .');
        assert.ok(observed.status);
        assert.equal(observed.title, 'archify-code-analysis-title');
        assert.equal(observed.theme, theme);
        await browser.cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, session);
        await browser.cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, session);
        assert.equal(await evaluate(`!document.getElementById('archify-code-analysis-guide').open && document.activeElement.id === 'archify-code-analysis-entry'`), true);
      }
      const reportPath = path.join(data.root, `report-${locale}.html`);
      fs.writeFileSync(reportPath, fs.readFileSync(artifactPath, 'utf8').replace('</body>', '<script type="application/json" id="bauify-analysis">{}</script></body>'));
      await browser.inspect({ artifactPath: reportPath, width: 1440, height: 900, theme: 'dark' });
      const session = await browser.sessionPromise;
      const result = await browser.cdp.send('Runtime.evaluate', { expression: `!!document.getElementById('archify-code-analysis-entry')`, returnByValue: true }, session);
      assert.equal(result.result.value, false);
    }
  } finally { await browser.close(); }
});

test('unbound diagrams do not contain the local analysis guide', () => {
  const data = fixture();
  delete data.diagram.meta.repository;
  delete data.diagram.components[0].sources;
  fs.writeFileSync(data.input, JSON.stringify(data.diagram));
  for (const options of [[], ['--repo-root', data.root]]) {
    const output = path.join(data.root, options.length ? 'root-only.html' : 'unbound.html');
    const delivered = run(['deliver', 'architecture', data.input, output, ...options, '--json']);
    assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
    assert.equal(fs.readFileSync(output, 'utf8').includes('archify-code-analysis-guide'), false);
  }
});

// Exercise real startup injection: there is no analysis payload before the click.
test('bound live diagram has one analysis control before and after analysis', {
  skip: process.env.ARCHIFY_CHROME ? false : 'Set ARCHIFY_CHROME to run browser checks.', timeout: 60000,
}, async t => {
  const data = fixture();
  const view = await startAnalysisView([data.root, '--ir', data.input, '--out', path.join(data.root, 'view'), '--language', 'ts']);
  const sockets = new Set(); view.server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  t.after(() => new Promise(resolve => { view.server.close(resolve); for (const socket of sockets) socket.destroy(); }));
  const browser = new ChromeVisualBrowser(findChrome()); t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const evaluate = async expression => {
    const result = await browser.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session);
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description); return result.result.value;
  };
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await browser.cdp.send('Page.navigate', { url: view.url }, session); await loaded;
  assert.equal(await evaluate("document.querySelectorAll('#archify-code-analysis-entry,#code-analysis-start,#btn-bauify').length"), 1);
  assert.equal(await evaluate("!!document.getElementById('bauify-analysis')"), false);
  await evaluate("document.getElementById('code-analysis-start').click()");
  const deadline = Date.now() + 20000;
  while (!await evaluate("!!document.getElementById('bauify-analysis')")) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 40)); }
  assert.equal(await evaluate("document.querySelectorAll('#archify-code-analysis-entry,#code-analysis-start,#btn-bauify').length"), 1);
  assert.equal(await evaluate("document.documentElement.getAttribute('data-bauify')"), 'on');
});
