#!/usr/bin/env node
import { DiagnosticError, fail, receipt } from '../core/index.mjs';
import { driftReportMaxBytes, readDriftInput } from '../lib/drift-input.mjs';
import { verifyDriftTask } from '../lib/drift-verification.mjs';

const usage = 'Usage: archify code-analysis verify-drift <original-drift.json> --task <task.json> --after <follow-up-drift.json> [--checks <checks.json> | --checks-template]';

function run([file, ...args]) {
  if (!file || file === '--help' || file === '-h') { console.log(usage); return; }
  const invalid = () => fail('drift-verification/usage', usage);
  const options = new Map();
  if (file.startsWith('-')) invalid();
  while (args.length) {
    const key = args.shift();
    if (options.has(key) || !['--task', '--after', '--checks', '--checks-template'].includes(key)) invalid();
    const value = key === '--checks-template' || args.shift();
    if (!value || (typeof value === 'string' && value.startsWith('--'))) invalid();
    options.set(key, value);
  }
  if (!options.has('--task') || !options.has('--after') || (options.has('--checks') && options.has('--checks-template'))) invalid();
  const result = verifyDriftTask(readDriftInput(file, 'original', driftReportMaxBytes), readDriftInput(options.get('--after'), 'follow-up', driftReportMaxBytes),
    readDriftInput(options.get('--task'), 'task').doc, options.has('--checks') ? readDriftInput(options.get('--checks'), 'checks').doc : undefined);
  console.log(JSON.stringify(options.has('--checks-template') ? result.checksTemplate : result.receipt, null, 2));
}

try { run(process.argv.slice(2)); }
catch (error) {
  const diagnostics = error instanceof DiagnosticError ? error.diagnostics : [{
    code: 'drift-verification/failed', severity: 'error', message: 'Could not verify the saved drift reports and task.',
    subject: {}, evidence: {}, supportedFixes: ['use the original task and saved drift reports'],
  }];
  console.log(JSON.stringify(receipt('error', { command: 'verify-drift', diagnostics }), null, 2));
  process.exitCode = 2;
}
