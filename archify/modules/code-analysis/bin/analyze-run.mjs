#!/usr/bin/env node
// One analysis run in its own process, so the server's event loop stays free
// while the repository is read. Reads the analyzeRepository options as JSON on
// stdin and writes one JSON line: the receipt, or { status: 'error', diagnostics }.
// Used by serve.mjs; not a command of its own.
import { analyzeRepository } from '../overlay/page.mjs';
import { DiagnosticError } from '../core/index.mjs';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const result = analyzeRepository(JSON.parse(input));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    const diagnostics = error instanceof DiagnosticError ? error.diagnostics
      : [{ code: 'internal/unclassified', severity: 'error', message: error.message, subject: {}, evidence: {}, supportedFixes: [] }];
    process.stdout.write(`${JSON.stringify({ status: 'error', diagnostics })}\n`);
    process.exitCode = 1;
  }
});
