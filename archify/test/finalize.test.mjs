import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

import {
  FINALIZE_STAGES,
  compactFinalizeReceipt,
  defaultFinalizeReceiptPath,
  defaultFinalizeSummaryPath,
  runFinalize,
} from '../bin/finalize.mjs';
import { CAPTURE_VIEWPORTS, VISUAL_CHECK_VIEWPORTS } from '../bin/visual-check.mjs';
import { fileURLToPath } from 'node:url';
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
    constraint: 'Preserve unaffected semantics and geometry; do not replace the whole candidate.',
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
  assert.deepEqual(compact.diagnosticSummary, { total: 20, shown: 8, truncated: true });
  assert.equal(compact.nextAction.action, 'edit-in-place');
  assert.equal('stages' in compact, false);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(receipt).length / 4);
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

test('runFinalize reads the capture limit from the supplied env, not process.env', { timeout: 180000 }, async (t) => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const cliPath = path.join(here, '..', 'bin', 'archify.mjs');
  const directory = workspace(t);
  const input = path.join(directory, 'env-capture.architecture.json');
  fs.writeFileSync(input, JSON.stringify(bipartiteArchitectureSpec(11)));
  const output = path.join(directory, 'env-capture.html');
  const missingChrome = path.join(directory, 'missing-chrome');

  // The parent process sees a 5 MiB knob while the supplied env raises it
  // to 10 MiB. The dense check echo (about 8.8 MiB) fits only the supplied
  // env's capture, so a runner reading process.env overflows at the check
  // gate while the child stages (which inherit the supplied env) pass.
  process.env.ARCHIFY_CHECK_MAX_BUFFER = String(5 * 1024 * 1024);
  process.env.ARCHIFY_CHROME = missingChrome;
  t.after(() => {
    delete process.env.ARCHIFY_CHECK_MAX_BUFFER;
    delete process.env.ARCHIFY_CHROME;
  });

  const finalized = await runFinalize({
    cliPath,
    type: 'architecture',
    input,
    output,
    quality: 'standard',
    cwd: path.join(here, '..'),
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
});
