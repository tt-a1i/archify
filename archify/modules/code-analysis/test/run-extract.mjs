// Test harness only: runs the extraction stage in a child process and prints
// either the raw facts (or a receipt with --json) or a structured failure.
// Usage: node test/run-extract.mjs <root> [--language ts|py] [--config f] [--out f] [--json]
import fs from 'node:fs';
import path from 'node:path';
import { extractFacts, stableJson } from '../lib/analysis.mjs';
import { DiagnosticError, fail, receipt } from '../extract/shared/diagnostics.mjs';

const args = process.argv.slice(2);
const opts = { json: false, positional: [] };
try {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--language' || arg === '--config' || arg === '--out') { opts[arg.slice(2)] = args[i + 1]; i += 1; }
    else if (arg.startsWith('--')) fail('cli/option-unknown', `Unknown option ${arg}.`, { subject: { option: arg } });
    else opts.positional.push(arg);
  }
  const { adapter, facts } = extractFacts(opts.positional[0], { language: opts.language || null, config: opts.config || null });
  const text = stableJson(facts);
  if (opts.out) { fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true }); fs.writeFileSync(opts.out, text); }
  if (opts.json) process.stdout.write(stableJson(receipt('ok', { adapter, out: opts.out ? path.resolve(opts.out) : null, files: facts.files.length, imports: facts.imports.length, unresolved: facts.unresolved, revision: facts.repository.revision })));
  else if (!opts.out) process.stdout.write(text);
} catch (error) {
  const diagnostics = error instanceof DiagnosticError ? error.diagnostics : [{ code: 'internal/unclassified', severity: 'error', message: error.message, subject: {}, evidence: {}, supportedFixes: [] }];
  process.stdout.write(stableJson(receipt('failed', { diagnostics })));
  process.exitCode = 1;
}
