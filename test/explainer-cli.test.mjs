import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { prepareExplainer, writePreparedBundle } from '../archify/explainer/prepare.mjs';
import { scanHtml } from '../archify/explainer/check.mjs';
import { compileExplainerDiagram } from '../archify/explainer/diagrams.mjs';
const cli = path.resolve('archify/bin/archify.mjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8XcAAAAASUVORK5CYII=', 'base64');
function run(args,env={}) { return spawnSync(process.execPath,[cli,...args],{encoding:'utf8',maxBuffer:64*1024*1024,env:{...process.env,ARCHIFY_UPDATE_CHECK_DISABLED:'1',...env}}); }
function fixture() {return {schema_version:1,diagram_type:'explainer',meta:{id:'cli-document',title:'How is a draft delivered?',locale:'en'},answer:{summary:'A checked candidate preserves the authored draft.'},panels:[{id:'delivery',title:'What is checked?',blocks:[{id:'delivery-text',type:'prose',text:'The draft is parsed and checked before publication.'}]}],sources:[]};}
function temporary(t) {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-explainer-cli-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function write(dir,document=fixture()) {const input=path.join(dir,'author-draft.json');fs.writeFileSync(input,JSON.stringify(document,null,2)+'\n');return input;}
function bundle(file) {const scripts=scanHtml(fs.readFileSync(file,'utf8')).scripts;return JSON.parse(scripts.find(script=>script.attrs.id==='archify-explainer-prepared').text);}

test('compact cyclic diagrams remain deliverable with a stricter quality override',t=>{
  const dir=temporary(t),input=path.join(dir,'ring.archify.md'),output=path.join(dir,'ring.html');
  const examples=[{type:'architecture',rows:[...Array.from({length:10},(_,i)=>`n${i} | Node ${i}`),...Array.from({length:10},(_,i)=>`n${i} > n${(i+1)%10}`)]},
    {type:'workflow',rows:[...Array.from({length:8},(_,i)=>`n${7-i} | N${7-i}`),...Array.from({length:8},(_,i)=>`n${i} > n${(i+1)%8}`),'n1 > n0','n1 > n3','n4 > n2']}];
  for(const {type,rows} of examples){
    const metadata='@meta quality_profile=standard locale=zh-CN';
    const source=`# Ring\n\nKeep every connection readable.\n\n${type==='workflow'?metadata+'\n\n':''}## Connections {#connections}\n\n@${type}\n${rows.map(row=>`| ${row} |`).join('\n')}\n${type==='architecture'?'\n'+metadata+'\n':''}`;
    fs.writeFileSync(input,source);
    const delivered=run(['deliver','explainer',input,output,'--quality','showcase','--json']);
    assert.equal(delivered.status,0,delivered.stdout+delivered.stderr);
    assert.equal(bundle(output).quality,'showcase');
    assert.equal(bundle(output).document.meta.quality_profile,'standard');
    assert.equal(bundle(output).document.meta.locale,'zh-CN');
    assert.equal(fs.readFileSync(input,'utf8'),source);
    const checked=run(['check',output,'--json','--require-provenance']);
    assert.equal(checked.status,0,checked.stdout+checked.stderr);
    const standardOutput=path.join(dir,'standard',path.basename(output));fs.mkdirSync(path.dirname(standardOutput),{recursive:true});
    const standard=run(['deliver','explainer',input,standardOutput,'--quality','standard','--json']);
    assert.equal(standard.status,0,standard.stdout+standard.stderr);
    assert.deepEqual(bundle(standardOutput).document,bundle(output).document,'render quality cannot change the normalized source or its automatic anchors');
  }
});

test('patch quality changes resolve shorthand under the new context and preserve other authored panels',t=>{
  const dir=temporary(t),input=path.join(dir,'draft.md'),output=path.join(dir,'original.html'),replacement=path.join(dir,'panel.md'),patched=path.join(dir,'patched.html');
  const rows=[...Array.from({length:10},(_,i)=>`n${i} | Node ${i}`),...Array.from({length:10},(_,i)=>`n${i} > n${(i+1)%10}`)];
  const source=`# Ring\n\nPreserve the graph.\n\n@meta quality_profile=standard\n\n## Notes {#notes}\n\nOriginal note.\n\n## Graph {#graph}\n\n@architecture id=ring\n${rows.join('\n')}\n`;
  fs.writeFileSync(input,source);fs.writeFileSync(replacement,'## Notes {#notes}\n\nEdited note.\n\n');
  const first=run(['deliver','explainer',input,output,'--quality','showcase','--json']);assert.equal(first.status,0,first.stdout+first.stderr);
  const change=run(['patch','explainer',output,'notes',replacement,patched,'--quality','standard','--json']);assert.equal(change.status,0,change.stdout+change.stderr);
  const saved=bundle(patched);assert.equal(saved.quality,'standard');assert.equal(saved.sourceText,source.replace('Original note.','Edited note.'));
  assert.equal(saved.document.panels[1].id,'graph');assert.equal(saved.document.panels[1].blocks[0].spec.connections.length,10);
  const checked=run(['check',patched,'--json','--require-provenance']);assert.equal(checked.status,0,checked.stdout+checked.stderr);
});

test('explainer CLI binds original draft bytes through validate, deliver and strict check',t=>{
  const dir=temporary(t),input=write(dir),output=path.join(dir,'result.html');
  const validation=run(['validate','explainer',input,'--json']);assert.equal(validation.status,0,validation.stdout+validation.stderr);
  assert.equal(JSON.parse(validation.stdout).candidate.sha256,sha(fs.readFileSync(input)));
  const delivery=run(['deliver','explainer',input,output,'--json']);assert.equal(delivery.status,0,delivery.stdout+delivery.stderr);
  const receipt=JSON.parse(delivery.stdout);assert.equal(receipt.specification.sha256,sha(fs.readFileSync(input)));assert.equal(receipt.artifact.sha256,sha(fs.readFileSync(output)));
  const frozen=bundle(output);assert.equal(frozen.sourceText,fs.readFileSync(input,'utf8'));assert.equal(path.isAbsolute(frozen.sourcePath),false);assert.equal(fs.realpathSync(path.resolve(path.dirname(output),frozen.sourcePath)),fs.realpathSync(input));
  const check=run(['check',output,'--json','--require-provenance']);assert.equal(check.status,0,check.stdout+check.stderr);assert.equal(JSON.parse(check.stdout).deliveryReceiptId,receipt.receiptId);
});

test('explainer CLI parse and semantic failures preserve an existing artifact and actionable locations',t=>{
  const dir=temporary(t),input=write(dir),output=path.join(dir,'result.html');
  assert.equal(run(['deliver','explainer',input,output,'--json']).status,0);const previous=fs.readFileSync(output);
  const doc=fixture();doc.panels[0].blocks[0].type='unsupported-widget';fs.writeFileSync(input,JSON.stringify(doc,null,2));
  const failure=run(['deliver','explainer',input,output,'--json']);assert.equal(failure.status,1);assert.deepEqual(fs.readFileSync(output),previous);
  const diagnostic=JSON.parse(failure.stdout).diagnostics[0];assert.ok(diagnostic.code.startsWith('explainer/'));assert.ok(diagnostic.subject.line>0);assert.ok(diagnostic.subject.component);assert.ok(diagnostic.evidence.reason);assert.ok(diagnostic.evidence.example);
  fs.writeFileSync(input,'{\n  broken');const malformed=run(['finalize','explainer',input,output,'--json']);assert.equal(malformed.status,1);const final=JSON.parse(malformed.stdout);assert.deepEqual(Object.keys(final.gates),['validate','deliver','check','browser-check']);assert.deepEqual(fs.readFileSync(output),previous);
});

test('explainer prepared resource mutation fails before overwriting last good HTML',async t=>{
  const dir=temporary(t),doc=fixture();doc.panels[0].blocks.push({id:'contained-image',type:'image',path:'asset.png',alt:'A contained test image'});
  const input=write(dir,doc),output=path.join(dir,'result.html');fs.writeFileSync(path.join(dir,'asset.png'),png);
  const delivered=run(['deliver','explainer',input,output,'--json']);assert.equal(delivered.status,0,delivered.stdout+delivered.stderr);const previous=fs.readFileSync(output);
  const prepared=await prepareExplainer(fs.readFileSync(input,'utf8'),{inputPath:input});const preparedPath=writePreparedBundle(dir,prepared);
  fs.writeFileSync(path.join(dir,'asset.png'),Buffer.concat([png,Buffer.from('mutation')]));
  const result=run(['deliver','explainer',input,output,'--json'],{ARCHIFY_EXPLAINER_PREPARED:preparedPath});assert.equal(result.status,1);assert.ok(JSON.parse(result.stdout).diagnostics.some(d=>d.code==='explainer/dependency-changed'));assert.deepEqual(fs.readFileSync(output),previous);
});

test('explainer refuses a prepared bundle bound to different original source bytes',async t=>{
  const dir=temporary(t),input=write(dir),output=path.join(dir,'result.html');fs.writeFileSync(output,'last good artifact');
  const prepared=await prepareExplainer(fs.readFileSync(input,'utf8'),{inputPath:input});const preparedPath=writePreparedBundle(dir,prepared);fs.appendFileSync(input,'\n');
  const result=run(['deliver','explainer',input,output,'--json'],{ARCHIFY_EXPLAINER_PREPARED:preparedPath});assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).diagnostics[0].code,'explainer/prepared-mismatch');assert.equal(fs.readFileSync(output,'utf8'),'last good artifact');
});

test('explainer direct render resolves contained resources against author directory',t=>{
  const dir=temporary(t),doc=fixture();doc.panels[0].blocks.push({id:'contained-image',type:'image',path:'asset.png',alt:'A contained test image'});
  const input=write(dir,doc),output=path.join(dir,'result.html');fs.writeFileSync(path.join(dir,'asset.png'),png);
  const rendered=run(['render','explainer',input,output]);assert.equal(rendered.status,0,rendered.stderr);assert.ok(fs.readFileSync(output,'utf8').includes('data:image/png;base64,'));
});

test('explainer finalize opts into the browser gate and reports unavailability',t=>{
  const dir=temporary(t),input=write(dir),output=path.join(dir,'final.html');
  const result=run(['finalize','explainer',input,output,'--browser-check','--json'],{ARCHIFY_CHROME:''});assert.equal(result.status,2,result.stdout+result.stderr);
  const receipt=JSON.parse(result.stdout);assert.deepEqual(receipt.gates,{validate:'pass',deliver:'pass',check:'pass','browser-check':'skipped'});assert.deepEqual(receipt.browserCheck,{requested:true,ran:false});assert.equal(receipt.quality,'showcase');assert.equal(receipt.specification.sha256,sha(fs.readFileSync(input)));assert.equal(receipt.ok,false);
});

test('explainer prepared bundle cannot follow same-byte draft into a different author directory',async t=>{
  const dir=temporary(t),input=write(dir),subdir=path.join(dir,'moved');fs.mkdirSync(subdir);const moved=path.join(subdir,'author-draft.json');fs.copyFileSync(input,moved);
  const prepared=await prepareExplainer(fs.readFileSync(input,'utf8'),{inputPath:input});const preparedPath=writePreparedBundle(dir,prepared),output=path.join(dir,'result.html');fs.writeFileSync(output,'last good');
  const result=run(['deliver','explainer',moved,output,'--json'],{ARCHIFY_EXPLAINER_PREPARED:preparedPath});assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).diagnostics[0].evidence.reason,'draft-path-mismatch');assert.equal(fs.readFileSync(output,'utf8'),'last good');
});

test('explainer public writing modes warn, reject strict drafts, and permit explicit off',t=>{
  const dir=temporary(t),document=fixture();document.panels[0].blocks[0].text='We will perform an analysis of each and every request.';const input=write(dir,document),output=path.join(dir,'result.html');
  const warning=run(['deliver','explainer',input,output,'--writing','warn','--json']);assert.equal(warning.status,0,warning.stdout+warning.stderr);assert.ok(JSON.parse(warning.stdout).diagnostics.some(d=>d.code.startsWith('explainer/writing-')&&d.severity==='warning'));assert.equal(bundle(output).writingMode,'warn');const previous=fs.readFileSync(output);
  for(const command of ['validate','deliver','finalize']) {
    const result=run([command,'explainer',input,...(command==='validate'?[]:[output]),'--writing','strict','--json']);assert.equal(result.status,1,result.stdout+result.stderr);assert.ok(JSON.parse(result.stdout).diagnostics.some(d=>d.code.startsWith('explainer/writing-')&&d.severity==='error'));assert.deepEqual(fs.readFileSync(output),previous);
  }
  const disabled=run(['deliver','explainer',input,output,'--writing=off','--json']);assert.equal(disabled.status,0,disabled.stdout+disabled.stderr);assert.equal(bundle(output).writingMode,'off');assert.ok(!(JSON.parse(disabled.stdout).diagnostics||[]).some(d=>d.code.startsWith('explainer/writing-')));
  const native=run(['validate','workflow',input,'--writing','strict','--json']);assert.equal(native.status,2,native.stdout+native.stderr);assert.equal(JSON.parse(native.stdout).diagnostics[0].code,'cli/unsupported-option');
});

test('explainer prepared writing mode cannot silently change across stages',async t=>{
  const dir=temporary(t),input=write(dir),output=path.join(dir,'result.html');fs.writeFileSync(output,'last good');const prepared=await prepareExplainer(fs.readFileSync(input,'utf8'),{inputPath:input,writingMode:'off'});const preparedPath=writePreparedBundle(dir,prepared);
  const result=run(['deliver','explainer',input,output,'--writing','strict','--json'],{ARCHIFY_EXPLAINER_PREPARED:preparedPath});assert.equal(result.status,1);assert.equal(JSON.parse(result.stdout).diagnostics[0].evidence.reason,'writing-mode-mismatch');assert.equal(fs.readFileSync(output,'utf8'),'last good');
});

test('default explainer finalize succeeds without discovering or launching a browser',t=>{
 const dir=temporary(t),input=write(dir),output=path.join(dir,'fast.html');
 const result=run(['finalize','explainer',input,output,'--json'],{ARCHIFY_CHROME:path.join(dir,'does-not-exist')});assert.equal(result.status,0,result.stdout+result.stderr);
 const summary=JSON.parse(result.stdout);assert.deepEqual(summary.gates,{validate:'pass',deliver:'pass',check:'pass','browser-check':'not-run'});assert.deepEqual(summary.browserCheck,{requested:false,ran:false});assert.equal(summary.ok,true);
 const full=JSON.parse(fs.readFileSync(summary.evidence.receipt,'utf8'));assert.deepEqual(full.browserCheck,summary.browserCheck);assert.equal(full.stages['browser-check'].execution,'not-requested');
});

test('CR-only drafts return structured failures through public commands and preserve output (#1083)',t=>{
  const dir=temporary(t),input=path.join(dir,'cr-only.md'),output=path.join(dir,'result.html');
  const source='# Title\r\rAnswer.\r\r## Question\r\rText.\r';
  fs.writeFileSync(input,source);fs.writeFileSync(output,'previous verified artifact');
  for(const command of ['validate','deliver','finalize']) {
    const result=run([command,'explainer',input,...(command==='validate'?[]:[output]),'--json']);
    assert.equal(result.status,1,result.stdout+result.stderr);
    const receipt=JSON.parse(result.stdout);
    assert.ok(receipt.diagnostics.some(entry=>entry.code.startsWith('explainer/parse-')),result.stdout);
    assert.ok(receipt.diagnostics.every(entry=>entry.code!=='input/read'),result.stdout);
    assert.doesNotMatch(result.stdout+result.stderr,/Cannot read properties of null/);
    assert.equal(fs.readFileSync(output,'utf8'),'previous verified artifact');
    assert.equal(fs.readFileSync(input,'utf8'),source);
  }
});


test('literal heading separators survive public validate, deliver and finalize (#1083)',t=>{
  const dir=temporary(t),input=path.join(dir,'headings.md'),output=path.join(dir,'result.html');
  for(const separator of ['\r','\u2028','\u2029']) {
    const source=`# Title${separator}continued {#heading}\n\nAnswer.\n\n## Question${separator}continued {#question span=7}\n\nText.\n`;
    fs.writeFileSync(input,source);
    for(const command of ['validate','deliver','finalize']) {
      const result=run([command,'explainer',input,...(command==='validate'?[]:[output]),'--json']);
      assert.equal(result.status,0,result.stdout+result.stderr);
      assert.equal(JSON.parse(result.stdout).ok,true,result.stdout);
      if(command!=='validate') {
        const saved=bundle(output);
        assert.equal(saved.sourceText,source);
        assert.equal(saved.document.meta.title,`Title${separator}continued`);
        assert.equal(saved.document.meta.id,'heading');
        assert.equal(saved.document.panels[0].title,`Question${separator}continued`);
        assert.equal(saved.document.panels[0].id,'question');
        assert.equal(saved.document.panels[0].span,7);
      }
      assert.equal(fs.readFileSync(input,'utf8'),source);
    }
  }
});

test('workflow shorthand carries page locale into rendered lane labels (#1082)',t=>{
  const dir=temporary(t);
  for(const [locale,label] of [['en','Branch 1'],['es','Branch 1'],['zh-CN','分支 1'],['zh-TW','分支 1'],['zh-Hant','分支 1'],[undefined,'分支 1']]) {
    const input=path.join(dir,`${locale||'default'}.md`),output=path.join(dir,`${locale||'default'}.html`);
    const source=`# Release flow\n\nA build either ships or rolls back.\n\n${locale?`@meta locale=${locale}\n\n`:''}## How does a release branch? {#question}\n\n@workflow id=flow\n| a | Build | backend |\n| b | Ship | backend |\n| c | Roll back | backend |\n| a > b | green |\n| a > c | red |\n`;
    fs.writeFileSync(input,source);
    const result=run(['deliver','explainer',input,output,'--quality','standard','--json']);
    assert.equal(result.status,0,result.stdout+result.stderr);
    const frozen=bundle(output),html=fs.readFileSync(output,'utf8');
    assert.equal(frozen.sourceText,source);
    assert.equal(frozen.document.panels[0].blocks[0].spec.lanes[1].label,label);
    assert.ok(html.includes(`data-node-context="${label}"`),locale||'default');
    assert.ok(html.includes(`<title>Roll back · ${label}</title>`),locale||'default');
    assert.match(html,new RegExp(`aria-label="[^"]*Roll back[^"]*${label}"`,'u'),locale||'default');
  }
});


test('page title links validate against prepared external native targets',async t=>{
  const dir=temporary(t),document=fixture();
  const native=compileExplainerDiagram('architecture',['api | API | backend','store | Store | database','api > store | writes'],{id:'system'});
  fs.writeFileSync(path.join(dir,'system.json'),JSON.stringify(native));
  document.panels[0].blocks.push({id:'system-view',type:'diagram',diagramType:'architecture',source:'system.json'});
  document.meta.title='Inspect [API](node:system-view.api)';
  const input=write(dir,document),prepared=await prepareExplainer(JSON.stringify(document),{inputPath:input});
  assert.ok(prepared.preparedDiagrams.diagrams['system-view'].semantic.nodes.some(node=>node.id==='api'));
  document.meta.title='Inspect [missing](node:system-view.absent)';
  await assert.rejects(prepareExplainer(JSON.stringify(document),{inputPath:input}),error=>{
    const issue=error.archifyDiagnostics?.find(d=>d.subject.path==='/meta/title');
    assert.ok(issue,JSON.stringify(error.archifyDiagnostics));
    assert.match(issue.message,/absent/);
    return true;
  });
});
