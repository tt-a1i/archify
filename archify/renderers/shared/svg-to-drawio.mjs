/**
 * Archify SVG → draw.io converter.
 *
 * Converts a rendered Archify SVG (embedded in the standalone HTML artifact)
 * into draw.io mxGraphModel XML. The SVG is a fully self-describing source:
 * every node carries `data-node-id/kind/label`, every edge carries
 * `data-edge-from/to/id` plus `data-composition-points` (the complete routed
 * polyline including computed anchors), and every boundary carries
 * `data-graph-role="structural-frame"`.
 *
 * Design goals:
 *  - Preserve the exact rendered geometry (coordinates come from the SVG,
 *    never recomputed).
 *  - Real topology: draw.io edges bind source/target to vertex cell ids so
 *    dragging a box keeps its connections intact.
 *  - Fixed waypoints: the authored/computed route is pinned via
 *    `<Array as="points">` so the line shape is preserved.
 *  - Zero runtime dependencies (pure Node ESM, no DOM/cheerio/jsdom).
 */

// ─── XML helpers ────────────────────────────────────────────────────────────

const ATTR_ESCAPE = { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;', "'": '&#39;' };

function escapeAttr(value) {
  return String(value ?? '').replace(/[&"<>']/g, (ch) => ATTR_ESCAPE[ch]);
}

function escapeText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Extract the value of a `name="value"` attribute from an SVG element tag.
 * Returns null when absent.
 */
function attr(tag, name) {
  const re = new RegExp(`\\s${name}="([^"]*)"`);
  const match = tag.match(re);
  return match ? match[1] : null;
}

// ─── SVG parsing ────────────────────────────────────────────────────────────

const NODE_G_RE = /<g\s+id="node-[^"]*"[^>]*data-node-id="[^"]*"[^>]*>/g;
const RECT_RE = /<rect\b[^>]*>/g;
const NUM = '([-\\d.]+)';

function parseRect(tag) {
  const x = parseFloat(attr(tag, 'x') || '0');
  const y = parseFloat(attr(tag, 'y') || '0');
  const width = parseFloat(attr(tag, 'width') || '0');
  const height = parseFloat(attr(tag, 'height') || '0');
  return { x, y, width, height };
}

/**
 * Parse a `data-composition-points="x,y;x,y;..."` value into [[x,y],...].
 */
function parsePoints(value) {
  if (!value) return [];
  return value
    .split(';')
    .filter(Boolean)
    .map((pair) => {
      const [x, y] = pair.split(',').map(Number);
      return [x, y];
    });
}

/**
 * Find the first <rect .../> child of a <g>...</g> block and return its box.
 * The node's geometry lives in the first rect (the c-mask background rect,
 * which shares x/y/width/height with the fill rect on top of it).
 */
function firstRectInGroup(gOpenTag, groupCloseIndex, svg) {
  const searchStart = gOpenTag.index + gOpenTag[0].length;
  const inner = svg.slice(searchStart, groupCloseIndex);
  const rectMatch = inner.match(RECT_RE);
  if (!rectMatch) return null;
  return parseRect(rectMatch[0]);
}

/**
 * Among the rects inside a node <g>, find the FILL rect: the c-* rect that is
 * not the opaque c-mask backdrop. Sigil decoration rects are smaller, so the
 * largest non-mask c- rect wins. Returns the full rect tag (for class/rx/
 * stroke-width) or null.
 */
function fillRectInGroup(gOpenTag, groupCloseIndex, svg) {
  const searchStart = gOpenTag.index + gOpenTag[0].length;
  const inner = svg.slice(searchStart, groupCloseIndex);
  let best = null;
  let bestArea = -1;
  for (const m of inner.matchAll(RECT_RE)) {
    const cls = attr(m[0], 'class') || '';
    if (!cls.startsWith('c-') || cls === 'c-mask') continue;
    const box = parseRect(m[0]);
    const area = box.width * box.height;
    if (area > bestArea) {
      bestArea = area;
      best = m[0];
    }
  }
  return best;
}

/**
 * Measure the corner rounding radius from an SVG path's `d` attribute. The
 * renderers round polyline corners with quadratic curves ("L a b Q cx cy d e");
 * the radius is the distance from the incoming point to the control point.
 * Returns 0 for sharp polylines.
 */
function cornerRadiusFromD(d) {
  if (!d) return 0;
  const m = d.match(/L\s*(-?[\d.]+)\s+(-?[\d.]+)\s+Q\s*(-?[\d.]+)\s+(-?[\d.]+)/);
  if (!m) return 0;
  const dx = parseFloat(m[3]) - parseFloat(m[1]);
  const dy = parseFloat(m[4]) - parseFloat(m[2]);
  return Math.round(Math.hypot(dx, dy));
}

/**
 * Parse edge label groups: `<g data-detail="context" data-edge-from=...>`
 * wrapping a mask rect plus a positioned <text>. The text x/y anchor gives the
 * exact label position (y is the text baseline; the visual center sits ~4px
 * above it at font-size 8).
 */
const EDGE_LABEL_RE = /<g\b[^>]*\bdata-detail="context"[^>]*\bdata-edge-from="([^"]*)"[^>]*\bdata-edge-to="([^"]*)"[^>]*>[\s\S]*?<text\b[^>]*\bx="(-?[\d.]+)"[^>]*\by="(-?[\d.]+)"[^>]*\bclass="([^"]*)"[^>]*>([^<]*)<\/text>/g;

function parseEdgeLabels(svg) {
  const labels = [];
  for (const m of svg.matchAll(EDGE_LABEL_RE)) {
    labels.push({
      from: m[1],
      to: m[2],
      x: parseFloat(m[3]),
      y: parseFloat(m[4]) - 4,
      className: m[5],
      label: m[6],
    });
  }
  return labels;
}

/**
 * Locate the matching </g> for a <g ...> opening tag (naive depth scan).
 */
function findGroupClose(svg, openIndex) {
  let depth = 1;
  let i = openIndex;
  while (depth > 0 && i < svg.length) {
    const nextOpen = svg.indexOf('<g', i + 1);
    const nextClose = svg.indexOf('</g>', i + 1);
    if (nextClose === -1) return -1;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen;
    } else {
      depth -= 1;
      i = nextClose;
    }
  }
  return i;
}

/**
 * Parse all nodes from the SVG: each `<g id="node-..." data-node-id=...>`
 * carries identity + the first inner <rect> carries geometry.
 */
function parseNodes(svg) {
  const nodes = [];
  const matches = [...svg.matchAll(NODE_G_RE)];
  for (const m of matches) {
    const openTag = m[0];
    const closeIndex = findGroupClose(svg, m.index);
    const gOpen = { index: m.index, [0]: openTag };
    const box = firstRectInGroup(gOpen, closeIndex, svg);
    if (!box) continue;
    const fillTag = fillRectInGroup(gOpen, closeIndex, svg) || '';
    nodes.push({
      id: attr(openTag, 'data-node-id'),
      kind: attr(openTag, 'data-node-kind') || 'backend',
      label: attr(openTag, 'data-node-label') || '',
      sublabel: attr(openTag, 'data-node-sublabel'),
      tag: attr(openTag, 'data-node-tag'),
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      // Strict-mode visual fields (all optional; fall back gracefully).
      fillClass: fillTag ? attr(fillTag, 'class') : null,
      rx: fillTag ? parseFloat(attr(fillTag, 'rx') || '0') : 0,
      strokeWidth: fillTag ? parseFloat(attr(fillTag, 'stroke-width') || '1.5') : 1.5,
    });
  }
  return nodes;
}

/**
 * Parse all edges from the SVG. Each rendered connection is a `<path>` that
 * carries `data-composition-points` (the complete routed polyline). Two
 * attribute-prefix conventions exist across renderers:
 *  (a) architecture/workflow/dataflow/lifecycle —
 *      `<path data-edge-from=.. data-edge-to=.. data-edge-id=..
 *             data-composition-points=..>`
 *  (b) sequence — the outer `<g data-edge-..>` holds the label, while the
 *      inner `<path data-composition-edge-from=.. data-composition-edge-to=..
 *             data-composition-edge-id=.. data-composition-points=..>`
 *      holds the geometry.
 *
 * We anchor exclusively on paths that carry `data-composition-points`: this
 * naturally skips the label-wrapper `<g>` duplicates (which have no points)
 * and yields exactly one entry per connection.
 */
const EDGE_POINTS_RE = /<path\b[^>]*\bdata-composition-points="([^"]*)"[^>]*>/g;

function parseEdges(svg) {
  const edges = [];
  const matches = [...svg.matchAll(EDGE_POINTS_RE)];
  for (const m of matches) {
    const tag = m[0];
    const points = parsePoints(m[1]);
    if (points.length < 2) continue;
    // Accept either prefix; sequence uses data-composition-edge-*.
    const from = attr(tag, 'data-edge-from') || attr(tag, 'data-composition-edge-from');
    const to = attr(tag, 'data-edge-to') || attr(tag, 'data-composition-edge-to');
    if (!from || !to) continue;
    const label = attr(tag, 'data-edge-label') || attr(tag, 'data-composition-edge-label');
    const id = attr(tag, 'data-edge-id') || attr(tag, 'data-composition-edge-id');
    edges.push({
      from, to, label, id, points,
      // Strict-mode visual fields.
      strokeClass: attr(tag, 'class'),
      strokeWidth: parseFloat(attr(tag, 'stroke-width') || '1.5'),
      radius: cornerRadiusFromD(attr(tag, 'd')),
    });
  }
  return edges;
}

/**
 * Parse structural frames (boundaries, lanes, stages, segments) that act as
 * containers. Only the geometry + label come from the SVG; the membership
 * (which nodes belong inside) is resolved from the JSON IR by the caller.
 */
function parseBoundaries(svg) {
  const boundaries = [];
  const re = /<rect\b[^>]*\bdata-graph-role="structural-frame"[^>]*>/g;
  const matches = [...svg.matchAll(re)];
  for (const m of matches) {
    const tag = m[0];
    const kind = attr(tag, 'data-composition-frame-kind') || 'boundary';
    const frameId = attr(tag, 'data-composition-frame-id');
    const box = parseRect(tag);
    if (box.width <= 0 || box.height <= 0) continue;
    // The boundary label lives in the <text> immediately following the rect.
    let label = '';
    let labelClass = null;
    const afterRect = svg.slice(m.index + tag.length, m.index + tag.length + 300);
    const textMatch = afterRect.match(/<text\b([^>]*)>([^<]*)<\/text>/);
    if (textMatch) {
      label = textMatch[2].trim();
      labelClass = attr(`<text ${textMatch[1]}>`, 'class');
    }
    boundaries.push({
      kind, frameId, label, ...box,
      // Strict-mode visual fields.
      fillClass: attr(tag, 'class'),
      rx: parseFloat(attr(tag, 'rx') || '0'),
      strokeWidth: parseFloat(attr(tag, 'stroke-width') || '1'),
      labelClass,
    });
  }
  return boundaries;
}

/**
 * Parse sequence lifelines: vertical dashed `<path d="M cx top L cx bottom">`.
 * These are rendered as standalone vertical lines (not connected edges).
 */
function parseLifelines(svg) {
  const lifelines = [];
  // The stroke-dasharray guard keeps solid vertical edges (e.g. lifecycle
  // drop transitions) from being mistaken for sequence lifelines.
  const re = /<path\b[^>]*\bd="M\s*(\d+\.?\d*)\s+(\d+\.?\d*)\s+L\s*\1\s+(\d+\.?\d*)"[^>]*stroke-dasharray[^>]*>/g;
  const matches = [...svg.matchAll(re)];
  for (const m of matches) {
    lifelines.push({
      x: parseFloat(m[1]),
      y1: parseFloat(m[2]),
      y2: parseFloat(m[3]),
      strokeClass: attr(m[0], 'class'),
      strokeWidth: parseFloat(attr(m[0], 'stroke-width') || '0.8'),
    });
  }
  return lifelines;
}

/**
 * Extract the full self-describing intermediate representation from an
 * Archify SVG string.
 */
export function parseArchifySvg(svg, _diagramType) {
  const viewBoxMatch = svg.match(/<svg[^>]*\bviewBox="0 0 (\d+\.?\d*) (\d+\.?\d*)"/);
  const viewBox = viewBoxMatch
    ? [parseFloat(viewBoxMatch[1]), parseFloat(viewBoxMatch[2])]
    : [1000, 700];
  return {
    viewBox,
    nodes: parseNodes(svg),
    edges: parseEdges(svg),
    boundaries: parseBoundaries(svg),
    lifelines: parseLifelines(svg),
    edgeLabels: parseEdgeLabels(svg),
  };
}

// ─── draw.io style mapping ──────────────────────────────────────────────────

/**
 * Map an Archify component kind to a draw.io base style string.
 * Uses draw.io's built-in shapes so each type reads with correct semantics.
 */
const KIND_STYLE = {
  frontend: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;',
  backend: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;',
  database: 'shape=cylinder3;whiteSpace=wrap;html=1;boundedLbl=1;backgroundOutline=1;size=15;fillColor=#fff2cc;strokeColor=#d6b656;',
  cloud: 'ellipse;shape=cloud;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;',
  security: 'shape=shield;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;',
  messagebus: 'shape=queue;whiteSpace=wrap;html=1;fillColor=#e1d5e7;strokeColor=#9673a6;',
  external: 'shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;',
};

/**
 * Map lifecycle state types (start/active/decision/...) to draw.io styles.
 */
const STATE_STYLE = {
  start: 'ellipse;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;',
  active: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;',
  waiting: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#fff2cc;strokeColor=#d6b656;',
  decision: 'rhombus;whiteSpace=wrap;html=1;fillColor=#ffe6cc;strokeColor=#d79b00;',
  success: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#d5e8d4;strokeColor=#82b366;strokeWidth=2;',
  failure: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;strokeWidth=2;',
  neutral: 'rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#666666;',
  external: 'shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;fillColor=#f8cecc;strokeColor=#b85450;',
};

/**
 * Map boundary/frame kinds to container styles.
 */
const FRAME_STYLE = {
  region: 'rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#9673a6;dashed=0;verticalAlign=top;fontStyle=1;',
  'security-group': 'rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#d79b00;dashed=1;verticalAlign=top;fontStyle=1;',
  lane: 'rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#b0b0b0;verticalAlign=top;align=left;spacingLeft=8;',
  'exception-lane': 'rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#b85450;dashed=1;verticalAlign=top;align=left;spacingLeft=8;',
  stage: 'rounded=0;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#b0b0b0;verticalAlign=top;align=center;fontStyle=1;',
  group: 'rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#6c8ebf;dashed=1;verticalAlign=top;',
  segment: 'rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#b0b0b0;verticalAlign=top;align=left;spacingLeft=8;',
};

const VARIANT_EDGE_STYLE = {
  default: 'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#666666;',
  emphasis: 'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#0891b2;strokeWidth=2;',
  security: 'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#d79b00;strokeWidth=2;',
  dashed: 'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#666666;dashed=1;',
  return: 'edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#82b366;dashed=1;',
};

/**
 * Pick a node style. Lifecycle states use their own type enum; everything
 * else uses the componentType map.
 */
function nodeStyle(node, diagramType) {
  if (diagramType === 'lifecycle' && STATE_STYLE[node.kind]) {
    return STATE_STYLE[node.kind];
  }
  return KIND_STYLE[node.kind] || KIND_STYLE.backend;
}

// ─── draw.io XML generation ─────────────────────────────────────────────────

const LIFELINE_STYLE = 'endArrow=none;html=1;strokeColor=#999999;dashed=1;dashPattern=3 7;';

/**
 * Resolve which boundary each node belongs to. Membership is taken from the
 * JSON IR (the `wraps` field on architecture boundaries) when available;
 * otherwise we fall back to geometric containment (node center inside frame).
 *
 * Returns a Map<nodeId, {drawioId, offsetX, offsetY}> where offsetX/Y is the
 * parent container's top-left corner — needed because draw.io child cell
 * coordinates are RELATIVE to their parent, not absolute.
 */
function resolveContainerParents(parsed, diagram) {
  const parents = new Map();
  const boundaries = parsed.boundaries;
  if (!boundaries.length) return parents;

  // Prefer explicit wraps from the JSON IR (architecture).
  const explicit = Array.isArray(diagram?.boundaries);
  if (explicit) {
    for (let i = 0; i < diagram.boundaries.length; i += 1) {
      const b = diagram.boundaries[i];
      const drawioId = `boundary-${i}`;
      const frame = boundaries[i] || { x: 0, y: 0 };
      for (const wrappedId of b.wraps || []) {
        // Innermost wins: a node wrapped by multiple boundaries (e.g.
        // region + security-group) parents to the last/most-specific one.
        parents.set(wrappedId, { drawioId, offsetX: frame.x, offsetY: frame.y });
      }
    }
    return parents;
  }

  // Geometric fallback: assign each node to the smallest boundary whose rect
  // contains the node's center.
  const candidates = boundaries
    .map((b, i) => ({ ...b, drawioId: `boundary-${i}` }))
    .sort((a, b) => a.width * a.height - b.width * b.height);
  for (const node of parsed.nodes) {
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;
    for (const b of candidates) {
      if (cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height) {
        parents.set(node.id, { drawioId: b.drawioId, offsetX: b.x, offsetY: b.y });
        break;
      }
    }
  }
  return parents;
}

/**
 * Build the mxGraphModel XML from the parsed SVG representation.
 * `diagram` is the original JSON IR (used only for boundary `wraps`).
 */
export function buildDrawioXml(parsed, diagramType, diagram = null) {
  const [vw, vh] = parsed.viewBox;
  const nodeParents = resolveContainerParents(parsed, diagram);
  const nodeIdOf = (id) => `node-${id}`;

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<mxGraphModel dx="${Math.round(vw)}" dy="${Math.round(vh)}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${Math.round(vw)}" pageHeight="${Math.round(vh)}" math="0" shadow="0">`,
  );
  lines.push('  <root>');
  lines.push('    <mxCell id="0"/>');
  lines.push('    <mxCell id="1" parent="0"/>');

  // Boundaries first (they become parent containers).
  for (let i = 0; i < parsed.boundaries.length; i += 1) {
    const b = parsed.boundaries[i];
    const id = `boundary-${i}`;
    const style = FRAME_STYLE[b.kind] || FRAME_STYLE.region;
    lines.push(
      `    <mxCell id="${id}" value="${escapeAttr(b.label || b.kind)}" style="${style}" vertex="1" parent="1">`,
    );
    lines.push(
      `      <mxGeometry x="${Math.round(b.x)}" y="${Math.round(b.y)}" width="${Math.round(b.width)}" height="${Math.round(b.height)}" as="geometry"/>`,
    );
    lines.push('    </mxCell>');
  }

  // Nodes.
  for (const node of parsed.nodes) {
    const id = nodeIdOf(node.id);
    const style = nodeStyle(node, diagramType);
    const parentInfo = nodeParents.get(node.id);
    const parentId = parentInfo ? parentInfo.drawioId : '1';
    // draw.io child cells use coordinates RELATIVE to their parent container.
    // Subtract the parent's origin so the node lands at its authored position.
    const relX = node.x - (parentInfo ? parentInfo.offsetX : 0);
    const relY = node.y - (parentInfo ? parentInfo.offsetY : 0);
    const labelParts = [node.label, node.sublabel, node.tag].filter(Boolean);
    // Build the draw.io label as an HTML fragment. The raw text is inserted
    // without pre-escaping (Archify labels are already user-facing copy, not
    // markup); the whole fragment is then XML-attribute-escaped once so that
    // the HTML tags survive as entities and draw.io decodes+renders them.
    const htmlValue = labelParts.length > 1
      ? `<b>${labelParts[0]}</b><br/><font style="font-size:9px">${labelParts.slice(1).join(' · ')}</font>`
      : node.label;
    const value = escapeAttr(htmlValue);
    lines.push(
      `    <mxCell id="${id}" value="${value}" style="${style}" vertex="1" parent="${parentId}">`,
    );
    lines.push(
      `      <mxGeometry x="${Math.round(relX)}" y="${Math.round(relY)}" width="${Math.round(node.width)}" height="${Math.round(node.height)}" as="geometry"/>`,
    );
    lines.push('    </mxCell>');
  }

  // Sequence lifelines (standalone vertical dashed edges, no source/target).
  for (const ll of parsed.lifelines) {
    const id = `lifeline-${Math.round(ll.x)}-${Math.round(ll.y1)}`;
    lines.push(
      `    <mxCell id="${id}" value="" style="${LIFELINE_STYLE}" edge="1" parent="1">`,
    );
    lines.push('      <mxGeometry relative="1" as="geometry">');
    lines.push(
      `        <mxPoint x="${Math.round(ll.x)}" y="${Math.round(ll.y1)}" as="sourcePoint"/>`,
    );
    lines.push(
      `        <mxPoint x="${Math.round(ll.x)}" y="${Math.round(ll.y2)}" as="targetPoint"/>`,
    );
    lines.push('      </mxGeometry>');
    lines.push('    </mxCell>');
  }

  // Edges: real source/target binding + fixed waypoints.
  for (let i = 0; i < parsed.edges.length; i += 1) {
    const edge = parsed.edges[i];
    const sourceId = nodeIdOf(edge.from);
    const targetId = nodeIdOf(edge.to);
    const id = edge.id ? `edge-${edge.id}` : `edge-${i}`;
    const style = VARIANT_EDGE_STYLE.default;
    const value = edge.label ? escapeText(edge.label) : '';
    const hasValidBinding = parsed.nodes.some((n) => n.id === edge.from)
      && parsed.nodes.some((n) => n.id === edge.to);
    if (!hasValidBinding) continue;
    lines.push(
      `    <mxCell id="${id}" value="${value}" style="${style}" edge="1" parent="1" source="${sourceId}" target="${targetId}">`,
    );
    lines.push('      <mxGeometry relative="1" as="geometry">');
    if (edge.points && edge.points.length >= 2) {
      // Drop the first and last points: draw.io computes them from the
      // boundied source/target vertices. Keep the interior waypoints so the
      // authored route shape is preserved.
      const interior = edge.points.slice(1, -1);
      if (interior.length) {
        lines.push('        <Array as="points">');
        for (const [x, y] of interior) {
          lines.push(`          <mxPoint x="${Math.round(x)}" y="${Math.round(y)}"/>`);
        }
        lines.push('        </Array>');
      }
    }
    lines.push('      </mxGeometry>');
    lines.push('    </mxCell>');
  }

  lines.push('  </root>');
  lines.push('</mxGraphModel>');
  return lines.join('\n');
}

/**
 * One-shot convenience: parse an Archify SVG and emit draw.io XML.
 * Pass `{ strict: true, css }` to emit the 1:1 visual-fidelity variant.
 */
export function convertArchifyToDrawio(svg, diagramType, diagram = null, options = {}) {
  const parsed = parseArchifySvg(svg, diagramType);
  if (options.strict) {
    const palette = extractPalette(options.css || '');
    return buildDrawioXmlStrict(parsed, palette, diagramType, diagram);
  }
  return buildDrawioXml(parsed, diagramType, diagram);
}

/**
 * Extract the inner `<svg>...</svg>` fragment from a rendered Archify HTML
 * artifact. Returns the SVG string (without the surrounding HTML).
 */
export function extractSvgFromHtml(html) {
  const start = html.indexOf('<svg');
  const end = html.indexOf('</svg>');
  if (start === -1 || end === -1) {
    throw new Error('No <svg> element found in the rendered HTML artifact.');
  }
  return html.slice(start, end + '</svg>'.length);
}

// ─── Strict palette: resolve Archify CSS to concrete colors ────────────────

function parseColorValue(value) {
  const v = String(value).trim();
  const rgba = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (rgba) {
    return { r: parseFloat(rgba[1]), g: parseFloat(rgba[2]), b: parseFloat(rgba[3]), a: rgba[4] === undefined ? 1 : parseFloat(rgba[4]) };
  }
  const hex = v.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    return {
      r: parseInt(hex[1].slice(0, 2), 16),
      g: parseInt(hex[1].slice(2, 4), 16),
      b: parseInt(hex[1].slice(4, 6), 16),
      a: 1,
    };
  }
  return null;
}

function colorToHex(c) {
  const h = (n) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/**
 * Alpha-composite `fg` over an opaque `bg`. Semi-transparent Archify fills
 * (e.g. rgba(8, 51, 68, 0.4)) sit on an opaque mask or page background, so the
 * pre-composited hex reproduces the rendered pixel exactly in draw.io, which
 * has no two-layer shape fill.
 */
function blendOver(fg, bg) {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

/**
 * Extract the visual palette from the rendered artifact's CSS. Resolves the
 * dark-theme variable block (the artifact's default) plus the plain `.class`
 * rules (fill / stroke / stroke-dasharray). Preset-scoped rules such as
 * `svg[data-preset=…] .c-x` are intentionally skipped because their selectors
 * do not start at a class name.
 */
export function extractPalette(css) {
  // Comments inside declaration blocks would break per-`;` splitting.
  const cleanCss = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  // Variable blocks: ":root, [data-theme=\"dark\"] { ... }" (artifact default).
  const vars = {};
  const rootBlock = cleanCss.match(/:root\s*,\s*\[data-theme="dark"\]\s*\{([^}]*)\}/);
  if (rootBlock) {
    for (const rawDecl of rootBlock[1].split(';')) {
      const m = rawDecl.trim().match(/^([\w-]+)\s*:\s*(.+)$/);
      if (m) vars[m[1]] = m[2].trim();
    }
  }
  const resolveVar = (value) => {
    let v = String(value || '').trim();
    for (let depth = 0; depth < 8; depth += 1) {
      const m = v.match(/^var\(\s*([\w-]+)\s*(?:,\s*([^)]+))?\)$/);
      if (!m) return v;
      v = vars[m[1]] ?? (m[2] ? m[2].trim() : '');
    }
    return v;
  };
  // Plain class rules only (line-start selectors).
  const rules = {};
  const ruleRe = /^[ \t]*\.([A-Za-z][\w-]*)\s*\{([^}]*)\}/gm;
  for (const m of cleanCss.matchAll(ruleRe)) {
    const decls = {};
    for (const rawDecl of m[2].split(';')) {
      const d = rawDecl.trim().match(/^([\w-]+)\s*:\s*(.+)$/);
      if (d) decls[d[1]] = d[2].trim();
    }
    rules[m[1]] = decls;
  }
  const maskColor = parseColorValue(resolveVar(vars['--mask'] || '#ffffff')) || { r: 255, g: 255, b: 255, a: 1 };
  const bgColor = parseColorValue(resolveVar(vars['--bg'] || '#ffffff')) || { r: 255, g: 255, b: 255, a: 1 };
  const textColor = parseColorValue(resolveVar(vars['--text'] || '#000000')) || { r: 0, g: 0, b: 0, a: 1 };
  const mutedColor = parseColorValue(resolveVar(vars['--text-muted'] || '#888888')) || { r: 136, g: 136, b: 136, a: 1 };

  /**
   * Resolve a class to concrete colors. `over` picks the compositing base:
   * 'mask' for node fills (mask + translucent fill), 'bg' for frames.
   */
  const paletteFor = (className, over = 'mask') => {
    const decls = rules[className];
    if (!decls) return null;
    const base = over === 'mask' ? maskColor : bgColor;
    const out = {};
    if (decls.fill) {
      const raw = parseColorValue(resolveVar(decls.fill));
      if (raw) out.fill = colorToHex(raw.a >= 1 ? raw : blendOver(raw, base));
    }
    if (decls.stroke) {
      const raw = parseColorValue(resolveVar(decls.stroke));
      if (raw) out.stroke = colorToHex(raw.a >= 1 ? raw : blendOver(raw, base));
    }
    if (decls['stroke-dasharray']) {
      out.dash = resolveVar(decls['stroke-dasharray']).replace(/\s+/g, ' ').trim();
    }
    return out;
  };

  return {
    paletteFor,
    mask: colorToHex(maskColor),
    bg: colorToHex(bgColor),
    text: colorToHex(textColor),
    textMuted: colorToHex(mutedColor),
  };
}

// ─── Strict builder: 1:1 shape / color / corner fidelity ───────────────────

const FALLBACK_NODE_FILL = '#d5e8d4';
const FALLBACK_STROKE = '#82b366';

function normalizeDash(dash) {
  if (!dash) return null;
  const parts = dash.split(/[\s,]+/).filter(Boolean).map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return parts.join(' ');
}

/** Pin the exact authored connection point on a node border (0..1 floats). */
function borderFraction(point, node) {
  if (!node || !node.width || !node.height) return null;
  const fx = (point[0] - node.x) / node.width;
  const fy = (point[1] - node.y) / node.height;
  // Snap near-border values so draw.io treats them as side anchors.
  const snap = (v) => (v < 0.04 ? 0 : v > 0.96 ? 1 : Math.round(v * 100) / 100);
  return [snap(fx), snap(fy)];
}

/**
 * Fraction t∈[0,1] along the polyline where the point closest to `target`
 * sits (used to position edge labels at their authored location).
 */
function fractionAlongPolyline(points, target) {
  let total = 0;
  const segs = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    segs.push({ ax, ay, dx: bx - ax, dy: by - ay, len, start: total });
    total += len;
  }
  let best = Infinity;
  let result = 0.5;
  for (const s of segs) {
    const t = Math.max(0, Math.min(1, ((target[0] - s.ax) * s.dx + (target[1] - s.ay) * s.dy) / (s.len * s.len)));
    const px = s.ax + t * s.dx;
    const py = s.ay + t * s.dy;
    const dist = Math.hypot(target[0] - px, target[1] - py);
    if (dist < best) {
      best = dist;
      result = (s.start + t * s.len) / (total || 1);
    }
  }
  return Math.max(0, Math.min(1, result));
}

/**
 * Build the strict (1:1) mxGraphModel: every node keeps the Archify rounded
 * rectangle with its exact corner radius, exact composited fill/stroke colors,
 * exact stroke width and dash pattern; edges keep their exact routed polyline
 * with the measured corner radius (`arcSize` = 2 × radius in draw.io) and their
 * exact anchor points pinned via exitX/exitY / entryX/entryY.
 */
export function buildDrawioXmlStrict(parsed, palette, diagramType, diagram = null) {
  const [vw, vh] = parsed.viewBox;
  const nodeParents = resolveContainerParents(parsed, diagram);
  const nodeById = new Map(parsed.nodes.map((n) => [n.id, n]));
  const FONT_STACK = 'JetBrains Mono,ui-monospace,Menlo,monospace';

  const strictNodeStyle = (node) => {
    const colors = node.fillClass ? palette.paletteFor(node.fillClass, 'mask') : null;
    const rx = Number.isFinite(node.rx) && node.rx > 0 ? Math.round(node.rx) : 0;
    const sw = Number.isFinite(node.strokeWidth) ? node.strokeWidth : 1.5;
    return [
      'rounded=' + (rx > 0 ? 1 : 0),
      ...(rx > 0 ? ['absoluteArcSize=1', `arcSize=${rx}`] : []),
      `fillColor=${colors?.fill || FALLBACK_NODE_FILL}`,
      `strokeColor=${colors?.stroke || FALLBACK_STROKE}`,
      `strokeWidth=${sw}`,
      `fontColor=${palette.text}`,
      'fontSize=11',
      `fontFamily=${FONT_STACK}`,
      'whiteSpace=wrap',
      'html=1',
      'verticalAlign=middle',
    ].join(';') + ';';
  };

  const strictBoundaryStyle = (b) => {
    const colors = b.fillClass ? palette.paletteFor(b.fillClass, 'bg') : null;
    const rx = Number.isFinite(b.rx) && b.rx > 0 ? Math.round(b.rx) : 0;
    const dash = normalizeDash(colors?.dash);
    const labelColors = b.labelClass ? palette.paletteFor(b.labelClass, 'bg') : null;
    const alignLeft = b.kind === 'lane' || b.kind === 'exception-lane' || b.kind === 'segment';
    return [
      'rounded=' + (rx > 0 ? 1 : 0),
      ...(rx > 0 ? ['absoluteArcSize=1', `arcSize=${rx}`] : []),
      `fillColor=${colors?.fill || 'none'}`,
      `strokeColor=${colors?.stroke || '#666666'}`,
      `strokeWidth=${b.strokeWidth || 1}`,
      ...(dash ? ['dashed=1', `dashPattern=${dash}`] : []),
      `fontColor=${labelColors?.fill || palette.textMuted}`,
      'fontSize=9',
      `fontFamily=${FONT_STACK}`,
      'whiteSpace=wrap',
      'html=1',
      'verticalAlign=top',
      ...(alignLeft ? ['align=left', 'spacingLeft=8'] : []),
    ].join(';') + ';';
  };

  const labelFor = (edge, index) => parsed.edgeLabels?.find(
    (l) => l.from === edge.from && l.to === edge.to && (l.label || '') === (edge.label || ''),
  ) || parsed.edgeLabels?.find((l) => l.from === edge.from && l.to === edge.to);

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<mxGraphModel dx="${Math.round(vw)}" dy="${Math.round(vh)}" grid="0" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${Math.round(vw)}" pageHeight="${Math.round(vh)}" math="0" shadow="0" background="${palette.bg}">`,
  );
  lines.push('  <root>');
  lines.push('    <mxCell id="0"/>');
  lines.push('    <mxCell id="1" parent="0"/>');

  // Boundaries.
  for (let i = 0; i < parsed.boundaries.length; i += 1) {
    const b = parsed.boundaries[i];
    lines.push(
      `    <mxCell id="boundary-${i}" value="${escapeAttr(b.label || b.kind)}" style="${strictBoundaryStyle(b)}" vertex="1" parent="1">`,
    );
    lines.push(
      `      <mxGeometry x="${Math.round(b.x)}" y="${Math.round(b.y)}" width="${Math.round(b.width)}" height="${Math.round(b.height)}" as="geometry"/>`,
    );
    lines.push('    </mxCell>');
  }

  // Nodes.
  for (const node of parsed.nodes) {
    const parentInfo = nodeParents.get(node.id);
    const parentId = parentInfo ? parentInfo.drawioId : '1';
    const relX = node.x - (parentInfo ? parentInfo.offsetX : 0);
    const relY = node.y - (parentInfo ? parentInfo.offsetY : 0);
    const labelParts = [node.label, node.sublabel, node.tag].filter(Boolean);
    const tagColor = node.fillClass ? (palette.paletteFor(node.fillClass, 'mask')?.stroke || palette.text) : palette.text;
    const htmlValue = labelParts.length > 1
      ? `<b>${node.label}</b><br/>`
        + (node.sublabel ? `<font style="font-size:8px" color="${palette.textMuted}">${node.sublabel}</font>` : '')
        + (node.sublabel && node.tag ? '<br/>' : '')
        + (node.tag ? `<font style="font-size:7px" color="${tagColor}">${node.tag}</font>` : '')
      : node.label;
    lines.push(
      `    <mxCell id="node-${node.id}" value="${escapeAttr(htmlValue)}" style="${strictNodeStyle(node)}" vertex="1" parent="${parentId}">`,
    );
    lines.push(
      `      <mxGeometry x="${Math.round(relX)}" y="${Math.round(relY)}" width="${Math.round(node.width)}" height="${Math.round(node.height)}" as="geometry"/>`,
    );
    lines.push('    </mxCell>');
  }

  // Sequence lifelines.
  for (const ll of parsed.lifelines) {
    const id = `lifeline-${Math.round(ll.x)}-${Math.round(ll.y1)}`;
    const colors = ll.strokeClass ? palette.paletteFor(ll.strokeClass, 'bg') : null;
    const style = [
      'endArrow=none',
      'html=1',
      `strokeColor=${colors?.stroke || '#999999'}`,
      `strokeWidth=${ll.strokeWidth || 0.8}`,
      'dashed=1',
      'dashPattern=3 7',
    ].join(';') + ';';
    lines.push(`    <mxCell id="${id}" value="" style="${style}" edge="1" parent="1">`);
    lines.push('      <mxGeometry relative="1" as="geometry">');
    lines.push(`        <mxPoint x="${Math.round(ll.x)}" y="${Math.round(ll.y1)}" as="sourcePoint"/>`);
    lines.push(`        <mxPoint x="${Math.round(ll.x)}" y="${Math.round(ll.y2)}" as="targetPoint"/>`);
    lines.push('      </mxGeometry>');
    lines.push('    </mxCell>');
  }

  // Edges.
  for (let i = 0; i < parsed.edges.length; i += 1) {
    const edge = parsed.edges[i];
    const src = nodeById.get(edge.from);
    const tgt = nodeById.get(edge.to);
    if (!src || !tgt) continue;
    const colors = edge.strokeClass ? palette.paletteFor(edge.strokeClass, 'bg') : null;
    const sw = Number.isFinite(edge.strokeWidth) ? edge.strokeWidth : 1.5;
    const dash = normalizeDash(colors?.dash);
    const radius = Number.isFinite(edge.radius) ? edge.radius : 0;
    const labelText = labelFor(edge, i);
    const labelColors = labelText?.className ? palette.paletteFor(labelText.className, 'bg') : null;
    const style = [
      'edgeStyle=none',
      ...(radius > 0 ? ['rounded=1', `arcSize=${radius * 2}`] : ['rounded=0']),
      `strokeColor=${colors?.stroke || '#666666'}`,
      `strokeWidth=${sw}`,
      ...(dash ? ['dashed=1', `dashPattern=${dash}`] : []),
      'endArrow=block',
      'endFill=1',
      `endSize=${Math.max(4, Math.round(10 * sw))}`,
      `fontColor=${labelColors?.fill || palette.textMuted}`,
      'fontSize=8',
      `fontFamily=${FONT_STACK}`,
      `labelBackgroundColor=${palette.mask}`,
      'html=1',
    ].join(';') + ';';

    const exit = borderFraction(edge.points[0], src);
    const entry = borderFraction(edge.points[edge.points.length - 1], tgt);
    const styleAttrs = [
      ...(exit ? [`exitX=${exit[0]}`, `exitY=${exit[1]}`, 'exitDx=0', 'exitDy=0'] : []),
      ...(entry ? [`entryX=${entry[0]}`, `entryY=${entry[1]}`, 'entryDx=0', 'entryDy=0'] : []),
    ].join(';');
    const id = edge.id ? `edge-${edge.id}` : `edge-${i}`;
    lines.push(
      `    <mxCell id="${id}" value="${edge.label ? escapeAttr(edge.label) : ''}" style="${style}${styleAttrs}" edge="1" parent="1" source="node-${edge.from}" target="node-${edge.to}">`,
    );
    lines.push('      <mxGeometry relative="1" as="geometry">');
    if (labelText && edge.label) {
      const t = fractionAlongPolyline(edge.points, [labelText.x, labelText.y]);
      lines.push(`        <mxGeometry x="${(2 * t - 1).toFixed(3)}" y="0" relative="1" as="geometry"/>`);
    }
    const interior = edge.points.slice(1, -1);
    if (interior.length) {
      lines.push('        <Array as="points">');
      for (const [x, y] of interior) {
        lines.push(`          <mxPoint x="${Math.round(x)}" y="${Math.round(y)}"/>`);
      }
      lines.push('        </Array>');
    }
    lines.push('      </mxGeometry>');
    lines.push('    </mxCell>');
  }

  lines.push('  </root>');
  lines.push('</mxGraphModel>');
  return lines.join('\n');
}
