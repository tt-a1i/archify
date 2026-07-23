const COMPARATOR_VERSION = 1;
const CANONICAL_VERSION = 1;

export class ArchitectureDeltaError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ArchitectureDeltaError';
    this.code = code;
    this.details = details;
  }
}

const codepointOrder = (left, right) => (left < right ? -1 : left > right ? 1 : 0);
const sorted = (values) => [...values].sort((left, right) => codepointOrder(String(left), String(right)));

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(codepointOrder).map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

const equal = (left, right) => canonical(left) === canonical(right);

function sortedObjects(values) {
  return [...values].sort((left, right) => codepointOrder(canonical(left), canonical(right)));
}

function sortedBy(values, keyFor) {
  return [...values].sort((left, right) => codepointOrder(String(keyFor(left)), String(keyFor(right))));
}

function normalizeRepository(repository) {
  if (!repository) return undefined;
  return {
    url: String(repository.url || '').trim().replace(/\.git\/?$/i, '').replace(/\/$/, '').toLowerCase(),
    revision: String(repository.revision || '').toLowerCase(),
  };
}

function normalizeComponent(component) {
  return {
    ...component,
    ...(Array.isArray(component.sources) ? { sources: sortedObjects(component.sources) } : {}),
  };
}

function normalizeBoundary(boundary) {
  return { ...boundary, wraps: sorted(boundary.wraps || []) };
}

export function canonicalArchitecture(diagram) {
  const meta = { ...(diagram.meta || {}) };
  delete meta.output;
  if (meta.repository) meta.repository = normalizeRepository(meta.repository);
  return {
    schema_version: diagram.schema_version,
    diagram_type: diagram.diagram_type,
    meta,
    ...(diagram.layout ? { layout: diagram.layout } : {}),
    components: sortedBy((diagram.components || []).map(normalizeComponent), (component) => component.id),
    boundaries: sortedBy((diagram.boundaries || []).map(normalizeBoundary), boundaryKey),
    connections: sortedBy(diagram.connections || [], (connection) => connection.id || ''),
    ...(diagram.cards ? { cards: diagram.cards } : {}),
  };
}

export function canonicalArchitectureJson(diagram) {
  return canonical(canonicalArchitecture(diagram));
}

function fail(code, message, details) {
  throw new ArchitectureDeltaError(code, message, details);
}

function requireComparableShape(diagram, side) {
  if (diagram?.schema_version !== 1) {
    fail('delta/schema-version-mismatch', `${side} must use schema_version 1.`, { side, path: '/schema_version', actual: diagram?.schema_version });
  }
  if (diagram?.diagram_type !== 'architecture') {
    fail('delta/type-mismatch', `${side} must use diagram_type architecture.`, { side, path: '/diagram_type', actual: diagram?.diagram_type });
  }
}

function stableIndex(items, collection, side, missingCode = 'delta/stable-id-required') {
  const index = new Map();
  const missing = [];
  const duplicates = [];
  (items || []).forEach((item, itemIndex) => {
    if (!item?.id) missing.push(`/${collection}/${itemIndex}/id`);
    else if (index.has(item.id)) duplicates.push(item.id);
    else index.set(item.id, item);
  });
  if (missing.length) {
    fail(missingCode, `${side} ${collection} require authored stable ids for comparison.`, {
      side,
      paths: sorted(missing),
      supportedFixes: [`add a unique id to every ${collection} item`],
    });
  }
  if (duplicates.length) {
    fail('delta/duplicate-stable-id', `${side} ${collection} contain duplicate ids.`, {
      side,
      collection,
      ids: sorted(new Set(duplicates)),
      supportedFixes: [`make every ${collection} id unique`],
    });
  }
  return index;
}

const boundaryKey = (boundary) => `${boundary.kind}\u001f${boundary.label}`;

function boundaryIndex(boundaries, side) {
  const index = new Map();
  const ambiguous = [];
  for (const boundary of boundaries || []) {
    const key = boundaryKey(boundary);
    if (index.has(key)) ambiguous.push(`${boundary.kind}:${boundary.label}`);
    else index.set(key, boundary);
  }
  if (ambiguous.length) {
    fail('delta/boundary-key-ambiguous', `${side} boundary kind + label keys must be unique.`, {
      side,
      boundaries: sorted(new Set(ambiguous)),
      supportedFixes: ['rename one duplicate boundary or add stable boundary ids in a future schema version'],
    });
  }
  return index;
}

function normalizedField(item, field) {
  const value = item?.[field];
  if (field === 'sources' && Array.isArray(value)) return sortedObjects(value);
  if (field === 'wraps' && Array.isArray(value)) return sorted(value);
  return value;
}

function fieldChanges(before, after, groups) {
  const classifications = [];
  const changedFields = [];
  for (const [classification, fields] of Object.entries(groups)) {
    const changed = fields.filter((field) => !equal(normalizedField(before, field), normalizedField(after, field)));
    if (changed.length) classifications.push(classification);
    changedFields.push(...changed.map((field) => `/${field}`));
  }
  return { classifications: sorted(classifications), changedFields: sorted(changedFields) };
}

const COMPONENT_FIELDS = {
  semantic: ['type', 'label', 'sublabel', 'tag'],
  evidence: ['sources'],
  geometry: ['row', 'col', 'pos', 'size'],
};
const CONNECTION_FIELDS = {
  topology: ['from', 'to'],
  semantic: ['label', 'variant'],
  geometry: ['fromSide', 'toSide', 'route', 'via', 'labelAt', 'labelDx', 'labelDy', 'labelSegment', 'width'],
};
const BOUNDARY_FIELDS = { scope: ['wraps'], geometry: ['pad'] };

function statusFor(classifications, kind) {
  if (classifications.some((value) => ['topology', 'semantic', 'scope'].includes(value))) return 'changed';
  if (classifications.includes('evidence')) return 'evidence-changed';
  if (classifications.includes('geometry')) return kind === 'connection' ? 'rerouted' : kind === 'component' ? 'moved' : 'geometry-changed';
  return 'same';
}

function compareEntities(baseIndex, headIndex, kind, groups, describe) {
  const changes = [];
  const identityClassification = kind === 'connection' ? 'topology' : kind === 'boundary' ? 'scope' : 'semantic';
  for (const id of sorted(new Set([...baseIndex.keys(), ...headIndex.keys()]))) {
    const base = baseIndex.get(id);
    const head = headIndex.get(id);
    if (!base) changes.push({ ...describe(id, undefined, head), status: 'added', classifications: [identityClassification], changedFields: [] });
    else if (!head) changes.push({ ...describe(id, base, undefined), status: 'removed', classifications: [identityClassification], changedFields: [] });
    else {
      const fields = fieldChanges(base, head, groups);
      const status = statusFor(fields.classifications, kind);
      if (status !== 'same') changes.push({ ...describe(id, base, head), status, ...fields });
    }
  }
  return changes;
}

function summaryFor(changes, shape) {
  const summary = Object.fromEntries(shape.map((key) => [key, 0]));
  for (const change of changes) {
    const key = change.status.replace(/-([a-z])/g, (_all, letter) => letter.toUpperCase());
    if (Object.hasOwn(summary, key)) summary[key] += 1;
  }
  return summary;
}

function presentationChanged(base, head) {
  const basePresentation = {
    title: base.meta?.title,
    subtitle: base.meta?.subtitle,
    animation: base.meta?.animation,
    visual_preset: base.meta?.visual_preset,
    quality_profile: base.meta?.quality_profile,
    engineering_profile: base.meta?.engineering_profile,
    views: base.meta?.views,
    viewBox: base.meta?.viewBox,
    layout: base.layout,
    cards: base.cards,
  };
  const headPresentation = {
    title: head.meta?.title,
    subtitle: head.meta?.subtitle,
    animation: head.meta?.animation,
    visual_preset: head.meta?.visual_preset,
    quality_profile: head.meta?.quality_profile,
    engineering_profile: head.meta?.engineering_profile,
    views: head.meta?.views,
    viewBox: head.meta?.viewBox,
    layout: head.layout,
    cards: head.cards,
  };
  return !equal(basePresentation, headPresentation);
}

export function compareArchitecture(base, head, evidence = {}) {
  requireComparableShape(base, 'base');
  requireComparableShape(head, 'head');
  const baseComponents = stableIndex(base.components, 'components', 'base');
  const headComponents = stableIndex(head.components, 'components', 'head');
  const shared = sorted([...baseComponents.keys()].filter((id) => headComponents.has(id)));
  if (!shared.length) {
    fail('delta/no-shared-component-id', 'The snapshots share no component id, so Archify cannot prove that they describe the same system.', {
      supportedFixes: ['preserve at least one authored component id across snapshots'],
    });
  }

  const baseConnections = stableIndex(base.connections, 'connections', 'base', 'delta/relationship-id-required');
  const headConnections = stableIndex(head.connections, 'connections', 'head', 'delta/relationship-id-required');
  const baseBoundaries = boundaryIndex(base.boundaries, 'base');
  const headBoundaries = boundaryIndex(head.boundaries, 'head');

  const baseRepository = normalizeRepository(base.meta?.repository);
  const headRepository = normalizeRepository(head.meta?.repository);
  if (baseRepository && headRepository && baseRepository.url !== headRepository.url) {
    fail('delta/repository-mismatch', 'The snapshots name different repositories.', {
      baseRepository: baseRepository.url,
      headRepository: headRepository.url,
      supportedFixes: ['compare snapshots from the same repository or remove repository evidence from both inputs'],
    });
  }
  const proofLevel = baseRepository && headRepository
    && evidence.baseVerified && evidence.headVerified
    && /^[a-f0-9]{40}$/.test(baseRepository.revision)
    && /^[a-f0-9]{40}$/.test(headRepository.revision)
    ? 'revision-pinned'
    : 'authored';

  const components = compareEntities(baseComponents, headComponents, 'component', COMPONENT_FIELDS, (id, before, after) => ({
    id,
    baseLabel: before?.label,
    headLabel: after?.label,
  }));
  const connections = compareEntities(baseConnections, headConnections, 'connection', CONNECTION_FIELDS, (id, before, after) => ({
    id,
    ...(before ? { base: { from: before.from, to: before.to, label: before.label || '' } } : {}),
    ...(after ? { head: { from: after.from, to: after.to, label: after.label || '' } } : {}),
  }));
  const boundaries = compareEntities(baseBoundaries, headBoundaries, 'boundary', BOUNDARY_FIELDS, (_key, before, after) => ({
    key: `${(after || before).kind}:${(after || before).label}`,
    kind: (after || before).kind,
    label: (after || before).label,
  }));
  const provenanceChanged = !equal(baseRepository, headRepository);

  return {
    schemaVersion: 1,
    ok: true,
    command: 'compare',
    type: 'architecture',
    comparatorVersion: COMPARATOR_VERSION,
    canonicalVersion: CANONICAL_VERSION,
    completeness: 'complete',
    proofLevel,
    base: {
      title: base.meta?.title || '',
      ...(evidence.baseRawSha256 ? { rawSha256: evidence.baseRawSha256 } : {}),
      ...(evidence.baseSemanticSha256 ? { semanticSha256: evidence.baseSemanticSha256 } : {}),
      ...(Number.isInteger(evidence.baseBytes) ? { bytes: evidence.baseBytes } : {}),
      ...(baseRepository?.revision ? { revision: baseRepository.revision } : {}),
    },
    head: {
      title: head.meta?.title || '',
      ...(evidence.headRawSha256 ? { rawSha256: evidence.headRawSha256 } : {}),
      ...(evidence.headSemanticSha256 ? { semanticSha256: evidence.headSemanticSha256 } : {}),
      ...(Number.isInteger(evidence.headBytes) ? { bytes: evidence.headBytes } : {}),
      ...(headRepository?.revision ? { revision: headRepository.revision } : {}),
    },
    summary: {
      components: summaryFor(components, ['added', 'changed', 'evidenceChanged', 'removed', 'moved']),
      connections: summaryFor(connections, ['added', 'changed', 'removed', 'rerouted']),
      boundaries: summaryFor(boundaries, ['added', 'changed', 'removed', 'geometryChanged']),
      presentationChanged: presentationChanged(base, head),
      provenanceChanged,
    },
    changes: { components, connections, boundaries },
    identity: {
      components: 'components[].id',
      connections: 'connections[].id (required)',
      boundaries: 'boundaries[].kind + boundaries[].label (derived)',
    },
    view: { visualPreset: head.meta?.visual_preset || 'classic' },
    limitations: [
      'Authored Architecture IR only; no runtime impact, causality, risk, or mergeability is inferred.',
      'Boundary identity is conservatively derived from kind + label.',
    ],
  };
}

function esc(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

const safeJson = (value) => JSON.stringify(value, null, 2).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');

export function extractArchitectureSvg(html) {
  const match = html.match(/<svg viewBox="0 0 [^"]+" role="img"[\s\S]*?<\/svg>/);
  if (!match) fail('delta/svg-missing', 'A validated Architecture artifact did not contain its primary SVG.');
  return match[0];
}

export function extractArtifactCss(html) {
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!match) fail('delta/css-missing', 'A validated Architecture artifact did not contain its stylesheet.');
  return match[1];
}

function changeMap(changes) {
  return new Map(changes.map((change) => [change.id, change]));
}

function boundaryChangeMap(changes) {
  return new Map(changes.map((change) => [`${change.kind}:${esc(change.label)}`, change]));
}

function addState(tag, change, side, forcedState) {
  const append = (attributes) => tag.endsWith('/>')
    ? tag.replace(/\/>$/, `${attributes}/>`)
    : tag.replace(/>$/, `${attributes}>`);
  if (!change && !forcedState) return append(' data-delta-state="same"');
  let state = forcedState || change.status;
  if (change?.status === 'added' && side === 'base') state = 'same';
  if (change?.status === 'removed' && side === 'head') state = 'same';
  const classes = change?.classifications?.join(',') || '';
  return append(` data-delta-state="${esc(state)}"${classes ? ` data-delta-classifications="${esc(classes)}"` : ''}`);
}

function markerFor(state) {
  return ({ added: '+', removed: '−', changed: '~', moved: '↔', 'moved-from': '↔', rerouted: '↔', 'evidence-changed': 'E' })[state] || '';
}

function addNodeMarker(group, state) {
  const symbol = markerFor(state);
  if (!symbol) return group;
  const box = group.match(/<rect x="([^"]+)" y="([^"]+)" width="([^"]+)"/);
  if (!box) return group;
  const x = Number(box[1]) + Number(box[3]) - 9;
  const y = Number(box[2]) + 9;
  return group.replace(/<\/g>$/, `\n          <g class="delta-node-marker" aria-hidden="true"><circle cx="${x}" cy="${y}" r="8"/><text x="${x}" y="${y + 3}" text-anchor="middle">${symbol}</text></g>\n        </g>`);
}

function prefixSvgIds(svg, prefix) {
  const ids = [...svg.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  let result = svg.replace(/(\s)id="([^"]+)"/g, (_match, space, id) => `${space}id="${prefix}-${id}"`);
  for (const id of ids) {
    result = result.replaceAll(`url(#${id})`, `url(#${prefix}-${id})`).replaceAll(`href="#${id}"`, `href="#${prefix}-${id}"`);
  }
  result = result.replace(/aria-labelledby="([^"]+)"/g, (_match, value) => `aria-labelledby="${value.split(/\s+/).map((id) => `${prefix}-${id}`).join(' ')}"`);
  return result;
}

function staticize(svg) {
  return svg.replaceAll('tabindex="0" role="button"', 'role="group"').replaceAll(' aria-pressed="false"', '').replaceAll('aria-label="Focus ', 'aria-label="');
}

function nodeGroupRanges(svg) {
  const ranges = [];
  const opener = /<g\s+[^>]*\bdata-node-id="([^"]+)"[^>]*>/g;
  let open;
  while ((open = opener.exec(svg))) {
    const tags = /<\/?g\b[^>]*>/g;
    tags.lastIndex = open.index;
    let depth = 0;
    let tag;
    while ((tag = tags.exec(svg))) {
      depth += tag[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        ranges.push({ id: open[1], start: open.index, end: tags.lastIndex });
        opener.lastIndex = tags.lastIndex;
        break;
      }
    }
  }
  return ranges;
}

function transformNodeGroups(svg, transform) {
  const ranges = nodeGroupRanges(svg);
  let cursor = 0;
  const parts = [];
  for (const range of ranges) {
    parts.push(svg.slice(cursor, range.start));
    parts.push(transform(svg.slice(range.start, range.end), range.id));
    cursor = range.end;
  }
  parts.push(svg.slice(cursor));
  return parts.join('');
}

const BOUNDARY_PAIR_RE = /<rect data-graph-role="structural-frame"[^>]*data-composition-frame-kind="([^"]+)"[^>]*\/>\s*<text[^>]*>([^<]+)<\/text>/g;

function transformBoundaryPairs(svg, transform) {
  return svg.replace(BOUNDARY_PAIR_RE, (pair, kind, label) => transform(pair, `${kind}:${label}`));
}

export function annotateArchitectureSideSvg(svg, receipt, side) {
  const nodes = changeMap(receipt.changes.components);
  const edges = changeMap(receipt.changes.connections);
  const boundaries = boundaryChangeMap(receipt.changes.boundaries);
  let result = transformBoundaryPairs(svg, (pair, key) => {
    const change = boundaries.get(key);
    if (!change) return pair;
    return pair
      .replace(/^<rect[^>]+\/>/, (tag) => addState(tag, change, side).replace(/\/>$/, ` data-delta-boundary-key="${esc(change.key)}"/>`))
      .replace(/<text[^>]*>/, (tag) => tag.replace(/>$/, ` data-delta-state="${change.status}" data-delta-boundary-state="${change.status}" data-delta-boundary-key="${esc(change.key)}">`));
  });
  result = transformNodeGroups(result, (group, id) => {
    const change = nodes.get(id);
    if ((side === 'base' && change?.status === 'added') || (side === 'head' && change?.status === 'removed')) return group;
    const tagged = group.replace(/^<g[^>]+>/, (tag) => addState(tag, change, side));
    return addNodeMarker(tagged, change?.status);
  });
  result = result.replace(/<(?:path|g)\s+[^>]*\bdata-edge-id="([^"]+)"[^>]*>/g, (tag, id) => addState(tag, edges.get(id), side));
  return prefixSvgIds(staticize(result), side);
}

function elementById(svg, kind, id) {
  const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (kind === 'node') {
    const range = nodeGroupRanges(svg).find((candidate) => candidate.id === id);
    return range ? svg.slice(range.start, range.end) : '';
  }
  const path = svg.match(new RegExp(`<path\\s+[^>]*\\bdata-edge-id="${safe}"[^>]*/>`))?.[0] || '';
  const label = svg.match(new RegExp(`<g\\s+[^>]*\\bdata-edge-id="${safe}"[^>]*>[\\s\\S]*?<\\/g>`))?.[0] || '';
  return [path, label].filter(Boolean).join('\n');
}

function forceElementState(markup, state, classifications = []) {
  let result;
  if (markup.includes('data-node-id=')) {
    result = markup.replace(/^<g\s+[^>]*>/, (tag) => addState(tag, { classifications }, 'delta', state));
  } else {
    result = markup
      .replace(/<path\s+[^>]*\bdata-edge-id="[^"]+"[^>]*\/>/g, (tag) => addState(tag, { classifications }, 'delta', state))
      .replace(/<g\s+[^>]*\bdata-edge-id="[^"]+"[^>]*>/g, (tag) => addState(tag, { classifications }, 'delta', state));
  }
  result = result.replace(/\bid="node-/, 'id="base-node-');
  if (markup.includes('data-node-id=')) result = addNodeMarker(result, state);
  return result;
}

function boundaryPairByKey(svg, key) {
  for (const match of svg.matchAll(BOUNDARY_PAIR_RE)) {
    if (`${match[1]}:${match[2]}` === key) return match[0];
  }
  return '';
}

function forceBoundaryState(markup, state, key, classifications = []) {
  return markup
    .replace(/^<rect[^>]+\/>/, (tag) => addState(tag, { classifications }, 'delta', state).replace(/\/>$/, ` data-delta-boundary-key="${esc(key)}"/>`))
    .replace(/<text[^>]*>/, (tag) => tag.replace(/>$/, ` data-delta-state="${state}" data-delta-boundary-state="${state}" data-delta-boundary-key="${esc(key)}">`));
}

function viewBoxSize(svg) {
  const match = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

function edgeSymbolMarkup(markup, state) {
  const symbol = markerFor(state);
  const point = markup.match(/data-composition-points="([\d.-]+),([\d.-]+)/);
  const edgeId = markup.match(/\bdata-edge-id="([^"]+)"/)?.[1];
  if (!symbol || !point) return '';
  return `<text class="delta-edge-marker" data-delta-state="${state}"${edgeId ? ` data-edge-id="${esc(edgeId)}"` : ''} x="${Number(point[1]) + 9}" y="${Number(point[2]) - 7}" aria-hidden="true">${symbol}</text>`;
}

export function buildDeltaSvg(baseSvg, headSvg, receipt) {
  const [baseW, baseH] = viewBoxSize(baseSvg);
  const [headW, headH] = viewBoxSize(headSvg);
  const nodes = changeMap(receipt.changes.components);
  const edges = changeMap(receipt.changes.connections);
  const boundaries = boundaryChangeMap(receipt.changes.boundaries);
  const baseNodePhantoms = [];
  const baseEdgePhantoms = [];
  const baseBoundaryPhantoms = [];
  const edgeMarkers = [];

  for (const change of nodes.values()) {
    if (change.status === 'removed') baseNodePhantoms.push(forceElementState(elementById(baseSvg, 'node', change.id), 'removed', change.classifications));
    else if (change.classifications.includes('geometry')) baseNodePhantoms.push(forceElementState(elementById(baseSvg, 'node', change.id), 'moved-from', change.classifications));
  }
  for (const change of edges.values()) {
    if (change.status === 'removed' || change.classifications.includes('topology')) {
      const phantom = forceElementState(elementById(baseSvg, 'edge', change.id), 'removed', change.classifications);
      baseEdgePhantoms.push(phantom);
      edgeMarkers.push(edgeSymbolMarkup(phantom, 'removed'));
    } else if (change.classifications.includes('geometry')) {
      const phantom = forceElementState(elementById(baseSvg, 'edge', change.id), 'moved-from', change.classifications);
      baseEdgePhantoms.push(phantom);
      edgeMarkers.push(edgeSymbolMarkup(phantom, 'moved-from'));
    }
  }
  for (const change of boundaries.values()) {
    const renderedKey = `${change.kind}:${esc(change.label)}`;
    if (change.status === 'removed') baseBoundaryPhantoms.push(forceBoundaryState(boundaryPairByKey(baseSvg, renderedKey), 'removed', change.key, change.classifications));
    else if (change.status === 'changed' || change.status === 'geometry-changed') {
      baseBoundaryPhantoms.push(forceBoundaryState(boundaryPairByKey(baseSvg, renderedKey), 'moved-from', change.key, change.classifications));
    }
  }

  let delta = annotateArchitectureSideSvg(headSvg, receipt, 'head');
  delta = delta.replace(/^<svg[^>]+>/, (tag) => tag.replace(/viewBox="[^"]+"/, `viewBox="0 0 ${Math.max(baseW, headW) + 24} ${Math.max(baseH, headH) + 24}"`));
  delta = delta.replace('        <!-- Boundaries (behind everything) -->', `        <!-- Baseline boundary phantoms -->\n${baseBoundaryPhantoms.join('\n')}\n\n        <!-- Boundaries (behind everything) -->`);
  delta = delta.replace('        <!-- Connection paths (before components for correct z-order) -->', `        <!-- Baseline relationship phantoms -->\n${baseEdgePhantoms.join('\n')}\n\n        <!-- Connection paths (before components for correct z-order) -->`);
  delta = delta.replace('        <!-- Components -->', `        <!-- Baseline removed and move-from component phantoms -->\n${baseNodePhantoms.join('\n')}\n\n        <!-- Components -->`);

  for (const change of edges.values()) {
    if (change.status === 'added' || change.status === 'changed' || change.status === 'rerouted') {
      const current = elementById(delta, 'edge', change.id);
      edgeMarkers.push(edgeSymbolMarkup(current, change.status === 'changed' && change.classifications.includes('topology') ? 'added' : change.status));
    }
  }
  delta = delta.replace('        <!-- Legend -->', `        <!-- Delta relationship symbols -->\n${edgeMarkers.filter(Boolean).join('\n')}\n\n        <!-- Legend -->`);
  return prefixSvgIds(staticize(delta), 'delta');
}

export function architectureDeltaChangeRows(receipt) {
  const rows = [];
  for (const change of receipt.changes.components) rows.push({ ...change, kind: 'Component', kindKey: 'component', key: `component:${change.id}`, id: change.id });
  for (const change of receipt.changes.connections) rows.push({ ...change, kind: 'Relationship', kindKey: 'relationship', key: `relationship:${change.id}`, id: change.id });
  for (const change of receipt.changes.boundaries) rows.push({ ...change, kind: 'Boundary', kindKey: 'boundary', key: `boundary:${change.key}`, id: change.key });
  return rows.sort((left, right) => codepointOrder(`${left.status}:${left.kind}:${left.id}`, `${right.status}:${right.kind}:${right.id}`));
}

function reviewPrimaryStates(row) {
  if (row.kindKey === 'component' && row.classifications.includes('geometry')) return [row.status, 'moved-from'];
  if (row.kindKey === 'relationship' && row.status === 'changed' && row.classifications.includes('topology')) return ['changed', 'removed'];
  if (row.kindKey === 'relationship' && row.classifications.includes('geometry')) return ['moved-from', row.status];
  if (row.kindKey === 'boundary' && ['changed', 'geometry-changed'].includes(row.status)) return [row.status, 'moved-from'].sort();
  return [row.status];
}

function reviewIdentity(row) {
  const attribute = row.kindKey === 'component' ? 'data-node-id' : row.kindKey === 'relationship' ? 'data-edge-id' : 'data-delta-boundary-key';
  return { attribute, value: esc(row.id) };
}

function reviewTargetTags(deltaMarkup, row) {
  const { attribute, value } = reviewIdentity(row);
  const safeValue = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const identity = new RegExp(`\\b${attribute}="${safeValue}"`);
  return [...deltaMarkup.matchAll(/<([a-z][\w:-]*)\s+[^>]*>/g)]
    .map((match) => ({ name: match[1], tag: match[0] }))
    .filter(({ tag }) => identity.test(tag));
}

function primaryReviewTags(deltaMarkup, row) {
  const tagName = row.kindKey === 'component' ? 'g' : row.kindKey === 'relationship' ? 'path' : 'rect';
  return reviewTargetTags(deltaMarkup, row).filter(({ name }) => name === tagName).map(({ tag }) => tag);
}

function reviewTargetSignature(tags) {
  return tags.map(({ name, tag }) => {
    const state = tag.match(/\bdata-delta-state="([^"]+)"/)?.[1] || '';
    const classifications = tag.match(/\bdata-delta-classifications="([^"]*)"/)?.[1] || '';
    return `${name}:${state}:${classifications}`;
  }).sort(codepointOrder).join('|');
}

function expectedReviewTargetSignature(row) {
  const classifications = row.classifications.join(',');
  const descriptors = [];
  if (row.kindKey === 'component') {
    for (const state of reviewPrimaryStates(row)) descriptors.push(`g:${state}:${classifications}`);
  } else if (row.kindKey === 'boundary') {
    for (const state of reviewPrimaryStates(row)) {
      descriptors.push(`rect:${state}:${classifications}`, `text:${state}:`);
    }
  } else {
    const forms = row.status === 'added'
      ? [{ state: 'added', marker: 'added', label: row.head?.label }]
      : row.status === 'removed'
        ? [{ state: 'removed', marker: 'removed', label: row.base?.label }]
        : row.classifications.includes('topology')
          ? [
              { state: 'removed', marker: 'removed', label: row.base?.label },
              { state: 'changed', marker: 'added', label: row.head?.label },
            ]
          : row.classifications.includes('geometry')
            ? [
                { state: 'moved-from', marker: 'moved-from', label: row.base?.label },
                { state: row.status, marker: row.status, label: row.head?.label },
              ]
            : [{ state: 'changed', marker: 'changed', label: row.head?.label }];
    for (const form of forms) {
      descriptors.push(`path:${form.state}:${classifications}`, `text:${form.marker}:`);
      if (form.label) descriptors.push(`g:${form.state}:${classifications}`);
    }
  }
  return descriptors.sort(codepointOrder).join('|');
}

const total = (summary, key) => summary.components[key] + summary.connections[key] + summary.boundaries[key];

export function renderArchitectureDeltaHtml({ receipt, baseSvg, deltaSvg, headSvg, artifactCss }) {
  const rows = architectureDeltaChangeRows(receipt);
  const changed = total(receipt.summary, 'changed');
  const proof = receipt.proofLevel === 'revision-pinned' ? 'REVISION-PINNED INPUTS' : 'AUTHORED SNAPSHOTS';
  const rowHtml = rows.length ? rows.map((row, index) => {
    const label = row.headLabel || row.baseLabel || row.head?.label || row.base?.label || row.label || row.id;
    const targetSignature = expectedReviewTargetSignature(row);
    return `<li data-change-status="${esc(row.status)}"><button class="change-row" type="button" data-change-index="${index}" data-change-key="${esc(row.key)}" data-change-kind="${esc(row.kindKey)}" data-change-id="${esc(row.id)}" data-change-label="${esc(label)}" data-change-status="${esc(row.status)}" data-change-classifications="${esc(row.classifications.join(', '))}" data-change-target-signature="${esc(targetSignature)}"><span class="token">${esc(markerFor(row.status) || '~')}</span><span>${esc(row.kind)}</span><strong>${esc(label)}</strong><code>${esc(row.id)}</code><span>${esc(row.classifications.join(', '))}</span><span>${esc(row.changedFields.join(', ') || 'identity')}</span></button></li>`;
  }).join('\n') : '<li class="empty">No authored architecture changes.</li>';
  const html = `<!doctype html>
<html lang="en" data-theme="dark" data-preset="${esc(receipt.view.visualPreset)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(receipt.head.title)} Architecture Delta</title>
<style>
${artifactCss}
:root{color-scheme:dark;--d-add:#34d399;--d-remove:#fb7185;--d-change:#fbbf24;--d-move:#7dd3fc;--d-focus:#7dd3fc;--d-ink:#e6edf5;--d-muted:#8aa0b5;--d-line:#25384a}
*{box-sizing:border-box}body{min-width:1080px;margin:0;background:#071019;color:var(--d-ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.proof-page{width:min(1600px,calc(100vw - 64px));margin:auto;padding:30px 0 42px}.proof-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:28px;align-items:end;padding-bottom:20px;border-bottom:1px solid var(--d-line)}.eyebrow{margin:0 0 8px;color:#7dd3fc;font:700 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em}.proof-head h1{margin:0;font-size:clamp(32px,4vw,56px);line-height:.96;letter-spacing:-.04em}.subtitle{margin:12px 0 0;color:var(--d-muted);font-size:14px}.metrics{display:flex;gap:9px}.metric{min-width:86px;padding:11px 13px;border:1px solid var(--d-line);border-radius:8px;background:#0b1722}.metric strong{display:block;font:700 23px/1 ui-monospace,SFMono-Regular,Menlo,monospace}.metric span{display:block;margin-top:6px;color:var(--d-muted);font:700 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em}.add strong{color:var(--d-add)}.remove strong{color:var(--d-remove)}.change strong{color:var(--d-change)}
.proof-tools{display:flex;align-items:center;justify-content:space-between;gap:20px;margin:16px 0 10px}.view-switch{display:inline-flex;padding:3px;border:1px solid var(--d-line);border-radius:8px;background:#0a141e}.view-switch button,.utility,.review-step{border:0;border-radius:6px;background:transparent;color:var(--d-muted);padding:8px 14px;font:700 11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;cursor:pointer}.view-switch button[aria-selected="true"]{background:#173047;color:#fff}.utility{border:1px solid var(--d-line)}.view-switch button:focus-visible,.utility:focus-visible,.review-step:focus-visible,.change-row:focus-visible{outline:2px solid var(--d-focus);outline-offset:2px}.utility:disabled,.review-step:disabled{cursor:not-allowed;opacity:.45}.legend{display:flex;gap:16px;color:var(--d-muted);font:650 10px/1 ui-monospace,SFMono-Regular,Menlo,monospace}.legend span{display:inline-flex;align-items:center;gap:6px}.legend i{width:22px;border-top:3px solid currentColor}.legend .add{color:var(--d-add)}.legend .remove{color:var(--d-remove)}.legend .remove i{border-top-style:dashed}.legend .change{color:var(--d-change)}.legend .change i{border-top-style:dotted}.legend .move{color:var(--d-move)}.legend .move i{border-top-style:double}
.review-strip{display:grid;grid-template-columns:auto auto auto auto minmax(0,1fr);align-items:center;gap:5px;margin:0 0 10px;padding:7px 8px;border-block:1px solid var(--d-line);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.review-step{min-height:34px;border:1px solid var(--d-line);padding-inline:11px}.review-step[aria-pressed="true"]{border-color:var(--d-focus);color:var(--d-ink)}.review-status{min-width:0;padding-left:9px;color:var(--d-muted);font-size:10px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.review-status strong{color:var(--d-ink);font-weight:750}.review-status[data-state="unavailable"]{color:var(--d-remove)}
.canvas{overflow:hidden;border:1px solid var(--d-line);border-radius:10px;background:#09141e;padding:12px;min-height:520px}.canvas svg{display:block;width:100%;height:auto;max-height:72vh}.canvas[hidden]{display:none}.canvas[data-view="delta"] [data-delta-state="same"]{opacity:.38}.canvas[data-delta-review-active]{--review-same-opacity:.14;--review-change-opacity:.28}.canvas[data-delta-review-active] [data-delta-state="same"]{opacity:var(--review-same-opacity)!important}.canvas[data-delta-review-active] [data-delta-state]:not([data-delta-state="same"]):not([data-delta-review-current]){opacity:var(--review-change-opacity)!important}.canvas[data-delta-review-active] [data-delta-review-current]{opacity:1!important;transition:opacity .16s ease-out}g[data-node-id][data-delta-state="added"]>rect:last-of-type{stroke:var(--d-add)!important;stroke-width:3!important}g[data-node-id][data-delta-state="removed"]>rect:last-of-type{stroke:var(--d-remove)!important;stroke-width:3!important;stroke-dasharray:7 5}g[data-node-id][data-delta-state="changed"]>rect:last-of-type{stroke:var(--d-change)!important;stroke-width:3!important;stroke-dasharray:2 3}g[data-node-id][data-delta-state="moved"]>rect:last-of-type,g[data-node-id][data-delta-state="moved-from"]>rect:last-of-type{stroke:var(--d-move)!important;stroke-width:3!important;stroke-dasharray:8 3 2 3}g[data-node-id][data-delta-state="moved-from"],path[data-delta-state="moved-from"]{opacity:.42}path[data-delta-state="added"]{stroke:var(--d-add)!important;stroke-width:3!important}path[data-delta-state="removed"]{stroke:var(--d-remove)!important;stroke-width:3!important;stroke-dasharray:7 5!important}path[data-delta-state="changed"]{stroke:var(--d-change)!important;stroke-width:3!important;stroke-dasharray:2 3!important}path[data-delta-state="rerouted"],path[data-delta-state="moved-from"]{stroke:var(--d-move)!important;stroke-width:2.5!important;stroke-dasharray:8 3 2 3!important}.delta-node-marker circle{fill:#071019;stroke:currentColor;stroke-width:1.5}.delta-node-marker text,.delta-edge-marker{fill:currentColor;font:800 9px ui-monospace,SFMono-Regular,Menlo,monospace}[data-delta-state="added"] .delta-node-marker,.delta-edge-marker[data-delta-state="added"]{color:var(--d-add)}[data-delta-state="removed"] .delta-node-marker,.delta-edge-marker[data-delta-state="removed"]{color:var(--d-remove)}[data-delta-state="changed"] .delta-node-marker,.delta-edge-marker[data-delta-state="changed"]{color:var(--d-change)}[data-delta-state="moved"] .delta-node-marker,[data-delta-state="moved-from"] .delta-node-marker,.delta-edge-marker[data-delta-state="moved-from"],.delta-edge-marker[data-delta-state="rerouted"]{color:var(--d-move)}.delta-edge-marker{paint-order:stroke;stroke:#071019;stroke-width:3px}
rect[data-graph-role="structural-frame"][data-delta-state="added"]{stroke:var(--d-add)!important;stroke-width:2.5!important}rect[data-graph-role="structural-frame"][data-delta-state="removed"]{stroke:var(--d-remove)!important;stroke-width:2.5!important;stroke-dasharray:7 5!important}rect[data-graph-role="structural-frame"][data-delta-state="changed"]{stroke:var(--d-change)!important;stroke-width:2.5!important;stroke-dasharray:2 3!important}rect[data-graph-role="structural-frame"][data-delta-state="moved-from"]{stroke:var(--d-move)!important;stroke-width:2!important;stroke-dasharray:8 3 2 3!important;opacity:.42}text[data-delta-boundary-state="added"]{fill:var(--d-add)!important}text[data-delta-boundary-state="removed"]{fill:var(--d-remove)!important}text[data-delta-boundary-state="changed"]{fill:var(--d-change)!important}text[data-delta-boundary-state="moved-from"]{fill:var(--d-move)!important;opacity:.55}
details{margin-top:12px;border:1px solid var(--d-line);border-radius:9px;background:#0a141e}summary{padding:13px 15px;cursor:pointer;font-weight:700}.changes{list-style:none;margin:0;padding:0 8px 8px}.changes li{border-top:1px solid rgba(138,160,181,.16)}.change-row{display:grid;grid-template-columns:30px 90px minmax(140px,1fr) minmax(100px,.7fr) minmax(120px,.8fr) minmax(140px,1.2fr);gap:10px;width:100%;margin:0;padding:9px 7px;border:0;border-radius:5px;background:transparent;color:inherit;font:inherit;font-size:11px;text-align:left;align-items:baseline;cursor:pointer}.change-row:hover{background:rgba(125,211,252,.06)}.change-row[aria-current="step"]{background:rgba(125,211,252,.1);box-shadow:inset 0 0 0 1px var(--d-focus)}.change-row:disabled{cursor:default}.token{font:800 13px/1 ui-monospace,SFMono-Regular,Menlo,monospace}.changes code,.change-row>span:last-child{color:var(--d-muted)}.proof-foot{display:flex;justify-content:space-between;gap:24px;margin-top:14px;color:var(--d-muted);font:650 10px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
html[data-theme="dark"] body{background:#071019!important;background-image:none!important}html[data-theme="light"]{color-scheme:light;--d-ink:#10283c;--d-muted:#587187;--d-line:#c8d6e2;--d-focus:#006b8f}html[data-theme="light"] body{background:#eef3f7!important;background-image:none!important;color:var(--d-ink)}html[data-theme="light"] .metric,html[data-theme="light"] .view-switch,html[data-theme="light"] details{background:#fff}html[data-theme="light"] .canvas{background:#f8fbfd}html[data-theme="light"] .view-switch button[aria-selected="true"]{background:#dbeaf5;color:#10283c}html[data-theme="light"] .delta-node-marker circle{fill:#fff}html[data-preset="blueprint"] body{background-image:none!important}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}.canvas[data-delta-review-active] [data-delta-review-current]{transition:none!important}}@media print{body{min-width:0;background:#fff;color:#111}.proof-page{width:100%;padding:0}.proof-tools,.review-strip,details{display:none!important}.canvas{display:none!important}.canvas[data-view="delta"]{display:block!important;border:0}.canvas[data-delta-review-active]{--review-same-opacity:1;--review-change-opacity:1}.canvas[data-delta-review-active] [data-delta-review-current]{opacity:1!important;transition:none!important}.proof-foot{color:#444}}
</style></head>
<body><main class="proof-page"><header class="proof-head"><div><p class="eyebrow">ARCHITECTURE DELTA · ${proof}</p><h1>See what changed<br>before you merge.</h1><p class="subtitle">${esc(receipt.base.title)} → ${esc(receipt.head.title)}</p></div><div class="metrics"><div class="metric add"><strong>${total(receipt.summary, 'added')}</strong><span>ADDED</span></div><div class="metric remove"><strong>${total(receipt.summary, 'removed')}</strong><span>REMOVED</span></div><div class="metric change"><strong>${changed}</strong><span>CHANGED</span></div></div></header>
<div class="proof-tools"><div class="view-switch" role="tablist" aria-label="Architecture snapshot"><button role="tab" data-target="base" aria-selected="false">Before</button><button role="tab" data-target="delta" aria-selected="true">Delta</button><button role="tab" data-target="head" aria-selected="false">After</button></div><div class="legend"><span class="add"><i></i>+ ADD</span><span class="remove"><i></i>− DEL</span><span class="change"><i></i>~ MOD</span><span class="move"><i></i>↔ MOVE</span></div><div><button class="utility" id="preset" type="button">Preset</button> <button class="utility" id="theme" type="button">Theme</button></div></div>
<nav class="review-strip" aria-label="Authored change review"><button class="review-step" id="review-overview" type="button" disabled>Overview</button><button class="review-step" id="review-previous" type="button" aria-label="Previous authored change" disabled>←</button><button class="review-step" id="review-play" type="button" aria-pressed="false"${rows.length ? '' : ' disabled'}>Review</button><button class="review-step" id="review-next" type="button" aria-label="Next authored change" disabled>→</button><div class="review-status" id="review-status" role="status" aria-live="polite">Overview · ${rows.length} authored changes</div></nav>
<section class="canvas" data-view="base" hidden>${baseSvg}</section><section class="canvas" data-view="delta">${deltaSvg}</section><section class="canvas" data-view="head" hidden>${headSvg}</section>
<details${rows.length <= 10 ? ' open' : ''}><summary>Exact authored changes · ${rows.length}</summary><ul class="changes">${rowHtml}</ul></details>
<footer class="proof-foot"><span>Stable IDs only · completeness: complete · ${proof}</span><span>Authored IR only · no risk or mergeability inference</span></footer></main>
<script id="archify-compare-receipt" type="application/json">${safeJson(receipt)}</script>
<script>(()=>{
  const REVIEW_DWELL_MS = 1400;
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const views = [...document.querySelectorAll('[data-view]')];
  const deltaCanvas = document.querySelector('[data-view="delta"]');
  const rowButtons = [...document.querySelectorAll('.change-row')];
  const overviewButton = document.querySelector('#review-overview');
  const previousButton = document.querySelector('#review-previous');
  const playButton = document.querySelector('#review-play');
  const nextButton = document.querySelector('#review-next');
  const status = document.querySelector('#review-status');
  const receiptNode = document.querySelector('#archify-compare-receipt');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let activeIndex = -1;
  let playbackToken = 0;
  let playbackTimer = 0;
  let playing = false;
  let reviewAvailable = false;
  let reviewSources = [];

  function show(id) {
    tabs.forEach((tab) => tab.setAttribute('aria-selected', String(tab.dataset.target === id)));
    views.forEach((view) => { view.hidden = view.dataset.view !== id; });
  }

  function stopPlayback() {
    playbackToken += 1;
    if (playbackTimer) window.clearTimeout(playbackTimer);
    playbackTimer = 0;
    playing = false;
    playButton.setAttribute('aria-pressed', 'false');
    playButton.textContent = activeIndex === rowButtons.length - 1 && rowButtons.length ? 'Replay' : 'Review';
    status.setAttribute('aria-live', 'polite');
  }

  function failReview() {
    stopPlayback();
    reviewAvailable = false;
    activeIndex = -1;
    deltaCanvas?.removeAttribute('data-delta-review-active');
    deltaCanvas?.querySelectorAll('[data-delta-review-current]').forEach((element) => element.removeAttribute('data-delta-review-current'));
    rowButtons.forEach((row) => {
      row.disabled = true;
      row.tabIndex = -1;
      row.removeAttribute('aria-current');
    });
    [overviewButton, previousButton, playButton, nextButton].forEach((button) => { button.disabled = true; });
    status.dataset.state = 'unavailable';
    status.textContent = 'Review unavailable · compare identity mismatch';
  }

  function receiptRows(receipt) {
    const definitions = [
      { collection: 'components', kind: 'component', id: 'id', statuses: ['added', 'changed', 'evidence-changed', 'removed', 'moved'] },
      { collection: 'connections', kind: 'relationship', id: 'id', statuses: ['added', 'changed', 'removed', 'rerouted'] },
      { collection: 'boundaries', kind: 'boundary', id: 'key', statuses: ['added', 'changed', 'removed', 'geometry-changed'] },
    ];
    const rows = [];
    for (const definition of definitions) {
      const changes = receipt.changes[definition.collection];
      if (!Array.isArray(changes)) return null;
      for (const change of changes) {
        if (!change || typeof change !== 'object' || Array.isArray(change)) return null;
        const id = change[definition.id];
        if (typeof id !== 'string' || !id || !definition.statuses.includes(change.status)) return null;
        if (!Array.isArray(change.classifications) || !change.classifications.length || change.classifications.some((value) => typeof value !== 'string')) return null;
        if (new Set(change.classifications).size !== change.classifications.length) return null;
        if (!Array.isArray(change.changedFields) || change.changedFields.some((value) => typeof value !== 'string')) return null;
        rows.push({ ...change, kind: definition.kind, key: definition.kind + ':' + id, id });
      }
    }
    return rows;
  }

  function exactTargets(row) {
    const attribute = row.dataset.changeKind === 'component'
      ? 'data-node-id'
      : row.dataset.changeKind === 'relationship'
        ? 'data-edge-id'
        : 'data-delta-boundary-key';
    return [...deltaCanvas.querySelectorAll('[' + attribute + ']')]
      .filter((element) => element.getAttribute(attribute) === row.dataset.changeId);
  }

  function targetSignature(matches) {
    return matches.map((element) => {
      const tag = element.tagName.toLowerCase();
      const state = element.dataset.deltaState || '';
      const classifications = element.dataset.deltaClassifications || '';
      return tag + ':' + state + ':' + classifications;
    }).sort().join('|');
  }

  function targetsMatch(source, row, matches) {
    if (!source || !matches.length || !row.dataset.changeTargetSignature) return false;
    if (row.dataset.changeKind !== source.kind || row.dataset.changeId !== source.id || row.dataset.changeStatus !== source.status) return false;
    if (row.dataset.changeClassifications !== source.classifications.join(', ')) return false;
    return row.dataset.changeTargetSignature === targetSignature(matches);
  }

  function validateReview() {
    try {
      if (document.querySelectorAll('#archify-compare-receipt').length !== 1 || !receiptNode) return false;
      if (!deltaCanvas || !['base', 'delta', 'head'].every((id) => document.querySelectorAll('[data-view="' + id + '"]').length === 1)) return false;
      if (deltaCanvas.children.length !== 1 || deltaCanvas.firstElementChild?.tagName.toLowerCase() !== 'svg') return false;
      const receipt = JSON.parse(receiptNode.textContent);
      if (!receipt || receipt.schemaVersion !== 1 || receipt.command !== 'compare' || receipt.completeness !== 'complete' || !receipt.changes) return false;
      const sources = receiptRows(receipt);
      if (!sources || sources.length !== rowButtons.length) return false;
      const sourceByKey = new Map(sources.map((source) => [source.key, source]));
      if (sourceByKey.size !== sources.length) return false;
      const seen = new Set();
      const orderedSources = [];
      for (let index = 0; index < rowButtons.length; index += 1) {
        const row = rowButtons[index];
        const source = sourceByKey.get(row.dataset.changeKey);
        if (!source || seen.has(source.key) || row.dataset.changeIndex !== String(index)) return false;
        const matches = exactTargets(row);
        if (!targetsMatch(source, row, matches)) return false;
        seen.add(source.key);
        orderedSources.push(source);
      }
      if (seen.size !== sourceByKey.size) return false;
      reviewSources = orderedSources;
      return true;
    } catch {
      return false;
    }
  }

  function updateControls() {
    overviewButton.disabled = !reviewAvailable || activeIndex < 0;
    previousButton.disabled = !reviewAvailable || activeIndex <= 0;
    nextButton.disabled = !reviewAvailable || activeIndex < 0 || activeIndex >= rowButtons.length - 1;
  }

  function selectChange(index, fromPlayback = false) {
    if (!reviewAvailable || index < 0 || index >= rowButtons.length) return false;
    const row = rowButtons[index];
    const matches = exactTargets(row);
    if (!targetsMatch(reviewSources[index], row, matches)) { failReview(); return false; }
    show('delta');
    deltaCanvas.querySelectorAll('[data-delta-review-current]').forEach((element) => element.removeAttribute('data-delta-review-current'));
    matches.forEach((element) => element.setAttribute('data-delta-review-current', 'true'));
    deltaCanvas.setAttribute('data-delta-review-active', 'true');
    rowButtons.forEach((button, rowIndex) => {
      button.tabIndex = rowIndex === index ? 0 : -1;
      if (rowIndex === index) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    activeIndex = index;
    updateControls();
    const kind = row.dataset.changeKind.charAt(0).toUpperCase() + row.dataset.changeKind.slice(1);
    status.textContent = String(index + 1).padStart(2, '0') + ' / ' + String(rowButtons.length).padStart(2, '0') + ' · ' + kind + ' · ' + row.dataset.changeLabel + ' [' + row.dataset.changeId + '] · ' + row.dataset.changeClassifications;
    if (fromPlayback) status.setAttribute('aria-live', 'off');
    return true;
  }

  function overview() {
    if (!reviewAvailable) { failReview(); return; }
    stopPlayback();
    activeIndex = -1;
    deltaCanvas.removeAttribute('data-delta-review-active');
    deltaCanvas.querySelectorAll('[data-delta-review-current]').forEach((element) => element.removeAttribute('data-delta-review-current'));
    rowButtons.forEach((row, index) => {
      row.tabIndex = index === 0 ? 0 : -1;
      row.removeAttribute('aria-current');
    });
    show('delta');
    status.removeAttribute('data-state');
    status.textContent = 'Overview · ' + rowButtons.length + ' authored changes';
    updateControls();
  }

  function schedulePlayback(token) {
    if (!playing || token !== playbackToken || activeIndex >= rowButtons.length - 1) {
      if (activeIndex >= rowButtons.length - 1) stopPlayback();
      return;
    }
    playbackTimer = window.setTimeout(() => {
      if (!playing || token !== playbackToken) return;
      if (!selectChange(activeIndex + 1, true)) return;
      schedulePlayback(token);
    }, REVIEW_DWELL_MS);
  }

  function startReview() {
    if (!reviewAvailable) return;
    if (playing) { stopPlayback(); return; }
    stopPlayback();
    if (!selectChange(0, false)) return;
    if (reducedMotion.matches || rowButtons.length < 2) return;
    playing = true;
    const token = ++playbackToken;
    playButton.textContent = 'Pause';
    playButton.setAttribute('aria-pressed', 'true');
    status.setAttribute('aria-live', 'off');
    schedulePlayback(token);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => { stopPlayback(); show(tab.dataset.target); });
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      stopPlayback();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[next].focus();
      show(tabs[next].dataset.target);
    });
  });

  rowButtons.forEach((row, index) => {
    row.tabIndex = index === 0 ? 0 : -1;
    row.addEventListener('click', () => { stopPlayback(); selectChange(index); });
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        stopPlayback();
        selectChange(index);
        return;
      }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      stopPlayback();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rowButtons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rowButtons.length) % rowButtons.length;
      rowButtons.forEach((button, rowIndex) => { button.tabIndex = rowIndex === next ? 0 : -1; });
      rowButtons[next].focus();
    });
  });

  overviewButton.addEventListener('click', overview);
  previousButton.addEventListener('click', () => { stopPlayback(); selectChange(activeIndex - 1); });
  nextButton.addEventListener('click', () => { stopPlayback(); selectChange(activeIndex + 1); });
  playButton.addEventListener('click', startReview);
  document.addEventListener('focusin', (event) => {
    if (playing && event.target.closest('button')) stopPlayback();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlayback(); });
  window.addEventListener('beforeprint', overview);
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) stopPlayback(); });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && activeIndex >= 0) {
      event.preventDefault();
      overview();
      playButton.focus();
    }
  });

  document.querySelector('#theme').addEventListener('click', () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; });
  const presets = ['classic', 'signal-flow', 'blueprint'];
  document.querySelector('#preset').addEventListener('click', () => { const now = document.documentElement.dataset.preset; document.documentElement.dataset.preset = presets[(presets.indexOf(now) + 1) % presets.length]; });

  reviewAvailable = validateReview();
  if (!reviewAvailable) failReview();
  else {
    status.removeAttribute('data-state');
    updateControls();
  }
})();</script></body></html>`;
  return html.replace(/[ \t]+$/gm, '');
}

export function validateArchitectureDeltaHtml(html, receipt) {
  const failures = [];
  const rows = architectureDeltaChangeRows(receipt);
  const deltaMarkup = html.match(/<section class="canvas" data-view="delta">([\s\S]*?)<\/section>/)?.[1] || '';
  const svgTags = [...deltaMarkup.matchAll(/<\/?svg\b[^>]*>/g)];
  let svgDepth = 0;
  let svgRoots = 0;
  let rootStart = -1;
  let rootEnd = -1;
  let svgBalanced = true;
  for (const match of svgTags) {
    if (match[0].startsWith('</')) {
      svgDepth -= 1;
      if (svgDepth < 0) svgBalanced = false;
      if (svgDepth === 0) rootEnd = match.index + match[0].length;
    } else {
      if (svgDepth === 0) {
        svgRoots += 1;
        if (rootStart < 0) rootStart = match.index;
      }
      svgDepth += 1;
    }
  }
  if (!['base', 'delta', 'head'].every((id) => (html.match(new RegExp(`<section class="canvas" data-view="${id}"`, 'g')) || []).length === 1)) failures.push('expected one Before, Delta, and After canvas');
  if (!svgBalanced || svgDepth !== 0 || svgRoots !== 1 || deltaMarkup.slice(0, rootStart).trim() || deltaMarkup.slice(rootEnd).trim()) failures.push('expected exactly one root SVG in the Delta canvas');
  if ((html.match(/id="archify-compare-receipt"/g) || []).length !== 1) failures.push('expected exactly one embedded compare receipt');
  if (!html.includes('aria-label="Authored change review"')) failures.push('missing exact-ID change navigator');
  if ((html.match(/class="change-row"/g) || []).length !== rows.length) failures.push('change navigator row count does not match the receipt');
  for (const [index, row] of rows.entries()) {
    const safeKey = esc(row.key).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rowMatches = [...html.matchAll(new RegExp(`<button class="change-row"[^>]*data-change-key="${safeKey}"[^>]*>`, 'g'))].map((match) => match[0]);
    if (rowMatches.length !== 1) failures.push(`expected exactly one change row ${row.key}`);
    const targets = reviewTargetTags(deltaMarkup, row);
    if (!targets.length) failures.push(`missing Delta identity ${row.key}`);
    if (targets.some(({ tag }) => !/\bdata-delta-state="[^"]+"/.test(tag))) failures.push(`missing Delta target state ${row.key}`);
    const signature = reviewTargetSignature(targets);
    const expectedSignature = expectedReviewTargetSignature(row);
    const storedSignature = rowMatches[0]?.match(/\bdata-change-target-signature="([^"]*)"/)?.[1];
    if (!signature || signature !== expectedSignature || storedSignature !== expectedSignature) failures.push(`ambiguous Delta target signature ${row.key}`);
    if (rowMatches[0]?.match(/\bdata-change-index="([^"]+)"/)?.[1] !== String(index)) failures.push(`incorrect change row order ${row.key}`);
    const primary = primaryReviewTags(deltaMarkup, row);
    const states = primary.map((tag) => tag.match(/\bdata-delta-state="([^"]+)"/)?.[1]).filter(Boolean).sort();
    if (JSON.stringify(states) !== JSON.stringify(reviewPrimaryStates(row).sort())) failures.push(`ambiguous Delta identity ${row.key}`);
    const classifications = row.classifications.join(',');
    if (primary.some((tag) => tag.match(/\bdata-delta-classifications="([^"]*)"/)?.[1] !== classifications)) failures.push(`conflicting Delta classification ${row.key}`);
  }
  if (/\b(?:SAFE|LOW RISK|MERGEABLE|NO IMPACT|VERIFIED PR)\b/i.test(html)) failures.push('contains a forbidden risk or mergeability claim');
  if (/\b(?:NaN|Infinity)\b/.test(html)) failures.push('contains non-finite output');
  if (receipt.completeness !== 'complete') failures.push('receipt is not complete');
  if (failures.length) fail('delta/artifact-invalid', `Architecture Delta artifact failed validation: ${failures.join('; ')}.`, { failures });
  return { ok: true, checksPassed: 8, checkCount: 8 };
}
