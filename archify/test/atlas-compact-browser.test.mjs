import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { findChrome } from '../bin/visual-check.mjs';
import { desktopBrowser } from './helpers/desktop-browser.mjs';
import { unpackAtlas } from '../renderers/shared/atlas-delivery.mjs';
import { serializeScriptJson } from '../renderers/shared/utils.mjs';
import { decodeAtlasPayload, serializeAtlasPayload } from '../renderers/shared/atlas-envelope.mjs';
import { byteReceipt } from '../renderers/shared/atlas-manifest.mjs';
import { collectProcessEvidence } from './helpers/seamless-process-evidence.mjs';

const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
test('compact shell reconstructs only visited members and shows malformed-package errors', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME and launch outside the sandbox for browser acceptance.',
}, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-compact-browser-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const output = process.env.ARCHIFY_COMPACT_ARTIFACT || path.join(directory, 'atlas.html');
  if (!process.env.ARCHIFY_COMPACT_ARTIFACT) execFileSync(process.execPath, [
    new URL('../bin/archify.mjs', import.meta.url).pathname, 'deliver', 'atlas',
    new URL('../examples/atlas/project.atlas.json', import.meta.url).pathname, output, '--json',
  ]);
  const html = fs.readFileSync(output, 'utf8'), bundle = unpackAtlas(html);
  const nested = bundle.details.find(detail => bundle.details.some(child => child.from.diagram === detail.to));
  assert.ok(nested);
  const target = bundle.details.find(detail => detail.from.diagram === nested.to).to;
  const browser = desktopBrowser(chrome); t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    if(window===parent){
      window.compactDecoded=[];window.compactErrors=[];
      window.compactFrames=[];window.compactEverReady=false;
      window.compactSample=()=>({at:performance.now(),href:location.href,frames:[...document.querySelectorAll('iframe')].map(frame=>{
        const graph=frame.contentDocument?.querySelector('.diagram-container');
        const bounds=frame.getBoundingClientRect();
        return {diagram:frame.contentWindow?.ArchifyAddress?.context?.diagram||null,
          visible:getComputedStyle(frame).visibility!=='hidden'&&bounds.width>0&&bounds.height>0,
          graph:!!graph&&graph.getBoundingClientRect().width>0,state:frame.dataset.atlasState};
      })});
      const sample=()=>{const value=compactSample();if(value.frames.some(f=>f.state==='active'&&f.visible))compactEverReady=true;
        compactFrames.push({...value,everReady:compactEverReady});requestAnimationFrame(sample);};requestAnimationFrame(sample);
      addEventListener('error',e=>compactErrors.push(e.message));
      const parse=JSON.parse;
      JSON.parse=function(...args){const value=parse.apply(this,args);
        if(value?.bundle_version===2&&value.documents)for(const [id,parts]of Object.entries(value.documents)){
          if(!Array.isArray(parts))continue;
          const map=parts.map;parts.map=function(...args){compactDecoded.push(id);return map.apply(this,args);};
        }
        return value;
      };
    }
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  async function wait(id) {
    await run(`new Promise((resolve,reject)=>{let tries=0;const timer=setInterval(()=>{
      const current=document.querySelector('iframe[data-atlas-state=active]')?.contentWindow;
      if(current?.ArchifyAddress?.context.diagram===${JSON.stringify(id)}&&!current.ArchifyAddress.restoring){clearInterval(timer);resolve();}
      else if(++tries>300){clearInterval(timer);reject(new Error(document.getElementById('atlas-error')?.textContent||'Not ready'));}
    },30);})`);
  }
  await send('Page.navigate', { url: pathToFileURL(output).href + '?theme=light#diagram=' + target });
  await wait(target);
  assert.equal(await run('document.documentElement.dataset.atlasDecoder'), 'native');
  assert.equal(await run('typeof globalThis.ArchifyGzipFallback'), 'undefined');
  assert.deepEqual(await run('compactDecoded'), [target]);
  await run(`if(document.getElementById('atlas-directory').hidden)document.getElementById('atlas-directory-toggle').click();document.querySelector('[data-atlas-diagram="${bundle.entry}"]').click();`);
  await wait(bundle.entry);
  assert.deepEqual(await run('compactDecoded'), [target, bundle.entry]);
  assert.equal(await run('document.querySelectorAll("iframe").length'), 1);
  assert.deepEqual(await run('compactErrors'), []);
  const traceDirectory = process.env.ARCHIFY_COMPACT_EVIDENCE
    ? path.join(path.dirname(process.env.ARCHIFY_COMPACT_EVIDENCE), 'openpi-transitions') : path.join(directory, 'transitions');
  const trace = await collectProcessEvidence({ directory: traceDirectory,
    read: () => run('({frames:compactFrames.splice(0),events:[],sample:compactSample()})'),
    capture: () => send('Page.captureScreenshot', { format: 'png' }),
    timestamp: () => run('performance.now()'),
    action: async () => {
      for (const id of [nested.to, target]) {
        await run(`document.querySelector('[data-atlas-diagram="${id}"]').click()`); await wait(id);
      }
      await run('history.back()'); await wait(nested.to);
      await run('history.back()'); await wait(bundle.entry);
    },
  });
  assert.deepEqual(trace.errors, []);
  assert.ok(trace.images.length > 0);
  for (const frame of trace.frames.filter(frame => frame.everReady)) {
    assert.ok(frame.frames.some(child => child.visible && child.graph), 'Committed graph must remain visible during navigation');
    assert.ok(frame.frames.length <= 2, 'At most current and candidate');
  }
  const decoded = await run('compactDecoded');
  const outcomes = [];
  const pattern = /(<script id="archify-atlas-data" type="application\/json">)([\s\S]*?)(<\/script>)/;
  const envelope = JSON.parse(html.match(pattern)[2]);
  const packed = decodeAtlasPayload(html.match(pattern)[2]).payload;
  for (const [name, mutate] of [
    ['version', p => { p.bundle_version = 99; }],
    ['metadata', p => { p.metadata = ['{']; }],
    ['member-fields', p => { const metadata = JSON.parse(p.metadata.join('')); metadata.members[bundle.entry].nodes = null; p.metadata = [JSON.stringify(metadata)]; }],
    ['resource', p => { p.resources[0] = [false]; }],
    ['missing-member', p => { delete p.documents[bundle.entry]; }],
    ['reference', p => { p.documents[bundle.entry] = [-1]; }],
  ]) {
    const changed = structuredClone(packed); mutate(changed);
    const broken = path.join(directory, name + '.html');
    fs.writeFileSync(broken, html.replace(pattern, (_, a, b, c) => a + serializeAtlasPayload(changed) + c));
    await send('Page.navigate', { url: pathToFileURL(broken).href });
    const outcome = await run(`new Promise((resolve,reject)=>{let tries=0;const timer=setInterval(()=>{
      const error=document.getElementById('atlas-error');
      if(error&&!error.hidden){clearInterval(timer);resolve({error:error.textContent,retry:!!error.querySelector('button'),frames:document.querySelectorAll('iframe').length,uncaught:compactErrors});}
      else if(++tries>150){clearInterval(timer);reject(new Error('No format error surface'));}
    },20);})`);
    assert.equal(outcome.retry, true); assert.equal(outcome.frames, 0); assert.deepEqual(outcome.uncaught, []);
    outcomes.push({ name, ...outcome });
  }
  for (const [name, mutate] of [
    ['envelope-version', value => { value.envelope_version = 99; }],
    ['envelope-base64', value => { value.chunks[0] = `!${value.chunks[0].slice(1)}`; }],
    ['envelope-length', value => { value.uncompressed_bytes += 1; }],
    ['envelope-digest', value => { value.payload_sha256 = '0'.repeat(64); }],
  ]) {
    const changed = structuredClone(envelope); mutate(changed);
    const broken = path.join(directory, name + '.html');
    fs.writeFileSync(broken, html.replace(pattern, (_, a, b, c) => a + serializeScriptJson(changed, 2) + c));
    await send('Page.navigate', { url: pathToFileURL(broken).href });
    const outcome = await run(`new Promise((resolve,reject)=>{let tries=0;const timer=setInterval(()=>{
      const error=document.getElementById('atlas-error');
      if(error&&!error.hidden){clearInterval(timer);resolve({error:error.textContent,retry:!!error.querySelector('button'),frames:document.querySelectorAll('iframe').length,uncaught:compactErrors});}
      else if(++tries>150){clearInterval(timer);reject(new Error('No envelope error surface'));}
    },20);})`);
    assert.equal(outcome.retry, true); assert.equal(outcome.frames, 0); assert.deepEqual(outcome.uncaught, []);
    outcomes.push({ name, ...outcome });
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    if(window===parent)Object.defineProperty(globalThis,'DecompressionStream',{value:undefined,configurable:true});
  ` });
  await send('Page.navigate', { url: pathToFileURL(output).href + '?theme=dark#diagram=' + target });
  await wait(target);
  assert.equal(await run('document.documentElement.dataset.atlasDecoder'), 'fallback');
  assert.equal(await run('typeof globalThis.ArchifyGzipFallback'), 'undefined');
  assert.equal(await run('document.querySelectorAll("iframe").length'), 1);
  assert.deepEqual(await run('compactErrors'), []);
  if (process.env.ARCHIFY_COMPACT_EVIDENCE) fs.writeFileSync(process.env.ARCHIFY_COMPACT_EVIDENCE,
    JSON.stringify({ artifact: { path: output, ...byteReceipt(html) }, coldTarget: target,
      decoded, process: { directory: traceDirectory, frames: trace.frames.length, screenshots: trace.images.length },
      malformed: outcomes, browser: await browser.cdp.send('Browser.getVersion') }, null, 2));
});
