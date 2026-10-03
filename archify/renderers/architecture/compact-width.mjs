// Removes horizontal slack from a free-coordinate Architecture candidate so a
// first draft that is slightly too wide for desktop readability can pass
// without an authoring round trip. Order, rows, column alignment and every
// relationship stay as authored. Nodes narrow around their centres only while
// their text keeps its rendered size (never below 8px, so the readability cap
// does not drop). Columns then move left by the least amount that saves the
// requested width, as a blend between the draft and its tightest horizontal
// compaction, so no gap ends up smaller than both its authored size and the
// room its label or boundary edge needs. finalize re-checks the result and
// restores the draft when anything else fails.

import { textUnits } from '../shared/utils.mjs';
import { fittedNodeFontSize, nodeTextFit } from '../shared/text-fit.mjs';

const DEFAULT_SIZE = [120, 60];
const MIN_GAP_PX = 24;
const BOUNDARY_PAD_PX = 30;
const BOUNDARY_CLEARANCE_PX = 16;
const BOUNDARY_TITLE_PX = 20;
const SHRINK_STEP_PX = 10;

// Relationship labels render at 8px (0.6em advance) inside a masked box, with
// arrowheads and clearance on both sides.
function labelGapPx(label) {
  return label ? 4.8 * textUnits(label) + 24 : MIN_GAP_PX;
}

// Width that keeps every text row at its current rendered size.
function minimumNodeWidth(c, width) {
  const needs = [textUnits(c.label) * 6.6 + 16];
  for (const [text, preferred, minimum] of [[c.sublabel, 9, 6], [c.tag, 7, 6]]) {
    if (!text) continue;
    const font = fittedNodeFontSize(text, width, preferred, minimum);
    if (text === c.sublabel && font < 8) return width;
    needs.push(textUnits(text) * font * nodeTextFit.widthFactor + nodeTextFit.horizontalPadding);
  }
  if (c.brand || c.icon) needs.push(width);
  return Math.min(width, Math.ceil(Math.max(...needs)));
}

const overlaps = (a, b) => a.top < b.bottom && b.top < a.bottom;

// Minimum centre distance for every left/right pair that shares vertical
// space, over nodes and the boundary rectangles that wrap them.
function constraints(nodes, candidate) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const boundaries = (candidate.boundaries || []).map((b) => {
    const members = (b.wraps || []).map((id) => byId.get(id)).filter(Boolean);
    if (!members.length) return null;
    return {
      members: new Set(members.map((m) => m.id)),
      top: Math.min(...members.map((m) => m.top)) - BOUNDARY_PAD_PX - BOUNDARY_TITLE_PX,
      bottom: Math.max(...members.map((m) => m.bottom)) + BOUNDARY_PAD_PX,
    };
  }).filter(Boolean);
  const linked = new Map();
  for (const edge of candidate.connections || []) {
    for (const key of [`${edge.from}\u0000${edge.to}`, `${edge.to}\u0000${edge.from}`]) {
      linked.set(key, Math.max(linked.get(key) || 0, labelGapPx(edge.label)));
    }
  }
  const pairs = [];
  for (const l of nodes) {
    for (const r of nodes) {
      if (l === r || l.col + l.w / 2 > r.col - r.w / 2) continue;
      let gap = 0;
      if (overlaps(l, r)) gap = linked.get(`${l.id}\u0000${r.id}`) || MIN_GAP_PX;
      // A boundary edge between them adds its padding and clearance.
      for (const b of boundaries) {
        const inL = b.members.has(l.id);
        const inR = b.members.has(r.id);
        if (inL === inR) continue;
        const outside = inL ? r : l;
        if (!overlaps(b, outside)) continue;
        gap = Math.max(gap, MIN_GAP_PX) + BOUNDARY_PAD_PX + BOUNDARY_CLEARANCE_PX;
      }
      if (gap) pairs.push({ l, r, need: l.w / 2 + r.w / 2 + gap });
    }
  }
  return pairs;
}

function canvasSpan(nodes, centres) {
  const lefts = nodes.map((n) => centres.get(n.col) - n.w / 2);
  const rights = nodes.map((n) => centres.get(n.col) + n.w / 2);
  return Math.max(...rights) - Math.min(...lefts);
}

function plan(candidate, originals, shrink, targetSpan) {
  const nodes = originals.map((o) => ({ ...o, w: Math.max(o.minW, o.w - shrink) }));
  // Nodes sharing a centre form one column and move together.
  const columns = [...new Set(nodes.map((n) => n.col))].sort((a, b) => a - b);
  const pairs = constraints(nodes, candidate);
  const tight = new Map();
  for (const [index, col] of columns.entries()) {
    // Columns keep their left-to-right order.
    let c = index ? tight.get(columns[index - 1]) : col;
    for (const p of pairs) {
      if (p.r.col === col && p.l.col < col) c = Math.max(c, tight.get(p.l.col) + p.need);
    }
    tight.set(col, Math.min(col, c));
  }
  const blend = (t) => new Map(columns.map((col) => [col, col - t * (col - tight.get(col))]));
  if (canvasSpan(nodes, blend(1)) > targetSpan) return null;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (canvasSpan(nodes, blend(mid)) <= targetSpan) hi = mid; else lo = mid;
  }
  return { nodes, centres: blend(hi) };
}

export function compactArchitectureWidth(candidate, removePx) {
  if (!(removePx > 0) || candidate?.layout || candidate?.meta?.viewBox) return null;
  const components = Array.isArray(candidate.components) ? candidate.components : [];
  if (!components.length || !components.every((c) => Array.isArray(c.pos) && c.pos.every(Number.isFinite))) return null;
  const originals = components.map((c) => {
    const [w, h] = Array.isArray(c.size) ? c.size : DEFAULT_SIZE;
    return { id: c.id, col: c.pos[0] + w / 2, top: c.pos[1], bottom: c.pos[1] + h, w, h, minW: minimumNodeWidth(c, w) };
  });
  const original = new Map(originals.map((o) => [o.col, o.col]));
  const targetSpan = canvasSpan(originals, original) - removePx;
  const maxShrink = Math.max(...originals.map((o) => o.w - o.minW));
  let chosen = null;
  for (let shrink = 0; shrink <= maxShrink + SHRINK_STEP_PX && !chosen; shrink += SHRINK_STEP_PX) {
    chosen = plan(candidate, originals, shrink, targetSpan);
  }
  if (!chosen) return null;
  const { nodes, centres } = chosen;

  // Route points follow the columns piecewise linearly.
  const knots = [...centres].sort((a, b) => a[0] - b[0]);
  const mapX = (x) => {
    if (x <= knots[0][0]) return x + knots[0][1] - knots[0][0];
    for (let i = 1; i < knots.length; i++) {
      const [x0, y0] = knots[i - 1];
      const [x1, y1] = knots[i];
      if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
    const [xn, yn] = knots[knots.length - 1];
    return x + yn - xn;
  };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const next = structuredClone(candidate);
  for (const c of next.components) {
    const n = byId.get(c.id);
    c.pos = [Math.round(centres.get(n.col) - n.w / 2), c.pos[1]];
    if (Array.isArray(c.size) || n.w !== DEFAULT_SIZE[0]) c.size = [n.w, n.h];
  }
  for (const edge of next.connections || []) {
    if (Array.isArray(edge.via)) edge.via = edge.via.map(([x, y]) => [Math.round(mapX(x)), y]);
    if (Array.isArray(edge.labelAt)) edge.labelAt = [Math.round(mapX(edge.labelAt[0])), edge.labelAt[1]];
  }
  return next;
}
