import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findChrome } from '../bin/visual-check.mjs';
import { desktopBrowser, desktopPointerCheck } from './helpers/desktop-browser.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Focus preserves semantic selection, relationships, reachability and shared flow tokens', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real-browser Focus checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-focus-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const evidence = process.env.ARCHIFY_FOCUS_EVIDENCE;
  const records = [];
  if (evidence) fs.mkdirSync(evidence, { recursive: true });
  t.after(() => { if (evidence) fs.writeFileSync(path.join(evidence, 'observations.json'), JSON.stringify(records, null, 2) + '\n'); });
  const cases = { architecture: 'web-app.architecture.json', workflow: 'agent-tool-call.workflow.json', sequence: 'cache-miss-request.sequence.json', dataflow: 'product-analytics.dataflow.json', lifecycle: 'agent-run.lifecycle.json' };
  const files = {};
  for (const [mode, example] of Object.entries(cases)) {
    files[mode] = path.join(scratch, mode + '.html');
    execFileSync(process.execPath, [path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`), path.join(skillRoot, 'examples', example), files[mode]]);
  }
  // The graph fixture deliberately exercises DOM fragment contracts outside IR validation.
  const graph = `<g data-edge-key="a" data-edge-id="edge-a" data-edge-from="users" data-edge-to="cdn"></g>
    <path data-edge-key="a" data-edge-id="edge-a" data-edge-from="users" data-edge-to="cdn" d="M 110 180 L 245 180"/>
    <line data-edge-key="b" data-edge-id="edge-b" data-edge-from="cdn" data-edge-to="lb" x1="245" y1="180" x2="380" y2="180"/>
    <polyline data-edge-key="c" data-edge-id="edge-c" data-edge-from="lb" data-edge-to="users" points="380,210 110,210 110,180"/>
    <path data-edge-key="d" data-edge-id="edge-d" data-edge-from="cdn" data-edge-to="api" d="M 245 180 Q 380 100 515 180"/>
    <path data-edge-key="e" data-edge-id="edge-e" data-edge-from="cdn" data-edge-to="api" d="M 245 180 Q 380 260 515 180"/>
    <g data-edge-key="f" data-edge-id="edge-f" data-edge-from="api" data-edge-to="db" transform="translate(0 3)"><path d="M 515 180 L 650 180"/></g>
    <path data-edge-key="g" data-edge-id="edge-g" data-edge-from="api" data-edge-to="api" d="M 515 180 C 470 100 560 100 515 180"/>
    <path data-edge-key="h" data-edge-id="edge-h" data-edge-from="db" data-edge-to="cache" d="M 650 180 L 785 180"/>
    <line data-edge-key="i" data-edge-id="edge-i" data-edge-from="worker" data-edge-to="cdn" x1="920" y1="230" x2="245" y2="230"/>
    ${['users','cdn','lb','api','db','cache','worker','isolated'].map((id,i)=>`<g data-node-id="${id}" data-node-label="${id}" data-node-kind="${id==='db'?'database':id==='worker'?'messagebus':'backend'}" tabindex="0" role="button"><rect x="${60+i*135}" y="150" width="100" height="60" fill="var(--backend-fill)"/><text x="${70+i*135}" y="185">${id}</text></g>`).join('')}`;
  const graphSetup = `var fixtureSvg=document.querySelector('.diagram-container > svg');fixtureSvg.setAttribute('viewBox','0 0 1200 500');fixtureSvg.setAttribute('data-animation','trace');fixtureSvg.innerHTML=${JSON.stringify(graph)};`;
  function variant(name, setup) {
    files[name] = path.join(scratch, name + '.html');
    const original = fs.readFileSync(files.architecture, 'utf8');
    assert.ok(original.includes('    var Archify = {};'), 'Focus fixture anchor');
    fs.writeFileSync(files[name], original.replace('    var Archify = {};', setup + '\n    var Archify = {};'));
  }
  variant('graph', graphSetup);
  variant('no-geometry', graphSetup + `document.querySelector('[data-edge-key="f"] path').remove();`);
  const browser = desktopBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const checkPointer = await desktopPointerCheck(browser, session);
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  async function run(expression) {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(r.exceptionDetails, undefined, r.exceptionDetails?.exception?.description);
    return r.result?.value;
  }
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.focusErrors=[];window.pulseEvents=[];addEventListener('error',e=>focusErrors.push(e.message));addEventListener('unhandledrejection',e=>focusErrors.push(String(e.reason)));
    for(const type of ['animationend','animationcancel'])addEventListener(type,e=>{if(e.target.matches('.relationship-flow-pulse'))pulseEvents.push({type,trusted:e.isTrusted});},true);
    try{localStorage.removeItem('archify-motion');}catch(_){}
    window.focusWait=predicate=>new Promise((resolve,reject)=>{const start=performance.now();function poll(){if(predicate())return resolve();if(performance.now()-start>12000)return reject(new Error('Focus observation timed out'));requestAnimationFrame(poll);}requestAnimationFrame(poll);});
  ` });
  let navigationId=0;
  async function load(mode='graph', { theme='dark', reduced=true, width=1440, hash='' }={}) {
    await send('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
    await send('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:false});
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:reduced?'reduce':'no-preference'}]});
    const loaded=browser.cdp.waitFor('Page.loadEventFired',session);
    await send('Page.navigate',{url:pathToFileURL(files[mode]).href+'?theme='+theme+'&keep=yes&run='+(++navigationId)+hash});await loaded;
    await checkPointer();
    await run('document.fonts.ready');await stable();
  }
  async function stable() {
    await run(`focusWait(()=>!document.querySelector('.diagram-container').hasAttribute('data-camera-transaction'))`);
    await run('Archify.viewerChromeLayout.whenStable()');
    await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  }
  const node=id=>`.diagram-container > svg [data-node-id="${id}"]`;
  const hit=key=>`[data-relationship-hit-key="${key}"]`;
  const relation=key=>`#relationship-lens-list [data-relationship-key="${key}"]`;
  async function point(selector) { return run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};})()`); }
  async function move(selector) { await send('Input.dispatchMouseEvent',{type:'mouseMoved',...(selector?await point(selector):{x:0,y:0})}); }
  async function click(selector) {
    const p=await point(selector);await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});await stable();
  }
  async function key(key,code,windowsVirtualKeyCode) {
    await send('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode,text:key==='Enter'?'\r':key===' '?' ':undefined});await send('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode});await stable();
  }
  async function focus(selector) { await run(`document.querySelector(${JSON.stringify(selector)}).focus({preventScroll:true})`); }
  async function select(id,options={}) { assert.equal(await run(`Archify.focus.set(${JSON.stringify(id)},${JSON.stringify(options)})`),true);await stable(); }
  async function snapshot(scenario) {
    const s=await run(`(()=>{const svg=document.querySelector('.diagram-container > svg'),f=Archify.focus,chip=document.getElementById('focus-chip');
      const attrs=e=>Object.fromEntries([...e.attributes].filter(a=>/^(data-(focus|relationship|reach)|aria-(pressed|expanded|current))/.test(a.name)).map(a=>[a.name,a.value]));
      return {active:f.active(),relationship:f.relationship(),reach:f.reachability(),snapshot:f.reachabilitySnapshot(),hash:location.hash,svg:attrs(svg),chip:{hidden:chip.hidden,label:document.getElementById('focus-label').textContent,attrs:attrs(chip)},
        nodes:[...svg.querySelectorAll('[data-node-id]')].map(n=>({id:n.dataset.nodeId,attrs:attrs(n)})),edges:[...svg.querySelectorAll('[data-edge-from]')].map(n=>({key:n.dataset.edgeKey,attrs:attrs(n)})),
        hits:[...svg.querySelectorAll('[data-relationship-hit-key]')].map(n=>({key:n.dataset.relationshipHitKey,tab:n.tabIndex,attrs:attrs(n)})),
        rows:[...document.querySelectorAll('#relationship-lens-list [data-relationship-key]')].map(n=>({key:n.dataset.relationshipKey,target:n.dataset.relationshipTarget,attrs:attrs(n)})),pulse:svg.querySelectorAll('[data-relationship-pulse-overlay]').length,errors:focusErrors,external:performance.getEntriesByType('resource').map(r=>r.name).filter(n=>/^https?:/.test(n))};})()`);
    assert.deepEqual(s.errors,[],scenario);assert.deepEqual(s.external,[],scenario);records.push({scenario,...s});return s;
  }

  await t.test('five modes expose the same Focus and flowTokens surfaces at cold start',async()=>{
    const expected=['set','setMany','clear','copyLink','reach','clearReach','reachabilitySnapshot','inspectRelationship','inspectRelationshipById','reposition','relationship','reachability','active'].sort();
    for(const mode of Object.keys(cases)) {
      await load(mode);assert.deepEqual(await run('Object.keys(Archify.focus).sort()'),expected);assert.deepEqual(await run('Object.keys(Archify.flowTokens).sort()'),['create','kind','path']);
      const cold=await snapshot(mode+'-cold');assert.equal(cold.active,null);
      const id=await run(`document.querySelector('.diagram-container > svg [data-node-id]').dataset.nodeId`);await select(id);assert.equal((await snapshot(mode+'-selected')).active,id);
    }
  });
  await t.test('native node input and option variants preserve selection and cleanup side effects',async()=>{
    await load();await click(node('users'));assert.equal((await snapshot('node-click')).active,'users');
    await focus(node('users'));await key(' ','Space',32);assert.equal(await run('Archify.focus.active()'),null);
    await focus(node('cdn'));await key('Enter','Enter',13);assert.equal(await run('Archify.focus.active()'),'cdn');
    await run(`document.querySelector('.diagram-container').setAttribute('data-just-panned','true');document.querySelector('[data-node-id="users"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`);assert.equal(await run('Archify.focus.active()'),'cdn');await run(`document.querySelector('.diagram-container').removeAttribute('data-just-panned')`);
    const many=await run(`(()=>{const result=Archify.focus.setMany(['cdn','missing','users','cdn'],{toggle:false,hideChip:true,updateUrl:false});const copy=Archify.focus.active();copy.push('db');return {result,active:Archify.focus.active(),hidden:document.getElementById('focus-chip').hidden};})()`);
    assert.deepEqual(many,{result:true,active:['cdn','users'],hidden:true});const multi=await snapshot('multi-selection');assert.deepEqual(multi.edges.filter(e=>'data-focus-match' in e.attrs).map(e=>e.key),['a','a']);
    await run(`Archify.focus.setMany(['users','cdn'],{toggle:false,label:'Custom',urlKey:'view',urlValue:'custom'});`);assert.equal((await snapshot('custom-selection')).hash,'#view=custom');
    await run(`Archify.semanticLens.select('backend')`);assert.equal(await run(`Archify.focus.setMany([])`),false);assert.equal(await run('Archify.semanticLens.active()'),null);
    await run(`Archify.routeProbe.begin({source:'users'})`);assert.equal(await run(`Archify.focus.setMany(['missing'])`),false);assert.equal(await run('Archify.routeProbe.active()'),null);
    await run(`Archify.routeProbe.begin({source:'users'});Archify.focus.set('api',{preserveRoute:true,updateUrl:false})`);assert.notEqual(await run('Archify.routeProbe.active()'),null);
    await run(`Archify.routeProbe.clear();Archify.focus.set('api',{toggle:false});Archify.focus.clear({restoreFocus:true,updateUrl:false,preserveView:true})`);assert.equal(await run('document.activeElement.dataset.nodeId'),'api');assert.equal(await run('Archify.focus.active()'),null);
    await run('Archify.focus.clear();Archify.focus.clear()');assert.equal((await snapshot('repeated-clear')).hash,'');
  });
  await t.test('Passport rows preserve keyboard navigation, missing metadata and no-neighbor state',async()=>{
    await load();await select('cdn');await focus('#btn-focus-relations');await key('Enter','Enter',13);
    assert.equal(await run(`document.querySelectorAll('#relationship-lens-list [data-relationship-target]').length`),5);
    await focus(relation('a'));await key('End','End',35);assert.equal(await run('document.activeElement.dataset.relationshipKey'),'i');await key('Home','Home',36);assert.equal(await run('document.activeElement.dataset.relationshipKey'),'b');
    await key('ArrowDown','ArrowDown',40);assert.equal(await run('document.activeElement.dataset.relationshipKey'),'d');await key('Enter','Enter',13);assert.equal(await run('Archify.focus.active()'),'api');assert.equal(await run('document.activeElement.dataset.nodeId'),'api');
    await select('isolated');const s=await snapshot('isolated-passport');assert.equal(s.rows.length,0);assert.deepEqual(await run(`({up:document.getElementById('btn-reach-upstream').disabled,down:document.getElementById('btn-reach-downstream').disabled,evidence:document.getElementById('focus-evidence').hidden,detail:document.getElementById('focus-detail').hidden})`),{up:true,down:true,evidence:true,detail:true});assert.equal(await run(`Archify.focus.reach('upstream')`),false);
  });
  await t.test('relationship focus and pointer intents yield to pins and direct keyboard exploration',async()=>{
    await load();await select('cdn');await focus('#btn-focus-relations');await key('Enter','Enter',13);await move(relation('a'));await focus(relation('b'));await stable();assert.equal((await snapshot('focus-over-hover')).svg['data-relationship-preview-active'],'b');
    await run('document.activeElement.blur()');await stable();assert.equal((await snapshot('hover-restored')).svg['data-relationship-preview-active'],'a');
    await run('Archify.focus.clear()');await move(null);await focus(hit('d'));await key('Enter','Enter',13);assert.equal((await snapshot('direct-pin')).relationship.id,'edge-d');
    await focus(hit('e'));await stable();assert.equal(await run('Archify.focus.relationship().id'),'edge-d');await key('Escape','Escape',27);assert.equal(await run('Archify.focus.active()'),null);
    await focus(hit('a'));await key('ArrowLeft','ArrowLeft',37);assert.equal(await run('document.activeElement.dataset.relationshipKey'),'i');await key('Home','Home',36);assert.equal(await run('document.activeElement.dataset.relationshipKey'),'a');await key(' ','Space',32);assert.equal(await run('Archify.focus.relationship().id'),'edge-a');
    assert.equal(await run(`Archify.focus.inspectRelationshipById('unknown')`),false);await snapshot('direct-navigation');
  });
  await t.test('direct pointer delay, touch filtering and background input keep ownership rules',async()=>{
    await load('graph',{reduced:false});await move(hit('b'));
    await run(`focusWait(()=>document.querySelector('.diagram-container > svg').getAttribute('data-relationship-preview-active')==='b')`);
    await snapshot('direct-pointer-preview');await move(null);await stable();assert.equal((await snapshot('direct-pointer-left')).svg['data-relationship-preview-active'],undefined);
    await move(hit('b'));await move(null);await run('new Promise(resolve=>setTimeout(resolve,120))');assert.equal((await snapshot('cancelled-direct-delay')).svg['data-relationship-preview-active'],undefined);
    // Synthetic pointerType/owner fixtures complement the real mouse path above.
    await run(`document.querySelector('[data-relationship-hit-key="b"]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'touch'}))`);
    await run('new Promise(resolve=>setTimeout(resolve,120))');assert.equal((await snapshot('touch-fixture')).svg['data-relationship-preview-active'],undefined);
    await run(`Archify.semanticLens.select('backend');document.querySelector('[data-relationship-hit-key="b"]').dispatchEvent(new PointerEvent('pointerover',{bubbles:true,pointerType:'mouse'}))`);
    await run('new Promise(resolve=>setTimeout(resolve,120))');assert.equal((await snapshot('lens-blocked-fixture')).svg['data-relationship-preview-active'],undefined);
    await load();await click(node('users'));
    const p=await run(`(()=>{for(let y=30;y<innerHeight;y+=25)for(let x=10;x<innerWidth;x+=25){const e=document.elementFromPoint(x,y);if(e?.matches('.diagram-container > svg'))return {x,y};}throw new Error('No visible SVG background in fixture');})()`);
    await send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});await send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});await stable();assert.equal((await snapshot('background-click')).active,null);
  });
  await t.test('authored graph geometry and shared token kinds preserve grouping and direction',async()=>{
    await load();const result=await run(`(()=>{const f=Archify.flowTokens,svg=document.querySelector('.diagram-container > svg');const edges=[...svg.querySelectorAll('[data-edge-from]')];return edges.filter(e=>e.matches('path,line,polyline')||e.querySelector('path')).map(e=>{const shape=e.matches('path,line,polyline')?e:e.querySelector('path');const token=f.create(e,shape,{duration:'0.78s',className:'story-token'});return {key:e.dataset.edgeKey,kind:f.kind(e),path:f.path(shape),duration:token.querySelector('animateMotion').getAttribute('dur'),cloned:!token.isConnected};});})()`);
    assert.equal(result.length,9);assert.deepEqual(result.map(r=>r.kind),['call','call','call','call','call','data','call','data','event']);assert.equal(result[1].path,'M 245 180 L 380 180');assert.equal(result[2].path,'M 380 210 L 110 210 L 110 180');assert.ok(result.every(r=>r.cloned&&r.duration==='0.78s'));records.push({scenario:'flow-tokens',result});
    assert.deepEqual(await run(`({missing:Archify.flowTokens.create(null,null),empty:Archify.flowTokens.path(null)})`),{missing:null,empty:''});
    await load('no-geometry');assert.equal(await run(`Archify.focus.inspectRelationshipById('edge-f')`),false);await snapshot('missing-geometry');
  });
  await t.test('reachability handles cycles, parallel edges, toggles and strict snapshot rejection',async()=>{
    await load();await select('cdn');assert.equal(await run(`Archify.focus.reach('downstream',{reveal:false})`),true);let s=await snapshot('reach-downstream');assert.deepEqual(s.reach.nodeIds,['cdn','lb','api','users','db','cache']);assert.equal(s.reach.maxDepth,3);assert.ok(s.snapshot);assert.equal(s.reach.edgeKeys.length,8);
    assert.equal(await run(`(()=>{const copy=Archify.focus.reachability();copy.nodeIds.length=0;return Archify.focus.reachability().nodeIds.length;})()`),6);
    await run(`Archify.focus.reach('downstream')`);assert.equal(await run('Archify.focus.reachabilitySnapshot()'),null);
    await run(`Archify.focus.reach('upstream',{reveal:false})`);s=await snapshot('reach-upstream');assert.deepEqual(s.reach.nodeIds,['cdn','users','worker','lb']);
    for(const mutation of [
      `svg.querySelector('[data-node-id="users"]').removeAttribute('data-reach-match')`,
      `svg.appendChild(svg.querySelector('[data-node-id="users"]').cloneNode(true))`,
      `svg.appendChild(svg.querySelector('path[data-edge-key="a"]').cloneNode(true))`,
    ]) { await load();await select('cdn');await run(`Archify.focus.reach('downstream',{reveal:false});const svg=document.querySelector('.diagram-container > svg');${mutation}`);assert.equal(await run('Archify.focus.reachabilitySnapshot()'),null); }
    await load();await select('cdn');await run(`Archify.focus.reach('downstream',{reveal:false});Archify.focus.clearReach({updateUrl:true})`);assert.equal((await snapshot('clear-reach')).hash,'#focus=cdn');await select('isolated');assert.equal(await run(`Archify.focus.reach('downstream')`),false);
  });
  await t.test('cold URLs and hashchange preserve focus, relation, reach and query semantics',async()=>{
    for(const [hash,active,relationId] of [['#focus=cdn&reach=downstream','cdn',null],['#relation=edge-d','cdn','edge-d'],['#relation=unknown',null,null],['#view=request-path','users',null],['#focus=isolated','isolated',null],['#route=users~db',null,null]]) {
      await load('graph',{hash});const s=await snapshot('cold-'+hash);if(hash.startsWith('#view=')){assert.ok(s.active);continue;}assert.equal(s.active,active);assert.equal(s.relationship?.id||null,relationId);
    }
    await load();await run(`new Promise(resolve=>{addEventListener('hashchange',()=>requestAnimationFrame(resolve),{once:true});location.hash='focus=cdn&reach=upstream';})`);await stable();assert.equal((await snapshot('hash-reach')).reach.direction,'upstream');
    await run(`new Promise(resolve=>{addEventListener('hashchange',()=>requestAnimationFrame(resolve),{once:true});location.hash='';})`);await stable();assert.equal(await run('Archify.focus.active()'),null);
    await load('graph',{hash:'&embed=1#relation=edge-a'});assert.equal(await run('Archify.focus.relationship()'),null);assert.equal(await run(`document.querySelectorAll('[data-relationship-hit-key]').length`),0);
  });
  await t.test('copy fallback and delayed feedback retain node, reach and relation links',async()=>{
    for(const mode of ['success','reject','missing','false','throw']) {
      await load();await select('cdn');await run(`Archify.focus.reach('downstream',{reveal:false})`);
      const r=await run(`(async()=>{let value;const exec=document.execCommand;Object.defineProperty(navigator,'clipboard',{configurable:true,value:${mode==='missing'?'undefined':`{writeText:text=>{value=text;return ${mode==='success'?'Promise.resolve()':'Promise.reject(new Error("denied"))'};}}`}});
        document.execCommand=()=>{value=document.querySelector('textarea[readonly]').value;${mode==='throw'?'throw new Error("copy denied");':`return ${mode==='false'?'false':'true'};`}};
        try{const copied=await Archify.focus.copyLink();return {copied,hash:new URL(value).hash,query:new URL(value).search,label:document.getElementById('btn-focus-copy').textContent,remaining:document.querySelectorAll('textarea[readonly]').length};}finally{document.execCommand=exec;}})()`);
      assert.equal(r.copied,!['false','throw'].includes(mode));assert.equal(r.hash,'#focus=cdn&reach=downstream');assert.match(r.query,/keep=yes/);assert.equal(r.remaining,0);assert.equal(r.label,r.copied?'Copied':'Copy failed');records.push({scenario:'copy-'+mode,...r});
      await run(`focusWait(()=>document.getElementById('btn-focus-copy').textContent===viewerText('viewer.passport.copy'))`);
    }
    await load();await run(`Archify.focus.inspectRelationshipById('edge-d');Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:value=>{window.copiedFocusUrl=value;return Promise.resolve();}}})`);assert.equal(await run('Archify.focus.copyLink()'),true);assert.equal(await run('new URL(copiedFocusUrl).hash'),'#relation=edge-d');await run('Archify.focus.clear()');await run('new Promise(resolve=>setTimeout(resolve,1650))');assert.equal(await run(`document.getElementById('btn-focus-copy').textContent`),await run(`viewerText('viewer.passport.copy')`));assert.equal(await run('Archify.focus.copyLink()'),false);
  });
  await t.test('real pulse completion and motion transitions preserve static relationship state',async()=>{
    await load('graph',{reduced:false});await run(`Archify.focus.inspectRelationshipById('edge-d')`);assert.equal(await run(`document.querySelectorAll('[data-relationship-pulse-overlay]').length`),1);
    await run(`focusWait(()=>pulseEvents.some(e=>e.type==='animationend'&&e.trusted))`);assert.equal((await snapshot('pulse-ended')).pulse,0);
    await run(`Archify.focus.clear();Archify.focus.inspectRelationshipById('edge-d')`);await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await run(`focusWait(()=>!document.querySelector('[data-relationship-pulse-overlay]'))`);assert.equal((await snapshot('reduced-preserves-pin')).relationship.id,'edge-d');
    await load('graph',{reduced:false});await run(`Archify.focus.inspectRelationshipById('edge-d');focusWait(()=>document.querySelector('.relationship-flow-pulse').getAnimations().some(a=>a.currentTime>0))`);await run(`document.querySelector('.relationship-flow-pulse').style.animation='none'`);await run(`focusWait(()=>pulseEvents.some(e=>e.type==='animationcancel'&&e.trusted))`);assert.equal(await run(`document.querySelectorAll('[data-relationship-pulse-overlay]').length`),0);
    await run(`Archify.focus.clear();Object.defineProperty(document,'hidden',{configurable:true,value:true});Archify.focus.inspectRelationshipById('edge-d');document.dispatchEvent(new Event('visibilitychange'))`);assert.equal((await snapshot('hidden-fixture')).pulse,0);
    await load('graph',{reduced:false});await run(`Archify.motionGovernor.pause();Archify.focus.inspectRelationshipById('edge-d')`);assert.equal((await snapshot('still-preserves-pin')).pulse,0);
  });
  await t.test('real SVG export strips temporary Focus, Reach and relationship state from clones',async()=>{
    for(const [name,setup] of [['focus',`Archify.focus.set('cdn')`],['reach',`Archify.focus.set('cdn');Archify.focus.reach('downstream',{reveal:false})`],['pin',`Archify.focus.inspectRelationshipById('edge-d')`],['preview',`Archify.focus.set('cdn');document.getElementById('btn-focus-relations').click();document.querySelector('#relationship-lens-list [data-relationship-key="b"]').focus()`]]) {
      await load('graph',{reduced:false});await run(setup);
      const present=await run(`(()=>{const svg=document.querySelector('.diagram-container > svg');return {focus:svg.hasAttribute('data-focus-active'),reach:svg.hasAttribute('data-reach-active'),pin:svg.hasAttribute('data-relationship-pin-active'),preview:svg.hasAttribute('data-relationship-preview-active'),pulse:!!svg.querySelector('[data-relationship-pulse-overlay]'),hits:!!svg.querySelector('[data-relationship-hit-overlay]')};})()`);
      assert.deepEqual(present,{focus:true,reach:name==='reach',pin:name==='pin',preview:['pin','preview'].includes(name),pulse:['pin','preview'].includes(name),hits:true});
      const r=await run(`(async()=>{const svg=document.querySelector('.diagram-container > svg'),before=svg.outerHTML,create=URL.createObjectURL;let blob,after;
        const geometry=root=>[...root.querySelectorAll('[data-edge-from]')].map(n=>({tag:n.tagName,key:n.dataset.edgeKey,d:n.getAttribute('d'),points:n.getAttribute('points'),transform:n.getAttribute('transform')}));const source=geometry(svg);
        URL.createObjectURL=value=>{if(value.type.startsWith('image/svg+xml'))blob=value;return create.call(URL,value);};try{const pending=Archify.exportMenu.run('svg');after=svg.outerHTML;await pending;}finally{URL.createObjectURL=create;}
        const root=new DOMParser().parseFromString(await blob.text(),'image/svg+xml').documentElement;
        return {liveSame:before===after,geometrySame:JSON.stringify(source)===JSON.stringify(geometry(root)),viewBox:root.getAttribute('viewBox')===svg.getAttribute('viewBox'),clean:![root,...root.querySelectorAll('*')].some(n=>[...n.attributes].some(a=>/^data-(focus|reach|relationship)/.test(a.name)))};})()`);
      // Moving focus to the export trigger clears the focus-backed preview.
      assert.deepEqual(r,{liveSame:name!=='preview',geometrySame:true,viewBox:true,clean:true});records.push({scenario:'export-'+name,present,...r});
    }
  });
  await t.test('Passport layout and dark/light output remain stable through viewport and camera changes',async()=>{
    for(const width of [390,720,1440]) {
      await load('architecture',{width});await select('api');await focus('#btn-focus-relations');await key('Enter','Enter',13);await run(`Archify.view.reveal(['api'],{reason:'focus',instant:true})`);await stable();
      const r=await run(`(()=>{const chip=document.getElementById('focus-chip'),r=chip.getBoundingClientRect();return {hidden:chip.hidden,width:r.width,left:r.left,right:r.right,viewport:innerWidth,top:r.top,bottom:r.bottom,height:innerHeight};})()`);assert.equal(r.hidden,false);assert.ok(r.width>0&&r.left>=-1&&r.right<=r.viewport+1,JSON.stringify(r));assert.ok(r.top>=-1&&r.bottom<=r.height+1,JSON.stringify(r));records.push({scenario:'layout-'+width,...r});
    }
    for(const theme of ['dark','light']) {
      await load('architecture',{theme});await select('api');await focus('#btn-focus-relations');await key('Enter','Enter',13);await stable();await snapshot(theme+'-passport');
      if(evidence){await run(`Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{})))`);const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(evidence,theme+'-passport.png'),Buffer.from(shot.data,'base64'));}
    }
  });
});
