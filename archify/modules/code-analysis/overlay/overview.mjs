// Overview: the project-level reading of one analysis, built from the
// top-level findings list (each finding once, with moduleIds and
// componentIds). It answers three questions without inventing a quality
// score: what was found, what to look at first, and what was not checked.
//
// - groups: one entry per rule, worst severity first, with the finding ids.
// - related: a finding is related to another when it is the same structure
//   seen at another level: a file cycle nested in a larger file cycle, or a
//   file cycle across modules that lies inside a module-level cycle. Related
//   findings stay listed but never take two priority slots.
// - priorities: at most MAX_PRIORITIES findings, by severity, then by how much
//   of the project they reach (modules, then size for measured findings such
//   as complexity, then dependents and files), then by id. The best finding of
//   each rule at the top severity is picked first, so one rule with many
//   instances does not take every slot; remaining slots follow the ranking.
// - review: findings accepted in the baseline (with unchanged evidence) are
//   listed and counted but excluded from the verdict and the priorities; an
//   accepted finding whose evidence changed is open again. `review` also
//   carries the comparison with the previous run when there is one.
// - coverage: what this run looked at and what it did not.
// Everything here is derived from data already in the payload; no wording is
// produced, so the page and an agent read the same facts.

import { layerCounts } from '../evaluate/index.mjs';

export const MAX_PRIORITIES = 3;
const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };

export function buildOverview({ findings = [], graph, facts = null, unmapped = [], run = {} }) {
  const modules = new Map((graph?.modules || []).map((m) => [m.id, m]));
  const related = relate(findings);
  const entries = findings.map((f) => ({
    id: f.id,
    code: f.code,
    severity: f.severity,
    componentIds: f.componentIds || [],
    moduleIds: f.moduleIds || [],
    impact: impactOf(f, modules),
    relatedIds: [...(related.get(f.id) || [])].sort(compareText),
    status: f.review?.status || 'open',
    ...(f.review?.since ? { since: f.review.since } : {}),
  }));
  const ranked = [...entries].sort(compareEntries);
  const priorities = [];
  const covered = new Set();
  const take = (e) => { priorities.push(e.id); covered.add(e.id); for (const r of e.relatedIds) covered.add(r); };
  const rulesTaken = new Set();
  const open = ranked.filter((e) => e.status !== 'accepted');
  const topSeverity = open.length ? open[0].severity : null;
  for (const e of open) {
    if (priorities.length >= MAX_PRIORITIES || e.severity !== topSeverity) break;
    if (covered.has(e.id) || rulesTaken.has(e.code)) continue;
    rulesTaken.add(e.code);
    take(e);
  }
  for (const e of open) {
    if (priorities.length >= MAX_PRIORITIES) break;
    if (!covered.has(e.id)) take(e);
  }
  // Severity counts and the verdict cover open findings only.
  const bySeverity = { error: 0, warning: 0, info: 0 };
  for (const e of open) bySeverity[e.severity] += 1;
  const accepted = entries.length - open.length;
  return {
    verdict: bySeverity.error + bySeverity.warning > 0 ? 'attention' : bySeverity.info > 0 ? 'signals-only' : 'none-found',
    // acceptedErrors: errors in the baseline. They do not fail a run, but a reader must still see them as unresolved.
    counts: { findings: findings.length, ...bySeverity, accepted, acceptedErrors: entries.filter((e) => e.status === 'accepted' && e.severity === 'error').length, offDiagram: entries.filter((e) => !e.componentIds.length).length },
    review: reviewOf(run.review),
    groups: groupsOf(ranked),
    priorities,
    findings: ranked,
    coverage: coverageOf({ graph, facts, unmapped, run }),
  };
}

function reviewOf(review) {
  if (!review || (!review.baseline && !review.comparison)) return null;
  return {
    baseline: review.baseline ? { entries: review.baseline.entries, accepted: review.baseline.accepted.length, changed: review.baseline.changed, stale: review.baseline.stale } : null,
    // `fixed` is a deprecated alias of `notDetected`: a finding that is gone is not proven fixed (see lib/review.mjs).
    comparison: review.comparison ? { comparable: review.comparison.comparable ?? null, reasons: review.comparison.reasons || [], new: review.comparison.new, notDetected: review.comparison.notDetected || review.comparison.fixed, fixed: review.comparison.notDetected || review.comparison.fixed, evidenceChanged: review.comparison.evidenceChanged, unchanged: review.comparison.unchanged } : null,
  };
}

function relate(findings) {
  const out = new Map();
  const link = (a, b) => {
    (out.get(a.id) || out.set(a.id, new Set()).get(a.id)).add(b.id);
    (out.get(b.id) || out.set(b.id, new Set()).get(b.id)).add(a.id);
  };
  const fileCycles = findings.filter((f) => f.code === 'coupling/import-cycle' && Array.isArray(f.subject?.files));
  const moduleCycles = findings.filter((f) => f.code === 'coupling/cycle' && Array.isArray(f.subject?.modules));
  for (const a of fileCycles) for (const b of fileCycles) {
    if (a !== b && a.subject.files.length < b.subject.files.length && isSubset(a.subject.files, b.subject.files)) link(a, b);
  }
  for (const fc of fileCycles) {
    const mods = fc.moduleIds || [];
    if (mods.length < 2) continue; // a cycle inside one module does not make a module cycle
    for (const mc of moduleCycles) if (isSubset(mods, mc.subject.modules)) link(fc, mc);
  }
  return out;
}

function impactOf(f, modules) {
  const moduleIds = f.moduleIds || [];
  const fanIn = moduleIds.reduce((n, id) => n + (modules.get(id)?.fanIn || 0), 0);
  const files = Array.isArray(f.subject?.files) ? f.subject.files.length
    : moduleIds.reduce((n, id) => n + (modules.get(id)?.files || 0), 0);
  // Size of a measured finding (cyclomatic complexity); 0 for structural ones.
  const size = Number.isInteger(f.evidence?.complexity) ? f.evidence.complexity : 0;
  return { modules: moduleIds.length, size, fanIn, files };
}

function compareEntries(a, b) {
  return SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
    || b.impact.modules - a.impact.modules
    || b.impact.size - a.impact.size
    || b.impact.fanIn - a.impact.fanIn
    || b.impact.files - a.impact.files
    || compareText(a.id, b.id);
}

function groupsOf(ranked) {
  const groups = new Map();
  for (const e of ranked) {
    if (!groups.has(e.code)) groups.set(e.code, { code: e.code, severity: e.severity, count: 0, ids: [] });
    const g = groups.get(e.code);
    g.count += 1;
    g.ids.push(e.id);
    if (SEVERITY_RANK[e.severity] < SEVERITY_RANK[g.severity]) g.severity = e.severity;
  }
  return [...groups.values()].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.count - a.count || compareText(a.code, b.code));
}

function coverageOf({ graph, facts, unmapped, run }) {
  const excludedRoles = new Set(graph?.excluded?.roles || []);
  const rules = run.rules || [];
  return {
    language: graph?.repository?.language ?? null,
    adapter: graph?.repository?.adapter ?? null,
    files: {
      analyzed: facts ? facts.files.filter((f) => !excludedRoles.has(f.role)).length : null,
      excludedByRole: graph?.excluded?.files ?? 0,
      excludedRoles: [...excludedRoles].sort(compareText),
      // Files matching these patterns are never enumerated, so they are named, not counted.
      excludePatterns: run.exclude || [],
      parseErrors: facts?.parse_errors ? facts.parse_errors.map((e) => e.path).sort(compareText) : [],
    },
    otherLanguages: run.otherLanguages || [],
    unresolved: graph?.unresolved || null,
    rules: { run: rules.filter((r) => !(run.suppressed || []).includes(r)), suppressed: (run.suppressed || []).filter((r) => rules.includes(r)) },
    unmappedModules: unmapped.map((m) => m.id),
    // Declared layers and how many analyzed files each one matched; null when no boundaries are configured.
    boundaries: run.boundaries && facts ? layerCounts(run.boundaries, facts.files.filter((f) => !excludedRoles.has(f.role)).map((f) => f.path)) : null,
    // Files the duplicate detector analyzed out of those selected for it; null when it did not run.
    duplicates: duplicateCoverage(run.duplicates),
  };
}

function duplicateCoverage(analysis) {
  const c = analysis?.coverage;
  if (!c) return null;
  const selected = (c.selected || []).length;
  const analyzed = (c.analyzed || []).length;
  return { analyzed, selected, omitted: (c.omitted || []).length, complete: c.complete === true && selected > 0 && analyzed === selected };
}

function isSubset(small, big) {
  const set = new Set(big);
  return small.every((x) => set.has(x));
}

function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
