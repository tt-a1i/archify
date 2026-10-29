import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseExplainer} from '../archify/explainer/parse.mjs';
import {validateExplainer} from '../archify/explainer/validate.mjs';

const draft = content => `# Cache choice {#cache-choice}\n\nRead the cache first on the request path.\n\n@source docs title="Fixture facts"\n\n## What follows? {#reasoning}\n\n${content}\n`;
const parse = value => { const result=parseExplainer(value,{inputPath:'answer.md'}); assert.ok(result.document,JSON.stringify(result.diagnostics));return result; };

test('explainer author families preserve literal values and normalize typed public data',()=>{
  const result=parse(draft(`A **direct** paragraph with [facts](source:docs).

- First option
- Second option

| Criterion | Option A | Option B |
| --- | --- | --- |
| Cost | Low {good:Affordable} | High {bad} |
| Syntax | \`a|b\` {caution} | x\\|y {good} |

@callout id=caution level=warning title="Condition"
| Check the premise first. |

@facts id=facts
| Token | literal\\|value |

@metric id=metric label="Latency" value=12.5 limit=20 unit=ms typical=true

@steps id=steps
| first-step | Read the explanation |

@code id=snippet source=repo language=js

@image id=image path=images/path.png alt="Request path"

@diff id=change caption="Literal change"
\`\`\`diff
-const tag = '<old>'; // | literal
+const tag = '<new>'; // $HOME
\`\`\`
`));
  const blocks=result.document.panels[0].blocks;
  assert.deepEqual(blocks.map(block=>block.type),['prose','list','comparison','callout','facts','metric','steps','code','image','diff']);
  assert.equal(blocks[2].rows[0].cells[0].verdict,'Affordable');
  assert.equal(blocks[2].rows[1].cells[0].text,'`a|b`');
  assert.equal(blocks[2].rows[1].cells[1].text,'x|y');
  assert.equal(blocks[4].entries[0].value,'literal|value');
  assert.equal(blocks[5].value,12.5);
  assert.equal(blocks.at(-1).text,"-const tag = '<old>'; // | literal\n+const tag = '<new>'; // $HOME");
});

test('automatic heading IDs survive insertion and duplicate headings offer an explicit repair',()=>{
  const original=parse('# Title\n\nAnswer.\n\n## What is A?\n\nA text.\n\n## What is B?\n\nB text.');
  const inserted=parse('# Title\n\nAnswer.\n\n## What is C?\n\nC text.\n\n## What is A?\n\nA text.\n\n## What is B?\n\nB text.');
  assert.deepEqual(inserted.document.panels.slice(1).map(panel=>panel.id),original.document.panels.map(panel=>panel.id));
  assert.deepEqual(inserted.document.panels.slice(1).map(panel=>panel.blocks[0].id),original.document.panels.map(panel=>panel.blocks[0].id));
  const repeated=parseExplainer('# Title\n\nAnswer.\n\n## Same?\n\nText.\n\n## Same?\n\nOther.');
  assert.equal(repeated.document,null);assert.match(repeated.diagnostics[0].evidence.reason,/Duplicate/);assert.match(repeated.diagnostics[0].evidence.example,/\{#/);
  assert.ok(parse('# Title\n\nAnswer.\n\n## Same? {#first}\n\nText.\n\n## Same? {#second}\n\nOther.').document);
});

test('panel offsets enable exact replacement without rewriting untouched source or CRLF',()=>{
  const original='# 标题\r\n\r\n结论。\r\n\r\n## 第一个？ {#first}\r\n\r\n保留此段。\r\n\r\n## 第二个？ {#second}\r\n\r\n更改此段。\r\n';
  const result=parse(original);const range=result.sourceMap['/panels/1'];
  assert.equal(range.line,9);assert.equal(original.slice(range.start,range.end),'## 第二个？ {#second}\r\n\r\n更改此段。\r\n');
  const next=original.slice(0,range.start)+'## 第二个？ {#second}\r\n\r\n新内容。\r\n'+original.slice(range.end);
  const updated=parse(next);assert.deepEqual(updated.document.panels[0],result.document.panels[0]);assert.equal(updated.document.panels[1].id,'second');
});

test('JSON is not reinterpreted and exact nested field lines survive schema diagnostics',()=>{
  const json=`{\n"schema_version":1,\n"diagram_type":"explainer",\n"meta":{"id":"artifact","title":"Title"},\n"answer":{"summary":"Answer."},\n"panels":[{"id":"panel","title":"Why?","blocks":[{\n"id":"latency","type":"metric","label":"Latency",\n"value":"wrong"\n}]}],\n"sources":[{"id":"facts","title":"Facts"}]\n}`;
  const result=parse(json);assert.equal(result.format,'json');assert.equal(result.document.sources[0].title,'Facts');
  const validated=validateExplainer(result.document,{sourceMap:result.sourceMap});assert.equal(validated.ok,false);
  assert.equal(validated.diagnostics.find(entry=>entry.subject.path==='/panels/0/blocks/0/value').subject.line,8);
  const duplicate=parseExplainer('{"answer":{},"answer":{}}');assert.equal(duplicate.document,null);assert.match(duplicate.diagnostics[0].message,/Duplicate JSON/);
  assert.ok(parseExplainer('{"sources":{}}').document,'valid JSON with the wrong shape should reach schema validation');
});

test('native shorthand preserves api to redis and source file references stay explicit',()=>{
  const result=parse(draft(`@sequence id=request
| actor api | API | backend |
| actor redis | Redis | database |
| api | redis | GET key |

@diagram waterfall id=trace source=trace.waterfall.json

@steps id=walkthrough
| query | Read cache | | request | | api~redis | api-to-redis-1 |`));
  const [sequence,external,steps]=result.document.panels[0].blocks;
  assert.equal(sequence.spec.messages[0].from,'api');assert.equal(sequence.spec.messages[0].to,'redis');
  assert.deepEqual({type:external.diagramType,source:external.source},{type:'waterfall',source:'trace.waterfall.json'});
  assert.deepEqual(steps.items[0].target.route,['api','redis']);
  assert.equal(validateExplainer(result.document).ok,true);
});

test('restricted syntax errors contain a line, component, reason and repair example',()=>{
  const cases=[['@unknown\n| x |',9],['@facts\n| one |',10],['@metric label="Latency" value=Infinity',9],['@callout title="Unclosed',9],['@diff\n```diff\n+new',9],['### Unsupported deep heading',9]];
  for(const [content,line]of cases) {
    const result=parseExplainer(draft(content),{inputPath:'bad.md'});assert.equal(result.document,null,content);
    const issue=result.diagnostics[0];assert.equal(issue.subject.line,line,content);assert.ok(issue.subject.component);assert.ok(issue.evidence.reason);assert.ok(issue.evidence.example);assert.equal(issue.subject.input,'bad.md');
  }
});

test('frozen real format-calibration drafts parse and validate without rewriting their syntax',()=>{
  const drafts=[
    '# 临时数据方案\n结论：选 A。这是虚构场景：团队要存放临时预览数据。\n\n## 标准是否满足？\n| 标准 | A | B |\n|---|---|---|\n| 数据无需跨重启保留 | ok | ok |\n| 无需磁盘 | ok | no |\n| 无需后台任务 | ok | no |\n',
    '# 缓存读取\n这里只说明流程，没有测量性能。\n\n## 命中和未命中怎样处理？\n1. API 先查 Redis。\n2. 命中时，API 直接返回缓存值。\n3. 未命中时，API 读取数据库。\n4. API 回填 Redis，再返回结果。\n',
    '# 记录请求\n请求经 API 查询 Store，再返回 Client。\n\n## 请求怎样往返？\n@sequence\nClient | API | 请求记录\nAPI | Store | 查询记录\nStore | API | 返回记录 | return\nAPI | Client | 返回记录 | return\n',
  ];
  for(const draft of drafts){const result=parseExplainer(draft,{output:'/tmp/explainer-calibration/result.html'});assert.ok(result.document,JSON.stringify(result.diagnostics));assert.equal(result.document.meta.output,'result.html');const validated=validateExplainer(result.document,{sourceMap:result.sourceMap});assert.equal(validated.ok,true,JSON.stringify(validated.diagnostics));}
});

test('diagram cells retain literal pipes and source map keeps title location after metadata',()=>{
  const result=parse(draft(`@meta locale=en

@sequence id=trace
actor api | API | backend
actor store | Store | database
api | store | Query\\|read
`));
  assert.equal(result.document.panels[0].blocks[0].spec.messages[0].label,'Query|read');assert.equal(result.sourceMap['/meta/title'].line,1);assert.equal(result.sourceMap['/meta/locale'].line,9);
});

test('answer reasons, scope, numbered source syntax and explicit spans normalize without hidden fields',()=>{
 const result=parse('# Title\n\nChoose a modular monolith.\n\n- One deployment\n- Local transactions\n\n@answer scope="An eight-person team"\n@source docs title="Reference" url=https://example.com\n\n## Why? {#why span=7}\n\nRead [docs](source:docs). [](source:docs)\n');
 assert.deepEqual(result.document.answer,{summary:'Choose a modular monolith.',reasons:['One deployment','Local transactions'],scope:'An eight-person team'});
 assert.equal(result.document.panels[0].span,7);assert.equal(validateExplainer(result.document).ok,true);
 assert.equal(result.sourceMap['/answer/reasons/0'].line,5);
 for(const list of ['1. Ordered','- First\n  - Nested'])assert.equal(parseExplainer('# Title\n\nAnswer.\n\n'+list).document,null);
});

test('comparison row IDs stay stable',()=>{
 const result=parse(draft('@comparison columns="A,B"\nCost {#cost-row} | Low {good} | High {bad}'));
 assert.equal(result.document.panels[0].blocks[0].rows[0].id,'cost-row');assert.equal(validateExplainer(result.document).ok,true);
 const original=parse(draft('@comparison id=choices columns="A,B"\nCost | Low | High'));
 const named=parse(draft('@comparison id=choices columns="A,B"\nCost {#named-cost} | Other | Other\nCost | Low | High\n\nRead [the named row](block:named-cost).'));
 assert.equal(named.document.panels[0].blocks[0].rows[1].id,original.document.panels[0].blocks[0].rows[0].id,'an authored ID does not change the automatic identity of another row');
 assert.equal(validateExplainer(named.document).ok,true);
 const duplicate=parse(draft('@comparison columns="A,B"\nCost {#cost-row} | Low | High\nCost {#cost-row} | Other | Other'));
 for(const document of [duplicate.document,parse(JSON.stringify(duplicate.document)).document]) {
   const checked=validateExplainer(document);
   assert.equal(checked.ok,false);
   assert.ok(checked.diagnostics.some(entry=>entry.code==='explainer/duplicate-id'&&entry.subject.path==='/panels/0/blocks/0/rows/1/id'),'explicit row IDs must still identify a single target');
 }
});

test('comparison tables preserve repeated labels as distinct rows',()=>{
 const rows=['| Ready | 7 |','| Ready | 9 |','| Ready | 9 |','| Ready {#named-ready} | 11 |'];
 for(const content of ['| Input | Value |\n| --- | --- |\n'+rows.join('\n'),'@comparison id=observations columns="Value"\n'+rows.join('\n')]) {
   const input=draft(content+'\n\nRead [the named row](block:named-ready).');
   const result=parse(input),table=result.document.panels[0].blocks[0];
   const checked=validateExplainer(result.document,{sourceMap:result.sourceMap});
   assert.equal(checked.ok,true,JSON.stringify(checked.diagnostics));
   assert.deepEqual(table.rows.map(row=>row.label),['Ready','Ready','Ready','Ready']);
   assert.deepEqual(table.rows.map(row=>row.cells[0].text),['7','9','9','11']);
   assert.equal(new Set(table.rows.map(row=>row.id)).size,4);
   assert.equal(table.rows[3].id,'named-ready');
   assert.deepEqual(parse(input).document,result.document,'replaying the same source must keep its identities');
   rows.forEach((row,index)=>{
     const location=result.sourceMap[`/panels/0/blocks/0/rows/${index}/id`];
     assert.equal(input.split('\n')[location.line-1],row,'each row retains its own source location');
   });
 }
});

test('reason lists immediately follow the conclusion and zero span reaches schema rejection',()=>{
 const separated=parseExplainer('# Title\n\nAnswer.\n\n@answer scope="Scope"\n\n- Late reason\n\n## Why?\n\nText.');assert.equal(separated.document,null);assert.equal(separated.diagnostics[0].subject.component,'answer');
 const zero=parse('# Title\n\nAnswer.\n\n## Why? {#why span=0}\n\nText.');assert.equal(zero.document.panels[0].span,0);assert.equal(validateExplainer(zero.document).ok,false);
});

test('plain code fences become literal snippets, diff fences become diffs, and table corners keep their header',()=>{
 const result=parse(draft('| Need | Output |\n| --- | --- |\n| Read | Diagram |\n\n```bash title="Run tests"\nnpm test -- --grep "a | b"\n```\n\n```diff\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n```'));
 const [table,snippet,diff]=result.document.panels[0].blocks;
 assert.equal(table.labelColumn,'Need');
 assert.deepEqual({type:snippet.type,language:snippet.language,title:snippet.title,text:snippet.text},{type:'snippet',language:'bash',title:'Run tests',text:'npm test -- --grep "a | b"'});
 assert.equal(diff.type,'diff');assert.match(diff.text,/^--- a\/x/);
 assert.equal(validateExplainer(result.document).ok,true);
 assert.equal(parseExplainer(draft('```js\nopen()')).document,null);
 assert.equal(parseExplainer(draft('```js lines=1:2\nx\n```')).document,null);
});

test('a callout may take the following paragraph and may share its panel ID without failing',()=>{
  const {document}=parse('# Title\n\nAnswer.\n\n## Pitfalls {#pitfalls}\n\n@callout id=pitfalls level=warning title="Stop first"\n\nDo not pay before checking the deed.\nAsk for the owner ID.\n\n## Next {#next}\n\nText.');
  const callout=document.panels[0].blocks[0];
  assert.equal(document.panels[0].blocks.length,1);
  assert.equal(callout.id,'pitfalls-callout');
  assert.equal(callout.text,'Do not pay before checking the deed.\nAsk for the owner ID.');
  assert.equal(parseExplainer('# T\n\nA.\n\n## Q {#flow}\n\n@sequence id=flow\n| a | b | hi |').document,null,'a diagram keeps its ID, so a clash with its panel still fails');
});

test('a comparison assessment may be followed by a citation',()=>{
  const {document}=parse('# T\n\nA.\n\n@source law title="Civil code" url=https://example.com/law\n\n## Q {#q}\n\n| Who | Risk |\n| --- | --- |\n| Sublet | Can be ended {bad:Lose both} [](source:law) |');
  const cell=document.panels[0].blocks[0].rows[0].cells[0];
  assert.equal(cell.assessment,'bad');
  assert.equal(cell.verdict,'Lose both');
  assert.equal(cell.text,'Can be ended[](source:law)');
});

test('a source cell ties a shorthand node to a declared source without entering the native spec',()=>{
  const {document}=parse('# T\n\nA.\n\n@source router title="Router" path=src/router.js lines=1:3\n\n## Q {#q}\n\n@architecture id=map\n| api | API | backend | source:router |\n| db | DB | database |\n| api > db | reads |');
  const block=document.panels[0].blocks[0];
  assert.deepEqual(block.nodeSources,{api:'router'});
  assert.ok(!JSON.stringify(block.spec).includes('source:router'));
  const missing=validateExplainer(parse('# T\n\nA.\n\n## Q {#q}\n\n@architecture id=map\n| api | API | backend | source:nope |\n| db | DB | database |\n| api > db | reads |').document);
  assert.equal(missing.ok,false);
});

test('an authored page style is kept and limited to the shipped styles',()=>{
  assert.equal(parse('# T\n\nA.\n\n@meta style=editorial\n\n## Q {#q}\n\nText.').document.meta.style,'editorial');
  assert.equal(validateExplainer(parse('# T\n\nA.\n\n@meta style=neon\n\n## Q {#q}\n\nText.').document).ok,false);
});

test('node content references reuse explicit prose IDs and follow body edits without changing the native graph',()=>{
  const draft='# T\n\nRead one shared explanation.\n\n@source docs title="Reference" url=https://example.com\n\n## How? {#how}\n\n@sequence id=flow\n| actor api | API | backend | block:api-notes | source:docs |\n| actor db | DB | database |\n| api | db | Read |\n\n@prose id=api-notes\n| First explanation. |';
  const original=parse(draft), edited=parse(draft.replace('First explanation.','Updated explanation.'));
  const block=original.document.panels[0].blocks[0];
  assert.deepEqual(block.nodeBlocks,{api:'api-notes'});
  assert.deepEqual(block.nodeSources,{api:'docs'});
  const reordered=parse(draft.replace('| backend | block:api-notes | source:docs |','| source:docs | backend | block:api-notes |'));
  assert.deepEqual(reordered.document.panels[0].blocks[0],block,'source cells keep their previously accepted positions');
  assert.deepEqual(edited.document.panels[0].blocks[0],block);
  assert.equal(edited.document.panels[0].blocks[1].text,'Updated explanation.');
  assert.ok(!JSON.stringify(block.spec).includes('api-notes'));
  assert.equal(validateExplainer(original.document).ok,true);
  const invalid=parse(draft.replace('block:api-notes','block:missing'));
  const result=validateExplainer(invalid.document,{sourceMap:invalid.sourceMap});
  const diagnostic=result.diagnostics.find(entry=>entry.code==='explainer/unresolved-reference');
  assert.equal(diagnostic.subject.line,10,'a missing reference points to its node row');
  assert.equal(parseExplainer(draft.replace('block:api-notes','block:api-notes | block:other')).document,null);
  const recursive=parse(draft.replace('block:api-notes','block:flow'));
  assert.ok(validateExplainer(recursive.document).diagnostics.some(entry=>entry.code==='explainer/content-reference'));
  const wrongNode=structuredClone(original.document);wrongNode.panels[0].blocks[0].nodeBlocks={missing:'api-notes'};
  assert.ok(validateExplainer(wrongNode).diagnostics.some(entry=>entry.code==='explainer/diagram-node'));
});

test('diagram references reject message, phase, edge and field rows at the authored line',()=>{
  const sequence='@sequence id=flow\n| actor api | API | backend |\n| actor db | DB | database |';
  for(const reference of ['block:api-notes','source:docs'])for(const [declaration,row,tail]of [
    [sequence,`| api | db | Read | ${reference} |`,''],
    [sequence,`| phase | Read phase | ${reference} |`,'\n| api | db | Read |'],
    ['@architecture id=flow\n| api | API | backend |\n| db | DB | database |',`| api > db | Read | ${reference} |`,''],
    ['@erd id=flow\n| entity api | API |',`| api.id | bigint | pk | ${reference} |`,''],
  ]){
    const text=draft(`${declaration}\n${row}${tail}\n\n@prose id=api-notes\n| Explain the API. |`);
    const result=parseExplainer(text,{inputPath:'answer.md'});
    assert.equal(result.document,null,row);
    const issue=result.diagnostics.find(d=>d.message==='A content reference belongs to a node, actor or entity row.');
    assert.ok(issue,row);
    assert.equal(issue.subject.line,text.split('\n').indexOf(row)+1,row);
  }
});

test('declared nodes retain every previously accepted source-cell position',()=>{
  for(const [type,cells,before,after]of [
    ['architecture',['api','API','backend'],'','\n| db | DB | database |\n| api > db | Read |'],
    ['workflow',['api','API','backend','serve'],'| lane serve | Serve |\n','\n| db | DB | database | serve |\n| api > db | Read |'],
    ['sequence',['actor api','API','backend'],'','\n| actor db | DB | database |\n| api | db | Read |'],
    ['erd',['entity api','API'],'','\n| api.id | bigint | pk |'],
  ]){
    const make=row=>draft(`@${type} id=flow\n${before}| ${row.join(' | ')} |${after}`);
    const native=parse(make(cells)).document.panels[0].blocks[0].spec;
    for(let index=1;index<=cells.length;index++){
      const row=[...cells];row.splice(index,0,'source:docs');
      const {document}=parse(make(row)),block=document.panels[0].blocks[0];
      assert.deepEqual(block.nodeSources,{api:'docs'},`${type} cell ${index}`);
      assert.deepEqual(block.spec,native,`${type} cell ${index}`);
      assert.equal(validateExplainer(document).ok,true,`${type} cell ${index}`);
    }
  }
});

test('node references accept each documented content block and reject duplicate source bindings',()=>{
  for(const body of [
    '@prose id=notes\n| Explain the API. |',
    '@callout id=notes level=note\n| Check this condition. |',
    '@list id=notes\n| Check the request. |\n| Read the response. |',
    '@facts id=notes\n| Owner | API team |',
  ]){
    const {document}=parse(draft(`@sequence id=flow\n| actor api | API | backend | block:notes |\n| actor db | DB | database |\n| api | db | Read |\n\n${body}`));
    assert.deepEqual(document.panels[0].blocks[0].nodeBlocks,{api:'notes'});
    assert.equal(validateExplainer(document).ok,true,body);
  }
  const duplicate=parseExplainer(draft('@sequence id=flow\n| actor api | API | backend | source:docs | source:docs |\n| actor db | DB | database |\n| api | db | Read |'));
  assert.equal(duplicate.document,null);
  assert.ok(duplicate.diagnostics.some(d=>d.message==='A node accepts one reference of each kind.'));
});

test('a badge-only comparison cell and a route written in the node column are accepted',()=>{
  const {document}=parse('# T\n\nA.\n\n## Q {#q}\n\n| Trap | Verdict |\n| --- | --- |\n| Flood car | {bad:Drop} |\n\n@sequence id=flow\n| actor a | A |\n| actor b | B |\n| a | b | hi |\n\n@steps id=walk\n| one | Hello | Detail | flow | a~b |\n| two | Back | Detail | flow | b |');
  assert.deepEqual(document.panels[0].blocks[0].rows[0].cells[0],{text:'Drop',assessment:'bad',verdict:'Drop'});
  assert.deepEqual(document.panels[0].blocks[2].items[0].target,{diagram:'flow',route:['a','b']});
});

test('heading line terminators remain literal text without crashing the parser (#1083)',()=>{
  for(const separator of ['\r','\u2028','\u2029']) {
    const source=`# Title${separator}continued {#heading}\n\nAnswer.\n\n## Question${separator}continued {#question span=7}\n\nText.\n`;
    const result=parse(source);
    assert.equal(result.document.meta.title,`Title${separator}continued`);
    assert.equal(result.document.panels[0].title,`Question${separator}continued`);
    assert.equal(result.document.meta.id,'heading');
    assert.equal(result.document.panels[0].id,'question');
    assert.equal(result.document.panels[0].span,7);
    assert.equal(result.sourceText,source);
    assert.equal(validateExplainer(result.document).ok,true);
    const range=result.sourceMap['/panels/0'];
    assert.equal(range.line,5);
    assert.equal(source.slice(range.start,range.end),`## Question${separator}continued {#question span=7}\n\nText.\n`);
  }
  const malformed=parseExplainer('# Title\r\rAnswer.\r\r## Question\r\rText.\r');
  assert.equal(malformed.document,null);
  assert.ok(malformed.diagnostics.length);
  assert.ok(malformed.diagnostics.every(entry=>entry.code.startsWith('explainer/parse-')));
});

test('workflow shorthand uses final page locale without moving its source locations (#1082)',()=>{
 const workflow='@workflow\n| a | Build | backend |\n| b | Ship | backend |\n| c | Roll back | backend |\n| a > b | green |\n| a > c | red |\n';
 const header='# Release flow\n\nA build ships or rolls back.\n\n';
 const panel='## What happens? {#question}\n\n';
 const early=parse(header+'@meta locale=en\n\n'+panel+workflow);
 const source=header+panel+workflow+'\n@meta locale=en quality_profile=standard\n';
 const late=parse(source);
 assert.equal(late.document.meta.locale,'en');
 assert.equal(late.document.panels[0].blocks[0].spec.lanes[1].label,'Branch 1');
 assert.equal(late.document.panels[0].blocks[0].spec.meta.quality_profile,'showcase','late metadata does not change the original shorthand quality');
 const original=parse(header+panel+workflow);
 assert.equal(late.document.panels[0].blocks[0].id,original.document.panels[0].blocks[0].id,'locale cannot change an automatic source anchor');
 assert.deepEqual(late.document.panels[0].blocks[0],early.document.panels[0].blocks[0]);
 const location=late.sourceMap['/panels/0/blocks/0/spec/lanes/1/label'];
 assert.equal(location.start,source.indexOf('@workflow'));
 assert.ok(source.slice(location.start,location.end).startsWith(workflow.trimEnd()));
 assert.equal(late.sourceMap['/meta/locale'].start,source.indexOf('@meta'));
});
