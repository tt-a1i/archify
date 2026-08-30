import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { runCandidatePreflightBatch } from '../authoring/candidate-preflight.mjs';
import { QUALITY_CONTRACT } from '../authoring/quality-contract.mjs';
import { buildProjectIndex, verifyEvidenceLedger } from '../evidence/project-index.mjs';
import { RunRecorder, recoverRunTiming } from './run-recorder.mjs';
import { renderSuiteReport } from './report.mjs';

const DIAGRAM_TYPES = new Set(['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']);
const COMMAND_KINDS = new Set(['exec', 'validate', 'deliver', 'visual-check']);
const SAFE_ID = /^[a-z0-9][a-z0-9._-]*$/;
const PINNED_REVISION = /^[0-9a-f]{40,64}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const MAX_COMMAND_OUTPUT_BYTES = 16 * 1024 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;
const QUALITY_GUARDS = QUALITY_CONTRACT.guards;
const PREFLIGHT_VIEWPORTS = QUALITY_GUARDS.desktopViewports;
const CAPTURE_VIEWPORTS = QUALITY_GUARDS.captureViewports;
const CAPTURE_THEMES = QUALITY_GUARDS.captureThemes;
const ENTITY_ID_PATHS = Object.freeze({
  architecture: Object.freeze([['components'], ['connections'], ['meta', 'views']]),
  workflow: Object.freeze([['lanes'], ['phases'], ['groups'], ['nodes'], ['edges'], ['meta', 'views']]),
  sequence: Object.freeze([['participants'], ['messages'], ['meta', 'views']]),
  dataflow: Object.freeze([['nodes'], ['flows'], ['meta', 'views']]),
  lifecycle: Object.freeze([['lanes'], ['states'], ['transitions'], ['meta', 'views']]),
});

function jsonClone(value, label) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    throw new TypeError(`${label} must be JSON-serializable: ${error.message}`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function assertSafeId(value, label) {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new TypeError(`${label} must match ${SAFE_ID}.`);
  }
  return value;
}

function assertString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${label} must be a non-empty string.`);
  return value;
}

function assertUniqueStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string array.`);
  }
  const normalized = value.map((entry, index) => assertString(entry, `${label}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must not contain duplicate IDs.`);
  }
  return normalized;
}

function outputChild(root, relative, label) {
  if (typeof relative !== 'string' || !relative.trim() || path.isAbsolute(relative)) {
    throw new TypeError(`${label} must be a relative path.`);
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escapes its isolated diagram directory.`);
  }
  return resolved;
}

function isPathInside(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function portablePathKey(file) {
  return path.resolve(file).normalize('NFC').toLowerCase();
}

function pathIdentityTokens(file) {
  const resolved = path.resolve(file);
  const tokens = new Set([`path:${portablePathKey(resolved)}`]);
  try {
    tokens.add(`realpath:${portablePathKey(fs.realpathSync.native(resolved))}`);
  } catch {
    try {
      const parent = fs.realpathSync.native(path.dirname(resolved));
      tokens.add(`realpath:${portablePathKey(path.join(parent, path.basename(resolved)))}`);
    } catch {
      // A future exec-produced candidate still has a stable lexical identity.
    }
  }
  try {
    const stat = fs.statSync(resolved);
    tokens.add(`inode:${String(stat.dev)}:${String(stat.ino)}`);
  } catch {
    // Missing future paths cannot have an inode identity yet.
  }
  return tokens;
}

function aliasToken(left, right) {
  for (const token of left) if (right.has(token)) return token;
  return null;
}

function auditCandidatePathIdentities(diagrams) {
  const seenCandidates = [];
  const orchestrationOutputs = diagrams.flatMap((diagram) => [
    { owner: diagram.id, path: diagram.artifactPath },
    { owner: diagram.id, path: path.join(diagram.outputDirectory, 'timing.events.jsonl') },
    { owner: diagram.id, path: path.join(diagram.outputDirectory, 'timing.json') },
    { owner: diagram.id, path: path.join(diagram.outputDirectory, 'visual-review.json') },
    { owner: diagram.id, path: path.join(diagram.outputDirectory, 'evidence-ledger.verified.json') },
  ]).map((entry) => ({ ...entry, tokens: pathIdentityTokens(entry.path) }));

  for (const diagram of diagrams) {
    const tokens = pathIdentityTokens(diagram.candidatePath);
    const duplicate = seenCandidates.find((entry) => aliasToken(tokens, entry.tokens));
    if (duplicate) {
      throw new Error(`diagram ${diagram.id} and diagram ${duplicate.id} candidate paths alias the same filesystem entry.`);
    }
    const outputAlias = orchestrationOutputs.find((entry) => aliasToken(tokens, entry.tokens));
    if (outputAlias) {
      throw new Error(`diagram ${diagram.id} candidate path aliases reserved orchestration output for diagram ${outputAlias.owner}.`);
    }
    seenCandidates.push({ id: diagram.id, tokens });
  }
  for (const diagram of diagrams) {
    if (!diagram.evidenceLedgerPath) continue;
    const tokens = pathIdentityTokens(diagram.evidenceLedgerPath);
    const outputAlias = orchestrationOutputs.find((entry) => aliasToken(tokens, entry.tokens));
    if (outputAlias) {
      throw new Error(`diagram ${diagram.id} evidence ledger path aliases reserved orchestration output for diagram ${outputAlias.owner}.`);
    }
    const candidateAlias = seenCandidates.find((entry) => aliasToken(tokens, entry.tokens));
    if (candidateAlias) {
      throw new Error(`diagram ${diagram.id} evidence ledger path aliases candidate for diagram ${candidateAlias.id}.`);
    }
  }
}

function expand(value, replacements, label) {
  assertString(value, label);
  const unknown = [...value.matchAll(/\{([^}]+)\}/g)]
    .map((match) => match[1])
    .filter((name) => !Object.hasOwn(replacements, name));
  if (unknown.length) throw new Error(`${label} contains unknown placeholder {${unknown[0]}}.`);
  return value.replace(/\{([^}]+)\}/g, (_match, name) => replacements[name]);
}

function writeNewFile(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const descriptor = fs.openSync(file, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, contents, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

function writeNewJson(file, value) {
  writeNewFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function replaceJsonAtomically(file, value) {
  const temporary = `${file}.tmp-${process.pid}`;
  writeNewJson(temporary, value);
  try {
    fs.renameSync(temporary, file);
  } catch (error) {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // Preserve the original error from the atomic commit boundary.
    }
    throw error;
  }
}

function commandOrder(commands, diagramLabel) {
  let candidateValidated = false;
  let artifactDelivered = false;
  let qualityCommands = 0;

  for (const command of commands) {
    if (command.kind === 'exec') {
      candidateValidated = false;
      artifactDelivered = false;
      continue;
    }
    qualityCommands += 1;
    if (command.kind === 'validate') {
      candidateValidated = true;
      artifactDelivered = false;
      continue;
    }
    if (command.kind === 'deliver') {
      if (!candidateValidated) {
        throw new Error(`${diagramLabel}: deliver command ${command.id} requires a preceding validate after the last exec command.`);
      }
      artifactDelivered = true;
      continue;
    }
    if (command.kind === 'visual-check' && !artifactDelivered) {
      throw new Error(`${diagramLabel}: visual-check command ${command.id} requires a preceding deliver command.`);
    }
  }

  if (qualityCommands === 0 || commands.filter((command) => command.kind !== 'exec').at(-1)?.kind !== 'visual-check') {
    throw new Error(`${diagramLabel}: the final typed quality command must be visual-check.`);
  }
}

function normalizeManifest(manifest, manifestPath, outputRoot) {
  assertObject(manifest, 'manifest');
  if (manifest.schemaVersion !== 1) throw new Error(`Unsupported suite manifest schema ${JSON.stringify(manifest.schemaVersion)}.`);
  const id = assertSafeId(manifest.id, 'manifest.id');
  const qualityProfile = manifest.qualityProfile ?? QUALITY_GUARDS.qualityProfile;
  if (qualityProfile !== QUALITY_GUARDS.qualityProfile) {
    throw new Error(`manifest.qualityProfile must be "${QUALITY_GUARDS.qualityProfile}".`);
  }
  if (!Array.isArray(manifest.diagrams) || manifest.diagrams.length === 0) {
    throw new Error('manifest.diagrams must contain at least one diagram.');
  }
  const authoredLanguage = manifest.authoredLanguage;
  if (!['en', 'zh-CN'].includes(authoredLanguage)) {
    throw new Error('manifest.authoredLanguage is required and must be "en" or "zh-CN".');
  }
  if (manifest.projectIndex !== undefined && typeof manifest.projectIndex !== 'boolean') {
    throw new Error('manifest.projectIndex must be boolean when specified.');
  }
  if (manifest.viewportPreflight !== undefined && typeof manifest.viewportPreflight !== 'boolean') {
    throw new Error('manifest.viewportPreflight must be boolean when specified.');
  }
  if (manifest.viewportPreflight === false) {
    throw new Error('manifest.viewportPreflight must be enabled for showcase suites.');
  }
  if (manifest.sharedViewportPreflight !== undefined && typeof manifest.sharedViewportPreflight !== 'boolean') {
    throw new Error('manifest.sharedViewportPreflight must be boolean when specified.');
  }

  const manifestDirectory = path.dirname(manifestPath);
  const seenDiagramIds = new Set();
  const diagrams = manifest.diagrams.map((rawDiagram, diagramIndex) => {
    const diagram = assertObject(rawDiagram, `manifest.diagrams[${diagramIndex}]`);
    const type = assertString(diagram.type, `manifest.diagrams[${diagramIndex}].type`);
    if (!DIAGRAM_TYPES.has(type)) throw new Error(`Unknown diagram type ${JSON.stringify(type)}.`);
    const diagramId = assertSafeId(diagram.id ?? type, `manifest.diagrams[${diagramIndex}].id`);
    if (seenDiagramIds.has(diagramId)) throw new Error(`Duplicate diagram id ${JSON.stringify(diagramId)}.`);
    seenDiagramIds.add(diagramId);
    const outputDirectory = outputChild(outputRoot, diagramId, `diagram ${diagramId} output directory`);
    const artifactPath = outputChild(
      outputDirectory,
      diagram.artifact ?? `${diagramId}.html`,
      `diagram ${diagramId} artifact`,
    );
    const replacements = {
      manifestDirectory,
      diagramOutput: outputDirectory,
      outputRoot,
      diagramType: type,
    };
    const rawCandidate = diagram.candidate ?? '{diagramOutput}/candidate.json';
    const expandedCandidate = expand(rawCandidate, replacements, `diagram ${diagramId} candidate`);
    const candidatePath = path.isAbsolute(expandedCandidate)
      ? path.normalize(expandedCandidate)
      : path.resolve(manifestDirectory, expandedCandidate);
    let evidenceLedgerPath = null;
    if (diagram.evidenceLedger !== undefined) {
      const expandedLedger = expand(
        diagram.evidenceLedger,
        replacements,
        `diagram ${diagramId} evidenceLedger`,
      );
      evidenceLedgerPath = path.isAbsolute(expandedLedger)
        ? path.normalize(expandedLedger)
        : path.resolve(manifestDirectory, expandedLedger);
    }
    const semanticFields = ['requiredConcepts', 'requiredClaimIds', 'coverageMap'];
    const hasSemanticCoverage = semanticFields.some((field) => diagram[field] !== undefined);
    let semanticCoverage = null;
    if (hasSemanticCoverage) {
      if (semanticFields.some((field) => diagram[field] === undefined)) {
        throw new Error(`diagram ${diagramId} semantic coverage requires requiredConcepts, requiredClaimIds, and coverageMap together.`);
      }
      if (!evidenceLedgerPath) {
        throw new Error(`diagram ${diagramId} semantic coverage requires evidenceLedger.`);
      }
      const requiredConcepts = assertUniqueStringArray(
        diagram.requiredConcepts,
        `diagram ${diagramId} requiredConcepts`,
      );
      const requiredClaimIds = assertUniqueStringArray(
        diagram.requiredClaimIds,
        `diagram ${diagramId} requiredClaimIds`,
      );
      const coverageMap = assertObject(diagram.coverageMap, `diagram ${diagramId} coverageMap`);
      const coverageKeys = Object.keys(coverageMap);
      if (coverageKeys.length !== requiredConcepts.length
        || requiredConcepts.some((concept) => !Object.hasOwn(coverageMap, concept))) {
        throw new Error(`diagram ${diagramId} coverageMap must cover every requiredConcept exactly once.`);
      }
      const requiredClaims = new Set(requiredClaimIds);
      const normalizedMap = Object.fromEntries(requiredConcepts.map((concept) => {
        const mapping = assertObject(coverageMap[concept], `diagram ${diagramId} coverageMap.${concept}`);
        const candidateIds = assertUniqueStringArray(
          mapping.candidateIds,
          `diagram ${diagramId} coverageMap.${concept}.candidateIds`,
        );
        const claimIds = assertUniqueStringArray(
          mapping.claimIds,
          `diagram ${diagramId} coverageMap.${concept}.claimIds`,
        );
        const unknownClaim = claimIds.find((claimId) => !requiredClaims.has(claimId));
        if (unknownClaim) {
          throw new Error(`diagram ${diagramId} coverageMap.${concept} references undeclared claim ID ${JSON.stringify(unknownClaim)}.`);
        }
        return [concept, { candidateIds, claimIds }];
      }));
      const mappedClaims = new Set(Object.values(normalizedMap).flatMap((mapping) => mapping.claimIds));
      const unmappedClaim = requiredClaimIds.find((claimId) => !mappedClaims.has(claimId));
      if (unmappedClaim) {
        throw new Error(`diagram ${diagramId} required claim ID ${JSON.stringify(unmappedClaim)} is not covered by coverageMap.`);
      }
      semanticCoverage = { requiredConcepts, requiredClaimIds, coverageMap: normalizedMap };
    }
    const reserved = [
      path.join(outputDirectory, 'timing.events.jsonl'),
      path.join(outputDirectory, 'timing.json'),
      path.join(outputDirectory, 'visual-review.json'),
      path.join(outputDirectory, 'evidence-ledger.verified.json'),
    ];
    if (reserved.includes(candidatePath)) {
      throw new Error(`diagram ${diagramId} candidate conflicts with reserved orchestration file ${candidatePath}.`);
    }
    if (reserved.includes(artifactPath)) {
      throw new Error(`diagram ${diagramId} artifact conflicts with reserved orchestration file ${artifactPath}.`);
    }
    if (candidatePath === artifactPath) {
      throw new Error(`diagram ${diagramId} candidate and artifact must be different files.`);
    }

    if (!Array.isArray(diagram.commands) || diagram.commands.length === 0) {
      throw new Error(`diagram ${diagramId} commands must contain at least one command.`);
    }
    const seenCommandIds = new Set();
    const commands = diagram.commands.map((rawCommand, commandIndex) => {
      const command = assertObject(rawCommand, `diagram ${diagramId} command ${commandIndex}`);
      const kind = assertString(command.kind, `diagram ${diagramId} command ${commandIndex} kind`);
      if (!COMMAND_KINDS.has(kind)) throw new Error(`diagram ${diagramId}: unknown command kind ${JSON.stringify(kind)}.`);
      const commandId = assertSafeId(command.id ?? `${kind}-${commandIndex + 1}`, `diagram ${diagramId} command id`);
      if (seenCommandIds.has(commandId)) throw new Error(`diagram ${diagramId}: duplicate command id ${JSON.stringify(commandId)}.`);
      seenCommandIds.add(commandId);
      if (kind === 'exec') {
        if (!Array.isArray(command.argv) || command.argv.length === 0 || command.argv.some((arg) => typeof arg !== 'string')) {
          throw new Error(`diagram ${diagramId}: exec command ${commandId} requires a non-empty string argv array.`);
        }
        if (command.cwd && !['repository', 'diagram', 'manifest'].includes(command.cwd)) {
          throw new Error(`diagram ${diagramId}: exec command ${commandId} has unsupported cwd ${JSON.stringify(command.cwd)}.`);
        }
        if (command.receipt && command.receipt !== 'json') {
          throw new Error(`diagram ${diagramId}: exec command ${commandId} receipt must be "json" when specified.`);
        }
      } else if (command.quality && command.quality !== qualityProfile) {
        throw new Error(`diagram ${diagramId}: ${commandId} quality must match suite qualityProfile ${qualityProfile}.`);
      }
      return {
        id: commandId,
        kind,
        ...(kind === 'exec' ? {
          argv: [...command.argv],
          cwd: command.cwd ?? 'diagram',
          receipt: command.receipt ?? null,
        } : {}),
      };
    });
    commandOrder(commands, `diagram ${diagramId}`);

    return {
      id: diagramId,
      type,
      candidatePath,
      artifactPath,
      outputDirectory,
      evidenceLedgerPath,
      semanticCoverage,
      commands,
    };
  });

  const sharedViewportPreflight = manifest.sharedViewportPreflight === true;
  if (sharedViewportPreflight && manifest.viewportPreflight === false) {
    throw new Error('manifest.sharedViewportPreflight requires viewportPreflight.');
  }
  if (sharedViewportPreflight && diagrams.some((diagram) => diagram.commands.some((command) => command.kind === 'exec'))) {
    throw new Error('manifest.sharedViewportPreflight requires frozen candidates and does not permit exec commands.');
  }
  for (const diagram of diagrams) {
    if (diagram.commands.some((command) => command.kind === 'exec')
      && !isPathInside(diagram.outputDirectory, diagram.candidatePath)) {
      throw new Error(`diagram ${diagram.id} mutable candidate must stay inside its isolated diagram directory.`);
    }
  }
  if (diagrams.some((diagram) => diagram.evidenceLedgerPath) && manifest.projectIndex !== true) {
    throw new Error('diagram evidenceLedger requires manifest.projectIndex to be enabled.');
  }
  auditCandidatePathIdentities(diagrams);

  return {
    id,
    qualityProfile,
    authoredLanguage,
    projectIndex: manifest.projectIndex === true,
    viewportPreflight: manifest.viewportPreflight !== false,
    sharedViewportPreflight,
    diagrams,
    manifestPath,
    manifestDirectory,
  };
}

function commandRequest({ command, diagram, suite, archifyCli }) {
  const replacements = {
    manifestDirectory: suite.manifestDirectory,
    diagramOutput: diagram.outputDirectory,
    outputRoot: suite.outputRoot,
    diagramType: diagram.type,
    candidate: diagram.candidatePath,
    artifact: diagram.artifactPath,
    repoRoot: suite.repository.root,
    revision: suite.repository.revision,
    archifyCli,
  };
  const environment = {
    ARCHIFY_SUITE_ID: suite.id,
    ARCHIFY_SUITE_DIAGRAM_ID: diagram.id,
    ARCHIFY_SUITE_DIAGRAM_TYPE: diagram.type,
    ARCHIFY_SUITE_REPOSITORY_REVISION: suite.repository.revision,
  };

  if (command.kind === 'exec') {
    const argv = command.argv.map((arg, index) => expand(arg, replacements, `${diagram.id}.${command.id}.argv[${index}]`));
    const cwd = {
      repository: suite.repository.root,
      diagram: diagram.outputDirectory,
      manifest: suite.manifestDirectory,
    }[command.cwd];
    return {
      id: command.id,
      kind: command.kind,
      executable: argv[0],
      args: argv.slice(1),
      cwd,
      env: environment,
    };
  }

  if (command.kind === 'validate') {
    return {
      id: command.id,
      kind: command.kind,
      executable: process.execPath,
      args: [
        archifyCli,
        'validate',
        diagram.type,
        diagram.candidatePath,
        '--quality',
        suite.qualityProfile,
        ...(diagram.type === 'architecture' ? ['--repo-root', suite.repository.root] : []),
        ...(suite.viewportPreflight && !suite.sharedViewportPreflight ? ['--preflight'] : []),
        '--require-authored-language',
        suite.authoredLanguage,
        '--json',
      ],
      cwd: diagram.outputDirectory,
      env: environment,
    };
  }

  if (command.kind === 'deliver') {
    return {
      id: command.id,
      kind: command.kind,
      executable: process.execPath,
      args: [
        archifyCli,
        'deliver',
        diagram.type,
        diagram.candidatePath,
        diagram.artifactPath,
        '--quality',
        suite.qualityProfile,
        ...(diagram.type === 'architecture' ? ['--repo-root', suite.repository.root] : []),
        '--require-authored-language',
        suite.authoredLanguage,
        '--json',
      ],
      cwd: diagram.outputDirectory,
      env: environment,
    };
  }

  throw new Error('Per-diagram visual-check commands must be executed through the shared batch seam.');
}

function serialGate() {
  let tail = Promise.resolve();
  return (operation) => {
    const current = tail.then(operation, operation);
    tail = current.catch(() => {});
    return current;
  };
}

function capabilityRequest(suite, archifyCli) {
  return {
    id: 'chrome-capability',
    kind: 'chrome-capability',
    executable: process.execPath,
    args: [archifyCli, 'visual-check', '--probe', '--json'],
    cwd: suite.outputRoot,
    env: {
      ARCHIFY_SUITE_ID: suite.id,
      ARCHIFY_SUITE_REPOSITORY_REVISION: suite.repository.revision,
    },
  };
}

function parseCapabilityReceipt(result) {
  let receipt;
  try {
    receipt = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Chrome capability probe did not emit one JSON receipt: ${error.message}`);
  }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)
    || receipt.command !== 'visual-capability-probe'
    || typeof receipt.ok !== 'boolean') {
    throw new Error('Chrome capability probe emitted an invalid receipt.');
  }
  return receipt;
}

async function runCapabilityGate({ suite, archifyCli, commandRunner, recorder }) {
  let receipt = null;
  let failure = null;
  try {
    await recorder.stage('chromeCapability', async (stage) => {
      await stage.attempt('probe', async (attempt) => {
        const result = await attempt.span('command', async () => commandRunner(capabilityRequest(suite, archifyCli)));
        receipt = await attempt.span('receipt', async () => parseCapabilityReceipt(result));
        attempt.milestone('chromeCapabilityResult', { receipt, exitCode: result.exitCode });
        if (result.exitCode !== 0
          || receipt.ok !== true
          || receipt.status !== 'pass'
          || receipt.chrome?.status !== 'available'
          || receipt.cdp?.status !== 'available'
          || receipt.chrome?.sandbox?.automaticOptOut !== false) {
          const error = new Error(`Chrome capability gate ${receipt.status || 'failed'} with exit code ${result.exitCode}.`);
          error.code = 'ARCHIFY_SUITE_CHROME_CAPABILITY';
          error.exitCode = result.exitCode;
          throw error;
        }
      });
    });
  } catch (error) {
    failure = error;
  }
  if (!receipt) {
    receipt = {
      schemaVersion: 1,
      ok: false,
      command: 'visual-capability-probe',
      status: 'fail',
      error: failure?.message || 'Chrome capability probe failed without a receipt.',
    };
  }
  const snapshot = recoverRunTiming(recorder.eventsPath, recorder.timingPath);
  const stage = snapshot.stages.find((candidate) => candidate.name === 'chromeCapability');
  return {
    ok: !failure && receipt.ok === true && receipt.status === 'pass',
    receipt,
    durationMs: stage?.durationMs ?? null,
    ...(failure ? { error: failure } : {}),
  };
}

function visualBatchRequest(suite, contexts, archifyCli) {
  return {
    id: 'visual-check-batch',
    kind: 'visual-check-batch',
    executable: process.execPath,
    args: [
      archifyCli,
      'visual-check',
      ...contexts.map((context) => context.diagram.artifactPath),
      '--json',
    ],
    cwd: suite.outputRoot,
    env: {
      ARCHIFY_SUITE_ID: suite.id,
      ARCHIFY_SUITE_REPOSITORY_REVISION: suite.repository.revision,
    },
  };
}

function parseVisualBatchReceipt(result, expectedCount) {
  let receipt;
  try {
    receipt = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`Visual-check batch did not emit one JSON receipt: ${error.message}`);
  }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error('Visual-check batch emitted a non-object JSON receipt.');
  }
  if (receipt.schemaVersion !== 2) {
    throw new Error('Visual-check batch must emit schemaVersion 2; legacy receipts must be regenerated.');
  }
  const artifacts = receipt.command === 'visual-check' ? [receipt] : receipt.artifacts;
  if (!['visual-check', 'visual-check-batch'].includes(receipt.command)
    || typeof receipt.ok !== 'boolean'
    || !Array.isArray(artifacts)
    || artifacts.length !== expectedCount) {
    throw new Error('Visual-check batch emitted an invalid artifact receipt set.');
  }
  if (artifacts.some((artifact) => artifact?.schemaVersion !== 2
    || artifact?.command !== 'visual-check'
    || typeof artifact?.ok !== 'boolean'
    || typeof artifact?.status !== 'string')) {
    throw new Error('Visual-check batch emitted malformed child receipts.');
  }
  const childrenPass = artifacts.every((artifact) => artifact.ok === true && artifact.status === 'pass');
  if (receipt.ok !== childrenPass
    || (childrenPass ? receipt.status !== 'pass' : receipt.status === 'pass')) {
    throw new Error('Visual-check batch wrapper contradicts its child receipts.');
  }
  return { receipt, artifacts };
}

async function runVisualBatch({ suite, contexts, archifyCli, commandRunner, recorder }) {
  let parsed = null;
  let commandResult = null;
  let failure = null;
  try {
    await recorder.stage('visualCheckBatch', async (stage) => {
      await stage.attempt('visual-check-batch', async (attempt) => {
        commandResult = await attempt.span('command', async () => commandRunner(
          visualBatchRequest(suite, contexts, archifyCli),
        ));
        parsed = await attempt.span('receipt', async () => parseVisualBatchReceipt(
          commandResult,
          contexts.length,
        ));
        attempt.milestone('visualCheckBatchResult', {
          receipt: parsed.receipt,
          exitCode: commandResult.exitCode,
        });
        if (commandResult.exitCode !== 0
          || parsed.receipt.ok !== true
          || parsed.receipt.status !== 'pass') {
          const error = new Error(`Visual-check batch ${parsed.receipt.status || 'failed'} with exit code ${commandResult.exitCode}.`);
          error.code = 'ARCHIFY_SUITE_VISUAL_BATCH';
          error.exitCode = commandResult.exitCode;
          throw error;
        }
      });
    });
  } catch (error) {
    failure = error;
  }
  const snapshot = recoverRunTiming(recorder.eventsPath, recorder.timingPath);
  const stage = snapshot.stages.find((candidate) => candidate.name === 'visualCheckBatch');
  return {
    receipt: parsed?.receipt || null,
    artifacts: parsed?.artifacts || [],
    exitCode: commandResult?.exitCode ?? 1,
    durationMs: stage?.durationMs ?? null,
    ...(failure ? { error: failure } : {}),
  };
}

function mappedVisualReceipt(context, batch) {
  const expected = context.diagram.artifactPath;
  const matches = batch.artifacts.filter((receipt) => {
    const receiptPath = receipt?.artifact?.path;
    return typeof receiptPath === 'string' && path.resolve(receiptPath) === expected;
  });
  if (matches.length === 1
    && matches[0].command === 'visual-check'
    && typeof matches[0].ok === 'boolean') {
    const receipt = matches[0];
    return {
      receipt,
      exitCode: receipt.ok ? 0 : receipt.status === 'skipped' ? 2 : 1,
    };
  }
  return {
    exitCode: 1,
    receipt: {
      schemaVersion: 1,
      ok: false,
      command: 'visual-check',
      status: 'fail',
      visualReview: 'pending',
      artifact: { path: expected },
      error: batch.error?.message || `Visual-check batch did not return exactly one receipt for ${expected}.`,
    },
  };
}

function digestText(value) {
  const data = Buffer.from(value || '', 'utf8');
  return {
    bytes: data.byteLength,
    sha256: createHash('sha256').update(data).digest('hex'),
  };
}

function parseCommandReceipt(command, result) {
  if (command.kind === 'exec' && command.receipt !== 'json') {
    return {
      schemaVersion: 1,
      ok: result.exitCode === 0,
      command: 'exec',
      stdout: digestText(result.stdout),
      stderr: digestText(result.stderr),
    };
  }
  let receipt;
  try {
    receipt = JSON.parse(result.stdout);
  } catch (error) {
    const parseError = new Error(`${command.kind} command ${command.id} did not emit one JSON receipt: ${error.message}`);
    parseError.code = 'ARCHIFY_SUITE_RECEIPT_INVALID';
    throw parseError;
  }
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new Error(`${command.kind} command ${command.id} emitted a non-object JSON receipt.`);
  }
  if (command.kind !== 'exec' && receipt.command !== command.kind) {
    throw new Error(`${command.kind} command ${command.id} emitted receipt for ${JSON.stringify(receipt.command)}.`);
  }
  if (command.kind !== 'exec' && typeof receipt.ok !== 'boolean') {
    throw new Error(`${command.kind} command ${command.id} receipt must contain boolean ok.`);
  }
  return receipt;
}

function commandFailure(command, result, receipt) {
  const failed = result.exitCode !== 0 || receipt?.ok === false;
  if (!failed) return null;
  const error = new Error(typeof receipt?.error === 'string' && receipt.error
    ? receipt.error
    : `${command.kind} command ${command.id} failed with exit code ${result.exitCode}.`);
  error.code = 'ARCHIFY_SUITE_COMMAND_FAILED';
  error.exitCode = result.exitCode;
  return error;
}

function viewportKey(viewport) {
  return `${viewport?.width}x${viewport?.height}:${viewport?.theme}`;
}

function exactViewportMatrix(viewports, expectedViewports, expectedThemes) {
  const expected = expectedViewports.flatMap(({ width, height }) => expectedThemes.map(
    (theme) => `${width}x${height}:${theme}`,
  ));
  if (!Array.isArray(viewports) || viewports.length !== expected.length) return false;
  const actual = new Set(viewports.map(viewportKey));
  return actual.size === expected.length && expected.every((key) => actual.has(key));
}

function resolvedThemesMatch(viewports) {
  return viewports.every((viewport) => (
    typeof viewport?.theme === 'string'
    && viewport.resolvedTheme === viewport.theme
  ));
}

function stateViewportKey(observation) {
  return `${observation?.width}x${observation?.height}:${observation?.requestedTheme}`;
}

function exactStateMatrix(observations, expectedViewports, expectedThemes) {
  const expected = expectedViewports.flatMap(({ width, height }) => expectedThemes.map(
    (theme) => `${width}x${height}:${theme}`,
  ));
  if (!Array.isArray(observations) || observations.length !== expected.length) return false;
  const actual = new Set(observations.map(stateViewportKey));
  return actual.size === expected.length && expected.every((key) => actual.has(key));
}

function observedStatesMatch(observations) {
  return observations.every((observation) => (
    observation?.resolvedTheme === observation?.requestedTheme
    && observation?.detailLevel === 'read'
    && observation?.motion === 'still'
    && observation?.ok === true
  ));
}

function hasCanonicalDeterministicChecks(checks) {
  const expected = QUALITY_GUARDS.deterministicCheckNames;
  if (!Array.isArray(checks) || checks.length !== expected.length) return false;
  const actual = new Set(checks.map((check) => check?.name));
  return actual.size === expected.length
    && expected.every((name) => actual.has(name))
    && checks.every((check) => check?.ok === true);
}

function pngIhdrDimensions(bytes) {
  const validHeader = bytes.length >= 24
    && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    && bytes.subarray(12, 16).toString('ascii') === 'IHDR';
  if (!validHeader) return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function verifyQualityReceipt(
  diagram,
  command,
  receipt,
  qualityProfile,
  viewportPreflight,
  authoredLanguage,
) {
  if (!receipt?.ok || command.kind === 'exec') return;
  if (['validate', 'deliver'].includes(command.kind)) {
    if (receipt.authoredLanguage?.required !== authoredLanguage
      || receipt.authoredLanguage?.violations !== 0) {
      throw new Error(`${command.kind} success receipt does not preserve the required authored language ${authoredLanguage}.`);
    }
  }
  if (command.kind === 'validate') {
    if (receipt.type !== diagram.type || receipt.specification?.type !== diagram.type) {
      throw new Error('validate success receipt diagram type does not match the suite diagram.');
    }
    const candidate = fs.readFileSync(diagram.candidatePath);
    const candidateSha256 = createHash('sha256').update(candidate).digest('hex');
    if (receipt.specification?.bytes !== candidate.byteLength
      || receipt.specification?.sha256 !== candidateSha256) {
      throw new Error('validate specification digest does not match the current candidate bytes.');
    }
    if (!hasCanonicalDeterministicChecks(receipt.checks)) {
      throw new Error('validate success receipt does not preserve the canonical 9/9 deterministic checks.');
    }
    if (receipt.composition?.summary?.errors !== 0 || receipt.composition?.summary?.warnings !== 0) {
      throw new Error('validate success receipt must contain 0 composition errors and 0 warnings.');
    }
    if (receipt.composition?.profile !== qualityProfile) {
      throw new Error(`validate receipt profile ${JSON.stringify(receipt.composition?.profile)} does not match suite profile ${qualityProfile}.`);
    }
    if (viewportPreflight) {
      const preflight = receipt.preflight;
      const viewports = preflight?.containment?.viewports;
      const stateObservations = preflight?.state?.observations;
      if (preflight?.ok !== true
        || preflight?.schemaVersion !== 2
        || preflight?.status !== 'pass'
        || preflight?.state?.status !== 'pass'
        || preflight?.state?.detail !== 'read'
        || preflight?.state?.motion !== 'still'
        || !exactStateMatrix(stateObservations, PREFLIGHT_VIEWPORTS, ['light'])
        || !observedStatesMatch(stateObservations)
        || preflight?.containment?.status !== 'pass'
        || !exactViewportMatrix(viewports, PREFLIGHT_VIEWPORTS, ['light'])
        || !resolvedThemesMatch(viewports)
        || viewports.some((viewport) => viewport?.ok !== true)) {
        throw new Error('validate success receipt must contain a passing 4/4 viewport preflight.');
      }
    }
    return;
  }
  if (command.kind === 'deliver') {
    const validation = receipt.validation;
    if (!validation
      || validation.checkCount !== QUALITY_GUARDS.deterministicChecksRequired
      || validation.checksPassed !== validation.checkCount) {
      throw new Error('deliver success receipt does not preserve the 9/9 deterministic quality floor.');
    }
    if (validation.errors !== 0 || validation.warnings !== 0) {
      throw new Error('deliver success receipt must contain 0 errors and 0 warnings.');
    }
    if (validation.compositionProfile !== qualityProfile) {
      throw new Error(`deliver receipt profile ${JSON.stringify(validation.compositionProfile)} does not match suite profile ${qualityProfile}.`);
    }
    return;
  }
  const fullStateObservations = receipt.state?.observations;
  const expectedFullState = [
    ...PREFLIGHT_VIEWPORTS.map((viewport) => ({ ...viewport, theme: 'light' })),
    ...CAPTURE_VIEWPORTS.map((viewport) => ({ ...viewport, theme: 'dark' })),
  ];
  const actualFullState = Array.isArray(fullStateObservations)
    ? new Set(fullStateObservations.map(stateViewportKey))
    : new Set();
  const expectedFullStateKeys = expectedFullState.map(
    ({ width, height, theme }) => `${width}x${height}:${theme}`,
  );
  if (receipt.state?.detail !== 'read'
    || receipt.state?.motion !== 'still'
    || receipt.state?.status !== 'pass'
    || !Array.isArray(fullStateObservations)
    || fullStateObservations.length !== expectedFullStateKeys.length
    || actualFullState.size !== expectedFullStateKeys.length
    || expectedFullStateKeys.some((key) => !actualFullState.has(key))
    || !observedStatesMatch(fullStateObservations)) {
    throw new Error('visual-check success receipt must preserve the READ detail and Still motion state.');
  }
  const viewports = receipt.containment?.viewports;
  if (receipt.containment?.status !== 'pass'
    || !exactViewportMatrix(viewports, PREFLIGHT_VIEWPORTS, ['light'])
    || !resolvedThemesMatch(viewports)
    || viewports.some((viewport) => viewport?.ok !== true)) {
    throw new Error('visual-check success receipt must preserve the exact four-viewport light containment matrix.');
  }
  const readabilityViewports = receipt.readability?.viewports;
  if (receipt.readability?.status !== 'pass'
    || receipt.readability?.minimumProjectedNodeTextPx !== QUALITY_GUARDS.minimumProjectedNodeTextPx
    || !exactViewportMatrix(readabilityViewports, PREFLIGHT_VIEWPORTS, ['light'])
    || !resolvedThemesMatch(readabilityViewports)
    || readabilityViewports.some((viewport) => viewport?.readabilityOk !== true)) {
    throw new Error('visual-check success receipt must preserve a passing four-viewport readability receipt.');
  }
  const viewerChromeViewports = receipt.viewerChrome?.viewports;
  if (receipt.viewerChrome?.status !== 'pass'
    || !exactViewportMatrix(viewerChromeViewports, PREFLIGHT_VIEWPORTS, ['light'])
    || !resolvedThemesMatch(viewerChromeViewports)
    || viewerChromeViewports.some((viewport) => (
      viewport?.viewerChromeOk !== true || viewport?.viewerChromeStageOk !== true
    ))) {
    throw new Error('visual-check success receipt must preserve a passing four-viewport viewerChrome receipt.');
  }
  const screenshots = receipt.captures?.screenshots;
  if (receipt.captures?.status !== 'pass'
    || !exactViewportMatrix(screenshots, CAPTURE_VIEWPORTS, CAPTURE_THEMES)
    || screenshots.some((screenshot) => screenshot?.ok !== true)) {
    throw new Error('visual-check success receipt must preserve the exact four-screenshot light/dark capture matrix.');
  }
  if (!resolvedThemesMatch(screenshots)) {
    throw new Error('Every visual-check screenshot resolved theme must match its requested theme.');
  }
  if (screenshots.some((screenshot) => (
    screenshot?.readabilityOk !== true || screenshot?.viewerChromeOk !== true
  ))) {
    throw new Error('Every visual-check screenshot must preserve passing readability and viewerChrome observations.');
  }
  const screenshotIdentities = [];
  const artifactStem = path.basename(
    diagram.artifactPath,
    path.extname(diagram.artifactPath),
  );
  for (const screenshot of screenshots) {
    const file = screenshot.file;
    if (typeof file !== 'string' || !file || path.basename(file) !== file) {
      throw new Error(`visual-check screenshot path is not an isolated sidecar: ${String(file)}`);
    }
    const expectedFile = `${artifactStem}.visual-check.${screenshot.width}x${screenshot.height}.${screenshot.theme}.png`;
    if (file !== expectedFile) {
      throw new Error(`visual-check screenshot does not use its canonical sidecar basename: ${String(file)}`);
    }
    const screenshotPath = path.resolve(diagram.outputDirectory, file);
    if (!fs.existsSync(screenshotPath)) {
      throw new Error(`visual-check screenshot is missing: ${String(file)}`);
    }
    const tokens = pathIdentityTokens(screenshotPath);
    if (screenshotIdentities.some((identity) => aliasToken(tokens, identity))) {
      throw new Error(`visual-check screenshot paths alias the same sidecar: ${String(file)}`);
    }
    screenshotIdentities.push(tokens);
    const bytes = fs.readFileSync(screenshotPath);
    const actualSha256 = createHash('sha256').update(bytes).digest('hex');
    const dimensions = pngIhdrDimensions(bytes);
    if (!SHA256.test(screenshot.sha256 || '')
      || screenshot.sha256 !== actualSha256
      || screenshot.bytes !== bytes.byteLength
      || screenshot.pixelWidth !== screenshot.width
      || screenshot.pixelHeight !== screenshot.height) {
      throw new Error(`visual-check screenshot content digest or pixel dimensions do not match: ${String(file)}`);
    }
    if (dimensions?.width !== screenshot.width || dimensions?.height !== screenshot.height) {
      throw new Error(`visual-check screenshot PNG IHDR dimensions do not match: ${String(file)}`);
    }
  }
}

function verifyReceiptArtifact(diagram, command, receipt) {
  if (!['deliver', 'visual-check'].includes(command.kind) || !receipt?.ok) return;
  if (!fs.existsSync(diagram.artifactPath)) {
    throw new Error(`${command.kind} reported success but artifact is missing: ${diagram.artifactPath}`);
  }
  const expectedSha = receipt.artifact?.sha256;
  if (!expectedSha) throw new Error(`${command.kind} success receipt has no artifact.sha256.`);
  const actualSha = createHash('sha256').update(fs.readFileSync(diagram.artifactPath)).digest('hex');
  if (actualSha !== expectedSha) {
    throw new Error(`${command.kind} artifact sha256 does not match its receipt.`);
  }
  if (command.kind === 'visual-check') {
    const verification = receipt.artifact?.verification;
    if (verification?.unchanged !== true
      || verification?.before?.sha256 !== expectedSha
      || verification?.after?.sha256 !== expectedSha
      || verification?.before?.bytes !== receipt.artifact?.bytes
      || verification?.after?.bytes !== receipt.artifact?.bytes) {
      throw new Error('visual-check success receipt must prove the artifact stayed unchanged during inspection.');
    }
  }
}

function verifyDeliverySpecification(
  diagram,
  receipt,
  sharedPreflightReceipt,
  semanticCoverageReceipt,
) {
  if (!receipt?.ok) return;
  const specification = receipt.specification;
  if (!Number.isInteger(specification?.bytes) || specification.bytes < 1 || !SHA256.test(specification?.sha256 || '')) {
    throw new Error('deliver success receipt must contain a valid specification digest.');
  }
  const shared = sharedPreflightReceipt?.specification;
  if (shared && (specification.bytes !== shared.bytes || specification.sha256 !== shared.sha256)) {
    throw new Error('deliver specification digest does not match shared candidate preflight.');
  }
  if (sharedPreflightReceipt) {
    const sharedArtifact = sharedPreflightReceipt.artifact;
    const deliveredArtifact = receipt.artifact;
    if (!Number.isInteger(sharedArtifact?.bytes)
      || !SHA256.test(sharedArtifact?.sha256 || '')
      || deliveredArtifact?.bytes !== sharedArtifact.bytes
      || deliveredArtifact?.sha256 !== sharedArtifact.sha256) {
      throw new Error('deliver artifact digest does not match shared candidate preflight.');
    }
  }
  const bytes = fs.readFileSync(diagram.candidatePath);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (specification.bytes !== bytes.byteLength || specification.sha256 !== actualSha256) {
    throw new Error('deliver specification digest does not match the current candidate bytes.');
  }
  if (semanticCoverageReceipt
    && specification.sha256 !== semanticCoverageReceipt.candidateSha256) {
    throw new Error('deliver specification digest does not match semantic coverage candidate.');
  }
}

function verifyDeliveredArtifactChain(commandReceipts, visualReceipt) {
  let deliver = null;
  for (let index = commandReceipts.length - 1; index >= 0; index -= 1) {
    if (commandReceipts[index].kind === 'deliver') {
      deliver = commandReceipts[index].receipt?.artifact;
      break;
    }
  }
  const visual = visualReceipt?.artifact;
  if (!deliver || !visual
    || deliver.sha256 !== visual.sha256
    || deliver.bytes !== visual.bytes) {
    throw new Error('visual-check artifact digest does not match deliver.');
  }
}

function verifyCandidateRevision(diagram, revision) {
  let candidate;
  try {
    candidate = JSON.parse(fs.readFileSync(diagram.candidatePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read candidate ${diagram.candidatePath}: ${error.message}`);
  }
  const declared = candidate?.meta?.repository?.revision;
  if (declared && String(declared).toLowerCase() !== revision.toLowerCase()) {
    throw new Error(`Candidate repository revision ${declared} does not match pinned revision ${revision}.`);
  }
}

function verifyDiagramEvidenceLedger(diagram, suite) {
  if (!diagram.evidenceLedgerPath) return null;
  if (!suite.projectIndexDocument) {
    throw new Error(`Evidence ledger for ${diagram.id} requires the original ProjectIndex document.`);
  }
  let ledger;
  let ledgerBytes;
  try {
    ledgerBytes = fs.readFileSync(diagram.evidenceLedgerPath);
    ledger = JSON.parse(ledgerBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Could not read evidence ledger for ${diagram.id}: ${error.message}`);
  }
  const verified = verifyEvidenceLedger(ledger, {
    repoRoot: suite.repository.root,
    projectIndex: suite.projectIndexDocument,
  });
  const frozenPath = path.join(diagram.outputDirectory, 'evidence-ledger.verified.json');
  if (fs.existsSync(frozenPath)) {
    const frozen = fs.readFileSync(frozenPath);
    if (!frozen.equals(ledgerBytes)) {
      throw new Error(`Evidence ledger for ${diagram.id} changed between delivery boundaries.`);
    }
  } else {
    writeNewFile(frozenPath, ledgerBytes);
  }
  return {
    ledger,
    receipt: {
      ...verified,
      path: frozenPath,
      sourcePath: diagram.evidenceLedgerPath,
      bytes: ledgerBytes.byteLength,
      sha256: createHash('sha256').update(ledgerBytes).digest('hex'),
    },
  };
}

function collectCandidateIdPointers(candidate, diagramType) {
  const pointersById = new Map();
  for (const entityPath of ENTITY_ID_PATHS[diagramType] || []) {
    const entities = entityPath.reduce((value, segment) => value?.[segment], candidate);
    if (!Array.isArray(entities)) continue;
    for (const [index, entity] of entities.entries()) {
      if (entity && typeof entity === 'object' && !Array.isArray(entity)
        && typeof entity.id === 'string' && entity.id.trim()) {
        const pointers = pointersById.get(entity.id) || [];
        pointers.push(`/${[...entityPath, index, 'id'].join('/')}`);
        pointersById.set(entity.id, pointers);
      }
    }
  }
  return pointersById;
}

function verifySemanticCoverage(diagram, ledger, evidenceReceipt) {
  if (!diagram.semanticCoverage) return null;
  const candidateBytes = fs.readFileSync(diagram.candidatePath);
  let candidate;
  try {
    candidate = JSON.parse(candidateBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Could not read semantic coverage candidate for ${diagram.id}: ${error.message}`);
  }
  const candidateIdPointers = collectCandidateIdPointers(candidate, diagram.type);
  const ledgerClaimIds = new Set(ledger.facts.map((fact) => fact.claimId));
  for (const claimId of diagram.semanticCoverage.requiredClaimIds) {
    if (!ledgerClaimIds.has(claimId)) {
      throw new Error(`Semantic coverage requires ledger claim ID ${JSON.stringify(claimId)}, but it is absent.`);
    }
  }
  for (const [concept, mapping] of Object.entries(diagram.semanticCoverage.coverageMap)) {
    for (const candidateId of mapping.candidateIds) {
      const pointers = candidateIdPointers.get(candidateId);
      if (!pointers) {
        throw new Error(`Semantic concept ${JSON.stringify(concept)} references required candidate ID ${JSON.stringify(candidateId)}, but it is absent.`);
      }
      if (pointers.length !== 1) {
        throw new Error(`Semantic concept ${JSON.stringify(concept)} references ambiguous candidate ID ${JSON.stringify(candidateId)} at ${pointers.join(', ')}.`);
      }
    }
    for (const claimId of mapping.claimIds) {
      if (!ledgerClaimIds.has(claimId)) {
        throw new Error(`Semantic concept ${JSON.stringify(concept)} references required ledger claim ID ${JSON.stringify(claimId)}, but it is absent.`);
      }
    }
  }
  const referencedCandidateIds = [...new Set(Object.values(diagram.semanticCoverage.coverageMap)
    .flatMap((mapping) => mapping.candidateIds))];
  const bound = {
    presenceVerified: true,
    verificationScope: 'mechanical-presence-only',
    semanticCorrectness: 'not-assessed',
    blindReview: 'required',
    requiredConcepts: diagram.semanticCoverage.requiredConcepts,
    requiredClaimIds: diagram.semanticCoverage.requiredClaimIds,
    coverageMap: diagram.semanticCoverage.coverageMap,
    candidateEntityPointers: Object.fromEntries(referencedCandidateIds.map(
      (candidateId) => [candidateId, candidateIdPointers.get(candidateId)],
    )),
    candidateSha256: createHash('sha256').update(candidateBytes).digest('hex'),
    ledgerDigest: evidenceReceipt.ledgerDigest,
  };
  return {
    schemaVersion: 1,
    ...bound,
    digest: createHash('sha256').update(JSON.stringify(bound)).digest('hex'),
  };
}

function reverifyFrozenEvidenceLedger(context) {
  const expected = context.evidenceLedgerReceipt;
  if (!expected) return;
  try {
    const bytes = fs.readFileSync(expected.path);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    if (bytes.byteLength !== expected.bytes || sha256 !== expected.sha256) {
      throw new Error('frozen ledger bytes do not match the delivery-bound receipt');
    }
    const ledger = JSON.parse(bytes.toString('utf8'));
    const verified = verifyEvidenceLedger(ledger, {
      repoRoot: context.suite.repository.root,
      projectIndex: context.suite.projectIndexDocument,
    });
    if (verified.ledgerDigest !== expected.ledgerDigest
      || verified.indexDigest !== expected.indexDigest
      || verified.factCount !== expected.factCount) {
      throw new Error('frozen ledger verification does not match the delivery-bound receipt');
    }
  } catch (error) {
    throw new Error(`verified evidence ledger changed before final receipt for ${context.diagram.id}: ${error.message}`);
  }
}

function sanitizeEvidenceReceipts(context) {
  try {
    reverifyFrozenEvidenceLedger(context);
    return null;
  } catch (error) {
    context.evidenceLedgerReceipt = null;
    context.semanticCoverageReceipt = null;
    return error;
  }
}

function verifyFinalProjectIndexFile(suite) {
  const expected = suite.projectIndexReceipt;
  if (!expected) return;
  let bytes;
  try {
    bytes = fs.readFileSync(expected.path);
  } catch (error) {
    throw new Error(`project index changed before final receipt: ${error.message}`);
  }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== expected.bytes || sha256 !== expected.sha256) {
    throw new Error(
      `project index changed before final receipt: expected ${expected.bytes} bytes/${expected.sha256}, got ${bytes.byteLength} bytes/${sha256}`,
    );
  }
}

function sanitizeProjectIndexEvidence(suite, contexts) {
  try {
    verifyFinalProjectIndexFile(suite);
    return null;
  } catch (error) {
    for (const context of contexts) {
      context.evidenceLedgerReceipt = null;
      context.semanticCoverageReceipt = null;
    }
    suite.projectIndexReceipt = null;
    suite.projectIndexDocument = null;
    return error;
  }
}

function verifySharedCandidateDigest(diagram, receipt, authoredLanguage) {
  const expected = receipt?.specification;
  if (!expected || !Number.isInteger(expected.bytes) || typeof expected.sha256 !== 'string') {
    throw new Error(`Shared candidate preflight receipt has no specification digest for ${diagram.id}.`);
  }
  const bytes = fs.readFileSync(diagram.candidatePath);
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== expected.bytes || actualSha256 !== expected.sha256) {
    throw new Error(`Candidate ${diagram.id} changed after the shared viewport preflight.`);
  }
  if (receipt.authoredLanguage?.required !== authoredLanguage
    || receipt.authoredLanguage?.violations !== 0) {
    throw new Error(`Shared candidate preflight receipt does not preserve the required authored language ${authoredLanguage} for ${diagram.id}.`);
  }
}

function pendingVisualReview(diagram, artifactPath) {
  return {
    schemaVersion: 1,
    kind: 'archify.visual-review',
    diagram: { id: diagram.id, type: diagram.type },
    artifact: { path: artifactPath },
    status: 'pending',
    reviewer: null,
    reviewedAt: null,
    notes: null,
  };
}

function evidenceBoundVisualReview(review, visualReceipt) {
  return {
    ...review,
    artifact: {
      path: visualReceipt.artifact.path,
      sha256: visualReceipt.artifact.sha256,
      bytes: visualReceipt.artifact.bytes,
    },
    screenshots: visualReceipt.captures.screenshots.map((screenshot) => ({
      file: screenshot.file,
      width: screenshot.width,
      height: screenshot.height,
      theme: screenshot.theme,
      resolvedTheme: screenshot.resolvedTheme,
      sha256: screenshot.sha256,
      bytes: screenshot.bytes,
      pixelWidth: screenshot.pixelWidth,
      pixelHeight: screenshot.pixelHeight,
    })),
  };
}

function finalReceipt({
  suite,
  diagram,
  commandReceipts,
  evidenceLedgerReceipt = null,
  semanticCoverageReceipt = null,
  status,
  error = null,
}) {
  return {
    schemaVersion: 1,
    kind: 'archify.diagram-run',
    status,
    repository: suite.repository,
    quality: {
      profile: suite.qualityProfile,
      authoredLanguage: suite.authoredLanguage,
      viewportPreflight: suite.viewportPreflight,
      sharedViewportPreflight: suite.sharedViewportPreflight,
    },
    ...(suite.projectIndexReceipt ? { projectIndex: suite.projectIndexReceipt } : {}),
    diagram: {
      id: diagram.id,
      type: diagram.type,
      candidate: diagram.candidatePath,
      artifact: diagram.artifactPath,
    },
    ...(evidenceLedgerReceipt ? { evidenceLedger: evidenceLedgerReceipt } : {}),
    ...(semanticCoverageReceipt ? { semanticCoverage: semanticCoverageReceipt } : {}),
    commands: commandReceipts,
    ...(error ? {
      error: {
        name: error.name || 'Error',
        message: error.message || String(error),
        ...(error.code ? { code: error.code } : {}),
      },
    } : {}),
  };
}

function diagramResult(context, timing, artifactPath) {
  return {
    diagram: context.diagram,
    timing,
    timingPath: context.timingPath,
    eventsPath: context.eventsPath,
    artifactPath,
    visualReview: context.visualReview,
    visualReviewPath: context.visualReviewPath,
  };
}

function finalizeDiagramFailure(context, error) {
  sanitizeEvidenceReceipts(context);
  const receipt = finalReceipt({
    suite: context.suite,
    diagram: context.diagram,
    commandReceipts: context.commandReceipts,
    evidenceLedgerReceipt: context.evidenceLedgerReceipt,
    semanticCoverageReceipt: context.semanticCoverageReceipt,
    status: 'failed',
    error,
  });
  const timing = context.recorder.finalize({ status: 'failed', finalReceipt: receipt });
  return diagramResult(
    context,
    timing,
    fs.existsSync(context.diagram.artifactPath) ? context.diagram.artifactPath : null,
  );
}

async function runDiagramUntilVisual({ suite, diagram, archifyCli, commandRunner }) {
  fs.mkdirSync(diagram.outputDirectory, { recursive: true });
  const eventsPath = path.join(diagram.outputDirectory, 'timing.events.jsonl');
  const timingPath = path.join(diagram.outputDirectory, 'timing.json');
  const visualReviewPath = path.join(diagram.outputDirectory, 'visual-review.json');
  const visualReview = pendingVisualReview(diagram, diagram.artifactPath);
  writeNewJson(visualReviewPath, visualReview);

  const recorder = RunRecorder.open({
    run: {
      id: `${suite.id}/${diagram.id}`,
      suiteId: suite.id,
      diagramId: diagram.id,
      diagramType: diagram.type,
      repository: suite.repository,
      outputDirectory: diagram.outputDirectory,
    },
    eventsPath,
    timingPath,
  });
  const commandReceipts = [];
  const context = {
    suite,
    diagram,
    recorder,
    commandReceipts,
    timingPath,
    eventsPath,
    visualReview,
    visualReviewPath,
    visualCommand: diagram.commands.at(-1),
    pendingVisual: true,
    evidenceLedgerReceipt: null,
    semanticCoverageReceipt: null,
  };

  try {
    for (const command of diagram.commands.slice(0, -1)) {
      const request = commandRequest({ command, diagram, suite, archifyCli });
      await recorder.stage(command.id, async (stage) => {
        await stage.attempt(command.kind, async (attempt) => {
          if (['validate', 'deliver'].includes(command.kind)) {
            await attempt.span('candidate-identity', async () => auditCandidatePathIdentities(suite.diagrams));
            await attempt.span('candidate-revision', async () => verifyCandidateRevision(diagram, suite.repository.revision));
            if (suite.sharedViewportPreflight) {
              await attempt.span('shared-preflight-specification', async () => verifySharedCandidateDigest(
                diagram,
                suite.sharedPreflightReceipts?.[diagram.id],
                suite.authoredLanguage,
              ));
            }
            if (command.kind === 'deliver' && diagram.evidenceLedgerPath) {
              if (context.evidenceLedgerReceipt) {
                await attempt.span('evidence-ledger-continuity', async () => {
                  const evidenceIntegrityError = sanitizeEvidenceReceipts(context);
                  if (evidenceIntegrityError) throw evidenceIntegrityError;
                });
              }
              const evidence = await attempt.span(
                'evidence-ledger',
                async () => verifyDiagramEvidenceLedger(diagram, suite),
              );
              context.evidenceLedgerReceipt = evidence.receipt;
              if (diagram.semanticCoverage) {
                context.semanticCoverageReceipt = await attempt.span(
                  'semantic-coverage',
                  async () => verifySemanticCoverage(diagram, evidence.ledger, evidence.receipt),
                );
              }
            }
          }
          const runCommand = () => commandRunner(request);
          const result = await attempt.span('command', async () => (
            command.kind === 'validate' && request.args.includes('--preflight')
              ? suite.browserPreflightGate(runCommand)
              : runCommand()
          ));
          let receipt = await attempt.span('receipt', async () => parseCommandReceipt(command, result));
          if (command.kind === 'validate' && suite.sharedViewportPreflight) {
            const shared = suite.sharedPreflightReceipts?.[diagram.id];
            if (!shared) throw new Error(`Shared candidate preflight receipt is missing for ${diagram.id}.`);
            receipt = { ...receipt, preflight: shared.preflight };
          }
          commandReceipts.push({
            id: command.id,
            kind: command.kind,
            exitCode: result.exitCode,
            ...(result.timing ? { processTiming: result.timing } : {}),
            receipt,
          });
          verifyQualityReceipt(
            diagram,
            command,
            receipt,
            suite.qualityProfile,
            suite.viewportPreflight,
            suite.authoredLanguage,
          );
          if (command.kind === 'deliver') {
            verifyDeliverySpecification(
              diagram,
              receipt,
              suite.sharedPreflightReceipts?.[diagram.id],
              context.semanticCoverageReceipt,
            );
          }
          verifyReceiptArtifact(diagram, command, receipt);
          const failure = commandFailure(command, result, receipt);
          if (failure) throw failure;
        }, { kind: command.kind });

        if (command.kind === 'validate') stage.milestone('deterministicValidationPassed');
        if (command.kind === 'deliver') stage.milestone('artifactReady');
      }, { kind: command.kind });
    }
    return context;
  } catch (error) {
    return finalizeDiagramFailure(context, error);
  }
}

async function completeDiagramVisual(context, {
  receipt,
  exitCode,
  batchDurationMs,
  finalIntegrityError = null,
}) {
  const { suite, diagram, recorder, commandReceipts, visualCommand } = context;
  try {
    await recorder.stage(visualCommand.id, async (stage) => {
      await stage.attempt('visual-check', async (attempt) => {
        await attempt.span('shared-batch-receipt', async () => {
          commandReceipts.push({
            id: visualCommand.id,
            kind: 'visual-check',
            exitCode,
            sharedBatch: true,
            receipt,
          });
          const evidenceIntegrityError = sanitizeEvidenceReceipts(context);
          verifyQualityReceipt(
            diagram,
            visualCommand,
            receipt,
            suite.qualityProfile,
            suite.viewportPreflight,
            suite.authoredLanguage,
          );
          const failure = commandFailure(visualCommand, { exitCode }, receipt);
          if (failure) throw failure;
          if (evidenceIntegrityError) throw evidenceIntegrityError;
          verifyDeliveredArtifactChain(commandReceipts, receipt);
          verifyReceiptArtifact(diagram, visualCommand, receipt);
          context.visualReview = evidenceBoundVisualReview(context.visualReview, receipt);
          replaceJsonAtomically(context.visualReviewPath, context.visualReview);
        });
      }, { kind: 'visual-check', sharedBatchDurationMs: batchDurationMs });
      stage.milestone('reviewReady', { sharedBatchDurationMs: batchDurationMs });
    }, { kind: 'visual-check', sharedBatch: true, sharedBatchDurationMs: batchDurationMs });

    const finalEvidenceIntegrityError = sanitizeEvidenceReceipts(context);
    if (finalEvidenceIntegrityError) throw finalEvidenceIntegrityError;
    if (finalIntegrityError) throw finalIntegrityError;
    const final = finalReceipt({
      suite,
      diagram,
      commandReceipts,
      evidenceLedgerReceipt: context.evidenceLedgerReceipt,
      semanticCoverageReceipt: context.semanticCoverageReceipt,
      status: 'completed',
    });
    const timing = recorder.finalize({ status: 'completed', finalReceipt: final });
    return diagramResult(context, timing, diagram.artifactPath);
  } catch (error) {
    return finalizeDiagramFailure(context, error);
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  let firstError = null;
  async function consume() {
    while (!firstError) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        if (!firstError) firstError = error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  if (firstError) throw firstError;
  return results;
}

/** Production adapter for the injected command-runner seam. */
export function spawnCommandRunner(request) {
  return new Promise((resolve, reject) => {
    const timeoutMs = request.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
      reject(new TypeError('command timeoutMs must be a positive integer.'));
      return;
    }
    if (request.signal?.aborted) {
      const error = new Error(`Command ${request.id || request.executable} was aborted before start.`);
      error.code = 'ARCHIFY_COMMAND_ABORTED';
      reject(error);
      return;
    }
    const startedAt = new Date().toISOString();
    const startedMonotonicMs = performance.now();
    const child = spawn(request.executable, request.args, {
      cwd: request.cwd,
      env: { ...process.env, ...request.env },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let failure = null;
    let settled = false;
    const terminateTree = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          shell: false,
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.once('error', () => {});
      } else {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch (error) {
          if (error?.code !== 'ESRCH') child.kill('SIGKILL');
        }
      }
    };
    const timeout = setTimeout(() => {
      failure = new Error(`Command ${request.id || request.executable} timed out after ${timeoutMs}ms.`);
      failure.code = 'ARCHIFY_COMMAND_TIMEOUT';
      terminateTree();
    }, timeoutMs);
    timeout.unref?.();
    const onAbort = () => {
      failure = new Error(`Command ${request.id || request.executable} was aborted.`);
      failure.code = 'ARCHIFY_COMMAND_ABORTED';
      terminateTree();
    };
    request.signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => {
      clearTimeout(timeout);
      request.signal?.removeEventListener('abort', onAbort);
    };
    const collect = (target) => (chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        failure = new Error(`Command ${request.id || request.executable} exceeded ${MAX_COMMAND_OUTPUT_BYTES} output bytes.`);
        failure.code = 'ARCHIFY_COMMAND_OUTPUT_LIMIT';
        terminateTree();
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.once('close', (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (failure) {
        failure.timing = {
          source: 'child-process',
          startedAt,
          endedAt: new Date().toISOString(),
          durationMs: Math.round((performance.now() - startedMonotonicMs) * 1000) / 1000,
        };
        reject(failure);
        return;
      }
      resolve({
        exitCode: Number.isInteger(exitCode) ? exitCode : 1,
        signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        timing: {
          source: 'child-process',
          startedAt,
          endedAt: new Date().toISOString(),
          durationMs: Math.round((performance.now() - startedMonotonicMs) * 1000) / 1000,
        },
      });
    });
  });
}

async function verifyPinnedRevision(repoRoot, revision, commandRunner) {
  if (!PINNED_REVISION.test(revision)) {
    throw new Error('revision must be a full 40-64 character hexadecimal commit id.');
  }
  const result = await commandRunner({
    id: 'repository-revision',
    kind: 'repository-revision',
    executable: 'git',
    args: ['-C', repoRoot, 'rev-parse', 'HEAD'],
    cwd: repoRoot,
    env: {},
  });
  if (result.exitCode !== 0) {
    throw new Error(`Could not resolve repository HEAD: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
  }
  const actual = result.stdout.trim();
  if (actual.toLowerCase() !== revision.toLowerCase()) {
    throw new Error(`Pinned revision ${revision} does not match repository HEAD ${actual}.`);
  }
  return actual.toLowerCase();
}

async function verifyCleanWorktree(repoRoot, commandRunner, phase) {
  const result = await commandRunner({
    id: `repository-cleanliness-${phase}`,
    kind: 'repository-status',
    executable: 'git',
    args: ['-C', repoRoot, 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignore-submodules=none'],
    cwd: repoRoot,
    env: {},
  });
  if (result.exitCode !== 0) {
    throw new Error(`Could not inspect repository worktree: ${result.stderr.trim() || `exit ${result.exitCode}`}`);
  }
  if (result.stdout.length > 0) {
    const entries = result.stdout.split('\0').filter(Boolean);
    const statusCodes = [...new Set(entries.map((entry) => entry.slice(0, 2)))].sort();
    const error = new Error(
      `Repository worktree is not clean during ${phase}: ${entries.length} changed path(s) (${statusCodes.join(', ')}).`,
    );
    error.code = 'ARCHIFY_SUITE_DIRTY_REPOSITORY';
    error.phase = phase;
    error.changedPaths = entries.length;
    error.statusCodes = statusCodes;
    throw error;
  }
}

async function verifyPinnedCheckout(repoRoot, revision, commandRunner, phase) {
  const actual = await verifyPinnedRevision(repoRoot, revision, commandRunner);
  await verifyCleanWorktree(repoRoot, commandRunner, phase);
  return actual;
}

function ensureFreshOutput(outputRoot, diagrams) {
  fs.mkdirSync(outputRoot, { recursive: true });
  for (const name of [
    'README.md',
    'suite-result.json',
    'project-index.json',
    'suite-timing.events.jsonl',
    'suite-timing.json',
  ]) {
    if (fs.existsSync(path.join(outputRoot, name))) {
      throw new Error(`Suite output already exists: ${path.join(outputRoot, name)}`);
    }
  }
  for (const diagram of diagrams) {
    if (fs.existsSync(diagram.outputDirectory) && fs.readdirSync(diagram.outputDirectory).length > 0) {
      throw new Error(`Diagram output directory is not empty: ${diagram.outputDirectory}`);
    }
  }
}

/**
 * Deep suite orchestration module. The external interface supplies one
 * manifest, one repository pin, one output root, and one command-runner
 * adapter; command typing, isolation, timing, receipts, and reporting stay
 * local to the implementation.
 */
export async function runSuite({
  manifestPath,
  repoRoot,
  revision,
  outputRoot,
  archifyCli,
  concurrency = 1,
  commandRunner = spawnCommandRunner,
  candidatePreflightRunner = runCandidatePreflightBatch,
}) {
  const absoluteManifest = path.resolve(assertString(manifestPath, 'manifestPath'));
  const absoluteRepo = path.resolve(assertString(repoRoot, 'repoRoot'));
  const absoluteOutput = path.resolve(assertString(outputRoot, 'outputRoot'));
  const absoluteCli = path.resolve(assertString(archifyCli, 'archifyCli'));
  if (!fs.statSync(absoluteRepo).isDirectory()) throw new Error(`repoRoot is not a directory: ${absoluteRepo}`);
  if (!fs.statSync(absoluteCli).isFile()) throw new Error(`archifyCli is not a file: ${absoluteCli}`);
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive integer.');

  const manifest = jsonClone(JSON.parse(fs.readFileSync(absoluteManifest, 'utf8')), 'manifest');
  const normalized = normalizeManifest(manifest, absoluteManifest, absoluteOutput);
  const pinnedRevision = await verifyPinnedCheckout(
    absoluteRepo,
    assertString(revision, 'revision'),
    commandRunner,
    'suite-start',
  );
  const suite = {
    ...normalized,
    outputRoot: absoluteOutput,
    repository: { root: absoluteRepo, revision: pinnedRevision },
    browserPreflightGate: serialGate(),
  };
  ensureFreshOutput(absoluteOutput, suite.diagrams);
  const suiteEventsPath = path.join(absoluteOutput, 'suite-timing.events.jsonl');
  const suiteTimingPath = path.join(absoluteOutput, 'suite-timing.json');
  const suiteRecorder = RunRecorder.open({
    run: {
      id: suite.id,
      suiteId: suite.id,
      repository: suite.repository,
      outputDirectory: absoluteOutput,
    },
    eventsPath: suiteEventsPath,
    timingPath: suiteTimingPath,
  });

  const capability = await runCapabilityGate({
    suite,
    archifyCli: absoluteCli,
    commandRunner,
    recorder: suiteRecorder,
  });
  suite.chromeCapability = {
    receipt: capability.receipt,
    durationMs: capability.durationMs,
  };
  let suiteError = capability.error || null;
  let prepared = [];
  let results = [];

  if (!suiteError && suite.projectIndex) {
    try {
      await suiteRecorder.stage('projectIndex', async (stage) => {
        const index = await stage.span('build', async () => buildProjectIndex({
          repoRoot: absoluteRepo,
          revision: pinnedRevision,
        }));
        suite.projectIndexDocument = index;
        const indexPath = path.join(absoluteOutput, 'project-index.json');
        const indexBytes = Buffer.from(`${JSON.stringify(index, null, 2)}\n`);
        writeNewFile(indexPath, indexBytes);
        suite.projectIndexReceipt = {
          schemaVersion: index.schemaVersion,
          path: indexPath,
          digest: index.digest,
          bytes: indexBytes.byteLength,
          sha256: createHash('sha256').update(indexBytes).digest('hex'),
          repository: {
            origin: index.repository.origin,
            revision: index.repository.revision,
          },
          files: index.files.length,
          filesAnalyzed: index.analysis.filesAnalyzed,
          packages: index.packages.length,
        };
        stage.milestone('projectIndexReady', suite.projectIndexReceipt);
      });
    } catch (error) {
      suiteError = error;
    }
  }

  if (!suiteError && suite.sharedViewportPreflight) {
    try {
      await suiteRecorder.stage('candidatePreflightBatch', async (stage) => {
        for (const diagram of suite.diagrams) verifyCandidateRevision(diagram, suite.repository.revision);
        const result = await stage.span('shared-browser-session', async () => candidatePreflightRunner({
          skillRoot: path.dirname(path.dirname(absoluteCli)),
          quality: suite.qualityProfile,
          candidates: suite.diagrams.map((diagram) => ({
            id: diagram.id,
            type: diagram.type,
            input: diagram.candidatePath,
            requiredLanguage: suite.authoredLanguage,
            ...(diagram.type === 'architecture' ? { repoRoot: suite.repository.root } : {}),
          })),
        }));
        suite.sharedViewportPreflightReceipt = result.receipt;
        suite.sharedPreflightReceipts = Object.fromEntries(
          (result.receipt?.candidates || []).map((receipt) => [receipt.id, receipt]),
        );
        stage.milestone('candidatePreflightBatchResult', {
          status: result.receipt?.status,
          candidates: result.receipt?.candidates?.length || 0,
          sharedSession: result.receipt?.session?.shared === true,
        });
        if (result.exitCode !== 0 || result.receipt?.ok !== true) {
          const error = new Error(`Shared candidate preflight ${result.receipt?.status || 'failed'} with exit code ${result.exitCode}.`);
          error.code = 'ARCHIFY_SUITE_CANDIDATE_PREFLIGHT';
          error.exitCode = result.exitCode;
          throw error;
        }
        for (const diagram of suite.diagrams) {
          verifySharedCandidateDigest(
            diagram,
            suite.sharedPreflightReceipts[diagram.id],
            suite.authoredLanguage,
          );
        }
      });
    } catch (error) {
      suiteError = error;
    }
  }

  if (!suiteError) {
    try {
      prepared = await suiteRecorder.stage('diagramRuns', async (stage) => mapWithConcurrency(
        suite.diagrams,
        concurrency,
        (diagram) => stage.span(
          diagram.id,
          async () => runDiagramUntilVisual({ suite, diagram, archifyCli: absoluteCli, commandRunner }),
          { diagramType: diagram.type },
        ),
      ));
    } catch (error) {
      suiteError = error;
    }
  }

  if (!suiteError) {
    let projectIndexIntegrityChecked = false;
    const pendingVisual = prepared.filter((entry) => entry.pendingVisual === true);
    const alreadyFinalized = prepared.filter((entry) => entry.pendingVisual !== true);
    let finalizedVisual = [];
    if (pendingVisual.length > 0) {
      const batch = await runVisualBatch({
        suite,
        contexts: pendingVisual,
        archifyCli: absoluteCli,
        commandRunner,
        recorder: suiteRecorder,
      });
      suite.visualCheckBatch = {
        receipt: batch.receipt,
        durationMs: batch.durationMs,
        artifacts: pendingVisual.map((context) => context.diagram.artifactPath),
      };
      const projectIndexIntegrityError = sanitizeProjectIndexEvidence(suite, pendingVisual);
      projectIndexIntegrityChecked = true;
      finalizedVisual = await suiteRecorder.stage('visualReceiptFanout', async (stage) => Promise.all(
        pendingVisual.map((context) => stage.span(
          context.diagram.id,
          async () => completeDiagramVisual(context, {
            ...mappedVisualReceipt(context, batch),
            batchDurationMs: batch.durationMs,
            finalIntegrityError: projectIndexIntegrityError,
          }),
          { diagramType: context.diagram.type, sharedBatchDurationMs: batch.durationMs },
        )),
      ));
      if (batch.error) suiteError = batch.error;
      else if (projectIndexIntegrityError) suiteError = projectIndexIntegrityError;
    }
    const finalizedById = new Map([...alreadyFinalized, ...finalizedVisual]
      .map((result) => [result.diagram.id, result]));
    results = suite.diagrams.map((diagram) => finalizedById.get(diagram.id)).filter(Boolean);
    if (!projectIndexIntegrityChecked && suite.projectIndexReceipt) {
      const projectIndexIntegrityError = sanitizeProjectIndexEvidence(suite, []);
      if (projectIndexIntegrityError && !suiteError) suiteError = projectIndexIntegrityError;
    }
  }

  try {
    await suiteRecorder.stage('repositoryIntegrity', async (stage) => {
      await stage.span('pinned-clean-checkout', async () => verifyPinnedCheckout(
        absoluteRepo,
        pinnedRevision,
        commandRunner,
        'suite-finalization',
      ));
      stage.milestone('repositoryIntegrityVerified', { revision: pinnedRevision, clean: true });
    });
  } catch (error) {
    if (!suiteError) suiteError = error;
  }

  suite.automationError = suiteError ? {
    name: suiteError.name || 'Error',
    message: suiteError.message || String(suiteError),
    ...(suiteError.code ? { code: suiteError.code } : {}),
  } : null;
  suite.suiteTimingPath = suiteTimingPath;
  suite.suiteEventsPath = suiteEventsPath;
  let report;
  await suiteRecorder.stage('reporting', async () => {
    report = renderSuiteReport({ suite, results, outputRoot: absoluteOutput });
    writeNewFile(path.join(absoluteOutput, 'README.md'), report.markdown);
  });

  const activeDiagramMs = results.reduce((sum, result) => sum + result.timing.stages.reduce(
    (stageSum, stage) => stageSum + (stage.metadata?.sharedBatch ? 0 : (stage.durationMs || 0)),
    0,
  ), 0);
  const sharedVisualCheckMs = suite.visualCheckBatch?.durationMs || 0;
  const accounting = {
    activeDiagramMs,
    sharedVisualCheckMs,
    aggregateWorkMs: activeDiagramMs + sharedVisualCheckMs,
    sharedVisualCountedOnce: true,
  };

  const finalReceipt = {
    schemaVersion: 1,
    kind: 'archify.suite-run',
    status: suiteError || results.some((result) => result.timing.status !== 'completed')
      ? 'failed'
      : 'completed',
    repository: suite.repository,
    quality: {
      profile: suite.qualityProfile,
      authoredLanguage: suite.authoredLanguage,
      viewportPreflight: suite.viewportPreflight,
      sharedViewportPreflight: suite.sharedViewportPreflight,
    },
    chromeCapability: suite.chromeCapability,
    ...(suite.sharedViewportPreflightReceipt
      ? { candidatePreflightBatch: suite.sharedViewportPreflightReceipt }
      : {}),
    ...(suite.visualCheckBatch ? { visualCheckBatch: suite.visualCheckBatch } : {}),
    ...(suite.projectIndexReceipt ? { projectIndex: suite.projectIndexReceipt } : {}),
    plannedDiagrams: suite.diagrams.map((diagram) => ({ id: diagram.id, type: diagram.type })),
    accounting,
    diagrams: results.map((result) => ({
      id: result.diagram.id,
      type: result.diagram.type,
      status: result.timing.status,
      timing: result.timingPath,
      finalReceipt: result.timing.finalReceipt,
    })),
    ...(suite.automationError ? { error: suite.automationError } : {}),
  };
  const suiteTiming = suiteRecorder.finalize({
    status: finalReceipt.status === 'completed' ? 'completed' : 'failed',
    finalReceipt,
  });
  const summary = {
    schemaVersion: 1,
    kind: 'archify.suite-result',
    id: suite.id,
    status: report.status,
    repository: suite.repository,
    qualityProfile: suite.qualityProfile,
    authoredLanguage: suite.authoredLanguage,
    viewportPreflight: suite.viewportPreflight,
    sharedViewportPreflight: suite.sharedViewportPreflight,
    chromeCapability: suite.chromeCapability,
    ...(suite.sharedViewportPreflightReceipt
      ? { candidatePreflightBatch: suite.sharedViewportPreflightReceipt }
      : {}),
    ...(suite.visualCheckBatch ? { visualCheckBatch: suite.visualCheckBatch } : {}),
    ...(suite.projectIndexReceipt ? { projectIndex: suite.projectIndexReceipt } : {}),
    report: path.join(absoluteOutput, 'README.md'),
    timing: suiteTimingPath,
    events: suiteEventsPath,
    diagrams: results.map((result) => ({
      id: result.diagram.id,
      type: result.diagram.type,
      status: result.timing.status,
      timing: result.timingPath,
      events: result.eventsPath,
      artifact: result.artifactPath,
      visualReview: result.visualReviewPath,
    })),
    accounting,
    finalReceipt: suiteTiming.finalReceipt,
  };
  writeNewJson(path.join(absoluteOutput, 'suite-result.json'), summary);
  return summary;
}
