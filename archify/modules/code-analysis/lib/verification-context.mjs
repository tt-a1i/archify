import { createHash } from 'node:crypto';
import { stableJson } from './analysis.mjs';

const sha = /^[a-f0-9]{64}$/;

// Keep source text, commands, and finding messages out of the portable comparison input.
export function verificationContext(previous, current, review) {
  const comparison = review?.comparison;
  if (!comparison || !sha.test(previous?.repository?.snapshotId)
    || !sha.test(current?.repository?.snapshotId)
    || comparison.previousSnapshot !== previous.repository.snapshotId
    || previous.repository.root !== current.repository.root) return null;

  const snapshot = (doc) => ({
    snapshotId: doc.repository.snapshotId,
    analysisSha256: createHash('sha256').update(stableJson(doc)).digest('hex'),
  });
  const reports = (doc) => new Map((doc.analysis?.external || []).map((source) => [source.id, source.reportSha256]));
  const beforeReports = reports(previous), afterReports = reports(current);
  const currentIds = new Set(current.diagnostics.map(({ id }) => id));
  const absent = new Map(comparison.notDetected.map((row) => [row.id, row.likelyCause || null]));
  const changed = new Set(comparison.evidenceChanged);
  const added = new Set(comparison.new);
  return {
    before: snapshot(previous),
    after: snapshot(current),
    root: previous.repository.root,
    configDigest: previous.analysis?.configDigest ?? null,
    comparable: comparison.comparable,
    reasons: comparison.reasons.map(({ code }) => code),
    newCount: comparison.new.length,
    selectedFrom: Object.fromEntries(previous.diagnostics.map((d) => {
      const sourceId = d.external?.sourceId;
      const oldReport = beforeReports.get(sourceId), newReport = afterReports.get(sourceId);
      const report = !sourceId ? null : !sha.test(oldReport) || !sha.test(newReport) ? 'unknown'
        : oldReport === newReport ? 'same-bytes' : 'different-bytes';
      return [d.id, {
        code: d.code, evidence: d.evidenceDigest?.sha256 ?? null,
        claim: d.external?.reviewDigest ?? null, sourceId: sourceId ?? null,
        outcome: absent.has(d.id) ? 'not-detected' : changed.has(d.id) || added.has(d.id) || !currentIds.has(d.id) ? 'evidence-changed' : 'still-detected',
        limitation: absent.get(d.id) ?? null, report,
      }];
    })),
  };
}
