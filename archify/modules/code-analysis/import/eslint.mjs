import { invalid, lineLocation, object, sourceSeverity } from './common.mjs';

export function parseEslint(report) {
  const results = Array.isArray(report) ? report : report?.results;
  if (!Array.isArray(results)) invalid('ESLint input must be a JSON results array or a json-with-metadata object.');
  const rules = report?.metadata?.rulesMeta || {};
  const run = { tool: 'ESLint', version: null, records: [], files: [], sourceTexts: [], notices: [], suppressed: 0, incomplete: false };
  results.forEach((result, fileIndex) => {
    const pointer = Array.isArray(report) ? `/${fileIndex}` : `/results/${fileIndex}`;
    if (!object(result) || typeof result.filePath !== 'string' || !Array.isArray(result.messages)) invalid('Each ESLint result needs filePath and messages.', pointer);
    run.files.push(result.filePath);
    if (typeof result.source === 'string') run.sourceTexts.push({ path: result.filePath, text: result.source });
    if (result.suppressedMessages !== undefined && !Array.isArray(result.suppressedMessages)) invalid('ESLint suppressedMessages must be an array.', `${pointer}/suppressedMessages`);
    run.suppressed += result.suppressedMessages?.length || 0;
    result.messages.forEach((message, messageIndex) => {
      const at = `${pointer}/messages/${messageIndex}`;
      if (!object(message) || typeof message.message !== 'string' || !message.message) invalid('Each ESLint message needs non-empty message text.', at);
      if (message.ruleId != null && typeof message.ruleId !== 'string') invalid('ESLint ruleId must be a string or null.', at);
      if (message.suggestions !== undefined && (!Array.isArray(message.suggestions) || message.suggestions.some(s => !object(s)))) invalid('ESLint suggestions must be an array of suggestion objects.', at);
      const originalSeverity = message.severity ?? null;
      const severity = message.fatal ? 'error' : sourceSeverity(originalSeverity);
      if (message.fatal || message.ruleId == null) {
        run.incomplete = true;
        run.notices.push({ code: 'external/tool-diagnostic', message: `${result.filePath}: ${message.message}` });
      }
      const metadata = rules[message.ruleId];
      const suggestions = (message.suggestions || []).map(s => s.desc || s.messageId).filter(s => typeof s === 'string');
      if (message.fix) suggestions.push('The source tool supplied a fix; regenerate the original report to inspect and apply it with project checks.');
      run.records.push({
        message: message.message, ruleId: message.ruleId ?? null, originalSeverity,
        severity: severity || 'warning', severityDefaulted: severity === null,
        locations: [lineLocation(result.filePath, message, { line: message.endLine, column: message.endColumn })],
        ...(typeof metadata?.docs?.url === 'string' ? { helpUri: metadata.docs.url } : {}),
        ...(typeof message.messageId === 'string' ? { origin: { messageId: message.messageId } } : {}),
        suggestions, pointer: at,
      });
    });
  });
  return [run];
}
