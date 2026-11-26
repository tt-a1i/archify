#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DiagnosticError, fail, receipt } from '../core/index.mjs';
import { loadPrevious, readJsonInput } from '../lib/analysis.mjs';
import { matchingPreviousPullRequest, sameVerificationRepository, verificationContexts } from '../lib/verification-history.mjs';
import { evaluateVerification } from '../lib/verification.mjs';
import { schemaErrors } from '../schemas/index.mjs';

const usage = 'Usage: archify code-analysis verify-change <analysis-dir> --task <task.json> [--checks <checks.json> | --checks-template] [--unverified-baseline <findings.json>]';
const INPUT_BYTES = 2 * 1024 * 1024;
const originalTask = 'export the task again from the matching earlier analysis';
const checksTemplate = 'generate a new checks template for the same task and analysis pair';
const reanalyze = 'run analysis again in the same output directory and keep both captures';
const verificationFailures = {
  'no-comparison': ['analysis', 'No usable before and after analysis captures were found.', reanalyze],
  'invalid-task': ['task', 'The task does not have the expected format.', originalTask],
  'wrong-task-snapshot': ['task', 'The task does not match a retained analysis capture.', originalTask],
  'wrong-task-findings': ['task', 'The selected findings do not match the task baseline.', originalTask],
  'wrong-task-id': ['task', 'The task ID does not match the selected findings.', originalTask],
  'invalid-checks': ['checks', 'The project check results do not have the expected format.', checksTemplate],
  'wrong-checks-snapshot': ['checks', 'The project check results do not match this task and analysis pair.', checksTemplate],
};

function readInput(file, input) {
  const guidance = { subject: { input }, supportedFixes: [input === 'task' ? originalTask : checksTemplate] };
  const invalid = (message) => fail('cli/input-invalid', message, guidance);
  let json;
  try {
    if (!fs.statSync(file).isFile()) invalid('Select a JSON file.');
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    try {
      const stats = fs.fstatSync(fd);
      if (!stats.isFile() || stats.size > INPUT_BYTES) invalid('Select a JSON file up to 2 MiB.');
      const bytes = Buffer.alloc(stats.size + 1);
      const count = fs.readSync(fd, bytes, 0, bytes.length);
      if (count !== stats.size) invalid('The input changed while reading.');
      json = bytes.toString('utf8', 0, count);
    } finally { fs.closeSync(fd); }
  } catch (error) {
    if (error instanceof DiagnosticError) throw error;
    invalid('Could not read the selected JSON file.');
  }
  try { return JSON.parse(json); }
  catch { fail('cli/input-not-json', 'The selected file is not valid JSON.', guidance); }
}

function readUnverifiedBaseline(file) {
  const invalid = () => fail('cli/input-invalid', 'Select a valid findings.json file up to 64 MiB.', {
    subject: { option: '--unverified-baseline' }, supportedFixes: ['pass a saved findings.json from the earlier analysis'],
  });
  try {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > 64 * 1024 * 1024) return invalid();
      const bytes = Buffer.alloc(stat.size + 1);
      if (fs.readSync(fd, bytes, 0, bytes.length) !== stat.size) return invalid();
      const doc = JSON.parse(bytes.toString('utf8', 0, stat.size));
      if (schemaErrors('findings', doc).length || (doc.repository.sourceKind ?? 'working-tree') !== 'working-tree') return invalid();
      return doc;
    } finally { fs.closeSync(fd); }
  } catch (error) {
    if (error instanceof DiagnosticError) throw error;
    return invalid();
  }
}

async function run([dir, ...args]) {
  if (!dir || dir === '--help' || dir === '-h') { console.log(usage); return; }
  const invalidUsage = () => fail('cli/usage', usage, { supportedFixes: ['pass an analysis directory and --task, with either --checks or --checks-template if needed'] });
  const options = new Map();
  while (args.length) {
    const key = args.shift();
    if (options.has(key) || !['--task', '--checks', '--checks-template', '--unverified-baseline'].includes(key)) invalidUsage();
    const value = key === '--checks-template' ? true : args.shift();
    if (!value || (typeof value === 'string' && value.startsWith('--'))) invalidUsage();
    options.set(key, value);
  }
  if (!options.has('--task') || (options.has('--checks') && options.has('--checks-template'))) invalidUsage();
  const current = loadPrevious(path.join(dir, 'findings.json'));
  const contextPath = path.join(dir, 'view-context.json');
  const context = fs.existsSync(contextPath) ? readJsonInput(contextPath, 'verify-change') : null;
  const pinned = Boolean(context?.run?.pullRequest);
  if (options.has('--unverified-baseline') && (pinned || (current?.repository?.sourceKind ?? 'working-tree') !== 'working-tree')) invalidUsage();
  const previousDir = path.join(dir, '..', 'analysis.previous');
  const previous = pinned ? loadPrevious(path.join(dir, 'base/findings.json'))
    : sameVerificationRepository(dir, previousDir) ? loadPrevious(path.join(previousDir, 'findings.json')) : null;
  const facts = current && readJsonInput(path.join(dir, 'raw-facts.json'), 'verify-change');
  const previousHead = pinned && matchingPreviousPullRequest(previousDir, current, context.run.pullRequest);
  let contexts = options.has('--unverified-baseline')
    ? verificationContexts(dir, readUnverifiedBaseline(options.get('--unverified-baseline')), current, facts, [])
    : verificationContexts(dir, previous, current, facts, pinned ? [previousHead] : undefined);
  if (options.has('--unverified-baseline') && contexts) contexts = contexts.map((capture) => ({
    ...capture, comparable: false, reasons: [...capture.reasons, 'legacy-owner-unverified'], newCount: null,
  }));
  const result = await evaluateVerification(contexts, readInput(options.get('--task'), 'task'),
    options.has('--checks') ? readInput(options.get('--checks'), 'checks') : undefined);
  if (result.error) {
    const [input, message, fix] = verificationFailures[result.error];
    fail('verification/' + result.error, message, { subject: { input }, supportedFixes: [fix] });
  }
  console.log(JSON.stringify(options.has('--checks-template') ? result.checksTemplate : result.receipt, null, 2));
}

try { await run(process.argv.slice(2)); }
catch (error) {
  const diagnostics = error instanceof DiagnosticError ? error.diagnostics : [{
    code: 'verification/failed', severity: 'error', message: 'Could not verify the saved analysis and inputs.',
    subject: { input: 'analysis' }, evidence: {}, supportedFixes: [reanalyze],
  }];
  console.log(JSON.stringify(receipt('error', { command: 'verify-change', diagnostics }), null, 2));
  process.exitCode = 2;
}
