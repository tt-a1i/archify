import fs from 'node:fs';
import path from 'node:path';
import { schemaErrors } from '../schemas/index.mjs';
import { createHash } from 'node:crypto';
import { stableJson, loadPrevious } from './analysis.mjs';
import { reviewFindings } from './review.mjs';
import { taskAnalysisDigest, verificationContext } from './verification-context.mjs';

const name = 'verification-history.json';
const maxCaptures = 6;
const maxBytes = 4 * 1024 * 1024;
const ownerName = 'verification-owner.json';

function repositoryIdentity(root) {
  const resolved = fs.realpathSync.native(root);
  const canonical = process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  const stat = fs.statSync(resolved);
  return createHash('sha256').update(JSON.stringify([canonical, stat.dev, stat.ino, stat.birthtimeMs])).digest('hex');
}

export function sameVerificationRepository(currentDir, previousDir) {
  try {
    const read = dir => JSON.parse(fs.readFileSync(path.join(dir, ownerName), 'utf8')).identity;
    const identity = read(currentDir);
    return /^[a-f0-9]{64}$/.test(identity) && identity === read(previousDir);
  } catch { return false; }
}

// An adjacent PR head is eligible only when both saved views identify the
// same PR and pins. The merge-base remains the ordinary comparison baseline.
export function matchingPreviousPullRequest(previousDir, current, currentPR) {
  try {
    const old = JSON.parse(fs.readFileSync(path.join(previousDir, 'view-context.json'), 'utf8')).run.pullRequest;
    const previous = loadPrevious(path.join(previousDir, 'findings.json'));
    if (!old || !currentPR || !previous || old.local || currentPR.local || !Number.isInteger(old.number) || old.number < 1
      || old.number !== currentPR.number || typeof old.repository !== 'string' || typeof currentPR.repository !== 'string'
      || old.repository.toLowerCase() !== currentPR.repository.toLowerCase()
      || old.scope !== currentPR.scope || !/^[a-f0-9]{40}$/.test(old.baseSHA || '') || old.baseSHA !== currentPR.baseSHA
      || !/^[a-f0-9]{40}$/.test(old.headSHA || '') || !/^[a-f0-9]{40}$/.test(currentPR.headSHA || '')
      || previous.repository.revision !== old.headSHA || current.repository.revision !== currentPR.headSHA) return null;
    return previous;
  } catch { return null; }
}

function readHistory(dir) {
  try {
    const owner = JSON.parse(fs.readFileSync(path.join(dir, ownerName), 'utf8'));
    if (!/^[a-f0-9]{64}$/.test(owner.identity)) return [];
    const file = path.join(dir, name);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > maxBytes) return [];
    const history = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(history) || history.length > maxCaptures) return [];
    return history.filter((capture) => capture && !schemaErrors('findings', capture).length);
  } catch { return []; }
}

function distinctCaptures(current, captures) {
  const seen = new Set();
  return captures.filter((capture) => {
    if (!capture || capture.repository.root !== current.repository.root
      || (capture.repository.sourceKind ?? 'working-tree') !== (current.repository.sourceKind ?? 'working-tree')) return false;
    const digest = taskAnalysisDigest(capture);
    if (seen.has(digest)) return false;
    seen.add(digest);
    return true;
  });
}

// Write inside the staged run. Unchanged runs occupy one slot, and a failed
// scan never updates the published history.
export function retainVerificationBaselines(dir, previousDir, previous, current, root) {
  const identity = repositoryIdentity(root);
  fs.writeFileSync(path.join(dir, ownerName), JSON.stringify({ identity }));
  const same = sameVerificationRepository(dir, previousDir);
  const history = same ? readHistory(previousDir) : [];
  // Keep the earlier byte-exact representative for an existing task identity.
  // Checks exported against that capture must survive supplemental-only edits.
  const priorIdentity = previous && taskAnalysisDigest(previous);
  const retainedDuplicate = priorIdentity && history.find(capture => taskAnalysisDigest(capture) === priorIdentity);
  const captures = same ? [retainedDuplicate || previous, previous, ...history] : [];
  const saved = [];
  const seen = new Set();
  let bytes = 2;
  for (const capture of captures) {
    if (!capture || capture.repository.root !== current.repository.root ||
      (capture.repository.sourceKind ?? 'working-tree') !== (current.repository.sourceKind ?? 'working-tree')) continue;
    const digest = taskAnalysisDigest(capture);
    if (seen.has(digest)) continue;
    const size = Buffer.byteLength(JSON.stringify(capture)) + 1;
    if (bytes + size > maxBytes) continue;
    bytes += size;
    saved.push(capture);
    seen.add(digest);
    if (saved.length === maxCaptures) break;
  }
  if (saved.length) fs.writeFileSync(path.join(dir, name), JSON.stringify(saved));
  return saved;
}

export function verificationContexts(dir, previous, current, facts, history = readHistory(dir)) {
  if (!current) return null;
  const files = [...facts.files, ...(current.externalEvidence || [])].map((file) => file.path);
  const contexts = distinctCaptures(current, [...history, previous]).map((capture) => {
    const review = reviewFindings(current.diagnostics, { previous: capture, analysis: current.analysis, files });
    return verificationContext(capture, current, review);
  }).filter(Boolean);
  return contexts.length ? contexts : null;
}
