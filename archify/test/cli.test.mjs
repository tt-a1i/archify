import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { extractSvgs, parseXml } from './helpers/xml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-cli-'));
const cli = path.join(skillRoot, 'bin/archify.mjs');

test.afterEach(() => {
  fs.rmSync(path.join(tmp, '.archify-delivery-lock.json'), { force: true });
});

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: options.cwd || skillRoot,
    encoding: 'utf8',
    env: options.env || process.env,
  });
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function deliverySidecarPath(file, suffix) {
  let artifact = path.resolve(file);
  try {
    artifact = fs.realpathSync.native(artifact);
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    try {
      artifact = path.join(fs.realpathSync.native(path.dirname(artifact)), path.basename(artifact));
    } catch (directoryError) {
      if (directoryError.code !== 'ENOENT' && directoryError.code !== 'ENOTDIR') throw directoryError;
    }
  }
  return artifact.replace(/\.html?$/i, suffix);
}

function deliveryProvenancePath(file) {
  return deliverySidecarPath(file, '.delivery.json');
}

function deliveryPendingPath(file) {
  return deliverySidecarPath(file, '.delivery-pending.json');
}

function deliveryLockPath(file) {
  const artifact = path.resolve(file);
  let directory;
  try {
    directory = path.dirname(fs.realpathSync.native(artifact));
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    try {
      directory = fs.realpathSync.native(path.dirname(artifact));
    } catch (directoryError) {
      if (directoryError.code !== 'ENOENT' && directoryError.code !== 'ENOTDIR') throw directoryError;
      directory = path.dirname(artifact);
    }
  }
  return path.join(directory, '.archify-delivery-lock.json');
}

function legacyDeliveryLockPath(file) {
  return path.resolve(file).replace(/\.html?$/i, '.delivery-lock.json');
}

function deliveryStagingEntries(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('.archify-delivery-'))
    .map((entry) => entry.name)
    .sort();
}

function successorDeliveryState({ receiptId, input, output, pid = process.pid }) {
  return {
    artifact: '<!doctype html><title>successor artifact</title>\n',
    lock: `${JSON.stringify({ schemaVersion: 1, receiptId, pid })}\n`,
    pending: `${JSON.stringify({
      schemaVersion: 1,
      command: 'deliver',
      status: 'pending',
      receiptId,
      input: path.resolve(input),
      output: path.resolve(output),
    }, null, 2)}\n`,
    provenance: `${JSON.stringify({
      schemaVersion: 1,
      receiptId,
      status: 'failed',
      command: 'deliver',
      stage: 'successor',
      input: path.resolve(input),
      output: path.resolve(output),
      error: 'successor owns this failure record',
    }, null, 2)}\n`,
  };
}

function visualEvidencePaths(file) {
  const base = file.replace(/\.html?$/i, '.visual-check');
  return {
    receipt: `${base}.json`,
    contactSheet: `${base}.html`,
    screenshots: [
      `${base}.1440x900.light.png`,
      `${base}.1440x900.dark.png`,
      `${base}.2048x1320.light.png`,
      `${base}.2048x1320.dark.png`,
    ],
  };
}

function assertCheckFailureReceipt(receipt, file, codePattern) {
  assert.equal(receipt.ok, false);
  assert.equal(receipt.file, path.resolve(file));
  assert.ok(Array.isArray(receipt.diagnostics));
  assert.match(receipt.diagnostics[0].code, codePattern);
}

function makeFakeOpeners(name, { exitCode = 0 } = {}) {
  const bin = path.join(tmp, name);
  const log = path.join(bin, 'open-log.json');
  fs.mkdirSync(bin, { recursive: true });
  const source = `#!/usr/bin/env node
const fs = require('node:fs');
const target = process.argv[process.argv.length - 1];
fs.writeFileSync(process.env.ARCHIFY_TEST_OPEN_LOG, JSON.stringify({
  argv: process.argv.slice(2),
  target,
  existed: fs.existsSync(target),
}));
process.exit(${exitCode});
`;
  for (const command of ['open', 'xdg-open']) {
    const executable = path.join(bin, command);
    fs.writeFileSync(executable, source);
    fs.chmodSync(executable, 0o755);
  }
  return {
    log,
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH || ''}`,
      ARCHIFY_TEST_OPEN_LOG: log,
    },
  };
}

function copyInstalledSkill(target) {
  fs.cpSync(skillRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(skillRoot, source);
      return rel !== 'node_modules' && !rel.startsWith(`node_modules${path.sep}`)
        && rel !== 'test' && !rel.startsWith(`test${path.sep}`)
        // Another test creates this short-lived directory under skillRoot so
        // Ajv resolves from the checkout. Never copy a concurrently removed
        // test fixture into an installed-skill simulation.
        && !rel.startsWith('.validator-check-');
    },
  });
}

test('cli: help lists commands and diagram types', () => {
  const result = run(['--help']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /archify render <type>/);
  assert.match(result.stdout, /archify compare architecture <base\.json> <head\.json>/);
  assert.match(result.stdout, /archify deliver <type>/);
  assert.match(result.stdout, /archify preview <type>/);
  assert.match(result.stdout, /archify visual-check <output\.html>/);
  assert.match(result.stdout, /--open/);
  assert.match(result.stdout, /archify validate <type> <input\.json> .*\[--repo-root path\]/);
  assert.doesNotMatch(result.stdout, /architecture only/);
  assert.match(result.stdout, /archify guide \[scenario or question\]/);
  assert.match(result.stdout, /archify doctor/);
  assert.match(result.stdout, /archify demo \[output-directory\]/);
  assert.match(result.stdout, /architecture, workflow, sequence, dataflow, lifecycle/);
});

test('cli: doctor reports a complete installation is ready', () => {
  const result = run(['doctor']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\[ok\] Node\.js v\d+/);
  assert.match(result.stdout, /\[ok\] Core template/);
  assert.match(result.stdout, /\[ok\] Example renderer/);
  assert.match(result.stdout, /\[ok\] Live preview runtime/);
  assert.match(result.stdout, /\[ok\] Atomic output safety runtime/);
  assert.match(result.stdout, /\[ok\] Sidecar path naming runtime/);
  assert.match(result.stdout, /\[ok\] Scenario recipe guide/);
  assert.match(result.stdout, /\[ok\] Progressive authoring references/);
  assert.match(result.stdout, /\[ok\] Architecture compare runtime and proof fixtures/);
  assert.match(result.stdout, /\[ok\] Standalone schema validators/);
  assert.match(result.stdout, /\[ok\] architecture renderer, schema, and example/);
  assert.match(result.stdout, /\[ok\] lifecycle renderer, schema, and example/);
  assert.match(result.stdout, /Archify is ready\./);
});

test('cli: doctor identifies an incomplete installation', () => {
  const incompleteRoot = path.join(tmp, 'incomplete-skill');
  const incompleteBin = path.join(incompleteRoot, 'bin');
  fs.mkdirSync(incompleteBin, { recursive: true });
  fs.copyFileSync(cli, path.join(incompleteBin, 'archify.mjs'));

  const result = spawnSync(process.execPath, [path.join(incompleteBin, 'archify.mjs'), 'doctor'], {
    cwd: incompleteRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[missing\] Core template/);
  assert.match(result.stdout, /\[missing\] Scenario recipe guide/);
  assert.match(result.stdout, /\[missing\] workflow renderer, schema, and example/);
  assert.match(result.stderr, /Archify is not ready: \d+ required files? missing\./);
});

test('cli: doctor rejects a corrupt standalone validator', () => {
  const corruptRoot = path.join(tmp, 'corrupt-skill');
  copyInstalledSkill(corruptRoot);
  fs.writeFileSync(path.join(corruptRoot, 'renderers/shared/generated-validators.mjs'), 'export const workflow = ;\n');

  const result = spawnSync(process.execPath, [path.join(corruptRoot, 'bin/archify.mjs'), 'doctor'], {
    cwd: corruptRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stdout, /\[invalid\] Standalone schema validators/);
  assert.match(result.stderr, /Archify is not ready: 1 runtime check failed\./);
});

test('cli: examples renders from an installed skill', () => {
  const installedRoot = path.join(tmp, 'installed-skill');
  copyInstalledSkill(installedRoot);

  const result = spawnSync(process.execPath, [path.join(installedRoot, 'bin/archify.mjs'), 'examples'], {
    cwd: installedRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  for (const output of [
    'workflow-agent-tool-call-rendered.html',
    'sequence-cache-miss-request.html',
    'dataflow-product-analytics.html',
    'lifecycle-agent-run.html',
    'web-app-rendered.html',
  ]) {
    assert.equal(fs.existsSync(path.join(installedRoot, 'examples', output)), true, output);
  }
});

test('cli: argument-free commands reject trailing arguments', () => {
  for (const command of ['examples', 'doctor']) {
    const extra = run([command, 'ignored-extra']);
    assert.equal(extra.status, 2, command);
    assert.match(extra.stderr, /Usage:/, command);

    const unknown = run([command, '--bogus']);
    assert.equal(unknown.status, 2, command);
    assert.match(unknown.stderr, new RegExp(`Unknown ${command} option "--bogus"`), command);
  }
});

test('cli: guide lists all scenario recipes by diagram type', () => {
  const result = run(['guide']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Archify scenario recipes \(12\)/);
  for (const type of ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle']) {
    assert.match(result.stdout, new RegExp(`\\[${type}\\]`));
  }
});

test('cli: guide recommends a scenario as structured json', () => {
  const result = run(['guide', 'Show an API request with Redis cache miss', '--json']);

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.lang, 'en');
  assert.equal(parsed.confidence, 'high');
  assert.equal(parsed.recommendation.id, 'api-request');
  assert.equal(parsed.recommendation.type, 'sequence');
});

test('cli: guide detects Chinese and explains the recommendation boundary', () => {
  const result = run(['guide', '展示 Kafka topic 消费者组和死信队列']);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /推荐: 事件流拓扑  \[dataflow\]/);
  assert.match(result.stdout, /不要这样用:/);
  assert.match(result.stdout, /必须包含:/);
  assert.match(result.stdout, /可直接复制的提示词:/);
});

test('cli: guide works from an installed skill without node_modules', () => {
  const installedRoot = path.join(tmp, 'installed-guide-skill');
  copyInstalledSkill(installedRoot);
  const installedCli = path.join(installedRoot, 'bin/archify.mjs');

  const result = spawnSync(process.execPath, [installedCli, 'guide', 'incident-runbook', '--json'], {
    cwd: installedRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).recommendation.id, 'incident-runbook');
});

test('cli: guide returns repair steps, via semantics, and viewport checks as JSON', () => {
  const result = run(['guide', 'viewport overflow', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.recommendation.id, 'layout-repair');
  assert.equal(parsed.confidence, 'high');
  assert.ok(parsed.matchedSignals.includes('viewport overflow'));
  const prompt = parsed.recommendation.prompt;
  assert.match(prompt, /schema.*overlap.*direction.*crossings.*labels/s);
  assert.match(prompt, /\[start, \.\.\.via, end\]/);
  assert.match(prompt, /absolute.*\[x, y\]/);
  assert.match(prompt, /1440×900.*1600×1000.*1920×1080.*2048×1320/);
  assert.match(prompt, /scrollWidth <= window\.innerWidth/);
  assert.match(prompt, /scrollHeight <= window\.innerHeight/);
  assert.match(prompt, /validate.*diagnostics\[\].*supportedFixes/);
});

test('cli: guide prints localized repair advice, including an explicit language override', () => {
  for (const args of [
    ['guide', '视口溢出，标签重叠，修复顺序'],
    ['guide', 'how do via waypoints work', '--lang', 'zh'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /推荐: 布局修复/);
    assert.match(result.stdout, /schema.*重叠.*方向.*交叉.*标签/s);
    assert.match(result.stdout, /\[start, \.\.\.via, end\]/);
    assert.match(result.stdout, /scrollHeight <= window\.innerHeight/);
    assert.match(result.stdout, /validate/);
  }
});

test('cli: demo creates a ready-to-open diagram in a chosen directory', () => {
  const outputDirectory = path.join(tmp, 'my-demo');
  const output = path.join(outputDirectory, 'archify-demo.html');
  const result = run(['demo', outputDirectory]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(output), true);
  assert.match(fs.readFileSync(output, 'utf8'), /Sample Web App Diagram/);
  assert.match(result.stdout, new RegExp(`Demo ready: ${output.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(result.stdout, /Next: open the HTML in your browser/);
  assert.match(result.stdout, /archify render architecture/);
});

test('cli: demo defaults to the current directory', () => {
  const workingDirectory = path.join(tmp, 'default-demo');
  fs.mkdirSync(workingDirectory);
  const result = run(['demo'], { cwd: workingDirectory });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(path.join(workingDirectory, 'archify-demo.html')), true);
});

test('cli: demo rejects a mistyped option without creating an output directory', () => {
  const workingDirectory = path.join(tmp, 'demo-option-guard');
  fs.mkdirSync(workingDirectory);

  const result = run(['demo', '--typo'], { cwd: workingDirectory });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown demo option "--typo"/);
  assert.deepEqual(fs.readdirSync(workingDirectory), []);
});

test('cli: render writes a diagram html file', () => {
  const out = path.join(tmp, 'workflow.html');
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const result = run(['render', 'workflow', input, out]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(out), true);
  assert.match(fs.readFileSync(out, 'utf8'), /Agent Tool Call Workflow/);
});

test('cli: visual-check returns a skipped receipt with exit 2 when Chrome is unavailable', () => {
  const out = path.join(tmp, 'visual-check-skipped.html');
  fs.writeFileSync(out, '<!doctype html><html><body>delivered</body></html>');
  const missingChrome = path.join(tmp, 'missing-chrome');
  const result = run(['visual-check', out, '--json'], {
    env: { ...process.env, ARCHIFY_CHROME: missingChrome },
  });

  assert.equal(result.status, 2, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'skipped');
  assert.equal(receipt.evidenceKind, 'automated-browser');
  assert.equal(receipt.visualReview, 'pending');
  assert.equal(receipt.chrome.status, 'unavailable');
  assert.equal(fs.existsSync(out.replace(/\.html$/, '.visual-check.json')), true);
});

test('cli: visual-check --out-dir writes the receipt into that directory, not beside the artifact', () => {
  const out = path.join(tmp, 'visual-check-outdir.html');
  fs.writeFileSync(out, '<!doctype html><html><body>delivered</body></html>');
  const missingChrome = path.join(tmp, 'missing-chrome-outdir');
  const outDir = path.join(tmp, 'visual-check-outdir-evidence');
  const result = run(['visual-check', out, '--json', '--out-dir', outDir], {
    env: { ...process.env, ARCHIFY_CHROME: missingChrome },
  });

  assert.equal(result.status, 2, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'skipped');
  assert.equal(fs.existsSync(path.join(outDir, 'visual-check-outdir.visual-check.json')), true);
  assert.equal(fs.existsSync(out.replace(/\.html$/, '.visual-check.json')), false, 'no receipt should land beside the artifact when --out-dir is set');
});

test('cli: visual-check --out-dir redirects failed provenance evidence', () => {
  const out = path.join(tmp, 'visual-check-outdir-provenance.html');
  const outDir = path.join(tmp, 'visual-check-outdir-provenance-evidence');
  fs.writeFileSync(out, '<!doctype html><html><body>not delivered</body></html>');

  const result = run(['visual-check', out, '--json', '--require-provenance', '--out-dir', outDir]);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.status, 'fail');
  assert.equal(receipt.sidecars.directory, outDir);
  assert.match(receipt.diagnostics[0].code, /^delivery\/provenance-/);
  assert.equal(fs.existsSync(path.join(outDir, 'visual-check-outdir-provenance.visual-check.json')), true);
  assert.equal(fs.existsSync(out.replace(/\.html$/, '.visual-check.json')), false);
});

test('cli: visual-check rejects an invalid raw --out-dir before filesystem mutation', () => {
  const workingDirectory = path.join(tmp, 'visual-check-invalid-raw-outdir');
  fs.mkdirSync(workingDirectory);
  const out = path.join(workingDirectory, 'artifact.html');
  fs.writeFileSync(out, '<!doctype html><html><body>delivered</body></html>');
  const before = fs.readdirSync(workingDirectory).sort();
  const invalidOutDir = process.platform === 'win32'
    ? `${path.parse(workingDirectory).root.slice(0, 2)}evidence`
    : path.join(workingDirectory, 'x'.repeat(256));
  const normalizedMutation = process.platform === 'win32'
    ? path.join(workingDirectory, 'evidence')
    : invalidOutDir;
  const missingChrome = path.join(workingDirectory, 'missing-chrome');

  const result = run([
    'visual-check', out, '--json', '--out-dir', invalidOutDir,
  ], {
    cwd: workingDirectory,
    env: { ...process.env, ARCHIFY_CHROME: missingChrome },
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.command, 'visual-check');
  assert.equal(receipt.diagnostics[0].code, 'output/native-path-syntax');
  assert.equal(receipt.diagnostics[0].subject.output, invalidOutDir);
  assert.deepEqual(fs.readdirSync(workingDirectory).sort(), before);
  assert.equal(fs.existsSync(normalizedMutation), false);
  const evidence = visualEvidencePaths(out);
  assert.equal(fs.existsSync(evidence.receipt), false);
  assert.equal(fs.existsSync(evidence.contactSheet), false);
  assert.equal(evidence.screenshots.every((file) => !fs.existsSync(file)), true);
});

test('cli: visual-check rejects --out-dir with no value', () => {
  const out = path.join(tmp, 'visual-check-outdir-missing-value.html');
  fs.writeFileSync(out, '<!doctype html><html><body>delivered</body></html>');
  const result = run(['visual-check', out, '--out-dir']);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--out-dir requires a directory path/);
});

test('cli: visual-check describes human output as automated browser evidence, not visual approval', () => {
  const out = path.join(tmp, 'visual-check-browser-evidence.html');
  fs.writeFileSync(out, '<!doctype html><html><body>delivered</body></html>');
  const missingChrome = path.join(tmp, 'missing-browser-evidence-chrome');
  const result = run(['visual-check', out], {
    env: { ...process.env, ARCHIFY_CHROME: missingChrome },
  });

  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /automated browser evidence skipped:/i);
  assert.match(result.stdout, /perceptual visual review pending/i);
  assert.doesNotMatch(result.stdout, /^visual-check skipped:/m);
});

test('cli: visual-check keeps automated and perceptual claims separate on input failure', () => {
  const result = run(['visual-check', path.join(tmp, 'missing-browser-evidence.html')]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /automated browser evidence failed:/i);
  assert.match(result.stderr, /perceptual visual review pending/i);
  assert.doesNotMatch(result.stderr, /^visual-check failed:/m);
});

test('cli: deliver atomically writes a checked artifact and structured receipt', () => {
  const out = path.join(tmp, 'delivered-workflow.html');
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const result = run(['deliver', 'workflow', input, out, '--quality', 'showcase', '--json']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(out), true);
  assert.match(fs.readFileSync(out, 'utf8'), /Agent Tool Call Workflow/);

  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.command, 'deliver');
  assert.equal(receipt.type, 'workflow');
  assert.equal(receipt.input, input);
  assert.equal(receipt.output, fs.realpathSync.native(out));
  assert.deepEqual(receipt.specification, {
    sha256: sha256(input),
    bytes: fs.statSync(input).size,
  });
  assert.match(receipt.artifact.sha256, /^[a-f0-9]{64}$/);
  assert.equal(receipt.artifact.sha256, sha256(out));
  assert.equal(receipt.artifact.bytes, fs.statSync(out).size);
  assert.deepEqual(receipt.validation, {
    checksPassed: 9,
    checkCount: 9,
    compositionProfile: 'showcase',
    compositionStatus: 'pass',
    errors: 0,
    warnings: 0,
  });
  assert.equal('open' in receipt, false);
});

test('cli: deliver --open launches only the committed absolute artifact as one argument', {
  skip: process.platform === 'win32',
}, () => {
  const fake = makeFakeOpeners('successful-open');
  const out = path.join(tmp, `-复杂 path 'quoted'`, 'verified diagram.html');
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const result = run(['deliver', 'workflow', input, out, '--open', '--json'], { env: fake.env });

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  const physicalOut = fs.realpathSync.native(out);
  assert.deepEqual(receipt.open, {
    requested: true,
    status: 'opened',
    target: physicalOut,
    method: process.platform === 'darwin' ? 'open' : 'xdg-open',
  });
  const invocation = JSON.parse(fs.readFileSync(fake.log, 'utf8'));
  assert.equal(invocation.existed, true, 'the opener must run after the atomic commit');
  assert.deepEqual(invocation.argv, [physicalOut]);
  assert.equal(invocation.target, physicalOut);
  assert.equal(fs.existsSync(out), true);
});

test('cli: opener failure does not invalidate a verified delivery or pollute json stdout', {
  skip: process.platform === 'win32',
}, () => {
  const fake = makeFakeOpeners('failed-open', { exitCode: 17 });
  const out = path.join(tmp, 'open-failure-preserves-delivery.html');
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');
  const result = run(['deliver', 'architecture', input, out, '--open', '--json'], { env: fake.env });

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.open.status, 'failed');
  assert.equal(receipt.open.target, fs.realpathSync.native(out));
  assert.match(result.stderr, /Could not open the verified artifact/);
  assert.match(result.stderr, new RegExp(out.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(fs.existsSync(out), true);
  assert.equal(receipt.artifact.sha256, sha256(out));
});

test('cli: deliver failure never invokes the optional opener', {
  skip: process.platform === 'win32',
}, () => {
  const fake = makeFakeOpeners('never-open');
  const input = path.join(tmp, 'invalid-open-delivery.json');
  fs.writeFileSync(input, '{broken json');
  const out = path.join(tmp, 'must-not-open.html');
  const result = run(['deliver', 'architecture', input, out, '--open', '--json'], { env: fake.env });

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).stage, 'input');
  assert.equal(fs.existsSync(fake.log), false);
  assert.equal(fs.existsSync(out), false);
});

test('cli: a missing optional opener module preserves verified delivery with a fallback receipt', () => {
  const installedRoot = path.join(tmp, 'missing-open-module-skill');
  copyInstalledSkill(installedRoot);
  const installedCli = path.join(installedRoot, 'bin/archify.mjs');
  fs.rmSync(path.join(installedRoot, 'bin/open-artifact.mjs'));
  const input = path.join(installedRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'missing-open-module-delivery.html');

  const result = spawnSync(process.execPath, [installedCli, 'deliver', 'workflow', input, out, '--open', '--json'], {
    cwd: installedRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.ok, true);
  assert.deepEqual(receipt.open, {
    requested: true,
    status: 'unsupported',
    target: fs.realpathSync.native(out),
    method: null,
  });
  assert.match(result.stderr, /Open it manually/);
  assert.equal(receipt.artifact.sha256, sha256(out));
});

test('cli: deliver preserves the renderer default output contract', () => {
  const workingDirectory = path.join(tmp, 'delivery-default-output');
  fs.mkdirSync(workingDirectory, { recursive: true });
  const input = path.join(workingDirectory, 'source.architecture.json');
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  source.meta.output = 'verified-default.html';
  fs.writeFileSync(input, JSON.stringify(source));

  const result = run(['deliver', 'architecture', input, '--json'], { cwd: workingDirectory });
  assert.equal(result.status, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.output, path.join(fs.realpathSync(workingDirectory), 'verified-default.html'));
  assert.equal(fs.existsSync(receipt.output), true);
});

test('cli: deliver works from an installed skill without node_modules', () => {
  const installedRoot = path.join(tmp, 'installed-deliver-skill');
  copyInstalledSkill(installedRoot);
  const installedCli = path.join(installedRoot, 'bin/archify.mjs');
  const cases = [
    ['architecture-boundaries', 'architecture', 'production-deployment.architecture.json'],
    ['architecture-issue-110', 'architecture', 'brand-aware-delivery.architecture.json'],
    ['workflow', 'workflow', 'agent-tool-call.workflow.json'],
    ['sequence', 'sequence', 'cache-miss-request.sequence.json'],
    ['dataflow', 'dataflow', 'product-analytics.dataflow.json'],
    ['lifecycle', 'lifecycle', 'agent-run.lifecycle.json'],
  ];

  for (const [label, type, example] of cases) {
    const input = path.join(installedRoot, 'examples', example);
    const out = path.join(tmp, `installed-${label}-delivery.html`);
    const result = spawnSync(process.execPath, [installedCli, 'deliver', type, input, out, '--json'], {
      cwd: installedRoot,
      encoding: 'utf8',
    });

    assert.equal(result.status, 0, `${label}: ${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).validation.checkCount, 9, label);
    assert.equal(fs.existsSync(out), true, label);
    const extracted = extractSvgs(fs.readFileSync(out, 'utf8'));
    assert.equal(extracted.direct.length, 1, `${label}: expected one delivered SVG`);
    assert.doesNotThrow(
      () => parseXml(extracted.direct[0]),
      `${label}: delivered SVG must be well-formed XML`,
    );
  }
});

test('cli: deliver XML guard parses markup instead of scanning attribute-like text', () => {
  assert.doesNotThrow(() => parseXml(
    '<svg xmlns="http://www.w3.org/2000/svg" aria-label="mentions data-node-label safely"/>',
  ));
  assert.throws(
    () => parseXml('<svg xmlns="http://www.w3.org/2000/svg" data-node-label></svg>'),
    /attribute without value/i,
  );
  assert.throws(
    () => parseXml('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'),
    /unexpected close tag/i,
  );
});

test('cli: preview runs from an installed skill without node_modules and exits cleanly', { timeout: 30000 }, async () => {
  const installedRoot = path.join(tmp, 'installed-preview-skill');
  copyInstalledSkill(installedRoot);
  const installedCli = path.join(installedRoot, 'bin/archify.mjs');
  const input = path.join(installedRoot, 'examples/web-app.architecture.json');
  const output = path.join(tmp, 'installed-preview.html');
  // Windows child.kill() terminates immediately, bypassing the signal handler.
  const signalRelay = process.platform === 'win32'
    ? ['--import', 'data:text/javascript,process.once("message", () => { process.disconnect(); process.emit("SIGTERM"); });']
    : [];
  const child = spawn(process.execPath, [...signalRelay, installedCli, 'preview', 'architecture', input, output, '--quality', 'showcase', '--no-open'], {
    cwd: installedRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe', ...(process.platform === 'win32' ? ['ipc'] : [])],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  let previewUrl;
  const started = Date.now();
  while (!previewUrl && Date.now() - started < 8000) {
    previewUrl = stdout.match(/preview (http:\/\/127\.0\.0\.1:\d+\/)/)?.[1];
    if (!previewUrl) await new Promise((resolve) => setTimeout(resolve, 40));
  }
  assert.ok(previewUrl, `preview URL missing; stdout=${stdout}; stderr=${stderr}`);

  let state;
  while (Date.now() - started < 15000) {
    state = await fetch(new URL('/state', previewUrl)).then((response) => response.json());
    if (state.status === 'verified') break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(state?.status, 'verified', `preview did not verify; stdout=${stdout}; stderr=${stderr}`);
  assert.equal(state.revision, 1);
  assert.equal(fs.existsSync(output), true);

  if (process.platform === 'win32') child.send('stop');
  else child.kill('SIGTERM');
  const exit = await new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  assert.deepEqual(exit, { code: 0, signal: null });
  assert.match(stdout, /stopping preview/);
  await assert.rejects(fetch(previewUrl));
  assert.deepEqual(fs.readdirSync(path.dirname(output)).filter((name) => name.startsWith('.archify-preview-')), []);
});

test('cli: deliver preserves the previous artifact when the final check fails', () => {
  const installedRoot = path.join(tmp, 'broken-deliver-skill');
  copyInstalledSkill(installedRoot);
  const installedCli = path.join(installedRoot, 'bin/archify.mjs');
  const templatePath = path.join(installedRoot, 'assets/template.html');
  const template = fs.readFileSync(templatePath, 'utf8');
  fs.writeFileSync(templatePath, template.replace('</body>', '<svg aria-label="accidental second svg"></svg>\n</body>'));

  const input = path.join(installedRoot, 'examples/web-app.architecture.json');
  const out = path.join(tmp, 'preserved-delivery.html');
  const trustedPriorArtifact = '<!doctype html><title>trusted prior artifact</title>\n';
  fs.writeFileSync(out, trustedPriorArtifact);

  const result = spawnSync(process.execPath, [installedCli, 'deliver', 'architecture', input, out, '--json'], {
    cwd: installedRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.stage, 'check');
  assert.equal(failure.diagnostics[0].code, 'artifact/single-svg');
  assert.equal(failure.diagnostics[0].subject.check, 'single_svg');
  assert.ok(failure.diagnostics[0].supportedFixes.some((fix) => fix.includes('exactly one diagram SVG')));
  assert.equal(failure.checker.checks.find((entry) => entry.name === 'single_svg').ok, false);
  assert.equal(fs.readFileSync(out, 'utf8'), trustedPriorArtifact);
  assert.deepEqual(
    fs.readdirSync(path.dirname(out)).filter((name) => name.includes('.archify-delivery-')),
    [],
  );
});

test('cli: deliver reports renderer failure as json and preserves the previous artifact', () => {
  const validInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const input = path.join(tmp, 'invalid-delivery.workflow.json');
  const source = JSON.parse(fs.readFileSync(validInput, 'utf8'));
  source.nodes[0].unexpected = true;
  fs.writeFileSync(input, JSON.stringify(source));

  const out = path.join(tmp, 'renderer-failure-preserved.html');
  const delivered = run(['deliver', 'workflow', validInput, out, '--json']);
  assert.equal(delivered.status, 0, delivered.stderr);
  const trustedPriorArtifact = fs.readFileSync(out);

  const result = run(['deliver', 'workflow', input, out, '--json']);
  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.stage, 'render');
  assert.match(failure.error, /schema validation failed/i);
  assert.deepEqual(fs.readFileSync(out), trustedPriorArtifact);
  const provenance = JSON.parse(fs.readFileSync(deliveryProvenancePath(out), 'utf8'));
  assert.equal(provenance.status, 'failed');
  assert.equal(provenance.stage, 'render');
  assert.equal(provenance.artifact.sha256, sha256(out));
  assert.equal(provenance.receiptId, failure.receiptId);

  const checked = run(['check', out]);
  assert.equal(checked.status, 1);
  const checkReceipt = JSON.parse(checked.stdout);
  assert.equal(checkReceipt.provenance, 'failed');
  assert.equal(checkReceipt.diagnostics[0].code, 'delivery/provenance-failed');

  const visual = run(['visual-check', out, '--json']);
  assert.equal(visual.status, 1);
  const visualReceipt = JSON.parse(visual.stdout);
  assert.equal(visualReceipt.provenance, 'failed');
  assert.equal(visualReceipt.diagnostics[0].code, 'delivery/provenance-failed');
});

test('cli: a later successful delivery replaces stale provenance with an artifact-bound receipt', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-provenance-recovers.html');
  fs.writeFileSync(out, '<!doctype html><title>old artifact</title>\n');
  fs.writeFileSync(deliveryProvenancePath(out), JSON.stringify({ status: 'failed' }));

  const delivered = run(['deliver', 'workflow', input, out, '--json']);
  assert.equal(delivered.status, 0, delivered.stderr);
  const receipt = JSON.parse(delivered.stdout);
  const provenance = JSON.parse(fs.readFileSync(deliveryProvenancePath(out), 'utf8'));
  assert.equal(provenance.status, 'current');
  assert.match(receipt.receiptId, /^[0-9a-f-]{36}$/i);
  assert.equal(provenance.receiptId, receipt.receiptId);
  assert.deepEqual(provenance.specification, receipt.specification);
  assert.deepEqual(provenance.artifact, receipt.artifact);
  const currentCheck = run(['check', out]);
  assert.equal(currentCheck.status, 0);
  assert.equal(JSON.parse(currentCheck.stdout).provenance, 'current');
  assert.equal(JSON.parse(currentCheck.stdout).deliveryReceiptId, receipt.receiptId);

  fs.appendFileSync(out, '<!-- changed after delivery -->');
  const checked = run(['check', out]);
  assert.equal(checked.status, 1);
  const mismatch = JSON.parse(checked.stdout);
  assert.equal(mismatch.provenance, 'mismatch');
  assert.equal(mismatch.diagnostics[0].code, 'delivery/provenance-mismatch');
});

test('cli: delivery pair rollback restores the previous HTML and marks it stale', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-pair-rollback.html');
  const provenancePath = deliveryProvenancePath(out);
  const initial = run(['deliver', 'workflow', input, out, '--json']);
  assert.equal(initial.status, 0, initial.stderr);
  const priorArtifact = fs.readFileSync(out);

  const wrapper = path.join(tmp, 'fail-provenance-commit.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const linkSync = fs.linkSync;
fs.linkSync = (source, target) => {
  if (String(source).endsWith('delivery-provenance.json')) {
    const error = new Error('injected provenance link failure');
    error.code = 'EACCES';
    throw error;
  }
  return linkSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).stage, 'commit');
  assert.match(result.stdout, /previous files were restored/);
  assert.deepEqual(fs.readFileSync(out), priorArtifact);
  assert.equal(JSON.parse(fs.readFileSync(provenancePath, 'utf8')).status, 'failed');
  const checked = run(['check', out]);
  assert.equal(checked.status, 1);
  assert.equal(JSON.parse(checked.stdout).provenance, 'failed');
});

for (const failureMode of ['journal-read', 'journal-unlink', 'journal-unlink-and-restore']) {
  test(`cli: delivery finalization failure preserves previous bytes or recovery backup (${failureMode})`, () => {
    const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
    const replacement = path.join(skillRoot, 'examples/incident-response.workflow.json');
    const out = path.join(tmp, `${failureMode}.html`);
    assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
    const previousHash = sha256(out);
    const wrapper = path.join(tmp, `${failureMode}.mjs`);
    fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const linkSync = fs.linkSync;
const lstatSync = fs.lstatSync;
const renameSync = fs.renameSync;
let pairCommitted = false;
fs.linkSync = (source, target) => {
  if (${JSON.stringify(failureMode)} === 'journal-unlink-and-restore'
      && String(source).endsWith('.previous-output')) {
    throw Object.assign(new Error('injected restore failure'), { code: 'EACCES' });
  }
  const result = linkSync(source, target);
  if (String(source).endsWith('delivery-provenance.json')) pairCommitted = true;
  return result;
};
fs.lstatSync = (file, ...args) => {
  if (${JSON.stringify(failureMode)} === 'journal-read'
      && pairCommitted && String(file) === ${JSON.stringify(deliveryPendingPath(out))}) {
    throw Object.assign(new Error('injected journal finalization failure'), { code: 'EACCES' });
  }
  return lstatSync(file, ...args);
};
fs.renameSync = (source, target) => {
  if (${JSON.stringify(failureMode)} !== 'journal-read'
      && pairCommitted
      && String(source) === ${JSON.stringify(deliveryPendingPath(out))}
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    throw Object.assign(new Error('injected journal finalization failure'), { code: 'EACCES' });
  }
  return renameSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacement)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
    const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.stage, 'commit');
    assert.equal(fs.existsSync(deliveryPendingPath(out)), true);
    if (failureMode !== 'journal-unlink') {
      assert.equal(
        receipt.diagnostics[0].code,
        failureMode === 'journal-read'
          ? 'delivery/ownership-lost'
          : 'delivery/commit-recovery-required',
      );
      const recoveryDiagnostic = receipt.diagnostics.find(
        ({ code }) => code === 'delivery/commit-recovery-required',
      );
      assert.ok(recoveryDiagnostic);
      const evidence = recoveryDiagnostic.evidence;
      assert.equal(evidence.recoveryRequired, true);
      const backup = evidence.recoverableBackups.find((entry) => entry.label === 'HTML artifact');
      assert.ok(backup);
      assert.equal(sha256(backup.path), previousHash);
      assert.equal(run(['check', out, '--require-provenance']).status, 1);
      return;
    } else {
      assert.equal(receipt.diagnostics[0].code, 'delivery/commit');
      assert.equal(sha256(out), previousHash);
      assert.equal(run(['check', out, '--require-provenance']).status, 1);
    }
    const retry = run(['deliver', 'workflow', replacement, out, '--json']);
    assert.equal(retry.status, 0, retry.stderr || retry.stdout);
    assert.equal(run(['check', out, '--require-provenance']).status, 0);
  });
}

test('cli: delivery pair rollback retains recoverable backups when restoration fails', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-pair-recovery-required.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const physicalOut = fs.realpathSync.native(out);
  const priorArtifact = fs.readFileSync(out);

  const wrapper = path.join(tmp, 'fail-delivery-rollback-restore.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const linkSync = fs.linkSync;
fs.linkSync = (source, target) => {
  if (String(source).endsWith('delivery-provenance.json')) {
    const error = new Error('injected provenance link failure');
    error.code = 'EACCES';
    throw error;
  }
  if (String(source).endsWith('.previous-output') && String(target) === ${JSON.stringify(physicalOut)}) {
    const error = new Error('injected output restore failure');
    error.code = 'EACCES';
    throw error;
  }
  return linkSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  const evidence = failure.diagnostics[0].evidence;
  assert.equal(evidence.recoveryRequired, true);
  assert.match(result.stderr, /Recovery required: delivery backups were retained/);
  assert.equal(fs.existsSync(evidence.recoveryDirectory), true);
  const outputBackup = evidence.recoverableBackups.find((entry) => (
    entry.label === 'HTML artifact'
    || entry.label === 'unverified preserved backup entry for HTML artifact'
  ));
  assert.ok(outputBackup);
  assert.deepEqual(fs.readFileSync(outputBackup.path), priorArtifact);
});

test('cli: delivery pair rollback retains backups when recovery-path inspection fails', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-pair-recovery-inspection-failure.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const physicalOut = fs.realpathSync.native(out);
  const priorArtifact = fs.readFileSync(out);

  const wrapper = path.join(tmp, 'fail-delivery-recovery-inspection.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const linkSync = fs.linkSync;
const lstatSync = fs.lstatSync;
let provenanceCommitFailed = false;
fs.linkSync = (source, target) => {
  if (String(source).endsWith('delivery-provenance.json')) {
    provenanceCommitFailed = true;
    const error = new Error('injected provenance link failure');
    error.code = 'EACCES';
    throw error;
  }
  return linkSync(source, target);
};
fs.lstatSync = (target, options) => {
  if (provenanceCommitFailed && String(target).endsWith('.previous-output')) {
    const error = new Error('injected recovery inspection failure');
    error.code = 'EACCES';
    throw error;
  }
  return lstatSync(target, options);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  const evidence = failure.diagnostics[0].evidence;
  assert.equal(evidence.recoveryRequired, true);
  assert.match(result.stderr, /Recovery required: delivery backups were retained/);
  assert.equal(fs.existsSync(evidence.recoveryDirectory), true);
  const outputBackup = evidence.recoverableBackups.find((entry) => (
    entry.label === 'HTML artifact'
    || entry.label === 'unverified preserved backup entry for HTML artifact'
  ));
  assert.ok(outputBackup);
  assert.deepEqual(fs.readFileSync(outputBackup.path), priorArtifact);
});

test('cli: portable delivery lock: a process exit requires explicit stale-lock recovery before rerun', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'interrupted-delivery-pair.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const initialSha256 = sha256(out);
  const pendingPath = deliveryPendingPath(out);

  const wrapper = path.join(tmp, 'interrupt-after-journal.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const unlinkSync = fs.unlinkSync;
fs.unlinkSync = (target, ...args) => {
  const result = unlinkSync(target, ...args);
  const parent = path.dirname(String(target));
  const retirementDirectory = path.basename(parent).startsWith('.archify-provenance-')
    || (path.basename(parent).startsWith('.archify-remove-')
      && path.basename(path.dirname(parent)).startsWith('.archify-provenance-'));
  if (path.basename(String(target)) === ${JSON.stringify(path.basename(pendingPath))}
      && retirementDirectory) {
    process.exit(86);
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const interrupted = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(interrupted.status, 86);
  assert.equal(sha256(out), initialSha256);
  const lockPath = deliveryLockPath(out);
  const legacyLockPath = legacyDeliveryLockPath(out);
  const provenancePath = deliveryProvenancePath(out);
  assert.equal(fs.existsSync(pendingPath), true);
  assert.equal(fs.existsSync(legacyLockPath), true);
  for (const args of [
    ['check', out],
    ['check', out, '--require-provenance'],
  ]) {
    const checked = run(args);
    assert.equal(checked.status, 1, checked.stderr || checked.stdout);
    assertCheckFailureReceipt(
      JSON.parse(checked.stdout),
      out,
      /^delivery\/provenance-failed$/,
    );
  }

  const artifactBeforeRecovery = fs.readFileSync(out);
  const pendingBeforeRecovery = fs.readFileSync(pendingPath);
  const lockBeforeRecovery = fs.readFileSync(lockPath);
  const provenanceExisted = fs.existsSync(provenancePath);
  const provenanceBeforeRecovery = provenanceExisted ? fs.readFileSync(provenancePath) : undefined;
  const rejected = run(['deliver', 'workflow', replacementInput, out, '--json']);
  assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
  assert.equal(JSON.parse(rejected.stdout).diagnostics[0].code, 'delivery/lock-stale');
  assert.deepEqual(fs.readFileSync(out), artifactBeforeRecovery);
  assert.deepEqual(fs.readFileSync(pendingPath), pendingBeforeRecovery);
  assert.deepEqual(fs.readFileSync(lockPath), lockBeforeRecovery);
  assert.equal(fs.existsSync(provenancePath), provenanceExisted);
  if (provenanceExisted) assert.deepEqual(fs.readFileSync(provenancePath), provenanceBeforeRecovery);

  // Manual recovery is deliberately outside the delivery protocol: after
  // confirming the recorded PID exited, remove each reported stale lock.
  fs.unlinkSync(lockPath);
  const legacyRejected = run(['deliver', 'workflow', replacementInput, out, '--json']);
  assert.equal(legacyRejected.status, 1, legacyRejected.stderr || legacyRejected.stdout);
  assert.equal(JSON.parse(legacyRejected.stdout).diagnostics[0].code, 'delivery/lock-stale');
  assert.equal(JSON.parse(legacyRejected.stdout).diagnostics[0].subject.lock, legacyLockPath);
  assert.equal(fs.existsSync(provenancePath), provenanceExisted);
  if (provenanceExisted) assert.deepEqual(fs.readFileSync(provenancePath), provenanceBeforeRecovery);
  fs.unlinkSync(legacyLockPath);
  const recovered = run(['deliver', 'workflow', replacementInput, out, '--json']);
  assert.equal(recovered.status, 0, recovered.stderr || recovered.stdout);
  assert.equal(fs.existsSync(deliveryPendingPath(out)), false);
  for (const args of [
    ['check', out],
    ['check', out, '--require-provenance'],
  ]) {
    const checked = run(args);
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    assert.equal(JSON.parse(checked.stdout).provenance, 'current');
  }
});

test('cli: concurrent deliveries cannot replace the active attempt ownership', async (t) => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'concurrent-delivery.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const ready = path.join(tmp, 'concurrent-delivery.ready');
  const release = path.join(tmp, 'concurrent-delivery.release');
  const wrapper = path.join(tmp, 'hold-active-delivery.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const writeFileSync = fs.writeFileSync;
fs.writeFileSync = (file, value, options) => {
  const result = writeFileSync(file, value, options);
  if (String(file).endsWith('specification.snapshot.json')) {
    writeFileSync(${JSON.stringify(ready)}, 'ready');
    while (!fs.existsSync(${JSON.stringify(release)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const active = spawn(process.execPath, [wrapper], { cwd: skillRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  const activeExitPromise = new Promise((resolve) => {
    active.once('close', (code, signal) => resolve({ code, signal }));
  });
  t.after(() => {
    if (!fs.existsSync(release)) fs.writeFileSync(release, 'release');
    if (active.exitCode === null && active.signalCode === null) active.kill();
  });
  let activeStdout = '';
  let activeStderr = '';
  active.stdout.on('data', (chunk) => { activeStdout += chunk; });
  active.stderr.on('data', (chunk) => { activeStderr += chunk; });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(ready) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.existsSync(ready), true, 'active delivery did not reach the overlap point');

  const rejected = run(['deliver', 'workflow', initialInput, out, '--json']);
  assert.equal(rejected.status, 1);
  const rejection = JSON.parse(rejected.stdout);
  assert.equal(rejection.diagnostics[0].code, 'delivery/concurrent-attempt');
  assert.equal('provenance' in rejection, false);

  fs.writeFileSync(release, 'release');
  const activeExit = await activeExitPromise;
  assert.deepEqual(activeExit, { code: 0, signal: null }, activeStderr);
  const activeReceipt = JSON.parse(activeStdout);
  const provenance = JSON.parse(fs.readFileSync(deliveryProvenancePath(out), 'utf8'));
  assert.equal(provenance.status, 'current');
  assert.equal(provenance.receiptId, activeReceipt.receiptId);
  assert.equal(fs.existsSync(deliveryLockPath(out)), false);
});

test('cli: a pre-lock failure cannot replace an active delivery attempt', async (t) => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'concurrent-pre-lock-failure.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const initialProvenance = fs.readFileSync(deliveryProvenancePath(out), 'utf8');
  const ready = path.join(tmp, 'concurrent-pre-lock-failure.ready');
  const release = path.join(tmp, 'concurrent-pre-lock-failure.release');
  const activeWrapper = path.join(tmp, 'hold-active-pre-lock-delivery.mjs');
  fs.writeFileSync(activeWrapper, `
import fs from 'node:fs';
const writeFileSync = fs.writeFileSync;
fs.writeFileSync = (file, value, options) => {
  const result = writeFileSync(file, value, options);
  if (String(file).endsWith('specification.snapshot.json')) {
    writeFileSync(${JSON.stringify(ready)}, 'ready');
    while (!fs.existsSync(${JSON.stringify(release)})) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const active = spawn(process.execPath, [activeWrapper], { cwd: skillRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  const activeExitPromise = new Promise((resolve) => {
    active.once('close', (code, signal) => resolve({ code, signal }));
  });
  t.after(() => {
    if (!fs.existsSync(release)) fs.writeFileSync(release, 'release');
    if (active.exitCode === null && active.signalCode === null) active.kill();
  });
  let activeStdout = '';
  let activeStderr = '';
  active.stdout.on('data', (chunk) => { activeStdout += chunk; });
  active.stderr.on('data', (chunk) => { activeStderr += chunk; });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(ready) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.existsSync(ready), true, 'active delivery did not reach the overlap point');
  const activePending = fs.readFileSync(deliveryPendingPath(out), 'utf8');

  const failingWrapper = path.join(tmp, 'fail-before-delivery-lock.mjs');
  fs.writeFileSync(failingWrapper, `
import fs from 'node:fs';
const mkdtempSync = fs.mkdtempSync;
fs.mkdtempSync = (prefix, options) => {
  if (String(prefix).endsWith('.archify-delivery-')) {
    const error = new Error('injected candidate setup failure');
    error.code = 'EACCES';
    throw error;
  }
  return mkdtempSync(prefix, options);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(initialInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const rejected = spawnSync(process.execPath, [failingWrapper], { cwd: skillRoot, encoding: 'utf8' });
  const rejection = JSON.parse(rejected.stdout);
  const pendingAfterRejection = fs.readFileSync(deliveryPendingPath(out), 'utf8');
  const provenanceAfterRejection = fs.readFileSync(deliveryProvenancePath(out), 'utf8');

  fs.writeFileSync(release, 'release');
  const activeExit = await activeExitPromise;

  assert.equal(rejected.status, 1);
  assert.equal(rejection.diagnostics[0].code, 'delivery/concurrent-attempt');
  assert.equal('provenance' in rejection, false);
  assert.equal(pendingAfterRejection, activePending);
  assert.equal(provenanceAfterRejection, initialProvenance);
  assert.deepEqual(activeExit, { code: 0, signal: null }, activeStderr);
  assert.equal(JSON.parse(activeStdout).ok, true);
});

test('cli: portable delivery lock: a stale entry is preserved when a pre-lock failure is reported', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'stale-lock-pre-lock-failure.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(out);
  const provenancePath = deliveryProvenancePath(out);
  const provenanceBefore = fs.readFileSync(provenancePath);
  const lockPath = deliveryLockPath(out);
  const stagingBefore = deliveryStagingEntries(path.dirname(out));
  const exited = spawnSync(process.execPath, ['-e', '']);
  assert.equal(exited.status, 0);
  const staleLock = `${JSON.stringify({
    schemaVersion: 1,
    receiptId: '00000000-0000-4000-8000-000000000000',
    pid: exited.pid,
  })}\n`;
  fs.writeFileSync(lockPath, staleLock);
  const wrapper = path.join(tmp, 'fail-after-stale-delivery-lock.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const mkdtempSync = fs.mkdtempSync;
fs.mkdtempSync = (prefix, options) => {
  if (String(prefix).endsWith('.archify-delivery-')) {
    const error = new Error('injected candidate setup failure');
    error.code = 'EACCES';
    throw error;
  }
  return mkdtempSync(prefix, options);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/lock-stale');
  assert.equal('provenance' in receipt, false);
  assert.equal(receipt.diagnostics[0].subject.output, fs.realpathSync.native(out));
  assert.equal(receipt.diagnostics[0].subject.lock, lockPath);
  assert.equal(receipt.diagnostics[0].evidence.pid, exited.pid);
  assert.equal(receipt.diagnostics[0].evidence.receiptId, '00000000-0000-4000-8000-000000000000');
  assert.ok(receipt.diagnostics[0].supportedFixes.some((fix) => /confirm no delivery attempt is active/i.test(fix)));
  assert.ok(receipt.diagnostics[0].supportedFixes.some((fix) => fix.includes(lockPath)));
  assert.deepEqual(fs.readFileSync(out), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenancePath), provenanceBefore);
  assert.equal(fs.existsSync(deliveryPendingPath(out)), false);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), staleLock);
  assert.deepEqual(
    deliveryStagingEntries(path.dirname(out)),
    stagingBefore,
  );
});

test('cli: portable delivery lock: simultaneous stale-lock contenders both fail closed', async (t) => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'simultaneous-stale-lock-contenders.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(out);
  const provenancePath = deliveryProvenancePath(out);
  const provenanceBefore = fs.readFileSync(provenancePath);
  const lockPath = deliveryLockPath(out);
  const stagingBefore = deliveryStagingEntries(path.dirname(out));
  const exited = spawnSync(process.execPath, ['-e', '']);
  assert.equal(exited.status, 0);
  const staleLock = `${JSON.stringify({
    schemaVersion: 1,
    receiptId: '00000000-0000-4000-8000-000000000000',
    pid: exited.pid,
  })}\n`;
  fs.writeFileSync(lockPath, staleLock);
  const release = path.join(tmp, 'release-stale-lock-contenders');

  const contenders = ['a', 'b'].map((label) => {
    const ready = path.join(tmp, `stale-lock-contender-${label}.ready`);
    const wrapper = path.join(tmp, `stale-lock-contender-${label}.mjs`);
    fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const processKill = process.kill.bind(process);
process.kill = (pid, signal) => {
  if (pid === ${JSON.stringify(exited.pid)} && signal === 0) {
    fs.writeFileSync(${JSON.stringify(ready)}, 'ready');
    while (!fs.existsSync(${JSON.stringify(release)})) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
    throw Object.assign(new Error('No such process'), { code: 'ESRCH' });
  }
  return processKill(pid, signal);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
    const child = spawn(process.execPath, [wrapper], { cwd: skillRoot, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const exitedPromise = new Promise((resolve) => {
      child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    });
    return { child, ready, exitedPromise };
  });
  t.after(() => {
    if (!fs.existsSync(release)) fs.writeFileSync(release, 'release');
    for (const { child } of contenders) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
  });

  const deadline = Date.now() + 5000;
  while (contenders.some(({ ready }) => !fs.existsSync(ready)) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(contenders.every(({ ready }) => fs.existsSync(ready)), true, 'both contenders did not inspect the stale lock');
  fs.writeFileSync(release, 'release');
  const results = await Promise.all(contenders.map(({ exitedPromise }) => exitedPromise));

  for (const result of results) {
    assert.deepEqual({ code: result.code, signal: result.signal }, { code: 1, signal: null }, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.diagnostics[0].code, 'delivery/lock-stale');
    assert.equal('provenance' in receipt, false);
  }
  assert.deepEqual(fs.readFileSync(out), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenancePath), provenanceBefore);
  assert.equal(fs.existsSync(deliveryPendingPath(out)), false);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), staleLock);
  assert.deepEqual(
    deliveryStagingEntries(path.dirname(out)),
    stagingBefore,
  );
});

test('cli: portable delivery lock: lost ownership prevents failure provenance writes', () => {
  const validInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const invalidInput = path.join(tmp, 'lost-delivery-ownership.workflow.json');
  const invalid = JSON.parse(fs.readFileSync(validInput, 'utf8'));
  invalid.nodes[0].unexpected = true;
  fs.writeFileSync(invalidInput, JSON.stringify(invalid));
  const out = path.join(tmp, 'lost-delivery-ownership.html');
  assert.equal(run(['deliver', 'workflow', validInput, out, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(out);
  const provenancePath = deliveryProvenancePath(out);
  const provenanceBefore = fs.readFileSync(provenancePath);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successorReceiptId = '11111111-1111-4111-8111-111111111111';
  const successorLock = `${JSON.stringify({
    schemaVersion: 1,
    receiptId: successorReceiptId,
    pid: process.pid,
  })}\n`;
  const successorProvenance = `${JSON.stringify({
    schemaVersion: 1,
    receiptId: successorReceiptId,
    status: 'failed',
    command: 'deliver',
    stage: 'successor',
    input: path.resolve(validInput),
    output: path.resolve(out),
    error: 'successor owns this failure record',
  }, null, 2)}\n`;
  const wrapper = path.join(tmp, 'lose-delivery-ownership.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const linkSync = fs.linkSync;
const renameSync = fs.renameSync;
const writeFileSync = fs.writeFileSync;
let replaced = false;
fs.linkSync = (source, target) => {
  const result = linkSync(source, target);
  if (!replaced && String(target) === ${JSON.stringify(pendingPath)}
      && path.basename(path.dirname(String(source))).startsWith('.archify-provenance-')) {
    replaced = true;
    renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.lost-owner`)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successorLock)});
    writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successorProvenance)});
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(invalidInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.ok, false);
  assert.ok(receipt.diagnostics.some((entry) => entry.code === 'delivery/ownership-lost'));
  assert.ok(!('provenance' in receipt) || receipt.provenance === 'unrecorded');
  assert.deepEqual(fs.readFileSync(out), artifactBefore);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successorProvenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successorLock);
  assert.equal(JSON.parse(fs.readFileSync(pendingPath, 'utf8')).receiptId, receipt.receiptId);
});

test('cli: portable delivery lock: failure provenance ownership loss reports retained recovery state', () => {
  const validInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const invalidInput = path.join(tmp, 'failure-provenance-ownership-loss.workflow.json');
  const invalid = JSON.parse(fs.readFileSync(validInput, 'utf8'));
  invalid.nodes[0].unexpected = true;
  fs.writeFileSync(invalidInput, JSON.stringify(invalid));
  const out = path.join(tmp, 'failure-provenance-ownership-loss.html');
  assert.equal(run(['deliver', 'workflow', validInput, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '15151515-1515-4515-8515-151515151515',
    input: validInput,
    output: out,
  });
  const wrapper = path.join(tmp, 'failure-provenance-ownership-loss.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
let successorInstalled = false;
fs.writeFileSync = (file, ...args) => {
  const result = writeFileSync(file, ...args);
  if (!successorInstalled
      && path.basename(String(file)) === ${JSON.stringify(path.basename(provenancePath))}
      && path.basename(path.dirname(String(file))).startsWith('.archify-provenance-')) {
    successorInstalled = true;
    renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owner-a`)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successor.lock)}, { flag: 'wx' });
    writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)});
    writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successor.provenance)});
    writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(successor.artifact)});
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(invalidInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/ownership-lost');
  assert.ok(!('provenance' in receipt) || receipt.provenance === 'unrecorded');
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  assert.equal(fs.existsSync(receipt.diagnostics[0].evidence.recoveryDirectory), true);
  assert.deepEqual(receipt.diagnostics[0].evidence.recoverableBackups, []);
  assert.match(failed.stderr, /Recovery required: delivery backups were retained/);
  assert.equal(fs.readFileSync(out, 'utf8'), successor.artifact);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
});

test('cli: portable delivery lock: journal creation cannot overwrite a successor', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'lost-ownership-before-journal-rename.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '12121212-1212-4212-8212-121212121212',
    input,
    output: out,
  });
  const wrapper = path.join(tmp, 'lose-ownership-before-journal-rename.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
let replaced = false;
fs.writeFileSync = (file, ...args) => {
  const result = writeFileSync(file, ...args);
  if (!replaced && path.basename(String(file)) === ${JSON.stringify(path.basename(pendingPath))}
      && path.basename(path.dirname(String(file))).startsWith('.archify-provenance-')) {
    replaced = true;
    renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owner-a`)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successor.lock)}, { flag: 'wx' });
    writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)}, { flag: 'wx' });
    writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successor.provenance)});
    writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(successor.artifact)});
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/ownership-lost');
  assert.equal('provenance' in receipt, false);
  assert.equal(fs.readFileSync(out, 'utf8'), successor.artifact);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
});

test('cli: portable delivery lock: journal publish preserves a final-window claimant', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'journal-final-window-claimant.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(out);
  const provenancePath = deliveryProvenancePath(out);
  const provenanceBefore = fs.readFileSync(provenancePath);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const claimant = '{"claimant":"journal-final-window"}\n';
  const identityFile = path.join(tmp, 'journal-final-window-identity.json');
  const priorJournalStaging = fs.readdirSync(path.dirname(out))
    .filter((name) => name.startsWith('.archify-provenance-'))
    .sort();
  const wrapper = path.join(tmp, 'journal-final-window-claimant.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const linkSync = fs.linkSync;
let injected = false;
fs.linkSync = (source, target) => {
  if (!injected && String(target) === ${JSON.stringify(pendingPath)}
      && path.basename(path.dirname(String(source))).startsWith('.archify-provenance-')) {
    injected = true;
    fs.writeFileSync(target, ${JSON.stringify(claimant)}, { flag: 'wx' });
    const identity = fs.lstatSync(target, { bigint: true });
    fs.writeFileSync(${JSON.stringify(identityFile)}, JSON.stringify({ dev: String(identity.dev), ino: String(identity.ino) }));
  }
  return linkSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/journal-recovery-required');
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  assert.match(receipt.diagnostics[0].evidence.reason, /target-claimed-during-publish/);
  assert.equal('recoveryDirectory' in receipt.diagnostics[0].evidence, false);
  assert.equal('recoveryFiles' in receipt.diagnostics[0].evidence, false);
  assert.ok(!('provenance' in receipt) || receipt.provenance === 'unrecorded');
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), claimant);
  const currentIdentity = fs.lstatSync(pendingPath, { bigint: true });
  assert.deepEqual(
    { dev: String(currentIdentity.dev), ino: String(currentIdentity.ino) },
    JSON.parse(fs.readFileSync(identityFile, 'utf8')),
  );
  assert.deepEqual(fs.readFileSync(out), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenancePath), provenanceBefore);
  assert.equal(fs.existsSync(lockPath), true);
  assert.deepEqual(
    fs.readdirSync(path.dirname(out))
      .filter((name) => name.startsWith('.archify-provenance-'))
      .sort(),
    priorJournalStaging,
  );
});

test('cli: portable delivery lock: journal candidate retirement preserves a replacement claimant', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'journal-candidate-retirement-claimant.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const pendingPath = deliveryPendingPath(out);
  const candidateName = path.basename(pendingPath);
  const claimant = '{"claimant":"journal candidate retirement"}\n';
  const claimantIdentityFile = path.join(tmp, 'journal-candidate-retirement-identity.json');
  const displacedCandidate = path.join(tmp, 'journal-candidate-retirement-displaced');
  const priorStaging = fs.readdirSync(path.dirname(out))
    .filter((name) => name.startsWith('.archify-provenance-'))
    .sort();
  const wrapper = path.join(tmp, 'replace-journal-candidate-at-retirement.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const unlinkSync = fs.unlinkSync;
const renameSync = fs.renameSync;
const writeFileSync = fs.writeFileSync;
let replaced = false;
const isCandidate = (file) => (
  path.basename(String(file)) === ${JSON.stringify(candidateName)}
  && path.basename(path.dirname(String(file))).startsWith('.archify-provenance-')
);
const replaceCandidate = (file) => {
  replaced = true;
  renameSync(file, ${JSON.stringify(displacedCandidate)});
  writeFileSync(file, ${JSON.stringify(claimant)}, { flag: 'wx' });
  const stat = fs.lstatSync(file, { bigint: true });
  writeFileSync(${JSON.stringify(claimantIdentityFile)}, JSON.stringify({
    dev: String(stat.dev),
    ino: String(stat.ino),
  }));
};
fs.unlinkSync = (file, ...args) => {
  if (!replaced && isCandidate(file)) replaceCandidate(file);
  return unlinkSync(file, ...args);
};
fs.renameSync = (source, target, ...args) => {
  if (!replaced
      && isCandidate(source)
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    replaceCandidate(source);
  }
  return renameSync(source, target, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const staging = fs.readdirSync(path.dirname(out))
    .filter((name) => name.startsWith('.archify-provenance-'))
    .filter((name) => !priorStaging.includes(name));
  assert.equal(staging.length, 1, failed.stderr || failed.stdout);
  const candidate = path.join(path.dirname(out), staging[0], candidateName);
  assert.equal(fs.readFileSync(candidate, 'utf8'), claimant);
  const claimantIdentity = fs.lstatSync(candidate, { bigint: true });
  assert.deepEqual(
    { dev: String(claimantIdentity.dev), ino: String(claimantIdentity.ino) },
    JSON.parse(fs.readFileSync(claimantIdentityFile, 'utf8')),
  );
  assert.equal(fs.existsSync(displacedCandidate), true);
});

test('cli: portable delivery lock: failed journal restore retains the previous journal and claimant', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'journal-restore-claimant.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(out);
  const provenancePath = deliveryProvenancePath(out);
  const provenanceBefore = fs.readFileSync(provenancePath);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const previousJournal = '{"previous":"delivery journal"}\n';
  fs.writeFileSync(pendingPath, previousJournal, { flag: 'wx' });
  const previousIdentity = fs.lstatSync(pendingPath, { bigint: true });
  const claimant = '{"claimant":"blocks journal restore"}\n';
  const claimantIdentityFile = path.join(tmp, 'journal-restore-claimant-identity.json');
  const wrapper = path.join(tmp, 'journal-restore-claimant.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const linkSync = fs.linkSync;
let injected = false;
fs.linkSync = (source, target) => {
  if (!injected && String(target) === ${JSON.stringify(pendingPath)}
      && path.basename(path.dirname(String(source))).startsWith('.archify-provenance-')) {
    injected = true;
    fs.writeFileSync(target, ${JSON.stringify(claimant)}, { flag: 'wx' });
    const identity = fs.lstatSync(target, { bigint: true });
    fs.writeFileSync(${JSON.stringify(claimantIdentityFile)}, JSON.stringify({ dev: String(identity.dev), ino: String(identity.ino) }));
  }
  return linkSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  const recovery = receipt.diagnostics[0];
  assert.equal(recovery.code, 'delivery/journal-recovery-required');
  assert.equal(recovery.evidence.recoveryRequired, true);
  assert.match(recovery.evidence.rollbackErrors.join('\n'), /previous journal restore failed/);
  assert.match(recovery.evidence.rollbackErrors.join('\n'), /claimant prevents restoring/);
  assert.equal(fs.existsSync(recovery.evidence.recoveryDirectory), true);
  assert.equal(recovery.evidence.recoveryFiles.length, 1);
  const [previous] = recovery.evidence.recoveryFiles;
  assert.equal(previous.label, 'previous delivery journal');
  assert.equal(previous.target, pendingPath);
  assert.equal(fs.readFileSync(previous.path, 'utf8'), previousJournal);
  const retainedIdentity = fs.lstatSync(previous.path, { bigint: true });
  assert.deepEqual(
    { dev: retainedIdentity.dev, ino: retainedIdentity.ino },
    { dev: previousIdentity.dev, ino: previousIdentity.ino },
  );
  assert.deepEqual(fs.readdirSync(recovery.evidence.recoveryDirectory), ['.previous-journal']);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), claimant);
  const claimantIdentity = fs.lstatSync(pendingPath, { bigint: true });
  assert.deepEqual(
    { dev: String(claimantIdentity.dev), ino: String(claimantIdentity.ino) },
    JSON.parse(fs.readFileSync(claimantIdentityFile, 'utf8')),
  );
  assert.deepEqual(fs.readFileSync(out), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenancePath), provenanceBefore);
  assert.equal(fs.existsSync(lockPath), true);
  const retry = run(['deliver', 'workflow', input, out, '--json']);
  assert.equal(retry.status, 1, retry.stderr || retry.stdout);
  assert.equal(JSON.parse(retry.stdout).diagnostics[0].code, 'delivery/lock-stale');
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), claimant);
  assert.equal(fs.readFileSync(previous.path, 'utf8'), previousJournal);
});

test('cli: portable delivery lock: an unverifiable new journal fails safely', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'unverifiable-new-journal.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(out);
  const provenancePath = deliveryProvenancePath(out);
  const provenanceBefore = fs.readFileSync(provenancePath);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const wrapper = path.join(tmp, 'unverifiable-new-journal.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const lstatSync = fs.lstatSync;
let injected = false;
fs.lstatSync = (file, ...args) => {
  if (!injected && String(file) === ${JSON.stringify(pendingPath)} && fs.existsSync(file)) {
    injected = true;
    throw Object.assign(new Error('injected journal identity failure'), { code: 'EACCES' });
  }
  return lstatSync(file, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/journal-write');
  assert.match(
    receipt.diagnostics[0].evidence.reason,
    /delivery-journal-candidate-handle-verification-failed/,
  );
  assert.equal(receipt.provenance, 'failed');
  assert.deepEqual(fs.readFileSync(out), artifactBefore);
  assert.notDeepEqual(fs.readFileSync(provenancePath), provenanceBefore);
  assert.equal(JSON.parse(fs.readFileSync(provenancePath, 'utf8')).status, 'failed');
  assert.equal(fs.existsSync(pendingPath), true);
  assert.equal(fs.existsSync(lockPath), false);
});

for (const removalRole of ['journal', 'lock']) {
  test(`cli: delivery preserves a ${removalRole} successor swapped at final public removal`, () => {
    const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
    const out = path.join(tmp, `final-remove-${removalRole}.html`);
    assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
    const publicPath = removalRole === 'journal' ? deliveryPendingPath(out) : deliveryLockPath(out);
    const displacedOwner = path.join(tmp, `final-remove-${removalRole}-owner`);
    const successor = `${JSON.stringify({
      schemaVersion: 1,
      receiptId: '56565656-5656-4656-8656-565656565656',
      pid: process.pid,
      role: removalRole,
    })}\n`;
    const identityFile = path.join(tmp, `final-remove-${removalRole}-identity.json`);
    const wrapper = path.join(tmp, `final-remove-${removalRole}.mjs`);
    fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const renameSync = fs.renameSync;
let injected = false;
fs.renameSync = (source, target) => {
  if (!injected && String(source) === ${JSON.stringify(publicPath)}
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    injected = true;
    renameSync(source, ${JSON.stringify(displacedOwner)});
    fs.writeFileSync(source, ${JSON.stringify(successor)}, { flag: 'wx' });
    const identity = fs.lstatSync(source, { bigint: true });
    fs.writeFileSync(${JSON.stringify(identityFile)}, JSON.stringify({ dev: String(identity.dev), ino: String(identity.ino) }));
  }
  return renameSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

    const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
    assert.equal(failed.status, 1, failed.stderr || failed.stdout);
    const receipt = JSON.parse(failed.stdout);
    assert.equal(
      receipt.diagnostics.some((entry) => entry.code === (
        removalRole === 'journal'
          ? 'delivery/commit-recovery-required'
          : 'delivery/ownership-lost'
      )),
      true,
    );
    assert.equal(fs.readFileSync(publicPath, 'utf8'), successor);
    const current = fs.lstatSync(publicPath, { bigint: true });
    assert.deepEqual(
      { dev: String(current.dev), ino: String(current.ino) },
      JSON.parse(fs.readFileSync(identityFile, 'utf8')),
    );
    assert.equal(fs.existsSync(displacedOwner), true);
  });
}

test('cli: portable delivery lock: release loss cannot claim failed provenance', () => {
  const validInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const invalidInput = path.join(tmp, 'release-loss-after-failure.workflow.json');
  const invalid = JSON.parse(fs.readFileSync(validInput, 'utf8'));
  invalid.nodes[0].unexpected = true;
  fs.writeFileSync(invalidInput, JSON.stringify(invalid));
  const out = path.join(tmp, 'release-loss-after-failure.html');
  assert.equal(run(['deliver', 'workflow', validInput, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '13131313-1313-4313-8313-131313131313',
    input: validInput,
    output: out,
  });
  const wrapper = path.join(tmp, 'lose-ownership-after-failure-provenance.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
const linkSync = fs.linkSync;
let replaced = false;
fs.linkSync = (source, target) => {
  const result = linkSync(source, target);
  if (!replaced && String(target) === ${JSON.stringify(provenancePath)}
      && path.basename(path.dirname(String(source))).startsWith('.archify-provenance-')) {
    replaced = true;
    renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owner-a`)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successor.lock)}, { flag: 'wx' });
    writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)});
    renameSync(target, String(target) + '.owner-a');
    writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successor.provenance)});
    writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(successor.artifact)});
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(invalidInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/provenance-recovery-required');
  assert.ok(!('provenance' in receipt) || receipt.provenance === 'unrecorded');
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  assert.equal(fs.existsSync(receipt.diagnostics[0].evidence.recoveryDirectory), true);
  assert.equal(fs.readFileSync(out, 'utf8'), successor.artifact);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
});

test('cli: portable delivery lock: commit entry preserves a successor owner', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'lost-ownership-before-commit.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '22222222-2222-4222-8222-222222222222',
    input: replacementInput,
    output: out,
  });
  const wrapper = path.join(tmp, 'lose-ownership-before-commit.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
let replaced = false;
fs.writeFileSync = (file, ...args) => {
  const result = writeFileSync(file, ...args);
  if (!replaced && path.basename(String(file)) === 'delivery-provenance.json'
      && path.basename(path.dirname(String(file))).startsWith('.archify-delivery-')) {
    replaced = true;
    renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owner-a`)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successor.lock)}, { flag: 'wx' });
    writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)});
    writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successor.provenance)});
    writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(successor.artifact)});
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/ownership-lost');
  assert.equal('provenance' in receipt, false);
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  assert.equal(fs.existsSync(receipt.diagnostics[0].evidence.recoveryDirectory), true);
  assert.match(failed.stderr, /Recovery required: delivery backups were retained/);
  assert.equal(fs.readFileSync(out, 'utf8'), successor.artifact);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
});

test('cli: portable delivery lock: rollback stops after ownership is lost', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'lost-ownership-before-rollback.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const priorArtifact = fs.readFileSync(out);
  const priorProvenance = fs.readFileSync(provenancePath);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '33333333-3333-4333-8333-333333333333',
    input: replacementInput,
    output: out,
  });
  const wrapper = path.join(tmp, 'lose-ownership-before-rollback.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
const linkSync = fs.linkSync;
let replaced = false;
fs.linkSync = (source, target) => {
  if (!replaced && path.basename(String(source)) === 'delivery-provenance.json'
      && path.basename(path.dirname(String(source))).startsWith('.archify-delivery-')) {
    replaced = true;
    renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owner-a`)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successor.lock)}, { flag: 'wx' });
    writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)});
    writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successor.provenance)});
    writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(successor.artifact)});
    throw Object.assign(new Error('injected provenance commit failure'), { code: 'EACCES' });
  }
  return linkSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/ownership-lost');
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  assert.equal(receipt.diagnostics[0].evidence.commitError.reason, 'injected provenance commit failure');
  assert.equal(receipt.diagnostics[0].evidence.commitError.systemCode, 'EACCES');
  assert.ok(receipt.diagnostics[0].evidence.recoverableBackups.length >= 1);
  const outputBackup = receipt.diagnostics[0].evidence.recoverableBackups
    .find((entry) => entry.label === 'HTML artifact');
  const provenanceBackup = receipt.diagnostics[0].evidence.recoverableBackups
    .find((entry) => entry.label === 'delivery provenance');
  assert.deepEqual(fs.readFileSync(outputBackup.path), priorArtifact);
  assert.deepEqual(fs.readFileSync(provenanceBackup.path), priorProvenance);
  assert.match(failed.stderr, /Recovery required: delivery backups were retained/);
  assert.equal(fs.readFileSync(out, 'utf8'), successor.artifact);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
});

test('cli: portable delivery lock: finalization preserves a successor owner', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'lost-ownership-before-finalization.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const priorArtifact = fs.readFileSync(out);
  const priorProvenance = fs.readFileSync(provenancePath);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '44444444-4444-4444-8444-444444444444',
    input: replacementInput,
    output: out,
  });
  const wrapper = path.join(tmp, 'lose-ownership-before-finalization.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
const linkSync = fs.linkSync;
let replaced = false;
fs.linkSync = (source, target) => {
  const result = linkSync(source, target);
  if (!replaced && path.basename(String(source)) === 'delivery-provenance.json'
      && path.basename(path.dirname(String(source))).startsWith('.archify-delivery-')) {
    replaced = true;
    renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owner-a`)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successor.lock)}, { flag: 'wx' });
    writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)});
    writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successor.provenance)});
    writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(successor.artifact)});
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/ownership-lost');
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  const outputBackup = receipt.diagnostics[0].evidence.recoverableBackups
    .find((entry) => entry.label === 'HTML artifact');
  const provenanceBackup = receipt.diagnostics[0].evidence.recoverableBackups
    .find((entry) => entry.label === 'delivery provenance');
  assert.deepEqual(fs.readFileSync(outputBackup.path), priorArtifact);
  assert.deepEqual(fs.readFileSync(provenanceBackup.path), priorProvenance);
  assert.match(failed.stderr, /Recovery required: delivery backups were retained/);
  assert.equal(fs.readFileSync(out, 'utf8'), successor.artifact);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
});

test('cli: portable delivery lock: release preserves a successor owner', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'lost-ownership-before-release.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const priorArtifact = fs.readFileSync(out);
  const priorProvenance = fs.readFileSync(provenancePath);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '55555555-5555-4555-8555-555555555555',
    input: replacementInput,
    output: out,
  });
  const wrapper = path.join(tmp, 'lose-ownership-before-release.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
const lstatSync = fs.lstatSync;
let journalFinalized = false;
let replaced = false;
fs.renameSync = (source, target) => {
  const result = renameSync(source, target);
  if (String(source) === ${JSON.stringify(pendingPath)}
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    journalFinalized = true;
  }
  return result;
};
fs.lstatSync = (file, ...args) => {
  try {
    return lstatSync(file, ...args);
  } catch (error) {
    if (!replaced && journalFinalized && String(file) === ${JSON.stringify(pendingPath)} && error.code === 'ENOENT') {
      replaced = true;
      renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owner-a`)});
      writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successor.lock)}, { flag: 'wx' });
      writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)});
      writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successor.provenance)});
      writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(successor.artifact)});
    }
    throw error;
  }
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.stage, 'release');
  assert.equal(receipt.diagnostics[0].code, 'delivery/ownership-lost');
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  const outputBackup = receipt.diagnostics[0].evidence.recoverableBackups
    .find((entry) => entry.label === 'HTML artifact');
  const provenanceBackup = receipt.diagnostics[0].evidence.recoverableBackups
    .find((entry) => entry.label === 'delivery provenance');
  assert.deepEqual(fs.readFileSync(outputBackup.path), priorArtifact);
  assert.deepEqual(fs.readFileSync(provenanceBackup.path), priorProvenance);
  assert.match(failed.stderr, /Recovery required: delivery backups were retained/);
  assert.equal(fs.readFileSync(out, 'utf8'), successor.artifact);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
});

test('cli: portable delivery lock: release rejects a recreated journal', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'recreated-journal-before-release.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '66666666-6666-4666-8666-666666666666',
    input: replacementInput,
    output: out,
  });
  const wrapper = path.join(tmp, 'recreate-journal-before-release.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
const lstatSync = fs.lstatSync;
let journalFinalized = false;
let postFinalizeLockChecks = 0;
let journalRecreated = false;
fs.renameSync = (source, target) => {
  const result = renameSync(source, target);
  if (String(source) === ${JSON.stringify(pendingPath)}
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    journalFinalized = true;
  }
  return result;
};
fs.lstatSync = (file, ...args) => {
  if (journalFinalized && String(file) === ${JSON.stringify(lockPath)}) {
    postFinalizeLockChecks += 1;
    if (postFinalizeLockChecks === 2) {
      writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)}, { flag: 'wx' });
      journalRecreated = true;
    }
  }
  if (journalRecreated && String(file).includes('.previous-')) {
    throw Object.assign(new Error('injected recovery backup inspection failure'), { code: 'EACCES' });
  }
  return lstatSync(file, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.stage, 'commit');
  assert.equal(receipt.diagnostics[0].code, 'delivery/ownership-lost');
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  assert.ok(receipt.diagnostics[0].evidence.recoverableBackups.length >= 1);
  assert.equal(fs.existsSync(receipt.diagnostics[0].evidence.recoveryDirectory), true);
  assert.equal(fs.existsSync(receipt.diagnostics[0].evidence.recoverableBackups[0].path), true);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
  assert.equal(fs.existsSync(lockPath), true);
  const strict = run(['check', out, '--require-provenance']);
  assert.equal(strict.status, 1, strict.stderr || strict.stdout);
  assert.equal(JSON.parse(strict.stdout).diagnostics[0].code, 'delivery/provenance-failed');
});

test('cli: portable delivery lock: release failure cannot claim delivery success', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-lock-release-failure.html');
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const provenancePath = deliveryProvenancePath(out);
  const wrapper = path.join(tmp, 'delivery-lock-release-failure.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const renameSync = fs.renameSync;
fs.renameSync = (source, target) => {
  if (String(source) === ${JSON.stringify(lockPath)}
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    throw Object.assign(new Error('injected lock release failure'), { code: 'EACCES' });
  }
  return renameSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.stage, 'release');
  assert.equal(receipt.diagnostics[0].code, 'delivery/lock-release');
  assert.equal(fs.existsSync(pendingPath), false);
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  assert.equal(provenance.status, 'current');
  assert.equal(lock.receiptId, provenance.receiptId);
  const strict = run(['check', out, '--require-provenance']);
  assert.equal(strict.status, 1, strict.stderr || strict.stdout);
  assert.equal(JSON.parse(strict.stdout).diagnostics[0].code, 'delivery/provenance-locked');
});

test('cli: portable delivery lock: failure-path release errors override the renderer status', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-failure-lock-release.html');
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const provenancePath = deliveryProvenancePath(out);
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const previousHash = sha256(out);
  const wrapper = path.join(tmp, 'delivery-failure-lock-release.mjs');
  fs.writeFileSync(wrapper, `
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const spawnSync = childProcess.spawnSync;
let rendererFailed = false;
childProcess.spawnSync = (executable, args, options) => {
  if (!rendererFailed && String(args?.[0]).includes('render-workflow.mjs')) {
    rendererFailed = true;
    return { status: 7, stdout: '', stderr: '' };
  }
  return spawnSync(executable, args, options);
};
syncBuiltinESMExports();
const renameSync = fs.renameSync;
fs.renameSync = (source, target) => {
  if (String(source) === ${JSON.stringify(lockPath)}
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    throw Object.assign(new Error('injected failure-path lock release error'), { code: 'EACCES' });
  }
  return renameSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.stage, 'render');
  assert.equal(receipt.provenance, 'failed');
  assert.equal(receipt.diagnostics[0].code, 'delivery/lock-release');
  assert.equal(receipt.diagnostics[1].code, 'internal/unclassified');
  assert.doesNotMatch(receipt.diagnostics[0].message, /committed/i);
  assert.equal(fs.existsSync(lockPath), true);
  assert.equal(fs.existsSync(pendingPath), true);
  assert.equal(JSON.parse(fs.readFileSync(provenancePath, 'utf8')).status, 'failed');
  assert.equal(sha256(out), previousHash);
});

test('cli: portable delivery lock: final cleanup preserves an unexpected primary failure when release also fails', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-unexpected-release-failure.html');
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const wrapper = path.join(tmp, 'delivery-unexpected-release-failure.mjs');
  const stagingBefore = deliveryStagingEntries(path.dirname(out));
  fs.writeFileSync(wrapper, `
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = (executable, args, options) => {
  if (String(args?.[0]).includes('render-workflow.mjs')) {
    throw new Error('injected unexpected renderer dispatch failure');
  }
  return spawnSync(executable, args, options);
};
syncBuiltinESMExports();
const renameSync = fs.renameSync;
fs.renameSync = (source, target) => {
  if (String(source) === ${JSON.stringify(lockPath)}
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    throw Object.assign(new Error('injected final lock release failure'), { code: 'EACCES' });
  }
  return renameSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  assert.match(failed.stderr, /injected unexpected renderer dispatch failure/);
  assert.match(failed.stderr, /\[delivery\/lock-release\]/);
  assert.match(failed.stderr, /injected final lock release failure/);
  assert.equal(fs.existsSync(lockPath), true);
  assert.equal(fs.existsSync(pendingPath), true);
  assert.deepEqual(
    deliveryStagingEntries(path.dirname(out)),
    stagingBefore,
  );
});

test('cli: portable delivery lock: final cleanup preserves successor state after unexpected ownership loss', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-unexpected-ownership-loss.html');
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const provenancePath = deliveryProvenancePath(out);
  const successor = successorDeliveryState({
    receiptId: '16161616-1616-4616-8616-161616161616',
    input,
    output: out,
  });
  const wrapper = path.join(tmp, 'delivery-unexpected-ownership-loss.mjs');
  const stagingBefore = new Set(deliveryStagingEntries(path.dirname(out)));
  fs.writeFileSync(wrapper, `
import childProcess from 'node:child_process';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = (executable, args, options) => {
  if (String(args?.[0]).includes('render-workflow.mjs')) {
    for (const [target, contents] of ${JSON.stringify([
      [lockPath, successor.lock],
      [pendingPath, successor.pending],
      [provenancePath, successor.provenance],
    ])}) {
      if (fs.existsSync(target)) fs.renameSync(target, \`${'${target}'}.owner-a\`);
      fs.writeFileSync(target, contents, { flag: 'wx' });
    }
    throw new Error('injected unexpected failure after successor takeover');
  }
  return spawnSync(executable, args, options);
};
syncBuiltinESMExports();
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  assert.match(failed.stderr, /injected unexpected failure after successor takeover/);
  assert.match(failed.stderr, /\[delivery\/ownership-lost\]/);
  assert.match(failed.stderr, /Recovery required:/);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  const recoveryDirectories = deliveryStagingEntries(path.dirname(out))
    .filter((entry) => !stagingBefore.has(entry));
  assert.equal(recoveryDirectories.length, 1);
  assert.equal(fs.existsSync(path.join(path.dirname(out), recoveryDirectories[0], 'specification.snapshot.json')), true);
});

test('cli: lock release failure does not invoke the requested opener', (t) => {
  if (process.platform === 'win32') {
    t.skip('fake open and xdg-open executables cover POSIX opener dispatch');
    return;
  }
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-lock-release-no-open.html');
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const fake = makeFakeOpeners('delivery-lock-release-no-open');
  const wrapper = path.join(tmp, 'delivery-lock-release-no-open.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const renameSync = fs.renameSync;
fs.renameSync = (source, target) => {
  if (String(source) === ${JSON.stringify(lockPath)}
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    throw Object.assign(new Error('injected lock release failure'), { code: 'EACCES' });
  }
  return renameSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json', '--open'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], {
    cwd: skillRoot,
    encoding: 'utf8',
    env: fake.env,
  });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  assert.equal(JSON.parse(failed.stdout).diagnostics[0].code, 'delivery/lock-release');
  assert.equal(fs.existsSync(fake.log), false);
});

test('cli: delivery cleanup preserves an unexpected claimant in private staging', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-staging-claimant.html');
  const stagingBefore = new Set(deliveryStagingEntries(path.dirname(out)));
  const wrapper = path.join(tmp, 'delivery-staging-claimant.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const rmdirSync = fs.rmdirSync.bind(fs);
let claimed = false;
fs.rmdirSync = (directory, ...args) => {
  if (!claimed && path.basename(String(directory)).startsWith('.archify-delivery-')) {
    claimed = true;
    fs.writeFileSync(path.join(directory, 'unknown-claimant.txt'), 'preserve delivery claimant');
  }
  return rmdirSync(directory, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const delivered = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  assert.equal(JSON.parse(delivered.stdout).ok, true);
  assert.match(delivered.stderr, /Warning: could not remove delivery staging directory/);
  const recoveryRoot = fs.readdirSync(path.dirname(out), { withFileTypes: true })
    .find((entry) => entry.isDirectory() && entry.name.startsWith('.archify-staging-remove-'));
  assert.ok(recoveryRoot);
  const staging = deliveryStagingEntries(path.join(path.dirname(out), recoveryRoot.name))
    .find((entry) => !stagingBefore.has(entry));
  assert.ok(staging);
  assert.equal(
    fs.readFileSync(path.join(
      path.dirname(out),
      recoveryRoot.name,
      staging,
      'unknown-claimant.txt',
    ), 'utf8'),
    'preserve delivery claimant',
  );
});

test('cli: delivery staging cleanup retries transient remote ENOTEMPTY', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const directory = fs.mkdtempSync(path.join(tmp, 'delivery-staging-transient-enotempty-'));
  const out = path.join(directory, 'diagram.html');
  const observation = path.join(directory, 'observation.json');
  const wrapper = path.join(directory, 'inject-enotempty.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const rmdirSync = fs.rmdirSync.bind(fs);
let injected = false;
fs.rmdirSync = (directory, ...args) => {
  if (!injected
      && path.basename(path.dirname(String(directory))).startsWith('.archify-staging-remove-')
      && path.basename(String(directory)).startsWith('.archify-delivery-')) {
    injected = true;
    throw Object.assign(new Error('simulated remote deletion visibility delay'), { code: 'ENOTEMPTY' });
  }
  return rmdirSync(directory, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
fs.writeFileSync(${JSON.stringify(observation)}, JSON.stringify({ injected }));
`);

  const delivered = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  assert.equal(JSON.parse(delivered.stdout).ok, true);
  assert.equal(JSON.parse(fs.readFileSync(observation, 'utf8')).injected, true);
  assert.doesNotMatch(delivered.stderr, /Warning: could not remove delivery staging directory/);
  assert.deepEqual(deliveryStagingEntries(path.dirname(out)), []);
  assert.deepEqual(
    fs.readdirSync(path.dirname(out))
      .filter((entry) => entry.startsWith('.archify-staging-remove-')),
    [],
  );
});

test('cli: delivery staging cleanup retries a stale remote directory listing', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const directory = fs.mkdtempSync(path.join(tmp, 'delivery-staging-stale-listing-'));
  const out = path.join(directory, 'diagram.html');
  const observation = path.join(directory, 'observation.json');
  const wrapper = path.join(directory, 'inject-stale-listing.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const readdirSync = fs.readdirSync.bind(fs);
let injected = false;
fs.readdirSync = (directory, ...args) => {
  if (!injected && path.basename(String(directory)).startsWith('.archify-delivery-')) {
    injected = true;
    return ['recently-deleted-entry.tmp'];
  }
  return readdirSync(directory, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
fs.writeFileSync(${JSON.stringify(observation)}, JSON.stringify({ injected }));
`);

  const delivered = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  assert.equal(JSON.parse(delivered.stdout).ok, true);
  assert.equal(JSON.parse(fs.readFileSync(observation, 'utf8')).injected, true);
  assert.doesNotMatch(delivered.stderr, /Warning: could not remove delivery staging directory/);
  assert.deepEqual(deliveryStagingEntries(path.dirname(out)), []);
});

test('cli: delivery closes every candidate handle before cleaning delete-pending remote entries', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const directory = fs.mkdtempSync(path.join(tmp, 'delivery-remote-open-handles-'));
  const out = path.join(directory, 'diagram.html');
  const observation = path.join(directory, 'observation.json');
  const wrapper = path.join(directory, 'simulate-delete-pending.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const openSync = fs.openSync.bind(fs);
const fstatSync = fs.fstatSync.bind(fs);
const closeSync = fs.closeSync.bind(fs);
const unlinkSync = fs.unlinkSync.bind(fs);
const rmdirSync = fs.rmdirSync.bind(fs);
const handles = new Map();
const pendingDirectories = new Map();
const multiplyBoundFiles = new Set();
const identity = (metadata) => String(metadata.dev) + ':' + String(metadata.ino);
let blockedRemovals = 0;
fs.openSync = (file, ...args) => {
  const descriptor = openSync(file, ...args);
  const metadata = fstatSync(descriptor, { bigint: true });
  if (metadata.isFile()) handles.set(descriptor, {
    identity: identity(metadata), file: path.basename(String(file)),
  });
  return descriptor;
};
fs.closeSync = (descriptor) => {
  const result = closeSync(descriptor);
  handles.delete(descriptor);
  return result;
};
fs.unlinkSync = (file) => {
  const parent = path.dirname(String(file));
  if (path.basename(parent).startsWith('.archify-remove-')) {
    const key = identity(fs.lstatSync(file, { bigint: true }));
    pendingDirectories.set(parent, key);
    const owners = [...handles.values()].filter((owner) => owner.identity === key);
    if (owners.length > 1) owners.forEach((owner) => multiplyBoundFiles.add(owner.file));
  }
  return unlinkSync(file);
};
fs.rmdirSync = (directory, ...args) => {
  const key = pendingDirectories.get(String(directory));
  if (key && [...handles.values()].some((owner) => owner.identity === key)) {
    blockedRemovals += 1;
    throw Object.assign(new Error('remote child deletion waits for all open handles'), { code: 'ENOTEMPTY' });
  }
  const result = rmdirSync(directory, ...args);
  pendingDirectories.delete(String(directory));
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
fs.writeFileSync(${JSON.stringify(observation)}, JSON.stringify({
  blockedRemovals,
  multiplyBoundFiles: [...multiplyBoundFiles],
  remainingHandles: handles.size,
  pendingDirectories: [...pendingDirectories.keys()],
}));
`);

  const delivered = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(delivered.status, 0, delivered.stderr || delivered.stdout);
  assert.equal(JSON.parse(delivered.stdout).ok, true);
  const observed = JSON.parse(fs.readFileSync(observation, 'utf8'));
  assert.ok(observed.blockedRemovals > 0, JSON.stringify(observed));
  assert.ok(observed.multiplyBoundFiles.includes('diagram.html'), JSON.stringify(observed));
  assert.ok(observed.multiplyBoundFiles.includes('delivery-provenance.json'), JSON.stringify(observed));
  assert.equal(observed.remainingHandles, 0);
  assert.deepEqual(observed.pendingDirectories, []);
  assert.equal(delivered.stderr, '');
  assert.deepEqual(fs.readdirSync(directory).filter((name) => name.startsWith('.archify-')), []);
});

test('cli: repeated lock handle identity failures close the descriptor, remove only the owned lock, and permit retry', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-lock-first-fstat.html');
  const lockPath = deliveryLockPath(out);
  const closeEvidence = path.join(tmp, 'delivery-lock-first-fstat-close.json');
  const wrapper = path.join(tmp, 'delivery-lock-first-fstat.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const openSync = fs.openSync;
const fstatSync = fs.fstatSync;
const closeSync = fs.closeSync;
let lockDescriptor;
let injected = 0;
let lockClosed = false;
fs.openSync = (file, ...args) => {
  const descriptor = openSync(file, ...args);
  if (lockDescriptor === undefined && String(file) === ${JSON.stringify(lockPath)}) {
    lockDescriptor = descriptor;
  }
  return descriptor;
};
fs.fstatSync = (descriptor, ...args) => {
  if (descriptor === lockDescriptor && injected < 2) {
    injected += 1;
    throw Object.assign(new Error('injected repeated lock fstat failure'), { code: 'EIO' });
  }
  return fstatSync(descriptor, ...args);
};
fs.closeSync = (descriptor, ...args) => {
  if (descriptor === lockDescriptor) lockClosed = true;
  return closeSync(descriptor, ...args);
};
process.on('exit', () => fs.writeFileSync(${JSON.stringify(closeEvidence)}, JSON.stringify({ lockClosed, injected })));
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  assert.equal(JSON.parse(failed.stdout).diagnostics[0].code, 'delivery/lock-acquire');
  assert.deepEqual(JSON.parse(fs.readFileSync(closeEvidence, 'utf8')), {
    lockClosed: true,
    injected: 2,
  });
  assert.equal(fs.existsSync(lockPath), false, 'failed identity capture leaked the public lock');
  const retry = run(['deliver', 'workflow', input, out, '--json']);
  assert.equal(retry.status, 0, retry.stderr || retry.stdout);
});

test('cli: repeated lock handle identity failures preserve a claimant that replaces the owned entry', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-lock-repeated-fstat-claimant.html');
  const lockPath = deliveryLockPath(out);
  const detachedOwnedLock = `${lockPath}.detached-double-fstat`;
  const closeEvidence = path.join(tmp, 'delivery-lock-repeated-fstat-claimant-close.json');
  const claimant = 'unrelated lock claimant\n';
  const wrapper = path.join(tmp, 'delivery-lock-repeated-fstat-claimant.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const openSync = fs.openSync.bind(fs);
const fstatSync = fs.fstatSync.bind(fs);
const closeSync = fs.closeSync.bind(fs);
const writeFileSync = fs.writeFileSync.bind(fs);
let lockDescriptor;
let injected = 0;
let replaced = false;
let lockClosed = false;
fs.openSync = (file, ...args) => {
  const descriptor = openSync(file, ...args);
  if (lockDescriptor === undefined && String(file) === ${JSON.stringify(lockPath)}) lockDescriptor = descriptor;
  return descriptor;
};
fs.fstatSync = (descriptor, ...args) => {
  if (descriptor === lockDescriptor && injected < 2) {
    injected += 1;
    throw Object.assign(new Error('injected repeated lock fstat failure'), { code: 'EIO' });
  }
  return fstatSync(descriptor, ...args);
};
fs.writeFileSync = (file, ...args) => {
  const result = writeFileSync(file, ...args);
  if (!replaced && file === lockDescriptor) {
    replaced = true;
    fs.renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(detachedOwnedLock)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(claimant)}, { flag: 'wx' });
  }
  return result;
};
fs.closeSync = (descriptor, ...args) => {
  if (descriptor === lockDescriptor) lockClosed = true;
  return closeSync(descriptor, ...args);
};
process.on('exit', () => writeFileSync(${JSON.stringify(closeEvidence)}, JSON.stringify({ lockClosed, injected, replaced })));
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  assert.deepEqual(JSON.parse(fs.readFileSync(closeEvidence, 'utf8')), {
    lockClosed: true,
    injected: 2,
    replaced: true,
  });
  assert.equal(fs.readFileSync(lockPath, 'utf8'), claimant);
  assert.equal(fs.existsSync(detachedOwnedLock), true);
});

for (const failureMode of ['empty-write', 'partial-write', 'close', 'replacement', 'cleanup-failure']) {
  test(`cli: portable delivery lock: failed lock initialization is cleaned up and delivery can retry (${failureMode})`, () => {
    const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
    const out = path.join(tmp, `lock-init-${failureMode}.html`);
    assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
    const previousHash = sha256(out);
    const lockPath = deliveryLockPath(out);
    const wrapper = path.join(tmp, `lock-init-${failureMode}.mjs`);
    fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const openSync = fs.openSync;
let lockDescriptor;
fs.openSync = (file, ...args) => {
  const descriptor = openSync(file, ...args);
  if (String(file) === ${JSON.stringify(lockPath)}) lockDescriptor = descriptor;
  return descriptor;
};
const mode = ${JSON.stringify(failureMode)};
const method = mode === 'close' ? 'closeSync' : 'writeFileSync';
const original = fs[method];
if (mode === 'zero-identity-replacement') {
  const fstatSync = fs.fstatSync;
  const lstatSync = fs.lstatSync;
  fs.fstatSync = (descriptor, ...args) => {
    const entry = fstatSync(descriptor, ...args);
    return descriptor === lockDescriptor ? { ...entry, ino: 0 } : entry;
  };
  fs.lstatSync = (file, ...args) => {
    const entry = lstatSync(file, ...args);
    return String(file) === ${JSON.stringify(lockPath)}
      ? { ...entry, ino: 0, isFile: () => entry.isFile() }
      : entry;
  };
}
if (mode === 'cleanup-failure') {
  const renameSync = fs.renameSync;
  fs.renameSync = (source, target) => {
    if (String(source) === ${JSON.stringify(lockPath)}
        && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
      throw Object.assign(new Error('injected lock cleanup failure'), { code: 'EACCES' });
    }
    return renameSync(source, target);
  };
}
let injected = false;
fs[method] = (descriptor, ...args) => {
  if (descriptor === lockDescriptor && !injected) {
    injected = true;
    if (mode === 'partial-write') original(descriptor, '{');
    if (mode === 'replacement' || mode === 'zero-identity-replacement') {
      fs.renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owned`)});
      original(${JSON.stringify(lockPath)}, 'unrelated replacement');
    }
    throw Object.assign(new Error('injected lock initialization failure'), { code: 'ENOSPC' });
  }
  return original(descriptor, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
    const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    const receipt = JSON.parse(result.stdout);
    const replacementMode = failureMode === 'replacement' || failureMode === 'zero-identity-replacement';
    const expectedDiagnostic = replacementMode
      ? 'delivery/ownership-lost'
      : failureMode === 'cleanup-failure'
        ? 'delivery/lock-release'
        : 'delivery/lock-acquire';
    assert.equal(receipt.diagnostics[0].code, expectedDiagnostic);
    if (replacementMode || failureMode === 'cleanup-failure') {
      assert.equal(receipt.diagnostics[0].evidence.initializationSystemCode, 'ENOSPC');
    } else {
      assert.equal(receipt.diagnostics[0].evidence.systemCode, 'ENOSPC');
    }
    assert.equal(sha256(out), previousHash);
    const expectedProvenanceCode = replacementMode
      ? /^delivery\/provenance-locked$/
      : /^delivery\/provenance-failed$/;
    for (const args of [
      ['check', out],
      ['check', out, '--require-provenance'],
    ]) {
      const checked = run(args);
      assert.equal(checked.status, 1, checked.stderr || checked.stdout);
      assertCheckFailureReceipt(JSON.parse(checked.stdout), out, expectedProvenanceCode);
    }
    if (replacementMode) {
      assert.equal(fs.readFileSync(lockPath, 'utf8'), 'unrelated replacement');
      assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 1);
      return;
    }
    if (failureMode === 'cleanup-failure') {
      assert.equal(fs.existsSync(lockPath), true);
      assert.equal(receipt.provenance, 'failed');
      assert.equal(receipt.diagnostics[0].evidence.systemCode, 'EACCES');
      assert.match(receipt.diagnostics[0].evidence.reason, /injected lock cleanup failure/);
      assert.doesNotMatch(receipt.diagnostics[0].message, /committed/i);
      return;
    }
    assert.equal(fs.existsSync(lockPath), false);
    const retry = run(['deliver', 'workflow', input, out, '--json']);
    assert.equal(retry.status, 0, retry.stderr || retry.stdout);
    assert.equal(run(['check', out, '--require-provenance']).status, 0);
  });
}

test('cli: portable delivery lock: initialization ownership loss cannot claim failed provenance', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'lock-init-ownership-loss.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const pendingPath = deliveryPendingPath(out);
  const lockPath = deliveryLockPath(out);
  const successor = successorDeliveryState({
    receiptId: '14141414-1414-4414-8414-141414141414',
    input,
    output: out,
  });
  const wrapper = path.join(tmp, 'lock-init-ownership-loss.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const openSync = fs.openSync;
const writeFileSync = fs.writeFileSync;
const renameSync = fs.renameSync;
const linkSync = fs.linkSync;
let lockDescriptor;
let initializationFailed = false;
let successorInstalled = false;
fs.openSync = (file, ...args) => {
  const descriptor = openSync(file, ...args);
  if (String(file) === ${JSON.stringify(lockPath)}) lockDescriptor = descriptor;
  return descriptor;
};
fs.writeFileSync = (file, ...args) => {
  if (file === lockDescriptor && !initializationFailed) {
    initializationFailed = true;
    throw Object.assign(new Error('injected lock initialization failure'), { code: 'ENOSPC' });
  }
  return writeFileSync(file, ...args);
};
fs.linkSync = (source, target) => {
  const result = linkSync(source, target);
  if (!successorInstalled && initializationFailed
      && String(target) === ${JSON.stringify(provenancePath)}
      && path.basename(path.dirname(String(source))).startsWith('.archify-provenance-')) {
    successorInstalled = true;
    renameSync(${JSON.stringify(lockPath)}, ${JSON.stringify(`${lockPath}.owner-a`)});
    writeFileSync(${JSON.stringify(lockPath)}, ${JSON.stringify(successor.lock)}, { flag: 'wx' });
    writeFileSync(${JSON.stringify(pendingPath)}, ${JSON.stringify(successor.pending)});
    renameSync(target, String(target) + '.owner-a');
    writeFileSync(${JSON.stringify(provenancePath)}, ${JSON.stringify(successor.provenance)});
    writeFileSync(${JSON.stringify(out)}, ${JSON.stringify(successor.artifact)});
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.diagnostics[0].code, 'delivery/provenance-recovery-required');
  assert.ok(!('provenance' in receipt) || receipt.provenance === 'unrecorded');
  assert.equal(receipt.diagnostics[0].evidence.recoveryRequired, true);
  const initialization = receipt.diagnostics.find(({ code }) => code === 'delivery/lock-acquire');
  assert.equal(initialization.evidence.systemCode, 'ENOSPC');
  assert.equal(fs.readFileSync(out, 'utf8'), successor.artifact);
  assert.equal(fs.readFileSync(provenancePath, 'utf8'), successor.provenance);
  assert.equal(fs.readFileSync(lockPath, 'utf8'), successor.lock);
  assert.equal(fs.readFileSync(pendingPath, 'utf8'), successor.pending);
});

test('cli: portable delivery lock: a raw acquisition error does not obscure the input diagnosis', () => {
  const input = path.join(tmp, 'invalid-input-before-lock.json');
  const out = path.join(tmp, 'missing-output-parent', 'invalid-input.html');
  fs.writeFileSync(input, '{ invalid json');

  const failed = run(['deliver', 'workflow', input, out, '--json']);

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const receipt = JSON.parse(failed.stdout);
  assert.equal(receipt.stage, 'input');
  assert.equal(receipt.diagnostics[0].code, 'input/json-parse');
  assert.equal(receipt.diagnostics[1].code, 'delivery/lock-acquire');
  assert.equal(receipt.diagnostics[1].evidence.systemCode, 'ENOENT');
  assert.equal(fs.existsSync(out), false);
});

test('cli: delivery lock cannot replace its input specification', () => {
  const input = path.join(tmp, '.archify-delivery-lock.json');
  const source = fs.readFileSync(path.join(skillRoot, 'examples/agent-tool-call.workflow.json'));
  fs.writeFileSync(input, source);
  const out = path.join(tmp, 'lock-input-alias.html');
  const result = run(['deliver', 'workflow', input, out, '--json']);
  assert.equal(result.status, 1);
  assert.deepEqual(fs.readFileSync(input), source);
  assert.equal(fs.existsSync(out), false);
  assert.equal('provenance' in JSON.parse(result.stdout), false);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'delivery/lock-path-conflict');
});

test('cli: portable delivery lock: a symlink lock is invalid even when it targets the input', (t) => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'symlink-lock-to-input.html');
  const lockPath = deliveryLockPath(out);
  try {
    fs.symlinkSync(input, lockPath, 'file');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip('symlink creation requires permission');
      return;
    }
    throw error;
  }

  const result = run(['deliver', 'workflow', input, out, '--json']);

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'delivery/lock-invalid');
  assert.equal(fs.lstatSync(lockPath).isSymbolicLink(), true);
  assert.equal(fs.readlinkSync(lockPath), input);
  assert.equal(fs.existsSync(out), false);
});

test('cli: an unrecognized delivery lock preserves user data and invalidates the previous artifact', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'unrecognized-lock.html');
  const lock = deliveryLockPath(out);
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, sentinel: 'user data' }));
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const previousHash = sha256(out);
  fs.writeFileSync(lock, bytes);
  const result = run(['deliver', 'workflow', replacementInput, out, '--json']);
  assert.equal(result.status, 1);
  assert.deepEqual(fs.readFileSync(lock), bytes);
  assert.equal(sha256(out), previousHash);
  assert.equal(JSON.parse(result.stdout).diagnostics[0].code, 'delivery/lock-invalid');
  for (const args of [
    ['check', out],
    ['check', out, '--require-provenance'],
  ]) {
    const checked = run(args);
    assert.equal(checked.status, 1, checked.stderr || checked.stdout);
    assertCheckFailureReceipt(JSON.parse(checked.stdout), out, /^delivery\/provenance-locked$/);
  }
  for (const args of [
    ['visual-check', out, '--json'],
    ['visual-check', out, '--json', '--require-provenance'],
  ]) {
    const checked = run(args);
    assert.equal(checked.status, 1, checked.stderr || checked.stdout);
    const receipt = JSON.parse(checked.stdout);
    assert.equal(receipt.provenance, 'locked');
    assert.equal(receipt.diagnostics[0].code, 'delivery/provenance-locked');
  }
});

test('cli: a legacy per-artifact delivery lock remains a fail-closed migration barrier', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'legacy-lock-migration.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(out);
  const provenancePath = deliveryProvenancePath(out);
  const provenanceBefore = fs.readFileSync(provenancePath);
  const legacyLock = legacyDeliveryLockPath(out);
  const exited = spawnSync(process.execPath, ['-e', '']);
  assert.equal(exited.status, 0);
  fs.writeFileSync(legacyLock, `${JSON.stringify({
    schemaVersion: 1,
    receiptId: '17171717-1717-4717-8717-171717171717',
    pid: exited.pid,
  })}\n`);

  const failed = run(['deliver', 'workflow', replacementInput, out, '--json']);

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const failure = JSON.parse(failed.stdout);
  assert.equal(failure.diagnostics[0].code, 'delivery/lock-stale');
  assert.equal(failure.diagnostics[0].subject.lock, legacyLock);
  assert.deepEqual(fs.readFileSync(out), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenancePath), provenanceBefore);
  assert.equal(fs.existsSync(deliveryLockPath(out)), false);
  assert.equal(fs.existsSync(legacyLock), true);

  const checked = run(['check', out, '--require-provenance']);
  assert.equal(checked.status, 1, checked.stderr || checked.stdout);
  const checkFailure = JSON.parse(checked.stdout);
  assert.equal(checkFailure.provenance, 'locked');
  assert.equal(checkFailure.diagnostics[0].subject.lock, legacyLock);
});

test('cli: a legacy lock beside a symlinked artifact target remains a migration barrier', (t) => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const root = path.join(tmp, 'legacy-target-lock-symlink');
  const realDirectory = path.join(root, 'real');
  const aliasDirectory = path.join(root, 'alias');
  fs.mkdirSync(realDirectory, { recursive: true });
  fs.mkdirSync(aliasDirectory, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const realOutput = path.join(realDirectory, 'diagram.html');
  const aliasOutput = path.join(aliasDirectory, 'alias.html');
  assert.equal(run(['deliver', 'workflow', initialInput, realOutput, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(realOutput);
  const provenancePath = deliveryProvenancePath(realOutput);
  const provenanceBefore = fs.readFileSync(provenancePath);
  try {
    fs.symlinkSync(realOutput, aliasOutput, 'file');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip(`file symlink creation requires Windows permission (${error.code})`);
      return;
    }
    throw error;
  }
  const targetLegacyLock = legacyDeliveryLockPath(fs.realpathSync.native(realOutput));
  const exited = spawnSync(process.execPath, ['-e', '']);
  assert.equal(exited.status, 0);
  fs.writeFileSync(targetLegacyLock, `${JSON.stringify({
    schemaVersion: 1,
    receiptId: '19191919-1919-4919-8919-191919191919',
    pid: exited.pid,
  })}\n`);

  const failed = run(['deliver', 'workflow', replacementInput, aliasOutput, '--json']);

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const failure = JSON.parse(failed.stdout);
  assert.equal(failure.diagnostics[0].code, 'delivery/lock-stale');
  assert.equal(failure.diagnostics[0].subject.lock, targetLegacyLock);
  assert.equal(fs.lstatSync(aliasOutput).isSymbolicLink(), true);
  assert.deepEqual(fs.readFileSync(realOutput), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenancePath), provenanceBefore);
  assert.equal(fs.existsSync(deliveryLockPath(aliasOutput)), false);

  const checked = run(['check', aliasOutput, '--require-provenance']);
  assert.equal(checked.status, 1, checked.stderr || checked.stdout);
  const checkFailure = JSON.parse(checked.stdout);
  assert.equal(checkFailure.provenance, 'locked');
  assert.equal(checkFailure.diagnostics[0].subject.lock, targetLegacyLock);
});

test('cli: an active delivery fences old binaries at both lexical and physical artifact paths', async (t) => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const root = path.join(tmp, 'dual-lock-active-symlink');
  const realDirectory = path.join(root, 'real');
  const aliasDirectory = path.join(root, 'alias');
  fs.mkdirSync(realDirectory, { recursive: true });
  fs.mkdirSync(aliasDirectory, { recursive: true });
  const realOutput = path.join(realDirectory, 'diagram.html');
  const aliasOutput = path.join(aliasDirectory, 'alias.html');
  assert.equal(run(['deliver', 'workflow', initialInput, realOutput, '--json']).status, 0);
  try {
    fs.symlinkSync(realOutput, aliasOutput, 'file');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip(`file symlink creation requires Windows permission (${error.code})`);
      return;
    }
    throw error;
  }
  const lexicalLegacyLock = legacyDeliveryLockPath(aliasOutput);
  const physicalLegacyLock = legacyDeliveryLockPath(fs.realpathSync.native(realOutput));
  const globalLock = deliveryLockPath(aliasOutput);
  const ready = path.join(root, 'active.ready');
  const release = path.join(root, 'active.release');
  const wrapper = path.join(root, 'hold-active.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const writeFileSync = fs.writeFileSync;
fs.writeFileSync = (file, value, options) => {
  const result = writeFileSync(file, value, options);
  if (String(file).endsWith('specification.snapshot.json')) {
    writeFileSync(${JSON.stringify(ready)}, 'ready');
    while (!fs.existsSync(${JSON.stringify(release)})) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(aliasOutput)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const active = spawn(process.execPath, [wrapper], { cwd: skillRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  active.stdout.on('data', (chunk) => { stdout += chunk; });
  active.stderr.on('data', (chunk) => { stderr += chunk; });
  const activeExit = new Promise((resolve) => {
    active.once('close', (code, signal) => resolve({ code, signal }));
  });
  t.after(() => {
    if (!fs.existsSync(release)) fs.writeFileSync(release, 'release');
    if (active.exitCode === null && active.signalCode === null) active.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(ready) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(fs.existsSync(ready), true, stderr || stdout);
  assert.equal(fs.existsSync(globalLock), true);
  assert.equal(fs.existsSync(lexicalLegacyLock), true);
  assert.equal(fs.existsSync(physicalLegacyLock), true);
  for (const oldLockPath of [lexicalLegacyLock, physicalLegacyLock]) {
    assert.throws(
      () => fs.openSync(oldLockPath, 'wx', 0o600),
      (error) => error?.code === 'EEXIST',
    );
  }

  fs.writeFileSync(release, 'release');
  assert.deepEqual(await activeExit, { code: 0, signal: null }, stderr || stdout);
  assert.equal(fs.existsSync(globalLock), false);
  assert.equal(fs.existsSync(lexicalLegacyLock), false);
  assert.equal(fs.existsSync(physicalLegacyLock), false);
});

test('cli: a legacy-fence acquisition failure cleans every lock created by the new attempt', (t) => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const root = path.join(tmp, 'dual-lock-acquire-cleanup');
  const realDirectory = path.join(root, 'real');
  const aliasDirectory = path.join(root, 'alias');
  fs.mkdirSync(realDirectory, { recursive: true });
  fs.mkdirSync(aliasDirectory, { recursive: true });
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const realOutput = path.join(realDirectory, 'diagram.html');
  const aliasOutput = path.join(aliasDirectory, 'alias.html');
  assert.equal(run(['deliver', 'workflow', initialInput, realOutput, '--json']).status, 0);
  const artifactBefore = fs.readFileSync(realOutput);
  const provenancePath = deliveryProvenancePath(realOutput);
  const provenanceBefore = fs.readFileSync(provenancePath);
  try {
    fs.symlinkSync(realOutput, aliasOutput, 'file');
  } catch (error) {
    if (process.platform === 'win32' && ['EPERM', 'EACCES'].includes(error.code)) {
      t.skip(`file symlink creation requires Windows permission (${error.code})`);
      return;
    }
    throw error;
  }
  const lexicalLegacyLock = legacyDeliveryLockPath(aliasOutput);
  const physicalLegacyLock = legacyDeliveryLockPath(fs.realpathSync.native(realOutput));
  const globalLock = deliveryLockPath(aliasOutput);
  const wrapper = path.join(root, 'fail-physical-legacy-fence.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const openSync = fs.openSync;
fs.openSync = (file, ...args) => {
  if (String(file) === ${JSON.stringify(physicalLegacyLock)}) {
    throw Object.assign(new Error('injected legacy fence acquisition failure'), { code: 'EACCES' });
  }
  return openSync(file, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(aliasOutput)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  assert.equal(JSON.parse(failed.stdout).diagnostics[0].code, 'delivery/lock-acquire');
  assert.equal(fs.existsSync(globalLock), false);
  assert.equal(fs.existsSync(lexicalLegacyLock), false);
  assert.equal(fs.existsSync(physicalLegacyLock), false);
  assert.equal(fs.lstatSync(aliasOutput).isSymbolicLink(), true);
  assert.deepEqual(fs.readFileSync(realOutput), artifactBefore);
  assert.deepEqual(fs.readFileSync(provenancePath), provenanceBefore);
});

test('cli: delivery provenance cannot replace its input specification', () => {
  const input = path.join(tmp, 'provenance-input-alias.delivery.json');
  const source = fs.readFileSync(path.join(skillRoot, 'examples/agent-tool-call.workflow.json'));
  fs.writeFileSync(input, source);
  const out = input.replace(/\.delivery\.json$/, '.html');

  const result = run(['deliver', 'workflow', input, out, '--json']);

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.stage, 'prepare');
  assert.equal(failure.diagnostics[0].code, 'output/input-alias');
  assert.deepEqual(fs.readFileSync(input), source);
  assert.equal(fs.existsSync(out), false);
});

test('cli: rejected authored output does not write provenance outside the working directory', () => {
  const parent = path.join(tmp, 'rejected-authored-output');
  const workingDirectory = path.join(parent, 'work');
  fs.mkdirSync(workingDirectory, { recursive: true });
  const input = path.join(workingDirectory, 'input.workflow.json');
  const diagram = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/agent-tool-call.workflow.json'), 'utf8'));
  diagram.meta = { ...diagram.meta, output: '../victim.html' };
  fs.writeFileSync(input, JSON.stringify(diagram));
  const victim = path.join(parent, 'victim.html');
  const sidecar = path.join(parent, 'victim.delivery.json');
  const pending = path.join(parent, 'victim.delivery-pending.json');
  const artifactBytes = Buffer.from('<!doctype html><title>untouched</title>\n');
  const sidecarBytes = Buffer.from('{"status":"current","sentinel":true}\n');
  fs.writeFileSync(victim, artifactBytes);
  fs.writeFileSync(sidecar, sidecarBytes);

  const result = run(['deliver', 'workflow', input, '--json'], { cwd: workingDirectory });

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.diagnostics[0].code, 'output/meta-path-syntax');
  assert.deepEqual(fs.readFileSync(victim), artifactBytes);
  assert.deepEqual(fs.readFileSync(sidecar), sidecarBytes);
  assert.equal(fs.existsSync(pending), false);
  assert.equal('provenance' in failure, false);
});

test('cli: a failed provenance marker write and invalidation still leave a fail-closed journal', () => {
  const validInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const invalidInput = path.join(tmp, 'marker-write-failure.workflow.json');
  const invalid = JSON.parse(fs.readFileSync(validInput, 'utf8'));
  invalid.nodes[0].unexpected = true;
  fs.writeFileSync(invalidInput, JSON.stringify(invalid));
  const out = path.join(tmp, 'marker-write-failure.html');
  assert.equal(run(['deliver', 'workflow', validInput, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const pendingPath = deliveryPendingPath(out);
  const priorProvenance = fs.readFileSync(provenancePath);

  const wrapper = path.join(tmp, 'fail-marker-write.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const linkSync = fs.linkSync;
fs.linkSync = (source, target) => {
  if (String(source).includes('.archify-provenance-')
      && !String(source).endsWith('.previous-provenance')
      && String(target) === ${JSON.stringify(provenancePath)}) {
    const error = new Error('injected failure marker publish error');
    error.code = 'EACCES';
    throw error;
  }
  return linkSync(source, target);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(invalidInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.provenance, 'unrecorded');
  assert.ok(failure.diagnostics.some((entry) => entry.code === 'delivery/provenance-write'));
  assert.deepEqual(fs.readFileSync(provenancePath), priorProvenance);
  assert.equal(fs.existsSync(pendingPath), true);
  const permissive = run(['check', out]);
  assert.equal(permissive.status, 1);
  assertCheckFailureReceipt(
    JSON.parse(permissive.stdout),
    out,
    /^delivery\/provenance-failed$/,
  );
  const strict = run(['check', out, '--require-provenance']);
  assert.equal(strict.status, 1);
  assertCheckFailureReceipt(
    JSON.parse(strict.stdout),
    out,
    /^delivery\/provenance-failed$/,
  );
});

test('cli: failed-provenance candidate retirement preserves a replacement claimant', () => {
  const validInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const invalidInput = path.join(tmp, 'failed-provenance-retirement.workflow.json');
  const invalid = JSON.parse(fs.readFileSync(validInput, 'utf8'));
  invalid.nodes[0].unexpected = true;
  fs.writeFileSync(invalidInput, JSON.stringify(invalid));
  const out = path.join(tmp, 'failed-provenance-retirement.html');
  assert.equal(run(['deliver', 'workflow', validInput, out, '--json']).status, 0);
  const provenancePath = deliveryProvenancePath(out);
  const candidateName = path.basename(provenancePath);
  const claimant = '{"claimant":"failed provenance candidate retirement"}\n';
  const claimantIdentityFile = path.join(tmp, 'failed-provenance-retirement-identity.json');
  const displacedCandidate = path.join(tmp, 'failed-provenance-retirement-displaced');
  const priorStaging = fs.readdirSync(path.dirname(out))
    .filter((name) => name.startsWith('.archify-provenance-'))
    .sort();
  const wrapper = path.join(tmp, 'replace-failed-provenance-candidate-at-retirement.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const unlinkSync = fs.unlinkSync;
const renameSync = fs.renameSync;
const writeFileSync = fs.writeFileSync;
let replaced = false;
const isCandidate = (file) => (
  path.basename(String(file)) === ${JSON.stringify(candidateName)}
  && path.basename(path.dirname(String(file))).startsWith('.archify-provenance-')
);
const replaceCandidate = (file) => {
  replaced = true;
  renameSync(file, ${JSON.stringify(displacedCandidate)});
  writeFileSync(file, ${JSON.stringify(claimant)}, { flag: 'wx' });
  const stat = fs.lstatSync(file, { bigint: true });
  writeFileSync(${JSON.stringify(claimantIdentityFile)}, JSON.stringify({
    dev: String(stat.dev),
    ino: String(stat.ino),
  }));
};
fs.unlinkSync = (file, ...args) => {
  if (!replaced && isCandidate(file)) replaceCandidate(file);
  return unlinkSync(file, ...args);
};
fs.renameSync = (source, target, ...args) => {
  if (!replaced
      && isCandidate(source)
      && path.basename(path.dirname(String(target))).startsWith('.archify-remove-')) {
    replaceCandidate(source);
  }
  return renameSync(source, target, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(invalidInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);

  const failed = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
  assert.equal(failed.status, 1, failed.stderr || failed.stdout);
  const staging = fs.readdirSync(path.dirname(out))
    .filter((name) => name.startsWith('.archify-provenance-'))
    .filter((name) => !priorStaging.includes(name));
  assert.equal(staging.length, 1, failed.stderr || failed.stdout);
  const candidate = path.join(path.dirname(out), staging[0], candidateName);
  assert.equal(fs.readFileSync(candidate, 'utf8'), claimant);
  const claimantIdentity = fs.lstatSync(candidate, { bigint: true });
  assert.deepEqual(
    { dev: String(claimantIdentity.dev), ino: String(claimantIdentity.ino) },
    JSON.parse(fs.readFileSync(claimantIdentityFile, 'utf8')),
  );
  assert.equal(fs.existsSync(displacedCandidate), true);
});

test('cli: provenance staging cleanup preserves a directory claimant at the removal boundary', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'provenance-cleanup-claimant.html');
  const observation = path.join(tmp, 'provenance-cleanup-claimant.json');
  const wrapper = path.join(tmp, 'claim-provenance-staging-cleanup.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const rmSync = fs.rmSync.bind(fs);
const rmdirSync = fs.rmdirSync.bind(fs);
let injected = false;
let stagingDirectory;
let claimant;
function inject(target) {
  if (injected || !path.basename(String(target)).startsWith('.archify-provenance-')) return;
  injected = true;
  stagingDirectory = String(target);
  fs.renameSync(stagingDirectory, stagingDirectory + '.owned');
  fs.mkdirSync(stagingDirectory);
  claimant = path.join(stagingDirectory, 'claimant.txt');
  fs.writeFileSync(claimant, 'claimant-owned\\n');
}
fs.rmSync = (target, ...args) => {
  inject(target);
  return rmSync(target, ...args);
};
fs.rmdirSync = (target, ...args) => {
  inject(target);
  return rmdirSync(target, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
fs.writeFileSync(${JSON.stringify(observation)}, JSON.stringify({
  injected,
  stagingDirectory,
  claimantSurvived: claimant ? fs.existsSync(claimant) : false,
  claimantBytes: claimant && fs.existsSync(claimant) ? fs.readFileSync(claimant, 'utf8') : null,
}));
`);

  const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const state = JSON.parse(fs.readFileSync(observation, 'utf8'));
  assert.equal(state.injected, true, 'the cleanup-boundary claimant must be installed');
  assert.equal(state.claimantSurvived, true, 'cleanup must not recursively delete claimant contents');
  assert.equal(state.claimantBytes, 'claimant-owned\n');
  assert.equal(fs.existsSync(out), true);
});

test('cli: delivery staging cleanup preserves an empty directory claimant at the removal boundary', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-cleanup-empty-claimant.html');
  const observation = path.join(tmp, 'delivery-cleanup-empty-claimant.json');
  const wrapper = path.join(tmp, 'claim-delivery-staging-cleanup.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
import path from 'node:path';
const renameSync = fs.renameSync.bind(fs);
const rmdirSync = fs.rmdirSync.bind(fs);
let injected = false;
let claimantIdentity;
function inject(target) {
  if (injected || !path.basename(String(target)).startsWith('.archify-delivery-')) return;
  injected = true;
  const stagingDirectory = String(target);
  renameSync(stagingDirectory, stagingDirectory + '.owned');
  fs.mkdirSync(stagingDirectory);
  const metadata = fs.lstatSync(stagingDirectory, { bigint: true });
  claimantIdentity = { dev: metadata.dev, ino: metadata.ino };
}
fs.rmdirSync = (target, ...args) => {
  inject(target);
  return rmdirSync(target, ...args);
};
fs.renameSync = (source, target, ...args) => {
  if (path.basename(path.dirname(String(target))).startsWith('.archify-staging-remove-')) {
    inject(source);
  }
  return renameSync(source, target, ...args);
};
function claimantSurvives(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(directory, entry.name);
    if (!entry.isDirectory()) continue;
    const metadata = fs.lstatSync(absolute, { bigint: true });
    if (claimantIdentity
      && metadata.dev === claimantIdentity.dev
      && metadata.ino === claimantIdentity.ino) return true;
    if (claimantSurvives(absolute)) return true;
  }
  return false;
}
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
fs.writeFileSync(${JSON.stringify(observation)}, JSON.stringify({
  injected,
  claimantSurvived: claimantSurvives(${JSON.stringify(tmp)}),
}));
`);

  const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const state = JSON.parse(fs.readFileSync(observation, 'utf8'));
  assert.equal(state.injected, true, 'the cleanup-boundary claimant must be installed');
  assert.equal(state.claimantSurvived, true, 'cleanup must preserve the empty claimant inode');
  assert.equal(fs.existsSync(out), true);
});

test('cli: using the existing receipt as input fails before invalidating the previous delivery', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'receipt-as-input.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const sidecar = deliveryProvenancePath(out);
  const prior = fs.readFileSync(sidecar);
  const failed = run(['deliver', 'workflow', sidecar, out, '--json']);
  assert.equal(failed.status, 1);
  const failure = JSON.parse(failed.stdout);
  assert.equal(failure.stage, 'prepare');
  assert.equal(failure.diagnostics[0].code, 'output/meta-path-syntax');
  assert.deepEqual(fs.readFileSync(sidecar), prior);
  for (const flags of [[], ['--require-provenance']]) {
    const checked = run(['check', out, ...flags]);
    assert.equal(checked.status, 0);
    assert.equal(JSON.parse(checked.stdout).provenance, 'current');
  }
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  assert.equal(run(['check', out, '--require-provenance']).status, 0);
});

test('cli: visual-check input errors identify the artifact and preserve unowned evidence', () => {
  for (const input of [path.join(tmp, 'missing-visual.html'), path.join(tmp, 'wrong-visual.txt')]) {
    if (input.endsWith('.txt')) fs.writeFileSync(input, '<html></html>');
    const base = input.replace(/\.html?$/i, '') + '.visual-check';
    const staleReceipt = JSON.stringify({ ok: true, status: 'pass' });
    const staleContactSheet = 'old contact sheet';
    const staleScreenshot = 'old screenshot';
    fs.writeFileSync(`${base}.json`, staleReceipt);
    fs.writeFileSync(`${base}.html`, staleContactSheet);
    fs.writeFileSync(`${base}.1440x900.light.png`, staleScreenshot);
    const result = run(['visual-check', input, '--json']);
    assert.equal(result.status, 1);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.diagnostics[0].code, input.endsWith('.txt') ? 'viewer/visual-check-input' : 'input/artifact-unreadable');
    assert.equal(receipt.diagnostics[0].subject.artifact, input);
    assert.match(receipt.diagnostics[0].supportedFixes[0], /readable.*html/);
    assert.equal(
      receipt.diagnostics.some((entry) => entry.code === 'viewer/evidence-path-conflict'),
      !input.endsWith('.txt'),
    );
    assert.equal(fs.readFileSync(`${base}.json`, 'utf8'), staleReceipt);
    assert.equal(fs.readFileSync(`${base}.html`, 'utf8'), staleContactSheet);
    assert.equal(fs.readFileSync(`${base}.1440x900.light.png`, 'utf8'), staleScreenshot);
  }
});

test('cli: unreadable preserved artifact still leaves a journal that blocks later checks', () => {
  const validInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const invalidInput = path.join(tmp, 'unreadable-preserved-artifact.workflow.json');
  const invalid = JSON.parse(fs.readFileSync(validInput, 'utf8'));
  invalid.nodes[0].unexpected = true;
  fs.writeFileSync(invalidInput, JSON.stringify(invalid));
  const out = path.join(tmp, 'unreadable-preserved-artifact.html');
  assert.equal(run(['deliver', 'workflow', validInput, out, '--json']).status, 0);

  const wrapper = path.join(tmp, 'unreadable-preserved-artifact-wrapper.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const readFileSync = fs.readFileSync;
fs.readFileSync = (file, ...args) => {
  if (String(file) === ${JSON.stringify(out)}) {
    const error = new Error('injected unreadable preserved artifact');
    error.code = 'EACCES';
    throw error;
  }
  return readFileSync(file, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(invalidInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.equal(fs.existsSync(deliveryPendingPath(out)), true);
  const checked = run(['check', out, '--require-provenance']);
  assert.equal(checked.status, 1);
  assertCheckFailureReceipt(
    JSON.parse(checked.stdout),
    out,
    /^delivery\/provenance-failed$/,
  );
});

test('cli: provenance strictness distinguishes lower-level render output from delivered output', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'unknown-provenance.html');
  assert.equal(run(['render', 'workflow', input, out]).status, 0);

  const permissive = run(['check', out]);
  assert.equal(permissive.status, 0);
  assert.equal(JSON.parse(permissive.stdout).provenance, 'unknown');

  const strict = run(['check', out, '--require-provenance']);
  assert.equal(strict.status, 1);
  assert.equal(JSON.parse(strict.stdout).diagnostics[0].code, 'delivery/provenance-required');

  const visualStrict = run(['visual-check', out, '--json', '--require-provenance']);
  assert.equal(visualStrict.status, 1);
  assert.equal(JSON.parse(visualStrict.stdout).diagnostics[0].code, 'delivery/provenance-required');
});

test('cli: strict provenance rejects null, incomplete current, and unsupported-schema sidecars', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'malformed-current-provenance.html');
  const sidecar = deliveryProvenancePath(out);
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const valid = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  const incompleteCurrent = { ...valid };
  delete incompleteCurrent.receiptId;
  const unsupportedSchema = { ...valid, schemaVersion: 999 };

  for (const [name, value] of [
    ['null', null],
    ['incomplete-current', incompleteCurrent],
    ['unsupported-schema', unsupportedSchema],
  ]) {
    fs.writeFileSync(sidecar, `${JSON.stringify(value)}\n`);
    const checked = run(['check', out, '--require-provenance']);
    assert.equal(checked.status, 1, `${name}: ${checked.stderr || checked.stdout}`);
    assertCheckFailureReceipt(
      JSON.parse(checked.stdout),
      out,
      /^delivery\/provenance-invalid$/,
    );
  }
});

test('cli: a dangling delivery sidecar is invalid rather than absent', t => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'dangling-provenance.html');
  const sidecar = deliveryProvenancePath(out);
  assert.equal(run(['render', 'workflow', input, out]).status, 0);
  try {
    fs.symlinkSync(path.join(tmp, 'missing-provenance-target.json'), sidecar, 'file');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip('symlink creation requires permission');
      return;
    }
    throw error;
  }

  for (const args of [
    ['check', out],
    ['check', out, '--require-provenance'],
  ]) {
    const checked = run(args);
    assert.equal(checked.status, 1, checked.stderr || checked.stdout);
    assertCheckFailureReceipt(
      JSON.parse(checked.stdout),
      out,
      /^delivery\/provenance-invalid$/,
    );
  }
});

test('cli: strict check cannot attach prior provenance after the artifact changes mid-check', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'provenance-check-race.html');
  const replacement = path.join(tmp, 'provenance-check-race-replacement.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  assert.equal(run(['render', 'workflow', replacementInput, replacement]).status, 0);
  const originalSha256 = sha256(out);
  assert.notEqual(sha256(replacement), originalSha256);

  const wrapper = path.join(tmp, 'provenance-check-race-wrapper.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const openSync = fs.openSync;
const artifactPath = fs.realpathSync.native(${JSON.stringify(out)});
let artifactOpens = 0;
let replaced = false;
fs.openSync = (file, ...args) => {
  if (String(file) === artifactPath) artifactOpens += 1;
  if (!replaced && String(file) === artifactPath && artifactOpens === 2) {
    replaced = true;
    fs.copyFileSync(${JSON.stringify(replacement)}, artifactPath);
  }
  return openSync(file, ...args);
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'check', ${JSON.stringify(out)}, '--require-provenance'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const checked = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(checked.status, 1, checked.stderr || checked.stdout);
  assert.notEqual(sha256(out), originalSha256);
  assertCheckFailureReceipt(
    JSON.parse(checked.stdout),
    out,
    /^(?:delivery\/(?:provenance-mismatch|artifact-changed)|input\/artifact-unreadable)$/,
  );
});

test('cli: failed visual provenance preflight preserves unowned stale evidence', () => {
  const validInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const invalidInput = path.join(tmp, 'visual-preflight-failure.workflow.json');
  const invalid = JSON.parse(fs.readFileSync(validInput, 'utf8'));
  invalid.nodes[0].unexpected = true;
  fs.writeFileSync(invalidInput, JSON.stringify(invalid));
  const out = path.join(tmp, 'visual-preflight-failure.html');
  assert.equal(run(['deliver', 'workflow', validInput, out, '--json']).status, 0);
  assert.equal(run(['deliver', 'workflow', invalidInput, out, '--json']).status, 1);

  const evidence = visualEvidencePaths(out);
  const staleReceipt = '{"sentinel":"stale receipt"}\n';
  const staleContactSheet = '<!doctype html><title>stale contact sheet</title>\n';
  const staleScreenshot = 'stale screenshot';
  fs.writeFileSync(evidence.receipt, staleReceipt);
  fs.writeFileSync(evidence.contactSheet, staleContactSheet);
  for (const screenshot of evidence.screenshots) fs.writeFileSync(screenshot, staleScreenshot);

  const visual = run(['visual-check', out, '--json', '--require-provenance']);

  assert.equal(visual.status, 1, visual.stderr || visual.stdout);
  const receipt = JSON.parse(visual.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.command, 'visual-check');
  assert.equal(receipt.status, 'fail');
  assert.equal(receipt.artifact.path, path.resolve(out));
  assert.match(receipt.diagnostics[0].code, /^delivery\/provenance-failed$/);
  assert.ok(receipt.diagnostics.some((entry) => entry.code === 'viewer/evidence-path-conflict'));
  assert.equal(fs.readFileSync(evidence.receipt, 'utf8'), staleReceipt);
  assert.equal(fs.readFileSync(evidence.contactSheet, 'utf8'), staleContactSheet);
  assert.equal(evidence.screenshots.every(
    (file) => fs.readFileSync(file, 'utf8') === staleScreenshot,
  ), true);
});

test('cli: provenance writes cannot follow the former predictable temporary symlink', t => {
  const input = path.join(tmp, 'invalid-provenance-symlink.workflow.json');
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/agent-tool-call.workflow.json'), 'utf8'));
  source.nodes[0].unexpected = true;
  fs.writeFileSync(input, JSON.stringify(source));
  const out = path.join(tmp, 'provenance-symlink.html');
  const sentinel = path.join(tmp, 'provenance-symlink-sentinel.txt');
  const sentinelContents = 'must not be overwritten';
  fs.writeFileSync(out, '<!doctype html><title>trusted</title>\n');
  fs.writeFileSync(sentinel, sentinelContents);

  const wrapper = path.join(tmp, 'provenance-symlink-wrapper.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const sidecar = ${JSON.stringify(deliveryProvenancePath(out))};
try {
  fs.symlinkSync(${JSON.stringify(sentinel)}, sidecar + '.tmp-' + process.pid, 'file');
} catch (error) {
  if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) process.exit(77);
  throw error;
}
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(input)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const result = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });
  if (result.status === 77) {
    t.skip('symlink creation requires permission');
    return;
  }
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), sentinelContents);
  assert.equal(JSON.parse(fs.readFileSync(deliveryProvenancePath(out), 'utf8')).status, 'failed');
});

test('cli: deliver reports unreadable input as json without touching the target', () => {
  const input = path.join(tmp, 'malformed-delivery.json');
  fs.writeFileSync(input, '{not valid json');
  const out = path.join(tmp, 'malformed-input-preserved.html');
  const trustedPriorArtifact = '<!doctype html><title>still trusted</title>\n';
  fs.writeFileSync(out, trustedPriorArtifact);

  const result = run(['deliver', 'architecture', input, out, '--json']);
  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.stage, 'input');
  assert.match(failure.error, /Could not read delivery input/);
  assert.equal(fs.readFileSync(out, 'utf8'), trustedPriorArtifact);
});

test('cli: invalid source output metadata fails before renderer or delivery side effects', () => {
  const workingDirectory = path.join(tmp, 'invalid-output-metadata');
  fs.mkdirSync(workingDirectory, { recursive: true });
  const input = path.join(workingDirectory, 'source.architecture.json');
  const source = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/web-app.architecture.json'), 'utf8'));
  source.meta.output = 17;
  fs.writeFileSync(input, JSON.stringify(source));
  const out = path.join(workingDirectory, 'architecture.html');
  const trustedPriorArtifact = '<!doctype html><title>metadata did not replace me</title>\n';
  fs.writeFileSync(out, trustedPriorArtifact);

  const result = run(['deliver', 'architecture', input, '--json'], { cwd: workingDirectory });
  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.stage, 'prepare');
  assert.equal(failure.diagnostics[0].code, 'output/meta-path-syntax');
  assert.equal(fs.readFileSync(out, 'utf8'), trustedPriorArtifact);
  assert.deepEqual(fs.readdirSync(workingDirectory).sort(), [
    'architecture.html',
    'source.architecture.json',
  ]);
});

test('cli: deliver rejects a non-regular target before commit without a false success receipt', () => {
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');
  const outputDirectory = path.join(tmp, 'commit-target-is-a-directory.html');
  fs.mkdirSync(outputDirectory, { recursive: true });

  const result = run(['deliver', 'architecture', input, outputDirectory, '--json']);
  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.stage, 'prepare');
  assert.equal(failure.diagnostics[0].code, 'output/target-not-regular-file');
  assert.match(failure.error, /HTML artifact target is not a regular file/);
  assert.equal(fs.statSync(outputDirectory).isDirectory(), true);
  assert.equal(fs.readdirSync(outputDirectory).length, 0);
});

test('cli: deliver reports preparation failure as json without touching the blocker', () => {
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');
  const blockingFile = path.join(tmp, 'delivery-parent-is-a-file');
  fs.writeFileSync(blockingFile, 'do not replace me');
  const out = path.join(blockingFile, 'cannot-write.html');

  const result = run(['deliver', 'architecture', input, out, '--json']);
  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.stage, 'prepare');
  assert.equal(failure.diagnostics[0].code, 'output/path-resolution-indeterminate');
  assert.match(failure.error, /Output path could not be resolved safely/);
  assert.equal(fs.readFileSync(blockingFile, 'utf8'), 'do not replace me');
});

test('cli: check validates rendered html', () => {
  const out = path.join(tmp, 'workflow-check.html');
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  assert.equal(run(['render', 'workflow', input, out]).status, 0);

  const result = run(['check', out]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"ok": true/);
});

test('cli: check rejects unknown options and extra positionals', () => {
  const out = path.join(tmp, 'workflow-check-args.html');
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  assert.equal(run(['render', 'workflow', input, out]).status, 0);

  const unknown = run(['check', '--json', out]);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Unknown check option "--json"/);

  const strict = run(['check', '--require-provenance', out]);
  assert.equal(strict.status, 1);
  assert.equal(JSON.parse(strict.stdout).diagnostics[0].code, 'delivery/provenance-required');

  const extra = run(['check', out, 'ignored-extra']);
  assert.equal(extra.status, 2);
  assert.match(extra.stderr, /Usage:/);
});

test('cli: validate emits structured json without keeping html output', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const before = new Set(fs.readdirSync(tmp));
  const result = run(['validate', 'workflow', input, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.type, 'workflow');
  assert.equal(parsed.checks.length, 9);
  assert.equal(parsed.composition.profile, 'showcase');
  assert.deepEqual(parsed.composition.summary, { errors: 0, warnings: 0 });
  assert.equal(parsed.composition.metrics.containerBorderRuns, 0);
  assert.equal(parsed.composition.metrics.ambiguousCorridors, 0);
  assert.deepEqual(new Set(fs.readdirSync(tmp)), before);
});

test('cli: validate JSON exposes only the primary v1 column-capacity diagnostic', () => {
  const input = path.join(tmp, 'pinned-column-capacity.workflow.json');
  fs.writeFileSync(input, `${JSON.stringify({
    schema_version: 1,
    diagram_type: 'workflow',
    meta: {
      title: 'Pinned issue 126 diagnostic boundary',
      output: 'pinned-column-capacity.html',
      viewBox: [720, 400],
      legend: { mode: 'hidden' },
    },
    lanes: [{ id: 'main', label: 'Main' }],
    nodes: [
      { id: 'a', lane: 'main', col: 1, type: 'backend', label: 'A' },
      { id: 'b', lane: 'main', col: 2, type: 'backend', label: 'B' },
    ],
    edges: [{
      id: 'ab',
      from: 'a',
      to: 'b',
      fromSide: 'top',
      toSide: 'top',
      via: [[220, 60], [300, 60]],
    }],
  }, null, 2)}\n`);

  const result = run(['validate', 'workflow', input, '--json'], {
    env: { ...process.env, ARCHIFY_DIAGNOSTIC_FORMAT: 'json' },
  });

  assert.equal(result.status, 1, result.stderr || result.stdout);
  assert.equal(result.stderr, '');
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.command, 'validate');
  assert.equal(failure.stage, 'render');
  assert.equal(failure.type, 'workflow');
  assert.equal(failure.diagnostics.length, 1, JSON.stringify(failure.diagnostics, null, 2));
  const [primary] = failure.diagnostics;
  assert.equal(primary.code, 'workflow/column-capacity');
  assert.equal(primary.subject.edge, 'ab');
  assert.equal(primary.subject.fromCol, 1);
  assert.equal(primary.subject.toCol, 2);
  assert.ok(primary.supportedFixes.length > 0);
  assert.ok(failure.diagnostics.every(({ code }) => (
    code !== 'workflow/explicit-pin-conflict' && code !== 'workflow/viewbox-capacity'
  )));
});

test('cli: --quality overrides the source profile for render, validate, and deliver', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'workflow-standard.html');
  const rendered = run(['render', 'workflow', input, out, '--quality', 'standard']);
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(fs.readFileSync(out, 'utf8'), /data-quality-profile="standard"/);

  const validated = run(['validate', 'workflow', input, '--quality=standard', '--json']);
  assert.equal(validated.status, 0, validated.stderr);
  assert.equal(JSON.parse(validated.stdout).composition.profile, 'standard');

  const deliveredOut = path.join(tmp, 'workflow-delivered-standard.html');
  const delivered = run(['deliver', 'workflow', input, deliveredOut, '--quality=standard', '--json']);
  assert.equal(delivered.status, 0, delivered.stderr);
  assert.equal(JSON.parse(delivered.stdout).validation.compositionProfile, 'standard');
});

test('cli: rejects an unknown quality profile', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const result = run(['validate', 'workflow', input, '--quality', 'hero']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Expected standard or showcase/);
});

test('cli: rejects a quality flag without a value', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  for (const args of [
    ['validate', 'workflow', input, '--quality'],
    ['deliver', 'workflow', input, '--quality='],
    ['validate', 'workflow', input, '--quality='],
  ]) {
    const result = run(args);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /--quality requires standard or showcase/);
  }
});

test('cli: validate rejects unknown flags, layout-json assignment typos, and extra positionals', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const cases = [
    {
      args: ['validate', 'workflow', input, '--layout-json', '--bogus'],
      pattern: /Unknown validate option "--bogus"/,
    },
    {
      args: ['validate', 'workflow', input, '--layout-json=true'],
      pattern: /Unknown validate option "--layout-json=true"/,
    },
    {
      args: ['validate', 'workflow', input, 'unexpected-output.html', '--layout-json'],
      pattern: /Usage:/,
    },
  ];

  for (const { args, pattern } of cases) {
    const result = run(args);
    assert.equal(result.status, 2, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, pattern);
  }
});

test('cli: validate and deliver keep argument failures machine-readable with --json', () => {
  const workflow = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const sequence = path.join(skillRoot, 'examples/cache-miss-request.sequence.json');
  const cases = [
    {
      args: ['validate', '--json'],
      command: 'validate',
      code: 'cli/usage',
    },
    {
      args: ['validate', '--json', 'workflow', workflow, '--quality', 'hero'],
      command: 'validate',
      code: 'cli/invalid-option-value',
      subject: { option: '--quality' },
    },
    {
      args: ['validate', 'workflow', workflow, '--quality', '--json'],
      command: 'validate',
      code: 'cli/missing-option-value',
      subject: { option: '--quality' },
    },
    {
      args: ['validate', 'workflow', workflow, '--quality=', '--json'],
      command: 'validate',
      code: 'cli/missing-option-value',
      subject: { option: '--quality' },
    },
    {
      args: ['validate', 'workflow', workflow, '--layout-json=true', '--json'],
      command: 'validate',
      code: 'cli/unknown-option',
      subject: { option: '--layout-json=true' },
    },
    {
      args: ['validate', '--bogus', 'payload', 'workflow', workflow, '--json'],
      command: 'validate',
      code: 'cli/unknown-option',
      subject: { option: '--bogus' },
    },
    {
      args: ['validate', 'workflow', workflow, 'unexpected-output.html', '--json'],
      command: 'validate',
      code: 'cli/usage',
    },
    {
      args: ['validate', 'unknown', workflow, '--json'],
      command: 'validate',
      code: 'cli/unknown-diagram-type',
      subject: { type: 'unknown' },
    },
    {
      args: ['validate', 'architecture', workflow, '--repo-root=', '--json'],
      command: 'validate',
      code: 'cli/missing-option-value',
      subject: { option: '--repo-root' },
    },
    {
      args: ['validate', 'sequence', sequence, '--layout-json', '--json'],
      command: 'validate',
      code: 'cli/unsupported-option',
      subject: { option: '--layout-json', type: 'sequence' },
    },
    {
      args: ['deliver', '--json', 'workflow', workflow, '--bogus'],
      command: 'deliver',
      code: 'cli/unknown-option',
      subject: { option: '--bogus' },
    },
    {
      args: ['deliver', '--json'],
      command: 'deliver',
      code: 'cli/usage',
    },
    {
      args: ['deliver', 'workflow', workflow, '--repo-root', '--json'],
      command: 'deliver',
      code: 'cli/missing-option-value',
      subject: { option: '--repo-root' },
    },
    {
      args: ['deliver', 'unknown', workflow, '--json'],
      command: 'deliver',
      code: 'cli/unknown-diagram-type',
      subject: { type: 'unknown' },
    },
    {
      args: ['deliver', 'workflow', workflow, 'diagram.html', 'extra.html', '--json'],
      command: 'deliver',
      code: 'cli/usage',
    },
  ];

  for (const { args, command, code, subject = {} } of cases) {
    const result = run(args);
    assert.equal(result.status, 2, `${args.join(' ')}\n${result.stderr}\n${result.stdout}`);
    assert.equal(result.stderr, '');
    const failure = JSON.parse(result.stdout);
    assert.equal(failure.schemaVersion, 1);
    assert.equal(failure.ok, false);
    assert.equal(failure.command, command);
    assert.equal(failure.stage, 'arguments');
    assert.equal('type' in failure, false);
    assert.equal('input' in failure, false);
    assert.equal(failure.diagnostics.length, 1);
    assert.equal(failure.diagnostics[0].code, code);
    assert.equal(failure.diagnostics[0].severity, 'error');
    assert.deepEqual(failure.diagnostics[0].subject, { command, ...subject });
    assert.ok(failure.diagnostics[0].supportedFixes.length > 0);
    assert.equal('stack' in failure, false);
    assert.equal('stack' in failure.diagnostics[0], false);
  }
});

test('cli: inspect emits architecture layout json', () => {
  const input = path.resolve(skillRoot, '../examples/archify-repo-grid.architecture.json');
  const result = run(['inspect', 'architecture', input]);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.diagram_type, 'architecture');
  assert.equal(parsed.layout.mode, 'grid');
  assert.ok(parsed.components.length >= 5);
  assert.ok(parsed.connections.length >= 1);
});

test('cli: inspect remains architecture-only while workflow uses validate --layout-json', () => {
  const input = path.join(skillRoot, 'examples', 'agent-tool-call.workflow.json');
  const result = run(['inspect', 'workflow', input]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /inspect is currently supported for architecture diagrams only/);
  assert.equal(result.stdout, '');
});

test('cli: validate returns renderer errors for bad input', () => {
  const input = path.join(tmp, 'bad.workflow.json');
  const validateTmp = path.join(tmp, 'validate-failure-tmp');
  const doc = JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/agent-tool-call.workflow.json'), 'utf8'));
  doc.edges[0].to = 'ghost';
  fs.writeFileSync(input, JSON.stringify(doc));
  fs.mkdirSync(validateTmp);

  const result = run(['validate', 'workflow', input], {
    env: { ...process.env, TMPDIR: validateTmp },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown target "ghost"/);
  assert.deepEqual(fs.readdirSync(validateTmp), []);
});

test('cli: validate rejects an unknown type without leaking a temp directory', () => {
  const validateTmp = path.join(tmp, 'validate-unknown-type-tmp');
  fs.mkdirSync(validateTmp);

  const result = run(['validate', 'unknown', 'ignored.json'], {
    env: {
      ...process.env,
      TMPDIR: validateTmp,
      TMP: validateTmp,
      TEMP: validateTmp,
    },
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown diagram type "unknown"/);
  assert.deepEqual(fs.readdirSync(validateTmp), []);
});

process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

test('render rejects a mistyped option instead of writing a file named after it', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'render-guard-'));
  const spec = path.join(dir, 'spec.json');
  fs.copyFileSync(path.join(skillRoot, '../examples/archify-repo.architecture.json'), spec);

  // Without the guard this wrote a 600KB file literally named `--json` and
  // never wrote out.html, exiting 0.
  const result = run(['render', 'architecture', spec, '--json', 'out.html'], { cwd: dir });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unknown render option/);
  assert.deepEqual(fs.readdirSync(dir), ['spec.json']);
});

test('render rejects an extra positional argument', () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'render-arity-'));
  const spec = path.join(dir, 'spec.json');
  fs.copyFileSync(path.join(skillRoot, '../examples/archify-repo.architecture.json'), spec);

  const result = run(['render', 'architecture', spec, 'out.html', 'extra.html'], { cwd: dir });

  assert.notEqual(result.status, 0);
  assert.deepEqual(fs.readdirSync(dir), ['spec.json']);
});
