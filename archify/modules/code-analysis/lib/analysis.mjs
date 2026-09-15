// Code Analysis as a library. The only product entry point is `serve`
// (bin/serve.mjs): Archify delivers the authored diagram first, and the
// analysis below runs when the reader clicks the button on that page. Every
// stage is still a pure JSON → JSON step with a schema, written to the output
// directory so a result can be inspected or diffed; none of them is a
// command of its own.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectAdapter } from '../extract/index.mjs';
import { fail, receipt } from '../extract/shared/diagnostics.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';
import { buildModuleGraph } from '../graphs/module.mjs';
import { buildOverlay } from '../overlay/inject.mjs';
import { evaluate } from '../evaluate/index.mjs';

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
  return { ...defaults, ...JSON.parse(fs.readFileSync(explicit, 'utf8')) };
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
  const errors = schemaErrors('raw-facts', facts);
  if (errors.length) fail('extract/schema-invalid', 'Extractor output violates raw-facts.schema.json.', {
    subject: { adapter: adapter.id }, evidence: { errors: errors.slice(0, 20) }, supportedFixes: ['this is an analyzer bug; report it with the evidence'],
  });
  return { adapter: adapter.id, facts, config: cfg };
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
  for (const key of ['root', 'revision', 'language']) {
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
      if (!imp.lazy && !imp.conditional && !imp.typeOnly && !(facts.repository.language === 'ts' && imp.kind === 'dynamic')) aggregate.kinds.eager += 1;
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
export function overlayHtml({ html, ir, graph, facts = null, findings = [], map = null, sourceRoot = null }) {
  const graphErrors = schemaErrors('module-graph', graph);
  if (graphErrors.length) fail('overlay/input-schema-invalid', 'module-graph input does not conform to its schema.', { evidence: { errors: graphErrors.slice(0, 20) }, supportedFixes: ['regenerate the module graph'] });
  validateFacts(graph, facts);
  if (sourceRoot && !fs.existsSync(sourceRoot)) fail('cli/input-invalid', `Not a directory: ${sourceRoot}`, { subject: { dir: sourceRoot }, supportedFixes: ['pass the directory that was analyzed'] });
  return buildOverlay({ ir, graph, html, map, facts, findings, sourceRoot });
}

// The whole analysis for one delivered page, as the button runs it:
// extract → graphs → evaluate → overlay, each stage written to `out`.
// `html` is the page Archify delivered for `ir`; it is read, never modified.
export function analyzeRepository({ root, ir, html, out, language = null, config = null, map = null }) {
  const absRoot = path.resolve(root);
  const irPath = path.resolve(ir);
  const htmlPath = path.resolve(html);
  const dir = path.resolve(out);
  if (!fs.existsSync(irPath)) fail('cli/input-invalid', `Not a file: ${ir}`, { subject: { file: ir }, supportedFixes: ['pass the authored architecture IR'] });
  if (!fs.existsSync(htmlPath)) fail('cli/input-invalid', `Not a file: ${html}`, { subject: { file: html }, supportedFixes: ['deliver the diagram with `archify deliver` first'] });
  if (path.resolve(dir, 'repo.analysis.html') === htmlPath) fail('cli/out-invalid', 'The analysis output must not overwrite the delivered HTML.', { supportedFixes: ['use a different --out directory'] });
  fs.mkdirSync(dir, { recursive: true });
  const { adapter, facts, config: cfg } = extractFacts(absRoot, { language, config });
  fs.writeFileSync(path.join(dir, 'raw-facts.json'), stableJson(facts));
  const graph = buildGraph(facts, cfg);
  fs.writeFileSync(path.join(dir, 'module-graph.json'), stableJson(graph));
  const findings = evaluateGraph(graph, cfg, facts);
  fs.writeFileSync(path.join(dir, 'findings.json'), stableJson(findings));
  const irDoc = readJsonInput(irPath, 'analysis --ir');
  const mapDoc = map ? readJsonInput(map, 'analysis --map') : null;
  const overlay = overlayHtml({ html: fs.readFileSync(htmlPath, 'utf8'), ir: irDoc, graph, facts, findings: findings.diagnostics, map: mapDoc, sourceRoot: absRoot });
  const outHtml = path.join(dir, 'repo.analysis.html');
  fs.writeFileSync(outHtml, overlay.html);
  return receipt('ok', {
    command: 'analysis', out: dir,
    extract: { adapter, files: facts.files.length, imports: facts.imports.length, resolved: facts.imports.filter((i) => i.resolved).length, unresolved: facts.unresolved, revision: facts.repository.revision },
    graphs: { modules: graph.modules.length, edges: graph.edges.length, excludedFiles: graph.excluded.files },
    evaluate: findings.summary,
    overlay: { html: outHtml, components: overlay.components, mapped: overlay.mapped, findings: findings.diagnostics.length, snippets: overlay.snippets },
  });
}
