import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { availableNodeTextWidth, fittedNodeFontSize, minimumNodeTextWidth } from '../shared/text-fit.mjs';
import { brandLabelFitWidth, brandMetadataFor, brandTopRailProblem, renderBrandMark } from '../shared/brand-marks.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import {
  asArray,
  isFinitePoint,
  rectsOverlap,
  segmentIntersectsRect,
  cleanEndpointSideProblems,
  cleanFlowProblems,
  cleanCrossingProblems,
  cleanAmbiguousCorridorProblems,
  cleanBorderRunProblems,
  cleanRouteRhythmProblems,
  cleanLabelRouteClearanceProblems,
  suggestLabelObstacleFix,
  suggestLabelPairFix,
  anchor,
  automaticPortSpread,
  defaultFromSide,
  defaultToSide,
  chosenSide,
  normalizeRoutePoints,
  routeHonorsEndpointSides,
  polylinePath,
  routePointsValue,
  labelPoint,
  arrowClassMap,
  variantAccent
} from '../shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: cognition, template, outPath } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'cognition',
  defaultExample: 'knowledge-route.cognition.json'
});

// Cognition verdicts reuse the shared palette classes so the typed viewer
// theming (classic/signal-flow/blueprint/editorial) keeps working unchanged.
const VERDICT_FILL = {
  accept: 'c-database',
  branch: 'c-cloud',
  defer: 'c-messagebus',
  reject: 'c-security',
  blindspot: 'c-external'
};
const VERDICT_TEXT = {
  accept: 't-database',
  branch: 't-cloud',
  defer: 't-messagebus',
  reject: 't-security',
  blindspot: 't-external'
};
const VERDICT_KINDS = ['accept', 'branch', 'defer', 'reject', 'blindspot'];

const layout = {
  laneX: 40,
  laneY: 52,
  laneW: 640,
  laneH: 104,
  laneGap: 20,
  laneTitleH: 30,
  colXs: [88, 220, 300, 430, 500, 625],
  nodeW: 92,
  nodeH: 52
};

const autoHeight = layout.laneY
  + (cognition.lanes?.length || 1) * layout.laneH
  + ((cognition.lanes?.length || 1) - 1) * layout.laneGap
  + 124;
const viewBox = cognition.meta?.viewBox || [720, autoHeight];

const laneIndex = new Map(asArray(cognition.lanes).map((lane, index) => [lane.id, index]));
const laneLabels = new Map(asArray(cognition.lanes).map((lane) => [lane.id, lane.label]));

function nodeContext(node) {
  return laneLabels.get(node.lane)
    || i18nText(cognition.meta.locale, 'node.context.cognition');
}

function laneTop(id) {
  return layout.laneY + laneIndex.get(id) * (layout.laneH + layout.laneGap);
}

function lastLaneBottom() {
  return layout.laneY + cognition.lanes.length * layout.laneH + (cognition.lanes.length - 1) * layout.laneGap;
}

function legendY() {
  return lastLaneBottom() + 44;
}

function measureNode(node) {
  const width = node.width || layout.nodeW;
  const height = node.height || (node.tag ? 68 : layout.nodeH);
  const cx = layout.colXs[node.col];
  const contentH = layout.laneH - layout.laneTitleH;
  const y = laneTop(node.lane) + layout.laneTitleH + (contentH - height) / 2 + (node.yOffset || 0);
  return {
    ...node,
    width,
    height,
    x: cx - width / 2,
    y,
    cx,
    cy: y + height / 2
  };
}

const nodeTextFit = {
  labelPreferred: 11,
  labelMinimum: 9,
  sublabelPreferred: 8,
  sublabelMinimum: 6,
  tagPreferred: 7,
  tagMinimum: 6,
  answerPreferred: 7,
  answerMinimum: 6,
};

const nodes = new Map(asArray(cognition.nodes).map((node) => [node.id, measureNode(node)]));

const mainPathSteps = new Map(asArray(cognition.mainPath).map((id, index) => [id, index]));
const edgeSteps = new Map(asArray(cognition.edges).map((edge, index) => {
  const fromStep = mainPathSteps.get(edge.from);
  const toStep = mainPathSteps.get(edge.to);
  const mainStep = Number.isInteger(fromStep) && toStep === fromStep + 1 ? fromStep : null;
  return [edge, mainStep ?? asArray(cognition.mainPath).length + index];
}));

function nodeStep(node) {
  return mainPathSteps.get(node.id) ?? asArray(cognition.mainPath).length + asArray(cognition.nodes).findIndex((item) => item.id === node.id);
}

function validateCognition() {
  const problems = [];
  if (cognition.schema_version !== 1) {
    problems.push('Cognition files must set "schema_version": 1.');
  }
  if (cognition.diagram_type !== 'cognition') {
    problems.push(`Unsupported diagram_type "${cognition.diagram_type}". Expected "cognition".`);
  }
  if (!cognition.meta || !cognition.meta.title) {
    problems.push('Cognition files must include meta.title.');
  }
  if (!Array.isArray(cognition.lanes) || !cognition.lanes.length) {
    problems.push('Cognition files must include at least one lane.');
  }
  if (!Array.isArray(cognition.nodes)) {
    problems.push('Cognition files must include a nodes array.');
  }
  if (!Array.isArray(cognition.edges)) {
    problems.push('Cognition files must include an edges array.');
  }
  if (cognition.mainPath !== undefined && !Array.isArray(cognition.mainPath)) {
    problems.push('Cognition "mainPath" must be an array of node ids.');
  }
  if (cognition.cards !== undefined && !Array.isArray(cognition.cards)) {
    problems.push('Cognition "cards" must be an array.');
  }
  if (problems.length) {
    throwDiagnosticProblems('Cognition layout validation failed', problems, {
      subject: { diagramType: 'cognition' },
    });
  }

  const laneIds = new Set(cognition.lanes.map((lane) => lane.id));
  if (laneIds.size !== cognition.lanes.length) {
    problems.push('Lane ids must be unique.');
  }
  if (nodes.size !== cognition.nodes.length) {
    problems.push('Node ids must be unique.');
  }

  // Cognition-specific contract: exactly one question entry, and the main
  // path is only ever built from accepted cards.
  const subjects = cognition.nodes.filter((node) => node.kind === 'subject');
  if (subjects.length !== 1) {
    problems.push(`A cognition diagram needs exactly one "subject" node (the question entry); found ${subjects.length}.`);
  }
  for (const stepId of asArray(cognition.mainPath)) {
    const node = nodes.get(stepId);
    if (node && node.verdict !== 'accept') {
      problems.push(`mainPath node "${stepId}" has verdict "${node.verdict}" — the followed route is built from "accept" nodes only.`);
    }
  }

  for (const node of nodes.values()) {
    if (!laneIds.has(node.lane)) {
      problems.push(`Node "${node.id}" uses unknown lane "${node.lane}".`);
      continue;
    }
    if (!Number.isInteger(node.col) || node.col < 0 || node.col >= layout.colXs.length) {
      problems.push(`Node "${node.id}" uses column ${node.col}, but valid columns are integers 0..${layout.colXs.length - 1}.`);
      continue;
    }
    if (!isFinitePoint(node.x, node.y, node.cx, node.cy)) {
      problems.push(`Node "${node.id}" produced non-finite coordinates — check col, width, height, and yOffset are numbers.`);
      continue;
    }
    const estLabelW = textUnits(node.label) * 6.8;
    if (estLabelW > node.width + 6) {
      problems.push(`Label "${node.label}" (~${Math.round(estLabelW)}px) is wider than node "${node.id}" (${node.width}px) — shorten the label or increase node.width.`);
    }
    const brandRailProblem = brandTopRailProblem(node, node.width, nodeTextFit.labelMinimum);
    if (brandRailProblem) problems.push(brandRailProblem);
    const availableTextW = availableNodeTextWidth(node.width);
    for (const [field, value, minimum] of [
      ['Sublabel', node.sublabel, nodeTextFit.sublabelMinimum],
      ['Tag', node.tag, nodeTextFit.tagMinimum],
    ]) {
      if (!value) continue;
      const minimumW = minimumNodeTextWidth(value, minimum);
      if (minimumW > availableTextW) {
        problems.push(`${field} "${value}" needs ~${Math.ceil(minimumW)}px at the ${minimum}px legible minimum, but node "${node.id}" provides ${availableTextW}px — shorten the ${field.toLowerCase()} or increase node.width.`);
      }
    }

    const top = laneTop(node.lane);
    const contentTop = top + layout.laneTitleH;
    const laneRight = layout.laneX + layout.laneW;
    if (node.x < layout.laneX || node.x + node.width > laneRight) {
      problems.push(`Node "${node.id}" exceeds the horizontal bounds of lane "${node.lane}".`);
    }
    if (node.y < contentTop || node.y + node.height > top + layout.laneH) {
      problems.push(`Node "${node.id}" collides with the title or boundary of lane "${node.lane}".`);
    }
  }

  for (const edge of cognition.edges) {
    if (!nodes.has(edge.from)) problems.push(`Edge "${edge.label || edge.from}" references unknown source "${edge.from}".`);
    if (!nodes.has(edge.to)) problems.push(`Edge "${edge.label || edge.to}" references unknown target "${edge.to}".`);
    if (nodes.has(edge.from) && nodes.has(edge.to)) {
      const routed = pathFor(edge);
      if (routed.points.length === 2) {
        const [start, end] = routed.points;
        const segmentLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
        if (segmentLength < 28) {
          problems.push(`Edge "${edge.from}" -> "${edge.to}" is too short (${Math.round(segmentLength)}px; minimum 28px) — drop its label or route it through a channel.`);
        }
      }
    }
  }

  problems.push(...cleanEndpointSideProblems({
    relations: cognition.edges,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'cognition',
    relationCollection: 'edges',
    fromSideFor: (edge) => edgeSides(edge).fromSide,
    toSideFor: (edge) => edgeSides(edge).toSide,
    routeHint: 'keep automatic routing, or choose fromSide/toSide and via points whose first and final segments cross node borders perpendicularly',
  }));
  problems.push(...cleanFlowProblems({
    relations: cognition.edges,
    endpointIds: new Set(nodes.keys()),
    obstacles: nodes.values(),
    pathFor,
    diagramType: 'cognition',
    relationCollection: 'edges',
    obstacleKind: 'node',
    profile: cognition.meta?.quality_profile,
    routeHint: 'adjust fromSide/toSide, set route/via or channel coordinates, or move the node to a clearer lane/column'
  }));
  problems.push(...cleanCrossingProblems({
    relations: cognition.edges,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'cognition',
    relationCollection: 'edges',
    profile: cognition.meta?.quality_profile,
    routeHint: 'adjust route/via, bias, or channel coordinates so the edges use separate lane corridors'
  }));
  problems.push(...cleanAmbiguousCorridorProblems({
    relations: cognition.edges,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'cognition',
    relationCollection: 'edges',
    profile: cognition.meta?.quality_profile,
    routeHint: 'adjust route/via, bias, or channel coordinates so unrelated edges do not visually merge'
  }));
  problems.push(...cleanBorderRunProblems({
    relations: cognition.edges,
    endpointIds: new Set(nodes.keys()),
    frames: cognitionCompositionFrames(),
    pathFor,
    diagramType: 'cognition',
    relationCollection: 'edges',
    profile: cognition.meta?.quality_profile,
    routeHint: 'adjust route/via, bias, or channel coordinates so the edge crosses the lane perpendicularly instead of following its border'
  }));
  problems.push(...cleanRouteRhythmProblems({
    relations: cognition.edges,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'cognition',
    relationCollection: 'edges',
    profile: cognition.meta?.quality_profile,
    routeHint: 'adjust route/via, bias, or channel coordinates so each turn has a readable run-up'
  }));

  // mainPath pairs need real edges, and the followed route never moves backward.
  for (let index = 0; index < asArray(cognition.mainPath).length - 1; index += 1) {
    const fromId = cognition.mainPath[index];
    const toId = cognition.mainPath[index + 1];
    const from = nodes.get(fromId);
    const to = nodes.get(toId);
    if (!from || !to) continue;
    const linked = cognition.edges.some((edge) => edge.from === fromId && edge.to === toId);
    if (!linked) {
      problems.push(`mainPath step "${fromId}" -> "${toId}" has no matching edge — add the edge or remove the pair from mainPath.`);
    }
    if (to.col < from.col) {
      problems.push(`mainPath step "${fromId}" -> "${toId}" moves backward from col ${from.col} to ${to.col} — use a return edge outside mainPath for loops.`);
    }
  }

  const labelRects = [];
  for (const [edgeIndex, edge] of cognition.edges.entries()) {
    if (!edge.label || !nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    const [lx, ly] = cognitionEdgeLabelPoint(edge, pathFor(edge).points);
    const width = Math.max(30, textUnits(edge.label) * 4.8 + 10);
    labelRects.push({ relation: edge, relationIndex: edgeIndex, label: edge.label, x: lx - width / 2, y: ly - 10, width, height: 14, lx, ly });
  }
  for (const rect of labelRects) {
    for (const node of nodes.values()) {
      if (rectsOverlap(rect, node, -2)) {
        problems.push(`Label "${rect.label}" overlaps node "${node.id}" — adjust labelDx/labelDy/labelSegment or set labelAt.\n${suggestLabelObstacleFix(rect, rect.lx, rect.ly, node, 'node')}`);
      }
    }
  }
  for (let i = 0; i < labelRects.length; i += 1) {
    for (let j = i + 1; j < labelRects.length; j += 1) {
      if (rectsOverlap(labelRects[i], labelRects[j], -2)) {
        problems.push(`Labels "${labelRects[i].label}" and "${labelRects[j].label}" overlap — adjust labelDx/labelDy or remove one label.\n${suggestLabelPairFix(labelRects[i], labelRects[j])}`);
      }
    }
  }
  problems.push(...cleanLabelRouteClearanceProblems({
    relations: cognition.edges,
    labels: labelRects,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'cognition',
    relationCollection: 'edges',
    profile: cognition.meta?.quality_profile,
  }));

  if (viewBox[0] < layout.laneX + layout.laneW + 16) {
    problems.push(`viewBox width ${viewBox[0]} clips the ${layout.laneW}px lanes — set meta.viewBox[0] to at least ${layout.laneX + layout.laneW + 16}.`);
  }
  if (legendY() + 18 > viewBox[1]) {
    problems.push(`Legend exceeds viewBox height ${viewBox[1]} — set meta.viewBox[1] to at least ${legendY() + 18}.`);
  }

  if (problems.length) {
    throwDiagnosticProblems('Cognition layout validation failed', problems, {
      subject: { diagramType: 'cognition' },
    });
  }
}

function cognitionCompositionFrames() {
  const frames = [];
  for (const [index, lane] of asArray(cognition.lanes).entries()) {
    const y = layout.laneY + index * (layout.laneH + layout.laneGap);
    frames.push({ id: `lane-${index}`, label: lane.label, kind: 'lane', x: layout.laneX, y, width: layout.laneW, height: layout.laneH, radius: 10 });
    if (lane.variant === 'exception') {
      frames.push({ id: `lane-${index}-exception`, label: `${lane.label} exception`, kind: 'exception-lane', x: layout.laneX + 6, y: y + 6, width: layout.laneW - 12, height: layout.laneH - 12, radius: 8 });
    }
  }
  return frames;
}

function gapYBetween(fromLane, toLane, bias = 0.5) {  const a = laneTop(fromLane) + layout.laneH;
  const b = laneTop(toLane);
  return a + (b - a) * bias;
}

function sameLaneAutoVia(start, end) {
  if (start[0] === end[0] || start[1] === end[1]) return [];
  const midX = (start[0] + end[0]) / 2;
  return [[midX, start[1]], [midX, end[1]]];
}

function routeClearsUnrelatedNodes(edge, points, clearance = 2) {
  const endpointIds = new Set([edge.from, edge.to]);
  for (const node of nodes.values()) {
    if (endpointIds.has(node.id)) continue;
    for (let index = 0; index < points.length - 1; index += 1) {
      if (segmentIntersectsRect({ start: points[index], end: points[index + 1] }, node, clearance)) {
        return false;
      }
    }
  }
  return true;
}

function oneBendCrossLaneVia(edge, start, end, fromSide, toSide) {
  const fromVertical = fromSide === 'top' || fromSide === 'bottom';
  const toVertical = toSide === 'top' || toSide === 'bottom';
  if (fromVertical === toVertical) return null;

  const corner = fromVertical ? [start[0], end[1]] : [end[0], start[1]];
  const points = normalizeRoutePoints([start, corner, end]);
  if (points.length !== 3 || !routeHonorsEndpointSides(points, fromSide, toSide)) return null;

  const segmentsAreReadable = points.slice(0, -1).every((point, index) => (
    Math.hypot(
      points[index + 1][0] - point[0],
      points[index + 1][1] - point[1],
    ) >= 8
  ));
  if (!segmentsAreReadable || !routeClearsUnrelatedNodes(edge, points)) return null;
  return points.slice(1, -1);
}

function automaticOneBendSides(edge, from, to) {
  const automaticRoute = !edge.via && (!edge.route || edge.route === 'auto');
  const automaticFrom = !edge.fromSide || edge.fromSide === 'auto';
  const automaticTo = !edge.toSide || edge.toSide === 'auto';
  if (!automaticRoute || !automaticFrom || !automaticTo || from.lane === to.lane) return null;
  if (from.cx === to.cx || from.cy === to.cy) return null;
  const verticalFrom = to.cy < from.cy ? 'top' : 'bottom';
  const horizontalTo = to.cx < from.cx ? 'right' : 'left';
  const horizontalFrom = to.cx < from.cx ? 'left' : 'right';
  const verticalTo = to.cy < from.cy ? 'bottom' : 'top';
  const candidates = [
    { fromSide: verticalFrom, toSide: horizontalTo },
    { fromSide: horizontalFrom, toSide: verticalTo },
  ];

  return candidates.find(({ fromSide, toSide }) => {
    const start = anchor(from, fromSide);
    const end = anchor(to, toSide);
    return oneBendCrossLaneVia(edge, start, end, fromSide, toSide);
  }) || null;
}

function routeVia(edge, from, to, start, end, fromSide, toSide) {
  if (edge.via) return edge.via;
  switch (edge.route || 'auto') {
    case 'straight':
      return [];
    case 'drop': {
      const y = gapYBetween(from.lane, to.lane, edge.bias ?? 0.5);
      return [[start[0], y], [end[0], y]];
    }
    case 'outside-right': {
      const x = edge.channelX ?? layout.laneX + layout.laneW + 12;
      return [[x, start[1]], [x, end[1]]];
    }
    case 'return-left': {
      const x = edge.channelX ?? Math.min(from.x, to.x) - 28;
      return [[x, start[1]], [x, end[1]]];
    }
    case 'bottom-channel': {
      const y = edge.channelY ?? Math.max(from.y + from.height, to.y + to.height) + 32;
      return [[start[0], y], [end[0], y]];
    }
    case 'up-channel': {
      const y = edge.channelY ?? Math.min(from.y, to.y) - 28;
      return [[start[0], y], [end[0], y]];
    }
    case 'auto':
    default: {
      if (from.lane === to.lane) return sameLaneAutoVia(start, end);
      const oneBendVia = oneBendCrossLaneVia(edge, start, end, fromSide, toSide);
      if (oneBendVia) return oneBendVia;
      const y = gapYBetween(from.lane, to.lane, edge.bias ?? 0.5);
      return [[start[0], y], [end[0], y]];
    }
  }
}

const pathCache = new Map();

function cognitionEdgeLabelPoint(edge, points) {
  if (edge.labelAt || Number.isInteger(edge.labelSegment) || points.length !== 3) {
    return labelPoint(edge, points);
  }
  const segmentLengths = [0, 1].map((index) => Math.hypot(
    points[index + 1][0] - points[index][0],
    points[index + 1][1] - points[index][1],
  ));
  const labelSegment = segmentLengths[0] >= segmentLengths[1] ? 0 : 1;
  const point = labelPoint({ ...edge, labelSegment }, points);
  if (points[labelSegment][0] === points[labelSegment + 1][0]) point[1] += 10;
  return point;
}

function edgeSides(edge) {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  const oneBendSides = automaticOneBendSides(edge, from, to);
  if (oneBendSides) return oneBendSides;
  return {
    fromSide: chosenSide(edge.fromSide, defaultFromSide(from, to)),
    toSide: chosenSide(edge.toSide, defaultToSide(from, to)),
  };
}

const automaticPorts = automaticPortSpread(cognition.edges, nodes, {
  sideFor: (edge, endpoint) => edgeSides(edge)[endpoint === 'source' ? 'fromSide' : 'toSide'],
});

function pathFor(edge) {
  if (pathCache.has(edge)) return pathCache.get(edge);
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  const ports = automaticPorts.get(edge);
  const { fromSide, toSide } = edgeSides(edge);
  const start = ports?.from || anchor(from, fromSide);
  const end = ports?.to || anchor(to, toSide);
  const points = [start, ...routeVia(edge, from, to, start, end, fromSide, toSide), end];
  const routed = { d: polylinePath(points), points };
  pathCache.set(edge, routed);
  return routed;
}

function renderLane(lane, index) {
  const y = layout.laneY + index * (layout.laneH + layout.laneGap);
  const exception = lane.variant === 'exception'
    ? `\n        <rect data-graph-role="structural-frame" data-composition-frame-kind="exception-lane" data-composition-frame-id="lane-${index}-exception" x="${layout.laneX + 6}" y="${y + 6}" width="${layout.laneW - 12}" height="${layout.laneH - 12}" rx="8" class="c-security-group" stroke-width="1"/>`
    : '';
  const labelClass = lane.variant === 'exception' ? 't-security' : 't-dim';
  const prefix = lane.variant === 'exception' ? 'EX' : String(index + 1).padStart(2, '0');
  return `        <rect data-graph-role="structural-frame" data-composition-frame-kind="lane" data-composition-frame-id="lane-${index}" x="${layout.laneX}" y="${y}" width="${layout.laneW}" height="${layout.laneH}" rx="10" class="c-lane" stroke-width="1"/>${exception}
        <text x="${layout.laneX + 14}" y="${y + 22}" class="${labelClass}" font-size="10" font-weight="600">${prefix} / ${esc(lane.label)}</text>`;
}

function renderQuestionBanner() {
  const question = cognition.meta.question;
  const verdict = cognition.meta.verdict;
  if (!question && !verdict) return '';
  const parts = [];
  if (question) {
    parts.push(`<text x="${layout.laneX + 2}" y="22" class="t-primary" font-size="10" font-style="italic" font-weight="600">Q: ${esc(question)}</text>`);
  }
  if (verdict) {
    parts.push(`<text x="${layout.laneX + layout.laneW - 2}" y="22" class="t-dim" font-size="9" font-weight="600" text-anchor="end">${esc(String(verdict))}</text>`);
  }
  return parts.join('\n');
}

function renderNode(node) {
  const fill = VERDICT_FILL[node.verdict] || 'c-external';
  const accent = VERDICT_TEXT[node.verdict] || 't-muted';
  const hasSub = node.sublabel != null && node.sublabel !== '';
  const labelFontSize = fittedNodeFontSize(node.label, brandLabelFitWidth(node, node.width), nodeTextFit.labelPreferred, nodeTextFit.labelMinimum);
  const sublabelFontSize = hasSub
    ? fittedNodeFontSize(node.sublabel, node.width, nodeTextFit.sublabelPreferred, nodeTextFit.sublabelMinimum)
    : nodeTextFit.sublabelPreferred;
  const sub = hasSub
    ? `\n          <text data-detail="context" x="${node.cx}" y="${node.y + 38}" class="t-muted" font-size="${sublabelFontSize}" text-anchor="middle">${esc(node.sublabel)}</text>`
    : '';
  // card_hit renders as a deterministic-evidence tick next to the label.
  const hitBadge = node.card_hit === true
    ? `\n          <circle cx="${node.x + node.width - 10}" cy="${node.y + 14}" r="4" class="c-database" stroke-width="1"/>`
    : '';
  // confidence drives visibility (B1): fill opacity scales with declared
  // belief, and non-unity confidence is annotated so the number is readable.
  const hasConfidence = typeof node.confidence === 'number';
  const confidenceOpacity = hasConfidence
    ? (0.55 + 0.45 * Math.max(0, Math.min(1, node.confidence))).toFixed(2)
    : '1';
  const confidenceTag = hasConfidence && node.confidence !== 1
    ? `\n          <text data-detail="confidence" x="${node.x + node.width - 6}" y="${node.y + node.height - 6}" class="t-dim" font-size="9" text-anchor="end">conf ${node.confidence}</text>`
    : '';
  // edu_level renders as a conditional-space tier tag (bottom-left, E1–E5).
  const eduTag = node.edu_level
    ? `\n          <text data-detail="edu-level" x="${node.x + 6}" y="${node.y + node.height - 6}" class="t-dim" font-size="9" text-anchor="start">${esc(String(node.edu_level))}</text>`
    : '';
  const tag = node.tag
    ? `\n          <text data-detail="fine" x="${node.cx}" y="${node.y + node.height - 12}" class="${accent}" font-size="${fittedNodeFontSize(node.tag, node.width, nodeTextFit.tagPreferred, nodeTextFit.tagMinimum)}" text-anchor="middle">${esc(node.tag)}</text>`
    : '';
  const brand = renderBrandMark(node, { x: node.x + node.width - 22, y: node.y + 6 });
  const passport = { kind: node.verdict, sublabel: node.sublabel, tag: node.tag, context: nodeContext(node), ...brandMetadataFor(node) };
  return `        <g ${focusNodeAttrs(node.id, node.label, passport, cognition.meta.locale)}>
          ${focusNodeTitle(node.label, passport)}
          <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="c-mask"/>
          <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="${fill}" fill-opacity="${confidenceOpacity}"${animateAttr(cognition.meta, 'node', nodeStep(node))} stroke-width="1.5"/>
          ${renderSemanticSigil(node.verdict, { x: node.x + 6, y: node.y + 6 })}${brand ? `\n          ${brand}` : ''}
          <text data-node-label=""${hasSub ? ' data-detail-anchor=""' : ''} x="${node.cx}" y="${node.y + 21}" class="t-primary" font-size="${labelFontSize}" font-weight="600" text-anchor="middle">${esc(node.label)}</text>${sub}${hitBadge}${confidenceTag}${eduTag}${tag}
        </g>`;
}

// Routing-hop role drives edge styling (B1): reject/defer are visually
// demoted, branch is dashed, main keeps the default solid emphasis.
const ROLE_EDGE_STYLE = {
  main: { dash: null, opacity: '1' },
  branch: { dash: '6 3', opacity: '0.9' },
  defer: { dash: '2 3', opacity: '0.6' },
  reject: { dash: '5 3', opacity: '0.45' },
};

function renderEdgePath(edge, index) {
  const [cls, marker] = arrowClassMap[edge.variant || 'default'] || arrowClassMap.default;
  const routed = pathFor(edge);
  const strokeWidth = edge.width || (edge.variant === 'emphasis' ? 1.8 : 1.4);
  const role = ROLE_EDGE_STYLE[edge.role];
  const dash = role ? ` stroke-dasharray="${role.dash}"` : '';
  const opacity = role ? ` stroke-opacity="${role.opacity}"` : '';
  return `        <path ${focusEdgeAttrs(edge.from, edge.to, edge.label, index, edge.id)} data-composition-points="${routePointsValue(routed.points)}" d="${routed.d}" class="${cls}"${animateAttr(cognition.meta, 'edge', edgeSteps.get(edge))} stroke-width="${strokeWidth}"${dash}${opacity} marker-end="url(#${marker})"/>`;
}

function renderEdgeLabel(edge, index) {
  if (!edge.label) return '';
  const routed = pathFor(edge);
  const [lx, ly] = cognitionEdgeLabelPoint(edge, routed.points);
  const labelW = Math.max(30, textUnits(edge.label) * 4.8 + 10);
  return `        <g data-detail="context" ${focusEdgeAttrs(edge.from, edge.to, edge.label, index, edge.id)}>
          <rect x="${lx - labelW / 2}" y="${ly - 10}" width="${labelW}" height="14" rx="3" class="c-mask"/>
          <text x="${lx}" y="${ly}" class="${variantAccent(edge.variant, { dashed: 't-database' })}" font-size="8" text-anchor="middle">${esc(edge.label)}</text>
        </g>`;
}

const LEGEND_CATALOG = VERDICT_KINDS.map((kind) => ({ kind, label: i18nText(cognition.meta.locale, `legend.cognition.${kind}`) }));

function renderLegend() {
  const presentKinds = new Set([...nodes.values()].map((node) => node.verdict));
  const entries = resolveLegend(cognition.meta?.legend, LEGEND_CATALOG, presentKinds);
  return renderResolvedLegend({
    entries,
    locale: cognition.meta.locale,
    layout: {
      x: 20,
      baselineY: legendY(),
      width: viewBox[0] - 40,
      fontSize: 7,
      itemGap: 7,
      minTitleY: lastLaneBottom() + 8,
      unfit: cognition.meta?.legend === undefined ? 'hide' : 'error',
      diagramType: 'cognition',
    },
    renderSwatch: (entry) => `<rect x="${entry.x}" y="${entry.baseline - 8}" width="14" height="9" rx="2" class="${VERDICT_FILL[entry.kind] || 'c-external'}" stroke-width="1"/>`,
  });
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(cognition.meta, 'cognition diagram')}>
${svgAccessibleText(cognition.meta, 'cognition')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Question banner -->
${renderQuestionBanner()}

        <!-- Knowledge domain lanes -->
${cognition.lanes.map(renderLane).join('\n\n')}

        <!-- Edge paths -->
${cognition.edges.map(renderEdgePath).join('\n')}

        <!-- Nodes -->
${[...nodes.values()].map(renderNode).join('\n\n')}

        <!-- Edge labels -->
${cognition.edges.map(renderEdgeLabel).join('\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}

validateCognition();

// Direct answers are full sentences, so they render in the viewer's card area
// instead of inside the node geometry: full text stays visible without
// distorting the routed layout.
const answerCards = cognition.nodes
  .filter((node) => node.direct_answer)
  .map((node) => ({ dot: 'emerald', title: `Direct answer · ${node.label}`, items: [node.direct_answer] }));

writeDiagram({
  outPath,
  template,
  diagramType: 'cognition',
  meta: cognition.meta,
  svg: renderSvg(),
  cards: [...asArray(cognition.cards), ...answerCards],
});
