import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagram, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import {
  asArray,
  isFinitePoint,
  rectsOverlap,
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
  roundedPath,
  routePointsValue,
  labelPoint,
  arrowClassMap,
  variantAccent
} from '../shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: lifecycle, template, outPath, sourceCapsule } = loadDiagram({
  rendererDir: __dirname,
  diagramType: 'lifecycle',
  defaultExample: 'agent-run.lifecycle.json'
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
  return viewBox[1] - 98;
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
const laneLabels = new Map(asArray(lifecycle.lanes).map((lane) => [lane.id, lane.label]));
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
  if (lifecycle.schema_version !== 1) problems.push('Lifecycle files must set "schema_version": 1.');
  if (lifecycle.diagram_type !== 'lifecycle') problems.push('Lifecycle files must set "diagram_type": "lifecycle".');
  if (!lifecycle.meta?.title) problems.push('Lifecycle files must include meta.title.');
  if (!Array.isArray(lifecycle.lanes) || lifecycle.lanes.length < 1) problems.push('Lifecycle diagrams need at least one lane.');
  if (!Array.isArray(lifecycle.states) || lifecycle.states.length < 2) problems.push('Lifecycle diagrams need at least two states.');
  if (!Array.isArray(lifecycle.transitions)) problems.push('Lifecycle diagrams must include a transitions array.');
  if (lifecycle.cards !== undefined && !Array.isArray(lifecycle.cards)) problems.push('Lifecycle "cards" must be an array.');
  if (states.size !== asArray(lifecycle.states).length) problems.push('State ids must be unique.');

  // The three bands are fixed at y=112/264/436; the legend (viewBox[1] - 98)
  // must clear the outcome band's header zone.
  if (legendY() - 20 < 448) {
    problems.push(`viewBox height ${viewBox[1]} is too short for the fixed band layout — set meta.viewBox[1] to at least 566.`);
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
    if (state.y < 64 || state.y + state.height > legendY() - 24) {
      problems.push(`State "${state.id}" exceeds the vertical lifecycle area — keep y between 64 and ${legendY() - 24} (adjust yOffset or increase meta.viewBox[1]).`);
    }
    const estLabelW = textUnits(state.label) * 6.2;
    if (estLabelW > state.width + 6) {
      problems.push(`Label "${state.label}" (~${Math.round(estLabelW)}px) is wider than state "${state.id}" (${state.width}px) — shorten the label, move detail to sublabel, or increase state.width.`);
    }
  }

  // All non-main/non-terminal lanes share the same y band, so the overlap
  // check must run across lanes — not per-lane.
  const allStates = [...states.values()];
  for (let i = 0; i < allStates.length; i += 1) {
    for (let j = i + 1; j < allStates.length; j += 1) {
      if (rectsOverlap(allStates[i], allStates[j], 10)) {
        problems.push(`States "${allStates[i].id}" and "${allStates[j].id}" are less than 10px apart — move one to another col or separate them with yOffset (lanes other than "main"/"terminal" share one band).`);
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

  problems.push(...cleanFlowProblems({
    relations: lifecycle.transitions,
    endpointIds: new Set(states.keys()),
    obstacles: states.values(),
    pathFor,
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
    obstacleKind: 'state',
    profile: lifecycle.meta?.quality_profile,
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
        problems.push(`Label "${rect.label}" overlaps state "${state.id}" — adjust labelDx/labelDy/labelSegment or set labelAt.\n${suggestLabelObstacleFix(rect, rect.lx, rect.ly, state, 'state')}`);
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

  if (problems.length) {
    throw new Error(`Lifecycle layout validation failed:\n- ${problems.join('\n- ')}`);
  }
}

function routeVia(transition, from, to, start, end) {
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
      if (from.lane === to.lane) return [];
      const y = transition.channelY ?? (start[1] + end[1]) / 2;
      return [[start[0], y], [end[0], y]];
    }
  }
}

const pathCache = new Map();
const automaticPorts = automaticPortSpread(lifecycle.transitions, states);

function pathFor(transition) {
  if (pathCache.has(transition)) return pathCache.get(transition);
  const from = states.get(transition.from);
  const to = states.get(transition.to);
  const ports = automaticPorts.get(transition);
  const start = ports?.from || anchor(from, chosenSide(transition.fromSide, defaultFromSide(from, to)));
  const end = ports?.to || anchor(to, chosenSide(transition.toSide, defaultToSide(from, to)));
  let via = routeVia(transition, from, to, start, end);
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
    ? `\n          <text data-detail="context" x="${state.cx}" y="${state.y + 37}" class="t-muted" font-size="7" text-anchor="middle">${esc(state.sublabel)}</text>`
    : '';
  const tag = state.tag
    ? `\n        <text data-detail="fine" x="${state.cx}" y="${state.y + state.height - 11}" class="${accent}" font-size="7" text-anchor="middle">${esc(state.tag)}</text>`
    : '';
  const step = state.step
    ? `\n        <text data-detail="fine" x="${state.x + 10}" y="${state.y + 14}" class="${accent}" font-size="7" font-weight="700">${esc(state.step)}</text>`
    : '';
  const passport = { kind: state.type, sublabel: state.sublabel, tag: state.tag, context: laneLabels.get(state.lane) || 'Lifecycle state' };
  return `        <g ${focusNodeAttrs(state.id, state.label, passport)}>
          ${focusNodeTitle(state.label, passport)}
          <rect x="${state.x}" y="${state.y}" width="${state.width}" height="${state.height}" rx="7" class="c-mask"/>
          <rect x="${state.x}" y="${state.y}" width="${state.width}" height="${state.height}" rx="7" class="${fill}"${animateAttr(lifecycle.meta, 'node', stateSteps.get(state.id))} stroke-width="1.5"/>
          ${renderSemanticSigil(state.type, { x: state.x + state.width - 17, y: state.y + 6 })}${step}
          <text${hasSub ? ' data-detail-anchor' : ''} x="${state.cx}" y="${state.y + 21}" class="t-primary" font-size="10" font-weight="600" text-anchor="middle">${esc(state.label)}</text>${sub}${tag}
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

function renderLegend() {
  const y = legendY();
  return `        <g data-legend-bridge>
          <text x="220" y="${y - 20}" class="t-primary" font-size="10" font-weight="600">Legend</text>
        <g data-legend-kind="active">
          <rect x="220" y="${y - 8}" width="14" height="9" rx="2" class="c-backend" stroke-width="1"/>
          <text x="240" y="${y}" class="t-muted" font-size="7">active state</text>
        </g>
        <g data-legend-kind="waiting">
          <rect x="325" y="${y - 8}" width="14" height="9" rx="2" class="c-cloud" stroke-width="1"/>
          <text x="345" y="${y}" class="t-muted" font-size="7">waiting</text>
        </g>
        <g data-legend-kind="success">
          <rect x="415" y="${y - 8}" width="14" height="9" rx="2" class="c-database" stroke-width="1"/>
          <text x="435" y="${y}" class="t-muted" font-size="7">terminal success</text>
        </g>
        <g data-legend-kind="failure">
          <rect x="560" y="${y - 8}" width="14" height="9" rx="2" class="c-security" stroke-width="1"/>
          <text x="580" y="${y}" class="t-muted" font-size="7">failure / exit</text>
        </g>
        </g>`;
}

function renderLifecycleRail() {
  const mainCols = [...states.values()]
    .filter((state) => bandFor(state.lane) === 'phase')
    .map((state) => state.col);
  if (!mainCols.length) return '';
  const railEnd = layout.phaseXs[Math.max(...mainCols)] + 38;
  return `        <path d="M 154 ${layout.phaseY + 31} L ${railEnd} ${layout.phaseY + 31}" class="a-emphasis" stroke-width="2.2" marker-end="url(#arrowhead-emphasis)"/>`;
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(lifecycle.meta, 'lifecycle diagram')}>
${svgAccessibleText(lifecycle.meta, 'lifecycle diagram')}
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
  footerLabel: 'Lifecycle diagram',
  svg: renderSvg(),
  cards: lifecycle.cards,
  sourceCapsule,
});
