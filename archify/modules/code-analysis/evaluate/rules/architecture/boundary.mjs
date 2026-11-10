// Architecture boundaries: the reader declares layers as path globs and says
// which layers may not depend on which. Every resolved file-level import from
// one layer to another is checked against those rules; the module graph is not
// used, because its edges keep only a few evidence imports each.
//
// The rule is opt-in. Without `boundaries` in the config it does not run, and
// the overview reports boundaries as not checked rather than as clean. The
// constraint comes from the config, never from the architecture diagram: a
// missing connection on the diagram is not treated as a prohibition.
//
//   "boundaries": {
//     "layers": { "domain": ["src/domain/**"], "ui": ["src/ui/**"] },
//     "rules": [{ "from": "domain", "disallow": ["ui"], "reason": "domain stays UI-free" }]
//   }
//
// A rule lists either `disallow` (these layers are forbidden) or `allow` (only
// these other layers are permitted). A file matching several layers belongs to
// the first one declared. Imports touching files in no layer are not checked.
// Test and generated files follow the module graph's exclusion policy.
// Type-only imports are still dependencies on the other layer's code, so they
// count; the evidence marks them so a reader can weigh them.
import { fail, matcher } from '../../../core/index.mjs';

export const code = 'architecture/boundary';
export const dimension = 'architecture';
export const severity = 'warning';
export const confidence = 1;

export function enabled(config) {
  return Boolean(config && config.boundaries);
}

export function run({ graph, config, facts }) {
  if (!facts || !enabled(config)) return [];
  const spec = parseBoundaries(config.boundaries);
  const layerOf = layerResolver(spec.layers);
  const excluded = new Set(graph.excluded.roles || []);
  const skip = new Set(facts.files.filter((f) => excluded.has(f.role)).map((f) => f.path));

  const violations = new Map(); // "from\0to" -> { rule, imports }
  for (const imp of facts.imports) {
    if (!imp.resolved || skip.has(imp.from) || skip.has(imp.to)) continue;
    const from = layerOf(imp.from);
    const to = layerOf(imp.to);
    if (!from || !to || from === to) continue;
    const rule = spec.rules.find((r) => r.from === from && forbids(r, to));
    if (!rule) continue;
    const key = `${from}\0${to}`;
    if (!violations.has(key)) violations.set(key, { from, to, rule, imports: [] });
    violations.get(key).imports.push({
      file: imp.from, line: imp.line, to: imp.to,
      ...Object.fromEntries(['typeOnly', 'lazy', 'conditional'].filter((flag) => imp[flag]).map((flag) => [flag, true])),
    });
  }

  return [...violations.values()]
    .sort((a, b) => compareText(a.from, b.from) || compareText(a.to, b.to))
    .map(({ from, to, rule, imports }) => {
      imports.sort((a, b) => compareText(a.file, b.file) || a.line - b.line || compareText(a.to, b.to));
      const files = [...new Set(imports.map((i) => i.file))].sort(compareText);
      const reason = rule.reason || `${from} must not depend on ${to}`;
      return {
        code, dimension, severity, confidence,
        message: `${imports.length} import${imports.length === 1 ? '' : 's'} in ${files.length} file${files.length === 1 ? '' : 's'} of layer "${from}" depend${imports.length === 1 ? 's' : ''} on layer "${to}", which the configured rule forbids: ${reason}.`,
        subject: { boundary: { from, to } },
        evidence: {
          threshold: null,
          rule: { from: rule.from, ...(rule.allow ? { allow: rule.allow } : { disallow: rule.disallow }), ...(rule.reason ? { reason: rule.reason } : {}) },
          totalImports: imports.length,
          files,
          imports,
        },
        supportedFixes: [
          `move what ${from} needs behind an interface owned by ${from} or by a layer it may depend on`,
          `move the shared code into a layer both ${from} and ${to} may depend on`,
          'if the dependency is intended, update the boundary rule in the analysis config',
        ],
      };
    });
}

function forbids(rule, to) {
  return rule.allow ? !rule.allow.includes(to) : rule.disallow.includes(to);
}

// Files per declared layer (first matching layer wins), for coverage: a layer
// matching nothing usually means a mistyped glob, not a clean boundary.
export function layerCounts(raw, files) {
  const spec = parseBoundaries(raw);
  const layerOf = layerResolver(spec.layers);
  const counts = new Map(spec.layers.map((l) => [l.name, 0]));
  for (const f of files) { const layer = layerOf(f); if (layer) counts.set(layer, counts.get(layer) + 1); }
  return { layers: spec.layers.map((l) => ({ name: l.name, files: counts.get(l.name) })), rules: spec.rules.length };
}

function layerResolver(layers) {
  const matchers = layers.map(({ name, globs }) => [name, matcher(globs)]);
  const cache = new Map();
  return (file) => {
    if (!cache.has(file)) cache.set(file, (matchers.find(([, match]) => match(file)) || [null])[0]);
    return cache.get(file);
  };
}

// Validates the config and returns { layers: [{ name, globs }], rules }.
// Invalid configuration stops the analysis with a diagnostic rather than
// silently checking less than the reader asked for.
export function parseBoundaries(raw) {
  const invalid = (message, evidence = {}) => fail('config/boundaries-invalid', message, {
    subject: { option: 'boundaries' }, evidence,
    supportedFixes: ['see "Architecture boundaries" in the code-analysis usage guide for the expected shape'],
  });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid('"boundaries" must be an object with "layers" and "rules".');
  const rawLayers = raw.layers;
  if (!rawLayers || typeof rawLayers !== 'object' || Array.isArray(rawLayers) || !Object.keys(rawLayers).length) invalid('"boundaries.layers" must name at least one layer.');
  const layers = Object.entries(rawLayers).map(([name, globs]) => {
    const list = typeof globs === 'string' ? [globs] : globs;
    if (!Array.isArray(list) || !list.length || !list.every((g) => typeof g === 'string' && g.length)) invalid(`Layer "${name}" needs one or more path globs.`, { layer: name });
    return { name, globs: list };
  });
  const names = new Set(layers.map((l) => l.name));
  if (!Array.isArray(raw.rules) || !raw.rules.length) invalid('"boundaries.rules" must list at least one rule.');
  const rules = raw.rules.map((r, index) => {
    if (!r || typeof r !== 'object') invalid(`Rule ${index + 1} must be an object.`, { rule: index });
    if (!names.has(r.from)) invalid(`Rule ${index + 1} names unknown layer "${r.from}" in "from".`, { rule: index, known: [...names] });
    const hasAllow = r.allow !== undefined;
    const hasDisallow = r.disallow !== undefined;
    if (hasAllow === hasDisallow) invalid(`Rule ${index + 1} must have exactly one of "allow" or "disallow".`, { rule: index });
    const list = hasAllow ? r.allow : r.disallow;
    if (!Array.isArray(list) || !list.every((n) => typeof n === 'string')) invalid(`Rule ${index + 1}: "${hasAllow ? 'allow' : 'disallow'}" must be a list of layer names.`, { rule: index });
    const unknown = list.filter((n) => !names.has(n));
    if (unknown.length) invalid(`Rule ${index + 1} names unknown layer${unknown.length === 1 ? '' : 's'} ${unknown.map((n) => `"${n}"`).join(', ')}.`, { rule: index, unknown, known: [...names] });
    if (r.reason !== undefined && typeof r.reason !== 'string') invalid(`Rule ${index + 1}: "reason" must be text.`, { rule: index });
    return { from: r.from, ...(hasAllow ? { allow: [...list] } : { disallow: [...list] }), ...(r.reason ? { reason: r.reason } : {}) };
  });
  return { layers, rules };
}

function compareText(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
