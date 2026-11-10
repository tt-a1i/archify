import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { ensureDependencies, startAnalysisView } from '../archify/modules/code-analysis/bin/serve.mjs';

const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Code Analysis highlights exact duplicate characters and retains both locations through source navigation', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run Code Analysis browser coverage.',
}, async t => {
  // Match the service's preparation order before loading parser/schema libraries.
  await ensureDependencies();
  const { buildGraph } = await import('../archify/modules/code-analysis/lib/analysis.mjs');
  const { buildOverlay } = await import('../archify/modules/code-analysis/overlay/inject.mjs');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-c6-browser-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  // A UI contract fixture: detector correctness belongs to the real-engine
  // module tests. Equal tokens here occupy different UTF-16 columns on one line.
  const matched = 'target("😀", "<b>&</b>")';
  const sameLine = `  const prefix = "😀"; const left = ${matched}; const right = ${matched}; // </script><img src=x onerror="globalThis.__c6Injected=1">`;
  const shortLines = ['export function keep() {', sameLine,
    ...Array.from({ length: 11 }, (_, i) => `  // context ${i + 1}`), '}'];
  const longMatch = ['blockStart("😀", "<b>&</b>");',
    ...Array.from({ length: 28 }, (_, i) => `  step(${i + 1}); // middle-${i + 2}`), 'blockEnd("😀");'];
  const longLines = side => ['// outside before', '// another context line',
    `const ${side} = "😀"; ${longMatch[0]}`, ...longMatch.slice(1, -1),
    `${longMatch.at(-1)} // outside ${side}`, '// outside after'];
  const sources = { 'same.mjs': shortLines.join('\r\n') + '\r\n',
    'long-left.mjs': longLines('left').join('\r\n') + '\r\n',
    'long-right.mjs': longLines('right').join('\r\n') + '\r\n' };
  const location = (file, line, column, endLine, endColumn) => {
    const offset = (n, col) => sources[file].split('\n').slice(0, n - 1).reduce((total, text) => total + text.length + 1, 0) + col - 1;
    return { file, line, column, endLine, endColumn, start: offset(line, column), end: offset(endLine, endColumn) };
  };
  const shortLocations = [sameLine.indexOf(matched), sameLine.lastIndexOf(matched)]
    .map(start => location('same.mjs', 2, start + 1, 2, start + matched.length + 1));
  const longLocations = ['left', 'right'].map(side => location(`long-${side}.mjs`, 3,
    `const ${side} = "😀"; `.length + 1, 32, longMatch.at(-1).length + 1));
  const duplicate = (id, locations, tokens, lines) => ({
    id, code: 'redundancy/duplicate-block', dimension: 'redundancy', severity: 'warning', confidence: 1,
    message: 'Review the repeated source together.', subject: { files: [...new Set(locations.map(loc => loc.file))], locations },
    evidence: { tokens, lines, kind: 'exact', identifiers: 'exact', engine: { name: 'jscpd', version: '5.4.3', adapterRevision: 2 } },
    supportedFixes: ['Read both ranges before deciding whether the repetition is intentional.'],
  });
  const diagnostics = [duplicate('REDU-0001', shortLocations, 31, 1),
    duplicate('REDU-0002', longLocations, 260, 30),
    duplicate('REDU-0003', shortLocations.map(({ file, line, endLine }) => ({ file, line, endLine })), 31, 1),
    duplicate('REDU-0004', longLocations.map(loc => ({ ...loc, endLine: 14,
      endColumn: longMatch[11].length + 1, end: location(loc.file, 3, loc.column, 14, longMatch[11].length + 1).end })), 104, 12),
    { id: 'CX-0001', code: 'complexity/function', dimension: 'complexity', severity: 'warning', confidence: 1,
      message: 'Review keep.', subject: { file: 'same.mjs', function: 'keep', line: 1, endLine: shortLines.length },
      evidence: { complexity: 12, nesting: 3, length: shortLines.length, deepestLine: 2,
        threshold: { complexity: 10, nesting: 2 } }, supportedFixes: [] }];
  const repository = { revision: null, baseRevision: null, sourceKind: 'working-tree', root: '.',
    url: null, language: 'ts', adapter: 'typescript@5.9.3', adapterRevision: 22, snapshotId: 'c'.repeat(64) };
  const facts = { schema_version: 1, repository, files: Object.entries(sources).map(([file, sourceText]) => ({
    path: file, loc: sourceText.split('\r\n').length - 1, role: 'source', sourceText,
  })), packageMarkers: [], imports: [], symbols: [], calls: [], functions: [
    { file: 'same.mjs', name: 'keep', qualname: 'keep', line: 1, endLine: shortLines.length, complexity: 12, nesting: 3, deepestLine: 2 },
  ], unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 } };
  const graph = buildGraph(facts, { modules: { groups: { app: ['**'] }, excludeRoles: [] } });
  const findingsDocument = { schema_version: 1, repository, rules: ['redundancy/duplicate-block', 'complexity/function'], diagnostics };
  const ir = { schema_version: 1, diagram_type: 'architecture', meta: { title: 'Duplicate source evidence', output: 'base.html' },
    components: [{ id: 'app', type: 'backend', label: 'App', pos: [40, 40], size: [180, 64] }], connections: [] };
  const irPath = path.join(scratch, 'input.json'), basePath = path.join(scratch, 'base.html');
  fs.writeFileSync(irPath, JSON.stringify(ir));
  execFileSync(process.execPath, [fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url)),
    'render', 'architecture', irPath, basePath], { encoding: 'utf8' });
  const overlaid = buildOverlay({ ir, graph, html: fs.readFileSync(basePath, 'utf8'), map: { app: graph.modules.map(mod => mod.id) },
    facts, findings: diagnostics, findingsDocument, sourceRoot: scratch, run: { rules: findingsDocument.rules } });
  const htmlPath = path.join(scratch, 'duplicates.html');
  fs.writeFileSync(htmlPath, overlaid.html);
  if (process.env.ARCHIFY_C6_HIGHLIGHT_HTML) fs.writeFileSync(process.env.ARCHIFY_C6_HIGHLIGHT_HTML, overlaid.html);
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
  await send('Page.navigate', { url: pathToFileURL(htmlPath).href });
  await loaded;
  await run('document.fonts.ready');
  await run("document.getElementById('btn-bauify').click()");
  const openFinding = async id => {
    await run(`(() => {
      if (!document.getElementById('bauify-detail').hidden) document.querySelector('#bauify-detail .back').click();
      const button = document.querySelector('#bauify-overview [data-finding="${id}"]');
      const group = button.closest('details');
      if (group && !group.open) group.querySelector('summary').click();
      button.click();
    })()`);
  };
  const section = '#bauify-detail section[aria-label="Duplicate code locations"]';
  const marks = selector => run(`Array.from(document.querySelectorAll(${JSON.stringify(selector + ' mark')}), mark => {
    const row = mark.closest('.evidence-line,.ln').cloneNode(true);
    row.querySelector('.line-number,i')?.remove();
    const selected = row.querySelector('mark'), before = document.createRange(), after = document.createRange();
    before.setStart(row, 0); before.setEndBefore(selected);
    after.setStartAfter(selected); after.setEnd(row, row.childNodes.length);
    return { text: selected.textContent, before: before.toString(), after: after.toString(), background: getComputedStyle(mark).backgroundColor };
  })`);

  await openFinding('REDU-0001');
  assert.match(await run("document.querySelector('#bauify-detail h3').textContent"), /Duplicate code/);
  assert.match(await run("document.getElementById('bauify-detail').textContent"), /31 matching tokens.*1 line/);
  assert.equal(await run(`document.querySelectorAll(${JSON.stringify(section + ' pre')}).length`), 2,
    'same-file, same-line occurrences remain separate locations');
  const shortMarks = await marks(section + ' pre');
  assert.equal(shortMarks.length, 2);
  for (const [i, mark] of shortMarks.entries()) {
    assert.equal(mark.text, matched, 'only the native UTF-16 range is marked, with an exclusive end');
    assert.equal(mark.before, sameLine.slice(0, shortLocations[i].column - 1));
    assert.equal(mark.after, sameLine.slice(shortLocations[i].endColumn - 1));
  }
  assert.equal(shortMarks[0].background, shortMarks[1].background, 'both locations use the same highlight colour');
  assert.doesNotMatch(shortMarks[0].background, /^(transparent|rgba\(0, 0, 0, 0\))$/);
  assert.equal(await run(`document.querySelectorAll(${JSON.stringify(section + ' pre img,' + section + ' pre b,' + section + ' pre script')}).length`), 0,
    'captured HTML remains inert source text');
  assert.equal(await run('globalThis.__c6Injected ?? null'), null);
  for (let i = 0; i < 2; i++) {
    await run(`document.querySelectorAll(${JSON.stringify(section + ' .ref')})[${i}].click()`);
    assert.equal(await run("document.getElementById('bauify-code').hidden"), false);
    assert.deepEqual((await marks('#bauify-code pre')).map(({ text, before, after }) => ({ text, before, after })),
      [{ text: matched, before: shortMarks[i].before, after: shortMarks[i].after }]);
    await run("document.querySelector('#bauify-code .source-toggle').click()");
    assert.deepEqual((await marks('#bauify-code pre')).map(mark => mark.text), [matched], 'Show full file retains the selected occurrence');
    assert.equal((await marks('#bauify-code pre'))[0].before, shortMarks[i].before);
    await run("document.querySelector('#bauify-code .source-back').click()");
    assert.equal((await marks(section + ' pre')).length, 2, 'returning preserves both duplicate previews');
  }
  if (process.env.ARCHIFY_C6_HIGHLIGHT_SCREENSHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(process.env.ARCHIFY_C6_HIGHLIGHT_SCREENSHOT, Buffer.from(shot.data, 'base64'));
  }

  await openFinding('REDU-0002');
  const displayedLines = await run(`Array.from(document.querySelectorAll(${JSON.stringify(section + ' pre')}), pre =>
    Array.from(pre.querySelectorAll('.line-number'), line => Number.parseInt(line.textContent, 10)))`);
  assert.deepEqual(displayedLines[0], displayedLines[1], 'both locations use the same bounded preview');
  for (const lines of displayedLines) {
    assert.ok(lines.length < longMatch.length, 'long matches omit middle lines rather than rendering an unbounded preview');
    assert.equal(lines[0], 3, 'the beginning of the match remains visible');
    assert.equal(lines.at(-1), 32, 'the end of the match remains visible');
    assert.ok(lines.every(line => line >= 3 && line <= 32));
  }
  const omission = await run(`Array.from(document.querySelectorAll(${JSON.stringify(section + ' .duplicate-omitted')}), el => Number.parseInt(el.textContent.match(/[0-9]+/)[0], 10))`);
  assert.deepEqual(omission, displayedLines.map(lines => longMatch.length - lines.length), 'each preview states exactly how many matching lines it omits');
  const previewMarks = displayedLines[0].map(line => longMatch[line - 3]);
  assert.deepEqual((await marks(section + ' pre')).map(mark => mark.text), [...previewMarks, ...previewMarks]);
  await run(`document.querySelector(${JSON.stringify(section + ' .ref')}).click()`);
  await run("document.querySelector('#bauify-code .source-toggle').click()");
  assert.deepEqual((await marks('#bauify-code pre')).map(mark => mark.text), longMatch,
    'the complete source preserves partial first/last lines and reveals the omitted middle');
  await run("document.querySelector('#bauify-code .source-back').click()");

  await openFinding('REDU-0003');
  assert.equal((await marks(section + ' pre')).length, 0, 'historical line-only locations must not fabricate exact character marks');
  assert.match(await run(`document.querySelector(${JSON.stringify(section)}).textContent`), /highlight unavailable.*column/i);
  await run(`document.querySelector(${JSON.stringify(section + ' .ref')}).click()`);
  assert.equal((await marks('#bauify-code pre')).length, 0);
  assert.match(await run("document.querySelector('#bauify-code pre').textContent"), /target/);
  await run("document.querySelector('#bauify-code .source-back').click()");

  await openFinding('REDU-0004');
  assert.deepEqual((await marks(section + ' pre')).map(mark => mark.text),
    [...longMatch.slice(0, 12), ...longMatch.slice(0, 12)], 'short matches show all twelve cited lines, beyond the old nine-line excerpt');
  assert.doesNotMatch(await run(`document.querySelector(${JSON.stringify(section)}).textContent`), /matching lines omitted/);

  await openFinding('CX-0001');
  assert.equal(await run(`document.querySelector(${JSON.stringify(section)}) === null`), true);
  assert.match(await run("document.querySelector('#bauify-detail h3').textContent"), /keep.*is complex/);
  await run("document.querySelector('#bauify-detail .ref').click()");
  assert.equal((await marks('#bauify-code pre')).length, 0, 'ordinary function context does not acquire duplicate marks');
  assert.match(await run("document.getElementById('bauify-code').textContent"), /Highlighted function: lines 1–14/);
  assert.ok(await run("document.querySelector('#bauify-code .range-hit') !== null"), 'legacy function range navigation remains available');
  assert.equal(await run('globalThis.__c6Injected ?? null'), null);
});

test('Code Analysis marks an empty or incomplete duplicate scan instead of showing a checked all-clear', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run Code Analysis browser coverage.',
}, async t => {
  await ensureDependencies();
  const { buildGraph } = await import('../archify/modules/code-analysis/lib/analysis.mjs');
  const { buildOverlay } = await import('../archify/modules/code-analysis/overlay/inject.mjs');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-c6-coverage-browser-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const repository = { revision: null, baseRevision: null, sourceKind: 'working-tree', root: '.',
    url: null, language: 'ts', adapter: 'typescript@5.9.3', adapterRevision: 22, snapshotId: 'd'.repeat(64) };
  const sources = { 'src/a.ts': 'export const a = 1;\n', 'vendor/b.ts': 'export const b = 2;\n' };
  const facts = { schema_version: 1, repository, files: Object.entries(sources).map(([file, sourceText]) => ({ path: file, loc: 1, role: 'source', sourceText })),
    packageMarkers: [], imports: [], symbols: [], calls: [], functions: [], unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 } };
  const graph = buildGraph(facts, { modules: { groups: { app: ['**'] }, excludeRoles: [] } });
  const ir = { schema_version: 1, diagram_type: 'architecture', meta: { title: 'Duplicate coverage', output: 'base.html' },
    components: [{ id: 'app', type: 'backend', label: 'App', pos: [40, 40], size: [180, 64] }], connections: [] };
  const irPath = path.join(scratch, 'input.json'), basePath = path.join(scratch, 'base.html');
  fs.writeFileSync(irPath, JSON.stringify(ir));
  execFileSync(process.execPath, [fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url)),
    'render', 'architecture', irPath, basePath], { encoding: 'utf8' });
  const rules = ['complexity/function', 'redundancy/duplicate-block'];
  const page = (name, coverage) => {
    const file = path.join(scratch, `${name}.html`);
    fs.writeFileSync(file, buildOverlay({ ir, graph, html: fs.readFileSync(basePath, 'utf8'), map: { app: graph.modules.map(mod => mod.id) },
      facts, findings: [], sourceRoot: scratch, run: { rules, duplicates: { coverage } } }).html);
    return file;
  };
  // Matches a real jscpd scan where one file is vendored and the other is below the token limit.
  const empty = page('empty', { selected: ['src/a.ts', 'vendor/b.ts'], analyzed: [], omitted: [
    { file: 'src/a.ts', reason: 'not-reported-by-engine' }, { file: 'vendor/b.ts', reason: 'vendored' }], complete: false });
  const complete = page('complete', { selected: ['src/a.ts', 'vendor/b.ts'], analyzed: ['src/a.ts', 'vendor/b.ts'], omitted: [], complete: true });
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async expression => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(response.exceptionDetails, undefined, response.exceptionDetails?.exception?.description);
    return response.result?.value;
  };
  const open = async file => {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(file).href });
    await loaded;
    await run("document.getElementById('btn-bauify').click()");
    return {
      notices: await run("Array.from(document.querySelectorAll('#bauify-overview .coverage-notice'), el => el.textContent)"),
      summary: await run("document.querySelector('#bauify-overview details.coverage summary').textContent"),
      coverage: await run("document.querySelector('#bauify-overview details.coverage .cov').textContent"),
    };
  };
  const partial = await open(empty);
  assert.ok(partial.notices.some(text => /^Duplicate code: 0\/2 files analyzed · incomplete\./.test(text)), JSON.stringify(partial.notices));
  assert.match(partial.summary, / · incomplete$/, 'zero findings from an empty duplicate scan is not a complete result');
  assert.match(partial.coverage, /Duplicate code: 0\/2 files analyzed · incomplete/);
  const full = await open(complete);
  assert.equal(full.notices.some(text => /Duplicate code/.test(text)), false, JSON.stringify(full.notices));
  assert.doesNotMatch(full.summary, /incomplete/);
  assert.match(full.coverage, /Duplicate code: 2\/2 files analyzed(?! · incomplete)/);
});

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
  assert.match(await run("document.querySelector('#bauify-overview h3').textContent"), /Structural problems to fix/);
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

test('Code Analysis Atlas draws the analyzed tree, focuses a module and hands a finding back to the Classic view', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run Code Analysis browser coverage.',
}, async t => {
  const fixture = fileURLToPath(new URL('../archify/modules/code-analysis/test/fixtures/py-tasks', import.meta.url));
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-atlas-browser-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const root = path.join(scratch, 'repo');
  fs.cpSync(fixture, root, { recursive: true, filter: src => !src.includes('__pycache__') });
  const ir = path.join(scratch, 'input.json');
  fs.writeFileSync(ir, JSON.stringify({ schema_version: 1, diagram_type: 'architecture', meta: { title: 'Atlas', output: 'architecture.html' },
    components: [{ id: 'app', type: 'backend', label: 'App', pos: [40, 40], size: [180, 64] }], connections: [] }));
  const view = await startAnalysisView([root, '--ir', ir, '--out', path.join(scratch, 'view'), '--language', 'py', '--config', path.join(root, 'analysis.config.json')]);
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
  // Under the 15 s protocol timeout, so a stuck wait reports what it waited for.
  const until = (condition, what) => run(`new Promise((resolve, reject) => { const deadline = Date.now() + 10000; const poll = () => {
    if (${condition}) return resolve(true);
    if (Date.now() > deadline) return reject(new Error(${JSON.stringify(what)}));
    setTimeout(poll, 25);
  }; poll(); })`);
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: view.url });
  await loaded;
  await run("document.getElementById('code-analysis-start').click()");
  await until("document.documentElement.getAttribute('data-bauify') === 'on'", 'analysis did not open');

  await run("document.querySelector('#bauify-reader .reader-atlas').click()");
  const atlas = JSON.parse(await run("document.getElementById('bauify-atlas-data').textContent"));
  await until(`document.documentElement.getAttribute('data-bauify-atlas-drawn') === '${atlas.edges.length}'`, 'atlas did not draw');
  assert.ok(atlas.edges.length > 0 && atlas.functions.length > 0, 'the fixture has dependencies and functions to draw');
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-animating')"), 'true', 'the opening reveal runs');
  await until("!document.documentElement.hasAttribute('data-bauify-atlas-animating')", 'the opening reveal did not finish');
  assert.equal(await run("getComputedStyle(document.getElementById('bauify-reader')).display"), 'none', 'the Classic reader steps aside');
  // The circle is painted: a good share of pixels in its bounding square are not transparent.
  const painted = await run(`(() => { const c = document.querySelector('#bauify-atlas canvas'), x = c.getContext('2d');
    const s = Math.min(c.width, c.height), d = x.getImageData((c.width - s) / 2, (c.height - s) / 2, s, s).data; let n = 0;
    for (let i = 3; i < d.length; i += 4 * 7) if (d[i]) n++; return n; })()`);
  assert.ok(painted > 500, `atlas canvas is painted (${painted} sampled pixels)`);

  // A module from the side panel becomes the focus; the panel names it.
  await run("document.querySelector('#bauify-atlas [data-module]').click()");
  const focused = await run("document.documentElement.getAttribute('data-bauify-atlas-focus')");
  assert.ok(atlas.modules.some(m => m.id === focused), 'a module is focused');
  assert.match(await run("document.querySelector('#bauify-atlas .selected h4').textContent"), new RegExp(atlas.modules.find(m => m.id === focused).label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  // A selected import cycle gets a light that travels around it: the canvas keeps changing.
  const canvasSum = "(() => { const c = document.querySelector('#bauify-atlas canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) n += d[i] + d[i + 1] + d[i + 2] + d[i + 3]; return n; })()";
  const cycle = atlas.findings.findIndex(f => f.kind === 'cycle');
  assert.notEqual(cycle, -1, 'the fixture reports an import cycle');
  await run(`document.querySelector('#bauify-atlas [data-finding="${cycle}"]').click()`);
  await until("!document.documentElement.hasAttribute('data-bauify-atlas-animating')", 'the selection cross-fade did not finish');
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-flow')"), 'on');
  const before = await run(canvasSum);
  await run('new Promise(resolve => setTimeout(resolve, 250))');
  assert.notEqual(await run(canvasSum), before, 'the cycle light moves');
  // With reduced motion the same selection is drawn at once and stays still.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await run(`document.querySelector('#bauify-atlas [data-finding="${cycle}"]').click()`);
  await run(`document.querySelector('#bauify-atlas [data-finding="${cycle}"]').click()`);
  assert.equal(await run("document.documentElement.hasAttribute('data-bauify-atlas-animating')"), false, 'no cross-fade with reduced motion');
  await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-flow')"), 'off');
  const still = await run(canvasSum);
  await run('new Promise(resolve => setTimeout(resolve, 250))');
  assert.equal(await run(canvasSum), still, 'nothing moves with reduced motion');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  // A complex function selected in the Atlas opens with its source in the Classic view.
  const complex = atlas.findings.findIndex(f => f.kind === 'function');
  assert.notEqual(complex, -1, 'the fixture reports a complex function');
  await run(`document.querySelector('#bauify-atlas [data-finding="${complex}"]').click()`);
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-finding')"), atlas.findings[complex].id);
  await run("document.querySelector('#bauify-atlas .atlas-evidence').click()");
  await until("document.getElementById('bauify-atlas').hidden && !document.getElementById('bauify-detail').hidden", 'finding did not open in the Classic view');
  assert.match(await run("document.querySelector('#bauify-detail h3').textContent"), /is complex/);
  assert.ok(await run("!!document.querySelector('#bauify-detail pre')"), 'the Classic view shows the source excerpt');
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-view')"), null);

  // Turning Code Analysis off also closes the Atlas.
  await run("document.querySelector('#bauify-reader .reader-atlas').click()");
  assert.equal(await run("document.getElementById('bauify-atlas').hidden"), false);
  await run("document.getElementById('btn-bauify').click()");
  await until("document.getElementById('bauify-atlas').hidden", 'atlas stayed open after Code Analysis was turned off');
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-view')"), null);
});
