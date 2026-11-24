import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { NODE_CARD_ATTR, nodeCardStyle } from '../shared/node-card-style.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, renderDrilldownMark, resolveNodeDrilldowns, wrapSingleChildAnchor, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { componentBox, boundaryBox, connectionPath } from '../shared/layout-report.mjs';
import { rendererFailure, throwDiagnosticProblems, withIsolatedDiagnosticRecording } from '../shared/diagnostics.mjs';
import { legendFootprint, relationshipLegendObstacles, resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { availableNodeTextWidth, fittedNodeFontSize, minimumNodeTextWidth, nodeTextFit } from '../shared/text-fit.mjs';
import { brandLabelFitWidth, brandMetadataFor, brandTopRailProblem, renderBrandMark } from '../shared/brand-marks.mjs';
import { declaredWideReadabilityBudget, minimumReadableSourceTextPx } from '../shared/desktop-readability.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { changeEdgeAttrs, changeEdgeLabelExtraWidth, changeFrameAttrs, changeLegendEntries, changeMarkerDefinitions, changeMarkerFor, changeNodeAttrs, changeReviewFor, nodeChangeBadgePos, renderChangeBadge, renderChangeEdgePrefix, renderChangeLegendSwatch } from '../shared/change-marks.mjs';
import { gridLayout, resolveComponentPos, validateGridPlacement } from './grid.mjs';
import { automaticComponentPositions, boundaryInsets } from './automatic-placement.mjs';
import { denseTerminalCandidates, junctionBends, junctionCandidates } from './junction-placement.mjs';
import { frameLanePlacements } from './frame-lane-placement.mjs';
import { facingLabelSpacingCandidate, labelBesideStraightShaft, sideCardPortPreferences } from './label-spacing-placement.mjs';
import { placeCrossedLeaf, placeCrossedSinks, facingFramePlacements } from './crossed-leaf-placement.mjs';
import { blockedLinkCount, centeredFanOutCandidates, chainReflowCandidates, compositionImbalance, crossingPlacementCandidates, directLinkCandidates, foldedChain, frameAttachmentCandidates, frameEnclosureCandidates, groupMoveCanPreserveRoutes, groupMovePreservesRoutes, measuredCrossingPairs, nearAlignmentCandidates, routeSpanMeasures, sharedNeighborCandidates, sharedSinkColumnCandidates, strongestLayerOrder, terminalBranchCandidates } from './automatic-placement-candidates.mjs';
import {
  closeReciprocalLanes, createArchitectureRouter, connectionLabelBoxAt, parallelFrameRunLength,
  MIN_PARALLEL_DEPARTURE, parallelRunMeasures, READABLE_FRAME_GAP, READABLE_PORT_GAP,
} from './routing.mjs';
import { placeAutomaticLabels } from '../shared/automatic-labels.mjs';
import { arrowheadTriangle, maskCoversArrowhead } from '../shared/arrowhead.mjs';
import { drawnPathRectClearance, prepareCrossingPath, visibleCrossings } from '../shared/route-crossings.mjs';
import { cleanRouteDetourProblems } from '../shared/route-quality.mjs';
import {
  asArray,
  isFinitePoint,
  rectsOverlap,
  segmentIntersectsRect,
  cleanEndpointSideProblems,
  cleanFlowProblems,
  cleanCrossingProblems,
  cleanAmbiguousCorridorProblems,
  collectArrowheadCollisions,
  routeBudgetMetrics,
  frameBorderSegments,
  roundedPathSegments,
  collectLabelRouteClearance,
  segmentRectClearanceWithin,
  cleanBorderRunProblems,
  cleanRouteRhythmProblems,
  cleanLabelRouteClearanceProblems,
  cleanLabelCanvasContainmentProblems,
  suggestLabelObstacleFix,
  componentSeparationOptions,
  suggestComponentSeparation,
  polylinePath,
  routePointsValue,
  authoredStraightRouteAttrs,
  labelPoint,
  componentFill,
  componentText,
  arrowClassMap,
  edgeLabelAccent,
} from '../shared/geometry.mjs';

const componentTextFit = {
  titleCornerClearance: 40,
  drilldownInset: 19,
  sublabelScalable: 10.5,
  sublabelPreferred: 9,
  sublabelMinimum: 6,
  tagPreferred: 7,
  tagMinimum: 6,
};
const scalableComponentText = /^[ -~·←↑→↓、。！？：；「」，“”\p{Unified_Ideograph}\u3041-\u3096\u30A1-\u30FA\uAC00-\uD7A3]+$/u;
const readerMinimumTextPx = 7.5;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: arch, template, outPath, sourceEvidence } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'architecture',
  defaultExample: 'web-app.architecture.json',
  argv: cliArgs,
});

const grid = gridLayout(arch);

const layout = {
  defaultW: 120,
  defaultH: 60,
  margin: 40,
  boundaryLabelClearance: 4,
  boundaryLabelFontPreferred: 9,
  boundaryLabelFontMinimum: 6,
  boundaryLabelMaskHeight: 16,
  boundaryLabelRailGap: 2,
  boundaryLabelFrameInset: 4,
  legendH: 28,
};

const LEGEND_CATALOG = [
  'frontend',
  'backend',
  'database',
  'cloud',
  'security',
  'messagebus',
  'external',
].map((kind) => ({ kind, label: i18nText(arch.meta.locale, `legend.architecture.${kind}`) }));

function automaticComponentSize(c) {
  const hasDrilldown = resolveNodeDrilldowns(c).length > 0;
  const titleFont = scalableComponentText.test(c.label) ? 12 : 11;
  const sublabelFont = scalableComponentText.test(c.sublabel ?? '')
    ? componentTextFit.sublabelScalable : componentTextFit.sublabelPreferred;
  const titleInset = Math.max(componentTextFit.titleCornerClearance,
    layout.defaultW - brandLabelFitWidth(c, layout.defaultW));
  const width = Math.ceil(Math.max(
    layout.defaultW,
    minimumNodeTextWidth(c.label, titleFont) + titleInset + nodeTextFit.horizontalPadding,
    minimumNodeTextWidth(c.sublabel, sublabelFont) + nodeTextFit.horizontalPadding,
    minimumNodeTextWidth(c.tag, componentTextFit.tagPreferred)
      + (hasDrilldown ? 2 * componentTextFit.drilldownInset : nodeTextFit.horizontalPadding),
  ));
  // Leave space for neighboring cards and routes. Text that cannot fit at the
  // legible minimum within this width still gets the usual overflow diagnostics.
  return [Math.min(width, 256), c.sublabel && (c.tag || hasDrilldown) ? 72 : layout.defaultH];
}

const auto = arch.layout?.mode === 'auto';
const qualityProfile = process.env.ARCHIFY_QUALITY_PROFILE || arch.meta?.quality_profile;
const whollyInferred = auto && !arch.meta?.viewBox && arch.components.every(component => !component.pos);
const automaticLabelOwnershipMargin = 4;
const requiresNestedBoundaryMembership = arch.meta?.engineering_profile === 'deployment-ownership';
const fitInferredBoundaryNesting = auto && requiresNestedBoundaryMembership && !arch.meta?.viewBox
  && arch.components.every(c => !c.pos);
const sizedComponents = asArray(arch.components).map(c => [
  c, c.size ?? (auto ? automaticComponentSize(c) : [layout.defaultW, layout.defaultH]),
]);
const placementInput = auto ? { ...arch, components: sizedComponents.map(([c, size]) => ({ ...c, size })) } : null;
const automaticPositions = placementInput ? automaticComponentPositions(placementInput) : null;

// ---- Measure components from resolved coordinates ----------------------------
function measureComponent(c, [w, h], positions = automaticPositions) {
  const [x, y] = positions ? positions.get(c.id) : resolveComponentPos(c, grid);
  return { ...c, x, y, width: w, height: h, cx: x + w / 2, cy: y + h / 2 };
}

const components = new Map(sizedComponents.map(([c, size]) => [c.id, measureComponent(c, size)]));
const enforcesBoundaryTitleComposition = Boolean(arch.meta?.quality_profile);
const componentSteps = new Map();
for (const [index, conn] of asArray(arch.connections).entries()) {
  if (!componentSteps.has(conn.from)) componentSteps.set(conn.from, index);
  if (!componentSteps.has(conn.to)) componentSteps.set(conn.to, index + 1);
}
for (const [index, c] of asArray(arch.components).entries()) {
  if (!componentSteps.has(c.id)) componentSteps.set(c.id, index);
}

// ---- Boundaries computed from the `wraps` id list ---------------------------
function boundaryRect(boundary, boxes) {
  const members = asArray(boundary.wraps).map((id) => boxes.get(id)).filter(Boolean);
  if (!members.length || members.some(({ x, y, width, height }) => !isFinitePoint(x, y, width, height))) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const member of members) {
    minX = Math.min(minX, member.x);
    minY = Math.min(minY, member.y);
    maxX = Math.max(maxX, member.x + member.width);
    maxY = Math.max(maxY, member.y + member.height);
  }
  const { side: pad, top: topPad, bottom } = boundaryInsets(boundary.pad, enforcesBoundaryTitleComposition);
  return {
    ...boundary,
    x: minX - pad,
    y: minY - topPad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + topPad + bottom,
    memberTop: minY,
  };
}

function rectContains(outer, inner) {
  const epsilon = 1e-9;
  return outer.x <= inner.x + epsilon
    && outer.y <= inner.y + epsilon
    && outer.x + outer.width + epsilon >= inner.x + inner.width
    && outer.y + outer.height + epsilon >= inner.y + inner.height;
}

function containNestedBoundaryFrames(boundaries) {
  if (!fitInferredBoundaryNesting) return boundaries;
  const entries = boundaries.map(boundary => ({ boundary, members: new Set(boundary.wraps) }));
  const innerFirst = [...entries].sort((a, b) => a.members.size - b.members.size);
  for (const child of innerFirst) {
    for (const parent of entries) {
      if (child.members.size >= parent.members.size || rectContains(parent.boundary, child.boundary)) continue;
      if (![...child.members].every(id => parent.members.has(id))) continue;
      // The child may request more padding than its parent. Leave a visible
      // gap between the frames without moving any inferred component.
      const gap = 8;
      const outer = parent.boundary;
      const inner = child.boundary;
      const x = Math.min(outer.x, inner.x - gap);
      const y = Math.min(outer.y, inner.y - gap);
      const right = Math.max(outer.x + outer.width, inner.x + inner.width + gap);
      const bottom = Math.max(outer.y + outer.height, inner.y + inner.height + gap);
      parent.boundary = { ...outer, x, y, width: right - x, height: bottom - y };
    }
  }
  return entries.map(entry => entry.boundary);
}

function boundaryLabelWidth(label, fontSize) {
  return Math.max(30, textUnits(label) * fontSize * 0.6 + 10);
}

const changeReview = changeReviewFor({
  nodes: asArray(arch.components),
  edges: asArray(arch.connections),
  frames: asArray(arch.boundaries),
});

const architectureLegendEntries = [
  ...resolveLegend(
    arch.meta?.legend,
    LEGEND_CATALOG,
    new Set([...components.values()].map((component) => component.type)),
  ),
  ...changeLegendEntries(changeReview, arch.meta?.legend, arch.meta.locale),
];

function connectionLabelBox(conn) {
  return labelBoxes.get(conn);
}

function autoViewBoxFor(boxes, candidateBoundaries, extraRects) {
  let maxX = 0;
  let maxY = 0;
  for (const rects of [boxes.values(), candidateBoundaries, extraRects]) {
    for (const rect of rects) {
      if (!isFinitePoint(rect.x, rect.y, rect.width, rect.height)) continue;
      maxX = Math.max(maxX, rect.x + rect.width);
      maxY = Math.max(maxY, rect.y + rect.height);
    }
  }
  let width = Math.ceil(maxX + layout.margin);
  let footprint = legendFootprint(architectureLegendEntries, {
    width: Math.max(1, width - layout.margin * 2),
  });
  if (footprint.minWidth > width - layout.margin * 2) {
    width = Math.ceil(footprint.minWidth + layout.margin * 2);
    footprint = legendFootprint(architectureLegendEntries, {
      width: width - layout.margin * 2,
    });
  }
  return [
    width,
    Math.ceil(maxY + layout.margin + layout.legendH + footprint.extraHeight),
  ];
}

function resolvedViewBoxWidth(boxes, candidateBoundaries, connectionGeometry) {
  if (Array.isArray(arch.meta?.viewBox) && Number.isFinite(arch.meta.viewBox[0])) {
    return arch.meta.viewBox[0];
  }
  return autoViewBoxFor(boxes, candidateBoundaries, connectionGeometry)[0];
}

function expandBoundaryForReadableTitle(boundary, minimumFontSize) {
  if (!enforcesBoundaryTitleComposition) return boundary;
  const requiredWidth = boundaryLabelWidth(boundary.label, minimumFontSize)
    + layout.boundaryLabelFrameInset * 2;
  const extra = Math.max(0, requiredWidth - boundary.width);
  if (!extra) return boundary;
  return {
    ...boundary,
    x: boundary.x - extra / 2,
    width: boundary.width + extra,
  };
}

function measureBoundaryTitle(boundary, minimumFontSize) {
  const availableWidth = Math.max(0, boundary.width - layout.boundaryLabelFrameInset * 2);
  const units = textUnits(boundary.label);
  const fitted = units > 0
    ? (availableWidth - 10) / (units * 0.6)
    : layout.boundaryLabelFontPreferred;
  const preferredFontSize = Math.max(layout.boundaryLabelFontPreferred, minimumFontSize);
  const fontSize = Math.max(
    minimumFontSize,
    Math.min(preferredFontSize, fitted),
  );
  const desiredWidth = boundaryLabelWidth(boundary.label, fontSize);
  const height = Math.max(layout.boundaryLabelMaskHeight, Math.ceil(fontSize + 7));
  return {
    x: boundary.x + layout.boundaryLabelFrameInset,
    y: boundary.memberTop
      - layout.boundaryLabelClearance
      - height,
    width: Math.min(availableWidth, desiredWidth),
    height,
    fontSize,
    minimumFontSize,
    baselineOffset: fontSize + 4,
    availableWidth,
    minimumWidth: boundaryLabelWidth(boundary.label, minimumFontSize),
  };
}

function horizontalOverlap(left, right) {
  return left.x < right.x + right.width && left.x + left.width > right.x;
}

// A route through a title disappears under its mask and reads as struck-through
// text. Keep the left rail position when it is clear; otherwise slide the title
// along its rail to the nearest clear position inside the frame.
function slideTitleOffRoutes(boundary, title, placedTitles, {
  titleRouteSegments, boxes, connectionLabels, allowBottomRail = whollyInferred,
}) {
  if (!enforcesBoundaryTitleComposition) return;
  const clear = (x, y = title.y) => {
    const rect = { ...title, x, y };
    return !titleRouteSegments.some((segment) => segmentIntersectsRect(segment, rect, 2))
      && ![...placedTitles, ...boxes.values(), ...connectionLabels].some((other) => rectsOverlap(rect, other));
  };
  if (clear(title.x)) return;
  const left = boundary.x + layout.boundaryLabelFrameInset;
  const right = boundary.x + boundary.width - layout.boundaryLabelFrameInset - title.width;
  const band = titleRouteSegments.filter(({ start, end }) => (
    Math.max(start[1], end[1]) >= title.y - 2 && Math.min(start[1], end[1]) <= title.y + title.height + 2
  ));
  const labelBlockers = connectionLabels.filter((label) => (
    label.y < title.y + title.height && label.y + label.height > title.y
  ));
  const x = [right, ...band.flatMap(({ start, end }) => [
    Math.max(start[0], end[0]) + 8, Math.min(start[0], end[0]) - 8 - title.width,
  ]), ...labelBlockers.flatMap((label) => [
    label.x + label.width + 8, label.x - 8 - title.width,
  ])].filter((value) => value >= left && value <= right)
    .sort((a, b) => a - b)
    .find(value => clear(value));
  if (x !== undefined) {
    title.x = x;
    return;
  }
  if (!allowBottomRail) return;
  // Wide titles sometimes cannot fit on either side of a route on the top
  // rail. Try the unused bottom inset before changing the frame's footprint.
  const bottomRail = boundary.y + boundary.height - title.height - layout.boundaryLabelFrameInset;
  const bottomX = [left, (left + right) / 2, right].find(value => clear(value, bottomRail));
  if (bottomX !== undefined) {
    title.x = bottomX;
    title.y = bottomRail;
  }
}

function layoutBoundaryTitles(rawBoundaries, minimumFontSize, scene) {
  const placedTitles = [];
  const measured = new Map();
  const ordered = rawBoundaries
    .map((boundary, index) => ({ boundary, index }))
    .sort((left, right) => {
      const areaDelta = left.boundary.width * left.boundary.height
        - right.boundary.width * right.boundary.height;
      return areaDelta || left.index - right.index;
    });

  for (const entry of ordered) {
    const { index } = entry;
    const boundary = expandBoundaryForReadableTitle(entry.boundary, minimumFontSize);
    const title = measureBoundaryTitle(boundary, minimumFontSize);
    let guard = 0;
    while (guard < rawBoundaries.length + scene.boxes.size + 1) {
      guard += 1;
      const blockers = [
        ...placedTitles,
        ...scene.boxes.values(),
      ].filter((candidate) => horizontalOverlap(title, candidate) && rectsOverlap(title, candidate));
      if (!blockers.length) break;
      title.y = blockers.reduce(
        (min, blocker) => Math.min(min, blocker.y - layout.boundaryLabelRailGap - title.height),
        Infinity,
      );
    }
    slideTitleOffRoutes(boundary, title, placedTitles, scene);
    placedTitles.push(title);
    measured.set(index, { boundary, title });
  }

  const measuredFrames = rawBoundaries.map((_boundary, index) => {
    const { boundary, title } = measured.get(index);
    const bottom = boundary.y + boundary.height;
    // Profile-less schema-v1 inputs keep their legacy boundary geometry. A
    // quality profile opts into the stricter title-composition contract and
    // may expand the frame to contain an adapted title rail.
    const y = enforcesBoundaryTitleComposition
      ? Math.min(boundary.y, title.y - layout.boundaryLabelFrameInset)
      : boundary.y;
    return {
      ...boundary,
      y,
      height: bottom - y,
      title,
    };
  });
  return containNestedBoundaryFrames(measuredFrames);
}

// ---- Routing state ----------------------------------------------------------
// Initialized before the boundary-title work below: connection label rects are
// part of the derived canvas, so the title convergence must measure the same
// width the diagram actually renders into (a title sized for a narrower canvas
// would fall below the desktop-readability floor once labels grow it). Routing
// reads components, connections and the member-derived boundary frames (so an
// automatic route never borrows a frame border as its corridor), never the
// title-expanded frames or the viewBox.
const boundsFor = boxes => containNestedBoundaryFrames(asArray(arch.boundaries)
  .map(boundary => boundaryRect(boundary, boxes)).filter(Boolean));
const forRouting = boundaries => boundaries.map(boundary => ({
  ...boundary,
  radius: boundary.kind === 'security-group' ? 8 : 12,
}));
let rawBoundaries = boundsFor(components);
const routingFrames = forRouting(rawBoundaries);
const connections = asArray(arch.connections);
const makeRouter = (boxes, boundaries = rawBoundaries, routingOptions = {}) => {
  let acceptedProblems;
  return createArchitectureRouter(boxes, connections, {
    automaticPlacement: Boolean(automaticPositions),
    ...routingOptions,
    fixedCanvas: Boolean(arch.meta?.viewBox),
    frames: forRouting(boundaries),
    acceptSimplification: (before, after) => {
      acceptedProblems ??= labelProblems(resolveConnectionComposition(boxes, before, boundaries));
      const candidateProblems = labelProblems(resolveConnectionComposition(boxes, after, boundaries));
      if (!preservesLabels(acceptedProblems, candidateProblems)) return false;
      acceptedProblems = candidateProblems;
      return true;
    },
  });
};
const routable = new Map([...components].filter(([, box]) => isFinitePoint(box.x, box.y, box.width, box.height)));
let router = makeRouter(routable);
// The ordinary placement passes share this allowance. Larger scenes
// already spend more on each routing call.
const placementRouteLimit = components.size >= 24 || connections.length >= 28 ? 4 : 12;
let remainingPlacementRoutes = placementRouteLimit;
let routedFrameLaneCandidates = 0;
function routePlacement(boxes, bounds, options) {
  if (!remainingPlacementRoutes) return null;
  remainingPlacementRoutes -= 1;
  return makeRouter(boxes, bounds, options);
}
if (automaticPositions && !arch.meta?.viewBox) {
  const leaf = placeCrossedLeaf(routable, connections, routingFrames, router, routePlacement);
  const sinks = placeCrossedSinks(routable, connections, routingFrames, router, routePlacement,
    (boxes, before, after) => preservesLabels(
      labelProblems(resolveConnectionComposition(routable, before)),
      labelProblems(resolveConnectionComposition(boxes, after)),
    ));
  const placement = leaf || sinks;
  if (placement) {
    for (const box of leaf ? [leaf.box] : sinks.boxes) components.set(box.id, box);
    router = placement.router;
  } else if (routingFrames.length === 2) {
    const right = Math.max(...routingFrames.map(frame => frame.x + frame.width),
      ...[...routable.values()].map(box => box.x + box.width));
    for (const moved of facingFramePlacements(routable, connections, routingFrames, right)) {
      const bounds = boundsFor(moved);
      if (bounds.some(frame => [...moved.values()].some(box => !frame.wraps.includes(box.id) && rectsOverlap(frame, box)))) continue;
      const candidate = routePlacement(moved, bounds);
      if (!candidate) break;
      const previous = resolveConnectionComposition(routable, router.pathFor);
      const next = resolveConnectionComposition(moved, candidate.pathFor, bounds);
      const before = routeBudgetMetrics({ routedRelations: previous.routes });
      const after = routeBudgetMetrics({ routedRelations: next.routes });
      if (candidate.crossingPairs().length < router.crossingPairs().length
          && after.routesOverSuggestedBends <= before.routesOverSuggestedBends
          && after.routesOverSuggestedStretch <= before.routesOverSuggestedStretch
          && next.viewBox.every((extent, axis) => extent <= previous.viewBox[axis])
          && candidate.planIsClear(previous.viewBox, { checkProvisionalLabels: false })
          && preservesLabels(labelProblems(previous), labelProblems(next))) {
        for (const [id, box] of moved) components.set(id, box);
        rawBoundaries = bounds;
        router = candidate;
        break;
      }
    }
  }
}
const routedEndpointIds = new Set(routable.keys());
const canRoute = conn => routedEndpointIds.has(conn.from) && routedEndpointIds.has(conn.to);
const pathFor = conn => canRoute(conn) ? router.pathFor(conn) : { points: [] };
function hasAutomaticRouteGeometry(connection) {
  return !Array.isArray(connection?.via)
    && (!connection?.route || connection.route === 'auto')
    && connection?.channelX === undefined
    && connection?.channelY === undefined;
}
function resolveBoundaryTitles(scene, connectionGeometry, rawBoundaries) {
  const { boxes } = scene;
  if (!enforcesBoundaryTitleComposition || rawBoundaries.length === 0) {
    return {
      boundaries: layoutBoundaryTitles(rawBoundaries, layout.boundaryLabelFontMinimum, scene),
      readabilityProblem: null,
    };
  }

  const maximumIterations = 32;
  let candidateBoundaries = rawBoundaries;
  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    const budgetViewBoxWidth = resolvedViewBoxWidth(boxes, candidateBoundaries, connectionGeometry);
    const minimumFontSize = Math.max(
      layout.boundaryLabelFontMinimum,
      minimumReadableSourceTextPx(budgetViewBoxWidth) + 1e-6,
    );
    const nextBoundaries = layoutBoundaryTitles(rawBoundaries, minimumFontSize, scene);
    const finalViewBoxWidth = resolvedViewBoxWidth(boxes, nextBoundaries, connectionGeometry);
    const finalMinimumFontSize = Math.max(
      layout.boundaryLabelFontMinimum,
      minimumReadableSourceTextPx(finalViewBoxWidth),
    );
    if (minimumFontSize >= finalMinimumFontSize) {
      return { boundaries: nextBoundaries, readabilityProblem: null };
    }
    candidateBoundaries = nextBoundaries;
  }

  const finalViewBoxWidth = resolvedViewBoxWidth(boxes, candidateBoundaries, connectionGeometry);
  return {
    boundaries: candidateBoundaries,
    readabilityProblem: `[composition/desktop-readability] Boundary title layout did not converge after ${maximumIterations} iterations for the final ${finalViewBoxWidth}px viewBox — shorten boundary labels, provide a wider authored viewBox, or move wrapped components closer to the left edge.`,
  };
}

// Run the same title, canvas and label placement for a route proposal and
// for the SVG. The router's provisional label reservations only prune probes.
function routeStrokeWidth(relation) {
  return relation.width || (relation.variant === 'emphasis' ? 1.8 : 1.5);
}

function routeMarkerScale(points, stroke) {
  // Keep the standard markers and their short approaches unchanged.
  const maxScale = 2.4;
  if (stroke <= maxScale || points.length < 2) return stroke;
  const tip = points.at(-1);
  const previous = distinctNeighbor(points, 'end');
  const lastLeg = Math.hypot(tip[0] - previous[0], tip[1] - previous[1]);
  // Preserve the marker's aspect ratio. Reserve 60% of the drawn approach
  // for the shaft and limit the full triangle to 24 × 16.8 SVG units.
  if (!lastLeg || lastLeg - 8 >= 25 * maxScale) return maxScale;
  const last = roundedPathSegments(points, 8).findLast(({ start, end }) =>
    start[0] !== end[0] || start[1] !== end[1]);
  return Math.min(maxScale, Math.hypot(last.end[0] - last.start[0], last.end[1] - last.start[1]) / 25);
}

function endpointLabelZones({ relation, points }) {
  const stroke = routeStrokeWidth(relation);
  function zone(tip, next, along, across, overhang = 0) {
    const distance = Math.hypot(next[0] - tip[0], next[1] - tip[1]);
    if (!distance) return null;
    const [ux, uy] = next.map((value, axis) => (value - tip[axis]) / distance);
    const x = tip[0] + ux * along;
    const y = tip[1] + uy * along;
    const dx = Math.abs(uy) * across;
    const dy = Math.abs(ux) * across;
    const sx = tip[0] - ux * overhang;
    const sy = tip[1] - uy * overhang;
    return { x: Math.min(sx, x) - dx, y: Math.min(sy, y) - dy,
      width: Math.abs(x - sx) + 2 * dx, height: Math.abs(y - sy) + 2 * dy };
  }
  // Reserve the full stroke-scaled approach, even when the rendered marker
  // is smaller. Keep the routing and label clearances independent of the cap.
  const first = distinctNeighbor(points, 'start');
  return [
    zone(points[0], first, Math.min(8, Math.hypot(first[0] - points[0][0], first[1] - points[0][1])), stroke),
    zone(points.at(-1), distinctNeighbor(points, 'end'), 9 * stroke, 3.5 * stroke, stroke),
  ].filter(Boolean);
}

// SVG orients a marker from the last nonzero segment, so skip authored
// waypoints that repeat an endpoint.
function distinctNeighbor(points, end) {
  const tip = end === 'start' ? points[0] : points.at(-1);
  const ordered = end === 'start' ? points.slice(1) : points.slice(0, -1).reverse();
  return ordered.find(([x, y]) => x !== tip[0] || y !== tip[1]) || tip;
}

function routeArrowheads(routes) {
  return routes.map(({ relation, relationIndex, points }) => ({
    relationIndex, marker: arrowheadTriangle(points.at(-1), distinctNeighbor(points, 'end'),
      routeStrokeWidth(relation)),
  }));
}

function labelShaftSlots(points, label, transverseAxis) {
  return points.slice(1).flatMap((end, index) => {
    const start = points[index];
    const axis = start[1] === end[1] ? 0 : 1;
    if (start[1 - axis] !== end[1 - axis]) return [];
    if (transverseAxis !== undefined && axis !== transverseAxis) return [];
    const low = Math.min(start[axis], end[axis]);
    const high = Math.max(start[axis], end[axis]);
    const size = axis === 0 ? label.width : label.height;
    return high - low >= size + 16 ? [{ start, end, axis, low, high }] : [];
  });
}

function labelFitsShaft(rect, slot) {
  const [edge, size] = slot.axis === 0 ? [rect.x, rect.width] : [rect.y, rect.height];
  const reach = rect.height * 2;
  return edge >= slot.low && edge + size <= slot.high
    && segmentRectClearanceWithin(slot, rect, reach) <= reach;
}

function facingGapLabelPlacement(routes, labels, boxes) {
  if (qualityProfile !== 'showcase') return undefined;
  const sideSlots = new Map();
  const labelsByIndex = new Map(labels.map(label => [label.relationIndex, label]));
  for (const { relation, relationIndex, points } of routes) {
    const label = labelsByIndex.get(relationIndex);
    if (!label || !hasAutomaticRouteGeometry(relation)) continue;
    const from = boxes.get(relation.from);
    const to = boxes.get(relation.to);
    const [start, next] = points;
    const end = points.at(-1);
    const previous = points.at(-2);
    const axis = start[1] === next[1] ? 0 : 1;
    const across = 1 - axis;
    if (start[axis] === next[axis] || start[across] !== next[across] || previous[across] !== end[across]
        || (next[axis] - start[axis]) * (end[axis] - previous[axis]) <= 0) continue;
    const low = Math.min(start[axis], end[axis]);
    const high = Math.max(start[axis], end[axis]);
    if ((axis === 0 ? label.width : label.height) <= high - low) continue;
    const crossLow = axis === 0 ? Math.min(from.y, to.y) : Math.min(from.x, to.x);
    const crossHigh = axis === 0 ? Math.max(from.y + from.height, to.y + to.height)
      : Math.max(from.x + from.width, to.x + to.width);
    if (!points.every(point => point[axis] >= low && point[axis] <= high
        && point[across] >= crossLow && point[across] <= crossHigh)) continue;
    sideSlots.set(relationIndex, labelShaftSlots(points, label, across));
  }
  if (!sideSlots.size) return undefined;
  // In a short gap, only a full slot beside a transverse shaft still
  // reads as a relationship label. Keep the collision when no slot fits.
  return rect => {
    const slots = sideSlots.get(rect.relationIndex);
    return !slots || slots.some(slot => labelFitsShaft(rect, slot));
  };
}

function resolveConnectionComposition(boxes, routeFor, measuredBoundaries = boundsFor(boxes)) {
  const routes = connections.flatMap((relation, relationIndex) => {
    if (!boxes.has(relation.from) || !boxes.has(relation.to)) return [];
    const routed = routeFor(relation);
    if (routed.points.length < 2) return [];
    return [{ relation, relationIndex, ...routed }];
  });
  const labels = routes.flatMap(({ relation, relationIndex, points, labelAt }) => relation.label ? [{
    relation, relationIndex, label: relation.label,
    ...connectionLabelBoxAt(relation, labelAt || labelPoint(relation, points)),
  }] : []);
  const titleRouteSegments = routes.flatMap(({ points }) =>
    points.slice(1).map((end, index) => ({ start: points[index], end })));
  // Include route extents too. Fitting cards and labels alone can clip an
  // explicit via route even when every browser overflow check passes.
  const geometry = [...labels, ...routes.flatMap(({ points }) => points.map(([x, y]) => ({ x, y, width: 0, height: 0 })))];
  const titles = resolveBoundaryTitles({ boxes, connectionLabels: labels, titleRouteSegments }, geometry, measuredBoundaries);
  const boundaries = titles.boundaries;
  const viewBox = arch.meta?.viewBox || autoViewBoxFor(boxes, boundaries, geometry);
  const protectedEndpoints = new Map(whollyInferred ? routes
    .filter(({ relation }) => relation.label && hasAutomaticRouteGeometry(relation))
    .map(route => [route.relationIndex, endpointLabelZones(route)]) : []);
  const arrowheads = auto && !arch.meta?.viewBox ? routeArrowheads(routes) : [];
  const showcase = arch.meta?.quality_profile === 'showcase';
  const hitEndpoint = !showcase && labels.some(label => protectedEndpoints.get(label.relationIndex)
    ?.some(zone => rectsOverlap(label, zone)) || arrowheads.some(({ marker }) => maskCoversArrowhead(label, marker)));
  const placed = showcase || hitEndpoint ? placeAutomaticLabels({
    keepFallbackNearRoute: true,
    allowsPlacement: facingGapLabelPlacement(routes, labels, boxes),
    labels,
    routes,
    protectedEndpoints,
    arrowheads,
    ownershipMargin: auto && !whollyInferred && !arch.meta?.viewBox ? automaticLabelOwnershipMargin : 0,
    onlyProtectedEndpoints: !showcase,
    components: [...boxes.values()],
    titles: boundaries.map(boundary => boundary.title),
    viewBox,
    // Resolve labels inside the fitted canvas, above its legend.
    placementBottom: architectureLegendEntries.length
      ? viewBox[1] - 48 - legendFootprint(architectureLegendEntries, { width: viewBox[0] - layout.margin * 2 }).extraHeight
      : viewBox[1],
  }) : labels;
  return { routes, labels: placed, titles, viewBox, boxes, protectedEndpoints, arrowheads };
}

function labelProblems({ routes, labels, titles, viewBox, boxes, protectedEndpoints, arrowheads }, ownershipMargin = 0, drawnOwnership = false) {
  const problems = new Map();
  // Use the same measurements as the composition gate. Compare distances
  // per label and relationship so an existing defect cannot mask a new one.
  for (const hit of collectLabelRouteClearance({ labels, routedRelations: routes, threshold: 4 })) {
    problems.set(`clearance/${hit.labelRelationIndex}/${hit.otherRelationIndex}`, 4 - hit.clearance);
  }
  const distance = (points, rect, limit) => {
    let distance = Infinity;
    for (let index = 1; index < points.length; index += 1) {
      distance = Math.min(distance, segmentRectClearanceWithin({ start: points[index - 1], end: points[index] }, rect, Math.min(distance, limit)));
    }
    return distance;
  };
  const byIndex = new Map(routes.map(route => [route.relationIndex, route]));
  const drawn = drawnOwnership && new Map(routes.map(route => [
    route.relationIndex, prepareCrossingPath(roundedPathSegments(route.points, 8)),
  ]));
  const canvas = { x: 0, y: 0, width: viewBox[0], height: viewBox[1] };
  for (const [index, label] of labels.entries()) {
    const { relationIndex } = label;
    if (protectedEndpoints.get(relationIndex)?.some(zone => rectsOverlap(label, zone))) {
      problems.set(`endpoint/${relationIndex}`, 1);
    }
    for (const { marker, relationIndex: otherIndex } of arrowheads) {
      if (maskCoversArrowhead(label, marker)) problems.set(`marker/${relationIndex}/${otherIndex}`, 1);
    }
    const owner = byIndex.get(relationIndex);
    const own = distance(owner.points, label, Infinity);
    const pinned = ['labelAt', 'labelDx', 'labelDy', 'labelSegment'].some(key => label.relation[key] !== undefined);
    const margin = pinned ? 0 : ownershipMargin;
    const required = own + margin;
    const drawnRequired = drawn && drawnPathRectClearance(drawn.get(relationIndex), label) + margin;
    for (const other of routes) {
      if (other === owner) continue;
      const gap = distance(other.points, label, required);
      if (gap + 0.0001 < required) problems.set(`ownership/${relationIndex}/${other.relationIndex}`, required - gap);
      if (!drawn) continue;
      const drawnGap = drawnPathRectClearance(drawn.get(other.relationIndex), label, drawnRequired);
      if (drawnGap + 0.0001 < drawnRequired) {
        problems.set(`drawn-ownership/${relationIndex}/${other.relationIndex}`, drawnRequired - drawnGap);
      }
    }
    for (const box of boxes.values()) {
      if (rectsOverlap(label, box, -2)) problems.set(`component/${relationIndex}/${box.id}`, 1);
    }
    for (const [frameIndex, { title }] of titles.boundaries.entries()) {
      if (rectsOverlap(label, title)) problems.set(`title/${relationIndex}/${frameIndex}`, 1);
    }
    for (const other of labels.slice(index + 1)) {
      if (rectsOverlap(label, other)) problems.set(`label/${relationIndex}/${other.relationIndex}`, 1);
    }
    if (!rectContains(canvas, label)) problems.set(`canvas/${relationIndex}`, 1);
  }
  return problems;
}

function preservesLabels(before, after) {
  return [...after].every(([pair, severity]) => severity <= (before.get(pair) ?? 0) + 0.0001);
}

function frameEnclosures(boxes, boundaries) {
  return boundaries.flatMap(frame => [...boxes.values()].filter(box => !frame.wraps.includes(box.id) && rectContains(frame, box))
    .map(box => ({ frame, box })));
}

function spacingDebt({ routes, boxes, titles }) {
  const ports = new Map();
  const directed = new Map();
  const borders = forRouting(titles.boundaries).flatMap(frameBorderSegments);
  let portDebt = 0;
  let borderDebt = 0;
  for (const { relation, points } of routes) {
    borderDebt += parallelFrameRunLength(points, borders);
    if (relation.from !== relation.to) {
      const key = JSON.stringify([relation.from, relation.to]);
      for (const other of directed.get(JSON.stringify([relation.to, relation.from])) || []) {
        for (const { separation } of closeReciprocalLanes(points, other)) {
          portDebt += READABLE_PORT_GAP - Math.abs(separation);
        }
      }
      if (!directed.has(key)) directed.set(key, []);
      directed.get(key).push(points);
    }
    for (const [id, tip, adjacent, arrival] of [
      [relation.from, points[0], points[1], false], [relation.to, points.at(-1), points.at(-2), true],
    ]) {
      const box = boxes.get(id);
      const axis = tip[0] === adjacent[0] ? 0 : 1;
      const face = [id, axis, tip[1 - axis] < (axis ? box.cx : box.cy)].join('/');
      const peers = ports.get(face) || [];
      const stub = Math.abs(tip[1 - axis] - adjacent[1 - axis]);
      for (const peer of peers) {
        const reciprocal = peer.relation.from === relation.to && peer.relation.to === relation.from;
        const longDepartures = !arrival && !peer.arrival && Math.min(stub, peer.stub) >= MIN_PARALLEL_DEPARTURE;
        if ((arrival && peer.arrival) || reciprocal || longDepartures) {
          portDebt += Math.max(0, READABLE_PORT_GAP - Math.abs(tip[axis] - peer.value));
        }
      }
      peers.push({ value: tip[axis], stub, arrival, relation });
      ports.set(face, peers);
    }
  }
  return { portDebt, borderDebt };
}

function corridorMeasures({ routes, titles }) {
  const borders = forRouting(titles.boundaries).flatMap(frameBorderSegments);
  return { ...parallelRunMeasures(routes),
    border: routes.reduce((total, { points }) => total + parallelFrameRunLength(points, borders, READABLE_FRAME_GAP), 0) };
}

function placementOrigin(boxes, boundaries = []) {
  let x = Infinity;
  let y = Infinity;
  for (const rects of [boxes.values(), boundaries]) {
    for (const rect of rects) {
      x = Math.min(x, rect.x);
      y = Math.min(y, rect.y);
    }
  }
  return [x, y];
}

function refitBoxesToMargin(boxes, boundaries, {
  margin = [layout.margin, layout.margin], axes = [0, 1], minimumShift = -Infinity,
} = {}) {
  const [dx, dy] = placementOrigin(boxes, boundaries).map((start, axis) => {
    const shift = start - margin[axis];
    return axes.includes(axis) && shift >= minimumShift ? shift : 0;
  });
  return dx || dy ? new Map([...boxes].map(([id, box]) => [id, {
    ...box, x: box.x - dx, y: box.y - dy, cx: box.cx - dx, cy: box.cy - dy,
  }])) : boxes;
}

const sceneBudget = routes => routeBudgetMetrics({ routedRelations: routes });

function measureCandidateScene(scene, crossings = measuredCrossingPairs(scene.routes)) {
  return { crossings, budget: sceneBudget(scene.routes),
    spans: routeSpanMeasures(scene.routes, scene.boxes, scene.viewBox),
    ...junctionBends(scene), area: scene.viewBox[0] * scene.viewBox[1],
    imbalance: compositionImbalance(scene) };
}

function validatesCandidateScene(scene, candidate, allowDiagnostic = () => false) {
  try {
    withIsolatedDiagnosticRecording(() => validateArchitecture(scene, candidate));
    return true;
  } catch (error) {
    if (!error.archifyDiagnostics?.length) throw error;
    return error.archifyDiagnostics.every(allowDiagnostic);
  }
}

function chooseAutomaticPlacement() {
  if (!auto || arch.meta?.viewBox || components.size > 40 || connections.length > 64 || rawBoundaries.length > 24
      || [...components.values()].some(box => box.pos)
      || connections.some(conn => !canRoute(conn) || !hasAutomaticRouteGeometry(conn)
        || ['fromSide', 'toSide'].some(key => conn[key] && conn[key] !== 'auto')
        || ['labelAt', 'labelDx', 'labelDy', 'labelSegment'].some(key => conn[key] !== undefined))) return null;
  const initial = resolveConnectionComposition(components, pathFor, rawBoundaries);
  const enclosures = arch.meta?.quality_profile === 'showcase'
    ? frameEnclosures(components, initial.titles.boundaries) : [];
  const small = components.size <= 24 && connections.length <= 36;
  const crossings = !arch.meta?.viewBox || enclosures.length ? measuredCrossingPairs(initial.routes) : [];
  const canShorten = small && !arch.meta?.viewBox && !enclosures.length;
  if (!enclosures.length && !crossings.length && !canShorten) return initial;
  const labels = labelProblems(initial);
  function measure(scene, pairs) {
    const { budget, spans, area, avoidable, imbalance, crossings } = measureCandidateScene(scene, pairs);
    return { bends: budget.routesOverSuggestedBends, stretch: budget.routesOverSuggestedStretch,
      ...spans, area, avoidable, imbalance, crossings };
  }
  const baseline = measure(initial, crossings);
  let best = { ...baseline, enclosures, scene: initial, router };
  function consider(moved, enclosureLimit = 0, kind = '', routingOptions) {
    if (!remainingPlacementRoutes) return;
    const bounds = boundsFor(moved);
    const candidate = routePlacement(moved, bounds, routingOptions);
    const composed = resolveConnectionComposition(moved, candidate.pathFor, bounds);
    // Recentered branches share the same corridors in a different order.
    // Compare their finished masks instead of the provisional reservations.
    const scene = kind === 'fan-out' ? finishAutomaticLabels(composed) : composed;
    const next = measure(scene);
    const nextCrossings = next.crossings;
    if (next.bends > baseline.bends || next.stretch > baseline.stretch) return;
    const order = nextCrossings.length - best.crossings.length || next.bends - best.bends
      || next.length - best.length || next.area - best.area
      || next.avoidable - best.avoidable || next.imbalance.score - best.imbalance.score;
    const nextEnclosures = enclosureLimit ? frameEnclosures(moved, scene.titles.boundaries) : [];
    if (enclosureLimit) {
      if (nextCrossings.length > crossings.length || nextEnclosures.length >= enclosureLimit
          || (nextEnclosures.length - best.enclosures.length || order) >= 0) return;
    } else if (kind === 'group') {
      if (nextCrossings.length > best.crossings.length || next.bends > best.bends || next.stretch > best.stretch
          || next.longest > best.longest + 0.0001 || next.area > best.area || next.length >= best.length - 0.0001
          || !groupMovePreservesRoutes(best.spans, next.spans)) return;
    } else if (kind === 'span' || kind === 'fan-out') {
      // Both normalizations matter: shrinking a mostly empty canvas must
      // still leave the longest route shorter relative to the whole view.
      if (nextCrossings.length > best.crossings.length || next.bends > best.bends || next.stretch > best.stretch
          || next.length >= best.length - 0.0001 || next.area > best.area || next.longest > best.longest + 0.0001
          || next.spans.reduce((sum, span) => sum + span.centerRatio, 0)
            > best.spans.reduce((sum, span) => sum + span.centerRatio, 0) + 0.0001) return;
    } else if (kind === 'spacing') {
      const old = spacingDebt(best.scene);
      const debt = spacingDebt(scene);
      if (nextCrossings.length > best.crossings.length || next.bends > best.bends || next.stretch > best.stretch
          || next.length > best.length * 1.025 || next.area > best.area || next.longest > best.longest + 0.025
          || debt.portDebt > old.portDebt || debt.borderDebt > old.borderDebt + 0.0001
          || (debt.portDebt === old.portDebt && debt.borderDebt >= old.borderDebt - 0.0001)) return;
    } else if (kind === 'corridor') {
      const old = corridorMeasures(best.scene);
      const debt = corridorMeasures(scene);
      if (nextCrossings.length > best.crossings.length || next.bends > best.bends || next.stretch > best.stretch
          || next.length > best.length * 1.025 || next.area > best.area
          || debt.length > old.length + 0.0001 || debt.border > old.border + 0.0001 || debt.debt > old.debt + 0.0001
          || (debt.debt >= old.debt - 0.0001 && debt.border >= old.border - 0.0001)) return;
    } else if (kind === 'fold') {
      if (nextCrossings.length > best.crossings.length || next.bends > best.bends || next.stretch > best.stretch
          || scene.viewBox[1] >= best.scene.viewBox[1] * 0.75 || next.area > best.area * 1.25) return;
    } else if (order >= 0 || nextCrossings.length >= crossings.length || next.length > baseline.length + 0.0001
        || scene.viewBox.some((size, axis) => size > initial.viewBox[axis])) return;
    if ((kind === 'fan-out' && frameEnclosures(moved, scene.titles.boundaries).length)
        || !candidate.planIsClear(scene.viewBox, { checkProvisionalLabels: false })
        || !preservesLabels(labels, labelProblems(scene))) return;
    if (!validatesCandidateScene(scene, candidate, d => nextEnclosures.length
        && d.code === 'layout/boundary-encloses-non-member')) return;
    best = { ...next, enclosures: nextEnclosures, scene, router: candidate, routingOptions };
  }
  if (!small) {
    // Route only the strongest projected order on larger scenes. The same
    // composition and validation checks decide whether it is kept.
    if (!enclosures.length && crossings.length) {
      const moved = strongestLayerOrder(components, connections, rawBoundaries);
      if (moved) consider(moved);
    }
  } else if (enclosures.length) {
    while (remainingPlacementRoutes > 0 && best.enclosures.length) {
      const start = best;
      // Rank moves on frame geometry before spending any routing work.
      const proposals = [...frameEnclosureCandidates(start.scene.boxes, start.enclosures)]
        .map(moved => ({ moved, count: frameEnclosures(moved, boundsFor(moved)).length }))
        .sort((a, b) => a.count - b.count);
      for (const { moved } of proposals.slice(0, Math.min(remainingPlacementRoutes, 4))) {
        consider(moved, start.enclosures.length);
      }
      if (start === best) break;
    }
    if (best.enclosures.length) return initial;
  } else if (crossings.length) {
    function tryCrossingMoves(candidates) {
      for (const moved of candidates) {
        if (remainingPlacementRoutes <= 0) break;
        consider(moved);
      }
    }
    tryCrossingMoves(crossingPlacementCandidates(components, connections, rawBoundaries, crossings));
    if (remainingPlacementRoutes && best.crossings.length) {
      tryCrossingMoves(frameAttachmentCandidates(best.scene.boxes, connections, best.scene.titles.boundaries, best.crossings));
    }
  }
  if (canShorten) {
    for (const moved of centeredFanOutCandidates(best.scene)) {
      if (!remainingPlacementRoutes) break;
      consider(moved, 0, 'fan-out');
    }
    // Reserve an alternative when the accepted scene has competing lanes.
    const corridor = corridorMeasures(best.scene);
    const reserve = best.crossings.length ? 0 : (corridor.length || corridor.border ? 2 : 1);
    for (let pass = 0; pass < 3 && remainingPlacementRoutes > reserve; pass += 1) {
      const start = best;
      const moves = terminalBranchCandidates(start.scene, start.spans);
      let attempts = 0;
      const tried = new Map();
      for (const { moved, attach } of moves) {
        if (remainingPlacementRoutes <= reserve || attempts >= 6) break;
        if ((tried.get(attach) ?? 0) >= 3) continue;
        tried.set(attach, (tried.get(attach) ?? 0) + 1);
        attempts += 1;
        consider(moved, 0, 'span');
      }
      if (start === best) break;
    }
  }
  if (canShorten) {
    const debt = spacingDebt(best.scene);
    if (debt.portDebt) {
      consider(best.scene.boxes, 0, 'spacing', { spreadLanes: true });
      if (remainingPlacementRoutes > 1) {
        consider(best.scene.boxes, 0, 'spacing', { readablePorts: true, spreadLanes: true });
      }
    }
    if (debt.borderDebt) {
      consider(best.scene.boxes, 0, 'spacing', { frameClearance: 8 });
      if (debt.portDebt) consider(best.scene.boxes, 0, 'spacing', { frameClearance: 8, readablePorts: true });
    }
    const folded = foldedChain(best.scene);
    if (folded) consider(folded, 0, 'fold');
    const corridor = corridorMeasures(best.scene);
    if (corridor.length || corridor.border) {
      consider(best.scene.boxes, 0, 'corridor', { ...best.routingOptions, separateRuns: true });
    }
  }
  if (canShorten && remainingPlacementRoutes) {
    // Judge grouped moves against the finished ordinary placement. Spending
    // this budget earlier can prevent a later branch or spacing repair.
    const origin = placementOrigin(best.scene.boxes);
    for (const { moved } of sharedNeighborCandidates(best.scene, best.spans).slice(0, 4)) {
      if (!remainingPlacementRoutes) break;
      if (!groupMoveCanPreserveRoutes(moved, best.scene.routes, best.spans)) continue;
      // Moving the only cards on an outer band can strand leading space.
      // Keep the existing outer inset by translating the inferred scene.
      const compact = refitBoxesToMargin(moved, [], { margin: origin, minimumShift: 0 });
      consider(compact, 0, 'group', best.routingOptions);
    }
  }
  if (best.router !== router) {
    router = best.router;
    for (const [id, box] of best.scene.boxes) components.set(id, box);
  }
  return { ...best.scene, routingOptions: best.routingOptions };
}

function frameOutline(frame) {
  const edges = frameBorderSegments(frame);
  const segments = edges.flatMap((edge, index) => {
    const next = edges[(index + 1) % edges.length];
    const control = edge.side === 'top' || edge.side === 'bottom'
      ? [next.start[0], edge.end[1]] : [edge.end[0], next.start[1]];
    return [edge, { start: edge.end, end: next.start, control }];
  });
  return prepareCrossingPath(segments);
}

function finishAutomaticLabels(scene, repairFixedCanvas = false, { canMove, sideOnly = false, requiresSlot, enforceSlot = false } = {}) {
  if ((!auto && !canMove) || !scene.labels.length) return scene;
  // A standard diagram with authored layout and canvas keeps its default
  // label, so a collision still reaches the placement diagnostic.
  if (sideOnly && !auto && arch.meta?.viewBox && qualityProfile === 'standard') return scene;
  const clearanceBorders = whollyInferred ? forRouting(scene.titles.boundaries).flatMap(frameBorderSegments) : [];
  const arrowheads = scene.arrowheads.length ? scene.arrowheads : routeArrowheads(scene.routes);
  const frameOutlines = repairFixedCanvas ? forRouting(scene.titles.boundaries).map(frameOutline) : [];
  const strokes = scene.routes.map(({ points, relation, relationIndex }) => {
    const path = prepareCrossingPath(roundedPathSegments(points, 8));
    return { path, relationIndex, corners: { ...path, segments: path.segments.filter(segment => segment.control) },
      halfWidth: routeStrokeWidth(relation) / 2 };
  });
  const strokesByIndex = repairFixedCanvas && new Map(strokes.map(stroke => [stroke.relationIndex, stroke]));
  const allowsGapPlacement = facingGapLabelPlacement(scene.routes, scene.labels, scene.boxes);
  const labels = placeAutomaticLabels({
    ...scene,
    canMove,
    allowsPlacement: requiresSlot
      ? rect => requiresSlot(rect) && (!allowsGapPlacement || allowsGapPlacement(rect))
      : allowsGapPlacement,
    requiresPlacement: enforceSlot ? rect => !requiresSlot(rect) : undefined,
    arrowheads,
    clearanceBorders,
    // The quadratic outline approximates the SVG's round corners within
    // the same two-pixel frame clearance used for straight borders.
    coversFrame: frameOutlines.length ? label => frameOutlines.some(path =>
      drawnPathRectClearance(path, label, 2) < 2 - 0.0001) : undefined,
    coversOwnShaft: repairFixedCanvas ? label => {
      const { path, halfWidth } = strokesByIndex.get(label.relationIndex);
      return drawnPathRectClearance(path, label, halfWidth) < halfWidth;
    } : undefined,
    ownershipMargin: automaticLabelOwnershipMargin,
    repairOwnership: true,
    searchBand: true,
    preferShaftAttachment: sideOnly,
    keepFallbackNearRoute: true,
    // A wholly inferred scene can exhaust its provisional label slots.
    // Check its final masks against cards and corridors as well as ports.
    onlyProtectedEndpoints: !sideOnly && !whollyInferred,
    // A label can interrupt its own straight shaft where space is tight.
    // Keep its bends, and every part of every competing route, visible.
    coversRouteStroke: label => strokes.some(({ path, corners, halfWidth, relationIndex }) =>
      drawnPathRectClearance(!sideOnly && relationIndex === label.relationIndex ? corners : path, label, halfWidth) < halfWidth),
    components: [...scene.boxes.values()],
    titles: scene.titles.boundaries.map(frame => frame.title),
    placementBottom: architectureLegendEntries.length
      ? scene.viewBox[1] - 48 - legendFootprint(architectureLegendEntries, { width: scene.viewBox[0] - layout.margin * 2 }).extraHeight
      : scene.viewBox[1],
  });
  return repairFixedCanvas || labels.some((label, index) => label !== scene.labels[index]) ? { ...scene, arrowheads, labels } : scene;
}

function fixedCanvasComposition(initial) {
  if (!automaticPositions || !arch.meta?.viewBox) return finishAutomaticLabels(initial);
  const compare = (left, right) => {
    for (const [index, value] of left.entries()) {
      if (Math.abs(value - right[index]) > 0.0001) return value - right[index];
    }
    return 0;
  };
  function errorsFor(scene, candidate) {
    try {
      withIsolatedDiagnosticRecording(() => validateArchitecture(scene, candidate));
      return 0;
    } catch (error) {
      if (!error.archifyDiagnostics?.length) throw error;
      return error.archifyDiagnostics.filter(diagnostic => diagnostic.severity === 'error').length;
    }
  }
  let passing;
  let fewestErrors;
  let labelRescues = 2;
  const hasInferredCards = arch.components.some(component => !component.pos);
  const deferredLabelRescues = [];
  function assess(scene, candidate, retryEnclosed = false) {
    let errors = errorsFor(scene, candidate);
    const rescueLabels = errors && labelRescues && scene.labels.length
      && !errorsFor({ ...scene, labels: [] }, candidate);
    if (rescueLabels && !retryEnclosed && hasInferredCards && frameEnclosures(scene.boxes, scene.titles.boundaries).length) {
      // Prefer repairing an enclosure when placement can move. In profiles
      // that allow it, a structurally valid candidate can still use label recovery.
      deferredLabelRescues.push({ scene, candidate });
    } else if (!errors || rescueLabels) {
      const { routesOverSuggestedBends: bends, routesOverSuggestedStretch: stretch } =
        routeBudgetMetrics({ routedRelations: scene.routes });
      const leadingScore = [measuredCrossingPairs(scene.routes).length, bends, stretch];
      if (!passing || compare(leadingScore, passing.leadingScore) <= 0) {
        if (errors) labelRescues -= 1;
        const finished = finishAutomaticLabels(scene);
        errors = finished === scene ? errors : errorsFor(finished, candidate);
        scene = finished;
        if (!errors) {
          const labels = labelProblems({ ...scene, arrowheads: routeArrowheads(scene.routes) }, automaticLabelOwnershipMargin);
          const { length } = routeSpanMeasures(scene.routes, scene.boxes, scene.viewBox);
          const score = [...leadingScore, labels.size, [...labels.values()].reduce((sum, value) => sum + value, 0),
            length, scene.viewBox[0] * scene.viewBox[1]];
          if (!passing || compare(score, passing.score) < 0) {
            passing = { scene, candidate, score, leadingScore };
          }
        }
      }
    }
    const result = { scene, candidate, errors };
    if (!fewestErrors || errors < fewestErrors.errors) fewestErrors = result;
    return result;
  }

  const first = assess(initial, router);
  if (!hasInferredCards) return passing?.scene ?? first.scene;
  const positionKey = boxes => JSON.stringify([...boxes.values()].map(({ x, y }) => [x, y]));
  const seen = new Set([positionKey(components)]);
  function consider(boxes) {
    const key = positionKey(boxes);
    if (seen.has(key)) return null;
    seen.add(key);
    const bounds = boundsFor(boxes);
    const candidate = routePlacement(boxes, bounds);
    return candidate && assess(resolveConnectionComposition(boxes, candidate.pathFor, bounds), candidate);
  }

  // Compare the original card-bounded placement with the initial placement.
  // Inset and packing alternatives are only needed to recover an invalid canvas.
  for (const fixedCanvasRecovery of ['card-bounds', 'insets', 'packing']) {
    if (!remainingPlacementRoutes || (passing && fixedCanvasRecovery !== 'card-bounds')) break;
    const positions = automaticComponentPositions(placementInput, undefined, { fixedCanvasRecovery });
    consider(new Map(sizedComponents.map(([component, size]) =>
      [component.id, measureComponent(component, size, positions)])));
  }
  // The first placement may have an enclosure we can repair even when a
  // different invalid placement has fewer errors. Keep that starting point.
  let repair = first;
  while (!passing && remainingPlacementRoutes && components.size <= 40 && rawBoundaries.length <= 24) {
    const start = repair;
    const enclosures = frameEnclosures(start.scene.boxes, start.scene.titles.boundaries);
    const proposals = [...frameEnclosureCandidates(start.scene.boxes, enclosures)]
      .filter(moved => [...moved.values()].every(box => !box.pos || (box.x === box.pos[0] && box.y === box.pos[1])))
      .map(moved => ({ moved, count: frameEnclosures(moved, boundsFor(moved)).length }))
      .sort((a, b) => a.count - b.count);
    for (const { moved } of proposals.slice(0, Math.min(4, remainingPlacementRoutes))) {
      const attempt = consider(moved);
      if (passing) break;
      if (attempt && attempt.errors < repair.errors) repair = attempt;
    }
    if (start === repair) break;
  }
  for (const { scene, candidate } of deferredLabelRescues) {
    if (passing || !labelRescues) break;
    assess(scene, candidate, true);
  }

  const best = passing ?? fewestErrors;
  router = best.candidate;
  for (const [id, box] of best.scene.boxes) components.set(id, box);
  return best.scene;
}

function repairFixedCanvasLabels(scene) {
  if (!auto || !arch.meta?.viewBox || connections.some(relation => relation.labelAt)) return scene;
  let repaired = finishAutomaticLabels(scene, true);
  const boxes = [...scene.boxes.values()];
  const ownMarker = (composition, label) => composition.arrowheads.find(marker => marker.relationIndex === label.relationIndex)?.marker;
  for (const [index] of repaired.labels.entries()) {
    const before = repaired;
    const label = before.labels[index];
    const blocked = qualityProfile === 'showcase' && boxes.some(box => rectsOverlap(label, box, -2));
    if (!blocked && !maskCoversArrowhead(label, ownMarker(before, label))) continue;
    const baseline = labelProblems(before, automaticLabelOwnershipMargin);
    // A short facing dogleg can leave no legal plate position. Try another
    // route with a full shaft slot and keep the usual collision checks.
    router.repairMaskedApproach(label.relation, before.viewBox, (next, sides, shorter) => {
      const routes = before.routes.map(route => route.relation === label.relation ? { ...route, ...next } : route);
      const arrowheads = routeArrowheads(routes);
      const slots = blocked ? labelShaftSlots(next.points, label) : null;
      if (slots && !slots.length) return false;
      const requiresSlot = slots ? rect => slots.some(slot => labelFitsShaft(rect, slot)) : undefined;
      const labels = blocked ? before.labels.map((rect, i) => i === index
        ? { ...rect, ...connectionLabelBoxAt(label.relation, labelPoint(label.relation, next.points)) } : rect) : before.labels;
      const candidate = finishAutomaticLabels({ ...before, labels, routes, arrowheads }, true, blocked ? {
        canMove: rect => rect.relation === label.relation, sideOnly: true, requiresSlot,
      } : undefined);
      const placed = candidate.labels[index];
      const path = prepareCrossingPath(roundedPathSegments(next.points, 8));
      const halfWidth = routeStrokeWidth(label.relation) / 2;
      if (placed === label || (requiresSlot && !requiresSlot(placed)) || maskCoversArrowhead(placed, ownMarker(candidate, placed))
          || candidate.labels.some(rect => (rect !== placed || blocked || !shorter)
            && drawnPathRectClearance(path, rect, halfWidth) < halfWidth)
          || !preservesLabels(baseline, labelProblems(candidate, automaticLabelOwnershipMargin))) return false;
      const proposedRouter = {
        pathFor: relation => relation === label.relation ? next : router.pathFor(relation),
        connectionEndpointSide: (relation, end) => relation === label.relation
          ? sides[end === 'source' ? 'fromSide' : 'toSide'] : router.connectionEndpointSide(relation, end),
      };
      try {
        withIsolatedDiagnosticRecording(() => validateArchitecture(candidate, proposedRouter));
      } catch (error) {
        if (!error.archifyDiagnostics?.length) throw error;
        return false;
      }
      repaired = candidate;
      return true;
    }, blocked);
  }
  return repaired;
}

const automaticComposition = chooseAutomaticPlacement();
function simplifyFinishedComposition(initial, sceneRouter = router) {
  const straight = new Set(initial.routes.filter(({ points }) => points.length === 2).map(({ relation }) => relation));
  const boxes = [...initial.boxes.values()];
  const blockedStraightLabels = new Set(initial.labels.filter(label =>
    straight.has(label.relation) && boxes.some(box => rectsOverlap(label, box, -2))).map(label => label.relation));
  let current = blockedStraightLabels.size ? finishAutomaticLabels(initial, true, {
    canMove: label => blockedStraightLabels.has(label.relation), sideOnly: true,
  }) : initial;
  let beforeProblems;
  const borders = forRouting(initial.titles.boundaries).flatMap(frameBorderSegments);
  let outlines;
  const labelGap = (route, label) => segmentRectClearanceWithin({ start: route.points[0], end: route.points[1] }, label, Infinity);
  const detached = new Map();
  function acceptRoutes(changes, clearsFrame = false, reattach = false) {
    const updates = new Map(changes.map(change => [change.conn, change]));
    const routes = current.routes.map(route => updates.has(route.relation)
      ? { ...route, ...updates.get(route.relation).routed } : route);
    const changedRoutes = routes.filter(route => updates.has(route.relation));
    const strokes = changedRoutes.map(({ points, relation }) => ({
      path: prepareCrossingPath(roundedPathSegments(points, 8)), halfWidth: routeStrokeWidth(relation) / 2,
    }));
    const coversStroke = rect => strokes.some(({ path, halfWidth }) => drawnPathRectClearance(path, rect, halfWidth) < halfWidth);
    const arrowheads = routeArrowheads(routes);
    let titles = current.titles;
    const blocked = titles.boundaries.filter(({ title }) => coversStroke(title));
    if (blocked.length) {
      if (!clearsFrame || !auto) return false;
      const titleRouteSegments = routes.flatMap(({ points }) =>
        points.slice(1).map((end, index) => ({ start: points[index], end })));
      const boundaries = [...titles.boundaries];
      for (const frame of blocked) {
        const title = { ...frame.title };
        slideTitleOffRoutes(frame, title, boundaries.filter(other => other !== frame).map(other => other.title), {
          boxes: current.boxes, connectionLabels: current.labels, titleRouteSegments, allowBottomRail: true,
        });
        if (coversStroke(title) || arrowheads.some(({ marker }) => maskCoversArrowhead(title, marker))) return false;
        boundaries[boundaries.indexOf(frame)] = { ...frame, title };
      }
      titles = { ...titles, boundaries };
    }
    const protectedEndpoints = new Map(current.protectedEndpoints);
    for (const route of changedRoutes) {
      if (protectedEndpoints.has(route.relationIndex)) protectedEndpoints.set(route.relationIndex, endpointLabelZones(route));
    }
    const labels = current.labels.map(label => updates.has(label.relation)
      ? { ...label, ...connectionLabelBoxAt(label.relation, labelPoint(label.relation, updates.get(label.relation).routed.points)) }
      : label);
    const proposed = { ...current, routes, labels, titles, arrowheads, protectedEndpoints };
    const candidate = changes.some(({ conn }) => conn.label) ? finishAutomaticLabels(proposed, true, {
      canMove: label => updates.has(label.relation), sideOnly: changedRoutes.some(route => route.points.length === 2),
    }) : proposed;
    if (candidate.labels.some(coversStroke)) return false;
    if (reattach && !changedRoutes.every(route => {
      const label = candidate.labels.find(label => label.relation === route.relation);
      const previous = current.routes.find(previous => previous.relation === route.relation);
      return labelGap(route, label) < labelGap(previous, detached.get(route.relation)) - 0.0001;
    })) return false;
    for (const ownLabel of candidate.labels.filter(label => updates.has(label.relation))) {
      outlines ??= forRouting(initial.titles.boundaries).map(frameOutline);
      if (outlines.some(outline => drawnPathRectClearance(outline, ownLabel, 2) < 2 - 0.0001)
          || arrowheads.some(({ marker }) => maskCoversArrowhead(ownLabel, marker))) return false;
    }
    beforeProblems ??= labelProblems({ ...current, arrowheads: routeArrowheads(current.routes) }, automaticLabelOwnershipMargin, true);
    const afterProblems = labelProblems(candidate, automaticLabelOwnershipMargin, true);
    if (!preservesLabels(beforeProblems, afterProblems)) return false;
    const proposedRouter = {
      pathFor: other => updates.get(other)?.routed ?? sceneRouter.pathFor(other),
      connectionEndpointSide: (other, end) => updates.get(other)?.sides[end === 'source' ? 'fromSide' : 'toSide']
        ?? sceneRouter.connectionEndpointSide(other, end),
    };
    try {
      withIsolatedDiagnosticRecording(() => validateArchitecture(candidate, proposedRouter));
    } catch (error) {
      if (!error.archifyDiagnostics?.length) throw error;
      return false;
    }
    beforeProblems = afterProblems;
    current = candidate;
    return true;
  }
  sceneRouter.simplifyFinishedRoutes(initial.viewBox, borders, (conn, routed, sides, clearsFrame) =>
    acceptRoutes([{ conn, routed, sides }], clearsFrame));
  const labelsByRelation = new Map(current.labels.map(label => [label.relation, label]));
  for (const route of current.routes) {
    if (route.points.length !== 2) continue;
    const label = labelsByRelation.get(route.relation);
    if (label && labelGap(route, label) > label.height * 2) detached.set(route.relation, label);
  }
  if (detached.size) sceneRouter.simplifyFinishedRoutes(initial.viewBox, borders, (conn, routed, sides) =>
    acceptRoutes([{ conn, routed, sides }], false, true), detached);
  const routeBounds = [...current.viewBox];
  if (arch.meta?.viewBox) {
    // A fixed canvas may have empty space reserved by the author. Do not
    // open a new bottom corridor beyond the routed scene on that canvas.
    let bottom = 0;
    for (const { y, height } of current.boxes.values()) bottom = Math.max(bottom, y + height);
    for (const { y, height } of current.titles.boundaries) bottom = Math.max(bottom, y + height);
    for (const { points } of current.routes) {
      for (const [, y] of points) bottom = Math.max(bottom, y);
    }
    routeBounds[1] = Math.min(routeBounds[1], bottom);
  }
  sceneRouter.repairFinishedRoutes(routeBounds, borders, acceptRoutes);
  return current;
}

function candidateLabelCheck(scene, measure = drawnLabelProblems) {
  let baseline;
  return next => preservesLabels(baseline ??= measure(scene), measure(next));
}

function evaluateCandidateScene(boxes, {
  bounds = boundsFor(boxes), routingOptions, useAllowance = false, repairFixedCanvas = true, labelOptions,
  checkDesktopFloor = false, checkEnclosures = false, checkLabels,
}) {
  const candidate = (useAllowance ? routePlacement : makeRouter)(boxes, bounds, routingOptions);
  const composed = resolveConnectionComposition(boxes, candidate.pathFor, bounds);
  const placed = finishAutomaticLabels(composed, repairFixedCanvas, labelOptions?.(composed));
  const next = simplifyFinishedComposition(placed, candidate);
  return { candidate, next, ...measureCandidateScene(next), isValid: () =>
    (!checkDesktopFloor || meetsDesktopTextFloor(next))
    && candidate.planIsClear(next.viewBox, { checkProvisionalLabels: false })
    && (!checkEnclosures || !frameEnclosures(boxes, next.titles.boundaries).length)
    && checkLabels(next) && validatesCandidateScene(next, candidate) };
}

function addsCrossings(before, after) {
  return after.some(([a, b]) => !before.some(([x, y]) => a === x && b === y));
}

function alignNearlyFacingCards(initial) {
  if (!automaticComposition || !whollyInferred || !remainingPlacementRoutes || components.size > 24) return initial;
  let current = initial;
  let attempts = 6;
  while (attempts && remainingPlacementRoutes) {
    const before = current;
    const previous = measureCandidateScene(before);
    const checkLabels = candidateLabelCheck(before);
    for (const { relation, boxes } of nearAlignmentCandidates(before)) {
      if (!attempts || !remainingPlacementRoutes) break;
      attempts -= 1;
      const { next: after, candidate, crossings, budget, spans, isValid } = evaluateCandidateScene(boxes, {
        routingOptions: initial.routingOptions, useAllowance: true, checkEnclosures: true, checkLabels,
      });
      if (after.routes.find(route => route.relation === relation).points.length !== 2
          || after.routes.some((route, index) => route.points.length > before.routes[index].points.length)
          || after.viewBox.some((size, axis) => size > before.viewBox[axis])
          || addsCrossings(previous.crossings, crossings)
          || spans.length > previous.spans.length + 0.0001
          || budget.routesOverSuggestedStretch > previous.budget.routesOverSuggestedStretch
          || !isValid()) continue;
      current = after;
      router = candidate;
      for (const [id, box] of boxes) components.set(id, box);
      break;
    }
    if (current === before) break;
  }
  return current;
}

function drawnLabelProblems(scene) {
  const problems = labelProblems({ ...scene, arrowheads: routeArrowheads(scene.routes) }, automaticLabelOwnershipMargin);
  const outlines = forRouting(scene.titles.boundaries).map(frameOutline);
  for (const { points, relation, relationIndex } of scene.routes) {
    const path = prepareCrossingPath(roundedPathSegments(points, 8));
    const halfWidth = routeStrokeWidth(relation) / 2;
    for (const label of scene.labels) {
      const clearance = drawnPathRectClearance(path, label, halfWidth);
      if (clearance < halfWidth) problems.set(`stroke/${label.relationIndex}/${relationIndex}`, halfWidth - clearance);
    }
  }
  for (const label of scene.labels) {
    for (const [index, path] of outlines.entries()) {
      const clearance = drawnPathRectClearance(path, label, 2);
      if (clearance < 2) problems.set(`frame/${label.relationIndex}/${index}`, 2 - clearance);
    }
  }
  return problems;
}

function improveFrameLanes(initial) {
  const frames = initial.titles.boundaries;
  if (!automaticComposition || !frames.length || frames.length > 4
      || components.size > 12 || connections.length > 18) return initial;
  const { budget: baseline, crossings: pairs, spans: before, area: initialArea } = measureCandidateScene(initial);
  if (!pairs.length && !baseline.routesOverSuggestedBends) return initial;
  const affected = new Set(pairs.flat().flatMap(({ from, to }) => [from, to]));
  for (const route of initial.routes) {
    if (sceneBudget([route]).routesOverSuggestedBends) {
      const { relation } = route;
      affected.add(relation.from);
      affected.add(relation.to);
    }
  }
  // A detour can be caused by the position of an adjacent external card.
  const framed = new Set(frames.flatMap(frame => frame.wraps));
  for (const { from, to } of connections) {
    if (framed.has(from) && !framed.has(to) && affected.has(from)) affected.add(to);
    if (framed.has(to) && !framed.has(from) && affected.has(to)) affected.add(from);
  }
  const incoming = new Map();
  const outgoing = new Map();
  for (const { from, to } of connections) {
    incoming.set(to, (incoming.get(to) ?? 0) + 1);
    outgoing.set(from, (outgoing.get(from) ?? 0) + 1);
  }
  const isChainStep = id => incoming.get(id) === 1 && outgoing.get(id) === 1;
  const straightChainLinks = initial.routes.flatMap(({ relation: { from, to } }, index) =>
    !before.spans[index].bends && (isChainStep(from) || isChainStep(to)) ? [index] : []);
  let best = initial;
  let bestRouter;
  let score = [pairs.length, baseline.routesOverSuggestedBends, before.length];
  const checkLabels = candidateLabelCheck(initial, labelProblems);
  // Keep a separate routing allowance for small framed scenes.
  for (const boxes of frameLanePlacements(initial, connections, affected, boundsFor).slice(0, 4)) {
    routedFrameLaneCandidates += 1;
    const { next, candidate, area, budget: nextBudget, crossings: nextPairs, spans, isValid } =
      evaluateCandidateScene(boxes, { repairFixedCanvas: false, checkEnclosures: true, checkLabels });
    const { length, spans: nextSpans } = spans;
    if (area > initialArea || next.viewBox.some((size, axis) => size > initial.viewBox[axis] * 1.025)
        || straightChainLinks.some(index => nextSpans[index].bends
          || nextSpans[index].length > before.spans[index].length + 0.0001)) continue;
    const crossings = nextPairs.length;
    const order = crossings - score[0] || nextBudget.routesOverSuggestedBends - score[1] || length - score[2];
    if (order >= 0 || crossings > pairs.length || length > before.length
        || nextBudget.routesOverSuggestedBends > baseline.routesOverSuggestedBends
        || nextBudget.routesOverSuggestedStretch > baseline.routesOverSuggestedStretch || !isValid()) continue;
    best = next;
    bestRouter = candidate;
    score = [crossings, nextBudget.routesOverSuggestedBends, length];
  }
  if (bestRouter) {
    router = bestRouter;
    for (const [id, box] of best.boxes) components.set(id, box);
  }
  return best;
}

const placedComposition = automaticComposition ? finishAutomaticLabels(automaticComposition)
  : repairFixedCanvasLabels(fixedCanvasComposition(resolveConnectionComposition(components, pathFor, rawBoundaries)));

function meetsDesktopTextFloor({ boxes, labels, titles, viewBox: [width, height] }) {
  let minimumFont = Infinity;
  for (const box of boxes.values()) {
    const { rows } = componentTextRows(box, resolveNodeDrilldowns(box));
    minimumFont = Math.min(minimumFont, rows.title.font, rows.sublabel?.font ?? Infinity);
  }
  for (const label of labels) minimumFont = Math.min(minimumFont, connectionLabelTextFit(label.relation, label.width).fontSize);
  for (const { title } of titles.boundaries) minimumFont = Math.min(minimumFont, title.fontSize);
  const declared = declaredWideReadabilityBudget({
    viewBoxWidth: width, viewBoxHeight: height, minimumSourceTextPx: minimumFont, requestedMinimumTextPx: readerMinimumTextPx,
  });
  return declared?.hardFloorMet ?? (minimumFont >= minimumReadableSourceTextPx(width));
}

function tryFacingLabelSpacing(current, { moved, relations }, bounds, routingOptions) {
  const { next, candidate, crossings, budget, isValid } = evaluateCandidateScene(moved, {
    bounds, routingOptions, useAllowance: true, checkDesktopFloor: Boolean(routingOptions?.sideFor),
    checkLabels: candidateLabelCheck(current),
    labelOptions(composed) {
      const routes = new Map(composed.routes.map(route => [route.relation, route]));
      return {
        requiresSlot: label => !relations.has(label.relation)
          || labelBesideStraightShaft(routes.get(label.relation), label),
        enforceSlot: Boolean(routingOptions?.sideFor),
      };
    },
  });
  const labels = new Map(next.labels.map(label => [label.relation, label]));
  const oldLabels = new Map(current.labels.map(label => [label.relation, label]));
  if (next.routes.some((route, index) => {
    const before = current.routes[index];
    const { relation } = route;
    return route.points.length > before.points.length
      || ((relations.has(relation) || labelBesideStraightShaft(before, oldLabels.get(relation)))
        && !labelBesideStraightShaft(route, labels.get(relation)));
  })) return;
  if (addsCrossings(measuredCrossingPairs(current.routes), crossings)
      || budget.routesOverSuggestedStretch > sceneBudget(current.routes).routesOverSuggestedStretch
      || (routingOptions?.sideFor && spacingDebt(next).portDebt > spacingDebt(current).portDebt + 0.0001)
      || !isValid()) return;
  return { candidate, next };
}

function reserveFacingLabelSpace(initial) {
  if (!whollyInferred || !remainingPlacementRoutes || !initial.labels.length
      || connections.some(conn => !canRoute(conn) || !hasAutomaticRouteGeometry(conn)
        || ['fromSide', 'toSide', 'labelAt', 'labelDx', 'labelDy', 'labelSegment'].some(key => conn[key] !== undefined))) return initial;
  let current = initial;
  function applySpacing(spacing, options) {
    if (!spacing) return false;
    const { moved } = spacing;
    const bounds = boundsFor(moved);
    if (frameEnclosures(moved, bounds).length) return false;
    const accepted = tryFacingLabelSpacing(current, spacing, bounds, options);
    if (!accepted) return false;
    const { candidate, next } = accepted;
    router = candidate;
    for (const [id, box] of moved) components.set(id, box);
    current = next;
    return true;
  }
  const horizontal = facingLabelSpacingCandidate(current, true);
  const widened = applySpacing(horizontal, initial.routingOptions);
  const extended = remainingPlacementRoutes && applySpacing(facingLabelSpacingCandidate(current, false), initial.routingOptions);
  // Keep the ordinary proposals first. A side-card retry can use a spare
  // routing attempt without taking it away from a vertical label slot.
  if (horizontal && !widened && remainingPlacementRoutes) {
    const spacing = extended ? facingLabelSpacingCandidate(current, true) : horizontal;
    const sideFor = spacing && sideCardPortPreferences(current, spacing.relations);
    if (sideFor) applySpacing(spacing, { ...initial.routingOptions, sideFor });
  }
  return current;
}

function compactJunctions(initial) {
  // Compare with the finished ordinary layout so a rejected placement
  // cannot spend the routing attempts used by other repairs.
  if (!automaticComposition || components.size > 16 || connections.length > 24
      || connections.some(connection => connection.fromSide !== undefined || connection.toSide !== undefined)) return initial;
  const proposals = junctionCandidates(initial, 16);
  if (!proposals.length) return initial;
  const baseline = measureCandidateScene(initial);
  const oldCorridors = corridorMeasures(initial);
  let best = initial;
  let bestRouter;
  let bestLength = baseline.spans.length;
  const labels = new Map(initial.labels.map(label => [label.relation, label]));
  const labelSlots = new Set(initial.routes.filter(route => labelBesideStraightShaft(route, labels.get(route.relation)))
    .map(route => route.relation));
  const checkLabels = candidateLabelCheck(initial);
  for (const { boxes: moved, junction, sideFor } of proposals) {
    const originalBounds = boundsFor(moved);
    // Keep the left inset unless it has at least another margin of unused space.
    const boxes = refitBoxesToMargin(moved, originalBounds, { axes: [0], minimumShift: layout.margin });
    const bounds = boxes === moved ? originalBounds : boundsFor(boxes);
    if (frameEnclosures(boxes, bounds).length) continue;
    const { candidate, next, crossings, budget, spans, bends, avoidable, area, isValid } = evaluateCandidateScene(boxes, {
      bounds, routingOptions: { separateRuns: true, sideFor }, checkDesktopFloor: true, checkLabels,
    });
    const corridors = corridorMeasures(next);
    const newLabels = new Map(next.labels.map(label => [label.relation, label]));
    if (spans.length > baseline.spans.length - 32 || spans.length >= bestLength || area > baseline.area
        || bends > baseline.bends || avoidable > baseline.avoidable
        || exceedsRouteBudget(baseline.budget, budget) || crossings.length > baseline.crossings.length
        || corridors.length > oldCorridors.length + 0.0001 || corridors.border > oldCorridors.border + 0.0001
        || next.routes.some((route, i) => {
          const { relation } = route;
          return (relation.from !== junction && relation.to !== junction
              && initial.routes[i].points.length === 2 && route.points.length > 2)
            || (labelSlots.has(relation) && !labelBesideStraightShaft(route, newLabels.get(relation)));
        })
        || !isValid()) continue;
    best = next;
    bestRouter = candidate;
    bestLength = spans.length;
  }
  if (bestRouter) {
    router = bestRouter;
    for (const [id, box] of best.boxes) components.set(id, box);
  }
  return best;
}

function exceedsRouteBudget(before, after) {
  return after.routesOverSuggestedBends > before.routesOverSuggestedBends
    || after.routesOverSuggestedStretch > before.routesOverSuggestedStretch;
}

function betterScore(next, previous) {
  const index = next.findIndex((value, i) => value !== previous[i]);
  return index !== -1 && next[index] < previous[index];
}

function reflowSmallDiagrams(initial, { direct = false } = {}) {
  if (!automaticComposition || initial.titles.boundaries.length || components.size > 12 || connections.length > 24
      || connections.some(connection => connection.fromSide !== undefined || connection.toSide !== undefined)) return initial;
  const proposals = [];
  if (direct) {
    for (const proposal of directLinkCandidates(initial)) {
      proposals.push(proposal);
      if (proposals.length === 24) break;
    }
  } else {
    proposals.push(...sharedSinkColumnCandidates(initial), ...chainReflowCandidates(initial));
  }
  if (!proposals.length) return initial;
  const oldBlocked = direct ? blockedLinkCount(initial) : 0;
  const baseline = measureCandidateScene(initial);
  const checkLabels = candidateLabelCheck(initial);
  let best = initial;
  let bestRouter;
  let score;
  function shortFacingRoute(points, length) {
    const [x, y] = points[0];
    const [u, v] = points.at(-1);
    const [nextX, nextY] = points[1];
    const toward = (nextX - x) * (u - x) + (nextY - y) * (v - y) > 0;
    return toward && length <= Math.abs(x - u) + Math.abs(y - v) + 64;
  }
  for (const { boxes: moved, sideFor, fan, axis, links } of proposals) {
    const boxes = direct ? refitBoxesToMargin(moved) : moved;
    const { candidate, next, crossings, budget, spans, bends, avoidable, imbalance, isValid } =
      evaluateCandidateScene(boxes, { routingOptions: { separateRuns: true, sideFor }, checkDesktopFloor: true, checkLabels });
    if (crossings.length > baseline.crossings.length || avoidable > baseline.avoidable
        || exceedsRouteBudget(baseline.budget, budget)) continue;
    const blocked = direct ? blockedLinkCount(next) : 0;
    if (fan) {
      if (spans.length >= baseline.spans.length - 32 || next.routes.some((route, i) =>
        fan.has(route.relation) && !shortFacingRoute(route.points, spans.spans[i].length))) continue;
    } else if (direct) {
      if (bends > baseline.bends || spans.length >= baseline.spans.length
          || blocked > oldBlocked
          || next.routes.some((route, index) => links.includes(route.relation) && spans.spans[index].bends)) continue;
    } else if (bends > baseline.bends || next.viewBox[axis] >= initial.viewBox[axis] * 0.8
        || next.viewBox[1 - axis] > (axis ? 1100 : 680)) continue;
    const nextScore = [crossings.length, direct ? blocked : fan ? spans.length : next.viewBox[axis],
      bends, spans.length, imbalance.score];
    if ((score && !betterScore(nextScore, score)) || !isValid()) continue;
    best = next;
    bestRouter = candidate;
    score = nextScore;
  }
  if (bestRouter) {
    router = bestRouter;
    for (const [id, box] of best.boxes) components.set(id, box);
  }
  return best;
}

function reduceDenseCrossings(initial, beforeDirect, initialRouter = router) {
  let current = { next: initial, candidate: initialRouter };
  if (!automaticComposition || !whollyInferred || initial.titles.boundaries.length > 2
      || components.size < 5 || components.size > 16 || connections.length < 6 || connections.length > 24
      || connections.some(conn => conn.fromSide !== undefined || conn.toSide !== undefined)) return current;
  const pairs = measuredCrossingPairs(initial.routes);
  if (!pairs.length) return current;
  const baseline = measureCandidateScene(initial, pairs);
  const checkLabels = candidateLabelCheck(initial);
  const oldBlocked = beforeDirect && blockedLinkCount(initial);
  const straightened = beforeDirect && new Set(initial.routes.filter((route, i) =>
    baseline.spans.spans[i].bends === 0 && beforeDirect.routes[i].points.length > 2).map(route => route.relation));
  const scoreFor = ({ crossings, avoidable, bends, spans }) => [crossings.length, avoidable, bends, spans.length];
  current = { ...current, ...baseline };
  for (let step = 0; step < 3 && current.crossings.length; step++) {
    let best;
    let score = scoreFor(current);
    const maxWidth = Math.max(initial.viewBox[0], current.next.viewBox[0]);
    const proposals = denseTerminalCandidates(current.next, current.crossings, {
      limit: 16, refine: current.avoidable ? current.terminal : undefined,
    });
    for (const { boxes: moved, terminal, compactedSink } of proposals) {
      if (compactedSink && score[0] === 0) break;
      const proposal = evaluateCandidateScene(refitBoxesToMargin(moved, boundsFor(moved)), {
        routingOptions: { separateRuns: true }, checkDesktopFloor: true, checkEnclosures: true, checkLabels,
      });
      const { next, crossings, budget, spans, avoidable, area, imbalance, isValid } = proposal;
      const nextScore = scoreFor(proposal);
      const widthLimit = maxWidth + (!crossings.length && area <= baseline.area * 1.08 ? 48 : 0);
      if ((step === 0 && crossings.length >= pairs.length)
          || (compactedSink && crossings.length >= current.crossings.length) || next.viewBox[0] > widthLimit
          || avoidable > baseline.avoidable || exceedsRouteBudget(baseline.budget, budget)
          || imbalance.sunkenRoots > current.imbalance.sunkenRoots || !betterScore(nextScore, score)
          || (straightened && (blockedLinkCount(next) > oldBlocked
            || next.routes.some((route, i) => straightened.has(route.relation) && spans.spans[i].bends)))
          || !isValid()) continue;
      best = { ...proposal, terminal };
      score = nextScore;
    }
    if (!best) break;
    current = best;
  }
  return current;
}

function balanceFanOutPlacement(initial, ordinary) {
  if (!automaticComposition || !whollyInferred || initial.titles.boundaries.length || components.size > 24
      || connections.some(conn => conn.fromSide !== undefined || conn.toSide !== undefined)) return ordinary;
  const pairs = measuredCrossingPairs(initial.routes);
  const initialImbalance = compositionImbalance(initial);
  if (!initialImbalance.score && pairs.length < 2) return ordinary;
  const positions = automaticComponentPositions(placementInput, undefined, { balanceFanOut: true });
  const boxes = new Map(sizedComponents.map(([component, size]) =>
    [component.id, measureComponent(component, size, positions)]));
  if ([...boxes].every(([id, box]) => box.x === initial.boxes.get(id).x && box.y === initial.boxes.get(id).y)) {
    return ordinary;
  }
  const checkLabels = candidateLabelCheck(ordinary.next);
  const proposal = evaluateCandidateScene(boxes, {
    routingOptions: { separateRuns: true }, checkDesktopFloor: true, checkLabels,
  });
  if (!proposal.isValid()) return ordinary;
  const reduced = proposal.crossings.length ? reduceDenseCrossings(proposal.next, undefined, proposal.candidate) : proposal;
  const balanced = reduced.next === proposal.next ? proposal : reduced;
  const { imbalance, budget, avoidable } = balanced;
  const improvesBalance = (initialImbalance.sunkenRoots > 0 && !imbalance.sunkenRoots)
    || (initialImbalance.leadingVoid > 0 && !imbalance.leadingVoid);
  const widthLimit = improvesBalance ? Math.max(initial.viewBox[0], 1060) : initial.viewBox[0];
  const ordinaryMetrics = ordinary.crossings ? ordinary : measureCandidateScene(ordinary.next);
  const scoreFor = ({ crossings, imbalance, avoidable, bends, spans }) =>
    [crossings.length, imbalance.sunkenRoots, Math.round(imbalance.leadingVoid * 1000), avoidable, bends, spans.length];
  if (balanced.next.viewBox[0] > widthLimit || avoidable > ordinaryMetrics.avoidable
      || exceedsRouteBudget(ordinaryMetrics.budget, budget)
      || !betterScore(scoreFor(balanced), scoreFor(ordinaryMetrics))) return ordinary;
  return balanced;
}

const compactedComposition = compactJunctions(reserveFacingLabelSpace(improveFrameLanes(
  alignNearlyFacingCards(simplifyFinishedComposition(placedComposition)),
)));
const structuredReflow = reflowSmallDiagrams(compactedComposition);
const directReflow = reflowSmallDiagrams(structuredReflow, { direct: true });
// Keep a coordinated column or fold intact. A direct shortcut only protects
// the links it straightened and the number of remaining blocked links.
const { next: composition, candidate: compositionRouter } = structuredReflow === compactedComposition
  ? balanceFanOutPlacement(directReflow,
    reduceDenseCrossings(directReflow, directReflow !== structuredReflow ? structuredReflow : undefined))
  : { next: directReflow, candidate: router };
router = compositionRouter;
for (const [id, box] of composition.boxes) components.set(id, box);
const {
  titles: { boundaries }, labels: connectionLabels, viewBox,
} = composition;
const labelBoxes = new Map(connectionLabels.map(rect => [rect.relation, rect]));
const legendY = () => viewBox[1] - 16;

function componentContext(component) {
  const scopes = boundaries
    .filter((boundary) => asArray(boundary.wraps).includes(component.id))
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))
    .map((boundary) => boundary.label);
  return scopes.length ? scopes.join(' › ') : i18nText(arch.meta.locale, 'node.context.architecture');
}

// ---- Validation: mechanical correctness, never layout taste -----------------
function componentDiagnosticBox(component) {
  return {
    ...componentBox(component),
    x: component.x,
    y: component.y,
    ...(Array.isArray(component.pos) ? { pos: [...component.pos] } : {}),
  };
}

function validateArchitecture({
  boxes: components, labels: connectionLabels, titles: resolvedBoundaryTitles, viewBox,
} = composition, candidate = router) {
  const { boundaries } = resolvedBoundaryTitles;
  const { connectionEndpointSide } = candidate;
  const pathFor = conn => canRoute(conn) ? candidate.pathFor(conn) : { points: [] };
  const compositionFrames = boundaries.map((boundary, index) => ({
    ...boundary,
    id: boundary.id || index,
    kind: boundary.kind || 'boundary',
    radius: boundary.kind === 'security-group' ? 8 : 12,
  }));
  const problems = [];
  const diagnostics = [];
  const quality = process.env.ARCHIFY_QUALITY_PROFILE || arch.meta?.quality_profile;
  if (resolvedBoundaryTitles.readabilityProblem) {
    problems.push(resolvedBoundaryTitles.readabilityProblem);
  }
  if (components.size !== asArray(arch.components).length) problems.push('Component ids must be unique.');
  if (grid) {
    validateGridPlacement(arch, grid, problems);
  }

  for (const c of components.values()) {
    if (!isFinitePoint(c.x, c.y, c.width, c.height)) {
      const message = !grid && !automaticPositions && (!Array.isArray(c.pos) || c.pos.length !== 2)
        ? `Component "${c.id}" must include pos [x, y] when layout.mode is omitted (free placement).`
        : `Component "${c.id}" has non-finite pos/size — pos and size must be [number, number].`;
      diagnostics.push({
        code: 'architecture/non-finite-component-geometry', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: { pos: c.pos ?? null, size: [c.width, c.height] },
        supportedFixes: [`replace component "${c.id}" pos and size with finite [number, number] values`],
      });
      problems.push(message);
      continue;
    }
    if (c.width <= 0 || c.height <= 0) {
      const message = `Component "${c.id}" has invalid size ${c.width}x${c.height} — width and height must be greater than 0.`;
      diagnostics.push({
        code: 'architecture/invalid-component-size', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: { width: c.width, height: c.height },
        supportedFixes: [`set component "${c.id}" width and height to values greater than 0`],
      });
      problems.push(message);
      continue;
    }
    if (c.x < 0 || c.y < 0 || c.x + c.width > viewBox[0] || c.y + c.height > viewBox[1]) {
      const message = `Component "${c.id}" falls outside the viewBox ${viewBox[0]}x${viewBox[1]} — adjust pos/size or set a larger meta.viewBox.`;
      const overflow = {
        left: Math.max(0, -c.x),
        top: Math.max(0, -c.y),
        right: Math.max(0, c.x + c.width - viewBox[0]),
        bottom: Math.max(0, c.y + c.height - viewBox[1]),
      };
      const widerThanCanvas = overflow.left > 0 && overflow.right > 0;
      const tallerThanCanvas = overflow.top > 0 && overflow.bottom > 0;
      const supportedFixes = [];
      // Move by exactly the overflow: it lands the edge flush (x + (-x) is exact
      // in IEEE 754), while a rounded-up move pushes the opposite edge past a
      // tight canvas and a rounded-down one leaves the overflow in place. When
      // the component is larger than the canvas, the move must shrink it too.
      if (overflow.left > 0) {
        const shrink = Math.max(0, c.width - viewBox[0]);
        supportedFixes.push(shrink > 0
          ? `move component "${c.id}" right by ${overflow.left}px and shrink its width by at least ${shrink}px`
          : `move component "${c.id}" right by ${overflow.left}px`);
      }
      if (overflow.top > 0) {
        const shrink = Math.max(0, c.height - viewBox[1]);
        supportedFixes.push(shrink > 0
          ? `move component "${c.id}" down by ${overflow.top}px and shrink its height by at least ${shrink}px`
          : `move component "${c.id}" down by ${overflow.top}px`);
      }
      if ((overflow.right > 0 && !widerThanCanvas) || (overflow.bottom > 0 && !tallerThanCanvas)) {
        const coveredWidth = overflow.right > 0 && !widerThanCanvas ? Math.ceil(c.x + c.width) : viewBox[0];
        const coveredHeight = overflow.bottom > 0 && !tallerThanCanvas ? Math.ceil(c.y + c.height) : viewBox[1];
        supportedFixes.push(`set meta.viewBox to at least [${Math.max(viewBox[0], coveredWidth)}, ${Math.max(viewBox[1], coveredHeight)}]`);
      }
      diagnostics.push({
        code: 'layout/component-out-of-bounds', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: { bounds: componentDiagnosticBox(c), viewBox: [...viewBox], overflow },
        supportedFixes,
      });
      problems.push(message);
    }
    const inferredSize = auto && !c.size;
    const estLabelW = inferredSize ? minimumNodeTextWidth(c.label, 8) : textUnits(c.label) * 6.6;
    const labelAvailableW = inferredSize ? availableNodeTextWidth(brandLabelFitWidth(c, c.width)) : c.width + 8;
    if (estLabelW > labelAvailableW) {
      const minimumExplicitWidth = Math.ceil(Math.max(
        textUnits(c.label) * 6.6 - 8,
        minimumNodeTextWidth(c.label, 8) + (c.width - brandLabelFitWidth(c, c.width)) + nodeTextFit.horizontalPadding,
      ));
      const message = inferredSize
        ? `Label "${c.label}" needs ~${Math.ceil(estLabelW)}px at the 8px legible minimum, but component "${c.id}" provides ${labelAvailableW}px — shorten the label or provide a wider size.`
        : `Label "${c.label}" (~${Math.round(estLabelW)}px) is wider than component "${c.id}" (${c.width}px) — shorten the label or widen size.`;
      diagnostics.push({
        code: 'architecture/component-label-overflow', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: inferredSize
          ? { text: c.label, minimumFontPx: 8, requiredWidthPx: Math.ceil(estLabelW), availableWidthPx: labelAvailableW }
          : { text: c.label, estimatedWidthPx: Math.round(estLabelW), availableWidthPx: c.width },
        supportedFixes: [
          `shorten component "${c.id}" label "${c.label}" while preserving its meaning`,
          inferredSize
            ? `or set component "${c.id}" size to [${minimumExplicitWidth}, ${c.height}]`
            : `or widen component "${c.id}" to at least ${Math.ceil(estLabelW - 8)}px`,
        ],
      });
      problems.push(message);
    }
    const brandRailProblem = brandTopRailProblem(c, c.width, 8, 'Component');
    if (brandRailProblem) problems.push(brandRailProblem);
    if (quality === 'showcase' && !componentTextRows(c, resolveNodeDrilldowns(c)).fits) {
      const minimumHeight = Math.max(Math.ceil(c.height + 1), 60);
      const message = `Component "${c.id}" cannot fit its text legibly in its ${c.width} × ${c.height}px card — increase its height to ${minimumHeight}px and leave room around its routes.`;
      problems.push(message);
      diagnostics.push({
        code: 'architecture/component-text-height', severity: 'error', message,
        subject: { diagramType: 'architecture', nodeId: c.id },
        evidence: { bounds: componentDiagnosticBox(c), recommendedHeightPx: minimumHeight },
        supportedFixes: [`set component "${c.id}" size to [${c.width}, ${minimumHeight}]`],
      });
    }
    // sublabel and tag render as single unwrapped <text> elements; shrink-to-fit
    // handles the ordinary case, this rejects what it cannot rescue.
    const availableTextW = availableNodeTextWidth(c.width);
    for (const [field, value, minimum] of [
      ['Sublabel', c.sublabel, componentTextFit.sublabelMinimum],
      ['Tag', c.tag, componentTextFit.tagMinimum],
    ]) {
      if (!value) continue;
      const minimumW = minimumNodeTextWidth(value, minimum);
      if (minimumW > availableTextW) {
        const fieldKey = field.toLowerCase();
        const message = `${field} "${value}" needs ~${Math.ceil(minimumW)}px at the ${minimum}px legible minimum, but component "${c.id}" provides ${availableTextW}px — shorten the ${fieldKey} or widen size.`;
        diagnostics.push({
          code: `architecture/component-${fieldKey}-overflow`, severity: 'error', message,
          subject: { diagramType: 'architecture', nodeId: c.id },
          evidence: { text: value, minimumFontPx: minimum, requiredWidthPx: Math.ceil(minimumW), availableWidthPx: availableTextW },
          supportedFixes: [
            `shorten component "${c.id}" ${fieldKey} "${value}" while preserving its meaning`,
            `or widen component "${c.id}" so the ${fieldKey} keeps at least ${Math.ceil(minimumW)}px of text width at the ${minimum}px legible minimum`,
          ],
        });
        problems.push(message);
      }
    }
  }

  // Component overlap — the highest-traffic hand-placement failure mode.
  const list = [...components.values()];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (rectsOverlap(list[i], list[j], 8)) {
        const separation = componentSeparationOptions(list[i], list[j], 8);
        const message = `Components "${list[i].id}" and "${list[j].id}" are less than 8px apart — move one or shrink its size.\n${suggestComponentSeparation(list[i], list[j], 8)}`;
        diagnostics.push({
          code: 'layout/component-overlap', severity: 'error', message,
          subject: { diagramType: 'architecture', nodeId: list[i].id },
          evidence: { otherId: list[j].id, minimumGapPx: 8, boxes: [componentDiagnosticBox(list[i]), componentDiagnosticBox(list[j])] },
          supportedFixes: [
            `move component "${list[j].id}" pos to [${separation[0].pos[0]}, ${separation[0].pos[1]}] (${separation[0].relation})`,
            `or move component "${list[j].id}" pos to [${separation[1].pos[0]}, ${separation[1].pos[1]}] (${separation[1].relation})`,
            `or shrink "${list[i].id}" or "${list[j].id}" while keeping every label and sublabel readable`,
          ],
        });
        problems.push(message);
      }
    }
  }

  // Boundaries: every wrapped id must exist; the computed box must stay in view.
  for (const boundary of asArray(arch.boundaries)) {
    for (const id of asArray(boundary.wraps)) {
      if (!components.has(id)) problems.push(`Boundary "${boundary.label}" wraps unknown component "${id}".`);
    }
  }
  const viewBoxRect = { x: 0, y: 0, width: viewBox[0], height: viewBox[1] };
  for (const boundary of boundaries) {
    if (!enforcesBoundaryTitleComposition) continue;
    if (boundary.title.minimumWidth > boundary.title.availableWidth) {
      problems.push(
        `Boundary label "${boundary.label}" needs ~${Math.ceil(boundary.title.minimumWidth)}px to fit at the `
        + `${Number(boundary.title.minimumFontSize.toFixed(2))}px desktop-readable source minimum, but its frame provides ${Math.floor(boundary.title.availableWidth)}px — `
        + 'shorten the boundary label, increase pad, or widen the wrapped component layout.',
      );
    }
    if (!rectContains(boundary, boundary.title)) {
      problems.push(
        `Boundary label "${boundary.label}" extends outside its final frame — shorten the label or increase boundary pad.`,
      );
    }
    if (!rectContains(viewBoxRect, boundary.title)) {
      problems.push(
        `Boundary label "${boundary.label}" extends outside the viewBox — move wrapped components away from the canvas edge, shorten the label, or increase the viewBox.`,
      );
    }
    for (const component of components.values()) {
      if (!rectsOverlap(boundary.title, component)) continue;
      problems.push(
        `Boundary label "${boundary.label}" overlaps component "${component.id}" — move the component, increase boundary title space, or shorten the label.`,
      );
    }
  }
  for (let leftIndex = 0; leftIndex < boundaries.length; leftIndex += 1) {
    const left = boundaries[leftIndex];
    const leftMembers = new Set(asArray(left.wraps));
    for (let rightIndex = leftIndex + 1; rightIndex < boundaries.length; rightIndex += 1) {
      const right = boundaries[rightIndex];
      if (enforcesBoundaryTitleComposition && rectsOverlap(left.title, right.title)) {
        problems.push(
          `Boundary labels "${left.label}" and "${right.label}" overlap — shorten a label or increase boundary title space.`,
        );
      }
      // Ordinary architecture boundaries are sets, not an implied ownership
      // tree: orthogonal scopes such as runtime and compliance may share some
      // components while each contains others. The opt-in deployment profile
      // does promise hierarchical region/private-scope membership, so only it
      // receives the stricter membership-to-frame containment contract.
      if (!requiresNestedBoundaryMembership) continue;
      const rightMembers = new Set(asArray(right.wraps));
      const shared = [...leftMembers].filter((id) => rightMembers.has(id));
      const leftNested = [...leftMembers].every((id) => rightMembers.has(id));
      const rightNested = [...rightMembers].every((id) => leftMembers.has(id));
      if (shared.length && !leftNested && !rightNested) {
        const leftOnly = [...leftMembers].filter((id) => !rightMembers.has(id));
        const rightOnly = [...rightMembers].filter((id) => !leftMembers.has(id));
        problems.push(
          `Boundary "${left.label}" crosses boundary "${right.label}" because their memberships partially overlap `
          + `(shared: ${shared.map((id) => `"${id}"`).join(', ')}; `
          + `only in "${left.label}": ${leftOnly.map((id) => `"${id}"`).join(', ')}; `
          + `only in "${right.label}": ${rightOnly.map((id) => `"${id}"`).join(', ')}) — `
          + 'keep one boundary fully nested by removing outside members, or split the boundary.',
        );
        continue;
      }

      if (!rectsOverlap(left, right)) continue;
      const leftContainsRight = rectContains(left, right);
      const rightContainsLeft = rectContains(right, left);
      if (!leftContainsRight && !rightContainsLeft) {
        problems.push(
          `Boundary "${left.label}" and boundary "${right.label}" final frames partially overlap — `
          + 'adjust wraps, pad, or component positions so the frames are disjoint or one fully contains the other.',
        );
        continue;
      }

      if (!shared.length) {
        problems.push(
          `Boundary "${left.label}" and boundary "${right.label}" final frames overlap even though their memberships are disjoint — `
          + 'adjust pad or component positions so the frames are disjoint, or make wraps express the intended nesting.',
        );
        continue;
      }

      const containmentMatchesMembership = (leftNested && rightContainsLeft)
        || (rightNested && leftContainsRight);
      if (!containmentMatchesMembership) {
        problems.push(
          `Boundary "${left.label}" and boundary "${right.label}" final frame containment contradicts their wraps membership — `
          + 'reduce the inner boundary pad, move its components, or correct wraps so geometry and nesting agree.',
        );
      }
    }
  }
  for (const b of boundaries) {
    if (b.x < 0 || b.y < 0 || b.x + b.width > viewBox[0] || b.y + b.height > viewBox[1]) {
      const overflow = {
        left: Math.max(0, -b.x),
        top: Math.max(0, -b.y),
        right: Math.max(0, b.x + b.width - viewBox[0]),
        bottom: Math.max(0, b.y + b.height - viewBox[1]),
      };
      const sides = Object.entries(overflow).filter(([, pixels]) => pixels > 0)
        .map(([side, pixels]) => `${side} by ${Math.ceil(pixels)}px`).join(', ');
      const supportedFixes = [];
      if (overflow.left || overflow.top) {
        supportedFixes.push(`move the wrapped components right by at least ${Math.ceil(overflow.left)}px and down by at least ${Math.ceil(overflow.top)}px, then revalidate connected routes and the opposite canvas sides; enlarging meta.viewBox cannot fix left/top overflow`);
      }
      if (overflow.right || overflow.bottom) {
        supportedFixes.push(`increase meta.viewBox to at least [${Math.ceil(Math.max(viewBox[0], b.x + b.width))}, ${Math.ceil(Math.max(viewBox[1], b.y + b.height))}] for right/bottom overflow, or move the wrapped components inward; revalidate desktop readability`);
      }
      const message = `Boundary "${b.label}" extends outside the viewBox (${sides}) — preserve wraps membership and repair the measured canvas side.`;
      diagnostics.push({
        code: 'layout/boundary-out-of-bounds',
        severity: 'error',
        message,
        subject: { diagramType: 'architecture', boundary: { kind: b.kind, label: b.label, wraps: b.wraps } },
        evidence: {
          bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
          viewBox: [...viewBox],
          overflow,
          members: asArray(b.wraps).map((id) => components.get(id)).filter(Boolean).map(componentBox),
        },
        supportedFixes,
      });
      problems.push(message);
    }
  }

  // A boundary frame is drawn as the padded box around its members, so a
  // component that is not in `wraps` but sits wholly inside that box reads as
  // a member. Report it instead of letting the picture claim false ownership.
  // A box the frame border visibly cuts through does not claim membership,
  // and earlier valid inputs depend on that, so only full enclosure fails.
  // This new composition gate applies to showcase; standard keeps its existing
  // acceptance contract while authors can opt into the stricter check.
  if (arch.meta?.quality_profile === 'showcase') {
    for (const { frame: b, box: component } of frameEnclosures(components, boundaries)) {
      const message = `Component "${component.id}" is not wrapped by boundary "${b.label}" but sits inside its frame — `
        + 'move it outside the frame, place the wrapped members in one compact axis-aligned cluster (no empty bay for a non-member), or add it to wraps only when it truly belongs there.';
      problems.push(message);
      diagnostics.push({
        code: 'layout/boundary-encloses-non-member',
        severity: 'error',
        message,
        subject: { diagramType: 'architecture', boundary: { kind: b.kind, label: b.label, wraps: b.wraps }, component: component.id },
        evidence: {
          bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
          component: componentBox(component),
        },
        supportedFixes: [
          `move "${component.id}" outside the boundary frame`,
          'reposition the wrapped members into one compact axis-aligned cluster (no empty bay) that leaves non-members outside',
        ],
      });
    }
  }

  const connectionList = asArray(arch.connections);
  const knownComponentIds = [...components.keys()].sort();
  for (const conn of connectionList) {
    const connIndex = connectionList.indexOf(conn);
    for (const [field, endpoint] of [['from', 'source'], ['to', 'target']]) {
      if (components.has(conn[field])) continue;
      const message = `Connection "${conn.label || conn[field]}" references unknown ${endpoint} "${conn[field]}".`;
      const otherId = conn[field === 'from' ? 'to' : 'from'];
      const neighbors = new Set();
      for (const edge of connectionList) {
        if (edge === conn) continue;
        if (edge.from === otherId) neighbors.add(edge.to);
        if (edge.to === otherId) neighbors.add(edge.from);
      }
      const candidates = knownComponentIds
        .filter((id) => id !== otherId)
        .sort((a, b) => (neighbors.has(b) - neighbors.has(a)) || a.localeCompare(b));
      diagnostics.push({
        code: 'architecture/unknown-endpoint', severity: 'error', message,
        subject: {
          diagramType: 'architecture',
          connection: conn.id ?? null,
          path: `/connections/${connIndex}/${field}`,
          from: conn.from,
          to: conn.to,
        },
        evidence: { endpoint, unknownNodeId: conn[field], availableNodeIds: knownComponentIds },
        supportedFixes: candidates.slice(0, 3).map((id) => `set /connections/${connIndex}/${field} to verified node id "${id}"`),
      });
      problems.push(message);
      problems.push(`Connection "${conn.label || conn[field]}" endpoint "${conn[field]}" does not name a declared component.`);
    }
    if (canRoute(conn)) {
      const routed = pathFor(conn);
      const outsidePoints = routed.points.filter(([x, y]) => x < 0 || y < 0 || x > viewBox[0] || y > viewBox[1]);
      if (arch.meta?.quality_profile === 'showcase' && outsidePoints.length) {
        const message = `Connection "${conn.id || `${conn.from}->${conn.to}`}" extends outside the viewBox — move the measured outside route points inward or enlarge an authored viewBox for right/bottom overflow.`;
        diagnostics.push({
          code: 'layout/route-out-of-bounds', severity: 'error', message,
          subject: { diagramType: 'architecture', collection: 'connections', index: asArray(arch.connections).indexOf(conn), ...(conn.id ? { id: conn.id } : {}), from: conn.from, to: conn.to },
          evidence: { viewBox: [...viewBox], outsidePoints, points: routed.points },
          supportedFixes: ['move negative route coordinates inside the canvas; for right/bottom overflow, enlarge meta.viewBox or reroute inward; preserve endpoints, direction and labels, then revalidate'],
        });
        problems.push(message);
      }
      const [start, end] = [routed.points[0], routed.points[routed.points.length - 1]];
      const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (distance < 24 && conn.from === conn.to) {
        // "Move the components apart" cannot be executed for a self-loop; the
        // ports sit on one component and the sides decide how far apart.
        const message = `Self-loop "${conn.id || conn.label || conn.from}" on component "${conn.from}" has its two ports only ${Math.round(distance)}px apart (minimum 24px) — remove fromSide/toSide so the renderer can choose the loop's sides, or set fromSide and toSide to different sides.`;
        diagnostics.push({
          code: 'layout/self-loop-ports', severity: 'error', message,
          subject: { diagramType: 'architecture', collection: 'connections', index: asArray(arch.connections).indexOf(conn), ...(conn.id ? { id: conn.id } : {}), from: conn.from, to: conn.to },
          evidence: { distancePx: Math.round(distance), minimumPx: 24, fromSide: connectionEndpointSide(conn, 'source'), toSide: connectionEndpointSide(conn, 'target'), points: routed.points },
          supportedFixes: ['remove fromSide/toSide from the self-loop', 'set fromSide and toSide to different sides of the component'],
        });
        problems.push(message);
      } else if (distance < 24) {
        problems.push(`Connection "${conn.label || `${conn.from}->${conn.to}`}" is too short (${Math.round(distance)}px; minimum 24px) — place its components farther apart.`);
      }
    }
  }

  problems.push(...cleanEndpointSideProblems({
    relations: arch.connections,
    endpointIds: routedEndpointIds,
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    fromSideFor: (conn) => connectionEndpointSide(conn, 'source'),
    toSideFor: (conn) => connectionEndpointSide(conn, 'target'),
    routeHint: 'keep automatic routing so the renderer can use a side-aware bridge, or set truthful fromSide/toSide with perpendicular via segments',
  }));
  problems.push(...cleanFlowProblems({
    relations: arch.connections,
    obstacles: components.values(),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    obstacleKind: 'component',
    routeHint: 'adjust fromSide/toSide, set route/via, or move the component'
  }));
  problems.push(...cleanCrossingProblems({
    relations: arch.connections,
    endpointIds: routedEndpointIds,
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
    includeSharedEndpoints: () => true,
    visiblePathFor: ({ points }) => prepareCrossingPath(roundedPathSegments(points, 8)),
    visibleCrossingFor: (left, right) => visibleCrossings(left, right, 1)[0],
    // Automatic architecture routes render with an opaque crossover halo.
    // That makes a proper X visually unambiguous while explicit authored
    // crossings remain a blocking composition error.
    crossingResolved: (left, right) => (
      hasAutomaticRouteGeometry(left) && hasAutomaticRouteGeometry(right)
    ),
    routeHint: 'adjust route/via or fromSide/toSide so the connections use separate corridors'
  }));
  problems.push(...cleanAmbiguousCorridorProblems({
    relations: arch.connections,
    endpointIds: routedEndpointIds,
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
    includeSharedEndpoints: (left, right) => hasAutomaticRouteGeometry(left) && !left.labelAt
      && hasAutomaticRouteGeometry(right) && !right.labelAt,
    routeHint: 'adjust route/via or fromSide/toSide so distinct connections do not visually merge'
  }));
  if ((process.env.ARCHIFY_QUALITY_PROFILE || arch.meta?.quality_profile) === 'showcase') {
    const collisions = collectArrowheadCollisions({
      routedRelations: asArray(arch.connections)
        .filter((conn) => components.has(conn.from) && components.has(conn.to) && hasAutomaticRouteGeometry(conn) && !conn.labelAt)
        .map((relation) => ({ relation, points: pathFor(relation).points })),
    });
    for (const hit of collisions) {
      const left = hit.left.relation;
      const right = hit.right.relation;
      const message = `[composition/arrowhead-collision] automatic connections "${left.id || left.from}" and "${right.id || right.from}" into "${left.to}" have arrowheads ${hit.distance}px apart (minimum ${hit.minimum}px) — enlarge or reposition the destination, or choose separate toSide ports.`;
      problems.push(message);
      diagnostics.push({
        code: 'composition/arrowhead-collision', severity: 'error', message,
        subject: { diagramType: 'architecture', collection: 'connections', id: left.id, from: left.from, to: left.to },
        evidence: { otherId: right.id, distancePx: hit.distance, minimumPx: hit.minimum, endpoints: [hit.left.tip, hit.right.tip] },
        supportedFixes: ['enlarge or reposition the destination', 'choose separate toSide ports'],
      });
    }
  }
  problems.push(...cleanBorderRunProblems({
    relations: arch.connections,
    endpointIds: routedEndpointIds,
    frames: compositionFrames,
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
    routeHint: 'adjust route/via or fromSide/toSide so the connection crosses the boundary perpendicularly instead of following its border'
  }));
  problems.push(...cleanRouteRhythmProblems({
    relations: arch.connections,
    endpointIds: routedEndpointIds,
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
    routeHint: 'move route/via points into a wider corridor or move the component so every turn has room to read'
  }));
  problems.push(...cleanRouteDetourProblems({
    relations: arch.connections,
    obstacles: components.values(),
    contentRects: [...components.values(), ...boundaries],
    endpointIds: routedEndpointIds,
    pathFor,
    fromSideFor: (conn) => connectionEndpointSide(conn, 'source'),
    toSideFor: (conn) => connectionEndpointSide(conn, 'target'),
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
  }));
  // Connection labels must not land on top of components.
  const labelRects = connectionLabels;
  for (const rect of labelRects) {
    const blockedComponents = [...components.values()].filter(c => rectsOverlap(rect, c, -2));
    const labelPinned = ['labelAt', 'labelDx', 'labelDy', 'labelSegment'].some(key => rect.relation[key] !== undefined);
    const points = pathFor(rect.relation).points;
    const shortHorizontalGap = points.length === 2 && Math.abs(points[0][1] - points[1][1]) < 0.0001
      ? Math.abs(points[1][0] - points[0][0]) : null;
    const requiredGap = Math.ceil(rect.width + 16);
    if (arch.meta?.quality_profile === 'showcase' && !labelPinned && blockedComponents.length
        && shortHorizontalGap != null && shortHorizontalGap < requiredGap) {
      const message = `Label "${rect.label}" has only ${Math.round(shortHorizontalGap)}px between "${rect.relation.from}" and "${rect.relation.to}"; it needs at least ${requiredGap}px to stay beside its route — increase that clear gap or place the connected nodes on another readable row, preserving the label.`;
      problems.push(message);
      diagnostics.push({
        code: 'composition/label-gap', severity: 'error', message,
        subject: { diagramType: 'architecture', collection: 'connections', id: rect.relation.id, from: rect.relation.from, to: rect.relation.to },
        evidence: { clearGapPx: shortHorizontalGap, minimumGapPx: requiredGap, labelWidthPx: rect.width, obstacles: blockedComponents.map(c => c.id) },
        supportedFixes: [`increase the clear gap between the connected nodes to at least ${requiredGap}px`, 'reposition the connected nodes together while preserving the full relationship label'],
      });
    } else {
      for (const c of blockedComponents) {
        problems.push(`Label "${rect.label}" overlaps component "${c.id}" — adjust labelDx/labelDy/labelSegment or set labelAt.\n${suggestLabelObstacleFix(rect, rect.lx, rect.ly, c, 'component', viewBox, components.values())}`);
      }
    }
    if (enforcesBoundaryTitleComposition) {
      for (const boundary of boundaries) {
        if (!rectsOverlap(boundary.title, rect)) continue;
        problems.push(
          `Boundary label "${boundary.label}" overlaps connection label "${rect.label}" — move the boundary title rail by adjusting wrapped component positions, or move the connection label with labelAt/labelDx/labelDy/labelSegment.`,
        );
      }
    }
  }
  problems.push(...cleanLabelRouteClearanceProblems({
    relations: arch.connections,
    labels: labelRects,
    endpointIds: routedEndpointIds,
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
  }));
  // See collectLabelCanvasOverflow in shared/geometry.mjs. An auto canvas now
  // covers these rects, so this reports authored viewBoxes and the origin side,
  // which growth cannot reach.
  problems.push(...cleanLabelCanvasContainmentProblems({
    labels: labelRects,
    viewBox,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
  }));

  if (problems.length) {
    throwDiagnosticProblems('Architecture layout validation failed', problems, {
      subject: { diagramType: 'architecture' },
      diagnostics,
    });
  }
}

function buildLayoutReport() {
  const labels = connectionLabels.map((rect) => ({
    text: rect.label,
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: 14,
    labelAt: [Math.round(rect.lx), Math.round(rect.ly)],
  }));
  return {
    ok: true,
    diagram_type: 'architecture',
    layout: grid ?? { mode: automaticPositions ? 'auto' : 'free' },
    ...(automaticPositions ? { routedPlacementCandidates: placementRouteLimit - remainingPlacementRoutes + routedFrameLaneCandidates } : {}),
    viewBox,
    components: [...components.values()].map(componentBox),
    boundaries: boundaries.map(boundaryBox),
    connections: asArray(arch.connections)
      .filter((conn) => components.has(conn.from) && components.has(conn.to))
      .map((conn) => {
        const routed = pathFor(conn);
        const box = connectionLabelBox(conn);
        return connectionPath(conn, routed, box ? [box.lx, box.ly] : null);
      }),
    labels,
  };
}

// ---- Rendering ---------------------------------------------------------------
function renderBoundaryFrame(b, index) {
  const cls = b.kind === 'security-group' ? 'c-security-group' : 'c-region';
  const rx = b.kind === 'security-group' ? 8 : 12;
  return `        <rect data-graph-role="structural-frame" data-composition-frame-kind="${esc(b.kind || 'boundary')}" data-composition-frame-id="${index}" data-composition-frame-label="${esc(b.label)}"${changeFrameAttrs(changeReview, b)} x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${rx}" class="${cls}" stroke-width="1"/>`;
}

function renderBoundaryLabel(b, index) {
  const labelCls = b.kind === 'security-group' ? 't-security' : 't-cloud';
  const rx = b.kind === 'security-group' ? 8 : 12;
  const badge = renderChangeBadge(b, nodeChangeBadgePos(b, { rx }));
  return `        <g data-graph-role="structural-frame-label" data-composition-frame-id="${index}" data-composition-frame-kind="${esc(b.kind || 'boundary')}" data-composition-frame-label="${esc(b.label)}"${changeFrameAttrs(changeReview, b)}>
          <rect data-graph-role="structural-frame-label-mask" x="${b.title.x}" y="${b.title.y}" width="${b.title.width}" height="${b.title.height}" rx="3" class="c-mask"/>
          <text data-boundary-label="" x="${b.title.x + 4}" y="${b.title.y + b.title.baselineOffset}" class="${labelCls}" font-size="${b.title.fontSize}" font-weight="600">${esc(b.label)}</text>${badge ? `\n          ${badge}` : ''}
        </g>`;
}

function connectionMarker(conn, index, definitions) {
  const [, fallback] = arrowClassMap[conn.variant || 'default'] || arrowClassMap.default;
  const marker = changeMarkerFor(conn, fallback);
  const stroke = routeStrokeWidth(conn);
  const scale = routeMarkerScale(pathFor(conn).points, stroke);
  if (scale === stroke) return marker;
  const id = `arrowhead-bounded-${index}`;
  const tone = marker === 'arrowhead' ? 'default' : marker.slice('arrowhead-'.length);
  definitions.push(`
          <marker id="${id}" markerUnits="userSpaceOnUse" viewBox="0 0 10 7" markerWidth="${10 * scale}" markerHeight="${7 * scale}" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-${tone}" />
          </marker>`);
  return id;
}

function renderConnectionPath(conn, index, marker) {
  const [cls] = arrowClassMap[conn.variant || 'default'] || arrowClassMap.default;
  const routed = pathFor(conn);
  const strokeWidth = routeStrokeWidth(conn);
  const automaticRoute = hasAutomaticRouteGeometry(conn);
  const underlay = automaticRoute
    ? `          <path data-graph-role="automatic-crossover-underlay" d="${routed.d}" fill="none" stroke="var(--mask)" stroke-width="${strokeWidth + 4}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>\n`
    : '';
  const crossover = automaticRoute
    ? ` data-composition-crossover="halo"${conn.labelAt ? '' : ' data-composition-independent="true"'}` : '';
  const edge = `        <path ${focusEdgeAttrs(conn.from, conn.to, conn.label, index, conn.id)}${changeEdgeAttrs(changeReview, conn)} data-composition-points="${routePointsValue(routed.points)}"${crossover}${authoredStraightRouteAttrs(conn, routed.points)} d="${routed.d}" class="${cls}"${animateAttr(arch.meta, 'edge', index)} stroke-width="${strokeWidth}" marker-end="url(#${marker})"/>`;
  if (!automaticRoute) return edge;
  // The wrapper is presentation-only: viewer state remains on the one semantic
  // edge, while CSS can keep its preceding mask underlay at the same opacity.
  return `        <g data-graph-role="automatic-crossover" style="--step:${index}">\n${underlay}${edge.replace(/^        /, '          ')}\n        </g>`;
}

function connectionLabelTextFit(conn, width) {
  const label = conn.label;
  const mono = /^[!-~·]+(?: [!-~·]+)*$/u.test(label);
  const availableWidth = width - 4 - changeEdgeLabelExtraWidth(conn);
  const preferredSize = 10;
  // Fit the bundled monospace glyphs to the existing mask. Keep CJK glyphs at
  // their natural proportions and leave other fallback text at its old size.
  let fontSize = mono ? preferredSize : 8;
  if (!mono && /^[ -~·←↑→↓、。！？：「」，“”\p{Unified_Ideograph}\u3041-\u3096\u30A1-\u30FA\uAC00-\uD7A3]+$/u.test(label)) {
    // East Asian fallback glyphs typically use a full em. Leave extra room
    // for platform font differences and round the fitted size down.
    const widthInEms = [...label].reduce((sum, glyph) => sum + (glyph.codePointAt(0) <= 0xff ? 0.6 : 1.1), 0);
    fontSize = Math.max(8, Math.min(preferredSize, Math.floor(10 * availableWidth / widthInEms) / 10));
  }
  const fit = mono && minimumNodeTextWidth(label, preferredSize) > availableWidth
    ? ` textLength="${availableWidth}" lengthAdjust="spacingAndGlyphs"`
    : '';
  return { fontSize, fit };
}

function renderConnectionLabel(conn, index) {
  const box = connectionLabelBox(conn);
  if (!box) return '';
  const label = conn.label;
  const { fontSize, fit } = connectionLabelTextFit(conn, box.width);
  const weight = fontSize > 8 ? ' font-weight="500"' : '';
  return `        <g data-detail="context" ${focusEdgeAttrs(conn.from, conn.to, conn.label, index, conn.id)}${changeEdgeAttrs(changeReview, conn)}>
          <rect x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" rx="3" class="c-mask"/>
          <text x="${box.lx}" y="${box.ly}" class="${edgeLabelAccent(conn.variant)}" font-size="${fontSize}"${weight}${fit} text-anchor="middle">${renderChangeEdgePrefix(conn)}${esc(label)}</text>
        </g>`;
}

function componentBrandY(height) {
  return Math.min(6, Math.max(0, (height - 16) / 2));
}

// The normal card keeps its authored geometry and familiar baseline spacing.
function componentTextRows(c, drilldowns) {
  const hasSub = Boolean(c.sublabel);
  const bottom = c.y + c.height;
  const labelY = hasSub ? c.y + c.height / 2 - 2 : c.y + c.height / 2 + 4;
  const sublabelY = c.y + c.height / 2 + 14;
  // Keep the larger sublabel's descenders above the tag or drilldown mark.
  const sublabelLimit = bottom - (c.tag || drilldowns.length ? 18 : 6);
  const sublabelPreferred = hasSub && sublabelY + 3.5 <= sublabelLimit && scalableComponentText.test(c.sublabel)
    ? componentTextFit.sublabelScalable
    : componentTextFit.sublabelPreferred;
  const labelWidth = brandLabelFitWidth(c, c.width);
  const originalFontSize = fittedNodeFontSize(c.label, labelWidth, 11, 8);
  const titleRoom = labelY - c.y >= 22 && (!c.tag || bottom - 8 - labelY >= 14)
    && (!drilldowns.length || labelY + 4 <= bottom - 17);
  // A title close to the top row needs clearance from the corner icons.
  const titleWidth = labelY - c.y < 38 ? Math.min(labelWidth, c.width - componentTextFit.titleCornerClearance) : labelWidth;
  const labelFontSize = titleRoom && scalableComponentText.test(c.label)
    ? Math.max(originalFontSize, fittedNodeFontSize(c.label, titleWidth, 14, 8))
    : originalFontSize;
  const rows = [{ key: 'title', text: c.label, y: labelY - c.y, font: labelFontSize, minimum: 8 }];
  if (hasSub) rows.push({ key: 'sublabel', text: c.sublabel, y: sublabelY - c.y,
    font: fittedNodeFontSize(c.sublabel, c.width, sublabelPreferred, componentTextFit.sublabelMinimum),
    minimum: componentTextFit.sublabelMinimum });
  if (c.tag) rows.push({ key: 'tag', text: c.tag, y: c.height - 8,
    font: fittedNodeFontSize(c.tag, c.width, componentTextFit.tagPreferred, componentTextFit.tagMinimum),
    minimum: componentTextFit.tagMinimum });
  const normal = Object.fromEntries(rows.map(row => [row.key, { ...row, x: c.width / 2 }]));
  const needsFit = rows.some((row, index) => {
    const top = row.y - row.font * 0.8;
    const bottom = row.y + row.font * 0.15;
    return top < 1 || bottom > c.height - 1
      || (index > 0 && top < rows[index - 1].y + rows[index - 1].font * 0.15);
  });
  if (!needsFit) return { rows: normal, fits: true };

  // Fit a compact stack first, then put both secondary values on one row.
  // Reserve each corner mark only on lines that pass through it.
  const brandY = componentBrandY(c.height);
  for (const fonts of [rows.map(row => row.font), rows.map(row => row.minimum)]) {
    const entries = rows.map((row, index) => {
      const font = fonts[index];
      return { ...row, font, width: minimumNodeTextWidth(row.text, font) };
    });
    const stacks = [entries.map(row => [row])];
    if (entries.length === 3) stacks.push([[entries[0]], entries.slice(1)]);
    for (const lines of stacks) {
      const lineFonts = lines.map(line => Math.max(...line.map(row => row.font)));
      const height = lineFonts.reduce((sum, font) => sum + font * 1.25, lines.length - 1);
      if (height > c.height - 4) continue;
      let y = (c.height - height) / 2;
      const fitted = {};
      for (const [index, line] of lines.entries()) {
        const font = lineFonts[index];
        const lineBottom = y + font * 1.25;
        const intersects = (top, bottom) => y < bottom && lineBottom > top;
        const left = c.icon !== 'none' && intersects(4, 19) ? 20 : 4;
        const rightInset = Math.max(4,
          labelWidth < c.width && intersects(brandY - 2, brandY + 18) ? 24 : 0,
          drilldowns.length && intersects(c.height - componentTextFit.drilldownInset, c.height - 3) ? componentTextFit.drilldownInset : 0);
        const right = c.width - rightInset;
        const width = line.reduce((sum, row) => sum + row.width, (line.length - 1) * 6);
        if (width > right - left) break;
        let x = Math.max(left, Math.min(right - width, (c.width - width) / 2));
        for (const row of line) {
          fitted[row.key] = { ...row, x: x + row.width / 2, y: y + font };
          x += row.width + 6;
        }
        y = lineBottom + 1;
      }
      if (Object.keys(fitted).length < rows.length) continue;
      return { rows: fitted, compact: true, fits: true };
    }
  }
  return { rows: normal, fits: false };
}

function renderComponent(c) {
  const fill = componentFill[c.type] || 'c-external';
  const accent = componentText[c.type] || 't-muted';
  const drilldowns = resolveNodeDrilldowns(c);
  const { rows, compact } = componentTextRows(c, drilldowns);
  const hasSub = Boolean(rows.sublabel);
  const sub = hasSub
    ? `\n        <text data-detail="context" x="${c.x + rows.sublabel.x}" y="${c.y + rows.sublabel.y}" class="t-muted" font-size="${rows.sublabel.font}" text-anchor="middle">${esc(c.sublabel)}</text>`
    : '';
  const tag = rows.tag
    ? `\n        <text data-detail="fine" x="${c.x + rows.tag.x}" y="${c.y + rows.tag.y}" class="${accent}" font-size="${rows.tag.font}" text-anchor="middle">${esc(c.tag)}</text>`
    : '';
  const brandYInset = componentBrandY(c.height);
  const brand = renderBrandMark(c, { x: c.x + c.width - 22, y: c.y + brandYInset });
  // drilldowns / href 简写一并解析：单目标会包 <a> + 角标，多目标只写 Passport 属性
  const passport = { kind: c.type, sublabel: c.sublabel, tag: c.tag, context: componentContext(c), drilldowns, href: c.href, ...brandMetadataFor(c) };
  const mark = drilldowns.length ? `\n          ${renderDrilldownMark(c)}` : '';
  // Compact rows can reach the top edge. Leave room for the badge outside
  // the card, including the taller labeled version used in PR exports.
  let badgeY = c.y;
  if (compact && c.y >= 20) badgeY -= 9;
  else if (compact && c.y + c.height + 20 <= viewBox[1]) badgeY += c.height + 9;
  const badgePosition = nodeChangeBadgePos({ ...c, y: badgeY }, { rx: 8, rightInset: brand ? 26 : 0 });
  const changeBadge = renderChangeBadge(c, badgePosition);
  const badge = changeBadge ? `\n          ${changeBadge}` : '';
  return wrapSingleChildAnchor(`        <g ${focusNodeAttrs(c.id, c.label, passport, arch.meta.locale)}${changeNodeAttrs(changeReview, c)}>
          ${focusNodeTitle(c.label, passport)}
          <rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="8" class="c-mask"/>
          <rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="8" class="${fill}"${animateAttr(arch.meta, 'node', componentSteps.get(c.id))} stroke-width="1.5"/>
          ${renderSemanticSigil(c.type, { icon: c.icon, x: c.x + 6, y: c.y + 6 })}${brand ? `\n          ${brand}` : ''}
          <text data-node-label=""${hasSub && !compact ? ' data-detail-anchor=""' : ''} x="${c.x + rows.title.x}" y="${c.y + rows.title.y}" class="t-primary" font-size="${rows.title.font}" font-weight="600" text-anchor="middle">${esc(c.label)}</text>${sub}${tag}${mark}${badge}
        </g>`, drilldowns);
}

function renderLegend() {
  const entries = architectureLegendEntries;
  const relationshipObstacles = relationshipLegendObstacles(arch.connections, {
    pointsFor: (connection) => pathFor(connection).points,
    labelRectFor: connectionLabelBox,
  });
  let contentBottom = 0;
  for (const component of components.values()) {
    contentBottom = Math.max(contentBottom, component.y + component.height);
  }
  for (const boundary of boundaries) {
    contentBottom = Math.max(contentBottom, boundary.y + boundary.height);
  }
  return renderResolvedLegend({
    entries,
    locale: arch.meta.locale,
    layout: {
      x: layout.margin,
      baselineY: legendY(),
      width: viewBox[0] - layout.margin * 2,
      minTitleY: contentBottom + 8,
      obstacles: relationshipObstacles,
      unfit: arch.meta?.legend === undefined ? 'hide' : 'error',
      diagramType: 'architecture',
    },
    renderSwatch: (entry) => renderChangeLegendSwatch(entry)
      || `<rect x="${entry.x}" y="${entry.baseline - 9}" width="16" height="10" rx="2.5" class="${componentFill[entry.kind] || 'c-external'}" stroke-width="1"/>`,
  });
}

function renderSvg() {
  const markerDefinitions = [changeMarkerDefinitions(changeReview)];
  const paths = connections.map((conn, index) =>
    renderConnectionPath(conn, index, connectionMarker(conn, index, markerDefinitions)));
  // An automatic architecture canvas is compiler-measured geometry. Let the
  // Reader spend the real desktop height budget on it, including when an
  // outer route makes the canvas taller than the ordinary wide-diagram
  // threshold. Authored viewBoxes keep their geometry and existing Reader width policy;
  // their declared height may use readable document scrolling without reflow.
  const readerFit = arch.meta?.viewBox
    ? ' data-diagram-type="architecture" data-reader-fit="authored-height"'
    : ' data-reader-fit="intrinsic-height"';
  // A complete repository architecture is allowed to use normal page scroll;
  // keep its common-desktop text at a comfortable reading size instead of
  // shrinking a semantically rich graph to the universal emergency floor.
  const readerMinimumText = arch.meta?.viewBox ? '' : ` data-reader-min-text="${readerMinimumTextPx}"`;
  const readerPrimaryText = arch.meta?.viewBox ? '' : ' data-reader-primary-text="14"';
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(arch.meta)} ${NODE_CARD_ATTR}${readerFit}${readerMinimumText}${readerPrimaryText}>
${svgAccessibleText(arch.meta, 'architecture')}
${renderDefinitions(markerDefinitions.join(''))}
${nodeCardStyle()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Boundaries (behind everything) -->
${boundaries.map(renderBoundaryFrame).join('\n\n')}

        <!-- Connection paths (before components for correct z-order) -->
${paths.join('\n')}

        <!-- Components -->
${[...components.values()].map(renderComponent).join('\n\n')}

        <!-- Connection labels -->
${asArray(arch.connections).map(renderConnectionLabel).join('\n')}

        <!-- Boundary labels (foreground masks keep routes out of titles) -->
${boundaries.map(renderBoundaryLabel).join('\n\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}

if (layoutJsonMode) {
  try {
    validateArchitecture();
  } catch (error) {
    // A rejected layout is still useful repair evidence. Input/implementation
    // failures must retain their existing failure boundary, not partial geometry.
    if (!error.archifyDiagnostics?.length) throw error;
    console.log(JSON.stringify({
      ...buildLayoutReport(),
      ...rendererFailure(error),
      contract: 'archify-architecture-layout-v1',
    }, null, 2));
    process.exitCode = 1;
  }
  if (!process.exitCode) console.log(JSON.stringify(buildLayoutReport(), null, 2));
} else {
  validateArchitecture();
  writeDiagram({
    outPath,
    template,
    diagramType: 'architecture',
    meta: arch.meta,
    svg: renderSvg(),
    cards: arch.cards,
    sourceEvidence,
    diagram: arch,
  });
}
