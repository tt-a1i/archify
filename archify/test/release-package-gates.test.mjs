import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { stageCleanSkill } from '../../scripts/stage-clean-skill.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const canonicalZipNodeMajor = 22;
const currentNodeMajor = Number(process.versions.node.split('.')[0]);
const canonicalZipTest = (name, fn) => test(name, {
  skip: currentNodeMajor === canonicalZipNodeMajor
    ? false
    : `canonical ZIP builds require Node ${canonicalZipNodeMajor}`,
}, fn);

function spawnBuildZip(outputPath, options = {}) {
  const script = path.join(repoRoot, 'scripts', 'build-zip.sh');
  const { cwd = repoRoot, env = process.env, ...rest } = options;
  const bashCandidates = process.platform === 'win32'
    ? [
      process.env.BASH,
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'bash',
    ].filter(Boolean)
    : ['bash'];
  for (const bash of bashCandidates) {
    if (bash.includes('\\') && !fs.existsSync(bash)) continue;
    // Native Windows argv decoding and MSYS path conversion must not alter
    // the deliberately unsafe raw spelling before the validator sees it.
    const result = spawnSync(bash, [
      '-c', 'exec bash "$ARCHIFY_ZIP_BUILD_SCRIPT" "$ARCHIFY_ZIP_BUILD_OUTPUT"',
    ], {
      cwd,
      encoding: 'utf8',
      ...rest,
      env: {
        ...env,
        ARCHIFY_ZIP_BUILD_SCRIPT: script,
        ARCHIFY_ZIP_BUILD_OUTPUT: outputPath,
        MSYS2_ARG_CONV_EXCL: outputPath,
      },
    });
    if (result.status !== 127) return result;
  }
  return spawnSync(script, [outputPath], { cwd, env, encoding: 'utf8', ...rest });
}

function preparePackageIndex(indexPath, extraPaths) {
  const env = { ...process.env, GIT_INDEX_FILE: indexPath };
  let result = spawnSync('git', ['read-tree', 'HEAD'], { cwd: repoRoot, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  result = spawnSync('git', ['rev-parse', 'HEAD:archify/LICENSE'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const blob = result.stdout.trim();
  for (const relative of extraPaths) {
    result = spawnSync('git', [
      '-c', 'core.protectNTFS=false',
      '-c', 'core.protectHFS=false',
      'update-index', '--add', '--cacheinfo', '100644', blob, relative,
    ], { cwd: repoRoot, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  return env;
}

function workflowStep(workflow, name) {
  const marker = `      - name: ${name}`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `workflow is missing the "${name}" step`);
  const next = workflow.indexOf('\n      - ', start + marker.length);
  return workflow.slice(start, next === -1 ? workflow.length : next);
}

function workflowJob(workflow, name) {
  const marker = `  ${name}:`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `workflow is missing the "${name}" job`);
  const next = workflow.slice(start + marker.length).search(/\n  [a-z][a-z0-9-]*:\n/);
  return workflow.slice(start, next === -1 ? workflow.length : start + marker.length + next);
}
function assertPinnedAction(section, action, sha, version) {
  const expected = `uses: ${action}@${sha} # ${version}`;
  assert.ok(
    section.includes(expected),
    `${action} must remain pinned to the reviewed ${version} commit (${sha})`,
  );
}

test('release prevents manifest preannouncement and smokes the exact archive before upload', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');
  const tagFetch = workflowStep(workflow, 'Fetch exact tag object');
  const tagGate = workflowStep(workflow, 'Tag must match package.json version');
  const annotatedTagGate = workflowStep(workflow, 'Stable release tag must be annotated');
  const publicationOrder = workflowStep(workflow, 'Stable notifier manifest must remain on the previous release');
  const build = workflowStep(workflow, 'Build skill archive');
  const smoke = workflowStep(workflow, 'Validate the exact release archive without installing dependencies');
  const freshness = workflowStep(workflow, 'Committed zip must match the build (same gate as CI)');
  const upload = workflowStep(workflow, 'Create GitHub Release with the zip attached');
  const followUp = workflowStep(workflow, 'Record stable notifier publication follow-up');

  assert.ok(workflow.indexOf(tagFetch) < workflow.indexOf(tagGate), 'the real tag object must be fetched before release identity checks');
  assert.ok(workflow.indexOf(tagGate) < workflow.indexOf(publicationOrder), 'tag/version gate must precede the publication-order gate');
  assert.ok(workflow.indexOf(tagGate) < workflow.indexOf(annotatedTagGate), 'tag/version gate must precede the annotated-tag gate');
  assert.ok(workflow.indexOf(annotatedTagGate) < workflow.indexOf(publicationOrder), 'annotated-tag gate must precede the publication-order gate');
  assert.ok(workflow.indexOf(publicationOrder) < workflow.indexOf(build), 'manifest preannouncement must fail before the release build');
  assert.ok(workflow.indexOf(build) < workflow.indexOf(smoke), 'release smoke must follow the archive build');
  assert.ok(workflow.indexOf(smoke) < workflow.indexOf(freshness), 'release smoke must inspect the built archive before comparison');
  assert.ok(workflow.indexOf(freshness) < workflow.indexOf(upload), 'freshness must pass before release upload');
  assert.ok(workflow.indexOf(upload) < workflow.indexOf(followUp), 'manifest follow-up must be recorded only after Release creation');

  assert.match(tagFetch, /git fetch --force --no-tags origin/);
  assert.match(tagFetch, /refs\/tags\/\$\{GITHUB_REF_NAME\}:refs\/tags\/\$\{GITHUB_REF_NAME\}/);
  assert.match(tagGate, /require\('\.\/archify\/package\.json'\)\.version/);
  assert.match(tagGate, /GITHUB_REF_NAME#v/);
  assert.match(annotatedTagGate, /steps\.release-kind\.outputs\.prerelease == 'false'/);
  assert.match(annotatedTagGate, /git cat-file -t "refs\/tags\/\$\{GITHUB_REF_NAME\}"/);
  assert.match(annotatedTagGate, /stable releases require an annotated tag/);
  assert.match(publicationOrder, /compareSemver\(published\.version, releasing\) >= 0/);
  assert.match(publicationOrder, /publish the manifest in a follow-up commit/);
  assert.match(build, /run: scripts\/build-zip\.sh \/tmp\/archify-built\.zip/);
  assert.match(smoke, /unzip -q \/tmp\/archify-built\.zip -d "\$package_root"/);
  assert.match(smoke, /node scripts\/package-smoke\.mjs "\$package_root\/archify"/);
  assert.doesNotMatch(smoke, /\bnpm\s+(?:ci|install)\b/);
  assert.match(freshness, /cmp -s \/tmp\/archify-built\.zip archify\.zip/);
  assertPinnedAction(
    upload,
    'softprops/action-gh-release',
    'efb35369e0ad2afab669f228072c1b0d510eae64',
    'v3.0.3',
  );
  assert.match(upload, /files: archify\.zip/);
  assert.match(followUp, /docs\/skill-updates\/archify\/stable\.json/);
});

test('an exact tag fetch restores an annotated object after a SHA-only checkout', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-release-tag-fetch-'));
  const source = path.join(fixture, 'source');
  const checkout = path.join(fixture, 'checkout');
  const runGit = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

  try {
    fs.mkdirSync(source);
    assert.equal(runGit(source, ['init', '--quiet']).status, 0);
    assert.equal(runGit(source, ['config', 'user.name', 'Archify Test']).status, 0);
    assert.equal(runGit(source, ['config', 'user.email', 'archify@example.invalid']).status, 0);
    fs.writeFileSync(path.join(source, 'release.txt'), 'release\n');
    assert.equal(runGit(source, ['add', 'release.txt']).status, 0);
    assert.equal(runGit(source, ['commit', '--quiet', '-m', 'release fixture']).status, 0);
    assert.equal(runGit(source, ['tag', '-a', 'v1.0.0', '-m', 'Release v1.0.0']).status, 0);
    const commit = runGit(source, ['rev-parse', 'HEAD']).stdout.trim();

    fs.mkdirSync(checkout);
    assert.equal(runGit(checkout, ['init', '--quiet']).status, 0);
    assert.equal(runGit(checkout, ['remote', 'add', 'origin', source]).status, 0);
    assert.equal(runGit(checkout, [
      'fetch', '--no-tags', '--depth=1', 'origin',
      `+${commit}:refs/tags/v1.0.0`,
    ]).status, 0);
    assert.equal(runGit(checkout, ['cat-file', '-t', 'refs/tags/v1.0.0']).stdout.trim(), 'commit');

    assert.equal(runGit(checkout, [
      'fetch', '--force', '--no-tags', 'origin',
      '+refs/tags/v1.0.0:refs/tags/v1.0.0',
    ]).status, 0);
    assert.equal(runGit(checkout, ['cat-file', '-t', 'refs/tags/v1.0.0']).stdout.trim(), 'tag');
    assert.equal(runGit(checkout, ['rev-parse', 'refs/tags/v1.0.0^{}']).stdout.trim(), commit);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('CI binds a public notifier manifest to the Release asset, tagged archive, and tag tree build', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  const job = workflowJob(workflow, 'published-update-manifest');
  assert.match(job, /validateStableUpdateManifest/);
  assert.match(job, /releases\/latest/);
  assert.match(job, /latest_stable_tag" != "v\$\{manifest_version\}"/);
  assert.match(job, /releases\/tags\/v\$\{manifest_version\}/);
  assert.match(job, /select\(\.draft == false and \.prerelease == false\)/);
  assert.match(job, /select\(\.name == "archify\.zip"\)/);
  assert.match(job, /releases\/assets\/\$\{release_asset_id\}/);
  assert.match(job, /Accept: application\/octet-stream/);
  assert.match(job, /refs\/tags\/v\$\{manifest_version\}:refs\/tags\/v\$\{manifest_version\}/);
  assert.match(job, /git show "v\$\{manifest_version\}:archify\.zip" > "\$tagged_archive"/);
  assert.match(job, /cmp -s "\$published_archive" "\$tagged_archive"/);
  assert.match(job, /check-stable-update-manifest\.mjs/);
  assert.match(job, /--archive "\$published_archive"/);
  assert.match(job, /--tag "v\$\{manifest_version\}"/);
  assert.match(job, /--source-ref "v\$\{manifest_version\}"/);
  assert.match(job, /git worktree add --detach "\$tag_checkout" "v\$\{manifest_version\}"/);
  assert.match(job, /"\$tag_checkout\/scripts\/build-zip\.sh" "\$rebuilt_archive"/);
  assert.match(job, /cmp -s "\$rebuilt_archive" "\$tagged_archive"/);
  assert.match(job, /manifest_version" == "2\.15\.0"/);
  assert.match(job, /missing the deterministic archive builder/);
});

test('release docs disclose that mutable Release assets are verified only at deployment time', () => {
  const design = fs.readFileSync(
    path.join(repoRoot, 'docs', 'skill-embedded-optional-update-notifier-design.md'),
    'utf8',
  );
  assert.match(design, /部署时点/);
  assert.match(design, /部署后替换[^。]*不会自动触发复验/);
  assert.match(design, /immutable release/i);
  assert.doesNotMatch(design, /即使 Release 资产后来可被替换，也不能脱离/);
});

test('GitHub Pages deploys docs only after every repository gate succeeds', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  const job = workflowJob(workflow, 'deploy-pages');
  assert.match(job, /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(job, /needs: \[test, webm-artifact, zip-freshness, published-update-manifest, package-smoke, windows-test-portability\]/);
  assert.match(job, /pages: write/);
  assert.match(job, /id-token: write/);
  assert.match(job, /repos\/\$\{GITHUB_REPOSITORY\}\/git\/ref\/heads\/main/);
  assert.match(job, /current_main" == "\$GITHUB_SHA"/);
  assert.match(job, /Skipping obsolete Pages deployment/);
  assert.match(job, /if: steps\.deployment-head\.outputs\.current == 'true'/);
  assertPinnedAction(
    job,
    'actions/configure-pages',
    '45bfe0192ca1faeb007ade9deae92b16b8254a0d',
    'v6.0.0',
  );
  // v5 delegates to upload-artifact v7 (Node 24); v4 still embeds Node 20.
  assertPinnedAction(
    job,
    'actions/upload-pages-artifact',
    'fc324d3547104276b827a68afc52ff2a11cc49c9',
    'v5.0.0',
  );
  assert.match(job, /path: docs/);
  assertPinnedAction(
    job,
    'actions/deploy-pages',
    'cd2ce8fcbc39b97be8ca5fce6e763baed58fa128',
    'v5.0.0',
  );
});

test('release tags with a SemVer prerelease are marked prerelease and never become latest', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8');
  const classifier = workflowStep(workflow, 'Classify stable and prerelease tags');
  const upload = workflowStep(workflow, 'Create GitHub Release with the zip attached');

  assert.ok(workflow.indexOf(classifier) < workflow.indexOf(upload), 'release kind must be known before upload');
  assert.match(classifier, /version="\$\{GITHUB_REF_NAME#v\}"/);
  assert.match(classifier, /validateLocalRelease/);
  assert.match(classifier, /update-contract\.mjs/);
  assert.match(classifier, /release\.version !== process\.argv\[1\]/);
  assert.match(classifier, /if \[\[ "\$channel" == "development" \]\]/);
  assert.match(classifier, /echo "prerelease=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(classifier, /echo "make_latest=false" >> "\$GITHUB_OUTPUT"/);
  assert.match(classifier, /echo "prerelease=false" >> "\$GITHUB_OUTPUT"/);
  assert.match(classifier, /echo "make_latest=true" >> "\$GITHUB_OUTPUT"/);
  assert.match(upload, /prerelease: \$\{\{ steps\.release-kind\.outputs\.prerelease \}\}/);
  assert.match(upload, /make_latest: \$\{\{ steps\.release-kind\.outputs\.make_latest \}\}/);
});

test('package smoke rejects every dependency or repository-only artifact', () => {
  const packageSmoke = path.join(repoRoot, 'scripts', 'package-smoke.mjs');
  const forbidden = [
    { relative: 'node_modules', kind: 'directory' },
    { relative: 'package-lock.json', kind: 'file' },
    { relative: path.join('scripts', 'generate-validators.mjs'), kind: 'file' },
    { relative: 'test', kind: 'directory' },
    { relative: '.hive', kind: 'directory' },
    { relative: '.workbuddy', kind: 'directory' },
  ];

  for (const { relative, kind } of forbidden) {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-gate-'));
    try {
      fs.mkdirSync(path.join(fixture, 'bin'), { recursive: true });
      fs.writeFileSync(path.join(fixture, 'bin', 'archify.mjs'), '');
      const target = path.join(fixture, relative);
      if (kind === 'directory') fs.mkdirSync(target, { recursive: true });
      else {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, '');
      }

      const result = spawnSync(process.execPath, [packageSmoke, fixture], { encoding: 'utf8' });
      assert.notEqual(result.status, 0, `${relative} must fail package smoke`);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        new RegExp(`packaged skill must not contain ${relative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
        `${relative} must be rejected explicitly`,
      );
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }
});

test('package smoke verifies the embedded notifier identity and local disable switch', () => {
  const source = fs.readFileSync(path.join(repoRoot, 'scripts', 'package-smoke.mjs'), 'utf8');
  assert.match(source, /scripts', 'check-update\.mjs/);
  assert.match(source, /scripts', 'update-contract\.mjs/);
  assert.match(source, /skill-release\.json/);
  assert.match(source, /ARCHIFY_UPDATE_CHECK_DISABLED: '1'/);
  assert.match(source, /reason !== 'disabled'/);
});

test('package smoke rejects a missing or modified distribution license', () => {
  const packageSmoke = path.join(repoRoot, 'scripts', 'package-smoke.mjs');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-license-gate-'));
  try {
    const staged = path.join(fixture, 'archify');
    stageCleanSkill({ repoRoot, destination: staged });
    const licensePath = path.join(staged, 'LICENSE');

    fs.rmSync(licensePath);
    let result = spawnSync(process.execPath, [packageSmoke, staged], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'missing LICENSE must fail package smoke');
    assert.match(`${result.stdout}\n${result.stderr}`, /packaged skill is missing LICENSE/);

    const repositoryLicense = fs.readFileSync(path.join(repoRoot, 'LICENSE'), 'utf8');
    fs.writeFileSync(
      licensePath,
      repositoryLicense.replace(
        'Copyright (c) 2025 Cocoon AI',
        'Copyright (c) 2025 Cocoon AI (original "architecture-diagram-generator")',
      ),
    );
    result = spawnSync(process.execPath, [packageSmoke, staged], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'modified upstream notice must fail package smoke');
    assert.match(`${result.stdout}\n${result.stderr}`, /missing the exact Cocoon AI copyright line/);

    fs.writeFileSync(licensePath, 'Copyright (c) 2025 Cocoon AI\n');
    result = spawnSync(process.execPath, [packageSmoke, staged], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'truncated LICENSE must fail package smoke');
    assert.match(`${result.stdout}\n${result.stderr}`, /must byte-match the repository LICENSE/);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('package smoke rejects missing, modified, or incomplete third-party notices', () => {
  const packageSmoke = path.join(repoRoot, 'scripts', 'package-smoke.mjs');
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-notices-gate-'));
  try {
    const staged = path.join(fixture, 'archify');
    stageCleanSkill({ repoRoot, destination: staged });
    const noticesPath = path.join(staged, 'THIRD_PARTY_NOTICES.md');

    fs.rmSync(noticesPath);
    let result = spawnSync(process.execPath, [packageSmoke, staged], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'missing notices must fail package smoke');
    assert.match(`${result.stdout}\n${result.stderr}`, /missing THIRD_PARTY_NOTICES\.md/);

    const repositoryNotices = fs.readFileSync(path.join(repoRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
    fs.writeFileSync(noticesPath, repositoryNotices.replace('Simple Icons 16.28.0', 'Simple Icons'));
    result = spawnSync(process.execPath, [packageSmoke, staged], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'modified notices must fail package smoke');
    assert.match(`${result.stdout}\n${result.stderr}`, /must byte-match the repository notice/);

    fs.writeFileSync(noticesPath, 'Simple Icons 16.28.0\n');
    result = spawnSync(process.execPath, [packageSmoke, staged], { encoding: 'utf8' });
    assert.notEqual(result.status, 0, 'incomplete notices must fail package smoke');
    assert.match(`${result.stdout}\n${result.stderr}`, /packaged THIRD_PARTY_NOTICES\.md is incomplete/);

    const comparisonRoot = path.join(fixture, 'comparison-root');
    fs.mkdirSync(comparisonRoot);
    fs.copyFileSync(path.join(repoRoot, 'LICENSE'), path.join(comparisonRoot, 'LICENSE'));
    const synchronizedIncomplete = repositoryNotices
      .replace(/## OpenAI mark[\s\S]*?## No additional rights granted/, '## No additional rights granted');
    fs.writeFileSync(path.join(comparisonRoot, 'THIRD_PARTY_NOTICES.md'), synchronizedIncomplete);
    fs.writeFileSync(noticesPath, synchronizedIncomplete);
    result = spawnSync(process.execPath, [packageSmoke, staged], {
      encoding: 'utf8',
      env: {
        ...process.env,
        ARCHIFY_PACKAGE_SMOKE_NOTICE_ROOT: comparisonRoot,
      },
    });
    assert.notEqual(result.status, 0, 'byte-identical incomplete notices must fail package smoke');
    assert.match(
      `${result.stdout}\n${result.stderr}`,
      /repository THIRD_PARTY_NOTICES\.md is incomplete; missing required disclosure: .*OpenAI/,
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('package smoke increments an arbitrary-precision SemVer patch without Number coercion', () => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-bigint-version-'));
  const skillRoot = path.join(scratch, 'archify');
  try {
    stageCleanSkill({ repoRoot, destination: skillRoot });
    const packagePath = path.join(skillRoot, 'package.json');
    const releasePath = path.join(skillRoot, 'skill-release.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
    const version = '2.16.9007199254740993';
    packageJson.version = version;
    release.version = version;
    release.channel = 'stable';
    fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
    fs.writeFileSync(releasePath, `${JSON.stringify(release, null, 2)}\n`);

    const smoke = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/package-smoke.mjs'), skillRoot], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(smoke.status, 0, smoke.stderr || smoke.stdout);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('archive build refuses to silently omit required release files', () => {
  const buildSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'build-zip.sh'), 'utf8');
  const stageSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'stage-clean-skill.mjs'), 'utf8');
  assert.match(buildSource, /stage-clean-skill\.mjs/);
  assert.match(stageSource, /archify\/LICENSE/);
  assert.match(stageSource, /archify\/THIRD_PARTY_NOTICES\.md/);
  assert.match(stageSource, /archify\/skill-release\.json/);
  assert.match(stageSource, /archify\/renderers\/shared\/path-semantics\.mjs/);
  assert.match(stageSource, /archify\/renderers\/shared\/portable-path\.mjs/);
  assert.match(stageSource, /archify\/renderers\/shared\/output-path\.mjs/);
  assert.match(stageSource, /archify\/renderers\/shared\/atomic-output\.mjs/);
  assert.match(stageSource, /archify\/scripts\/check-update\.mjs/);
  assert.match(stageSource, /archify\/scripts\/update-contract\.mjs/);
  assert.match(stageSource, /git', \['ls-files', '--stage', '-z'/);
  assert.match(stageSource, /required package input is not tracked by Git/);
  assert.match(stageSource, /required repository input is not tracked by Git/);
});

test('clean package staging rejects non-portable tracked names and entry collisions before copying', () => {
  const cases = [
    {
      paths: ['archify/portable-gate/CON.txt'],
      code: 'portable-path/windows-reserved-name',
    },
    {
      paths: ['archify/portable-gate/Docs/one.txt', 'archify/portable-gate/docs/two.txt'],
      code: 'portable-path/collision',
    },
    {
      paths: [`archify/portable-gate/${'a'.repeat(256)}`],
      code: 'portable-path/component-too-long',
    },
  ];

  for (const { paths, code } of cases) {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-portable-index-'));
    const destination = path.join(fixture, 'staged');
    const env = preparePackageIndex(path.join(fixture, 'index'), paths);
    const previousIndex = process.env.GIT_INDEX_FILE;
    try {
      process.env.GIT_INDEX_FILE = env.GIT_INDEX_FILE;
      assert.throws(
        () => stageCleanSkill({ repoRoot, destination }),
        (error) => error?.code === code,
      );
      assert.equal(fs.existsSync(destination), false, 'portable-name rejection must precede staging writes');
    } finally {
      if (previousIndex === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = previousIndex;
      fs.rmSync(fixture, { recursive: true, force: true });
    }
  }
});

test('archive build rejects unsafe native output paths before creating files', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-output-path-'));
  try {
    const cases = [
      ['C:drive-relative.zip', /\(drive-relative\)/],
      ['\\current-drive-rooted.zip', /\(current-drive-rooted\)/],
      [String.raw`\\.\C:\device.zip`, /\(windows-device-namespace\)/],
      [String.raw`//./C:/device.zip`, /\((?:current-drive-rooted|windows-device-namespace)\)/],
      [String.raw`\\?\GLOBALROOT\Device\HarddiskVolume1\archive.zip`, /\(windows-device-namespace\)/],
      [String.raw`//?/GLOBALROOT/Device/HarddiskVolume1/archive.zip`, /\((?:current-drive-rooted|windows-extended-root)\)/],
      [String.raw`\\?\Device\HarddiskVolume1\archive.zip`, /\(windows-device-namespace\)/],
      [String.raw`\\?\PIPE\archive.zip`, /\(windows-extended-root\)/],
      [String.raw`\\?\foo.zip`, /\(windows-extended-root\)/],
      [String.raw`\\?\Volume{00000000-0000-0000-0000-000000000000}\archive.zip`, /\(windows-extended-root\)/],
      [String.raw`\\?\UNC\server`, /\(windows-extended-root\)/],
      [String.raw`\\?\C:/archive.zip`, /\(windows-extended-separator\)/],
      [String.raw`\\?\C:\folder\..\archive.zip`, /\(dot-segment\)/],
      [String.raw`\\server.zip`, /\(windows-unc-root\)/],
      [String.raw`\\`, /\(trailing-separator\)/],
      [String.raw`\\\share\archive.zip`, /\(windows-unc-root\)/],
      [String.raw`\\server\\archive.zip`, /\(windows-unc-root\)/],
      [String.raw`\\server/share/archive.zip`, /\(windows-unc-root\)/],
      [String.raw`archive.zip:stream`, /\(windows-ads\)/],
      [String.raw`folder\safe.zip:stream`, /\(windows-ads\)/],
      [String.raw`folder\CON.zip`, /\(windows-reserved-name\)/],
      [String.raw`folder\NUL.zip`, /\(windows-reserved-name\)/],
      [String.raw`folder.\archive.zip`, /\(windows-trailing-dot-space\)/],
      [String.raw`folder \archive.zip`, /\(windows-trailing-dot-space\)/],
      [String.raw`archive.zip/`, /\(trailing-separator\)/],
      ['folder\\archive.zip\\', /\(trailing-separator\)/],
      [String.raw`bad<name.zip`, /\(windows-invalid-character\)/],
      [String.raw`bad|name.zip`, /\(windows-invalid-character\)/],
      [`folder\\${'x'.repeat(256)}.zip`, /\(component-too-long\)/],
    ];
    for (const [output, expectedReason] of cases) {
      const build = spawnBuildZip(output, { cwd: fixture });
      assert.equal(build.status, 2, `${build.stdout}\n${build.stderr}`);
      assert.match(build.stderr, /archive output is not a valid native filesystem path/);
      assert.match(build.stderr, expectedReason);
      assert.ok(build.stderr.includes(JSON.stringify(output)),
        'the archive validator must receive the exact raw output spelling');
      assert.deepEqual(fs.readdirSync(fixture), [], 'a rejected output spelling must not create files');
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('archive output grammar is owned by the shared native-path validator', () => {
  const buildSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'build-zip.sh'), 'utf8');
  const writerSource = fs.readFileSync(
    path.join(repoRoot, 'scripts', 'write-deterministic-zip.mjs'),
    'utf8',
  );
  assert.doesNotMatch(buildSource, /windows_(?:drive|current|device|extended|dot|unc)/);
  assert.match(writerSource, /import \{ validateNativeOutputPath \} from/);
  assert.equal(writerSource.match(/kind: 'file'/gu)?.length, 2);
  assert.ok(
    writerSource.indexOf('validateNativeOutputPath(') < writerSource.indexOf('path.resolve(outputArg)'),
    'the raw output spelling must be validated before it is normalized or any archive write begins',
  );
  const validationOnly = buildSource.indexOf('--validate-output "$out"');
  const nodeMajorGate = buildSource.indexOf('node_version=');
  assert.notEqual(validationOnly, -1, 'the archive build must invoke the writer path-only validation mode');
  assert.notEqual(nodeMajorGate, -1, 'the archive build must retain its canonical Node-major gate');
  assert.ok(
    validationOnly < nodeMajorGate,
    'raw output validation must run before the canonical Node-major gate',
  );
});

test('archive build keeps unsafe-path diagnostics ahead of the canonical Node gate', {
  skip: process.platform === 'win32' ? 'the POSIX node shim is unnecessary on the real Windows Node 24 lane' : false,
}, () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-node-gate-order-'));
  const shimDirectory = path.join(fixture, 'bin');
  const nodeShim = path.join(shimDirectory, 'node');
  fs.mkdirSync(shimDirectory);
  fs.writeFileSync(nodeShim, `#!/usr/bin/env bash
if [[ "$1" == "-p" && "$2" == "process.versions.node" ]]; then
  printf '%s\\n' '24.0.0'
  exit 0
fi
exec "$ARCHIFY_REAL_NODE" "$@"
`);
  fs.chmodSync(nodeShim, 0o755);
  const env = {
    ...process.env,
    ARCHIFY_REAL_NODE: process.execPath,
    PATH: `${shimDirectory}${path.delimiter}${process.env.PATH || ''}`,
  };
  try {
    const unsafe = spawnBuildZip('C:drive-relative.zip', { cwd: fixture, env });
    assert.equal(unsafe.status, 2, `${unsafe.stdout}\n${unsafe.stderr}`);
    assert.match(unsafe.stderr, /archive output is not a valid native filesystem path \(drive-relative\)/);

    const safeParent = path.join(fixture, 'missing-parent');
    const safeOutput = path.join(safeParent, 'safe.zip');
    const safe = spawnBuildZip(safeOutput, { cwd: fixture, env });
    assert.equal(safe.status, 1, `${safe.stdout}\n${safe.stderr}`);
    assert.match(safe.stderr, /canonical archify[.]zip builds require Node 22 \(current: 24[.]0[.]0\)/);
    assert.equal(fs.existsSync(safeOutput), false);
    assert.equal(fs.existsSync(safeParent), false, 'path-only validation must not create output parents');
    assert.deepEqual(fs.readdirSync(fixture).sort(), ['bin']);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('archive output rejection preserves an existing unsafe target byte-for-byte', {
  skip: process.platform === 'win32' ? 'Windows cannot create the reserved-name fixture' : false,
}, () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-output-preserve-'));
  const output = path.join(fixture, 'CON.zip');
  const sentinel = Buffer.from('existing archive sentinel\n');
  try {
    fs.writeFileSync(output, sentinel);
    const build = spawnBuildZip(output, { cwd: fixture });
    assert.equal(build.status, 2, `${build.stdout}\n${build.stderr}`);
    assert.match(build.stderr, /archive output is not a valid native filesystem path/);
    assert.ok(fs.readFileSync(output).equals(sentinel));
    assert.deepEqual(fs.readdirSync(fixture), ['CON.zip']);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

canonicalZipTest('package smoke rejects every dependency metadata field in a built package', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-built-package-gate-'));
  try {
    const archive = path.join(fixture, 'archify.zip');
    const build = spawnBuildZip(archive);
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

    const extracted = path.join(fixture, 'extracted');
    fs.mkdirSync(extracted);
    const unzip = spawnSync('unzip', ['-q', archive, '-d', extracted], { encoding: 'utf8' });
    assert.equal(unzip.status, 0, `${unzip.stdout}\n${unzip.stderr}`);
    const builtPackage = path.join(extracted, 'archify');
    const dependencyFields = {
      dependencies: { runtime: '1.0.0' },
      devDependencies: { build: '1.0.0' },
      optionalDependencies: { optional: '1.0.0' },
      peerDependencies: { peer: '1.0.0' },
      bundledDependencies: ['bundled'],
      bundleDependencies: ['bundle-alias'],
    };

    for (const [field, value] of Object.entries(dependencyFields)) {
      const caseRoot = path.join(fixture, field);
      fs.cpSync(builtPackage, caseRoot, { recursive: true });
      const packagePath = path.join(caseRoot, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      packageJson[field] = value;
      fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);

      const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'package-smoke.mjs'), caseRoot], {
        encoding: 'utf8',
      });
      assert.notEqual(result.status, 0, `${field} must fail package smoke`);
      assert.match(`${result.stdout}\n${result.stderr}`, new RegExp(`dependency metadata: ${field}\\b`));
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

canonicalZipTest('built archives contain the embedded notifier runtime', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-notifier-package-gate-'));
  try {
    const archive = path.join(fixture, 'archify.zip');
    const build = spawnBuildZip(archive);
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

    const listing = spawnSync('unzip', ['-Z1', archive], { encoding: 'utf8' });
    assert.equal(listing.status, 0, `${listing.stdout}\n${listing.stderr}`);
    const entries = new Set(listing.stdout.trim().split('\n'));
    assert.ok(entries.has('archify/skill-release.json'));
    assert.ok(entries.has('archify/scripts/check-update.mjs'));
    assert.ok(entries.has('archify/scripts/update-contract.mjs'));
    assert.ok(entries.has('archify/renderers/shared/atomic-output.mjs'));
    assert.ok(entries.has('archify/renderers/shared/sidecar-path.mjs'));
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

canonicalZipTest('archive build excludes untracked files and external symlinks from the live working tree', () => {
  const marker = `.package-negative-${process.pid}-${Date.now()}`;
  const untracked = path.join(repoRoot, 'archify', `${marker}.txt`);
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-external-'));
  const externalTarget = path.join(externalRoot, 'secret.txt');
  const externalLink = path.join(repoRoot, 'archify', `${marker}.link`);
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-negative-'));
  const archive = path.join(outputRoot, 'archify.zip');

  try {
    fs.writeFileSync(untracked, 'must not ship\n');
    fs.writeFileSync(externalTarget, 'external content must not ship\n');
    fs.symlinkSync(externalTarget, externalLink, 'file');

    const build = spawnBuildZip(archive);
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

    const listing = spawnSync('unzip', ['-Z1', archive], { encoding: 'utf8' });
    assert.equal(listing.status, 0, `${listing.stdout}\n${listing.stderr}`);
    assert.doesNotMatch(listing.stdout, new RegExp(marker), 'untracked files and symlinks must not enter the archive');
  } finally {
    fs.rmSync(untracked, { force: true });
    fs.rmSync(externalLink, { force: true });
    fs.rmSync(externalRoot, { recursive: true, force: true });
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

canonicalZipTest('archive build rejects an unmerged index and preserves an existing archive', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-unmerged-'));
  const scripts = path.join(fixture, 'scripts');
  const skill = path.join(fixture, 'archify');
  const license = path.join(skill, 'LICENSE');
  const archive = path.join(fixture, 'trusted.zip');
  const trusted = Buffer.from('trusted archive bytes');
  const git = (args, options = {}) => spawnSync('git', args, {
    cwd: fixture,
    encoding: 'utf8',
    ...options,
  });

  try {
    fs.mkdirSync(path.join(skill, 'renderers', 'shared'), { recursive: true });
    fs.mkdirSync(path.join(skill, 'scripts'), { recursive: true });
    fs.mkdirSync(scripts);
    fs.copyFileSync(path.join(repoRoot, 'scripts', 'build-zip.sh'), path.join(scripts, 'build-zip.sh'));
    fs.copyFileSync(
      path.join(repoRoot, 'scripts', 'write-deterministic-zip.mjs'),
      path.join(scripts, 'write-deterministic-zip.mjs'),
    );
    fs.copyFileSync(
      path.join(repoRoot, 'scripts', 'stage-clean-skill.mjs'),
      path.join(scripts, 'stage-clean-skill.mjs'),
    );
    fs.copyFileSync(
      path.join(repoRoot, 'scripts', 'third-party-notices-contract.mjs'),
      path.join(scripts, 'third-party-notices-contract.mjs'),
    );
    fs.copyFileSync(
      path.join(repoRoot, 'archify', 'renderers', 'shared', 'portable-path.mjs'),
      path.join(skill, 'renderers', 'shared', 'portable-path.mjs'),
    );
    fs.copyFileSync(
      path.join(repoRoot, 'archify', 'renderers', 'shared', 'path-semantics.mjs'),
      path.join(skill, 'renderers', 'shared', 'path-semantics.mjs'),
    );
    fs.copyFileSync(
      path.join(repoRoot, 'archify', 'renderers', 'shared', 'output-path.mjs'),
      path.join(skill, 'renderers', 'shared', 'output-path.mjs'),
    );
    fs.copyFileSync(
      path.join(repoRoot, 'archify', 'renderers', 'shared', 'atomic-output.mjs'),
      path.join(skill, 'renderers', 'shared', 'atomic-output.mjs'),
    );
    fs.writeFileSync(path.join(skill, 'renderers', 'shared', 'generated-validators.mjs'), 'export default {};\n');
    fs.writeFileSync(path.join(skill, 'scripts', 'check-update.mjs'), 'export {};\n');
    fs.writeFileSync(path.join(skill, 'scripts', 'update-contract.mjs'), 'export {};\n');
    fs.writeFileSync(path.join(skill, 'skill-release.json'), '{}\n');
    fs.writeFileSync(path.join(skill, 'package.json'), '{"name":"archify"}\n');
    fs.writeFileSync(license, 'base\n');
    assert.equal(git(['init']).status, 0);
    assert.equal(git(['add', '.']).status, 0);

    const base = git(['hash-object', '-w', '--stdin'], { input: 'base\n' });
    const ours = git(['hash-object', '-w', '--stdin'], { input: 'ours\n' });
    const theirs = git(['hash-object', '-w', '--stdin'], { input: 'theirs\n' });
    for (const result of [base, ours, theirs]) assert.equal(result.status, 0, result.stderr);
    const indexInfo = [
      `100644 ${base.stdout.trim()} 1\tarchify/LICENSE`,
      `100644 ${ours.stdout.trim()} 2\tarchify/LICENSE`,
      `100644 ${theirs.stdout.trim()} 3\tarchify/LICENSE`,
      '',
    ].join('\n');
    assert.equal(git(['update-index', '--index-info'], { input: indexInfo }).status, 0);
    fs.writeFileSync(license, '<<<<<<< ours\n=======\n>>>>>>> theirs\n');
    fs.writeFileSync(archive, trusted);

    const build = spawnSync('bash', [path.join(scripts, 'build-zip.sh'), archive], {
      cwd: fixture,
      encoding: 'utf8',
    });
    assert.notEqual(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.match(build.stderr, /refusing to package unmerged index entry/);
    assert.ok(fs.readFileSync(archive).equals(trusted), 'a failed build must preserve the trusted archive');
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('archive build rejects non-canonical Node versions before publishing output', {
  skip: currentNodeMajor === canonicalZipNodeMajor
    ? `requires a Node major other than ${canonicalZipNodeMajor}`
    : false,
}, () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-node-version-'));
  try {
    const archive = path.join(outputRoot, 'archify.zip');
    const trusted = Buffer.from('existing canonical archive');
    fs.writeFileSync(archive, trusted);
    const build = spawnBuildZip(archive);
    assert.notEqual(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.match(build.stderr, /canonical archify\.zip builds require Node 22/);
    assert.ok(fs.readFileSync(archive).equals(trusted), 'version rejection must preserve the canonical archive');
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

canonicalZipTest('archive build is byte-for-byte reproducible across caller time zones without system zip', () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-reproducible-'));
  const utcArchive = path.join(outputRoot, 'utc.zip');
  const honoluluArchive = path.join(outputRoot, 'honolulu.zip');

  try {
    for (const [archive, timezone] of [
      [utcArchive, 'UTC'],
      [honoluluArchive, 'Pacific/Honolulu'],
    ]) {
      const build = spawnBuildZip(archive, {
        env: { ...process.env, TZ: timezone },
      });
      assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    }

    assert.ok(
      fs.readFileSync(utcArchive).equals(fs.readFileSync(honoluluArchive)),
      'identical tracked inputs must produce identical archive bytes',
    );
    assert.ok(
      fs.readFileSync(utcArchive).equals(fs.readFileSync(path.join(repoRoot, 'archify.zip'))),
      'the canonical archive toolchain must reproduce the committed archive bytes',
    );
    assert.deepEqual(
      fs.readdirSync(outputRoot).sort(),
      ['honolulu.zip', 'utc.zip'],
      'successful archive publication must not leave temporary files behind',
    );
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

test('archive build accepts Windows-style absolute output paths', {
  skip: process.platform !== 'win32'
    ? 'Windows drive paths only reach build-zip.sh on win32'
    : currentNodeMajor === canonicalZipNodeMajor
      ? false
      : `canonical ZIP builds require Node ${canonicalZipNodeMajor}`,
}, () => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-package-windows-path-'));
  const backslashArchive = path.win32.join(outputRoot, 'backslash.zip');
  const slashArchive = path.win32.join(outputRoot, 'slash.zip').replace(/\\/g, '/');

  try {
    for (const archive of [backslashArchive, slashArchive]) {
      const build = spawnBuildZip(archive);
      assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
      assert.ok(fs.existsSync(archive), `archive must be written to the requested path: ${archive}`);
    }
    const reference = fs.readFileSync(backslashArchive);
    for (const archive of [slashArchive]) {
      assert.ok(
        reference.equals(fs.readFileSync(archive)),
        `every Windows path form must produce identical archive bytes: ${archive}`,
      );
    }
    assert.deepEqual(
      fs.readdirSync(outputRoot).sort(),
      ['backslash.zip', 'slash.zip'],
      'successful archive publication must not leave temporary files behind',
    );
  } finally {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  }
});

function centralDirectoryModes(archive) {
  const buffer = fs.readFileSync(archive);
  const end = buffer.length - 22;
  assert.equal(buffer.readUInt32LE(end), 0x06054b50, 'archive must end with an end-of-central-directory record');
  const entryCount = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const modes = {};
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(buffer.readUInt32LE(offset), 0x02014b50, 'central directory entry signature');
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    modes[name] = (buffer.readUInt32LE(offset + 38) >>> 16) & 0o7777;
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return modes;
}

function writeArchive(stagedRoot, archive, modeManifest, options = {}) {
  const args = [path.join(repoRoot, 'scripts', 'write-deterministic-zip.mjs'), stagedRoot, archive];
  if (modeManifest !== null) args.push('--mode-manifest', modeManifest);
  return spawnSync(process.execPath, args, { encoding: 'utf8', ...options });
}

function stagedFixture(files) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-zip-modes-'));
  const staged = path.join(fixture, 'archify');
  for (const [relative, { content, mode }] of Object.entries(files)) {
    const target = path.join(staged, ...relative.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    fs.chmodSync(target, mode);
  }
  return { fixture, staged };
}

test('archive writer publishes over a maximum-length output component without an oversized candidate name', () => {
  const { fixture, staged } = stagedFixture({
    'README.md': { content: 'bounded archive candidate\n', mode: 0o644 },
  });
  try {
    const manifest = path.join(fixture, 'modes.json');
    fs.writeFileSync(manifest, JSON.stringify({ 'README.md': '100644' }));
    const archive = path.join(fixture, `${'a'.repeat(251)}.zip`);
    fs.writeFileSync(archive, 'trusted previous archive');

    const build = writeArchive(staged, archive, manifest);

    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.equal(fs.readFileSync(archive).readUInt32LE(0), 0x04034b50);
    assert.deepEqual(
      fs.readdirSync(fixture).filter((name) => name.endsWith('.tmp')),
      [],
      'successful publication must not leave a temporary candidate behind',
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('archive writer records Git index modes from the manifest, not filesystem bits', () => {
  const { fixture, staged } = stagedFixture({
    'bin/tool.mjs': { content: '#!/usr/bin/env node\n', mode: 0o644 },
    'docs/notes.txt': { content: 'notes\n', mode: 0o755 },
  });
  try {
    const manifest = path.join(fixture, 'modes.json');
    fs.writeFileSync(manifest, JSON.stringify({ 'bin/tool.mjs': '100755', 'docs/notes.txt': '100644' }));

    const first = path.join(fixture, 'first.zip');
    const build = writeArchive(staged, first, manifest);
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.deepEqual(centralDirectoryModes(first), {
      'archify/bin/tool.mjs': 0o755,
      'archify/docs/notes.txt': 0o644,
    });

    // Flip the on-disk bits; the recorded modes must still decide the bytes.
    fs.chmodSync(path.join(staged, 'bin', 'tool.mjs'), 0o755);
    fs.chmodSync(path.join(staged, 'docs', 'notes.txt'), 0o644);
    const second = path.join(fixture, 'second.zip');
    const rebuild = writeArchive(staged, second, manifest);
    assert.equal(rebuild.status, 0, `${rebuild.stdout}\n${rebuild.stderr}`);
    assert.ok(
      fs.readFileSync(first).equals(fs.readFileSync(second)),
      'archive bytes must not depend on filesystem permission bits',
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('archive writer fails closed when the mode manifest and the staged tree disagree', () => {
  const { fixture, staged } = stagedFixture({
    'bin/tool.mjs': { content: '#!/usr/bin/env node\n', mode: 0o755 },
    'docs/notes.txt': { content: 'notes\n', mode: 0o644 },
  });
  try {
    const archive = path.join(fixture, 'out.zip');
    const cases = [
      [null, /--mode-manifest/, 2],
      [{ 'bin/tool.mjs': '100755' }, /no recorded Git mode: docs\/notes\.txt/, 1],
      [{ 'bin/tool.mjs': '100755', 'docs/notes.txt': '100644', 'extra.txt': '100644' }, /not staged: extra\.txt/, 1],
      [{ 'bin/tool.mjs': '100777', 'docs/notes.txt': '100644' }, /unsupported Git mode "100777"/, 1],
    ];
    for (const [manifestContent, expected, status] of cases) {
      let manifest = null;
      if (manifestContent !== null) {
        manifest = path.join(fixture, 'modes.json');
        fs.writeFileSync(manifest, JSON.stringify(manifestContent));
      }
      const build = writeArchive(staged, archive, manifest);
      assert.equal(build.status, status, `${build.stdout}\n${build.stderr}`);
      assert.match(build.stderr, expected);
      assert.equal(fs.existsSync(archive), false, 'a rejected build must not publish an archive');
      assert.deepEqual(
        fs.readdirSync(fixture).filter((name) => name.endsWith('.tmp')),
        [],
        'a rejected build must not leave temporary files behind',
      );
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('archive writer rejects existing and dangling output symlinks without mutation', (t) => {
  const { fixture, staged } = stagedFixture({
    'safe.txt': { content: 'safe\n', mode: 0o644 },
  });
  const manifest = path.join(fixture, 'modes.json');
  fs.writeFileSync(manifest, JSON.stringify({ 'safe.txt': '100644' }));
  try {
    const external = path.join(fixture, 'external.zip');
    const sentinel = Buffer.from('external sentinel\n');
    fs.writeFileSync(external, sentinel);

    const linked = path.join(fixture, 'linked.zip');
    try {
      fs.symlinkSync(external, linked, process.platform === 'win32' ? 'file' : undefined);
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
        t.skip(`file symlinks unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    let build = writeArchive(staged, linked, manifest);
    assert.notEqual(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.match(build.stderr, /requested-entry-symbolic-link/);
    assert.equal(fs.lstatSync(linked).isSymbolicLink(), true);
    assert.ok(fs.readFileSync(external).equals(sentinel));

    const dangling = path.join(fixture, 'dangling.zip');
    const missing = path.join(fixture, 'missing.zip');
    fs.symlinkSync(missing, dangling, process.platform === 'win32' ? 'file' : undefined);
    build = writeArchive(staged, dangling, manifest);
    assert.notEqual(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.match(build.stderr, /requested-entry-symbolic-link/);
    assert.equal(fs.lstatSync(dangling).isSymbolicLink(), true);
    assert.equal(fs.existsSync(missing), false);

    assert.deepEqual(
      fs.readdirSync(fixture).filter((name) => name.endsWith('.tmp')),
      [],
      'rejected output symlinks must not leave temporary files behind',
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('archive writer rejects a special output entry without replacing it', {
  skip: process.platform === 'win32' ? 'the FIFO fixture is POSIX-only' : false,
}, () => {
  const { fixture, staged } = stagedFixture({
    'safe.txt': { content: 'safe\n', mode: 0o644 },
  });
  const manifest = path.join(fixture, 'modes.json');
  const fifo = path.join(fixture, 'special.zip');
  fs.writeFileSync(manifest, JSON.stringify({ 'safe.txt': '100644' }));
  try {
    const mkfifo = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
    assert.equal(mkfifo.status, 0, mkfifo.stderr);
    const build = writeArchive(staged, fifo, manifest);
    assert.notEqual(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.match(build.stderr, /requested-entry-not-regular-file/);
    assert.equal(fs.lstatSync(fifo).isFIFO(), true);
    assert.deepEqual(
      fs.readdirSync(fixture).filter((name) => name.endsWith('.tmp')),
      [],
      'special-entry rejection must happen before a temporary archive is created',
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('archive writer rejects a hard-linked output without changing either name', () => {
  const { fixture, staged } = stagedFixture({
    'safe.txt': { content: 'safe\n', mode: 0o644 },
  });
  const manifest = path.join(fixture, 'modes.json');
  const external = path.join(fixture, 'external.zip');
  const archive = path.join(fixture, 'archive.zip');
  const sentinel = Buffer.from('shared archive sentinel\n');
  fs.writeFileSync(manifest, JSON.stringify({ 'safe.txt': '100644' }));
  fs.writeFileSync(external, sentinel);
  fs.linkSync(external, archive);
  try {
    const before = fs.statSync(archive, { bigint: true });
    const build = writeArchive(staged, archive, manifest);
    assert.notEqual(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.match(build.stderr, /requested-entry-hardlinked/);
    assert.ok(fs.readFileSync(archive).equals(sentinel));
    assert.ok(fs.readFileSync(external).equals(sentinel));
    const after = fs.statSync(archive, { bigint: true });
    assert.equal(after.dev, before.dev);
    assert.equal(after.ino, before.ino);
    assert.equal(after.nlink, 2n);
    assert.deepEqual(
      fs.readdirSync(fixture).filter((name) => name.endsWith('.tmp')),
      [],
      'hard-link rejection must happen before a temporary archive is created',
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('archive writer verifies the output binding immediately before publication', () => {
  const { fixture, staged } = stagedFixture({
    'safe.txt': { content: 'safe\n', mode: 0o644 },
  });
  const manifest = path.join(fixture, 'modes.json');
  const archive = path.join(fixture, 'archive.zip');
  const replacement = path.join(fixture, 'replacement.zip');
  const preload = path.join(fixture, 'swap-before-rename.cjs');
  const original = Buffer.from('original archive\n');
  const claimant = Buffer.from('replacement claimant\n');
  fs.writeFileSync(manifest, JSON.stringify({ 'safe.txt': '100644' }));
  fs.writeFileSync(archive, original);
  fs.writeFileSync(replacement, claimant);
  fs.writeFileSync(preload, String.raw`
const fs = require('node:fs');
const path = require('node:path');
const output = process.env.ARCHIFY_TEST_SWAP_OUTPUT;
const replacement = process.env.ARCHIFY_TEST_SWAP_REPLACEMENT;
const originalOpen = fs.openSync;
const originalClose = fs.closeSync;
let temporaryDescriptor;
let swapped = false;
fs.openSync = function patchedOpen(file, ...args) {
  const descriptor = originalOpen.call(this, file, ...args);
  if (typeof file === 'string'
      && /^\.archify-zip-[a-f\d]{16}-[a-f\d]{32}\.tmp$/.test(path.basename(file))) {
    temporaryDescriptor = descriptor;
  }
  return descriptor;
};
fs.closeSync = function patchedClose(descriptor) {
  const result = originalClose.call(this, descriptor);
  if (!swapped && descriptor === temporaryDescriptor) {
    swapped = true;
    fs.unlinkSync(output);
    fs.renameSync(replacement, output);
  }
  return result;
};
require('node:module').syncBuiltinESMExports();
`);
  try {
    const build = writeArchive(staged, archive, manifest, {
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--import=${pathToFileURL(preload).href}`,
        ARCHIFY_TEST_SWAP_OUTPUT: archive,
        ARCHIFY_TEST_SWAP_REPLACEMENT: replacement,
      },
    });
    assert.notEqual(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.match(build.stderr, /(?:requested-entry-changed|target-identity-changed)/);
    assert.ok(fs.readFileSync(archive).equals(claimant), 'the replacement claimant must not be overwritten');
    assert.equal(fs.existsSync(replacement), false, 'the fixture must actually move the claimant into place');
    assert.deepEqual(
      fs.readdirSync(fixture).filter((name) => name.endsWith('.tmp')),
      [],
      'a failed pre-rename verification must remove the unpublished temporary archive',
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('archive writer preserves a target claimant that arrives after the previous output is backed up', () => {
  const { fixture, staged } = stagedFixture({
    'safe.txt': { content: 'safe\n', mode: 0o644 },
  });
  const manifest = path.join(fixture, 'modes.json');
  const archive = path.join(fixture, 'archive.zip');
  const preload = path.join(fixture, 'claim-archive-target.cjs');
  const original = Buffer.from('previous archive\n');
  const claimant = Buffer.from('concurrent archive claimant\n');
  fs.writeFileSync(manifest, JSON.stringify({ 'safe.txt': '100644' }));
  fs.writeFileSync(archive, original);
  fs.writeFileSync(preload, String.raw`
const fs = require('node:fs');
const path = require('node:path');
const output = process.env.ARCHIFY_TEST_ARCHIVE_OUTPUT;
const claimant = process.env.ARCHIFY_TEST_ARCHIVE_CLAIMANT;
const originalLink = fs.linkSync;
const originalWriteFile = fs.writeFileSync;
let injected = false;
fs.linkSync = function patchedLink(source, destination) {
  if (!injected
      && path.basename(destination) === path.basename(output)
      && /^\.archify-zip-[a-f\d]{16}-[a-f\d]{32}\.tmp$/.test(path.basename(source))) {
    originalWriteFile(output, claimant, { flag: 'wx' });
    injected = true;
  }
  return originalLink.call(this, source, destination);
};
require('node:module').syncBuiltinESMExports();
`);
  try {
    const build = writeArchive(staged, archive, manifest, {
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--import=${pathToFileURL(preload).href}`,
        ARCHIFY_TEST_ARCHIVE_OUTPUT: archive,
        ARCHIFY_TEST_ARCHIVE_CLAIMANT: claimant.toString('utf8'),
      },
    });
    assert.notEqual(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.match(build.stderr, /requires recovery/);
    assert.ok(fs.readFileSync(archive).equals(claimant), 'the concurrent target claimant must remain public');
    const backups = fs.readdirSync(fixture)
      .filter((name) => /^\.archify-zip-backup-[a-f\d]{16}-[a-f\d]{32}\.tmp$/.test(name));
    assert.equal(backups.length, 1, 'the displaced previous output must remain recoverable');
    assert.ok(fs.readFileSync(path.join(fixture, backups[0])).equals(original));
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('archive writer rejects a candidate changed while the final output state is checked', () => {
  const { fixture, staged } = stagedFixture({
    'safe.txt': { content: 'safe\n', mode: 0o644 },
  });
  const manifest = path.join(fixture, 'modes.json');
  const archive = path.join(fixture, 'archive.zip');
  const preload = path.join(fixture, 'mutate-archive-candidate.cjs');
  const original = Buffer.from('original archive\n');
  fs.writeFileSync(manifest, JSON.stringify({ 'safe.txt': '100644' }));
  fs.writeFileSync(archive, original);
  fs.writeFileSync(preload, String.raw`
const fs = require('node:fs');
const path = require('node:path');
const output = process.env.ARCHIFY_TEST_ARCHIVE_OUTPUT;
const originalOpen = fs.openSync;
const originalLstat = fs.lstatSync;
const originalWriteFile = fs.writeFileSync;
let candidatePath;
let candidateOpens = 0;
let mutated = false;
fs.openSync = function patchedOpen(file, ...args) {
  const descriptor = originalOpen.call(this, file, ...args);
  if (typeof file === 'string'
      && /^\.archify-zip-[a-f\d]{16}-[a-f\d]{32}\.tmp$/.test(path.basename(file))) {
    candidatePath = file;
    candidateOpens += 1;
  }
  return descriptor;
};
fs.lstatSync = function patchedLstat(file, ...args) {
  if (!mutated && candidateOpens >= 2 && path.resolve(file) === path.resolve(output)) {
    mutated = true;
    originalWriteFile(candidatePath, 'mutated candidate bytes\n');
  }
  return originalLstat.call(this, file, ...args);
};
require('node:module').syncBuiltinESMExports();
`);
  try {
    const build = writeArchive(staged, archive, manifest, {
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--import=${pathToFileURL(preload).href}`,
        ARCHIFY_TEST_ARCHIVE_OUTPUT: archive,
      },
    });
    assert.notEqual(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.match(build.stderr, /archive-candidate-content-changed/);
    assert.ok(fs.readFileSync(archive).equals(original));
    assert.deepEqual(
      fs.readdirSync(fixture).filter((name) => name.endsWith('.tmp')),
      [],
      'an in-place candidate mutation must be rejected and cleaned up by identity',
    );
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('archive writer preserves a successor that replaces its temporary candidate', {
  skip: process.platform === 'win32'
    ? 'Windows does not unlink an archive candidate while its verification handle is open'
    : false,
}, () => {
  const { fixture, staged } = stagedFixture({
    'safe.txt': { content: 'safe\n', mode: 0o644 },
  });
  const manifest = path.join(fixture, 'modes.json');
  const archive = path.join(fixture, 'archive.zip');
  const preload = path.join(fixture, 'replace-archive-candidate.cjs');
  const original = Buffer.from('original archive\n');
  const successor = Buffer.from('candidate successor claimant\n');
  fs.writeFileSync(manifest, JSON.stringify({ 'safe.txt': '100644' }));
  fs.writeFileSync(archive, original);
  fs.writeFileSync(preload, String.raw`
const fs = require('node:fs');
const path = require('node:path');
const output = process.env.ARCHIFY_TEST_ARCHIVE_OUTPUT;
const successor = process.env.ARCHIFY_TEST_ARCHIVE_SUCCESSOR;
const originalOpen = fs.openSync;
const originalLstat = fs.lstatSync;
const originalUnlink = fs.unlinkSync;
const originalWriteFile = fs.writeFileSync;
let candidatePath;
let candidateOpens = 0;
let swapped = false;
fs.openSync = function patchedOpen(file, ...args) {
  const descriptor = originalOpen.call(this, file, ...args);
  if (typeof file === 'string'
      && /^\.archify-zip-[a-f\d]{16}-[a-f\d]{32}\.tmp$/.test(path.basename(file))) {
    candidatePath = file;
    candidateOpens += 1;
  }
  return descriptor;
};
fs.lstatSync = function patchedLstat(file, ...args) {
  if (!swapped && candidateOpens >= 2 && path.resolve(file) === path.resolve(output)) {
    swapped = true;
    originalUnlink(candidatePath);
    originalWriteFile(candidatePath, successor, { flag: 'wx' });
  }
  return originalLstat.call(this, file, ...args);
};
require('node:module').syncBuiltinESMExports();
`);
  try {
    const build = writeArchive(staged, archive, manifest, {
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--import=${pathToFileURL(preload).href}`,
        ARCHIFY_TEST_ARCHIVE_OUTPUT: archive,
        ARCHIFY_TEST_ARCHIVE_SUCCESSOR: successor.toString('utf8'),
      },
    });
    assert.notEqual(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.match(build.stderr, /archive-candidate-identity-changed/);
    assert.ok(fs.readFileSync(archive).equals(original));
    const candidates = fs.readdirSync(fixture).filter((name) => name.endsWith('.tmp'));
    assert.equal(candidates.length, 1, 'the replacement claimant must remain named');
    assert.ok(fs.readFileSync(path.join(fixture, candidates[0])).equals(successor));
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('archive writer keeps the candidate identity bound through commit and preserves a release-time successor', () => {
  const { fixture, staged } = stagedFixture({
    'safe.txt': { content: 'safe\n', mode: 0o644 },
  });
  const manifest = path.join(fixture, 'modes.json');
  const archive = path.join(fixture, 'archive.zip');
  const preload = path.join(fixture, 'replace-candidate-on-release.cjs');
  const successor = Buffer.from('release-time candidate claimant\n');
  fs.writeFileSync(manifest, JSON.stringify({ 'safe.txt': '100644' }));
  fs.writeFileSync(archive, 'previous archive\n');
  fs.writeFileSync(preload, String.raw`
const fs = require('node:fs');
const path = require('node:path');
const successor = process.env.ARCHIFY_TEST_ARCHIVE_SUCCESSOR;
const originalOpen = fs.openSync;
const originalClose = fs.closeSync;
const originalUnlink = fs.unlinkSync;
const originalWriteFile = fs.writeFileSync;
let candidatePath;
let candidateOpens = 0;
let bindingDescriptor;
let swapped = false;
fs.openSync = function patchedOpen(file, ...args) {
  const descriptor = originalOpen.call(this, file, ...args);
  if (typeof file === 'string'
      && /^\.archify-zip-[a-f\d]{16}-[a-f\d]{32}\.tmp$/.test(path.basename(file))) {
    candidatePath = file;
    candidateOpens += 1;
    if (candidateOpens === 2) bindingDescriptor = descriptor;
  }
  return descriptor;
};
fs.closeSync = function patchedClose(descriptor) {
  const result = originalClose.call(this, descriptor);
  if (!swapped && descriptor === bindingDescriptor) {
    swapped = true;
    try { originalUnlink(candidatePath); } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    originalWriteFile(candidatePath, successor, { flag: 'wx' });
  }
  return result;
};
require('node:module').syncBuiltinESMExports();
`);
  try {
    const build = writeArchive(staged, archive, manifest, {
      env: {
        ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--import=${pathToFileURL(preload).href}`,
        ARCHIFY_TEST_ARCHIVE_SUCCESSOR: successor.toString('utf8'),
      },
    });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.equal(fs.readFileSync(archive).readUInt32LE(0), 0x04034b50);
    const candidates = fs.readdirSync(fixture)
      .filter((name) => /^\.archify-zip-[a-f\d]{16}-[a-f\d]{32}\.tmp$/.test(name));
    assert.equal(candidates.length, 1, 'the release-time successor must remain named');
    assert.ok(fs.readFileSync(path.join(fixture, candidates[0])).equals(successor));
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('archive writer preserves an existing regular output mode despite a restrictive umask', {
  skip: process.platform === 'win32' ? 'Windows does not expose POSIX creation modes' : false,
}, () => {
  const { fixture, staged } = stagedFixture({
    'safe.txt': { content: 'safe\n', mode: 0o644 },
  });
  const manifest = path.join(fixture, 'modes.json');
  const archive = path.join(fixture, 'archive.zip');
  const fresh = path.join(fixture, 'fresh.zip');
  const preload = path.join(fixture, 'restrict-umask.cjs');
  fs.writeFileSync(manifest, JSON.stringify({ 'safe.txt': '100644' }));
  fs.writeFileSync(archive, 'existing archive\n');
  fs.chmodSync(archive, 0o664);
  fs.writeFileSync(preload, 'process.umask(0o077);\n');
  const options = {
    env: {
      ...process.env,
      NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ''}--import=${pathToFileURL(preload).href}`,
    },
  };
  try {
    let build = writeArchive(staged, archive, manifest, options);
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.equal(fs.statSync(archive).mode & 0o777, 0o664);

    build = writeArchive(staged, fresh, manifest, options);
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);
    assert.equal(fs.statSync(fresh).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('archive writer rejects non-portable manifest entries and collisions before publication', () => {
  const { fixture, staged } = stagedFixture({
    'safe.txt': { content: 'safe\n', mode: 0o644 },
  });
  const archive = path.join(fixture, 'trusted.zip');
  const trusted = Buffer.from('trusted archive bytes');
  const manifest = path.join(fixture, 'modes.json');
  try {
    const cases = [
      [
        { 'safe.txt': '100644', 'CON.txt': '100644' },
        /Portable path must not use a reserved Windows device name/,
      ],
      [
        { 'safe.txt': '100644', 'Docs/one.txt': '100644', 'docs/two.txt': '100644' },
        /collide under portable filesystem semantics/,
      ],
    ];
    for (const [contents, expected] of cases) {
      fs.writeFileSync(archive, trusted);
      fs.writeFileSync(manifest, JSON.stringify(contents));
      const build = writeArchive(staged, archive, manifest);
      assert.notEqual(build.status, 0, `${build.stdout}\n${build.stderr}`);
      assert.match(build.stderr, expected);
      assert.ok(fs.readFileSync(archive).equals(trusted), 'portable-name rejection must preserve the prior archive');
      assert.deepEqual(
        fs.readdirSync(fixture).filter((name) => name.endsWith('.tmp')),
        [],
        'portable-name rejection must not leave temporary files behind',
      );
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('archive build hands the recorded Git index modes from the stager to the writer', () => {
  const buildSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'build-zip.sh'), 'utf8');
  assert.match(buildSource, /stage-clean-skill\.mjs[\s\S]*?--mode-manifest "\$stage\/modes\.json"/);
  assert.match(buildSource, /write-deterministic-zip\.mjs"[^\n]*\n\s*--mode-manifest "\$stage\/modes\.json"/);
});

test('CI tests the declared Node floor plus every maintained current lane', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'archify', 'package.json'), 'utf8'));
  assert.equal(packageJson.engines?.node, '>=18');

  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
  const testJob = workflowJob(workflow, 'test');
  const versions = testJob.match(/node-version:\s*\[([^\]]+)\]/)?.[1]
    .split(',')
    .map((version) => Number(version.trim()));
  assert.ok(versions, 'test job must declare an explicit Node version matrix');
  for (const version of [18, 20, 22, 24]) {
    assert.ok(versions.includes(version), `test matrix must cover Node ${version}`);
  }

  const packageSmokeJob = workflowJob(workflow, 'package-smoke');
  assert.match(packageSmokeJob, /os:\s*\[ubuntu-latest, macos-latest, windows-latest\]/);
  assert.match(packageSmokeJob, /node-version:\s*22/);
});

test('CI and tagged releases share the maintained Windows path contract on Node 22 and 24', () => {
  const runnerPath = path.join(repoRoot, 'scripts', 'run-windows-path-tests.mjs');
  const runner = fs.readFileSync(runnerPath, 'utf8');
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
  ];
  for (const suite of fullSuites) {
    assert.ok(runner.includes(`'${suite}'`), `shared runner must execute ${suite}`);
  }
  for (const fixture of [
    'test/checkout-line-endings.test.mjs',
    'test/clean-skill-staging.test.mjs',
    'test/workflow-migration.test.mjs',
    'test/cli.test.mjs',
    'test/preview.test.mjs',
    'test/update-notifier.test.mjs',
    'test/visual-check.test.mjs',
  ]) {
    assert.ok(runner.includes(`'${fixture}'`), `shared runner must execute ${fixture}`);
  }
  assert.match(runner, /canonical watch target/);
  assert.match(runner, /entry detection/);
  assert.match(runner, /workflow migration rejects a dangling destination symlink/);
  assert.match(runner, /workflow migration preserves a destination claimant created before final verification/);
  assert.match(runner, /workflow migration preserves an existing destination replaced during candidate mode finalization/);
  assert.match(runner, /Windows 8\.3 short path/);
  assert.match(runner, /preview: publishing through an existing output symlink/);
  assert.match(runner, /preview: a hardlinked existing output/);
  assert.match(runner, /'visual-check'/);
  assert.match(runner, /updater rejects a case-only alias/);
  assert.match(runner, /symlink cache root/);
  assert.match(runner, /symlink cache ancestor/);
  assert.match(runner, /authored symlink is rejected/);
  assert.match(runner, /trusted directory through a symlink/);
  assert.match(runner, /preview runs from an installed skill/);
  assert.match(runner, /watcher accepts/);
  assert.match(runner, /findChrome/);
  assert.match(runner, /doctor identifies an incomplete installation/);
  assert.match(runner, /ARCHIFY_REQUIRE_WINDOWS_REAL_PATHS/);
  assert.match(runner, /ARCHIFY_WINDOWS_CASE_SENSITIVE_ROOT/);
  assert.match(runner, /ARCHIFY_WINDOWS_UNC_ROOT/);
  assert.match(runner, /ARCHIFY_WINDOWS_EXTENDED_UNC_ROOT/);
  assert.match(runner, /ARCHIFY_WINDOWS_8DOT3_ROOT/);
  assert.match(runner, /ARCHIFY_WINDOWS_8DOT3_SHORT_ROOT/);
  assert.match(runner, /sameLocation\(uncRoot, extendedUncRoot\)\.status, 'match'/);
  assert.doesNotMatch(runner, /extendedUncRoot\.toLocaleLowerCase/);
  assert.doesNotMatch(runner, /controlled real-path fixture belongs to the canonical Node 22 lane/);
  assert.match(runner, /driveLetterCaseAlias/);
  assert.match(runner, /strict check through drive-letter case alias/);
  assert.match(runner, /fs\.symlinkSync\(junctionTarget, junctionAlias, 'junction'\)/);
  assert.match(runner, /fs\.symlinkSync\(fileTarget, fileSymlink, 'file'\)/);
  assert.match(runner, /fs\.linkSync\(fileTarget, hardlink\)/);
  assert.match(runner, /runCli\(\[\s*'visual-check'/);
  assert.match(runner, /--require-provenance/);
  assert.match(runner, /architecture compare to extended UNC/);
  assert.match(runner, /repository root through drive-letter case alias/);
  assert.match(runner, /stageCleanSkill\(\{ repoRoot: driveCaseRepoRoot/);
  assert.match(runner, /checkForUpdate\(\{/);
  assert.match(runner, /let ordinaryLongDirectory = uncRoot/);
  assert.match(runner, /ordinary UNC delivery beyond traditional MAX_PATH/);
  assert.match(runner, /ordinary UNC visual-check beyond traditional MAX_PATH/);
  assert.match(runner, /let extendedLongDirectory = extendedUncRoot/);
  assert.match(runner, /extended UNC delivery beyond traditional MAX_PATH/);
  assert.match(runner, /path\.win32\.join\(ordinaryLongDirectory, `\$\{token\}-preview[.]html`\)/);
  assert.match(
    runner,
    /assertNoPrivateStaging\(ordinaryLongDirectory, '[.]archify-delivery-', ordinaryLongDelivery\)/,
  );
  assert.match(runner, /fs[.]lstatSync\(path[.]toNamespacedPath\(path[.]join\(directory, entry\)\)\)/);
  assert.match(runner, /assertNoPrivateStaging\(evidenceDirectory, '[.]archify-visual-check-'\)/);
  assert.match(runner, /assertNoPrivateStaging\(ordinaryLongDirectory, '[.]archify-preview-'\)/);
  assert.match(runner, /case-sensitive upper artifact visual-check to shared UNC/);
  assert.match(runner, /case-sensitive lower artifact visual-check to shared UNC/);
  assert.match(runner, /case-variant artifacts must receive distinct evidence names/);
  assert.match(runner, /normalization-sensitive render \(NFC\)/);
  assert.match(runner, /normalization-sensitive render \(NFD\)/);
  assert.match(runner, /normalization-sensitive NFC artifact visual-check to shared UNC/);
  assert.match(runner, /normalization-sensitive NFD artifact visual-check to shared UNC/);
  assert.match(runner, /normalization-distinct artifacts must receive distinct evidence names/);
  assert.match(runner, /build-zip[.]sh/);

  const cliSource = fs.readFileSync(path.join(repoRoot, 'archify', 'bin', 'archify.mjs'), 'utf8');
  const previewSource = fs.readFileSync(path.join(repoRoot, 'archify', 'bin', 'preview.mjs'), 'utf8');
  const visualCheckSource = fs.readFileSync(
    path.join(repoRoot, 'archify', 'bin', 'visual-check.mjs'),
    'utf8',
  );
  assert.match(cliSource, /mkdtempSync\(path[.]toNamespacedPath\(prefix\)\)/);
  assert.match(previewSource, /mkdtempSync\(path[.]toNamespacedPath\(\s*path[.]join\(physicalOutputDirectory, '[.]archify-preview-'\),\s*\)\)/);
  assert.match(visualCheckSource, /mkdtempSync\(path[.]toNamespacedPath\(\s*path[.]join\(parent[.]parentPath, '[.]archify-visual-check-'\),\s*\)\)/);

  const previewSuite = fs.readFileSync(path.join(repoRoot, 'archify', 'test', 'preview.test.mjs'), 'utf8');
  assert.match(previewSuite, /process\.env\.ARCHIFY_REQUIRE_WINDOWS_8DOT3 === '1'/);
  assert.match(previewSuite, /process\.env\.ARCHIFY_WINDOWS_8DOT3_ROOT/);
  assert.match(previewSuite, /process\.env\.ARCHIFY_WINDOWS_8DOT3_SHORT_ROOT/);
  assert.match(previewSuite, /assignWindowsShortName\(realDirectory, shortName\)/);
  const deliverySuite = fs.readFileSync(
    path.join(repoRoot, 'archify', 'test', 'delivery-sidecar-path.test.mjs'),
    'utf8',
  );
  assert.match(deliverySuite, /process\.env\.ARCHIFY_WINDOWS_8DOT3_ROOT/);
  assert.match(deliverySuite, /process\.env\.ARCHIFY_WINDOWS_8DOT3_SHORT_ROOT/);
  assert.match(deliverySuite, /assignWindowsShortName\(output, 'ARCHDL~1[.]HTM'\)/);
  const visualSidecarSuite = fs.readFileSync(
    path.join(repoRoot, 'archify', 'test', 'sidecar-path-length.test.mjs'),
    'utf8',
  );
  assert.match(visualSidecarSuite, /assignWindowsShortName\(artifact, 'ARCHVS~1[.]HTM'\)/);

  const workflows = [
    ['CI', fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')],
    ['release', fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'release.yml'), 'utf8')],
  ];
  const fixtureScript = fs.readFileSync(
    path.join(repoRoot, 'scripts', 'windows-path-fixtures.ps1'),
    'utf8',
  );
  assert.match(fixtureScript, /node\$NodeVersion/);
  assert.match(fixtureScript, /fsutil[.]exe file setCaseSensitiveInfo/);
  assert.match(fixtureScript, /New-SmbShare[^\n]*-Temporary[^\n]*-ChangeAccess \$identity/);
  assert.match(fixtureScript, /\\\\localhost\\\$shareName/);
  assert.match(fixtureScript, /\\\\[?]\\UNC\\localhost\\\$shareName/);
  assert.match(fixtureScript, /ARCHIFY_WINDOWS_CASE_SENSITIVE_ROOT/);
  assert.match(fixtureScript, /ARCHIFY_WINDOWS_UNC_ROOT/);
  assert.match(fixtureScript, /ARCHIFY_WINDOWS_EXTENDED_UNC_ROOT/);
  assert.match(fixtureScript, /fsutil[.]exe file setshortname/);
  assert.doesNotMatch(fixtureScript, /fsutil[.]exe 8dot3name set/);
  assert.match(fixtureScript, /ARCHIFY_WINDOWS_8DOT3_ROOT/);
  assert.match(fixtureScript, /ARCHIFY_WINDOWS_8DOT3_SHORT_ROOT/);
  assert.match(fixtureScript, /Remove-SmbShare/);
  for (const [label, workflow] of workflows) {
    const job = workflowJob(workflow, 'windows-test-portability');
    assert.match(job, /runs-on:\s*windows-latest/);
    assert.match(job, /node-version:\s*\[22, 24\]/);
    assert.match(job, /node-version:\s*\$\{\{ matrix\.node-version \}\}/);
    assert.match(job, /npm ci --ignore-scripts/);
    assert.match(job, /node scripts\/run-windows-path-tests\.mjs/);
    assert.match(job, /name: Provision controlled Windows path fixtures\n\s+shell: pwsh/);
    assert.match(
      job,
      /scripts\/windows-path-fixtures[.]ps1 -NodeVersion '\$\{\{ matrix[.]node-version \}\}'/,
    );
    assert.match(
      job,
      /name: Clean up controlled Windows path fixtures\n\s+if: \$\{\{ always\(\) \}\}/,
    );
    assert.match(
      job,
      /scripts\/windows-path-fixtures[.]ps1 -NodeVersion '\$\{\{ matrix[.]node-version \}\}' -Cleanup/,
    );
    assert.match(
      job,
      /ARCHIFY_REQUIRE_WINDOWS_8DOT3:\s*'1'/,
      `${label} must require real 8.3 coverage on every maintained Node lane`,
    );
    assert.match(
      job,
      /ARCHIFY_REQUIRE_WINDOWS_REAL_PATHS:\s*'1'/,
      `${label} must require controlled UNC and case-sensitive NTFS coverage on every lane`,
    );
    for (const suite of fullSuites) {
      assert.equal(job.includes(suite), false, `${label} must get ${suite} from the shared runner`);
    }
  }

  const ci = workflows[0][1];
  const deploy = workflowJob(ci, 'deploy-pages');
  assert.match(deploy, /needs: \[[^\]]*windows-test-portability[^\]]*\]/);

  const releaseWorkflow = workflows[1][1];
  const release = workflowJob(releaseWorkflow, 'release');
  assert.match(release, /needs:\s*windows-test-portability/);
});
