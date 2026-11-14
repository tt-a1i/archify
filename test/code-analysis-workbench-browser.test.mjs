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
  const root = path.join(dir, 'repo');
  fs.mkdirSync(path.join(root, 'src/alpha'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/beta'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/alpha/a.ts'), "import { b } from '../beta/b'; export function a(x: boolean) { return x ? b() : 1; }\n");
  fs.writeFileSync(path.join(root, 'src/beta/b.ts'), "import { a } from '../alpha/a'; export function b() { return a(false); }\n");
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
  const assertFirstCopyVisible = async locale => {
    const visibility = await run(`(() => {
      const button=document.querySelector('.priority-card .quick-copy').getBoundingClientRect();
      const reader=document.getElementById('bauify-reader').getBoundingClientRect();
      const diagram=document.querySelector('.diagram-container').getBoundingClientRect();
      return { visible:button.width>0 && button.height>0 && button.left>=Math.max(0,reader.left) && button.right<=Math.min(innerWidth,reader.right) && button.top>=Math.max(0,reader.top) && button.bottom<=Math.min(innerHeight,reader.bottom), separate:innerWidth>1000 || diagram.top>=reader.bottom, overflow:document.documentElement.scrollWidth>innerWidth };
    })()`);
    assert.equal(visibility.visible, true, locale + ': first task copy must be inside both reader and window without scrolling');
    assert.equal(visibility.separate, true, locale + ': narrow reader must not cover the canvas');
    assert.equal(visibility.overflow, false, locale + ': no horizontal page overflow');
  };
  const assertPrimaryContrast = async label => {
    const styles = await run(`['.brief-copy','.priority-card .quick-copy'].map(selector=>{
      const s=getComputedStyle(document.querySelector(selector));return {selector,color:s.color,background:s.backgroundColor,opacity:s.opacity};
    })`);
    const parse = value => value.match(/[\d.]+/g).map(Number);
    const luminance = rgb => rgb.map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
    for (const style of styles) {
      const foreground=parse(style.color), background=parse(style.background);
      assert.equal(background[3] ?? 1, 1, label + ': primary background must be opaque');
      assert.equal(Number(style.opacity), 1, label + ': enabled action must not look disabled');
      const alpha=foreground[3] ?? 1;
      const text=foreground.slice(0,3).map((v,i)=>v*alpha+background[i]*(1-alpha));
      const [light,dark]=[luminance(text),luminance(background.slice(0,3))].sort((a,b)=>b-a);
      assert.ok((light+0.05)/(dark+0.05)>=4.5,label+' '+style.selector+': readable primary action contrast');
    }
  };
  await assertFirstCopyVisible('en desktop');
  // Reuse the exact captured facts to check both first-screen languages without
  // adding history banners or performing another analysis.
  const initialRead = file => JSON.parse(fs.readFileSync(path.join(out,'analysis',file)));
  const initialFindings=initialRead('findings.json');
  const initialZh=path.join(dir,'initial-zh.html');
  fs.writeFileSync(initialZh,buildOverlay({ir:{...ir,meta:{...ir.meta,locale:'zh-CN'}},graph:initialRead('module-graph.json'),facts:initialRead('raw-facts.json'),findings:initialFindings.diagnostics,findingsDocument:initialFindings,sourceRoot:root,html:fs.readFileSync(first.diagram,'utf8'),run:{openAnalysis:true,rules:initialFindings.rules}}).html);
  for (const [locale,file] of [['en',first.html],['zh-CN',initialZh]]) {
    await open(file);
    await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await assertFirstCopyVisible(locale+' narrow');
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
    for (const theme of ['light','dark']) {
      await run(`if(document.documentElement.getAttribute('data-theme')!==${JSON.stringify(theme)})document.getElementById('btn-theme').click()`);
      await run('new Promise(resolve=>setTimeout(resolve,400))');
      assert.equal(await run("document.documentElement.getAttribute('data-theme')"),theme);
      await assertPrimaryContrast(locale+' '+theme);
    }
    if (locale==='zh-CN') {
      const coverage = await run("document.querySelector('.coverage .cov').textContent");
      assert.match(coverage, /未检查：[^。]*重复代码/);
      assert.doesNotMatch(coverage, /\bduplication\b/);
      await run("document.querySelector('.reader-atlas').click()");
      const dependencyLabel = await run("document.querySelector('#bauify-atlas .bar[role=img]').getAttribute('aria-label')");
      assert.match(dependencyLabel, /已解析，.*外部依赖，.*未解析$/);
      await run("document.querySelector('.atlas-classic').click()");
      await run("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copied=value;}}});document.querySelector('.priority-card .quick-copy').click()");
      await run("new Promise((resolve,reject)=>{const deadline=Date.now()+3000;const poll=()=>window.__copied?resolve():Date.now()>deadline?reject(new Error('Chinese copy did not finish')):setTimeout(poll,20);poll();})");
      const status=await run("document.querySelector('.priority-card .handoff-status').textContent");
      assert.match(status,/基于本次分析快照构建/);
      assert.doesNotMatch(status,/Built from the analysis snapshot/);
      assert.equal(await run("(()=>{const d=JSON.parse(document.getElementById('bauify-analysis').textContent);return d.tasks[d.overview.priorities[0]].task.evidence.reason;})()"),'Built from the analysis snapshot; not yet compared with the current working tree.','UI localization preserves the canonical exported evidence');
      await run("document.querySelector('.reader-atlas').click()");
      const selectedCycleText = await run(`(() => {
        const idx = JSON.parse(document.getElementById('bauify-atlas-data').textContent).findings.findIndex(f => f.code === 'coupling/cycle');
        document.querySelector('#bauify-atlas [data-finding="' + idx + '"]').click();
        return document.querySelector('#bauify-atlas .selected').textContent;
      })()`);
      assert.match(selectedCycleText, /alpha/, 'zh-CN Atlas selects module-cycle findings and lists affected modules');
      assert.match(selectedCycleText, /beta/, 'zh-CN Atlas lists both cycle modules');
      await run("document.querySelector('.atlas-classic').click()");
    }
  }
  await open(first.html);
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
  fs.writeFileSync(path.join(root, 'src/beta/b.ts'), 'export function b() { return 1; }\n');
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
  assert.equal(await run("Boolean(document.querySelector('#bauify-detail .finding.warning'))"), true, 'zh-CN detail keeps canonical severity CSS class');
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
  await run("document.querySelector('.reader-toggle').click()");
  await run("new Promise(resolve=>setTimeout(resolve,500))");
  await run("document.querySelector('g[data-node-id=app]').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  const openedFromCanvas = await run("document.getElementById('bauify-reader').getBoundingClientRect().top");
  assert.ok(openedFromCanvas >= 0 && openedFromCanvas < 500, 'component selection reveals the narrow reading column: top='+openedFromCanvas);


  // Non-comparable history stays visible without a success colour or fixed claim,
  // and zh-CN preserves canonical CSS classes for accepted rows in both views.
  const read = file => JSON.parse(fs.readFileSync(path.join(out, 'analysis', file)));
  const graph = read('module-graph.json'), findings = read('findings.json'), review = read('review.json');
  review.comparison.comparable = false;
  review.comparison.reasons = ['Analysis configuration changed.'];
  const acceptedId = findings.diagnostics.find(item => item.severity === 'warning')?.id;
  if (acceptedId) review.findings = { ...(review.findings || {}), [acceptedId]: { status: 'accepted', reason: 'baseline check' } };
  const overlay = buildOverlay({ ir, graph, facts: read('raw-facts.json'), findings: findings.diagnostics, findingsDocument: findings,
    html: fs.readFileSync(second.diagram, 'utf8'), sourceRoot: root, run: { openAnalysis: true, rules: findings.rules, review } });
  const different = path.join(dir, 'different.html'); fs.writeFileSync(different, overlay.html);
  await open(different);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  assert.match(await run("document.querySelector('.comparison-banner').textContent"), /不能直接比较/);
  assert.equal(await run("document.querySelector('.comparison-banner').classList.contains('positive')"), false);
  assert.equal(await run("Boolean(document.querySelector('#bauify-overview .bauify-item.accepted'))"), true, 'zh-CN overview keeps canonical accepted CSS class');
  await run("document.querySelector('.reader-atlas').click()");
  assert.equal(await run("Boolean(document.querySelector('#bauify-atlas .row.accepted'))"), true, 'zh-CN Atlas keeps canonical accepted CSS class');
  const fallback = prepare('fr');
  await open(fallback.html);
  assert.equal(await run("document.getElementById('btn-bauify').textContent"), 'Code Analysis');
  assert.equal(await run("document.querySelector('#bauify-reader').lang"), 'en');
});
