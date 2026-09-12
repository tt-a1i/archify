import { createHash } from 'node:crypto';
import {
  canonical,
  canonicalArchitectureJson,
  codepointOrder,
  sortedBy,
} from '../delta/architecture-delta.mjs';
import { locateFail } from './error.mjs';
import { classifyPath, componentLabel, inheritParentExcluded } from './ownership.mjs';
import { matchesGlob } from './glob.mjs';

export const LOCATOR_VERSION = 1;

const LIMITATIONS = [
  'Path ownership only; no runtime impact, causality, risk, or mergeability is inferred.',
  'Import facts are reported as-is and never reconciled against authored connections.',
];

const BLOCKING_ORDER = ['files_ambiguous', 'components_stale', 'map_changed'];
const ADVISORY_ORDER = ['files_uncovered', 'map_behind', 'map_revision_unavailable', 'import_edges_unmapped'];
const IMPORT_KINDS = new Set(['static', 'dynamic', 'require', 'export']);
const REPO_PATH_RE = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\\\u0000-\u001f]+$/;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function mapNodes(map) {
  if (Array.isArray(map?.components)) return map.components;
  if (Array.isArray(map?.nodes)) return map.nodes;
  if (Array.isArray(map?.participants)) return map.participants;
  if (Array.isArray(map?.states)) return map.states;
  return [];
}

function fileFields(classified) {
  if (classified.state === 'touched') {
    return { state: 'touched', componentId: classified.componentId, matchedGlob: classified.matchedGlob };
  }
  if (classified.state === 'ambiguous') {
    return { state: 'ambiguous', candidates: [...classified.candidates].sort(codepointOrder) };
  }
  if (classified.state === 'excluded') {
    return { state: 'excluded', matchedGlob: classified.matchedGlob };
  }
  return { state: 'uncovered' };
}

function attribution(classified) {
  return classified.state === 'touched' ? classified.componentId : null;
}

function countFileStates(files) {
  const counts = { touched: 0, uncovered: 0, ambiguous: 0, excluded: 0, total: files.length };
  for (const file of files) counts[file.state] += 1;
  return counts;
}

function assertReceiptPath(filePath) {
  if (!validRepoPath(filePath)) {
    locateFail('locate/path-invalid', `Path ${JSON.stringify(filePath)} is not a receipt-safe repository path.`, {
      evidence: { path: filePath },
      supportedFixes: ['rename the path so it has no control characters or backslashes'],
    });
  }
}

export function classifyChanges(changes, ownership) {
  const files = [];
  const moveFacts = [];
  for (const change of changes) {
    if (change.changeType === 'R' || change.changeType === 'C') {
      assertReceiptPath(change.oldPath);
      assertReceiptPath(change.path);
      const baseClass = classifyPath(change.oldPath, ownership);
      const headClass = classifyPath(change.path, ownership);
      files.push({
        path: change.oldPath,
        changeType: change.changeType,
        side: 'base',
        renamedTo: change.path,
        ...fileFields(baseClass),
      });
      files.push({
        path: change.path,
        changeType: change.changeType,
        side: 'head',
        renamedFrom: change.oldPath,
        ...fileFields(headClass),
      });
      if (change.changeType === 'R') {
        const baseId = attribution(baseClass);
        const headId = attribution(headClass);
        if (baseId !== headId) {
          moveFacts.push({
            kind: 'moved_between_components',
            base: { path: change.oldPath, componentId: baseId },
            head: { path: change.path, componentId: headId },
          });
        }
      }
      continue;
    }
    assertReceiptPath(change.path);
    files.push({
      path: change.path,
      changeType: change.changeType,
      ...fileFields(classifyPath(change.path, ownership)),
    });
  }
  return { files: sortedBy(files, (file) => file.path), moveFacts };
}

function buildComponents({ map, ownership, files, headTree, changes, children }) {
  const isArchitecture = map.diagram_type === 'architecture';
  const renameOldToNew = new Map();
  for (const change of changes || []) {
    if (change.changeType === 'R') renameOldToNew.set(change.oldPath, change.path);
  }
  const headSet = new Set(headTree || []);
  const components = [];
  for (const node of mapNodes(map)) {
    const touchedFiles = [...new Set(
      files.filter((file) => file.state === 'touched' && file.componentId === node.id).map((file) => file.path),
    )].sort(codepointOrder);
    const staleSources = [];
    if (isArchitecture && Array.isArray(node.sources)) {
      for (const source of node.sources) {
        if (headSet.has(source.path)) continue;
        const stale = { path: source.path };
        if (renameOldToNew.has(source.path)) stale.renamedTo = renameOldToNew.get(source.path);
        staleSources.push(stale);
      }
    }
    const entry = {
      id: node.id,
      label: node.label || componentLabel(map, node.id),
      state: staleSources.length ? 'stale' : touchedFiles.length ? 'touched' : 'untouched',
      touchedCount: touchedFiles.length,
      touchedFiles,
    };
    if (staleSources.length) entry.staleSources = staleSources;
    const owned = ownership.components.find((component) => component.id === node.id);
    if (owned?.child_map) {
      entry.childMap = owned.child_map;
      const childOwnership = children?.[node.id];
      if (childOwnership) {
        const parentGlobs = owned.globs || [];
        const scoped = (changes || []).filter((change) => {
          const paths = change.oldPath ? [change.oldPath, change.path] : [change.path];
          return paths.some((filePath) => parentGlobs.some((glob) => matchesGlob(glob, filePath)));
        });
        const childFiles = classifyChanges(scoped, inheritParentExcluded(ownership, childOwnership)).files;
        const counts = countFileStates(childFiles);
        entry.inside = {
          touched: counts.touched,
          uncovered: counts.uncovered,
          ambiguous: counts.ambiguous,
          excluded: counts.excluded,
        };
      }
    }
    components.push(entry);
  }
  return sortedBy(components, (component) => component.id);
}

function countComponents(components) {
  const counts = { touched: 0, untouched: 0, stale: 0, total: components.length };
  for (const component of components) counts[component.state] += 1;
  return counts;
}

function buildReview({ fileSummary, componentSummary, mapDelta, mapBehindBy, mapRevisionUnavailable, facts }) {
  const blocking = [];
  if (fileSummary.ambiguous) blocking.push('files_ambiguous');
  if (componentSummary.stale) blocking.push('components_stale');
  if (mapDelta) blocking.push('map_changed');
  const advisory = [];
  if (fileSummary.uncovered) advisory.push('files_uncovered');
  if (mapBehindBy > 0) advisory.push('map_behind');
  if (mapRevisionUnavailable) advisory.push('map_revision_unavailable');
  if (facts.some((fact) => (
    fact.kind === 'import_edge_change'
    && (fact.from.componentId === null || fact.to.componentId === null)
  ))) {
    advisory.push('import_edges_unmapped');
  }
  blocking.sort((left, right) => BLOCKING_ORDER.indexOf(left) - BLOCKING_ORDER.indexOf(right));
  advisory.sort((left, right) => ADVISORY_ORDER.indexOf(left) - ADVISORY_ORDER.indexOf(right));
  return { required: blocking.length > 0, blocking, advisory };
}

function semanticHash(map) {
  if (map.diagram_type === 'architecture') return sha256(canonicalArchitectureJson(map));
  return sha256(canonical(map));
}

function attributed(filePath, ownership) {
  return { path: filePath, componentId: attribution(classifyPath(filePath, ownership)) };
}

function factsEndpoint(filePath, ownership) {
  if (typeof filePath !== 'string') {
    locateFail('locate/facts-invalid', 'Import fact endpoint path is not a string.', {
      evidence: { path: filePath },
      supportedFixes: ['give each import from/to a string path'],
    });
  }
  if (!validRepoPath(filePath)) return { path: filePath, componentId: null };
  return attributed(filePath, ownership);
}

function validRepoPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && REPO_PATH_RE.test(value);
}

export function readFacts(data, label) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || !Array.isArray(data.imports)) {
    locateFail('locate/facts-invalid', `${label} is not a raw-facts object with an imports array.`, {
      supportedFixes: ['pass two raw-facts JSON files whose imports[] match the documented shape'],
    });
  }
  for (const [index, item] of data.imports.entries()) {
    if (!item || typeof item !== 'object' || typeof item.from !== 'string' || typeof item.specifier !== 'string'
      || !IMPORT_KINDS.has(item.kind) || typeof item.resolved !== 'boolean') {
      locateFail('locate/facts-invalid', `${label} imports[${index}] is not a raw-facts import record.`, {
        supportedFixes: ['each import needs from, specifier, kind, and resolved'],
      });
    }
  }
  return data;
}

function importFacts(before, after, ownership) {
  const keyOf = (imp) => canonical({
    from: imp.from,
    to: imp.resolved ? imp.to : null,
    specifier: imp.specifier,
    kind: imp.kind,
  });
  const beforeMap = new Map(before.imports.map((imp) => [keyOf(imp), imp]));
  const afterMap = new Map(after.imports.map((imp) => [keyOf(imp), imp]));
  const facts = [];
  const emit = (change, imp) => {
    const toRaw = imp.resolved ? imp.to : (imp.to != null ? imp.to : imp.specifier);
    facts.push({
      kind: 'import_edge_change',
      change,
      from: factsEndpoint(imp.from, ownership),
      to: factsEndpoint(toRaw, ownership),
      specifier: imp.specifier,
      importKind: imp.kind,
    });
  };
  for (const [key, imp] of afterMap) {
    if (!beforeMap.has(key)) emit('added', imp);
  }
  for (const [key, imp] of beforeMap) {
    if (!afterMap.has(key)) emit('removed', imp);
  }
  return facts;
}

function findMapDelta(changes, mapPath, base, head) {
  if (!mapPath || !base || !head) return undefined;
  const hit = (changes || []).find((change) => change.path === mapPath || change.oldPath === mapPath);
  if (!hit) return undefined;
  return { path: mapPath, baseBlob: `${base}:${hit.oldPath || mapPath}`, headBlob: `${head}:${hit.path}` };
}

function finishReceipt({
  mode, map, ownership, files, facts, components, repository, mapPath, ownershipPath, ownershipSha256,
  mapBehindBy, mapRevisionUnavailable, mapDelta,
}) {
  const fileSummary = countFileStates(files);
  const componentSummary = countComponents(components);
  const review = buildReview({
    fileSummary, componentSummary, mapDelta, mapBehindBy, mapRevisionUnavailable, facts,
  });
  const mapRevision = map.diagram_type === 'architecture' && map.meta?.repository?.revision
    ? String(map.meta.repository.revision).toLowerCase()
    : undefined;
  const receipt = {
    schemaVersion: 1,
    ok: true,
    command: 'locate',
    locatorVersion: LOCATOR_VERSION,
    mode,
    completeness: 'complete',
    repository,
    map: {
      path: mapPath,
      diagramType: map.diagram_type,
      semanticSha256: semanticHash(map),
      ...(mapRevision ? { revision: mapRevision } : {}),
      ...(mapRevision && mapBehindBy !== undefined ? { mapBehindBy } : {}),
    },
    ownership: {
      path: ownershipPath,
      sha256: ownershipSha256,
      ...(ownership.parent ? {
        parent: { map: ownership.parent.map, component: ownership.parent.component },
      } : {}),
    },
    review,
    summary: { files: fileSummary, components: componentSummary },
    files,
    components,
    facts: sortedBy(facts, (fact) => canonical(fact)),
    limitations: [...LIMITATIONS],
  };
  if (mapDelta) receipt.mapDelta = mapDelta;
  return receipt;
}

export function locateRange({
  base, head, map, ownership, changes, headTree, facts,
  mapPath = 'map.json',
  ownershipPath = 'map.ownership.json',
  ownershipSha256 = sha256(''),
  mapBehindBy,
  mapRevisionUnavailable,
  children,
  repositoryUrl,
  linkMode,
}) {
  const { files, moveFacts } = classifyChanges(changes, ownership);
  const importEdgeFacts = facts
    ? importFacts(readFacts(facts.before, 'facts before'), readFacts(facts.after, 'facts after'), ownership)
    : [];
  const allFacts = [...moveFacts, ...importEdgeFacts];
  const components = buildComponents({ map, ownership, files, headTree, changes, children });
  const repository = { root: '.', base, head };
  if (repositoryUrl) repository.url = repositoryUrl;
  if (linkMode) repository.linkMode = linkMode;
  return finishReceipt({
    mode: 'range',
    map,
    ownership,
    files,
    facts: allFacts,
    components,
    repository,
    mapPath,
    ownershipPath,
    ownershipSha256,
    mapBehindBy,
    mapRevisionUnavailable,
    mapDelta: findMapDelta(changes, mapPath, base, head),
  });
}

export function lintTree({ tree, ownership }) {
  const files = sortedBy(tree.map((filePath) => {
    assertReceiptPath(filePath);
    return {
      path: filePath,
      changeType: 'tracked',
      ...fileFields(classifyPath(filePath, ownership)),
    };
  }), (file) => file.path);
  const summary = countFileStates(files);
  return { files, summary };
}

export function locateLint({
  revision, map, ownership, tree,
  mapPath = 'map.json',
  ownershipPath = 'map.ownership.json',
  ownershipSha256 = sha256(''),
  mapBehindBy,
  mapRevisionUnavailable,
  repositoryUrl,
  linkMode,
  children,
}) {
  const { files } = lintTree({ tree, ownership });
  const components = buildComponents({
    map,
    ownership,
    files,
    headTree: tree,
    changes: [],
    children,
  });
  const repository = { root: '.', revision };
  if (repositoryUrl) repository.url = repositoryUrl;
  if (linkMode) repository.linkMode = linkMode;
  return finishReceipt({
    mode: 'lint',
    map,
    ownership,
    files,
    facts: [],
    components,
    repository,
    mapPath,
    ownershipPath,
    ownershipSha256,
    mapBehindBy,
    mapRevisionUnavailable,
  });
}

export function buildLocateProjection({ base, head, entryReceipt, childReceipts = {} }) {
  const components = {};
  for (const component of entryReceipt.components) {
    components[component.id] = {
      state: component.state,
      files_touched_inside: component.inside ? component.inside.touched : 0,
    };
  }
  const children = {};
  for (const [childId, receipt] of Object.entries(childReceipts)) {
    const nodes = {};
    for (const node of receipt.components) {
      nodes[node.id] = node.touchedCount > 0 ? 'touched' : 'untouched';
    }
    children[childId] = { nodes };
  }
  return { schemaVersion: 1, base, head, components, children };
}

export function embedProjection(entryHtml, projection) {
  const script = `<script id="archify-locate-projection" type="application/json">${JSON.stringify(projection).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026')}</script>`;
  const opened = entryHtml.match(/<body[^>]*>/i);
  if (opened) {
    const index = entryHtml.indexOf(opened[0]) + opened[0].length;
    return `${entryHtml.slice(0, index)}${script}${entryHtml.slice(index)}`;
  }
  const close = entryHtml.lastIndexOf('</body>');
  if (close === -1) return `${entryHtml}${script}`;
  return `${entryHtml.slice(0, close)}${script}${entryHtml.slice(close)}`;
}
