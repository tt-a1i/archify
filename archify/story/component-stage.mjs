import { parseStylesheet } from './svg-bake.mjs';
import { parse } from './vendor/html-parser.mjs';

function tagAttributes(tag) {
  const values = {};
  for (const match of tag.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)="([^"]*)"/g)) values[match[1]] = match[2];
  return values;
}

function decodeEntities(value) {
  return value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function measureNodeGroupBox(groupBody) {
  const rectTag = groupBody.match(/<rect\b[^>]*>/);
  if (rectTag) {
    const box = ['x', 'y', 'width', 'height'].map((key) => Number(tagAttributes(rectTag[0])[key]));
    if (box.length === 4 && box.every(Number.isFinite)) return box;
  }
  const circleTag = groupBody.match(/<circle\b[^>]*>/);
  if (circleTag) {
    const c = tagAttributes(circleTag[0]);
    const [cx, cy, r] = [Number(c.cx), Number(c.cy), Number(c.r)];
    if ([cx, cy, r].every(Number.isFinite)) return [cx - r, cy - r, r * 2, r * 2];
  }
  const polyTag = groupBody.match(/<polygon\b[^>]*\bpoints="([^"]*)"/);
  if (polyTag) {
    const nums = polyTag[1].trim().split(/[\s,]+/).map(Number);
    const xs = nums.filter((_, idx) => idx % 2 === 0);
    const ys = nums.filter((_, idx) => idx % 2 === 1);
    if (xs.length && ys.length && xs.every(Number.isFinite) && ys.every(Number.isFinite)) {
      const minX = Math.min(...xs);
      const minY = Math.min(...ys);
      return [minX, minY, Math.max(1, Math.max(...xs) - minX), Math.max(1, Math.max(...ys) - minY)];
    }
  }
  return [];
}

function extractSvgLayoutNodes(svg) {
  const nodes = [];
  const seenNodes = new Set();
  for (const match of svg.matchAll(/<g\b([^>]*\bdata-node-id="[^"]*"[^>]*)>([\s\S]*?)<\/g>/g)) {
    const group = tagAttributes(match[1]);
    const id = decodeEntities(group['data-node-id']);
    if (seenNodes.has(id)) continue;
    seenNodes.add(id);
    const box = measureNodeGroupBox(match[2]);
    nodes.push({
      id,
      label: decodeEntities(group['data-node-label'] || id),
      ...(group['data-node-kind'] ? { kind: decodeEntities(group['data-node-kind']) } : {}),
      ...(box.length === 4 ? { x: box[0], y: box[1], width: box[2], height: box[3] } : {}),
    });
  }
  return nodes;
}

function extractSvgLayoutEdges(svg) {
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
  return edges;
}

function layoutReportFromSvg(svg, diagramType) {
  const viewBoxMatch = svg.match(/<svg[^>]*\sviewBox="([^"]*)"/);
  const viewBox = viewBoxMatch ? viewBoxMatch[1].trim().split(/[\s,]+/).map(Number).slice(2) : null;
  return {
    ok: true,
    diagram_type: diagramType,
    contract: `archify-${diagramType}-layout-v1`,
    ...(viewBox ? { viewBox } : {}),
    nodes: extractSvgLayoutNodes(svg),
    edges: extractSvgLayoutEdges(svg),
  };
}

export const STATIC_RELATION_TYPES = new Set(['erd', 'class', 'tree']);

export const escapeXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const escapeCssAttr = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

function textUnits(value) {
  return [...String(value ?? '')].reduce((sum, ch) => sum + (/[\u2E80-\uFFFF]/.test(ch) ? 1 : 0.58), 0);
}

function toneColor(tone, palette) {
  if (!palette) return '#159f88';
  if (tone === 'removed') return palette.removed;
  if (tone === 'modified') return palette.amber;
  if (tone === 'neutral') return palette.muted;
  return palette.accent;
}

export function boundsOf(boxes) {
  if (!boxes.length) return { x: 0, y: 0, width: 100, height: 100 };
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const maxX = Math.max(...boxes.map((b) => b.x + b.width));
  const maxY = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: Math.max(1, maxX - x), height: Math.max(1, maxY - y) };
}

export function visitAst(node, out = []) {
  if (!node) return out;
  out.push(node);
  for (const child of node.childNodes || []) visitAst(child, out);
  return out;
}

export function attr(node, name) {
  return node?.attrs?.find((entry) => entry.name === name && !entry.prefix)?.value;
}

export function setAttr(node, name, value) {
  if (!node.attrs) node.attrs = [];
  const existing = node.attrs.find((entry) => entry.name === name && !entry.prefix);
  if (existing) existing.value = String(value);
  else node.attrs.push({ name, value: String(value) });
}

export function removeAttr(node, name) {
  if (!node.attrs) return;
  node.attrs = node.attrs.filter((entry) => !(entry.name === name && !entry.prefix));
}

export function textContent(node) {
  if (!node) return '';
  if (node.nodeName === '#text') return node.value || '';
  return (node.childNodes || []).map((child) => textContent(child)).join('');
}

export function cloneAst(node, parent = null) {
  const copy = { ...node };
  if (parent !== null) copy.parentNode = parent;
  if (Array.isArray(node.attrs)) copy.attrs = node.attrs.map((a) => ({ ...a }));
  if (Array.isArray(node.childNodes)) copy.childNodes = node.childNodes.map((child) => cloneAst(child, copy));
  return copy;
}

export function removeNodeFromParent(node) {
  const children = node?.parentNode?.childNodes;
  if (!Array.isArray(children)) return;
  const idx = children.indexOf(node);
  if (idx !== -1) children.splice(idx, 1);
}

export function createSvgElement(tagName, attrs = {}, children = []) {
  const node = {
    nodeName: tagName,
    tagName,
    attrs: Object.entries(attrs).filter(([, v]) => v !== undefined && v !== null).map(([name, value]) => ({ name, value: String(value) })),
    childNodes: [],
  };
  for (const child of children) {
    if (typeof child === 'string') {
      node.childNodes.push({ nodeName: '#text', value: child, parentNode: node });
    } else if (child) {
      child.parentNode = node;
      node.childNodes.push(child);
    }
  }
  return node;
}

export function appendAstChild(parent, child) {
  if (!parent.childNodes) parent.childNodes = [];
  child.parentNode = parent;
  parent.childNodes.push(child);
  return child;
}

export function serializeXmlNode(node) {
  if (!node) return '';
  if (node.nodeName === '#text') return escapeXml(node.value);
  if (node.nodeName === '#comment') return '';
  if (!node.tagName) return (node.childNodes || []).map(serializeXmlNode).join('');
  const attrs = (node.attrs || []).map((entry) => {
    const qname = entry.prefix ? `${entry.prefix}:${entry.name}` : entry.name;
    return ` ${qname}="${escapeXml(entry.value)}"`;
  }).join('');
  if (!node.childNodes?.length) return `<${node.tagName}${attrs}/>`;
  return `<${node.tagName}${attrs}>${node.childNodes.map(serializeXmlNode).join('')}</${node.tagName}>`;
}

export function parseSvgElement(rawSvg) {
  const clean = String(rawSvg).replace(/<\?xml[^>]*>\s*/g, '');
  const doc = parse(clean);
  const svg = visitAst(doc).find((node) => node.tagName === 'svg');
  if (!svg) throw new Error('component-stage: source SVG lacks a root <svg> element.');
  return svg;
}

export function findNodeGroupAst(svgNode, nodeId) {
  return visitAst(svgNode).find((node) => node.tagName === 'g' && attr(node, 'data-node-id') === nodeId) || null;
}

function parseInlineSvgFragment(markup) {
  const doc = parse(`<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`);
  const root = visitAst(doc).find((node) => node.tagName === 'svg');
  return root?.childNodes ? [...root.childNodes] : [];
}

function stripStatusBadgesAst(svgNode) {
  for (const node of visitAst(svgNode)) {
    if (node.tagName === 'g' && attr(node, 'data-change-badge') !== undefined) {
      removeNodeFromParent(node);
    }
  }
}

function renderPillChildren(badge, { x, y, width, text, tone, palette }) {
  const stroke = toneColor(tone, palette);
  const fill = palette?.bg || '#ffffff';
  const children = [
    createSvgElement('rect', { x, y, width, height: 18, rx: 6, fill, stroke: 'none' }),
    createSvgElement('rect', { x, y, width, height: 18, rx: 6, fill: stroke, 'fill-opacity': 0.14, stroke, 'stroke-width': 1 }),
    createSvgElement('text', {
      x: x + width / 2,
      y: y + 12.5,
      fill: stroke,
      'font-size': 10.5,
      'font-weight': 600,
      'text-anchor': 'middle',
    }, [text]),
  ];
  for (const child of children) child.parentNode = badge;
  badge.childNodes = children;
}

function expandLabeledStatusBadgesAst(svgNode, layout, callouts, palette, isZh) {
  const labels = isZh
    ? { added: '+ 新增', modified: '~ 修改', removed: '− 删除' }
    : { added: '+ Added', modified: '~ Modified', removed: '− Removed' };
  const pillWidths = isZh
    ? { added: 56, modified: 56, removed: 56 }
    : { added: 66, modified: 78, removed: 76 };
  const groups = new Map(
    visitAst(svgNode)
      .filter((node) => node.tagName === 'g' && attr(node, 'data-node-id'))
      .map((node) => [attr(node, 'data-node-id'), node]),
  );

  for (const node of layout.nodes) {
    if (callouts && Object.hasOwn(callouts, node.id)) continue;
    if (!node.width || node.width < 104) continue;
    const group = groups.get(node.id);
    if (!group) continue;
    const state = attr(group, 'data-change');
    if (!state || !Object.hasOwn(labels, state)) continue;
    const pillW = pillWidths[state];
    const badge = visitAst(group).filter((child) => child.tagName === 'g' && attr(child, 'data-change-badge') === state).at(-1);
    if (!badge) continue;
    const rect = visitAst(badge).find((child) => child.tagName === 'rect');
    if (!rect) continue;
    const rx = Number(attr(rect, 'x'));
    const ry = Number(attr(rect, 'y'));
    const rw = Number(attr(rect, 'width'));
    if (![rx, ry, rw].every(Number.isFinite)) continue;
    setAttr(badge, 'data-story-node-badge', '');
    setAttr(badge, 'pointer-events', 'none');
    renderPillChildren(badge, { x: rx + rw - pillW, y: ry - 2.5, width: pillW, text: labels[state], tone: state, palette });
  }
}

function applyNodeCalloutsAst(svgNode, layout, callouts, palette) {
  if (!callouts || !Object.keys(callouts).length) return;
  const groups = new Map(
    visitAst(svgNode)
      .filter((node) => node.tagName === 'g' && attr(node, 'data-node-id'))
      .map((node) => [attr(node, 'data-node-id'), node]),
  );
  for (const node of layout.nodes) {
    const spec = Object.hasOwn(callouts, node.id) ? callouts[node.id] : null;
    if (!spec) continue;
    const group = groups.get(node.id);
    if (!group) continue;
    for (const old of visitAst(group).filter((child) => child.tagName === 'g' && attr(child, 'data-change-badge') !== undefined)) {
      removeNodeFromParent(old);
    }
    const pillW = Math.max(46, Math.round(textUnits(spec.text) * 9.5 + 16));
    const x = node.x + node.width - pillW - 6;
    const y = node.y - 9;
    const badge = createSvgElement('g', { 'data-story-node-badge': '', 'data-story-callout': spec.tone || 'accent', 'pointer-events': 'none' });
    renderPillChildren(badge, { x, y, width: pillW, text: spec.text, tone: spec.tone || 'accent', palette });
    appendAstChild(group, badge);
  }
}

function namespaceIdsAst(svgNode, key) {
  const all = visitAst(svgNode);
  const ids = new Set(all.map((node) => attr(node, 'id')).filter(Boolean));
  if (!ids.size) return ids;
  const rewrite = (value) => value.replace(/#([A-Za-z0-9_.:-]+)/g, (m, ref) => (ids.has(ref) ? `#${key}-${ref}` : m));
  for (const node of all) {
    for (const entry of node.attrs || []) {
      if (entry.name === 'id' && !entry.prefix && ids.has(entry.value)) {
        entry.value = `${key}-${entry.value}`;
      } else if (entry.value.includes('#')) {
        entry.value = rewrite(entry.value);
      }
    }
  }
  return ids;
}

function extractScopedStylesAst(svgNode, key, ids) {
  const rewriteCssIds = (value) => (ids.size
    ? value.replace(/url\(\s*(['"]?)#([A-Za-z0-9_.:-]+)\1\s*\)/g, (m, q, ref) => (ids.has(ref) ? `url(${q}#${key}-${ref}${q})` : m))
    : value);
  const rules = [];
  for (const styleEl of visitAst(svgNode).filter((node) => node.tagName === 'style')) {
    const raw = textContent(styleEl).replace(/^\s*<!\[CDATA\[|\]\]>\s*$/g, '');
    removeNodeFromParent(styleEl);
    for (const rule of parseStylesheet(raw)) {
      const decls = rule.declarations.map((d) => `${d.property}:${rewriteCssIds(d.value)}${d.important ? '!important' : ''}`).join(';');
      if (!decls) continue;
      const body = `[data-native-key="${key}"] :is(${rule.selector}){${decls}}`;
      rules.push(rule.media ? `${rule.media}{${body}}` : body);
    }
  }
  return rules;
}

function recordRemovedEdgeAliases(removedEdges, canonicalId, edgeKey, from, to) {
  removedEdges.add(canonicalId);
  if (edgeKey !== undefined) removedEdges.add(`edge:${edgeKey}`);
  if (from !== undefined && to !== undefined) removedEdges.add(`${from}~${to}`);
}

function readPathEdgeIdentity(node) {
  const d = attr(node, 'd');
  if (!d) return null;
  const parentGroup = node.parentNode?.tagName === 'g'
    && (attr(node.parentNode, 'data-edge-from') !== undefined || attr(node.parentNode, 'data-edge-id') !== undefined)
    ? node.parentNode
    : null;
  const from = attr(node, 'data-edge-from') ?? attr(node, 'data-composition-edge-from') ?? (parentGroup && attr(parentGroup, 'data-edge-from'));
  const to = attr(node, 'data-edge-to') ?? attr(node, 'data-composition-edge-to') ?? (parentGroup && attr(parentGroup, 'data-edge-to'));
  const explicitId = attr(node, 'data-edge-id') ?? attr(node, 'data-composition-edge-id') ?? (parentGroup && attr(parentGroup, 'data-edge-id'));
  const edgeKey = attr(node, 'data-edge-key') ?? (parentGroup && attr(parentGroup, 'data-edge-key'));
  if (!explicitId && from === undefined && to === undefined) return null;
  return {
    canonicalId: explicitId || `${from}~${to}`,
    d,
    marker: attr(node, 'marker-end') || null,
    from,
    to,
    edgeKey,
    change: attr(node, 'data-change') ?? (parentGroup && attr(parentGroup, 'data-change')) ?? null,
  };
}

function annotateEdgeGroupAst(node, removedEdges) {
  if (attr(node, 'data-graph-role') === 'automatic-crossover') {
    const childPath = visitAst(node).find((child) => child.tagName === 'path' && attr(child, 'data-story-edge-id'));
    if (childPath) setAttr(node, 'data-story-edge-wrap', attr(childPath, 'data-story-edge-id'));
    return;
  }
  const from = attr(node, 'data-edge-from');
  const to = attr(node, 'data-edge-to');
  const explicitId = attr(node, 'data-edge-id');
  const edgeKey = attr(node, 'data-edge-key');
  if (explicitId === undefined && (from === undefined || to === undefined)) return;
  const canonicalId = explicitId || `${from}~${to}`;
  if (!attr(node, 'data-story-edge-id')) setAttr(node, 'data-story-edge-id', canonicalId);
  if (attr(node, 'data-change') === 'removed') recordRemovedEdgeAliases(removedEdges, canonicalId, edgeKey, from, to);
}

function annotateEdgesAndChangesAst(svgNode, callouts = null) {
  const paths = new Map();
  const removedNodes = new Set();
  const removedEdges = new Set();
  const all = visitAst(svgNode);
  let pathIdx = 0;

  for (const node of all) {
    const nodeId = node.tagName === 'g' && attr(node, 'data-node-id');
    if (nodeId && (attr(node, 'data-change') === 'removed' || callouts?.[nodeId]?.tone === 'removed')) {
      removedNodes.add(nodeId);
    }
  }

  for (const node of all) {
    if (node.tagName !== 'path') continue;
    const edge = readPathEdgeIdentity(node);
    if (!edge) continue;
    const info = { id: edge.canonicalId, d: edge.d, marker: edge.marker, from: edge.from, to: edge.to, key: edge.edgeKey, change: edge.change };
    if (!paths.has(edge.canonicalId)) paths.set(edge.canonicalId, info);
    if (edge.edgeKey !== undefined && !paths.has(`edge:${edge.edgeKey}`)) paths.set(`edge:${edge.edgeKey}`, info);
    if (edge.from !== undefined && edge.to !== undefined && !paths.has(`${edge.from}~${edge.to}`)) paths.set(`${edge.from}~${edge.to}`, info);
    if (edge.change === 'removed') recordRemovedEdgeAliases(removedEdges, edge.canonicalId, edge.edgeKey, edge.from, edge.to);

    pathIdx += 1;
    if (!attr(node, 'data-story-edge-id')) {
      setAttr(node, 'data-story-edge-id', edge.canonicalId);
      setAttr(node, 'data-story-path-idx', pathIdx);
    }
  }

  for (const node of all) {
    if (node.tagName === 'g') annotateEdgeGroupAst(node, removedEdges);
  }
  return { paths, removedNodes, removedEdges };
}

function computeContentBoundsAst(svgNode, layout, callouts = null) {
  const boxes = [];
  const all = visitAst(svgNode);
  const changedNodes = new Set(
    all.filter((node) => node.tagName === 'g' && attr(node, 'data-node-id') && ['added', 'modified', 'removed'].includes(attr(node, 'data-change')))
      .map((node) => attr(node, 'data-node-id')),
  );
  for (const node of layout.nodes) {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
    const hasBadge = changedNodes.has(node.id) || (callouts && Object.hasOwn(callouts, node.id));
    const badgeTop = hasBadge ? 14 : 0;
    boxes.push({ x: node.x, y: node.y - badgeTop, width: node.width, height: node.height + badgeTop });
  }
  for (const edge of layout.edges) {
    for (const [px, py] of edge.points || []) {
      if (Number.isFinite(px) && Number.isFinite(py)) boxes.push({ x: px - 14, y: py - 14, width: 28, height: 28 });
    }
  }
  for (const rect of all) {
    if (rect.tagName !== 'rect') continue;
    if (attr(rect, 'data-composition-frame-kind') === undefined && attr(rect.parentNode, 'data-domain-band') === undefined) continue;
    const [x, y, width, height] = ['x', 'y', 'width', 'height'].map((k) => Number(attr(rect, k)));
    if ([x, y, width, height].every(Number.isFinite)) {
      const extraY = attr(rect.parentNode, 'data-domain-band') !== undefined ? 10 : 0;
      boxes.push({ x, y: y - extraY, width, height: height + extraY });
    }
  }
  return boundsOf(boxes);
}

// Prepares one baked native SVG into an isolated, AST-addressable stage part.
export function prepareStageSvg({ view, rawSvg, statusBadges = 'auto', callouts = null, palette = null, isZh = false }) {
  const layout = layoutReportFromSvg(rawSvg, view.type);
  const svgNode = parseSvgElement(rawSvg);
  const rawViewBox = attr(svgNode, 'viewBox');
  const viewBox = rawViewBox ? rawViewBox.trim().split(/[\s,]+/).map(Number) : [0, 0, ...(layout.viewBox || [800, 400])];

  for (const node of visitAst(svgNode)) {
    if (node.tagName === 'metadata' && attr(node, 'id') === 'archify-software-notices') removeNodeFromParent(node);
    else if (node.tagName === 'rect' && (attr(node, 'class') === 'archify-bake-background' || attr(node, 'fill') === 'url(#grid)')) {
      removeNodeFromParent(node);
    }
  }

  if (statusBadges === 'none') {
    stripStatusBadgesAst(svgNode);
  } else if (statusBadges !== 'compact' && !['erd', 'class'].includes(view.type)) {
    expandLabeledStatusBadgesAst(svgNode, layout, callouts, palette, isZh);
  }
  applyNodeCalloutsAst(svgNode, layout, callouts, palette);

  const key = `native-${view.id}`;
  const ids = namespaceIdsAst(svgNode, key);
  const scopedCss = extractScopedStylesAst(svgNode, key, ids);
  const edgeInfo = annotateEdgesAndChangesAst(svgNode, callouts);

  setAttr(svgNode, 'x', viewBox[0]);
  setAttr(svgNode, 'y', viewBox[1]);
  setAttr(svgNode, 'width', viewBox[2]);
  setAttr(svgNode, 'height', viewBox[3]);

  return {
    id: view.id,
    key,
    type: view.type,
    svgNode,
    scopedCss,
    nodes: layout.nodes,
    edges: layout.edges,
    paths: edgeInfo.paths,
    removedNodes: edgeInfo.removedNodes,
    removedEdges: edgeInfo.removedEdges,
    viewBox,
    contentBox: computeContentBoundsAst(svgNode, layout, callouts),
    extraBoxes: [],
  };
}

export function attachNodeMetricMarkup(part, nodeId, markup) {
  const group = findNodeGroupAst(part.svgNode, nodeId);
  if (!group) return false;
  for (const child of parseInlineSvgFragment(markup)) {
    appendAstChild(group, child);
  }
  return true;
}

export function markEdgePathLength(part, edgeId) {
  for (const node of visitAst(part.svgNode)) {
    if (node.tagName === 'path' && attr(node, 'data-story-edge-id') === edgeId && !attr(node, 'pathLength')) {
      setAttr(node, 'pathLength', '1');
    }
  }
}

export function applyNodeRelabel(part, nodeId, nodeBox, op, { oldLabelId, newLabelId, oldSubId, newSubId }, palette) {
  const group = findNodeGroupAst(part.svgNode, nodeId);
  if (!group) return { hasLabel: false, hasSubtitle: false };
  const descendants = visitAst(group);
  let hasLabel = false;
  let hasSubtitle = false;

  if (op.label) {
    const labelEl = descendants.find((el) => el.tagName === 'text' && attr(el, 'data-node-label') !== undefined);
    const lx = Number(attr(labelEl, 'x') || nodeBox.x + nodeBox.width / 2);
    const ly = Number(attr(labelEl, 'y') || nodeBox.y + nodeBox.height / 2 - 2);
    const fontSize = attr(labelEl, 'font-size') || '13';
    if (labelEl) setAttr(labelEl, 'id', oldLabelId);
    appendAstChild(group, createSvgElement('text', {
      x: lx,
      y: ly,
      'font-size': fontSize,
      fill: palette.text,
      'font-weight': 600,
      'data-node-label': '',
      id: newLabelId,
      'text-anchor': attr(labelEl, 'text-anchor') || 'middle',
      style: 'opacity:0',
    }, [op.label]));
    hasLabel = Boolean(labelEl);
  }

  if (op.subtitle) {
    const subEl = descendants.find((el) => el.tagName === 'text' && attr(el, 'data-detail') === 'context');
    const labelEl = descendants.find((el) => el.tagName === 'text' && attr(el, 'data-node-label') !== undefined);
    const sx = Number(attr(subEl, 'x') || attr(labelEl, 'x') || nodeBox.x + nodeBox.width / 2);
    const sy = Number(attr(subEl, 'y') || (labelEl ? Number(attr(labelEl, 'y')) + 16 : nodeBox.y + nodeBox.height / 2 + 14));
    const fontSize = attr(subEl, 'font-size') || '11';
    if (subEl) setAttr(subEl, 'id', oldSubId);
    appendAstChild(group, createSvgElement('text', {
      x: sx,
      y: sy,
      'font-size': fontSize,
      fill: palette.muted,
      'text-anchor': attr(subEl, 'text-anchor') || 'middle',
      id: newSubId,
      style: 'opacity:0',
    }, [op.subtitle]));
    hasSubtitle = true;
  }

  return { hasLabel, hasSubtitle, hadOldSub: Boolean(descendants.find((el) => el.tagName === 'text' && attr(el, 'data-detail') === 'context')) };
}

export function buildSharedTransitionNode(fromPart, toPart, shared, transitionId, palette) {
  const fromNode = fromPart.nodes.find((n) => n.id === shared.id);
  const toNodeId = shared.targetId || shared.id;
  const toNode = toPart.nodes.find((n) => n.id === toNodeId);
  const originalGroup = findNodeGroupAst(fromPart.svgNode, shared.id);
  if (!fromNode || !toNode || !originalGroup) return null;

  const clone = cloneAst(originalGroup, null);
  for (const el of visitAst(clone)) removeAttr(el, 'id');

  const descendants = visitAst(clone);
  let oldLabelAttr = null;
  let newLabelId = null;
  let newSubId = null;
  let hasOldSub = false;
  let badgeId = null;

  if (shared.label) {
    const labelEl = descendants.find((el) => el.tagName === 'text' && attr(el, 'data-node-label') !== undefined);
    const x = Number(attr(labelEl, 'x') || fromNode.x + fromNode.width / 2);
    const y = Number(attr(labelEl, 'y') || fromNode.y + fromNode.height / 2 - 2);
    const fontSize = attr(labelEl, 'font-size') || '13';
    if (labelEl) {
      oldLabelAttr = 'data-story-shared-old-label';
      setAttr(labelEl, oldLabelAttr, '');
    }
    newLabelId = `${transitionId}-label-${shared.id}`;
    appendAstChild(clone, createSvgElement('text', {
      x,
      y,
      'font-size': fontSize,
      fill: palette.text,
      'font-weight': 600,
      'data-node-label': '',
      id: newLabelId,
      'text-anchor': 'middle',
      style: 'opacity:0',
    }, [shared.label]));
  }

  if (shared.subtitle) {
    const subEl = descendants.find((el) => el.tagName === 'text' && attr(el, 'data-detail') === 'context');
    hasOldSub = Boolean(subEl);
    const sx = Number(attr(subEl, 'x') || fromNode.x + fromNode.width / 2);
    const sy = Number(attr(subEl, 'y') || fromNode.y + fromNode.height / 2 + 14);
    const fontSize = attr(subEl, 'font-size') || '10.5';
    newSubId = `${transitionId}-sub-${shared.id}`;
    appendAstChild(clone, createSvgElement('text', {
      x: sx,
      y: sy,
      'font-size': fontSize,
      fill: palette.muted,
      'font-weight': 400,
      id: newSubId,
      'text-anchor': 'middle',
      style: 'opacity:0',
    }, [shared.subtitle]));
  }

  const targetGroup = findNodeGroupAst(toPart.svgNode, toNodeId);
  const targetBadge = targetGroup
    ? visitAst(targetGroup).find((el) => el.tagName === 'g' && (attr(el, 'data-story-node-badge') !== undefined || attr(el, 'data-change-badge') !== undefined))
    : null;
  const hasExistingBadge = descendants.some((el) => attr(el, 'data-story-node-badge') !== undefined || attr(el, 'data-change-badge') !== undefined);
  if (targetBadge && !hasExistingBadge) {
    badgeId = `${transitionId}-badge-${shared.id}`;
    const map = `translate(${fromNode.x} ${fromNode.y}) scale(${(fromNode.width / toNode.width).toFixed(5)}) translate(${-toNode.x} ${-toNode.y})`;
    const badgeClone = cloneAst(targetBadge, null);
    for (const el of visitAst(badgeClone)) removeAttr(el, 'id');
    const wrap = createSvgElement('g', { 'data-native-key': toPart.key }, [
      createSvgElement('g', { id: badgeId, transform: map, style: 'opacity:0' }, [badgeClone]),
    ]);
    appendAstChild(clone, wrap);
  }

  return {
    fromNode,
    toNode,
    toNodeId,
    markup: serializeXmlNode(clone),
    oldLabelAttr,
    newLabelId,
    newSubId,
    hasOldSub,
    badgeId,
  };
}
