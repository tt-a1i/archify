#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sameLocation,
  sidecarNamespaceComponentKey,
} from '../archify/renderers/shared/path-semantics.mjs';
import { checkForUpdate } from '../archify/scripts/check-update.mjs';
import { stageCleanSkill } from './stage-clean-skill.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillRoot = path.join(repoRoot, 'archify');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');

function commandFailure(label, result) {
  return [
    `${label} exited ${result.status ?? 'without a status'}`,
    result.error?.message,
    result.stdout,
    result.stderr,
  ].filter(Boolean).join('\n');
}

function runCli(args, { timeout = 120_000 } = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json' },
    timeout,
  });
}

function requireSuccess(label, result) {
  assert.equal(result.status, 0, commandFailure(label, result));
}

function requireControlledDirectory(name) {
  const value = process.env[name];
  assert.ok(value, `${name} is required on the controlled Windows path lane`);
  assert.ok(fs.statSync(value).isDirectory(), `${name} must name an existing directory: ${value}`);
  return value;
}

function driveLetterCaseAlias(targetPath) {
  assert.match(targetPath, /^[A-Za-z]:\\/u, 'controlled NTFS fixture must use a drive path');
  const drive = targetPath[0];
  const alternate = drive === drive.toUpperCase() ? drive.toLowerCase() : drive.toUpperCase();
  assert.notEqual(alternate, drive, 'drive-letter alias must use the alternate case');
  return `${alternate}${targetPath.slice(1)}`;
}

function removeChildren(directory) {
  try {
    for (const entry of fs.readdirSync(directory)) {
      fs.rmSync(path.join(directory, entry), { recursive: true, force: true });
    }
  } catch {
    // The workflow's always-run cleanup owns final fixture removal. Avoid
    // masking the path-contract failure that reached this best-effort cleanup.
  }
}

const remoteVisibilitySignal = new Int32Array(new SharedArrayBuffer(4));

function livePrivateStagingEntries(directory, prefix) {
  return fs.readdirSync(directory)
    .filter((entry) => entry.startsWith(prefix))
    .filter((entry) => {
      try {
        fs.lstatSync(path.toNamespacedPath(path.join(directory, entry)));
        return true;
      } catch (error) {
        if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
        throw error;
      }
    });
}

function assertNoPrivateStaging(directory, prefix, commandResult) {
  let remaining = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    remaining = livePrivateStagingEntries(directory, prefix);
    if (remaining.length === 0) return;
    if (attempt < 9) {
      Atomics.wait(
        remoteVisibilitySignal,
        0,
        0,
        Math.min(5 * (2 ** attempt), 250),
      );
    }
  }
  assert.deepEqual(
    remaining,
    [],
    [
      `${prefix} staging must disappear after bounded remote visibility convergence in ${directory}`,
      commandResult?.stderr,
      ...remaining.map((entry) => {
        const target = path.toNamespacedPath(path.join(directory, entry));
        try {
          return `${entry}: ${JSON.stringify(fs.readdirSync(target))}`;
        } catch (error) {
          return `${entry}: inspection failed (${error.code || error.message})`;
        }
      }),
    ].filter(Boolean).join('\n'),
  );
}

async function waitForVerifiedPreview(url, timeoutMs = 30_000) {
  const started = Date.now();
  let latest;
  while (Date.now() - started < timeoutMs) {
    const response = await fetch(new URL('/state', url));
    assert.equal(response.status, 200, 'preview state endpoint must remain readable');
    latest = await response.json();
    if (latest.status === 'verified' && latest.revision === 1) return latest;
    if (latest.status === 'needs-fix') {
      assert.fail(`preview failed on the controlled Windows path: ${JSON.stringify(latest.failure)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`preview did not verify on the controlled Windows path: ${JSON.stringify(latest)}`);
}

async function runControlledWindowsPathE2E() {
  const required = process.env.ARCHIFY_REQUIRE_WINDOWS_REAL_PATHS === '1';
  if (process.platform !== 'win32') {
    assert.equal(required, false, 'ARCHIFY_REQUIRE_WINDOWS_REAL_PATHS=1 requires Windows');
    return;
  }
  if (!required) return;

  const caseRoot = requireControlledDirectory('ARCHIFY_WINDOWS_CASE_SENSITIVE_ROOT');
  const uncRoot = requireControlledDirectory('ARCHIFY_WINDOWS_UNC_ROOT');
  const extendedUncRoot = requireControlledDirectory('ARCHIFY_WINDOWS_EXTENDED_UNC_ROOT');
  const eightDotThreeRoot = requireControlledDirectory('ARCHIFY_WINDOWS_8DOT3_ROOT');
  const eightDotThreeShortRoot = requireControlledDirectory('ARCHIFY_WINDOWS_8DOT3_SHORT_ROOT');
  assert.match(uncRoot, /^\\\\[^\\]+\\[^\\]+$/u, 'ordinary UNC fixture must name a share root');
  assert.match(
    extendedUncRoot,
    /^\\\\[?]\\UNC\\[^\\]+\\[^\\]+$/u,
    'extended UNC fixture must name an extended share root',
  );
  assert.equal(sameLocation(uncRoot, extendedUncRoot).status, 'match');
  assert.match(
    path.win32.basename(eightDotThreeShortRoot),
    /~/u,
    'controlled 8.3 fixture must expose an explicit short-name component',
  );
  assert.equal(
    sameLocation(eightDotThreeRoot, eightDotThreeShortRoot).status,
    'match',
    'the explicit 8.3 root must resolve to the controlled long-name directory',
  );
  const driveCaseRoot = driveLetterCaseAlias(caseRoot);
  assert.equal(
    sameLocation(caseRoot, driveCaseRoot).status,
    'match',
    'drive-letter case aliases must resolve to the same controlled directory',
  );

  const token = `archify-windows-${process.pid}-${Date.now().toString(36)}`;
  const architectureInput = path.join(skillRoot, 'examples', 'web-app.architecture.json');
  const workflowInput = path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json');
  const comparisonBase = path.join(skillRoot, 'examples', 'checkout-platform.base.architecture.json');
  const comparisonHead = path.join(skillRoot, 'examples', 'checkout-platform.head.architecture.json');
  let preview;
  try {
    const aliasRoot = path.join(caseRoot, `${token}-native-aliases`);
    const junctionTarget = path.join(aliasRoot, 'junction-target');
    const differentDirectory = path.join(aliasRoot, 'different-directory');
    const junctionAlias = path.join(aliasRoot, 'junction-alias');
    const fileTarget = path.join(aliasRoot, 'file-target.txt');
    const fileSymlink = path.join(aliasRoot, 'file-symlink.txt');
    const hardlink = path.join(aliasRoot, 'file-hardlink.txt');
    fs.mkdirSync(junctionTarget, { recursive: true });
    fs.mkdirSync(differentDirectory);
    fs.writeFileSync(fileTarget, 'controlled Windows alias evidence\n');
    fs.symlinkSync(junctionTarget, junctionAlias, 'junction');
    fs.symlinkSync(fileTarget, fileSymlink, 'file');
    fs.linkSync(fileTarget, hardlink);
    assert.equal(sameLocation(junctionTarget, junctionAlias).status, 'match');
    assert.equal(sameLocation(junctionTarget, differentDirectory).status, 'different');
    assert.equal(sameLocation(fileTarget, fileSymlink).status, 'match');
    assert.equal(sameLocation(fileTarget, hardlink).status, 'match');
    assert.equal(fs.readFileSync(fileSymlink, 'utf8'), 'controlled Windows alias evidence\n');
    assert.equal(fs.readFileSync(hardlink, 'utf8'), 'controlled Windows alias evidence\n');

    const upperOutput = path.join(caseRoot, `${token}-Case.html`);
    const lowerOutput = path.join(caseRoot, `${token}-case.html`);
    requireSuccess('case-sensitive render (upper)', runCli([
      'render', 'architecture', architectureInput, upperOutput,
    ]));
    assert.equal(
      sameLocation(upperOutput, lowerOutput).status,
      'different',
      'a future case-variant name must remain distinct in the controlled directory',
    );
    requireSuccess('case-sensitive render (lower)', runCli([
      'render', 'architecture', architectureInput, lowerOutput,
    ]));
    assert.equal(sameLocation(upperOutput, lowerOutput).status, 'different');
    assert.ok(fs.existsSync(upperOutput) && fs.existsSync(lowerOutput));

    const nfcOutput = path.join(caseRoot, `${token}-Caf\u00e9.html`);
    const nfdOutput = path.join(caseRoot, `${token}-Cafe\u0301.html`);
    assert.equal(
      path.basename(nfcOutput).normalize('NFC'),
      path.basename(nfdOutput).normalize('NFC'),
      'the controlled artifact pair must differ only by canonical Unicode normalization',
    );
    requireSuccess('normalization-sensitive render (NFC)', runCli([
      'render', 'architecture', architectureInput, nfcOutput,
    ]));
    assert.equal(
      sameLocation(nfcOutput, nfdOutput).status,
      'different',
      'a future NFD spelling must remain distinct in the controlled NTFS directory',
    );
    requireSuccess('normalization-sensitive render (NFD)', runCli([
      'render', 'architecture', architectureInput, nfdOutput,
    ]));
    assert.equal(sameLocation(nfcOutput, nfdOutput).status, 'different');
    assert.ok(fs.existsSync(nfcOutput) && fs.existsSync(nfdOutput));

    const caseDelivery = path.join(caseRoot, `${token}-drive-case-delivery.html`);
    const driveCaseDelivery = path.join(driveCaseRoot, path.basename(caseDelivery));
    const deliveredCase = runCli([
      'deliver', 'workflow', workflowInput, caseDelivery,
      '--quality', 'showcase', '--json',
    ]);
    requireSuccess('case-sensitive NTFS delivery', deliveredCase);
    assert.equal(JSON.parse(deliveredCase.stdout).ok, true);
    assert.equal(sameLocation(caseDelivery, driveCaseDelivery).status, 'match');
    const strictDriveCaseCheck = runCli([
      'check', driveCaseDelivery, '--require-provenance',
    ]);
    requireSuccess('strict check through drive-letter case alias', strictDriveCaseCheck);
    assert.equal(JSON.parse(strictDriveCaseCheck.stdout).provenance, 'current');

    const driveCaseRepoRoot = driveLetterCaseAlias(repoRoot);
    const revision = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
    });
    requireSuccess('repository revision discovery', revision);
    const evidenceDiagram = JSON.parse(fs.readFileSync(architectureInput, 'utf8'));
    evidenceDiagram.meta.repository = {
      url: 'https://github.com/tt-a1i/archify',
      revision: revision.stdout.trim(),
    };
    evidenceDiagram.components[0].sources = [{
      path: 'archify/bin/archify.mjs',
      line: 1,
      label: 'CLI entry point',
    }];
    const evidenceInput = path.join(caseRoot, `${token}-repository-evidence.architecture.json`);
    fs.writeFileSync(evidenceInput, `${JSON.stringify(evidenceDiagram, null, 2)}\n`);
    const repositoryValidation = runCli([
      'validate', 'architecture', evidenceInput,
      '--repo-root', driveCaseRepoRoot, '--json',
    ]);
    requireSuccess('repository root through drive-letter case alias', repositoryValidation);
    assert.equal(JSON.parse(repositoryValidation.stdout).ok, true);

    const ordinaryRender = path.win32.join(uncRoot, `${token}-ordinary-render.html`);
    const extendedRender = path.win32.join(extendedUncRoot, `${token}-extended-render.html`);
    requireSuccess('ordinary UNC render', runCli([
      'render', 'architecture', architectureInput, ordinaryRender,
    ]));
    requireSuccess('extended UNC render', runCli([
      'render', 'architecture', architectureInput, extendedRender,
    ]));
    assert.ok(fs.existsSync(ordinaryRender) && fs.existsSync(extendedRender));

    const ordinaryDelivery = path.win32.join(uncRoot, `${token}-ordinary-delivery.html`);
    const extendedOrdinaryDelivery = path.win32.join(
      extendedUncRoot,
      path.win32.basename(ordinaryDelivery),
    );
    const delivered = runCli([
      'deliver', 'workflow', workflowInput, ordinaryDelivery,
      '--quality', 'showcase', '--json',
    ]);
    requireSuccess('ordinary UNC delivery', delivered);
    assert.equal(JSON.parse(delivered.stdout).ok, true);
    assert.equal(sameLocation(ordinaryDelivery, extendedOrdinaryDelivery).status, 'match');
    const strictAliasCheck = runCli([
      'check', extendedOrdinaryDelivery, '--require-provenance',
    ]);
    requireSuccess('strict check through extended UNC alias', strictAliasCheck);
    assert.equal(JSON.parse(strictAliasCheck.stdout).provenance, 'current');

    const extendedDelivery = path.win32.join(extendedUncRoot, `${token}-extended-delivery.html`);
    const ordinaryExtendedDelivery = path.win32.join(uncRoot, path.win32.basename(extendedDelivery));
    const deliveredExtended = runCli([
      'deliver', 'workflow', workflowInput, extendedDelivery,
      '--quality', 'showcase', '--json',
    ]);
    requireSuccess('extended UNC delivery', deliveredExtended);
    assert.equal(JSON.parse(deliveredExtended.stdout).ok, true);
    const strictOrdinaryCheck = runCli([
      'check', ordinaryExtendedDelivery, '--require-provenance',
    ]);
    requireSuccess('strict check through ordinary UNC alias', strictOrdinaryCheck);
    assert.equal(JSON.parse(strictOrdinaryCheck.stdout).provenance, 'current');

    const compareOutput = path.win32.join(extendedUncRoot, `${token}-compare.html`);
    const compared = runCli([
      'compare', 'architecture', comparisonBase, comparisonHead, compareOutput, '--json',
    ]);
    requireSuccess('architecture compare to extended UNC', compared);
    assert.equal(JSON.parse(compared.stdout).ok, true);
    assert.ok(fs.existsSync(path.win32.join(uncRoot, path.win32.basename(compareOutput))));

    const stagedSkill = path.win32.join(uncRoot, `${token}-staged-skill`);
    stageCleanSkill({ repoRoot: driveCaseRepoRoot, destination: stagedSkill });
    assert.ok(fs.existsSync(path.join(stagedSkill, 'renderers', 'shared', 'sidecar-path.mjs')));

    const localRelease = JSON.parse(fs.readFileSync(path.join(skillRoot, 'skill-release.json'), 'utf8'));
    localRelease.channel = 'stable';
    localRelease.version = '2.15.0';
    const releasePath = path.join(caseRoot, `${token}-skill-release.json`);
    fs.writeFileSync(releasePath, `${JSON.stringify(localRelease)}\n`);
    const stableManifest = fs.readFileSync(
      path.join(repoRoot, 'docs', 'skill-updates', 'archify', 'stable.json'),
      'utf8',
    );
    const updateCache = path.win32.join(eightDotThreeShortRoot, `${token}-update-cache`);
    const update = await checkForUpdate({
      releasePath,
      cacheDirectory: updateCache,
      fetchImpl: async () => new Response(stableManifest, {
        status: 200,
        headers: {
          'content-type': 'application/json',
          etag: `"${token}"`,
        },
      }),
      now: () => Date.parse('2026-09-18T12:00:00Z'),
      random: () => 0.5,
    });
    assert.equal(update.status, 'update_available');

    let ordinaryLongDirectory = uncRoot;
    for (let index = 0; ordinaryLongDirectory.length <= 320; index += 1) {
      ordinaryLongDirectory = path.win32.join(
        ordinaryLongDirectory,
        `${token.slice(0, 24)}-${index}-ordinary-long-path`,
      );
    }
    fs.mkdirSync(ordinaryLongDirectory, { recursive: true });
    const ordinaryLongOutput = path.win32.join(ordinaryLongDirectory, 'diagram.html');
    assert.ok(
      ordinaryLongOutput.length > 320,
      'controlled ordinary UNC path must exceed the traditional MAX_PATH limit',
    );
    const ordinaryLongDelivery = runCli([
      'deliver', 'workflow', workflowInput, ordinaryLongOutput,
      '--quality', 'showcase', '--json',
    ]);
    requireSuccess('ordinary UNC delivery beyond traditional MAX_PATH', ordinaryLongDelivery);
    assert.equal(JSON.parse(ordinaryLongDelivery.stdout).ok, true);
    assert.ok(fs.existsSync(ordinaryLongOutput));
    assertNoPrivateStaging(ordinaryLongDirectory, '.archify-delivery-', ordinaryLongDelivery);
    assertNoPrivateStaging(ordinaryLongDirectory, '.archify-provenance-', ordinaryLongDelivery);

    let extendedLongDirectory = extendedUncRoot;
    for (let index = 0; extendedLongDirectory.length <= 320; index += 1) {
      extendedLongDirectory = path.win32.join(
        extendedLongDirectory,
        `${token.slice(0, 24)}-${index}-extended-long-path`,
      );
    }
    fs.mkdirSync(extendedLongDirectory, { recursive: true });
    const extendedLongOutput = path.win32.join(extendedLongDirectory, 'diagram.html');
    assert.ok(
      extendedLongOutput.length > 320,
      'controlled extended UNC path must exceed the traditional MAX_PATH limit',
    );
    const extendedLongDelivery = runCli([
      'deliver', 'workflow', workflowInput, extendedLongOutput,
      '--quality', 'showcase', '--json',
    ]);
    requireSuccess('extended UNC delivery beyond traditional MAX_PATH', extendedLongDelivery);
    assert.equal(JSON.parse(extendedLongDelivery.stdout).ok, true);
    assert.ok(fs.existsSync(extendedLongOutput));

    const evidenceDirectory = path.win32.join(
      ordinaryLongDirectory,
      `${token}-visual-evidence`,
    );
    const visual = runCli([
      'visual-check', ordinaryLongOutput, '--json', '--require-provenance',
      '--out-dir', evidenceDirectory,
    ], { timeout: 180_000 });
    requireSuccess('ordinary UNC visual-check beyond traditional MAX_PATH', visual);
    const ordinaryLongVisualReceipt = JSON.parse(visual.stdout);
    assert.equal(ordinaryLongVisualReceipt.status, 'pass');
    assert.ok(fs.existsSync(path.win32.join(
      ordinaryLongVisualReceipt.sidecars.directory,
      ordinaryLongVisualReceipt.sidecars.receipt,
    )));
    assertNoPrivateStaging(evidenceDirectory, '.archify-visual-check-');

    const sharedCaseEvidenceDirectory = path.win32.join(
      uncRoot,
      `${token}-case-variant-visual-evidence`,
    );
    const upperVisual = runCli([
      'visual-check', upperOutput, '--json', '--out-dir', sharedCaseEvidenceDirectory,
    ], { timeout: 180_000 });
    requireSuccess('case-sensitive upper artifact visual-check to shared UNC', upperVisual);
    const lowerVisual = runCli([
      'visual-check', lowerOutput, '--json', '--out-dir', sharedCaseEvidenceDirectory,
    ], { timeout: 180_000 });
    requireSuccess('case-sensitive lower artifact visual-check to shared UNC', lowerVisual);
    const upperReceipt = JSON.parse(upperVisual.stdout);
    const lowerReceipt = JSON.parse(lowerVisual.stdout);
    assert.equal(upperReceipt.status, 'pass');
    assert.equal(lowerReceipt.status, 'pass');
    const upperReceiptKey = sidecarNamespaceComponentKey(
      upperReceipt.sidecars.directory,
      upperReceipt.sidecars.receipt,
    );
    const lowerReceiptKey = sidecarNamespaceComponentKey(
      lowerReceipt.sidecars.directory,
      lowerReceipt.sidecars.receipt,
    );
    assert.equal(upperReceiptKey.status, 'resolved');
    assert.equal(lowerReceiptKey.status, 'resolved');
    assert.notEqual(
      upperReceiptKey.componentKey,
      lowerReceiptKey.componentKey,
      'case-variant artifacts must receive distinct evidence names on a case-insensitive share',
    );
    assert.ok(fs.existsSync(path.win32.join(
      upperReceipt.sidecars.directory,
      upperReceipt.sidecars.receipt,
    )));
    assert.ok(fs.existsSync(path.win32.join(
      lowerReceipt.sidecars.directory,
      lowerReceipt.sidecars.receipt,
    )));

    const sharedNormalizationEvidenceDirectory = path.win32.join(
      uncRoot,
      `${token}-normalization-variant-visual-evidence`,
    );
    const nfcVisual = runCli([
      'visual-check', nfcOutput, '--json', '--out-dir', sharedNormalizationEvidenceDirectory,
    ], { timeout: 180_000 });
    requireSuccess('normalization-sensitive NFC artifact visual-check to shared UNC', nfcVisual);
    const nfdVisual = runCli([
      'visual-check', nfdOutput, '--json', '--out-dir', sharedNormalizationEvidenceDirectory,
    ], { timeout: 180_000 });
    requireSuccess('normalization-sensitive NFD artifact visual-check to shared UNC', nfdVisual);
    const nfcReceipt = JSON.parse(nfcVisual.stdout);
    const nfdReceipt = JSON.parse(nfdVisual.stdout);
    assert.equal(nfcReceipt.status, 'pass');
    assert.equal(nfdReceipt.status, 'pass');
    const nfcReceiptKey = sidecarNamespaceComponentKey(
      nfcReceipt.sidecars.directory,
      nfcReceipt.sidecars.receipt,
    );
    const nfdReceiptKey = sidecarNamespaceComponentKey(
      nfdReceipt.sidecars.directory,
      nfdReceipt.sidecars.receipt,
    );
    assert.equal(nfcReceiptKey.status, 'resolved');
    assert.equal(nfdReceiptKey.status, 'resolved');
    assert.notEqual(
      nfcReceiptKey.componentKey,
      nfdReceiptKey.componentKey,
      'normalization-distinct artifacts must receive distinct evidence names on the shared UNC target',
    );
    assert.ok(fs.existsSync(path.win32.join(
      nfcReceipt.sidecars.directory,
      nfcReceipt.sidecars.receipt,
    )));
    assert.ok(fs.existsSync(path.win32.join(
      nfdReceipt.sidecars.directory,
      nfdReceipt.sidecars.receipt,
    )));

    const previewOutput = path.win32.join(ordinaryLongDirectory, `${token}-preview.html`);
    const { startPreview } = await import('../archify/bin/preview.mjs');
    preview = await startPreview({
      type: 'architecture',
      input: architectureInput,
      output: previewOutput,
      quality: 'showcase',
      open: false,
      debounceMs: 20,
      pollMs: 60_000,
    });
    await waitForVerifiedPreview(preview.url);
    assert.ok(fs.existsSync(previewOutput));
    await preview.stop();
    preview = null;
    assertNoPrivateStaging(ordinaryLongDirectory, '.archify-preview-');

    if (Number(process.versions.node.split('.')[0]) === 22) {
      const uncArchive = path.win32.join(uncRoot, `${token}-archify.zip`);
      const bashCandidates = [
        process.env.BASH,
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'bash',
      ].filter(Boolean);
      const bash = bashCandidates.find((candidate) => (
        candidate === 'bash' || fs.existsSync(candidate)
      )) || 'bash';
      const archiveBuild = spawnSync(
        bash,
        [path.join(repoRoot, 'scripts', 'build-zip.sh'), uncArchive],
        { cwd: repoRoot, encoding: 'utf8', timeout: 180_000 },
      );
      requireSuccess('canonical ZIP publication to ordinary UNC', archiveBuild);
      assert.equal(fs.readFileSync(uncArchive).subarray(0, 4).toString('hex'), '504b0304');
    }
  } finally {
    if (preview) await preview.stop().catch(() => {});
    removeChildren(caseRoot);
    removeChildren(uncRoot);
  }
}

const fullSuites = [
  'test/release-package-gates.test.mjs',
  'test/copy-site-assets.test.mjs',
  'test/path-boundary-contract.test.mjs',
  'test/path-semantics.test.mjs',
  'test/portable-path.test.mjs',
  'test/native-output-path.test.mjs',
  'test/meta-output-contract.test.mjs',
  'test/output-path.test.mjs',
  'test/cli-output-types.test.mjs',
  'test/delivery-sidecar-path.test.mjs',
  'test/sidecar-path-length.test.mjs',
  'test/open-artifact.test.mjs',
  'test/repository-evidence.test.mjs',
  'test/renderer-atomic-write.test.mjs',
  'test/atomic-output-recovery.test.mjs',
];

const portabilitySuites = [
  'test/checkout-line-endings.test.mjs',
  'test/clean-skill-staging.test.mjs',
  'test/workflow-migration.test.mjs',
  'test/cli.test.mjs',
  'test/preview.test.mjs',
  'test/visual-check.test.mjs',
  'test/update-notifier.test.mjs',
];

const portabilityPattern = [
  'Git checkout preserves',
  'clean staging preserves index modes',
  'entry detection',
  'workflow migration cleanup failure',
  'workflow migration rejects a dangling destination symlink',
  'workflow migration preserves a destination claimant created before final verification',
  'workflow migration preserves an existing destination replaced during candidate mode finalization',
  'preview runs from an installed skill',
  'publishing through an existing output symlink',
  'publishing through a dangling output symlink',
  'recreating an output symlink',
  'concurrently claimed absent output',
  'concurrent replacement of an existing output',
  'hardlinked existing output',
  'watcher accepts',
  'canonical watch target',
  'Windows 8.3 short path',
  'preview: publishing through an existing output symlink',
  'preview: publishing through a dangling output symlink',
  'preview: recreating an output symlink',
  'preview: a concurrently claimed absent output',
  'preview: a concurrent replacement of an existing output',
  'preview: a hardlinked existing output',
  'updater rejects a case-only alias',
  'symlink cache root',
  'symlink cache ancestor',
  'authored symlink is rejected|trusted directory through a symlink',
  'findChrome',
  'visual-check',
  'doctor identifies an incomplete installation',
].join('|');

const groups = [
  ['--test', '--test-concurrency=1', ...fullSuites],
  [
    '--test',
    '--test-concurrency=1',
    `--test-name-pattern=${portabilityPattern}`,
    ...portabilitySuites,
  ],
];

await runControlledWindowsPathE2E();

for (const args of groups) {
  const result = spawnSync(process.execPath, args, {
    cwd: skillRoot,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal) {
    process.stderr.write(`Windows path test runner terminated by ${result.signal}\n`);
    process.exitCode = 1;
    break;
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
  }
}
