import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { prepare, nodeSize, writeDraft, semanticProjection } from './firstpass.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function fixture() {
  return { schema_version: 1, diagram_type: 'architecture', meta: { title: 'Request and Event', locale: 'en', quality_profile: 'showcase' },
    components: [
      { id: 'client', type: 'frontend', label: 'Client', sublabel: 'Sends a request', row: 0, col: 0 },
      { id: 'api', type: 'backend', label: 'API', sublabel: 'Validates and writes state', row: 0, col: 1 },
      { id: 'store', type: 'database', label: 'Store', sublabel: 'Retains durable records for later reads', row: 0, col: 2 },
      { id: 'events', type: 'messagebus', label: 'Events', sublabel: 'Carries change notifications', row: 1, col: 1 },
    ],
    boundaries: [{ kind: 'region', label: 'Service', wraps: ['api','store','events'] }],
    connections: [{id:'request',from:'client',to:'api',label:'HTTPS'}, {id:'persist',from:'api',to:'store',label:'write'}, {id:'emit',from:'api',to:'events',label:'publish',variant:'dashed'}],
    cards: [{dot:'cyan',title:'State and notifications',items:['API validates state before storing records and publishing changes.']}],
  };
}
const options = {requirements:['Explain the request, state write and change event.'],coverage:[{clause:1,anchors:['/cards/0/items/0','/connections/0/label']}]};

test('row plan retains all non-geometric fields and leaves input immutable', () => {
  const input = fixture(), before = structuredClone(input);
  const result = prepare(input, options);
  assert.deepEqual(input,before);
  assert.deepEqual(semanticProjection(result.diagram),semanticProjection(input));
  assert.equal(result.receipt.semanticTruthVerified,false);
  assert.ok(result.diagram.components[2].size[0] >= 214);
  assert.ok(result.diagram.components[3].pos[1] > result.diagram.components[1].pos[1]);
});
test('rejects missing, duplicate and non-visible coverage anchors', () => {
  assert.throws(()=>prepare(fixture(),{...options,coverage:[]}),/every/);
  assert.throws(()=>prepare(fixture(),{requirements:['a','b'],coverage:[options.coverage[0],options.coverage[0]]}),/duplicate/);
  for (const pointer of ['/meta/title','/components/0/sources/0/path','/cards/9/items/0']) assert.throws(()=>prepare(fixture(),{...options,coverage:[{clause:1,anchors:[pointer]}]}));
  const shallow = prepare(fixture(),{requirements:['An unverified assertion'],coverage:[{clause:1,anchors:['/components/0/label']}]});
  assert.equal(shallow.receipt.semanticTruthVerified,false); // Structural anchors do not prove meaning.
});
test('rejects destructive placement assumptions and lossy JSON', () => {
  const mutations = [d=>d.components[0].pos=[1,2],d=>d.connections[0].via=[],d=>d.components[1].col=0,d=>d.meta.viewBox=[800,600],d=>d.components[0].extra=undefined,d=>d.connections[0].to='absent'];
  for(const mutate of mutations){const d=fixture();mutate(d);assert.throws(()=>prepare(d,options));}
  assert.throws(()=>nodeSize({label:'a',size:[NaN,72]}));
});
test('initial write rejects existing files, symlink and hard-link aliases', () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'archify-firstpass-test-'));
  const previous=process.cwd();process.chdir(temp);
  try {
    fs.mkdirSync('output');const file=path.resolve('output/source.json'); fs.writeFileSync(file,'original');
    const hard=path.resolve('output/hard.json'),sym=path.resolve('output/sym.json');fs.linkSync(file,hard);fs.symlinkSync(file,sym);
    for(const p of [file,hard,sym])assert.throws(()=>writeDraft(p,fixture(),options),/EEXIST/);
    assert.equal(fs.readFileSync(file,'utf8'),'original');
  } finally {process.chdir(previous);fs.rmSync(temp,{recursive:true,force:true});}
});
test('output ancestor aliases and outside targets are rejected', () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'archify-firstpass-parent-'));
  const previous=process.cwd();process.chdir(temp);
  try {
    fs.mkdirSync('outside');fs.symlinkSync(path.resolve('outside'),'output');
    assert.throws(()=>writeDraft('output/new.json',fixture(),options),/symlinks/);
    assert.throws(()=>writeDraft('outside/new.json',fixture(),options),/inside/);
    assert.deepEqual(fs.readdirSync('outside'),[]);
  } finally {process.chdir(previous);fs.rmSync(temp,{recursive:true,force:true});}
});
test('independent multi-row preferred-text fixture passes unchanged showcase validation', () => {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'archify-firstpass-fixture-'));
  const previous=process.cwd();process.chdir(temp);
  try {
    const file=path.resolve('output/diagram.json');writeDraft(file,fixture(),options);
    const result=spawnSync(process.execPath,[path.join(root,'archify/bin/archify.mjs'),'validate','architecture',file,'--quality','showcase','--json'],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stdout+result.stderr);
    assert.equal(JSON.parse(result.stdout).ok,true);
  } finally {process.chdir(previous);fs.rmSync(temp,{recursive:true,force:true});}
});
