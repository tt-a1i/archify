// Exact captured spans: UTF-16 columns and the producer's source line policy.
import { createHash } from 'node:crypto';

const LF_LINES = { lines: /[^\n]*(?:\n|$)/g, ending: /\n$/ };
const CRLF_LINES = { lines: /[^\r\n]*(?:\r\n|\r|\n|$)/g, ending: /(?:\r\n|\r|\n)$/ };
const TS_LINES = { lines: /[^\r\n\u2028\u2029]*(?:\r\n|[\r\n\u2028\u2029]|$)/g, ending: /(?:\r\n|[\r\n\u2028\u2029])$/ };
let cachedText, cachedLines, cachedOffsets, cachedPolicy;
function sourceLines(text, policy) {
  if (text !== cachedText || policy !== cachedPolicy) {
    cachedText = text;
    cachedPolicy = policy;
    cachedLines = text.match(policy.lines);
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
  const policy = language === 'ts' ? TS_LINES : language === 'go' || language === 'rust' ? LF_LINES : CRLF_LINES;
  const { lines, offsets } = sourceLines(text, policy);
  if (!lines || line > lines.length || endLine > lines.length) return null;
  const content = value => value.replace(policy.ending, '');
  if (column > content(lines[line - 1]).length + 1 || endColumn > content(lines[endLine - 1]).length + 1) return null;
  return text.slice(offsets[line - 1] + column - 1, offsets[endLine - 1] + endColumn - 1);
}

export function validSourceRange(text, fn, language) {
  const range = fn?.sourceRange;
  if (!range || range.line !== fn.line || range.endLine !== fn.endLine) return false;
  const slice = rangeText(text, range, language);
  return slice !== null && createHash('sha256').update(slice).digest('hex') === range.sha256;
}
