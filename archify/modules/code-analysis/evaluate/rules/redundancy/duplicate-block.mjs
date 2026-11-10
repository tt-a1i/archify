import { createHash } from 'node:crypto';
import { fail } from '../../../core/index.mjs';
// redundancy/duplicate-block — the same lines of code in more than one place
// (product plan section 0.3). The code runs, and a reader or an AI can follow
// it, but a change made to one copy has to be found and repeated in the others.
//
// What counts as the same: runs of at least `minLines` code lines that are
// equal after trimming and collapsing whitespace. Blank lines, comment lines,
// lines without a letter or digit (lone braces) and import lines are skipped
// before comparing, so formatting, a different comment or a different import
// block does not hide or create a match. Nothing is renamed or abstracted:
// two blocks that differ in one identifier are not reported. That keeps every
// finding checkable by reading the two ranges it cites, at the cost of missing
// near-duplicates.
//
// Comment and import lines are recognized per line from the language's usual
// prefixes, not by parsing. A code line that merely looks like one is skipped,
// which can shorten a match; it cannot produce one.
//
// Two further thresholds keep trivial repetition out: the block must contain
// at least `minChars` non-space characters, and at least half of its lines must
// be different from each other (a table of near-identical rows is not logic
// someone has to keep in sync). Test and generated files follow the module
// graph's exclusion policy. The rule needs captured source text, so it does not
// run without raw facts.
export const code = 'redundancy/duplicate-block';
export const dimension = 'redundancy';
export const severity = 'warning';
export const confidence = 1.0;

const DEFAULTS = { minLines: 10, minChars: 300 };
const MAX_OCCURRENCES = 12;

export function enabled(config, facts) {
  return Boolean(facts && Array.isArray(facts.files) && facts.files.some((f) => typeof f.sourceText === 'string'));
}

// A misconfigured threshold would compare as NaN and silently match nothing.
export function thresholds(config) {
  const custom = config?.rules?.redundancy?.duplicateBlock || {};
  const whole = (name, min) => {
    const value = custom[name];
    if (value === undefined) return DEFAULTS[name];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) {
      fail('config/threshold-invalid', `The duplicate-block threshold "rules.redundancy.duplicateBlock.${name}" must be a whole number of ${min} or more, got ${JSON.stringify(value)}.`, {
        subject: { option: `rules.redundancy.duplicateBlock.${name}` }, evidence: { value }, supportedFixes: ['fix the value, or remove it to use the default'],
      });
    }
    return value;
  };
  // Fewer than 3 lines would match any pair of ordinary statements.
  return { minLines: whole('minLines', 3), minChars: whole('minChars', 0) };
}

const HASH_COMMENTS = new Set(['py']);
const IMPORT_LINE = {
  ts: /^(import\b|export\s+(\*|\{[^}]*\})\s+from\b|(const|let|var)\s+[\w${}\s,:]+=\s*require\()/,
  py: /^(import\s|from\s+\S+\s+import\b)/,
  java: /^(import|package)\s/,
  go: /^(import\b|package\s|"[^"]*"$|\w+\s+"[^"]*"$)/,
  rust: /^((pub(\([^)]*\))?\s+)?use\s|(pub(\([^)]*\))?\s+)?mod\s+\w+;|extern\s+crate\s)/,
};

// The lines of a file that take part in the comparison, with their 1-based
// line numbers: [{ line, text }], text trimmed with single spaces.
export function codeLines(sourceText, language) {
  const out = [];
  const importLine = IMPORT_LINE[language] || null;
  const state = { closer: null }; // set while inside /* … */ or a Python triple-quoted block
  let importDepth = 0; // above 0 inside a multi-line import list: import { a, b } from …
  const raw = sourceText.split(/\r\n|\n|\r/);
  for (let n = 0; n < raw.length; n += 1) {
    const text = raw[n].trim().replace(/\s+/g, ' ');
    if (!text || isCommentLine(text, state, HASH_COMMENTS.has(language))) continue;
    if (importDepth > 0) importDepth += bracketBalance(text);
    else if (importLine && importLine.test(text)) importDepth = Math.max(0, bracketBalance(text));
    else if (/[A-Za-z0-9]/.test(text)) out.push({ line: n + 1, text });
  }
  return out;
}

// Whether a trimmed line is commentary rather than code, tracking multi-line
// comments and strings in `state`.
function isCommentLine(text, state, hashComments) {
  if (state.closer) {
    if (text.includes(state.closer)) state.closer = null;
    return true;
  }
  if (!hashComments) {
    if (text.startsWith('/*') && !text.slice(2).includes('*/')) state.closer = '*/';
    return text.startsWith('//') || text.startsWith('/*');
  }
  if (text.startsWith('#')) return true;
  // A docstring or multi-line string is text, not logic: its lines are
  // skipped. A line that only opens one after code (x = """…) is kept.
  const triple = /^[rRbBuUfF]{0,2}("""|''')/.exec(text);
  const quote = triple ? triple[1] : text.includes('"""') ? '"""' : text.includes("'''") ? "'''" : null;
  if (quote && (text.split(quote).length - 1) % 2 === 1) state.closer = quote;
  return Boolean(triple);
}

// Opening minus closing brackets on a line: above 0, an import list continues below.
function bracketBalance(text) {
  let balance = 0;
  for (const ch of text) {
    if (ch === '{' || ch === '(') balance += 1;
    else if (ch === '}' || ch === ')') balance -= 1;
  }
  return balance;
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function run({ graph, config, facts }) {
  if (!enabled(config, facts)) return [];
  const limits = thresholds(config);
  const language = facts.repository?.language;
  const excluded = new Set(graph.excluded.roles || []);
  const files = facts.files
    .filter((f) => !excluded.has(f.role) && typeof f.sourceText === 'string')
    .sort((a, b) => compareText(a.path, b.path))
    .map((f) => ({ path: f.path, lines: codeLines(f.sourceText, language) }));
  return duplicateBlocks(files, limits).map((block) => finding(block, limits));
}

// Clone classes: [{ lines, chars, text, occurrences: [{ file, line, endLine }] }]
// Every occurrence of a class has the same `lines` code lines; a class is
// extended as far as all of its occurrences agree, in both directions.
export function duplicateBlocks(files, { minLines, minChars }) {
  const { sequences, texts, lengths } = internLines(files);
  const windows = indexWindows(sequences, minLines);
  // covered[file][i]: the window starting at code line i is already inside a reported class.
  const covered = sequences.map((seq) => new Uint8Array(seq.length));
  const blocks = [];
  for (let f = 0; f < sequences.length; f += 1) {
    for (let i = 0; i + minLines <= sequences[f].length; i += 1) {
      if (covered[f][i]) continue;
      const set = occurrencesOf([f, i], windows, sequences, minLines);
      if (!set) continue;
      const length = grow(set, sequences, minLines);
      for (const [file, start] of set) covered[file].fill(1, start, start + length - minLines + 1);
      const [firstFile, firstStart] = set[0];
      const lineIds = Array.from(sequences[firstFile].subarray(firstStart, firstStart + length));
      const chars = lineIds.reduce((sum, id) => sum + lengths[id], 0);
      // Too little text, or mostly one repeated line: not logic someone keeps in sync.
      if (chars < minChars || new Set(lineIds).size * 2 < length) continue;
      blocks.push({
        lines: length,
        chars,
        text: lineIds.map((id) => texts[id]).join('\n'),
        occurrences: set.map(([file, start]) => ({ file: files[file].path, line: files[file].lines[start].line, endLine: files[file].lines[start + length - 1].line })),
      });
    }
  }
  return blocks;
}

// Each distinct line text becomes a number, so windows compare cheaply.
function internLines(files) {
  const ids = new Map();
  const lengths = [];
  const sequences = files.map((f) => Int32Array.from(f.lines, (l) => {
    if (!ids.has(l.text)) { ids.set(l.text, ids.size); lengths.push(l.text.replace(/ /g, '').length); }
    return ids.get(l.text);
  }));
  return { sequences, texts: [...ids.keys()], lengths };
}

// window key -> [[file, start], …] for every run of `minLines` code lines, in file order.
function indexWindows(sequences, minLines) {
  const windows = new Map();
  sequences.forEach((seq, f) => {
    for (let i = 0; i + minLines <= seq.length; i += 1) {
      const key = windowKey(seq, i, minLines);
      if (!windows.has(key)) windows.set(key, []);
      windows.get(key).push([f, i]);
    }
  });
  return windows;
}

// Every place the seed's window occurs, the seed included, in file order and
// never overlapping within a file. Null when the seed has no second copy.
function occurrencesOf(seed, windows, sequences, minLines) {
  const [f, i] = seed;
  const same = (other) => {
    for (let k = 0; k < minLines; k += 1) if (sequences[f][i + k] !== sequences[other[0]][other[1] + k]) return false;
    return true;
  };
  const set = [];
  for (const other of windows.get(windowKey(sequences[f], i, minLines))) {
    if (!same(other)) continue; // a key collision, not a match
    const last = set[set.length - 1];
    if (last && last[0] === other[0] && other[1] - last[1] < minLines) continue;
    set.push([other[0], other[1]]);
  }
  return set.length >= 2 && set.some((o) => o[0] === f && o[1] === i) ? set : null;
}

// Extends a class forward, then backward, while every occurrence has the same
// next line and two occurrences in one file stay apart. Moves the starts in
// `set` and returns the final length.
function grow(set, sequences, minLines) {
  let length = minLines;
  const agree = (offset) => {
    let value = null;
    for (const [file, start] of set) {
      const at = start + offset;
      if (at < 0 || at >= sequences[file].length) return false;
      if (value === null) value = sequences[file][at];
      else if (sequences[file][at] !== value) return false;
    }
    return true;
  };
  const room = () => set.every((o, k) => k === 0 || set[k - 1][0] !== o[0] || o[1] - set[k - 1][1] > length);
  while (room() && agree(length)) length += 1;
  while (room() && agree(-1)) { for (const o of set) o[1] -= 1; length += 1; }
  return length;
}

// A short key for `length` line ids starting at `start`. Collisions are
// possible and harmless: every candidate is compared line by line before use.
function windowKey(seq, start, length) {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let k = 0; k < length; k += 1) {
    const id = seq[start + k];
    a = Math.imul(a ^ id, 0x01000193) >>> 0;
    b = (Math.imul(b, 31) + id + 0x9e3779b9) >>> 0;
  }
  return (a & 0x1fffff) * 4294967296 + b; // 53 bits: exact as a JS number
}

function finding(block, limits) {
  const { occurrences } = block;
  const files = [...new Set(occurrences.map((o) => o.file))].sort(compareText);
  const where = (o) => `${o.file}:${o.line}-${o.endLine}`;
  const shown = occurrences.slice(0, 3).map(where).join(', ');
  const places = occurrences.length;
  return {
    code, dimension, severity, confidence,
    message: `${block.lines} lines of code are repeated in ${places} places${files.length === 1 ? ' in one file' : ''}: ${shown}${places > 3 ? `, and ${places - 3} more` : ''}. A change to one copy has to be repeated in the others; the lines are equal apart from whitespace and comments.`,
    // `block` identifies the duplicated text itself, so the finding keeps its id
    // when a copy moves, is renamed, or another copy appears.
    subject: { files, block: createHash('sha256').update(block.text).digest('hex').slice(0, 16) },
    evidence: {
      lines: block.lines,
      occurrences: occurrences.slice(0, MAX_OCCURRENCES),
      totalOccurrences: places,
      duplicatedLines: block.lines * (places - 1),
      threshold: { minLines: limits.minLines, minChars: limits.minChars },
    },
    supportedFixes: [
      'if the copies must stay the same, move the lines into one function or module and call it from each place',
      'if the copies are expected to diverge (different business rules that happen to look alike today), keep them and accept the finding with that reason',
    ],
  };
}
