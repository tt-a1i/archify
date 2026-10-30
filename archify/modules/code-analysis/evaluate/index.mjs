// Rule engine: every rule is a module exporting { code, dimension, severity,
// confidence, run({ graph, config, facts }) -> Finding[] } and optionally
// enabled(config, facts): a rule that is not configured, or whose input the
// extractor did not produce, does not run and is
// left out of `rules`, so "not checked" is never reported as "clean". Rules are independent —
// none reads another's output — and every threshold they use is echoed in
// the finding's evidence so a reader can re-check the call.
import * as cycle from './rules/coupling/cycle.mjs';
import * as hub from './rules/coupling/hub.mjs';
import * as internalLeak from './rules/coupling/internal-leak.mjs';
import * as importCycle from './rules/coupling/import-cycle.mjs';
import * as boundary from './rules/architecture/boundary.mjs';
import * as complexity from './rules/complexity/function.mjs';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

const PACKAGE = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

export const RULES = [importCycle, cycle, hub, internalLeak, boundary, complexity];

export function evaluate(graph, config = {}, facts = null) {
  const suppressed = new Set(config.ignore || []);
  const diagnostics = [];
  let suppressedCount = 0;
  const active = RULES.filter((rule) => !rule.enabled || rule.enabled(config, facts));
  for (const rule of active) {
    if (suppressed.has(rule.code)) { suppressedCount += 1; continue; }
    for (const finding of rule.run({ graph, config, facts })) diagnostics.push({ id: '', ...finding });
  }
  // Deterministic output order; ids do not depend on it (see assignIds).
  diagnostics.sort((a, b) => compareText(a.code, b.code) || compareText(JSON.stringify(a.subject), JSON.stringify(b.subject)));
  assignIds(diagnostics, graph);
  if (facts) attachEvidenceDigests(diagnostics, graph, facts);
  const summary = { errors: 0, warnings: 0, info: 0 };
  const key = { error: 'errors', warning: 'warnings', info: 'info' };
  for (const d of diagnostics) summary[key[d.severity]] += 1;
  return {
    schema_version: 1,
    repository: graph.repository,
    rules: active.map((r) => r.code),
    summary: { ...summary, suppressed: suppressedCount },
    analysis: analysisContext({ graph, config, facts, active, suppressed }),
    diagnostics,
  };
}

// What a run's findings depend on besides the source itself. Two runs are
// directly comparable only when these match: a finding that disappears after
// a rule was switched off, a threshold raised, the scan scope changed or a file
// stopped parsing was not fixed. lib/review.mjs compares two of these.
export function analysisContext({ graph, config = {}, facts = null, active = RULES, suppressed = new Set(config.ignore || []) }) {
  const excludedRoles = new Set(graph?.excluded?.roles || []);
  const { schema_version: _ignored, ...settings } = config || {};
  return {
    analyzer: { name: PACKAGE.name, version: PACKAGE.version },
    language: graph?.repository?.language ?? null,
    adapter: graph?.repository?.adapter ?? null,
    adapterRevision: graph?.repository?.adapterRevision ?? null,
    // Key order is kept, not sorted: boundary layers and module groups are first-match
    // maps, so reordering them can change which layer or group owns a file. Reordering
    // any key therefore reads as a config change, which errs toward "not comparable".
    configDigest: sha256(JSON.stringify(settings)),
    ruleVersions: Object.fromEntries(active.filter((r) => !suppressed.has(r.code)).map((r) => [r.code, r.version ?? 1]).sort(([a], [b]) => compareText(a, b))),
    coverage: {
      files: facts ? facts.files.filter((f) => !excludedRoles.has(f.role)).length : null,
      excludedRoles: [...excludedRoles].sort(compareText),
      parseErrors: facts?.parse_errors ? facts.parse_errors.map((e) => e.path).sort(compareText) : [],
    },
  };
}

// A finding id names the problem, not its position in the list: dimension
// prefix + a hash of the rule code and what the finding is about. Adding or
// fixing an unrelated finding leaves every other id unchanged, so ids can be
// compared across runs. Modules are identified by their grouping path, not by
// their generated id, which can change when another module's slug collides.
function assignIds(diagnostics, graph) {
  const anchors = moduleAnchors(graph);
  const taken = new Set();
  for (const d of diagnostics) {
    const identity = JSON.stringify([d.code, identityOf(d.subject, anchors)]);
    // Two findings with the same rule and subject should not exist; if one
    // ever does, the later one (in the deterministic order) is disambiguated.
    let id = idFor(d.dimension, identity);
    for (let n = 2; taken.has(id); n += 1) id = idFor(d.dimension, `${identity}#${n}`);
    taken.add(id);
    d.id = id;
  }
}

// evidenceDigest pins a finding to the source it was computed from: a hash
// over the text of only the files the finding is about (the subject's files,
// every file of the subject's modules, or both ends of each import crossing a
// boundary or reaching inside a module; for a function, only that function's lines). Editing an unrelated file leaves it
// unchanged; repository.snapshotId changes on any edit and is too coarse to
// tell whether this finding's evidence is still current.
function attachEvidenceDigests(diagnostics, graph, facts) {
  const text = new Map((facts.files || []).map((f) => [f.path, f.sourceText]));
  const moduleFiles = new Map();
  for (const [file, id] of Object.entries(graph?.fileModules || {})) {
    if (!moduleFiles.has(id)) moduleFiles.set(id, []);
    moduleFiles.get(id).push(file);
  }
  for (const d of diagnostics) {
    const files = [...new Set(subjectFiles(d, moduleFiles))].sort(compareText);
    if (!files.length) continue;
    const sub = d.subject || {};
    // A function finding covers only the function's own lines: edits elsewhere in the file keep it current.
    const span = typeof sub.function === 'string' && Number.isInteger(sub.line) && Number.isInteger(sub.endLine) ? [sub.line, sub.endLine] : null;
    const parts = files.map((f) => {
      const source = text.has(f) && typeof text.get(f) === 'string' ? text.get(f) : null;
      if (source === null) return [f, null];
      return [f, sha256(span ? source.split(/\r?\n/).slice(span[0] - 1, span[1]).join('\n') : source)];
    });
    d.evidenceDigest = { files, ...(span ? { lines: span } : {}), sha256: sha256(JSON.stringify(parts)) };
  }
}

function subjectFiles(finding, moduleFiles) {
  const subject = finding.subject;
  if (Array.isArray(subject?.files)) return subject.files;
  if (typeof subject?.file === 'string') return [subject.file];
  // A boundary or internal-leak finding is about the imports it cites: both ends of each.
  if (subject?.boundary || finding.code === 'coupling/internal-leak') return (finding.evidence?.imports || []).flatMap((i) => [i.file, i.to]);
  const modules = Array.isArray(subject?.modules) ? subject.modules : typeof subject?.module === 'string' ? [subject.module] : [];
  return modules.flatMap((id) => moduleFiles.get(id) || []);
}

function sha256(text) { return createHash('sha256').update(text).digest('hex'); }

function idFor(dimension, identity) {
  return `${dimension.toUpperCase().slice(0, 4)}-${createHash('sha256').update(identity).digest('hex').slice(0, 12)}`;
}

function identityOf(subject, anchors) {
  const anchor = (id) => anchors.get(id) ?? `id:${id}`;
  // A function is identified by file and qualified name, not by its lines, so edits above it keep its id.
  if (typeof subject?.file === 'string' && typeof subject?.function === 'string') return { file: subject.file, function: subject.function };
  if (Array.isArray(subject?.files)) return { files: [...subject.files].sort(compareText) };
  if (Array.isArray(subject?.modules)) return { modules: subject.modules.map(anchor).sort(compareText) };
  if (typeof subject?.module === 'string') return { module: anchor(subject.module) };
  return canonical(subject);
}

function moduleAnchors(graph) {
  const groups = new Set(graph?.grouping?.groups || []);
  const anchors = new Map();
  for (const m of graph?.modules || []) {
    // path '' is either a single root-level file (label = its path) or the root directory.
    const anchor = m.path ? (groups.has(m.path) ? `group:${m.path}` : `dir:${m.path}`) : m.label === '(root)' ? 'root' : `file:${m.label}`;
    anchors.set(m.id, anchor);
  }
  return anchors;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort(compareText).map((k) => [k, canonical(value[k])]));
  return value;
}

function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
