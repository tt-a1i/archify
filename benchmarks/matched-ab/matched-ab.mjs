#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COVERAGE_KINDS = ['facts', 'nodes', 'messages', 'views'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || index === args.length - 1) {
    throw new Error(`missing required option ${name}`);
  }
  return args[index + 1];
}

function normalizeCoverage(value, label) {
  const normalized = {};
  for (const kind of COVERAGE_KINDS) {
    if (!Array.isArray(value?.[kind]) || value[kind].some((item) => typeof item !== 'string')) {
      throw new Error(`${label}.${kind} must be an array of strings`);
    }
    normalized[kind] = [...new Set(value[kind])].sort();
  }
  return normalized;
}

export function compareSemanticCoverage(baselineValue, candidateValue) {
  const baseline = normalizeCoverage(baselineValue, 'baseline');
  const candidate = normalizeCoverage(candidateValue, 'candidate');
  const missing = {};
  let ok = true;

  for (const kind of COVERAGE_KINDS) {
    const present = new Set(candidate[kind]);
    missing[kind] = baseline[kind].filter((item) => !present.has(item));
    if (missing[kind].length > 0) ok = false;
  }

  return { ok, missing };
}

function requireInteger(value, label, minimum) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${label} must be an integer >= ${minimum}`);
  }
}

function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 'archify.matched-ab.manifest.v1') {
    throw new Error('manifest.schemaVersion must be archify.matched-ab.manifest.v1');
  }
  if (typeof manifest.benchmarkId !== 'string' || manifest.benchmarkId.length === 0) {
    throw new Error('manifest.benchmarkId must be a non-empty string');
  }
  const machine = manifest.machine;
  if (!Array.isArray(machine?.command) || machine.command.length === 0
      || machine.command.some((part) => typeof part !== 'string')) {
    throw new Error('machine.command must be a non-empty argv array');
  }
  requireInteger(machine.warmupPerVariant, 'machine.warmupPerVariant', 0);
  requireInteger(machine.rounds, 'machine.rounds', 1);
  requireInteger(machine.timeoutMs, 'machine.timeoutMs', 1);
  if (machine.order !== 'ABBA') throw new Error('machine.order must be ABBA');
  if (!machine.runtime || typeof machine.runtime !== 'object') {
    throw new Error('machine.runtime must pin nodeVersion, platform, and arch');
  }
  if (!machine.fixedConfig || typeof machine.fixedConfig !== 'object' || Array.isArray(machine.fixedConfig)) {
    throw new Error('machine.fixedConfig must be an object');
  }
  if (machine.env !== undefined && (!machine.env || typeof machine.env !== 'object'
      || Array.isArray(machine.env)
      || Object.values(machine.env).some((value) => typeof value !== 'string'))) {
    throw new Error('machine.env must contain only string values');
  }
  for (const variant of ['A', 'B']) {
    const value = machine.variants?.[variant];
    if (!value || typeof value.cwd !== 'string' || typeof value.revision !== 'string') {
      throw new Error(`machine.variants.${variant} must define cwd and revision`);
    }
  }
  normalizeCoverage(manifest.quality?.semanticCoverage, 'quality.semanticCoverage');
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed in ${cwd}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function resolveSource(variant, label) {
  const cwd = path.resolve(variant.cwd);
  const revision = git(cwd, ['rev-parse', 'HEAD']);
  if (revision !== variant.revision) {
    throw new Error(`${label} revision mismatch: expected ${variant.revision}, got ${revision}`);
  }
  const status = git(cwd, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (status.length > 0) {
    throw new Error(`${label} worktree is not clean; benchmark a fixed revision`);
  }
  return {
    label: variant.label ?? label,
    cwd,
    revision,
  };
}

function verifyRuntime(expected) {
  const actual = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    execPath: process.execPath,
  };
  for (const field of ['nodeVersion', 'platform', 'arch']) {
    if (expected?.[field] !== actual[field]) {
      throw new Error(`runtime ${field} mismatch: expected ${expected?.[field]}, got ${actual[field]}`);
    }
  }
  return actual;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle];
  return (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, proportion) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * proportion) - 1)];
}

function summarizeVariant(runs, variant) {
  const samples = runs.filter((run) => run.phase === 'measure' && run.variant === variant);
  const durations = samples.map((sample) => sample.durationMs);
  return {
    samples: samples.length,
    medianMs: median(durations),
    p95Ms: percentile(durations, 0.95),
  };
}

function summarizePairs(runs) {
  const grouped = new Map();
  for (const run of runs.filter((entry) => entry.phase === 'measure')) {
    const key = `${run.round}:${run.pair}`;
    if (!grouped.has(key)) grouped.set(key, {});
    grouped.get(key)[run.variant] = run.durationMs;
  }
  const pairs = [...grouped.values()].map((pair) => ({
    deltaMs: pair.B - pair.A,
    deltaPercent: ((pair.B - pair.A) / pair.A) * 100,
  }));
  return {
    samples: pairs.length,
    medianDeltaMs: median(pairs.map((pair) => pair.deltaMs)),
    p95DeltaMs: percentile(pairs.map((pair) => pair.deltaMs), 0.95),
    medianDeltaPercent: median(pairs.map((pair) => pair.deltaPercent)),
    p95DeltaPercent: percentile(pairs.map((pair) => pair.deltaPercent), 0.95),
  };
}

function parseObservation(stdout, label) {
  try {
    return JSON.parse(stdout.trim());
  } catch (error) {
    throw new Error(`${label} must write exactly one JSON observation to stdout: ${error.message}`);
  }
}

function executeRun({ machine, source, variant, phase, round, pair, position, baseline }) {
  const env = {
    ...process.env,
    ...(machine.env ?? {}),
    ARCHIFY_BENCHMARK_VARIANT: variant,
    ARCHIFY_BENCHMARK_PHASE: phase,
    ARCHIFY_BENCHMARK_ROUND: String(round),
    ARCHIFY_BENCHMARK_PAIR: String(pair),
    ARCHIFY_BENCHMARK_CONFIG_JSON: canonicalJson(machine.fixedConfig),
  };
  const started = process.hrtime.bigint();
  const result = spawnSync(machine.command[0], machine.command.slice(1), {
    cwd: source.cwd,
    env,
    encoding: 'utf8',
    timeout: machine.timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
  });
  const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${variant} ${phase} command failed (${result.status}): ${result.stderr.trim()}`);
  }
  const observation = parseObservation(result.stdout, `${variant} ${phase}`);
  if (canonicalJson(observation.observedConfig) !== canonicalJson(machine.fixedConfig)) {
    throw new Error(`${variant} ${phase} did not acknowledge the fixed benchmark config`);
  }
  const coverage = normalizeCoverage(observation.semanticCoverage, 'observation.semanticCoverage');
  const quality = compareSemanticCoverage(baseline, coverage);
  if (!quality.ok) {
    throw new Error(`${variant} ${phase} lost semantic coverage: ${canonicalJson(quality.missing)}`);
  }
  return {
    phase,
    round,
    pair,
    position,
    variant,
    durationMs,
    observationSha256: sha256(canonicalJson(observation)),
    semanticCoverage: coverage,
  };
}

function runBenchmark(manifestPath) {
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  validateManifest(manifest);
  const runtime = verifyRuntime(manifest.machine.runtime);
  const sources = {
    A: resolveSource(manifest.machine.variants.A, 'A'),
    B: resolveSource(manifest.machine.variants.B, 'B'),
  };
  const runs = [];
  let position = 0;
  for (let warmup = 1; warmup <= manifest.machine.warmupPerVariant; warmup += 1) {
    for (const variant of ['A', 'B']) {
      runs.push(executeRun({
        machine: manifest.machine,
        source: sources[variant],
        variant,
        phase: 'warmup',
        round: warmup,
        pair: 0,
        position: position += 1,
        baseline: manifest.quality.semanticCoverage,
      }));
    }
  }
  for (let round = 1; round <= manifest.machine.rounds; round += 1) {
    for (const [index, variant] of ['A', 'B', 'B', 'A'].entries()) {
      runs.push(executeRun({
        machine: manifest.machine,
        source: sources[variant],
        variant,
        phase: 'measure',
        round,
        pair: Math.floor(index / 2) + 1,
        position: position += 1,
        baseline: manifest.quality.semanticCoverage,
      }));
    }
  }
  resolveSource(manifest.machine.variants.A, 'A after run');
  resolveSource(manifest.machine.variants.B, 'B after run');
  return {
    schemaVersion: 'archify.matched-ab.receipt.v1',
    createdAt: new Date().toISOString(),
    manifest: {
      schemaVersion: manifest.schemaVersion,
      benchmarkId: manifest.benchmarkId,
    },
    provenance: {
      manifestSha256: sha256(manifestBytes),
      fixedConfigSha256: sha256(canonicalJson(manifest.machine.fixedConfig)),
      runtime,
      sources,
    },
    schedule: {
      warmupPerVariant: manifest.machine.warmupPerVariant,
      rounds: manifest.machine.rounds,
      order: manifest.machine.order,
    },
    runs,
    summary: {
      A: summarizeVariant(runs, 'A'),
      B: summarizeVariant(runs, 'B'),
      paired: summarizePairs(runs),
    },
    quality: {
      ok: true,
      semanticCoverage: normalizeCoverage(
        manifest.quality.semanticCoverage,
        'quality.semanticCoverage',
      ),
    },
  };
}

function runQuality(args) {
  const baseline = readJson(option(args, '--baseline'));
  const candidate = readJson(option(args, '--candidate'));
  const report = compareSemanticCoverage(baseline, candidate);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 2;
}

function runMachine(args) {
  const manifestPath = path.resolve(option(args, '--manifest'));
  const receiptPath = path.resolve(option(args, '--receipt'));
  const receipt = runBenchmark(manifestPath);
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    receipt: receiptPath,
    summary: receipt.summary,
  }, null, 2)}\n`);
}

function validateDigest(value, label, errors) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    errors.push(`${label} must be a lowercase SHA-256 digest`);
  }
}

function validateDuration(value, label, errors) {
  if (!Number.isFinite(value) || value < 0) errors.push(`${label} must be a non-negative number`);
}

function rejectUnknownKeys(value, allowed, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) errors.push(`${label}.${key} is not allowed`);
  }
}

function validateAgentic(manifest, receipt) {
  const errors = [];
  rejectUnknownKeys(
    manifest,
    ['schemaVersion', 'benchmarkId', 'runId', 'variant', 'executionMode', 'fixedInputs'],
    'manifest',
    errors,
  );
  rejectUnknownKeys(
    receipt,
    [
      'schemaVersion',
      'benchmarkId',
      'runId',
      'variant',
      'measurement',
      'fixedInputs',
      'startedAtEpochMs',
      'endedAtEpochMs',
      'durationMs',
      'stages',
      'artifactSha256',
      'qualityReceiptSha256',
    ],
    'receipt',
    errors,
  );
  if (manifest?.schemaVersion !== 'archify.agentic-ab.manifest.v1') {
    errors.push('manifest.schemaVersion must be archify.agentic-ab.manifest.v1');
  }
  if (receipt?.schemaVersion !== 'archify.agentic-ab.receipt.v1') {
    errors.push('receipt.schemaVersion must be archify.agentic-ab.receipt.v1');
  }
  if (manifest?.executionMode !== 'observed-agent-run') {
    errors.push('manifest.executionMode must be observed-agent-run');
  }
  if (receipt?.measurement?.kind !== 'observed') {
    errors.push('receipt.measurement.kind must be observed');
  }
  if (receipt?.measurement?.clock !== 'epoch-ms') {
    errors.push('receipt.measurement.clock must be epoch-ms');
  }
  rejectUnknownKeys(receipt?.measurement, ['kind', 'clock'], 'receipt.measurement', errors);
  for (const field of ['benchmarkId', 'runId']) {
    if (typeof manifest?.[field] !== 'string' || manifest[field].length === 0) {
      errors.push(`manifest.${field} must be a non-empty string`);
    }
  }
  for (const field of ['benchmarkId', 'runId', 'variant']) {
    if (manifest?.[field] !== receipt?.[field]) {
      errors.push(`receipt.${field} must match manifest.${field}`);
    }
  }
  if (!['A', 'B'].includes(manifest?.variant)) {
    errors.push('manifest.variant must be A or B');
  }
  const fixedInputs = manifest?.fixedInputs;
  if (!fixedInputs || typeof fixedInputs !== 'object') {
    errors.push('manifest.fixedInputs must be an object');
  } else {
    rejectUnknownKeys(
      fixedInputs,
      [
        'projectRevision',
        'archifyRevision',
        'skillSha256',
        'promptSha256',
        'configSha256',
        'runtimeSha256',
        'model',
        'reasoningEffort',
      ],
      'manifest.fixedInputs',
      errors,
    );
    for (const field of ['projectRevision', 'archifyRevision', 'model', 'reasoningEffort']) {
      if (typeof fixedInputs[field] !== 'string' || fixedInputs[field].length === 0) {
        errors.push(`manifest.fixedInputs.${field} must be a non-empty string`);
      }
    }
    for (const field of ['skillSha256', 'promptSha256', 'configSha256', 'runtimeSha256']) {
      validateDigest(fixedInputs[field], `manifest.fixedInputs.${field}`, errors);
    }
  }
  if (canonicalJson(receipt?.fixedInputs) !== canonicalJson(fixedInputs)) {
    errors.push('receipt.fixedInputs must exactly match manifest.fixedInputs');
  }
  for (const field of ['startedAtEpochMs', 'endedAtEpochMs', 'durationMs']) {
    validateDuration(receipt?.[field], `receipt.${field}`, errors);
  }
  if (Number.isFinite(receipt?.startedAtEpochMs) && Number.isFinite(receipt?.endedAtEpochMs)
      && Number.isFinite(receipt?.durationMs)
      && receipt.endedAtEpochMs - receipt.startedAtEpochMs !== receipt.durationMs) {
    errors.push('receipt.durationMs must equal endedAtEpochMs - startedAtEpochMs');
  }
  if (!Array.isArray(receipt?.stages) || receipt.stages.length === 0) {
    errors.push('receipt.stages must be a non-empty array');
  } else {
    for (const [index, stage] of receipt.stages.entries()) {
      rejectUnknownKeys(
        stage,
        ['name', 'startedAtEpochMs', 'endedAtEpochMs', 'durationMs'],
        `receipt.stages[${index}]`,
        errors,
      );
      if (typeof stage?.name !== 'string' || stage.name.length === 0) {
        errors.push(`receipt.stages[${index}].name must be a non-empty string`);
      }
      for (const field of ['startedAtEpochMs', 'endedAtEpochMs', 'durationMs']) {
        validateDuration(stage?.[field], `receipt.stages[${index}].${field}`, errors);
      }
      if (Number.isFinite(stage?.startedAtEpochMs) && Number.isFinite(stage?.endedAtEpochMs)
          && Number.isFinite(stage?.durationMs)
          && stage.endedAtEpochMs - stage.startedAtEpochMs !== stage.durationMs) {
        errors.push(`receipt.stages[${index}].durationMs must match its timestamps`);
      }
      if (stage?.startedAtEpochMs < receipt?.startedAtEpochMs
          || stage?.endedAtEpochMs > receipt?.endedAtEpochMs) {
        errors.push(`receipt.stages[${index}] must fall within the observed run interval`);
      }
    }
  }
  validateDigest(receipt?.artifactSha256, 'receipt.artifactSha256', errors);
  validateDigest(receipt?.qualityReceiptSha256, 'receipt.qualityReceiptSha256', errors);
  return { ok: errors.length === 0, errors };
}

function runValidateAgentic(args) {
  const manifest = readJson(path.resolve(option(args, '--manifest')));
  const receipt = readJson(path.resolve(option(args, '--receipt')));
  const report = validateAgentic(manifest, receipt);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.ok ? 0 : 2;
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'quality') {
    runQuality(args);
    return;
  }
  if (command === 'run') {
    runMachine(args);
    return;
  }
  if (command === 'validate-agentic') {
    runValidateAgentic(args);
    return;
  }
  throw new Error('usage: matched-ab.mjs <quality|run|validate-agentic> [options]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
