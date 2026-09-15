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

function deliveryPendingPath(file) {
  return file.replace(/\.html?$/i, '.delivery-pending.json');
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
  assert.match(result.stdout, /--repo-root path \(architecture only\)/);
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
  assert.match(result.stdout, /Archify scenario recipes \(11\)/);
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
  assert.equal(receipt.output, out);
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
  assert.deepEqual(receipt.open, {
    requested: true,
    status: 'opened',
    target: out,
    method: process.platform === 'darwin' ? 'open' : 'xdg-open',
  });
  const invocation = JSON.parse(fs.readFileSync(fake.log, 'utf8'));
  assert.equal(invocation.existed, true, 'the opener must run after the atomic commit');
  assert.deepEqual(invocation.argv, [out]);
  assert.equal(invocation.target, out);
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
  assert.equal(receipt.open.target, out);
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
    target: out,
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
  const child = spawn(process.execPath, [installedCli, 'preview', 'architecture', input, output, '--quality', 'showcase', '--no-open'], {
    cwd: installedRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
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

  child.kill('SIGTERM');
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
  const provenance = JSON.parse(fs.readFileSync(out.replace(/\.html$/, '.delivery.json'), 'utf8'));
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
  fs.writeFileSync(out.replace(/\.html$/, '.delivery.json'), JSON.stringify({ status: 'failed' }));

  const delivered = run(['deliver', 'workflow', input, out, '--json']);
  assert.equal(delivered.status, 0, delivered.stderr);
  const receipt = JSON.parse(delivered.stdout);
  const provenance = JSON.parse(fs.readFileSync(out.replace(/\.html$/, '.delivery.json'), 'utf8'));
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
  const provenancePath = out.replace(/\.html$/, '.delivery.json');
  const initial = run(['deliver', 'workflow', input, out, '--json']);
  assert.equal(initial.status, 0, initial.stderr);
  const priorArtifact = fs.readFileSync(out);

  const wrapper = path.join(tmp, 'fail-provenance-commit.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const renameSync = fs.renameSync;
fs.renameSync = (source, target) => {
  if (String(source).endsWith('delivery-provenance.json')) {
    const error = new Error('injected provenance rename failure');
    error.code = 'EACCES';
    throw error;
  }
  return renameSync(source, target);
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

test('cli: delivery pair rollback retains recoverable backups when restoration fails', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'delivery-pair-recovery-required.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const priorArtifact = fs.readFileSync(out);

  const wrapper = path.join(tmp, 'fail-delivery-rollback-restore.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const renameSync = fs.renameSync;
fs.renameSync = (source, target) => {
  if (String(source).endsWith('delivery-provenance.json')) {
    const error = new Error('injected provenance rename failure');
    error.code = 'EACCES';
    throw error;
  }
  if (String(source).endsWith('.previous-output') && String(target) === ${JSON.stringify(out)}) {
    const error = new Error('injected output restore failure');
    error.code = 'EACCES';
    throw error;
  }
  return renameSync(source, target);
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
  const outputBackup = evidence.recoverableBackups.find((entry) => entry.label === 'HTML artifact');
  assert.ok(outputBackup);
  assert.deepEqual(fs.readFileSync(outputBackup.path), priorArtifact);
});

test('cli: a process exit after HTML commit remains fail-closed until a successful rerun', () => {
  const initialInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const replacementInput = path.join(skillRoot, 'examples/incident-response.workflow.json');
  const out = path.join(tmp, 'interrupted-delivery-pair.html');
  assert.equal(run(['deliver', 'workflow', initialInput, out, '--json']).status, 0);
  const initialSha256 = sha256(out);

  const wrapper = path.join(tmp, 'interrupt-after-html-commit.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const renameSync = fs.renameSync;
fs.renameSync = (source, target) => {
  const result = renameSync(source, target);
  if (String(target) === ${JSON.stringify(out)} && String(source).includes('.archify-delivery-')) {
    process.exit(86);
  }
  return result;
};
process.argv = [process.execPath, ${JSON.stringify(cli)}, 'deliver', 'workflow', ${JSON.stringify(replacementInput)}, ${JSON.stringify(out)}, '--json'];
await import(${JSON.stringify(pathToFileURL(cli).href)});
`);
  const interrupted = spawnSync(process.execPath, [wrapper], { cwd: skillRoot, encoding: 'utf8' });

  assert.equal(interrupted.status, 86);
  assert.notEqual(sha256(out), initialSha256);
  assert.equal(fs.existsSync(deliveryPendingPath(out)), true);
  for (const args of [
    ['check', out],
    ['check', out, '--require-provenance'],
  ]) {
    const checked = run(args);
    assert.equal(checked.status, 1, checked.stderr || checked.stdout);
    assertCheckFailureReceipt(
      JSON.parse(checked.stdout),
      out,
      /^delivery\/(?:provenance-pending|provenance-failed)$/,
    );
  }

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

test('cli: concurrent deliveries cannot replace the active attempt ownership', async () => {
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
  const activeExit = await new Promise((resolve) => active.once('close', (code, signal) => resolve({ code, signal })));
  assert.deepEqual(activeExit, { code: 0, signal: null }, activeStderr);
  const activeReceipt = JSON.parse(activeStdout);
  const provenance = JSON.parse(fs.readFileSync(out.replace(/\.html$/, '.delivery.json'), 'utf8'));
  assert.equal(provenance.status, 'current');
  assert.equal(provenance.receiptId, activeReceipt.receiptId);
  assert.equal(fs.existsSync(out.replace(/\.html$/, '.delivery-lock.json')), false);
});

test('cli: delivery lock cannot replace its input specification', () => {
  const input = path.join(tmp, 'lock-input-alias.delivery-lock.json');
  const source = fs.readFileSync(path.join(skillRoot, 'examples/agent-tool-call.workflow.json'));
  fs.writeFileSync(input, source);
  const out = input.replace(/\.delivery-lock\.json$/, '.html');
  const result = run(['deliver', 'workflow', input, out, '--json']);
  assert.equal(result.status, 1);
  assert.deepEqual(fs.readFileSync(input), source);
  assert.equal(fs.existsSync(out), false);
  assert.equal('provenance' in JSON.parse(result.stdout), false);
});

test('cli: delivery preserves unrecognized JSON at the lock path', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'unrecognized-lock.html');
  const lock = out.replace(/\.html$/, '.delivery-lock.json');
  const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, sentinel: 'user data' }));
  fs.writeFileSync(lock, bytes);
  const result = run(['deliver', 'workflow', input, out, '--json']);
  assert.equal(result.status, 1);
  assert.deepEqual(fs.readFileSync(lock), bytes);
  assert.equal(fs.existsSync(out), false);
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
  assert.equal(failure.diagnostics[0].code, 'output/meta-outside-cwd');
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
  const provenancePath = out.replace(/\.html$/, '.delivery.json');
  const pendingPath = deliveryPendingPath(out);
  assert.equal(run(['deliver', 'workflow', validInput, out, '--json']).status, 0);
  const priorProvenance = fs.readFileSync(provenancePath);

  const wrapper = path.join(tmp, 'fail-marker-write.mjs');
  fs.writeFileSync(wrapper, `
import fs from 'node:fs';
const renameSync = fs.renameSync;
const rmSync = fs.rmSync;
fs.renameSync = (source, target) => {
  if (String(source).includes('.archify-provenance-') && String(target) === ${JSON.stringify(provenancePath)}) {
    const error = new Error('injected failure marker rename error');
    error.code = 'EACCES';
    throw error;
  }
  return renameSync(source, target);
};
fs.rmSync = (target, options) => {
  if (String(target) === ${JSON.stringify(provenancePath)}) {
    const error = new Error('injected current provenance removal error');
    error.code = 'EACCES';
    throw error;
  }
  return rmSync(target, options);
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
    /^delivery\/(?:provenance-pending|provenance-failed)$/,
  );
  const strict = run(['check', out, '--require-provenance']);
  assert.equal(strict.status, 1);
  assertCheckFailureReceipt(
    JSON.parse(strict.stdout),
    out,
    /^delivery\/(?:provenance-pending|provenance-failed)$/,
  );
});

test('cli: using the existing receipt as input preserves it and invalidates the previous delivery', () => {
  const input = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const out = path.join(tmp, 'receipt-as-input.html');
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  const sidecar = out.replace(/\.html$/, '.delivery.json');
  const prior = fs.readFileSync(sidecar);
  const failed = run(['deliver', 'workflow', sidecar, out, '--json']);
  assert.equal(failed.status, 1);
  assert.equal(JSON.parse(failed.stdout).provenance, 'unrecorded');
  assert.deepEqual(fs.readFileSync(sidecar), prior);
  for (const flags of [[], ['--require-provenance']]) {
    const checked = run(['check', out, ...flags]);
    assert.equal(checked.status, 1);
    assert.equal(JSON.parse(checked.stdout).provenance, 'failed');
  }
  assert.equal(run(['deliver', 'workflow', input, out, '--json']).status, 0);
  assert.equal(run(['check', out, '--require-provenance']).status, 0);
});

test('cli: visual-check input errors identify the artifact rather than Chrome', () => {
  for (const input of [path.join(tmp, 'missing-visual.html'), path.join(tmp, 'wrong-visual.txt')]) {
    if (input.endsWith('.txt')) fs.writeFileSync(input, '<html></html>');
    const base = input.replace(/\.html?$/i, '') + '.visual-check';
    fs.writeFileSync(`${base}.json`, JSON.stringify({ ok: true, status: 'pass' }));
    fs.writeFileSync(`${base}.html`, 'old contact sheet');
    fs.writeFileSync(`${base}.1440x900.light.png`, 'old screenshot');
    const result = run(['visual-check', input, '--json']);
    assert.equal(result.status, 1);
    const receipt = JSON.parse(result.stdout);
    assert.equal(receipt.diagnostics[0].code, input.endsWith('.txt') ? 'viewer/visual-check-input' : 'input/artifact-unreadable');
    assert.equal(receipt.diagnostics[0].subject.artifact, input);
    assert.match(receipt.diagnostics[0].supportedFixes[0], /readable.*html/);
    assert.equal(JSON.parse(fs.readFileSync(`${base}.json`)).status, 'fail');
    assert.equal(fs.existsSync(`${base}.html`), false);
    assert.equal(fs.existsSync(`${base}.1440x900.light.png`), false);
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
    /^delivery\/(?:provenance-pending|provenance-failed)$/,
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
  const sidecar = out.replace(/\.html$/, '.delivery.json');
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
  const sidecar = out.replace(/\.html$/, '.delivery.json');
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
const readFileSync = fs.readFileSync;
let replaced = false;
fs.readFileSync = (file, ...args) => {
  const value = readFileSync(file, ...args);
  if (!replaced && String(file) === ${JSON.stringify(out)}) {
    replaced = true;
    fs.copyFileSync(${JSON.stringify(replacement)}, ${JSON.stringify(out)});
  }
  return value;
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
    /^delivery\/(?:provenance-mismatch|artifact-changed)$/,
  );
});

test('cli: failed visual provenance preflight replaces stale evidence with a persisted failure receipt', () => {
  const validInput = path.join(skillRoot, 'examples/agent-tool-call.workflow.json');
  const invalidInput = path.join(tmp, 'visual-preflight-failure.workflow.json');
  const invalid = JSON.parse(fs.readFileSync(validInput, 'utf8'));
  invalid.nodes[0].unexpected = true;
  fs.writeFileSync(invalidInput, JSON.stringify(invalid));
  const out = path.join(tmp, 'visual-preflight-failure.html');
  assert.equal(run(['deliver', 'workflow', validInput, out, '--json']).status, 0);
  assert.equal(run(['deliver', 'workflow', invalidInput, out, '--json']).status, 1);

  const evidence = visualEvidencePaths(out);
  fs.writeFileSync(evidence.receipt, '{"sentinel":"stale receipt"}\n');
  fs.writeFileSync(evidence.contactSheet, '<!doctype html><title>stale contact sheet</title>\n');
  for (const screenshot of evidence.screenshots) fs.writeFileSync(screenshot, 'stale screenshot');

  const visual = run(['visual-check', out, '--json', '--require-provenance']);

  assert.equal(visual.status, 1, visual.stderr || visual.stdout);
  const receipt = JSON.parse(visual.stdout);
  assert.equal(receipt.ok, false);
  assert.equal(receipt.command, 'visual-check');
  assert.equal(receipt.status, 'fail');
  assert.equal(receipt.artifact.path, path.resolve(out));
  assert.match(receipt.diagnostics[0].code, /^delivery\/(?:provenance-pending|provenance-failed)$/);
  assert.equal(fs.existsSync(evidence.contactSheet), false);
  assert.equal(evidence.screenshots.every((file) => !fs.existsSync(file)), true);
  const persisted = JSON.parse(fs.readFileSync(evidence.receipt, 'utf8'));
  assert.equal(persisted.command, 'visual-check');
  assert.equal(persisted.status, 'fail');
  assert.equal(persisted.artifact.path, path.resolve(out));
  assert.equal(persisted.diagnostics[0].code, receipt.diagnostics[0].code);
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
const sidecar = ${JSON.stringify(out.replace(/\.html$/, '.delivery.json'))};
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
  assert.equal(JSON.parse(fs.readFileSync(out.replace(/\.html$/, '.delivery.json'), 'utf8')).status, 'failed');
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

test('cli: invalid source output metadata still fails inside the renderer', () => {
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
  assert.equal(failure.stage, 'render');
  assert.match(failure.error, /schema validation failed/i);
  assert.equal(fs.readFileSync(out, 'utf8'), trustedPriorArtifact);
});

test('cli: deliver reports commit failure without a false success receipt', () => {
  const input = path.join(skillRoot, 'examples/web-app.architecture.json');
  const outputDirectory = path.join(tmp, 'commit-target-is-a-directory.html');
  fs.mkdirSync(outputDirectory, { recursive: true });

  const result = run(['deliver', 'architecture', input, outputDirectory, '--json']);
  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stdout);
  assert.equal(failure.ok, false);
  assert.equal(failure.stage, 'commit');
  assert.match(failure.error, /Could not commit verified delivery/);
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
  assert.match(failure.error, /Could not create delivery directory/);
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
      args: ['validate', 'workflow', workflow, '--repo-root', '.', '--json'],
      command: 'validate',
      code: 'cli/unsupported-option',
      subject: { option: '--repo-root', type: 'workflow' },
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
