import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseExplainer} from '../archify/explainer/parse.mjs';
import {validateExplainer} from '../archify/explainer/validate.mjs';

const base=()=>({schema_version:1,diagram_type:'explainer',meta:{id:'artifact',title:'Cache explanation'},answer:{summary:'Read the cache first.'},panels:[{id:'reasoning',title:'Why does it work?',blocks:[{id:'claim',type:'prose',text:'A cache stores a temporary copy.'}]}],sources:[{id:'evidence',title:'Stated facts'}]});
const blocks=document=>document.panels[0].blocks;
const check=(document,code)=>{const result=validateExplainer(document);assert.equal(result.ok,false);const issue=result.diagnostics.find(issue=>issue.code===`explainer/${code}`);assert.ok(issue,JSON.stringify(result.diagnostics));assert.ok(issue.subject.line>=1);assert.ok(issue.subject.component);assert.ok(issue.evidence.reason);assert.ok(issue.evidence.example);return issue;};

test('generated schema rejects injected execution, resources and author approval fields',()=>{
  for(const [path,property,value]of [['document','preparedSources',{}],['source','verified',true],['block','html','<script>bad()</script>']]) {
    const d=base();if(path==='document')d[property]=value;else if(path==='source')d.sources[0][property]=value;else if(path==='block')blocks(d)[0][property]=value;
    const issue=check(d,'schema-additionalProperties');assert.match(issue.subject.path,new RegExp(`/${property}$`));
  }
});

test('comparison assessments remain per cell and invalid widths locate the offending row',()=>{
  const d=base();blocks(d).push({id:'compare',type:'comparison',columns:['A','B'],rows:[{id:'cost',label:'Cost',cells:[{text:'Low',assessment:'good'},{text:'High',assessment:'bad'}]}]});assert.equal(validateExplainer(d).ok,true);blocks(d)[1].rows[0].cells.pop();const issue=check(d,'table-width');assert.equal(issue.subject.path,'/panels/0/blocks/1/rows/0/cells');
});

test('inline safety keeps literal code and diff untouched while rejecting HTML and unsafe links',()=>{
  const d=base();blocks(d)[0].text='Literal `<script>` is code; [safe](https://example.com).';blocks(d).push({id:'diff',type:'diff',text:'+<script>literal diff</script>\n-[link](javascript:bad)'});assert.equal(validateExplainer(d).ok,true);
  blocks(d)[0].text='<script>bad()</script>';assert.equal(validateExplainer(d).ok,false);
  blocks(d)[0].text='[bad](javascript:alert(1))';assert.ok(validateExplainer(d).diagnostics.some(diagnostic=>diagnostic.code==='explainer/inline-target'));
});

test('diagram references name real diagram blocks and inline topology nodes',()=>{
  const parsed=parseExplainer('# Request\n\nRead the cache.\n\n## How? {#how}\n\n@sequence id=flow\n| actor api | API | backend |\n| actor redis | Redis | database |\n| api | redis | GET key |\n\nRead [Redis](node:flow.redis).\n\n@steps id=steps\n| lookup | Lookup | | flow | redis | | api-to-redis-1 |');assert.ok(parsed.document,JSON.stringify(parsed.diagnostics));assert.equal(validateExplainer(parsed.document).ok,true);
  blocks(parsed.document)[1].text='Read [missing](node:flow.missing).';check(parsed.document,'diagram-node');blocks(parsed.document)[1].text='Read [invalid](node:steps.redis).';check(parsed.document,'unresolved-reference');
});

test('native collection errors stay structured before resolving forward node references',()=>{
  for(const type of ['architecture','workflow','sequence','lifecycle','erd','class','timeline','waterfall','dataflow','tree']) {
    const key={architecture:'components',sequence:'participants',lifecycle:'states',erd:'entities',class:'types',timeline:'events',waterfall:'spans'}[type]||'nodes';
    for(const value of [{},[null]]) {
      const d=base();blocks(d)[0].text='Read [node](node:flow.api).';
      blocks(d).push({id:'flow',type:'diagram',diagramType:type,nodeBlocks:{api:'claim'},spec:{schema_version:type==='workflow'?2:1,diagram_type:type,meta:{title:'Malformed'},[key]:value}});
      const before=JSON.stringify(d),result=validateExplainer(d);
      assert.equal(result.ok,false);
      const native=result.diagnostics.find(issue=>issue.code.startsWith('explainer/native-schema/'));
      assert.ok(native,JSON.stringify(result.diagnostics));
      assert.match(native.subject.path,/^\/panels\/0\/blocks\/1\/spec/);
      assert.ok(native.evidence.reason);assert.ok(native.evidence.example);
      assert.equal(result.diagnostics.some(issue=>issue.code==='explainer/diagram-node'),false,'invalid topology must not produce misleading missing-node errors');
      assert.equal(JSON.stringify(d),before);
    }
  }
});

test('writing warnings are configurable and literal code is excluded from prose rules',()=>{
  const d=base();blocks(d)[0].text='进行检查，大量请求。';const warn=validateExplainer(d);assert.equal(warn.ok,true);assert.ok(warn.diagnostics.some(entry=>entry.code==='explainer/writing-light-verb'));assert.equal(validateExplainer(d,{writingMode:'strict'}).ok,false);assert.deepEqual(validateExplainer(d,{writingMode:'off'}).diagnostics,[]);blocks(d)[0].text='`进行检查，大量请求。`';assert.deepEqual(validateExplainer(d).diagnostics,[]);
});

test('global interactive IDs and source anchors cannot collide',()=>{
  const d=base();blocks(d).push({id:'reasoning',type:'prose',text:'Another block.'});check(d,'duplicate-id');blocks(d)[1].id='explainer-typical-1';check(d,'reserved-id');blocks(d)[1].id='source-evidence';check(d,'reserved-id');
});

test('built-in answer is a legitimate block target while chrome IDs remain reserved',()=>{
  const d=base();blocks(d)[0].text='Read [answer](block:answer).';assert.equal(validateExplainer(d).ok,true);blocks(d)[0].id='board';check(d,'reserved-id');
});

test('steps never silently discard a simultaneous node and route selection',()=>{
  const parsed=parseExplainer('# Request\n\nRead the cache.\n\n## How? {#how}\n\n@sequence id=flow\nactor api | API | backend\nactor redis | Redis | database\napi | redis | GET key\n\n@steps id=walkthrough\nlookup | Read cache');
  assert.ok(parsed.document,JSON.stringify(parsed.diagnostics));
  const step=blocks(parsed.document)[1].items[0];
  for(const target of [
    {diagram:'flow'},
    {diagram:'flow',node:'redis'},
    {diagram:'flow',route:['api','redis']},
    {diagram:'flow',edges:['api-to-redis-1']},
    {diagram:'flow',node:'redis',edges:['api-to-redis-1']},
    {diagram:'flow',route:['api','redis'],edges:['api-to-redis-1']},
  ]) {step.target=target;const result=validateExplainer(parsed.document);assert.equal(result.ok,true,JSON.stringify(result.diagnostics));}
  for(const target of [
    {diagram:'flow',node:'redis',route:['api','redis']},
    {diagram:'flow',node:'redis',route:['api','redis'],edges:['api-to-redis-1']},
  ]) {step.target=target;const issue=check(parsed.document,'diagram-target-exclusive');assert.equal(issue.subject.path,'/panels/0/blocks/1/items/0/target');assert.match(issue.evidence.example,/"node"/);assert.match(issue.evidence.example,/"route"/);}
});

test('source links resolve forward IDs and code requires a repository location',()=>{
 const d=base();blocks(d)[0].text='Read [facts](source:evidence) and [](source:evidence).';assert.equal(validateExplainer(d).ok,true);
 blocks(d)[0].text='[](source:missing)';check(d,'unresolved-reference');blocks(d)[0].text='Plain.';blocks(d).push({id:'code',type:'code',source:'evidence'});check(d,'code-source-kind');
});
test('answer accepts four reasons and local qualifications remain valid in strict writing mode',()=>{
 const d=base();d.answer.reasons=['Lower latency','Local transactions'];d.answer.scope='示例，未实测，仅供参考 [5 ms](typical:illustrative, not measured)';d.sources[0].title='illustrative, not measured';
 assert.deepEqual(validateExplainer(d).diagnostics,[]);
 for(const field of ['summary','reasons','body']){
   const changed=structuredClone(d);
   const text=field==='body'?'The counts are illustrative, not measured.':'示例中的请求共用一次调用，不代表结果会被缓存。';
   if(field==='summary')changed.answer.summary=text;
   if(field==='reasons')changed.answer.reasons=[text];
   if(field==='body')blocks(changed)[0].text=text;
   const result=validateExplainer(changed,{writingMode:'strict'});
   assert.equal(result.ok,true,JSON.stringify(result.diagnostics));
   assert.deepEqual(result.diagnostics,[]);
 }

 d.answer.reasons=Array(5).fill('Reason');check(d,'schema-maxItems');
});

test('live templates lint prose while typed fields and legacy braces retain their own grammar',()=>{
  const input=`# Live capacity {#diagram-page}

**{{metric:value}}** remains inside the range. A literal \`{{value:unknown}}\` stays in code.

@answer live=model

## How much? {#explanation}

Use {{value:unknown}} here as ordinary text.

@calc id=model
| range x | Count | 0 | 4 | 1 | 0 |
| let n | if(x > 0, 4 * x, 0) |

@metric id=value label=Load calc=model bind=n
| {good} | <= 8 | Safe |
| {caution} | < 12 | Busy |
| {bad} | else | Full |
`;
  const parsed=parseExplainer(input);
  const valid=validateExplainer(parsed.document,{sourceMap:parsed.sourceMap,writingMode:'strict'});
  assert.equal(valid.ok,true,JSON.stringify(valid.diagnostics));
  assert.equal(valid.grid.statesChecked,5);
  const invalid=parseExplainer(input.replace('4 * x','4 / (x-4)'));
  const diagnostics=validateExplainer(invalid.document,{sourceMap:invalid.sourceMap,inputPath:'model.md'}).diagnostics;
  const failure=diagnostics.find(d=>d.code==='explainer/calc-div-zero');
  assert.equal(failure.subject.path,'/panels/0/blocks/1/derived/0/expr');
  assert.equal(failure.subject.panelId,'explanation');
  assert.equal(failure.subject.input,'model.md');
  assert.equal(input.split('\n')[failure.subject.line-1][failure.subject.column-1],'*');
  assert.deepEqual(failure.evidence.inputs,{x:4});
  for (const [replace,code] of [
    ['{{metric:missing}}','calc-name'],['{{anything}}','calc-syntax'],
  ]) {
    const invalid=parseExplainer(input.replace('{{metric:value}}',replace));
    const diagnostic=validateExplainer(invalid.document,{sourceMap:invalid.sourceMap}).diagnostics.find(d=>d.code===`explainer/${code}`);
    assert.equal(diagnostic.subject.path,'/answer/summary');
    assert.equal(diagnostic.subject.expressionOffset,2);
  }
  const lower=parseExplainer(input.replace('< 12','< 7'));
  assert.ok(validateExplainer(lower.document).diagnostics.some(d=>d.code==='explainer/calc-threshold'));
});

test('interactive records reject unknown fields and conflicting metric and chart shapes',()=>{
  const d=base();
  blocks(d).push({type:'calc',id:'model',inputs:[{kind:'toggle',key:'enabled',label:'Enable',default:false,script:'extra'}],derived:[],presets:[]});
  check(d,'schema-additionalProperties');
  delete blocks(d)[1].inputs[0].script;
  blocks(d).push({type:'metric',id:'live-value',label:'Value',calc:'model',bind:'1',value:1});
  check(d,'schema-not');
  blocks(d).pop();
  blocks(d).push({type:'chart',id:'plot',text:'legacy',computed:{calc:'model',kind:'bar',ymin:0,ymax:10,labels:['A'],series:[{kind:'bar',label:'Value',values:['1']}]}})
  check(d,'schema-oneOf');
});

test('scenario-only pages validate and directed hops cannot choose parallel edges implicitly',async()=>{
  const {scenarioDiagramTargets}=await import('../archify/explainer/diagrams.mjs');
  const d=base();
  blocks(d).push({type:'scenarios',id:'paths',default:'one',cases:[{key:'one',label:'First'},{key:'two',label:'Second'}]});
  const diagram={type:'diagram',id:'flow',diagramType:'architecture',source:'flow.json',scenarios:'paths',active:[
    {case:'one',nodes:[],edges:[{from:'a',to:'b'}]},
    {case:'two',nodes:['b'],edges:[]},
  ]};
  blocks(d).push(diagram);
  assert.deepEqual(validateExplainer(d).grid,{version:1,mode:'full',scenarios:2,statesChecked:2,statesPossible:'2'});
  const native={semantic:{nodes:[{id:'a'},{id:'b'}],edges:[
    {id:'first',from:'a',to:'b'},{id:'second',from:'a',to:'b'},{id:'back',from:'b',to:'a'},
  ]}};
  const context={pointer:'/panels/0/blocks/2',panelId:'reasoning',sourcePath:'diagram.md'};
  assert.throws(()=>scenarioDiagramTargets(diagram,native,context),error=>{
    const diagnostic=error.archifyDiagnostics[0];
    return diagnostic.code==='explainer/scenario-target' && diagnostic.subject.path.endsWith('/active/0/edges/0') &&
      diagnostic.message.includes('first, second') && !diagnostic.message.includes('back');
  });
  diagram.active[0].edges=[{id:'second'}];
  assert.deepEqual(scenarioDiagramTargets(diagram,native,context).active[0],{key:'one',nodes:['a','b'],edges:['second']});
});


test('expression diagnostics locate an operator after a JSON string escape',()=>{
  const d=base();
  blocks(d).push({type:'calc',id:'model',inputs:[],derived:[{key:'broken',expr:'1 / 0'}],presets:[]});
  const sourceText=JSON.stringify(d,null,2).replace('"1 / 0"','"\\u0031 / 0"');
  const parsed=parseExplainer(sourceText);
  const issue=validateExplainer(parsed.document,{sourceMap:parsed.sourceMap,sourceText}).diagnostics.find(d=>d.code==='explainer/calc-div-zero');
  assert.equal(issue.subject.expressionOffset,2);
  assert.equal(sourceText.split('\n')[issue.subject.line-1][issue.subject.column-1],'/');
});

test('multiline live prose diagnostics point to the authored slot after indentation and pipe escapes',()=>{
  const sourceText=[
    '# Live values {#readout}', '', 'Read the calculated value.', '', '## Model {#controls}', '',
    '@calc id=model', '| let value | 2 |', '', '@prose id=reading live=model',
    '| Read {{value:value}}. |', '    | Later \\| text before {{value:missing}}. |',
  ].join('\r\n');
  const parsed=parseExplainer(sourceText);
  const rows=parsed.sourceMap['/panels/0/blocks/1/text'].rows;
  const authored=sourceText.split('\r\n')[11];
  assert.equal(rows[1].start,sourceText.indexOf('Later'));
  const issue=validateExplainer(parsed.document,{sourceMap:parsed.sourceMap,sourceText}).diagnostics.find(d=>d.code==='explainer/calc-name');
  assert.equal(issue.subject.line,12);
  assert.equal(issue.subject.column,authored.indexOf('{{')+1);
});

test('labels displayed literally reject inline markup',()=>{
  const sourceText=`# Live values {#readout}

Read the calculated value.

## Model {#controls}

@scenarios id=mode default=warm
| case warm | **Warm** cache |

@calc id=model
| toggle enabled | *Enable* cache | false |
| preset on | \`Turn on\` | enabled=true |
`;
  const parsed=parseExplainer(sourceText);
  const diagnostics=validateExplainer(parsed.document,{sourceMap:parsed.sourceMap,sourceText}).diagnostics;
  assert.deepEqual(diagnostics.filter(d=>d.code==='explainer/label-markup').map(d=>d.subject.path),[
    '/panels/0/blocks/0/cases/0/label','/panels/0/blocks/1/inputs/0/label','/panels/0/blocks/1/presets/0/label',
  ]);
});

test('quoted prose reports unknown live slots at the authored column after escaped quotes',()=>{
  const sourceText=String.raw`# Live values {#readout}

Read the calculated value.

## Model {#controls}

@calc id=model
| let value | 1 |

  @prose live=model text="Read \"quoted\" text before {{metric:unknown}}."
`;
  const parsed=parseExplainer(sourceText);
  assert.deepEqual(parsed.diagnostics,[]);
  const issue=validateExplainer(parsed.document,{sourceMap:parsed.sourceMap,sourceText}).diagnostics.find(d=>d.code==='explainer/calc-name');
  const authored=sourceText.split('\n').find(line=>line.includes('@prose'));
  assert.equal(issue.subject.line,10);
  assert.equal(issue.subject.column,authored.indexOf('{{')+1);
});
