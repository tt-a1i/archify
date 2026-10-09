#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { COLLECTIONS, defectEntry } from './defects.mjs';
import { repairFromDiagnostics } from './repairs.mjs';
import { estimateTokens, initialReadingPaths, failureReadingPaths, measureFiles } from './tokens.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const skillRoot = path.join(repoRoot, 'archify');
const archifyCli = path.join(skillRoot, 'bin/archify.mjs');
const GATE_ORDER = ['validate', 'deliver', 'check', 'browser-check'];
const LATE_GATES = new Set(['check', 'browser-check']);
const DEFAULT_MAX_ROUNDS = 8;

class BenchmarkError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function options(args, name) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) values.push(args[index + 1]);
  }
  return values;
}

function hasFlag(args, name) {
  return args.includes(name);
}

function readJson(file) {
  const absoluteFile = path.resolve(file);
  let source;
  try {
    source = fs.readFileSync(absoluteFile, 'utf8');
  } catch {
    throw new BenchmarkError('INPUT_NOT_FOUND', `cannot read ${path.basename(absoluteFile)}`);
  }
  try {
    return JSON.parse(source);
  } catch {
    throw new BenchmarkError('INVALID_JSON', `${path.basename(absoluteFile)} is not valid JSON`);
  }
}

function manifestPaths(manifestFile, manifest) {
  const directory = path.dirname(path.resolve(manifestFile));
  const fixtures = {};
  for (const [type, relative] of Object.entries(manifest.fixtures || {})) {
    fixtures[type] = path.resolve(directory, relative);
  }
  return fixtures;
}

function invokeCli(command, type, candidateFile, quality, roundDir) {
  const env = { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' };
  if (command === 'finalize') {
    fs.mkdirSync(roundDir, { recursive: true });
    const output = path.join(roundDir, 'candidate.html');
    return spawnSync(process.execPath, [
      archifyCli, 'finalize', type, candidateFile, output,
      '--json', '--out-dir', roundDir, '--quality', quality,
    ], { encoding: 'utf8', env, timeout: 180000 });
  }
  return spawnSync(process.execPath, [
    archifyCli, 'validate', type, candidateFile, '--quality', quality, '--json',
  ], { encoding: 'utf8', env, timeout: 180000 });
}

function receiptGate(command, receipt) {
  if (command === 'finalize') {
    for (const gate of GATE_ORDER) {
      if (receipt.gates?.[gate] === 'fail') return gate;
    }
    if (receipt.ok === true) return 'pass';
    for (const gate of GATE_ORDER) {
      if (receipt.gates?.[gate] && receipt.gates[gate] !== 'pass' && receipt.gates[gate] !== 'not-run') {
        return `${gate}:${receipt.gates[gate]}`;
      }
    }
    return 'unknown';
  }
  if (receipt.ok === true) return 'pass';
  return `validate:${receipt.stage || 'unknown'}`;
}

function sha256(source) {
  return crypto.createHash('sha256').update(source).digest('hex');
}

function attributeDiagnostics(defects, diagnostics) {
  const attributions = [];
  const used = new Set();
  const unattributed = [];
  for (const diagnostic of diagnostics || []) {
    const index = defects.findIndex(
      (defect, i) => !used.has(i) && defect.expectedCodes.includes(diagnostic.code),
    );
    if (index >= 0) {
      used.add(index);
      attributions.push({ defect: index, code: diagnostic.code });
    } else {
      unattributed.push({ code: diagnostic.code, message: diagnostic.message });
    }
  }
  return { attributions, unattributed };
}

function runCase(manifestCase, fixtures, config) {
  const type = manifestCase.type;
  const fixtureFile = fixtures[type];
  const pristineSource = fs.readFileSync(fixtureFile, 'utf8');
  const doc = JSON.parse(pristineSource);
  const nodes = COLLECTIONS[type].nodes;
  const injections = (manifestCase.defects || []).map((spec, index) => {
    const entry = defectEntry(spec.class, type);
    const record = entry.inject(doc, { type, ...spec });
    return { index, class: spec.class, expectedCodes: entry.expectedCodes, record, entry };
  });

  const workDir = config.workDir
    ? path.join(config.workDir, manifestCase.id)
    : fs.mkdtempSync(path.join(os.tmpdir(), `archify-repair-rounds-${manifestCase.id}-`));
  fs.mkdirSync(workDir, { recursive: true });
  const candidateFile = path.join(workDir, 'candidate.json');

  const context = measureFiles(skillRoot, initialReadingPaths(type));
  const rounds = [];
  let stalled = false;
  let lastDocHash = '';
  let passed = false;
  let finalGate = null;

  for (let round = 1; round <= config.maxRounds; round += 1) {
    const candidateSource = JSON.stringify(doc, null, 2);
    fs.writeFileSync(candidateFile, candidateSource);
    const started = Date.now();
    const invocation = invokeCli(
      config.command, type, candidateFile, manifestCase.quality || 'showcase',
      path.join(workDir, `round-${round}`),
    );
    const wallMs = Date.now() - started;
    let receipt;
    try {
      receipt = JSON.parse(invocation.stdout);
    } catch {
      receipt = { ok: false, error: `unparseable ${config.command} output`, diagnostics: [] };
    }
    const diagnostics = receipt.diagnostics || [];
    const gate = receiptGate(config.command, receipt);
    const { attributions, unattributed } = attributeDiagnostics(injections, diagnostics);
    for (const { defect } of attributions) {
      const injection = injections[defect];
      if (injection.firstSeenRound === undefined) {
        injection.firstSeenRound = round;
        injection.firstSeenGate = gate;
      }
      injection.lastSeenRound = round;
      injection.seenCount = (injection.seenCount || 0) + 1;
    }
    const record = {
      round,
      ok: receipt.ok === true,
      gate,
      diagnostics: diagnostics.map((d) => ({
        code: d.code,
        severity: d.severity,
        subject: { ...(d.subject || {}) },
        evidenceKeys: Object.keys(d.evidence || {}).sort(),
        supportedFixes: Array.isArray(d.supportedFixes) ? [...d.supportedFixes] : [],
        hasSubjectDetail: Object.keys(d.subject || {}).some((key) => key !== 'diagramType'),
        hasEvidence: Object.keys(d.evidence || {}).length > 0,
        hasSupportedFixes: (d.supportedFixes || []).length > 0,
      })),
      attributions,
      unattributed,
      receiptBytes: invocation.stdout?.length || 0,
      receiptTokens: estimateTokens(invocation.stdout || ''),
      candidateBytes: Buffer.byteLength(candidateSource),
      candidateTokens: estimateTokens(candidateSource),
      wallMs,
    };
    rounds.push(record);
    passed = receipt.ok === true;
    finalGate = gate;
    if (passed) break;

    let repairs;
    if (config.repair === 'oracle') {
      const applied = [];
      for (const { defect } of attributions) {
        const injection = injections[defect];
        injection.entry.oracleRepair(doc, injection.record);
        applied.push({ defect: injection.class });
      }
      repairs = { applied, unactionable: unattributed };
    } else {
      repairs = repairFromDiagnostics(doc, diagnostics, { type, nodes });
      for (const { defect } of attributions) injections[defect].ruleApplied = true;
      repairs.unactionable = repairs.unactionable.concat(unattributed);
    }
    record.repairs = repairs;

    const docHash = sha256(JSON.stringify(doc));
    if (repairs.applied.length === 0 || docHash === lastDocHash) {
      stalled = true;
      break;
    }
    lastDocHash = docHash;
  }

  const defectResults = injections.map((injection) => {
    const detected = injection.firstSeenRound !== undefined;
    return {
      class: injection.class,
      expectedCodes: injection.expectedCodes,
      firstSeenRound: injection.firstSeenRound ?? null,
      firstSeenGate: injection.firstSeenGate ?? null,
      seenCount: injection.seenCount || 0,
      detected,
      // a silent defect passed every gate; an unreached defect never surfaced
      // because the loop stalled on an earlier failure first
      silent: !detected && passed,
      late: LATE_GATES.has(injection.firstSeenGate),
    };
  });

  const receiptTokens = rounds.reduce((sum, round) => sum + round.receiptTokens, 0);
  const candidateTokens = rounds.reduce((sum, round) => sum + round.candidateTokens, 0);
  const failureReads = rounds.some((round) => !round.ok) ? measureFiles(skillRoot, failureReadingPaths()) : { bytes: 0, tokens: 0, files: [] };

  return {
    schemaVersion: 1,
    benchmark: 'repair-rounds',
    caseId: manifestCase.id,
    diagramType: type,
    command: config.command,
    repairMode: config.repair,
    fixture: path.relative(repoRoot, fixtureFile),
    defects: defectResults,
    rounds,
    passed,
    stalled,
    finalGate,
    totals: {
      rounds: rounds.length,
      diagnostics: rounds.reduce((sum, round) => sum + round.diagnostics.length, 0),
      unactionable: rounds.reduce((sum, round) => sum + (round.repairs?.unactionable.length || 0), 0),
      tokens: {
        context: context.tokens,
        repairGuide: failureReads.tokens,
        candidates: candidateTokens,
        receipts: receiptTokens,
        estimate: context.tokens + failureReads.tokens + candidateTokens + receiptTokens,
      },
      wallMs: rounds.reduce((sum, round) => sum + round.wallMs, 0),
    },
  };
}

function check(args) {
  const manifestFile = option(args, '--manifest');
  if (!manifestFile) throw new Error('check requires --manifest');
  const manifest = readJson(manifestFile);
  const fixtures = manifestPaths(manifestFile, manifest);
  const cases = [];
  let ok = manifest.evidence_eligible === false;
  const baselines = new Map();
  for (const entry of manifest.cases || []) {
    const fixtureFile = fixtures[entry.type];
    const problems = [];
    let doc;
    if (!fixtureFile || !fs.existsSync(fixtureFile)) {
      problems.push(`fixture for ${entry.type} not found`);
    } else {
      doc = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
      const baselineKey = `${fixtureFile}${entry.quality || 'showcase'}`;
      if (!baselines.has(baselineKey)) {
        const baseline = invokeCli('validate', entry.type, fixtureFile, entry.quality || 'showcase', null);
        try {
          const receipt = JSON.parse(baseline.stdout);
          baselines.set(baselineKey, receipt.ok === true
            ? null
            : `fixture does not pass validate: ${(receipt.diagnostics || []).map((d) => d.code).join(',') || receipt.error}`);
        } catch {
          baselines.set(baselineKey, 'fixture validate produced no JSON receipt');
        }
      }
      if (baselines.get(baselineKey)) problems.push(baselines.get(baselineKey));
    }
    for (const spec of entry.defects || []) {
      try {
        const defect = defectEntry(spec.class, entry.type);
        const probe = JSON.parse(JSON.stringify(doc));
        defect.inject(probe, { type: entry.type, ...spec });
        if (sha256(JSON.stringify(probe)) === sha256(JSON.stringify(doc))) {
          problems.push(`defect ${spec.class} is a no-op on this fixture`);
        }
      } catch (error) {
        problems.push(`defect ${spec.class}: ${error.message}`);
      }
    }
    if (problems.length) ok = false;
    cases.push({ caseId: entry.id, type: entry.type, defects: (entry.defects || []).length, problems });
  }
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    benchmark: 'repair-rounds',
    suiteId: manifest.id,
    purpose: manifest.purpose,
    evidenceEligible: manifest.evidence_eligible === true,
    caseCount: cases.length,
    cases,
  }, null, 2)}\n`);
  process.exitCode = ok ? 0 : 1;
}

function run(args) {
  const manifestFile = option(args, '--manifest');
  if (!manifestFile) throw new Error('run requires --manifest');
  const manifest = readJson(manifestFile);
  const fixtures = manifestPaths(manifestFile, manifest);
  const selected = new Set(options(args, '--case'));
  const command = hasFlag(args, '--browser-never') ? 'validate' : 'finalize';
  const config = {
    command: option(args, '--command') || command,
    repair: option(args, '--repair') || 'rules',
    maxRounds: Number(option(args, '--max-rounds') || DEFAULT_MAX_ROUNDS),
    workDir: option(args, '--work-dir'),
  };
  if (!['finalize', 'validate'].includes(config.command)) {
    throw new BenchmarkError('INVALID_OPTION', '--command must be finalize or validate');
  }
  if (!['rules', 'oracle'].includes(config.repair)) {
    throw new BenchmarkError('INVALID_OPTION', '--repair must be rules or oracle');
  }
  const cases = (manifest.cases || []).filter((entry) => selected.size === 0 || selected.has(entry.id));
  if (selected.size > 0 && cases.length === 0) {
    throw new BenchmarkError('CASE_NOT_FOUND', `no manifest case matches ${[...selected].join(', ')}`);
  }
  for (const entry of cases) {
    const receipt = runCase(entry, fixtures, config);
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
}

function summarize(manifest, results) {
  const defects = results.flatMap((result) => result.defects || []);
  const detected = defects.filter((defect) => defect.detected);
  const late = detected.filter((defect) => defect.late);
  const byGate = {};
  for (const defect of detected) {
    byGate[defect.firstSeenGate] = (byGate[defect.firstSeenGate] || 0) + 1;
  }
  const firstRound = detected.filter((defect) => defect.firstSeenRound === 1);
  const diagnostics = results.flatMap((result) => (result.rounds || []).flatMap((round) => round.diagnostics));
  const actionable = diagnostics.filter((d) => d.hasSubjectDetail && d.hasEvidence && d.hasSupportedFixes);
  const unactionable = results.reduce((sum, result) => sum + result.totals.unactionable, 0);
  const roundCounts = results.filter((result) => result.passed).map((result) => result.totals.rounds).sort((a, b) => a - b);
  const tokenTotals = results.map((result) => result.totals.tokens.estimate);
  return {
    cases: results.length,
    passed: results.filter((result) => result.passed).length,
    stalled: results.filter((result) => result.stalled).length,
    exhausted: results.filter((result) => !result.passed && !result.stalled).length,
    roundsToPass: {
      mean: roundCounts.length ? roundCounts.reduce((a, b) => a + b, 0) / roundCounts.length : null,
      median: roundCounts.length ? roundCounts[Math.floor(roundCounts.length / 2)] : null,
      max: roundCounts.length ? Math.max(...roundCounts) : null,
    },
    disclosure: {
      defects: defects.length,
      detected: detected.length,
      silent: defects.filter((defect) => !defect.detected && defect.silent).length,
      unreached: defects.filter((defect) => !defect.detected && !defect.silent).length,
      firstRoundDisclosureRate: defects.length ? firstRound.length / defects.length : 0,
      lateDiscoveryRate: detected.length ? late.length / detected.length : 0,
      firstSeenGate: byGate,
    },
    diagnostics: {
      total: diagnostics.length,
      fullyDescribed: actionable.length,
      unactionableRepairs: unactionable,
      unattributed: results.reduce(
        (sum, result) => sum + (result.rounds || []).reduce((s, round) => s + (round.unattributed || []).length, 0),
        0,
      ),
    },
    tokens: {
      meanEstimatePerCase: tokenTotals.length ? tokenTotals.reduce((a, b) => a + b, 0) / tokenTotals.length : 0,
      meanReceiptTokensPerRound: results.length
        ? results.reduce((sum, result) => sum + result.totals.tokens.receipts, 0)
          / results.reduce((sum, result) => sum + result.totals.rounds, 0)
        : 0,
    },
  };
}

function validateResult(result) {
  if (result?.schemaVersion !== 1 || result?.benchmark !== 'repair-rounds') {
    throw new BenchmarkError('INVALID_RESULT', 'result is not a repair-rounds v1 receipt');
  }
  if (typeof result.caseId !== 'string' || typeof result.diagramType !== 'string') {
    throw new BenchmarkError('INVALID_RESULT', `result for ${result.caseId} lacks caseId or diagramType`);
  }
  if (!['finalize', 'validate'].includes(result.command) || !['rules', 'oracle'].includes(result.repairMode)) {
    throw new BenchmarkError('INVALID_RESULT', `result for ${result.caseId} has an unknown command or repair mode`);
  }
}

function report(args) {
  const resultsFile = option(args, '--results');
  if (!resultsFile) throw new Error('report requires --results');
  const manifestFile = option(args, '--manifest');
  const manifest = manifestFile ? readJson(manifestFile) : null;
  const results = fs.readFileSync(path.resolve(resultsFile), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  for (const result of results) validateResult(result);
  const modes = new Set(results.map((result) => `${result.command}:${result.repairMode}`));
  if (modes.size > 1) {
    throw new BenchmarkError('MIXED_MODES', 'report requires one command and repair mode; report each configuration separately');
  }
  const seen = new Set();
  for (const result of results) {
    const key = result.caseId;
    if (seen.has(key)) {
      throw new BenchmarkError('DUPLICATE_RESULT', `duplicate result for ${result.caseId}`);
    }
    seen.add(key);
  }
  const expected = manifest ? new Set(manifest.cases.map((entry) => entry.id)) : null;
  const coverage = expected
    ? {
      expected: expected.size,
      present: new Set(results.map((result) => result.caseId)).size,
      missing: [...expected].filter((id) => !results.some((result) => result.caseId === id)).sort(),
      complete: seen.size === expected.size && [...expected].every((id) => seen.has(id)),
    }
    : null;
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    benchmark: 'repair-rounds',
    suiteId: manifest?.id ?? null,
    evidenceEligible: coverage?.complete === true,
    coverage,
    overall: summarize(manifest, results),
  }, null, 2)}\n`);
}

function fail(error) {
  const code = error instanceof BenchmarkError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    benchmark: 'repair-rounds',
    error: { code, message },
  }, null, 2)}\n`);
  process.exitCode = 2;
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'check') {
    check(args);
  } else if (command === 'run') {
    run(args);
  } else if (command === 'report') {
    report(args);
  } else {
    throw new BenchmarkError('USAGE', 'usage: benchmark.mjs check|run|report --manifest <file> [options]');
  }
} catch (error) {
  fail(error);
}
