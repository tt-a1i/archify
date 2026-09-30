import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { compileWorkflow } from '../renderers/workflow/workflow-compiler.mjs';
import { typographyFixture, runWorkflow, svgFacts } from './helpers/workflow-typography.mjs';

const baselineFingerprints = JSON.parse(fs.readFileSync(new URL('./fixtures/workflow-typography/baseline-svg-sha256.json', import.meta.url), 'utf8'));
const svgHash = svg => createHash('sha256').update(svg.replace(/\r\n?/g, '\n')).digest('hex');

for (const name of ['ordinary', 'dense', 'cjk']) {
  test(`omitted and explicit typography_scale 1 preserve identical HTML: ${name}`, t => {
    const doc = typographyFixture(name);
    const baseline = runWorkflow(t, doc);
    assert.equal(baseline.status, 0, baseline.stderr);
    doc.meta.typography_scale = 1;
    const explicit = runWorkflow(t, doc);
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.equal(explicit.html, baseline.html);
  });
}

for (const [name, scale] of [['ordinary', 1.5], ['ordinary', 2], ['dense', 1.5], ['cjk', 1.5]]) {
  test(`scaled text participates in layout without losing content: ${name}/${scale}`, t => {
    const doc = typographyFixture(name);
    const baseline = runWorkflow(t, doc);
    assert.equal(baseline.status, 0, baseline.stderr);
    const before = svgFacts(baseline.svg);
    doc.meta.typography_scale = scale;
    const scaled = runWorkflow(t, doc);
    assert.equal(scaled.status, 0, scaled.stderr);
    const after = svgFacts(scaled.svg);
    assert.deepEqual(after.texts.map(item => item.text), before.texts.map(item => item.text), '不能删文案或换成省略号');
    for (const [index, item] of after.texts.entries()) {
      assert.ok(item.font >= before.texts[index].font * scale - 0.15, `${item.text}: ${before.texts[index].font} -> ${item.font}`);
    }
    assert.deepEqual(after.nodes.map(node => node.id), before.nodes.map(node => node.id));
    for (const [index, node] of after.nodes.entries()) {
      assert.ok(node.width >= before.nodes[index].width);
      assert.ok(node.height > before.nodes[index].height, `节点 ${node.id} 需要容纳放大的三行文字`);
    }
    assert.ok(after.masks.every((mask, index) => mask.width > before.masks[index].width && mask.height > before.masks[index].height));
    const validation = runWorkflow(t, doc, 'validate');
    assert.equal(validation.status, 0, JSON.stringify(validation.receipt));
    assert.equal(validation.receipt.ok, true);
    if (name === 'dense') {
      const baselineDoc = structuredClone(doc);
      delete baselineDoc.meta.typography_scale;
      const original = runWorkflow(t, baselineDoc, 'validate').receipt.composition.desktopReadability;
      const improved = validation.receipt.composition.desktopReadability;
      assert.ok(original.minimumProjectedTextPx < 9);
      assert.ok(improved.minimumProjectedTextPx >= 9);
      assert.equal(improved.actualBudgetPx, original.actualBudgetPx);
      assert.equal(improved.hardFloorPx, original.hardFloorPx);
    }
  });
}

for (const value of [0.99, 2.01, '1.5', null]) {
  test(`schema rejects an invalid typography_scale: ${JSON.stringify(value)}`, t => {
    const doc = typographyFixture('ordinary');
    doc.meta.typography_scale = value;
    const result = runWorkflow(t, doc, 'validate');
    assert.equal(result.status, 1);
    assert.ok(result.receipt.diagnostics.some(issue => issue.code.startsWith('schema/')));
  });
}

test('v1 rejects the new typography option without implicit migration', t => {
  const doc = typographyFixture('ordinary');
  doc.schema_version = 1;
  doc.meta.typography_scale = 1;
  const result = runWorkflow(t, doc, 'validate');
  assert.equal(result.status, 1);
  assert.ok(result.receipt.diagnostics.some(issue => issue.code.startsWith('schema/')));
});

test('omitted configuration preserves frozen ordinary, dense, CJK and v1 SVG output', t => {
  const legacy = JSON.parse(fs.readFileSync(new URL('./fixtures/v1-baseline/agent-tool-call.workflow.json', import.meta.url), 'utf8'));
  for (const [name, doc] of [['ordinary', typographyFixture('ordinary')], ['dense', typographyFixture('dense')],
    ['cjk', typographyFixture('cjk')], ['v1', legacy]]) {
    const result = runWorkflow(t, doc);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(svgHash(result.svg), baselineFingerprints.svgSha256[name], `${name}: 与 ${baselineFingerprints.baseCommit} 的基线几何不同`);
  }
});

test('undersized authored nodes fail instead of silently growing', t => {
  const doc = typographyFixture('ordinary');
  doc.meta.typography_scale = 2;
  doc.nodes[0].width = 92;
  doc.nodes[0].height = 68;
  const result = runWorkflow(t, doc, 'validate');
  assert.equal(result.status, 1);
  const issue = result.receipt.diagnostics.find(item => item.code === 'workflow/typography-capacity');
  assert.ok(issue, JSON.stringify(result.receipt));
  assert.ok(issue.supportedFixes.length > 0);
  assert.equal(issue.subject.node, 'receive');
  assert.equal(issue.subject.path, '/nodes/0');
  doc.nodes[0].width = issue.evidence.requiredWidth;
  doc.nodes[0].height = issue.evidence.requiredHeight;
  const repaired = runWorkflow(t, doc, 'validate');
  assert.equal(repaired.status, 0, JSON.stringify(repaired.receipt));
});

test('an authored viewBox that cannot contain scaled content stays authoritative', t => {
  const doc = typographyFixture('dense');
  doc.meta.typography_scale = 1.5;
  doc.meta.viewBox = [1000, 450];
  const result = runWorkflow(t, doc, 'validate');
  assert.equal(result.status, 1);
  const issue = result.receipt.diagnostics.find(item => item.code === 'workflow/viewbox-capacity');
  assert.ok(issue, JSON.stringify(result.receipt));
  assert.ok(issue.supportedFixes.length > 0);
  assert.deepEqual(doc.meta.viewBox, [1000, 450]);
});

test('sufficient authored node dimensions and canvas dimensions are preserved', t => {
  const doc = typographyFixture('ordinary');
  doc.meta.typography_scale = 1.5;
  doc.meta.viewBox = [1200, 600];
  for (const node of doc.nodes) Object.assign(node, { width: 180, height: 120 });
  const result = runWorkflow(t, doc);
  assert.equal(result.status, 0, result.stderr);
  const facts = svgFacts(result.svg);
  assert.deepEqual(facts.viewBox, [0, 0, 1200, 600]);
  assert.ok(facts.nodes.every(node => node.width === 180 && node.height === 120));
  const validation = runWorkflow(t, doc, 'validate');
  assert.equal(validation.status, 0, JSON.stringify(validation.receipt));
});

test('a compact authored label-only node is accepted when its actual text fits', t => {
  const doc = typographyFixture('ordinary');
  doc.meta.typography_scale = 1.5;
  doc.groups = [];
  doc.phases = [];
  doc.nodes = doc.nodes.slice(0, 2).map(node => ({
    id: node.id, type: node.type, lane: node.lane, col: node.col,
    label: 'Hi', width: 100, height: 60,
  }));
  doc.edges = [{ id: 'next', from: 'receive', to: 'validate' }];
  const result = runWorkflow(t, doc);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(svgFacts(result.svg).nodes.every(node => node.width === 100 && node.height === 60));
  const validation = runWorkflow(t, doc, 'validate');
  assert.equal(validation.status, 0, JSON.stringify(validation.receipt));
});

test('caption and tag collisions in a short authored node remain capacity errors', t => {
  const doc = typographyFixture('ordinary');
  doc.meta.typography_scale = 1.5;
  Object.assign(doc.nodes[0], { width: 200, height: 60 });
  const result = runWorkflow(t, doc, 'validate');
  assert.equal(result.status, 1);
  const issue = result.receipt.diagnostics.find(item => item.code === 'workflow/typography-capacity');
  assert.ok(issue, JSON.stringify(result.receipt));
  assert.equal(issue.subject.node, 'receive');
  assert.ok(issue.evidence.requiredHeight > 60);
  assert.ok(issue.supportedFixes.length > 0);
});

test('absolute via and labelAt controls remain at their authored positions', t => {
  const doc = typographyFixture('ordinary');
  doc.meta.typography_scale = 1.5;
  doc.meta.viewBox = [1200, 600];
  doc.nodes = doc.nodes.slice(0, 2).map(node => ({ ...node, width: 180, height: 120 }));
  doc.edges = doc.edges.slice(0, 1);
  doc.groups = [];
  doc.phases = [{ id: 'header', label: 'Inventory reconciliation and audit acceptance', fromCol: 0, toCol: 1 }];
  const automatic = runWorkflow(t, doc);
  assert.equal(automatic.status, 0, automatic.stderr);
  const before = svgFacts(automatic.svg);
  const [start, end] = before.routes[0].points;
  assert.equal(before.routes[0].points.length, 2);
  const via = [[start[0] + 24, start[1]], [start[0] + 24, start[1] + 24],
    [end[0] - 24, end[1] + 24], [end[0] - 24, end[1]]];
  const labelAt = before.masks[0].labelAt;
  Object.assign(doc.edges[0], { fromSide: 'right', toSide: 'left', via, labelAt });
  const pinned = runWorkflow(t, doc);
  assert.equal(pinned.status, 0, pinned.stderr);
  const after = svgFacts(pinned.svg);
  assert.deepEqual(after.routes[0].points, [start, ...via, end]);
  assert.deepEqual(after.masks[0].labelAt, labelAt);
  assert.deepEqual(after.nodes, before.nodes);
});

for (const channel of ['channelX', 'channelY']) {
  test(`scaled workflows preserve the absolute ${channel} coordinate`, t => {
    const doc = typographyFixture('ordinary');
    doc.meta.typography_scale = 1.5;
    doc.meta.viewBox = [1200, 700];
    doc.groups = [];
    doc.phases = [];
    doc.nodes = doc.nodes.slice(0, 2).map(node => ({ ...node, width: 180, height: 120 }));
    doc.edges = [{ id: 'pinned', from: 'receive', to: 'validate' }];
    if (channel === 'channelX') {
      doc.lanes.push({ id: 'storage', label: 'Storage' });
      Object.assign(doc.nodes[1], { lane: 'storage', col: 0 });
    }
    const automatic = runWorkflow(t, doc);
    assert.equal(automatic.status, 0, automatic.stderr);
    const before = svgFacts(automatic.svg);
    const value = channel === 'channelX'
      ? Math.max(...before.nodes.map(node => node.x + node.width)) + 40
      : Math.max(...before.nodes.map(node => node.y + node.height)) + 24;
    Object.assign(doc.edges[0], channel === 'channelX'
      ? { fromSide: 'right', toSide: 'right', route: 'outside-right', channelX: value }
      : { fromSide: 'bottom', toSide: 'bottom', route: 'bottom-channel', channelY: value });
    const result = runWorkflow(t, doc);
    assert.equal(result.status, 0, result.stderr);
    const after = svgFacts(result.svg);
    const interior = after.routes[0].points.slice(1, -1);
    assert.ok(interior.length > 0);
    assert.ok(interior.every(point => point[channel === 'channelX' ? 0 : 1] === value));
    // col 是逻辑序号；改变路径可改变列间约束，但不能修改作者的尺寸或绝对通道。
    const dimensions = nodes => nodes.map(({ id, width, height }) => ({ id, width, height }));
    assert.deepEqual(dimensions(after.nodes), dimensions(before.nodes));
    assert.deepEqual(after.viewBox, [0, 0, 1200, 700]);
  });
}

test('layout receipts report rendered fonts without mutating the authored input', () => {
  const doc = typographyFixture('ordinary');
  const baseline = compileWorkflow({ workflow: doc });
  assert.equal(baseline.ok, true);
  assert.equal(baseline.receipt.typography, undefined);
  doc.meta.typography_scale = 1.5;
  const snapshot = structuredClone(doc);
  const result = compileWorkflow({ workflow: doc });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(doc, snapshot);
  assert.equal(result.receipt.typography.scale, 1.5);
  const textFonts = new Map(svgFacts(result.svg).texts.map(text => [text.text, text.font]));
  for (const node of doc.nodes) {
    const measured = result.receipt.typography.nodes.find(item => item.id === node.id);
    for (const field of ['label', 'sublabel', 'tag']) {
      assert.equal(measured[field], textFonts.get(node[field]));
    }
  }
});
