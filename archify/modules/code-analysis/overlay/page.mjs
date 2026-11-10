// The analysis for one delivered page, as the Code Analysis button runs it
// (bin/analyze-run.mjs): the data stages from lib/analysis.mjs, then the view.
// It sits in overlay/ because it is the only step that needs the page builder;
// lib/ stays free of presentation code.
import fs from 'node:fs';
import path from 'node:path';
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
  const run = { rules: findings.rules, suppressed: cfg.ignore || [], exclude: cfg.exclude || [], otherLanguages, boundaries: cfg.boundaries || null, duplicates: findings.analysis?.duplicates || null, review };
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
