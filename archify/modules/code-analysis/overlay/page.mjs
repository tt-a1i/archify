// The analysis for one delivered page, as the Code Analysis button runs it
// (bin/analyze-run.mjs): the data stages from lib/analysis.mjs, then the view.
// It sits in overlay/ because it is the only step that needs the page builder;
// lib/ stays free of presentation code.
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fail, receipt } from '../core/index.mjs';
import { schemaErrors } from '../schemas/index.mjs';
import { buildGraph, evaluateGraph, extractFacts, loadBaseline, loadPrevious, readJsonInput, reviewSummary, stableJson, validateFacts } from '../lib/analysis.mjs';
import { reviewFindings } from '../lib/review.mjs';
import { buildOverlay } from './inject.mjs';

// Stage 4: delivered HTML + authored IR + graph → a new HTML with the analysis layer.
export function overlayHtml({ html, ir, graph, facts = null, findings = [], findingsDocument = null, map = null, sourceRoot = null, run = {} }) {
  const graphErrors = schemaErrors('module-graph', graph);
  if (graphErrors.length) fail('overlay/input-schema-invalid', 'module-graph input does not conform to its schema.', { evidence: { errors: graphErrors.slice(0, 20) }, supportedFixes: ['regenerate the module graph'] });
  validateFacts(graph, facts);
  if (sourceRoot && !fs.existsSync(sourceRoot)) fail('cli/input-invalid', `Not a directory: ${sourceRoot}`, { subject: { dir: sourceRoot }, supportedFixes: ['pass the directory that was analyzed'] });
  return buildOverlay({ ir, graph, html, map, facts, findings, findingsDocument, sourceRoot, run });
}

// Review decisions change presentation, not the captured analysis. Reuse the
// same view builder with the original mapping/scope; never reload live config
// or re-import reports merely to display a new baseline decision.
export function renderAnalysisSnapshot({ dir, html, root, review }) {
  const read = (name) => readJsonInput(path.join(dir, name), 'review view');
  const facts = read('raw-facts.json'), graph = read('module-graph.json'), findings = read('findings.json');
  const context = read('view-context.json');
  if (context?.schema_version !== 1 || !context.ir || !context.run) fail('overlay/context-invalid', 'The captured view context is missing or invalid.', { supportedFixes: ['re-analyze the repository to rebuild its captured view'] });
  const run = { ...context.run, rules: findings.rules, duplicates: findings.analysis?.duplicates || null, external: findings.analysis?.external || [], review };
  return overlayHtml({ html: fs.readFileSync(html, 'utf8'), ir: context.ir, graph, facts, findings: findings.diagnostics, findingsDocument: findings, map: context.map, sourceRoot: root, run });
}

// Each published view artifact is complete even if a later write fails. The
// server also keeps the rendered HTML in memory after a baseline was saved.
export function writeAnalysisView(dir, overlay, review) {
  for (const [name, contents] of [['review.json', stableJson(review)], ['overview.json', stableJson(overlay.overview)], ['repo.analysis.html', overlay.html]]) {
    const target = path.join(dir, name), temporary = `${target}.next-${randomBytes(8).toString('hex')}`;
    try {
      fs.writeFileSync(temporary, contents, { flag: 'wx' });
      fs.renameSync(temporary, target);
    } finally { fs.rmSync(temporary, { force: true }); }
  }
}

// The whole analysis for one delivered page, as the button runs it:
// extract → graphs → evaluate → overlay, each stage written to `out`.
// `html` is the page Archify delivered for `ir`; it is read, never modified.
// `baseline` (file) marks accepted findings; `previous` (a findings.json from
// an earlier run) adds a comparison. Both are recorded in review.json.
export function analyzeRepository({ root, ir, html, out, language = null, config = null, map = null, irSnapshot = null, baseline = null, previous = null, resume = null, openAnalysis = false }) {
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
  const findings = evaluateGraph(graph, cfg, facts, { root: absRoot });
  fs.writeFileSync(path.join(dir, 'findings.json'), stableJson(findings));
  const review = reviewFindings(findings.diagnostics, { baseline: loadBaseline(baseline), previous: loadPrevious(previous), analysis: findings.analysis, files: [...facts.files, ...(findings.externalEvidence || [])].map((f) => f.path) });
  const irDoc = irSnapshot ?? readJsonInput(irPath, 'analysis --ir');
  const mapDoc = map ? readJsonInput(map, 'analysis --map') : null;
  const context = { schema_version: 1, ir: irDoc, map: mapDoc, run: { openAnalysis, ...(resume ? { resume } : {}), suppressed: cfg.ignore || [], exclude: cfg.exclude || [], otherLanguages, boundaries: cfg.boundaries || null } };
  fs.writeFileSync(path.join(dir, 'view-context.json'), stableJson(context));
  const run = { ...context.run, rules: findings.rules, duplicates: findings.analysis?.duplicates || null, external: findings.analysis?.external || [], review };
  const overlay = overlayHtml({ html: fs.readFileSync(htmlPath, 'utf8'), ir: irDoc, graph, facts, findings: findings.diagnostics, findingsDocument: findings, map: mapDoc, sourceRoot: absRoot, run });
  const outHtml = path.join(dir, 'repo.analysis.html');
  writeAnalysisView(dir, overlay, review);
  return receipt('ok', {
    command: 'analysis', out: dir,
    extract: { adapter, files: facts.files.length, imports: facts.imports.length, resolved: facts.imports.filter((i) => i.resolved).length, unresolved: facts.unresolved, revision: facts.repository.revision },
    graphs: { modules: graph.modules.length, edges: graph.edges.length, excludedFiles: graph.excluded.files },
    evaluate: findings.summary,
    overlay: { html: outHtml, components: overlay.components, mapped: overlay.mapped, findings: findings.diagnostics.length, snippets: overlay.snippets, verdict: overlay.overview.verdict, priorities: overlay.overview.priorities, otherLanguages },
    review: reviewSummary(review),
  });
}
