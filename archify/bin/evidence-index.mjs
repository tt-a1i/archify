const DELIVERY_STATES = new Set(['current', 'stale', 'malformed', 'not-run']);
const DELIVERY_OUTCOMES = new Set(['pass', 'fail', 'unknown', 'not-run']);

function deliveryDimension(provenance) {
  const diagnostics = Array.isArray(provenance?.diagnostics) ? provenance.diagnostics : [];
  let status;
  let outcome;

  if (provenance?.ok && provenance.status === 'current') {
    status = 'current';
    outcome = 'pass';
  } else if (provenance?.ok && provenance.status === 'unknown') {
    status = 'not-run';
    outcome = 'not-run';
  } else if (provenance?.status === 'failed') {
    status = 'stale';
    outcome = 'fail';
  } else if (['mismatch', 'locked'].includes(provenance?.status)) {
    status = 'stale';
    outcome = 'unknown';
  } else {
    status = 'malformed';
    outcome = 'unknown';
  }

  return {
    status,
    outcome,
    ...(provenance?.receiptId ? { receiptId: provenance.receiptId } : {}),
    diagnostics,
  };
}

// This module deliberately projects a completed inspection only. Filesystem
// capture, sidecar discovery, receipt parsing, and physical-path identity stay
// owned by the existing delivery provenance seam in archify.mjs.
export function createEvidenceIndex({ artifactPath, provenance }) {
  if (!provenance?.artifact || typeof artifactPath !== 'string') {
    throw new TypeError('Evidence indexing requires a captured artifact provenance result.');
  }
  const delivery = deliveryDimension(provenance);
  if (!DELIVERY_STATES.has(delivery.status) || !DELIVERY_OUTCOMES.has(delivery.outcome)) {
    throw new TypeError('Evidence indexing produced an unsupported delivery state.');
  }
  return {
    schemaVersion: 1,
    command: 'evidence',
    readOnly: true,
    artifact: {
      path: artifactPath,
      sha256: provenance.artifact.sha256,
      bytes: provenance.artifact.bytes,
    },
    dimensions: { delivery },
  };
}

export function formatEvidenceIndex(report) {
  const delivery = report.dimensions.delivery;
  return [
    `artifact: ${report.artifact.path}`,
    `identity: sha256=${report.artifact.sha256} bytes=${report.artifact.bytes}`,
    `delivery: ${delivery.status} (${delivery.outcome})${delivery.receiptId ? ` receipt=${delivery.receiptId}` : ''}`,
    ...delivery.diagnostics.map(entry => `diagnostic: ${entry.code}: ${entry.message}`),
  ].join('\n');
}
