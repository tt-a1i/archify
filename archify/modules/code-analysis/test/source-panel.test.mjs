import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { buildOverlay } from '../overlay/inject.mjs';
const graph = {repository:{}, unresolved:{}, excluded:{roles:[]}, modules:[{id:'asr',label:'asr',path:'asr',files:1,loc:3,fanIn:5,fanOut:5,instability:0.5,entry:['asr/worker.py']}], edges:[], fileModules:{'asr/worker.py':'asr'}};
const ir = {components:[{id:'asr',label:'ASR',sources:[{path:'asr/worker.py'}]}]};
const html = '<body><div class="toolbar"></div><svg><g data-node-id="asr"></g></svg></body>';
test('source listed in a mapped module is embedded even without import evidence', t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'analysis-source-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'asr'));
  fs.writeFileSync(path.join(root,'asr/worker.py'),'first\nsecond\nthird\n');
  const result=buildOverlay({ir,graph,html,sourceRoot:root,facts:{files:[{path:'asr/worker.py',loc:3,role:'source'}],imports:[]}});
  const data=JSON.parse(result.html.match(/id="bauify-analysis">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(data.snippets['asr/worker.py'].lines,['first','second','third']);
});
test('hub arrows and all Bezier controls stay outside the node columns', () => {
  const result=buildOverlay({ir,graph,html});
  const script=result.html.match(/id="bauify-script">([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(()=>new Function(script));
  const start=script.indexOf('  function hubDiagram('), end=script.indexOf('  // Two bars:',start);
  const draw=new Function('function svgOpen(){return "<svg>"} function short(s){return s} function nodeRect(){return ""} function hubSources(){return ""} '+script.slice(start,end)+';return hubDiagram;')();
  for(const count of [1,5,12]) {
    const nodes=Array.from({length:count},(_,i)=>'m'+i);
    const svg=draw({},[{subject:{module:'asr'},evidence:{dependents:nodes,dependencies:nodes,threshold:{fanIn:5,fanOut:5}}}]);
    const paths=[...svg.matchAll(/d="M([^"]+)"/g)];
    assert.equal(paths.length,count*2);
    for(const [index,match] of paths.entries()) {
      const points=match[1].split(/[ ,C]+/).map(Number);
      const xs=points.filter((_,i)=>i%2===0);
      const [min,max]=index<count?[125,145]:[255,275];
      assert.ok(xs.every(x=>x>min&&x<max),JSON.stringify(xs));
    }
  }
});

test('source links preserve distinct finding lines and never invent line one', () => {
  const script=buildOverlay({ir,graph,html}).html.match(/id="bauify-script">([\s\S]*?)<\/script>/)[1];
  const fileLink=script.slice(script.indexOf('  function fileLink('),script.indexOf("  document.body.addEventListener('click'",script.indexOf('  function fileLink(')));
  const sourceLinks=script.slice(script.indexOf('  function sourceLinks('),script.indexOf('  function hubSources('));
  const render=new Function('function esc(x){return x} function allFindings(c){return c.findings || []} '+fileLink+sourceLinks+';return sourceLinks;')();
  const c={findings:[{evidence:{imports:[{file:'worker.py',line:47},{file:'worker.py',line:93},{file:'worker.py',line:47}]}}]};
  const links=render(c,'worker.py');
  assert.deepEqual([...links.matchAll(/data-line="(\d+)"/g)].map(m=>Number(m[1])),[47,93]);
  assert.match(links,/worker.py:47/);
  assert.doesNotMatch(render(c,'other.py'),/data-line="1"/);
  assert.match(render({incoming:[],outgoing:[{evidence:[{file:'hub.py',line:28}]}]},'hub.py'),/data-line="28"/);
  const start=script.indexOf('  function showCode('),end=script.indexOf('  function showDetail(',start);
  let pane={hidden:true,innerHTML:'',querySelector:()=>({addEventListener(){},scrollIntoView(){}})};
  const show=new Function('codePane','data','detail','function esc(x){return x} '+script.slice(start,end)+';return showCode;')(pane,{snippets:{'worker.py':{lines:Array.from({length:100},(_,i)=>'code '+(i+1))}}},{});
  show('worker.py',47,'','amber');
  assert.match(pane.innerHTML,/Source · line 47/);
  assert.match(pane.innerHTML,/<span class="ln hit amber"><i>47<\/i>code 47/);
  show('worker.py',null,'','');
  assert.doesNotMatch(pane.innerHTML,/class="ln hit/);
  assert.match(pane.innerHTML,/full file/);
});
