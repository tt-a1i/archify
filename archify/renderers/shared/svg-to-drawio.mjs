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
    const box = firstRectInGroup({ index: m.index, [0]: openTag }, closeIndex, svg);
    if (!box) continue;
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
    edges.push({ from, to, label, id, points });
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
    const afterRect = svg.slice(m.index + tag.length, m.index + tag.length + 300);
    const textMatch = afterRect.match(/<text\b[^>]*>([^<]*)<\/text>/);
    if (textMatch) label = textMatch[1].trim();
    boundaries.push({ kind, frameId, label, ...box });
  }
  return boundaries;
}

/**
 * Parse sequence lifelines: vertical dashed `<path d="M cx top L cx bottom">`.
 * These are rendered as standalone vertical lines (not connected edges).
 */
function parseLifelines(svg) {
  const lifelines = [];
  const re = /<path\b[^>]*\bd="M\s*(\d+\.?\d*)\s+(\d+\.?\d*)\s+L\s*\1\s+(\d+\.?\d*)"[^>]*stroke-dasharray/g;
  const matches = [...svg.matchAll(re)];
  for (const m of matches) {
    lifelines.push({ x: parseFloat(m[1]), y1: parseFloat(m[2]), y2: parseFloat(m[3]) });
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
 */
export function convertArchifyToDrawio(svg, diagramType, diagram = null) {
  const parsed = parseArchifySvg(svg, diagramType);
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
