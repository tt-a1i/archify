import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
import { buildOverlay } from '../archify/modules/code-analysis/overlay/inject.mjs';

const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));

test('prepared workbench localizes, copies first-screen evidence, keeps comparison honest and preserves narrow canvas access', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run the real-browser workbench contract.',
}, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-workbench-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'repo'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'a.ts'), "import { b } from './b'; export function a(x: boolean) { return x ? b() : 1; }\n");
  fs.writeFileSync(path.join(root, 'b.ts'), "import { a } from './a'; export function b() { return a(false); }\n");
  const config = path.join(dir, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ rules: { complexity: { function: { warning: { complexity: 0 } } } } }));
  const irPath = path.join(dir, 'architecture.json');
  const ir = { schema_version: 1, diagram_type: 'architecture', meta: { title: 'Source evidence', output: 'architecture.html', locale: 'en' },
    components: [{ id: 'app', type: 'backend', label: 'App', pos: [40, 40], size: [170, 64] }], connections: [] };
  const out = path.join(dir, 'out');
  const prepare = locale => {
    ir.meta.locale = locale; fs.writeFileSync(irPath, JSON.stringify(ir));
    const prepared = spawnSync(process.execPath, [cli, 'code-analysis', 'prepare', root, '--ir', irPath, '--out', out, '--language', 'ts', '--config', config], { encoding: 'utf8' });
    assert.equal(prepared.status, 0, prepared.stdout + prepared.stderr);
    return JSON.parse(prepared.stdout);
  };
  const first = prepare('en');
  assert.equal(first.status, 'ok');
  assert.match(first.resume.command, / start /);
  assert.ok(fs.existsSync(first.html));
  assert.ok(!fs.readFileSync(first.diagram, 'utf8').includes('id="bauify-analysis"'), 'the original diagram is not overlaid');

  const browser = new ChromeVisualBrowser(chrome); t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  };
  const open = async file => {
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(file).href }); await loaded;
    await run('document.fonts.ready');
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await open(first.html);
  assert.equal(await run("document.documentElement.getAttribute('data-bauify')"), 'on', 'prepare opens on the workbench without a second click');
  assert.equal(await run("document.querySelector('#bauify-overview h3').textContent"), 'Architecture check');
  assert.match(await run("document.querySelector('.health-summary').textContent"), /error-level diagnostics still present/);
  assert.equal(await run("document.querySelectorAll('.priority-card button button').length"), 0);
  assert.ok(await run("document.querySelector('.priority-card .quick-copy').getBoundingClientRect().bottom < innerHeight"), 'first task copy is visible without opening details');
  // Observe the clipboard adapter independently of browser-owned permissions.
  await run("Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copied = value; } } })");
  await run("document.querySelector('.priority-card .quick-copy').click()");
  const copied = await run(`new Promise((resolve,reject) => { const deadline=Date.now()+3000; const poll=()=>window.__copied?resolve(window.__copied):Date.now()>deadline?reject(new Error('first-card copy did not finish')):setTimeout(poll,20);poll();})`);
  assert.equal(copied, await run("(() => { const data=JSON.parse(document.getElementById('bauify-analysis').textContent);return data.tasks[data.overview.priorities[0]].markdown;})()"));
  assert.match(await run("document.querySelector('.priority-card .handoff-status').textContent"), /Snapshot only/);
  await run("window.__copied='';document.querySelector('.brief-copy').click()");
  assert.equal(await run('window.__copied'), await run("JSON.parse(document.getElementById('bauify-analysis').textContent).architectureBrief"));
  assert.match(await run('window.__copied'), /does not determine runtime dispatch/);

  // An HTTP refusal is not a reason to silently hand out an older offline task.
  await run("window.__archifyBuildTask=async()=>{throw Object.assign(new Error('claim changed'),{status:409});};window.__copied='';document.querySelector('.priority-card .quick-copy').click()");
  await run("new Promise((resolve,reject)=>{const deadline=Date.now()+3000;const poll=()=>document.querySelector('.priority-card .handoff-status').textContent.includes('claim changed')?resolve():Date.now()>deadline?reject(new Error('HTTP rejection was not reported')):setTimeout(poll,20);poll();})");
  assert.equal(await run('window.__copied'), '');
  assert.match(await run("document.querySelector('.priority-card .handoff-status').textContent"), /claim changed/);

  // Prepare a real source improvement and compare through the same saved-run path.
  fs.writeFileSync(path.join(root, 'b.ts'), 'export function b() { return 1; }\n');
  const second = prepare('zh-CN');
  await open(second.html);
  assert.equal(await run("document.getElementById('btn-bauify').textContent"), '架构诊断');
  assert.equal(await run("document.querySelector('#bauify-reader').lang"), 'zh-CN');
  assert.equal(await run("document.querySelector('.quick-copy').textContent"), '复制任务给 AI');
  const sourceComparison = JSON.parse(fs.readFileSync(path.join(out, 'analysis', 'review.json'))).comparison;
  assert.ok(sourceComparison.notDetected.length > 0);
  assert.ok((await run("document.querySelector('.comparison-banner').textContent")).includes(`本轮未再检出 ${sourceComparison.notDetected.length} 项 · 新增 ${sourceComparison.new.length} 项`));
  assert.match(await run("document.querySelector('.comparison-banner').textContent"), /不代表已证实修复/);
  assert.match(await run("document.querySelector('.health-summary').textContent"), /没有错误级发现/);
  await run("document.querySelector('.browse-findings').click();const search=document.querySelector('.finding-search');search.value='复杂';search.dispatchEvent(new Event('input'));");
  assert.ok(await run("document.querySelectorAll('.finding-list [data-finding]').length > 0"), 'Chinese search matches the visible localized title');
  await run("document.querySelector('.findings-back').click()");
  await run("document.querySelector('.priority-card [data-finding]').click()");
  assert.equal(await run("document.querySelector('#bauify-detail .quick-copy').textContent"), '复制任务给 AI');
  assert.match(await run("document.querySelector('#bauify-detail').textContent"), /源码证据/);
  await run("document.querySelector('#bauify-detail .back').click();document.querySelector('.reader-atlas').click()");
  assert.equal(await run("document.querySelector('.atlas-classic').textContent"), '架构图视图');
  assert.match(await run("document.querySelector('.atlas-side').textContent"), /文件依赖/);
  await run("document.querySelector('.atlas-classic').click()");
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const narrow = await run(`(() => { const r=document.getElementById('bauify-reader').getBoundingClientRect(),d=document.querySelector('.diagram-container').getBoundingClientRect(); return { width:innerWidth, readerWidth:r.width, separate:d.top>=r.bottom, overflow:document.documentElement.scrollWidth>innerWidth }; })()`);
  assert.equal(narrow.width, 390);
  assert.ok(narrow.readerWidth <= 390);
  assert.equal(narrow.separate, true, 'the narrow reader is in flow above the canvas');
  assert.equal(narrow.overflow, false);

  // Non-comparable history stays visible without a success colour or fixed claim.
  const read = file => JSON.parse(fs.readFileSync(path.join(out, 'analysis', file)));
  const findings = read('findings.json'), review = read('review.json');
  review.comparison.comparable = false;
  review.comparison.reasons = ['Analysis configuration changed.'];
  const overlay = buildOverlay({ ir, graph: read('module-graph.json'), facts: read('raw-facts.json'), findings: findings.diagnostics, findingsDocument: findings,
    html: fs.readFileSync(second.diagram, 'utf8'), sourceRoot: root, run: { openAnalysis: true, rules: findings.rules, review } });
  const different = path.join(dir, 'different.html'); fs.writeFileSync(different, overlay.html);
  await open(different);
  assert.match(await run("document.querySelector('.comparison-banner').textContent"), /不能直接比较/);
  assert.equal(await run("document.querySelector('.comparison-banner').classList.contains('positive')"), false);
  const fallback = prepare('fr');
  await open(fallback.html);
  assert.equal(await run("document.getElementById('btn-bauify').textContent"), 'Code Analysis');
  assert.equal(await run("document.querySelector('#bauify-reader').lang"), 'en');
});
