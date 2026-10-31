import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, renderDrilldownMark, resolveNodeDrilldowns, wrapSingleChildAnchor, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems, withIsolatedDiagnosticRecording, rendererFailure } from '../shared/diagnostics.mjs';
import { resolveLegend, renderLegend as renderResolvedLegend, legendFootprint } from '../shared/legend.mjs';
import { availableNodeTextWidth, fittedNodeFontSize, minimumNodeTextWidth, nodeLabelLayout } from '../shared/text-fit.mjs';
import { brandLabelFitWidth, brandMarkFor, brandMetadataFor, brandTopRailProblem, renderBrandMark } from '../shared/brand-marks.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { DECLARED_WIDE_READER_RATIO, minimumReadableSourceTextPx, predictedFixedWidthOverflow } from '../shared/desktop-readability.mjs';
import { placeAutomaticLabels } from '../shared/automatic-labels.mjs';
import { shortestOrthogonalGridRoute } from '../shared/route-quality.mjs';
import { repairLabelRoutes } from './joint-label-routing.mjs';
import { FLOW_LABEL_HEIGHT, flowLabelSize, wrapBlockedFlowLabels } from './label-capacity.mjs';
import {
  asArray,
  isFinitePoint,
  rectsOverlap,
  cleanEndpointSideProblems,
  cleanFlowProblems,
  cleanCrossingProblems,
  collectAmbiguousCorridors,
  collectBorderRuns,
  cleanAmbiguousCorridorProblems,
  cleanBorderRunProblems,
  frameBorderSegments,
  cleanRouteRhythmProblems,
  collectRouteRhythmIssues,
  cleanLabelRouteClearanceProblems,
  cleanLabelCanvasContainmentProblems,
  suggestLabelObstacleFix,
  suggestLabelPairFix,
  anchor,
  automaticPortSpread,
  alignAutomaticFacingPorts,
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
  labelPoint as legacyLabelPoint,
  componentFill,
  componentText,
  arrowClassMap,
  edgeLabelAccent,
  properSegmentIntersection
} from '../shared/geometry.mjs';

const nodeTextFit = {
  sublabelPreferred: 7,
  sublabelMinimum: 6,
  tagPreferred: 7,
  tagMinimum: 6,
};

// All geometry is local to an attempt. File publication and source loading
// stay in the CLI renderer and happen once, after a complete valid SVG exists.
export function compileDataflow({ dataflow, sourceEvidence, qualityProfile: requestedQualityProfile }) {
  function build(rebalancePorts) {
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
      labelH: FLOW_LABEL_HEIGHT
    };
    // Mirrors the authored minimum in schemas/dataflow.schema.json: a repair that
    // would need a node shorter than the schema allows cannot be offered.
    const minimumNodeHeight = 36;

    // Explicit geometry preserves established node sizing, typography, height,
    // routing and label placement. An omitted canvas width still fits its content
    // in either profile, including authored node widths.
    const qualityProfile = requestedQualityProfile;
    const automaticShowcase = qualityProfile === 'showcase'
      && dataflow.meta?.viewBox === undefined
      && !asArray(dataflow.nodes).some(node => node.width !== undefined);
    const stageRight = stageX(asArray(dataflow.stages).length - 1) + layout.stageW / 2;
    const nodeRights = asArray(dataflow.nodes).map(node =>
      stageX(node.stage) + (node.width || layout.nodeW) / 2).filter(Number.isFinite);
    const pinnedLabelRights = asArray(dataflow.flows).filter(flow => flow.label && Array.isArray(flow.labelAt) && isFinitePoint(...flow.labelAt))
      .map(flow => flow.labelAt[0] + flowLabelSize(flow).width / 2);
    // Automatic width fits stages/nodes with 24px right pad. The old 940px floor
    // left a blank third of the canvas on 2–3 stage drafts; five default stages
    // still measure ~1068 and stay unchanged. Height starts at 720 and is refit
    // by heightForLabels for automatic showcase.
    const contentWidth = Math.ceil(Math.max(stageRight, ...nodeRights, ...pinnedLabelRights, 0) + 24);
    const viewBox = dataflow.meta?.viewBox || [
      Math.max(480, contentWidth),
      720,
    ];
    const contextFontMinimum = automaticShowcase
      ? Math.max(6, Math.ceil(minimumReadableSourceTextPx(viewBox[0]) * 10) / 10)
      : 6;

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
    // Move one outgoing arrow off a crowded mixed side when its
    // perpendicular exit has capacity and reaches the target with a clear corner.
    const hasPinnedFlowGeometry = flow => flow.via || (flow.route && flow.route !== 'auto')
      || ['fromSide', 'toSide', 'channelX', 'channelY', 'labelAt', 'labelDx', 'labelDy', 'labelSegment']
        .some(key => flow[key] !== undefined);
    // Arrowheads are seven stroke-width units tall. Reserve two units of
    // clear ink within the automatic spread's existing 18px spacing limit.
    const portSpan = items => 32 + Math.max(0, items.length - 1) * Math.min(18,
      Math.ceil(Math.max(0, ...items.map(item => item.width * (item.incoming ? 7 : 1)))) + 2);

    const automaticSourceSides = new Map();
    if (automaticShowcase && rebalancePorts) {
      const flows = asArray(dataflow.flows);
      for (const node of nodes.values()) {
        const authored = dataflow.nodes.find(item => item.id === node.id);
        if (authored.height !== undefined || authored.yOffset !== undefined) continue;
        const incident = flows.filter(flow => flow.from === node.id || flow.to === node.id);
        if (incident.some(hasPinnedFlowGeometry)) continue;
        const sides = { left: [], right: [], top: [], bottom: [] };
        for (const flow of incident) {
          const from = nodes.get(flow.from), to = nodes.get(flow.to);
          if (!from || !to) continue;
          const incoming = flow.to === node.id;
          const side = incoming ? defaultToSide(from, to)
            : automaticSourceSides.get(flow) || defaultFromSide(from, to);
          sides[side].push({ flow, incoming, width: flowStrokeWidth(flow) });
        }
        const choices = [];
        for (const side of ['left', 'right']) {
          const items = sides[side];
          if (!items.some(item => item.incoming) || portSpan(items) <= node.height) continue;
          for (const item of items.filter(item => !item.incoming)) {
            const target = nodes.get(item.flow.to), dy = target.cy - node.cy;
            if (Math.abs(dy) < (node.height + target.height) / 2 + 16) continue;
            const alternate = dy > 0 ? 'bottom' : 'top';
            if (portSpan([...sides[alternate], item]) > node.width) continue;
            const toSide = defaultToSide(node, target);
            if (toSide !== 'left' && toSide !== 'right') continue;
            const start = anchor(node, alternate), end = anchor(target, toSide);
            const points = normalizeRoutePoints([start, [start[0], end[1]], end]);
            if (!routeHonorsEndpointSides(points, alternate, toSide)) continue;
            if ([...nodes.values()].some(other => points.slice(1).some((point, index) =>
              segmentIntersectsRect({ start: points[index], end: point }, other, 2)
              && !((other.id === node.id && index === 0)
                || (other.id === target.id && index === points.length - 2))))) continue;
            choices.push({ flow: item.flow, alternate,
              distance: Math.abs(start[0] - end[0]) + Math.abs(start[1] - end[1]) });
          }
        }
        choices.sort((a, b) => a.distance - b.distance);
        if (choices.length) automaticSourceSides.set(choices[0].flow, choices[0].alternate);
      }
    }

    if (rebalancePorts && !automaticSourceSides.size) return null;

    // Seven incoming arrows cannot fit on a 58px box after the corner gutters.
    // Use spare row space around its centre, so clear same-row outputs stay
    // straight. Explicit geometry and incident route/label pins stay authoritative.
    if (automaticShowcase) {
      const flows = asArray(dataflow.flows);
      const originalBoxes = [...nodes.values()].map(node => ({ ...node }));
      const rowBudget = Math.min(...layout.rowYs.slice(1).map((y, index) => y - layout.rowYs[index])) - 10;
      for (const authored of asArray(dataflow.nodes)) {
        if (authored.height !== undefined || authored.yOffset !== undefined) continue;
        const node = nodes.get(authored.id);
        const incident = flows.filter(flow => flow.from === node.id || flow.to === node.id);
        if (incident.some(hasPinnedFlowGeometry)) continue;
        const sides = { left: [], right: [] };
        for (const flow of incident) {
          if (!nodes.has(flow.from) || !nodes.has(flow.to)) continue;
          const { fromSide, toSide } = flowSides(flow);
          if (flow.from === node.id) sides[fromSide]?.push({ incoming: false, width: flowStrokeWidth(flow) });
          if (flow.to === node.id) sides[toSide]?.push({ incoming: true, width: flowStrokeWidth(flow) });
        }
        const desired = Math.max(node.height, ...Object.values(sides)
          .filter(items => items.some(item => item.incoming)).map(portSpan));
        const neighbours = originalBoxes.filter(other => other.id !== node.id
          && other.x < node.x + node.width + 10 && other.x + other.width + 10 > node.x);
        const height = Math.min(desired, rowBudget,
          2 * (node.cy - (layout.stageY + layout.stageH + 22)),
          ...neighbours.map(other => {
            const distance = Math.abs(other.cy - node.cy);
            // Split spare space with another growing box, and also respect a
            // taller authored neighbour. Use original bounds for stable ordering.
            return Math.min(distance - 10, 2 * distance - other.height - 20);
          }));
        if (height > node.height) {
          node.autoHeightInset = (height - node.height) / 2;
          node.y -= node.autoHeightInset;
          node.height = height;
        }
      }
    }
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
        const diagramAreaTop = layout.stageY + layout.stageH + 22;
        const diagramAreaBottom = viewBox[1] - layout.stageBottomPad;
        // y is the node's top edge, so the top bound moves only with yOffset —
        // height cannot repair it. Both bounds are reported independently, because
        // a node tall enough to cross the whole area violates both at once.
        if (node.y < diagramAreaTop) {
          const message = `Node "${node.id}" starts above the readable diagram area — keep y at or above ${diagramAreaTop}.`;
          diagnostics.push({
            code: 'dataflow/node-above-area',
            severity: 'error',
            message,
            subject: { diagramType: 'dataflow', node: node.id },
            evidence: { y: node.y, areaTop: diagramAreaTop, yOffset: node.yOffset || 0 },
            supportedFixes: [
              `raise or remove the negative yOffset on node "${node.id}"`,
            ],
          });
          problems.push(message);
        }
        if (node.y + node.height > diagramAreaBottom) {
          const nodeBottom = node.y + node.height;
          const requiredViewBoxHeight = nodeBottom + layout.stageBottomPad;
          // Only offer a repair that can clear this bound on its own. Lowering
          // yOffset moves the whole node, which reaches the bound only while the
          // node is short enough to fit between them at all; reducing height moves
          // only the bottom edge, and only reaches the bound while a node short
          // enough to do it is still legal to author.
          const supportedFixes = [];
          const roomForNode = diagramAreaBottom - diagramAreaTop;
          // The height that clears the bound at the node's current y. The room
          // between the bounds is the cap only while the node can still move; once
          // it sits below the area, the cap is what remains below it.
          const heightCapAtY = Math.min(roomForNode, diagramAreaBottom - node.y);
          if (node.height <= roomForNode) {
            supportedFixes.push(`lower yOffset on node "${node.id}"`);
          }
          if (heightCapAtY >= minimumNodeHeight) {
            supportedFixes.push(`reduce node "${node.id}" height to at most ${heightCapAtY}`);
          }
          // A dataflow canvas with an authored meta.viewBox gets no readable-scroll
          // exception, so the raised canvas is offered as a standalone repair only
          // while the delivered page still fits the target viewport — the same
          // page-fit math the checker applies for composition/viewport-height. The
          // raise is bounded above too: growing the height lowers the canvas ratio,
          // and under the wide threshold the Reader can no longer narrow the page,
          // so advice that stopped at the minimum let an author overshoot into a
          // certain visual-check failure.
          const raisedOverflow = predictedFixedWidthOverflow({
            viewBoxWidth: viewBox[0],
            viewBoxHeight: requiredViewBoxHeight,
            readerFit: null,
            diagramType: null,
          });
          const raisedCanvasFits = raisedOverflow === null;
          let maximumViewBoxHeight = Math.floor(viewBox[0] / DECLARED_WIDE_READER_RATIO);
          // The ratio boundary can land between integers; step down until the same
          // predicate the checker uses accepts the height.
          while (maximumViewBoxHeight > 1 && predictedFixedWidthOverflow({
            viewBoxWidth: viewBox[0],
            viewBoxHeight: maximumViewBoxHeight,
            readerFit: null,
            diagramType: null,
          }) !== null) {
            maximumViewBoxHeight -= 1;
          }
          const raiseTarget = maximumViewBoxHeight > requiredViewBoxHeight
            ? `to at least ${requiredViewBoxHeight} and at most ${maximumViewBoxHeight}`
            : `to ${requiredViewBoxHeight}`;
          if (raisedCanvasFits) {
            supportedFixes.push(`raise meta.viewBox[1] ${raiseTarget}, then rerun deliver and visual-check`);
          }
          // The bound belongs to y + height, so name the y that satisfies it. The
          // unadjusted "keep y between 104 and areaBottom" let an author follow the
          // message exactly and still fail.
          const extent = node.height <= roomForNode
            ? `keep y within [${diagramAreaTop}, ${diagramAreaBottom - node.height}] so that y + height does not pass ${diagramAreaBottom}`
            : heightCapAtY >= minimumNodeHeight
              ? `it is taller than the area from y = ${diagramAreaTop} to y = ${diagramAreaBottom}, so no yOffset can fit it — reduce node height to at most ${heightCapAtY} and keep y within [${diagramAreaTop}, ${diagramAreaBottom - heightCapAtY}] so that y + height does not pass ${diagramAreaBottom}`
              : `it is taller than the area from y = ${diagramAreaTop} to y = ${diagramAreaBottom} and sits too low for any legal height, so no single change clears this bound — reduce node height to at most ${roomForNode} and move it up so that y + height does not pass ${diagramAreaBottom}`;
          const raiseClause = raisedCanvasFits
            ? ` Raising meta.viewBox[1] ${raiseTarget} also fits it and still fits the target viewport.`
            : ` Raising meta.viewBox[1] to ${requiredViewBoxHeight} would fit the node, but the page then reaches at least ~${raisedOverflow.pageHeightPx}px in the 1440x900 viewport, so the raise cannot stand on its own — compact the node instead.`;
          const message = `Node "${node.id}" exceeds the readable diagram area — ${extent}.${raiseClause}`;
          diagnostics.push({
            code: 'dataflow/node-below-area',
            severity: 'error',
            message,
            subject: { diagramType: 'dataflow', node: node.id },
            evidence: {
              y: node.y,
              height: node.height,
              areaBottom: diagramAreaBottom,
              requiredViewBoxHeight,
              requiredViewBoxFitsViewport: raisedCanvasFits,
              maximumViewBoxHeight,
              ...(raisedCanvasFits ? {} : { requiredViewBoxPageHeightPx: raisedOverflow.pageHeightPx }),
              viewBoxHeight: viewBox[1],
            },
            supportedFixes,
          });
          problems.push(message);
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
      for (const [flowIndex, flow] of flowList.entries()) {
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
        crossingResolved: (left, right) => resolvedCrossoverFlows.has(left) && resolvedCrossoverFlows.has(right),
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

    function supportsAutomaticCrossover(flow) {
      return automaticShowcase && !flow.via && (!flow.route || flow.route === 'auto')
        && flow.channelX === undefined && flow.channelY === undefined;
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
        fromSide: chosenSide(flow.fromSide, automaticSourceSides.get(flow) || defaultFromSide(from, to)),
        toSide: chosenSide(flow.toSide, defaultToSide(from, to)),
      };
    }

    // The shared default of 14px packs two 10px arrowheads on top of each other.
    // Raise the ceiling so a side that has room spreads them; a short side still
    // clamps to usable/(n-1) and keeps the previous layout.
    const automaticPorts = automaticPortSpread(dataflow.flows, nodes, {
      sideFor: (flow, endpoint) => flowSides(flow)[endpoint === 'source' ? 'fromSide' : 'toSide'],
      maxSpacing: 18,
    });

    function pathFor(flow) {
      if (pathCache.has(flow)) return pathCache.get(flow);
      const from = nodes.get(flow.from);
      const to = nodes.get(flow.to);
      const ports = automaticPorts.get(flow);
      const { fromSide, toSide } = flowSides(flow);
      let start = ports?.from || anchor(from, fromSide);
      let end = ports?.to || anchor(to, toSide);
      if (automaticShowcase && flow.labelDx === undefined && flow.labelDy === undefined && flow.labelSegment === undefined) {
        const aligned = alignAutomaticFacingPorts(flow, from, to, start, end, fromSide, toSide, ports, {
          accept: points => {
            if ([...nodes.values()].some(node => node.id !== from.id && node.id !== to.id
                && segmentIntersectsRect({ start: points[0], end: points[1] }, node, 2))) return false;
            // A pinned route still occupies its endpoint. Check both ends: on a
            // short crowded side, keeping the bridge also preserves space for
            // labels between neighbouring branches.
            for (const [rect, side, point] of [
              [from, fromSide, points[0]], [to, toSide, points[1]],
            ]) {
              for (const other of asArray(dataflow.flows)) {
                if (other === flow || !nodes.has(other.from) || !nodes.has(other.to)) continue;
                for (const field of ['from', 'to']) {
                  if (other[field] !== rect.id || flowSides(other)[field === 'from' ? 'fromSide' : 'toSide'] !== side) continue;
                  const occupied = automaticPorts.get(other)?.[field] || anchor(rect, side);
                  if (Math.hypot(point[0] - occupied[0], point[1] - occupied[1]) < 18 - 0.0001) return false;
                }
              }
            }
            return true;
          },
        });
        start = aligned.start;
        end = aligned.end;
      }
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

    const resolvedCrossoverFlows = new Set();
    const routable = asArray(dataflow.flows).filter(flow => nodes.has(flow.from) && nodes.has(flow.to));
    const segmentsOf = points => points.slice(1).map((end, index) => ({ start: points[index], end }));
    const related = (left, right) => [left.from, left.to].some(id => id === right.from || id === right.to);
    const crosses = (left, right) => segmentsOf(pathFor(left).points).some(a => segmentsOf(pathFor(right).points).some(b => (
      properSegmentIntersection(a.start, a.end, b.start, b.end))));
    const unrelated = flow => routable.filter(other => other !== flow && !related(flow, other));
    const length = points => segmentsOf(points).reduce((sum, { start, end }) => sum + Math.abs(end[0] - start[0]) + Math.abs(end[1] - start[1]), 0);
    const DETOUR_NODE_GAP = 12;
    const ENDPOINT_STUB = 24;
    function intrudesNode(flow, points) {
      return [...nodes.values()].some(node => segmentsOf(points).some((segment, index) => (
        segmentIntersectsRect(segment, node, 2)
        && !((node.id === flow.from && index === 0) || (node.id === flow.to && index === points.length - 2))
      )));
    }
    function sharesCorridor(flow, points, deferred = new Set()) {
      return unrelated(flow).some(other => {
        const occupied = deferred.has(other)
          ? endpointStubs(other).map(({ start, end }) => [start, end])
          : [pathFor(other).points];
        return occupied.some(otherPoints => collectAmbiguousCorridors({
          routedRelations: [{ relation: flow, points }, { relation: other, points: otherPoints }],
        }).length > 0);
      });
    }
    function endpointStubs(flow) {
      const points = pathFor(flow).points;
      const { fromSide, toSide } = flowSides(flow);
      const directions = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };
      return [[points[0], fromSide], [points.at(-1), toSide]].map(([start, side]) => ({
        start, end: start.map((value, axis) => value + directions[side][axis] * ENDPOINT_STUB),
      }));
    }
    function crossingFlows(flow, points) {
      return unrelated(flow).filter(other => segmentsOf(points).some(a => segmentsOf(pathFor(other).points).some(b => (
        properSegmentIntersection(a.start, a.end, b.start, b.end)))));
    }
    function readingCost(flow, points) {
      return length(points) + Math.max(0, points.length - 2) * 48 + crossingFlows(flow, points).length * 160;
    }

    // Preset paths can cross unrelated flows. Prefer a short clear detour, but
    // give resolved crossings the same finite reading cost as Architecture rather
    // than forcing a perimeter excursion. Crossings with authored routes still
    // need a clear detour; only actual automatic/automatic crosses get halos.
    if (automaticShowcase) {
      // The stage bottoms are fitted below the final routes and labels later.
      // Reserve the fixed tops/sides now, extending sides past the search area.
      const routingBottom = Math.max(viewBox[1], ...[...nodes.values()].map(node => node.y + node.height),
        ...routable.flatMap(flow => pathFor(flow).points.map(point => point[1]))) + DETOUR_NODE_GAP + ENDPOINT_STUB;
      const routingFrames = asArray(dataflow.stages).map((stage, index) => ({
        ...stageFrame(stage, index), height: routingBottom - layout.stageY,
      }));
      const stageBorders = routingFrames.flatMap(frame => frameBorderSegments(frame).filter(border => border.side !== 'bottom'));
      // Check nearby simple corridors before accepting a grid detour. Coordinate
      // thinning can discard an open two-bend corridor beside an occupied one.
      // Bound these candidates; the grid still handles routes around obstacles.
      function compactCorridors(flow) {
        const { fromSide, toSide } = flowSides(flow);
        const axis = fromSide === 'right' && toSide === 'left' ? 0
          : fromSide === 'left' && toSide === 'right' ? 0
          : fromSide === 'bottom' && toSide === 'top' ? 1
          : fromSide === 'top' && toSide === 'bottom' ? 1 : -1;
        if (axis < 0) return [];
        const [start, end] = [pathFor(flow).points[0], pathFor(flow).points.at(-1)];
        const low = Math.min(start[axis], end[axis]) + ENDPOINT_STUB;
        const high = Math.max(start[axis], end[axis]) - ENDPOINT_STUB;
        if (low > high) return [];
        const middle = (low + high) / 2;
        const coordinates = new Set([low, middle, high]);
        const others = routable.filter(other => other !== flow);
        for (const other of others) {
          for (const segment of segmentsOf(pathFor(other).points)) {
            if (segment.start[axis] === segment.end[axis]) {
              coordinates.add(segment.start[axis] - 8);
              coordinates.add(segment.start[axis] + 8);
            }
          }
        }
        return [...coordinates].filter(value => value >= low && value <= high)
          .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle)).slice(0, 16)
          .map(value => {
            const a = [...start], b = [...end];
            a[axis] = b[axis] = value;
            return normalizeRoutePoints([start, a, b, end]);
          }).filter(points => routeHonorsEndpointSides(points, fromSide, toSide)
            && !intrudesNode(flow, points)
            && !collectRouteRhythmIssues({ routedRelations: [{ points }] }).length
            && !collectBorderRuns({ routedRelations: [{ points }], frames: routingFrames })
              .some(hit => hit.side !== 'bottom')
            && crossingFlows(flow, points).every(supportsAutomaticCrossover)
            && !others.some(other => collectAmbiguousCorridors({
              routedRelations: [{ relation: flow, points }, { relation: other, points: pathFor(other).points }],
              includeSharedEndpoints: () => true,
            }).length));
      }
      function gridDetour(flow, allowAvoidedCrossings = false, deferred = new Set()) {
        const { points } = pathFor(flow);
        const { fromSide, toSide } = flowSides(flow);
        const others = unrelated(flow);
        const options = {
          start: points[0],
          end: points.at(-1),
          points: [points[0], points.at(-1)],
          // Keep a detour a readable gap away from the nodes it passes; only its
          // own endpoints are held to the grid's 2-unit clearance.
          obstacles: [...nodes.values()].map(node => (node.id === flow.from || node.id === flow.to ? node : {
            x: node.x - DETOUR_NODE_GAP, y: node.y - DETOUR_NODE_GAP,
            width: node.width + DETOUR_NODE_GAP * 2, height: node.height + DETOUR_NODE_GAP * 2,
          })),
          fromSide,
          toSide,
          clearance: 2,
          maximumObstacleCount: 80,
          endpointStubPx: ENDPOINT_STUB,
          maximumGridNodes: 4096,
          avoidedSegments: others.flatMap(other => deferred.has(other) ? endpointStubs(other) : segmentsOf(pathFor(other).points)),
          allowAvoidedCrossings,
          minimumAvoidedOverlapPx: 8,
          routeSeparationPx: 8,
          minimumSegmentPx: 16,
          bendPenaltyPx: 48,
        };
        let detour = shortestOrthogonalGridRoute(options);
        // Frame constraints add coordinates to the grid. Keep an already-clear
        // route stable; only retry if this route actually borrows a frame side.
        if (detour && collectBorderRuns({ routedRelations: [{ points: detour.points }], frames: routingFrames })
          .some(hit => hit.side !== 'bottom')) {
          detour = shortestOrthogonalGridRoute({ ...options, borderSegments: stageBorders });
        }
        // The grid preserves both endpoint coordinates, even when their axes
        // are closer than its coalescing distance. Check the resulting route
        // before a cheaper micro jog can replace a readable port bridge.
        const normalized = detour && normalizeRoutePoints(detour.points);
        return normalized && !collectRouteRhythmIssues({ routedRelations: [{ points: normalized }] }).length
          ? normalized : null;
      }
      function detourFor(flow) {
        const { points } = pathFor(flow);
        const normalized = gridDetour(flow);
        if (!normalized) return null;
        // Reuse Architecture's finite reading cost: 48px per bend, 160px per
        // resolved crossing. A small clear detour still wins over a crossover.
        const currentCost = readingCost(flow, points);
        const detourCost = length(normalized) + Math.max(0, normalized.length - 2) * 48;
        // A halo resolves an edge/edge crossing, never an edge through a node.
        // Keep the clear detour even when the obstructed preset costs less.
        const canResolve = supportsAutomaticCrossover(flow) && crossingFlows(flow, points).every(supportsAutomaticCrossover)
          && !sharesCorridor(flow, points) && !intrudesNode(flow, points);
        if (canResolve && detourCost >= currentCost) return null;
        return { flow, routed: { d: polylinePath(normalized), points: normalized }, cost: detourCost - currentCost };
      }
      // A skipped stage/row or shared corridor can obstruct a preset without a
      // proper crossing. Repair those routes first; otherwise the crossing pass either
      // misses them or treats every neighbouring edge as an impenetrable wall.
      // Both bounded searches keep node clearance and separate corridors. Only
      // automatic/automatic crosses can use the shorter, halo-resolved option.
      // Repairing a later preset can free a corridor for an earlier one. An
      // already-obstructed automatic preset is not a settled corridor: two such
      // presets can cover each other's endpoint stubs. Defer those presets while
      // repairing one route, but reserve their endpoint stubs so they can still
      // leave and enter their nodes. Plan the others around that repaired route.
      // Supplied routes and routes already clear of nodes remain obstacles.
      // Node intrusions only decrease; stop as soon as no route improves. Final
      // validation still checks every route, including any unrepaired preset.
      for (let pass = 0; pass < routable.length; pass += 1) {
        let repaired = false;
        for (const flow of routable) {
          if (!supportsAutomaticCrossover(flow)) continue;
          const current = pathFor(flow).points;
          if (!intrudesNode(flow, current) && !sharesCorridor(flow, current)) continue;
          const { fromSide, toSide } = flowSides(flow);
          const candidatesFor = deferred => [gridDetour(flow, false, deferred), gridDetour(flow, true, deferred)].filter(points => points
            && routeHonorsEndpointSides(points, fromSide, toSide) && !intrudesNode(flow, points)
            && !sharesCorridor(flow, points, deferred) && crossingFlows(flow, points).every(supportsAutomaticCrossover));
          let candidates = candidatesFor(new Set());
          if (!candidates.length) {
            const deferred = new Set(unrelated(flow).filter(other => supportsAutomaticCrossover(other)
              && intrudesNode(other, pathFor(other).points)));
            if (deferred.size) candidates = candidatesFor(deferred);
          }
          candidates.push(...compactCorridors(flow));
          candidates.sort((left, right) => readingCost(flow, left) - readingCost(flow, right));
          if (candidates.length && JSON.stringify(candidates[0]) !== JSON.stringify(current)) {
            pathCache.set(flow, { d: polylinePath(candidates[0]), points: candidates[0] });
            repaired = true;
          }
        }
        if (!repaired) break;
      }
      // Resolve the most useful clear detour first. Remaining automatic crosses
      // get explicit halos; supplied geometry retains its crossing diagnostic.
      for (let pass = 0; pass < routable.length; pass += 1) {
        const crossing = routable.filter(flow => supportsAutomaticCrossover(flow) && unrelated(flow).some(other => crosses(flow, other)));
        const options = crossing.map(detourFor).filter(Boolean).sort((left, right) => left.cost - right.cost);
        const before = routable.filter(flow => unrelated(flow).some(other => crosses(flow, other))).length;
        const chosen = options.find(({ flow, routed }) => {
          const previous = pathCache.get(flow);
          pathCache.set(flow, routed);
          const after = routable.filter(other => unrelated(other).some(next => crosses(other, next))).length;
          if (after < before) return true;
          pathCache.set(flow, previous);
          return false;
        });
        if (!chosen) break;
      }
    }

    const intersectionCount = (points, otherPoints) => segmentsOf(points).reduce((count, a) => count
      + segmentsOf(otherPoints).filter(b => properSegmentIntersection(a.start, a.end, b.start, b.end)).length, 0);
    const foldsBack = points => {
      const segments = segmentsOf(points);
      return segments.some((segment, index) => segments.slice(index + 2).some(other => segmentIntersectsRect(segment, {
        x: Math.min(other.start[0], other.end[0]), y: Math.min(other.start[1], other.end[1]),
        width: Math.abs(other.end[0] - other.start[0]), height: Math.abs(other.end[1] - other.start[1]),
      })));
    };

    // Route detours can reverse the direction used to sort a shared node's ports.
    // Reorder the existing slots by the first turn of the settled route, only when
    // the whole automatic group becomes shorter without adding any intersection.
    if (automaticShowcase) {
      const portFrames = asArray(dataflow.stages).map(stageFrame);
      const groups = new Map();
      for (const flow of routable) for (const field of ['from', 'to']) {
        const side = flowSides(flow)[field === 'from' ? 'fromSide' : 'toSide'];
        const key = `${flow[field]}\0${side}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({ flow, field, side });
      }
      const pinned = flow => !supportsAutomaticCrossover(flow)
        || ['fromSide', 'toSide', 'labelAt', 'labelDx', 'labelDy', 'labelSegment'].some(key => flow[key] !== undefined);
      let probes = 0;
      for (const group of groups.values()) {
        if (probes >= 16) break;
        if (group.length < 2 || group.length > 8
          || group.some(({ flow, field }) => pinned(flow) || !automaticPorts.get(flow)?.[field])) continue;
        const axis = ['left', 'right'].includes(group[0].side) ? 1 : 0;
        const currentRoutes = group.map(item => ({ ...item, current: normalizeRoutePoints(pathFor(item.flow).points) }));
        if (currentRoutes.some(({ current }) => current.length < 2
          || current.some(point => !point.every(Number.isFinite)))) continue;
        const items = currentRoutes.map(({ current, ...item }) => {
          const outward = item.field === 'from' ? current : [...current].reverse();
          return { ...item, current, outward, coordinate: outward[0][axis],
            turn: outward.find(point => Math.abs(point[axis] - outward[0][axis]) > 0.0001)?.[axis] ?? outward[0][axis] };
        });
        const slots = items.map(item => item.coordinate).sort((a, b) => a - b);
        const ordered = [...items].sort((a, b) => a.turn - b.turn || a.coordinate - b.coordinate);
        if (ordered.every((item, index) => item.coordinate === slots[index])) continue;
        probes++;
        const proposal = new Map();
        let straightened = false;
        for (const [index, item] of ordered.entries()) {
          const outward = item.outward.map(point => [...point]);
          outward[0][axis] = slots[index];
          if (outward.length > 2) outward[1][axis] = slots[index];
          let points = item.field === 'from' ? outward : outward.reverse();
          const { fromSide, toSide } = flowSides(item.flow);
          const direct = [points[0], points.at(-1)];
          if (routeHonorsEndpointSides(direct, fromSide, toSide)
            && (direct[0][0] === direct[1][0] || direct[0][1] === direct[1][1])) points = direct;
          points = normalizeRoutePoints(points);
          if (points.length === 2 && item.current.length > 2) straightened = true;
          proposal.set(item.flow, points);
        }
        if (!straightened || items.some(({ flow, current }) => {
          const points = proposal.get(flow), { fromSide, toSide } = flowSides(flow);
          return points.length > current.length || length(points) > length(current) + 0.0001 || foldsBack(points)
            || !routeHonorsEndpointSides(points, fromSide, toSide) || intrudesNode(flow, points)
            || collectRouteRhythmIssues({ routedRelations: [{ points }] }).length
            || collectBorderRuns({ routedRelations: [{ points }], frames: portFrames }).length
            || points.some(([x, y]) => x < 0 || y < 0 || x > viewBox[0] || y > viewBox[1] - layout.stageBottomPad)
            || routable.some(other => other !== flow && (
              intersectionCount(points, proposal.get(other) || pathFor(other).points)
                > intersectionCount(current, pathFor(other).points)
              || collectAmbiguousCorridors({
                routedRelations: [{ relation: flow, points }, { relation: other, points: proposal.get(other) || pathFor(other).points }],
                includeSharedEndpoints: () => true,
              }).length));
        })) continue;
        for (const { flow, field } of items) {
          const points = proposal.get(flow);
          pathCache.set(flow, { points, d: polylinePath(points) });
          automaticPorts.get(flow)[field] = field === 'from' ? points[0] : points.at(-1);
        }
      }
    }

    // The legacy two-point anchor is relative to the source's y coordinate.
    // On an automatic vertical flow that places the label inside the source.
    // Start in the inter-node corridor; explicit offsets retain their old anchor.
    function labelPoint(flow, points) {
      if (automaticShowcase && !flow.classification && points.length === 2 && points[0][0] === points[1][0]
        && !['labelAt', 'labelDx', 'labelDy', 'labelSegment'].some(key => flow[key] !== undefined)) {
        const anchor = [points[0][0], (points[0][1] + points[1][1]) / 2 - 10];
        const { width, height } = flowLabelSize(flow);
        const rect = { x: anchor[0] - width / 2, y: anchor[1] - 11, width, height };
        // Sibling flows share a fixed source-side corridor. Keep the old search
        // anchor if a sibling occupies the midpoint; interior routes from other
        // nodes can still move during the later label/corridor repair.
        if (routable.every(other => other === flow || other.from !== flow.from || segmentsOf(pathFor(other).points)
          .every(segment => segmentRectClearanceWithin(segment, rect, 4) + 0.0001 >= 4))) return anchor;
      }
      return legacyLabelPoint(flow, points);
    }

    function extraLabelLineMasksRoute(rect, points) {
      if (rect.height <= layout.labelH) return false;
      const segments = segmentsOf(points);
      return segments.some(segment => segmentIntersectsRect(segment, rect))
        && !segments.some(segment => segmentIntersectsRect(segment, { ...rect, height: layout.labelH }));
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
        if (extraLabelLineMasksRoute(rect, pathFor(flow).points)) {
          twoLineOcclusions.add(flow);
        }
      }
      return [rect];
    });
    // Routing depends on node geometry and canvas width, so its actual footprint
    // can determine height without another copy of routeVia's preset rules.
    function heightForLabels(labels) {
      const geometryBottom = Math.max(0,
        ...[...nodes.values()].map(node => node.y + node.height),
        ...routable.flatMap(flow => pathFor(flow).points.map(point => point[1])));
      const contentBottom = Math.max(geometryBottom, ...labels.map(rect => rect.y + rect.height));
      return Math.max(360, Math.ceil(contentBottom + 24 + layout.stageBottomPad));
    }
    function fitAutomaticWidthToLabels(labels) {
      if (dataflow.meta?.viewBox) return;
      const labelRight = Math.max(0, ...labels.map(rect => rect.x + rect.width));
      viewBox[0] = Math.max(viewBox[0], Math.ceil(labelRight + 24));
    }
    // Give the shared placer room for complete initial plates before its search;
    // width growth here does not recompute the measured nodes or cached routes.
    fitAutomaticWidthToLabels(initialLabelRects);
    if (automaticShowcase) viewBox[1] = heightForLabels(initialLabelRects)
      + Math.max(0, ...initialLabelRects.map(rect => rect.height - layout.labelH));
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
      maxOwnRouteDistance: 36,
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
        maxOwnRouteDistance: 36,
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

    // Labels may occupy the only useful part of an inter-stage corridor after
    // ordinary routing has finished. Try shifting one interior segment past the
    // actual plate, then re-place only the labels that this move obstructs. Valid
    // labels keep their positions. Endpoint geometry and authored controls remain
    // authoritative, and every accepted route clears all final foreign labels.
    if (automaticShowcase) {
      const titles = compositionFrames.map(frame => ({ ...frame, height: layout.stageH }));
      const labelGap = 4;
      // Bound the complete candidate checks, including rejected geometry, across
      // the diagram. Each accepted move clears one route's label collisions.
      let attempts = 0;
      const nearOwnRoute = (rect, points) => segmentsOf(points)
        .some(segment => segmentRectClearanceWithin(segment, rect, 36) <= 36);
      const masksLabel = (points, rect) => segmentsOf(points)
        .some(segment => segmentRectClearanceWithin(segment, rect, labelGap) + 0.0001 < labelGap);
      const overlapsNode = rect => [...nodes.values()].some(node => rectsOverlap(rect, node, -2));
      // A label left inside a node does not mask the route occupying its usable
      // slot. Probe a nearby node-clear slot with the other labels fixed. These
      // are search targets only: accept a corridor move after placing every label
      // against the real routes, including resolving the original node overlap.
      let slotProbes = 0;
      const blockedLabelSlots = resolvedLabelRects.flatMap((rect, index) => {
        if (slotProbes >= 16 || ['labelAt', 'labelDx', 'labelDy', 'labelSegment'].some(key => rect.relation[key] !== undefined)
          || !overlapsNode(rect)) return [];
        slotProbes++;
        const labels = resolvedLabelRects.map((other, otherIndex) => ({ ...other, ly: other.ly - 1,
          relation: otherIndex === index ? other.relation : { ...other.relation, labelAt: [other.lx, other.ly] } }));
        const probe = placeAutomaticLabels({ labels,
          routes: [{ relationIndex: rect.relationIndex, points: pathFor(rect.relation).points }],
          components: [...nodes.values()], titles, viewBox,
          placementBottom: viewBox[1] - layout.stageBottomPad, maxOwnRouteDistance: 36 })[index];
        return probe !== labels[index] ? [probe] : [];
      });
      for (const flow of routable) {
        if (attempts >= 16) break;
        if (!supportsAutomaticCrossover(flow)
          || ['labelAt', 'labelDx', 'labelDy', 'labelSegment'].some(key => flow[key] !== undefined)) continue;
        const current = normalizeRoutePoints(pathFor(flow).points);
        const pendingSlots = blockedLabelSlots.filter(slot => overlapsNode(
          resolvedLabelRects.find(rect => rect.relation === slot.relation)));
        const blocked = [...resolvedLabelRects, ...pendingSlots]
          .filter(rect => rect.relation !== flow && masksLabel(current, rect));
        if (!blocked.length) continue;
        const candidates = new Map();
        for (const rect of blocked) {
          for (let index = 1; index < current.length - 2; index++) {
            const [start, end] = [current[index], current[index + 1]];
            if (segmentRectClearanceWithin({ start, end }, rect, labelGap) + 0.0001 >= labelGap) continue;
            const axis = start[0] === end[0] ? 0 : start[1] === end[1] ? 1 : -1;
            if (axis === -1) continue;
            const [low, size] = axis === 0 ? [rect.x, rect.width] : [rect.y, rect.height];
            for (const coordinate of [low - labelGap, low + size + labelGap]) {
              const points = current.map(point => [...point]);
              points[index][axis] = points[index + 1][axis] = coordinate;
              // Do not reverse either neighbouring segment into a doubled-back
              // path. A zero-length neighbour can be removed by normalization.
              if ([index - 1, index + 1].some(k => [0, 1].reduce((dot, axis) => dot
                + (current[k + 1][axis] - current[k][axis]) * (points[k + 1][axis] - points[k][axis]), 0) < 0)) continue;
              const normalized = normalizeRoutePoints(points);
              candidates.set(JSON.stringify(normalized), normalized);
            }
          }
        }
        const { fromSide, toSide } = flowSides(flow);
        const oldCrossings = new Map(unrelated(flow).map(other => [other, intersectionCount(current, pathFor(other).points)]));
        const oldCost = readingCost(flow, current);
        const ranked = [...candidates.values()].map(points => ({ points, cost: readingCost(flow, points) }))
          .sort((a, b) => a.cost - b.cost);
        for (const { points, cost } of ranked) {
          if (attempts >= 16) break;
          attempts++;
          // At most two bend-costs of extra distance; never add bends, crossings,
          // self-overlaps, shared corridors or a new route through a node.
          if (points.length > current.length || cost > oldCost + 96 || foldsBack(points)
            || !routeHonorsEndpointSides(points, fromSide, toSide)
            || points.some(([x, y]) => x < 0 || y < 0 || x > viewBox[0] || y > viewBox[1] - layout.stageBottomPad)
            || intrudesNode(flow, points) || sharesCorridor(flow, points)
            || collectRouteRhythmIssues({ routedRelations: [{ points }] }).length
            || collectBorderRuns({ routedRelations: [{ points }], frames: compositionFrames }).length
            || [...oldCrossings].some(([other, count]) => {
              const nextCount = intersectionCount(points, pathFor(other).points);
              return nextCount > count || nextCount > 0 && !supportsAutomaticCrossover(other);
            })) continue;
          const labels = resolvedLabelRects.map(rect => ({ ...rect, ly: rect.ly - 1 }));
          const routes = asArray(dataflow.flows).flatMap((other, relationIndex) => (
            nodes.has(other.from) && nodes.has(other.to)
              ? [{ relationIndex, points: other === flow ? points : pathFor(other).points }] : []
          ));
          const placed = placeAutomaticLabels({ labels, routes, components: [...nodes.values()], titles,
            viewBox, placementBottom: viewBox[1] - layout.stageBottomPad, maxOwnRouteDistance: 36 });
          if (placed.some(rect => rect.relation !== flow && masksLabel(points, rect))) continue;
          if (blocked.some(slot => pendingSlots.includes(slot) && overlapsNode(
            placed.find(rect => rect.relation === slot.relation)))) continue;
          if (placed.some((rect, index) => {
            const oldPoints = pathFor(rect.relation).points;
            const ownPoints = rect.relation === flow ? points : oldPoints;
            return ((rect.relation === flow || rect !== labels[index]) && !nearOwnRoute(rect, ownPoints))
              || (extraLabelLineMasksRoute(rect, ownPoints) && !extraLabelLineMasksRoute(labels[index], oldPoints));
          })) continue;
          pathCache.set(flow, { points, d: polylinePath(points) });
          for (const [index, rect] of placed.entries()) {
            const resolved = { ...rect, ly: rect.ly + 1 };
            resolvedLabelRects[index] = resolved;
            resolvedLabelPoints.set(rect.relation, [resolved.lx, resolved.ly]);
          }
          break;
        }
      }
      // Once labels and routes are settled, align only the free endpoint of a
      // short port bridge. Keep other routes and labels fixed so a local straight
      // line cannot trigger a longer detour or hide a neighbouring label.
      let alignmentProbes = 0;
      for (const flow of routable) {
        if (alignmentProbes >= 16) break;
        if (!supportsAutomaticCrossover(flow)
          || ['labelAt', 'labelDx', 'labelDy', 'labelSegment'].some(key => flow[key] !== undefined)) continue;
        const current = normalizeRoutePoints(pathFor(flow).points);
        if (current.length <= 2) continue;
        const index = resolvedLabelRects.findIndex(rect => rect.relation === flow);
        if (index < 0) continue;
        const from = nodes.get(flow.from), to = nodes.get(flow.to);
        const { fromSide, toSide } = flowSides(flow);
        let placedLabel;
        const aligned = alignAutomaticFacingPorts(flow, from, to, current[0], current.at(-1), fromSide, toSide, automaticPorts.get(flow), {
          accept: points => {
            if (alignmentProbes >= 16 || intrudesNode(flow, points)
              || unrelated(flow).some(other => intersectionCount(points, pathFor(other).points)
                > intersectionCount(current, pathFor(other).points))
              || resolvedLabelRects.some(rect => rect.relation !== flow && masksLabel(points, rect))) return false;
            for (const [node, side, point, original] of [
              [from, fromSide, points[0], current[0]], [to, toSide, points[1], current.at(-1)],
            ]) {
              if (Math.hypot(point[0] - original[0], point[1] - original[1]) < 0.0001) continue;
              for (const other of routable) for (const field of ['from', 'to']) {
                if (other === flow || other[field] !== node.id || flowSides(other)[field === 'from' ? 'fromSide' : 'toSide'] !== side) continue;
                const occupied = field === 'from' ? pathFor(other).points[0] : pathFor(other).points.at(-1);
                if (Math.hypot(point[0] - occupied[0], point[1] - occupied[1]) < 18 - 0.0001) return false;
              }
            }
            if (routable.some(other => other !== flow && collectAmbiguousCorridors({
              routedRelations: [{ relation: flow, points }, { relation: other, points: pathFor(other).points }],
              includeSharedEndpoints: () => true,
            }).length)) return false;
            alignmentProbes++;
            const [lx, ly] = labelPoint(flow, points), rect = resolvedLabelRects[index];
            const labels = resolvedLabelRects.map((other, i) => i === index
              ? { ...other, x: lx - other.width / 2, y: ly - 11, lx, ly: ly - 1 }
              : { ...other, ly: other.ly - 1, relation: { ...other.relation, labelAt: [other.lx, other.ly] } });
            const routes = routable.map(other => ({ relationIndex: asArray(dataflow.flows).indexOf(other), points: other === flow ? points : pathFor(other).points }));
            const candidate = placeAutomaticLabels({ labels, routes, components: [...nodes.values()], titles,
              viewBox, placementBottom: viewBox[1] - layout.stageBottomPad, maxOwnRouteDistance: 36 })[index];
            if (candidate.x < 0 || candidate.y < 0 || candidate.x + candidate.width > viewBox[0]
              || candidate.y + candidate.height > viewBox[1] - layout.stageBottomPad
              || [...nodes.values(), ...titles].some(obstacle => rectsOverlap(candidate, obstacle, 2))
              || resolvedLabelRects.some((other, i) => i !== index && rectsOverlap(candidate, other, 2))
              || routes.some(route => route.relationIndex !== rect.relationIndex && masksLabel(route.points, candidate))
              || !nearOwnRoute(candidate, points)
              || (extraLabelLineMasksRoute(candidate, points) && !extraLabelLineMasksRoute(rect, current))) return false;
            placedLabel = { ...candidate, ly: candidate.ly + 1 };
            return true;
          },
        });
        if (!placedLabel) continue;
        const points = [aligned.start, aligned.end];
        pathCache.set(flow, { points, d: polylinePath(points) });
        resolvedLabelRects[index] = placedLabel;
        resolvedLabelPoints.set(flow, [placedLabel.lx, placedLabel.ly]);
      }
      for (const [index, left] of routable.entries()) {
        for (const right of routable.slice(index + 1)) {
          if (!related(left, right) && supportsAutomaticCrossover(left) && supportsAutomaticCrossover(right) && crosses(left, right)) {
            resolvedCrossoverFlows.add(left);
            resolvedCrossoverFlows.add(right);
          }
        }
      }
    }

    // Only after routes settle, try two complete rows for an unresolved wide
    // label. Keep the plate immediately beside its own arrow, with every other
    // route and label fixed; an empty island above a node is not a useful slot.
    if (automaticShowcase) {
      const wrapped = wrapBlockedFlowLabels({ labels: resolvedLabelRects,
        routes: routable.map(flow => ({ relationIndex: asArray(dataflow.flows).indexOf(flow), points: pathFor(flow).points })),
        components: [...nodes.values()], titles: compositionFrames.map(frame => ({ ...frame, height: layout.stageH })),
        viewBox, placementBottom: viewBox[1] - layout.stageBottomPad });
      for (const [index, rect] of wrapped.entries()) {
        if (rect === resolvedLabelRects[index]) continue;
        resolvedLabelRects[index] = rect;
        resolvedLabelPoints.set(rect.relation, [rect.lx, rect.ly]);
      }
    }

    // A shared placement search may retain an unpinned original plate when none
    // of its candidates fit the compact width. Include every final rendered plate
    // without moving nodes, routes or labels; an authored canvas remains fixed.
    fitAutomaticWidthToLabels(resolvedLabelRects);
    // A bounded label move may also extend below the initial route footprint.
    if (automaticShowcase) {
      viewBox[1] = heightForLabels(resolvedLabelRects);
      for (const frame of compositionFrames) frame.height = viewBox[1] - layout.stageY - layout.stageBottomPad;
    }

    // Resolve a remaining label and its occupied corridors as one proposal.
    // Earlier valid placements and authored geometry remain authoritative.
    if (automaticShowcase) {
      const proposal = repairLabelRoutes({ labels: resolvedLabelRects,
        routes: routable.map(flow => ({ relation: flow, relationIndex: dataflow.flows.indexOf(flow), points: pathFor(flow).points })),
        nodes: [...nodes.values()], titles: compositionFrames.map(frame => ({ ...frame, height: layout.stageH })),
        frames: compositionFrames, viewBox, placementBottom: viewBox[1] - layout.stageBottomPad,
        sideFor: flowSides });
      if (proposal.labels !== resolvedLabelRects) {
        for (const route of proposal.routes) pathCache.set(route.relation, { points: route.points, d: polylinePath(route.points) });
        for (const [index, rect] of proposal.labels.entries()) {
          resolvedLabelRects[index] = rect;
          resolvedLabelPoints.set(rect.relation, [rect.lx, rect.ly]);
        }
        viewBox[1] = heightForLabels(resolvedLabelRects);
        for (const frame of compositionFrames) frame.height = viewBox[1] - layout.stageY - layout.stageBottomPad;
        resolvedCrossoverFlows.clear();
        for (const [index, left] of routable.entries()) for (const right of routable.slice(index + 1)) {
          if (!related(left, right) && supportsAutomaticCrossover(left) && supportsAutomaticCrossover(right) && crosses(left, right)) {
            resolvedCrossoverFlows.add(left); resolvedCrossoverFlows.add(right);
          }
        }
      }
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
      const inset = node.autoHeightInset || 0;
      const textRows = [{ text: node.label, font: labelFontSize, y: 21 + inset }];
      if (hasSub) textRows.push({ text: node.sublabel, font: sublabelFontSize, y: 37 + inset });
      if (node.tag) textRows.push({ text: node.tag, font: tagFontSize, y: node.height - 11 - inset });
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
      const drilldowns = resolveNodeDrilldowns(node);
      const passport = { drilldowns, href: node.href, kind: node.type, sublabel: node.sublabel, tag: node.tag, context, ...brandMetadataFor(node) };
      const mark = drilldowns.length ? `\n          ${renderDrilldownMark(node)}` : '';
      return wrapSingleChildAnchor(`        <g ${focusNodeAttrs(node.id, node.label, passport, dataflow.meta.locale)}>
          ${focusNodeTitle(node.label, passport)}
          <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="c-mask"/>
          <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="${fill}"${animateAttr(dataflow.meta, 'node', nodeSteps.get(node.id))} stroke-width="1.5"/>
          ${renderSemanticSigil(node.type, { icon: node.icon, x: node.x + 6, y: node.y + labelLayout.sigilY, size: labelLayout.sigilSize })}${brand ? `\n          ${brand}` : ''}
          <text data-node-label=""${hasSub ? ' data-detail-anchor=""' : ''} x="${node.x + labelLayout.x}" y="${node.y + labelLayout.ys[0]}" class="t-primary" font-size="${labelFontSize}" font-weight="600" text-anchor="middle">${esc(node.label)}</text>${sub}${tag}${mark}
        </g>`, drilldowns);
    }

    function flowStrokeWidth(flow) {
      return flow.width || (flow.variant === 'emphasis' ? 1.8 : 1.4);
    }

    function renderFlowPath(flow, index) {
      const [cls, marker] = arrowClassMap[flow.variant || 'default'] || arrowClassMap.default;
      const routed = pathFor(flow);
      const strokeWidth = flowStrokeWidth(flow);
      const automatic = resolvedCrossoverFlows.has(flow);
      const edge = `        <path ${focusEdgeAttrs(flow.from, flow.to, flow.label, index, flow.id)} data-composition-points="${routePointsValue(routed.points)}"${automatic ? ' data-composition-crossover="halo"' : ''}${authoredStraightRouteAttrs(flow, routed.points)} d="${routed.d}" class="${cls}"${animateAttr(dataflow.meta, 'edge', index)} stroke-width="${strokeWidth}" marker-end="url(#${marker})"/>`;
      if (!automatic) return edge;
      return `        <g data-graph-role="automatic-crossover" style="--step:${index}">
          <path data-graph-role="automatic-crossover-underlay" d="${routed.d}" fill="none" stroke="var(--mask)" stroke-width="${strokeWidth + 4}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>
${edge}
        </g>`;
    }

    function renderFlowLabel(flow, index) {
      const routed = pathFor(flow);
      const [lx, ly] = resolvedLabelPoints.get(flow) || labelPoint(flow, routed.points);
      const rect = resolvedLabelRects.find(rect => rect.relation === flow);
      const { width: labelW, height: labelH } = rect || flowLabelSize(flow);
      const lines = rect?.lines;
      const text = lines ? lines.map((line, i) => `<tspan x="${lx}" dy="${i ? 11 : 0}">${esc(line)}</tspan>`).join('') : esc(flow.label);
      const classification = flow.classification
        ? `\n        <text data-detail="fine" x="${lx}" y="${ly + 11 * (lines?.length || 1)}" class="t-dim" font-size="7" text-anchor="middle">${esc(flow.classification)}</text>`
        : '';
      return `        <g data-detail="context" ${focusEdgeAttrs(flow.from, flow.to, flow.label, index, flow.id)}>
          <rect x="${lx - labelW / 2}" y="${ly - 11}" width="${labelW}" height="${labelH}" rx="4" class="c-mask"/>
          <text x="${lx}" y="${ly}" class="${edgeLabelAccent(flow.variant)}" font-size="8" text-anchor="middle">${text}</text>${classification}
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

    function ensureAutoLegendFits() {
      // Narrow auto canvases can wrap the legend onto extra rows. Stage frames
      // fill the canvas height, so growing height alone does not free a legend
      // band — widen just enough for a one-row pack instead.
      if (dataflow.meta?.viewBox) return;
      const presentKinds = new Set(asArray(dataflow.flows).map((flow) => flow.variant || 'default'));
      if ([...nodes.values()].some((node) => node.type === 'database')) presentKinds.add('database');
      const entries = resolveLegend(dataflow.meta?.legend, LEGEND_CATALOG, presentKinds);
      if (!entries.length) return;
      if (legendFootprint(entries, { width: Math.max(1, viewBox[0] - 80) }).extraHeight <= 0) return;
      let width = viewBox[0];
      while (width < 1600
        && legendFootprint(entries, { width: Math.max(1, width - 80) }).extraHeight > 0) {
        width += 40;
      }
      viewBox[0] = width;
    }

    function renderSvg() {
      ensureAutoLegendFits();
      // Same default-canvas contract as lifecycle: 940x720 is below the 1.55 wide
      // ratio, so without intrinsic-height the desktop Reader can neither narrow
      // nor scroll it and every default dataflow fails the browser gate.
      const readerFit = dataflow.meta?.viewBox ? '' : ' data-reader-fit="intrinsic-height"';
      return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}"${readerFit} ${svgRootAttrs(dataflow.meta)} data-motion-choreography="stream">
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
    return renderSvg();
  }

  function attempt(rebalancePorts) {
    return withIsolatedDiagnosticRecording(() => {
      try { return build(rebalancePorts); }
      catch (error) {
        if (error?.archifyDiagnostics) error.archifyDiagnostics = rendererFailure(error).diagnostics;
        throw error;
      }
    });
  }

  try {
    return attempt(false);
  } catch (initial) {
    const layoutFailure = error => error?.archifyDiagnostics?.length
      && error.message.startsWith('Data-flow layout validation failed:');
    if (!layoutFailure(initial)) throw initial;
    try {
      const recovered = attempt(true);
      if (recovered !== null) return recovered;
    } catch (error) {
      // A failed geometry proposal leaves the original actionable diagnosis.
      // Unexpected implementation errors still escape with their own stack.
      if (!layoutFailure(error)) throw error;
    }
    throw initial;
  }
}
