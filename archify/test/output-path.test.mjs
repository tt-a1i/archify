import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { startPreview } from '../bin/preview.mjs';
import { loadDiagram, writeDiagram } from '../renderers/shared/cli.mjs';
import { pathsAlias } from '../renderers/shared/output-path.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const cli = path.join(skillRoot, 'bin/archify.mjs');
const workflowFixture = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
const baseFixture = path.join(skillRoot, 'examples/checkout-platform.base.architecture.json');
const headFixture = path.join(skillRoot, 'examples/checkout-platform.head.architecture.json');

function run(args, cwd) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

function copyInstalledSkill(target) {
  fs.cpSync(skillRoot, target, {
    recursive: true,
    filter(source) {
      const relative = path.relative(skillRoot, source);
      return relative !== 'node_modules'
        && !relative.startsWith(`node_modules${path.sep}`)
        && relative !== 'test'
        && !relative.startsWith(`test${path.sep}`);
    },
  });
}

function directoryAliasesNames(directory, authoredName, lookupName) {
  const authoredPath = path.join(directory, authoredName);
  const lookupPath = path.join(directory, lookupName);
  fs.writeFileSync(authoredPath, 'filesystem semantics probe', { flag: 'wx' });
  try {
    let authored;
    let lookup;
    try {
      authored = fs.statSync(authoredPath);
      lookup = fs.statSync(lookupPath);
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
    return authored.dev === lookup.dev && authored.ino === lookup.ino;
  } finally {
    fs.unlinkSync(authoredPath);
  }
}

test('future-path aliases follow the containing directory case and Unicode semantics', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-semantics-'));
  const caseInsensitive = directoryAliasesNames(cwd, 'ArchifyCaseProbe', 'archifycaseprobe');
  const normalizationInsensitive = directoryAliasesNames(
    cwd,
    'archify-norm-\u00e9-probe',
    'archify-norm-e\u0301-probe',
  );

  assert.equal(
    pathsAlias(path.join(cwd, 'Future.HTML'), path.join(cwd, 'future.html')),
    caseInsensitive,
  );
  assert.equal(
    pathsAlias(path.join(cwd, 'Caf\u00e9.html'), path.join(cwd, 'Cafe\u0301.html')),
    normalizationInsensitive,
  );
});

test('compare rejects case-only future targets before input work when the directory aliases case', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-compare-case-'));
  const caseInsensitive = directoryAliasesNames(cwd, 'ArchifyCaseProbe', 'archifycaseprobe');
  const output = path.join(cwd, 'Future.HTML');
  const receiptPath = path.join(cwd, 'future.html');

  const result = run([
    'compare', 'architecture',
    path.join(cwd, 'missing-base.json'),
    path.join(cwd, 'missing-head.json'),
    output,
    '--receipt', receiptPath,
    '--json',
  ], cwd);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(
    receipt.diagnostics[0].code,
    caseInsensitive ? 'output/target-alias' : 'output/cli-extension',
  );
  assert.equal(receipt.stage, 'prepare');
});

test('render reports an output symlink cycle as a structured output diagnostic', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-cycle-'));
  const input = path.join(cwd, 'diagram.workflow.json');
  const output = path.join(cwd, 'cycle-a.html');
  const otherLink = path.join(cwd, 'cycle-b.html');
  fs.copyFileSync(workflowFixture, input);
  fs.symlinkSync(otherLink, output, 'file');
  fs.symlinkSync(output, otherLink, 'file');

  const result = spawnSync(
    process.execPath,
    [path.join(skillRoot, 'renderers/workflow/render-workflow.mjs'), input, output],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json' },
    },
  );

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stderr);
  assert.equal(failure.diagnostics[0].code, 'output/symlink-cycle');
  assert.equal(failure.diagnostics[0].subject.output, output);
  assert.ok(failure.diagnostics[0].supportedFixes.length > 0);
});

test('render rejects an output symlink that aliases its JSON input', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-render-'));
  const input = path.join(cwd, 'diagram.workflow.json');
  const output = path.join(cwd, 'diagram.html');
  const source = fs.readFileSync(workflowFixture);
  fs.writeFileSync(input, source);
  fs.symlinkSync(input, output, 'file');

  const result = run(['render', 'workflow', input, output], cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /output must not replace an input/i);
  assert.deepEqual(fs.readFileSync(input), source);
});

test('render rejects an existing output hard link to its JSON input', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-render-hardlink-'));
  const input = path.join(cwd, 'diagram.workflow.json');
  const output = path.join(cwd, 'diagram.html');
  const source = fs.readFileSync(workflowFixture);
  fs.writeFileSync(input, source);
  fs.linkSync(input, output);

  const result = run(['render', 'workflow', input, output], cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /output must not replace an input/i);
  assert.deepEqual(fs.readFileSync(input), source);
});

test('render rejects an absolute meta.output when no CLI output is provided', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-meta-absolute-'));
  const input = path.join(cwd, 'diagram.workflow.json');
  const output = path.join(cwd, 'authored.html');
  const source = JSON.parse(fs.readFileSync(workflowFixture, 'utf8'));
  source.meta.output = output;
  fs.writeFileSync(input, JSON.stringify(source));

  const result = run(['render', 'workflow', input], cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /meta\.output must be a relative path/i);
  assert.equal(fs.existsSync(output), false);
});

test('render rejects a parent segment in portable meta.output before filesystem containment', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-meta-parent-'));
  const cwd = path.join(parent, 'work');
  fs.mkdirSync(cwd);
  const input = path.join(cwd, 'diagram.workflow.json');
  const output = path.join(parent, 'escaped.html');
  const source = JSON.parse(fs.readFileSync(workflowFixture, 'utf8'));
  source.meta.output = '../escaped.html';
  fs.writeFileSync(input, JSON.stringify(source));

  const result = run(['render', 'workflow', input], cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /output\/meta-path-syntax/);
  assert.match(result.stderr, /portable POSIX-relative path/i);
  assert.equal(fs.existsSync(output), false);
});

test('render rejects a meta.output that escapes through a directory symlink', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-meta-link-'));
  const cwd = path.join(parent, 'work');
  const outside = path.join(parent, 'outside');
  fs.mkdirSync(cwd);
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(cwd, 'linked'), 'dir');
  const input = path.join(cwd, 'diagram.workflow.json');
  const output = path.join(outside, 'authored.html');
  const source = JSON.parse(fs.readFileSync(workflowFixture, 'utf8'));
  source.meta.output = 'linked/authored.html';
  fs.writeFileSync(input, JSON.stringify(source));

  const result = run(['render', 'workflow', input], cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /meta\.output must stay inside the current working directory/i);
  assert.equal(fs.existsSync(output), false);
});

test('render requires a meta.output target with an html extension', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-meta-extension-'));
  const input = path.join(cwd, 'diagram.workflow.json');
  const output = path.join(cwd, 'authored.json');
  const source = JSON.parse(fs.readFileSync(workflowFixture, 'utf8'));
  source.meta.output = 'authored.json';
  fs.writeFileSync(input, JSON.stringify(source));

  const result = run(['render', 'workflow', input], cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /meta\.output must target an? \.html file/i);
  assert.equal(fs.existsSync(output), false);
});

test('render rejects a meta.output symlink that resolves to a non-html target', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-meta-extension-link-'));
  const input = path.join(cwd, 'diagram.workflow.json');
  const target = path.join(cwd, 'authored.json');
  const output = path.join(cwd, 'authored.html');
  const source = JSON.parse(fs.readFileSync(workflowFixture, 'utf8'));
  source.meta.output = 'authored.html';
  fs.writeFileSync(input, JSON.stringify(source));
  fs.writeFileSync(target, 'trusted target');
  fs.symlinkSync(target, output, 'file');

  const result = run(['render', 'workflow', input], cwd);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /meta\.output must resolve to an? \.html file/i);
  assert.equal(fs.readFileSync(target, 'utf8'), 'trusted target');
});

test('deliver rejects a future-path alias of its JSON input with a structured diagnostic', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-deliver-'));
  const realDirectory = path.join(cwd, 'real');
  const linkedDirectory = path.join(cwd, 'linked');
  fs.mkdirSync(realDirectory);
  fs.symlinkSync(realDirectory, linkedDirectory, 'dir');
  const input = path.join(realDirectory, 'diagram.workflow.json');
  const output = path.join(linkedDirectory, 'diagram.workflow.json');
  const source = fs.readFileSync(workflowFixture);
  fs.writeFileSync(input, source);

  const result = run(['deliver', 'workflow', input, output, '--json'], cwd);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.stage, 'prepare');
  assert.equal(receipt.diagnostics[0].code, 'output/input-alias');
  assert.deepEqual(fs.readFileSync(input), source);
});

test('deliver rechecks aliases immediately before committing a verified candidate', { timeout: 10000 }, async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-deliver-race-'));
  const installedRoot = path.join(cwd, 'skill');
  const installedBin = path.join(installedRoot, 'bin');
  const installedShared = path.join(installedRoot, 'renderers/shared');
  const installedRenderer = path.join(installedRoot, 'renderers/workflow');
  const installedScripts = path.join(installedRoot, 'scripts');
  fs.mkdirSync(installedBin, { recursive: true });
  fs.mkdirSync(installedShared, { recursive: true });
  fs.mkdirSync(installedRenderer, { recursive: true });
  fs.mkdirSync(installedScripts, { recursive: true });
  fs.copyFileSync(cli, path.join(installedBin, 'archify.mjs'));
  for (const module of [
    'output-path.mjs',
    'utils.mjs',
    'i18n.mjs',
    'path-semantics.mjs',
    'portable-path.mjs',
    'atomic-output.mjs',
    'sidecar-path.mjs',
  ]) {
    fs.copyFileSync(
      path.join(skillRoot, 'renderers/shared', module),
      path.join(installedShared, module),
    );
  }
  fs.writeFileSync(path.join(installedRenderer, 'render-workflow.mjs'), `
import fs from 'node:fs';
const [, output] = process.argv.slice(2);
fs.writeFileSync(process.env.ARCHIFY_TEST_RENDER_STARTED, output);
const release = process.env.ARCHIFY_TEST_RENDER_RELEASE;
const deadline = Date.now() + 5000;
while (!fs.existsSync(release) && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 20));
}
if (!fs.existsSync(release)) throw new Error('timed out waiting for output-path race release');
fs.writeFileSync(output, '<!doctype html><title>verified candidate</title><svg></svg>');
`);
  fs.writeFileSync(path.join(installedScripts, 'check-render-output.mjs'), `
console.log(JSON.stringify({
  ok: true,
  checks: [{ name: 'single_svg', ok: true }],
  composition: {
    profile: 'showcase',
    status: 'pass',
    summary: { errors: 0, warnings: 0 }
  }
}));
`);

  const inputDirectory = path.join(cwd, 'input');
  const initialOutputDirectory = path.join(cwd, 'safe-output');
  const linkedDirectory = path.join(cwd, 'linked-output');
  fs.mkdirSync(inputDirectory);
  fs.mkdirSync(initialOutputDirectory);
  fs.symlinkSync(initialOutputDirectory, linkedDirectory, 'dir');
  const input = path.join(inputDirectory, 'diagram.html');
  const output = path.join(linkedDirectory, 'diagram.html');
  const source = Buffer.from('{"meta":{"title":"race input","output":"diagram.html"}}');
  fs.writeFileSync(input, source);
  const marker = path.join(cwd, 'renderer-started');
  const release = path.join(cwd, 'renderer-release');

  const child = spawn(process.execPath, [
    path.join(installedBin, 'archify.mjs'),
    'deliver', 'workflow', input, output, '--json',
  ], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ARCHIFY_TEST_RENDER_STARTED: marker,
      ARCHIFY_TEST_RENDER_RELEASE: release,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const close = new Promise((resolve) => child.once('close', resolve));
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const started = Date.now();
  while (!fs.existsSync(marker) && Date.now() - started < 3000) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.existsSync(marker), true, `renderer did not start; stderr=${stderr}`);
  // Staging stays in the physical output directory when this alias is retargeted.
  fs.unlinkSync(linkedDirectory);
  fs.symlinkSync(inputDirectory, linkedDirectory, 'dir');
  assert.equal(fs.realpathSync(linkedDirectory), fs.realpathSync(inputDirectory));
  fs.writeFileSync(release, 'release');

  const status = await close;

  assert.equal(status, 1, stderr);
  const receipt = JSON.parse(stdout);
  assert.equal(receipt.stage, 'commit');
  assert.equal(receipt.diagnostics[0].code, 'delivery/ownership-lost');
  assert.equal(receipt.diagnostics[1].code, 'output/input-alias');
  assert.deepEqual(fs.readFileSync(input), source);
});

test('compare rejects an artifact path that aliases either architecture input', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-compare-'));
  const realDirectory = path.join(cwd, 'real');
  const linkedDirectory = path.join(cwd, 'linked');
  fs.mkdirSync(realDirectory);
  fs.symlinkSync(realDirectory, linkedDirectory, 'dir');
  const base = path.join(realDirectory, 'review.html');
  const output = path.join(linkedDirectory, 'review.html');
  const baseSource = fs.readFileSync(baseFixture);
  fs.writeFileSync(base, baseSource);

  const result = run(['compare', 'architecture', base, headFixture, output, '--json'], cwd);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.stage, 'prepare');
  assert.equal(receipt.diagnostics[0].code, 'output/input-alias');
  assert.deepEqual(fs.readFileSync(base), baseSource);
});

test('compare rejects a receipt path that aliases either architecture input', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-compare-receipt-'));
  const base = path.join(cwd, 'base.json');
  const output = path.join(cwd, 'delta.html');
  const baseSource = fs.readFileSync(baseFixture);
  fs.writeFileSync(base, baseSource);

  const result = run([
    'compare', 'architecture', base, headFixture, output,
    '--receipt', base, '--json',
  ], cwd);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.stage, 'prepare');
  assert.equal(receipt.diagnostics[0].code, 'output/input-alias');
  assert.deepEqual(fs.readFileSync(base), baseSource);
  assert.equal(fs.existsSync(output), false);
});

test('compare rejects a dangling receipt symlink to the future artifact path', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-compare-pair-'));
  const output = path.join(cwd, 'delta.html');
  const receiptPath = path.join(cwd, 'delta.receipt.json');
  fs.symlinkSync(output, receiptPath, 'file');

  const result = run([
    'compare', 'architecture', baseFixture, headFixture, output,
    '--receipt', receiptPath, '--json',
  ], cwd);

  assert.equal(result.status, 1);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.stage, 'prepare');
  assert.equal(receipt.diagnostics[0].code, 'output/target-alias');
  assert.equal(fs.lstatSync(receiptPath).isSymbolicLink(), true);
  assert.equal(fs.existsSync(output), false);
});

test('compare preserves dangling output symlinks and commits to their physical targets', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-compare-links-'));
  const output = path.join(cwd, 'delta.html');
  const receiptPath = path.join(cwd, 'delta.receipt.json');
  const outputTarget = path.join(cwd, 'rendered.html');
  const receiptTarget = path.join(cwd, 'rendered.receipt.json');
  fs.symlinkSync(path.basename(outputTarget), output, 'file');
  fs.symlinkSync(path.basename(receiptTarget), receiptPath, 'file');

  const result = run([
    'compare', 'architecture', baseFixture, headFixture, output,
    '--receipt', receiptPath, '--json',
  ], cwd);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(fs.lstatSync(output).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(receiptPath).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(output), path.basename(outputTarget));
  assert.equal(fs.readlinkSync(receiptPath), path.basename(receiptTarget));
  assert.match(fs.readFileSync(outputTarget, 'utf8'), /<!doctype html>/i);
  assert.deepEqual(JSON.parse(fs.readFileSync(receiptTarget, 'utf8')), receipt);
});

for (const slot of ['artifact', 'receipt']) {
  for (const initialState of ['absent', 'existing']) {
    test(`compare does not overwrite an ${initialState} ${slot} slot changed after staging`, () => {
      const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `archify-output-compare-${slot}-${initialState}-`));
      const output = path.join(cwd, 'delta.html');
      const receiptPath = path.join(cwd, 'delta.receipt.json');
      const changedPath = slot === 'artifact' ? output : receiptPath;
      const stablePath = slot === 'artifact' ? receiptPath : output;
      const changedBytes = slot === 'artifact'
        ? '<!doctype html><title>concurrent artifact owner</title>\n'
        : '{"owner":"concurrent receipt owner"}\n';
      const stableBytes = slot === 'artifact'
        ? '{"owner":"trusted receipt owner"}\n'
        : '<!doctype html><title>trusted artifact owner</title>\n';
      const detachedPath = path.join(cwd, `detached-${path.basename(changedPath)}`);
      fs.writeFileSync(stablePath, stableBytes);
      if (initialState === 'existing') fs.writeFileSync(changedPath, 'original target bytes\n');

      const preload = path.join(cwd, 'change-compare-slot.cjs');
      const replaceExisting = initialState === 'existing'
        ? `fs.renameSync(changedPath, ${JSON.stringify(detachedPath)});`
        : '';
      fs.writeFileSync(preload, `
        const fs = require('node:fs');
        const path = require('node:path');
        const originalWrite = fs.writeFileSync;
        const changedPath = ${JSON.stringify(changedPath)};
        let changed = false;
        fs.writeFileSync = function(file, ...args) {
          const result = originalWrite.call(this, file, ...args);
          if (!changed
            && path.basename(String(file)) === ${JSON.stringify(path.basename(receiptPath))}
            && path.basename(path.dirname(String(file))).startsWith('.archify-compare-')) {
            changed = true;
            ${replaceExisting}
            originalWrite.call(fs, changedPath, ${JSON.stringify(changedBytes)});
          }
          return result;
        };
      `);

      const result = spawnSync(process.execPath, [
        '--require', preload, cli, 'compare', 'architecture',
        baseFixture, headFixture, output, '--receipt', receiptPath, '--json',
      ], { cwd, encoding: 'utf8', timeout: 30000 });

      assert.ifError(result.error);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      const failure = JSON.parse(result.stdout);
      assert.equal(failure.stage, 'commit');
      assert.equal(failure.diagnostics[0].code, 'output/target-changed');
      assert.equal(fs.readFileSync(changedPath, 'utf8'), changedBytes);
      assert.equal(fs.readFileSync(stablePath, 'utf8'), stableBytes);
      assert.equal(fs.readdirSync(cwd).some((name) => name.startsWith('.archify-compare-')), false);
    });
  }
}

for (const slot of ['artifact', 'receipt']) {
  test(`compare preserves a concurrent ${slot} replacement made after final verification`, () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `archify-output-compare-backup-race-${slot}-`));
    const output = path.join(cwd, 'delta.html');
    const receiptPath = path.join(cwd, 'delta.receipt.json');
    const changedPath = slot === 'artifact' ? output : receiptPath;
    const physicalChangedPath = path.join(fs.realpathSync.native(cwd), path.basename(changedPath));
    const stablePath = slot === 'artifact' ? receiptPath : output;
    const changedBytes = slot === 'artifact'
      ? '<!doctype html><title>replacement artifact owner</title>\n'
      : '{"owner":"replacement receipt owner"}\n';
    const stableBytes = slot === 'artifact'
      ? '{"owner":"trusted receipt owner"}\n'
      : '<!doctype html><title>trusted artifact owner</title>\n';
    const detachedPath = path.join(cwd, `detached-${path.basename(changedPath)}`);
    fs.writeFileSync(changedPath, 'original target bytes\n');
    fs.writeFileSync(stablePath, stableBytes);

    const preload = path.join(cwd, 'replace-before-backup.cjs');
    fs.writeFileSync(preload, `
      const fs = require('node:fs');
      const path = require('node:path');
      const originalRename = fs.renameSync.bind(fs);
      const originalWrite = fs.writeFileSync.bind(fs);
      const changedPath = ${JSON.stringify(physicalChangedPath)};
      let changed = false;
      fs.renameSync = function(source, target, ...args) {
        if (!changed
          && String(source) === changedPath
          && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
          changed = true;
          originalRename(changedPath, ${JSON.stringify(detachedPath)});
          originalWrite(changedPath, ${JSON.stringify(changedBytes)});
        }
        return originalRename(source, target, ...args);
      };
    `);

    const result = spawnSync(process.execPath, [
      '--require', preload, cli, 'compare', 'architecture',
      baseFixture, headFixture, output, '--receipt', receiptPath, '--json',
    ], { cwd, encoding: 'utf8', timeout: 30000 });

    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.stage, 'commit');
    assert.equal(failure.diagnostics[0].code, 'delta/commit-rollback-failed');
    const recovery = failure.diagnostics[0].evidence;
    const retained = recovery.recoveryFiles.find(({ target }) => target === physicalChangedPath);
    assert.ok(retained, JSON.stringify(recovery.recoveryFiles));
    assert.equal(fs.readFileSync(retained.backup, 'utf8'), 'original target bytes\n');
    assert.equal(fs.readFileSync(changedPath, 'utf8'), changedBytes);
    assert.equal(fs.readFileSync(stablePath, 'utf8'), stableBytes);
    assert.equal(path.dirname(retained.backup), recovery.recoveryDirectory);
  });
}

for (const slot of ['artifact', 'receipt']) {
  test(`compare preserves an absent ${slot} slot claimant made during publish`, () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `archify-output-compare-publish-race-${slot}-`));
    const output = path.join(cwd, 'delta.html');
    const receiptPath = path.join(cwd, 'delta.receipt.json');
    const changedPath = slot === 'artifact' ? output : receiptPath;
    const physicalChangedPath = path.join(fs.realpathSync.native(cwd), path.basename(changedPath));
    const stablePath = slot === 'artifact' ? receiptPath : output;
    const changedBytes = slot === 'artifact'
      ? '<!doctype html><title>claimant artifact owner</title>\n'
      : '{"owner":"claimant receipt owner"}\n';
    const stableBytes = slot === 'artifact'
      ? '{"owner":"trusted receipt owner"}\n'
      : '<!doctype html><title>trusted artifact owner</title>\n';
    fs.writeFileSync(stablePath, stableBytes);

    const preload = path.join(cwd, 'claim-before-publish.cjs');
    fs.writeFileSync(preload, `
      const fs = require('node:fs');
      const path = require('node:path');
      const originalLink = fs.linkSync.bind(fs);
      const originalWrite = fs.writeFileSync.bind(fs);
      const changedPath = ${JSON.stringify(physicalChangedPath)};
      let changed = false;
      fs.linkSync = function(source, target, ...args) {
        if (!changed
          && String(target) === changedPath
          && path.basename(path.dirname(String(source))).startsWith('.archify-compare-')) {
          changed = true;
          originalWrite(changedPath, ${JSON.stringify(changedBytes)});
        }
        return originalLink(source, target, ...args);
      };
    `);

    const result = spawnSync(process.execPath, [
      '--require', preload, cli, 'compare', 'architecture',
      baseFixture, headFixture, output, '--receipt', receiptPath, '--json',
    ], { cwd, encoding: 'utf8', timeout: 30000 });

    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.stage, 'commit');
    assert.equal(failure.diagnostics[0].code, 'output/target-changed');
    assert.equal(
      failure.diagnostics[0].evidence.atomicOutput.code,
      'target-claimed-during-publish',
    );
    assert.equal(fs.readFileSync(changedPath, 'utf8'), changedBytes);
    assert.equal(fs.readFileSync(stablePath, 'utf8'), stableBytes);
    assert.equal(fs.readdirSync(cwd).some((name) => name.startsWith('.archify-compare-')), false);
  });
}

for (const slot of ['artifact', 'receipt']) {
  test(`compare rejects and preserves a same-inode ${slot} candidate byte mutation before publish`, () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `archify-output-compare-candidate-bytes-${slot}-`));
    const output = path.join(cwd, 'delta.html');
    const receiptPath = path.join(cwd, 'delta.receipt.json');
    const physicalOutput = path.join(fs.realpathSync.native(cwd), path.basename(output));
    const outputBytes = '<!doctype html><title>trusted artifact owner</title>\n';
    const receiptBytes = '{"owner":"trusted receipt owner"}\n';
    const candidateName = slot === 'artifact' ? path.basename(output) : path.basename(receiptPath);
    fs.writeFileSync(output, outputBytes);
    fs.writeFileSync(receiptPath, receiptBytes);

    const preload = path.join(cwd, 'mutate-compare-candidate-bytes.cjs');
    fs.writeFileSync(preload, `
      const fs = require('node:fs');
      const path = require('node:path');
      const originalLink = fs.linkSync.bind(fs);
      const originalAppend = fs.appendFileSync.bind(fs);
      const physicalOutput = ${JSON.stringify(physicalOutput)};
      const candidateName = ${JSON.stringify(candidateName)};
      let mutated = false;
      fs.linkSync = function(source, target, ...args) {
        const result = originalLink(source, target, ...args);
        if (!mutated
          && String(source) === physicalOutput
          && path.basename(String(target)) === '.previous-output'
          && path.basename(path.dirname(String(target))).startsWith('.archify-compare-')) {
          mutated = true;
          originalAppend(path.join(path.dirname(String(target)), candidateName), '\\nexternally mutated candidate bytes\\n');
        }
        return result;
      };
    `);

    const result = spawnSync(process.execPath, [
      '--require', preload, cli, 'compare', 'architecture',
      baseFixture, headFixture, output, '--receipt', receiptPath, '--json',
    ], { cwd, encoding: 'utf8', timeout: 30000 });

    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.stage, 'commit');
    assert.equal(failure.diagnostics[0].code, 'output/target-changed');
    assert.equal(
      failure.diagnostics[0].evidence.atomicOutput.code,
      'compare-candidate-content-changed',
    );
    assert.equal(fs.readFileSync(output, 'utf8'), outputBytes);
    assert.equal(fs.readFileSync(receiptPath, 'utf8'), receiptBytes);
    const recoveryDirectories = fs.readdirSync(cwd)
      .filter((name) => name.startsWith('.archify-compare-'));
    assert.equal(recoveryDirectories.length, 1);
    const preservedCandidate = path.join(cwd, recoveryDirectories[0], candidateName);
    assert.match(fs.readFileSync(preservedCandidate, 'utf8'), /externally mutated candidate bytes/);
  });
}

test('compare preserves a same-inode edit to the first published member when the second publish fails', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-compare-published-edit-'));
  const output = path.join(cwd, 'delta.html');
  const receiptPath = path.join(cwd, 'delta.receipt.json');
  const physicalDirectory = fs.realpathSync.native(cwd);
  const physicalOutput = path.join(physicalDirectory, path.basename(output));
  const physicalReceipt = path.join(physicalDirectory, path.basename(receiptPath));
  const outputBytes = '<!doctype html><title>trusted artifact owner</title>\n';
  const receiptBytes = '{"owner":"trusted receipt owner"}\n';
  const claimantSuffix = '\nexternally edited published artifact\n';
  fs.writeFileSync(output, outputBytes);
  fs.writeFileSync(receiptPath, receiptBytes);

  const preload = path.join(cwd, 'edit-first-published-member.cjs');
  fs.writeFileSync(preload, `
    const fs = require('node:fs');
    const path = require('node:path');
    const originalLink = fs.linkSync.bind(fs);
    const originalAppend = fs.appendFileSync.bind(fs);
    const physicalOutput = ${JSON.stringify(physicalOutput)};
    const physicalReceipt = ${JSON.stringify(physicalReceipt)};
    let artifactPublished = false;
    fs.linkSync = function(source, target, ...args) {
      const inCompareStaging = path.basename(path.dirname(String(source))).startsWith('.archify-compare-');
      if (inCompareStaging && String(target) === physicalOutput) {
        const result = originalLink(source, target, ...args);
        artifactPublished = true;
        return result;
      }
      if (artifactPublished
        && inCompareStaging
        && path.basename(String(source)) === ${JSON.stringify(path.basename(receiptPath))}
        && String(target) === physicalReceipt) {
        originalAppend(physicalOutput, ${JSON.stringify(claimantSuffix)});
        const error = new Error('injected second member publish failure');
        error.code = 'EACCES';
        throw error;
      }
      return originalLink(source, target, ...args);
    };
  `);

  const result = spawnSync(process.execPath, [
    '--require', preload, cli, 'compare', 'architecture',
    baseFixture, headFixture, output, '--receipt', receiptPath, '--json',
  ], { cwd, encoding: 'utf8', timeout: 30000 });

  assert.ifError(result.error);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  const failure = JSON.parse(result.stdout);
  const recovery = failure.diagnostics[0].evidence;
  assert.equal(failure.stage, 'commit');
  assert.equal(failure.diagnostics[0].code, 'delta/commit-rollback-failed');
  assert.match(recovery.reason, /injected second member publish failure/);
  assert.ok(recovery.rollbackErrors.some((entry) => /HTML artifact/u.test(entry)));
  assert.equal(typeof recovery.recoveryDirectory, 'string');
  const artifactRecovery = recovery.recoveryFiles.find(({ target }) => target === physicalOutput);
  assert.ok(artifactRecovery, JSON.stringify(recovery.recoveryFiles));
  assert.equal(artifactRecovery.backup, path.join(recovery.recoveryDirectory, '.previous-output'));
  assert.equal(fs.readFileSync(artifactRecovery.backup, 'utf8'), outputBytes);
  assert.equal(fs.readFileSync(output, 'utf8').endsWith(claimantSuffix), true);
  assert.equal(fs.readFileSync(receiptPath, 'utf8'), receiptBytes);
  assert.equal(fs.existsSync(path.join(recovery.recoveryDirectory, '.previous-receipt')), false);
});

for (const slot of ['artifact', 'receipt']) {
  test(`compare rejects and preserves a same-inode ${slot} candidate mode mutation before publish`, { skip: process.platform === 'win32' }, () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `archify-output-compare-candidate-mode-${slot}-`));
    const output = path.join(cwd, 'delta.html');
    const receiptPath = path.join(cwd, 'delta.receipt.json');
    const physicalOutput = path.join(fs.realpathSync.native(cwd), path.basename(output));
    const outputBytes = '<!doctype html><title>trusted artifact owner</title>\n';
    const receiptBytes = '{"owner":"trusted receipt owner"}\n';
    const candidateName = slot === 'artifact' ? path.basename(output) : path.basename(receiptPath);
    fs.writeFileSync(output, outputBytes);
    fs.writeFileSync(receiptPath, receiptBytes);
    fs.chmodSync(output, 0o640);
    fs.chmodSync(receiptPath, 0o640);

    const preload = path.join(cwd, 'mutate-compare-candidate-mode.cjs');
    fs.writeFileSync(preload, `
      const fs = require('node:fs');
      const path = require('node:path');
      const originalLink = fs.linkSync.bind(fs);
      const originalChmod = fs.chmodSync.bind(fs);
      const physicalOutput = ${JSON.stringify(physicalOutput)};
      const candidateName = ${JSON.stringify(candidateName)};
      let mutated = false;
      fs.linkSync = function(source, target, ...args) {
        const result = originalLink(source, target, ...args);
        if (!mutated
          && String(source) === physicalOutput
          && path.basename(String(target)) === '.previous-output'
          && path.basename(path.dirname(String(target))).startsWith('.archify-compare-')) {
          mutated = true;
          originalChmod(path.join(path.dirname(String(target)), candidateName), 0o600);
        }
        return result;
      };
    `);

    const result = spawnSync(process.execPath, [
      '--require', preload, cli, 'compare', 'architecture',
      baseFixture, headFixture, output, '--receipt', receiptPath, '--json',
    ], { cwd, encoding: 'utf8', timeout: 30000 });

    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.stage, 'commit');
    assert.equal(failure.diagnostics[0].code, 'output/target-changed');
    assert.equal(
      failure.diagnostics[0].evidence.atomicOutput.code,
      'compare-candidate-mode-changed',
    );
    assert.equal(fs.readFileSync(output, 'utf8'), outputBytes);
    assert.equal(fs.readFileSync(receiptPath, 'utf8'), receiptBytes);
    assert.equal(fs.statSync(output).mode & 0o777, 0o640);
    assert.equal(fs.statSync(receiptPath).mode & 0o777, 0o640);
    const recoveryDirectories = fs.readdirSync(cwd)
      .filter((name) => name.startsWith('.archify-compare-'));
    assert.equal(recoveryDirectories.length, 1);
    const preservedCandidate = path.join(cwd, recoveryDirectories[0], candidateName);
    assert.equal(fs.statSync(preservedCandidate).mode & 0o777, 0o600);
  });
}

for (const slot of ['artifact', 'receipt']) {
  test(`compare rolls back both targets when the staged ${slot} link cannot be released`, () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `archify-output-compare-unlink-${slot}-`));
    const output = path.join(cwd, 'delta.html');
    const receiptPath = path.join(cwd, 'delta.receipt.json');
    const outputBytes = '<!doctype html><title>trusted artifact owner</title>\n';
    const receiptBytes = '{"owner":"trusted receipt owner"}\n';
    fs.writeFileSync(output, outputBytes);
    fs.writeFileSync(receiptPath, receiptBytes);

    const preload = path.join(cwd, 'reject-candidate-unlink.cjs');
    const candidateName = slot === 'artifact' ? path.basename(output) : path.basename(receiptPath);
    fs.writeFileSync(preload, `
      const fs = require('node:fs');
      const path = require('node:path');
      const originalUnlink = fs.unlinkSync.bind(fs);
      let rejected = false;
      fs.unlinkSync = function(file, ...args) {
        if (!rejected
          && path.basename(String(file)) === ${JSON.stringify(candidateName)}
          && path.basename(path.dirname(String(file))).startsWith('.archify-remove-')
          && path.basename(path.dirname(path.dirname(String(file)))).startsWith('.archify-compare-')) {
          rejected = true;
          const error = new Error('injected candidate unlink failure');
          error.code = 'EACCES';
          throw error;
        }
        return originalUnlink(file, ...args);
      };
    `);

    const result = spawnSync(process.execPath, [
      '--require', preload, cli, 'compare', 'architecture',
      baseFixture, headFixture, output, '--receipt', receiptPath, '--json',
    ], { cwd, encoding: 'utf8', timeout: 30000 });

    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.stage, 'commit');
    assert.equal(failure.diagnostics[0].code, 'output/target-indeterminate');
    assert.match(
      failure.diagnostics[0].evidence.reason,
      /target identity could not be verified safely/,
    );
    assert.equal(fs.readFileSync(output, 'utf8'), outputBytes);
    assert.equal(fs.readFileSync(receiptPath, 'utf8'), receiptBytes);
    const [recoveryDirectory] = fs.readdirSync(cwd)
      .filter((name) => name.startsWith('.archify-compare-'));
    assert.ok(recoveryDirectory);
    const recoveryRoot = path.join(cwd, recoveryDirectory);
    const [quarantineDirectory] = fs.readdirSync(recoveryRoot)
      .filter((name) => name.startsWith('.archify-remove-'));
    assert.ok(quarantineDirectory);
    assert.equal(
      fs.statSync(path.join(recoveryRoot, quarantineDirectory, candidateName)).isFile(),
      true,
    );
  });
}

test('compare preserves the modes of both existing pair targets', { skip: process.platform === 'win32' }, () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-compare-modes-'));
  const output = path.join(cwd, 'delta.html');
  const receiptPath = path.join(cwd, 'delta.receipt.json');
  fs.writeFileSync(output, 'trusted artifact bytes\n');
  fs.writeFileSync(receiptPath, 'trusted receipt bytes\n');
  fs.chmodSync(output, 0o640);
  fs.chmodSync(receiptPath, 0o600);

  const result = run([
    'compare', 'architecture', baseFixture, headFixture, output,
    '--receipt', receiptPath, '--json',
  ], cwd);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(fs.statSync(output).mode & 0o777, 0o640);
  assert.equal(fs.statSync(receiptPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(output).nlink, 1);
  assert.equal(fs.statSync(receiptPath).nlink, 1);
});

test('compare rejects a hard-linked pair target before staging either output', (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-compare-hardlink-'));
  const output = path.join(cwd, 'delta.html');
  const receiptPath = path.join(cwd, 'delta.receipt.json');
  const receiptAlias = path.join(cwd, 'receipt-owner.json');
  const outputBytes = '<!doctype html><title>trusted artifact owner</title>\n';
  const receiptBytes = '{"owner":"trusted receipt owner"}\n';
  fs.writeFileSync(output, outputBytes);
  fs.writeFileSync(receiptPath, receiptBytes);
  try {
    fs.linkSync(receiptPath, receiptAlias);
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EACCES' || error?.code === 'ENOTSUP') {
      t.skip(`hard links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  const result = run([
    'compare', 'architecture', baseFixture, headFixture, output,
    '--receipt', receiptPath, '--json',
  ], cwd);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.stage, 'prepare');
  assert.equal(failure.diagnostics[0].code, 'output/target-hardlinked');
  assert.equal(failure.diagnostics[0].evidence.atomicOutput.code, 'target-hardlinked');
  assert.equal(fs.readFileSync(output, 'utf8'), outputBytes);
  assert.equal(fs.readFileSync(receiptPath, 'utf8'), receiptBytes);
  assert.equal(fs.readFileSync(receiptAlias, 'utf8'), receiptBytes);
  assert.equal(fs.readdirSync(cwd).some((name) => name.startsWith('.archify-compare-')), false);
});

test('preview applies the meta.output relative-path boundary before starting a server', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-preview-meta-'));
  const input = path.join(cwd, 'diagram.workflow.json');
  const output = path.join(cwd, 'authored.html');
  const source = JSON.parse(fs.readFileSync(workflowFixture, 'utf8'));
  source.meta.output = output;
  fs.writeFileSync(input, JSON.stringify(source));

  const failure = await startPreview({
    type: 'workflow',
    input,
    open: false,
    watch: false,
    cwd,
  }).then(async (preview) => {
    await preview.stop();
    return null;
  }, (error) => error);

  assert.ok(failure instanceof Error);
  assert.match(failure.message, /meta\.output must be a relative path/i);
  assert.equal(fs.existsSync(output), false);
});

test('the shared renderer rechecks its guarded output immediately before writing', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-render-race-'));
  const inputDirectory = path.join(cwd, 'input');
  const initialOutputDirectory = path.join(cwd, 'safe-output');
  const linkedDirectory = path.join(cwd, 'linked-output');
  fs.mkdirSync(inputDirectory);
  fs.mkdirSync(initialOutputDirectory);
  fs.symlinkSync(initialOutputDirectory, linkedDirectory, 'dir');
  const input = path.join(inputDirectory, 'diagram.workflow.html');
  const output = path.join(linkedDirectory, 'diagram.workflow.html');
  const source = fs.readFileSync(workflowFixture);
  fs.writeFileSync(input, source);

  const loaded = loadDiagram({
    rendererDir: path.join(skillRoot, 'renderers/workflow'),
    diagramType: 'workflow',
    defaultExample: 'agent-tool-call.workflow.json',
    argv: ['node', 'render-workflow.mjs', input, output],
  });
  fs.unlinkSync(linkedDirectory);
  fs.symlinkSync(inputDirectory, linkedDirectory, 'dir');

  assert.throws(
    () => writeDiagram({
      outPath: loaded.outPath,
      template: loaded.template,
      diagramType: 'workflow',
      meta: loaded.diagram.meta,
      svg: '<svg role="img"></svg>',
      cards: [],
    }),
    /output must not replace an input/i,
  );
  assert.deepEqual(fs.readFileSync(input), source);
});

test('compare rechecks every target immediately before committing the artifact pair', { timeout: 10000 }, async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-compare-race-'));
  const installedRoot = path.join(cwd, 'skill');
  const installedBin = path.join(installedRoot, 'bin');
  const installedShared = path.join(installedRoot, 'renderers/shared');
  const installedRenderer = path.join(installedRoot, 'renderers/architecture');
  const installedScripts = path.join(installedRoot, 'scripts');
  const installedDelta = path.join(installedRoot, 'delta');
  for (const directory of [installedBin, installedShared, installedRenderer, installedScripts, installedDelta]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  fs.copyFileSync(cli, path.join(installedBin, 'archify.mjs'));
  fs.copyFileSync(
    path.join(skillRoot, 'renderers/shared/output-path.mjs'),
    path.join(installedShared, 'output-path.mjs'),
  );
  fs.copyFileSync(
    path.join(skillRoot, 'renderers/shared/path-semantics.mjs'),
    path.join(installedShared, 'path-semantics.mjs'),
  );
  fs.copyFileSync(
    path.join(skillRoot, 'renderers/shared/portable-path.mjs'),
    path.join(installedShared, 'portable-path.mjs'),
  );
  fs.copyFileSync(
    path.join(skillRoot, 'renderers/shared/atomic-output.mjs'),
    path.join(installedShared, 'atomic-output.mjs'),
  );
  fs.copyFileSync(
    path.join(skillRoot, 'renderers/shared/sidecar-path.mjs'),
    path.join(installedShared, 'sidecar-path.mjs'),
  );
  fs.writeFileSync(path.join(installedRenderer, 'render-architecture.mjs'), `
import fs from 'node:fs';
import path from 'node:path';
const [, output] = process.argv.slice(2);
if (path.basename(output) === 'head.html') {
  const marker = process.env.ARCHIFY_TEST_RENDER_STARTED;
  const markerCandidate = marker + '.tmp';
  fs.writeFileSync(markerCandidate, output);
  fs.renameSync(markerCandidate, marker);
  await new Promise((resolve) => setTimeout(resolve, 500));
}
fs.writeFileSync(output, '<!doctype html><svg role="img"></svg>');
`);
  fs.writeFileSync(path.join(installedScripts, 'check-render-output.mjs'), `
console.log(JSON.stringify({
  ok: true,
  checks: [{ name: 'single_svg', ok: true }],
  composition: {
    profile: 'showcase',
    status: 'pass',
    summary: { errors: 0, warnings: 0 }
  }
}));
`);
  fs.writeFileSync(path.join(installedDelta, 'architecture-delta.mjs'), `
export class ArchitectureDeltaError extends Error {}
export const annotateArchitectureSideSvg = (svg) => svg;
export const buildDeltaSvg = () => '<svg role="img"></svg>';
export const canonicalArchitecture = (value) => value;
export const canonicalArchitectureJson = (value) => JSON.stringify(value);
export const compareArchitecture = () => ({
  command: 'compare',
  base: {},
  head: {},
  completeness: 'complete',
  proofLevel: 'authored'
});
export const extractArchitectureSvg = () => '<svg role="img"></svg>';
export const extractArtifactCss = () => '';
export const renderArchitectureDeltaHtml = () => '<!doctype html><svg role="img"></svg>';
export const validateArchitectureDeltaHtml = () => ({ checksPassed: 1, checkCount: 1 });
`);

  const inputDirectory = path.join(cwd, 'input');
  const initialOutputDirectory = path.join(cwd, 'safe-output');
  const linkedDirectory = path.join(cwd, 'linked-output');
  fs.mkdirSync(inputDirectory);
  fs.mkdirSync(initialOutputDirectory);
  fs.symlinkSync(initialOutputDirectory, linkedDirectory, 'dir');
  const base = path.join(inputDirectory, 'diagram.html');
  const head = path.join(cwd, 'head.json');
  const output = path.join(linkedDirectory, 'diagram.html');
  const source = Buffer.from('{"meta":{"output":"base.html"},"side":"base"}');
  fs.writeFileSync(base, source);
  fs.writeFileSync(head, '{"meta":{"output":"head.html"},"side":"head"}');
  const marker = path.join(cwd, 'renderer-started');

  const child = spawn(process.execPath, [
    path.join(installedBin, 'archify.mjs'),
    'compare', 'architecture', base, head, output, '--json',
  ], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ARCHIFY_TEST_RENDER_STARTED: marker },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const started = Date.now();
  while (!fs.existsSync(marker) && Date.now() - started < 3000) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.existsSync(marker), true, `renderer did not start; stderr=${stderr}`);
  // Staging stays in the physical output directory when this alias is retargeted.
  fs.unlinkSync(linkedDirectory);
  fs.symlinkSync(inputDirectory, linkedDirectory, 'dir');

  const status = await new Promise((resolve) => child.once('close', resolve));

  assert.equal(status, 1, stderr);
  const receipt = JSON.parse(stdout);
  assert.equal(receipt.stage, 'commit');
  assert.equal(receipt.diagnostics[0].code, 'output/input-alias');
  assert.deepEqual(fs.readFileSync(base), source);
});

test('doctor reports a missing output-path safety runtime in an installed skill', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-doctor-'));
  const installedRoot = path.join(cwd, 'skill');
  copyInstalledSkill(installedRoot);
  fs.rmSync(path.join(installedRoot, 'renderers/shared/output-path.mjs'));

  const result = spawnSync(process.execPath, [path.join(installedRoot, 'bin/archify.mjs'), 'doctor'], {
    cwd: installedRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[missing\] Output path safety runtime/);
});

for (const [relative, label] of [
  ['renderers/shared/path-semantics.mjs', 'Physical path semantics runtime'],
  ['renderers/shared/portable-path.mjs', 'Portable path contract runtime'],
  ['renderers/shared/sidecar-path.mjs', 'Sidecar path naming runtime'],
]) {
  test(`doctor reports a missing ${path.basename(relative)} runtime without crashing`, () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-output-doctor-dependency-'));
    const installedRoot = path.join(cwd, 'skill');
    copyInstalledSkill(installedRoot);
    fs.rmSync(path.join(installedRoot, relative));

    const result = spawnSync(process.execPath, [path.join(installedRoot, 'bin/archify.mjs'), 'doctor'], {
      cwd: installedRoot,
      encoding: 'utf8',
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, new RegExp(`\\[missing\\] ${label}`));
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
  });
}
