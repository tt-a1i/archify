import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { QUALITY_CONTRACT } from '../authoring/quality-contract.mjs';
import { runCandidatePreflightBatch } from '../authoring/candidate-preflight.mjs';
import { buildProjectIndex, createEvidenceLedger } from '../evidence/project-index.mjs';
import { runSuite, spawnCommandRunner } from '../orchestration/suite-runner.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const archifyCli = path.join(skillRoot, 'bin/archify.mjs');
const suiteCli = path.join(skillRoot, 'bin/run-suite.mjs');
const revision = '0123456789abcdef0123456789abcdef01234567';

function jsonResult(receipt, exitCode = 0) {
  return { exitCode, signal: null, stdout: JSON.stringify(receipt), stderr: '' };
}

function validationReceipt(type, input, ok = true) {
  const candidate = fs.readFileSync(input);
  const preflightViewports = [
    visualObservation(1440, 900),
    visualObservation(1600, 1000),
    visualObservation(1920, 1080),
    visualObservation(2048, 1320),
  ];
  return {
    schemaVersion: 1,
    ok,
    command: 'validate',
    type,
    input,
    specification: {
      type,
      bytes: candidate.byteLength,
      sha256: createHash('sha256').update(candidate).digest('hex'),
    },
    checks: QUALITY_CONTRACT.guards.deterministicCheckNames.map((name) => ({ name, ok })),
    composition: { profile: 'showcase', summary: { errors: ok ? 0 : 1, warnings: 0 } },
    ...(ok ? {
      preflight: {
        schemaVersion: 2,
        ok: true,
        status: 'pass',
        state: {
          detail: 'read',
          motion: 'still',
          status: 'pass',
          observations: preflightViewports.map(stateObservation),
        },
        containment: {
          status: 'pass',
          viewports: preflightViewports,
        },
      },
    } : {}),
  };
}

function visualObservation(width, height, theme = 'light') {
  return {
    width,
    height,
    theme,
    requestedTheme: theme,
    resolvedTheme: theme,
    detailLevel: 'read',
    motion: 'still',
    themeStateOk: true,
    detailStateOk: true,
    motionStateOk: true,
    stateOk: true,
    ok: true,
    readabilityOk: true,
    viewerChromeStageOk: true,
    viewerChromeOk: true,
  };
}

function stateObservation(observation) {
  return {
    width: observation.width,
    height: observation.height,
    requestedTheme: observation.requestedTheme,
    resolvedTheme: observation.resolvedTheme,
    detailLevel: observation.detailLevel,
    motion: observation.motion,
    ok: observation.stateOk,
  };
}

function validPreflightReceiptForSuite(artifactPath, artifact) {
  const identity = {
    path: artifactPath,
    bytes: artifact.byteLength,
    sha256: createHash('sha256').update(artifact).digest('hex'),
  };
  const viewports = QUALITY_CONTRACT.guards.desktopViewports.map(({ width, height }) => (
    visualObservation(width, height)
  ));
  return {
    schemaVersion: 2,
    command: 'visual-preflight',
    ok: true,
    status: 'pass',
    automatedChecks: ['containment'],
    artifact: {
      ...identity,
      verification: {
        unchanged: true,
        before: { bytes: identity.bytes, sha256: identity.sha256 },
        after: { bytes: identity.bytes, sha256: identity.sha256 },
      },
    },
    state: {
      status: 'pass',
      detail: 'read',
      motion: 'still',
      theme: 'light',
      observations: viewports.map(stateObservation),
    },
    containment: { status: 'pass', viewports },
    captures: { status: 'not-requested', screenshots: [], contactSheet: null },
    sidecars: { receipt: 'temporary.json' },
    diagnostics: [],
  };
}

function fakePng(width, height) {
  const png = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(png, 0);
  png.writeUInt32BE(13, 8);
  png.write('IHDR', 12, 'ascii');
  png.writeUInt32BE(width, 16);
  png.writeUInt32BE(height, 20);
  return png;
}

function fakeRunner({
  failDiagram = null,
  visualReceiptClaimsHumanPass = false,
  revisionValue = revision,
  capabilityStatus = 'pass',
  tamperValidationSpecification = false,
} = {}) {
  let activeTypedCommands = 0;
  let maximumConcurrency = 0;
  const activeByKind = new Map();
  const maximumByKind = new Map();
  const requests = [];
  const runner = async (request) => {
    requests.push(request);
    if (request.kind === 'repository-revision') {
      return { exitCode: 0, signal: null, stdout: `${revisionValue}\n`, stderr: '' };
    }
    if (request.kind === 'repository-status') {
      return { exitCode: 0, signal: null, stdout: '', stderr: '' };
    }
    if (request.kind === 'chrome-capability') {
      const ok = capabilityStatus === 'pass';
      const exitCode = ok ? 0 : capabilityStatus === 'unavailable' ? 2 : 1;
      return jsonResult({
        schemaVersion: 1,
        ok,
        command: 'visual-capability-probe',
        status: capabilityStatus,
        chrome: {
          status: ok ? 'available' : capabilityStatus,
          executable: ok ? '/fake/chrome' : null,
          sandbox: { status: 'enabled', automaticOptOut: false },
        },
        cdp: { status: ok ? 'available' : 'skipped' },
        ...(ok ? {} : { error: `Chrome capability ${capabilityStatus}` }),
      }, exitCode);
    }
    activeTypedCommands += 1;
    maximumConcurrency = Math.max(maximumConcurrency, activeTypedCommands);
    activeByKind.set(request.kind, (activeByKind.get(request.kind) || 0) + 1);
    maximumByKind.set(request.kind, Math.max(
      maximumByKind.get(request.kind) || 0,
      activeByKind.get(request.kind),
    ));
    await new Promise((resolve) => setTimeout(resolve, 3));
    try {
      if (request.kind === 'exec') {
        const candidatePath = request.args[0];
        fs.writeFileSync(candidatePath, JSON.stringify({
          schema_version: 1,
          diagram_type: request.env.ARCHIFY_SUITE_DIAGRAM_TYPE,
          meta: { title: 'Prepared candidate' },
        }));
        return jsonResult({ schemaVersion: 1, ok: true, command: 'prepare' });
      }
      if (request.kind === 'validate') {
        const type = request.args[2];
        const input = request.args[3];
        const shouldFail = request.env.ARCHIFY_SUITE_DIAGRAM_ID === failDiagram;
        const receipt = validationReceipt(type, input, !shouldFail);
        if (tamperValidationSpecification) receipt.specification.sha256 = '0'.repeat(64);
        const languageIndex = request.args.indexOf('--require-authored-language');
        if (languageIndex >= 0) {
          receipt.authoredLanguage = {
            required: request.args[languageIndex + 1],
            locale: request.args[languageIndex + 1],
            inspected: 1,
            proseInspected: 1,
            technicalIdentifiersPreserved: 0,
            violations: 0,
          };
        }
        return jsonResult(receipt, shouldFail ? 1 : 0);
      }
      if (request.kind === 'deliver') {
        const type = request.args[2];
        const input = request.args[3];
        const output = request.args[4];
        const specification = fs.readFileSync(input);
        const artifact = `<!doctype html><title>${type}</title>\n`;
        fs.writeFileSync(output, artifact);
        const receipt = {
          schemaVersion: 1,
          ok: true,
          command: 'deliver',
          type,
          input,
          output,
          specification: {
            bytes: specification.byteLength,
            sha256: createHash('sha256').update(specification).digest('hex'),
          },
          artifact: {
            bytes: Buffer.byteLength(artifact),
            sha256: createHash('sha256').update(artifact).digest('hex'),
          },
          validation: {
            checksPassed: 9,
            checkCount: 9,
            compositionProfile: 'showcase',
            errors: 0,
            warnings: 0,
          },
        };
        const languageIndex = request.args.indexOf('--require-authored-language');
        if (languageIndex >= 0) {
          receipt.authoredLanguage = {
            required: request.args[languageIndex + 1],
            locale: request.args[languageIndex + 1],
            inspected: 1,
            proseInspected: 1,
            technicalIdentifiersPreserved: 0,
            violations: 0,
          };
        }
        return jsonResult(receipt);
      }
      if (request.kind === 'visual-check-batch') {
        const artifactPaths = request.args.slice(2, -1);
        const artifacts = artifactPaths.map((artifactPath) => {
          const artifact = fs.readFileSync(artifactPath);
          const containmentViewports = [
            visualObservation(1440, 900),
            visualObservation(1600, 1000),
            visualObservation(1920, 1080),
            visualObservation(2048, 1320),
          ];
          const screenshotDimensions = [[1440, 900], [2048, 1320]];
          const screenshots = screenshotDimensions.flatMap(([width, height]) => ['light', 'dark'].map((theme) => {
            const file = `${path.basename(artifactPath, path.extname(artifactPath))}.visual-check.${width}x${height}.${theme}.png`;
            const screenshotBytes = fakePng(width, height);
            fs.writeFileSync(path.join(path.dirname(artifactPath), file), screenshotBytes);
            return {
              ...visualObservation(width, height, theme),
              sha256: createHash('sha256').update(screenshotBytes).digest('hex'),
              bytes: screenshotBytes.byteLength,
              pixelWidth: width,
              pixelHeight: height,
              file,
            };
          }));
          const stateObservations = [
            ...containmentViewports,
            ...screenshots.filter((screenshot) => screenshot.theme === 'dark'),
          ].map(stateObservation);
          return {
            schemaVersion: 2,
            ok: true,
            command: 'visual-check',
            status: 'pass',
            visualReview: visualReceiptClaimsHumanPass ? 'passed' : 'pending',
            artifact: {
              path: artifactPath,
              bytes: artifact.byteLength,
              sha256: createHash('sha256').update(artifact).digest('hex'),
              verification: {
                before: {
                  bytes: artifact.byteLength,
                  sha256: createHash('sha256').update(artifact).digest('hex'),
                },
                after: {
                  bytes: artifact.byteLength,
                  sha256: createHash('sha256').update(artifact).digest('hex'),
                },
                unchanged: true,
              },
            },
            state: {
              detail: 'read',
              motion: 'still',
              status: 'pass',
              observations: stateObservations,
            },
            containment: {
              status: 'pass',
              viewports: containmentViewports,
            },
            readability: { status: 'pass', minimumProjectedNodeTextPx: 6, viewports: containmentViewports },
            viewerChrome: { status: 'pass', viewports: containmentViewports },
            captures: { status: 'pass', screenshots },
          };
        });
        return jsonResult({
          schemaVersion: 2,
          ok: true,
          command: 'visual-check-batch',
          status: 'pass',
          artifacts,
        });
      }
      throw new Error(`Unexpected command kind ${request.kind}`);
    } finally {
      activeTypedCommands -= 1;
      activeByKind.set(request.kind, activeByKind.get(request.kind) - 1);
    }
  };
  runner.requests = requests;
  runner.maximumConcurrency = () => maximumConcurrency;
  runner.maximumConcurrencyFor = (kind) => maximumByKind.get(kind) || 0;
  return runner;
}

function writeManifest(tmp, diagrams, options = {}) {
  const manifestPath = path.join(tmp, 'suite.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    id: 'pi-five-diagrams',
    qualityProfile: 'showcase',
    authoredLanguage: 'en',
    ...options,
    diagrams,
  }, null, 2));
  return manifestPath;
}

function sharedCandidatePreflightRunner(calls = []) {
  return async ({ candidates, quality }) => {
    calls.push({ candidates, quality });
    return {
      exitCode: 0,
      receipt: {
        schemaVersion: 1,
        ok: true,
        command: 'validate-batch',
        status: 'pass',
        quality,
        session: { shared: true, candidates: candidates.length, expectedBrowserResets: candidates.length - 1 },
        candidates: candidates.map((candidate) => {
          const bytes = fs.readFileSync(candidate.input);
          const artifact = Buffer.from(`<!doctype html><title>${candidate.type}</title>\n`);
          return {
            ...validationReceipt(candidate.type, candidate.input),
            id: candidate.id,
            authoredLanguage: {
              required: candidate.requiredLanguage,
              locale: candidate.requiredLanguage,
              inspected: 1,
              proseInspected: 1,
              technicalIdentifiersPreserved: 0,
              violations: 0,
            },
            specification: {
              bytes: bytes.byteLength,
              sha256: createHash('sha256').update(bytes).digest('hex'),
            },
            artifact: {
              bytes: artifact.byteLength,
              sha256: createHash('sha256').update(artifact).digest('hex'),
              ephemeral: true,
            },
          };
        }),
      },
    };
  };
}

function staticCandidate(tmp, type) {
  const candidate = path.join(tmp, `${type}.json`);
  fs.writeFileSync(candidate, JSON.stringify({
    schema_version: 1,
    diagram_type: type,
    meta: { title: `${type} candidate` },
  }));
  return path.basename(candidate);
}

function qualityCommands() {
  return [
    { id: 'validate', kind: 'validate' },
    { id: 'deliver', kind: 'deliver' },
    { id: 'visual', kind: 'visual-check' },
  ];
}

test('suite runner CLI: documents explicit repository, revision, output, and no-model contract', () => {
  const result = spawnSync(process.execPath, [suiteCli, '--help'], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--repo-root <checkout>/);
  assert.match(result.stdout, /--revision <full-commit-id>/);
  assert.match(result.stdout, /--output <directory>/);
  assert.match(result.stdout, /does not call a model/);
  assert.match(result.stdout, /sharedViewportPreflight/);
  assert.match(result.stdout, /manifest\.projectIndex/);
});

test('suite runner CLI: every JSON failure carries actionable diagnostics', () => {
  const result = spawnSync(process.execPath, [suiteCli, '--unknown', '--json'], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.command, 'run-suite');
  assert.equal(receipt.diagnostics.length, 1);
  assert.equal(receipt.diagnostics[0].code, 'run-suite/failed');
  assert.equal(receipt.diagnostics[0].severity, 'error');
  assert.ok(receipt.diagnostics[0].supportedFixes.length > 0);
});

test('production command runner reports child-process time without agent marker gaps', async () => {
  const result = await spawnCommandRunner({
    executable: process.execPath,
    args: ['-e', 'process.stdout.write("ok")'],
    cwd: skillRoot,
    env: {},
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'ok');
  assert.equal(result.timing.source, 'child-process');
  assert.ok(result.timing.durationMs >= 0);
  assert.match(result.timing.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(result.timing.endedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('production command runner times out and terminates a hung process tree', async () => {
  await assert.rejects(spawnCommandRunner({
    id: 'hung-command',
    executable: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'],
    cwd: skillRoot,
    env: {},
    timeoutMs: 40,
  }), (error) => {
    assert.equal(error.code, 'ARCHIFY_COMMAND_TIMEOUT');
    assert.match(error.message, /hung-command timed out after 40ms/);
    return true;
  });
});

test('suite runner rejects tracked and untracked repository drift before creating output', async (t) => {
  for (const drift of ['tracked', 'untracked']) {
    await t.test(drift, async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `archify-suite-dirty-${drift}-`));
      t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
      const repoRoot = path.join(tmp, 'repo');
      fs.mkdirSync(repoRoot);
      execFileSync('git', ['init', '-q'], { cwd: repoRoot });
      execFileSync('git', ['config', 'user.email', 'archify@example.test'], { cwd: repoRoot });
      execFileSync('git', ['config', 'user.name', 'Archify Test'], { cwd: repoRoot });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), 'fixture\n');
      execFileSync('git', ['add', 'README.md'], { cwd: repoRoot });
      execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repoRoot });
      const pinned = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
      if (drift === 'tracked') fs.writeFileSync(path.join(repoRoot, 'README.md'), 'changed\n');
      else fs.writeFileSync(path.join(repoRoot, 'untracked.txt'), 'untracked\n');
      const manifestPath = writeManifest(tmp, [{
        type: 'workflow',
        candidate: staticCandidate(tmp, 'workflow'),
        commands: qualityCommands(),
      }]);
      const outputRoot = path.join(tmp, 'output');
      const repositoryOnlyRunner = async (request) => {
        if (!request.kind.startsWith('repository-')) throw new Error(`unexpected ${request.kind}`);
        return spawnCommandRunner(request);
      };

      await assert.rejects(runSuite({
        manifestPath,
        repoRoot,
        revision: pinned,
        outputRoot,
        archifyCli,
        commandRunner: repositoryOnlyRunner,
      }), /repository worktree is not clean/i);
      assert.equal(fs.existsSync(outputRoot), false, 'dirty input must fail before suite output is created');
    });
  }
});

test('suite runner fails the final receipt when a generator dirties tracked or untracked repository state', async (t) => {
  for (const drift of ['tracked', 'untracked']) {
    await t.test(drift, async () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `archify-suite-generator-drift-${drift}-`));
      t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
      const repoRoot = path.join(tmp, 'repo');
      fs.mkdirSync(repoRoot);
      execFileSync('git', ['init', '-q'], { cwd: repoRoot });
      execFileSync('git', ['config', 'user.email', 'archify@example.test'], { cwd: repoRoot });
      execFileSync('git', ['config', 'user.name', 'Archify Test'], { cwd: repoRoot });
      fs.writeFileSync(path.join(repoRoot, 'README.md'), 'fixture\n');
      execFileSync('git', ['add', 'README.md'], { cwd: repoRoot });
      execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repoRoot });
      const pinned = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
      const outputRoot = path.join(tmp, 'output');
      const manifestPath = writeManifest(tmp, [{
        type: 'workflow',
        candidate: '{diagramOutput}/candidate.json',
        commands: [
          { id: 'prepare', kind: 'exec', argv: ['prepare-candidate', '{candidate}'], receipt: 'json' },
          ...qualityCommands(),
        ],
      }]);
      const typedRunner = fakeRunner({ revisionValue: pinned });
      const commandRunner = async (request) => {
        if (request.kind.startsWith('repository-')) return spawnCommandRunner(request);
        const result = await typedRunner(request);
        if (request.kind === 'exec') {
          const target = drift === 'tracked' ? 'README.md' : 'generated-untracked.txt';
          fs.writeFileSync(path.join(repoRoot, target), `${drift} drift\n`);
        }
        return result;
      };

      const summary = await runSuite({
        manifestPath,
        repoRoot,
        revision: pinned,
        outputRoot,
        archifyCli,
        commandRunner,
      });

      assert.equal(summary.status, 'automated-failure');
      assert.match(summary.finalReceipt.error.message, /repository worktree is not clean/i);
    });
  }
});

test('suite runner integration: real packaged validate and deliver CLIs complete the trusted chain', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-real-cli-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  execFileSync('git', ['init', '-q'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.email', 'archify@example.test'], { cwd: repoRoot });
  execFileSync('git', ['config', 'user.name', 'Archify Test'], { cwd: repoRoot });
  fs.writeFileSync(path.join(repoRoot, 'README.md'), 'fixture\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repoRoot });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repoRoot });
  const pinned = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const candidate = path.join(tmp, 'workflow.json');
  fs.copyFileSync(path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'), candidate);
  const candidateDocument = JSON.parse(fs.readFileSync(candidate, 'utf8'));
  candidateDocument.meta.locale = 'en';
  fs.writeFileSync(candidate, `${JSON.stringify(candidateDocument, null, 2)}\n`);
  const manifestPath = writeManifest(tmp, [{ type: 'workflow', candidate, commands: qualityCommands() }], {
    sharedViewportPreflight: true,
  });
  const browserRunner = fakeRunner({ revisionValue: pinned });
  const commandRunner = (request) => (
    ['chrome-capability', 'visual-check-batch'].includes(request.kind)
      ? browserRunner(request)
      : spawnCommandRunner(request)
  );
  const session = {
    async preflight({ artifactPath }) {
      const artifact = fs.readFileSync(artifactPath);
      return { exitCode: 0, receipt: validPreflightReceiptForSuite(artifactPath, artifact) };
    },
  };

  const summary = await runSuite({
    manifestPath,
    repoRoot,
    revision: pinned,
    outputRoot: path.join(tmp, 'output'),
    archifyCli,
    commandRunner,
    candidatePreflightRunner: (request) => runCandidatePreflightBatch({ ...request, session }),
  });

  assert.equal(summary.status, 'automated-pass-awaiting-human-review');
  const timing = JSON.parse(fs.readFileSync(summary.diagrams[0].timing, 'utf8'));
  assert.deepEqual(timing.finalReceipt.commands.slice(0, 2).map((entry) => entry.kind), ['validate', 'deliver']);
  assert.equal(timing.finalReceipt.commands[0].receipt.ok, true);
  assert.equal(timing.finalReceipt.commands[1].receipt.ok, true);
});

test('suite runner: pins the repository once, isolates diagrams, and generates timing/report receipts', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  const outputRoot = path.join(tmp, 'output');
  fs.mkdirSync(repoRoot);
  const workflowCandidate = staticCandidate(tmp, 'workflow');
  const manifestPath = writeManifest(tmp, [
    {
      id: 'workflow',
      type: 'workflow',
      candidate: workflowCandidate,
      artifact: 'workflow.html',
      commands: qualityCommands(),
    },
    {
      id: 'sequence',
      type: 'sequence',
      candidate: '{diagramOutput}/candidate.json',
      artifact: 'sequence.html',
      commands: [
        { id: 'prepare', kind: 'exec', argv: ['prepare-candidate', '{candidate}'], receipt: 'json' },
        ...qualityCommands(),
      ],
    },
  ]);
  const commandRunner = fakeRunner({ visualReceiptClaimsHumanPass: true });

  const summary = await runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot,
    archifyCli,
    concurrency: 2,
    commandRunner,
  });

  assert.equal(summary.status, 'automated-pass-awaiting-human-review');
  assert.deepEqual(summary.diagrams.map((diagram) => diagram.status), ['completed', 'completed']);
  assert.equal(commandRunner.requests.filter((request) => request.kind === 'repository-revision').length, 2);
  assert.equal(commandRunner.requests.filter((request) => request.kind === 'repository-status').length, 2);
  assert.equal(
    commandRunner.requests.find((request) => request.kind === 'exec').cwd,
    path.join(outputRoot, 'sequence'),
    'exec commands default to the isolated diagram directory',
  );
  assert.equal(commandRunner.requests.filter((request) => request.kind === 'chrome-capability').length, 1);
  assert.equal(Object.hasOwn(commandRunner.requests.find((request) => request.kind === 'chrome-capability').env, 'ARCHIFY_CHROME_NO_SANDBOX'), false);
  assert.equal(commandRunner.requests.filter((request) => request.kind === 'validate').every((request) => request.args.includes('--preflight')), true);
  const visualBatchRequests = commandRunner.requests.filter((request) => request.kind === 'visual-check-batch');
  assert.equal(visualBatchRequests.length, 1);
  assert.equal(commandRunner.requests.filter((request) => request.kind === 'visual-check').length, 0);
  assert.ok(commandRunner.maximumConcurrency() >= 2, 'diagram command execution should overlap at concurrency 2');
  assert.equal(commandRunner.maximumConcurrencyFor('validate'), 1, 'Chrome-backed validate preflights must be serialized');
  for (const diagram of summary.diagrams) {
    assert.ok(visualBatchRequests[0].args.includes(diagram.artifact));
    assert.equal(path.dirname(diagram.timing), path.join(outputRoot, diagram.id));
    assert.equal(path.dirname(diagram.events), path.join(outputRoot, diagram.id));
    assert.equal(path.dirname(diagram.artifact), path.join(outputRoot, diagram.id));
    const timing = JSON.parse(fs.readFileSync(diagram.timing, 'utf8'));
    assert.equal(timing.kind, 'archify.run-timing');
    assert.equal(timing.run.repository.revision, revision);
    assert.equal(timing.stages.at(-1).name, 'visual');
    assert.equal(timing.stages.at(-1).metadata.sharedBatch, true);
    assert.equal(timing.stages.at(-1).metadata.sharedBatchDurationMs, summary.visualCheckBatch.durationMs);
    for (let index = 1; index < timing.stages.length; index += 1) {
      assert.ok(timing.stages[index - 1].endOffsetMs <= timing.stages[index].startOffsetMs);
    }
    assert.equal(timing.finalReceipt.commands.at(-1).kind, 'visual-check');
    const review = JSON.parse(fs.readFileSync(diagram.visualReview, 'utf8'));
    assert.equal(review.status, 'pending', 'browser receipt must not promote human visual review');
    const visualReceipt = timing.finalReceipt.commands.at(-1).receipt;
    assert.deepEqual(review.artifact, {
      path: diagram.artifact,
      sha256: visualReceipt.artifact.sha256,
      bytes: visualReceipt.artifact.bytes,
    });
    assert.equal(review.screenshots.length, 4);
    assert.equal(review.screenshots.every((screenshot) => (
      typeof screenshot.sha256 === 'string'
      && screenshot.bytes > 0
      && screenshot.pixelWidth === screenshot.width
      && screenshot.pixelHeight === screenshot.height
    )), true);
  }

  const report = fs.readFileSync(summary.report, 'utf8');
  assert.match(report, /automated-pass-awaiting-human-review/);
  assert.match(report, /Chrome capability gate: `pass`/);
  assert.match(report, /pass \(4\/4 viewports\)/);
  assert.match(report, /pending \(human required\)/);
  assert.match(report, /runner never promotes it to `passed`/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(outputRoot, 'suite-result.json'), 'utf8')).status, summary.status);
  const suiteTiming = JSON.parse(fs.readFileSync(summary.timing, 'utf8'));
  assert.equal(suiteTiming.stages[0].name, 'chromeCapability');
  assert.equal(suiteTiming.stages.filter((stage) => stage.name === 'visualCheckBatch').length, 1);
  assert.equal(suiteTiming.stages.find((stage) => stage.name === 'visualCheckBatch').status, 'passed');
  assert.equal(suiteTiming.finalReceipt.chromeCapability.receipt.status, 'pass');
  assert.equal(suiteTiming.finalReceipt.visualCheckBatch.artifacts.length, 2);
  const activeDiagramMs = summary.diagrams.reduce((sum, diagram) => {
    const timing = JSON.parse(fs.readFileSync(diagram.timing, 'utf8'));
    return sum + timing.stages.reduce(
      (stageSum, stage) => stageSum + (stage.metadata.sharedBatch ? 0 : stage.durationMs),
      0,
    );
  }, 0);
  assert.deepEqual(summary.accounting, {
    activeDiagramMs,
    sharedVisualCheckMs: summary.visualCheckBatch.durationMs,
    aggregateWorkMs: activeDiagramMs + summary.visualCheckBatch.durationMs,
    sharedVisualCountedOnce: true,
  });
  assert.deepEqual(suiteTiming.finalReceipt.accounting, summary.accounting);
  assert.match(report, /shared final visual-check once/);
});

test('suite runner: propagates and verifies one authored-language contract across validate and deliver', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-language-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  const commandRunner = fakeRunner();
  const manifestPath = writeManifest(tmp, [{
    id: 'workflow',
    type: 'workflow',
    candidate: staticCandidate(tmp, 'workflow'),
    commands: qualityCommands(),
  }], { authoredLanguage: 'zh-CN' });

  const summary = await runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot: path.join(tmp, 'output'),
    archifyCli,
    commandRunner,
  });

  assert.equal(summary.finalReceipt.quality.authoredLanguage, 'zh-CN');
  assert.equal(summary.authoredLanguage, 'zh-CN');
  const diagramTiming = JSON.parse(fs.readFileSync(summary.diagrams[0].timing, 'utf8'));
  assert.equal(diagramTiming.finalReceipt.quality.authoredLanguage, 'zh-CN');
  for (const request of commandRunner.requests.filter((entry) => ['validate', 'deliver'].includes(entry.kind))) {
    assert.deepEqual(request.args.slice(-3), ['--require-authored-language', 'zh-CN', '--json']);
  }
});

test('suite runner: showcase manifests fail closed without one authored language', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-language-required-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  const manifestPath = writeManifest(tmp, [{
    id: 'workflow',
    type: 'workflow',
    candidate: staticCandidate(tmp, 'workflow'),
    commands: qualityCommands(),
  }], { authoredLanguage: undefined });

  await assert.rejects(runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot: path.join(tmp, 'output'),
    archifyCli,
    commandRunner: fakeRunner(),
  }), /authoredLanguage is required and must be "en" or "zh-CN"/);
});

test('suite runner: frozen candidates share one pre-delivery browser session', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-shared-preflight-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  const outputRoot = path.join(tmp, 'output');
  fs.mkdirSync(repoRoot);
  const manifestPath = writeManifest(tmp, [
    { id: 'workflow', type: 'workflow', candidate: staticCandidate(tmp, 'workflow'), commands: qualityCommands() },
    { id: 'sequence', type: 'sequence', candidate: staticCandidate(tmp, 'sequence'), commands: qualityCommands() },
  ], { sharedViewportPreflight: true });
  const commandRunner = fakeRunner();
  const preflightCalls = [];

  const summary = await runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot,
    archifyCli,
    concurrency: 2,
    commandRunner,
    candidatePreflightRunner: sharedCandidatePreflightRunner(preflightCalls),
  });

  assert.equal(summary.status, 'automated-pass-awaiting-human-review');
  assert.equal(summary.sharedViewportPreflight, true);
  assert.equal(preflightCalls.length, 1);
  assert.equal(preflightCalls[0].candidates.length, 2);
  assert.equal(preflightCalls[0].candidates.every((candidate) => candidate.requiredLanguage === 'en'), true);
  assert.equal(commandRunner.requests.filter((request) => request.kind === 'validate').every((request) => !request.args.includes('--preflight')), true);
  const timing = JSON.parse(fs.readFileSync(summary.timing, 'utf8'));
  assert.equal(timing.stages.filter((stage) => stage.name === 'candidatePreflightBatch').length, 1);
  assert.equal(timing.finalReceipt.candidatePreflightBatch.session.shared, true);
  const report = fs.readFileSync(summary.report, 'utf8');
  assert.match(report, /Shared candidate preflight: `enabled`/);
  assert.match(report, /Shared pre-delivery candidate check: `pass` \(2 candidates, one browser process\)/);
  for (const diagram of summary.diagrams) {
    const diagramTiming = JSON.parse(fs.readFileSync(diagram.timing, 'utf8'));
    const validate = diagramTiming.finalReceipt.commands.find((command) => command.kind === 'validate');
    assert.equal(validate.receipt.preflight.status, 'pass');
    assert.equal(diagramTiming.finalReceipt.quality.sharedViewportPreflight, true);
  }
});

test('suite runner: specification and artifact digests form one end-to-end chain', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-digest-chain-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  const candidate = staticCandidate(tmp, 'workflow');

  await t.test('validate specification must match the current candidate', async () => {
    const manifestPath = writeManifest(tmp, [{
      type: 'workflow',
      candidate,
      commands: qualityCommands(),
    }]);
    const summary = await runSuite({
      manifestPath,
      repoRoot,
      revision,
      outputRoot: path.join(tmp, 'validate-spec-output'),
      archifyCli,
      commandRunner: fakeRunner({ tamperValidationSpecification: true }),
    });
    assert.equal(summary.status, 'automated-failure');
    const timing = JSON.parse(fs.readFileSync(summary.diagrams[0].timing, 'utf8'));
    assert.match(timing.finalReceipt.error.message, /validate specification digest does not match/);
  });

  await t.test('deliver specification must match shared preflight', async () => {
    const manifestPath = writeManifest(tmp, [{
      type: 'workflow',
      candidate,
      commands: qualityCommands(),
    }], { sharedViewportPreflight: true });
    const base = fakeRunner();
    const commandRunner = async (request) => {
      const result = await base(request);
      if (request.kind !== 'deliver') return result;
      const receipt = JSON.parse(result.stdout);
      receipt.specification.sha256 = 'f'.repeat(64);
      return jsonResult(receipt);
    };
    const summary = await runSuite({
      manifestPath,
      repoRoot,
      revision,
      outputRoot: path.join(tmp, 'spec-output'),
      archifyCli,
      commandRunner,
      candidatePreflightRunner: sharedCandidatePreflightRunner(),
    });
    assert.equal(summary.status, 'automated-failure');
    const timing = JSON.parse(fs.readFileSync(summary.diagrams[0].timing, 'utf8'));
    assert.match(timing.finalReceipt.error.message, /deliver specification digest does not match shared candidate preflight/);
  });

  await t.test('deliver artifact must match the digest-bound shared preflight artifact', async () => {
    const manifestPath = writeManifest(tmp, [{
      type: 'workflow',
      candidate,
      commands: qualityCommands(),
    }], { sharedViewportPreflight: true });
    const sharedRunner = sharedCandidatePreflightRunner();
    const candidatePreflightRunner = async (request) => {
      const result = await sharedRunner(request);
      result.receipt.candidates[0].artifact.sha256 = 'f'.repeat(64);
      return result;
    };
    const summary = await runSuite({
      manifestPath,
      repoRoot,
      revision,
      outputRoot: path.join(tmp, 'preflight-artifact-output'),
      archifyCli,
      commandRunner: fakeRunner(),
      candidatePreflightRunner,
    });
    assert.equal(summary.status, 'automated-failure');
    const timing = JSON.parse(fs.readFileSync(summary.diagrams[0].timing, 'utf8'));
    assert.match(timing.finalReceipt.error.message, /deliver artifact digest does not match shared candidate preflight/);
  });

  await t.test('visual artifact must be the exact delivered bytes', async () => {
    const manifestPath = writeManifest(tmp, [{
      type: 'workflow',
      candidate,
      commands: qualityCommands(),
    }]);
    const base = fakeRunner();
    const commandRunner = async (request) => {
      if (request.kind === 'visual-check-batch') {
        for (const artifactPath of request.args.slice(2, -1)) {
          fs.writeFileSync(artifactPath, '<!doctype html><title>changed after deliver</title>\n');
        }
      }
      return base(request);
    };
    const summary = await runSuite({
      manifestPath,
      repoRoot,
      revision,
      outputRoot: path.join(tmp, 'artifact-output'),
      archifyCli,
      commandRunner,
    });
    assert.equal(summary.status, 'automated-failure');
    const timing = JSON.parse(fs.readFileSync(summary.diagrams[0].timing, 'utf8'));
    assert.match(timing.finalReceipt.error.message, /visual-check artifact digest does not match deliver/);
  });
});

test('suite runner: final visual evidence binds the last successful deliver command', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-last-deliver-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  const manifestPath = writeManifest(tmp, [{
    type: 'workflow',
    candidate: staticCandidate(tmp, 'workflow'),
    commands: [
      { id: 'validate', kind: 'validate' },
      { id: 'deliver-first', kind: 'deliver' },
      { id: 'deliver-final', kind: 'deliver' },
      { id: 'visual', kind: 'visual-check' },
    ],
  }]);
  const base = fakeRunner();
  const commandRunner = async (request) => {
    const result = await base(request);
    if (request.id !== 'deliver-final') return result;
    const receipt = JSON.parse(result.stdout);
    const artifact = Buffer.from('<!doctype html><title>final delivery</title>\n');
    fs.writeFileSync(request.args[4], artifact);
    receipt.artifact = {
      bytes: artifact.byteLength,
      sha256: createHash('sha256').update(artifact).digest('hex'),
    };
    return jsonResult(receipt);
  };

  const summary = await runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot: path.join(tmp, 'output'),
    archifyCli,
    commandRunner,
  });

  assert.equal(summary.status, 'automated-pass-awaiting-human-review');
});

test('suite runner: one unavailable Chrome capability probe stops every diagram command fail-closed', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-capability-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  const manifestPath = writeManifest(tmp, [
    { type: 'workflow', candidate: staticCandidate(tmp, 'workflow'), commands: qualityCommands() },
    { type: 'sequence', candidate: staticCandidate(tmp, 'sequence'), commands: qualityCommands() },
  ]);
  const commandRunner = fakeRunner({ capabilityStatus: 'unavailable' });
  const outputRoot = path.join(tmp, 'output');

  const summary = await runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot,
    archifyCli,
    concurrency: 2,
    commandRunner,
  });

  assert.equal(summary.status, 'automated-failure');
  assert.equal(commandRunner.requests.filter((request) => request.kind === 'chrome-capability').length, 1);
  assert.equal(commandRunner.requests.filter((request) => ['exec', 'validate', 'deliver', 'visual-check', 'visual-check-batch'].includes(request.kind)).length, 0);
  assert.deepEqual(summary.diagrams, []);
  assert.equal(summary.chromeCapability.receipt.status, 'unavailable');
  assert.ok(Number.isFinite(summary.chromeCapability.durationMs));
  const timing = JSON.parse(fs.readFileSync(summary.timing, 'utf8'));
  assert.equal(timing.status, 'failed');
  assert.equal(timing.stages[0].name, 'chromeCapability');
  assert.equal(timing.stages[0].status, 'failed');
  assert.equal(timing.finalReceipt.chromeCapability.receipt.status, 'unavailable');
  assert.match(fs.readFileSync(summary.report, 'utf8'), /Chrome capability gate: `unavailable`/);
});

test('suite runner: visual batch wrapper must agree with every child receipt', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-batch-wrapper-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  const manifestPath = writeManifest(tmp, [{
    type: 'workflow',
    candidate: staticCandidate(tmp, 'workflow'),
    commands: qualityCommands(),
  }]);
  const base = fakeRunner();
  const commandRunner = async (request) => {
    const result = await base(request);
    if (request.kind !== 'visual-check-batch') return result;
    const receipt = JSON.parse(result.stdout);
    receipt.status = 'fail';
    return jsonResult(receipt);
  };

  const summary = await runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot: path.join(tmp, 'output'),
    archifyCli,
    commandRunner,
  });

  assert.equal(summary.status, 'automated-failure');
  assert.equal(base.requests.filter((request) => request.kind === 'visual-check-batch').length, 1);
  assert.equal(summary.diagrams[0].status, 'failed');
  const timing = JSON.parse(fs.readFileSync(summary.timing, 'utf8'));
  assert.equal(timing.stages.find((stage) => stage.name === 'visualCheckBatch').status, 'failed');
  assert.match(timing.finalReceipt.error.message, /wrapper contradicts its child receipts/);
});

test('suite runner: a failed typed command is retained in final receipts and still produces a pending human review', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-failure-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  const outputRoot = path.join(tmp, 'output');
  fs.mkdirSync(repoRoot);
  const manifestPath = writeManifest(tmp, [{
    id: 'lifecycle',
    type: 'lifecycle',
    candidate: staticCandidate(tmp, 'lifecycle'),
    commands: qualityCommands(),
  }]);

  const summary = await runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot,
    archifyCli,
    commandRunner: fakeRunner({ failDiagram: 'lifecycle' }),
  });

  assert.equal(summary.status, 'automated-failure');
  assert.equal(summary.diagrams[0].status, 'failed');
  assert.equal(summary.diagrams[0].artifact, null);
  const timing = JSON.parse(fs.readFileSync(summary.diagrams[0].timing, 'utf8'));
  assert.equal(timing.stages.length, 1);
  assert.equal(timing.stages[0].status, 'failed');
  assert.equal(timing.finalReceipt.commands[0].receipt.ok, false);
  assert.equal(timing.finalReceipt.error.code, 'ARCHIFY_SUITE_COMMAND_FAILED');
  assert.equal(JSON.parse(fs.readFileSync(summary.diagrams[0].visualReview, 'utf8')).status, 'pending');
  assert.match(fs.readFileSync(summary.report, 'utf8'), /automated-failure/);
});

test('suite runner: rejects symbolic or mismatched revisions before creating diagram output', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-revision-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  const manifestPath = writeManifest(tmp, [{
    type: 'dataflow',
    candidate: staticCandidate(tmp, 'dataflow'),
    commands: qualityCommands(),
  }]);

  await assert.rejects(runSuite({
    manifestPath,
    repoRoot,
    revision: 'HEAD',
    outputRoot: path.join(tmp, 'symbolic-output'),
    archifyCli,
    commandRunner: fakeRunner(),
  }), /full 40-64 character hexadecimal commit id/);

  const mismatchRunner = fakeRunner();
  await assert.rejects(runSuite({
    manifestPath,
    repoRoot,
    revision: 'ffffffffffffffffffffffffffffffffffffffff',
    outputRoot: path.join(tmp, 'mismatch-output'),
    archifyCli,
    commandRunner: mismatchRunner,
  }), /does not match repository HEAD/);
  assert.equal(fs.existsSync(path.join(tmp, 'symbolic-output')), false);
  assert.equal(fs.existsSync(path.join(tmp, 'mismatch-output')), false);
});

test('suite runner: manifest enforces validate-deliver-visual quality ordering', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-order-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  const manifestPath = writeManifest(tmp, [{
    type: 'architecture',
    candidate: staticCandidate(tmp, 'architecture'),
    commands: [
      { id: 'deliver', kind: 'deliver' },
      { id: 'visual', kind: 'visual-check' },
    ],
  }]);

  await assert.rejects(runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot: path.join(tmp, 'output'),
    archifyCli,
    commandRunner: fakeRunner(),
  }), /requires a preceding validate/);
});

test('suite runner: every suite requires showcase quality with viewport preflight enabled', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-quality-floor-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  const diagram = {
    type: 'workflow',
    candidate: staticCandidate(tmp, 'workflow'),
    commands: qualityCommands(),
  };

  const standardManifest = writeManifest(tmp, [diagram], { qualityProfile: 'standard' });
  await assert.rejects(runSuite({
    manifestPath: standardManifest,
    repoRoot,
    revision,
    outputRoot: path.join(tmp, 'standard-output'),
    archifyCli,
    commandRunner: fakeRunner(),
  }), /qualityProfile must be "showcase"/);

  const noPreflightManifest = writeManifest(tmp, [diagram], { viewportPreflight: false });
  await assert.rejects(runSuite({
    manifestPath: noPreflightManifest,
    repoRoot,
    revision,
    outputRoot: path.join(tmp, 'no-preflight-output'),
    archifyCli,
    commandRunner: fakeRunner(),
  }), /viewportPreflight must be enabled/);
});

test('suite runner: shared candidate preflight rejects mutable exec candidates', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-shared-mutable-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  const manifestPath = writeManifest(tmp, [{
    type: 'workflow',
    candidate: staticCandidate(tmp, 'workflow'),
    commands: [
      { id: 'prepare', kind: 'exec', argv: ['prepare-candidate'] },
      ...qualityCommands(),
    ],
  }], { sharedViewportPreflight: true });

  await assert.rejects(runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot: path.join(tmp, 'output'),
    archifyCli,
    commandRunner: fakeRunner(),
  }), /requires frozen candidates and does not permit exec commands/);
});

test('suite runner: mutable exec candidates cannot escape their isolated diagram directory', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-exec-isolation-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  const manifestPath = writeManifest(tmp, [{
    type: 'workflow',
    candidate: staticCandidate(tmp, 'workflow'),
    commands: [
      { id: 'prepare', kind: 'exec', argv: ['prepare-candidate', '{candidate}'] },
      ...qualityCommands(),
    ],
  }]);
  const commandRunner = fakeRunner();
  await assert.rejects(runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot: path.join(tmp, 'output'),
    archifyCli,
    commandRunner,
  }), /mutable candidate must stay inside its isolated diagram directory/);
  assert.equal(commandRunner.requests.length, 0);
});

test('suite runner: rejects control-file and candidate/artifact aliases before execution', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-alias-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  let manifestPath = writeManifest(tmp, [{
    type: 'workflow',
    candidate: staticCandidate(tmp, 'workflow'),
    artifact: 'timing.json',
    commands: qualityCommands(),
  }]);
  await assert.rejects(runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot: path.join(tmp, 'control-output'),
    archifyCli,
    commandRunner: fakeRunner(),
  }), /artifact conflicts with reserved orchestration file/);

  manifestPath = writeManifest(tmp, [{
    type: 'sequence',
    candidate: '{diagramOutput}/same.json',
    artifact: 'same.json',
    commands: qualityCommands(),
  }]);
  await assert.rejects(runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot: path.join(tmp, 'same-output'),
    archifyCli,
    commandRunner: fakeRunner(),
  }), /candidate and artifact must be different files/);
});

test('suite runner: rejects candidate realpath and inode aliases across diagrams', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-candidate-identity-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  const source = staticCandidate(tmp, 'workflow');
  const sourcePath = path.join(tmp, source);
  const aliases = [
    { name: 'symlink', file: path.join(tmp, 'candidate-symlink.json'), create: () => fs.symlinkSync(sourcePath, path.join(tmp, 'candidate-symlink.json')) },
    { name: 'hardlink', file: path.join(tmp, 'candidate-hardlink.json'), create: () => fs.linkSync(sourcePath, path.join(tmp, 'candidate-hardlink.json')) },
  ];

  for (const alias of aliases) {
    await t.test(alias.name, async () => {
      alias.create();
      const manifestPath = writeManifest(tmp, [
        { id: 'first', type: 'workflow', candidate: source, commands: qualityCommands() },
        { id: 'second', type: 'workflow', candidate: path.basename(alias.file), commands: qualityCommands() },
      ]);
      const commandRunner = fakeRunner();
      await assert.rejects(runSuite({
        manifestPath,
        repoRoot,
        revision,
        outputRoot: path.join(tmp, `${alias.name}-output`),
        archifyCli,
        commandRunner,
      }), /candidate paths alias the same filesystem entry/);
      assert.equal(commandRunner.requests.length, 0, 'alias audit must fail before repository or browser work');
    });
  }
});

test('suite runner: re-audits candidate identities after exec creates filesystem aliases', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-runtime-alias-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  const outputRoot = path.join(tmp, 'output');
  fs.mkdirSync(repoRoot);
  const commands = [
    { id: 'prepare', kind: 'exec', argv: ['prepare-candidate', '{candidate}'], receipt: 'json', cwd: 'diagram' },
    ...qualityCommands(),
  ];
  const manifestPath = writeManifest(tmp, [
    { id: 'first', type: 'workflow', candidate: '{diagramOutput}/candidate.json', commands },
    { id: 'second', type: 'workflow', candidate: '{diagramOutput}/candidate.json', commands },
  ]);
  const base = fakeRunner();
  const commandRunner = async (request) => {
    if (request.kind === 'exec' && request.env.ARCHIFY_SUITE_DIAGRAM_ID === 'second') {
      fs.linkSync(
        path.join(outputRoot, 'first', 'candidate.json'),
        path.join(outputRoot, 'second', 'candidate.json'),
      );
      return jsonResult({ schemaVersion: 1, ok: true, command: 'prepare' });
    }
    return base(request);
  };

  const summary = await runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot,
    archifyCli,
    concurrency: 1,
    commandRunner,
  });

  assert.equal(summary.status, 'automated-failure');
  assert.equal(summary.diagrams.find((diagram) => diagram.id === 'second').status, 'failed');
  const secondTiming = JSON.parse(fs.readFileSync(path.join(outputRoot, 'second', 'timing.json'), 'utf8'));
  assert.match(secondTiming.finalReceipt.error.message, /candidate paths alias the same filesystem entry/);
  assert.equal(base.requests.some((request) => (
    request.kind === 'deliver' && request.env.ARCHIFY_SUITE_DIAGRAM_ID === 'second'
  )), false);
});

test('suite runner: malformed or lower-profile quality receipts fail closed', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-receipt-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  const manifestPath = writeManifest(tmp, [{
    type: 'workflow',
    candidate: staticCandidate(tmp, 'workflow'),
    commands: qualityCommands(),
  }]);

  const malformedBase = fakeRunner();
  const malformedRunner = async (request) => request.kind === 'validate'
    ? jsonResult({ schemaVersion: 1, command: 'validate' })
    : malformedBase(request);
  let summary = await runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot: path.join(tmp, 'malformed-output'),
    archifyCli,
    commandRunner: malformedRunner,
  });
  assert.equal(summary.status, 'automated-failure');
  let timing = JSON.parse(fs.readFileSync(summary.diagrams[0].timing, 'utf8'));
  assert.match(timing.finalReceipt.error.message, /boolean ok/);

  const lowerProfileBase = fakeRunner();
  const lowerProfileRunner = async (request) => {
    const result = await lowerProfileBase(request);
    if (request.kind !== 'validate') return result;
    const receipt = JSON.parse(result.stdout);
    receipt.composition.profile = 'standard';
    return jsonResult(receipt);
  };
  summary = await runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot: path.join(tmp, 'lower-profile-output'),
    archifyCli,
    commandRunner: lowerProfileRunner,
  });
  assert.equal(summary.status, 'automated-failure');
  timing = JSON.parse(fs.readFileSync(summary.diagrams[0].timing, 'utf8'));
  assert.match(timing.finalReceipt.error.message, /does not match suite profile showcase/);

  const noPreflightBase = fakeRunner();
  const noPreflightRunner = async (request) => {
    const result = await noPreflightBase(request);
    if (request.kind !== 'validate') return result;
    const receipt = JSON.parse(result.stdout);
    delete receipt.preflight;
    return jsonResult(receipt);
  };
  summary = await runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot: path.join(tmp, 'missing-preflight-output'),
    archifyCli,
    commandRunner: noPreflightRunner,
  });
  assert.equal(summary.status, 'automated-failure');
  timing = JSON.parse(fs.readFileSync(summary.diagrams[0].timing, 'utf8'));
  assert.match(timing.finalReceipt.error.message, /passing 4\/4 viewport preflight/);

  const duplicateViewportBase = fakeRunner();
  const duplicateViewportRunner = async (request) => {
    const result = await duplicateViewportBase(request);
    if (request.kind !== 'validate') return result;
    const receipt = JSON.parse(result.stdout);
    receipt.preflight.containment.viewports = Array.from({ length: 4 }, () => ({
      width: 1440,
      height: 900,
      theme: 'light',
      ok: true,
    }));
    return jsonResult(receipt);
  };
  summary = await runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot: path.join(tmp, 'duplicate-preflight-output'),
    archifyCli,
    commandRunner: duplicateViewportRunner,
  });
  assert.equal(summary.status, 'automated-failure');
  timing = JSON.parse(fs.readFileSync(summary.diagrams[0].timing, 'utf8'));
  assert.match(timing.finalReceipt.error.message, /passing 4\/4 viewport preflight/);

  const duplicateCheckBase = fakeRunner();
  const duplicateCheckRunner = async (request) => {
    const result = await duplicateCheckBase(request);
    if (request.kind !== 'validate') return result;
    const receipt = JSON.parse(result.stdout);
    receipt.checks[8].name = receipt.checks[0].name;
    return jsonResult(receipt);
  };
  summary = await runSuite({
    manifestPath,
    repoRoot,
    revision,
    outputRoot: path.join(tmp, 'duplicate-check-output'),
    archifyCli,
    commandRunner: duplicateCheckRunner,
  });
  assert.equal(summary.status, 'automated-failure');
  timing = JSON.parse(fs.readFileSync(summary.diagrams[0].timing, 'utf8'));
  assert.match(timing.finalReceipt.error.message, /canonical 9\/9 deterministic checks/);
});

test('suite runner: final visual receipt preserves the exact measured showcase state', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-visual-contract-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  const manifestPath = writeManifest(tmp, [{
    type: 'workflow',
    candidate: staticCandidate(tmp, 'workflow'),
    commands: qualityCommands(),
  }]);
  const cases = [
    {
      name: 'duplicate containment viewport',
      mutate: (receipt) => {
        receipt.containment.viewports[3] = { ...receipt.containment.viewports[0] };
      },
      error: /exact four-viewport light containment matrix/,
    },
    {
      name: 'incomplete screenshot matrix',
      mutate: (receipt) => {
        receipt.captures.screenshots[3] = { ...receipt.captures.screenshots[1] };
      },
      error: /exact four-screenshot light\/dark capture matrix/,
    },
    {
      name: 'unresolved requested theme',
      mutate: (receipt) => {
        receipt.captures.screenshots[1].resolvedTheme = 'light';
      },
      error: /resolved theme must match its requested theme/,
    },
    {
      name: 'non-reading viewer state',
      mutate: (receipt) => {
        receipt.state.observations[0].detailLevel = 'overview';
      },
      error: /READ detail and Still motion state/,
    },
    {
      name: 'missing readability proof',
      mutate: (receipt) => {
        receipt.readability.status = 'fail';
      },
      error: /readability receipt/,
    },
    {
      name: 'missing viewer chrome proof',
      mutate: (receipt) => {
        receipt.viewerChrome.viewports[0].viewerChromeOk = false;
      },
      error: /viewerChrome receipt/,
    },
    {
      name: 'unbound screenshot bytes',
      mutate: (receipt) => {
        receipt.captures.screenshots[0].sha256 = 'f'.repeat(64);
      },
      error: /screenshot content digest/,
    },
    {
      name: 'legacy visual receipt schema',
      mutate: (receipt, wrapper) => {
        receipt.schemaVersion = 1;
        wrapper.schemaVersion = 1;
      },
      error: /schemaVersion 2/,
    },
    {
      name: 'forged PNG dimensions',
      mutate: (receipt) => {
        const screenshot = receipt.captures.screenshots[0];
        const screenshotPath = path.join(path.dirname(receipt.artifact.path), screenshot.file);
        const forged = fakePng(screenshot.width - 1, screenshot.height);
        fs.writeFileSync(screenshotPath, forged);
        screenshot.sha256 = createHash('sha256').update(forged).digest('hex');
        screenshot.bytes = forged.byteLength;
      },
      error: /PNG IHDR dimensions/,
    },
    {
      name: 'non-canonical screenshot sidecar',
      mutate: (receipt) => {
        const screenshot = receipt.captures.screenshots[0];
        const directory = path.dirname(receipt.artifact.path);
        const replacement = 'alternate.png';
        fs.renameSync(path.join(directory, screenshot.file), path.join(directory, replacement));
        screenshot.file = replacement;
      },
      error: /canonical sidecar basename/,
    },
  ];

  for (const [index, entry] of cases.entries()) {
    await t.test(entry.name, async () => {
      const base = fakeRunner();
      const commandRunner = async (request) => {
        const result = await base(request);
        if (request.kind !== 'visual-check-batch') return result;
        const receipt = JSON.parse(result.stdout);
        entry.mutate(receipt.artifacts[0], receipt);
        return jsonResult(receipt);
      };
      const summary = await runSuite({
        manifestPath,
        repoRoot,
        revision,
        outputRoot: path.join(tmp, `output-${index}`),
        archifyCli,
        commandRunner,
      });
      assert.equal(summary.status, 'automated-failure');
      const timing = JSON.parse(fs.readFileSync(summary.diagrams[0].timing, 'utf8'));
      assert.match(timing.finalReceipt.error.message, entry.error);
    });
  }
});

test('suite runner: optionally builds one revision-pinned project index shared by every diagram receipt', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-index-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  fs.writeFileSync(path.join(repoRoot, 'index.js'), 'export const answer = 42;\n');
  const git = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
  git('init');
  git('config', 'user.name', 'Archify Tests');
  git('config', 'user.email', 'archify@example.test');
  git('remote', 'add', 'origin', 'https://github.com/example/pi.git');
  git('add', '.');
  git('commit', '-m', 'fixture');
  const pinned = git('rev-parse', 'HEAD');
  const candidate = staticCandidate(tmp, 'workflow');
  const manifestPath = path.join(tmp, 'indexed-suite.json');
  fs.writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    id: 'indexed-suite',
    authoredLanguage: 'en',
    projectIndex: true,
    diagrams: [{ type: 'workflow', candidate, commands: qualityCommands() }],
  }));
  const outputRoot = path.join(tmp, 'output');

  const summary = await runSuite({
    manifestPath,
    repoRoot,
    revision: pinned,
    outputRoot,
    archifyCli,
    commandRunner: fakeRunner({ revisionValue: pinned }),
  });

  assert.equal(summary.projectIndex.repository.revision, pinned);
  assert.equal(summary.projectIndex.files, 1);
  assert.equal(summary.projectIndex.filesAnalyzed, 1);
  assert.match(summary.projectIndex.digest, /^[a-f0-9]{64}$/);
  const projectIndexBytes = fs.readFileSync(summary.projectIndex.path);
  assert.equal(summary.projectIndex.bytes, projectIndexBytes.byteLength);
  assert.equal(
    summary.projectIndex.sha256,
    createHash('sha256').update(projectIndexBytes).digest('hex'),
  );
  assert.equal(summary.finalReceipt.projectIndex.digest, summary.projectIndex.digest);
  assert.equal(JSON.parse(fs.readFileSync(summary.projectIndex.path, 'utf8')).digest, summary.projectIndex.digest);
  const timing = JSON.parse(fs.readFileSync(summary.diagrams[0].timing, 'utf8'));
  assert.equal(timing.finalReceipt.projectIndex.digest, summary.projectIndex.digest);
  assert.match(fs.readFileSync(summary.report, 'utf8'), /Shared project index/);
});

test('suite runner: fails closed when the written project index changes before final receipts', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-index-tamper-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  fs.writeFileSync(path.join(repoRoot, 'index.js'), 'export const answer = 42;\n');
  const git = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
  git('init');
  git('config', 'user.name', 'Archify Tests');
  git('config', 'user.email', 'archify@example.test');
  git('remote', 'add', 'origin', 'https://github.com/example/pi.git');
  git('add', '.');
  git('commit', '-m', 'fixture');
  const pinned = git('rev-parse', 'HEAD');
  const index = buildProjectIndex({ repoRoot, revision: pinned });
  const ledger = createEvidenceLedger(index, [{
    claimId: 'answer-export',
    path: 'index.js',
    line: 1,
    summary: 'The repository exports the answer.',
  }]);
  const ledgerPath = path.join(tmp, 'workflow.evidence-ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
  const candidateName = staticCandidate(tmp, 'workflow');
  const candidatePath = path.join(tmp, candidateName);
  const candidateDocument = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
  candidateDocument.nodes = [{ id: 'answer-node', label: 'Answer export' }];
  candidateDocument.meta.views = [{ id: 'answer-view', label: 'Answer API', focus: ['answer-node'] }];
  fs.writeFileSync(candidatePath, JSON.stringify(candidateDocument));
  const manifestPath = writeManifest(tmp, [{
    type: 'workflow',
    candidate: candidateName,
    evidenceLedger: path.basename(ledgerPath),
    requiredConcepts: ['answer-api'],
    requiredClaimIds: ['answer-export'],
    coverageMap: {
      'answer-api': {
        candidateIds: ['answer-node', 'answer-view'],
        claimIds: ['answer-export'],
      },
    },
    commands: qualityCommands(),
  }], { projectIndex: true });
  const outputRoot = path.join(tmp, 'output');
  const baseRunner = fakeRunner({ revisionValue: pinned });
  const tamperingRunner = async (request) => {
    if (request.kind === 'visual-check-batch') {
      const projectIndexPath = path.join(outputRoot, 'project-index.json');
      fs.appendFileSync(projectIndexPath, ' \n');
      JSON.parse(fs.readFileSync(projectIndexPath, 'utf8'));
    }
    return baseRunner(request);
  };

  const summary = await runSuite({
    manifestPath,
    repoRoot,
    revision: pinned,
    outputRoot,
    archifyCli,
    commandRunner: tamperingRunner,
  });

  assert.equal(summary.status, 'automated-failure');
  assert.match(summary.finalReceipt.error.message, /project index changed before final receipt/);
  assert.equal(Object.hasOwn(summary, 'projectIndex'), false);
  const timing = JSON.parse(fs.readFileSync(summary.diagrams[0].timing, 'utf8'));
  assert.equal(timing.status, 'failed');
  assert.match(timing.finalReceipt.error.message, /project index changed before final receipt/);
  assert.equal(Object.hasOwn(timing.finalReceipt, 'projectIndex'), false);
  assert.equal(Object.hasOwn(timing.finalReceipt, 'evidenceLedger'), false);
  assert.equal(Object.hasOwn(timing.finalReceipt, 'semanticCoverage'), false);
  assert.equal(baseRunner.requests.filter((request) => request.kind === 'deliver').length, 1);
});

test('suite runner: verifies a manifest evidence ledger immediately before delivery and records its receipt', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-suite-evidence-ledger-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const repoRoot = path.join(tmp, 'repo');
  fs.mkdirSync(repoRoot);
  fs.writeFileSync(path.join(repoRoot, 'index.js'), 'export const answer = 42;\n');
  const git = (...args) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8' }).trim();
  git('init');
  git('config', 'user.name', 'Archify Tests');
  git('config', 'user.email', 'archify@example.test');
  git('remote', 'add', 'origin', 'https://github.com/example/pi.git');
  git('add', '.');
  git('commit', '-m', 'fixture');
  const pinned = git('rev-parse', 'HEAD');
  const index = buildProjectIndex({ repoRoot, revision: pinned });
  const ledger = createEvidenceLedger(index, [{
    claimId: 'answer-export',
    path: 'index.js',
    line: 1,
    summary: 'The repository exports the answer.',
  }]);
  const ledgerPath = path.join(tmp, 'workflow.evidence-ledger.json');
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger));
  const candidateName = staticCandidate(tmp, 'workflow');
  const candidatePath = path.join(tmp, candidateName);
  const candidateDocument = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
  candidateDocument.nodes = [{ id: 'answer-node', label: 'Answer export' }];
  candidateDocument.meta.views = [{
    id: 'answer-view',
    label: 'Answer API',
    focus: ['answer-node'],
  }];
  fs.writeFileSync(candidatePath, JSON.stringify(candidateDocument));
  const semanticContract = {
    requiredConcepts: ['answer-api'],
    requiredClaimIds: ['answer-export'],
    coverageMap: {
      'answer-api': {
        candidateIds: ['answer-node', 'answer-view'],
        claimIds: ['answer-export'],
      },
    },
  };
  const manifestPath = writeManifest(tmp, [{
    type: 'workflow',
    candidate: candidateName,
    evidenceLedger: path.basename(ledgerPath),
    ...semanticContract,
    commands: qualityCommands(),
  }], { projectIndex: true });
  const commandRunner = fakeRunner({ revisionValue: pinned });

  const summary = await runSuite({
    manifestPath,
    repoRoot,
    revision: pinned,
    outputRoot: path.join(tmp, 'output'),
    archifyCli,
    commandRunner,
  });

  assert.equal(summary.status, 'automated-pass-awaiting-human-review');
  const timing = JSON.parse(fs.readFileSync(summary.diagrams[0].timing, 'utf8'));
  assert.deepEqual(timing.finalReceipt.evidenceLedger, {
    schemaVersion: 1,
    verified: true,
    path: path.join(tmp, 'output', 'workflow', 'evidence-ledger.verified.json'),
    sourcePath: ledgerPath,
    bytes: fs.statSync(ledgerPath).size,
    sha256: createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex'),
    ledgerDigest: ledger.ledgerDigest,
    indexDigest: index.digest,
    origin: 'https://github.com/example/pi',
    revision: pinned,
    objectFormat: 'sha1',
    factCount: 1,
  });
  assert.deepEqual(
    fs.readFileSync(timing.finalReceipt.evidenceLedger.path),
    fs.readFileSync(ledgerPath),
  );
  assert.equal(timing.finalReceipt.semanticCoverage.presenceVerified, true);
  assert.equal(timing.finalReceipt.semanticCoverage.verificationScope, 'mechanical-presence-only');
  assert.equal(timing.finalReceipt.semanticCoverage.semanticCorrectness, 'not-assessed');
  assert.equal(timing.finalReceipt.semanticCoverage.blindReview, 'required');
  assert.deepEqual(timing.finalReceipt.semanticCoverage.requiredConcepts, ['answer-api']);
  assert.deepEqual(timing.finalReceipt.semanticCoverage.requiredClaimIds, ['answer-export']);
  assert.deepEqual(timing.finalReceipt.semanticCoverage.coverageMap, semanticContract.coverageMap);
  assert.deepEqual(timing.finalReceipt.semanticCoverage.candidateEntityPointers, {
    'answer-node': ['/nodes/0/id'],
    'answer-view': ['/meta/views/0/id'],
  });
  assert.match(timing.finalReceipt.semanticCoverage.digest, /^[a-f0-9]{64}$/);
  assert.equal(
    timing.finalReceipt.semanticCoverage.candidateSha256,
    timing.finalReceipt.commands.find((command) => command.kind === 'deliver').receipt.specification.sha256,
  );
  assert.equal(commandRunner.requests.filter((request) => request.kind === 'deliver').length, 1);

  const tamperFrozenLedger = (outputRoot) => {
    const frozenPath = path.join(outputRoot, 'workflow', 'evidence-ledger.verified.json');
    const frozen = fs.readFileSync(frozenPath, 'utf8');
    const tampered = frozen.replace('exports the answer', 'exports the answeq');
    assert.equal(Buffer.byteLength(tampered), Buffer.byteLength(frozen));
    assert.notEqual(tampered, frozen);
    JSON.parse(tampered);
    fs.writeFileSync(frozenPath, tampered);
  };

  const tamperedLedger = structuredClone(ledger);
  tamperedLedger.facts[0].summary = 'Tampered after hydration.';
  const tamperedLedgerPath = path.join(tmp, 'tampered.evidence-ledger.json');
  fs.writeFileSync(tamperedLedgerPath, JSON.stringify(tamperedLedger));
  const tamperedManifest = writeManifest(tmp, [{
    type: 'workflow',
    candidate: path.basename(path.join(tmp, 'workflow.json')),
    evidenceLedger: path.basename(tamperedLedgerPath),
    commands: qualityCommands(),
  }], { projectIndex: true });
  const tamperedRunner = fakeRunner({ revisionValue: pinned });
  const tamperedSummary = await runSuite({
    manifestPath: tamperedManifest,
    repoRoot,
    revision: pinned,
    outputRoot: path.join(tmp, 'tampered-output'),
    archifyCli,
    commandRunner: tamperedRunner,
  });
  assert.equal(tamperedSummary.status, 'automated-failure');
  const tamperedTiming = JSON.parse(fs.readFileSync(tamperedSummary.diagrams[0].timing, 'utf8'));
  assert.match(tamperedTiming.finalReceipt.error.message, /ledger digest does not match/);
  assert.equal(tamperedRunner.requests.filter((request) => request.kind === 'deliver').length, 0);

  const unindexedManifest = writeManifest(tmp, [{
    type: 'workflow',
    candidate: path.basename(path.join(tmp, 'workflow.json')),
    evidenceLedger: path.basename(ledgerPath),
    commands: qualityCommands(),
  }]);
  const unindexedRunner = fakeRunner({ revisionValue: pinned });
  await assert.rejects(runSuite({
    manifestPath: unindexedManifest,
    repoRoot,
    revision: pinned,
    outputRoot: path.join(tmp, 'unindexed-output'),
    archifyCli,
    commandRunner: unindexedRunner,
  }), /evidenceLedger requires manifest.projectIndex/);
  assert.equal(unindexedRunner.requests.length, 0);

  const reservedLedgerRunner = fakeRunner({ revisionValue: pinned });
  const reservedLedgerManifest = writeManifest(tmp, [{
    type: 'workflow',
    candidate: candidateName,
    evidenceLedger: '{diagramOutput}/evidence-ledger.verified.json',
    commands: qualityCommands(),
  }], { projectIndex: true });
  await assert.rejects(runSuite({
    manifestPath: reservedLedgerManifest,
    repoRoot,
    revision: pinned,
    outputRoot: path.join(tmp, 'reserved-ledger-output'),
    archifyCli,
    commandRunner: reservedLedgerRunner,
  }), /evidence ledger path aliases reserved orchestration output/);
  assert.equal(reservedLedgerRunner.requests.length, 0);

  const missingIdManifest = writeManifest(tmp, [{
    type: 'workflow',
    candidate: candidateName,
    evidenceLedger: path.basename(ledgerPath),
    requiredConcepts: ['answer-api'],
    requiredClaimIds: ['answer-export'],
    coverageMap: {
      'answer-api': {
        candidateIds: ['missing-node'],
        claimIds: ['answer-export'],
      },
    },
    commands: qualityCommands(),
  }], { projectIndex: true });
  const missingIdRunner = fakeRunner({ revisionValue: pinned });
  const missingIdSummary = await runSuite({
    manifestPath: missingIdManifest,
    repoRoot,
    revision: pinned,
    outputRoot: path.join(tmp, 'missing-id-output'),
    archifyCli,
    commandRunner: missingIdRunner,
  });
  assert.equal(missingIdSummary.status, 'automated-failure');
  const missingIdTiming = JSON.parse(fs.readFileSync(missingIdSummary.diagrams[0].timing, 'utf8'));
  assert.match(missingIdTiming.finalReceipt.error.message, /required candidate ID "missing-node"/);
  assert.equal(missingIdRunner.requests.filter((request) => request.kind === 'deliver').length, 0);

  const metadataCandidateName = 'workflow-metadata-id.json';
  const metadataCandidatePath = path.join(tmp, metadataCandidateName);
  fs.writeFileSync(metadataCandidatePath, JSON.stringify({
    schema_version: 1,
    diagram_type: 'workflow',
    meta: {
      title: 'Metadata must not satisfy entity coverage',
      audit: { id: 'metadata-only' },
    },
    nodes: [],
  }));
  const metadataIdManifest = writeManifest(tmp, [{
    type: 'workflow',
    candidate: metadataCandidateName,
    evidenceLedger: path.basename(ledgerPath),
    requiredConcepts: ['answer-api'],
    requiredClaimIds: ['answer-export'],
    coverageMap: {
      'answer-api': {
        candidateIds: ['metadata-only'],
        claimIds: ['answer-export'],
      },
    },
    commands: qualityCommands(),
  }], { projectIndex: true });
  const metadataIdRunner = fakeRunner({ revisionValue: pinned });
  const metadataIdSummary = await runSuite({
    manifestPath: metadataIdManifest,
    repoRoot,
    revision: pinned,
    outputRoot: path.join(tmp, 'metadata-id-output'),
    archifyCli,
    commandRunner: metadataIdRunner,
  });
  assert.equal(metadataIdSummary.status, 'automated-failure');
  const metadataIdTiming = JSON.parse(fs.readFileSync(metadataIdSummary.diagrams[0].timing, 'utf8'));
  assert.match(metadataIdTiming.finalReceipt.error.message, /required candidate ID "metadata-only"/);
  assert.equal(metadataIdRunner.requests.filter((request) => request.kind === 'deliver').length, 0);

  const coverageMutationCandidateName = 'workflow-coverage-mutation.json';
  const coverageMutationCandidatePath = path.join(tmp, coverageMutationCandidateName);
  fs.copyFileSync(candidatePath, coverageMutationCandidatePath);
  const coverageMutationManifest = writeManifest(tmp, [{
    type: 'workflow',
    candidate: coverageMutationCandidateName,
    evidenceLedger: path.basename(ledgerPath),
    ...semanticContract,
    commands: qualityCommands(),
  }], { projectIndex: true });
  const coverageMutationBase = fakeRunner({ revisionValue: pinned });
  const coverageMutationRunner = async (request) => {
    if (request.kind === 'deliver') {
      const changed = JSON.parse(fs.readFileSync(coverageMutationCandidatePath, 'utf8'));
      changed.nodes[0].label = 'Export answer';
      fs.writeFileSync(coverageMutationCandidatePath, JSON.stringify(changed));
    }
    return coverageMutationBase(request);
  };
  const coverageMutationSummary = await runSuite({
    manifestPath: coverageMutationManifest,
    repoRoot,
    revision: pinned,
    outputRoot: path.join(tmp, 'coverage-mutation-output'),
    archifyCli,
    commandRunner: coverageMutationRunner,
  });
  assert.equal(coverageMutationSummary.status, 'automated-failure');
  const coverageMutationTiming = JSON.parse(fs.readFileSync(coverageMutationSummary.diagrams[0].timing, 'utf8'));
  assert.match(coverageMutationTiming.finalReceipt.error.message, /deliver specification digest does not match semantic coverage candidate/);

  const frozenTamperCandidateName = 'workflow-frozen-ledger-tamper.json';
  const frozenTamperCandidatePath = path.join(tmp, frozenTamperCandidateName);
  fs.copyFileSync(candidatePath, frozenTamperCandidatePath);
  const frozenTamperOutput = path.join(tmp, 'frozen-tamper-output');
  const frozenTamperManifest = writeManifest(tmp, [{
    type: 'workflow',
    candidate: frozenTamperCandidateName,
    evidenceLedger: path.basename(ledgerPath),
    ...semanticContract,
    commands: qualityCommands(),
  }], { projectIndex: true });
  const frozenTamperBase = fakeRunner({ revisionValue: pinned });
  const frozenTamperRunner = async (request) => {
    if (request.kind === 'visual-check-batch') {
      tamperFrozenLedger(frozenTamperOutput);
    }
    return frozenTamperBase(request);
  };
  const frozenTamperSummary = await runSuite({
    manifestPath: frozenTamperManifest,
    repoRoot,
    revision: pinned,
    outputRoot: frozenTamperOutput,
    archifyCli,
    commandRunner: frozenTamperRunner,
  });
  assert.equal(frozenTamperSummary.status, 'automated-failure');
  const frozenTamperTiming = JSON.parse(fs.readFileSync(frozenTamperSummary.diagrams[0].timing, 'utf8'));
  assert.match(frozenTamperTiming.finalReceipt.error.message, /verified evidence ledger changed before final receipt/);
  assert.equal(Object.hasOwn(frozenTamperTiming.finalReceipt, 'evidenceLedger'), false);
  assert.equal(Object.hasOwn(frozenTamperTiming.finalReceipt, 'semanticCoverage'), false);

  const combinedFailureCandidateName = 'workflow-combined-failure.json';
  fs.copyFileSync(candidatePath, path.join(tmp, combinedFailureCandidateName));
  const combinedFailureOutput = path.join(tmp, 'combined-failure-output');
  const combinedFailureManifest = writeManifest(tmp, [{
    type: 'workflow',
    candidate: combinedFailureCandidateName,
    evidenceLedger: path.basename(ledgerPath),
    ...semanticContract,
    commands: qualityCommands(),
  }], { projectIndex: true });
  const combinedFailureBase = fakeRunner({ revisionValue: pinned });
  const combinedFailureRunner = async (request) => {
    if (request.kind !== 'visual-check-batch') return combinedFailureBase(request);
    tamperFrozenLedger(combinedFailureOutput);
    const result = await combinedFailureBase(request);
    const receipt = JSON.parse(result.stdout);
    receipt.artifacts[0].state.detail = 'map';
    return jsonResult(receipt);
  };
  const combinedFailureSummary = await runSuite({
    manifestPath: combinedFailureManifest,
    repoRoot,
    revision: pinned,
    outputRoot: combinedFailureOutput,
    archifyCli,
    commandRunner: combinedFailureRunner,
  });
  assert.equal(combinedFailureSummary.status, 'automated-failure');
  const combinedFailureTiming = JSON.parse(fs.readFileSync(combinedFailureSummary.diagrams[0].timing, 'utf8'));
  assert.match(combinedFailureTiming.finalReceipt.error.message, /READ detail and Still motion state/);
  assert.equal(Object.hasOwn(combinedFailureTiming.finalReceipt, 'evidenceLedger'), false);
  assert.equal(Object.hasOwn(combinedFailureTiming.finalReceipt, 'semanticCoverage'), false);

  const multiDeliveryCandidateName = 'workflow-multi-delivery.json';
  fs.copyFileSync(candidatePath, path.join(tmp, multiDeliveryCandidateName));
  const multiDeliveryLedgerPath = path.join(tmp, 'multi-delivery.evidence-ledger.json');
  fs.copyFileSync(ledgerPath, multiDeliveryLedgerPath);
  const multiDeliveryOutput = path.join(tmp, 'multi-delivery-output');
  const multiDeliveryManifest = writeManifest(tmp, [{
    type: 'workflow',
    candidate: multiDeliveryCandidateName,
    evidenceLedger: path.basename(multiDeliveryLedgerPath),
    ...semanticContract,
    commands: [
      { id: 'validate-first', kind: 'validate' },
      { id: 'deliver-first', kind: 'deliver' },
      { id: 'validate-second', kind: 'validate' },
      { id: 'deliver-second', kind: 'deliver' },
      { id: 'visual', kind: 'visual-check' },
    ],
  }], { projectIndex: true });
  const replacementLedger = createEvidenceLedger(index, [{
    claimId: 'answer-export',
    path: 'index.js',
    line: 1,
    summary: 'The answer export remains available.',
  }]);
  const multiDeliveryBase = fakeRunner({ revisionValue: pinned });
  const multiDeliveryRunner = async (request) => {
    if (request.id === 'validate-second') {
      const replacementBytes = JSON.stringify(replacementLedger);
      fs.writeFileSync(multiDeliveryLedgerPath, replacementBytes);
      fs.writeFileSync(
        path.join(multiDeliveryOutput, 'workflow', 'evidence-ledger.verified.json'),
        replacementBytes,
      );
    }
    return multiDeliveryBase(request);
  };
  const multiDeliverySummary = await runSuite({
    manifestPath: multiDeliveryManifest,
    repoRoot,
    revision: pinned,
    outputRoot: multiDeliveryOutput,
    archifyCli,
    commandRunner: multiDeliveryRunner,
  });
  assert.equal(multiDeliverySummary.status, 'automated-failure');
  const multiDeliveryTiming = JSON.parse(fs.readFileSync(multiDeliverySummary.diagrams[0].timing, 'utf8'));
  assert.match(multiDeliveryTiming.finalReceipt.error.message, /verified evidence ledger changed before final receipt/);
  assert.equal(multiDeliveryBase.requests.filter((request) => request.id === 'deliver-second').length, 0);
});
