import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { availableNodeTextWidth, fittedNodeFontSize, minimumNodeTextWidth, nodeLabelLayout } from '../shared/text-fit.mjs';
import { brandLabelFitWidth, brandMarkFor, brandMetadataFor, brandTopRailProblem, renderBrandMark } from '../shared/brand-marks.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { minimumReadableSourceTextPx } from '../shared/desktop-readability.mjs';
import { placeAutomaticLabels } from '../shared/automatic-labels.mjs';
import {
  asArray,
  isFinitePoint,
  rectsOverlap,
  cleanEndpointSideProblems,
  cleanFlowProblems,
  cleanCrossingProblems,
  cleanAmbiguousCorridorProblems,
  cleanBorderRunProblems,
  cleanRouteRhythmProblems,
  cleanLabelRouteClearanceProblems,
  cleanLabelCanvasContainmentProblems,
  suggestLabelObstacleFix,
  suggestLabelPairFix,
  anchor,
  automaticPortSpread,
  automaticPortRhythmBridge,
  segmentIntersectsRect,
  segmentRectClearanceWithin,
  routeHonorsEndpointSides,
  normalizeRoutePoints,
  legacyDefaultFromSide as defaultFromSide,
  legacyDefaultToSide as defaultToSide,
  chosenSide,
  polylinePath,
  routePointsValue,
  authoredStraightRouteAttrs,
  labelPoint,
  componentFill,
  componentText,
  arrowClassMap,
  edgeLabelAccent
} from '../shared/geometry.mjs';

const nodeTextFit = {
  sublabelPreferred: 7,
  sublabelMinimum: 6,
  tagPreferred: 7,
  tagMinimum: 6,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: dataflow, template, outPath, sourceEvidence } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'dataflow',
  defaultExample: 'product-analytics.dataflow.json'
});

const layout = {
  stageY: 46,
  stageH: 36,
  stageBottomPad: 74,
  leftX: 100,
  colGap: 215,
  stageW: 168,
  nodeW: 112,
  nodeH: 58,
  rowYs: [128, 242, 356, 470, 584],
  labelH: 16
};

// Explicit geometry preserves established node sizing, typography, height,
// routing and label placement. An omitted canvas width still fits its content
// in either profile, including authored node widths.
const qualityProfile = process.env.ARCHIFY_QUALITY_PROFILE || dataflow.meta?.quality_profile;
const automaticShowcase = qualityProfile === 'showcase'
  && dataflow.meta?.viewBox === undefined
  && !asArray(dataflow.nodes).some(node => node.width !== undefined);
const stageRight = stageX(asArray(dataflow.stages).length - 1) + layout.stageW / 2;
const nodeRights = asArray(dataflow.nodes).map(node =>
  stageX(node.stage) + (node.width || layout.nodeW) / 2).filter(Number.isFinite);
const viewBox = dataflow.meta?.viewBox || [
  Math.max(940, Math.ceil(Math.max(stageRight, ...nodeRights) + 24)),
  720,
];
const contextFontMinimum = automaticShowcase
  ? Math.max(6, Math.ceil(minimumReadableSourceTextPx(viewBox[0]) * 10) / 10)
  : 6;

function flowLabelSize(flow) {
  const longestLine = Math.max(textUnits(flow.label), textUnits(flow.classification || ''));
  return {
    width: Math.round(Math.max(34, longestLine * 4.9 + 12) * 10) / 10,
    height: flow.classification ? 27 : layout.labelH,
  };
}

function stageX(index) {
  return layout.leftX + index * layout.colGap;
}

function stageFrame(stage, index) {
  return {
    id: index,
    label: stage.label,
    kind: 'stage',
    x: stageX(index) - layout.stageW / 2,
    y: layout.stageY,
    width: layout.stageW,
    height: viewBox[1] - layout.stageY - layout.stageBottomPad,
    radius: 10,
  };
}

function measureNode(node) {
  const cx = stageX(node.stage);
  // Expand only unpinned showcase nodes, within their existing stage budget.
  // Very long text still gets an actionable error instead of an unbounded
  // canvas/typography feedback loop.
  const contextWidth = Math.max(0, ...[node.sublabel, node.tag].map(text =>
    text ? minimumNodeTextWidth(text, Math.max(7, contextFontMinimum)) + 8 : 0));
  const width = node.width || (automaticShowcase
    ? Math.max(layout.nodeW, Math.min(layout.stageW,
      (cx - 24) * 2, (viewBox[0] - 24 - cx) * 2, Math.ceil(contextWidth)))
    : layout.nodeW);
  const height = node.height || layout.nodeH;
  const y = layout.rowYs[node.row] + (node.yOffset || 0);
  return {
    ...node,
    width,
    height,
    cx,
    cy: y + height / 2,
    x: cx - width / 2,
    y
  };
}

const nodes = new Map(asArray(dataflow.nodes).map((node) => [node.id, measureNode(node)]));
const nodeSteps = new Map();
for (const [index, flow] of asArray(dataflow.flows).entries()) {
  if (!nodeSteps.has(flow.from)) nodeSteps.set(flow.from, index);
  if (!nodeSteps.has(flow.to)) nodeSteps.set(flow.to, index + 1);
}
for (const [index, node] of asArray(dataflow.nodes).entries()) {
  if (!nodeSteps.has(node.id)) nodeSteps.set(node.id, index);
}

function validateDataflow() {
  const problems = [];
  const diagnostics = [];
  if (nodes.size !== asArray(dataflow.nodes).length) problems.push('Node ids must be unique.');

  const stageCount = asArray(dataflow.stages).length;
  for (const node of nodes.values()) {
    if (typeof node.stage !== 'number' || node.stage < 0 || node.stage >= stageCount) {
      problems.push(`Node "${node.id}" uses invalid stage ${node.stage} — valid stages are 0..${stageCount - 1}.`);
    }
    if (typeof node.row !== 'number' || node.row < 0 || node.row >= layout.rowYs.length) {
      problems.push(`Node "${node.id}" uses invalid row ${node.row} — valid rows are 0..${layout.rowYs.length - 1}.`);
    }
    if (!isFinitePoint(node.x, node.y, node.cx, node.cy)) {
      problems.push(`Node "${node.id}" produced non-finite coordinates — check stage, row, width, height, and yOffset are numbers.`);
      continue;
    }
    if (node.x < 24 || node.x + node.width > viewBox[0] - 24) {
      problems.push(`Node "${node.id}" exceeds the horizontal bounds of the viewBox — reduce node.width or increase meta.viewBox[0].`);
    }
    if (node.y < layout.stageY + layout.stageH + 22 || node.y + node.height > viewBox[1] - layout.stageBottomPad) {
      problems.push(`Node "${node.id}" exceeds the readable diagram area — keep y between ${layout.stageY + layout.stageH + 22} and ${viewBox[1] - layout.stageBottomPad} (adjust row/yOffset or increase meta.viewBox[1]).`);
    }
    const estLabelW = textUnits(node.label) * 6.2;
    if (estLabelW > node.width + 6) {
      problems.push(`Label "${node.label}" (~${Math.round(estLabelW)}px) is wider than component "${node.id}" (${node.width}px) — shorten the label or increase node.width.`);
    }
    const brandRailProblem = brandTopRailProblem(node, node.width, 8);
    if (brandRailProblem) problems.push(brandRailProblem);
    // sublabel and tag render as single unwrapped <text> elements; shrink-to-fit
    // handles the ordinary case, this rejects what it cannot rescue.
    const availableTextW = availableNodeTextWidth(node.width);
    for (const [field, value, minimum] of [
      ['Sublabel', node.sublabel, contextFontMinimum],
      ['Tag', node.tag, contextFontMinimum],
    ]) {
      if (!value) continue;
      const minimumW = minimumNodeTextWidth(value, minimum);
      if (minimumW > availableTextW) {
        problems.push(`${field} "${value}" needs ~${Math.ceil(minimumW)}px at the ${minimum}px legible minimum, but node "${node.id}" provides ${availableTextW}px — shorten the ${field.toLowerCase()} or increase node.width.`);
      }
    }
  }

  const nodeList = asArray(dataflow.nodes);
  for (let i = 0; i < nodeList.length; i += 1) {
    for (let j = i + 1; j < nodeList.length; j += 1) {
      const a = nodes.get(nodeList[i].id);
      const b = nodes.get(nodeList[j].id);
      if (rectsOverlap(a, b, 10)) {
        problems.push(`Nodes "${a.id}" and "${b.id}" are less than 10px apart — move one to another stage/row or adjust yOffset.`);
      }
    }
  }

  const flowList = asArray(dataflow.flows);
  const stageById = new Map(asArray(dataflow.nodes).map((node) => [node.id, node.stage]));
  for (const flow of flowList) {
    const flowIndex = flowList.indexOf(flow);
    for (const [field, endpoint] of [['from', 'source'], ['to', 'target']]) {
      if (nodes.has(flow[field])) continue;
      const problem = `Flow "${flow.label || flow[field]}" references unknown ${endpoint} "${flow[field]}".`;
      const anchorStage = stageById.get(flow[field === 'from' ? 'to' : 'from']);
      const anchorId = flow[field === 'from' ? 'to' : 'from'];
      const stageDelta = (id) => (anchorStage === undefined || stageById.get(id) === undefined
        ? 0
        : field === 'to'
          ? stageById.get(id) - anchorStage
          : anchorStage - stageById.get(id));
      const candidates = [...stageById.keys()]
        .filter((id) => id !== anchorId)
        .sort((a, b) => {
          const da = stageDelta(a);
          const db = stageDelta(b);
          const forwardDiff = (db > 0) - (da > 0);
          return forwardDiff !== 0 ? forwardDiff : da - db;
        });
      diagnostics.push({
        code: 'dataflow/unknown-endpoint', severity: 'error', message: problem,
        subject: {
          diagramType: 'dataflow',
          flow: flow.id ?? null,
          path: `/flows/${flowIndex}/${field}`,
          from: flow.from,
          to: flow.to,
        },
        evidence: { endpoint, unknownNodeId: flow[field], availableNodeIds: candidates },
        supportedFixes: candidates.slice(0, 3).map((id) => `set /flows/${flowIndex}/${field} to verified node id "${id}"`),
      });
      problems.push(problem);
    }
    if (!flow.label) problems.push(`Flow "${flow.from}" -> "${flow.to}" must include a short data label.`);
    if (nodes.has(flow.from) && nodes.has(flow.to)) {
      const routed = pathFor(flow);
      const [start, end] = [routed.points[0], routed.points[routed.points.length - 1]];
      const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (distance < 34) problems.push(`Flow "${flow.label}" is too short (${Math.round(distance)}px; minimum 34px) — route it through a channel or spread its nodes.`);
      if (Array.isArray(flow.via)) {
        for (let segmentIndex = 0; segmentIndex < routed.points.length - 1; segmentIndex += 1) {
          const segmentStart = routed.points[segmentIndex];
          const segmentEnd = routed.points[segmentIndex + 1];
          const isDiagonal = Math.abs(segmentStart[0] - segmentEnd[0]) > 0.01
            && Math.abs(segmentStart[1] - segmentEnd[1]) > 0.01;
          if (!isDiagonal) continue;
          const viaIndex = Math.min(segmentIndex, flow.via.length - 1);
          problems.push(`Flow "${flow.label}" has a diagonal segment from (${segmentStart.join(', ')}) to (${segmentEnd.join(', ')}) — align via[${viaIndex}] with its adjacent point by sharing the same x or y coordinate.`);
        }
      }
    }
  }

  problems.push(...cleanEndpointSideProblems({
    relations: dataflow.flows,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'dataflow',
    relationCollection: 'flows',
    fromSideFor: (flow) => flowSides(flow).fromSide,
    toSideFor: (flow) => flowSides(flow).toSide,
    routeHint: 'keep automatic routing, or choose fromSide/toSide and via points whose first and final segments cross node borders perpendicularly',
  }));
  problems.push(...cleanFlowProblems({
    relations: dataflow.flows,
    obstacles: nodes.values(),
    pathFor,
    diagramType: 'dataflow',
    relationCollection: 'flows',
    obstacleKind: 'node',
    routeHint: 'adjust fromSide/toSide, set route/via or channelX/channelY, or move the node to another stage/row'
  }));
  problems.push(...cleanCrossingProblems({
    relations: dataflow.flows,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'dataflow',
    relationCollection: 'flows',
    profile: dataflow.meta?.quality_profile,
    routeHint: 'adjust route/via or channelX/channelY so the flows use separate stage corridors'
  }));
  problems.push(...cleanAmbiguousCorridorProblems({
    relations: dataflow.flows,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'dataflow',
    relationCollection: 'flows',
    profile: dataflow.meta?.quality_profile,
    routeHint: 'adjust route/via or channelX/channelY so unrelated flows do not visually merge'
  }));
  problems.push(...cleanBorderRunProblems({
    relations: dataflow.flows,
    endpointIds: new Set(nodes.keys()),
    frames: compositionFrames,
    pathFor,
    diagramType: 'dataflow',
    relationCollection: 'flows',
    profile: dataflow.meta?.quality_profile,
    routeHint: 'adjust route/via or channelX/channelY so the flow crosses the stage perpendicularly instead of following its border'
  }));
  problems.push(...cleanRouteRhythmProblems({
    relations: dataflow.flows,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'dataflow',
    relationCollection: 'flows',
    profile: dataflow.meta?.quality_profile,
    routeHint: 'adjust route/via or channelX/channelY so each turn uses a clear inter-stage corridor'
  }));

  const labelRects = resolvedLabelRects;
  for (const rect of labelRects) {
    for (const node of nodes.values()) {
      if (rectsOverlap(rect, node, -2)) {
        problems.push(`Label "${rect.label}" overlaps node "${node.id}" — adjust labelDx/labelDy/labelSegment or set labelAt.\n${suggestLabelObstacleFix(rect, rect.lx, rect.ly, node, 'node', viewBox, nodes.values())}`);
      }
    }
  }
  for (let i = 0; i < labelRects.length; i += 1) {
    for (let j = i + 1; j < labelRects.length; j += 1) {
      if (rectsOverlap(labelRects[i], labelRects[j], -2)) {
        problems.push(`Labels "${labelRects[i].label}" and "${labelRects[j].label}" overlap — adjust labelDx/labelDy.\n${suggestLabelPairFix(labelRects[i], labelRects[j])}`);
      }
    }
  }
  problems.push(...cleanLabelRouteClearanceProblems({
    relations: dataflow.flows,
    labels: labelRects,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'dataflow',
    relationCollection: 'flows',
    profile: dataflow.meta?.quality_profile,
    routeHint: 'adjust labelAt, labelDx, labelDy, or labelSegment; otherwise adjust the other flow route/via/channelX/channelY'
  }));
  problems.push(...cleanLabelCanvasContainmentProblems({
    labels: labelRects,
    viewBox,
    diagramType: 'dataflow',
    relationCollection: 'flows',
    profile: dataflow.meta?.quality_profile,
  }));

  const lastStageX = stageX(asArray(dataflow.stages).length - 1);
  if (lastStageX + layout.stageW / 2 > viewBox[0] - 24) {
    problems.push(`Stages exceed viewBox width — set meta.viewBox[0] to at least ${Math.ceil(lastStageX + layout.stageW / 2 + 24)}.`);
  }

  if (problems.length) {
    throwDiagnosticProblems('Data-flow layout validation failed', problems, {
      subject: { diagramType: 'dataflow' },
      diagnostics,
    });
  }
}

function routeVia(flow, from, to, start, end) {
  if (flow.via) return flow.via;
  switch (flow.route || 'auto') {
    case 'straight':
      return [];
    case 'vertical-channel': {
      const x = flow.channelX ?? start[0] + (end[0] > start[0] ? 44 : -44);
      return [[x, start[1]], [x, end[1]]];
    }
    case 'bottom-channel': {
      const y = flow.channelY ?? Math.max(from.y + from.height, to.y + to.height) + 26;
      return [[start[0], y], [end[0], y]];
    }
    case 'top-channel': {
      const y = flow.channelY ?? Math.min(from.y, to.y) - 24;
      return [[start[0], y], [end[0], y]];
    }
    case 'auto':
    default: {
      const { fromSide, toSide } = flowSides(flow);
      const fromVertical = fromSide === 'top' || fromSide === 'bottom';
      const toVertical = toSide === 'top' || toSide === 'bottom';
      const acrossDelta = fromVertical && toVertical
        ? Math.abs(start[0] - end[0]) : Math.abs(start[1] - end[1]);
      if (automaticShowcase && acrossDelta > 0.0001 && acrossDelta < 16) {
        // Spread ports can differ by only 7px/14px. Reuse the bounded bridge
        // rather than emit a midpoint turn below our own rhythm floor.
        const bridge = automaticPortRhythmBridge(start, end, fromSide, toSide, {
          accept: points => ![...nodes.values()].some(node => (
            node.id !== from.id && node.id !== to.id && points.slice(1).some((point, index) =>
              segmentIntersectsRect({ start: points[index], end: point }, node, 2))
          )),
        });
        if (bridge) return bridge.slice(1, -1);
      }
      if (fromVertical !== toVertical) {
        // Perpendicular sides meet at one corner when both endpoints face it;
        // otherwise each leaves through a short stub before the corner.
        const outward = { left: [-24, 0], right: [24, 0], top: [0, -24], bottom: [0, 24] };
        const stub = (point, side) => [point[0] + outward[side][0], point[1] + outward[side][1]];
        const startStub = stub(start, fromSide);
        const endStub = stub(end, toSide);
        const route = [
          [fromVertical ? [start[0], end[1]] : [end[0], start[1]]],
          [startStub, [startStub[0], endStub[1]], endStub],
          [startStub, [endStub[0], startStub[1]], endStub],
        ].find(candidate => {
          const points = normalizeRoutePoints([start, ...candidate, end]);
          return routeHonorsEndpointSides(points, fromSide, toSide)
            && ![...nodes.values()].some(node => points.slice(1).some((point, index) => (
              segmentIntersectsRect({ start: points[index], end: point }, node, 2)
              && !((node.id === from.id && index === 0) || (node.id === to.id && index === points.length - 2)))));
        });
        if (route) return route;
      }
      if (automaticShowcase && fromVertical && toVertical) {
        if (Math.abs(start[0] - end[0]) < 0.0001) return [];
        const midY = (start[1] + end[1]) / 2;
        return [[start[0], midY], [end[0], midY]];
      }
      if (Math.abs(start[1] - end[1]) < 4) return [];
      const midX = start[0] + (end[0] - start[0]) / 2;
      // Across several stages the midpoint can fall inside a middle stage's
      // node; then turn in the clear inter-stage gap nearest to it.
      const gapXs = asArray(dataflow.stages).slice(1).map((_, index) => (stageX(index) + stageX(index + 1)) / 2)
        .filter((x) => x > Math.min(start[0], end[0]) && x < Math.max(start[0], end[0]))
        .sort((left, right) => Math.abs(left - midX) - Math.abs(right - midX));
      const turnX = [midX, ...gapXs].find((x) => {
        const points = [start, [x, start[1]], [x, end[1]], end];
        return ![...nodes.values()].some((node) => node.id !== from.id && node.id !== to.id
          && points.slice(1).some((point, index) => segmentIntersectsRect({ start: points[index], end: point }, node, 2)));
      }) ?? midX;
      return [[turnX, start[1]], [turnX, end[1]]];
    }
  }
}

const pathCache = new Map();

function flowSides(flow) {
  const from = nodes.get(flow.from);
  const to = nodes.get(flow.to);
  return {
    fromSide: chosenSide(flow.fromSide, defaultFromSide(from, to)),
    toSide: chosenSide(flow.toSide, defaultToSide(from, to)),
  };
}

const automaticPorts = automaticPortSpread(dataflow.flows, nodes, {
  sideFor: (flow, endpoint) => flowSides(flow)[endpoint === 'source' ? 'fromSide' : 'toSide'],
});

function pathFor(flow) {
  if (pathCache.has(flow)) return pathCache.get(flow);
  const from = nodes.get(flow.from);
  const to = nodes.get(flow.to);
  const ports = automaticPorts.get(flow);
  const { fromSide, toSide } = flowSides(flow);
  const start = ports?.from || anchor(from, fromSide);
  const end = ports?.to || anchor(to, toSide);
  // Drop consecutive duplicate points so a purely vertical (or horizontal)
  // auto-route never emits a zero-length final segment — SVG derives
  // marker-end orientation from the last segment, and a degenerate segment
  // leaves the arrowhead angle undefined (see #169).
  const rawPoints = [start, ...routeVia(flow, from, to, start, end), end];
  const points = [];
  for (const p of rawPoints) {
    const prev = points.at(-1);
    if (!prev || Math.abs(p[0] - prev[0]) > 0.0001 || Math.abs(p[1] - prev[1]) > 0.0001) {
      points.push(p);
    }
  }
  // Guard against an all-degenerate route (e.g. start === end): keep both
  // endpoints so the path is still well-formed even if the marker is hidden.
  if (points.length < 2) points.push(end);
  const routed = { d: polylinePath(points), points };
  pathCache.set(flow, routed);
  return routed;
}

const resolvedLabelPoints = new Map();
const twoLineOcclusions = new Set();
const initialLabelRects = asArray(dataflow.flows).flatMap((flow, relationIndex) => {
  if (!flow.label || !nodes.has(flow.from) || !nodes.has(flow.to)) return [];
  const [lx, ly] = labelPoint(flow, pathFor(flow).points);
  const { width, height } = flowLabelSize(flow);
  // The shared placer uses a 10px baseline inset; Dataflow masks use 11px.
  // Adapt the baseline so it tests exactly the rectangle we later render.
  const rect = { relation: flow, relationIndex, label: flow.label,
    x: lx - width / 2, y: ly - 11, width, height, lx, ly: ly - 1 };
  // Only repair the additional footprint of an unpinned second line. A
  // single-line plate may intentionally interrupt its own route, especially
  // on a vertical segment; that established placement remains authoritative.
  if (flow.classification && !['labelAt', 'labelDx', 'labelDy', 'labelSegment'].some(key => flow[key] !== undefined)) {
    const points = pathFor(flow).points;
    const segments = points.slice(1).map((end, index) => ({ start: points[index], end }));
    if (segments.some(segment => segmentIntersectsRect(segment, rect))
      && !segments.some(segment => segmentIntersectsRect(segment, { ...rect, height: layout.labelH }))) {
      twoLineOcclusions.add(flow);
    }
  }
  return [rect];
});
// Routing depends on node geometry and canvas width, so its actual footprint
// can determine height without another copy of routeVia's preset rules.
const geometryBottom = Math.max(0,
  ...[...nodes.values()].map(node => node.y + node.height),
  ...asArray(dataflow.flows).flatMap(flow => nodes.has(flow.from) && nodes.has(flow.to)
    ? pathFor(flow).points.map(point => point[1]) : []));
function heightForLabels(labels) {
  const contentBottom = Math.max(geometryBottom, ...labels.map(rect => rect.y + rect.height));
  return Math.max(360, Math.ceil(contentBottom + 24 + layout.stageBottomPad));
}
if (automaticShowcase) viewBox[1] = heightForLabels(initialLabelRects);
const compositionFrames = asArray(dataflow.stages).map(stageFrame);

const resolvedLabelRects = (automaticShowcase ? placeAutomaticLabels({
  labels: initialLabelRects,
  routes: asArray(dataflow.flows).flatMap((flow, relationIndex) => (
    nodes.has(flow.from) && nodes.has(flow.to)
      ? [{ relationIndex, points: pathFor(flow).points }] : []
  )),
  components: [...nodes.values()],
  titles: compositionFrames.map(frame => ({ ...frame, height: layout.stageH })),
  viewBox,
  placementBottom: viewBox[1] - layout.stageBottomPad,
}) : initialLabelRects).map(rect => {
  // Dataflow has compact 16px plates. Permit one clearance gutter beyond
  // two plate heights (36px), which covers a label immediately above a node,
  // while rejecting a collision-free island far from the labelled route.
  const ownPoints = pathFor(rect.relation).points;
  const nearby = ownPoints.slice(1).some((point, index) =>
    segmentRectClearanceWithin({ start: ownPoints[index], end: point }, rect, 36) <= 36);
  const original = initialLabelRects.find(label => label.relation === rect.relation);
  const kept = nearby ? rect : original;
  const resolved = { ...kept, ly: kept.ly + 1 };
  if (automaticShowcase) resolvedLabelPoints.set(rect.relation, [resolved.lx, resolved.ly]);
  return resolved;
});

// The ordinary shared placer allows a plate to interrupt its own connector.
// For the second-line defect above, keep the complete plate beside the route
// instead. This local search freezes all other labels and authored geometry,
// and uses the same node/title/label/other-route checks as ordinary placement.
for (const [index, rect] of resolvedLabelRects.entries()) {
  if (!twoLineOcclusions.has(rect.relation)) continue;
  const ownPoints = pathFor(rect.relation).points;
  if (!ownPoints.slice(1).some((end, segmentIndex) => segmentIntersectsRect({ start: ownPoints[segmentIndex], end }, rect))) continue;
  const original = initialLabelRects.find(label => label.relation === rect.relation);
  const extraHeight = original.height - layout.labelH;
  const preferred = { ...original, y: original.y - extraHeight, ly: original.ly - extraHeight };
  const ownRouteBands = ownPoints.slice(1).map((end, segmentIndex) => {
    const start = ownPoints[segmentIndex];
    return {
      x: Math.min(start[0], end[0]) - 2, y: Math.min(start[1], end[1]) - 2,
      width: Math.abs(end[0] - start[0]) + 4, height: Math.abs(end[1] - start[1]) + 4,
    };
  });
  const labels = resolvedLabelRects.map((other, otherIndex) => otherIndex === index ? preferred : {
    ...other, ly: other.ly - 1,
    relation: { ...other.relation, labelAt: [other.lx, other.ly] },
  });
  const routes = asArray(dataflow.flows).flatMap((flow, relationIndex) => (
    nodes.has(flow.from) && nodes.has(flow.to) ? [{ relationIndex, points: pathFor(flow).points }] : []
  ));
  const titles = compositionFrames.map(frame => ({ ...frame, height: layout.stageH }));
  const replacement = placeAutomaticLabels({
    labels, routes,
    components: [...nodes.values(), ...ownRouteBands],
    titles,
    viewBox,
    placementBottom: viewBox[1] - layout.stageBottomPad,
    keepFallbackNearRoute: true,
  })[index];
  // An exhausted shared search returns its supplied preferred rect. That is
  // not proof of a safe replacement: preserve the previously accepted label
  // if the complete footprint cannot fit near its connector without collisions.
  const clear = replacement.x >= 0 && replacement.y >= 0
    && replacement.x + replacement.width <= viewBox[0]
    && replacement.y + replacement.height <= viewBox[1] - layout.stageBottomPad
    && ![...nodes.values(), ...titles].some(obstacle => rectsOverlap(replacement, obstacle, 2))
    && !resolvedLabelRects.some((other, otherIndex) => otherIndex !== index && rectsOverlap(replacement, other, 2))
    && routes.every(route => route.points.slice(1).every((end, segmentIndex) => (
      segmentRectClearanceWithin({ start: route.points[segmentIndex], end }, replacement, 4) >= 4
    )))
    && ownPoints.slice(1).some((end, segmentIndex) => (
      segmentRectClearanceWithin({ start: ownPoints[segmentIndex], end }, replacement, 36) <= 36
    ));
  if (!clear) continue;
  const resolved = { ...replacement, ly: replacement.ly + 1 };
  resolvedLabelRects[index] = resolved;
  resolvedLabelPoints.set(rect.relation, [resolved.lx, resolved.ly]);
}

// A bounded label move may extend below the initial route footprint. Include
// its final rendered plate before drawing the stage frames and legend.
if (automaticShowcase) {
  viewBox[1] = heightForLabels(resolvedLabelRects);
  for (const frame of compositionFrames) frame.height = viewBox[1] - layout.stageY - layout.stageBottomPad;
}

// Header measurement follows 276970789's #257, including the ordinal.
// Long titles wrap at the same legible floor instead of becoming invalid input.
function stageHeaderText(stage, index) {
  return `${String(index + 1).padStart(2, '0')} / ${stage.label}`;
}

function renderStageHeader(stage, index, cx) {
  const text = stageHeaderText(stage, index);
  const font = fittedNodeFontSize(text, layout.stageW, 9, 7);
  const available = availableNodeTextWidth(layout.stageW);
  const open = `<text x="${cx}" y="${layout.stageY + 22}" class="t-dim" font-size="${font}" font-weight="600" text-anchor="middle">`;
  if (minimumNodeTextWidth(text, font) <= available) return `${open}${esc(text)}</text>`;
  const lines = [];
  let line = '';
  // Prefer word boundaries; split oversized words and CJK by grapheme, without
  // dropping whitespace or splitting a combining character/emoji sequence.
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const word of text.match(/\s+|\S+/gu) || []) {
    if (line && minimumNodeTextWidth(line + word, font) > available) {
      lines.push(line); line = '';
    }
    for (const { segment } of segmenter.segment(word)) {
      if (line && minimumNodeTextWidth(line + segment, font) > available) {
        lines.push(line); line = '';
      }
      line += segment;
    }
  }
  if (line) lines.push(line);
  // Explicit node geometry is authoritative. Do not turn an old horizontal
  // overflow into a new collision with nodes when the header area is packed.
  const firstNodeY = Math.min(...[...nodes.values()].filter(node => node.stage === index).map(node => node.y),
    viewBox[1] - layout.stageBottomPad);
  const lastLineBottom = layout.stageY + 22 + (lines.length - 1) * (font + 4) + font * 0.3;
  if (lastLineBottom > firstNodeY - 4) return `${open}${esc(text)}</text>`;
  const content = lines.length === 1 ? esc(text) : lines.map((line, i) =>
    `<tspan x="${cx}" dy="${i ? font + 4 : 0}">${esc(line)}</tspan>`).join('');
  return `${open}${content}</text>`;
}

function renderStage(stage, index) {
  const frame = compositionFrames[index];
  const cx = stageX(index);
  return `        <rect data-graph-role="structural-frame" data-composition-frame-kind="stage" data-composition-frame-id="${index}" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}" class="c-lane" stroke-width="1"/>
        ${renderStageHeader(stage, index, cx)}`;
}

function renderNode(node) {
  const fill = componentFill[node.type] || 'c-external';
  const accent = componentText[node.type] || 't-muted';
  const hasSub = node.sublabel != null && node.sublabel !== '';
  const labelFontSize = fittedNodeFontSize(node.label, brandLabelFitWidth(node, node.width), 10, 8);
  const sublabelFontSize = fittedNodeFontSize(node.sublabel, node.width, Math.max(nodeTextFit.sublabelPreferred, contextFontMinimum), contextFontMinimum);
  const tagFontSize = fittedNodeFontSize(node.tag, node.width, Math.max(nodeTextFit.tagPreferred, contextFontMinimum), contextFontMinimum);
  const textRows = [{ text: node.label, font: labelFontSize, y: 21 }];
  if (hasSub) textRows.push({ text: node.sublabel, font: sublabelFontSize, y: 37 });
  if (node.tag) textRows.push({ text: node.tag, font: tagFontSize, y: node.height - 11 });
  const labelLayout = nodeLabelLayout({ width: node.width, height: node.height, rows: textRows,
    brand: Boolean(brandMarkFor(node)), source: Boolean(sourceEvidence?.nodes?.[node.id]?.length) });
  const sub = hasSub
    ? `\n          <text data-detail="context" x="${node.cx}" y="${node.y + labelLayout.ys[1]}" class="t-muted" font-size="${sublabelFontSize}" text-anchor="middle">${esc(node.sublabel)}</text>`
    : '';
  const tag = node.tag
    ? `\n        <text data-detail="fine" x="${node.cx}" y="${node.y + labelLayout.ys[hasSub ? 2 : 1]}" class="${accent}" font-size="${tagFontSize}" text-anchor="middle">${esc(node.tag)}</text>`
    : '';
  const stage = asArray(dataflow.stages)[node.stage];
  const context = stage
    ? `${String(node.stage + 1).padStart(2, '0')} / ${stage.label}`
    : i18nText(dataflow.meta.locale, 'node.context.dataflow');
  const brand = renderBrandMark(node, { x: node.x + node.width - 22, y: node.y + 6 });
  const passport = { kind: node.type, sublabel: node.sublabel, tag: node.tag, context, ...brandMetadataFor(node) };
  return `        <g ${focusNodeAttrs(node.id, node.label, passport, dataflow.meta.locale)}>
          ${focusNodeTitle(node.label, passport)}
          <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="c-mask"/>
          <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="${fill}"${animateAttr(dataflow.meta, 'node', nodeSteps.get(node.id))} stroke-width="1.5"/>
          ${renderSemanticSigil(node.type, { icon: node.icon, x: node.x + 6, y: node.y + labelLayout.sigilY, size: labelLayout.sigilSize })}${brand ? `\n          ${brand}` : ''}
          <text data-node-label=""${hasSub ? ' data-detail-anchor=""' : ''} x="${node.x + labelLayout.x}" y="${node.y + labelLayout.ys[0]}" class="t-primary" font-size="${labelFontSize}" font-weight="600" text-anchor="middle">${esc(node.label)}</text>${sub}${tag}
        </g>`;
}

function renderFlowPath(flow, index) {
  const [cls, marker] = arrowClassMap[flow.variant || 'default'] || arrowClassMap.default;
  const routed = pathFor(flow);
  const strokeWidth = flow.width || (flow.variant === 'emphasis' ? 1.8 : 1.4);
  return `        <path ${focusEdgeAttrs(flow.from, flow.to, flow.label, index, flow.id)} data-composition-points="${routePointsValue(routed.points)}"${authoredStraightRouteAttrs(flow, routed.points)} d="${routed.d}" class="${cls}"${animateAttr(dataflow.meta, 'edge', index)} stroke-width="${strokeWidth}" marker-end="url(#${marker})"/>`;
}

function renderFlowLabel(flow, index) {
  const routed = pathFor(flow);
  const [lx, ly] = resolvedLabelPoints.get(flow) || labelPoint(flow, routed.points);
  const { width: labelW, height: labelH } = flowLabelSize(flow);
  const classification = flow.classification
    ? `\n        <text data-detail="fine" x="${lx}" y="${ly + 11}" class="t-dim" font-size="7" text-anchor="middle">${esc(flow.classification)}</text>`
    : '';
  return `        <g data-detail="context" ${focusEdgeAttrs(flow.from, flow.to, flow.label, index, flow.id)}>
          <rect x="${lx - labelW / 2}" y="${ly - 11}" width="${labelW}" height="${labelH}" rx="4" class="c-mask"/>
          <text x="${lx}" y="${ly}" class="${edgeLabelAccent(flow.variant)}" font-size="8" text-anchor="middle">${esc(flow.label)}</text>${classification}
        </g>`;
}

const LEGEND_CATALOG = [
  { kind: 'emphasis', className: 'a-emphasis', marker: 'arrowhead-emphasis', strokeWidth: 1.8, swatchWidth: 34, swatchGap: 9, interactive: false },
  { kind: 'security', className: 'a-security', marker: 'arrowhead-security', swatchWidth: 34, swatchGap: 9, interactive: false },
  { kind: 'dashed', className: 'a-dashed', marker: 'arrowhead-dashed', swatchWidth: 34, swatchGap: 9, interactive: false },
  { kind: 'database' },
  { kind: 'default', className: 'a-default', marker: 'arrowhead', swatchWidth: 34, swatchGap: 9, interactive: false },
].map((entry) => ({
  ...entry,
  label: i18nText(dataflow.meta.locale, `legend.dataflow.${entry.kind}`),
}));

function renderLegend() {
  const presentKinds = new Set(asArray(dataflow.flows).map((flow) => flow.variant || 'default'));
  if ([...nodes.values()].some((node) => node.type === 'database')) presentKinds.add('database');
  const entries = resolveLegend(dataflow.meta?.legend, LEGEND_CATALOG, presentKinds);
  return renderResolvedLegend({
    entries,
    locale: dataflow.meta.locale,
    layout: {
      x: 40,
      baselineY: viewBox[1] - 36,
      width: viewBox[0] - 80,
      minTitleY: viewBox[1] - 66,
      unfit: dataflow.meta?.legend === undefined ? 'hide' : 'error',
      diagramType: 'dataflow',
    },
    renderSwatch: (entry) => entry.kind === 'database'
      ? `<rect x="${entry.x}" y="${entry.baseline - 8}" width="14" height="9" rx="2" class="c-database" stroke-width="1"/>`
      : `<path d="M ${entry.x} ${entry.baseline - 3} L ${entry.x + 34} ${entry.baseline - 3}" class="${entry.className}" stroke-width="${entry.strokeWidth || 1.4}" marker-end="url(#${entry.marker})"/>`,
  });
}

function renderSvg() {
  // Same default-canvas contract as lifecycle: 940x720 is below the 1.55 wide
  // ratio, so without intrinsic-height the desktop Reader can neither narrow
  // nor scroll it and every default dataflow fails the browser gate.
  const readerFit = dataflow.meta?.viewBox ? '' : ' data-reader-fit="intrinsic-height"';
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}"${readerFit} ${svgRootAttrs(dataflow.meta)}>
${svgAccessibleText(dataflow.meta, 'dataflow')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Data Stages -->
${dataflow.stages.map(renderStage).join('\n\n')}

        <!-- Flow paths -->
${asArray(dataflow.flows).map(renderFlowPath).join('\n')}

        <!-- Nodes -->
${[...nodes.values()].map(renderNode).join('\n\n')}

        <!-- Flow labels -->
${asArray(dataflow.flows).map(renderFlowLabel).join('\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}

validateDataflow();
writeDiagram({
  outPath,
  template,
  diagramType: 'dataflow',
  meta: dataflow.meta,
  svg: renderSvg(),
  cards: dataflow.cards,
  sourceEvidence,
});
