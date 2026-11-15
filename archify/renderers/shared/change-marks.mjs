import { esc } from './utils.mjs';
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
  return { active, nodeContext, edgeContext, frameContext };
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

// Compute a top-edge center position for a node/container badge, clearing
// rounded corners, right-side adornments (e.g. brand marks or toggles), and
// the top edge of the viewport.
export function nodeChangeBadgePos(rect, { rx = 8, rightInset = 0, minTop = 2 } = {}) {
  const { width, height } = CHANGE_BADGE_SIZES.node;
  const halfW = width / 2;
  const halfH = height / 2;
  const minCenterX = rect.x + Math.min(rect.width / 2, rx + 4 + halfW);
  const maxCenterX = rect.x + rect.width - Math.max(rx + 4, rightInset) - halfW;
  const x = Math.round(Math.max(minCenterX, maxCenterX) * 10) / 10;
  const rawY = Number.isFinite(minTop) ? Math.max(rect.y, minTop + halfH) : rect.y;
  const y = Math.round(rawY * 10) / 10;
  return { x, y };
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

export function changeMarkerDefinitions(review) {
  if (!review.active) return '';
  return ['added', 'modified', 'removed'].map((state) => `
          <marker id="arrowhead-change-${state}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-change-${state}" />
          </marker>`).join('');
}

export function changeMarkerFor(item, fallback) {
  return isMarked(item) ? `arrowhead-change-${item.change}` : fallback;
}

export function changeStrokeVar(item) {
  return isMarked(item) ? STROKE_VAR[item.change] : null;
}
