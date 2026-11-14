import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';
const chrome=process.env.ARCHIFY_CHROME?findChrome():null;
const cli=fileURLToPath(new URL('../archify/bin/archify.mjs',import.meta.url));

test('standalone workbench keeps Atlas alongside evidence, both locales/themes and narrow task access',{skip:chrome?false:'Set ARCHIFY_CHROME for standalone browser acceptance.'},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-standalone-browser-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const root=path.join(dir,'repo');fs.mkdirSync(root);
  // A many-module cycle reproduces the real Hive location-list overflow.
  for(let i=0;i<22;i++){
    const module='domain-'+String(i).padStart(2,'0'),next='domain-'+String((i+1)%22).padStart(2,'0');
    const folder=path.join(root,'packages',module,'src');fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(folder,'../package.json'),JSON.stringify({name:module}));
    fs.writeFileSync(path.join(folder,'index.ts'),`import { f as dep } from '../../${next}/src/index';export function f(){return dep();}\n`);
  }
  const browser=new ChromeVisualBrowser(chrome);t.after(()=>browser.close());
  const session=await browser.sessionPromise;
  const send=(method,params={})=>browser.cdp.send(method,params,session);
  const run=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});assert.equal(r.exceptionDetails,undefined,r.exceptionDetails?.exception?.description);return r.result?.value;};
  const settle=()=>run('document.fonts.ready.then(()=>new Promise(r=>setTimeout(r,750)))');
  for(const locale of ['en','zh-CN']){
    const result=spawnSync(process.execPath,[cli,'code-analysis','prepare',root,'--out',path.join(dir,locale),'--locale',locale],{encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);const prepared=JSON.parse(result.stdout);assert.equal(prepared.diagram,null);
    const loaded=browser.cdp.waitFor('Page.loadEventFired',session);await send('Page.navigate',{url:pathToFileURL(prepared.html).href});await loaded;
    for(const theme of ['light','dark'])for(const [width,height] of [[1440,900],[390,844]]){
      await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
      await run(`if(document.documentElement.getAttribute('data-theme')!==${JSON.stringify(theme)})document.getElementById('btn-theme').click()`);await settle();
      const state=await run(`(()=>{const reader=document.getElementById('bauify-reader'),atlas=document.getElementById('bauify-atlas'),copy=document.querySelector('.priority-card .quick-copy'),r=reader.getBoundingClientRect(),a=atlas.getBoundingClientRect(),c=copy.getBoundingClientRect();return {lang:reader.lang,reader:getComputedStyle(reader).display,atlas:getComputedStyle(atlas).display,shape:innerWidth>1000?a.left>=r.right:a.top>=r.bottom,visible:c.top>=Math.max(0,r.top)&&c.bottom<=Math.min(innerHeight,r.bottom)&&c.left>=r.left&&c.right<=r.right,overflow:document.documentElement.scrollWidth>innerWidth,emptySwitch:!!document.querySelector('.atlas-classic,.reader-atlas'),noise:document.getElementById('bauify-overview').textContent.includes('not on this diagram')||document.getElementById('bauify-overview').textContent.includes('未映射到架构图')};})()`);
      assert.equal(state.lang,locale);assert.notEqual(state.reader,'none');assert.notEqual(state.atlas,'none');assert.equal(state.shape,true,JSON.stringify(state));assert.equal(state.visible,true,locale+theme+width+JSON.stringify(state));assert.equal(state.overflow,false);assert.equal(state.emptySwitch,false);assert.equal(state.noise,false);
    }
    await send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});await settle();
    await run("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>window.__copied=text}});document.querySelector('.priority-card .quick-copy').click()");
    await run("new Promise((r,j)=>{let end=Date.now()+3000;function p(){window.__copied?r():Date.now()>end?j(Error('copy timeout')):setTimeout(p,20)}p()})");
    assert.equal(await run("window.__copied===(()=>{let d=JSON.parse(document.getElementById('bauify-analysis').textContent);return d.tasks[d.overview.priorities[0]].markdown})()"),true);
    const id=await run("document.querySelector('.priority-card [data-finding]').getAttribute('data-finding')");
    await run("document.querySelector('.priority-card [data-finding]').click()");
    assert.equal(await run("document.documentElement.getAttribute('data-bauify-atlas-finding')"),id);
    assert.equal(await run("document.getElementById('bauify-detail').hidden"),false);
    await run("document.querySelector('.atlas-evidence').click()");
    assert.equal(await run("document.getElementById('bauify-reader').hidden"),false);
    assert.equal(await run("document.getElementById('bauify-atlas').hidden"),false);
    const selected=await run("JSON.parse(document.getElementById('bauify-atlas-data').textContent).findings.find(f=>f.id==="+JSON.stringify(id)+")");
    assert.equal(selected.kind, {'coupling/cycle':'modules','coupling/import-cycle':'cycle'}[selected.code], 'kind is a canonical machine value even in Chinese');
  }
});
