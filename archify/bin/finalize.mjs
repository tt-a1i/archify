import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { pathsAlias } from '../renderers/shared/output-path.mjs';
import {
  browserCheckSidecarPaths,
  CAPTURE_VIEWPORTS,
  ChromeVisualBrowser,
  findChrome,
  THEMES,
  VISUAL_CHECK_VIEWPORTS,
} from './visual-check.mjs';

export const FINALIZE_STAGES = Object.freeze(['validate', 'deliver', 'check', 'browser-check']);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function identity(file) {
  try {
    const bytes = fs.readFileSync(file);
    return { path: path.resolve(file), sha256: sha256(bytes), bytes: bytes.byteLength };
  } catch {
    return { path: path.resolve(file) };
  }
}

function durationMs(start) {
  return Number((process.hrtime.bigint() - start) / 1000000n);
}

function writeJsonAtomic(file, value) {
  const target = path.resolve(file);
  const directory = path.dirname(target);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(target)}.tmp-${process.pid}-${randomUUID()}`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    try { fs.rmSync(temporary, { force: true }); } catch {}
  }
}

function parsedReceipt(stdout) {
  const source = String(stdout || '').trim();
  if (!source) return null;
  try { return JSON.parse(source); } catch { return null; }
}

function isReceiptObject(receipt) {
  return Boolean(receipt && typeof receipt === 'object' && !Array.isArray(receipt));
}

function validIdentity(value) {
  return isReceiptObject(value)
    && typeof value.sha256 === 'string'
    && /^[0-9a-f]{64}$/.test(value.sha256)
    && Number.isSafeInteger(value.bytes)
    && value.bytes >= 0;
}

function identitiesMatch(left, right) {
  return validIdentity(left)
    && validIdentity(right)
    && left.sha256 === right.sha256
    && left.bytes === right.bytes;
}

function validReceiptId(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function allChecksPassed(checks) {
  return Array.isArray(checks) && checks.length > 0
    && checks.every((check) => isReceiptObject(check) && check.ok === true);
}

function validCheckComposition(receipt, quality) {
  const composition = receipt?.composition;
  return isReceiptObject(composition)
    && composition.schemaVersion === 1
    && composition.profile === quality
    && composition.status === 'pass'
    && composition.summary?.errors === 0
    && (quality !== 'showcase' || composition.summary?.warnings === 0);
}

function exactViewportCoverage(entries, viewports, predicate) {
  if (!Array.isArray(entries) || entries.length !== viewports.length) return false;
  return viewports.every((expected) => {
    const matching = entries.filter((entry) => (
      isReceiptObject(entry)
        && entry.width === expected.width
        && entry.height === expected.height
        && (expected.theme === undefined || entry.requestedTheme === expected.theme)
    ));
    return matching.length === 1 && predicate(matching[0], expected);
  });
}

function validBrowserEvidence(receipt) {
  return exactViewportCoverage(receipt.containment?.viewports, VISUAL_CHECK_VIEWPORTS, (entry) => (
    entry.theme === 'light' && entry.ok === true
  ))
    && exactViewportCoverage(receipt.readability?.viewports, VISUAL_CHECK_VIEWPORTS, (entry) => (
      entry.theme === 'light' && entry.ok === true && entry.readabilityOk === true
    ))
    && exactViewportCoverage(receipt.viewerChrome?.viewports, VISUAL_CHECK_VIEWPORTS, (entry) => (
      entry.theme === 'light' && entry.ok === true && entry.viewerChromeOk === true
    ))
    && exactViewportCoverage(receipt.themeStates?.viewports,
      CAPTURE_VIEWPORTS.flatMap(({ width, height }) => THEMES.map((theme) => ({ width, height, theme }))),
      (entry, expected) => entry.ok === true
        && entry.requestedTheme === expected.theme
        && entry.resolvedTheme === expected.theme);
}

function validDeliveryValidation(receipt, quality) {
  const validation = receipt?.validation;
  return isReceiptObject(validation)
    && Number.isInteger(validation.checkCount)
    && validation.checkCount > 0
    && validation.checksPassed === validation.checkCount
    && validation.compositionStatus === 'pass'
    && validation.errors === 0
    && validation.compositionProfile === quality
    && (quality !== 'showcase' || validation.warnings === 0);
}

function validStageReceipt(stage, receipt, quality) {
  if (!isReceiptObject(receipt) || receipt.ok !== true) return false;
  if (receipt.status && receipt.status !== 'pass') return false;
  if (stage === 'validate') return receipt.command === 'validate' && Array.isArray(receipt.checks);
  if (stage === 'deliver') {
    return receipt.command === 'deliver'
      && receipt.schemaVersion === 1
      && validReceiptId(receipt.receiptId)
      && isReceiptObject(receipt.specification)
      && validIdentity(receipt.specification)
      && validIdentity(receipt.artifact)
      && validDeliveryValidation(receipt, quality);
  }
  if (stage === 'check') {
    return validIdentity(receipt.artifact)
      && allChecksPassed(receipt.checks)
      && receipt.provenance === 'current'
      && validReceiptId(receipt.deliveryReceiptId)
      && validCheckComposition(receipt, quality);
  }
  return receipt.command === 'browser-check'
    && receipt.schemaVersion === 1
    && receipt.status === 'pass'
    && receipt.evidenceKind === 'automated-browser'
    && validIdentity(receipt.artifact)
    && receipt.provenance === 'current'
    && validReceiptId(receipt.deliveryReceiptId)
    && receipt.containment?.status === 'pass'
    && receipt.themeStates?.status === 'pass'
    && receipt.readability?.status === 'pass'
    && receipt.viewerChrome?.status === 'pass'
    && validBrowserEvidence(receipt);
}

function identityMismatchDiagnostic({ stage, expected, actual, expectedReceiptId, actualReceiptId, output }) {
  return {
    code: 'finalize/artifact-binding-mismatch',
    severity: 'error',
    message: `The ${stage} receipt does not prove the artifact delivered by this finalize run.`,
    subject: { stage, artifact: output },
    evidence: {
      expectedArtifact: expected,
      actualArtifact: actual,
      ...(expectedReceiptId ? { expectedDeliveryReceiptId: expectedReceiptId } : {}),
      ...(actualReceiptId ? { actualDeliveryReceiptId: actualReceiptId } : {}),
    },
    supportedFixes: ['finish other delivery attempts for this output, then rerun finalize from the frozen candidate'],
  };
}

function stageBindingDiagnostic({ stage, receipt, expectedArtifact, expectedReceiptId, output, specification, type, deliveryValidation }) {
  if (stage === 'deliver') {
    if (receipt.type !== type) {
      return {
        code: 'finalize/delivery-type-mismatch',
        severity: 'error',
        message: 'The delivery command reported a different diagram type than finalize requested.',
        subject: { stage: 'deliver', artifact: output },
        evidence: { expectedType: type, actualType: receipt.type },
        supportedFixes: ['rerun finalize with a delivery command for the requested diagram type'],
      };
    }
    if (!identitiesMatch(receipt.specification, specification)) {
      return {
        code: 'finalize/candidate-changed-during-delivery',
        severity: 'error',
        message: 'The delivery command froze a different candidate than finalize started with.',
        subject: { stage: 'validate', candidate: specification.path },
        evidence: {
          expectedSha256: specification.sha256,
          actualSha256: receipt.specification?.sha256,
          expectedBytes: specification.bytes,
          actualBytes: receipt.specification?.bytes,
        },
        supportedFixes: ['restore the frozen candidate and rerun finalize'],
      };
    }
    if (path.resolve(receipt.output || '') !== output || !identitiesMatch(receipt.artifact, identity(output))) {
      return identityMismatchDiagnostic({
        stage,
        expected: receipt.artifact,
        actual: identity(output),
        expectedReceiptId: receipt.receiptId,
        output,
      });
    }
    return null;
  }
  if (stage === 'check' && deliveryValidation?.checkCount !== receipt.checks.length) {
    return {
      code: 'finalize/delivery-validation-mismatch',
      severity: 'error',
      message: 'The delivery validation count does not match the complete checker receipt for the delivered artifact.',
      subject: { stage: 'check', artifact: output },
      evidence: {
        deliveryCheckCount: deliveryValidation?.checkCount,
        checkerCheckCount: receipt.checks.length,
      },
      supportedFixes: ['restore the complete delivery validation receipt and rerun finalize from the frozen candidate'],
    };
  }
  const receiptArtifactPath = receipt.artifact?.path;
  const receiptFile = receipt.file;
  const pathMatchesOutput = stage === 'check'
    ? typeof receiptFile === 'string' && path.resolve(receiptFile) === output
    : typeof receiptArtifactPath === 'string' && path.resolve(receiptArtifactPath) === output;
  if (!pathMatchesOutput
      || !identitiesMatch(receipt.artifact, expectedArtifact)
      || receipt.deliveryReceiptId !== expectedReceiptId) {
    return identityMismatchDiagnostic({
      stage,
      expected: expectedArtifact,
      actual: receipt.artifact,
      expectedReceiptId,
      actualReceiptId: receipt.deliveryReceiptId,
      output,
    });
  }
  return null;
}

function finalArtifactDiagnostic({ output, expectedArtifact, expectedReceiptId, type }) {
  const currentArtifact = identity(output);
  const deliveryPath = output.replace(/\.html?$/i, '.delivery.json');
  let delivery;
  try {
    delivery = JSON.parse(fs.readFileSync(deliveryPath, 'utf8'));
  } catch {
    delivery = null;
  }
  if (identitiesMatch(currentArtifact, expectedArtifact)
      && delivery?.schemaVersion === 1
      && delivery.command === 'deliver'
      && delivery.status === 'current'
      && delivery.receiptId === expectedReceiptId
      && delivery.type === type
      && path.resolve(delivery.output || '') === output
      && identitiesMatch(delivery.artifact, expectedArtifact)) return null;
  return {
    code: 'finalize/final-artifact-mismatch',
    severity: 'error',
    message: 'The artifact or delivery receipt changed after the final gate completed.',
    subject: { stage: 'finalize', artifact: output },
    evidence: {
      expectedArtifact,
      currentArtifact,
      expectedDeliveryReceiptId: expectedReceiptId,
      expectedType: type,
      ...(delivery?.receiptId ? { currentDeliveryReceiptId: delivery.receiptId } : {}),
      ...(delivery?.type ? { currentType: delivery.type } : {}),
      ...(delivery?.artifact ? { currentDeliveryArtifact: delivery.artifact } : {}),
    },
    supportedFixes: ['finish other delivery attempts for this output, then rerun finalize from the frozen candidate'],
  };
}

function stageStatus(stage, exitCode, receipt, quality) {
  if (exitCode === 2 || receipt?.status === 'skipped') return 'skipped';
  return exitCode === 0 && validStageReceipt(stage, receipt, quality) ? 'pass' : 'fail';
}

function failureDiagnostics(stage, result, receipt, quality) {
  if (Array.isArray(receipt?.diagnostics) && receipt.diagnostics.length) return receipt.diagnostics;
  const invalidReceipt = (result.status ?? 1) === 0 && !validStageReceipt(stage, receipt, quality);
  return [{
    code: invalidReceipt ? 'finalize/invalid-stage-receipt' : 'finalize/stage-failure',
    severity: 'error',
    message: invalidReceipt
      ? `The ${stage} stage exited successfully without a valid passing receipt.`
      : `The ${stage} stage did not complete successfully.`,
    subject: { stage },
    evidence: {
      exitCode: result.status ?? 1,
      ...(result.signal ? { signal: result.signal } : {}),
      ...(result.error?.message ? { reason: result.error.message } : {}),
      ...(String(result.stdout || '').trim() ? { stdout: String(result.stdout).trim().slice(0, 2000) } : {}),
      ...(String(result.stderr || '').trim() ? { stderr: String(result.stderr).trim().slice(0, 2000) } : {}),
    },
    supportedFixes: [invalidReceipt
      ? `restore the ${stage} JSON receipt contract before retrying finalize`
      : 'use the compact finalize summary to repair the named subject in place, then rerun finalize once'],
  }];
}

function sidecarFile(directory, value) {
  if (!value) return null;
  return path.resolve(directory, value);
}

function browserEvidence(receipt, artifactPath) {
  if (!receipt) return {};
  const directory = receipt.sidecars?.directory
    ? path.resolve(receipt.sidecars.directory)
    : path.dirname(path.resolve(artifactPath));
  return {
    ...(receipt.sidecars?.receipt ? { browserCheckReceipt: sidecarFile(directory, receipt.sidecars.receipt) } : {}),
  };
}

function defaultRunner({ cliPath, args, cwd, env }) {
  return new Promise((resolve) => {
    execFile(process.execPath, [cliPath, ...args], { cwd, env, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({
        status: error ? (Number.isInteger(error.code) ? error.code : 1) : 0,
        stdout,
        stderr,
        ...(error ? { error, signal: error.signal } : {}),
      });
    });
  });
}

function stageArguments({ stage, type, input, output, quality, repoRoot, outDir }) {
  const qualityArgs = ['--quality', quality];
  const repoArgs = repoRoot ? ['--repo-root', repoRoot] : [];
  if (stage === 'validate') return ['validate', type, input, ...qualityArgs, ...repoArgs, '--json'];
  if (stage === 'deliver') return ['deliver', type, input, output, ...qualityArgs, ...repoArgs, '--json'];
  if (stage === 'check') return ['check', output, '--require-provenance'];
  return [
    'browser-check', output, '--json', '--require-provenance',
    ...(outDir ? ['--out-dir', outDir] : []),
  ];
}

export function defaultFinalizeReceiptPath(output, { outDir } = {}) {
  const artifact = path.resolve(output);
  const stem = path.basename(artifact).replace(/\.html?$/i, '');
  return path.join(outDir ? path.resolve(outDir) : path.dirname(artifact), `${stem}.finalize.json`);
}

export function defaultFinalizeSummaryPath(receiptPath) {
  const receipt = path.resolve(receiptPath);
  if (/\.finalize\.json$/i.test(receipt)) return receipt.replace(/\.finalize\.json$/i, '.finalize-summary.json');
  if (/\.json$/i.test(receipt)) return receipt.replace(/\.json$/i, '-summary.json');
  return `${receipt}-summary.json`;
}

function reservedFinalizePaths({ input, output, outDir }) {
  const artifact = path.resolve(output);
  const delivery = artifact.replace(/\.html?$/i, '.delivery.json');
  const browser = browserCheckSidecarPaths(artifact, { outDir });
  return [
    path.resolve(input),
    artifact,
    delivery,
    delivery.replace(/\.json$/i, '-pending.json'),
    delivery.replace(/\.json$/i, '-lock.json'),
    browser.receipt,
  ];
}

export function compactFinalizeReceipt(receipt) {
  const gates = {};
  for (const stage of FINALIZE_STAGES) gates[stage] = receipt.stages?.[stage]?.status || 'not-run';
  const allDiagnostics = receipt.diagnostics || [];
  const diagnosticLimit = 8;
  const selectedDiagnostics = [];
  const selectedIndexes = new Set();
  const seenCodes = new Set();
  const seenSubjects = new Set();
  const subjectKey = (entry) => {
    const subject = entry?.subject;
    if (!subject) return null;
    if (typeof subject === 'string') return subject;
    if (typeof subject !== 'object' || Array.isArray(subject)) return JSON.stringify(subject);
    for (const key of ['id', 'edge', 'connection', 'relationship', 'component', 'node', 'path', 'stage']) {
      if (subject[key] !== undefined) return `${key}:${JSON.stringify(subject[key])}`;
    }
    return JSON.stringify(subject);
  };
  const addDiagnostic = (entry, index) => {
    if (selectedDiagnostics.length >= diagnosticLimit || selectedIndexes.has(index)) return;
    selectedIndexes.add(index);
    selectedDiagnostics.push({
      code: entry.code,
      severity: entry.severity || 'error',
      message: entry.message,
      ...(entry.subject ? { subject: entry.subject } : {}),
      ...(entry.evidence && Object.keys(entry.evidence).length ? { evidence: entry.evidence } : {}),
      ...(Array.isArray(entry.supportedFixes) && entry.supportedFixes.length
        ? { supportedFixes: entry.supportedFixes.slice(0, 2) } : {}),
    });
  };
  for (const [index, entry] of allDiagnostics.entries()) {
    if (seenCodes.has(entry.code)) continue;
    seenCodes.add(entry.code);
    addDiagnostic(entry, index);
  }
  for (const [index, entry] of allDiagnostics.entries()) {
    const key = subjectKey(entry);
    if (!key || seenSubjects.has(key)) continue;
    seenSubjects.add(key);
    addDiagnostic(entry, index);
  }
  for (const [index, entry] of allDiagnostics.entries()) addDiagnostic(entry, index);
  const compact = {
    schemaVersion: 1,
    ok: receipt.ok,
    command: 'finalize',
    status: receipt.status,
    type: receipt.type,
    quality: receipt.quality,
    specification: receipt.specification,
    artifact: receipt.artifact,
    gates,
    ...(receipt.failedStage ? { failedStage: receipt.failedStage } : {}),
    diagnostics: selectedDiagnostics,
    diagnosticSummary: {
      total: allDiagnostics.length,
      shown: selectedDiagnostics.length,
      truncated: allDiagnostics.length > selectedDiagnostics.length,
    },
    evidence: receipt.evidence,
    visualReview: receipt.visualReview || 'not-requested',
    durationMs: receipt.durationMs,
  };
  if (!receipt.ok && receipt.status === 'fail' && receipt.failedStage === 'validate') {
    compact.nextAction = {
      action: 'edit-in-place',
      candidate: receipt.specification?.path,
      constraint: 'Preserve unaffected semantics and geometry; do not replace the whole candidate.',
      then: 'finalize-once',
    };
  }
  return compact;
}

export async function runFinalize({
  cliPath,
  type,
  input,
  output,
  quality = 'showcase',
  repoRoot,
  candidateSha256,
  outDir,
  receiptPath = defaultFinalizeReceiptPath(output, { outDir }),
  cwd = process.cwd(),
  env = process.env,
  runCommand = defaultRunner,
  runBrowserCheck,
  resolveChrome = findChrome,
  createBrowser = (chromePath, options) => new ChromeVisualBrowser(chromePath, options),
} = {}) {
  if (!cliPath || !type || !input || !output) throw new Error('finalize requires cliPath, type, input, and output.');
  const started = process.hrtime.bigint();
  const startedAt = new Date().toISOString();
  const resolvedInput = path.resolve(input);
  const resolvedOutput = path.resolve(output);
  const resolvedReceipt = path.resolve(receiptPath);
  const resolvedSummary = defaultFinalizeSummaryPath(resolvedReceipt);
  const resolvedOutDir = outDir ? path.resolve(outDir) : undefined;
  const specification = identity(resolvedInput);
  if (candidateSha256 && specification.sha256 !== candidateSha256) {
    const error = new Error(`The candidate changed after validation: expected sha256 ${candidateSha256}, found ${specification.sha256 || 'unreadable'}.`);
    error.finalizeCode = 'finalize/candidate-changed';
    error.finalizeEvidence = {
      candidate: resolvedInput,
      expectedSha256: candidateSha256,
      ...(specification.sha256 ? { actualSha256: specification.sha256 } : {}),
    };
    throw error;
  }
  const receiptCollision = reservedFinalizePaths({
    input: resolvedInput,
    output: resolvedOutput,
    outDir: resolvedOutDir,
  }).find((reserved) => pathsAlias(resolvedReceipt, reserved));
  if (receiptCollision) {
    throw new Error(`The finalize receipt must be distinct from the specification, artifact, and gate sidecars: "${receiptCollision}".`);
  }
  const summaryCollision = [resolvedReceipt, ...reservedFinalizePaths({
    input: resolvedInput,
    output: resolvedOutput,
    outDir: resolvedOutDir,
  })].find((reserved) => pathsAlias(resolvedSummary, reserved));
  if (summaryCollision) {
    throw new Error(`The finalize summary must be distinct from the full receipt, specification, artifact, and gate sidecars: "${summaryCollision}".`);
  }

  const receipt = {
    schemaVersion: 1,
    ok: false,
    command: 'finalize',
    status: 'running',
    type,
    quality,
    startedAt,
    specification,
    artifact: { path: resolvedOutput },
    stages: {},
    diagnostics: [],
    evidence: { receipt: resolvedReceipt, summaryReceipt: resolvedSummary },
    visualReview: 'not-requested',
  };
  const persistReceipts = () => {
    writeJsonAtomic(resolvedReceipt, receipt);
    writeJsonAtomic(resolvedSummary, compactFinalizeReceipt(receipt));
  };
  persistReceipts();

  // Only launch/attach the blank browser here. The normal browser gate still
  // verifies current delivery provenance before it consumes this one-shot factory.
  const chromePath = runBrowserCheck ? resolveChrome({ env }) : null;
  let browser;
  let browserStartupError;
  let browserTransferred = false;
  if (chromePath) {
    try {
      browser = createBrowser(chromePath, { env });
      // Deliver/check may fail before inspect() awaits startup. Handle the
      // rejection now while retaining the same promise for the browser gate.
      browser.sessionPromise.catch(() => {});
    } catch (error) {
      browserStartupError = error;
    }
  }
  const browserFactory = () => {
    if (browserStartupError) throw browserStartupError;
    if (browserTransferred || !browser) throw new Error('The finalize browser is unavailable or already consumed.');
    browserTransferred = true;
    return browser;
  };

  try {
    let exitCode = 0;
    for (const stage of ['deliver', 'check', 'browser-check']) {
      const stageStarted = process.hrtime.bigint();
      const args = stageArguments({
        stage,
        type,
        input: resolvedInput,
        output: resolvedOutput,
        quality,
        repoRoot,
        outDir: resolvedOutDir,
      });
      const inProcess = stage === 'browser-check' && runBrowserCheck;
      let result;
      if (inProcess) {
        const checked = await runBrowserCheck({
          artifactPath: resolvedOutput,
          outDir: resolvedOutDir,
          chromePath,
          resolveChrome: () => chromePath,
          browserFactory,
        });
        result = { status: checked.exitCode, stdout: JSON.stringify(checked.receipt) };
      } else {
        result = await runCommand({ stage, cliPath, args, cwd, env });
      }
      const stageReceipt = parsedReceipt(result.stdout);
      const code = result.status ?? 1;
      let status = stageStatus(stage, code, stageReceipt, quality);
      let stageDiagnostics;
      const command = [process.execPath, cliPath, ...args];
      const elapsed = durationMs(stageStarted);
      if (status === 'pass') {
        const deliveryReceipt = stage === 'deliver' ? stageReceipt : receipt.stages.deliver?.receipt;
        const bindingDiagnostic = stageBindingDiagnostic({
          stage,
          receipt: stageReceipt,
          expectedArtifact: deliveryReceipt?.artifact,
          expectedReceiptId: deliveryReceipt?.receiptId,
          output: resolvedOutput,
          specification,
          type,
          deliveryValidation: deliveryReceipt?.validation,
        });
        if (bindingDiagnostic) stageDiagnostics = [bindingDiagnostic];
      }
      if (stageDiagnostics) {
        status = 'fail';
      }
      const stageEntry = {
        status,
        exitCode: code,
        durationMs: elapsed,
        command,
        ...(inProcess ? { execution: 'in-process' } : {}),
        ...(stageReceipt ? { receipt: stageReceipt } : {}),
        ...(!stageReceipt && String(result.stdout || '').trim() ? { stdout: String(result.stdout).trim() } : {}),
        ...(String(result.stderr || '').trim() ? { stderr: String(result.stderr).trim() } : {}),
        ...(result.signal ? { signal: result.signal } : {}),
      };

      if (stage === 'deliver' && status === 'pass') {
        receipt.stages.validate = {
          status: 'pass',
          exitCode: 0,
          durationMs: null,
          execution: 'embedded-in-deliver',
          command,
          receipt: {
            schemaVersion: 1,
            ok: true,
            command: 'validate',
            specification: stageReceipt.specification,
            validation: stageReceipt.validation,
          },
        };
        receipt.stages.deliver = stageEntry;
      } else if (stage === 'deliver') {
        const validationFailed = stageDiagnostics?.some((diagnostic) => diagnostic.code === 'finalize/candidate-changed-during-delivery')
          || ['input', 'render', 'check'].includes(stageReceipt?.stage);
        receipt.stages.validate = validationFailed ? {
          ...stageEntry,
          status: 'fail',
          durationMs: null,
          execution: 'embedded-in-deliver',
        } : { status: 'not-run', execution: 'embedded-in-deliver' };
        receipt.stages.deliver = validationFailed
          ? { status: 'not-run', execution: 'blocked-by-validate' }
          : stageEntry;
      } else {
        receipt.stages[stage] = stageEntry;
      }

      if (stage === 'deliver' && stageReceipt?.artifact) receipt.artifact = {
        path: resolvedOutput,
        ...stageReceipt.artifact,
      };
      if (stage === 'browser-check') {
        receipt.evidence = {
          receipt: resolvedReceipt,
          summaryReceipt: resolvedSummary,
          ...browserEvidence(stageReceipt, resolvedOutput),
        };
      }

      if (status !== 'pass') {
        exitCode = status === 'skipped' ? 2 : (code || 1);
        receipt.status = status;
        receipt.diagnostics = stageDiagnostics || failureDiagnostics(stage, result, stageReceipt, quality);
        receipt.failedStage = stage === 'deliver'
          && receipt.stages.validate.status === 'fail' ? 'validate' : stage;
        break;
      }
      persistReceipts();
    }

    receipt.ok = exitCode === 0;
    receipt.status = receipt.ok ? 'pass' : receipt.status === 'running' ? 'fail' : receipt.status;
    if (receipt.ok) {
      const deliveryReceipt = receipt.stages.deliver?.receipt;
      const diagnostic = finalArtifactDiagnostic({
        output: resolvedOutput,
        expectedArtifact: deliveryReceipt?.artifact,
        expectedReceiptId: deliveryReceipt?.receiptId,
        type,
      });
      if (diagnostic) {
        exitCode = 1;
        receipt.ok = false;
        receipt.status = 'fail';
        receipt.failedStage = 'finalize';
        receipt.diagnostics = [diagnostic];
      }
    }
    receipt.artifact = receipt.ok
      ? { path: resolvedOutput, ...receipt.stages.deliver.receipt.artifact }
      : identity(resolvedOutput);
    receipt.finishedAt = new Date().toISOString();
    receipt.durationMs = durationMs(started);
    persistReceipts();
    return { exitCode, receipt, summary: compactFinalizeReceipt(receipt) };
  } finally {
    if (browser && !browserTransferred) await browser.close();
  }
}
