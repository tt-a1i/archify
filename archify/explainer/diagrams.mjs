import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { validateSchema } from '../renderers/shared/validator.mjs';
import { textUnits, SEMANTIC_SIGIL_FOOTPRINT } from '../renderers/shared/utils.mjs';
import { minimumNodeTextWidth } from '../renderers/shared/text-fit.mjs';
import { throwDiagnosticError } from '../renderers/shared/diagnostics.mjs';
import { createOwnedTempDirectory } from '../renderers/shared/owned-temp-directory.mjs';

const runFile = promisify(execFile);
const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle', 'erd', 'class', 'tree', 'timeline', 'waterfall']);
const MAX_SPEC_BYTES = 4 * 1024 * 1024;
const MAX_DIAGRAM_BYTES = 32 * 1024 * 1024;
const ID = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const freezeBytes = bytes => ({ sha256: hash(bytes), bytes: bytes.length, contentBase64: bytes.toString('base64') });

function subject(context, pointer, extra = {}) {
  const map = context.sourceMap;
  let lookup = pointer, location;
  while (lookup && !location) {
    location = map instanceof Map ? map.get(lookup) : map?.[lookup];
    lookup = lookup.slice(0, lookup.lastIndexOf('/'));
  }
  location ||= {};
  return { component: 'diagram', line: location.line || context.line || 1, path: pointer,
    ...(location.column ? { column: location.column } : {}), ...(context.sourcePath ? { input: context.sourcePath } : {}),
    ...(context.panelId ? { panelId: context.panelId } : {}), ...extra };
}

function fail(context, reason, message, example, fixes = [], cause) {
  throwDiagnosticError(message, [{ code: `explainer/${reason}`, severity: 'error', message,
    subject: subject(context, context.pointer || '/', context.subject),
    evidence: { reason, example: example || 'Use a native diagram spec with matching diagram_type.', ...(cause ? { native: cause } : {}) },
    supportedFixes: fixes.length ? fixes : [`Use this form: ${example || 'native JSON'}`] }]);
}

function safeId(value, context) {
  if (!ID.test(value || '')) fail(context, 'diagram-id', 'Diagram identities must use the native identifier syntax.', 'api | API | backend');
  return value;
}

function inferredId(label) {
  const slug = label.normalize('NFKC').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return ID.test(slug) ? slug : `actor-${hash(label).slice(0, 12)}`;
}

function rowParts(text) {
  let value = text.trim();
  if (value.startsWith('|') && value.endsWith('|')) value = value.slice(1, -1);
  return value.split('|').map(part => part.trim());
}

function duplicateCheck(items, context, kind) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item.id)) fail(context, 'diagram-id-duplicate', `Duplicate ${kind} identity ${item.id}.`, 'Use a unique id for every declaration.');
    seen.add(item.id);
  }
}

// Estimated native workflow canvas width for a column assignment: the widest node per column plus the
// column gaps, which widen for edge labels. Measured within about 10% of real canvases. The native gate
// projects 8px edge labels onto a 930px reader, so 1240px is the hard limit; this keeps a margin.
const READABLE_WORKFLOW_WIDTH = 1100;
function workflowWidth(nodes, edges) {
  const columns = Math.max(...nodes.map(node => node.col)) + 1;
  const widest = Array.from({ length: columns }, (_, col) => Math.max(92, ...nodes.filter(node => node.col === col).map(node => node.width || 0)));
  const colOf = new Map(nodes.map(node => [node.id, node.col]));
  const gaps = Array.from({ length: columns - 1 }, (_, col) => Math.max(34, ...edges.filter(edge => colOf.get(edge.from) === col && colOf.get(edge.to) === col + 1).map(edge => (edge.label ? textUnits(edge.label) * 5.4 : 0) + 16)));
  return widest.reduce((sum, width) => sum + width, 0) + gaps.reduce((sum, gap) => sum + gap, 0) + 80;
}

// Placement supplies native grid/lane hints only. Native renderers own sizing,
// ports, routes, labels, and all quality validation.
function rankedPlacement(nodes, edges) {
  const ids = new Set(nodes.map(node => node.id));
  const incoming = new Map(nodes.map(node => [node.id, 0]));
  const outgoing = new Map(nodes.map(node => [node.id, []]));
  for (const edge of edges) if (ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to) incoming.set(edge.to, incoming.get(edge.to) + 1);
  for (const edge of edges) if (edge.from !== edge.to) outgoing.get(edge.from)?.push(edge);
  const rank = new Map();
  const queue = nodes.filter(node => incoming.get(node.id) === 0).map(node => node.id);
  const visit = id => {
    if (!rank.has(id)) rank.set(id, 0);
    for (const edge of outgoing.get(id)) {
      if (!ids.has(edge.to)) continue;
      incoming.set(edge.to, incoming.get(edge.to) - 1);
      rank.set(edge.to, Math.max(rank.get(edge.to) || 0, rank.get(id) + 1));
      if (incoming.get(edge.to) === 0) queue.push(edge.to);
    }
  };
  for (let cursor = 0; cursor < queue.length; cursor++) visit(queue[cursor]);
  // A cyclic remainder stays a deterministic separate row; no authored edge is
  // dropped or converted into an invented forward relation.
  const nextRow = new Map();
  return nodes.map(node => {
    const col = rank.has(node.id) && incoming.get(node.id) === 0 ? rank.get(node.id) : 0;
    const row = nextRow.get(col) || 0;
    nextRow.set(col, row + 1);
    return { ...node, row, col };
  });
}

/** Compile a small author shorthand into an existing native Archify model. */
export function compileExplainerDiagram(diagramType, rows, { title, id, line = 1, quality = 'showcase' } = {}) {
  const context = { line, pointer: '/', id, diagramType, rowMap: {}, subject: { diagram: id, diagramType } };
  if (!TYPES.has(diagramType)) fail(context, 'diagram-type', 'Unknown native diagram type.', 'sequence');
  if (!Array.isArray(rows) || !rows.length) fail(context, 'diagram-rows', 'A shorthand diagram needs at least one row.', 'Client | API | 请求记录');
  const entries = rows.map((row, index) => {
    const ctx = { ...context, line: Number.isInteger(row?.line) ? row.line : line + index };
    const cells = Array.isArray(row) ? row : row?.cells;
    if (cells !== undefined) {
      if (!Array.isArray(cells) || !cells.length || cells.some(cell => typeof cell !== 'string')) fail(ctx, 'diagram-row', 'Each diagram row needs text cells.', 'Client | API | 请求记录');
      return { parts: cells.map(cell => cell.trim()), context: ctx };
    }
    const text = typeof row === 'string' ? row : row?.text;
    if (typeof text !== 'string' || !text.trim()) fail(ctx, 'diagram-row', 'Each diagram row needs text.', 'Client | API | 请求记录');
    return { parts: rowParts(text), context: ctx };
  });
  const spec = { schema_version: diagramType === 'workflow' ? 2 : 1, diagram_type: diagramType,
    meta: { title: title || id || diagramType, output: `${id && ID.test(id) ? id : 'diagram'}.html`, quality_profile: quality } };
  const expect = (entry, min, max, example) => {
    if (entry.parts.length < min || entry.parts.length > max || entry.parts.slice(0, min).some(part => !part)) {
      fail(entry.context, 'diagram-row', `Expected ${min === max ? min : `${min}–${max}`} pipe-separated fields.`, example);
    }
  };
  const edgeCounts = new Map();
  const edgeId = (from, to) => {
    const base = `${from}-to-${to}`;
    const count = (edgeCounts.get(base) || 0) + 1;
    edgeCounts.set(base, count);
    return `${base}-${count}`;
  };
  if (diagramType === 'sequence') {
    spec.participants = [];
    spec.messages = [];
    const aliases = new Map();
    const byId = new Map();
    for (const entry of entries.filter(entry => entry.parts[0].startsWith('actor '))) {
      expect(entry, 2, 3, 'actor api | API | backend');
      const actor = { id: safeId(entry.parts[0].slice(6).trim(), entry.context), label: entry.parts[1], type: entry.parts[2] || 'backend' };
      context.rowMap[`/participants/${spec.participants.length}`] = entry.context.line;
      spec.participants.push(actor); byId.set(actor.id, actor); aliases.set(actor.label, actor.id); aliases.set(actor.id, actor.id);
    }
    const actorId = (label, ctx) => {
      if (aliases.has(label)) return aliases.get(label);
      const actor = { id: inferredId(label), label, type: 'external' };
      if (byId.has(actor.id)) fail(ctx, 'diagram-actor-collision', 'Actor labels resolve to the same id; declare explicit actor identities.', 'actor client | Client | frontend');
      spec.participants.push(actor); byId.set(actor.id, actor); aliases.set(label, actor.id);
      return actor.id;
    };
    // "phase | label" rows open a labelled band over the messages that follow, up to the next phase.
    const phases = [];
    for (const entry of entries.filter(entry => !entry.parts[0].startsWith('actor '))) {
      if (entry.parts[0] === 'phase') { expect(entry, 2, 2, 'phase | TCP handshake'); phases.push({ label: entry.parts[1], first: spec.messages.length, context: entry.context }); continue; }
      expect(entry, 3, 4, 'Client | API | 请求记录 | return');
      const [fromLabel, toLabel, label, variant] = entry.parts;
      const from = actorId(fromLabel, entry.context), to = actorId(toLabel, entry.context);
      context.rowMap[`/messages/${spec.messages.length}`] = entry.context.line;
      spec.messages.push({ id: edgeId(from, to), from, to, label, y: 160 + spec.messages.length * 48, ...(variant ? { variant } : {}) });
    }
    phases.forEach((phase, index) => {
      const last = (phases[index + 1]?.first ?? spec.messages.length) - 1;
      if (last < phase.first) fail(phase.context, 'diagram-row', 'A phase needs at least one message after it.', 'phase | TCP handshake\n| browser | server | SYN |');
      (spec.segments ||= []).push({ from: spec.messages[phase.first].y - 22, to: spec.messages[last].y + 16, label: phase.label });
    });
    duplicateCheck(spec.participants, context, 'actor');
    if (!spec.messages.length) fail(context, 'diagram-rows', 'Sequence shorthand needs a message.', 'client | api | 请求记录');
  } else if (diagramType === 'architecture' || diagramType === 'workflow') {
    const nodes = [], edges = [], lanes = new Map(), nodeLanes = new Map();
    for (const entry of entries) {
      const route = entry.parts[0].match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*>\s*([a-zA-Z][a-zA-Z0-9_-]*)$/);
      if (diagramType === 'workflow' && entry.parts[0].startsWith('lane ')) {
        expect(entry, 2, 2, 'lane locate | Locate the cause');
        const laneId = safeId(entry.parts[0].slice(5).trim(), entry.context);
        if (lanes.has(laneId)) fail(entry.context, 'diagram-id-duplicate', 'Workflow lane ids must be unique.', 'lane locate | Locate the cause');
        lanes.set(laneId, { id: laneId, label: entry.parts[1] });
      } else if (route) {
        if (entry.parts.length > 3) fail(entry.context, 'diagram-row', 'An edge supports a label and optional native variant.', 'api > redis | 查询 | dashed');
        context.rowMap[`/${diagramType === 'architecture' ? 'connections' : 'edges'}/${edges.length}`] = entry.context.line;
        edges.push({ id: edgeId(route[1], route[2]), from: route[1], to: route[2], ...(entry.parts[1] ? { label: entry.parts[1] } : {}), ...(entry.parts[2] ? { variant: entry.parts[2] } : {}) });
      } else {
        if (diagramType === 'workflow') expect(entry, 2, 4, 'trace | Compare slow traces | backend | locate');
        else expect(entry, 2, 3, 'api | API | backend');
        context.rowMap[`/${diagramType === 'architecture' ? 'components' : 'nodes'}/${nodes.length}`] = entry.context.line;
        const node = { id: safeId(entry.parts[0], entry.context), label: entry.parts[1], type: entry.parts[2] || 'backend' };
        // Wide enough that the label stays centred between the corner icon and the opposite edge;
        // a narrower node drops the label below the icon, out of line with its neighbours.
        const labelWidth = Math.ceil(Math.max(textUnits(node.label) * 6.8 + 12, minimumNodeTextWidth(node.label, 11) + 2 * (SEMANTIC_SIGIL_FOOTPRINT + 2)));
        if (diagramType === 'workflow' && labelWidth > 92) node.width = labelWidth;
        // A question is a decision point: the native decision mark tells it apart from a step.
        if (diagramType === 'workflow' && /[?？]$/u.test(node.label)) node.icon = 'decision';
        if (entry.parts[3]) nodeLanes.set(node.id, { lane: safeId(entry.parts[3], entry.context), context: entry.context });
        nodes.push(node);
      }
    }
    duplicateCheck(nodes, context, 'node');
    const placed = rankedPlacement(nodes, edges);
    if (diagramType === 'architecture') {
      const cols = Math.max(1, ...placed.map(node => node.col + 1));
      if (cols > 12) fail(context, 'diagram-shorthand-limit', 'This architecture needs more than twelve native grid columns.', 'Use native JSON with explicit component positions.');
      const fitWidth = node => Math.ceil(textUnits(node.label) * 6.6 + 16);
      // Order each column by where its upstream nodes sit, then centre it against the tallest column,
      // so a hub sits between the nodes it connects instead of on the first row.
      const height = Math.max(...Array.from({ length: cols }, (_, col) => placed.filter(node => node.col === col).length));
      const rowOf = new Map();
      for (let col = 0; col < cols; col++) {
        const column = placed.filter(node => node.col === col);
        const upstream = node => { const rows = edges.filter(edge => edge.to === node.id && rowOf.has(edge.from)).map(edge => rowOf.get(edge.from)); return rows.length ? rows.reduce((sum, row) => sum + row, 0) / rows.length : node.row; };
        column.sort((a, b) => upstream(a) - upstream(b) || a.row - b.row)
          .forEach((node, i) => rowOf.set(node.id, Math.floor((height - column.length) / 2) + i));
      }
      spec.layout = { mode: 'grid', cols, cellW: Math.max(176, ...placed.map(fitWidth)), cellH: 76, gapX: 100, gapY: 110 };
      spec.components = placed.map(node => ({ ...node, row: rowOf.get(node.id), ...(fitWidth(node) > 120 ? { size: [fitWidth(node), 60] } : {}) }));
      spec.connections = edges;
    } else if (lanes.size) {
      for (const [id, { lane, context: ctx }] of nodeLanes) if (!lanes.has(lane)) fail(ctx, 'diagram-lane', `Node ${id} names an undeclared lane.`, 'lane locate | Locate the cause');
      const first = lanes.keys().next().value;
      const order = [...lanes.keys()];
      const ranked = [...placed].sort((a, b) => a.col - b.col || a.row - b.row).map(({ row, col, ...node }) => ({ ...node, lane: nodeLanes.get(node.id)?.lane || first }));
      // Prefer, in order: one row with phase labels above it; phase rows that step down so each hand-off
      // edge drops straight; phase rows that each restart at the left. Take the first that stays within
      // the readable width, since a wider canvas shrinks its edge labels below the native text floor.
      const row = [...ranked].sort((a, b) => order.indexOf(a.lane) - order.indexOf(b.lane));
      const used = [...lanes.values()].filter(lane => ranked.some(node => node.lane === lane.id));
      const sizes = used.map(lane => ranked.filter(node => node.lane === lane.id).length);
      const wrapped = stair => {
        const starts = sizes.map((_, i) => stair ? sizes.slice(0, i).reduce((sum, size) => sum + size - 1, 0) : 0);
        const nextCol = new Map(used.map((lane, i) => [lane.id, starts[i]]));
        return ranked.map(node => { const col = nextCol.get(node.lane); nextCol.set(node.lane, col + 1); return { ...node, col }; });
      };
      const single = row.map(({ lane, ...node }, col) => ({ ...node, lane: 'flow', col }));
      // Grouping by phase keeps the flow order only when each phase is one stretch of the flow.
      const inOrder = ranked.every((node, i) => i === 0 || order.indexOf(node.lane) >= order.indexOf(ranked[i - 1].lane));
      const candidates = [
        ...(inOrder && ranked.length <= 6 && placed.every(node => node.row === 0) ? [{ nodes: single, single: true }] : []),
        ...(inOrder && sizes.reduce((sum, size) => sum + size, 0) - (sizes.length - 1) <= 6 ? [{ nodes: wrapped(true) }] : []),
        { nodes: wrapped(false) },
      ];
      const chosen = candidates.find(candidate => workflowWidth(candidate.nodes, edges) <= READABLE_WORKFLOW_WIDTH) || candidates.at(-1);
      spec.nodes = chosen.nodes;
      if (chosen.single) {
        spec.lanes = [{ id: 'flow', label: spec.meta.title }];
        spec.phases = order.map(id => ({ id, label: lanes.get(id).label, cols: row.flatMap((node, col) => node.lane === id ? [col] : []) })).filter(phase => phase.cols.length).map(({ cols, ...phase }) => ({ ...phase, fromCol: cols[0], toCol: cols.at(-1) }));
      } else spec.lanes = used;
      if (spec.nodes.some(node => node.col > 5)) fail(context, 'diagram-shorthand-limit', 'A workflow lane holds at most six nodes.', 'Split the process into another lane.');
      spec.edges = edges;
    } else {
      // A process too wide for one readable row wraps by columns into stacked bands, keeping each
      // band's branch rows, and steps each band down under the end of the previous one where six
      // columns allow, the same way declared phases do.
      const fits = laid => laid.every(node => node.col <= 5) && workflowWidth(laid, edges) <= READABLE_WORKFLOW_WIDTH;
      let wrapped;
      if (!fits(placed)) {
        const branchRows = Math.max(...placed.map(node => node.row)) + 1;
        for (let size = 5; size >= 2 && !wrapped; size--) {
          for (const stair of [true, false]) {
            const laid = placed.map(node => { const band = Math.floor(node.col / size); return { ...node, row: band * branchRows + node.row, col: (stair ? band * (size - 1) : 0) + node.col - band * size }; });
            const used = [...new Set(laid.map(node => node.row))].sort((a, b) => a - b);
            const compact = laid.map(node => ({ ...node, row: used.indexOf(node.row) }));
            if (fits(compact)) { wrapped = compact; break; }
          }
        }
      }
      const rows = wrapped || placed;
      if (rows.some(node => node.col > 5)) fail(context, 'diagram-shorthand-limit', 'Native workflow columns are limited to 0–5.', 'Declare phase lanes with "lane <id> | label" rows and assign nodes to them.');
      spec.lanes = Array.from({ length: Math.max(1, ...rows.map(node => node.row + 1)) }, (_, row) => ({ id: `lane-${row}`, label: wrapped ? `${spec.meta.title} · ${row + 1}` : row ? `分支 ${row}` : spec.meta.title }));
      spec.nodes = rows.map(({ row, ...node }) => ({ ...node, lane: `lane-${row}` }));
      spec.edges = edges;
    }
  } else if (diagramType === 'tree') {
    spec.nodes = entries.map((entry, index) => {
      expect(entry, 2, 3, 'api | API 服务 | root');
      context.rowMap[`/nodes/${index}`] = entry.context.line;
      const [nodeId, label, parent] = entry.parts;
      return { id: safeId(nodeId, entry.context), label, ...(parent && parent !== '-' ? { parent: safeId(parent, entry.context) } : {}) };
    });
    duplicateCheck(spec.nodes, context, 'node');
  } else if (diagramType === 'timeline') {
    spec.meta.evidence = 'illustrative';
    const lanes = new Map(); spec.events = [];
    for (const entry of entries) {
      if (entry.parts[0].startsWith('lane ')) {
        expect(entry, 2, 2, 'lane release | 发布');
        const laneId = safeId(entry.parts[0].slice(5).trim(), entry.context);
        if (lanes.has(laneId)) fail(entry.context, 'diagram-id-duplicate', 'Timeline lane ids must be unique.', 'lane release | 发布');
        lanes.set(laneId, { id: laneId, label: entry.parts[1] });
      }
    }
    for (const entry of entries.filter(entry => !entry.parts[0].startsWith('lane '))) {
      expect(entry, 3, 5, 'deploy | 2026-10-01T10:00:00+08:00 | 发布 v2 | release | change');
      const [eventId, at, eventTitle, authoredLane, kind] = entry.parts;
      const lane = authoredLane || 'events'; safeId(lane, entry.context);
      if (!lanes.has(lane)) lanes.set(lane, { id: lane, label: lane });
      context.rowMap[`/events/${spec.events.length}`] = entry.context.line;
      spec.events.push({ id: safeId(eventId, entry.context), at, title: eventTitle, lane, ...(kind ? { kind } : {}) });
    }
    spec.lanes = [...lanes.values()]; duplicateCheck(spec.events, context, 'event');
  } else if (diagramType === 'erd') {
    const entities = new Map(); spec.relationships = [];
    for (const entry of entries.filter(entry => entry.parts[0].startsWith('entity '))) {
      expect(entry, 2, 2, 'entity user | 用户');
      const entityId = safeId(entry.parts[0].slice(7).trim(), entry.context);
      if (entities.has(entityId)) fail(entry.context, 'diagram-id-duplicate', 'Entity ids must be unique.', 'entity user | 用户');
      entities.set(entityId, { id: entityId, label: entry.parts[1], row: 0, col: entities.size, attributes: [] });
    }
    for (const entry of entries.filter(entry => !entry.parts[0].startsWith('entity '))) {
      const route = entry.parts[0].match(/^([a-zA-Z][a-zA-Z0-9_-]*)\s*>\s*([a-zA-Z][a-zA-Z0-9_-]*)$/);
      if (route) {
        expect(entry, 2, 3, 'order > user | many:one | 下单者');
        const cardinality = entry.parts[1].match(/^(one|many):(one|many)$/);
        if (!cardinality) fail(entry.context, 'diagram-cardinality', 'Relationship cardinality must be explicit.', 'order > user | many:one | 下单者');
        spec.relationships.push({ id: edgeId(route[1], route[2]), from: route[1], to: route[2], fromCardinality: cardinality[1], toCardinality: cardinality[2], ...(entry.parts[2] ? { label: entry.parts[2] } : {}) });
      } else {
        expect(entry, 2, 4, 'order.user_id | bigint | fk | user.id');
        const field = entry.parts[0].match(/^([a-zA-Z][a-zA-Z0-9_-]*)\.([a-zA-Z][a-zA-Z0-9_]*)$/);
        if (!field || !entities.has(field[1])) fail(entry.context, 'diagram-field', 'A field must name an explicitly declared entity.', 'entity user | 用户\nuser.id | bigint | pk');
        const roles = entry.parts[2]?.split(',').map(value => value.trim()).filter(Boolean);
        entities.get(field[1]).attributes.push({ name: field[2], type: entry.parts[1], ...(roles?.length ? { key: roles.length === 1 ? roles[0] : roles } : {}), ...(entry.parts[3] ? { references: entry.parts[3] } : {}) });
      }
    }
    spec.layout = { mode: 'grid', gapX: 96, gapY: 64 }; spec.entities = [...entities.values()];
  } else {
    fail(context, 'diagram-shorthand-unsupported', `The ${diagramType} type uses native JSON instead of shorthand rows.`, `Use spec with diagram_type: ${diagramType}, or source: diagram.${diagramType}.json.`);
  }
  try { validateSchema(diagramType, spec); } catch (error) { rethrowNative(error, context, 'diagram-schema'); }
  return spec;
}

function rethrowNative(error, context, reason) {
  let details = error.archifyDiagnostics || error.diagnostics || [];
  if (!details.length && Array.isArray(error.checks)) {
    details = error.checks.filter(check => !check.ok).flatMap(check => (check.details?.length ? check.details : [`Native check ${check.name} failed.`])
      .map(message => ({ code: `check/${check.name}`, severity: 'error', message, evidence: check })));
    if (!details.length) details = (error.composition?.issues || []).filter(issue => issue.severity === 'error')
      .map(issue => ({ ...issue, message: issue.code === 'composition/desktop-readability' && issue.projectedFontPx
        ? `Text "${issue.text}" on ${issue.owner?.kind || 'element'} ${issue.owner?.id || ''} would show at ${issue.projectedFontPx.toFixed(1)}px, below ${issue.minimumProjectedFontPx}px: the diagram is ${Math.round(issue.viewBoxWidth)}px wide and shrinks to ${Math.round(issue.scale * 100)}% on the page. Make it narrower: at most four or five nodes per row, shorter node labels, or phases.`
        : issue.detail || `Native quality check ${issue.code} failed.` }));
  }
  if (details.length) throwDiagnosticError('Native diagram validation failed.', details.map(entry => ({
    code: `explainer/${reason}`, severity: entry.severity || 'error', message: entry.message,
    subject: subject({ ...context, line: context.rowMap?.[entry.subject?.path?.match(/^\/[^/]+\/\d+/)?.[0]] || context.line },
      (context.pointer && entry.subject?.path && !context.rowMap) ? `${context.pointer}/spec${entry.subject.path}` : context.pointer || '/',
      { diagramType: context.diagramType, diagram: context.id }),
    evidence: { reason, example: `Use a valid native ${context.diagramType || 'diagram'} JSON specification.`, native: entry },
    supportedFixes: entry.supportedFixes?.length ? entry.supportedFixes : ['Repair the native diagnostic and render again.'],
  })));
  fail(context, reason, 'The native diagram toolchain could not complete this diagram.', `Use a valid native ${context.diagramType || 'diagram'} JSON specification.`, [], { message: String(error.message || error).slice(0, 1000) });
}

function readSpec(baseDir, relative, context) {
  if (!baseDir || typeof relative !== 'string' || !relative || path.isAbsolute(relative) || /[\\:\u0000-\u001f?#]/.test(relative)
      || relative.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git') || !/\.json$/i.test(relative)) {
    fail(context, 'diagram-source-path', 'Diagram source must be a relative JSON file inside the input directory.', 'diagrams/request.sequence.json');
  }
  let fd;
  try {
    const root = fs.realpathSync(baseDir), ancestors = [[root, fs.lstatSync(root)]];
    let candidate = root;
    for (const part of relative.split('/')) {
      candidate = path.join(candidate, part); const stat = fs.lstatSync(candidate);
      if (stat.isSymbolicLink()) fail(context, 'diagram-source-symlink', 'Diagram sources may not traverse symbolic links.', 'request.sequence.json');
      ancestors.push([candidate, stat]);
    }
    const expected = ancestors.at(-1)[1];
    if (!expected.isFile() || expected.size > MAX_SPEC_BYTES) fail(context, 'diagram-source-size', 'Diagram source must be a regular JSON file smaller than 4 MiB.', 'request.sequence.json');
    fd = fs.openSync(candidate, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = fs.fstatSync(fd);
    const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
    if (!same(before, expected)) fail(context, 'diagram-source-changed', 'Diagram source changed while being frozen.', 'Finish edits before rendering.');
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!count) break;
      offset += count;
    }
    if (offset !== bytes.length || !same(before, fs.fstatSync(fd)) || !ancestors.every(([name, stat]) => { const current = fs.lstatSync(name); return !current.isSymbolicLink() && same(current, stat); })) {
      fail(context, 'diagram-source-changed', 'Diagram source changed while being frozen.', 'Finish edits before rendering.');
    }
    return bytes;
  } catch (error) {
    if (error.archifyDiagnostics) throw error;
    fail(context, 'diagram-source-read', 'Diagram source cannot be read safely inside the input directory.', 'request.sequence.json');
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

function decode(value) {
  return value.replace(/&(?:quot|apos|lt|gt|amp|#\d+|#x[\da-f]+);/gi, entity => {
    const named = { '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&amp;': '&' };
    if (Object.hasOwn(named, entity)) return named[entity];
    const code = entity.startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

function attrs(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(match => [match[1], decode(match[2])]));
}

function semanticOf(svg) {
  const nodes = new Map(), edges = new Map();
  for (const match of svg.matchAll(/<[a-zA-Z][^>]*>/g)) {
    const values = attrs(match[0]);
    if (values['data-node-id']) nodes.set(values['data-node-id'], { id: values['data-node-id'], label: values['data-node-label'] || values['data-node-id'], svgId: values.id });
    if (values['data-edge-from'] && values['data-edge-to']) {
      const id = values['data-edge-id'] || values['data-edge-key'] || `${values['data-edge-from']}~${values['data-edge-to']}`;
      edges.set(id, { id, from: values['data-edge-from'], to: values['data-edge-to'], label: values['data-edge-label'] || '',
        ...(values['data-edge-key'] ? { key: values['data-edge-key'] } : {}) });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

function changesPreview(svg, changes, semantic, context) {
  if (changes !== undefined && !Array.isArray(changes)) fail(context, 'diagram-change', 'Structural changes must be an array of explicit target marks.', '[{target:"api",change:"modified"}]');
  const nodes = new Set(semantic.nodes.map(node => node.id)), edges = new Set(semantic.edges.map(edge => edge.id));
  const byTarget = new Map();
  for (const change of changes || []) {
    if (!change || !['added', 'removed', 'modified'].includes(change.change) || typeof change.target !== 'string') fail(context, 'diagram-change', 'A structural change needs an explicit target and change type.', '{target:"api",change:"modified"}');
    if (!nodes.has(change.target) && !edges.has(change.target)) fail(context, 'diagram-change-target', 'The change target is absent from the authored native topology.', '{target:"api",change:"modified"}');
    if (byTarget.has(change.target)) fail(context, 'diagram-change-duplicate', 'A target may have only one structural change mark.', '{target:"api",change:"modified"}');
    byTarget.set(change.target, change.change);
  }
  return svg.replace(/<[a-zA-Z][^>]*>/g, tag => {
    const values = attrs(tag), change = byTarget.get(values['data-node-id']) || byTarget.get(values['data-edge-id']);
    return change ? tag.replace(/(\/?>)$/, ` data-explainer-change="${change}"$1`) : tag;
  });
}

async function nativeProcess(script, args, options, context, reason) {
  try {
    const result = await runFile(process.execPath, [script, ...args], { cwd: options.cwd || skillRoot, maxBuffer: MAX_DIAGRAM_BYTES,
      timeout: 120000, env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json', ARCHIFY_QUALITY_PROFILE: options.quality,
        ...(options.repoRoot ? { ARCHIFY_REPO_ROOT: path.resolve(options.repoRoot) } : {}) } });
    return result;
  } catch (error) {
    let native;
    for (const output of [error.stdout, error.stderr]) { try { native = JSON.parse(output); if (native.diagnostics) break; } catch {} }
    rethrowNative(native || error, context, reason);
  }
}

/** Freeze native diagrams, validate, render, and check without a per-child browser gate. */
export async function prepareExplainerDiagrams(document, { repoRoot, baseDir, quality = 'showcase', sourceMap, sourcePath } = {}) {
  const diagrams = Object.create(null), dependencies = [], blocks = [];
  for (const [panelIndex, panel] of (document.panels || []).entries()) {
    for (const [blockIndex, block] of (panel.blocks || []).entries()) if (block.type === 'diagram') blocks.push({ block, pointer: `/panels/${panelIndex}/blocks/${blockIndex}`, panelId: panel.id });
  }
  // Legacy flat draft shapes are accepted only as adapter inputs; canonical
  // explainer validation remains the parent pipeline's responsibility.
  for (const [blockIndex, block] of (document.blocks || []).entries()) if (block.type === 'diagram') blocks.push({ block, pointer: `/blocks/${blockIndex}` });
  for (const entry of blocks) {
    const { block, pointer, panelId } = entry, context = { pointer, panelId, sourceMap, sourcePath, id: block.id, diagramType: block.diagramType };
    if (typeof block.id !== 'string' || !block.id || Object.hasOwn(diagrams, block.id)) fail(context, 'diagram-id', 'Diagram blocks need unique stable identities.', '{id:"request",type:"diagram",diagramType:"sequence",spec:{...}}');
    if (!TYPES.has(block.diagramType)) fail(context, 'diagram-type', 'Unknown native diagram type.', 'sequence');
    if ((block.spec !== undefined) === (block.source !== undefined)) fail(context, 'diagram-input', 'Provide exactly one inline spec or relative source.', 'source: request.sequence.json');
    let originalBytes;
    if (block.source !== undefined) originalBytes = readSpec(baseDir, block.source, { ...context, pointer: `${pointer}/source` });
    else {
      try { originalBytes = Buffer.from(JSON.stringify(block.spec)); } catch { fail(context, 'diagram-spec', 'Inline native JSON must be serializable.', 'spec: {schema_version:1,diagram_type:"tree",meta:{title:"Tree"},nodes:[...]}'); }
      if (originalBytes.length > MAX_SPEC_BYTES) fail(context, 'diagram-source-size', 'Inline diagram JSON exceeds 4 MiB.', 'Use a smaller native JSON specification.');
    }
    let original;
    try { original = JSON.parse(originalBytes.toString('utf8')); } catch { fail(context, 'diagram-json', 'Diagram source is not valid JSON.', '{"schema_version":1,"diagram_type":"sequence","meta":{"title":"Request"},"participants":[],"messages":[]}'); }
    if (!original || typeof original !== 'object' || Array.isArray(original) || original.diagram_type !== block.diagramType) fail(context, 'diagram-type-mismatch', 'Native specification diagram_type must match its explainer block.', `diagram_type: ${block.diagramType}`);
    dependencies.push({ kind: 'diagram-spec', id: block.id, ...(block.source ? { path: path.resolve(baseDir, block.source), relativePath: block.source } : { inline: true }), ...freezeBytes(originalBytes) });
    const temporary = createOwnedTempDirectory('archify-explainer-diagram-');
    try {
      const output = path.join(temporary.path, 'diagram.html'), input = path.join(temporary.path, 'diagram.json');
      // Inline diagrams belong to the explainer's reading context. Keep the
      // original author bytes frozen; apply inheritance only to native render
      // input. Referenced standalone specs retain their own locale defaults.
      const inheritedLocale = block.spec !== undefined && original.meta?.locale === undefined && document.meta?.locale !== undefined
        ? { locale: document.meta.locale } : {};
      const spec = { ...original, meta: { ...original.meta, ...inheritedLocale, output: 'diagram.html', quality_profile: quality } };
      try { validateSchema(block.diagramType, spec); } catch (error) { rethrowNative(error, context, 'diagram-schema'); }
      fs.writeFileSync(input, JSON.stringify(spec), { flag: 'wx' });
      await nativeProcess(path.join(skillRoot, 'renderers', block.diagramType, `render-${block.diagramType}.mjs`), [input, output], { repoRoot, quality, cwd: temporary.path }, context, 'diagram-render');
      const checked = await nativeProcess(path.join(skillRoot, 'scripts/check-render-output.mjs'), [output], { repoRoot, quality, cwd: temporary.path }, context, 'diagram-check');
      let check;
      try { check = JSON.parse(checked.stdout); } catch { fail(context, 'diagram-check-receipt', 'Native checker returned no structured receipt.', 'Rerun the native diagram check.'); }
      if (check.ok === false) rethrowNative(check, context, 'diagram-check');
      const bytes = fs.readFileSync(output);
      if (bytes.length > MAX_DIAGRAM_BYTES) fail(context, 'diagram-artifact-size', 'The native diagram artifact exceeds 32 MiB.', 'Use a smaller native diagram.');
      const html = bytes.toString('utf8'), svgMatch = html.match(/<svg\b[^>]*\bdata-quality-profile="[^"]*"[^>]*>[\s\S]*?<\/svg>/);
      if (!svgMatch) fail(context, 'diagram-svg', 'The native renderer produced no primary semantic SVG.', 'Use a supported native diagram renderer.');
      const canonicalSvg = svgMatch[0], semantic = semanticOf(canonicalSvg);
      const svg = changesPreview(canonicalSvg, block.changes, semantic, context);
      // Preview styles are derived from html at render time; storing them again would double the page.
      diagrams[block.id] = { diagramType: block.diagramType, spec: original, html, svg, sha256: hash(bytes), bytes: bytes.length,
        specification: freezeBytes(originalBytes), checks: { validate: { ok: true }, render: { ok: true }, check }, semantic,
        ...(block.changes ? { changes: block.changes.map(change => ({ ...change })) } : {}) };
    } finally { await temporary.cleanup(); }
  }
  return { diagrams, dependencies };
}

/** Resolve a reference against the actual native SVG graph, including real routes. */
export function validateExplainerDiagramTarget(diagrams, target, { sourceMap, sourcePath, pointer = '/', line = 1 } = {}) {
  const context = { sourceMap, sourcePath, pointer, line };
  const diagram = diagrams?.[target?.diagram];
  if (!diagram) fail(context, 'diagram-reference', 'The reference names an unknown diagram block.', '{diagram:"request",node:"api"}');
  const nodes = new Set(diagram.semantic.nodes.map(node => node.id)), edges = diagram.semantic.edges;
  if (target.node !== undefined && !nodes.has(target.node)) fail(context, 'diagram-node-reference', 'The reference names a node absent from the native diagram.', `{diagram:"${target.diagram}",node:"${diagram.semantic.nodes[0]?.id || 'api'}"}`);
  if (target.edges !== undefined && (!Array.isArray(target.edges) || !target.edges.length || target.edges.some(id => !edges.some(edge => edge.id === id)))) fail(context, 'diagram-edge-reference', 'The reference names an edge absent from the native diagram.', `{diagram:"${target.diagram}",edges:["${edges[0]?.id || 'api-to-db-1'}"]}`);
  if (target.route !== undefined) {
    if (!Array.isArray(target.route) || target.route.length !== 2 || !target.route.every(id => nodes.has(id))) fail(context, 'diagram-route-reference', 'A route needs two real native node identities.', `{diagram:"${target.diagram}",route:["api","db"]}`);
    const [from, to] = target.route, visited = new Set([from]), queue = [from];
    for (let index = 0; index < queue.length; index++) for (const edge of edges.filter(edge => edge.from === queue[index])) if (!visited.has(edge.to)) { visited.add(edge.to); queue.push(edge.to); }
    if (!visited.has(to)) fail(context, 'diagram-route-reference', 'No directed route connects these nodes in the native diagram.', `{diagram:"${target.diagram}",route:["${edges[0]?.from || 'api'}","${edges[0]?.to || 'db'}"]}`);
  }
  return true;
}
