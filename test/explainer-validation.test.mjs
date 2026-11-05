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
test('answer accepts at most four reasons and qualifier checks exclude scope and sources',()=>{
 const d=base();d.answer.reasons=['Lower latency','Local transactions'];d.answer.scope='示例，未实测，仅供参考 [5 ms](typical:illustrative, not measured)';d.sources[0].title='illustrative, not measured';
 assert.deepEqual(validateExplainer(d).diagnostics,[]);
 for(const field of ['summary','reasons','body']){const changed=structuredClone(d);if(field==='summary')changed.answer.summary='示例判断';if(field==='reasons')changed.answer.reasons=['本例适用'];if(field==='body')blocks(changed)[0].text='Illustrative, not measured.';const issues=validateExplainer(changed).diagnostics.filter(d=>d.code==='explainer/writing-qualification');assert.ok(issues.length,field);assert.ok(JSON.stringify(issues).includes('把限定条件写进 scope 或来源'));}
 d.answer.reasons=Array(5).fill('Reason');check(d,'schema-maxItems');
});
