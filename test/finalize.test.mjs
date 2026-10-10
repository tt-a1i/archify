import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  FINALIZE_STAGES,
  compactFinalizeReceipt,
  defaultFinalizeReceiptPath,
  defaultFinalizeSummaryPath,
  runFinalize,
} from '../archify/bin/finalize.mjs';
import { CAPTURE_VIEWPORTS, VISUAL_CHECK_VIEWPORTS } from '../archify/bin/visual-check.mjs';
import { bipartiteArchitectureSpec } from './helpers/dense-fixture.mjs';

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-finalize-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function result(receipt, status = 0, stderr = '') {
  return { status, signal: null, stdout: `${JSON.stringify(receipt)}\n`, stderr };
}

function artifactIdentity(contents) {
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.byteLength,
  };
}

function writeCurrentDelivery(output, receipt) {
  fs.writeFileSync(output.replace(/\.html?$/i, '.delivery.json'), `${JSON.stringify({
    schemaVersion: 1,
    receiptId: receipt.receiptId,
    status: 'current',
    command: 'deliver',
    type: receipt.type,
    input: receipt.input,
    output: receipt.output,
    specification: receipt.specification,
    artifact: receipt.artifact,
  })}\n`);
}

function passingDelivery({ input, output, source, artifact = '<!doctype html><title>verified</title>', receiptId = '11111111-1111-4111-8111-111111111111', quality = 'showcase', type = 'architecture' }) {
  fs.writeFileSync(output, artifact);
  const receipt = {
    schemaVersion: 1,
    receiptId,
    ok: true,
    command: 'deliver',
    type,
    input,
    output,
    specification: artifactIdentity(source),
    artifact: artifactIdentity(artifact),
    validation: {
      checksPassed: 9,
      checkCount: 9,
      compositionProfile: quality,
      compositionStatus: 'pass',
      errors: 0,
      warnings: 0,
    },
  };
  writeCurrentDelivery(output, receipt);
  return receipt;
}

function passingCheck({ output, artifact, deliveryReceiptId, quality = 'showcase', checkCount = 9 }) {
  return {
    schemaVersion: 1,
    ok: true,
    file: output,
    artifact,
    checks: Array.from({ length: checkCount }, (_, index) => ({ name: `artifact-${index}`, ok: true })),
    provenance: 'current',
    deliveryReceiptId,
    composition: {
      schemaVersion: 1,
      profile: quality,
      status: 'pass',
      summary: { errors: 0, warnings: 0 },
    },
  };
}

function passingBrowserCheck({ output, artifact, deliveryReceiptId, outDir }) {
  return {
    schemaVersion: 1,
    ok: true,
    command: 'browser-check',
    evidenceKind: 'automated-browser',
    status: 'pass',
    visualReview: 'not-requested',
    provenance: 'current',
    deliveryReceiptId,
    artifact: { path: output, ...artifact },
    diagnostics: [],
    containment: {
      status: 'pass',
      viewports: VISUAL_CHECK_VIEWPORTS.map(({ width, height }) => ({ width, height, theme: 'light', ok: true })),
    },
    themeStates: {
      status: 'pass',
      viewports: [
        ...VISUAL_CHECK_VIEWPORTS.map((viewport) => ({ ...viewport, requestedTheme: 'light', resolvedTheme: 'light', ok: true })),
        ...CAPTURE_VIEWPORTS.map((viewport) => ({ ...viewport, requestedTheme: 'dark', resolvedTheme: 'dark', ok: true })),
      ],
    },
    readability: {
      status: 'pass',
      viewports: VISUAL_CHECK_VIEWPORTS.map(({ width, height }) => ({ width, height, theme: 'light', ok: true, readabilityOk: true })),
    },
    viewerChrome: {
      status: 'pass',
      viewports: VISUAL_CHECK_VIEWPORTS.map(({ width, height }) => ({ width, height, theme: 'light', ok: true, viewerChromeOk: true })),
    },
    captures: { status: 'not-requested', screenshots: [], contactSheet: null, contactSheetImage: null },
    sidecars: { directory: outDir, receipt: 'diagram.browser-check.json' },
  };
}

test('finalize reuses delivery validation, runs one build, and keeps full stage receipts out of its compact summary', async t => {
  const directory = workspace(t);
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  const outDir = path.join(directory, 'evidence');
  const source = '{"meta":{"quality_profile":"showcase"}}';
  fs.writeFileSync(input, source);
  const calls = [];
  const runCommand = ({ stage, args }) => {
    calls.push({ stage, args });
    if (stage === 'deliver') {
      return result(passingDelivery({ input, output, source }));
    }
    if (stage === 'check') {
      const delivery = passingDelivery({ input, output, source });
      return result(passingCheck({ output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId }));
    }
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'diagram.browser-check.json'), 'browser evidence');
    const delivery = passingDelivery({ input, output, source });
    const browser = passingBrowserCheck({ output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId, outDir });
    browser.containment.viewports[0].large = 'large-stage-array-is-kept-only-in-full-receipt';
    return result(browser);
  };

  const finalized = await runFinalize({
    cliPath: '/fake/archify.mjs',
    type: 'architecture',
    input,
    output,
    outDir,
    runCommand,
  });

  assert.equal(finalized.exitCode, 0);
  assert.equal(finalized.receipt.ok, true);
  assert.deepEqual(calls.map(({ stage }) => stage), ['deliver', 'check', 'browser-check']);
  assert.deepEqual(finalized.summary.gates, {
    validate: 'pass', deliver: 'pass', check: 'pass', 'browser-check': 'pass',
  });
  assert.equal(finalized.summary.evidence.browserCheckReceipt, path.join(outDir, 'diagram.browser-check.json'));
  assert.equal(finalized.summary.visualReview, 'not-requested');
  assert.equal('stages' in finalized.summary, false);
  assert.equal(JSON.stringify(finalized.summary).includes('large-stage-array'), false);
  assert.equal(finalized.receipt.stages['browser-check'].receipt.containment.viewports.length, VISUAL_CHECK_VIEWPORTS.length);

  const receiptPath = defaultFinalizeReceiptPath(output, { outDir });
  assert.equal(finalized.summary.evidence.receipt, receiptPath);
  const summaryPath = defaultFinalizeSummaryPath(receiptPath);
  assert.equal(finalized.summary.evidence.summaryReceipt, summaryPath);
  const persisted = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  assert.equal(persisted.ok, true);
  assert.equal(persisted.stages.validate.execution, 'embedded-in-deliver');
  assert.equal(persisted.stages.validate.receipt.validation.checkCount, 9);
  const persistedSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.equal(persistedSummary.ok, true);
  assert.equal('stages' in persistedSummary, false);
});

test('finalize stops at the failed gate and persists actionable failure evidence', async t => {
  const directory = workspace(t);
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  fs.writeFileSync(input, '{}');
  const calls = [];
  const finalized = await runFinalize({
    cliPath: '/fake/archify.mjs',
    type: 'workflow',
    input,
    output,
    runCommand: ({ stage }) => {
      calls.push(stage);
      return result({
        ok: false,
        command: 'deliver',
        stage: 'render',
        diagnostics: [{
          code: 'composition/route-crossing',
          severity: 'error',
          message: 'A route crosses an unrelated node.',
          subject: { edge: 'a-b' },
          evidence: { intersection: [12, 40] },
          supportedFixes: ['move the diagnosed route'],
        }],
      }, 1);
    },
  });

  assert.equal(finalized.exitCode, 1);
  assert.deepEqual(calls, ['deliver']);
  assert.equal(finalized.receipt.failedStage, 'validate');
  assert.equal(finalized.summary.gates.deliver, 'not-run');
  assert.equal(finalized.summary.gates.check, 'not-run');
  assert.equal(finalized.summary.gates['browser-check'], 'not-run');
  assert.deepEqual(finalized.summary.diagnostics, [{
    code: 'composition/route-crossing',
    severity: 'error',
    message: 'A route crosses an unrelated node.',
    subject: { edge: 'a-b' },
    evidence: { intersection: [12, 40] },
    supportedFixes: ['move the diagnosed route'],
  }]);
  assert.deepEqual(finalized.summary.diagnosticSummary, { total: 1, shown: 1, truncated: false });
  assert.deepEqual(finalized.summary.nextAction, {
    action: 'edit-in-place',
    candidate: input,
    constraint: 'Preserve unaffected semantics and geometry; apply each diagnostic\'s supportedFixes, or the fix its message names, and do not replace the whole candidate.',
    then: 'finalize-once',
  });
  assert.equal(finalized.receipt.diagnostics[0].evidence.intersection[1], 40);
  assert.equal(JSON.parse(fs.readFileSync(finalized.summary.evidence.receipt)).status, 'fail');
  const persistedSummary = JSON.parse(fs.readFileSync(finalized.summary.evidence.summaryReceipt));
  assert.deepEqual(persistedSummary, finalized.summary);
});

test('compact finalize receipts preserve the acceptance boundary', () => {
  const compact = compactFinalizeReceipt({
    ok: true,
    status: 'pass',
    type: 'sequence',
    quality: 'showcase',
    specification: { path: '/tmp/spec.json', sha256: 'spec' },
    artifact: { path: '/tmp/artifact.html', sha256: 'artifact' },
    stages: Object.fromEntries(['validate', 'deliver', 'check', 'browser-check'].map((stage) => [stage, { status: 'pass' }])),
    diagnostics: [],
    evidence: { receipt: '/tmp/artifact.finalize.json', browserCheckReceipt: '/tmp/artifact.browser-check.json' },
    visualReview: 'not-requested',
    durationMs: 4200,
  });
  assert.equal(compact.ok, true);
  assert.equal(compact.visualReview, 'not-requested');
  assert.equal(compact.gates['browser-check'], 'pass');
  assert.equal(compact.evidence.browserCheckReceipt.endsWith('.json'), true);
  assert.deepEqual(compact.diagnosticSummary, { total: 0, shown: 0, truncated: false });
  assert.equal('nextAction' in compact, false);
});

test('compact success retains route-quality review signals without claiming perceptual approval', () => {
  const compact = compactFinalizeReceipt({
    ok: true, status: 'pass', diagnostics: [],
    stages: { check: { status: 'pass', receipt: { composition: { metrics: {
      resolvedCrossovers: 12, routesOverSuggestedBends: 11, routesOverSuggestedStretch: 0,
    } } } } },
  });
  assert.equal(compact.ok, true);
  assert.equal(compact.visualReview, 'not-requested');
  assert.deepEqual(compact.visualReviewRecommendation.signals, { resolvedCrossovers: 12, routesOverSuggestedBends: 11 });
  assert.equal(compact.visualReviewRecommendation.action, 'inspect-route-readability');
  const uncomplicated = compactFinalizeReceipt({ ok: true, stages: { check: { receipt: { composition: { metrics: {
    resolvedCrossovers: 0, routesOverSuggestedBends: 0, routesOverSuggestedStretch: 0,
  } } } } } });
  assert.equal('visualReviewRecommendation' in uncomplicated, false);
});

test('compact leading-space advice preserves successful gates and optional visual review', () => {
  const leadingSpace = { occupiedTop: 181, emptyTopPx: 181, canvasHeight: 576,
    emptyTopRatio: 181 / 576, reviewSuggested: true };
  const receipt = { ok: true, status: 'pass', diagnostics: [], stages: {
    check: { status: 'pass', receipt: { composition: { leadingSpace } } },
  } };
  const compact = compactFinalizeReceipt(receipt);
  assert.equal(compact.status, 'pass');
  assert.equal(compact.gates.check, 'pass');
  assert.deepEqual(compact.diagnostics, []);
  assert.equal(compact.visualReview, 'not-requested');
  assert.equal(compact.layoutReviewRecommendation.action, 'inspect-leading-space');
  assert.deepEqual(compact.layoutReviewRecommendation.evidence, leadingSpace);
  assert.match(compact.layoutReviewRecommendation.repair, /user-fixed geometry/);
  assert.match(compact.layoutReviewRecommendation.repair, /No screenshot is required/);
  leadingSpace.reviewSuggested = false;
  assert.equal('layoutReviewRecommendation' in compactFinalizeReceipt(receipt), false);
  leadingSpace.reviewSuggested = true;
  assert.equal('layoutReviewRecommendation' in compactFinalizeReceipt({ ...receipt, ok: false, status: 'fail' }), false);
});

test('compact success bounds review context and preserves relationship identity', () => {
  const crossings = Array.from({ length: 10 }, (_, index) => ({ left: { id: `edge-${index}` }, right: { id: 'hub' }, point: [index, 50] }));
  const detours = [{ relationship: { id: 'return', from: 'worker', to: 'api' }, bends: 4, stretch: 1.5,
    directCorridorBlockers: [{ id: 'store', label: 'Shared store', box: [100, 40, 80, 50] }],
  }];
  const compact = compactFinalizeReceipt({ ok: true, stages: { check: { receipt: { composition: {
    metrics: { resolvedCrossovers: 10, routesOverSuggestedBends: 1 }, routeReview: { crossings, detours },
  } } } } });
  assert.deepEqual(compact.visualReviewRecommendation.affectedRoutes, {
    crossings: crossings.slice(0, 8), detours, truncated: true,
  });
  assert.equal(crossings.length, 10, 'compaction does not truncate the full evidence');
  assert.equal(compact.visualReview, 'not-requested');
  assert.match(compact.visualReviewRecommendation.repair, /architecture-layout-repair\.md/);
});

test('compact success turns route evidence into node-move hints that keep relationships', () => {
  const routeReview = {
    crossings: [
      { left: { from: 'desktop', to: 'http' }, right: { from: 'tunnel', to: 'http' }, sharedNode: 'http' },
      { left: { from: 'teamcli', to: 'http' }, right: { from: 'runtime', to: 'sqlite' } },
    ],
    crowdedSides: [{ node: 'app', side: 'right', relationships: 4, sidePx: 70, neededPx: 74 }],
    detours: [
      { relationship: { from: 'registry', to: 'shim' }, bends: 3 },
      { relationship: { from: 'worker', to: 'api' }, bends: 4, directCorridorBlockers: [{ id: 'store' }] },
    ],
  };
  const { hints } = compactFinalizeReceipt({ ok: true, stages: { check: { receipt: { composition: {
    metrics: { resolvedCrossovers: 2, routesOverSuggestedBends: 2 }, routeReview,
  } } } } }).visualReviewRecommendation;
  assert.equal(hints.length, 4, 'a detour with named corridor blockers keeps its existing repair path');
  assert.match(hints[0], /app has 4 relationships facing its right side, which fits 3 ports: make that side at least 74px/);
  assert.match(hints[1], /move node desktop or tunnel so the two reach http from different sides/);
  assert.match(hints[2], /teamcli → http crosses runtime → sqlite/);
  assert.match(hints[3], /move node registry or shim/);
  assert.ok(hints.every((hint) => !/endpoint/.test(hint)), 'hints move nodes, never re-attach relationships');
  assert.equal('hints' in compactFinalizeReceipt({ ok: true, stages: { check: { receipt: { composition: {
    metrics: { resolvedCrossovers: 1 }, routeReview: { crossings: [], detours: [] },
  } } } } }).visualReviewRecommendation, false);
});

test('compact failure receipts retain diverse actionable subjects without embedding full stage evidence', () => {
  const diagnostics = Array.from({ length: 20 }, (_, index) => ({
    code: 'composition/proper-crossing',
    severity: 'error',
    message: `Connection edge-${index} crosses another route.`,
    subject: { id: `edge-${index}`, collection: 'connections', index },
    evidence: { crossing: { x: index * 10, y: index * 20 } },
    supportedFixes: [`move edge-${index} without changing its endpoints`],
  }));
  const receipt = {
    ok: false,
    status: 'fail',
    failedStage: 'validate',
    type: 'architecture',
    quality: 'showcase',
    specification: { path: '/tmp/spec.json', sha256: 'spec' },
    artifact: { path: '/tmp/artifact.html' },
    stages: { validate: { status: 'fail', receipt: { diagnostics, renderedHtml: 'x'.repeat(100000) } } },
    diagnostics,
    evidence: {
      receipt: '/tmp/artifact.finalize.json',
      summaryReceipt: '/tmp/artifact.finalize-summary.json',
    },
  };

  const compact = compactFinalizeReceipt(receipt);
  assert.equal(compact.diagnostics.length, 8);
  assert.equal(new Set(compact.diagnostics.map(({ subject }) => subject.id)).size, 8);
  assert.deepEqual(compact.diagnosticSummary, { total: 20, shown: 8, truncated: true, omittedByCode: { 'composition/proper-crossing': 12 } });
  assert.equal(compact.nextAction.action, 'edit-in-place');
  assert.match(compact.nextAction.constraint, /Preserve all semantics and user-fixed geometry/);
  assert.match(compact.nextAction.constraint, /local repair or connected-scene reflow/);
  assert.equal('stages' in compact, false);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(receipt).length / 4);
});

test('compact failure summaries count omitted entries by code with repeated subjects', () => {
  const codes = ['composition/proper-crossing', 'layout/constraint', '__proto__'];
  const diagnostics = Array.from({ length: 14 }, (_, index) => ({
    code: codes[index % codes.length],
    message: `Failure ${index}`,
    subject: { id: `edge-${Math.floor(index / 3)}` },
  }));
  const receipt = { ok: false, status: 'fail', diagnostics };
  const originalDiagnostics = structuredClone(diagnostics);
  const compact = compactFinalizeReceipt(receipt);
  assert.deepEqual(compact.diagnostics.map(({ message }) => message),
    [0, 1, 2, 3, 6, 9, 12, 4].map(index => `Failure ${index}`));
  const omitted = diagnostics.filter(entry => !compact.diagnostics.some(shown => shown.message === entry.message));
  assert.equal(omitted.length, compact.diagnosticSummary.total - compact.diagnosticSummary.shown);
  assert.deepEqual(compact.diagnosticSummary.omittedByCode, { 'layout/constraint': 3, ['__proto__']: 3 });
  assert.deepEqual(Object.entries(compact.diagnosticSummary.omittedByCode), [
    ['layout/constraint', omitted.filter(({ code }) => code === 'layout/constraint').length],
    ['__proto__', omitted.filter(({ code }) => code === '__proto__').length],
  ]);
  assert.equal(Object.values(compact.diagnosticSummary.omittedByCode).reduce((sum, count) => sum + count, 0), omitted.length);
  assert.deepEqual(receipt.diagnostics, originalDiagnostics);
  for (const entries of [[], diagnostics.slice(0, 8)]) {
    const summary = compactFinalizeReceipt({ ...receipt, diagnostics: entries }).diagnosticSummary;
    assert.equal('omittedByCode' in summary, false);
  }
});

test('merged viewport-overflow diagnostics preserve each subject, evidence, and detection source', async t => {
  const directory = workspace(t);
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  fs.writeFileSync(input, '{}');
  const diagnostics = [
    {
      code: 'viewer/viewport-overflow',
      severity: 'error',
      message: 'meta.title overflows the 2048px viewport by 193px.',
      subject: { diagramType: 'architecture', path: '/meta/title', viewport: '2048x1200' },
      evidence: { scrollWidth: 2241, scrollHeight: 1200, overflowX: true, overflowY: false, overflowDisposition: 'clipped' },
      supportedFixes: ['shorten meta.title'],
    },
    {
      code: 'viewer/viewport-overflow',
      severity: 'error',
      message: 'meta.subtitle overflows the 2048px viewport by 91px.',
      subject: { diagramType: 'architecture', path: '/meta/subtitle', viewport: '2048x1200' },
      evidence: { scrollWidth: 2139, scrollHeight: 1200, overflowX: true, overflowY: false, overflowDisposition: 'clipped' },
      supportedFixes: ['shorten meta.subtitle'],
    },
    {
      code: 'viewer/viewport-overflow',
      severity: 'error',
      message: 'meta.title (~4090px estimated) exceeds the widest 2048px viewport — it will overflow before render.',
      subject: { diagramType: 'architecture', path: '/meta/title' },
      evidence: { estimatedTextWidthPx: 4090, widestViewportPx: 2048, prediction: 'text-width estimate' },
      supportedFixes: ['shorten meta.title'],
    },
    {
      code: 'layout/constraint',
      severity: 'error',
      message: 'Two distinct subjects share this identical message.',
      subject: { diagramType: 'architecture', path: '/nodes/0/label' },
      evidence: { node: 0 },
      supportedFixes: [],
    },
    {
      code: 'layout/constraint',
      severity: 'error',
      message: 'Two distinct subjects share this identical message.',
      subject: { diagramType: 'architecture', path: '/nodes/1/label' },
      evidence: { node: 1 },
      supportedFixes: [],
    },
  ];

  const finalized = await runFinalize({
    cliPath: '/fake/archify.mjs',
    type: 'architecture',
    input,
    output,
    runCommand: () => result({ ok: false, command: 'deliver', diagnostics }, 1),
  });

  assert.equal(finalized.exitCode, 1);
  const [merged, ...rest] = finalized.receipt.diagnostics;
  assert.equal(merged.code, 'viewer/viewport-overflow');
  assert.equal(merged.subject.path, undefined, 'the merged entry must not keep only the first subject');
  assert.equal(merged.evidence.overflows.length, 3);
  assert.deepEqual(
    merged.evidence.overflows.map((entry) => [entry.subject.path, entry.detection]),
    [
      ['/meta/title', 'browser-measurement'],
      ['/meta/subtitle', 'browser-measurement'],
      ['/meta/title', 'validate-prediction'],
    ],
  );
  assert.equal(merged.evidence.overflows[0].evidence.scrollWidth, 2241);
  assert.equal(merged.evidence.overflows[1].evidence.scrollWidth, 2139);
  assert.equal(merged.evidence.overflows[2].evidence.estimatedTextWidthPx, 4090);
  // Identical messages with different subjects are not duplicates.
  assert.deepEqual(rest.map((entry) => entry.subject.path), ['/nodes/0/label', '/nodes/1/label']);
});

test('finalize refuses a receipt path that aliases a gate sidecar', async t => {
  const directory = workspace(t);
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  const visualReceipt = path.join(directory, 'diagram.browser-check.json');
  fs.writeFileSync(input, '{}');
  fs.writeFileSync(visualReceipt, 'preserve me');
  let invoked = false;

  await assert.rejects(() => runFinalize({
    cliPath: '/fake/archify.mjs',
    type: 'architecture',
    input,
    output,
    receiptPath: visualReceipt,
    runCommand: () => { invoked = true; return result({ ok: true }); },
  }), /gate sidecars/);
  assert.equal(invoked, false);
  assert.equal(fs.readFileSync(visualReceipt, 'utf8'), 'preserve me');
});

test('finalize binds a passing validate receipt to the unchanged candidate', async t => {
  const directory = workspace(t);
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  const source = '{"meta":{"quality_profile":"showcase"}}';
  fs.writeFileSync(input, source);
  const candidateSha256 = createHash('sha256').update(source).digest('hex');
  const calls = [];
  const pass = await runFinalize({
    cliPath: '/fake/archify.mjs',
    type: 'architecture',
    input,
    output,
    candidateSha256,
    runCommand: ({ stage }) => {
      calls.push(stage);
      const delivery = passingDelivery({ input, output, source, artifact: '<!doctype html>' });
      if (stage === 'deliver') return result(delivery);
      if (stage === 'check') return result(passingCheck({
        output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId,
      }));
      return result(passingBrowserCheck({
        output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId, outDir: directory,
      }));
    },
  });
  assert.equal(pass.exitCode, 0);
  assert.deepEqual(calls, ['deliver', 'check', 'browser-check']);

  fs.writeFileSync(input, `${source}\n`);
  await assert.rejects(() => runFinalize({
    cliPath: '/fake/archify.mjs',
    type: 'architecture',
    input,
    output: path.join(directory, 'changed.html'),
    candidateSha256,
    runCommand: () => { throw new Error('must not run'); },
  }), error => {
    assert.equal(error.finalizeCode, 'finalize/candidate-changed');
    assert.equal(error.finalizeEvidence.expectedSha256, candidateSha256);
    return true;
  });
});

test('finalize fails closed when a stage exits zero without a valid passing receipt', async t => {
  const invalidOutputs = [
    '',
    'not json',
    '{}',
    '"success"',
    '{"ok":true,"status":"fail","command":"validate","checks":[]}',
  ];

  for (const [index, stdout] of invalidOutputs.entries()) {
    const directory = workspace(t);
    const input = path.join(directory, `diagram-${index}.json`);
    const output = path.join(directory, `diagram-${index}.html`);
    fs.writeFileSync(input, '{}');
    const calls = [];
    const finalized = await runFinalize({
      cliPath: '/fake/archify.mjs',
      type: 'architecture',
      input,
      output,
      runCommand: ({ stage }) => {
        calls.push(stage);
        return { status: 0, signal: null, stdout, stderr: '' };
      },
    });
    assert.equal(finalized.exitCode, 1, `invalid receipt ${index} must fail`);
    assert.deepEqual(calls, ['deliver']);
    assert.equal(finalized.receipt.failedStage, 'deliver');
    assert.equal(finalized.summary.diagnostics[0].code, 'finalize/invalid-stage-receipt');
  }
});

test('showcase delivery warnings name the checker issue without advancing to later gates', async t => {
  const directory = workspace(t);
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  const source = '{"meta":{"quality_profile":"showcase"}}';
  fs.writeFileSync(input, source);
  const calls = [];
  const issue = {
    severity: 'warning', code: 'composition/viewport-height',
    viewBoxHeight: 700, overflowPx: 193,
    detail: '[composition/viewport-height] Preserve every node and compact vertical spacing to fit the Reader.',
  };
  const finalized = await runFinalize({
    cliPath: '/fake/archify.mjs', type: 'architecture', input, output,
    runCommand: ({ stage }) => {
      calls.push(stage);
      const delivery = passingDelivery({ input, output, source });
      delivery.validation.warnings = 1;
      delivery.validation.compositionIssues = [issue];
      return result(delivery);
    },
  });

  assert.equal(finalized.exitCode, 1);
  assert.deepEqual(calls, ['deliver']);
  assert.equal(finalized.receipt.failedStage, 'deliver');
  assert.equal(finalized.summary.gates.deliver, 'fail');
  assert.equal(finalized.summary.gates.check, 'not-run');
  assert.equal(finalized.summary.diagnostics[0].code, issue.code);
  assert.equal(finalized.summary.diagnostics[0].evidence.overflowPx, 193);
  assert.match(finalized.summary.diagnostics[0].supportedFixes[0], /compact vertical spacing/);
  assert.equal(finalized.summary.diagnostics[0].evidence.reportedSeverity, 'warning');
  assert.equal(JSON.parse(fs.readFileSync(finalized.summary.evidence.receipt)).diagnostics[0].code, issue.code);
});

test('showcase warning diagnostic never masks a mismatched delivery artifact', async t => {
  const directory = workspace(t);
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  const source = '{}';
  fs.writeFileSync(input, source);
  const finalized = await runFinalize({
    cliPath: '/fake/archify.mjs', type: 'architecture', input, output,
    runCommand: () => {
      const delivery = passingDelivery({ input, output, source });
      delivery.validation.warnings = 1;
      delivery.validation.compositionIssues = [{
        severity: 'warning', code: 'composition/viewport-height', detail: 'Reduce height.',
      }];
      delivery.artifact = artifactIdentity('another artifact');
      return result(delivery);
    },
  });
  assert.equal(finalized.exitCode, 1);
  assert.equal(finalized.summary.diagnostics[0].code, 'finalize/artifact-binding-mismatch');
});

test('showcase warning count without matching issue details still fails with a quality diagnostic', async t => {
  const directory = workspace(t);
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  const source = '{}';
  fs.writeFileSync(input, source);
  const calls = [];
  const finalized = await runFinalize({
    cliPath: '/fake/archify.mjs', type: 'workflow', input, output,
    runCommand: ({ stage }) => {
      calls.push(stage);
      const delivery = passingDelivery({ input, output, source, type: 'workflow' });
      delivery.validation.warnings = 1;
      delivery.validation.compositionIssues = [{ severity: 'warning', code: 'composition/viewport-height' }];
      return result(delivery);
    },
  });
  assert.equal(finalized.exitCode, 1);
  assert.deepEqual(calls, ['deliver']);
  assert.equal(finalized.summary.diagnostics[0].code, 'finalize/showcase-warnings');
  assert.equal(finalized.summary.diagnostics[0].evidence.warnings, 1);
});

test('public deliver and finalize CLI propagate a real workflow viewport warning', t => {
  const directory = workspace(t);
  const input = path.join(directory, 'warning.workflow.json');
  const output = path.join(directory, 'warning.html');
  const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
  fs.writeFileSync(input, `${JSON.stringify({
    schema_version: 1,
    diagram_type: 'workflow',
    meta: {
      title: 'Viewport warning fixture', output: 'warning.html',
      quality_profile: 'showcase', viewBox: [1080, 780], legend: { mode: 'hidden' },
    },
    lanes: [{ id: 'work', label: 'Work' }],
    nodes: [
      { id: 'start', lane: 'work', col: 0, type: 'frontend', label: 'Start' },
      { id: 'finish', lane: 'work', col: 2, type: 'backend', label: 'Finish' },
    ],
    edges: [{ id: 'flow', from: 'start', to: 'finish' }],
  }, null, 2)}\n`);
  const run = (command) => spawnSync(process.execPath, [
    cli, command, 'workflow', input, ...(command === 'validate' ? [] : [output]),
    '--quality', 'showcase', '--json',
  ], { encoding: 'utf8', timeout: 30000 });

  const validated = run('validate');
  assert.equal(validated.status, 0, validated.stderr || validated.stdout);
  const validation = JSON.parse(validated.stdout);
  assert.equal(validation.checks.length, 9);
  assert.equal(validation.checks.every((check) => check.ok), true);
  assert.deepEqual(validation.composition.summary, { errors: 0, warnings: 1 });

  const delivered = run('deliver');
  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  const delivery = JSON.parse(delivered.stdout);
  assert.equal(delivery.validation.checksPassed, 9);
  assert.equal(delivery.validation.errors, 0);
  assert.equal(delivery.validation.warnings, 1);
  assert.equal(delivery.validation.compositionIssues.length, 1);
  assert.equal(delivery.validation.compositionIssues[0].code, 'composition/viewport-height');

  const finalized = run('finalize');
  assert.equal(finalized.status, 1, finalized.stderr || finalized.stdout);
  const summary = JSON.parse(finalized.stdout);
  assert.equal(summary.failedStage, 'deliver');
  assert.equal(summary.gates.check, 'not-run');
  assert.equal(summary.diagnostics[0].code, 'composition/viewport-height');
  assert.equal(summary.diagnostics[0].evidence.overflowPx, validation.composition.issues[0].overflowPx);
  assert.match(summary.diagnostics[0].supportedFixes[0], /meta\.viewBox height/);
  assert.equal(JSON.parse(fs.readFileSync(summary.evidence.receipt)).diagnostics[0].code, 'composition/viewport-height');
});

test('finalize rejects an interleaved delivery whose check proves another artifact and receipt', async t => {
  const directory = workspace(t);
  const input = path.join(directory, 'a.json');
  const replacement = path.join(directory, 'b.json');
  const output = path.join(directory, 'diagram.html');
  const source = '{"meta":{"title":"A"}}';
  const replacementSource = '{"meta":{"title":"B"}}';
  fs.writeFileSync(input, source);
  fs.writeFileSync(replacement, replacementSource);
  const calls = [];

  const finalized = await runFinalize({
    cliPath: '/fake/archify.mjs',
    type: 'architecture',
    input,
    output,
    runCommand: ({ stage }) => {
      calls.push(stage);
      if (stage === 'deliver') return result(passingDelivery({
        input, output, source, artifact: '<!doctype html><title>A</title>', receiptId: '11111111-1111-4111-8111-111111111111',
      }));
      const deliveredB = passingDelivery({
        input: replacement,
        output,
        source: replacementSource,
        artifact: '<!doctype html><title>B</title>',
        receiptId: '22222222-2222-4222-8222-222222222222',
      });
      return result(passingCheck({
        output,
        artifact: deliveredB.artifact,
        deliveryReceiptId: deliveredB.receiptId,
      }));
    },
  });

  assert.equal(finalized.exitCode, 1);
  assert.deepEqual(calls, ['deliver', 'check']);
  assert.equal(finalized.receipt.failedStage, 'check');
  assert.equal(finalized.summary.diagnostics[0].code, 'finalize/artifact-binding-mismatch');
  assert.equal(finalized.summary.diagnostics[0].evidence.expectedDeliveryReceiptId, '11111111-1111-4111-8111-111111111111');
  assert.equal(finalized.summary.diagnostics[0].evidence.actualDeliveryReceiptId, '22222222-2222-4222-8222-222222222222');
});

test('finalize verifies the artifact and delivery sidecar after browser evidence completes', async t => {
  const directory = workspace(t);
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  const source = '{"meta":{"title":"stable"}}';
  fs.writeFileSync(input, source);
  let delivery;

  const finalized = await runFinalize({
    cliPath: '/fake/archify.mjs',
    type: 'architecture',
    input,
    output,
    runCommand: ({ stage }) => {
      if (stage === 'deliver') {
        delivery = passingDelivery({ input, output, source });
        return result(delivery);
      }
      if (stage === 'check') return result(passingCheck({
        output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId,
      }));
      const browser = passingBrowserCheck({
        output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId, outDir: directory,
      });
      fs.unlinkSync(output);
      return result(browser);
    },
  });

  assert.equal(finalized.exitCode, 1);
  assert.equal(finalized.receipt.failedStage, 'finalize');
  assert.equal(finalized.summary.diagnostics[0].code, 'finalize/final-artifact-mismatch');
  assert.deepEqual(finalized.receipt.artifact, { path: output });
});

test('a successful finalize receipt keeps the delivery identity after its final verification snapshot', async t => {
  const directory = workspace(t);
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  const source = '{"meta":{"title":"stable"}}';
  fs.writeFileSync(input, source);
  let delivery;
  let originalRead;
  let mutated = false;

  try {
    const finalized = await runFinalize({
      cliPath: '/fake/archify.mjs',
      type: 'architecture',
      input,
      output,
      runCommand: ({ stage }) => {
        if (stage === 'deliver') {
          delivery = passingDelivery({ input, output, source, artifact: '<!doctype html><title>A</title>' });
          return result(delivery);
        }
        if (stage === 'check') return result(passingCheck({
          output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId,
        }));
        const browser = passingBrowserCheck({
          output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId, outDir: directory,
        });
        originalRead = fs.readFileSync;
        fs.readFileSync = function interceptedRead(file, ...args) {
          const contents = originalRead.call(this, file, ...args);
          if (!mutated && path.resolve(file) === output) {
            mutated = true;
            fs.writeFileSync(output, '<!doctype html><title>B</title>');
          }
          return contents;
        };
        return result(browser);
      },
    });

    assert.equal(mutated, true);
    assert.equal(finalized.exitCode, 0);
    assert.equal(finalized.receipt.ok, true);
    assert.deepEqual(finalized.receipt.artifact, { path: output, ...delivery.artifact });
    assert.notDeepEqual(artifactIdentity(fs.readFileSync(output)), delivery.artifact);
  } finally {
    if (originalRead) fs.readFileSync = originalRead;
  }
});

test('finalize rejects a delivery sidecar replaced after the browser receipt', async t => {
  const directory = workspace(t);
  const input = path.join(directory, 'diagram.json');
  const replacement = path.join(directory, 'replacement.json');
  const output = path.join(directory, 'diagram.html');
  const source = '{"meta":{"title":"stable"}}';
  const replacementSource = '{"meta":{"title":"replacement"}}';
  fs.writeFileSync(input, source);
  fs.writeFileSync(replacement, replacementSource);
  let delivery;

  const finalized = await runFinalize({
    cliPath: '/fake/archify.mjs',
    type: 'architecture',
    input,
    output,
    runCommand: ({ stage }) => {
      if (stage === 'deliver') {
        delivery = passingDelivery({ input, output, source });
        return result(delivery);
      }
      if (stage === 'check') return result(passingCheck({
        output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId,
      }));
      const browser = passingBrowserCheck({
        output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId, outDir: directory,
      });
      const replacementDelivery = {
        ...delivery,
        receiptId: '22222222-2222-4222-8222-222222222222',
        input: replacement,
        specification: artifactIdentity(replacementSource),
      };
      writeCurrentDelivery(output, replacementDelivery);
      return result(browser);
    },
  });

  assert.equal(finalized.exitCode, 1);
  assert.equal(finalized.receipt.failedStage, 'finalize');
  assert.equal(finalized.summary.diagnostics[0].code, 'finalize/final-artifact-mismatch');
  assert.equal(finalized.summary.diagnostics[0].evidence.currentDeliveryReceiptId, '22222222-2222-4222-8222-222222222222');
});

test('finalize rejects a delivery type mismatch before checking a different diagram contract', async t => {
  const directory = workspace(t);
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  const source = '{"meta":{"title":"type"}}';
  fs.writeFileSync(input, source);
  const calls = [];

  const finalized = await runFinalize({
    cliPath: '/fake/archify.mjs',
    type: 'architecture',
    input,
    output,
    runCommand: ({ stage }) => {
      calls.push(stage);
      return result(passingDelivery({ input, output, source, type: 'workflow' }));
    },
  });

  assert.equal(finalized.exitCode, 1);
  assert.deepEqual(calls, ['deliver']);
  assert.equal(finalized.receipt.failedStage, 'deliver');
  assert.equal(finalized.summary.diagnostics[0].code, 'finalize/delivery-type-mismatch');
  assert.deepEqual(finalized.summary.diagnostics[0].evidence, {
    expectedType: 'architecture', actualType: 'workflow',
  });
});

test('finalize rejects a final delivery sidecar whose type no longer matches the requested diagram', async t => {
  const directory = workspace(t);
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  const source = '{"meta":{"title":"type-sidecar"}}';
  fs.writeFileSync(input, source);
  let delivery;

  const finalized = await runFinalize({
    cliPath: '/fake/archify.mjs',
    type: 'architecture',
    input,
    output,
    runCommand: ({ stage }) => {
      if (stage === 'deliver') {
        delivery = passingDelivery({ input, output, source });
        return result(delivery);
      }
      if (stage === 'check') return result(passingCheck({
        output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId,
      }));
      writeCurrentDelivery(output, { ...delivery, type: 'workflow' });
      return result(passingBrowserCheck({
        output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId, outDir: directory,
      }));
    },
  });

  assert.equal(finalized.exitCode, 1);
  assert.equal(finalized.receipt.failedStage, 'finalize');
  assert.equal(finalized.summary.diagnostics[0].code, 'finalize/final-artifact-mismatch');
  assert.equal(finalized.summary.diagnostics[0].evidence.currentType, 'workflow');
});

test('finalize rejects a showcase delivery whose count does not match the complete artifact checker', async t => {
  const directory = workspace(t);
  const input = path.join(directory, 'diagram.json');
  const output = path.join(directory, 'diagram.html');
  const source = '{"meta":{"title":"incomplete"}}';
  fs.writeFileSync(input, source);
  let delivery;

  const finalized = await runFinalize({
    cliPath: '/fake/archify.mjs',
    type: 'architecture',
    input,
    output,
    runCommand: ({ stage }) => {
      if (stage === 'deliver') {
        delivery = passingDelivery({ input, output, source });
        delivery.validation.checksPassed = 4;
        delivery.validation.checkCount = 4;
        return result(delivery);
      }
      return result(passingCheck({
        output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId, checkCount: 9,
      }));
    },
  });

  assert.equal(finalized.exitCode, 1);
  assert.equal(finalized.receipt.failedStage, 'check');
  assert.equal(finalized.summary.diagnostics[0].code, 'finalize/delivery-validation-mismatch');
  assert.deepEqual(finalized.summary.diagnostics[0].evidence, {
    deliveryCheckCount: 4, checkerCheckCount: 9,
  });
});

test('finalize requires the canonical check and browser artifact paths without inventing fallbacks', async t => {
  const cases = [
    {
      stage: 'check',
      receipt: ({ output, delivery }) => {
        const receipt = passingCheck({ output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId });
        delete receipt.file;
        return receipt;
      },
    },
    {
      stage: 'browser-check',
      receipt: ({ output, delivery, directory }) => {
        const receipt = passingBrowserCheck({
          output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId, outDir: directory,
        });
        delete receipt.artifact.path;
        return receipt;
      },
    },
  ];

  for (const scenario of cases) {
    const directory = workspace(t);
    const input = path.join(directory, 'diagram.json');
    const output = path.join(directory, 'diagram.html');
    const source = '{"meta":{"title":"path"}}';
    fs.writeFileSync(input, source);
    let delivery;
    const finalized = await runFinalize({
      cliPath: '/fake/archify.mjs',
      type: 'architecture',
      input,
      output,
      runCommand: ({ stage }) => {
        if (stage === 'deliver') {
          delivery = passingDelivery({ input, output, source });
          return result(delivery);
        }
        if (stage === 'check') {
          return result(scenario.stage === stage
            ? scenario.receipt({ output, delivery, directory })
            : passingCheck({ output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId }));
        }
        return result(scenario.receipt({ output, delivery, directory }));
      },
    });

    assert.equal(finalized.exitCode, 1, scenario.stage);
    assert.equal(finalized.receipt.failedStage, scenario.stage);
    assert.equal(finalized.summary.diagnostics[0].code, 'finalize/artifact-binding-mismatch');
  }
});

test('finalize requires complete passing browser evidence coverage', async t => {
  const cases = [
    {
      name: 'missing containment viewport',
      mutate: (receipt) => { receipt.containment.viewports.pop(); },
    },
    {
      name: 'null containment viewport before a valid matching entry',
      mutate: (receipt) => { receipt.containment.viewports = [null, ...receipt.containment.viewports.slice(0, -1)]; },
    },
    {
      name: 'failed readability child',
      mutate: (receipt) => { receipt.readability.viewports[0].readabilityOk = false; },
    },
    {
      name: 'non-light containment viewport',
      mutate: (receipt) => { receipt.containment.viewports[1].theme = 'dark'; },
    },
    {
      name: 'missing viewer chrome viewport',
      mutate: (receipt) => { receipt.viewerChrome.viewports = []; },
    },
    {
      name: 'incomplete theme coverage',
      mutate: (receipt) => { receipt.themeStates.viewports.pop(); },
    },
    {
      name: 'missing intermediate light-theme coverage',
      mutate: (receipt) => {
        receipt.themeStates.viewports = receipt.themeStates.viewports.filter(({ width }) => width !== 1600);
      },
    },
    {
      name: 'mismatched intermediate light theme despite passing parent status',
      mutate: (receipt) => {
        receipt.themeStates.viewports.find(({ width }) => width === 1920).resolvedTheme = 'dark';
      },
    },
  ];

  for (const scenario of cases) {
    const directory = workspace(t);
    const input = path.join(directory, 'diagram.json');
    const output = path.join(directory, 'diagram.html');
    const source = '{"meta":{"title":"browser"}}';
    fs.writeFileSync(input, source);
    let delivery;
    const finalized = await runFinalize({
      cliPath: '/fake/archify.mjs',
      type: 'architecture',
      input,
      output,
      runCommand: ({ stage }) => {
        if (stage === 'deliver') {
          delivery = passingDelivery({ input, output, source });
          return result(delivery);
        }
        if (stage === 'check') return result(passingCheck({
          output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId,
        }));
        const browser = passingBrowserCheck({
          output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId, outDir: directory,
        });
        scenario.mutate(browser);
        return result(browser);
      },
    });

    assert.equal(finalized.exitCode, 1, scenario.name);
    assert.equal(finalized.receipt.failedStage, 'browser-check', scenario.name);
    assert.equal(finalized.summary.diagnostics[0].code, 'finalize/invalid-stage-receipt', scenario.name);
  }
});

test('finalize rejects incomplete or mismatched successful protocol receipts', async t => {
  const cases = [
    {
      name: 'standard validation reported for a showcase delivery',
      stage: 'deliver',
      receipt: ({ input, output, source }) => {
        const receipt = passingDelivery({ input, output, source, quality: 'standard' });
        receipt.validation.checksPassed = 4;
        receipt.validation.checkCount = 4;
        return receipt;
      },
    },
    {
      name: 'empty artifact checker receipt',
      stage: 'check',
      receipt: () => ({ ok: true, artifact: {}, checks: [], provenance: 'current' }),
    },
    {
      name: 'artifact checker child failure',
      stage: 'check',
      receipt: ({ output, delivery }) => ({
        ...passingCheck({ output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId }),
        checks: [{ name: 'artifact', ok: false }],
      }),
    },
    {
      name: 'minimal browser receipt',
      stage: 'browser-check',
      receipt: () => ({ ok: true, command: 'browser-check', status: 'pass' }),
    },
  ];

  for (const scenario of cases) {
    const directory = workspace(t);
    const input = path.join(directory, 'diagram.json');
    const output = path.join(directory, 'diagram.html');
    const source = '{"meta":{"title":"protocol"}}';
    fs.writeFileSync(input, source);
    let delivery;
    const calls = [];
    const finalized = await runFinalize({
      cliPath: '/fake/archify.mjs',
      type: 'architecture',
      input,
      output,
      runCommand: ({ stage }) => {
        calls.push(stage);
        if (stage === 'deliver') {
          delivery = passingDelivery({ input, output, source });
          return result(scenario.stage === stage ? scenario.receipt({ input, output, source, delivery }) : delivery);
        }
        if (stage === 'check') {
          const receipt = scenario.stage === stage
            ? scenario.receipt({ input, output, source, delivery })
            : passingCheck({ output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId });
          return result(receipt);
        }
        return result(scenario.receipt({ input, output, source, delivery }));
      },
    });

    assert.equal(finalized.exitCode, 1, scenario.name);
    assert.equal(finalized.receipt.failedStage, scenario.stage, scenario.name);
    assert.deepEqual(calls, FINALIZE_STAGES.slice(1, FINALIZE_STAGES.indexOf(scenario.stage) + 1), scenario.name);
    assert.equal(finalized.summary.diagnostics[0].code, 'finalize/invalid-stage-receipt', scenario.name);
  }
});

test('finalize rechecks delivery barriers and the frozen candidate after the browser gate', async t => {
  for (const scenario of ['pending-delivery', 'changed-candidate']) {
    const directory = workspace(t);
    const input = path.join(directory, 'diagram.json');
    const output = path.join(directory, 'diagram.html');
    const source = '{}';
    fs.writeFileSync(input, source);
    let delivery;
    const finalized = await runFinalize({
      cliPath: '/fake/archify.mjs', type: 'architecture', input, output,
      ...(scenario === 'pending-delivery' ? { inspectDelivery: () => ({
        ok: false, status: 'pending', diagnostics: [{
          code: 'delivery/provenance-pending', severity: 'error', message: 'A new delivery is pending.',
        }],
      }) } : {}),
      runCommand: ({ stage }) => {
        if (stage === 'deliver') {
          delivery = passingDelivery({ input, output, source });
          return result(delivery);
        }
        if (stage === 'check') return result(passingCheck({ output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId }));
        if (scenario === 'changed-candidate') fs.writeFileSync(input, '{"changed":true}');
        return result(passingBrowserCheck({ output, artifact: delivery.artifact, deliveryReceiptId: delivery.receiptId, outDir: directory }));
      },
    });
    assert.equal(finalized.exitCode, 1, scenario);
    assert.equal(finalized.summary.failedStage, 'finalize');
    assert.equal(finalized.summary.ok, false);
    assert.equal(finalized.summary.diagnostics[0].code, scenario === 'pending-delivery' ? 'delivery/provenance-pending' : 'finalize/candidate-changed');
  }
});

test('default finalize JSON preserves complete verified workflow repairs', t => {
  const directory = workspace(t);
  const input = path.join(directory, 'shared-endpoint.json');
  const output = path.join(directory, 'shared-endpoint.html');
  const receipt = path.join(directory, 'receipt.json');
  const cli = fileURLToPath(new URL('../archify/bin/archify.mjs', import.meta.url));
  const source = {
    schema_version: 2,
    diagram_type: 'workflow',
    meta: { title: 'Shared missing endpoint', output: 'shared-endpoint.html', legend: { mode: 'hidden' } },
    lanes: [{ id: 'main', label: 'M' }],
    nodes: ['a', 'b', 'c'].map((id, col) => ({ id, lane: 'main', col, type: 'backend', label: id.toUpperCase() })),
    edges: [{ id: 'ab', from: 'a', to: 'ghost' }, { id: 'bc', from: 'ghost', to: 'c' }],
    mainPath: ['a', 'ghost', 'c'],
  };
  fs.writeFileSync(input, JSON.stringify(source));
  const finalized = spawnSync(process.execPath, [
    cli, 'finalize', 'workflow', input, output, '--quality', 'standard', '--json', '--receipt', receipt,
  ], { encoding: 'utf8', timeout: 30000 });
  assert.equal(finalized.status, 1, finalized.stderr || finalized.stdout);
  const summary = JSON.parse(finalized.stdout);
  const full = JSON.parse(fs.readFileSync(receipt, 'utf8'));
  const diagnostic = summary.diagnostics.find(entry => entry.code === 'workflow/unknown-edge-endpoint');
  assert.ok(diagnostic);
  assert.deepEqual(diagnostic.supportedFixes,
    full.diagnostics.find(entry => entry.code === diagnostic.code).supportedFixes);
  const candidates = new Map();
  for (const fix of diagnostic.supportedFixes) {
    const match = /^set (\/\S+) to verified node id "([^"]+)"$/.exec(fix);
    assert.ok(match, `Expected an executable verified repoint: ${fix}`);
    const [, pointer, candidate] = match;
    if (!candidates.has(candidate)) candidates.set(candidate, []);
    candidates.get(candidate).push(pointer);
  }
  assert.ok(candidates.size > 0);
  for (const [candidate, pointers] of candidates) {
    assert.deepEqual([...pointers].sort(), ['/edges/0/to', '/edges/1/from', '/mainPath/1']);
    const repaired = structuredClone(source);
    for (const pointer of pointers) {
      const segments = pointer.slice(1).split('/');
      const key = segments.pop();
      const parent = segments.reduce((value, segment) => value[segment], repaired);
      parent[key] = candidate;
    }
    fs.writeFileSync(input, JSON.stringify(repaired));
    const validated = spawnSync(process.execPath, [
      cli, 'validate', 'workflow', input, '--quality', 'standard', '--json',
    ], { encoding: 'utf8', timeout: 30000 });
    assert.equal(validated.status, 0, validated.stderr || validated.stdout);
    assert.equal(JSON.parse(validated.stdout).ok, true);
  }
});

test('runFinalize reads the capture limit from the supplied env, not process.env', { timeout: 180000 }, async (t) => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const skillRoot = path.join(here, '..', 'archify');
  const cliPath = path.join(skillRoot, 'bin', 'archify.mjs');
  const directory = workspace(t);
  const input = path.join(directory, 'env-capture.architecture.json');
  fs.writeFileSync(input, JSON.stringify(bipartiteArchitectureSpec(10)));
  const output = path.join(directory, 'env-capture.html');
  const missingChrome = path.join(directory, 'missing-chrome');

  // The parent process sees a 5 MiB knob while the supplied env raises it
  // to 10 MiB. The dense check echo sits between the two knobs (6.1 MiB on
  // dev `9102a91`; it has drifted with dev-side warning volume before —
  // 8.8 MiB on `7d3594e`, 10.5 MiB at 11+11 on `baffbdd3`), so a runner
  // reading process.env overflows at the check gate while the child stages
  // (which inherit the supplied env) pass. The overflow probe below pins
  // the lower end of that window: if the echo ever drops under 5 MiB the
  // test fails loudly instead of passing without exercising the regression.
  // Restore, rather than clear, the variables this test overrides so a
  // preconfigured environment cannot be damaged for later tests.
  const previousCheckMaxBuffer = process.env.ARCHIFY_CHECK_MAX_BUFFER;
  const previousChrome = process.env.ARCHIFY_CHROME;
  process.env.ARCHIFY_CHECK_MAX_BUFFER = String(5 * 1024 * 1024);
  process.env.ARCHIFY_CHROME = missingChrome;
  t.after(() => {
    if (previousCheckMaxBuffer === undefined) delete process.env.ARCHIFY_CHECK_MAX_BUFFER;
    else process.env.ARCHIFY_CHECK_MAX_BUFFER = previousCheckMaxBuffer;
    if (previousChrome === undefined) delete process.env.ARCHIFY_CHROME;
    else process.env.ARCHIFY_CHROME = previousChrome;
  });

  const finalized = await runFinalize({
    cliPath,
    type: 'architecture',
    input,
    output,
    quality: 'standard',
    cwd: skillRoot,
    env: {
      ...process.env,
      ARCHIFY_CHECK_MAX_BUFFER: String(10 * 1024 * 1024),
      ARCHIFY_CHROME: missingChrome,
    },
  });

  assert.equal(finalized.exitCode, 2, JSON.stringify(finalized.summary?.gates || finalized.receipt?.failedStage));
  assert.equal(finalized.receipt.stages.check.status, 'pass');
  assert.equal(finalized.receipt.stages['browser-check'].status, 'skipped');
  assert.equal(finalized.receipt.stages.check.receipt.provenance, 'current');

  // Same fixture, supplied env pinned to the parent's 5 MiB: the check
  // echo must overflow there, proving the window the first run relied on.
  const overflowed = await runFinalize({
    cliPath,
    type: 'architecture',
    input,
    output,
    quality: 'standard',
    cwd: skillRoot,
    env: {
      ...process.env,
      ARCHIFY_CHECK_MAX_BUFFER: String(5 * 1024 * 1024),
      ARCHIFY_CHROME: missingChrome,
    },
  });

  assert.equal(overflowed.receipt.stages.validate.status, 'fail');
  assert.equal(overflowed.receipt.stages.validate.receipt.diagnostics[0].code, 'artifact/check-output-limit');
});

test('compact review and repair guidance follow the mode and the failing diagnostics', () => {
  const routeReview = { crossings: [{ left: { from: 'a', to: 'b' }, right: { from: 'c', to: 'd' } }], detours: [] };
  const lifecycle = compactFinalizeReceipt({ ok: true, type: 'lifecycle', stages: { check: { receipt: { composition: {
    metrics: { resolvedCrossovers: 1 }, routeReview,
  } } } } }).visualReviewRecommendation;
  assert.equal('hints' in lifecycle, false);
  assert.doesNotMatch(lifecycle.repair, /architecture-layout-repair/);

  const failure = (code) => compactFinalizeReceipt({
    ok: false, status: 'fail', failedStage: 'validate', type: 'architecture',
    diagnostics: [{ code, severity: 'error', message: code }],
  }).nextAction.constraint;
  assert.doesNotMatch(failure('composition/desktop-readability'), /architecture-layout-repair/);
  assert.match(failure('composition/proper-crossing'), /architecture-layout-repair/);
});
