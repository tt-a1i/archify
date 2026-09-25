import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compileWorkflow } from '../renderers/workflow/workflow-compiler.mjs';

const checker = fileURLToPath(new URL('../scripts/check-render-output.mjs', import.meta.url));

function sharedCrossingWorkflow() {
  return {
    schema_version: 2, diagram_type: 'workflow',
    meta: { title: 'Shared crossing', output: 'crossing.html' },
    lanes: [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }],
    nodes: [
      { id: 'a', lane: 'top', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'top', col: 2, type: 'backend', label: 'B' },
      { id: 'c', lane: 'bottom', col: 2, type: 'backend', label: 'C' },
    ],
    edges: [
      { id: 'ab', from: 'a', to: 'b', fromSide: 'bottom', toSide: 'left', via: [[94, 165], [260, 165], [260, 119]] },
      { id: 'ac', from: 'a', to: 'c', fromSide: 'right', toSide: 'left', via: [[180, 119], [180, 243]] },
    ],
  };
}

test('shared crossings retain actionable diagnostics in public compilation and layout JSON', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-crossing-diagnostics-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const renderer = fileURLToPath(new URL('../renderers/workflow/render-workflow.mjs', import.meta.url));
  for (const profile of ['standard', 'showcase']) {
    const workflow = sharedCrossingWorkflow();
    workflow.meta.quality_profile = profile;
    const compiled = compileWorkflow({ workflow, qualityProfile: profile });
    assert.equal(compiled.ok, profile === 'standard');
    const diagnostic = compiled.receipt.diagnostics.find(d => d.code === 'composition/proper-crossing');
    assert.ok(diagnostic, JSON.stringify(compiled.receipt.diagnostics));
    assert.equal(diagnostic.severity, profile === 'showcase' ? 'error' : 'warning');
    assert.equal(diagnostic.subject.id, 'ab');
    assert.equal(diagnostic.evidence.otherRelationship.id, 'ac');
    assert.deepEqual(diagnostic.evidence.point, [180, 165]);
    assert.ok(diagnostic.supportedFixes.some(fix => /route\/via/.test(fix)));

    const input = path.join(dir, `${profile}.workflow.json`);
    fs.writeFileSync(input, JSON.stringify(workflow));
    const child = spawnSync(process.execPath, [renderer, input, path.join(dir, `${profile}.html`), '--layout-json'], {
      encoding: 'utf8', env: { ...process.env, ARCHIFY_QUALITY_PROFILE: profile },
    });
    assert.equal(child.status, profile === 'showcase' ? 1 : 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout).diagnostics, compiled.receipt.diagnostics);
  }
});

test('workflow v2 compiler and final HTML agree on crossings at redundant via points', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-crossing-waypoints-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const split of ['neither', 'left', 'right', 'both']) {
    const workflow = sharedCrossingWorkflow();
    if (split === 'left' || split === 'both') workflow.edges[0].via.splice(1, 0, [180, 165]);
    if (split === 'right' || split === 'both') workflow.edges[1].via.splice(1, 0, [180, 165]);
    const compiled = compileWorkflow({ workflow, qualityProfile: 'standard' });
    assert.equal(compiled.ok, true);
    assert.equal(compileWorkflow({ workflow, qualityProfile: 'showcase' }).ok, false);
    const actualGeometry = compiled.receipt.edges.map(edge => edge.points);
    assert.deepEqual(actualGeometry[0].slice(1, -1), workflow.edges[0].via);
    assert.deepEqual(actualGeometry[1].slice(1, -1), workflow.edges[1].via);

    for (const profile of ['standard', 'showcase']) {
      const file = path.join(dir, `${split}-${profile}.html`);
      // Keep the generated strokes intact; only set the checker's quality profile.
      const svg = compiled.svg.replace('data-quality-profile="standard"', `data-quality-profile="${profile}"`);
      fs.writeFileSync(file, `<html><body>${svg}</body></html>`);
      const checked = spawnSync(process.execPath, [checker, file], { encoding: 'utf8' });
      const receipt = JSON.parse(checked.stdout);
      assert.equal(checked.status, profile === 'showcase' ? 1 : 0, `${split}/${profile}`);
      assert.equal(receipt.composition.metrics.properCrossings, 1, `${split}/${profile}`);
      const diagnostic = receipt.composition.issues.find(d => d.code === 'composition/proper-crossing');
      assert.deepEqual(diagnostic.point, [180, 165]);
      assert.equal(diagnostic.severity, profile === 'showcase' ? 'error' : 'warning');
    }
  }
});

test('workflow v2 separates long trunks without changing authored return geometry', () => {
  const workflow = JSON.parse(fs.readFileSync(new URL('./fixtures/workflow-shared-trunks.workflow.json', import.meta.url)));
  const result = compileWorkflow({ workflow, qualityProfile: 'showcase' });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const edge = id => result.receipt.edges.find(e => e.id === id).points;
  const returnPoints = edge('continue-work');
  assert.ok(returnPoints.some((p,i) => i && p[1] === 180 && returnPoints[i-1][1] === 180));
  assert.notDeepEqual(edge('model-turn').at(-1), returnPoints.at(-1), 'incoming main and return arrows need separate ports');
  assert.notDeepEqual(edge('finish')[0], returnPoints[0], 'outgoing main and return paths need separate ports');
  assert.notDeepEqual(edge('direct-answer')[0], edge('ordinary-work')[0], 'independent branch paths need separate ports');
});

test('automatic routing respects a fixed return even when its ID sorts last', () => {
  const workflow = JSON.parse(fs.readFileSync(new URL('./fixtures/workflow-shared-trunks.workflow.json', import.meta.url)));
  workflow.edges.find(e=>e.id==='continue-work').id='zz-return';
  const result=compileWorkflow({workflow,qualityProfile:'showcase'});
  assert.equal(result.ok,true,JSON.stringify(result.diagnostics));
});

function checkSvg(t, body, profile = 'showcase', contract = 'readable-v2') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-shared-trunks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'diagram.html');
  fs.writeFileSync(file, `<html><body><svg viewBox="0 0 400 240" data-diagram-type="workflow" data-layout-contract="${contract}" data-quality-profile="${profile}">${body}</svg></body></html>`);
  const result = spawnSync(process.execPath, [checker, file], { encoding: 'utf8' });
  return { code: result.status, receipt: JSON.parse(result.stdout) };
}

test('workflow v2 artifact reports a long mixed-style shared endpoint even for explicit paths', (t) => {
  const body = `
    <path data-edge-id="return" data-edge-from="result" data-edge-to="decision" data-edge-role="return" d="M 200 180 L 200 40 L 40 40 L 40 180" class="a-dashed" stroke-width="1.4" marker-end="url(#arrowhead-dashed)"/>
    <path data-edge-id="finish" data-edge-from="result" data-edge-to="reply" data-edge-role="main" d="M 200 180 L 200 80 L 300 80" class="a-emphasis" stroke-width="1.8" marker-end="url(#arrowhead-emphasis)"/>`;
  const result = checkSvg(t, body);
  assert.equal(result.code, 1, 'showcase must not accept the 100px overlap');
  const issue = result.receipt.composition.issues.find(x => x.code === 'composition/ambiguous-corridor');
  assert.equal(issue?.overlapLength, 100);
  assert.equal(issue?.severity, 'error');
});

test('workflow v2 allows only compatible short terminal merges, including the 24px boundary', (t) => {
  for (const length of [16, 23, 24, 24.00005, 24.001, 25]) {
    for (const variant of ['dashed', 'emphasis']) {
      const result = checkSvg(t, `
        <path data-edge-from="a" data-edge-to="result" data-edge-role="async" d="M 40 100 L 200 100" class="a-dashed" stroke-width="1.4" marker-end="url(#arrowhead-dashed)"/>
        <path data-edge-from="b" data-edge-to="result" data-edge-role="async" d="M ${200-length} 180 L ${200-length} 100 L 200 100" class="a-${variant}" stroke-width="1.4" marker-end="url(#arrowhead-${variant})"/>`);
      const collisions = result.receipt.composition.issues.filter(x => x.code === 'composition/ambiguous-corridor');
      assert.equal(collisions.length, length <= 24.0001 && variant === 'dashed' ? 0 : 1, `${length}/${variant}`);
    }
  }
});

test('workflow v2 rejects mismatched roles, widths, nonterminal and opposing short shared segments', (t) => {
  const base='<path data-edge-from="a" data-edge-to="result" data-edge-role="async" d="M 40 100 L 200 100" class="a-dashed" stroke-width="1.4" marker-end="url(#arrowhead-dashed)"/>';
  for (const [name,from,to,role,width,route] of [
    ['role','b','result','return',1.4,'M 184 180 L 184 100 L 200 100'],
    ['width','b','result','async',2,'M 184 180 L 184 100 L 200 100'],
    ['interior','b','result','async',1.4,'M 100 180 L 100 100 L 116 100 L 116 40 L 200 40'],
    ['opposing','result','a','async',1.4,'M 200 100 L 184 100 L 184 180'],
  ]) {
    const checked=checkSvg(t,base+`<path data-edge-from="${from}" data-edge-to="${to}" data-edge-role="${role}" d="${route}" class="a-dashed" stroke-width="${width}" marker-end="url(#arrowhead-dashed)"/>`);
    assert.equal(checked.receipt.composition.metrics.ambiguousCorridors,1,name);
  }
});

test('workflow v2 warns in standard while v1 keeps its authored shared-endpoint contract', (t) => {
  const body='<path data-edge-from="a" data-edge-to="b" d="M 40 100 L 200 100" class="a-default" marker-end="url(#arrowhead)"/><path data-edge-from="a" data-edge-to="c" d="M 40 100 L 200 100 L 200 180" class="a-default" marker-end="url(#arrowhead)"/>';
  const standard=checkSvg(t,body,'standard');
  assert.equal(standard.code,0);
  assert.equal(standard.receipt.composition.issues.find(x=>x.code==='composition/ambiguous-corridor')?.severity,'warning');
  const legacy=checkSvg(t,body,'showcase','fixed-v1');
  assert.equal(legacy.code,0);
  assert.equal(legacy.receipt.composition.metrics.ambiguousCorridors,0);
});

test('shared-trunk routing is deterministic under repeated and reordered input', () => {
  const workflow=JSON.parse(fs.readFileSync(new URL('./fixtures/workflow-shared-trunks.workflow.json',import.meta.url)));
  const before=JSON.stringify(workflow);
  const first=compileWorkflow({workflow,qualityProfile:'showcase'});
  assert.equal(first.ok,true);
  const second=compileWorkflow({workflow,qualityProfile:'showcase'});
  assert.equal(JSON.stringify(workflow),before);
  assert.deepEqual(second,first);
  workflow.edges.reverse();workflow.nodes.reverse();
  assert.deepEqual(compileWorkflow({workflow,qualityProfile:'showcase'}),first);
});

test('workflow v2 detects arrow collisions even without coincident centerlines', (t) => {
  const result = checkSvg(t, `
    <path data-edge-from="a" data-edge-to="result" d="M 40 80 L 200 80" class="a-emphasis" stroke-width="6" marker-end="url(#arrowhead-emphasis)"/>
    <path data-edge-from="b" data-edge-to="result" d="M 40 100 L 200 100" class="a-emphasis" stroke-width="6" marker-end="url(#arrowhead-emphasis)"/>`);
  assert.equal(result.code, 1);
  assert.equal(result.receipt.composition.metrics.arrowheadCollisions, 1);
});

test('workflow compiler diagnoses fixed shared trunks without overriding the authored paths', () => {
  const workflow = {
    schema_version: 2, diagram_type: 'workflow', meta: { title: 'Pinned fork', output: 'fork.html' },
    lanes: [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }],
    nodes: [
      { id: 'a', lane: 'top', col: 0, type: 'backend', label: 'A' },
      { id: 'b', lane: 'bottom', col: 1, type: 'backend', label: 'B' },
      { id: 'c', lane: 'bottom', col: 2, type: 'backend', label: 'C' },
    ],
    edges: ['b','c'].map(to=>({id:to,from:'a',to,fromSide:'bottom',toSide:'top',channelY:180,variant:to==='b'?'dashed':'emphasis'})),
  };
  const standard = compileWorkflow({workflow,qualityProfile:'standard'});
  assert.equal(standard.ok,true,JSON.stringify(standard));
  assert.equal(standard.receipt.diagnostics.find(d=>d.code==='composition/ambiguous-corridor')?.severity,'warning');
  const showcase = compileWorkflow({workflow,qualityProfile:'showcase'});
  assert.equal(showcase.ok,false);
  const issue=showcase.diagnostics.find(d=>d.code==='composition/ambiguous-corridor');
  assert.equal(issue?.severity,'error');
  assert.ok(issue.evidence.overlapLengthPx>24);
  assert.ok(issue.supportedFixes.length);
});

test('workflow v2 checker measures actual strokes, not stale composition point metadata', (t) => {
  const result=checkSvg(t, `
    <path data-edge-from="a" data-edge-to="b" data-composition-points="40,40;180,40" d="M 40 100 L 180 100" class="a-default" marker-end="url(#arrowhead)"/>
    <path data-edge-from="a" data-edge-to="c" data-composition-points="40,60;180,60" d="M 40 100 L 180 100 L 180 180" class="a-default" marker-end="url(#arrowhead)"/>`);
  assert.equal(result.receipt.composition.metrics.ambiguousCorridors,1);
});

test('workflow v2 does not exempt proper crossings between explicit paths sharing a node', (t) => {
  const result=checkSvg(t,`
    <path data-edge-from="a" data-edge-to="b" d="M 40 100 L 150 100 L 150 20 L 220 20" class="a-default" marker-end="url(#arrowhead)"/>
    <path data-edge-from="a" data-edge-to="c" d="M 40 100 L 40 60 L 220 60 L 220 180" class="a-default" marker-end="url(#arrowhead)"/>`);
  assert.equal(result.receipt.composition.metrics.properCrossings,1);
});

test('via crossing analysis preserves real touches and the v1 shared-endpoint contract', (t) => {
  const arrow = (to, d) => `<path data-edge-from="a" data-edge-to="${to}" d="${d}" class="a-default" marker-end="url(#arrowhead)"/>`;
  const vertical = arrow('c', 'M 150 40 L 150 180');
  for (const path of [
    'M 40 100 L 150 100', // Endpoint touch.
    'M 40 100 L 150 100 L 150 180', // Real bend, not a straight-through via.
    'M 40 100 L 150 100 L 80 100 L 80 180', // Reversal.
  ]) {
    const result = checkSvg(t, arrow('b', path) + vertical);
    assert.equal(result.receipt.composition.metrics.properCrossings, 0, path);
  }
  const crossing = arrow('b', 'M 40 100 L 150 100 L 220 100') + vertical;
  const legacy = checkSvg(t, crossing, 'showcase', 'fixed-v1');
  assert.equal(legacy.receipt.composition.metrics.properCrossings, 0);
  const stale = crossing.replaceAll('class="a-default"', 'data-composition-points="20,20;60,20" class="a-default"');
  const readable = checkSvg(t, stale);
  assert.equal(readable.code, 1);
  assert.equal(readable.receipt.composition.metrics.properCrossings, 1, 'actual strokes override stale points');
});

test('compiler and artifact checks both report independent shared arrowheads', (t) => {
  const workflow = {
    schema_version:2, diagram_type:'workflow', meta:{title:'Pinned arrivals',output:'arrivals.html'},
    lanes:[{id:'top',label:'Top'},{id:'bottom',label:'Bottom'}],
    nodes:[
      {id:'a',lane:'top',col:0,type:'backend',label:'A'},
      {id:'b',lane:'top',col:1,type:'backend',label:'B'},
      {id:'c',lane:'bottom',col:2,type:'backend',label:'C'},
    ],
    edges:['a','b'].map(from=>({id:from,from,to:'c',fromSide:'bottom',toSide:'top',channelY:180,variant:from==='a'?'emphasis':'dashed'})),
  };
  const result=compileWorkflow({workflow,qualityProfile:'standard'});
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.receipt.diagnostics.filter(d=>d.code==='composition/arrowhead-collision').length,1);
  const checked=checkSvg(t,result.svg.replace(/^[\s\S]*?<svg[^>]*>/,'').replace(/<\/svg>\s*$/,''),'standard');
  assert.equal(checked.receipt.composition.metrics.arrowheadCollisions,1);
});
