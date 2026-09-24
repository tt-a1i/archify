import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const statuses = new Set(['planned', 'observed', 'supported', 'unknown']);
const id = /^[A-Za-z][A-Za-z0-9_-]*$/;
const hash = /^[a-f0-9]{64}$/;

export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function diagnostic(code, subject, message, supportedFixes = []) {
  return { code, severity: 'error', subject, message, evidence: {}, supportedFixes };
}

function collect(records, field, diagnostics) {
  if (!Array.isArray(records)) {
    diagnostics.push(diagnostic('research/schema', { path: `/${field}` }, `${field} must be an array.`));
    return new Set();
  }
  const ids = new Set();
  for (const [index, record] of (records || []).entries()) {
    if (!record || typeof record !== 'object' || !id.test(record.id || '')) {
      diagnostics.push(diagnostic('research/invalid-id', { path: `/${field}/${index}/id` }, 'Every record requires a stable id.'));
      continue;
    }
    if (ids.has(record.id)) diagnostics.push(diagnostic('research/duplicate-id', { path: `/${field}/${index}/id`, id: record.id }, 'Record ids must be unique.'));
    ids.add(record.id);
    if (!statuses.has(record.status)) diagnostics.push(diagnostic('research/invalid-status', { path: `/${field}/${index}/status`, id: record.id }, 'Status must be planned, observed, supported, or unknown.'));
    if (['datasets', 'code', 'assets'].includes(field) && !hash.test(record.sha256 || '')) diagnostics.push(diagnostic('research/missing-hash', { path: `/${field}/${index}/sha256`, id: record.id }, 'Evidence sources require a SHA-256 hash.'));
  }
  return ids;
}

export function validateManifest(manifest) {
  const diagnostics = [];
  if (!manifest || manifest.schema_version !== 1 || manifest.kind !== 'research-evidence-manifest') {
    diagnostics.push(diagnostic('research/schema', { path: '/' }, 'Expected schema_version 1 and kind research-evidence-manifest.'));
    return diagnostics;
  }
  if (!manifest.revision || typeof manifest.revision !== 'object' || !id.test(manifest.revision.id || '') || !hash.test(manifest.revision.sha256 || '') || !manifest.revision.commit) {
    diagnostics.push(diagnostic('research/revision-invalid', { path: '/revision' }, 'Revision requires id, commit, and SHA-256.'));
  }
  const datasetRecords = Array.isArray(manifest.datasets) ? manifest.datasets : [];
  const codeRecords = Array.isArray(manifest.code) ? manifest.code : [];
  const runRecords = Array.isArray(manifest.runs) ? manifest.runs : [];
  const assetRecordsList = Array.isArray(manifest.assets) ? manifest.assets : [];
  const claimRecords = Array.isArray(manifest.claims) ? manifest.claims : [];
  const datasets = collect(manifest.datasets, 'datasets', diagnostics);
  const code = collect(manifest.code, 'code', diagnostics);
  const runs = collect(manifest.runs, 'runs', diagnostics);
  const assets = collect(manifest.assets, 'assets', diagnostics);
  const assetRecords = new Map(assetRecordsList.filter(asset => asset && typeof asset === 'object').map(asset => [asset.id, asset]));
  collect(manifest.claims, 'claims', diagnostics);
  for (const run of runRecords) {
    if (run.revision !== manifest.revision?.id) diagnostics.push(diagnostic('research/revision-drift', { id: run?.id }, 'Run revision must bind to the manifest revision.', ['set run.revision to the manifest revision id']));
    if (!datasets.has(run.dataset)) diagnostics.push(diagnostic('research/source-missing', { id: run?.id, source: run?.dataset }, 'Run dataset source does not exist.'));
    if (!code.has(run.code)) diagnostics.push(diagnostic('research/source-missing', { id: run?.id, source: run?.code }, 'Run code source does not exist.'));
  }
  for (const asset of assetRecordsList) if (!runs.has(asset.run)) diagnostics.push(diagnostic('research/source-missing', { id: asset?.id, source: asset?.run }, 'Asset run does not exist.'));
  for (const claim of claimRecords) {
    if (!Array.isArray(claim.evidence) || !claim.evidence.length) diagnostics.push(diagnostic('research/claim-without-evidence', { id: claim?.id }, 'Claims require at least one evidence asset.'));
    for (const evidence of claim.evidence || []) if (!assets.has(evidence)) diagnostics.push(diagnostic('research/source-missing', { id: claim?.id, source: evidence }, 'Claim evidence asset does not exist.'));
    if (claim.status === 'supported' && (!(claim.evidence || []).length || (claim.evidence || []).some(evidence => assetRecords.get(evidence)?.status === 'planned'))) diagnostics.push(diagnostic('research/unsupported-supported-claim', { id: claim?.id }, 'Supported claims require evidence that is not planned.'));
  }
  return diagnostics.sort((a, b) => `${a.code}:${JSON.stringify(a.subject)}`.localeCompare(`${b.code}:${JSON.stringify(b.subject)}`));
}

export function renderManifest(manifest) {
  const link = (prefix, value) => `<a href="#${prefix}-${escape(value)}">${escape(value)}</a>`;
  const rows = (manifest.claims || []).map(claim => `<li data-claim-id="${escape(claim.id)}" data-status="${escape(claim.status)}"><strong>${escape(claim.id)}</strong>: ${escape(claim.statement)} <small>${escape(claim.status)} | ${claim.evidence.map(value => link('asset', value)).join(', ')}</small></li>`).join('');
  const assets = (manifest.assets || []).map(asset => `<li id="asset-${escape(asset.id)}">${escape(asset.id)}: ${escape(asset.path)} via ${link('run', asset.run)}</li>`).join('');
  const runs = (manifest.runs || []).map(run => `<li id="run-${escape(run.id)}">${escape(run.id)}: ${link('dataset', run.dataset)} + ${link('code', run.code)}</li>`).join('');
  const datasets = (manifest.datasets || []).map(source => `<li id="dataset-${escape(source.id)}">${escape(source.id)}: ${escape(source.path)}</li>`).join('');
  const code = (manifest.code || []).map(source => `<li id="code-${escape(source.id)}">${escape(source.id)}: ${escape(source.path)}</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Research Evidence Manifest</title><style>body{font-family:system-ui;max-width:900px;margin:2rem auto;color:#172033}li{margin:.7rem 0}small{color:#52657b}</style></head><body><h1>Research Evidence Manifest</h1><p>Revision: ${escape(manifest.revision.id)} @ ${escape(manifest.revision.commit)}</p><h2>Claims</h2><ul>${rows}</ul><h2>Assets</h2><ul>${assets}</ul><h2>Runs</h2><ul>${runs}</ul><h2>Datasets</h2><ul>${datasets}</ul><h2>Code</h2><ul>${code}</ul></body></html>\n`;
}

function escape(value) { return String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]); }

export function readManifest(file) { const bytes = fs.readFileSync(file); return { bytes, manifest: JSON.parse(bytes.toString('utf8')) }; }
export function sameFile(input, output) {
  if (path.resolve(input) === path.resolve(output)) return true;
  try { return fs.realpathSync(input) === fs.realpathSync(output); } catch { return false; }
}
export function writeArtifact(file, html) {
  const destination = path.resolve(file); const directory = path.dirname(destination); fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(destination)}.${process.pid}.tmp`);
  try { fs.writeFileSync(temporary, html, { flag: 'wx' }); fs.renameSync(temporary, destination); } catch (error) { try { fs.unlinkSync(temporary); } catch {} throw error; }
}
