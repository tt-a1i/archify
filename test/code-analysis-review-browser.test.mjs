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
  write('scratch.mjs', 'export const scratch = 1;\n');
  fs.mkdirSync(path.join(root, 'a.b'));
  fs.writeFileSync(path.join(root, 'a.b', 'index.mjs'), 'export const original = 1;\n');

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
  assert.equal(await run("document.querySelector('.health-primary.attention i').textContent"), '4 errors', 'both open and accepted cycles remain visible');
  assert.match(overview, /2 open · 2 accepted error-level findings/);
  assert.match(overview, /Baseline: 2 accepted/);
  assert.match(overview, /2 accepted/);
  const priorities = await run(`(() => {
    const data = JSON.parse(document.getElementById('bauify-analysis').textContent);
    return [...document.querySelectorAll('.priority-card [data-finding]')].map(row => data.findings.find(f => f.id === row.dataset.finding));
  })()`);
  assert.ok(priorities.length >= 1 && priorities.every(f => f.review?.status !== 'accepted' && [...(f.subject.files || []), ...(f.subject.modules || [])].some(name => /^[cd](?:\.mjs)?$/.test(name))), 'only the new problem is a priority');
  assert.ok(await run("document.querySelectorAll('#bauify-overview .bauify-item.accepted-error').length >= 1"), 'accepted cycles stay listed, marked, and are not faded like an accepted warning');
  assert.match(await run("document.querySelector('#bauify-overview .bauify-item.accepted-error').title"), /Accepted: legacy loader pair/);
  assert.match(await run("document.querySelector('#bauify-overview .bauify-item.accepted-error').textContent"), /accepted · still to fix/);

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
  assert.equal(await run("Boolean(document.querySelector('#bauify-overview h3 .bauify-red'))"), true, 'accepting an error unblocks CI; the overview still shows its error severity');
  assert.match(overview, /\d+ no longer detected · 0 new/);
  assert.match(overview, /does not prove a fix/);
  assert.equal(await run("document.querySelector('.health-primary.attention i').textContent"), '2 errors');
  assert.match(overview, /0 open · 2 accepted error-level findings/, 'accepted errors are not hidden by a clean open count');
  assert.equal(await run("document.querySelectorAll('#bauify-overview .bauify-item .n').length"), 0, 'accepted findings stay listed without taking open priority slots');
  assert.equal(await run("document.querySelector('#bauify-layer rect').getAttribute('class').split(' ')[0]"), 'red', 'an accepted cycle keeps its component red');
  assert.ok(fs.existsSync(path.join(out, 'analysis.previous', 'findings.json')), 'the replaced run is kept for comparison');
  assert.deepEqual(fs.readdirSync(out).filter(name => name.startsWith('analysis.next-')), [], 'no half-written run is left behind');
  if (process.env.ARCHIFY_ANALYSIS_REVIEW_AFTER_SCREENSHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(process.env.ARCHIFY_ANALYSIS_REVIEW_AFTER_SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }

  const refreshFromCurrentFocus = async () => {
    // Exercise the pointer focus hand-off in one browser turn. Hit testing is
    // covered separately against the real desktop report.
    const initialPage = await run(`(() => {
      const button = document.getElementById('analysis-refresh');
      const original = performance.timeOrigin;
      button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      return original;
    })()`);
    const finished = `performance.timeOrigin !== ${initialPage} && document.documentElement.getAttribute('data-bauify') === 'on' && !history.state`;
    try {
      await wait(`(${finished}) || document.querySelector('.analysis-refresh-status.reanalyze-error')`);
    } catch (error) {
      const state = await run(`({
        reloaded: performance.timeOrigin !== ${initialPage},
        pending: document.querySelector('#analysis-refresh')?.getAttribute('aria-busy'),
        notices: [...document.querySelectorAll('[role=status]')].map(node => node.textContent).filter(Boolean),
      })`);
      throw new Error(error.message + ': ' + JSON.stringify(state));
    }
    assert.equal(await run(finished), true, await run("document.querySelector('.analysis-refresh-status')?.textContent"));
  };

  await run("document.querySelector('g[data-node-id=app]').dispatchEvent(new MouseEvent('click',{bubbles:true})); document.querySelector('#bauify-panel .back').focus()");
  await refreshFromCurrentFocus();
  assert.match(await run("document.querySelector('#bauify-panel h3').textContent"), /^App/);
  assert.equal(await run("document.activeElement.matches('#bauify-panel .back')"), true);

  const beforeFinding = await run(`(() => {
    const finding = JSON.parse(document.getElementById('bauify-analysis').textContent).findings[0];
    window.__archifyShowFinding(finding.id);
    document.querySelector('#bauify-detail .back').focus();
    return { title: document.querySelector('#bauify-detail h3').textContent, id: finding.id };
  })()`);
  await refreshFromCurrentFocus();
  assert.equal(await run("document.querySelector('#bauify-detail .ai-task').dataset.taskId"), beforeFinding.id);
  assert.equal(await run("document.querySelector('#bauify-detail h3').textContent"), beforeFinding.title);
  assert.equal(await run("document.activeElement.matches('#bauify-detail .back')"), true);

  // The generated ID changes when a later module has the same slug. The
  // selection follows the stable grouping path instead of that generated ID.
  await run(`(() => {
    document.querySelector('.views-option[data-view=atlas]').click();
    const atlas = JSON.parse(document.getElementById('bauify-atlas-data').textContent);
    const module = atlas.modules.find(item => item.path === 'a.b');
    window.__archifyAtlas.focusModule(module.id);
  })()`);
  fs.mkdirSync(path.join(root, 'a-b'));
  fs.writeFileSync(path.join(root, 'a-b', 'index.mjs'), 'export const collision = 2;\n');
  await refreshFromCurrentFocus();
  assert.match(await run("document.querySelector('#bauify-atlas .atlas-selection').textContent"), /a\.b/, 'module selection survives an ID collision');
  assert.doesNotMatch(await run("document.querySelector('.analysis-refresh-status').textContent"), /no longer available/);
  await run("document.querySelector('.views-option[data-view=diagram]').click()");

  await run(`document.querySelector('.views-option[data-view=atlas]').click();
    document.getElementById('atlas-tab-files').click();
    const fileSearch = document.querySelector('.atlas-file-query');
    fileSearch.value = 'scratch.mjs'; fileSearch.dispatchEvent(new Event('input'));
    document.querySelector('.atlas-file-list button').click()`);
  await refreshFromCurrentFocus();
  assert.equal(await run("document.getElementById('atlas-tab-files').getAttribute('aria-selected')"), 'true');
  assert.equal(await run("document.querySelector('.atlas-file-query').value"), 'scratch.mjs');
  assert.equal(await run("document.activeElement.matches('.atlas-file-list button') && document.activeElement.textContent"), 'scratch.mjs');
  assert.equal(await run("document.activeElement.getAttribute('aria-current')"), 'true');
  fs.unlinkSync(path.join(root, 'scratch.mjs'));
  await refreshFromCurrentFocus();
  assert.equal(await run("document.querySelector('.atlas-file-query').value"), 'scratch.mjs');
  assert.equal(await run("document.activeElement.matches('.atlas-file-query')"), true);
  assert.match(await run("document.querySelector('.analysis-refresh-status').textContent"), /selection is no longer available/);
  await run("document.querySelector('.views-option[data-view=diagram]').click(); window.__archifyShowFinding(" + JSON.stringify(beforeFinding.id) + "); document.querySelector('#bauify-detail .back').click()");

  // A failing run keeps the last good result on disk and on the page.
  const before = fs.readFileSync(path.join(out, 'analysis', 'findings.json'), 'utf8');
  fs.writeFileSync(baseline, '{ "schema_version": 1, "accepted": [{ "id": "broken" }] }');
  await run("document.querySelector('#bauify-overview .bauify-reanalyze').click()");
  await wait("document.querySelector('#bauify-overview .reanalyze-error')");
  assert.match(await run("document.querySelector('#bauify-overview .reanalyze-error').textContent"), /Re-analysis failed: .*baseline.*last successful run/s);
  assert.equal(await run("document.querySelector('#bauify-overview .bauify-reanalyze').disabled"), false, 'the reader can retry');
  assert.equal(fs.readFileSync(path.join(out, 'analysis', 'findings.json'), 'utf8'), before);
});
