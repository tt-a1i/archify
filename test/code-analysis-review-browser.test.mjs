import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { startAnalysisView } from '../archify/modules/code-analysis/bin/serve.mjs';
import { runCheck } from '../archify/modules/code-analysis/bin/check.mjs';

const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
test('Code Analysis marks baseline findings, re-analyzes without a restart, and keeps the last good result on failure', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run Code Analysis browser coverage.',
}, async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-review-browser-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'repo');
  fs.mkdirSync(root);
  const write = (file, text) => fs.writeFileSync(path.join(root, file), text);
  write('a.mjs', "import './b.mjs';\n");
  write('b.mjs', "import './a.mjs';\n");
  // The a <-> b cycle is known and accepted before the page is opened.
  const baseline = path.join(scratch, 'baseline.json');
  const written = await runCheck([root, '--language', 'ts', '--baseline', baseline, '--update-baseline', '--reason', 'legacy loader pair']);
  assert.equal(written.exitCode, 0);
  // Then a new cycle appears.
  write('c.mjs', "import './d.mjs';\n");
  write('d.mjs', "import './c.mjs';\n");

  const ir = path.join(scratch, 'input.json');
  fs.writeFileSync(ir, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'Review browser regression', output: 'architecture.html' },
    components: [{ id: 'app', type: 'backend', label: 'App', pos: [40, 40], size: [170, 64] }], connections: [] }));
  const map = path.join(scratch, 'map.json');
  fs.writeFileSync(map, JSON.stringify({ app: ['a', 'b', 'c', 'd'] }));
  const out = path.join(scratch, 'view');
  const view = await startAnalysisView([root, '--ir', ir, '--map', map, '--baseline', baseline, '--out', out, '--language', 'ts']);
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
      try { if (await run(`Boolean(${expression})`)) return; } catch { /* page reloading */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: view.url });
  await loaded;
  await run("document.getElementById('code-analysis-start').click()");
  await wait("document.documentElement.getAttribute('data-bauify') === 'on'");

  let overview = await run("document.getElementById('bauify-overview').innerText");
  assert.match(overview, /Structural problems to fix/, 'the new cycle is open');
  assert.match(overview, /Baseline: 2 accepted/);
  assert.match(overview, /2 accepted/);
  const priorities = await run("[...document.querySelectorAll('#bauify-overview .bauify-item')].filter(b => b.querySelector('.n')).map(b => b.textContent)");
  assert.ok(priorities.length >= 1 && priorities.every(p => /c\.mjs|d\.mjs|Module cycle/.test(p) && !/accepted/.test(p)), `only the new problem is a priority: ${priorities}`);
  assert.ok(await run("document.querySelectorAll('#bauify-overview .bauify-item.accepted-error').length >= 1"), 'accepted cycles stay listed, marked, and are not faded like an accepted warning');
  assert.match(await run("document.querySelector('#bauify-overview .bauify-item.accepted-error').title"), /Accepted: legacy loader pair/);
  assert.match(await run("document.querySelector('#bauify-overview .bauify-item.accepted-error').textContent"), /accepted · still to fix/);

  // Filtering should narrow the visible findings and leave the underlying review intact.
  await run("const input = document.querySelector('#bauify-overview .finding-search'); input.value = 'no-such-finding'; input.dispatchEvent(new Event('input', { bubbles: true }))");
  assert.match(await run("document.getElementById('bauify-overview').innerText"), /No findings match these filters/);
  await run("document.querySelector('#bauify-overview .finding-clear').click()");
  assert.ok(await run("document.querySelectorAll('#bauify-overview .bauify-item.accepted-error').length >= 1"), 'clearing filters restores accepted findings');

  if (process.env.ARCHIFY_ANALYSIS_REVIEW_SCREENSHOT) {
    await run("document.querySelectorAll('#bauify-overview details').forEach(d => { d.open = /Import cycles|Module cycles/.test(d.textContent); })");
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(process.env.ARCHIFY_ANALYSIS_REVIEW_SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }

  // Fix the new cycle and re-analyze without restarting the server.
  write('d.mjs', 'export const d = 1;\n');
  await run("document.querySelector('#bauify-overview .bauify-reanalyze').click()");
  await wait("location.search === '' && document.documentElement.getAttribute('data-bauify') === 'on' && /no longer detected/.test(document.getElementById('bauify-overview').innerText)");
  overview = await run("document.getElementById('bauify-overview').innerText");
  assert.match(overview, /Accepted structural problems still present/, 'accepting a cycle unblocks CI; it does not turn the page green');
  assert.match(overview, /Since the previous analysis: 0 new · \d+ no longer detected/);
  assert.match(overview, /2 findings · 2 accepted\n/, 'counts read cleanly when nothing is open');
  assert.match(overview, /Every finding is accepted in the baseline, including 2 circular dependency findings that are still in the code and stay red/);
  assert.equal(await run("document.querySelector('#bauify-layer rect').getAttribute('class').split(' ')[0]"), 'red', 'an accepted cycle keeps its component red');
  assert.ok(fs.existsSync(path.join(out, 'analysis.previous', 'findings.json')), 'the replaced run is kept for comparison');
  assert.deepEqual(fs.readdirSync(out).filter(name => name.startsWith('analysis.next-')), [], 'no half-written run is left behind');
  if (process.env.ARCHIFY_ANALYSIS_REVIEW_AFTER_SCREENSHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(process.env.ARCHIFY_ANALYSIS_REVIEW_AFTER_SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }

  // A failing run keeps the last good result on disk and on the page.
  const before = fs.readFileSync(path.join(out, 'analysis', 'findings.json'), 'utf8');
  fs.writeFileSync(baseline, '{ "schema_version": 1, "accepted": [{ "id": "broken" }] }');
  await run("document.querySelector('#bauify-overview .bauify-reanalyze').click()");
  await wait("document.querySelector('#bauify-overview .reanalyze-error')");
  assert.match(await run("document.querySelector('#bauify-overview .reanalyze-error').textContent"), /Re-analysis failed: .*baseline.*last successful run/s);
  assert.equal(await run("document.querySelector('#bauify-overview .bauify-reanalyze').disabled"), false, 'the reader can retry');
  assert.equal(fs.readFileSync(path.join(out, 'analysis', 'findings.json'), 'utf8'), before);
});

test('imported findings can be filtered by rule, severity, source and status', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run Code Analysis browser coverage.',
}, async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-external-filter-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'repo');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'a.mjs'), 'export const value = 1;\n');
  const report = path.join(scratch, 'report.sarif');
  const result = (ruleId, level, text) => ({ ruleId, level, message: { text }, locations: [{ physicalLocation: { artifactLocation: { uri: 'a.mjs' }, region: { startLine: 1 } } }] });
  const run = (name, results) => ({ tool: { driver: { name, version: '1' } }, results });
  fs.writeFileSync(report, JSON.stringify({ version: '2.1.0', runs: [run('eslint', [result('no-alert', 'error', 'Accepted external alert')])] }));
  const baseline = path.join(scratch, 'baseline.json');
  const accepted = await runCheck([root, '--language', 'ts', '--sarif', report, '--baseline', baseline, '--update-baseline', '--reason', 'known issue']);
  assert.equal(accepted.exitCode, 0);
  fs.writeFileSync(report, JSON.stringify({ version: '2.1.0', runs: [run('eslint', [result('no-alert', 'error', 'Accepted external alert')]), run('ruff', [result('F401', 'warning', 'Open external warning')])] }));
  const ir = path.join(scratch, 'input.json');
  fs.writeFileSync(ir, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'External filters', output: 'architecture.html' }, components: [{ id: 'app', type: 'backend', label: 'App', pos: [40, 40], size: [170, 64] }], connections: [] }));
  const view = await startAnalysisView([root, '--ir', ir, '--baseline', baseline, '--out', path.join(scratch, 'view'), '--language', 'ts', '--sarif', report]);
  t.after(() => new Promise(resolve => { view.server.close(resolve); view.server.closeAllConnections?.(); }));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const evaluate = async expression => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(response.exceptionDetails, undefined, response.exceptionDetails?.exception?.description);
    return response.result?.value;
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 950, deviceScaleFactor: 1, mobile: false });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: view.url });
  await loaded;
  await evaluate("document.getElementById('code-analysis-start').click()");
  for (let i = 0; i < 600 && !(await evaluate("document.documentElement.getAttribute('data-bauify') === 'on'")); i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(await evaluate("document.documentElement.getAttribute('data-bauify')"), 'on');
  const choose = async (filter, value) => {
    await evaluate(`(() => { const el = document.querySelector('#bauify-overview .finding-${filter}'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    return evaluate("document.querySelector('#bauify-overview .counts').innerText");
  };
  assert.match(await choose('rule', 'external/eslint'), /1 finding shown/);
  assert.match(await choose('severity', 'info'), /0 findings shown/);
  await choose('severity', 'warning');
  await choose('rule', '');
  assert.match(await choose('source', 'ruff'), /1 finding shown/);
  assert.match(await choose('status', 'accepted'), /0 findings shown/);
  await choose('source', 'eslint');
  await choose('severity', 'warning');
  assert.match(await choose('status', 'accepted'), /1 finding shown/);
  await evaluate("document.querySelector('#bauify-overview .finding-clear').click()");
  assert.match(await evaluate("document.querySelector('#bauify-overview .counts').innerText"), /2 findings/);
});
