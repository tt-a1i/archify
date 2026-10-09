#!/usr/bin/env node

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { containedBy, sameEntry } from '../../../archify/renderers/shared/path-semantics.mjs';
import { spawnCli, spawnCliSync } from './resolve-cli.mjs';
import { runWithTransientNetworkRetry } from './transient-retry.mjs';
import { adapterCommit, manifest, release, releaseSnapshot } from './release-source.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const integrationRoot = path.resolve(here, '..');
const repoRoot = path.resolve(integrationRoot, '..', '..');
const PACKAGE_NAME = manifest.name;
const PACKAGE_VERSION = manifest.version;
const DSH_RELEASE_REF = release.sourceCommit;
const DSH_PACKAGE_NAME = '@deepseek-ai/dsh';
const DSH_SPEC = `${DSH_PACKAGE_NAME}@${release.dshVersion}`;
const PROFILE = 'archify-dsh-acceptance';
const UPGRADE_PROFILE = 'archify-dsh-upgrade';
const PREVIOUS_RELEASE = Object.freeze({
  version: '0.1.0',
  skillVersion: '2.14.0',
  integrity: 'sha512-D8fDqV6DV/vo80Gj/3rgidd+hwBbhTVncaVoD5Uhh+DbgYlEoQQOmBVbhU5HW33wE5OqJP/2HkTRPJ0hf7W0tA==',
});
const DSH_RUNTIME_INSTALL_TIMEOUT = process.platform === 'win32' ? 600_000 : 300_000;
const PLUGIN_MUTATION_TIMEOUT = 180_000;

const receipt = {
  ok: false,
  adapter: { name: PACKAGE_NAME, version: PACKAGE_VERSION, commit: adapterCommit },
  dsh: { spec: DSH_SPEC },
  node: process.version,
  platform: process.platform,
  zipContainerNote: 'Canonical Linux CI verifies ZIP container bytes; cross-platform DSH acceptance verifies extracted package content.',
  stages: [],
};

function fail(stage, message, extra = {}) {
  receipt.stages.push({ name: stage, ok: false, error: message, ...extra });
  receipt.ok = false;
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  process.exit(1);
}

function pass(stage, extra = {}) {
  receipt.stages.push({ name: stage, ok: true, ...extra });
}

function run(command, args, options = {}) {
  return spawnCliSync(command, args, {
    encoding: 'utf8',
    ...options,
    env: { ...process.env, ...options.env },
  });
}

function requireStatus(stage, result, extra = {}) {
  if (result.error || result.status !== 0) {
    fail(stage, [
      result.error?.message,
      `${extra.command || 'command'} exited ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'), extra);
  }
}

function listRelativeFiles(root) {
  const files = [];
  function walkDir(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) walkDir(path.join(dir, entry.name), relative);
      else files.push(relative);
    }
  }
  walkDir(root, '');
  return files.sort();
}

function parseDump(yaml) {
  const layers = [];
  const rows = [];
  let layer = { name: 'root', rows: [] };
  let current = null;
  for (const line of yaml.split('\n')) {
    const header = line.match(/^# ==\s+(.+)$/);
    if (header) {
      layer = { name: header[1].trim(), rows: [] };
      layers.push(layer);
      current = null;
      continue;
    }
    const id = line.match(/^- id:\s+(\S+)/);
    if (id) {
      current = { id: id[1].replace(/['"]/g, ''), name: '', config: {} };
      rows.push(current);
      layer.rows.push(current);
      continue;
    }
    if (!current) continue;
    const name = line.match(/^\s+name:\s+(.+)$/);
    if (name) current.name = name[1].replace(/^['"]|['"]$/g, '');
    const provider = line.match(/^\s+providerName:\s+(\S+)/);
    if (provider) current.config.providerName = provider[1];
    const includeDefault = line.match(/^\s+includeDefaultRoots:\s+(\S+)/);
    if (includeDefault) current.config.includeDefaultRoots = includeDefault[1] === 'true';
  }
  return { layers, rows };
}

function waitForProbe(child, file, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const started = Date.now();
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setInterval(() => {
      if (fs.existsSync(file)) {
        finish();
        return;
      }
      if (Date.now() - started > timeoutMs) finish(new Error('skill probe timed out'));
    }, 250);
    child.once('error', (error) => {
      if (fs.existsSync(file)) finish();
      else finish(error);
    });
    child.once('exit', (code, signal) => {
      if (fs.existsSync(file)) finish();
      else finish(new Error(`dsh boot exited ${code} signal ${signal} before writing the skill probe`));
    });
  });
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-dsh-acceptance-'));
const tarball = path.join(scratch, `tt-a1i-archify-dsh-${PACKAGE_VERSION}.tgz`);
const dshHome = path.join(scratch, 'dsh-home');
const agentsHome = path.join(scratch, 'agents-home');
const dshRuntime = path.join(scratch, 'dsh-runtime');
const workspace = path.join(scratch, 'workspace');
fs.mkdirSync(dshHome);
fs.mkdirSync(agentsHome);
fs.mkdirSync(dshRuntime);
fs.mkdirSync(workspace);

function cleanup() {
  fs.rmSync(scratch, { recursive: true, force: true });
}
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

const pack = run(process.execPath, [
  path.join(integrationRoot, 'scripts', 'pack.mjs'),
  '--out', tarball,
  '--json',
], { cwd: repoRoot });
requireStatus('pack', pack, { command: 'pack.mjs' });
let packReceipt;
try {
  packReceipt = JSON.parse(pack.stdout);
} catch (error) {
  fail('pack', `pack did not emit JSON: ${error.message}\n${pack.stdout}`);
}
if (packReceipt.name !== PACKAGE_NAME || packReceipt.version !== PACKAGE_VERSION
  || packReceipt.adapterCommit !== adapterCommit || packReceipt.sourceCommit !== release.sourceCommit
  || !fs.existsSync(tarball)) {
  fail('pack', 'pack receipt identity mismatch', { packReceipt, tarball });
}
pass('pack', { filename: packReceipt.filename, fileCount: packReceipt.files?.length });

const inspectRoot = path.join(scratch, 'tarball');
fs.mkdirSync(inspectRoot);
requireStatus('tarball-inspect', run('tar', ['-xzf', path.basename(tarball), '-C', inspectRoot], {
  cwd: path.dirname(tarball),
}));
const packedPkg = JSON.parse(fs.readFileSync(path.join(inspectRoot, 'package', 'package.json'), 'utf8'));
const packedFiles = listRelativeFiles(path.join(inspectRoot, 'package'));
const forbidden = packedFiles.filter((file) => (
  // path-contract-allow: portable-logical-path -- npm tar entries use normalized slash-separated names.
  file.startsWith('test/')
  || [
    'node_modules/',
    'package-lock.json',
    '.hive',
    '.workbuddy',
    'probe-skills',
    'generate-brand-marks.mjs',
    'generate-validators.mjs',
  // path-contract-allow: portable-logical-path -- Each fragment is matched inside an npm tar entry name.
  ].some((fragment) => file.includes(fragment))
));
if (packedPkg.name !== PACKAGE_NAME || packedPkg.version !== PACKAGE_VERSION || forbidden.length > 0) {
  fail('tarball-inspect', 'packed identity or exclusions failed', { forbidden, packedPkg });
}
if (!packedFiles.includes('skills/archify/SKILL.md')) {
  fail('tarball-inspect', 'packed tarball is missing the clean Archify Skill');
}
pass('tarball-inspect', { fileCount: packedFiles.length });

const dshEnv = {
  ...process.env,
  DSH_HOME: dshHome,
  DSH_AGENTS_HOME: agentsHome,
  DSH_TELEMETRY_DISABLED: '1',
  npm_config_update_notifier: 'false',
};

// Install the pinned host separately from plugin mutation so package-manager
// failures remain distinguishable from `dsh plugin add`. pnpm handles DSH's
// large dependency graph without npm's long silent resolution, while the
// explicit build allowlist keeps lifecycle execution fail-closed.
const runtimeInstallOutcome = runWithTransientNetworkRetry((attempt) => {
  fs.rmSync(dshRuntime, { recursive: true, force: true });
  fs.mkdirSync(dshRuntime);
  if (attempt > 1) {
    process.stderr.write(`Retrying transient DSH runtime install (attempt ${attempt}/2)\n`);
  }
  return run('pnpm', [
    '--dir', dshRuntime,
    'add',
    '--save-exact',
    '--reporter=append-only',
    '--use-stderr',
    '--allow-build=@deepseek-ai/dsh-subprocess-local',
    '--allow-build=@google/genai',
    '--allow-build=koffi',
    '--allow-build=node-pty',
    '--allow-build=protobufjs',
    DSH_SPEC,
  ], {
    cwd: scratch,
    env: dshEnv,
    // Stream npm lifecycle diagnostics without polluting the JSON-only receipt
    // written to this process's stdout.
    stdio: ['ignore', 2, 2],
    timeout: DSH_RUNTIME_INSTALL_TIMEOUT,
  });
});
const runtimeInstall = runtimeInstallOutcome.result;
requireStatus('dsh-runtime-install', runtimeInstall, {
  command: `pnpm add ${DSH_SPEC}`,
  attempts: runtimeInstallOutcome.attempts,
});
const dshPackageRoot = path.join(dshRuntime, 'node_modules', '@deepseek-ai', 'dsh');
const dshManifest = JSON.parse(fs.readFileSync(path.join(dshPackageRoot, 'package.json'), 'utf8'));
const dshBin = path.join(dshPackageRoot, 'lib', 'bin.js');
if (dshManifest.name !== DSH_PACKAGE_NAME || dshManifest.version !== release.dshVersion
  || !fs.existsSync(dshBin)) {
  fail('dsh-runtime-install', 'installed DSH runtime identity mismatch', {
    name: dshManifest.name,
    version: dshManifest.version,
    expectedVersion: release.dshVersion,
    binExists: fs.existsSync(dshBin),
  });
}
pass('dsh-runtime-install', {
  version: dshManifest.version,
  attempts: runtimeInstallOutcome.attempts,
});

function dsh(args, options = {}) {
  return run(process.execPath, [dshBin, ...args], {
    cwd: options.cwd || workspace,
    env: dshEnv,
    timeout: options.timeout ?? 120_000,
  });
}

const install = dsh(['plugin', '--profile', PROFILE, 'add', tarball], { timeout: PLUGIN_MUTATION_TIMEOUT });
requireStatus('plugin-install', install, { command: `dsh plugin --profile ${PROFILE} add <tarball>` });
pass('plugin-install', { profile: PROFILE });

const profileDir = path.join(dshHome, 'profiles', PROFILE);
const profileManifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
const bundles = profileManifest.dsh?.profile?.bundles || [];
const deps = profileManifest.dependencies || {};
if (!bundles.includes(PACKAGE_NAME) || !deps[PACKAGE_NAME]) {
  fail('profile-identity', 'installed profile does not name the real package identity', { bundles, deps });
}
if (String(deps[PACKAGE_NAME]).includes('link:') || String(deps[PACKAGE_NAME]).includes(integrationRoot)) {
  fail('profile-identity', 'profile was installed from a source checkout or link instead of the tarball', { deps });
}
pass('profile-identity', { bundles, dependency: deps[PACKAGE_NAME] });

const dump = dsh(['--profile', PROFILE, '--dump-config']);
requireStatus('compose', dump, { command: 'dsh --dump-config' });
const composed = parseDump(dump.stdout);
const archifyLayer = composed.layers.find((layer) => layer.name === PACKAGE_NAME);
const originalFilesystem = composed.rows.find((row) => row.id === 'skill-filesystem');
const archifyProvider = composed.rows.find((row) => row.id === 'archify-skill-filesystem');
const extraProviders = composed.rows.filter((row) => row.config.providerName === 'archify-plugin');
if (!dump.stdout.includes(`# == ${PACKAGE_NAME}`) || !archifyLayer) {
  fail('compose', 'composed dump does not include the Archify bundle layer', { layers: composed.layers.map((layer) => layer.name) });
}
if (!originalFilesystem || originalFilesystem.config.providerName === 'archify-plugin') {
  fail('compose', 'original DSH skill-filesystem row was replaced', { originalFilesystem });
}
if (!archifyProvider || extraProviders.length !== 1 || archifyLayer.rows.length !== 1) {
  fail('compose', 'composed config did not insert exactly one Archify Skill provider', {
    extra: extraProviders.map((row) => row.id),
    layerRows: archifyLayer.rows.map((row) => row.id),
  });
}
if (archifyProvider.config.includeDefaultRoots !== false || archifyProvider.config.providerName !== 'archify-plugin') {
  fail('compose', 'Archify provider config is not isolated', { archifyProvider });
}
pass('compose', {
  extraIds: archifyLayer.rows.map((row) => row.id),
  providerName: 'archify-plugin',
});

const probePatch = path.join(scratch, 'probe.patch.yml');
const probeModule = path.join(integrationRoot, 'test', 'probe-skills.mjs');
fs.writeFileSync(probePatch, `- insert:
    - id: archify-dsh-skill-probe
      name: ${JSON.stringify(pathToFileURL(probeModule).href)}
      inject: [skills]
`);
async function probeProfile(profile, stage) {
  const probeOut = path.join(scratch, `${stage}-probe.json`);
  const child = spawnCli(process.execPath, [dshBin, '--profile', profile, '--patch', probePatch], {
    cwd: workspace,
    env: { ...dshEnv, ARCHIFY_DSH_PROBE_OUT: probeOut },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  try {
    await waitForProbe(child, probeOut, 90_000);
  } catch (error) {
    child.kill('SIGTERM');
    fail(stage, error.message, { stdout, stderr });
  } finally {
    child.kill('SIGTERM');
  }
  return { probe: JSON.parse(fs.readFileSync(probeOut, 'utf8')), stdout, stderr };
}

const { probe: probeReceipt, stdout: probeStdout, stderr: probeStderr } = await probeProfile(PROFILE, 'skill-discovery');
const archifyHits = (probeReceipt.skills || []).filter((skill) => skill.name === 'archify');
if (archifyHits.length !== 1 || archifyHits[0].provider !== 'archify-plugin') {
  fail('skill-discovery', 'public Skill registry did not discover archify only from archify-plugin', {
    probeReceipt,
    stdout: probeStdout,
    stderr: probeStderr,
  });
}
pass('skill-discovery', { provider: 'archify-plugin' });

if (!probeReceipt.definition?.contentLength || probeReceipt.definition.provider !== 'archify-plugin') {
  fail('skill-load', 'full Skill definition was not loaded', { definition: probeReceipt.definition });
}
pass('skill-load', { contentLength: probeReceipt.definition.contentLength });

const resourcePath = probeReceipt.definition.resourceBase?.path || probeReceipt.definition.path;
const installedPackage = path.join(profileDir, 'node_modules', '@tt-a1i', 'archify-dsh');
let resourceReal;
let packageReal;
try {
  resourceReal = fs.realpathSync(resourcePath);
  packageReal = fs.realpathSync(installedPackage);
} catch (error) {
  fail('resource-base', `cannot realpath installed Skill root: ${error.message}`, { resourcePath, installedPackage });
}
const resourceContainment = containedBy(packageReal, resourceReal);
const expectedResourceRoots = [
  path.join(packageReal, 'skills'),
  path.join(packageReal, 'skills', 'archify'),
];
const expectedResource = expectedResourceRoots.some((candidate) => (
  fs.existsSync(candidate) && sameEntry(candidate, resourceReal).status === 'match'
));
if (resourceContainment.status !== 'match' || !expectedResource) {
  fail('resource-base', 'Skill resource base is not inside the installed tarball package', {
    resourcePath: resourceReal,
    installedPackage: packageReal,
    relation: resourceContainment,
  });
}
pass('resource-base', { resourcePath: resourceReal });

const skillRoot = fs.existsSync(path.join(resourceReal, 'SKILL.md'))
  ? resourceReal
  : path.join(resourceReal, 'archify');
// Exercise the installed CLI without writing into the package manager's store.
const installedCli = path.join(skillRoot, 'bin', 'archify.mjs');
for (const args of [['doctor'], ['demo', path.join(workspace, 'installed-smoke')]]) {
  const installedSmoke = run(process.execPath, [installedCli, ...args], {
    cwd: workspace,
    timeout: 120_000,
  });
  requireStatus('installed-skill-smoke', installedSmoke, { command: `installed archify ${args[0]}` });
}
pass('installed-skill-smoke', { skillRoot, commands: ['doctor', 'demo'] });

const sourceSnapshot = path.join(scratch, 'release-source');
releaseSnapshot(sourceSnapshot);
// The source's full package smoke rewrites bundled example HTML. pnpm may
// hard-link those files to its content store, and Archify correctly refuses
// to replace a multiply linked output. Copy the installed bytes into an owned
// scratch tree for this mutating suite; keep the actual installation intact.
const smokeRoot = path.join(scratch, 'smoke-skill');
fs.cpSync(skillRoot, smokeRoot, { recursive: true, errorOnExist: true, force: false });
const smoke = run(process.execPath, [path.join(sourceSnapshot, 'scripts', 'package-smoke.mjs'), smokeRoot], {
  cwd: sourceSnapshot,
  timeout: 120_000,
});
requireStatus('package-smoke', smoke, { command: `${DSH_RELEASE_REF} package-smoke.mjs <installed-skill-copy>` });
pass('package-smoke', {
  skillRoot,
  smokeRoot,
  source: DSH_RELEASE_REF,
  mutatingExamples: 'isolated-copy-of-installed-skill',
  output: smoke.stdout.trim(),
});

const remove = dsh(['plugin', '--profile', PROFILE, 'remove', PACKAGE_NAME], { timeout: PLUGIN_MUTATION_TIMEOUT });
requireStatus('uninstall', remove, { command: `dsh plugin --profile ${PROFILE} remove ${PACKAGE_NAME}` });
const removedManifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
if ((removedManifest.dsh?.profile?.bundles || []).includes(PACKAGE_NAME)
  || removedManifest.dependencies?.[PACKAGE_NAME]) {
  fail('uninstall', 'adapter dependency or bundle layer remained after plugin remove', { removedManifest });
}
pass('uninstall', { bundles: removedManifest.dsh?.profile?.bundles || [] });

const baseBootDump = dsh(['--profile', PROFILE, '--dump-config']);
requireStatus('base-profile', baseBootDump, { command: 'dsh --dump-config after uninstall' });
const leftover = parseDump(baseBootDump.stdout).rows.filter((row) => (
  row.id === 'archify-skill-filesystem' || row.config.providerName === 'archify-plugin'
));
if (leftover.length > 0) {
  fail('base-profile', 'uninstalled profile still contains the Archify provider', { leftover });
}
pass('base-profile', { bundles: removedManifest.dsh?.profile?.bundles || [] });

// Exercise an existing published installation independently of the clean
// installation above. Pin its registry bytes, not just an npm dist-tag.
const previousSpec = `${PACKAGE_NAME}@${PREVIOUS_RELEASE.version}`;
const previousPack = runWithTransientNetworkRetry(() => run('npm', [
  'pack', previousSpec, '--ignore-scripts', '--json',
  '--registry=https://registry.npmjs.org', '--pack-destination', scratch,
], { cwd: scratch, env: dshEnv, timeout: 120_000 }));
requireStatus('upgrade-baseline-download', previousPack.result, { command: `npm pack ${previousSpec}` });
const previousTarball = path.join(scratch, `tt-a1i-archify-dsh-${PREVIOUS_RELEASE.version}.tgz`);
const previousIntegrity = `sha512-${createHash('sha512').update(fs.readFileSync(previousTarball)).digest('base64')}`;
if (previousIntegrity !== PREVIOUS_RELEASE.integrity) {
  fail('upgrade-baseline-download', 'published baseline tarball integrity mismatch', { previousIntegrity });
}
const previousRoot = path.join(scratch, 'previous-package');
fs.mkdirSync(previousRoot);
requireStatus('upgrade-baseline-download', run('tar', ['-xzf', previousTarball, '-C', previousRoot]));
pass('upgrade-baseline-download', { spec: previousSpec, integrity: previousIntegrity });

async function verifyUpgradeProfile(stage, version, skillVersion, expectedRoot) {
  const root = path.join(dshHome, 'profiles', UPGRADE_PROFILE);
  const installed = path.join(root, 'node_modules', '@tt-a1i', 'archify-dsh');
  const pkg = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
  const skill = path.join(installed, 'skills', 'archify');
  const skillPkg = JSON.parse(fs.readFileSync(path.join(skill, 'package.json'), 'utf8'));
  if (pkg.name !== PACKAGE_NAME || pkg.version !== version || skillPkg.version !== skillVersion) {
    fail(stage, 'installed upgrade identity mismatch', { version: pkg.version, skillVersion: skillPkg.version });
  }
  const expectedFiles = listRelativeFiles(expectedRoot);
  if (JSON.stringify(listRelativeFiles(installed)) !== JSON.stringify(expectedFiles)
    || expectedFiles.some((file) => !fs.readFileSync(path.join(installed, file)).equals(fs.readFileSync(path.join(expectedRoot, file))))) {
    fail(stage, 'installed upgrade payload differs from the verified tarball');
  }
  const config = dsh(['--profile', UPGRADE_PROFILE, '--dump-config']);
  requireStatus(stage, config);
  const rows = parseDump(config.stdout).rows;
  const providers = rows.filter((row) => row.config.providerName === 'archify-plugin');
  if (providers.length !== 1 || providers[0].config.includeDefaultRoots !== false
    || !rows.some((row) => row.id === 'skill-filesystem' && row.config.providerName !== 'archify-plugin')) {
    fail(stage, 'upgrade duplicated the provider or replaced the base Skill provider');
  }
  const { probe } = await probeProfile(UPGRADE_PROFILE, stage);
  const hits = (probe.skills || []).filter((entry) => entry.name === 'archify');
  const resource = probe.definition?.resourceBase?.path || probe.definition?.path;
  const expectedRoots = [path.join(installed, 'skills'), skill];
  if (hits.length !== 1 || hits[0].provider !== 'archify-plugin'
    || !probe.definition?.contentLength || probe.definition.provider !== 'archify-plugin'
    || !resource || !expectedRoots.some((entry) => sameEntry(entry, resource).status === 'match')) {
    fail(stage, 'upgrade did not discover and load exactly one installed Archify Skill', { probe });
  }
  pass(stage, { version, skillVersion, provider: 'archify-plugin', fileCount: expectedFiles.length });
  return skill;
}

requireStatus('upgrade-baseline-install', dsh(['plugin', '--profile', UPGRADE_PROFILE, 'add', previousTarball], {
  timeout: PLUGIN_MUTATION_TIMEOUT,
}));
await verifyUpgradeProfile('upgrade-baseline-load', PREVIOUS_RELEASE.version, PREVIOUS_RELEASE.skillVersion,
  path.join(previousRoot, 'package'));
requireStatus('plugin-upgrade', dsh(['plugin', '--profile', UPGRADE_PROFILE, 'add', tarball], {
  timeout: PLUGIN_MUTATION_TIMEOUT,
}));
const upgradedSkill = await verifyUpgradeProfile('plugin-upgrade-load', PACKAGE_VERSION, release.skillVersion,
  path.join(inspectRoot, 'package'));
for (const args of [['doctor'], ['demo', path.join(workspace, 'upgraded-smoke')]]) {
  requireStatus('upgraded-skill-smoke', run(process.execPath, [path.join(upgradedSkill, 'bin', 'archify.mjs'), ...args], {
    cwd: workspace,
    timeout: 120_000,
  }));
}
pass('upgraded-skill-smoke', { from: PREVIOUS_RELEASE.version, to: PACKAGE_VERSION, commands: ['doctor', 'demo'] });
requireStatus('upgrade-uninstall', dsh(['plugin', '--profile', UPGRADE_PROFILE, 'remove', PACKAGE_NAME], {
  timeout: PLUGIN_MUTATION_TIMEOUT,
}));
const afterUpgrade = JSON.parse(fs.readFileSync(path.join(dshHome, 'profiles', UPGRADE_PROFILE, 'package.json'), 'utf8'));
const afterUpgradeDump = dsh(['--profile', UPGRADE_PROFILE, '--dump-config']);
requireStatus('upgrade-uninstall', afterUpgradeDump);
const afterRows = parseDump(afterUpgradeDump.stdout).rows;
if (afterUpgrade.dependencies?.[PACKAGE_NAME] || (afterUpgrade.dsh?.profile?.bundles || []).includes(PACKAGE_NAME)
  || afterRows.some((row) => row.id === 'archify-skill-filesystem' || row.config.providerName === 'archify-plugin')
  || !afterRows.some((row) => row.id === 'skill-filesystem')) {
  fail('upgrade-uninstall', 'upgraded plugin did not uninstall cleanly while preserving the base profile');
}
pass('upgrade-uninstall', { profile: UPGRADE_PROFILE, bundles: afterUpgrade.dsh?.profile?.bundles || [] });

const zipBlob = run('git', ['hash-object', 'archify.zip'], { cwd: repoRoot });
const pkgBlob = run('git', ['hash-object', 'archify/package.json'], { cwd: repoRoot });
const skipFreshZipRebuild = process.platform === 'win32';
const committedZip = path.join(repoRoot, 'archify.zip');
let unzipContentsIdentical = 'not-asserted';
let canonicalZipBytes = 'not-asserted';
if (skipFreshZipRebuild) {
  receipt.zipContainerNote = 'Windows extracts and smokes the committed ZIP; canonical rebuild and fresh-vs-committed equality are owned by Linux CI.';
  const checkedDir = path.join(scratch, 'checked');
  fs.mkdirSync(checkedDir);
  fs.copyFileSync(committedZip, path.join(checkedDir, 'committed.zip'));
  requireStatus('zero-regression', run('tar', ['-xf', 'committed.zip'], { cwd: checkedDir }));
  const currentSmoke = run(process.execPath, [
    path.join(repoRoot, 'scripts', 'package-smoke.mjs'),
    path.join(checkedDir, 'archify'),
  ], { cwd: repoRoot, timeout: 120_000 });
  requireStatus('zero-regression', currentSmoke, { command: 'current package-smoke.mjs <committed-zip-skill-root>' });
  unzipContentsIdentical = 'not-asserted-on-windows';
} else {
  const freshZip = path.join(scratch, 'fresh.zip');
  const freshDir = path.join(scratch, 'fresh');
  const checkedDir = path.join(scratch, 'checked');
  requireStatus('zero-regression', run('bash', [path.join(repoRoot, 'scripts', 'build-zip.sh'), freshZip], { cwd: repoRoot }));
  fs.mkdirSync(freshDir);
  fs.mkdirSync(checkedDir);
  requireStatus('zero-regression', run('unzip', ['-q', freshZip, '-d', freshDir]));
  requireStatus('zero-regression', run('unzip', ['-q', committedZip, '-d', checkedDir]));
  const unzipDiff = run('diff', ['-r', path.join(freshDir, 'archify'), path.join(checkedDir, 'archify')]);
  if (unzipDiff.status !== 0) {
    fail('zero-regression', 'fresh ZIP contents drifted from the committed ZIP', { diff: unzipDiff.stdout });
  }
  if (process.platform === 'linux') {
    if (!fs.readFileSync(freshZip).equals(fs.readFileSync(committedZip))) {
      fail('zero-regression', 'canonical Linux ZIP bytes drifted from the committed archive');
    }
    canonicalZipBytes = 'verified';
  }
  unzipContentsIdentical = true;
}
const skillsList = run('npx', ['-y', 'skills', 'add', repoRoot, '--list', '--full-depth'], { cwd: repoRoot, timeout: 120_000 });
requireStatus('zero-regression', skillsList, { command: 'npx skills add --list --full-depth' });
pass('zero-regression', {
  archifyZipBlob: zipBlob.stdout.trim(),
  archifyPackageBlob: pkgBlob.stdout.trim(),
  unzipContentsIdentical,
  canonicalZipBytes,
  crossPlatformZipCheck: 'extracted-content',
  ...(skipFreshZipRebuild ? { freshZipRebuildSkipped: true, checkoutTextEolNormalized: true } : {}),
  skillsCli: skillsList.stdout.trim().slice(0, 500),
});

receipt.ok = receipt.stages.every((stage) => stage.ok);
process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
process.exit(receipt.ok ? 0 : 1);
