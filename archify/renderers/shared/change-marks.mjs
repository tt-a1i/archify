import { esc, textUnits } from './utils.mjs';
import { translateMessage } from './i18n.mjs';

export const CHANGE_STATES = Object.freeze(['added', 'modified', 'removed', 'unchanged']);
const MARKED_STATES = new Set(['added', 'modified', 'removed']);
const BADGE_GLYPH = { added: '+', modified: '~', removed: '\u2212' };
const STROKE_VAR = { added: '--backend-stroke', modified: '--cloud-stroke', removed: '--security-stroke' };

const isMarked = (item) => MARKED_STATES.has(item?.change);

// Change review mode starts when one element is added, modified, or removed.
// Changed elements keep their full ink, their 1-hop neighbours stay readable
// as context, and everything else is subdued so the review reads the diff
// first. Inputs without change marks produce an inactive review and no
// attributes, which keeps their rendered bytes unchanged.
const membersOf = (frame) => frame.members || frame.wraps || [];

export function changeReviewFor({ nodes = [], edges = [], frames = [] } = {}) {
  const active = [...nodes, ...edges, ...frames].some(isMarked);
  const changedNodeIds = new Set(nodes.filter(isMarked).map((node) => node.id));
  const neighbourNodeIds = new Set();
  if (active) {
    for (const frame of frames) {
      if (isMarked(frame)) for (const id of membersOf(frame)) neighbourNodeIds.add(id);
    }
    for (const edge of edges) {
      if (!isMarked(edge) && !changedNodeIds.has(edge.from) && !changedNodeIds.has(edge.to)) continue;
      neighbourNodeIds.add(edge.from);
      neighbourNodeIds.add(edge.to);
    }
  }
  const nodeContext = (node) => {
    if (!active || isMarked(node)) return null;
    return neighbourNodeIds.has(node.id) ? 'neighbour' : 'subdued';
  };
  const edgeContext = (edge) => {
    if (!active || isMarked(edge)) return null;
    return changedNodeIds.has(edge.from) || changedNodeIds.has(edge.to) ? 'neighbour' : 'subdued';
  };
  const frameContext = (frame) => {
    if (!active || isMarked(frame)) return null;
    return membersOf(frame).some((id) => changedNodeIds.has(id)) ? 'neighbour' : 'subdued';
  };
  // CSS widens emphasised edges; a stroke-scaled arrowhead would grow with
  // them, so those edges switch to fixed-size markers.
  const fixedEmphasisMarkers = edges.some((edge) => edge?.emphasis === true && !isMarked(edge));
  return { active, fixedEmphasisMarkers, nodeContext, edgeContext, frameContext };
}

function attrs(item, context) {
  let out = '';
  if (CHANGE_STATES.includes(item?.change)) out += ` data-change="${item.change}"`;
  if (item?.emphasis === true) out += ' data-emphasis=""';
  if (context) out += ` data-change-context="${context}"`;
  return out;
}

// Marks without context; for items that are part of a node rather than nodes
// of the graph, such as ERD columns.
export function changeItemAttrs(item) {
  return attrs(item, null);
}

export function changeNodeAttrs(review, node) {
  return attrs(node, review.nodeContext(node));
}

export function changeEdgeAttrs(review, edge) {
  return attrs(edge, review.edgeContext(edge));
}

export function changeFrameAttrs(review, frame) {
  return attrs(frame, review.frameContext(frame));
}

const CHANGE_BADGE_SIZES = Object.freeze({
  node: Object.freeze({ width: 18, height: 13, fontSize: 9.5 }),
  row: Object.freeze({ width: 14, height: 12, fontSize: 9 }),
});

export const CHANGE_EDGE_PREFIX_PX = 12;

export function isChangeMarked(item) {
  return isMarked(item);
}

export function changeEdgeLabelExtraWidth(item) {
  return isMarked(item) ? CHANGE_EDGE_PREFIX_PX : 0;
}

export function renderChangeEdgePrefix(item) {
  if (!isMarked(item)) return '';
  return `<tspan class="t-change-badge-${item.change}" font-weight="700">${BADGE_GLYPH[item.change]} </tspan>`;
}

// Position for a node/container badge. By default the badge straddles the top
// edge. A caller that passes the node's text boxes as `avoid` gets the badge
// inside the top-right corner, clear of the border, when the card is tall
// enough and the badge clears every box; otherwise it straddles as before.
// Both clear rounded corners, right-side adornments (e.g. brand marks or
// toggles), and the top edge of the viewport.
export const CHANGE_BADGE_INSET = 5;
const CHANGE_BADGE_TEXT_CLEARANCE = 2;

export function nodeChangeBadgePos(rect, { rx = 8, rightInset = 0, minTop = 2, avoid = null } = {}) {
  const { width, height } = CHANGE_BADGE_SIZES.node;
  const halfW = width / 2;
  const halfH = height / 2;
  const round1 = (n) => Math.round(n * 10) / 10;
  const place = (inset) => {
    const minCenterX = rect.x + Math.min(rect.width / 2, (inset ? CHANGE_BADGE_INSET : rx + 4) + halfW);
    const maxCenterX = rect.x + rect.width - Math.max(inset ? CHANGE_BADGE_INSET : rx + 4, rightInset) - halfW;
    const x = Math.max(minCenterX, maxCenterX);
    const top = inset ? rect.y + CHANGE_BADGE_INSET + halfH : rect.y;
    const y = Number.isFinite(minTop) ? Math.max(top, minTop + halfH) : top;
    return { x: round1(x), y: round1(y) };
  };
  if (Array.isArray(avoid) && rect.height >= height * 2 + CHANGE_BADGE_INSET * 2) {
    const inside = place(true);
    const pad = CHANGE_BADGE_TEXT_CLEARANCE;
    const clear = avoid.every((box) => !box
      || inside.x + halfW + pad <= box.x || box.x + box.width <= inside.x - halfW - pad
      || inside.y + halfH + pad <= box.y || box.y + box.height <= inside.y - halfH - pad);
    if (clear) return inside;
  }
  return place(false);
}

// Conservative box of a centred text line, for `avoid`: the 0.62em advance
// matches the bundled monospace face (CJK counts two units).
export function centredTextBox(cx, baseline, fontSize, text) {
  const width = textUnits(String(text ?? '')) * fontSize * 0.62;
  return { x: cx - width / 2, y: baseline - fontSize, width, height: fontSize * 1.3 };
}

export const CHANGE_FRAME_BADGE_GAP = 4;

// Frames (boundaries, lanes, groups, segments) carry their badge directly
// after the title, so the mark reads with the label instead of floating on a
// far corner. `title` is the title's box ({ x, y, width, height }); callers
// that render bare text pass its measured extent. `maxRight` keeps the badge
// inside the frame: when the title leaves no room, the badge returns to the
// frame's top-right corner (`fallback`).
export function frameChangeBadgePos(title, { maxRight = Infinity, fallback = null } = {}) {
  const { width } = CHANGE_BADGE_SIZES.node;
  const round1 = (n) => Math.round(n * 10) / 10;
  const left = title.x + title.width + CHANGE_FRAME_BADGE_GAP;
  if (left + width > maxRight && fallback) return fallback;
  return { x: round1(left + width / 2), y: round1(title.y + title.height / 2) };
}

// Measured box of a bare frame title rendered as text at (x, baseline); the
// 0.62em advance matches the bundled monospace face (CJK counts two units).
export function frameTitleBox(x, baseline, fontSize, text) {
  return { x, y: baseline - fontSize, width: textUnits(text) * fontSize * 0.62, height: fontSize * 1.3 };
}

export function changeFrameBadgeWidth(item) {
  return isMarked(item) ? CHANGE_FRAME_BADGE_GAP + CHANGE_BADGE_SIZES.node.width : 0;
}

// A compact [+] [~] [−] pill anchored at (x, y) as its centre, backed by an
// opaque .c-mask rect so borders behind the pill never bleed through.
export function renderChangeBadge(item, { x, y, size = 'node', fontSize } = {}) {
  if (!isMarked(item)) return '';
  const spec = CHANGE_BADGE_SIZES[size] || CHANGE_BADGE_SIZES.node;
  const { width, height } = spec;
  const fs = fontSize ?? spec.fontSize;
  const round1 = (n) => Math.round(n * 10) / 10;
  const left = round1(x - width / 2);
  const top = round1(y - height / 2);
  return `<g data-change-badge="${item.change}" pointer-events="none">`
    + `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="3" class="c-mask"/>`
    + `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="3" class="c-change-badge-${item.change}" stroke-width="1"/>`
    + `<text x="${round1(x)}" y="${round1(y + fs * 0.36)}" class="t-change-badge-${item.change}" font-size="${fs}" font-weight="700" text-anchor="middle">${BADGE_GLYPH[item.change]}</text>`
    + '</g>';
}

// Appended after a renderer's own legend entries when the review is active so
// the four change states read next to the semantic kinds. Entries are not
// interactive: the legend bridge filters by node kind, not by change state.
export function changeLegendEntries(review, legendConfig, locale) {
  if (!review.active || legendConfig?.mode === 'hidden') return [];
  return CHANGE_STATES.map((state) => ({
    kind: `change-${state}`,
    change: state,
    interactive: false,
    present: true,
    swatchWidth: 16,
    swatchGap: 8,
    label: translateMessage(locale, `legend.change.${state}`),
  }));
}

export function renderChangeLegendSwatch(entry) {
  if (!entry.change) return null;
  return `<rect x="${entry.x}" y="${entry.baseline - 9}" width="16" height="10" rx="2.5" class="c-change-swatch-${esc(entry.change)}" stroke-width="1.5"/>`;
}

// Change and emphasis markers use user-space units: CSS widens these strokes,
// and a stroke-scaled arrowhead would grow with them. The fixed size matches a
// default arrowhead at the renderers' 1.4px default stroke.
const FIXED_MARKER_WIDTH = 14;
const FIXED_MARKER_HEIGHT = 9.8;
const FIXED_FALLBACK_TONES = Object.freeze({
  arrowhead: 'default',
  'arrowhead-emphasis': 'emphasis',
  'arrowhead-security': 'security',
  'arrowhead-dashed': 'dashed',
});

function fixedMarker(id, tone) {
  return `
          <marker id="${id}" markerUnits="userSpaceOnUse" viewBox="0 0 10 7" markerWidth="${FIXED_MARKER_WIDTH}" markerHeight="${FIXED_MARKER_HEIGHT}" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-${tone}" />
          </marker>`;
}

export function changeMarkerDefinitions(review) {
  const change = review.active
    ? ['added', 'modified', 'removed'].map((state) => fixedMarker(`arrowhead-change-${state}`, `change-${state}`)).join('')
    : '';
  const emphasis = review.fixedEmphasisMarkers
    ? Object.entries(FIXED_FALLBACK_TONES).map(([id, tone]) => fixedMarker(`${id}-fixed`, tone)).join('')
    : '';
  return change + emphasis;
}

export function changeMarkerFor(item, fallback) {
  if (isMarked(item)) return `arrowhead-change-${item.change}`;
  if (item?.emphasis === true && Object.hasOwn(FIXED_FALLBACK_TONES, fallback)) return `${fallback}-fixed`;
  return fallback;
}

// The marker tone (`m-<tone>`) of any id changeMarkerFor returns.
export function changeMarkerTone(marker) {
  if (Object.hasOwn(FIXED_FALLBACK_TONES, marker)) return FIXED_FALLBACK_TONES[marker];
  const base = marker.endsWith('-fixed') ? marker.slice(0, -'-fixed'.length) : marker;
  return FIXED_FALLBACK_TONES[base] || base.slice('arrowhead-'.length);
}

export function changeStrokeVar(item) {
  return isMarked(item) ? STROKE_VAR[item.change] : null;
}
