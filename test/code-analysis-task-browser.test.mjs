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
  await run("window.__archifyBuildTask(document.querySelector('.ai-task').getAttribute('data-task-id')).then(p => { window.fixtureTask = p; })");
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
