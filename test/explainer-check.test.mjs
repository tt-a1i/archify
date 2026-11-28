import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkExplainerHtml,scanHtml} from '../archify/explainer/check.mjs';
import {computeExplainerRevision} from '../archify/explainer/revision.mjs';
const hash=text=>createHash('sha256').update(text).digest('hex');
const json=value=>JSON.stringify(value).replace(/[<>&]/g,c=>`\\u${c.charCodeAt(0).toString(16).padStart(4,'0')}`);
function fixture({children={},dependencies=[],asset}={}) {
 const document={schema_version:1,diagram_type:'explainer',meta:{id:'case',title:'Case'},answer:{summary:'Answer'},panels:[{id:'question',title:'Why?',blocks:[{id:'explanation',type:'prose',text:'Explanation'},...Object.keys(children).map(id=>({id,type:'diagram'}))]}],sources:[]};
 const source={text:JSON.stringify(document)};
 const manifest={version:1,artifactId:'case',revision:hash(source.text),sourceSha256:hash(source.text),documentSha256:hash(JSON.stringify(document)),dependencies,children:Object.fromEntries(Object.entries(children).map(([id,c])=>[id,{sha256:c.sha256,bytes:c.bytes}])),assets:asset?{image:asset}:{},sources:{}};
 const bundle={schemaVersion:1,kind:'archify-explainer-prepared',document,sourceText:source.text,source:{sha256:hash(source.text),bytes:Buffer.byteLength(source.text)},dependencies,preparedSources:{sources:{}},preparedDiagrams:{diagrams:children},quality:Object.keys(children).length?'showcase':'standard'};bundle.digest=hash(JSON.stringify(bundle));
 manifest.revision=computeExplainerRevision(bundle);
 delete manifest.dependencies;
 const payloads={'archify-explainer-prepared':bundle,'explainer-manifest':manifest};
 return `<!doctype html><html data-archify-artifact="explainer" data-revision="${manifest.revision}"><head><title>Case</title></head><body><main id="question"><p id="explanation">Explanation</p>${Object.keys(children).map(id=>`<div id="${id}">Diagram preview</div>`).join('')}${asset?`<img alt="contained" src="data:${asset.mime};base64,${dependencies[0].contentBase64}">`:''}</main>${Object.entries(payloads).map(([id,p])=>`<script id="${id}" type="application/json">${json(p)}</script>`).join('')}</body></html>`;
}
test('zero native diagrams is a valid explainer family and CLI check dispatch',()=>{
 const html=fixture();assert.equal(checkExplainerHtml(html).ok,true);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'explainer-check-test-'));try {const file=path.join(dir,'page.html');fs.writeFileSync(file,html);const run=spawnSync(process.execPath,['archify/scripts/check-render-output.mjs',file],{encoding:'utf8'});assert.equal(run.status,0,run.stdout+run.stderr);assert.equal(JSON.parse(run.stdout).family,'explainer');}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('each frozen native diagram receives the existing native geometry checks',()=>{
 const native=fs.readFileSync(new URL('../examples/erd-orders-rendered.html',import.meta.url),'utf8');
 const child={html:native,sha256:hash(native),bytes:Buffer.byteLength(native)};
 const receipt=checkExplainerHtml(fixture({children:{diagram:child}}));assert.equal(receipt.ok,true,JSON.stringify(receipt.diagnostics));assert.equal(receipt.composition.nativeDiagrams.length,1);assert.ok(receipt.composition.nativeDiagrams[0].receipt.checks.some(c=>c.name==='single_svg'));
 const multiple=checkExplainerHtml(fixture({children:{first:child,second:child}}));assert.equal(multiple.ok,true,JSON.stringify(multiple.diagnostics));assert.equal(multiple.composition.nativeDiagrams.length,2);assert.ok(multiple.composition.nativeDiagrams.every(c=>c.receipt.ok&&c.receipt.artifact.sha256===child.sha256));
 const corrupt='<html><body>No SVG</body></html>';
 const bad={html:corrupt,sha256:hash(corrupt),bytes:Buffer.byteLength(corrupt)};
 assert.ok(checkExplainerHtml(fixture({children:{diagram:bad}})).diagnostics.some(d=>d.code==='explainer/native-check'));
});
test('a recomputed prepared-bundle digest cannot retain a stale content revision after resource changes',()=>{
 const original=fixture(),script=scanHtml(original).scripts.find(s=>s.attrs.id==='archify-explainer-prepared'),bundle=JSON.parse(script.text),bytes=Buffer.from('new frozen resource');
 bundle.dependencies.push({kind:'image',id:'new-image',sha256:hash(bytes),bytes:bytes.length,contentBase64:bytes.toString('base64')});bundle.digest=hash(JSON.stringify({...bundle,digest:undefined}));
 const changed=original.slice(0,original.indexOf(script.text))+json(bundle)+original.slice(original.indexOf(script.text)+script.text.length);
 const receipt=checkExplainerHtml(changed);assert.deepEqual(receipt.diagnostics.map(d=>d.code),['explainer/content-revision']);assert.equal(receipt.checks.find(c=>c.name==='explainer_dependencies').ok,true,'Frozen bytes and bundle digest remain valid; stale semantic identity is rejected independently');
});
test('immutable source, children and resource byte bindings fail on corruption',()=>{
 const data=Buffer.from('safe image bytes'),dep={kind:'image',id:'image',contentBase64:data.toString('base64'),sha256:hash(data),bytes:data.length};
 assert.equal(checkExplainerHtml(fixture({dependencies:[dep],asset:{sha256:dep.sha256,bytes:dep.bytes,mime:'image/png'}})).ok,true);
 const corrupted=fixture({dependencies:[{...dep,sha256:'0'.repeat(64)}]});assert.ok(checkExplainerHtml(corrupted).diagnostics.some(d=>d.code==='explainer/dependency-hash'));
 const changed=fixture().replace('\"sourceText\":','\"sourceText\":\"changed\",\"originalIgnored\":');assert.ok(checkExplainerHtml(changed).diagnostics.some(d=>d.code==='explainer/source-hash'));
});
test('scanner ignores markup inside raw JSON and gives actionable HTML positions',()=>{
 const html=fixture().replace('Explanation</p>','Explanation</p>\n<a href="#missing">bad</a>');const diagnostic=checkExplainerHtml(html).diagnostics.find(d=>d.code==='explainer/unresolved-reference');assert.equal(diagnostic.subject.line,2);assert.equal(diagnostic.subject.component,'reference');assert.ok(diagnostic.evidence.reason&&diagnostic.evidence.example);
 const scanned=scanHtml('<script type="application/json">{"text":"<div id=\"fake\">"}</script><p id="real">real</p>');assert.deepEqual(scanned.elements.filter(e=>e.attrs.id).map(e=>e.attrs.id),['real']);
});

test('scanner line locations include skipped raw payload lines without recounting prefixes',()=>{
 const html='<!doctype html>\n<style>\ntext{fill:red}\n</style>\n<script type="application/json">\n{"content":"<p>not an element</p>"}\n</script>\n<p id="last">Text</p>\n<a href="#last">Link</a>';
 const scan=scanHtml(html);assert.deepEqual(scan.elements.map(e=>[e.tag,e.line]),[['style',2],['script',5],['p',8],['a',9]]);
});

for (const valid of [true, false]) {
 test(`large explainer receipt flushes through a pipe (${valid ? 'success' : 'failure'})`,()=>{
  const native=fs.readFileSync(new URL('../examples/erd-orders-rendered.html',import.meta.url),'utf8');
  const child={html:native,sha256:hash(native),bytes:Buffer.byteLength(native)};
  const children=Object.fromEntries(Array.from({length:20},(_,i)=>[`diagram-${i}`,child]));
  let html=fixture({children});
  if (!valid) html=html.replace('</main>','<a href="#missing">Missing</a></main>');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'explainer-flush-'));
  try {
   const file=path.join(dir,'page.html');fs.writeFileSync(file,html);
   const run=spawnSync(process.execPath,['archify/scripts/check-render-output.mjs',file],{encoding:'utf8',maxBuffer:4*1024*1024,timeout:30000});
   assert.ifError(run.error);
   assert.equal(run.status,valid?0:1,run.stderr);
   const receipt=JSON.parse(run.stdout); // Reject truncated JSON or a second receipt.
   assert.ok(Buffer.byteLength(run.stdout)>65536,'exercise a receipt larger than a pipe buffer');
   assert.equal(receipt.ok,valid);
   assert.equal(receipt.family,'explainer');
   assert.equal(receipt.composition.nativeDiagrams.length,20);
   assert.ok(receipt.composition.nativeDiagrams.every(c=>c.receipt.ok&&c.receipt.artifact.sha256===child.sha256));
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
 });
}

test('checker detects forged SSR, grid receipts, and executable policy changes independently',async()=>{
 const {parseValidatedExplainer}=await import('../archify/explainer/prepare.mjs');
 const {renderExplainer}=await import('../archify/explainer/render.mjs');
 const {injectUpdateNotice}=await import('../archify/bin/update-notice.mjs');
 const sourceText=`# Capacity {#capacity-reading}

The load is {{metric:load}}.

@answer live=model

## Model {#controls}

@calc id=model
| range x | Load | 0 | 10 | 1 | 3 |

@metric id=load label="Pool load" calc=model bind=x unit="%"
| {good} | < 5 | Free |
| {caution} | < 8 | Busy |
| {bad} | else | Full |

@chart id=projection calc=model type=line ymin=0 ymax=20 from=0 to=2 step=1
| line | Combined | x + t |
`;
 const {document,sourceMap}=parseValidatedExplainer(sourceText);
 const html=renderExplainer(document,{sourceText,sourceMap});
 assert.equal(checkExplainerHtml(html).ok,true,JSON.stringify(checkExplainerHtml(html).diagnostics));
 const notice=injectUpdateNotice(html,{installedVersion:'1.0.0',availableVersion:'1.0.1'});
 assert.equal(notice.embedded,true);
 assert.equal(checkExplainerHtml(notice.html).ok,true);
 assert.equal(checkExplainerHtml(notice.html.replaceAll('\n','\r\n')).ok,true);
 assert.equal(checkExplainerHtml(html.replace('<main id="board"><div class="board">',"<main  id='board'>\n  <div class = 'board'>")).ok,true);
 const policy=scanHtml(html).elements.find(e=>e.attrs['http-equiv']==='Content-Security-Policy');
 const policyTag=html.slice(policy.index,policy.end);
 assert.equal(checkExplainerHtml(html.replace('<head><meta charset="utf-8">','<head>\n<meta charset=\'utf-8\'>\n')).ok,true);
 for (const misplaced of [
   html.replace('<head><meta charset="utf-8">','<body><head><meta charset="utf-8">'),
   html.replace(policyTag,'').replace('</script>','</script>'+policyTag),
 ]) {
   assert.ok(checkExplainerHtml(misplaced).diagnostics.some(issue=>issue.code==='explainer/content-security-policy'));
 }
 const noticeScript=scanHtml(notice.html).scripts.find(script=>script.parent?.attrs['data-archify-update-notice']==='');
 assert.ok(noticeScript);
 assert.ok(checkExplainerHtml(notice.html.slice(0,noticeScript.index)+notice.html.slice(noticeScript.end)).diagnostics
   .some(issue=>issue.code==='explainer/script-inventory'));
 const script=scanHtml(html).scripts.find(s=>s.attrs.id==='archify-explainer-prepared');
 const forged=JSON.parse(script.text);
 forged.grid.statesChecked--;
 forged.digest=hash(JSON.stringify({...forged,digest:undefined}));
 for(const [before,after,code] of [
   ['data-whatif-key="load">3%','data-whatif-key="load">4%','default-projection'],
   ['data-whatif-status="good"','data-whatif-status="bad"','default-projection'],
   ['data-whatif-point="2-0">5','data-whatif-point="2-0">6','default-projection'],
   ['data-whatif-line="0" d="M105','data-whatif-line="0" d="M106','default-projection'],
   ['data-whatif-input="0"','data-ignored-input="0"','default-projection'],
   ['</main>','</main><input data-whatif-input="99">','reader-target'],
   ['class="tool-menu style-menu"','class="tool-menu"','reader-target'],
   ['class="theme-controls"','class="theme-display"','reader-target'],
   ['data-theme-choice="dark"','data-theme-choice="dusk"','reader-target'],
   ['data-export-image="png"','data-export-image="gif"','reader-target'],
   ['data-open-source>','>','reader-target'],
   ['<div class="theme-controls"','<select><div class="theme-controls"','reader-target'],
   ['data-source-grid','data-ignored-grid','reader-target'],
   ['id="explainer-reader-words">{','id="explainer-reader-words">{"unexpected":true,','reader-words'],
   ["script-src-attr 'none'","script-src-attr 'unsafe-inline'",'content-security-policy'],
   ['</body>','<script>0</script></body>','script-inventory'],
   [script.text,json(forged),'grid-receipt'],
 ]) {
   assert.ok(html.includes(before),before.slice(0,120));
   const issues=checkExplainerHtml(html.replace(before,()=>after)).diagnostics;
   assert.ok(issues.some(issue=>issue.code==='explainer/'+code),JSON.stringify(issues));
   if (code==='grid-receipt') assert.equal(issues.some(issue=>issue.code==='explainer/bundle-hash'),false);
 }
});

test('checked-in interactive previews bind routes and styles to the frozen native child',async()=>{
 const {packPageBundle,unpackPageBundle}=await import('../archify/explainer/page-bundle.mjs');
 const file=new URL('../docs/cases/explainer/p99-cascading-failure.html',import.meta.url);
 const html=fs.readFileSync(file,'utf8');
 const verify=page=>checkExplainerHtml(page,{checkNative:false});
 assert.equal(verify(html).ok,true,JSON.stringify(verify(html).diagnostics));
 assert.equal(verify(html.replaceAll('\n','\r\n')).ok,true);
 for (const [tag,attribute] of [
   ['<html ', 'inert'],
   ['<body>', 'inert'],
   ['<div class="tools interactive">', 'inert'],
   ['<button type="button" data-theme-choice="dark"', 'inert'],
   ['<div class="menu-options style-options"', 'inert'],
   ['<div class="shell">', 'hidden role="menu"'],
   ['<div class="tool-menu export-menu">', 'hidden'],
   ['<div class="theme-controls"', 'aria-hidden="true"'],
   ['<button type="button" role="menuitemradio"', 'hidden'],
   ['<button type="button" class="tool-button" data-close-source', 'aria-hidden="true"'],
 ]) {
   assert.ok(html.includes(tag),tag);
   const receipt=verify(html.replace(tag,tag.replace(/^<\w+/u,match=>`${match} ${attribute}`)));
   assert.equal(receipt.ok,false,`${tag} with ${attribute}`);
   assert.ok(receipt.diagnostics.every(issue=>issue.code==='explainer/reader-target'),JSON.stringify(receipt.diagnostics));
 }
 const closed=html.replace('<dialog id="explainer-source"','<dialog hidden id="explainer-source"');
 assert.equal(verify(closed).ok,true);
 const active=html.match(/data-whatif-cases="[^"]*" data-whatif-active="true"/u)[0];
 assert.ok(verify(html.replace(active,active.replace('true','false'))).diagnostics
   .some(issue=>issue.code==='explainer/default-projection'));
 const script=scanHtml(html).scripts.find(s=>s.attrs.id==='archify-explainer-prepared');
 const bundle=unpackPageBundle(JSON.parse(script.text));
 const [child]=Object.values(bundle.preparedDiagrams.diagrams);
 child.styles='';
 bundle.digest=hash(JSON.stringify({...bundle,digest:undefined}));
 const cached=html.replace(script.text,()=>json(packPageBundle(bundle)));
 assert.equal(verify(cached).ok,true);
 const unstyled=cached.replace(/(data-whatif-diagram="[^"]*"[^>]*><style>)[\s\S]*?<\/style>/u,'$1</style>');
 assert.notEqual(unstyled,cached);
 assert.ok(verify(unstyled).diagnostics.some(issue=>issue.code==='explainer/default-projection'));
});

test('checker rejects an inaccessible reading board, its controls and live results',()=>{
 const html=fs.readFileSync(new URL('../docs/cases/explainer/p99-cascading-failure.html',import.meta.url),'utf8');
 const verify=page=>checkExplainerHtml(page,{checkNative:false});
 const board='<main id="board">';
 const wrapped=html.replace(board,`<div inert>${board}`).replace('</main>','</main></div>');
 assert.ok(verify(wrapped).diagnostics.some(issue=>issue.code==='explainer/reader-target' && issue.subject.id==='board'));
 for (const [tag,attribute] of [
   [board, 'hidden'],
   ['<button type="button" class="tool-button" data-whatif-case=', 'disabled'],
   ['<div class="whatif-controls interactive">', 'aria-hidden="true"'],
   ['<p class="metric-value" data-whatif-metric>', 'hidden'],
   ['<button class="tool-button explore-button"', 'disabled'],
 ]) {
   assert.ok(html.includes(tag),tag);
   const receipt=verify(html.replace(tag,tag.replace(/^<\w+/u,match=>`${match} ${attribute}`)));
   assert.ok(receipt.diagnostics.some(issue=>issue.code==='explainer/reader-target'),`${tag} with ${attribute}`);
 }
});

test('checker applies disabled fieldset ancestry to reader controls',()=>{
 const html=fs.readFileSync(new URL('../docs/cases/explainer/p99-cascading-failure.html',import.meta.url),'utf8');
 const verify=page=>checkExplainerHtml(page,{checkNative:false});
 const wrapBoard=(before,after)=>html.replace('<main id="board">',`${before}<main id="board">`).replace('</main>',`</main>${after}`);
 for (const [before,after] of [
   ['<fieldset disabled>','</fieldset>'],
   ['<fieldset disabled><legend>Caption</legend><legend>','</legend></fieldset>'],
   ['<fieldset disabled><fieldset disabled><legend>','</legend></fieldset></fieldset>'],
 ]) {
   const receipt=verify(wrapBoard(before,after));
   assert.ok(receipt.diagnostics.some(issue=>issue.code==='explainer/reader-target' && issue.message.includes('reading board')),before);
 }
 const inFirstLegend=verify(wrapBoard('<fieldset disabled><div></div><legend><div>','</div></legend></fieldset>'));
 assert.deepEqual(inFirstLegend.diagnostics,[]);

 const button=/<button type="button" data-theme-choice="dark"[^>]*>.*?<\/button>/su;
 assert.match(html,button);
 const toolbar=verify(html.replace(button,'<fieldset disabled>$&</fieldset>'));
 assert.ok(toolbar.diagnostics.some(issue=>issue.code==='explainer/reader-target' && issue.message.includes('[data-theme-choice=dark]')));
});
