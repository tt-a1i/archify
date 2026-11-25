#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { DiagnosticError, fail, receipt } from '../core/index.mjs';
import { loadPrevious, readJsonInput } from '../lib/analysis.mjs';
import { reviewFindings } from '../lib/review.mjs';
import { verificationContext } from '../lib/verification-context.mjs';
import { evaluateVerification } from '../lib/verification.mjs';

const usage = 'Usage: archify code-analysis verify-change <analysis-dir> --task <task.json> [--checks <checks.json> | --checks-template]';
const INPUT_BYTES = 2 * 1024 * 1024;
const originalTask = 'export the task again from the matching earlier analysis';
const checksTemplate = 'generate a new checks template for the same task and analysis pair';
const reanalyze = 'run analysis again in the same output directory and keep both captures';
const verificationFailures = {
  'no-comparison': ['analysis', 'No usable before and after analysis captures were found.', reanalyze],
  'invalid-task': ['task', 'The task does not have the expected format.', originalTask],
  'wrong-task-snapshot': ['task', 'The task does not match the previous analysis.', originalTask],
  'wrong-task-findings': ['task', 'The selected findings do not match the previous analysis.', originalTask],
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

async function run([dir, ...args]) {
  if (!dir || dir === '--help' || dir === '-h') { console.log(usage); return; }
  const invalidUsage = () => fail('cli/usage', usage, { supportedFixes: ['pass an analysis directory and --task, with either --checks or --checks-template if needed'] });
  const options = new Map();
  while (args.length) {
    const key = args.shift();
    if (options.has(key) || !['--task', '--checks', '--checks-template'].includes(key)) invalidUsage();
    const value = key === '--checks-template' ? true : args.shift();
    if (!value || (typeof value === 'string' && value.startsWith('--'))) invalidUsage();
    options.set(key, value);
  }
  if (!options.has('--task') || (options.has('--checks') && options.has('--checks-template'))) invalidUsage();
  const current = loadPrevious(path.join(dir, 'findings.json'));
  const previous = loadPrevious(path.join(dir, '..', 'analysis.previous', 'findings.json'));
  const facts = current && previous && readJsonInput(path.join(dir, 'raw-facts.json'), 'verify-change');
  const review = facts && reviewFindings(current.diagnostics, {
    previous, analysis: current.analysis,
    files: [...facts.files, ...(current.externalEvidence || [])].map((f) => f.path),
  });
  const result = await evaluateVerification(verificationContext(previous, current, review), readInput(options.get('--task'), 'task'),
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
