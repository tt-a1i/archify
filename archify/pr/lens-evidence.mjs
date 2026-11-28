import { runGit, runPinnedDiff, verifyRepositorySourceAnchors } from '../renderers/shared/repository-evidence.mjs';
import { failPrPack } from './errors.mjs';
import { assertReviewText, changeSourceAnchors } from './manifest.mjs';
import { readPinnedNumstat, summarizeNumstat } from './preflight.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const headerPattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: [^\n]*)?$/;
const noNewline = '\\ No newline at end of file';

function evidenceFailure(code, message, path = '/') {
  failPrPack(`pr-lens/${code}`, 'revisions', message, { subject: { path } });
}

function readGit({ repoRoot }, args) {
  const result = runGit(repoRoot, args, { bytes: true, locale: 'C' });
  if (result.status !== 0) evidenceFailure('git-read-failed', 'Could not read the pinned Git objects.');
  return result.stdout;
}

function decodeText(bytes) {
  if (bytes.includes(0)) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

function splitLines(text) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

// Match Git's C-style quoting with core.quotePath fixed for patch output.
// Space alone does not cause Git to quote a name.
function gitPath(prefix, path) {
  const bytes = Buffer.from(prefix + path);
  const escapes = { 7: 'a', 8: 'b', 9: 't', 10: 'n', 11: 'v', 12: 'f', 13: 'r', 34: '"', 92: '\\' };
  let quoted = false;
  const value = Array.from(bytes, (byte) => {
    if (byte >= 32 && byte < 127 && !escapes[byte]) return String.fromCharCode(byte);
    quoted = true;
    return '\\' + (escapes[byte] || byte.toString(8).padStart(3, '0'));
  }).join('');
  return quoted ? `"${value}"` : value;
}

function parseHunks(lines, oldBlob, newBlob) {
  const hunks = [];
  for (let index = lines.findIndex((line) => line.startsWith('@@')); index >= 0 && index < lines.length;) {
    const header = lines[index++];
    const match = headerPattern.exec(header);
    if (!match) evidenceFailure('invalid-patch', 'Git returned an invalid unified hunk header.');
    const [, oldStart, oldCount = '1', newStart, newCount = '1'] = match;
    const rows = [];
    let oldLine = Number(oldStart);
    let newLine = Number(newStart);
    while (index < lines.length && !lines[index].startsWith('@@')) {
      const line = lines[index++];
      if (line === noNewline && rows.length && rows.at(-1).kind !== 'marker') {
        rows.push({ kind: 'marker', oldLine: null, newLine: null, text: line });
        continue;
      }
      const kind = { ' ': 'context', '-': 'deletion', '+': 'addition' }[line[0]];
      const text = line.slice(1);
      const oldNumber = kind === 'addition' ? null : oldLine++;
      const newNumber = kind === 'deletion' ? null : newLine++;
      if (!kind || (oldNumber !== null && oldBlob[oldNumber - 1] !== text)
        || (newNumber !== null && newBlob[newNumber - 1] !== text)) {
        evidenceFailure('invalid-patch', 'A Git hunk row differs from its pinned blob.');
      }
      rows.push({ kind, oldLine: oldNumber, newLine: newNumber, text });
    }
    if (oldLine - Number(oldStart) !== Number(oldCount) || newLine - Number(newStart) !== Number(newCount)) {
      evidenceFailure('invalid-patch', 'Git hunk rows differ from the header counts.');
    }
    hunks.push({ header, rows });
  }
  return hunks;
}

function readFilePatch(revisions, { oldPath, newPath, status, addressable }) {
  const { baseSha, headSha } = revisions;
  const paths = [...new Set([oldPath, newPath].filter(Boolean))];
  if (!addressable) return { reason: 'Text diff unavailable for this pathname encoding.', hunks: [] };
  const result = runPinnedDiff(revisions.repoRoot, baseSha, headSha, [
    '--patch', '--unified=3', '--inter-hunk-context=0',
    '--output-indicator-old=-', '--output-indicator-new=+', '--output-indicator-context= ',
    '--src-prefix=a/', '--dst-prefix=b/', '--submodule=short',
  ], { bytes: true, paths });
  if (result.status !== 0) evidenceFailure('git-read-failed', 'Could not read the pinned Git objects.');
  const bytes = result.stdout;
  const header = `diff --git ${gitPath('a/', oldPath ?? newPath)} ${gitPath('b/', newPath ?? oldPath)}`;
  // A path pair can also select a section for a different file. Split using
  // byte-preserving text first so unrelated non-UTF-8 rows cannot affect it.
  const sections = bytes.toString('latin1').split(/\n(?=diff --git )/);
  const matching = sections.filter((section) => section.startsWith(header + '\n'));
  if (matching.length !== 1 && !(status === 'T' && matching.length === 2)) {
    evidenceFailure('invalid-patch', 'Could not identify the indexed file in the pinned patch.');
  }
  const file = (reason, hunks = []) => ({ reason, hunks });
  const patchSections = [];
  for (const section of matching) {
    const text = decodeText(Buffer.from(section, 'latin1'));
    if (text === null) return file('Text diff unavailable for this encoding.');
    const lines = splitLines(text);
    const firstHunk = lines.findIndex((line) => line.startsWith('@@'));
    const metadata = firstHunk === -1 ? lines : lines.slice(0, firstHunk);
    if (metadata.some((line) => /^(?:index .* |(?:new file|deleted file|old|new) mode )160000$/.test(line))) {
      return file('Submodule change has no source text hunk.');
    }
    if (metadata.some((line) => line.startsWith('Binary files ') || line === 'GIT binary patch')) {
      return file('Binary file has no text hunk.');
    }
    patchSections.push({ lines, metadata, firstHunk });
  }
  if (patchSections.every(({ firstHunk }) => firstHunk === -1)) {
    if (status === 'R100') return file('File was renamed without text changes.');
    if (patchSections[0].metadata.some((line) => line.startsWith('old mode '))) return file('File mode changed without text changes.');
    return file('File has no text hunk.');
  }
  const blob = (sha, path) => path === null ? '' : decodeText(readGit(revisions, ['cat-file', 'blob', `${sha}:${path}`]));
  const oldText = blob(baseSha, oldPath);
  const newText = blob(headSha, newPath);
  if (oldText === null || newText === null) return file('Text diff unavailable for this encoding.');
  const oldBlob = splitLines(oldText);
  const newBlob = splitLines(newText);
  return file(null, patchSections.flatMap(({ lines }) => parseHunks(lines, oldBlob, newBlob)));
}

export function loadLensEvidence(pack, revisions, { stats = false } = {}) {
  const selectors = pack.manifest.walkthrough?.slices || [];
  const named = new Map();
  const hunks = [];
  const cache = new Map();
  const { repoRoot, baseSha, headSha, verified } = revisions;
  const unavailable = 'Git diff unavailable — matching checkout required';
  const index = pack.filePairs || new Map();

  function resolve(selector, pointer, explicit) {
    const { side, path, line, hunk } = selector;
    const citation = { side, path, line };
    if (!verified) return { ...citation, reason: unavailable };
    const pair = index.get(`${side}:${path}`);
    if (!pair) evidenceFailure('path-not-found', 'Path is absent on the selected side of the pinned diff.', `${pointer}/path`);
    let file = cache.get(pair);
    if (!file) {
      file = readFilePatch(revisions, pair);
      cache.set(pair, file);
    }
    const match = file.hunks[line === undefined ? (hunk ?? 1) - 1 : file.hunks.findIndex((entry) =>
      entry.rows.some((row) => row[side === 'base' ? 'oldLine' : 'newLine'] === line))];
    if (!match) {
      if (explicit && (line !== undefined || hunk !== undefined)) {
        evidenceFailure('hunk-not-found', 'No text hunk contains the selected line or ordinal.', `${pointer}/${line === undefined ? 'hunk' : 'line'}`);
      }
      return { ...citation, oldPath: pair.oldPath, newPath: pair.newPath, reason: file.reason || 'Line outside displayed diff.' };
    }
    if (match.index === undefined) {
      const evidence = { oldPath: pair.oldPath, newPath: pair.newPath, ...match };
      assertReviewText(evidence, pointer, 'revisions');
      match.index = hunks.push(evidence) - 1;
    }
    return { ...citation, hunkIndex: match.index };
  }

  const anchors = [];
  for (const [position, selector] of selectors.entries()) {
    const pointer = `/walkthrough/slices/${position}`;
    named.set(selector.id, resolve(selector, pointer, true));
    if (verified && selector.line !== undefined) anchors.push({
      path: selector.path, line: selector.line, revision: selector.side === 'base' ? baseSha : headSha,
      subject: { path: `${pointer}/line` },
    });
  }
  try {
    if (anchors.length) verifyRepositorySourceAnchors(repoRoot, anchors);
  } catch (error) {
    evidenceFailure('hunk-not-found', 'Could not verify the selected line in its pinned blob.', error.archifyDiagnostics?.[0]?.subject?.path);
  }

  function forChanges(changes) {
    const citations = [];
    const seen = new Set();
    for (const { row, index } of changes) {
      for (const anchor of changeSourceAnchors(row)) {
        const citation = resolve(anchor, `/changes/${index}`, false);
        const key = citation.hunkIndex ?? JSON.stringify(citation);
        if (seen.has(key)) continue;
        seen.add(key);
        citations.push(citation);
      }
    }
    return [...citations.filter((entry) => entry.hunkIndex !== undefined), ...citations.filter((entry) => entry.hunkIndex === undefined)];
  }

  return {
    named, hunks, forChanges, unavailable,
    counts: verified && stats ? summarizeNumstat(readPinnedNumstat(repoRoot, baseSha, headSha)) : null,
  };
}
