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
 const native=fs.readFileSync(new URL('../archify/examples/erd-orders-rendered.html',import.meta.url),'utf8');
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
  const native=fs.readFileSync(new URL('../archify/examples/erd-orders-rendered.html',import.meta.url),'utf8');
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
