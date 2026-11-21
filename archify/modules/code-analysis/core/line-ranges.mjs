// Line ranges and their digests: the shared vocabulary for "these exact lines
// of this file". Rules pin evidence with them, tasks cite them and the
// evidence check compares them against the working tree, so they live below
// every stage. Pure functions: no file system, no stage imports.
import { createHash } from 'node:crypto';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function splitLines(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function rangeDigest(lines, startLine, endLine) {
  return sha256(lines.slice(startLine - 1, endLine).join('\n'));
}

// Start lines of every range of `length` lines whose digest is `sha`.
export function findRanges(lines, length, sha, firstLine = null) {
  const starts = [];
  for (let start = 1; start + length - 1 <= lines.length; start += 1) {
    if (firstLine !== null && lines[start - 1] !== firstLine) continue;
    if (rangeDigest(lines, start, start + length - 1) === sha) starts.push(start);
  }
  return starts;
}

// Capture each side separately, including two ranges in the same file. Line
// envelopes deliberately include text beside a partial-line clone. Positions
// do not enter the aggregate hash, but the number of identical envelopes does:
// deleting one twin must not let another twin stand in for the removed code.
export function createRangeDigest(locations, sourceMap) {
  if (!Array.isArray(locations) || !locations.length) return null;
  const ranges = [];
  for (const loc of locations) {
    const text = sourceMap.get(loc.file);
    if (typeof text !== 'string' || !Number.isInteger(loc.line) || !Number.isInteger(loc.endLine) || loc.line < 1 || loc.endLine < loc.line) return null;
    const lines = splitLines(text);
    if (loc.endLine > lines.length) return null;
    const sha256 = rangeDigest(lines, loc.line, loc.endLine);
    const cited = lines.slice(loc.line - 1, loc.endLine);
    let capturedOccurrences = 0;
    // UTF-8 hashing folds lone surrogates to U+FFFD. Keep its matching semantics
    // for such JSON source strings; valid Unicode needs no per-window hashing.
    if (/[\uD800-\uDFFF]/u.test(text)) capturedOccurrences = findRanges(lines, cited.length, sha256).length;
    else for (let start = 0; start + cited.length <= lines.length; start++) {
      if (cited.every((line, offset) => line === lines[start + offset])) capturedOccurrences++;
    }
    ranges.push({ file: loc.file, startLine: loc.line, endLine: loc.endLine, sha256, capturedOccurrences });
  }
  return {
    files: [...new Set(ranges.map((r) => r.file))].sort(),
    ranges,
    sha256: sha256(JSON.stringify(ranges.map((r) => [r.file, r.sha256, r.capturedOccurrences]))),
  };
}
