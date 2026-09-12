import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import {
  animateAttr,
  focusEdgeAttrs,
  focusNodeAttrs,
  focusNodeTitle,
  loadDiagram,
  svgAccessibleText,
  svgRootAttrs,
  writeDiagram,
} from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import {
  legendFootprint,
  relationshipLegendObstacles,
  resolveLegend,
  renderLegend as renderResolvedLegend,
} from '../shared/legend.mjs';
import { nodeTextFit, fittedNodeFontSize } from '../shared/text-fit.mjs';
import { translateMessage as i18nText } from '../shared/i18n.mjs';
import {
  DEFAULT_ER_GRID,
  bandedLayout,
  entityHeight,
  erGridLayout,
  resolveEntityPos,
  validateErGridPlacement,
} from './grid.mjs';
import {
  asArray,
  arrowClassMap,
  cleanAmbiguousCorridorProblems,
  cleanCrossingProblems,
  cleanEndpointSideProblems,
  cleanFlowProblems,
  cleanLabelRouteClearanceProblems,
  cleanRouteRhythmProblems,
  componentFill,
  componentText,
  labelPoint,
  rectsOverlap,
  routePointsValue,
  suggestComponentSeparation,
  suggestLabelObstacleFix,
  variantAccent,
} from '../shared/geometry.mjs';
import { createOrthogonalRouter } from '../shared/orthogonal-router.mjs';
import { entityBox, connectionPath as relationshipPath } from '../shared/layout-report.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const layoutJsonMode = process.argv.includes('--layout-json');
const cliArgs = process.argv.filter((arg) => arg !== '--layout-json');
const { diagram: er, template, outPath } = loadDiagram({
  rendererDir: __dirname,
  diagramType: 'erd',
  defaultExample: 'orders.erd.json',
  argv: cliArgs,
});

const grid = erGridLayout(er);

const layout = {
  margin: 40,
  legendH: 28,
  padX: 10,
  keyWidth: 26,
  keyFont: 7,
  headerFont: 11,
  headerFontMinimum: 8,
  rowFont: 9,
  rowFontMinimum: 7,
  typeFont: 8,
  typeFontMinimum: 7,
  detailPreferred: 8,
  detailMinimum: 6,
  minRelationshipLength: 24,
};

const ENTITY_FILL = componentFill.database;
const ENTITY_ACCENT = componentText.database;
const KEY_ACCENT = { pk: 't-database', fk: 't-messagebus', uk: 't-muted' };

// ---- Measure entities from the banded grid -----------------------------------
// Header and row metrics live in the grid contract so the banded layout and the
// renderer can never disagree about a box's height.
const metrics = grid ?? DEFAULT_ER_GRID;

const entityWidth = (entity) => (
  Number.isFinite(entity.width) ? entity.width : (grid?.entityW ?? DEFAULT_ER_GRID.entityW)
);

const measuredEntities = asArray(er.entities).map((entity) => {
  const attributes = asArray(entity.attributes);
  const width = entityWidth(entity);
  return {
    ...entity,
    attributes,
    width,
    height: entityHeight({ ...entity, attributes }, grid ?? DEFAULT_ER_GRID),
  };
});

const bands = grid ? bandedLayout(measuredEntities, grid) : null;

const entities = new Map(measuredEntities.map((entity) => {
  const [x, y] = resolveEntityPos(entity, grid, bands);
  return [entity.id, { ...entity, x, y, cx: x + entity.width / 2, cy: y + entity.height / 2 }];
}));

const relationships = asArray(er.relationships);

const entitySteps = new Map();
for (const [index, relationship] of relationships.entries()) {
  if (!entitySteps.has(relationship.from)) entitySteps.set(relationship.from, index);
  if (!entitySteps.has(relationship.to)) entitySteps.set(relationship.to, index + 1);
}
for (const [index, entity] of asArray(er.entities).entries()) {
  if (!entitySteps.has(entity.id)) entitySteps.set(entity.id, index);
}

// ---- Cardinality -------------------------------------------------------------
// A relationship reads `from` -> `to`. Defaults describe the common foreign-key
// shape: many rows on the `from` side point at one row on the `to` side, and
// both ends are mandatory until the author says otherwise.
function cardinalityOf(relationship, endpoint) {
  const value = endpoint === 'from' ? relationship.fromCardinality : relationship.toCardinality;
  if (value === 'one' || value === 'many') return value;
  return endpoint === 'from' ? 'many' : 'one';
}

function optionalOf(relationship, endpoint) {
  return (endpoint === 'from' ? relationship.fromOptional : relationship.toOptional) === true;
}

function markerStyleOf(relationship) {
  return (relationship.variant ?? (relationship.identifying === false ? 'dashed' : 'default'));
}

function cardinalityMarkerId(relationship, endpoint) {
  const cardinality = cardinalityOf(relationship, endpoint);
  const optional = optionalOf(relationship, endpoint) ? '-optional' : '';
  return `er-${cardinality}${optional}-${endpoint === 'from' ? 'start' : 'end'}`;
}

// Crow's foot notation: the symbol touches the entity, so the marker's vertex
// sits on the path endpoint and the toes spread back along the relationship.
// `start` markers are mirrored because an oriented marker's +x axis points
// along the path direction, which leaves the from-endpoint heading outward.
function cardinalityMarkerMarkup(id, { cardinality, optional, mirror }) {
  const flip = (x) => (mirror ? 16 - x : x);
  const parts = [];
  if (cardinality === 'many') {
    parts.push(`<path d="M ${flip(16)} 8 L ${flip(2)} 2 M ${flip(16)} 8 L ${flip(2)} 8 M ${flip(16)} 8 L ${flip(2)} 14"/>`);
  } else {
    parts.push(`<path d="M ${flip(11)} 2 L ${flip(11)} 14"/>`);
  }
  if (optional) parts.push(`<circle cx="${flip(5)}" cy="8" r="2.6"/>`);
  const refX = mirror ? 0 : 16;
  return `          <marker id="${esc(id)}" markerWidth="18" markerHeight="18" refX="${refX}" refY="8" orient="auto" markerUnits="userSpaceOnUse" class="a-default" stroke-width="1.25">
            ${parts.join('\n            ')}
          </marker>`;
}

function renderCardinalityDefs() {
  const used = new Set();
  for (const relationship of relationships) {
    used.add(`${cardinalityOf(relationship, 'from')}|${optionalOf(relationship, 'from')}|start`);
    used.add(`${cardinalityOf(relationship, 'to')}|${optionalOf(relationship, 'to')}|end`);
  }
  const ids = [];
  for (const cardinality of ['one', 'many']) {
    for (const optional of [false, true]) {
      for (const end of ['start', 'end']) {
        ids.push({ id: `er-${cardinality}${optional ? '-optional' : ''}-${end}`, cardinality, optional, mirror: end === 'start', key: `${cardinality}|${optional}|${end}` });
      }
    }
  }
  const markup = ids.filter((entry) => used.has(entry.key))
    .map((entry) => cardinalityMarkerMarkup(entry.id, entry));
  if (!markup.length) return '';
  return `\n          <!-- Cardinality symbols -->\n${markup.join('\n')}`;
}

// ---- Legend ------------------------------------------------------------------
const LEGEND_CATALOG = ['pk', 'fk', 'uk', 'one', 'many', 'optional']
  .map((kind) => ({ kind, label: i18nText(er.meta.locale, `legend.erd.${kind}`), swatchWidth: 18 }));

const presentKinds = new Set();
for (const entity of entities.values()) {
  for (const attribute of entity.attributes) {
    if (attribute.key) presentKinds.add(attribute.key);
  }
}
for (const relationship of relationships) {
  presentKinds.add(cardinalityOf(relationship, 'from'));
  presentKinds.add(cardinalityOf(relationship, 'to'));
  if (optionalOf(relationship, 'from') || optionalOf(relationship, 'to')) presentKinds.add('optional');
}
const erLegendEntries = resolveLegend(er.meta?.legend, LEGEND_CATALOG, presentKinds);

function autoViewBox() {
  const maxX = Math.max(0, ...[...entities.values()].map((entity) => entity.x + entity.width));
  const maxY = Math.max(0, ...[...entities.values()].map((entity) => entity.y + entity.height));
  let width = Math.ceil(maxX + layout.margin);
  let footprint = legendFootprint(erLegendEntries, { width: Math.max(1, width - layout.margin * 2) });
  if (footprint.minWidth > width - layout.margin * 2) {
    width = Math.ceil(footprint.minWidth + layout.margin * 2);
    footprint = legendFootprint(erLegendEntries, { width: width - layout.margin * 2 });
  }
  const height = Math.ceil(maxY + layout.margin + layout.legendH + footprint.extraHeight);
  return [width, height];
}

const viewBox = Array.isArray(er.meta?.viewBox) ? er.meta.viewBox : autoViewBox();
const legendY = () => viewBox[1] - 16;

// ---- Routing -----------------------------------------------------------------
// Relationships that would share one corridor get a deterministic lane each, so
// two routes never sit on the identical channel line. The lane is only a
// preference: a lane that breaks the endpoint contract or hits an entity is
// skipped and the shared candidate families run unchanged.
const LANE_STEP = 12;

const bandKey = (entity) => (
  Number.isInteger(entity.row) && Number.isInteger(entity.col)
    ? `i${entity.row},${entity.col}`
    : `p${Math.round(entity.x || 0)},${Math.round(entity.y || 0)}`
);

const { pathFor, connectionSides, connectionEndpointSide } = createOrthogonalRouter({
  relations: relationships,
  components: entities,
  preferredCandidates: laneCandidates,
  extraCandidates: (context) => [...detourCandidates(context), ...outsideCandidates(context)],
  // An entity sitting between two aligned anchors must be routed around, not
  // drawn through: the direct line is only taken when it is genuinely clear.
  strictClearance: true,
});

function corridorKey(relationship) {
  const from = entities.get(relationship.from);
  const to = entities.get(relationship.to);
  if (!from || !to) return null;
  const { fromSide, toSide } = connectionSides(relationship);
  const horizontalPorts = (fromSide === 'left' || fromSide === 'right');
  const verticalPorts = (fromSide === 'top' || fromSide === 'bottom');
  if (horizontalPorts === verticalPorts) return null;
  const ordered = horizontalPorts
    ? [from, to].sort((left, right) => left.cx - right.cx)
    : [from, to].sort((left, right) => left.cy - right.cy);
  return `${horizontalPorts ? 'h' : 'v'}:${bandKey(ordered[0])}|${bandKey(ordered[1])}`;
}

const laneOffsets = new Map();
{
  const groups = new Map();
  for (const relationship of relationships) {
    const key = corridorKey(relationship);
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push(relationship);
    groups.set(key, list);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((left, right) => {
      const leftKey = `${left.from}\u0000${left.to}\u0000${left.id || ''}`;
      const rightKey = `${right.from}\u0000${right.to}\u0000${right.id || ''}`;
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
    });
    for (const [index, relationship] of list.entries()) {
      laneOffsets.set(relationship, index - (list.length - 1) / 2);
    }
  }
}

function channelFallback({ conn, start, end, fromSide, toSide }) {
  const horizontalPorts = fromSide === 'left' || fromSide === 'right';
  const verticalPorts = fromSide === 'top' || fromSide === 'bottom';
  if (horizontalPorts === verticalPorts) return null;
  const axis = horizontalPorts ? 0 : 1;
  const toPoints = (channel) => (horizontalPorts
    ? [[channel, start[1]], [channel, end[1]]]
    : [[start[0], channel], [end[0], channel]]);
  return { axis, toPoints, low: Math.min(start[axis], end[axis]), high: Math.max(start[axis], end[axis]) };
}

function laneCandidates(context) {
  const lane = laneOffsets.get(context.conn);
  if (lane === undefined) return [];
  const channel = channelFallback(context);
  if (!channel) return [];
  const base = (context.start[channel.axis] + context.end[channel.axis]) / 2;
  return [channel.toPoints(base + lane * LANE_STEP)];
}

// A third entity between two aligned anchors blocks every shared candidate
// family, because each one runs along the same line. These U-shaped detours
// leave the source side, run along a line that clears the obstacle, and enter
// the target from its own side. They are only consulted after the shared
// families fail, so an unobstructed schema keeps its ordinary routes.
const DETOUR_CLEARANCE = 16;
const DETOUR_LEG = 12;

function detourCandidates({ conn, start, end, fromSide, toSide }) {
  const horizontalPorts = fromSide === 'left' || fromSide === 'right';
  const verticalPorts = fromSide === 'top' || fromSide === 'bottom';
  if (horizontalPorts === verticalPorts) return [];
  const travel = horizontalPorts ? 0 : 1;
  const cross = 1 - travel;
  const travelLow = Math.min(start[travel], end[travel]);
  const travelHigh = Math.max(start[travel], end[travel]);
  const crossLow = Math.min(start[cross], end[cross]);
  const crossHigh = Math.max(start[cross], end[cross]);

  const offsets = new Set();
  for (const entity of entities.values()) {
    if (entity.id === conn.from || entity.id === conn.to) continue;
    const boxTravelLow = travel === 0 ? entity.x : entity.y;
    const boxTravelHigh = boxTravelLow + (travel === 0 ? entity.width : entity.height);
    if (boxTravelHigh <= travelLow || boxTravelLow >= travelHigh) continue;
    const boxCrossLow = cross === 0 ? entity.x : entity.y;
    const boxCrossHigh = boxCrossLow + (cross === 0 ? entity.width : entity.height);
    if (boxCrossHigh <= crossLow || boxCrossLow >= crossHigh) continue;
    offsets.add(boxCrossLow - DETOUR_CLEARANCE);
    offsets.add(boxCrossHigh + DETOUR_CLEARANCE);
  }
  if (!offsets.size) return [];

  const point = (travelValue, crossValue) => (travel === 0 ? [travelValue, crossValue] : [crossValue, travelValue]);
  const startDirection = horizontalPorts
    ? (fromSide === 'right' ? 1 : -1)
    : (fromSide === 'bottom' ? 1 : -1);
  const endDirection = horizontalPorts
    ? (toSide === 'left' ? -1 : 1)
    : (toSide === 'top' ? -1 : 1);
  const startLeg = start[travel] + startDirection * DETOUR_LEG;
  const endLeg = end[travel] + endDirection * DETOUR_LEG;

  return [...offsets]
    .sort((left, right) => Math.abs(left - start[cross]) - Math.abs(right - start[cross]))
    .map((offset) => [
      point(startLeg, start[cross]),
      point(startLeg, offset),
      point(endLeg, offset),
      point(endLeg, end[cross]),
    ]);
}

function outsideCandidates(context) {
  const channel = channelFallback(context);
  if (!channel) return [];
  const reach = LANE_STEP * 2;
  return [
    channel.toPoints(channel.high + reach),
    channel.toPoints(channel.low - reach),
  ];
}

// ---- Validation --------------------------------------------------------------
function renderableRelationship(relationship) {
  return entities.has(relationship.from) && entities.has(relationship.to);
}

function rowTextWidths(attribute) {
  const name = textUnits(attribute.name) * nodeTextFit.widthFactor;
  const type = attribute.type ? textUnits(attribute.type) * nodeTextFit.widthFactor : 0;
  return { name, type };
}

function validateEr() {
  const problems = [];
  validateErGridPlacement(er, grid, bands, problems);

  const seenEntityIds = new Set();
  for (const entity of asArray(er.entities)) {
    if (seenEntityIds.has(entity.id)) problems.push(`Duplicate entity id "${entity.id}".`);
    seenEntityIds.add(entity.id);

    if (!Number.isFinite(entity.width) && entity.width !== undefined) {
      problems.push(`Entity "${entity.id}" width must be a finite number.`);
    }
    const seenColumns = new Set();
    for (const [attributeIndex, attribute] of asArray(entity.attributes).entries()) {
      if (seenColumns.has(attribute.name)) {
        problems.push(`Entity "${entity.id}" declares attribute "${attribute.name}" twice.`);
      }
      seenColumns.add(attribute.name);
      const { name: nameUnits, type: typeUnits } = rowTextWidths(attribute);
      const available = entity.width - layout.padX * 2 - layout.keyWidth;
      const needed = nameUnits * layout.rowFont + (typeUnits ? typeUnits * layout.typeFont + 8 : 0);
      if (needed > available) {
        problems.push(
          `Entity "${entity.id}" attribute ${attributeIndex} "${attribute.name}" needs ${Math.ceil(needed)}px of text but only ${Math.floor(available)}px is available — widen the entity, shorten the attribute name, or drop the type.`,
        );
      }
    }
  }

  for (const entity of entities.values()) {
    for (const other of entities.values()) {
      if (entity.id >= other.id) continue;
      if (!rectsOverlap(entity, other, 0)) continue;
      problems.push(`Entity "${entity.id}" overlaps entity "${other.id}".\n${suggestComponentSeparation(entity, other)}`);
    }
  }

  for (const [index, relationship] of relationships.entries()) {
    const id = relationship.id ? ` id "${relationship.id}"` : '';
    if (!entities.has(relationship.from)) {
      problems.push(`Relationship ${index}${id} references unknown source entity "${relationship.from}".`);
      continue;
    }
    if (!entities.has(relationship.to)) {
      problems.push(`Relationship ${index}${id} references unknown target entity "${relationship.to}".`);
      continue;
    }
    if (relationship.from === relationship.to) {
      problems.push(`Relationship ${index}${id} connects entity "${relationship.from}" to itself — draw it between two entities or describe the self-reference in a card.`);
      continue;
    }
    const routed = pathFor(relationship);
    const [start, end] = [routed.points[0], routed.points[routed.points.length - 1]];
    const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (distance < layout.minRelationshipLength) {
      problems.push(`Relationship ${index}${id} "${relationship.from}" -> "${relationship.to}" is too short (${Math.round(distance)}px; minimum ${layout.minRelationshipLength}px) — place the entities farther apart.`);
    }
  }

  for (const [index, entity] of asArray(er.entities).entries()) {
    for (const [attributeIndex, attribute] of asArray(entity.attributes).entries()) {
      if (typeof attribute.references !== 'string') continue;
      const [targetId, targetColumn] = attribute.references.split('.');
      const target = entities.get(targetId);
      if (!target) {
        problems.push(`Entity "${entity.id}" attribute ${attributeIndex} "${attribute.name}" references unknown entity "${targetId}" in "${attribute.references}".`);
        continue;
      }
      if (!asArray(target.attributes).some((candidate) => candidate.name === targetColumn)) {
        problems.push(`Entity "${entity.id}" attribute ${attributeIndex} "${attribute.name}" references unknown attribute "${attribute.references}" — "${targetId}" has no attribute "${targetColumn}".`);
      }
    }
  }

  problems.push(...cleanEndpointSideProblems({
    relations: relationships,
    endpointIds: new Set(entities.keys()),
    pathFor,
    diagramType: 'erd',
    relationCollection: 'relationships',
    fromSideFor: (relationship) => connectionEndpointSide(relationship, 'source'),
    toSideFor: (relationship) => connectionEndpointSide(relationship, 'target'),
    routeHint: 'keep automatic routing so the renderer can use a side-aware bridge, or set truthful fromSide/toSide',
  }));
  problems.push(...cleanFlowProblems({
    relations: relationships,
    obstacles: entities.values(),
    pathFor,
    diagramType: 'erd',
    relationCollection: 'relationships',
    obstacleKind: 'entity',
    routeHint: 'adjust fromSide/toSide, set route/via, or move the entity',
  }));
  problems.push(...cleanCrossingProblems({
    relations: relationships,
    endpointIds: new Set(entities.keys()),
    pathFor,
    diagramType: 'erd',
    relationCollection: 'relationships',
    profile: er.meta?.quality_profile,
    routeHint: 'move the entities so unrelated relationships use separate corridors',
  }));
  problems.push(...cleanAmbiguousCorridorProblems({
    relations: relationships,
    endpointIds: new Set(entities.keys()),
    pathFor,
    diagramType: 'erd',
    relationCollection: 'relationships',
    profile: er.meta?.quality_profile,
    routeHint: 'give the relationships different fromSide/toSide targets, or move an entity so their corridors differ',
  }));
  problems.push(...cleanRouteRhythmProblems({
    relations: relationships,
    endpointIds: new Set(entities.keys()),
    pathFor,
    diagramType: 'erd',
    relationCollection: 'relationships',
    profile: er.meta?.quality_profile,
    routeHint: 'widen the gap between bands so every turn has room to read',
  }));

  const labelRects = [];
  for (const [index, relationship] of relationships.entries()) {
    if (!relationship.label || !renderableRelationship(relationship)) continue;
    const [lx, ly] = labelPoint(relationship, pathFor(relationship).points);
    const width = Math.max(30, textUnits(relationship.label) * 4.8 + 10);
    labelRects.push({
      relation: relationship,
      relationIndex: index,
      label: relationship.label,
      x: lx - width / 2,
      y: ly - 10,
      width,
      height: 14,
      lx,
      ly,
    });
  }
  for (const rect of labelRects) {
    for (const entity of entities.values()) {
      if (!rectsOverlap(rect, entity, -2)) continue;
      problems.push(`Label "${rect.label}" overlaps entity "${entity.id}" — adjust labelDx/labelDy/labelSegment or set labelAt.\n${suggestLabelObstacleFix(rect, rect.lx, rect.ly, entity, 'entity')}`);
    }
  }
  problems.push(...cleanLabelRouteClearanceProblems({
    relations: relationships,
    labels: labelRects,
    endpointIds: new Set(entities.keys()),
    pathFor,
    diagramType: 'erd',
    relationCollection: 'relationships',
    profile: er.meta?.quality_profile,
  }));

  if (problems.length) {
    throwDiagnosticProblems('Entity-relationship layout validation failed', problems, {
      code: 'layout/constraint',
      subject: { diagramType: 'erd' },
    });
  }
}

function buildLayoutReport() {
  return {
    diagram_type: 'erd',
    viewBox,
    layout,
    entities: [...entities.values()].map(entityBox),
    relationships: relationships
      .filter(renderableRelationship)
      .map((relationship) => ({
        ...relationshipPath(relationship, pathFor(relationship), relationship.labelAt),
        fromCardinality: cardinalityOf(relationship, 'from'),
        toCardinality: cardinalityOf(relationship, 'to'),
      })),
  };
}

// ---- Rendering ---------------------------------------------------------------
function renderEntityColumnRows(entity) {
  return entity.attributes.map((attribute, index) => {
    const rowTop = entity.y + metrics.headerH + index * metrics.rowH;
    const baseline = rowTop + metrics.rowH - 5;
    const keyGlyph = attribute.key
      ? `<text x="${entity.x + layout.padX}" y="${baseline}" class="${KEY_ACCENT[attribute.key] || 't-muted'}" font-size="${layout.keyFont}" font-weight="600">${esc(attribute.key.toUpperCase())}</text>`
      : '';
    const nameX = entity.x + layout.padX + layout.keyWidth;
    const typeSpace = attribute.type ? Math.min(96, textUnits(attribute.type) * layout.typeFont * nodeTextFit.widthFactor) : 0;
    const nameFontSize = fittedNodeFontSize(
      attribute.name,
      Math.max(40, entity.x + entity.width - layout.padX - typeSpace - nameX),
      layout.rowFont,
      layout.rowFontMinimum,
    );
    const type = attribute.type
      ? `<text x="${entity.x + entity.width - layout.padX}" y="${baseline}" class="t-muted" font-size="${layout.typeFont}" text-anchor="end">${esc(attribute.type)}</text>`
      : '';
    return `          <g data-detail="fine" data-er-row="${index}">
            <line x1="${entity.x}" y1="${rowTop}" x2="${entity.x + entity.width}" y2="${rowTop}" class="c-grid" stroke-width="0.5"/>
            ${keyGlyph}
            <text x="${nameX}" y="${baseline}" class="t-primary" font-size="${nameFontSize}">${esc(attribute.name)}</text>
            ${type}
          </g>`;
  }).join('\n');
}

function renderEntity(entity) {
  const header = entity.y + metrics.headerH;
  const detail = entity.sublabel ?? entity.tag;
  const detailFontSize = detail
    ? fittedNodeFontSize(detail, 60, layout.detailPreferred, layout.detailMinimum)
    : 0;
  const detailFits = detail ? textUnits(detail) * detailFontSize * nodeTextFit.widthFactor <= 64 : false;
  const labelFontSize = fittedNodeFontSize(entity.label, entity.width - 34, layout.headerFont, layout.headerFontMinimum);
  const passport = {
    kind: 'database',
    sublabel: entity.sublabel,
    tag: entity.tag,
    context: i18nText(er.meta.locale, 'node.context.erd'),
  };
  const sublabel = detailFits
    ? `\n          <text data-detail="context" x="${entity.x + entity.width - layout.padX}" y="${entity.y + 16}" class="t-muted" font-size="${detailFontSize}" text-anchor="end">${esc(detail)}</text>`
    : '';
  const rows = renderEntityColumnRows(entity);
  return `        <g ${focusNodeAttrs(entity.id, entity.label, passport, er.meta.locale)}>
          ${focusNodeTitle(entity.label, passport)}
          <rect x="${entity.x}" y="${entity.y}" width="${entity.width}" height="${entity.height}" rx="5" class="c-mask"/>
          <rect x="${entity.x}" y="${entity.y}" width="${entity.width}" height="${entity.height}" rx="5" class="${ENTITY_FILL}"${animateAttr(er.meta, 'node', entitySteps.get(entity.id))} stroke-width="1.5"/>
          ${renderSemanticSigil('database', { x: entity.x + 6, y: entity.y + 5 })}
          <text data-node-label="" x="${entity.x + entity.width / 2}" y="${entity.y + 18}" class="t-primary" font-size="${labelFontSize}" font-weight="600" text-anchor="middle">${esc(entity.label)}</text>${sublabel}
          <line x1="${entity.x}" y1="${header}" x2="${entity.x + entity.width}" y2="${header}" class="c-grid" stroke-width="1"/>
${rows}
        </g>`;
}

function renderRelationshipPath(relationship, index) {
  const [cls] = arrowClassMap[markerStyleOf(relationship)] || arrowClassMap.default;
  const routed = pathFor(relationship);
  const strokeWidth = Number.isFinite(relationship.width) ? relationship.width : 1.5;
  return `        <path ${focusEdgeAttrs(relationship.from, relationship.to, relationship.label, index, relationship.id)} data-composition-points="${routePointsValue(routed.points)}" d="${routed.d}" class="${cls}"${animateAttr(er.meta, 'edge', index)} stroke-width="${strokeWidth}" marker-start="url(#${cardinalityMarkerId(relationship, 'from')})" marker-end="url(#${cardinalityMarkerId(relationship, 'to')})"/>`;
}

function renderRelationshipLabel(relationship, index) {
  if (!relationship.label) return '';
  const [lx, ly] = labelPoint(relationship, pathFor(relationship).points);
  const width = Math.max(30, textUnits(relationship.label) * 4.8 + 10);
  return `        <g data-detail="context" ${focusEdgeAttrs(relationship.from, relationship.to, relationship.label, index, relationship.id)}>
          <rect x="${lx - width / 2}" y="${ly - 10}" width="${width}" height="14" rx="3" class="c-mask"/>
          <text x="${lx}" y="${ly}" class="${variantAccent(relationship.variant)}" font-size="8" text-anchor="middle">${esc(relationship.label)}</text>
        </g>`;
}

function legendSwatch(entry) {
  const y = entry.baseline - 9;
  if (entry.kind === 'one' || entry.kind === 'many') {
    const symbol = entry.kind === 'many'
      ? `<path d="M ${entry.x + 17} ${y + 5} L ${entry.x + 3} ${y} M ${entry.x + 17} ${y + 5} L ${entry.x + 3} ${y + 5} M ${entry.x + 17} ${y + 5} L ${entry.x + 3} ${y + 10}" class="a-default" stroke-width="1.25"/>`
      : `<path d="M ${entry.x + 9} ${y} L ${entry.x + 9} ${y + 10}" class="a-default" stroke-width="1.25"/>`;
    return symbol;
  }
  if (entry.kind === 'optional') {
    return `<circle cx="${entry.x + 8}" cy="${y + 5}" r="2.6" class="a-default" stroke-width="1.25"/>`;
  }
  return `<text x="${entry.x + 2}" y="${y + 9}" class="${KEY_ACCENT[entry.kind] || 't-muted'}" font-size="7" font-weight="600">${esc(entry.kind.toUpperCase())}</text>`;
}

function renderLegend() {
  const relationshipObstacles = relationshipLegendObstacles(relationships, {
    pointsFor: (relationship) => (renderableRelationship(relationship) ? pathFor(relationship).points : []),
    labelRectFor: (relationship) => {
      if (!relationship.label || !renderableRelationship(relationship)) return null;
      const [x, y] = labelPoint(relationship, pathFor(relationship).points);
      const width = Math.max(30, textUnits(relationship.label) * 4.8 + 10);
      return { x: x - width / 2, y: y - 10, width, height: 14 };
    },
  });
  const contentBottom = Math.max(0, ...[...entities.values()].map((entity) => entity.y + entity.height));
  return renderResolvedLegend({
    entries: erLegendEntries,
    locale: er.meta.locale,
    layout: {
      x: layout.margin,
      baselineY: legendY(),
      width: viewBox[0] - layout.margin * 2,
      minTitleY: contentBottom + 8,
      obstacles: relationshipObstacles,
      unfit: er.meta?.legend === undefined ? 'hide' : 'error',
      diagramType: 'erd',
    },
    renderSwatch: legendSwatch,
  });
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(er.meta)}>
${svgAccessibleText(er.meta, 'erd')}
${renderDefinitions(renderCardinalityDefs())}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Relationship paths (before entities for correct z-order) -->
${relationships.map((relationship, index) => (renderableRelationship(relationship) ? renderRelationshipPath(relationship, index) : '')).filter(Boolean).join('\n')}

        <!-- Entities -->
${[...entities.values()].map(renderEntity).join('\n\n')}

        <!-- Relationship labels -->
${relationships.map((relationship, index) => (renderableRelationship(relationship) ? renderRelationshipLabel(relationship, index) : '')).filter(Boolean).join('\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}

validateEr();
if (layoutJsonMode) {
  console.log(JSON.stringify(buildLayoutReport(), null, 2));
  process.exit(0);
}
writeDiagram({
  outPath,
  template,
  diagramType: 'erd',
  meta: er.meta,
  svg: renderSvg(),
  cards: er.cards,
});
