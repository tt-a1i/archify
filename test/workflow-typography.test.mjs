import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';
import { typographyFixture, runWorkflow, svgFacts, sourceTypographyFixture, sourceEvidencePayload } from './helpers/workflow-typography.mjs';

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

function assertSourceRetained(rendered, fixture, diagram) {
  const evidence = sourceEvidencePayload(rendered.html);
  const sourcedNodes = diagram.nodes.filter(node => node.sources?.length);
  assert.equal(evidence.verified, true);
  assert.equal(evidence.referenceCount, sourcedNodes.reduce((count, node) => count + node.sources.length, 0));
  assert.equal(evidence.repository.revision, fixture.revision);
  assert.deepEqual(Object.keys(evidence.nodes).sort(), sourcedNodes.map(node => node.id).sort());
  for (const node of sourcedNodes) {
    assert.equal(evidence.nodes[node.id][0].href, `${fixture.url}/blob/${fixture.revision}/source.js#L1`);
  }
  const facts = svgFacts(rendered.svg);
  const texts = facts.texts.map(text => text.text);
  for (const node of diagram.nodes) {
    for (const field of ['label', 'sublabel', 'tag']) {
      if (node[field]) assert.ok(texts.includes(node[field]), `${node.id}/${field} must be retained`);
    }
  }
  assert.deepEqual(facts.nodes.map(node => node.id).sort(), diagram.nodes.map(node => node.id).sort());
  assert.deepEqual(JSON.parse(fs.readFileSync(rendered.input, 'utf8')), diagram, 'CLI must not rewrite the authored input');
  return facts;
}

for (const fixtureCase of [
  { name: 'source-only 1.01', scale: 1.01 },
  { name: 'source and brand 1.1', scale: 1.1, node: { brand: 'openai' } },
  { name: 'source and tag 1.5', scale: 1.5, node: { tag: 'verified' }, quality: 'standard' },
  { name: 'source, brand and tag 2', scale: 2, node: { brand: 'openai', tag: 'verified' } },
]) {
  test(`source-backed automatic typography validates and renders: ${fixtureCase.name}`, t => {
    const fixture = sourceTypographyFixture(t, fixtureCase);
    const snapshot = structuredClone(fixture.diagram);
    const options = { repoRoot: fixture.root, quality: fixtureCase.quality };
    const validation = runWorkflow(t, fixture.diagram, 'validate', options);
    assert.equal(validation.status, 0, validation.stdout + validation.stderr);
    assert.equal(validation.receipt.ok, true);
    const rendered = runWorkflow(t, fixture.diagram, 'render', options);
    assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
    assertSourceRetained(rendered, fixture, snapshot);
    assert.deepEqual(fixture.diagram, snapshot);
    assert.equal(Object.hasOwn(fixture.diagram.nodes[0], 'width'), false);
    assert.equal(Object.hasOwn(fixture.diagram.nodes[0], 'height'), false);
  });
}

for (const fixtureCase of [
  { name: 'source-only', scale: 1.01, node: { width: 92, height: 53 }, requiredHeight: 54 },
  { name: 'source and brand', scale: 1.1, node: { brand: 'openai', width: 136, height: 59 }, requiredHeight: 60, reverseAuthoredOrder: true },
]) {
  test(`source-backed repair verification keeps other authored source constraints: ${fixtureCase.name}`, t => {
    const fixture = sourceTypographyFixture(t, fixtureCase);
    fixture.diagram.nodes.push({ ...structuredClone(fixture.diagram.nodes[0]), id: 'record', col: 2 });
    if (fixtureCase.reverseAuthoredOrder) fixture.diagram.nodes.reverse();
    const snapshot = structuredClone(fixture.diagram);
    const options = { repoRoot: fixture.root };
    const failure = runWorkflow(t, fixture.diagram, 'validate', options);
    assert.equal(failure.status, 1, failure.stdout + failure.stderr);
    const diagnostic = failure.receipt.diagnostics.find(issue => issue.code === 'workflow/typography-capacity');
    assert.ok(diagnostic, failure.stdout);
    const failingIndex = fixture.diagram.nodes.findIndex(node => node.id === diagnostic.subject.node);
    assert.ok(failingIndex >= 0);
    assert.equal(diagnostic.subject.path, `/nodes/${failingIndex}`);
    // 源码或品牌信息丢失会降低探测中的所需高度，单独修一个却仍不能通过真实整图验证。
    // 两个节点都有显式高度，所以自动尺寸修复不能掩盖这个来源上下文回归。
    assert.deepEqual(diagnostic.supportedFixes, [], 'do not advertise a one-node repair while another authored source box still fails');
    const otherId = fixture.diagram.nodes.find(node => node.id !== diagnostic.subject.node).id;
    const oneRemaining = structuredClone(fixture.diagram);
    oneRemaining.nodes.find(node => node.id === otherId).height = fixtureCase.requiredHeight;
    const remaining = runWorkflow(t, oneRemaining, 'validate', options);
    assert.equal(remaining.status, 1, remaining.stdout + remaining.stderr);
    const actionable = remaining.receipt.diagnostics.find(issue => issue.code === 'workflow/typography-capacity');
    assert.ok(actionable?.supportedFixes.length, remaining.stdout);
    assert.deepEqual(actionable.subject, diagnostic.subject, 'diagnostic indexes must still name the authored node');
    for (const suggestion of actionable.supportedFixes) {
      const repaired = applyTypographyRepair(oneRemaining, suggestion);
      assert.equal(repaired.nodes.find(node => node.id === otherId).height, fixtureCase.requiredHeight, 'repair must preserve the other authored box');
      const validated = runWorkflow(t, repaired, 'validate', options);
      assert.equal(validated.status, 0, `${suggestion}\n${validated.stdout}\n${validated.stderr}`);
      const rendered = runWorkflow(t, repaired, 'render', options);
      assert.equal(rendered.status, 0, `${suggestion}\n${rendered.stdout}\n${rendered.stderr}`);
      assertSourceRetained(rendered, fixture, repaired);
    }
    assert.deepEqual(fixture.diagram, snapshot);
    assert.deepEqual(JSON.parse(fs.readFileSync(failure.input, 'utf8')), snapshot);
  });
}

test('source-backed automatic height participates in offset lane planning', t => {
  const fixture = sourceTypographyFixture(t, { scale: 1.01, node: { yOffset: 30 } });
  const snapshot = structuredClone(fixture.diagram);
  const options = { repoRoot: fixture.root };
  const rendered = runWorkflow(t, fixture.diagram, 'render', options);
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
  const facts = assertSourceRetained(rendered, fixture, snapshot);
  const layout = runWorkflow(t, fixture.diagram, 'validate', { ...options, layoutJson: true });
  assert.equal(layout.status, 0, layout.stdout + layout.stderr);
  assert.deepEqual(layout.receipt.viewBox, facts.viewBox.slice(2));
  const rectangle = ({ id, x, y, width, height }) => ({ id, x, y, width, height });
  assert.deepEqual(layout.receipt.nodes.map(rectangle), facts.nodes.map(rectangle));
  const pinned = structuredClone(fixture.diagram);
  pinned.nodes[0].height = facts.nodes[0].height;
  const explicit = runWorkflow(t, pinned, 'render', options);
  assert.equal(explicit.status, 0, explicit.stdout + explicit.stderr);
  // 显式写回已经测得的同一高度，不应再改变泳道、节点位置或画布。
  assert.equal(explicit.svg, rendered.svg, 'planning must use the same automatic height that SVG serialization uses');
  assert.deepEqual(fixture.diagram, snapshot);
});

test('source-backed omitted and scale-one typography preserve identical HTML', t => {
  const fixture = sourceTypographyFixture(t);
  fixture.diagram.nodes.push({ ...structuredClone(fixture.diagram.nodes[0]), id: 'branded', col: 1,
    brand: 'openai', tag: 'verified', width: 140, height: 80 });
  const options = { repoRoot: fixture.root };
  const omitted = runWorkflow(t, fixture.diagram, 'render', options);
  assert.equal(omitted.status, 0, omitted.stdout + omitted.stderr);
  const explicit = structuredClone(fixture.diagram);
  explicit.meta.typography_scale = 1;
  const scaled = runWorkflow(t, explicit, 'render', options);
  assert.equal(scaled.status, 0, scaled.stdout + scaled.stderr);
  assert.equal(scaled.html, omitted.html);
  const facts = assertSourceRetained(scaled, fixture, explicit);
  const automatic = facts.nodes.find(node => node.id === 'process');
  assert.deepEqual([automatic.width, automatic.height], [92, 52], 'default source-backed automatic geometry remains unchanged');
});

for (const fixtureCase of [
  { name: 'authored width with automatic height', scale: 1.01, node: { width: 92 } },
  { name: 'authored height with automatic branded width', scale: 1.1, node: { brand: 'openai', height: 80 } },
  { name: 'both authored dimensions with brand and tag', scale: 1.5, node: { brand: 'openai', tag: 'verified', width: 260, height: 140 }, viewBox: [1100, 600] },
]) {
  test(`source-backed typography preserves ${fixtureCase.name}`, t => {
    const fixture = sourceTypographyFixture(t, fixtureCase);
    if (fixtureCase.viewBox) fixture.diagram.meta.viewBox = fixtureCase.viewBox;
    const snapshot = structuredClone(fixture.diagram);
    const options = { repoRoot: fixture.root };
    const validation = runWorkflow(t, fixture.diagram, 'validate', options);
    assert.equal(validation.status, 0, validation.stdout + validation.stderr);
    const rendered = runWorkflow(t, fixture.diagram, 'render', options);
    assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
    const facts = assertSourceRetained(rendered, fixture, snapshot);
    for (const dimension of ['width', 'height']) {
      if (Object.hasOwn(fixtureCase.node, dimension)) assert.equal(facts.nodes[0][dimension], fixtureCase.node[dimension]);
    }
    if (fixtureCase.viewBox) assert.deepEqual(facts.viewBox, [0, 0, ...fixtureCase.viewBox]);
    assert.deepEqual(fixture.diagram, snapshot);
  });
}

function applyTypographyRepair(diagram, suggestion) {
  const candidate = structuredClone(diagram);
  const set = suggestion.match(/^set \/nodes\/(\d+)\/width to ([\d.]+) and \/nodes\/\1\/height to ([\d.]+)$/);
  const remove = suggestion.match(/^remove \/nodes\/(\d+)\/width and \/nodes\/\1\/height to use measured automatic dimensions$/);
  assert.ok(set || remove, `Unrecognized public typography repair: ${suggestion}`);
  if (set) Object.assign(candidate.nodes[Number(set[1])], { width: Number(set[2]), height: Number(set[3]) });
  else {
    const node = candidate.nodes[Number(remove[1])];
    assert.ok(Object.hasOwn(node, 'width') || Object.hasOwn(node, 'height'), 'deletion must change an authored field');
    delete node.width;
    delete node.height;
  }
  return candidate;
}

for (const fixtureCase of [
  { name: 'source-only', scale: 1.01, node: { width: 92, height: 40 } },
  { name: 'source and brand', scale: 1.1, node: { brand: 'openai', height: 40 } },
]) {
  test(`every typography repair replays with verified source context: ${fixtureCase.name}`, t => {
    const fixture = sourceTypographyFixture(t, fixtureCase);
    const snapshot = structuredClone(fixture.diagram);
    const options = { repoRoot: fixture.root };
    const failure = runWorkflow(t, fixture.diagram, 'validate', options);
    assert.equal(failure.status, 1, failure.stdout + failure.stderr);
    const diagnostic = failure.receipt.diagnostics.find(issue => issue.code === 'workflow/typography-capacity');
    assert.ok(diagnostic, failure.stdout);
    assert.equal(diagnostic.subject.node, 'process');
    assert.equal(diagnostic.evidence.height, 40, 'an explicit failing height must not be silently grown');
    assert.ok(diagnostic.supportedFixes.length > 0, failure.stdout);
    for (const suggestion of diagnostic.supportedFixes) {
      const repaired = applyTypographyRepair(fixture.diagram, suggestion);
      assert.deepEqual(repaired.meta, fixture.diagram.meta, 'repair must preserve repository/scale metadata');
      assert.deepEqual(repaired.nodes[0].sources, fixture.diagram.nodes[0].sources);
      const validation = runWorkflow(t, repaired, 'validate', options);
      assert.equal(validation.status, 0, `${suggestion}\n${validation.stdout}\n${validation.stderr}`);
      const rendered = runWorkflow(t, repaired, 'render', options);
      assert.equal(rendered.status, 0, `${suggestion}\n${rendered.stdout}\n${rendered.stderr}`);
      assertSourceRetained(rendered, fixture, repaired);
    }
    assert.deepEqual(fixture.diagram, snapshot);
    assert.deepEqual(JSON.parse(fs.readFileSync(failure.input, 'utf8')), snapshot);
  });
}
