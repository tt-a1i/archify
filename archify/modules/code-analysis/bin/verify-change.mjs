#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadPrevious, readJsonInput } from '../lib/analysis.mjs';
import { reviewFindings } from '../lib/review.mjs';
import { verificationContext } from '../lib/verification-context.mjs';
import { evaluateVerification } from '../lib/verification.mjs';

const usage = 'Usage: archify code-analysis verify-change <analysis-dir> --task <task.json> [--checks <checks.json> | --checks-template]';
const INPUT_BYTES = 2 * 1024 * 1024;

function readInput(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd);
    if (!size.isFile() || size.size > INPUT_BYTES) throw new Error('Expected a JSON file up to 2 MiB.');
    const bytes = Buffer.alloc(size.size + 1);
    const count = fs.readSync(fd, bytes, 0, bytes.length);
    if (count !== size.size) throw new Error('Input changed while reading.');
    return JSON.parse(bytes.toString('utf8', 0, count));
  } finally { fs.closeSync(fd); }
}

function run([dir, ...args]) {
  if (!dir || dir === '--help' || dir === '-h') { console.log(usage); return; }
  const options = new Map();
  while (args.length) {
    const key = args.shift();
    if (options.has(key) || !['--task', '--checks', '--checks-template'].includes(key)) throw new Error(usage);
    const value = key === '--checks-template' ? true : args.shift();
    if (!value || (typeof value === 'string' && value.startsWith('--'))) throw new Error(usage);
    options.set(key, value);
  }
  if (!options.has('--task') || (options.has('--checks') && options.has('--checks-template'))) throw new Error(usage);
  const current = loadPrevious(path.join(dir, 'findings.json'));
  const previous = loadPrevious(path.join(dir, '..', 'analysis.previous', 'findings.json'));
  const facts = current && previous && readJsonInput(path.join(dir, 'raw-facts.json'), 'verify-change');
  const review = facts && reviewFindings(current.diagnostics, {
    previous, analysis: current.analysis,
    files: [...facts.files, ...(current.externalEvidence || [])].map((f) => f.path),
  });
  const result = evaluateVerification(verificationContext(previous, current, review), readInput(options.get('--task')),
    options.has('--checks') ? readInput(options.get('--checks')) : undefined);
  if (result.error) throw new Error(result.error);
  console.log(JSON.stringify(options.has('--checks-template') ? result.checksTemplate : result.receipt, null, 2));
}

try { run(process.argv.slice(2)); }
catch (error) { console.error('verify-change: ' + error.message); process.exitCode = 2; }
