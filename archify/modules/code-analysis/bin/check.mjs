#!/usr/bin/env node
// Headless code analysis for terminals and CI: extract → graphs → evaluate,
// with the baseline and the comparison, and an exit code a pipeline can gate on.
// No diagram is needed; component mapping is a page concern (see serve.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DiagnosticError, fail, receipt } from '../extract/shared/diagnostics.mjs';

export const USAGE = `Usage:
  archify code-analysis check <repo-root> [--language ts|py|java] [--config file.json]
                              [--baseline baseline.json] [--compare findings.json] [--out dir]
                              [--fail-on error|warning|info|never] [--new-only]
                              [--update-baseline] [--reason text] [--json]

Analyzes <repo-root> without a diagram and exits 1 when an open finding reaches
--fail-on (default: warning). Findings accepted in --baseline do not fail the run
unless their evidence changed since they were accepted. --new-only fails only on
findings that are new since --compare (or since the previous run in --out);
without a previous run to compare with, every open finding counts as new.
--update-baseline writes every current finding to --baseline (keeping existing
reasons; new entries get --reason) and exits 0.
Exit codes: 0 passed, 1 gate failed, 2 analysis or usage error.
Outputs with --out: raw-facts, module-graph, findings, review, overview (.json).`;

const VALUE_OPTIONS = ['--language', '--config', '--baseline', '--compare', '--out', '--fail-on', '--reason'];
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
  if (options['--update-baseline'] && !options['--baseline']) usage('--update-baseline needs --baseline <file> to write.');
  return { repo, options };
}

export async function runCheck(argv) {
  const { repo, options } = parseCheckArgs(argv);
  const { ensureDependencies } = await import('./serve.mjs');
  await ensureDependencies();
  const { extractFacts, buildGraph, evaluateGraph, loadBaseline, loadPrevious, stableJson, reviewSummary } = await import('../lib/analysis.mjs');
  const { reviewFindings, baselineFrom, isOpen } = await import('../lib/review.mjs');
  const { buildOverview } = await import('../overlay/overview.mjs');
  const { findingModules } = await import('../overlay/inject.mjs');

  const root = path.resolve(repo);
  const out = options['--out'] ? path.resolve(options['--out']) : null;
  const previousFile = options['--compare'] ? path.resolve(options['--compare']) : out ? path.join(out, 'findings.json') : null;
  if (options['--compare'] && !fs.existsSync(previousFile)) fail('cli/input-invalid', `Not a file: ${options['--compare']}`, { subject: { option: '--compare' }, supportedFixes: ['pass the findings.json of an earlier run'] });
  // An explicit --compare must be readable; the automatic one in --out is optional.
  const previous = loadPrevious(previousFile, { strict: Boolean(options['--compare']) });

  const { facts, config, otherLanguages } = extractFacts(root, { language: options['--language'] || null, config: options['--config'] || null });
  const graph = buildGraph(facts, config);
  const findings = evaluateGraph(graph, config, facts);
  const baselineFile = options['--baseline'] ? path.resolve(options['--baseline']) : null;

  if (options['--update-baseline']) {
    const existing = baselineFile && fs.existsSync(baselineFile) ? loadBaseline(baselineFile) : null;
    const doc = baselineFrom(findings.diagnostics, { existing, reason: options['--reason'] || 'Accepted as existing when the baseline was written; review before relying on it.' });
    fs.mkdirSync(path.dirname(baselineFile), { recursive: true });
    fs.writeFileSync(baselineFile, stableJson(doc));
    const kept = existing ? doc.accepted.filter((e) => existing.accepted.some((x) => x.id === e.id)).length : 0;
    return { exitCode: 0, receipt: receipt('ok', { command: 'check', action: 'update-baseline', baseline: baselineFile, entries: doc.accepted.length, kept, added: doc.accepted.length - kept, dropped: existing ? existing.accepted.length - kept : 0 }) };
  }

  const review = reviewFindings(findings.diagnostics, { baseline: loadBaseline(baselineFile), previous, analysis: findings.analysis, files: facts.files.map((f) => f.path) });
  const fileModule = new Map(Object.entries(graph.fileModules || {}));
  const listed = findings.diagnostics.map((d) => ({ ...d, ...(review.findings[d.id] ? { review: review.findings[d.id] } : {}), moduleIds: findingModules(d, fileModule), componentIds: [] }));
  const overview = buildOverview({ findings: listed, graph, facts, run: { rules: findings.rules, suppressed: config.ignore || [], exclude: config.exclude || [], otherLanguages, boundaries: config.boundaries || null, review } });

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
      verdict: overview.verdict, counts: overview.counts,
      gate: { failOn, newOnly, ...(newOnly && !review.comparison ? { note: 'no previous run to compare with: every open finding counts as new' } : {}), failing: failing.map((d) => ({ id: d.id, code: d.code, severity: d.severity, where: where(d), message: d.message })) },
      review: reviewSummary(review),
      comparisonReasons: review.comparison ? review.comparison.reasons : [],
      staleBaseline: review.baseline ? review.baseline.stale : [],
      priorities: overview.priorities,
    }),
  };
}

// The most useful single location for a finding, as path:line when known.
export function where(d) {
  const s = d.subject || {};
  if (s.file) return s.line ? `${s.file}:${s.line}` : s.file;
  const first = d.evidence?.imports?.[0];
  if (first) return `${first.file}:${first.line}`;
  if (Array.isArray(s.files) && s.files.length) return s.files[0];
  if (s.module) return `module ${s.module}`;
  if (Array.isArray(s.modules)) return `modules ${s.modules.join(', ')}`;
  return d.code;
}

export function formatText(r) {
  if (r.action === 'update-baseline') return `Baseline written: ${r.baseline}\n  ${r.entries} accepted findings (${r.kept} kept, ${r.added} added, ${r.dropped} no longer found and dropped)`;
  const lines = [];
  const c = r.counts;
  lines.push(`Code analysis: ${r.verdict} — ${c.findings} finding${c.findings === 1 ? '' : 's'} (${c.error} error, ${c.warning} warning, ${c.info} info open; ${c.accepted} accepted)`);
  lines.push(`  ${({ py: 'Python', ts: 'JS/TS', java: 'Java' })[r.language] || r.language} · ${r.files} files · rules: ${r.rules.join(', ')}`);
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
  } else lines.push(`PASSED: no open finding at or above ${r.gate.failOn}${r.gate.newOnly ? ' among new findings' : ''}.`);
  return lines.join('\n');
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
