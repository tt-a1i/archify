#!/usr/bin/env node
// Headless code analysis for terminals and CI: extract → graphs → evaluate,
// with the baseline, comparison, optional diagram alignment (--ir) and an exit
// code a pipeline can gate on.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DiagnosticError, fail, receipt } from '../core/index.mjs';
import { baselineCommand, taskCommand } from '../lib/task-command.mjs';

export const USAGE = `Usage:
  archify code-analysis check <repo-root> [--language ts|py|java|go|rust] [--config file.json]
                              [--ir architecture.json [--map overlay-map.json]]
                              [--baseline baseline.json] [--compare findings.json] [--out dir]
                              [--fail-on error|warning|info|never] [--new-only]
                              [--update-baseline | --accept finding-id | --revoke finding-id]
                              [--reason text] [--json]

Analyzes <repo-root> headlessly and exits 1 when an open finding reaches
--fail-on (default: warning). With --ir (and optional --map), also maps code
modules and findings onto the architecture diagram components and reports
unmapped modules and undeclared component-level imports without changing the gate.
Findings accepted in --baseline do not fail the run unless their evidence changed
since they were accepted. --new-only fails only on
findings that are new since --compare (or since the previous run in --out);
without a previous run to compare with, every open finding counts as new.
--update-baseline writes every current finding to --baseline (keeping existing
reasons; new entries get --reason) and exits 0.
--accept accepts one current finding with a required --reason. --revoke removes
one accepted id without re-running analysis. Both require --baseline.
Exit codes: 0 passed, 1 gate failed, 2 analysis or usage error.
Outputs with --out: raw-facts, module-graph, findings, review, overview (.json).`;

const VALUE_OPTIONS = ['--language', '--config', '--ir', '--map', '--baseline', '--compare', '--out', '--fail-on', '--reason', '--accept', '--revoke'];
const FLAG_OPTIONS = ['--new-only', '--update-baseline', '--json'];
const SEVERITY = { error: 0, warning: 1, info: 2 };

export function parseCheckArgs(argv) {
  const [repo, ...rest] = argv;
  const usage = (message) => fail('cli/usage', `${message}\n${USAGE}`, { supportedFixes: ['see the usage above'] });
  if (!repo || repo.startsWith('-')) usage('check requires a <repo-root>.');
  const options = { '--fail-on': 'warning' };
  for (let i = 0; i < rest.length; i += 1) {
    const key = rest[i];
    if (FLAG_OPTIONS.includes(key)) { options[key] = true; continue; }
    if (!VALUE_OPTIONS.includes(key) || rest[i + 1] === undefined || rest[i + 1].startsWith('--')) usage(`Invalid option: ${key}`);
    options[key] = rest[i + 1];
    i += 1;
  }
  if (!['error', 'warning', 'info', 'never'].includes(options['--fail-on'])) usage(`--fail-on must be error, warning, info or never (got ${options['--fail-on']}).`);
  if (options['--map'] && !options['--ir']) usage('--map requires --ir <architecture.json>.');
  if (options['--update-baseline'] && !options['--baseline']) usage('--update-baseline needs --baseline <file> to write.');
  if ((options['--accept'] || options['--revoke']) && !options['--baseline']) usage('--accept and --revoke require --baseline <file>.');
  if (['--update-baseline', '--accept', '--revoke'].filter((key) => options[key]).length > 1) usage('Choose one baseline action: --update-baseline, --accept or --revoke.');
  if (options['--accept'] && !options['--reason']?.trim()) usage('--accept requires a non-empty --reason.');
  return { repo, options };
}

export async function runCheck(argv) {
  const { repo, options } = parseCheckArgs(argv);
  const { ensureDependencies } = await import('./serve.mjs');
  await ensureDependencies();
  const { extractFacts, buildGraph, evaluateGraph, loadBaseline, saveBaseline, loadPrevious, readJsonInput, stableJson, reviewSummary } = await import('../lib/analysis.mjs');
  const { reviewFindings, baselineFrom, acceptFinding, revokeFinding, isOpen } = await import('../lib/review.mjs');
  const { buildOverview, findingWhere } = await import('../overlay/overview.mjs');
  const { alignDiagram, findingModules } = await import('../overlay/inject.mjs');

  const root = path.resolve(repo);
  const baselineFile = options['--baseline'] ? path.resolve(options['--baseline']) : null;
  const writeBaseline = (doc, action, id) => {
    saveBaseline(baselineFile, doc);
    return { exitCode: 0, receipt: receipt('ok', { command: 'check', action, baseline: baselineFile, id, entries: doc.accepted.length }) };
  };
  if (options['--revoke']) return writeBaseline(revokeFinding(options['--revoke'], { existing: loadBaseline(baselineFile) }), 'revoke-finding', options['--revoke']);
  let irDoc = null, mapDoc = null;
  if (options['--ir']) {
    irDoc = readJsonInput(path.resolve(options['--ir']), 'check --ir');
    if (!irDoc || typeof irDoc !== 'object' || irDoc.diagram_type !== 'architecture' || !Array.isArray(irDoc.components)) {
      fail('cli/input-invalid', `Not an Archify architecture IR: ${options['--ir']}`, {
        subject: { option: '--ir', file: options['--ir'] },
        supportedFixes: ['pass an architecture JSON file with diagram_type "architecture" and components'],
      });
    }
    const { validateSchema } = await import('../../../renderers/shared/validator.mjs');
    try { validateSchema('architecture', irDoc, { sourceReferencesOnly: true }); }
    catch (error) {
      if (error.archifyDiagnostics) throw new DiagnosticError(error.message, error.archifyDiagnostics);
      throw error;
    }
    if (options['--map']) {
      mapDoc = readJsonInput(path.resolve(options['--map']), 'check --map');
      if (!mapDoc || typeof mapDoc !== 'object' || Array.isArray(mapDoc)) {
        fail('cli/input-invalid', `Overlay map must be a JSON object: ${options['--map']}`, {
          subject: { option: '--map', file: options['--map'] },
          supportedFixes: ['pass a JSON object mapping componentId to [moduleId, ...]'],
        });
      }
    }
  }
  const out = options['--out'] ? path.resolve(options['--out']) : null;
  const previousFile = options['--compare'] ? path.resolve(options['--compare']) : out ? path.join(out, 'findings.json') : null;
  if (options['--compare'] && !fs.existsSync(previousFile)) fail('cli/input-invalid', `Not a file: ${options['--compare']}`, { subject: { option: '--compare' }, supportedFixes: ['pass the findings.json of an earlier run'] });
  // An explicit --compare must be readable; the automatic one in --out is optional.
  const previous = loadPrevious(previousFile, { strict: Boolean(options['--compare']) });

  const { facts, config, otherLanguages } = extractFacts(root, { language: options['--language'] || null, config: options['--config'] || null });
  const graph = buildGraph(facts, config);
  const findings = evaluateGraph(graph, config, facts, { root });
  if (options['--accept']) {
    const diagnostic = findings.diagnostics.find((d) => d.id === options['--accept']);
    if (!diagnostic) fail('baseline/finding-unknown', 'The requested finding is not in the current analysis.', { subject: { id: options['--accept'] }, supportedFixes: ['use an id from the current findings.json'] });
    const existing = fs.existsSync(baselineFile) ? loadBaseline(baselineFile) : null;
    return writeBaseline(acceptFinding(diagnostic, { existing, reason: options['--reason'] }), 'accept-finding', diagnostic.id);
  }

  if (options['--update-baseline']) {
    if (findings.analysis?.external?.length && !options['--reason']?.trim()) fail('baseline/reason-required', 'Accepting external diagnostics requires an explicit reason.', { supportedFixes: ['provide --reason explaining the review decision'] });
    const existing = baselineFile && fs.existsSync(baselineFile) ? loadBaseline(baselineFile) : null;
    const doc = baselineFrom(findings.diagnostics, { existing, reason: options['--reason'] || 'Accepted as existing when the baseline was written; review before relying on it.' });
    saveBaseline(baselineFile, doc);
    const kept = existing ? doc.accepted.filter((e) => existing.accepted.some((x) => x.id === e.id)).length : 0;
    return { exitCode: 0, receipt: receipt('ok', { command: 'check', action: 'update-baseline', baseline: baselineFile, entries: doc.accepted.length, kept, added: doc.accepted.length - kept, dropped: existing ? existing.accepted.length - kept : 0 }) };
  }

  const review = reviewFindings(findings.diagnostics, { baseline: loadBaseline(baselineFile), previous, analysis: findings.analysis, files: [...facts.files, ...(findings.externalEvidence || [])].map((f) => f.path) });
  if (options['--new-only'] && review.comparison && (findings.analysis.external?.length || previous?.analysis?.external?.length) && review.comparison.comparable !== true) {
    fail('external/comparison-unverified', 'New-only gating requires comparable external reports.', { evidence: { reasons: review.comparison.reasons }, supportedFixes: ['provide matching tool versions, rule configuration, complete scan scope and source-bound reports', 'run a full check without --new-only to inspect the available diagnostics'] });
  }
  const run = { rules: findings.rules, suppressed: config.ignore || [], exclude: config.exclude || [], otherLanguages, boundaries: config.boundaries || null, duplicates: findings.analysis?.duplicates || null, external: findings.analysis?.external || [], review };
  const alignment = irDoc ? alignDiagram({ ir: irDoc, graph, map: mapDoc, facts, findings: findings.diagnostics, run }) : null;
  const fileModule = new Map(Object.entries(graph.fileModules || {}));
  const listed = alignment
    ? alignment.listed
    : findings.diagnostics.map((d) => ({ ...d, ...(review.findings[d.id] ? { review: review.findings[d.id] } : {}), moduleIds: findingModules(d, fileModule), componentIds: [] }));
  const overview = buildOverview({ findings: listed, graph, facts, unmapped: alignment ? alignment.unmapped : [], ambiguousModules: alignment ? alignment.ambiguousModules : [], run, diagram: Boolean(alignment) });

  if (out) {
    fs.mkdirSync(out, { recursive: true });
    for (const [name, doc] of [['raw-facts', facts], ['module-graph', graph], ['findings', findings], ['review', review], ['overview', overview]]) fs.writeFileSync(path.join(out, `${name}.json`), stableJson(doc));
  }

  const failOn = options['--fail-on'];
  const newOnly = Boolean(options['--new-only']);
  const failing = failOn === 'never' ? [] : findings.diagnostics.filter((d) => SEVERITY[d.severity] <= SEVERITY[failOn]
    && isOpen(review, d.id)
    // Without a comparison nothing can be shown to be old, so every open
    // finding counts as new: a missing artifact must not pass the gate.
    && (!newOnly || !review.comparison || review.findings[d.id]?.since === 'new'));
  const status = failing.length ? 'failed' : 'ok';
  return {
    exitCode: failing.length ? 1 : 0,
    receipt: receipt(status, {
      command: 'check', root, out,
      language: facts.repository.language, files: facts.files.length, rules: findings.rules,
      ...(findings.analysis?.duplicates ? { duplicates: findings.analysis.duplicates } : {}),
      verdict: overview.verdict, counts: overview.counts,
      ...(alignment ? {
        diagram: {
          components: alignment.components.length,
          mappedComponents: alignment.mapped,
          emptyComponents: alignment.components.filter((c) => !c.modules.length).map((c) => c.id),
          unmappedModules: overview.coverage.unmappedModules,
          ambiguousModules: alignment.ambiguousModules,
          offDiagramFindings: overview.counts.offDiagram,
          undeclaredEdges: alignment.undeclaredEdges.map((e) => ({
            from: e.from,
            to: e.to,
            weight: e.weight,
            sample: e.evidence?.[0] ? `${e.evidence[0].file}:${e.evidence[0].line}` : null,
          })),
        },
      } : {}),
      gate: { failOn, newOnly, ...(newOnly && !review.comparison ? { note: 'no previous run to compare with: every open finding counts as new' } : {}),
        // A first run, or a run after a rule became stricter, fails on findings that
        // already existed. Without a baseline, say how to record them once.
        ...(failing.length && !baselineFile ? { adopt: baselineCommand(CLI, root, { language: options['--language'] || null, config: options['--config'] || null }) } : {}), failing: failing.map((d) => ({ id: d.id, code: d.code, severity: d.severity, where: findingWhere(d), message: d.message })) },
      review: reviewSummary(review),
      comparisonReasons: review.comparison ? review.comparison.reasons : [],
      staleBaseline: review.baseline ? review.baseline.stale : [],
      priorities: overview.priorities,
      // How the open findings divide by rule. The overview groups keep every
      // id, including accepted ones; the receipt needs only open sizes, so they
      // agree with `counts` and a dominant rule is visible before choosing a lead.
      ruleCounts: openRuleCounts(overview.findings),
      // The same three leads as `priorities`, with message, location and a
      // ready-to-run task command attached. The data already exists in the
      // overview and the diagnostics; this only saves a manual join.
      investigation: {
        shell: process.platform === 'win32' ? 'cmd.exe' : 'POSIX sh',
        leads: overview.investigation.leads.map((lead) => ({ ...lead, task: taskCommand(CLI, lead.id, root, out) })),
        architecture: architectureBrief({ graph, findings: listed, overview, root, out, findingWhere }),
        drillDown: out
          ? taskCommand(CLI, '<id>', root, out)
          : 'Re-run with --out <dir> to drill down with the task command.',
      },
      // Already computed for the overview. Repeated here so a reader of the CLI
      // output sees a file that failed to parse, files excluded by role from the
      // module graph and rules, or files left out because a language was selected,
      // without opening the output directory. The gate below does not read it.
      coverage: {
        parseErrors: overview.coverage.files.parseErrors,
        ...(overview.coverage.files.excludedByRole ? {
          analyzedFiles: overview.coverage.files.analyzed,
          excludedByRole: overview.coverage.files.excludedByRole,
          excludedRoleCounts: countExcludedRoles(facts.files, graph.excluded?.roles),
        } : {}),
        ...(findings.analysis?.external?.length ? { external: findings.analysis.external } : {}),
        ...(facts.languageScope ? { languageScope: facts.languageScope } : {}),
        otherLanguages: overview.coverage.otherLanguages,
      },
    }),
  };
}

export { findingWhere as where } from '../overlay/overview.mjs';

function countExcludedRoles(files, excludedRoles = []) {
  const excluded = new Set(excludedRoles);
  const counts = {};
  for (const f of files || []) {
    if (excluded.has(f.role)) counts[f.role] = (counts[f.role] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function openRuleCounts(findings) {
  const byCode = new Map();
  for (const f of findings) {
    if (f.status === 'accepted') continue;
    const entry = byCode.get(f.code) || { code: f.code, severity: f.severity, count: 0 };
    entry.count += 1;
    if (SEVERITY[f.severity] < SEVERITY[entry.severity]) entry.severity = f.severity;
    byCode.set(f.code, entry);
  }
  return [...byCode.values()].sort((a, b) => SEVERITY[a.severity] - SEVERITY[b.severity] || b.count - a.count || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

const CLI = fileURLToPath(new URL('../../../bin/archify.mjs', import.meta.url));
const MAX_HOTSPOTS = 5;
const MAX_STRONGEST_EDGES = 5;
const MAX_STRUCTURAL_SIGNALS = 5;

function architectureBrief({ graph, findings, overview, root, out, findingWhere }) {
  const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const readingWeight = m => m.loc * (1 + Math.log2(1 + m.fanIn));
  const hotspots = [...(graph.modules || [])]
    .filter((m) => (m.fanIn + m.fanOut) > 0)
    .sort((a, b) => readingWeight(b) - readingWeight(a) || b.fanIn - a.fanIn || b.fanOut - a.fanOut || compareText(a.id, b.id))
    .slice(0, MAX_HOTSPOTS)
    .map((m) => ({
      id: m.id,
      path: m.path || null,
      files: m.files,
      loc: m.loc,
      fanIn: m.fanIn,
      fanOut: m.fanOut,
      instability: m.instability,
      entry: m.entry,
      readingWeight: Math.round(readingWeight(m) * 1000) / 1000,
    }));
  const strongestEdges = [...(graph.edges || [])]
    .sort((a, b) => b.weight - a.weight || compareText(a.from, b.from) || compareText(a.to, b.to))
    .slice(0, MAX_STRONGEST_EDGES)
    .map((e) => ({
      from: e.from,
      to: e.to,
      weight: e.weight,
      sample: e.evidence?.[0] ? `${e.evidence[0].file}:${e.evidence[0].line}` : null,
    }));
  const byId = new Map(findings.map((f) => [f.id, f]));
  const entryById = new Map(overview.findings.map((e) => [e.id, e]));
  const covered = new Set();
  for (const id of overview.priorities) {
    covered.add(id);
    for (const r of entryById.get(id)?.relatedIds || []) covered.add(r);
  }
  const candidates = overview.findings.filter((e) => {
    if (e.status === 'accepted' || covered.has(e.id)) return false;
    const d = byId.get(e.id);
    return Boolean(d && !d.external && (d.dimension === 'coupling' || d.dimension === 'architecture'));
  });
  const picked = [];
  const rulesTaken = new Set();
  const take = (e) => {
    picked.push(e);
    covered.add(e.id);
    for (const r of e.relatedIds || []) covered.add(r);
  };
  for (const e of candidates) {
    if (picked.length >= MAX_STRUCTURAL_SIGNALS) break;
    if (covered.has(e.id) || rulesTaken.has(e.code)) continue;
    rulesTaken.add(e.code);
    take(e);
  }
  for (const e of candidates) {
    if (picked.length >= MAX_STRUCTURAL_SIGNALS) break;
    if (!covered.has(e.id)) take(e);
  }
  return {
    modules: (graph.modules || []).length,
    edges: (graph.edges || []).length,
    hotspots,
    hotspotRanking: 'Connected modules ordered by loc * (1 + log2(1 + fanIn)), then fanIn, fanOut and id. A bounded reading order, not inferred business importance, defect severity or refactoring advice.',
    strongestEdges,
    structuralSignals: picked.map((e) => {
      const d = byId.get(e.id);
      return {
        id: e.id,
        code: d.code,
        severity: d.severity,
        message: d.message,
        where: findingWhere(d),
        impact: e.impact,
        task: taskCommand(CLI, e.id, root, out),
      };
    }),
  };
}

export function formatText(r) {
  if (r.action === 'accept-finding' || r.action === 'revoke-finding') return `${r.action === 'accept-finding' ? 'Accepted' : 'Revoked acceptance for'} ${r.id}\n  Baseline: ${r.baseline} (${r.entries} accepted entries)`;
  if (r.action === 'update-baseline') return `Baseline written: ${r.baseline}\n  ${r.entries} accepted findings (${r.kept} kept, ${r.added} added, ${r.dropped} no longer found and dropped)`;
  const lines = [];
  const c = r.counts;
  lines.push(`Code analysis: ${r.verdict} — ${c.findings} finding${c.findings === 1 ? '' : 's'} (${c.error} error, ${c.warning} warning, ${c.info} info open; ${c.accepted} accepted)`);
  if (c.acceptedErrors) lines.push(`  ${c.acceptedErrors} accepted error${c.acceptedErrors === 1 ? ' is' : 's are'} still present: the baseline keeps ${c.acceptedErrors === 1 ? 'it' : 'them'} from failing this run, the finding${c.acceptedErrors === 1 ? '' : 's'} remain${c.acceptedErrors === 1 ? 's' : ''}.`);
  lines.push(`  ${({ py: 'Python', ts: 'JS/TS', java: 'Java', go: 'Go', rust: 'Rust' })[r.language] || r.language} · ${r.files} files · rules: ${r.rules.join(', ')}`);
  if (r.coverage?.languageScope?.language === 'go') {
    const scope = r.coverage.languageScope;
    lines.push(`  Go module: ${scope.module} · ${scope.build.goos}/${scope.build.goarch} · cgo disabled · tests ${scope.build.tests ? 'included' : 'excluded'} · tags ${scope.build.tags.join(', ') || '(none)'}`);
    if (scope.standardLibrary) lines.push(`  SDK standard types: ${scope.standardLibrary.mode === 'disabled' ? 'disabled' : `${scope.standardLibrary.packages.length} compiler exports read; SDK source not analyzed`}`);
    lines.push(`  Not analyzed: ${scope.excludedFiles.length} excluded Go files; external types not loaded: ${scope.typing.externalPackagesNotLoaded.length}; source typing errors: ${scope.typing.errorCount}`);
    lines.push('  Source bindings only; read coverage.languageScope/raw-facts.json for exclusions and incomplete typing.');
  }
  if (r.coverage?.languageScope?.language === 'rust') {
    const scope = r.coverage.languageScope;
    lines.push(`  Rust: ${scope.crates.length} Cargo targets · ${scope.selectedFiles.length} source files · tests ${scope.build.tests ? 'included' : 'excluded'} · build scripts/proc macros disabled`);
    lines.push(`  Not analyzed: ${scope.excludedFiles.length} Rust files; opaque macros ${scope.opaqueMacros.length}; missing modules ${scope.missingModules.length}`);
    lines.push('  Source profile only; inspect coverage.languageScope for cfg/features, omissions and unknown dispatch.');
  }
  const uncovered = r.coverage || { parseErrors: [], otherLanguages: [] };
  if (uncovered.excludedByRole) {
    const breakdown = Object.entries(uncovered.excludedRoleCounts || {}).map(([role, count]) => `${count} ${formatTerminalText(role)}`).join(', ');
    lines.push(`  Graph/rule scope: ${uncovered.analyzedFiles} source file${uncovered.analyzedFiles === 1 ? '' : 's'} analyzed, ${uncovered.excludedByRole} excluded by role${breakdown ? ` (${breakdown})` : ''}`);
  }
  if (uncovered.parseErrors.length) lines.push(`  Not analyzed, parse failed: ${uncovered.parseErrors.map(formatTerminalText).join(', ')}`);
  if (uncovered.otherLanguages.length) lines.push(`  Not analyzed, other language: ${uncovered.otherLanguages.map((l) => `${l.files} ${l.adapter}`).join(', ')}`);
  for (const source of uncovered.external || []) {
    const coverage = source.coverage.complete === true ? 'complete' : source.coverage.complete === false ? 'incomplete' : 'unknown';
    const files = source.coverage.files.length;
    lines.push(`  External ${formatTerminalText(source.id)}: ${formatTerminalText(source.tool)} ${source.toolVersion ? formatTerminalText(source.toolVersion) : '(version unknown)'} · coverage ${coverage} (${files} declared file${files === 1 ? '' : 's'}) · source binding ${source.binding}`);
  }
  if (uncovered.external?.some((source) => source.coverage.complete !== true || source.status !== 'imported' || source.binding !== 'verified')) lines.push('  Empty external reports with incomplete coverage or unverified/changed source binding do not establish a clean scan.');
  if (r.duplicates) {
    const { engine, coverage } = r.duplicates;
    lines.push(`  Duplicate detection: ${engine.name} ${engine.version} · ${coverage.analyzed.length}/${coverage.selected.length} selected files analyzed${coverage.complete ? '' : ' · incomplete coverage'}`);
    if (!coverage.complete) lines.push('  Duplicate detection did not cover every selected file. Empty findings do not mean the full scope was checked; see duplicates.coverage in --json.');
  }
  if (r.diagram) {
    lines.push(`  Diagram alignment: ${r.diagram.mappedComponents}/${r.diagram.components} components mapped · ${r.diagram.unmappedModules.length} unmapped module${r.diagram.unmappedModules.length === 1 ? '' : 's'} · ${r.diagram.offDiagramFindings} finding${r.diagram.offDiagramFindings === 1 ? '' : 's'} off diagram`);
    if (r.diagram.unmappedModules.length) lines.push(`    unmapped modules: ${r.diagram.unmappedModules.slice(0, 12).map(formatTerminalText).join(', ')}${r.diagram.unmappedModules.length > 12 ? ` (+${r.diagram.unmappedModules.length - 12} more)` : ''}`);
    if (r.diagram.ambiguousModules?.length) lines.push(`    ambiguous component mapping: ${r.diagram.ambiguousModules.map((m) => `${formatTerminalText(m.id)} (${m.components.map(formatTerminalText).join(', ')})`).join('; ')}. Imports involving these modules retain module-level evidence.`);
    if (r.diagram.undeclaredEdges.length) lines.push(`    undeclared component imports: ${r.diagram.undeclaredEdges.slice(0, 8).map((e) => `${formatTerminalText(e.from)} -> ${formatTerminalText(e.to)} (${e.weight})`).join(', ')}${r.diagram.undeclaredEdges.length > 8 ? ` (+${r.diagram.undeclaredEdges.length - 8} more)` : ''}`);
  }
  if (r.investigation?.leads?.length) {
    lines.push(`Start here: ${r.investigation.leads.length} ranked lead${r.investigation.leads.length === 1 ? '' : 's'}. Each is static evidence, not a proven defect; read the cited source first.`);
    r.investigation.leads.forEach((lead, i) => lines.push(`  ${i + 1}. ${lead.severity.padEnd(7)} ${lead.code}  ${lead.where ?? lead.id}  [${lead.id}]`));
    if (r.investigation.architecture?.structuralSignals?.length) {
      lines.push('  Architecture signals (outside top leads):');
      for (const sig of r.investigation.architecture.structuralSignals) {
        lines.push(`    - ${sig.severity.padEnd(7)} ${sig.code}  ${formatTerminalText(sig.where ?? sig.id)}  [${sig.id}]`);
      }
    }
    if (r.investigation.drillDown) lines.push(`  Drill down (${r.investigation.shell}): ${r.investigation.drillDown}`);
  }
  if (r.review.comparison) {
    const c = r.review.comparison;
    lines.push(`  Since the previous run: ${c.new} new, ${c.notDetected} no longer detected, ${c.evidenceChanged} with changed evidence`);
    if (c.comparable === false) lines.push(`  Not directly comparable: ${r.comparisonReasons.map((x) => x.message).join(' ')} "No longer detected" does not mean fixed.`);
    else if (c.comparable === null) lines.push('  Comparability unknown: the previous run recorded no analysis context. "No longer detected" does not mean fixed.');
  }
  if (r.review.baseline) lines.push(`  Baseline: ${r.review.baseline.accepted} accepted, ${r.review.baseline.changed} changed since accepted, ${r.review.baseline.stale} stale entr${r.review.baseline.stale === 1 ? 'y' : 'ies'}`);
  for (const s of r.staleBaseline) lines.push(`    stale: ${s.id} (${s.code}) no longer found — remove it from the baseline`);
  if (r.gate.note) lines.push(`  Note: ${r.gate.note}`);
  if (r.status === 'failed') {
    lines.push(`FAILED: ${r.gate.failing.length} open finding${r.gate.failing.length === 1 ? '' : 's'} at or above ${r.gate.failOn}${r.gate.newOnly ? ' (new only)' : ''}:`);
    for (const f of r.gate.failing.slice(0, 20)) lines.push(`  ${f.severity.padEnd(7)} ${f.code}  ${f.where}  [${f.id}]`);
    if (r.gate.failing.length > 20) lines.push(`  … ${r.gate.failing.length - 20} more (use --json for all)`);
    if (r.gate.adopt) {
      lines.push('  First run, or a rule became stricter? To record what exists now and fail only on new findings, run once and commit the file:');
      lines.push(`    ${r.gate.adopt}`);
      lines.push('  Then pass --baseline analysis-baseline.json on every run. Accepted errors stay listed as still to fix.');
    }
  } else lines.push(`PASSED: no open finding at or above ${r.gate.failOn}${r.gate.newOnly ? ' among new findings' : ''}.`);
  return lines.join('\n');
}

function formatTerminalText(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) => `\\u${character.codePointAt(0).toString(16).padStart(4, '0')}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  if (!args.length || args[0] === '--help' || args[0] === '-h') console.log(USAGE);
  else {
    runCheck(args).then(({ exitCode, receipt: r }) => {
      console.log(json ? JSON.stringify(r, null, 2) : formatText(r));
      process.exitCode = exitCode;
    }).catch((error) => {
      const diagnostics = error instanceof DiagnosticError ? error.diagnostics : [{ code: 'internal/unclassified', severity: 'error', message: error.message, subject: {}, evidence: {}, supportedFixes: [] }];
      if (json) console.log(JSON.stringify(receipt('error', { command: 'check', diagnostics }), null, 2));
      else console.error(diagnostics.map((d) => `[${d.code}] ${d.message}`).join('\n'));
      process.exitCode = 2;
    });
  }
}
