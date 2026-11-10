// Exact captured spans: UTF-16 columns and the producer's source line policy.
import { createHash } from 'node:crypto';

let cachedText, cachedLines, cachedOffsets, cachedLfOnly;
function sourceLines(text, lfOnly) {
  if (text !== cachedText || lfOnly !== cachedLfOnly) {
    cachedText = text;
    cachedLfOnly = lfOnly;
    cachedLines = text.match(lfOnly ? /[^\n]*(?:\n|$)/g : /[^\r\n]*(?:\r\n|\r|\n|$)/g);
    cachedOffsets = [0];
    for (const line of cachedLines) cachedOffsets.push(cachedOffsets.at(-1) + line.length);
  }
  return { lines: cachedLines, offsets: cachedOffsets };
}

export function rangeText(text, range, language) {
  if (typeof text !== 'string' || !range) return null;
  const { line, column, endLine, endColumn } = range;
  if (![line, column, endLine, endColumn].every(v => Number.isInteger(v) && v > 0)
    || endLine < line || (endLine === line && endColumn <= column)) return null;
  const lfOnly = language === 'go' || language === 'rust';
  const { lines, offsets } = sourceLines(text, lfOnly);
  if (!lines || line > lines.length || endLine > lines.length) return null;
  const content = value => value.replace(lfOnly ? /\n$/ : /(?:\r\n|\r|\n)$/, '');
  if (column > content(lines[line - 1]).length + 1 || endColumn > content(lines[endLine - 1]).length + 1) return null;
  return text.slice(offsets[line - 1] + column - 1, offsets[endLine - 1] + endColumn - 1);
}

export function validSourceRange(text, fn, language) {
  const range = fn?.sourceRange;
  if (!range || range.line !== fn.line || range.endLine !== fn.endLine) return false;
  const slice = rangeText(text, range, language);
  return slice !== null && createHash('sha256').update(slice).digest('hex') === range.sha256;
}
