#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertThirdPartyNotices } from './third-party-notices-contract.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const noticeComparisonRoot = path.resolve(
  process.env.ARCHIFY_PACKAGE_SMOKE_NOTICE_ROOT || repoRoot,
);
const defaultPackageRoot = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, 'archify-package', 'archify')
  : path.join(repoRoot, 'archify');
const skillRoot = path.resolve(process.argv[2] || defaultPackageRoot);
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const updateChecker = path.join(skillRoot, 'scripts', 'check-update.mjs');
const updateContract = path.join(skillRoot, 'scripts', 'update-contract.mjs');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-smoke-'));

function requireAbsent(relative) {
  if (fs.existsSync(path.join(skillRoot, relative))) {
    throw new Error(`packaged skill must not contain ${relative}`);
  }
}

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error([
      `archify ${args.join(' ')} failed with ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout;
}

function runExpectFailure(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    ...options,
  });
  if (result.status === 0) throw new Error(`archify ${args.join(' ')} unexpectedly passed`);
  return result.stdout;
}

function runGit(repository, args) {
  const result = spawnSync('git', ['-C', repository, ...args], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error([
      `git ${args.join(' ')} failed with ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout.trim();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function internalStructurePayload(html) {
  const matches = [...html.matchAll(
    /<script id="archify-internal-structure-data" type="application\/json">([\s\S]*?)<\/script>/g,
  )];
  if (matches.length !== 1) {
    throw new Error(`packaged Architecture must contain one internal structure payload, found ${matches.length}`);
  }
  const body = matches[0][1];
  let chunks;
  let data;
  try {
    chunks = JSON.parse(body);
    if (!Array.isArray(chunks) || chunks.some((chunk) => typeof chunk !== 'string')) {
      throw new Error('outer payload is not a string-chunk array');
    }
    data = JSON.parse(chunks.join(''));
  } catch (error) {
    throw new Error(`packaged internal structure payload is not decodable: ${error.message}`);
  }
  if (data?.schemaVersion !== 1 || !data.nodes || Array.isArray(data.nodes)
    || typeof data.nodes !== 'object') {
    throw new Error('packaged internal structure payload has an invalid envelope');
  }
  return { body, data };
}

function expectedInternalStructureReceipt(payload) {
  const structures = Object.values(payload.data.nodes);
  return {
    schemaVersion: 1,
    nodeCount: structures.length,
    itemCount: structures.reduce((count, structure) => count + structure.items.length, 0),
    relationCount: structures.reduce((count, structure) => count + structure.relations.length, 0),
    sourceCount: structures.reduce((count, structure) => count + structure.sources.length, 0),
    bytes: Buffer.byteLength(payload.body),
    sha256: sha256(payload.body),
  };
}

function requireInternalStructureReceipt(actual, expected, context) {
  for (const field of ['schemaVersion', 'nodeCount', 'itemCount', 'relationCount', 'sourceCount', 'bytes', 'sha256']) {
    if (actual?.[field] !== expected[field]) {
      throw new Error(`${context} internal structure receipt has invalid ${field}`);
    }
  }
}

try {
  if (!fs.existsSync(cli)) throw new Error(`packaged CLI not found at ${cli}`);
  requireAbsent('node_modules');
  requireAbsent('package-lock.json');
  requireAbsent(path.join('scripts', 'generate-validators.mjs'));
  requireAbsent(path.join('scripts', 'generate-brand-marks.mjs'));
  requireAbsent('test');
  requireAbsent('.hive');
  requireAbsent('.workbuddy');

  const packageLicensePath = path.join(skillRoot, 'LICENSE');
  if (!fs.existsSync(packageLicensePath)) {
    throw new Error('packaged skill is missing LICENSE');
  }
  const packageLicense = fs.readFileSync(packageLicensePath, 'utf8');
  const packageLicenseLines = packageLicense.split(/\r?\n/);
  if (!packageLicenseLines.includes('Copyright (c) 2025 Cocoon AI')) {
    throw new Error('packaged LICENSE is missing the exact Cocoon AI copyright line');
  }
  const repositoryLicense = fs.readFileSync(path.join(repoRoot, 'LICENSE'), 'utf8');
  if (packageLicense !== repositoryLicense) {
    throw new Error('packaged LICENSE must byte-match the repository LICENSE');
  }
  if (!packageLicense.includes('The above copyright notice and this permission notice shall be included in all')) {
    throw new Error('packaged LICENSE is missing the MIT notice-preservation terms');
  }

  const packageNoticesPath = path.join(skillRoot, 'THIRD_PARTY_NOTICES.md');
  if (!fs.existsSync(packageNoticesPath)) {
    throw new Error('packaged skill is missing THIRD_PARTY_NOTICES.md');
  }
  const packageNotices = fs.readFileSync(packageNoticesPath, 'utf8');
  const repositoryNotices = fs.readFileSync(path.join(noticeComparisonRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const embeddedFonts = /data:font\/woff2/.test(fs.readFileSync(path.join(skillRoot, 'assets/template.html'), 'utf8'));
  if (embeddedFonts && !fs.existsSync(path.join(skillRoot, 'assets/JetBrainsMono-OFL.txt'))) {
    throw new Error('embedded viewer font requires assets/JetBrainsMono-OFL.txt');
  }
  assertThirdPartyNotices(repositoryNotices, 'repository THIRD_PARTY_NOTICES.md', { embeddedFonts });
  assertThirdPartyNotices(packageNotices, 'packaged THIRD_PARTY_NOTICES.md', { embeddedFonts });
  if (packageNotices !== repositoryNotices) {
    throw new Error('packaged THIRD_PARTY_NOTICES.md must byte-match the repository notice');
  }

  if (!fs.existsSync(updateChecker)) {
    throw new Error(`packaged update checker not found at ${updateChecker}`);
  }
  if (!fs.existsSync(updateContract)) {
    throw new Error(`packaged update contract not found at ${updateContract}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(path.join(skillRoot, 'package.json'), 'utf8'));
  const dependencyFields = [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
    'bundledDependencies',
    'bundleDependencies',
  ];
  const declaredDependencyField = dependencyFields.find((field) => (
    Object.prototype.hasOwnProperty.call(packageJson, field)
  ));
  if (declaredDependencyField) {
    throw new Error(`packaged skill must not declare dependency metadata: ${declaredDependencyField}`);
  }

  const skillRelease = JSON.parse(fs.readFileSync(path.join(skillRoot, 'skill-release.json'), 'utf8'));
  const contract = await import(pathToFileURL(updateContract).href);
  let validatedRelease;
  try {
    validatedRelease = contract.validateLocalRelease(skillRelease);
  } catch {
    throw new Error('packaged skill-release.json violates the shared update contract');
  }
  if (validatedRelease.version !== packageJson.version) {
    throw new Error('packaged skill-release.json does not match the package release identity');
  }

  const updateCheck = spawnSync(process.execPath, [updateChecker], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_UPDATE_CHECK_DISABLED: '1' },
  });
  if (updateCheck.status !== 0) {
    throw new Error(`packaged update checker failed with ${updateCheck.status}\n${updateCheck.stderr}`);
  }
  let updateReceipt;
  try {
    updateReceipt = JSON.parse(updateCheck.stdout);
  } catch {
    throw new Error('packaged update checker did not return valid JSON');
  }
  if (updateReceipt.status !== 'silent' || updateReceipt.reason !== 'disabled') {
    throw new Error('packaged update checker did not honor the local disable switch');
  }

  const checker = await import(pathToFileURL(updateChecker).href);
  const versionCore = /^(\d+)\.(\d+)\.(\d+)/.exec(packageJson.version);
  if (!versionCore) throw new Error('package version cannot produce an update-check smoke candidate');
  const candidateVersion = `${versionCore[1]}.${versionCore[2]}.${BigInt(versionCore[3]) + 1n}`;
  const candidate = {
    schemaVersion: 1,
    skillId: 'archify',
    channel: 'stable',
    version: candidateVersion,
    publishedAt: '2026-08-28T00:00:00Z',
    source: {
      repository: 'https://github.com/tt-a1i/archify',
      ref: `v${candidateVersion}`,
      treeSha: 'a'.repeat(40),
    },
    artifact: { sha256: 'b'.repeat(64) },
    summary: 'Package smoke candidate.',
    releaseNotes: `https://github.com/tt-a1i/archify/releases/tag/v${candidateVersion}`,
    severity: 'normal',
  };
  const notifierCache = path.join(scratch, 'update-cache');
  const notifierReceipt = await checker.checkForUpdate({
    cacheDirectory: notifierCache,
    fetchImpl: async () => new Response(JSON.stringify(candidate), {
      status: 200,
      headers: { 'content-type': 'application/json', etag: '"package-smoke"' },
    }),
    now: () => Date.parse('2026-08-28T00:00:00Z'),
    random: () => 0.5,
  });
  if (notifierReceipt.status !== 'update_available') {
    throw new Error(`packaged update checker did not return an update candidate: ${JSON.stringify(notifierReceipt)}`);
  }
  const notifierAcknowledgement = await checker.acknowledgeUpdate({
    releasePath: path.join(skillRoot, 'skill-release.json'),
    cacheDirectory: notifierCache,
    eventKey: notifierReceipt.eventKey,
    now: () => Date.parse('2026-08-28T00:00:01Z'),
  });
  if (notifierAcknowledgement.status !== 'acknowledged') {
    throw new Error('packaged update checker did not persist a visible-notice acknowledgement');
  }

  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  const skillReferences = [...skill.matchAll(
    /`((?:assets|bin|examples|recipes|references|renderers|schemas|scripts)\/[^`\s]+)`/g,
  )]
    .map((match) => match[1])
    .filter((reference) => !/[<>{}*\[\]]/.test(reference));
  if (skillReferences.length === 0) {
    throw new Error('packaged SKILL.md did not expose any literal package paths');
  }
  for (const reference of new Set(skillReferences)) {
    if (!fs.existsSync(path.join(skillRoot, reference))) {
      throw new Error(`packaged SKILL.md references missing path ${reference}`);
    }
  }

  run(['--help']);
  run(['doctor']);
  const brands = JSON.parse(run(['brands', 'openai', '--json']));
  if (!brands.marks.some((mark) => mark.id === 'openai')) {
    throw new Error('packaged brand catalogue did not resolve openai');
  }
  const capturedPreset = JSON.parse(run(['brands', 'capture', 'https://github.com/', '--json']));
  if (capturedPreset.brand !== 'github' || capturedPreset.evidence.status !== 'preset') {
    throw new Error('packaged brand capture did not resolve a known domain without network capture');
  }
  run(['demo', path.join(scratch, 'demo')]);
  run(['examples']);

  const fixtures = [
    ['architecture', 'production-deployment.architecture.json'],
    ['workflow', 'agent-tool-call.workflow.json'],
    ['sequence', 'cache-miss-request.sequence.json'],
    ['dataflow', 'product-analytics.dataflow.json'],
    ['lifecycle', 'agent-run.lifecycle.json'],
  ];
  for (const [mode, fixture] of fixtures) {
    const receipt = JSON.parse(run([
      'validate', mode, path.join(skillRoot, 'examples', fixture), '--json',
    ]));
    if (!receipt.ok || receipt.type !== mode) {
      throw new Error(`${mode} package validation returned an invalid receipt`);
    }
    if (mode === 'architecture' && receipt.engineeringProfile !== 'deployment-ownership') {
      throw new Error('deployment package validation omitted the engineering profile receipt');
    }
  }

  const workflowLayout = JSON.parse(run([
    'validate', 'workflow', path.join(skillRoot, 'examples', fixtures[1][1]),
    '--layout-json', '--quality', 'showcase',
  ]));
  if (workflowLayout.contract !== 'readable-v2'
    || workflowLayout.columns?.length !== 6
    || workflowLayout.diagnostics?.length !== 0) {
    throw new Error('packaged workflow compiler did not expose a passing readable-v2 layout receipt');
  }

  const legacyWorkflow = {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: {
      title: 'Package migration smoke',
      output: 'package-migration-smoke.html',
      viewBox: [720, 400],
      legend: { mode: 'hidden' },
    },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'source', lane: 'main', col: 0, type: 'frontend', label: 'Source' },
      { id: 'target', lane: 'main', col: 2, type: 'backend', label: 'Target' },
    ],
    edges: [{ id: 'flow', from: 'source', to: 'target', label: 'request' }],
  };
  const legacyWorkflowPath = path.join(scratch, 'legacy.workflow.json');
  const migratedWorkflowPath = path.join(scratch, 'migrated.workflow.json');
  const migratedAgainPath = path.join(scratch, 'migrated-again.workflow.json');
  fs.writeFileSync(legacyWorkflowPath, `${JSON.stringify(legacyWorkflow, null, 2)}\n`);
  const migrationReceipt = JSON.parse(run([
    'migrate', 'workflow', legacyWorkflowPath, migratedWorkflowPath,
    '--to-schema', '2', '--json',
  ]));
  if (!migrationReceipt.ok || migrationReceipt.fromSchemaVersion !== 1
    || migrationReceipt.toSchemaVersion !== 2 || !fs.existsSync(migratedWorkflowPath)) {
    throw new Error('packaged workflow migrator did not produce a schema-v2 destination');
  }
  const idempotenceReceipt = JSON.parse(run([
    'migrate', 'workflow', migratedWorkflowPath, migratedAgainPath,
    '--to-schema', '2', '--json',
  ]));
  if (!idempotenceReceipt.ok || idempotenceReceipt.fromSchemaVersion !== 2
    || idempotenceReceipt.source?.sha256 !== idempotenceReceipt.destination?.sha256
    || !fs.readFileSync(migratedWorkflowPath).equals(fs.readFileSync(migratedAgainPath))) {
    throw new Error('packaged workflow migrator did not preserve byte-identical v2 idempotence');
  }

  const deployment = path.join(scratch, 'deployment.html');
  run(['render', 'architecture', path.join(skillRoot, 'examples', fixtures[0][1]), deployment]);
  run(['check', deployment]);

  const structureRepository = path.join(scratch, 'structure-repository');
  fs.mkdirSync(path.join(structureRepository, 'src'), { recursive: true });
  fs.writeFileSync(path.join(structureRepository, 'src', 'handler.js'), [
    'export function registerHandler(input) {',
    '  return input;',
    '}',
    '',
  ].join('\n'));
  runGit(structureRepository, ['init', '--quiet']);
  runGit(structureRepository, ['config', 'user.name', 'Archify Package Smoke']);
  runGit(structureRepository, ['config', 'user.email', 'archify@example.test']);
  runGit(structureRepository, ['config', 'commit.gpgSign', 'false']);
  const structureRepositoryUrl = 'https://github.com/example/archify-package-structure.git';
  runGit(structureRepository, ['remote', 'add', 'origin', structureRepositoryUrl]);
  runGit(structureRepository, ['add', 'src/handler.js']);
  runGit(structureRepository, ['commit', '--quiet', '-m', 'internal structure fixture']);
  const structureRevision = runGit(structureRepository, ['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(structureRevision)) {
    throw new Error('package internal structure fixture did not produce a fixed Git revision');
  }

  const structureSentinel = 'package-structure-only-sentinel';
  const structureDiagram = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: {
      title: 'Package Internal Structure',
      output: 'package-internal-structure.html',
      repository: {
        url: structureRepositoryUrl,
        revision: structureRevision,
        link_mode: 'local-only',
      },
    },
    components: [{
      id: 'handler',
      type: 'backend',
      label: 'Request Handler',
      pos: [120, 120],
      size: [180, 72],
      internal_structure: {
        sources: [{
          id: 'handler-definition',
          role: 'definition',
          path: 'src/handler.js',
          line: 1,
          end_line: 3,
          symbol: 'registerHandler',
        }],
        items: [
          { id: 'src', domain: 'code', kind: 'directory', label: 'src', summary: structureSentinel },
          { id: 'handler-file', domain: 'code', kind: 'file', label: 'handler.js', parent: 'src', summary: 'Request handler implementation.', source_refs: ['handler-definition'] },
          { id: 'register-handler', domain: 'code', kind: 'function', label: 'registerHandler', parent: 'handler-file', signature: 'registerHandler(input)', summary: 'Accepts one input and returns it.', source_refs: ['handler-definition'] },
        ],
        relations: [],
      },
    }],
  };
  const structureInput = path.join(structureRepository, 'structure.architecture.json');
  fs.writeFileSync(structureInput, `${JSON.stringify(structureDiagram, null, 2)}\n`);
  const structureFirstOutput = path.join(scratch, 'structure-first.html');
  const structureSecondOutput = path.join(scratch, 'structure-second.html');
  const structureFirstReceipt = JSON.parse(run([
    'deliver', 'architecture', structureInput, structureFirstOutput,
    '--repo-root', structureRepository, '--json',
  ]));
  const structureSecondReceipt = JSON.parse(run([
    'deliver', 'architecture', structureInput, structureSecondOutput,
    '--repo-root', structureRepository, '--json',
  ]));
  const structureFirstHtml = fs.readFileSync(structureFirstOutput, 'utf8');
  const structureSecondHtml = fs.readFileSync(structureSecondOutput, 'utf8');
  if (sha256(structureFirstHtml) !== sha256(structureSecondHtml)) {
    throw new Error('packaged internal structure delivery is not byte-deterministic');
  }
  const structurePayload = internalStructurePayload(structureFirstHtml);
  const structureNode = structurePayload.data.nodes.handler;
  if (structureNode?.items?.[0]?.summary !== structureSentinel
    || structureNode?.items?.[2]?.id !== 'register-handler') {
    throw new Error('packaged internal structure payload did not preserve the authored node structure');
  }
  const structureReceipt = expectedInternalStructureReceipt(structurePayload);
  requireInternalStructureReceipt(structureFirstReceipt.internalStructure, structureReceipt, 'first delivery');
  requireInternalStructureReceipt(structureSecondReceipt.internalStructure, structureReceipt, 'second delivery');
  if (structureFirstReceipt.evidence?.revision !== structureRevision
    || structureFirstReceipt.evidence?.references !== 1) {
    throw new Error('packaged internal structure delivery omitted its fixed source evidence receipt');
  }
  const canonicalSvg = structureFirstHtml.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] || '';
  if (!canonicalSvg || canonicalSvg.includes(structureSentinel)
    || canonicalSvg.includes('register-handler')) {
    throw new Error('packaged internal structure content leaked into the canonical SVG');
  }

  const structureAtlasInput = path.join(structureRepository, 'structure.atlas.json');
  fs.writeFileSync(structureAtlasInput, `${JSON.stringify({
    atlas_version: 1,
    entry: 'structure',
    meta: { title: 'Package Internal Structure Atlas' },
    diagrams: { structure: { source: 'structure.architecture.json' } },
  }, null, 2)}\n`);
  const structureAtlasFirstOutput = path.join(scratch, 'structure-atlas-first.html');
  const structureAtlasSecondOutput = path.join(scratch, 'structure-atlas-second.html');
  const structureAtlasFirstReceipt = JSON.parse(run([
    'deliver', 'atlas', structureAtlasInput, structureAtlasFirstOutput,
    '--repo-root', structureRepository, '--json',
  ]));
  run([
    'deliver', 'atlas', structureAtlasInput, structureAtlasSecondOutput,
    '--repo-root', structureRepository, '--json',
  ]);
  const structureAtlasFirstHtml = fs.readFileSync(structureAtlasFirstOutput, 'utf8');
  const structureAtlasSecondHtml = fs.readFileSync(structureAtlasSecondOutput, 'utf8');
  if (sha256(structureAtlasFirstHtml) !== sha256(structureAtlasSecondHtml)) {
    throw new Error('packaged Atlas internal structure delivery is not byte-deterministic');
  }
  requireInternalStructureReceipt(
    structureAtlasFirstReceipt.members?.structure?.internalStructure,
    structureReceipt,
    'first Atlas member',
  );
  const invalidStructureDiagram = JSON.parse(JSON.stringify(structureDiagram));
  invalidStructureDiagram.components[0].internal_structure.sources[0].symbol = 'missingHandler';
  const invalidStructureInput = path.join(structureRepository, 'invalid-structure.architecture.json');
  const preservedStructureOutput = path.join(scratch, 'preserved-structure.html');
  const preservedStructureContents = 'trusted previous package artifact\n';
  fs.writeFileSync(invalidStructureInput, `${JSON.stringify(invalidStructureDiagram, null, 2)}\n`);
  fs.writeFileSync(preservedStructureOutput, preservedStructureContents);
  const structureFailure = JSON.parse(runExpectFailure([
    'deliver', 'architecture', invalidStructureInput, preservedStructureOutput,
    '--repo-root', structureRepository, '--json',
  ]));
  if (structureFailure.ok
    || !structureFailure.diagnostics?.some((entry) => entry.code === 'repository-evidence/symbol-missing')) {
    throw new Error('packaged internal structure delivery did not reject invalid pinned symbol evidence');
  }
  if (fs.readFileSync(preservedStructureOutput, 'utf8') !== preservedStructureContents) {
    throw new Error('failed packaged internal structure delivery replaced the previous artifact');
  }

  const compareReceipt = JSON.parse(run([
    'compare', 'architecture',
    path.join(skillRoot, 'examples', 'checkout-platform.base.architecture.json'),
    path.join(skillRoot, 'examples', 'checkout-platform.head.architecture.json'),
    path.join(scratch, 'architecture-delta.html'), '--json',
  ]));
  if (!compareReceipt.ok || compareReceipt.completeness !== 'complete'
    || compareReceipt.validation?.checksPassed !== compareReceipt.validation?.checkCount) {
    throw new Error('packaged Architecture compare did not return a complete passing receipt');
  }

  const delivered = JSON.parse(run([
    'deliver', 'workflow', path.join(skillRoot, 'examples', fixtures[1][1]),
    path.join(scratch, 'workflow-delivered.html'), '--quality', 'showcase', '--json',
  ]));
  if (!delivered.ok || delivered.validation?.compositionStatus !== 'pass'
    || !/^[a-f0-9]{64}$/.test(delivered.specification?.sha256 || '')
    || !(delivered.specification?.bytes > 0)) {
    throw new Error('packaged workflow delivery did not return a passing receipt');
  }

  const visualSkipped = JSON.parse(runExpectFailure([
    'visual-check', delivered.output, '--json',
  ], {
    env: { ...process.env, ARCHIFY_CHROME: path.join(scratch, 'missing-chrome') },
  }));
  if (visualSkipped.status !== 'skipped' || visualSkipped.visualReview !== 'pending'
    || visualSkipped.chrome?.status !== 'unavailable') {
    throw new Error('packaged visual-check did not return the expected Chrome-unavailable receipt');
  }

  const emptyPath = path.join(scratch, 'empty-path');
  fs.mkdirSync(emptyPath);
  const openReceipt = JSON.parse(run([
    'deliver', 'workflow', path.join(skillRoot, 'examples', fixtures[1][1]),
    path.join(scratch, 'workflow-open-fallback.html'), '--open', '--json',
  ], { env: { ...process.env, PATH: emptyPath } }));
  if (!openReceipt.ok || openReceipt.open?.status !== 'unsupported') {
    throw new Error('packaged open fallback did not remain a successful unsupported handoff');
  }

  const invalidWorkflow = JSON.parse(fs.readFileSync(
    path.join(skillRoot, 'examples', fixtures[1][1]), 'utf8',
  ));
  invalidWorkflow.nodes[0].colour = 'cyan';
  const invalidPath = path.join(scratch, 'invalid-workflow.json');
  fs.writeFileSync(invalidPath, JSON.stringify(invalidWorkflow));
  const failure = JSON.parse(runExpectFailure(['validate', 'workflow', invalidPath, '--json']));
  if (failure.ok || !failure.diagnostics?.some((diagnostic) => diagnostic.code === 'schema/additionalProperties')) {
    throw new Error('packaged skill did not return the expected unknown-field diagnostic');
  }

  const tangentEndpoint = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Endpoint direction smoke', output: 'endpoint-direction-smoke.html' },
    components: [
      { id: 'source', type: 'external', label: 'Source', pos: [300, 100], size: [100, 60] },
      { id: 'target', type: 'backend', label: 'Target', pos: [100, 240], size: [100, 60] },
    ],
    connections: [{
      id: 'tangent',
      from: 'source',
      to: 'target',
      fromSide: 'bottom',
      toSide: 'top',
      via: [[350, 200], [100, 200], [100, 240]],
    }],
  };
  const tangentPath = path.join(scratch, 'tangent-endpoint.architecture.json');
  fs.writeFileSync(tangentPath, JSON.stringify(tangentEndpoint));
  const tangentFailure = JSON.parse(runExpectFailure(['validate', 'architecture', tangentPath, '--json']));
  const tangentDiagnostic = tangentFailure.diagnostics?.find((diagnostic) => (
    diagnostic.code === 'clean-flow/endpoint-side-direction'
  ));
  if (tangentFailure.ok || tangentDiagnostic?.evidence?.authoredField !== 'toSide'
    || tangentDiagnostic?.evidence?.side !== 'top') {
    throw new Error('packaged skill did not reject a tangential target-port entry with structured repair evidence');
  }

  const inferredBridge = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Inferred endpoint bridge smoke', output: 'inferred-endpoint-bridge.html' },
    components: [
      { id: 'workspace', type: 'frontend', label: 'Workspace UI', pos: [40, 300], size: [120, 60] },
      { id: 'runtime-server', type: 'backend', label: 'Runtime Server', pos: [220, 300], size: [120, 60] },
      { id: 'runtime-store', type: 'backend', label: 'Runtime Store', pos: [400, 300], size: [120, 60] },
      { id: 'stream-hub', type: 'messagebus', label: 'Terminal Stream Hub', pos: [700, 100], size: [120, 60] },
    ],
    connections: [{ id: 'terminal-return', from: 'stream-hub', to: 'workspace' }],
  };
  const inferredBridgePath = path.join(scratch, 'inferred-bridge.architecture.json');
  const inferredBridgeHtml = path.join(scratch, 'inferred-bridge.html');
  fs.writeFileSync(inferredBridgePath, JSON.stringify(inferredBridge));
  run(['render', 'architecture', inferredBridgePath, inferredBridgeHtml]);
  const inferredBridgeArtifact = fs.readFileSync(inferredBridgeHtml, 'utf8');
  if (!inferredBridgeArtifact.includes('data-composition-points="700,130;184,130;184,330;160,330"')) {
    throw new Error('packaged skill did not preserve inferred endpoint normals with a side-aware bridge');
  }

  process.stdout.write(`package smoke passed on ${process.platform} (${skillRoot})\n`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
