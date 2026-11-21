import { fail } from '../../../core/index.mjs';
// coupling/concentration — too much of the project sits in, or hangs off, one
// place (product plan section 0.3). coupling/hub only covers a module that is
// both widely used and widely dependent; this rule reports three facts hub
// cannot see:
//
//   reach  a module that most other modules depend on, directly or through
//          other modules. A change to it can require re-checking all of them.
//   size   a module that holds a large share of the analyzed source lines.
//   file   a single source file longer than `fileLines`.
//
// These are static facts with their raw numbers, not a verdict that something
// must be split: a small, stable kernel is expected to have high reach, and one
// cohesive responsibility can be large. The finding exists so the choice is
// made on purpose (and can be accepted with a reason in the baseline).
// "Reach" counts static dependencies of every kind, including deferred and
// type-only ones; it is not runtime impact.
//
// Severity: warning, except high reach on its own in a module that depends on
// no other module, which is info. That is the shape of a shared kernel, and
// moving shared code into such a leaf is what the cycle rules recommend, so
// reporting it as a burden would contradict them. A high-reach module that has
// dependencies of its own passes their changes on to most of the project.
//
// reach and size compare a module with the rest of the project, so they need
// at least `minModules` modules to mean anything. Every threshold comes from
// `rules.coupling.concentration` and is echoed in the evidence.
export const code = 'coupling/concentration';
export const dimension = 'coupling';
export const severity = 'warning';
export const confidence = 1.0;

const DEFAULTS = { reachShare: 0.5, sizeShare: 0.4, fileLines: 1500, minModules: 6 };
const SAMPLE = 12;

function invalid(where, value, expected) {
  fail('config/threshold-invalid', `The concentration threshold "${where}" must be ${expected}, got ${JSON.stringify(value)}.`, {
    subject: { option: where }, evidence: { value }, supportedFixes: ['fix the value, or remove it to use the default'],
  });
}

// A misconfigured threshold would compare as NaN and silently match nothing,
// so a broken config must stop the run instead of reporting a clean result.
export function thresholds(config) {
  const custom = config?.rules?.coupling?.concentration || {};
  const share = (name) => {
    const value = custom[name];
    if (value === undefined) return DEFAULTS[name];
    if (typeof value !== 'number' || !(value > 0 && value <= 1)) invalid(`rules.coupling.concentration.${name}`, value, 'a number above 0 and at most 1');
    return value;
  };
  const whole = (name, min) => {
    const value = custom[name];
    if (value === undefined) return DEFAULTS[name];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min) invalid(`rules.coupling.concentration.${name}`, value, `a whole number of ${min} or more`);
    return value;
  };
  return { reachShare: share('reachShare'), sizeShare: share('sizeShare'), fileLines: whole('fileLines', 1), minModules: whole('minModules', 2) };
}

const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const round2 = (value) => Math.round(value * 100) / 100;
const percent = (value) => `${Math.round(value * 100)}%`;

// Every module that reaches `target` by following dependency edges.
function transitiveDependents(target, dependentsOf) {
  const seen = new Set([target]);
  const queue = [target];
  while (queue.length) {
    for (const from of dependentsOf.get(queue.shift()) || []) {
      if (!seen.has(from)) { seen.add(from); queue.push(from); }
    }
  }
  seen.delete(target);
  return [...seen].sort(compareText);
}

export function run({ graph, config, facts }) {
  const limits = thresholds(config);
  return [...moduleFindings(graph, limits), ...fileFindings(graph, facts, limits)];
}

function moduleFindings(graph, limits) {
  const modules = graph.modules;
  if (modules.length < limits.minModules) return [];
  const others = modules.length - 1;
  const totalLoc = modules.reduce((sum, m) => sum + m.loc, 0);
  const dependentsOf = new Map();
  for (const edge of graph.edges) {
    if (!dependentsOf.has(edge.to)) dependentsOf.set(edge.to, []);
    dependentsOf.get(edge.to).push(edge.from);
  }
  const findings = [];
  for (const m of [...modules].sort((a, b) => compareText(a.id, b.id))) {
    const dependents = transitiveDependents(m.id, dependentsOf);
    const reachShare = dependents.length / others;
    const sizeShare = totalLoc > 0 ? m.loc / totalLoc : 0;
    const reasons = [...(reachShare >= limits.reachShare ? ['reach'] : []), ...(sizeShare >= limits.sizeShare ? ['size'] : [])];
    if (!reasons.length) continue;
    const kernel = reasons.length === 1 && reasons[0] === 'reach' && m.fanOut === 0;
    const statements = {
      reach: `${dependents.length} of the other ${others} modules depend on it directly or through other modules (${percent(reachShare)})`,
      size: `it holds ${percent(sizeShare)} of the analyzed source lines (${m.loc} of ${totalLoc}, in ${m.files} file${m.files === 1 ? '' : 's'})`,
    };
    findings.push({
      code, dimension, severity: kernel ? 'info' : severity, confidence,
      message: `${m.label}: ${reasons.map((r) => statements[r]).join('; ')}. ${kernel
        ? 'It depends on no other module, the usual shape of a shared kernel: keep it small and stable.'
        : 'This is a static fact about where the project is concentrated, not proof that the module should be split.'}`,
      subject: { module: m.id },
      evidence: {
        reasons,
        ...(reasons.includes('reach') ? { reach: { dependents: dependents.length, direct: m.fanIn, dependencies: m.fanOut, modules: others, share: round2(reachShare), sample: dependents.slice(0, SAMPLE) } } : {}),
        ...(reasons.includes('size') ? { size: { loc: m.loc, totalLoc, files: m.files, share: round2(sizeShare) } } : {}),
        threshold: { reachShare: limits.reachShare, sizeShare: limits.sizeShare, minModules: limits.minModules },
      },
      supportedFixes: [
        ...(reasons.includes('reach') ? [
          'keep what dependents use small and stable: every change to it has to be checked against all of them',
          'check whether most dependents need everything in it; a part only one or two modules use can live next to them',
        ] : []),
        ...(reasons.includes('size') ? [
          'list the reasons this module changes; parts that change for different reasons are candidates to separate',
        ] : []),
        'if this concentration is intended (a shared kernel, one cohesive responsibility), accept the finding with that reason',
      ],
    });
  }
  return findings;
}

function fileFindings(graph, facts, limits) {
  if (!facts) return [];
  const excluded = new Set(graph.excluded.roles || []);
  return facts.files
    .filter((f) => !excluded.has(f.role) && f.loc >= limits.fileLines)
    .sort((a, b) => b.loc - a.loc || compareText(a.path, b.path))
    .map((f) => ({
      code, dimension, severity, confidence,
      message: `${f.path} is ${f.loc} lines long (threshold ${limits.fileLines}). A file this size is hard to review and to find things in; whether to split it depends on what it is responsible for.`,
      subject: { file: f.path },
      evidence: { reasons: ['file'], loc: f.loc, ...(graph.fileModules?.[f.path] ? { module: graph.fileModules[f.path] } : {}), threshold: { fileLines: limits.fileLines } },
      supportedFixes: [
        'look for groups of functions that are used together and by the same callers; each group can become its own file',
        'if the file is one cohesive unit (a generated-like table, one long algorithm), accept the finding with that reason',
      ],
    }));
}
