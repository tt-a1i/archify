import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { startAnalysisView } from '../archify/modules/code-analysis/bin/serve.mjs';

const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('AI task reader: evidence first, live validation, clipboard fallback, downloads and offline snapshots', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run Code Analysis browser coverage.',
}, async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-task-reader-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'repo'), out = path.join(scratch, 'view');
  const filename = 'deeply_nested_business_dispatch_with_a_long_but_legitimate_module_name.py';
  fs.mkdirSync(root);
  const source = ['def dispatch_workflow_with_a_long_descriptive_name(kind):',
    ...Array.from({ length: 28 }, (_, i) => `    if kind == ${i}:\n        return ${i}`),
    '    return "</script><img src=x onerror=alert(1)>"', ''].join('\n');
  const sourceFile = path.join(root, filename);
  fs.writeFileSync(sourceFile, source);
  const ir = path.join(scratch, 'input.json');
  fs.writeFileSync(ir, JSON.stringify({ schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Code analysis · evidence and AI handoff', output: 'architecture.html' },
    components: [{ id: 'app', type: 'backend', label: 'Application', pos: [80, 80], size: [240, 70] }], connections: [] }));
  const view = await startAnalysisView([root, '--ir', ir, '--out', out, '--language', 'py']);
  const sockets = new Set();
  view.server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  t.after(() => new Promise(resolve => { view.server.close(resolve); for (const socket of sockets) socket.destroy(); }));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  };
  const wait = async expression => {
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      if (await run(`Boolean(${expression})`)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const navigate = async url => {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url }); await loaded;
  };
  const evidenceDir = process.env.ARCHIFY_ANALYSIS_UI_EVIDENCE_DIR;
  if (evidenceDir) fs.mkdirSync(evidenceDir, { recursive: true });
  const screenshot = async name => {
    if (!evidenceDir) return;
    await run('document.fonts.ready');
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(evidenceDir, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await navigate(view.url);
  await run("document.getElementById('code-analysis-start').click()");
  await wait("document.documentElement.getAttribute('data-bauify') === 'on'");
  await run("window.taskRequests = []; var nativeFetch = window.fetch; window.fetch = function (url, options) { if (url === '/task') window.taskRequests.push(JSON.parse(options.body)); return nativeFetch.apply(this, arguments); };");
  assert.match(await run("document.getElementById('bauify-overview').innerText"), /Not checked: duplicate code, project coding conventions/);
  assert.match(await run("document.querySelector('#bauify-overview .bauify-item .where').textContent"), /deeply_nested.*\.py:1/);
  await screenshot('overview-1440');
  const openFinding = async () => {
    await run("document.querySelector('#bauify-overview .bauify-item').click()");
    await wait("!document.getElementById('bauify-detail').hidden");
  };
  await openFinding();
  assert.equal(await run("document.activeElement === document.querySelector('#bauify-detail h3')"), true);
  assert.equal(await run("document.querySelector('#bauify-detail .relationship').open"), false);
  assert.equal(await run("document.querySelectorAll('#bauify-detail .inline-evidence .evidence-line').length <= 18"), true);
  assert.equal(await run("document.querySelector('#bauify-detail .inline-evidence').compareDocumentPosition(document.querySelector('#bauify-detail .next-step')) & Node.DOCUMENT_POSITION_FOLLOWING"), 4);
  assert.equal(await run("document.querySelector('#bauify-detail img')"), null, 'source text is never interpreted as markup');
  for (const [width, height] of [[1440, 900], [1280, 720], [390, 844]]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await screenshot('problem-' + width);
    assert.equal(await run("document.getElementById('bauify-detail').scrollWidth <= document.getElementById('bauify-detail').clientWidth"), true, JSON.stringify(await run("[...document.querySelectorAll('#bauify-detail *')].filter(e => e.getBoundingClientRect().right > document.getElementById('bauify-detail').getBoundingClientRect().right).map(e => [e.tagName,e.className,e.getBoundingClientRect().width])")));
  }
  await run("Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.quickCopiedTask = text; } } }); document.querySelector('.quick-copy').click()");
  await wait("/Copied AI task/.test(document.querySelector('.handoff-status').textContent)");
  assert.equal(await run("document.querySelector('.ai-task').open"), false, 'one-click handoff does not require opening the preview');
  assert.equal(await run("window.quickCopiedTask === document.querySelector('.task-preview').value"), true);
  await run("document.querySelector('#bauify-detail .inline-evidence .ref').click()");
  assert.ok(await run("document.querySelectorAll('#bauify-code .ln.range-hit').length > 1"));
  await run("document.querySelector('#bauify-code .source-toggle').click()");
  assert.equal(await run("document.querySelectorAll('#bauify-code .ln.range-hit').length"), source.trimEnd().split('\n').length);
  await screenshot('source-390');
  await run("document.querySelector('#bauify-code .source-back').click(); document.querySelector('#bauify-detail .ai-task > summary').focus()");
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await wait("!document.querySelector('#bauify-detail .task-copy').disabled");
  assert.match(await run("document.querySelector('#bauify-detail .task-status').textContent"), /matches the current working tree/);
  await run("var selected = JSON.parse(document.getElementById('bauify-analysis').textContent).findings.find(f => f.id === document.querySelector('.ai-task').getAttribute('data-task-id')); window.__archifyBuildTask(selected.id, selected.reviewTarget).then(p => { window.fixtureTask = p; })");
  assert.match(await run("document.querySelector('#bauify-detail .task-preview').value"), /dispatch_workflow_with_a_long_descriptive_name/);
  // Clipboard rejection retains a selectable exact copy of the server Markdown.
  await run("Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('denied'); } } }); document.querySelector('#bauify-detail .task-copy').click()");
  await wait("/Automatic copy unavailable/.test(document.querySelector('#bauify-detail .task-status').textContent)");
  assert.equal(await run("document.querySelector('.task-preview').selectionEnd === document.querySelector('.task-preview').value.length"), true);
  await run("navigator.clipboard.writeText = async text => { window.copiedTask = text; }; document.querySelector('.task-copy').click()");
  await wait("/Copied AI task/.test(document.querySelector('.task-status').textContent)");
  assert.equal(await run("window.copiedTask === document.querySelector('.task-preview').value"), true);
  const downloads = path.join(scratch, 'downloads'); fs.mkdirSync(downloads);
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await run("document.querySelector('.task-download').click()");
  await wait("/Download requested/.test(document.querySelector('.task-status').textContent)");
  const untilDownload = Date.now() + 5000;
  while (!fs.readdirSync(downloads).some(name => name.endsWith('.md')) && Date.now() < untilDownload) await new Promise(resolve => setTimeout(resolve, 50));
  const downloaded = fs.readdirSync(downloads).find(name => name.endsWith('.md'));
  assert.ok(downloaded);
  assert.equal(fs.readFileSync(path.join(downloads, downloaded), 'utf8'), await run("document.querySelector('.task-preview').value"));
  fs.writeFileSync(sourceFile, source.replace('return 0', 'return 100'));
  await run("document.querySelector('.task-refresh').click()");
  await wait("/Evidence changed/.test(document.querySelector('.task-status').textContent)");
  fs.renameSync(sourceFile, sourceFile + '.saved');
  await run("document.querySelector('.task-refresh').click()");
  await wait("/cited file is missing/.test(document.querySelector('.task-status').textContent)");
  fs.renameSync(sourceFile + '.saved', sourceFile);
  await run("window.liveBuilder = window.__archifyBuildTask; window.__archifyBuildTask = async () => { throw new TypeError('network unavailable'); }; document.querySelector('.task-refresh').click()");
  await wait("/Local service unavailable.*Snapshot only/.test(document.querySelector('.task-status').textContent)");
  for (const status of [403, 409, 422]) {
    await run(`window.__archifyBuildTask = async () => { var e = new Error('request rejected ${status}'); e.status = ${status}; throw e; }; document.querySelector('.task-refresh').click()`);
    await wait("/Could not prepare task/.test(document.querySelector('.task-status').textContent)");
    assert.equal(await run("document.querySelector('.task-copy').disabled"), true, 'do not hide HTTP rejection behind stale snapshot');
  }
  await run("window.__archifyBuildTask = async () => { var p=structuredClone(window.fixtureTask); p.task.source.snapshotId='different-snapshot'; return p; }; document.querySelector('.task-refresh').click()");
  await wait("/newer analysis snapshot/.test(document.querySelector('.task-status').textContent)");
  assert.equal(await run("document.querySelector('.task-copy').disabled"), true, 'a stable ID must not mix old page evidence with a newer task');
  assert.equal(await run("taskRequests.length > 0 && taskRequests.every(r => r.expected && r.ids.every(id => r.expected[id] === JSON.parse(document.getElementById('bauify-analysis').textContent).findings.find(f => f.id === id).reviewTarget))"), true, 'native preview, quick copy, refresh and download requests bind the claim displayed by the page');
  // Large reports remain navigable; accepted findings stay out of priority slots.
  fs.writeFileSync(sourceFile, source);
  const manyFile = path.join(root, 'many.py');
  fs.writeFileSync(manyFile, Array.from({ length: 120 }, (_, i) => source.replace('dispatch_workflow_with_a_long_descriptive_name', 'dispatch_' + i)).join('\n'));
  const reanalyze = async () => {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await run("document.querySelector('#bauify-overview .bauify-reanalyze').click()");
    await loaded;
    await wait("document.documentElement.getAttribute('data-bauify') === 'on' && !document.getElementById('bauify-overview').hidden");
  };
  await reanalyze();
  assert.equal(await run("JSON.parse(document.getElementById('bauify-analysis').textContent).totals.findings"), 122, '121 complex functions plus many.py itself, reported as a very large file');
  assert.equal(await run("document.querySelectorAll('#bauify-overview .bauify-item .n').length"), 3);
  await screenshot('many-390');
  fs.unlinkSync(manyFile); fs.writeFileSync(sourceFile, 'value = 1\n');
  await reanalyze();
  assert.match(await run("document.getElementById('bauify-overview').innerText"), /No findings within the checks that ran/);
  assert.equal(await run("document.querySelectorAll('#bauify-overview [data-finding]').length"), 0);
  await screenshot('empty-390');
  fs.writeFileSync(sourceFile, source); await reanalyze();
  await navigate(pathToFileURL(path.join(out, 'analysis/repo.analysis.html')).href);
  await run("document.getElementById('btn-bauify').click()");
  await openFinding();
  await run("document.querySelector('.ai-task').open = true");
  await wait("!document.querySelector('.task-copy').disabled");
  assert.match(await run("document.querySelector('.task-status').textContent"), /Offline report.*Snapshot only/);
  await run("var d=document.getElementById('bauify-detail'); d.scrollTop += document.querySelector('.ai-task').getBoundingClientRect().top - d.getBoundingClientRect().top - 12;");
  await screenshot('task-offline-390');
  await run("document.getElementById('btn-theme').click()");
  await screenshot('task-offline-dark-390');
  const staticHtml = fs.readFileSync(path.join(out, 'analysis/repo.analysis.html'), 'utf8');
  const embedded = staticHtml.match(/<script type="application\/json" id="bauify-analysis">([\s\S]*?)<\/script>/);
  assert.ok(embedded);
  const payload = JSON.parse(embedded[1]);
  payload.snippets = {};
  payload.overview.review = { comparison: { new: [], evidenceChanged: [], notDetected: [], comparable: false, reasons: [{ code: 'scope-changed', message: 'Excluded file roles changed.' }] } };
  const unavailableFile = path.join(scratch, 'source-unavailable.html');
  fs.writeFileSync(unavailableFile, staticHtml.replace(embedded[1], () => JSON.stringify(payload).replace(/<\//g, '<\\/')));
  await navigate(pathToFileURL(unavailableFile).href);
  await run("document.getElementById('btn-bauify').click()");
  assert.match(await run("document.querySelector('.comparison-notice').textContent"), /not directly comparable: Excluded file roles changed\./);
  assert.doesNotMatch(await run("document.querySelector('.comparison-notice').textContent"), /\[object Object\]/);
  await openFinding();
  assert.match(await run("document.querySelector('.inline-evidence').textContent"), /Source unavailable/);
  await run("document.querySelector('.inline-evidence .ref').click()");
  assert.match(await run("document.getElementById('bauify-code').innerText"), /Source is unavailable/);
});

test('external task reader: source identity and the displayed claim survive same-source re-analysis', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run Code Analysis browser coverage.',
}, async t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-external-task-reader-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'repo'), out = path.join(scratch, 'view');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'main.mjs'), 'export const value = 1;\n');
  const report = [{ filePath: 'main.mjs', messages: [{ ruleId: 'example-rule', severity: 1, message: 'Original claim visible on this page', line: 1, column: 14, endLine: 1, endColumn: 19 }] }];
  fs.writeFileSync(path.join(root, 'web.json'), JSON.stringify(report));
  fs.writeFileSync(path.join(root, 'api.json'), JSON.stringify([{ filePath: 'main.mjs', messages: [] }]));
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ schema_version: 1, toolVersion: 'ESLint 9.0.0' }));
  const config = path.join(scratch, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ external: { sources: [
    { id: 'web-eslint', format: 'eslint', file: 'web.json', manifest: 'manifest.json' },
    { id: 'api-eslint', format: 'eslint', file: 'api.json', manifest: 'manifest.json' },
  ] } }));
  const ir = path.join(scratch, 'input.json');
  fs.writeFileSync(ir, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'External task reader', output: 'architecture.html' },
    components: [{ id: 'app', type: 'backend', label: 'App', pos: [40, 40], size: [170, 64] }], connections: [] }));
  const view = await startAnalysisView([root, '--ir', ir, '--out', out, '--language', 'ts', '--config', config]);
  t.after(() => new Promise(resolve => { view.server.close(resolve); view.server.closeAllConnections(); }));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  };
  const wait = async expression => {
    const until = Date.now() + 30000;
    while (Date.now() < until) {
      if (await run(`Boolean(${expression})`)) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out: ${expression}`);
  };
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: view.url }); await loaded;
  await run("document.getElementById('code-analysis-start').click()");
  await wait("document.documentElement.getAttribute('data-bauify') === 'on'");

  await t.test('same-tool sources have distinguishable selector labels and coverage headings', async () => {
    await run("document.querySelector('.external-findings').click()");
    const options = await run("[...document.querySelector('[aria-label=\"Finding source\"]').options].filter(o => o.value.startsWith('source:')).map(o => ({ id: o.value.slice(7), label: o.textContent }))");
    assert.deepEqual(options.map(option => option.id).sort(), ['api-eslint', 'web-eslint']);
    assert.equal(new Set(options.map(option => option.label)).size, options.length, 'same-tool sources have distinct visible labels');
    for (const { id, label } of options) {
      assert.ok(label.includes(id), `the option for ${id} identifies that source`);
      assert.match(label, /ESLint/);
      assert.match(label, /9\.0\.0/);
    }
    await run("document.querySelector('.view-sources').click()");
    const headings = await run("[...document.querySelectorAll('.external-source')].map(section => ({ id: section.querySelector('[data-source]').getAttribute('data-source'), title: section.querySelector('h4').textContent, context: section.querySelector('.findings-heading').textContent }))");
    assert.deepEqual(headings.map(heading => heading.id).sort(), ['api-eslint', 'web-eslint']);
    assert.equal(new Set(headings.map(heading => heading.title)).size, headings.length, 'source headings are distinguishable');
    for (const { id, title, context } of headings) {
      assert.ok(title.includes(id), `the heading for ${id} identifies that source`);
      assert.match(context, /ESLint/);
      assert.match(context, /9\.0\.0/);
    }
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      assert.equal(await run("document.getElementById('bauify-overview').scrollWidth <= document.getElementById('bauify-overview').clientWidth"), true, 'source labels stay within the reader');
      if (process.env.ARCHIFY_ANALYSIS_UI_EVIDENCE_DIR) {
        fs.mkdirSync(process.env.ARCHIFY_ANALYSIS_UI_EVIDENCE_DIR, { recursive: true });
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(process.env.ARCHIFY_ANALYSIS_UI_EVIDENCE_DIR, `external-sources-${width}.png`), Buffer.from(shot.data, 'base64'));
      }
    }
  });

  await t.test('live task actions reject a changed claim without falling back to the captured task', async () => {
    await run("window.__archifyShowFinding(JSON.parse(document.getElementById('bauify-analysis').textContent).findings[0].id); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.copiedTask = text; } } }); document.querySelector('.preview-external-task').click()");
    await wait("!document.querySelector('.task-copy').disabled");
    assert.match(await run("document.querySelector('.task-preview').value"), /Original claim visible on this page/);
    await run("document.querySelector('.task-copy').click()");
    await wait("/Copied AI task/.test(document.querySelector('.task-status').textContent)");
    const copied = await run('window.copiedTask');
    const old = await run("JSON.parse(document.getElementById('bauify-analysis').textContent)");
    report[0].messages[0].message = 'Changed report claim from another page';
    report[0].messages[0].severity = 2;
    fs.writeFileSync(path.join(root, 'web.json'), JSON.stringify(report));
    const refreshed = await fetch(`${view.url}/analyze`, { method: 'POST', headers: { Origin: view.url, 'X-Analysis-Token': view.token, 'X-Analysis-Refresh': '1' } });
    assert.equal(refreshed.status, 200);
    const latest = JSON.parse((await refreshed.text()).match(/id="bauify-analysis">([\s\S]*?)<\/script>/)[1]);
    assert.equal(latest.repository.snapshotId, old.repository.snapshotId);
    assert.equal(latest.findings[0].id, old.findings[0].id);
    assert.notEqual(latest.findings[0].reviewTarget, old.findings[0].reviewTarget);
    await run("document.querySelector('.task-copy').click()");
    await wait("!document.querySelector('.task-refresh').disabled");
    assert.match(await run("document.querySelector('.task-status').textContent"), /Could not prepare task:.*finding changed/i);
    assert.equal(await run("document.querySelector('.task-copy').disabled"), true);
    assert.equal(await run("document.querySelector('.task-download').disabled"), true);
    assert.equal(await run("document.querySelector('.task-preview').value"), '');
    assert.equal(await run('window.copiedTask'), copied, 'a rejected live task cannot copy a different or fallback claim');
    await run("window.__archifyBuildTask = undefined; document.querySelector('.task-refresh').click()");
    await wait("!document.querySelector('.task-copy').disabled");
    assert.match(await run("document.querySelector('.task-status').textContent"), /Offline report.*Snapshot only/);
    assert.match(await run("document.querySelector('.task-preview').value"), /Original claim visible on this page/);
    assert.doesNotMatch(await run("document.querySelector('.task-preview').value"), /Changed report claim from another page/);
  });

  const physical = column => ({ physicalLocation: { artifactLocation: { uri: 'main.mjs' }, region: { startLine: 1, startColumn: column } } });
  fs.writeFileSync(path.join(root, 'locations.sarif'), JSON.stringify({ version: '2.1.0', runs: [{ tool: { driver: { name: 'SARIF fixture', version: '1.0.0' } }, results: [
    { ruleId: 'related-only', message: { text: 'A related citation with an unmapped primary' }, locations: [{ logicalLocations: [{ fullyQualifiedName: 'compiled.Symbol' }] }], relatedLocations: [physical(14)] },
    { ruleId: 'multiple-primary', message: { text: 'Two reported primary locations' }, locations: [physical(1), physical(14)] },
  ] }] }));
  fs.writeFileSync(config, JSON.stringify({ external: { sources: [{ id: 'sarif-locations', format: 'sarif', file: 'locations.sarif' }] } }));
  const refreshed = await fetch(`${view.url}/analyze`, { method: 'POST', headers: { Origin: view.url, 'X-Analysis-Token': view.token, 'X-Analysis-Refresh': '1' } });
  const sarifHtml = await refreshed.text();
  assert.equal(refreshed.status, 200, sarifHtml);
  const embedded = sarifHtml.match(/id="bauify-analysis">([\s\S]*?)<\/script>/);
  const sarifPayload = JSON.parse(embedded[1]);
  const related = sarifPayload.findings.find(finding => finding.external.ruleId === 'related-only');
  const multiple = sarifPayload.findings.find(finding => finding.external.ruleId === 'multiple-primary');
  const reloaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: view.url + '?analysis=open' }); await reloaded;
  await wait("typeof window.__archifyShowFinding === 'function'");

  await t.test('SARIF related-only locations stay labelled context when the primary is unavailable', async () => {
    await run(`window.__archifyShowFinding(${JSON.stringify(related.id)})`);
    assert.match(await run("document.getElementById('bauify-detail').innerText"), /primary.*unavailable/i);
    assert.equal(await run("document.querySelectorAll('#bauify-detail .external-related').length"), 1);
    assert.match(await run("document.querySelector('.external-related summary').textContent"), /Related location.*main\.mjs/);
    await run("document.querySelector('.external-related').open = true");
    assert.match(await run("document.querySelector('.external-related pre').innerText"), /export const value = 1/);
    await run("document.querySelector('.external-related .ref').click()");
    assert.equal(await run("document.getElementById('bauify-code').hidden"), false);
    assert.match(await run("document.getElementById('bauify-code').innerText"), /export const value = 1/);
  });

  await t.test('SARIF multiple primaries are not labelled related; older unlabelled snapshots retain their layout', async () => {
    await run(`window.__archifyShowFinding(${JSON.stringify(multiple.id)})`);
    assert.equal(await run("document.querySelectorAll('#bauify-detail .external-evidence').length"), 2);
    assert.equal(await run("document.querySelectorAll('#bauify-detail .external-related').length"), 0, 'the second primary is not a related citation');
    const legacy = structuredClone(sarifPayload);
    for (const location of legacy.findings.find(finding => finding.id === multiple.id).external.locations) delete location.role;
    const legacyFile = path.join(scratch, 'legacy-locations.html');
    fs.writeFileSync(legacyFile, sarifHtml.replace(embedded[1], () => JSON.stringify(legacy).replace(/<\//g, '<\\/')));
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(legacyFile).href }); await loaded;
    await run(`window.__archifyShowFinding(${JSON.stringify(multiple.id)})`);
    assert.equal(await run("document.querySelectorAll('#bauify-detail .external-related').length"), 1, 'legacy snapshots without role retain the prior first-primary convention');
    assert.equal(await run("document.querySelectorAll('#bauify-detail > .external-evidence').length"), 1);
  });
});
