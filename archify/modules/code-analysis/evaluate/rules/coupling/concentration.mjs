// coupling/concentration — measurable concentration signals derived from the
// existing module graph. The rule is opt-in until thresholds are calibrated.
import { fail } from '../../../extract/shared/diagnostics.mjs';
export const code = 'coupling/concentration';
export const dimension = 'coupling';
export const severity = 'warning';
export const confidence = 1;
export const version = 2;

export function enabled(config) {
  const options = config?.rules?.coupling?.concentration;
  return Boolean(options && ['reachRatio', 'moduleLocRatio', 'fileLoc'].some((key) => options[key] !== undefined));
}

export function run({ graph, config, facts }) {
  const options = config.rules.coupling.concentration;
  const maxReach = threshold(options.reachRatio, 'rules.coupling.concentration.reachRatio', 1);
  const maxModuleRatio = threshold(options.moduleLocRatio, 'rules.coupling.concentration.moduleLocRatio', 1);
  const maxFileLoc = threshold(options.fileLoc, 'rules.coupling.concentration.fileLoc', Number.MAX_SAFE_INTEGER);
  const modules = graph.modules || [];
  // Graph edges point importer -> imported. Concentration asks how much of the
  // repository depends on this module, so traverse the reverse graph.
  const dependents = new Map(modules.map((m) => [m.id, []]));
  for (const edge of graph.edges || []) dependents.get(edge.to)?.push(edge.from);
  const totalLoc = modules.reduce((sum, m) => sum + (Number.isFinite(m.loc) ? m.loc : 0), 0);
  const totalExternal = Math.max(modules.length - 1, 0);
  const findings = [];
  for (const module of modules) {
    const reachable = reachableFrom(module.id, dependents);
    const reachRatio = totalExternal ? reachable.size / totalExternal : 0;
    const moduleLocRatio = totalLoc ? module.loc / totalLoc : 0;
    const largestFile = largestFileFor(module, graph, facts);
    const reasons = [];
    if (maxReach !== null && reachRatio >= maxReach) reasons.push(`${reachable.size} of ${totalExternal} other modules depend on it (${formatRatio(reachRatio)})`);
    if (maxModuleRatio !== null && moduleLocRatio >= maxModuleRatio) reasons.push(`contains ${module.loc} of ${totalLoc} analyzed LOC (${formatRatio(moduleLocRatio)})`);
    if (maxFileLoc !== null && Number.isFinite(largestFile.loc) && largestFile.loc >= maxFileLoc) reasons.push(`contains ${largestFile.path} with ${largestFile.loc} LOC`);
    if (!reasons.length) continue;
    findings.push({
      code, dimension, severity, confidence,
      message: `${module.label} is concentrated: ${reasons.join('; ')}. This is a maintenance signal; business responsibilities were not inferred.`,
      subject: { module: module.id },
      evidence: {
        dependentModules: [...reachable].sort(), dependentCount: reachable.size, totalExternalModules: totalExternal,
        dependentRatio: reachRatio, moduleLoc: module.loc, totalAnalyzedLoc: totalLoc, moduleLocRatio,
        largestFile, threshold: { reachRatio: maxReach, moduleLocRatio: maxModuleRatio, fileLoc: maxFileLoc },
      },
      supportedFixes: ['inspect the cited dependents and responsibilities before deciding whether to split the module'],
    });
  }
  return findings.sort((a, b) => a.subject.module < b.subject.module ? -1 : 1);
}

function threshold(value, name, max) {
  if (value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max) return value;
  fail('config/concentration-threshold-invalid', `${name} must be a number between 0 and ${max}, got ${JSON.stringify(value)}.`, {
    subject: { option: name }, evidence: { value }, supportedFixes: [`set ${name} to a number between 0 and ${max}, or remove it`],
  });
}
function formatRatio(value) { return `${(value * 100).toFixed(1)}%`; }
function reachableFrom(start, outgoing) {
  const seen = new Set(), queue = [...(outgoing.get(start) || [])];
  while (queue.length) { const current = queue.shift(); if (current === start || seen.has(current)) continue; seen.add(current); queue.push(...(outgoing.get(current) || [])); }
  return seen;
}
function largestFileFor(module, graph, facts) {
  const excluded = new Set(graph.excluded?.roles || []);
  const ownership = graph.fileModules || {};
  return (facts?.files || []).filter((file) => !excluded.has(file.role) && ownership[file.path] === module.id)
    .map((file) => ({ path: file.path, loc: file.loc }))
    .sort((a, b) => b.loc - a.loc || (a.path < b.path ? -1 : 1))[0] || { path: null, loc: null };
}
