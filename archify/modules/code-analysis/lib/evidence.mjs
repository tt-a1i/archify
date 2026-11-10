// Evidence check: is what a task (or a finding) cites still what the working
// tree contains? Compares the analysis snapshot with the current files and
// reports, per location, per finding and for the whole task, one of
//   valid         the cited lines are unchanged (possibly moved; see currentStartLine)
//                 and the finding's evidence digest still matches
//   changed       the cited lines, or other code the finding depends on, changed
//   missing       a cited file no longer exists (deleted, renamed) under the root
//   unverifiable  the snapshot holds no text or range for it, or the file cannot be read
// Severity order for the roll-up: missing > changed > unverifiable > valid.
//
// Two levels are checked because they answer different questions. The
// location hash covers exactly the cited lines, so an unrelated edit above a
// function only moves it. The finding's evidenceDigest covers what the rule
// read (whole files for import findings, the function's lines for
// complexity), so an import added elsewhere in a cycle's files still marks
// the finding changed even when the cited import lines are intact.
//
// Paths come from a task file that may have been edited or shared: they are
// resolved inside `root` only (no absolute paths, no `..`, no symlink
// escapes). The check reads files; it never runs project code.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { findRanges, rangeDigest, splitLines } from './task.mjs';

const RANK = { valid: 0, unverifiable: 1, changed: 2, missing: 3 };

export function worst(statuses) {
  return statuses.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'valid');
}

// Read a repository-relative file under root, or report why not.
export function readInside(root, rel) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) return { status: 'unverifiable', reason: 'path is not a plain repository-relative path' };
  let realRoot;
  try { realRoot = fs.realpathSync(root); } catch { return { status: 'unverifiable', reason: 'analysis root is not readable' }; }
  const target = path.resolve(realRoot, rel);
  if (!fs.existsSync(target)) return { status: 'missing', reason: 'file no longer exists' };
  let real;
  try { real = fs.realpathSync(target); } catch { return { status: 'unverifiable', reason: 'file cannot be resolved' }; }
  const relative = path.relative(realRoot, real);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return { status: 'unverifiable', reason: 'file resolves outside the analysis root' };
  try {
    if (!fs.statSync(real).isFile()) return { status: 'missing', reason: 'path is no longer a file' };
    return { status: 'ok', text: decodeSource(fs.readFileSync(real), rel) };
  } catch (error) { return { status: 'unverifiable', reason: `file cannot be read (${error.code || error.message})` }; }
}

// Decode a file the way the extractor did. Python files honour a PEP 263
// coding declaration in their first two lines (tokenize.detect_encoding);
// everything else is read as UTF-8. An encoding Node cannot decode falls back
// to UTF-8, which at worst reports the evidence as changed, never as valid.
const PYTHON_CODECS = { utf_8: 'utf-8', utf8: 'utf-8', 'utf-8': 'utf-8', 'utf-8-sig': 'utf-8' };
// cp1252 is decoded from a fixed table: TextDecoder('windows-1252') differs
// between Node builds (some return the raw byte for 0x80-0x9f). Bytes Python's
// cp1252 leaves undefined become U+FFFD.
const CP1252_HIGH = [0x20ac, 0xfffd, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0xfffd, 0x017d, 0xfffd, 0xfffd, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0xfffd, 0x017e, 0x0178];
const CP1252_ALIASES = new Set(['cp1252', 'windows_1252', '1252']);
function decodeCp1252(buffer) {
  let out = '';
  for (const byte of buffer) out += String.fromCharCode(byte >= 0x80 && byte < 0xa0 ? CP1252_HIGH[byte - 0x80] : byte);
  return out;
}
// Python's latin_1 codec and its aliases are true ISO-8859-1 (byte n is code
// point n). WHATWG TextDecoder maps every latin-1 label to windows-1252, which
// differs for 0x80-0x9f, so these decode byte for byte instead.
const LATIN1_ALIASES = new Set(['latin_1', 'latin1', 'latin', 'l1', 'iso_8859_1', 'iso8859_1', '8859', 'cp819', 'iso_latin_1', 'iso_ir_100', 'csisolatin1']);
function isLatin1(declared) {
  const name = declared.replace(/[-\s.]/g, '_');
  // tokenize.get_normal_name also maps prefixed forms such as latin-1-unix.
  return LATIN1_ALIASES.has(name) || /^(latin_1|iso_8859_1|iso_latin_1)_/.test(name);
}

export function decodeSource(buffer, rel) {
  if (!/\.pyi?$/i.test(rel)) return buffer.toString('utf8');
  // tokenize.detect_encoding selects utf-8-sig for Python's UTF-8 signature.
  // Strip it before comparing decoded text or interpreting first-line columns.
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return buffer.subarray(3).toString('utf8');
  const head = buffer.subarray(0, 512).toString('latin1').split(/\r?\n/).slice(0, 2);
  let declared = null;
  for (const line of head) {
    const match = line.match(/^[ \t\f]*#.*?coding[:=][ \t]*([-\w.]+)/);
    if (match) { declared = match[1].toLowerCase(); break; }
    if (!/^[ \t\f]*(#.*)?$/.test(line)) break; // only a blank or comment first line lets the second declare it
  }
  if (!declared) return buffer.toString('utf8');
  if (isLatin1(declared)) return buffer.toString('latin1');
  if (CP1252_ALIASES.has(declared.replace(/[-\s.]/g, '_'))) return decodeCp1252(buffer);
  const label = PYTHON_CODECS[declared] || PYTHON_CODECS[declared.replace(/-/g, '_')] || declared.replace(/_/g, '-');
  try { return new TextDecoder(label).decode(buffer); } catch { return buffer.toString('utf8'); }
}

// Python decodes a UTF-8 BOM away; Node keeps it. Hash both forms so the
// same bytes are recognized whichever extractor captured them.
function variants(text) {
  return text.charCodeAt(0) === 0xfeff ? [text, text.slice(1)] : [text];
}

// Check one location against the current lines of its file.
export function checkLocation(loc, current) {
  if (!loc.sha256 || !Number.isInteger(loc.startLine)) return { status: 'unverifiable', reason: loc.kind === 'file' ? 'no line evidence to compare' : 'source text was not captured' };
  if (current.status !== 'ok') return { status: current.status, reason: current.reason };
  const length = loc.endLine - loc.startLine + 1;
  let ambiguous = false;
  for (const text of variants(current.text)) {
    const lines = splitLines(text);
    if (loc.endLine <= lines.length && rangeDigest(lines, loc.startLine, loc.endLine) === loc.sha256) return { status: 'valid' };
    // Moved: the same lines once elsewhere in the file (code above was edited). Only an
    // unambiguous match counts: if the block occurred more than once when it was captured,
    // or occurs more than once now, a match may be a twin of the cited code, not the code itself.
    const matches = findRanges(lines, length, loc.sha256);
    if (matches.length === 1 && (loc.capturedOccurrences || 1) === 1) {
      const start = matches[0];
      return { status: 'valid', currentStartLine: start, currentEndLine: start + length - 1, reason: `unchanged, moved from line ${loc.startLine} to ${start}` };
    }
    if (matches.length) ambiguous = true;
  }
  return { status: 'changed', reason: ambiguous ? 'cited lines are no longer at their position, and identical code elsewhere in the file cannot be told apart from them' : 'cited lines differ from the analysis snapshot' };
}

// Recompute a finding's evidenceDigest from the current files, the way
// evaluate/index.mjs computes it. `shift` maps a function span to where its
// unchanged lines are now. Returns true / false, or null when it cannot tell.
export function digestMatches(digest, readFile, shift = null) {
  if (!digest || !Array.isArray(digest.files)) return null;
  const span = Array.isArray(digest.lines) ? (shift || digest.lines) : null;
  const options = [];
  for (const f of digest.files) {
    const current = readFile(f);
    if (current.status !== 'ok') return current.status === 'missing' ? false : null;
    options.push(variants(current.text).map((text) => [f, sha256(span ? text.split(/\r?\n/).slice(span[0] - 1, span[1]).join('\n') : text)]));
  }
  // Try the with-BOM and without-BOM form of every file (almost always one form each).
  const combos = options.reduce((acc, list) => acc.flatMap((prefix) => list.map((part) => [...prefix, part])), [[]]);
  return combos.slice(0, 64).some((parts) => sha256(JSON.stringify(parts)) === digest.sha256);
}

// Returns a copy of the task with evidence status set from the current tree.
export function verifyTask(task, root, { now = new Date() } = {}) {
  const cache = new Map();
  const readFile = (rel) => { if (!cache.has(rel)) cache.set(rel, readInside(root, rel)); return cache.get(rel); };
  const locations = task.locations.map((loc) => {
    const { status: _s, reason: _r, currentStartLine: _c, currentEndLine: _e, ...base } = loc;
    const result = checkLocation(base, readFile(base.file));
    return { ...base, ...result };
  });
  const perFinding = {};
  for (const f of task.findings) {
    const own = locations.filter((l) => l.findingId === f.id);
    const located = own.filter((l) => l.status !== 'unverifiable');
    const fn = own.find((l) => l.kind === 'function' && l.currentStartLine);
    const matches = digestMatches(f.evidenceDigest, readFile, fn ? [fn.currentStartLine, fn.currentEndLine] : null);
    let status = located.length ? worst(located.map((l) => l.status)) : 'unverifiable';
    let reason = own.find((l) => l.status === status && l.reason)?.reason || null;
    // A citation that could not be read is not covered by the others being unchanged;
    // only a digest recomputed over all the finding's files can vouch for it.
    const unread = own.filter((l) => l.status === 'unverifiable' && l.kind !== 'file');
    if (status === 'valid' && unread.length && matches !== true) {
      status = 'unverifiable';
      reason = `${unread.length} cited location${unread.length === 1 ? '' : 's'} could not be checked (${unread[0].reason})`;
    } else if (status === 'valid' && matches === false) { status = 'changed'; reason = 'the cited lines are unchanged, but other code this finding was computed from changed; re-run the analysis to confirm it still applies'; }
    else if (!located.length && matches === true) { status = 'valid'; reason = 'the files this finding was computed from are unchanged'; }
    else if (!located.length && matches === false) { status = own.some((l) => readFile(l.file).status === 'missing') || f.evidenceDigest?.files?.some((x) => readFile(x).status === 'missing') ? 'missing' : 'changed'; reason = 'the files this finding was computed from changed'; }
    else if (status === 'valid' && matches === null) reason = f.evidenceDigest ? 'cited lines unchanged; the finding digest could not be recomputed' : 'cited lines unchanged; the finding has no evidence digest';
    perFinding[f.id] = { status, ...(reason ? { reason } : {}), digestMatches: matches };
  }
  const status = worst(Object.values(perFinding).map((f) => f.status));
  const counts = {};
  for (const l of locations) counts[l.status] = (counts[l.status] || 0) + 1;
  const reason = status === 'valid'
    ? 'Every cited location and evidence digest matches the current working tree.'
    : `${Object.entries(counts).filter(([s]) => s !== 'valid').map(([s, n]) => `${n} location${n === 1 ? '' : 's'} ${s}`).join(', ') || 'evidence digest changed'}; see each location.`;
  return { ...task, locations, evidence: { status, checkedAt: now.toISOString(), reason, findings: perFinding } };
}

function sha256(text) { return createHash('sha256').update(text).digest('hex'); }
