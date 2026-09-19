export const DESKTOP_READABILITY_VIEWPORT = Object.freeze({ width: 1440, height: 900 });
export const DESKTOP_READER_MIN_WIDTH = 960;
export const DESKTOP_READER_HORIZONTAL_CHROME = 30;
export const DESKTOP_READER_DIAGRAM_WIDTH = DESKTOP_READER_MIN_WIDTH - DESKTOP_READER_HORIZONTAL_CHROME;
export const MIN_PROJECTED_NODE_TEXT_PX = 6;

export const LARGE_WORLD_READABILITY_CONTRACT = Object.freeze({
  version: 1,
  minimumProjectedTextPx: MIN_PROJECTED_NODE_TEXT_PX,
  targetPaddingCssPx: 24,
  maximumFitMultiplier: 32,
  maximumWorldToCssScale: 4,
  minimumDesktopViewportWidthExclusive: 720,
  minimumAvailableStageHeight: 360,
  maximumStageHeight: 900,
  stageBottomGapCssPx: 24,
  labelSelectors: Object.freeze([
    'text[data-node-label]',
    'text[data-boundary-label]',
    '[data-node-id] text[data-detail="context"]',
  ]),
});

export function deriveLargeWorldReadabilityWithContract(contract, {
  safeStageWidth,
  safeStageHeight,
  canonicalWorldWidth,
  canonicalWorldHeight,
  minimumTargetSourceFontWorldUnits,
  targetBoundsWidth,
  targetBoundsHeight,
} = {}) {
  const values = [
    safeStageWidth,
    safeStageHeight,
    canonicalWorldWidth,
    canonicalWorldHeight,
    minimumTargetSourceFontWorldUnits,
    targetBoundsWidth,
    targetBoundsHeight,
  ];
  if (!values.every(Number.isFinite) || values.some((value) => value <= 0)) return null;

  if (!contract || typeof contract !== 'object') return null;
  const worldScaleFit = Math.min(
    safeStageWidth / canonicalWorldWidth,
    safeStageHeight / canonicalWorldHeight,
  );
  const projectedTextPx = minimumTargetSourceFontWorldUnits * worldScaleFit;
  const requiredReadableScale = contract.minimumProjectedTextPx / minimumTargetSourceFontWorldUnits;
  const paddedWidth = safeStageWidth - contract.targetPaddingCssPx * 2;
  const paddedHeight = safeStageHeight - contract.targetPaddingCssPx * 2;
  const targetFitScale = paddedWidth > 0 && paddedHeight > 0
    ? Math.min(paddedWidth / targetBoundsWidth, paddedHeight / targetBoundsHeight)
    : 0;
  const maximumWorldToCssScale = Math.max(
    worldScaleFit,
    Math.min(worldScaleFit * contract.maximumFitMultiplier, contract.maximumWorldToCssScale),
  );
  const targetWorldToCssScale = Math.max(worldScaleFit, requiredReadableScale);

  return {
    worldProfile: projectedTextPx < contract.minimumProjectedTextPx ? 'large' : 'small',
    worldScaleFit,
    projectedTextPx,
    requiredReadableScale,
    targetFitScale,
    maximumWorldToCssScale,
    targetWorldToCssScale,
    cameraMultiplier: targetWorldToCssScale / worldScaleFit,
    targetReadableAndContained: targetWorldToCssScale <= Math.min(targetFitScale, maximumWorldToCssScale),
  };
}

export function deriveLargeWorldReadability(measurements = {}) {
  return deriveLargeWorldReadabilityWithContract(LARGE_WORLD_READABILITY_CONTRACT, measurements);
}

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
