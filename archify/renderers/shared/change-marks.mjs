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

const CHANGE_BADGE_SIZE = Object.freeze({ width: 16, height: 12 });

// A compact [+] [~] [−] pill anchored at (x, y) as its centre. Renderers place
// it on a corner of the element so the badge never competes with the label,
// sigil, or brand mark budgets inside the node.
export function renderChangeBadge(item, { x, y, fontSize = 9 } = {}) {
  if (!isMarked(item)) return '';
  const { width, height } = CHANGE_BADGE_SIZE;
  const left = Math.round((x - width / 2) * 10) / 10;
  const top = Math.round((y - height / 2) * 10) / 10;
  return `<g data-change-badge="${item.change}" pointer-events="none">`
    + `<rect x="${left}" y="${top}" width="${width}" height="${height}" rx="3" class="c-change-badge-${item.change}" stroke-width="1"/>`
    + `<text x="${x}" y="${Math.round((y + fontSize * 0.36) * 10) / 10}" class="t-change-badge-${item.change}" font-size="${fontSize}" font-weight="700" text-anchor="middle">${BADGE_GLYPH[item.change]}</text>`
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
