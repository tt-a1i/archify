import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {compileBrief} from '../archify/story/story-plan.mjs';
import {scanStory} from '../archify/story/tool.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const fixture=path.join(root,'test/fixtures/story-node-steps');
const brief=JSON.parse(fs.readFileSync(path.join(fixture,'brief.json'),'utf8'));
const cli=path.join(root,'archify/bin/archify.mjs');
const payload=html=>JSON.parse(/id="archify-story-payload" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1]);

test('Story attachment exposes complete caller-local stages, preserving parallel batches and authored scene boundaries',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'archify-node-steps-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const native=path.join(dir,'native.html'),plan=path.join(dir,'brief.json'),out=path.join(dir,'out.html');
  execFileSync(process.execPath,[cli,'render','architecture',path.join(fixture,'diagram.json'),native]);
  fs.writeFileSync(plan,JSON.stringify(brief));
  execFileSync(process.execPath,[cli,'story','attach',native,plan,out]);
  const attached=fs.readFileSync(out,'utf8'),sequences=payload(attached).nodeSequences;
  assert.equal(sequences.length,1);assert.equal(sequences[0].node,'page');
  assert.deepEqual(sequences[0].steps.map(step=>step.edges),[['classify-call'],['extract-call'],['save-record'],['upload-file'],['write-a','write-b']]);
  assert.deepEqual(sequences[0].steps.at(-1).targets,['Store A','Store B']);
  const at=attached.indexOf('<style id="archify-story-attachment-style">');
  assert.equal(attached.slice(0,at)+attached.slice(attached.lastIndexOf('</body>')),fs.readFileSync(native,'utf8'));
  const facts=scanStory(native);
  const replay=structuredClone(brief);replay.scenes.push({...structuredClone(replay.scenes[0]),title:'Another scenario'});
  assert.deepEqual(compileBrief(replay,facts).nodeSequences.map(item=>item.title),['Single caller, declared stages','Another scenario']);
  const trace=structuredClone(brief);trace.scenes[0].points.at(-1).action='trace';
  assert.deepEqual(compileBrief(trace,facts).nodeSequences[0].steps.slice(-2).map(step=>step.edges),[['write-a'],['write-b']]);
  for(const change of [p=>p.scenes[0].points[1].anchor='extract',p=>p.scenes[0].points[1].action='relation',p=>delete p.scenes[0].points[1].via]){
    const mixed=structuredClone(brief);change(mixed);assert.deepEqual(compileBrief(mixed,facts).nodeSequences,[],'do not turn a partial or non-transfer scene into a call sequence');
  }
  const hostile=structuredClone(brief);hostile.scenes[0].points[0].title='</script><script>unsafe()</script>';
  fs.writeFileSync(plan,JSON.stringify(hostile));execFileSync(process.execPath,[cli,'story','attach',native,plan,out]);
  const safe=fs.readFileSync(out,'utf8');assert.equal(payload(safe).nodeSequences[0].steps[0].title,hostile.scenes[0].points[0].title);assert.ok(!safe.includes('<script>unsafe()'));
  // A version-1 shot plan remains accepted but carries no trusted local order.
  fs.writeFileSync(plan,JSON.stringify(compileBrief(brief,facts)));execFileSync(process.execPath,[cli,'story','attach',native,plan,out]);
  assert.deepEqual(payload(fs.readFileSync(out,'utf8')).nodeSequences,[]);
});
