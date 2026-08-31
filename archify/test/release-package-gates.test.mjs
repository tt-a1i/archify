import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  assert.match(job, /needs: \[test, webm-artifact, zip-freshness, published-update-manifest, package-smoke\]/);
  assert.match(job, /pages: write/);
  assert.match(job, /id-token: write/);
  assert.match(job, /repos\/\$\{GITHUB_REPOSITORY\}\/git\/ref\/heads\/main/);
  assert.match(job, /current_main" == "\$GITHUB_SHA"/);
  assert.match(job, /Skipping obsolete Pages deployment/);
  assert.match(job, /if: steps\.deployment-head\.outputs\.current == 'true'/);
  assert.match(job, /actions\/configure-pages@v5/);
  assert.match(job, /actions\/upload-pages-artifact@v4/);
  assert.match(job, /path: docs/);
  assert.match(job, /actions\/deploy-pages@v4/);
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

test('archive build refuses to silently omit required notifier files', () => {
  const buildSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'build-zip.sh'), 'utf8');
  const stageSource = fs.readFileSync(path.join(repoRoot, 'scripts', 'stage-clean-skill.mjs'), 'utf8');
  assert.match(buildSource, /stage-clean-skill\.mjs/);
  assert.match(stageSource, /archify\/skill-release\.json/);
  assert.match(stageSource, /archify\/scripts\/check-update\.mjs/);
  assert.match(stageSource, /archify\/scripts\/update-contract\.mjs/);
  assert.match(stageSource, /git', \['ls-files', '--stage', '-z'/);
  assert.match(stageSource, /required package input is not tracked by Git/);
});

canonicalZipTest('package smoke rejects every dependency metadata field in a built package', () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-built-package-gate-'));
  try {
    const archive = path.join(fixture, 'archify.zip');
    const build = spawnSync(path.join(repoRoot, 'scripts', 'build-zip.sh'), [archive], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
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
    const build = spawnSync(path.join(repoRoot, 'scripts', 'build-zip.sh'), [archive], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    assert.equal(build.status, 0, `${build.stdout}\n${build.stderr}`);

    const listing = spawnSync('unzip', ['-Z1', archive], { encoding: 'utf8' });
    assert.equal(listing.status, 0, `${listing.stdout}\n${listing.stderr}`);
    const entries = new Set(listing.stdout.trim().split('\n'));
    assert.ok(entries.has('archify/skill-release.json'));
    assert.ok(entries.has('archify/scripts/check-update.mjs'));
    assert.ok(entries.has('archify/scripts/update-contract.mjs'));
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

    const build = spawnSync(path.join(repoRoot, 'scripts', 'build-zip.sh'), [archive], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
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
    const build = spawnSync(path.join(repoRoot, 'scripts', 'build-zip.sh'), [archive], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
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
      const build = spawnSync(path.join(repoRoot, 'scripts', 'build-zip.sh'), [archive], {
        cwd: repoRoot,
        encoding: 'utf8',
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
