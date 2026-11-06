#!/usr/bin/env node
// AI optimization tasks from a finished analysis, for terminals and agents.
//   create: findings of one run → a task (JSON or Markdown), optionally checked
//           against the current working tree
//   verify: an exported task → the same task with its evidence status refreshed
// The task logic is lib/task.mjs and lib/evidence.mjs; the page and the server
// use the same functions, so every entry point produces the same task.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DiagnosticError, fail, receipt } from '../extract/shared/diagnostics.mjs';

export const USAGE = `Usage:
  archify code-analysis task <analysis-dir> --finding <id> [--finding <id> …]
                             [--root <repo-root>] [--command <cmd> …]
                             [--format md|json] [--out <file>] [--require-valid]
  archify code-analysis task [<analysis-dir>] --question <text> --entry <file>
                             --root <repo-root> [--function <name>] [--format md|json] [--out file]
  archify code-analysis task --question <text> --base-root <base> --root <head>
                             --entry <file> [--config file.json] [--format md|json] [--out file]
  archify code-analysis task --verify <task.json> --root <repo-root>
                             [--format md|json] [--out <file>] [--require-valid]

<analysis-dir> is a directory with findings.json and raw-facts.json of one run
(the analysis/ folder written by serve, or --out of check). The task contains
the findings, their code locations and captured excerpts, what to keep, when it
is done, and what is still to confirm. With --root the cited code is compared
with the current working tree (valid, changed, missing, unverifiable);
without it the task is marked as captured, not checked.
--command adds a verification command you know is right for the project
(repeatable); none is guessed. --require-valid exits 1 unless the evidence is valid.
Question mode prepares source orientation for the host Agent workflow, not a completed
analysis. It needs no finding. Missing facts remain explicit; changed/unverifiable
entry facts or entry parse errors exit 1. Read docs/FUNCTION-ANALYSIS.md and complete the analysis.
With --base-root, question mode freshly captures both JS/TS roots with one analysis
config (defaults or --config). It requires --entry and accepts no analysis directory
or --function. Captured declaration entries disclose unsupported definition analysis.
Partial source/configuration coverage exits 1. Lists report total/included/omitted;
ready is usable orientation, not complete impact or zero omissions. Dependencies
must already be installed; this mode reads sources only. Paired --out must be
outside both source roots. No saved raw-facts directory is produced.
Output: Markdown by default, the JSON task with --format json; to --out or stdout.
--json prints a machine-readable receipt instead of the task (use with --out).
Exit codes: 0 prepared/written, 1 incomplete question orientation or invalid evidence
with --require-valid, 2 usage or input error.`;

const VALUE = ['--finding', '--root', '--command', '--format', '--out', '--verify', '--question', '--entry', '--function', '--base-root', '--config'];
const FLAGS = ['--require-valid', '--json'];
const REPEATABLE = ['--finding', '--command'];

export function parseTaskArgs(argv) {
  const usage = (message) => fail('cli/usage', `${message}\n${USAGE}`, { supportedFixes: ['see the usage above'] });
  const options = { '--finding': [], '--command': [], '--format': 'md' };
  let dir = null;
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) { if (dir) usage(`Unexpected argument: ${key}`); dir = key; continue; }
    if (FLAGS.includes(key)) { options[key] = true; continue; }
    if (!VALUE.includes(key) || argv[i + 1] === undefined || argv[i + 1].startsWith('--')) usage(`Invalid option: ${key}`);
    if (REPEATABLE.includes(key)) options[key].push(argv[i + 1]); else options[key] = argv[i + 1];
    i += 1;
  }
  if (!['md', 'json'].includes(options['--format'])) usage(`--format must be md or json (got ${options['--format']}).`);
  if (options['--question'] !== undefined) {
    if (!options['--root'] || !options['--entry']) usage('--question needs --root and --entry.');
    if (options['--verify'] || options['--finding'].length || options['--command'].length || options['--require-valid']) usage('Question mode is separate from finding/verify/command/require-valid options.');
  } else if (options['--entry'] || options['--function']) {
    usage('--entry and --function require --question.');
  } else if (options['--verify']) {
    if (dir || options['--finding'].length) usage('--verify takes a task file, not an analysis directory or --finding.');
    if (!options['--root']) usage('--verify needs --root <repo-root> to compare with.');
  } else {
    if (!dir) usage('task requires an <analysis-dir> (or --verify <task.json>).');
    if (!options['--finding'].length) usage('task requires at least one --finding <id>.');
  }
  if (options['--base-root'] && (options['--question'] === undefined || dir || options['--function'])) usage('--base-root needs --question and does not accept an analysis directory or --function.');
  if (options['--config'] && !options['--base-root']) usage('--config is supported only for fresh paired questions with --base-root.');
  if (options['--require-valid'] && !options['--root']) usage('--require-valid needs --root to check against.');
  return { dir, options };
}

export async function runTask(argv, { now = new Date() } = {}) {
  const { dir, options } = parseTaskArgs(argv);
  if (options['--base-root']) return runChangeQuestion(options);
  const { ensureDependencies } = await import('./serve.mjs');
  await ensureDependencies();
  const { buildTask, renderTaskMarkdown, validateTask, readJson } = await import('../lib/task.mjs');
  const { verifyTask } = await import('../lib/evidence.mjs');
  const { stableJson } = await import('../lib/analysis.mjs');
  const root = options['--root'] ? path.resolve(options['--root']) : null;
  if (root && (!fs.existsSync(root) || !fs.statSync(root).isDirectory())) fail('cli/root-invalid', `Not a directory: ${options['--root']}`, { subject: { option: '--root' }, supportedFixes: ['pass the directory that was analyzed'] });

  if (options['--question'] !== undefined) {
    const { buildQuestion, renderQuestionMarkdown } = await import('../lib/explain.mjs');
    const file = dir ? path.join(path.resolve(dir), 'raw-facts.json') : null;
    const facts = file && fs.existsSync(file) ? readJson(file, 'raw-facts.json') : null;
    const brief = buildQuestion({ question: options['--question'], entry: options['--entry'], symbol: options['--function'], root, facts, factsPath: file });
    const body = options['--format'] === 'json' ? stableJson(brief) : renderQuestionMarkdown(brief);
    const out = options['--out'] ? path.resolve(options['--out']) : null;
    if (out) {
      const protectedPaths = [path.resolve(root, options['--entry']), file].filter(Boolean);
      const resolvedOut = fs.existsSync(out) ? fs.realpathSync(out) : out;
      if (protectedPaths.some((p) => (fs.existsSync(p) ? fs.realpathSync(p) : p) === resolvedOut)) fail('task/output-conflict', 'Question output must not replace its entry or raw facts.');
      fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, body);
    }
    const exitCode = brief.entry.factsStatus === 'valid' && !brief.entry.parseErrors.length ? 0 : 1;
    return { exitCode, body: out ? null : body, receipt: receipt(exitCode ? 'incomplete' : 'ok', { command: 'task', action: 'question', stage: brief.stage, evidence: brief.entry.factsStatus, parseErrors: brief.entry.parseErrors.length, calls: { coverage: brief.calls.coverage, reason: brief.calls.reason, model: brief.calls.provenance.callModel, total: brief.calls.total, included: brief.calls.included, omitted: brief.calls.omitted }, out, workflow: brief.workflow }) };
  }

  let task;
  if (options['--verify']) {
    const file = path.resolve(options['--verify']);
    if (!fs.existsSync(file)) fail('cli/input-invalid', `Not a file: ${options['--verify']}`, { subject: { option: '--verify' }, supportedFixes: ['pass an exported task JSON'] });
    task = validateTask(readJson(file, 'task'), file);
  } else {
    const analysis = path.resolve(dir);
    const need = (name) => {
      const file = path.join(analysis, name);
      if (!fs.existsSync(file)) fail('task/analysis-incomplete', `${name} is missing in ${dir}.`, { subject: { dir }, evidence: { missing: name }, supportedFixes: ['pass the analysis/ directory of a completed run', 'run `archify code-analysis check <repo> --out <dir>` first'] });
      return readJson(file, name);
    };
    const findings = need('findings.json');
    const facts = need('raw-facts.json');
    const reviewFile = path.join(analysis, 'review.json');
    const review = fs.existsSync(reviewFile) ? readJson(reviewFile, 'review.json') : null;
    task = buildTask({ findings, facts, ids: options['--finding'], review, commands: options['--command'].map((command) => ({ command, purpose: 'project check', source: 'provided with --command' })) });
  }
  if (root) task = verifyTask(task, root, { now });

  const body = options['--format'] === 'json' ? stableJson(task) : renderTaskMarkdown(task);
  const out = options['--out'] ? path.resolve(options['--out']) : null;
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, body); }
  const valid = task.evidence.status === 'valid';
  const exitCode = options['--require-valid'] && !valid ? 1 : 0;
  return {
    exitCode, body: out ? null : body,
    receipt: receipt(exitCode ? 'failed' : 'ok', { command: 'task', action: options['--verify'] ? 'verify' : 'create', taskId: task.taskId, findings: task.findings.map((f) => f.id), evidence: task.evidence.status, locations: task.locations.length, out, format: options['--format'] }),
  };
}

// Paired capture deliberately avoids ensureDependencies: this path never installs.
async function runChangeQuestion(options) {
  const root = path.resolve(options['--root']);
  const baseRoot = path.resolve(options['--base-root']);
  for (const [option, dir] of [['--root', root], ['--base-root', baseRoot]]) {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) fail('cli/root-invalid', `Not a directory: ${dir}`, { subject: { option } });
  }
  const out = options['--out'] ? path.resolve(options['--out']) : null;
  if (out) {
    // Resolve existing parents too, so a new file through a directory symlink
    // cannot overwrite either analyzed tree when the result is written.
    let existing = out;
    while (!fs.existsSync(existing)) existing = path.dirname(existing);
    const resolved = path.resolve(fs.realpathSync(existing), path.relative(existing, out));
    if (options['--config'] && fs.existsSync(options['--config']) && fs.realpathSync(options['--config']) === resolved) fail('task/output-conflict', 'Question output must not replace its analysis configuration.');
    for (const dir of [root, baseRoot]) {
      const rel = path.relative(fs.realpathSync(dir), resolved);
      if (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) fail('task/output-conflict', 'Paired question output must be outside both source roots.');
    }
  }
  let api;
  try { api = await import('../lib/change-question.mjs'); } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    fail('task/dependencies-missing', 'Paired question needs the Code Analysis dependencies already installed.', { supportedFixes: ['install dependencies explicitly in the Code Analysis module, then retry'] });
  }
  const brief = api.captureChangeQuestion({ question: options['--question'], entry: options['--entry'], baseRoot, root, configPath: options['--config'] });
  const body = options['--format'] === 'json' ? `${JSON.stringify(brief, null, 2)}\n` : api.renderChangeQuestionMarkdown(brief);
  if (out) { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, body); }
  const exitCode = brief.status === 'ready' ? 0 : 1;
  return { exitCode, body: out ? null : body, receipt: receipt(exitCode ? 'incomplete' : 'ok', {
    command: 'task', action: 'change-question', stage: brief.stage, evidence: brief.status, out, workflow: brief.workflow,
    snapshots: { base: brief.sides.base.snapshot.snapshotId, head: brief.sides.head.snapshot.snapshotId },
    definitionCoverage: brief.definitionCoverage,
    reasons: brief.comparison.reasons, meaning: 'Source orientation status; partial means capture/configuration limits, not a finding gate failure.',
  }) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  if (!args.length || args[0] === '--help' || args[0] === '-h') console.log(USAGE);
  else {
    runTask(args).then(({ exitCode, body, receipt: r }) => {
      if (json) console.log(JSON.stringify(r, null, 2));
      else if (body !== null) process.stdout.write(body);
      else if (r.action === 'change-question') console.error(`Change orientation written to ${r.out} (${r.evidence}${r.reasons.length ? `: ${r.reasons.map(reason => reason.code).join(', ')}` : ''}); partial means capture/configuration limits, not a finding gate failure. Complete ${r.workflow}.`);
      else if (r.action === 'question') console.error(`Question orientation written to ${r.out} (entry facts: ${r.evidence}); complete ${r.workflow}.`);
      else console.error(`Task ${r.taskId} written to ${r.out} (evidence: ${r.evidence}).`);
      process.exitCode = exitCode;
    }).catch((error) => {
      const diagnostics = error instanceof DiagnosticError ? error.diagnostics : [{ code: 'internal/unclassified', severity: 'error', message: error.message, subject: {}, evidence: {}, supportedFixes: [] }];
      if (json) console.log(JSON.stringify(receipt('error', { command: 'task', diagnostics }), null, 2));
      else console.error(diagnostics.map((d) => `[${d.code}] ${d.message}`).join('\n'));
      process.exitCode = 2;
    });
  }
}
