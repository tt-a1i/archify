/** Serialize computed layout for dry-run / inspect (#9). */

export function componentBox(c) {
  return {
    id: c.id,
    type: c.type,
    label: c.label,
    x: Math.round(c.x),
    y: Math.round(c.y),
    width: c.width,
    height: c.height,
    ...(Number.isInteger(c.row) ? { row: c.row } : {}),
    ...(Number.isInteger(c.col) ? { col: c.col } : {}),
    ...(Array.isArray(c.pos) ? { pos: c.pos.map(Math.round) } : {}),
  };
}

export function entityBox(e) {
  return {
    id: e.id,
    label: e.label,
    x: Math.round(e.x),
    y: Math.round(e.y),
    width: e.width,
    height: e.height,
    attributes: (Array.isArray(e.attributes) ? e.attributes : []).map((attribute) => attribute.name),
    ...(Number.isInteger(e.row) ? { row: e.row } : {}),
    ...(Number.isInteger(e.col) ? { col: e.col } : {}),
    ...(Array.isArray(e.pos) ? { pos: e.pos.map(Math.round) } : {}),
  };
}

export function boundaryBox(b) {
  return {
    kind: b.kind,
    label: b.label,
    x: Math.round(b.x),
    y: Math.round(b.y),
    width: Math.round(b.width),
    height: Math.round(b.height),
    wraps: b.wraps,
  };
}

export function connectionPath(conn, routed, labelAt) {
  return {
    from: conn.from,
    to: conn.to,
    label: conn.label ?? null,
    variant: conn.variant ?? 'default',
    route: conn.route ?? 'auto',
    // These points are repair inputs: rounding a fractional port makes a
    // reused waypoint diagonal relative to the actual endpoint.
    points: routed.points.map(([x, y]) => [x, y]),
    ...(labelAt ? { labelAt: labelAt.map(Math.round) } : {}),
  };
}

function tagAttributes(tag) {
  const values = {};
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"]*)"/g)) values[match[1]] = match[2];
  return values;
}

function decodeEntities(value) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

// Deterministic layout evidence read back from the rendered SVG, for renderers
// whose geometry lives in a render closure rather than a layout model: every
// node reports the box of its first drawn rect, every edge the points its route
// publishes for composition checks.
export function layoutReportFromSvg(svg, diagramType) {
  const viewBoxMatch = svg.match(/<svg[^>]*\sviewBox="([^"]*)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1].trim().split(/\s+/).map(Number).slice(2) : null;
  const nodes = [];
  const seenNodes = new Set();
  const nodePattern = /<g\b([^>]*\bdata-node-id="[^"]*"[^>]*)>([\s\S]*?)<\/g>/g;
  for (const match of svg.matchAll(nodePattern)) {
    const group = tagAttributes(match[1]);
    const id = decodeEntities(group['data-node-id']);
    if (seenNodes.has(id)) continue;
    seenNodes.add(id);
    const rectTag = match[2].match(/<rect\b[^>]*>/);
    const rect = rectTag ? tagAttributes(rectTag[0]) : {};
    const box = ['x', 'y', 'width', 'height'].map((key) => Number(rect[key]));
    nodes.push({
      id,
      label: decodeEntities(group['data-node-label'] || id),
      ...(group['data-node-kind'] ? { kind: decodeEntities(group['data-node-kind']) } : {}),
      ...(box.every(Number.isFinite) ? { x: box[0], y: box[1], width: box[2], height: box[3] } : {}),
    });
  }
  const edges = [];
  const seenEdges = new Set();
  const pending = new Map();
  for (const match of svg.matchAll(/<(?:g|path)\b[^>]*>/g)) {
    const values = tagAttributes(match[0]);
    const from = values['data-edge-from'] ?? values['data-composition-edge-from'];
    const to = values['data-edge-to'] ?? values['data-composition-edge-to'];
    if (from === undefined || to === undefined) continue;
    const id = values['data-edge-id'] ?? values['data-composition-edge-id'] ?? values['data-edge-key'] ?? `${from}~${to}`;
    const entry = pending.get(id) || { id: decodeEntities(id), from: decodeEntities(from), to: decodeEntities(to) };
    if (values['data-edge-label'] !== undefined) entry.label = decodeEntities(values['data-edge-label']);
    if (values['data-composition-points'] !== undefined) {
      entry.points = values['data-composition-points'].split(';').filter(Boolean).map((point) => point.split(',').map(Number));
    }
    pending.set(id, entry);
    if (entry.points && !seenEdges.has(id)) {
      seenEdges.add(id);
      edges.push(entry);
    }
  }
  return {
    ok: true,
    diagram_type: diagramType,
    contract: `archify-${diagramType}-layout-v1`,
    ...(viewBox ? { viewBox } : {}),
    nodes,
    edges,
  };
}
