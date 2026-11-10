import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
function render(t, diagram) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'report-regression-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const input=path.join(dir,'input.json'), output=path.join(dir,'output.html');
  fs.writeFileSync(input,JSON.stringify(diagram));
  const run=spawnSync(process.execPath,['archify/bin/archify.mjs','render',diagram.diagram_type,input,output],{encoding:'utf8'});
  assert.equal(run.status,0,run.stderr+run.stdout);
  return fs.readFileSync(output,'utf8').match(/<svg\b[\s\S]*?<\/svg>/u)[0];
}
test('Class preserves comma and whitespace inside quoted method parameters',t=>{
  for(const parameters of ['value: Literal["a,b"]','a: X,b: Y','a: X,  b: Y','value: Literal["a,\tb"]']) {
    const svg=render(t,{schema_version:1,diagram_type:'class',meta:{title:'Literal fidelity'},types:[{id:'parser',label:'Parser',kind:'class',methods:[{name:'parse',parameters,returns:'Result'}],row:0,col:0}]});
    const text=svg.replace(/<[^>]+>/g,'').replaceAll('&quot;','"');
    assert.ok(text.includes(`parse(${parameters})`),parameters);
  }
});
test('Class retains parameter whitespace across authored-width wrap boundaries',t=>{
  for(const width of [180,196,220]) for(const parameters of ['value: Literal["a,  b"]','a: X,  b: Y','value: Literal["a,\t\tb"]']) {
    const svg=render(t,{schema_version:1,diagram_type:'class',meta:{title:'Wrapped literals'},types:[{id:'parser',label:'Parser',kind:'class',width,row:0,col:0,methods:[{name:'parse',parameters,returns:'Result'}]}]});
    const text=[...svg.matchAll(/<text\b[^>]*data-class-member="methods"[^>]*>([\s\S]*?)<\/text>/g)]
      .map(([,line])=>line.replace(/<[^>]+>/g,'').replaceAll('&quot;','"')).join('');
    assert.ok(text.includes(`parse(${parameters})`),`${width}: ${JSON.stringify(text)}`);
  }
});
