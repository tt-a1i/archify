import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import {
  componentBox,
  connectionPath,
  emitResolvedLayoutReport,
  relationshipLabelBox,
  resolvedLayoutReport,
} from '../shared/layout-report.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { relationshipLabelContainmentIssues } from '../shared/viewbox-containment.mjs';
import { resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { availableNodeTextWidth, fittedNodeFontSize, minimumNodeTextWidth } from '../shared/text-fit.mjs';
import { maximumReadableViewBoxWidth } from '../shared/desktop-readability.mjs';
import { brandLabelFitWidth, brandMetadataFor, brandTopRailProblem, renderBrandMark } from '../shared/brand-marks.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import {
  asArray,
  isFinitePoint,
  rectsOverlap,
  entityOverlapIssue,
  relationshipLabelObstacleIssue,
  relationshipLabelPairIssue,
  cleanEndpointSideProblems,
  cleanFlowProblems,
  cleanCrossingProblems,
  cleanAmbiguousCorridorProblems,
  cleanBorderRunProblems,
  cleanRouteRhythmProblems,
  cleanLabelRouteClearanceProblems,
  anchor,
  automaticPortSpread,
  dedupeRoutePoints,
  normalizeRoutePoints,
  markerSafeRoutePoints,
  markerEndpointSetback,
  defaultFromSide,
  defaultToSide,
  chosenSide,
  polylinePath,
  routePointsValue,
  labelPoint,
  componentFill,
  componentText,
  arrowClassMap,
  variantAccent
} from '../shared/geometry.mjs';

const nodeTextFit = {
  sublabelPreferred: 7,
  sublabelMinimum: 6,
  tagPreferred: 7,
  tagMinimum: 6,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: dataflow, template, outPath } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'dataflow',
  defaultExample: 'product-analytics.dataflow.json',
  argv: cliArgs,
});

const viewBox = dataflow.meta?.viewBox || [940, 720];
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

const compositionFrames = asArray(dataflow.stages).map(stageFrame);

function measureNode(node) {
  const width = node.width || layout.nodeW;
  const height = node.height || layout.nodeH;
  const cx = stageX(node.stage);
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
const nodeInputIndexes = new Map(asArray(dataflow.nodes).map((node, index) => [node.id, index]));
const nodeSteps = new Map();
for (const [index, flow] of asArray(dataflow.flows).entries()) {
  if (!nodeSteps.has(flow.from)) nodeSteps.set(flow.from, index);
  if (!nodeSteps.has(flow.to)) nodeSteps.set(flow.to, index + 1);
}
for (const [index, node] of asArray(dataflow.nodes).entries()) {
  if (!nodeSteps.has(node.id)) nodeSteps.set(node.id, index);
}

function dataflowLayoutConstraints() {
  const stageCount = asArray(dataflow.stages).length;
  const minViewBoxWidth = stageCount
    ? Math.ceil(stageX(stageCount - 1) + layout.stageW / 2 + 24)
    : null;
  const readableText = [];
  for (const node of nodes.values()) {
    const nodeIndex = nodeInputIndexes.get(node.id);
    if (!Number.isInteger(nodeIndex) || !Number.isFinite(node.width)) continue;
    const labelFont = fittedNodeFontSize(node.label, brandLabelFitWidth(node, node.width), 10, 8);
    readableText.push({
      path: `/nodes/${nodeIndex}/label`,
      id: node.id,
      text: node.label,
      sourceFontPx: labelFont,
      maxReadableViewBoxWidth: maximumReadableViewBoxWidth(labelFont),
    });
    if (node.sublabel) {
      const sourceFontPx = fittedNodeFontSize(
        node.sublabel,
        node.width,
        nodeTextFit.sublabelPreferred,
        nodeTextFit.sublabelMinimum,
      );
      readableText.push({
        path: `/nodes/${nodeIndex}/sublabel`,
        id: node.id,
        text: node.sublabel,
        sourceFontPx,
        maxReadableViewBoxWidth: maximumReadableViewBoxWidth(sourceFontPx),
      });
    }
  }
  const limitingText = readableText
    .filter((entry) => Number.isFinite(entry.maxReadableViewBoxWidth))
    .sort((left, right) => (
      left.maxReadableViewBoxWidth - right.maxReadableViewBoxWidth
      || left.path.localeCompare(right.path)
    ))[0] || null;
  return {
    minViewBoxWidth,
    maxReadableViewBoxWidth: limitingText
      ? Math.round(limitingText.maxReadableViewBoxWidth * 1000) / 1000
      : null,
    limitingText,
  };
}

function validateDataflow() {
  const problems = [];
  if (nodes.size !== asArray(dataflow.nodes).length) problems.push('Node ids must be unique.');

  const stageCount = asArray(dataflow.stages).length;
  for (const node of nodes.values()) {
    const nodeIndex = nodeInputIndexes.get(node.id);
    if (typeof node.stage !== 'number' || node.stage < 0 || node.stage >= stageCount) {
      problems.push({
        code: 'layout/dataflow-node-stage',
        message: `Node "${node.id}" uses invalid stage ${node.stage} — valid stages are 0..${stageCount - 1}.`,
        subject: {
          path: `/nodes/${nodeIndex}/stage`,
          id: node.id,
        },
        evidence: {
          currentStage: node.stage,
          allowedStage: { min: 0, max: stageCount - 1 },
        },
        supportedFixes: [`set /nodes/${nodeIndex}/stage to an integer between 0 and ${stageCount - 1}`],
      });
      continue;
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
      problems.push(`Label "${node.label}" (~${Math.round(estLabelW)}px) is wider than node "${node.id}" (${node.width}px) — shorten the label or increase node.width.`);
    }
    const brandRailProblem = brandTopRailProblem(node, node.width, 8);
    if (brandRailProblem) problems.push(brandRailProblem);
    // sublabel and tag render as single unwrapped <text> elements; shrink-to-fit
    // handles the ordinary case, this rejects what it cannot rescue.
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
  }

  const nodeList = asArray(dataflow.nodes);
  for (let i = 0; i < nodeList.length; i += 1) {
    for (let j = i + 1; j < nodeList.length; j += 1) {
      const a = nodes.get(nodeList[i].id);
      const b = nodes.get(nodeList[j].id);
      if (rectsOverlap(a, b, 10)) {
        problems.push(entityOverlapIssue({
          diagramType: 'dataflow',
          collection: 'nodes',
          entity: b,
          entityIndex: j,
          otherEntity: a,
          otherEntityIndex: i,
          minimumGapPx: 10,
          controls: ['stage', 'row', 'yOffset'],
        }));
      }
    }
  }

  for (const [flowIndex, flow] of asArray(dataflow.flows).entries()) {
    if (!nodes.has(flow.from)) problems.push(`Flow "${flow.label || flow.from}" references unknown source "${flow.from}".`);
    if (!nodes.has(flow.to)) problems.push(`Flow "${flow.label || flow.to}" references unknown target "${flow.to}".`);
    if (!flow.label) problems.push(`Flow "${flow.from}" -> "${flow.to}" must include a short data label.`);
    if (nodes.has(flow.from) && nodes.has(flow.to)) {
      const routed = pathFor(flow);
      if (routed.points.length < 2 || routed.points.some((point) => !isFinitePoint(...point))) {
        problems.push({
          code: 'layout/degenerate-route',
          message: `Flow "${flow.label || `${flow.from} -> ${flow.to}`}" collapses to fewer than two finite route points — repair the endpoint node geometry or provide a finite route/via channel.`,
          subject: {
            diagramType: 'dataflow',
            collection: 'flows',
            index: flowIndex,
            path: `/flows/${flowIndex}`,
            ...(flow.id ? { id: flow.id } : {}),
            from: flow.from,
            to: flow.to,
          },
          evidence: { points: routed.points },
          supportedFixes: [
            'repair non-finite stage, row, width, height, or yOffset values on the endpoint nodes',
            'provide at least two finite points using fromSide/toSide, via, or a named channel route',
          ],
        });
        continue;
      }
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
    checkResolvedRouteSides: true,
    endpointFor: (id) => nodes.get(id),
    markerSetbackFor: (flow) => markerEndpointSetback({
      strokeWidth: flow.width || (flow.variant === 'emphasis' ? 1.8 : 1.4),
    }),
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

  const labelRects = [];
  for (const [flowIndex, flow] of asArray(dataflow.flows).entries()) {
    if (!flow.label || !nodes.has(flow.from) || !nodes.has(flow.to)) continue;
    const points = pathFor(flow).points;
    if (points.length < 2 || points.some((point) => !isFinitePoint(...point))) continue;
    const [lx, ly] = labelPoint(flow, points);
    const { width, height } = flowLabelSize(flow);
    labelRects.push({ relation: flow, relationIndex: flowIndex, label: flow.label, x: lx - width / 2, y: ly - 11, width, height, lx, ly });
  }
  for (const rect of labelRects) {
    for (const node of nodes.values()) {
      if (rectsOverlap(rect, node, -2)) {
        problems.push(relationshipLabelObstacleIssue({
          diagramType: 'dataflow',
          relationCollection: 'flows',
          relation: rect.relation,
          relationIndex: rect.relationIndex,
          labelRect: rect,
          obstacleCollection: 'nodes',
          obstacle: node,
          obstacleIndex: nodeInputIndexes.get(node.id),
          avoidRects: [...nodes.values()],
          viewBox,
        }));
      }
    }
  }
  for (let i = 0; i < labelRects.length; i += 1) {
    for (let j = i + 1; j < labelRects.length; j += 1) {
      if (rectsOverlap(labelRects[i], labelRects[j], -2)) {
        problems.push(relationshipLabelPairIssue({
          diagramType: 'dataflow',
          relationCollection: 'flows',
          labelRect: labelRects[j],
          otherLabelRect: labelRects[i],
          avoidRects: [
            ...nodes.values(),
            ...labelRects.filter((entry) => entry !== labelRects[j]),
          ],
          viewBox,
        }));
      }
    }
  }
  problems.push(...relationshipLabelContainmentIssues({
    labels: labelRects,
    viewBox,
    diagramType: 'dataflow',
    relationCollection: 'flows',
  }));
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

  const lastStageX = stageX(asArray(dataflow.stages).length - 1);
  if (lastStageX + layout.stageW / 2 > viewBox[0] - 24) {
    problems.push(`Stages exceed viewBox width — set meta.viewBox[0] to at least ${Math.ceil(lastStageX + layout.stageW / 2 + 24)}.`);
  }

  if (problems.length) {
    throwDiagnosticProblems('Data-flow layout validation failed', problems, {
      subject: { diagramType: 'dataflow' },
    });
  }
}

function verticalChannelX(flow, from, to) {
  if (Number.isFinite(flow.channelX)) return flow.channelX;
  const fromCx = from.x + from.width / 2;
  const toCx = to.x + to.width / 2;
  const direction = toCx >= fromCx ? 1 : -1;
  return fromCx + direction * (from.width / 2 + 44);
}

function sideFacingPoint(rect, point, fallback) {
  if (!Array.isArray(point) || point.length !== 2) return fallback;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = point[0] - cx;
  const dy = point[1] - cy;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

function routeVia(flow, from, to, start, end) {
  if (flow.via) return flow.via;
  switch (flow.route || 'auto') {
    case 'straight':
      return [];
    case 'vertical-channel': {
      const x = verticalChannelX(flow, from, to);
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
      if (Math.abs(start[1] - end[1]) < 4) return [];
      const midX = start[0] + (end[0] - start[0]) / 2;
      return [[midX, start[1]], [midX, end[1]]];
    }
  }
}

const pathCache = new Map();

function flowSides(flow) {
  const from = nodes.get(flow.from);
  const to = nodes.get(flow.to);
  const explicitVia = asArray(flow.via);
  if (explicitVia.length) {
    return {
      fromSide: chosenSide(flow.fromSide, sideFacingPoint(from, explicitVia[0], defaultFromSide(from, to))),
      toSide: chosenSide(flow.toSide, sideFacingPoint(to, explicitVia.at(-1), defaultToSide(from, to))),
    };
  }
  if (flow.route === 'vertical-channel') {
    const channelX = verticalChannelX(flow, from, to);
    return {
      fromSide: chosenSide(flow.fromSide, channelX >= from.x + from.width / 2 ? 'right' : 'left'),
      toSide: chosenSide(flow.toSide, channelX >= to.x + to.width / 2 ? 'right' : 'left'),
    };
  }
  const channelSide = flow.route === 'bottom-channel'
    ? 'bottom'
    : flow.route === 'top-channel'
      ? 'top'
      : null;
  return {
    fromSide: chosenSide(flow.fromSide, channelSide || defaultFromSide(from, to)),
    toSide: chosenSide(flow.toSide, channelSide || defaultToSide(from, to)),
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
  const rawPoints = [start, ...routeVia(flow, from, to, start, end), end];
  const points = flow.via ? dedupeRoutePoints(rawPoints) : normalizeRoutePoints(rawPoints);
  const strokeWidth = flow.width || (flow.variant === 'emphasis' ? 1.8 : 1.4);
  const routed = { d: polylinePath(markerSafeRoutePoints(points, { strokeWidth })), points };
  pathCache.set(flow, routed);
  return routed;
}

function renderStage(stage, index) {
  const frame = compositionFrames[index];
  const cx = stageX(index);
  return `        <rect data-graph-role="structural-frame" data-composition-frame-kind="stage" data-composition-frame-id="${index}" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" rx="${frame.radius}" class="c-lane" stroke-width="1"/>
        <text x="${cx}" y="${layout.stageY + 22}" class="t-dim" font-size="9" font-weight="600" text-anchor="middle">${String(index + 1).padStart(2, '0')} / ${esc(stage.label)}</text>`;
}

function renderNode(node) {
  const fill = componentFill[node.type] || 'c-external';
  const accent = componentText[node.type] || 't-muted';
  const hasSub = node.sublabel != null && node.sublabel !== '';
  const sub = hasSub
    ? `\n          <text data-detail="context" x="${node.cx}" y="${node.y + 37}" class="t-muted" font-size="${fittedNodeFontSize(node.sublabel, node.width, nodeTextFit.sublabelPreferred, nodeTextFit.sublabelMinimum)}" text-anchor="middle">${esc(node.sublabel)}</text>`
    : '';
  const tag = node.tag
    ? `\n        <text data-detail="fine" x="${node.cx}" y="${node.y + node.height - 11}" class="${accent}" font-size="${fittedNodeFontSize(node.tag, node.width, nodeTextFit.tagPreferred, nodeTextFit.tagMinimum)}" text-anchor="middle">${esc(node.tag)}</text>`
    : '';
  const stage = asArray(dataflow.stages)[node.stage];
  const context = stage
    ? `${String(node.stage + 1).padStart(2, '0')} / ${stage.label}`
    : i18nText(dataflow.meta.locale, 'node.context.dataflow');
  const brand = renderBrandMark(node, { x: node.x + node.width - 22, y: node.y + 6 });
  const labelFontSize = fittedNodeFontSize(node.label, brandLabelFitWidth(node, node.width), 10, 8);
  const passport = { kind: node.type, sublabel: node.sublabel, tag: node.tag, context, ...brandMetadataFor(node) };
  return `        <g ${focusNodeAttrs(node.id, node.label, passport, dataflow.meta.locale)}>
          ${focusNodeTitle(node.label, passport)}
          <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="c-mask"/>
          <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="${fill}"${animateAttr(dataflow.meta, 'node', nodeSteps.get(node.id))} stroke-width="1.5"/>
          ${renderSemanticSigil(node.type, { x: node.x + 6, y: node.y + 6 })}${brand ? `\n          ${brand}` : ''}
          <text data-node-label=""${hasSub ? ' data-detail-anchor=""' : ''} x="${node.cx}" y="${node.y + 21}" class="t-primary" font-size="${labelFontSize}" font-weight="600" text-anchor="middle">${esc(node.label)}</text>${sub}${tag}
        </g>`;
}

function renderFlowPath(flow, index) {
  const [cls, marker] = arrowClassMap[flow.variant || 'default'] || arrowClassMap.default;
  const routed = pathFor(flow);
  const strokeWidth = flow.width || (flow.variant === 'emphasis' ? 1.8 : 1.4);
  return `        <path ${focusEdgeAttrs(flow.from, flow.to, flow.label, index, flow.id)} data-composition-points="${routePointsValue(routed.points)}" d="${routed.d}" class="${cls}"${animateAttr(dataflow.meta, 'edge', index)} stroke-width="${strokeWidth}" marker-end="url(#${marker})"/>`;
}

function renderFlowLabel(flow, index) {
  const routed = pathFor(flow);
  const [lx, ly] = labelPoint(flow, routed.points);
  const { width: labelW, height: labelH } = flowLabelSize(flow);
  const classification = flow.classification
    ? `\n        <text data-detail="fine" x="${lx}" y="${ly + 11}" class="t-dim" font-size="7" text-anchor="middle">${esc(flow.classification)}</text>`
    : '';
  return `        <g data-detail="context" ${focusEdgeAttrs(flow.from, flow.to, flow.label, index, flow.id)}>
          <rect x="${lx - labelW / 2}" y="${ly - 11}" width="${labelW}" height="${labelH}" rx="4" class="c-mask"/>
          <text x="${lx}" y="${ly}" class="${variantAccent(flow.variant)}" font-size="8" text-anchor="middle">${esc(flow.label)}</text>${classification}
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
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(dataflow.meta)}>
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

function buildLayoutReport(validation) {
  const relationships = asArray(dataflow.flows)
    .map((flow, flowIndex) => ({ flow, flowIndex }))
    .filter(({ flow }) => nodes.has(flow.from) && nodes.has(flow.to))
    .map(({ flow, flowIndex }) => {
      const routed = pathFor(flow);
      return connectionPath(flow, routed, labelPoint(flow, routed.points), flowIndex);
    });
  const labels = asArray(dataflow.flows)
    .map((flow, flowIndex) => ({ flow, flowIndex }))
    .filter(({ flow }) => nodes.has(flow.from) && nodes.has(flow.to))
    .map(({ flow, flowIndex }) => {
      const [lx, ly] = labelPoint(flow, pathFor(flow).points);
      const { width, height } = flowLabelSize(flow);
      return relationshipLabelBox({
        relation: flow,
        relationIndex: flowIndex,
        x: lx - width / 2,
        y: ly - 11,
        width,
        height,
        lx,
        ly,
      });
    });
  return resolvedLayoutReport({
    type: 'dataflow',
    viewBox,
    validation,
    entityKey: 'nodes',
    entities: [...nodes.values()].map(componentBox),
    relationships,
    labels,
    constraints: dataflowLayoutConstraints(),
    extras: { stages: compositionFrames },
  });
}

if (layoutJsonMode) {
  emitResolvedLayoutReport({ validate: validateDataflow, build: buildLayoutReport });
} else {
  validateDataflow();
  writeDiagram({
    outPath,
    template,
    diagramType: 'dataflow',
    meta: dataflow.meta,
    svg: renderSvg(),
    cards: dataflow.cards,
  });
}
