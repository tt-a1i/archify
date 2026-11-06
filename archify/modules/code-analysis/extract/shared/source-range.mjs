// Exact captured Python AST spans: UTF-16 columns, CR/LF source lines.
import { createHash } from 'node:crypto';

let cachedText, cachedLines, cachedOffsets;
function sourceLines(text) {
  if (text !== cachedText) {
    cachedText = text;
    cachedLines = text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g);
    cachedOffsets = [0];
    for (const line of cachedLines) cachedOffsets.push(cachedOffsets.at(-1) + line.length);
  }
  return { lines: cachedLines, offsets: cachedOffsets };
}

export function rangeText(text, range) {
  if (typeof text !== 'string' || !range) return null;
  const { line, column, endLine, endColumn } = range;
  if (![line, column, endLine, endColumn].every(v => Number.isInteger(v) && v > 0)
    || endLine < line || (endLine === line && endColumn <= column)) return null;
  const { lines, offsets } = sourceLines(text);
  if (!lines || line > lines.length || endLine > lines.length) return null;
  const content = value => value.replace(/(?:\r\n|\r|\n)$/, '');
  if (column > content(lines[line - 1]).length + 1 || endColumn > content(lines[endLine - 1]).length + 1) return null;
  return text.slice(offsets[line - 1] + column - 1, offsets[endLine - 1] + endColumn - 1);
}

export function validSourceRange(text, fn) {
  const range = fn?.sourceRange;
  if (!range || range.line !== fn.line || range.endLine !== fn.endLine) return false;
  const slice = rangeText(text, range);
  return slice !== null && createHash('sha256').update(slice).digest('hex') === range.sha256;
}
