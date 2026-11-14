// Reverse the captured edges. No name-only matching, source search, rebinding,
// or runtime-dispatch inference is added by this reader.
import { questionCallNavigator } from './question-calls.mjs';

const LIMIT = 40;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sourceStatus = evidence => evidence.factsStatus === 'valid' && evidence.parseErrors.length ? 'parse-error' : evidence.factsStatus;
const order = (a, b) => compare(a.fact.file || a.fact.from, b.fact.file || b.fact.from)
  || a.fact.line - b.fact.line || (a.fact.column || 0) - (b.fact.column || 0)
  || (a.fact.endLine || 0) - (b.fact.endLine || 0) || (a.fact.endColumn || 0) - (b.fact.endColumn || 0) || a.factIndex - b.factIndex;
const bounded = (base, records, read) => ({ ...base, coverage: 'available', reason: null, total: records.length,
  included: Math.min(records.length, LIMIT), omitted: Math.max(0, records.length - LIMIT), records: records.slice(0, LIMIT).map(read) });

// Build once when several changed definitions ask about the same saved facts.
// Identity and navigation rules remain those of questionIncoming below.
export function indexIncoming(facts) {
  const imports = new Map(), files = new Map(), definitions = new Map();
  const add = (map, key, record) => { const list=map.get(key)||[];list.push(record);map.set(key,list); };
  (Array.isArray(facts.imports)?facts.imports:[]).forEach((fact,factIndex) => { if(fact.resolved) add(imports,fact.to,{fact,factIndex}); });
  (Array.isArray(facts.calls)?facts.calls:[]).forEach((fact,factIndex) => {
    if(!fact.target) return;
    const to=fact.target,file=to.file||fact.file,record={fact,factIndex};
    add(files,file,record);add(definitions,JSON.stringify([file,to.name,to.line,to.column]),record);
  });
  return { facts, imports, files, definitions };
}

export function questionIncoming({ facts, inspect, entry, symbol, selectedFunction, calls, index = null }) {
  const base = { coverage: 'unavailable', reason: null, limit: LIMIT, total: null, included: 0, omitted: null, records: [],
    limitations: [
      'Reverse lookup covers only resolved imports and bound calls in this captured selection. Unknown, dynamic, external, excluded or uncollected paths are not a known zero or a complete impact graph.',
      'Counts include captured records whose source is now stale; use navigation only when its status is valid. Only displayed origins, their targets and binding support are freshness-checked, not the entire repository.',
      'Calls target source declarations under the recorded call model. Interface/trait declarations do not determine a concrete runtime implementation. A callsite is not proof of execution, reachability or runtime dispatch; directCaller is present only when captured by the adapter.',
      'Records are sorted by source path and exact call range; at most 40 of each list are shown. total/included/omitted refer to captured records, not distinct source files.',
    ] };
  const unavailable = reason => ({ ...base, reason });
  if (facts && index?.facts !== facts) index = indexIncoming(facts);
  const entryReason = !facts ? 'facts-not-captured' : sourceStatus(entry) !== 'valid' ? `entry-${sourceStatus(entry)}` : null;
  const importers = entryReason ? unavailable(entryReason) : bounded(base,
    [...(index.imports.get(entry.file) || [])].sort(order),
    record => {
      const origin = inspect(record.fact.from), status = sourceStatus(origin);
      return { ...record, origin, navigation: { status, location: status === 'valid' ? { file: record.fact.from, line: record.fact.line } : null } };
    });
  let reason = entryReason || (calls.coverage !== 'available' ? calls.reason : null);
  if (!reason && symbol && (!selectedFunction || !calls.selection.range)) reason = 'function-range-unavailable';
  if (reason) return { importers, callers: unavailable(reason) };
  const target = symbol ? { name: selectedFunction.name, line: calls.selection.range.line, column: calls.selection.range.column } : null;
  const matches = [...(target ? index.definitions.get(JSON.stringify([entry.file,target.name,target.line,target.column])) || [] : index.files.get(entry.file) || [])].sort(order);
  const callers = bounded({ ...base, provenance: calls.provenance, bindingCoverage: calls.bindingCoverage,
    selection: { file: entry.file, kind: symbol ? 'exact-function-declaration' : 'entry-file-bound-targets', target } }, matches, record => {
    const origin = inspect(record.fact.file);
    const navigate = questionCallNavigator({ facts, inspect, entry: origin, capturedRangeModel: facts.repository.language !== 'ts' });
    const checked = navigate(record);
    const status = sourceStatus(origin) !== 'valid' ? sourceStatus(origin) : checked.targetNavigation.status;
    const { file, line, column, endLine, endColumn } = record.fact;
    return { ...checked, origin, navigation: { status, location: status === 'valid' ? { file, line, column, endLine, endColumn } : null } };
  });
  return { importers, callers };
}
