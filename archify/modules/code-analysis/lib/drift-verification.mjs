import { DRIFT_EVIDENCE_LIMIT, driftDigest } from './architecture-drift.mjs';
import { fail } from '../core/index.mjs';

const hash = /^[a-f0-9]{64}$/u;
const oid = /^[a-f0-9]{40}$/u;
const reportKind = 'archify-drift-task';
const checksKind = 'archify-drift-project-checks';
const identityKeys = ['irSha256', 'mapSha256', 'configSha256', 'analyzer', 'adapterRevision'];
const selection = (edge) => [edge.from, edge.to];
const taskId = (reportSha256, pair) => 'DRIFT-' + driftDigest(JSON.stringify([reportSha256, pair])).slice(0, 16);

export function driftTask(reportSha256, edge) {
  const pair = selection(edge);
  return { schemaVersion: 1, kind: reportKind, id: taskId(reportSha256, pair), reportSha256, pair };
}

function reportContext({ bytes, doc }, input) {
  if (doc?.schemaVersion !== 1 || doc.command !== 'drift' || doc.status !== 'ok'
      || !['base', 'head'].every(key => typeof doc.pins?.[key] === 'string' && oid.test(doc.pins[key]))
      || !identityKeys.slice(0, 3).every(key => typeof doc.inputs?.[key] === 'string' && hash.test(doc.inputs[key]))
      || typeof doc.inputs?.analyzer !== 'string' || !Number.isSafeInteger(doc.inputs.adapterRevision)
      || !Array.isArray(doc.edges)) {
    fail('drift-verification/invalid-report', 'Select a saved successful architecture drift report.', { subject: { input } });
  }
  return { reportSha256: driftDigest(bytes), doc };
}

export function validateDriftFollowup(input, pins, originalIrRevision, irSha256) {
  const { doc } = reportContext(input, 'original');
  if (doc.pins.head !== pins.base || doc.pins.head === pins.head
      || doc.inputs.irSha256 !== irSha256
      || (originalIrRevision && ![doc.pins.base, doc.pins.head].includes(originalIrRevision))) {
    fail('drift-verification/mismatched-followup', 'Use the saved original report, start from its head commit and retain the exact Architecture IR.');
  }
  return doc.inputs;
}

function edgeOf(doc, pair) {
  const edges = doc.edges.filter(edge => edge?.from === pair[0] && edge?.to === pair[1]);
  return edges.length === 1 ? edges[0] : null;
}

function validCapture(capture) {
  return Number.isSafeInteger(capture?.count) && capture.count >= 0
    && Array.isArray(capture.locations) && capture.locations.length === Math.min(capture.count, DRIFT_EVIDENCE_LIMIT)
    && capture.locations.every(loc => typeof loc?.path === 'string' && loc.path.length > 0
      && Number.isSafeInteger(loc.line) && loc.line > 0 && typeof loc.target === 'string' && loc.target.length > 0
      && typeof loc.text === 'string');
}

function matchingEvidence(a, b) {
  const sites = capture => capture.locations.map(loc => [loc.path, loc.line, loc.target, loc.text]);
  return a.count === b.count && JSON.stringify(sites(a)) === JSON.stringify(sites(b));
}

function readChecks(reported, template) {
  if (reported === undefined) return { status: 'not-reported', checks: [] };
  if (reported?.schemaVersion !== 1 || reported.kind !== checksKind || reported.taskId !== template.taskId
      || reported.originalSha256 !== template.originalSha256 || reported.followupSha256 !== template.followupSha256
      || !Array.isArray(reported.checks) || !reported.checks.length || reported.checks.length > 40) {
    fail('drift-verification/invalid-checks', 'Select checks made from the template for these two reports.');
  }
  const seen = new Set();
  const checks = reported.checks.map(check => {
    const name = typeof check?.name === 'string' ? check.name.trim() : '';
    if (!name || name.length > 120 || seen.has(name) || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(name)
        || !['passed', 'failed', 'skipped', 'not-run'].includes(check.status)) {
      fail('drift-verification/invalid-checks', 'Use unique check names and a status of passed, failed, skipped, or not-run.');
    }
    seen.add(name);
    return { name, status: check.status };
  });
  return { status: 'reported-not-independently-verified', checks };
}

export function verifyDriftTask(originalInput, followupInput, task, reported) {
  const original = reportContext(originalInput, 'original');
  const followup = reportContext(followupInput, 'follow-up');
  const pair = task?.pair;
  if (task?.schemaVersion !== 1 || task.kind !== reportKind || original.reportSha256 !== task.reportSha256
      || !Array.isArray(pair) || pair.length !== 2 || pair.some(id => typeof id !== 'string' || !id)
      || task.id !== taskId(original.reportSha256, pair)) {
    fail('drift-verification/invalid-task', 'Export the selected relationship task from the original drift report.');
  }
  const selected = edgeOf(original.doc, pair);
  if (selected?.state !== 'new-undeclared' || selected.declared !== false
      || !Array.isArray(selected.reasons) || selected.reasons.length !== 0
      || !validCapture(selected.base) || selected.base.count !== 0 || !validCapture(selected.head) || selected.head.count === 0) {
    fail('drift-verification/invalid-task', 'The original report must show a newly observed undeclared relationship.');
  }
  if (followup.doc.pins.base !== original.doc.pins.head
      || followup.doc.pins.head === followup.doc.pins.base
      || identityKeys.some(key => followup.doc.inputs[key] !== original.doc.inputs[key])) {
    fail('drift-verification/mismatched-followup', 'Start at the original head commit, select a distinct follow-up head, and reuse the same diagram, mapping, config and adapter.');
  }

  const observed = edgeOf(followup.doc, pair);
  let outcome = 'inconclusive';
  let reasons = ['original-observation-not-reproduced'];
  if (observed && (observed.declared !== selected.declared || !validCapture(observed.base) || !validCapture(observed.head))) {
    reasons = ['unexpected-followup-observation'];
  } else if (observed && matchingEvidence(selected.head, observed.base)) {
    reasons = observed.reasons;
    if (Array.isArray(reasons) && reasons.length === 0) {
      if (observed.state === 'not-observed-at-head' && observed.head?.count === 0) outcome = 'not-observed-at-head';
      else if (observed.state === 'previously-observed' && observed.head?.count > 0) outcome = 'still-observed';
      else reasons = ['unexpected-followup-observation'];
    } else if (observed.state !== 'inconclusive' || !Array.isArray(reasons) || reasons.some(reason => typeof reason !== 'string')) {
      reasons = ['unexpected-followup-observation'];
    }
  }

  const checksTemplate = {
    schemaVersion: 1, kind: checksKind, taskId: task.id,
    originalSha256: original.reportSha256, followupSha256: followup.reportSha256,
    checks: [{ name: 'Project check', status: 'not-run' }],
  };
  return {
    checksTemplate,
    receipt: {
      schemaVersion: 1, kind: 'archify-drift-verification', command: 'verify-drift', status: 'ok',
      taskId: task.id, pair, original: { pins: original.doc.pins, sha256: original.reportSha256 },
      followup: { pins: followup.doc.pins, sha256: followup.reportSha256 }, analysis: { outcome, reasons },
      projectChecks: readChecks(reported, checksTemplate),
    },
  };
}
