import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '../..');
const inputPath = path.resolve(process.argv[2] || path.join(skillRoot, 'examples/product-analytics.dataflow.json'));
const dataflow = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

const templatePath = path.join(skillRoot, 'assets/template.html');
const template = fs.readFileSync(templatePath, 'utf8');
const outPath = path.resolve(process.cwd(), process.argv[3] || dataflow.meta.output || 'dataflow.html');

const viewBox = dataflow.meta.viewBox || [940, 720];
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

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

function stageX(index) {
  return layout.leftX + index * layout.colGap;
}

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

const nodes = new Map((dataflow.nodes || []).map((node) => [node.id, measureNode(node)]));

function rectsOverlap(a, b, gap = 0) {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

function validateDataflow() {
  const problems = [];
  if (dataflow.schema_version !== 1) problems.push('Data-flow files must set "schema_version": 1.');
  if (dataflow.diagram_type !== 'dataflow') problems.push('Data-flow files must set "diagram_type": "dataflow".');
  if (!dataflow.meta?.title) problems.push('Data-flow files must include meta.title.');
  if (!Array.isArray(dataflow.stages) || dataflow.stages.length < 2) {
    problems.push('Data-flow diagrams need at least two stages.');
  }
  if (!Array.isArray(dataflow.nodes) || dataflow.nodes.length < 2) {
    problems.push('Data-flow diagrams need at least two nodes.');
  }
  if (!Array.isArray(dataflow.flows)) problems.push('Data-flow diagrams must include a flows array.');
  if (nodes.size !== (dataflow.nodes || []).length) problems.push('Node ids must be unique.');

  for (const node of nodes.values()) {
    if (typeof node.stage !== 'number' || node.stage < 0 || node.stage >= dataflow.stages.length) {
      problems.push(`Node "${node.id}" uses invalid stage ${node.stage}.`);
    }
    if (typeof node.row !== 'number' || node.row < 0 || node.row >= layout.rowYs.length) {
      problems.push(`Node "${node.id}" uses invalid row ${node.row}.`);
    }
    if (node.x < 24 || node.x + node.width > viewBox[0] - 24) {
      problems.push(`Node "${node.id}" exceeds the horizontal bounds of the viewBox.`);
    }
    if (node.y < layout.stageY + layout.stageH + 22 || node.y + node.height > viewBox[1] - layout.stageBottomPad) {
      problems.push(`Node "${node.id}" exceeds the readable diagram area.`);
    }
  }

  for (let i = 0; i < dataflow.nodes.length; i += 1) {
    for (let j = i + 1; j < dataflow.nodes.length; j += 1) {
      const a = nodes.get(dataflow.nodes[i].id);
      const b = nodes.get(dataflow.nodes[j].id);
      if (rectsOverlap(a, b, 10)) {
        problems.push(`Nodes "${a.id}" and "${b.id}" are too close.`);
      }
    }
  }

  for (const flow of dataflow.flows || []) {
    if (!nodes.has(flow.from)) problems.push(`Flow "${flow.label || flow.from}" references unknown source "${flow.from}".`);
    if (!nodes.has(flow.to)) problems.push(`Flow "${flow.label || flow.to}" references unknown target "${flow.to}".`);
    if (!flow.label) problems.push(`Flow "${flow.from}" -> "${flow.to}" must include a short data label.`);
    if (nodes.has(flow.from) && nodes.has(flow.to)) {
      const routed = pathFor(flow);
      const [start, end] = [routed.points[0], routed.points[routed.points.length - 1]];
      const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (distance < 34) problems.push(`Flow "${flow.label}" is too short to read cleanly.`);
    }
  }

  const lastStageX = stageX((dataflow.stages || []).length - 1);
  if (lastStageX + layout.stageW / 2 > viewBox[0] - 24) problems.push('Stages exceed viewBox width.');

  if (problems.length) {
    throw new Error(`Data-flow layout validation failed:\n- ${problems.join('\n- ')}`);
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

function routeVia(flow, from, to, start, end) {
  if (flow.via) return flow.via;
  switch (flow.route || 'auto') {
    case 'straight':
      return [];
    case 'vertical-channel': {
      const x = flow.channelX || start[0] + (end[0] > start[0] ? 44 : -44);
      return [[x, start[1]], [x, end[1]]];
    }
    case 'bottom-channel': {
      const y = flow.channelY || Math.max(from.y + from.height, to.y + to.height) + 26;
      return [[start[0], y], [end[0], y]];
    }
    case 'top-channel': {
      const y = flow.channelY || Math.min(from.y, to.y) - 24;
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

function pathFor(flow) {
  const from = nodes.get(flow.from);
  const to = nodes.get(flow.to);
  const start = anchor(from, flow.fromSide || defaultFromSide(from, to));
  const end = anchor(to, flow.toSide || defaultToSide(from, to));
  const points = [start, ...routeVia(flow, from, to, start, end), end];
  return {
    d: points.map(([x, y], index) => `${index === 0 ? 'M' : 'L'} ${x} ${y}`).join(' '),
    points
  };
}

function labelPoint(flow, points) {
  if (flow.labelAt) return flow.labelAt;
  if (points.length === 2) {
    return [
      (points[0][0] + points[1][0]) / 2 + (flow.labelDx || 0),
      points[0][1] - 10 + (flow.labelDy || 0)
    ];
  }
  const segmentIndex = Math.min(points.length - 2, Math.max(0, flow.labelSegment ?? 1));
  const a = points[segmentIndex];
  const b = points[segmentIndex + 1];
  return [(a[0] + b[0]) / 2 + (flow.labelDx || 0), (a[1] + b[1]) / 2 - 10 + (flow.labelDy || 0)];
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

function renderStage(stage, index) {
  const cx = stageX(index);
  const x = cx - layout.stageW / 2;
  const h = viewBox[1] - layout.stageY - layout.stageBottomPad;
  return `        <rect x="${x}" y="${layout.stageY}" width="${layout.stageW}" height="${h}" rx="10" class="c-lane" stroke-width="1"/>
        <text x="${cx}" y="${layout.stageY + 22}" class="t-dim" font-size="9" font-weight="600" text-anchor="middle">${String(index + 1).padStart(2, '0')} / ${esc(stage.label)}</text>`;
}

function renderNode(node) {
  const fill = typeClass[node.type] || 'c-external';
  const accent = textClass[node.type] || 't-muted';
  const tag = node.tag
    ? `\n        <text x="${node.cx}" y="${node.y + node.height - 11}" class="${accent}" font-size="7" text-anchor="middle">${esc(node.tag)}</text>`
    : '';
  return `        <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="c-mask"/>
        <rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" class="${fill}" stroke-width="1.5"/>
        <text x="${node.cx}" y="${node.y + 21}" class="t-primary" font-size="10" font-weight="600" text-anchor="middle">${esc(node.label)}</text>
        <text x="${node.cx}" y="${node.y + 37}" class="t-muted" font-size="7" text-anchor="middle">${esc(node.sublabel || '')}</text>${tag}`;
}

function flowAccent(flow) {
  return flow.variant === 'security'
    ? 't-security'
    : flow.variant === 'emphasis'
      ? 't-backend'
      : flow.variant === 'dashed'
        ? 't-messagebus'
        : 't-muted';
}

function renderFlowPath(flow) {
  const [cls, marker] = arrowClass[flow.variant || 'default'] || arrowClass.default;
  const routed = pathFor(flow);
  const strokeWidth = flow.width || (flow.variant === 'emphasis' ? 1.8 : 1.4);
  return `        <path d="${routed.d}" class="${cls}" stroke-width="${strokeWidth}" marker-end="url(#${marker})"/>`;
}

function renderFlowLabel(flow) {
  const routed = pathFor(flow);
  const [lx, ly] = labelPoint(flow, routed.points);
  const longestLine = Math.max(flow.label.length, (flow.classification || '').length);
  const labelW = Math.max(34, longestLine * 4.9 + 12);
  const classification = flow.classification
    ? `\n        <text x="${lx}" y="${ly + 11}" class="t-dim" font-size="7" text-anchor="middle">${esc(flow.classification)}</text>`
    : '';
  const labelH = flow.classification ? 27 : layout.labelH;
  return `        <rect x="${lx - labelW / 2}" y="${ly - 11}" width="${labelW}" height="${labelH}" rx="4" class="c-mask"/>
        <text x="${lx}" y="${ly}" class="${flowAccent(flow)}" font-size="8" text-anchor="middle">${esc(flow.label)}</text>${classification}`;
}

function renderLegend() {
  const y = viewBox[1] - 36;
  return `        <text x="214" y="${y - 20}" class="t-primary" font-size="10" font-weight="600">Legend</text>
        <path d="M 214 ${y} L 248 ${y}" class="a-emphasis" stroke-width="1.8" marker-end="url(#arrowhead-emphasis)"/>
        <text x="257" y="${y + 3}" class="t-muted" font-size="8">primary data</text>
        <path d="M 340 ${y} L 374 ${y}" class="a-security" stroke-width="1.4" marker-end="url(#arrowhead-security)"/>
        <text x="383" y="${y + 3}" class="t-muted" font-size="8">policy / PII</text>
        <path d="M 480 ${y} L 514 ${y}" class="a-dashed" stroke-width="1.4" marker-end="url(#arrowhead-dashed)"/>
        <text x="523" y="${y + 3}" class="t-muted" font-size="8">async batch</text>
        <rect x="625" y="${y - 8}" width="14" height="9" rx="2" class="c-database" stroke-width="1"/>
        <text x="646" y="${y}" class="t-muted" font-size="8">data store</text>`;
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}">
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Data Stages -->
${dataflow.stages.map(renderStage).join('\n\n')}

        <!-- Flow paths -->
${(dataflow.flows || []).map(renderFlowPath).join('\n')}

        <!-- Nodes -->
${[...nodes.values()].map(renderNode).join('\n\n')}

        <!-- Flow labels -->
${(dataflow.flows || []).map(renderFlowLabel).join('\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}

function renderCards() {
  const cards = dataflow.cards || [];
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
    .replace('<title>[PROJECT NAME] Architecture Diagram</title>', `<title>${esc(dataflow.meta.title)} Diagram</title>`)
    .replace('<h1>[PROJECT NAME] Architecture</h1>', `<h1>${esc(dataflow.meta.title)}</h1>`)
    .replace('<p class="subtitle">[Subtitle description]</p>', `<p class="subtitle">${esc(dataflow.meta.subtitle || '')}</p>`)
    .replace(/      <svg viewBox="0 0 1000 680">[\s\S]*?      <\/svg>/, svg)
    .replace(/    <!-- Info Cards -->[\s\S]*?    <!-- Footer -->/, `${cards}\n\n    <!-- Footer -->`)
    .replace('[Project Name] &bull; [Additional metadata]', 'Data-flow diagram &bull; Built with Archify &bull; Press <kbd>T</kbd> for theme and <kbd>E</kbd> for export');
}

validateDataflow();
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, applyTemplate(renderSvg(), renderCards()));
console.log(outPath);
