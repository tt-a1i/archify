// Source-contained orientation, never a caller graph or runtime trace.
import ts from 'typescript';
import path from 'node:path';
import { measureFunctions } from '../extract/ts/functions.mjs';

// Saved captures retain their original contract; do not infer support from the
// current producer constant or a numeric adapter revision.
const BINDING_COVERAGE = new Map([
  ['js-ts-lexical-v1', 'declarations-const-initializers-and-relative-named-imports'],
  ['js-ts-lexical-v2', 'declarations-const-initializers-relative-named-imports-and-default-functions'],
]);

const LIMIT = 40;
const point = (source, offset) => {
  const p = source.getLineAndCharacterOfPosition(offset);
  return { line: p.line + 1, column: p.character + 1 };
};
const before = (aLine, aColumn, bLine, bColumn) => aLine < bLine || (aLine === bLine && aColumn <= bColumn);

export function questionCalls({ facts, factsPath, inspect, entry, location, symbol, text }) {
  const knownAdapter = facts?.repository?.language === 'ts' && /^typescript@/.test(facts?.repository?.adapter || '');
  const bindingCoverage = knownAdapter ? BINDING_COVERAGE.get(facts?.callModel) : undefined;
  const result = {
    coverage: 'unavailable', reason: null,
    provenance: { rawFactsPath: factsPath ? path.resolve(factsPath) : null, adapter: facts?.repository?.adapter ?? null, adapterRevision: facts?.repository?.adapterRevision ?? null,
      snapshotId: facts?.repository?.snapshotId ?? null, callModel: facts?.callModel ?? null },
    bindingCoverage: bindingCoverage ?? 'unknown',
    factRole: 'captured-evidence; use targetNavigation for current target locations',
    selection: { file: entry.file, kind: symbol ? 'function-source-range' : 'entry-file', range: null },
    total: null, included: 0, omitted: null, limit: LIMIT, records: [],
    limitations: [
      'When coverage is available, records are JS/TS CallExpressions contained in the selected source range, including nested functions and closures; they are not necessarily direct or executed calls of the selected function. Python and Java captures do not supply call coverage; empty arrays are not a known zero.',
      'same-file-function identifies a lexical declaration; same-file-function-initializer identifies a direct const initializer. Neither proves execution, TDZ safety or runtime dispatch. Named expressions use their measured inner function name. Unresolved calls require source reading; constructors and tagged templates are not collected. imported-function follows captured relative named imports to direct exports; js-ts-lexical-v2 additionally binds direct default function declarations. It does not model runtime dispatch.',
      'Each factIndex identifies the unchanged record in this snapshot raw-facts.calls array. Full start/end ranges distinguish chained calls sharing a start. Original targets are captured evidence only. Use targetNavigation.location only when status is valid; imported targets have separate freshness and parse checks. Valid navigation verifies captured target content and coordinates, not current re-resolution after other files/configuration change.',
      'At most 40 records are included in source order; total/included/omitted describe only the selected range. Read current source or the captured raw facts for omitted records.',
    ],
  };
  const unavailable = (reason) => ({ ...result, reason });
  if (entry.factsStatus !== 'valid') return unavailable(`entry-${entry.factsStatus}`);
  if (entry.parseErrors.length) return unavailable('entry-parse-errors');
  if (!bindingCoverage) return unavailable('unsupported-or-unknown-call-model');
  if (!Array.isArray(facts?.calls)) return unavailable('calls-not-captured');

  let range = null;
  if (symbol) {
    if (!location) return unavailable('function-range-unavailable');
    // Reuse the extractor's exact naming rules; historical function facts only
    // store lines, which cannot exclude adjacent functions on the same line.
    const source = ts.createSourceFile(entry.file, text, ts.ScriptTarget.Latest, true);
    if (source.parseDiagnostics.length) return unavailable('entry-parse-errors');
    const ranges = [];
    measureFunctions(source, entry.file, (fn, node) => {
      if (fn.qualname === location.symbol && fn.line === location.startLine && fn.endLine === location.endLine) {
        const start = point(source, node.getStart(source)); const end = point(source, node.getEnd());
        ranges.push({ line: start.line, column: start.column, endLine: end.line, endColumn: end.column });
      }
    });
    if (ranges.length !== 1) return unavailable('function-range-unavailable');
    [range] = ranges;
  }
  const records = facts.calls.flatMap((fact, factIndex) => {
    if (fact.file !== entry.file) return [];
    if (range && (!before(range.line, range.column, fact.line, fact.column)
      || !before(fact.endLine, fact.endColumn, range.endLine, range.endColumn))) return [];
    return [{ factIndex, fact }];
  }).sort((a, b) => a.fact.line - b.fact.line || a.fact.column - b.fact.column
    || a.fact.endLine - b.fact.endLine || a.fact.endColumn - b.fact.endColumn || a.factIndex - b.factIndex);
  const capturedFiles = new Set(facts.files.map((file) => file.path));
  const included = records.slice(0, LIMIT).map((record) => {
    const target = record.fact.target;
    if (!target) return { ...record, targetNavigation: { status: 'unresolved', location: null, reason: record.fact.reason } };
    const file = target.file || entry.file;
    if (!capturedFiles.has(file)) return { ...record, targetNavigation: { status: 'unverifiable', location: null, reason: 'target-not-captured' } };
    const evidence = file === entry.file ? entry : inspect(file);
    const status = evidence.factsStatus === 'valid' && evidence.parseErrors.length ? 'parse-error' : evidence.factsStatus;
    return { ...record, targetNavigation: {
      status, location: status === 'valid' ? { ...target, file } : null,
      ...(status === 'valid' ? {} : { reason: status === 'parse-error' ? 'captured-target-parse-errors' : `target-${status}` }), evidence,
    } };
  });
  return { ...result, coverage: 'available', selection: { ...result.selection, range },
    total: records.length, included: Math.min(records.length, LIMIT), omitted: Math.max(0, records.length - LIMIT), records: included };
}
