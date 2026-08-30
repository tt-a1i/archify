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
import { brandLabelFitWidth, brandMarkFor, brandMetadataFor, brandTopRailProblem, renderBrandMark } from '../shared/brand-marks.mjs';
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
  defaultFromSide,
  defaultToSide,
  chosenSide,
  dedupeRoutePoints,
  normalizeRoutePoints,
  markerSafeRoutePoints,
  markerEndpointSetback,
  roundedPath,
  routePointsValue,
  labelPoint,
  arrowClassMap,
  variantAccent
} from '../shared/geometry.mjs';

const stateTextFit = {
  sublabelPreferred: 7,
  sublabelMinimum: 6,
  tagPreferred: 7,
  tagMinimum: 6,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: lifecycle, template, outPath } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'lifecycle',
  defaultExample: 'agent-run.lifecycle.json',
  argv: cliArgs,
});

const viewBox = lifecycle.meta?.viewBox || [980, 660];
const layout = {
  phaseY: 126,
  eventY: 278,
  outcomeY: 450,
  phaseW: 118,
  phaseH: 62,
  eventW: 126,
  eventH: 58,
  outcomeW: 118,
  outcomeH: 58,
  phaseXs: [94, 248, 402, 556, 710],
  eventXs: [402, 556, 710],
  outcomeXs: [402, 556, 710]
};

const typeClass = {
  start: 'c-frontend',
  active: 'c-backend',
  waiting: 'c-cloud',
  decision: 'c-security',
  success: 'c-database',
  failure: 'c-security',
  neutral: 'c-external',
  external: 'c-external'
};

const textClass = {
  start: 't-frontend',
  active: 't-backend',
  waiting: 't-cloud',
  decision: 't-security',
  success: 't-database',
  failure: 't-security',
  neutral: 't-muted',
  external: 't-muted'
};

function legendY() {
  return viewBox[1] - 36;
}

// Keep the authored state-placement contract independent from the measured
// legend's lower baseline. Moving legend chrome must not admit new state
// geometry into the reserved outcome/legend band.
function lifecycleAreaBottom() {
  return viewBox[1] - 122;
}

// Lane semantics are fixed: lane id "main" maps to the top phase band, lane id
// "terminal" maps to the bottom outcome band, and every other lane shares the
// middle event band (separated visually via yOffset).
function bandFor(lane) {
  if (lane === 'main') return 'phase';
  if (lane === 'terminal') return 'outcome';
  return 'event';
}

function measureState(state) {
  const isPhase = bandFor(state.lane) === 'phase';
  const isOutcome = bandFor(state.lane) === 'outcome';
  const width = state.width || (isPhase ? layout.phaseW : isOutcome ? layout.outcomeW : layout.eventW);
  const height = state.height || (isPhase ? layout.phaseH : isOutcome ? layout.outcomeH : layout.eventH);
  const xs = isPhase ? layout.phaseXs : isOutcome ? layout.outcomeXs : layout.eventXs;
  const cx = xs[state.col] ?? xs[xs.length - 1];
  const y = (
    isPhase ? layout.phaseY :
      isOutcome ? layout.outcomeY :
        layout.eventY
  ) + (state.yOffset || 0);
  return {
    ...state,
    width,
    height,
    x: cx - width / 2,
    y,
    cx,
    cy: y + height / 2
  };
}

const states = new Map(asArray(lifecycle.states).map((state) => [state.id, measureState(state)]));
const stateInputIndexes = new Map(asArray(lifecycle.states).map((state, index) => [state.id, index]));
const laneLabels = new Map(asArray(lifecycle.lanes).map((lane) => [lane.id, lane.label]));
const stateSteps = new Map();
for (const [index, transition] of asArray(lifecycle.transitions).entries()) {
  if (!stateSteps.has(transition.from)) stateSteps.set(transition.from, index);
  if (!stateSteps.has(transition.to)) stateSteps.set(transition.to, index + 1);
}
for (const [index, state] of asArray(lifecycle.states).entries()) {
  if (!stateSteps.has(state.id)) stateSteps.set(state.id, index);
}

function lifecycleLayoutConstraints() {
  const readableText = [];
  for (const state of states.values()) {
    const stateIndex = stateInputIndexes.get(state.id);
    if (!Number.isInteger(stateIndex) || !Number.isFinite(state.width)) continue;
    const labelFont = fittedNodeFontSize(state.label, brandLabelFitWidth(state, state.width), 10, 8);
    readableText.push({
      path: `/states/${stateIndex}/label`,
      sourceFontPx: labelFont,
      maxReadableViewBoxWidth: maximumReadableViewBoxWidth(labelFont),
    });
    if (state.sublabel) {
      const sourceFontPx = fittedNodeFontSize(
        state.sublabel,
        state.width,
        stateTextFit.sublabelPreferred,
        stateTextFit.sublabelMinimum,
      );
      readableText.push({
        path: `/states/${stateIndex}/sublabel`,
        sourceFontPx,
        maxReadableViewBoxWidth: maximumReadableViewBoxWidth(sourceFontPx),
      });
    }
  }
  const readableWidths = readableText
    .map((entry) => entry.maxReadableViewBoxWidth)
    .filter(Number.isFinite);
  const finiteStates = [...states.values()].filter((state) => (
    isFinitePoint(state.x, state.y, state.width, state.height)
  ));
  return {
    minViewBoxWidth: finiteStates.length
      ? Math.ceil(Math.max(...finiteStates.map((state) => state.x + state.width + 32)))
      : null,
    maxReadableViewBoxWidth: readableWidths.length
      ? Math.round(Math.min(...readableWidths) * 1000) / 1000
      : null,
    minViewBoxHeight: Math.ceil(Math.max(
      566,
      ...finiteStates.map((state) => state.y + state.height + 122),
    )),
  };
}

function validateLifecycle() {
  const problems = [];
  if (states.size !== asArray(lifecycle.states).length) problems.push('State ids must be unique.');

  // The three bands are fixed at y=112/264/436. Preserve the original
  // outcome/legend reserve even though measured legend rows now sit lower.
  if (lifecycleAreaBottom() + 4 < 448) {
    problems.push({
      code: 'layout/lifecycle-viewbox-height',
      message: `viewBox height ${viewBox[1]} is too short for the fixed band layout — set meta.viewBox[1] to at least 566.`,
      subject: { path: '/meta/viewBox/1' },
      evidence: {
        currentViewBoxHeight: viewBox[1],
        requiredViewBoxHeight: 566,
        currentLifecycleAreaBottom: lifecycleAreaBottom(),
        requiredLifecycleAreaBottom: 444,
      },
      supportedFixes: ['set meta.viewBox[1] to 566 or greater'],
    });
  }

  const laneIds = new Set(asArray(lifecycle.lanes).map((lane) => lane.id));
  if (laneIds.size !== asArray(lifecycle.lanes).length) problems.push('Lane ids must be unique.');
  if (!laneIds.has('main')) {
    problems.push('Lifecycle diagrams need a lane with id "main" (the phase rail). Lane ids "main" and "terminal" are reserved: "main" maps to the top phase band, "terminal" to the bottom outcome band, and all other lanes share the middle event band.');
  }

  for (const state of states.values()) {
    if (!laneIds.has(state.lane)) {
      problems.push(`State "${state.id}" uses unknown lane "${state.lane}".`);
      continue;
    }
    const band = bandFor(state.lane);
    const maxCol = band === 'phase'
      ? layout.phaseXs.length
      : band === 'outcome'
        ? layout.outcomeXs.length
        : layout.eventXs.length;
    if (!Number.isInteger(state.col) || state.col < 0 || state.col >= maxCol) {
      problems.push(`State "${state.id}" uses invalid column ${state.col} — the ${band} band has integer columns 0..${maxCol - 1}.`);
      continue;
    }
    if (!isFinitePoint(state.x, state.y, state.cx, state.cy)) {
      problems.push(`State "${state.id}" produced non-finite coordinates — check col, width, height, and yOffset are numbers.`);
      continue;
    }
    if (state.x < 32 || state.x + state.width > viewBox[0] - 32) {
      problems.push(`State "${state.id}" exceeds the horizontal bounds of the diagram — reduce state.width or increase meta.viewBox[0].`);
    }
    if (state.y < 64 || state.y + state.height > lifecycleAreaBottom()) {
      const baseY = state.y - (state.yOffset || 0);
      const allowedY = {
        min: 64,
        max: lifecycleAreaBottom() - state.height,
      };
      const allowedYOffset = {
        min: allowedY.min - baseY,
        max: allowedY.max - baseY,
      };
      const requiredViewBoxHeight = Math.ceil(state.y + state.height + 122);
      const stateIndex = stateInputIndexes.get(state.id);
      const fixes = [];
      if (state.y + state.height > lifecycleAreaBottom()) {
        fixes.push(`set meta.viewBox[1] to at least ${requiredViewBoxHeight}`);
      }
      fixes.push(`set /states/${stateIndex}/yOffset between ${allowedYOffset.min} and ${allowedYOffset.max}`);
      const remedy = state.y + state.height > lifecycleAreaBottom()
        ? `set meta.viewBox[1] to at least ${requiredViewBoxHeight}, or keep yOffset between ${allowedYOffset.min} and ${allowedYOffset.max}`
        : `keep yOffset between ${allowedYOffset.min} and ${allowedYOffset.max}`;
      problems.push({
        code: 'layout/lifecycle-state-vertical-bounds',
        message: `State "${state.id}" occupies y ${state.y}..${state.y + state.height}, outside the allowed top-left y range ${allowedY.min}..${allowedY.max} — ${remedy}.`,
        subject: {
          path: `/states/${stateIndex}/yOffset`,
          id: state.id,
        },
        evidence: {
          currentViewBoxHeight: viewBox[1],
          requiredViewBoxHeight,
          currentY: state.y,
          stateHeight: state.height,
          lifecycleAreaBottom: lifecycleAreaBottom(),
          allowedY,
          currentYOffset: state.yOffset || 0,
          allowedYOffset,
        },
        supportedFixes: fixes,
      });
    }
    const estLabelW = textUnits(state.label) * 6.2;
    if (estLabelW > state.width + 6) {
      problems.push(`Label "${state.label}" (~${Math.round(estLabelW)}px) is wider than state "${state.id}" (${state.width}px) — shorten the label or increase state.width.`);
    }
    const brandRailProblem = brandTopRailProblem(state, state.width, 8, 'State');
    if (brandRailProblem) problems.push(brandRailProblem);
    // sublabel and tag render as single unwrapped <text> elements; shrink-to-fit
    // handles the ordinary case, this rejects what it cannot rescue.
    const availableTextW = availableNodeTextWidth(state.width);
    for (const [field, value, minimum] of [
      ['Sublabel', state.sublabel, stateTextFit.sublabelMinimum],
      ['Tag', state.tag, stateTextFit.tagMinimum],
    ]) {
      if (!value) continue;
      const minimumW = minimumNodeTextWidth(value, minimum);
      if (minimumW > availableTextW) {
        problems.push(`${field} "${value}" needs ~${Math.ceil(minimumW)}px at the ${minimum}px legible minimum, but state "${state.id}" provides ${availableTextW}px — shorten the ${field.toLowerCase()} or increase state.width.`);
      }
    }
  }

  // All non-main/non-terminal lanes share the same y band, so the overlap
  // check must run across lanes — not per-lane.
  const allStates = [...states.values()];
  for (let i = 0; i < allStates.length; i += 1) {
    for (let j = i + 1; j < allStates.length; j += 1) {
      if (rectsOverlap(allStates[i], allStates[j], 10)) {
        problems.push(entityOverlapIssue({
          diagramType: 'lifecycle',
          collection: 'states',
          entity: allStates[j],
          entityIndex: stateInputIndexes.get(allStates[j].id),
          otherEntity: allStates[i],
          otherEntityIndex: stateInputIndexes.get(allStates[i].id),
          minimumGapPx: 10,
          controls: ['col', 'yOffset'],
        }));
      }
    }
  }

  for (const transition of asArray(lifecycle.transitions)) {
    if (!states.has(transition.from)) problems.push(`Transition "${transition.label || transition.from}" references unknown source "${transition.from}".`);
    if (!states.has(transition.to)) problems.push(`Transition "${transition.label || transition.to}" references unknown target "${transition.to}".`);
    if (states.has(transition.from) && states.has(transition.to)) {
      const routed = pathFor(transition);
      const [start, end] = [routed.points[0], routed.points[routed.points.length - 1]];
      const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (distance < 32) problems.push(`Transition "${transition.label || `${transition.from}->${transition.to}`}" is too short (${Math.round(distance)}px; minimum 32px) — route it through a channel or drop its label.`);
    }
  }

  // Authored via points are authoritative in schema v1, including under a
  // quality profile. Preserve and render them exactly: applying the endpoint
  // gate would either reject an existing typed input or require silently
  // falsifying its geometry. Automatic routes still receive the side gate.
  problems.push(...cleanEndpointSideProblems({
    relations: lifecycle.transitions,
    endpointIds: new Set(states.keys()),
    pathFor,
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
    fromSideFor: (transition) => transitionSides(transition).fromSide,
    toSideFor: (transition) => transitionSides(transition).toSide,
    checkResolvedRouteSides: true,
    endpointFor: (id) => states.get(id),
    markerSetbackFor: (transition) => markerEndpointSetback({
      strokeWidth: transition.width || (transition.variant === 'emphasis' ? 2 : 1.1),
    }),
    shouldCheckRelation: (transition) => !Array.isArray(transition.via),
    routeHint: 'keep automatic routing, or choose fromSide/toSide and via points whose first and final segments cross state borders perpendicularly',
  }));
  problems.push(...cleanFlowProblems({
    relations: lifecycle.transitions,
    obstacles: states.values(),
    pathFor,
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
    obstacleKind: 'state',
    routeHint: 'adjust fromSide/toSide, set route/via or channelX/channelY, or move the state with col/yOffset'
  }));
  problems.push(...cleanCrossingProblems({
    relations: lifecycle.transitions,
    endpointIds: new Set(states.keys()),
    pathFor,
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
    profile: lifecycle.meta?.quality_profile,
    routeHint: 'adjust route/via or channelX/channelY so the transitions use separate lifecycle corridors'
  }));
  problems.push(...cleanAmbiguousCorridorProblems({
    relations: lifecycle.transitions,
    endpointIds: new Set(states.keys()),
    pathFor,
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
    profile: lifecycle.meta?.quality_profile,
    routeHint: 'adjust route/via or channelX/channelY so unrelated transitions do not visually merge'
  }));
  // Lifecycle bands are dashed reading guides, not closed containers. Keep the
  // shared contract wired with an explicit empty frame set so future typed
  // lifecycle containers cannot accidentally inherit presentation geometry.
  problems.push(...cleanBorderRunProblems({
    relations: lifecycle.transitions,
    endpointIds: new Set(states.keys()),
    frames: [],
    pathFor,
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
    profile: lifecycle.meta?.quality_profile
  }));
  problems.push(...cleanRouteRhythmProblems({
    relations: lifecycle.transitions,
    endpointIds: new Set(states.keys()),
    pathFor,
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
    profile: lifecycle.meta?.quality_profile,
    routeHint: 'move route/via or channel coordinates so each lifecycle turn has a readable run-up'
  }));

  const labelRects = [];
  for (const [transitionIndex, transition] of asArray(lifecycle.transitions).entries()) {
    if (!transition.label || !states.has(transition.from) || !states.has(transition.to)) continue;
    const [lx, ly] = labelPoint(transition, pathFor(transition).points);
    const longestLine = Math.max(textUnits(transition.label), textUnits(transition.note || ''));
    const width = Math.max(32, longestLine * 4.9 + 12);
    const height = transition.note ? 27 : 16;
    labelRects.push({ relation: transition, relationIndex: transitionIndex, label: transition.label, x: lx - width / 2, y: ly - 11, width, height, lx, ly });
  }
  for (const rect of labelRects) {
    for (const state of states.values()) {
      if (rectsOverlap(rect, state, -2)) {
        problems.push(relationshipLabelObstacleIssue({
          diagramType: 'lifecycle',
          relationCollection: 'transitions',
          relation: rect.relation,
          relationIndex: rect.relationIndex,
          labelRect: rect,
          obstacleCollection: 'states',
          obstacle: state,
          obstacleIndex: stateInputIndexes.get(state.id),
          avoidRects: [...states.values()],
          viewBox,
        }));
      }
    }
  }
  for (let i = 0; i < labelRects.length; i += 1) {
    for (let j = i + 1; j < labelRects.length; j += 1) {
      if (rectsOverlap(labelRects[i], labelRects[j], -2)) {
        problems.push(relationshipLabelPairIssue({
          diagramType: 'lifecycle',
          relationCollection: 'transitions',
          labelRect: labelRects[j],
          otherLabelRect: labelRects[i],
          avoidRects: [
            ...states.values(),
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
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
  }));
  problems.push(...cleanLabelRouteClearanceProblems({
    relations: lifecycle.transitions,
    labels: labelRects,
    endpointIds: new Set(states.keys()),
    pathFor,
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
    profile: lifecycle.meta?.quality_profile,
  }));

  if (problems.length) {
    throwDiagnosticProblems('Lifecycle layout validation failed', problems, {
      subject: { diagramType: 'lifecycle' },
    });
  }
}

function routeVia(transition, from, to, start, end, fromSide, toSide) {
  if (transition.via) return transition.via;
  switch (transition.route || 'auto') {
    case 'straight':
      return [];
    case 'drop': {
      const y = transition.channelY ?? (start[1] + end[1]) / 2;
      return [[start[0], y], [end[0], y]];
    }
    case 'bottom-channel': {
      const y = transition.channelY ?? Math.max(from.y + from.height, to.y + to.height) + 34;
      return [[start[0], y], [end[0], y]];
    }
    case 'top-channel': {
      const y = transition.channelY ?? Math.min(from.y, to.y) - 28;
      return [[start[0], y], [end[0], y]];
    }
    case 'right-channel': {
      const x = transition.channelX ?? Math.max(from.x + from.width, to.x + to.width) + 36;
      return [[x, start[1]], [x, end[1]]];
    }
    case 'left-channel': {
      const x = transition.channelX ?? Math.min(from.x, to.x) - 36;
      return [[x, start[1]], [x, end[1]]];
    }
    case 'auto':
    default: {
      if (start[0] === end[0] || start[1] === end[1]) return [];
      const fromVertical = fromSide === 'top' || fromSide === 'bottom';
      const toVertical = toSide === 'top' || toSide === 'bottom';
      if (fromVertical !== toVertical) {
        return [fromVertical ? [start[0], end[1]] : [end[0], start[1]]];
      }
      if (fromVertical) {
        const y = transition.channelY ?? (start[1] + end[1]) / 2;
        return [[start[0], y], [end[0], y]];
      }
      const x = transition.channelX ?? (start[0] + end[0]) / 2;
      return [[x, start[1]], [x, end[1]]];
    }
  }
}

const pathCache = new Map();

function sideFacingPoint(rect, point, fallback) {
  if (!Array.isArray(point) || point.length !== 2) return fallback;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = point[0] - cx;
  const dy = point[1] - cy;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left';
  return dy >= 0 ? 'bottom' : 'top';
}

function transitionSides(transition) {
  const from = states.get(transition.from);
  const to = states.get(transition.to);
  const explicitVia = asArray(transition.via);
  if (explicitVia.length) {
    return {
      fromSide: chosenSide(transition.fromSide, sideFacingPoint(from, explicitVia[0], defaultFromSide(from, to))),
      toSide: chosenSide(transition.toSide, sideFacingPoint(to, explicitVia.at(-1), defaultToSide(from, to))),
    };
  }
  if (transition.route === 'drop') {
    const channelY = transition.channelY
      ?? ((from.y + from.height / 2) + (to.y + to.height / 2)) / 2;
    return {
      fromSide: chosenSide(transition.fromSide, channelY >= from.y + from.height / 2 ? 'bottom' : 'top'),
      toSide: chosenSide(transition.toSide, channelY >= to.y + to.height / 2 ? 'bottom' : 'top'),
    };
  }
  const channelSide = ({
    'bottom-channel': 'bottom',
    'top-channel': 'top',
    'right-channel': 'right',
    'left-channel': 'left',
  })[transition.route] || null;
  return {
    fromSide: chosenSide(transition.fromSide, channelSide || defaultFromSide(from, to)),
    toSide: chosenSide(transition.toSide, channelSide || defaultToSide(from, to)),
  };
}

const automaticPorts = automaticPortSpread(lifecycle.transitions, states, {
  sideFor: (transition, endpoint) => transitionSides(transition)[endpoint === 'source' ? 'fromSide' : 'toSide'],
});

function pathFor(transition) {
  if (pathCache.has(transition)) return pathCache.get(transition);
  const from = states.get(transition.from);
  const to = states.get(transition.to);
  const ports = automaticPorts.get(transition);
  const { fromSide, toSide } = transitionSides(transition);
  const start = ports?.from || anchor(from, fromSide);
  const end = ports?.to || anchor(to, toSide);
  let via = routeVia(transition, from, to, start, end, fromSide, toSide);
  if (ports && !via.length && Math.abs(start[0] - end[0]) >= 4 && Math.abs(start[1] - end[1]) >= 4) {
    const midX = (start[0] + end[0]) / 2;
    via = [[midX, start[1]], [midX, end[1]]];
  }
  const rawPoints = [start, ...via, end];
  const points = transition.via ? dedupeRoutePoints(rawPoints) : normalizeRoutePoints(rawPoints);
  const routed = {
    d: roundedPath(markerSafeRoutePoints(points, {
      strokeWidth: transition.width || (transition.variant === 'emphasis' ? 2 : 1.1),
    }), transition.cornerRadius ?? 10),
    points
  };
  pathCache.set(transition, routed);
  return routed;
}

function bandTitles() {
  const lanes = asArray(lifecycle.lanes);
  const mainLane = lanes.find((lane) => lane.id === 'main');
  const terminalLane = lanes.find((lane) => lane.id === 'terminal');
  const eventLanes = lanes.filter((lane) => lane.id !== 'main' && lane.id !== 'terminal');
  return [
    mainLane?.label || 'Lifecycle phases',
    eventLanes.length ? eventLanes.map((lane) => lane.label).join(' + ') : 'Interruptions + recovery',
    terminalLane?.label || 'Outcomes'
  ];
}

function renderBands() {
  const right = viewBox[0] - 72;
  const titles = bandTitles();
  return `        <path d="M 72 112 L ${right} 112" class="a-default" stroke-width="0.8" stroke-dasharray="3,8"/>
        <text x="72" y="100" class="t-dim" font-size="10" font-weight="600">01 / ${esc(titles[0])}</text>
        <path d="M 72 264 L ${right} 264" class="a-default" stroke-width="0.8" stroke-dasharray="3,8"/>
        <text x="72" y="252" class="t-dim" font-size="10" font-weight="600">02 / ${esc(titles[1])}</text>
        <path d="M 72 436 L ${right} 436" class="a-default" stroke-width="0.8" stroke-dasharray="3,8"/>
        <text x="72" y="424" class="t-dim" font-size="10" font-weight="600">03 / ${esc(titles[2])}</text>`;
}

function renderState(state) {
  const fill = typeClass[state.type] || typeClass.neutral;
  const accent = textClass[state.type] || 't-muted';
  const hasSub = state.sublabel != null && state.sublabel !== '';
  const sub = hasSub
    ? `\n          <text data-detail="context" x="${state.cx}" y="${state.y + 37}" class="t-muted" font-size="${fittedNodeFontSize(state.sublabel, state.width, stateTextFit.sublabelPreferred, stateTextFit.sublabelMinimum)}" text-anchor="middle">${esc(state.sublabel)}</text>`
    : '';
  const tag = state.tag
    ? `\n        <text data-detail="fine" x="${state.cx}" y="${state.y + state.height - 11}" class="${accent}" font-size="${fittedNodeFontSize(state.tag, state.width, stateTextFit.tagPreferred, stateTextFit.tagMinimum)}" text-anchor="middle">${esc(state.tag)}</text>`
    : '';
  const hasBrand = Boolean(brandMarkFor(state));
  const step = state.step
    ? `\n        <text data-detail="fine" x="${state.x + (hasBrand ? 23 : 10)}" y="${state.y + 14}" class="${accent}" font-size="7" font-weight="700">${esc(state.step)}</text>`
    : '';
  const brand = renderBrandMark(state, { x: state.x + state.width - 22, y: state.y + 6 });
  const labelFontSize = fittedNodeFontSize(state.label, brandLabelFitWidth(state, state.width), 10, 8);
  const passport = {
    kind: state.type,
    sublabel: state.sublabel,
    tag: state.tag,
    context: laneLabels.get(state.lane) || i18nText(lifecycle.meta.locale, 'node.context.lifecycle'),
    ...brandMetadataFor(state),
  };
  return `        <g ${focusNodeAttrs(state.id, state.label, passport, lifecycle.meta.locale)}>
          ${focusNodeTitle(state.label, passport)}
          <rect x="${state.x}" y="${state.y}" width="${state.width}" height="${state.height}" rx="7" class="c-mask"/>
          <rect x="${state.x}" y="${state.y}" width="${state.width}" height="${state.height}" rx="7" class="${fill}"${animateAttr(lifecycle.meta, 'node', stateSteps.get(state.id))} stroke-width="1.5"/>
          ${renderSemanticSigil(state.type, { x: hasBrand ? state.x + 6 : state.x + state.width - 17, y: state.y + 6 })}${brand ? `\n          ${brand}` : ''}${step}
          <text data-node-label=""${hasSub ? ' data-detail-anchor=""' : ''} x="${state.cx}" y="${state.y + 21}" class="t-primary" font-size="${labelFontSize}" font-weight="600" text-anchor="middle">${esc(state.label)}</text>${sub}${tag}
        </g>`;
}

function renderTransitionPath(transition, index) {
  const [cls, marker] = arrowClassMap[transition.variant || 'default'] || arrowClassMap.default;
  const routed = pathFor(transition);
  const strokeWidth = transition.width || (transition.variant === 'emphasis' ? 2 : 1.1);
  return `        <path ${focusEdgeAttrs(transition.from, transition.to, transition.label, index, transition.id)} data-composition-points="${routePointsValue(routed.points)}" d="${routed.d}" class="${cls}"${animateAttr(lifecycle.meta, 'edge', index)} stroke-width="${strokeWidth}" marker-end="url(#${marker})"/>`;
}

function renderTransitionLabel(transition, index) {
  if (!transition.label) return '';
  const routed = pathFor(transition);
  const [lx, ly] = labelPoint(transition, routed.points);
  const longestLine = Math.max(textUnits(transition.label), textUnits(transition.note || ''));
  const labelW = Math.max(32, longestLine * 4.9 + 12);
  const labelH = transition.note ? 27 : 16;
  const note = transition.note
    ? `\n        <text data-detail="fine" x="${lx}" y="${ly + 11}" class="t-dim" font-size="7" text-anchor="middle">${esc(transition.note)}</text>`
    : '';
  return `        <g data-detail="context" ${focusEdgeAttrs(transition.from, transition.to, transition.label, index, transition.id)}>
          <rect x="${lx - labelW / 2}" y="${ly - 11}" width="${labelW}" height="${labelH}" rx="4" class="c-mask"/>
          <text x="${lx}" y="${ly}" class="${variantAccent(transition.variant)}" font-size="8" text-anchor="middle">${esc(transition.label)}</text>${note}
        </g>`;
}

const LEGEND_CATALOG = [
  'start',
  'active',
  'waiting',
  'decision',
  'success',
  'failure',
  'neutral',
  'external',
].map((kind) => ({ kind, label: i18nText(lifecycle.meta.locale, `legend.lifecycle.${kind}`) }));

function renderLegend() {
  const presentKinds = new Set([...states.values()].map((state) => state.type));
  const entries = resolveLegend(lifecycle.meta?.legend, LEGEND_CATALOG, presentKinds);
  return renderResolvedLegend({
    entries,
    locale: lifecycle.meta.locale,
    layout: {
      x: 40,
      baselineY: legendY(),
      width: viewBox[0] - 80,
      minTitleY: lifecycleAreaBottom() + 8,
      unfit: lifecycle.meta?.legend === undefined ? 'hide' : 'error',
      diagramType: 'lifecycle',
    },
    renderSwatch: (entry) => `<rect x="${entry.x}" y="${entry.baseline - 8}" width="14" height="9" rx="2" class="${typeClass[entry.kind] || 'c-external'}" stroke-width="1"/>`,
  });
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(lifecycle.meta)}>
${svgAccessibleText(lifecycle.meta, 'lifecycle')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Lifecycle bands -->
${renderBands()}

        <!-- Transition paths -->
${asArray(lifecycle.transitions).map(renderTransitionPath).join('\n')}

        <!-- States -->
${[...states.values()].map(renderState).join('\n\n')}

        <!-- Transition labels -->
${asArray(lifecycle.transitions).map(renderTransitionLabel).join('\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}

function buildLayoutReport(validation) {
  const relationships = asArray(lifecycle.transitions)
    .map((transition, transitionIndex) => ({ transition, transitionIndex }))
    .filter(({ transition }) => states.has(transition.from) && states.has(transition.to))
    .map(({ transition, transitionIndex }) => {
      const routed = pathFor(transition);
      const labelAt = transition.label ? labelPoint(transition, routed.points) : null;
      return connectionPath(transition, routed, labelAt, transitionIndex);
    });
  const labels = asArray(lifecycle.transitions)
    .map((transition, transitionIndex) => ({ transition, transitionIndex }))
    .filter(({ transition }) => transition.label && states.has(transition.from) && states.has(transition.to))
    .map(({ transition, transitionIndex }) => {
      const [lx, ly] = labelPoint(transition, pathFor(transition).points);
      const longestLine = Math.max(textUnits(transition.label), textUnits(transition.note || ''));
      const width = Math.max(32, longestLine * 4.9 + 12);
      const height = transition.note ? 27 : 16;
      return relationshipLabelBox({
        relation: transition,
        relationIndex: transitionIndex,
        x: lx - width / 2,
        y: ly - 11,
        width,
        height,
        lx,
        ly,
      });
    });
  const titles = bandTitles();
  return resolvedLayoutReport({
    type: 'lifecycle',
    viewBox,
    validation,
    entityKey: 'states',
    entities: [...states.values()].map(componentBox),
    relationships,
    labels,
    constraints: lifecycleLayoutConstraints(),
    extras: {
      bands: [112, 264, 436].map((y, index) => ({
        index,
        label: titles[index],
        y,
        x1: 72,
        x2: viewBox[0] - 72,
      })),
    },
  });
}

if (layoutJsonMode) {
  emitResolvedLayoutReport({ validate: validateLifecycle, build: buildLayoutReport });
} else {
  validateLifecycle();
  writeDiagram({
    outPath,
    template,
    diagramType: 'lifecycle',
    meta: lifecycle.meta,
    svg: renderSvg(),
    cards: lifecycle.cards,
  });
}
