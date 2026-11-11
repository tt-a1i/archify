import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { startAnalysisView } from '../archify/modules/code-analysis/bin/serve.mjs';

const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
test('organization signals show lexical evidence and explain uncertainty', { skip: chrome ? false : 'Set ARCHIFY_CHROME to run browser coverage.' }, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-org-browser-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'repo'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'entry.mjs'), 'process.argv;\nconst fs = require("fs");\nrender(view);\n');
  const ir = path.join(scratch, 'ir.json');
  fs.writeFileSync(ir, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'Organization', output: 'architecture.html' }, components: [{ id: 'app', type: 'backend', label: 'App', pos: [40, 40], size: [170, 64] }], connections: [] }));
  const config = path.join(scratch, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ rules: { organization: { mixedRoles: { enabled: true } } } }));
  const view = await startAnalysisView([root, '--ir', ir, '--out', path.join(scratch, 'view'), '--language', 'ts', '--config', config]);
  t.after(() => new Promise((resolve) => { view.server.close(resolve); view.server.closeAllConnections?.(); }));
  const browser = new ChromeVisualBrowser(chrome); t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(response.exceptionDetails, undefined, response.exceptionDetails?.exception?.description);
    return response.result?.value;
  };
  const wait = async (expression) => {
    const until = Date.now() + 60000;
    while (Date.now() < until) { if (await run(`Boolean(${expression})`)) return; await new Promise(resolve => setTimeout(resolve, 100)); }
    throw new Error(`Timed out waiting for ${expression}`);
  };
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: view.url }); await loaded;
  await run("document.getElementById('code-analysis-start').click()");
  await wait("document.documentElement.getAttribute('data-bauify') === 'on'");
  await wait("[...document.querySelectorAll('#bauify-overview .bauify-item')].some(e => e.textContent.includes('organization/mixed-roles'))");
  await run("[...document.querySelectorAll('#bauify-overview .bauify-item')].find(e => e.textContent.includes('organization/mixed-roles')).click()");
  const detail = await run("document.getElementById('bauify-reader').innerText");
  assert.match(detail, /Lexical matches are review signals, not proof of responsibility/);
  assert.match(detail, /entry: process\.argv/);
  assert.match(detail, /view: render/);
});
