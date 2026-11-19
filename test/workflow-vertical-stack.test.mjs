import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compileWorkflow } from '../archify/renderers/workflow/workflow-compiler.mjs';

function workflow() {
  return {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Release gates', output: 'release.html', quality_profile: 'showcase' },
    lanes: [{ id: 'release', label: 'Release pipeline' }],
    groups: [{ id: 'gates', label: 'Review gates', lane: 'release', fromCol: 0, toCol: 0 }],
    nodes: [
      { id: 'publish', type: 'backend', lane: 'release', col: 0, label: 'Publish', height: 60 },
      { id: 'build', type: 'backend', lane: 'release', col: 0, label: 'Build' },
      { id: 'review', type: 'external', lane: 'release', col: 0, label: 'Review', tag: 'approval' },
    ],
    edges: [
      { from: 'review', to: 'publish', variant: 'emphasis' },
      { from: 'build', to: 'review', label: 'review required' },
    ],
  };
}

function compile(document) {
  const before = structuredClone(document);
  const result = compileWorkflow({ workflow: document });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(document, before);
  return result;
}

function setOffsets(document) {
  const offsets = { build: 0, review: 80, publish: 160 };
  for (const node of document.nodes) node.yOffset = offsets[node.id];
}

function numericAttribute(tag, name) {
  return Number(tag.match(new RegExp(`\\b${name}="([0-9.]+)"`))[1]);
}

function laneBounds(svg) {
  const lane = svg.match(/<rect\b[^>]+data-composition-frame-id="lane-0"[^>]*>/)[0];
  return { x: numericAttribute(lane, 'x'), width: numericAttribute(lane, 'width') };
}

test('an offset-free vertical chain leaves straight-arrow clearance for measured node heights', () => {
  const document = workflow();
  const { receipt, svg } = compile(document);
  const nodes = new Map(receipt.nodes.map(node => [node.id, node]));
  assert.match(svg, /data-reader-fit="width-first"/);
  assert.match(svg, />review required<\/text>/);
  assert.deepEqual(receipt.diagnostics, []);
  assert.equal(nodes.get('review').height, 68);
  assert.equal(nodes.get('publish').height, 60);
  const lane = laneBounds(svg);
  assert.ok(lane.width <= Math.max(...receipt.nodes.map(node => node.width)) + 120,
    'unused logical columns must not widen a one-column lane');
  for (const node of nodes.values()) assert.equal(node.x + node.width / 2, lane.x + lane.width / 2);
  for (const edge of receipt.edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    assert.equal(edge.points.length, 2);
    assert.equal(edge.points[0][0], edge.points[1][0]);
    assert.equal(edge.points[0][1], from.y + from.height);
    assert.equal(edge.points[1][1], to.y);
    assert.ok(to.y - (from.y + from.height) >= 28);
  }
  document.nodes.reverse();
  document.edges.reverse();
  assert.deepEqual(compile(document).receipt, receipt);
});

test('compact vertical chains retain authored distances and report gaps that force detours', () => {
  const document = workflow();
  setOffsets(document);
  const { receipt, svg } = compile(document);
  const nodes = [...receipt.nodes].sort((left, right) => left.y - right.y);
  const centers = nodes.map(node => node.y + node.height / 2);
  assert.deepEqual(nodes.map(node => node.id), ['build', 'review', 'publish']);
  assert.ok(nodes[0].y < 120, 'the first box starts just below the lane and group headings');
  assert.deepEqual(centers.map(center => center - centers[0]), [0, 80, 160]);
  assert.ok(receipt.edges.every(edge => edge.points.length > 2));
  assert.ok(laneBounds(svg).width >= 640, 'the grouped short-gap label retains its routing space');
  const warning = receipt.diagnostics.find(entry => entry.code === 'workflow/vertical-stack-clearance');
  assert.equal(warning.severity, 'warning');
  assert.deepEqual(warning.evidence, {
    requiredGapPx: 28,
    connections: [
      { from: 'build', to: 'review', gapPx: 20 },
      { from: 'review', to: 'publish', gapPx: 16 },
    ],
  });
  assert.match(warning.supportedFixes[0], /omit yOffset from every node/);
});

test('an explicit canvas retains lane-centered placement and supplied dimensions', () => {
  const document = workflow();
  document.meta.viewBox = [840, 640];
  setOffsets(document);
  const { receipt } = compile(document);
  assert.deepEqual(receipt.viewBox, [840, 640]);
  assert.equal(receipt.nodes.find(node => node.id === 'build').y, 250);
  assert.ok(!receipt.diagnostics.some(entry => entry.code === 'workflow/vertical-stack-clearance'));
});

test('a compact stack fits wide edge and legend labels and a nonzero column stays authored', () => {
  const document = workflow();
  const narrow = compile(document);
  document.meta.legend = {
    entries: { external: { label: 'Independent review performed by the designated release manager' } },
  };
  document.edges[1].label = 'approval, release window and publication record confirmed';
  const wide = compile(document);
  const lane = laneBounds(wide.svg);
  assert.ok(lane.width > laneBounds(narrow.svg).width);
  assert.equal(wide.receipt.viewBox[0] - lane.x - lane.width, 16);
  assert.ok(wide.receipt.nodes.every(node => node.x + node.width / 2 === lane.x + lane.width / 2));
  assert.ok(wide.receipt.edges.every(edge => edge.points.length === 2));
  assert.match(wide.svg, />Independent review performed by the designated release manager<\/text>/);
  assert.match(wide.svg, />approval, release window and publication record confirmed<\/text>/);

  for (const node of document.nodes) node.col = 3;
  document.groups[0].fromCol = 3;
  document.groups[0].toCol = 3;
  const authored = compile(document);
  assert.ok(laneBounds(authored.svg).width >= 640);
  assert.ok(authored.receipt.nodes.every(node => node.x + node.width / 2 === 454));
});

test('automatic stack gaps leave the rendered arrowheads and stems clear of label masks', () => {
  const document = workflow();
  document.groups = [];
  document.nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => ({
    id, type: 'backend', lane: 'release', col: 0, label: `Stage ${index + 1}`,
  }));
  document.edges = [
    { id: 'ab', from: 'a', to: 'b', label: 'Review requested' },
    { id: 'bc', from: 'b', to: 'c', variant: 'emphasis', label: 'Approved' },
    { id: 'cd', from: 'c', to: 'd', variant: 'dashed', label: 'Signed' },
    { id: 'de', from: 'd', to: 'e', width: 4 },
    { id: 'ef', from: 'e', to: 'f', variant: 'security', width: 3, label: 'Protected' },
  ];
  const { receipt, svg } = compile(document);
  const emittedPaths = [...svg.matchAll(/<path\b[^>]+ data-edge-id="([^"]+)"[^>]*>/g)];
  const emittedLabels = [...svg.matchAll(/<g\b[^>]+ data-edge-id="([^"]+)"[^>]*>\s*(<rect[^>]+>)/g)];
  const markers = [...svg.matchAll(/<marker\b[^>]* id="([^"]+)"[^>]*>/g)];
  assert.equal(emittedPaths.length, document.edges.length);
  assert.equal(emittedLabels.length, 4);
  for (const edge of receipt.edges) {
    const [start, end] = edge.points;
    assert.equal(edge.points.length, 2);
    assert.equal(start[0], end[0]);
    const path = emittedPaths.find(([, id]) => id === edge.id)[0];
    const markerId = path.match(/marker-end="url\(#([^)]*)\)"/)[1];
    const marker = markers.find(([, id]) => id === markerId)[0];
    const headStart = end[1] - numericAttribute(marker, 'refX') * numericAttribute(path, 'stroke-width');
    const labelRect = emittedLabels.find(([, id]) => id === edge.id)?.[2];
    if (labelRect) {
      const labelTop = numericAttribute(labelRect, 'y');
      const labelBottom = labelTop + numericAttribute(labelRect, 'height');
      assert.ok(labelTop - start[1] >= 8, `${edge.id}: clear stem above label`);
      assert.ok(headStart - labelBottom >= 1, `${edge.id}: label must leave the arrowhead visible`);
    } else {
      assert.ok(headStart - start[1] >= 8, `${edge.id}: wide arrowhead leaves a stem`);
    }
  }
});

test('centering keeps the narrower established footprint when a group heading dominates', () => {
  for (const repetitions of [2, 3]) {
    const document = workflow();
    document.nodes = document.nodes.filter(node => node.id !== 'publish');
    document.nodes.find(node => node.id === 'build').yOffset = -45;
    document.nodes.find(node => node.id === 'review').yOffset = 45;
    document.groups[0].label = 'Confirm authorization and prepare promotion to the production release environment. '
      .repeat(repetitions).trim();
    document.edges = [{ from: 'build', to: 'review' }];
    const automatic = compile(document).receipt;

    // An explicit source side selects the established rank geometry and
    // uses the same natural facing port as the automatic straight edge.
    document.edges[0].fromSide = 'bottom';
    const established = compile(document).receipt;
    assert.equal(automatic.viewBox[0], established.viewBox[0]);
    assert.deepEqual(automatic.nodes.map(({ x, width }) => [x, width]),
      established.nodes.map(({ x, width }) => [x, width]));
    assert.ok(automatic.edges.every(edge => edge.points.length === 2));
  }
});
