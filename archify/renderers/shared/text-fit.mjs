// Single-line node text fitting, shared by every renderer.
//
// Node text (`label`, `sublabel`, `tag`) renders as one <text> element with
// text-anchor="middle" and is never wrapped. Left unmeasured, an over-long
// value silently spills across its neighbours while validation still reports
// a clean receipt — the failure mode this module exists to close.
//
// Two halves, always used together:
//   - fittedNodeFontSize shrinks the text toward a legible minimum at render
//     time, so ordinary overruns simply get smaller instead of overlapping.
//   - minimumNodeTextWidth reports the width the text still needs once it has
//     shrunk as far as it may, so validation can reject what shrinking cannot
//     save.
//
// The geometry constants below are shared; the per-field `preferred` and
// `minimum` font sizes are not, because renderers set node text at different
// sizes (architecture sublabels are 9px, the rest are 7px).

import { textUnits, SEMANTIC_SIGIL_FOOTPRINT } from './utils.mjs';

// widthFactor: px of advance width per text unit, per px of font size.
// horizontalPadding: total px reserved inside the box so text never touches
// the border.
export const nodeTextFit = {
  widthFactor: 0.6,
  horizontalPadding: 8,
};

// Largest font size at or below `preferred` that fits `text` inside `width`,
// floored at `minimum` — below that the text is no longer legible and the
// caller should be reporting a problem instead.
export function fittedNodeFontSize(text, width, preferred, minimum) {
  const units = Math.max(1, textUnits(text));
  const available = Math.max(1, width - nodeTextFit.horizontalPadding);
  const fitted = Math.min(preferred, available / (units * nodeTextFit.widthFactor));
  return Math.max(minimum, Math.floor(fitted * 10) / 10);
}

// Width `text` occupies at its legible minimum. Compare against
// `width - nodeTextFit.horizontalPadding` to decide whether shrink-to-fit can
// rescue it.
export function minimumNodeTextWidth(text, minimum) {
  return textUnits(text) * minimum * nodeTextFit.widthFactor;
}

// Available text width inside a box of `width`.
export function availableNodeTextWidth(width) {
  return width - nodeTextFit.horizontalPadding;
}

// ---- semantic sigil clearance ----
//
// The sigil occupies one top corner of the node while the label is centred in
// the same band, so the two halves below mirror the sublabel/tag rule above:
// the render half keeps an ordinary label clear of the icon, and the
// validation half reports the label that still cannot clear it once it has
// shrunk as far as it may.
//
// Only the sigil's own footprint is reserved, and the label is re-centred into
// the space beside it rather than shrunk symmetrically around the node centre.
// Reserving twice the footprint (once per side, to keep a centred label) would
// leave too little width for ordinary labels: measured against the checked-in
// workflow example it rejects 7 of 12 nodes, which is not a repairable defect
// in those diagrams.

// Rendered advance width of node text at `fontSize`.
export function nodeTextWidth(text, fontSize) {
  return textUnits(text) * fontSize * nodeTextFit.widthFactor;
}

// Width available to a node label that shares its band with a semantic sigil.
// Composes with `brandLabelFitWidth`: the tighter reserve binds, so callers
// pass `Math.min(...)` of the two rather than subtracting both.
export function sigilLabelFitWidth(width) {
  return Math.max(1, width - SEMANTIC_SIGIL_FOOTPRINT);
}

// Centre x for a node label that must clear the sigil. Shifts only when the
// label would otherwise reach the icon, so a short label keeps the node centre
// and its rendered output is unchanged. The shifted limit is rounded away from
// the sigil, never toward it, so rounding cannot eat the clearance it just won.
export function sigilClearedLabelCenter(nodeX, width, textWidth, side = 'left') {
  const centre = nodeX + width / 2;
  if (side === 'right') {
    const limit = Math.floor((nodeX + width - SEMANTIC_SIGIL_FOOTPRINT - textWidth / 2) * 10) / 10;
    return centre <= limit ? centre : limit;
  }
  const limit = Math.ceil((nodeX + SEMANTIC_SIGIL_FOOTPRINT + textWidth / 2) * 10) / 10;
  return centre >= limit ? centre : limit;
}

// Reported when shrink-to-fit has bottomed out at the legible minimum and the
// label still cannot clear the sigil — i.e. no label position satisfies both
// "clears the icon" and "stays inside the node".
//
// `widthFactor` is an approximation of advance width, so the comparison carries
// a 1px tolerance: below that the estimate is not precise enough to justify
// rejecting a diagram, and the render half absorbs the remainder. Real defects
// miss by far more than a pixel (the narrow-node regression misses by ~6px).
const SIGIL_CLEARANCE_TOLERANCE = 1;

export function sigilLabelClearanceProblem(id, label, width, minimumFontSize, subject = 'Node') {
  const available = width - SEMANTIC_SIGIL_FOOTPRINT;
  const required = minimumNodeTextWidth(label, minimumFontSize);
  if (available >= required - SIGIL_CLEARANCE_TOLERANCE) return null;
  return `${subject} "${id}" reserves ${SEMANTIC_SIGIL_FOOTPRINT}px for its semantic sigil, leaving `
    + `${Math.max(0, Math.round(available))}px for its label, but "${label}" needs `
    + `~${Math.ceil(required)}px at the ${minimumFontSize}px legible minimum — widen the node `
    + `or shorten the label.`;
}
