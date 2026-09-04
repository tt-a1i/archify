import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagramWithBrandMarks, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import {
  asArray,
  isFinitePoint,
  rectsOverlap,
  segmentIntersectsRect,
  cleanEndpointSideProblems,
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
  automaticPortRhythmBridge,
  defaultFromSide,
  defaultToSide,
  chosenSide,
  roundedPath,
  normalizeRoutePoints,
  routeHonorsEndpointSides,
  routePointsValue,
  labelPoint,
} from '../shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: erd, template, outPath, sourceEvidence } = await loadDiagramWithBrandMarks({
  rendererDir: __dirname,
  diagramType: 'erd',
  defaultExample: 'billing.erd.json',
});

const entities = asArray(erd.entities);
const connections = asArray(erd.relationships);

// ---------------------------------------------------------------------------
// Entity geometry
// ---------------------------------------------------------------------------
const HEADER_H = 28;
const ROW_H = 18;
const PAD_Y = 6;

const entityFill = {
  transactional: 'c-backend',
  reference: 'c-database',
  event: 'c-messagebus',
  junction: 'c-security',
  external: 'c-external',
};
const entityText = {
  transactional: 't-backend',
  reference: 't-database',
  event: 't-messagebus',
  junction: 't-security',
  external: 't-external',
};

function entityWidth(e) {
  const labelUnits = textUnits(e.label || e.id);
  let attrUnits = 5;
  for (const a of (e.attributes || [])) {
    attrUnits = Math.max(attrUnits, 5 + textUnits(a.name) + (a.role === 'foreign' || a.role === 'primary' ? 2 : 0));
  }
  const units = Math.max(labelUnits, attrUnits);
  return Math.max(140, units * 7 + 30);
}

function entityHeight(e) {
  const rows = (e.attributes && e.attributes.length) ? e.attributes.length : 1;
  return HEADER_H + rows * ROW_H + PAD_Y;
}

// Geometry helpers (anchor, port spreading, obstacle avoidance) address a rect
// through x/y/width/height plus the cx/cy centre. Both must stay in sync:
// a missing centre silently degrades every routed path to NaN coordinates.
function placeEntity(e, x, y) {
  const rect = components.get(e.id);
  rect.x = x;
  rect.y = y;
  rect.cx = x + rect.width / 2;
  rect.cy = y + rect.height / 2;
}

const components = new Map();
for (const e of entities) {
  const width = e.size ? e.size[0] : (e.width ?? entityWidth(e));
  const height = e.size ? e.size[1] : (e.height ?? entityHeight(e));
  components.set(e.id, { ...e, width, height, x: 0, y: 0, cx: 0, cy: 0 });
}

// Positions are authored per entity: preserve every explicit pos, grid only
// entities that omit it. Never rewrite authored geometry because one peer
// omitted its position (typed/manual-layout contract).
const missingPosition = [];
for (const e of entities) {
  if (Array.isArray(e.pos) && e.pos.length === 2) {
    placeEntity(e, e.pos[0], e.pos[1]);
  } else {
    missingPosition.push(e);
  }
}
if (missingPosition.length) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(entities.length)));
  const cellW = 240;
  const cellH = 170;
  let slot = 0;
  const occupied = new Set(entities.filter((e) => Array.isArray(e.pos) && e.pos.length === 2).map((e) => `${e.pos[0]},${e.pos[1]}`));
  for (const e of missingPosition) {
    let x;
    let y;
    do {
      x = 40 + (slot % cols) * cellW;
      y = 40 + Math.floor(slot / cols) * cellH;
      slot += 1;
    } while (occupied.has(`${x},${y}`));
    occupied.add(`${x},${y}`);
    placeEntity(e, x, y);
  }
}

// ---------------------------------------------------------------------------
// Routing engine (adapted from the architecture renderer)
// ---------------------------------------------------------------------------
const pathCache = new Map();
const automaticPorts = automaticPortSpread(connections, components);

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

function routeClearsEndpointComponents(points, from, to) {
  const lastSegment = points.length - 2;
  for (let index = 0; index <= lastSegment; index += 1) {
    const segment = { start: points[index], end: points[index + 1] };
    if (index > 0 && segmentIntersectsRect(segment, from)) return false;
    if (index < lastSegment && segmentIntersectsRect(segment, to)) return false;
  }
  return true;
}

const OUTWARD_SIDE_VECTOR = {
  left: [-1, 0],
  right: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
};

function outwardStub(point, side, distance = 24) {
  const [dx, dy] = OUTWARD_SIDE_VECTOR[side] || [0, 0];
  return [point[0] + dx * distance, point[1] + dy * distance];
}

function collinearBacktrack(a, b, c) {
  const first = [b[0] - a[0], b[1] - a[1]];
  const second = [c[0] - b[0], c[1] - b[1]];
  const cross = first[0] * second[1] - first[1] * second[0];
  const dot = first[0] * second[0] + first[1] * second[1];
  return Math.abs(cross) <= 0.0001 && dot < -0.0001;
}

function sideAwareBridgeCandidates(start, end, fromSide, toSide) {
  const startStub = outwardStub(start, fromSide);
  const endStub = outwardStub(end, toSide);
  const rawCandidates = [];
  const minimumBridge = 16;
  const verticalSides = new Set(['top', 'bottom']);
  const horizontalSides = new Set(['left', 'right']);

  if (verticalSides.has(fromSide) && verticalSides.has(toSide)
      && Math.abs(start[0] - end[0]) < minimumBridge) {
    for (const channelX of [
      Math.max(start[0], end[0]) + minimumBridge,
      Math.min(start[0], end[0]) - minimumBridge,
    ]) {
      rawCandidates.push([
        startStub,
        [channelX, startStub[1]],
        [channelX, endStub[1]],
        endStub,
      ]);
    }
  }
  if (horizontalSides.has(fromSide) && horizontalSides.has(toSide)
      && Math.abs(start[1] - end[1]) < minimumBridge) {
    for (const channelY of [
      Math.max(start[1], end[1]) + minimumBridge,
      Math.min(start[1], end[1]) - minimumBridge,
    ]) {
      rawCandidates.push([
        startStub,
        [startStub[0], channelY],
        [endStub[0], channelY],
        endStub,
      ]);
    }
  }

  rawCandidates.push(
    [startStub, [endStub[0], startStub[1]], endStub],
    [startStub, [startStub[0], endStub[1]], endStub],
  );
  return rawCandidates.map((candidate) => normalizeRoutePoints([start, ...candidate, end]))
    .filter((points) => points.length >= 2)
    .filter((points) => !collinearBacktrack(points[0], points[1], points[2] || points[1]))
    .filter((points) => !collinearBacktrack(points.at(-3) || points.at(-2), points.at(-2), points.at(-1)))
    .filter((points) => routeHonorsEndpointSides(points, fromSide, toSide))
    .map((points) => points.slice(1, -1));
}

const AUTOMATIC_PORT_CORNER_GUTTER = 16;
const AUTOMATIC_PORT_ALIGNMENT_DELTA = 16;

function portHasCornerClearance(rect, side, point) {
  if (side === 'left' || side === 'right') {
    const inset = Math.min(AUTOMATIC_PORT_CORNER_GUTTER, rect.height / 2);
    return point[1] >= rect.y + inset && point[1] <= rect.y + rect.height - inset;
  }
  if (side === 'top' || side === 'bottom') {
    const inset = Math.min(AUTOMATIC_PORT_CORNER_GUTTER, rect.width / 2);
    return point[0] >= rect.x + inset && point[0] <= rect.x + rect.width - inset;
  }
  return false;
}

function alignFacingPorts(conn, from, to, start, end, fromSide, toSide, ports) {
  const hasExplicitGeometry = (
    conn.via
    || (conn.route && conn.route !== 'auto')
    || conn.channelX !== undefined
    || conn.channelY !== undefined
    || conn.labelAt
  );
  const horizontallyFacing = (
    (fromSide === 'right' && toSide === 'left')
    || (fromSide === 'left' && toSide === 'right')
  );
  const verticallyFacing = (
    (fromSide === 'bottom' && toSide === 'top')
    || (fromSide === 'top' && toSide === 'bottom')
  );
  if (hasExplicitGeometry || (!horizontallyFacing && !verticallyFacing)) return { start, end };

  const fromSpread = Boolean(ports?.from);
  const toSpread = Boolean(ports?.to);
  if (fromSpread && toSpread) return { start, end };
  const hasExplicitSides = (
    (conn.fromSide && conn.fromSide !== 'auto')
    || (conn.toSide && conn.toSide !== 'auto')
  );
  if (!fromSpread && !toSpread && hasExplicitSides) return { start, end };

  const alignmentDelta = horizontallyFacing
    ? Math.abs(start[1] - end[1])
    : Math.abs(start[0] - end[0]);
  if (alignmentDelta >= AUTOMATIC_PORT_ALIGNMENT_DELTA) return { start, end };

  const alignEndToStart = horizontallyFacing
    ? { start, end: [end[0], start[1]] }
    : { start, end: [start[0], end[1]] };
  const alignStartToEnd = horizontallyFacing
    ? { start: [start[0], end[1]], end }
    : { start: [end[0], start[1]], end };
  const candidates = fromSpread
    ? [alignEndToStart]
    : toSpread
      ? [alignStartToEnd]
      : [alignEndToStart, alignStartToEnd];
  for (const candidate of candidates) {
    const points = [candidate.start, candidate.end];
    if (portHasCornerClearance(from, fromSide, candidate.start)
        && portHasCornerClearance(to, toSide, candidate.end)
        && routeHonorsEndpointSides(points, fromSide, toSide)
        && routeClearsEndpointComponents(points, from, to)
        && routeClearsComponents(conn, points)) {
      return candidate;
    }
  }
  return { start, end };
}

function routeVia(conn, from, to, start, end, fromSide, toSide) {
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
      const deltaX = Math.abs(start[0] - end[0]);
      const deltaY = Math.abs(start[1] - end[1]);
      if ((deltaX < 4 || deltaY < 4) && routeHonorsEndpointSides([start, end], fromSide, toSide)) return [];

      const rhythmBridge = automaticPortRhythmBridge(start, end, fromSide, toSide, {
        accept: (points) => (
          routeClearsEndpointComponents(points, from, to)
          && routeClearsComponents(conn, points)
        ),
      });
      if (rhythmBridge) return rhythmBridge.slice(1, -1);

      const minimumStub = 8;
      const fromVerticalSide = start[1] === from.y || start[1] === from.y + from.height;
      const toVerticalSide = end[1] === to.y || end[1] === to.y + to.height;
      if (fromVerticalSide && toVerticalSide && deltaX < minimumStub * 2) {
        const outsideChannels = [
          Math.max(start[0], end[0]) + minimumStub * 2,
          Math.min(start[0], end[0]) - minimumStub * 2,
        ];
        for (const channelX of outsideChannels) {
          const candidate = [[channelX, start[1]], [channelX, end[1]]];
          const points = [start, ...candidate, end];
          if (routeHonorsEndpointSides(points, fromSide, toSide) && routeClearsComponents(conn, points)) return candidate;
        }
      }

      const fromHorizontalSide = start[0] === from.x || start[0] === from.x + from.width;
      const toHorizontalSide = end[0] === to.x || end[0] === to.x + to.width;
      if (fromHorizontalSide && toHorizontalSide && deltaY < minimumStub * 2) {
        const outsideChannels = [
          Math.max(start[1], end[1]) + minimumStub * 2,
          Math.min(start[1], end[1]) - minimumStub * 2,
        ];
        for (const channelY of outsideChannels) {
          const candidate = [[start[0], channelY], [end[0], channelY]];
          const points = [start, ...candidate, end];
          if (routeHonorsEndpointSides(points, fromSide, toSide) && routeClearsComponents(conn, points)) return candidate;
        }
      }

      const midX = (start[0] + end[0]) / 2;
      const horizontalFirst = [[midX, start[1]], [midX, end[1]]];
      const midY = (start[1] + end[1]) / 2;
      const verticalFirst = [[start[0], midY], [end[0], midY]];
      const candidates = [horizontalFirst, verticalFirst];
      const sideSafe = candidates.filter((candidate) => (
        routeHonorsEndpointSides([start, ...candidate, end], fromSide, toSide)
      ));
      const sideAware = sideAwareBridgeCandidates(start, end, fromSide, toSide);
      const nearParallelPorts = (
        ((fromSide === 'top' || fromSide === 'bottom')
          && (toSide === 'top' || toSide === 'bottom')
          && deltaX < minimumStub * 2)
        || ((fromSide === 'left' || fromSide === 'right')
          && (toSide === 'left' || toSide === 'right')
          && deltaY < minimumStub * 2)
      );
      const ordered = [
        ...(nearParallelPorts ? sideAware : sideSafe),
        ...(nearParallelPorts ? sideSafe : sideAware),
        ...candidates.filter((candidate) => !sideSafe.includes(candidate)),
      ];
      for (const candidate of ordered) {
        const points = [start, ...candidate, end];
        if (routeClearsEndpointComponents(points, from, to) && routeClearsComponents(conn, points)) return candidate;
      }

      return sideSafe[0] || sideAware[0] || horizontalFirst;
    }
  }
}

function connectionSides(conn) {
  const from = components.get(conn.from);
  const to = components.get(conn.to);
  return {
    fromSide: chosenSide(conn.fromSide, defaultFromSide(from, to)),
    toSide: chosenSide(conn.toSide, defaultToSide(from, to)),
  };
}

function connectionEndpointSide(conn, endpoint) {
  const field = endpoint === 'source' ? 'fromSide' : 'toSide';
  if (conn[field] && conn[field] !== 'auto') return conn[field];
  return connectionSides(conn)[field];
}

function pathFor(conn) {
  if (pathCache.has(conn)) return pathCache.get(conn);
  const from = components.get(conn.from);
  const to = components.get(conn.to);
  const ports = automaticPorts.get(conn);
  const { fromSide, toSide } = connectionSides(conn);
  const baseStart = ports?.from || anchor(from, fromSide);
  const baseEnd = ports?.to || anchor(to, toSide);
  const { start, end } = alignFacingPorts(
    conn,
    from,
    to,
    baseStart,
    baseEnd,
    fromSide,
    toSide,
    ports,
  );
  const points = [start, ...routeVia(conn, from, to, start, end, fromSide, toSide), end];
  const routed = { d: roundedPath(points, 8), points };
  pathCache.set(conn, routed);
  return routed;
}

// ---------------------------------------------------------------------------
// Semantic + layout validation
// ---------------------------------------------------------------------------
function validateErd() {
  const problems = [];

  if (erd.schema_version !== 1) {
    problems.push(`schema_version must be 1 (got ${JSON.stringify(erd.schema_version)}).`);
  }
  if (erd.diagram_type !== 'erd') {
    problems.push(`diagram_type must be "erd" (got ${JSON.stringify(erd.diagram_type)}).`);
  }
  if (!erd.meta || !erd.meta.title) {
    problems.push('meta.title is required.');
  }

  const ids = new Set();
  for (const e of entities) {
    if (ids.has(e.id)) problems.push(`Entity id ${JSON.stringify(e.id)} is duplicated.`);
    ids.add(e.id);
  }

  for (const r of connections) {
    if (!components.has(r.from)) {
      problems.push(`Relationship ${JSON.stringify(r.id || `${r.from}->${r.to}`)} references unknown entity "${r.from}".`);
    }
    if (!components.has(r.to)) {
      problems.push(`Relationship ${JSON.stringify(r.id || `${r.from}->${r.to}`)} references unknown entity "${r.to}".`);
    }
    if (!r.cardinality || !r.cardinality.from || !r.cardinality.to) {
      problems.push(`Relationship ${JSON.stringify(r.id || `${r.from}->${r.to}`)} must declare cardinality on both ends (cardinality.from and cardinality.to).`);
    }
  }

  for (const e of entities) {
    const names = new Set();
    let primaryCount = 0;
    for (const a of (e.attributes || [])) {
      if (names.has(a.name)) {
        problems.push(`Entity "${e.id}" declares duplicate attribute name ${JSON.stringify(a.name)}.`);
      }
      names.add(a.name);
      if (a.role === 'primary') primaryCount += 1;
      if (a.role === 'foreign' && !a.references) {
        problems.push(`Attribute "${e.id}.${a.name}" declares role "foreign" without a references target; declare references as "entity.attribute" or drop the foreign role.`);
      } else if (a.references) {
        const [ent, attr] = a.references.split('.');
        const target = components.get(ent);
        if (!target) {
          problems.push(`Attribute "${e.id}.${a.name}" references unknown entity "${ent}".`);
        } else if (!(target.attributes || []).some((x) => x.name === attr)) {
          problems.push(`Attribute "${e.id}.${a.name}" references unknown attribute "${ent}.${attr}".`);
        }
      }
    }
    if (primaryCount > 1) {
      problems.push(`Entity "${e.id}" declares ${primaryCount} primary keys; at most one is allowed.`);
    }
  }

  for (const r of connections) {
    if (r.enforced_by) {
      const [ent, attr] = r.enforced_by.split('.');
      const target = components.get(ent);
      if (!target) {
        problems.push(`Relationship ${JSON.stringify(r.id || `${r.from}->${r.to}`)} enforced_by references unknown entity "${ent}".`);
      } else if (!(target.attributes || []).some((x) => x.name === attr)) {
        problems.push(`Relationship ${JSON.stringify(r.id || `${r.from}->${r.to}`)} enforced_by references unknown attribute "${ent}.${attr}".`);
      }
    }
  }

  const referenced = new Set();
  for (const r of connections) {
    referenced.add(r.from);
    referenced.add(r.to);
  }
  for (const e of entities) {
    if (!referenced.has(e.id) && !e.standalone) {
      problems.push(`Entity "${e.id}" is not connected by any relationship (orphan). Set "standalone": true if it is intentionally disconnected.`);
    }
  }

  for (const conn of connections) {
    if (!components.has(conn.from) || !components.has(conn.to)) continue;
    const routed = pathFor(conn);
    const [start, end] = [routed.points[0], routed.points[routed.points.length - 1]];
    const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (distance < 24) {
      problems.push(`Relationship ${JSON.stringify(conn.id || `${conn.from}->${conn.to}`)} is too short (${Math.round(distance)}px; minimum 24px) — place its entities farther apart.`);
    }
  }

  problems.push(...cleanEndpointSideProblems({
    relations: connections,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'erd',
    relationCollection: 'relationships',
    fromSideFor: (conn) => connectionEndpointSide(conn, 'source'),
    toSideFor: (conn) => connectionEndpointSide(conn, 'target'),
    routeHint: 'keep automatic routing so the renderer can use a side-aware bridge, or set truthful fromSide/toSide with perpendicular via segments',
  }));
  problems.push(...cleanFlowProblems({
    relations: connections,
    endpointIds: new Set(components.keys()),
    obstacles: components.values(),
    pathFor,
    diagramType: 'erd',
    relationCollection: 'relationships',
    obstacleKind: 'entity',
    profile: erd.meta?.quality_profile,
    routeHint: 'adjust fromSide/toSide, set route/via, or move the entity',
  }));
  problems.push(...cleanCrossingProblems({
    relations: connections,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'erd',
    relationCollection: 'relationships',
    profile: erd.meta?.quality_profile,
    routeHint: 'adjust route/via or fromSide/toSide so the relationships use separate corridors',
  }));
  problems.push(...cleanAmbiguousCorridorProblems({
    relations: connections,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'erd',
    relationCollection: 'relationships',
    profile: erd.meta?.quality_profile,
    routeHint: 'adjust route/via or fromSide/toSide so unrelated relationships do not visually merge',
  }));
  problems.push(...cleanBorderRunProblems({
    relations: connections,
    endpointIds: new Set(components.keys()),
    frames: [],
    pathFor,
    diagramType: 'erd',
    relationCollection: 'relationships',
    profile: erd.meta?.quality_profile,
    routeHint: 'adjust route/via or fromSide/toSide so the relationship crosses cleanly',
  }));
  problems.push(...cleanRouteRhythmProblems({
    relations: connections,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'erd',
    relationCollection: 'relationships',
    profile: erd.meta?.quality_profile,
    routeHint: 'move route/via points into a wider corridor or move the entity so every turn has room to read',
  }));

  const labelRects = [];
  for (const [connectionIndex, conn] of connections.entries()) {
    if (!conn.label || !components.has(conn.from) || !components.has(conn.to)) continue;
    const [lx, ly] = labelPoint(conn, pathFor(conn).points);
    const w = Math.max(30, textUnits(conn.label) * 4.8 + 10);
    labelRects.push({ relation: conn, relationIndex: connectionIndex, label: conn.label, x: lx - w / 2, y: ly - 10, width: w, height: 14, lx, ly });
  }
  for (const rect of labelRects) {
    for (const c of components.values()) {
      if (rectsOverlap(rect, c, -2)) {
        problems.push(`Label "${rect.label}" overlaps entity "${c.id}" — adjust labelDx/labelDy/labelSegment or set labelAt.\n${suggestLabelObstacleFix(rect, rect.lx, rect.ly, c)}`);
      }
    }
  }
  problems.push(...cleanLabelRouteClearanceProblems({
    relations: connections,
    labels: labelRects,
    endpointIds: new Set(components.keys()),
    pathFor,
    diagramType: 'erd',
    relationCollection: 'relationships',
    profile: erd.meta?.quality_profile,
  }));

  if (problems.length) {
    throwDiagnosticProblems('ERD layout validation failed', problems, {
      subject: { diagramType: 'erd' },
    });
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function crowMarker(card) {
  if (!card) return 'erd-many';
  if (/[N*]/.test(card)) return 'erd-many';
  if (/0/.test(card)) return 'erd-one';
  return 'erd-one';
}

function sideNormal(side) {
  return ({ left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] })[side] || [0, 0];
}

function renderEntity(e, index) {
  const rect = components.get(e.id);
  const fill = entityFill[e.kind] || 'c-backend';
  const text = entityText[e.kind] || 't-backend';
  const rx = 8;
  let s = '';
  // focusNodeAttrs already emits data-node-id and data-node-kind; duplicating
  // them here concatenated the last attribute onto the next without whitespace
  // and produced SVG that was not well-formed XML.
  s += `        <g ${focusNodeAttrs(e.id, e.label, { kind: e.kind, sublabel: e.sublabel, tag: e.tag, context: 'entity' }, erd.meta.locale)}>`;
  s += `<rect x="${rect.x}" y="${rect.y}" width="${rect.width}" height="${rect.height}" rx="${rx}" class="${fill}" stroke-width="1"/>`;
  const headerY = rect.y + HEADER_H;
  s += `<line x1="${rect.x + 1}" y1="${headerY}" x2="${rect.x + rect.width - 1}" y2="${headerY}" stroke="#8b949e" stroke-width="1" opacity="0.5"/>`;
  s += `<text x="${rect.x + rect.width / 2}" y="${rect.y + HEADER_H / 2 + 5}" text-anchor="middle" class="${text}" font-size="13" font-weight="700">${esc(e.label)}</text>`;
  const rows = e.attributes || [];
  rows.forEach((a, i) => {
    const ay = headerY + PAD_Y + i * ROW_H + ROW_H / 2 - 1;
    const isPk = a.role === 'primary';
    const isFk = a.role === 'foreign' || Boolean(a.references);
    if (isPk) {
      s += `<circle cx="${rect.x + 13}" cy="${ay - 3}" r="3" class="${text}"/>`;
    } else if (isFk) {
      s += `<circle cx="${rect.x + 13}" cy="${ay - 3}" r="3" fill="none" stroke="#8b949e" stroke-width="1.3"/>`;
    }
    const nameCls = a.optional ? 't-muted' : text;
    const optionalMark = a.optional ? '?' : '';
    s += `<text x="${rect.x + 24}" y="${ay}" class="${nameCls}" font-size="11">${esc(a.name)}${optionalMark}</text>`;
    if (isPk) s += `<text x="${rect.x + rect.width - 8}" y="${ay}" text-anchor="end" class="t-muted" font-size="9">PK</text>`;
    else if (isFk) s += `<text x="${rect.x + rect.width - 8}" y="${ay}" text-anchor="end" class="t-muted" font-size="9">FK</text>`;
  });
  if (e.tag) {
    s += `<text x="${rect.x + rect.width - 8}" y="${rect.y + HEADER_H / 2 + 5}" text-anchor="end" class="t-muted" font-size="9">${esc(e.tag)}</text>`;
  }
  if (e.sublabel) {
    s += `<text x="${rect.x + rect.width / 2}" y="${rect.y + HEADER_H / 2 + 17}" text-anchor="middle" class="t-muted" font-size="9">${esc(e.sublabel)}</text>`;
  }
  s += `</g>`;
  return s;
}

function renderRelationship(r, index) {
  if (!components.has(r.from) || !components.has(r.to)) return '';
  const routed = pathFor(r);
  const strokeWidth = r.width || 1.5;
  const fromMarker = crowMarker(r.cardinality?.from);
  const toMarker = crowMarker(r.cardinality?.to);
  let s = '';
  s += `        <path ${focusEdgeAttrs(r.from, r.to, r.label, index, r.id)} data-composition-points="${routePointsValue(routed.points)}" d="${routed.d}" fill="none" stroke="#8b949e" stroke-width="${strokeWidth}" marker-start="url(#${fromMarker})" marker-end="url(#${toMarker})"${animateAttr(erd.meta, 'edge', index)}/>`;

  const a = routed.points[0];
  const b = routed.points[routed.points.length - 1];
  const fromSide = connectionEndpointSide(r, 'source');
  const toSide = connectionEndpointSide(r, 'target');
  const fn = sideNormal(fromSide);
  const tn = sideNormal(toSide);
  if (r.cardinality?.from) {
    s += `<text x="${a[0] + fn[0] * 8}" y="${a[1] + fn[1] * 8 + 3}" text-anchor="middle" class="t-muted" font-size="10">${esc(r.cardinality.from)}</text>`;
  }
  if (r.cardinality?.to) {
    s += `<text x="${b[0] + tn[0] * 8}" y="${b[1] + tn[1] * 8 + 3}" text-anchor="middle" class="t-muted" font-size="10">${esc(r.cardinality.to)}</text>`;
  }
  if (r.label) {
    const [lx, ly] = labelPoint(r, routed.points);
    s += `<text x="${lx}" y="${ly}" text-anchor="middle" class="t-muted" font-size="10">${esc(r.label)}</text>`;
  }
  return s;
}

function computeViewBox() {
  if (erd.meta?.viewBox) return erd.meta.viewBox;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of components.values()) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (!Number.isFinite(minX)) return [760, 600];
  const pad = 28;
  const w = Math.max(420, maxX + pad);
  const h = Math.max(566, maxY + pad);
  return [w, h];
}

validateErd();

const viewBox = computeViewBox();

const LEGEND_CATALOG = [
  'transactional',
  'reference',
  'event',
  'junction',
  'external',
].map((kind) => ({ kind, label: i18nText(erd.meta.locale, `legend.erd.${kind}`) }));

function renderLegend() {
  const presentKinds = new Set(entities.map((e) => e.kind));
  const entries = resolveLegend(erd.meta?.legend, LEGEND_CATALOG, presentKinds);
  return renderResolvedLegend({
    entries,
    locale: erd.meta.locale,
    layout: {
      x: 40,
      baselineY: viewBox[1] - 18,
      width: viewBox[0] - 80,
      minTitleY: viewBox[1] - 40,
      unfit: erd.meta?.legend === undefined ? 'hide' : 'error',
      diagramType: 'erd',
    },
    renderSwatch: (entry) => `<rect x="${entry.x}" y="${entry.baseline - 8}" width="14" height="9" rx="2" class="${entityFill[entry.kind] || 'c-external'}" stroke-width="1"/>`,
  });
}

function renderSvg() {
  let edges = '';
  for (const [index, r] of connections.entries()) edges += `\n${renderRelationship(r, index)}`;
  let nodes = '';
  for (const [index, e] of entities.entries()) nodes += `\n${renderEntity(e, index)}`;
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(erd.meta, 'erd')}>
${svgAccessibleText(erd.meta, 'erd')}
${renderDefinitions()}
        <defs>
          <marker id="erd-one" markerWidth="12" markerHeight="10" refX="2" refY="5" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M10 5 L2 5" fill="none" stroke="#8b949e" stroke-width="1.4"/>
          </marker>
          <marker id="erd-many" markerWidth="14" markerHeight="12" refX="2" refY="6" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M12 6 L2 1 M12 6 L2 6 M12 6 L2 11" fill="none" stroke="#8b949e" stroke-width="1.4"/>
          </marker>
        </defs>
        <g data-graph-role="edges" data-diagram-type="erd">${edges}
        </g>
        <g data-graph-role="nodes" data-diagram-type="erd">${nodes}
        </g>
${renderLegend()}
      </svg>`;
}

writeDiagram({
  outPath,
  template,
  diagramType: 'erd',
  meta: erd.meta,
  svg: renderSvg(),
  cards: erd.cards,
  sourceEvidence,
});
