import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '../..');
const inputPath = path.resolve(process.argv[2] || path.join(skillRoot, 'examples/agent-run.lifecycle.json'));
const lifecycle = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const templatePath = path.join(skillRoot, 'assets/template.html');
const template = fs.readFileSync(templatePath, 'utf8');
const outPath = path.resolve(process.cwd(), process.argv[3] || lifecycle.meta.output || 'lifecycle.html');

const viewBox = lifecycle.meta.viewBox || [980, 720];
const layout = {
  laneX: 32,
  laneY: 44,
  laneW: 914,
  laneGap: 14,
  laneTitleH: 20,
  laneH: 112,
  colXs: [96, 246, 396, 546, 696, 846],
  nodeW: 112,
  nodeH: 56
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

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

const laneIndex = new Map((lifecycle.lanes || []).map((lane, index) => [lane.id, index]));

function laneTop(id) {
  return layout.laneY + laneIndex.get(id) * (layout.laneH + layout.laneGap);
}

function lastLaneBottom() {
  return layout.laneY + lifecycle.lanes.length * layout.laneH + (lifecycle.lanes.length - 1) * layout.laneGap;
}

function legendY() {
  return lastLaneBottom() + 44;
}

function measureState(state) {
  const width = state.width || layout.nodeW;
  const height = state.height || layout.nodeH;
  const cx = layout.colXs[state.col];
  const contentH = layout.laneH - layout.laneTitleH;
  const y = laneTop(state.lane) + layout.laneTitleH + (contentH - height) / 2 + (state.yOffset || 0);
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
    if (typeof state.col !== 'number' || state.col < 0 || state.col >= layout.colXs.length) {
      problems.push(`State "${state.id}" uses invalid column ${state.col}.`);
    }
    const top = laneTop(state.lane);
    const contentTop = top + layout.laneTitleH;
    if (state.x < layout.laneX || state.x + state.width > layout.laneX + layout.laneW) {
      problems.push(`State "${state.id}" exceeds the horizontal bounds of lane "${state.lane}".`);
    }
    if (state.y < contentTop || state.y + state.height > top + layout.laneH) {
      problems.push(`State "${state.id}" collides with the title or boundary of lane "${state.lane}".`);
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

function gapYBetween(fromLane, toLane, bias = 0.5) {
  const a = laneTop(fromLane) + layout.laneH;
  const b = laneTop(toLane);
  return a + (b - a) * bias;
}

function routeVia(transition, from, to, start, end) {
  if (transition.via) return transition.via;
  switch (transition.route || 'auto') {
    case 'straight':
      return [];
    case 'drop': {
      const y = gapYBetween(from.lane, to.lane, transition.bias || 0.5);
      return [[start[0], y], [end[0], y]];
    }
    case 'raise': {
      const y = gapYBetween(to.lane, from.lane, transition.bias || 0.5);
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
      const y = gapYBetween(from.lane, to.lane, transition.bias || 0.5);
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
    d: points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' '),
    points
  };
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

function renderDefinitions() {
  return `        <!-- Definitions -->
        <defs>
          <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-default" />
          </marker>
          <marker id="arrowhead-emphasis" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-emphasis" />
          </marker>
          <marker id="arrowhead-security" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-security" />
          </marker>
          <marker id="arrowhead-dashed" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" class="m-dashed" />
          </marker>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" class="c-grid" stroke-width="0.5"/>
          </pattern>
        </defs>`;
}

function renderLane(lane, index) {
  const y = layout.laneY + index * (layout.laneH + layout.laneGap);
  return `        <path d="M ${layout.laneX} ${y + layout.laneTitleH} L ${layout.laneX + layout.laneW} ${y + layout.laneTitleH}" class="a-default" stroke-width="0.8" stroke-dasharray="3,8"/>
        <text x="${layout.laneX}" y="${y + 14}" class="t-dim" font-size="10" font-weight="600">${String(index + 1).padStart(2, '0')} / ${esc(lane.label)}</text>`;
}

function renderState(state) {
  const fill = typeClass[state.type] || typeClass.neutral;
  const accent = textClass[state.type] || 't-muted';
  const tag = state.tag
    ? `\n        <text x="${state.cx}" y="${state.y + state.height - 11}" class="${accent}" font-size="7" text-anchor="middle">${esc(state.tag)}</text>`
    : '';
  return `        <rect x="${state.x}" y="${state.y}" width="${state.width}" height="${state.height}" rx="6" class="c-mask"/>
        <rect x="${state.x}" y="${state.y}" width="${state.width}" height="${state.height}" rx="6" class="${fill}" stroke-width="1.5"/>
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
  const strokeWidth = transition.width || (transition.variant === 'emphasis' ? 1.8 : 1.4);
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
        <text x="580" y="${y}" class="t-muted" font-size="7">failure / gate</text>
        <path d="M 690 ${y} L 724 ${y}" class="a-dashed" stroke-width="1.4" marker-end="url(#arrowhead-dashed)"/>
        <text x="733" y="${y + 3}" class="t-muted" font-size="7">retry / async</text>`;
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}">
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Lifecycle lanes -->
${lifecycle.lanes.map(renderLane).join('\n\n')}

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

function renderCards() {
  const cards = lifecycle.cards || [];
  return `    <!-- Info Cards -->
    <div class="cards">
${cards.map((card) => `      <div class="card">
        <div class="card-header">
          <div class="card-dot ${esc(card.dot)}"></div>
          <h3>${esc(card.title)}</h3>
        </div>
        <ul>
${card.items.map((item) => `          <li>&bull; ${esc(item)}</li>`).join('\n')}
        </ul>
      </div>`).join('\n\n')}
    </div>`;
}

function applyTemplate(svg, cards) {
  return template
    .replace('<title>[PROJECT NAME] Architecture Diagram</title>', `<title>${esc(lifecycle.meta.title)} Diagram</title>`)
    .replace('<h1>[PROJECT NAME] Architecture</h1>', `<h1>${esc(lifecycle.meta.title)}</h1>`)
    .replace('<p class="subtitle">[Subtitle description]</p>', `<p class="subtitle">${esc(lifecycle.meta.subtitle || '')}</p>`)
    .replace(/      <svg viewBox="0 0 1000 680">[\s\S]*?      <\/svg>/, svg)
    .replace(/    <!-- Info Cards -->[\s\S]*?    <!-- Footer -->/, `${cards}\n\n    <!-- Footer -->`)
    .replace('[Project Name] &bull; [Additional metadata]', 'Lifecycle diagram &bull; Built with Archify &bull; Press <kbd>T</kbd> for theme and <kbd>E</kbd> for export');
}

validateLifecycle();
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, applyTemplate(renderSvg(), renderCards()));
console.log(outPath);
