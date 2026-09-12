import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';
import { disposeBundleFixture, stageBundleFixture } from './helpers/bundle-fixture.mjs';

const skillRoot = fileURLToPath(new URL('../', import.meta.url));
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

async function serve(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server;
}

// L029: an ordinary diagram inside a real foreign-origin iframe must not
// acquire bundle-child behavior merely because its embedding page sends messages.
test('a cross-origin embedding host cannot turn an ordinary diagram into a bundle child', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for cross-origin bundle message checks.',
}, async () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-message-origin-'));
  let artifactServer, hostServer, browser;
  const observations = {};
  try {
    const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json')));
    source.meta.animation = 'trace';
    const spec = path.join(scratch, 'architecture.json');
    const artifact = path.join(scratch, 'architecture.html');
    fs.writeFileSync(spec, JSON.stringify(source));
    execFileSync(process.execPath, [path.join(skillRoot, 'bin/archify.mjs'), 'render', 'architecture', spec, artifact]);
    const html = fs.readFileSync(artifact);
    artifactServer = await serve((request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
    });
    const artifactOrigin = `http://127.0.0.1:${artifactServer.address().port}`;
    hostServer = await serve((request, response) => {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(`<!doctype html><title>Foreign embedding host</title>
        <button id="before">Before diagram</button>
        <iframe id="artifact" title="Architecture diagram" width="1200" height="640" src="${artifactOrigin}/architecture.html"></iframe>
        <button id="after">After diagram</button>
        <script>window.received = []; addEventListener('message', event => received.push({origin:event.origin,data:event.data}));</script>`);
    });
    const hostOrigin = `http://localhost:${hostServer.address().port}`;
    browser = new ChromeVisualBrowser(chrome);
    const parentSession = await browser.sessionPromise;
    const send = (method, params = {}, session = parentSession) => browser.cdp.send(method, params, session, 30000);
    async function evaluate(expression, session = parentSession) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
      return result.result?.value;
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
    const attached = browser.cdp.waitFor('Target.attachedToTarget', parentSession, 30000);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', parentSession, 30000);
    await send('Page.navigate', { url: `${hostOrigin}/host.html` });
    const target = await attached;
    assert.equal(target.targetInfo.type, 'iframe', 'The test must exercise a real out-of-process iframe.');
    const childSession = target.sessionId;
    await send('Runtime.enable', {}, childSession);
    await send('Page.enable', {}, childSession);
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.fixtureErrors = [];
      window.fixtureMessageListeners = 0;
      const add = window.addEventListener;
      window.addEventListener = function (type, ...args) {
        if (type === 'message') fixtureMessageListeners++;
        return add.call(this, type, ...args);
      };
      addEventListener('error', event => fixtureErrors.push(event.message));
      addEventListener('unhandledrejection', event => fixtureErrors.push(String(event.reason)));
    ` }, childSession);
    await send('Runtime.runIfWaitingForDebugger', {}, childSession);
    await loaded;
    await evaluate(`document.fonts.ready.then(() => Archify.readerLayout.whenStable()).then(() => Archify.viewerChromeLayout.whenStable())`, childSession);
    const identity = await evaluate(`({ origin: location.origin, isTop: parent === window,
      role: document.querySelector('.diagram-container svg').getAttribute('data-bundle-role'),
      referrer: document.referrer })`, childSession);
    observations.identity = identity;
    assert.equal(identity.origin, artifactOrigin);
    assert.equal(identity.isTop, false);
    assert.equal(identity.role, null);
    assert.equal(await evaluate('fixtureMessageListeners', childSession), 0, 'An ordinary Viewer must not register bundle message listeners.');
    assert.equal(new URL(identity.referrer).origin, hostOrigin);
    assert.equal(await evaluate(`(() => { try { document.getElementById('artifact').contentWindow.document; return false; } catch (error) { return error.name === 'SecurityError'; } })()`), true);

    await evaluate(`window.fixtureMessages = []; window.fixtureKeys = [];
      addEventListener('message', event => {
        fixtureMessages.push({type:event.data?.type,origin:event.origin,fromParent:event.source === parent,trusted:event.isTrusted});
        if (event.data?.type === 'fixture:barrier') parent.postMessage({type:'fixture:barrier-ack'}, event.origin);
      });
      addEventListener('keydown', event => fixtureKeys.push({key:event.key,prevented:event.defaultPrevented}));`, childSession);
    const state = () => evaluate(`({ nested:document.documentElement.getAttribute('data-bundle-nested'),
      level:document.documentElement.getAttribute('data-drilldown-level'), active:Archify.drilldown.active(),
      locate:document.querySelector('.diagram-container svg').getAttribute('data-locate-active'),
      projection:[...document.querySelectorAll('[data-locate-state]')].map(node => [node.getAttribute('data-node-id'),node.getAttribute('data-locate-state')]),
      focus:Archify.focus.active(), present:document.documentElement.getAttribute('data-present'),
      motion:Archify.motionGovernor.mode(), errors:fixtureErrors })`, childSession);
    const initial = await state();
    assert.equal(initial.nested, null); assert.equal(initial.active, false); assert.equal(initial.locate, null);
    assert.deepEqual(initial.errors, []);
    // All messages share a sender/target. The barrier reply proves the preceding
    // MessageEvents ran, without a timing sleep or a synthetic MessageEvent.
    const messages = [
      { type: 'archify:bundle-hello', expectedId: 'web-app', expectedSpecSha256: 'a'.repeat(64) },
      { type: 'archify:locate-projection', nodes: { users: 'touched', api: 'stale' } },
      { type: 'archify:drilldown-escape' },
      { type: 'archify:bundle-ack', id: 'web-app', specSha256: 'a'.repeat(64) },
    ];
    await evaluate(`new Promise(resolve => {
      function reply(event) {
        if (event.source === document.getElementById('artifact').contentWindow && event.data?.type === 'fixture:barrier-ack') {
          removeEventListener('message',reply); resolve();
        }
      }
      addEventListener('message',reply);
      const frame = document.getElementById('artifact').contentWindow;
      for (const message of ${JSON.stringify(messages)}) frame.postMessage(message, ${JSON.stringify(artifactOrigin)});
      frame.postMessage({type:'fixture:barrier'}, ${JSON.stringify(artifactOrigin)});
    })`);
    observations.afterMessages = await state();
    assert.deepEqual(observations.afterMessages, initial);
    const delivered = await evaluate('fixtureMessages', childSession);
    assert.deepEqual(delivered.map(row => row.type), [...messages.map(row => row.type), 'fixture:barrier']);
    assert.ok(delivered.every(row => row.origin === hostOrigin && row.fromParent && row.trusted));
    observations.messages = delivered;
    assert.deepEqual(await evaluate(`received.filter(row => row.data?.type.startsWith('archify:'))`), []);

    async function key(key, code, windowsVirtualKeyCode) {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode }, childSession);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode }, childSession);
    }
    await evaluate(`document.querySelector('.diagram-container svg').focus()`, childSession);
    await key('Escape', 'Escape', 27);
    await key('Backspace', 'Backspace', 8);
    assert.equal((await state()).nested, null);
    const focusNode = `(() => { const node=document.querySelector('.diagram-container svg [data-node-id]'); node.focus(); Archify.focus.set(node.getAttribute('data-node-id'), {toggle:false}); return node.getAttribute('data-node-id'); })()`;
    const focusedId = await evaluate(focusNode, childSession);
    await key('Escape', 'Escape', 27);
    assert.equal((await state()).focus, null);
    await evaluate(focusNode, childSession);
    await key('Backspace', 'Backspace', 8);
    assert.equal((await state()).focus, focusedId, 'Ordinary embedded Backspace must preserve focus.');
    assert.deepEqual(await evaluate(`received.filter(row => row.data?.type.startsWith('archify:'))`), []);
    observations.keys = await evaluate('fixtureKeys', childSession);
    assert.deepEqual(observations.keys.map(event => event.key), ['Escape', 'Backspace', 'Escape', 'Backspace']);

    await evaluate(`document.getElementById('before').focus()`);
    const maxTabs = await evaluate(`document.querySelectorAll('button,a,input,select,textarea,[tabindex]').length + 4`, childSession);
    const tabOrder = [];
    for (let count = 0; count < maxTabs; count++) {
      await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      const active = await evaluate('document.activeElement.id');
      tabOrder.push(active);
      if (active === 'after') break;
    }
    observations.tabOrder = tabOrder;
    assert.ok(tabOrder.includes('artifact'), 'Tab must actually enter the iframe.');
    assert.equal(tabOrder.at(-1), 'after', 'Tab must leave the iframe for the next host control.');
    assert.deepEqual((await state()).errors, []);
  } finally {
    try {
      if (browser) await browser.close();
    } finally {
      for (const server of [artifactServer, hostServer].filter(Boolean)) await new Promise(resolve => server.close(resolve));
      fs.rmSync(scratch, { recursive: true, force: true });
      if (process.env.ARCHIFY_MESSAGE_EVIDENCE) fs.writeFileSync(process.env.ARCHIFY_MESSAGE_EVIDENCE, JSON.stringify(observations, null, 2) + '\n');
    }
  }
});

// L012/L017: retain one representative for each message/transition and on-disk
// failure boundary, instead of replaying hundreds of duplicated fuzz payloads.
test('bundle messages, repeated navigation and changed child files preserve their boundaries', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME for bundle message and stale-child checks.',
}, async t => {
  const root = stageBundleFixture({ prefix: 'archify-message-bundle-' });
  const entryPath = path.join(root, 'checkout-platform.html');
  const childPath = path.join(root, 'payments.html');
  const entryHtml = fs.readFileSync(entryPath, 'utf8');
  const childHtml = fs.readFileSync(childPath, 'utf8');
  const requests = [];
  let browser, server;
  const evidence = {};
  try {
    server = await serve((request, response) => {
      const name = path.basename(new URL(request.url, 'http://localhost').pathname);
      requests.push(name);
      const file = path.join(root, name);
      response.setHeader('Cache-Control', 'no-store');
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Missing fixture file.'); return;
      }
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(fs.readFileSync(file));
    });
    browser = new ChromeVisualBrowser(chrome);
    const session = await browser.sessionPromise;
    const send = (method, params = {}) => browser.cdp.send(method, params, session, 30000);
    async function run(expression) {
      const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
      return result.result?.value;
    }
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Network.enable'); await send('Network.setCacheDisabled', { cacheDisabled: true });
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.fixtureErrors=[]; window.fixtureMessages=[];
      addEventListener('error',event=>fixtureErrors.push(event.message));
      addEventListener('unhandledrejection',event=>fixtureErrors.push(String(event.reason)));
      addEventListener('message',event=>fixtureMessages.push({type:event.data?.type,trusted:event.isTrusted}));
      window.fixtureWait=predicate=>new Promise((resolve,reject)=>{
        const deadline=performance.now()+6000;
        function sample(){if(predicate())return resolve();if(performance.now()>deadline)return reject(new Error('Bundle state did not settle'));requestAnimationFrame(sample);}
        sample();
      });
    ` });
    let navigation = 0;
    async function open() {
      const loaded = browser.cdp.waitFor('Page.loadEventFired', session, 30000);
      await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/checkout-platform.html?n=${++navigation}` });
      await loaded;
      await run(`document.fonts.ready.then(()=>Archify.readerLayout.whenStable()).then(()=>Archify.viewerChromeLayout.whenStable())`);
    }
    const state = () => run(`({state:document.documentElement.getAttribute('data-drilldown-state'),
      active:Archify.drilldown.active(),staleHidden:document.getElementById('archify-drilldown-stale').hidden,
      staleText:document.getElementById('archify-drilldown-stale').textContent,
      frameHidden:document.getElementById('archify-drilldown-frame').hidden,
      frameSrc:document.getElementById('archify-drilldown-frame').getAttribute('src'),errors:fixtureErrors,
      injected:!!document.querySelector('#archify-drilldown-stale img,#archify-drilldown-stale script,#archify-drilldown-stale svg'),
      polluted:Object.prototype.polluted === true})`);
    async function descend() {
      assert.equal(await run(`Archify.drilldown.descend('payments')`), true);
      await run(`fixtureWait(()=>!document.getElementById('archify-drilldown-frame').hidden || document.documentElement.getAttribute('data-drilldown-state')==='stale')`);
      return state();
    }
    async function back() {
      await run(`Archify.drilldown.back();fixtureWait(()=>!Archify.drilldown.active())`);
    }
    function assertLive(value) {
      assert.equal(value.staleHidden, true, JSON.stringify(value));
      assert.equal(value.frameHidden, false, JSON.stringify(value));
      assert.equal(value.active, true); assert.deepEqual(value.errors, []);
    }
    function assertStale(value) {
      assert.equal(value.state, 'stale', JSON.stringify(value));
      assert.equal(value.staleHidden, false); assert.equal(value.frameHidden, true);
      assert.equal(value.frameSrc, null); assert.ok(value.staleText.includes('payments'));
      assert.equal(value.injected, false); assert.equal(value.polluted, false); assert.deepEqual(value.errors, []);
    }
    // This evaluates code in a real source window. Native postMessage provides
    // event.source; the marker is queued after all messages to the same receiver.
    async function messagesToEntry(payloads, source) {
      return run(`new Promise(resolve=>{
        const child=document.getElementById('archify-drilldown-frame').contentWindow;
        const sender=${source === 'child' ? 'child' : 'window'};
        function done(event){if(event.source===sender&&event.data?.type==='fixture:entry-barrier'){removeEventListener('message',done);resolve();}}
        addEventListener('message',done);
        sender.eval(${JSON.stringify(`for(const message of JSON.parse(${JSON.stringify(JSON.stringify(payloads))})) ${source === 'child' ? 'parent' : 'window'}.postMessage(message,'*'); ${source === 'child' ? 'parent' : 'window'}.postMessage({type:'fixture:entry-barrier'},'*');`)});
      })`);
    }
    async function messagesToChild(payloads, source) {
      return run(`new Promise(resolve=>{
        const child=document.getElementById('archify-drilldown-frame').contentWindow;
        function done(event){if(event.data?.type==='fixture:child-barrier'){child.removeEventListener('message',done);resolve();}}
        child.addEventListener('message',done);
        ${source === 'parent'
          ? `for(const message of JSON.parse(${JSON.stringify(JSON.stringify(payloads))}))child.postMessage(message,'*');child.postMessage({type:'fixture:child-barrier'},'*');`
          : `child.eval(${JSON.stringify(`for(const message of JSON.parse(${JSON.stringify(JSON.stringify(payloads))}))postMessage(message,'*');postMessage({type:'fixture:child-barrier'},'*');`)});`}
      })`);
    }
    const childState = () => run(`(()=>{const child=document.getElementById('archify-drilldown-frame').contentWindow;
      return {nested:child.document.documentElement.getAttribute('data-bundle-nested'),localActive:child.Archify.drilldown.active(),
        hasManifest:!!child.document.getElementById('archify-bundle-manifest'),
        hasProjectionPayload:!!child.document.getElementById('archify-locate-projection'),
        projection:[...child.document.querySelectorAll('[data-locate-state]')].map(node=>[node.getAttribute('data-node-id'),node.getAttribute('data-locate-state')]),
        errors:child.fixtureErrors,polluted:child.Object.prototype.polluted===true,
        injected:!!child.document.querySelector('img[src="x"],svg[onload]')};})()`);

    await t.test('real source windows distinguish valid messages, malformed payloads and unrelated senders', async () => {
      await open(); assertLive(await descend());
      const before = await childState();
      assert.equal(before.nested, 'true'); assert.equal(before.localActive, false);
      assert.equal(before.hasManifest, false); assert.equal(before.hasProjectionPayload, false);
      const sha = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'))).diagrams.find(row => row.id === 'payments').spec_sha256;
      await messagesToEntry([{type:'archify:bundle-ack',id:'payments',specSha256:sha},{type:'archify:drilldown-escape'}], 'self');
      assertLive(await state());
      await messagesToChild([{type:'archify:locate-projection',nodes:{api:'stale'}},{type:'archify:bundle-hello',expectedId:'payments',expectedSpecSha256:sha}], 'self');
      assert.deepEqual(await childState(), before);
      await messagesToEntry([null, 'not an object', {type:1}, {type:'archify:bundle-ack'},
        {type:'archify:bundle-ack',id:'<img src=x onerror=alert(1)>',specSha256:sha},
        {type:'archify:bundle-ack',id:'payments',specSha256:{length:64}}], 'child');
      assertLive(await state());
      await messagesToChild([{type:'archify:locate-projection',nodes:['touched']},
        {type:'archify:locate-projection',nodes:JSON.parse('{"__proto__":{"polluted":true},"api":"<img src=x onerror=alert(1)>"}')},
        {type:'archify:locate-projection',nodes:{api:'touched'}}], 'parent');
      const projected = await childState();
      assert.deepEqual(projected.projection, [['api','touched']]);
      assert.equal(projected.polluted, false); assert.equal(projected.injected, false); assert.deepEqual(projected.errors, []);
      await messagesToEntry([{type:'archify:bundle-ack',id:'payments',specSha256:'a'.repeat(64)}], 'child');
      const stale = await state(); assertStale(stale);
      evidence.messages = {before,projected,stale};
      await back();
    });

    await t.test('Backspace inside the real child clears focus first and then returns to its parent', async () => {
      await open(); assertLive(await descend());
      await run(`(()=>{const child=document.getElementById('archify-drilldown-frame').contentWindow;
        window.childKeys=[];child.addEventListener('keydown',event=>childKeys.push({key:event.key,trusted:event.isTrusted,prevented:event.defaultPrevented}));
        const node=child.document.querySelector('[data-node-id]');node.focus();child.Archify.focus.set(node.getAttribute('data-node-id'),{toggle:false});})()`);
      async function pressBackspace() {
        await send('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
        await send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
      }
      await pressBackspace();
      await run(`fixtureWait(()=>!document.getElementById('archify-drilldown-frame').contentWindow.Archify.focus.active())`);
      assertLive(await state());
      await pressBackspace();
      await run(`fixtureWait(()=>!Archify.drilldown.active())`);
      const keys = await run('childKeys');
      assert.deepEqual(keys,[{key:'Backspace',trusted:true,prevented:true},{key:'Backspace',trusted:true,prevented:true}]);
      assert.equal((await state()).frameSrc,null);
      evidence.backspace = {keys,state:await state()};
    });

    await t.test('a cancelled load and two complete descents restore canonical parent geometry', async () => {
      await open();
      const boxes = () => run(`(()=>{const svg=document.querySelector('.diagram-container svg');return {viewBox:svg.getAttribute('viewBox'),
        visibility:getComputedStyle(svg).visibility,nodes:[...svg.querySelectorAll('[data-node-id]')].map(node=>{const b=node.getBoundingClientRect();return [node.getAttribute('data-node-id'),b.x,b.y,b.width,b.height];})};})()`);
      const before=await boxes();
      await run(`Archify.drilldown.descend('payments');Archify.drilldown.back();fixtureWait(()=>!Archify.drilldown.active())`);
      for(let cycle=0;cycle<2;cycle++){assertLive(await descend());await back();}
      const after=await boxes(); assert.deepEqual(after,before); assert.deepEqual((await state()).errors,[]);
      evidence.navigation={before,after};
    });

    await t.test('tampered identity, unsafe manifest URL and deletion after parent load show explicit stale state', async () => {
      const cases=[];
      // Change the actual child's identity after the parent and its manifest load.
      await open();
      fs.writeFileSync(childPath, childHtml.replace(/data-bundle-spec-sha256="[a-f0-9]{64}"/, `data-bundle-spec-sha256="${'a'.repeat(64)}"`));
      const changed=await descend();assertStale(changed);cases.push({case:'changed-child-identity',...changed});await back();
      fs.writeFileSync(childPath,childHtml);
      // The embedded manifest is the Viewer input, so change that actual input.
      const unsafe=entryHtml.replace(/(<script id="archify-bundle-manifest" type="application\/json">)([\s\S]*?)(<\/script>)/,(_,start,json,end)=>{
        const manifest=JSON.parse(json);manifest.diagrams.find(row=>row.id==='payments').file=`http://127.0.0.1:${server.address().port}/unexpected-child.html`;
        return start+JSON.stringify(manifest)+end;
      });
      assert.notEqual(unsafe,entryHtml);fs.writeFileSync(entryPath,unsafe);await open();
      const badUrl=await descend();assertStale(badUrl);assert.equal(requests.includes('unexpected-child.html'),false);
      cases.push({case:'unsafe-manifest-url',...badUrl});await back();fs.writeFileSync(entryPath,entryHtml);
      // Disable HTTP caching above and physically unlink after entry load.
      await open();fs.unlinkSync(childPath);
      const deleted=await descend();assertStale(deleted);cases.push({case:'deleted-child-after-parent-load',...deleted});await back();
      fs.writeFileSync(childPath,childHtml);await open();assertLive(await descend());await back();
      evidence.stale=cases;
    });
  } finally {
    try { if(browser)await browser.close(); }
    finally {
      if(server)await new Promise(resolve=>server.close(resolve));
      disposeBundleFixture(root);
      if(process.env.ARCHIFY_MESSAGE_EVIDENCE)fs.writeFileSync(process.env.ARCHIFY_MESSAGE_EVIDENCE+'.bundle.json',JSON.stringify(evidence,null,2)+'\n');
    }
  }
});
