import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Export preserves menu, clipboard, semantic cards and recording lifecycles', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser Export checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-export-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidence = process.env.ARCHIFY_EXPORT_RUNTIME_EVIDENCE;
  const records = [];
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  t.after(() => { if (evidence) fs.writeFileSync(path.join(evidence, 'observations.json'), JSON.stringify(records, null, 2) + '\n'); });
  const input = path.join(scratch, 'motion.json');
  const file = path.join(scratch, 'motion.html');
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  source.meta.animation = 'trace';
  source.meta.visual_preset = 'signal-flow';
  fs.writeFileSync(input, JSON.stringify(source));
  execFileSync(process.execPath, [path.join(skillRoot, 'renderers/architecture/render-architecture.mjs'), input, file]);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  // Instrument browser boundaries only: all serialization, drawing and encoding
  // remain production code. Each navigation restores the original environment.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.exportErrors=[];window.exportAlerts=[];window.exportConsole=[];
    addEventListener('error',e=>exportErrors.push(e.message));
    addEventListener('unhandledrejection',e=>exportErrors.push(String(e.reason)));
    window.alert=message=>exportAlerts.push(message);
    console.error=(...args)=>exportConsole.push(args.map(String).join(' '));
    window.exportUrls=new Map();window.exportDownloads=[];window.exportTracks=[];window.exportCancelled=[];
    const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL);
    URL.createObjectURL=blob=>{const url=create(blob);exportUrls.set(url,{blob,revoked:false});return url;};
    URL.revokeObjectURL=url=>{const item=exportUrls.get(url);if(item)item.revoked=true;revoke(url);};
    const click=HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click=function(){if(this.download){exportDownloads.push({name:this.download,blob:exportUrls.get(this.href).blob,attached:this.isConnected});return;}return click.call(this);};
    const capture=HTMLCanvasElement.prototype.captureStream;
    if(capture)HTMLCanvasElement.prototype.captureStream=function(...args){const stream=capture.apply(this,args);exportTracks.push(...stream.getTracks());return stream;};
    const cancel=window.cancelAnimationFrame;
    window.cancelAnimationFrame=id=>{exportCancelled.push(id);return cancel(id);};
    // Activation can survive asynchronous work. Observe the actual handler
    // stack so even a microtask cannot masquerade as synchronous construction.
    window.copyInClickHandler=false;
    const listen=EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener=function(type,listener,options){
      if(this.id==='export-menu'&&type==='click'&&typeof listener==='function'){
        const handler=listener;
        listener=function(event){
          copyInClickHandler=true;
          try{return handler.call(this,event);}finally{copyInClickHandler=false;}
        };
      }
      return listen.call(this,type,listener,options);
    };
    window.exportWait=predicate=>new Promise((resolve,reject)=>{const start=performance.now();function poll(){if(predicate())return resolve();if(performance.now()-start>12000)return reject(new Error('Export observation timed out'));setTimeout(poll,20);}poll();});
    const fault=new URL(location.href).searchParams.get('fault');
    if(fault==='unsupported'){window.MediaRecorder=undefined;window.ClipboardItem=undefined;HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,';}
  ` });
  async function load({ width = 1440, theme = 'dark', extra = '' } = {}) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(file).href + '?theme=' + theme + extra });
    await loaded;
    await run('document.fonts.ready');
    await run('Archify.readerLayout.whenStable()');
    await run('Archify.viewerChromeLayout.whenStable()');
  }
  async function key(key, code, windowsVirtualKeyCode) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode });
  }
  async function click(selector) {
    const point = await run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  }
  async function record(label) {
    const value = await run(`({open:Archify.exportMenu.isOpen(),expanded:document.getElementById('btn-export').getAttribute('aria-expanded'),
      active:document.activeElement.id||document.activeElement.dataset.action||document.activeElement.dataset.format,
      downloads:exportDownloads.map(d=>({name:d.name,type:d.blob.type,attached:d.attached})),
      urls:[...exportUrls.values()].map(u=>({type:u.blob.type,revoked:u.revoked})),tracks:exportTracks.map(t=>t.readyState),
      receipt:Object.fromEntries([...document.documentElement.attributes].filter(a=>a.name.startsWith('data-last-export-')&&!a.name.endsWith('-bytes')).map(a=>[a.name,a.value])),
      errors:exportErrors,alerts:exportAlerts,console:exportConsole,
      external:performance.getEntriesByType('resource').map(r=>r.name).filter(n=>/^https?:/.test(n))})`);
    assert.deepEqual(value.errors, [], label);
    assert.deepEqual(value.external, [], label);
    records.push({ label, ...value });
    return value;
  }
  const route = `Archify.routeProbe.begin({source:'users',focusNode:false});if(!Archify.routeProbe.choose('db',{updateUrl:false}))throw new Error('route fixture failed');`;
  const reach = `Archify.focus.set('api',{toggle:false,updateUrl:false});if(!Archify.focus.reach('downstream',{toggle:false,updateUrl:false,reveal:false}))throw new Error('reach fixture failed');`;

  await t.test('native menu input skips unavailable entries and preserves focus and mutual exclusion', async () => {
    for (const width of [390, 720, 1440]) {
      await load({ width, extra: '&fault=unsupported' });
      assert.deepEqual(await run('Object.keys(Archify.exportMenu).sort()'), ['close','copyShareCard','downloadReachShareCard','downloadRouteShareCard','isOpen','open','run','shareCard','syncReachShare','syncRouteShare'].sort());
      assert.deepEqual(await run('Object.keys(Archify.motion).sort()'), ['canRecord','recordWebm']);
      assert.deepEqual(await run(`[...document.querySelectorAll('#export-menu [data-format="jpeg"],#export-menu [data-format="webp"],#export-menu [data-format="webm"],#export-menu [data-action="copy"]')].map(e=>e.disabled)`), [true,true,true,true]);
      await run(`document.getElementById('btn-export').focus()`);
      await key('ArrowUp', 'ArrowUp', 38);
      const last = await run(`document.activeElement.dataset.format||document.activeElement.dataset.action`);
      await key('Home', 'Home', 36);
      const first = await run(`document.activeElement.dataset.format||document.activeElement.dataset.action`);
      assert.notEqual(first, last);
      await key('ArrowUp', 'ArrowUp', 38);
      assert.equal(await run(`document.activeElement.dataset.format||document.activeElement.dataset.action`), last);
      await key('ArrowDown', 'ArrowDown', 40);
      assert.equal(await run(`document.activeElement.dataset.format||document.activeElement.dataset.action`), first);
      await key('End', 'End', 35);
      assert.equal(await run(`document.activeElement.dataset.format||document.activeElement.dataset.action`), last);
      await key('Escape', 'Escape', 27);
      assert.equal((await record('escape-' + width)).active, 'btn-export');
      assert.equal(await run('Archify.exportMenu.isOpen()'), false);
      await click('#btn-export');
      await key('Tab', 'Tab', 9);
      assert.equal(await run('Archify.exportMenu.isOpen()'), false);
      await click('#btn-export');
      assert.equal(await run(`document.getElementById('export-menu').contains(document.elementFromPoint(5,5))`), false);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 5, y: 5, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 5, y: 5, button: 'left', clickCount: 1 });
      assert.equal(await run('Archify.exportMenu.isOpen()'), false);
      await run('Archify.preset.open();Archify.exportMenu.open()');
      assert.equal(await run('Archify.preset.isOpen()'), false);
      await run('Archify.semanticLens.open();Archify.exportMenu.open()');
      assert.equal(await run('Archify.semanticLens.isOpen()'), false);
      const state = await record('menu-' + width);
      assert.equal(state.open, true);assert.equal(state.expanded, 'true');assert.deepEqual(state.console, []);
    }
  });

  await t.test('auto-open and themed menu rendering keep stable layout', async () => {
    for (const theme of ['dark', 'light']) {
      await load({ theme, extra: '&openExport=1' });
      await run('exportWait(()=>Archify.exportMenu.isOpen())');
      const state = await record('auto-' + theme);
      assert.equal(state.expanded, 'true');assert.deepEqual(state.console, []);
      if (evidence) {
        await run(`Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{})))`);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(evidence, theme + '-menu.png'), Buffer.from(shot.data, 'base64'));
      }
    }
  });

  await t.test('semantic card downloads retain snapshots, receipts and URL lifetime', async () => {
    for (const variant of ['route', 'reach']) {
      await load();await run(variant === 'route' ? route : reach);
      await run(`Archify.exportMenu.open();document.querySelector('[data-action="${variant}-share-card"]').focus()`);
      const result = await run(`(async()=>{let triggerFocus=0;const trigger=document.getElementById('btn-export');const onFocus=()=>triggerFocus++;trigger.addEventListener('focus',onFocus);const blob=await Archify.exportMenu.${variant === 'route' ? 'downloadRouteShareCard' : 'downloadReachShareCard'}();const image=await createImageBitmap(blob);const dimensions=[image.width,image.height];image.close();trigger.removeEventListener('focus',onFocus);return {dimensions,triggerFocus,type:blob.type};})()`);
      assert.deepEqual(result, { dimensions: [1200,630], triggerFocus: 0, type: 'image/png' });
      const live = await record(variant + '-download');
      assert.equal(live.receipt['data-last-export-variant'], variant);
      assert.equal(live.receipt['data-last-export-canonical'], 'false');
      assert.equal(live.receipt['data-last-export-' + variant + '-state-clean'], 'true');
      assert.ok(live.downloads[0].name.endsWith(variant === 'route' ? '-route-share-card.png' : '-downstream-reach-share-card.png'));
      assert.deepEqual(live.urls.map(u=>u.revoked), [true,false]);
      assert.equal(await run(`document.querySelectorAll('a[download]').length`), 0);
      await run('exportWait(()=>[...exportUrls.values()].every(u=>u.revoked))');
      assert.deepEqual((await record(variant + '-released')).urls.map(u=>u.revoked), [true,true]);
      await run(`Archify.exportMenu.open();${variant === 'route' ? 'Archify.routeProbe.clear()' : 'Archify.focus.clearReach()'};`);
      assert.equal(await run(`document.querySelector('[data-action="${variant}-share-card"]').hidden`), true);
      await run(`Archify.exportMenu.${variant === 'route' ? 'downloadRouteShareCard' : 'downloadReachShareCard'}()`);
      const missing = await record(variant + '-invalidated');
      assert.equal(missing.receipt['data-last-export-error-format'], 'share-card');
      assert.equal(missing.receipt['data-last-export-variant'], undefined);assert.equal(missing.alerts.length, 1);
      // An invalid provider snapshot must not be sanitized into a different route.
      await run(variant === 'route' ? route : reach);
      await run(`(()=>{const provider=${variant === 'route' ? 'Archify.routeProbe' : 'Archify.focus'};const method=${JSON.stringify(variant === 'route' ? 'exportSnapshot' : 'reachabilitySnapshot')};const snapshot=provider[method]();snapshot.nodeIds=['missing'];provider[method]=()=>snapshot;})()`);
      assert.equal(await run(`Archify.exportMenu.shareCard({variant:${JSON.stringify(variant)}}).then(()=>false,()=>true)`), true);
      assert.equal((await record(variant + '-malformed')).downloads.length, 1);
    }
  });

  await t.test('clipboard keeps promise construction in the click and distinct fallback/error receipts', async () => {
    for (const action of ['copy','copy-share-card']) for (const mode of ['promise','fallback','reject']) {
      await load();
      await run(`window.copyCalls=[];window.copyDone=false;window.copyBlob=null;
        window.ClipboardItem=class {constructor(data){const value=data['image/png'];copyCalls.push({promise:value instanceof Promise,gesture:navigator.userActivation.isActive,inClickHandler:copyInClickHandler});if(${JSON.stringify(mode)}==='fallback'&&value instanceof Promise)throw new Error('promise unsupported');this.value=value;}};
        Object.defineProperty(navigator,'clipboard',{configurable:true,value:{write(items){copyCalls.push({write:true});if(${JSON.stringify(mode)}==='reject'){copyDone=true;return Promise.reject(new Error('clipboard denied'));}return Promise.resolve(items[0].value).then(blob=>{copyBlob=blob;copyDone=true;});}}});
        document.querySelector('[data-action="${action}"]').disabled=false;Archify.exportMenu.open();`);
      await click(`[data-action="${action}"]`);
      await run(`exportWait(()=>copyDone&&(${JSON.stringify(mode)}==='reject'?exportAlerts.length>0:${JSON.stringify(action)}==='copy-share-card'?document.documentElement.hasAttribute('data-last-export-format'):document.querySelector('.archify-toast').textContent.length>0))`);
      const calls = await run('copyCalls');
      assert.deepEqual(calls[0], { promise: true, gesture: true, inClickHandler: true });
      if (mode === 'fallback') assert.equal(calls[1].inClickHandler, false, 'Blob fallback remains asynchronous');
      assert.deepEqual(calls.map(c=>c.write?'write':c.promise?'promise':'blob'), mode === 'fallback' ? ['promise','blob','write'] : ['promise','write']);
      const state = await record(action + '-' + mode);
      assert.equal(state.active, 'btn-export');
      if (mode !== 'reject') {
        assert.equal(await run('copyBlob.type'), 'image/png');
        const dims = await run('(async()=>{const b=await createImageBitmap(copyBlob);const size=[b.width,b.height];b.close();return size;})()');
        if (action === 'copy-share-card') assert.deepEqual(dims,[1200,630]);
        else assert.ok(dims[0] > 1200);
        assert.equal(state.receipt['data-last-export-format'], action === 'copy-share-card' ? 'share-card' : undefined);
      } else {
        assert.equal(state.alerts.length,1);
        assert.equal(state.receipt['data-last-export-error-format'], action === 'copy-share-card' ? 'share-card' : undefined);
      }
      await run('exportWait(()=>[...exportUrls.values()].every(u=>u.revoked))');
    }
    await load({extra:'&fault=unsupported'});
    assert.equal(await run('Archify.exportMenu.copyShareCard() === undefined'), true);
    assert.equal((await record('clipboard-unavailable')).alerts.length, 1);
  });

  await t.test('raster failures release sources and retain retry and synchronous SVG behavior', async () => {
    for (const fault of ['image','context','null-blob']) {
      await load();
      await run(`window.savedImage=Image;window.savedContext=HTMLCanvasElement.prototype.getContext;window.savedToBlob=HTMLCanvasElement.prototype.toBlob;`);
      if (fault === 'image') await run(`window.Image=class {set src(value){queueMicrotask(()=>this.onerror(new Error('image failed')));}}`);
      if (fault === 'context') await run('HTMLCanvasElement.prototype.getContext=()=>null');
      if (fault === 'null-blob') await run('HTMLCanvasElement.prototype.toBlob=function(callback){callback(null)}');
      await run(`Archify.exportMenu.run('png')`);
      const state = await record('raster-' + fault);
      assert.equal(state.receipt['data-last-export-error-format'],'png');assert.equal(state.alerts.length,1);
      assert.equal(state.urls.length,1);assert.equal(state.urls[0].revoked,true);assert.deepEqual(state.downloads,[]);
      await run(`window.Image=savedImage;HTMLCanvasElement.prototype.getContext=savedContext;HTMLCanvasElement.prototype.toBlob=savedToBlob;Archify.exportMenu.run('png')`);
      await run('exportWait(()=>exportDownloads.length===1)');
      assert.equal((await record('retry-' + fault)).receipt['data-last-export-error-format'],undefined);
    }
    await load();
    const sync = await run(`(()=>{const svg=document.querySelector('.diagram-container > svg'),clone=svg.cloneNode;svg.cloneNode=()=>{throw new Error('sync serialization')};try{Archify.exportMenu.run('svg');return false;}catch(e){return e.message==='sync serialization';}finally{svg.cloneNode=clone;}})()`);
    assert.equal(sync,true);assert.deepEqual((await record('svg-sync-throw')).receipt,{});
  });

  await t.test('recording succeeds with real encoding and releases tracks and the background URL', async () => {
    await load();assert.equal(await run('Archify.motion.canRecord()'),true);
    const result = await run(`(async()=>{const blob=await Archify.motion.recordWebm({duration:500,fps:10});window.recordedBlob=blob;const url=URL.createObjectURL(blob),video=document.createElement('video');video.muted=true;video.src=url;await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('WebM decode failed'));});const dimensions=[video.videoWidth,video.videoHeight];await video.play();await new Promise(resolve=>video.requestVideoFrameCallback(resolve));video.pause();video.removeAttribute('src');video.load();URL.revokeObjectURL(url);return {type:blob.type,nonempty:blob.size>0,dimensions,cancelled:exportCancelled.length>0};})()`);
    assert.match(result.type,/^video\/webm/);assert.equal(result.nonempty,true);assert.equal(result.cancelled,true);assert.ok(result.dimensions.every(n=>n>0&&n%2===0));
    const state = await record('webm-real');assert.ok(state.tracks.length>0);assert.ok(state.tracks.every(s=>s==='ended'));assert.ok(state.urls.every(u=>u.revoked));assert.deepEqual(state.console,[]);
    if(evidence){const bytes=await run(`(async()=>Array.from(new Uint8Array(await recordedBlob.arrayBuffer())))()`);fs.writeFileSync(path.join(evidence,'recording.webm'),Buffer.from(bytes));}
  });

  await t.test('menu recording writes its receipt and downloads the real default-duration WebM', async () => {
    await load();await run('Archify.exportMenu.open()');
    await click('[data-format="webm"]');
    await run('exportWait(()=>exportDownloads.length===1)');
    const state=await record('webm-download');
    assert.equal(state.active,'btn-export');assert.equal(state.receipt['data-last-export-format'],'webm');
    assert.equal(state.receipt['data-last-export-canonical'],'true');assert.deepEqual(state.console,[]);
    assert.ok(state.downloads[0].name.endsWith('.webm'));assert.match(state.downloads[0].type,/^video\/webm/);
    assert.equal(await run('Number(document.documentElement.dataset.lastMotionBytes)===exportDownloads[0].blob.size&&exportDownloads[0].blob.size>0'),true);
    assert.ok(state.tracks.length>0);assert.ok(state.tracks.every(s=>s==='ended'));
    assert.deepEqual(state.urls.map(u=>u.revoked),[true,false]);
    await run('exportWait(()=>[...exportUrls.values()].every(u=>u.revoked))');
  });

  await t.test('recording constructor/error/empty failures clean up and public run disables WebM', async () => {
    for (const fault of ['constructor','error','empty']) {
      await load();
      await run(`window.MediaRecorder=class {
        static isTypeSupported(){return true;}
        constructor(){if(${JSON.stringify(fault)}==='constructor')throw new Error('recorder constructor');this.state='inactive';this.mimeType='video/webm';}
        start(){this.state='recording';if(${JSON.stringify(fault)}==='error')setTimeout(()=>{this.state='inactive';this.onerror({error:new Error('recorder error')});},20);}
        requestData(){} stop(){this.state='inactive';this.onstop();}
      };`);
      assert.equal(await run('Archify.motion.recordWebm({duration:250,fps:10}).then(()=>false,()=>true)'),true);
      const state=await record('webm-'+fault);assert.ok(state.urls.every(u=>u.revoked));assert.ok(state.tracks.length>0);assert.ok(state.tracks.every(s=>s==='ended'));
    }
    await load({extra:'&fault=unsupported'});
    await run(`Archify.exportMenu.run('webm')`);
    const state=await record('webm-unavailable');assert.equal(state.receipt['data-last-export-error-format'],'webm');assert.deepEqual(state.alerts,[]);
    assert.deepEqual(await run(`(()=>{const b=document.querySelector('[data-format="webm"]');return {disabled:b.disabled,opacity:b.style.opacity};})()`),{disabled:true,opacity:'0.5'});
  });
});
