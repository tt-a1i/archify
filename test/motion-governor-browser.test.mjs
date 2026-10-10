import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'archify');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Motion Governor preserves mode, ownership, continuous Live flow and real callers', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser motion checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-motion-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidence = process.env.ARCHIFY_MOTION_EVIDENCE;
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  const records = [];
  t.after(() => {
    if (evidence) fs.writeFileSync(path.join(evidence, 'observations.json'), JSON.stringify(records, null, 2) + '\n');
  });
  const cases = {
    architecture: 'web-app.architecture.json', workflow: 'agent-tool-call.workflow.json',
    sequence: 'cache-miss-request.sequence.json', dataflow: 'product-analytics.dataflow.json',
    lifecycle: 'agent-run.lifecycle.json', erd: 'orders.erd.json', class: 'payments.class.json',
    tree: 'payment-platform.tree.json', timeline: 'payment-incident.timeline.json',
    waterfall: 'checkout-request.waterfall.json',
  };
  const files = {};
  for (const [mode, example] of Object.entries(cases)) {
    const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', example), 'utf8'));
    delete doc.meta.animation;
    const input = path.join(scratch, mode + '.json');
    fs.writeFileSync(input, JSON.stringify(doc));
    files[mode] = path.join(scratch, mode + '.html');
    execFileSync(process.execPath, [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), input, files[mode]]);
    if (mode === 'tree') {
      doc.nodes.find(n=>n.id==='orders').collapsed=true;
      fs.writeFileSync(input, JSON.stringify(doc));
      files.treeCollapsed = path.join(scratch, 'tree-collapsed.html');
      execFileSync(process.execPath, [path.join(skillRoot, 'renderers/tree/render-tree.mjs'), input, files.treeCollapsed]);
    }
  }
  // Old standalone static HTML still has an inert Governor. New renders default to motion.
  files.static = path.join(scratch, 'static.html');
  fs.writeFileSync(files.static, fs.readFileSync(files.architecture, 'utf8').replace(' data-animation="trace"', ''));
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  async function run(expression) {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  let startup;
  let navigationId = 0;
  let fixtureUrl;
  async function media(reduced) {
    await send('Emulation.setEmulatedMedia', { media: '', features: [
      { name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' },
    ] });
  }
  async function load(mode = 'architecture', { theme = 'dark', reduced = false, fixture = '', preserveStorage = false, query = '' } = {}) {
    const expectedNavigation = ++navigationId;
    if (!preserveStorage) {
      if (fixtureUrl) {
        // Reset through the outgoing document's live storage area, then verify
        // completion before navigating. A CDP clear against a guessed file
        // storage key did not reliably clear this document's saved intent.
        assert.equal(await run('motionResetStorage()'), null, 'Outgoing fixture must clear stored intent.');
      }
      fixtureUrl = pathToFileURL(files[mode]).href + `?theme=${theme}&testNavigation=${expectedNavigation}${query}`;
      // End the old document before resetting this disposable profile. A
      // backend clear while the old file document still owns its Storage area
      // is not an isolation boundary for its pending work or unload handlers.
      // Keep startup/reload reads in the real Viewer, outside injected scripts.
      const frame = (await send('Page.getFrameTree')).frameTree.frame;
      if (frame.url !== 'about:blank') {
        const detached = browser.cdp.waitFor('Page.loadEventFired', session);
        const navigation = await send('Page.navigate', { url: 'about:blank' });
        assert.ok(navigation.loaderId, 'Fresh fixture reset must end the prior document.');
        await detached;
        assert.equal(await run('location.href'), 'about:blank', 'Storage reset requires the neutral document.');
      }
      await send('Storage.clearDataForStorageKey', { storageKey: 'file:///', storageTypes: 'local_storage' });
    }
    if (startup) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: startup });
    ({ identifier: startup } = await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
      if (location.href !== ${JSON.stringify(fixtureUrl)}) return;
      // Capture methods without accessing localStorage before Viewer startup.
      // Cleanup runs only later in the outgoing document, including after the
      // storage-unavailable fixture has replaced Storage.prototype methods.
      const readStored = Storage.prototype.getItem, removeStored = Storage.prototype.removeItem;
      window.motionResetStorage = () => {
        removeStored.call(localStorage, 'archify-motion');
        return readStored.call(localStorage, 'archify-motion');
      };
      window.motionNavigation = ${expectedNavigation};
      window.motionErrors = []; window.motionEnds = []; window.motionIterations = []; window.motionAmbient = [];
      addEventListener('animationiteration', e => { if (e.target.matches('.ambient-edge-flow')) motionIterations.push({trusted:e.isTrusted,name:e.animationName}); }, true);
      addEventListener('error', e => motionErrors.push(e.message));
      addEventListener('unhandledrejection', e => motionErrors.push(String(e.reason)));
      addEventListener('animationend', e => {
        if (e.target.matches('[data-animate]')) motionEnds.push({ trusted:e.isTrusted, name:e.animationName });
      }, true);
      new MutationObserver(records => {
        for (const r of records) if (r.attributeName === 'data-ambient-motion') {
          motionAmbient.push({ before:r.oldValue, after:r.target.getAttribute(r.attributeName) });
        }
      }).observe(document, { subtree:true, attributes:true, attributeOldValue:true, attributeFilter:['data-ambient-motion'] });
      window.motionWait = predicate => new Promise((resolve, reject) => {
        const start = performance.now();
        function sample() {
          if (predicate()) return resolve();
          if (performance.now() - start > 12000) return reject(new Error('Motion observation timed out'));
          requestAnimationFrame(sample);
        }
        requestAnimationFrame(sample);
      });
      ${fixture}
    })();` }));
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await media(reduced);
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    if (preserveStorage) {
      // Reload the same file URL: changing its query can change file-backed storage.
      await send('Page.reload');
    } else {
      const navigation = await send('Page.navigate', { url: fixtureUrl });
      assert.ok(navigation.loaderId, 'Motion fixture must load a new document.');
    }
    await loaded;
    await run('document.fonts.ready');
    assert.equal(await run('window.motionNavigation'), expectedNavigation, 'Motion fixture document identity');
  }
  async function snapshot(label) {
    const value = await run(`(() => {
      const m = Archify.motionGovernor, root = document.documentElement, btn = document.getElementById('btn-motion');
      return { capable:m.capable, mode:m.mode(), paused:m.isPaused(), owner:m.owner(),
        rootMode:root.getAttribute('data-motion'), rootOwner:root.getAttribute('data-motion-owner'),
        ambient:root.getAttribute('data-ambient-motion'), entry:root.getAttribute('data-ambient-entry'),
        hidden:btn.hidden, disabled:btn.disabled, pressed:btn.getAttribute('aria-pressed'),
        label:document.getElementById('motion-label').textContent, aria:btn.getAttribute('aria-label'), errors:motionErrors };
    })()`);
    assert.deepEqual(value.errors, [], label);
    records.push({ scenario: label, ...value });
    return value;
  }
  async function screenshot(name) {
    if (!evidence) return;
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(evidence, name + '.png'), Buffer.from(shot.data, 'base64'));
  }

  await t.test('ten modes preserve authored geometry and semantics; representative flows keep cycling and resume', async () => {
    for (const mode of Object.keys(cases)) {
      await load(mode);
      const initial = await snapshot(mode + '-initial');
      assert.equal(initial.capable, true); assert.equal(initial.mode, 'live'); assert.equal(initial.hidden, false);
      const contract = await run(`(() => {
        const svg=document.querySelector('.diagram-container > svg'), edges=Array.from(svg.querySelectorAll('path[data-animate="edge"]'));
        const flows=Array.from(svg.querySelectorAll('[data-ambient-flow-overlay]'));
        window.authoredEdges=edges.map(e=>e.outerHTML);
        const longEdges=edges.filter(e=>e.getTotalLength()>340).length;
        const circles=flows.filter(e=>e.localName==='circle'), paths=flows.filter(e=>e.localName==='path');
        return {edges:edges.length, flows:flows.length, paths:paths.length, circles:circles.length, longEdges,
          valid:paths.every(e=>e.getAttribute('d')===(e.previousElementSibling.getAttribute('data-motion-path')||e.previousElementSibling.getAttribute('d')))&&
          circles.every(e=>e.getAttribute('cx')!==null&&e.getAttribute('cy')!==null)&&
          flows.every(e=>Array.from(e.attributes).every(a=>!a.name.startsWith('data-')||['data-ambient-flow-overlay','data-tree-ancestors'].includes(a.name))&&
          !e.id&&!e.hasAttribute('role')&&!e.hasAttribute('tabindex')&&!e.hasAttribute('marker-end')&&getComputedStyle(e).pointerEvents==='none'),
          originalAnimations:edges.map(e=>getComputedStyle(e).animationName),
          reverse:edges.filter(e=>e.hasAttribute('data-motion-path')&&e.getAttribute('data-motion-path')!==e.getAttribute('d')).length,
          security:Array.from(svg.querySelectorAll('.a-security'), e=>getComputedStyle(e).strokeDasharray)};
      })()`);
      if(mode==='class') assert.ok(contract.reverse>0, 'Class bus exercises reversed visual paths.');
      assert.equal(contract.paths, contract.edges * 4 + contract.longEdges * 2,
        'Each edge carries wake, halo, tail and head, plus an echo pair on long edges.');
      assert.equal(contract.circles, contract.edges * 2, 'Each edge carries a sonar ripple pair.');
      assert.equal(contract.valid, true);
      assert.ok(contract.originalAnimations.every(name=>name==='none'));
      assert.ok(contract.security.every(dash=>dash==='5px, 5px'));
      assert.equal(initial.ambient, contract.edges ? 'running' : 'empty');
      // One actual multi-cycle observation covers shared CSS timing. Every type
      // above separately protects its renderer-to-runtime geometry contract.
      if (mode === 'architecture') {
        await run(`motionWait(() => motionIterations.filter(e=>e.trusted).length >= 1)`);
        await run(`motionWait(() => document.querySelector('.ambient-flow-wake').getAnimations()[0].currentTime > 4900)`);
        await run(`motionWait(() => document.documentElement.getAttribute('data-ambient-entry') === 'settled')`);
        const cycle = await run(`({iterations:motionIterations.filter(e=>e.trusted).length,
          active:document.querySelector('.ambient-flow-wake').getAnimations().some(a=>a.playState==='running'),
          layers:Array.from(document.querySelectorAll('path[data-animate="edge"]')).every(e=>{
            const overlays=[];
            for(let s=e.nextElementSibling;s&&s.hasAttribute('data-ambient-flow-overlay');s=s.nextElementSibling) overlays.push(s);
            const kinds=overlays.map(o=>o.localName==='circle'?(o.classList.contains('ambient-flow-ripple-echo')?'ripple-echo':'ripple'):(o.classList.contains('echo')?'echo':['wake','halo','tail','head'].find(c=>o.classList.contains('ambient-flow-'+c))));
            const core=kinds.slice(0,4).join(','), rest=kinds.slice(4).join(',');
            return core==='wake,halo,tail,head'&&(rest==='ripple,ripple-echo'||rest==='echo,echo,ripple,ripple-echo')&&
              overlays.every(o=>o.style.getPropertyValue('--flow-delay')!=='');
          }),
          nodeAnims:Array.from(document.querySelectorAll('[data-animate="node"]'), e=>e.getAnimations().map(a=>a.animationName))})`);
        const movement = await run(`(async () => {
          const flow=document.querySelector('.ambient-flow-head'), before=parseFloat(getComputedStyle(flow).strokeDashoffset), start=performance.now();
          await motionWait(()=>performance.now()-start>150);
          return {before,after:parseFloat(getComputedStyle(flow).strokeDashoffset)};
        })()`);
        assert.ok(cycle.iterations >= 1, 'comet layers keep cycling'); assert.equal(cycle.active, true);
        assert.equal(cycle.layers, true, 'every edge keeps its trace, wake, comet layers and landing ripple beside it');
        assert.ok(cycle.nodeAnims.length > 0 && cycle.nodeAnims.every(names => names.length === 1 && names[0] === 'archify-node-receive'),
          'after the bounded entrance, nodes keep only the receive glow: ' + JSON.stringify(cycle.nodeAnims));
        assert.ok(Number.isFinite(movement.before) && Number.isFinite(movement.after) && movement.after < movement.before,
          'comet head travels forward: ' + JSON.stringify(movement));
      }
      if(mode==='tree') {
        const branch = await run(`(() => {
          const overlaysOf=e=>{const out=[];for(let s=e.nextElementSibling;s&&s.hasAttribute('data-ambient-flow-overlay');s=s.nextElementSibling)out.push(s);return out;};
          Archify.treeBranches.collapse('platform');
          const hidden=Array.from(document.querySelectorAll('path[data-animate="edge"][data-tree-hidden]'));
          const stopped=hidden.every(e=>overlaysOf(e).length>0&&overlaysOf(e).every(o=>getComputedStyle(o).display==='none'&&o.getAnimations().length===0));
          Archify.treeBranches.expand('platform');
          return {count:hidden.length,stopped,resumed:hidden.every(e=>overlaysOf(e).some(o=>o.classList.contains('ambient-flow-wake')&&getComputedStyle(o).display!=='none'))};
        })()`);
        assert.ok(branch.count>0); assert.equal(branch.stopped,true); assert.equal(branch.resumed,true);
      }
      await run(`Archify.motionGovernor.pause()`);
      assert.equal(await run(`Array.from(document.querySelectorAll('.ambient-edge-flow')).every(e=>getComputedStyle(e).display==='none'&&e.getAnimations().length===0)`), true);
      await run(`Archify.motionGovernor.resume()`);
      assert.equal((await snapshot(mode + '-resumed')).ambient, contract.edges ? 'running' : 'empty');
      assert.equal(await run(`Array.from(document.querySelectorAll('path[data-animate="edge"]'),e=>e.outerHTML).every((s,i)=>s===authoredEdges[i])`), true);
      if (contract.edges) {
        assert.equal(await run(`document.querySelector('.ambient-flow-wake').getAnimations().some(a=>a.playState==='running')`), true);
      }
    }
    await load('static');
    const inert = await run(`(() => { const m=Archify.motionGovernor; return [m.capable,m.pause(),m.resume(),m.toggle(),m.setMode('live'),m.mode(),m.claim('story'),m.release(1),m.suspend('test')(),m.isPaused(),m.owner()]; })()`);
    assert.deepEqual(inert, [false,false,false,false,'still','still',0,false,false,true,'']);
    assert.equal((await snapshot('static')).hidden, true);
    assert.equal(await run(`document.querySelectorAll('[data-ambient-flow-overlay]').length`), 0);
  });

  await t.test('collapsing Orders hides only its descendant flow overlays', async () => {
    for (const mode of ['tree', 'treeCollapsed']) {
      await load(mode);
      const branch = await run(`(() => {
        const overlaysOf=e=>{const out=[];for(let s=e.nextElementSibling;s&&s.hasAttribute('data-ambient-flow-overlay');s=s.nextElementSibling)out.push(s);return out;};
        const edges=Array.from(document.querySelectorAll('path[data-animate="edge"]'));
        const unaffected=edges.filter(e=>['payments','operations'].includes(e.getAttribute('data-edge-from')));
        if (!Archify.treeBranches.collapsedIds().includes('orders')) Archify.treeBranches.collapse('orders');
        const hidden=edges.filter(e=>e.hasAttribute('data-tree-hidden'));
        const stopped=hidden.every(e=>overlaysOf(e).length>0&&overlaysOf(e).every(o=>getComputedStyle(o).display==='none'&&o.getAnimations().length===0));
        const neighborsRunning=unaffected.every(e=>overlaysOf(e).length>0&&overlaysOf(e).every(o=>getComputedStyle(o).display!=='none'&&o.getAnimations().some(a=>a.playState==='running')));
        Archify.treeBranches.expand('orders');
        return {hidden:hidden.length,neighbors:unaffected.length,stopped,neighborsRunning,
          resumed:hidden.every(e=>overlaysOf(e).every(o=>getComputedStyle(o).display!=='none'&&o.getAnimations().some(a=>a.playState==='running')))};
      })()`);
      assert.equal(branch.hidden, 2);
      assert.equal(branch.neighbors, 4);
      assert.equal(branch.stopped, true);
      assert.equal(branch.neighborsRunning, true, 'Payments and Operations keep their Live flow when Orders collapses');
      assert.equal(branch.resumed, true);
    }
  });

  await t.test('printing settled Live nodes preserves static styling then restores screen Live', async () => {
    for (const mode of ['architecture', 'tree']) {
      await load(mode);
      await run(`motionWait(()=>document.documentElement.getAttribute('data-ambient-entry')==='settled')`);
      const nodeState=()=>run(`Array.from(document.querySelectorAll('[data-animate="node"]'),e=>({animations:e.getAnimations().map(a=>a.animationName),filter:getComputedStyle(e).filter,opacity:getComputedStyle(e).opacity}))`);
      assert.ok((await nodeState()).every(n=>n.animations.includes('archify-node-receive')));
      await send('Emulation.setEmulatedMedia', {media:'print'});
      await run(`Archify.motionGovernor.pause()`);
      const staticPrint=await nodeState();
      assert.ok(staticPrint.length>0&&staticPrint.every(n=>n.animations.length===0));
      await run(`Archify.motionGovernor.resume()`);
      assert.deepEqual(await nodeState(), staticPrint, mode + ': printed Live nodes retain Still print styling and no animations');
      assert.equal((await snapshot(mode + '-settled-print')).mode, 'live');
      await media(false);
      await run(`motionWait(()=>Array.from(document.querySelectorAll('[data-animate="node"]')).every(e=>e.getAnimations().some(a=>a.animationName==='archify-node-receive'&&a.playState==='running')))`);
      assert.equal((await snapshot(mode + '-settled-screen-return')).mode, 'live');
    }
  });

  await t.test('grouped edges keep runtime flows out of semantic geometry copies', async () => {
    await load('workflow', { fixture: `
      // Preserve authored path geometry but put relationship metadata on a
      // containing group before Viewer startup, exercising descendant copies.
      const query=Document.prototype.querySelector;
      let wrapped=false;
      Document.prototype.querySelector=function(selector) {
        const found=query.call(this,selector);
        if(!wrapped&&found&&found.localName==='svg'&&found.closest('.diagram-container')) {
          const shape=found.querySelector('path[data-edge-from][data-edge-to]');
          if(shape) {
            wrapped=true;
            const wrapper=document.createElementNS('http://www.w3.org/2000/svg','g');
            Array.from(shape.attributes).filter(a=>a.name.startsWith('data-edge-')).forEach(a=>{wrapper.setAttribute(a.name,a.value);shape.removeAttribute(a.name);});
            wrapper.setAttribute('data-motion-test-group','true');
            shape.parentNode.insertBefore(wrapper,shape); wrapper.appendChild(shape);
          }
        }
        return found;
      };
    ` });
    const copies = await run(`(async () => {
      const svg=document.querySelector('.diagram-container > svg'), edge=svg.querySelector('[data-motion-test-group]'),
        from=edge.getAttribute('data-edge-from'), to=edge.getAttribute('data-edge-to'), initial=svg.querySelectorAll('[data-ambient-flow-overlay]').length;
      const rows=[];
      function record(name,selector) { rows.push({name,geometry:svg.querySelectorAll(selector).length,flows:svg.querySelectorAll('[data-ambient-flow-overlay]').length}); }
      Archify.intentTrace.show(from); record('intent','.intent-trace-flow'); Archify.intentTrace.clear();
      Archify.routeProbe.begin({source:from}); Archify.routeProbe.choose(to); record('route','.route-probe-flow'); Archify.routeProbe.clear({updateUrl:false});
      const kind=svg.querySelector('[data-node-kind]').getAttribute('data-node-kind');
      Archify.semanticLens.select(kind); record('lens','.semantic-lens-flow'); Archify.semanticLens.clear({updateUrl:false});
      Archify.focus.inspectRelationship(edge.getAttribute('data-edge-key'),{updateUrl:false}); record('relationship','.relationship-flow-pulse'); Archify.focus.clear({updateUrl:false});
      Archify.routeProbe.begin({source:from}); Archify.routeProbe.choose(to);
      const originalSnapshot=Archify.routeProbe.exportSnapshot(), authored=edge.querySelector('path[data-animate="edge"]'), flow=edge.querySelector('[data-ambient-flow-overlay]'), originalPath=authored.getAttribute('d');
      let emptyRejected,exportError;
      try {
        authored.setAttribute('d','');
        emptyRejected=Archify.routeProbe.exportSnapshot()===null;
        try { await Archify.exportMenu.shareCard({variant:'route'}); }
        catch(error) { exportError=String(error.message||error); }
      } finally { authored.setAttribute('d',originalPath); }
      const restoredSnapshot=Archify.routeProbe.exportSnapshot();
      Archify.routeProbe.clear({updateUrl:false});
      return {initial,rows,grouped:edge.localName==='g'&&flow!==null,
        originalValid:originalSnapshot!==null,emptyRejected,exportError,
        decorationStillDrawable:flow.getTotalLength()>0,directDecorationRejected:!hasDrawableGeometry(flow),
        restored:restoredSnapshot!==null&&JSON.stringify(restoredSnapshot)===JSON.stringify(originalSnapshot)};
    })()`);
    assert.equal(copies.grouped,true); assert.ok(copies.initial>0);
    assert.equal(copies.originalValid,true); assert.equal(copies.decorationStillDrawable,true);
    assert.equal(copies.directDecorationRejected,true); assert.equal(copies.emptyRejected,true);
    assert.match(copies.exportError,/Trace a route before exporting a Route Share Card/);
    assert.equal(copies.restored,true);
    for(const row of copies.rows) { assert.ok(row.geometry>0,JSON.stringify(row)); assert.equal(row.flows,copies.initial,row.name); }
  });

  await t.test('stored user intent remains distinct from reduced motion and suspension', async () => {
    await load();
    assert.equal(await run('Archify.motionGovernor.pause()'), true);
    assert.equal(await run(`localStorage.getItem('archify-motion')`), 'still');
    const storedUrl = await run('location.href');
    // Observe after normal startup. A CDP new-document localStorage read can
    // change Chrome's file-backed storage behavior, even in script-free HTML.
    // The Viewer must restore the saved choice itself on every reload.
    for (let reload = 0; reload < 5; reload++) {
      await load('architecture', { preserveStorage: true });
      const stored = await run(`({current:localStorage.getItem('archify-motion'),navigation:motionNavigation,url:location.href})`);
      assert.equal(stored.url, storedUrl, 'Preference persistence must reload the same file URL.');
      assert.equal(stored.current, 'still', 'Preference must survive reloading the standalone file.');
      assert.equal((await snapshot('stored-still-' + reload)).mode, 'still', JSON.stringify(stored));
    }
    assert.equal(await run(`Archify.motionGovernor.setMode('live', {persist:false})`), 'live');
    assert.equal(await run(`localStorage.getItem('archify-motion')`), 'still');
    assert.equal(await run('Archify.motionGovernor.resume()'), false);
    assert.equal(await run(`localStorage.getItem('archify-motion')`), null);
    await media(true);
    await run('motionWait(() => document.getElementById("btn-motion").disabled)');
    assert.equal(await run('Archify.motionGovernor.resume()'), false);
    assert.equal((await snapshot('reduced-resume')).mode, 'still');
    await run('window.releaseTest = Archify.motionGovernor.suspend("test")');
    await media(false);
    await run('motionWait(() => !document.getElementById("btn-motion").disabled)');
    assert.equal((await snapshot('suspension-after-media')).mode, 'still');
    assert.equal(await run('releaseTest()'), true);
    assert.equal(await run('releaseTest()'), false);
    assert.equal((await snapshot('released')).mode, 'live');
    assert.equal(await run('Archify.motionGovernor.toggle()'), true);
    assert.equal(await run('Archify.motionGovernor.toggle()'), false);
    await run('Archify.motionGovernor.pause()');
    await load();
    assert.equal(await run(`localStorage.getItem('archify-motion')`), null, 'Fresh fixtures reset prior stored intent.');
    assert.equal((await snapshot('fresh-after-stored-intent')).mode, 'live');
    await load('architecture', { fixture: `Storage.prototype.getItem = Storage.prototype.setItem = Storage.prototype.removeItem = function () { throw new Error('storage fixture'); };` });
    assert.equal(await run('Archify.motionGovernor.pause()'), true);
    assert.equal(await run('Archify.motionGovernor.resume()'), false);
    await snapshot('storage-unavailable');
  });

  await t.test('claims preempt cleanup, normal release does not, and SVG owners fall back automatically', async () => {
    await load();
    await run(`window.main = document.querySelector('.diagram-container > svg'); main.setAttribute('data-focus-active','true'); main.setAttribute('data-route-active','true');`);
    await run(`motionWait(() => Archify.motionGovernor.owner() === 'route')`);
    assert.equal((await snapshot('derived-route')).rootOwner, 'route');
    const claims = await run(`(() => {
      const m=Archify.motionGovernor, events=[];
      const a=m.claim('story',()=>events.push('A'));
      const b=m.claim('story',()=>{ events.push('B'); throw new Error('cleanup fixture'); });
      const stale=m.release(a), ownerAfterStale=m.owner();
      const c=m.claim('handoff',()=>events.push('C'));
      const released=m.release(c), repeated=m.release(c);
      return {events,stale,ownerAfterStale,released,repeated,increasing:a<b&&b<c,owner:m.owner(),empty:m.claim('')};
    })()`);
    assert.deepEqual(claims, { events:['A','B'], stale:false, ownerAfterStale:'story', released:true, repeated:false, increasing:true, owner:'route', empty:0 });
    await run(`main.removeAttribute('data-route-active')`);
    await run(`motionWait(() => Archify.motionGovernor.owner() === 'focus')`);
    const focus = await snapshot('derived-focus'); assert.equal(focus.rootOwner, 'focus'); assert.match(focus.aria, /focus/i);
    await run(`main.removeAttribute('data-focus-active')`);
    await run(`motionWait(() => Archify.motionGovernor.owner() === '')`);
    assert.equal((await snapshot('derived-empty')).rootOwner, null);
  });

  await t.test('counted suspensions and the existing visibility-key interaction remain distinct', async () => {
    await load();
    const values = await run(`(() => {
      const m=Archify.motionGovernor, a=m.suspend('a'), b=m.suspend('a'), c=m.suspend('c');
      const first=[c(),m.isPaused(),b(),m.isPaused(),b(),a(),m.isPaused()];
      const releaseVisibility=m.suspend('visibility');
      Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange'));
      const hidden=m.mode();
      Object.defineProperty(document,'hidden',{configurable:true,value:false}); document.dispatchEvent(new Event('visibilitychange'));
      const shown=m.mode(),released=releaseVisibility(); delete document.hidden;
      return {first,hidden,shown,released,hiddenAttr:document.documentElement.getAttribute('data-document-hidden')};
    })()`);
    assert.deepEqual(values, {first:[true,true,true,true,false,true,false],hidden:'still',shown:'live',released:true,hiddenAttr:null});
    await snapshot('visibility-key-fixture');
  });

  await t.test('node entry cancellation and optional platform interfaces keep their fallback', async () => {
    await load();
    const cancelled = await run(`(() => {
      const root=document.documentElement, svg=document.querySelector('.diagram-container > svg');
      svg.querySelectorAll('[data-animate="node"]').forEach(e=>e.dispatchEvent(new Event('animationcancel',{bubbles:true})));
      return {ambient:root.getAttribute('data-ambient-motion'),entry:root.getAttribute('data-ambient-entry')};
    })()`);
    assert.deepEqual(cancelled, {ambient:'running',entry:'settled'});
    for (const [name, fixture] of [
      ['no-media', 'window.matchMedia = undefined;'],
      ['legacy-media', `const nativeMatch=window.matchMedia.bind(window); window.matchMedia=q=>{const m=nativeMatch(q); m.addEventListener=undefined; return m;};`],
      ['no-observer', 'window.MutationObserver = undefined;'],
    ]) {
      await load('architecture', { fixture });
      assert.equal(await run('Archify.motionGovernor.pause()'), true);
      assert.equal((await snapshot(name)).mode, 'still');
      if (name === 'legacy-media') {
        await run('Archify.motionGovernor.resume()'); await media(true);
        await run('motionWait(() => document.getElementById("btn-motion").disabled)');
        assert.equal((await snapshot('legacy-media-changed')).mode, 'still');
      }
    }
    for (const query of ['&embed=1']) {
      await load('architecture', { query });
      assert.equal((await snapshot('suppressed-' + query)).ambient, 'paused');
      assert.equal(await run(`Array.from(document.querySelectorAll('.ambient-edge-flow')).every(e=>e.getAnimations().length===0)`), true);
    }
    await load('architecture', { fixture: `Object.defineProperty(document,'hidden',{configurable:true,value:true});` });
    assert.equal((await snapshot('initial-hidden-fixture')).mode, 'still');
  });

  await t.test('guards hide Live immediately and automatically restore it without growing the SVG', async () => {
    await load();
    const guards = await run(`(async () => {
      const m=Archify.motionGovernor, root=document.documentElement, count=document.querySelectorAll('.ambient-edge-flow').length;
      const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const visible=()=>Array.from(document.querySelectorAll('.ambient-edge-flow')).every(e=>getComputedStyle(e).display!=='none'&&e.getAnimations().some(a=>a.playState==='running'));
      const hidden=()=>Array.from(document.querySelectorAll('.ambient-edge-flow')).every(e=>getComputedStyle(e).display==='none'&&e.getAnimations().length===0);
      const states=[];
      for(const attr of ['data-embed','data-share-playback']) {
        root.setAttribute(attr,'true'); await frame(); states.push(hidden());
        root.removeAttribute(attr); await frame(); states.push(visible());
      }
      const token=m.claim('test'); states.push(hidden()); m.release(token); states.push(visible());
      Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange')); states.push(hidden());
      Object.defineProperty(document,'hidden',{configurable:true,value:false}); document.dispatchEvent(new Event('visibilitychange')); states.push(visible()); delete document.hidden;
      return {states,count:document.querySelectorAll('.ambient-edge-flow').length,initial:count};
    })()`);
    assert.ok(guards.states.every(Boolean), JSON.stringify(guards)); assert.equal(guards.count, guards.initial);
    await media(true); await run(`motionWait(()=>document.getElementById('btn-motion').disabled)`);
    assert.equal(await run(`document.querySelector('.ambient-flow-wake').getAnimations().length`), 0);
    await media(false); await run(`motionWait(()=>document.querySelector('.ambient-flow-wake').getAnimations().length>0)`);
    await send('Emulation.setEmulatedMedia', {media:'print'});
    assert.equal(await run(`Array.from(document.querySelectorAll('.ambient-edge-flow')).every(e=>getComputedStyle(e).display==='none'&&e.getAnimations().length===0)`), true);
    assert.equal((await snapshot('print-css')).mode, 'live');
    await media(false);
    await run(`motionWait(()=>document.querySelector('.ambient-flow-wake').getAnimations().some(a=>a.playState==='running'))`);
    assert.equal((await snapshot('screen-css-return')).mode, 'live');
    assert.equal(await run(`document.querySelectorAll('.ambient-edge-flow').length`), guards.initial);
  });

  await t.test('printing keeps Governor Live and preserves the existing Route print policy', async () => {
    await load();
    assert.equal(await run(`(() => {
      Archify.routeProbe.begin({source:'users'}); Archify.routeProbe.choose('db');
      window.printPauses=[]; window.printPauseOriginal=Archify.routeProbe.pauseJourney;
      Archify.routeProbe.pauseJourney=function(options){printPauses.push(options);return printPauseOriginal(options);};
      return Archify.routeProbe.playJourney();
    })()`), true);
    await send('Emulation.setEmulatedMedia', {media:'print'});
    const printing=await run(`({playing:Archify.routeProbe.isJourneyPlaying(),mode:Archify.motionGovernor.mode(),owner:Archify.motionGovernor.owner(),
      pausedCalls:printPauses,flowHidden:Array.from(document.querySelectorAll('.ambient-edge-flow')).every(e=>getComputedStyle(e).display==='none'&&e.getAnimations().length===0)})`);
    assert.deepEqual(printing,{playing:true,mode:'live',owner:'route',pausedCalls:[],flowHidden:true});
    // Route already pauses itself for print through its private handler. The
    // Governor must neither add a hidden-page pause nor change reader intent.
    const beforePrint=await run(`(() => {
      window.dispatchEvent(new Event('beforeprint'));
      return {playing:Archify.routeProbe.isJourneyPlaying(),mode:Archify.motionGovernor.mode(),pausedCalls:printPauses};
    })()`);
    assert.deepEqual(beforePrint,{playing:false,mode:'live',pausedCalls:[]});
    await media(false);
    const returned=await run(`(() => {
      window.dispatchEvent(new Event('afterprint'));
      const state={playing:Archify.routeProbe.isJourneyPlaying(),mode:Archify.motionGovernor.mode(),owner:Archify.motionGovernor.owner(),pausedCalls:printPauses,
        yielding:Array.from(document.querySelectorAll('.ambient-edge-flow')).every(e=>e.getAnimations().length===0)};
      Archify.routeProbe.pauseJourney=printPauseOriginal; Archify.routeProbe.clear({updateUrl:false});
      return state;
    })()`);
    assert.deepEqual(returned,{playing:false,mode:'live',owner:'route',pausedCalls:[],yielding:true});
    await run(`motionWait(()=>document.querySelector('.ambient-flow-wake').getAnimations().some(a=>a.playState==='running'))`);
  });

  await t.test('canonical SVG and PNG bytes are identical in Live, Still and resumed Live', async () => {
    await load();
    const exports = await run(`(async () => {
      const m=Archify.motionGovernor, original=URL.createObjectURL;
      let latest; URL.createObjectURL=function(blob){latest=blob;return original.call(URL,blob);};
      const values=[];
      try {
        for (const state of ['live','still','live']) {
          m.setMode(state); const formats={};
          for(const format of ['svg','png']) {
            await Archify.exportMenu.run(format);
            if(!latest) throw new Error('Missing export blob');
            const bytes=await latest.arrayBuffer(), digest=await crypto.subtle.digest('SHA-256',bytes);
            formats[format]=Array.from(new Uint8Array(digest)).join(',');
            if(format==='svg') {
              const text=await latest.text();
              if(text.includes('data-ambient-flow-overlay')) throw new Error('Live decoration escaped into export');
            }
          }
          values.push(formats);
        }
      } finally { URL.createObjectURL=original; }
      return values;
    })()`);
    assert.deepEqual(exports[1], exports[0]); assert.deepEqual(exports[2], exports[0]);
  });

  await t.test('Motion pauses actual Route without discarding elapsed dwell', async () => {
    await load();
    const route = await run(`(async () => {
      Archify.routeProbe.begin({source:'users'}); Archify.routeProbe.choose('db');
      const schedule=window.setTimeout, delays=[];
      window.setTimeout=function(callback,delay,...args){ delays.push(delay); return schedule(callback,delay,...args); };
      const started=Archify.routeProbe.playJourney();
      await new Promise(resolve=>schedule(resolve,180));
      const before=Archify.routeProbe.result(), pauses=[], pause=Archify.routeProbe.pauseJourney;
      Archify.routeProbe.pauseJourney=function(options){pauses.push(options); return pause(options);};
      Object.defineProperty(document,'hidden',{configurable:true,value:true}); document.dispatchEvent(new Event('visibilitychange'));
      const paused=Archify.routeProbe.result();
      Object.defineProperty(document,'hidden',{configurable:true,value:false}); document.dispatchEvent(new Event('visibilitychange'));
      const autoResumed=Archify.routeProbe.isJourneyPlaying();
      delays.length=0; const resumed=Archify.routeProbe.playJourney();
      const remaining=delays.at(-1); window.setTimeout=schedule; delete document.hidden;
      Archify.routeProbe.pauseJourney=pause; pause();
      return {started,before,paused,autoResumed,resumed,remaining,pauses};
    })()`);
    assert.equal(route.started, true); assert.equal(route.before.playing, true); assert.equal(route.paused.playing, false);
    assert.equal(route.paused.journey, route.before.journey); assert.equal(route.autoResumed, false); assert.equal(route.resumed, true);
    assert.ok(route.pauses.some(options => options.preserveElapsed === true && options.reason === 'hidden'));
    assert.ok(route.remaining > 0 && route.remaining < 1000, JSON.stringify(route));
    await snapshot('route-hidden-pause');
  });

  await t.test('dark and light modes expose the same controls and computed Still state', async () => {
    for (const theme of ['dark', 'light']) {
      await load('architecture', { theme });
      assert.equal((await snapshot('running-' + theme)).ambient, 'running');
      const live = await snapshot('live-' + theme); assert.equal(live.pressed, 'true');
      await screenshot('live-' + theme);
      await run(`document.getElementById('btn-motion').click()`);
      const still = await snapshot('still-' + theme); assert.equal(still.mode, 'still'); assert.equal(still.pressed, 'false');
      assert.match(still.aria, /resume/i);
      assert.equal(await run(`getComputedStyle(document.querySelector('.pulse-dot')).animationName`), 'none');
      await screenshot('still-' + theme);
      await run(`Archify.focus.set('api', {toggle:false}); motionWait(() => Archify.motionGovernor.owner() === 'focus')`);
      const exported = await run(`(async () => {
        const svg=document.querySelector('.diagram-container > svg'), m=Archify.motionGovernor;
        const before={svg:svg.outerHTML,mode:m.mode(),owner:m.owner()}, original=URL.createObjectURL;
        let blob, serialized;
        URL.createObjectURL=function(value){if(value.type.startsWith('image/svg+xml'))blob=value;return original.call(URL,value);};
        // Capture serialization synchronously; the later download click can
        // reach the existing outside-click Focus handler.
        try {
          const pending=Archify.exportMenu.run('svg');
          serialized={svg:svg.outerHTML,mode:m.mode(),owner:m.owner()};
          await pending;
        } finally { URL.createObjectURL=original; }
        const text=await blob.text(), root=new DOMParser().parseFromString(text,'image/svg+xml').documentElement;
        return {unchanged:before.svg===serialized.svg&&before.mode===serialized.mode&&before.owner===serialized.owner,
          modeUnchanged:before.mode===m.mode(),
          clean:!root.querySelector('[data-focus-selected], [data-radar-node-id]')&&!root.hasAttribute('data-focus-active'),
          geometry:root.getAttribute('viewBox')===svg.getAttribute('viewBox')};
      })()`);
      assert.deepEqual(exported, {unchanged:true,modeUnchanged:true,clean:true,geometry:true});
      await snapshot('export-' + theme);

    }
  });
});
