// Canvas containment shared by the ERD and class validators. A placed box that
// escapes the canvas renders clipped or invisible with a clean receipt, so both
// validators report it with the same diagnostic shape as
// 'layout/component-out-of-bounds' in the architecture validator: a named
// subject, per-side overflow evidence, and pixel-precise repairs.

const KIND_NAMES = { entity: 'Entity', type: 'Type' };

function boxIsFinite({ x, y, width, height }) {
  return [x, y, width, height].every(Number.isFinite);
}

function overflowOf({ x, y, width, height }, viewBox) {
  return {
    left: Math.max(0, -x),
    top: Math.max(0, -y),
    right: Math.max(0, x + width - viewBox[0]),
    bottom: Math.max(0, y + height - viewBox[1]),
  };
}

function overflowsCanvas(overflow) {
  return overflow.left > 0 || overflow.top > 0 || overflow.right > 0 || overflow.bottom > 0;
}

function boundsEvidence(id, bounds, viewBox, overflow) {
  return {
    bounds: { id, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    viewBox: [...viewBox],
    overflow,
  };
}

// Moving by exactly the overflow lands the edge flush (x + (-x) is exact in
// IEEE 754); a box larger than the canvas in that direction also has to shrink
// before the same move can fit.
function moveFix(id, kind, direction, amount, bounds, viewBox) {
  const vertical = direction === 'down';
  const span = vertical ? bounds.height : bounds.width;
  const canvas = viewBox[vertical ? 1 : 0];
  const dimension = vertical ? 'height' : 'width';
  const shrink = Math.max(0, span - canvas);
  const move = `move ${kind} "${id}" ${direction} by ${amount}px`;
  return shrink > 0 ? `${move} and shrink its ${dimension} by at least ${shrink}px` : move;
}

// A wider canvas rescues only a box that can fit inside one, so the fix is not
// offered when the box is wider or taller than the canvas itself.
function canvasFix(bounds, viewBox, overflow) {
  const wider = overflow.left > 0 && overflow.right > 0;
  const taller = overflow.top > 0 && overflow.bottom > 0;
  const rescuable = (overflow.right > 0 && !wider) || (overflow.bottom > 0 && !taller);
  if (!rescuable) return null;
  const coverW = wider ? viewBox[0] : Math.ceil(bounds.x + bounds.width);
  const coverH = taller ? viewBox[1] : Math.ceil(bounds.y + bounds.height);
  return `set meta.viewBox to at least [${Math.max(viewBox[0], coverW)}, ${Math.max(viewBox[1], coverH)}]`;
}

function outOfBoundsFixes(id, kind, bounds, viewBox, overflow) {
  return [
    overflow.left > 0 && moveFix(id, kind, 'right', overflow.left, bounds, viewBox),
    overflow.top > 0 && moveFix(id, kind, 'down', overflow.top, bounds, viewBox),
    canvasFix(bounds, viewBox, overflow),
  ].filter(Boolean);
}

// Diagnostic for a placed box that escapes the canvas; null when the box is
// inside or cannot be measured (a placement error already names that case).
export function outOfBoundsEntry(id, kind, diagramType, subjectKey, bounds, viewBox) {
  if (!boxIsFinite(bounds)) return null;
  const overflow = overflowOf(bounds, viewBox);
  if (!overflowsCanvas(overflow)) return null;
  return {
    code: 'layout/component-out-of-bounds',
    severity: 'error',
    message: `${KIND_NAMES[kind]} "${id}" falls outside the viewBox ${viewBox[0]}x${viewBox[1]} — adjust pos/size or set a larger meta.viewBox.`,
    subject: { diagramType, [subjectKey]: id },
    evidence: boundsEvidence(id, bounds, viewBox, overflow),
    supportedFixes: outOfBoundsFixes(id, kind, bounds, viewBox, overflow),
  };
}
