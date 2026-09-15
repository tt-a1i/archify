// Rule engine: every rule is a module exporting { code, dimension, severity,
// confidence, run({ graph, config }) -> Finding[] }. Rules are independent —
// none reads another's output — and every threshold they use is echoed in
// the finding's evidence so a reader can re-check the call.
import * as cycle from './rules/coupling/cycle.mjs';
import * as hub from './rules/coupling/hub.mjs';
import * as importCycle from './rules/coupling/import-cycle.mjs';

export const RULES = [importCycle, cycle, hub];

export function evaluate(graph, config = {}, facts = null) {
  const suppressed = new Set(config.ignore || []);
  const diagnostics = [];
  let suppressedCount = 0;
  for (const rule of RULES) {
    if (suppressed.has(rule.code)) { suppressedCount += 1; continue; }
    for (const finding of rule.run({ graph, config, facts })) diagnostics.push({ id: '', ...finding });
  }
  // Stable ids: dimension prefix + running number in a deterministic order.
  diagnostics.sort((a, b) => compareText(a.code, b.code) || compareText(JSON.stringify(a.subject), JSON.stringify(b.subject)));
  diagnostics.forEach((d, i) => { d.id = `${d.dimension.toUpperCase().slice(0, 4)}-${String(i + 1).padStart(4, '0')}`; });
  const summary = { errors: 0, warnings: 0, info: 0 };
  const key = { error: 'errors', warning: 'warnings', info: 'info' };
  for (const d of diagnostics) summary[key[d.severity]] += 1;
  return {
    schema_version: 1,
    repository: graph.repository,
    rules: RULES.map((r) => r.code),
    summary: { ...summary, suppressed: suppressedCount },
    diagnostics,
  };
}

function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
