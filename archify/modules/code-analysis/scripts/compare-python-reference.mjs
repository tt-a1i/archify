// Development-only comparison of a captured source tree with previously saved
// Pyright LSP definition results. Full Pyright is never loaded by this script.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { extractFacts } from '../lib/analysis.mjs';
import { analyzeFile } from '../extract/py/analyze.mjs';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i];
  if (!['--root', '--reference', '--baseline', '--oracle'].includes(key) || !process.argv[i + 1])
    throw new Error('Usage: node scripts/compare-python-reference.mjs --root SOURCE_TREE --reference PYRIGHT_JSON [--baseline OLD_FACTS_JSON] [--oracle MANUAL_ORACLE_JSON]');
  options[key.slice(2)] = process.argv[i + 1];
}
if (!options.root || !options.reference) throw new Error('--root and --reference are required');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const reference = read(options.reference);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const started = performance.now();
const facts = extractFacts(options.root, { language: 'py' }).facts;
const extractionMs = performance.now() - started;
const sources = new Map(facts.files.map(file => [file.path, file.sourceText]));
if (!Array.isArray(reference.inputs) || reference.inputs.filter(input => input.file.endsWith('.py')).length !== sources.size) throw new Error('Reference inventory differs from the current capture');
for (const input of reference.inputs) {
  const bytes = fs.readFileSync(path.join(options.root, input.file));
  if (input.file.endsWith('.py') && !sources.has(input.file) || sha(bytes) !== input.sha256) throw new Error(`Reference source changed: ${input.file}`);
}
// Reference points address name tokens; Archify targets address def/async def.
// Map exact name-token positions instead of comparing only same-spelled names.
const namePoints = new Map(), functionPoints = new Map();
for (const file of facts.files) {
  const parsed = analyzeFile(file.path, fs.readFileSync(path.join(options.root, file.path)));
  for (const [node, fn] of parsed.measured?.byNode || []) {
    const point = parsed.context.point(node.d.name.d.token.start);
    const identity = JSON.stringify([file.path, fn.qualname, fn.line, fn.sourceRange.column]);
    namePoints.set(JSON.stringify([file.path, point.line - 1, point.column - 1]), identity);
    functionPoints.set(JSON.stringify([file.path, fn.name, fn.line, fn.sourceRange.column]), { ...fn, file: file.path, identity });
  }
}
const targetOf = call => call.target && functionPoints.get(JSON.stringify([call.target.file || call.file, call.target.name, call.target.line, call.target.column]));
const callId = call => `${call.file}:${call.line}:${call.column - 1}:${call.endLine}:${call.endColumn - 1}`;
const rows = new Map(reference.runs[0].rows.map(row => [row.id, row]));
const disagreements = [], agreements = [], candidateRows = [];
for (const call of facts.calls) {
  const row = rows.get(callId(call));
  const targets = new Set((row?.definition || []).map(point => namePoints.get(JSON.stringify([point.file, point.range.start.line, point.range.start.character]))).filter(Boolean));
  if (targets.size) candidateRows.push({ id: callId(call), targets: targets.size });
  const target = targetOf(call);
  if (!target) continue;
  const item = { id: callId(call), file: target.file, qualname: target.qualname, resolution: call.resolution };
  if (targets.has(target.identity)) agreements.push(item); else disagreements.push(item);
}
let baseline = null;
if (options.baseline) {
  const old = read(options.baseline), oldTargets = old.calls.filter(call => call.target);
  if (old.files.length !== facts.files.length || old.files.some(file => sources.get(file.path) !== file.sourceText)) throw new Error('Baseline decoded sources differ');
  const current = new Map(facts.calls.map(call => [callId(call), call]));
  const changed = oldTargets.filter(call => {
    const now = current.get(callId(call));
    return !now?.target || JSON.stringify([call.target.file || call.file, call.target.name, call.target.line, call.target.column])
      !== JSON.stringify([now.target.file || now.file, now.target.name, now.target.line, now.target.column]);
  }).map(callId);
  const normalize = records => records.map(record => JSON.stringify(record)).sort();
  const kept = key => JSON.stringify(normalize(old[key])) === JSON.stringify(normalize(facts[key]));
  baseline = { adapter: old.repository.adapter, targets: oldTargets.length, changedTargets: changed,
    functionFactsIdentical: kept('functions'), importsIdentical: kept('imports'), symbolsIdentical: kept('symbols'), callInventoryIdentical: old.calls.length === facts.calls.length && old.calls.every(call => current.has(callId(call))) };
}
let manual = null;
if (options.oracle) {
  const oracle = read(options.oracle), calls = new Map(facts.calls.map(call => [callId(call), call]));
  const cases = Object.entries(oracle.sourceDeclarations).map(([id, expected]) => {
    const call = calls.get(id), actual = call && targetOf(call);
    return { id, expected: { file: expected.file, qualname: expected.qualname }, actual: actual ? { file: actual.file, qualname: actual.qualname } : null,
      matched: actual?.file === expected.file && actual?.qualname === expected.qualname };
  });
  manual = { scope: oracle.scope, total: cases.length, matched: cases.filter(item => item.matched).length, cases };
}
console.log(JSON.stringify({
  adapter: facts.repository.adapter, callModel: facts.callModel, reference: { version: reference.pyrightVersion, commit: reference.pyrightCommit, platform: reference.pythonPlatform },
  inputs: reference.inputs, files: facts.files.length, loc: facts.files.reduce((sum, file) => sum + file.loc, 0), functions: facts.functions.length, imports: facts.imports.length,
  calls: facts.calls.length, targets: facts.calls.filter(call => call.target).length, additionalSourceTargets: facts.calls.filter(call => call.resolution === 'python-source-declaration').length,
  referenceCandidateCalls: candidateRows.length, referenceUniqueCandidateCalls: candidateRows.filter(row => row.targets === 1).length,
  referenceAgreements: agreements.length, disagreements, baseline, manual, extractionMs,
  interpretation: 'Source declaration navigation only. Reference agreement is not independent accuracy; manual samples are small. Full Pyright performs more analysis than this source slice.',
}, null, 2));
if (disagreements.length || baseline?.changedTargets.length || manual && manual.matched !== manual.total) process.exitCode = 1;
