import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compileWhatIf, decimalGrid, evaluateWhatIf, formatNumber } from '../archify/explainer/whatif-engine.mjs';
import { checkWhatIfGrid, gridRanks } from '../archify/explainer/whatif-grid.mjs';
import { parseValidatedExplainer } from '../archify/explainer/prepare.mjs';
import { compileExplainerWhatIf } from '../archify/explainer/validate.mjs';

const range = (key, min, max, step, initial = min) => ({ kind:'range',key,label:key,min,max,step,default:initial });
const model = (blocks, { inputs = [], derived = [], presets = [] } = {}) => compileWhatIf({
  answer:{}, panels:[{blocks:[{type:'calc',id:'model',inputs,derived,presets},...blocks]}],
});
const metric = bind => ({type:'metric',id:'result',calc:'model',bind});

function result(bind, options) {
  const compiled = model([metric(bind)],options);
  return evaluateWhatIf(compiled,compiled.initial).metrics.get('result').value;
}

test('binary64 infix evaluation has stable precedence, typed branches and bounded power', () => {
  const derived=[{key:'payment',expr:'if(rate == 0, 10, 1 / rate)'},{key:'rate',expr:'0'}];
  assert.equal(result('payment + -(2 - 3) * .1e1 - 4 / 2 / 2',{derived}),10);
  assert.equal(result("if(kind == 'warm', round(-2.5), ceil(.1))",{
    inputs:[{kind:'choice',key:'kind',default:'warm',options:[{key:'warm'},{key:'cold'}]}],
  }),-2);
  assert.equal(result('pow(2,-3)'),0.125);
  assert.equal(result('pow(2,-1200)'),0);
  assert.equal(result('pow(0,0)'),1);
  assert.equal(result('if(true, -0, 1 / 0)'),0);
  assert.equal(Object.is(result('round(-.1)'),-0),false);
  assert.equal(formatNumber(-.00001,2,'%'),'0.00%');
  assert.equal(formatNumber(1200000.5,2,'USD'),'1,200,000.50\u00a0USD');
});

test('types, resource limits and numeric guards fail at their own boundaries', () => {
  const cases = [
    ['1 < 2 < 3','calc-syntax'],
    ['min(4)','calc-type'],
    ['if(true, 1, false)','calc-type'],
    ['if(false, true + 1, 0)','calc-type'],
    ['if(false, missing, 1)','calc-name'],
    ['constructor(1)','calc-name'],
    ['window.secret','calc-syntax'],
    ['a[0]','calc-syntax'],
    ["if(kind == 'unknown', 1, 0)",'calc-type'],
    ['-'.repeat(50)+'1','calc-syntax'],
    ['('.repeat(50)+'1'+')'.repeat(50),'calc-syntax'],
    ['min('+Array(129).fill('1').join(',')+')','calc-syntax'],
    ['1'.repeat(513),'calc-syntax'],
    ['1e400','calc-nonfinite'],
    ['1e16 - 1e16','calc-magnitude'],
    ['1e13','calc-magnitude'],
    ['pow(10,25) / 1e12','calc-magnitude'],
    ['1 / -0','calc-div-zero'],
    ['pow(0,-1)','calc-div-zero'],
    ['pow(2,1201)','calc-type'],
    ['pow(2,.5)','calc-type'],
    ['clamp(1,2,0)','calc-type'],
  ];
  const inputs=[{kind:'choice',key:'kind',default:'warm',options:[{key:'warm'},{key:'cold'}]}];
  for (const [expression,code] of cases) assert.throws(()=>result(expression,{inputs}),{code},expression);
  assert.throws(()=>result('a',{derived:[{key:'a',expr:'if(true,1,b)'},{key:'b',expr:'a'}]}),
    error=>error.code==='calc-cycle'&&error.message.includes('a → b → a'));
});

test('decimal grids enforce exact tick membership and end at the authored coordinate', () => {
  const grid = decimalGrid(-.3,.3,.1);
  assert.deepEqual(Array.from({length:grid.count},(_,i)=>grid.value(i)),[-.3,-.2,-.1,0,.1,.2,.3]);
  assert.equal(grid.index(.3),6);
  assert.equal(grid.index(.1+.2),-1);
  assert.throws(()=>decimalGrid(0,1,.3),{code:'calc-grid'});
  assert.throws(()=>decimalGrid(0,1,.000001),{code:'calc-grid'});
  const min=8589934592, max=8589934592.000004;
  assert.throws(()=>decimalGrid(min,max,.000001),{code:'calc-grid'});
  assert.throws(()=>decimalGrid(min,max,.000001,241,'chart-domain'),{code:'chart-domain'});
  const distinct=decimalGrid(min,max,.000002);
  assert.deepEqual(Array.from({length:distinct.count},(_,i)=>distinct.index(distinct.value(i))),[0,1,2]);
});

test('mixed-radix sampling keeps all mandatory ranks and fills from the remaining ranks', () => {
  const inputs=[range('x',0,20,1,4),range('y',0,19,1,6)];
  const presets=[{key:'outer',set:[{input:'y',value:11}]}];
  const compiled=model([metric('x+y')],{inputs,presets});
  const sampled=gridRanks(compiled);
  assert.equal(sampled.possible,420n);
  const mandatory=[0,19,9,86,91,200,209,219,400,419,409].sort((a,b)=>a-b);
  const remaining=Array.from({length:420},(_,i)=>i).filter(i=>!mandatory.includes(i));
  const count=256-mandatory.length;
  const expected=mandatory.concat(Array.from({length:count},(_,i)=>remaining[Math.floor((2*i+1)*remaining.length/(2*count))])).sort((a,b)=>a-b);
  assert.deepEqual(sampled.ranks.map(Number),expected);
  assert.deepEqual(sampled.tuple(86n),[4,6]);
  assert.deepEqual(checkWhatIfGrid(compiled,assert.fail),{version:1,mode:'sampled',scenarios:1,statesChecked:256,statesPossible:'420'});

  const huge=gridRanks(model([],{inputs:Array.from({length:6},(_,i)=>range('x'+i,0,10000,1))}));
  assert.equal(huge.possible,10001n**6n);
  assert.equal(huge.ranks.length,256);
  assert.deepEqual(huge.tuple(huge.ranks.at(-1)),Array(6).fill(10000));

  const small=gridRanks(model([],{inputs:[range('a',0,1,1),range('b',0,2,1)]}));
  assert.deepEqual(small.ranks.map(small.tuple),[[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]]);
});

test('last chart sample and unused formulas are checked, and expensive models are refused before evaluation', () => {
  function chart(expr) {
    return {type:'chart',id:'chart',computed:{calc:'model',kind:'line',ymin:0,ymax:20,
      domain:{from:0,to:240,step:1},series:[{kind:'line',label:'First line',expr}]}};
  }
  const checked=model([chart('if(t == 240, 1 / 0, 1)')],{derived:[{key:'unused',expr:'1 / 0'}]});
  const errors=[];
  checkWhatIfGrid(checked,(error,details)=>errors.push([error.code,error.path,details]));
  assert.equal(errors.length,2);
  assert.deepEqual(errors[0],['calc-div-zero','/panels/0/blocks/0/derived/0/expr',{inputs:{}}]);
  assert.deepEqual(errors[1],['calc-div-zero','/panels/0/blocks/1/computed/series/0/expr',{inputs:{},series:'First line',t:240}]);
  const expensive=Array.from({length:8},(_,i)=>({...chart('pow(1,t) + pow(1,t)'),id:'chart'+i}));
  assert.throws(()=>checkWhatIfGrid(model(expensive,{inputs:[range('x',0,500,1)]}),assert.fail),{code:'calc-budget'});
});

test('unsampled inputs still use the same runtime guards', () => {
  const inputs=[range('x',0,1000,1)];
  const sampled=gridRanks(model([],{inputs}));
  const omitted=Array.from({length:1001},(_,i)=>i).find(i=>!sampled.ranks.includes(BigInt(i)));
  const compiled=model([metric(`1 / (x - ${omitted})`)],{inputs});
  assert.equal(checkWhatIfGrid(compiled,assert.fail).statesChecked,256);
  assert.throws(()=>evaluateWhatIf(compiled,{tuple:[omitted]}),{code:'calc-div-zero'});
});

for (const [name, expected] of [
  ['p99-cascading-failure',{ 'database-rate':'248.00\u00a0req/s',utilization:'100.75%','tail-latency':'620\u00a0ms' }],
  ['mortgage-prepayment',{ 'baseline-payment':'7,021.34\u00a0USD','monthly-payment':'5,851.11\u00a0USD','interest-saved':'80,853.50\u00a0USD' }],
]) test(`${name} computes the independently specified reference values`, () => {
  const source=fs.readFileSync(new URL(`../docs/cases/explainer/${name}.archify.md`,import.meta.url),'utf8');
  const {document,grid}=parseValidatedExplainer(source);
  const compiled=compileExplainerWhatIf(document);
  const state=evaluateWhatIf(compiled,compiled.initial);
  for (const [id,text] of Object.entries(expected)) assert.equal(state.metrics.get(id).text,text);
  assert.equal(grid.statesChecked,grid.scenarios*256);
  if (name==='p99-cascading-failure') {
    const recovered=evaluateWhatIf(compiled,{key:'recovery',tuple:compiled.overlay(state.tuple,compiled.caseSets.get('recovery'))});
    assert.equal(recovered.metrics.get('database-rate').text,'69.44\u00a0req/s');
    assert.equal(recovered.metrics.get('tail-latency').text,'210\u00a0ms');
  } else {
    const zeroRate=evaluateWhatIf(compiled,{key:'recast',tuple:compiled.overlay(state.tuple,compiled.presetSets.get('zeroRate'))});
    assert.equal(zeroRate.metrics.get('interest-saved').value,0);
    assert.equal(zeroRate.metrics.get('baseline-payment').value,5000);
    assert.equal(zeroRate.charts.get('balance-over-time')[1].at(-1),0);
    const full=evaluateWhatIf(compiled,{key:'recast',tuple:compiled.overlay(state.tuple,compiled.presetSets.get('fullPayment'))});
    assert.equal(full.metrics.get('monthly-payment').value,0);
  }
});
