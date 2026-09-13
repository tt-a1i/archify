#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const archifyCli = path.join(repoRoot, 'archify/bin/archify.mjs');
const COLLECTIONS = {
  architecture: { nodes: 'components', relationships: 'connections' },
  workflow: { nodes: 'nodes', relationships: 'edges' },
  sequence: { nodes: 'participants', relationships: 'messages' },
  dataflow: { nodes: 'nodes', relationships: 'flows' },
  lifecycle: { nodes: 'states', relationships: 'transitions' },
};
const PROMPT_CONTRACT_PHRASES = [
  'Write the final candidate to exactly `benchmark-candidate.json` in the repository root.',
  'Do not edit any other file.',
  'The candidate file, not the prose response, is the attempt 1 artifact.',
  'Do not copy a checked-in example.',
  'Use the bundled Archify CLI to validate and repair the candidate when shell access is available.',
  'The external harness will independently validate the frozen candidate.',
  'Do not claim that validation passed.',
];
const OPERATIONAL_FAILURES = new Set(['timeout', 'no_candidate', 'provider_error']);

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

function normalizeTechnicalLabel(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function technicalLabelMatches(actual, expected) {
  const normalizedActual = normalizeTechnicalLabel(actual);
  const normalizedExpected = normalizeTechnicalLabel(expected);
  if (!normalizedActual || !normalizedExpected) return false;
  const paddedActual = ` ${normalizedActual} `;
  const paddedExpected = ` ${normalizedExpected} `;
  return paddedActual.includes(` ${normalizedExpected} `)
    || paddedExpected.includes(` ${normalizedActual} `);
}

function relationshipMatches(candidate, requirement) {
  return candidate.from === requirement.from
    && candidate.to === requirement.to
    && (requirement.label === undefined || candidate.label === requirement.label)
    && (requirement.labels === undefined
      || requirement.labels.some((label) => technicalLabelMatches(candidate.label, label)))
    && (requirement.variant === undefined || candidate.variant === requirement.variant);
}

function bindRequiredNode(required, nodesById, nodes) {
  if (typeof required.id === 'string' && nodesById.has(required.id)) {
    return { node: nodesById.get(required.id), ambiguous: [] };
  }
  if (typeof required.key === 'string' && nodesById.has(required.key)) {
    return { node: nodesById.get(required.key), ambiguous: [] };
  }

  const acceptedLabels = (required.labels || [])
    .concat(required.label === undefined ? [] : [required.label])
    .map(normalizeTechnicalLabel)
    .filter(Boolean);
  if (acceptedLabels.length === 0) return { node: null, ambiguous: [] };

  let matches = nodes.filter(
    (node) => acceptedLabels.some((label) => technicalLabelMatches(node.label, label)),
  );
  if (matches.length > 1) {
    for (const [acceptedField, actualField] of [['sublabels', 'sublabel'], ['tags', 'tag']]) {
      const accepted = (required[acceptedField] || [])
        .concat(required[actualField] === undefined ? [] : [required[actualField]])
        .map(normalizeTechnicalLabel)
        .filter(Boolean);
      if (accepted.length === 0) continue;
      const narrowed = matches.filter(
        (node) => accepted.some((value) => technicalLabelMatches(node[actualField], value)),
      );
      if (narrowed.length > 0) matches = narrowed;
    }
  }
  if (matches.length === 1) return { node: matches[0], ambiguous: [] };
  if (matches.length > 1) return { node: null, ambiguous: matches.map((node) => node.id) };
  return { node: null, ambiguous: [] };
}

function evaluateSemantic(benchmarkCase, candidate) {
  const requirements = benchmarkCase.requirements || {};
  const collections = COLLECTIONS[benchmarkCase.diagram_type];
  const nodes = candidate[collections.nodes] || [];
  const relationships = candidate[collections.relationships] || [];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(nodesById.keys());
  const requiredNodeIds = [
    ...(requirements.node_ids || []),
    ...(requirements.nodes || [])
      .filter((node) => typeof node.id === 'string' && typeof node.key !== 'string')
      .map((node) => node.id),
  ];
  const missingNodeIds = [...new Set(requiredNodeIds.filter((id) => !nodeIds.has(id)))];
  const bindings = {};
  const ambiguousNodes = [];
  const mismatchedNodes = [];
  for (const required of requirements.nodes || []) {
    const identity = required.key || required.id;
    const binding = bindRequiredNode(required, nodesById, nodes);
    if (binding.ambiguous.length > 0) {
      ambiguousNodes.push({ key: identity, candidateIds: binding.ambiguous });
      continue;
    }
    const actual = binding.node;
    if (!actual) {
      if (typeof identity === 'string' && !missingNodeIds.includes(identity)) {
        missingNodeIds.push(identity);
      }
      continue;
    }
    if (typeof required.key === 'string') bindings[required.key] = actual.id;
    for (const field of ['type', 'label', 'sublabel', 'tag']) {
      if (required[field] !== undefined && actual[field] !== required[field]) {
        mismatchedNodes.push({
          id: identity,
          field,
          expected: required[field],
          actual: actual[field] ?? null,
        });
      }
    }
    if (Array.isArray(required.types) && !required.types.includes(actual.type)) {
      mismatchedNodes.push({
        id: identity,
        field: 'type',
        expected: required.types,
        actual: actual.type ?? null,
      });
    }
  }
  const missingRelationships = (requirements.relationships || []).filter((relationship) => {
    const resolved = {
      ...relationship,
      from: bindings[relationship.from] || relationship.from,
      to: bindings[relationship.to] || relationship.to,
    };
    return !relationships.some(
      (candidateRelationship) => relationshipMatches(candidateRelationship, resolved),
    );
  });
  const ok = missingNodeIds.length === 0
    && ambiguousNodes.length === 0
    && mismatchedNodes.length === 0
    && missingRelationships.length === 0;
  return {
    ok,
    bindings,
    missingNodeIds,
    ambiguousNodes,
    mismatchedNodes,
    missingRelationships,
  };
}

function validateCandidate(benchmarkCase, candidateFile) {
  const validated = spawnSync(process.execPath, [
    archifyCli,
    'validate',
    benchmarkCase.diagram_type,
    path.resolve(candidateFile),
    '--quality',
    benchmarkCase.quality_profile || 'showcase',
    '--json',
  ], {
    cwd: path.join(repoRoot, 'archify'),
    encoding: 'utf8',
  });
  const receipt = JSON.parse(validated.stdout);
  return {
    ok: validated.status === 0 && receipt.ok === true,
    checksPassed: Array.isArray(receipt.checks)
      ? receipt.checks.filter((check) => check.ok).length
      : 0,
    composition: {
      errors: receipt.composition?.summary?.errors ?? null,
      warnings: receipt.composition?.summary?.warnings ?? null,
    },
  };
}

function verify(args) {
  const caseFile = option(args, '--case');
  const candidateFile = option(args, '--candidate');
  const runFile = option(args, '--run');
  if (!caseFile || !candidateFile || !runFile) {
    throw new Error('verify requires --case, --candidate, and --run');
  }

  const benchmarkCase = readJson(caseFile);
  const candidate = readJson(candidateFile);
  const run = readJson(runFile);
  if (run.case_id !== benchmarkCase.id) {
    throw new BenchmarkError(
      'RUN_CASE_MISMATCH',
      `run case_id "${run.case_id}" does not match benchmark case "${benchmarkCase.id}"`,
    );
  }
  const semantic = evaluateSemantic(benchmarkCase, candidate);
  const validation = validateCandidate(benchmarkCase, candidateFile);
  let visualReview = {
    status: run.visual_review?.status || 'skipped',
    reviewer: run.visual_review?.reviewer || null,
    defects: Array.isArray(run.visual_review?.defects) ? run.visual_review.defects : [],
  };
  if (visualReview.status === 'passed'
      && (typeof visualReview.reviewer !== 'string' || visualReview.reviewer.trim() === '')) {
    visualReview = {
      ...visualReview,
      status: 'invalid',
      reviewer: null,
      reason: 'passed visual review requires a non-empty reviewer identity',
    };
  }
  if (visualReview.status === 'passed' && !Array.isArray(run.visual_review?.defects)) {
    visualReview = {
      ...visualReview,
      status: 'invalid',
      reason: 'passed visual review requires an explicit defects array',
    };
  }
  const firstPassUsable = run.attempt === 1
    && semantic.ok
    && validation.ok
    && visualReview.status === 'passed'
    && visualReview.defects.length === 0;

  const receipt = {
    schemaVersion: 1,
    benchmark: 'ordinary-model-floor',
    caseId: benchmarkCase.id,
    operational: { status: 'candidate_produced' },
    run: {
      agent: run.agent,
      model: run.model,
      attempt: run.attempt,
    },
    gates: {
      semantic: {
        ...semantic,
      },
      validation,
      visualReview,
    },
    firstPassUsable,
  };
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  process.exitCode = firstPassUsable ? 0 : 1;
}

function recordFailure(args) {
  const caseFile = option(args, '--case');
  const runFile = option(args, '--run');
  const reason = option(args, '--failure');
  if (!caseFile || !runFile || !reason) {
    throw new Error('record-failure requires --case, --run, and --failure');
  }
  if (!OPERATIONAL_FAILURES.has(reason)) {
    throw new BenchmarkError(
      'INVALID_OPERATIONAL_FAILURE',
      `failure must be one of ${[...OPERATIONAL_FAILURES].join(', ')}`,
    );
  }

  const benchmarkCase = readJson(caseFile);
  const run = readJson(runFile);
  if (run.case_id !== benchmarkCase.id) {
    throw new BenchmarkError(
      'RUN_CASE_MISMATCH',
      `run case_id "${run.case_id}" does not match benchmark case "${benchmarkCase.id}"`,
    );
  }
  if (typeof run.agent !== 'string' || run.agent.trim() === ''
      || typeof run.model !== 'string' || run.model.trim() === '') {
    throw new BenchmarkError('INVALID_RUN', 'run agent and model must be non-empty strings');
  }
  if (run.attempt !== 1) {
    throw new BenchmarkError('NON_FIRST_PASS_RESULT', 'operational failures must record attempt 1');
  }

  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    benchmark: 'ordinary-model-floor',
    caseId: benchmarkCase.id,
    operational: { status: 'failed', reason },
    run: {
      agent: run.agent,
      model: run.model,
      attempt: run.attempt,
    },
    gates: {
      semantic: { ok: false, status: 'not_run' },
      validation: { ok: false, status: 'not_run' },
      visualReview: {
        status: 'skipped',
        reviewer: null,
        defects: [],
        reason: 'candidate was not produced',
      },
    },
    firstPassUsable: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function check(args) {
  const manifestFile = option(args, '--manifest');
  if (!manifestFile) throw new Error('check requires --manifest');
  const absoluteManifest = path.resolve(manifestFile);
  const manifestDirectory = path.dirname(absoluteManifest);
  const manifest = readJson(absoluteManifest);
  const cases = (manifest.cases || []).map((entry) => {
    const caseFile = path.resolve(manifestDirectory, entry.case);
    const promptFile = path.resolve(manifestDirectory, entry.prompt);
    const candidateFile = path.resolve(manifestDirectory, entry.reference_fixture);
    const benchmarkCase = readJson(caseFile);
    const candidate = readJson(candidateFile);
    const semantic = evaluateSemantic(benchmarkCase, candidate);
    const validation = validateCandidate(benchmarkCase, candidateFile);
    const prompt = fs.readFileSync(promptFile, 'utf8').trim();
    return {
      caseId: benchmarkCase.id,
      diagramType: benchmarkCase.diagram_type,
      promptOk: prompt.length >= 200
        && PROMPT_CONTRACT_PHRASES.every((phrase) => prompt.includes(phrase)),
      semanticOk: semantic.ok,
      validationOk: validation.ok,
    };
  });
  const diagramTypes = [...new Set(cases.map((item) => item.diagramType))].sort();
  const ok = manifest.purpose === 'suite-integrity'
    && manifest.evidence_eligible === false
    && cases.length > 0
    && cases.every((item) => item.promptOk && item.semanticOk && item.validationOk);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    benchmark: 'ordinary-model-floor',
    suiteId: manifest.id,
    purpose: manifest.purpose,
    evidenceEligible: manifest.evidence_eligible,
    caseCount: cases.length,
    diagramTypes,
    cases,
  }, null, 2)}\n`);
  process.exitCode = ok ? 0 : 1;
}

function newSummary() {
  return {
    runs: 0,
    firstPassUsable: 0,
    firstPassUsableRate: 0,
    failureClusters: {
      semantic: 0,
      validation: 0,
      visualReview: 0,
      operational: 0,
    },
  };
}

function addResult(summary, result) {
  summary.runs += 1;
  if (result.firstPassUsable === true) summary.firstPassUsable += 1;
  if (result.operational?.status === 'failed') {
    summary.failureClusters.operational += 1;
  } else {
    if (result.gates?.semantic?.ok !== true) summary.failureClusters.semantic += 1;
    if (result.gates?.validation?.ok !== true) summary.failureClusters.validation += 1;
    if (result.gates?.visualReview?.status !== 'passed'
        || (result.gates?.visualReview?.defects || []).length > 0) {
      summary.failureClusters.visualReview += 1;
    }
  }
  summary.firstPassUsableRate = summary.runs === 0
    ? 0
    : summary.firstPassUsable / summary.runs;
}

function validateResult(result) {
  if (result?.schemaVersion !== 1 || result?.benchmark !== 'ordinary-model-floor') {
    throw new BenchmarkError('INVALID_RESULT', 'result is not an ordinary-model-floor v1 receipt');
  }
  if (typeof result.caseId !== 'string' || result.caseId.trim() === '') {
    throw new BenchmarkError('INVALID_RESULT', 'result caseId must be a non-empty string');
  }
  if (typeof result.run?.agent !== 'string' || result.run.agent.trim() === ''
      || typeof result.run?.model !== 'string' || result.run.model.trim() === '') {
    throw new BenchmarkError('INVALID_RESULT', 'result agent and model must be non-empty strings');
  }
  if (result.run.attempt !== 1) {
    throw new BenchmarkError(
      'NON_FIRST_PASS_RESULT',
      `result for ${result.run.agent}/${result.run.model}/${result.caseId} is not attempt 1`,
    );
  }
  const operationalFailed = result.operational?.status === 'failed';
  if (result.operational !== undefined
      && result.operational.status !== 'candidate_produced'
      && !operationalFailed) {
    throw new BenchmarkError('INVALID_RESULT', 'result operational status is invalid');
  }
  if (operationalFailed && !OPERATIONAL_FAILURES.has(result.operational.reason)) {
    throw new BenchmarkError('INVALID_RESULT', 'result operational failure reason is invalid');
  }
  const visual = result.gates?.visualReview;
  const derivedFirstPassUsable = !operationalFailed
    && result.gates?.semantic?.ok === true
    && result.gates?.validation?.ok === true
    && visual?.status === 'passed'
    && typeof visual.reviewer === 'string'
    && visual.reviewer.trim() !== ''
    && Array.isArray(visual.defects)
    && visual.defects.length === 0;
  if (result.firstPassUsable !== derivedFirstPassUsable) {
    throw new BenchmarkError(
      'INCONSISTENT_RESULT',
      `result for ${result.run.agent}/${result.run.model}/${result.caseId} has an inconsistent firstPassUsable value`,
    );
  }
}

function report(args) {
  const resultsFile = option(args, '--results');
  if (!resultsFile) throw new Error('report requires --results');
  const manifestFile = option(args, '--manifest');
  const manifest = manifestFile ? readJson(manifestFile) : null;
  const manifestDirectory = manifestFile ? path.dirname(path.resolve(manifestFile)) : null;
  const expectedCaseIds = manifest
    ? new Set(manifest.cases.map((entry) => readJson(path.resolve(manifestDirectory, entry.case)).id))
    : null;
  const results = fs.readFileSync(path.resolve(resultsFile), 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const overall = newSummary();
  const configurations = new Map();
  const seen = new Set();
  const caseIdsByConfiguration = new Map();
  for (const result of results) {
    validateResult(result);
    const resultKey = `${result.run.agent}\u0000${result.run.model}\u0000${result.caseId}`;
    if (seen.has(resultKey)) {
      throw new BenchmarkError(
        'DUPLICATE_RESULT',
        `duplicate result for ${result.run.agent}/${result.run.model}/${result.caseId}`,
      );
    }
    seen.add(resultKey);
    addResult(overall, result);
    const key = `${result.run.agent}\u0000${result.run.model}`;
    if (!configurations.has(key)) {
      configurations.set(key, {
        agent: result.run.agent,
        model: result.run.model,
        ...newSummary(),
      });
    }
    addResult(configurations.get(key), result);
    if (!caseIdsByConfiguration.has(key)) caseIdsByConfiguration.set(key, new Set());
    caseIdsByConfiguration.get(key).add(result.caseId);
  }
  const byConfiguration = [...configurations.values()]
    .sort((left, right) => `${left.agent}\u0000${left.model}`.localeCompare(`${right.agent}\u0000${right.model}`));
  const coverage = expectedCaseIds
    ? byConfiguration.map(({ agent, model }) => {
      const presentCaseIds = caseIdsByConfiguration.get(`${agent}\u0000${model}`) || new Set();
      const missingCaseIds = [...expectedCaseIds].filter((caseId) => !presentCaseIds.has(caseId)).sort();
      const unexpectedCaseIds = [...presentCaseIds].filter((caseId) => !expectedCaseIds.has(caseId)).sort();
      return {
        agent,
        model,
        expected: expectedCaseIds.size,
        present: presentCaseIds.size,
        missingCaseIds,
        unexpectedCaseIds,
        complete: missingCaseIds.length === 0 && unexpectedCaseIds.length === 0,
      };
    })
    : [];
  const evidenceEligible = manifest !== null
    && coverage.length > 0
    && coverage.every((item) => item.complete);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    benchmark: 'ordinary-model-floor',
    suiteId: manifest?.id ?? null,
    evidenceEligible,
    coverage,
    overall,
    byConfiguration,
  }, null, 2)}\n`);
}

function fail(error) {
  const code = error instanceof BenchmarkError ? error.code : 'INTERNAL_ERROR';
  const message = error instanceof Error ? error.message : String(error);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    benchmark: 'ordinary-model-floor',
    error: { code, message },
  }, null, 2)}\n`);
  process.exitCode = 2;
}

try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'verify') {
    verify(args);
  } else if (command === 'record-failure') {
    recordFailure(args);
  } else if (command === 'check') {
    check(args);
  } else if (command === 'report') {
    report(args);
  } else {
    throw new BenchmarkError(
      'USAGE',
      'usage: benchmark.mjs <verify|record-failure|check|report> [options]',
    );
  }
} catch (error) {
  fail(error);
}
