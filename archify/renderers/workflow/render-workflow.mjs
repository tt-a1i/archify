import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderCards, applyTemplate } from '../shared/utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '../..');
const repoRoot = path.resolve(skillRoot, '..');
const inputPath = path.resolve(process.argv[2] || path.join(skillRoot, 'examples/agent-tool-call.workflow.json'));
const workflow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const templatePath = path.join(skillRoot, 'assets/template.html');
const template = fs.readFileSync(templatePath, 'utf8');

const outPath = path.resolve(process.cwd(), process.argv[3] || workflow.meta.output || 'workflow.html');

const viewBox = workflow.meta.viewBox || [1000, 720];
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

const typeClass = {
  frontend: 'c-frontend',
  backend: 'c-backend',
  database: 'c-database',
  cloud: 'c-cloud',
  security: 'c-security',
  messagebus: 'c-messagebus',
  external: 'c-external'
};

const textClass = {
  frontend: 't-frontend',
  backend: 't-backend',
  database: 't-database',
  cloud: 't-cloud',
  security: 't-security',
  messagebus: 't-messagebus',
  external: 't-external'
};

const arrowClass = {
  default: ['a-default', 'arrowhead'],
  emphasis: ['a-emphasis', 'arrowhead-emphasis'],
  security: ['a-security', 'arrowhead-security'],
  dashed: ['a-dashed', 'arrowhead-dashed']
};

const laneIndex = new Map(workflow.lanes.map((lane, index) => [lane.id, index]));

function laneTop(id) {
  return layout.laneY + laneIndex.get(id) * (layout.laneH + layout.laneGap);
}

function lastLaneBottom() {
  return layout.laneY + workflow.lanes.length * layout.laneH + (workflow.lanes.length - 1) * layout.laneGap;
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

const nodes = new Map(workflow.nodes.map((node) => [node.id, measureNode(node)]));

function rectsOverlap(a, b, gap = 0) {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

function validateWorkflow() {
  const problems = [];
  if (workflow.schema_version !== 1) {
    problems.push('Workflow files must set "schema_version": 1.');
  }
  if (workflow.diagram_type && workflow.diagram_type !== 'workflow') {
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
  if (problems.length) {
    throw new Error(`Workflow layout validation failed:\n- ${problems.join('\n- ')}`);
  }

  const laneIds = new Set(workflow.lanes.map((lane) => lane.id));
  if (laneIds.size !== workflow.lanes.length) {
    problems.push('Lane ids must be unique.');
  }
  if (nodes.size !== workflow.nodes.length) {
    problems.push('Node ids must be unique.');
  }

  for (const node of nodes.values()) {
    if (!laneIds.has(node.lane)) {
      problems.push(`Node "${node.id}" uses unknown lane "${node.lane}".`);
      continue;
    }
    if (node.col < 0 || node.col >= layout.colXs.length) {
      problems.push(`Node "${node.id}" uses column ${node.col}, but only ${layout.colXs.length} columns exist.`);
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

  const byLane = new Map();
  for (const node of nodes.values()) {
    byLane.set(node.lane, [...(byLane.get(node.lane) || []), node]);
  }
  for (const [lane, laneNodes] of byLane) {
    for (let i = 0; i < laneNodes.length; i += 1) {
      for (let j = i + 1; j < laneNodes.length; j += 1) {
        if (rectsOverlap(laneNodes[i], laneNodes[j], 8)) {
          problems.push(`Nodes "${laneNodes[i].id}" and "${laneNodes[j].id}" are too close in lane "${lane}".`);
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
          problems.push(`Edge "${edge.from}" -> "${edge.to}" is too short (${Math.round(segmentLength)}px).`);
        }
      }
    }
  }

  if (legendY() + 18 > viewBox[1]) {
    problems.push(`Legend exceeds viewBox height ${viewBox[1]}.`);
  }

  if (problems.length) {
    throw new Error(`Workflow layout validation failed:\n- ${problems.join('\n- ')}`);
  }
}

function anchor(node, side) {
  switch (side || 'auto') {
    case 'left': return [node.x, node.cy];
    case 'right': return [node.x + node.width, node.cy];
    case 'top': return [node.cx, node.y];
    case 'bottom': return [node.cx, node.y + node.height];
    default:
      return [node.x + node.width, node.cy];
  }
}

function defaultTargetSide(from, to) {
  if (to.cx < from.cx) return 'right';
  if (to.cx > from.cx) return 'left';
  if (to.cy > from.cy) return 'top';
  return 'bottom';
}

function defaultFromSide(from, to) {
  if (to.cx < from.cx) return 'left';
  if (to.cx > from.cx) return 'right';
  if (to.cy > from.cy) return 'bottom';
  return 'top';
}

function pathFor(edge) {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  const start = anchor(from, edge.fromSide || defaultFromSide(from, to));
  const end = anchor(to, edge.toSide || defaultTargetSide(from, to));
  const points = [start, ...routeVia(edge, from, to, start, end), end];
  return {
    d: points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' '),
    points
  };
}

function gapYBetween(fromLane, toLane, bias = 0.5) {
  const a = laneTop(fromLane) + layout.laneH;
  const b = laneTop(toLane);
  return a + (b - a) * bias;
}

function routeVia(edge, from, to, start, end) {
  if (edge.via) return edge.via;
  switch (edge.route || 'auto') {
    case 'straight':
      return [];
    case 'drop': {
      const y = gapYBetween(from.lane, to.lane, edge.bias || 0.5);
      return [[start[0], y], [end[0], y]];
    }
    case 'drop-right': {
      const y = gapYBetween(from.lane, to.lane, edge.bias || 0.5);
      return [[start[0], y], [end[0], y]];
    }
    case 'drop-left': {
      const y = gapYBetween(from.lane, to.lane, edge.bias || 0.5);
      return [[start[0], y], [end[0], y]];
    }
    case 'same-lane':
      return [];
    case 'outside-right': {
      const x = edge.channelX || layout.laneX + layout.laneW + 12;
      return [[x, start[1]], [x, end[1]]];
    }
    case 'return-left': {
      const x = edge.channelX || Math.min(from.x, to.x) - 28;
      return [[x, start[1]], [x, end[1]]];
    }
    case 'bottom-channel': {
      const y = edge.channelY || Math.max(from.y + from.height, to.y + to.height) + 32;
      return [[start[0], y], [end[0], y]];
    }
    case 'up-channel': {
      const y = edge.channelY || Math.min(from.y, to.y) - 28;
      return [[start[0], y], [end[0], y]];
    }
    case 'auto':
    default: {
      if (from.lane === to.lane) return [];
      const y = gapYBetween(from.lane, to.lane, edge.bias || 0.5);
      return [[start[0], y], [end[0], y]];
    }
  }
}

function labelPoint(edge, points) {
  if (edge.labelAt) return edge.labelAt;
  if (points.length === 2) {
    return [
      (points[0][0] + points[1][0]) / 2 + (edge.labelDx || 0),
      points[0][1] - 10 + (edge.labelDy || 0)
    ];
  }
  const segmentIndex = Math.min(points.length - 2, Math.max(0, edge.labelSegment ?? 1));
  const a = points[segmentIndex];
  const b = points[segmentIndex + 1];
  return [(a[0] + b[0]) / 2 + (edge.labelDx || 0), (a[1] + b[1]) / 2 - 10 + (edge.labelDy || 0)];
}

function renderLane(lane, index) {
  const y = layout.laneY + index * (layout.laneH + layout.laneGap);
  return `        <rect x="${layout.laneX}" y="${y}" width="${layout.laneW}" height="${layout.laneH}" rx="10" class="c-lane" stroke-width="1"/>
        <text x="${layout.laneX + 14}" y="${y + 22}" class="t-dim" font-size="10" font-weight="600">${String(index + 1).padStart(2, '0')} / ${esc(lane.label)}</text>`;
}

function renderNode(node) {
  const fill = typeClass[node.type] || 'c-external';
  const accent = textClass[node.type] || 't-muted';
  const tag = node.tag
    ? `\n        <text x="${node.cx}" y="${node.y + node.height - 12}" class="${accent}" font-size="7" text-anchor="middle">${esc(node.tag)}</text>`
    : '';
  return `        <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="c-mask"/>
        <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="${fill}" stroke-width="1.5"/>
        <text x="${node.cx}" y="${node.y + 21}" class="t-primary" font-size="11" font-weight="600" text-anchor="middle">${esc(node.label)}</text>
        <text x="${node.cx}" y="${node.y + 38}" class="t-muted" font-size="8" text-anchor="middle">${esc(node.sublabel || '')}</text>${tag}`;
}

function edgeAccent(edge) {
  return edge.variant === 'security'
    ? 't-security'
    : edge.variant === 'emphasis'
      ? 't-backend'
      : edge.variant === 'dashed'
        ? 't-database'
        : 't-muted';
}

function renderEdgePath(edge) {
  const [cls, marker] = arrowClass[edge.variant || 'default'] || arrowClass.default;
  const routed = pathFor(edge);
  const strokeWidth = edge.width || (edge.variant === 'emphasis' ? 1.8 : 1.4);
  return `        <path d="${routed.d}" class="${cls}" stroke-width="${strokeWidth}" marker-end="url(#${marker})"/>`;
}

function renderEdgeLabel(edge) {
  if (!edge.label) return '';
  const routed = pathFor(edge);
  const [lx, ly] = labelPoint(edge, routed.points);
  const labelW = Math.max(30, edge.label.length * 4.8 + 10);
  return `        <rect x="${lx - labelW / 2}" y="${ly - 10}" width="${labelW}" height="14" rx="3" class="c-mask"/>
        <text x="${lx}" y="${ly}" class="${edgeAccent(edge)}" font-size="8" text-anchor="middle">${esc(edge.label)}</text>`;
}

function renderLegend() {
  const y = legendY();
  return `        <text x="175" y="${y - 20}" class="t-primary" font-size="10" font-weight="600">Legend</text>
        <rect x="175" y="${y - 8}" width="14" height="9" rx="2" class="c-frontend" stroke-width="1"/>
        <text x="195" y="${y}" class="t-muted" font-size="7">User UI</text>
        <rect x="260" y="${y - 8}" width="14" height="9" rx="2" class="c-backend" stroke-width="1"/>
        <text x="280" y="${y}" class="t-muted" font-size="7">Agent logic</text>
        <rect x="370" y="${y - 8}" width="14" height="9" rx="2" class="c-security" stroke-width="1"/>
        <text x="390" y="${y}" class="t-muted" font-size="7">Policy</text>
        <rect x="455" y="${y - 8}" width="14" height="9" rx="2" class="c-messagebus" stroke-width="1"/>
        <text x="475" y="${y}" class="t-muted" font-size="7">Tool action</text>
        <rect x="565" y="${y - 8}" width="14" height="9" rx="2" class="c-database" stroke-width="1"/>
        <text x="585" y="${y}" class="t-muted" font-size="7">Context / trace</text>`;
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}">
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Swimlanes -->
${workflow.lanes.map(renderLane).join('\n\n')}

        <!-- Edge paths -->
${workflow.edges.map(renderEdgePath).join('\n')}

        <!-- Nodes -->
${[...nodes.values()].map(renderNode).join('\n\n')}

        <!-- Edge labels -->
${workflow.edges.map(renderEdgeLabel).join('\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}


fs.mkdirSync(path.dirname(outPath), { recursive: true });
validateWorkflow();
fs.writeFileSync(outPath, applyTemplate(template, {
  title: workflow.meta.title,
  subtitle: workflow.meta.subtitle,
  footer: 'Workflow diagram &bull; Built with Archify &bull; Press <kbd>T</kbd> for theme and <kbd>E</kbd> for export',
  svg: renderSvg(),
  cards: renderCards(workflow.cards),
}));
console.log(outPath);
