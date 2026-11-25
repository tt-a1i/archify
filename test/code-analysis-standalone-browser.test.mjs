import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
const chrome=process.env.ARCHIFY_CHROME?findChrome():null;
const cli=fileURLToPath(new URL('../archify/bin/archify.mjs',import.meta.url));

test('standalone workbench keeps Atlas alongside evidence, both locales/themes and narrow task access',{skip:chrome?false:'Set ARCHIFY_CHROME for standalone browser acceptance.'},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-standalone-browser-'));
  let browser;
  t.after(async () => {
    if (browser) {
      if (browser.child.exitCode === null && browser.child.signalCode === null) {
        const exit = once(browser.child, 'exit', { signal: AbortSignal.timeout(5_000) }).catch(() => {});
        await browser.cdp.send('Browser.close').catch(() => {});
        await exit;
      }
      await browser.close();
    }
    fs.rmSync(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  });
  const root=path.join(dir,'repo');fs.mkdirSync(root);
  // A many-module cycle reproduces the real Hive location-list overflow.
  for(let i=0;i<22;i++){
    const module='domain-'+String(i).padStart(2,'0'),next='domain-'+String((i+1)%22).padStart(2,'0');
    const folder=path.join(root,'packages',module,'src');fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(folder,'../package.json'),JSON.stringify({name:module}));
    fs.writeFileSync(path.join(folder,'index.ts'),`import { f as dep } from '../../${next}/src/index';export function f(){return dep();}\n`);
  }
  browser=new ChromeVisualBrowser(chrome);
  const session=await browser.sessionPromise;
  const send=(method,params={})=>browser.cdp.send(method,params,session);
  const run=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result?.value;};
  const wait = (condition, message) => run(`new Promise((resolve, reject) => {
    const deadline = Date.now() + 4000;
    function poll() { if (${condition}) resolve(true); else if (Date.now() >= deadline) reject(new Error(${JSON.stringify(message)})); else setTimeout(poll, 20); }
    poll();
  })`);
  const viewport = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  const motion = value => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
  const point = selector => run(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    node.scrollIntoView({ block: 'nearest' });
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  const clickAt = async p => {
    for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...p, button: 'left', clickCount: 1 });
  };
  const click = async selector => clickAt(await point(selector));
  const hover = async selector => send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...await point(selector) });
  const drawSettled = "!document.documentElement.hasAttribute('data-bauify-atlas-animating')";
  const details = '#bauify-detail';
  const priority = '.priority-card [data-finding]';
  const copy = '.priority-card .quick-copy';
  const list = '.atlas-side .module-list';
  const selectedModule = "document.documentElement.getAttribute('data-bauify-atlas-focus')";
  const selectedFinding = "document.documentElement.getAttribute('data-bauify-atlas-finding')";
  const canvasSized = `(() => { const c = document.querySelector('#bauify-atlas canvas'), s = c.parentElement.getBoundingClientRect(); return !!c.style.width && Math.abs(c.width - s.width * devicePixelRatio) < 1 && Math.abs(c.height - s.height * devicePixelRatio) < 1; })()`;
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
    const p = CanvasRenderingContext2D.prototype, clear = p.clearRect, arc = p.arc;
    p.clearRect = function (...args) { if (!this.canvas.isConnected) window.atlasArcs = []; return clear.apply(this, args); };
    p.arc = function (x, y, r, start, end, ...rest) {
      if (!this.canvas.isConnected && r > 5) {
        if (end - start >= 2 * Math.PI) { const m = this.getTransform(); window.atlasRing = [2 * r * m.a, 2 * r * m.d]; }
        else atlasArcs.push({ x, y, r, start, end });
      }
      return arc.call(this, x, y, r, start, end, ...rest);
    };
  })()` });
  for (const locale of ['en', 'zh-CN']) {
    await viewport(1440, 900);
    const result = spawnSync(process.execPath, [cli, 'code-analysis', 'prepare', root, '--out', path.join(dir, locale), '--locale', locale], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const prepared = JSON.parse(result.stdout);
    assert.equal(prepared.diagram, null);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(prepared.html).href }); await loaded;
    await run('document.fonts.ready');
    await wait(canvasSized, 'Atlas did not size its canvas');
    const atlas = await run("JSON.parse(document.getElementById('bauify-atlas-data').textContent)");
    assert.deepEqual(await run("Array.from(document.querySelectorAll('.atlas-side .stats b'), b => b.textContent)"), [atlas.files.length, atlas.edges.length, atlas.functions.length, atlas.modules.length].map(n => n.toLocaleString('en-US')));
    assert.equal(await run("document.querySelector('.atlas-title').firstChild.textContent"), locale === 'zh-CN' ? '整仓星图' : 'Atlas');
    assert.equal(await run("document.querySelector('.atlas-stats .k').textContent"), locale === 'zh-CN' ? '本次统计' : 'Totals');
    assert.equal(await run("!!document.querySelector('.atlas-selection .note') && !document.querySelector('.atlas-selection .selected')"), true, 'with nothing selected the selection shows how to start');
    assert.equal(await run("!document.querySelector('.atlas-side .module-page,.atlas-side .atlas-more-modules')"), true);
    assert.equal(await run("document.querySelector('.atlas-stats .stat span').textContent"), locale === 'zh-CN' ? '文件' : 'files');
    await hover('.priority-card .priority-level');
    assert.match(await run("document.querySelector('.analysis-tooltip:not([hidden])').textContent"), locale === 'zh-CN' ? /^(错误|提醒|参考):/ : /^(error|warning|info):/);
    await click('.atlas-expand');
    assert.equal(await run("document.querySelector('.atlas-expand').getAttribute('aria-pressed')"), 'false');
    assert.equal(await run("document.querySelector('.atlas-expand').textContent"), locale === 'zh-CN' ? '开启扇区缩放' : 'Enable sector zoom');
    await click('.atlas-expand');
    for (const theme of ['light', 'dark']) for (const [width, height] of [[1440, 900], [390, 844]]) {
      await viewport(width, height);
      await run(`if (document.documentElement.dataset.theme !== ${JSON.stringify(theme)}) document.getElementById('btn-theme').click()`);
      await wait(canvasSized, 'Atlas did not resize with the viewport');
      const state = await run(`(() => {
        const reader = document.getElementById('bauify-reader'), card = document.querySelector('.priority-card');
        const r = reader.getBoundingClientRect(), a = document.getElementById('bauify-atlas').getBoundingClientRect();
        const c = card.querySelector('.quick-copy').getBoundingClientRect(), l = card.querySelector('.priority-level').getBoundingClientRect();
        const icon = card.querySelector('.quick-copy svg').getBoundingClientRect(), label = card.querySelector('.bauify-item b').getBoundingClientRect();
        return { lang: reader.lang, separate: innerWidth > 1000 ? a.right <= r.left : a.top >= r.bottom,
          copy: [c.width, c.height], tag: [l.width, l.height], aligned: c.top === l.top && l.right < c.left && label.right <= l.left,
          centered: c.left + c.width / 2 === icon.left + icon.width / 2 && c.top + c.height / 2 === icon.top + icon.height / 2,
          visible: c.top >= Math.max(0, r.top) && c.bottom <= Math.min(innerHeight, r.bottom) && c.right <= r.right,
          overflow: document.documentElement.scrollWidth > innerWidth, emptySwitch: !!document.querySelector('.atlas-classic,.reader-atlas'),
          noise: /not on this diagram|未映射到架构图/.test(document.getElementById('bauify-overview').innerText),
          extraDetails: !!card.querySelector('.what,.where,.priority-evidence,.priority-source') };
      })()`);
      assert.deepEqual(state, { lang: locale, separate: true, copy: [24, 24], tag: [24, 24], aligned: true, centered: true, visible: true, overflow: false, emptySwitch: false, noise: false, extraDetails: false }, `${locale} ${theme} ${width}`);
    }
    await viewport(1440, 900);
    await wait(canvasSized, 'Atlas did not return to its desktop size');
    await run("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__copied=text}})");
    await click(copy);
    await wait('window.__copied', 'the first-screen icon did not copy');
    assert.equal(await run("window.__copied===(()=>{const d=JSON.parse(document.getElementById('bauify-analysis').textContent);return d.tasks[d.overview.priorities[0]].markdown})()"), true);
    assert.equal(await run("document.getElementById('bauify-detail').hidden"), true, 'copy never opens the finding');
    await run("navigator.clipboard.writeText = async () => { throw Error('denied'); }");
    await click(copy);
    await wait("document.querySelector('.priority-card .ai-task').open && document.activeElement.matches('.task-preview')", 'clipboard refusal did not open the manual copy fallback');
    assert.equal(await run("document.activeElement.selectionStart === 0 && document.activeElement.selectionEnd === window.__copied.length"), true);
    await run("document.querySelector('.priority-card .ai-task').open = false; document.getElementById('bauify-overview').scrollTop = 0");

    const id = await run("document.querySelector('.priority-card [data-finding]').dataset.finding");
    await click(priority);
    assert.equal(await run(selectedFinding), id);
    assert.match(await run(`document.querySelector('${details} .finding-location').innerText`), /packages\/domain-\d+\/src\/index\.ts:\d+/);
    assert.match(await run(`document.querySelector('${details} .level').innerText`), /domain-\d+/);
    await click('.atlas-evidence');
    assert.equal(await run("!document.getElementById('bauify-detail').hidden && !document.getElementById('bauify-atlas').hidden"), true);
    const selected = atlas.findings.find(f => f.id === id);
    assert.equal(selected.kind, { 'coupling/cycle': 'modules', 'coupling/import-cycle': 'cycle' }[selected.code]);
    await click(`${details} .inline-evidence .ref`);
    assert.equal(await run("document.getElementById('bauify-code').hidden"), false);
    await click('#bauify-code .source-back');
    assert.equal(await run(selectedFinding), id, 'returning from source keeps the detail selected');
    await click(`${details} .back`);
    assert.equal(await run(selectedFinding), id, 'the explicit Atlas opener replaces the earlier overview return context');
    assert.equal(await run("Boolean(document.querySelector('.atlas-selection .selected'))"), true);

    // Selecting a captured file replaces a prior finding, and module/clear
    // selections replace that file. Protect the actual browser transitions.
    await click(priority);
    const cycle = atlas.findings.find(f => f.kind === 'cycle');
    await run('window.__archifyAtlas.focusFinding(' + JSON.stringify(cycle.id) + ')');
    await wait("document.documentElement.getAttribute('data-bauify-atlas-flow') === 'on'", 'cycle animation did not start');
    await click('#atlas-tab-files');
    assert.equal(await run(`new Promise(resolve => {
      const original = CanvasRenderingContext2D.prototype.drawImage;
      const canvas = document.querySelector('#bauify-atlas canvas'); let paints = 0;
      CanvasRenderingContext2D.prototype.drawImage = function (...args) { if (this.canvas === canvas) paints++; return original.apply(this, args); };
      setTimeout(() => { CanvasRenderingContext2D.prototype.drawImage = original; resolve(paints); }, 160);
    })`), 0, 'Files does not keep repainting the hidden cycle');
    assert.equal(await run("document.querySelector('#atlas-tab-files').textContent"),locale==='zh-CN'?'文件':'Files');
    await click('.atlas-file-query');
    await send('Input.insertText',{text:atlas.files[0][0]});
    await click('.atlas-file-list [data-file="0"]');
    const exported=await run("document.querySelector('.atlas-file-markdown')?.value");
    assert.ok(exported?.startsWith('# '+atlas.files[0][0]),'a file replaces the previously selected finding');
    assert.equal(await run(selectedFinding),'');
    assert.equal(await run(selectedModule),atlas.modules[atlas.files[0][1]].id);
    const downloadDir=path.join(dir,'downloads-'+locale);fs.mkdirSync(downloadDir);
    await browser.cdp.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloadDir});
    await click('.atlas-file-download');
    const downloaded=path.join(downloadDir,'index.md'),deadline=Date.now()+5000;
    while(!fs.existsSync(downloaded)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(fs.readFileSync(downloaded,'utf8'),exported,'actual Markdown download matches the preview');
    await run('window.__fileSelection = window.__archifyAtlas.saveSelection()');
    await click('#atlas-tab-map');
    await wait(canvasSized,'Map did not resize after Files');
    await click(list+' [data-module="1"]');
    assert.equal(await run("!!document.querySelector('.atlas-file-markdown')"),false,'module selection replaces a file');
    await click('.atlas-clear');
    assert.equal(await run("!document.querySelector('.atlas-selection .selected')"),true,'clear removes file selection');
    await run('window.__archifyAtlas.restoreSelection(window.__fileSelection)');
    assert.equal(await run("!document.querySelector('#atlas-files-panel').hidden"),true);
    assert.equal(await run("document.querySelector('.atlas-file-query').value"),atlas.files[0][0]);
    assert.equal(await run("document.querySelector('.atlas-file-markdown').value"),exported);
    await run("document.querySelector('#atlas-tab-files').focus()");
    await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowLeft',code:'ArrowLeft'});
    await send('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowLeft',code:'ArrowLeft'});
    assert.equal(await run("document.activeElement.id"),'atlas-tab-map');
    assert.equal(await run("document.querySelector('#atlas-tab-map').tabIndex"),0);
    assert.equal(await run("document.querySelector('#atlas-tab-files').tabIndex"),-1);
    assert.equal(await run("document.querySelector('#atlas-files-panel').hidden"),true);
    await click('.atlas-clear');
    assert.equal(await run("!document.querySelector('.atlas-selection .selected')"), true);
    await click(`${details} .back`);

    const wheel = async (selector, deltaY) => send('Input.dispatchMouseEvent', { type: 'mouseWheel', ...await point(selector), deltaX: 0, deltaY });
    await wheel(list, 2000);
    await wait(`(() => {const e=document.querySelector('${list}'); return e.scrollTop > 0 && e.scrollHeight-e.clientHeight-e.scrollTop < 2;})()`, 'wheel scrolling did not reach the final module');
    const last = `${list} [data-module]:last-child`;
    const moduleIndex = await run(`Number(document.querySelector('${last}').dataset.module)`);
    const readModuleScroll = () => run(`document.querySelector('${list}').scrollTop`);
    const bottom = await readModuleScroll();
    await click(last);
    assert.equal(await run(selectedModule), atlas.modules[moduleIndex].id);
    assert.equal(await readModuleScroll(), bottom);
    await click('#btn-theme');
    assert.equal(await readModuleScroll(), bottom);
    await wheel('#bauify-atlas canvas', -180);
    await wait(drawSettled, 'sector zoom did not settle');
    const sector = () => run(`atlasArcs[${moduleIndex}].end - atlasArcs[${moduleIndex}].start`);
    const zoom = await sector();
    await run("const group = document.querySelector('.atlas-side details[data-group]'); group.open = true");
    const readSide = () => run(`({ scroll: document.querySelector('.atlas-side').scrollTop, modules: document.querySelector('${list}').scrollTop, groups: Array.from(document.querySelectorAll('.atlas-side details[data-group][open]'), e => e.dataset.group) })`);
    const sideBefore = await readSide();
    await run(`document.querySelector(${JSON.stringify(priority)}).scrollIntoView({ block: 'nearest' })`);
    await wait(`(() => { const el = document.querySelector(${JSON.stringify(priority)}), r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit && el.contains(hit); })()`, 'overview finding is not clickable');
    await click(priority);
    await wait(`${selectedFinding} === ${JSON.stringify(id)}`, 'overview finding did not select on the map');
    assert.equal(await run(selectedFinding), id);
    await click(`${details} .close`);
    await wait(drawSettled, 'restored sector zoom did not settle');
    assert.equal(await run(selectedModule), atlas.modules[moduleIndex].id);
    assert.equal(await sector(), zoom, 'back restores the previously zoomed sector');
    assert.deepEqual(await readSide(), sideBefore);

    const widthBefore = await run("document.querySelector('.atlas-stage').getBoundingClientRect().width");
    const sample = `(() => { const c=document.querySelector('#bauify-atlas canvas'), b=c.getBoundingClientRect(); return Math.abs(atlasRing[0] * b.width / c.width - atlasRing[1] * b.height / c.height) < 1; })()`;
    await click('.reader-toggle');
    assert.equal(await run("document.activeElement.classList.contains('reader-restore')"), true);
    const roundFrames = await run(`new Promise(resolve => {
      const checks = []; const until = performance.now() + 380;
      function take() { checks.push(${sample}); if (performance.now() < until) requestAnimationFrame(take); else resolve(checks); }
      requestAnimationFrame(take);
    })`);
    assert.ok(roundFrames.every(Boolean), 'the painted wheel stays round while the column moves');
    await wait(`(${canvasSized}) && getComputedStyle(document.getElementById('bauify-reader')).visibility === 'hidden'`, 'the collapsed layout did not settle');
    assert.equal(await run("document.querySelector('.analysis-reader-shell').getBoundingClientRect().width"), 20);
    assert.ok(await run("document.querySelector('.atlas-stage').getBoundingClientRect().width") > widthBefore);
    const arcPoint = await run(`(() => { const a=atlasArcs[${moduleIndex}], m=(a.start+a.end)/2, b=document.querySelector('#bauify-atlas canvas').getBoundingClientRect(); return {x:b.left+a.x+a.r*Math.cos(m), y:b.top+a.y+a.r*Math.sin(m)}; })()`);
    await clickAt(arcPoint);
    assert.equal(await run(selectedModule), '', 'a rendered arc remains clickable after the sidebar closes');
    await click('.reader-restore');
    await wait(`(${canvasSized}) && document.querySelector('.analysis-reader-shell').getBoundingClientRect().width === 420`, 'the reader did not expand again');
    assert.equal(await run("document.activeElement.classList.contains('reader-toggle')"), true);
    assert.equal(await run(sample), true);
    await motion('reduce');
    await viewport(390, 844);
    await wait(canvasSized, 'the Atlas did not reach the narrow viewport');
    await click('.reader-toggle');
    assert.equal(await run("getComputedStyle(document.getElementById('bauify-reader')).display"), 'none');
    assert.ok(await run("document.querySelector('.analysis-reader-shell').getBoundingClientRect().height") <= 36);
    await click('.reader-restore');
    assert.equal(await run("document.documentElement.scrollWidth"), 390);
    await click('#atlas-tab-files');
    assert.equal(await run(`(() => {
      const pane = document.querySelector('.atlas-files-pane').getBoundingClientRect();
      const query = document.querySelector('.atlas-file-query').getBoundingClientRect();
      const row = document.querySelector('.atlas-file-list [data-file]').getBoundingClientRect();
      return query.top >= pane.top && row.bottom <= pane.bottom;
    })()`), true, 'narrow Files keeps the search and first result visible together');
    await motion('no-preference');
  }
});
