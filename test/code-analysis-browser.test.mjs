import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { startAnalysisView } from '../archify/modules/code-analysis/bin/serve.mjs';
import { assertOfflineArtifact } from './helpers/offline-fonts.mjs';

const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Code Analysis highlights exact duplicate characters and retains both locations through source navigation', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run Code Analysis browser coverage.',
}, async t => {
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
      const card = button.closest('.priority-card');
      if (card) { button.click(); return; }
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
  assert.match(await run("document.querySelector('details.coverage summary').textContent"), /^Analysis scope · Java/);
  assert.match(await run("document.querySelector('details.coverage').textContent"), /Java · 2 files analyzed/);
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
  const url = 'https://github.com/example/analysis-fixture';
  git('remote', 'add', 'origin', url);
  const repository = { url, revision: git('rev-parse', 'HEAD').trim(), link_mode: 'local-only' };
  fs.writeFileSync(path.join(root, 'a.mjs'), "import './b.mjs';\n// Saved but not committed.\n");
  const ir = path.join(scratch, 'input.json');
  // app -> lib is drawn; the code also imports lib -> app, which the diagram does not draw.
  const source = {
    schema_version: 1, diagram_type: 'architecture',
    meta: { title: 'Analysis browser regression', output: 'architecture.html', repository },
    components: [
      { id: 'app', type: 'backend', label: 'App', pos: [40, 40], size: [170, 64], sources: [{ path: 'a.mjs' }] },
      { id: 'lib', type: 'backend', label: 'Lib', pos: [320, 40], size: [170, 64] },
    ],
    connections: [{ from: 'app', to: 'lib' }],
  };
  const original = JSON.stringify(source);
  fs.writeFileSync(ir, original);
  const map = path.join(scratch, 'map.json');
  fs.writeFileSync(map, JSON.stringify({ app: ['a'], lib: ['b'] }));
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
  const load = async (url = view.url) => {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url });
    await loaded;
    await run('document.fonts.ready');
  };
  const render = (doc, name) => {
    const input = path.join(scratch, `${name}.json`);
    const output = path.join(scratch, `${name}.html`);
    fs.writeFileSync(input, JSON.stringify(doc));
    execFileSync(process.execPath, [cli, 'render', doc.diagram_type, input, output, '--repo-root', root]);
    return output;
  };
  await t.test('the offline diagnosis entry is gated, keyboard accessible, localized and absent from exports', async () => {
    const workflow = JSON.parse(fs.readFileSync(new URL('../archify/examples/agent-tool-call.workflow.json', import.meta.url), 'utf8'));
    workflow.meta.repository = repository;
    workflow.nodes[0].sources = [{ path: 'a.mjs' }];
    const unpinned = {
      ...source,
      meta: { title: source.meta.title, output: 'unpinned.html' },
      components: source.components.map(({ sources, ...component }) => component),
    };
    for (const file of [render(unpinned, 'unpinned'), render(workflow, 'workflow')]) {
      assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /<(?:button|dialog) id="code-analysis-/);
    }

    const key = async (key, windowsVirtualKeyCode) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode, text: key === 'Enter' ? '\r' : undefined });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode });
    };
    await send('Emulation.setDeviceMetricsOverride', { width: 375, height: 700, deviceScaleFactor: 1, mobile: true });
    const publicRepository = { url, revision: repository.revision };
    const localized = render({
      ...source, meta: { ...source.meta, locale: 'zh-CN', repository: publicRepository },
    }, 'localized');
    // The prompt targets the reader's own project, so a pinned public repository stays out of it.
    for (const [file, theme, label, title, prompt] of [
      [view.delivered, 'dark', 'Code Analysis', 'Architecture Diagnosis', 'Use Archify to create an architecture diagram for this project and start Architecture Diagnosis.'],
      [localized, 'light', '架构诊断', '架构诊断', '用 Archify 为当前项目生成架构图，并启动架构诊断'],
    ]) {
      const html = fs.readFileSync(file, 'utf8');
      assertOfflineArtifact(html, file);
      assert.ok(!html.includes(scratch), 'the local checkout path stays off the page');
      await load(`${pathToFileURL(file).href}?theme=${theme}`);
      await run("document.getElementById('btn-export').focus()");
      await key('ArrowLeft', 37);
      assert.deepEqual(await run("[document.activeElement.id, document.activeElement.textContent.trim()]"), ['code-analysis-info', label]);
      assert.ok(await run(`[...document.querySelectorAll('.toolbar > button, .toolbar #btn-export')].every(button => {
        const bounds = button.getBoundingClientRect();
        return bounds.left >= 0 && bounds.right <= innerWidth;
      })`), 'the toolbar fits the viewport');
      await key('Enter', 13);
      assert.deepEqual(await run(`(() => {
        const dialog = document.querySelector('dialog:modal');
        const rect = dialog.getBoundingClientRect();
        return [dialog.querySelector('h2').textContent, dialog.querySelectorAll('li').length, document.activeElement.className,
          rect.left >= 8 && rect.right <= innerWidth - 8 && rect.top >= 8 && rect.bottom <= innerHeight - 8,
          getComputedStyle(dialog).backgroundColor === getComputedStyle(document.querySelector('.diagram-container')).backgroundColor];
      })()`), [title, 4, 'analysis-info-close', true, true]);
      assert.equal(await run("document.querySelector('dialog:modal').innerText.includes(" + JSON.stringify(url) + ")"), false);
      await run("Object.defineProperty(navigator, 'clipboard', { value: { writeText: async text => { window.copiedPrompt = text; } } })");
      await key('Tab', 9);
      assert.equal(await run('document.activeElement.id'), 'code-analysis-copy');
      await key('Enter', 13);
      assert.equal(await run('window.copiedPrompt'), prompt);
      await key('Escape', 27);
      await wait("document.getElementById('code-analysis-info').getAttribute('aria-expanded') === 'false'");
      assert.equal(await run('document.activeElement.id'), 'code-analysis-info');
      await key('Enter', 13);
      assert.equal(await run("Boolean(document.querySelector('dialog:modal'))"), true);
      for (const type of ['mousePressed', 'mouseReleased']) {
        await send('Input.dispatchMouseEvent', { type, x: 2, y: 2, button: 'left', clickCount: 1 });
      }
      await wait("document.getElementById('code-analysis-info').getAttribute('aria-expanded') === 'false'");
      assert.equal(await run('document.activeElement.id'), 'code-analysis-info');
    }

    await key('Enter', 13);
    const svgSources = await run(`(async () => {
      const sources = [], createUrl = URL.createObjectURL;
      URL.createObjectURL = blob => {
        if (blob.type.startsWith('image/svg+xml')) sources.push(blob.text());
        return createUrl.call(URL, blob);
      };
      HTMLAnchorElement.prototype.click = () => {};
      await Archify.exportMenu.run('svg');
      await Archify.exportMenu.run('png');
      await Archify.motion.recordWebm({ duration: 350, fps: 10 });
      return Promise.all(sources);
    })()`);
    assert.equal(svgSources.length, 3, 'each export serialized a diagram SVG');
    for (const svg of svgSources) assert.doesNotMatch(svg, /code-analysis-|analysis-info-|analysis-entry|启动架构诊断/);
  });
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await load();
  assert.deepEqual(await run("[...document.querySelectorAll('.toolbar .analysis-entry')].map(button => button.id)"), ['code-analysis-start']);
  assert.equal(await run("document.getElementById('code-analysis-dialog')"), null);
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
  assert.deepEqual(await run("[...document.querySelectorAll('.toolbar .analysis-entry')].map(button => button.id)"), ['btn-bauify']);
  // The reader is a fly-out over the diagram: it starts closed, with the project overview as its home.
  assert.equal(await run("document.getElementById('bauify-overview').hidden"), false);
  assert.deepEqual(await run("[document.getElementById('bauify-reader').classList.contains('fly-closed'), document.getElementById('bauify-reader').inert, document.documentElement.hasAttribute('data-bauify-fly')]"), [true, true, false]);
  await wait("getComputedStyle(document.getElementById('bauify-reader')).visibility === 'hidden'");
  // Diagram rings and counts are sized in screen pixels, so a diagram fitted to a narrow column still shows them.
  const halo = await run(`(() => { const svg = document.querySelector('.diagram-container svg'), layer = document.getElementById('bauify-layer');
    const rings = [...layer.querySelectorAll(':scope > rect')], badges = [...layer.querySelectorAll('g.count')];
    const onScreen = svg.getBoundingClientRect().width / svg.viewBox.baseVal.width, k = Number(getComputedStyle(layer).getPropertyValue('--halo-k'));
    return { stroke: rings.every(r => getComputedStyle(r).vectorEffect === 'non-scaling-stroke'),
      glow: rings.filter(r => !r.classList.contains('grey')).every(r => getComputedStyle(r).filter.includes('drop-shadow')),
      glowScale: Math.abs(k * onScreen - 1) < 0.02,
      badges: badges.length, legible: badges.every(g => g.getBoundingClientRect().height >= 14),
      filled: badges.filter(g => g.classList.contains('top')).every(g => !g.classList.contains('blue')),
      legend: document.querySelectorAll('#bauify-overview .halo-legend i').length }; })()`);
  assert.deepEqual({ ...halo, badges: halo.badges > 0 }, { stroke: true, glow: true, glowScale: true, badges: true, legible: true, filled: true, legend: 3 }, 'rings keep a screen-pixel core and glow, counts stay legible and the overview explains ring weights');
  assert.equal(await run("document.getElementById('bauify-panel').hidden"), true);
  assert.equal(await run("document.querySelectorAll('#bauify-reader > section').length"), 4);
  assert.equal(await run("document.querySelectorAll('#bauify-reader > section').length === [...document.querySelectorAll('#bauify-overview,#bauify-panel,#bauify-detail,#bauify-code')].filter(e => e.parentElement.id === 'bauify-reader').length"), true);
  // The diagram card carries the page: the start-here card, the highlight controls and the code-dependency toggle.
  assert.deepEqual(await run(`(() => { const s = document.getElementById('bauify-stage'); return { inCanvas: s.parentElement === document.querySelector('.diagram-container'), rows: [...s.querySelectorAll('.first-row')].map(r => r.dataset.go), code: s.querySelector('.stage-code em').textContent, all: /All \\d+ findings/.test(s.querySelector('.first-all').textContent) }; })()`),
    { inCanvas: true, rows: ['component:app', 'code'], code: '1', all: true });
  // Drawn edges backed by imports get thicker; the undrawn one is a dashed arc that appears on request.
  assert.deepEqual(await run(`(() => { const p = document.querySelector('path[data-edge-from=app][data-edge-to=lib]'), arc = document.querySelector('#bauify-edges .bauify-undrawn');
    return { coded: p.classList.contains('bauify-coded'), width: parseFloat(getComputedStyle(p).strokeWidth) > 1.6, arc: arc.dataset.from + '>' + arc.dataset.to, hidden: getComputedStyle(arc).opacity === '0' }; })()`), { coded: true, width: true, arc: 'lib>app', hidden: true });
  await run("document.querySelector('#bauify-stage .stage-code').click()");
  await wait("getComputedStyle(document.querySelector('#bauify-edges .bauify-undrawn')).opacity !== '0'");
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-code')"), 'on');
  await run("document.querySelector('#bauify-stage [data-go=code]').click()");
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-fly')"), 'open');
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-pick')"), 'edge');
  assert.match(await run("document.querySelector('#bauify-panel h3').textContent"), /Lib → App/);
  assert.equal(await run("document.querySelector('#bauify-panel .fly-pill').textContent"), 'not drawn');
  assert.equal(await run("document.querySelector('#bauify-panel .fly-ev').dataset.file"), 'b.mjs');
  await run("document.querySelector('#bauify-panel .fly-ev').click()");
  assert.equal(await run("document.getElementById('bauify-code').hidden"), false);
  assert.match(await run("document.querySelector('#bauify-code .source-back').textContent"), /Dependency/);
  await run("document.querySelector('#bauify-code .source-back').click()");
  assert.equal(await run("document.activeElement.matches('#bauify-panel button.fly-ev')"), true);
  await run("document.querySelector('#bauify-panel .fly-ev').click()");
  await run("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))");
  assert.equal(await run("document.activeElement.matches('#bauify-panel button.fly-ev') && document.getElementById('bauify-code').hidden"), true);
  await run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  assert.deepEqual(await run("[document.documentElement.hasAttribute('data-bauify-fly'), document.documentElement.hasAttribute('data-bauify-pick')]"), [false, false], 'Esc closes the fly-out and clears the pick');
  await run("document.querySelector('#bauify-stage .stage-code').click()");
  // Beacon: components without open findings step back.
  await run("document.querySelector('#bauify-stage [data-beacon=issues]').click()");
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-beacon')"), 'on');
  await run("document.querySelector('#bauify-stage [data-beacon=all]').click()");
  assert.equal(await run("document.documentElement.hasAttribute('data-bauify-beacon')"), false);
  assert.equal(await run("parseFloat(getComputedStyle(document.querySelector('.diagram-container')).marginRight)"), 0, 'the diagram keeps the full width; the reader flies over it');
  assert.match(await run("document.querySelector('#bauify-overview .health-summary .attention').textContent"), /errors/);
  assert.match(await run("document.getElementById('bauify-overview').textContent"), /Checked: import cycles, module cycles, hub modules/);
  // a.mjs <-> b.mjs is both a file cycle and a module cycle: one structure, one priority slot.
  assert.equal(await run("document.querySelectorAll('#bauify-overview .bauify-item .n').length"), 1);
  await run("document.querySelector('#bauify-overview .priority-card .bauify-item').click()");
  assert.equal(await run("document.getElementById('bauify-detail').hidden"), false);
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-fly')"), 'open', 'opening a finding opens the fly-out');
  await wait(`(() => { const r = document.getElementById('bauify-reader').getBoundingClientRect(), c = document.querySelector('.diagram-container').getBoundingClientRect(); return r.right <= c.right - 11 && r.left > c.left && r.top >= c.top + 11; })()`);
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
  assert.deepEqual(await run("[document.getElementById('bauify-reader').classList.contains('fly-closed'), document.querySelector('#bauify-reader .reader-toggle').getAttribute('aria-expanded')]"), [true, 'false'], 'the close button folds the fly-out away');
  fs.writeFileSync(path.join(root, 'a.mjs'), '// edited after extraction\n');
  await run("document.querySelector('g[data-node-id=app]').dispatchEvent(new MouseEvent('click', { bubbles: true }))");
  assert.deepEqual(await run("[document.documentElement.getAttribute('data-bauify-fly'), document.documentElement.getAttribute('data-bauify-pick'), document.querySelector('#bauify-stage .stage-depth').hidden, document.querySelector('#bauify-stage .depth-label').textContent]"), ['open', 'node', false, 'Focus App'], 'a node click opens its panel and focuses its neighbourhood');
  assert.deepEqual(await run("[...document.querySelectorAll('#bauify-panel .fly-nums span')].map(s => s.textContent)"), ['files', 'lines', 'open']);
  assert.match(await run("document.querySelector('#bauify-panel .fly-rel[data-edge=\"lib>app\"]').textContent"), /not drawn/);
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

  // The diagram comes first; tabs above it page to the Atlas or Atlas 3D in place. No toggle sits in the reading column.
  assert.equal(await run("!!document.querySelector('.reader-atlas, .atlas-classic')"), false, 'no switch between the diagram and the Atlas');
  assert.deepEqual(await run("Array.from(document.querySelectorAll('#bauify-views .views-option'), b => [b.dataset.view, b.getAttribute('aria-pressed')])"), [['diagram', 'true'], ['atlas', 'false'], ['atlas3d', 'false']], 'the diagram tab starts selected');
  assert.equal(await run("document.getElementById('bauify-views').getBoundingClientRect().bottom <= document.querySelector('.diagram-container').getBoundingClientRect().top"), true, 'the tabs sit above the diagram');
  assert.equal(await run("typeof window.THREE"), 'undefined', 'three.js stays inert until Atlas 3D opens');
  await run("if (document.documentElement.getAttribute('data-theme') !== 'light') Archify.theme.toggle()");
  await run("document.querySelector('.views-option[data-view=atlas]').click()");
  // In place of the diagram, full width with the summary column hidden, on the dark page theme.
  assert.deepEqual(await run(`(() => { const a = document.getElementById('bauify-atlas'), r = document.getElementById('bauify-reader');
    return [document.documentElement.getAttribute('data-theme'), getComputedStyle(a).position, getComputedStyle(r).display, getComputedStyle(document.querySelector('.diagram-container')).display, getComputedStyle(a).backgroundColor === getComputedStyle(document.body).backgroundColor]; })()`),
    ['dark', 'relative', 'none', 'none', true], 'choosing the Atlas switches the page to dark, replaces the diagram and hides the summary column');
  const atlas = JSON.parse(await run("document.getElementById('bauify-atlas-data').textContent"));
  await until(`document.documentElement.getAttribute('data-bauify-atlas-drawn') === '${atlas.edges.length}'`, 'atlas did not draw');
  assert.ok(atlas.edges.length > 0 && atlas.functions.length > 0, 'the fixture has dependencies and functions to draw');
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-animating')"), 'true', 'the opening reveal runs');
  await until("!document.documentElement.hasAttribute('data-bauify-atlas-animating')", 'the opening reveal did not finish');
  // The circle is painted: a good share of pixels in its bounding square are not transparent.
  const painted = await run(`(() => { const c = document.querySelector('#bauify-atlas canvas'), x = c.getContext('2d');
    const s = Math.min(c.width, c.height), d = x.getImageData((c.width - s) / 2, (c.height - s) / 2, s, s).data; let n = 0;
    for (let i = 3; i < d.length; i += 4 * 7) if (d[i]) n++; return n; })()`);
  assert.ok(painted > 500, `atlas canvas is painted (${painted} sampled pixels)`);

  // Observe the actual Canvas strokes, rather than exposing animation internals
  // or freezing a particular radius. Module arcs are the non-full-circle strokes.
  await run(`(() => {
    window.atlasArcs = []; window.atlasDots = []; window.atlasSegments = [];
    const proto = CanvasRenderingContext2D.prototype;
    const clear = proto.clearRect, arc = proto.arc, begin = proto.beginPath, stroke = proto.stroke, fill = proto.fill, move = proto.moveTo, line = proto.lineTo;
    const strokeAlpha = style => { const parts = String(style).split(','), alpha = parts.length === 4 ? Number.parseFloat(parts[3]) : 1; return Number.isFinite(alpha) ? alpha : 1; };
    proto.clearRect = function (...args) { if (!this.canvas.isConnected) { window.atlasArcs = []; window.atlasDots = []; window.atlasSegments = []; } return clear.apply(this, args); };
    proto.beginPath = function (...args) { this.testArc = null; this.testDot = null; this.testSegment = null; return begin.apply(this, args); };
    proto.arc = function (x, y, r, start, end, ...rest) {
      if (end - start < Math.PI * 2 - 0.001) this.testArc = { x, y, r, start, end };
      if (r === 3 || r === 5) this.testDot = { x, y };
      return arc.call(this, x, y, r, start, end, ...rest);
    };
    proto.moveTo = function (x, y) { this.testStart = { x, y }; return move.call(this, x, y); };
    proto.lineTo = function (x, y) { if (this.testStart) this.testSegment = { x: (x + this.testStart.x) / 2, y: (y + this.testStart.y) / 2, end: { x, y } }; return line.call(this, x, y); };
    proto.stroke = function (...args) {
      if (this.testSegment && !this.canvas.isConnected) window.atlasSegments.push(this.testSegment);
      if (this.testArc && !this.canvas.isConnected) window.atlasArcs.push({ ...this.testArc, alpha: this.globalAlpha * strokeAlpha(this.strokeStyle) });
      return stroke.apply(this, args);
    };
    proto.fill = function (...args) { if (this.testDot && !this.canvas.isConnected) window.atlasDots.push(this.testDot); return fill.apply(this, args); };
    window.__archifyAtlas.focusFinding('');
  })()`);
  await until(`window.atlasArcs.length === ${atlas.modules.length}`, 'module strokes not captured');
  const resting = await run('window.atlasArcs');
  const width = arc => arc.end - arc.start;
  const wheel = (deltaY, ctrlKey = false) => run(`(() => { const e = new WheelEvent('wheel', {deltaY:${deltaY},ctrlKey:${ctrlKey},cancelable:true}); document.querySelector('#bauify-atlas canvas').dispatchEvent(e); return e.defaultPrevented; })()`);
  const clickPoint = point => run(`(() => { const c = document.querySelector('#bauify-atlas canvas'), b = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('click', { clientX: b.left + ${point.x}, clientY: b.top + ${point.y} })); })()`);
  assert.equal(await wheel(-180), false, 'overview leaves page scrolling available');

  // Below a diagram the Atlas is a page: totals float on the map, and the panel stays closed until something is selected.
  assert.deepEqual(await run("Array.from(document.querySelectorAll('#bauify-atlas .atlas-stats .stats b'), b => b.textContent)"), [atlas.files.length, atlas.edges.length, atlas.functions.length, atlas.modules.length].map(n => n.toLocaleString('en-US')));
  assert.deepEqual(await run("Array.from(document.querySelectorAll('#bauify-atlas .atlas-stats .stat span'), s => s.textContent)"), ['files', 'file dependencies', 'functions', 'modules'], 'each total is labelled');
  assert.deepEqual(await run("[document.getElementById('bauify-atlas').classList.contains('atlas-page'), document.getElementById('bauify-atlas').getAttribute('data-fly'), getComputedStyle(document.querySelector('#bauify-atlas .atlas-side')).visibility, document.querySelector('#bauify-atlas .atlas-focus').hidden]"), [true, 'closed', 'hidden', true], 'the panel opens only for a selection');
  assert.ok(await run("document.querySelectorAll('#bauify-atlas .atlas-first .atlas-lead').length") >= 2, 'the start card names where to look first');
  assert.equal(await run("document.querySelector('#bauify-atlas .hist') !== null"), true, 'complexity distribution stays visible');
  assert.equal(await run("document.querySelector('#bauify-atlas .module-list [data-module]') !== null"), true, 'coupled modules stay visible');
  assert.equal(await run("document.querySelector('#bauify-atlas .atlas-expand').textContent"), 'Disable sector zoom');
  // A module from the side panel becomes the focus; the panel names it.
  await run("document.querySelector('#bauify-atlas [data-module]').click()");
  const focused = await run("document.documentElement.getAttribute('data-bauify-atlas-focus')");
  assert.ok(atlas.modules.some(m => m.id === focused), 'a module is focused');
  assert.match(await run("document.querySelector('#bauify-atlas .selected h4').textContent"), new RegExp(atlas.modules.find(m => m.id === focused).label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.deepEqual(await run("[document.getElementById('bauify-atlas').getAttribute('data-fly'), getComputedStyle(document.querySelector('#bauify-atlas .atlas-side')).visibility, document.querySelector('#bauify-atlas .atlas-focus').hidden]"), ['module', 'visible', false], 'a module opens the panel and the focus pill');

  await until("!document.documentElement.hasAttribute('data-bauify-atlas-animating')", 'focus did not settle');
  const first = atlas.modules.findIndex(m => m.id === focused), second = first === 0 ? 1 : 0;
  const expanded = await run('window.atlasArcs');
  assert.ok(expanded[first].r > resting[first].r, 'selected module moves out');
  assert.equal(expanded[second].r, resting[second].r, 'background module stays in place');
  assert.ok(expanded[second].alpha < expanded[first].alpha, 'background module dims: ' + JSON.stringify({ selected: expanded[first], background: expanded[second] }));
  // Sample both arcs within the SAME page task so protocol latency cannot
  // turn a correct intermediate frame into a flaky endpoint assertion.
  const switching = await run(`new Promise(resolve => {
    document.querySelector('#bauify-atlas [data-module="${second}"]').click();
    const sample = () => {
      const a = window.atlasArcs;
      if (a[${first}].r < ${expanded[first].r} && a[${second}].r > ${resting[second].r}) return resolve(a);
      requestAnimationFrame(sample);
    }; requestAnimationFrame(sample);
  })`);
  assert.ok(switching[first].r > resting[first].r, 'old module retracts instead of snapping back');
  assert.ok(switching[second].r < expanded[first].r, 'new module expands while the old one retracts');
  // Interrupt the transition, then cancel it; all modules must return home.
  await run(`document.querySelector('#bauify-atlas [data-module="${first}"]').click(); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await until("!document.documentElement.hasAttribute('data-bauify-atlas-animating')", 'cancel did not settle');
  assert.deepEqual(await run('window.atlasArcs'), resting, 'cancel restores geometry and opacity');

  // Hit testing must follow expanded geometry, including with reduced motion.
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await run(`document.querySelector('#bauify-atlas [data-module="${second}"]').click()`);
  assert.equal(await run("document.documentElement.hasAttribute('data-bauify-atlas-animating')"), false);
  await run(`(() => {
    const a = window.atlasArcs[${second}], angle = (a.start + a.end) / 2;
    const canvas = document.querySelector('#bauify-atlas canvas'), b = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent('click', { clientX: b.left + a.x + a.r * Math.cos(angle), clientY: b.top + a.y + a.r * Math.sin(angle) }));
  })()`);
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-focus')"), '', 'clicking the expanded arc clears that module');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });

  // Search finds modules, files and functions; Enter opens the first match, Esc closes the panel.
  const wanted = atlas.modules[first].label;
  await run(`(() => { const q = document.querySelector('#bauify-atlas .atlas-q'); q.focus(); q.value = ${JSON.stringify(wanted)}; q.dispatchEvent(new Event('input')); })()`);
  assert.ok(await run("document.querySelectorAll('#atlas-sug [role=option]').length") > 0, 'search lists matches');
  await run("document.querySelector('#bauify-atlas .atlas-q').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
  const found = await run("document.documentElement.getAttribute('data-bauify-atlas-focus')");
  assert.ok(atlas.modules.some(m => m.id === found && m.label.includes(wanted)), 'Enter selects the first match');
  await run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))");
  assert.deepEqual(await run("[document.documentElement.getAttribute('data-bauify-atlas-focus'), document.getElementById('bauify-atlas').getAttribute('data-fly')]"), ['', 'closed']);
  await until("!document.documentElement.hasAttribute('data-bauify-atlas-animating')", 'search escape did not settle');

  // Expansion is a reading context: inspecting a spike must not collapse it.
  const inspected = atlas.findings.findIndex(f => f.kind === 'function');
  const inspectedFn = atlas.functions[atlas.findings[inspected].fn];
  const inspectedModule = atlas.files[inspectedFn[0]][1];
  await run(`document.querySelector('#bauify-atlas [data-module="${inspectedModule}"]').click()`);
  await until("!document.documentElement.hasAttribute('data-bauify-atlas-animating')", 'inspection focus did not settle');
  const inspectionRadius = (await run('window.atlasArcs'))[inspectedModule].r;
  const clickSpike = async (fn, points = 'atlasDots') => run(`(() => {
    const c = document.querySelector('#bauify-atlas canvas'), b = c.getBoundingClientRect();
    for (const dot of window[${JSON.stringify(points)}]) {
      const pos = { clientX: b.left + dot.x, clientY: b.top + dot.y };
      c.dispatchEvent(new MouseEvent('mousemove', pos));
      const tip = document.querySelector('#bauify-atlas .atlas-tip');
      if (!tip.hidden && tip.textContent.includes(${JSON.stringify(fn[1])}) && tip.textContent.includes(${JSON.stringify(atlas.files[fn[0]][0])})) {
        c.dispatchEvent(new MouseEvent('click', pos)); return true;
      }
    }
    return false;
  })()`);
  const clicked = await clickSpike(inspectedFn);
  assert.equal(clicked, true, 'a rendered spike opens its finding');
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-finding')"), atlas.findings[inspected].id);
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-focus')"), atlas.modules[inspectedModule].id, 'spike inspection retains the expanded module');
  await until("!document.documentElement.hasAttribute('data-bauify-atlas-animating')", 'inspection did not settle');
  assert.equal((await run('window.atlasArcs'))[inspectedModule].r, inspectionRadius);
  await run(`document.querySelector('#bauify-atlas [data-finding="${inspected}"]').click()`);
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-focus')"), atlas.modules[inspectedModule].id, 'clearing a finding retains the reading context');
  const otherModule = inspectedModule === 0 ? 1 : 0;
  await run(`document.querySelector('#bauify-atlas [data-module="${otherModule}"]').click()`);
  await until("!document.documentElement.hasAttribute('data-bauify-atlas-animating')", 'other module did not settle');
  assert.equal(await clickSpike(inspectedFn), true, 'background spike is clickable');
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-focus')"), atlas.modules[inspectedModule].id, 'background spike switches to its owning module');
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-finding')"), atlas.findings[inspected].id);
  // Sidebar selection has the same ownership rule, without requiring a canvas click.
  await run(`document.querySelector('#bauify-atlas [data-module="${otherModule}"]').click(); document.querySelector('#bauify-atlas [data-finding="${inspected}"]').click()`);
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-focus')"), atlas.modules[inspectedModule].id);
  await until("!document.documentElement.hasAttribute('data-bauify-atlas-animating')", 'sidebar selection did not settle');
  const unreported = atlas.functions.find(fn => fn[6] === -1 && atlas.files[fn[0]][1] === inspectedModule);
  assert.ok(unreported, 'fixture includes an unreported function');
  assert.equal(await clickSpike(unreported, 'atlasSegments'), true, 'unreported spike body is clickable');
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-focus')"), atlas.modules[inspectedModule].id);
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-finding')"), '', 'unreported function clears stale finding');
  // Resize and theme changes repaint the hit geometry without losing context.
  const oldCenter = (await run('window.atlasArcs'))[inspectedModule].x;
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 760, deviceScaleFactor: 1, mobile: false });
  await run("document.documentElement.setAttribute('data-theme', 'light')");
  await until(`window.atlasArcs[${inspectedModule}].x !== ${oldCenter}`, 'resize did not repaint the atlas');
  assert.equal(await clickSpike(inspectedFn), true, 'resized spike remains clickable');
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-focus')"), atlas.modules[inspectedModule].id);
  await until("!document.documentElement.hasAttribute('data-bauify-atlas-animating')", 'resized inspection did not settle');
  // True blank space clears both states, rather than hitting an invisible arc band.
  await run(`(() => { const c = document.querySelector('#bauify-atlas canvas'), b = c.getBoundingClientRect(); c.dispatchEvent(new MouseEvent('click', { clientX: b.left + 5, clientY: b.top + 5 })); })()`);
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-focus')"), '');
  await run("document.querySelector('#bauify-atlas .atlas-clear').click()");
  await until("!document.documentElement.hasAttribute('data-bauify-atlas-animating')", 'inspection clear did not settle');

  // A selected import cycle gets a light that travels around it: the canvas keeps changing.
  const canvasSum = "(() => { const c = document.querySelector('#bauify-atlas canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < d.length; i += 16) n += d[i] + d[i + 1] + d[i + 2] + d[i + 3]; return n; })()";
  const cycle = atlas.findings.findIndex(f => f.kind === 'cycle');
  assert.notEqual(cycle, -1, 'the fixture reports an import cycle');
  await run(`document.querySelector('#bauify-atlas [data-module="${inspectedModule}"]').click(); document.querySelector('#bauify-atlas [data-finding="${cycle}"]').click()`);
  const cycleModules = [...new Set(atlas.findings[cycle].files.map(i => atlas.files[i][1]))];
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-focus')"), cycleModules.length === 1 ? atlas.modules[cycleModules[0]].id : '', 'multi-module findings use the overview');
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
  await until("!document.documentElement.hasAttribute('data-bauify-atlas-animating')", 'function focus did not settle');
  const owner = atlas.modules[atlas.files[atlas.functions[atlas.findings[complex].fn][0]][1]].id;
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-focus')"), owner, 'finding uses the current module selection');
  assert.equal(await wheel(-120), true);
  await until("!document.documentElement.hasAttribute('data-bauify-atlas-animating')", 'function zoom did not settle');
  const dottedFunctions = atlas.functions.map((fn, i) => fn[6] >= 0 && (!atlas.findings[fn[6]].accepted || atlas.findings[fn[6]].severity === 'error') ? i : -1).filter(i => i >= 0);
  const dot = (await run('atlasDots'))[dottedFunctions.indexOf(atlas.findings[complex].fn)];
  const body = (await run('atlasSegments')).find(segment => Math.hypot(segment.end.x - dot.x, segment.end.y - dot.y) < .01);
  assert.ok(body, 'the rendered function segment is observed');
  for (const point of [dot, body]) {
    await clickPoint(point);
    assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-finding')"), atlas.findings[complex].id, 'tip and body retain the selected function after zoom');
    assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-focus')"), owner);
  }
  // Esc steps back from a finding to its module; selecting the finding again shows its panel.
  await run("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))");
  assert.deepEqual(await run("[document.documentElement.getAttribute('data-bauify-atlas-finding'), document.documentElement.getAttribute('data-bauify-atlas-focus'), document.getElementById('bauify-atlas').getAttribute('data-fly')]"), ['', owner, 'module']);
  await run(`document.querySelector('#bauify-atlas [data-finding="${complex}"]').click()`);
  assert.equal(await run("document.getElementById('bauify-atlas').getAttribute('data-fly')"), 'finding');
  // Evidence pages back to the diagram and opens in the summary column.
  await run("document.querySelector('#bauify-atlas .atlas-evidence').click()");
  await until("!document.getElementById('bauify-detail').hidden", 'finding did not open in the reading column');
  assert.match(await run("document.querySelector('#bauify-detail h3').textContent"), /is complex/);
  assert.ok(await run("!!document.querySelector('#bauify-detail pre')"), 'the reading column shows the source excerpt');
  assert.deepEqual(await run("[document.getElementById('bauify-atlas').hidden, document.documentElement.getAttribute('data-bauify-views'), getComputedStyle(document.getElementById('bauify-reader')).display !== 'none']"), [true, null, true], 'evidence shows beside the diagram');

  await run("document.querySelector('#bauify-detail .inline-evidence .ref').click()");
  assert.match(await run("document.querySelector('#bauify-code .source-back').textContent"), /Finding/);
  await run("document.querySelector('#bauify-code .source-back').click()");
  assert.equal(await run("document.activeElement.matches('#bauify-detail .inline-evidence .ref')"), true);
  assert.match(await run("document.querySelector('#bauify-detail .back').textContent"), /Atlas/);
  await run("document.querySelector('#bauify-detail .back').click()");
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-finding')"), atlas.findings[complex].id);
  await until("!document.getElementById('bauify-atlas').hidden && document.activeElement.matches('.atlas-evidence')", 'Atlas evidence did not regain focus');
  await until("document.querySelector('#bauify-atlas canvas').width > 0", 'Atlas did not reopen after evidence');

  // The Atlas 3D tab shows the same run in the same place, every item accounted for.
  const hasWebGl = await run(`(() => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    context?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(context);
  })()`);
  await run("document.querySelector('.views-option[data-view=atlas3d]').click()");
  assert.deepEqual(await run("[document.getElementById('bauify-atlas').hidden, document.getElementById('bauify-atlas3d').hidden, document.documentElement.getAttribute('data-bauify-views')]"),
    [true, false, 'atlas3d'], 'Atlas 3D replaces the Atlas below the diagram');
  if (hasWebGl) {
    assert.equal(await run("typeof window.THREE"), 'object', 'three.js loads on first open');
    await until(`document.documentElement.getAttribute('data-bauify-atlas3d-drawn') === '${atlas.functions.length}'`, 'Atlas 3D did not draw');
    assert.deepEqual(await run("[window.__archifyAtlas3d.view.consistent, window.__archifyAtlas3d.view.counts.files]"), [true, atlas.files.length], 'every file, function and finding of the run is in the model');
  } else {
    assert.equal(await run("typeof window.THREE"), 'undefined', 'three.js stays inert without WebGL');
    assert.match(await run("document.querySelector('#bauify-atlas3d .a3d-fallback')?.textContent || ''"), /WebGL/, 'without WebGL the view says so');
  }
  // The diagram tab pages back to the diagram.
  await run("document.querySelector('.views-option[data-view=diagram]').click()");
  assert.deepEqual(await run("[document.getElementById('bauify-atlas3d').hidden, document.documentElement.getAttribute('data-bauify-views'), getComputedStyle(document.querySelector('.diagram-container')).display !== 'none', Array.from(document.querySelectorAll('.views-option'), b => b.getAttribute('aria-pressed'))]"),
    [true, null, true, ['true', 'false', 'false']], 'the diagram tab shows the diagram again');

  // Turning Code Analysis off hides the options and closes whatever was open.
  await run("document.querySelector('.views-option[data-view=atlas]').click()");
  assert.equal(await run("document.getElementById('bauify-atlas').hidden"), false);
  await run("document.getElementById('btn-bauify').click()");
  await until("document.getElementById('bauify-atlas').hidden && document.getElementById('bauify-views').hidden", 'the views stayed open after Code Analysis was turned off');
  assert.equal(await run("document.documentElement.getAttribute('data-bauify-views')"), null);
});

test('Code Analysis Atlas keeps complexity spike lengths when a focused module is constrained', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run Code Analysis browser coverage.',
}, async t => {
  const { buildGraph } = await import('../archify/modules/code-analysis/lib/analysis.mjs');
  const { buildOverlay } = await import('../archify/modules/code-analysis/overlay/inject.mjs');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-atlas-spike-scale-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const modulePath = 'extremely_long_module_name_for_constrained_labels';
  const file = `${modulePath}/scales.ts`;
  const repository = { revision: null, baseRevision: null, sourceKind: 'working-tree', root: '.',
    url: null, language: 'ts', adapter: 'typescript@5.9.3', adapterRevision: 22, snapshotId: 'd'.repeat(64) };
  const functions = [
    { file, name: 'complex_23', qualname: 'complex_23', line: 1, endLine: 20, complexity: 23, nesting: 3, deepestLine: 5 },
    { file, name: 'complex_26', qualname: 'complex_26', line: 30, endLine: 55, complexity: 26, nesting: 4, deepestLine: 35 },
  ];
  const facts = { schema_version: 1, repository, files: [{ path: file, loc: 55, role: 'source', sourceText: 'export const scale = true;\n' }],
    packageMarkers: [], imports: [], symbols: [], calls: [], functions, unresolved: { external: 0, outside: 0, unknown: 0, opaque: 0 } };
  const graph = buildGraph(facts, { modules: { groups: { [modulePath]: ['**'] }, excludeRoles: [] } });
  const diagnostics = functions.map(fn => ({
    id: `CX-${fn.complexity}`, code: 'complexity/function', dimension: 'complexity', severity: 'warning', confidence: 1,
    message: `${fn.name} is complex.`, subject: { file, function: fn.qualname, line: fn.line, endLine: fn.endLine },
    evidence: { complexity: fn.complexity, nesting: fn.nesting, length: fn.endLine - fn.line + 1 }, supportedFixes: [],
  }));
  const { html } = buildOverlay({ ir: null, graph, facts, findings: diagnostics, sourceRoot: scratch,
    run: { rules: ['complexity/function'], openAnalysis: true } });
  const htmlPath = path.join(scratch, 'atlas-scale.html');
  fs.writeFileSync(htmlPath, html);

  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async expression => {
    const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(response.exceptionDetails, undefined, response.exceptionDetails?.exception?.description);
    return response.result?.value;
  };
  const until = (condition, what) => run(`new Promise((resolve, reject) => { const deadline = Date.now() + 10000; const poll = () => {
    if (${condition}) return resolve(true);
    if (Date.now() > deadline) return reject(new Error(${JSON.stringify(what)}));
    setTimeout(poll, 25);
  }; poll(); })`);
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 800, deviceScaleFactor: 1, mobile: false });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(htmlPath).href });
  await loaded;
  await run('document.fonts.ready');
  await until("document.documentElement.getAttribute('data-bauify') === 'on'", 'analysis did not open');
  await until("!document.getElementById('bauify-atlas').hidden", 'atlas did not open');
  await until("!document.documentElement.hasAttribute('data-bauify-atlas-animating')", 'the opening reveal did not finish');

  await run(`(() => {
    window.atlasDots = []; window.atlasSegments = [];
    const proto = CanvasRenderingContext2D.prototype;
    const clear = proto.clearRect, arc = proto.arc, begin = proto.beginPath, stroke = proto.stroke, fill = proto.fill, move = proto.moveTo, line = proto.lineTo;
    proto.clearRect = function (...args) { if (!this.canvas.isConnected) { window.atlasDots = []; window.atlasSegments = []; } return clear.apply(this, args); };
    proto.beginPath = function (...args) { this.testDot = null; this.testSegment = null; return begin.apply(this, args); };
    proto.arc = function (x, y, r, start, end, ...rest) { if (r === 3 || r === 5) this.testDot = { x, y }; return arc.call(this, x, y, r, start, end, ...rest); };
    proto.moveTo = function (x, y) { this.testStart = { x, y }; return move.call(this, x, y); };
    proto.lineTo = function (x, y) { if (this.testStart) this.testSegment = { start: this.testStart, end: { x, y } }; return line.call(this, x, y); };
    proto.stroke = function (...args) { if (this.testSegment && !this.canvas.isConnected) window.atlasSegments.push(this.testSegment); return stroke.apply(this, args); };
    proto.fill = function (...args) { if (this.testDot && !this.canvas.isConnected) window.atlasDots.push(this.testDot); return fill.apply(this, args); };
    document.getElementById('btn-theme').click();
  })()`);
  await until("window.atlasDots.length === 2", 'reported function tips were not captured');
  await run("document.querySelector('#bauify-atlas [data-module=\"0\"]').click()");
  await until("!document.documentElement.hasAttribute('data-bauify-atlas-animating')", 'module focus did not settle');

  const lengths = await run(`(() => {
    const segments = window.atlasSegments;
    return window.atlasDots.map(dot => {
      const body = segments.find(segment => Math.hypot(segment.end.x - dot.x, segment.end.y - dot.y) < 0.01);
      return body && Math.hypot(body.end.x - body.start.x, body.end.y - body.start.y);
    }).sort((a, b) => a - b);
  })()`);
  assert.ok(lengths.every(length => length > 0), `both spike bodies are drawn: ${JSON.stringify(lengths)}`);
  const encoded = complexity => 0.06 + 0.94 * Math.min(complexity, 26) / 26;
  const expectedRatio = encoded(23) / encoded(26);
  assert.ok(Math.abs(lengths[0] / lengths[1] - expectedRatio) < 0.01,
    `focused spikes retain their complexity ratio (${JSON.stringify({ lengths, expectedRatio })})`);
});
