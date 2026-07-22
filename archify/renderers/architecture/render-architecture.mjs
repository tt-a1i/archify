import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagram, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { componentBox, boundaryBox, connectionPath } from '../shared/layout-report.mjs';
import { gridLayout, resolveComponentPos, validateGridPlacement } from './grid.mjs';
import {
  asArray,
  isFinitePoint,
  rectsOverlap,
  segmentIntersectsRect,
  cleanFlowProblems,
  cleanCrossingProblems,
  cleanAmbiguousCorridorProblems,
  cleanBorderRunProblems,
  cleanRouteRhythmProblems,
  suggestLabelObstacleFix,
  suggestComponentSeparation,
  anchor,
  defaultFromSide,
  defaultToSide,
  chosenSide,
  polylinePath,
  routePointsValue,
  roundedPath,
  labelPoint,
  componentFill,
  componentText,
  arrowClassMap,
  variantAccent,
} from '../shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: arch, template, outPath } = loadDiagram({
  rendererDir: __dirname,
  diagramType: 'architecture',
  defaultExample: 'web-app.architecture.json',
  argv: cliArgs,
});

const grid = gridLayout(arch);

const layout = {
  defaultW: 120,
  defaultH: 60,
  margin: 40,
  // Boundary padding — the 30/50 rule that was a hand-arithmetic footgun
  // (CHANGELOG v2.2.1): 30px on top/left/right, plus 20px extra at the bottom.
  boundaryPad: 30,
  boundaryExtraBottom: 20,
  legendH: 28,
};

// ---- Measure components from free coordinates --------------------------------
function measureComponent(c) {
  const [x, y] = resolveComponentPos(c, grid);
  const [w, h] = Array.isArray(c.size) ? c.size : [layout.defaultW, layout.defaultH];
  return { ...c, x, y, width: w, height: h, cx: x + w / 2, cy: y + h / 2 };
}

const components = new Map(asArray(arch.components).map((c) => [c.id, measureComponent(c)]));
const componentSteps = new Map();
for (const [index, conn] of asArray(arch.connections).entries()) {
  if (!componentSteps.has(conn.from)) componentSteps.set(conn.from, index);
  if (!componentSteps.has(conn.to)) componentSteps.set(conn.to, index + 1);
}
for (const [index, c] of asArray(arch.components).entries()) {
  if (!componentSteps.has(c.id)) componentSteps.set(c.id, index);
}

// ---- Boundaries computed from the `wraps` id list ---------------------------
function boundaryRect(boundary) {
  const members = asArray(boundary.wraps).map((id) => components.get(id)).filter(Boolean);
  if (!members.length) return null;
  const minX = Math.min(...members.map((m) => m.x));
  const minY = Math.min(...members.map((m) => m.y));
  const maxX = Math.max(...members.map((m) => m.x + m.width));
  const maxY = Math.max(...members.map((m) => m.y + m.height));
  const pad = boundary.pad ?? layout.boundaryPad;
  return {
    ...boundary,
    x: minX - pad,
    y: minY - pad,
    width: maxX - minX + pad * 2,
    height: maxY - minY + pad + layout.boundaryExtraBottom,
  };
}

const boundaries = asArray(arch.boundaries).map(boundaryRect).filter(Boolean);
const compositionFrames = boundaries.map((boundary, index) => ({
  ...boundary,
  id: boundary.id || index,
  kind: boundary.kind || 'boundary',
  radius: boundary.kind === 'security-group' ? 8 : 12,
}));

function componentContext(component) {
  const scopes = boundaries
    .filter((boundary) => asArray(boundary.wraps).includes(component.id))
    .sort((a, b) => (b.width * b.height) - (a.width * a.height))
    .map((boundary) => boundary.label);
  return scopes.length ? scopes.join(' › ') : 'Architecture component';
}

// ---- Auto viewBox: fit all geometry + a legend row --------------------------
function autoViewBox() {
  let maxX = 0;
  let maxY = 0;
  for (const c of components.values()) {
    maxX = Math.max(maxX, c.x + c.width);
    maxY = Math.max(maxY, c.y + c.height);
  }
  for (const b of boundaries) {
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return [
    Math.ceil(maxX + layout.margin),
    Math.ceil(maxY + layout.margin + layout.legendH),
  ];
}

const viewBox = arch.meta?.viewBox || autoViewBox();
const legendY = () => viewBox[1] - 16;

// ---- Validation: mechanical correctness, never layout taste -----------------
function validateArchitecture() {
  const problems = [];
  if (arch.schema_version !== 1) problems.push('Architecture files must set "schema_version": 1.');
  if (arch.diagram_type !== 'architecture') problems.push('Architecture files must set "diagram_type": "architecture".');
  if (!arch.meta?.title) problems.push('Architecture files must include meta.title.');
  if (!Array.isArray(arch.components) || arch.components.length < 1) {
    problems.push('Architecture diagrams need at least one component.');
  }
  if (arch.connections !== undefined && !Array.isArray(arch.connections)) problems.push('Architecture "connections" must be an array.');
  if (arch.boundaries !== undefined && !Array.isArray(arch.boundaries)) problems.push('Architecture "boundaries" must be an array.');
  if (arch.cards !== undefined && !Array.isArray(arch.cards)) problems.push('Architecture "cards" must be an array.');
  if (components.size !== asArray(arch.components).length) problems.push('Component ids must be unique.');
  if (grid) {
    validateGridPlacement(arch, grid, problems);
  } else {
    for (const c of asArray(arch.components)) {
      if (!Array.isArray(c.pos) || c.pos.length !== 2) {
        problems.push(`Component "${c.id}" must include pos [x, y] when layout.mode is omitted (free placement).`);
      }
    }
  }

  for (const c of components.values()) {
    if (!isFinitePoint(c.x, c.y, c.width, c.height)) {
      problems.push(`Component "${c.id}" has non-finite pos/size — pos and size must be [number, number].`);
      continue;
    }
    if (c.width <= 0 || c.height <= 0) {
      problems.push(`Component "${c.id}" has invalid size ${c.width}x${c.height} — width and height must be greater than 0.`);
      continue;
    }
    if (c.x < 0 || c.y < 0 || c.x + c.width > viewBox[0] || c.y + c.height > viewBox[1]) {
      problems.push(`Component "${c.id}" falls outside the viewBox ${viewBox[0]}x${viewBox[1]} — adjust pos/size or set a larger meta.viewBox.`);
    }
    const estLabelW = textUnits(c.label) * 6.6;
    if (estLabelW > c.width + 8) {
      problems.push(`Label "${c.label}" (~${Math.round(estLabelW)}px) is wider than component "${c.id}" (${c.width}px) — shorten the label, move detail to sublabel, or widen size.`);
    }
  }

  // Component overlap — the highest-traffic hand-placement failure mode.
  const list = [...components.values()];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      if (rectsOverlap(list[i], list[j], 8)) {
        problems.push(`Components "${list[i].id}" and "${list[j].id}" are less than 8px apart — move one or shrink its size.\n${suggestComponentSeparation(list[i], list[j], 8)}`);
      }
    }
  }

  // Boundaries: every wrapped id must exist; the computed box must stay in view.
  for (const boundary of asArray(arch.boundaries)) {
    for (const id of asArray(boundary.wraps)) {
      if (!components.has(id)) problems.push(`Boundary "${boundary.label}" wraps unknown component "${id}".`);
    }
  }
  for (const b of boundaries) {
    if (b.x < 0 || b.y < 0 || b.x + b.width > viewBox[0] || b.y + b.height > viewBox[1]) {
      problems.push(`Boundary "${b.label}" extends outside the viewBox — its members sit too close to the canvas edge; add margin or enlarge meta.viewBox.`);
    }
  }

  for (const conn of asArray(arch.connections)) {
    if (!components.has(conn.from)) problems.push(`Connection "${conn.label || conn.from}" references unknown source "${conn.from}".`);
    if (!components.has(conn.to)) problems.push(`Connection "${conn.label || conn.to}" references unknown target "${conn.to}".`);
    if (components.has(conn.from) && components.has(conn.to)) {
      const routed = pathFor(conn);
      const [start, end] = [routed.points[0], routed.points[routed.points.length - 1]];
      const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (distance < 24) problems.push(`Connection "${conn.label || `${conn.from}->${conn.to}`}" is too short (${Math.round(distance)}px; minimum 24px) — place its components farther apart.`);
    }
  }

  problems.push(...cleanFlowProblems({
    relations: arch.connections,
    endpointIds: new Set(components.keys()),
    obstacles: components.values(),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    obstacleKind: 'component',
    profile: arch.meta?.quality_profile,
    routeHint: 'adjust fromSide/toSide, set route/via, or move the component'
  }));
  problems.push(...cleanCrossingProblems({
    relations: arch.connections,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
    routeHint: 'adjust route/via or fromSide/toSide so the connections use separate corridors'
  }));
  problems.push(...cleanAmbiguousCorridorProblems({
    relations: arch.connections,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
    routeHint: 'adjust route/via or fromSide/toSide so unrelated connections do not visually merge'
  }));
  problems.push(...cleanBorderRunProblems({
    relations: arch.connections,
    endpointIds: new Set(components.keys()),
    frames: compositionFrames,
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
    routeHint: 'adjust route/via or fromSide/toSide so the connection crosses the boundary perpendicularly instead of following its border'
  }));
  problems.push(...cleanRouteRhythmProblems({
    relations: arch.connections,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'architecture',
    relationCollection: 'connections',
    profile: arch.meta?.quality_profile,
    routeHint: 'move route/via points into a wider corridor or move the component so every turn has room to read'
  }));

  // Connection labels must not land on top of components.
  const labelRects = [];
  for (const conn of asArray(arch.connections)) {
    if (!conn.label || !components.has(conn.from) || !components.has(conn.to)) continue;
    const [lx, ly] = labelPoint(conn, pathFor(conn).points);
    const w = Math.max(30, textUnits(conn.label) * 4.8 + 10);
    labelRects.push({ label: conn.label, x: lx - w / 2, y: ly - 10, width: w, height: 14, lx, ly });
  }
  for (const rect of labelRects) {
    for (const c of components.values()) {
      if (rectsOverlap(rect, c, -2)) {
        problems.push(`Label "${rect.label}" overlaps component "${c.id}" — adjust labelDx/labelDy/labelSegment or set labelAt.\n${suggestLabelObstacleFix(rect, rect.lx, rect.ly, c)}`);
      }
    }
  }

  if (problems.length) {
    throw new Error(`Architecture layout validation failed:\n- ${problems.join('\n- ')}`);
  }
}

function buildLayoutReport() {
  const labels = [];
  for (const conn of asArray(arch.connections)) {
    if (!conn.label || !components.has(conn.from) || !components.has(conn.to)) continue;
    const [lx, ly] = labelPoint(conn, pathFor(conn).points);
    const w = Math.max(30, textUnits(conn.label) * 4.8 + 10);
    labels.push({
      text: conn.label,
      x: Math.round(lx - w / 2),
      y: Math.round(ly - 10),
      width: Math.round(w),
      height: 14,
      labelAt: [Math.round(lx), Math.round(ly)],
    });
  }
  return {
    ok: true,
    diagram_type: 'architecture',
    layout: grid ? { mode: 'grid', ...grid } : { mode: 'free' },
    viewBox,
    components: [...components.values()].map(componentBox),
    boundaries: boundaries.map(boundaryBox),
    connections: asArray(arch.connections)
      .filter((conn) => components.has(conn.from) && components.has(conn.to))
      .map((conn) => {
        const routed = pathFor(conn);
        const labelAt = conn.label ? labelPoint(conn, routed.points) : null;
        return connectionPath(conn, routed, labelAt);
      }),
    labels,
  };
}

// ---- Connection routing ------------------------------------------------------
function routeClearsComponents(conn, points, clearance = 2) {
  const endpointIds = new Set([conn.from, conn.to]);
  for (const component of components.values()) {
    if (endpointIds.has(component.id)) continue;
    for (let index = 0; index < points.length - 1; index += 1) {
      if (segmentIntersectsRect({ start: points[index], end: points[index + 1] }, component, clearance)) {
        return false;
      }
    }
  }
  return true;
}

function routeVia(conn, from, to, start, end) {
  if (conn.via) return conn.via;
  switch (conn.route || 'auto') {
    case 'straight':
      return [];
    case 'orthogonal-h': {
      const midX = (start[0] + end[0]) / 2;
      return [[midX, start[1]], [midX, end[1]]];
    }
    case 'orthogonal-v': {
      const midY = (start[1] + end[1]) / 2;
      return [[start[0], midY], [end[0], midY]];
    }
    case 'auto':
    default: {
      // Direct line unless the anchors are clearly orthogonal-friendly.
      if (Math.abs(start[0] - end[0]) < 4 || Math.abs(start[1] - end[1]) < 4) return [];
      const midX = (start[0] + end[0]) / 2;
      const horizontalFirst = [[midX, start[1]], [midX, end[1]]];
      if (routeClearsComponents(conn, [start, ...horizontalFirst, end])) return horizontalFirst;

      // The only fallback is the complementary in-bounds dogleg. Both
      // candidates stay between the authored anchors, preserve two bends, and
      // remain deterministic. If neither is safe, keep the original route so
      // the universal Clean Flow gate returns the actionable hard failure.
      const midY = (start[1] + end[1]) / 2;
      const verticalFirst = [[start[0], midY], [end[0], midY]];
      if (routeClearsComponents(conn, [start, ...verticalFirst, end])) return verticalFirst;
      return horizontalFirst;
    }
  }
}

const pathCache = new Map();
function pathFor(conn) {
  if (pathCache.has(conn)) return pathCache.get(conn);
  const from = components.get(conn.from);
  const to = components.get(conn.to);
  const start = anchor(from, chosenSide(conn.fromSide, defaultFromSide(from, to)));
  const end = anchor(to, chosenSide(conn.toSide, defaultToSide(from, to)));
  const points = [start, ...routeVia(conn, from, to, start, end), end];
  const routed = { d: roundedPath(points, 8), points };
  pathCache.set(conn, routed);
  return routed;
}

// ---- Rendering ---------------------------------------------------------------
function renderBoundary(b, index) {
  const cls = b.kind === 'security-group' ? 'c-security-group' : 'c-region';
  const labelCls = b.kind === 'security-group' ? 't-security' : 't-cloud';
  const rx = b.kind === 'security-group' ? 8 : 12;
  return `        <rect data-graph-role="structural-frame" data-composition-frame-kind="${esc(b.kind || 'boundary')}" data-composition-frame-id="${index}" x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${rx}" class="${cls}" stroke-width="1"/>
        <text x="${b.x + 8}" y="${b.y + 18}" class="${labelCls}" font-size="9" font-weight="600">${esc(b.label)}</text>`;
}

function renderConnectionPath(conn, index) {
  const [cls, marker] = arrowClassMap[conn.variant || 'default'] || arrowClassMap.default;
  const routed = pathFor(conn);
  const strokeWidth = conn.width || (conn.variant === 'emphasis' ? 1.8 : 1.5);
  return `        <path ${focusEdgeAttrs(conn.from, conn.to, conn.label, index, conn.id)} data-composition-points="${routePointsValue(routed.points)}" d="${routed.d}" class="${cls}"${animateAttr(arch.meta, 'edge', index)} stroke-width="${strokeWidth}" marker-end="url(#${marker})"/>`;
}

function renderConnectionLabel(conn, index) {
  if (!conn.label) return '';
  const [lx, ly] = labelPoint(conn, pathFor(conn).points);
  const w = Math.max(30, textUnits(conn.label) * 4.8 + 10);
  return `        <g data-detail="context" ${focusEdgeAttrs(conn.from, conn.to, conn.label, index, conn.id)}>
          <rect x="${lx - w / 2}" y="${ly - 10}" width="${w}" height="14" rx="3" class="c-mask"/>
          <text x="${lx}" y="${ly}" class="${variantAccent(conn.variant)}" font-size="8" text-anchor="middle">${esc(conn.label)}</text>
        </g>`;
}

function renderComponent(c) {
  const fill = componentFill[c.type] || 'c-external';
  const accent = componentText[c.type] || 't-muted';
  const cx = c.cx;
  const hasSub = c.sublabel != null && c.sublabel !== '';
  const labelY = hasSub ? c.y + c.height / 2 - 2 : c.y + c.height / 2 + 4;
  const sub = hasSub
    ? `\n        <text data-detail="context" x="${cx}" y="${c.y + c.height / 2 + 14}" class="t-muted" font-size="9" text-anchor="middle">${esc(c.sublabel)}</text>`
    : '';
  const tag = c.tag
    ? `\n        <text data-detail="fine" x="${cx}" y="${c.y + c.height - 8}" class="${accent}" font-size="7" text-anchor="middle">${esc(c.tag)}</text>`
    : '';
  const passport = { kind: c.type, sublabel: c.sublabel, tag: c.tag, context: componentContext(c) };
  return `        <g ${focusNodeAttrs(c.id, c.label, passport)}>
          ${focusNodeTitle(c.label, passport)}
          <rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="6" class="c-mask"/>
          <rect x="${c.x}" y="${c.y}" width="${c.width}" height="${c.height}" rx="6" class="${fill}"${animateAttr(arch.meta, 'node', componentSteps.get(c.id))} stroke-width="1.5"/>
          ${renderSemanticSigil(c.type, { x: c.x + 6, y: c.y + 6 })}
          <text${hasSub ? ' data-detail-anchor' : ''} x="${cx}" y="${labelY}" class="t-primary" font-size="11" font-weight="600" text-anchor="middle">${esc(c.label)}</text>${sub}${tag}
        </g>`;
}

// Auto legend: one swatch per component type actually used, left to right.
const TYPE_LABELS = {
  frontend: 'Frontend', backend: 'Backend', database: 'Database', cloud: 'Cloud',
  security: 'Security', messagebus: 'Message bus', external: 'External',
};
function renderLegend() {
  const used = [];
  const seen = new Set();
  for (const c of components.values()) {
    if (!seen.has(c.type)) { seen.add(c.type); used.push(c.type); }
  }
  const y = legendY();
  let x = layout.margin;
  const parts = ['        <g data-legend-bridge>',
    `          <text x="${x}" y="${y - 13}" class="t-primary" font-size="9" font-weight="600">Legend</text>`];
  for (const type of used) {
    parts.push(`          <g data-legend-kind="${esc(type)}">`);
    parts.push(`            <rect x="${x}" y="${y - 8}" width="14" height="9" rx="2" class="${componentFill[type] || 'c-external'}" stroke-width="1"/>`);
    parts.push(`            <text x="${x + 20}" y="${y}" class="t-muted" font-size="8">${TYPE_LABELS[type] || type}</text>`);
    parts.push('          </g>');
    x += 30 + (textUnits(TYPE_LABELS[type] || type) * 5 + 34);
  }
  parts.push('        </g>');
  return parts.join('\n');
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(arch.meta, 'architecture diagram')}>
${svgAccessibleText(arch.meta, 'architecture diagram')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Boundaries (behind everything) -->
${boundaries.map(renderBoundary).join('\n\n')}

        <!-- Connection paths (before components for correct z-order) -->
${asArray(arch.connections).map(renderConnectionPath).join('\n')}

        <!-- Components -->
${[...components.values()].map(renderComponent).join('\n\n')}

        <!-- Connection labels -->
${asArray(arch.connections).map(renderConnectionLabel).join('\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}

validateArchitecture();
if (layoutJsonMode) {
  console.log(JSON.stringify(buildLayoutReport(), null, 2));
  process.exit(0);
}
writeDiagram({
  outPath,
  template,
  diagramType: 'architecture',
  meta: arch.meta,
  footerLabel: 'Architecture diagram',
  svg: renderSvg(),
  cards: arch.cards,
});
