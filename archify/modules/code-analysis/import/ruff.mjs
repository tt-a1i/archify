import { invalid, lineLocation, object, sourceSeverity } from './common.mjs';

export function parseRuff(report) {
  if (!Array.isArray(report)) invalid('Ruff input must be the JSON array produced by ruff check --output-format json.');
  const run = { tool: 'Ruff', version: null, records: [], files: [], notices: [], suppressed: 0, incomplete: false };
  report.forEach((item, index) => {
    const pointer = `/${index}`;
    if (!object(item) || typeof item.message !== 'string' || !item.message) invalid('Each Ruff diagnostic needs non-empty message text.', pointer);
    if (item.filename != null && typeof item.filename !== 'string') invalid('Ruff filename must be a string or null.', pointer);
    if (item.code != null && typeof item.code !== 'string') invalid('Ruff code must be a string or null.', pointer);
    if (item.name != null && typeof item.name !== 'string') invalid('Ruff name must be a string or null.', pointer);
    if (item.location != null && !object(item.location) || item.end_location != null && !object(item.end_location)) invalid('Ruff locations must be position objects or null.', pointer);
    if (item.fix != null && !object(item.fix)) invalid('Ruff fix must be an object or null.', pointer);
    const ruleId = item.code || item.name || null;
    const severity = sourceSeverity(item.severity);
    const notebook = item.cell != null;
    if (item.filename) run.files.push(item.filename);
    if (ruleId === 'invalid-syntax') {
      run.incomplete = true;
      run.notices.push({ code: 'external/parse-error', message: `${item.filename || '(no file)'}: ${item.message}` });
    }
    if (notebook) {
      run.incomplete = true;
      run.notices.push({ code: 'external/notebook-location', message: 'Ruff notebook positions are cell coordinates; no JSON-file line evidence is inferred.' });
    }
    run.records.push({
      message: item.message, ruleId, originalSeverity: item.severity ?? null,
      severity: severity || 'warning', severityDefaulted: severity === null,
      locations: item.filename ? [notebook ? { path: item.filename, noSource: true } : lineLocation(item.filename, item.location || {}, item.end_location || {}, 'unicodeCodePoints')] : [],
      ...(typeof item.url === 'string' ? { helpUri: item.url } : {}),
      ...(notebook ? { origin: { cell: item.cell, location: item.location, end_location: item.end_location } } : {}),
      suggestions: item.fix ? [typeof item.fix.message === 'string' && item.fix.message ? item.fix.message : 'The source tool supplied a fix; inspect its applicability and verify project behavior.'] : [],
      pointer,
    });
  });
  return [run];
}
