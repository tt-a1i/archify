import path from 'node:path';
import { createHash } from 'node:crypto';
import { fail } from '../core/index.mjs';
import { resolveMapping } from './diagram-mapping.mjs';

export const DRIFT_EVIDENCE_LIMIT = 8;
const order = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const pair = (a, b) => JSON.stringify([a, b]);
const staticImport = imp => ['static', 'export', 'require'].includes(imp.kind) && !imp.typeOnly && !imp.lazy && !imp.conditional;
export const driftDigest = value => createHash('sha256').update(value).digest('hex');

// The TS snapshot host tracks both bytes read and observed missing config files.
export function driftResolutionInputs(root, reads) {
  const inputs = new Map([['tsconfig.json', null]]);
  for (const [file, content] of reads) {
    const relative = path.relative(root, file);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) continue;
    inputs.set(relative.split(path.sep).join('/'), content === undefined ? null : driftDigest(content));
  }
  return inputs;
}

function boundedText(line) {
  if (line.length <= 400) return line;
  return line.slice(0, 399) + '…';
}

function project({ facts, graph, omitted }, ir, map) {
  const ids = new Set(graph.modules.map(m => m.id));
  const byModule = new Map();
  for (const [component, modules] of resolveMapping(ir, graph, map)) {
    for (const id of modules) {
      if (!ids.has(id)) continue;
      const list = byModule.get(id) || [];
      list.push(component);
      byModule.set(id, list);
    }
  }
  const components = new Set([...byModule.values()].filter(v => v.length === 1).flat());
  const owner = file => byModule.get(Object.hasOwn(graph.fileModules, file) ? graph.fileModules[file] : null) || [];
  const errors = new Set((facts.parse_errors || []).map(e => e.path));
  const relevantErrors = [...errors].filter(file => owner(file).length);
  const ambiguity = [...byModule].filter(([, owners]) => owners.length > 1)
    .map(([module, owners]) => ({ module, components: owners })).sort((a, b) => order(a.module, b.module));
  const sources = new Map(facts.files.map(f => [f.path, f.sourceText]));
  const lines = new Map();
  function location(imp) {
    if (!lines.has(imp.from)) lines.set(imp.from, sources.get(imp.from)?.split(/\r\n|[\r\n\u2028\u2029]/u) || []);
    const line = lines.get(imp.from)[imp.line - 1];
    return typeof line === 'string' && imp.line > 0
      ? { path: imp.from, line: imp.line, target: imp.to, text: boundedText(line) } : null;
  }
  const edges = new Map(), uncertain = new Set(), unresolved = new Map();
  for (const imp of facts.imports) {
    if (!staticImport(imp)) continue;
    const from = owner(imp.from);
    if (!from.length) continue;
    if (!imp.resolved) {
      // Keep the unresolved identities, not just totals. A known import on
      // one side must not be reported as a new relation when resolution changed.
      for (const id of from) {
        const list = unresolved.get(id) || new Set();
        list.add(pair(imp.from, imp.specifier));
        unresolved.set(id, list);
      }
      continue;
    }
    const to = owner(imp.to);
    for (const a of from) for (const b of to) {
      if (a === b) continue;
      const key = pair(a, b);
      if (from.length !== 1 || to.length !== 1 || errors.has(imp.from) || errors.has(imp.to)) {
        uncertain.add(key);
        continue;
      }
      const record = edges.get(key) || { count: 0, locations: [] };
      const evidence = location(imp);
      if (!evidence) { uncertain.add(key); continue; }
      record.count++;
      if (record.locations.length < DRIFT_EVIDENCE_LIMIT) record.locations.push(evidence);
      edges.set(key, record);
    }
  }
  return { edges, uncertain, unresolved, components, ambiguity, owner, relevantErrors, omitted,
    coverage: { files: facts.files.length, mappedComponents: components.size, ambiguousModules: ambiguity.length,
      unmappedModules: graph.modules.length - byModule.size, parseErrors: errors.size, scopedParseErrors: relevantErrors.length,
      unresolvedImports: facts.unresolved, skippedLinks: omitted.size } };
}

const empty = () => ({ count: 0, locations: [] });
const differs = (a = new Set(), b = new Set()) => a.size !== b.size || [...a].some(x => !b.has(x));
function changedPaths(a, b) {
  return [...new Set([...a.keys(), ...b.keys()])].some(k => a.get(k) !== b.get(k));
}

export function compareArchitectureDrift({ base, head, ir, map, pins, inputs, locale }) {
  const left = project(base, ir, map), right = project(head, ir, map);
  const declared = new Set(ir.connections.map(e => pair(e.from, e.to)));
  const movedLink = changedPaths(left.omitted, right.omitted);
  // Files read for resolution can differ naturally as imports move. A
  // different value for a shared resolution input makes absence ambiguous.
  const resolutionChanged = [...base.resolutionInputs].some(([file, digest]) =>
    head.resolutionInputs.has(file) && head.resolutionInputs.get(file) !== digest);
  const adapterChanged = base.facts.repository.adapter !== head.facts.repository.adapter ||
    base.facts.repository.adapterRevision !== head.facts.repository.adapterRevision;
  const keys = new Set([...left.edges.keys(), ...right.edges.keys(), ...left.uncertain, ...right.uncertain]);
  const edges = [...keys].sort(order).map(key => {
    const [from, to] = JSON.parse(key);
    const before = left.edges.get(key) ?? empty(), after = right.edges.get(key) ?? empty();
    const reasons = [];
    if (adapterChanged) reasons.push('adapter-changed');
    if (left.uncertain.has(key) || right.uncertain.has(key)) reasons.push('unverified-edge-evidence');
    if ([left, right].some(side => side.relevantErrors.some(file => side.owner(file).some(id => id === from || id === to)))) reasons.push('affected-parse-errors');
    if (!before.count || !after.count) {
      if ([left, right].some(side => side.ambiguity.some(m => m.components.includes(from) || m.components.includes(to)))) reasons.push('ambiguous-ownership');
      if ([left, right].some(side => !side.components.has(from) || !side.components.has(to))) reasons.push('component-not-mapped-on-both-sides');
      if (differs(left.unresolved.get(from), right.unresolved.get(from))) reasons.push('unresolved-imports-changed');
      if (movedLink) reasons.push('skipped-tree-entries-changed');
      if (resolutionChanged) reasons.push('resolution-inputs-changed');
    }
    const inDiagram = declared.has(key);
    const state = reasons.length ? 'inconclusive' : before.count
      ? after.count ? 'previously-observed' : 'not-observed-at-head'
      : inDiagram ? 'new-declared' : 'new-undeclared';
    return { from, to, state, declared: inDiagram, base: before, head: after, reasons };
  });
  const count = state => edges.filter(e => e.state === state).length;
  return { schemaVersion: 1, command: 'drift', status: 'ok', locale, pins, inputs,
    components: ir.components.map(c => ({ id: c.id, label: c.label })),
    coverage: { base: left.coverage, head: right.coverage },
    summary: { newUndeclared: count('new-undeclared'), newDeclared: count('new-declared'),
      previouslyObserved: count('previously-observed'), notObservedAtHead: count('not-observed-at-head'), inconclusive: count('inconclusive') },
    edges };
}

export function checkDriftMapping(ir, map) {
  if (map === null) return;
  const known = new Set(ir.components.map(c => c.id));
  if (typeof map !== 'object' || Array.isArray(map) || Object.entries(map).some(([id, modules]) =>
    !known.has(id) || !Array.isArray(modules) || modules.some(m => typeof m !== 'string' || !m.trim()))) {
    fail('drift/map-invalid', 'An overlay map must map authored component IDs to arrays of module IDs.');
  }
}
