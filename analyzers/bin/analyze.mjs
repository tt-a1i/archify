#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectAdapter } from '../extract/index.mjs';
import { DiagnosticError, fail, receipt } from '../extract/shared/diagnostics.mjs';
import { schemaErrors } from '../extract/shared/schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const USAGE = `Usage:
  archify-analyze extract <repo-root> [--out file.json] [--config file.json] [--language ts] [--json]

M1 implements only "extract". Later steps: graphs, evaluate, report, bridge.`;

function loadConfig(explicit) {
  const defaults = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'config', 'defaults.json'), 'utf8'));
  if (!explicit) return defaults;
  if (!fs.existsSync(explicit)) fail('cli/config-missing', `Config file not found: ${explicit}`, {
    subject: { option: '--config' }, evidence: { path: explicit }, supportedFixes: ['pass an existing JSON file'],
  });
  return { ...defaults, ...JSON.parse(fs.readFileSync(explicit, 'utf8')) };
}

function parse(argv) {
  const [command, ...rest] = argv;
  const opts = { json: false, positional: [] };
  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--out' || arg === '--config' || arg === '--language') {
      const value = rest[i + 1];
      if (!value || value.startsWith('--')) fail('cli/option-value-missing', `${arg} requires a value.`, {
        subject: { option: arg }, supportedFixes: [`provide one value after ${arg}`],
      });
      opts[arg.slice(2)] = value; i += 1;
    } else if (arg.startsWith('--')) fail('cli/option-unknown', `Unknown option ${arg}.`, {
      subject: { option: arg }, supportedFixes: ['see usage'],
    });
    else opts.positional.push(arg);
  }
  return { command, opts };
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function runExtract(opts) {
  const root = opts.positional[0];
  if (!root) fail('cli/root-missing', 'extract requires a <repo-root> argument.', { supportedFixes: ['pass a directory path'] });
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) fail('cli/root-invalid', `Not a directory: ${root}`, {
    subject: { root }, supportedFixes: ['pass an existing directory'],
  });
  const config = loadConfig(opts.config);
  const adapter = selectAdapter(root, config, opts.language);
  const facts = adapter.extract(root, config);
  const errors = schemaErrors('raw-facts', facts);
  if (errors.length) fail('extract/schema-invalid', 'Extractor output violates raw-facts.schema.json.', {
    subject: { adapter: adapter.id }, evidence: { errors: errors.slice(0, 20) }, supportedFixes: ['this is an analyzer bug; report it with the evidence'],
  });
  const text = stableJson(facts);
  if (opts.out) { fs.mkdirSync(path.dirname(path.resolve(opts.out)), { recursive: true }); fs.writeFileSync(opts.out, text); }
  else if (!opts.json) process.stdout.write(text);
  return receipt('ok', {
    command: 'extract',
    adapter: adapter.id,
    out: opts.out ? path.resolve(opts.out) : null,
    files: facts.files.length,
    imports: facts.imports.length,
    resolved: facts.imports.filter((i) => i.resolved).length,
    unresolved: facts.unresolved,
    revision: facts.repository.revision,
  });
}

function main() {
  const { command, opts } = parse(process.argv.slice(2));
  if (!command || command === '--help' || command === '-h') { process.stdout.write(`${USAGE}\n`); return; }
  if (command !== 'extract') fail('cli/command-unknown', `Unknown command "${command}".`, {
    subject: { command }, evidence: { supported: ['extract'] }, supportedFixes: ['see usage'],
  });
  const result = runExtract(opts);
  if (opts.json) process.stdout.write(stableJson(result));
  else if (opts.out) process.stderr.write(`extract ok: ${result.files} files, ${result.imports} imports (${result.resolved} resolved) → ${result.out}\n`);
}

try {
  main();
} catch (error) {
  const diagnostics = error instanceof DiagnosticError
    ? error.diagnostics
    : [{ code: 'internal/unclassified', severity: 'error', message: error.message, subject: {}, evidence: {}, supportedFixes: [] }];
  const wantsJson = process.argv.includes('--json');
  if (wantsJson) process.stdout.write(stableJson(receipt('failed', { diagnostics })));
  else for (const d of diagnostics) process.stderr.write(`${d.code}: ${d.message}\n${d.supportedFixes.length ? `  fixes: ${d.supportedFixes.join('; ')}\n` : ''}`);
  process.exitCode = 1;
}
