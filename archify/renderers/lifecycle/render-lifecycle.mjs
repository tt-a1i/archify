import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderCards, applyTemplate } from '../shared/utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '../..');
const inputPath = path.resolve(process.argv[2] || path.join(skillRoot, 'examples/agent-run.lifecycle.json'));
const lifecycle = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const templatePath = path.join(skillRoot, 'assets/template.html');
const template = fs.readFileSync(templatePath, 'utf8');
const outPath = path.resolve(process.cwd(), process.argv[3] || lifecycle.meta.output || 'lifecycle.html');

const viewBox = lifecycle.meta.viewBox || [980, 660];
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

const arrowClass = {
  default: ['a-default', 'arrowhead'],
  emphasis: ['a-emphasis', 'arrowhead-emphasis'],
  security: ['a-security', 'arrowhead-security'],
  dashed: ['a-dashed', 'arrowhead-dashed']
};

function legendY() {
  return 562;
}

function measureState(state) {
  const isPhase = state.lane === 'main';
  const isOutcome = state.lane === 'terminal';
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

const states = new Map((lifecycle.states || []).map((state) => [state.id, measureState(state)]));

function rectsOverlap(a, b, gap = 0) {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

function validateLifecycle() {
  const problems = [];
  if (lifecycle.schema_version !== 1) problems.push('Lifecycle files must set "schema_version": 1.');
  if (lifecycle.diagram_type !== 'lifecycle') problems.push('Lifecycle files must set "diagram_type": "lifecycle".');
  if (!lifecycle.meta?.title) problems.push('Lifecycle files must include meta.title.');
  if (!Array.isArray(lifecycle.lanes) || lifecycle.lanes.length < 1) problems.push('Lifecycle diagrams need at least one lane.');
  if (!Array.isArray(lifecycle.states) || lifecycle.states.length < 2) problems.push('Lifecycle diagrams need at least two states.');
  if (!Array.isArray(lifecycle.transitions)) problems.push('Lifecycle diagrams must include a transitions array.');
  if (states.size !== (lifecycle.states || []).length) problems.push('State ids must be unique.');

  const laneIds = new Set((lifecycle.lanes || []).map((lane) => lane.id));
  if (laneIds.size !== (lifecycle.lanes || []).length) problems.push('Lane ids must be unique.');

  for (const state of states.values()) {
    if (!laneIds.has(state.lane)) {
      problems.push(`State "${state.id}" uses unknown lane "${state.lane}".`);
      continue;
    }
    const maxCol = state.lane === 'main'
      ? layout.phaseXs.length
      : state.lane === 'terminal'
        ? layout.outcomeXs.length
        : layout.eventXs.length;
    if (typeof state.col !== 'number' || state.col < 0 || state.col >= maxCol) {
      problems.push(`State "${state.id}" uses invalid column ${state.col}.`);
    }
    if (state.x < 32 || state.x + state.width > viewBox[0] - 32) {
      problems.push(`State "${state.id}" exceeds the horizontal bounds of the diagram.`);
    }
    if (state.y < 64 || state.y + state.height > legendY() - 24) {
      problems.push(`State "${state.id}" exceeds the vertical lifecycle area.`);
    }
  }

  const byLane = new Map();
  for (const state of states.values()) {
    byLane.set(state.lane, [...(byLane.get(state.lane) || []), state]);
  }
  for (const [lane, laneStates] of byLane) {
    for (let i = 0; i < laneStates.length; i += 1) {
      for (let j = i + 1; j < laneStates.length; j += 1) {
        if (rectsOverlap(laneStates[i], laneStates[j], 10)) {
          problems.push(`States "${laneStates[i].id}" and "${laneStates[j].id}" are too close in lane "${lane}".`);
        }
      }
    }
  }

  for (const transition of lifecycle.transitions || []) {
    if (!states.has(transition.from)) problems.push(`Transition "${transition.label || transition.from}" references unknown source "${transition.from}".`);
    if (!states.has(transition.to)) problems.push(`Transition "${transition.label || transition.to}" references unknown target "${transition.to}".`);
    if (states.has(transition.from) && states.has(transition.to)) {
      const routed = pathFor(transition);
      const [start, end] = [routed.points[0], routed.points[routed.points.length - 1]];
      const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (distance < 32) problems.push(`Transition "${transition.label || `${transition.from}->${transition.to}`}" is too short.`);
    }
  }

  if (legendY() + 18 > viewBox[1]) problems.push(`Legend exceeds viewBox height ${viewBox[1]}.`);

  if (problems.length) {
    throw new Error(`Lifecycle layout validation failed:\n- ${problems.join('\n- ')}`);
  }
}

function anchor(state, side) {
  switch (side || 'auto') {
    case 'left': return [state.x, state.cy];
    case 'right': return [state.x + state.width, state.cy];
    case 'top': return [state.cx, state.y];
    case 'bottom': return [state.cx, state.y + state.height];
    default:
      return [state.x + state.width, state.cy];
  }
}

function defaultFromSide(from, to) {
  if (to.cx < from.cx) return 'left';
  if (to.cx > from.cx) return 'right';
  if (to.cy > from.cy) return 'bottom';
  return 'top';
}

function defaultToSide(from, to) {
  if (to.cx < from.cx) return 'right';
  if (to.cx > from.cx) return 'left';
  if (to.cy > from.cy) return 'top';
  return 'bottom';
}

function routeVia(transition, from, to, start, end) {
  if (transition.via) return transition.via;
  switch (transition.route || 'auto') {
    case 'straight':
      return [];
    case 'drop': {
      const y = transition.channelY || (start[1] + end[1]) / 2;
      return [[start[0], y], [end[0], y]];
    }
    case 'raise': {
      const y = transition.channelY || (start[1] + end[1]) / 2;
      return [[start[0], y], [end[0], y]];
    }
    case 'bottom-channel': {
      const y = transition.channelY || Math.max(from.y + from.height, to.y + to.height) + 34;
      return [[start[0], y], [end[0], y]];
    }
    case 'top-channel': {
      const y = transition.channelY || Math.min(from.y, to.y) - 28;
      return [[start[0], y], [end[0], y]];
    }
    case 'right-channel': {
      const x = transition.channelX || Math.max(from.x + from.width, to.x + to.width) + 36;
      return [[x, start[1]], [x, end[1]]];
    }
    case 'left-channel': {
      const x = transition.channelX || Math.min(from.x, to.x) - 36;
      return [[x, start[1]], [x, end[1]]];
    }
    case 'auto':
    default: {
      if (from.lane === to.lane) return [];
      const y = transition.channelY || (start[1] + end[1]) / 2;
      return [[start[0], y], [end[0], y]];
    }
  }
}

function pathFor(transition) {
  const from = states.get(transition.from);
  const to = states.get(transition.to);
  const start = anchor(from, transition.fromSide || defaultFromSide(from, to));
  const end = anchor(to, transition.toSide || defaultToSide(from, to));
  const points = [start, ...routeVia(transition, from, to, start, end), end];
  return {
    d: roundedPath(points, transition.cornerRadius ?? 10),
    points
  };
}

function roundedPath(points, radius) {
  if (points.length < 3 || radius <= 0) {
    return points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' ');
  }

  const commands = [`M ${points[0][0]} ${points[0][1]}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];
    const prevLen = Math.hypot(cx - px, cy - py);
    const nextLen = Math.hypot(nx - cx, ny - cy);
    const r = Math.min(radius, prevLen / 2, nextLen / 2);
    if (r < 1) {
      commands.push(`L ${cx} ${cy}`);
      continue;
    }
    const before = [cx - ((cx - px) / prevLen) * r, cy - ((cy - py) / prevLen) * r];
    const after = [cx + ((nx - cx) / nextLen) * r, cy + ((ny - cy) / nextLen) * r];
    commands.push(`L ${before[0]} ${before[1]}`);
    commands.push(`Q ${cx} ${cy} ${after[0]} ${after[1]}`);
  }
  const [endX, endY] = points[points.length - 1];
  commands.push(`L ${endX} ${endY}`);
  return commands.join(' ');
}

function labelPoint(transition, points) {
  if (transition.labelAt) return transition.labelAt;
  if (points.length === 2) {
    return [
      (points[0][0] + points[1][0]) / 2 + (transition.labelDx || 0),
      points[0][1] - 10 + (transition.labelDy || 0)
    ];
  }
  const segmentIndex = Math.min(points.length - 2, Math.max(0, transition.labelSegment ?? 1));
  const a = points[segmentIndex];
  const b = points[segmentIndex + 1];
  return [(a[0] + b[0]) / 2 + (transition.labelDx || 0), (a[1] + b[1]) / 2 - 10 + (transition.labelDy || 0)];
}

function renderBands() {
  return `        <path d="M 72 112 L 908 112" class="a-default" stroke-width="0.8" stroke-dasharray="3,8"/>
        <text x="72" y="100" class="t-dim" font-size="10" font-weight="600">01 / Lifecycle phases</text>
        <path d="M 72 264 L 908 264" class="a-default" stroke-width="0.8" stroke-dasharray="3,8"/>
        <text x="72" y="252" class="t-dim" font-size="10" font-weight="600">02 / Interruptions + recovery</text>
        <path d="M 72 436 L 908 436" class="a-default" stroke-width="0.8" stroke-dasharray="3,8"/>
        <text x="72" y="424" class="t-dim" font-size="10" font-weight="600">03 / Outcomes</text>`;
}

function renderState(state) {
  const fill = typeClass[state.type] || typeClass.neutral;
  const accent = textClass[state.type] || 't-muted';
  const tag = state.tag
    ? `\n        <text x="${state.cx}" y="${state.y + state.height - 11}" class="${accent}" font-size="7" text-anchor="middle">${esc(state.tag)}</text>`
    : '';
  const step = state.step
    ? `\n        <text x="${state.x + 10}" y="${state.y + 14}" class="${accent}" font-size="7" font-weight="700">${esc(state.step)}</text>`
    : '';
  return `        <rect x="${state.x}" y="${state.y}" width="${state.width}" height="${state.height}" rx="7" class="c-mask"/>
        <rect x="${state.x}" y="${state.y}" width="${state.width}" height="${state.height}" rx="7" class="${fill}" stroke-width="1.5"/>${step}
        <text x="${state.cx}" y="${state.y + 21}" class="t-primary" font-size="10" font-weight="600" text-anchor="middle">${esc(state.label)}</text>
        <text x="${state.cx}" y="${state.y + 37}" class="t-muted" font-size="7" text-anchor="middle">${esc(state.sublabel || '')}</text>${tag}`;
}

function transitionAccent(transition) {
  return transition.variant === 'security'
    ? 't-security'
    : transition.variant === 'emphasis'
      ? 't-backend'
      : transition.variant === 'dashed'
        ? 't-messagebus'
        : 't-muted';
}

function renderTransitionPath(transition) {
  const [cls, marker] = arrowClass[transition.variant || 'default'] || arrowClass.default;
  const routed = pathFor(transition);
  const strokeWidth = transition.width || (transition.variant === 'emphasis' ? 2 : 1.1);
  return `        <path d="${routed.d}" class="${cls}" stroke-width="${strokeWidth}" marker-end="url(#${marker})"/>`;
}

function renderTransitionLabel(transition) {
  if (!transition.label) return '';
  const routed = pathFor(transition);
  const [lx, ly] = labelPoint(transition, routed.points);
  const longestLine = Math.max(transition.label.length, (transition.note || '').length);
  const labelW = Math.max(32, longestLine * 4.9 + 12);
  const labelH = transition.note ? 27 : 16;
  const note = transition.note
    ? `\n        <text x="${lx}" y="${ly + 11}" class="t-dim" font-size="7" text-anchor="middle">${esc(transition.note)}</text>`
    : '';
  return `        <rect x="${lx - labelW / 2}" y="${ly - 11}" width="${labelW}" height="${labelH}" rx="4" class="c-mask"/>
        <text x="${lx}" y="${ly}" class="${transitionAccent(transition)}" font-size="8" text-anchor="middle">${esc(transition.label)}</text>${note}`;
}

function renderLegend() {
  const y = legendY();
  return `        <text x="220" y="${y - 20}" class="t-primary" font-size="10" font-weight="600">Legend</text>
        <rect x="220" y="${y - 8}" width="14" height="9" rx="2" class="c-backend" stroke-width="1"/>
        <text x="240" y="${y}" class="t-muted" font-size="7">active state</text>
        <rect x="325" y="${y - 8}" width="14" height="9" rx="2" class="c-cloud" stroke-width="1"/>
        <text x="345" y="${y}" class="t-muted" font-size="7">waiting</text>
        <rect x="415" y="${y - 8}" width="14" height="9" rx="2" class="c-database" stroke-width="1"/>
        <text x="435" y="${y}" class="t-muted" font-size="7">terminal success</text>
        <rect x="560" y="${y - 8}" width="14" height="9" rx="2" class="c-security" stroke-width="1"/>
        <text x="580" y="${y}" class="t-muted" font-size="7">failure / exit</text>`;
}

function renderLifecycleRail() {
  return `        <path d="M 154 ${layout.phaseY + 31} L 748 ${layout.phaseY + 31}" class="a-emphasis" stroke-width="2.2" marker-end="url(#arrowhead-emphasis)"/>`;
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}">
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Lifecycle bands -->
${renderBands()}

        <!-- Primary lifecycle rail -->
${renderLifecycleRail()}

        <!-- Transition paths -->
${(lifecycle.transitions || []).map(renderTransitionPath).join('\n')}

        <!-- States -->
${[...states.values()].map(renderState).join('\n\n')}

        <!-- Transition labels -->
${(lifecycle.transitions || []).map(renderTransitionLabel).join('\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}

validateLifecycle();
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, applyTemplate(template, {
  title: lifecycle.meta.title,
  subtitle: lifecycle.meta.subtitle,
  footer: 'Lifecycle diagram &bull; Built with Archify &bull; Press <kbd>T</kbd> for theme and <kbd>E</kbd> for export',
  svg: renderSvg(),
  cards: renderCards(lifecycle.cards),
}));
console.log(outPath);
