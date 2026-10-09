#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { assertThirdPartyNotices } from './third-party-notices-contract.mjs';
import { verifyPackagedUpdateChecker } from './package-update-smoke.mjs';

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

  await verifyPackagedUpdateChecker(skillRoot, path.join(scratch, 'update-cache'));

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

  // Bundled Viewer catalogs resolve from the installed package, not the cwd,
  // and the artifact embeds only the selected catalog.
  const manifest = JSON.parse(fs.readFileSync(path.join(skillRoot, 'locales', 'manifest.json'), 'utf8'));
  for (const { file } of manifest.catalogs) {
    if (!fs.existsSync(path.join(skillRoot, 'locales', file))) {
      throw new Error(`packaged locale manifest lists a missing catalog: ${file}`);
    }
  }
  const localized = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples', fixtures[0][1]), 'utf8'));
  localized.meta.locale = 'ko';
  localized.meta.output = 'localized.html';
  const localizedInput = path.join(scratch, 'localized.architecture.json');
  const localizedOutput = path.join(scratch, 'localized.html');
  fs.writeFileSync(localizedInput, JSON.stringify(localized));
  run(['render', 'architecture', localizedInput, localizedOutput], { cwd: os.tmpdir() });
  const localizedHtml = fs.readFileSync(localizedOutput, 'utf8');
  const embeddedLocale = localizedHtml.match(/<script id="archify-i18n-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!localizedHtml.startsWith('<!DOCTYPE html>\n<html lang="ko"')
    || !localizedHtml.includes('>범례</text>')
    || JSON.parse(embeddedLocale?.[1] || '{}').locale !== 'ko') {
    throw new Error('packaged renderer did not select the bundled ko catalog from meta.locale');
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
  run(['check', inferredBridgeHtml]);
  const inferredBridgeArtifact = fs.readFileSync(inferredBridgeHtml, 'utf8');
  const bridgePoints = inferredBridgeArtifact.match(/data-edge-id="terminal-return"[^>]*data-composition-points="([^"]+)"/)?.[1]
    .split(';').map(point => point.split(',').map(Number));
  // Automatic bend positions may improve; attachment and side normals must hold.
  if (!bridgePoints || bridgePoints.length < 2
    || !bridgePoints.every(point => point.length === 2 && point.every(Number.isFinite))
    || bridgePoints[0][0] !== 700 || bridgePoints[0][1] !== 130
    || bridgePoints[1][1] !== 130 || bridgePoints[1][0] >= 700
    || bridgePoints.at(-1)[0] !== 160 || bridgePoints.at(-1)[1] !== 330
    || bridgePoints.at(-2)[1] !== 330 || bridgePoints.at(-2)[0] <= 160) {
    throw new Error('packaged skill did not preserve inferred endpoint normals with a side-aware bridge');
  }

  process.stdout.write(`package smoke passed on ${process.platform} (${skillRoot})\n`);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
