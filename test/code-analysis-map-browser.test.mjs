import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { buildOverlay } from '../archify/modules/code-analysis/overlay/inject.mjs';
import { startAnalysisView } from '../archify/modules/code-analysis/bin/serve.mjs';

const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Map shares module selection and copies checked multi-finding tasks with an explicit offline fallback', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for Map browser acceptance.', timeout: 90000,
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-map-browser-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'repo');
  for (const name of ['alpha', 'beta', 'gamma']) fs.mkdirSync(path.join(root, 'packages', name, 'src'), { recursive: true });
  for (const [name, next] of [['alpha', 'beta'], ['beta', 'gamma'], ['gamma', 'alpha']]) {
    fs.writeFileSync(path.join(root, 'packages', name, 'package.json'), JSON.stringify({ name }));
    fs.writeFileSync(path.join(root, 'packages', name, 'src/index.ts'), `import { f as dep } from '../../${next}/src/index';\nexport function f(x = true) { return x ? dep(false) : 1; }\n`);
  }
  const out = path.join(dir, 'view');
  const ir = path.join(dir, 'architecture.json');
  fs.writeFileSync(ir, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'Map handoff', output: 'architecture.html' }, components: [{ id: 'app', label: 'Application', type: 'backend', pos: [40, 40], size: [180, 70] }], connections: [] }));
  const view = await startAnalysisView([root, '--ir', ir, '--out', out, '--language', 'ts']);
  const sockets = new Set();
  view.server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  t.after(() => new Promise(resolve => { view.server.close(resolve); for (const socket of sockets) socket.destroy(); }));
  const browser = new ChromeVisualBrowser(chrome); t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  };
  const wait = async expression => {
    const end = Date.now() + 20000;
    while (Date.now() < end) { if (await run(`Boolean(${expression})`)) return; await new Promise(r => setTimeout(r, 30)); }
    throw Error('Timed out: ' + expression);
  };
  const navigate = async url => { const loaded = browser.cdp.waitFor('Page.loadEventFired', session); await send('Page.navigate', { url }); await loaded; };
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(view.url);
  await run("document.getElementById('code-analysis-start').click()");
  await wait("window.__archifyMapViews && document.querySelector('.browse-findings')");
  await run("window.__errors=[];addEventListener('error',e=>window.__errors.push(e.message));Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__copied=text}});window.__requests=[];var origFetch=fetch;window.fetch=function(url,opts){if(url==='/task')window.__requests.push(JSON.parse(opts.body));return origFetch.apply(this,arguments)};");
  const moduleId = await run("JSON.parse(document.getElementById('bauify-map-data').textContent).modules[0].id");
  await run("window.__archifyMapViews.open('graph');document.getElementById('btn-bauify').click();document.getElementById('btn-bauify').click()");
  await wait("!document.getElementById('bauify-map-views').hidden");
  await run(`window.__archifyMapViews.select({moduleId:${JSON.stringify(moduleId)},findingId:null});window.__archifySelectModuleFindings(${JSON.stringify(moduleId)})`);
  assert.ok(await run("document.querySelectorAll('[data-select-finding]:checked').length") >= 2);
  assert.equal(await run("getComputedStyle(document.getElementById('bauify-reader')).display !== 'none'"), true, 'module tasks return to visible evidence');
  await run("document.querySelector('.batch-copy').click()"); await wait('window.__copied');
  const live = await run('({text:window.__copied,requests:window.__requests})');
  assert.ok(live.requests[0].ids.length >= 2);
  assert.deepEqual(Object.keys(live.requests[0].expected).sort(), [...live.requests[0].ids].sort());
  assert.match(live.text, /Evidence.*Valid/i);
  assert.match(live.text, /index\.ts:1/);
  assert.match(live.text, /Static dependency boundary/);
  const counts = fs.statSync(path.join(out, 'analysis/raw-facts.json')).mtimeMs;
  for (const name of ['graph', 'layers', 'butterfly', 'atlas']) {
    await run(`window.__archifyMapViews.open(${JSON.stringify(name)})`);
    assert.equal(await run('window.__archifyMapViews.selection().moduleId'), moduleId);
  }
  assert.deepEqual(await run('window.__errors'), []);
  assert.equal(fs.statSync(path.join(out, 'analysis/raw-facts.json')).mtimeMs, counts, 'view changes never rescan sources');
  await navigate(pathToFileURL(path.join(out, 'analysis/repo.analysis.html')).href);
  await wait('window.__archifyMapViews');
  await run(`Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__copied=text}});window.__archifySelectModuleFindings(${JSON.stringify(moduleId)});document.querySelector('.batch-copy').click()`);
  await wait('window.__copied');
  const offline = await run('window.__copied');
  assert.match(offline, /Current source has not been rechecked/);
  assert.match(offline, /--require-valid --finding /);
  assert.match(offline, /code-analysis task /);
  assert.match(offline, /code-analysis check /);
  assert.match(offline, /analysis\.recheck/);
  const command = offline.match(/```sh\n([^`]+)\n```/)[1];
  const checked = spawnSync(process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/sh', process.platform === 'win32' ? ['/d', '/s', '/c', command] : ['-c', command], { encoding: 'utf8' });
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  assert.equal(JSON.parse(checked.stdout).evidence.status, 'valid');
  const recheckCommand = Array.from(offline.matchAll(/```sh\n([^`]+)\n```/g)).at(-1)[1];
  const beforeFindings = fs.readFileSync(path.join(out, 'analysis/findings.json'));
  const rechecked = spawnSync(process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/sh', process.platform === 'win32' ? ['/d', '/s', '/c', recheckCommand] : ['-c', recheckCommand], { encoding: 'utf8' });
  assert.equal(rechecked.status, 1, 'the unchanged cycle still fails the analysis gate: ' + rechecked.stdout + rechecked.stderr);
  assert.ok(fs.existsSync(path.join(out, 'analysis.recheck/findings.json')));
  assert.deepEqual(fs.readFileSync(path.join(out, 'analysis/findings.json')), beforeFindings, 'rechecking preserves the compared snapshot');
  assert.match(offline, /index\.ts:1/);
  // An HTTP rejection is a stale/invalid claim, not permission to export a snapshot.
  await run("window.__copied=null;window.__archifyBuildTask=async()=>{var error=Error('displayed finding changed');error.status=409;throw error};document.querySelector('.batch-copy').click()");
  await wait("document.querySelector('.batch-status').textContent.includes('displayed finding changed')");
  assert.equal(await run('window.__copied'), null);
  await run("window.__archifyBuildTask=undefined;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}});document.querySelector('.batch-copy').click()");
  await wait("document.querySelector('.batch-preview').open");
  assert.match(await run("document.querySelector('.batch-preview textarea').value"), /--require-valid/);
  const captured = name => JSON.parse(fs.readFileSync(path.join(out, 'analysis', name), 'utf8'));
  const graph = captured('module-graph.json'), facts = captured('raw-facts.json'), findings = captured('findings.json');
  for (const locale of ['en', 'zh-CN']) {
    const report = path.join(dir, locale + '.html');
    fs.writeFileSync(report, buildOverlay({ graph, facts, findings: findings.diagnostics, findingsDocument: findings, sourceRoot: root, run: { locale } }).html);
    await navigate(pathToFileURL(report).href);
    assert.equal(await run("document.querySelector('[data-view=graph]').textContent"), locale === 'en' ? 'Graph' : '依赖图谱');
    await run("window.__errors=[];addEventListener('error',e=>window.__errors.push(e.message))");
    for (const theme of ['light', 'dark']) for (const width of [1440, 390]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      for (const name of ['graph', 'layers', 'butterfly', 'atlas']) {
        await run(`document.documentElement.setAttribute('data-theme',${JSON.stringify(theme)});window.__archifyMapViews.open(${JSON.stringify(name)})`);
        await run('new Promise(requestAnimationFrame)');
        assert.equal(await run('document.documentElement.scrollWidth > innerWidth'), false, locale + theme + width + name);
      }
    }
    await run(`window.__archifyMapViews.select({moduleId:${JSON.stringify(moduleId)}});window.__archifyMapViews.open('graph');document.querySelector('.map-expand').click()`);
    assert.equal(await run("document.querySelector('.map-side')"), null);
    assert.equal(await run("!!document.querySelector('.map-back')"), true);
    await run("document.querySelector('.map-back').click()");
    assert.equal(await run("!!document.querySelector('.map-back')"), false);
    await run("window.__archifyMapViews.open('layers')");
    assert.ok(await run("document.querySelectorAll('.map-layers-svg [data-module]').length") >= 3);
    assert.ok(await run("document.querySelectorAll('.map-layers-svg .svg-edge').length") >= 2);
    await run("window.__archifyMapViews.open('butterfly')");
    assert.ok(await run("document.querySelectorAll('.map-butterfly-svg .ribbon-path').length") >= 1);
    const nextModule = await run("document.querySelector('.map-butterfly-svg .ribbon-path').getAttribute('data-module')");
    await run("document.querySelector('.map-butterfly-svg .ribbon-path').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
    assert.equal(await run('window.__archifyMapViews.selection().moduleId'), nextModule);
    assert.deepEqual(await run('window.__errors'), []);
  }
  const noFacts = path.join(dir, 'graph-only.html');
  fs.writeFileSync(noFacts, buildOverlay({ graph, findings: findings.diagnostics, run: { locale: 'en' } }).html);
  await navigate(pathToFileURL(noFacts).href);
  assert.equal(await run("!!document.querySelector('[data-view=atlas]')"), false);
  assert.equal(await run("!!document.querySelector('.map-expand')"), false);
  for (const name of ['layers', 'butterfly', 'graph']) await run(`window.__archifyMapViews.open(${JSON.stringify(name)})`);

});
