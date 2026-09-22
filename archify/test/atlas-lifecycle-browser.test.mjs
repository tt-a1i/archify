import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;
test('atlas preserves clipboard capability, defers export navigation and disposes Back recordings', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for real clipboard and lifecycle acceptance.',
}, async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-atlas-lifecycle-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const atlas = path.join(directory, 'atlas.html');
  const standalone = path.join(directory, 'standalone.html');
  execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', 'atlas', path.join(root, 'examples/atlas/project.atlas.json'), atlas]);
  execFileSync(process.execPath, [path.join(root, 'bin/archify.mjs'), 'deliver', 'architecture', path.join(root, 'examples/atlas/payment.architecture.json'), standalone]);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.lifecycleErrors=[];window.lifecycleDownloads=[];window.lifecycleTracks=[];window.lifecycleToolbarClicks=[];
    window.lifecycleAlerts=[];window.lifecycleBlobCreates=0;window.lifecycleRevokeListeners=new Set();
    window.alert=message=>lifecycleAlerts.push(String(message));
    addEventListener('error',e=>lifecycleErrors.push(e.message));addEventListener('unhandledrejection',e=>lifecycleErrors.push(String(e.reason)));
    document.addEventListener('click',event=>{const button=event.target.closest?.('button');if(button?.closest('.toolbar'))lifecycleToolbarClicks.push({id:button.id,action:button.dataset.action,trusted:event.isTrusted,disabled:button.disabled});},true);
    const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download){lifecycleDownloads.push(this.download);return;}return click.call(this);};
    const capture=HTMLCanvasElement.prototype.captureStream;if(capture)HTMLCanvasElement.prototype.captureStream=function(...args){const stream=capture.apply(this,args);lifecycleTracks.push(...stream.getTracks());return stream;};
    const create=URL.createObjectURL.bind(URL);URL.createObjectURL=blob=>{lifecycleBlobCreates++;return create(blob);};
    const add=window.addEventListener.bind(window),remove=window.removeEventListener.bind(window);
    window.addEventListener=function(type,listener,options){if(type==='archify:atlas-revoke' && options?.once)lifecycleRevokeListeners.add(listener);return add(type,listener,options);};
    window.removeEventListener=function(type,listener,options){if(type==='archify:atlas-revoke')lifecycleRevokeListeners.delete(listener);return remove(type,listener,options);};
    if(parent===window){
      window.lifecycleFramesAdded=0;window.lifecycleHeld=[];window.lifecycleHoldDiagram=null;
      new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.nodeName==='IFRAME')lifecycleFramesAdded++;}).observe(document,{childList:true,subtree:true});
      addEventListener('message',event=>{
        if(event.data?.archifyAtlas===1 && event.data.type==='ready' && event.source?.ArchifyAddress?.context?.diagram===lifecycleHoldDiagram){
          event.stopImmediatePropagation();lifecycleHeld.push({data:event.data,source:event.source});
        }
      },true);
    }
  ` });
  let inAtlas = false;
  async function run(expression, outer = false) {
    const result = await send('Runtime.evaluate', { expression: inAtlas && !outer ? `document.querySelector('iframe[data-atlas-state=active]').contentWindow.eval(${JSON.stringify(expression)})` : expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  async function ready(diagram = 'payment') {
    await run(`new Promise((resolve,reject)=>{let tries=0;const timer=setInterval(()=>{
      const child=${inAtlas ? "document.querySelector('iframe[data-atlas-state=active]')?.contentWindow" : 'window'};
      if(child?.Archify && (!child.ArchifyAddress.context || (child.ArchifyAddress.active && !child.ArchifyAddress.restoring && child.ArchifyAddress.context.diagram===${JSON.stringify(diagram)}))){clearInterval(timer);resolve();}
      else if(++tries>300){clearInterval(timer);reject(new Error('Viewer did not become ready'));}
    },50);})`, true);
  }
  async function load(file) {
    inAtlas = file === atlas;
    await send('Page.navigate', { url: pathToFileURL(file).href + (inAtlas ? '#diagram=payment' : '') });
    await ready();
  }
  async function clickToolbar(selector) {
    const point = await run(`(() => {
      const node=document.querySelector(${JSON.stringify(selector)}),rect=node?.getBoundingClientRect();
      if(!rect?.width || !rect.height)throw new Error('Missing visible toolbar action: '+${JSON.stringify(selector)});
      const point={x:rect.x+rect.width/2,y:rect.y+rect.height/2},hit=document.elementFromPoint(point.x,point.y);
      window.lifecycleLastClick={selector:${JSON.stringify(selector)},...point,hit:{tag:hit?.tagName,id:hit?.id,action:hit?.closest('button')?.dataset.action}};
      return point;
    })()`, true);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function until(expression, message) {
    await run(`new Promise((resolve,reject)=>{let tries=0;const timer=setInterval(()=>{
      if(${expression}){clearInterval(timer);resolve();}
      else if(++tries>300){clearInterval(timer);reject(new Error(${JSON.stringify(message)}));}
    },30);})`, true);
  }
  // Browser permissions apply to this isolated test browser, using the actual
  // clipboard implementation rather than replacing navigator.clipboard.
  for (const name of ['clipboard-read', 'clipboard-write']) await browser.cdp.send('Browser.setPermission', {
    permission: { name, allowWithoutGesture: true }, setting: 'granted',
  });
  for (const file of [standalone, atlas]) {
    await load(file);
    // Exercise the visible toolbar, retaining its real focus. Reading from
    // the inactive member document would itself throw NotAllowedError and
    // hide a preceding copy failure that silently downloaded a fallback PNG.
    await run(`navigator.clipboard.writeText('Atlas lifecycle clipboard sentinel')`, true);
    await clickToolbar('#btn-export');
    await clickToolbar('#export-menu [data-action="copy-share-card"]');
    await run(`new Promise((resolve,reject)=>{let tries=0;const timer=setInterval(()=>{
      if(document.documentElement.getAttribute('data-last-export-format')==='share-card' || lifecycleDownloads.length || document.documentElement.hasAttribute('data-last-export-error')){clearInterval(timer);resolve();}
      else if(++tries>200){
        clearInterval(timer);
        const inspect=owner=>{
          const doc=owner.document,active=doc.activeElement;
          return {href:owner.location.href,focused:doc.hasFocus(),focus:{tag:active?.tagName,id:active?.id,action:active?.dataset?.action},
            address:{diagram:owner.ArchifyAddress?.context?.diagram,active:owner.ArchifyAddress?.active,restoring:owner.ArchifyAddress?.restoring,exportAllowed:owner.ArchifyAddress?.exportAllowed},
            attrs:Object.fromEntries([...doc.documentElement.attributes].filter(attr=>/export|motion|atlas/.test(attr.name)).map(attr=>[attr.name,attr.value])),
            alerts:owner.lifecycleAlerts,errors:owner.lifecycleErrors,downloads:owner.lifecycleDownloads,blobs:owner.lifecycleBlobCreates,
            busy:doc.documentElement.hasAttribute('data-atlas-export-busy'),clicks:owner.lifecycleToolbarClicks,lastClick:owner.lifecycleLastClick,
            clipboard:{secure:owner.isSecureContext,write:typeof owner.navigator.clipboard?.write,ClipboardItem:typeof owner.ClipboardItem},
            buttons:['#btn-export','#export-menu [data-action="copy-share-card"]'].map(selector=>{const node=doc.querySelector(selector),style=node&&owner.getComputedStyle(node);return {selector,present:!!node,disabled:node?.disabled,hidden:node?.hidden,inert:!!node?.closest('[inert]'),display:style?.display,visibility:style?.visibility,rect:node?.getBoundingClientRect().toJSON()};})};
        };
        let host;
        try{const owner=window.ArchifyToolbarHost?.clipboardWindow?.();host={available:typeof window.ArchifyToolbarHost?.clipboardWindow==='function',exists:!!owner,isOuter:owner===parent,isMember:owner===window,focused:owner?.document.hasFocus(),ClipboardItem:typeof owner?.ClipboardItem,write:typeof owner?.navigator.clipboard?.write};}
        catch(error){host={error:error.message};}
        reject(new Error('Clipboard action did not finish: '+JSON.stringify({member:inspect(window),outer:inspect(parent),host})));
      }
    },30);})`);
    const outcome = await run(`({downloads:lifecycleDownloads,errors:lifecycleErrors,
      format:document.documentElement.getAttribute('data-last-export-format'),
      fallback:[...document.querySelectorAll('.archify-toast')].some(node=>node.textContent.includes('剪贴板不可用'))})`);
    assert.deepEqual(outcome, { downloads: [], errors: [], format: 'share-card', fallback: false },
      `${inAtlas ? 'Atlas outer toolbar' : 'Standalone toolbar'} must copy without falling back to a download`);
    assert.equal(await run('document.activeElement.id', true), 'btn-export', 'Copy must retain the visible toolbar focus');
    const copied = await run(`(async()=>{
      const items=await navigator.clipboard.read();
      const item=items.find(item=>item.types.includes('image/png'));if(!item)throw new Error('No clipboard PNG');
      const image=await createImageBitmap(await item.getType('image/png'));
      const result={width:image.width,height:image.height};image.close();return result;
    })()`, true);
    assert.deepEqual(copied, { width: 1200, height: 630 });
  }
  await browser.cdp.send('Browser.resetPermissions');
  for (const allowWithoutGesture of [false, true]) await browser.cdp.send('Browser.setPermission', {
    permission: { name: 'clipboard-write', allowWithoutGesture }, setting: 'denied',
  });
  await run('Archify.exportMenu.copyShareCard()');
  assert.equal((await run('lifecycleDownloads')).length, 1);
  assert.match(await run('document.body.textContent'), /剪贴板不可用/);
  await browser.cdp.send('Browser.resetPermissions');

  await run(`Archify.focus.set('controller',{toggle:false});new Promise(resolve=>setTimeout(resolve,0))`);
  await run(`window.recordingAtlas=document.querySelector('iframe[data-atlas-state=active]').contentWindow;
    recordingAtlas.lifecycleDownloads.length=0;
    recordingAtlas.recordingTask=recordingAtlas.Archify.exportMenu.run('webm');void 0;`, true);
  await until('recordingAtlas.lifecycleTracks.some(track=>track.readyState==="live")', 'Queued export must begin a real recording');
  const queuedVisit = await run('({href:location.href,history:history.length})', true);
  await run(`lifecycleFramesAdded=0;
    if(document.getElementById('atlas-directory').hidden)document.getElementById('atlas-directory-toggle').click();
    for(const diagram of ['system','orders','worker'])document.querySelector('[data-atlas-diagram="'+diagram+'"]').click();
    new Promise(resolve=>setTimeout(resolve,350));`, true);
  assert.deepEqual(await run(`({href:location.href,history:history.length,frames:document.querySelectorAll('iframe').length,
    created:lifecycleFramesAdded,active:recordingAtlas.ArchifyAddress.active,
    tracks:recordingAtlas.lifecycleTracks.map(track=>track.readyState),
    busy:recordingAtlas.document.documentElement.hasAttribute('data-atlas-export-busy')})`, true),
  { ...queuedVisit, frames: 1, created: 0, active: true, tracks: ['live'], busy: true },
  'Export waiting must keep the actual recording live and must not create any candidate');
  assert.match(await run('document.querySelector(".atlas-host-status").textContent', true), /导出完成后进入/);
  await ready('worker');
  await run('recordingAtlas.recordingTask', true);
  assert.deepEqual(await run(`({history:history.length,frames:document.querySelectorAll('iframe').length,created:lifecycleFramesAdded,
    active:recordingAtlas.ArchifyAddress.active,
    tracks:recordingAtlas.lifecycleTracks.map(track=>track.readyState),listeners:recordingAtlas.lifecycleRevokeListeners.size,
    busy:recordingAtlas.document.documentElement.hasAttribute('data-atlas-export-busy'),errors:recordingAtlas.lifecycleErrors})`, true),
  { history: queuedVisit.history + 1, frames: 1, created: 1, active: false,
    tracks: ['ended'], listeners: 0, busy: false, errors: [] }, 'Only the final queued target may create a visit after the original recording finishes');
  const recordingDownloads = await run('recordingAtlas.lifecycleDownloads', true);
  assert.equal(recordingDownloads.length, 1, 'Admitted recording must complete its original download');
  assert.match(recordingDownloads[0], /\.webm$/);

  // Hold a real candidate after its layout preparation. All public entry
  // points must remain gated, including Blob-producing APIs outside the menu.
  await run(`window.preparingAtlas=document.querySelector('iframe[data-atlas-state=active]').contentWindow;
    lifecycleHoldDiagram='orders';document.querySelector('[data-atlas-diagram="orders"]').click();`, true);
  await until('lifecycleHeld.length>0', 'Expected a held candidate ready message');
  for (const state of ['active', 'staging']) {
    const blocked = await run(`document.querySelector('iframe[data-atlas-state=${state}]').contentWindow.eval(${JSON.stringify(`(async()=>{
      const before={downloads:lifecycleDownloads.length,tracks:lifecycleTracks.length,blobs:lifecycleBlobCreates};
      const results=await Promise.all([
        ...['svg','png','jpeg','webp','share-card','webm'].map(format=>Archify.exportMenu.run(format)),
        Archify.exportMenu.shareCard(),Archify.motion.recordWebm({duration:300}),
        Archify.exportMenu.downloadRouteShareCard(),Archify.exportMenu.downloadReachShareCard(),Archify.exportMenu.copyShareCard()
      ]);
      return {allowed:ArchifyAddress.exportAllowed,empty:results.every(value=>value===undefined),
        unchanged:before.downloads===lifecycleDownloads.length && before.tracks===lifecycleTracks.length && before.blobs===lifecycleBlobCreates,
        busy:document.documentElement.hasAttribute('data-atlas-export-busy'),errors:lifecycleErrors,alerts:lifecycleAlerts};
    })()`)})`, true);
    assert.deepEqual(blocked, { allowed: false, empty: true, unchanged: true, busy: false, errors: [], alerts: [] },
      `${state} viewer must refuse every new public export without allocating a Blob URL, track or download`);
  }
  assert.equal(await run('document.getElementById("btn-export").disabled', true), true);
  await run(`lifecycleHoldDiagram=null;for(const item of lifecycleHeld.splice(0))dispatchEvent(new MessageEvent('message',{data:item.data,source:item.source}));`, true);
  await ready('orders');
  await run('Archify.exportMenu.run("svg")');
  assert.equal((await run('lifecycleDownloads')).length, 1, 'The newly committed current member can export again');
  assert.equal(await run('document.getElementById("btn-export").disabled', true), false);
  assert.equal(await run('preparingAtlas.ArchifyAddress.active', true), false);
  await run(`Promise.all([preparingAtlas.Archify.exportMenu.run('svg'),preparingAtlas.Archify.motion.recordWebm({duration:300})])`, true);
  assert.deepEqual(await run('preparingAtlas.lifecycleDownloads', true), [], 'A retired viewer cannot start a late export');
  await run('history.back()', true); await ready('worker');

  await run('history.back()', true); await ready('payment');
  await run(`document.querySelector('[data-atlas-detail="controller"]').click()`); await ready('worker');
  await run(`window.retiredAtlas=document.querySelector('iframe[data-atlas-state=active]').contentWindow;retiredAtlas.recordingTask=retiredAtlas.Archify.exportMenu.run('webm');void 0;`, true);
  await run(`new Promise((resolve,reject)=>{let tries=0;const timer=setInterval(()=>{
    if(retiredAtlas.lifecycleTracks.length){clearInterval(timer);resolve();}
    else if(++tries>100){clearInterval(timer);reject(new Error('Recording did not start'));}
  },30);})`, true);
  await run('history.back()', true); await ready('payment');
  await run('retiredAtlas.recordingTask', true);
  assert.deepEqual(await run('retiredAtlas.lifecycleTracks.map(track=>track.readyState)', true), ['ended']);
  assert.equal(await run('retiredAtlas.lifecycleRevokeListeners.size', true), 0, 'Revocation removes the actual recording listener');
  assert.equal(await run('retiredAtlas.document.documentElement.hasAttribute("data-atlas-export-busy")', true), false);
  assert.deepEqual(await run('retiredAtlas.lifecycleDownloads', true), []);
  assert.equal(await run('retiredAtlas.ArchifyAddress.active', true), false);

  await run(`document.getElementById('btn-present').click()`, true);
  assert.equal(await run('Archify.presentation.active()'), true);
  assert.match(await run('location.search', true), /present=1/);
  assert.equal(await run('document.querySelector(".atlas-breadcrumb button").getBoundingClientRect().height>0'), true);
  await run(`if(document.getElementById('atlas-directory').hidden)document.getElementById('atlas-directory-toggle').click()`, true);
  assert.equal(await run('document.getElementById("atlas-directory-toggle").getBoundingClientRect().height>0 && getComputedStyle(document.getElementById("atlas-directory")).display!=="none"', true), true,
    'Presentation keeps its visible directory control usable');
});
