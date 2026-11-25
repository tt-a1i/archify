import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { startAnalysisView } from '../archify/modules/code-analysis/bin/serve.mjs';
import { runCheck } from '../archify/modules/code-analysis/bin/check.mjs';

const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
test('Java root build module survives an earlier-sorting source after re-analysis', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run Code Analysis browser coverage.',
}, async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-java-root-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'repo');
  for (const dir of ['src/main/java/app', 'nested/src/main/java/app']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  for (const file of ['pom.xml', 'nested/pom.xml']) fs.writeFileSync(path.join(root, file), '<project/>');
  fs.writeFileSync(path.join(root, 'src/main/java/app/Core.java'), 'package app; class Core {}\n');
  fs.writeFileSync(path.join(root, 'nested/src/main/java/app/Other.java'), 'package app; class Other {}\n');
  const ir = path.join(scratch, 'input.json');
  fs.writeFileSync(ir, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'Java root', output: 'architecture.html' }, components: [{ id: 'app', type: 'backend', label: 'App', pos: [40, 40], size: [170, 64] }], connections: [] }));
  const view = await startAnalysisView([root, '--ir', ir, '--out', path.join(scratch, 'view'), '--language', 'java']);
  const sockets = new Set();
  view.server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  t.after(() => new Promise(resolve => { view.server.close(resolve); for (const socket of sockets) socket.destroy(); }));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async expression => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); assert.equal(r.exceptionDetails, undefined, r.exceptionDetails?.exception?.description); return r.result?.value; };
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: view.url }); await loaded;
  await run("document.getElementById('code-analysis-start').click()");
  const readyBy = Date.now() + 60000;
  while (Date.now() < readyBy) {
    try { if (await run("Boolean(document.getElementById('bauify-analysis'))")) break; } catch { /* navigation */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const module = await run(`(() => { const data = JSON.parse(document.getElementById('bauify-analysis').textContent); return data.unmapped.find(m => m.path === '' && m.label === '(root)'); })()`);
  assert.ok(module, 'the root build module is present and is not mapped to the diagram');
  await run(`window.__archifyRestoreReading({ reading: { kind: 'off', id: ${JSON.stringify(module.id)}, path: '', rootFile: null }, open: true })`);
  assert.match(await run("document.querySelector('#bauify-panel h3').textContent"), /\(root\)/);
  fs.writeFileSync(path.join(root, 'src/main/java/app/Alpha.java'), 'package app; class Alpha {}\n');
  const before = await run("performance.timeOrigin");
  await run("document.getElementById('analysis-refresh').click()");
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try { if (await run(`performance.timeOrigin !== ${before} && !history.state`)) break; } catch { /* navigation */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.notEqual(await run('performance.timeOrigin'), before, 'the updated Java analysis loaded');
  assert.equal(await run("document.getElementById('bauify-panel').hidden"), false);
  assert.match(await run("document.querySelector('#bauify-panel h3').textContent"), /\(root\)/);
});
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
  write('b2.mjs', 'export const replacement = 2;\n');
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
    components: [{ id: 'app', type: 'backend', label: 'App', pos: [40, 40], size: [170, 64] }, { id: 'storage', type: 'backend', label: 'Storage', pos: [300, 40], size: [170, 64] }], connections: [] }));
  const map = path.join(scratch, 'map.json');
  fs.writeFileSync(map, JSON.stringify({ app: ['a', 'c', 'd'], storage: ['b', 'b2'] }));
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

  let toolbarClicks = 0;
  const refreshFromCurrentFocus = async () => {
    const { initialPage, x, y, hit } = await run(`(() => {
      const button = document.getElementById('analysis-refresh');
      button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const box = button.getBoundingClientRect();
      const x = box.left + box.width / 2, y = box.top + box.height / 2;
      return { initialPage: performance.timeOrigin, x, y, hit: !document.documentElement.hasAttribute('data-bauify-views') && button.contains(document.elementFromPoint(x, y)) };
    })()`);
    if (hit) {
      toolbarClicks += 1;
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    } else {
      // Atlas is modal and covers the toolbar: exercise state hand-off directly.
      await run("document.getElementById('analysis-refresh').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); document.getElementById('analysis-refresh').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))");
    }
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
  await run("window.__archifyRestoreReading({ reading: { kind: 'indicator', id: 'app', key: 'missing-indicator' }, open: true })");
  assert.match(await run("document.querySelector('#bauify-panel h3').textContent"), /^App/, 'a removed indicator falls back to its component');
  assert.equal(await run("document.getElementById('bauify-panel').hidden"), false, 'the fallback component is visible');
  assert.match(await run("document.querySelector('.analysis-refresh-status').textContent"), /selection is no longer available/);

  const indicatorTitle = await run("document.querySelector('#bauify-panel .ind.link').click(); document.querySelector('#bauify-detail h3').textContent");
  await refreshFromCurrentFocus();
  assert.equal(await run("document.querySelector('#bauify-detail h3').textContent"), indicatorTitle, 'the selected indicator survives re-analysis');
  await run("document.querySelector('#bauify-detail .back').click()");

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

  const sourceRef = await run(`(() => {
    const ref = document.querySelector('#bauify-detail .ref[data-file]');
    if (!ref) return null;
    const result = [ref.getAttribute('data-file'), ref.getAttribute('data-line')];
    ref.click(); return result;
  })()`);
  assert.ok(sourceRef, 'the finding offers a captured source reference');
  await refreshFromCurrentFocus();
  assert.equal(await run("document.getElementById('bauify-code').hidden"), false, 'the same source remains open after re-analysis');
  assert.ok((await run("document.getElementById('bauify-code').textContent")).includes(sourceRef[0]));
  await run("document.querySelector('#bauify-code .source-back').click()");

  await run("document.querySelector('#bauify-detail .back').click(); document.querySelector('.browse-findings').click(); const input = document.querySelector('#finding-search'); input.value = 'cycle'; input.dispatchEvent(new Event('input', { bubbles: true }));");
  await refreshFromCurrentFocus();
  assert.equal(await run("document.querySelector('#finding-search').value"), 'cycle', 'finding search survives re-analysis');
  assert.equal(await run("document.querySelector('#bauify-overview h3').textContent"), 'Findings');
  await run("document.querySelector('.findings-back').click()");

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
  await run("window.__archifyRestoreReading({ reading: { kind: 'off', id: 'obsolete-id', path: 'a.b', rootFile: null }, open: true })");
  assert.equal(await run("document.getElementById('bauify-panel').hidden"), false, 'an off-diagram module is located by path after IDs change');
  assert.match(await run("document.querySelector('#bauify-panel h3').textContent"), /a\.b/);

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
  await run("document.querySelector('.views-option[data-view=diagram]').click(); window.__archifyShowFinding(" + JSON.stringify(beforeFinding.id) + "); document.querySelector('#bauify-detail .ref[data-file]').click()");

  await run("document.querySelector('g[data-node-id=app]').dispatchEvent(new MouseEvent('click',{bubbles:true})); document.querySelector('#bauify-panel .fly-rel[data-edge=\\\"app>storage\\\"]').click(); document.querySelector('#bauify-panel .fly-ev').click()");
  await refreshFromCurrentFocus();
  assert.equal(await run("document.getElementById('bauify-code').hidden"), false, 'dependency source remains open even when a previous finding link is still marked active');
  write('a.mjs', "import './b2.mjs';\n");
  await refreshFromCurrentFocus();
  assert.equal(await run("document.getElementById('bauify-code').hidden"), true, 'a different import on the same line is not reopened as the old evidence');
  assert.match(await run("document.querySelector('.analysis-refresh-status').textContent"), /selection is no longer available/);
  write('a.mjs', 'export const a = 1;\n');
  await refreshFromCurrentFocus();
  assert.match(await run("document.querySelector('.analysis-refresh-status').textContent"), /selection is no longer available/, 'an undrawn dependency removed from code is not reported as declared');

  write('complex.mjs', 'export function complex(x) {' + Array.from({ length: 25 }, (_, i) => `if (x === ${i}) return ${i};`).join('') + 'return 0; }\n');
  await refreshFromCurrentFocus();
  // Restore an old unverified-only filter after the last report disappears.
  await run("window.__archifyRestoreReading({ reading: { kind: 'findings' }, open: true, filters: { unverified: true, search: '', status: 'all' } })");
  assert.equal(await run("Boolean(document.querySelector('.unverified-filter'))"), false);
  assert.ok(await run("document.querySelectorAll('#bauify-overview .finding-row').length") > 0, 'internal findings stay visible when the external-only control is absent');
  await run("document.querySelector('.findings-back').click()");

  const complexId = await run(`(() => {
    const finding = JSON.parse(document.getElementById('bauify-analysis').textContent).findings.find(f => f.code === 'complexity/function' && f.subject.file === 'complex.mjs');
    if (!finding) return null;
    window.__archifyShowFinding(finding.id);
    document.querySelector('#bauify-detail .inline-evidence .ref').click();
    return finding.id;
  })()`);
  assert.ok(complexId, 'the fixture has a complex function and opens its inline source');
  await refreshFromCurrentFocus();
  assert.equal(await run("document.getElementById('bauify-code').hidden"), false, 'duplicate link locations do not hide the original inline source');
  assert.ok(toolbarClicks > 0, 'the toolbar was reached by a real browser pointer');
  await run("document.querySelector('#bauify-code .source-back').click(); document.querySelector('.more-evidence').open = true; document.querySelector('.more-evidence .ref[data-file]').click()");
  await refreshFromCurrentFocus();
  assert.equal(await run("document.getElementById('bauify-code').hidden"), false, 'expanded rule evidence reopens its source after re-analysis');
  await run("document.querySelector('#bauify-code .source-back').click()");
  assert.equal(await run("document.querySelector('.more-evidence').open"), true, 'returning from restored source leaves the evidence visible');
  assert.equal(await run("document.activeElement.matches('.more-evidence .ref[data-file]')"), true, 'returning from restored source focuses its visible evidence');
  await run("document.querySelector('#bauify-detail .back').click()");

  const has3d = await run(`(() => {
    document.querySelector('.views-option[data-view=atlas3d]').click();
    const view = window.__archifyAtlas3d.view;
    if (!view || view.failed) return false;
    const atlas = JSON.parse(document.getElementById('bauify-atlas-data').textContent);
    const index = atlas.functions.findIndex(fn => atlas.files[fn[0]][0] === 'complex.mjs');
    if (index < 0) throw Error('complex function missing from 3D fixture');
    view.select({ type: 'function', index });
    return view.saveSelection().unique;
  })()`);
  if (has3d) {
    const before3d = await run('window.__archifyAtlas3d.view.saveSelection()');
    write('complex.mjs', '\n' + fs.readFileSync(path.join(root, 'complex.mjs'), 'utf8'));
    await refreshFromCurrentFocus();
    const after3d = await run('window.__archifyAtlas3d.view.saveSelection()');
    assert.equal(after3d?.name, before3d.name, '3D restores the unique function after a line shift');
    assert.equal(after3d?.line, before3d.line + 1);
  } else t.diagnostic('3D re-analysis handoff requires WebGL and was not exercised');
  await run("document.querySelector('.views-option[data-view=diagram]').click()");

  // A failing run keeps the last good result on disk and on the page.
  const before = fs.readFileSync(path.join(out, 'analysis', 'findings.json'), 'utf8');
  fs.writeFileSync(baseline, '{ "schema_version": 1, "accepted": [{ "id": "broken" }] }');
  await run("document.querySelector('#bauify-overview .bauify-reanalyze').click()");
  await wait("document.querySelector('#bauify-overview .reanalyze-error')");
  assert.match(await run("document.querySelector('#bauify-overview .reanalyze-error').textContent"), /Re-analysis failed: .*baseline.*last successful run/s);
  assert.equal(await run("document.querySelector('#bauify-overview .bauify-reanalyze').disabled"), false, 'the reader can retry');
  assert.equal(fs.readFileSync(path.join(out, 'analysis', 'findings.json'), 'utf8'), before);
});
