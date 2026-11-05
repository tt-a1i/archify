import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalFuturePath, pathsAlias, resolveNativeOutputDirectory, resolveOutputPath } from '../renderers/shared/output-path.mjs';
import { boundedSidecarStem } from '../renderers/shared/sidecar-path.mjs';
import {
  captureAtomicOutput, captureRegularFileBinding, publishRegularFileBinding,
  releaseRegularFileBinding, removeOwnedRegularFile, quarantineRemoveRegularFileBinding, verifyAtomicOutput,
} from '../renderers/shared/atomic-output.mjs';
import {
  browserCheckSidecarPaths,
  CAPTURE_VIEWPORTS,
  ChromeVisualBrowser,
  findChrome,
  persistBrowserCheckFailure,
  VISUAL_CHECK_VIEWPORTS,
} from './visual-check.mjs';
import { startDeliveryUpdateCheck } from './delivery-update.mjs';
import { declaredExplainerInputPaths } from '../explainer/prepare.mjs';

export const FINALIZE_STAGES = Object.freeze(['validate', 'deliver', 'check', 'browser-check']);
const FINALIZE_UPDATE_DEADLINE_MS = 4_000;

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

function receiptWriteError(file, state) {
  const error = new Error(`Could not publish finalize evidence "${file}" safely (${state.reason?.code || state.status}).`);
  error.finalizeCode = 'finalize/receipt-publication';
  error.finalizeEvidence = { file, state };
  return error;
}

function captureReceipt(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const capture = captureAtomicOutput(file, { requestedEntryPolicy: 'regular-or-absent' });
  if (capture.status !== 'captured') throw receiptWriteError(file, capture);
  return capture;
}

function writeJsonAtomic(file, value, capture, beforeCommit) {
  const serialized = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  const temporary = path.join(path.dirname(capture.commitPath), `.archify-finalize-${randomUUID()}.json`);
  let binding;
  let stagedIdentity;
  try {
    fs.writeFileSync(temporary, serialized, { flag: 'wx' });
    const metadata = fs.lstatSync(temporary, { bigint: true });
    stagedIdentity = { device: metadata.dev, inode: metadata.ino };
    if (capture.mode !== null) fs.chmodSync(temporary, capture.mode);
    const staged = captureRegularFileBinding(temporary, {
      subject: 'finalize-receipt', expectedIdentity: stagedIdentity,
      expectedSha256: sha256(serialized), expectedBytes: serialized.byteLength,
      ...(capture.mode === null ? {} : { expectedMode: capture.mode }),
    });
    if (staged.status !== 'captured') throw receiptWriteError(file, staged);
    binding = staged.binding;
    beforeCommit();
    const publication = publishRegularFileBinding(binding, temporary, capture.snapshot, { subject: 'finalize-receipt' });
    if (!['committed', 'committed-with-warning'].includes(publication.status)) throw receiptWriteError(file, publication);
    // Preserve recovery evidence instead of reporting a clean completion when cleanup failed.
    if (publication.status === 'committed-with-warning') throw receiptWriteError(file, publication);
    const next = captureReceipt(file);
    if (!pathsAlias(next.commitPath, capture.commitPath)) {
      throw receiptWriteError(file, { status: 'different', reason: { code: 'receipt-slot-changed' } });
    }
    return next;
  } finally {
    if (binding) releaseRegularFileBinding(binding);
    if (stagedIdentity) removeOwnedRegularFile(temporary, stagedIdentity, { subject: 'finalize-receipt' });
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
  if (receipt.family === 'explainer') {
    const viewports = [1280, 1440].flatMap(width => ['light', 'dark'].map(theme => ({ width, height: 900, theme })));
    const groups = ['containment', 'readability', 'viewerChrome', 'themeStates'];
    return receipt.viewportPolicy === 'explainer-desktop-v1'
      && groups.every(group => receipt[group]?.status === 'pass'
        && exactViewportCoverage(receipt[group].viewports?.map(entry => ({ ...entry, requestedTheme: entry.requestedTheme || entry.theme })), viewports, (entry, expected) =>
          entry.ok === true && (entry.requestedTheme || entry.theme) === expected.theme))
      && ['commonQa', 'interactions', 'references', 'noJavaScript', 'print'].every(group =>
        receipt[group]?.status === 'pass' && Array.isArray(receipt[group].observations) && receipt[group].observations.length > 0
        && receipt[group].observations.every(entry => entry.ok === true));
  }
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
      [...VISUAL_CHECK_VIEWPORTS.map((viewport) => ({ ...viewport, theme: 'light' })),
        ...CAPTURE_VIEWPORTS.map((viewport) => ({ ...viewport, theme: 'dark' }))],
      (entry, expected) => entry.ok === true
        && entry.requestedTheme === expected.theme
        && entry.resolvedTheme === expected.theme);
}

function validDeliveryValidation(receipt, quality, { allowShowcaseWarnings = false } = {}) {
  const validation = receipt?.validation;
  return isReceiptObject(validation)
    && Number.isInteger(validation.checkCount)
    && validation.checkCount > 0
    && validation.checksPassed === validation.checkCount
    && validation.compositionStatus === 'pass'
    && validation.errors === 0
    && validation.compositionProfile === quality
    && (quality !== 'showcase' || allowShowcaseWarnings || validation.warnings === 0);
}

function validStageReceipt(stage, receipt, quality, options) {
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
      && validDeliveryValidation(receipt, quality, options);
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

function showcaseWarningDiagnostics(receipt) {
  const issues = receipt.validation.compositionIssues;
  const warnings = receipt.validation.warnings;
  if (!Array.isArray(issues) || issues.length !== warnings
      || !issues.every((issue) => isReceiptObject(issue)
        && issue.severity === 'warning'
        && typeof issue.code === 'string'
        && issue.code.startsWith('composition/')
        && typeof issue.detail === 'string' && issue.detail.trim())) {
    return [{
      code: 'finalize/showcase-warnings', severity: 'error',
      message: `Showcase delivery reported ${warnings} composition warning(s), but did not provide matching issue details.`,
      subject: { stage: 'deliver', check: 'composition' },
      evidence: { warnings, reportedIssues: Array.isArray(issues) ? issues.length : null },
      supportedFixes: ['run validate on the frozen candidate to inspect the composition warnings, repair them, then rerun finalize'],
    }];
  }
  return issues.map((issue) => {
    const { code, severity, detail, ...evidence } = issue;
    return {
      code, severity: 'error',
      message: `Showcase delivery reported ${code}; zero warnings are required.`,
      subject: { stage: 'deliver', check: 'composition', ...(issue.nodeId ? { nodeId: issue.nodeId } : {}) },
      evidence: { reportedSeverity: severity, ...evidence },
      supportedFixes: [detail.replace(/^\[[^\]]+\]\s*/, '')],
    };
  });
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
    if ((!receipt.output || !pathsAlias(receipt.output, output)) || !identitiesMatch(receipt.artifact, identity(output))) {
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
  if (stage === 'browser-check' && ((type === 'explainer') !== (receipt.family === 'explainer'))) {
    return { code: 'finalize/browser-family-mismatch', severity: 'error', message: 'Browser evidence covers a different artifact family.',
      subject: {stage, artifact: output}, evidence: {expectedType:type, actualFamily:receipt.family}, supportedFixes:['Rerun browser-check for the delivered artifact.'] };
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
    ? typeof receiptFile === 'string' && pathsAlias(receiptFile, output)
    : typeof receiptArtifactPath === 'string' && pathsAlias(receiptArtifactPath, output);
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

function finalArtifactDiagnostic({ output, expectedArtifact, expectedReceiptId, type, deliveryPath, inspectDelivery }) {
  // Recheck dev's pending/lock, physical identity, and regular-file provenance barriers at handoff.
  const provenance = inspectDelivery?.(output);
  if (provenance && (!provenance.ok || provenance.receiptId !== expectedReceiptId)) {
    return provenance.diagnostics?.[0] || identityMismatchDiagnostic({
      stage: 'finalize', output, expected: expectedArtifact,
      expectedReceiptId, actualReceiptId: provenance.receiptId,
    });
  }
  const currentArtifact = identity(output);
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
      && typeof delivery.output === 'string' && pathsAlias(delivery.output, output)
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

function consolidateDiagnostics(diagnostics) {
  const result = [];
  const seen = new Set();
  const overflow = [];
  let overflowIndex = -1;
  for (const diagnostic of diagnostics || []) {
    if (diagnostic?.code === 'viewer/viewport-overflow') {
      if (overflowIndex < 0) overflowIndex = result.length;
      overflow.push(diagnostic);
      continue;
    }
    const key = `${diagnostic?.code}${diagnostic?.message}${JSON.stringify(diagnostic?.subject ?? null)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(diagnostic);
  }
  const slimEvidence = (evidence) => {
    if (!evidence || typeof evidence !== 'object') return evidence;
    const { innerWidth: _w, innerHeight: _h, readerLayout: _l, readerOverflow: _o, readerFit: _f, ...rest } = evidence;
    return rest;
  };
  if (overflow.length > 1) {
    const first = overflow[0];
    const tightest = overflow
      .map((entry) => entry.subject?.viewport)
      .filter(Boolean)
      .sort((a, b) => a.width * a.height - b.width * b.height)[0];
    const fixes = tightest
      ? [`contain the rendered layout within ${tightest.width}x${tightest.height} (smallest reported viewport), then rerun browser-check`]
      : [...new Set(overflow.flatMap((entry) => entry.supportedFixes || []))];
    result.splice(overflowIndex, 0, {
      ...first,
      message: `The rendered artifact overflows ${overflow.length} viewport/theme combinations.`,
      subject: { diagramType: first.subject?.diagramType },
      supportedFixes: fixes,
      evidence: {
        overflows: overflow.map((entry) => {
          const { artifact: _artifact, ...subject } = entry.subject || {};
          return {
            // Predicted validate-stage overflow carries estimatedTextWidthPx;
            // the browser-check measurement carries scroll* geometry instead.
            detection: entry.evidence?.estimatedTextWidthPx != null ? 'validate-prediction' : 'browser-measurement',
            subject,
            evidence: slimEvidence(entry.evidence),
          };
        }),
      },
    });
  } else if (overflow.length === 1) {
    const [entry] = overflow;
    const { artifact: _artifact, ...subject } = entry.subject || {};
    result.splice(overflowIndex, 0, { ...entry, subject, evidence: slimEvidence(entry.evidence) });
  }
  return result;
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

// Stage receipts (dense validate/check JSON) can exceed execFile's 1 MiB
// default. Track ARCHIFY_CHECK_MAX_BUFFER so a raised checker limit is not
// defeated one layer up, with a 4 MiB floor: a lowered knob makes failing
// stages emit compact classified receipts, but those receipts — and any
// successful receipt the knob let through — still have to fit the capture.
// The 64 KiB headroom covers the stage echo over the raw checker receipt:
// commandCheck appends provenance and deliveryReceiptId after the checker
// ran, so the printed receipt can exceed the knob that admitted it. Read the
// knob from the runner's env, not process.env: runFinalize callers supply
// their own env and the child stages inherit exactly that object.
function stageCaptureMaxBuffer(env = process.env) {
  const parsed = Number(env.ARCHIFY_CHECK_MAX_BUFFER);
  const knob = Number.isFinite(parsed) && Math.floor(parsed) >= 1
    ? Math.floor(parsed)
    : 64 * 1024 * 1024;
  return Math.max(knob, 4 * 1024 * 1024) + 64 * 1024;
}

function defaultRunner({ cliPath, args, cwd, env }) {
  return new Promise((resolve) => {
    execFile(process.execPath, [cliPath, ...args], { cwd, env, encoding: 'utf8', maxBuffer: stageCaptureMaxBuffer(env) }, (error, stdout, stderr) => {
      resolve({
        status: error ? (Number.isInteger(error.code) ? error.code : 1) : 0,
        stdout,
        stderr,
        ...(error ? { error, signal: error.signal } : {}),
      });
    });
  });
}

function stageArguments({ stage, type, input, output, quality, repoRoot, outDir, writingMode }) {
  const qualityArgs = ['--quality', quality];
  const repoArgs = [...(repoRoot ? ['--repo-root', repoRoot] : []), ...(type==='explainer' && writingMode ? ['--writing',writingMode] : [])];
  if (stage === 'validate') return ['validate', type, input, ...qualityArgs, ...repoArgs, '--json'];
  if (stage === 'deliver') return ['deliver', type, input, output, ...qualityArgs, ...repoArgs, '--json'];
  if (stage === 'check') return ['check', output, '--require-provenance'];
  return [
    'browser-check', output, '--json', '--require-provenance',
    ...(outDir ? ['--out-dir', outDir] : []),
  ];
}

export function defaultFinalizeReceiptPath(output, { outDir } = {}) {
  // Reuse the physical artifact and cross-directory namespace used by browser evidence.
  const browserReceipt = browserCheckSidecarPaths(output, { outDir }).receipt;
  const stem = path.basename(browserReceipt).slice(0, -'.browser-check.json'.length);
  return path.join(path.dirname(browserReceipt), `${boundedSidecarStem(stem, ['.finalize.json', '.finalize-summary.json'])}.finalize.json`);
}

export function defaultFinalizeSummaryPath(receiptPath) {
  const receipt = path.resolve(receiptPath);
  const component = path.basename(receipt);
  const isDefault = /\.finalize\.json$/i.test(component);
  const stem = component.replace(isDefault ? /\.finalize\.json$/i : /\.json$/i, '');
  const suffix = isDefault ? '.finalize-summary.json' : '-summary.json';
  // Already bounded default stems share the receipt namespace; avoid hashing twice.
  const summaryStem = Buffer.byteLength(`${stem}${suffix}`) <= 255 && `${stem}${suffix}`.length <= 255
    ? stem : boundedSidecarStem(stem, [suffix]);
  return path.join(path.dirname(receipt), `${summaryStem}${suffix}`);
}

function defaultDeliveryPaths(output) {
  const artifact = canonicalFuturePath(output);
  const delivery = artifact.replace(/\.html?$/i, '.delivery.json');
  return {
    provenance: delivery,
    pending: delivery.replace(/\.json$/i, '-pending.json'),
    lock: delivery.replace(/\.json$/i, '-lock.json'),
    directoryLock: path.join(path.dirname(artifact), '.archify-delivery-lock.json'),
  };
}

// A reverted specification must not retain the retry's current-delivery claim.
// Preserve sidecars from other deliveries and remove only the verified inode.
function invalidateRepairedDelivery(output, delivery, deliveryPaths) {
  if (!delivery?.ok || !delivery.receiptId) return;
  const file = deliveryPaths(output).provenance;
  const captured = captureRegularFileBinding(file, {
    subject: 'finalize-repaired-delivery', includeContent: true,
  });
  if (captured.reason?.systemCode === 'ENOENT') return;
  if (captured.status !== 'captured') throw new Error('Cannot bind the repaired delivery sidecar.');
  try {
    const sidecar = JSON.parse(captured.content.buffer.toString('utf8'));
    if (sidecar.receiptId !== delivery.receiptId) return;
    const owned = sidecar.status === 'current' && sidecar.command === 'deliver'
      && pathsAlias(sidecar.output, output)
      && sidecar.artifact?.sha256 === delivery.artifact?.sha256
      && sidecar.specification?.sha256 === delivery.specification?.sha256;
    if (!owned) throw new Error('The repaired delivery sidecar changed before rollback.');
    const removed = quarantineRemoveRegularFileBinding(captured.binding, file, {
      subject: 'finalize-repaired-delivery', expectedLinks: 1,
    });
    if (removed.status !== 'removed') throw new Error('Cannot invalidate the repaired delivery sidecar.');
  } finally {
    releaseRegularFileBinding(captured.binding);
  }
}

function reservedFinalizePaths({ input, output, outDir, deliveryPaths, inputPaths }) {
  const browser = browserCheckSidecarPaths(output, { outDir });
  return [path.resolve(input), ...inputPaths, path.resolve(output), ...Object.values(deliveryPaths(output)), browser.receipt];
}

// Node moves that remove the measured crossings and detours, most specific
// first. Only positions and sizes change; every relationship keeps its endpoints.
function placementHints({ crossings = [], detours = [], crowdedSides = [] }) {
  const name = (relation) => `${relation.from} → ${relation.to}`;
  const other = (relation, shared) => (relation.from === shared ? relation.to : relation.from);
  const hints = [];
  for (const side of crowdedSides) {
    hints.push(`${side.node} has ${side.relationships} relationships facing its ${side.side} side, which fits ${Math.max(1, Math.floor((side.sidePx - 32) / 14) + 1)} ports: make that side at least ${side.neededPx}px, or move some of those neighbours so they face another side of ${side.node}.`);
  }
  for (const crossing of crossings) {
    const shared = crossing.sharedNode;
    hints.push(shared
      ? `${name(crossing.left)} and ${name(crossing.right)} cross next to ${shared}: move node ${other(crossing.left, shared)} or ${other(crossing.right, shared)} so the two reach ${shared} from different sides (for example one level with it, one directly above or below it).`
      : `${name(crossing.left)} crosses ${name(crossing.right)}: move the node of whichever is a branch, return, or second entrance to the other side of the main path, so that relationship runs through an empty corridor.`);
  }
  for (const detour of detours) {
    if (detour.directCorridorBlockers?.length) continue;
    hints.push(`${name(detour.relationship)} needs ${detour.bends} bends: move node ${detour.relationship.from} or ${detour.relationship.to} so they share a row or column with matching centers, or sit diagonally with a clear corner.`);
  }
  return [...new Set(hints)].slice(0, 8);
}

// Route failures call for a connected-scene repair; size and text failures do not.
const ROUTE_DIAGNOSTIC = /^(clean-flow\/|composition\/(proper-crossing|ambiguous-corridor|border-run|container-border-run|excessive-route-detour|route-rhythm|arrowhead-collision))/;

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
      // Verified repairs may require every edit in the set to be applied together.
      ...(Array.isArray(entry.supportedFixes) && entry.supportedFixes.length
        ? { supportedFixes: [...entry.supportedFixes] } : {}),
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
  const truncated = allDiagnostics.length > selectedDiagnostics.length;
  const omittedCounts = new Map();
  if (truncated) {
    for (const [index, entry] of allDiagnostics.entries()) {
      omittedCounts.set(entry.code, (omittedCounts.get(entry.code) || 0) + (selectedIndexes.has(index) ? 0 : 1));
    }
  }
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
    ...(receipt.autoRepair ? { autoRepair: receipt.autoRepair } : {}),
    diagnostics: selectedDiagnostics,
    diagnosticSummary: {
      total: allDiagnostics.length,
      shown: selectedDiagnostics.length,
      truncated,
      ...(truncated ? { omittedByCode: Object.fromEntries([...omittedCounts].filter(([, count]) => count > 0)) } : {}),
    },
    evidence: receipt.evidence,
    ...(receipt.update && receipt.update.status !== 'unavailable'
      ? { update: receipt.update }
      : {}),
    visualReview: receipt.visualReview || 'not-requested',
    durationMs: receipt.durationMs,
    ...(receipt.browserCheck ? {browserCheck:receipt.browserCheck} : {}),
  };
  const metrics = receipt.stages?.check?.receipt?.composition?.metrics;
  const reviewSignals = Object.fromEntries([
    'resolvedCrossovers', 'routesOverSuggestedBends', 'routesOverSuggestedStretch',
  ].filter((key) => Number.isFinite(metrics?.[key]) && metrics[key] > 0)
    .map((key) => [key, metrics[key]]));
  if (receipt.ok && Object.keys(reviewSignals).length) {
    const routeReview = receipt.stages?.check?.receipt?.composition?.routeReview;
    const hints = routeReview ? placementHints(routeReview) : [];
    // Modes without free node placement cannot act on node-move hints.
    const advisoryOnly = Boolean(receipt.type) && receipt.type !== 'architecture';
    compact.visualReviewRecommendation = {
      action: 'inspect-route-readability',
      signals: reviewSignals,
      reason: 'Automated gates passed, but crossings or detours still need perceptual review before claiming visual quality.',
      ...(routeReview ? {
        affectedRoutes: {
          crossings: routeReview.crossings.slice(0, 8),
          detours: routeReview.detours.slice(0, 8),
          truncated: routeReview.crossings.length > 8 || routeReview.detours.length > 8,
        },
        ...(hints.length && !advisoryOnly ? { hints } : {}),
        repair: !advisoryOnly
          ? 'Trace these relationships at the desktop viewport. For Architecture, use references/architecture-layout-repair.md: reflow a blocked main path or tangled connected scene, and repair an isolated defect locally only when the surrounding composition is accepted. Preserve all semantic content and user-fixed geometry. Rerun finalize once after the edit.'
          : 'Advisory only: this mode places or routes these relationships itself. Report them; do not remove relationships or meaning to reduce crossings.',
      } : {}),
    };
  }
  const leadingSpace = receipt.stages?.check?.receipt?.composition?.leadingSpace;
  if (receipt.ok && leadingSpace?.reviewSuggested === true) {
    compact.layoutReviewRecommendation = {
      action: 'inspect-leading-space',
      evidence: leadingSpace,
      reason: 'Measured content, including routes and labels, leaves a large empty area above the diagram. This is a composition suggestion, not a failed gate.',
      repair: 'Check whether that leading space is intentional. If not, reposition the connected scene nearer the canvas origin while retaining room for its actual boundaries, labels and return routes. Preserve all meaning and user-fixed geometry, then rerun finalize. No screenshot is required.',
    };
  }
  const sequenceColumnSpace = receipt.stages?.check?.receipt?.composition?.sequenceColumnSpace;
  if (receipt.ok && receipt.type === 'sequence' && sequenceColumnSpace?.reviewSuggested === true) {
    compact.layoutReviewRecommendation = {
      action: 'inspect-sequence-width',
      evidence: sequenceColumnSpace,
      reason: 'Fixed participant columns leave substantial unused space on the right, after accounting for message labels and notes. This is a layout suggestion, not a failed gate.',
      repair: 'Check whether the explicit fixed column geometry is intentional. Only when changing that geometry is authorized, save the passing fixed candidate, set only meta.column_fit to "spread", and rerun the complete finalize once with --out-dir <folder>/width-review. If that attempt fails, restore the saved candidate and finalize it with --out-dir <folder>/width-restore; report the remaining suggestion instead of iterating. Preserve participant order, every message, its y position, labels, notes, sources and canvas dimensions. Retain intentional fixed layouts; report the suggestion instead of changing them automatically.',
    };
  }
  if (!receipt.ok && receipt.status === 'fail' && receipt.failedStage === 'validate') {
    compact.nextAction = {
      action: 'edit-in-place',
      candidate: receipt.specification?.path,
      constraint: receipt.type === 'architecture' && (receipt.diagnostics || []).some((entry) => ROUTE_DIAGNOSTIC.test(entry.code || ''))
        ? 'Preserve all semantics and user-fixed geometry. Use references/architecture-layout-repair.md to choose a local repair or connected-scene reflow; edit the existing candidate.'
        : 'Preserve unaffected semantics and geometry; apply each diagnostic\'s supportedFixes, or the fix its message names, and do not replace the whole candidate.',
      then: 'finalize-once',
    };
  }
  return compact;
}

// Candidate repairs bind both the prior file identity and its bytes.
// Publication uses a verified private sibling and preserves the candidate
// mode; a failed write never leaves a partial candidate behind.
function captureCandidate(file) {
  const captured = captureAtomicOutput(file, { requestedEntryPolicy: 'regular-or-absent' });
  if (captured.status !== 'captured' || captured.snapshot.target.kind === 'absent') {
    throw new Error('The candidate cannot be captured safely.');
  }
  const bytes = fs.readFileSync(file);
  if (verifyAtomicOutput(captured.snapshot).status !== 'match') throw new Error('The candidate changed during capture.');
  return { ...captured, bytes };
}

export function replaceCandidate(file, contents, { writeFile = fs.writeFileSync, expected = captureCandidate(file) } = {}) {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  const staged = path.join(path.dirname(file), `.archify-candidate-${randomUUID()}.json`);
  let binding;
  let stagedIdentity;
  try {
    fs.writeFileSync(staged, Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
    const created = fs.lstatSync(staged, { bigint: true });
    stagedIdentity = { device: created.dev, inode: created.ino };
    writeFile(staged, bytes, { flag: 'w', mode: 0o600 });
    const metadata = fs.lstatSync(staged, { bigint: true });
    if (!metadata.isFile() || metadata.dev !== stagedIdentity.device || metadata.ino !== stagedIdentity.inode) {
      throw new Error('The staged candidate changed during writing.');
    }
    if (expected.mode !== null) fs.chmodSync(staged, expected.mode);
    if (!fs.readFileSync(staged).equals(bytes)) throw new Error('The staged candidate does not match the prepared bytes.');
    const captured = captureRegularFileBinding(staged, {
      subject: 'finalize-candidate', expectedIdentity: stagedIdentity,
      expectedSha256: sha256(bytes), expectedBytes: bytes.byteLength,
    });
    if (captured.status !== 'captured') throw new Error('The staged candidate cannot be bound safely.');
    binding = captured.binding;
    if (!fs.readFileSync(file).equals(expected.bytes)) throw new Error('The candidate changed since repair preparation.');
    // Prepare the next identity-bound snapshot before publication. A committed
    // replacement must remain recoverable even if subsequent inspection fails.
    const stagedCapture = captureCandidate(staged);
    const next = { ...expected, bytes, snapshot: { ...expected.snapshot,
      requestedEntry: stagedCapture.snapshot.requestedEntry, target: stagedCapture.snapshot.target } };
    const publication = publishRegularFileBinding(binding, staged, expected.snapshot, {
      subject: 'finalize-candidate', expectedPreviousSha256: sha256(expected.bytes), expectedPreviousBytes: expected.bytes.byteLength,
    });
    if (!['committed', 'committed-with-warning'].includes(publication.status)) {
      throw new Error(`The candidate replacement failed safely (${publication.reason?.code || publication.status}).`);
    }
    return { ...next, publication };
  } finally {
    if (binding) releaseRegularFileBinding(binding);
    if (stagedIdentity) removeOwnedRegularFile(staged, stagedIdentity, { subject: 'finalize-candidate' });
  }
}

function pointerTarget(document, pointer) {
  const keys = String(pointer || '').split('/').slice(1).map((key) => key.replace(/~1/g, '/').replace(/~0/g, '~'));
  let node = document;
  for (const key of keys) {
    if (node === null || typeof node !== 'object' || !Object.hasOwn(node, key)) return null;
    node = node[key];
  }
  return node && typeof node === 'object' ? node : null;
}

// Only an existing citation with a valid start and an end past EOF can be
// narrowed without selecting a new start, file, or revision. Revalidate the
// entire candidate afterward; this does not verify the cited factual claim.
function repairSourceRanges(candidatePath, diagnostics, specification, expected) {
  if (!diagnostics?.length || !expected) return null;
  if (!diagnostics.every(d => d.code === 'repository-evidence/line-out-of-range'
    && Number.isSafeInteger(d.evidence?.line) && d.evidence.line > 0
    && Number.isSafeInteger(d.evidence?.endLine)
    && Number.isSafeInteger(d.evidence?.lineCount) && d.evidence.lineCount >= d.evidence.line
    && d.evidence.endLine > d.evidence.lineCount)) return null;
  try {
    if (verifyAtomicOutput(expected.snapshot).status !== 'match') return null;
    const bytes = fs.readFileSync(candidatePath);
    if (!bytes.equals(expected.bytes) || !identitiesMatch(specification,
      { sha256: sha256(bytes), bytes: bytes.byteLength })) return null;
    const candidate = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    // Serialization must change only the end_line tokens, including preserving
    // original number spellings and precision, whitespace, and encoding.
    if (!bytes.equals(Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`))) return null;
    const sourceRanges = [];
    for (const diagnostic of diagnostics) {
      const source = pointerTarget(candidate, diagnostic.subject?.path);
      const { line, endLine, lineCount, sourcePath } = diagnostic.evidence;
      if (!source || source.line !== line || source.end_line !== endLine) return null;
      // path-contract-allow: git-path -- Both values name the same repository-relative citation token.
      if (source.path !== sourcePath) return null;
      source.end_line = lineCount;
      sourceRanges.push({ path: diagnostic.subject.path, endLine: [endLine, lineCount] });
    }
    const capture = replaceCandidate(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, { expected });
    return { originalBytes: bytes, capture, record: {
      originalSha256: specification.sha256, repairedSha256: sha256(capture.bytes), sourceRanges,
      ...(capture.publication.status === 'committed-with-warning' ? { publicationWarning: capture.publication } : {}),
    } };
  } catch {
    return null;
  }
}

export async function runFinalize({
  cliPath,
  type,
  input,
  output,
  quality = 'showcase',
  repoRoot,
  writingMode,
  candidateSha256,
  preparedExplainer,
  browserCheck = false,
  outDir,
  receiptPath,
  deliveryPaths = defaultDeliveryPaths,
  inspectDelivery,
  cwd = process.cwd(),
  env = process.env,
  runCommand = defaultRunner,
  runBrowserCheck,
  startUpdateCheck = startDeliveryUpdateCheck,
  resolveChrome = findChrome,
  createBrowser = (chromePath, options) => new ChromeVisualBrowser(chromePath, options),
} = {}) {
  if (!cliPath || !type || !input || !output) throw new Error('finalize requires cliPath, type, input, and output.');
  const needsBrowser = type !== 'explainer' || browserCheck;
  const started = process.hrtime.bigint();
  const startedAt = new Date().toISOString();
  const resolvedInput = path.resolve(input);
  const inputPaths = type === 'explainer'
    ? declaredExplainerInputPaths(fs.readFileSync(resolvedInput, 'utf8'), resolvedInput)
    : [resolvedInput];
  const resolvedOutput = resolveOutputPath({ requestedOutput: output, inputPaths }).outputPath;
  const resolvedOutDir = outDir === undefined ? undefined : resolveNativeOutputDirectory(outDir);
  let specification = identity(resolvedInput);
  let specificationCapture;
  try { specificationCapture = captureCandidate(resolvedInput); } catch {}
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
  // Validate raw native CLI paths before creating directories or normalizing them.
  if (receiptPath !== undefined) resolveOutputPath({ requestedOutput: receiptPath, inputPaths, requiredExtension: '.json' });
  fs.mkdirSync(path.dirname(canonicalFuturePath(resolvedOutput)), { recursive: true });
  const resolvedReceipt = resolveOutputPath({
    requestedOutput: receiptPath ?? defaultFinalizeReceiptPath(resolvedOutput, { outDir: resolvedOutDir }),
    inputPaths, requiredExtension: '.json',
  }).outputPath;
  const resolvedSummary = resolveOutputPath({
    requestedOutput: defaultFinalizeSummaryPath(resolvedReceipt), inputPaths, requiredExtension: '.json',
  }).outputPath;
  const assertReceiptPaths = () => {
    if (type === 'explainer') {
      const publications = Object.values(deliveryPaths(resolvedOutput));
      if (needsBrowser) publications.push(browserCheckSidecarPaths(resolvedOutput, { outDir: resolvedOutDir }).receipt);
      for (const target of publications) {
        resolveOutputPath({ requestedOutput: target, inputPaths, requiredExtension: '.json', inputDescription: 'an Explainer input' });
      }
    }
    const reserved = reservedFinalizePaths({ input: resolvedInput, output: resolvedOutput, outDir: resolvedOutDir, deliveryPaths, inputPaths });
    const receiptCollision = reserved.find((file) => pathsAlias(resolvedReceipt, file));
    if (receiptCollision) throw new Error(`The finalize receipt must be distinct from the specification, artifact, and gate sidecars: "${receiptCollision}".`);
    const summaryCollision = [resolvedReceipt, ...reserved].find((file) => pathsAlias(resolvedSummary, file));
    if (summaryCollision) throw new Error(`The finalize summary must be distinct from the full receipt, specification, artifact, and gate sidecars: "${summaryCollision}".`);
  };
  assertReceiptPaths();
  // Capture both paths before changing either: an unsafe summary cannot leave a new full receipt behind.
  let receiptCapture = captureReceipt(resolvedReceipt);
  let summaryCapture = captureReceipt(resolvedSummary);

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
    stages: needsBrowser ? {} : {'browser-check':{status:'not-run',execution:'not-requested'}},
    browserCheck: {requested:needsBrowser,ran:false},
    diagnostics: [],
    evidence: { receipt: resolvedReceipt, summaryReceipt: resolvedSummary },
    visualReview: 'not-requested',
  };
  const persistReceipts = () => {
    if (type === 'explainer') receipt.diagnostics = (receipt.diagnostics || []).map(entry => {
      const location=preparedExplainer?.sourceMap?.[entry.subject?.path] || {};
      return {...entry,subject:{input:resolvedInput,line:location.line || 1,component:'document',...(entry.subject || {})},
        evidence:{reason:entry.code,example:entry.supportedFixes?.[0] || 'Repair the named original draft component and rerun finalize.',...(entry.evidence || {})}};
    });
    assertReceiptPaths();
    for (const [file, capture] of [[resolvedReceipt, receiptCapture], [resolvedSummary, summaryCapture]]) {
      const current = verifyAtomicOutput(capture.snapshot);
      if (current.status !== 'match') throw receiptWriteError(file, current);
    }
    receiptCapture = writeJsonAtomic(resolvedReceipt, receipt, receiptCapture, assertReceiptPaths);
    summaryCapture = writeJsonAtomic(resolvedSummary, compactFinalizeReceipt(receipt), summaryCapture, assertReceiptPaths);
  };
  persistReceipts();
  // The gates below usually take seconds, so a slower network can finish the
  // update check in parallel instead of timing out on every delivery.
  const updateCheck = startUpdateCheck({ env, deadlineMs: needsBrowser ? FINALIZE_UPDATE_DEADLINE_MS : 200 });

  // Resolve and launch Chrome only after delivery and strict artifact checks pass.
  // Invalid candidates must not start a browser that cannot inspect an artifact.
  let chromePath = null;
  let browser;
  let browserStartupError;
  let browserTransferred = false;
  const browserFactory = () => {
    if (browserStartupError) throw browserStartupError;
    if (browserTransferred || !browser) throw new Error('The finalize browser is unavailable or already consumed.');
    browserTransferred = true;
    return browser;
  };

  let repair;
  const restoreRepair = () => {
    if (!repair || receipt.autoRepair?.outcome === 'reverted' || receipt.autoRepair?.outcome === 'restore-failed') return;
    try {
      invalidateRepairedDelivery(resolvedOutput, receipt.stages.deliver?.receipt, deliveryPaths);
      const restored = replaceCandidate(resolvedInput, repair.originalBytes, { expected: repair.capture });
      receipt.autoRepair = { ...repair.record, outcome: 'reverted',
        ...(restored.publication.status === 'committed-with-warning' ? { restoreWarning: restored.publication } : {}) };
    } catch (error) {
      receipt.autoRepair = { ...repair.record, outcome: 'restore-failed', reason: error.message };
    }
  };
  try {
    let exitCode = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      for (const stage of (needsBrowser ? ['deliver', 'check', 'browser-check'] : ['deliver','check'])) {
        const stageStarted = process.hrtime.bigint();
        const args = stageArguments({
          stage,
          type,
          input: resolvedInput,
          output: resolvedOutput,
          quality,
          repoRoot,
          writingMode,
          outDir: resolvedOutDir,
        });
        const inProcess = stage === 'browser-check' && runBrowserCheck;
        let result;
        if (preparedExplainer) {
          try {
            const { assertPreparedDependencies } = await import('../explainer/prepare.mjs');
            assertPreparedDependencies(preparedExplainer);
          } catch (error) {
            result = { status: 1, stdout: JSON.stringify({ok:false,status:'fail',command:stage,stage:'prepare',diagnostics:error.archifyDiagnostics || []}) };
          }
        }
        if (result) {
          // The original resources changed between gates; do not run another gate on them.
        } else if (inProcess) {
          try {
            chromePath = resolveChrome({ env });
            if (chromePath) {
              browser = createBrowser(chromePath, { env });
              // Retain the startup rejection for the browser gate without emitting
              // an unhandled rejection before inspect() awaits the same promise.
              browser.sessionPromise.catch(() => {});
            }
          } catch (error) {
            browserStartupError = error;
          }
          // Discovery errors have no executable for the browser factory. Record
          // a failed gate instead of treating them as ordinary Chrome absence.
          const checked = browserStartupError && !chromePath
            ? { exitCode: 1, receipt: persistBrowserCheckFailure(resolvedOutput, {
              schemaVersion: 1, ok: false, command: 'browser-check', status: 'fail',
              evidenceKind: 'automated-browser', visualReview: 'not-requested',
              error: browserStartupError.message,
              diagnostics: [{
                code: 'viewer/browser-check-runtime', severity: 'error',
                message: 'browser-check could not discover Chrome.',
                subject: { artifact: resolvedOutput },
                evidence: { reason: browserStartupError.message },
                supportedFixes: ['resolve the reported Chrome discovery error, then rerun browser-check'],
              }],
            }, { outDir: resolvedOutDir }) }
            : await runBrowserCheck({
              artifactPath: resolvedOutput,
              outDir: resolvedOutDir,
              chromePath,
              resolveChrome: () => chromePath,
              browserFactory,
            });
          result = { status: checked.exitCode, stdout: JSON.stringify(checked.receipt) };
        } else {
          result = await runCommand({ stage, cliPath, args, cwd,
            env: stage === 'deliver' ? { ...env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' } : env });
        }
        if (preparedExplainer && result.status === 0) {
          try {
            const { assertPreparedDependencies } = await import('../explainer/prepare.mjs');
            assertPreparedDependencies(preparedExplainer);
          } catch (error) {
            result = { status: 1, stdout: JSON.stringify({ok:false,status:'fail',command:stage,stage:'prepare',diagnostics:error.archifyDiagnostics || []}) };
          }
        }
        const stageReceipt = parsedReceipt(result.stdout);
        if (stage === 'browser-check') receipt.browserCheck.ran = Boolean(stageReceipt?.containment?.viewports?.length);
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
        } else if (stage === 'deliver' && code === 0 && quality === 'showcase'
            && Number.isSafeInteger(stageReceipt?.validation?.warnings)
            && stageReceipt.validation.warnings > 0
            && validStageReceipt(stage, stageReceipt, quality, { allowShowcaseWarnings: true })) {
          const bindingDiagnostic = stageBindingDiagnostic({
            stage, receipt: stageReceipt, output: resolvedOutput, specification, type,
          });
          stageDiagnostics = bindingDiagnostic ? [bindingDiagnostic] : showcaseWarningDiagnostics(stageReceipt);
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
          // Non-blocking warnings (for example locale fallbacks) stay visible in
          // a passing receipt; a later failing gate replaces them.
          receipt.diagnostics = (stageReceipt.diagnostics || []).filter((entry) => entry?.severity === 'warning');
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
          receipt.diagnostics = consolidateDiagnostics(
            stageDiagnostics || failureDiagnostics(stage, result, stageReceipt, quality),
          );
          receipt.failedStage = stage === 'deliver'
            && receipt.stages.validate.status === 'fail' ? 'validate' : stage;
          break;
        }
        persistReceipts();
      }
      if (attempt === 0 && exitCode !== 0 && receipt.failedStage === 'validate') {
        repair = repairSourceRanges(resolvedInput, receipt.diagnostics, specification, specificationCapture);
        if (repair) {
          specification = { path: resolvedInput, sha256: sha256(repair.capture.bytes), bytes: repair.capture.bytes.byteLength };
          Object.assign(receipt, { status: 'running', specification, stages: needsBrowser ? {} : {
            'browser-check': { status: 'not-run', execution: 'not-requested' } },
            diagnostics: [], artifact: { path: resolvedOutput }, autoRepair: { ...repair.record, outcome: 'retrying' } });
          delete receipt.failedStage;
          exitCode = 0;
          if (repair.record.publicationWarning) {
            const error = new Error('The repaired candidate was published with a cleanup warning; finalize will restore it.');
            error.finalizeCode = 'finalize/candidate-publication';
            throw error;
          }
          persistReceipts();
          continue;
        }
      }
      break;
    }

    // Finish owned browser cleanup before a successful receipt can be published.
    if (browser && !browserTransferred) {
      await browser.close();
      browser = null;
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
        deliveryPath: deliveryPaths(resolvedOutput).provenance,
        inspectDelivery,
      });
      if (diagnostic) {
        exitCode = 1;
        receipt.ok = false;
        receipt.status = 'fail';
        receipt.failedStage = 'finalize';
        receipt.diagnostics = [diagnostic];
      }
    }
    if (receipt.ok && !identitiesMatch(specification, identity(resolvedInput))) {
      exitCode = 1;
      receipt.ok = false;
      receipt.status = 'fail';
      receipt.failedStage = 'finalize';
      receipt.diagnostics = [{
        code: 'finalize/candidate-changed', severity: 'error',
        message: 'The frozen candidate changed before the final handoff.',
        subject: { candidate: resolvedInput },
        evidence: { expected: specification, actual: identity(resolvedInput) },
        supportedFixes: ['restore the frozen candidate, or finalize the edited candidate as a new attempt'],
      }];
    }
    if (repair) {
      if (receipt.ok) receipt.autoRepair = { ...repair.record, outcome: 'applied' };
      else restoreRepair();
    }
    receipt.artifact = receipt.ok
      ? { path: resolvedOutput, ...receipt.stages.deliver.receipt.artifact }
      : identity(resolvedOutput);
    receipt.finishedAt = new Date().toISOString();
    receipt.durationMs = durationMs(started);
    receipt.update = await updateCheck;
    persistReceipts();
    return { exitCode, receipt, summary: compactFinalizeReceipt(receipt) };
  } catch (error) {
    restoreRepair();
    if (repair) error.finalizeEvidence = { ...error.finalizeEvidence, autoRepair: receipt.autoRepair };
    throw error;
  } finally {
    if (browser && !browserTransferred) await browser.close();
    await updateCheck;
  }
}
