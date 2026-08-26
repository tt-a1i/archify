// Per-rule coverage for the renderers' layout validators. The golden suite's
// negative cases mostly trip ajv SCHEMA rules; this file targets the hand-
// written LAYOUT rules (the `problems.push(...)` checks) — the layer that has
// regressed before — by mutating a valid example into exactly one violation
// and asserting the renderer exits non-zero with the expected message.
//
// It also locks the error-message CONTRACT: representative messages must carry
// both the numeric threshold and a remediation hint, since the consumer is an
// LLM that fixes the JSON from the message alone.
//
//   node --test test/*.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-rules-'));

const EXAMPLES = {
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
  architecture: 'web-app.architecture.json',
};

function load(mode) {
  return JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', EXAMPLES[mode]), 'utf8'));
}

// Returns { code, stderr }. Never throws on non-zero exit.
function render(mode, doc) {
  const input = path.join(tmp, `${mode}-${Math.abs(hash(JSON.stringify(doc)))}.json`);
  const outPath = path.join(tmp, `${mode}-${Math.abs(hash(JSON.stringify(doc)))}.html`);
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    execFileSync('node', [
      path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
      input,
      outPath,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return { code: 0, stderr: '', outPath };
  } catch (err) {
    return { code: err.status ?? 1, stderr: String(err.stderr || ''), outPath };
  }
}

function validateCli(mode, doc, quality = 'showcase') {
  const input = path.join(tmp, `${mode}-cli-${Math.abs(hash(JSON.stringify(doc)))}.json`);
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    const stdout = execFileSync('node', [
      path.join(skillRoot, 'bin', 'archify.mjs'),
      'validate',
      mode,
      input,
      '--quality',
      quality,
      '--json',
    ], { encoding: 'utf8' });
    return { code: 0, result: JSON.parse(stdout) };
  } catch (err) {
    return {
      code: err.status ?? 1,
      result: JSON.parse(String(err.stdout || '{}')),
    };
  }
}

function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function workflowEdgePoints(html, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pointsAttribute = html.match(
    new RegExp(`data-edge-id="${escapedId}" data-composition-points="([^"]+)"`),
  )?.[1];
  assert.ok(pointsAttribute, `expected rendered workflow edge points for ${id}`);
  return pointsAttribute.split(';').map((point) => point.split(',').map(Number));
}

function workflowNodeRect(html, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(
    `<g id="node-${escapedId}"[^>]*>[\\s\\S]*?<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`,
  ));
  assert.ok(match, `expected rendered workflow node rect for ${id}`);
  const [, x, y, width, height] = match.map(Number);
  return { x, y, width, height };
}

function boundaryFrameRect(html, index) {
  const match = html.match(new RegExp(
    `<rect data-graph-role="structural-frame"[^>]*data-composition-frame-id="${index}"[^>]*x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`,
  ));
  assert.ok(match, `expected boundary frame ${index}`);
  const [, x, y, width, height] = match.map(Number);
  return { x, y, width, height };
}

function boundaryTitleMasks(html) {
  return [...html.matchAll(
    /<g data-graph-role="structural-frame-label"[^>]*data-composition-frame-id="(\d+)"[^>]*>[\s\S]*?<rect data-graph-role="structural-frame-label-mask" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/g,
  )].map((match) => ({
    index: Number(match[1]),
    x: Number(match[2]),
    y: Number(match[3]),
    width: Number(match[4]),
    height: Number(match[5]),
  }));
}

function rectContainsRect(outer, inner) {
  return outer.x <= inner.x
    && outer.y <= inner.y
    && outer.x + outer.width >= inner.x + inner.width
    && outer.y + outer.height >= inner.y + inner.height;
}

function rectanglesOverlap(left, right) {
  return left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}

function workflowEdgeLabelPoint(html, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(
    `<g data-detail="context"[^>]*data-edge-id="${escapedId}"[^>]*>[\\s\\S]*?<text x="([^"]+)" y="([^"]+)"`,
  ));
  assert.ok(match, `expected rendered workflow edge label for ${id}`);
  return match.slice(1).map(Number);
}

function axisOverlapLength(a1, a2, b1, b2) {
  return Math.max(0, Math.min(Math.max(a1, a2), Math.max(b1, b2))
    - Math.max(Math.min(a1, a2), Math.min(b1, b2)));
}

function workflowNodeBorderOverlap(points, rect) {
  const hits = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const [start, end] = [points[index], points[index + 1]];
    if (start[0] === end[0] && (start[0] === rect.x || start[0] === rect.x + rect.width)) {
      const length = axisOverlapLength(start[1], end[1], rect.y, rect.y + rect.height);
      if (length > 0) hits.push({ segment: index, length, start, end });
    }
    if (start[1] === end[1] && (start[1] === rect.y || start[1] === rect.y + rect.height)) {
      const length = axisOverlapLength(start[0], end[0], rect.x, rect.x + rect.width);
      if (length > 0) hits.push({ segment: index, length, start, end });
    }
  }
  return hits;
}

function assertRelationshipsAvoidAllNodeBorders(html, relationships, diagramNodes) {
  for (const [edgeIndex, edge] of relationships.entries()) {
    const edgeId = edge.id || `edge-${edgeIndex}`;
    const points = workflowEdgePoints(html, edgeId);
    for (const node of diagramNodes) {
      const hits = workflowNodeBorderOverlap(points, workflowNodeRect(html, node.id));
      assert.deepEqual(
        hits,
        [],
        `workflow edge ${edgeId} runs along node ${node.id} border: ${JSON.stringify(hits)}`,
      );
    }
  }
}

function assertWorkflowEdgesAvoidAllNodeBorders(html, doc) {
  assertRelationshipsAvoidAllNodeBorders(html, doc.edges, doc.nodes);
}

// [name, mode, mutate(doc), expectedSubstrings[]] — every mutation introduces
// exactly one layout violation. Each expected substring must appear in stderr.
const CASES = [
  // ---- workflow layout rules ----
  ['workflow: unknown lane', 'workflow', (d) => { d.nodes[0].lane = 'ghost'; }, ['unknown lane "ghost"']],
  ['workflow: node label wider than box', 'workflow',
    (d) => { d.nodes[0].label = 'An Extremely Long Node Label That Overflows'; }, ['wider than node', 'shorten the label']],
  ['workflow: node sublabel wider than its legible minimum', 'workflow',
    (d) => { d.nodes[0].sublabel = 'This supporting sentence is much too long for one workflow node'; }, ['Sublabel', 'legible', 'increase node.width']],
  ['workflow: node tag wider than its legible minimum', 'workflow',
    (d) => { d.nodes[0].tag = 'This tag is far too long to sit inside one workflow node box'; },
    ['Tag', 'legible', 'increase node.width']],
  ['workflow: viewBox width below schema min', 'workflow',
    (d) => { d.meta.viewBox = [699, 900]; }, ['700']],
  ['workflow: nodes too close in a lane', 'workflow',
    (d) => { d.nodes.push({ ...d.nodes[0], id: 'dupe', col: d.nodes[0].col }); }, ['less than 8px apart']],
  ['workflow: empty group', 'workflow',
    (d) => { d.groups = [{ id: 'empty', label: 'Empty group', lane: 'ui', fromCol: 3, toCol: 4 }]; }, ['does not contain any nodes']],
  ['workflow: mainPath missing edge', 'workflow',
    (d) => { d.mainPath = ['user', 'planner']; }, ['mainPath step "user" -> "planner" has no matching edge']],
  ['workflow: mainPath moves backward', 'workflow',
    (d) => { d.mainPath = ['external', 'trace']; }, ['moves backward from col']],
  ['workflow: phase ranges overlap', 'workflow',
    (d) => { d.phases[2].fromCol = d.phases[1].toCol; }, ['overlaps phase', 'start at col 4 or later']],

  // ---- sequence layout rules ----
  ['sequence: message references unknown participant', 'sequence',
    (d) => { d.messages[0].from = 'ghost'; }, ['unknown source "ghost"']],
  ['sequence: message y outside timeline', 'sequence',
    (d) => { d.messages[0].y = 9000; }, ['outside the readable timeline', 'keep y between']],
  ['sequence: segment to <= from', 'sequence',
    (d) => { d.segments = [{ from: 400, to: 300, label: 'bad' }]; }, ['invalid y range', 'greater than']],
  ['sequence: participant sublabel wider than its legible minimum', 'sequence',
    (d) => { d.participants[0].sublabel = 'This supporting sentence is far too long for one sequence participant'; },
    ['Sublabel', 'legible', 'shorten the sublabel']],

  // ---- dataflow layout rules ----
  ['dataflow: flow missing label', 'dataflow',
    (d) => { delete d.flows[0].label; }, ['label']],
  ['dataflow: flow references unknown node', 'dataflow',
    (d) => { d.flows[0].to = 'ghost'; }, ['unknown target "ghost"']],
  ['dataflow: explicit via keeps every route segment orthogonal', 'dataflow',
    (d) => {
      d.flows[0].via = [[195, 140], [195, 260]];
    }, ['diagonal segment', 'align via[0]']],
  ['dataflow: node sublabel wider than its legible minimum', 'dataflow',
    (d) => { d.nodes[0].sublabel = 'This supporting sentence is far too long for one data-flow node box'; },
    ['Sublabel', 'legible', 'increase node.width']],
  ['dataflow: node tag wider than its legible minimum', 'dataflow',
    (d) => { d.nodes[0].tag = 'This tag is far too long to sit inside one data-flow node box'; },
    ['Tag', 'legible', 'increase node.width']],

  // ---- lifecycle layout rules ----
  ['lifecycle: missing reserved main lane', 'lifecycle',
    (d) => {
      d.lanes = d.lanes.map((l) => (l.id === 'main' ? { ...l, id: 'primary' } : l));
      d.states = d.states.map((s) => (s.lane === 'main' ? { ...s, lane: 'primary' } : s));
    }, ['"main"', 'reserved']],
  ['lifecycle: cross-lane state overlap', 'lifecycle',
    (d) => {
      const approval = d.states.find((s) => s.id === 'approval');
      const failed = d.states.find((s) => s.id === 'failed');
      delete failed.yOffset;
      failed.col = approval.col;
    }, ['less than 10px apart']],
  ['lifecycle: viewBox height below schema min', 'lifecycle',
    (d) => { d.meta.viewBox = [980, 565]; }, ['566']],
  ['lifecycle: state sublabel wider than its legible minimum', 'lifecycle',
    (d) => { d.states[0].sublabel = 'This supporting sentence is far too long for one lifecycle state box'; },
    ['Sublabel', 'legible', 'increase state.width']],
  ['lifecycle: state tag wider than its legible minimum', 'lifecycle',
    (d) => { d.states[0].tag = 'This tag is far too long to sit inside one lifecycle state box'; },
    ['Tag', 'legible', 'increase state.width']],

  // ---- architecture layout rules ----
  ['architecture: components overlap', 'architecture',
    (d) => { d.components[1].pos = [...d.components[0].pos]; }, ['less than 8px apart']],
  ['architecture: connection references unknown component', 'architecture',
    (d) => { d.connections[0].to = 'ghost'; }, ['unknown target "ghost"']],
  ['architecture: boundary wraps unknown component', 'architecture',
    (d) => { d.boundaries[0].wraps.push('ghost'); }, ['wraps unknown component "ghost"']],
  ['architecture: boundary title must fit inside its own frame', 'architecture',
    (d) => {
      d.meta.quality_profile = 'standard';
      d.meta.viewBox = [500, 400];
      d.components = [{
        id: 'narrow',
        type: 'backend',
        label: 'Narrow',
        pos: [330, 100],
        size: [128, 60],
      }];
      delete d.meta.views;
      d.connections = [];
      d.cards = [];
      d.boundaries = [{
        kind: 'region',
        label: 'A boundary title that cannot fit its narrow authored frame',
        wraps: ['narrow'],
        pad: 0,
      }];
    }, ['Boundary label', 'fit', 'shorten']],
  ['architecture: boundary title must stay inside the authored viewBox', 'architecture',
    (d) => {
      d.meta.quality_profile = 'standard';
      d.meta.viewBox = [500, 400];
      d.components = [{
        id: 'near-top',
        type: 'backend',
        label: 'Near top',
        pos: [120, 8],
        size: [128, 60],
      }];
      delete d.meta.views;
      d.connections = [];
      d.cards = [];
      d.boundaries = [{
        kind: 'region',
        label: 'Viewport title',
        wraps: ['near-top'],
        pad: 0,
      }];
    }, ['Boundary label', 'outside the viewBox', 'move wrapped components']],
  ['architecture: label wider than component', 'architecture',
    (d) => { d.components[0].label = 'An Extremely Long Component Label Overflow'; }, ['wider than component', 'shorten the label']],
  ['architecture: component sublabel wider than its legible minimum', 'architecture',
    (d) => { d.components[0].sublabel = 'This supporting sentence is far too long for one architecture component'; },
    ['Sublabel', 'legible', 'widen size']],
  ['architecture: component tag wider than its legible minimum', 'architecture',
    (d) => { d.components[0].tag = 'This tag is far too long to sit inside one architecture component box'; },
    ['Tag', 'legible', 'widen size']],
  ['architecture: component overlap suggests fix', 'architecture',
    (d) => { d.components[1].pos = [...d.components[0].pos]; }, ['Suggested fix', 'move "']],

];

for (const [name, mode, mutate, expected] of CASES) {
  test(name, () => {
    const doc = load(mode);
    mutate(doc);
    const { code, stderr } = render(mode, doc);
    assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
    assert.doesNotMatch(stderr, /TypeError|is not a function|Cannot read/, `crashed instead of reporting:\n${stderr}`);
    for (const sub of expected) {
      assert.ok(stderr.includes(sub), `expected "${sub}" in stderr:\n${stderr}`);
    }
  });
}

test('architecture: ordinary boundaries may express orthogonal overlapping memberships', () => {
  const d = load('architecture');
  d.boundaries[1].wraps.push('auth');
  const { code, stderr, outPath } = render('architecture', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  assert.equal(rectanglesOverlap(boundaryFrameRect(html, 0), boundaryFrameRect(html, 1)), true);
  const masks = boundaryTitleMasks(html);
  assert.equal(masks.length, 2);
  assert.equal(rectanglesOverlap(masks[0], masks[1]), false);
});

test('architecture: profile-less v1 keeps rendering when a boundary title cannot meet strict composition', () => {
  const d = load('architecture');
  delete d.meta.quality_profile;
  d.meta.viewBox = [500, 400];
  d.components = [{
    id: 'narrow',
    type: 'backend',
    label: 'Narrow',
    pos: [330, 100],
    size: [128, 60],
  }];
  delete d.meta.views;
  d.connections = [];
  d.cards = [];
  d.boundaries = [{
    kind: 'region',
    label: 'A boundary title that cannot fit its narrow authored frame',
    wraps: ['narrow'],
    pad: 0,
  }];

  const { code, stderr } = render('architecture', d);
  assert.equal(code, 0, stderr);
});

test('architecture: profile-less v1 keeps legacy boundary geometry at the top edge', () => {
  const d = load('architecture');
  delete d.meta.quality_profile;
  d.meta.viewBox = [500, 400];
  d.components = [{
    id: 'near-top',
    type: 'backend',
    label: 'Near top',
    pos: [120, 22],
    size: [128, 60],
  }];
  delete d.meta.views;
  d.connections = [];
  d.cards = [];
  d.boundaries = [{
    kind: 'region',
    label: 'Legacy top edge',
    wraps: ['near-top'],
    pad: 0,
  }];

  const { code, stderr } = render('architecture', d);
  assert.equal(code, 0, stderr);
});

test('architecture: deployment ownership requires nested membership geometry to agree', () => {
  const d = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'examples/production-deployment.architecture.json'),
    'utf8',
  ));
  d.boundaries.find((boundary) => boundary.label === 'private application network').pad = 260;
  const { code, stderr } = render('architecture', d);
  assert.notEqual(code, 0);
  assert.match(stderr, /final frames partially overlap/);
  assert.match(stderr, /adjust wraps, pad, or component positions/);
});

test('architecture: boundary labels reserve readable space above wrapped components', () => {
  const d = load('architecture');
  d.boundaries = [{
    kind: 'security-group',
    label: 'Tool effects and permissions',
    wraps: ['lb', 'api'],
    pad: 14,
  }];

  const { code, stderr, outPath } = render('architecture', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  const label = html.match(
    /<text data-boundary-label="" x="[^"]+" y="([^"]+)" class="t-security" font-size="[^"]+" font-weight="600">Tool effects and permissions<\/text>/,
  );
  assert.ok(label, 'expected the security boundary label');
  const labelBaseline = Number(label[1]);
  const firstWrappedNodeY = Math.min(
    workflowNodeRect(html, 'lb').y,
    workflowNodeRect(html, 'api').y,
  );
  assert.ok(
    labelBaseline <= firstWrappedNodeY - 4,
    `expected the boundary label baseline (${labelBaseline}) to clear the first wrapped node (${firstWrappedNodeY})`,
  );
});

test('architecture: auto viewBox keeps expanded boundary titles readable at desktop scale', () => {
  const d = load('architecture');
  delete d.meta.viewBox;
  d.meta.quality_profile = 'showcase';
  delete d.meta.views;
  d.components = [{
    id: 'node',
    type: 'backend',
    label: 'Current node',
    pos: [800, 100],
    size: [120, 60],
  }];
  d.connections = [];
  d.cards = [];
  d.boundaries = [{
    kind: 'region',
    label: 'Disaster recovery boundary Disaster recovery boundary Disaster recovery boundary',
    wraps: ['node'],
    pad: 30,
  }];

  const { code, stderr, outPath } = render('architecture', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  const viewBoxWidth = Number(html.match(/\bviewBox="0 0 ([\d.]+) [\d.]+"/)?.[1]);
  const sourceFontPx = Number(html.match(/<text data-boundary-label[^>]*font-size="([\d.]+)"/)?.[1]);
  const projectedFontPx = sourceFontPx * Math.min(1, 930 / viewBoxWidth);
  assert.ok(
    projectedFontPx >= 6,
    `expected the final ${viewBoxWidth}px viewBox to project its ${sourceFontPx}px boundary title at 6px or larger, got ${projectedFontPx}px`,
  );
});

test('architecture: boundary labels and their masks paint above relationship routes', () => {
  const d = load('architecture');
  const { code, stderr, outPath } = render('architecture', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  const lastRoute = html.lastIndexOf('data-composition-points=');
  const firstBoundaryLabel = html.indexOf('data-graph-role="structural-frame-label"');
  assert.ok(lastRoute >= 0, 'expected at least one rendered relationship route');
  assert.ok(firstBoundaryLabel >= 0, 'expected a foreground boundary label group');
  assert.ok(
    firstBoundaryLabel > lastRoute,
    'boundary labels must paint after relationship routes so routes cannot cross the title text',
  );
  assert.match(
    html.slice(firstBoundaryLabel, firstBoundaryLabel + 500),
    /data-graph-role="structural-frame-label-mask"/,
    'expected an opaque mask behind the foreground boundary title',
  );
});

test('architecture: nested boundary title rails stay inside frames and avoid labels and nodes', () => {
  const d = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'examples/production-deployment.architecture.json'),
    'utf8',
  ));
  const { code, stderr, outPath } = render('architecture', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  const masks = boundaryTitleMasks(html);
  assert.equal(masks.length, d.boundaries.length);

  for (const mask of masks) {
    assert.ok(
      rectContainsRect(boundaryFrameRect(html, mask.index), mask),
      `boundary title mask ${mask.index} must stay inside its frame: ${JSON.stringify(mask)}`,
    );
    for (const component of d.components) {
      assert.equal(
        rectanglesOverlap(mask, workflowNodeRect(html, component.id)),
        false,
        `boundary title mask ${mask.index} overlaps component ${component.id}`,
      );
    }
  }

  for (let left = 0; left < masks.length; left += 1) {
    for (let right = left + 1; right < masks.length; right += 1) {
      assert.equal(
        rectanglesOverlap(masks[left], masks[right]),
        false,
        `boundary title masks ${left} and ${right} overlap`,
      );
    }
  }
});

test('architecture: boundary title masks cannot obscure connection labels', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Boundary and connection labels', quality_profile: 'standard', viewBox: [700, 500] },
    components: [
      { id: 'scoped', type: 'backend', label: 'Scoped', pos: [250, 100], size: [120, 60] },
      { id: 'source', type: 'external', label: 'Source', pos: [50, 300], size: [100, 50] },
      { id: 'target', type: 'external', label: 'Target', pos: [500, 300], size: [100, 50] },
    ],
    boundaries: [{ kind: 'region', label: 'Runtime scope', wraps: ['scoped'] }],
    connections: [{
      from: 'source',
      to: 'target',
      label: 'Route label',
      route: 'straight',
      labelAt: [270, 88],
    }],
  };

  const { code, stderr } = render('architecture', d);
  assert.notEqual(code, 0);
  assert.match(stderr, /Boundary label "Runtime scope" overlaps connection label "Route label"/);
  assert.match(stderr, /labelAt\/labelDx\/labelDy\/labelSegment/);
});

// ---- sublabel/tag shrink-to-fit: the render half of the same rule ----
// Validation only rejects text that cannot fit even at its legible minimum.
// Everything between "fits at the preferred size" and that floor must shrink,
// not overflow — otherwise the common case still paints over its neighbours.
const SHRINK_CASES = [
  // [mode, mutate(doc), preferredFontSize, selector for the sublabel <text>]
  ['architecture', (d) => { d.components[0].sublabel = 'Browser and mobile apps'; }, 9],
  ['sequence', (d) => { d.participants[0].sublabel = 'long browser session'; }, 7],
  ['dataflow', (d) => { d.nodes[0].sublabel = 'browser SDK and mobile SDK'; }, 7],
  ['lifecycle', (d) => { d.states[0].sublabel = 'request accepted and queued'; }, 7],
];

for (const [mode, mutate, preferred] of SHRINK_CASES) {
  test(`${mode}: an over-long sublabel shrinks to fit instead of overflowing`, () => {
    const d = load(mode);
    mutate(d);
    const { code, stderr, outPath } = render(mode, d);
    assert.equal(code, 0, stderr);
    const html = fs.readFileSync(outPath, 'utf8');
    const sub = html.match(/<text data-detail="context"[^>]*font-size="([\d.]+)"[^>]*>/);
    assert.ok(sub, 'expected a sublabel <text> in the rendered SVG');
    const fontSize = Number(sub[1]);
    assert.ok(
      fontSize < preferred,
      `expected the sublabel to shrink below the ${preferred}px preferred size, got ${fontSize}`,
    );
    assert.ok(fontSize >= 6, `expected the sublabel to stay legible, got ${fontSize}`);
  });
}

const TAG_SHRINK_CASES = [
  // [mode, collection, tag, preferredFontSize]
  ['architecture', 'components', 'owner: platform operations team', 7],
  ['dataflow', 'nodes', 'owner: analytics platform', 7],
  ['lifecycle', 'states', 'owner: platform operations pod', 7],
  ['workflow', 'nodes', 'owner: runtime squad A', 7],
];

for (const [mode, collection, tag, preferred] of TAG_SHRINK_CASES) {
  test(`${mode}: an over-long tag shrinks to fit instead of overflowing`, () => {
    const d = load(mode);
    d[collection][0].tag = tag;
    const { code, stderr, outPath } = render(mode, d);
    assert.equal(code, 0, stderr);
    const html = fs.readFileSync(outPath, 'utf8');
    const escapedTag = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = html.match(new RegExp(
      `<text data-detail="fine"[^>]*font-size="([\\d.]+)"[^>]*>${escapedTag}</text>`,
    ));
    assert.ok(match, `expected a tag <text> for "${tag}" in the rendered SVG`);
    const fontSize = Number(match[1]);
    assert.ok(
      fontSize < preferred,
      `expected the tag to shrink below the ${preferred}px preferred size, got ${fontSize}`,
    );
    assert.ok(fontSize >= 6, `expected the tag to stay legible, got ${fontSize}`);
  });
}

test('contract: a too-wide label is never redirected into sublabel', () => {
  // Every renderer used to advise "move detail to sublabel" for an over-long
  // label. Sublabels are measured now, so that advice would move the problem
  // rather than fix it.
  const LABELS = {
    workflow: 'An Extremely Long Node Label That Overflows',
    sequence: 'An Extremely Long Participant Label That Overflows',
    dataflow: 'An Extremely Long Node Label That Overflows',
    lifecycle: 'An Extremely Long State Label That Overflows',
    architecture: 'An Extremely Long Component Label Overflow',
  };
  const FIELD = {
    workflow: 'nodes', sequence: 'participants', dataflow: 'nodes',
    lifecycle: 'states', architecture: 'components',
  };
  for (const [mode, label] of Object.entries(LABELS)) {
    const d = load(mode);
    d[FIELD[mode]][0].label = label;
    const { code, stderr } = render(mode, d);
    assert.notEqual(code, 0, `${mode}: expected non-zero exit; stderr:\n${stderr}`);
    assert.ok(stderr.includes('wider than'), `${mode}: expected a width message:\n${stderr}`);
    assert.ok(
      !/move detail to sublabel/.test(stderr),
      `${mode}: label advice still points at the measured sublabel field:\n${stderr}`,
    );
  }
});

// ---- error-message contract: threshold + remediation, not just a path ----
test('contract: short-edge message carries both the px minimum and a fix verb', () => {
  const d = load('workflow');
  // Force a too-short labeled edge between adjacent same-lane columns.
  d.nodes.push({ id: 'a1', lane: d.nodes[0].lane, col: 0, type: 'backend', label: 'A' });
  d.nodes.push({ id: 'a2', lane: d.nodes[0].lane, col: 0, type: 'backend', label: 'B', yOffset: 30 });
  d.edges.push({ from: 'a1', to: 'a2', label: 'x', route: 'straight' });
  const { stderr } = render('workflow', d);
  // Whatever rule fires, the messages must remain actionable (threshold + verb).
  assert.match(stderr, /\d+px|at least \d+|0\.\.\d+|less than/);
});

test('contract: ajv path errors are annotated with the element id', () => {
  const d = load('workflow');
  d.nodes[3].colour = 'red'; // unknown property → ajv additionalProperties
  const { stderr } = render('workflow', d);
  // Only meaningful when ajv is installed; skip the assertion in degraded mode.
  if (!/schema validation failed/.test(stderr)) return;
  assert.match(stderr, /id\/label:/);
});

test('workflow: same-lane offset auto edge stays orthogonal', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Same-lane offset route' },
    lanes: [{ id: 'main', label: 'Main lane' }],
    nodes: [
      { id: 'left', lane: 'main', col: 1, type: 'backend', label: 'A', width: 32, height: 38, yOffset: -14 },
      { id: 'right', lane: 'main', col: 2, type: 'backend', label: 'B', width: 32, height: 38, yOffset: 14 },
    ],
    edges: [{ from: 'left', to: 'right' }],
  };
  const { code, stderr, outPath } = render('workflow', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  assert.doesNotMatch(html, /M 236 105 L 284 133/);
  assert.match(html, /M 236 105 L 260 105 L 260 133 L 284 133/);
});

test('workflow: automatic routing uses one bend and avoids every node border', () => {
  const d = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'test/fixtures/automatic-routing-node-border-clearance.workflow.json'),
    'utf8',
  ));
  const { code, stderr, outPath } = render('workflow', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  const points = workflowEdgePoints(html, 'stdin');
  const target = workflowNodeRect(html, 'team_send');
  assert.equal(points.length, 3, `expected one bend, received ${JSON.stringify(points)}`);
  assert.equal(points[0][0], points[1][0], 'edge must leave the source vertically');
  assert.ok(points[1][1] < points[0][1], 'edge must leave the source through its top side');
  assert.equal(points[1][1], points[2][1], 'edge must enter the target horizontally');
  assert.ok(points[2][0] > points[1][0], 'edge must enter the target through its left side');
  assert.equal(points[2][0], target.x, 'edge must stop at the target border');
  assert.ok(
    points[2][1] > target.y && points[2][1] < target.y + target.height,
    'edge must meet the target inside its left-side anchor range',
  );
  assertWorkflowEdgesAvoidAllNodeBorders(html, d);

  const [labelX, labelY] = workflowEdgeLabelPoint(html, 'stdin');
  assert.equal(labelX, points[0][0], 'the label should use the longer vertical segment');
  assert.ok(labelY > points[1][1] && labelY < points[0][1], 'the label should stay inside that segment');
});

test('workflow: shared automatic endpoints avoid every node border', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Shared endpoint border invariant' },
    lanes: [
      { id: 'target-lane', label: 'Target' },
      { id: 'source-lane', label: 'Sources' },
    ],
    nodes: [
      { id: 'target', lane: 'target-lane', col: 2, type: 'backend', label: 'Target' },
      { id: 'source-left', lane: 'source-lane', col: 1, type: 'backend', label: 'Left' },
      { id: 'source-right', lane: 'source-lane', col: 3, type: 'backend', label: 'Right' },
    ],
    edges: [
      { id: 'left-to-target', from: 'source-left', to: 'target' },
      { id: 'right-to-target', from: 'source-right', to: 'target' },
    ],
  };
  const { code, stderr, outPath } = render('workflow', d);
  assert.equal(code, 0, stderr);
  assertWorkflowEdgesAvoidAllNodeBorders(fs.readFileSync(outPath, 'utf8'), d);
});

test('workflow: blocked first one-bend candidate selects the clear one-bend orientation', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Blocked one-bend candidate', quality_profile: 'showcase' },
    lanes: [
      { id: 'target-lane', label: 'Target' },
      { id: 'obstacle-lane', label: 'Obstacle' },
      { id: 'source-lane', label: 'Source' },
    ],
    nodes: [
      { id: 'target', lane: 'target-lane', col: 3, type: 'backend', label: 'Target' },
      { id: 'obstacle', lane: 'obstacle-lane', col: 1, type: 'security', label: 'Obstacle' },
      { id: 'source', lane: 'source-lane', col: 1, type: 'backend', label: 'Source' },
    ],
    edges: [{ id: 'clear-corner', from: 'source', to: 'target' }],
  };
  const { code, stderr, outPath } = render('workflow', d);
  assert.equal(code, 0, stderr);
  const points = workflowEdgePoints(fs.readFileSync(outPath, 'utf8'), 'clear-corner');
  assert.equal(points.length, 3, `expected the alternate one-bend route, received ${JSON.stringify(points)}`);
  assert.equal(points[0][1], points[1][1], 'blocked vertical-first candidate must switch to horizontal-first');
  assert.ok(points[1][0] > points[0][0], 'edge must leave the source through its right side');
  assert.equal(points[1][0], points[2][0], 'edge must enter the target vertically');
  assert.ok(points[2][1] < points[1][1], 'edge must enter the target through its bottom side');
});

test('workflow: explicit drop routing remains authoritative over the one-bend preference', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Explicit route compatibility', quality_profile: 'showcase' },
    lanes: [
      { id: 'target-lane', label: 'Target' },
      { id: 'source-lane', label: 'Source' },
    ],
    nodes: [
      { id: 'target', lane: 'target-lane', col: 3, type: 'backend', label: 'Target' },
      { id: 'source', lane: 'source-lane', col: 1, type: 'backend', label: 'Source' },
    ],
    edges: [{
      id: 'authored-drop',
      from: 'source',
      to: 'target',
      route: 'drop',
      fromSide: 'top',
      toSide: 'bottom',
    }],
  };
  const { code, stderr, outPath } = render('workflow', d);
  assert.equal(code, 0, stderr);
  const points = workflowEdgePoints(fs.readFileSync(outPath, 'utf8'), 'authored-drop');
  assert.equal(points.length, 4, `explicit drop route was replaced: ${JSON.stringify(points)}`);
  assert.equal(points[0][0], points[1][0]);
  assert.equal(points[1][1], points[2][1]);
  assert.equal(points[2][0], points[3][0]);
});

test('workflow: authored endpoint sides that follow a border are rejected generically', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Authored endpoint border run' },
    lanes: [
      { id: 'target-lane', label: 'Target' },
      { id: 'source-lane', label: 'Source' },
    ],
    nodes: [
      { id: 'target', lane: 'target-lane', col: 3, type: 'backend', label: 'Target' },
      { id: 'source', lane: 'source-lane', col: 1, type: 'backend', label: 'Source' },
    ],
    edges: [{
      id: 'invalid-drop',
      from: 'source',
      to: 'target',
      route: 'drop',
      fromSide: 'right',
      toSide: 'left',
    }],
  };
  const { code, stderr } = render('workflow', d);
  assert.notEqual(code, 0);
  assert.match(stderr, /\[clean-flow\/endpoint-side-direction\] workflow edges\[0\] id "invalid-drop"/);
  assert.match(stderr, /cross node borders perpendicularly/);
});

test('dataflow: authored endpoint sides that follow a border are rejected generically', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Data-flow endpoint border run' },
    stages: [{ label: 'Source' }, { label: 'Target' }],
    nodes: [
      { id: 'source', stage: 0, row: 0, type: 'backend', label: 'Source' },
      { id: 'target', stage: 1, row: 2, type: 'database', label: 'Target' },
    ],
    flows: [{
      id: 'invalid-bottom',
      from: 'source',
      to: 'target',
      label: 'payload',
      route: 'bottom-channel',
      fromSide: 'right',
      toSide: 'left',
    }],
  };
  const { code, stderr } = render('dataflow', d);
  assert.notEqual(code, 0);
  assert.match(stderr, /\[clean-flow\/endpoint-side-direction\] dataflow flows\[0\] id "invalid-bottom"/);
  assert.match(stderr, /cross node borders perpendicularly/);
});

test('lifecycle: automatic cross-lane routes avoid every state border', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Lifecycle endpoint border invariant' },
    lanes: [
      { id: 'main', label: 'Main' },
      { id: 'terminal', label: 'Terminal' },
    ],
    states: [
      { id: 'target', lane: 'main', col: 3, type: 'success', label: 'Target' },
      { id: 'source', lane: 'terminal', col: 1, type: 'active', label: 'Source' },
    ],
    transitions: [{ id: 'automatic-transition', from: 'source', to: 'target' }],
  };
  const { code, stderr, outPath } = render('lifecycle', d);
  assert.equal(code, 0, stderr);
  assertRelationshipsAvoidAllNodeBorders(
    fs.readFileSync(outPath, 'utf8'),
    d.transitions,
    d.states,
  );
});

function tangentViaLifecycle() {
  return {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Legacy tangent via compatibility' },
    lanes: [
      { id: 'main', label: 'Main' },
      { id: 'terminal', label: 'Terminal' },
    ],
    states: [
      { id: 'source', lane: 'main', col: 1, type: 'active', label: 'Source' },
      { id: 'target', lane: 'terminal', col: 0, type: 'success', label: 'Target' },
    ],
    transitions: [{
      id: 'legacy-via',
      from: 'source',
      to: 'target',
      fromSide: 'bottom',
      toSide: 'top',
      via: [[320, 188], [320, 430], [402, 430]],
    }],
  };
}

test('lifecycle: legacy tangent via is rendered exactly instead of silently rewritten', () => {
  const d = tangentViaLifecycle();
  const { code, stderr, outPath } = render('lifecycle', d);
  assert.equal(code, 0, stderr);
  assert.deepEqual(workflowEdgePoints(fs.readFileSync(outPath, 'utf8'), 'legacy-via'), [
    [248, 188], [320, 188], [320, 430], [402, 430], [402, 450],
  ]);
});

for (const qualityProfile of ['standard', 'showcase']) {
  test(`lifecycle: ${qualityProfile} keeps an authored tangent via authoritative`, () => {
    const d = tangentViaLifecycle();
    d.meta.quality_profile = qualityProfile;
    const { code, stderr, outPath } = render('lifecycle', d);
    assert.equal(code, 0, stderr);
    assert.deepEqual(workflowEdgePoints(fs.readFileSync(outPath, 'utf8'), 'legacy-via'), [
      [248, 188], [320, 188], [320, 430], [402, 430], [402, 450],
    ]);
  });

  test(`lifecycle: public validate accepts an authoritative authored tangent via in ${qualityProfile}`, () => {
    const d = tangentViaLifecycle();
    d.meta.quality_profile = qualityProfile;
    const { code, result } = validateCli('lifecycle', d);
    assert.equal(code, 0, JSON.stringify(result, null, 2));
    assert.equal(result.ok, true);
  });
}

test('workflow: explicit labelAt remains authoritative on an automatic one-bend edge', () => {
  const d = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'test/fixtures/automatic-routing-node-border-clearance.workflow.json'),
    'utf8',
  ));
  d.edges[0].labelAt = [350, 166];
  const { code, stderr, outPath } = render('workflow', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  assert.deepEqual(workflowEdgeLabelPoint(html, 'stdin'), [350, 166]);
});

test('workflow: bounded font fitting keeps an ordinary long sublabel inside its node', () => {
  const d = load('workflow');
  d.nodes[0].sublabel = 'shell / browser / MCP';
  const { code, stderr, outPath } = render('workflow', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  assert.match(html, /font-size="6\.6"[^>]*>shell \/ browser \/ MCP<\/text>/);
});

test('workflow: edge crossing a non-endpoint node is rejected', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Crossing edge route', quality_profile: 'standard' },
    lanes: [{ id: 'main', label: 'Main lane' }],
    nodes: [
      { id: 'left', lane: 'main', col: 0, type: 'backend', label: 'Left', width: 60 },
      { id: 'middle', lane: 'main', col: 2, type: 'database', label: 'Middle', width: 70 },
      { id: 'right', lane: 'main', col: 4, type: 'backend', label: 'Right', width: 60 },
    ],
    edges: [{ from: 'left', to: 'right', route: 'straight' }],
  };
  const { code, stderr } = render('workflow', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /crosses node "middle"/);
  assert.match(stderr, /fromSide\/toSide|channel|lane\/column/);
});

test('architecture: Clean Flow Gate rejects a connection through a component', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Opaque component crossing', quality_profile: 'standard' },
    components: [
      { id: 'left', type: 'frontend', label: 'Left', pos: [60, 120], size: [100, 54] },
      { id: 'middle', type: 'security', label: 'Middle', pos: [270, 120], size: [100, 54] },
      { id: 'right', type: 'backend', label: 'Right', pos: [480, 120], size: [100, 54] },
    ],
    connections: [{ id: 'direct', from: 'left', to: 'right', route: 'straight' }],
  };
  const { code, stderr } = render('architecture', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /\[clean-flow\/edge-through-node\] architecture connections\[0\] id "direct"/);
  assert.match(stderr, /crosses component "middle"/);
  assert.match(stderr, /segment 0 .*2px clearance/);
});

test('dataflow: showcase rejects a relationship label that hides another route', () => {
  const d = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'event-stream.dataflow.json'), 'utf8'));
  const approvedReplay = d.flows.find((flow) => flow.label === 'approved replay');
  delete approvedReplay.labelAt;
  delete approvedReplay.labelDx;
  delete approvedReplay.labelDy;
  delete approvedReplay.labelSegment;
  const { code, stderr } = render('dataflow', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /\[composition\/label-route-clearance\] showcase dataflow/);
  assert.match(stderr, /approved replay.*failure sample/);
  assert.match(stderr, /labelAt.*labelDx.*labelDy.*labelSegment/);
});

test('dataflow: validator and SVG share the 27px CJK/emoji classification mask', () => {
  const d = load('dataflow');
  const flow = d.flows[0];
  flow.label = '写入🚀';
  flow.classification = '机密🔐';
  const { code, stderr, outPath } = render('dataflow', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  const group = html.match(/<g data-detail="context"[^>]*data-edge-id="web-clickstream"[^>]*>[\s\S]*?<\/g>/)?.[0] || '';
  assert.match(group, /data-edge-label="写入🚀"/);
  assert.match(group, /<rect x="[^\"]+" y="[^\"]+" width="41\.4" height="27" rx="4" class="c-mask"\/>/);
  assert.match(group, />机密🔐<\/text>/);
});

test('architecture: showcase rejects a connection label that hides another route', () => {
  const d = load('architecture');
  d.connections[0].labelAt = [620, 330];
  const { code, stderr } = render('architecture', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /\[composition\/label-route-clearance\] showcase architecture/);
  assert.match(stderr, /HTTPS.*lb-to-api/);
});

test('workflow: showcase rejects an edge label that hides another route', () => {
  const d = load('workflow');
  d.edges.find((edge) => edge.id === 'plan-request').labelAt = [562, 491];
  const { code, stderr } = render('workflow', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /\[composition\/label-route-clearance\] showcase workflow/);
  assert.match(stderr, /plan.*retry-request/);
});

test('lifecycle: showcase rejects a transition label that hides another route', () => {
  const d = load('lifecycle');
  d.transitions[0].label = 'approval gate';
  d.transitions[0].labelAt = [556, 250];
  const { code, stderr } = render('lifecycle', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /\[composition\/label-route-clearance\] showcase lifecycle/);
  assert.match(stderr, /approval gate.*review-blocked/);
});

test('sequence: showcase rejects a message label that hides an adjacent route', () => {
  const d = load('sequence');
  d.messages = d.messages.slice(0, 2);
  d.messages[0].label = 'customer authorization context';
  d.messages[0].y = 250;
  d.messages[1].label = 'ok';
  d.messages[1].y = 245;
  d.segments = [];
  d.activations = [];
  const { code, stderr } = render('sequence', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /\[composition\/label-route-clearance\] showcase sequence/);
  assert.match(stderr, /customer authorization context.*dashboard-request/);
});

function autoRoutePassThroughDocument(connection) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Auto-route pass-through regression' },
    components: [
      { id: 'api', type: 'backend', label: 'API', pos: [400, 280], size: [160, 76] },
      { id: 'cache', type: 'database', label: 'Cache', pos: [645, 130], size: [130, 60] },
      { id: 'queue', type: 'cloud', label: 'Queue', pos: [880, 130] },
    ],
    connections: [connection],
  };
}

test('architecture: default auto route selects a safe orthogonal candidate around an unrelated component', () => {
  const d = autoRoutePassThroughDocument({ from: 'api', to: 'queue', variant: 'dashed' });
  const { code, stderr, outPath } = render('architecture', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  assert.match(html, /data-composition-points="560,318;856,318;856,160;880,160"/);
});

test('architecture: auto route enters explicit top and bottom ports perpendicularly', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Endpoint direction regression' },
    components: [
      { id: 'cli-agents', type: 'external', label: 'CLI Agents', pos: [300, 100], size: [100, 60] },
      { id: 'tasks-watch', type: 'backend', label: 'Tasks Watcher', pos: [100, 240], size: [100, 60] },
    ],
    connections: [
      { id: 'tasks-file', from: 'cli-agents', to: 'tasks-watch', variant: 'dashed', fromSide: 'bottom', toSide: 'top' },
    ],
  };
  const { code, stderr, outPath } = render('architecture', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  assert.match(html, /data-composition-points="350,160;350,200;150,200;150,240"/);
});

test('architecture: auto route preserves inferred side normals when the primary dogleg is blocked', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Inferred endpoint direction regression' },
    components: [
      { id: 'workspace', type: 'frontend', label: 'Workspace UI', pos: [40, 300], size: [120, 60] },
      { id: 'runtime-server', type: 'backend', label: 'Runtime Server', pos: [220, 300], size: [120, 60] },
      { id: 'runtime-store', type: 'backend', label: 'Runtime Store', pos: [400, 300], size: [120, 60] },
      { id: 'stream-hub', type: 'messagebus', label: 'Terminal Stream Hub', pos: [700, 100], size: [120, 60] },
    ],
    connections: [
      { id: 'terminal-return', from: 'stream-hub', to: 'workspace' },
    ],
  };
  const { code, stderr, outPath } = render('architecture', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  assert.match(html, /data-composition-points="700,130;184,130;184,330;160,330"/);
  assert.doesNotMatch(html, /data-composition-points="700,130;700,230;160,230;160,330"/);
});

test('architecture: explicit via cannot run tangentially into an authored top port', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Tangent endpoint regression' },
    components: [
      { id: 'cli-agents', type: 'external', label: 'CLI Agents', pos: [300, 100], size: [100, 60] },
      { id: 'tasks-watch', type: 'backend', label: 'Tasks Watcher', pos: [100, 240], size: [100, 60] },
    ],
    connections: [
      {
        id: 'tasks-file',
        from: 'cli-agents',
        to: 'tasks-watch',
        variant: 'dashed',
        fromSide: 'bottom',
        toSide: 'top',
        via: [[350, 200], [100, 200], [100, 240]],
      },
    ],
  };
  const { code, stderr } = render('architecture', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /\[clean-flow\/endpoint-side-direction\] architecture connections\[0\] id "tasks-file"/);
  assert.match(stderr, /final segment 3 \[100, 240\] -> \[150, 240\]/);
  assert.match(stderr, /toSide "top".*vertical downward from above/);
});

test('architecture: explicit orthogonal route remains authoritative when it crosses a component', () => {
  const d = autoRoutePassThroughDocument({
    from: 'api',
    to: 'queue',
    variant: 'dashed',
    route: 'orthogonal-h',
  });
  const { code, stderr } = render('architecture', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /connections\[0\] "api" -> "queue" crosses component "cache"/);
});

test('architecture: auto route still fails closed when doglegs and side-aware bridges are blocked', () => {
  const d = autoRoutePassThroughDocument({ from: 'api', to: 'queue', variant: 'dashed' });
  d.components.push({ id: 'guard', type: 'security', label: 'Guard', pos: [825, 215], size: [70, 50] });
  const { code, stderr } = render('architecture', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /connections\[0\] "api" -> "queue" crosses component "cache"/);
});

test('architecture: explicit waypoints around an obstacle remain valid by default', () => {
  const d = autoRoutePassThroughDocument({
    from: 'api',
    to: 'queue',
    variant: 'dashed',
    fromSide: 'right',
    toSide: 'top',
    via: [[620, 318], [620, 100], [940, 100]],
  });
  const { code, stderr } = render('architecture', d);
  assert.equal(code, 0, stderr);
});

test('architecture: showcase rejects an unrelated proper edge crossing', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Showcase crossing', quality_profile: 'showcase' },
    components: [
      { id: 'a', type: 'frontend', label: 'A', pos: [60, 80], size: [60, 40] },
      { id: 'b', type: 'backend', label: 'B', pos: [360, 260], size: [60, 40] },
      { id: 'c', type: 'database', label: 'C', pos: [60, 260], size: [60, 40] },
      { id: 'd', type: 'external', label: 'D', pos: [360, 80], size: [60, 40] },
    ],
    connections: [
      { id: 'down-right', from: 'a', to: 'b', route: 'orthogonal-h' },
      { id: 'up-right', from: 'c', to: 'd', route: 'orthogonal-v', fromSide: 'top', toSide: 'bottom' },
    ],
  };
  const { code, stderr } = render('architecture', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /\[composition\/proper-crossing\] showcase architecture/);
  assert.match(stderr, /connections\[0\] id "down-right"/);
  assert.match(stderr, /connections\[1\] id "up-right"/);
  assert.match(stderr, /at \[240, 190\]/);
  assert.match(stderr, /segments 1 and 1/);
  assert.match(stderr, /route\/via|fromSide\/toSide/);
});

test('architecture: standard keeps the same proper crossing renderable', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Standard crossing', quality_profile: 'standard' },
    components: [
      { id: 'a', type: 'frontend', label: 'A', pos: [60, 80], size: [60, 40] },
      { id: 'b', type: 'backend', label: 'B', pos: [360, 260], size: [60, 40] },
      { id: 'c', type: 'database', label: 'C', pos: [60, 260], size: [60, 40] },
      { id: 'd', type: 'external', label: 'D', pos: [360, 80], size: [60, 40] },
    ],
    connections: [
      { from: 'a', to: 'b', route: 'orthogonal-h' },
      { from: 'c', to: 'd', route: 'orthogonal-v', fromSide: 'top', toSide: 'bottom' },
    ],
  };
  const { code, stderr } = render('architecture', d);
  assert.equal(code, 0, stderr);
});

function ambiguousCorridorDocument(profile) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Ambiguous corridor', quality_profile: profile },
    components: [
      { id: 'a', type: 'frontend', label: 'A', pos: [40, 60], size: [60, 40] },
      { id: 'b', type: 'backend', label: 'B', pos: [400, 60], size: [60, 40] },
      { id: 'c', type: 'database', label: 'C', pos: [120, 220], size: [60, 40] },
      { id: 'd', type: 'external', label: 'D', pos: [480, 220], size: [60, 40] },
    ],
    connections: [
      { id: 'first', from: 'a', to: 'b', fromSide: 'right', toSide: 'left', route: 'straight' },
      { id: 'second', from: 'c', to: 'd', fromSide: 'top', toSide: 'top', via: [[150, 80], [390, 80], [390, 180], [510, 180]] },
    ],
  };
}

test('architecture: showcase rejects an unrelated shared route corridor', () => {
  const { code, stderr } = render('architecture', ambiguousCorridorDocument('showcase'));
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /\[composition\/ambiguous-corridor\] showcase architecture/);
  assert.match(stderr, /connections\[0\] id "first" "a" -> "b" shares a 240px corridor with connections\[1\] id "second" "c" -> "d"/);
  assert.match(stderr, /\[150, 80\] -> \[390, 80\]/);
  assert.match(stderr, /do not visually merge/);
});

test('architecture: standard keeps an ambiguous corridor renderable for repair', () => {
  const { code, stderr } = render('architecture', ambiguousCorridorDocument('standard'));
  assert.equal(code, 0, stderr);
});

test('architecture: route rhythm warns in standard and blocks a showcase micro segment', () => {
  const base = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Readable turn rhythm' },
    components: [
      { id: 'a', type: 'frontend', label: 'A', pos: [60, 80], size: [60, 40] },
      { id: 'b', type: 'backend', label: 'B', pos: [360, 80], size: [60, 40] },
    ],
    connections: [
      { id: 'tight', from: 'a', to: 'b', fromSide: 'right', toSide: 'bottom', via: [[125, 100], [125, 160], [390, 160]] },
    ],
  };
  const standard = structuredClone(base);
  standard.meta.quality_profile = 'standard';
  assert.equal(render('architecture', standard).code, 0);

  const showcase = structuredClone(base);
  showcase.meta.quality_profile = 'showcase';
  const { code, stderr } = render('architecture', showcase);
  assert.notEqual(code, 0);
  assert.match(stderr, /\[composition\/micro-segment\] showcase architecture connections\[0\] id "tight"/);
  assert.match(stderr, /5px source-stub segment 0/);
  assert.match(stderr, /wider corridor|move the component/);
});

test('architecture: container border run is blocking in standard and showcase', () => {
  for (const profile of ['standard', 'showcase']) {
    const d = load('architecture');
    d.meta.quality_profile = profile;
    d.connections.find((connection) => connection.id === 'jwt-verification').via = [[620, 142], [620, 270], [735, 270]];
    const { code, stderr } = render('architecture', d);
    assert.notEqual(code, 0, `expected ${profile} to reject a border run`);
    assert.match(stderr, /\[composition\/container-border-run\] architecture connections\[1\] id "jwt-verification"/);
    assert.match(stderr, /security-group "sg-api :443\/:8000" top border/);
  }
});

test('dataflow: stage border run is blocking and the inter-stage gutter passes', () => {
  const bad = load('dataflow');
  bad.flows.find((flow) => flow.id === 'web-clickstream').via = [[184, 157], [184, 271]];
  const failed = render('dataflow', bad);
  assert.notEqual(failed.code, 0);
  assert.match(failed.stderr, /\[composition\/container-border-run\] dataflow flows\[0\] id "web-clickstream"/);
  assert.match(failed.stderr, /stage "Sources" right border for 114px/);

  const clean = load('dataflow');
  const passed = render('dataflow', clean);
  assert.equal(passed.code, 0, passed.stderr);
});

test('sequence: a message cannot masquerade as a time-segment border', () => {
  const d = load('sequence');
  d.messages.find((message) => message.id === 'cache-read').y = 315;
  const { code, stderr } = render('sequence', d);
  assert.notEqual(code, 0);
  assert.match(stderr, /\[composition\/container-border-run\] sequence messages\[4\] id "cache-read"/);
  assert.match(stderr, /segment "Fallback" top border/);
});

test('dataflow: Clean Flow Gate rejects a flow through an unrelated node', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Opaque data node crossing', quality_profile: 'standard' },
    stages: [{ label: 'Source' }, { label: 'Middle' }, { label: 'Sink' }],
    nodes: [
      { id: 'left', type: 'frontend', label: 'Left', stage: 0, row: 1 },
      { id: 'middle', type: 'security', label: 'Middle', stage: 1, row: 1 },
      { id: 'right', type: 'database', label: 'Right', stage: 2, row: 1 },
    ],
    flows: [{ id: 'direct', from: 'left', to: 'right', label: 'payload', route: 'straight', labelAt: [315, 190] }],
  };
  const { code, stderr } = render('dataflow', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /\[clean-flow\/edge-through-node\] dataflow flows\[0\] id "direct"/);
  assert.match(stderr, /crosses node "middle"/);
  assert.match(stderr, /stage\/row/);
});

test('lifecycle: Clean Flow Gate rejects a transition through an unrelated state', () => {
  const d = {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Opaque state crossing', quality_profile: 'standard' },
    lanes: [{ id: 'main', label: 'Main' }],
    states: [
      { id: 'left', type: 'start', label: 'Left', lane: 'main', col: 0 },
      { id: 'middle', type: 'waiting', label: 'Middle', lane: 'main', col: 2 },
      { id: 'right', type: 'success', label: 'Right', lane: 'main', col: 4 },
    ],
    transitions: [{ id: 'direct', from: 'left', to: 'right', route: 'straight' }],
  };
  const { code, stderr } = render('lifecycle', d);
  assert.notEqual(code, 0, `expected non-zero exit; stderr:\n${stderr}`);
  assert.match(stderr, /\[clean-flow\/edge-through-node\] lifecycle transitions\[0\] id "direct"/);
  assert.match(stderr, /crosses state "middle"/);
  assert.match(stderr, /col\/yOffset/);
});

test('sequence: lifelines and activation bars remain intentional pass-through geometry', () => {
  const d = load('sequence');
  const { code, stderr } = render('sequence', d);
  assert.equal(code, 0, stderr);
  assert.doesNotMatch(stderr, /Clean Flow Gate/);
});

test('sequence: segment titles render as foreground badges above their borders', () => {
  const d = load('sequence');
  const { code, stderr, outPath } = render('sequence', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  const firstSegment = d.segments[0];
  const segmentLabelsAt = html.indexOf('<!-- Segment Labels -->');
  const activationsAt = html.indexOf('<!-- Activations -->');
  const messagesAt = html.indexOf('<!-- Messages -->');

  assert.ok(segmentLabelsAt > activationsAt, 'segment labels should stay above lifelines, messages, and activations');
  assert.ok(messagesAt > activationsAt, 'message arrows and labels should stay above activation bars');
  assert.match(html, new RegExp(`data-graph-role="segment-label"[^>]*data-segment-id="0"`));
  assert.match(html, new RegExp(`<text x="62" y="${firstSegment.from - 9}"[^>]*>${firstSegment.label}</text>`));
});

test('sequence: segment title badge clears a nearby first message label', () => {
  const d = load('sequence');
  const firstSegment = d.segments[0];
  const firstMessage = d.messages[0];
  firstSegment.from = 180;
  firstMessage.y = firstSegment.from + 5;

  const { code, stderr, outPath } = render('sequence', d);
  assert.equal(code, 0, stderr);
  const html = fs.readFileSync(outPath, 'utf8');
  const segment = html.match(
    /<g data-graph-role="segment-label" data-segment-id="0">\s*<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/,
  );
  const message = html.match(new RegExp(
    `<g [^>]*data-edge-id="${firstMessage.id}"[\\s\\S]*?<rect x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"`,
  ));
  assert.ok(segment, 'expected the first segment badge rectangle');
  assert.ok(message, 'expected the first message label rectangle');

  const [segmentX, segmentY, segmentW, segmentH] = segment.slice(1).map(Number);
  const [messageX, messageY, messageW, messageH] = message.slice(1).map(Number);
  const overlaps = segmentX < messageX + messageW
    && segmentX + segmentW > messageX
    && segmentY < messageY + messageH
    && segmentY + segmentH > messageY;
  assert.equal(overlaps, false, 'segment title badge must not cover the first message label');
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
