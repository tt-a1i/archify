import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from 'parse5';
import {layoutExplainerPanels} from '../archify/explainer/layout.mjs';
import {parseExplainer} from '../archify/explainer/parse.mjs';
import {prepareExplainer} from '../archify/explainer/prepare.mjs';
import {renderExplainer} from '../archify/explainer/render.mjs';
const panel=(id,type='prose',extra={})=>({id,title:id,blocks:[{id:id+'-body',type,text:'Short.',...extra}]});
const document=panels=>({meta:{id:'board',title:'Board'},answer:{summary:'Conclusion.'},panels,sources:[]});
const all=(n,fn)=>[...(fn(n)?[n]:[]),...(n.childNodes||[]).flatMap(c=>all(c,fn))];
const attr=(n,key)=>n.attrs?.find(a=>a.name===key)?.value;

test('board preserves order, content widths and fills each row including the last',()=>{
 const d=document([panel('compare','comparison',{columns:['A','B']}),panel('short'),panel('long','list',{items:['A'.repeat(100)]}),panel('third'),panel('code','code'),panel('end')]);
 const rows=layoutExplainerPanels(d);
 assert.deepEqual(rows.map(row=>row.map(({id,span})=>[id,span])),[[['answer',5],['compare',7]],[['short',4],['long',4],['third',4]],[['code',8],['end',4]]]);
 const mixed=layoutExplainerPanels(document([panel('large','comparison',{columns:['A','B','C']}),panel('short'),panel('long','prose',{text:'x'.repeat(400)})]));
 assert.deepEqual(mixed.map(row=>row.map(({id,span})=>[id,span])),[[['answer',5],['large',7]],[['short',4],['long',8]]]);
 const figure=layoutExplainerPanels(document([panel('figure','diagram')]),{'figure-body':{svg:'<svg viewBox="0 0 900 500">'}});
 assert.deepEqual(figure[0].map(p=>[p.id,p.span]),[['answer',4],['figure',8]]);
 const growing=layoutExplainerPanels(document([panel('long','prose',{text:'x'.repeat(400)})]));assert.deepEqual(growing[0].map(p=>p.span),[5,7]);
 for(const packed of [layoutExplainerPanels(document([])),rows,mixed,growing])assert.ok(packed.every(row=>row.reduce((sum,p)=>sum+p.span,0)===12));
});

test('native width is estimated from the prepared viewBox; authored spans stay exact',()=>{
 const d=document([panel('normal','diagram'),panel('wide','diagram'),{...panel('fixed'),span:3},{...panel('fixed-other'),span:4}]);
 const rows=layoutExplainerPanels(d,{'normal-body':{svg:'<svg viewBox="0 0 600 500">'},'wide-body':{svg:'<svg viewBox="0 0 1100 500">'}});
 assert.equal(rows.flat().find(p=>p.id==='wide').span,12);
 assert.equal(rows.flat().find(p=>p.id==='fixed').span,3);assert.equal(rows.flat().find(p=>p.id==='fixed-other').span,4);assert.equal(rows.at(-1).at(-1).spacer,true);
 assert.ok(rows.every(row=>row.reduce((sum,p)=>sum+p.span,0)===12));
});

test('an authored answer width preserves its columns and the following comparison row',()=>{
 for(let span=1;span<=12;span++){
  const d=document([{...panel('view'),span:6},{...panel('copy'),span:6}]);d.answer.span=span;
  const rows=layoutExplainerPanels(d);
  assert.equal(rows[0][0].span,span);
  if(span===12)assert.deepEqual(rows.map(row=>row.map(item=>item.id)),[['answer'],['view','copy']]);
  const html=renderExplainer(d),tree=parse(html),answer=all(tree,n=>attr(n,'id')==='answer')[0];
  assert.equal(attr(answer,'data-span-fixed'),String(span));
 }
});

test('all three example HTML boards start with the conclusion and every panel row totals twelve',async()=>{
 for(const name of ['comparison','mechanism','diagram']){
  const url=new URL(`../docs/specs/explainer/examples/${name}.md`,import.meta.url),text=fs.readFileSync(url,'utf8');
  const prepared=await prepareExplainer(text,{inputPath:url.pathname});
  assert.equal(prepared.diagnostics.some(d=>d.code==='explainer/writing-qualification'),false);
  const tree=parse(renderExplainer(prepared.document,{...prepared,preparedBundle:prepared}));
  const board=all(tree,n=>attr(n,'class')==='board')[0],panels=board.childNodes.filter(n=>n.tagName==='section');
  assert.equal(attr(panels[0],'id'),'answer');assert.match(attr(panels[0],'class'),/^panel answer-panel span\d+$/);
  const rows=new Map();for(const item of panels){const row=attr(item,'data-row');rows.set(row,(rows.get(row)||0)+Number(attr(item,'class').match(/\bspan(\d+)\b/)[1]));}assert.ok([...rows.values()].every(n=>n===12),`${name}: ${JSON.stringify([...rows])}`);
  assert.equal(prepared.document.answer.reasons.length>=2,true);assert.equal(prepared.document.answer.reasons.length<=3,true);
 }
});
