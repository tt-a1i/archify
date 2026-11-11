import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { project, toExplainer, MAPPING_SHA256, sha256 } from './project.mjs';
const bytes = fs.readFileSync(new URL('./input/mapping.json', import.meta.url));
const fixture = JSON.parse(fs.readFileSync(new URL('./flows.json', import.meta.url), 'utf8'));
const fresh = () => structuredClone(fixture);

test('normal, missing-artifact and synthetic omission keep distinct test associations', () => {
  const p = project(bytes, fixture);
  assert.equal(p.testExecution, 'not-run');
  assert.equal(sha256(bytes), MAPPING_SHA256);
  assert.deepEqual(p.flows.find(f => f.id === 'delivered').steps.map(step => step.node), ['guard', 'report']);
  assert.deepEqual(p.flows.find(f => f.id === 'delivered').unassignedTests, ['regression']);
  assert.equal(p.flows.find(f => f.id === 'delivered').steps.flatMap(step => step.tests).length, 0);
  const linked = p.flows.find(f => f.id === 'missing').steps[0].tests[0];
  assert.equal(linked.test, 'regression');
  assert.equal(linked.execution, 'not-run');
  assert.equal(linked.referenceStatus, 'reference-matches');
  assert.equal(p.flows.find(f => f.id === 'missing').steps[1].tests.length, 0);
  assert.deepEqual(p.flows.find(f => f.id === 'missing').unassignedTests, []);
  assert.equal(p.flows[2].synthetic, true);
  assert.deepEqual(p.flows[2].unassignedTests, ['regression']);
});

test('step targets, linked test and original snippets remain one identity across projections', () => {
  const page = toExplainer(bytes, fixture);
  const map = JSON.parse(bytes);
  const blocks = page.panels.flatMap(panel => panel.blocks);
  const steps = blocks.find(block => block.id === 'missing-steps');
  assert.deepEqual(steps.items.map(step => step.target), [
    { diagram: 'change-path', node: 'guard' }, { diagram: 'change-path', node: 'report' }
  ]);
  assert.match(steps.items[0].detail, /\(block:source-regression\)/);
  assert.match(steps.items[0].detail, /未执行/);
  assert.match(steps.items[1].detail, /此步骤未声明测试关联/);
  for (const n of map.nodes.filter(n => ['guard', 'report', 'regression'].includes(n.id))) {
    assert.equal(blocks.find(block => block.id === `source-${n.id}`).text, n.excerpt);
    assert.ok(page.sources.find(source => source.id === `ref-${n.id}`).url.includes(map[n.ref.side]));
  }
  assert.equal(sha256(bytes), MAPPING_SHA256);
});

test('changed, missing or forged mapping references cannot inherit reused verification', () => {
  const map = JSON.parse(bytes);
  map.nodes[1].ref.start = 1;
  assert.throws(() => project(Buffer.from(JSON.stringify(map)), fixture), /digest mismatch/);
  delete map.nodes[1].ref;
  assert.throws(() => project(Buffer.from(JSON.stringify(map)), fixture), /digest mismatch/);
  assert.throws(() => project(Buffer.from('{}'), fixture), /digest mismatch/);
});

test('unknown node and non-directed path fail instead of drawing a misleading walk', () => {
  const unknown = fresh(); unknown.flows[0].path[0] = 'absent';
  assert.throws(() => project(bytes, unknown), /Unknown node/);
  const reversed = fresh(); reversed.flows[0].path.reverse();
  assert.throws(() => project(bytes, reversed), /no declared directed relationship/);
});

test('test links cannot point outside the path or invent a test result', () => {
  const bad = fresh(); bad.flows[0].testLinks[0].step = 'before-guard';
  assert.throws(() => project(bytes, bad), /step in this flow/);
  const result = fresh(); result.flows[0].testLinks[0].execution = 'passed';
  assert.throws(() => project(bytes, result), /Unsupported test link/);
  const wrongTest = fresh(); wrongTest.flows[0].testLinks[0].test = 'report';
  assert.throws(() => project(bytes, wrongTest), /known test/);
});

test('duplicate flow, step and test-link identity is rejected', () => {
  const duplicateFlow = fresh(); duplicateFlow.flows[1].id = duplicateFlow.flows[0].id;
  assert.throws(() => project(bytes, duplicateFlow), /duplicate flow/);
  const duplicateStep = fresh(); duplicateStep.flows[0].path[1] = 'guard';
  assert.throws(() => project(bytes, duplicateStep), /unique step/);
  const duplicateLink = fresh(); duplicateLink.flows[0].testLinks.push(duplicateLink.flows[0].testLinks[0]);
  assert.throws(() => project(bytes, duplicateLink), /Duplicate test association/);
});

test('an authored alternate one-step reading remains allowed without new topology', () => {
  const shorter = fresh(); const delivered = shorter.flows.find(flow => flow.id === 'delivered');
  delivered.path = ['report']; delivered.details = ['只读报告字段。'];
  assert.equal(project(bytes, shorter).flows.find(flow => flow.id === 'delivered').steps.length, 1);
});


test('a delivered-only sidecar cannot inherit missing-branch links or a three-path headline', () => {
  const single = fresh(); single.flows = single.flows.filter(flow => flow.id === 'delivered');
  const page = toExplainer(bytes, single);
  assert.match(page.answer.summary, /未执行/);
  assert.doesNotMatch(page.answer.summary, /缺产物分支关联|三条路径/);
  assert.match(page.answer.reasons[0], /1 条声明路径/);
  const steps = page.panels.flatMap(panel => panel.blocks).filter(block => block.type === 'steps');
  assert.equal(steps.length, 1);
  assert.ok(steps[0].items.every(item => item.detail.includes('此步骤未声明测试关联')));
  assert.ok(steps[0].items.every(item => !item.detail.includes('block:source-regression')));
});


test('builder refuses an occupied output directory without changing existing contents', t => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'task-flow-output-'));
  t.after(() => fs.rmSync(out, { recursive: true, force: true }));
  fs.writeFileSync(path.join(out, 'keep.txt'), 'user content');
  const run = spawnSync(process.execPath, [new URL('./build.mjs', import.meta.url).pathname, out], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.deepEqual(fs.readdirSync(out), ['keep.txt']);
  assert.equal(fs.readFileSync(path.join(out, 'keep.txt'), 'utf8'), 'user content');
});
