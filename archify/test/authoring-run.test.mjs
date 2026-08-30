import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AuthoringRun,
  finalizeAuthoringRun,
  startAuthoringRun,
} from '../authoring/authoring-run.mjs';
import {
  buildProjectIndex,
  createEvidenceLedger,
} from '../evidence/project-index.mjs';
import {
  QUALITY_CONTRACT,
  QUALITY_CONTRACT_DIGEST,
  qualityContractIdentity,
} from '../authoring/quality-contract.mjs';
import { renderAuthoringReport } from '../orchestration/report.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

function fakeClock() {
  let now = 0;
  return {
    monotonicMs: () => now,
    wallMs: () => Date.parse('2026-08-29T00:00:00.000Z'),
    advance(milliseconds) {
      now += milliseconds;
    },
  };
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function git(repoRoot, args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function evidenceFixture(root) {
  const repoRoot = path.join(root, 'repository');
  fs.mkdirSync(path.join(repoRoot, 'src'), { recursive: true });
  git(repoRoot, ['init', '-q']);
  git(repoRoot, ['config', 'user.email', 'archify@example.test']);
  git(repoRoot, ['config', 'user.name', 'Archify Test']);
  git(repoRoot, ['remote', 'add', 'origin', 'https://github.com/example/authoring-fixture.git']);
  fs.writeFileSync(path.join(repoRoot, 'src', 'index.ts'), [
    'export const repositoryEntry = true;',
    'export const agentRunner = true;',
    'export const startsRunner = true;',
    '',
  ].join('\n'), 'utf8');
  git(repoRoot, ['add', 'src/index.ts']);
  git(repoRoot, ['commit', '-qm', 'fixture']);
  const revision = git(repoRoot, ['rev-parse', 'HEAD']);
  const projectIndex = buildProjectIndex({ repoRoot, revision });
  const ledger = createEvidenceLedger(projectIndex, [
    {
      claimId: 'entry',
      path: 'src/index.ts',
      line: 1,
      endLine: 1,
      summary: 'Entry point',
    },
    {
      claimId: 'runner',
      path: 'src/index.ts',
      line: 2,
      endLine: 2,
      summary: 'Agent runner',
    },
    {
      claimId: 'entry-starts-runner',
      path: 'src/index.ts',
      line: 3,
      endLine: 3,
      summary: 'Entry starts runner',
    },
  ]);
  const projectIndexPath = path.join(root, 'project-index.json');
  const evidencePath = path.join(root, 'evidence-ledger.json');
  writeJson(projectIndexPath, projectIndex);
  writeJson(evidencePath, ledger);
  return { repoRoot, revision, projectIndexPath, evidencePath, ledger };
}

function semanticRequirementsFixture(root, type = 'workflow') {
  const requirementsPath = path.join(root, `${type}.requirements.json`);
  writeJson(requirementsPath, {
    schemaVersion: 1,
    diagramType: type,
    entities: [
      { key: 'entry', labels: ['Repository Entry'], claimIds: ['entry'] },
      { key: 'runner', labels: ['Agent Runner'], claimIds: ['runner'] },
    ],
    relationships: [
      { from: 'entry', to: 'runner', labels: ['starts'], claimIds: ['entry-starts-runner'] },
    ],
  });
  return requirementsPath;
}

function projectOverviewRequirementsFixture(root, type = 'workflow') {
  const requirementsPath = path.join(root, `${type}.project-overview.requirements.json`);
  const policy = QUALITY_CONTRACT.semanticScope.profiles['project-overview'][type];
  const entities = Array.from({ length: policy.minimumRequiredEntities }, (_, index) => ({
    key: `entity${index + 1}`,
    labels: [`Source entity ${index + 1}`],
    roles: [policy.requiredRoles[index % policy.requiredRoles.length]],
    claimIds: [`entity-claim-${index + 1}`],
  }));
  writeJson(requirementsPath, {
    schemaVersion: QUALITY_CONTRACT.semanticScope.currentRequirementsSchemaVersion,
    diagramType: type,
    scopeProfile: 'project-overview',
    entities,
    relationships: Array.from(
      { length: policy.minimumRequiredRelationships },
      (_, index) => ({
        from: entities[index % entities.length].key,
        to: entities[(index + 1) % entities.length].key,
        labels: [`Source relationship ${index + 1}`],
        claimIds: [`relationship-claim-${index + 1}`],
      }),
    ),
  });
  return requirementsPath;
}

function semanticCandidate(type, title = 'Repository agent flow') {
  const collections = {
    architecture: ['components', 'connections'],
    workflow: ['nodes', 'edges'],
    sequence: ['participants', 'messages'],
    dataflow: ['nodes', 'flows'],
    lifecycle: ['states', 'transitions'],
  }[type];
  return {
    schema_version: 1,
    diagram_type: type,
    meta: { title },
    [collections[0]]: [
      { id: 'candidate-a', type: 'frontend', label: 'Repository Entry' },
      { id: 'candidate-b', type: 'backend', label: 'Agent Runner' },
    ],
    [collections[1]]: [
      { id: 'candidate-edge', from: 'candidate-a', to: 'candidate-b', label: 'starts' },
    ],
  };
}

function passingValidation(candidatePath, type = 'workflow', requiredLanguage) {
  const candidate = fs.readFileSync(candidatePath);
  const artifact = Buffer.from('<!doctype html><title>candidate</title>\n');
  const artifactReceipt = {
    path: path.join(path.dirname(candidatePath), 'ephemeral.html'),
    bytes: artifact.byteLength,
    sha256: createHash('sha256').update(artifact).digest('hex'),
  };
  const viewports = QUALITY_CONTRACT.guards.desktopViewports.map(({ width, height }) => ({
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
  }));
  return {
    schemaVersion: 1,
    command: 'validate',
    type,
    ok: true,
    status: 'pass',
    specification: {
      type,
      bytes: candidate.byteLength,
      sha256: createHash('sha256').update(candidate).digest('hex'),
    },
    artifact: { ...artifactReceipt, ephemeral: true },
    checks: QUALITY_CONTRACT.guards.deterministicCheckNames.map((name) => ({ name, ok: true })),
    composition: { summary: { errors: 0, warnings: 0 }, profile: 'showcase' },
    ...(requiredLanguage ? { authoredLanguage: {
      required: requiredLanguage,
      locale: requiredLanguage,
      inspected: 1,
      proseInspected: 1,
      technicalIdentifiersPreserved: 0,
      violations: 0,
    } } : {}),
    preflight: {
      schemaVersion: 2,
      command: 'visual-preflight',
      ok: true,
      status: 'pass',
      automatedChecks: ['containment'],
      artifact: {
        ...artifactReceipt,
        verification: {
          unchanged: true,
          before: { bytes: artifactReceipt.bytes, sha256: artifactReceipt.sha256 },
          after: { bytes: artifactReceipt.bytes, sha256: artifactReceipt.sha256 },
        },
      },
      state: {
        status: 'pass',
        detail: 'read',
        motion: 'still',
        theme: 'light',
        observations: viewports.map((entry) => ({
          width: entry.width,
          height: entry.height,
          requestedTheme: 'light',
          resolvedTheme: 'light',
          detailLevel: 'read',
          motion: 'still',
          ok: true,
        })),
      },
      containment: { status: 'pass', viewports },
    },
  };
}

test('authoring run: mechanically writes digest-bound handoff, canonical timing, and receipt-derived report', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authoring-run-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const candidatePath = path.join(tmp, 'candidate.json');
  const evidence = evidenceFixture(tmp);
  const evidencePath = evidence.evidencePath;
  const requirementsPath = semanticRequirementsFixture(tmp);
  const validationPath = path.join(tmp, 'validation.json');
  const outputDirectory = path.join(tmp, 'run');
  writeJson(candidatePath, semanticCandidate('workflow', 'Agent loop'));
  writeJson(validationPath, passingValidation(candidatePath));

  const clock = fakeClock();
  const run = AuthoringRun.open({
    run: {
      id: 'pi/workflow',
      diagramType: 'workflow',
      repository: { revision: evidence.revision },
    },
    outputDirectory,
    repoRoot: evidence.repoRoot,
    projectIndexPath: evidence.projectIndexPath,
    requirementsPath,
    clock,
  });
  clock.advance(7);
  await run.stage('candidate-authoring', async () => {
    clock.advance(11);
  });
  clock.advance(5);
  await run.stage('deterministic-validation', async () => {
    clock.advance(13);
  });
  clock.advance(3);

  const completed = run.finalize({ candidatePath, evidencePath, validationPath });
  assert.equal(completed.timing.durationMs, 39);
  assert.equal(
    Date.parse(completed.timing.endedAt) - Date.parse(completed.timing.startedAt),
    completed.timing.durationMs,
  );
  assert.equal(completed.timing.accounting.stagedMs, 24);
  assert.equal(completed.timing.accounting.agentOverheadMs, 15);
  assert.deepEqual(
    completed.timing.stages.map((stage) => stage.durationMs),
    completed.timing.stages.map((stage) => stage.endOffsetMs - stage.startOffsetMs),
  );

  assert.equal(completed.handoff.kind, 'archify.authoring-handoff');
  assert.equal(completed.handoff.status, 'ready');
  assert.equal(completed.handoff.contract.quality.sha256, QUALITY_CONTRACT_DIGEST);
  assert.deepEqual(completed.handoff.contract, qualityContractIdentity({ skillRoot }));
  assert.equal(completed.handoff.candidate.sha256, sha256(candidatePath));
  assert.equal(completed.handoff.evidence.sha256, sha256(evidencePath));
  assert.equal(completed.handoff.evidence.ledgerDigest, evidence.ledger.ledgerDigest);
  assert.equal(completed.handoff.evidence.factCount, 3);
  assert.equal(completed.handoff.evidence.verification.verified, true);
  assert.equal(completed.handoff.validation.sha256, sha256(validationPath));
  assert.equal(completed.handoff.validation.checksPassed, 9);
  assert.equal(completed.handoff.validation.checksTotal, 9);
  const { digest, ...handoffBody } = completed.handoff;
  assert.equal(digest, createHash('sha256').update(JSON.stringify(handoffBody)).digest('hex'));
  assert.deepEqual(completed.timing.finalReceipt, completed.handoff);
  assert.deepEqual(JSON.parse(fs.readFileSync(completed.paths.handoffPath, 'utf8')), completed.handoff);
  assert.deepEqual(JSON.parse(fs.readFileSync(completed.paths.timingPath, 'utf8')), completed.timing);

  assert.match(completed.report.markdown, /Generated mechanically from canonical timing and handoff receipts/);
  assert.match(completed.report.markdown, /Agent overhead: 0\.015s/);
  assert.match(completed.report.markdown, /Semantic scope: `focused`/);
  assert.match(completed.report.markdown, /Semantic density: 2 entities \/ 1 relationships/);
  assert.match(completed.report.markdown, /Evidence breadth: 1 source files \(minimum 1\)/);
  assert.match(completed.report.markdown, /Authored language: `not-required`/);
  assert.match(completed.report.markdown, new RegExp(completed.handoff.contract.runtime.sha256));
  assert.match(completed.report.markdown, new RegExp(sha256(candidatePath)));
  assert.equal(fs.readFileSync(completed.paths.reportPath, 'utf8'), completed.report.markdown);
  assert.deepEqual(
    renderAuthoringReport({ timing: completed.timing, outputRoot: outputDirectory }),
    completed.report,
  );
});

test('authoring run: binds semantic requirements by labels and verified evidence claims', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authoring-run-semantic-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const evidence = evidenceFixture(tmp);
  const requirementsPath = semanticRequirementsFixture(tmp);
  const candidatePath = path.join(tmp, 'candidate.json');
  const validationPath = path.join(tmp, 'validation.json');
  writeJson(candidatePath, {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Repository agent flow' },
    nodes: [
      { id: 'candidate-a', type: 'frontend', label: 'Repository Entry' },
      { id: 'candidate-b', type: 'backend', label: 'Agent Runner' },
    ],
    edges: [{ id: 'candidate-edge', from: 'candidate-a', to: 'candidate-b', label: 'starts' }],
  });
  writeJson(validationPath, passingValidation(candidatePath));
  const run = AuthoringRun.open({
    run: { id: 'project/workflow', diagramType: 'workflow' },
    outputDirectory: path.join(tmp, 'run'),
    repoRoot: evidence.repoRoot,
    projectIndexPath: evidence.projectIndexPath,
    requirementsPath,
    clock: fakeClock(),
  });

  const completed = run.finalize({
    candidatePath,
    evidencePath: evidence.evidencePath,
    validationPath,
  });
  assert.equal(completed.handoff.semanticRequirements.status, 'covered');
  assert.deepEqual(completed.handoff.semanticRequirements.bindings, {
    entry: 'candidate-a',
    runner: 'candidate-b',
  });
  assert.equal(completed.handoff.semanticRequirements.requirementsCovered, 3);
  assert.equal(completed.handoff.semanticRequirements.requirementsTotal, 3);
  assert.deepEqual(completed.handoff.semanticRequirements.verifiedClaimIds, [
    'entry',
    'runner',
    'entry-starts-runner',
  ]);

  const missingRelationshipRoot = path.join(tmp, 'missing-relationship');
  const missingCandidatePath = path.join(tmp, 'candidate-missing.json');
  const missingValidationPath = path.join(tmp, 'validation-missing.json');
  writeJson(missingCandidatePath, {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Incomplete repository agent flow' },
    nodes: [
      { id: 'candidate-a', type: 'frontend', label: 'Repository Entry' },
      { id: 'candidate-b', type: 'backend', label: 'Agent Runner' },
    ],
    edges: [],
  });
  writeJson(missingValidationPath, passingValidation(missingCandidatePath));
  const missingRun = AuthoringRun.open({
    run: { id: 'project/workflow-missing', diagramType: 'workflow' },
    outputDirectory: missingRelationshipRoot,
    repoRoot: evidence.repoRoot,
    projectIndexPath: evidence.projectIndexPath,
    requirementsPath,
    clock: fakeClock(),
  });
  assert.throws(
    () => missingRun.finalize({
      candidatePath: missingCandidatePath,
      evidencePath: evidence.evidencePath,
      validationPath: missingValidationPath,
    }),
    /semantic\/missing-relationship.*entry.*runner/i,
  );
});

test('authoring run: refuses semantic requirements that recycle one claim for the whole topology', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authoring-run-weak-claims-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const evidence = evidenceFixture(tmp);
  const requirementsPath = semanticRequirementsFixture(tmp);
  const weakRequirements = JSON.parse(fs.readFileSync(requirementsPath, 'utf8'));
  weakRequirements.entities.forEach((entity) => { entity.claimIds = ['entry']; });
  weakRequirements.relationships.forEach((relationship) => { relationship.claimIds = ['entry']; });
  writeJson(requirementsPath, weakRequirements);

  assert.throws(
    () => AuthoringRun.open({
      run: { id: 'project/weak-claims', diagramType: 'workflow' },
      outputDirectory: path.join(tmp, 'run'),
      repoRoot: evidence.repoRoot,
      projectIndexPath: evidence.projectIndexPath,
      requirementsPath,
      clock: fakeClock(),
    }),
    /at least 3 unique.*claim/i,
  );
});

test('authoring run: refuses a legacy envelope with no bound semantic requirements', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authoring-run-legacy-envelope-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const evidence = evidenceFixture(tmp);
  const requirementsPath = semanticRequirementsFixture(tmp);
  const candidatePath = path.join(tmp, 'candidate.json');
  const validationPath = path.join(tmp, 'validation.json');
  const outputDirectory = path.join(tmp, 'run');
  const clock = fakeClock();
  const started = startAuthoringRun({
    run: { id: 'project/legacy-workflow', diagramType: 'workflow', scopeProfile: 'focused' },
    outputDirectory,
    repoRoot: evidence.repoRoot,
    projectIndexPath: evidence.projectIndexPath,
    requirementsPath,
    candidatePath,
    expectContract: QUALITY_CONTRACT_DIGEST,
    clock,
  });
  writeJson(candidatePath, semanticCandidate('workflow'));
  writeJson(validationPath, passingValidation(candidatePath));
  const legacyEnvelope = JSON.parse(fs.readFileSync(started.paths.envelopePath, 'utf8'));
  delete legacyEnvelope.requirementsBinding;
  delete legacyEnvelope.digest;
  legacyEnvelope.digest = createHash('sha256')
    .update(JSON.stringify(legacyEnvelope))
    .digest('hex');
  writeJson(started.paths.envelopePath, legacyEnvelope);
  clock.advance(10);

  assert.throws(
    () => finalizeAuthoringRun({
      envelopePath: started.paths.envelopePath,
      candidatePath,
      evidencePath: evidence.evidencePath,
      validationPath,
      clock,
    }),
    /missing.*semantic requirements binding/i,
  );
  assert.equal(fs.existsSync(path.join(outputDirectory, 'handoff.json')), false);
});

test('authoring run: refuses an incomplete quality receipt without producing a ready handoff', async (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authoring-run-failed-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const candidatePath = path.join(tmp, 'candidate.json');
  const evidence = evidenceFixture(tmp);
  const evidencePath = evidence.evidencePath;
  const requirementsPath = semanticRequirementsFixture(tmp, 'sequence');
  const validationPath = path.join(tmp, 'validation.json');
  writeJson(candidatePath, semanticCandidate('sequence'));
  writeJson(validationPath, {
    command: 'validate',
    ok: true,
    status: 'pass',
    checks: Array.from({ length: 8 }, (_, index) => ({ id: `check-${index + 1}`, ok: true })),
    composition: { summary: { errors: 0, warnings: 0 }, profile: 'showcase' },
  });
  const outputDirectory = path.join(tmp, 'run');
  const run = AuthoringRun.open({
    run: { id: 'pi/sequence', diagramType: 'sequence' },
    outputDirectory,
    repoRoot: evidence.repoRoot,
    projectIndexPath: evidence.projectIndexPath,
    requirementsPath,
    clock: fakeClock(),
  });

  assert.throws(
    () => run.finalize({ candidatePath, evidencePath, validationPath }),
    /exactly 9 passing checks/,
  );
  assert.equal(fs.existsSync(path.join(outputDirectory, 'handoff.json')), false);
  assert.equal(fs.existsSync(path.join(outputDirectory, 'authoring-report.md')), false);
  assert.equal(fs.existsSync(path.join(outputDirectory, 'timing.json')), false);

  writeJson(validationPath, passingValidation(candidatePath, 'sequence'));
  const recovered = run.finalize({ candidatePath, evidencePath, validationPath });
  assert.equal(recovered.handoff.status, 'ready');
});

test('authoring run: refuses a passing receipt after the candidate bytes or diagram type change', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authoring-run-binding-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const candidatePath = path.join(tmp, 'candidate.json');
  const evidence = evidenceFixture(tmp);
  const evidencePath = evidence.evidencePath;
  const requirementsPath = semanticRequirementsFixture(tmp);
  const validationPath = path.join(tmp, 'validation.json');
  writeJson(candidatePath, semanticCandidate('workflow', 'A'));
  writeJson(validationPath, passingValidation(candidatePath));
  writeJson(candidatePath, semanticCandidate('workflow', 'B'));
  const run = AuthoringRun.open({
    run: { id: 'pi/workflow', diagramType: 'workflow' },
    outputDirectory: path.join(tmp, 'run'),
    repoRoot: evidence.repoRoot,
    projectIndexPath: evidence.projectIndexPath,
    requirementsPath,
    clock: fakeClock(),
  });

  assert.throws(
    () => run.finalize({ candidatePath, evidencePath, validationPath }),
    /validation specification does not match the current candidate bytes/,
  );

  writeJson(validationPath, passingValidation(candidatePath, 'sequence'));
  assert.throws(
    () => run.finalize({ candidatePath, evidencePath, validationPath }),
    /validation diagram type does not match the authoring run/,
  );
});

test('authoring run: refuses modified evidence or a changed bound ProjectIndex', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authoring-run-evidence-binding-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const evidence = evidenceFixture(tmp);
  const requirementsPath = semanticRequirementsFixture(tmp);
  const candidatePath = path.join(tmp, 'candidate.json');
  const validationPath = path.join(tmp, 'validation.json');
  writeJson(candidatePath, semanticCandidate('workflow'));
  writeJson(validationPath, passingValidation(candidatePath));

  const ledger = JSON.parse(fs.readFileSync(evidence.evidencePath, 'utf8'));
  ledger.facts[0].summary = 'modified after creation';
  writeJson(evidence.evidencePath, ledger);
  const run = AuthoringRun.open({
    run: { id: 'pi/workflow', diagramType: 'workflow' },
    outputDirectory: path.join(tmp, 'run'),
    repoRoot: evidence.repoRoot,
    projectIndexPath: evidence.projectIndexPath,
    requirementsPath,
    clock: fakeClock(),
  });
  assert.throws(
    () => run.finalize({
      candidatePath,
      evidencePath: evidence.evidencePath,
      validationPath,
    }),
    /ledger digest does not match/,
  );

  writeJson(evidence.evidencePath, evidence.ledger);
  const projectIndex = JSON.parse(fs.readFileSync(evidence.projectIndexPath, 'utf8'));
  projectIndex.generatedAt = 'changed';
  writeJson(evidence.projectIndexPath, projectIndex);
  assert.throws(
    () => run.finalize({
      candidatePath,
      evidencePath: evidence.evidencePath,
      validationPath,
    }),
    /project index no longer matches/,
  );
});

test('authoring run: refuses a repository candidate that clones the bundled example topology', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authoring-run-example-clone-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const evidence = evidenceFixture(tmp);
  const requirementsPath = semanticRequirementsFixture(tmp);
  const candidatePath = path.join(tmp, 'candidate.json');
  const validationPath = path.join(tmp, 'validation.json');
  const candidate = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json'),
    'utf8',
  ));
  const renamedIds = new Map();
  const collectIds = (value) => {
    if (Array.isArray(value)) value.forEach(collectIds);
    else if (value && typeof value === 'object') {
      if (typeof value.id === 'string') renamedIds.set(value.id, `cloned-${renamedIds.size + 1}`);
      Object.values(value).forEach(collectIds);
    }
  };
  const referenceFields = new Set(['id', 'from', 'to', 'lane', 'phase', 'group']);
  const referenceArrays = new Set(['mainPath', 'focus']);
  const rename = (value, field = null) => {
    if (Array.isArray(value)) return value.map((entry) => rename(entry, field));
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rename(entry, key)]));
    }
    return typeof value === 'string'
      && (referenceFields.has(field) || referenceArrays.has(field))
      && renamedIds.has(value)
      ? renamedIds.get(value)
      : value;
  };
  collectIds(candidate);
  writeJson(candidatePath, rename(candidate));
  writeJson(validationPath, passingValidation(candidatePath));
  const run = AuthoringRun.open({
    run: { id: 'project/workflow', diagramType: 'workflow' },
    outputDirectory: path.join(tmp, 'run'),
    repoRoot: evidence.repoRoot,
    projectIndexPath: evidence.projectIndexPath,
    requirementsPath,
    clock: fakeClock(),
  });

  assert.throws(
    () => run.finalize({
      candidatePath,
      evidencePath: evidence.evidencePath,
      validationPath,
    }),
    /content\/example-contamination.*100%/i,
  );
  assert.equal(fs.existsSync(path.join(tmp, 'run', 'timing.json')), false);
  assert.equal(fs.existsSync(path.join(tmp, 'run', 'handoff.json')), false);
});

test('authoring run: refuses repeated low-information placeholder content', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authoring-run-placeholder-content-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const evidence = evidenceFixture(tmp);
  const requirementsPath = semanticRequirementsFixture(tmp);
  const candidatePath = path.join(tmp, 'candidate.json');
  const validationPath = path.join(tmp, 'validation.json');
  writeJson(candidatePath, {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Maka 模块视图' },
    nodes: Array.from({ length: 6 }, (_, index) => ({
      id: `placeholder${index + 1}`,
      type: 'backend',
      label: 'Maka 模块',
      sublabel: 'Maka 服务层',
    })),
    edges: [],
    cards: [{ dot: 'cyan', title: 'Maka 模块视图', items: ['Maka 核心能力', 'Maka 核心能力', 'Maka 核心能力'] }],
  });
  writeJson(validationPath, passingValidation(candidatePath));
  const run = AuthoringRun.open({
    run: { id: 'project/workflow', diagramType: 'workflow' },
    outputDirectory: path.join(tmp, 'run'),
    repoRoot: evidence.repoRoot,
    projectIndexPath: evidence.projectIndexPath,
    requirementsPath,
    clock: fakeClock(),
  });

  assert.throws(
    () => run.finalize({
      candidatePath,
      evidencePath: evidence.evidencePath,
      validationPath,
    }),
    /content\/low-information-repetition.*Maka 模块/i,
  );
});

test('authoring run: refuses a title that explicitly names a different diagram type', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authoring-run-title-type-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const evidence = evidenceFixture(tmp);
  const requirementsPath = semanticRequirementsFixture(tmp, 'sequence');
  const candidatePath = path.join(tmp, 'candidate.json');
  const validationPath = path.join(tmp, 'validation.json');
  writeJson(candidatePath, semanticCandidate('sequence', 'MaxKB 架构视图'));
  writeJson(validationPath, passingValidation(candidatePath, 'sequence'));
  const run = AuthoringRun.open({
    run: { id: 'project/sequence', diagramType: 'sequence' },
    outputDirectory: path.join(tmp, 'run'),
    repoRoot: evidence.repoRoot,
    projectIndexPath: evidence.projectIndexPath,
    requirementsPath,
    clock: fakeClock(),
  });

  assert.throws(
    () => run.finalize({
      candidatePath,
      evidencePath: evidence.evidencePath,
      validationPath,
    }),
    /content\/diagram-type-title.*architecture.*sequence/i,
  );
});

test('authoring run: candidate freshness and path binding reject stale or substituted files', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authoring-run-freshness-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const evidence = evidenceFixture(tmp);
  const requirementsPath = semanticRequirementsFixture(tmp);
  const staleCandidatePath = path.join(tmp, 'stale-candidate.json');
  writeJson(staleCandidatePath, semanticCandidate('workflow'));

  assert.throws(
    () => startAuthoringRun({
      run: { id: 'project/stale-workflow', diagramType: 'workflow', scopeProfile: 'focused' },
      outputDirectory: path.join(tmp, 'stale-run'),
      repoRoot: evidence.repoRoot,
      projectIndexPath: evidence.projectIndexPath,
      requirementsPath,
      candidatePath: staleCandidatePath,
      expectContract: QUALITY_CONTRACT_DIGEST,
      clock: fakeClock(),
    }),
    (error) => error.code === 'authoring-run/candidate-not-fresh',
  );

  const expectedCandidatePath = path.join(tmp, 'expected-candidate.json');
  const substitutedCandidatePath = path.join(tmp, 'substituted-candidate.json');
  const validationPath = path.join(tmp, 'validation.json');
  const started = startAuthoringRun({
    run: { id: 'project/substituted-workflow', diagramType: 'workflow', scopeProfile: 'focused' },
    outputDirectory: path.join(tmp, 'substituted-run'),
    repoRoot: evidence.repoRoot,
    projectIndexPath: evidence.projectIndexPath,
    requirementsPath,
    candidatePath: expectedCandidatePath,
    expectContract: QUALITY_CONTRACT_DIGEST,
    clock: fakeClock(),
  });
  writeJson(substitutedCandidatePath, semanticCandidate('workflow'));
  writeJson(validationPath, passingValidation(substitutedCandidatePath));
  assert.throws(
    () => finalizeAuthoringRun({
      envelopePath: started.paths.envelopePath,
      candidatePath: substitutedCandidatePath,
      evidencePath: evidence.evidencePath,
      validationPath,
      clock: fakeClock(),
    }),
    (error) => error.code === 'authoring-run/candidate-path-mismatch',
  );
});

test('authoring run: project-overview requires explicit scope, language, and candidate binding', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authoring-run-overview-contract-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const evidence = evidenceFixture(tmp);
  const focusedRequirementsPath = semanticRequirementsFixture(tmp);
  const overviewRequirementsPath = projectOverviewRequirementsFixture(tmp);

  assert.throws(
    () => AuthoringRun.open({
      run: { id: 'project/scope-mismatch', diagramType: 'workflow', scopeProfile: 'project-overview', requiredLanguage: 'zh-CN' },
      outputDirectory: path.join(tmp, 'scope-mismatch-run'),
      repoRoot: evidence.repoRoot,
      projectIndexPath: evidence.projectIndexPath,
      requirementsPath: focusedRequirementsPath,
      candidatePath: path.join(tmp, 'scope-mismatch.json'),
      clock: fakeClock(),
    }),
    (error) => error.code === 'semantic/scope-mismatch',
  );
  assert.throws(
    () => AuthoringRun.open({
      run: { id: 'project/no-language', diagramType: 'workflow', scopeProfile: 'project-overview' },
      outputDirectory: path.join(tmp, 'no-language-run'),
      repoRoot: evidence.repoRoot,
      projectIndexPath: evidence.projectIndexPath,
      requirementsPath: overviewRequirementsPath,
      candidatePath: path.join(tmp, 'no-language.json'),
      clock: fakeClock(),
    }),
    (error) => error.code === 'content/authored-language-required',
  );
  assert.throws(
    () => AuthoringRun.open({
      run: { id: 'project/no-candidate', diagramType: 'workflow', scopeProfile: 'project-overview', requiredLanguage: 'zh-CN' },
      outputDirectory: path.join(tmp, 'no-candidate-run'),
      repoRoot: evidence.repoRoot,
      projectIndexPath: evidence.projectIndexPath,
      requirementsPath: overviewRequirementsPath,
      clock: fakeClock(),
    }),
    (error) => error.code === 'authoring-run/candidate-binding-required',
  );
});

test('authoring run: finalize rejects a modified bound contract identity', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authoring-run-contract-drift-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const evidence = evidenceFixture(tmp);
  const started = startAuthoringRun({
    run: { id: 'project/contract-drift', diagramType: 'workflow', scopeProfile: 'focused' },
    outputDirectory: path.join(tmp, 'run'),
    repoRoot: evidence.repoRoot,
    projectIndexPath: evidence.projectIndexPath,
    requirementsPath: semanticRequirementsFixture(tmp),
    candidatePath: path.join(tmp, 'candidate.json'),
    expectContract: QUALITY_CONTRACT_DIGEST,
    clock: fakeClock(),
  });
  const envelope = JSON.parse(fs.readFileSync(started.paths.envelopePath, 'utf8'));
  envelope.contract.runtime.sha256 = '0'.repeat(64);
  delete envelope.digest;
  envelope.digest = createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
  writeJson(started.paths.envelopePath, envelope);

  assert.throws(
    () => finalizeAuthoringRun({
      envelopePath: started.paths.envelopePath,
      candidatePath: path.join(tmp, 'candidate.json'),
      evidencePath: evidence.evidencePath,
      validationPath: path.join(tmp, 'validation.json'),
      clock: fakeClock(),
    }),
    (error) => error.code === 'authoring-run/contract-drift'
      && Array.isArray(error.archifyDiagnostics)
      && error.archifyDiagnostics[0].supportedFixes.length > 0,
  );
});

test('authoring-run CLI preserves structured semantic diagnostics', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authoring-run-cli-diagnostics-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const evidence = evidenceFixture(tmp);
  const result = spawnSync(process.execPath, [
    cli,
    'authoring-run',
    'start',
    'workflow',
    '--run-id', 'project/scope-mismatch',
    '--output', path.join(tmp, 'run'),
    '--repo-root', evidence.repoRoot,
    '--project-index', evidence.projectIndexPath,
    '--requirements', semanticRequirementsFixture(tmp),
    '--candidate', path.join(tmp, 'candidate.json'),
    '--scope-profile', 'project-overview',
    '--expect-contract', QUALITY_CONTRACT_DIGEST,
    '--require-authored-language', 'zh-CN',
    '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.diagnostics[0].code, 'semantic/scope-mismatch');
  assert.equal(receipt.diagnostics[0].subject.diagramType, 'workflow');
  assert.deepEqual(receipt.diagnostics[0].evidence, {
    required: 'project-overview',
    actual: 'focused',
  });
  assert.ok(receipt.diagnostics[0].supportedFixes.length > 0);
});

test('authoring-run CLI measures a durable envelope and mechanically finalizes receipts', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authoring-run-cli-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const outputDirectory = path.join(tmp, 'run');
  const candidatePath = path.join(tmp, 'candidate.json');
  const evidence = evidenceFixture(tmp);
  const evidencePath = evidence.evidencePath;
  const requirementsPath = semanticRequirementsFixture(tmp);
  const validationPath = path.join(tmp, 'validation.json');
  const forgedTiming = spawnSync(process.execPath, [
    cli,
    'authoring-run',
    'start',
    'workflow',
    '--run-id', 'pi/forged',
    '--output', path.join(tmp, 'forged-run'),
    '--duration-ms', '999999',
    '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(forgedTiming.status, 2);
  assert.match(forgedTiming.stderr, /Unknown authoring-run start option "--duration-ms"/);
  assert.equal(fs.existsSync(path.join(tmp, 'forged-run', 'authoring-run.json')), false);

  const missingRequirements = spawnSync(process.execPath, [
    cli,
    'authoring-run',
    'start',
    'workflow',
    '--run-id', 'pi/missing-requirements',
    '--output', path.join(tmp, 'missing-requirements-run'),
    '--repo-root', evidence.repoRoot,
    '--project-index', evidence.projectIndexPath,
    '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(missingRequirements.status, 2);
  assert.match(missingRequirements.stderr, /--requirements/);
  assert.equal(fs.existsSync(path.join(tmp, 'missing-requirements-run', 'authoring-run.json')), false);

  const started = spawnSync(process.execPath, [
    cli,
    'authoring-run',
    'start',
    'workflow',
    '--run-id', 'pi/workflow',
    '--output', outputDirectory,
    '--repo-root', evidence.repoRoot,
    '--project-index', evidence.projectIndexPath,
    '--requirements', requirementsPath,
    '--candidate', candidatePath,
    '--scope-profile', 'focused',
    '--expect-contract', QUALITY_CONTRACT_DIGEST,
    '--require-authored-language', 'zh-CN',
    '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(started.status, 0, started.stderr);
  const startReceipt = JSON.parse(started.stdout);
  assert.equal(startReceipt.command, 'authoring-run-start');
  assert.equal(startReceipt.status, 'started');
  assert.equal(startReceipt.envelope.kind, 'archify.authoring-run-envelope');
  assert.equal(startReceipt.envelope.run.id, 'pi/workflow');
  assert.equal(startReceipt.envelope.run.diagramType, 'workflow');
  assert.equal(startReceipt.envelope.run.requiredLanguage, 'zh-CN');
  assert.match(startReceipt.envelope.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(startReceipt.paths.envelopePath, 'utf8')),
    startReceipt.envelope,
  );
  assert.equal(fs.existsSync(path.join(outputDirectory, 'timing.json')), false);
  assert.equal(fs.existsSync(path.join(outputDirectory, 'authoring-report.md')), false);
  assert.equal(startReceipt.envelope.run.scopeProfile, 'focused');
  assert.equal(startReceipt.envelope.candidateBinding.path, candidatePath);
  assert.equal(startReceipt.envelope.contract.quality.sha256, QUALITY_CONTRACT_DIGEST);
  assert.match(startReceipt.envelope.contract.runtime.sha256, /^[a-f0-9]{64}$/);

  writeJson(candidatePath, semanticCandidate('workflow', 'Measured run'));
  writeJson(validationPath, passingValidation(candidatePath, 'workflow', 'zh-CN'));

  const finalized = spawnSync(process.execPath, [
    cli,
    'authoring-run',
    'finalize',
    startReceipt.paths.envelopePath,
    '--candidate', candidatePath,
    '--evidence', evidencePath,
    '--validation', validationPath,
    '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(finalized.status, 0, finalized.stderr);
  const finalReceipt = JSON.parse(finalized.stdout);
  assert.equal(finalReceipt.command, 'authoring-run-finalize');
  assert.equal(finalReceipt.status, 'ready');
  assert.equal(finalReceipt.handoff.repository.revision, evidence.revision);
  assert.equal(finalReceipt.handoff.candidate.sha256, sha256(candidatePath));
  assert.equal(finalReceipt.handoff.validation.authoredLanguage.required, 'zh-CN');
  assert.equal(finalReceipt.timing.kind, 'archify.run-timing');
  assert.equal(finalReceipt.timing.run.measurementDomain, 'agent-authoring');
  assert.equal(finalReceipt.timing.run.repository.revision, evidence.revision);
  assert.equal(finalReceipt.timing.run.repository.indexDigest, evidence.ledger.repository.indexDigest);
  assert.equal(finalReceipt.timing.accounting.durationSource, 'monotonic-envelope-endpoints');
  assert.equal(finalReceipt.timing.durationMs,
    Date.parse(finalReceipt.timing.endedAt) - Date.parse(finalReceipt.timing.startedAt));
  assert.deepEqual(finalReceipt.timing.stages, []);
  assert.equal(finalReceipt.timing.accounting.agentOverheadMs, finalReceipt.timing.durationMs);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(finalReceipt.paths.timingPath, 'utf8')),
    finalReceipt.timing,
  );
  assert.deepEqual(
    JSON.parse(fs.readFileSync(finalReceipt.paths.handoffPath, 'utf8')),
    finalReceipt.handoff,
  );
  assert.match(
    fs.readFileSync(finalReceipt.paths.reportPath, 'utf8'),
    /Generated mechanically from canonical timing and handoff receipts/,
  );
});

test('authoring-run CLI terminalizes blocked work with canonical elapsed timing', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-authoring-run-blocked-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const evidence = evidenceFixture(tmp);
  const requirementsPath = semanticRequirementsFixture(tmp);
  const outputDirectory = path.join(tmp, 'run');
  const candidatePath = path.join(tmp, 'blocked-candidate.json');
  const started = spawnSync(process.execPath, [
    cli,
    'authoring-run',
    'start',
    'workflow',
    '--run-id', 'pi/workflow-blocked',
    '--output', outputDirectory,
    '--repo-root', evidence.repoRoot,
    '--project-index', evidence.projectIndexPath,
    '--requirements', requirementsPath,
    '--candidate', candidatePath,
    '--scope-profile', 'focused',
    '--expect-contract', QUALITY_CONTRACT_DIGEST,
    '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(started.status, 0, started.stderr);
  const startReceipt = JSON.parse(started.stdout);

  const stopped = spawnSync(process.execPath, [
    cli,
    'authoring-run',
    'stop',
    startReceipt.paths.envelopePath,
    '--status', 'blocked',
    '--reason', 'quality-gate-exhausted',
    '--json',
  ], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(stopped.status, 0, stopped.stderr);
  const receipt = JSON.parse(stopped.stdout);
  assert.equal(receipt.command, 'authoring-run-stop');
  assert.equal(receipt.status, 'blocked');
  assert.equal(receipt.timing.status, 'blocked');
  assert.equal(receipt.timing.finalReceipt.kind, 'archify.authoring-terminal');
  assert.equal(receipt.timing.finalReceipt.reason, 'quality-gate-exhausted');
  assert.equal(receipt.timing.durationMs,
    Date.parse(receipt.timing.endedAt) - Date.parse(receipt.timing.startedAt));
  assert.equal(fs.existsSync(receipt.paths.handoffPath), false);
  assert.match(fs.readFileSync(receipt.paths.reportPath, 'utf8'), /quality-gate-exhausted/);
  assert.match(fs.readFileSync(receipt.paths.reportPath, 'utf8'), /Contract drift at stop: `not-detected`/);
});
