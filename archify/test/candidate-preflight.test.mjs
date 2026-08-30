import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCandidatePreflightBatch } from '../authoring/candidate-preflight.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const preflightViewports = Object.freeze([
  Object.freeze({ width: 1440, height: 900 }),
  Object.freeze({ width: 1600, height: 1000 }),
  Object.freeze({ width: 1920, height: 1080 }),
  Object.freeze({ width: 2048, height: 1320 }),
]);

function preflightObservation({ width, height }) {
  return {
    width,
    height,
    theme: 'light',
    requestedTheme: 'light',
    resolvedTheme: 'light',
    detailLevel: 'read',
    motion: 'still',
    themeStateOk: true,
    detailStateOk: true,
    motionStateOk: true,
    stateOk: true,
    ok: true,
  };
}

function validPreflightReceipt(artifactPath, artifact) {
  const sha256 = createHash('sha256').update(artifact).digest('hex');
  const viewports = preflightViewports.map(preflightObservation);
  return {
    schemaVersion: 2,
    ok: true,
    command: 'visual-preflight',
    status: 'pass',
    automatedChecks: ['containment'],
    artifact: {
      path: artifactPath,
      bytes: artifact.byteLength,
      sha256,
      verification: {
        before: { bytes: artifact.byteLength, sha256 },
        after: { bytes: artifact.byteLength, sha256 },
        unchanged: true,
      },
    },
    state: {
      detail: 'read',
      motion: 'still',
      theme: 'light',
      status: 'pass',
      observations: viewports.map((entry) => ({
        width: entry.width,
        height: entry.height,
        requestedTheme: entry.requestedTheme,
        resolvedTheme: entry.resolvedTheme,
        detailLevel: entry.detailLevel,
        motion: entry.motion,
        ok: entry.stateOk,
      })),
    },
    containment: { status: 'pass', viewports },
    captures: { status: 'not-requested', screenshots: [], contactSheet: null },
    sidecars: { receipt: 'temporary.json' },
    diagnostics: [],
  };
}

class FakeSession {
  calls = [];

  constructor(mutateReceipt = null) {
    this.mutateReceipt = mutateReceipt;
  }

  async preflight({ artifactPath, finalArtifact }) {
    const artifact = fs.readFileSync(artifactPath);
    this.calls.push({ artifactPath, finalArtifact, html: artifact.toString('utf8') });
    const receipt = validPreflightReceipt(artifactPath, artifact);
    if (this.mutateReceipt) this.mutateReceipt(receipt);
    return {
      exitCode: 0,
      receipt,
    };
  }
}

class PostPreflightMutationSession {
  calls = [];

  async preflight({ artifactPath, finalArtifact }) {
    const artifact = fs.readFileSync(artifactPath);
    this.calls.push({ artifactPath, finalArtifact, html: artifact.toString('utf8') });
    const receipt = validPreflightReceipt(artifactPath, artifact);
    fs.writeFileSync(artifactPath, '<!doctype html><html><body>post-preflight-mutation</body></html>');
    return { exitCode: 0, receipt };
  }
}

class ThrowingSession {
  calls = [];

  async preflight({ artifactPath, finalArtifact }) {
    this.calls.push({ artifactPath, finalArtifact });
    throw new Error('injected browser failure');
  }
}

class CloseThrowingSession extends FakeSession {
  async close() {
    throw new Error('injected close failure');
  }
}

class PoisonedSession extends FakeSession {
  constructor() {
    super();
    this.poisoned = new Error('synthetic reset failure');
    this.closed = false;
  }

  async preflight({ artifactPath, finalArtifact }) {
    const artifact = fs.readFileSync(artifactPath);
    this.calls.push({ artifactPath, finalArtifact, html: artifact.toString('utf8') });
    const receipt = validPreflightReceipt(artifactPath, artifact);
    receipt.ok = false;
    receipt.status = 'fail';
    receipt.diagnostics = [{ code: 'viewer/visual-check-runtime', severity: 'error', message: this.poisoned.message }];
    return { exitCode: 1, receipt };
  }

  async close() {
    this.closed = true;
  }
}

class ClosableFakeSession extends FakeSession {
  async close() {}
}

class StaticResultSession {
  calls = [];

  constructor(result) {
    this.result = result;
  }

  async preflight({ artifactPath, finalArtifact }) {
    this.calls.push({ artifactPath, finalArtifact });
    return this.result;
  }
}

function mutationSkillRoot(t, { originalInput, replacement }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-candidate-mutation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'renderers', 'workflow'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'renderers', 'workflow', 'render-workflow.mjs'), `
    import fs from 'node:fs';
    const [, , input, output] = process.argv;
    fs.writeFileSync(${JSON.stringify(originalInput)}, ${JSON.stringify(replacement)});
    const candidate = JSON.parse(fs.readFileSync(input, 'utf8'));
    fs.writeFileSync(output, \`<!doctype html><html><body>\${candidate.marker}</body></html>\`);
  `);
  fs.writeFileSync(path.join(root, 'scripts', 'check-render-output.mjs'), `
    const checks = Array.from({ length: 9 }, (_, index) => ({ name: \`check-\${index + 1}\`, ok: true }));
    process.stdout.write(JSON.stringify({ ok: true, checks, composition: { issues: [] } }));
  `);
  return root;
}

function artifactMutationSkillRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-artifact-mutation-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'renderers', 'workflow'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(root, 'renderers', 'workflow', 'render-workflow.mjs'), `
    import fs from 'node:fs';
    const [, , input, output] = process.argv;
    const candidate = JSON.parse(fs.readFileSync(input, 'utf8'));
    fs.writeFileSync(output, \`<!doctype html><html><body>\${candidate.marker}</body></html>\`);
  `);
  fs.writeFileSync(path.join(root, 'scripts', 'check-render-output.mjs'), `
    import fs from 'node:fs';
    const artifact = process.argv[2];
    fs.writeFileSync(artifact, '<!doctype html><html><body>artifact-B</body></html>');
    const checks = Array.from({ length: 9 }, (_, index) => ({ name: \`check-\${index + 1}\`, ok: true }));
    process.stdout.write(JSON.stringify({ ok: true, checks, composition: { issues: [] } }));
  `);
  return root;
}

function localizeReaderFacing(source) {
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, entry] of Object.entries(value)) {
      if (['label', 'sublabel', 'tag', 'note', 'title', 'subtitle'].includes(key)
        && typeof entry === 'string') {
        value[key] = key === 'title' && value === source.meta ? 'Agent 工具调用工作流' : '中文说明';
      } else if (key === 'items' && Array.isArray(entry)) {
        entry.forEach((_item, index) => { entry[index] = '中文说明'; });
      } else {
        visit(entry);
      }
    }
  };
  visit(source);
  source.meta.locale = 'zh-CN';
}

test('candidate preflight enforces and reports the authored-language contract before browser work', async (t) => {
  const rejectedSession = new FakeSession();
  const missingRepairHistory = path.join(os.tmpdir(), `archify-missing-repair-history-${process.pid}-${Date.now()}.json`);
  t.after(() => fs.rmSync(missingRepairHistory, { force: true }));
  const rejected = await runCandidatePreflightBatch({
    skillRoot,
    session: rejectedSession,
    candidates: [{
      id: 'english-workflow',
      type: 'workflow',
      input: path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'),
      requiredLanguage: 'zh-CN',
      repairHistory: missingRepairHistory,
    }],
  });
  assert.equal(rejected.exitCode, 1);
  assert.equal(rejected.receipt.candidates[0].stage, 'language');
  assert.equal(rejected.receipt.candidates[0].diagnostics[0].code, 'content/authored-language');
  assert.equal(rejected.receipt.candidates[0].repairHistory.attemptCount, 1);
  assert.equal(JSON.parse(fs.readFileSync(missingRepairHistory, 'utf8')).attempts.length, 1);
  assert.equal(rejectedSession.calls.length, 0);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-candidate-language-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'chinese.workflow.json');
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'), 'utf8'));
  localizeReaderFacing(source);
  fs.writeFileSync(input, `${JSON.stringify(source, null, 2)}\n`);
  const acceptedSession = new FakeSession();
  const accepted = await runCandidatePreflightBatch({
    skillRoot,
    session: acceptedSession,
    candidates: [{ id: 'chinese-workflow', type: 'workflow', input, requiredLanguage: 'zh-CN' }],
  });
  assert.equal(accepted.exitCode, 0);
  assert.equal(accepted.receipt.candidates[0].authoredLanguage.required, 'zh-CN');
  assert.equal(accepted.receipt.candidates[0].authoredLanguage.violations, 0);
  assert.equal(acceptedSession.calls.length, 1);
});

test('candidate preflight reuses the candidate repair history in failure planning', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-candidate-history-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'candidate.json');
  const repairHistory = path.join(tmp, 'repair-history.json');
  fs.writeFileSync(input, `${JSON.stringify({ diagram_type: 'workflow', marker: 'artifact-A' })}\n`);
  fs.writeFileSync(repairHistory, `${JSON.stringify({
    schemaVersion: 1,
    type: 'workflow',
    input,
    attempts: [{ stage: 'check', diagnostics: [{ code: 'composition/previous' }] }],
  }, null, 2)}\n`);

  const result = await runCandidatePreflightBatch({
    skillRoot: artifactMutationSkillRoot(t),
    session: new FakeSession(),
    candidates: [{
      id: 'history',
      type: 'workflow',
      input,
      repairHistory,
      repairMode: 'structural-reflow',
    }],
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.candidates[0].repairHistory.loadedAttemptCount, 1);
  assert.equal(result.receipt.candidates[0].repairHistory.attemptCount, 2);
  assert.equal(result.receipt.candidates[0].repairPlan.progress.attempts.length, 2);
  const persisted = JSON.parse(fs.readFileSync(repairHistory, 'utf8'));
  assert.equal(persisted.attempts.length, 2);
  assert.equal(persisted.attempts[1].repairMode, 'structural-reflow');
});

test('candidate preflight appends malformed candidate failures to existing repair history', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-candidate-malformed-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'candidate.json');
  const repairHistory = path.join(tmp, 'repair-history.json');
  fs.writeFileSync(input, '{ malformed');
  fs.writeFileSync(repairHistory, `${JSON.stringify({
    schemaVersion: 1,
    type: 'workflow',
    input,
    attempts: [{ stage: 'check', repairMode: 'focused', diagnostics: [{ code: 'composition/previous' }] }],
  }, null, 2)}\n`);

  const result = await runCandidatePreflightBatch({
    skillRoot,
    session: new FakeSession(),
    candidates: [{
      id: 'malformed',
      type: 'workflow',
      input,
      repairHistory,
      repairMode: 'structural-reflow',
    }],
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.candidates[0].stage, 'input');
  assert.equal(result.receipt.candidates[0].repairHistory.loadedAttemptCount, 1);
  assert.equal(result.receipt.candidates[0].repairHistory.attemptCount, 2);
  const persisted = JSON.parse(fs.readFileSync(repairHistory, 'utf8'));
  assert.equal(persisted.attempts.length, 2);
  assert.equal(persisted.attempts[1].stage, 'input');
  assert.equal(persisted.attempts[1].repairMode, 'structural-reflow');
});

test('candidate preflight freezes the first-read specification before the source can be replaced', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-candidate-source-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'candidate.json');
  const firstRead = `${JSON.stringify({ marker: 'candidate-A' })}\n`;
  const replacement = `${JSON.stringify({ marker: 'candidate-B' })}\n`;
  fs.writeFileSync(input, firstRead);
  const session = new FakeSession();

  const result = await runCandidatePreflightBatch({
    skillRoot: mutationSkillRoot(t, { originalInput: input, replacement }),
    session,
    candidates: [{ id: 'mutable', type: 'workflow', input }],
  });

  assert.equal(result.exitCode, 0);
  const receipt = result.receipt.candidates[0];
  const expectedArtifact = '<!doctype html><html><body>candidate-A</body></html>';
  assert.equal(receipt.specification.sha256, createHash('sha256').update(firstRead).digest('hex'));
  assert.equal(receipt.artifact.sha256, createHash('sha256').update(expectedArtifact).digest('hex'));
  assert.equal(receipt.artifact.bytes, Buffer.byteLength(expectedArtifact));
  assert.equal(receipt.artifact.ephemeral, true);
  assert.equal(receipt.preflight.artifact.sha256, receipt.artifact.sha256);
  assert.match(session.calls[0].html, /candidate-A/);
  assert.doesNotMatch(session.calls[0].html, /candidate-B/);
  assert.equal(fs.readFileSync(input, 'utf8'), replacement, 'the test must actually replace the public source path');
});

test('candidate preflight fails closed when the checked artifact no longer matches the rendered digest', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-artifact-source-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'candidate.json');
  fs.writeFileSync(input, `${JSON.stringify({ marker: 'artifact-A' })}\n`);
  const session = new FakeSession();

  const result = await runCandidatePreflightBatch({
    skillRoot: artifactMutationSkillRoot(t),
    session,
    candidates: [{ id: 'mutable-artifact', type: 'workflow', input }],
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.candidates[0].ok, false);
  assert.equal(result.receipt.candidates[0].stage, 'check');
  assert.equal(result.receipt.candidates[0].diagnostics[0].code, 'artifact/changed');
  assert.equal(session.calls.length, 0, 'a changed artifact must never reach browser preflight');
});

test('candidate preflight fails closed and removes private state when the artifact changes after browser inspection', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-post-preflight-source-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const input = path.join(tmp, 'candidate.json');
  const firstRead = `${JSON.stringify({ marker: 'browser-artifact-A' })}\n`;
  const replacement = `${JSON.stringify({ marker: 'browser-artifact-B' })}\n`;
  fs.writeFileSync(input, firstRead);
  const session = new PostPreflightMutationSession();

  const result = await runCandidatePreflightBatch({
    skillRoot: mutationSkillRoot(t, { originalInput: input, replacement }),
    session,
    candidates: [{ id: 'browser-mutation', type: 'workflow', input }],
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.candidates[0].stage, 'preflight');
  assert.equal(result.receipt.candidates[0].diagnostics[0].code, 'artifact/changed');
  assert.equal(session.calls.length, 1);
  assert.equal(
    fs.existsSync(path.dirname(session.calls[0].artifactPath)),
    false,
    'failure must remove the artifact and frozen-candidate directory',
  );
});

test('candidate preflight removes frozen private state when browser preflight throws', async () => {
  const session = new ThrowingSession();
  await assert.rejects(
    runCandidatePreflightBatch({
      skillRoot,
      session,
      candidates: [{
        id: 'throwing-browser',
        type: 'workflow',
        input: path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'),
      }],
    }),
    /injected browser failure/,
  );

  assert.equal(session.calls.length, 1);
  assert.equal(
    fs.existsSync(path.dirname(session.calls[0].artifactPath)),
    false,
    'the finally boundary must remove both the artifact and candidate snapshot',
  );
});

test('candidate preflight removes frozen private state when its owned browser session cannot close', async () => {
  let ownedSession = null;
  await assert.rejects(
    runCandidatePreflightBatch({
      skillRoot,
      sessionFactory() {
        ownedSession = new CloseThrowingSession();
        return ownedSession;
      },
      candidates: [{
        id: 'close-failure',
        type: 'workflow',
        input: path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'),
      }],
    }),
    /injected close failure/,
  );

  assert.equal(ownedSession.calls.length, 1);
  assert.equal(
    fs.existsSync(path.dirname(ownedSession.calls[0].artifactPath)),
    false,
    'session-close failure must not bypass private snapshot cleanup',
  );
});

test('candidate preflight rejects exit-zero browser receipts that do not prove the v2 preflight contract', async (t) => {
  const cases = [
    {
      name: 'malformed receipt',
      mutate(receipt) { delete receipt.command; },
    },
    {
      name: 'legacy v1 receipt',
      mutate(receipt) { receipt.schemaVersion = 1; },
    },
    {
      name: 'missing measured state',
      mutate(receipt) { delete receipt.state; },
    },
    {
      name: 'unresolved measured state',
      mutate(receipt) { receipt.state.observations[0].detailLevel = 'overview'; },
    },
    {
      name: 'duplicate containment viewport',
      mutate(receipt) { receipt.containment.viewports[3] = { ...receipt.containment.viewports[0] }; },
    },
    {
      name: 'artifact identity mismatch',
      mutate(receipt) { receipt.artifact.sha256 = 'f'.repeat(64); },
    },
    {
      name: 'artifact unchanged proof missing',
      mutate(receipt) { receipt.artifact.verification.unchanged = false; },
    },
  ];

  for (const entry of cases) {
    await t.test(entry.name, async () => {
      const session = new FakeSession(entry.mutate);
      const result = await runCandidatePreflightBatch({
        skillRoot,
        session,
        candidates: [{
          id: `invalid-${entry.name.replaceAll(' ', '-')}`,
          type: 'workflow',
          input: path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'),
        }],
      });

      assert.equal(result.exitCode, 1);
      assert.equal(result.receipt.ok, false);
      assert.equal(result.receipt.candidates[0].ok, false);
      assert.equal(result.receipt.candidates[0].stage, 'preflight');
      assert.equal(result.receipt.candidates[0].diagnostics[0].code, 'preflight/receipt-invalid');
      assert.equal(session.calls.length, 1);
    });
  }
});

test('candidate preflight keeps missing browser receipts structured for zero and non-zero exits', async (t) => {
  for (const entry of [
    { name: 'exit zero null receipt', result: { exitCode: 0, receipt: null } },
    { name: 'exit one missing receipt', result: { exitCode: 1 } },
  ]) {
    await t.test(entry.name, async () => {
      const session = new StaticResultSession(entry.result);
      const result = await runCandidatePreflightBatch({
        skillRoot,
        session,
        candidates: [{
          id: entry.name.replaceAll(' ', '-'),
          type: 'workflow',
          input: path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'),
        }],
      });

      assert.equal(result.exitCode, 1);
      assert.equal(result.receipt.candidates[0].ok, false);
      assert.equal(result.receipt.candidates[0].stage, 'preflight');
      assert.equal(result.receipt.candidates[0].diagnostics[0].code, 'preflight/receipt-invalid');
      assert.equal(session.calls.length, 1);
    });
  }
});

test('candidate preflight renders and checks several candidates before reusing one browser session', async () => {
  const session = new FakeSession();
  const result = await runCandidatePreflightBatch({
    skillRoot,
    session,
    candidates: [
      {
        id: 'workflow',
        type: 'workflow',
        input: path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'),
      },
      {
        id: 'dataflow',
        type: 'dataflow',
        input: path.join(skillRoot, 'examples', 'product-analytics.dataflow.json'),
      },
    ],
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.receipt.ok, true);
  assert.equal(result.receipt.command, 'validate-batch');
  assert.deepEqual(result.receipt.session, {
    shared: true,
    candidates: 2,
    expectedBrowserResets: 1,
    browserRestarts: 0,
  });
  assert.equal(result.receipt.timing.source, 'validate-batch');
  assert.ok(result.receipt.timing.durationMs >= 0);
  assert.deepEqual(session.calls.map((call) => call.finalArtifact), [false, true]);
  assert.equal(result.receipt.candidates.length, 2);
  assert.equal(result.receipt.candidates.every((receipt) => receipt.checks.length === 9), true);
  assert.equal(result.receipt.candidates.every((receipt) => receipt.preflight.artifact.ephemeral === true), true);
  assert.equal(result.receipt.candidates.every((receipt) => (
    receipt.artifact.sha256 === receipt.preflight.artifact.sha256
      && receipt.artifact.bytes === receipt.preflight.artifact.bytes
  )), true);
  for (const receipt of result.receipt.candidates) {
    assert.equal(receipt.timing.source, 'candidate-preflight');
    assert.equal(
      receipt.timing.durationMs,
      Number((receipt.timing.inputMs + receipt.timing.renderMs + receipt.timing.checkMs + receipt.timing.preflightMs).toFixed(3)),
    );
  }
  assert.equal(session.calls.every((call) => !fs.existsSync(call.artifactPath)), true);
});

test('candidate preflight replaces an owned poisoned browser session so later candidates still run', async () => {
  const sessions = [new PoisonedSession(), new ClosableFakeSession()];
  const result = await runCandidatePreflightBatch({
    skillRoot,
    sessionFactory: () => sessions.shift(),
    candidates: [
      { id: 'workflow', type: 'workflow', input: path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json') },
      { id: 'sequence', type: 'sequence', input: path.join(skillRoot, 'examples', 'cache-miss-request.sequence.json') },
    ],
  });

  assert.equal(result.receipt.candidates[0].ok, false);
  assert.equal(result.receipt.candidates[1].ok, true);
  assert.equal(result.receipt.session.browserRestarts, 1);
});

test('candidate preflight keeps deterministic failures structured and does not skip valid peers', async () => {
  const session = new FakeSession();
  const result = await runCandidatePreflightBatch({
    skillRoot,
    session,
    candidates: [
      {
        id: 'broken',
        type: 'workflow',
        input: path.join(skillRoot, 'examples', 'missing.json'),
      },
      {
        id: 'valid',
        type: 'workflow',
        input: path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'),
      },
    ],
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.receipt.candidates[0].stage, 'input');
  assert.equal(result.receipt.candidates[0].repairPlan.qualityGuards.semanticDeletionAllowed, false);
  assert.equal(result.receipt.candidates[0].timing.renderMs, 0);
  assert.equal(result.receipt.candidates[1].ok, true);
  assert.equal(session.calls.length, 1);
});
