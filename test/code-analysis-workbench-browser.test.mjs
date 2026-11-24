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
  const command = (...args) => {
    const result = spawnSync(process.execPath, [cli, 'code-analysis', ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    return JSON.parse(result.stdout);
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
  assert.match(await run("document.querySelector('.health-summary').textContent"), /errors/);
  assert.equal(await run("document.querySelectorAll('.priority-card button button').length"), 0);
  const assertFirstCopyVisible = async locale => {
    // The diagram opens with its start-here card; the reader flies out from its "all findings" link.
    if (await run("document.getElementById('bauify-reader').classList.contains('fly-closed')")) {
      await run("document.querySelector('#bauify-stage .first-all').click()");
      await run('new Promise(resolve=>setTimeout(resolve,600))');
    }
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
      const s=getComputedStyle(document.querySelector(selector)),surface=getComputedStyle(document.querySelector(selector).closest('#bauify-reader'));
      return {selector,color:s.color,background:s.backgroundColor,surface:surface.backgroundColor,opacity:s.opacity};
    })`);
    const parse = value => value.match(/[\d.]+/g).map(Number);
    const luminance = rgb => rgb.map(v=>v/255).map(v=>v<=0.04045?v/12.92:((v+0.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[0.2126,0.7152,0.0722][i],0);
    for (const style of styles) {
      const foreground=parse(style.color), background=parse(style.background), surface=parse(style.surface);
      if (background.length === 3) background.push(1);
      if (surface.length === 3) surface.push(1);
      assert.equal(Number(style.opacity), 1, label + ': enabled action must not look disabled');
      if (background[3] === 0 && surface[3] === 1) background.splice(0, background.length, ...surface);
      const alpha=foreground[3] ?? 1;
      const text=foreground.slice(0,3).map((v,i)=>v*alpha+background[i]*(1-alpha));
      const [light,dark]=[luminance(text),luminance(background.slice(0,3))].sort((a,b)=>b-a);
      assert.ok((light+0.05)/(dark+0.05)>=4.5,label+' '+style.selector+': readable primary action contrast '+JSON.stringify({style,foreground,background}));
    }
  };
  await assertFirstCopyVisible('en desktop');
  // Reuse the exact captured facts to check both first-screen languages without
  // adding history banners or performing another analysis.
  const initialRead = file => JSON.parse(fs.readFileSync(path.join(out,'analysis',file)));
  const initialFindings=initialRead('findings.json');
  const cycleId = initialFindings.diagnostics.find(f => f.code === 'coupling/import-cycle').id;
  const analysisDir = path.join(out, 'analysis');
  const taskFile = path.join(dir, 'task.json');
  const task = command('task', analysisDir, '--finding', cycleId, '--format', 'json');
  fs.writeFileSync(taskFile, JSON.stringify(task));
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
      await run("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__copied=value;}}});document.querySelector('.priority-card .quick-copy').click()");
      await run("new Promise((resolve,reject)=>{const deadline=Date.now()+3000;const poll=()=>window.__copied?resolve():Date.now()>deadline?reject(new Error('Chinese copy did not finish')):setTimeout(poll,20);poll();})");
      const status=await run("document.querySelector('.priority-card .handoff-status').textContent");
      assert.equal(status,'');
      assert.equal(await run("document.querySelector('.priority-card .quick-copy').getAttribute('aria-label')"),'已复制');
      assert.equal(await run("document.querySelector('.priority-card .quick-copy svg path').getAttribute('d')"),'m5 12 4 4L19 6');
      assert.equal(await run("document.querySelector('.priority-card .handoff-status').getBoundingClientRect().height"),0);
      await run("new Promise(resolve=>setTimeout(resolve,1700))");
      assert.equal(await run("document.querySelector('.priority-card .quick-copy').getAttribute('aria-label')"),'复制任务给 AI');
      assert.equal(await run("document.querySelector('.priority-card .quick-copy svg rect').getAttribute('width')"),'11');
      assert.equal(await run("(()=>{const d=JSON.parse(document.getElementById('bauify-analysis').textContent);return d.tasks[d.overview.priorities[0]].task.evidence.reason;})()"),'Built from the analysis snapshot; not yet compared with the current working tree.','UI localization preserves the canonical exported evidence');
      await run("document.querySelector('.views-option[data-view=atlas]').click()");
      const selectedCycleText = await run(`(() => {
        const idx = JSON.parse(document.getElementById('bauify-atlas-data').textContent).findings.findIndex(f => f.code === 'coupling/cycle');
        document.querySelector('#bauify-atlas [data-finding="' + idx + '"]').click();
        return document.querySelector('#bauify-atlas .atlas-selection').textContent;
      })()`);
      assert.match(selectedCycleText, /alpha/, 'zh-CN Atlas selects module-cycle findings and lists affected modules');
      assert.match(selectedCycleText, /beta/, 'zh-CN Atlas lists both cycle modules');
      await run("document.querySelector('.views-option[data-view=diagram]').click()");
    }
  }
  await open(first.html);
  // Observe the clipboard adapter independently of browser-owned permissions.
  await run("Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__copied = value; } } })");
  await run("document.querySelector('.priority-card .quick-copy').click()");
  const copied = await run(`new Promise((resolve,reject) => { const deadline=Date.now()+3000; const poll=()=>window.__copied?resolve(window.__copied):Date.now()>deadline?reject(new Error('first-card copy did not finish')):setTimeout(poll,20);poll();})`);
  assert.equal(copied, await run("(() => { const data=JSON.parse(document.getElementById('bauify-analysis').textContent);return data.tasks[data.overview.priorities[0]].markdown;})()"));
  assert.equal(await run("document.querySelector('.priority-card .handoff-status').textContent"), '');
  await run("window.__copied='';document.querySelector('.brief-copy').click()");
  assert.equal(await run('window.__copied'), await run("JSON.parse(document.getElementById('bauify-analysis').textContent).architectureBrief"));
  assert.equal(await run("document.querySelector('.brief-status').textContent"), '');
  assert.equal(await run("document.querySelector('.brief-copy svg path').getAttribute('d')"), 'm5 12 4 4L19 6');
  await run("new Promise(resolve=>setTimeout(resolve,1700))");
  assert.equal(await run("document.querySelector('.brief-copy').getAttribute('aria-label')"), 'Copy architecture brief');
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
  assert.equal(await run("document.querySelector('.quick-copy').getAttribute('aria-label')"), '复制任务给 AI');
  const sourceComparison = JSON.parse(fs.readFileSync(path.join(out, 'analysis', 'review.json'))).comparison;
  assert.ok(sourceComparison.notDetected.length > 0);
  assert.ok((await run("document.querySelector('.comparison-banner').textContent")).includes(`本轮未再检出 ${sourceComparison.notDetected.length} 项 · 新增 ${sourceComparison.new.length} 项`));
  assert.match(await run("document.querySelector('.comparison-banner').textContent"), /不代表已证实修复/);
  assert.match(await run("document.querySelector('.health-summary').textContent"), /无错误级/);

  const template = command('verify-change', analysisDir, '--task', taskFile, '--checks-template');
  const checks = path.join(dir, 'checks.json');
  fs.writeFileSync(checks, JSON.stringify({ ...template, checks: [{ name: '<img id="check-injection">', status: 'failed' }] }));
  const expectedReceipt = command('verify-change', analysisDir, '--task', taskFile, '--checks', checks);
  assert.equal(expectedReceipt.taskId, task.taskId);
  assert.equal(expectedReceipt.analysis.selected[0].outcome, 'not-detected');
  const choose = async (selector, file) => {
    const { root } = await send('DOM.getDocument');
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
    await send('DOM.setFileInputFiles', { nodeId, files: [file] });
  };
  const submit = async () => {
    const point = await run("(()=>{const b=document.querySelector('.verify-change button[type=submit]'); b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return {x,y,hit:document.elementFromPoint(x,y)===b};})()");
    assert.equal(point.hit, true, 'the receipt submit button accepts normal pointer input');
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await run("new Promise((resolve,reject)=>{const deadline=Date.now()+3000;const poll=()=>document.querySelector('.verify-preview').textContent||document.querySelector('.verify-status').textContent?resolve():Date.now()>deadline?reject(new Error('receipt did not finish')):setTimeout(poll,20);poll();})");
  };
  // The receipt form lives in the reader, which starts closed beside the diagram; opening it renders the overview.
  if (await run("document.getElementById('bauify-reader').classList.contains('fly-closed')")) {
    await run("document.querySelector('#bauify-stage .first-all').click()");
    await run('new Promise(resolve=>setTimeout(resolve,600))');
  }
  await run("document.querySelector('.verify-change summary').click()");
  const wrongTask = path.join(dir, 'wrong-task-id.json');
  const otherId = task.taskId.slice(0, -1) + (task.taskId.endsWith('0') ? '1' : '0');
  fs.writeFileSync(wrongTask, JSON.stringify({ ...task, taskId: otherId }));
  const rejected = spawnSync(process.execPath, [cli, 'code-analysis', 'verify-change', analysisDir, '--task', wrongTask], { encoding: 'utf8' });
  assert.equal(rejected.status, 2, rejected.stdout + rejected.stderr);
  assert.equal(JSON.parse(rejected.stdout).diagnostics[0].code, 'verification/wrong-task-id');
  await choose('.verify-task', wrongTask);
  await submit();
  assert.match(await run("document.querySelector('.verify-status').textContent"), /任务 ID 与所选发现不匹配/);
  assert.equal(await run("document.querySelector('.verify-download').disabled"), true);
  await choose('.verify-task', taskFile);
  await submit();
  assert.match(await run("document.querySelector('.verify-preview').textContent"), /未再检出.*没有报告项目检查结果/s);
  await choose('.verify-checks', checks);
  await submit();
  assert.match(await run("document.querySelector('.verify-preview').textContent"), /Archify 没有运行或独立核验这些检查。.*<img id="check-injection"> · 失败/s);
  assert.equal(await run("Boolean(document.getElementById('check-injection'))"), false);
  const downloads = path.join(dir, 'downloads');
  fs.mkdirSync(downloads);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
  await run("document.querySelector('.verify-download').click()");
  const downloaded = path.join(downloads, task.taskId + '.verification.json');
  for (let tries = 0; !fs.existsSync(downloaded) && tries < 60; tries++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(JSON.parse(fs.readFileSync(downloaded, 'utf8')), expectedReceipt);
  const stale = path.join(dir, 'stale-checks.json');
  fs.writeFileSync(stale, JSON.stringify({ ...template, after: { ...template.after, analysisSha256: '0'.repeat(64) } }));
  await choose('.verify-checks', stale);
  await submit();
  assert.match(await run("document.querySelector('.verify-status').textContent"), /快照对不匹配/);
  assert.equal(await run("document.querySelector('.verify-download').disabled"), true);
  await run("document.querySelector('.verify-change summary').click()");
  await run("document.querySelector('.browse-findings').click();const search=document.querySelector('.finding-search');search.value='复杂';search.dispatchEvent(new Event('input'));");
  assert.ok(await run("document.querySelectorAll('.finding-list [data-finding]').length > 0"), 'Chinese search matches the visible localized title');
  await run("document.querySelector('.findings-back').click()");
  await run("document.querySelector('.priority-card [data-finding]').click()");
  assert.equal(await run("document.querySelector('#bauify-detail .quick-copy').getAttribute('aria-label')"), '复制任务给 AI');
  assert.equal(await run("Boolean(document.querySelector('#bauify-detail .finding.warning'))"), true, 'zh-CN detail keeps canonical severity CSS class');
  assert.match(await run("document.querySelector('#bauify-detail').textContent"), /源码证据/);
  await run("document.querySelector('#bauify-detail .back').click()");
  assert.deepEqual(await run("Array.from(document.querySelectorAll('.views-option b'), b => b.textContent)"), ['模块分析', '整仓星图', 'Atlas 3D 模型'], 'zh-CN names the three tabs above the diagram');
  await run("document.querySelector('.views-option[data-view=atlas]').click()");
  assert.match(await run("document.querySelector('.atlas-side').textContent"), /高复杂度函数/);
  assert.equal(await run("document.querySelector('.atlas-stats').getAttribute('aria-label')"), '本次统计');
  assert.equal(await run("document.querySelector('.atlas-q').placeholder"), '搜索模块、文件或函数');
  assert.match(await run("document.querySelector('.atlas-first').textContent"), /先看这里/);
  await run("document.querySelector('.views-option[data-view=diagram]').click()");
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
  await run("document.querySelector('.views-option[data-view=atlas]').click()");
  assert.equal(await run("Boolean(document.querySelector('#bauify-atlas .row.accepted'))"), true, 'zh-CN Atlas keeps canonical accepted CSS class');
  const fallback = prepare('fr');
  await open(fallback.html);
  assert.equal(await run("document.getElementById('btn-bauify').textContent"), 'Code Analysis');
  assert.equal(await run("document.querySelector('#bauify-reader').lang"), 'en');

  // Use the redesigned inspector with two imports and one isolated function.
  fs.appendFileSync(path.join(root, 'src/alpha/a.ts'), "import { helper } from '../beta/helper'; export const extra = helper();\n");
  fs.writeFileSync(path.join(root, 'src/beta/helper.ts'), 'export function helper() { return 2; }\n');
  fs.writeFileSync(path.join(root, 'src/alpha/isolated.ts'), 'export function isolated(x: boolean) { return x ? 1 : 2; }\n');
  fs.mkdirSync(path.join(root, 'src/outside'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/outside/config.ts'), 'export const mode = "standalone";\n');
  const map = { app: [graph.modules.find(module => module.path.endsWith('/alpha')).id] };
  ir.components.push({ id: 'beta', type: 'backend', label: 'Beta', pos: [340, 160], size: [170, 64] });
  map.beta = [graph.modules.find(module => module.path.endsWith('/beta')).id];
  const mapPath = path.join(dir, 'map.json');
  fs.writeFileSync(mapPath, JSON.stringify(map));
  const mapped = prepare('en', ['--map', mapPath]);
  await open(mapped.html);
  const click = selector => run(`document.querySelector(${JSON.stringify(selector)}).click()`);
  await click('.views-option[data-view=atlas]');
  const focusFunction = file => run(`(() => {
    const atlas = JSON.parse(document.getElementById('bauify-atlas-data').textContent);
    const finding = atlas.findings.find(item => item.kind === 'function' && atlas.files[atlas.functions[item.fn][0]][0] === ${JSON.stringify(file)});
    window.__archifyAtlas.focusFinding(finding.id);
  })()`);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await run(`(() => {
    window.__importLabels = []; window.__importCurves = []; window.__importLeaders = [];
    const proto = CanvasRenderingContext2D.prototype;
    const moveTo = proto.moveTo, lineTo = proto.lineTo, bezier = proto.bezierCurveTo;
    proto.moveTo = function (x, y) { this.__lastMove = [x, y]; return moveTo.apply(this, arguments); };
    proto.lineTo = function (x, y) { if (this.lineWidth === 1 && this.__lastMove) window.__importLeaders.push(this.__lastMove); return lineTo.apply(this, arguments); };
    proto.bezierCurveTo = function (a, b, c, d, x, y) { if (this.__lastMove) window.__importCurves.push([this.__lastMove, [x, y]]); return bezier.apply(this, arguments); };
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (text === '①' || text === '②') window.__importLabels.push(text);
      return fillText.call(this, text, ...args);
    };
  })()`);
  await focusFunction('src/alpha/a.ts');
  const paths = () => run("Array.from(document.querySelectorAll('.atlas-import-paths dd'), item => item.textContent)");
  assert.deepEqual(await paths(), ['src/alpha/a.ts', 'src/beta/b.ts'], 'the selected import lists both full paths in order');
  assert.deepEqual(await run("[...new Set(window.__importLabels)]"), ['①', '②']);
  assert.equal(await run(`(() => {
    const leaders = window.__importLeaders.slice(-2);
    const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01;
    return leaders.length === 2 && window.__importCurves.some(curve => near(leaders[0], curve[0]) && near(leaders[1], curve[1]));
  })()`), true, 'both numbered leaders meet the focused dependency curve endpoints');
  await run("document.querySelector('.atlas-imports select').focus()");
  for (const type of ['keyDown', 'keyUp']) {
    await send('Input.dispatchKeyEvent', { type, key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  }
  assert.deepEqual(await paths(), ['src/alpha/a.ts', 'src/beta/helper.ts']);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  assert.equal(await run(`(() => {
    const paths = document.querySelector('.atlas-import-paths');
    paths.scrollIntoView({ block: 'center' });
    return [...paths.querySelectorAll('dd')].every(item => {
      const r = item.getBoundingClientRect();
      return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight && r.right <= innerWidth && item.scrollWidth <= item.clientWidth;
    });
  })()`), true, 'both paths remain readable at 390 px');
  await focusFunction('src/alpha/isolated.ts');
  assert.match(await run("document.querySelector('.atlas-imports').textContent"), /No captured dependencies for the selected file/);
  assert.equal(await run("Boolean(document.querySelector('.atlas-imports select'))"), false);

  // Build the same authored report without source snippets. The captured
  // import still points to a location, but there is no source to open.
  const noSource = buildOverlay({ ir, graph: read('module-graph.json'), map, facts: read('raw-facts.json'),
    html: fs.readFileSync(mapped.diagram, 'utf8'), run: { openAnalysis: true } });
  const missing = path.join(dir, 'missing-source.html');
  fs.writeFileSync(missing, noSource.html);
  await open(missing);
  await click('#bauify-stage [data-go="code"]');
  assert.match(await run("document.querySelector('#bauify-panel .fly-ev').textContent"), /src\/alpha\/a\.ts.*Source was not captured/s);
  assert.equal(await run("Boolean(document.querySelector('#bauify-panel button.fly-ev'))"), false);
  await click('#bauify-stage [data-go^="off:"]');
  assert.match(await run("document.querySelector('#bauify-panel .fly-ev').textContent"), /src\/outside\/config\.ts.*Source was not captured/s);
  assert.equal(await run("Boolean(document.querySelector('#bauify-panel button.fly-ev'))"), false, 'the off-diagram file list does not offer unusable source buttons');
});
