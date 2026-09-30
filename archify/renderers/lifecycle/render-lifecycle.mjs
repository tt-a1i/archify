import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { recordDiagnostic, throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { createRouter } from '../architecture/routing.mjs';
import { createLifecycleGridRouter } from './grid-routing.mjs';
import { placeAutomaticLabels, reservedLabelRect } from '../architecture/labels.mjs';
import { legendFootprint, resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { availableNodeTextWidth, fittedNodeFontSize, minimumNodeTextWidth, nodeLabelLayout } from '../shared/text-fit.mjs';
import { brandLabelFitWidth, brandMarkFor, brandMetadataFor, brandTopRailProblem, renderBrandMark } from '../shared/brand-marks.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import { DESKTOP_READER_DIAGRAM_WIDTH, MIN_PROJECTED_NODE_TEXT_PX } from '../shared/desktop-readability.mjs';
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
  legacyDefaultFromSide as defaultFromSide,
  legacyDefaultToSide as defaultToSide,
  chosenSide,
  roundedPath,
  routePointsValue,
  authoredStraightRouteAttrs,
  labelPoint,
  arrowClassMap,
  edgeLabelAccent
} from '../shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: lifecycle, template, outPath, sourceEvidence } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'lifecycle',
  defaultExample: 'agent-run.lifecycle.json'
});

// v2 sets state text one step larger; its canvas width is then budgeted
// from the smallest fitted text so the desktop Reader keeps it legible.
const stateTextFit = lifecycle.schema_version === 2 ? {
  labelPreferred: 11,
  labelMinimum: 9,
  sublabelPreferred: 8,
  sublabelMinimum: 7,
  tagPreferred: 8,
  tagMinimum: 7,
  step: 8,
} : {
  labelPreferred: 10,
  labelMinimum: 8,
  sublabelPreferred: 7,
  sublabelMinimum: 6,
  tagPreferred: 7,
  tagMinimum: 6,
  step: 7,
};

// schema_version 2 replaces the three fixed bands (main/event/outcome, with
// non-main lanes sharing one band and lower columns offset by +2) with one
// row per populated lane on a shared 0..4 column grid. v1 keeps its exact
// state geometry; only presentation (colors, markers, legend, sigil side)
// is shared between versions.
const isV2 = lifecycle.schema_version === 2;
const authoredViewBox = lifecycle.meta?.viewBox;

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

const layoutV2 = {
  stateW: 140,
  stateH: 64,
  marginX: 60,
  minGap: 64,
  floorGap: 44,
  firstRowTop: 56,
  rowPitch: 184,
};

function transitionLabelWidth(transition) {
  const longestLine = Math.max(textUnits(transition.label), textUnits(transition.note || ''));
  return Math.max(32, longestLine * 4.9 + 12);
}

function stateFontSizes(state, width) {
  return {
    label: fittedNodeFontSize(state.label, brandLabelFitWidth(state, width), stateTextFit.labelPreferred, stateTextFit.labelMinimum),
    sublabel: fittedNodeFontSize(state.sublabel, width, stateTextFit.sublabelPreferred, stateTextFit.sublabelMinimum),
    tag: fittedNodeFontSize(state.tag, width, stateTextFit.tagPreferred, stateTextFit.tagMinimum),
  };
}

// v2 column centers. A gap between two columns widens until the label of a
// same-row neighbour transition fits beside its line; the whole canvas then
// stays inside the desktop readability budget of its smallest state text.
const v2ColumnCenters = (() => {
  if (!isV2) return [];
  const authored = asArray(lifecycle.states);
  const widths = [0, 1, 2, 3, 4].map((col) => Math.max(
    layoutV2.stateW, ...authored.filter((state) => state.col === col).map((state) => state.width || 0),
  ));
  const cols = authored.map((state) => state.col).filter((col) => Number.isInteger(col) && col >= 0 && col <= 4);
  const lastCol = cols.length ? Math.max(...cols) : 0;
  const gaps = [0, 1, 2, 3].map(() => layoutV2.minGap);
  const byId = new Map(authored.map((state) => [state.id, state]));
  for (const transition of asArray(lifecycle.transitions)) {
    const [from, to] = [byId.get(transition.from), byId.get(transition.to)];
    if (!(transition.label || transition.note) || !from || !to || from.lane !== to.lane
      || !Number.isInteger(from.col) || !Number.isInteger(to.col) || Math.abs(from.col - to.col) !== 1) continue;
    const gap = Math.min(from.col, to.col);
    if (gap >= 0 && gap < 4) gaps[gap] = Math.max(gaps[gap], Math.ceil(transitionLabelWidth(transition) + 24));
  }
  const smallestText = Math.min(stateTextFit.step, ...authored.flatMap((state) => (
    Object.values(stateFontSizes(state, state.width || layoutV2.stateW))
  )));
  const budget = Math.floor(DESKTOP_READER_DIAGRAM_WIDTH * smallestText / MIN_PROJECTED_NODE_TEXT_PX);
  const fixed = layoutV2.marginX * 2 + widths.slice(0, lastCol + 1).reduce((sum, width) => sum + width, 0);
  const used = gaps.slice(0, lastCol);
  const excess = fixed + used.reduce((sum, gap) => sum + gap, 0) - budget;
  const slack = used.reduce((sum, gap) => sum + gap - layoutV2.floorGap, 0);
  if (excess > 0 && slack > 0) {
    const ratio = Math.min(1, excess / slack);
    for (let index = 0; index < used.length; index += 1) {
      gaps[index] = Math.floor(gaps[index] - (gaps[index] - layoutV2.floorGap) * ratio);
    }
  }
  const centers = [];
  let x = layoutV2.marginX;
  for (let col = 0; col <= 4; col += 1) {
    centers.push(x + widths[col] / 2);
    x += widths[col] + (gaps[col] ?? 0);
  }
  return centers;
})();

// Rows render in authored lane order with `main` first and `terminal` last;
// lanes without states get no row and no title.
function laneRowOrder() {
  const lanes = asArray(lifecycle.lanes);
  const populated = new Set(asArray(lifecycle.states).map((state) => state.lane));
  const ordered = [];
  if (populated.has('main')) ordered.push('main');
  for (const lane of lanes) {
    if (lane.id !== 'main' && lane.id !== 'terminal' && populated.has(lane.id)) ordered.push(lane.id);
  }
  if (populated.has('terminal')) ordered.push('terminal');
  return ordered;
}

const v2RowTop = new Map(isV2
  ? laneRowOrder().map((laneId, index) => [laneId, layoutV2.firstRowTop + index * layoutV2.rowPitch])
  : []);

const typeClass = {
  start: 'c-frontend',
  active: 'c-frontend',
  waiting: 'c-cloud',
  decision: 'c-database',
  success: 'c-backend',
  failure: 'c-security',
  neutral: 'c-external',
  external: 'c-external'
};

const textClass = {
  start: 't-frontend',
  active: 't-frontend',
  waiting: 't-cloud',
  decision: 't-database',
  success: 't-backend',
  failure: 't-security',
  neutral: 't-muted',
  external: 't-muted'
};

// Lane semantics are fixed: lane id "main" maps to the top phase band, lane id
// "terminal" maps to the bottom outcome band, and every other lane shares the
// middle event band (separated visually via yOffset). v1 only.
function bandFor(lane) {
  if (lane === 'main') return 'phase';
  if (lane === 'terminal') return 'outcome';
  return 'event';
}

function measureState(state) {
  let width;
  let height;
  let cx;
  let y;
  if (isV2) {
    width = state.width || layoutV2.stateW;
    height = state.height || layoutV2.stateH;
    cx = v2ColumnCenters[state.col] ?? NaN;
    y = (v2RowTop.get(state.lane) ?? NaN) + (state.yOffset || 0);
  } else {
    const isPhase = bandFor(state.lane) === 'phase';
    const isOutcome = bandFor(state.lane) === 'outcome';
    width = state.width || (isPhase ? layout.phaseW : isOutcome ? layout.outcomeW : layout.eventW);
    height = state.height || (isPhase ? layout.phaseH : isOutcome ? layout.outcomeH : layout.eventH);
    const xs = isPhase ? layout.phaseXs : isOutcome ? layout.outcomeXs : layout.eventXs;
    cx = xs[state.col] ?? xs[xs.length - 1];
    y = (
      isPhase ? layout.phaseY :
        isOutcome ? layout.outcomeY :
          layout.eventY
    ) + (state.yOffset || 0);
  }
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
const laneLabels = new Map(asArray(lifecycle.lanes).map((lane) => [lane.id, lane.label]));
const plannedTransitions = asArray(lifecycle.transitions).filter(plannerRouted);
const v2Rows = laneRowOrder();
const v2RowOf = (state) => (v2Rows.includes(state.lane) ? v2Rows.indexOf(state.lane) : undefined);
// probe、最终路由和 SVG 必须使用同一个水平预算；显式画布不变。
const v2CanvasWidth = authoredViewBox?.[0] ?? Math.max(640, Math.ceil(
  Math.max(0, ...[...states.values()].map(state => state.x + state.width).filter(Number.isFinite)) + layoutV2.marginX,
));
let useGridRouter = isV2;
if (isV2) {
  // Route once to learn how many horizontal tracks each row gap carries,
  // then open every gap to fit them before the final routing pass.
  const probe = createLifecycleGridRouter(states, plannedTransitions, {
    rowOf: v2RowOf, columnXs: v2ColumnCenters, canvasWidth: v2CanvasWidth,
    bandTitles: bandGeometry(),
  });
  // Compatible pins keep the grid layout. A conflicting pin sends the whole
  // scene to the side-aware planner so all edges still share port spreading
  // and obstacle reservations.
  useGridRouter = plannedTransitions.every(transition => {
    const sides = probe.connectionSides(transition);
    return ['fromSide', 'toSide'].every(key => !transition[key] || transition[key] === 'auto' || transition[key] === sides[key]);
  });
  let top = layoutV2.firstRowTop;
  v2Rows.forEach((laneId, index) => {
    const rowHeight = Math.max(layoutV2.stateH, ...[...states.values()]
      .filter((state) => state.lane === laneId)
      .map((state) => state.y + state.height - v2RowTop.get(laneId)));
    v2RowTop.set(laneId, top);
    top += rowHeight + Math.max(layoutV2.rowPitch - layoutV2.stateH, useGridRouter ? probe.gapHeight(index) : 0);
  });
  for (const state of asArray(lifecycle.states)) states.set(state.id, measureState(state));
}
const authoredOutgoing = new Set(asArray(lifecycle.transitions).map((transition) => transition.from));

// A state with no authored outgoing transition is terminal in the UML sense.
// v1 main states rely on the implied phase rail, so a main state is only final
// at the furthest occupied main column; every other v1 lane is explicit.
function isFinal(state) {
  if (authoredOutgoing.has(state.id)) return false;
  if (isV2) return true;
  if (bandFor(state.lane) !== 'phase') return true;
  const mainCols = [...states.values()].filter((s) => bandFor(s.lane) === 'phase').map((s) => s.col);
  return state.col === Math.max(...mainCols);
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
].map((kind) => ({
  kind,
  label: i18nText(lifecycle.meta.locale, `legend.lifecycle.${kind}`),
  swatchWidth: kind === 'start' ? 26 : undefined,
}));

// Entries exist before the canvas so an auto-sized v2 viewBox can reserve the
// measured legend rows below the last row instead of painting over them.
// The structural `final` entry explains the double border; it follows the
// kind entries and disappears with them, so a hidden legend stays empty.
function legendCatalog() {
  const presentKinds = new Set([...states.values()].map((state) => state.type));
  const entries = resolveLegend(lifecycle.meta?.legend, LEGEND_CATALOG, presentKinds);
  if (!entries.length || ![...states.values()].some(isFinal)) return entries;
  return [...entries, {
    kind: 'final',
    label: i18nText(lifecycle.meta.locale, 'legend.lifecycle.final'),
    interactive: false,
    present: true,
    swatchWidth: 16,
  }];
}

const resolvedLegendEntries = legendCatalog();

let viewBox;
if (isV2 && !authoredViewBox) {
  const finite = [...states.values()];
  const width = v2CanvasWidth;
  const footprint = legendFootprint(resolvedLegendEntries, { width: width - 80 });
  const statesBottom = Math.max(0, ...finite.map((state) => state.y + state.height).filter(Number.isFinite));
  viewBox = [width, Math.ceil(statesBottom + footprint.extraHeight + 96)];
} else {
  viewBox = authoredViewBox || [980, 660];
}

const legendExtraHeight = legendFootprint(resolvedLegendEntries, { width: viewBox[0] - 80 }).extraHeight;

function legendY() {
  return viewBox[1] - 36;
}

// Keep the authored state-placement contract independent from the measured
// legend's lower baseline. Moving legend chrome must not admit new state
// geometry into the reserved outcome/legend band.
function lifecycleAreaBottom() {
  return isV2 ? viewBox[1] - legendExtraHeight - 96 : viewBox[1] - 122;
}
const stateSteps = new Map();
for (const [index, transition] of asArray(lifecycle.transitions).entries()) {
  if (!stateSteps.has(transition.from)) stateSteps.set(transition.from, index);
  if (!stateSteps.has(transition.to)) stateSteps.set(transition.to, index + 1);
}
for (const [index, state] of asArray(lifecycle.states).entries()) {
  if (!stateSteps.has(state.id)) stateSteps.set(state.id, index);
}

function validateLifecycle() {
  const problems = [];
  if (states.size !== asArray(lifecycle.states).length) problems.push('State ids must be unique.');

  // The three bands are fixed at y=112/264/436. Preserve the original
  // outcome/legend reserve even though measured legend rows now sit lower.
  // v2 derives its canvas from rendered rows, so the floor does not apply.
  if (!isV2 && lifecycleAreaBottom() + 4 < 448) {
    problems.push(`viewBox height ${viewBox[1]} is too short for the fixed band layout — set meta.viewBox[1] to at least 566.`);
  }

  const laneIds = new Set(asArray(lifecycle.lanes).map((lane) => lane.id));
  if (laneIds.size !== asArray(lifecycle.lanes).length) problems.push('Lane ids must be unique.');
  if (!laneIds.has('main')) {
    problems.push(isV2
      ? 'Lifecycle diagrams need a lane with id "main" (the first row). Lane ids "main" and "terminal" are reserved: "main" renders as the first row, "terminal" as the last, and every other lane in authored order.'
      : 'Lifecycle diagrams need a lane with id "main" (the phase rail). Lane ids "main" and "terminal" are reserved: "main" maps to the top phase band, "terminal" to the bottom outcome band, and all other lanes share the middle event band.');
  }

  for (const state of states.values()) {
    if (!laneIds.has(state.lane)) {
      problems.push(`State "${state.id}" uses unknown lane "${state.lane}".`);
      continue;
    }
    if (isV2) {
      if (!Number.isInteger(state.col) || state.col < 0 || state.col > 4) {
        problems.push(`State "${state.id}" uses invalid column ${state.col} — every lifecycle row has integer columns 0..4.`);
        continue;
      }
    } else {
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
    }
    if (!isFinitePoint(state.x, state.y, state.cx, state.cy)) {
      problems.push(`State "${state.id}" produced non-finite coordinates — check col, width, height, and yOffset are numbers.`);
      continue;
    }
    if (state.x < (isV2 ? 28 : 32) || state.x + state.width > viewBox[0] - (isV2 ? 28 : 32)) {
      problems.push(`State "${state.id}" exceeds the horizontal bounds of the diagram — reduce state.width${isV2 ? ', lower its col,' : ''} or increase meta.viewBox[0].`);
    }
    if (state.y < (isV2 ? 44 : 64) || state.y + state.height > lifecycleAreaBottom()) {
      problems.push(`State "${state.id}" exceeds the vertical lifecycle area — keep y between ${isV2 ? 44 : 64} and ${lifecycleAreaBottom()} (adjust yOffset or increase meta.viewBox[1]).`);
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

  // v1: all non-main/non-terminal lanes share the same y band, so the overlap
  // check must run across lanes — not per-lane. v2 gives each lane its own
  // row, so only same-row neighbours can collide, but the shared check still
  // covers custom widths and yOffset nudges.
  const allStates = [...states.values()];
  for (let i = 0; i < allStates.length; i += 1) {
    for (let j = i + 1; j < allStates.length; j += 1) {
      if (rectsOverlap(allStates[i], allStates[j], 10)) {
        problems.push(`States "${allStates[i].id}" and "${allStates[j].id}" are less than 10px apart — move one to another col or separate them with yOffset${isV2 ? '.' : ' (lanes other than "main"/"terminal" share one band).'}`);
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
    // Planner routes render with the opaque crossover halo, like architecture.
    crossingResolved: (left, right) => plannerRouted(left) && plannerRouted(right),
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

  const labelRects = transitionLabelRects();
  if (lifecycle.meta?.quality_profile === 'showcase') {
    for (const rect of labelRects) {
      for (const title of bandGeometry()) {
        if (!rectsOverlap(rect, title)) continue;
        const message = `Transition ${rect.relationIndex} label "${rect.label}" overlaps lifecycle band title "${title.label}" — move the label with labelAt/labelDx/labelDy/labelSegment or provide more space.`;
        recordDiagnostic({
          code: 'composition/label-band-title-overlap', severity: 'error', message,
          subject: { diagramType: 'lifecycle', collection: 'transitions', index: rect.relationIndex, from: rect.relation.from, to: rect.relation.to },
          evidence: { labelRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, bandTitle: title },
          supportedFixes: ['move the transition label with labelAt/labelDx/labelDy/labelSegment while preserving its text'],
        });
        problems.push(message);
      }
    }
  }
  for (const rect of labelRects) {
    for (const state of states.values()) {
      if (rectsOverlap(rect, state, -2)) {
        problems.push(`Label "${rect.label}" overlaps state "${state.id}" — adjust labelDx/labelDy/labelSegment or set labelAt.\n${suggestLabelObstacleFix(rect, rect.lx, rect.ly, state, 'state', viewBox, states.values())}`);
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
    relations: lifecycle.transitions,
    labels: labelRects,
    endpointIds: new Set(states.keys()),
    pathFor,
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
    profile: lifecycle.meta?.quality_profile,
  }));
  problems.push(...cleanLabelCanvasContainmentProblems({
    labels: labelRects,
    viewBox,
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

// A transition without via, channel, or a lifecycle route preset is routed by
// the obstacle-aware planner shared with architecture, so a first draft that
// leaves routing to the renderer does not cross unrelated states or produce
// micro jogs. Authored via/route/channel geometry keeps the lifecycle presets.
function plannerRouted(transition) {
  return !transition.via
    && (!transition.route || transition.route === 'auto')
    && transition.channelX === undefined
    && transition.channelY === undefined;
}

// v2 states sit on a fixed row/column grid, so automatic transitions use the
// dedicated orthogonal grid router; v1 keeps the shared obstacle planner.
const planner = useGridRouter ? createLifecycleGridRouter(states, plannedTransitions, {
  rowOf: v2RowOf,
  columnXs: v2ColumnCenters,
  canvasWidth: v2CanvasWidth,
  bandTitles: bandGeometry(),
}) : createRouter(states, plannedTransitions, {
  labelRectFor: (transition, points, { routes, labels }) => ((transition.label || transition.note) ? reservedLabelRect({
    label: { relation: transition, label: transition.label || transition.note, ...transitionLabelBoxAt(transition, labelPoint(transition, points)) },
    points,
    routes: routes.map((route, index) => ({ relationIndex: index, points: route })),
    labels,
    components: [...states.values()],
    viewBox,
    placementBottom: lifecycleAreaBottom(),
  }) : null),
});

function transitionSides(transition) {
  if (plannerRouted(transition)) return planner.connectionSides(transition);
  const from = states.get(transition.from);
  const to = states.get(transition.to);
  return {
    fromSide: chosenSide(transition.fromSide, defaultFromSide(from, to)),
    toSide: chosenSide(transition.toSide, defaultToSide(from, to)),
  };
}

const automaticPorts = automaticPortSpread(
  asArray(lifecycle.transitions).filter((transition) => !plannerRouted(transition)),
  states,
  { sideFor: (transition, endpoint) => transitionSides(transition)[endpoint === 'source' ? 'fromSide' : 'toSide'] },
);

function pathFor(transition) {
  if (pathCache.has(transition)) return pathCache.get(transition);
  if (plannerRouted(transition)) {
    let routed = planner.pathFor(transition);
    if (useGridRouter) routed = { d: roundedPath(routed, transition.cornerRadius ?? 10), points: routed };
    pathCache.set(transition, routed);
    return routed;
  }
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
  const points = [start, ...via, end];
  const routed = {
    d: roundedPath(points, transition.cornerRadius ?? 10),
    points
  };
  pathCache.set(transition, routed);
  return routed;
}

const resolvedLabelPoints = new Map();

function transitionLabelBox(transition) {
  return transitionLabelBoxAt(
    transition,
    resolvedLabelPoints.get(transition) || labelPoint(transition, pathFor(transition).points),
  );
}

function transitionLabelBoxAt(transition, [lx, ly]) {
  const width = transitionLabelWidth(transition);
  const height = transition.label && transition.note ? 27 : 16;
  return { x: lx - width / 2, y: ly - 11, width, height, lx, ly };
}

function transitionLabelRects() {
  const rects = [];
  for (const [relationIndex, transition] of asArray(lifecycle.transitions).entries()) {
    if (!(transition.label || transition.note) || !states.has(transition.from) || !states.has(transition.to)) continue;
    rects.push({ relation: transition, relationIndex, label: transition.label || transition.note, ...transitionLabelBox(transition) });
  }
  return rects;
}

// Showcase drafts leave label positions to the renderer too: move an unpinned
// label off other routes and states instead of reporting a clearance defect.
if (lifecycle.meta?.quality_profile === 'showcase') {
  const placed = placeAutomaticLabels({
    labels: transitionLabelRects(),
    routes: asArray(lifecycle.transitions).flatMap((transition, relationIndex) => (
      states.has(transition.from) && states.has(transition.to)
        ? [{ relationIndex, points: pathFor(transition).points }] : []
    )),
    components: [...states.values()],
    titles: bandGeometry(),
    viewBox,
    placementBottom: lifecycleAreaBottom(),
    keepFallbackNearRoute: isV2,
    gridSweep: isV2,
  });
  for (const rect of placed) resolvedLabelPoints.set(rect.relation, [rect.lx, rect.ly]);
}

function bandGeometry() {
  if (isV2) {
    // One row header per rendered row, set vertically in the left gutter so
    // routes entering a row never run through its title.
    return laneRowOrder().map((laneId, index) => {
      const cy = v2RowTop.get(laneId) + layoutV2.stateH / 2;
      const label = laneLabels.get(laneId) || laneId;
      const length = textUnits(label) * 6.2;
      return { index, label, vertical: true, cx: 18, cy, x: 11, y: cy - length / 2, width: 14, height: length };
    });
  }
  const lanes = asArray(lifecycle.lanes);
  const mainLane = lanes.find((lane) => lane.id === 'main');
  const terminalLane = lanes.find((lane) => lane.id === 'terminal');
  const eventLanes = lanes.filter((lane) => lane.id !== 'main' && lane.id !== 'terminal');
  const populated = new Set([...states.values()].map((state) => bandFor(state.lane)));
  return [
    mainLane?.label || 'Lifecycle phases',
    eventLanes.length ? eventLanes.map((lane) => lane.label).join(' + ') : 'Interruptions + recovery',
    terminalLane?.label || 'Outcomes'
  ].map((title, index) => {
    const baseline = [100, 252, 424][index];
    const label = `${String(index + 1).padStart(2, '0')} / ${title}`;
    return { index, band: ['phase', 'event', 'outcome'][index], label, x: 72, y: baseline - 11, width: textUnits(label) * 6.2, height: 14, baseline };
  }).filter((band) => populated.has(band.band));
}

function renderBands() {
  return bandGeometry().map((band) => (band.vertical
    ? `        <text x="${band.cx}" y="${band.cy}" class="t-dim" font-size="10" font-weight="600" writing-mode="vertical-rl" text-anchor="middle">${esc(band.label)}</text>`
    : `        <path d="M ${band.x} ${band.baseline + 12} L ${viewBox[0] - band.x} ${band.baseline + 12}" class="a-default" stroke-width="0.8" stroke-dasharray="3,8"/>
        <text x="${band.x}" y="${band.baseline}" class="t-dim" font-size="10" font-weight="600">${esc(band.label)}</text>`)).join('\n');
}

function renderState(state) {
  const fill = typeClass[state.type] || typeClass.neutral;
  const accent = textClass[state.type] || 't-muted';
  const hasSub = state.sublabel != null && state.sublabel !== '';
  const { label: labelFontSize, sublabel: sublabelFontSize, tag: tagFontSize } = stateFontSizes(state, state.width);
  const textRows = [{ text: state.label, font: labelFontSize, y: isV2 ? 23 : 21 }];
  if (hasSub) textRows.push({ text: state.sublabel, font: sublabelFontSize, y: isV2 ? 40 : 37 });
  if (state.tag) textRows.push({ text: state.tag, font: tagFontSize, y: state.height - (isV2 ? 12 : 11) });
  const hasBrand = Boolean(brandMarkFor(state));
  const hasSource = Boolean(sourceEvidence?.nodes?.[state.id]?.length);
  const labelLayout = nodeLabelLayout({ width: state.width, height: state.height, rows: textRows,
    brand: hasBrand, source: hasSource, side: 'left', step: state.step });
  const sub = hasSub
    ? `\n          <text data-detail="context" x="${state.cx}" y="${state.y + labelLayout.ys[1]}" class="t-muted" font-size="${sublabelFontSize}" text-anchor="middle">${esc(state.sublabel)}</text>`
    : '';
  const tag = state.tag
    ? `\n        <text data-detail="fine" x="${state.cx}" y="${state.y + labelLayout.ys[hasSub ? 2 : 1]}" class="${accent}" font-size="${tagFontSize}" text-anchor="middle">${esc(state.tag)}</text>`
    : '';
  const step = state.step
    ? `\n        <text data-detail="fine" x="${state.x + 23}" y="${state.y + 14}" class="${accent}" font-size="${stateTextFit.step}" font-weight="700">${esc(state.step)}</text>`
    : '';
  const brand = renderBrandMark(state, { x: state.x + state.width - 22, y: state.y + 6 });
  // UML pseudo-state markers: start states get an initial dot + arrow into
  // the left border; states with no authored outgoing transition get a double
  // border. Both are decorations, not focus/relationship edges.
  const initialMarker = state.type === 'start'
    ? `\n          <g aria-hidden="true" data-lifecycle-initial-marker="">
            ${initialMarkerShape(state.x - 22, state.x - 1, state.cy)}
          </g>`
    : '';
  const finalBorder = isFinal(state)
    ? `\n          <rect x="${state.x + 3}" y="${state.y + 3}" width="${state.width - 6}" height="${state.height - 6}" rx="4" class="${fill}" style="fill: none" stroke-width="1"/>`
    : '';
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
          <rect x="${state.x}" y="${state.y}" width="${state.width}" height="${state.height}" rx="7" class="${fill}"${animateAttr(lifecycle.meta, 'node', stateSteps.get(state.id))} stroke-width="1.5"/>${finalBorder}${initialMarker}
          ${renderSemanticSigil(state.type, { icon: state.icon, x: state.x + 6, y: state.y + labelLayout.sigilY, size: labelLayout.sigilSize })}${brand ? `\n          ${brand}` : ''}${step}
          <text data-node-label=""${hasSub ? ' data-detail-anchor=""' : ''} x="${state.x + labelLayout.x}" y="${state.y + labelLayout.ys[0]}" class="t-primary" font-size="${labelFontSize}" font-weight="600" text-anchor="middle">${esc(state.label)}</text>${sub}${tag}
        </g>`;
}

// v2 replaces the implied phase rail with explicit topology: a forward
// transition between two main-lane states renders as the emphasized primary
// path unless the author chose another variant.
function effectiveVariant(transition) {
  if (transition.variant) return transition.variant;
  if (isV2) {
    const from = states.get(transition.from);
    const to = states.get(transition.to);
    if (from?.lane === 'main' && to?.lane === 'main' && to.col > from.col) return 'emphasis';
  }
  return 'default';
}

function renderTransitionPath(transition, index) {
  const variant = effectiveVariant(transition);
  const [cls, marker] = arrowClassMap[variant] || arrowClassMap.default;
  const routed = pathFor(transition);
  const strokeWidth = transition.width || (variant === 'emphasis' ? (isV2 ? 1.6 : 2) : 1.1);
  const automaticRoute = plannerRouted(transition);
  const crossover = automaticRoute ? ' data-composition-crossover="halo"' : '';
  const edge = `        <path ${focusEdgeAttrs(transition.from, transition.to, transition.label || transition.note, index, transition.id)} data-composition-points="${routePointsValue(routed.points)}"${crossover}${authoredStraightRouteAttrs(transition, routed.points)} d="${routed.d}" class="${cls}"${animateAttr(lifecycle.meta, 'edge', index)} stroke-width="${strokeWidth}" marker-end="url(#${marker})"/>`;
  if (!automaticRoute) return edge;
  // Same presentation-only wrapper as architecture: the mask underlay lets two
  // planner routes cross legibly while the viewer still sees one semantic edge.
  const underlay = `          <path data-graph-role="automatic-crossover-underlay" d="${routed.d}" fill="none" stroke="var(--mask)" stroke-width="${strokeWidth + 4}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>\n`;
  return `        <g data-graph-role="automatic-crossover" style="--step:${index}">\n${underlay}${edge.replace(/^        /, '          ')}\n        </g>`;
}

function renderTransitionLabel(transition, index) {
  if (!(transition.label || transition.note)) return '';
  const { lx, ly, width: labelW, height: labelH } = transitionLabelBox(transition);
  const label = transition.label
    ? `\n          <text x="${lx}" y="${ly}" class="${edgeLabelAccent(effectiveVariant(transition))}" font-size="8" text-anchor="middle">${esc(transition.label)}</text>`
    : '';
  const note = transition.note
    ? `\n        <text data-detail="fine" x="${lx}" y="${ly + (transition.label ? 11 : 0)}" class="t-dim" font-size="7" text-anchor="middle">${esc(transition.note)}</text>`
    : '';
  return `        <g data-detail="${transition.label ? 'context' : 'fine'}" ${focusEdgeAttrs(transition.from, transition.to, transition.label || transition.note, index, transition.id)}>
          <rect x="${lx - labelW / 2}" y="${ly - 11}" width="${labelW}" height="${labelH}" rx="4" class="c-mask"/>${label}${note}
        </g>`;
}

// UML initial pseudo-state: a filled dot and a short arrow ending at `tipX`.
function initialMarkerShape(dotX, tipX, y) {
  return `<circle cx="${dotX}" cy="${y}" r="4.5" style="fill: var(--arrow-emphasis)"/><path d="M ${dotX + 4.5} ${y} L ${tipX - 6} ${y}" class="a-emphasis" stroke-width="1.4"/><path d="M ${tipX - 7} ${y - 3.5} L ${tipX} ${y} L ${tipX - 7} ${y + 3.5} Z" style="fill: var(--arrow-emphasis)"/>`;
}

function renderSwatch(entry) {
  // `start` is structural, not a color: its swatch is the same initial
  // pseudo-state marker drawn on the canvas. `final` is a non-interactive
  // structural entry (a double-border rect) appended when a final state exists.
  if (entry.kind === 'start') {
    return initialMarkerShape(entry.x + 4.5, entry.x + 24, entry.baseline - 3.5);
  }
  if (entry.kind === 'final') {
    return `<rect x="${entry.x}" y="${entry.baseline - 8}" width="14" height="9" rx="2" class="c-external" stroke-width="1"/><rect x="${entry.x + 2.5}" y="${entry.baseline - 5.5}" width="9" height="4" rx="1" class="c-external" style="fill: none" stroke-width="0.8"/>`;
  }
  return `<rect x="${entry.x}" y="${entry.baseline - 8}" width="14" height="9" rx="2" class="${typeClass[entry.kind] || 'c-external'}" stroke-width="1"/>`;
}

function renderLegend() {
  return renderResolvedLegend({
    entries: resolvedLegendEntries,
    locale: lifecycle.meta.locale,
    layout: {
      x: 40,
      baselineY: legendY(),
      width: viewBox[0] - 80,
      minTitleY: lifecycleAreaBottom() + 8,
      unfit: lifecycle.meta?.legend === undefined ? 'hide' : 'error',
      diagramType: 'lifecycle',
    },
    renderSwatch,
  });
}

// v1 only: the implied emphasis line behind main states. v2 topology is fully
// explicit, so the rail would double the authored forward transitions.
function renderLifecycleRail() {
  if (isV2) return '';
  const mainCols = [...states.values()]
    .filter((state) => bandFor(state.lane) === 'phase')
    .map((state) => state.col);
  if (!mainCols.length) return '';
  const railEnd = layout.phaseXs[mainCols.reduce((max, col) => Math.max(max, col))] + 38;
  return `        <path data-lifecycle-rail="" d="M 154 ${layout.phaseY + 31} L ${railEnd} ${layout.phaseY + 31}" class="a-emphasis" stroke-width="2.2" marker-end="url(#arrowhead-emphasis)"/>`;
}

function renderSvg() {
  // A renderer-sized canvas declares the intrinsic-height fit exactly like
  // architecture: the default 980x660 band layout is below the 1.55 wide
  // ratio, so without this the desktop Reader could neither narrow it nor
  // scroll it and every default lifecycle failed the browser gate.
  const readerFit = lifecycle.meta?.viewBox ? '' : ' data-reader-fit="intrinsic-height"';
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}"${readerFit} ${svgRootAttrs(lifecycle.meta)}>
${svgAccessibleText(lifecycle.meta, 'lifecycle')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Lifecycle bands -->
${renderBands()}

        <!-- Primary lifecycle rail -->
${renderLifecycleRail()}

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

validateLifecycle();
writeDiagram({
  outPath,
  template,
  diagramType: 'lifecycle',
  meta: lifecycle.meta,
  svg: renderSvg(),
  cards: lifecycle.cards,
  sourceEvidence,
});
