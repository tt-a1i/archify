import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { startAnalysisView } from '../archify/modules/code-analysis/bin/serve.mjs';

const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

// One function with complexity 27 (warning), deepest block on line 9.
const DISPATCH = ['def dispatch(kind, items, flag):', '    total = 0', '    for item in items:', '        if item.ready:', '            while item.pending:',
  ...Array.from({ length: 22 }, (_, i) => `                ${i ? 'elif' : 'if'} kind == ${i}:\n                    total += ${i}`),
  '                item.pending -= 1', '    return total if flag else 0', ''].join('\n');

test('Code Analysis shows complex Python functions in the overview, problem page, source and component panel', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run Code Analysis browser coverage.',
}, async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-complexity-browser-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'repo');
  fs.mkdirSync(path.join(root, 'engine'), { recursive: true });
  fs.mkdirSync(path.join(root, 'web'), { recursive: true });
  fs.writeFileSync(path.join(root, 'engine/__init__.py'), '');
  fs.writeFileSync(path.join(root, 'engine/router.py'), DISPATCH);
  fs.writeFileSync(path.join(root, 'web/__init__.py'), '');
  fs.writeFileSync(path.join(root, 'web/app.py'), 'from engine.router import dispatch\n\ndef index():\n    return dispatch(1, [], True)\n');
  const ir = path.join(scratch, 'input.json');
  fs.writeFileSync(ir, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'Complexity browser regression', output: 'architecture.html' },
    components: [
      { id: 'core', type: 'backend', label: 'Engine', pos: [40, 60], size: [180, 64] },
      { id: 'site', type: 'frontend', label: 'Web', pos: [340, 60], size: [180, 64] },
    ], connections: [{ from: 'site', to: 'core', label: 'calls' }] }));
  const map = path.join(scratch, 'map.json');
  fs.writeFileSync(map, JSON.stringify({ core: ['engine'], site: ['web'] }));
  const view = await startAnalysisView([root, '--ir', ir, '--map', map, '--out', path.join(scratch, 'view'), '--language', 'py']);
  const sockets = new Set();
  view.server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  t.after(() => new Promise(resolve => { view.server.close(resolve); for (const socket of sockets) socket.destroy(); }));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async expression => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(response.exceptionDetails, undefined, response.exceptionDetails?.exception?.description);
    return response.result?.value;
  };
  const wait = async expression => {
    const start = Date.now();
    while (Date.now() - start < 60000) {
      if (await run(`Boolean(${expression})`)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: view.url });
  await loaded;
  await run("document.getElementById('code-analysis-start').click()");
  await wait("document.documentElement.getAttribute('data-bauify') === 'on'");

  const overview = await run("document.getElementById('bauify-overview').innerText");
  assert.match(overview, /Start with the most complex functions below\./);
  assert.match(overview, /dispatch\(\) is complex/);
  assert.match(overview, /complexity 27 · nesting 4 · \d+ lines · engine\/router\.py/);
  assert.doesNotMatch(await run("document.getElementById('bauify-overview').textContent"), /Not checked: complexity/, 'Python functions were measured');

  await run("[...document.querySelectorAll('#bauify-overview .bauify-item')].find(b => /dispatch/.test(b.textContent)).click()");
  await wait("!document.getElementById('bauify-detail').hidden");
  assert.equal(await run("document.querySelector('#bauify-detail .relationship').open"), false);
  assert.ok(await run("document.querySelector('#bauify-detail .inline-evidence pre').textContent.includes('if kind == 0:')"));
  await run("document.querySelector('#bauify-detail .more-evidence').open = true");
  const problem = await run("document.getElementById('bauify-detail').innerText");
  assert.match(problem, /A high count is a maintenance signal, not a defect/);
  assert.match(problem, /router\.py \(line 1\) dispatch\(\) starts/);
  assert.match(problem, /deepest nesting \(4 levels\)/);
  assert.equal(await run("document.querySelectorAll('#bauify-detail svg.diagram rect.bar').length"), 2);

  await run("[...document.querySelectorAll('#bauify-detail .ref')].find(b => /deepest/.test(b.textContent)).click()");
  await wait("!document.getElementById('bauify-code').hidden");
  assert.match(await run("document.querySelector('#bauify-code .ln.hit').textContent"), /if kind == 0:/);

  await run("document.querySelector('g[data-node-id=core]').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  await wait("!document.getElementById('bauify-panel').hidden");
  assert.match(await run("document.getElementById('bauify-panel').innerText"), /Complex functions/);
  await run("document.querySelector('g[data-node-id=site]').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  await wait("!document.getElementById('bauify-panel').hidden && /Web/.test(document.getElementById('bauify-panel').innerText)");
  assert.doesNotMatch(await run("document.getElementById('bauify-panel').innerText"), /Complex functions/);
});

for (const fixture of [
  {
    language: 'ts', file: 'handlers.mjs',
    source: `server.on('request', req => { if (req) return 1; return 0; });
server.on('request', req => { if (req) return 2; return 0; });`,
    titles: ['<callback of server.on("request")>() is complex', '<callback of server.on("request")>#2() is complex'],
  },
  {
    language: 'java', file: 'Service.java',
    source: `class Service {
  boolean remove(Object value) { if (value == null) return false; return true; }
  boolean remove(String value) { if (value == null) return false; return true; }
}`,
    titles: ['Service.remove(Object) is complex', 'Service.remove(String) is complex'],
  },
]) test(`Code Analysis preserves complexity titles for ${fixture.language} callbacks and signatures`, {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run Code Analysis browser coverage.',
}, async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-complexity-title-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'repo');
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', fixture.file), fixture.source);
  const ir = path.join(scratch, 'input.json');
  fs.writeFileSync(ir, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'Complexity titles', output: 'architecture.html' },
    components: [{ id: 'app', type: 'backend', label: 'App', pos: [40, 40], size: [180, 64] }], connections: [] }));
  const map = path.join(scratch, 'map.json');
  fs.writeFileSync(map, JSON.stringify({ app: ['src'] }));
  const config = path.join(scratch, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ rules: { complexity: { function: { info: { complexity: 2 } } } } }));
  const view = await startAnalysisView([root, '--ir', ir, '--map', map, '--config', config, '--out', path.join(scratch, 'view'), '--language', fixture.language]);
  const sockets = new Set();
  view.server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  t.after(() => new Promise(resolve => { view.server.close(resolve); for (const socket of sockets) socket.destroy(); }));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async expression => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(response.exceptionDetails, undefined, response.exceptionDetails?.exception?.description);
    return response.result?.value;
  };
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: view.url });
  await loaded;
  await run("document.getElementById('code-analysis-start').click()");
  await run(`new Promise((resolve, reject) => { const deadline = Date.now() + 15000; const poll = () => {
    if (document.documentElement.getAttribute('data-bauify') === 'on') return resolve();
    if (Date.now() > deadline) return reject(new Error('Analysis did not open'));
    setTimeout(poll, 25);
  }; poll(); })`);
  const titles = await run("[...document.querySelectorAll('#bauify-overview .bauify-item > b')].map(el => el.textContent)");
  assert.deepEqual([...new Set(titles)].sort(), fixture.titles.slice().sort());
  for (const title of fixture.titles) {
    await run(`[...document.querySelectorAll('#bauify-overview .bauify-item')].find(el => el.querySelector('b').textContent === ${JSON.stringify(title)}).click()`);
    assert.equal(await run("document.querySelector('#bauify-detail h3').textContent"), title);
  }
});
