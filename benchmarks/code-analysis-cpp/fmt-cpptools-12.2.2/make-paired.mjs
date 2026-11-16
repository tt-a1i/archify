import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [factsPath, outputPath] = process.argv.slice(2);
if (!factsPath || !outputPath) {
  console.error('Usage: node make-paired.mjs <raw-facts.json> <output.json>');
  process.exit(2);
}
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const facts = read(factsPath);
const positivePath = path.join(here, 'positive-cpptools.json');
const unresolvedPath = path.join(here, 'unresolved-cpptools.json');
const positive = read(positivePath), unresolved = read(unresolvedPath);
assert.equal(facts.repository.language, 'cpp');
assert.equal(facts.repository.adapterRevision, 4);
assert.equal(positive.extensionVersion, unresolved.extensionVersion);
assert.equal(positive.vscodeVersion, unresolved.vscodeVersion);
assert.equal(positive.samples.length, 48);
assert.equal(unresolved.samples.length, 20);

const contains = (call, position) => {
  const start = [call.line, call.column - 1], end = [call.endLine, call.endColumn - 1];
  const at = [position.line + 1, position.character];
  return (at[0] > start[0] || at[0] === start[0] && at[1] >= start[1])
    && (at[0] < end[0] || at[0] === end[0] && at[1] < end[1]);
};
const sameTarget = (actual, expected) => actual.file === expected.file && actual.line === expected.line;
const rows = [];
for (const sample of positive.samples) {
  assert.equal(sample.status, 'match');
  let archify;
  if (sample.kind === 'call') {
    const matches = facts.calls.filter(call => call.file === sample.file
      && call.contexts.includes(sample.context) && contains(call, sample.position)
      && call.resolution === 'cpp-direct-source'
      && call.target.file === sample.expected && call.target.line === sample.expectedLine);
    assert.equal(matches.length, 1, `no unique matching bound call: ${sample.file}:${sample.position.line + 1}`);
    archify = { resolution: 'cpp-direct-source', target: { file: sample.expected, line: sample.expectedLine } };
  } else {
    assert.equal(sample.kind, 'include');
    const matches = facts.imports.filter(item => item.from === sample.file
      && item.line === sample.position.line + 1 && item.contexts.includes(sample.context)
      && item.resolved && item.to === sample.expected);
    assert.equal(matches.length, 1, `no matching active include: ${sample.file}:${sample.position.line + 1}`);
    archify = { resolution: 'active-include', target: { file: sample.expected } };
  }
  const expected = { file: sample.expected, line: sample.expectedLine };
  const included = sample.actual.some(item => sample.kind === 'include'
    ? item.file === expected.file : sameTarget(item, expected));
  assert.ok(included, `cpptools omitted expected target: ${sample.file}:${sample.position.line + 1}`);
  rows.push({ category: sample.kind, file: sample.file, context: sample.context,
    contextStatus: sample.file === sample.context ? 'translation-unit-entry' : 'unverified-header-association',
    position: sample.position, archify, cpptools: { locations: sample.actual, attempts: sample.attempts, readiness: sample.readiness },
    verdict: sample.actual.length === 1 ? 'unique-exact' : 'expected-among-candidates' });
}
for (const sample of unresolved.samples) {
  const [line, column, endLine, endColumn] = sample.callRange;
  const matches = facts.calls.filter(call => call.file === sample.file
    && call.contexts.includes(sample.context) && call.reason === sample.reason
    && call.line === line && call.column === column
    && call.endLine === endLine && call.endColumn === endColumn);
  assert.equal(matches.length, 1, `no matching unresolved call: ${sample.file}:${line}:${column}`);
  assert.ok(contains(matches[0], sample.position));
  rows.push({ category: 'unresolved-call', file: sample.file, context: sample.context,
    contextStatus: sample.file === sample.context ? 'translation-unit-entry' : 'unverified-header-association',
    position: sample.position, callee: sample.callee, source: sample.source,
    archify: { resolution: 'unresolved', reason: sample.reason },
    cpptools: { locations: sample.actual, attempts: sample.attempts, readiness: sample.readiness },
    verdict: sample.actual.length === 0 ? 'no-navigation-target'
      : sample.actual.length === 1 ? 'one-navigation-target' : 'multiple-navigation-targets' });
}
const summary = {
  selectedTranslationUnits: facts.languageScope.build.units.length,
  parsedTranslationUnits: facts.languageScope.build.units.filter(unit => unit.status === 'parsed').length,
  selectedFiles: facts.files.length,
  activeIncludes: facts.imports.length,
  resolvedProjectIncludes: facts.imports.filter(item => item.resolved).length,
  functions: facts.functions.length,
  calls: facts.calls.length,
  boundCalls: facts.calls.filter(call => call.resolution === 'cpp-direct-source').length,
  positive: { total: positive.samples.length,
    translationUnitEntries: rows.filter(row => ['call', 'include'].includes(row.category) && row.contextStatus === 'translation-unit-entry').length,
    unverifiedHeaderAssociations: rows.filter(row => ['call', 'include'].includes(row.category) && row.contextStatus === 'unverified-header-association').length,
    uniqueExact: rows.filter(row => row.verdict === 'unique-exact').length,
    expectedAmongCandidates: rows.filter(row => row.verdict === 'expected-among-candidates').length,
    missed: rows.filter(row => ['call', 'include'].includes(row.category) && row.verdict === 'missed').length },
  unresolved: { total: unresolved.samples.length,
    oneNavigationTarget: rows.filter(row => row.verdict === 'one-navigation-target').length,
    multipleNavigationTargets: rows.filter(row => row.verdict === 'multiple-navigation-targets').length,
    noNavigationTarget: rows.filter(row => row.verdict === 'no-navigation-target').length },
};
const report = {
  project: 'fmt', sourceCommit: '57f1b5930dc2906875534a15c209e1c39eda59ad',
  reportedVersion: '12.2.2',
  environment: { vscode: positive.vscodeVersion, cpptools: positive.extensionVersion,
    archifyAdapter: facts.repository.adapter, archifyAdapterRevision: facts.repository.adapterRevision,
    selectedDatabaseSha256: facts.languageScope.build.databaseSha256,
    rawFactsSha256: sha(factsPath), positiveCpptoolsSha256: sha(positivePath),
    unresolvedCpptoolsSha256: sha(unresolvedPath) },
  comparison: 'VS Code executeDefinitionProvider versus Archify captured direct source targets; navigation candidates are not runtime call edges; header translation-unit association is unverified',
  summary, samples: rows,
};
fs.writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
