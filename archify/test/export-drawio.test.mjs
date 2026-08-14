import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseArchifySvg, buildDrawioXml, buildDrawioXmlStrict, buildDrawioXmlSequence, extractPalette, convertArchifyToDrawio, extractSvgFromHtml } from '../renderers/shared/svg-to-drawio.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-drawio-'));
const cli = path.join(skillRoot, 'bin/archify.mjs');

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: options.cwd || skillRoot,
    encoding: 'utf8',
    env: options.env || process.env,
  });
}

// ─── Unit: SVG parsing ─────────────────────────────────────────────────────

test('parseArchifySvg extracts nodes with id, kind, label, and geometry', () => {
  const svg = `<svg viewBox="0 0 200 100">
    <g id="node-a" data-node-id="a" data-node-label="Alpha" data-node-kind="database">
      <rect x="10" y="20" width="60" height="40" rx="6" class="c-mask"/>
      <rect x="10" y="20" width="60" height="40" rx="6" class="c-database"/>
    </g>
  </svg>`;
  const parsed = parseArchifySvg(svg, 'architecture');
  assert.equal(parsed.nodes.length, 1);
  const node = parsed.nodes[0];
  assert.equal(node.id, 'a');
  assert.equal(node.kind, 'database');
  assert.equal(node.label, 'Alpha');
  assert.equal(node.x, 10);
  assert.equal(node.y, 20);
  assert.equal(node.width, 60);
  assert.equal(node.height, 40);
});

test('parseArchifySvg extracts edges with composition points (path pattern)', () => {
  const svg = `<svg viewBox="0 0 200 100">
    <path data-edge-from="a" data-edge-to="b" data-edge-label="flow" data-edge-id="ab"
          data-composition-points="70,40;130,40" d="M 70 40 L 130 40"/>
  </svg>`;
  const parsed = parseArchifySvg(svg, 'architecture');
  assert.equal(parsed.edges.length, 1);
  const edge = parsed.edges[0];
  assert.equal(edge.from, 'a');
  assert.equal(edge.to, 'b');
  assert.equal(edge.label, 'flow');
  assert.equal(edge.id, 'ab');
  assert.deepEqual(edge.points, [[70, 40], [130, 40]]);
});

test('parseArchifySvg extracts sequence edges (composition-edge prefix in g>path)', () => {
  const svg = `<svg viewBox="0 0 200 100">
    <g data-edge-from="a" data-edge-to="b" data-edge-label="call" data-edge-id="ab">
      <path data-composition-edge-from="a" data-composition-edge-to="b" data-composition-edge-id="ab"
            data-composition-points="30,50;100,50" d="M 30 50 L 100 50"/>
    </g>
  </svg>`;
  const parsed = parseArchifySvg(svg, 'sequence');
  assert.equal(parsed.edges.length, 1);
  assert.equal(parsed.edges[0].from, 'a');
  assert.equal(parsed.edges[0].to, 'b');
  assert.equal(parsed.edges[0].points.length, 2);
});

test('parseArchifySvg dedupes label-wrapper g duplicates', () => {
  // The real SVG renders each edge twice: once as a <path> with points, once
  // as a label <g> without points. Only the path should be captured.
  const svg = `<svg viewBox="0 0 200 100">
    <path data-edge-from="a" data-edge-to="b" data-composition-points="10,50;90,50"/>
    <g data-detail="context" data-edge-from="a" data-edge-to="b" data-edge-label="x">
      <rect x="40" y="40" width="20" height="14"/>
    </g>
  </svg>`;
  const parsed = parseArchifySvg(svg, 'architecture');
  assert.equal(parsed.edges.length, 1);
});

test('parseArchifySvg extracts boundaries with kind and label', () => {
  const svg = `<svg viewBox="0 0 200 100">
    <rect data-graph-role="structural-frame" data-composition-frame-kind="region"
          data-composition-frame-id="0" x="5" y="5" width="190" height="90" rx="12" class="c-region"/>
    <text x="13" y="23">My Region</text>
  </svg>`;
  const parsed = parseArchifySvg(svg, 'architecture');
  assert.equal(parsed.boundaries.length, 1);
  assert.equal(parsed.boundaries[0].kind, 'region');
  assert.equal(parsed.boundaries[0].label, 'My Region');
});

test('parseArchifySvg extracts sequence lifelines', () => {
  const svg = `<svg viewBox="0 0 200 200">
    <path d="M 50 60 L 50 180" class="a-default" stroke-width="0.8" stroke-dasharray="3,7"/>
    <path d="M 150 60 L 150 180" class="a-default" stroke-width="0.8" stroke-dasharray="3,7"/>
  </svg>`;
  const parsed = parseArchifySvg(svg, 'sequence');
  assert.equal(parsed.lifelines.length, 2);
  assert.equal(parsed.lifelines[0].x, 50);
});

test('extractSvgFromHtml throws when no svg present', () => {
  assert.throws(() => extractSvgFromHtml('<html><body>no diagram</body></html>'), /No <svg>/);
});

// ─── Unit: draw.io XML generation ──────────────────────────────────────────

test('buildDrawioXml emits valid mxGraphModel with root cells', () => {
  const parsed = {
    viewBox: [400, 300],
    nodes: [{ id: 'a', kind: 'backend', label: 'A', x: 10, y: 10, width: 80, height: 40 }],
    edges: [{ from: 'a', to: 'a', points: [[50, 30], [50, 30]] }],
    boundaries: [],
    lifelines: [],
  };
  const xml = buildDrawioXml(parsed, 'architecture');
  assert.match(xml, /<mxGraphModel/);
  assert.match(xml, /<root>/);
  assert.match(xml, /<mxCell id="0"\/>/);
  assert.match(xml, /<mxCell id="1" parent="0"\/>/);
});

test('buildDrawioXml binds edges to real vertex cell ids (not floating)', () => {
  const parsed = {
    viewBox: [400, 300],
    nodes: [
      { id: 'a', kind: 'backend', label: 'A', x: 10, y: 10, width: 80, height: 40 },
      { id: 'b', kind: 'backend', label: 'B', x: 200, y: 10, width: 80, height: 40 },
    ],
    edges: [{ from: 'a', to: 'b', label: 'call', id: 'ab', points: [[90, 30], [200, 30]] }],
    boundaries: [],
    lifelines: [],
  };
  const xml = buildDrawioXml(parsed, 'architecture');
  // The core guarantee: source/target point to node vertex ids.
  assert.match(xml, /edge="1"[^>]*source="node-a"[^>]*target="node-b"/);
});

test('buildDrawioXml preserves interior waypoints', () => {
  const parsed = {
    viewBox: [600, 300],
    nodes: [
      { id: 'a', kind: 'backend', label: 'A', x: 10, y: 10, width: 80, height: 40 },
      { id: 'b', kind: 'backend', label: 'B', x: 400, y: 200, width: 80, height: 40 },
    ],
    edges: [{
      from: 'a', to: 'b', id: 'ab',
      points: [[90, 30], [200, 30], [200, 220], [400, 220]],
    }],
    boundaries: [],
    lifelines: [],
  };
  const xml = buildDrawioXml(parsed, 'architecture');
  assert.match(xml, /<Array as="points">/);
  // First and last points are dropped (draw.io computes them from vertices).
  assert.match(xml, /<mxPoint x="200" y="30"\/>/);
  assert.match(xml, /<mxPoint x="200" y="220"\/>/);
  // Endpoints should NOT appear as waypoints.
  assert.doesNotMatch(xml, /<mxPoint x="90" y="30"\/>/);
});

test('buildDrawioXml maps node kind to draw.io shape styles', () => {
  const parsed = {
    viewBox: [400, 300],
    nodes: [
      { id: 'db', kind: 'database', label: 'DB', x: 10, y: 10, width: 80, height: 40 },
      { id: 'cl', kind: 'cloud', label: 'Cloud', x: 100, y: 10, width: 80, height: 40 },
    ],
    edges: [],
    boundaries: [],
    lifelines: [],
  };
  const xml = buildDrawioXml(parsed, 'architecture');
  assert.match(xml, /shape=cylinder3/);
  assert.match(xml, /shape=cloud/);
});

test('buildDrawioXml maps lifecycle state types to shapes', () => {
  const parsed = {
    viewBox: [400, 300],
    nodes: [
      { id: 's', kind: 'start', label: 'Start', x: 10, y: 10, width: 80, height: 40 },
      { id: 'd', kind: 'decision', label: 'Decide', x: 100, y: 10, width: 80, height: 40 },
    ],
    edges: [],
    boundaries: [],
    lifelines: [],
  };
  const xml = buildDrawioXml(parsed, 'lifecycle');
  assert.match(xml, /ellipse;whiteSpace/); // start state
  assert.match(xml, /rhombus;whiteSpace/); // decision state
});

test('buildDrawioXml parents nodes into boundaries via JSON wraps', () => {
  const parsed = {
    viewBox: [400, 300],
    nodes: [
      { id: 'inner', kind: 'backend', label: 'Inner', x: 50, y: 50, width: 80, height: 40 },
    ],
    edges: [],
    boundaries: [{ kind: 'region', label: 'Box', x: 10, y: 10, width: 200, height: 200 }],
    lifelines: [],
  };
  const diagram = { boundaries: [{ wraps: ['inner'] }] };
  const xml = buildDrawioXml(parsed, 'architecture', diagram);
  assert.match(xml, /id="node-inner"[^>]*parent="boundary-0"/);
});

test('buildDrawioXml skips edges with unresolvable endpoints', () => {
  const parsed = {
    viewBox: [400, 300],
    nodes: [{ id: 'a', kind: 'backend', label: 'A', x: 10, y: 10, width: 80, height: 40 }],
    edges: [
      { from: 'a', to: 'ghost', points: [[50, 30], [60, 30]] }, // ghost missing
    ],
    boundaries: [],
    lifelines: [],
  };
  const xml = buildDrawioXml(parsed, 'architecture');
  assert.doesNotMatch(xml, /edge="1"/);
});

test('buildDrawioXml produces XML-parseable output', () => {
  const parsed = {
    viewBox: [400, 300],
    nodes: [
      { id: 'a', kind: 'backend', label: 'A&B', x: 10, y: 10, width: 80, height: 40 },
    ],
    edges: [],
    boundaries: [],
    lifelines: [],
  };
  const xml = buildDrawioXml(parsed, 'architecture');
  // The ampersand in the label must survive as a single &amp; (not double-escaped).
  assert.match(xml, /value="A&amp;B"/);
  assert.doesNotMatch(xml, /A&amp;amp;/);
});

test('convertArchifyToDrawio chains parse + build', () => {
  const svg = `<svg viewBox="0 0 200 100">
    <g id="node-a" data-node-id="a" data-node-label="A" data-node-kind="backend">
      <rect x="10" y="20" width="60" height="40" class="c-mask"/>
    </g>
  </svg>`;
  const xml = convertArchifyToDrawio(svg, 'architecture');
  assert.match(xml, /<mxGraphModel/);
  assert.match(xml, /id="node-a"/);
});

// ─── Integration: CLI end-to-end for all 5 types ────────────────────────────

const EXAMPLES = [
  ['architecture', 'web-app.architecture.json'],
  ['workflow', 'agent-tool-call.workflow.json'],
  ['sequence', 'cache-miss-request.sequence.json'],
  ['dataflow', 'event-stream.dataflow.json'],
  ['lifecycle', 'agent-run.lifecycle.json'],
];

for (const [type, file] of EXAMPLES) {
  test(`cli: export-drawio ${type} produces valid drawio with real bindings`, () => {
    const input = path.join(skillRoot, 'examples', file);
    const output = path.join(tmp, `${type}.drawio`);
    const result = run(['export-drawio', type, input, output]);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(fs.existsSync(output), 'output file created');
    const xml = fs.readFileSync(output, 'utf8');
    assert.match(xml, /<mxGraphModel/);
    assert.match(xml, /edge="1"/);
    // Every edge must reference real vertex cell ids.
    const edgeSources = [...xml.matchAll(/source="(node-[^"]*)"/g)].map((m) => m[1]);
    const edgeTargets = [...xml.matchAll(/target="(node-[^"]*)"/g)].map((m) => m[1]);
    assert.ok(edgeSources.length > 0, `${type} has at least one bound edge`);
    const vertexIds = new Set([...xml.matchAll(/id="(node-[^"]*)"[^>]*vertex="1"/g)].map((m) => m[1]));
    for (const id of [...edgeSources, ...edgeTargets]) {
      assert.ok(vertexIds.has(id), `${type}: edge endpoint ${id} resolves to a real vertex`);
    }
  });
}

test('cli: export-drawio architecture preserves waypoints for routed edges', () => {
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');
  const output = path.join(tmp, 'waypoints.drawio');
  const result = run(['export-drawio', 'architecture', input, output]);
  assert.equal(result.status, 0, result.stderr);
  const xml = fs.readFileSync(output, 'utf8');
  // The web-app example has multi-point routes (e.g. jwt-verification).
  assert.match(xml, /<Array as="points">/);
});

test('cli: export-drawio --json emits structured receipt', () => {
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');
  const output = path.join(tmp, 'json-receipt.drawio');
  const result = run(['export-drawio', 'architecture', input, output, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.command, 'export-drawio');
  assert.equal(receipt.type, 'architecture');
});

test('cli: export-drawio rejects unknown type with exit 2', () => {
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');
  const result = run(['export-drawio', 'bogus', input]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown diagram type/);
});

test('cli: export-drawio rejects unknown option with exit 2', () => {
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');
  const result = run(['export-drawio', 'architecture', input, '--bogus']);
  assert.equal(result.status, 2);
});

test('cli: help lists export-drawio', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /archify export-drawio <type>/);
});

// ─── Strict mode: 1:1 shape/color/corner fidelity ──────────────────────────

test('extractPalette resolves CSS vars, class rules, and blends translucent fills (dark fallback)', () => {
  // No light block: custom templates keep working through the dark fallback.
  const css = `
    :root, [data-theme="dark"] {
      --bg: #020617;
      --mask: #0f172a;
      --text: #ffffff;
      --backend-fill: rgba(6, 78, 59, 0.4);
      /* a comment that must not break parsing */
      --backend-stroke: #34d399;
    }
    .c-backend { fill: var(--backend-fill); stroke: var(--backend-stroke); }
    .c-region  { fill: rgba(251, 191, 36, 0.05); stroke: #fbbf24; stroke-dasharray: 8,4; }
  `;
  const palette = extractPalette(css);
  assert.equal(palette.bg, '#020617');
  assert.equal(palette.mask, '#0f172a');
  assert.equal(palette.text, '#ffffff');
  // rgba(6,78,59,0.4) over mask #0f172a → exact composite.
  const backend = palette.paletteFor('c-backend', 'mask');
  assert.equal(backend.fill, '#0b2d31');
  assert.equal(backend.stroke, '#34d399');
  const region = palette.paletteFor('c-region', 'bg');
  assert.equal(region.dash, '8,4');
  assert.ok(region.fill.startsWith('#'));
});

test('extractPalette always resolves the light theme over the dark default', () => {
  const css = `
    :root, [data-theme="dark"] {
      --bg: #020617; --mask: #0f172a; --text: #ffffff; --text-muted: #94a3b8;
      --backend-fill: rgba(6, 78, 59, 0.4); --backend-stroke: #34d399;
    }
    [data-theme="light"] {
      --bg: #f8fafc; --mask: #ffffff; --text: #0f172a; --text-muted: #64748b;
      --backend-fill: rgba(52, 211, 153, 0.18); --backend-stroke: #059669;
    }
    [data-preset="signal-flow"][data-theme="light"] { --bg: #030711; }
    .c-backend { fill: var(--backend-fill); stroke: var(--backend-stroke); }
  `;
  const palette = extractPalette(css);
  // Light values win; the preset-scoped light block must not be picked up.
  assert.equal(palette.bg, '#f8fafc');
  assert.equal(palette.mask, '#ffffff');
  assert.equal(palette.text, '#0f172a');
  assert.equal(palette.textMuted, '#64748b');
  // rgba(52,211,153,0.18) over the white light-theme mask → light composite.
  const backend = palette.paletteFor('c-backend', 'mask');
  assert.equal(backend.fill, '#daf7ed');
  assert.equal(backend.stroke, '#059669');
});

test('strict build keeps rounded rectangles, exact radii, and colors', () => {
  const parsed = {
    viewBox: [400, 300],
    nodes: [{ id: 'a', kind: 'database', label: 'DB', x: 10, y: 10, width: 80, height: 40, rx: 6, strokeWidth: 1.5, fillClass: 'c-database' }],
    edges: [{
      from: 'a', to: 'a', label: null, points: [[50, 30], [50, 30]], radius: 8, strokeWidth: 1.5, strokeClass: 'a-security',
    }],
    boundaries: [{ kind: 'region', label: 'R', x: 0, y: 0, width: 300, height: 200, rx: 12, strokeWidth: 1, fillClass: 'c-region', labelClass: 't-cloud' }],
    lifelines: [],
    edgeLabels: [],
  };
  const palette = extractPalette(`
    :root, [data-theme="dark"] {
      --bg: #020617; --mask: #0f172a; --text: #ffffff; --text-muted: #94a3b8;
      --database-fill: rgba(76, 29, 149, 0.4); --database-stroke: #a78bfa;
      --cloud-stroke: #fbbf24; --security-stroke: #fb7185;
    }
    [data-theme="light"] {
      --bg: #f8fafc; --mask: #ffffff; --text: #0f172a; --text-muted: #64748b;
      --database-fill: rgba(167, 139, 250, 0.2); --database-stroke: #7c3aed;
      --cloud-stroke: #d97706; --security-stroke: #e11d48;
    }
    .c-database { fill: var(--database-fill); stroke: var(--database-stroke); }
    .c-region { fill: rgba(251,191,36,0.05); stroke: var(--cloud-stroke); stroke-dasharray: 8,4; }
    .t-cloud { fill: var(--cloud-stroke); }
    .a-security { stroke: var(--security-stroke); stroke-dasharray: 5,5; }
  `);
  const xml = buildDrawioXmlStrict(parsed, palette, 'architecture');
  // No draw.io built-in shape substitutions — plain rounded rects.
  assert.doesNotMatch(xml, /shape=cylinder|shape=cloud|shape=shield/);
  // Exact corner radius: rx=6 → absoluteArcSize=1;arcSize=6.
  assert.match(xml, /absoluteArcSize=1;arcSize=6;/);
  // Boundary keeps rx=12 and its dashed pattern from CSS.
  assert.match(xml, /arcSize=12;/);
  assert.match(xml, /dashPattern=8 4/);
  // Edge corner radius: measured 8 → arcSize=16.
  assert.match(xml, /arcSize=16/);
  // Edge keeps the security variant color and dash.
  assert.match(xml, /strokeColor=#e11d48/);
  assert.match(xml, /dashPattern=5 5/);
  // Composited database fill over the light-theme white mask.
  assert.match(xml, /fillColor=#ede8fe/);
  // Always-light export: light page background and dark ink.
  assert.match(xml, /background="#f8fafc"/);
  assert.match(xml, /fontColor=#0f172a/);
});

test('cli: export-drawio --strict emits 1:1 styles for all five types', () => {
  for (const [type, file] of EXAMPLES) {
    const input = path.join(skillRoot, 'examples', file);
    const output = path.join(tmp, `${type}-strict.drawio`);
    const result = run(['export-drawio', type, input, output, '--strict']);
    assert.equal(result.status, 0, result.stderr);
    const xml = fs.readFileSync(output, 'utf8');
    // Always-light palette: light page background and dark ink, exact radii,
    // no built-in shape mapping.
    assert.match(xml, /background="#f8fafc"/, type);
    assert.match(xml, /fontColor=#0f172a/, type);
    assert.doesNotMatch(xml, /background="#020617"/, type);
    assert.match(xml, /absoluteArcSize=1/, type);
    assert.doesNotMatch(xml, /shape=cylinder3|shape=cloud|shape=shield/, type);
    // Real edge bindings survive strict mode.
    const sources = [...xml.matchAll(/source="(node-[^"]*)"/g)].length;
    assert.ok(sources > 0, `${type} keeps bound edges`);
  }
});

test('cli: export-drawio --strict receipt reports strict mode', () => {
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');
  const output = path.join(tmp, 'strict-receipt.drawio');
  const result = run(['export-drawio', 'architecture', input, output, '--strict', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.strict, true);
});

// ─── Sequence: timeline semantics via UML lifelines ────────────────────────

test('parseArchifySvg enriches sequence artifacts (labels, activations, segments, dash)', () => {
  const svg = `<svg viewBox="0 0 820 760">
    <g data-edge-from="user" data-edge-to="web" data-edge-label="open page" data-edge-id="open-page">
      <path data-composition-edge-from="user" data-composition-edge-to="web" data-composition-edge-id="open-page"
            data-composition-points="69,185;163,185" d="M 69 185 L 163 185" class="a-default" stroke-width="1.4" marker-end="url(#arrowhead)"/>
      <g data-detail="context"><rect x="90" y="170" width="52" height="14" class="c-mask"/><text x="116" y="180" class="t-backend">open page</text></g>
    </g>
    <g data-edge-from="api" data-edge-to="user" data-edge-label="page" data-edge-id="page-render">
      <path data-composition-edge-from="api" data-composition-edge-to="user" data-composition-edge-id="page-render"
            data-composition-points="271,662;69,662" d="M 271 662 L 69 662" class="a-default" stroke-width="1.4" stroke-dasharray="3,5"/>
    </g>
    <rect data-graph-role="structural-frame" data-composition-frame-kind="segment" data-composition-frame-id="0"
          x="48" y="150" width="724" height="145" rx="10" class="c-lane" stroke-width="1"/>
    <g data-graph-role="segment-label" data-segment-id="0">
      <rect x="56" y="128" width="60" height="18" rx="3" class="c-mask"/>
      <text x="62" y="141" class="t-dim" font-size="9">Request</text>
    </g>
    <rect data-graph-role="activation" data-activation-participant="web" x="165" y="220" width="10" height="448" rx="3" class="c-mask"/>
    <rect data-graph-role="activation" data-activation-participant="web" x="165" y="220" width="10" height="448" rx="3" class="c-frontend" stroke-width="1"/>
    <path d="M 62 142 L 62 695" class="a-default" stroke-width="0.8" stroke-dasharray="3,7"/>
  </svg>`;
  const parsed = parseArchifySvg(svg, 'sequence');
  assert.equal(parsed.edges.length, 2);
  // Message label comes from the outer focus group, not the path.
  assert.equal(parsed.edges[0].label, 'open page');
  // Return-message dash lives as an inline path attribute.
  assert.equal(parsed.edges[1].inlineDash, '3,5');
  // One activation (the opaque c-mask twin is skipped), with identity.
  assert.equal(parsed.activations.length, 1);
  assert.equal(parsed.activations[0].participant, 'web');
  assert.equal(parsed.activations[0].fillClass, 'c-frontend');
  assert.equal(parsed.activations[0].height, 448);
  // Segment label matched back onto the boundary by segment id.
  assert.equal(parsed.boundaries.length, 1);
  assert.equal(parsed.boundaries[0].label, 'Request');
});

test('sequence build maps the timeline onto UML lifelines', () => {
  const parsed = {
    viewBox: [820, 760],
    nodes: [
      { id: 'user', kind: 'external', label: 'user', x: 19, y: 72, width: 86, height: 54, rx: 6, strokeWidth: 1.5, fillClass: 'c-external' },
      { id: 'web', kind: 'frontend', label: 'web', x: 127, y: 72, width: 86, height: 54, rx: 6, strokeWidth: 1.5, fillClass: 'c-frontend' },
    ],
    edges: [
      { from: 'user', to: 'web', label: 'open page', id: 'open-page', points: [[69, 185], [163, 185]], strokeClass: 'a-default', strokeWidth: 1.4, radius: 0 },
      { from: 'web', to: 'user', label: 'render', id: 'render', points: [[163, 625], [69, 625]], strokeClass: 'a-default', strokeWidth: 1.4, radius: 0, inlineDash: '3,5' },
    ],
    boundaries: [{ kind: 'segment', frameId: '0', label: 'Request', x: 48, y: 150, width: 724, height: 145, rx: 10, strokeWidth: 1, fillClass: 'c-lane' }],
    lifelines: [{ x: 62, y1: 142, y2: 695 }, { x: 170, y1: 142, y2: 695 }],
    activations: [{ participant: 'web', fillClass: 'c-frontend', rx: 3, strokeWidth: 1, x: 165, y: 220, width: 10, height: 448 }],
    edgeLabels: [],
  };
  const palette = extractPalette(`
    [data-theme="light"] {
      --bg: #f8fafc; --mask: #ffffff; --text: #0f172a; --text-muted: #64748b;
      --frontend-fill: rgba(34, 211, 238, 0.15); --frontend-stroke: #0891b2;
      --external-fill: rgba(148, 163, 184, 0.18); --external-stroke: #64748b;
    }
    .c-frontend { fill: var(--frontend-fill); stroke: var(--frontend-stroke); }
    .c-external { fill: var(--external-fill); stroke: var(--external-stroke); }
    .c-lane { fill: rgba(248, 250, 252, 0.65); stroke: #cbd5e1; stroke-dasharray: 6,6; }
    .a-default { stroke: #94a3b8; }
  `);
  const xml = buildDrawioXmlSequence(parsed, palette, 'sequence', { strict: true });
  // Participants become full-timeline UML lifelines (foot 695 - top 72 = 623)
  // with the header height preserved via size.
  assert.match(xml, /shape=umlLifeline;perimeter=lifelinePerimeter/);
  assert.match(xml, /size=54/);
  assert.match(xml, /height="623"/);
  // The authored message y survives as an exit fraction: (185-72)/623.
  assert.match(xml, /exitX=0\.5;exitY=0\.181/);
  assert.match(xml, /value="open page"/);
  // Return message keeps its inline dash.
  assert.match(xml, /dashPattern=3 5/);
  // Activation is a kind-colored child of its lifeline.
  assert.match(xml, /id="activation-0"[^>]*parent="node-web"/);
  assert.match(xml, /fillColor=#def8fc/);
  // Segment band keeps its authored label and lane dash.
  assert.match(xml, /id="boundary-0" value="Request"/);
  assert.match(xml, /dashPattern=6 6/);
  // No floating lifeline edges remain.
  assert.doesNotMatch(xml, /endArrow=none/);

  // Non-strict keeps the same topology with draw.io's default palette.
  const plain = buildDrawioXmlSequence(parsed, null, 'sequence', { strict: false });
  assert.match(plain, /shape=umlLifeline/);
  assert.match(plain, /exitX=0\.5;exitY=0\.181/);
  assert.doesNotMatch(plain, /background="/);
});

test('cli: export-drawio sequence --strict restores the timeline', () => {
  const input = path.join(skillRoot, 'examples/cache-miss-request.sequence.json');
  const output = path.join(tmp, 'sequence-timeline.drawio');
  const result = run(['export-drawio', 'sequence', input, output, '--strict']);
  assert.equal(result.status, 0, result.stderr);
  const xml = fs.readFileSync(output, 'utf8');
  assert.match(xml, /shape=umlLifeline/);
  assert.match(xml, /value="open page"/);
  assert.match(xml, /exitX=0\.5;exitY=0\.181/);
  assert.match(xml, /parent="node-web"/);
  assert.match(xml, /value="Request"/);
  assert.doesNotMatch(xml, /endArrow=none/);
});

// ─── Regressions from the draw.io export code review ────────────────────────

test('buildDrawioXml escapes quotes in edge labels (raw-input callers)', () => {
  const parsed = {
    viewBox: [400, 300],
    nodes: [
      { id: 'a', kind: 'backend', label: 'A', x: 10, y: 10, width: 80, height: 40 },
      { id: 'b', kind: 'backend', label: 'B', x: 200, y: 10, width: 80, height: 40 },
    ],
    edges: [{ from: 'a', to: 'b', label: 'say "hi" now', points: [[90, 30], [200, 30]] }],
    boundaries: [],
    lifelines: [],
  };
  const xml = buildDrawioXml(parsed, 'architecture');
  // Attribute-safe: the quote survives as a single entity, never a raw ",
  // so direct builder calls with un-escaped labels stay well-formed XML.
  assert.match(xml, /value="say &quot;hi&quot; now"/);
});

test('wraps parenting survives a boundary skipped by the SVG parser', () => {
  const parsed = {
    viewBox: [400, 300],
    nodes: [{ id: 'kept', kind: 'backend', label: 'Kept', x: 50, y: 50, width: 60, height: 30 }],
    edges: [],
    // Only the SECOND JSON boundary rendered; it kept its authored frame-id,
    // so the parsed list is shorter than diagram.boundaries.
    boundaries: [{ kind: 'region', label: 'Inner', frameId: '1', x: 40, y: 40, width: 200, height: 120 }],
    lifelines: [],
  };
  const diagram = { boundaries: [{ wraps: ['ghost'] }, { wraps: ['kept'] }] };
  const xml = buildDrawioXml(parsed, 'architecture', diagram);
  // The surviving wrap resolves to the REAL parsed cell (boundary-0) instead
  // of a positional boundary-1 that was never emitted.
  assert.match(xml, /id="node-kept"[^>]*parent="boundary-0"/);
  assert.doesNotMatch(xml, /parent="boundary-1"/);
});

test('sequence builder tolerates an empty participant set (no NaN geometry)', () => {
  const parsed = { viewBox: [820, 760], nodes: [], edges: [], boundaries: [], lifelines: [], activations: [], edgeLabels: [] };
  const palette = extractPalette('[data-theme="light"] { --bg: #f8fafc; --mask: #ffffff; --text: #0f172a; --text-muted: #64748b; }');
  const xml = buildDrawioXmlSequence(parsed, palette, null, { strict: true });
  assert.match(xml, /<mxGraphModel/);
  assert.doesNotMatch(xml, /NaN/);
});

test('cli: export-drawio --strict default output uses the -strict.drawio suffix', () => {
  const input = path.join(tmp, 'naming.json');
  fs.copyFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), input);
  const result = run(['export-drawio', 'architecture', input, '--strict']);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(
    fs.existsSync(path.join(tmp, 'naming-strict.drawio')),
    'default strict name matches the viewer button (-strict.drawio)',
  );
});

// ─── Parity: viewer and Node converters stay in lockstep ────────────────────

// The viewer's inline converter (assets/template.html) and the Node converter
// (renderers/shared/svg-to-drawio.mjs) are hand-mirrored implementations of
// the non-strict export. Extract the viewer section from the live template
// and assert both produce byte-identical XML for a real artifact, so editing
// one side without the other fails here instead of drifting silently.
// (The strict and sequence paths need a live DOM for computed styles and so
// cannot run under Node; this guards the shared regex-parsing core.)
function viewerConverterFromTemplate() {
  const template = fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8');
  const start = template.indexOf('var DRAWIO_KIND_STYLE');
  const end = template.indexOf('// ---- draw.io strict export');
  assert.ok(start !== -1 && end !== -1 && start < end, 'template.html drawio converter section not found — anchor moved?');
  const documentShim = { documentElement: { getAttribute: () => 'architecture' } };
  return new Function('document', `"use strict";\n${template.slice(start, end)}\nreturn archifySvgToDrawio;`)(documentShim);
}

test('viewer and Node non-strict converters emit identical XML', () => {
  const htmlOut = path.join(tmp, 'parity.html');
  const rendered = run(['render', 'architecture', path.join(skillRoot, 'examples/web-app.architecture.json'), htmlOut]);
  assert.equal(rendered.status, 0, rendered.stderr);
  const svg = extractSvgFromHtml(fs.readFileSync(htmlOut, 'utf8'));
  const nodeXml = convertArchifyToDrawio(svg, 'architecture');
  const viewerXml = viewerConverterFromTemplate()(svg);
  assert.equal(viewerXml, nodeXml);
});
