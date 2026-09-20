import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { renderClockTemplate, walkClock } from '../shared/clock-walk.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import {
  throwDiagnosticError,
  throwDiagnosticProblems,
  withDiagnosticRecordingSuppressed,
} from '../shared/diagnostics.mjs';
import { validateSchema } from '../shared/validator.mjs';
import {
  legendFootprint,
  measureLegend,
  relationshipLegendObstacles,
  resolveLegend,
  renderLegend as renderResolvedLegend,
} from '../shared/legend.mjs';
import { availableNodeTextWidth, fittedNodeFontSize, minimumNodeTextWidth } from '../shared/text-fit.mjs';
import { brandLabelFitWidth, brandMetadataFor, brandTopRailProblem, renderBrandMark } from '../shared/brand-marks.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import {
  createMappedWorkflowCandidate,
  intrinsicWorkflow,
  planningWorkflow,
} from './workflow-migration-geometry.mjs';
import {
  asArray,
  isFinitePoint,
  rectsOverlap,
  segmentIntersectsRect,
  segmentRectClearance,
  cleanEndpointSideProblems,
  cleanFlowProblems,
  cleanCrossingProblems,
  cleanAmbiguousCorridorProblems,
  cleanBorderRunProblems,
  cleanRouteRhythmProblems,
  cleanLabelRouteClearanceProblems,
  collectAmbiguousCorridors,
  collectLabelRouteClearance,
  collectBorderRuns,
  forwardCollinearAnalysisSegments,
  sourceSegmentIndexAtPoint,
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
  componentFill,
  componentText,
  arrowClassMap,
  variantAccent
} from '../shared/geometry.mjs';

const LEGACY_COLUMN_CENTERS = Object.freeze([88, 220, 300, 430, 500, 625]);
const READABLE_CANDIDATE_COST_PRIORITY = Object.freeze([
  'automaticForwardReversePx',
  'properCrossingCount',
  'sharedCorridorPx',
  'labelRouteClearanceDeficit',
  'interiorPreferred28Deficit',
  'bendCount',
  'stretchMilli',
  'canvasGrowthPx',
  'portDisplacementMilli',
  'legacyCoordinateDisplacement',
  'stableCandidateOrdinal',
]);
const MAX_READABLE_LAYOUT_FEEDBACK_ROUNDS = 3;
const GROUP_FRAME_TOP_INSET = 8;
const GROUP_FRAME_BOTTOM_INSET = 4;
const GROUP_LABEL_BASELINE_OFFSET = -2;
const GROUP_LABEL_MASK_ASCENT = 10;
const GROUP_LABEL_MASK_H = 14;
const GROUP_NODE_INSET = 4;

class WorkflowLayoutFeedback extends Error {
  constructor(request) {
    super(`Workflow layout requires ${request.kind} feedback.`);
    this.name = 'WorkflowLayoutFeedback';
    this.request = request;
  }
}

function createLegacyLayout() {
  return {
    contract: 'fixed-v1',
    laneX: 40,
    laneY: 52,
    laneW: 640,
    laneH: 104,
    laneGap: 20,
    laneTitleH: 30,
    colXs: [...LEGACY_COLUMN_CENTERS],
    nodeW: 92,
    nodeH: 52,
    defaultViewBoxWidth: 720,
  };
}

function authoredNodeWidth(node) {
  return Number.isFinite(node?.width) ? node.width : 92;
}

function nodeWidthContributor(node) {
  return `node ${node.id} width ${authoredNodeWidth(node)}px`;
}

function authoredNodeHeight(node) {
  if (Number.isFinite(node?.height)) return node.height;
  return node?.tag ? 68 : 52;
}

// A leg that also states what it costs needs a taller chip: the caption must sit
// on the chip, not on the line it names.
function legStatesCost(edge) {
  return Boolean(edge) && edge.id !== undefined && edge.id !== null && edgeStepMinutes.has(edge.id);
}

function edgeLabelHeight(edge) {
  return legStatesCost(edge) ? 22 : 14;
}

function workflowLabelWidth(label) {
  return Math.max(30, textUnits(label) * 4.8 + 10);
}

function readableGroupBounds(workflow, group, colXs) {
  if (!Number.isInteger(group.fromCol) || !Number.isInteger(group.toCol)
    || group.fromCol < 0 || group.fromCol > group.toCol || group.toCol >= colXs.length) {
    return { x: 0, width: 0, cx: 0 };
  }
  const start = colXs[group.fromCol] - 50;
  const end = colXs[group.toCol] + 50;
  const naturalWidth = end - start;
  const minimumWidth = textUnits(group.label) * 5.6 + 20;
  let width = Math.max(naturalWidth, minimumWidth);
  let left = group.fromCol === group.toCol && width > naturalWidth
    ? start
    : (start + end - width) / 2;
  let right = left + width;
  for (const node of asArray(workflow.nodes)) {
    if (node.lane !== group.lane
      || !Number.isInteger(node.col)
      || node.col < group.fromCol
      || node.col > group.toCol
      || node.col < 0
      || node.col >= colXs.length) continue;
    const halfWidth = authoredNodeWidth(node) / 2;
    left = Math.min(left, colXs[node.col] - halfWidth - GROUP_NODE_INSET);
    right = Math.max(right, colXs[node.col] + halfWidth + GROUP_NODE_INSET);
  }
  width = right - left;
  return { x: left, width, cx: left + width / 2 };
}

function verticalIntervalsOverlap(a, b, clearance = 0) {
  const aCenter = Number(a?.yOffset) || 0;
  const bCenter = Number(b?.yOffset) || 0;
  return Math.abs(aCenter - bCenter)
    < authoredNodeHeight(a) / 2 + authoredNodeHeight(b) / 2 + clearance;
}

function createReadableLayout(workflow, layoutFeedback = {}) {
  // A document that declares its phases as clock ranges owns its axis: the
  // columns are those bands, in the order they were declared. Every other
  // document keeps the six columns it always had.
  const columnCount = phaseAxisColumns(workflow);
  const baselinePitch = 120;
  const columnStart = 94;
  const maxLayoutIterations = 3;
  const channelDetourBudgetPx = 4 * 28;
  const constraints = [];
  const feedbackConstraints = [];
  const channelLabelEdgeKeys = new Set();
  const widthContributors = new Set();
  const heightContributors = new Set();
  const nodes = asArray(workflow.nodes);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (let col = 0; col < columnCount - 1; col += 1) {
    constraints.push({ from: col, to: col + 1, minimum: baselinePitch });
  }
  for (const [key, minimum] of Object.entries(layoutFeedback.rankGapMinimums || {}).sort()) {
    const [from, to] = key.split(':').map(Number);
    constraints.push({
      from,
      to,
      minimum,
      contributors: layoutFeedback.rankGapContributors?.[key]
        || [`rank ${from}→${to} route clearance`],
    });
  }

  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const leftNode = nodes[leftIndex];
      const rightNode = nodes[rightIndex];
      if (leftNode.lane !== rightNode.lane || leftNode.col === rightNode.col) continue;
      if (!verticalIntervalsOverlap(leftNode, rightNode, 8)) continue;
      const fromNode = leftNode.col < rightNode.col ? leftNode : rightNode;
      const toNode = fromNode === leftNode ? rightNode : leftNode;
      constraints.push({
        from: fromNode.col,
        to: toNode.col,
        minimum: authoredNodeWidth(fromNode) / 2 + 8 + authoredNodeWidth(toNode) / 2,
        contributors: [
          `rank ${fromNode.col}→${toNode.col} node width clearance`,
          nodeWidthContributor(fromNode),
          nodeWidthContributor(toNode),
        ],
      });
    }
  }

  for (const edge of asArray(workflow.edges)) {
    const fromNode = nodesById.get(edge.from);
    const toNode = nodesById.get(edge.to);
    if (!fromNode || !toNode || fromNode.lane !== toNode.lane || fromNode.col === toNode.col) continue;
    if (edge.via || edge.channelX !== undefined || edge.channelY !== undefined
      || !['auto', 'straight'].includes(edge.route || 'auto')) continue;
    if ((Number(fromNode.yOffset) || 0) !== (Number(toNode.yOffset) || 0)) continue;
    const earlier = fromNode.col < toNode.col ? fromNode : toNode;
    const later = earlier === fromNode ? toNode : fromNode;
    const labeledDirectClearance = edge.label && !edge.labelAt
      ? Math.max(28, workflowLabelWidth(edge.label) + 8)
      : 28;
    const directLabelExpansionCost = Math.max(0, labeledDirectClearance - 28);
    const canUseAutomaticLabelChannel = edge.label
      && !edge.labelAt
      && (edge.route || 'auto') === 'auto'
      && !edge.fromSide
      && !edge.toSide
      && edge.channelX === undefined
      && edge.channelY === undefined;
    const preferLabelChannel = canUseAutomaticLabelChannel
      && directLabelExpansionCost > channelDetourBudgetPx;
    if (preferLabelChannel) channelLabelEdgeKeys.add(stableValueKey(edge));
    constraints.push({
      from: earlier.col,
      to: later.col,
      minimum: authoredNodeWidth(earlier) / 2 + 28 + authoredNodeWidth(later) / 2,
      contributors: [
        `rank ${earlier.col}→${later.col} direct clearance`,
        `rank ${earlier.col}→${later.col} node width clearance`,
        nodeWidthContributor(earlier),
        nodeWidthContributor(later),
      ],
    });
    if (!preferLabelChannel && labeledDirectClearance > 28) {
      const labelConstraintMinimum = authoredNodeWidth(earlier) / 2
        + labeledDirectClearance
        + authoredNodeWidth(later) / 2;
      feedbackConstraints.push({
        from: earlier.col,
        to: later.col,
        minimum: labelConstraintMinimum,
        contributors: [
          `rank ${earlier.col}→${later.col} direct clearance`,
          `edge ${workflowEdgeName(edge)} label mask`,
          nodeWidthContributor(earlier),
          nodeWidthContributor(later),
        ],
      });
    }
  }

  for (const phase of asArray(workflow.phases)) {
    if (!Number.isInteger(phase.fromCol) || !Number.isInteger(phase.toCol)
      || phase.fromCol < 0 || phase.fromCol > phase.toCol || phase.toCol >= columnCount) continue;
    const minimumWidth = textUnits(phase.label) * 5.6 + 8;
    if (phase.fromCol === phase.toCol) {
      if (phase.toCol < columnCount - 1) {
        constraints.push({
          from: phase.toCol,
          to: phase.toCol + 1,
          minimum: baselinePitch + Math.max(0, minimumWidth - 92),
          contributors: [`phase ${phase.id || phase.label} label span`],
        });
      }
      continue;
    }
    constraints.push({
      from: phase.fromCol,
      to: phase.toCol,
      minimum: Math.max(0, minimumWidth - 92),
      contributors: [`phase ${phase.id || phase.label} label span`],
    });
  }

  for (const group of asArray(workflow.groups)) {
    if (!Number.isInteger(group.fromCol) || !Number.isInteger(group.toCol)
      || group.fromCol < 0 || group.fromCol > group.toCol || group.toCol >= columnCount) continue;
    const minimumWidth = textUnits(group.label) * 5.6 + 20;
    if (group.fromCol === group.toCol) {
      if (group.toCol < columnCount - 1) {
        constraints.push({
          from: group.toCol,
          to: group.toCol + 1,
          minimum: baselinePitch + Math.max(0, minimumWidth - 100),
          contributors: [`group ${group.id || group.label} label span`],
        });
      }
      continue;
    }
    constraints.push({
      from: group.fromCol,
      to: group.toCol,
      minimum: Math.max(0, minimumWidth - 100),
      contributors: [`group ${group.id || group.label} label span`],
    });
  }

  let activeConstraints = [...constraints];
  let colXs;
  let colProvenance;
  for (let iteration = 0; iteration < maxLayoutIterations; iteration += 1) {
    colXs = Array.from({ length: columnCount }, (_, col) => columnStart + col * baselinePitch);
    colProvenance = Array.from({ length: columnCount }, () => new Set());
    const orderedConstraints = activeConstraints
      .filter(({ from, to, minimum }) => (
        Number.isInteger(from) && Number.isInteger(to)
        && from >= 0 && from < to && to < columnCount
        && Number.isFinite(minimum)
      ))
      .sort((a, b) => a.to - b.to || a.from - b.from || a.minimum - b.minimum);
    for (let to = 1; to < columnCount; to += 1) {
      for (const constraint of orderedConstraints) {
        if (constraint.to !== to) continue;
        const candidate = colXs[constraint.from] + constraint.minimum;
        const candidateProvenance = new Set([
          ...colProvenance[constraint.from],
          ...asArray(constraint.contributors),
        ]);
        if (candidate > colXs[to] + 0.0001) {
          colXs[to] = candidate;
          colProvenance[to] = candidateProvenance;
        } else if (Math.abs(candidate - colXs[to]) <= 0.0001
          && candidate > columnStart + to * baselinePitch + 0.0001) {
          for (const contributor of candidateProvenance) colProvenance[to].add(contributor);
        }
      }
    }
    if (iteration > 0 || !feedbackConstraints.length) break;
    activeConstraints = [...activeConstraints, ...feedbackConstraints];
  }

  const firstRankNodes = nodes.filter((node) => node.col === 0);
  const firstExtent = firstRankNodes.reduce(
    (maximum, node) => Math.max(maximum, authoredNodeWidth(node) / 2),
    46,
  );
  const leftInset = 8;
  const leftShift = Math.max(0, 40 + leftInset + firstExtent - colXs[0]);
  if (leftShift) {
    for (let col = 0; col < colXs.length; col += 1) colXs[col] += leftShift;
    for (const node of firstRankNodes) {
      if (Math.abs(authoredNodeWidth(node) / 2 - firstExtent) > 0.0001) continue;
      for (const provenance of colProvenance) provenance.add(nodeWidthContributor(node));
    }
  }

  const unpinnedTopEndpointIds = new Set();
  for (const edge of asArray(workflow.edges)) {
    const preservesHorizontalPins = Array.isArray(edge.via) || edge.channelX !== undefined;
    if (preservesHorizontalPins) continue;
    if (edge.fromSide === 'top') unpinnedTopEndpointIds.add(edge.from);
    if (edge.toSide === 'top') unpinnedTopEndpointIds.add(edge.to);
  }
  const laneOrder = new Map(asArray(workflow.lanes).map((lane, index) => [lane.id, index]));
  let laneHeaderShift = 0;
  const laneHeaderShiftContributors = new Set();
  for (const nodeId of unpinnedTopEndpointIds) {
    const node = nodesById.get(nodeId);
    if (!node || !Number.isInteger(node.col) || node.col < 0 || node.col >= columnCount) continue;
    const lanePosition = laneOrder.get(node.lane);
    const lane = asArray(workflow.lanes)[lanePosition];
    if (!lane) continue;
    const prefix = lane.variant === 'exception'
      ? 'EX'
      : String(lanePosition + 1).padStart(2, '0');
    const laneHeaderRight = 40 + 14 + textUnits(`${prefix} / ${lane.label}`) * 6.2;
    const requiredShift = laneHeaderRight + 2 - colXs[node.col];
    if (requiredShift > laneHeaderShift + 0.0001) {
      laneHeaderShift = requiredShift;
      laneHeaderShiftContributors.clear();
      laneHeaderShiftContributors.add(`lane ${lane.id} label width`);
    } else if (requiredShift > 0 && Math.abs(requiredShift - laneHeaderShift) <= 0.0001) {
      laneHeaderShiftContributors.add(`lane ${lane.id} label width`);
    }
  }
  if (laneHeaderShift > 0) {
    for (let col = 0; col < colXs.length; col += 1) colXs[col] += laneHeaderShift;
    for (const provenance of colProvenance) {
      for (const contributor of laneHeaderShiftContributors) provenance.add(contributor);
    }
  }

  let measuredContentLeftShift = asArray(workflow.edges).reduce((maximum, edge) => {
    if (!channelLabelEdgeKeys.has(stableValueKey(edge))) return maximum;
    const fromNode = nodesById.get(edge.from);
    const toNode = nodesById.get(edge.to);
    if (!fromNode || !toNode) return maximum;
    const labelCenter = (colXs[fromNode.col] + colXs[toNode.col]) / 2;
    const labelLeft = labelCenter - workflowLabelWidth(edge.label) / 2;
    return Math.max(maximum, 16 - labelLeft);
  }, 0);
  for (const phase of asArray(workflow.phases)) {
    if (!Number.isInteger(phase.fromCol) || !Number.isInteger(phase.toCol)) continue;
    const width = Math.max(
      colXs[phase.toCol] - colXs[phase.fromCol] + 92,
      textUnits(phase.label) * 5.6 + 8,
    );
    const left = phase.fromCol === phase.toCol
      ? colXs[phase.fromCol] - 46
      : (colXs[phase.fromCol] + colXs[phase.toCol] - width) / 2;
    measuredContentLeftShift = Math.max(measuredContentLeftShift, 16 - left);
  }
  for (const group of asArray(workflow.groups)) {
    if (!Number.isInteger(group.fromCol) || !Number.isInteger(group.toCol)) continue;
    const bounds = readableGroupBounds(workflow, group, colXs);
    measuredContentLeftShift = Math.max(measuredContentLeftShift, 44 - bounds.x);
  }
  if (measuredContentLeftShift > 0) {
    for (let col = 0; col < colXs.length; col += 1) colXs[col] += measuredContentLeftShift;
  }

  let rightmost = colXs.at(-1) + 50;
  let rightmostContributors = new Set(colProvenance.at(-1));
  for (const node of nodes) {
    if (!Number.isInteger(node.col) || node.col < 0 || node.col >= columnCount) continue;
    const nodeRight = colXs[node.col] + authoredNodeWidth(node) / 2;
    const nodeContributors = new Set([
      ...colProvenance[node.col],
      nodeWidthContributor(node),
    ]);
    if (nodeRight > rightmost + 0.0001) {
      rightmost = nodeRight;
      rightmostContributors = nodeContributors;
    } else if (Math.abs(nodeRight - rightmost) <= 0.0001) {
      for (const contributor of nodeContributors) rightmostContributors.add(contributor);
    }
  }
  for (const group of asArray(workflow.groups)) {
    if (!Number.isInteger(group.fromCol) || !Number.isInteger(group.toCol)) continue;
    const bounds = readableGroupBounds(workflow, group, colXs);
    const groupRight = bounds.x + bounds.width;
    const groupContributors = new Set([
      ...colProvenance[group.fromCol],
      ...colProvenance[group.toCol],
      `group ${group.id || group.label} label span`,
      ...nodes
        .filter((node) => node.lane === group.lane
          && node.col >= group.fromCol && node.col <= group.toCol)
        .map(nodeWidthContributor),
    ]);
    if (groupRight > rightmost + 0.0001) {
      rightmost = groupRight;
      rightmostContributors = groupContributors;
    } else if (Math.abs(groupRight - rightmost) <= 0.0001) {
      for (const contributor of groupContributors) rightmostContributors.add(contributor);
    }
  }
  const widestLaneLabel = asArray(workflow.lanes).reduce((widest, lane, index) => {
    const width = textUnits(`${String(index + 1).padStart(2, '0')} / ${lane.label}`) * 6.2 + 30;
    return width > widest.width ? { width, lane } : widest;
  }, { width: 0, lane: null });
  const laneLabelWidth = widestLaneLabel.width;
  const rightmostLaneWidth = Math.ceil(rightmost - 40 + 8);
  const laneW = Math.max(
    640,
    rightmostLaneWidth,
    Math.ceil(laneLabelWidth),
  );
  if (laneW > 640) {
    if (rightmostLaneWidth === laneW) {
      for (const contributor of rightmostContributors) widthContributors.add(contributor);
    }
    if (Math.ceil(laneLabelWidth) === laneW && widestLaneLabel.lane) {
      widthContributors.add(`lane ${widestLaneLabel.lane.id || widestLaneLabel.lane.label} label width`);
    }
  }
  let maxVerticalExtent = 0;
  const verticalExtentContributors = new Set();
  for (const node of nodes) {
    const yOffset = Number(node.yOffset) || 0;
    const extent = authoredNodeHeight(node) / 2 + Math.abs(yOffset);
    const contributor = `node ${node.id} height ${authoredNodeHeight(node)}px${yOffset ? ` with yOffset ${yOffset}px` : ''}`;
    if (extent > maxVerticalExtent + 0.0001) {
      maxVerticalExtent = extent;
      verticalExtentContributors.clear();
      verticalExtentContributors.add(contributor);
    } else if (Math.abs(extent - maxVerticalExtent) <= 0.0001) {
      verticalExtentContributors.add(contributor);
    }
  }
  const baseContentH = Math.max(74, Math.ceil(maxVerticalExtent * 2 + 8));
  const laneH = 30 + baseContentH;
  const groupsByLane = new Map();
  for (const group of asArray(workflow.groups)) {
    groupsByLane.set(group.lane, [...(groupsByLane.get(group.lane) || []), group]);
  }
  const groupLaneReserves = asArray(workflow.lanes).map((lane) => {
    let header = 0;
    let footer = 0;
    for (const group of groupsByLane.get(lane.id) || []) {
      const bounds = readableGroupBounds(workflow, group, colXs);
      const labelLeft = bounds.x + 10;
      const labelRight = labelLeft + textUnits(group.label) * 5.6;
      for (const node of nodes) {
        if (node.lane !== group.lane
          || !Number.isInteger(node.col)
          || node.col < group.fromCol
          || node.col > group.toCol
          || node.col < 0
          || node.col >= colXs.length) continue;
        const halfWidth = authoredNodeWidth(node) / 2;
        const nodeLeft = colXs[node.col] - halfWidth;
        const nodeRight = colXs[node.col] + halfWidth;
        const overlapsLabel = nodeRight > labelLeft && nodeLeft < labelRight;
        const topOffset = (baseContentH - authoredNodeHeight(node)) / 2
          + (Number(node.yOffset) || 0);
        const minimumTopOffset = overlapsLabel ? 11 : 9;
        header = Math.max(header, Math.ceil(minimumTopOffset - topOffset));
        const bottomMargin = baseContentH - GROUP_FRAME_BOTTOM_INSET
          - topOffset - authoredNodeHeight(node);
        footer = Math.max(footer, Math.ceil(1 - bottomMargin));
      }
    }
    return { header: Math.max(0, header), footer: Math.max(0, footer) };
  });
  const groupHeaderHeights = groupLaneReserves.map(({ header }) => header);
  const groupFooterHeights = groupLaneReserves.map(({ footer }) => footer);
  const laneHeights = groupLaneReserves.map(({ header, footer }) => laneH + header + footer);
  const laneGap = Math.max(20, Math.ceil(layoutFeedback.laneGapMin || 0));
  for (const [index, reserve] of groupHeaderHeights.entries()) {
    if (!reserve) continue;
    const lane = asArray(workflow.lanes)[index];
    heightContributors.add(`lane ${lane.id || lane.label} group label clearance ${reserve}px`);
  }
  for (const [index, reserve] of groupFooterHeights.entries()) {
    if (!reserve) continue;
    const lane = asArray(workflow.lanes)[index];
    heightContributors.add(`lane ${lane.id || lane.label} group frame containment ${reserve}px`);
  }
  if (laneH > 104) {
    for (const contributor of verticalExtentContributors) heightContributors.add(contributor);
  }
  if (laneGap > 20) {
    for (const contributor of asArray(layoutFeedback.laneGapContributors)) {
      heightContributors.add(contributor);
    }
  }
  const requiredWidth = 40 + laneW + 16;

  return {
    contract: 'readable-v2',
    laneX: 40,
    laneY: 52,
    laneW,
    laneH,
    laneHeights,
    laneGap,
    laneTitleH: 30,
    groupHeaderHeights,
    groupFooterHeights,
    colXs,
    nodeW: 92,
    nodeH: 52,
    defaultViewBoxWidth: requiredWidth,
    channelLabelEdgeKeys,
    widthContributors: [...widthContributors].sort(stableCompare),
    heightContributors: [...heightContributors].sort(stableCompare),
  };
}

function compilerFailure(contract, diagnostics, error = diagnostics.map(({ message }) => message).join('\n')) {
  return {
    ok: false,
    error,
    diagnostics,
    receipt: { contract, diagnostics },
  };
}

function workflowEdgeName(edge) {
  return edge.id || `${edge.from}->${edge.to}`;
}

function stableText(value) {
  return value == null ? '' : String(value);
}

function stableCompare(left, right) {
  const a = stableText(left);
  const b = stableText(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function stableValueKey(value) {
  if (Array.isArray(value)) return `[${value.map(stableValueKey).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(stableCompare).map((key) => `${JSON.stringify(key)}:${stableValueKey(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function cloneWorkflow(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalReadableWorkflow(workflow) {
  if (workflow.schema_version !== 2) return workflow;
  const laneOrder = new Map(asArray(workflow.lanes).map((lane, index) => [lane.id, index]));
  const nodes = [...asArray(workflow.nodes)].sort((left, right) => (
    (laneOrder.get(left.lane) ?? Number.MAX_SAFE_INTEGER) - (laneOrder.get(right.lane) ?? Number.MAX_SAFE_INTEGER)
    || left.col - right.col
    || stableCompare(left.id, right.id)
  ));
  const edges = [...asArray(workflow.edges)].sort((left, right) => (
    stableCompare(left.id, right.id)
    || stableCompare(left.from, right.from)
    || stableCompare(left.to, right.to)
    || stableCompare(left.label, right.label)
    || stableCompare(left.route, right.route)
    || stableCompare(stableValueKey(left), stableValueKey(right))
  ));
  // A phase that declares its extent in columns is ordered by those columns. A
  // phase that declares a clock range keeps the order the document wrote,
  // because that order is the axis.
  const phases = workflow.phases === undefined ? undefined : [...asArray(workflow.phases)].sort((left, right) => {
    if (typeof left.from === 'string' || typeof left.to === 'string'
      || typeof right.from === 'string' || typeof right.to === 'string') return 0;
    return left.fromCol - right.fromCol || left.toCol - right.toCol
      || stableCompare(left.id, right.id);
  });
  const groups = workflow.groups === undefined ? undefined : [...asArray(workflow.groups)].sort((left, right) => (
    (laneOrder.get(left.lane) ?? Number.MAX_SAFE_INTEGER) - (laneOrder.get(right.lane) ?? Number.MAX_SAFE_INTEGER)
    || left.fromCol - right.fromCol || left.toCol - right.toCol
    || stableCompare(left.id, right.id)
  ));
  return {
    ...workflow,
    nodes,
    edges,
    ...(phases ? { phases } : {}),
    ...(groups ? { groups } : {}),
  };
}

function semanticContractDiagnostics(workflow) {
  const checks = workflow.semanticChecks;
  if (!checks) return [];

  const nodeIds = new Set(asArray(workflow.nodes).map((node) => node.id));
  const incoming = new Map([...nodeIds].map((id) => [id, 0]));
  const outgoing = new Map([...nodeIds].map((id) => [id, 0]));
  const adjacency = new Map([...nodeIds].map((id) => [id, new Set()]));
  for (const edge of asArray(workflow.edges)) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
    outgoing.set(edge.from, outgoing.get(edge.from) + 1);
    incoming.set(edge.to, incoming.get(edge.to) + 1);
    adjacency.get(edge.from).add(edge.to);
  }

  const diagnostics = [];
  const diagnostic = (code, message, subject, evidence, supportedFixes) => ({
    code,
    severity: 'error',
    message,
    subject: { diagramType: 'workflow', ...subject },
    evidence,
    supportedFixes,
  });
  const referencedNodes = [
    ...asArray(checks.allowedRoots).map((id, index) => ({ id, path: `/semanticChecks/allowedRoots/${index}` })),
    ...asArray(checks.allowedTerminals).map((id, index) => ({ id, path: `/semanticChecks/allowedTerminals/${index}` })),
    ...asArray(checks.requiredEdges).flatMap((relation, index) => [
      { id: relation.from, path: `/semanticChecks/requiredEdges/${index}/from` },
      { id: relation.to, path: `/semanticChecks/requiredEdges/${index}/to` },
    ]),
    ...asArray(checks.requiredPaths).flatMap((relation, index) => [
      { id: relation.from, path: `/semanticChecks/requiredPaths/${index}/from` },
      { id: relation.to, path: `/semanticChecks/requiredPaths/${index}/to` },
    ]),
  ];
  for (const { id, path } of referencedNodes) {
    if (nodeIds.has(id)) continue;
    diagnostics.push(diagnostic(
      'workflow/semantic-node-reference',
      `Workflow semantic contract references unknown node "${id}" at ${path}.`,
      { node: id, path },
      { knownNodes: [...nodeIds] },
      [`replace "${id}" with an existing node id`, 'add the missing node before compiling'],
    ));
  }
  if (diagnostics.length) return diagnostics;

  if (checks.allowedRoots !== undefined) {
    const allowed = new Set(checks.allowedRoots);
    for (const [node, count] of incoming) {
      if (count > 0 || allowed.has(node)) continue;
      diagnostics.push(diagnostic(
        'workflow/unexpected-root',
        `Workflow node "${node}" has no incoming edge and is not declared in semanticChecks.allowedRoots.`,
        { node, path: '/semanticChecks/allowedRoots' },
        { incomingEdges: 0, allowedRoots: [...allowed] },
        [`add the missing incoming edge to "${node}"`, `declare "${node}" in semanticChecks.allowedRoots if it is an intentional source`],
      ));
    }
  }

  if (checks.allowedTerminals !== undefined) {
    const allowed = new Set(checks.allowedTerminals);
    for (const [node, count] of outgoing) {
      if (count > 0 || allowed.has(node)) continue;
      diagnostics.push(diagnostic(
        'workflow/unexpected-terminal',
        `Workflow node "${node}" has no outgoing edge and is not declared in semanticChecks.allowedTerminals.`,
        { node, path: '/semanticChecks/allowedTerminals' },
        { outgoingEdges: 0, allowedTerminals: [...allowed] },
        [`add the missing outgoing edge from "${node}"`, `declare "${node}" in semanticChecks.allowedTerminals if it is an intentional sink`],
      ));
    }
  }

  const authoredEdges = new Set(asArray(workflow.edges).map((edge) => `${edge.from}\u0000${edge.to}`));
  for (const [index, relation] of asArray(checks.requiredEdges).entries()) {
    if (authoredEdges.has(`${relation.from}\u0000${relation.to}`)) continue;
    diagnostics.push(diagnostic(
      'workflow/required-edge',
      `Workflow semantic contract requires edge "${relation.from}" -> "${relation.to}", but no authored edge matches it.`,
      { from: relation.from, to: relation.to, path: `/semanticChecks/requiredEdges/${index}` },
      { authoredEdgeCount: asArray(workflow.edges).length },
      [`add an edge from "${relation.from}" to "${relation.to}" without deleting the semantic requirement`],
    ));
  }

  function reachable(from, to) {
    const visited = new Set([from]);
    const pending = [from];
    while (pending.length) {
      const current = pending.shift();
      if (current === to) return true;
      for (const next of adjacency.get(current) || []) {
        if (visited.has(next)) continue;
        visited.add(next);
        pending.push(next);
      }
    }
    return false;
  }

  for (const [index, relation] of asArray(checks.requiredPaths).entries()) {
    if (reachable(relation.from, relation.to)) continue;
    diagnostics.push(diagnostic(
      'workflow/required-path',
      `Workflow semantic contract requires a directed path from "${relation.from}" to "${relation.to}", but none exists.`,
      { from: relation.from, to: relation.to, path: `/semanticChecks/requiredPaths/${index}` },
      { reachableNodes: [...new Set([relation.from, ...(adjacency.get(relation.from) || [])])] },
      [`restore a directed path from "${relation.from}" to "${relation.to}" without weakening the semantic requirement`],
    ));
  }

  return diagnostics;
}

// Content-layer derivation. The core knows none of the domain's field names:
// a rule names the facts it accumulates, where each chain starts, and how the
// derived value is rendered. A document without rules returns immediately, so
// every existing artifact keeps its bytes.
function ruleFactValue(element, name) {
  if (!name) return 0;
  const bag = element && element.facts;
  const value = bag ? bag[name] : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function ruleSeedValue(base) {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(String(base));
  return match ? Number(match[1]) * 60 + Number(match[2]) : Number(base);
}

function ruleRenderValue(value, isClock, rule) {
  return renderClockTemplate('{value}', value, { clock: isClock, wrap: rule.wrap });
}

// Select once by the rule's contract, for both compilation and reader replay.
// A lane rule cannot consume a cross-lane edge; an explicit chain can.
function ruleOutgoingEdges(nodes, edges, laneId, scope) {
  const inLane = new Set(nodes.filter(node => node.lane === laneId).map(node => node.id));
  const outgoing = new Map();
  for (const edge of edges) {
    if (scope === 'chain' || (inLane.has(edge.from) && inLane.has(edge.to))) outgoing.set(edge.from, edge);
  }
  return outgoing;
}

// The core keeps seven palette slots; the vocabulary of kinds is the
// document's. A document without meta.types keeps the built-in seven.
const PALETTE_FILL = { cyan: 'c-frontend', green: 'c-backend', violet: 'c-database', amber: 'c-cloud', rose: 'c-security', orange: 'c-messagebus', slate: 'c-external' };
const PALETTE_STROKE_VAR = { cyan: 'frontend', green: 'backend', violet: 'database', amber: 'cloud', rose: 'security', orange: 'messagebus', slate: 'external' };
const PALETTE_TEXT = { cyan: 't-frontend', green: 't-backend', violet: 't-database', amber: 't-cloud', rose: 't-security', orange: 't-messagebus', slate: 't-external' };

function declaredTypeMap(document) {
  return new Map(asArray(document && document.meta && document.meta.types).map((type) => [type.id, type]));
}

function typeFill(document, type) {
  const declared = declaredTypeMap(document).get(type);
  if (declared) return PALETTE_FILL[declared.color] || 'c-external';
  return componentFill[type];
}

function typeText(document, type) {
  const declared = declaredTypeMap(document).get(type);
  if (declared) return PALETTE_TEXT[declared.color] || 't-muted';
  return componentText[type];
}

function typeVocabularyDiagnostics(document) {
  const declared = declaredTypeMap(document);
  const workflow = document;
  if (!declared.size) return [];
  const legacy = new Set(Object.keys(componentFill));
  return asArray(workflow.nodes)
    .filter((node) => !declared.has(node.type) && !legacy.has(node.type))
    .map((node) => ({
      code: 'workflow/unknown-type',
      severity: 'error',
      message: `Node "${node.id}" uses type "${node.type}", which this document does not declare in meta.types.`,
      subject: { diagramType: 'workflow', node: node.id },
      evidence: { type: node.type, declared: [...declared.keys()] },
      supportedFixes: [`declare "${node.type}" in meta.types`, 'or use a declared id'],
    }));
}

// The reader side keeps values, not meanings: a document declares the slots a
// reader may write, and a view naming a slot it never declared is a mistake
// worth reporting rather than silently ignoring.
function readerDiagnostics(document) {
  const reader = document.meta && document.meta.reader;
  if (!reader) return [];
  const declared = new Set(asArray(reader.slots).map((slot) => slot.id));
  const view = reader.view || {};
  const named = (entry) => (typeof entry === 'string' ? entry : entry && typeof entry.slot === 'string' ? entry.slot : null);
  const referenced = [...asArray(view.dim), ...asArray(view.stow)].map(named).filter(Boolean);
  const clock = reader.clock && typeof reader.clock === 'object' ? reader.clock : null;
  if (clock) referenced.push(...[clock.anchor, clock.at, clock.dwell].filter((id) => typeof id === 'string'));
  const rules = asArray(document.meta && document.meta.rules);
  const namedRule = clock && typeof clock.rule === 'string' ? rules.find((rule) => rule.id === clock.rule) : null;
  const ruleProblems = clock && typeof clock.rule === 'string' && !namedRule
    ? [{
        code: 'workflow/unknown-rule',
        severity: 'error',
        message: `meta.reader.clock replays rule "${clock.rule}", which meta.rules does not declare.`,
        subject: { diagramType: 'workflow', path: '/meta/reader/clock', rule: clock.rule },
        evidence: { rule: clock.rule, declared: rules.map((rule) => rule.id) },
        supportedFixes: [`declare rule "${clock.rule}" in meta.rules`, 'or drop meta.reader.clock'],
      }]
    : clock && namedRule.kind !== 'accumulate'
      ? [{
          code: 'workflow/unreplayable-rule',
          severity: 'error',
          message: `meta.reader.clock replays rule "${clock.rule}" of kind "${namedRule.kind}"; only a forward walk can be replayed from a reader's moment.`,
          subject: { diagramType: 'workflow', path: '/meta/reader/clock', rule: clock.rule },
          evidence: { rule: clock.rule, kind: namedRule.kind },
          supportedFixes: ['point the clock at an accumulate rule', 'or drop meta.reader.clock'],
        }]
      : [];
  return [...referenced
    .filter((id) => !declared.has(id))
    .map((id) => ({
      code: 'workflow/unknown-slot',
      severity: 'error',
      message: `meta.reader.view names slot "${id}", which meta.reader.slots does not declare.`,
      subject: { diagramType: 'workflow', path: '/meta/reader/view', slot: id },
      evidence: { slot: id, declared: [...declared] },
      supportedFixes: [`declare "${id}" in meta.reader.slots`, 'or drop the reference'],
    })), ...ruleProblems];
}

// Problems the render pass discovers first-hand — an action row that cannot
// fit, a second rule claiming one render slot — are collected here so the
// check uses exactly the numbers the drawing used.
const renderProblems = [];

const authoredEdgeLabels = new Map();
// What each leg costs, as the rule computed it, for the caption under its label.
const edgeStepMinutes = new Map();
// A rule may write that caption itself ({band} and {minutes}); a leg it does not
// write keeps the minutes it always showed.
const edgeCaptionText = new Map();
// When the rule reaches each stop, as it derived it. A stop the rule derives no
// value for takes part in nothing, so a value-axis phase cannot claim it.
const nodeArrivalValues = new Map();
// Whether any rule derives clock values at all: a band written as a clock range
// has nothing to compare against without one.
let clockValuesDerived = false;

function applyRules(workflow) {
  const rules = asArray(workflow.meta && workflow.meta.rules);
  authoredEdgeLabels.clear();
  edgeStepMinutes.clear();
  edgeCaptionText.clear();
  nodeArrivalValues.clear();
  clockValuesDerived = false;
  if (!rules.length) return [];
  const renderSlots = new Map();
  const diagnostics = [];
  // The words for a stretch of the clock, used by {band} in a render template.
  const banding = clockBandList((workflow.meta && workflow.meta.bands) || []);
  diagnostics.push(...banding.diagnostics);
  const bandWords = banding.bands;
  const bandWarning = { missing: false, outside: new Set() };
  const nodes = asArray(workflow.nodes);
  const edges = asArray(workflow.edges);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const laneById = new Map(asArray(workflow.lanes).map((lane) => [lane.id, lane]));
  const factOf = (element, field) => (element && element.facts && typeof element.facts[field] === 'number'
    ? element.facts[field]
    : null);
  const laneIds = asArray(workflow.lanes).map((lane) => lane.id);
  for (const rule of rules) {
    if (rule.kind === 'window') {
      const bounds = { min: Number.isFinite(rule.min) ? rule.min : -Infinity, max: Number.isFinite(rule.max) ? rule.max : Infinity };
      const scope = rule.scope === 'node' ? nodes : rule.scope === 'edge' ? edges : [...nodes, ...edges];
      // Authored facts are opt-in: an element that never declares the field is
      // simply not a carrier, so a rule stays silent instead of demanding one.
      const carriers = scope.filter((element) => factOf(element, rule.field) !== null);
      for (const element of carriers) {
        const value = factOf(element, rule.field);
        if (value < bounds.min || value > bounds.max) {
          diagnostics.push({
            code: 'constraint/out-of-window',
            severity: 'error',
            message: `Rule "${rule.id}" requires ${rule.field} within [${bounds.min}, ${bounds.max}], but "${element.id}" authors ${value}.`,
            subject: { diagramType: 'workflow', rule: rule.id, node: element.id, edge: element.id },
            evidence: { field: rule.field, value, min: bounds.min, max: bounds.max },
            supportedFixes: [`bring ${rule.field} on ${element.id} inside the declared window`],
          });
        }
      }
      continue;
    }
    if (rule.kind === 'sum') {
      const scope = rule.scope === 'node' ? nodes : rule.scope === 'edge' ? edges : [...nodes, ...edges];
      const carriers = scope.filter((element) => factOf(element, rule.field) !== null);
      const total = carriers.reduce((accumulator, element) => accumulator + factOf(element, rule.field), 0);
      const tolerance = Number.isFinite(rule.tolerance) ? rule.tolerance : 0;
      if (!(Math.abs(total - Number(rule.expect)) <= tolerance)) {
        diagnostics.push({
          code: 'constraint/sum-mismatch',
          severity: 'error',
          message: `Rule "${rule.id}" totals ${rule.field} to ${Math.round(total * 100) / 100}, but the document declares ${rule.expect}.`,
          subject: { diagramType: 'workflow', rule: rule.id },
          evidence: { field: rule.field, total, expect: rule.expect, tolerance, carriers: carriers.map((element) => element.id) },
          supportedFixes: ['correct the contributing facts or the declared total'],
        });
      }
      continue;
    }
    if (rule.kind === 'compare') {
      const scope = rule.on === 'edge' ? edges : rule.on === 'lane' ? asArray(workflow.lanes) : nodes;
      const symbol = rule.op === 'lte' ? '<=' : rule.op === 'gte' ? '>=' : '==';
      for (const element of scope) {
        const left = factOf(element, rule.left);
        const right = factOf(element, rule.right);
        // Either side may be undeclared: that element simply is not comparable.
        if (left === null || right === null) continue;
        const holds = rule.op === 'lte' ? left <= right : rule.op === 'gte' ? left >= right : left === right;
        if (!holds) {
          diagnostics.push({
            code: 'constraint/compare-failed',
            severity: 'error',
            message: `Rule "${rule.id}" requires ${rule.left} ${symbol} ${rule.right} on ${element.id}, but ${left} vs ${right}.`,
            subject: { diagramType: 'workflow', rule: rule.id, node: element.id, edge: element.id },
            evidence: { left: rule.left, leftValue: left, op: rule.op, right: rule.right, rightValue: right },
            supportedFixes: [`reconcile ${rule.left} and ${rule.right} on ${element.id}`],
          });
        }
      }
      continue;
    }
    if (rule.kind === 'require') {
      const scope = rule.on === 'edge' ? edges : rule.on === 'lane' ? asArray(workflow.lanes) : nodes;
      for (const element of scope) {
        if (factOf(element, rule.field) === null) {
          diagnostics.push({
            code: 'constraint/missing-fact',
            severity: 'error',
            message: `Rule "${rule.id}" requires fact "${rule.field}" on every ${rule.on || 'node'}, but "${element.id}" does not author it.`,
            subject: { diagramType: 'workflow', rule: rule.id, node: element.id, edge: element.id, lane: element.id },
            evidence: { field: rule.field, on: rule.on || 'node' },
            supportedFixes: [`author facts.${rule.field} on ${element.id}`],
          });
        }
      }
      continue;
    }
    const seeds = rule.seeds && typeof rule.seeds === 'object' ? rule.seeds : {};
    for (const [laneId, seed] of Object.entries(seeds)) {
      if (!seed || typeof seed !== 'object') continue;
      const lane = laneById.get(laneId);
      const crossLane = rule.scope === 'chain';
      // A chain either stays inside one seeded lane, or follows the authored
      // edges anywhere. Naming something that does not exist is an error, not
      // a silent skip: a rule that quietly does nothing is worse than one that
      // reports why it could not run.
      if (!crossLane && !lane) {
        diagnostics.push({
          code: 'derive/unknown-lane',
          severity: 'error',
          message: `Rule "${rule.id}" seeds "${laneId}", which is neither a lane nor a scope=chain name.`,
          subject: { diagramType: 'workflow', rule: rule.id, lane: laneId },
          evidence: { seeds: Object.keys(seeds), lanes: [...laneById.keys()] },
          supportedFixes: ['seed an existing lane id', 'or set scope: "chain" to follow edges across lanes'],
        });
        continue;
      }
      if (!nodeById.has(seed.start)) {
        diagnostics.push({
          code: 'derive/unknown-seed',
          severity: 'error',
          message: `Rule "${rule.id}" starts "${laneId}" from node "${seed.start}", which does not exist.`,
          subject: { diagramType: 'workflow', rule: rule.id, lane: laneId },
          evidence: { start: seed.start },
          supportedFixes: ['point the seed at an existing node id'],
        });
        continue;
      }
      const laneIds = crossLane ? new Set(nodes.map((node) => node.id)) : new Set(nodes.filter((node) => node.lane === laneId).map((node) => node.id));
      if (!crossLane && !laneIds.has(seed.start)) {
        diagnostics.push({
          code: 'derive/seed-outside-lane',
          severity: 'error',
          message: `Rule "${rule.id}" seeds lane "${laneId}" from node "${seed.start}", which is not in that lane.`,
          subject: { diagramType: 'workflow', rule: rule.id, lane: laneId },
          evidence: { start: seed.start },
          supportedFixes: ['point the seed at a node of the same lane', 'or set scope: "chain"'],
        });
        continue;
      }
      // A chain usually stays inside one lane, but real processes cross lanes.
      // scope=chain follows the authored edges wherever they go; the default
      // keeps the walk inside the seeded lane.
      const outgoing = ruleOutgoingEdges(nodes, edges, laneId, rule.scope);
      const isClock = typeof seed.base === 'string';
      if (isClock) clockValuesDerived = true;
      // {value} is the derived number, {band} the word its stretch of the clock
      // carries. A template asking for a band the document never declared, or a
      // value no band covers, is reported rather than left blank.
      const renderTemplate = (template, value, minutes) => {
        const render = () => renderClockTemplate(template, value, { clock: isClock, wrap: rule.wrap, bands: bandWords, minutes });
        if (!String(template).includes('{band}')) return render();
        if (!bandWords.length) {
          if (!bandWarning.missing) {
            bandWarning.missing = true;
            diagnostics.push({
              code: 'derive/band-not-declared',
              severity: 'error',
              message: `Rule "${rule.id}" renders {band}, but the document declares no meta.bands.`,
              subject: { diagramType: 'workflow', rule: rule.id, path: '/meta/bands' },
              evidence: { template: String(template) },
              supportedFixes: ['declare meta.bands with a label and two clock ends', 'or render the value alone'],
            });
          }
          return render();
        }
        const band = clockBandAt(bandWords, value);
        if (!band) {
          const key = `${rule.id}:${value}`;
          if (!bandWarning.outside.has(key)) {
            bandWarning.outside.add(key);
            diagnostics.push({
              code: 'derive/band-out-of-range',
              severity: 'error',
              message: `Rule "${rule.id}" reaches ${showClock(value, workflow)}, which falls in no declared band.`,
              subject: { diagramType: 'workflow', rule: rule.id, value },
              evidence: { value, bands: bandWords.map((entry) => `${entry.entry.from}-${entry.entry.to}`) },
              supportedFixes: ['widen a band to cover this value', 'or declare the band it belongs to'],
            });
          }
          return render();
        }
        return render();
      };
      let value = ruleSeedValue(seed.base);
      let current = nodeById.get(seed.start);
      const seen = new Set();
      // A stop's own value is the value it is reached at, not the one it is left
      // at: the seed is reached at its base, and every later stop at the value
      // standing on the leg that arrives there.
      if (isClock && !nodeArrivalValues.has(seed.start)) nodeArrivalValues.set(seed.start, value);
      while (current && !seen.has(current.id)) {
        seen.add(current.id);
        const nodeFact = ruleFactValue(current, rule.add && rule.add.node);
        if (nodeFact === null && rule.missing === 'error') {
          diagnostics.push({
            code: 'derive/missing-fact',
            severity: 'error',
            message: `Rule "${rule.id}" adds node fact "${rule.add.node}", but node "${current.id}" does not author it.`,
            subject: { diagramType: 'workflow', rule: rule.id, node: current.id, lane: laneId },
            evidence: { fact: rule.add.node, facts: Object.keys(current.facts || {}) },
            supportedFixes: [`author facts.${rule.add.node} on ${current.id}`, 'or drop that fact from the rule'],
          });
          break;
        }
        value += nodeFact === null ? 0 : nodeFact;
        const leg = outgoing.get(current.id);
        if (!leg) break;
        const edgeFact = ruleFactValue(leg, rule.add && rule.add.edge);
        if (edgeFact === null && rule.missing === 'error') {
          diagnostics.push({
            code: 'derive/missing-fact',
            severity: 'error',
            message: `Rule "${rule.id}" adds edge fact "${rule.add.edge}", but edge "${leg.id || `${leg.from}->${leg.to}`}" does not author it.`,
            subject: { diagramType: 'workflow', rule: rule.id, edge: leg.id, lane: laneId },
            evidence: { fact: rule.add.edge, from: leg.from, to: leg.to },
            supportedFixes: [`author facts.${rule.add.edge} on that leg`],
          });
          break;
        }
        value += edgeFact === null ? 0 : edgeFact;
        if (rule.limit && Number.isFinite(rule.limit.max) && value > rule.limit.max) {
          diagnostics.push({
            code: 'derive/limit-exceeded',
            severity: 'error',
            message: `Rule "${rule.id}" reaches ${ruleRenderValue(value, isClock, rule)} in lane "${laneId}", past its declared limit.`,
            subject: { diagramType: 'workflow', rule: rule.id, edge: leg.id, lane: laneId },
            evidence: { value, limit: rule.limit.max, at: leg.to },
            supportedFixes: ['shorten the chain, raise the limit, or split the lane'],
          });
          break;
        }
        if (rule.render && rule.render.edge) {
          const claimed = renderSlots.get(leg.id);
          if (claimed && claimed !== rule.id) {
            // One render slot, one contributor. Stacking two prefixes turns a
            // readable label into two half-labels, so the second rule reports
            // instead of silently appending.
            diagnostics.push({
              code: 'derive/render-slot-conflict',
              severity: 'error',
              message: `Edge "${leg.id || `${leg.from}->${leg.to}`}" already renders "${claimed}"; rule "${rule.id}" cannot also write its label.`,
              subject: { diagramType: 'workflow', rule: rule.id, edge: leg.id, lane: laneId },
              evidence: { claimedBy: claimed, edge: leg.id, from: leg.from, to: leg.to },
              supportedFixes: [`drop the render template from rule "${rule.id}"`, 'or merge both quantities into one rule'],
            });
            break;
          }
          if (!claimed) renderSlots.set(leg.id, rule.id);
          if (!authoredEdgeLabels.has(leg.id)) authoredEdgeLabels.set(leg.id, leg.label || '');
          if (typeof edgeFact === 'number' && Number.isFinite(edgeFact)) edgeStepMinutes.set(leg.id, edgeFact);
          leg.label = `${renderTemplate(rule.render.edge, value)}${leg.label || ''}`;
        }
        if (rule.render && rule.render.caption) {
          const claimed = renderSlots.get('caption:' + leg.id);
          if (claimed && claimed !== rule.id) {
            diagnostics.push({
              code: 'derive/render-slot-conflict',
              severity: 'error',
              message: `Edge "${leg.id || `${leg.from}->${leg.to}`}" already renders caption "${claimed}"; rule "${rule.id}" cannot also write its caption.`,
              subject: { diagramType: 'workflow', rule: rule.id, edge: leg.id, lane: laneId },
              evidence: { claimedBy: claimed, slot: 'caption', edge: leg.id, from: leg.from, to: leg.to },
              supportedFixes: [`drop render.caption from rule "${rule.id}"`, 'or merge both quantities into one rule'],
            });
            break;
          }
          if (!claimed) {
            renderSlots.set('caption:' + leg.id, rule.id);
            edgeCaptionText.set(leg.id, renderTemplate(rule.render.caption, value, edgeFact).trim());
          }
        }
        if (isClock && !nodeArrivalValues.has(leg.to)) nodeArrivalValues.set(leg.to, value);
        current = nodeById.get(leg.to);
      }
      if (rule.render && rule.render.lane) {
        const laneClaim = renderSlots.get('lane:' + laneId);
        if (laneClaim && laneClaim !== rule.id) {
          // Two rules prefixing one lane title is the same defect as two rules
          // prefixing one edge label: one render slot, one contributor.
          diagnostics.push({
            code: 'derive/render-slot-conflict',
            severity: 'error',
            message: `Lane "${laneId}" already renders "${laneClaim}"; rule "${rule.id}" cannot also write its title.`,
            subject: { diagramType: 'workflow', rule: rule.id, lane: laneId },
            evidence: { claimedBy: laneClaim, lane: laneId },
            supportedFixes: [`drop the render.lane template from rule "${rule.id}"`, 'or merge both quantities into one rule'],
          });
        } else if (!laneClaim) {
          renderSlots.set('lane:' + laneId, rule.id);
          // The authored name keeps its identity; a derived clock is status that
          // the reader controls must not swallow.
          if (lane.readerLabel === undefined) lane.readerLabel = lane.label;
          lane.label = `${lane.label} ${renderTemplate(rule.render.lane, ruleSeedValue(seed.base))}`;
        }
      }
    }
  }
  return diagnostics;
}

// A phase may declare its extent the way it always could — in columns — or in
// the value the document derives. The second form makes the column a result: a
// stop stands where its own number falls, and a number that falls in no band is
// named instead of quietly keeping whatever column the author typed. A document
// that declares no such band is untouched, byte for byte.
function phaseAxisColumns(workflow) {
  const phases = asArray(workflow.phases);
  const valueBands = phases.length > 0
    && phases.every((phase) => typeof phase.from === 'string' && typeof phase.to === 'string');
  if (!valueBands) return 6;
  // The bands were packed into columns by placePhases; the axis is as wide as
  // the widest resolved band reaches.
  const last = Math.max(...phases.map((phase) => (Number.isInteger(phase.toCol) ? phase.toCol : 0)));
  return Math.max(1, last + 1);
}

function clockMinutes(text) {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(String(text));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function showClock(minutes, workflow) {
  // One formatter for the text a person reads. The shape comes from the shared
  // template, the word comes from the catalogue, so a diagnostic and the
  // artifact it explains cannot disagree about what "past midnight" is called.
  const wrapped = minutes >= 1440;
  const within = ((minutes % 1440) + 1440) % 1440;
  const label = i18nText(workflow.meta.locale, 'workflow.clock.pastMidnight', {}, workflow.meta.labels);
  return renderClockTemplate('{value}', wrapped ? 1440 + within : within, {
    clock: true,
    wrap: { at: 1440, label },
  });
}

function placePhases(workflow) {
  const phases = asArray(workflow.phases);
  if (!phases.length) return [];
  const declaresValue = (phase) => typeof phase.from === 'string' || typeof phase.to === 'string';
  const declaresColumn = (phase) => Number.isInteger(phase.fromCol) || Number.isInteger(phase.toCol);
  if (!phases.some(declaresValue)) {
    // The column form, the shape this pipeline has always spoken. A phase that
    // declares no extent at all cannot be drawn either way, and silence would
    // leave the axis to whatever the author happened to type.
    const incomplete = phases.filter((phase) => !declaresColumn(phase));
    return incomplete.length ? [{
      code: 'workflow/phase-extent-missing',
      severity: 'error',
      message: `Phase "${incomplete[0].id}" declares no extent; a phase needs either fromCol/toCol or from/to.`,
      subject: { diagramType: 'workflow', path: '/phases', phase: incomplete[0].id },
      evidence: { phases: incomplete.map((phase) => phase.id) },
      supportedFixes: ['declare fromCol/toCol', 'or declare a clock range with from/to'],
    }] : [];
  }
  const diagnostics = [];
  if (!phases.every((phase) => typeof phase.from === 'string' && typeof phase.to === 'string')) {
    diagnostics.push({
      code: 'workflow/phase-extent-mixed',
      severity: 'error',
      message: 'Phases must declare their extent one way: either fromCol/toCol or from/to.',
      subject: { diagramType: 'workflow', path: '/phases' },
      evidence: {
        values: phases.filter(declaresValue).map((phase) => phase.id),
        columns: phases.filter((phase) => !declaresValue(phase)).map((phase) => phase.id),
      },
      supportedFixes: ['give every phase a from/to pair', 'or keep every phase on fromCol/toCol'],
    });
    return diagnostics;
  }
  if (!clockValuesDerived) {
    diagnostics.push({
      code: 'workflow/phase-band-source',
      severity: 'error',
      message: 'A phase declared as a clock range needs a rule that derives clock values; this document derives none.',
      subject: { diagramType: 'workflow', path: '/phases' },
      evidence: { phases: phases.map((phase) => phase.id) },
      supportedFixes: [
        'seed an accumulate rule with a clock base, for example { "start": "<node>", "base": "09:00" }',
        'or declare every phase extent in columns',
      ],
    });
    return diagnostics;
  }
  const listed = clockBandList(phases);
  if (listed.diagnostics.length) return listed.diagnostics;
  const bands = listed.bands.map((band, index) => ({
    phase: band.entry, index, from: band.from, to: band.to, wraps: band.wraps,
  }));
  // Every stop the rule reaches belongs to the band its own number falls in.
  const window = (band) => (band.wraps ? [band.from, 1440 + band.to] : [band.from, band.to]);
  const reached = [];
  const demand = bands.map(() => new Map());
  for (const node of asArray(workflow.nodes)) {
    const value = nodeArrivalValues.get(node.id);
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const found = bands.findIndex((band) => {
      const [low, high] = window(band);
      return value >= low && value <= high;
    });
    if (found === -1) {
      // Never clamped: a stop the axis cannot place is named, not jammed into the
      // first or the last band.
      diagnostics.push({
        code: 'workflow/phase-out-of-range',
        severity: 'error',
        message: `Node "${node.id}" reaches ${showClock(value, workflow)}, which falls in no declared phase band.`,
        subject: { diagramType: 'workflow', path: '/nodes', node: node.id },
        evidence: {
          value,
          bands: bands.map((band) => `${band.phase.from}-${band.phase.to}${band.wraps ? ' (crosses midnight)' : ''}`),
        },
        supportedFixes: ['widen a band to cover this stop', 'or declare the band this stop belongs to'],
      });
      continue;
    }
    reached.push({ node, band: found, value, order: reached.length });
    const lane = demand[found];
    lane.set(node.lane, (lane.get(node.lane) || 0) + 1);
  }
  // The axis is as wide as the schedule needs: a band holds as many columns as
  // the busiest lane puts stops in it — never fewer than one, so a band the day
  // skipped still shows that it was skipped. The width follows the times; the
  // times do not bend to a width fixed in advance.
  let cursor = 0;
  const starts = [];
  bands.forEach((band, index) => {
    const width = Math.max(1, ...demand[index].values());
    starts.push(cursor);
    cursor += width;
    band.phase.fromCol = starts[index];
    band.phase.toCol = starts[index] + width - 1;
  });
  // Inside a band the columns are handed out in the order the clock reaches the
  // stops, lane by lane, so equal times keep the order they were authored in.
  const taken = new Map();
  reached
    .sort((left, right) => left.band - right.band || left.value - right.value || left.order - right.order)
    .forEach((entry) => {
      const key = `${entry.band}:${entry.node.lane}`;
      const offset = taken.get(key) || 0;
      taken.set(key, offset + 1);
      const column = starts[entry.band] + offset;
      const authored = entry.node.col;
      if (Number.isInteger(authored) && authored !== column) {
        diagnostics.push({
          code: 'workflow/phase-col-conflict',
          severity: 'error',
          message: `Node "${entry.node.id}" authors col ${authored} while its derived value places it in phase "${bands[entry.band].phase.id}".`,
          subject: { diagramType: 'workflow', path: '/nodes', node: entry.node.id },
          evidence: { authored, derived: column, phase: bands[entry.band].phase.id },
          supportedFixes: ['drop node.col and let the value place the stop', 'or move the stop into the band its value falls in'],
        });
        return;
      }
      entry.node.col = column;
    });
  return diagnostics;
}

// A readable workflow places every stop in a column. A stop the rule derives no
// value for has to say where it stands; leaving it out of the canvas silently
// would be the one thing a diagram must not do.
function missingColumnDiagnostics(workflow) {
  const readable = workflow.schema_version === 2;
  return asArray(workflow.nodes)
    .filter((node) => !Number.isInteger(node.col))
    .map((node) => ({
      code: 'workflow/node-col-missing',
      severity: 'error',
      message: `Node "${node.id}" authors no column, so nothing places it.`,
      subject: { diagramType: 'workflow', path: '/nodes', node: node.id },
      evidence: { lane: node.lane, schemaVersion: workflow.schema_version },
      supportedFixes: readable
        ? ['author col on the node', 'or let a clock rule reach it through a declared phase band']
        : ['author col on the node'],
    }));
}

// A group frame says "this stretch of the day has a name". Declared as a clock
// range it covers the stops the clock put inside it, so the frame keeps its
// meaning when the schedule moves; declared in columns it stays authored.
function placeGroupFrames(workflow) {
  const groups = asArray(workflow.groups);
  const diagnostics = [];
  for (const group of groups) {
    const declared = typeof group.from === 'string' || typeof group.to === 'string';
    if (!declared) {
      // A frame with no extent at all cannot be drawn either way; leaving it out
      // of the canvas without a word is the one thing a diagram must not do.
      if (!Number.isInteger(group.fromCol) && !Number.isInteger(group.toCol)) {
        diagnostics.push({
          code: 'workflow/group-extent-missing',
          severity: 'error',
          message: `Group "${group.id}" declares no extent; a frame needs either fromCol/toCol or from/to.`,
          subject: { diagramType: 'workflow', path: '/groups', group: group.id },
          evidence: { lane: group.lane },
          supportedFixes: ['declare fromCol/toCol', 'or declare a clock range with from/to'],
        });
      }
      continue;
    }
    const from = clockMinutes(group.from);
    const to = clockMinutes(group.to);
    if (from === null || to === null) {
      diagnostics.push({
        code: 'workflow/group-band-clock',
        severity: 'error',
        message: `Group "${group.id}" declares from/to that are not clock times.`,
        subject: { diagramType: 'workflow', path: '/groups', group: group.id },
        evidence: { from: group.from, to: group.to },
        supportedFixes: ['write both ends as HH:MM', 'or declare the frame in columns'],
      });
      continue;
    }
    const wraps = from > to;
    const inside = asArray(workflow.nodes).filter((node) => {
      if (node.lane !== group.lane || !Number.isInteger(node.col)) return false;
      const value = nodeArrivalValues.get(node.id);
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      return wraps
        ? value >= from && value <= 1440 + to
        : value >= from && value <= to;
    });
    if (!inside.length) {
      diagnostics.push({
        code: 'workflow/group-band-empty',
        severity: 'error',
        message: `Group "${group.id}" covers no stop of lane "${group.lane}" between ${group.from} and ${group.to}.`,
        subject: { diagramType: 'workflow', path: '/groups', group: group.id },
        evidence: { lane: group.lane, from: group.from, to: group.to },
        supportedFixes: ['widen the range to the stretch it names', 'or move the frame to the lane it describes'],
      });
      continue;
    }
    const columns = inside.map((node) => node.col);
    group.fromCol = Math.min(...columns);
    group.toCol = Math.max(...columns);
  }
  return diagnostics;
}

// A band is a word for a stretch of the clock: a label and two ends. Declared
// under meta.bands it only names values, in the rule's own templates ({band});
// declared as phases it is also the axis. Both read the same way, so one place
// decides what a band means.
function clockBandList(entries) {
  const bands = [];
  const diagnostics = [];
  for (const entry of asArray(entries)) {
    const from = clockMinutes(entry.from);
    const to = clockMinutes(entry.to);
    if (from === null || to === null) {
      diagnostics.push({
        code: 'workflow/band-clock',
        severity: 'error',
        message: `Band "${entry.id || entry.label}" declares from/to that are not clock times.`,
        subject: { diagramType: 'workflow', band: entry.id || entry.label },
        evidence: { from: entry.from, to: entry.to },
        supportedFixes: ['write both ends as HH:MM', 'or leave the band out'],
      });
      continue;
    }
    bands.push({ entry, from, to, wraps: from > to });
  }
  if (diagnostics.length) return { bands: [], diagnostics };
  for (let i = 1; i < bands.length; i += 1) {
    const previous = bands[i - 1];
    const current = bands[i];
    // Ends are inclusive and the list is the order; a band that crosses midnight
    // can only be the last one, or the day it belongs to is ambiguous.
    const ordered = current.wraps
      ? i === bands.length - 1 && current.from > previous.to
      : current.from > previous.to;
    if (ordered) continue;
    diagnostics.push({
      code: 'workflow/band-order',
      severity: 'error',
      message: `Band "${current.entry.id || current.entry.label}" must start after "${previous.entry.id || previous.entry.label}" ends; only the last band may cross midnight.`,
      subject: { diagramType: 'workflow', band: current.entry.id || current.entry.label },
      evidence: { from: current.entry.from, previousTo: previous.entry.to, last: i === bands.length - 1 },
      supportedFixes: ['order the bands by the clock', 'or move the band that crosses midnight to the end'],
    });
    return { bands, diagnostics };
  }
  return { bands, diagnostics };
}

function clockBandAt(bands, value) {
  const found = bands.find((band) => (band.wraps
    ? value >= band.from && value <= 1440 + band.to
    : value >= band.from && value <= band.to));
  return found || null;
}

function compileWorkflowInternal({
  workflow: inputWorkflow,
  qualityProfile,
  discoverFixes = true,
  layoutFeedback = {},
} = {}) {
  if (!inputWorkflow || typeof inputWorkflow !== 'object' || Array.isArray(inputWorkflow)) {
    const diagnostics = [{
      code: 'workflow/input-contract',
      severity: 'error',
      message: 'compileWorkflow requires one parsed workflow document object.',
      subject: { diagramType: 'workflow', path: '/' },
      evidence: {},
      supportedFixes: [],
    }];
    return compilerFailure('fixed-v1', diagnostics, diagnostics[0].message);
  }
  const resolvedQualityProfile = qualityProfile || inputWorkflow.meta?.quality_profile;
  const authoredQualityProfile = inputWorkflow.meta?.quality_profile;
  const qualityResolvedWorkflow = resolvedQualityProfile && resolvedQualityProfile !== inputWorkflow.meta?.quality_profile
    ? { ...inputWorkflow, meta: { ...inputWorkflow.meta, quality_profile: resolvedQualityProfile } }
    : inputWorkflow;
  let inputDiagnostics = [];
  try {
    validateSchema('workflow', qualityResolvedWorkflow);
  } catch (error) {
    inputDiagnostics = Array.isArray(error?.archifyDiagnostics)
      ? error.archifyDiagnostics.map((diagnostic) => ({
          ...diagnostic,
          supportedFixes: [],
        }))
      : [{
        code: 'workflow/input-contract',
        severity: 'error',
        message: 'Workflow schema validation failed unexpectedly.',
        subject: { diagramType: 'workflow', path: '/' },
        evidence: { reason: error?.message || String(error) },
        supportedFixes: [],
      }];
  }
  if (inputDiagnostics.length) {
    return compilerFailure(
      inputWorkflow.schema_version === 2 ? 'readable-v2' : 'fixed-v1',
      inputDiagnostics,
    );
  }
  const workflow = canonicalReadableWorkflow(qualityResolvedWorkflow);
  const ruleDiagnostics = applyRules(workflow);
  if (ruleDiagnostics.length) {
    return compilerFailure(
      workflow.schema_version === 2 ? 'readable-v2' : 'fixed-v1',
      ruleDiagnostics,
    );
  }
  const phaseDiagnostics = [...placePhases(workflow), ...placeGroupFrames(workflow)];
  // A placement that did not resolve is the one defect worth naming: the stops
  // it could not place would otherwise each report a missing column on top.
  const placementDiagnostics = phaseDiagnostics.length ? phaseDiagnostics : missingColumnDiagnostics(workflow);
  if (placementDiagnostics.length) {
    return compilerFailure(
      workflow.schema_version === 2 ? 'readable-v2' : 'fixed-v1',
      placementDiagnostics,
    );
  }
  const typeDiagnostics = typeVocabularyDiagnostics(workflow);
  if (typeDiagnostics.length) {
    return compilerFailure(
      workflow.schema_version === 2 ? 'readable-v2' : 'fixed-v1',
      typeDiagnostics,
    );
  }
  const readerProblems = readerDiagnostics(workflow);
  if (readerProblems.length) {
    return compilerFailure(
      workflow.schema_version === 2 ? 'readable-v2' : 'fixed-v1',
      readerProblems,
    );
  }
  const semanticDiagnostics = semanticContractDiagnostics(workflow);
  if (semanticDiagnostics.length) {
    return compilerFailure(
      workflow.schema_version === 2 ? 'readable-v2' : 'fixed-v1',
      semanticDiagnostics,
    );
  }
  const sourceIndexes = {
    lanes: new Map(asArray(qualityResolvedWorkflow.lanes).map((lane, index) => [lane, index])),
    nodes: new Map(asArray(qualityResolvedWorkflow.nodes).map((node, index) => [node, index])),
    edges: new Map(asArray(qualityResolvedWorkflow.edges).map((edge, index) => [edge, index])),
  };
  const layout = workflow.schema_version === 2
    ? createReadableLayout(workflow, layoutFeedback)
    : createLegacyLayout();

const declaredLegendTypes = asArray(workflow.meta && workflow.meta.types);
const LEGEND_CATALOG = declaredLegendTypes.length
  ? declaredLegendTypes.map((type) => ({ kind: type.id, label: type.label }))
  : [
  'frontend',
  'backend',
  'security',
  'messagebus',
  'database',
  'cloud',
  'external',
].map((kind) => ({ kind, label: i18nText(workflow.meta.locale, `legend.workflow.${kind}`, {}, workflow.meta.labels) }));
const presentLegendKinds = new Set(asArray(workflow.nodes).map((node) => node.type));
const workflowLegendEntries = resolveLegend(
  workflow.meta?.legend,
  LEGEND_CATALOG,
  presentLegendKinds,
);
const legendFootprintOptions = { fontSize: 7, itemGap: 7 };
const oneRowLegendFootprint = legendFootprint(workflowLegendEntries, {
  ...legendFootprintOptions,
  width: Number.MAX_SAFE_INTEGER,
});
const minimumCanvasWidth = workflow.schema_version === 2
  ? Math.max(layout.defaultViewBoxWidth, oneRowLegendFootprint.minWidth + 40)
  : layout.defaultViewBoxWidth;
const legendPackingWidth = Math.max(
  1,
  (workflow.schema_version === 2
    ? minimumCanvasWidth
    : (workflow.meta?.viewBox?.[0] ?? minimumCanvasWidth)) - 40,
);
const packedLegendFootprint = legendFootprint(workflowLegendEntries, {
  ...legendFootprintOptions,
  width: legendPackingWidth,
});
const legendExtraHeight = workflow.schema_version === 2
  ? packedLegendFootprint.extraHeight
  : 0;

// Content is 680px wide (laneX + laneW); auto height fits the lanes plus legend.
const autoHeight = layout.laneY
  + (layout.laneHeights?.reduce((total, height) => total + height, 0)
    ?? (workflow.lanes?.length || 1) * layout.laneH)
  + ((workflow.lanes?.length || 1) - 1) * layout.laneGap
  + 124
  + legendExtraHeight;
let viewBox = workflow.meta?.viewBox || [minimumCanvasWidth, autoHeight];
let requiredViewBox = [...viewBox];

const laneIndex = new Map(asArray(workflow.lanes).map((lane, index) => [lane.id, index]));
const laneLabels = new Map(asArray(workflow.lanes).map((lane) => [lane.id, lane.label]));

function nodeContext(node) {
  const group = asArray(workflow.groups).find((candidate) => (
    candidate.lane === node.lane && node.col >= candidate.fromCol && node.col <= candidate.toCol
  ));
  const phase = asArray(workflow.phases).find((candidate) => (
    node.col >= candidate.fromCol && node.col <= candidate.toCol
  ));
  return [laneLabels.get(node.lane), group?.label, phase?.label].filter(Boolean).join(' › ')
    || i18nText(workflow.meta.locale, 'node.context.workflow', {}, workflow.meta.labels);
}

function laneHeight(idOrIndex) {
  const index = typeof idOrIndex === 'number' ? idOrIndex : laneIndex.get(idOrIndex);
  return layout.laneHeights?.[index] ?? layout.laneH;
}

function laneGroupHeaderH(idOrIndex) {
  const index = typeof idOrIndex === 'number' ? idOrIndex : laneIndex.get(idOrIndex);
  return layout.groupHeaderHeights?.[index] ?? 0;
}

function laneGroupFooterH(idOrIndex) {
  const index = typeof idOrIndex === 'number' ? idOrIndex : laneIndex.get(idOrIndex);
  return layout.groupFooterHeights?.[index] ?? 0;
}

function laneTop(id) {
  const index = laneIndex.get(id);
  const precedingHeight = asArray(workflow.lanes).slice(0, index)
    .reduce((total, _lane, lanePosition) => total + laneHeight(lanePosition), 0);
  return layout.laneY + precedingHeight + index * layout.laneGap;
}

function lastLaneBottom() {
  return layout.laneY
    + asArray(workflow.lanes).reduce((total, _lane, index) => total + laneHeight(index), 0)
    + (workflow.lanes.length - 1) * layout.laneGap;
}

function legendY() {
  return lastLaneBottom() + 44 + legendExtraHeight;
}

function workflowLegendLayout(obstacles = []) {
  return {
    x: 20,
    baselineY: legendY(),
    width: workflow.schema_version === 2 ? legendPackingWidth : viewBox[0] - 40,
    fontSize: 7,
    itemGap: 7,
    minTitleY: lastLaneBottom() + 8,
    obstacles,
    unfit: workflow.meta?.legend === undefined ? 'hide' : 'error',
    diagramType: 'workflow',
  };
}

function workflowLegendRects() {
  if (!workflowLegendEntries.length) return [];
  const measured = measureLegend(workflowLegendEntries, workflowLegendLayout());
  if (!measured) return [];
  return [
    { kind: 'title', x: 20, y: measured.titleY - 10, width: 48, height: 14 },
    ...measured.entries.map((entry) => ({
      kind: entry.kind,
      x: entry.x,
      y: entry.baseline - 10,
      width: entry.width,
      height: 14,
    })),
  ];
}

function measureNode(node) {
  const width = node.width || layout.nodeW;
  const height = node.height || (node.tag ? 68 : layout.nodeH);
  const cx = layout.colXs[node.col];
  const groupHeaderH = laneGroupHeaderH(node.lane);
  const contentH = laneHeight(node.lane) - layout.laneTitleH
    - groupHeaderH - laneGroupFooterH(node.lane);
  const y = laneTop(node.lane) + layout.laneTitleH + groupHeaderH
    + (contentH - height) / 2 + (node.yOffset || 0);
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

// Font sizes for this renderer's node text; the fitting geometry is shared.
const nodeTextFit = {
  labelPreferred: 11,
  labelMinimum: 9,
  sublabelPreferred: 8,
  sublabelMinimum: 6,
  tagPreferred: 7,
  tagMinimum: 6,
};

const nodes = new Map(asArray(workflow.nodes).map((node) => [node.id, measureNode(node)]));

function workflowCompositionFrames() {
  const frames = [];
  for (const [index, lane] of asArray(workflow.lanes).entries()) {
    const y = laneTop(lane.id);
    const height = laneHeight(index);
    frames.push({ id: `lane-${index}`, label: lane.label, kind: 'lane', x: layout.laneX, y, width: layout.laneW, height, radius: 10 });
    if (lane.variant === 'exception') {
      frames.push({ id: `lane-${index}-exception`, label: `${lane.label} exception`, kind: 'exception-lane', x: layout.laneX + 6, y: y + 6, width: layout.laneW - 12, height: height - 12, radius: 8 });
    }
  }
  for (const [index, group] of asArray(workflow.groups).entries()) {
    const span = groupSpan(group);
    frames.push({
      id: `group-${index}`,
      label: group.label,
      kind: 'group',
      x: span.x,
      y: laneTop(group.lane) + layout.laneTitleH + GROUP_FRAME_TOP_INSET,
      width: span.width,
      height: workflow.schema_version === 2
        ? laneHeight(group.lane) - layout.laneTitleH
          - GROUP_FRAME_TOP_INSET - GROUP_FRAME_BOTTOM_INSET
        : layout.laneH - layout.laneTitleH - 16,
      radius: 9,
    });
  }
  return frames;
}

function workflowSceneLabelObstacles() {
  const obstacles = [];
  for (const [index, lane] of asArray(workflow.lanes).entries()) {
    const prefix = lane.variant === 'exception' ? 'EX' : String(index + 1).padStart(2, '0');
    const label = `${prefix} / ${lane.label}`;
    obstacles.push({
      kind: 'lane-header',
      id: lane.id,
      x: layout.laneX + 14,
      y: laneTop(lane.id) + 12,
      width: textUnits(label) * 6.2,
      height: 14,
    });
  }
  for (const phase of asArray(workflow.phases)) {
    if (!Number.isInteger(phase.fromCol) || !Number.isInteger(phase.toCol)
      || phase.fromCol < 0 || phase.toCol >= layout.colXs.length || phase.fromCol > phase.toCol) continue;
    const span = phaseSpan(phase);
    obstacles.push({
      kind: 'phase-header',
      id: phase.id ?? null,
      x: span.x,
      y: 27,
      width: span.width,
      height: 16,
    });
  }
  for (const group of asArray(workflow.groups)) {
    if (!laneIndex.has(group.lane)
      || !Number.isInteger(group.fromCol) || !Number.isInteger(group.toCol)
      || group.fromCol < 0 || group.toCol >= layout.colXs.length || group.fromCol > group.toCol) continue;
    const span = groupSpan(group);
    const frameY = laneTop(group.lane) + layout.laneTitleH + GROUP_FRAME_TOP_INSET;
    const labelBaseline = frameY + GROUP_LABEL_BASELINE_OFFSET;
    obstacles.push({
      kind: 'group-label',
      id: group.id ?? null,
      x: span.x + 10,
      y: labelBaseline - GROUP_LABEL_MASK_ASCENT,
      width: textUnits(group.label) * 5.6,
      height: GROUP_LABEL_MASK_H,
    });
  }
  return obstacles;
}

const mainPathSteps = new Map(asArray(workflow.mainPath).map((id, index) => [id, index]));
const edgeSteps = new Map(asArray(workflow.edges).map((edge, index) => {
  const fromStep = mainPathSteps.get(edge.from);
  const toStep = mainPathSteps.get(edge.to);
  const mainStep = Number.isInteger(fromStep) && toStep === fromStep + 1 ? fromStep : null;
  return [edge, mainStep ?? asArray(workflow.mainPath).length + index];
}));

function nodeStep(node) {
  return mainPathSteps.get(node.id) ?? asArray(workflow.mainPath).length + asArray(workflow.nodes).findIndex((item) => item.id === node.id);
}

  function acceptsFix(mutator) {
    if (!discoverFixes) return false;
    const candidate = cloneWorkflow(workflow);
    mutator(candidate);
    return withDiagnosticRecordingSuppressed(() => compileWorkflowWithFeedback({
      workflow: candidate,
      qualityProfile: resolvedQualityProfile,
      discoverFixes: false,
    }).ok);
  }

  function verifiedLegacyAlternative(edge, from, to, requiredClearance) {
    const occupied = [...nodes.values()].filter((node) => node.lane === to.lane && node.id !== to.id);
  const candidates = layout.colXs.map((center, col) => ({ center, col }))
    .filter(({ col }) => col !== to.col)
    .sort((a, b) => Math.abs(a.col - to.col) - Math.abs(b.col - to.col) || a.col - b.col);
  for (const candidate of candidates) {
    const candidateRect = { ...to, col: candidate.col, cx: candidate.center, x: candidate.center - to.width / 2 };
    if (occupied.some((node) => rectsOverlap(candidateRect, node, 8))) continue;
    const centerDistance = Math.abs(candidate.center - from.cx);
    const signedClearance = centerDistance - from.width / 2 - to.width / 2;
      if (signedClearance < requiredClearance) continue;
      if (acceptsFix((document) => {
        document.nodes.find((node) => node.id === to.id).col = candidate.col;
      })) return candidate.col;
    }
    return null;
  }

  function readableMigrationProvidesCapacity(from, to, requiredClearance) {
    const readable = createReadableLayout({ ...workflow, schema_version: 2 });
    const centerDistance = Math.abs(readable.colXs[to.col] - readable.colXs[from.col]);
    if (centerDistance - from.width / 2 - to.width / 2 < requiredClearance) return false;
    if (!discoverFixes) return false;

    return withDiagnosticRecordingSuppressed(() => {
      const migrationQualityProfile = authoredQualityProfile;
      let planned = compileWorkflowWithFeedback({
        workflow: intrinsicWorkflow(workflow),
        qualityProfile: migrationQualityProfile,
        discoverFixes: false,
      });
      if (!planned.ok) {
        planned = compileWorkflowWithFeedback({
          workflow: planningWorkflow(workflow),
          qualityProfile: migrationQualityProfile,
          discoverFixes: false,
        });
      }
      if (!planned.ok || !Array.isArray(planned.receipt?.columns)) return false;

      let candidate;
      try {
        candidate = createMappedWorkflowCandidate(
          workflow,
          LEGACY_COLUMN_CENTERS,
          planned.receipt.columns,
        ).document;
      } catch {
        return false;
      }
      let compiled = compileWorkflowWithFeedback({
        workflow: candidate,
        qualityProfile: migrationQualityProfile,
        discoverFixes: false,
      });
      const requiredViewBox = compiled.diagnostics?.length
        && compiled.diagnostics.every(({ code }) => code === 'workflow/viewbox-capacity')
        ? compiled.diagnostics.find(({ evidence }) => Array.isArray(evidence?.requiredViewBox))
          ?.evidence.requiredViewBox
        : null;
      if (!compiled.ok && Array.isArray(candidate.meta?.viewBox) && requiredViewBox) {
        candidate.meta.viewBox = [
          Math.max(candidate.meta.viewBox[0], requiredViewBox[0]),
          Math.max(candidate.meta.viewBox[1], requiredViewBox[1]),
        ];
        compiled = compileWorkflowWithFeedback({
          workflow: candidate,
          qualityProfile: migrationQualityProfile,
          discoverFixes: false,
        });
      }
      return compiled.ok;
    });
  }

function verifiedReducedWidths(from, to, requiredClearance) {
  const widthBudget = 2 * (Math.abs(to.cx - from.cx) - requiredClearance);
  if (widthBudget < 64) return null;
  const widths = [from.width, to.width];
  let excess = widths[0] + widths[1] - widthBudget;
  for (const index of widths[0] >= widths[1] ? [0, 1] : [1, 0]) {
    const reduction = Math.min(excess, widths[index] - 32);
    widths[index] -= reduction;
    excess -= reduction;
  }
  if (excess > 0.0001) return null;
  const candidates = [from, to];
  const labelsFit = candidates.every((node, index) => (
    textUnits(node.label) * 6.8 <= widths[index] + 6
    && (!node.sublabel || minimumNodeTextWidth(node.sublabel, nodeTextFit.sublabelMinimum) <= availableNodeTextWidth(widths[index]))
    && (!node.tag || minimumNodeTextWidth(node.tag, nodeTextFit.tagMinimum) <= availableNodeTextWidth(widths[index]))
  ));
  if (!labelsFit) return null;
  const serializedWidths = widths.map((width) => Math.floor((width + 1e-9) * 100) / 100);
  const signedClearance = Math.abs(to.cx - from.cx)
    - serializedWidths[0] / 2 - serializedWidths[1] / 2;
  if (signedClearance + 0.0001 < requiredClearance) return null;
  const accepted = acceptsFix((document) => {
    document.nodes.find((node) => node.id === from.id).width = serializedWidths[0];
    document.nodes.find((node) => node.id === to.id).width = serializedWidths[1];
  });
  return accepted ? serializedWidths : null;
}

function enforceLegacyColumnCapacity() {
  if (workflow.schema_version !== 1) return;
  for (const edge of workflow.edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to || from.lane !== to.lane || from.col === to.col) continue;
    if (!verticalIntervalsOverlap(from, to, 8)) continue;
    const centerDistance = Math.abs(to.cx - from.cx);
    const actualSignedClearance = centerDistance - from.width / 2 - to.width / 2;
    const direct = !edge.via && ['auto', 'straight'].includes(edge.route || 'auto')
      && Math.abs(from.cy - to.cy) < 0.0001;
    const requiredDirectClearance = direct ? 28 : 8;
    if (actualSignedClearance >= requiredDirectClearance) continue;
    const alternative = verifiedLegacyAlternative(edge, from, to, requiredDirectClearance);
    const reducedWidths = verifiedReducedWidths(from, to, requiredDirectClearance);
    const capacity = actualSignedClearance < 0
      ? `overlap by ${Math.abs(Math.round(actualSignedClearance))}px`
      : `leave only ${Math.round(actualSignedClearance)}px of direct clearance`;
    const message = `Workflow columns ${from.col}→${to.col} place nodes "${from.id}" and "${to.id}" so they ${capacity} under the fixed-v1 layout.`;
    const supportedFixes = [];
    if (readableMigrationProvidesCapacity(from, to, requiredDirectClearance)) {
      supportedFixes.push('migrate this workflow to schema_version 2');
    }
    if (alternative !== null) supportedFixes.push(`move node "${to.id}" to verified free column ${alternative}`);
    if (reducedWidths) {
      supportedFixes.push(`set node widths "${from.id}"=${Math.round(reducedWidths[0] * 100) / 100}px and "${to.id}"=${Math.round(reducedWidths[1] * 100) / 100}px`);
    }
    throwDiagnosticError(message, [{
      code: 'workflow/column-capacity',
      severity: 'error',
      message,
      subject: {
        diagramType: 'workflow',
        edge: edge.id ?? null,
        from: edge.from,
        to: edge.to,
        fromCol: from.col,
        toCol: to.col,
      },
      evidence: {
        centerDistancePx: centerDistance,
        nodeWidthsPx: [from.width, to.width],
        actualSignedClearancePx: actualSignedClearance,
        requiredDirectClearancePx: requiredDirectClearance,
      },
      supportedFixes,
      suppresses: [
        'workflow/short-edge',
        'clean-flow/endpoint-side-direction',
        'workflow/label-node-overlap',
      ],
    }]);
  }
}

function verifiedEdgeFix(edge, message, mutator) {
  const edgeIndex = workflow.edges.indexOf(edge);
  if (edgeIndex < 0) return null;
  const accepted = acceptsFix((document) => mutator(document.edges[edgeIndex], document));
  return accepted ? message : null;
}

function verifiedAutomaticRouteFix(edge, { clearSides = false } = {}) {
  const edgeName = workflowEdgeName(edge);
  return verifiedEdgeFix(
    edge,
    clearSides
      ? `remove explicit route geometry and endpoint sides from edge "${edgeName}" so readable-v2 can use its verified automatic candidate`
      : `remove explicit route geometry from edge "${edgeName}" so readable-v2 can use its verified automatic candidate`,
    (candidate) => {
      delete candidate.via;
      delete candidate.channelX;
      delete candidate.channelY;
      delete candidate.route;
      if (clearSides) {
        delete candidate.fromSide;
        delete candidate.toSide;
      }
    },
  );
}

function authoredPinEvidence(edge, field) {
  const authoredEdgeIndex = sourceIndexes.edges.get(edge);
  const value = Array.isArray(edge[field])
    ? edge[field].map((item) => (Array.isArray(item) ? [...item] : item))
    : edge[field];
  return {
    edge: workflowEdgeName(edge),
    field,
    ...(Number.isInteger(authoredEdgeIndex) ? { path: `/edges/${authoredEdgeIndex}/${field}` } : {}),
    value,
  };
}

function combinations(values, size, start = 0, prefix = [], output = []) {
  if (prefix.length === size) {
    output.push([...prefix]);
    return output;
  }
  for (let index = start; index <= values.length - (size - prefix.length); index += 1) {
    prefix.push(values[index]);
    combinations(values, size, index + 1, prefix, output);
    prefix.pop();
  }
  return output;
}

function verifiedPinRemovalAlternatives(edge, fields, reason) {
  if (!discoverFixes) return { removalSets: [], supportedFixes: [] };
  const edgeIndex = workflow.edges.indexOf(edge);
  if (edgeIndex < 0) return { removalSets: [], supportedFixes: [] };
  const uniqueFields = [...new Set(fields.filter((field) => edge[field] !== undefined))];
  for (let size = 1; size <= uniqueFields.length; size += 1) {
    const removalSets = combinations(uniqueFields, size).filter((fieldSet) => (
      acceptsFix((document) => {
        for (const field of fieldSet) delete document.edges[edgeIndex][field];
      })
    ));
    if (!removalSets.length) continue;
    const edgeName = workflowEdgeName(edge);
    return {
      removalSets,
      supportedFixes: removalSets.map((fieldSet) => (
        `remove ${fieldSet.join(' and ')} from edge "${edgeName}" ${reason}`
      )),
    };
  }
  return { removalSets: [], supportedFixes: [] };
}

function conflictPinsFromRemovalSets(edge, removalSets, fallbackFields = []) {
  const fields = removalSets.length
    ? [...new Set(removalSets.flat())]
    : [...new Set(fallbackFields)];
  return fields.map((field) => authoredPinEvidence(edge, field));
}

function authoredRouteAssertionFields(edge) {
  return [
    ...(Array.isArray(edge?.via) ? ['via'] : []),
    ...(edge?.channelX !== undefined ? ['channelX'] : []),
    ...(edge?.channelY !== undefined ? ['channelY'] : []),
    ...(edge?.route && edge.route !== 'auto' ? ['route'] : []),
    ...(edge?.fromSide && edge.fromSide !== 'auto' ? ['fromSide'] : []),
    ...(edge?.toSide && edge.toSide !== 'auto' ? ['toSide'] : []),
  ];
}

function hasAuthoredRouteAssertions(edge) {
  return authoredRouteAssertionFields(edge).length > 0;
}

function verifiedPinReferenceAlternatives(candidateRefs, reason) {
  const seenRefs = new Set();
  const refs = candidateRefs.filter(({ edge, edgeIndex, field }) => {
    if (edgeIndex < 0 || edge?.[field] === undefined) return false;
    const key = `${edgeIndex}:${field}`;
    if (seenRefs.has(key)) return false;
    seenRefs.add(key);
    return true;
  });
  const fallbackPins = refs.map(({ edge, field }) => authoredPinEvidence(edge, field));
  if (!discoverFixes) {
    return {
      removalSets: [], conflictingRefs: refs, conflictingPins: fallbackPins, repairs: [], supportedFixes: [],
    };
  }

  for (let size = 1; size <= refs.length; size += 1) {
    const removalSets = combinations(refs, size).filter((removalSet) => (
      acceptsFix((document) => {
        for (const { edgeIndex, field } of removalSet) delete document.edges[edgeIndex][field];
      })
    ));
    if (!removalSets.length) continue;
    const conflictingRefs = [];
    const conflictingPins = [];
    const seenPins = new Set();
    for (const removalSet of removalSets) {
      for (const { edge, field } of removalSet) {
        const key = `${workflow.edges.indexOf(edge)}:${field}`;
        if (seenPins.has(key)) continue;
        seenPins.add(key);
        conflictingRefs.push({ edge, edgeIndex: workflow.edges.indexOf(edge), field });
        conflictingPins.push(authoredPinEvidence(edge, field));
      }
    }
    const repairs = removalSets.map((removalSet) => {
      const grouped = [];
      for (const ref of removalSet) {
        let group = grouped.find(({ edge }) => edge === ref.edge);
        if (!group) {
          group = { edge: ref.edge, fields: [] };
          grouped.push(group);
        }
        group.fields.push(ref.field);
      }
      const removals = grouped.map(({ edge, fields }) => (
        `remove ${fields.join(' and ')} from edge "${workflowEdgeName(edge)}"`
      ));
      return { removalSet, message: `${removals.join(' and ')} ${reason}` };
    });
    return {
      removalSets,
      conflictingRefs,
      conflictingPins,
      repairs,
      supportedFixes: repairs.map(({ message }) => message),
    };
  }
  return {
    removalSets: [], conflictingRefs: refs, conflictingPins: fallbackPins, repairs: [], supportedFixes: [],
  };
}

function verifiedRoutePairPinAlternatives(leftEdge, rightEdge, reason) {
  const refs = [leftEdge, rightEdge].flatMap((edge) => {
    const edgeIndex = workflow.edges.indexOf(edge);
    return authoredRouteAssertionFields(edge).map((field) => ({ edge, edgeIndex, field }));
  });
  return verifiedPinReferenceAlternatives(refs, reason);
}

function verifiedLabelRoutePinAlternatives(labelEdge, routeEdge) {
  const refs = [];
  const labelEdgeIndex = workflow.edges.indexOf(labelEdge);
  if (Array.isArray(labelEdge?.labelAt)) {
    refs.push({ edge: labelEdge, edgeIndex: labelEdgeIndex, field: 'labelAt' });
  }
  const routeEdgeIndex = workflow.edges.indexOf(routeEdge);
  for (const field of authoredRouteAssertionFields(routeEdge)) {
    refs.push({ edge: routeEdge, edgeIndex: routeEdgeIndex, field });
  }
  return verifiedPinReferenceAlternatives(
    refs,
    Array.isArray(labelEdge?.labelAt)
      ? 'so readable-v2 can replan the remaining authored label-route pins'
      : 'so readable-v2 can replan the remaining authored route assertions',
  );
}

function verifiedLabelPairPinAlternatives(leftEdge, rightEdge) {
  return verifiedPinReferenceAlternatives(
    [leftEdge, rightEdge].flatMap((edge) => (
      Array.isArray(edge?.labelAt)
        ? [{ edge, edgeIndex: workflow.edges.indexOf(edge), field: 'labelAt' }]
        : []
    )),
    'so readable-v2 can replan the remaining authored label pins',
  );
}

function verifiedRepairsWithLabelNudges(alternatives) {
  return alternatives.repairs.flatMap(({ removalSet, message }) => {
    if (removalSet.length !== 1 || removalSet[0].field !== 'labelAt') return [message];
    const nudges = verifiedLabelAtAlternatives(removalSet[0].edge);
    return nudges.length ? nudges : [message];
  });
}

function throwExplicitPinConflict(edge, invariant, evidence, supportedFixes = []) {
  const message = `Workflow edge "${workflowEdgeName(edge)}" has explicit geometry that violates ${invariant}.`;
  const [onlyPin] = asArray(evidence?.conflictingPins);
  const authoredEdgeIndex = sourceIndexes.edges.get(edge);
  const pinPath = asArray(evidence?.conflictingPins).length === 1
    && Number.isInteger(authoredEdgeIndex)
    && onlyPin?.field
    ? onlyPin.path || `/edges/${authoredEdgeIndex}/${onlyPin.field}`
    : null;
  throwDiagnosticError(message, [{
    code: 'workflow/explicit-pin-conflict',
    severity: 'error',
    message,
    subject: {
      diagramType: 'workflow',
      edge: edge.id ?? null,
      from: edge.from,
      to: edge.to,
      ...(pinPath ? { path: pinPath } : {}),
    },
    evidence: { invariant, ...evidence },
    supportedFixes: supportedFixes.filter(Boolean),
  }]);
}

function hasAbsoluteRoutePins(edge) {
  return Array.isArray(edge?.via)
    || edge?.channelX !== undefined
    || edge?.channelY !== undefined;
}

function presentRouteGeometryFields(edge) {
  return [
    ...(Array.isArray(edge?.via) ? ['via'] : []),
    ...(edge?.channelX !== undefined ? ['channelX'] : []),
    ...(edge?.channelY !== undefined ? ['channelY'] : []),
  ];
}

function verifiedRouteGeometryPinAlternatives(
  edge,
  reason = 'so readable-v2 can replan the remaining explicit route assertions',
) {
  const edgeIndex = workflow.edges.indexOf(edge);
  return verifiedPinReferenceAlternatives(
    authoredRouteAssertionFields(edge).map((field) => ({ edge, edgeIndex, field })),
    reason,
  );
}

function properOrthogonalIntersection(leftStart, leftEnd, rightStart, rightEnd) {
  const leftOrientation = segmentOrientation(leftStart, leftEnd);
  const rightOrientation = segmentOrientation(rightStart, rightEnd);
  if (leftOrientation === rightOrientation
    || leftOrientation === 'diagonal'
    || rightOrientation === 'diagonal') return null;
  const horizontalStart = leftOrientation === 'horizontal' ? leftStart : rightStart;
  const horizontalEnd = leftOrientation === 'horizontal' ? leftEnd : rightEnd;
  const verticalStart = leftOrientation === 'vertical' ? leftStart : rightStart;
  const verticalEnd = leftOrientation === 'vertical' ? leftEnd : rightEnd;
  const point = [verticalStart[0], horizontalStart[1]];
  const epsilon = 0.0001;
  const insideHorizontal = point[0] > Math.min(horizontalStart[0], horizontalEnd[0]) + epsilon
    && point[0] < Math.max(horizontalStart[0], horizontalEnd[0]) - epsilon;
  const insideVertical = point[1] > Math.min(verticalStart[1], verticalEnd[1]) + epsilon
    && point[1] < Math.max(verticalStart[1], verticalEnd[1]) - epsilon;
  return insideHorizontal && insideVertical ? point : null;
}

function verifiedLabelAtAlternatives(edge) {
  if (!Array.isArray(edge.labelAt)) return [];
  const [x, y] = edge.labelAt;
  return [
    [0, 24], [0, -24], [24, 0], [-24, 0],
    [0, 48], [0, -48], [48, 0], [-48, 0],
  ].map(([dx, dy]) => {
    const next = [x + dx, y + dy];
    return verifiedEdgeFix(
      edge,
      `set labelAt on edge "${workflowEdgeName(edge)}" to [${next[0]}, ${next[1]}]`,
      (candidate) => { candidate.labelAt = next; },
    );
  }).filter(Boolean);
}

function verifiedLabelAtNudge(edge) {
  const [alternative] = verifiedLabelAtAlternatives(edge);
  if (alternative) return alternative;
  return verifiedEdgeFix(
    edge,
    `remove labelAt from edge "${workflowEdgeName(edge)}" so readable-v2 can use verified automatic label placement`,
    (candidate) => { delete candidate.labelAt; },
  );
}

function throwReadableLabelRoutePinConflict(hit, routePoints = null) {
  const labelEdge = hit.labelRelation;
  const routeEdge = hit.otherRelation;
  const labelPinned = Array.isArray(labelEdge?.labelAt);
  const routePinned = hasAuthoredRouteAssertions(routeEdge);
  if (!labelPinned && !routePinned) return false;
  const alternatives = verifiedLabelRoutePinAlternatives(labelEdge, routeEdge);
  const actualRoutePoints = routePoints
    || pathCache.get(routeEdge)?.points
    || pathFor(routeEdge).points;
  const diagnosticEdge = alternatives.conflictingRefs[0]?.edge
    || (labelPinned ? labelEdge : routeEdge);
  throwExplicitPinConflict(diagnosticEdge, 'explicit label-route clearance', {
    conflictingPins: alternatives.conflictingPins,
    ...(labelPinned ? { labelAt: [...labelEdge.labelAt] } : {}),
    labelRect: {
      x: hit.rect.x,
      y: hit.rect.y,
      width: hit.rect.width,
      height: hit.rect.height,
    },
    collidedRoute: {
      edge: routeEdge.id || `${routeEdge.from}->${routeEdge.to}`,
      from: routeEdge.from,
      to: routeEdge.to,
      points: actualRoutePoints.map((point) => [...point]),
    },
    routeSegmentIndex: hit.segmentIndex,
    routeSegment: { from: [...hit.start], to: [...hit.end] },
    clearancePx: Math.round(hit.clearance * 10) / 10,
    minimumPx: hit.threshold,
  }, [
    ...verifiedRepairsWithLabelNudges(alternatives),
  ]);
  return true;
}

function throwReadableLabelLabelPinConflict(left, right) {
  const leftEdge = left.relation;
  const rightEdge = right.relation;
  const pinnedEdges = [leftEdge, rightEdge].filter((edge) => Array.isArray(edge?.labelAt));
  if (!pinnedEdges.length) return false;
  const alternatives = verifiedLabelPairPinAlternatives(leftEdge, rightEdge);
  const causalLabelEdges = [...new Set(alternatives.conflictingRefs.map(({ edge }) => edge))];
  const diagnosticEdge = causalLabelEdges[0] || pinnedEdges[0];
  throwExplicitPinConflict(diagnosticEdge, 'explicit label-label clearance', {
    conflictingPins: alternatives.conflictingPins,
    labelRects: [left, right].map((rect) => ({
      edge: rect.relation.id ?? null,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    })),
    minimumGapPx: -2,
  }, verifiedRepairsWithLabelNudges(alternatives));
  return true;
}

function classifyFailedAutomaticCandidatePins(edge, rawCandidates) {
  const relationIndex = workflow.edges.indexOf(edge);
  const priorRoutes = [...pathCache.entries()]
    .filter(([otherEdge]) => otherEdge !== edge)
    .map(([relation, routed]) => ({
      relation,
      relationIndex: workflow.edges.indexOf(relation),
      points: routed.points,
    }));
  if (!priorRoutes.length) return;
  const priorLabels = priorRoutes.map(({ relation, relationIndex }) => (
    labelRectFor(relation, relationIndex)
  )).filter(Boolean);

  for (const { points } of rawCandidates) {
    const candidateRect = candidateLabelRect(edge, points);
    const candidateLabel = candidateRect
      ? { ...candidateRect, relation: edge, relationIndex, label: edge.label }
      : null;
    if (candidateLabel) {
      const priorLabel = priorLabels.find((otherLabel) => (
        rectsOverlap(candidateLabel, otherLabel, -2)
        && (Array.isArray(edge.labelAt) || Array.isArray(otherLabel.relation?.labelAt))
      ));
      if (priorLabel) throwReadableLabelLabelPinConflict(candidateLabel, priorLabel);

      const labelRouteHit = collectLabelRouteClearance({
        labels: [candidateLabel],
        routedRelations: priorRoutes,
        threshold: 4,
      }).find((hit) => (
        Array.isArray(edge.labelAt) || hasAbsoluteRoutePins(hit.otherRelation)
      ));
      if (labelRouteHit) {
        const collidedRoute = priorRoutes.find(({ relation }) => relation === labelRouteHit.otherRelation);
        throwReadableLabelRoutePinConflict(labelRouteHit, collidedRoute?.points);
      }
    }

    const reverseHit = collectLabelRouteClearance({
      labels: priorLabels,
      routedRelations: [{ relation: edge, relationIndex, points }],
      threshold: 4,
    }).find((hit) => Array.isArray(hit.labelRelation?.labelAt));
    if (reverseHit) throwReadableLabelRoutePinConflict(reverseHit, points);
  }
}

function validateReadablePairwisePinConflicts() {
  const labels = workflow.edges.map((edge, relationIndex) => (
    labelRectFor(edge, relationIndex)
  )).filter(Boolean);
  const routedRelations = workflow.edges.map((edge, relationIndex) => (
    nodes.has(edge.from) && nodes.has(edge.to)
      ? { relation: edge, relationIndex, points: pathFor(edge).points }
      : null
  )).filter(Boolean);

  const labelRouteHit = collectLabelRouteClearance({
    labels,
    routedRelations,
    threshold: 4,
  }).find((hit) => (
    Array.isArray(hit.labelRelation?.labelAt) || hasAuthoredRouteAssertions(hit.otherRelation)
  ));
  if (labelRouteHit) throwReadableLabelRoutePinConflict(labelRouteHit);

  for (let leftIndex = 0; leftIndex < labels.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < labels.length; rightIndex += 1) {
      const left = labels[leftIndex];
      const right = labels[rightIndex];
      if (!rectsOverlap(left, right, -2)) continue;
      throwReadableLabelLabelPinConflict(left, right);
    }
  }

  const requestedProfile = workflow.meta?.quality_profile;
  if (requestedProfile !== 'showcase') return;
  for (let leftIndex = 0; leftIndex < routedRelations.length; leftIndex += 1) {
    const left = routedRelations[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < routedRelations.length; rightIndex += 1) {
      const right = routedRelations[rightIndex];
      const leftPinned = hasAuthoredRouteAssertions(left.relation);
      const rightPinned = hasAuthoredRouteAssertions(right.relation);
      if (!leftPinned && !rightPinned) continue;
      if ([left.relation.from, left.relation.to].some((id) => (
        id === right.relation.from || id === right.relation.to
      ))) continue;
      const leftAnalysis = forwardCollinearAnalysisSegments(left.points);
      const rightAnalysis = forwardCollinearAnalysisSegments(right.points);
      for (const leftSegment of leftAnalysis) {
        for (const rightSegment of rightAnalysis) {
          const point = properOrthogonalIntersection(
            leftSegment.start,
            leftSegment.end,
            rightSegment.start,
            rightSegment.end,
          );
          if (!point) continue;
          const leftSourceIndex = sourceSegmentIndexAtPoint(leftSegment, point);
          const rightSourceIndex = sourceSegmentIndexAtPoint(rightSegment, point);
          const leftSource = {
            from: left.points[leftSourceIndex],
            to: left.points[leftSourceIndex + 1],
          };
          const rightSource = {
            from: right.points[rightSourceIndex],
            to: right.points[rightSourceIndex + 1],
          };
          const alternatives = verifiedRoutePairPinAlternatives(
            left.relation,
            right.relation,
            'so readable-v2 can replan the remaining authored route assertions',
          );
          const diagnosticEdge = leftPinned ? left.relation : right.relation;
          throwExplicitPinConflict(diagnosticEdge, 'explicit route-route crossing', {
            conflictingPins: alternatives.conflictingPins,
            point,
            segmentIndex: leftSourceIndex,
            otherSegmentIndex: rightSourceIndex,
            routeSegments: [
              { edge: left.relation.id ?? null, from: [...leftSegment.start], to: [...leftSegment.end] },
              { edge: right.relation.id ?? null, from: [...rightSegment.start], to: [...rightSegment.end] },
            ],
            sourceRouteSegments: [
              { edge: left.relation.id ?? null, from: [...leftSource.from], to: [...leftSource.to] },
              { edge: right.relation.id ?? null, from: [...rightSource.from], to: [...rightSource.to] },
            ],
          }, alternatives.supportedFixes);
        }
      }
    }
  }

  const corridorHit = collectAmbiguousCorridors({
    routedRelations,
    minOverlapPx: 8,
  }).find((hit) => (
    hasAuthoredRouteAssertions(hit.left.relation)
    || hasAuthoredRouteAssertions(hit.right.relation)
  ));
  if (corridorHit) {
    const leftSegment = {
      from: corridorHit.left.points[corridorHit.leftSegment],
      to: corridorHit.left.points[corridorHit.leftSegment + 1],
    };
    const rightSegment = {
      from: corridorHit.right.points[corridorHit.rightSegment],
      to: corridorHit.right.points[corridorHit.rightSegment + 1],
    };
    const leftPinned = hasAuthoredRouteAssertions(corridorHit.left.relation);
    const alternatives = verifiedRoutePairPinAlternatives(
      corridorHit.left.relation,
      corridorHit.right.relation,
      'so readable-v2 can replan the remaining authored route assertions',
    );
    const diagnosticEdge = leftPinned ? corridorHit.left.relation : corridorHit.right.relation;
    throwExplicitPinConflict(diagnosticEdge, 'explicit route-route corridor clearance', {
      conflictingPins: alternatives.conflictingPins,
      segmentIndex: corridorHit.leftSegment,
      otherSegmentIndex: corridorHit.rightSegment,
      routeSegments: [
        {
          edge: corridorHit.left.relation.id ?? null,
          from: [...leftSegment.from],
          to: [...leftSegment.to],
        },
        {
          edge: corridorHit.right.relation.id ?? null,
          from: [...rightSegment.from],
          to: [...rightSegment.to],
        },
      ],
      overlapStart: [...corridorHit.overlapStart],
      overlapEnd: [...corridorHit.overlapEnd],
      overlapLengthPx: corridorHit.overlapLength,
      minimumClearancePx: 8,
    }, alternatives.supportedFixes);
  }
}

const READABLE_PRESET_PIN_FIELDS = Object.freeze({
  straight: [],
  drop: ['channelY'],
  'outside-right': ['channelX'],
  'return-left': ['channelX'],
  'bottom-channel': ['channelY'],
  'up-channel': ['channelY'],
});

function presentChannelPins(edge) {
  return ['channelX', 'channelY'].filter((field) => edge[field] !== undefined);
}

function validateReadableRouteControls(edge) {
  const channelPins = presentChannelPins(edge);
  const preset = edge.route || 'auto';
  if (preset === 'auto') return;
  const allowedPins = new Set(READABLE_PRESET_PIN_FIELDS[preset] || []);
  const conflictingPins = channelPins.filter((field) => !allowedPins.has(field));
  if (!conflictingPins.length) return;
  const edgeIndex = workflow.edges.indexOf(edge);
  const alternatives = verifiedPinReferenceAlternatives([
    { edge, edgeIndex, field: 'route' },
    ...conflictingPins.map((field) => ({ edge, edgeIndex, field })),
  ], 'and keep the remaining verified route assertions');
  throwExplicitPinConflict(edge, 'route preset compatibility', {
    route: preset,
    allowedPins: [...allowedPins],
    conflictingPins: alternatives.conflictingPins,
  }, alternatives.supportedFixes);
}

function segmentOrientation(start, end) {
  if (Math.abs(start[0] - end[0]) <= 0.0001) return 'vertical';
  if (Math.abs(start[1] - end[1]) <= 0.0001) return 'horizontal';
  return 'diagonal';
}

function routeSegments(points) {
  return points.slice(0, -1).map((start, index) => ({
    start,
    end: points[index + 1],
    orientation: segmentOrientation(start, points[index + 1]),
  }));
}

function endpointSideIsHonored(points, side, endpoint) {
  if (!side || side === 'auto' || points.length < 2) return true;
  const source = endpoint === 'source';
  const from = source ? points[0] : points.at(-2);
  const to = source ? points[1] : points.at(-1);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (source) {
    if (side === 'right') return dx > 0 && Math.abs(dy) <= 0.0001;
    if (side === 'left') return dx < 0 && Math.abs(dy) <= 0.0001;
    if (side === 'bottom') return dy > 0 && Math.abs(dx) <= 0.0001;
    if (side === 'top') return dy < 0 && Math.abs(dx) <= 0.0001;
    return false;
  }
  if (side === 'right') return dx < 0 && Math.abs(dy) <= 0.0001;
  if (side === 'left') return dx > 0 && Math.abs(dy) <= 0.0001;
  if (side === 'bottom') return dy < 0 && Math.abs(dx) <= 0.0001;
  if (side === 'top') return dy > 0 && Math.abs(dx) <= 0.0001;
  return false;
}

function corridorTopologyMatches(points, axis, coordinate) {
  const collapsed = normalizeRoutePoints(points.map((point) => [...point]));
  const start = collapsed[0];
  const end = collapsed.at(-1);
  const via = axis === 'x'
    ? [[coordinate, start[1]], [coordinate, end[1]]]
    : [[start[0], coordinate], [end[0], coordinate]];
  const expected = normalizeRoutePoints([start, ...via, end]);
  const actualPattern = routeSegments(collapsed).map(({ orientation }) => orientation);
  const expectedPattern = routeSegments(expected).map(({ orientation }) => orientation);
  return actualPattern.length === expectedPattern.length
    && actualPattern.every((orientation, index) => orientation === expectedPattern[index])
    && routeContainsChannelPin(
      collapsed,
      axis === 'x' ? 'channelX' : 'channelY',
      coordinate,
    );
}

function routeMatchesPresetFamily(preset, points, from, to) {
  const collapsed = normalizeRoutePoints(points.map((point) => [...point]));
  const segments = routeSegments(collapsed);
  if (preset === 'straight') return collapsed.length === 2;
  if (preset === 'drop') {
    if (from.lane === to.lane) return false;
    if (collapsed.length === 2 && segments[0]?.orientation === 'vertical') return true;
    const upper = from.cy <= to.cy ? from : to;
    const lower = upper === from ? to : from;
    return segments.some(({ start, orientation }) => (
      orientation === 'horizontal'
      && start[1] >= upper.y + upper.height - 0.0001
      && start[1] <= lower.y + 0.0001
      && corridorTopologyMatches(points, 'y', start[1])
    ));
  }
  if (preset === 'outside-right' || preset === 'return-left') {
    const boundary = preset === 'outside-right'
      ? Math.max(from.x + from.width, to.x + to.width)
      : Math.min(from.x, to.x);
    return segments.some(({ start, orientation }) => (
      orientation === 'vertical'
      && (preset === 'outside-right'
        ? start[0] > boundary + 0.0001
        : start[0] < boundary - 0.0001)
      && corridorTopologyMatches(points, 'x', start[0])
    ));
  }
  if (preset === 'bottom-channel' || preset === 'up-channel') {
    const boundary = preset === 'bottom-channel'
      ? Math.max(from.y + from.height, to.y + to.height)
      : Math.min(from.y, to.y);
    return segments.some(({ start, orientation }) => (
      orientation === 'horizontal'
      && (preset === 'bottom-channel'
        ? start[1] > boundary + 0.0001
        : start[1] < boundary - 0.0001)
      && corridorTopologyMatches(points, 'y', start[1])
    ));
  }
  return false;
}

function routeContainsChannelPin(points, field, value) {
  return points.slice(0, -1).some((start, index) => {
    const end = points[index + 1];
    if (field === 'channelX') {
      return start[0] === value
        && end[0] === value
        && Math.abs(end[1] - start[1]) > 0.0001;
    }
    return start[1] === value
      && end[1] === value
      && Math.abs(end[0] - start[0]) > 0.0001;
  });
}

function validateReadablePinnedGeometry() {
  if (workflow.schema_version !== 2) return;
  for (const edge of workflow.edges) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    validateReadableRouteControls(edge);
    const edgeName = workflowEdgeName(edge);
    const edgeIndex = sourceIndexes.edges.get(edge);
    if (Array.isArray(edge.labelAt)) {
      const rect = labelRectFor(edge, workflow.edges.indexOf(edge));
      if (rect && (rect.x < 0 || rect.y < 0)) {
        throwExplicitPinConflict(edge, 'viewBox-origin containment', {
          conflictingPins: [{
            edge: edgeName,
            field: 'labelAt',
            path: `/edges/${edgeIndex}/labelAt`,
            value: [...edge.labelAt],
          }],
          offendingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          minimumCoordinate: 0,
        }, [verifiedLabelAtNudge(edge)]);
      }
    }
    const negativeViaIndex = asArray(edge.via).findIndex(([x, y]) => x < 0 || y < 0);
    const negativeRoutePin = negativeViaIndex >= 0
      ? {
          field: 'via',
          path: `/edges/${edgeIndex}/via/${negativeViaIndex}`,
          value: [...edge.via[negativeViaIndex]],
        }
      : edge.channelX < 0
        ? { field: 'channelX', path: `/edges/${edgeIndex}/channelX`, value: edge.channelX }
        : edge.channelY < 0
          ? { field: 'channelY', path: `/edges/${edgeIndex}/channelY`, value: edge.channelY }
          : null;
    if (negativeRoutePin) {
      throwExplicitPinConflict(edge, 'viewBox-origin containment', {
        conflictingPins: [{ edge: edgeName, ...negativeRoutePin }],
        minimumCoordinate: 0,
      }, [
        verifiedAutomaticRouteFix(edge),
        verifiedAutomaticRouteFix(edge, { clearSides: true }),
      ]);
    }
    const hasPinnedRoute = Array.isArray(edge.via)
      || edge.channelX !== undefined
      || edge.channelY !== undefined;
    const points = pathFor(edge).points;
    if (hasPinnedRoute) {
      const invalidPointIndex = points.findIndex((point) => (
        !Array.isArray(point) || point.length !== 2 || !isFinitePoint(...point)
      ));
      if (invalidPointIndex !== -1) {
        const alternatives = verifiedRouteGeometryPinAlternatives(edge);
        throwExplicitPinConflict(edge, 'finite route coordinates', {
          conflictingPins: alternatives.conflictingPins,
          pointIndex: invalidPointIndex,
          point: points[invalidPointIndex],
        }, alternatives.supportedFixes);
      }
      for (let segmentIndex = 0; segmentIndex < points.length - 1; segmentIndex += 1) {
        const start = points[segmentIndex];
        const end = points[segmentIndex + 1];
        const dx = Math.abs(end[0] - start[0]);
        const dy = Math.abs(end[1] - start[1]);
        if (dx <= 0.0001 && dy <= 0.0001) {
          const duplicateFix = Array.isArray(edge.via) && edge.via.length
            ? verifiedEdgeFix(
              edge,
              `remove duplicate via[${Math.min(segmentIndex, edge.via.length - 1)}] and keep the remaining authored pins unchanged`,
              (candidate) => candidate.via.splice(Math.min(segmentIndex, candidate.via.length - 1), 1),
            )
            : verifiedAutomaticRouteFix(edge);
          const alternatives = Array.isArray(edge.via)
            ? null
            : verifiedRouteGeometryPinAlternatives(edge);
          throwExplicitPinConflict(edge, 'non-zero route segments', {
            conflictingPins: alternatives?.conflictingPins
              || [authoredPinEvidence(edge, 'via')],
            segmentIndex,
            from: start,
            to: end,
          }, alternatives?.supportedFixes || [duplicateFix]);
        }
        if (dx > 0.0001 && dy > 0.0001) {
          const alternatives = verifiedRouteGeometryPinAlternatives(edge);
          throwExplicitPinConflict(edge, 'orthogonal route segments', {
            conflictingPins: alternatives.conflictingPins,
            segmentIndex,
            from: start,
            to: end,
          }, alternatives.supportedFixes);
        }
        const endpoint = segmentIndex === 0 || segmentIndex === points.length - 2;
        const minimumPx = points.length === 2 ? 28 : endpoint ? 8 : 16;
        const lengthPx = dx + dy;
        if (lengthPx + 0.0001 < minimumPx) {
          const alternatives = verifiedRouteGeometryPinAlternatives(edge);
          throwExplicitPinConflict(edge, endpoint ? '8px endpoint stub clearance' : '16px interior turn clearance', {
            conflictingPins: alternatives.conflictingPins,
            segmentIndex,
            position: segmentIndex === 0 ? 'source-stub' : segmentIndex === points.length - 2 ? 'target-stub' : 'interior',
            from: start,
            to: end,
            lengthPx,
            minimumPx,
          }, alternatives.supportedFixes);
        }
      }
      const { fromSide, toSide } = edgeSides(edge);
      if (Array.isArray(edge.via)) {
        const missingChannelPins = presentChannelPins(edge).filter((field) => (
          !routeContainsChannelPin(points, field, edge[field])
        ));
        if (missingChannelPins.length) {
          const candidateFields = ['via', ...missingChannelPins];
          const alternatives = verifiedPinRemovalAlternatives(
            edge,
            candidateFields,
            'and replan the remaining explicit route assertions',
          );
          throwExplicitPinConflict(edge, 'channel pin preservation', {
            route: edge.route || 'auto',
            conflictingPins: conflictPinsFromRemovalSets(
              edge,
              alternatives.removalSets,
              candidateFields,
            ),
            points: points.map((point) => [...point]),
          }, alternatives.supportedFixes);
        }
      }
      if (edge.route
        && edge.route !== 'auto'
        && !routeMatchesPresetFamily(
          edge.route,
          points,
          nodes.get(edge.from),
          nodes.get(edge.to),
        )) {
        const authoredEdgeIndex = workflow.edges.indexOf(edge);
        const alternatives = verifiedPinReferenceAlternatives([
          { edge, edgeIndex: authoredEdgeIndex, field: 'route' },
          ...presentRouteGeometryFields(edge)
            .map((field) => ({ edge, edgeIndex: authoredEdgeIndex, field })),
        ], 'and keep the remaining verified route assertions');
        throwExplicitPinConflict(edge, 'route preset compatibility', {
          route: edge.route,
          conflictingPins: alternatives.conflictingPins,
          points: points.map((point) => [...point]),
        }, alternatives.supportedFixes);
      }
      if (!routeHonorsEndpointSides(points, fromSide, toSide)) {
        const mismatchedSideFields = [
          ...(edge.fromSide && edge.fromSide !== 'auto'
            && !endpointSideIsHonored(points, fromSide, 'source') ? ['fromSide'] : []),
          ...(edge.toSide && edge.toSide !== 'auto'
            && !endpointSideIsHonored(points, toSide, 'target') ? ['toSide'] : []),
        ];
        const candidateFields = [
          ...mismatchedSideFields,
          ...presentRouteGeometryFields(edge),
        ];
        const alternatives = verifiedPinRemovalAlternatives(
          edge,
          candidateFields,
          'and replan the remaining explicit pins',
        );
        throwExplicitPinConflict(edge, 'perpendicular endpoint-side direction', {
          conflictingPins: conflictPinsFromRemovalSets(
            edge,
            alternatives.removalSets,
            candidateFields,
          ),
          points: points.map((point) => [...point]),
          fromSide,
          toSide,
        }, alternatives.supportedFixes);
      }
      const nodeCollision = firstRouteNodeCollision(edge, points);
      if (nodeCollision) {
        const alternatives = verifiedRouteGeometryPinAlternatives(edge);
        throwExplicitPinConflict(edge, 'node clearance', {
          conflictingPins: alternatives.conflictingPins,
          ...nodeCollision,
        }, alternatives.supportedFixes);
      }
      const legendObstacle = workflowLegendRects().find((rect) => points.slice(0, -1).some((point, index) => (
        segmentIntersectsRect({ start: point, end: points[index + 1] }, rect)
      )));
      if (legendObstacle) {
        const alternatives = verifiedRouteGeometryPinAlternatives(edge);
        throwExplicitPinConflict(edge, 'legend clearance', {
          conflictingPins: alternatives.conflictingPins,
          points: points.map((point) => [...point]),
          legendObstacle,
        }, alternatives.supportedFixes);
      }
      const compositionObstacle = workflowSceneLabelObstacles().find((rect) => (
        points.slice(0, -1).some((point, index) => (
          segmentIntersectsRect({ start: point, end: points[index + 1] }, rect)
        ))
      ));
      if (compositionObstacle) {
        const alternatives = verifiedRouteGeometryPinAlternatives(edge);
        throwExplicitPinConflict(edge, 'lane/phase/group label clearance', {
          conflictingPins: alternatives.conflictingPins,
          points: points.map((point) => [...point]),
          compositionObstacle,
        }, alternatives.supportedFixes);
      }
      const [frameRun] = collectBorderRuns({
        routedRelations: [{ points }],
        frames: workflowCompositionFrames(),
      });
      if (frameRun) {
        const alternatives = verifiedRouteGeometryPinAlternatives(edge);
        throwExplicitPinConflict(edge, 'structural-frame border clearance', {
          conflictingPins: alternatives.conflictingPins,
          points: points.map((point) => [...point]),
          frame: frameRun.frame?.id ?? frameRun.frameIndex,
          side: frameRun.side,
          overlapLengthPx: frameRun.overlapLength,
        }, alternatives.supportedFixes);
      }
    }

    if (edge.labelAt) {
      const rect = labelRectFor(edge, workflow.edges.indexOf(edge));
      const obstacle = rect && [...nodes.values()].find((node) => rectsOverlap(rect, node, -2));
      if (obstacle) {
        throwExplicitPinConflict(edge, 'edge-label node clearance', {
          conflictingPins: [authoredPinEvidence(edge, 'labelAt')],
          labelAt: [...edge.labelAt],
          labelRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          obstacleNode: obstacle.id,
        }, [verifiedEdgeFix(
          edge,
          'remove labelAt so readable-v2 can use its verified automatic label placement',
          (candidate) => { delete candidate.labelAt; },
        )]);
      }
      const legendObstacle = rect && workflowLegendRects().find((legendRect) => (
        rectsOverlap(rect, legendRect)
      ));
      if (legendObstacle) {
        throwExplicitPinConflict(edge, 'edge-label legend clearance', {
          conflictingPins: [authoredPinEvidence(edge, 'labelAt')],
          labelAt: [...edge.labelAt],
          labelRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          legendObstacle,
        }, [verifiedEdgeFix(
          edge,
          'remove labelAt so readable-v2 can use its verified automatic label placement',
          (candidate) => { delete candidate.labelAt; },
        )]);
      }
      const compositionObstacle = rect && workflowSceneLabelObstacles().find((candidate) => (
        rectsOverlap(rect, candidate)
      ));
      if (compositionObstacle) {
        throwExplicitPinConflict(edge, 'edge-label lane/phase/group clearance', {
          conflictingPins: [authoredPinEvidence(edge, 'labelAt')],
          labelAt: [...edge.labelAt],
          labelRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          compositionObstacle,
        }, [verifiedEdgeFix(
          edge,
          `remove labelAt from edge "${workflowEdgeName(edge)}" so readable-v2 can use its verified automatic label placement`,
          (candidate) => { delete candidate.labelAt; },
        )]);
      }
    }
  }
  validateReadablePairwisePinConflicts();
}

function validateWorkflow() {
  const problems = [];
  if (workflow.schema_version !== 1 && workflow.schema_version !== 2) {
    problems.push('Workflow files must set "schema_version" to 1 or 2.');
  }
  if (workflow.diagram_type !== 'workflow') {
    problems.push(`Unsupported diagram_type "${workflow.diagram_type}". Expected "workflow".`);
  }
  if (!workflow.meta || !workflow.meta.title) {
    problems.push('Workflow files must include meta.title.');
  }
  if (!Array.isArray(workflow.lanes) || !workflow.lanes.length) {
    problems.push('Workflow files must include at least one lane.');
  }
  if (!Array.isArray(workflow.nodes)) {
    problems.push('Workflow files must include a nodes array.');
  }
  if (!Array.isArray(workflow.edges)) {
    problems.push('Workflow files must include an edges array.');
  }
  if (workflow.phases !== undefined && !Array.isArray(workflow.phases)) {
    problems.push('Workflow "phases" must be an array.');
  }
  if (workflow.groups !== undefined && !Array.isArray(workflow.groups)) {
    problems.push('Workflow "groups" must be an array.');
  }
  if (workflow.mainPath !== undefined && !Array.isArray(workflow.mainPath)) {
    problems.push('Workflow "mainPath" must be an array of node ids.');
  }
  if (workflow.cards !== undefined && !Array.isArray(workflow.cards)) {
    problems.push('Workflow "cards" must be an array.');
  }
  if (problems.length) {
    throwDiagnosticProblems('Workflow layout validation failed', problems, {
      subject: { diagramType: 'workflow' },
    });
  }

  enforceLegacyColumnCapacity();

  const laneIds = new Set(workflow.lanes.map((lane) => lane.id));
  if (laneIds.size !== workflow.lanes.length) {
    problems.push('Lane ids must be unique.');
  }
  if (nodes.size !== workflow.nodes.length) {
    problems.push('Node ids must be unique.');
  }
  const phaseIds = new Set(asArray(workflow.phases).map((phase) => phase.id));
  if (phaseIds.size !== asArray(workflow.phases).length) {
    problems.push('Phase ids must be unique.');
  }
  const groupIds = new Set(asArray(workflow.groups).map((group) => group.id));
  if (groupIds.size !== asArray(workflow.groups).length) {
    problems.push('Group ids must be unique.');
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
    const contentTop = top + layout.laneTitleH + laneGroupHeaderH(node.lane);
    const laneRight = layout.laneX + layout.laneW;
    if (node.x < layout.laneX || node.x + node.width > laneRight) {
      problems.push(`Node "${node.id}" exceeds the horizontal bounds of lane "${node.lane}".`);
    }
    if (node.y < contentTop || node.y + node.height > top + laneHeight(node.lane)) {
      problems.push(`Node "${node.id}" collides with the title or boundary of lane "${node.lane}".`);
    }
  }

  const phaseRanges = [];
  for (const phase of asArray(workflow.phases)) {
    if (!Number.isInteger(phase.fromCol) || !Number.isInteger(phase.toCol)) {
      problems.push(`Phase "${phase.id}" must use integer fromCol/toCol values.`);
      continue;
    }
    if (phase.fromCol < 0 || phase.toCol >= layout.colXs.length || phase.fromCol > phase.toCol) {
      problems.push(`Phase "${phase.id}" uses invalid columns ${phase.fromCol}..${phase.toCol}; use an ordered range within 0..${layout.colXs.length - 1}.`);
    } else {
      phaseRanges.push(phase);
    }
    const estLabelW = textUnits(phase.label) * 5.6;
    const width = phaseSpan(phase).width;
    if (estLabelW > width + 8) {
      problems.push(`Phase label "${phase.label}" (~${Math.round(estLabelW)}px) is wider than its ${Math.round(width)}px span — shorten the label or widen the phase range.`);
    }
  }
  phaseRanges.sort((a, b) => a.fromCol - b.fromCol || a.toCol - b.toCol);
  for (let i = 0; i < phaseRanges.length; i += 1) {
    for (let j = i + 1; j < phaseRanges.length; j += 1) {
      const earlier = phaseRanges[i];
      const later = phaseRanges[j];
      if (later.fromCol > earlier.toCol) break;
      problems.push(`Phase "${later.id}" (${later.fromCol}..${later.toCol}) overlaps phase "${earlier.id}" (${earlier.fromCol}..${earlier.toCol}) — start at col ${earlier.toCol + 1} or later, or end the earlier phase at col ${later.fromCol - 1}.`);
    }
  }

  for (const group of asArray(workflow.groups)) {
    if (!laneIds.has(group.lane)) {
      problems.push(`Group "${group.id}" uses unknown lane "${group.lane}".`);
      continue;
    }
    if (!Number.isInteger(group.fromCol) || !Number.isInteger(group.toCol)) {
      problems.push(`Group "${group.id}" must use integer fromCol/toCol values.`);
      continue;
    }
    if (group.fromCol < 0 || group.toCol >= layout.colXs.length || group.fromCol > group.toCol) {
      problems.push(`Group "${group.id}" uses invalid columns ${group.fromCol}..${group.toCol}; use an ordered range within 0..${layout.colXs.length - 1}.`);
    }
    const contained = [...nodes.values()].some((node) => node.lane === group.lane && node.col >= group.fromCol && node.col <= group.toCol);
    if (!contained) {
      problems.push(`Group "${group.id}" does not contain any nodes — align its lane/columns with the parallel or branch work it frames.`);
    }
  }

  const byLane = new Map();
  for (const node of nodes.values()) {
    byLane.set(node.lane, [...(byLane.get(node.lane) || []), node]);
  }
  for (const [lane, laneNodes] of byLane) {
    for (let i = 0; i < laneNodes.length; i += 1) {
      for (let j = i + 1; j < laneNodes.length; j += 1) {
        if (rectsOverlap(laneNodes[i], laneNodes[j], 8)) {
          problems.push(`Nodes "${laneNodes[i].id}" and "${laneNodes[j].id}" are less than 8px apart in lane "${lane}" — move one to another col, adjust yOffset, or reduce width/height.`);
        }
      }
    }
  }

  for (const edge of workflow.edges) {
    if (!nodes.has(edge.from)) problems.push(`Edge "${edge.label || edge.from}" references unknown source "${edge.from}".`);
    if (!nodes.has(edge.to)) problems.push(`Edge "${edge.label || edge.to}" references unknown target "${edge.to}".`);
    if (nodes.has(edge.from) && nodes.has(edge.to)) {
      const routed = pathFor(edge);
      if (routed.points.length === 2) {
        const [start, end] = routed.points;
        const segmentLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
        if (segmentLength < 28) {
          problems.push(`Edge "${edge.from}" -> "${edge.to}" is too short (${Math.round(segmentLength)}px; minimum 28px) — move the nodes farther apart or use a verified orthogonal route with readable clearance.`);
        }
      }
    }
  }

  problems.push(...cleanEndpointSideProblems({
    relations: workflow.edges,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'workflow',
    relationCollection: 'edges',
    fromSideFor: (edge) => edgeSides(edge).fromSide,
    toSideFor: (edge) => edgeSides(edge).toSide,
    routeHint: 'keep automatic routing, or choose fromSide/toSide and via points whose first and final segments cross node borders perpendicularly',
  }));
  problems.push(...cleanFlowProblems({
    relations: workflow.edges,
    obstacles: nodes.values(),
    pathFor,
    diagramType: 'workflow',
    relationCollection: 'edges',
    obstacleKind: 'node',
    routeHint: 'adjust fromSide/toSide, set route/via or channel coordinates, or move the node to a clearer lane/column'
  }));
  problems.push(...cleanCrossingProblems({
    relations: workflow.edges,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'workflow',
    relationCollection: 'edges',
    profile: workflow.meta?.quality_profile,
    profileIsAuthoritative: true,
    mergeForwardCollinearWaypoints: workflow.schema_version === 2,
    routeHint: 'adjust route/via, bias, or channel coordinates so the edges use separate lane corridors'
  }));
  problems.push(...cleanAmbiguousCorridorProblems({
    relations: workflow.edges,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'workflow',
    relationCollection: 'edges',
    profile: workflow.meta?.quality_profile,
    profileIsAuthoritative: true,
    routeHint: 'adjust route/via, bias, or channel coordinates so unrelated edges do not visually merge'
  }));
  problems.push(...cleanBorderRunProblems({
    relations: workflow.edges,
    endpointIds: new Set(nodes.keys()),
    frames: workflowCompositionFrames(),
    pathFor,
    diagramType: 'workflow',
    relationCollection: 'edges',
    profile: workflow.meta?.quality_profile,
    profileIsAuthoritative: true,
    routeHint: 'adjust route/via, bias, or channel coordinates so the edge crosses the lane or group perpendicularly instead of following its border'
  }));
  problems.push(...cleanRouteRhythmProblems({
    relations: workflow.edges,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'workflow',
    relationCollection: 'edges',
    profile: workflow.meta?.quality_profile,
    profileIsAuthoritative: true,
    routeHint: 'adjust route/via, bias, or channel coordinates so each turn has a readable run-up'
  }));

  if (Array.isArray(workflow.mainPath)) {
    for (const id of workflow.mainPath) {
      if (!nodes.has(id)) {
        problems.push(`mainPath references unknown node "${id}".`);
      }
    }
    for (let i = 0; i < workflow.mainPath.length - 1; i += 1) {
      const fromId = workflow.mainPath[i];
      const toId = workflow.mainPath[i + 1];
      const from = nodes.get(fromId);
      const to = nodes.get(toId);
      if (!from || !to) continue;
      const linked = workflow.edges.some((edge) => edge.from === fromId && edge.to === toId);
      if (!linked) {
        problems.push(`mainPath step "${fromId}" -> "${toId}" has no matching edge — add the edge or remove the pair from mainPath.`);
      }
      if (to.col < from.col) {
        problems.push(`mainPath step "${fromId}" -> "${toId}" moves backward from col ${from.col} to ${to.col} — use a return edge outside mainPath for loops.`);
      }
    }
  }

  const labelRects = [];
  for (const [edgeIndex, edge] of workflow.edges.entries()) {
    const labelRect = labelRectFor(edge, edgeIndex);
    if (labelRect) labelRects.push(labelRect);
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
        problems.push(`Labels "${labelRects[i].label}" and "${labelRects[j].label}" overlap — adjust labelDx/labelDy/labelSegment or route one relationship through a separate corridor.\n${suggestLabelPairFix(labelRects[i], labelRects[j])}`);
      }
    }
  }
  problems.push(...cleanLabelRouteClearanceProblems({
    relations: workflow.edges,
    labels: labelRects,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'workflow',
    relationCollection: 'edges',
    profile: workflow.meta?.quality_profile,
    profileIsAuthoritative: true,
  }));

  if (workflow.schema_version === 1) {
    if (viewBox[0] < layout.laneX + layout.laneW + 16) {
      problems.push(`viewBox width ${viewBox[0]} clips the ${layout.laneW}px lanes — set meta.viewBox[0] to at least ${layout.laneX + layout.laneW + 16}.`);
    }
    if (legendY() + 18 > viewBox[1]) {
      problems.push(`Legend exceeds viewBox height ${viewBox[1]} — set meta.viewBox[1] to at least ${legendY() + 18}.`);
    }
  }

  if (problems.length) {
    throwDiagnosticProblems('Workflow layout validation failed', problems, {
      subject: { diagramType: 'workflow' },
    });
  }
}

function validateReadableInputsBeforeRouting() {
  if (workflow.schema_version !== 2) return;
  const fail = (diagnostic) => throwDiagnosticError(diagnostic.message, [diagnostic]);
  const unusedId = (base, used) => {
    for (let suffix = 2; ; suffix += 1) {
      const candidate = `${base}-${suffix}`;
      if (!used.has(candidate)) return candidate;
    }
  };
  const authoredLanes = [...workflow.lanes].sort((left, right) => (
    sourceIndexes.lanes.get(left) - sourceIndexes.lanes.get(right)
  ));
  const authoredNodes = [...workflow.nodes].sort((left, right) => (
    sourceIndexes.nodes.get(left) - sourceIndexes.nodes.get(right)
  ));
  const authoredEdges = [...workflow.edges].sort((left, right) => (
    sourceIndexes.edges.get(left) - sourceIndexes.edges.get(right)
  ));

  const firstLaneIndex = new Map();
  for (const lane of authoredLanes) {
    const laneIndex = sourceIndexes.lanes.get(lane);
    if (firstLaneIndex.has(lane.id)) {
      const message = `Workflow lane id "${lane.id}" is duplicated.`;
      const replacement = unusedId(lane.id, new Set(workflow.lanes.map(({ id }) => id)));
      const canonicalLaneIndex = workflow.lanes.indexOf(lane);
      const supportedFixes = acceptsFix((document) => {
        document.lanes[canonicalLaneIndex].id = replacement;
      }) ? [`rename /lanes/${laneIndex}/id to verified unique id "${replacement}"`] : [];
      fail({
        code: 'workflow/duplicate-lane-id',
        severity: 'error',
        message,
        subject: { diagramType: 'workflow', lane: lane.id, path: `/lanes/${laneIndex}/id` },
        evidence: {
          duplicateLaneId: lane.id,
          firstPath: `/lanes/${firstLaneIndex.get(lane.id)}/id`,
          duplicatePath: `/lanes/${laneIndex}/id`,
        },
        supportedFixes,
      });
    }
    firstLaneIndex.set(lane.id, laneIndex);
  }

  const firstNodeIndex = new Map();
  for (const node of authoredNodes) {
    const nodeIndex = sourceIndexes.nodes.get(node);
    if (firstNodeIndex.has(node.id)) {
      const message = `Workflow node id "${node.id}" is duplicated.`;
      const replacement = unusedId(node.id, new Set(workflow.nodes.map(({ id }) => id)));
      const canonicalNodeIndex = workflow.nodes.indexOf(node);
      const supportedFixes = acceptsFix((document) => {
        document.nodes[canonicalNodeIndex].id = replacement;
      }) ? [`rename /nodes/${nodeIndex}/id to verified unique id "${replacement}"`] : [];
      fail({
        code: 'workflow/duplicate-node-id',
        severity: 'error',
        message,
        subject: { diagramType: 'workflow', node: node.id, path: `/nodes/${nodeIndex}/id` },
        evidence: {
          duplicateNodeId: node.id,
          firstPath: `/nodes/${firstNodeIndex.get(node.id)}/id`,
          duplicatePath: `/nodes/${nodeIndex}/id`,
        },
        supportedFixes,
      });
    }
    firstNodeIndex.set(node.id, nodeIndex);
  }

  const availableNodeIds = [...nodes.keys()].sort(stableCompare);
  for (const edge of authoredEdges) {
    const edgeIndex = sourceIndexes.edges.get(edge);
    for (const [field, endpoint] of [['from', 'source'], ['to', 'target']]) {
      if (nodes.has(edge[field])) continue;
      const message = `Workflow edge "${workflowEdgeName(edge)}" references unknown ${endpoint} "${edge[field]}".`;
      const canonicalEdgeIndex = workflow.edges.indexOf(edge);
      const supportedFixes = availableNodeIds.flatMap((nodeId) => (
        acceptsFix((document) => {
          document.edges[canonicalEdgeIndex][field] = nodeId;
        })
          ? [`set /edges/${edgeIndex}/${field} to verified node id "${nodeId}"`]
          : []
      ));
      fail({
        code: 'workflow/unknown-edge-endpoint',
        severity: 'error',
        message,
        subject: {
          diagramType: 'workflow',
          edge: edge.id ?? null,
          path: `/edges/${edgeIndex}/${field}`,
          from: edge.from,
          to: edge.to,
        },
        evidence: {
          endpoint,
          unknownNodeId: edge[field],
          availableNodeIds,
        },
        supportedFixes,
      });
    }
  }
  const laneIds = new Set(workflow.lanes.map((lane) => lane.id));
  const availableLaneIds = [...laneIds].sort(stableCompare);
  const nodeSourceIndexes = new Map(authoredNodes.map((node) => [
    node.id,
    sourceIndexes.nodes.get(node),
  ]));

  const byLane = new Map();
  for (const authoredNode of authoredNodes) {
    const nodeIndex = sourceIndexes.nodes.get(authoredNode);
    const node = nodes.get(authoredNode.id);
    if (!laneIds.has(node.lane)) {
      const message = `Workflow node "${node.id}" uses unknown lane "${node.lane}".`;
      const canonicalNodeIndex = workflow.nodes.findIndex((candidate) => candidate.id === node.id);
      const supportedFixes = availableLaneIds.flatMap((laneId) => (
        acceptsFix((document) => {
          document.nodes[canonicalNodeIndex].lane = laneId;
        })
          ? [`set /nodes/${nodeIndex}/lane to verified lane id "${laneId}"`]
          : []
      ));
      fail({
        code: 'workflow/unknown-node-lane',
        severity: 'error',
        message,
        subject: { diagramType: 'workflow', node: node.id, path: `/nodes/${nodeIndex}/lane` },
        evidence: { unknownLaneId: node.lane, availableLaneIds },
        supportedFixes,
      });
    }
    if (!Number.isInteger(node.col) || node.col < 0 || node.col >= layout.colXs.length) {
      const message = `Workflow node "${node.id}" uses column ${node.col}, but valid columns are integers 0..${layout.colXs.length - 1}.`;
      const canonicalNodeIndex = workflow.nodes.findIndex((candidate) => candidate.id === node.id);
      const supportedFixes = layout.colXs.flatMap((_x, col) => (
        acceptsFix((document) => {
          document.nodes[canonicalNodeIndex].col = col;
        })
          ? [`set /nodes/${nodeIndex}/col to verified column ${col}`]
          : []
      ));
      fail({
        code: 'workflow/invalid-node-column',
        severity: 'error',
        message,
        subject: { diagramType: 'workflow', node: node.id, path: `/nodes/${nodeIndex}/col` },
        evidence: { actualColumn: node.col, minimumColumn: 0, maximumColumn: layout.colXs.length - 1 },
        supportedFixes,
      });
    }
    if (!isFinitePoint(node.x, node.y, node.cx, node.cy)) {
      const message = `Workflow node "${node.id}" produced non-finite coordinates.`;
      fail({
        code: 'workflow/non-finite-node-geometry',
        severity: 'error',
        message,
        subject: { diagramType: 'workflow', node: node.id, path: `/nodes/${nodeIndex}` },
        evidence: {
          measuredRect: { x: node.x, y: node.y, width: node.width, height: node.height },
          authored: {
            col: authoredNode.col,
            width: authoredNode.width ?? null,
            height: authoredNode.height ?? null,
            yOffset: authoredNode.yOffset ?? null,
          },
        },
        supportedFixes: [],
      });
    }
    byLane.set(node.lane, [...(byLane.get(node.lane) || []), node]);
  }
  for (const [lane, laneNodes] of byLane) {
    for (let left = 0; left < laneNodes.length; left += 1) {
      for (let right = left + 1; right < laneNodes.length; right += 1) {
        if (rectsOverlap(laneNodes[left], laneNodes[right], 8)) {
          const leftNode = laneNodes[left];
          const rightNode = laneNodes[right];
          const rightIndex = nodeSourceIndexes.get(rightNode.id);
          const canonicalNodeIndex = workflow.nodes.findIndex((candidate) => (
            candidate.id === rightNode.id
          ));
          const supportedFixes = layout.colXs.flatMap((_x, col) => {
            if (col === rightNode.col) return [];
            return acceptsFix((document) => {
              document.nodes[canonicalNodeIndex].col = col;
            })
              ? [`set /nodes/${rightIndex}/col to verified free column ${col}`]
              : [];
          });
          const message = `Workflow nodes "${leftNode.id}" and "${rightNode.id}" are less than 8px apart in lane "${lane}".`;
          fail({
            code: 'workflow/node-overlap',
            severity: 'error',
            message,
            subject: { diagramType: 'workflow', node: rightNode.id, path: `/nodes/${rightIndex}` },
            evidence: {
              lane,
              minimumClearancePx: 8,
              nodes: [
                { id: leftNode.id, rect: { x: leftNode.x, y: leftNode.y, width: leftNode.width, height: leftNode.height } },
                { id: rightNode.id, rect: { x: rightNode.x, y: rightNode.y, width: rightNode.width, height: rightNode.height } },
              ],
            },
            supportedFixes,
          });
        }
      }
    }
  }
}

function gapYBetween(fromLane, toLane, bias = 0.5) {
  const a = laneTop(fromLane) + laneHeight(fromLane);
  const b = laneTop(toLane);
  return a + (b - a) * bias;
}

function spanForCols(fromCol, toCol, pad = 46, minimumWidth = 0) {
  const start = layout.colXs[fromCol] - pad;
  const end = layout.colXs[toCol] + pad;
  const width = Math.max(end - start, minimumWidth);
  if (fromCol === toCol && width > end - start) {
    return { x: start, width, cx: start + width / 2 };
  }
  const cx = (start + end) / 2;
  return { x: cx - width / 2, width, cx };
}

function phaseSpan(phase) {
  return spanForCols(
    phase.fromCol,
    phase.toCol,
    46,
    workflow.schema_version === 2 ? textUnits(phase.label) * 5.6 + 8 : 0,
  );
}

function groupSpan(group) {
  if (workflow.schema_version === 2) {
    return readableGroupBounds(workflow, group, layout.colXs);
  }
  return spanForCols(
    group.fromCol,
    group.toCol,
    50,
    0,
  );
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

function firstRouteNodeCollision(edge, points) {
  const lastSegment = points.length - 2;
  for (const node of nodes.values()) {
    const endpointRole = node.id === edge.from
      ? 'source-endpoint'
      : node.id === edge.to ? 'target-endpoint' : 'unrelated';
    for (let segmentIndex = 0; segmentIndex <= lastSegment; segmentIndex += 1) {
      if (endpointRole === 'source-endpoint' && segmentIndex === 0) continue;
      if (endpointRole === 'target-endpoint' && segmentIndex === lastSegment) continue;
      const clearancePx = endpointRole === 'unrelated' ? 2 : 0;
      const from = points[segmentIndex];
      const to = points[segmentIndex + 1];
      if (segmentIntersectsRect({ start: from, end: to }, node, clearancePx)) {
        return {
          obstacleNode: node.id,
          obstacleRole: endpointRole,
          segmentIndex,
          from: [...from],
          to: [...to],
          clearancePx,
        };
      }
    }
  }
  return null;
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

const pathCache = new Map();
const readableSideCache = new Map();

function legacyAutomaticOneBendSides(edge, from, to) {
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

function readableAutomaticSides(edge, from, to) {
  const automaticRoute = !edge.via
    && edge.channelX === undefined
    && edge.channelY === undefined
    && (!edge.route || edge.route === 'auto');
  const authoredFrom = edge.fromSide && edge.fromSide !== 'auto' ? edge.fromSide : null;
  const authoredTo = edge.toSide && edge.toSide !== 'auto' ? edge.toSide : null;
  if (!automaticRoute || (authoredFrom && authoredTo)) return null;
  if (readableSideCache.has(edge)) return readableSideCache.get(edge);

  const preferred = [];
  const legacyPreferred = legacyAutomaticOneBendSides(edge, from, to);
  if (legacyPreferred) preferred.push(legacyPreferred);
  preferred.push({
    fromSide: authoredFrom || defaultFromSide(from, to),
    toSide: authoredTo || defaultToSide(from, to),
  });
  const sideOrder = ['right', 'bottom', 'left', 'top'];
  for (const fromSide of authoredFrom ? [authoredFrom] : sideOrder) {
    for (const toSide of authoredTo ? [authoredTo] : sideOrder) {
      preferred.push({ fromSide, toSide });
    }
  }

  const seen = new Set();
  const sidePairs = [];
  for (const candidate of preferred) {
    if (authoredFrom && candidate.fromSide !== authoredFrom) continue;
    if (authoredTo && candidate.toSide !== authoredTo) continue;
    const key = `${candidate.fromSide}:${candidate.toSide}`;
    if (seen.has(key)) continue;
    seen.add(key);
    sidePairs.push(candidate);
  }

  const naturalFromSide = authoredFrom || defaultFromSide(from, to);
  const naturalToSide = authoredTo || defaultToSide(from, to);
  const planFor = (candidate, pairOrdinal) => {
    const start = anchor(from, candidate.fromSide);
    const end = anchor(to, candidate.toSide);
    return {
      start,
      end,
      planned: readableAutomaticCandidateSet(
        edge,
        from,
        to,
        start,
        end,
        candidate.fromSide,
        candidate.toSide,
        {
          ordinalOffset: pairOrdinal * 9,
          naturalFromSide,
          naturalToSide,
        },
      ),
    };
  };

  const primary = sidePairs[0];
  if (primary) {
    const { planned } = planFor(primary, 0);
    if (planned.candidates.length) {
      readableSideCache.set(edge, primary);
      return primary;
    }
  }

  const candidates = [];
  for (const [pairOrdinal, candidate] of sidePairs.entries()) {
    const { planned } = planFor(candidate, pairOrdinal);
    candidates.push(...planned.candidates.map((route) => ({ ...route, ...candidate })));
  }
  candidates.sort((left, right) => compareCost(left.cost, right.cost));
  if (candidates.length) {
    const selected = {
      fromSide: candidates[0].fromSide,
      toSide: candidates[0].toSide,
    };
    readableSideCache.set(edge, selected);
    return selected;
  }
  readableSideCache.set(edge, null);
  return null;
}

function automaticOneBendSides(edge, from, to) {
  return workflow.schema_version === 2
    ? readableAutomaticSides(edge, from, to)
    : legacyAutomaticOneBendSides(edge, from, to);
}

const OUTWARD_SIDE_VECTOR = Object.freeze({
  left: [-1, 0],
  right: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
});

function outwardStub(point, side, distance = 16) {
  const [dx, dy] = OUTWARD_SIDE_VECTOR[side] || [0, 0];
  return [point[0] + dx * distance, point[1] + dy * distance];
}

function orthogonalRoute(points) {
  return points.every((point, index) => {
    if (!Array.isArray(point) || point.length !== 2 || !isFinitePoint(...point)) return false;
    if (index === 0) return true;
    const previous = points[index - 1];
    const dx = Math.abs(point[0] - previous[0]);
    const dy = Math.abs(point[1] - previous[1]);
    return (dx <= 0.0001) !== (dy <= 0.0001);
  });
}

function routeClearsEndpointNodes(points, from, to) {
  const lastSegment = points.length - 2;
  for (let index = 0; index <= lastSegment; index += 1) {
    const segment = { start: points[index], end: points[index + 1] };
    if (index > 0 && segmentIntersectsRect(segment, from)) return false;
    if (index < lastSegment && segmentIntersectsRect(segment, to)) return false;
  }
  return true;
}

function routeMeetsHardRhythm(points) {
  if (points.length === 2) {
    return Math.hypot(points[1][0] - points[0][0], points[1][1] - points[0][1]) + 0.0001 >= 28;
  }
  return points.slice(0, -1).every((point, index) => {
    const length = Math.abs(points[index + 1][0] - point[0]) + Math.abs(points[index + 1][1] - point[1]);
    const endpoint = index === 0 || index === points.length - 2;
    return length + 0.0001 >= (endpoint ? 8 : 16);
  });
}

function routeLabelClearsNodes(edge, points) {
  if (!edge.label || edge.labelAt) return true;
  const [lx, ly] = workflowEdgeLabelPoint(edge, points);
  const rect = {
    x: lx - workflowLabelWidth(edge.label) / 2,
    y: ly - 10,
    width: workflowLabelWidth(edge.label),
    height: 14,
  };
  return [...nodes.values()].every((node) => !rectsOverlap(rect, node, -2));
}

function candidateLabelRect(edge, points) {
  if (!edge.label) return null;
  const [lx, ly] = workflowEdgeLabelPoint(edge, points);
  const width = workflowLabelWidth(edge.label);
  return { x: lx - width / 2, y: ly - 10, width, height: 14 };
}

function labelRouteClearanceDeficit(edge, points, threshold = 8) {
  const candidateLabel = candidateLabelRect(edge, points);
  let deficit = 0;
  for (const [otherEdge, routed] of pathCache) {
    const otherIndex = workflow.edges.indexOf(otherEdge);
    const otherLabel = labelRectFor(otherEdge, otherIndex);
    if (candidateLabel) {
      for (let index = 0; index < routed.points.length - 1; index += 1) {
        const clearance = segmentRectClearance({
          start: routed.points[index],
          end: routed.points[index + 1],
        }, candidateLabel);
        if (clearance != null) deficit += Math.max(0, threshold - clearance);
      }
    }
    if (otherLabel) {
      for (let index = 0; index < points.length - 1; index += 1) {
        const clearance = segmentRectClearance({
          start: points[index],
          end: points[index + 1],
        }, otherLabel);
        if (clearance != null) deficit += Math.max(0, threshold - clearance);
      }
    }
  }
  return deficit;
}

function routeClearsPlacedLabels(edge, points) {
  const candidateLabel = candidateLabelRect(edge, points);
  for (const [otherEdge, routed] of pathCache) {
    const otherIndex = workflow.edges.indexOf(otherEdge);
    const otherLabel = labelRectFor(otherEdge, otherIndex);
    if (candidateLabel && otherLabel && rectsOverlap(candidateLabel, otherLabel, -2)) return false;
    if (candidateLabel) {
      for (let index = 0; index < routed.points.length - 1; index += 1) {
        const clearance = segmentRectClearance({
          start: routed.points[index],
          end: routed.points[index + 1],
        }, candidateLabel);
        if (clearance != null && clearance + 0.0001 < 4) return false;
      }
    }
    if (otherLabel) {
      for (let index = 0; index < points.length - 1; index += 1) {
        const clearance = segmentRectClearance({
          start: points[index],
          end: points[index + 1],
        }, otherLabel);
        if (clearance != null && clearance + 0.0001 < 4) return false;
      }
    }
  }
  return true;
}

function routeClearsLegend(edge, points) {
  if (!workflowLegendEntries.length) return true;
  const legendRects = workflowLegendRects();
  for (const rect of legendRects) {
    for (let index = 0; index < points.length - 1; index += 1) {
      if (segmentIntersectsRect({ start: points[index], end: points[index + 1] }, rect)) return false;
    }
    const label = candidateLabelRect(edge, points);
    if (label && rectsOverlap(label, rect)) return false;
  }
  return true;
}

function routeClearsSceneLabelObstacles(edge, points) {
  const label = candidateLabelRect(edge, points);
  for (const obstacle of workflowSceneLabelObstacles()) {
    for (let index = 0; index < points.length - 1; index += 1) {
      if (segmentIntersectsRect({ start: points[index], end: points[index + 1] }, obstacle)) {
        return false;
      }
    }
    if (label && rectsOverlap(label, obstacle)) return false;
  }
  return true;
}

function routeClearsFrameBorders(points) {
  return collectBorderRuns({
    routedRelations: [{ points }],
    frames: workflowCompositionFrames(),
  }).length === 0;
}

function routeExtentCoordinates(edge, points) {
  const coordinates = [...points];
  if (!edge.labelAt) {
    const label = candidateLabelRect(edge, points);
    if (label) {
      coordinates.push([label.x, label.y], [label.x + label.width, label.y + label.height]);
    }
  }
  return coordinates;
}

function routeFitsCanvasOrigin(edge, points) {
  return routeExtentCoordinates(edge, points).every(([x, y]) => x >= 0 && y >= 0);
}

function readableCandidateIsFeasible(edge, points, from, to, fromSide, toSide) {
  return points.length >= 2
    && orthogonalRoute(points)
    && routeHonorsEndpointSides(points, fromSide, toSide)
    && routeMeetsHardRhythm(points)
    && routeClearsEndpointNodes(points, from, to)
    && routeClearsUnrelatedNodes(edge, points)
    && routeLabelClearsNodes(edge, points)
    && routeClearsPlacedLabels(edge, points)
    && routeClearsLegend(edge, points)
    && routeClearsSceneLabelObstacles(edge, points)
    && routeClearsFrameBorders(points)
    && routeFitsCanvasOrigin(edge, points);
}

function corridorViaY(start, end, fromSide, toSide, y) {
  const startStub = outwardStub(start, fromSide);
  const endStub = outwardStub(end, toSide);
  return [startStub, [startStub[0], y], [endStub[0], y], endStub];
}

function corridorViaX(start, end, fromSide, toSide, x) {
  const startStub = outwardStub(start, fromSide);
  const endStub = outwardStub(end, toSide);
  return [startStub, [x, startStub[1]], [x, endStub[1]], endStub];
}

function axisOverlapLength(a, b, c, d) {
  const horizontal = Math.abs(a[1] - b[1]) <= 0.0001
    && Math.abs(c[1] - d[1]) <= 0.0001
    && Math.abs(a[1] - c[1]) <= 0.0001;
  const vertical = Math.abs(a[0] - b[0]) <= 0.0001
    && Math.abs(c[0] - d[0]) <= 0.0001
    && Math.abs(a[0] - c[0]) <= 0.0001;
  if (!horizontal && !vertical) return 0;
  const axis = horizontal ? 0 : 1;
  return Math.max(0, Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis]))
    - Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis])));
}

function properAxisCrossing(a, b, c, d) {
  const firstHorizontal = Math.abs(a[1] - b[1]) <= 0.0001;
  const secondHorizontal = Math.abs(c[1] - d[1]) <= 0.0001;
  if (firstHorizontal === secondHorizontal) return false;
  const horizontal = firstHorizontal ? [a, b] : [c, d];
  const vertical = firstHorizontal ? [c, d] : [a, b];
  const x = vertical[0][0];
  const y = horizontal[0][1];
  return x > Math.min(horizontal[0][0], horizontal[1][0]) + 0.0001
    && x < Math.max(horizontal[0][0], horizontal[1][0]) - 0.0001
    && y > Math.min(vertical[0][1], vertical[1][1]) + 0.0001
    && y < Math.max(vertical[0][1], vertical[1][1]) - 0.0001;
}

function routeInteractionMetrics(edge, points) {
  let properCrossingCount = 0;
  let sharedCorridorPx = 0;
  for (const [otherEdge, routed] of pathCache) {
    if ([edge.from, edge.to].some((id) => id === otherEdge.from || id === otherEdge.to)) continue;
    for (let left = 0; left < points.length - 1; left += 1) {
      for (let right = 0; right < routed.points.length - 1; right += 1) {
        if (properAxisCrossing(points[left], points[left + 1], routed.points[right], routed.points[right + 1])) {
          properCrossingCount += 1;
        }
        sharedCorridorPx += axisOverlapLength(
          points[left], points[left + 1], routed.points[right], routed.points[right + 1],
        );
      }
    }
  }
  return { properCrossingCount, sharedCorridorPx };
}

function automaticForwardReversePx(edge, points) {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  if (!from || !to || ['return', 'error'].includes(edge.role) || to.col <= from.col) return 0;
  return points.slice(0, -1).reduce((total, point, index) => (
    total + Math.max(0, point[0] - points[index + 1][0])
  ), 0);
}

function readableCandidateCost(
  edge,
  points,
  ordinal,
  naturalFromSide,
  naturalToSide,
) {
  const interaction = routeInteractionMetrics(edge, points);
  const segmentLengths = points.slice(0, -1).map((point, index) => (
    Math.abs(points[index + 1][0] - point[0]) + Math.abs(points[index + 1][1] - point[1])
  ));
  const routeLength = segmentLengths.reduce((total, length) => total + length, 0);
  const directLength = Math.abs(points.at(-1)[0] - points[0][0]) + Math.abs(points.at(-1)[1] - points[0][1]);
  const interiorPreferred28Deficit = segmentLengths.slice(1, -1)
    .reduce((total, length) => total + Math.max(0, 28 - length), 0);
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const canvasGrowthPx = Math.max(0, -Math.min(...xs))
    + Math.max(0, Math.max(...xs) - minimumCanvasWidth)
    + Math.max(0, -Math.min(...ys))
    + Math.max(0, Math.max(...ys) - autoHeight);
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  const naturalStart = anchor(from, naturalFromSide);
  const naturalEnd = anchor(to, naturalToSide);
  const portDisplacementPx = Math.abs(points[0][0] - naturalStart[0])
    + Math.abs(points[0][1] - naturalStart[1])
    + Math.abs(points.at(-1)[0] - naturalEnd[0])
    + Math.abs(points.at(-1)[1] - naturalEnd[1]);
  const legacyCoordinateDisplacement = Math.abs(from.cx - LEGACY_COLUMN_CENTERS[from.col])
    + Math.abs(to.cx - LEGACY_COLUMN_CENTERS[to.col]);
  return {
    automaticForwardReversePx: automaticForwardReversePx(edge, points),
    properCrossingCount: interaction.properCrossingCount,
    sharedCorridorPx: interaction.sharedCorridorPx,
    labelRouteClearanceDeficit: labelRouteClearanceDeficit(edge, points),
    interiorPreferred28Deficit,
    bendCount: Math.max(0, points.length - 2),
    stretchMilli: Math.round((directLength > 0 ? routeLength / directLength : 1) * 1000),
    canvasGrowthPx,
    portDisplacementMilli: Math.round(portDisplacementPx * 1000),
    legacyCoordinateDisplacement,
    stableCandidateOrdinal: ordinal,
  };
}

function compareCost(left, right) {
  for (const dimension of READABLE_CANDIDATE_COST_PRIORITY) {
    if ((left[dimension] || 0) !== (right[dimension] || 0)) {
      return (left[dimension] || 0) - (right[dimension] || 0);
    }
  }
  return 0;
}

function readableAutomaticCandidateSet(
  edge,
  from,
  to,
  start,
  end,
  fromSide,
  toSide,
  {
    ordinalOffset = 0,
    naturalFromSide = fromSide,
    naturalToSide = toSide,
  } = {},
) {
  const midX = (start[0] + end[0]) / 2;
  const laneGapY = from.lane === to.lane
    ? laneTop(from.lane) - 16
    : gapYBetween(from.lane, to.lane, edge.bias ?? 0.5);
  const topY = Math.max(8, Math.min(laneTop(from.lane), laneTop(to.lane)) - 16);
  const bottomY = Math.max(
    laneTop(from.lane) + laneHeight(from.lane),
    laneTop(to.lane) + laneHeight(to.lane),
  ) + 16;
  const outsideLeft = layout.laneX - 20;
  const outsideRight = layout.laneX + layout.laneW + 12;
  const rawCandidates = [
    { family: 'facing-straight', via: [] },
    { family: 'horizontal-then-vertical', via: [[end[0], start[1]]] },
    { family: 'vertical-then-horizontal', via: [[start[0], end[1]]] },
    { family: 'lane-gap-corridor', via: corridorViaY(start, end, fromSide, toSide, laneGapY) },
    { family: 'column-gap-corridor', via: corridorViaX(start, end, fromSide, toSide, midX) },
    { family: 'outside-left', via: corridorViaX(start, end, fromSide, toSide, outsideLeft) },
    { family: 'outside-right', via: corridorViaX(start, end, fromSide, toSide, outsideRight) },
    { family: 'top-corridor', via: corridorViaY(start, end, fromSide, toSide, topY) },
    { family: 'bottom-corridor', via: corridorViaY(start, end, fromSide, toSide, bottomY) },
  ];
  const candidates = rawCandidates.map((candidate, ordinal) => ({
    ...candidate,
    ordinal: ordinalOffset + ordinal,
    points: normalizeRoutePoints([start, ...candidate.via, end]),
  })).filter(({ points }) => (
    readableCandidateIsFeasible(edge, points, from, to, fromSide, toSide)
  )).map((candidate) => ({
    ...candidate,
    cost: readableCandidateCost(
      edge,
      candidate.points,
      candidate.ordinal,
      naturalFromSide,
      naturalToSide,
    ),
  })).sort((left, right) => compareCost(left.cost, right.cost));
  return { rawCandidates, candidates, outsideRight };
}

function readableAutomaticVia(edge, from, to, start, end, fromSide, toSide) {
  const { rawCandidates, candidates, outsideRight } = readableAutomaticCandidateSet(
    edge,
    from,
    to,
    start,
    end,
    fromSide,
    toSide,
  );

  if (candidates.length) return candidates[0].points.slice(1, -1);
  const outsideRightCandidate = rawCandidates.find(({ family }) => family === 'outside-right');
  if (outsideRightCandidate) {
    const currentPoints = normalizeRoutePoints([start, ...outsideRightCandidate.via, end]);
    const labelRect = candidateLabelRect(edge, currentPoints);
    let outsideRightMinX = outsideRight;
    for (const node of nodes.values()) {
      if (!labelRect || !rectsOverlap(labelRect, node, -2)) continue;
      const rightwardLabelDeficit = node.x + node.width - 2 - labelRect.x;
      if (rightwardLabelDeficit > 0) {
        outsideRightMinX = Math.max(
          outsideRightMinX,
          outsideRight + rightwardLabelDeficit * 2,
        );
      }
    }
    for (const [otherEdge, routed] of pathCache) {
      const otherIndex = workflow.edges.indexOf(otherEdge);
      const otherLabel = labelRectFor(otherEdge, otherIndex);
      if (labelRect && otherLabel && rectsOverlap(labelRect, otherLabel, -2)) {
        const rightwardLabelDeficit = otherLabel.x + otherLabel.width - 2 - labelRect.x;
        if (rightwardLabelDeficit > 0) {
          outsideRightMinX = Math.max(
            outsideRightMinX,
            outsideRight + rightwardLabelDeficit * 2,
          );
        }
      }
      if (!labelRect) continue;
      for (let index = 0; index < routed.points.length - 1; index += 1) {
        const segment = {
          start: routed.points[index],
          end: routed.points[index + 1],
        };
        const clearance = segmentRectClearance(segment, labelRect);
        if (clearance == null || clearance + 0.0001 >= 4) continue;
        const rightwardLabelDeficit = Math.max(segment.start[0], segment.end[0])
          + 4 - labelRect.x;
        if (rightwardLabelDeficit > 0) {
          outsideRightMinX = Math.max(
            outsideRightMinX,
            outsideRight + rightwardLabelDeficit * 2,
          );
        }
      }
    }
    outsideRightMinX = Math.ceil(outsideRightMinX * 1000) / 1000;
    let rightmostPlacedX = outsideRight;
    for (const node of nodes.values()) {
      rightmostPlacedX = Math.max(rightmostPlacedX, node.x + node.width);
    }
    for (const [otherEdge, routed] of pathCache) {
      for (const [x] of routed.points) rightmostPlacedX = Math.max(rightmostPlacedX, x);
      const otherLabel = labelRectFor(otherEdge, workflow.edges.indexOf(otherEdge));
      if (otherLabel) {
        rightmostPlacedX = Math.max(rightmostPlacedX, otherLabel.x + otherLabel.width);
      }
    }
    let probeGrowth = Math.max(
      32,
      labelRect?.width ?? 0,
      rightmostPlacedX + 16 - outsideRightMinX,
    );
    let lastInfeasibleX = outsideRight;
    for (let probe = 0; probe < 7; probe += 1) {
      if (outsideRightMinX > outsideRight + 0.0001) {
        const expandedPoints = normalizeRoutePoints([
          start,
          ...corridorViaX(start, end, fromSide, toSide, outsideRightMinX),
          end,
        ]);
        if (readableCandidateIsFeasible(edge, expandedPoints, from, to, fromSide, toSide)) {
          let feasibleX = outsideRightMinX;
          let feasiblePoints = expandedPoints;
          let infeasibleX = lastInfeasibleX;
          for (let refinement = 0;
            refinement < 53 && feasibleX - infeasibleX > 0.001;
            refinement += 1) {
            const midpointX = Math.ceil(((infeasibleX + feasibleX) / 2) * 1000) / 1000;
            if (midpointX >= feasibleX - 0.0001) break;
            const midpointPoints = normalizeRoutePoints([
              start,
              ...corridorViaX(start, end, fromSide, toSide, midpointX),
              end,
            ]);
            if (readableCandidateIsFeasible(
              edge,
              midpointPoints,
              from,
              to,
              fromSide,
              toSide,
            )) {
              feasibleX = midpointX;
              feasiblePoints = midpointPoints;
            } else {
              infeasibleX = midpointX;
            }
          }
          return feasiblePoints.slice(1, -1);
        }
        lastInfeasibleX = outsideRightMinX;
      }
      outsideRightMinX = Math.ceil((outsideRightMinX + probeGrowth) * 1000) / 1000;
      probeGrowth *= 2;
    }
  }
  const hasRelevantAbsolutePin = Array.isArray(edge.labelAt)
    || [...pathCache.keys()].some((otherEdge) => (
      Array.isArray(otherEdge.labelAt) || hasAbsoluteRoutePins(otherEdge)
    ));
  if (hasRelevantAbsolutePin) classifyFailedAutomaticCandidatePins(edge, rawCandidates);
  const horizontallyFacing = (
    fromSide === 'right' && toSide === 'left' && end[0] > start[0]
  ) || (
    fromSide === 'left' && toSide === 'right' && start[0] > end[0]
  );
  if (horizontallyFacing && from.col !== to.col) {
    const fromCol = Math.min(from.col, to.col);
    const toCol = Math.max(from.col, to.col);
    const requiredRankGap = from.width / 2 + 32 + to.width / 2;
    const actualRankGap = layout.colXs[toCol] - layout.colXs[fromCol];
    if (actualRankGap + 0.0001 < requiredRankGap) {
      throw new WorkflowLayoutFeedback({
        kind: 'rank-gap-minimum',
        fromCol,
        toCol,
        minimum: Math.ceil(requiredRankGap * 1000) / 1000,
        edge: edge.id ?? null,
        from: edge.from,
        to: edge.to,
        attemptedCandidateFamilies: rawCandidates.map(({ family }) => family),
        candidateCount: rawCandidates.length,
      });
    }
  }
  if (from.lane !== to.lane && layout.laneGap < 32) {
    throw new WorkflowLayoutFeedback({
      kind: 'lane-gap-minimum',
      minimum: 32,
      edge: edge.id ?? null,
      from: edge.from,
      to: edge.to,
      attemptedCandidateFamilies: rawCandidates.map(({ family }) => family),
      candidateCount: rawCandidates.length,
    });
  }
  const message = `Workflow edge "${workflowEdgeName(edge)}" has no feasible readable-v2 automatic route.`;
  throwDiagnosticError(message, [{
    code: 'workflow/solver-budget-exhausted',
    severity: 'error',
    message,
    subject: {
      diagramType: 'workflow',
      edge: edge.id ?? null,
      from: edge.from,
      to: edge.to,
    },
    evidence: {
      attemptedCandidateFamilies: rawCandidates.map(({ family }) => family),
      candidateCount: rawCandidates.length,
    },
    supportedFixes: [],
  }]);
}

function readablePresetVia(edge, from, to, start, end, fromSide, toSide) {
  const preset = edge.route;
  let via;
  switch (preset) {
    case 'straight':
      via = [];
      break;
    case 'drop': {
      const y = gapYBetween(from.lane, to.lane, edge.bias ?? 0.5);
      via = [[start[0], y], [end[0], y]];
      break;
    }
    case 'outside-right': {
      const x = layout.laneX + layout.laneW + 12;
      via = [[x, start[1]], [x, end[1]]];
      break;
    }
    case 'return-left': {
      const x = Math.min(from.x, to.x) - 28;
      via = [[x, start[1]], [x, end[1]]];
      break;
    }
    case 'bottom-channel': {
      const y = Math.max(from.y + from.height, to.y + to.height) + 32;
      via = [[start[0], y], [end[0], y]];
      break;
    }
    case 'up-channel': {
      const y = Math.min(from.y, to.y) - 28;
      via = [[start[0], y], [end[0], y]];
      break;
    }
    default:
      return readableAutomaticVia(edge, from, to, start, end, fromSide, toSide);
  }
  const points = normalizeRoutePoints([start, ...via, end]);
  if (readableCandidateIsFeasible(edge, points, from, to, fromSide, toSide)
    && routeMatchesPresetFamily(preset, points, from, to)) {
    return points.slice(1, -1);
  }
  const message = `Workflow edge "${workflowEdgeName(edge)}" cannot satisfy route preset "${preset}" under readable-v2 constraints (minimum 8px endpoint stubs, 16px interior turns, and 28px direct clearance).`;
  const edgeIndex = workflow.edges.indexOf(edge);
  const edgeName = workflowEdgeName(edge);
  const supportedFixes = [];
  for (const candidatePreset of ['straight', 'drop', 'outside-right', 'return-left', 'bottom-channel', 'up-channel']) {
    if (candidatePreset === preset) continue;
    if (acceptsFix((document) => {
      document.edges[edgeIndex].route = candidatePreset;
    })) {
      supportedFixes.push(`set edge "${edgeName}" route to verified preset "${candidatePreset}"`);
    }
  }
  if (acceptsFix((document) => {
    delete document.edges[edgeIndex].route;
  })) {
    supportedFixes.push(`remove route from edge "${edgeName}" so readable-v2 can use its verified automatic candidate`);
  }
  throwDiagnosticError(message, [{
    code: 'workflow/route-preset-conflict',
    severity: 'error',
    message,
    subject: {
      diagramType: 'workflow',
      edge: edge.id ?? null,
      from: edge.from,
      to: edge.to,
      route: preset,
    },
    evidence: {
      attemptedCandidateFamily: preset,
      points,
      fromSide,
      toSide,
      requiredEndpointStubPx: 8,
      requiredInteriorSegmentPx: 16,
      requiredDirectClearancePx: 28,
    },
    supportedFixes,
  }]);
}

function routeVia(
  edge,
  from,
  to,
  start,
  end,
  fromSide,
  toSide,
  { validateReadablePreset = true } = {},
) {
  if (edge.via) return edge.via;
  const hasCoordinatePins = edge.channelX !== undefined || edge.channelY !== undefined;
  if (workflow.schema_version === 2
    && edge.route
    && edge.route !== 'auto'
    && !hasCoordinatePins
    && validateReadablePreset) {
    return readablePresetVia(edge, from, to, start, end, fromSide, toSide);
  }
  switch (edge.route || 'auto') {
    case 'straight':
      return [];
    case 'drop': {
      const y = edge.channelY ?? gapYBetween(from.lane, to.lane, edge.bias ?? 0.5);
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
      if (workflow.schema_version === 2) {
        if (edge.channelX !== undefined && edge.channelY !== undefined) {
          return [[edge.channelX, start[1]], [edge.channelX, edge.channelY], [end[0], edge.channelY]];
        }
        if (edge.channelX !== undefined) return [[edge.channelX, start[1]], [edge.channelX, end[1]]];
        if (edge.channelY !== undefined) return [[start[0], edge.channelY], [end[0], edge.channelY]];
        return readableAutomaticVia(edge, from, to, start, end, fromSide, toSide);
      }
      if (from.lane === to.lane) return sameLaneAutoVia(start, end);
      const oneBendVia = oneBendCrossLaneVia(edge, start, end, fromSide, toSide);
      if (oneBendVia) return oneBendVia;
      const y = gapYBetween(from.lane, to.lane, edge.bias ?? 0.5);
      return [[start[0], y], [end[0], y]];
    }
  }
}

function workflowEdgeLabelPoint(edge, points) {
  if (workflow.schema_version === 1) {
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
  if (edge.labelAt || Number.isInteger(edge.labelSegment) || points.length <= 2) {
    return labelPoint(edge, points);
  }
  const segments = points.slice(0, -1).map((point, index) => ({
    index,
    horizontal: Math.abs(points[index + 1][1] - point[1]) <= 0.0001,
    length: Math.hypot(
      points[index + 1][0] - point[0],
      points[index + 1][1] - point[1],
    ),
  })).sort((left, right) => (
    Number(right.horizontal) - Number(left.horizontal)
    || right.length - left.length
    || left.index - right.index
  ));
  const labelSegment = segments[0]?.index ?? 0;
  const point = labelPoint({ ...edge, labelSegment }, points);
  if (points[labelSegment][0] === points[labelSegment + 1][0]) point[1] += 10;
  return point;
}

function edgeSides(edge) {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  const resolved = workflow.schema_version === 2 ? readableSideCache.get(edge) : null;
  if (resolved) return resolved;
  const oneBendSides = automaticOneBendSides(edge, from, to);
  if (oneBendSides) return oneBendSides;
  if (workflow.schema_version === 2
    && layout.channelLabelEdgeKeys?.has(stableValueKey(edge))
    && !edge.fromSide
    && !edge.toSide) {
    return { fromSide: 'top', toSide: 'top' };
  }
  return {
    fromSide: chosenSide(edge.fromSide, defaultFromSide(from, to)),
    toSide: chosenSide(edge.toSide, defaultToSide(from, to)),
  };
}

const automaticPorts = automaticPortSpread(workflow.edges, nodes, {
  sideFor: (edge, endpoint) => edgeSides(edge)[endpoint === 'source' ? 'fromSide' : 'toSide'],
});

function readableAutomaticRoute(edge, from, to, primarySides, primaryPorts) {
  const authoredFrom = edge.fromSide && edge.fromSide !== 'auto' ? edge.fromSide : null;
  const authoredTo = edge.toSide && edge.toSide !== 'auto' ? edge.toSide : null;
  const sideOrder = ['right', 'bottom', 'left', 'top'];
  const sidePairs = [primarySides];
  for (const fromSide of authoredFrom ? [authoredFrom] : sideOrder) {
    for (const toSide of authoredTo ? [authoredTo] : sideOrder) {
      sidePairs.push({ fromSide, toSide });
    }
  }

  const naturalFromSide = authoredFrom || defaultFromSide(from, to);
  const naturalToSide = authoredTo || defaultToSide(from, to);
  const seen = new Set();
  const plans = [];
  const feedback = [];
  let firstFailure = null;
  for (const candidateSides of sidePairs) {
    if (authoredFrom && candidateSides.fromSide !== authoredFrom) continue;
    if (authoredTo && candidateSides.toSide !== authoredTo) continue;
    const key = `${candidateSides.fromSide}:${candidateSides.toSide}`;
    if (seen.has(key)) continue;
    const pairOrdinal = seen.size;
    seen.add(key);
    const primary = pairOrdinal === 0;
    const start = primaryPorts?.from && primary
      ? primaryPorts.from
      : anchor(from, candidateSides.fromSide);
    const end = primaryPorts?.to && primary
      ? primaryPorts.to
      : anchor(to, candidateSides.toSide);
    const planned = readableAutomaticCandidateSet(
      edge,
      from,
      to,
      start,
      end,
      candidateSides.fromSide,
      candidateSides.toSide,
      {
        ordinalOffset: pairOrdinal * 9,
        naturalFromSide,
        naturalToSide,
      },
    );
    plans.push(...planned.candidates.map((candidate) => ({
      ...candidate,
      ...candidateSides,
    })));
    if (planned.candidates.length) continue;
    try {
      const expandedVia = withDiagnosticRecordingSuppressed(() => readableAutomaticVia(
        edge,
        from,
        to,
        start,
        end,
        candidateSides.fromSide,
        candidateSides.toSide,
      ));
      const expandedPoints = normalizeRoutePoints([start, ...expandedVia, end]);
      const outsideRightOrdinal = planned.rawCandidates.findIndex(({ family }) => (
        family === 'outside-right'
      ));
      const ordinal = pairOrdinal * 9 + Math.max(0, outsideRightOrdinal);
      plans.push({
        family: 'outside-right',
        ordinal,
        points: expandedPoints,
        cost: readableCandidateCost(
          edge,
          expandedPoints,
          ordinal,
          naturalFromSide,
          naturalToSide,
        ),
        ...candidateSides,
      });
    } catch (error) {
      if (error instanceof WorkflowLayoutFeedback) {
        feedback.push({ error, pairOrdinal });
      } else if (!firstFailure) {
        firstFailure = error;
      }
    }
  }

  plans.sort((left, right) => compareCost(left.cost, right.cost));
  if (plans.length) {
    const selected = plans[0];
    return {
      points: selected.points,
      fromSide: selected.fromSide,
      toSide: selected.toSide,
    };
  }

  const feedbackPriority = {
    'rank-gap-minimum': 0,
    'lane-gap-minimum': 1,
  };
  feedback.sort((left, right) => (
    (feedbackPriority[left.error.request?.kind] ?? 99)
      - (feedbackPriority[right.error.request?.kind] ?? 99)
    || left.pairOrdinal - right.pairOrdinal
  ));
  if (feedback.length) throw feedback[0].error;
  const authoredSideFields = [
    ...(authoredFrom ? ['fromSide'] : []),
    ...(authoredTo ? ['toSide'] : []),
  ];
  if (authoredSideFields.length) {
    const alternatives = verifiedPinRemovalAlternatives(
      edge,
      authoredSideFields,
      'so readable-v2 can replan the remaining endpoint-side pins',
    );
    const sourceAnchor = primaryPorts?.from || anchor(from, primarySides.fromSide);
    const targetAnchor = primaryPorts?.to || anchor(to, primarySides.toSide);
    const attemptedEvidence = firstFailure?.archifyDiagnostics?.[0]?.evidence || {};
    throwExplicitPinConflict(edge, 'readable route feasibility with authored endpoint sides', {
      conflictingPins: conflictPinsFromRemovalSets(
        edge,
        alternatives.removalSets,
        authoredSideFields,
      ),
      actualCoordinates: {
        sourceAnchor: [...sourceAnchor],
        targetAnchor: [...targetAnchor],
      },
      fromSide: primarySides.fromSide,
      toSide: primarySides.toSide,
      ...(attemptedEvidence.attemptedCandidateFamilies
        ? { attemptedCandidateFamilies: attemptedEvidence.attemptedCandidateFamilies }
        : {}),
      ...(attemptedEvidence.candidateCount !== undefined
        ? { candidateCount: attemptedEvidence.candidateCount }
        : {}),
    }, alternatives.supportedFixes);
  }
  if (firstFailure) throw firstFailure;
  throw new Error('readable-v2 automatic route enumeration produced no result');
}

function isReadableControlledRoute(edge) {
  return workflow.schema_version === 2 && (
    Array.isArray(edge.via)
    || edge.channelX !== undefined
    || edge.channelY !== undefined
    || (edge.route && edge.route !== 'auto')
  );
}

function readableControlledRoute(edge, from, to) {
  const authoredFrom = edge.fromSide && edge.fromSide !== 'auto' ? edge.fromSide : null;
  const authoredTo = edge.toSide && edge.toSide !== 'auto' ? edge.toSide : null;
  const naturalFromSide = authoredFrom || defaultFromSide(from, to);
  const naturalToSide = authoredTo || defaultToSide(from, to);
  const sideOrder = ['right', 'bottom', 'left', 'top'];
  const preferredPairs = [{
    fromSide: naturalFromSide,
    toSide: naturalToSide,
  }];
  for (const fromSide of authoredFrom ? [authoredFrom] : sideOrder) {
    for (const toSide of authoredTo ? [authoredTo] : sideOrder) {
      preferredPairs.push({ fromSide, toSide });
    }
  }

  const seen = new Set();
  const sidePairs = preferredPairs.filter(({ fromSide, toSide }) => {
    if (authoredFrom && fromSide !== authoredFrom) return false;
    if (authoredTo && toSide !== authoredTo) return false;
    const key = `${fromSide}:${toSide}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const hasAbsoluteRoutePins = Array.isArray(edge.via)
    || edge.channelX !== undefined
    || edge.channelY !== undefined;
  const candidates = [];
  const diagnosticCandidates = [];
  const materializedCandidates = [];
  for (const [ordinal, { fromSide, toSide }] of sidePairs.entries()) {
    const start = anchor(from, fromSide);
    const end = anchor(to, toSide);
    const via = routeVia(
      edge,
      from,
      to,
      start,
      end,
      fromSide,
      toSide,
      { validateReadablePreset: false },
    );
    const authoredPoints = [start, ...via, end];
    const points = hasAbsoluteRoutePins
      ? authoredPoints
      : normalizeRoutePoints(authoredPoints);
    const materialized = { points, fromSide, toSide, ordinal };
    materializedCandidates.push(materialized);
    if (points.length >= 2
      && points.every((point) => (
        Array.isArray(point) && point.length === 2 && isFinitePoint(...point)
      ))
      && routeHonorsEndpointSides(points, fromSide, toSide)) {
      diagnosticCandidates.push(materialized);
    }
    if (!readableCandidateIsFeasible(edge, points, from, to, fromSide, toSide)) continue;
    if (edge.route && edge.route !== 'auto' && !routeMatchesPresetFamily(
      edge.route,
      points,
      from,
      to,
    )) continue;
    if (presentChannelPins(edge).some((field) => (
      !routeContainsChannelPin(points, field, edge[field])
    ))) continue;
    candidates.push({
      points,
      fromSide,
      toSide,
      cost: readableCandidateCost(
        edge,
        points,
        ordinal,
        naturalFromSide,
        naturalToSide,
      ),
    });
  }
  candidates.sort((left, right) => compareCost(left.cost, right.cost));
  if (candidates.length) return candidates[0];

  // Absolute geometry is authoritative even when it is invalid. Preserve the
  // best endpoint-side inference so validation can diagnose the authored
  // segment or preset that actually failed instead of silently falling back to
  // default sides and changing the route's meaning.
  if (hasAbsoluteRoutePins) {
    return diagnosticCandidates[0] || materializedCandidates[0] || null;
  }

  // Preset-only routes retain their dedicated typed conflict (and verified
  // alternative search) when exhaustive side inference found no valid plan.
  const fallback = materializedCandidates[0];
  if (!fallback) return null;
  const fallbackVia = readablePresetVia(
    edge,
    from,
    to,
    fallback.points[0],
    fallback.points.at(-1),
    fallback.fromSide,
    fallback.toSide,
  );
  return {
    ...fallback,
    points: normalizeRoutePoints([
      fallback.points[0],
      ...fallbackVia,
      fallback.points.at(-1),
    ]),
  };
}

function pathFor(edge) {
  if (pathCache.has(edge)) return pathCache.get(edge);
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  if (isReadableControlledRoute(edge)) {
    const planned = readableControlledRoute(edge, from, to);
    if (planned) {
      readableSideCache.set(edge, {
        fromSide: planned.fromSide,
        toSide: planned.toSide,
      });
      const routed = { d: polylinePath(planned.points), points: planned.points };
      pathCache.set(edge, routed);
      return routed;
    }
  }
  const ports = automaticPorts.get(edge);
  const { fromSide, toSide } = edgeSides(edge);
  const readableAutomatic = workflow.schema_version === 2
    && !Array.isArray(edge.via)
    && edge.channelX === undefined
    && edge.channelY === undefined
    && (!edge.route || edge.route === 'auto');
  if (readableAutomatic) {
    const planned = readableAutomaticRoute(
      edge,
      from,
      to,
      { fromSide, toSide },
      ports,
    );
    readableSideCache.set(edge, {
      fromSide: planned.fromSide,
      toSide: planned.toSide,
    });
    const routed = { d: polylinePath(planned.points), points: planned.points };
    pathCache.set(edge, routed);
    return routed;
  }
  const start = ports?.from || anchor(from, fromSide);
  const end = ports?.to || anchor(to, toSide);
  const authoredPoints = [start, ...routeVia(edge, from, to, start, end, fromSide, toSide), end];
  const hasAbsoluteRoutePins = Array.isArray(edge.via)
    || edge.channelX !== undefined
    || edge.channelY !== undefined;
  const points = workflow.schema_version === 2 && !hasAbsoluteRoutePins
    ? normalizeRoutePoints(authoredPoints)
    : authoredPoints;
  const routed = { d: polylinePath(points), points };
  pathCache.set(edge, routed);
  return routed;
}

function labelRectFor(edge, relationIndex) {
  if (!edge.label || !nodes.has(edge.from) || !nodes.has(edge.to)) return null;
  const [lx, ly] = workflowEdgeLabelPoint(edge, pathFor(edge).points);
  const width = workflowLabelWidth(edge.label);
  return {
    relation: edge,
    relationIndex,
    label: edge.label,
    x: lx - width / 2,
    y: legStatesCost(edge) ? ly - 22 : ly - 10,
    width,
    height: edgeLabelHeight(edge),
    lx,
    ly,
  };
}

function measuredContentBounds() {
  let left = layout.laneX;
  let top = 27;
  let right = layout.laneX + layout.laneW;
  let bottom = legendY() + 18;
  const owners = {
    left: 'workflow lanes',
    top: asArray(workflow.phases).length ? 'phase header band' : 'workflow top padding',
    right: 'workflow lanes',
    bottom: workflowLegendEntries.length ? 'legend' : 'workflow lanes and bottom padding',
  };
  const includePoint = ([x, y], contributor) => {
    if (x < left) {
      left = x;
      owners.left = contributor;
    }
    if (y < top) {
      top = y;
      owners.top = contributor;
    }
    if (x > right) {
      right = x;
      owners.right = contributor;
    }
    if (y > bottom) {
      bottom = y;
      owners.bottom = contributor;
    }
  };
  const includeRect = (rect, contributor) => {
    includePoint([rect.x, rect.y], contributor);
    includePoint([rect.x + rect.width, rect.y + rect.height], contributor);
  };

  for (const node of nodes.values()) includeRect(node, `node ${node.id}`);
  for (const [index, edge] of workflow.edges.entries()) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    for (const point of pathFor(edge).points) includePoint(point, `edge ${edge.id || index}`);
    const label = labelRectFor(edge, index);
    if (label) includeRect(label, `edge ${edge.id || index} label mask`);
  }
  for (const phase of asArray(workflow.phases)) {
    if (!Number.isInteger(phase.fromCol) || !Number.isInteger(phase.toCol)
      || phase.fromCol < 0 || phase.toCol >= layout.colXs.length || phase.fromCol > phase.toCol) continue;
    const span = phaseSpan(phase);
    includeRect({ x: span.x, y: 27, width: span.width, height: 16 }, `phase ${phase.id}`);
  }
  for (const group of asArray(workflow.groups)) {
    if (!laneIndex.has(group.lane) || !Number.isInteger(group.fromCol) || !Number.isInteger(group.toCol)
      || group.fromCol < 0 || group.toCol >= layout.colXs.length || group.fromCol > group.toCol) continue;
    const span = groupSpan(group);
    includeRect({
      x: span.x,
      y: laneTop(group.lane) + layout.laneTitleH + GROUP_FRAME_TOP_INSET,
      width: span.width,
      height: workflow.schema_version === 2
        ? laneHeight(group.lane) - layout.laneTitleH
          - GROUP_FRAME_TOP_INSET - GROUP_FRAME_BOTTOM_INSET
        : layout.laneH - layout.laneTitleH - 16,
    }, `group ${group.id}`);
    if (workflow.schema_version === 2) {
      const frameY = laneTop(group.lane) + layout.laneTitleH + GROUP_FRAME_TOP_INSET;
      const labelBaseline = frameY + GROUP_LABEL_BASELINE_OFFSET;
      includeRect({
        x: span.x + 10,
        y: labelBaseline - GROUP_LABEL_MASK_ASCENT,
        width: textUnits(group.label) * 5.6,
        height: GROUP_LABEL_MASK_H,
      }, `group ${group.id} label`);
    }
  }
  if (workflowLegendEntries.length) {
    for (const rect of workflowLegendRects()) includeRect(rect, `legend ${rect.kind}`);
  }
  return {
    left,
    top,
    right,
    bottom,
    contributors: [...new Set([
      ...Object.values(owners),
      ...asArray(layout.widthContributors),
      ...asArray(layout.heightContributors),
    ])],
  };
}

function finalizeReadableViewBox() {
  if (workflow.schema_version !== 2) {
    requiredViewBox = [...viewBox];
    return;
  }
  const bounds = measuredContentBounds();
  requiredViewBox = [
    Math.max(minimumCanvasWidth, Math.ceil(bounds.right + 16)),
    Math.max(autoHeight, Math.ceil(bounds.bottom + 18)),
  ];
  const outsideOrigin = bounds.left < 0 || bounds.top < 0;
  if (outsideOrigin) {
    const hasAbsolutePins = workflow.edges.some((edge) => (
      Array.isArray(edge.via)
      || Array.isArray(edge.labelAt)
      || edge.channelX !== undefined
      || edge.channelY !== undefined
    ));
    const message = `Workflow geometry extends above or left of the viewBox origin (${Math.round(bounds.left)}, ${Math.round(bounds.top)}).`;
    throwDiagnosticError(message, [{
      code: hasAbsolutePins ? 'workflow/explicit-pin-conflict' : 'workflow/solver-budget-exhausted',
      severity: 'error',
      message,
      subject: { diagramType: 'workflow', path: '/meta/viewBox' },
      evidence: {
        actualViewBox: [...viewBox],
        requiredViewBox: [...requiredViewBox],
        contentBounds: [bounds.left, bounds.top, bounds.right, bounds.bottom],
        contributors: bounds.contributors,
      },
      supportedFixes: [],
    }]);
  }
  if (!workflow.meta?.viewBox) {
    viewBox = [...requiredViewBox];
    return;
  }
  const tooNarrow = viewBox[0] < requiredViewBox[0];
  const tooShort = viewBox[1] < requiredViewBox[1];
  if (!tooNarrow && !tooShort) return;
  const message = `Workflow viewBox ${viewBox[0]}×${viewBox[1]} cannot contain the readable-v2 layout; minimum ${requiredViewBox[0]}×${requiredViewBox[1]}.`;
  const supportedFixes = [];
  if (acceptsFix((document) => {
    document.meta.viewBox = [...requiredViewBox];
  })) {
    supportedFixes.push(`set meta.viewBox to at least [${requiredViewBox[0]}, ${requiredViewBox[1]}]`);
  }
  if (acceptsFix((document) => {
    delete document.meta.viewBox;
  })) {
    supportedFixes.push('omit meta.viewBox so the compiler can use its measured intrinsic canvas');
  }
  throwDiagnosticError(message, [{
    code: 'workflow/viewbox-capacity',
    severity: 'error',
    message,
    subject: { diagramType: 'workflow', path: '/meta/viewBox' },
    evidence: {
      actualViewBox: [...viewBox],
      requiredViewBox: [...requiredViewBox],
      contentBounds: [bounds.left, bounds.top, bounds.right, bounds.bottom],
      contributors: bounds.contributors,
    },
    supportedFixes,
  }]);
}

function renderLane(lane, index) {
  const y = laneTop(lane.id);
  const height = laneHeight(index);
  const exception = lane.variant === 'exception'
    ? `\n        <rect data-graph-role="structural-frame" data-composition-frame-kind="exception-lane" data-composition-frame-id="lane-${index}-exception" x="${layout.laneX + 6}" y="${y + 6}" width="${layout.laneW - 12}" height="${height - 12}" rx="8" class="c-security-group" stroke-width="1"/>`
    : '';
  const labelClass = lane.variant === 'exception' ? 't-security' : 't-dim';
  const prefix = lane.variant === 'exception' ? 'EX' : String(index + 1).padStart(2, '0');
  // A reader who reads one lane alone needs the other lanes to leave the
  // canvas, so the frame and its title carry their lane when solo is declared.
  const laneId = readerDeclaration().needsLanes ? ` data-lane-id="${esc(lane.id)}"` : '';
  return `        <rect data-graph-role="structural-frame" data-composition-frame-kind="lane" data-composition-frame-id="lane-${index}"${laneId} x="${layout.laneX}" y="${y}" width="${layout.laneW}" height="${height}" rx="10" class="c-lane" stroke-width="1"/>${exception}
        <text${readerDeclaration().needsLanes ? ` data-lane-label="${esc(lane.id)}"` : ''} x="${layout.laneX + 14}" y="${y + 22}" class="${labelClass}" font-size="10" font-weight="600">${prefix} / ${esc(lane.label)}</text>`;
}

function renderPhase(phase) {
  const span = phaseSpan(phase);
  const accent = variantAccent(phase.variant);
  const [lineClass] = arrowClassMap[phase.variant || 'default'] || arrowClassMap.default;
  return `        <line x1="${span.x}" y1="35" x2="${span.x + span.width}" y2="35" class="${lineClass}" stroke-width="1.1"/>
        <rect x="${span.x}" y="27" width="${span.width}" height="16" rx="4" class="c-mask"/>
        <text x="${span.cx}" y="39" class="${accent}" font-size="8" font-weight="600" text-anchor="middle">${esc(phase.label)}</text>`;
}

function renderGroup(group, index) {
  const span = groupSpan(group);
  const y = laneTop(group.lane) + layout.laneTitleH + GROUP_FRAME_TOP_INSET;
  const height = workflow.schema_version === 2
    ? laneHeight(group.lane) - layout.laneTitleH
      - GROUP_FRAME_TOP_INSET - GROUP_FRAME_BOTTOM_INSET
    : layout.laneH - layout.laneTitleH - 16;
  const cls = group.variant === 'security' ? 'c-security-group' : 'c-lane';
  const textClass = variantAccent(group.variant);
  const labelY = workflow.schema_version === 2 ? y + GROUP_LABEL_BASELINE_OFFSET : y + 14;
  const laneId = readerDeclaration().needsLanes ? ` data-lane-id="${esc(group.lane)}"` : '';
  return `        <rect data-graph-role="structural-frame" data-composition-frame-kind="group" data-composition-frame-id="group-${index}"${laneId} x="${span.x}" y="${y}" width="${span.width}" height="${height}" rx="9" class="${cls}" stroke-width="1"/>
        <text x="${span.x + 10}" y="${labelY}" class="${textClass}" font-size="7" font-weight="600">${esc(group.label)}</text>`;
}

// Reader affordances are declared per document and default to nothing. The
// renderer knows a slot's value shape, never its meaning: a pack names the
// slot, labels it, says which view it drives, and which rule the reader's own
// clock should replay.
function readerDeclaration() {
  const reader = (workflow.meta && workflow.meta.reader) || null;
  const empty = {
    active: false,
    store: false,
    slots: [],
    view: { dim: [], stow: [], solo: false },
    clock: null,
    needsLanes: false,
    suppress: [],
  };
  if (!reader) return empty;
  const crafted = (slot, index) => {
    const kind = slot.kind || 'flag';
    const label = typeof slot.label === 'string' && slot.label.trim() ? slot.label : slot.id;
    const cue = typeof slot.cue === 'string' && slot.cue.trim()
      ? slot.cue
      : { flag: '✓', point: '◎', text: '✎', time: '◔', minutes: '⏱' }[kind];
    return {
      id: slot.id,
      kind,
      label,
      cue,
      maxLength: Number.isInteger(slot.maxLength) ? slot.maxLength : 200,
      order: index,
    };
  };
  const target = (entry) => {
    if (typeof entry === 'string') return { slot: entry, reach: 'self' };
    if (entry && typeof entry === 'object' && typeof entry.slot === 'string') {
      return { slot: entry.slot, reach: entry.reach === 'before' ? 'before' : 'self' };
    }
    return null;
  };
  const targets = (list) => asArray(list).map(target).filter(Boolean);
  const slots = asArray(reader.slots).filter((slot) => slot && typeof slot.id === 'string').map(crafted);
  const view = reader.view || {};
  const dim = targets(view.dim);
  const stow = targets(view.stow);
  const solo = view.solo === true;
  const raw = reader.clock && typeof reader.clock === 'object' ? reader.clock : null;
  const clock = raw && typeof raw.rule === 'string'
    ? {
        rule: raw.rule,
        anchor: typeof raw.anchor === 'string' ? raw.anchor : null,
        at: typeof raw.at === 'string' ? raw.at : null,
        dwell: typeof raw.dwell === 'string' ? raw.dwell : null,
      }
    : null;
  return {
    active: slots.length > 0 || dim.length > 0 || stow.length > 0 || solo,
    store: reader.store === true,
    slots,
    view: { dim, stow, solo },
    clock,
    needsLanes: Boolean(clock) || solo || [...dim, ...stow].some((entry) => entry.reach === 'before'),
    suppress: asArray(reader.suppress),
  };
}

// The reader's clock replays the authored rule in the browser, so the rule's
// inputs travel with the artifact: the seeds, the per-stop and per-leg
// minutes, and the templates the compiler rendered with.
function readerClockBlob() {
  const declaration = readerDeclaration();
  const clock = declaration.clock;
  if (!clock || !clock.rule) return null;
  const rule = asArray(workflow.meta && workflow.meta.rules).find((entry) => entry.id === clock.rule);
  if (!rule || rule.kind !== 'accumulate') return null;
  const nodeFact = (rule.add && rule.add.node) || null;
  const edgeFact = (rule.add && rule.add.edge) || null;
  const lanes = {};
  const laneLabels = {};
  const nodes = {};
  const edges = {};
  const edgeLabels = {};
  const routes = {};
  for (const [laneId, seed] of Object.entries(rule.seeds || {})) {
    lanes[laneId] = { start: seed.start, base: ruleSeedValue(seed.base) };
    const outgoing = ruleOutgoingEdges(asArray(workflow.nodes), asArray(workflow.edges), laneId, rule.scope);
    routes[laneId] = Object.fromEntries([...outgoing.values()].map(edge => [
      edge.from + ' ' + edge.to, edgeFact ? ruleFactValue(edge, edgeFact) : 0,
    ]));
  }
  for (const lane of asArray(workflow.lanes)) {
    if (lanes[lane.id]) laneLabels[lane.id] = lane.readerLabel || lane.label;
  }
  for (const node of asArray(workflow.nodes)) {
    const value = nodeFact ? ruleFactValue(node, nodeFact) : null;
    nodes[node.id] = value === null ? 0 : value;
  }
  for (const edge of asArray(workflow.edges)) {
    const key = edge.from + ' ' + edge.to;
    const value = edgeFact ? ruleFactValue(edge, edgeFact) : null;
    edges[key] = value === null ? 0 : value;
    edgeLabels[key] = authoredEdgeLabels.get(edge.id) || edge.label || '';
  }
  const first = Object.values(rule.seeds || {})[0];
  return {
    limit: rule.limit && Number.isFinite(rule.limit.max) ? rule.limit.max : null,
    lanes,
    laneLabels,
    nodes,
    edges,
    routes,
    edgeLabels,
    edgeFormat: (rule.render && rule.render.edge) || null,
    laneFormat: (rule.render && rule.render.lane) || null,
    captionFormat: (rule.render && rule.render.caption)
      || i18nText(workflow.meta.locale, 'workflow.leg.cost', { value: '{minutes}' }, workflow.meta.labels),
    bands: clockBandList((workflow.meta && workflow.meta.bands) || []).bands,
    wrap: rule.wrap && Number.isFinite(rule.wrap.at) ? { at: rule.wrap.at, label: rule.wrap.label || '' } : null,
    clock: typeof (first && first.base) === 'string',
  };
}

function renderNodeActions(node) {
  const links = asArray(node.links);
  if (!links.length) return '';
  const gap = 4;
  const chips = links.map((link) => {
    const text = String(link.label);
    // CJK-aware enough for 2-4 character chip labels at font-size 8.
    const width = Math.round([...text].reduce((sum, ch) => sum + (ch.codePointAt(0) > 0x2e80 ? 8 : 4.6), 0)) + 10;
    return { href: link.href, text, width };
  });
  const total = chips.reduce((sum, chip) => sum + chip.width, 0) + gap * Math.max(chips.length - 1, 0);
  // The row is the card's footer, clear of the description line above it.
  const baseline = node.y + node.height - 4;
  const rowFits = total <= node.width - 12;
  if (chips.length && !rowFits) {
    renderProblems.push({
      code: 'workflow/action-row-overflow',
      severity: 'error',
      message: `Node "${node.id}" authors ${chips.length} actions needing ${total}px, but only ${node.width - 12}px is available. The row would be dropped silently.`,
      subject: { diagramType: 'workflow', node: node.id },
      evidence: { actions: chips.map((chip) => chip.text), needed: total, available: node.width - 12 },
      supportedFixes: [
        'shorten an action label',
        'increase the node width',
        'or move the full action list into a card',
      ],
    });
  }
  if (chips.length && rowFits && node.tag && node.height < 78) {
    renderProblems.push({
      code: 'workflow/action-row-overlap',
      severity: 'error',
      message: `Node "${node.id}" carries a tag, a context line and ${chips.length} actions in ${node.height}px; the lines would overlap.`,
      subject: { diagramType: 'workflow', node: node.id },
      evidence: { height: node.height, needed: 78, actions: chips.length },
      supportedFixes: ['give the node height: 78', 'or move the actions into a card'],
    });
  }
  let row = '';
  if (chips.length && rowFits) {
    let x = node.cx - total / 2;
    row = chips.map((chip) => {
      const out = `<a href="${esc(chip.href)}" target="_blank" rel="noopener noreferrer" data-node-link="${esc(chip.text)}" aria-label="${esc(chip.text + ' ' + node.label)}"><rect x="${x.toFixed(1)}" y="${(baseline - 8).toFixed(1)}" width="${chip.width}" height="11" class="c-action-hit"/><text x="${(x + chip.width / 2).toFixed(1)}" y="${baseline.toFixed(1)}" class="t-action ${typeText(workflow, node.type) || 't-muted'}" font-size="8" text-anchor="middle">${esc(chip.text)}</text></a>`;
      x += chip.width + gap;
      return out;
    }).join('');
  }
  // Reader state does not draw here: the viewer's own passport already opens
  // on a click, and the runtime adds the declared slots to that surface.
  return `\n          <g class="node-actions" data-node-actions="">${row}</g>`;
}

// Authored links, media, and reader chrome are the only sources that emit this
// stylesheet, so diagrams without them keep byte-identical output.
function renderLinkStyles() {
  const anyNode = [...nodes.values()].some((node) => Array.isArray(node.links) && node.links.length);
  const anyEdge = workflow.edges.some((edge) => Array.isArray(edge.links) && edge.links.length);
  const anyMedia = [...nodes.values()].some((node) => node.media && node.media.href);
  const declaration = readerDeclaration();
  if (!anyNode && !anyEdge && !anyMedia && !declaration.suppress.length) return '';
  return `
        <style>
          .c-action-hit { fill: transparent; }
          .t-action { font-weight: 600; }
          svg a[data-node-link]:hover .t-action { text-decoration: underline; }
          .c-link-chip { fill: var(--mask, #0f172a); stroke: var(--panel-border, #334155); stroke-width: 1; vector-effect: non-scaling-stroke; }
          .t-link-chip { fill: var(--text, #e2e8f0); font-weight: 700; }
          .node-actions { opacity: 0; pointer-events: none; transition: opacity 140ms ease; }
          svg [data-node-id]:hover .node-actions,
          svg [data-node-id]:focus-visible .node-actions,
          svg [data-node-id][data-focus-selected] .node-actions { opacity: 1; pointer-events: auto; }
          svg a[data-node-link], svg a[data-edge-link] { cursor: pointer; }
          svg a:focus-visible .c-link-chip { stroke: #34d399; stroke-width: 2; }
          .c-media-frame { fill: var(--mask, #0f172a); stroke: var(--panel-border, #334155); stroke-width: 1; }
          .t-media-caption { fill: var(--text-muted, #94a3b8); }
          .node-media { display: none; pointer-events: none; }
          svg [data-node-id]:hover .node-media,
          svg [data-node-id]:focus-visible .node-media,
          svg[data-focus-active]:not([data-focus-active*=" "]) [data-node-id][data-focus-selected] .node-media { display: inline; opacity: 1; }
          @media print { .node-actions, .node-media { display: none; } }
        </style>`;
}

// The clip path is shared because every media card uses one size. It is only
// emitted when a node actually authors media, so other diagrams stay identical.
function renderMediaClip() {
  const anyMedia = [...nodes.values()].some((node) => node.media && node.media.href);
  if (!anyMedia) return '';
  return `
        <defs><clipPath id="node-media-clip"><rect x="0" y="0" width="168" height="100" rx="6"/></clipPath></defs>`;
}

// An authored photo stays out of the canonical diagram until its owner is
// hovered, focused, or selected. The card floats in diagram space, so it never
// changes validated geometry, and diagrams without media emit nothing.
function renderNodeMedia(node) {
  const media = node.media;
  if (!media || !media.href) return '';
  const width = 168;
  const height = 100;
  const x = node.cx - width / 2;
  const y = node.y + node.height + 8;
  const caption = media.alt
    ? `\n          <text x="${(width / 2).toFixed(1)}" y="${(height + 13).toFixed(1)}" class="t-media-caption" font-size="8" text-anchor="middle">${esc(media.alt)}</text>`
    : '';
  return `\n          <g class="node-media" data-node-media="" aria-hidden="true" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
          <rect x="-3" y="-3" width="${width + 6}" height="${height + 6}" rx="8" class="c-media-frame"/>
          <image href="${esc(media.href)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#node-media-clip)"/>${caption}
        </g>`;
}

function renderNode(node) {
  const fill = typeFill(workflow, node.type) || 'c-external';
  const accent = typeText(workflow, node.type) || 't-muted';
  const hasSub = node.sublabel != null && node.sublabel !== '';
  const labelFontSize = fittedNodeFontSize(node.label, brandLabelFitWidth(node, node.width), nodeTextFit.labelPreferred, nodeTextFit.labelMinimum);
  const sublabelFontSize = hasSub
    ? fittedNodeFontSize(node.sublabel, node.width, nodeTextFit.sublabelPreferred, nodeTextFit.sublabelMinimum)
    : nodeTextFit.sublabelPreferred;
  const sub = hasSub
    ? `\n          <text data-detail="context" x="${node.cx}" y="${node.y + 38}" class="t-muted" font-size="${sublabelFontSize}" text-anchor="middle">${esc(node.sublabel)}</text>`
    : '';
  const tag = node.tag
    ? `\n        <text data-detail="fine" x="${node.cx}" y="${node.y + node.height - 12}" class="${accent}" font-size="${fittedNodeFontSize(node.tag, node.width, nodeTextFit.tagPreferred, nodeTextFit.tagMinimum)}" text-anchor="middle">${esc(node.tag)}</text>`
    : '';
  const brand = renderBrandMark(node, { x: node.x + node.width - 22, y: node.y + 6 });
  const actions = renderNodeActions(node);
  const mediaCard = renderNodeMedia(node);
  const passport = { kind: node.type, sublabel: node.sublabel, tag: node.tag, context: nodeContext(node), ...brandMetadataFor(node) };
  // Lane membership is only emitted when a document lets readers read one lane
  // alone, so every other workflow keeps its previous markup.
  const laneAttr = readerDeclaration().needsLanes ? ` data-node-lane="${esc(node.lane)}"` : '';
  return `        <g ${focusNodeAttrs(node.id, node.label, passport, workflow.meta.locale)}${laneAttr}>
          ${focusNodeTitle(node.label, passport)}
          <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="c-mask"/>
          <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="${fill}"${animateAttr(workflow.meta, 'node', nodeStep(node))} stroke-width="1.5"/>
          ${renderSemanticSigil(node.type, { x: node.x + 6, y: node.y + 6 })}${brand ? `\n          ${brand}` : ''}
          <text data-node-label=""${hasSub ? ' data-detail-anchor=""' : ''} x="${node.cx}" y="${node.y + 21}" class="t-primary" font-size="${labelFontSize}" font-weight="600" text-anchor="middle">${esc(node.label)}</text>${sub}${tag}${actions}${mediaCard}
        </g>`;
}

function renderEdgePath(edge, index) {
  const [cls, marker] = arrowClassMap[edge.variant || 'default'] || arrowClassMap.default;
  const routed = pathFor(edge);
  const strokeWidth = edge.width || (edge.variant === 'emphasis' ? 1.8 : 1.4);
  const stateMap = declaredEdgeStateMap();
  const authored = typeof edge.state === 'string' && stateMap.has(edge.state)
    ? ` data-edge-state="${esc(edge.state)}"`
    : '';
  const dashed = authored && stateMap.get(edge.state).dash === true ? ' stroke-dasharray="10 8"' : '';
  return `        <path ${focusEdgeAttrs(edge.from, edge.to, edge.label, index, edge.id)}${authored} data-composition-points="${routePointsValue(routed.points)}" d="${routed.d}" class="${cls}"${animateAttr(workflow.meta, 'edge', edgeSteps.get(edge))} stroke-width="${strokeWidth}"${dashed} marker-end="url(#${marker})"/>`;
}

// The viewer installs its own transparent relationship rails above the edge
// paths, so a linked edge needs its own rail in the later label layer to stay
// clickable. This emits nothing unless the edge actually authored a link.
function renderEdgeLinkHits() {
  const linked = workflow.edges.filter((edge) => Array.isArray(edge.links) && edge.links.length);
  if (!linked.length) return '';
  return linked.map((edge) => {
    const primary = edge.links[0];
    const routed = pathFor(edge);
    return `        <a href="${esc(primary.href)}" target="_blank" rel="noopener noreferrer" data-edge-link-target="${esc(primary.label)}" aria-label="${esc(primary.label)}"><path d="${routed.d}" fill="none" stroke="transparent" stroke-width="18" pointer-events="stroke" style="cursor:pointer"/></a>`;
  }).join('\n');
}

function renderEdgeLabel(edge, index) {
  if (!edge.label) return '';
  const routed = pathFor(edge);
  const [lx, ly] = workflowEdgeLabelPoint(edge, routed.points);
  const labelW = workflowLabelWidth(edge.label);
  // The line is the leg: what it costs sits as a caption under the mode, so the
  // chip keeps its width and the journey is still what the middle reads.
  const minutes = edge.id !== undefined && edge.id !== null ? edgeStepMinutes.get(edge.id) : undefined;
  const spoken = typeof minutes === 'number'
    ? i18nText(workflow.meta.locale, 'workflow.leg.spoken', { label: edge.label, value: minutes }, workflow.meta.labels)
    : edge.label;
  const captionText = edge.id !== undefined && edge.id !== null && edgeCaptionText.has(edge.id)
    ? edgeCaptionText.get(edge.id)
    : (typeof minutes === 'number'
      ? i18nText(workflow.meta.locale, 'workflow.leg.cost', { value: minutes }, workflow.meta.labels)
      : '');
  const caption = captionText
    ? `\n          <text x="${lx}" y="${ly - 3}" class="t-muted" font-size="7" text-anchor="middle">${esc(captionText)}</text>`
    : '';
  const chip = legStatesCost(edge)
    ? `\n          <text x="${lx}" y="${ly - 13}" class="${variantAccent(edge.variant, { dashed: 't-database' })}" font-size="8" text-anchor="middle">${esc(edge.label)}</text>${caption}`
    : `\n          <rect x="${lx - labelW / 2}" y="${ly - 10}" width="${labelW}" height="14" rx="3" class="c-mask"/>
          <text x="${lx}" y="${ly}" class="${variantAccent(edge.variant, { dashed: 't-database' })}" font-size="8" text-anchor="middle">${esc(edge.label)}</text>`;
  const primary = Array.isArray(edge.links) && edge.links.length ? edge.links[0] : null;
  const body = primary
    ? `\n          <a href="${esc(primary.href)}" target="_blank" rel="noopener noreferrer" data-edge-link="${esc(primary.label)}" aria-label="${esc(primary.label + ' ' + edge.from + ' ' + edge.to)}">${chip}</a>`
    : chip;
  const detail = legStatesCost(edge) ? `<title>${esc(spoken)}</title>` : '';
  return `        <g data-detail="context" ${focusEdgeAttrs(edge.from, edge.to, edge.label, index, edge.id)}>${detail}${body}
        </g>`;
}

function renderLegend() {
  const obstacles = workflow.schema_version === 2
    ? relationshipLegendObstacles(workflow.edges, {
        pointsFor: (edge) => pathFor(edge).points,
        labelRectFor,
      })
    : [];
  return renderResolvedLegend({
    entries: workflowLegendEntries,
    locale: workflow.meta.locale,
    layout: workflowLegendLayout(obstacles),
    renderSwatch: (entry) => `<rect x="${entry.x}" y="${entry.baseline - 8}" width="14" height="9" rx="2" class="${typeFill(workflow, entry.kind) || 'c-external'}" stroke-width="1"/>`,
  });
}

// Reader state is opaque to the renderer. A document declares which slots a
// reader may write, which view those slots drive, and which authored rule the
// reader's own clock replays from the moment they say they are somewhere. The
// artifact only keeps values; a document that declares none of it emits
// nothing.
function renderReaderRuntime() {
  const declaration = readerDeclaration();
  if (!declaration.active) return '';
  const labels = (workflow.meta && workflow.meta.labels) || {};
  const label = (key, fallback) => {
    const value = labels[key];
    return typeof value === 'string' && value.trim() !== '' ? value : fallback;
  };
  const config = {
    store: declaration.store,
    slots: declaration.slots.map(({ id, kind, label: slotLabel, cue, maxLength }) => ({ id, kind, label: slotLabel, cue, maxLength })),
    view: declaration.view,
    clock: declaration.clock ? { ...declaration.clock, data: readerClockBlob() } : null,
    states: declaredEdgeStates().map(({ id, color, label: stateLabel }) => ({ id, color, label: stateLabel || id })),
    lanes: declaration.needsLanes
      ? workflow.lanes.map((lane) => {
          const authored = lane.readerLabel || lane.label;
          return { id: lane.id, label: authored.split(' · ')[0], full: lane.label };
        })
      : [],
    labels: {
      all: label('reader.all', 'All'),
      solo: label('reader.solo', 'Read one lane alone'),
      stow: label('reader.stow', 'Stow visited'),
      restore: label('reader.restore', 'Show visited'),
      save: label('reader.save', 'Save a copy'),
      saveHint: label('reader.save.hint', 'the file with your moments and notes'),
      saved: label('reader.saved', 'Saved a copy with your notes'),
      noteAdd: label('reader.note.add', 'Write a line'),
      noteEdit: label('reader.note.edit', 'Edit the line'),
      noteSave: label('reader.note.save', 'Keep'),
      noteCancel: label('reader.note.cancel', 'Cancel'),
      notePlaceholder: label('reader.note.placeholder', 'One line about what actually happened'),
      anchor: label('reader.anchor', 'I am here'),
      clear: label('reader.clear', 'Back to plan'),
      at: label('reader.at', 'Arrived at'),
      dwell: label('reader.dwell', 'Reserve minutes'),
      status: label('reader.status', '{count} stops left · done about {time}'),
      over: label('reader.over', 'past the {time} ceiling'),
    },
  };
  const walkSource = walkClock.toString();
  return `
        <script>
(function () {
  var config = ${JSON.stringify(config).replace(/</g, '\\u003c')};
  // Replay the compiler-selected routes with the shared template formatter.
  var walkClock = ${walkSource};
  var renderClockTemplate = ${renderClockTemplate.toString()};
  var ns = 'http://www.w3.org/2000/svg';
  var STATE_ID = 'archify-reader-state';
  var STYLE_ID = 'archify-reader-style';
  var svg = null;
  var candidates = document.querySelectorAll('svg');
  for (var i = 0; i < candidates.length; i += 1) {
    if (candidates[i].querySelector('[data-node-id]')) { svg = candidates[i]; break; }
  }
  if (!svg) return;

  // Everything parsed before this script is source. Anything that shows up
  // later is runtime chrome, and a saved copy must not carry it.
  var sourceAttrs = {};
  var sourceCount = 0;
  Array.prototype.forEach.call(document.querySelectorAll('*'), function (element) {
    var map = {};
    Array.prototype.forEach.call(element.attributes, function (attr) { map[attr.name] = attr.value; });
    sourceCount += 1;
    sourceAttrs[String(sourceCount)] = map;
    element.setAttribute('data-reader-known', String(sourceCount));
  });

  var key = 'archify-reader:' + (document.title || location.pathname);
  var originalViewBox = svg.getAttribute('viewBox');
  // Ids come from the document, so the reader's own maps must not inherit
  // members for a node or slot named "constructor".
  var state = Object.create(null);
  var expanded = Object.create(null);
  var soloLane = null;
  var stowOn = true;
  var bridgeLayer = null;
  var soloButton = null;
  var summaryElement = null;
  var flashing = false;
  var editing = null;
  var renderedBlock = null;
  var sourceLabels = {};

  function readEnvelope(where) {
    try {
      var raw = where === 'baked'
        ? (document.getElementById(STATE_ID) || {}).textContent
        : localStorage.getItem(key);
      var parsed = raw ? JSON.parse(raw) : null;
      return parsed && typeof parsed === 'object' && parsed.data && typeof parsed.data === 'object' ? parsed : null;
    } catch (error) { return null; }
  }
  var baked = readEnvelope('baked');
  var draft = readEnvelope('draft');
  function loadState() {
    if (baked) state = baked.data;
    if (draft && (!baked || (Number(draft.updatedAt) || 0) > (Number(baked.savedAt) || 0))) state = draft.data;
  }
  loadState();

  function bucket(slotId, create) {
    if (!state[slotId] || typeof state[slotId] !== 'object') {
      if (!create) return null;
      state[slotId] = {};
    }
    return state[slotId];
  }
  function valueOf(slotId, target) {
    var values = bucket(slotId, false);
    return values ? values[target] : undefined;
  }
  function marked(slotId, target) {
    var value = valueOf(slotId, target);
    return value === true || (typeof value === 'string' && value !== '') || (typeof value === 'number' && Number.isFinite(value));
  }
  function setValue(slotId, target, value) {
    var values = bucket(slotId, true);
    if (value === true || (typeof value === 'string' && value !== '') || (typeof value === 'number' && Number.isFinite(value))) {
      values[target] = value;
    } else {
      delete values[target];
    }
    persist();
    apply();
  }
  function persist() {
    try {
      localStorage.setItem(key, JSON.stringify({ v: 1, updatedAt: Date.now(), data: state }));
    } catch (error) {}
  }
  function flag(element, name, on) {
    if (on) element.setAttribute(name, '');
    else element.removeAttribute(name);
  }
  function each(selector, handler) {
    Array.prototype.forEach.call(svg.querySelectorAll(selector), handler);
  }

  var clock = config.clock && config.clock.data ? config.clock : null;
  var declaredStates = config.states || [];
  function stateById(id) {
    for (var index = 0; index < declaredStates.length; index += 1) {
      if (declaredStates[index].id === id) return declaredStates[index];
    }
    return null;
  }
  var clockData = clock ? clock.data : null;
  var labelNodes = {};
  var sourceLabels = {};
  var laneTitles = [];

  function pad(number) { return (number < 10 ? '0' : '') + number; }
  function format(value) {
    return renderClockTemplate('{value}', value, clockData || {});
  }
  function nowMinutes() {
    var now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }
  function adjacency() {
    var out = {};
    var incoming = {};
    each('[data-edge-from][data-edge-to]', function (edge) {
      if (String(edge.tagName).toLowerCase() !== 'path') return;
      var from = edge.getAttribute('data-edge-from');
      var to = edge.getAttribute('data-edge-to');
      (out[from] || (out[from] = [])).push(to);
      (incoming[to] || (incoming[to] = [])).push(from);
    });
    return { out: out, incoming: incoming };
  }
  function laneOf(nodeId) {
    var node = svg.querySelector('[data-node-id="' + nodeId + '"]');
    return node ? node.getAttribute('data-node-lane') : null;
  }
  function firstKey(slotId) {
    var values = bucket(slotId, false);
    if (!values) return null;
    var ids = Object.keys(values);
    return ids.length ? ids[0] : null;
  }
  // "Everything behind me" is the prefix of the day's own walk, never "every
  // edge that happens to point here": a day that returns to its base is still a
  // line with a beginning, and walking backwards through the return would hide
  // the whole day.
  function behind(slotId) {
    var anchor = firstKey(slotId);
    var set = Object.create(null);
    if (!anchor) return set;
    var lane = laneOf(anchor);
    var seed = clockData && lane ? clockData.lanes[lane] : null;
    if (seed) {
      var forward = {};
      Object.keys(clockData.routes[lane]).forEach(function (key) {
        var parts = key.split(' ');
        forward[parts[0]] = parts[1];
      });
      var current = seed.start;
      var guard = 0;
      while (current && current !== anchor && guard < 64) {
        guard += 1;
        set[current] = true;
        current = forward[current];
      }
      if (current === anchor) return set;
      set = {};
    }
    var incoming = adjacency().incoming;
    var queue = [anchor];
    var guard = 0;
    while (queue.length && guard < 256) {
      guard += 1;
      var node = queue.shift();
      (incoming[node] || []).forEach(function (previous) {
        if (previous === anchor || set[previous]) return;
        if (laneOf(previous) !== lane) return;
        set[previous] = true;
        queue.push(previous);
      });
    }
    return set;
  }
  function viewSet(entries) {
    var sets = {};
    entries.forEach(function (entry) {
      if (entry.reach === 'before') sets[entry.slot] = behind(entry.slot);
    });
    return function (id) {
      for (var index = 0; index < entries.length; index += 1) {
        var entry = entries[index];
        if (entry.reach === 'before') {
          if (sets[entry.slot][id] === true) return true;
        } else if (marked(entry.slot, id)) {
          return true;
        }
      }
      return false;
    };
  }
  function dwellOf(nodeId, plan) {
    if (!plan && clock && clock.dwell) {
      var override = valueOf(clock.dwell, nodeId);
      if (typeof override === 'number' && Number.isFinite(override)) return override;
    }
    return clockData && typeof clockData.nodes[nodeId] === 'number' ? clockData.nodes[nodeId] : 0;
  }
  function outgoingMap() {
    var map = {};
    if (!clockData) return map;
    Object.keys(clockData.edges).forEach(function (key) {
      var parts = key.split(' ');
      map[parts[0]] = { to: parts[1], key: key, minutes: clockData.edges[key] };
    });
    return map;
  }
  function walk(laneId, options) {
    if (!clockData) return null;
    var plan = Boolean(options && options.plan);
    var overrides = {};
    if (!plan && clock && clock.dwell) {
      var values = bucket(clock.dwell, false);
      if (values) {
        Object.keys(values).forEach(function (id) {
          if (typeof values[id] === 'number') overrides[id] = values[id];
        });
      }
    }
    var anchor = options && options.anchor ? options.anchor : null;
    return walkClock({
      lanes: clockData.lanes,
      nodes: clockData.nodes,
      edges: clockData.routes[laneId],
      dwells: overrides,
      laneId: laneId,
      anchor: anchor,
      anchorLane: anchor ? laneOf(anchor) : null,
      anchorTime: options ? options.time : null
    });
  }
  function anchorNode() {
    return clock ? firstKey(clock.anchor) : null;
  }
  function anchorTime(nodeId) {
    if (!clock || !clock.at) return null;
    var value = valueOf(clock.at, nodeId);
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }
  function captureLabels() {
    each('[data-edge-from][data-edge-to]', function (group) {
      if (String(group.tagName).toLowerCase() === 'path') return;
      var labelKey = group.getAttribute('data-edge-from') + ' ' + group.getAttribute('data-edge-to');
      if (!clockData || !(labelKey in clockData.edges) || labelNodes[labelKey]) return;
      var text = group.querySelector('text');
      if (!text) return;
      var lines = group.querySelectorAll('text');
      var path = null;
      each('[data-edge-from][data-edge-to]', function (candidate) {
        if (String(candidate.tagName).toLowerCase() !== 'path') return;
        if (candidate.getAttribute('data-edge-from') + ' ' + candidate.getAttribute('data-edge-to') === labelKey) path = candidate;
      });
      labelNodes[labelKey] = {
        text: text,
        path: path,
        caption: lines.length > 1 ? lines[1] : null,
        textX: Number(text.getAttribute('x')) || 0,
        sourceText: text.textContent,
        sourceCaption: lines.length > 1 ? lines[1].textContent : null
      };
    });
  }
  function captureLaneTitles() {
    Array.prototype.forEach.call(svg.querySelectorAll('[data-lane-label]'), function (element) {
      laneTitles.push({ id: element.getAttribute('data-lane-label'), element: element, source: element.textContent });
    });
  }
  function setLaneTitle(entry, value) {
    var prefix = String(entry.source).split(' / ')[0];
    var next = prefix + ' / ' + clockData.laneLabels[entry.id] + ' ' + renderClockTemplate(clockData.laneFormat, value, clockData);
    if (entry.element.textContent !== next) entry.element.textContent = next;
  }
  function setEdgeLabel(labelKey, entry, value) {
    // The browser renders with the rule's own template, and never widens the
    // label: a longer line wraps onto the caption instead of pushing sideways.
    var prefix = clockData.edgeFormat ? renderClockTemplate(clockData.edgeFormat, value, clockData) : '';
    var first = prefix + (clockData.edgeLabels[labelKey] || '');
    if (entry.text.textContent !== first) entry.text.textContent = first;
    var over = clockData.limit !== null && value > clockData.limit;
    flag(entry.text, 'data-reader-over', over);
    if (entry.path) flag(entry.path, 'data-reader-over', over);
    // The declared state rides on the line; the pack chose its colour and words.
    var state = over && stateById('over') ? 'over' : null;
    if (entry.state !== state) {
      entry.state = state;
      [entry.text, entry.path].forEach(function (element) {
        if (!element) return;
        if (state) element.setAttribute('data-edge-derived', state);
        else element.removeAttribute('data-edge-derived');
      });
    }
    if (!entry.caption) return;
    var minutes = clockData.edges[labelKey];
    var caption = renderClockTemplate(clockData.captionFormat, value, {
      clock: clockData.clock, wrap: clockData.wrap, bands: clockData.bands, minutes: minutes
    }).trim();
    if (entry.caption.textContent !== caption) entry.caption.textContent = caption;
  }
  // The reader's clock: walk every lane from its authored base, or from the
  // stop the reader says they are at, and show what the plan said beside a
  // moved time.
  function renderClock() {
    if (!clockData) return;
    var anchor = anchorNode();
    var time = anchor ? anchorTime(anchor) : null;
    var anchored = anchor && time !== null ? { anchor: anchor, time: time } : null;
    var summary = null;
    Object.keys(clockData.lanes).forEach(function (laneId) {
      var result = walk(laneId, anchored);
      if (!result) return;
      var seed = clockData.lanes[laneId];
      var anchoredHere = anchored && laneOf(anchored.anchor) === laneId;
      if (clockData.laneFormat && clockData.laneLabels[laneId]) {
        laneTitles.forEach(function (entry) {
          if (entry.id !== laneId) return;
          var start = anchoredHere ? anchored.time : seed.base;
          setLaneTitle(entry, start);
        });
      }
      var legs = 0;
      result.rows.forEach(function (row) {
        if (!row.key) return;
        legs += 1;
        var entry = labelNodes[row.key];
        if (entry) setEdgeLabel(row.key, entry, row.value);
      });
      if (anchored && laneOf(anchored.anchor) === laneId) {
        summary = { remaining: legs, end: result.end, over: clockData.limit !== null && result.end > clockData.limit };
      }
    });
    if (summaryElement && !flashing) {
      summaryElement.textContent = summary
        ? config.labels.status.replace('{count}', String(summary.remaining)).replace('{time}', format(summary.end))
          + (summary.over ? ' · ' + config.labels.over.replace('{time}', format(clockData.limit)) : '')
        : '';
    }
  }

  function apply() {
    var hidden = Object.create(null);
    var visible = [];
    var isDimmed = viewSet(config.view.dim);
    var isStowed = viewSet(config.view.stow);
    each('[data-node-id]', function (node) {
      var id = node.getAttribute('data-node-id');
      var lane = node.getAttribute('data-node-lane');
      var dim = isDimmed(id);
      var stowed = stowOn && isStowed(id);
      var offLane = soloLane !== null && lane !== soloLane;
      var isHidden = stowed || offLane;
      hidden[id] = isHidden;
      flag(node, 'data-reader-dim', dim);
      flag(node, 'data-reader-hidden', isHidden);
      if (!isHidden) visible.push(node);
    });
    each('[data-lane-id]', function (frame) {
      flag(frame, 'data-reader-hidden', soloLane !== null && frame.getAttribute('data-lane-id') !== soloLane);
    });
    each('[data-lane-label]', function (label) {
      flag(label, 'data-reader-hidden', soloLane !== null && label.getAttribute('data-lane-label') !== soloLane);
    });
    var hiddenPaths = {};
    each('[data-edge-from][data-edge-to]', function (edge) {
      var off = hidden[edge.getAttribute('data-edge-from')] === true
        || hidden[edge.getAttribute('data-edge-to')] === true;
      flag(edge, 'data-reader-hidden', off);
      if (off && String(edge.tagName).toLowerCase() === 'path') {
        hiddenPaths[edge.getAttribute('d')] = true;
      }
    });
    each('[data-edge-link-target]', function (anchor) {
      var shape = anchor.querySelector('path');
      flag(anchor, 'data-reader-hidden', Boolean(shape) && hiddenPaths[shape.getAttribute('d')] === true);
    });
    each('[data-relationship-from]', function (target) {
      flag(target, 'data-reader-hidden',
        hidden[target.getAttribute('data-relationship-from')] === true
        || hidden[target.getAttribute('data-relationship-to')] === true);
    });
    paintBridges(hidden, visible);
    renderClock();
    syncChrome();
  }

  // A stowed run keeps its place in the chain: the visible neighbours are
  // joined by a dashed span that reports how many stops it hides, and the span
  // itself puts them back.
  function paintBridges(hidden, visible) {
    if (!bridgeLayer) return;
    while (bridgeLayer.firstChild) bridgeLayer.removeChild(bridgeLayer.firstChild);
    if (!stowOn) return;
    var adjacencyMap = adjacency().out;
    var drawn = {};
    function drawBridge(fromNode, toNode, skipped) {
      var key = fromNode.getAttribute('data-node-id') + ' ' + toNode.getAttribute('data-node-id');
      if (drawn[key]) return;
      drawn[key] = true;
      var from = boxOf(fromNode);
      var to = boxOf(toNode);
      if (!from || !to) return;
      var x1 = from.x + from.width;
      var y1 = from.y + from.height / 2;
      var x2 = to.x - 4;
      var y2 = to.y + to.height / 2;
      var sameRow = Math.abs(y1 - y2) < 2;
      var middle = x2 > x1 + 24 ? (x1 + x2) / 2 : x1 + 12;
      var d = sameRow
        ? 'M ' + x1 + ' ' + y1 + ' H ' + x2
        : 'M ' + x1 + ' ' + y1 + ' H ' + middle + ' V ' + y2 + ' H ' + x2;
      var chipX = sameRow ? (x1 + x2) / 2 : middle;
      var chipY = sameRow ? y1 : y2;
      var group = document.createElementNS(ns, 'g');
      group.setAttribute('class', 'reader-bridge');
      group.setAttribute('data-reader-bridge', skipped.join(','));
      group.setAttribute('role', 'button');
      group.setAttribute('tabindex', '0');
      group.setAttribute('aria-label', config.labels.restore + ' ' + skipped.length);
      var path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      group.appendChild(path);
      var hit = document.createElementNS(ns, 'rect');
      hit.setAttribute('x', (chipX - 12).toFixed(1));
      hit.setAttribute('y', (chipY - 12).toFixed(1));
      hit.setAttribute('width', '24');
      hit.setAttribute('height', '16');
      hit.setAttribute('rx', '4');
      hit.setAttribute('class', 'reader-bridge-hit');
      group.appendChild(hit);
      var count = document.createElementNS(ns, 'text');
      count.setAttribute('x', chipX.toFixed(1));
      count.setAttribute('y', (chipY - 1).toFixed(1));
      count.setAttribute('text-anchor', 'middle');
      count.setAttribute('class', 'reader-bridge-count');
      count.textContent = '+' + skipped.length;
      group.appendChild(count);
      bridgeLayer.appendChild(group);
    }
    visible.forEach(function (node) {
      var cursor = node.getAttribute('data-node-id');
      var skipped = [];
      for (var step = 0; step < 24; step += 1) {
        var next = adjacencyMap[cursor];
        if (!next || next.length !== 1) return;
        cursor = next[0];
        var target = svg.querySelector('[data-node-id="' + cursor + '"]');
        if (!target || hidden[cursor] !== true) {
          if (target && skipped.length) drawBridge(node, target, skipped);
          return;
        }
        skipped.push(cursor);
      }
    });
  }
  function boxOf(node) {
    var rect = node.querySelector('rect');
    if (!rect) return null;
    return {
      x: Number(rect.getAttribute('x')) || 0,
      y: Number(rect.getAttribute('y')) || 0,
      width: Number(rect.getAttribute('width')) || 0,
      height: Number(rect.getAttribute('height')) || 0
    };
  }
  function expandBridge(bridge) {
    (bridge.getAttribute('data-reader-bridge') || '').split(',').forEach(function (id) {
      if (id) expanded[id] = true;
    });
    apply();
  }
  // Reading one lane alone gives the canvas to that lane: the others leave,
  // and the canvas itself shrinks to the one that remains. The viewer reads
  // the SVG viewBox live, so its camera follows the swap.
  function setSolo(lane) {
    soloLane = lane;
    expanded = {};
    apply();
    frameLane(lane);
  }
  function frameLane(lane) {
    var band = lane === null
      ? null
      : svg.querySelector('[data-lane-id="' + lane + '"][data-composition-frame-kind="lane"]');
    if (band) {
      var pad = 16;
      var x = Number(band.getAttribute('x')) || 0;
      var y = Number(band.getAttribute('y')) || 0;
      var width = Number(band.getAttribute('width')) || 0;
      var height = Number(band.getAttribute('height')) || 0;
      svg.setAttribute('viewBox', [x - pad, y - pad, width + pad * 2, height + pad * 2].join(' '));
      svg.style.height = 'auto';
    } else {
      svg.setAttribute('viewBox', originalViewBox);
      svg.style.removeProperty('height');
    }
    var view = window.Archify && window.Archify.view;
    if (view && typeof view.reset === 'function') view.reset({ automatic: true });
  }

  function chromeButton(text, handler, className) {
    var element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = text;
    element.addEventListener('click', handler);
    return element;
  }
  // Where a control lives is part of the design: the day control joins the day
  // list the viewer already draws, saving joins the exports, and nothing new
  // floats above the diagram.
  function activeLane() {
    var lanes = {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-focus-selected][data-node-lane]'), function (node) {
      lanes[node.getAttribute('data-node-lane')] = true;
    });
    var ids = Object.keys(lanes);
    if (ids.length === 1) return ids[0];
    if (soloLane) return soloLane;
    var anchor = anchorNode();
    return anchor ? laneOf(anchor) : null;
  }
  function syncChrome() {
    if (!soloButton) return;
    var soloed = soloLane !== null;
    soloButton.textContent = soloed ? config.labels.all : config.labels.solo;
    soloButton.disabled = !soloed && !activeLane();
    soloButton.setAttribute('aria-pressed', String(soloed));
    soloButton.title = soloed ? config.labels.all : config.labels.solo;
  }
  function flash(message) {
    if (!summaryElement) return;
    flashing = true;
    summaryElement.textContent = message;
    window.setTimeout(function () {
      flashing = false;
      renderClock();
    }, 4000);
  }
  function buildChrome() {
    // An embedded diagram is a figure inside another page: it gets no chrome.
    if (document.documentElement.getAttribute('data-embed') === 'true') return;
    var actions = document.querySelector('.guided-view-actions');
    if (config.view.solo && actions) {
      soloButton = chromeButton(config.labels.solo, function () {
        setSolo(soloLane === null ? activeLane() : null);
        syncChrome();
      }, 'guided-view-all');
      soloButton.setAttribute('data-reader-solo-toggle', '');
      actions.appendChild(soloButton);
    }
    if (config.clock && actions) {
      summaryElement = document.createElement('span');
      summaryElement.className = 'guided-view-reader-summary';
      summaryElement.setAttribute('aria-live', 'polite');
      actions.appendChild(summaryElement);
    }
    if (config.store) {
      var menu = document.getElementById('export-menu');
      if (menu) {
        var section = document.createElement('div');
        section.className = 'export-menu-section';
        section.setAttribute('role', 'group');
        section.setAttribute('aria-label', config.labels.save);
        var heading = document.createElement('span');
        heading.className = 'export-menu-heading';
        heading.setAttribute('aria-hidden', 'true');
        heading.textContent = config.labels.save;
        var item = document.createElement('button');
        item.type = 'button';
        item.setAttribute('role', 'menuitem');
        item.setAttribute('tabindex', '-1');
        item.setAttribute('data-reader-action', 'save');
        var copy = document.createElement('span');
        copy.className = 'export-item-copy';
        var strong = document.createElement('strong');
        strong.textContent = config.labels.save;
        var hint = document.createElement('small');
        hint.className = 'hint';
        hint.textContent = config.labels.saveHint;
        copy.appendChild(strong);
        copy.appendChild(hint);
        item.appendChild(copy);
        item.addEventListener('click', function () { saveCopy(); });
        section.appendChild(heading);
        section.appendChild(item);
        menu.appendChild(section);
      }
    }
    syncChrome();
  }
  // Reader state lives in the passport the viewer already opens on a click:
  // one row per declared slot, so a stop keeps a single detail surface.
  function blockHost() {
    var chip = document.getElementById('focus-chip');
    if (!chip) return null;
    var copy = chip.querySelector('.relationship-lens-copy') || chip;
    var host = chip.querySelector('[data-reader-block]');
    if (!host) {
      host = document.createElement('div');
      host.className = 'semantic-passport-reader';
      host.setAttribute('data-reader-block', '');
      copy.appendChild(host);
    }
    return host;
  }
  function selectedTarget() {
    var active = window.Archify && Archify.focus && typeof Archify.focus.active === 'function'
      ? Archify.focus.active()
      : null;
    if (typeof active === 'string') return active;
    if (Object.prototype.toString.call(active) === '[object Array]' && active.length === 1) return active[0];
    return null;
  }
  function blockSignature() {
    var target = selectedTarget();
    return String(target) + '|' + config.slots.map(function (slot) {
      var value = target ? valueOf(slot.id, target) : undefined;
      return slot.id + '=' + (value === undefined ? '' : String(value));
    }).join('&') + '|' + String(anchorNode()) + '|' + String(anchorNode() ? anchorTime(anchorNode()) : '');
  }
  function minutesToClock(minutes) {
    var shown = ((minutes % 1440) + 1440) % 1440;
    return pad(Math.floor(shown / 60)) + ':' + pad(shown % 60);
  }
  function clockToMinutes(text) {
    var parts = String(text || '').split(':');
    if (parts.length !== 2) return null;
    var hours = Number(parts[0]);
    var minutes = Number(parts[1]);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
    return hours * 60 + minutes;
  }
  // A press is not "done": it says "I am still here, count from now", and it
  // can be pressed again whenever the estimate turns out wrong.
  function anchorHere(target) {
    if (!clock) return;
    var values = bucket(clock.anchor, true);
    Object.keys(values).forEach(function (id) { delete values[id]; });
    values[target] = true;
    if (clock.at) bucket(clock.at, true)[target] = nowMinutes();
    persist();
    renderedBlock = null;
    apply();
    renderBlock();
  }
  function clearAnchor() {
    if (!clock) return;
    var values = bucket(clock.anchor, true);
    Object.keys(values).forEach(function (id) { delete values[id]; });
    var times = bucket(clock.at, true);
    Object.keys(times).forEach(function (id) { delete times[id]; });
    persist();
    renderedBlock = null;
    apply();
    renderBlock();
  }
  function fieldRow(slot, target, kind) {
    var row = document.createElement('div');
    row.className = 'reader-slot-row';
    var label = document.createElement('span');
    label.className = 'reader-slot-label';
    label.textContent = slot.label;
    var input = document.createElement('input');
    input.className = 'reader-slot-input';
    if (kind === 'time') {
      input.type = 'time';
      var at = anchorTime(target);
      input.value = minutesToClock(typeof at === 'number' ? at : nowMinutes());
      input.addEventListener('change', function () {
        var minutes = clockToMinutes(input.value);
        if (minutes === null) return;
        setValue(slot.id, target, minutes);
        renderedBlock = null;
        renderBlock();
      });
    } else {
      input.type = 'number';
      input.min = '0';
      input.step = '5';
      input.value = String(Math.round(dwellOf(target, false)));
      input.addEventListener('change', function () {
        var minutes = Number(input.value);
        if (!Number.isFinite(minutes) || minutes < 0) return;
        var plan = dwellOf(target, true);
        setValue(slot.id, target, Math.abs(minutes - plan) < 0.001 ? null : minutes);
      });
    }
    row.appendChild(label);
    row.appendChild(input);
    return row;
  }
  function renderBlock() {
    var host = blockHost();
    if (!host) return;
    if (editing) return;
    var signature = blockSignature();
    if (signature === renderedBlock) return;
    renderedBlock = signature;
    while (host.firstChild) host.removeChild(host.firstChild);
    var target = selectedTarget();
    if (!target || !config.slots.length) return;
    config.slots.forEach(function (slot) {
      var value = valueOf(slot.id, target);
      if (slot.kind === 'text') {
        var row = document.createElement('div');
        row.className = 'reader-slot-row';
        var field = document.createElement('span');
        field.className = 'reader-slot-label';
        field.textContent = slot.label;
        row.appendChild(field);
        var control = document.createElement('button');
        control.type = 'button';
        control.className = 'reader-slot-control';
        var text = typeof value === 'string' ? value : '';
        control.textContent = text ? config.labels.noteEdit : config.labels.noteAdd;
        control.addEventListener('click', function () { openEditor(host, row, slot, target, text); });
        row.appendChild(control);
        if (text) {
          var note = document.createElement('p');
          note.className = 'reader-slot-note';
          note.textContent = text;
          row.appendChild(note);
        }
        host.appendChild(row);
        return;
      }
      if (slot.kind === 'time') {
        if (clock && clock.at === slot.id && anchorNode() === target) host.appendChild(fieldRow(slot, target, 'time'));
        return;
      }
      if (slot.kind === 'minutes') {
        host.appendChild(fieldRow(slot, target, 'minutes'));
        return;
      }
      var control = document.createElement('button');
      control.type = 'button';
      control.className = 'reader-slot-control';
      if (slot.kind === 'point') {
        var here = anchorNode() === target;
        control.textContent = slot.label;
        control.setAttribute('aria-pressed', String(here));
        control.addEventListener('click', function () { anchorHere(target); });
        var reset = document.createElement('button');
        reset.type = 'button';
        reset.className = 'reader-slot-control';
        reset.textContent = config.labels.clear;
        reset.addEventListener('click', function () { clearAnchor(); });
        var pair = document.createElement('div');
        pair.className = 'reader-slot-row';
        pair.setAttribute('data-reader-actions', '');
        pair.appendChild(control);
        if (here) pair.appendChild(reset);
        host.appendChild(pair);
        return;
      }
      {
        var on = value === true;
        control.textContent = slot.label;
        control.setAttribute('aria-pressed', String(on));
        control.addEventListener('click', function () { setValue(slot.id, target, on ? null : true); });
      }
      var line = document.createElement('div');
      line.className = 'reader-slot-row';
      line.appendChild(control);
      host.appendChild(line);
    });
  }
  function openEditor(host, row, slot, target, existing) {
    editing = slot.id;
    while (host.firstChild) host.removeChild(host.firstChild);
    var input = document.createElement('textarea');
    input.className = 'reader-slot-input reader-slot-textarea';
    input.maxLength = slot.maxLength;
    input.placeholder = config.labels.notePlaceholder;
    input.value = existing || '';
    var actions = document.createElement('div');
    actions.className = 'reader-slot-actions';
    var keep = document.createElement('button');
    keep.type = 'button';
    keep.textContent = config.labels.noteSave;
    keep.addEventListener('click', function () {
      var text = input.value.trim();
      editing = null;
      setValue(slot.id, target, text ? text : null);
      renderedBlock = null;
      renderBlock();
    });
    var cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = config.labels.noteCancel;
    cancel.addEventListener('click', function () {
      editing = null;
      renderedBlock = null;
      renderBlock();
    });
    actions.appendChild(keep);
    actions.appendChild(cancel);
    row.appendChild(input);
    row.appendChild(actions);
    host.appendChild(row);
    row.addEventListener('keydown', function (event) {
      event.stopPropagation();
      if (event.key === 'Escape') {
        editing = null;
        renderedBlock = null;
        renderBlock();
      }
    });
    input.focus();
  }
  function watchPassport() {
    var chip = document.getElementById('focus-chip');
    if (!chip) return;
    var scheduled = false;
    function schedule() {
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(function () {
        scheduled = false;
        renderBlock();
        syncChrome();
      }, 0);
    }
    var observer = new MutationObserver(schedule);
    observer.observe(chip, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    observer.observe(svg, { subtree: true, attributes: true, attributeFilter: ['data-focus-selected'] });
    window.addEventListener('hashchange', schedule);
    renderBlock();
  }

  function restoreAttrs(element, map) {
    if (!element || !map) return;
    Array.prototype.slice.call(element.attributes).forEach(function (attr) {
      element.removeAttribute(attr.name);
    });
    Object.keys(map).forEach(function (name) { element.setAttribute(name, map[name]); });
  }
  function targetName() {
    var name = location.pathname.split('/').pop() || 'diagram.html';
    var dot = name.toLowerCase().lastIndexOf('.html');
    if (dot > 0) name = name.slice(0, dot);
    return name + '.notes.html';
  }
  function snapshot(envelope) {
    var clone = document.documentElement.cloneNode(true);
    // querySelectorAll never returns the root, so the <html> element's own
    // source attributes are restored by hand.
    var rootIndex = clone.getAttribute('data-reader-known');
    var stale = [];
    Array.prototype.forEach.call(clone.querySelectorAll('*'), function (element) {
      var index = element.getAttribute('data-reader-known');
      if (!index) { stale.push(element); return; }
      restoreAttrs(element, sourceAttrs[index]);
    });
    if (rootIndex) restoreAttrs(clone, sourceAttrs[rootIndex]);
    stale.forEach(function (element) {
      // The parser reaches the viewer's own scripts after this runtime runs, so
      // they carry no marker either. A script belongs to the source wherever it
      // sits; everything else without a marker was built at runtime.
      if (element.tagName === 'SCRIPT') return;
      if (element.parentNode) element.parentNode.removeChild(element);
    });
    // A saved copy carries the authored plan; the reader's moment travels in
    // the state block and is replayed when the copy opens.
    Array.prototype.forEach.call(clone.querySelectorAll('[data-edge-from][data-edge-to]'), function (group) {
      if (String(group.tagName).toLowerCase() === 'path') return;
      var source = sourceLabels[group.getAttribute('data-edge-from') + ' ' + group.getAttribute('data-edge-to')];
      if (!source) return;
      var lines = group.querySelectorAll('text');
      if (lines.length > 0 && source.text !== undefined) lines[0].textContent = source.text;
      if (lines.length > 1 && source.caption !== undefined && source.caption !== null) lines[1].textContent = source.caption;
    });
    Array.prototype.forEach.call(clone.querySelectorAll('[data-lane-label]'), function (element) {
      var entry = laneTitles.filter(function (candidate) {
        return candidate.id === element.getAttribute('data-lane-label');
      })[0];
      if (entry) element.textContent = entry.source;
    });
    var block = clone.querySelector('script#' + STATE_ID);
    if (!block) {
      block = document.createElement('script');
      block.setAttribute('type', 'application/json');
      block.id = STATE_ID;
      clone.querySelector('body').appendChild(block);
    }
    block.textContent = JSON.stringify(envelope).replace(/</g, '\\u003c');
    return '<!DOCTYPE html>' + clone.outerHTML;
  }
  function saveCopy() {
    var envelope = { v: 1, savedAt: Date.now(), data: state };
    var blob = new Blob([snapshot(envelope)], { type: 'text/html;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = targetName();
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    flash(config.labels.saved);
  }

  // Web Animations outrank even important declarations, and the viewer starts
  // them from its own click handler, so a mark cancels again after the event
  // and whenever the reader points at a marked node.
  function stopAnimations(node) {
    if (typeof node.getAnimations !== 'function') return;
    var cancel = function () {
      node.getAnimations().forEach(function (animation) { animation.cancel(); });
    };
    cancel();
    window.setTimeout(cancel, 0);
    window.setTimeout(cancel, 160);
  }
  ['pointerover', 'focusin'].forEach(function (type) {
    document.addEventListener(type, function (event) {
      var markedNode = event.target.closest && event.target.closest('[data-node-id][data-reader-dim]');
      if (markedNode) stopAnimations(markedNode);
    }, true);
  });

  // At zoom the diagram pans on pointerdown, which would swallow an authored
  // link's click; a link stops that one event before the pan can start.
  svg.addEventListener('pointerdown', function (event) {
    var link = event.target.closest && event.target.closest('a[data-edge-link-target], a[data-edge-link]');
    if (link) event.stopPropagation();
  }, true);

  bridgeLayer = document.createElementNS(ns, 'g');
  bridgeLayer.setAttribute('class', 'reader-bridges');
  bridgeLayer.setAttribute('data-reader-bridges', '');
  var firstNode = svg.querySelector('[data-node-id]');
  var nodeLayer = firstNode;
  while (nodeLayer && nodeLayer.parentNode && nodeLayer.parentNode !== svg) nodeLayer = nodeLayer.parentNode;
  if (nodeLayer && nodeLayer.parentNode === svg) svg.insertBefore(bridgeLayer, nodeLayer);
  else svg.appendChild(bridgeLayer);
  bridgeLayer.addEventListener('click', function (event) {
    var bridge = event.target.closest && event.target.closest('[data-reader-bridge]');
    if (!bridge) return;
    event.preventDefault();
    event.stopPropagation();
    expandBridge(bridge);
  });
  bridgeLayer.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    var bridge = event.target.closest && event.target.closest('[data-reader-bridge]');
    if (!bridge) return;
    event.preventDefault();
    event.stopPropagation();
    expandBridge(bridge);
  });

  var style = document.createElement('style');
  style.id = STYLE_ID;
  // The viewer writes inline opacity for focus states, so the reader marks
  // have to win explicitly; a running CSS animation outranks an important
  // declaration, and nodes carry the authored trace animation, so a mark
  // stops that too. A stowed or off-lane node leaves the canvas outright.
  style.textContent = '[data-reader-dim]{opacity:.34!important;animation:none!important}'
    + '[data-reader-dim] text[data-node-label]{text-decoration:line-through}'
    + '[data-reader-hidden]{display:none!important}'
    + '.reader-bridge{cursor:pointer;outline:none}'
    + '.reader-bridge path{fill:none;stroke:var(--text-muted,#94a3b8);stroke-width:1.1;stroke-dasharray:3 3}'
    + '.reader-bridge-hit{fill:transparent}'
    + '.reader-bridge-count{fill:var(--text-muted,#94a3b8);font-size:8px;font-weight:600}'
    + '.reader-bridge:hover path,.reader-bridge:focus-visible path{stroke:#34d399;stroke-dasharray:none}'
    + '.guided-view-reader-summary{font-size:.72rem;opacity:.85;white-space:nowrap;padding:0 6px}'
    + '.semantic-passport-reader{margin-top:12px;padding-top:10px;border-top:1px solid rgba(148,163,184,.22);display:grid;grid-template-columns:3.5rem 1fr;gap:7px 10px;align-items:center}'
    + '.reader-slot-row{display:contents}'
    + '.reader-slot-row[data-reader-actions]{grid-column:1 / -1;display:flex;gap:6px}'
    + '.reader-slot-label{font-size:.72rem;line-height:1.2;opacity:.7;text-align:right;justify-self:end}'
    + '.reader-slot-control{justify-self:start;font-size:.78rem;line-height:1.3;padding:3px 10px}'
    + '.reader-slot-control[aria-pressed="true"]{color:#34d399}'
    + '.reader-slot-note{grid-column:1 / -1;margin:0;font-size:.75rem;line-height:1.5;color:#94a3b8;overflow-wrap:anywhere}'
    + '.reader-slot-input{justify-self:start;font-size:.78rem;padding:3px 6px;background:rgba(148,163,184,.12);border:1px solid rgba(148,163,184,.35);border-radius:6px;color:inherit;font:inherit;padding:4px 6px}'
    + '.reader-slot-input:focus{outline:none;border-color:#34d399}'
    + '.reader-slot-input[type="time"]{width:6.4rem}'
    + '.reader-slot-input[type="number"]{width:4.2rem}'
    + '.reader-slot-textarea{grid-column:1 / -1;width:100%;min-height:3.2rem;resize:vertical}'
    + '.reader-slot-actions{grid-column:1 / -1;display:flex;justify-content:flex-end;gap:6px}'
    + '@media print{.semantic-passport-reader{display:none}}';
  document.head.appendChild(style);

  captureLabels();
  captureLaneTitles();
  buildChrome();
  apply();
  watchPassport();
  function settle() {
    // A saved copy keeps its state block after this script in the file, so the
    // block may not exist yet while parsing: read it once the document is done.
    if (!baked) {
      baked = readEnvelope('baked');
      if (baked) loadState();
    }
    apply();
    renderBlock();
  }
  if (document.readyState === 'complete') window.setTimeout(settle, 0);
  else window.addEventListener('load', function () { window.setTimeout(settle, 0); });
  window.setTimeout(settle, 400);
})();
        </script>`;
}

function suppressedAttr() {
  const suppress = readerDeclaration().suppress;
  return suppress.length ? ` data-suppressed="${esc(suppress.join(' '))}"` : '';
}

function declaredEdgeStates() {
  return asArray(workflow.meta && workflow.meta.edgeStates).filter((state) => state && typeof state.id === 'string');
}

// A line state is the pack's: it names the colour slot and the words. The core
// only knows which condition it can report (today: a day past its ceiling).
// The paint belongs to the authored line alone. Viewer chrome clones edge
// geometry into its own overlays (hit rails, focus rails, flow pulses), and a
// clone keeps whatever attributes it was not told to drop while its class is
// replaced, so every selector names the arrow class the line was drawn with:
// a state paints the line and its words, never a copy of them. Stroke only —
// a leg is a line, and filling one would paint the channel it routes through.
function renderEdgeStateStyles() {
  const states = declaredEdgeStates();
  if (!states.length) return '';
  const lineClasses = Object.keys(arrowClassMap).map((variant) => arrowClassMap[variant][0]);
  const emitted = [];
  for (const state of states) {
    const slot = PALETTE_STROKE_VAR[state.color] || 'external';
    for (const attribute of ['data-edge-state', 'data-edge-derived']) {
      const key = `[${attribute}="${esc(state.id)}"]`;
      const line = lineClasses.map((cls) => `svg path.${cls}${key}`).join(",\n          ");
      emitted.push(`          ${line} { stroke: var(--${slot}-stroke) !important; }`);
      // Authored words keep their own accent; only a state the reader's replay
      // derived paints the leg's words as well, so a moved leg reads as moved.
      if (attribute === 'data-edge-derived') {
        emitted.push(`          svg text${key} { fill: var(--${slot}-stroke) !important; }`);
      }
      if (state.dash === true) {
        emitted.push(`          ${line} { stroke-dasharray: 10 8 !important; }`);
      }
    }
  }
  return `
        <style>
${emitted.join('\n')}
        </style>`;
}

function declaredEdgeStateMap() {
  return new Map(declaredEdgeStates().map((state) => [state.id, state]));
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(workflow.meta, resolvedQualityProfile)}${suppressedAttr()}>
${svgAccessibleText(workflow.meta, 'workflow')}${renderLinkStyles()}${renderEdgeStateStyles()}
${renderDefinitions()}${renderMediaClip()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Swimlanes -->
${workflow.lanes.map(renderLane).join('\n\n')}

        <!-- Phase headers -->
${asArray(workflow.phases).map(renderPhase).join('\n')}

        <!-- Workflow groups -->
${asArray(workflow.groups).map(renderGroup).join('\n')}

        <!-- Edge paths -->
${workflow.edges.map(renderEdgePath).join('\n')}

        <!-- Nodes -->
${[...nodes.values()].map(renderNode).join('\n\n')}

        <!-- Edge labels -->
${workflow.edges.map(renderEdgeLabel).join('\n')}${renderEdgeLinkHits()}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}


  try {
    validateReadableInputsBeforeRouting();
    validateReadablePinnedGeometry();
    validateWorkflow();
    finalizeReadableViewBox();
    renderProblems.length = 0;
    const svg = renderSvg();
    if (renderProblems.length) {
      return compilerFailure(layout.contract, renderProblems.map((problem) => ({ ...problem })));
    }
    const receipt = {
      contract: layout.contract,
      viewBox: [...viewBox],
      requiredViewBox: [...requiredViewBox],
      columns: [...layout.colXs],
      nodes: [...nodes.values()].map((node) => ({
        id: node.id,
        lane: node.lane,
        col: node.col,
        x: node.x,
        y: node.y,
        width: node.width,
        height: node.height,
      })),
      edges: workflow.edges.map((edge) => ({
        id: edge.id ?? null,
        from: edge.from,
        to: edge.to,
        points: pathFor(edge).points.map((point) => [...point]),
      })),
      labels: workflow.edges.flatMap((edge) => {
        if (!edge.label || !nodes.has(edge.from) || !nodes.has(edge.to)) return [];
        const [x, y] = workflowEdgeLabelPoint(edge, pathFor(edge).points);
        return [{ edge: edge.id ?? null, label: edge.label, x, y, width: workflowLabelWidth(edge.label), height: edgeLabelHeight(edge) }];
      }),
      diagnostics: [],
    };
    const suppressed = readerDeclaration().suppress;
    if (suppressed.length) receipt.suppressed = [...suppressed];
    return { ok: true, svg, receipt, runtime: renderReaderRuntime() };
  } catch (error) {
    if (!Array.isArray(error?.archifyDiagnostics)) throw error;
    const diagnostics = error.archifyDiagnostics.map((diagnostic) => ({ ...diagnostic }));
    return compilerFailure(layout.contract, diagnostics, error.message);
  }
}

function feedbackFailure(request) {
  const message = `Workflow edge "${request.edge || `${request.from}->${request.to}`}" exhausted bounded readable-v2 layout feedback without a feasible automatic route.`;
  const diagnostics = [{
    code: 'workflow/solver-budget-exhausted',
    severity: 'error',
    message,
    subject: {
      diagramType: 'workflow',
      edge: request.edge,
      from: request.from,
      to: request.to,
    },
    evidence: {
      attemptedCandidateFamilies: request.attemptedCandidateFamilies,
      candidateCount: request.candidateCount,
    },
    supportedFixes: [],
  }];
  return compilerFailure('readable-v2', diagnostics, message);
}

function compileWorkflowWithFeedback({ workflow, qualityProfile, discoverFixes = true } = {}) {
  let layoutFeedback = {};
  for (let attempt = 0; attempt <= MAX_READABLE_LAYOUT_FEEDBACK_ROUNDS; attempt += 1) {
    try {
      return compileWorkflowInternal({
        workflow,
        qualityProfile,
        discoverFixes,
        layoutFeedback,
      });
    } catch (error) {
      if (!(error instanceof WorkflowLayoutFeedback)) throw error;
      const request = error.request;
      let nextFeedback = null;
      if (request.kind === 'rank-gap-minimum'
        && Number.isInteger(request.fromCol)
        && Number.isInteger(request.toCol)
        && Number.isFinite(request.minimum)) {
        const key = `${request.fromCol}:${request.toCol}`;
        const current = layoutFeedback.rankGapMinimums?.[key] ?? -Infinity;
        if (request.minimum > current + 0.0001) {
          nextFeedback = {
            ...layoutFeedback,
            rankGapMinimums: {
              ...(layoutFeedback.rankGapMinimums || {}),
              [key]: request.minimum,
            },
            rankGapContributors: {
              ...(layoutFeedback.rankGapContributors || {}),
              [key]: [
                `rank ${request.fromCol}→${request.toCol} route clearance`,
                `edge ${request.edge || `${request.from}->${request.to}`} route`,
              ],
            },
          };
        }
      } else if (request.kind === 'lane-gap-minimum'
        && Number.isFinite(request.minimum)
        && request.minimum > (layoutFeedback.laneGapMin ?? -Infinity) + 0.0001) {
        nextFeedback = {
          ...layoutFeedback,
          laneGapMin: request.minimum,
          laneGapContributors: [
            `edge ${request.edge || `${request.from}->${request.to}`} lane-gap route clearance`,
          ],
        };
      }
      if (!nextFeedback || attempt === MAX_READABLE_LAYOUT_FEEDBACK_ROUNDS) {
        return feedbackFailure(request);
      }
      layoutFeedback = nextFeedback;
    }
  }
  throw new Error('unreachable readable-v2 layout feedback state');
}

export function compileWorkflow({ workflow, qualityProfile } = {}) {
  return compileWorkflowWithFeedback({ workflow, qualityProfile });
}
