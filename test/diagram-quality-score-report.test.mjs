import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { parse } from 'parse5';
import { renderComparisonReport, comparisonCSV, renderReviewForm } from '../benchmarks/diagram-quality/score-report.mjs';

const hash = letter => letter.repeat(64);
function nodes(html, tag) {
 const all=[];
 const visit=node=>{if(node.tagName===tag) all.push(node);for(const child of node.childNodes??[]) visit(child);};
 visit(parse(html));return all;
}
const attr=(node,name)=>node.attrs?.find(item=>item.name===name)?.value;
const textOf=node=>(node.value??'')+(node.childNodes??[]).map(textOf).join('');
const bodyText=html=>textOf(nodes(html,'body')[0]);
const scripts=html=>nodes(html,'script').filter(node=>attr(node,'type')!=='application/json').map(textOf);

const reviewFixture=()=>({
 receipts:[0,1,2,3].map((value)=>({taskId:value%2?'task-two':'task-one',artifactHash:hash(String(value+1)),artifactPath:`artifacts/${hash(String(value+1))}.html`,delivery:{status:'delivered'},arm:'SECRET_METHOD',model:'SECRET_MODEL',usage:{costUsd:666},objective:{automatic:98.123},sourceHash:'SECRET_SOURCE',runId:'SECRET_RUN'})),
 tasks:[{id:'task-one',prompt:'题目一：保留 Browser → API 的关系。',expected:{nodes:[{id:'b',label:'Browser'},{id:'a',label:'API'}],edges:[{from:'b',to:'a',label:'request'}]}},{id:'task-two',prompt:'题目二：展示三个阶段。',requirements:['名称应完整可见']}]
});

test('blind form has deterministic shuffled digest-only previews, task context and no method or cost state',()=>{
 const input=reviewFixture(),html=renderReviewForm({...input,seed:'repeatable'}),other=renderReviewForm({...input,seed:'repeatable'}),srcs=value=>nodes(value,'iframe').map(node=>attr(node,'src'));
 assert.deepEqual(srcs(html),srcs(other));assert.equal(new Set(srcs(html)).size,4);
 assert.notDeepEqual(srcs(html),input.receipts.map(row=>row.artifactPath));
 for(const node of nodes(html,'iframe')) {assert.equal(attr(node,'sandbox'),'');assert.match(attr(node,'src'),/^artifacts\/[1-4]{64}\.html$/);assert.ok(attr(node,'title'));}
 for(const secret of ['SECRET_METHOD','SECRET_MODEL','SECRET_SOURCE','SECRET_RUN','98.123','666','"usage"','"objective"','"arm"','"model"']) assert.ok(!html.includes(secret),secret);
 assert.ok(bodyText(html).includes('题目一'));assert.ok(bodyText(html).includes('request'));assert.ok(bodyText(html).includes('名称应完整可见'));
 assert.ok(!html.includes('https://'));
});

test('blind form requires independent reviewer identity and five 1–5 ratings per item with optional comments',()=>{
 const html=renderReviewForm(reviewFixture()),inputs=nodes(html,'input'),ratings=inputs.filter(node=>attr(node,'type')==='radio');
 assert.equal(ratings.length,4*5*5);
 const names=[...new Set(ratings.map(node=>attr(node,'name')))];assert.equal(names.length,20);
 for(const name of names) {const group=ratings.filter(node=>attr(node,'name')===name);assert.deepEqual(group.map(node=>attr(node,'value')),['1','2','3','4','5']);assert.ok(group.some(node=>attr(node,'required')!==undefined));}
 const reviewer=inputs.find(node=>attr(node,'name')==='reviewerId');assert.ok(reviewer);assert.ok(attr(reviewer,'required')!==undefined);
 const independent=inputs.find(node=>attr(node,'name')==='independent');assert.equal(attr(independent,'type'),'checkbox');assert.ok(attr(independent,'required')!==undefined);
 assert.equal(nodes(html,'textarea').length,4);assert.ok(nodes(html,'textarea').every(node=>attr(node,'required')===undefined));
 assert.ok(bodyText(html).includes('下载评分 JSON'));assert.ok(bodyText(html).includes('评论（选填）'));
 assert.ok(!bodyText(html).includes('语义判断'));
});

test('review JSON and scripts remain safe when task prompts and rubric strings contain closing tags',()=>{
 const input=reviewFixture(),attack='</script><img src=x onerror=alert(1)>';
 input.tasks[0].prompt=attack;
 const html=renderReviewForm({...input,rubricVersion:attack}),allScripts=nodes(html,'script');
 assert.equal(nodes(html,'img').length,0);assert.equal(allScripts.length,2);
 const payload=allScripts.find(node=>attr(node,'type')==='application/json');assert.ok(payload);
 assert.ok(!textOf(payload).includes('</script>'));assert.ok(!textOf(payload).includes('<'));
 const state=JSON.parse(textOf(payload));assert.equal(state.rubricVersion,attack);assert.equal(state.items.length,4);
 const [script]=scripts(html);assert.doesNotThrow(()=>new Script(script));
 const digest=createHash('sha256').update(script).digest('base64'),policy=nodes(html,'meta').find(node=>attr(node,'http-equiv')==='Content-Security-Policy');assert.ok(attr(policy,'content').includes(`script-src 'sha256-${digest}'`));
});

test('blind form rejects unsafe artifact paths and deduplicates identical task/artifact bindings',()=>{
 const input=reviewFixture();input.receipts.push({...input.receipts[0],arm:'another method'});
 assert.equal(nodes(renderReviewForm(input),'iframe').length,4);
 for(const artifactPath of [`../${hash('1')}.html`,`artifacts/${hash('1')}-method.html`,`https://x/${hash('1')}.html`,`artifacts/%2e%2e/${hash('1')}.html`]) {
  assert.throws(()=>renderReviewForm({...input,receipts:[{...input.receipts[0],artifactPath}]}),/digest|artifact/i);
 }
});

test('blind review projects digest PNGs without exposing the original HTML viewer and binds the original artifact',()=>{
 const input=reviewFixture(),receipt={...input.receipts[0],reviewImage:{hash:hash('f'),path:`artifacts/${hash('f')}.png`}};
 const html=renderReviewForm({...input,receipts:[receipt]}),images=nodes(html,'img'),state=JSON.parse(textOf(nodes(html,'script').find(node=>attr(node,'type')==='application/json')));
 assert.equal(images.length,1);assert.equal(attr(images[0],'src'),receipt.reviewImage.path);assert.ok(attr(images[0],'alt'));
 assert.equal(nodes(html,'iframe').length,0);assert.ok(!html.includes(receipt.artifactPath));
 assert.equal(state.items[0].artifactHash,receipt.artifactHash);assert.equal(state.items[0].reviewImageHash,receipt.reviewImage.hash);
 assert.ok(!html.includes('SECRET_METHOD'));assert.ok(!html.includes('SECRET_MODEL'));
 assert.ok(bodyText(renderReviewForm(input)).includes('图内风格'));
});

test('blind review rejects non-PNG and noncanonical image paths rather than falling back to a revealing viewer',()=>{
 const input=reviewFixture(),receipt=input.receipts[0];
 for(const reviewImage of [
  {hash:hash('f'),path:`../${hash('f')}.png`},
  {hash:hash('f'),path:`artifacts/${hash('e')}.png`},
  {hash:hash('f'),path:`artifacts/${hash('f')}.html`},
  {hash:hash('f'),path:`artifacts/${hash('f')}-Archify.png`},
  {hash:hash('f'),path:`https://example.com/${hash('f')}.png`},
  {hash:'not-a-sha256',path:'artifacts/not-a-sha256.png'},
 ]) assert.throws(()=>renderReviewForm({...input,receipts:[{...receipt,reviewImage}]}),/reviewImage|image|PNG/i);
});


const comparisonFixture=()=>{
 const row={revision:'before-rev',model:'model-one',status:'complete',receipt:{delivery:{status:'delivered'}},repairCount:1,scores:{content:90,layout:70,speed:50,cost:60,human:null},raw:{durationMs:41000,deliveryDurationMs:32000,totalTokens:1200,costUsd:.03},semanticDefects:['缺少 API → DB 关系'],layoutDetails:{edgeCrossings:2},evidence:{sourcePath:`evidence/${hash('a')}.json`,artifactPath:`artifacts/${hash('b')}.html`,previewPath:`artifacts/${hash('c')}.png`,sessionPath:`evidence/${hash('d')}.jsonl`,historyComplete:true,candidates:[{sourcePath:`evidence/${hash('e')}.json`,artifactPath:`artifacts/${hash('f')}.html`},{artifactPath:`artifacts/${hash('b')}.html`}]}};
 const after={...row,revision:'after-rev',scores:{...row.scores,layout:85},repairCount:null};
 return {schemaVersion:1,kind:'archify-before-after',metricsVersion:'metrics-v1',baseRevision:'before-rev',candidateRevision:'after-rev',summary:{base:{planned:2,recorded:1,delivered:1,failed:0,missing:1,...row},candidate:{planned:2,recorded:2,delivered:1,failed:1,missing:0,...after}},pairs:[{taskId:'task-one',model:'model-one',repeat:1,base:row,candidate:after,delta:{content:0,layout:15,speed:0,cost:0,human:null}},{taskId:'task-two',model:'model-one',repeat:1,base:null,candidate:{...after,status:'failed',receipt:{delivery:{status:'failed'}},scores:{content:0,layout:null},raw:{}},delta:{}}]};
};

test('comparison preserves independent metrics, missing runs, failures, timings, repairs and linked candidate evidence',()=>{
 const html=renderComparisonReport(comparisonFixture()),text=bodyText(html);
 assert.equal(attr(nodes(html,'html')[0],'lang'),'zh-CN');
 for(const label of ['before-rev','after-rev','model-one','task-one','task-two','+15.0','缺少运行记录','failed','未记录','41.0','32.0','1,200','0.0300','缺少 API → DB 关系','edgeCrossings','首次候选','修复候选','最终候选','完整会话']) assert.ok(text.includes(label),label);
 const links=nodes(html,'a').map(node=>attr(node,'href'));
 for(const path of [`evidence/${hash('a')}.json`,`evidence/${hash('d')}.jsonl`,`artifacts/${hash('f')}.html`]) assert.ok(links.includes(path),path);
 assert.ok(nodes(html,'img').length>=2);
 assert.equal(nodes(html,'svg').length,2);
 assert.equal(nodes(html,'rect').filter(node=>attr(node,'data-score')!==undefined).length,8);
 assert.equal(scripts(html).length,0);
 assert.ok(text.includes('每题平均实际完整会话用时（秒）'));
 assert.ok(text.includes('每题平均最终交付用时（秒）'));
 assert.ok(text.includes('先对同题的重复运行取平均'));
 assert.ok(text.includes('总分对比'));
});

test('report escapes untrusted content and only links digest-named local evidence',()=>{
 const input=comparisonFixture(),attack='</script><img src=x onerror=alert(1)>';
 input.pairs[0].taskId=attack;input.pairs[0].base.semanticDefects=[attack];
 input.pairs[0].base.evidence={artifactPath:'javascript:alert(1)',sourcePath:`../${hash('a')}.json`,sessionPath:`https://evil.invalid/${hash('b')}.jsonl`,previewPath:`artifacts/${hash('a')}-method.png`};
 const html=renderComparisonReport(input);
 assert.ok(bodyText(html).includes(attack));
 assert.ok(nodes(html,'a').every(node=>/^(artifacts|evidence)\/[a-f0-9]{64}\.[a-z0-9]+$/.test(attr(node,'href'))));
 assert.ok(nodes(html,'img').every(node=>/^artifacts\/[a-f0-9]{64}\.png$/.test(attr(node,'src'))));
 assert.equal(nodes(html,'script').length,0);
});

test('CSV exports paired raw data, blank missing scores and numeric negative deltas with formula-safe labels',()=>{
 const input=comparisonFixture();input.pairs[0].taskId='  =cmd';input.pairs[0].model='"quoted",name';input.pairs[0].delta.layout=-15;
 const csv=comparisonCSV(input),lines=csv.split('\r\n');
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes("'  =cmd"));assert.ok(csv.includes('""quoted"",name'));assert.ok(csv.includes(',-15,'));assert.ok(!csv.includes("'-15"));
 assert.ok(csv.includes(',41000,32000,1200,0.03,'));assert.ok(csv.includes(',base,before-rev,missing,'));
 assert.equal(lines.length,6);assert.ok(!csv.includes('NaN'));assert.ok(!csv.includes('null'));
});

test('local form downloads only complete integer ratings bound to the task and artifact',()=>{
 const input=reviewFixture();input.receipts=input.receipts.slice(0,1);
 const html=renderReviewForm(input),script=scripts(html)[0];let submit,valid=false,downloaded=null;
 const values=new Map([['reviewerId','reviewer-1'],['independent','yes'],...['readability','hierarchy','layout','style','aesthetics'].map(field=>[`rating-0-${field}`,'4'])]);
 const form={reportValidity:()=>valid,addEventListener:(type,fn)=>{submit=fn;}},status={};
 const state=textOf(nodes(html,'script').find(node=>attr(node,'type')==='application/json'));
 const context={document:{getElementById:id=>id==='review-state'?{textContent:state}:id==='review-form'?form:status,createElement:()=>({click(){},remove(){}}),body:{appendChild(){}}},FormData:class {get(key){return values.get(key)??null;} constructor(){}},Blob:class {constructor(parts){downloaded=JSON.parse(parts[0]);}},URL:{createObjectURL:()=> 'blob:local',revokeObjectURL(){}},setTimeout:fn=>fn()};
 new Script(script).runInNewContext(context);
 const event={preventDefault(){}};
 submit(event);assert.equal(downloaded,null,'incomplete draft cannot download');
 valid=true;values.set('rating-0-layout','2.5');assert.throws(()=>submit(event),/评分/);assert.equal(downloaded,null);
 values.set('rating-0-layout','4');submit(event);
 assert.equal(downloaded.reviews.length,1);
 const review=downloaded.reviews[0];assert.equal(review.status,'completed');assert.equal(review.taskId,input.receipts[0].taskId);assert.equal(review.artifactHash,input.receipts[0].artifactHash);assert.equal(review.reviewerId,'reviewer-1');assert.equal(review.ratings.layout,4);assert.equal(review.independent,true);
});
