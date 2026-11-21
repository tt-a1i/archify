import { fail } from '../core/index.mjs';

export function invalid(message, pointer = '/', details = {}) {
  fail('external/report-invalid', message, { evidence: { pointer, ...details }, supportedFixes: ['regenerate the report in the configured structured format'] });
}

export function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export function sourceSeverity(value) {
  if (value === 2 || value === 'error' || value === 'fatal') return 'error';
  if (value === 1 || value === 'warning' || value === 'warn') return 'warning';
  if (value === 0 || ['info', 'information', 'note', 'none', 'hint'].includes(value)) return 'info';
  if (value !== null && value !== undefined) invalid('Unsupported source severity.', '/', { value });
  return null;
}

export function lineLocation(file, start = {}, end = {}, columnKind = 'utf16CodeUnits') {
  const out = { path: file, columnKind };
  for (const [key, value] of Object.entries({ line: start.line ?? start.row, column: start.column, endLine: end.line ?? end.row, endColumn: end.column })) {
    if (value !== undefined && value !== null) {
      if (!Number.isInteger(value) || value < 1) invalid(`Invalid ${key}; locations must use positive integer positions.`);
      out[key] = value;
    }
  }
  return out;
}
