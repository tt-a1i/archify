import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { startAnalysisView } from '../archify/modules/code-analysis/bin/serve.mjs';

const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Code Analysis presents Java cycles as structural dependencies in the browser', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run Code Analysis browser coverage.',
}, async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-java-browser-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'repo');
  for (const name of ['a', 'b']) fs.mkdirSync(path.join(root, name), { recursive: true });
  fs.writeFileSync(path.join(root, 'a/A.java'), 'package a; import b.B; class A { B b; b.Gone gone; }');
  fs.writeFileSync(path.join(root, 'b/B.java'), 'package b; import a.A; class B { A a; }');
  const ir = path.join(scratch, 'input.json');
  fs.writeFileSync(ir, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'Java dependency cycle', output: 'architecture.html' },
    components: [{ id: 'app', type: 'backend', label: 'Java app', pos: [40, 40], size: [180, 64] }], connections: [] }));
  const map = path.join(scratch, 'map.json');
  fs.writeFileSync(map, JSON.stringify({ app: ['a', 'b'] }));
  const view = await startAnalysisView([root, '--ir', ir, '--map', map, '--out', path.join(scratch, 'view'), '--language', 'java']);
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
    if (document.documentElement.getAttribute('data-bauify') === 'on') return resolve(true);
    if (Date.now() > deadline) return reject(new Error('Java analysis did not open'));
    setTimeout(poll, 25);
  }; poll(); })`);
  assert.match(await run("document.querySelector('details.coverage summary').textContent"), /^Coverage · Java · 2 files/);
  // Java counts unresolved type references too, so the page does not call them imports.
  const coverage = await run("document.querySelector('details.coverage').textContent");
  assert.match(coverage, /1 dependency record could not be resolved/);
  assert.doesNotMatch(coverage, /imports? could not be resolved/);
  for (const title of ['Module cycle', 'Import cycle']) {
    await run(`[...document.querySelectorAll('#bauify-overview .bauify-item')].find(el => el.querySelector('b').textContent.startsWith(${JSON.stringify(title)})).click()`);
    await run(`new Promise((resolve, reject) => { const deadline = Date.now() + 5000; const poll = () => {
      if (document.querySelector('#bauify-detail h3')?.textContent.startsWith(${JSON.stringify(title)})) return resolve();
      if (Date.now() > deadline) return reject(new Error('Cycle detail did not open'));
      setTimeout(poll, 25);
    }; poll(); })`);
    const detail = await run("document.getElementById('bauify-detail').textContent");
    assert.match(detail, /structural (Java )?dependency cycle/);
    assert.doesNotMatch(detail, /partially initialized|module-scope import|deferred or conditional imports|\bundefined\b/);
    if (title === 'Import cycle') {
      assert.match(detail, /import risk: not-assessed/);
      const risk = await run("[...document.querySelectorAll('#bauify-detail .ev')].find(el => el.textContent.startsWith('import risk:')).textContent");
      assert.match(risk, /initialization.*not assessed/i);
    }
  }
});

test('Code Analysis refuses changed IR and preserves captured source in the current Viewer', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run Code Analysis browser coverage.',
}, async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-analysis-browser-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'repo');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'a.mjs'), "import './b.mjs';\n\n");
  // Source text that opens an HTML script-data escape must not break the embedded analysis JSON.
  fs.writeFileSync(path.join(root, 'b.mjs'), "import './a.mjs';\nexport const markup = '<!--<script>';\n");
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  git('add', '.'); git('commit', '-qm', 'Browser fixture');
  fs.writeFileSync(path.join(root, 'a.mjs'), "import './b.mjs';\n// Saved but not committed.\n");
  const ir = path.join(scratch, 'input.json');
  const original = JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'Analysis browser regression', output: 'architecture.html' }, components: [{ id: 'app', type: 'backend', label: 'App', pos: [40, 40], size: [170, 64] }], connections: [] });
  fs.writeFileSync(ir, original);
  const map = path.join(scratch, 'map.json');
  fs.writeFileSync(map, JSON.stringify({ app: ['a', 'b'] }));
  const view = await startAnalysisView([root, '--ir', ir, '--map', map, '--out', path.join(scratch, 'view'), '--language', 'ts']);
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
  const wait = expression => run(`new Promise((resolve, reject) => { const start = Date.now(); const poll = () => { if (${expression}) return resolve(true); if (Date.now() - start > 10000) return reject(new Error('Timed out waiting for UI')); setTimeout(poll, 25); }; poll(); })`);
  const load = async () => {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: view.url });
    await loaded;
    await run('document.fonts.ready');
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await load();
  fs.writeFileSync(ir, original.replace('"app"', '"after"'));
  await run("document.getElementById('code-analysis-start').click()");
  await wait("document.getElementById('code-analysis-note').textContent.includes('Architecture has changed.')");
  assert.equal(await run("document.getElementById('code-analysis-note').textContent"), 'Architecture has changed. Please regenerate the diagram.');
  const aligned = `(() => { const button = document.getElementById('code-analysis-start').getBoundingClientRect(); const note = document.getElementById('code-analysis-note').getBoundingClientRect(); return Math.abs(note.top - button.bottom - 8) < 1 && Math.abs(note.right - button.right) < 1 && note.left >= 8 && note.right <= innerWidth - 8; })()`;
  assert.equal(await run(aligned), true, 'the notification sits directly below the button, right-aligned');
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await wait(aligned);
  if (process.env.ARCHIFY_ANALYSIS_NOTICE_SCREENSHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(process.env.ARCHIFY_ANALYSIS_NOTICE_SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  assert.equal(await run("document.getElementById('code-analysis-start').disabled"), true);
  assert.equal(await run("document.getElementById('bauify-analysis') === null"), true);
  assert.equal(fs.existsSync(path.join(scratch, 'view/analysis/raw-facts.json')), false);
  fs.writeFileSync(ir, original);
  await load();
  await run("document.getElementById('code-analysis-start').click()");
  await wait("document.documentElement.getAttribute('data-bauify') === 'on'");
  // The left column opens on the project overview, not on a component.
  assert.equal(await run("document.getElementById('bauify-overview').hidden"), false);
  assert.equal(await run("document.getElementById('bauify-panel').hidden"), true);
  assert.equal(await run("document.querySelectorAll('#bauify-reader > section').length"), 4);
  assert.equal(await run("document.querySelectorAll('#bauify-reader > section').length === [...document.querySelectorAll('#bauify-overview,#bauify-panel,#bauify-detail,#bauify-code')].filter(e => e.parentElement.id === 'bauify-reader').length"), true);
  assert.equal(await run("document.querySelector('.diagram-container').getBoundingClientRect().left > document.getElementById('bauify-reader').getBoundingClientRect().right"), true, 'desktop canvas reserves the reading column');
  assert.match(await run("document.querySelector('#bauify-overview h3').textContent"), /Needs attention/);
  assert.match(await run("document.getElementById('bauify-overview').textContent"), /Checked: import cycles, module cycles, hub modules/);
  // a.mjs <-> b.mjs is both a file cycle and a module cycle: one structure, one priority slot.
  assert.equal(await run("document.querySelectorAll('#bauify-overview .bauify-item .n').length"), 1);
  await run("document.querySelector('#bauify-overview .bauify-item').click()");
  assert.equal(await run("document.getElementById('bauify-detail').hidden"), false);
  // A source view must cover the detail on narrow screens, not remain a
  // 300px strip because a later base CSS rule overrides its media query.
  await run("document.querySelector('#bauify-detail .source-file, #bauify-detail .ref').click()");
  await send('Emulation.setDeviceMetricsOverride', { width: 750, height: 900, deviceScaleFactor: 1, mobile: false });
  assert.equal(await run("document.getElementById('bauify-code').hidden"), false);
  assert.equal(await run("document.getElementById('bauify-code').getBoundingClientRect().width === document.getElementById('bauify-reader').clientWidth"), true);
  assert.equal(await run("getComputedStyle(document.getElementById('bauify-detail')).display"), 'none');
  assert.equal(await run("getComputedStyle(document.getElementById('bauify-reader')).zIndex"), '62');
  await wait("document.getElementById('bauify-reader').getBoundingClientRect().top >= document.querySelector('.header').getBoundingClientRect().bottom + 11");
  assert.match(await run("getComputedStyle(document.getElementById('bauify-reader')).backgroundImage"), /linear-gradient/);
  await run("document.getElementById('btn-theme').click()");
  assert.match(await run("getComputedStyle(document.getElementById('bauify-reader')).backgroundColor"), /^rgb\(/, 'the reader has an opaque base in both themes');
  await run("document.getElementById('btn-theme').click()");
  await run("document.querySelector('#bauify-code .close').click()");
  assert.notEqual(await run("getComputedStyle(document.getElementById('bauify-detail')).display"), 'none');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  assert.match(await run("document.querySelector('#bauify-detail h3').textContent"), /Import cycle · 2 files/);
  assert.match(await run("document.getElementById('bauify-detail').textContent"), /Same structure, also reported as/);
  assert.equal(await run("document.querySelector('g[data-node-id=app]').classList.contains('bauify-focus')"), true);
  if (process.env.ARCHIFY_ANALYSIS_OVERVIEW_SCREENSHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(process.env.ARCHIFY_ANALYSIS_OVERVIEW_SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }
  // Narrow window: the detail panel covers the overview instead of colliding with it.
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  assert.equal(await run("document.getElementById('bauify-detail').getBoundingClientRect().left > document.getElementById('bauify-reader').getBoundingClientRect().left"), true);
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await run("document.querySelector('#bauify-detail .close').click()");
  assert.equal(await run("document.documentElement.hasAttribute('data-bauify-focus')"), false);
  await run("document.querySelector('#bauify-reader .reader-toggle').click()");
  assert.equal(await run("document.getElementById('bauify-reader').classList.contains('collapsed')"), true);
  await run("document.querySelector('#bauify-reader .reader-toggle').click()");
  assert.equal(await run("document.getElementById('bauify-reader').classList.contains('collapsed')"), false);
  fs.writeFileSync(path.join(root, 'a.mjs'), '// edited after extraction\n');
  await run("document.querySelector('g[data-node-id=app]').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  assert.match(await run("document.getElementById('bauify-panel').textContent"), /Working tree/);
  await run("document.querySelector('#bauify-panel .ind.link').click()");
  assert.equal(await run("document.getElementById('bauify-detail').hidden"), false);
  await run("document.querySelector('#bauify-detail [data-file=\"a.mjs\"]').click()");
  assert.equal(await run("document.getElementById('bauify-code').hidden"), false);
  assert.match(await run("document.getElementById('bauify-code').textContent"), /import/);
  assert.doesNotMatch(await run("document.getElementById('bauify-code').textContent"), /edited after extraction/);
  assert.match(await run("document.querySelector('#bauify-code .diff-added').textContent"), /Saved but not committed/);
  assert.match(await run("document.querySelector('#bauify-code .diff-legend').textContent"), /Captured changes vs base commit/);
  assert.equal(await run("getComputedStyle(document.querySelector('#bauify-code .diff-added')).borderLeftWidth"), '3px');
  assert.match(await run("JSON.parse(document.getElementById('bauify-analysis').textContent).snippets['b.mjs'].lines.join('\\n')"), /<!--<script>/);
  if (process.env.ARCHIFY_ANALYSIS_SCREENSHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(process.env.ARCHIFY_ANALYSIS_SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }
  assert.equal(await run("document.getElementById('bauify-overview').hidden"), true, 'a component panel replaces the overview');
  await run("document.querySelector('#bauify-code .source-back').click()");
  await run("document.querySelector('#bauify-detail .back').click()");
  await run("document.querySelector('#bauify-panel .back').click()");
  assert.equal(await run("document.getElementById('bauify-overview').hidden"), false);
  assert.equal(await run("document.getElementById('bauify-panel').hidden"), true);
  assert.equal(await run("document.getElementById('bauify-code').hidden"), true);
  const key = init => run(`document.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ bubbles: true, ...init })}))`);
  await key({ key: 'c', ctrlKey: true });
  await key({ key: 'c', metaKey: true });
  assert.equal(await run("document.documentElement.getAttribute('data-bauify')"), 'on', 'copy shortcuts do not toggle the layer');
  assert.equal(await run("document.getElementById('bauify-overview').hidden"), false);
  await key({ key: 'c' });
  assert.equal(await run("document.documentElement.getAttribute('data-bauify')"), 'off');
  await key({ key: 'C' });
  assert.equal(await run("document.documentElement.getAttribute('data-bauify')"), 'on');
  await run("document.getElementById('btn-bauify').click()");
  assert.equal(await run("document.documentElement.getAttribute('data-bauify')"), 'off');
  assert.equal(await run("document.getElementById('bauify-overview').hidden"), true);
});
