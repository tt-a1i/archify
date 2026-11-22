import fs from 'node:fs';
import path from 'node:path';
import { schemaErrors } from '../schemas/index.mjs';
import { stableJson } from './analysis.mjs';
import { reviewFindings } from './review.mjs';
import { analysisDigest, verificationContext } from './verification-context.mjs';

const name = 'verification-history.json';
const maxCaptures = 6;
const maxBytes = 4 * 1024 * 1024;

function readHistory(dir) {
  try {
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
    const digest = analysisDigest(capture);
    if (seen.has(digest)) return false;
    seen.add(digest);
    return true;
  });
}

// Write inside the staged run. Unchanged runs occupy one slot, and a failed
// scan never updates the published history.
export function retainVerificationBaselines(dir, previousDir, previous, current) {
  const captures = distinctCaptures(current, [previous, ...readHistory(previousDir)]);
  const saved = [];
  let bytes = 2;
  for (const capture of captures) {
    const size = Buffer.byteLength(JSON.stringify(capture)) + 1;
    if (bytes + size > maxBytes) continue;
    bytes += size;
    saved.push(capture);
    if (saved.length === maxCaptures) break;
  }
  if (saved.length) fs.writeFileSync(path.join(dir, name), JSON.stringify(saved));
  return saved;
}

export function verificationContexts(dir, previous, current, facts, history = readHistory(dir)) {
  if (!current) return null;
  const files = [...facts.files, ...(current.externalEvidence || [])].map((file) => file.path);
  const contexts = distinctCaptures(current, [previous, ...history]).map((capture) => {
    const review = reviewFindings(current.diagnostics, { previous: capture, analysis: current.analysis, files });
    return verificationContext(capture, current, review);
  }).filter(Boolean);
  return contexts.length ? contexts : null;
}
