export const DESKTOP_READABILITY_VIEWPORT = Object.freeze({ width: 1440, height: 900 });
export const DESKTOP_READER_MIN_WIDTH = 960;
export const DESKTOP_READER_HORIZONTAL_CHROME = 30;
export const DESKTOP_READER_DIAGRAM_WIDTH = DESKTOP_READER_MIN_WIDTH - DESKTOP_READER_HORIZONTAL_CHROME;
export const MIN_PROJECTED_NODE_TEXT_PX = 6;
export const DECLARED_WIDE_READER_CONTRACT = 'declared-wide-v1';
export const DECLARED_WIDE_READER_RATIO = 1.55;
export const DECLARED_WIDE_READER_MAX_WIDTH = 1920;
export const DECLARED_WIDE_REFERENCE_BODY_HORIZONTAL_PX = 64;
export const DECLARED_WIDE_REFERENCE_DIAGRAM_HORIZONTAL_PX = 30;

export function projectedNodeTextPx(sourceFontPx, viewBoxWidth, diagramWidth = DESKTOP_READER_DIAGRAM_WIDTH) {
  if (![sourceFontPx, viewBoxWidth, diagramWidth].every(Number.isFinite) || viewBoxWidth <= 0 || diagramWidth <= 0) {
    return Number.NaN;
  }
  return sourceFontPx * Math.min(1, diagramWidth / viewBoxWidth);
}

export function minimumReadableSourceTextPx(
  viewBoxWidth,
  diagramWidth = DESKTOP_READER_DIAGRAM_WIDTH,
  minimumProjectedPx = MIN_PROJECTED_NODE_TEXT_PX,
) {
  if (![viewBoxWidth, diagramWidth, minimumProjectedPx].every(Number.isFinite)
    || viewBoxWidth <= 0
    || diagramWidth <= 0
    || minimumProjectedPx <= 0) {
    return Number.NaN;
  }
  return minimumProjectedPx / Math.min(1, diagramWidth / viewBoxWidth);
}

// This is deliberately separate from the legacy 930px projection. Architecture
// boundary convergence depends on that legacy default, while only a recognized
// v2 wide Reader may use this declared-width proof.
export function declaredWideReadabilityBudget({
  viewBoxWidth,
  viewBoxHeight,
  minimumSourceTextPx,
  requestedMinimumTextPx,
  viewportWidth = DESKTOP_READABILITY_VIEWPORT.width,
  bodyHorizontalPx = DECLARED_WIDE_REFERENCE_BODY_HORIZONTAL_PX,
  diagramHorizontalPx = DECLARED_WIDE_REFERENCE_DIAGRAM_HORIZONTAL_PX,
  minimumReaderWidth = DESKTOP_READER_MIN_WIDTH,
  maximumReaderWidth = DECLARED_WIDE_READER_MAX_WIDTH,
} = {}) {
  const values = [
    viewBoxWidth, viewBoxHeight, minimumSourceTextPx, requestedMinimumTextPx,
    viewportWidth, bodyHorizontalPx, diagramHorizontalPx, minimumReaderWidth, maximumReaderWidth,
  ];
  if (!values.every(Number.isFinite) || viewBoxWidth <= 0 || viewBoxHeight <= 0
    || minimumSourceTextPx <= 0 || requestedMinimumTextPx <= 0 || viewportWidth <= 0
    || bodyHorizontalPx < 0 || diagramHorizontalPx < 0 || minimumReaderWidth <= 0
    || maximumReaderWidth < minimumReaderWidth || viewBoxWidth / viewBoxHeight < DECLARED_WIDE_READER_RATIO) {
    return null;
  }
  const requestedTargetPx = Math.max(MIN_PROJECTED_NODE_TEXT_PX, requestedMinimumTextPx);
  const requestedScale = Math.min(1, requestedTargetPx / minimumSourceTextPx);
  const desiredReaderWidth = Math.max(minimumReaderWidth, viewBoxWidth * requestedScale + diagramHorizontalPx);
  const viewportCap = Math.max(0, viewportWidth - bodyHorizontalPx);
  const cap = Math.min(maximumReaderWidth, viewportCap);
  const actualReaderWidth = Math.min(desiredReaderWidth, cap);
  const guaranteedSvgWidth = Math.max(0, actualReaderWidth - diagramHorizontalPx);
  const projectedMinimumTextPx = projectedNodeTextPx(minimumSourceTextPx, viewBoxWidth, guaranteedSvgWidth);
  const limit = actualReaderWidth < desiredReaderWidth
    ? (viewportCap <= maximumReaderWidth ? 'viewport-cap' : 'reader-cap')
    : 'source-size';
  return {
    requestedTargetPx,
    requestedScale,
    desiredReaderWidth,
    viewportCap,
    maximumReaderWidth,
    actualReaderWidth,
    guaranteedSvgWidth,
    projectedMinimumTextPx,
    hardFloorPx: MIN_PROJECTED_NODE_TEXT_PX,
    hardFloorMet: projectedMinimumTextPx >= MIN_PROJECTED_NODE_TEXT_PX,
    requestedTargetMet: projectedMinimumTextPx >= requestedMinimumTextPx,
    limit,
  };
}

// Vertical chrome that always stacks with the SVG at the 1440x900 desktop
// viewport, measured from the delivered Viewer with the shortest one-line
// header and no cards: body padding 12, header 39, diagram padding/border 75.
// The guided-views strip adds 61 when meta.views exist. Cards are excluded so
// the prediction stays a lower bound.
export const DESKTOP_FIXED_VERTICAL_CHROME_PX = Object.freeze({ body: 12, header: 39, diagram: 75, guidedViews: 61 });

// A canvas the Reader can neither narrow (viewBox ratio below the wide
// threshold) nor scroll readably (no intrinsic-height fit) renders at the full
// reader width, so its page height is a function of the viewBox alone. Returns
// null when the Reader has a way to fit the page; otherwise the certain
// overflow at 1440x900 before any cards are counted.
export function predictedFixedWidthOverflow({
  viewBoxWidth,
  viewBoxHeight,
  readerFit,
  hasGuidedViews = false,
  viewport = DESKTOP_READABILITY_VIEWPORT,
  bodyHorizontalPx = DECLARED_WIDE_REFERENCE_BODY_HORIZONTAL_PX,
  diagramHorizontalPx = DECLARED_WIDE_REFERENCE_DIAGRAM_HORIZONTAL_PX,
  chrome = DESKTOP_FIXED_VERTICAL_CHROME_PX,
} = {}) {
  if (![viewBoxWidth, viewBoxHeight].every(Number.isFinite) || viewBoxWidth <= 0 || viewBoxHeight <= 0) return null;
  const ratio = viewBoxWidth / viewBoxHeight;
  if (readerFit === 'intrinsic-height' || ratio >= DECLARED_WIDE_READER_RATIO) return null;
  const svgWidthPx = viewport.width - bodyHorizontalPx - diagramHorizontalPx;
  const svgHeightPx = Math.round(svgWidthPx * viewBoxHeight / viewBoxWidth);
  const fixedChromePx = chrome.body + chrome.header + chrome.diagram + (hasGuidedViews ? chrome.guidedViews : 0);
  const pageHeightPx = svgHeightPx + fixedChromePx;
  if (pageHeightPx <= viewport.height) return null;
  return {
    viewportWidth: viewport.width,
    viewportHeight: viewport.height,
    ratio: Math.round(ratio * 100) / 100,
    wideRatio: DECLARED_WIDE_READER_RATIO,
    svgWidthPx,
    svgHeightPx,
    fixedChromePx,
    pageHeightPx,
    overflowPx: pageHeightPx - viewport.height,
  };
}

export function describeFixedWidthOverflow(issue) {
  const maximumViewBoxHeight = Math.floor(issue.viewBoxWidth / issue.wideRatio);
  const wideViewBoxWidth = Math.ceil(issue.viewBoxHeight * issue.wideRatio);
  return `Preserve every node, relationship, and label. This ${issue.viewBoxWidth}x${issue.viewBoxHeight} canvas (ratio ${issue.ratio}) declares no intrinsic-height fit and is below the ${issue.wideRatio} wide ratio, so the desktop Reader can neither narrow it nor accept vertical scroll: it renders ${issue.svgHeightPx}px tall at the full ${issue.svgWidthPx}px width and the page reaches ${issue.pageHeightPx}px before cards against ${issue.viewportHeight}px, a certain visual-check failure. Either compact vertical spacing so meta.viewBox height is at most ${maximumViewBoxHeight} at this width, or spread content sideways so the width is at least ${wideViewBoxWidth} at this height; for architecture, omitting meta.viewBox lets the renderer size the canvas and declare the fit.`;
}
