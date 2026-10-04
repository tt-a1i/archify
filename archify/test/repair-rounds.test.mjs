import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const repoRoot = path.resolve(skillRoot, '..');
const benchmark = path.join(repoRoot, 'benchmarks/repair-rounds/benchmark.mjs');
const manifest = path.join(repoRoot, 'benchmarks/repair-rounds/manifest.json');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-repair-rounds-'));
const chromeAvailable = Boolean(process.env.ARCHIFY_CHROME)
  || fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');

function run(args) {
  return spawnSync(process.execPath, [benchmark, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
}

function writeJson(name, value) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function miniManifest(id, type, defects, fixtureOverride) {
  const fixture = fixtureOverride || path.join(skillRoot, 'examples', {
    architecture: 'web-app.architecture.json',
    workflow: 'agent-tool-call.workflow.json',
    sequence: 'cache-miss-request.sequence.json',
    dataflow: 'product-analytics.dataflow.json',
    lifecycle: 'deployment-release.lifecycle.json',
  }[type]);
  return writeJson(`${id}.manifest.json`, {
    schema_version: 1,
    id,
    purpose: 'feedback-efficiency',
    evidence_eligible: false,
    fixtures: { [type]: fixture },
    cases: [{ id, type, defects }],
  });
}

test('check accepts the checked-in suite end to end', () => {
  const result = run(['check', '--manifest', manifest]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.benchmark, 'repair-rounds');
  assert.equal(receipt.caseCount, 41);
  assert.equal(receipt.evidenceEligible, false);
  for (const entry of receipt.cases) {
    assert.deepEqual(entry.problems, [], entry.caseId);
  }
});

test('check reports an unknown defect class instead of crashing', () => {
  const bad = miniManifest('bad-defect', 'architecture', [{ class: 'does-not-exist' }]);
  const result = run(['check', '--manifest', bad]);
  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.match(receipt.cases[0].problems[0], /unknown defect class/);
});

test('rules repair converges a schema defect reported with a path and evidence', () => {
  const file = miniManifest('flow-missing-output', 'workflow', [{ class: 'meta-missing-output' }]);
  const result = run(['run', '--manifest', file, '--command', 'validate']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout.split('\n')[0]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.totals.rounds, 2);
  assert.deepEqual(receipt.defects.map((d) => d.firstSeenGate), ['validate:render']);
  assert.equal(receipt.rounds[0].diagnostics[0].code, 'schema/required');
  assert.equal(receipt.rounds[0].diagnostics[0].hasSubjectDetail, true);
  assert.equal(receipt.rounds[0].diagnostics[0].hasEvidence, true);
  assert.equal(receipt.rounds[0].diagnostics[0].hasSupportedFixes, true);
  assert.equal(receipt.rounds[0].repairs.applied.length, 1);
  assert.equal(receipt.totals.tokens.context > 0, true);
  assert.equal(receipt.totals.tokens.receipts > 0, true);
});

test('keeps a valid boundary label visible to the repair-rounds suite', () => {
  const fixture = writeJson('valid-boundary.architecture.json', {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Valid boundary label',
      output: 'boundary.html',
      quality_profile: 'showcase',
      viewBox: [1600, 300],
    },
    components: [{
      id: 'boundary',
      type: 'backend',
      label: 'i'.repeat(205),
      sublabel: '',
      pos: [80, 100],
      size: [1400, 60],
    }],
    boundaries: [],
    connections: [],
    cards: [],
  });
  const file = miniManifest('architecture-valid-boundary', 'architecture', [], fixture);
  const result = run(['run', '--manifest', file, '--command', 'validate']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout.split('\n')[0]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.rounds[0].ok, true);
  assert.deepEqual(receipt.defects, []);
});

test('a staged second defect surfaces only after the first is repaired', () => {
  const file = miniManifest('arch-staged', 'architecture', [
    { class: 'meta-missing-output' },
    { class: 'node-long-label' },
  ]);
  const result = run(['run', '--manifest', file, '--command', 'validate', '--repair', 'oracle']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout.split('\n')[0]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.totals.rounds, 3);
  const [schema, label] = receipt.defects;
  assert.equal(schema.class, 'meta-missing-output');
  assert.equal(schema.firstSeenRound, 1);
  assert.equal(label.class, 'node-long-label');
  assert.equal(label.firstSeenRound, 2);
});

test('diagnostics the rules cannot map are counted as unactionable and stall the loop', () => {
  const file = miniManifest('arch-duplicate-id', 'architecture', [{ class: 'node-duplicate-id' }]);
  const result = run(['run', '--manifest', file, '--command', 'validate']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout.split('\n')[0]);
  assert.equal(receipt.stalled, true);
  assert.equal(receipt.passed, false);
  assert.equal(receipt.totals.unactionable > 0, true);
});

test('a header overflow is detected at the browser-check gate, where measurement is authoritative', { skip: !chromeAvailable }, () => {
  const file = miniManifest('arch-title-overflow', 'architecture', [{ class: 'title-overflow' }]);
  const result = run(['run', '--manifest', file, '--command', 'finalize', '--repair', 'oracle']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout.split('\n')[0]);
  assert.equal(receipt.passed, true);
  assert.equal(receipt.defects[0].firstSeenGate, 'browser-check');
  assert.equal(receipt.defects[0].late, true);
});

test('report aggregates disclosure, late discovery, and token cost across receipts', () => {
  const receipts = [
    {
      schemaVersion: 1,
      benchmark: 'repair-rounds',
      caseId: 'early-case',
      diagramType: 'workflow',
      command: 'validate',
      repairMode: 'rules',
      defects: [{ class: 'meta-missing-output', detected: true, firstSeenRound: 1, firstSeenGate: 'validate', late: false }],
      rounds: [{ diagnostics: [{ code: 'schema/required', hasSubjectDetail: true, hasEvidence: true, hasSupportedFixes: true }] }],
      passed: true,
      stalled: false,
      totals: { rounds: 2, diagnostics: 1, unactionable: 0, tokens: { estimate: 40000, receipts: 900 }, wallMs: 500 },
    },
    {
      schemaVersion: 1,
      benchmark: 'repair-rounds',
      caseId: 'late-case',
      diagramType: 'architecture',
      command: 'validate',
      repairMode: 'rules',
      defects: [
        { class: 'node-long-label', detected: true, firstSeenRound: 1, firstSeenGate: 'validate', late: false },
        { class: 'title-overflow', detected: true, firstSeenRound: 2, firstSeenGate: 'browser-check', late: true },
        { class: 'subtitle-overflow', detected: false, silent: true, firstSeenRound: null, firstSeenGate: null, late: false },
      ],
      rounds: [{ diagnostics: [{ code: 'viewer/viewport-overflow', hasSubjectDetail: true, hasEvidence: true, hasSupportedFixes: true }] }],
      passed: true,
      stalled: false,
      totals: { rounds: 3, diagnostics: 1, unactionable: 0, tokens: { estimate: 80000, receipts: 6000 }, wallMs: 4000 },
    },
  ];
  const resultsFile = path.join(tmp, 'repair-results.jsonl');
  fs.writeFileSync(resultsFile, `${receipts.map((row) => JSON.stringify(row)).join('\n')}\n`);

  const result = run(['report', '--results', resultsFile]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.overall.cases, 2);
  assert.equal(report.overall.passed, 2);
  assert.deepEqual(report.overall.roundsToPass, { mean: 2.5, median: 3, max: 3 });
  assert.equal(report.overall.disclosure.defects, 4);
  assert.equal(report.overall.disclosure.detected, 3);
  assert.equal(report.overall.disclosure.silent, 1);
  assert.equal(report.overall.disclosure.unreached, 0);
  assert.equal(report.overall.disclosure.firstRoundDisclosureRate, 0.5);
  assert.equal(report.overall.disclosure.lateDiscoveryRate, 1 / 3);
  assert.equal(report.overall.disclosure.firstSeenGate['browser-check'], 1);
  assert.equal(report.overall.tokens.meanEstimatePerCase, 60000);
});

test('report rejects duplicate and foreign receipts', () => {
  const receipt = {
    schemaVersion: 1,
    benchmark: 'repair-rounds',
    caseId: 'dup',
    diagramType: 'workflow',
    command: 'validate',
    repairMode: 'rules',
    defects: [],
    rounds: [],
    passed: true,
    totals: { rounds: 1, diagnostics: 0, unactionable: 0, tokens: { estimate: 1, receipts: 1 }, wallMs: 1 },
  };
  const dupFile = path.join(tmp, 'dup-results.jsonl');
  fs.writeFileSync(dupFile, `${JSON.stringify(receipt)}\n${JSON.stringify(receipt)}\n`);
  const dup = run(['report', '--results', dupFile]);
  assert.equal(dup.status, 2);
  assert.equal(JSON.parse(dup.stdout).error.code, 'DUPLICATE_RESULT');

  const foreignFile = path.join(tmp, 'foreign-results.jsonl');
  fs.writeFileSync(foreignFile, `${JSON.stringify({ schemaVersion: 1, benchmark: 'ordinary-model-floor' })}\n`);
  const foreign = run(['report', '--results', foreignFile]);
  assert.equal(foreign.status, 2);
  assert.equal(JSON.parse(foreign.stdout).error.code, 'INVALID_RESULT');
});

function reportRow(caseId, overrides = {}) {
  return {
    schemaVersion: 1, benchmark: 'repair-rounds', caseId, diagramType: 'workflow',
    command: 'validate', repairMode: 'rules', defects: [], rounds: [],
    passed: true, stalled: false,
    totals: { rounds: 2, unactionable: 0, tokens: { estimate: 10, receipts: 5 } },
    ...overrides,
  };
}

function aggregateRows(name, rows, extraArgs = []) {
  const file = path.join(tmp, `${name}.jsonl`);
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n'));
  return run(['report', '--results', file, ...extraArgs]);
}

test('rounds to pass excludes stalled and exhausted cases', () => {
  const failed = [
    reportRow('stalled', { passed: false, stalled: true, totals: { rounds: 1, unactionable: 1, tokens: { estimate: 10, receipts: 5 } } }),
    reportRow('exhausted', { passed: false }),
  ];
  const result = aggregateRows('outcomes', [reportRow('success'), ...failed]);
  assert.equal(result.status, 0);
  const { overall } = JSON.parse(result.stdout);
  assert.deepEqual(overall.roundsToPass, { mean: 2, median: 2, max: 2 });
  assert.equal(overall.passed, 1);
  assert.equal(overall.stalled, 1);
  assert.equal(overall.exhausted, 1);
  const noPass = aggregateRows('no-pass', failed);
  assert.equal(noPass.status, 0);
  assert.deepEqual(JSON.parse(noPass.stdout).overall.roundsToPass, { mean: null, median: null, max: null });
});

test('report rejects mixed modes instead of counting one case twice toward coverage', () => {
  const manifestFile = writeJson('coverage-manifest.json', { id: 'coverage', cases: [{ id: 'A' }, { id: 'B' }] });
  for (const override of [{ repairMode: 'oracle' }, { command: 'finalize' }]) {
    const result = aggregateRows('mixed', [reportRow('A'), reportRow('A', override)], ['--manifest', manifestFile]);
    assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).error.code, 'MIXED_MODES');
  }
  for (const [name, rows, complete, missing] of [
    ['missing', [reportRow('A')], false, ['B']],
    ['foreign-case', [reportRow('A'), reportRow('C')], false, ['B']],
    ['complete', [reportRow('A'), reportRow('B')], true, []],
  ]) {
    const result = aggregateRows(name, rows, ['--manifest', manifestFile]);
    assert.equal(result.status, 0);
    const report = JSON.parse(result.stdout);
    assert.equal(report.coverage.complete, complete);
    assert.equal(report.evidenceEligible, complete);
    assert.deepEqual(report.coverage.missing, missing);
  }
});
