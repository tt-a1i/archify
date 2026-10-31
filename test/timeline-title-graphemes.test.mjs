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
test('Timeline title wraps preserve complete emoji grapheme clusters',t=>{
  const segmenter=new Intl.Segmenter(undefined,{granularity:'grapheme'});
  for(const cluster of ['👨‍👩‍👧‍👦','🇪🇸','👍🏽','e\u0301']) {
    const title=cluster.repeat(15);
    const svg=render(t,{schema_version:1,diagram_type:'timeline',meta:{title:'Graphemes',timezone:'UTC',evidence:'illustrative'},events:[{id:'a',at:'2026-10-01T10:00:00Z',title}]});
    const label=[...svg.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gu)].find(([,a])=>a.includes('data-node-label='));
    assert.ok(label);
    const lines=[...label[2].matchAll(/<tspan\b[^>]*>([^<]*)<\/tspan>/gu)].map(([,s])=>s);
    assert.ok(lines.length>1,'fixture must exercise wrapping: '+JSON.stringify({cluster,lines}));
    assert.equal(lines.join(''),title);
    for(const line of lines) assert.ok([...segmenter.segment(line)].every(({segment})=>segment===cluster),JSON.stringify(line));
  }
});
