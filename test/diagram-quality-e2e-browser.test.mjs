import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {verifyFiles,sha256} from '../benchmarks/diagram-quality/benchmark.mjs';
import {compareFromFiles} from '../benchmarks/diagram-quality/comparison.mjs';
import {ChromeVisualBrowser} from '../archify/bin/visual-check.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2));

test('offline native render → independent observation → paired report and numeric review form',async t=>{
 if(!process.env.ARCHIFY_CHROME)return t.skip('Set ARCHIFY_CHROME for browser E2E');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-comparison-e2e-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const corpusPath=path.join(root,'benchmarks/diagram-quality/corpus.json');
 const plan={baseRevision:'a'.repeat(40),candidateRevision:'b'.repeat(40),corpus:corpusPath,plannedRuns:[{taskId:'workflow-01',model:'none-offline-fixture',repeat:1}],runs:[]};
 for(const arm of ['base','candidate']){
  const sourceFile=path.join(dir,arm+'.json'),artifact=path.join(dir,arm+'.html');
  const source=JSON.parse(fs.readFileSync(path.join(root,'benchmarks/diagram-quality/examples/access.workflow.json')));
  // Hand-authored fixture regression: no model generation or performance measurement.
  if(arm==='candidate')source.nodes[0].label='Wrong';
  write(sourceFile,source);
  const render=spawnSync(process.execPath,[path.join(root,'archify/bin/archify.mjs'),'render','workflow',sourceFile,artifact],{cwd:dir,encoding:'utf8',timeout:30000});
  assert.equal(render.status,0,render.stdout+render.stderr);
  const artifactHash=sha256(fs.readFileSync(artifact)),sourceHash=sha256(fs.readFileSync(sourceFile));
  const run={runId:arm+'-offline',taskId:'workflow-01',arm,model:'none-offline-fixture',repeat:1,status:'completed',startedAt:'2026-10-23T00:00:00Z',completedAt:'2026-10-23T00:00:01Z',environment:{measurementMode:'offline-render'},sourceEvidence:'Hand-authored offline harness fixture; no model calls',candidates:[{artifactHash,sourceHash,submittedAt:'2026-10-23T00:00:01Z'}]};
  const runFile=path.join(dir,arm+'-run.json');write(runFile,run);
  const receipt=await verifyFiles({manifest:corpusPath,task:run.taskId,source:sourceFile,format:'archify',artifact,run:runFile,chrome:process.env.ARCHIFY_CHROME});
  assert.equal(receipt.objective.semantic.passed,arm==='base');
  assert.equal(receipt.editability.status,'verified',JSON.stringify(receipt.editability));
  assert.equal(receipt.grader.browserProfileCleaned,true);
  const receiptFile=path.join(dir,arm+'-receipt.json');write(receiptFile,receipt);
  plan.runs.push({arm,revision:arm==='base'?plan.baseRevision:plan.candidateRevision,receipt:receiptFile,source:sourceFile,artifact});
 }
 const planFile=path.join(dir,'plan.json');write(planFile,plan);
 const {comparison}=await compareFromFiles({plan:planFile,output:path.join(dir,'out')});
 assert.ok(comparison.pairs[0].delta.content<0);
 for(const arm of ['base','candidate']){
  assert.equal(comparison.pairs[0][arm].raw.durationMs,null);
  assert.equal(comparison.pairs[0][arm].raw.costUsd,null);
  assert.equal(comparison.pairs[0][arm].repairCount,null);
 }
 const browser=new ChromeVisualBrowser(process.env.ARCHIFY_CHROME);
 try{
  const session=await browser.sessionPromise;
  for(const name of ['index.html','review.html']){
   const loaded=browser.cdp.waitFor('Page.loadEventFired',session);
   await browser.cdp.send('Page.navigate',{url:pathToFileURL(path.join(dir,'out',name)).href},session);await loaded;
   const {result}=await browser.cdp.send('Runtime.evaluate',{expression:`JSON.stringify({text:document.body.innerText,broken:[...document.querySelectorAll('a[href]')].filter(a=>!a.getAttribute('href')).length,ratings:document.querySelectorAll('input[type=radio]').length})`,returnByValue:true},session);
   const state=JSON.parse(result.value);assert.equal(state.broken,0);assert.ok(state.text.length>100);
   if(name==='index.html')assert.match(state.text,/Wrong request|内容|content/);
   else assert.ok(state.ratings>=25,'Numeric human rubric is rendered');
  }
 }finally{await browser.close();}
});

test('transparent, covered, clipped text and invalid arrows cannot establish visible facts', async t => {
  if (!process.env.ARCHIFY_CHROME) return t.skip('Set ARCHIFY_CHROME for browser E2E');
  const { observeArtifact } = await import('../benchmarks/diagram-quality/browser.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-quality-paint-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const graph = { status: 'verified', nodes: [{ id: 'a', label: 'Client' }, { id: 'b', label: 'Server' }], edges: [{ from: 'a', to: 'b', label: 'secret' }] };
  const variants = [
    { name: 'transparent', textStyle: 'fill:transparent', badNode: true },
    { name: 'covered', overlay: '<rect x="0" y="0" width="220" height="240" fill="white"/>', badNode: true },
    { name: 'clipped', textStyle: 'clip-path:inset(100%)', badNode: true },
    { name: 'hidden-edge-label', edgeLabelStyle: 'opacity:0', badLabel: true },
    { name: 'missing-marker', marker: 'missing', badEdge: true },
    { name: 'empty-marker', marker: 'empty', badEdge: true },
    { name: 'transparent-marker', marker: 'transparent', badEdge: true },
    { name: 'double-arrow', startMarker: 'url(#arrow)', badEdge: true },
    { name: 'zero-marker', marker: 'zero', badEdge: true },
    { name: 'hidden-marker', marker: 'hidden', badEdge: true },
  ];
  for (const v of variants) {
    const file = path.join(dir, v.name + '.html');
    fs.writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240" viewBox="0 0 600 240"><defs><marker id="arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="black"/></marker><marker id="empty"/><marker id="transparent"><polygon points="0 0, 10 3.5, 0 7" fill="transparent"/></marker><marker id="zero" markerWidth="0" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7"/></marker><marker id="hidden" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" visibility="hidden"/></marker></defs><g data-node-id="a"><rect x="20" y="60" width="130" height="60"/><text x="40" y="95" font-size="20" fill="white" style="${v.textStyle || ''}">Client</text></g><g data-node-id="b"><rect x="400" y="60" width="130" height="60"/><text x="420" y="95" font-size="20" fill="white">Server</text></g><path data-edge-from="a" data-edge-to="b" d="M150 90L400 90" fill="none" stroke="black" marker-start="${v.startMarker || 'none'}" marker-end="url(#${v.marker || 'arrow'})"/><g data-edge-from="a" data-edge-to="b" style="${v.edgeLabelStyle || ''}"><text x="240" y="80" font-size="20">secret</text></g>${v.overlay || ''}</svg>`);
    const o = await observeArtifact({ artifactPath: file, graph, chromePath: process.env.ARCHIFY_CHROME });
    if (v.badNode) assert.ok(o.status === 'unverified' || !o.nodes.find(n => n.id === 'a').visible, v.name);
    if (v.badEdge) assert.ok(o.status === 'unverified' || !o.edges[0].visible, v.name);
    if (v.badLabel) assert.ok(o.status === 'unverified' || o.edges[0].label !== 'secret' || !o.edges[0].visible, v.name);
    assert.equal(fs.existsSync(o.browserProfile), false);
  }
});

test('browser observer reads painted text and closes its temporary Chrome profile', async t => {
  if (!process.env.ARCHIFY_CHROME) return t.skip('Set ARCHIFY_CHROME for browser E2E');
  const { observeArtifact } = await import('../benchmarks/diagram-quality/browser.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-quality-browser-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'diagram.html');
  fs.writeFileSync(file, `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240" viewBox="0 0 600 240"><g data-node-id="a" data-node-label="FAKE"><rect x="20" y="60" width="130" height="60"/><text x="40" y="95" font-size="20" fill="white">Client</text></g><g data-node-id="b" opacity="0"><rect x="400" y="60" width="130" height="60"/><text x="420" y="95" font-size="20">Server</text></g><path data-edge-from="a" data-edge-to="b" d="M150 90L400 90" stroke="black"/></svg>`);
  const graph = { nodes: [{ id: 'a', label: 'Client' }, { id: 'b', label: 'Server' }], edges: [{ from: 'a', to: 'b' }] };
  const o = await observeArtifact({ artifactPath: file, graph, chromePath: process.env.ARCHIFY_CHROME });
  assert.equal(o.nodes.find(n => n.id === 'a').label, 'Client');
  assert.equal(o.nodes.find(n => n.id === 'b').visible, false);
  assert.equal(o.method, 'chrome-dom-independent');
  assert.equal(fs.existsSync(o.browserProfile), false);
});
