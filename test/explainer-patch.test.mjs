import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanHtml } from '../archify/explainer/check.mjs';
import { createHash } from 'node:crypto';
import { preparePanelPatch } from '../archify/explainer/patch.mjs';
import { packPageBundle, unpackPageBundle } from '../archify/explainer/page-bundle.mjs';
import { compileExplainerDiagram } from '../archify/explainer/diagrams.mjs';
import { prepareExplainer, rebindPreparedBundle } from '../archify/explainer/prepare.mjs';
import { renderExplainer } from '../archify/explainer/render.mjs';
const cli=path.resolve('archify/bin/archify.mjs');
const run=args=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,ARCHIFY_UPDATE_CHECK_DISABLED:'1'}});
const read=file=>unpackPageBundle(JSON.parse(scanHtml(fs.readFileSync(file,'utf8')).scripts.find(s=>s.attrs.id==='archify-explainer-prepared').text));
const manifest=file=>JSON.parse(scanHtml(fs.readFileSync(file,'utf8')).scripts.find(s=>s.attrs.id==='explainer-manifest').text);
function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-explainer-patch-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function fixture(){return {schema_version:1,diagram_type:'explainer',meta:{id:'patch-document',title:'What can change?',locale:'en'},answer:{summary:'One stable panel can be replaced.'},panels:[{id:'first',title:'What changes?',blocks:[{id:'first-text',type:'prose',text:'This text may change.'}]},{id:'second',title:'What stays?',blocks:[{id:'second-text',type:'prose',text:'This text remains exactly the same.'}]}],sources:[]};}
function deliver(dir,doc=fixture(),options=[]){const input=path.join(dir,'author.json'),artifact=path.join(dir,'original.html');fs.writeFileSync(input,JSON.stringify(doc,null,2)+'\n');const result=run(['deliver','explainer',input,artifact,...options,'--json']);assert.equal(result.status,0,result.stdout+result.stderr);return {input,artifact};}

test('patch payload errors preserve their specific repair advice',async t=>{
  const dir=temp(t),artifact=path.join(dir,'original.html'),replacement=path.join(dir,'replacement.md'),output=path.join(dir,'patched.html');
  const replacementText='## Question {#question}\n\nReplacement.\n';
  fs.writeFileSync(replacement,replacementText);
  const script=text=>`<script type="application/json" id="archify-explainer-prepared">${text}</script>`;
  const cases=[
    [fs.readFileSync('archify/examples/lifecycle-agent-run.html','utf8'),'The artifact must contain one original draft and prepared resource payload.','Use an artifact produced by the formal explainer CLI.'],
    [script('{}')+script('{}'),'The artifact must contain one original draft and prepared resource payload.','Use an artifact produced by the formal explainer CLI.'],
    [script('{invalid'),'Embedded draft payload is invalid.','Rebuild the artifact from its original draft.'],
    [script(JSON.stringify({preparedDiagrams:{diagrams:{flow:{htmlGzip:'not-gzip'}}}})),'Embedded native diagram payload cannot be inflated.','Rebuild the original artifact before patching.'],
  ];
  for(const [html,message,fix] of cases) {
    fs.writeFileSync(artifact,html);
    await assert.rejects(preparePanelPatch({artifactPath:artifact,panelId:'question',replacementPath:replacement}),error=>{
      const diagnostic=error.archifyDiagnostics[0];
      assert.equal(error.message,message);
      assert.equal(diagnostic.code,'explainer/patch-payload');
      assert.equal(diagnostic.message,message);
      assert.deepEqual(diagnostic.supportedFixes,[fix]);
      return true;
    });
    assert.equal(fs.readFileSync(artifact,'utf8'),html);
    assert.equal(fs.readFileSync(replacement,'utf8'),replacementText);
  }
  // A valid native page passes the CLI's artifact check, then needs the specific
  // missing-Explainer-payload diagnostic. Malformed HTML is rejected earlier.
  fs.writeFileSync(artifact,cases[0][0]);fs.writeFileSync(output,'previous verified artifact');
  const result=run(['patch','explainer',artifact,'question',replacement,output,'--json']);
  assert.equal(result.status,1,result.stdout+result.stderr);
  const diagnostic=JSON.parse(result.stdout).diagnostics[0];
  assert.equal(diagnostic.code,'explainer/patch-payload');
  assert.equal(diagnostic.message,cases[0][1]);
  assert.deepEqual(diagnostic.supportedFixes,[cases[0][2]]);
  assert.equal(fs.readFileSync(artifact,'utf8'),cases[0][0]);
  assert.equal(fs.readFileSync(replacement,'utf8'),replacementText);
  assert.equal(fs.readFileSync(output,'utf8'),'previous verified artifact');
});

test('panel patch preserves original source outside target token range',t=>{
  const dir=temp(t),{artifact}=deliver(dir),previous=read(artifact),replacement=path.join(dir,'replacement.json'),output=path.join(dir,'patched.html');
  const next={...previous.document.panels[0],title:'What changed?',blocks:[{id:'first-text',type:'prose',text:'The selected panel has new content.'}]};
  const replacementText=JSON.stringify(next,null,2);fs.writeFileSync(replacement,replacementText);
  const result=run(['patch','explainer',artifact,'first',replacement,output,'--json']);assert.equal(result.status,0,result.stdout+result.stderr);
  const patched=read(output),range=previous.sourceMap['/panels/0'];assert.equal(patched.sourceText,previous.sourceText.slice(0,range.start)+replacementText+previous.sourceText.slice(range.end));
  assert.deepEqual(patched.document.panels[1],previous.document.panels[1]);assert.deepEqual(patched.document.meta,previous.document.meta);assert.notEqual(patched.source.sha256,previous.source.sha256);
  const receipt=JSON.parse(result.stdout);
  assert.equal(receipt.original.revision,manifest(artifact).revision);assert.equal(receipt.revision,manifest(output).revision);
  assert.equal(receipt.original.sourceSha256,previous.source.sha256);assert.equal(receipt.sourceSha256,patched.source.sha256);
  assert.notEqual(receipt.revision,receipt.sourceSha256);
  const check=run(['check',output,'--json','--require-provenance']);assert.equal(check.status,0,check.stdout+check.stderr);
});

test('patching referenced prose keeps the diagram and its frozen native artifact unchanged',t=>{
  const dir=temp(t),doc=fixture();
  const spec=compileExplainerDiagram('sequence',['actor api | API','actor db | DB','api | db | Read'],{id:'request'});
  doc.panels[1].blocks.push({id:'request',type:'diagram',diagramType:'sequence',spec,nodeBlocks:{api:'first-text'}});
  const {input,artifact}=deliver(dir,doc),previous=read(artifact),inputBytes=fs.readFileSync(input);
  const next=structuredClone(doc.panels[0]);next.blocks[0].text='The updated explanation is shared with the node.';
  const replacement=path.join(dir,'replacement.json'),output=path.join(dir,'patched.html');fs.writeFileSync(replacement,JSON.stringify(next));
  const result=run(['patch','explainer',artifact,'first',replacement,output,'--json']);assert.equal(result.status,0,result.stdout+result.stderr);
  const patched=read(output);
  assert.equal(patched.document.panels[0].blocks[0].text,next.blocks[0].text);
  assert.deepEqual(patched.document.panels[1],previous.document.panels[1]);
  assert.deepEqual(patched.preparedDiagrams,previous.preparedDiagrams);
  assert.deepEqual(fs.readFileSync(input),inputBytes,'rendering and patching never rewrite the original draft');
});

test('panel patch rejects missing target and changed identity without overwriting existing output',t=>{
  const dir=temp(t),{artifact}=deliver(dir),replacement=path.join(dir,'replacement.json'),output=path.join(dir,'patched.html');fs.writeFileSync(output,'last good output');
  fs.writeFileSync(replacement,JSON.stringify({...fixture().panels[0],id:'foreign-panel'}));
  for(const id of ['missing','first']){const result=run(['patch','explainer',artifact,id,replacement,output,'--json']);assert.equal(result.status,1);const failure=JSON.parse(result.stdout);assert.ok(failure.diagnostics[0].code.startsWith('explainer/patch-'));assert.equal(fs.readFileSync(output,'utf8'),'last good output');}
  fs.writeFileSync(replacement,Buffer.from([0xff]));const invalidBytes=run(['patch','explainer',artifact,'first',replacement,output,'--json']);assert.equal(invalidBytes.status,1);assert.equal(JSON.parse(invalidBytes.stdout).diagnostics[0].code,'explainer/patch-source-encoding');assert.equal(fs.readFileSync(output,'utf8'),'last good output');
});

test('panel patch retains contained resources when unchanged original files are unavailable',t=>{
  const dir=temp(t),doc=fixture(),assetPath=path.join(dir,'asset.png');const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8XcAAAAASUVORK5CYII=','base64');fs.writeFileSync(assetPath,png);
  doc.panels[0].blocks.push({id:'first-image',type:'image',path:'asset.png',alt:'Contained original image'});
  const {artifact,input}=deliver(dir,doc),previous=read(artifact),replacement=path.join(dir,'replacement.json'),output=path.join(dir,'patched.html');
  const next=structuredClone(doc.panels[0]);next.blocks[0].text='Only the prose changes.';fs.writeFileSync(replacement,JSON.stringify(next));fs.unlinkSync(assetPath);fs.unlinkSync(input);
  const result=run(['patch','explainer',artifact,'first',replacement,output,'--json']);assert.equal(result.status,0,result.stdout+result.stderr);
  const patched=read(output);assert.deepEqual(patched.preparedSources.assets['first-image'],previous.preparedSources.assets['first-image']);assert.equal(patched.dependencies[0].retained,true);
  const checked=run(['check',output,'--json','--require-provenance']);assert.equal(checked.status,0,checked.stdout+checked.stderr);
});

test('restricted author draft panel patch preserves other authored text and stable panel IDs',t=>{
  const dir=temp(t),input=path.join(dir,'author.md'),artifact=path.join(dir,'original.html'),replacement=path.join(dir,'replacement.md'),output=path.join(dir,'patched.html');
  const draft='# What changes? {#patch-document}\n\nOne panel changes.\n\n## Why? {#first}\n\nOld paragraph.\n\n## What stays? {#second}\n\nPreserve this paragraph exactly.\n';fs.writeFileSync(input,draft);
  const delivery=run(['deliver','explainer',input,artifact,'--json']);assert.equal(delivery.status,0,delivery.stdout+delivery.stderr);
  fs.writeFileSync(replacement,'## Why? {#first}\n\nNew paragraph.\n\n');const patched=run(['patch','explainer',artifact,'first',replacement,output,'--json']);assert.equal(patched.status,0,patched.stdout+patched.stderr);
  assert.equal(read(output).sourceText,draft.replace('Old paragraph.','New paragraph.'));assert.equal(read(output).document.panels[1].id,'second');
});

test('panel patch applies explicit strict writing checks before publishing',t=>{
  const dir=temp(t),{artifact}=deliver(dir),replacement=path.join(dir,'replacement.json'),output=path.join(dir,'patched.html');fs.writeFileSync(output,'last good output');
  const next=fixture().panels[0];next.blocks[0].text='We will perform an analysis of each and every request.';fs.writeFileSync(replacement,JSON.stringify(next));
  const strict=run(['patch','explainer',artifact,'first',replacement,output,'--writing','strict','--json']);assert.equal(strict.status,1);assert.ok(JSON.parse(strict.stdout).diagnostics.some(d=>d.code.startsWith('explainer/writing-')&&d.severity==='error'));assert.equal(fs.readFileSync(output,'utf8'),'last good output');
  const off=run(['patch','explainer',artifact,'first',replacement,output,'--writing','off','--json']);assert.equal(off.status,0,off.stdout+off.stderr);assert.equal(read(output).writingMode,'off');
});

test('panel patch retains source evidence when a changed diagram shares its source id',t=>{
  const dir=temp(t),doc=fixture();
  const git=(...args)=>{const result=spawnSync('git',['-C',dir,...args],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
  git('init');git('config','user.name','Explainer Test');git('config','user.email','explainer@example.test');git('remote','add','origin','https://github.com/example/explainer');
  fs.writeFileSync(path.join(dir,'code.js'),'export const value = 3;\n');git('add','.');git('commit','-m','Fixture');
  doc.meta.repository={url:'https://github.com/example/explainer',revision:git('rev-parse','HEAD')};
  doc.panels[0].blocks.push({id:'shared',type:'diagram',diagramType:'architecture',spec:compileExplainerDiagram('architecture',['api | API | backend','redis | Redis | database','api > redis | Read'],{id:'native',quality:'standard'})});
  doc.panels[1].blocks.push({id:'snippet',type:'code',source:'shared'});doc.sources=[{id:'shared',title:'Shared code',path:'code.js',lines:[1,1]}];
  const {artifact}=deliver(dir,doc,['--repo-root',dir]),previous=read(artifact),replacement=path.join(dir,'replacement.json'),output=path.join(dir,'patched.html');
  const next=structuredClone(doc.panels[0]);next.blocks[1].spec.meta.title='Changed diagram title';fs.writeFileSync(replacement,JSON.stringify(next));
  const result=run(['patch','explainer',artifact,'first',replacement,output,'--json']);assert.equal(result.status,0,result.stdout+result.stderr);
  const patched=read(output),source=patched.dependencies.find(dep=>dep.kind==='repository' && dep.id==='shared');
  assert.deepEqual(source,{...previous.dependencies.find(dep=>dep.kind==='repository' && dep.id==='shared'),retained:true});
  assert.equal(patched.dependencies.filter(dep=>dep.id==='shared').length,2);assert.equal(patched.dependencies.find(dep=>dep.kind==='diagram-spec' && dep.id==='shared').retained,false);
  assert.deepEqual(patched.preparedSources.sources.shared,previous.preparedSources.sources.shared);
  const check=run(['check',output,'--json','--require-provenance']);assert.equal(check.status,0,check.stdout+check.stderr);
});

test('panel patch quality override validates every native child from frozen inputs',t=>{
  const dir=temp(t),doc=fixture(),native=compileExplainerDiagram('architecture',['api | API | backend','redis | Redis | database','api > redis | Read'],{id:'native',quality:'standard'});
  doc.panels[0].blocks.push({id:'first-diagram',type:'diagram',diagramType:'architecture',spec:native});
  fs.writeFileSync(path.join(dir,'second.architecture.json'),JSON.stringify(native,null,2)+'\n');
  doc.panels[1].blocks.push({id:'second-diagram',type:'diagram',diagramType:'architecture',source:'second.architecture.json'});
  const {artifact}=deliver(dir,doc),previous=read(artifact),replacement=path.join(dir,'replacement.json'),output=path.join(dir,'patched.html');
  const next=structuredClone(doc.panels[0]);next.blocks[0].text='The selected panel has new prose.';fs.writeFileSync(replacement,JSON.stringify(next));fs.unlinkSync(path.join(dir,'second.architecture.json'));
  const result=run(['patch','explainer',artifact,'first',replacement,output,'--quality','showcase','--json']);assert.equal(result.status,0,result.stdout+result.stderr);
  const patched=read(output);assert.equal(patched.quality,'showcase');assert.deepEqual(patched.document.panels[1],previous.document.panels[1]);
  for(const child of Object.values(patched.preparedDiagrams.diagrams)){assert.equal(child.checks.check.composition.profile,'showcase');assert.equal(child.checks.check.ok,true);assert.match(child.html,/data-quality-profile="showcase"/);}
  assert.deepEqual(patched.dependencies.find(dep=>dep.id==='second-diagram'),{...previous.dependencies.find(dep=>dep.id==='second-diagram'),retained:true});
  const check=run(['check',output,'--json','--require-provenance']);assert.equal(check.status,0,check.stdout+check.stderr);
});


test('panel patch across directories retains resource origins for subsequent edits',t=>{
  const dir=fs.realpathSync(temp(t)),source=path.join(dir,'source'),out=path.join(dir,'out'),moved=path.join(dir,'moved','deep');
  for(const folder of [source,out,moved])fs.mkdirSync(folder,{recursive:true});
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8XcAAAAASUVORK5CYII=','base64');
  fs.writeFileSync(path.join(source,'asset.png'),png);
  const doc=fixture();doc.panels[1].blocks.push({id:'retained-image',type:'image',path:'asset.png',alt:'Retained image'});
  const input=path.join(source,'draft.json'),artifact=path.join(out,'page.html'),replacement=path.join(dir,'replacement.json');
  fs.writeFileSync(input,JSON.stringify(doc));
  const delivered=run(['deliver','explainer',input,artifact,'--json']);assert.equal(delivered.status,0,delivered.stdout+delivered.stderr);
  const next={...doc.panels[0],title:'Changed title'};fs.writeFileSync(replacement,JSON.stringify(next));
  const relocated=path.join(moved,'page.html');
  const first=run(['patch','explainer',artifact,'first',replacement,relocated,'--json']);assert.equal(first.status,0,first.stdout+first.stderr);
  next.blocks=[...next.blocks,{id:'new-image',type:'image',path:'asset.png',alt:'New image'}];fs.writeFileSync(replacement,JSON.stringify(next));
  const output=path.join(out,'final.html');
  const second=run(['patch','explainer',relocated,'first',replacement,output,'--json']);assert.equal(second.status,0,second.stdout+second.stderr);
  const result=read(output);
  assert.equal(path.resolve(out,result.sourcePath),input);assert.equal(path.resolve(out,result.baseDir),source);
  for(const id of ['retained-image','new-image']){
    assert.equal(path.resolve(out,result.dependencies.find(entry=>entry.id===id).path),path.join(source,'asset.png'));
    assert.deepEqual(Buffer.from(result.preparedSources.assets[id].contentBase64,'base64'),png);
  }
  const checked=run(['check',output,'--json','--require-provenance']);assert.equal(checked.status,0,checked.stdout+checked.stderr);
});


test('a page without its source directory can patch prose but cannot read unrelated output-local assets',async t=>{
  const dir=temp(t),{artifact}=deliver(dir),bundle=read(artifact),replacementPath=path.join(dir,'replacement.json');
  bundle.sourcePath=null;bundle.baseDir=null;
  bundle.digest=createHash('sha256').update(JSON.stringify({...bundle,digest:undefined})).digest('hex');
  fs.writeFileSync(artifact,fs.readFileSync(artifact,'utf8').replace(/(<script type="application\/json" id="archify-explainer-prepared">)[\s\S]*?(<\/script>)/,(_,open,close)=>open+JSON.stringify(packPageBundle(bundle))+close));
  const panel={...fixture().panels[0],title:'Updated prose'};fs.writeFileSync(replacementPath,JSON.stringify(panel));
  const result=await preparePanelPatch({artifactPath:artifact,panelId:'first',replacementPath});assert.equal(result.bundle.baseDir,null);
  fs.writeFileSync(path.join(dir,'asset.png'),'An unrelated file beside the HTML');
  panel.blocks.push({id:'new-image',type:'image',path:'asset.png',alt:'New image'});fs.writeFileSync(replacementPath,JSON.stringify(panel));
  await assert.rejects(preparePanelPatch({artifactPath:artifact,panelId:'first',replacementPath}),{message:'Local images require an input directory.'});
});


test('patch output excludes temporary execution paths and is reproducible (#1085)', t => {
  const dir = temp(t), {artifact, input} = deliver(dir);
  const replacement = path.join(dir, 'replacement.json'), outputs = ['first', 'second'].map(name => path.join(dir, name, 'patched.html'));
  for (const output of outputs) fs.mkdirSync(path.dirname(output));
  fs.writeFileSync(replacement, JSON.stringify({...fixture().panels[0], title:'A stable replacement'}));
  const original = fs.readFileSync(artifact), source = fs.readFileSync(input);
  let previous;
  for (const output of outputs) {
    const patched = run(['patch','explainer',artifact,'first',replacement,output,'--json']);
    assert.equal(patched.status, 0, patched.stdout + patched.stderr);
    const bundle = read(output), bytes = fs.readFileSync(output);
    assert.equal(Object.hasOwn(bundle, 'inputPath'), false);
    assert.equal(path.resolve(path.dirname(output), bundle.sourcePath), input);
    assert.doesNotMatch(JSON.stringify(bundle), /archify-explainer-patch-[^/\\]*[/\\]patched-draft\.json/);
    assert.equal(bundle.digest, createHash('sha256').update(JSON.stringify({...bundle,digest:undefined})).digest('hex'));
    if (previous) assert.deepEqual(bytes, previous, 'equivalent output directories give identical HTML despite separate patch temporaries');
    previous = bytes;
    const checked = run(['check',output,'--json','--require-provenance']);
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
  }
  assert.deepEqual(fs.readFileSync(artifact), original);
  assert.deepEqual(fs.readFileSync(input), source);
  fs.unlinkSync(input);
  // A later edit resolves a new relative resource from the original draft directory.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8XcAAAAASUVORK5CYII=','base64');
  fs.writeFileSync(path.join(dir, 'later.png'), png);
  fs.writeFileSync(replacement, JSON.stringify({...fixture().panels[0], blocks:[{id:'new-image',type:'image',path:'later.png',alt:'A later resource'}]}));
  const output = path.join(dir, 'repatched.html');
  const again = run(['patch','explainer',outputs[0],'first',replacement,output,'--json']);
  assert.equal(again.status, 0, again.stdout + again.stderr);
  const bundle = read(output);
  assert.equal(Object.hasOwn(bundle, 'inputPath'), false);
  assert.equal(path.resolve(dir, bundle.sourcePath), input);
  assert.equal(bundle.preparedSources.assets['new-image'].sha256, createHash('sha256').update(png).digest('hex'));
  const checked = run(['check',output,'--json','--require-provenance']);
  assert.equal(checked.status, 0, checked.stdout + checked.stderr);
});

test('reader serialization omits private bindings for Windows paths and missing origins (#1085)', async t => {
  const dir = temp(t), sourceText = JSON.stringify(fixture());
  const prepared = await prepareExplainer(sourceText, {inputPath:path.join(dir,'draft.json')});
  for (const origin of [true, false]) {
    const bundle = rebindPreparedBundle({...prepared,
      sourcePath:origin ? 'C:\\project\\draft.json' : null,
      baseDir:origin ? 'C:\\project' : null,
      inputPath:'C:\\Users\\FixtureUser\\AppData\\Local\\Temp\\archify-explainer-patch-random\\patched-draft.json'}, {sourceText:prepared.sourceText,document:prepared.document,sourceMap:prepared.sourceMap,format:prepared.format,diagnostics:prepared.diagnostics});
    const before = JSON.stringify(bundle);
    const html = renderExplainer(bundle.document, {preparedBundle:bundle, sourceText:bundle.sourceText,
      sourceMap:bundle.sourceMap, preparedSources:bundle.preparedSources, preparedDiagrams:bundle.preparedDiagrams,
      ...(origin ? {pageDirectory:'C:\\project\\output'} : {})});
    const page = unpackPageBundle(JSON.parse(scanHtml(html).scripts.find(s=>s.attrs.id==='archify-explainer-prepared').text));
    assert.equal(Object.hasOwn(page, 'inputPath'), false);
    assert.doesNotMatch(JSON.stringify(page), /FixtureUser|patched-draft|archify-explainer-patch-random/);
    assert.equal(page.sourcePath, origin ? '..\\draft.json' : null);
    assert.equal(page.digest, createHash('sha256').update(JSON.stringify({...page,digest:undefined})).digest('hex'));
    assert.equal(JSON.stringify(bundle), before, 'private validated bundle must stay unchanged');
  }
});
