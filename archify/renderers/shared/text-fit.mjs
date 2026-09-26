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

import { textUnits, SEMANTIC_SIGIL_INSET, SEMANTIC_SIGIL_SIZE, SEMANTIC_SIGIL_FOOTPRINT } from './utils.mjs';

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

// Adapted from Souptik Chakraborty's #220: shift only labels which reach a
// corner icon. Unlike the original hard gate, a narrow valid node uses a
// separate text row; its authored bounds and acceptance remain unchanged.
export function nodeLabelLayout({ width, height, rows, side = 'left', brand = false, step = '' }) {
  const result = { x: width / 2, ys: rows.map(row => row.y), sigilY: SEMANTIC_SIGIL_INSET, sigilSize: SEMANTIC_SIGIL_SIZE };
  const labelWidth = minimumNodeTextWidth(rows[0].text, rows[0].font);
  const stepEnd = step ? (brand ? 23 : 10) + minimumNodeTextWidth(step, 7) + 3 : 0;
  const left = Math.max(side === 'left' ? SEMANTIC_SIGIL_FOOTPRINT + 2 : 4, stepEnd);
  const right = width - (brand ? 26 : side === 'right' ? SEMANTIC_SIGIL_FOOTPRINT + 2 : 4);
  if (result.x - labelWidth / 2 >= left && result.x + labelWidth / 2 <= right) return result;
  if (labelWidth <= right - left) {
    // Round away from the icon, retaining the node centre whenever possible.
    result.x = Math.min(Math.floor((right - labelWidth / 2) * 10) / 10,
      Math.max(result.x, Math.ceil((left + labelWidth / 2) * 10) / 10));
    return result;
  }
  // Keep the existing font sizes and put the text below the decoration rail.
  // Conservative ascent/descent bounds also protect CJK and fallback fonts.
  let bottom = brand ? 22 : SEMANTIC_SIGIL_FOOTPRINT;
  const ys = rows.map(row => {
    const y = Math.max(row.y, Math.ceil((bottom + 2 + row.font * 1.2) * 10) / 10);
    bottom = y + row.font * 0.3;
    return y;
  });
  if (bottom <= height - 2) {
    result.ys = ys;
    return result;
  }
  // A deliberately short fixed box may have no spare row. Preserve its text
  // and geometry, and fit only the decorative sigil in the space above it.
  result.sigilY = 1;
  result.sigilSize = Math.max(1, Math.min(SEMANTIC_SIGIL_SIZE,
    Math.floor(rows[0].y - rows[0].font * 1.2 - 3)));
  return result;
}
