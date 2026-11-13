// Review: how this run's findings relate to what the team already decided
// (the baseline) and to the previous run (the comparison). Both rely on the
// stable finding id; the evidence digest tells "same problem, same code" from
// "same problem, code changed since".
//
// Baseline file (`--baseline`), kept in the repository and reviewed like code:
//   { "schema_version": 1,
//     "accepted": [{ "id": "COMP-…", "code": "complexity/function",
//                    "reason": "main loop; split after the 2.0 release",
//                    "sha256": "<evidenceDigest.sha256 when accepted>" }] }
//
// Per finding the review status is
//   open             not in the baseline
//   accepted         in the baseline, evidence unchanged (legacy internal entries may omit a digest)
//   accepted-changed in the baseline, but its evidence changed since: re-review
// Baseline entries whose finding no longer occurs are reported as stale: the
// problem was fixed or moved, and the entry can be removed.
//
// Comparison with the previous run's findings.json lists findings that are
// new, no longer detected, and evidence-changed. A run without a previous
// result has no comparison rather than "everything is new".
//
// "No longer detected" is not "fixed". A finding also disappears when its rule
// was switched off or changed, a threshold or the scan scope changed, a file
// stopped parsing, or a function was renamed (its id changes). The comparison
// therefore carries `comparable` (true, false, or null when the previous run
// recorded no analysis context) with the reasons, and each entry of
// `notDetected` carries a `likelyCause` when one is visible from the data:
//   rule-not-run   the rule did not run this time
//   files-missing  a file it was about is no longer analyzed (deleted, renamed, excluded)
//   parse-error    a file it was about failed to parse this time
// A previous run written before stable ids (COUP-0001 style) is still read; its
// comparison carries the reason `legacy-ids` and is never comparable.
//   possibly-renamed  a new finding of the same rule covers the same files (a renamed
//                  function, a cycle that gained a file); `candidates` lists their ids
// `fixed` is kept as a deprecated alias of `notDetected` (same entries) for
// existing consumers; new consumers should read `notDetected`.
import { fail } from '../core/index.mjs';
import { schemaErrors } from '../schemas/index.mjs';
import { createHash } from 'node:crypto';

// An acceptance must refer to the claim the page actually displayed, even
// when another page has since re-analyzed a finding with the same stable id.
// UI projections and prior review state do not change the reviewed claim.
export function reviewTargetDigest(diagnostic) {
  const { id, code, dimension, severity, confidence, message, subject, evidence, evidenceDigest, external, supportedFixes } = diagnostic;
  const serialized = JSON.stringify({ id, code, dimension, severity, confidence, message, subject, evidence, evidenceDigest, external, supportedFixes }, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => compareText(a, b))) : value);
  return createHash('sha256').update(serialized).digest('hex');
}

export function validateBaseline(doc, file = null) {
  const errors = schemaErrors('baseline', doc);
  if (errors.length) fail('baseline/invalid', `The baseline${file ? ` ${file}` : ''} does not match baseline.schema.json.`, {
    subject: { file }, evidence: { errors: errors.slice(0, 20) },
    supportedFixes: ['fix the listed fields', 'regenerate it with `archify code-analysis check --update-baseline`'],
  });
  return doc;
}

export function reviewFindings(diagnostics, { baseline = null, previous = null, analysis = null, files = null } = {}) {
  const accepted = new Map((baseline?.accepted || []).map((entry) => [entry.id, entry]));
  const current = new Map(diagnostics.map((d) => [d.id, d]));
  const before = previous ? new Map((previous.diagnostics || []).map((d) => [d.id, d])) : null;

  const measurement = before ? comparability(previous.analysis || null, analysis) : null;
  const pairs = before ? pairOccurrences(before, current, measurement.comparable === true) : null;
  const findings = {};
  for (const d of diagnostics) {
    const entry = accepted.get(d.id);
    const digest = d.evidenceDigest?.sha256 || null;
    // External acceptance binds two independent facts: the captured code and
    // the source's claim about it. A legacy entry with neither is not a review
    // of a newly imported claim, even when its stable id happens to match.
    const changed = d.external
      ? !externalAcceptable(d) || entry?.code !== d.code || entry?.sha256 !== digest || entry?.externalReviewDigest !== d.external.reviewDigest
      : entry?.sha256 && digest && entry.sha256 !== digest;
    const status = !entry ? 'open' : changed ? 'accepted-changed' : 'accepted';
    const prior = pairs?.previousByCurrent.get(d.id);
    const claimChanged = prior?.external?.sourceId !== d.external?.sourceId
      || prior?.external?.reviewDigest !== d.external?.reviewDigest
      || prior?.external?.binding !== d.external?.binding;
    const since = !before ? null : !prior ? 'new' : prior.id !== d.id || (prior.evidenceDigest?.sha256 || null) !== digest || claimChanged ? 'evidence-changed' : 'unchanged';
    findings[d.id] = { status, ...(entry ? { reason: entry.reason } : {}), ...(since ? { since } : {}) };
  }

  const ids = (filter) => diagnostics.filter(filter).map((d) => d.id).sort(compareText);
  return {
    schema_version: 1,
    baseline: baseline ? {
      entries: accepted.size,
      accepted: ids((d) => findings[d.id].status === 'accepted'),
      changed: ids((d) => findings[d.id].status === 'accepted-changed'),
      stale: [...accepted.values()].filter((e) => !current.has(e.id)).map((e) => ({ id: e.id, code: e.code, reason: e.reason })).sort((a, b) => compareText(a.id, b.id)),
    } : null,
    comparison: before ? comparisonOf({ previous, before, current, findings, ids, analysis, files, measurement, matchedBefore: pairs.matchedBefore }) : null,
    findings,
  };
}

// Prefer the stable format shared by the producer and baseline schema: its
// 12 hex digits can be entirely numeric. Older counters use the remaining
// numeric forms. A 12-digit historical counter is inherently ambiguous.
const STABLE_ID = /^[A-Z]{2,4}-[0-9a-f]{12}$/;
const LEGACY_ID = /^[A-Z]{2,4}-[0-9]{4,}$/;

// Prefer a unique exact ESLint occurrence before matching IDs: a repeated
// diagnostic can inherit a former ID when a surrounding context moves.
function pairOccurrences(before, current, comparable) {
  const previousByCurrent = new Map(), matchedBefore = new Set();
  const pair = (prior, next) => {
    previousByCurrent.set(next.id, prior);
    matchedBefore.add(prior.id);
  };
  if (comparable) {
    const left = uniqueEslintLocations(before), right = uniqueEslintLocations(current);
    for (const [key, next] of right) {
      const prior = left.get(key);
      if (prior && next) pair(prior, next);
    }
  }
  for (const [id, next] of current) {
    const prior = before.get(id);
    if (prior && !matchedBefore.has(id) && !previousByCurrent.has(id)) pair(prior, next);
  }
  return { previousByCurrent, matchedBefore };
}

function uniqueEslintLocations(findings) {
  const locations = new Map();
  for (const d of findings.values()) {
    const e = d.external, s = d.subject;
    if (d.code !== 'conventions/eslint' || e?.binding !== 'verified' || !e.comparisonLineSha256 || !e.reviewDigest || !s?.file || !s.line || !s.column) continue;
    const key = JSON.stringify([e.sourceId, e.reviewDigest, s.file, s.line, s.endLine ?? s.line,
      s.column, s.endColumn ?? null, e.comparisonLineSha256]);
    locations.set(key, locations.has(key) ? null : d);
  }
  return locations;
}

function comparisonOf({ previous, before, current, findings, ids, analysis, files, measurement, matchedBefore }) {
  const { comparable, reasons } = measurement;
  // Position-numbered ids (before stable ids) never match a current id: every finding
  // would read as new and every old one as no longer detected.
  if ([...before.keys()].some((id) => !STABLE_ID.test(id) && LEGACY_ID.test(id))) reasons.push({ code: 'legacy-ids', message: 'The previous run used position-numbered finding ids, which cannot be matched to the current stable ids; new and no-longer-detected lists are not meaningful for this comparison.' });
  const ran = analysis ? new Set(Object.keys(analysis.ruleVersions)) : null;
  const known = files ? new Set(files) : null;
  const parseErrors = new Set(analysis?.coverage?.parseErrors || []);
  const added = [...current.values()].filter((d) => findings[d.id].since === 'new');
  const notDetected = [...before.values()].filter((d) => !matchedBefore.has(d.id)).map((d) => {
    const involved = d.evidenceDigest?.files || [];
    const candidates = added.filter((n) => n.code === d.code
      && (!d.external || (n.external?.sourceId === d.external.sourceId && n.external.ruleId === d.external.ruleId))
      && (n.evidenceDigest?.files || []).some((f) => involved.includes(f))).map((n) => n.id).sort(compareText);
    // An empty external report has no current citations to capture. Its
    // declared scan scope, not the AST adapter's file inventory or the rules
    // that happened to produce findings, explains whether an old item was checked.
    const likelyCause = d.external ? externalAbsenceCause(d, analysis, reasons) || (candidates.length ? 'possibly-renamed' : null)
      : ran && !ran.has(d.code) ? 'rule-not-run'
      : involved.some((f) => parseErrors.has(f)) ? 'parse-error'
        : known && involved.some((f) => !known.has(f)) ? 'files-missing'
          : candidates.length ? 'possibly-renamed' : null;
    return { id: d.id, code: d.code, severity: d.severity, message: d.message, ...(d.external ? { sourceId: d.external.sourceId } : {}), ...(likelyCause ? { likelyCause } : {}), ...(likelyCause === 'possibly-renamed' ? { candidates } : {}) };
  }).sort((a, b) => compareText(a.id, b.id));
  return {
    previousSnapshot: previous.repository?.snapshotId || null,
    comparable: reasons.some((r) => r.code === 'legacy-ids') ? false : comparable, reasons,
    new: ids((d) => findings[d.id].since === 'new'),
    evidenceChanged: ids((d) => findings[d.id].since === 'evidence-changed'),
    notDetected,
    fixed: notDetected,
    unchanged: [...current.keys()].filter((id) => findings[id].since === 'unchanged').length,
  };
}

// Whether two runs measured the same way. Returns { comparable, reasons[] }:
// comparable is null when required context is unrecorded, unless another
// known difference already establishes that the runs are not comparable.
export function comparability(before, after) {
  if (!before || !after) return { comparable: null, reasons: [{ code: 'context-missing', message: `The ${before ? 'current' : 'previous'} run recorded no analysis context (written by an older version); differences cannot be attributed to code changes alone.` }] };
  const reasons = [];
  const add = (code, message) => reasons.push({ code, message });
  if (before.language !== after.language) add('language-changed', `Language changed from ${before.language} to ${after.language}.`);
  if (before.analyzer?.version !== after.analyzer?.version) add('analyzer-changed', `Analyzer version changed from ${before.analyzer?.version} to ${after.analyzer?.version}.`);
  // The extractor decides what parses and how dependencies resolve: both the parser or
  // runtime it uses (adapter) and its own logic (adapterRevision). A run that recorded no
  // revision cannot be matched to one that did, so the first comparison after upgrading
  // reports the change.
  const revision = (context) => context.adapterRevision ?? null;
  const changes = [];
  if (before.adapter !== after.adapter) changes.push(`Extractor changed from ${before.adapter} to ${after.adapter}.`);
  if (revision(before) !== revision(after)) changes.push(`Extraction logic changed from revision ${revision(before) ?? 'unrecorded'} to ${revision(after) ?? 'unrecorded'}.`);
  if (changes.length) add('adapter-changed', changes.join(' '));
  if (before.configDigest !== after.configDigest) add('config-changed', 'The analysis configuration changed (thresholds, include/exclude, roles, boundaries or ignored rules).');
  if (before.language === 'go' && after.language === 'go') {
    const left = before.goBuildScope, right = after.goBuildScope;
    if (!left || !right) add('go-build-scope-missing', 'At least one Go run recorded no effective build scope; platform and build-tag selection cannot be compared.');
    else if (!['goos', 'goarch', 'cgo', 'tests', 'tags', 'releaseTags', 'toolTags'].every((key) => JSON.stringify(left[key]) === JSON.stringify(right[key]))) add('go-build-scope-changed', 'The effective Go platform, build tags, test or cgo selection changed.');
  }
  const rulesBefore = before.ruleVersions || {}, rulesAfter = after.ruleVersions || {};
  const removed = Object.keys(rulesBefore).filter((r) => !(r in rulesAfter)).sort(compareText);
  const added = Object.keys(rulesAfter).filter((r) => !(r in rulesBefore)).sort(compareText);
  const changed = Object.keys(rulesAfter).filter((r) => r in rulesBefore && rulesBefore[r] !== rulesAfter[r]).sort(compareText);
  if (removed.length) add('rules-removed', `Rules that ran before did not run now: ${removed.join(', ')}.`);
  if (added.length) add('rules-added', `Rules ran now that did not before: ${added.join(', ')}.`);
  if (changed.length) add('rules-changed', `Rule logic changed: ${changed.join(', ')}.`);
  const duplicateRule = 'redundancy/duplicate-block';
  if (duplicateRule in rulesBefore || duplicateRule in rulesAfter) {
    const left = before.duplicates, right = after.duplicates;
    if (!left || !right) add('duplicates-context-missing', 'Duplicate detection did not record its engine and coverage in both runs.');
    else {
      if (JSON.stringify(left.engine) !== JSON.stringify(right.engine)) add('duplicates-engine-changed', 'The duplicate detector version or adapter changed.');
      if (JSON.stringify(left.settings) !== JSON.stringify(right.settings)) add('duplicates-settings-changed', 'The effective duplicate detection settings changed.');
      if (!left.coverage?.complete || !right.coverage?.complete) add('duplicates-coverage-incomplete', 'At least one duplicate scan omitted selected files or had no eligible input; absence of a clone does not establish a fix.');
      const paths = (c, field) => [...(c?.coverage?.[field] || [])].sort(compareText);
      if (JSON.stringify(paths(left, 'selected')) !== JSON.stringify(paths(right, 'selected'))
        || JSON.stringify(paths(left, 'analyzed')) !== JSON.stringify(paths(right, 'analyzed'))) add('duplicates-scope-changed', 'The selected or analyzed files for duplicate detection changed.');
    }
  }
  const roles = (c) => (c?.excludedRoles || []).join(',');
  if (roles(before.coverage) !== roles(after.coverage)) add('scope-changed', 'Excluded file roles changed.');
  const newParseErrors = (after.coverage?.parseErrors || []).filter((f) => !(before.coverage?.parseErrors || []).includes(f));
  if (newParseErrors.length) add('parse-errors', `${newParseErrors.length} file${newParseErrors.length === 1 ? '' : 's'} failed to parse this time: ${newParseErrors.slice(0, 5).join(', ')}${newParseErrors.length > 5 ? ', …' : ''}.`);
  reasons.push(...externalComparisonReasons(before.external, after.external));
  return { comparable: reasons.some((r) => r.code !== 'go-build-scope-missing') ? false : reasons.length ? null : true, reasons };
}

// Source contexts describe how an external report was produced. The changing
// report bytes are deliberately not an equality key: fixing one warning should
// produce a different report without making the two scans incomparable.
function externalComparisonReasons(before = [], after = []) {
  const previous = new Map(before.map((source) => [source.id, source]));
  const current = new Map(after.map((source) => [source.id, source]));
  const reasons = [];
  for (const sourceId of [...new Set([...previous.keys(), ...current.keys()])].sort(compareText)) {
    const left = previous.get(sourceId), right = current.get(sourceId);
    const add = (code, message) => reasons.push({ code, sourceId, message: `${sourceId}: ${message}` });
    if (!left) { add('external-source-added', 'this source was not recorded in the previous analysis.'); continue; }
    if (!right) { add('external-source-missing', 'this source was not imported in the current analysis; its absent findings were not checked.'); continue; }
    if (left.status !== 'imported' || right.status !== 'imported' || left.coverage?.complete === false || right.coverage?.complete === false) {
      add('external-coverage-incomplete', 'at least one report has incomplete coverage; absence of a finding does not establish a fix.');
    } else if (left.coverage?.complete !== true || right.coverage?.complete !== true) {
      add('external-coverage-unknown', 'the reports do not both establish complete scan coverage.');
    }
    if (left.binding === 'changed' || right.binding === 'changed') add('external-binding-changed', 'at least one report does not match the captured source.');
    else if (left.binding !== 'verified' || right.binding !== 'verified') add('external-binding-unverified', 'the reports were not both verified against the source they claim to check.');
    if (!left.tool || !right.tool || !left.toolVersion || !right.toolVersion) add('external-tool-unknown', 'the tool and its version were not recorded in both reports.');
    else if (left.tool !== right.tool || left.toolVersion !== right.toolVersion) add('external-tool-changed', 'the tool or its version changed.');
    if (!left.configDigest || !right.configDigest) add('external-config-unknown', 'the effective external rule configuration was not recorded in both reports.');
    else if (left.configDigest !== right.configDigest) add('external-config-changed', 'the effective external rule configuration changed.');
    if (left.severityPolicy !== right.severityPolicy || left.importSettingsDigest !== right.importSettingsDigest) {
      add('external-import-settings-changed', 'the severity mapping or source import settings changed.');
    } else if (!left.severityPolicy || !left.importSettingsDigest) {
      add('external-import-settings-unknown', 'the severity mapping or source import settings were not recorded.');
    }
    if (left.format !== right.format || left.adapterRevision !== right.adapterRevision || left.identityRevision !== right.identityRevision) {
      add('external-adapter-changed', 'the report format, import logic or identity algorithm changed.');
    } else if (!Number.isInteger(left.adapterRevision) || !Number.isInteger(left.identityRevision)) {
      add('external-context-missing', 'the import logic or identity algorithm version was not recorded.');
    }
    const paths = (source) => [...new Set(source.coverage?.files || [])].sort(compareText);
    if (JSON.stringify(paths(left)) !== JSON.stringify(paths(right))) add('external-scope-changed', 'the files selected for the external check changed.');
  }
  return reasons;
}

function externalAbsenceCause(diagnostic, analysis, reasons) {
  if (!analysis) return 'external-context-missing';
  const source = analysis.external?.find((entry) => entry.id === diagnostic.external.sourceId);
  if (!source) return 'external-source-missing';
  const reason = reasons.find((entry) => entry.sourceId === source.id);
  return reason?.code || null;
}

const SHA256 = /^[0-9a-f]{64}$/;

function externalAcceptable(diagnostic) {
  return SHA256.test(diagnostic.evidenceDigest?.sha256 || '')
    && SHA256.test(diagnostic.external?.reviewDigest || '')
    && ['verified', 'unverified'].includes(diagnostic.external?.binding);
}

function baselineEntry(diagnostic, reason) {
  if (diagnostic.external && !externalAcceptable(diagnostic)) fail('baseline/evidence-unverifiable', 'An external finding needs captured source evidence and a current source claim before it can be accepted.', {
    subject: { id: diagnostic.id, sourceId: diagnostic.external.sourceId },
    supportedFixes: ['regenerate the external report for the current source and import it again', 'capture the cited source before reviewing the finding'],
  });
  return {
    id: diagnostic.id, code: diagnostic.code, reason,
    ...(diagnostic.evidenceDigest?.sha256 ? { sha256: diagnostic.evidenceDigest.sha256 } : {}),
    ...(diagnostic.external ? { externalReviewDigest: diagnostic.external.reviewDigest } : {}),
  };
}

// A finding counts against a gate unless it is accepted with unchanged evidence.
export function isOpen(review, id) {
  return !review || !review.findings[id] || review.findings[id].status !== 'accepted';
}

// A baseline that accepts every current finding. Reasons of entries that are
// still current are kept; new entries get `reason`. Stale entries are dropped.
export function baselineFrom(diagnostics, { existing = null, reason }) {
  const kept = new Map((existing?.accepted || []).map((e) => [e.id, e]));
  return {
    schema_version: 1,
    accepted: [...diagnostics].sort((a, b) => compareText(a.id, b.id)).map((d) => baselineEntry(d, kept.get(d.id)?.reason || reason)),
  };
}

// Single-item operations preserve unrelated and stale entries. The backend owns
// the baseline path and publishes this returned document; these helpers perform
// no filesystem writes and never change the finding's source binding.
export function acceptFinding(diagnostic, { existing = null, reason } = {}) {
  if (typeof reason !== 'string' || !reason.trim()) fail('baseline/reason-required', 'Explain why this finding is accepted.', {
    subject: { id: diagnostic?.id }, supportedFixes: ['provide a non-empty reason after reviewing the evidence'],
  });
  if (!diagnostic?.id || !diagnostic.code) fail('baseline/finding-invalid', 'A finding with a stable id and rule code is required.', { supportedFixes: ['select a finding from the current analysis'] });
  if (existing) validateBaseline(existing);
  const entry = baselineEntry(diagnostic, reason.trim());
  return validateBaseline({ schema_version: 1, accepted: [...(existing?.accepted || []).filter((item) => item.id !== diagnostic.id).map((item) => ({ ...item })), entry].sort((a, b) => compareText(a.id, b.id)) });
}

export function revokeFinding(id, { existing = null } = {}) {
  if (typeof id !== 'string' || !STABLE_ID.test(id)) fail('baseline/finding-invalid', 'A stable finding id is required.', { supportedFixes: ['select a current or accepted finding'] });
  if (existing) validateBaseline(existing);
  return validateBaseline({ schema_version: 1, accepted: (existing?.accepted || []).filter((entry) => entry.id !== id).map((entry) => ({ ...entry })) });
}

function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
