// Independent contract cases: valid SARIF lookup/URI semantics and structured
// rejection of malformed exported data. The fixtures describe input protocols,
// not the importer's intermediate representation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { importExternal } from '../lib/external.mjs';
import { acceptFinding, reviewFindings } from '../lib/review.mjs';
import { buildTask, validateTask } from '../lib/task.mjs';
import { DiagnosticError } from '../core/index.mjs';

const sourceText = 'const unused = 1;\n';
function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-external-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  for (const name of ['a.js', 'a b.js']) fs.writeFileSync(path.join(root, 'src', name), sourceText);
  return (format, report, extra = {}) => {
    fs.writeFileSync(path.join(root, 'report.json'), JSON.stringify(report));
    return importExternal({ root, config: { external: { sources: [{ id: 'contract', format, file: 'report.json', ...extra }] } }, facts: { files: [] } });
  };
}
function sarif(result, uri = 'src/a.js') {
  return { version: '2.1.0', runs: [{
    tool: { driver: { name: 'Example checker', rules: [{ id: 'R', defaultConfiguration: { level: 'error' } }] } },
    artifacts: [{ location: { uri }, contents: { text: sourceText } }],
    results: [{ ruleId: 'R', message: { text: 'Unused declaration' },
      locations: [{ physicalLocation: { artifactLocation: { uri }, region: { startLine: 1 } } }], ...result }],
  }] };
}

test('SARIF relative URI escapes resolve to the actual repository filename', (t) => {
  const load = workspace(t);
  const imported = load('sarif', sarif({}, 'src/a%20b.js'));
  assert.equal(imported.diagnostics[0].subject.file, 'src/a b.js');
  assert.ok(imported.diagnostics[0].evidenceDigest, 'the real source file supplies captured evidence');
  assert.equal(imported.diagnostics[0].external.binding, 'verified');
});

test('SARIF descriptor references with an empty toolComponent default to the driver', (t) => {
  const imported = workspace(t)('sarif', sarif({ rule: { id: 'R', toolComponent: {} } }));
  assert.equal(imported.diagnostics[0].external.ruleId, 'R');
  assert.equal(imported.diagnostics[0].severity, 'error', 'driver rule metadata remains available');
});

test('SARIF hierarchical rule IDs preserve the variant while resolving descriptor metadata by index', (t) => {
  // SARIF 2.1.0 section 3.27.5 explicitly allows ruleId to extend a descriptor
  // identifier (for example CA5350/sha-1) while rule.index selects CA5350.
  const imported = workspace(t)('sarif', sarif({ ruleId: 'R/variant', rule: { index: 0 } }));
  assert.equal(imported.diagnostics[0].external.ruleId, 'R/variant');
  assert.equal(imported.diagnostics[0].severity, 'error');
});

test('GitHub author filtering does not bypass structured validation of malformed comments', (t) => {
  const load = workspace(t);
  assert.throws(() => load('github-review', [null], { author: 'review-bot' }),
    (error) => error instanceof DiagnosticError && error.diagnostics[0].code === 'external/report-invalid');
});

test('manifest hash metadata is typed before hashing or being published as provenance', (t) => {
  const load = workspace(t);
  for (const fields of [
    { configDigest: ['a'.repeat(64)] },
    { files: { 'src/a.js': { toString: null, valueOf: null } } },
  ]) assert.throws(() => load('ruff', [], { manifest: { schema_version: 1, ...fields } }),
    (error) => error instanceof DiagnosticError && error.diagnostics[0].code === 'external/config-invalid');
});

test('SARIF GUID descriptor references retain the descriptor rule and default severity', (t) => {
  const report = sarif({ ruleId: undefined, rule: { guid: 'f76dbdec-2cba-4a49-a81b-493ffca2b209' } });
  report.runs[0].tool.driver.rules[0].guid = report.runs[0].results[0].rule.guid;
  const imported = workspace(t)('sarif', report);
  assert.equal(imported.diagnostics[0].external.ruleId, 'R');
  assert.equal(imported.diagnostics[0].severity, 'error');
});

test('an explicit SARIF unknown offset does not erase an available source line range', (t) => {
  const report = sarif({});
  report.runs[0].results[0].locations[0].physicalLocation.region.charOffset = -1;
  const imported = workspace(t)('sarif', report);
  assert.equal(imported.diagnostics[0].subject.line, 1);
  assert.ok(imported.diagnostics[0].evidenceDigest);
  assert.equal(imported.diagnostics[0].external.binding, 'verified');
});

test('SARIF shared partial fingerprints cannot transfer acceptance after a source suppression', (t) => {
  const load = workspace(t);
  // Partial fingerprints contribute to identity; a line hash alone is not a
  // unique result id. The two calls remain independently reviewable.
  for (const withContributor of [false, true]) {
    const report = sarif({});
    report.runs[0].results = [1, 8].map((column) => ({
      ruleId: 'R', message: { text: 'Review this call' },
      partialFingerprints: { primaryLocationLineHash: 'shared-line/v1', ...(withContributor ? { 'callSite/v1': String(column) } : {}) },
      locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.js' }, region: { startLine: 1, startColumn: withContributor ? 1 : column } } }],
    }));
    const before = load('sarif', report);
    assert.equal(before.diagnostics.length, 2);
    const first = before.diagnostics.find(d => d.external.reportPointer.endsWith('/0'));
    const second = before.diagnostics.find(d => d.external.reportPointer.endsWith('/1'));
    const baseline = acceptFinding(first, { reason: 'Only the first result was reviewed.' });
    assert.equal(reviewFindings(before.diagnostics, { baseline }).findings[second.id].status, 'open');
    report.runs[0].results[0].suppressions = [{ kind: 'external', status: 'accepted' }];
    const after = load('sarif', report);
    assert.equal(after.sources[0].suppressed, 1);
    assert.equal(after.diagnostics.length, 1);
    assert.equal(after.diagnostics[0].id, second.id, 'the surviving result keeps its own identity');
    assert.equal(after.diagnostics[0].external.binding, 'verified');
    assert.equal(reviewFindings(after.diagnostics, { baseline }).findings[second.id].status, 'open');
  }

  // Even when a producer supplies a colliding full fingerprint, moving a claim
  // to a different position must require another review instead of inheriting it.
  const report = sarif({});
  report.runs[0].results = [1, 8].map(column => ({
    ruleId: 'R', message: { text: 'Review this call' }, fingerprints: { 'result/v1': 'colliding-producer-value' },
    locations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.js' }, region: { startLine: 1, startColumn: column } } }],
  }));
  const before = load('sarif', report);
  const first = before.diagnostics.find(d => d.subject.column === 1);
  const baseline = acceptFinding(first, { reason: 'Only the first location was reviewed.' });
  report.runs[0].results.shift();
  const after = load('sarif', report);
  assert.notEqual(reviewFindings(after.diagnostics, { baseline }).findings[after.diagnostics[0].id].status, 'accepted');
});

test('SARIF extension rule namespaces remain distinct and stable when extension order changes', (t) => {
  const load = workspace(t);
  const report = sarif({});
  report.runs[0].tool.extensions = ['Plugin A', 'Plugin B'].map(name => ({ name, version: '1.0.0', rules: [{ id: 'R' }] }));
  report.runs[0].results = [0, 1].map(index => ({ ...structuredClone(report.runs[0].results[0]), rule: { index: 0, toolComponent: { index } } }));
  const before = load('sarif', report);
  assert.equal(before.diagnostics.length, 2, 'different tool components are independent source claims');
  assert.equal(new Set(before.diagnostics.map(d => d.id)).size, 2);
  assert.deepEqual(before.diagnostics.map(d => d.external.origin.toolComponent.name).sort(), ['Plugin A', 'Plugin B']);
  const baseline = acceptFinding(before.diagnostics[0], { reason: 'Only this component was reviewed.' });
  assert.equal(Object.values(reviewFindings(before.diagnostics, { baseline }).findings).filter(f => f.status === 'accepted').length, 1);
  report.runs[0].tool.extensions.reverse();
  for (const result of report.runs[0].results) result.rule.toolComponent.index = 1 - result.rule.toolComponent.index;
  const reordered = load('sarif', report);
  assert.deepEqual(reordered.diagnostics.map(d => d.id), before.diagnostics.map(d => d.id));

  // The specification does not promise names/versions are unique. Distinct
  // extension descriptors may share them, so ambiguous identity must never
  // carry a review to another component after the report changes.
  report.runs[0].tool.extensions[1].name = report.runs[0].tool.extensions[0].name;
  report.runs[0].tool.extensions[1].properties = { instance: 'second' };
  const ambiguous = load('sarif', report);
  assert.equal(ambiguous.diagnostics.length, 2);
  const acceptedComponent = ambiguous.diagnostics.find(d => d.external.origin.toolComponent.index === 0);
  const ambiguousBaseline = acceptFinding(acceptedComponent, { reason: 'This report occurrence was reviewed.' });
  report.runs[0].results = [structuredClone(report.runs[0].results[0])];
  report.runs[0].results[0].rule.toolComponent.index = 0;
  const remaining = load('sarif', report);
  assert.equal(remaining.diagnostics.length, 1);
  assert.notEqual(reviewFindings(remaining.diagnostics, { baseline: ambiguousBaseline }).findings[remaining.diagnostics[0].id].status, 'accepted');
});

test('SARIF related locations remain readable context without becoming a missing primary or an edit scope', (t) => {
  const load = workspace(t);
  const report = sarif({
    locations: [{ logicalLocations: [{ fullyQualifiedName: 'compiled.Symbol' }] }],
    relatedLocations: [{ physicalLocation: { artifactLocation: { uri: 'src/a.js' }, region: { startLine: 1, startColumn: 7 } } }],
  });
  const imported = load('sarif', report);
  const finding = imported.diagnostics[0];
  assert.equal(finding.subject.file, undefined, 'a related citation is not the reported primary location');
  assert.deepEqual(finding.external.locations, [{ file: 'src/a.js', line: 1, endLine: 1, column: 7, role: 'related' }]);
  assert.equal(finding.external.binding, 'unverified');
  assert.equal(finding.evidenceDigest, undefined, 'related source alone cannot substantiate an unknown primary');
  assert.deepEqual(finding.external.origin.nativeLocations[0].logicalLocations, [{ fullyQualifiedName: 'compiled.Symbol' }]);
  assert.throws(() => acceptFinding(finding, { reason: 'A source citation exists.' }), error => error.diagnostics?.[0]?.code === 'baseline/evidence-unverifiable');
  const repository = { root: '.', language: 'ts' };
  const task = buildTask({ findings: { repository, diagnostics: imported.diagnostics, analysis: { external: imported.sources }, externalEvidence: imported.evidenceFiles }, facts: { repository, files: [] }, ids: [finding.id] });
  validateTask(task);
  assert.deepEqual(task.scope.modify, []);
  assert.deepEqual(task.scope.read, ['src/a.js']);
  assert.equal(task.locations[0].role, 'related');
  assert.ok(task.locations[0].excerpt.segments[0].lines.includes('const unused = 1;'));
  assert.ok(task.toConfirm.some(item => /primary.*location/i.test(item)));

  // An available primary stays editable; a different related file stays context.
  report.runs[0].results[0].locations = [{ physicalLocation: { artifactLocation: { uri: 'src/a%20b.js' }, region: { startLine: 1 } } }];
  const mapped = load('sarif', report);
  const mappedTask = buildTask({ findings: { repository, diagnostics: mapped.diagnostics, analysis: { external: mapped.sources }, externalEvidence: mapped.evidenceFiles }, facts: { repository, files: [] }, ids: [mapped.diagnostics[0].id] });
  validateTask(mappedTask);
  assert.deepEqual(mappedTask.scope.modify, ['src/a b.js']);
  assert.deepEqual(mappedTask.scope.read, ['src/a.js']);

  const result = report.runs[0].results[0];
  result.fingerprints = { 'result/v1': 'same-result' };
  result.locations.push(result.relatedLocations[0]);
  result.relatedLocations = [];
  const primaryPair = load('sarif', report);
  const baseline = acceptFinding(primaryPair.diagnostics[0], { reason: 'Both primary locations were reviewed.' });
  result.relatedLocations = [result.locations.pop()];
  const roleChanged = load('sarif', report);
  assert.equal(roleChanged.diagnostics[0].id, primaryPair.diagnostics[0].id);
  assert.equal(reviewFindings(roleChanged.diagnostics, { baseline }).findings[roleChanged.diagnostics[0].id].status, 'accepted-changed', 'changing only the citation role changes the reviewed claim');
});
