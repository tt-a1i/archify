// Code Analysis as a library. The only product entry point is `serve`
// (bin/serve.mjs): Archify delivers the authored diagram first, and the
// analysis below runs when the reader clicks the button on that page. Every
// stage is still a pure JSON → JSON step with a schema, written to the output
// directory so a result can be inspected or diffed; none of them is a
// command of its own.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { otherLanguageFiles, selectAdapter } from '../extract/index.mjs';
import { fail, receipt } from '../extract/shared/diagnostics.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';
import { buildModuleGraph } from '../graphs/module.mjs';
import { buildOverlay } from '../overlay/inject.mjs';
import { evaluate } from '../evaluate/index.mjs';
import { reviewFindings, validateBaseline } from './review.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function loadConfig(explicit) {
  const defaults = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'config', 'defaults.json'), 'utf8'));
  if (!explicit) return defaults;
  if (!fs.existsSync(explicit)) fail('cli/config-missing', `Config file not found: ${explicit}`, {
    subject: { option: '--config' }, evidence: { path: explicit }, supportedFixes: ['pass an existing JSON file'],
  });
  let custom;
  try { custom = JSON.parse(fs.readFileSync(explicit, 'utf8')); } catch (error) {
    fail('cli/config-invalid', `${explicit} is not valid JSON.`, { subject: { option: '--config' }, evidence: { path: explicit, reason: error.message }, supportedFixes: ['fix the JSON syntax'] });
  }
  if (!isPlainObject(custom)) fail('cli/config-invalid', `${explicit} must contain a JSON object.`, { subject: { option: '--config' }, evidence: { path: explicit }, supportedFixes: ['wrap the settings in { … }'] });
  return mergeConfig(defaults, custom);
}

// Config merge rules, applied at every depth:
//   - objects merge key by key, so `{"rules": {"complexity": {"function": {"warning": {"complexity": 30}}}}}`
//     changes one threshold and keeps every other default;
//   - arrays replace the default array as a whole (`exclude`, `include`, `ignore`, a role's globs):
//     list every pattern you want, defaults included;
//   - scalars and `null` replace the default value.
// Rules are turned off with `ignore: ["rule/code"]`; nothing else disables a rule.
export function mergeConfig(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) return clone(override);
  const out = clone(base);
  for (const [key, value] of Object.entries(override)) {
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? mergeConfig(out[key], value) : clone(value);
  }
  return out;
}

function isPlainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function clone(value) { return value === undefined ? undefined : JSON.parse(JSON.stringify(value)); }

// Counts for receipts and the CLI summary; the full lists are in review.json.
export function reviewSummary(review) {
  return {
    baseline: review.baseline ? { entries: review.baseline.entries, accepted: review.baseline.accepted.length, changed: review.baseline.changed.length, stale: review.baseline.stale.length } : null,
    comparison: review.comparison ? { comparable: review.comparison.comparable, new: review.comparison.new.length, notDetected: review.comparison.notDetected.length, fixed: review.comparison.notDetected.length, evidenceChanged: review.comparison.evidenceChanged.length, unchanged: review.comparison.unchanged } : null,
  };
}

export function readJsonInput(file, what) {
  if (!file) fail('cli/input-missing', `${what} requires an input file argument.`, { supportedFixes: ['pass the JSON file path'] });
  if (!fs.existsSync(file)) fail('cli/input-invalid', `Not a file: ${file}`, { subject: { file }, supportedFixes: ['pass an existing JSON file'] });
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) {
    fail('cli/input-not-json', `${file} is not valid JSON.`, { subject: { file }, evidence: { reason: error.message }, supportedFixes: ['regenerate the input'] });
  }
}

// Stage 1: source → raw facts (files, imports, symbols, unresolved counters).
export function extractFacts(root, { language = null, config = null } = {}) {
  if (!root) fail('cli/root-missing', 'a <repo-root> is required.', { supportedFixes: ['pass a directory path'] });
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail('cli/root-invalid', `Not a directory: ${root}`, {
    subject: { root }, supportedFixes: ['pass an existing directory'],
  });
  const cfg = config && typeof config === 'object' ? config : loadConfig(config);
  const adapter = selectAdapter(root, cfg, language);
  const facts = adapter.extract(root, cfg);
  facts.repository.snapshotId = createHash('sha256').update(stableJson(facts)).digest('hex');
  const errors = schemaErrors('raw-facts', facts);
  if (errors.length) fail('extract/schema-invalid', 'Extractor output violates raw-facts.schema.json.', {
    subject: { adapter: adapter.id }, evidence: { errors: errors.slice(0, 20) }, supportedFixes: ['this is an analyzer bug; report it with the evidence'],
  });
  return { adapter: adapter.id, facts, config: cfg, otherLanguages: otherLanguageFiles(root, cfg, adapter.id) };
}

// Stage 2: raw facts → module graph.
export function buildGraph(facts, config) {
  const factErrors = schemaErrors('raw-facts', facts);
  if (factErrors.length) fail('graphs/input-schema-invalid', 'Input does not conform to raw-facts.schema.json.', {
    evidence: { errors: factErrors.slice(0, 20) }, supportedFixes: ['regenerate the raw facts'],
  });
  const graph = buildModuleGraph(facts, config);
  const errors = schemaErrors('module-graph', graph);
  if (errors.length) fail('graphs/schema-invalid', 'Module graph violates module-graph.schema.json.', {
    subject: {}, evidence: { errors: errors.slice(0, 20) }, supportedFixes: ['this is an analyzer bug; report it with the evidence'],
  });
  return graph;
}

// Stage 3: module graph (+ facts) → findings.
export function evaluateGraph(graph, config, facts = null) {
  const graphErrors = schemaErrors('module-graph', graph);
  if (graphErrors.length) fail('evaluate/input-schema-invalid', 'Input does not conform to module-graph.schema.json.', { evidence: { errors: graphErrors.slice(0, 20) }, supportedFixes: ['regenerate the module graph'] });
  validateFacts(graph, facts);
  const findings = evaluate(graph, config, facts);
  const errors = schemaErrors('findings', findings);
  if (errors.length) fail('evaluate/schema-invalid', 'Findings violate findings.schema.json.', { evidence: { errors: errors.slice(0, 20) }, supportedFixes: ['this is an analyzer bug; report it with the evidence'] });
  return findings;
}

export function validateFacts(graph, facts) {
  if (!facts) return;
  const errors = schemaErrors('raw-facts', facts);
  if (errors.length) fail('input/facts-incompatible', 'Raw facts violate the schema or reference invariants.', { evidence: { errors: errors.slice(0, 20) }, supportedFixes: ['regenerate raw-facts and module-graph together'] });
  for (const key of ['root', 'revision', 'language', 'sourceKind', 'baseRevision', 'snapshotId']) {
    if (graph.repository[key] !== undefined && graph.repository[key] !== facts.repository?.[key]) errors.push({ path: `/repository/${key}`, message: 'must match module-graph input' });
  }
  if (graph.fileModules && Array.isArray(facts.files)) {
    const roles = new Set(graph.excluded.roles);
    const files = new Set(facts.files.filter((f) => !roles.has(f.role)).map((f) => f.path));
    const ownership = Object.keys(graph.fileModules);
    // Reconcile dependency aggregates using the supplied, validated ownership map.
    // Evidence samples and ordering are deliberately not part of this comparison.
    const aggregates = new Map();
    for (const imp of facts.imports) {
      if (!imp.resolved) continue;
      const from = graph.fileModules[imp.from], to = graph.fileModules[imp.to];
      if (from === undefined || to === undefined || from === to) continue;
      const key = JSON.stringify([from, to]);
      if (!aggregates.has(key)) aggregates.set(key, { weight: 0, kinds: { eager: 0 } });
      const aggregate = aggregates.get(key);
      aggregate.weight += 1;
      for (const kind of [imp.kind, ...['lazy', 'conditional', 'typeOnly', 'implicit'].filter((flag) => imp[flag])]) {
        aggregate.kinds[kind] = (aggregate.kinds[kind] || 0) + 1;
      }
      if (facts.repository.language !== 'java' && !imp.lazy && !imp.conditional && !imp.typeOnly && !(facts.repository.language === 'ts' && imp.kind === 'dynamic')) aggregate.kinds.eager += 1;
    }
    const mismatch = graph.edges.length !== aggregates.size || graph.edges.some((edge) => {
      const expected = aggregates.get(JSON.stringify([edge.from, edge.to]));
      if (!expected || expected.weight !== edge.weight) return true;
      // Legacy graphs may omit eager; compare every other count and explicit eager counts.
      const keys = new Set([...Object.keys(expected.kinds), ...Object.keys(edge.kinds)]);
      return [...keys].some((key) => !(key === 'eager' && edge.kinds.eager === undefined)
        && (expected.kinds[key] || 0) !== (edge.kinds[key] || 0));
    });
    if (mismatch) errors.push({ path: '/edges', message: 'must match aggregated raw-facts imports' });
    if (ownership.length !== files.size || ownership.some((f) => !files.has(f))) errors.push({ path: '/files', message: 'must match module-graph file ownership' });
  }
  if (errors.length) fail('input/facts-incompatible', 'Raw facts are invalid or do not match the module graph.', { evidence: { errors: errors.slice(0, 20) }, supportedFixes: ['regenerate raw-facts and module-graph together'] });
}

// Stage 4: delivered HTML + authored IR + graph → a new HTML with the analysis layer.
export function overlayHtml({ html, ir, graph, facts = null, findings = [], findingsDocument = null, map = null, sourceRoot = null, run = {} }) {
  const graphErrors = schemaErrors('module-graph', graph);
  if (graphErrors.length) fail('overlay/input-schema-invalid', 'module-graph input does not conform to its schema.', { evidence: { errors: graphErrors.slice(0, 20) }, supportedFixes: ['regenerate the module graph'] });
  validateFacts(graph, facts);
  if (sourceRoot && !fs.existsSync(sourceRoot)) fail('cli/input-invalid', `Not a directory: ${sourceRoot}`, { subject: { dir: sourceRoot }, supportedFixes: ['pass the directory that was analyzed'] });
  return buildOverlay({ ir, graph, html, map, facts, findings, findingsDocument, sourceRoot, run });
}

// Baseline file → validated document, or null when none was given.
export function loadBaseline(file) {
  return file ? validateBaseline(readJsonInput(file, 'analysis --baseline'), file) : null;
}

// Previous findings.json → document, or null when there is none or it is not
// a readable findings document (a comparison is optional, never a failure).
// With `strict` (an explicitly requested comparison), an unreadable or invalid
// file is an input error instead: silently comparing with nothing would let a
// `--new-only` gate pass on a corrupted artifact.
export function loadPrevious(file, { strict = false } = {}) {
  if (strict) {
    const doc = readJsonInput(file, 'check --compare');
    const errors = schemaErrors('findings', doc);
    if (errors.length) fail('cli/input-invalid', `${file} is not a findings.json document.`, { subject: { option: '--compare', file }, evidence: { errors: errors.slice(0, 20) }, supportedFixes: ['pass the findings.json written by an earlier analysis run'] });
    return doc;
  }
  if (!file || !fs.existsSync(file)) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    return schemaErrors('findings', doc).length ? null : doc;
  } catch { return null; }
}

// The whole analysis for one delivered page, as the button runs it:
// extract → graphs → evaluate → overlay, each stage written to `out`.
// `html` is the page Archify delivered for `ir`; it is read, never modified.
// `baseline` (file) marks accepted findings; `previous` (a findings.json from
// an earlier run) adds a comparison. Both are recorded in review.json.
export function analyzeRepository({ root, ir, html, out, language = null, config = null, map = null, irSnapshot = null, baseline = null, previous = null }) {
  const absRoot = path.resolve(root);
  const irPath = path.resolve(ir);
  const htmlPath = path.resolve(html);
  const dir = path.resolve(out);
  if (!fs.existsSync(irPath)) fail('cli/input-invalid', `Not a file: ${ir}`, { subject: { file: ir }, supportedFixes: ['pass the authored architecture IR'] });
  if (!fs.existsSync(htmlPath)) fail('cli/input-invalid', `Not a file: ${html}`, { subject: { file: html }, supportedFixes: ['deliver the diagram with `archify deliver` first'] });
  if (path.resolve(dir, 'repo.analysis.html') === htmlPath) fail('cli/out-invalid', 'The analysis output must not overwrite the delivered HTML.', { supportedFixes: ['use a different --out directory'] });
  fs.mkdirSync(dir, { recursive: true });
  const { adapter, facts, config: cfg, otherLanguages } = extractFacts(absRoot, { language, config });
  fs.writeFileSync(path.join(dir, 'raw-facts.json'), stableJson(facts));
  const graph = buildGraph(facts, cfg);
  fs.writeFileSync(path.join(dir, 'module-graph.json'), stableJson(graph));
  const findings = evaluateGraph(graph, cfg, facts);
  fs.writeFileSync(path.join(dir, 'findings.json'), stableJson(findings));
  const review = reviewFindings(findings.diagnostics, { baseline: loadBaseline(baseline), previous: loadPrevious(previous), analysis: findings.analysis, files: facts.files.map((f) => f.path) });
  fs.writeFileSync(path.join(dir, 'review.json'), stableJson(review));
  const irDoc = irSnapshot ?? readJsonInput(irPath, 'analysis --ir');
  const mapDoc = map ? readJsonInput(map, 'analysis --map') : null;
  const run = { rules: findings.rules, suppressed: cfg.ignore || [], exclude: cfg.exclude || [], otherLanguages, boundaries: cfg.boundaries || null, review };
  const overlay = overlayHtml({ html: fs.readFileSync(htmlPath, 'utf8'), ir: irDoc, graph, facts, findings: findings.diagnostics, findingsDocument: findings, map: mapDoc, sourceRoot: absRoot, run });
  fs.writeFileSync(path.join(dir, 'overview.json'), stableJson(overlay.overview));
  const outHtml = path.join(dir, 'repo.analysis.html');
  fs.writeFileSync(outHtml, overlay.html);
  return receipt('ok', {
    command: 'analysis', out: dir,
    extract: { adapter, files: facts.files.length, imports: facts.imports.length, resolved: facts.imports.filter((i) => i.resolved).length, unresolved: facts.unresolved, revision: facts.repository.revision },
    graphs: { modules: graph.modules.length, edges: graph.edges.length, excludedFiles: graph.excluded.files },
    evaluate: findings.summary,
    overlay: { html: outHtml, components: overlay.components, mapped: overlay.mapped, findings: findings.diagnostics.length, snippets: overlay.snippets, verdict: overlay.overview.verdict, priorities: overlay.overview.priorities, otherLanguages },
    review: reviewSummary(review),
  });
}
