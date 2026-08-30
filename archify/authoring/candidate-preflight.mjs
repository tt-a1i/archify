import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { authoredLanguageAssessment } from './authored-language.mjs';
import { createRepairPlan } from './repair-plan.mjs';
import { pathsAlias } from '../renderers/shared/output-path.mjs';
import {
  VISUAL_PREFLIGHT_VIEWPORTS,
  VISUAL_RECEIPT_SCHEMA_VERSION,
  VisualCheckSession,
} from '../bin/visual-check.mjs';

const TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/;

function failureDiagnostic(code, message, evidence = {}) {
  return { code, severity: 'error', message, subject: {}, evidence, supportedFixes: [] };
}

function rendererFailure(result) {
  try {
    const parsed = JSON.parse((result.stderr || '').trim());
    if (parsed?.ok === false && Array.isArray(parsed.diagnostics)) return parsed.diagnostics;
  } catch {
    // Fall through to one bounded process diagnostic.
  }
  return [failureDiagnostic(
    result.error ? 'internal/renderer-process' : 'internal/unclassified',
    result.error?.message || 'Renderer failed before emitting structured diagnostics.',
    { exitCode: result.status ?? 1 },
  )];
}

function checkerDiagnostics(checker) {
  const issues = (checker?.composition?.issues || []).filter((issue) => issue?.severity === 'error');
  if (issues.length) {
    return issues.map((issue) => ({
      code: issue.code || 'composition/constraint',
      severity: 'error',
      message: issue.message || `Final artifact failed ${issue.code || 'a composition constraint'}.`,
      subject: issue.subject || {},
      evidence: issue.evidence || Object.fromEntries(Object.entries(issue).filter(([key]) => !['code', 'severity', 'message', 'subject', 'supportedFixes'].includes(key))),
      supportedFixes: issue.supportedFixes || [],
    }));
  }
  return [failureDiagnostic('artifact/check-failed', 'Final artifact check failed.', {
    checks: (checker?.checks || []).filter((check) => check?.ok !== true).map((check) => check.name),
  })];
}

function ephemeralPreflight(receipt) {
  const normalized = receipt && typeof receipt === 'object' && !Array.isArray(receipt) ? receipt : {};
  return {
    ...normalized,
    artifact: { ...normalized.artifact, ephemeral: true },
    captures: { ...normalized.captures, retained: false },
    sidecars: { ...normalized.sidecars, retained: false },
  };
}

function normalizeCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error('Candidate preflight requires a non-empty candidates array.');
  }
  const ids = new Set();
  return candidates.map((candidate, index) => {
    const id = candidate?.id ?? `candidate-${index + 1}`;
    if (!SAFE_ID.test(id) || ids.has(id)) throw new Error(`Candidate id must be unique and match ${SAFE_ID}: ${id}`);
    ids.add(id);
    if (!TYPES.has(candidate?.type)) throw new Error(`Unknown candidate type ${JSON.stringify(candidate?.type)}.`);
    if (typeof candidate?.input !== 'string' || !candidate.input.trim()) throw new Error(`Candidate ${id} requires input.`);
    if (candidate.repoRoot && candidate.type !== 'architecture') {
      throw new Error(`Candidate ${id}: repoRoot is supported for architecture only.`);
    }
    if (candidate.requiredLanguage !== undefined && !['en', 'zh-CN'].includes(candidate.requiredLanguage)) {
      throw new Error(`Candidate ${id}: requiredLanguage must be en or zh-CN.`);
    }
    if (candidate.repairHistory !== undefined
      && (typeof candidate.repairHistory !== 'string' || !candidate.repairHistory.trim())) {
      throw new Error(`Candidate ${id}: repairHistory must be a path.`);
    }
    if (candidate.repairMode !== undefined
      && !['focused', 'structural-reflow'].includes(candidate.repairMode)) {
      throw new Error(`Candidate ${id}: repairMode must be focused or structural-reflow.`);
    }
    return {
      id,
      type: candidate.type,
      input: path.resolve(candidate.input),
      ...(candidate.repoRoot ? { repoRoot: path.resolve(candidate.repoRoot) } : {}),
      ...(candidate.requiredLanguage ? { requiredLanguage: candidate.requiredLanguage } : {}),
      ...(candidate.repairHistory ? { repairHistory: path.resolve(candidate.repairHistory) } : {}),
      repairMode: candidate.repairMode || 'focused',
    };
  });
}

function candidateAttemptHistory(candidate) {
  if (!candidate.repairHistory) return [];
  if (pathsAlias(candidate.repairHistory, candidate.input)) {
    throw new Error('Repair history must not replace or alias its candidate input.');
  }
  let document;
  try {
    document = JSON.parse(fs.readFileSync(candidate.repairHistory, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  if (document?.schemaVersion !== 1 || !Array.isArray(document.attempts)
    || document.type !== candidate.type
    || path.resolve(document.input) !== candidate.input) {
    throw new Error(`Repair history does not belong to ${candidate.type} ${candidate.input}.`);
  }
  return document.attempts.slice(-63);
}

function persistCandidateAttempt(candidate, attemptHistory, attempt) {
  if (!candidate.repairHistory) return null;
  if (pathsAlias(candidate.repairHistory, candidate.input)) {
    throw new Error('Repair history must not replace or alias its candidate input.');
  }
  const attempts = [...attemptHistory, attempt].slice(-64);
  const document = {
    schemaVersion: 1,
    type: candidate.type,
    input: candidate.input,
    attempts,
  };
  fs.mkdirSync(path.dirname(candidate.repairHistory), { recursive: true });
  const temporary = `${candidate.repairHistory}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, candidate.repairHistory);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return { path: candidate.repairHistory, loadedAttemptCount: attemptHistory.length, attemptCount: attempts.length };
}

function failedReceipt({ candidate, stage, diagnostics, checker, preflight, specification, specificationReceipt, artifactReceipt, timing, authoredLanguage, attemptHistory = [], persistRepairHistory = true }) {
  let repairHistory = null;
  let repairPlan;
  try {
    if (persistRepairHistory) {
      repairHistory = persistCandidateAttempt(candidate, attemptHistory, {
        stage,
        repairMode: candidate.repairMode,
        errorCount: diagnostics.length,
        diagnostics,
      });
    }
    repairPlan = createRepairPlan({
      type: candidate.type,
      candidate: specification,
      stage,
      diagnostics,
      preflight,
      attemptHistory,
      repairMode: candidate.repairMode,
    });
  } catch (error) {
    repairPlan = {
      schemaVersion: 1,
      type: candidate.type,
      stage,
      status: 'unavailable',
      reason: error.message,
      actions: [],
    };
  }
  return {
    schemaVersion: 1,
    ok: false,
    command: 'validate',
    id: candidate.id,
    type: candidate.type,
    input: candidate.input,
    ...(specificationReceipt ? { specification: specificationReceipt } : {}),
    ...(artifactReceipt ? { artifact: artifactReceipt } : {}),
    stage,
    diagnostics,
    repairPlan,
    ...(authoredLanguage ? { authoredLanguage } : {}),
    ...(repairHistory ? { repairHistory } : {}),
    ...(checker ? { checker } : {}),
    ...(preflight ? { preflight } : {}),
    ...(timing ? { timing } : {}),
  };
}

function elapsed(started) {
  return Number((performance.now() - started).toFixed(3));
}

function finishCandidateTiming(timing) {
  const durationMs = timing.inputMs + timing.renderMs + timing.checkMs + timing.preflightMs;
  return { ...timing, durationMs: Number(durationMs.toFixed(3)) };
}

function ephemeralArtifactReceipt(artifactPath) {
  const artifact = fs.readFileSync(artifactPath);
  return {
    bytes: artifact.byteLength,
    sha256: createHash('sha256').update(artifact).digest('hex'),
    ephemeral: true,
  };
}

function artifactIdentityDiagnostic(expected, actual, error, boundary) {
  return failureDiagnostic(
    'artifact/changed',
    `Rendered artifact identity changed ${boundary}; candidate preflight failed closed.`,
    {
      expected: { bytes: expected.bytes, sha256: expected.sha256 },
      ...(actual ? { actual: { bytes: actual.bytes, sha256: actual.sha256 } } : {}),
      ...(error ? { reason: error.message, ...(error.code ? { systemCode: error.code } : {}) } : {}),
    },
  );
}

function exactPreflightMatrix(entries, keyFor) {
  if (!Array.isArray(entries) || entries.length !== VISUAL_PREFLIGHT_VIEWPORTS.length) return false;
  if (entries.some((entry) => !Number.isInteger(entry?.width) || !Number.isInteger(entry?.height))) return false;
  const expected = new Set(VISUAL_PREFLIGHT_VIEWPORTS.map(({ width, height }) => `${width}x${height}:light`));
  const actual = new Set(entries.map(keyFor));
  return actual.size === expected.size && [...expected].every((key) => actual.has(key));
}

export function successfulPreflightReceiptProblems(receipt, { artifactPath, artifactReceipt }) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    return ['receipt must be an object'];
  }
  const problems = [];
  if (receipt.schemaVersion !== VISUAL_RECEIPT_SCHEMA_VERSION) {
    problems.push(`schemaVersion must be ${VISUAL_RECEIPT_SCHEMA_VERSION}`);
  }
  if (receipt.command !== 'visual-preflight') problems.push('command must be visual-preflight');
  if (receipt.ok !== true) problems.push('ok must be true');
  if (receipt.status !== 'pass') problems.push('status must be pass');
  if (!Array.isArray(receipt.automatedChecks)
    || receipt.automatedChecks.length !== 1
    || receipt.automatedChecks[0] !== 'containment') {
    problems.push('automatedChecks must contain only containment');
  }

  const artifact = receipt.artifact;
  let expectedArtifactPath = null;
  try {
    if (typeof artifactPath === 'string') expectedArtifactPath = path.resolve(artifactPath);
  } catch {
    expectedArtifactPath = null;
  }
  let reportedArtifactPath = null;
  try {
    if (typeof artifact?.path === 'string') reportedArtifactPath = path.resolve(artifact.path);
  } catch {
    reportedArtifactPath = null;
  }
  if (reportedArtifactPath !== expectedArtifactPath
    || artifact?.bytes !== artifactReceipt.bytes
    || artifact?.sha256 !== artifactReceipt.sha256) {
    problems.push('artifact path, bytes, and sha256 must match the rendered artifact');
  }
  const verification = artifact?.verification;
  if (verification?.unchanged !== true
    || verification?.before?.bytes !== artifactReceipt.bytes
    || verification?.before?.sha256 !== artifactReceipt.sha256
    || verification?.after?.bytes !== artifactReceipt.bytes
    || verification?.after?.sha256 !== artifactReceipt.sha256) {
    problems.push('artifact verification must prove identical before and after bytes');
  }

  const state = receipt.state;
  if (state?.status !== 'pass'
    || state?.detail !== 'read'
    || state?.motion !== 'still'
    || state?.theme !== 'light') {
    problems.push('state must report passing light READ/Still mode');
  }
  if (!exactPreflightMatrix(
    state?.observations,
    (entry) => `${entry?.width}x${entry?.height}:${entry?.requestedTheme}`,
  ) || state.observations.some((entry) => (
    entry?.requestedTheme !== 'light'
      || entry?.resolvedTheme !== 'light'
      || entry?.detailLevel !== 'read'
      || entry?.motion !== 'still'
      || entry?.ok !== true
  ))) {
    problems.push('state observations must be the exact four-viewport light READ/Still matrix');
  }

  const containment = receipt.containment;
  if (containment?.status !== 'pass') problems.push('containment status must be pass');
  if (!exactPreflightMatrix(
    containment?.viewports,
    (entry) => `${entry?.width}x${entry?.height}:${entry?.theme}`,
  ) || containment.viewports.some((entry) => (
    entry?.theme !== 'light'
      || entry?.requestedTheme !== 'light'
      || entry?.resolvedTheme !== 'light'
      || entry?.detailLevel !== 'read'
      || entry?.motion !== 'still'
      || entry?.themeStateOk !== true
      || entry?.detailStateOk !== true
      || entry?.motionStateOk !== true
      || entry?.stateOk !== true
      || entry?.ok !== true
  ))) {
    problems.push('containment must be the exact four-viewport resolved-light matrix');
  }
  return problems;
}

function invalidPreflightReceiptDiagnostic(problems) {
  return failureDiagnostic(
    'preflight/receipt-invalid',
    'Browser preflight did not return a complete structured receipt.',
    {
      expectedSchemaVersion: VISUAL_RECEIPT_SCHEMA_VERSION,
      problems,
    },
  );
}

/** Freeze, render, and check several candidates, then preflight digest-bound artifacts in one Chrome session. */
export async function runCandidatePreflightBatch({
  candidates,
  skillRoot,
  quality = 'showcase',
  session,
  sessionFactory = () => new VisualCheckSession(),
} = {}) {
  const batchStartedAt = new Date().toISOString();
  const batchStarted = performance.now();
  const normalized = normalizeCandidates(candidates);
  if (!['standard', 'showcase'].includes(quality)) throw new Error('quality must be standard or showcase.');
  const root = path.resolve(skillRoot);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-candidate-preflight-'));
  const prepared = [];
  const receipts = [];
  let activeSession = session;
  const ownsSession = !session;
  let browserRestarts = 0;
  try {
    for (const candidate of normalized) {
      const timing = { source: 'candidate-preflight', inputMs: 0, renderMs: 0, checkMs: 0, preflightMs: 0 };
      let specification = null;
      let specificationReceipt = null;
      let frozenInput = null;
      let authoredLanguage = null;
      let attemptHistory = [];
      const inputStarted = performance.now();
      try {
        attemptHistory = candidateAttemptHistory(candidate);
      } catch (error) {
        timing.inputMs = elapsed(inputStarted);
        const diagnostics = [failureDiagnostic('input/read', `Repair history could not be read: ${error.message}`)];
        receipts.push(failedReceipt({
          candidate,
          stage: 'input',
          diagnostics,
          specification,
          persistRepairHistory: false,
          timing: finishCandidateTiming(timing),
        }));
        continue;
      }
      try {
        const bytes = fs.readFileSync(candidate.input);
        specification = JSON.parse(bytes.toString('utf8'));
        specificationReceipt = {
          bytes: bytes.byteLength,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        };
        frozenInput = path.join(temporary, `${candidate.id}.candidate.json`);
        fs.writeFileSync(frozenInput, bytes, { flag: 'wx', mode: 0o400 });
        timing.inputMs = elapsed(inputStarted);
      } catch (error) {
        timing.inputMs = elapsed(inputStarted);
        const diagnostics = [failureDiagnostic('input/read', `Input could not be read: ${error.message}`)];
        receipts.push(failedReceipt({
          candidate,
          stage: 'input',
          diagnostics,
          specification,
          attemptHistory,
          timing: finishCandidateTiming(timing),
        }));
        continue;
      }
      if (candidate.requiredLanguage) {
        const assessment = authoredLanguageAssessment(specification, candidate.requiredLanguage);
        authoredLanguage = assessment.receipt;
        if (assessment.diagnostics.length > 0) {
          receipts.push(failedReceipt({
            candidate,
            stage: 'language',
            diagnostics: assessment.diagnostics,
            specification,
            specificationReceipt,
            authoredLanguage,
            attemptHistory,
            timing: finishCandidateTiming(timing),
          }));
          continue;
        }
      }
      const artifactPath = path.join(temporary, `${candidate.id}.html`);
      const renderer = path.join(root, 'renderers', candidate.type, `render-${candidate.type}.mjs`);
      const renderStarted = performance.now();
      const render = spawnSync(process.execPath, [renderer, frozenInput, artifactPath], {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          ARCHIFY_QUALITY_PROFILE: quality,
          ARCHIFY_DIAGNOSTIC_FORMAT: 'json',
          ...(candidate.repoRoot ? { ARCHIFY_REPO_ROOT: candidate.repoRoot } : {}),
        },
      });
      timing.renderMs = elapsed(renderStarted);
      if (render.status !== 0) {
        receipts.push(failedReceipt({
          candidate,
          stage: 'render',
          diagnostics: rendererFailure(render),
          specification,
          specificationReceipt,
          authoredLanguage,
          attemptHistory,
          timing: finishCandidateTiming(timing),
        }));
        continue;
      }
      let artifactReceipt;
      try {
        artifactReceipt = ephemeralArtifactReceipt(artifactPath);
      } catch (error) {
        receipts.push(failedReceipt({
          candidate,
          stage: 'artifact',
          diagnostics: [failureDiagnostic('artifact/read', `Rendered artifact could not be read: ${error.message}`)],
          specification,
          specificationReceipt,
          authoredLanguage,
          attemptHistory,
          timing: finishCandidateTiming(timing),
        }));
        continue;
      }
      const checkStarted = performance.now();
      const check = spawnSync(process.execPath, [path.join(root, 'scripts', 'check-render-output.mjs'), artifactPath], {
        cwd: root,
        encoding: 'utf8',
      });
      timing.checkMs = elapsed(checkStarted);
      let checker = null;
      try {
        checker = JSON.parse(check.stdout);
      } catch {
        checker = { ok: false, checks: [], composition: null };
      }
      if (check.status !== 0 || checker?.ok !== true) {
        receipts.push(failedReceipt({
          candidate,
          stage: 'check',
          diagnostics: checkerDiagnostics(checker),
          checker,
          specification,
          specificationReceipt,
          artifactReceipt,
          authoredLanguage,
          attemptHistory,
          timing: finishCandidateTiming(timing),
        }));
        continue;
      }
      let checkedArtifactReceipt = null;
      let artifactIdentityError = null;
      try {
        checkedArtifactReceipt = ephemeralArtifactReceipt(artifactPath);
      } catch (error) {
        artifactIdentityError = error;
      }
      if (artifactIdentityError
        || checkedArtifactReceipt.bytes !== artifactReceipt.bytes
        || checkedArtifactReceipt.sha256 !== artifactReceipt.sha256) {
        receipts.push(failedReceipt({
          candidate,
          stage: 'check',
          diagnostics: [artifactIdentityDiagnostic(
            artifactReceipt,
            checkedArtifactReceipt,
            artifactIdentityError,
            'during deterministic checking',
          )],
          checker,
          specification,
          specificationReceipt,
          artifactReceipt,
          authoredLanguage,
          attemptHistory,
          timing: finishCandidateTiming(timing),
        }));
        continue;
      }
      prepared.push({ candidate, specification, specificationReceipt, artifactReceipt, artifactPath, checker, timing, authoredLanguage, attemptHistory });
    }

    if (prepared.length > 0) {
      activeSession ||= sessionFactory();
      for (const [index, entry] of prepared.entries()) {
        activeSession ||= sessionFactory();
        const preflightStarted = performance.now();
        const result = await activeSession.preflight({
          artifactPath: entry.artifactPath,
          finalArtifact: index === prepared.length - 1,
        });
        if (ownsSession && activeSession?.poisoned && index < prepared.length - 1) {
          await activeSession.close().catch(() => {});
          activeSession = null;
          browserRestarts += 1;
        }
        entry.timing.preflightMs = elapsed(preflightStarted);
        const timing = finishCandidateTiming(entry.timing);
        const preflight = ephemeralPreflight(result?.receipt);
        let finalArtifactReceipt = null;
        let finalArtifactError = null;
        try {
          finalArtifactReceipt = ephemeralArtifactReceipt(entry.artifactPath);
        } catch (error) {
          finalArtifactError = error;
        }
        const finalIdentityMatches = finalArtifactReceipt?.bytes === entry.artifactReceipt.bytes
          && finalArtifactReceipt?.sha256 === entry.artifactReceipt.sha256;
        if (!finalIdentityMatches) {
          receipts.push(failedReceipt({
            candidate: entry.candidate,
            stage: 'preflight',
            diagnostics: [artifactIdentityDiagnostic(
              entry.artifactReceipt,
              finalArtifactReceipt,
              finalArtifactError,
              'during browser preflight',
            )],
            checker: entry.checker,
            preflight,
            specification: entry.specification,
            specificationReceipt: entry.specificationReceipt,
            artifactReceipt: entry.artifactReceipt,
            authoredLanguage: entry.authoredLanguage,
            attemptHistory: entry.attemptHistory,
            timing,
          }));
          continue;
        }
        if (result?.exitCode === 0) {
          const receiptProblems = successfulPreflightReceiptProblems(result.receipt, {
            artifactPath: entry.artifactPath,
            artifactReceipt: entry.artifactReceipt,
          });
          if (receiptProblems.length > 0) {
            receipts.push(failedReceipt({
              candidate: entry.candidate,
              stage: 'preflight',
              diagnostics: [invalidPreflightReceiptDiagnostic(receiptProblems)],
              checker: entry.checker,
              preflight,
              specification: entry.specification,
              specificationReceipt: entry.specificationReceipt,
              artifactReceipt: entry.artifactReceipt,
              authoredLanguage: entry.authoredLanguage,
              attemptHistory: entry.attemptHistory,
              timing,
            }));
            continue;
          }
        }
        if (result?.exitCode !== 0) {
          const diagnostics = Array.isArray(preflight.diagnostics) && preflight.diagnostics.length > 0
            ? preflight.diagnostics
            : [invalidPreflightReceiptDiagnostic([
              `exit ${String(result?.exitCode)} did not include structured diagnostics`,
            ])];
          receipts.push(failedReceipt({
            candidate: entry.candidate,
            stage: 'preflight',
            diagnostics,
            checker: entry.checker,
            preflight,
            specification: entry.specification,
            specificationReceipt: entry.specificationReceipt,
            artifactReceipt: entry.artifactReceipt,
            authoredLanguage: entry.authoredLanguage,
            attemptHistory: entry.attemptHistory,
            timing,
          }));
        } else {
          receipts.push({
            schemaVersion: 1,
            ok: true,
            command: 'validate',
            id: entry.candidate.id,
            type: entry.candidate.type,
            input: entry.candidate.input,
            specification: entry.specificationReceipt,
            artifact: entry.artifactReceipt,
            checks: entry.checker.checks,
            composition: entry.checker.composition,
            ...(entry.authoredLanguage ? { authoredLanguage: entry.authoredLanguage } : {}),
            preflight,
            timing,
          });
        }
      }
    }

    const order = new Map(normalized.map((candidate, index) => [candidate.id, index]));
    receipts.sort((left, right) => order.get(left.id) - order.get(right.id));

    const ok = receipts.length === normalized.length && receipts.every((receipt) => receipt.ok === true);
    const skipped = receipts.some((receipt) => receipt.preflight?.status === 'skipped');
    const endedAt = new Date().toISOString();
    return {
      exitCode: ok ? 0 : skipped ? 2 : 1,
      receipt: {
        schemaVersion: 1,
        ok,
        command: 'validate-batch',
        status: ok ? 'pass' : skipped ? 'skipped' : 'fail',
        quality,
        session: {
          shared: true,
          candidates: normalized.length,
          expectedBrowserResets: Math.max(0, normalized.length - 1),
          browserRestarts,
        },
        timing: {
          source: 'validate-batch',
          startedAt: batchStartedAt,
          endedAt,
          durationMs: elapsed(batchStarted),
        },
        candidates: receipts,
      },
    };
  } finally {
    try {
      if (ownsSession && activeSession) await activeSession.close();
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }
}
