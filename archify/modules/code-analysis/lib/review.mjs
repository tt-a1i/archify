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
//   accepted         in the baseline, evidence unchanged (or no digest recorded)
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
import { fail } from '../extract/shared/diagnostics.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

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

  const findings = {};
  for (const d of diagnostics) {
    const entry = accepted.get(d.id);
    const digest = d.evidenceDigest?.sha256 || null;
    const status = !entry ? 'open' : entry.sha256 && digest && entry.sha256 !== digest ? 'accepted-changed' : 'accepted';
    const prior = before ? before.get(d.id) : undefined;
    const since = !before ? null : !prior ? 'new' : (prior.evidenceDigest?.sha256 || null) !== digest ? 'evidence-changed' : 'unchanged';
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
    comparison: before ? comparisonOf({ previous, before, current, findings, ids, analysis, files }) : null,
    findings,
  };
}

const LEGACY_ID = /^[A-Z]{2,4}-[0-9]{4,}$/;

function comparisonOf({ previous, before, current, findings, ids, analysis, files }) {
  const { comparable, reasons } = comparability(previous.analysis || null, analysis);
  // Position-numbered ids (before stable ids) never match a current id: every finding
  // would read as new and every old one as no longer detected.
  if ([...before.keys()].some((id) => LEGACY_ID.test(id))) reasons.push({ code: 'legacy-ids', message: 'The previous run used position-numbered finding ids, which cannot be matched to the current stable ids; new and no-longer-detected lists are not meaningful for this comparison.' });
  const ran = analysis ? new Set(Object.keys(analysis.ruleVersions)) : null;
  const known = files ? new Set(files) : null;
  const parseErrors = new Set(analysis?.coverage?.parseErrors || []);
  const added = [...current.values()].filter((d) => findings[d.id].since === 'new');
  const notDetected = [...before.values()].filter((d) => !current.has(d.id)).map((d) => {
    const involved = d.evidenceDigest?.files || [];
    const candidates = added.filter((n) => n.code === d.code && (n.evidenceDigest?.files || []).some((f) => involved.includes(f))).map((n) => n.id).sort(compareText);
    const likelyCause = ran && !ran.has(d.code) ? 'rule-not-run'
      : involved.some((f) => parseErrors.has(f)) ? 'parse-error'
        : known && involved.some((f) => !known.has(f)) ? 'files-missing'
          : candidates.length ? 'possibly-renamed' : null;
    return { id: d.id, code: d.code, severity: d.severity, message: d.message, ...(likelyCause ? { likelyCause } : {}), ...(likelyCause === 'possibly-renamed' ? { candidates } : {}) };
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
// comparable is null when either side has no recorded analysis context.
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
  const rulesBefore = before.ruleVersions || {}, rulesAfter = after.ruleVersions || {};
  const removed = Object.keys(rulesBefore).filter((r) => !(r in rulesAfter)).sort(compareText);
  const added = Object.keys(rulesAfter).filter((r) => !(r in rulesBefore)).sort(compareText);
  const changed = Object.keys(rulesAfter).filter((r) => r in rulesBefore && rulesBefore[r] !== rulesAfter[r]).sort(compareText);
  if (removed.length) add('rules-removed', `Rules that ran before did not run now: ${removed.join(', ')}.`);
  if (added.length) add('rules-added', `Rules ran now that did not before: ${added.join(', ')}.`);
  if (changed.length) add('rules-changed', `Rule logic changed: ${changed.join(', ')}.`);
  const roles = (c) => (c?.excludedRoles || []).join(',');
  if (roles(before.coverage) !== roles(after.coverage)) add('scope-changed', 'Excluded file roles changed.');
  const newParseErrors = (after.coverage?.parseErrors || []).filter((f) => !(before.coverage?.parseErrors || []).includes(f));
  if (newParseErrors.length) add('parse-errors', `${newParseErrors.length} file${newParseErrors.length === 1 ? '' : 's'} failed to parse this time: ${newParseErrors.slice(0, 5).join(', ')}${newParseErrors.length > 5 ? ', …' : ''}.`);
  return { comparable: reasons.length === 0, reasons };
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
    accepted: [...diagnostics].sort((a, b) => compareText(a.id, b.id)).map((d) => ({
      id: d.id, code: d.code,
      reason: kept.get(d.id)?.reason || reason,
      ...(d.evidenceDigest?.sha256 ? { sha256: d.evidenceDigest.sha256 } : {}),
    })),
  };
}

// Accept or revoke one finding in a baseline document. The caller chooses the
// file; this only edits the document. `finding` is the current diagnostic, so
// the stored hash matches the evidence being accepted. An empty reason or an
// unknown id is rejected rather than recorded.
export function decideFinding(doc, { id, action, reason, finding }) {
  const accepted = [...(doc?.accepted || [])];
  const index = accepted.findIndex((entry) => entry.id === id);
  if (action === 'revoke') {
    if (index === -1) fail('baseline/not-accepted', `Finding ${id} is not in the baseline.`, { subject: { id }, supportedFixes: ['accept it before revoking it'] });
    accepted.splice(index, 1);
  } else if (action === 'accept') {
    const text = typeof reason === 'string' ? reason.trim() : '';
    if (!text) fail('baseline/reason-required', 'Accepting a finding needs a reason.', { subject: { id }, supportedFixes: ['say why it is kept, for example a business constraint'] });
    if (!finding || finding.id !== id) fail('baseline/unknown-finding', `Finding ${id} is not in the current analysis.`, { subject: { id }, supportedFixes: ['re-analyze and choose a finding from the result'] });
    const entry = { id, code: finding.code, reason: text, ...(finding.evidenceDigest?.sha256 ? { sha256: finding.evidenceDigest.sha256 } : {}) };
    if (index === -1) accepted.push(entry);
    else accepted[index] = entry;
  } else fail('baseline/action-invalid', `Unknown baseline action "${action}".`, { subject: { id }, supportedFixes: ['use accept or revoke'] });
  return { schema_version: 1, accepted: accepted.sort((a, b) => compareText(a.id, b.id)) };
}

function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
