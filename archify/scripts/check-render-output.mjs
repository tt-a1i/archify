#!/usr/bin/env node

import fs from 'node:fs';
import { analyzeSvgPath } from '../renderers/shared/svg-path-analysis.mjs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { collectAmbiguousCorridors, collectArrowheadCollisions, collectBorderRuns, collectLabelCanvasOverflow, collectLabelRouteClearance, collectRouteRhythmIssues, describeLabelCanvasOverflow, formatRect, forwardCollinearAnalysisSegments, minimumLabelRouteClearance, normalizeRoutePoints, routeBudgetMetrics } from '../renderers/shared/geometry.mjs';
import {
  DESKTOP_READABILITY_VIEWPORT,
  DESKTOP_READER_DIAGRAM_WIDTH,
  DECLARED_WIDE_READER_CONTRACT,
  declaredWideReadabilityBudget,
  MIN_PROJECTED_NODE_TEXT_PX,
  describeFixedWidthOverflow,
  predictedFixedWidthOverflow,
  projectedNodeTextPx,
} from '../renderers/shared/desktop-readability.mjs';

const input = process.argv[2];

if (!input || input === '-h' || input === '--help') {
  console.error('Usage: node scripts/check-render-output.mjs <diagram.html>');
  process.exit(input ? 0 : 2);
}

const htmlPath = path.resolve(input);
let html;
let artifact;
try {
  const bytes = fs.readFileSync(htmlPath);
  html = bytes.toString('utf8');
  artifact = { sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.byteLength };
} catch (err) {
  console.error(JSON.stringify({
    ok: false,
    file: htmlPath,
    checks: [{ name: 'file_readable', ok: false, details: [err.message] }],
  }, null, 2));
  process.exit(1);
}

const checks = [];
const pathDiagnostics = [];
const pathAnalyses = new Map();
let composition = {
  schemaVersion: 1,
  profile: 'standard',
  status: 'pass',
  summary: { errors: 0, warnings: 0 },
  metrics: {
    properCrossings: 0,
    resolvedCrossovers: 0,
    ambiguousCorridors: 0,
    containerBorderRuns: 0,
    labelRouteClearanceIssues: 0,
    minLabelRouteClearance: null,
    labelCanvasOverflowIssues: 0,
    maxBends: 0,
    routesOverSuggestedBends: 0,
    maxStretch: null,
    routesOverSuggestedStretch: 0,
    minSegmentPx: null,
    minInteriorSegmentPx: null,
    shortSegmentCount: 0,
    shortEndpointSegmentCount: 0,
    shortInteriorSegmentCount: 0,
    microSegmentCount: 0,
    desktopReadabilityIssues: 0,
    minProjectedNodeTextPx: null,
  },
  suggestedLimits: { bendsPerRelationship: 2, stretch: 1.35, segmentPx: 16, microSegmentPx: 8 },
  issues: [],
};

const NON_FINITE_TOKEN = /\b(?:NaN|undefined|Infinity)\b/;
// Consume comments/CDATA as whole tokens, including any tag-like prose.
const SVG_TAG_TOKEN = /<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<(\/?)([A-Za-z][\w:-]*)(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>/g;
const AUTOMATIC_CROSSOVER_UNDERLAY_TAG = /<path\b[^>]*\bdata-graph-role="automatic-crossover-underlay"[^>]*\/>/i;
const HTML_VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const SVG_HTML_INTEGRATION_POINTS = new Set(['foreignobject', 'desc', 'title']);
const HTML_ATTRIBUTE = /([A-Za-z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
const readerContract = readerContractFromHtml(html);
const NUMERIC_ATTRS = new Set([
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'dx', 'dy', 'cx', 'cy', 'r', 'rx', 'ry', 'fx', 'fy',
  'fr', 'width', 'height', 'd', 'points', 'pathlength', 'transform', 'viewbox', 'offset',
  'opacity', 'fill-opacity', 'flood-opacity', 'stop-opacity', 'stroke-opacity', 'font-size',
  'font-size-adjust', 'font-weight', 'letter-spacing', 'word-spacing', 'kerning', 'stroke-width',
  'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'textlength', 'startoffset',
  'rotate', 'markerwidth', 'markerheight', 'refx', 'refy', 'orient', 'patterntransform',
  'gradienttransform', 'filterres', 'stddeviation', 'basefrequency', 'numoctaves', 'seed',
  'surfacescale', 'diffuseconstant', 'specularconstant', 'specularexponent',
  'limitingconeangle', 'azimuth', 'elevation', 'pointsatx', 'pointsaty', 'pointsatz',
  'kernelmatrix', 'order', 'divisor', 'bias', 'targetx', 'targety', 'kernelunitlength',
  'scale', 'radius', 'k1', 'k2', 'k3', 'k4', 'tablevalues', 'slope', 'intercept',
  'amplitude', 'exponent',
]);
const ELEMENT_NUMERIC_ATTRS = new Map([
  ['fecolormatrix', new Set(['values'])],
  ['fepointlight', new Set(['z'])],
  ['fespotlight', new Set(['z'])],
]);

function addCheck(name, ok, details = []) {
  checks.push({ name, ok, details });
}

const svgMatches = [...html.matchAll(/<svg\b[\s\S]*?<\/svg>/gi)];
addCheck('single_svg', svgMatches.length === 1, [`found ${svgMatches.length} <svg> block(s)`]);

if (svgMatches.length === 1) {
  const svg = svgMatches[0][0];
  const svgRoot = svg.match(/<svg\b[^>]*>/i)?.[0] || '';
  const svgAttrs = parseAttrs(svgRoot);
  const qualityProfile = svgAttrs['data-quality-profile'] || 'standard';
  const workflowV2 = svgAttrs['data-layout-contract'] === 'readable-v2';
  const qualityGatesEnforced = svgAttrs['data-quality-gates'] !== 'advisory';
  const nonFiniteAttrs = collectNonFiniteAttrs(svg);
  addCheck('finite_svg', nonFiniteAttrs.length === 0, nonFiniteAttrs);
  const legendStart = svg.indexOf('<!-- Legend -->');
  const beforeLegend = legendStart >= 0 ? svg.slice(0, legendStart) : svg;
  const desktopReadability = collectDesktopReadability(svgAttrs, beforeLegend, readerContract);
  const desktopReadabilityIssue = desktopReadability.issue;
  // The browser gate measures this later; the geometry is already certain here.
  const viewportHeightIssue = predictedFixedWidthOverflow({
    viewBoxWidth: viewBoxSize(svgAttrs)[0],
    viewBoxHeight: viewBoxSize(svgAttrs)[1],
    readerFit: svgAttrs['data-reader-fit'] || null,
    diagramType: svgAttrs['data-diagram-type'] || null,
  });
  const arrows = collectArrows(beforeLegend, workflowV2);
  const diagonal = arrows.flatMap((arrow) => diagonalStraightSegments(arrow).map((segment) => ({ arrow, ...segment })));
  addCheck(
    'orthogonal_arrows',
    diagonal.length === 0,
    diagonal.map(({ arrow, segmentIndex }) => `${arrow.kind} ${arrow.index} segment ${segmentIndex + 1}: expected an orthogonal segment or an explicitly authored direct straight route; ${arrow.raw}`),
  );
  const measuredRelationshipCrossings = collectRelationshipCrossings(arrows, workflowV2);
  const resolvedCrossovers = measuredRelationshipCrossings.filter((hit) => (
    hit.left.crossoverHalo && hit.right.crossoverHalo
  ));
  const relationshipCrossings = measuredRelationshipCrossings.filter((hit) => (
    !hit.left.crossoverHalo || !hit.right.crossoverHalo
  ));
  const compositionFrames = collectCompositionFrames(beforeLegend);
  const containerBorderRuns = collectBorderRuns({
    routedRelations: arrows
      .filter((arrow) => arrow.from && arrow.to && arrow.borderSegments.length)
      .map((arrow) => ({
        relation: arrow,
        relationIndex: arrow.index,
        segments: arrow.borderSegments,
      })),
    frames: compositionFrames,
  });
  const routedRelationships = arrows
    .filter((arrow) => arrow.from && arrow.to && arrow.routeSubpaths.some(points => points.length > 1))
    .map((arrow) => ({ relation: arrow, relationIndex: arrow.index, points: arrow.routePoints }));
  const nodeRects = svgAttrs.transform ? [] : collectUntransformedNodeRects(beforeLegend);
  const routeMetrics = subpathBudgetMetrics(routedRelationships);
  // Architecture marks only one of its two Reader fits with its type.
  const crowdedSides = svgAttrs['data-diagram-type'] === 'architecture' || svgAttrs['data-reader-primary-text'] === '14'
    ? crowdedNodeSides(arrows, nodeRects) : [];
  const routeRhythmIssues = subpathRhythmIssues(routedRelationships);
  const ambiguousCorridors = subpathCorridors({
    routedRelations: routedRelationships,
    includeSharedEndpoints: (left, right) => workflowV2 || (left.independentPorts && right.independentPorts),
    allowShortWorkflowTrunks: workflowV2,
    includeSharedEndpointCounterflow: (left, right) => left.automaticWorkflowRoute && right.automaticWorkflowRoute,
  });
  const arrowheadCollisions = collectArrowheadCollisions({
    routedRelations: routedRelationships.filter((entry) => workflowV2 || entry.relation.independentPorts)
      .flatMap(entry => routeParts(entry).filter(part => part.targetEndpoint)),
    allowShortWorkflowTrunks: workflowV2,
  });
  const relationshipLabels = collectRelationshipLabelMasks(beforeLegend, arrows);
  const leadingSpace = collectArchitectureLeadingSpace({
    svgAttrs, fragment: beforeLegend, nodeRects, frames: compositionFrames,
    arrows, labels: relationshipLabels,
  });
  const sequenceColumnSpace = collectSequenceColumnSpace({ svgAttrs, fragment: beforeLegend, nodeRects, arrows });
  const labelClearanceThreshold = qualityProfile === 'showcase' ? 4 : 2;
  const labelRouteMeasurements = subpathLabelClearance({
    labels: relationshipLabels,
    routedRelations: arrows.map((arrow) => ({ relation: arrow, relationIndex: arrow.index, points: arrow.routePoints })),
    threshold: Number.MAX_VALUE,
  });
  const labelRouteClearance = subpathLabelClearance({
    labels: relationshipLabels,
    routedRelations: arrows.map((arrow) => ({ relation: arrow, relationIndex: arrow.index, points: arrow.routePoints })),
    threshold: labelClearanceThreshold,
  });
  // The renderers bound their own label rects, but `check` also re-measures an
  // artifact it did not produce; see collectLabelCanvasOverflow in
  // shared/geometry.mjs.
  const labelCanvasOverflow = collectLabelCanvasOverflow({
    labels: relationshipLabels,
    viewBox: viewBoxRect(svgAttrs),
  });
  const crossingIsError = qualityProfile === 'showcase';
  const corridorIsError = qualityProfile === 'showcase';
  const rhythmIsError = qualityProfile === 'showcase';
  const labelClearanceIsError = qualityProfile === 'showcase';
  const labelContainmentIsError = qualityProfile === 'showcase';
  const desktopReadabilityIsError = qualityProfile === 'showcase';
  // Certain geometry, but new: surface it as evidence first (CONTRIBUTING.md#product-and-compatibility-contracts).
  const viewportHeightIsError = false;
  const compositionErrors = (qualityGatesEnforced ? containerBorderRuns.length : 0)
    + (crossingIsError ? relationshipCrossings.length : 0)
    + (corridorIsError ? ambiguousCorridors.length + arrowheadCollisions.length : 0)
    + (labelClearanceIsError ? labelRouteClearance.length : 0)
    + (labelContainmentIsError ? labelCanvasOverflow.length : 0)
    + (rhythmIsError ? routeRhythmIssues.length : 0)
    + (desktopReadabilityIsError && desktopReadabilityIssue ? 1 : 0)
    + (viewportHeightIsError && viewportHeightIssue ? 1 : 0);
  const compositionWarnings = (qualityGatesEnforced ? 0 : containerBorderRuns.length)
    + (crossingIsError ? 0 : relationshipCrossings.length)
    + (corridorIsError ? 0 : ambiguousCorridors.length + arrowheadCollisions.length)
    + (labelClearanceIsError ? 0 : labelRouteClearance.length)
    + (labelContainmentIsError ? 0 : labelCanvasOverflow.length)
    + (rhythmIsError ? 0 : routeRhythmIssues.length)
    + (desktopReadabilityIsError || !desktopReadabilityIssue ? 0 : 1)
    + (viewportHeightIsError || !viewportHeightIssue ? 0 : 1);
  composition = {
    schemaVersion: 1,
    profile: qualityProfile,
    status: compositionErrors ? 'fail' : 'pass',
    summary: {
      errors: compositionErrors,
      warnings: compositionWarnings,
    },
    metrics: {
      properCrossings: relationshipCrossings.length,
      resolvedCrossovers: resolvedCrossovers.length,
      ambiguousCorridors: ambiguousCorridors.length,
      arrowheadCollisions: arrowheadCollisions.length,
      containerBorderRuns: containerBorderRuns.length,
      labelRouteClearanceIssues: labelRouteClearance.length,
      labelCanvasOverflowIssues: labelCanvasOverflow.length,
      minLabelRouteClearance: minimumLabelRouteClearance(labelRouteMeasurements),
      desktopReadabilityIssues: desktopReadabilityIssue ? 1 : 0,
      viewportHeightIssues: viewportHeightIssue ? 1 : 0,
      minProjectedNodeTextPx: desktopReadability.evidence.minimumProjectedTextPx,
      ...roundedRouteMetrics(routeMetrics),
    },
    suggestedLimits: { bendsPerRelationship: 2, stretch: 1.35, segmentPx: 16, microSegmentPx: 8 },
    // Perceptual review needs the affected relationships, not just a total.
    // These are review evidence, not new pass/fail thresholds: a short, clear
    // crossover can be preferable to a long crossing-free detour.
    routeReview: {
      crossings: resolvedCrossovers.map((hit) => {
        const shared = [hit.left.from, hit.left.to].find((id) => id && (id === hit.right.from || id === hit.right.to));
        return {
          left: relationshipRecord(hit.left),
          right: relationshipRecord(hit.right),
          point: hit.point,
          ...(shared ? { sharedNode: shared } : {}),
        };
      }),
      ...(crowdedSides.length ? { crowdedSides } : {}),
      detours: routedRelationships.flatMap((entry) => {
        const metrics = subpathBudgetMetrics([entry]);
        const blockers = directCorridorBlockers(entry.relation, nodeRects);
        return metrics.routesOverSuggestedBends || metrics.routesOverSuggestedStretch ? [{
          relationship: relationshipRecord(entry.relation),
          bends: metrics.maxBends,
          stretch: metrics.maxStretch == null ? null : Math.round(metrics.maxStretch * 1000) / 1000,
          ...(blockers.length ? { directCorridorBlockers: blockers } : {}),
        }] : [];
      }),
    },
    leadingSpace,
    ...(sequenceColumnSpace ? { sequenceColumnSpace } : {}),
    desktopReadability: desktopReadability.evidence,
    issues: [
      ...containerBorderRuns.map((hit) => ({
        severity: qualityGatesEnforced ? 'error' : 'warning',
        code: 'composition/container-border-run',
        relationship: relationshipRecord(hit.relation),
        frame: frameRecord(hit.frame),
        side: hit.side,
        segmentIndex: hit.segmentIndex,
        overlapLength: Math.round(hit.overlapLength * 10) / 10,
        from: hit.overlapStart.map((value) => Math.round(value * 10) / 10),
        to: hit.overlapEnd.map((value) => Math.round(value * 10) / 10),
      })),
      ...labelRouteClearance.map((hit) => ({
        severity: labelClearanceIsError ? 'error' : 'warning',
        code: 'composition/label-route-clearance',
        label: hit.label?.label || hit.labelRelation?.label || '',
        labelRelationship: relationshipRecord(hit.labelRelation),
        otherRelationship: relationshipRecord(hit.otherRelation),
        segmentIndex: hit.segmentIndex,
        labelRect: roundedRect(hit.rect),
        clearance: Math.round(hit.clearance * 10) / 10,
        intersectionLength: Math.round((hit.intersectionLength || 0) * 10) / 10,
        threshold: hit.threshold,
        from: hit.start.map((value) => Math.round(value * 10) / 10),
        to: hit.end.map((value) => Math.round(value * 10) / 10),
      })),
      ...labelCanvasOverflow.map((hit) => {
        const label = hit.label?.label || hit.relation?.label || '';
        return {
          severity: labelContainmentIsError ? 'error' : 'warning',
          code: 'composition/label-canvas-containment',
          label,
          relationship: relationshipRecord(hit.relation),
          labelRect: roundedRect(hit.rect),
          viewBox: hit.viewBox,
          viewBoxOrigin: hit.viewBoxOrigin,
          overflowPx: hit.overflowPx,
          detail: `[composition/label-canvas-containment] ${qualityProfile} label "${label}" on ${relationshipName(hit.relation)} extends past the ${describeLabelCanvasOverflow(hit)} (label rect ${formatRect(hit.rect)}; viewBox ${hit.viewBox[0]}x${hit.viewBox[1]}${hit.viewBoxOrigin.some(Boolean) ? ` at ${hit.viewBoxOrigin[0]},${hit.viewBoxOrigin[1]}` : ''}) — use renderer-supported label controls (shorten the label or reorder participants for sequence; otherwise labelAt, labelDx, labelDy, or labelSegment), or enlarge meta.viewBox.`,
        };
      }),
      ...relationshipCrossings.map((hit) => ({
        severity: crossingIsError ? 'error' : 'warning',
        code: 'composition/proper-crossing',
        relationship: relationshipRecord(hit.left),
        otherRelationship: relationshipRecord(hit.right),
        point: hit.point.map((value) => Math.round(value * 10) / 10),
      })),
      ...ambiguousCorridors.map((hit) => ({
        severity: corridorIsError ? 'error' : 'warning',
        code: 'composition/ambiguous-corridor',
        relationship: relationshipRecord(hit.left.relation),
        otherRelationship: relationshipRecord(hit.right.relation),
        segmentIndex: hit.leftSegment,
        otherSegmentIndex: hit.rightSegment,
        overlapLength: Math.round(hit.overlapLength * 10) / 10,
        from: hit.overlapStart.map((value) => Math.round(value * 10) / 10),
        to: hit.overlapEnd.map((value) => Math.round(value * 10) / 10),
      })),
      ...arrowheadCollisions.map((hit) => ({
        severity: corridorIsError ? 'error' : 'warning',
        code: 'composition/arrowhead-collision',
        relationship: relationshipRecord(hit.left.relation),
        otherRelationship: relationshipRecord(hit.right.relation),
        distancePx: hit.distance,
        minimumPx: hit.minimum,
        endpoints: [hit.left.tip, hit.right.tip],
      })),
      ...routeRhythmIssues.map((hit) => ({
        severity: rhythmIsError ? 'error' : 'warning',
        code: hit.code,
        relationship: relationshipRecord(hit.relation),
        segmentIndex: hit.segmentIndex,
        position: hit.position,
        length: Math.round(hit.length * 10) / 10,
        from: hit.start.map((value) => Math.round(value * 10) / 10),
        to: hit.end.map((value) => Math.round(value * 10) / 10),
      })),
      ...(desktopReadabilityIssue ? [{
        severity: desktopReadabilityIsError ? 'error' : 'warning',
        code: 'composition/desktop-readability',
        ...(desktopReadabilityIssue.nodeId ? { nodeId: desktopReadabilityIssue.nodeId } : {}),
        owner: desktopReadabilityIssue.owner,
        viewportWidth: DESKTOP_READABILITY_VIEWPORT.width,
        viewportHeight: DESKTOP_READABILITY_VIEWPORT.height,
        availableDiagramWidth: desktopReadability.evidence.availableDiagramWidth,
        budgetBasis: desktopReadability.evidence.budgetBasis,
        readerContract: desktopReadability.evidence.readerContract,
        requestedTargetPx: desktopReadability.evidence.requestedTargetPx,
        requestedTargetMet: desktopReadability.evidence.requestedTargetMet,
        budgetLimit: desktopReadability.evidence.limit,
        viewBoxWidth: desktopReadabilityIssue.viewBoxWidth,
        scale: desktopReadabilityIssue.scale,
        text: desktopReadabilityIssue.text,
        detail: desktopReadabilityIssue.detail,
        sourceFontPx: desktopReadabilityIssue.sourceFontPx,
        projectedFontPx: desktopReadabilityIssue.projectedFontPx,
        minimumProjectedFontPx: MIN_PROJECTED_NODE_TEXT_PX,
      }] : []),
      ...(viewportHeightIssue ? [{
        severity: viewportHeightIsError ? 'error' : 'warning',
        code: 'composition/viewport-height',
        readerFit: svgAttrs['data-reader-fit'] || null,
        viewBoxWidth: viewBoxSize(svgAttrs)[0],
        viewBoxHeight: viewBoxSize(svgAttrs)[1],
        ...viewportHeightIssue,
        detail: `[composition/viewport-height] ${describeFixedWidthOverflow({ ...viewportHeightIssue, viewBoxWidth: viewBoxSize(svgAttrs)[0], viewBoxHeight: viewBoxSize(svgAttrs)[1] })}`,
      }] : []),
    ],
  };
  addCheck(
    'label_route_clearance',
    !labelClearanceIsError || labelRouteClearance.length === 0,
    labelRouteClearance.map((hit) => (
      `[composition/label-route-clearance] ${qualityProfile} label "${hit.label?.label || hit.labelRelation?.label || ''}" on ${relationshipName(hit.labelRelation)} is ${Math.round(hit.clearance * 10) / 10}px from ${relationshipName(hit.otherRelation)} segment ${hit.segmentIndex} [${formatPoint(hit.start)}] -> [${formatPoint(hit.end)}]${hit.intersectionLength > 0 ? ` with ${Math.round(hit.intersectionLength * 10) / 10}px hidden by the mask` : ''} (minimum ${hit.threshold}px) — use renderer-supported label controls (message y for sequence; otherwise labelAt, labelDx, labelDy, or labelSegment), or adjust the other relationship route/via/channel.`
    )),
  );
  addCheck(
    'relationship_crossings',
    !crossingIsError || relationshipCrossings.length === 0,
    relationshipCrossings.map((hit) => (
      `[composition/proper-crossing] ${qualityProfile} ${relationshipName(hit.left)} crosses ${relationshipName(hit.right)} at [${formatPoint(hit.point)}]`
    )),
  );
  addCheck(
    'relationship_corridors',
    !corridorIsError || ambiguousCorridors.length + arrowheadCollisions.length === 0,
    [...ambiguousCorridors.map((hit) => (
      `[composition/ambiguous-corridor] ${qualityProfile} ${relationshipName(hit.left.relation)} shares a ${Math.round(hit.overlapLength * 10) / 10}px corridor with ${relationshipName(hit.right.relation)} at [${formatPoint(hit.overlapStart)}] -> [${formatPoint(hit.overlapEnd)}]`
    )), ...arrowheadCollisions.map((hit) => (
      `[composition/arrowhead-collision] ${qualityProfile} ${relationshipName(hit.left.relation)} and ${relationshipName(hit.right.relation)} have incoming arrowheads ${hit.distance}px apart (minimum ${hit.minimum}px) — enlarge or reposition the destination, or choose separate toSide ports.`
    ))],
  );
  addCheck(
    'container_border_runs',
    !qualityGatesEnforced || containerBorderRuns.length === 0,
    containerBorderRuns.map((hit) => (
      `[composition/container-border-run] ${relationshipName(hit.relation)} follows ${frameName(hit.frame)} ${hit.side} border for ${Math.round(hit.overlapLength * 10) / 10}px on segment ${hit.segmentIndex} [${formatPoint(hit.overlapStart)}] -> [${formatPoint(hit.overlapEnd)}]`
    )),
  );
  addCheck(
    'route_rhythm',
    !rhythmIsError || routeRhythmIssues.length === 0,
    routeRhythmIssues.map((hit) => (
      `[${hit.code}] ${qualityProfile} ${relationshipName(hit.relation)} has a ${Math.round(hit.length * 10) / 10}px ${hit.position} segment ${hit.segmentIndex} [${formatPoint(hit.start)}] -> [${formatPoint(hit.end)}]`
    )),
  );

  if (legendStart >= 0) {
    const legendFragment = svg.slice(legendStart);
    const legendBoxes = collectLegendBoxes(legendFragment);
    const collisions = collectLegendCollisions(arrows, legendBoxes);
    addCheck(
      'legend_clearance',
      collisions.length === 0,
      collisions.map((hit) => `${hit.arrow.kind} ${hit.arrow.index} crosses legend ${hit.box.label}`),
    );
  } else {
    addCheck('legend_clearance', true, ['no legend marker found']);
  }
}

if (pathDiagnostics.length) addCheck('svg_path_data', false, pathDiagnostics.map(item => item.message));

const ok = checks.every((check) => check.ok) && composition.status !== 'fail';
console.log(JSON.stringify({ ok, file: htmlPath, artifact, checks, composition,
  ...(pathDiagnostics.length ? { diagnostics: pathDiagnostics } : {}),
}, null, 2));
// Let pending stdout writes drain: large receipts are asynchronous when piped.
process.exitCode = ok ? 0 : 1;

function collectArrows(fragment, useActualPoints = false) {
  const arrows = [];
  let index = 0;
  let pathIndex = 0;
  let previousTag = null;
  let previousTagEnd = 0;

  for (const tag of fragment.matchAll(SVG_TAG_TOKEN)) {
    const name = tag[2]?.toLowerCase();
    if (tag[1] || !['path', 'line'].includes(name)) continue;
    if (name === 'path') pathIndex += 1;
    const tagStart = tag.index;
    const raw = tag[0];
    const gap = previousTag ? fragment.slice(previousTagEnd, tagStart) : '';
    const precedingUnderlay = previousTag
      && /^\s*$/.test(gap)
      && previousTag.name === 'path'
      && previousTag.underlayAttrs;
    previousTag = {
      name: name,
      underlayAttrs: name === 'path' && AUTOMATIC_CROSSOVER_UNDERLAY_TAG.test(raw)
        ? parseAttrs(raw)
        : null,
    };
    previousTagEnd = tagStart + raw.length;
    if (!/\bclass="[^"]*\ba-(?:default|emphasis|security|dashed)\b/.test(raw)) continue;
    if (!/\bmarker-end=/.test(raw)) continue;
    const attrs = parseAttrs(raw);
    const routeStrokeWidth = numberAttr(attrs, 'stroke-width');
    const underlayStrokeWidth = precedingUnderlay ? numberAttr(precedingUnderlay, 'stroke-width') : NaN;
    const verifiedCrossoverHalo = attrs['data-composition-crossover'] === 'halo'
      && precedingUnderlay?.d === attrs.d
      && precedingUnderlay?.fill === 'none'
      && precedingUnderlay?.stroke === 'var(--mask)'
      && precedingUnderlay?.['pointer-events'] === 'none'
      && Number.isFinite(routeStrokeWidth)
      && Number.isFinite(underlayStrokeWidth)
      && underlayStrokeWidth >= routeStrokeWidth + 3;
    const line = name === 'line';
    const parsed = line ? null : inspectedPath(attrs, tag.index, pathIndex, 'relationship');
    const segments = line ? lineSegments(attrs) : parsed.subpaths.flatMap(part => part.segments);
    const borderSegments = line ? segments : parsed.subpaths.flatMap(part => part.straightSegments);
    let routeSubpaths = line ? continuousRoutePoints(segments)
      : parsed.subpaths.flatMap(part => continuousRoutePoints(part.straightSegments));
    // Legacy single-path metadata remains supported. It cannot bridge actual moveto boundaries.
    if (!useActualPoints && (line || parsed.subpaths.length === 1)) {
      const authoredPoints = parseRoutePoints(attrs['data-composition-points']);
      if (authoredPoints) routeSubpaths = [authoredPoints];
    }
    arrows.push({
      kind: name,
      index: index += 1,
      raw,
      // Trust route intent only for a semantic edge with one visible direct
      // segment. A stale marker on bent/curved geometry cannot waive the gate.
      authoredStraight: attrs['data-composition-route'] === 'straight'
        && Boolean(attrs['data-edge-from'] && attrs['data-edge-to'])
        && segments.length === 1 && borderSegments.length === 1
        && (name === 'line' || /^\s*M\s+[-+\d.eE]+\s+[-+\d.eE]+\s+L\s+[-+\d.eE]+\s+[-+\d.eE]+\s*$/.test(attrs.d || '')),
      crossoverHalo: verifiedCrossoverHalo,
      independentPorts: verifiedCrossoverHalo && attrs['data-composition-independent'] === 'true',
      // Compatibility with first-round exports lacking a root layout contract.
      // Readable-v2's root contract supersedes this narrower automatic-pair rule.
      // This marker never certifies a crossover halo or waives a quality rule.
      automaticWorkflowRoute: attrs['data-composition-routing'] === 'workflow-v2-auto',
      junction: attrs['data-composition-junction'] || null,
      width: routeStrokeWidth,
      variant: raw.match(/\ba-(default|emphasis|security|dashed)\b/)?.[1] || 'default',
      role: attrs['data-edge-role'],
      segments,
      borderSegments,
      routePoints: routeSubpaths.length === 1 ? routeSubpaths[0] : [],
      routeSubpaths,
      from: attrs['data-edge-from'] || attrs['data-composition-edge-from'],
      to: attrs['data-edge-to'] || attrs['data-composition-edge-to'],
      id: attrs['data-edge-id'] || attrs['data-composition-edge-id'],
      key: attrs['data-edge-key'],
      label: attrs['data-edge-label'],
      offset: tag.index,
    });
  }

  return arrows;
}

function continuousRoutePoints(segments) {
  const parts = [];
  for (const { start, end } of segments) {
    const previous = parts.at(-1);
    // 非共线 Q 不参与直线预算；其两端也不能被拼接成一条虚构直线。
    if (previous && previous.at(-1)[0] === start[0] && previous.at(-1)[1] === start[1]) {
      previous.push(end);
    } else {
      parts.push([start, end]);
    }
  }
  // 保留没有直线的子路径位置，避免把前一片段误认作语义终点。
  return parts.length ? parts : [[]];
}

function inspectedPath(attrs, offset, pathIndex, role) {
  if (pathAnalyses.has(offset)) return pathAnalyses.get(offset);
  const result = analyzeSvgPath(decodeNumericReferences(attrs.d || ''));
  if (result.ok) {
    pathAnalyses.set(offset, result);
    return result;
  }
  const { code, ...evidence } = result.error;
  const id = attrs.id || attrs['data-edge-id'] || attrs['data-composition-frame-id'];
  pathDiagnostics.push({
    code,
    severity: 'error',
    message: `${role} path ${pathIndex}${id ? ` (${id})` : ''}: ${evidence.reason} at d offset ${evidence.tokenOffset}.`,
    subject: { role, pathIndex, ...(id ? { id } : {}) },
    evidence,
    supportedFixes: [code === 'artifact/svg-path-unsupported'
      ? 'regenerate the inspected relationship or frame using M/L/H/V/Q/Z commands'
      : 'correct the path data at the reported offset or regenerate it from the original diagram'],
  });
  const invalid = { ok: false, subpaths: [] };
  pathAnalyses.set(offset, invalid);
  return invalid;
}

// Keep relationship identity separate from its disconnected drawing pieces.
// Normalizing each piece also makes evidence segment indices stable across consumers.
function routeParts(entry) {
  const subpaths = entry.relation.routeSubpaths || [entry.points];
  let segmentOffset = 0;
  return subpaths.flatMap((points, subpathIndex) => {
    const normalized = normalizeRoutePoints(points);
    const part = { ...entry, points: normalized, segmentOffset,
      sourceEndpoint: subpathIndex === 0, targetEndpoint: subpathIndex === subpaths.length - 1 };
    segmentOffset += Math.max(0, normalized.length - 1);
    return normalized.length > 1 ? [part] : [];
  });
}

function subpathBudgetMetrics(entries) {
  if (entries.every(entry => entry.relation.routeSubpaths.length <= 1)) {
    return routeBudgetMetrics({ routedRelations: entries });
  }
  const total = routeBudgetMetrics({ routedRelations: [] });
  for (const entry of entries) {
    const parts = routeParts(entry);
    const metrics = routeBudgetMetrics({ routedRelations: parts });
    metrics.maxBends = parts.reduce((sum, part) => sum + Math.max(0, part.points.length - 2), 0);
    // A relationship may exceed a budget in several pieces; count its identity once.
    metrics.routesOverSuggestedBends = Number(metrics.maxBends > 2);
    metrics.routesOverSuggestedStretch = Number(metrics.routesOverSuggestedStretch > 0);
    for (const [key, value] of Object.entries(metrics)) {
      if (key.startsWith('max')) total[key] = value == null ? total[key] : Math.max(total[key] ?? value, value);
      else if (key.startsWith('min')) total[key] = value == null ? total[key] : Math.min(total[key] ?? value, value);
      else total[key] += value;
    }
  }
  return total;
}

function subpathRhythmIssues(entries) {
  return entries.flatMap(entry => routeParts(entry).flatMap(part => (
    collectRouteRhythmIssues({ routedRelations: [part] }).map(issue => ({
      ...issue, segmentIndex: issue.segmentIndex + part.segmentOffset,
    }))
  )));
}

function subpathCorridors({ routedRelations, ...options }) {
  if (routedRelations.every(entry => entry.relation.routeSubpaths.length <= 1)) {
    return collectAmbiguousCorridors({ routedRelations, ...options });
  }
  const hits = [];
  const parts = routedRelations.map(routeParts);
  for (let left = 0; left < parts.length; left += 1) {
    for (let right = left + 1; right < parts.length; right += 1) {
      let longest;
      for (const a of parts[left]) for (const b of parts[right]) {
        const hit = collectAmbiguousCorridors({ routedRelations: [a, b], ...options })[0];
        if (hit && (!longest || hit.overlapLength > longest.overlapLength + 0.0001)) {
          longest = { ...hit, leftSegment: hit.leftSegment + a.segmentOffset,
            rightSegment: hit.rightSegment + b.segmentOffset };
        }
      }
      if (longest) hits.push(longest);
    }
  }
  return hits;
}

function subpathLabelClearance({ routedRelations, labels, threshold }) {
  if (routedRelations.every(entry => entry.relation.routeSubpaths.length <= 1)) {
    return collectLabelRouteClearance({ routedRelations, labels, threshold });
  }
  // The shared helper deduplicates by relationship identity. Measure each piece
  // independently, then preserve one nearest hit per label/relationship pair.
  const hits = [];
  const seen = new Set();
  for (const entry of routedRelations) {
    const relation = entry.relation;
    const identity = relation.key !== undefined ? `key:${relation.key}`
      : relation.id ? `id:${relation.from || ''}\0${relation.to || ''}\0${relation.id}` : `index:${entry.relationIndex}`;
    if (seen.has(identity) || !routeParts(entry).length) continue;
    seen.add(identity);
    const nearest = new Map();
    for (const part of routeParts(entry)) {
      for (const hit of collectLabelRouteClearance({ routedRelations: [part], labels, threshold })) {
        const current = nearest.get(hit.labelRelationIndex);
        if (!current || hit.clearance < current.clearance) nearest.set(hit.labelRelationIndex, {
          ...hit, segmentIndex: hit.segmentIndex + part.segmentOffset,
        });
      }
    }
    hits.push(...nearest.values());
  }
  return hits;
}

function collectRelationshipLabelMasks(fragment, arrows) {
  const labels = [];
  for (const match of fragment.matchAll(/<g\b[^>]*\bdata-edge-(?:key|id|from)="[^"]*"[^>]*>[\s\S]*?<\/g>/gi)) {
    const group = match[0];
    const groupAttrs = parseAttrs(group.match(/<g\b[^>]*>/i)?.[0] || '');
    const rectTag = [...group.matchAll(/<rect\b[^>]*>/gi)]
      .map((item) => item[0])
      .find((tag) => /\bclass="[^"]*\bc-mask\b/.test(tag));
    if (!rectTag) continue;
    const attrs = parseAttrs(rectTag);
    const rect = {
      x: numberAttr(attrs, 'x'),
      y: numberAttr(attrs, 'y'),
      width: numberAttr(attrs, 'width'),
      height: numberAttr(attrs, 'height'),
    };
    if (![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) continue;
    const groupStart = match.index;
    const groupEnd = groupStart + group.length;
    const containedOwner = arrows.find((arrow) => (
      arrow.offset > groupStart
      && arrow.offset < groupEnd
      && arrow.from === groupAttrs['data-edge-from']
      && arrow.to === groupAttrs['data-edge-to']
      && (!groupAttrs['data-edge-id'] || !arrow.id || arrow.id === groupAttrs['data-edge-id'])
    ));
    const owner = arrows.find((arrow) => (
      groupAttrs['data-edge-key'] !== undefined && arrow.key === groupAttrs['data-edge-key']
    )) || containedOwner || arrows.find((arrow) => (
      arrow.id === groupAttrs['data-edge-id']
      && arrow.from === groupAttrs['data-edge-from']
      && arrow.to === groupAttrs['data-edge-to']
    ));
    if (!owner) continue;
    if (owner.key === undefined && groupAttrs['data-edge-key'] !== undefined) owner.key = groupAttrs['data-edge-key'];
    if (!owner.id && groupAttrs['data-edge-id']) owner.id = groupAttrs['data-edge-id'];
    if (!owner.label && groupAttrs['data-edge-label']) owner.label = groupAttrs['data-edge-label'];
    labels.push({
      relation: owner,
      relationIndex: owner.index,
      label: groupAttrs['data-edge-label'] || '',
      rect,
    });
  }
  return labels;
}

function roundedRect(rect) {
  return Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, Math.round(value * 10) / 10]));
}

function roundedRouteMetrics(metrics) {
  return {
    ...metrics,
    maxStretch: metrics.maxStretch == null ? null : Math.round(metrics.maxStretch * 1000) / 1000,
    minSegmentPx: metrics.minSegmentPx == null ? null : Math.round(metrics.minSegmentPx * 10) / 10,
    minInteriorSegmentPx: metrics.minInteriorSegmentPx == null ? null : Math.round(metrics.minInteriorSegmentPx * 10) / 10,
  };
}

function parseRoutePoints(value) {
  if (!value) return null;
  const points = value.split(';').map((pair) => pair.split(',').map(Number));
  return points.length >= 2 && points.every(isPoint) ? points : null;
}

function collectRelationshipCrossings(arrows, includeSharedEndpoints = false) {
  const relationships = arrows.filter((arrow) => arrow.from && arrow.to && arrow.segments.length).map(arrow => ({
    ...arrow,
    // Readable-v2 routePoints come from the visible path, never its metadata.
    // A straight-through via is not a visual endpoint; preserve real bends.
    segments: includeSharedEndpoints ? arrow.routeSubpaths.flatMap(forwardCollinearAnalysisSegments) : arrow.segments,
  }));
  const crossings = [];
  for (let leftIndex = 0; leftIndex < relationships.length; leftIndex += 1) {
    const left = relationships[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < relationships.length; rightIndex += 1) {
      const right = relationships[rightIndex];
      // A shared semantic endpoint does not make an interior X a junction
      // when both paths opt into automatic workflow or independent-port checks.
      if ([left.from, left.to].some((id) => id === right.from || id === right.to)
          && !includeSharedEndpoints
          && !(left.independentPorts && right.independentPorts)
          && !(left.automaticWorkflowRoute && right.automaticWorkflowRoute)) continue;
      let point = null;
      for (const leftSegment of left.segments) {
        for (const rightSegment of right.segments) {
          point = properSegmentIntersection(leftSegment.start, leftSegment.end, rightSegment.start, rightSegment.end);
          if (point) break;
        }
        if (point) break;
      }
      if (point) crossings.push({ left, right, point });
    }
  }
  return crossings;
}

function relationshipName(arrow) {
  return arrow.id
    ? `relationship id "${arrow.id}" ("${arrow.from}" -> "${arrow.to}")`
    : `relationship "${arrow.from}" -> "${arrow.to}"`;
}

// Review evidence only. Mask rectangles are the visible node bounds emitted by
// our renderers. Skip transformed ancestry rather than mixing coordinate spaces.
function collectUntransformedNodeRects(fragment) {
  const groups = [];
  const nodes = new Map();
  for (const token of fragment.matchAll(SVG_TAG_TOKEN)) {
    if (!token[2]) continue;
    const name = token[2].toLowerCase();
    if (name === 'g') {
      if (token[1]) groups.pop();
      else if (!/\/\s*>$/.test(token[0])) groups.push(parseAttrs(token[0]));
      continue;
    }
    if (name !== 'rect' || token[1] || groups.some((group) => group.transform)) continue;
    const attrs = parseAttrs(token[0]);
    const owner = [...groups].reverse().find((group) => group['data-node-id']);
    if (!owner || attrs.transform || !String(attrs.class || '').split(/\s+/).includes('c-mask')) continue;
    const box = ['x', 'y', 'width', 'height'].map((key) => numberAttr(attrs, key));
    if (!box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) continue;
    const id = owner['data-node-id'];
    // Ambiguous ownership is not reliable evidence for moving a node.
    nodes.set(id, nodes.has(id) ? null : { id, label: owner['data-node-label'] || id, box });
  }
  return [...nodes.values()].filter(Boolean);
}

function directCorridorBlockers(relation, nodes) {
  const from = nodes.find((node) => node.id === relation.from);
  const to = nodes.find((node) => node.id === relation.to);
  if (!from || !to || from === to) return [];
  const center = ({ box: [x, y, w, h] }) => [x + w / 2, y + h / 2];
  const a = center(from);
  const b = center(to);
  const horizontal = Math.abs(a[1] - b[1]) < 0.01;
  const vertical = Math.abs(a[0] - b[0]) < 0.01;
  if (horizontal === vertical) return [];
  const axis = horizontal ? 0 : 1;
  const cross = 1 - axis;
  const [first, last] = a[axis] < b[axis] ? [from, to] : [to, from];
  const low = first.box[axis] + first.box[axis + 2];
  const high = last.box[axis];
  if (high <= low) return [];
  return nodes.filter((node) => node !== from && node !== to
    && node.box[axis] < high && node.box[axis] + node.box[axis + 2] > low
    && node.box[cross] < a[cross] && node.box[cross] + node.box[cross + 2] > a[cross]);
}

// Automatic ports need a 16px corner gutter and 14px between neighbours, so a
// side facing more counterparts than that fits pushes routes onto other sides.
function crowdedNodeSides(arrows, nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const demand = new Map();
  for (const arrow of arrows) {
    const from = byId.get(arrow.from);
    const to = byId.get(arrow.to);
    if (!from || !to || from === to) continue;
    for (const [node, other] of [[from, to], [to, from]]) {
      const [x, y, w, h] = node.box;
      const dx = other.box[0] + other.box[2] / 2 - (x + w / 2);
      const dy = other.box[1] + other.box[3] / 2 - (y + h / 2);
      const side = dx !== 0 && Math.abs(dx) >= Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy > 0 ? 'bottom' : 'top');
      const key = `${node.id}\u0000${side}`;
      const entry = demand.get(key) || { node, side, relationships: 0 };
      entry.relationships += 1;
      demand.set(key, entry);
    }
  }
  return [...demand.values()].flatMap(({ node, side, relationships }) => {
    const sidePx = side === 'left' || side === 'right' ? node.box[3] : node.box[2];
    const neededPx = 32 + 14 * (relationships - 1);
    return relationships > 1 && sidePx < neededPx
      ? [{ node: node.id, label: node.label, side, relationships, sidePx, neededPx }] : [];
  });
}

function relationshipRecord(arrow) {
  const stableIndex = Number(arrow.key);
  return {
    id: arrow.id,
    from: arrow.from,
    to: arrow.to,
    label: arrow.label || '',
    collectionIndex: Number.isInteger(stableIndex) && stableIndex >= 0 ? stableIndex : arrow.index - 1,
    artifactIndex: arrow.index,
  };
}

function collectCompositionFrames(fragment) {
  const frames = [];
  let pathIndex = 0;
  for (const match of fragment.matchAll(SVG_TAG_TOKEN)) {
    const name = match[2]?.toLowerCase();
    if (match[1] || !['rect', 'path', 'line'].includes(name)) continue;
    if (name === 'path') pathIndex += 1;
    const attrs = parseAttrs(match[0]);
    const kind = attrs['data-composition-frame-kind'];
    if (!kind) continue;
    const identity = attrs['data-composition-frame-id'] || frames.length;
    if (name === 'rect') {
      const frame = {
        kind,
        id: identity,
        x: numberAttr(attrs, 'x'),
        y: numberAttr(attrs, 'y'),
        width: numberAttr(attrs, 'width'),
        height: numberAttr(attrs, 'height'),
        radius: numberAttr(attrs, 'rx') || 0,
      };
      if ([frame.x, frame.y, frame.width, frame.height].every(Number.isFinite)) frames.push(frame);
      continue;
    }
    const segments = name === 'line'
      ? lineSegments(attrs)
      : inspectedPath(attrs, match.index, pathIndex, 'structural-frame').subpaths.flatMap(part => part.segments);
    for (const [segmentIndex, segment] of segments.entries()) {
      frames.push({
        kind,
        id: segments.length > 1 ? `${identity}:${segmentIndex}` : identity,
        shape: 'line',
        start: segment.start,
        end: segment.end,
      });
    }
  }
  return frames;
}

// Evidence for author review only. Automatic Architecture is identifiable by
// its intrinsic Reader contract; authored canvases must retain their geometry.
function collectArchitectureLeadingSpace({ svgAttrs, fragment, nodeRects, frames, arrows, labels }) {
  const evidence = { measured: false, reviewSuggested: false };
  if (svgAttrs['data-reader-fit'] !== 'intrinsic-height'
      || svgAttrs['data-reader-primary-text'] !== '14'
      || svgAttrs.transform
      || [...fragment.matchAll(/<g\b[^>]*\btransform\s*=[^>]*>/gi)]
        .some((match) => !/\bdata-semantic-sigil=/.test(match[0]))
      || /<(?:path|line|rect|text)\b[^>]*\btransform\s*=/i.test(fragment)) return evidence;
  const [originX, originY, width, height] = viewBoxRect(svgAttrs);
  if (![originX, originY, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return evidence;
  const nodeCount = [...fragment.matchAll(/<g\b[^>]*\bdata-node-id=/gi)].length;
  if (!nodeRects.length || nodeRects.length !== nodeCount) return evidence;
  const semanticArrows = arrows.filter((arrow) => arrow.from && arrow.to);
  if (semanticArrows.some((arrow) => !arrow.routeSubpaths.some(points => points.length))) return evidence;

  const occupied = nodeRects.map((node) => node.box[1]);
  for (const frame of frames) {
    const top = frame.shape === 'line'
      ? Math.min(frame.start[1], frame.end[1]) : frame.y;
    if (!Number.isFinite(top)) return evidence;
    occupied.push(top);
  }
  // Boundary titles can protrude above their structural frame.
  for (const match of fragment.matchAll(/<g\b[^>]*\bdata-graph-role="structural-frame-label"[^>]*>[\s\S]*?<rect\b[^>]*\bdata-graph-role="structural-frame-label-mask"[^>]*>/gi)) {
    const rect = parseAttrs(match[0].match(/<rect\b[^>]*>/i)?.[0] || '');
    const y = numberAttr(rect, 'y');
    if (!Number.isFinite(y)) return evidence;
    occupied.push(y);
  }
  for (const arrow of semanticArrows) {
    for (const points of arrow.routeSubpaths) for (const point of points) occupied.push(point[1]);
  }
  for (const label of labels) occupied.push(label.rect.y);
  if (!occupied.every(Number.isFinite)) return evidence;
  const occupiedTop = Math.min(...occupied);
  const gap = Math.max(0, occupiedTop - originY);
  const heights = nodeRects.map((node) => node.box[3]).sort((a, b) => a - b);
  const typicalNodeHeight = heights[Math.floor(heights.length / 2)];
  const ratio = gap / height;
  return {
    measured: true,
    emptyTopPx: Math.round(gap * 10) / 10,
    emptyTopRatio: Math.round(ratio * 1000) / 1000,
    occupiedTop: Math.round(occupiedTop * 10) / 10,
    viewBoxTop: originY,
    canvasHeight: height,
    typicalNodeHeight,
    reviewSuggested: gap > 2 * typicalNodeHeight && ratio > 0.2,
  };
}

// Advisory only: fixed columns are a compatibility contract. Measure semantic
// content, including long labels/notes, rather than treating every wide canvas
// as wasted space. Auto-sized segment frames do not add a participant column.
function collectSequenceColumnSpace({ svgAttrs, fragment, nodeRects, arrows }) {
  const columnFit = svgAttrs['data-sequence-column-fit'];
  if (!['fixed', 'spread'].includes(columnFit)) return null;
  const evidence = { measured: false, reviewSuggested: false, columnFit };
  if (svgAttrs.transform || /<tspan\b/i.test(fragment)) return evidence;
  // Brand badges stay inside their participant box. Ignore only that subtree's
  // transforms, including the preset path or nested fallback icon's scale.
  const brandGroups = [];
  for (const token of fragment.matchAll(SVG_TAG_TOKEN)) {
    if (!token[2]) continue;
    const name = token[2].toLowerCase();
    if (token[1]) {
      if (name === 'g') brandGroups.pop();
      continue;
    }
    const attrs = parseAttrs(token[0]);
    const inBrand = brandGroups.at(-1) === true || (name === 'g'
      && Boolean(attrs['data-brand-mark'])
      && String(attrs.class || '').split(/\s+/).includes('brand-mark'));
    if (!inBrand && attrs.transform && ['g', 'path', 'line', 'rect', 'text'].includes(name)
        && !(name === 'g' && attrs['data-semantic-sigil'])) return evidence;
    if (name === 'g' && !/\/\s*>$/.test(token[0])) brandGroups.push(inBrand);
  }
  const [originX, , width, height] = viewBoxRect(svgAttrs);
  if (![originX, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return evidence;
  const nodeCount = [...fragment.matchAll(/<g\b[^>]*\bdata-node-id=/gi)].length;
  if (!nodeRects.length || nodeCount !== nodeRects.length) return evidence;
  const semanticArrows = arrows.filter((arrow) => arrow.from && arrow.to);
  if (semanticArrows.some((arrow) => !arrow.routeSubpaths.some(points => points.length))) return evidence;
  const rightEdges = nodeRects.map((node) => node.box[0] + node.box[2]);
  for (const arrow of semanticArrows) {
    for (const points of arrow.routeSubpaths) for (const point of points) rightEdges.push(point[0]);
  }
  // Label plates, activations and segment titles also reserve horizontal room.
  for (const match of fragment.matchAll(/<rect\b[^>]*>/gi)) {
    const attrs = parseAttrs(match[0]);
    if (!String(attrs.class || '').split(/\s+/).includes('c-mask')) continue;
    rightEdges.push(numberAttr(attrs, 'x') + numberAttr(attrs, 'width'));
  }
  for (const match of fragment.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const box = textBox(parseAttrs(match[1]), stripTags(match[2]).trim());
    if (!box) return evidence;
    rightEdges.push(box.x2);
  }
  if (!rightEdges.every(Number.isFinite)) return evidence;
  const occupiedRight = Math.max(...rightEdges);
  const gap = Math.max(0, originX + width - occupiedRight);
  const ratio = gap / width;
  const widths = nodeRects.map((node) => node.box[2]).sort((a, b) => a - b);
  const typicalParticipantWidth = widths[Math.floor(widths.length / 2)];
  return {
    measured: true,
    columnFit,
    participantCount: nodeCount,
    occupiedRight: Math.round(occupiedRight * 10) / 10,
    viewBoxLeft: originX,
    canvasWidth: width,
    emptyRightPx: Math.round(gap * 10) / 10,
    emptyRightRatio: Math.round(ratio * 1000) / 1000,
    typicalParticipantWidth,
    // Avoid stretching a small conversation merely to fill its canvas. These
    // conservative review thresholds never contribute errors or warnings.
    reviewSuggested: columnFit === 'fixed' && nodeCount >= 4
      && gap > 2 * typicalParticipantWidth && ratio > 0.25,
  };
}

function frameName(frame) {
  return `${frame.kind || 'frame'} "${frame.id}"`;
}

function frameRecord(frame) {
  return { kind: frame.kind, id: frame.id };
}

function formatPoint(point) {
  return point.map((value) => Math.round(value * 10) / 10).join(', ');
}

function lineSegments(attrs) {
  const start = [numberAttr(attrs, 'x1'), numberAttr(attrs, 'y1')];
  const end = [numberAttr(attrs, 'x2'), numberAttr(attrs, 'y2')];
  if (!isPoint(start) || !isPoint(end)) return [];
  return [{ start, end }];
}

function diagonalStraightSegments(arrow) {
  if (arrow.authoredStraight) return [];
  return arrow.borderSegments.flatMap(({ start, end }, segmentIndex) => (
    Math.abs(start[0] - end[0]) > 0.01 && Math.abs(start[1] - end[1]) > 0.01
      ? [{ segmentIndex, start, end }]
      : []
  ));
}

function collectLegendBoxes(fragment) {
  const boxes = [];

  for (const match of fragment.matchAll(/<rect\b[^>]*>/gi)) {
    const attrs = parseAttrs(match[0]);
    const x = numberAttr(attrs, 'x');
    const y = numberAttr(attrs, 'y');
    const width = numberAttr(attrs, 'width');
    const height = numberAttr(attrs, 'height');
    if ([x, y, width, height].every(Number.isFinite)) {
      boxes.push({ x1: x, y1: y, x2: x + width, y2: y + height, label: `rect@${x},${y}` });
    }
  }

  for (const match of fragment.matchAll(/<text\b([^>]*)>([\s\S]*?)<\/text>/gi)) {
    const attrs = parseAttrs(match[1]);
    const box = textBox(attrs, stripTags(match[2]).trim());
    if (box) boxes.push(box);
  }

  return boxes;
}

function collectLegendCollisions(arrows, boxes) {
  const collisions = [];
  for (const arrow of arrows) {
    for (const segment of arrow.segments) {
      for (const box of boxes) {
        if (segmentIntersectsBox(segment, padBox(box, 2))) {
          collisions.push({ arrow, box });
        }
      }
    }
  }
  return collisions;
}

function textBox(attrs, text) {
  const x = numberAttr(attrs, 'x');
  const y = numberAttr(attrs, 'y');
  const fontSize = Number.parseFloat(attrs['font-size'] || '10');
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(fontSize)) return null;
  const width = estimatedTextWidth(text, fontSize);
  const anchor = attrs['text-anchor'] || 'start';
  let x1 = x;
  if (anchor === 'middle') x1 = x - width / 2;
  if (anchor === 'end') x1 = x - width;
  return {
    x1,
    y1: y - fontSize,
    x2: x1 + width,
    y2: y + fontSize * 0.25,
    label: text || `text@${x},${y}`,
  };
}

// A foreign artifact may author a legal non-zero viewBox origin, so containment
// needs all four numbers; sizing checks read the trailing pair.
function viewBoxRect(svgAttrs) {
  const viewBox = String(svgAttrs.viewBox || '').trim().split(/[\s,]+/).map(Number);
  return viewBox.length === 4 ? viewBox : [Number.NaN, Number.NaN, Number.NaN, Number.NaN];
}

function viewBoxSize(svgAttrs) {
  return viewBoxRect(svgAttrs).slice(2);
}

function hasAttribute(attrs, name) {
  return new RegExp('(?:^|\\s)' + name + '(?:\\s*=|\\s|$)', 'i').test(attrs);
}

function readerContractFromHtml(source) {
  const markers = [...source.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => parseAttrs(match[0]))
    .filter((attrs) => attrs.name === 'archify-reader-contract');
  return markers.length === 1 && markers[0].content === DECLARED_WIDE_READER_CONTRACT
    ? DECLARED_WIDE_READER_CONTRACT
    : null;
}

function collectDesktopReadability(svgAttrs, fragment, contract) {
  const [viewBoxWidth, viewBoxHeight] = viewBoxSize(svgAttrs);
  const requestedMinimumTextPx = Number.parseFloat(svgAttrs['data-reader-min-text'] || '');
  const entries = [];
  let invalidSemanticText = false;
  const groups = [];
  // Keep the complete ancestry, rather than a node-only stack: an edge can
  // share its context group with its label or nest that group (Sequence).
  for (const match of fragment.matchAll(/<!--[\s\S]*?(?:-->|$)|<!\[CDATA\[[\s\S]*?(?:\]\]>|$)|<text\b([^>]*)>([\s\S]*?)<\/text>|<g\b[^>]*>|<\/g\s*>/gi)) {
    if (match[0].startsWith('<!')) continue;
    if (match[1] === undefined) {
      if (/^<\/g/i.test(match[0])) groups.pop();
      else if (!/\/\s*>$/.test(match[0])) groups.push(parseAttrs(match[0]));
      continue;
    }
    const attrs = parseAttrs(match[1]);
    if (attrs['data-detail'] === 'fine' || groups.some((group) => group['data-detail'] === 'fine')) continue;
    const primary = hasAttribute(match[1], 'data-node-label');
    const boundary = hasAttribute(match[1], 'data-boundary-label');
    const context = attrs['data-detail'] === 'context'
      || groups.some((group) => group['data-detail'] === 'context');
    const nodeOwner = [...groups].reverse().find((group) => group['data-node-id']);
    const edgeOwner = [...groups].reverse().find((group) => group['data-edge-from'] && group['data-edge-to']);
    const owner = primary
      ? { kind: 'node', id: nodeOwner?.['data-node-id'] || null }
      : boundary ? { kind: 'boundary', id: null }
        : context && edgeOwner ? {
          kind: 'edge', id: edgeOwner['data-edge-id'] || null,
          from: edgeOwner['data-edge-from'], to: edgeOwner['data-edge-to'],
        }
          : context && nodeOwner ? { kind: 'node', id: nodeOwner['data-node-id'] }
            : null;
    // A context text with neither semantic owner is legend/fine/loose copy.
    if (!owner) continue;
    const fontSize = Number.parseFloat(attrs['font-size'] || '');
    if (!Number.isFinite(fontSize)) {
      invalidSemanticText = true;
      continue;
    }
    if (fontSize <= 0) invalidSemanticText = true;
    entries.push({
      ...(owner.kind === 'node' && owner.id ? { nodeId: owner.id } : {}),
      owner,
      text: stripTags(match[2]).trim(),
      detail: primary ? 'primary' : boundary ? 'boundary' : owner.kind === 'edge' ? 'edge' : 'context',
      sourceFontPx: fontSize,
    });
  }
  const minimumSourceTextPx = entries.length ? Math.min(...entries.map((entry) => entry.sourceFontPx)) : Number.NaN;
  const eligible = contract === DECLARED_WIDE_READER_CONTRACT
    && ['intrinsic-height', 'width-first'].includes(svgAttrs['data-reader-fit'])
    && Number.isFinite(requestedMinimumTextPx) && requestedMinimumTextPx > 0
    && !invalidSemanticText && entries.length > 0;
  const declared = eligible ? declaredWideReadabilityBudget({
    viewBoxWidth,
    viewBoxHeight,
    minimumSourceTextPx,
    requestedMinimumTextPx,
  }) : null;
  const availableDiagramWidth = declared?.guaranteedSvgWidth ?? DESKTOP_READER_DIAGRAM_WIDTH;
  const budgetBasis = declared ? 'recognized-declared-wide' : 'legacy-930';
  const scale = Number.isFinite(viewBoxWidth) && viewBoxWidth > 0
    ? Math.min(1, availableDiagramWidth / viewBoxWidth) : Number.NaN;
  const projected = entries.map((entry) => ({
    ...entry,
    viewBoxWidth,
    scale,
    projectedFontPx: projectedNodeTextPx(entry.sourceFontPx, viewBoxWidth, availableDiagramWidth),
  }));
  const worst = projected.reduce((current, entry) => (
    !current || entry.projectedFontPx < current.projectedFontPx ? entry : current
  ), null);
  const projectedMinimumTextPx = Number.isFinite(worst?.projectedFontPx) ? worst.projectedFontPx : null;
  const hardFloorMet = Number.isFinite(worst?.projectedFontPx)
    ? worst.projectedFontPx >= MIN_PROJECTED_NODE_TEXT_PX : null;
  const requestedTargetMet = worst && Number.isFinite(requestedMinimumTextPx)
    ? worst.projectedFontPx >= requestedMinimumTextPx : null;
  const evidence = {
    budgetBasis,
    readerContract: contract,
    availableDiagramWidth,
    actualBudgetPx: availableDiagramWidth,
    ...(declared ? {
      actualReaderWidth: declared.actualReaderWidth,
      desiredReaderWidth: declared.desiredReaderWidth,
      viewportCap: declared.viewportCap,
      limit: declared.limit,
    } : { limit: 'legacy' }),
    requestedTargetPx: Number.isFinite(requestedMinimumTextPx) ? requestedMinimumTextPx : null,
    requestedTargetMet,
    hardFloorPx: MIN_PROJECTED_NODE_TEXT_PX,
    hardFloorMet,
    minimumOwner: worst?.owner || null,
    minimumSourceTextPx: worst?.sourceFontPx ?? null,
    minimumProjectedTextPx: projectedMinimumTextPx,
    semanticTextCount: entries.length,
  };
  return { evidence, issue: worst && hardFloorMet === false ? worst : null };
}

function estimatedTextWidth(text, fontSize) {
  let units = 0;
  for (const char of text) units += char.charCodeAt(0) > 255 ? 1.8 : 0.62;
  return Math.max(fontSize, units * fontSize);
}

function properSegmentIntersection(a, b, c, d) {
  const abC = crossProduct(a, b, c);
  const abD = crossProduct(a, b, d);
  const cdA = crossProduct(c, d, a);
  const cdB = crossProduct(c, d, b);
  const epsilon = 1e-9;
  const opposite = (left, right) => (left > epsilon && right < -epsilon) || (left < -epsilon && right > epsilon);
  if (!opposite(abC, abD) || !opposite(cdA, cdB)) return null;
  const denominator = (a[0] - b[0]) * (c[1] - d[1]) - (a[1] - b[1]) * (c[0] - d[0]);
  if (Math.abs(denominator) < epsilon) return null;
  const ab = a[0] * b[1] - a[1] * b[0];
  const cd = c[0] * d[1] - c[1] * d[0];
  return [
    (ab * (c[0] - d[0]) - (a[0] - b[0]) * cd) / denominator,
    (ab * (c[1] - d[1]) - (a[1] - b[1]) * cd) / denominator,
  ];
}

function crossProduct(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segmentIntersectsBox(segment, box) {
  const { start, end } = segment;
  if (pointInsideBox(start, box) || pointInsideBox(end, box)) return true;
  const edges = [
    [[box.x1, box.y1], [box.x2, box.y1]],
    [[box.x2, box.y1], [box.x2, box.y2]],
    [[box.x2, box.y2], [box.x1, box.y2]],
    [[box.x1, box.y2], [box.x1, box.y1]],
  ];
  return edges.some(([a, b]) => segmentsIntersect(start, end, a, b));
}

function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  if (o4 === 0 && onSegment(c, b, d)) return true;
  return false;
}

function orientation(a, b, c) {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 1e-9) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return b[0] <= Math.max(a[0], c[0]) + 1e-9
    && b[0] + 1e-9 >= Math.min(a[0], c[0])
    && b[1] <= Math.max(a[1], c[1]) + 1e-9
    && b[1] + 1e-9 >= Math.min(a[1], c[1]);
}

function pointInsideBox(point, box) {
  return point[0] >= box.x1 && point[0] <= box.x2 && point[1] >= box.y1 && point[1] <= box.y2;
}

function padBox(box, padding) {
  return {
    ...box,
    x1: box.x1 - padding,
    y1: box.y1 - padding,
    x2: box.x2 + padding,
    y2: box.y2 + padding,
  };
}

// Only geometry/numeric attributes are scanned: authored prose such as node
// tags, <title> text, aria-labels, or data-* attributes may legitimately
// mention "NaN" or "Infinity" without any coordinate being non-finite.
function collectNonFiniteAttrs(svg) {
  const details = [];
  const stack = [];
  for (const match of svg.matchAll(SVG_TAG_TOKEN)) {
    if (!match[2]) continue;
    const element = match[2].toLowerCase();
    if (match[1]) {
      const index = stack.map(entry => entry.element).lastIndexOf(element);
      if (index >= 0) stack.length = index;
      continue;
    }
    const parent = stack[stack.length - 1];
    const inSvg = element === 'svg'
      || Boolean(parent?.inSvg && !SVG_HTML_INTEGRATION_POINTS.has(parent.element));
    if (inSvg) {
      for (const [name, value] of attrEntries(match[0])) {
        if (!isNumericAttr(element, name) || !NON_FINITE_TOKEN.test(decodeNumericReferences(value))) continue;
        details.push(`${match[2]} ${name}="${value}"`);
      }
    }
    // HTML void elements do not open a context; SVG self-closing tags do not
    // either. A nested <svg> inside foreignObject restores SVG checking.
    if (!(inSvg ? /\/\s*>$/.test(match[0]) : HTML_VOID_ELEMENTS.has(element))) {
      stack.push({ element, inSvg });
    }
  }
  return details;
}

function decodeNumericReferences(value) {
  // Numeric references can encode every letter of NaN/Infinity/undefined.
  // Decode once, locally: other checks and diagnostic evidence keep raw values.
  return value.replace(/&#(?:x([0-9a-f]+)|([0-9]+));?/gi, (_, hex, decimal) => {
    const point = Number.parseInt(hex || decimal, hex ? 16 : 10);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point) : '\uFFFD';
  });
}

function isNumericAttr(elementName, attrName) {
  const normalizedAttr = attrName.toLowerCase();
  return NUMERIC_ATTRS.has(normalizedAttr)
    || ELEMENT_NUMERIC_ATTRS.get(elementName.toLowerCase())?.has(normalizedAttr);
}

function attrEntries(tag) {
  return [...tag.matchAll(HTML_ATTRIBUTE)].map((match) => [
    match[1],
    match[2] ?? match[3] ?? match[4],
  ]);
}

function parseAttrs(tag) {
  return Object.fromEntries(attrEntries(tag));
}

function numberAttr(attrs, name) {
  return Number.parseFloat(attrs[name]);
}

function isPoint(point) {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);
}

function stripTags(value) {
  return value.replace(/<[^>]*>/g, '');
}
